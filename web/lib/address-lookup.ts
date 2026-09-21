// web/lib/address-lookup.ts
"use client";

// The Inspector's data seam (spec 2026-09-15 §5.3). Every result is keyed by
// the address it answers FOR — a result for another address is simply not
// this page's state — and the position lookup is repaired on resume with its
// own envelope: a resumed tab never shows an age it cannot anchor, and a
// failed background repair never blanks a rendered position. The surface is
// mounted with key={addr} as well; the keying here is the second lock.
import { useCallback, useEffect, useRef, useState } from "react";
import type { AddressLookup, HistoryLookup, StressLookup } from "@solvent/client";
import { getSolventClient, solventBaseUrl } from "./api";
import type { EvidenceManifest } from "./evidence";
import { isAddress } from "./format";
import { receiptIdentity } from "./freshness";
import { fetchAddressHistory, fetchEvents, fetchParams, type ChainEvent, type ParamChange } from "./inspector-data";
import { evidenceReadAt, type EvidencePhase, type EvidenceSettled } from "./inspector-evidence";
import { CASH } from "./inspector-position";
import { useAnchoredAgeSeconds, type LiveAgeReading } from "./live-age";
import { describeLookupError } from "./lookup-error";
import { useCursorPages, type CursorPages } from "./pagination";

export type Phase<T> =
  | { readonly phase: "loading" }
  | { readonly phase: "error"; readonly message: string }
  | { readonly phase: "ready"; readonly value: T };

export interface AddressReading {
  readonly address: string;
  readonly valid: boolean;
  readonly lookup: Phase<AddressLookup>;
  readonly history: Phase<HistoryLookup>;
  readonly stress: Phase<StressLookup>;
  readonly params: Phase<readonly ParamChange[]>;
  /** The manifest that answered; null while its read is in flight AND after it failed — `evidencePhase` tells the two apart. */
  readonly evidence: EvidenceManifest | null;
  /**
   * The evidence read's phase: in flight, failed, or answered. A read in flight has not failed, so the two nulls
   * above are never worded alike. Null only when no read was asked (an address that is not valid); such a reading is
   * read by what it holds (`evidenceReadOf`).
   */
  readonly evidencePhase: EvidencePhase | null;
  readonly age: LiveAgeReading;
  readonly reload: () => void;
  /**
   * The lookup on the page was landed by a resume repair. A repair refreshes the position alone and replays no
   * stress, so a stress beside a repaired lookup was read for the lookup before it.
   */
  readonly lookupRepaired: boolean;
}

/** `repaired`: a background repair landed this result — it rode no load epoch, so nothing keyed by the epoch was replayed with it. */
type Keyed<T> = { readonly for: string; readonly state: Phase<T>; readonly repaired?: boolean } | null;
const LOADING = { phase: "loading" } as const;

function forAddress<T>(keyed: Keyed<T>, addr: string): Phase<T> {
  return keyed !== null && keyed.for === addr ? keyed.state : LOADING;
}

/** One address-keyed fetch. `fetcher` must be referentially stable per address (useCallback on addr). */
function useKeyedFetch<T>(addr: string, enabled: boolean, epoch: number, fetcher: (signal: AbortSignal) => Promise<T>): Phase<T> {
  const [result, setResult] = useState<Keyed<T>>(null);
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    fetcher(controller.signal).then(
      (value) => {
        if (!controller.signal.aborted) setResult({ for: addr, state: { phase: "ready", value } });
      },
      (cause: unknown) => {
        if (!controller.signal.aborted) setResult({ for: addr, state: { phase: "error", message: describeLookupError(cause) } });
      },
    );
    return () => {
      controller.abort();
    };
  }, [addr, enabled, epoch, fetcher]);
  return enabled ? forAddress(result, addr) : LOADING;
}

const fetchCashParams = async (signal: AbortSignal): Promise<readonly ParamChange[]> =>
  (await fetchParams(solventBaseUrl(), { engine: CASH }, signal)).params;

export function useAddressLookup(addr: string): AddressReading {
  const valid = isAddress(addr);
  const [epoch, setEpoch] = useState(0);
  const [lookupResult, setLookupResult] = useState<Keyed<AddressLookup>>(null);
  // The evidence read that last SETTLED, with the epoch it was asked in: what the page is told is derived from it
  // and the current epoch, so a read in flight is never stored — or worded — as a failure.
  const [evidenceSettled, setEvidenceSettled] = useState<EvidenceSettled | null>(null);
  const controllerRef = useRef<AbortController | null>(null);
  /** The load currently in flight, if any. A resume repair rides it rather than aborting it. */
  const inFlightRef = useRef<Promise<boolean> | null>(null);

  const loadLookup = useCallback(
    (options?: { keepOnFailure?: boolean }): Promise<boolean> => {
      if (!valid) return Promise.resolve(false);
      const keepOnFailure = options?.keepOnFailure ?? false;
      // A repair never supersedes a load already under way: that load's own outcome (true when it lands,
      // false on its own failure) is the repair's answer. A foreground call still aborts and starts fresh.
      if (keepOnFailure && inFlightRef.current !== null) return inFlightRef.current;
      controllerRef.current?.abort();
      const controller = new AbortController();
      controllerRef.current = controller;
      const request: Promise<boolean> = getSolventClient()
        .address(addr, controller.signal)
        .then(
          (value) => {
            // An abort is a supersession, not an answer: the request that replaced this one reports for itself.
            if (controller.signal.aborted) return false;
            setLookupResult({ for: addr, state: { phase: "ready", value }, repaired: keepOnFailure });
            return true;
          },
          (cause: unknown) => {
            if (controller.signal.aborted) return false;
            const failure: Keyed<AddressLookup> = { for: addr, state: { phase: "error", message: describeLookupError(cause) } };
            // A failed BACKGROUND repair never replaces a rendered position; a foreground failure is stated in full.
            setLookupResult((previous) =>
              keepOnFailure && previous !== null && previous.for === addr && previous.state.phase === "ready" ? previous : failure,
            );
            return false;
          },
        );
      inFlightRef.current = request;
      void request.finally(() => {
        // Only the request still on the ref clears it: a superseded request must not erase its successor.
        if (inFlightRef.current === request) inFlightRef.current = null;
      });
      return request;
    },
    [addr, valid],
  );

  useEffect(() => {
    void loadLookup();
    return () => {
      controllerRef.current?.abort();
    };
  }, [loadLookup, epoch]);

  const lookup = forAddress(lookupResult, addr);
  const lookupRepaired = lookupResult !== null && lookupResult.for === addr && lookupResult.repaired === true;
  const ready = lookup.phase === "ready" ? lookup.value : null;
  const hasCash = ready !== null && ready.outcome === "found" && ready.response.positions.some((p) => p.engine === CASH);

  const fetchHistory = useCallback((signal: AbortSignal) => fetchAddressHistory(solventBaseUrl(), addr, { limit: 100, signal }), [addr]);
  const fetchStress = useCallback((signal: AbortSignal) => getSolventClient().addressStress(addr, signal), [addr]);
  const history = useKeyedFetch(addr, valid, epoch, fetchHistory);
  const stress = useKeyedFetch(addr, valid, epoch, fetchStress);
  const params = useKeyedFetch(addr, hasCash, epoch, fetchCashParams);

  // Book-level, not address-keyed: the committed reconcile receipt behind the Trust card's last item.
  // Not fetched on the invalid-address page. The read is a PHASE — in flight, failed, answered — and each settles
  // under the epoch that asked it. A failed fetch that was NOT aborted replaces the manifest: a reload() whose
  // receipt fetch fails must not leave the previous receipt standing as current — the Trust item reads "receipt
  // unavailable" then, and only then. While a read is in flight the item is pending; a manifest already on the page
  // stands until the re-read answers or fails. A resume repair re-asks the lookup alone, never this read, so it
  // cannot move the item.
  useEffect(() => {
    if (!valid) return;
    const controller = new AbortController();
    getSolventClient()
      .evidence(controller.signal)
      .then(
        (manifest) => {
          if (!controller.signal.aborted) setEvidenceSettled({ epoch, read: { phase: "answered", manifest } });
        },
        () => {
          if (!controller.signal.aborted) setEvidenceSettled({ epoch, read: { phase: "failed" } });
        },
      );
    return () => {
      controller.abort();
    };
  }, [epoch, valid]);
  const evidenceRead = evidenceReadAt(evidenceSettled, epoch);
  const evidence = evidenceRead.phase === "answered" ? evidenceRead.manifest : null;

  const repair = useCallback(() => loadLookup({ keepOnFailure: true }), [loadLookup]);
  const age = useAnchoredAgeSeconds(
    ready === null
      ? null
      : { ageSeconds: ready.response.batch.age_seconds, receiptId: receiptIdentity(ready.response.served_at, ready.response.batch.id) },
    repair,
  );
  const reload = useCallback(() => {
    setEpoch((e) => e + 1);
  }, []);

  // An invalid address asks for nothing, so its reading states no evidence phase: nothing is in flight to be pending.
  const evidencePhase = valid ? evidenceRead.phase : null;
  return { address: addr, valid, lookup, history, stress, params, evidence, evidencePhase, age, reload, lookupRepaired };
}

/** Cursor-paged activity for one address. Mount the consumer with key={addr}: a fresh mount can never hold another address's rows. */
export function useAddressActivity(addr: string, valid: boolean): CursorPages<ChainEvent> {
  const fetchPage = useCallback(
    async (cursor: string | null, signal: AbortSignal) => {
      const page = await fetchEvents(solventBaseUrl(), { account: addr, limit: 25, ...(cursor === null ? {} : { cursor }) }, signal);
      return { rows: page.events, nextCursor: page.next_cursor };
    },
    [addr],
  );
  const pages = useCursorPages<ChainEvent, string>(fetchPage);
  const { loadMore } = pages;
  const startedRef = useRef(false);
  useEffect(() => {
    if (!valid || startedRef.current) return;
    startedRef.current = true;
    loadMore();
  }, [valid, loadMore]);
  return pages;
}
