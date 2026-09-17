### Task 8: `lab-reading` — the listing, the run records, the set record, the dispatchers

**Files:**
- Create: `web/lib/lab-reading.ts`
- Test: `web/tests/unit/lab-reading.spec.ts` (the pure record reducers; the hook itself is proven by the e2e contract's one-POST-per-click pins in Task 12)

**Interfaces:**
- Consumes: `lib/api.ts` (`getSolventClient`, `solventBaseUrl`), `lib/address-lookup.ts` (`Phase<T>`), `lib/lookup-error.ts` (`describeLookupError`), `lib/runbook.ts` (`runBookScenario`, `RunBookOutcome`), `lib/runbookSet.ts` (`runBookSet`, `SetRunOutcome`), `lib/lab-library.ts` (`RunRecord`, `SetRecord`, `ScenariosResponse`).
- Produces: `LabReading { listing: Phase<ScenariosResponse>; runs: ReadonlyMap<string, RunRecord>; set: SetRecord | null; run(id); runSet(ids); reloadListing() }`, `useLabReading(): LabReading`; pure: `canDispatch(runs, id): boolean`, `withRunning(runs, id, now)`, `withSettled(runs, id, outcome, now)`, `canDispatchSet(set): boolean`.

- [ ] **Step 1: The reducer pins (failing)**

```ts
// web/tests/unit/lab-reading.spec.ts
// The run records' law: one run per id in flight, a settled record replaces
// the running one and nothing else, a second click while running is a no-op.
import { expect, test } from "@playwright/test";
import { canDispatch, canDispatchSet, withRunning, withSettled } from "../../lib/lab-reading";
import type { RunRecord } from "../../lib/lab-library";

test("withRunning marks one id and leaves the others; canDispatch refuses an id in flight", () => {
  const empty = new Map<string, RunRecord>();
  const one = withRunning(empty, "eth_minus_30", 100);
  expect(one.get("eth_minus_30")).toEqual({ phase: "running", startedAt: 100 });
  expect(empty.size).toBe(0);
  expect(canDispatch(one, "eth_minus_30")).toBe(false);
  expect(canDispatch(one, "ethfi_minus_50")).toBe(true);
  const two = withRunning(one, "ethfi_minus_50", 101);
  expect(two.size).toBe(2);
  expect(two.get("eth_minus_30")).toEqual({ phase: "running", startedAt: 100 });
});

test("withSettled replaces the running record with the outcome and keeps every other record", () => {
  const running = withRunning(withRunning(new Map(), "a", 1), "b", 2);
  const settled = withSettled(running, "a", { kind: "not-served" }, 5);
  expect(settled.get("a")).toEqual({ phase: "settled", outcome: { kind: "not-served" }, at: 5 });
  expect(settled.get("b")).toEqual({ phase: "running", startedAt: 2 });
  expect(canDispatch(settled, "a")).toBe(true);
  // A settlement for an id that was never running is still recorded — the wire answered, the page shows it.
  expect(withSettled(new Map(), "c", { kind: "not-served" }, 9).get("c")?.phase).toBe("settled");
});

test("canDispatchSet: only when no set is in flight", () => {
  expect(canDispatchSet(null)).toBe(true);
  expect(canDispatchSet({ phase: "running", ids: ["a"], startedAt: 1 })).toBe(false);
  expect(canDispatchSet({ phase: "settled", ids: ["a"], outcome: { kind: "not-served" }, at: 2 })).toBe(true);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd web && npx playwright test --project=unit tests/unit/lab-reading.spec.ts`
Expected: FAIL — `Cannot find module '../../lib/lab-reading'`.

- [ ] **Step 3: The module**

```ts
// web/lib/lab-reading.ts
// What the Scenarios page reads and dispatches: the committed listing, one run
// record per scenario id, one set record. A run is an action — nothing here
// dispatches on its own; the surface calls `run` / `runSet` on a click or a
// deep link. One run per id and one set at a time; a second ask is a no-op.
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Phase } from "./address-lookup";
import { getSolventClient, solventBaseUrl } from "./api";
import type { RunRecord, ScenariosResponse, SetRecord } from "./lab-library";
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

export function withSettled(runs: ReadonlyMap<string, RunRecord>, id: string, outcome: RunBookOutcome, now: number): Map<string, RunRecord> {
  const next = new Map(runs);
  next.set(id, { phase: "settled", outcome, at: now });
  return next;
}

export function useLabReading(): LabReading {
  const [listing, setListing] = useState<Phase<ScenariosResponse>>({ phase: "loading" });
  const [epoch, setEpoch] = useState(0);
  const [runs, setRuns] = useState<ReadonlyMap<string, RunRecord>>(new Map());
  const [set, setSet] = useState<SetRecord | null>(null);
  const runsRef = useRef(runs);
  runsRef.current = runs;
  const setRef = useRef(set);
  setRef.current = set;
  const controllers = useRef(new Map<string, AbortController>());

  useEffect(() => {
    const controller = new AbortController();
    setListing({ phase: "loading" });
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
        setRuns((prev) => withSettled(prev, id, outcome, Date.now()));
      },
      (cause: unknown) => {
        if (controller.signal.aborted) return;
        controllers.current.delete(id);
        setRuns((prev) => withSettled(prev, id, { kind: "unreachable", message: describeLookupError(cause) }, Date.now()));
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

  const reloadListing = useCallback(() => setEpoch((e) => e + 1), []);
  return { listing, runs, set, run, runSet, reloadListing };
}
```

`runBookScenario` never rejects for wire outcomes (it returns `unreachable`/`failed`); the rejection arms only catch a thrown id-shape error, which the surface prevents by passing listed ids. `describeLookupError` is Plan 2's message mapper. The `react-hooks/refs` rule: `runsRef.current = runs` assignments happen during render on purpose (the latest records without a stale closure) — if lint flags them, move both into a `useEffect` with no deps and say so in the report.

- [ ] **Step 4: Run to verify it passes, then the gates**

Run: `cd web && npx playwright test --project=unit tests/unit/lab-reading.spec.ts && npm run typecheck && npm run lint`
Expected: 3 passed; typecheck and lint clean.

- [ ] **Step 5: Commit**

```bash
cd /c/Users/kasel/source/repos/etherfi/Solvent
git add web/lib/lab-reading.ts web/tests/unit/lab-reading.spec.ts
python roadmap/tools/scope_gate.py
git commit -m "feat(web): lab-reading - the listing, one run record per scenario, one set record; nothing dispatches on its own and nothing dispatches twice" -- web/lib/lab-reading.ts web/tests/unit/lab-reading.spec.ts
```

---
