### Task 8 — wave 9: health/readiness surface (its own reviewable unit)

Repo `C:\Users\kasel\source\repos\etherfi\Solvent`, branch `main`. Base: **the commit where wave 8
landed** (check `git log` — do not start from a stale SHA; wave 8 edited `internal/prices/**` and
`internal/store/prices*.go` and may have made minimal call-site removals in `cmd/indexer/main.go`).

This wave closes the two Codex round-5 findings that have been deliberately deferred while the price
pipeline stabilized:

1. **[high] Snapshot readiness remains green while collateral is failed or absent** (`main.go:871-885`)
2. **[medium] Fixed block counts do not enforce the stated ten-minute time bound** (`main.go:193-201`)

**Provenance of this brief:** both designs below were produced by a map→design→adversarial-verify
workflow (14 agents) against HEAD `1da0fa4`: five read-only mappers extracted ground truth with
file:line citations, two designers produced initial designs, and six adversarial verifiers (three
lenses per design — false-green, permanent-stall, composition — the three defect classes this surface
has actually shipped) attacked them. The designs below are the **post-amendment** shapes: every
confirmed break is already absorbed. Implement these, not your own variant; where you find the design
contradicts landed code, report the contradiction rather than silently improvising.

---

## DESIGN 1 — `collateral_unusable` (snapshot usability gate)

Codex's requirement, verbatim: *"Gate on actual collateral usability: expose current registry
accounts with no successful snapshot or a snapshot older than an explicit bound, preserve unresolved
status across generation rollover, and clear it only after that account succeeds. Replace the test
expecting readiness with failure/recovery coverage."*

### Core (attacked by all three lenses, confirmed sound)
- New durable columns on `snapshot_sweeps`: `last_success_at TIMESTAMPTZ NULL` (additive migration,
  **next free number after wave 8's** — check whether wave 8 claimed `00006`). Backfill:
  `status='success'` rows get `last_success_at = updated_at`; failed rows stay NULL (**fail-closed
  direction** — a backfill missing the status predicate would green stale accounts).
- `SweepProgress` gains: `NeverSucceeded` (count of registry accounts with `last_success_block = 0`
  or no row), `StaleSuccess` (count with `last_success_block > 0` and `last_success_at` NULL or older
  than the bound), `OldestSuccessAt`, and `LastPassDuration` (see A3).
- The daemon publishes a `collateral_unusable` readiness condition under the `snapshotter` worker
  prefix, in the same round composition as the existing sweep gates (all condition names distinct;
  single naming of the worker per round — the composition lens verified `rc.set` never collides and
  the merge-defect guard never trips).
- `staleBound <= 0` is a configuration error: fail closed at startup.
- The existing `snapshot_failures` gate stays as a complementary signal.

### Amendments — these absorbed confirmed breaks; every one is load-bearing

**A1 — REWIND CLAMP.** Confirmed at HEAD: `RewindDerived` (`derive.go:559-563`) deletes ALL accounts'
snapshot history above the effective target in the rewind tx, and **nothing resets surviving rows'
`last_success_block`** — so after a reorg the monotonic guard (`derive.go:1368`) wedges (canonical
head < stored `last_success_block`, every honest success skipped), while a fresh `last_success_at`
keeps `StaleSuccess = 0`: the design would certify exactly the population the rewind invalidated.
Fix: `RewindDerived`'s tx gains
`UPDATE snapshot_sweeps SET last_success_block = 0, last_success_at = NULL WHERE engine = $1 AND last_success_block > $2`.
This fails those accounts closed into `NeverSucceeded`, un-wedges the guard, and the same-tx
generation bump (`derive.go:598-604`) already queues the re-sweep.
**Note: this touches `internal/store/derive.go` — Codex-approved ground, modified for the 5th time.
The change is additive-inside-existing-tx; flag it prominently in your report for round 9.**

**A2 — `==`-REPLAY STAMP GUARD.** Confirmed: `derive.go:1368` admits `execBlock == lastSuccess` for
crash-replay idempotence, and the success upsert would re-stamp `last_success_at = now()` with zero
new chain observation — an eth_call-frozen endpoint whose `BlockNumber` view advances (the exact
adversary documented at `snapshot.go:35-50`) would refresh the signal forever. Fix (in the success
upsert only):
`ON CONFLICT ... SET last_success_at = CASE WHEN EXCLUDED.last_attempt_block > snapshot_sweeps.last_success_block THEN now() ELSE snapshot_sweeps.last_success_at END`.
Crash-replay retains the ORIGINAL stamp; the frozen-endpoint loop now trips `StaleSuccess` after the
bound — this gate becomes the **first** catcher of `snapshot.go`'s documented quiet failure mode.

**A3 — BOUND FORMULA.** The naive `max(2*Interval, 15m)` is **arithmetically wrong**: confirmed at
`derive.go:1227-1230`, `SweepWorkBatch` never re-selects a current-generation success, so per-account
refresh period is `S + I` (S = full pass duration); with any sizable registry the naive bound is
permanently exceeded under healthy operation → permanent false red. Fix:
`collateralStaleBound = max(2*(Interval + lastPassDuration), noProgressBound)`, where
`lastPassDuration = completed_at - opened_at` of the most recent COMPLETED generation (both columns
exist — `derive.go:598-602`), returned as the new `SweepProgress.LastPassDuration`; daemon uses the
prior round's read (one-round lag immaterial; zero → fall back to the naive formula).
**Ruling on the self-adaptivity residual (OQ3): accepted.** The gate certifies "as fresh as the
achieved cadence permits" — state exactly that in the code comment. Do NOT invent an absolute
ceiling; a number nobody derived is the borrowed-constant fallacy Codex already rejected once.

**A4 — PLACEMENT PIN.** Confirmed: `if !p.Open { return }` sits at `main.go:886-888` *between* the
Exhausted gate and no_progress — a closed generation can hold `StaleSuccess > 0` and idle green. The
unusable check goes immediately after the Exhausted gate and **before** the `!p.Open` return, with
explicit `Open:false` and `Open:true` test legs (coverage as a tested property, not an accident of
fake zero-values).

### Invariants (each becomes a cited test)
- I2′: membership in the unusable set changes ONLY via (add) A1's rewind clamp, (remove) a landed
  `ApplySweepBatch` success upsert for that account, (remove) rewind orphan deletion. Generation
  open/close, failed upserts, restarts, and status churn never change it.
- I3′: `last_success_at` is written only in the success upsert AND only when `execBlock` strictly
  exceeds stored `last_success_block` (`==` replay retains the prior stamp byte-identical); failure
  upsert and stale-skip leave it untouched (verified: they write nothing today); `RewindDerived` may
  NULL it.
- I4′: a `last_success_block > 0` row is `StaleSuccess` iff `last_success_at` IS NULL or age (DB
  clock) exceeds the bound under strict `<`. Boundary pinned at **bound ± 1s** — exact-equality
  against a live DB clock is untestable (Postgres `now()` advances between the aging UPDATE and the
  judging query; both lenses confirmed this).
- I11: a rewind that invalidates an account's last success moves it into the unusable set in the
  SAME transaction that deletes its snapshot history.

### Test plan (all live-Postgres where store-level; citations mandatory)
1. Stamp test with the `execBlock ==` leg → stamp unchanged [cites A2].
2. Boundary test: both rows written relative to ONE captured DB `now()`; bound−1s not counted,
   bound+1s counted, NULL-with-success-block counted [cites I4′].
3. Rollover test: unresolved status survives a real `OpenSweepGeneration` [cites the finding].
4. `TestRewindClampsSweepSuccessAboveTarget` [cites A1/I11]: surviving account through real
   `RewindDerived` → counted `NeverSucceeded`, history gone, next canonical success LANDS and clears.
5. Neither-set leg: `status='failed'`, attempts ≥ budget, `last_success_block > 0`, FRESH
   `last_success_at` → in NEITHER count [kills a status-keyed mutant; cites complementarity].
6. Migration test: pre-migration success+failed shapes → success backfills from `updated_at`, failed
   stays NULL [cites the fail-closed backfill].
7. Replace `health_test.go:1363-1379` (the `Ready=true`-with-failures test — the round-5
   test-integrity defect) with failure/recovery coverage. Report note: the deleted subtest would
   still pass post-implementation; its deletion is a policy statement.
8. Rename the persistence test honestly (its rollover leg proves the daemon predicate ignores
   generation fields; rollover preservation is pinned at store level).
9. `Open:false` + `StaleSuccess:1` → present; `Open:true` → present [cites A4].
10. Composition test asserts structurally: all snapshotter keys present after exactly ONE
    `publishRound`; next-round replacement clears. (Do NOT assert on log output — `health_test.go:30`
    discards slog globally.)
11. Bound property leg: for sampled `(I, S)`: `collateralStaleBound(I,S) >= 2*(I+S)` [cites A3].
12. Quiet-refusal leg: no step_error + `StaleSuccess:1` → red (an all-stale-refused generation —
    `ErrStaleSweepBatch`, `Step` returns `(false,nil)` — must not read green).

### Known/accepted residuals (state them in code comments, honestly)
- First-failure flap on a new account lasts **O(pass duration), not sub-Step** — `SweepWorkBatch`
  orders current-gen retries after the entire lagging set (`derive.go:1230`). Alerting keys on
  condition KEYS, not reason text.
- OQ2 (pre-existing at HEAD, NOT wave-9 scope): a same-chain endpoint mis-reporting the multicall
  `blockNumber` can poison `last_success_block` and wedge the guard — this already wedges generation
  close at HEAD. Scope the exit-path claim to "while `last_success_block` is canonical"; a write-time
  plausibility guard is captured as an idea, not built here.

---

## DESIGN 2 — `staleness` / `staleness_unmeasured` (measured elapsed-time gate)

Codex's requirement, verbatim: *"Measure head timestamp minus the cursor block's timestamp and gate
that elapsed interval directly. Keep block-distance metrics for attribution, but do not present
nominal cadence conversion as a hard time bound."*

### Core (survived all three lenses)
- **No chain timestamps exist in any table** (verified) and none are added: header times come from
  bounded, cached RPC `HeaderByNumber` fetches.
- The gate: `now - ts(cursor block)` vs `maxDerivedStaleness`, applied to raw-log consumers (runners
  and the feed deriver). Block distances (`frontier_lag` etc.) are demoted to attribution metadata.
- A header-fetch failure fails **red** (`staleness_unmeasured`), never green. Equality passes.
- `chainLagBound` (the 50/300 nominal conversion) is deleted — verified package-private, no collision.
- Single publish per worker per round; distinct condition names; composition confirmed sound.

### Amendments — all absorbed confirmed breaks

**L1 — NO-CURSOR POPULATION.** A watched walker with no `ingest_cursors` row produces `(false,nil)`
with NO cursor write (`walker.go:128-129`, `167-168` — StartBlock typo or frozen endpoint), no
step_error, no no_progress — and the naive design deletes the only red covering it (the old
`head_lag` at `main.go:477-483`). Fix: no-cursor-row (when the cursor READ succeeded) ⇒
`staleness_unmeasured` — "a bound the daemon cannot measure is one it cannot certify." Honest
residual for the report: a stream configured with a future StartBlock stays unmeasured-red until the
chain reaches it.

**L2 — FUTURE-SKEW SANITY.** `headerTimeSkewTolerance = 60s` (named constant). Fetched `Time >
now+tolerance` is a MEASUREMENT FAILURE → `staleness_unmeasured`, NEVER memoized; within tolerance
clamps to age 0. Without this, a wrong-unit `Time` memoizes as permanent age-0 green.

**L3 — `frontier_lag` STRUCTURAL GATING.** `frontier_lag` is emitted ONLY when the same consumer
already carries `staleness`/`staleness_unmeasured` this round, and `tF` is clamped to
`min(tF, now)`. (The unclamped version let a future-stamped frontier block redden a green consumer —
attribution must not gate.)

**L4 — CHAINDOWN LIFETIME + RETRY COOLDOWN.** (a) `chainDown` is constructed FRESH each round by the
caller — never a judge field (the ambiguity admitted a fail-forever). (b) The judge carries
`nextFetchAttempt[chainID]` (cooldown 30s): rounds inside the cooldown emit `staleness_unmeasured`
with the retained error WITHOUT re-paying the fetch timeout. Confirmed necessity: the staleness pass
runs inside the hot inner loop (`main.go:1150-1219`, no ticker while `anyAdvanced`) — without the
cooldown a dead ETH chain burns a 10s fetch timeout EVERY round and collapses a concurrent OP
backfill ~20×. This is measurement *scheduling*, not verdict memory: the red re-derives each round
and clears on the first post-cooldown successful fetch.

**L5 — MEMO KEYING + ORDERING + THROTTLE.** Memo keyed by `(chainID, block)`, not worker. Memo is
consulted BEFORE cooldown/chainDown — a held valid stamp always yields a real measured verdict even
on a down chain (pinned ordering, own test). RECOMMENDED and included: fail-closed restamp throttle —
reuse a <30s-old stamp whose measured age ≤ bound/2; the retained stamp belongs to an
older-or-equal block so reuse only OVER-estimates age (can never false-green). Without it, multi-day
backfills pay ~+25–50% wall time in header fetches on the same endpoints ingestion needs (directly
relevant to Task 9).

**L6 — CONSUMER INPUT DECOUPLING.** Consumer staleness is judged on derive-cursor read success ALONE;
ingest rows feed only attribution (skipped silently when unavailable). A transient ingest-cursor
query failure must not suspend the liquidation-facing bound.

**L7 — SHUTDOWN CARVE-OUT.** The pass returns verdict-less on `ctx.Err()`; a Canceled fetch is not a
measurement failure (matches `TestNonPricePassesTreatCancellationAsShutdown`, `health_test.go:731`).

**L8 — COMMENT SCOPING.** The `maxDerivedStaleness` need-statement is scoped to log-derived state and
prices — NOT collateral (gated separately by Design 1). The fetch-cost comment states BOTH bounds:
failure path ≤ #chains × timeout per cooldown window; success path ≤ #gatedWorkers × fetch latency
per round (the erosion unit is per gated WORKER — confirmed: `Failover.do` re-pins the sticky hint on
every success, `chain.go:87-99`, so a slow-but-succeeding endpoint is never rotated away).

**L9 — NAMING GUARDS.** Keep `staleness`/`staleness_unmeasured`. ADD a unit test asserting the
cmd-side condition constants are distinct from every `prices.Condition*` string the daemon surfaces —
**wave 8 has landed by the time you read this: check its actual shipped condition names** and pin
distinctness. `head_lag`'s rename is safe (local-only deployment, no external alert consumers — owner
confirmed).

### Invariants (cited tests)
- I3′: a fetch failure produces exactly one `staleness_unmeasured` with no fabricated age, is NEVER
  memoized, and is retried no later than cooldown expiry; the next successful fetch clears it.
- I4′: at most one header fetch per `(chainID, cursor block)` per round; a failing chain attempts at
  most one failover walk per cooldown window; a valid memo stamp is used even when its chain is
  marked down this round.
- I7′: `frontier_lag` can only accompany a same-round `staleness`/`staleness_unmeasured` on that
  consumer (structural).
- I8′: `ts ∈ (now, now+60s]` clamps to age 0; `ts > now+60s` is a measurement failure; `age == bound`
  passes; bound+1s fails.
- I10: a watched worker with no durable cursor row is never green-by-silence.
- I11: a canceled round context produces no wave-9 conditions.

### Test plan highlights (full citations mandatory; the fake must vary the SUBSTANCE)
- The block→time fake must be NONLINEAR (missed slots), so the elapsed-time tests genuinely fail
  against a block-count predicate.
- `TestStalenessUnmeasuredClearsWhenFetchRecovers` — the single most important clearing path; its
  absence admitted the fail-forever variant both hunters named. Cooldown legs verified via a call
  log; mutation "persist failure past a recovered fetch" killed here.
- `TestNeverIngestedWalkerIsUnmeasuredNotGreen` — carries the deleted `head_lag` test's no-cursor
  property [cites L1].
- `TestFrontierLagAttributesInTime` MUST drive the real `applyProgressConditions` pass — hand-seeding
  the judge memo is shape-without-substance.
- Failure-not-memoized leg: next round refetches per the call log (no fabricated ~56-year age).
- Gross-future leg: `ts = now+10min` → unmeasured, not green, not memoized [kills the
  delete-sanity-check mutant].

---

## CONTROLLER RULINGS on the workflow's open questions (binding for this wave)

- **OQ1 — read-failure erasure.** A failed progress query currently erases every standing red for
  touched workers that round (touch at `main.go:653-675` precedes the reads; whole-round replacement
  deletes the prefix) — a one-round false-green pulse. The pinned no-verdict precedent
  (`health_test.go:943`) loses to the project's fail-closed principle now that these gates are
  money-facing. **Ruling: option (b)** — a failed progress read emits an explicit unmeasured-style
  red (`progress_unmeasured` or similar) for the affected worker, symmetric with the header-fetch
  fail-red rationale. This CHANGES a pinned precedent: update that test with a citation to this
  ruling, and flag the change prominently for Codex round 9.
- **OQ3 — accepted** (see A3): relative-freshness contract, stated honestly, no invented ceiling.
- **OQ4 — rename approved** (local-only deployment); collision test against wave 8's landed names.
- **OQ5 — check first:** if the daemon runs `Migrate` at startup (Phase 1 wired it), old-DB/new-binary
  self-heals and only new-DB/old-binary remains (harmless: unknown column is never read by old code).
  If startup migration is confirmed, note it and skip the runbook rule; otherwise state
  migration-first in the report.
- **OQ6 — accepted:** deploy-time red until each account re-succeeds (≤ ~one generation),
  first-failure flap O(pass duration), permanent red for permanently-reverting accounts is correct
  behavior. Key alerts on condition KEYS.

## Test integrity (unchanged from wave 8, graded)
Every guard/refusal/permanence test carries a comment citing the design clause (A1–A4, L1–L9,
I-numbers, OQ rulings) or finding it enforces. Mutation checks for new guards state the PROPERTY
validated, not just that tests died. Commit before running mutation loops. No test may assert
harmful behavior as expected, assume an impossible store transition, or set up shape without
substance.

## Verification
Baseline: whatever the controller measured at wave 8's landing commit (stated at dispatch). Zero
FAIL / zero SKIP unconditional; report top-level counts and name the convention.
```bash
export PATH="$PATH:/c/Program Files/Go/bin:/c/Users/kasel/go/bin"
export TEST_DATABASE_URL='postgres://solvent:solvent@localhost:5432/solvent?sslmode=disable'
go build ./... && go vet ./... && gofmt -l .   # READ the output
go test ./... -count=1
```
`-race` in the `golang:1.24` container via `host.docker.internal`.

## Scope and process
- Touch: `cmd/indexer/**`, `internal/store/derive.go` (A1 clamp + SweepProgress fields, additive,
  flagged), `internal/snapshot/**` only if genuinely required (flag it), `internal/ingest/walker.go`
  only if L1 requires a read hook (flag it), `internal/store/migrations/<next-free>_*.sql`,
  `.superpowers/sdd/**`.
- Do NOT touch `internal/prices/**` or `internal/store/prices*.go` (wave 8's freshly-landed ground)
  beyond the L9 name-distinctness test.
- Never touch `roadmap/**`. `.env.example` out of scope (SOLVENT_HEALTH_ADDR and any new env vars
  stay documented in `internal/config/config.go`; the controller will handle a scope amendment
  separately). Never edit migrations `00001`–`00005` (nor wave 8's, if it shipped one).
- Stage by explicit pathspec, never `git add -A`. If a gate blocks you, report it — never bypass.

## Reporting
`.superpowers/sdd/task-8-wave9-report-p2.md`: per design — each amendment implemented, each invariant's
citing test, mutation results with properties, the OQ1 precedent change flagged, net cost of the
staleness pass measured or bounded, and anything unverified.

Returns to Codex for round 9 under D-006 (this unit reviewed on its own).
