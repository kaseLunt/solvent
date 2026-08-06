"use client";

// The Inspector surface for one address: three-valued `found` rendered AT THE
// PAGE LEVEL (spec §3.2, honest-UI law 1). The three states are three
// DIFFERENT statements and never conflate:
//
//   found       → the position layout (a floor, disclosed, when incomplete)
//   not-found   → "no position in this batch" WITH the lookup-completeness
//                 that entitles the service to say so
//   unknowable  → "cannot be established", the withheld engines NAMED —
//                 never the definitive negative
//
// A failed request is a fourth, separate statement ("lookup unavailable") —
// an error is not an answer.

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  ContractInvariantError,
  RateLimitedError,
  SolventHttpError,
  UnavailableError,
  type AddressLookup,
} from "@solvent/client";
import { getSolventClient, solventBaseUrl } from "@/lib/api";
import { formatBlock, isAddress } from "@/lib/format";
import { lookupTakeaway } from "@/lib/inspector-lines";
import {
  batchFreshnessLine,
  batchFreshnessLineUnknown,
  batchFreshnessStamp,
  batchFreshnessStampUnknown,
  receiptIdentity,
} from "@/lib/freshness";
import { useAnchoredAgeSeconds } from "@/lib/live-age";
import {
  fetchAddressHistory,
  fetchEvents,
  fetchParams,
  type ChainEvent,
  type ParamChange,
} from "@/lib/inspector-data";
import { useCursorPages } from "@/lib/pagination";
import type { EvidenceDescriptor } from "@/lib/evidence";
import { AddressMono } from "@/components/AddressMono";
import { RefusedTag } from "@/components/RefusedTag";
import { Stampline, StampItem } from "@/components/Stampline";
import { InspectorPositionCard } from "./InspectorPositionCard";
import { InspectorHistory, type HistoryState } from "./InspectorHistory";
import { InspectorActivity } from "./InspectorActivity";
import { EvidenceDrawer } from "@/components/EvidenceDrawer";
import styles from "../inspector.module.css";

type AddressState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; lookup: AddressLookup };

function describeLookupError(cause: unknown): string {
  if (cause instanceof UnavailableError) {
    return "no servable batch: the service refuses to answer from nothing (503)";
  }
  if (cause instanceof RateLimitedError) {
    const retry = cause.retryAfterSeconds;
    return `rate limited (429)${retry === null ? "" : `, retry after ${String(retry)}s`}`;
  }
  if (cause instanceof ContractInvariantError) {
    return `the response contradicts its own contract, so it is not rendered (${cause.message})`;
  }
  if (cause instanceof SolventHttpError) {
    return `${String(cause.status)} ${cause.code}: ${cause.message}`;
  }
  return cause instanceof Error ? cause.message : String(cause);
}

export function InspectorSurface({ addr }: { addr: string }) {
  const valid = isAddress(addr);
  // Results are keyed by the address they answer FOR: a result for another
  // address is simply not this page's state (derived loading — no synchronous
  // setState-in-effect reset, and a stale answer can never leak across a
  // navigation).
  const [addressResult, setAddressResult] = useState<{ for: string; state: AddressState } | null>(null);
  const [historyResult, setHistoryResult] = useState<{ for: string; state: HistoryState } | null>(null);
  const [paramsByEngine, setParamsByEngine] = useState<Record<string, ParamChange[]>>({});
  const [paramsErrors, setParamsErrors] = useState<Record<string, string>>({});
  const [evidence, setEvidence] = useState<EvidenceDescriptor | null>(null);

  const addressState: AddressState =
    addressResult !== null && addressResult.for === addr ? addressResult.state : { status: "loading" };
  const historyState: HistoryState =
    historyResult !== null && historyResult.for === addr ? historyResult.state : { status: "loading" };

  // --- the position lookup (via @solvent/client's sealed outcome union) ---
  //
  // `keepOnFailure` (Wave R4) is for the RESUME re-fetch: a background
  // reconcile may not make the page worse than it found it. A woken laptop
  // whose network is not up yet must not trade a real position (rendered under
  // an age that is still climbing, and still true) for "lookup unavailable".
  // A FOREGROUND failure is still stated, in full — an error is not an answer.
  //
  // WAVE R6 (round-13 MEDIUM 2): AND IT REPORTS. `keepOnFailure` keeps a failed
  // background repair off the SCREEN; R5 also kept it from the age hook, so a
  // repair that never landed was indistinguishable from one that did, and an
  // age the clocks could not measure stood as if the wire had confirmed it.
  // This resolves TRUE only when a lookup was applied.
  const addressControllerRef = useRef<AbortController | null>(null);
  const loadAddress = useCallback(
    (options?: { keepOnFailure?: boolean }): Promise<boolean> => {
      if (!valid) return Promise.resolve(false);
      const keepOnFailure = options?.keepOnFailure ?? false;
      addressControllerRef.current?.abort();
      const controller = new AbortController();
      addressControllerRef.current = controller;
      return getSolventClient()
        .address(addr, controller.signal)
        .then(
          (lookup) => {
            // An ABORT is a supersession, not an answer: the request that
            // replaced this one reports for itself.
            if (controller.signal.aborted) return false;
            setAddressResult({ for: addr, state: { status: "ready", lookup } });
            return true;
          },
          (cause: unknown) => {
            if (controller.signal.aborted) return false;
            const failure = {
              for: addr,
              state: { status: "error" as const, message: describeLookupError(cause) },
            };
            setAddressResult((previous) =>
              keepOnFailure &&
              previous !== null &&
              previous.for === addr &&
              previous.state.status === "ready"
                ? previous
                : failure,
            );
            return false;
          },
        );
    },
    [addr, valid],
  );

  useEffect(() => {
    void loadAddress();
    return () => {
      addressControllerRef.current?.abort();
    };
  }, [loadAddress]);

  // Wave R3 (round-10 MEDIUM): THIS lookup's own batch age, anchored at
  // receipt and advanced on a minute tick — never a frozen number, and still
  // never a borrowed or implied as-of.
  //
  // Wave R4 (round-11 MEDIUM): and reconciled on RESUME against the wall clock
  // as well as the monotonic one, with a background re-fetch of THIS lookup —
  // the envelope that carries the age this page renders. Never another
  // surface's, and never a spinner over the number already on screen.
  const reloadAddressOnResume = useCallback(
    () => loadAddress({ keepOnFailure: true }),
    [loadAddress],
  );
  //
  // Wave R5 (round-12 MEDIUM): keyed to THIS lookup's receipt — its own
  // `served_at` with its own batch id — so a re-fetch that returns a fresher
  // batch at the same integer age re-anchors instead of inheriting the age the
  // previous receipt had accumulated.
  //
  // Wave R6 (round-13 MEDIUM 2): and on a BLIND resume — proven by the
  // lifecycle, measured by neither clock — this page stops stating an age it
  // cannot support. The position, the history and the activity all stay on
  // screen; only the age is withheld, and only until a receipt restores it.
  const age = useAnchoredAgeSeconds(
    addressState.status === "ready"
      ? {
          ageSeconds: addressState.lookup.response.batch.age_seconds,
          receiptId: receiptIdentity(
            addressState.lookup.response.served_at,
            addressState.lookup.response.batch.id,
          ),
        }
      : null,
    reloadAddressOnResume,
  );

  // --- HF history (same three-valued law, via lookup()) ---
  useEffect(() => {
    if (!valid) return;
    let cancelled = false;
    const controller = new AbortController();
    fetchAddressHistory(solventBaseUrl(), addr, { limit: 100, signal: controller.signal }).then(
      (lookup) => {
        if (!cancelled) setHistoryResult({ for: addr, state: { status: "ready", lookup } });
      },
      (cause: unknown) => {
        if (!cancelled) {
          setHistoryResult({ for: addr, state: { status: "error", message: describeLookupError(cause) } });
        }
      },
    );
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [addr, valid]);

  // --- param-timeline provenance, one fetch per engine with a position ---
  const readyLookup = addressState.status === "ready" ? addressState.lookup : null;
  useEffect(() => {
    if (readyLookup === null || readyLookup.outcome !== "found") return;
    const engines = [...new Set(readyLookup.response.positions.map((p) => p.engine))];
    let cancelled = false;
    const controller = new AbortController();
    for (const engine of engines) {
      fetchParams(solventBaseUrl(), { engine }, controller.signal).then(
        (response) => {
          if (cancelled) return;
          setParamsByEngine((previous) => ({ ...previous, [engine]: response.params }));
        },
        (cause: unknown) => {
          if (cancelled) return;
          setParamsErrors((previous) => ({
            ...previous,
            [engine]: cause instanceof Error ? cause.message : String(cause),
          }));
        },
      );
    }
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [readyLookup]);

  // --- address activity (cursor-paged) ---
  const fetchActivityPage = useCallback(
    async (cursor: string | null, signal: AbortSignal) => {
      const page = await fetchEvents(
        solventBaseUrl(),
        { account: addr, limit: 25, ...(cursor === null ? {} : { cursor }) },
        signal,
      );
      return { rows: page.events, nextCursor: page.next_cursor };
    },
    [addr],
  );
  const activity = useCursorPages<ChainEvent, string>(fetchActivityPage);
  const { loadMore: loadActivity } = activity;
  useEffect(() => {
    if (valid) loadActivity();
  }, [valid, loadActivity]);

  const closeEvidence = useCallback(() => {
    setEvidence(null);
  }, []);

  // --- the strict address law: an invalid segment is an inline refusal ---
  if (!valid) {
    return (
      <section>
        {/* Wave R1 item 6: the numbered eyebrow was chrome that told the
            reader nothing. Its slot becomes a real affordance — the way back
            to address entry. */}
        <p className={styles.backlink}>
          <Link className="mono" href="/inspector">
            ← Inspector
          </Link>
        </p>
        <h1>Inspector</h1>
        <p className={styles.refusal} role="alert" data-testid="address-refusal">
          REFUSED · &quot;{addr.slice(0, 64)}&quot; is not an address. The contract requires 0x +
          exactly 40 hex digits, verbatim. Nothing was looked up: an invalid input is never
          coerced into a different account.
        </p>
        <p style={{ marginTop: 14 }}>
          <Link className="mono" href="/inspector">
            ← back to address entry
          </Link>
        </p>
      </section>
    );
  }

  return (
    <section>
      <div className={styles.addrHead}>
        {/* Wave R1 item 6 — the eyebrow slot becomes navigation. */}
        <p className={styles.backlink} style={{ margin: 0 }}>
          <Link className="mono" href="/inspector">
            ← Inspector
          </Link>
        </p>
        <h1>
          <AddressMono address={addr} />
        </h1>
      </div>

      {/* FRESHNESS (Wave R1 item 3): the same line the Book carries, from
          THIS lookup's own envelope — never a borrowed or implied as-of. */}
      {/* W-3L: the outcome sentence, hoisted from FoundBlock to sit beside
          the address (one source: lookupTakeaway). The freshness line below
          it is the head's one-line method — THIS lookup's own envelope. */}
      {addressState.status === "ready" && (
        <p className={styles.outcomeTakeaway} data-testid="inspector-outcome">
          {lookupTakeaway(addressState.lookup)}
        </p>
      )}

      {addressState.status === "ready" && (
        <p className={styles.freshness} data-testid="inspector-freshness">
          {age.unresolved
            ? batchFreshnessLineUnknown(addressState.lookup.response.batch, age.refreshFailed)
            : batchFreshnessLine(addressState.lookup.response.batch, age.seconds ?? undefined)}
        </p>
      )}

      {addressState.status === "loading" && (
        <p className="mono dim">querying the newest servable batch…</p>
      )}

      {addressState.status === "error" && (
        <div className={`${styles.stateCard} ${styles.stateRefused}`} role="alert">
          <h2>lookup unavailable</h2>
          <p className="mono">{addressState.message}</p>
          <p className="mono dim">
            an error is not an answer: this is neither &quot;no position&quot; nor a position.
          </p>
        </div>
      )}

      {addressState.status === "ready" && <FoundBlock lookup={addressState.lookup} />}

      {addressState.status === "ready" && addressState.lookup.outcome === "found" && (
        <>
          {addressState.lookup.response.positions.map((position) => (
            <InspectorPositionCard
              key={`${position.engine}·${position.account}`}
              position={position}
              batch={addressState.lookup.response.batch}
              paramChanges={paramsByEngine[position.engine] ?? null}
              paramsError={paramsErrors[position.engine] ?? null}
              activity={activity.rows}
              onExplain={setEvidence}
            />
          ))}
          <Stampline>
            <StampItem
              label="batch"
              value={
                age.unresolved
                  ? batchFreshnessStampUnknown(
                      addressState.lookup.response.batch,
                      age.refreshFailed,
                    )
                  : batchFreshnessStamp(
                      addressState.lookup.response.batch,
                      age.seconds ?? undefined,
                    )
              }
            />
            <StampItem
              label="lookup"
              value={addressState.lookup.complete ? "complete" : "FLOOR"}
              tone={addressState.lookup.complete ? "ok" : "warn"}
            />
            {addressState.lookup.response.batch.watermarks.map((stamp) => (
              <StampItem
                key={stamp.engine}
                label={stamp.engine}
                value={`@${formatBlock(stamp.last_block)}`}
              />
            ))}
            {addressState.lookup.response.batch.supersession.superseded && (
              <StampItem label="posture" value="SUPERSEDED" tone="warn" />
            )}
          </Stampline>
        </>
      )}

      <InspectorHistory state={historyState} />

      <InspectorActivity
        events={activity.rows}
        loading={activity.loading}
        error={activity.error}
        hasMore={activity.hasMore}
        onLoadMore={activity.loadMore}
      />

      <EvidenceDrawer descriptor={evidence} onClose={closeEvidence} />
    </section>
  );
}

/** The three-valued page-level statement (plus the floor disclosure on found). */
function FoundBlock({ lookup }: { lookup: AddressLookup }) {
  // W-3L: the outcome sentence lives in the surface head (lookupTakeaway,
  // data-testid="inspector-outcome") — this block carries what remains:
  // the hazard boxes (FLOOR, the unknowable's withheld list), each arm's
  // one-line method, and the wire `note` behind a named disclosure. The
  // three arms keep three visual registers by law.
  switch (lookup.outcome) {
    case "found":
      return (
        <>
          {!lookup.complete && (
            <div className={`${styles.stateCard} ${styles.stateRefused}`} data-testid="found-floor">
              <p className="mono">
                FLOOR, not a total. These engines could not be consulted:{" "}
                {lookup.withheldEngines.map((refusal) => refusal.engine).join(", ")}. More positions
                may exist behind them.
              </p>
            </div>
          )}
        </>
      );
    case "not-found":
      return (
        <div className={styles.stateCard} data-testid="found-negative">
          <p>
            Here is what entitles the service to the definitive answer above: the lookup was{" "}
            <b>complete</b>, so every engine was available to be asked in batch{" "}
            <span className="mono">{String(lookup.response.batch.id)}</span>, and none withheld its
            book (withheld engines: none).
          </p>
          <details className={styles.noteDisclosure} data-testid="found-note">
            <summary>the wire&apos;s own note</summary>
            <p className="mono dim">{lookup.note}</p>
          </details>
        </div>
      );
    case "unknowable":
      return (
        <div className={`${styles.stateCard} ${styles.stateRefused}`} data-testid="found-unknowable">
          <p>
            The answer to &quot;does this address hold a position?&quot; cannot be established:
            an engine&apos;s whole book is withheld in the newest servable batch. This is a
            statement about the service&apos;s coverage, and it is NEVER the definitive negative.
          </p>
          <ul className={styles.withheldList}>
            {lookup.withheldEngines.map((refusal) => (
              <li key={refusal.engine}>
                <RefusedTag reason={`${refusal.engine} · ${refusal.code}`} />{" "}
                <span className="mono dim">{refusal.detail}</span>
              </li>
            ))}
          </ul>
          <details className={styles.noteDisclosure} data-testid="found-note">
            <summary>the wire&apos;s own note</summary>
            <p className="mono dim">{lookup.note}</p>
          </details>
        </div>
      );
  }
}
