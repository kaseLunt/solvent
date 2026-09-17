"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import {
  AddressField,
  ScenarioLibrary,
  StatusPill,
  VerdictHeader,
  type LibraryItem,
} from "@/components/kit";
import kit from "@/components/kit/kit.module.css";
import { useAddressLookup } from "@/lib/address-lookup";
import { isAddress, truncateAddress } from "@/lib/format";
import { humanAge } from "@/lib/freshness";
import { deriveInspectorView } from "@/lib/inspector-view";
import { CASH } from "@/lib/inspector-position";
import { addressWorkspace, rowOutcome } from "@/lib/lab-address";
import { deepLinkDecision } from "@/lib/lab-deep-link";
import { useLabReading } from "@/lib/lab-reading";
import { deriveLabView, type LabChip } from "@/lib/lab-view";
import { useAnchoredAgeSeconds } from "@/lib/live-age";
import { useMetaConstants } from "@/lib/meta";
import { resultReceipt } from "@/lib/resultIdentity";
import { AddressWorkspace } from "./AddressWorkspace";
import { AssumptionsDrawer } from "./AssumptionsDrawer";
import styles from "./lab.module.css";
import { LabTiles } from "./LabTiles";
import { LegacyResult } from "./LegacyResult";
import { MoversTable } from "./MoversTable";
import { StaleBanner } from "./StaleBanner";
import { TransitionCard } from "./TransitionCard";

type Mode = "book" | "address";

const PROJECTION = (
  <span data-testid="lab-projection">
    <StatusPill tone="projection">PROJECTION</StatusPill>
  </span>
);

function askedIds(raw: string | null): string[] {
  return raw === null
    ? []
    : raw
        .split(",")
        .map((id) => id.trim())
        .filter((id) => id !== "");
}

function labUrl(params: URLSearchParams): string {
  const query = params.toString();
  return query === "" ? "/lab" : `/lab?${query}`;
}

/**
 * The URL is this page's own state, written through the history API, which the
 * app router folds into `useSearchParams`. A router navigation onto the same
 * static route with other search params does not write the URL in production.
 */
function replaceUrl(url: string): void {
  window.history.replaceState(null, "", url);
}

export function LabSurface() {
  const params = useSearchParams();
  const reading = useLabReading();
  const meta = useMetaConstants();
  const linkedAddress = params.get("address");
  const [mode, setMode] = useState<Mode>(
    linkedAddress !== null ? "address" : "book",
  );
  const [selectedId, setSelectedId] = useState<string | null>(
    params.get("scenario"),
  );
  // `?scenarios=` pre-ticks its ids at mount; the listing later decides which of them may dispatch (the notice names the rest).
  const [checked, setChecked] = useState<ReadonlySet<string>>(
    () => new Set(askedIds(params.get("scenarios"))),
  );
  const [address, setAddress] = useState(linkedAddress ?? "");
  const [drawerOpen, setDrawerOpen] = useState(false);

  const view = deriveLabView(reading, { selectedId, checked });
  const book = view.book;
  const definition = book.definition;

  // One-address mode is the Inspector's reading. "" is not an address, so the hook fetches nothing until one is entered.
  const lookupFor = mode === "address" && isAddress(address) ? address : "";
  const addressReading = useAddressLookup(lookupFor);
  const inspectorView =
    mode === "address" && address !== ""
      ? deriveInspectorView(addressReading, meta.constants)
      : null;
  const space = addressWorkspace({
    address,
    view: inspectorView,
    selectedId: view.selectedId,
  });

  // The batch's own age (the wire's number) anchored at the clocks this tab settled the result on,
  // so a re-selected older result does not restart its age at the moment of re-selection.
  const identity = book.identity;
  const age = useAnchoredAgeSeconds(
    identity === null || book.run === null || book.receivedAt === null
      ? null
      : resultReceipt(identity, book.run.batch.age_seconds, book.receivedAt),
  );

  // Deep links are decided from the listing at render (the notice is derived, never stored) and dispatched once.
  const single = params.get("scenario");
  const decision =
    reading.listing.phase === "ready"
      ? deepLinkDecision(
          single,
          params.get("scenarios"),
          reading.listing.value.scenarios.map((s) => s.id),
        )
      : null;
  const notice =
    decision !== null &&
    (decision.kind === "set" || decision.kind === "conflict")
      ? decision.notice
      : null;
  const decided = useRef(false);
  useEffect(() => {
    if (
      decided.current ||
      decision === null ||
      reading.listing.phase !== "ready"
    )
      return;
    decided.current = true;
    const listed = reading.listing.value.scenarios.map((s) => s.id);
    if (
      decision.kind === "single" &&
      single !== null &&
      listed.includes(single)
    )
      reading.run(single);
    if (
      decision.kind === "set" &&
      !decision.overCap &&
      decision.runIds.length > 0
    )
      reading.runSet(decision.runIds);
  }, [decision, reading, single]);

  // No number while the age is unknown: an unresolved reading is not an age, and null is no receipt.
  const computed: LabChip | null =
    age.seconds === null
      ? null
      : age.unresolved
        ? { label: "Computed", value: "age unknown", tone: "warn" }
        : { label: "Computed", value: `${humanAge(age.seconds)} ago` };
  const chips: LabChip[] =
    computed === null
      ? book.chips
      : [...book.chips.slice(0, 2), computed, ...book.chips.slice(2)];
  const running = book.state === "running";
  const runLabel = definition === null ? "Run" : `Run ${definition.label}`;
  const kicker: ReactNode = (
    <>
      {mode === "book" ? (
        book.kicker
      ) : (
        <>
          Account{" "}
          <span className={kit.kickAddr}>
            {space.address === "" ? "—" : truncateAddress(space.address)}
          </span>{" "}
          · Cash
        </>
      )}{" "}
      {PROJECTION}
    </>
  );
  const busy =
    mode === "book"
      ? running || book.state === "listing-loading"
      : space.state === "loading";
  const cashResult = book.cash?.kind === "result" ? book.cash.result : null;
  const items: readonly LibraryItem[] =
    mode === "address"
      ? view.library.map((r) => ({
          ...r,
          outcome: rowOutcome(space.rows.find((x) => x.id === r.id)),
          checked: false,
        }))
      : view.library;

  return (
    <div
      className={styles.page}
      data-testid="lab-surface"
      data-mode={mode}
      data-state={mode === "book" ? book.state : space.state}
      data-banner={book.banner ?? undefined}
      aria-busy={busy ? "true" : undefined}
    >
      <div className={styles.libCol}>
        <ScenarioLibrary
          testId="lab-library"
          mode={mode}
          onMode={(m) => {
            setMode(m);
            const next = new URLSearchParams(params.toString());
            if (m === "book") next.delete("address");
            else if (address !== "") next.set("address", address);
            replaceUrl(labUrl(next));
          }}
          items={items}
          onSelect={setSelectedId}
          onCheck={(id, on) =>
            setChecked((prev) => {
              const next = new Set(prev);
              if (on) next.add(id);
              else next.delete(id);
              return next;
            })
          }
          addressSlot={
            mode === "address" ? (
              <AddressField
                testId="lab-address"
                initial={address}
                hint="any 0x address"
                onInspect={(addr) => {
                  setAddress(addr);
                  const next = new URLSearchParams(params.toString());
                  next.set("address", addr);
                  replaceUrl(labUrl(next));
                }}
              />
            ) : undefined
          }
          run={
            mode === "book"
              ? {
                  label: runLabel,
                  disabled: definition === null || running,
                  onRun: () => {
                    if (definition !== null) reading.run(definition.id);
                  },
                }
              : undefined
          }
          compare={null}
          emptyText={
            book.state === "listing-loading"
              ? "Loading the committed scenarios…"
              : book.state === "listing-unavailable"
                ? book.headline.emphasis
                : "No committed scenarios are listed."
          }
          footnote={`Committed, versioned scenarios${view.configVersion === null ? "" : ` (config ${view.configVersion})`}. No sliders — every result is reproducible.`}
        />
      </div>
      <div className={styles.workspace}>
        {notice !== null && (
          <p className={styles.notice} data-testid="lab-deeplink-notice">
            {notice}
          </p>
        )}
        {mode === "address" ? (
          <AddressWorkspace space={space} kicker={kicker} />
        ) : (
          <>
            <VerdictHeader
              testId="lab-verdict"
              kicker={kicker}
              emphasis={book.headline.emphasis}
              rest={book.headline.rest}
              tone={book.headline.tone}
              dek={book.headline.dek}
              chips={chips}
              actions={
                book.run !== null ? (
                  <button
                    type="button"
                    className={`${kit.btn} ${kit.btnGhost}`}
                    onClick={() => setDrawerOpen(true)}
                    data-testid="lab-drawer"
                  >
                    Assumptions · Out of model
                  </button>
                ) : undefined
              }
            />
            {book.banner !== null && definition !== null && (
              <StaleBanner
                kind={book.banner}
                skew={book.skew}
                batchId={book.run?.batch.id ?? null}
                failure={book.rerunFailure}
                heldCondition={book.heldCondition}
                retained={book.retained}
                onRerun={() => reading.run(definition.id)}
                rerunDisabled={running}
              />
            )}
            <LabTiles
              reading={book.cash}
              pending={running}
              testPrefix="lab-kpi"
            />
            <TransitionCard reading={book.cash} engine={CASH} />
            {cashResult !== null && <MoversTable table={cashResult.movers} />}
            {book.legacy !== null && <LegacyResult reading={book.legacy} />}
            <AssumptionsDrawer
              open={drawerOpen}
              onClose={() => setDrawerOpen(false)}
              run={book.run}
              cash={cashResult}
            />
          </>
        )}
      </div>
    </div>
  );
}
