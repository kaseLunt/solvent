"use client";

import { useCallback, useMemo, useRef, useState } from "react";
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
import { LabBookPanel } from "./LabBookPanel";
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

/**
 * The default chip, picked from DATA: the first scenario whose results carry
 * a market-realization axis asserting `hfs_unchanged` (the flagship class),
 * else the first scenario the wire served. Never an id literal.
 */
function pickDefaultScenario(scenarios: readonly RefinedScenario[]): string | null {
  const flagship = scenarios.find((scenario) =>
    scenario.results.some((result) => result.market_realization?.hfs_unchanged === true),
  );
  return flagship?.id ?? scenarios[0]?.id ?? null;
}

function describeError(error: unknown): string {
  if (error instanceof UnavailableError) {
    return "no complete risk batch is available (503) — a statement about the SERVICE, never an empty book";
  }
  if (error instanceof RateLimitedError) {
    return error.retryAfterSeconds !== null
      ? `rate limited (429) — the service says retry after ${String(error.retryAfterSeconds)}s`
      : "rate limited (429) — the service did not say when to retry";
  }
  if (error instanceof BadRequestError) {
    return `the service refused the request (400): ${error.message}`;
  }
  if (error instanceof SolventNetworkError) {
    return `the API could not be reached (${error.timedOut ? "client timeout" : "no HTTP response"}) — this says nothing about the address`;
  }
  if (error instanceof ContractInvariantError) {
    return `refusing to render: the response contradicts itself — ${error.message}`;
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
  const [mode, setMode] = useState<Mode>("address");
  const [input, setInput] = useState("");
  const [phase, setPhase] = useState<StressPhase>({ status: "idle" });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const requestSeq = useRef(0);

  const inputValid = isAddress(input);

  /**
   * The committed set as the wire last served it.
   *
   * WAVE R1 ITEM 5 — THE DEAD END THIS FIXES: this used to require
   * `outcome === "found"`. But the committed scenario set is a property of
   * the DEPLOYMENT, not of the address: `/v1/address/{addr}/stress` carries
   * `scenarios` on EVERY completed outcome — found, not-found and unknowable
   * alike. Gating on `found` meant a reader who looked up an address with no
   * position learned nothing AND left book mode permanently empty, with a
   * message telling them to do the thing they had just done. Any completed
   * lookup now teaches the list.
   */
  const committed: readonly RefinedScenario[] = useMemo(() => {
    if (phase.status !== "done") return [];
    return phase.result.response.scenarios;
  }, [phase]);

  const defaultId = useMemo(() => pickDefaultScenario(committed), [committed]);
  const activeId = selectedId ?? defaultId;
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
      <div className={styles.modeBar} role="group" aria-label="run mode">
        <button
          type="button"
          className={styles.modeButton}
          aria-pressed={mode === "address"}
          data-testid="mode-address"
          onClick={() => {
            setMode("address");
          }}
        >
          one address
        </button>
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
      </div>

      {mode === "address" ? (
        <section aria-label="address stress">
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
              placeholder="0x + 40 hex — the account to stress"
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
                not an address: the contract requires 0x + exactly 40 hex digits — nothing is
                sent until it matches
              </span>
            )}
          </form>

          {phase.status === "idle" && (
            <div className={styles.emptyState} data-testid="lab-idle">
              enter an address to run the COMMITTED scenario set against it — every scenario
              from <span className="mono">GET /v1/address/{"{addr}"}/stress</span>, evaluated
              from the newest servable batch&apos;s persisted rows. The scenario chips render
              from that response; no scenario list is hardcoded in this UI.
            </div>
          )}

          {phase.status === "loading" && (
            <p className={styles.pendingState}>
              running the committed set against <span className="mono">{phase.addr}</span> —
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
      ) : (
        <section aria-label="book-wide stress">
          <LabBookPanel scenarios={committed} defaultScenarioId={defaultId} />
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
          {renderLookupOutcome(result.outcome)} — a definitive negative: every engine was
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
              <b>incomplete lookup — these results are a FLOOR, not a total.</b> {result.note}
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
