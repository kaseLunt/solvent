// What the Scenarios page reads and dispatches: the committed listing, one run
// record per scenario id, one set record. A run is an action — nothing here
// dispatches on its own; the surface calls `run` / `runSet` on a click or a
// deep link. One run per id and one set at a time; a second ask is a no-op.
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Phase } from "./address-lookup";
import { getSolventClient, solventBaseUrl } from "./api";
import type { RunRecord, ScenariosResponse, SetRecord } from "./lab-library";
import { monotonicNowMs } from "./freshness";
import { describeLookupError } from "./lookup-error";
import { runBookScenario, type RunBookOutcome } from "./runbook";
import { runBookSet, type SetRunOutcome } from "./runbookSet";

export interface LabReading {
  readonly listing: Phase<ScenariosResponse>;
  readonly runs: ReadonlyMap<string, RunRecord>;
  readonly set: SetRecord | null;
  readonly run: (id: string) => void;
  readonly runSet: (ids: readonly string[]) => void;
  readonly reloadListing: () => void;
}

export const canDispatch = (runs: ReadonlyMap<string, RunRecord>, id: string): boolean => runs.get(id)?.phase !== "running";
export const canDispatchSet = (set: SetRecord | null): boolean => set === null || set.phase !== "running";

export function withRunning(runs: ReadonlyMap<string, RunRecord>, id: string, now: number): Map<string, RunRecord> {
  const next = new Map(runs);
  next.set(id, { phase: "running", startedAt: now });
  return next;
}

export function withSettled(runs: ReadonlyMap<string, RunRecord>, id: string, outcome: RunBookOutcome, now: number, monotonicNow: number): Map<string, RunRecord> {
  const next = new Map(runs);
  next.set(id, { phase: "settled", outcome, at: now, atMonotonicMs: monotonicNow });
  return next;
}

export function useLabReading(): LabReading {
  const [listing, setListing] = useState<Phase<ScenariosResponse>>({ phase: "loading" });
  const [epoch, setEpoch] = useState(0);
  const [runs, setRuns] = useState<ReadonlyMap<string, RunRecord>>(new Map());
  const [set, setSet] = useState<SetRecord | null>(null);
  // The dispatchers read the records through refs, so a stale closure can never
  // let a second ask through; the refs follow every commit.
  const runsRef = useRef(runs);
  const setRef = useRef(set);
  useEffect(() => {
    runsRef.current = runs;
    setRef.current = set;
  });
  const controllers = useRef(new Map<string, AbortController>());

  useEffect(() => {
    const controller = new AbortController();
    getSolventClient()
      .scenarios(controller.signal)
      .then(
        (value) => {
          if (!controller.signal.aborted) setListing({ phase: "ready", value });
        },
        (cause: unknown) => {
          if (!controller.signal.aborted) setListing({ phase: "error", message: describeLookupError(cause) });
        },
      );
    return () => {
      controller.abort();
    };
  }, [epoch]);

  useEffect(() => {
    const live = controllers.current;
    return () => {
      for (const c of live.values()) c.abort();
      live.clear();
    };
  }, []);

  const run = useCallback((id: string) => {
    if (!canDispatch(runsRef.current, id)) return;
    const controller = new AbortController();
    controllers.current.set(id, controller);
    setRuns((prev) => withRunning(prev, id, Date.now()));
    runBookScenario(solventBaseUrl(), id, { signal: controller.signal }).then(
      (outcome) => {
        if (controller.signal.aborted) return;
        controllers.current.delete(id);
        setRuns((prev) => withSettled(prev, id, outcome, Date.now(), monotonicNowMs()));
      },
      (cause: unknown) => {
        if (controller.signal.aborted) return;
        controllers.current.delete(id);
        setRuns((prev) => withSettled(prev, id, { kind: "unreachable", message: describeLookupError(cause) }, Date.now(), monotonicNowMs()));
      },
    );
  }, []);

  const runSet = useCallback((ids: readonly string[]) => {
    if (!canDispatchSet(setRef.current)) return;
    const controller = new AbortController();
    controllers.current.set("__set__", controller);
    const asked = [...ids];
    setSet({ phase: "running", ids: asked, startedAt: Date.now() });
    runBookSet(solventBaseUrl(), asked, { signal: controller.signal }).then(
      (outcome: SetRunOutcome) => {
        if (controller.signal.aborted) return;
        controllers.current.delete("__set__");
        setSet({ phase: "settled", ids: asked, outcome, at: Date.now() });
      },
      (cause: unknown) => {
        if (controller.signal.aborted) return;
        controllers.current.delete("__set__");
        setSet({ phase: "settled", ids: asked, outcome: { kind: "unreachable", message: describeLookupError(cause) }, at: Date.now() });
      },
    );
  }, []);

  // A reload reads as loading from the ask itself; the epoch bump is what refetches.
  const reloadListing = useCallback(() => {
    setListing({ phase: "loading" });
    setEpoch((e) => e + 1);
  }, []);
  return { listing, runs, set, run, runSet, reloadListing };
}
