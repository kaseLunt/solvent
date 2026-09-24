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
import { isAddress } from "@/lib/format";
import { humanAge } from "@/lib/freshness";
import { ADDRESS_HINT, deriveInspectorView, PROJECTION_TITLE, PROJECTION_WORD } from "@/lib/inspector-view";
import { CASH } from "@/lib/inspector-position";
import { addressWorkspace, rowOutcome } from "@/lib/lab-address";
import { compareHeadline } from "@/lib/lab-compare";
import { scenarioName } from "@/lib/lab-library";
import {
  conflictNotice,
  deepLinkDecision,
  scenarioForBar,
  unlistedScenarioNotice,
} from "@/lib/lab-deep-link";
import { useLabReading } from "@/lib/lab-reading";
import {
  addressKicker,
  ASSUMPTIONS_BUTTON,
  COMPARE_KICKER,
  compareChips,
  compareControl,
  deriveLabView,
  LIBRARY_EMPTY,
  LIBRARY_LOADING,
  libraryFootnote,
  runLabel,
  tileAbsence,
  type LabChip,
  type LabKicker,
} from "@/lib/lab-view";
import { useAnchoredAgeSeconds } from "@/lib/live-age";
import { useMetaConstants } from "@/lib/meta";
import { resultReceipt } from "@/lib/resultIdentity";
import { AddressWorkspace } from "./AddressWorkspace";
import { AssumptionsDrawer } from "./AssumptionsDrawer";
import { CompareCard, comparedViews, plotRowsOf } from "./CompareCard";
import styles from "./lab.module.css";
import { LabTiles } from "./LabTiles";
import { LegacyCompare } from "./LegacyCompare";
import { LegacyResult } from "./LegacyResult";
import { MoversTable } from "./MoversTable";
import { StaleBanner } from "./StaleBanner";
import { TransitionCard } from "./TransitionCard";

type Mode = "book" | "address";

const PROJECTION = (
  <span data-testid="lab-projection">
    <StatusPill tone="projection" title={PROJECTION_TITLE}>
      {PROJECTION_WORD}
    </StatusPill>
  </span>
);

/** A kicker whose scenario name keeps its own case (weETH, sETHFI) under the kicker's capitals. */
function kickerOf(k: LabKicker): ReactNode {
  return k.name === null ? (
    k.scope
  ) : (
    <>
      <span className={kit.kickCase}>{k.name}</span> · {k.scope}
    </>
  );
}

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

/** The link this page was OPENED with: its two scenario params as they arrived, before the page wrote anything of its own. */
interface InboundLink {
  readonly single: string | null;
  readonly set: string | null;
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
  // A deep link is the link somebody opened, so it is read once, at mount. The page goes on to write its own URL —
  // a selection names itself there — and its own writes are never a link to decide again or to word a notice about.
  const [inbound] = useState<InboundLink>(() => ({
    single: params.get("scenario"),
    set: params.get("scenarios"),
  }));
  // Whether the reader has selected a scenario since the page opened: only then does the bar follow the subject shown.
  const [readerSelected, setReaderSelected] = useState(false);
  // Which answer the page leads with: the selected scenario's run, or the comparison. Asking for a comparison — the
  // Compare button, or a link that names a set — leads with it; selecting or running a scenario leads with that run.
  const [focus, setFocus] = useState<"single" | "compare">(() => (params.get("scenarios") !== null && params.get("scenario") === null ? "compare" : "single"));

  const view = deriveLabView(reading, { selectedId, checked });
  const compareButton = compareControl(view);
  const book = view.book;
  const definition = book.definition;

  // One-address mode is the Inspector's reading. "" is not an address, so the hook fetches nothing until one is entered.
  const lookupFor = mode === "address" && isAddress(address) ? address : "";
  const addressReading = useAddressLookup(lookupFor);
  const inspectorView =
    mode === "address" && address !== ""
      ? deriveInspectorView(addressReading, meta.constants)
      : null;
  // The scenario the reader or the link NAMED, as the listing resolved it: a name the listing does not publish names
  // nothing, and with no name there is nothing to disclose a fallback from.
  const named =
    selectedId !== null && definition !== null && definition.id === selectedId
      ? { id: definition.id, label: scenarioName(definition) }
      : null;
  const space = addressWorkspace({
    address,
    view: inspectorView,
    selectedId: view.selectedId,
    named,
  });

  // The subject the workspace SHOWS: book mode's selection as the listing resolved it, and one-address mode's
  // selected row — which is NOT the row clicked when the address was not stressed under it, and not the id a link
  // named when the listing does not publish it. The address bar is written only for a scenario somebody asked for
  // (`scenarioForBar`): after the reader's own selection it follows the subject shown; an OPENED link is left exactly
  // as it arrived, the mismatch said in words beside it — a rewritten `?scenario=` link would run, on reload, a
  // scenario nobody asked for. In one-address mode the account the page shows is held in the bar the same way: it is
  // the link's own or the reader's entry, never a default. The write is `replaceState`, read against the live
  // address bar, so a same-route navigation that drops the query is put right too.
  const subjectId =
    mode === "book" ? view.selectedId : (space.selected?.id ?? null);
  useEffect(() => {
    // This page writes its own route's URL and no other: mid-navigation the bar may already name another route.
    if (window.location.pathname !== "/lab") return;
    const next = new URLSearchParams(window.location.search);
    const before = next.toString();
    const scenario = scenarioForBar({
      inboundScenario: inbound.single,
      readerSelected,
      subjectId,
      barScenario: next.get("scenario"),
    });
    if (scenario !== null) next.set("scenario", scenario);
    if (
      mode === "address" &&
      isAddress(address) &&
      next.get("address") !== address
    )
      next.set("address", address);
    if (next.toString() !== before) replaceUrl(labUrl(next));
  }, [params, inbound, readerSelected, subjectId, mode, address]);

  // The batch's own age (the wire's number) anchored at the clocks this tab settled the result on,
  // so a re-selected older result does not restart its age at the moment of re-selection.
  const identity = book.identity;
  const age = useAnchoredAgeSeconds(
    identity === null || book.run === null || book.receivedAt === null
      ? null
      : resultReceipt(identity, book.run.batch.age_seconds, book.receivedAt),
  );

  // The inbound link is decided from the listing at render (the notice is derived, never stored) and dispatched once.
  const single = inbound.single;
  const decision =
    reading.listing.phase === "ready"
      ? deepLinkDecision(
          single,
          inbound.set,
          reading.listing.value.scenarios.map((s) => s.id),
        )
      : null;
  // The conflict's notice claims only what the conflict gates — the book run — and says so when an address is being
  // evaluated on the page beside it: that evaluation is the address lookup's own, and is shown. A single link whose
  // id the listing does not publish is left as it arrived and said in words: what it named, and what is shown instead.
  const listedIds =
    reading.listing.phase === "ready"
      ? reading.listing.value.scenarios.map((s) => s.id)
      : [];
  const shownLabel =
    mode === "book"
      ? (definition === null ? null : scenarioName(definition))
      : (space.selected?.name ?? null);
  const notice =
    decision === null
      ? null
      : decision.kind === "conflict"
        ? conflictNotice(mode === "address" && isAddress(address))
        : decision.kind === "set"
          ? decision.notice
          : decision.kind === "single"
            ? unlistedScenarioNotice(single, listedIds, shownLabel)
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
  const name = definition === null ? null : scenarioName(definition);
  const run = () => {
    if (definition === null) return;
    setFocus("single");
    reading.run(definition.id);
  };
  const account = addressKicker(space.address);
  const kicker: ReactNode = (
    <>
      {mode === "book" ? (
        kickerOf(book.kicker)
      ) : (
        <>
          {account.lead} {account.address !== null && <span className={kit.kickAddr}>{account.address}</span>} · {account.scope}
        </>
      )}{" "}
      {PROJECTION}
    </>
  );
  // The comparison leads the page only once a set has settled: while one runs, the single run's answer stays above its card.
  const settledSet = comparedViews(view.compare);
  const compared = focus === "compare" ? settledSet : null;
  const compareAnswer = compared === null ? null : compareHeadline(compared.cash);
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
          // The highlight follows the subject the workspace shows, never the listing's selection alone: a linked
          // scenario the address was not stressed under falls back to the first row, and the highlight with it.
          selected: r.id === (space.selected?.id ?? null),
        }))
      : view.library;

  return (
    <div
      className={styles.page}
      data-testid="lab-surface"
      data-mode={mode}
      data-state={mode === "book" ? book.state : space.state}
      data-banner={book.banner ?? undefined}
      data-view={mode === "book" && compared !== null ? "compare" : "single"}
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
          onSelect={(id) => {
            setSelectedId(id);
            setReaderSelected(true);
            setFocus("single");
            // The address bar names the subject on screen, so a reload or a shared link opens the scenario the
            // reader was looking at — never the one the page was opened with. One URL names one scenario or a set,
            // never both (a link naming both runs nothing), so the selection takes the set's place in it.
            const next = new URLSearchParams(params.toString());
            next.set("scenario", id);
            next.delete("scenarios");
            replaceUrl(labUrl(next));
          }}
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
                hint={ADDRESS_HINT}
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
                  label: runLabel(name),
                  disabled: definition === null || running,
                  onRun: run,
                }
              : undefined
          }
          compare={
            mode === "book"
              ? {
                  ...compareButton,
                  onCompare: () => {
                    setFocus("compare");
                    reading.runSet(view.checked);
                  },
                }
              : null
          }
          emptyText={
            book.state === "listing-loading"
              ? LIBRARY_LOADING
              : book.state === "listing-unavailable" ||
                  book.state === "listing-unreadable"
                ? book.headline.emphasis
                : LIBRARY_EMPTY
          }
          footnote={libraryFootnote(view.configVersion)}
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
        ) : compared !== null && compareAnswer !== null ? (
          <>
            {/* The comparison's answer: its own identity — the set run's batch, config and computed instant, never the single run's. */}
            <VerdictHeader
              testId="lab-verdict"
              kicker={
                <>
                  {kickerOf(COMPARE_KICKER)} {PROJECTION}
                </>
              }
              emphasis={compareAnswer.emphasis}
              rest={compareAnswer.rest}
              tone={compareAnswer.tone}
              dek={compareAnswer.dek}
              chips={compareChips(compared.cash)}
            />
            <CompareCard state={view.compare} />
            {/* The legacy market's shares: its own fold, after all Cash content, on its own axis. */}
            {compared.legacy.rows.length > 0 && <LegacyCompare rows={plotRowsOf(compared.legacy)} />}
          </>
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
                definition !== null ? (
                  <>
                    {/* Served and not run: the way to run it stands beside the sentence that asks for it. */}
                    {book.state === "not-run" && (
                      <button type="button" className={`${kit.btn} ${kit.btnPrimary}`} onClick={run} data-testid="lab-header-run">
                        {runLabel(name)}
                      </button>
                    )}
                    <button type="button" className={`${kit.btn} ${kit.btnGhost}`} onClick={() => setDrawerOpen(true)} data-testid="lab-drawer">
                      {ASSUMPTIONS_BUTTON}
                    </button>
                  </>
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
                onRerun={run}
                rerunDisabled={running}
              />
            )}
            <LabTiles reading={book.cash} absence={tileAbsence(book, book.cash)} testPrefix="lab-kpi" />
            <TransitionCard reading={book.cash} engine={CASH} />
            {cashResult !== null && <MoversTable table={cashResult.movers} engine={CASH} />}
            {(view.compare.kind !== "idle" || view.checked.length >= 2) && (
              <CompareCard state={view.compare} />
            )}
            {book.legacy !== null && <LegacyResult reading={book.legacy} book={book} />}
            {/* The set's legacy shares never vanish when the focus returns to the run: they follow all Cash content, after the run's own legacy fold. */}
            {settledSet !== null && settledSet.legacy.rows.length > 0 && <LegacyCompare rows={plotRowsOf(settledSet.legacy)} />}
            <AssumptionsDrawer
              open={drawerOpen}
              onClose={() => setDrawerOpen(false)}
              definition={definition}
              notRun={book.state === "not-run"}
              run={book.run}
              cash={cashResult}
            />
          </>
        )}
      </div>
    </div>
  );
}
