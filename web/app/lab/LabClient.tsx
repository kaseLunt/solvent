"use client";

// The Scenarios surface's shell (Wave W-SD-A, ruling item 1).
//
// TWO THINGS DIED HERE, both for the same reason.
//
//   `pickDefaultScenario` — it chose the default chip by scanning an address
//   run's RESULTS for a market-realization axis. That made the default a
//   property of whichever address somebody had just typed. The committed set
//   has its own wire order, served cold; the first member of that order is the
//   default, and the reader picks from there.
//
//   THE HARVEST — the committed list used to be read out of an address stress
//   response, so whole-book view stayed empty until an address run happened.
//   `GET /v1/scenarios` serves the same definitions COLD, with no batch
//   envelope at all. Book mode now reads them itself and no longer depends on
//   the address tool for anything.
//
// BOOK MODE IS THE DEFAULT and arrives alive. Address mode still exists, is
// still reachable in one click, and is explicitly the SECONDARY register: one
// account is a narrower question than the whole book, and the surface now says
// so in its ordering.

import { useCallback, useEffect, useRef, useState } from "react";
import {
  BadRequestError,
  ContractInvariantError,
  RateLimitedError,
  SchemaVersionMismatchError,
  SolventError,
  SolventHttpError,
  SolventNetworkError,
  UnavailableError,
  type RefinedScenario,
  type StressLookup,
} from "@solvent/client";
import { EngineChip } from "@/components/EngineChip";
import { RefusedTag } from "@/components/RefusedTag";
import { getSolventClient } from "@/lib/api";
import { isAddress, renderLookupOutcome } from "@/lib/format";
import { LabBatchStamp } from "./LabBatchStamp";
import { LabBookPanel, bookDekFor, type BookState } from "./LabBookPanel";
import { LabBoundaryGroup } from "./LabBoundaryGroup";
import { LabScenarioChips } from "./LabScenarioChips";
import { LabScenarioDetail } from "./LabScenarioDetail";
import styles from "./lab.module.css";

type Mode = "address" | "book";

type StressPhase =
  | { status: "idle" }
  | { status: "loading"; addr: string }
  | { status: "done"; addr: string; result: StressLookup }
  | { status: "error"; addr: string; message: string };

function describeError(error: unknown): string {
  if (error instanceof UnavailableError) {
    return "no complete risk batch is available (503). That is a statement about the SERVICE, never an empty book";
  }
  if (error instanceof RateLimitedError) {
    return error.retryAfterSeconds !== null
      ? `rate limited (429), and the service says retry after ${String(error.retryAfterSeconds)}s`
      : "rate limited (429), and the service did not say when to retry";
  }
  if (error instanceof BadRequestError) {
    return `the service refused the request (400): ${error.message}`;
  }
  if (error instanceof SolventNetworkError) {
    return `the API could not be reached (${error.timedOut ? "client timeout" : "no HTTP response"}), which says nothing about the address`;
  }
  if (error instanceof ContractInvariantError) {
    return `refusing to render: the response contradicts itself. ${error.message}`;
  }
  if (error instanceof SchemaVersionMismatchError) {
    return `refusing to render: ${error.message}`;
  }
  if (error instanceof SolventHttpError) {
    return `the service answered ${String(error.status)}: ${error.message}`;
  }
  if (error instanceof SolventError) return error.message;
  return error instanceof Error ? error.message : "unknown failure";
}

export function LabClient() {
  // BOOK IS THE DEFAULT. Whole-book view is the primary question this surface
  // answers, and it no longer depends on anything in address mode.
  const [mode, setMode] = useState<Mode>("book");
  const [input, setInput] = useState("");
  const [phase, setPhase] = useState<StressPhase>({ status: "idle" });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const requestSeq = useRef(0);

  // W-3L (inventory 152): the book state lives HERE now, so the computed dek
  // — the surface's answer — renders at the page head, above the mode bar,
  // in BOTH modes. LabBookPanel receives the same state and renders the
  // frontier from it; the sentence and the chart read one fetch.
  const [book, setBook] = useState<BookState>({ phase: "loading" });
  useEffect(() => {
    const controller = new AbortController();
    getSolventClient()
      .book(controller.signal)
      .then(
        (response) => {
          setBook({ phase: "ok", book: response });
        },
        (cause: unknown) => {
          if (controller.signal.aborted) return;
          setBook(
            cause instanceof UnavailableError
              ? { phase: "no-batch", message: cause.body.error.message }
              : {
                  phase: "error",
                  message: cause instanceof Error ? cause.message : String(cause),
                },
          );
        },
      );
    return () => {
      controller.abort();
    };
  }, []);

  const inputValid = isAddress(input);

  /**
   * The per-address scenarios AS THE WIRE SERVED THEM, for the address panel
   * only. Book mode does NOT read this — it reads the committed listing from
   * `GET /v1/scenarios` itself. This array is a property of the lookup, and
   * nothing outside the lookup's own panel depends on it.
   */
  const committed: readonly RefinedScenario[] =
    phase.status === "done" ? phase.result.response.scenarios : [];

  // The default chip is the committed set's OWN first member, in wire order —
  // never chosen by scanning results for a shape we happen to like.
  const activeId = selectedId ?? committed[0]?.id ?? null;
  const activeScenario = committed.find((scenario) => scenario.id === activeId) ?? null;

  const submit = useCallback(async () => {
    if (!isAddress(input)) return;
    const addr = input;
    const seq = (requestSeq.current += 1);
    setPhase({ status: "loading", addr });
    setSelectedId(null);
    try {
      const result = await getSolventClient().addressStress(addr);
      if (requestSeq.current === seq) setPhase({ status: "done", addr, result });
    } catch (error) {
      if (requestSeq.current === seq) {
        setPhase({ status: "error", addr, message: describeError(error) });
      }
    }
  }, [input]);

  return (
    <>
      {/* W-3L (inventory 152): the hoisted dek — the cliff sentence is the
          surface's answer and sits under the H1, above the mode bar. Every
          caveat clause labDek appends travels with it (the sentence is
          relocated whole, never truncated). */}
      {/* W-3L (inventory 152): the hoisted dek — the cliff sentence is the
          surface's answer and sits under the H1, above the mode bar. Every
          caveat clause labDek appends travels with it (the sentence is
          relocated whole, never truncated). */}
      <p className={styles.dek} data-testid="lab-dek">
        {bookDekFor(book)}
      </p>

      <div className={styles.modeBar} role="group" aria-label="run mode">
        <button
          type="button"
          className={styles.modeButton}
          aria-pressed={mode === "book"}
          data-testid="mode-book"
          onClick={() => {
            setMode("book");
          }}
        >
          whole book
        </button>
        <button
          type="button"
          className={`${styles.modeButton} ${styles.modeButtonSecondary}`}
          aria-pressed={mode === "address"}
          data-testid="mode-address"
          onClick={() => {
            setMode("address");
          }}
        >
          one address
        </button>
        <span className={styles.modeCaption} data-testid="mode-caption">
          whole book is the default view; one address is the secondary register, a narrower
          question, answered from the same committed set
        </span>
      </div>

      {mode === "book" ? (
        <section aria-label="book-wide stress">
          <LabBookPanel book={book} />
        </section>
      ) : (
        <section aria-label="address stress" data-testid="lab-address-section">
          <p className={styles.secondaryNote} data-testid="address-secondary-note">
            SECONDARY REGISTER · one account, not the book. The committed scenario set below is
            the same one whole-book view renders; this panel evaluates it against a single
            address.
          </p>
          <form
            className={styles.addressForm}
            onSubmit={(event) => {
              event.preventDefault();
              void submit();
            }}
          >
            <input
              className={styles.addressInput}
              data-testid="lab-address-input"
              value={input}
              onChange={(event) => {
                setInput(event.target.value.trim());
              }}
              placeholder="0x + 40 hex · the account to stress"
              aria-label="account address"
              spellCheck={false}
              autoComplete="off"
            />
            <button
              type="submit"
              className={styles.runButton}
              data-testid="run-stress-button"
              disabled={!inputValid || phase.status === "loading"}
            >
              run committed set
            </button>
            {input.length > 0 && !inputValid && (
              <span className={`${styles.hint} ${styles.hintBad}`} data-testid="address-hint">
                not an address: the contract requires 0x + exactly 40 hex digits, so nothing is
                sent until it matches
              </span>
            )}
          </form>

          {phase.status === "idle" && (
            <div className={styles.emptyState} data-testid="lab-idle">
              enter an address to run the COMMITTED scenario set against it · every scenario
              from <span className="mono">GET /v1/address/{"{addr}"}/stress</span>, evaluated
              from the newest servable batch&apos;s persisted rows. The scenario chips render
              from that response; no scenario list is hardcoded in this UI.
            </div>
          )}

          {phase.status === "loading" && (
            <p className={styles.pendingState}>
              running the committed set against <span className="mono">{phase.addr}</span> ·
              request in flight
            </p>
          )}

          {phase.status === "error" && (
            <div className={styles.errorState} data-testid="lab-error">
              {phase.message}
            </div>
          )}

          {phase.status === "done" && (
            <StressResult
              result={phase.result}
              committed={committed}
              activeId={activeId}
              activeScenario={activeScenario}
              onSelect={setSelectedId}
            />
          )}
        </section>
      )}
    </>
  );
}

function StressResult({
  result,
  committed,
  activeId,
  activeScenario,
  onSelect,
}: {
  result: StressLookup;
  committed: readonly RefinedScenario[];
  activeId: string | null;
  activeScenario: RefinedScenario | null;
  onSelect: (id: string) => void;
}) {
  switch (result.outcome) {
    case "not-found":
      return (
        <div className={styles.emptyState} data-testid="lab-not-found">
          {renderLookupOutcome(result.outcome)} · a definitive negative: every engine was
          available to be consulted and none carries this account in the batch.
        </div>
      );
    case "unknowable":
      return (
        <div className={styles.notServed} data-testid="lab-unknowable">
          <b>{renderLookupOutcome(result.outcome)}.</b> {result.note}
          <div className={styles.withheldList}>
            {result.withheldEngines.map((refusal) => (
              <div key={refusal.engine}>
                <EngineChip engine={refusal.engine} /> <RefusedTag reason={refusal.code} />
                <p className={styles.withheldDetail}>{refusal.detail}</p>
              </div>
            ))}
          </div>
        </div>
      );
    case "found":
      return (
        <div data-testid="lab-found">
          {!result.complete && (
            <div className={styles.notServed} data-testid="lab-floor-note">
              <b>incomplete lookup: these results are a FLOOR, not a total.</b> {result.note}
              <div className={styles.withheldList}>
                {result.withheldEngines.map((refusal) => (
                  <div key={refusal.engine}>
                    <EngineChip engine={refusal.engine} /> <RefusedTag reason={refusal.code} />
                    <p className={styles.withheldDetail}>{refusal.detail}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
          <LabScenarioChips scenarios={committed} selectedId={activeId} onSelect={onSelect} />
          {activeScenario !== null && <LabScenarioDetail scenario={activeScenario} />}
          <LabBoundaryGroup scenarios={committed} />
          <LabBatchStamp
            batch={result.response.batch}
            scenarioConfigVersion={result.response.scenario_config_version}
          />
        </div>
      );
  }
}
