// What the Scenarios page reads and dispatches: the committed listing, one run
// record per scenario id, one set record. A run is an action — nothing here
// dispatches on its own; the surface calls `run` / `runSet` on a click or a
// deep link. One run per id and one set at a time; a second ask is a no-op.
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Phase } from "./address-lookup";
import { getSolventClient, solventBaseUrl } from "./api";
import { setMembership } from "./lab-compare";
import { readsAsAnswer } from "./lab-engine";
import type { HeldResult, HeldSet, RunRecord, ScenariosResponse, SetRecord } from "./lab-library";
import { monotonicNowMs } from "./freshness";
import { describeLookupError } from "./lookup-error";
import { runBookScenario, type LabRunBook, type RunBookOutcome } from "./runbook";
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

/** Whether a 2xx run-book reads as an answer: the record's one question of a body, supplied by the caller (`readsAsAnswer` in lab-engine on the page) — the same question the view asks first, so one rule decides what is held and what releases the hold. */
export type ReadsAsAnswer = (response: LabRunBook) => boolean;

/**
 * A computed result is never replaced by the run that follows it: it is held until a newer answer stands. Only a
 * body that READS moves into the hold. A 2xx body that does not read is a failed answer like any other failure, so
 * the hold passes through it unchanged — however many follow one another, the last body that read stands behind them.
 */
function heldOf(prev: RunRecord | undefined, reads: ReadsAsAnswer): HeldResult | null {
  if (prev === undefined) return null;
  if (prev.phase === "settled" && prev.outcome.kind === "ok" && reads(prev.outcome.response)) return { response: prev.outcome.response, at: prev.at, atMonotonicMs: prev.atMonotonicMs };
  return prev.held;
}

export function withRunning(runs: ReadonlyMap<string, RunRecord>, id: string, now: number, reads: ReadsAsAnswer): Map<string, RunRecord> {
  const next = new Map(runs);
  next.set(id, { phase: "running", startedAt: now, held: heldOf(runs.get(id), reads) });
  return next;
}

export function withSettled(runs: ReadonlyMap<string, RunRecord>, id: string, outcome: RunBookOutcome, now: number, monotonicNow: number, reads: ReadsAsAnswer): Map<string, RunRecord> {
  const next = new Map(runs);
  // The hold survives every settle, an ok one included: the view releases it exactly when the new body reads — the
  // question asked here, of the body alone. The hold is always the last body that read before this settle; a new
  // answer stands in front of it, a failure or a body that does not read behind it.
  next.set(id, { phase: "settled", outcome, at: now, atMonotonicMs: monotonicNow, held: heldOf(runs.get(id), reads) });
  return next;
}

/** The set that stands: a settled ok that answered its request, else whatever the record already held. A set that did not answer its request is not a comparison to hold. */
function heldSetOf(prev: SetRecord | null): HeldSet | null {
  if (prev === null) return null;
  if (prev.phase === "settled" && prev.outcome.kind === "ok" && setMembership(prev.ids, prev.outcome.response).length === 0) {
    return { ids: prev.ids, response: prev.outcome.response, at: prev.at };
  }
  return prev.held;
}

export function withSetRunning(prev: SetRecord | null, ids: readonly string[], now: number): SetRecord {
  return { phase: "running", ids, startedAt: now, held: heldSetOf(prev) };
}

/** A computed comparison is never replaced by the Compare that follows it: it is held through every failure and released only by a new set that answers its request. */
export function withSetSettled(prev: SetRecord | null, ids: readonly string[], outcome: SetRunOutcome, now: number): SetRecord {
  const answers = outcome.kind === "ok" && setMembership(ids, outcome.response).length === 0;
  return { phase: "settled", ids, outcome, at: now, held: answers ? null : heldSetOf(prev) };
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
  // One POST per ask: the record is the committed guard, and the controller in flight is the guard before the
  // commit — two asks in one tick meet the first ask's controller, not a record that has yet to land. A run's
  // controller is keyed by its scenario id; the set's lives in its own slot, in no id's key, because the id space
  // is the wire's and no sentinel may sit in it. The slot object is stable, so the unmount cleanup may hold it.
  const controllers = useRef(new Map<string, AbortController>());
  const setSlot = useRef<{ controller: AbortController | null }>({ controller: null });

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

  // Unmount aborts every request in flight, so no settle lands on a surface that is gone.
  useEffect(() => {
    const live = controllers.current;
    const slot = setSlot.current;
    return () => {
      for (const c of live.values()) c.abort();
      live.clear();
      slot.controller?.abort();
      slot.controller = null;
    };
  }, []);

  const run = useCallback((id: string) => {
    if (controllers.current.has(id) || !canDispatch(runsRef.current, id)) return;
    const controller = new AbortController();
    controllers.current.set(id, controller);
    setRuns((prev) => withRunning(prev, id, Date.now(), readsAsAnswer));
    runBookScenario(solventBaseUrl(), id, { signal: controller.signal }).then(
      (outcome) => {
        if (controller.signal.aborted) return;
        controllers.current.delete(id);
        setRuns((prev) => withSettled(prev, id, outcome, Date.now(), monotonicNowMs(), readsAsAnswer));
      },
      (cause: unknown) => {
        if (controller.signal.aborted) return;
        controllers.current.delete(id);
        setRuns((prev) => withSettled(prev, id, { kind: "unreachable", message: describeLookupError(cause) }, Date.now(), monotonicNowMs(), readsAsAnswer));
      },
    );
  }, []);

  const runSet = useCallback((ids: readonly string[]) => {
    const slot = setSlot.current;
    if (slot.controller !== null || !canDispatchSet(setRef.current)) return;
    const controller = new AbortController();
    slot.controller = controller;
    const asked = [...ids];
    setSet((prev) => withSetRunning(prev, asked, Date.now()));
    runBookSet(solventBaseUrl(), asked, { signal: controller.signal }).then(
      (outcome) => {
        if (controller.signal.aborted) return;
        slot.controller = null;
        setSet((prev) => withSetSettled(prev, asked, outcome, Date.now()));
      },
      (cause: unknown) => {
        if (controller.signal.aborted) return;
        slot.controller = null;
        setSet((prev) => withSetSettled(prev, asked, { kind: "unreachable", message: describeLookupError(cause) }, Date.now()));
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
