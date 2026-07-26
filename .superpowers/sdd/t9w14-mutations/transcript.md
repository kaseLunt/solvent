# mutation transcript

- spec: `mutations.json`
- repo: `C:\Users\kasel\source\repos\etherfi\Solvent`
- **tested SHA: `0340ed0bef2d28dd66a89a2e036c9ac717919412`**  (test(ingest): wave-14 mutation spec (3 mutants, the brief's mandated rows, committed before the loop))
- started (UTC): 2026-07-26T23:11:45+00:00
- applier: `mutate.py`, exactly-one-occurrence assertion in `apply_edit`

## W14M1 — budget-removed: the seam's landed arm bypasses recordLanding and retains unconditionally

**Property under attack:** Retention is BOUNDED: consecutive over-budget landings spend the lease and the next Step probes the neighbour. Removing the lease (the landed arm reverts to unconditional retention) restores Codex round-12's pin: a just-below-timeout endpoint lands every Step, no error arm ever fires, and the stream never reaches the fast peer - fail-forever for latency.

```diff
--- internal/ingest/walker.go:496
-			w.recordLanding(servedBy, wall, probing, incumbent)
+			w.startPref, _, _ = servedBy.Index, wall, probing // W14M1: lease removed - unconditional retention
```
APPLIED at internal/ingest/walker.go:496 (1 occurrence, asserted)

`go test ./internal/ingest/ -count=1 -run TestSlowSuccessfulEndpointIsEscapedWithinTheStatedBound|TestSlowerProbeReturnsToTheIncumbentAndReArmsTheLease`

Killed by:
  - `TestSlowSuccessfulEndpointIsEscapedWithinTheStatedBound`
  - `TestSlowerProbeReturnsToTheIncumbentAndReArmsTheLease`

**Result: KILLED**

## W14M2 — probe-adopts-unconditionally: the baseline comparison is forced true

**Property under attack:** A probe landing is ADJUDICATED, never blindly retained: only a strictly faster landing transfers retention; a no-faster probe returns to the incumbent and re-arms the lease. Unconditional adoption recreates the bounce pole the annex's retention rule closed - the stream hops to whichever witness served the probe regardless of evidence, and a no-better (or worse) neighbour steals the pin every spent lease.

```diff
--- internal/ingest/walker.go:368
-		if wall < w.slowBaseline {
+		if true { // W14M2: probe adopts unconditionally
```
APPLIED at internal/ingest/walker.go:368 (1 occurrence, asserted)

`go test ./internal/ingest/ -count=1 -run TestSlowerProbeReturnsToTheIncumbentAndReArmsTheLease`

Killed by:
  - `TestSlowerProbeReturnsToTheIncumbentAndReArmsTheLease`

**Result: KILLED**

## W14M3 — budget-derivation drift: slowStepBudget raised to the blind-spot ceiling (stepMaxPinnedReads x chainAttemptTimeout)

**Property under attack:** The budget's DERIVATION is load-bearing and its bound finite and stated: slowStepBudget is ONE chainAttemptTimeout, sitting stepMaxPinnedReads-times BELOW the failover's blind-spot ceiling, which is exactly what lets the lease see the just-below-timeout posture the failover cannot. Drifting the budget up to the ceiling (the natural wrong derivation: 'budget = worst case') makes every pathological landing read as within-budget - the lease never spends, the pin returns, the stated bound stops existing.

```diff
--- internal/ingest/walker.go:247
-const slowStepBudget = chainAttemptTimeout
+const slowStepBudget = stepMaxPinnedReads * chainAttemptTimeout // W14M3: budget drifted to the blind-spot ceiling
```
APPLIED at internal/ingest/walker.go:247 (1 occurrence, asserted)

`go test ./internal/ingest/ -count=1 -run TestSlowSuccessfulEndpointIsEscapedWithinTheStatedBound`

Killed by:
  - `TestSlowSuccessfulEndpointIsEscapedWithinTheStatedBound`

**Result: KILLED**

## restore verification

`git status --porcelain` over the 1 mutated file(s) is EMPTY: every file is byte-identical to `0340ed0`. Restores came from in-memory copies taken before each edit; `git checkout` is never used.

## summary

| # | result | property | killed by |
|---|---|---|---|
| W14M1 | **KILLED** | Retention is BOUNDED: consecutive over-budget landings spend the lease and the next Step probes the neighbour. Removing the lease (the landed arm reverts to unconditional retention) restores Codex round-12's pin: a just-below-timeout endpoint lands every Step, no error arm ever fires, and the stream never reaches the fast peer - fail-forever for latency. | `TestSlowSuccessfulEndpointIsEscapedWithinTheStatedBound`<br>`TestSlowerProbeReturnsToTheIncumbentAndReArmsTheLease` |
| W14M2 | **KILLED** | A probe landing is ADJUDICATED, never blindly retained: only a strictly faster landing transfers retention; a no-faster probe returns to the incumbent and re-arms the lease. Unconditional adoption recreates the bounce pole the annex's retention rule closed - the stream hops to whichever witness served the probe regardless of evidence, and a no-better (or worse) neighbour steals the pin every spent lease. | `TestSlowerProbeReturnsToTheIncumbentAndReArmsTheLease` |
| W14M3 | **KILLED** | The budget's DERIVATION is load-bearing and its bound finite and stated: slowStepBudget is ONE chainAttemptTimeout, sitting stepMaxPinnedReads-times BELOW the failover's blind-spot ceiling, which is exactly what lets the lease see the just-below-timeout posture the failover cannot. Drifting the budget up to the ceiling (the natural wrong derivation: 'budget = worst case') makes every pathological landing read as within-budget - the lease never spends, the pin returns, the stated bound stops existing. | `TestSlowSuccessfulEndpointIsEscapedWithinTheStatedBound` |

3 mutants, 3 killed, 0 survived.
