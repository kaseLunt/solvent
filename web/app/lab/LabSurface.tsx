"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter, useSearchParams } from "next/navigation";
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
import { addressWorkspace } from "@/lib/lab-address";
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

export function LabSurface() {
  const params = useSearchParams();
  const router = useRouter();
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

  // The result's own age, anchored to its receipt; the chip ticks from the moment the run settled.
  const identity = book.identity;
  const age = useAnchoredAgeSeconds(
    identity === null ? null : resultReceipt(identity, 0),
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

  const computed: LabChip = {
    label: "Computed",
    value: `${humanAge(age.seconds ?? 0)} ago`,
  };
  const chips: LabChip[] =
    identity === null
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
          outcome: {
            key: "not-run",
            text: space.rows.some((x) => x.id === r.id)
              ? "Applies to this address"
              : "Not on this address",
            tone: "dim",
          },
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
            router.replace(labUrl(next));
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
                  router.replace(labUrl(next));
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
                onRerun={() => reading.run(definition.id)}
                rerunDisabled={running}
              />
            )}
            <LabTiles
              reading={book.cash}
              pending={running}
              testPrefix="lab-kpi"
            />
            <TransitionCard reading={book.cash} />
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
