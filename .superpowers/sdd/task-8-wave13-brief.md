### Task 8 — wave 13: round-10 fixes (HEALTH unit)

Repo `C:\Users\kasel\source\repos\etherfi\Solvent`, branch `main`. Base: current HEAD at start
(`git log` — the prices wave 12 may still be committing; disjoint files).

Codex round 10 (health): **NO-SHIP — 1 high, 1 medium; H2/H4 confirmed closed.** Read
`.superpowers/sdd/task-8-codex-round10-health.md` (verbatim + adjudication) and
`task-8-wave11-report-p2.md`. Both findings ACCEPTED. Do not re-open H2/H4 or anything round 10
confirmed coherent (00008, schema v8, rewind semantics, quiet-refusal composition).

## K1 [high] — the throttle must survive SLOW SUCCESSFUL fetches (`main.go:987-993`)

One round-start `now` stamps every fetch in a pass; nine sequential reads averaging >3.33s push the
pass past the 30s window, expiring every anchor before the next pass — the hot-loop cost returns,
and the disclosed 30s false-red bound silently exceeds 30s wall time.

**Do (Codex's recommendation):** stamp reuse-scheduling time from a **monotonic clock at actual
fetch completion**, and add a **per-chain refresh budget** that stays bounded even when a pass
exceeds the window (state both bounds in the comment; derive the budget from the cooldown budget as
before, not a new constant). **Harness:** a successful-fetch test that advances time DURING each
read until one pass exceeds 30s, asserting bounded reads and catch-up recovery. The lesson to
encode: "hard case" has more than one axis — wave 11 varied data-age and left latency instantaneous.
State per measurement which axes it varies.

## K2 [medium] — one source of time truth per verdict (`main.go:1005-1006`)

Rollback smaller than a cached header's age shifts staleness green without tripping the future-skew
predicate (an old header absorbs the rollback). Eviction doesn't help — the fetch path trusts the
same skewed clock.

**Do:** judge header age against an **independently sourced current time** — the DB clock, already
the trusted time authority for the collateral verdict (Codex's own recommendation) — or fail
`staleness_unmeasured` when daemon and DB clocks diverge beyond tolerance. Whichever you pick, the
principle to state in the comment: one source of time truth per verdict; the daemon wall clock is
untrusted input. **Test:** rollback smaller than the cached header's age but large enough to cross
the health boundary → NOT green.

## Scope & method (unchanged, binding)
Touch ONLY `cmd/indexer/**` (+`internal/store/derive.go` ONLY if K2's DB-clock read needs an
additive helper — flag it; 7th modification), `.superpowers/sdd/**`. Never `internal/prices/**`,
`roadmap/**`. Pathspec staging. Scoped `-run` during development; archive-export verification if the
tree is dirty. Commit before mutation loops; mutations state the property, cover every arm; no
impossible store transitions; measured evidence states which axes it varies. Baseline at your start
commit, stated with convention; zero FAIL/SKIP; build/vet/gofmt (READ it); `-race` in `golang:1.24`.
`TEST_DATABASE_URL='postgres://solvent:solvent@localhost:5432/solvent?sslmode=disable'`;
`dangerouslyDisableSandbox: true` + PATH export.

## Reporting
`.superpowers/sdd/task-8-wave13-report-p2.md`: both fixes, citing tests, mutation properties, the
latency-axis measurement, anything unverified. Returns to Codex (health unit) under D-006.
