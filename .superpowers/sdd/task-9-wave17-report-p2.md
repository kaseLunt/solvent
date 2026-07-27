# Task 9 — wave 17 report: round-15 fixes (ingest) — probe outcome discipline, per-witness Σ-attempts, no probe rewind authority

Brief: `task-9-wave17-brief.md` (BINDING), implementing the Codex round-15
findings (`task-9-codex-round15.md`, 2H2M1L, all five VALID) **as modified by
the chain-truth consult** (`consult-chaintruth-round15.md`, BINDING: its
blocking list was this wave's work order; its R-A..R-J matrix is met in full;
its REFUTATION of the provisional reject-on-failure ordering is implemented —
probe FAILURE flows through the wave-12 seam advance, never a reject arm).

Base: start commit `66adaa4` (round-15 archive + this brief). Branch `main`,
parallel tree — wave 16 (reconcile/store/indexer, round-14 fixes) ran
CONCURRENTLY and landed four sibling commits mid-wave (`5b53306`, `6dff5f3`,
`8454ee7`, `c5deebc` — all outside my pathspecs; reconciled test-by-test
below). Scratch DB `solvent_t9w17` (created this wave; never `solvent`,
`solvent_test`, or another wave's DB); the running indexer daemon and
`solvent-db-1` untouched throughout.

**THIS WAVE REOPENS CODEX-REVIEWED SURFACE UNDER D-006, SAY-SO, PLAINLY:**
`internal/ingest/walker.go` (reviewed by rounds 12 and 15) is structurally
reworked again — the probe gains outcome discipline, the seam gains a
witness-less arm, adjudication changes units. `internal/chain/chain.go`
(senior-approved through the wave 5-9 reopen, round-15-reviewed) is reopened
ADDITIVELY ONLY: one exported constant, one `doFromTimed` walk, three timed
From variants; no existing chain method's signature or behavior moved.
`cmd/indexer/**` is UNTOUCHED (wave 16 owns it; the daemon-level items I
could not express at the walker layer are FLAGGED below, not smuggled).
`cmd/reconcile/**`, `internal/store/**`, `internal/prices/**`,
`internal/snapshot/**`: untouched (the consult RULED the lease-length chain
prose-only — prices/snapshot were not forced and were not touched).

| commit | contents |
| --- | --- |
| `ecfe8ce` | THE FIX: walker probe-outcome discipline + Σ-attempts adjudication + witness-less seam arm + probe rewind refusal + probe-target cycling (`walker.go`); chain additive timed variants + exported `AttemptTimeout` (`chain.go`); fake timed contract (`walker_fake_test.go`); slow-store fixture (`walker_test.go`); ALL wave regressions (`walker_probe_discipline_test.go` NEW, `chain_timed_from_test.go` NEW); one stale seam comment updated (`walker_rotation_test.go`, assertions untouched) |
| `93334b2` | mutation spec `.superpowers/sdd/t9w17-mutations/mutations.json` (10 mutants), committed BEFORE the loop |
| `0aab45d` | mutation transcript, **10/10 KILLED**, tested SHA `93334b2`, in-memory restores verified byte-identical |
| (this commit) | `task-9-wave17-report-p2.md` |

Scope: `git diff --name-only 66adaa4..0aab45d` restricted to MY commits =
`internal/ingest/{walker.go, walker_fake_test.go, walker_test.go,
walker_rotation_test.go, walker_probe_discipline_test.go}`,
`internal/chain/{chain.go, chain_timed_from_test.go}`,
`.superpowers/sdd/t9w17-mutations/**`. Pathspec staging on every commit; the
scope gate accepted each (7, 1, 1 paths). The four interleaved sibling
commits are wave 16's (`cmd/reconcile/**`, `cmd/indexer/**`,
`internal/store/**`, their sdd records) — verified by `git show --stat`,
zero file overlap with mine; wave 16's UNCOMMITTED working-tree edits were
present in the shared tree throughout, which is why every verification run
below used PINNED WORKTREES, never the shared tree.

## The fix, precisely — the corrected total ordering (consult Q1, implemented verbatim)

The wave-12 seam is unchanged in shape: one deferred outcome handler, zero
value non-landing, landing the only WITNESSED outcome that keeps the starting
point. What changed:

| probe Step posture | this wave's behavior | mechanism |
| --- | --- | --- |
| LANDED, witness ≠ incumbent, strictly faster (Σ-attempts) | ADOPT: retention transfers, probe cursor resets, adopted lease starts from the witness's OWN measure (clean under budget / 1 over) | `recordLanding` probe arm |
| LANDED, witness ≠ incumbent, no faster / tie | REJECT + re-arm IN FULL + probe cursor advances; routing no-op | `recordLanding` → `rejectProbe("no-faster")` |
| LANDED, witness == incumbent (fall-through) | incumbent measured CLEANLY (neighbour's dwell outside Σ) but REJECT + re-arm in full + cursor advances (R15-2a — re-entering ordinary accounting would restore the per-Step tax) | `recordLanding` → `rejectProbe("fall-through")` |
| CAUGHT-UP | REJECT + re-arm in full + cursor advances; the armed state lives exactly ONE Step (R15-1) | the seam's caught-up arm, probing leg → `rejectProbe("caught-up")` |
| NON-LANDING with a resolved witness | NOT special-cased — the wave-12 seam arm VERBATIM: advance past the probe witness, lease dissolves, probe cursor resets (R15-2c; at n=2 this IS return-to-incumbent, at n≥3 the escape past a content-broken neighbour — the provisional reject-on-failure ordering is REFUTED and NOT implemented) | the seam's default arm |
| TOTAL resolution failure (witness-less) | joins the seam as its WITNESS-LESS arm: startPref unchanged, lease count + baseline + armed flag + probe cursor ALL preserved (R15-2b; ledger :80's antecedent unsatisfied — reset would let a flapping network suppress probes forever) | the defer is installed BEFORE resolution; the default arm keys on `servedBy.Index < 0`; no return sits between resolution and the handler |

Non-probing postures are byte-for-byte the wave-14 semantics (ordinary
landing accounting, non-probing caught-up untouched, witnessed non-landing
advance) — every pre-wave regression passes unmodified.

## The Σ-attempts mechanism and its chain-side signature (R15-3, R15-4)

**Adjudicated quantity:** Σ over the Step's reads of the SERVING attempt's
own elapsed time — never the Step wall, never the call wall. Chain-side:

```go
// internal/chain (ADDITIVE; untimed siblings untouched — HeaderHashFrom has
// consumers outside wave-17 scope, a signature change there is forbidden)
func (f *Failover) BlockNumberFromTimed(ctx, startIndex) (uint64, EndpointToken, time.Duration, error)
func (f *Failover) HeaderHashFromTimed(ctx, startIndex, n)  (common.Hash, EndpointToken, time.Duration, error)
func (f *Failover) LogsFromTimed(ctx, startIndex, from, to, addrs) ([]types.Log, EndpointToken, time.Duration, error)
```

backed by `doFromTimed` — doFrom's exact walk with `time.Now` sampled around
each attempt alone; only the SERVING attempt's elapsed is returned (0 with
the -1 token on total failure). The elapsed is a RETURN, not an
`EndpointToken` field, exactly per the consult: the signature forces
population at the three call sites that adjudicate on it; a token field is
forgettable at ten producer sites. The walker's `Chain` interface consumes
ONLY the timed variants; `Step` accumulates `served += d` across its reads,
and `rewindToVerifiedAncestor` accumulates its pinned header walk into the
same sum via a pointer (a slow rewind is a slow witness; its store reads —
`HighestLogAtOrBelow` — stay outside, like `store.Cursor` and `SaveBatch`,
BY CONSTRUCTION: only RPC attempts are summable, so R15-4 is subsumed
structurally, asserted as a property in R-E, never as a subtraction).
`slowBaseline` is now the incumbent's most recent over-budget Σ-attempts —
same units on both sides of every probe comparison.

**Fixture realism:** the fake's timed methods return the SERVING endpoint's
own scripted `readCost` — the same value `spend` charges to `advanceClock` —
so wall and Σ DIVERGE whenever a failed attempt paid cost (hung-to-timeout =
`down` + `readCost=T`, spend-before-down-check; fast-failing = `down` +
`readCost=0`). That divergence is what killed the wall mutant (W17M5).
**Hermetic production proof (R-H, consult-mandated):**
`chain_timed_from_test.go` drives the REAL stack (Dial → rpc.Client over
HTTP) against a primary that holds every ask 200ms then fails and a fast
raw-JSON secondary: for all three timed methods, call wall ≥ 200ms while the
token's servedElapsed < 100ms (and > 0) — attempt-scoped in production code,
not just at the fake layer. Plus the total-failure face: -1 token, zero
elapsed, no fabricated measurement.

## The compile-time alias (R15-5a) and the lease-length prose (R15-5b)

`internal/chain` now exports `const AttemptTimeout = defaultAttemptTimeout`
(doc: exists for cross-package derivation binding), and ingest's mirror
became `const chainAttemptTimeout = chain.AttemptTimeout`. Drift is
UNREPRESENTABLE — if the chain bound moves, ingest's budget derivation moves
atomically — which is stronger than restate-and-assert, so no equality test
exists on purpose. W17M10 still guards the DERIVATION relation
(budget-vs-ceiling), which the alias does not cover. This closes the wave-14
report's first unverified item exactly as promised there ("a one-line
exported constant in a future chain-open wave"). The lease-length chain
(`MaxConsecutiveSlowLandings` vs prices vs snapshot) is PROSE-ONLY per the
consult's ruling: the comment now cites d1e7d54 as an adoption-time citation
("=3 at adoption; policy siblings, not a shared constant; divergence changes
no invariant here"); `internal/prices` and `internal/snapshot` untouched.

## The R15-6 refusal shape (stated exactly)

A cursor-hash mismatch during a probe Step is a DISCARD (non-landing,
`*DiscardError` "a probe carries no rewind authority", seam advances past the
probe witness, lease dissolves) **when the serving witness is the probed
neighbour (`probing && servedBy.Index != incumbent`)**. The refusal is
deliberately scoped to the probed WITNESS, not to the probing flag alone:

- the scoped arm closes exactly what R15-6 names — a witness the stream has
  ZERO landing evidence for must not authorize a destructive rewind on its
  sole word, nor be adopted off the churn it causes (a rewind counts as a
  landing, and a probe rewind would enter the adoption comparison);
- a probe Step whose resolution FELL THROUGH to the incumbent keeps the
  incumbent's standing rewind authority: the incumbent IS the retained
  witness (three landings armed the lease), so this sub-case is byte-for-byte
  the pre-lease behavior. Refusing it instead would advance routing past the
  healthy incumbent on a genuine reorg and hand next Step to the unvetted
  neighbour as an ORDINARY witness with FULL rewind authority — recreating
  the exact exposure R15-6 closes, one Step later, plus a Step of delay.

Cost of the refusal: one Step of delay on a genuine reorg that lands inside a
probe Step (pinned by the R-F genuine-reorg leg: the rewind happens on the
incumbent's next Step with retained-witness authority, target = verified
ancestor). This does NOT implement F3 — corroborating any mismatch on a
second witness before any rewind remains its own future ratified clause.

## The four trace tables (mandated)

**1. Round-12 schedule (escape at Step L+1)** — `TestSlowSuccessfulEndpointIsEscapedWithinTheStatedBound`, shipped wave-14 test, UNMODIFIED (byte-identical to `b9c5c33`'s, gate met). n=2, A = (T−1s)/read, B = 50ms/read:

| Step | start | posture | Σ-attempts (witness) | lease after |
| --- | --- | --- | --- | --- |
| 1 | 0 | landed (fresh walk, 4 reads) | 116s (A) | 1 slow, baseline 116s |
| 2 | 0 | landed (6 reads) | 174s (A) | 2 slow, baseline 174s |
| 3 | 0 | landed | 174s (A) | 3 slow — SPENT |
| 4 | 1 (probe) | landed | 300ms (B) < 174s | ADOPT: startPref=1, clean |
| 5 | 1 | landed | 300ms (B) | quiet |

Escape at Step `MaxConsecutiveSlowLandings+1` = 4 exactly; wall ≤
(L+1)·R·T = 12 min asserted; trace `[0,0,0,1,1]`; hint untouched; no landing
sacrificed. The n=2 reduction of the general bound below.

**2. Round-15 finding-2 schedule (bounded probe tax)** — `TestFallThroughProbeReArmsAndTheTimeoutTaxIsPaidOncePerLease` (NEW). n=2, A = (T−1s)/read (lands everything), B = hung-to-timeout (`down` + readCost=T):

| Step | start | posture | Step wall (clock arithmetic, exact) | lease after |
| --- | --- | --- | --- | --- |
| 1 | 0 | landed | 4·29s = 116s | 1 slow |
| 2-3 | 0 | landed | 174s each | 3 slow — SPENT |
| 4 | 1 (probe) | fall-through landed on A | **T + 174s = 204s** (B's hang paid ONCE) | REJECT → re-armed in full |
| 5-7 | 0 | landed | **174s each — B's T absent, asserted exactly** | 3 slow — SPENT |
| 8 | 1 (probe) | fall-through landed | T + 174s | REJECT → re-armed |

All 8 Steps land (zero landings sacrificed); trace `[0,0,0,1,0,0,0,1]`. Tax:
≤ 1×T per (L+1) Steps — amortized 7.5s/Step ≈ 4.3% over the 174s pathological
baseline, versus +T EVERY Step pre-fix (Codex's ~17-minute round). Worst
single `stepWalkers` round carries ≤ 2 probe Steps ⇒ probe tax ≤ 2T = 60s per
round on top of the fleet's genuine slowness (daemon-side figure restated
from the consult; the daemon composition itself is wave-16 surface and was
not touched — the shipped `cmd/indexer` scheduling pins were re-run green).

**3. R15-7 shield schedule at n=3 (escape via cycling)** — `TestRejectedProbeCyclesTheTargetPastTheShieldToTheFastPeer` (NEW). A = (T−1s)/read, B = (T−0.9s)/read (lands, always no-faster: the SHIELD), C = 1s/read:

| Step | start | posture | Σ-attempts | outcome |
| --- | --- | --- | --- | --- |
| 1-3 | 0 | landed | 116s/174s/174s (A) | lease SPENT, baseline 174s |
| 4 | 1 (probe, displacement 1) | landed | 174.6s (B) ≥ 174s | REJECT; probe cursor → displacement 2 |
| 5-7 | 0 | landed | 174s (A) | lease SPENT again |
| 8 | 2 (probe, displacement 2) | landed | 6s (C) < 174s | **ADOPT — the shield is broken** |
| 9 | 2 | landed | 6s (C) | quiet |

Escape at Step 8 = (n−1)(L+1) EXACTLY, asserted from the same constants.
Without cycling (mutant W17M7) Step 8 re-probes B and C is never measured —
the round-12 pin recreated one level up, which is why the wave-14 bound could
not ship as a general claim. **The stated escape bound is now
≤ (n−1)(L+1) Steps, wall ≤ (n−1)(L+1)·R·T (n=3: 24 min once); the n=2
instance reduces to the shipped 12-minute bound, and every n=2 trace is
byte-identical (displacement cycle {1}) — gate met: both wave-14 regressions
green UNMODIFIED, `git diff 66adaa4 -- walker_latency_test.go` empty.**

**4. A-bounce family (still green)** — `TestSlowerProbeReturnsToTheIncumbentAndReArmsTheLease`, shipped wave-14 test, UNMODIFIED. n=2, A = (T−1s)/read, B = (T−0.5s)/read (uniformly degraded fleet, nowhere better to be):

| Steps | trace | property |
| --- | --- | --- |
| 1-8 | `[0,0,0,1,0,0,0,1]` | one bounded probe per spent lease, period L+1; every Step lands; startPref never left 0; hint untouched; the no-better probe re-arms in full — never a bounce, never an adoption |

The consult's no-bounce argument holds implementation-side: every rejection
consumes exactly one Step per spent lease and returns to a startPref that
never moved; the only non-landing probes flow through the seam, the standing
anti-bounce machinery (R3/R5 family, all green unmodified).

## Consult notes, all addressed

- **R15-8 (probe stamps lastHead/ObservedHead from the probed witness):**
  bounded to ONE Step per spent lease post-fix and asserted in R-A
  (ObservedHead reads the frozen 254 after the probe Step, back to 1000 one
  Step later); disclosed in Step's doc comment. Pre-fix it was every Step —
  HeadLag green-masking the very stall finding 1 said durable freshness would
  catch.
- **n=1 armed-lease gap (wave-14 disclosed):** closed by R-I
  (`TestSingleEndpointSpentLeaseNeverProbesAndRetentionStands`) — count grows
  past L honestly, no probe, no pretend rotation, every Step lands.
- **stepMaxPinnedReads ask-count guard:** closed by R-J
  (`TestMaximalWindowStepAskCountMatchesStepMaxPinnedReads`) — one maximal
  cursor-bearing window Step performs exactly `stepMaxPinnedReads` fake asks.
- **Ceiling prose scoped to window Steps (R15-9):** the `stepMaxPinnedReads`
  and `slowStepBudget` comments now scope the blind-spot ceiling to WINDOW
  Steps; a rewind Step's header walk is unbounded by it and its Σ is real
  evidence.
- **Wall-clock claim re-scoped (consult constraint 9):** the lease bounds RPC
  OCCUPANCY in Σ-attempt units (stated at `slowStepBudget`); SaveBatch
  occupancy is outside its jurisdiction. The wave-14 report's "wall includes
  store by design" rationale is SUPERSEDED by this wave.

## Daemon-level items FLAGGED for the closing round (wave-16 boundary, nothing smuggled)

1. **Slow-store visibility** is a real operational need and is NOT endpoint
   adjudication (consult Q4). Nothing is wired in `cmd/indexer`; I also chose
   NOT to ship the optional walker-side `LastStepTimings()` observer — the
   consult explicitly allowed shipping without it, and an observer nobody
   consumes is dead surface for the closing round to review. The daemon
   store-latency health signal remains OPEN, daemon-owned.
2. **Compound pathology throughput ×0.6** (slow incumbent AND frozen
   neighbour): a caught-up probe Step returns `(false,nil)` and `stepWalkers`
   breaks the walker's round at `cmd/indexer/main.go` (`if !advanced

	break`, the :693-694 arm) — each round delivers ~3 landings instead of 5
   under the compound schedule. Bounded, honest, self-healing when either
   pathology clears; the alternative (re-resolving inside the Step) would
   break one-witness-per-Step. DISCLOSED, not fixed; any treatment belongs to
   a `cmd/indexer` wave.
3. The daemon-round probe-tax figure (≤ 2T per round, table 2) is restated
   from the consult; only its walker-layer half (≤ 1×T per L+1 Steps) is
   pinned by a test here.

## Non-claims (stated, per the consult's refusal list)

- **This wave does NOT cover F4 (frozen INCUMBENT / single endpoint).** The
  fix closes the frozen-NEIGHBOUR probe capture — a surface wave 14 itself
  built. F4's rider (caught-up while durable freshness is red ≥K rounds
  counts as non-landing) still needs its own ratified clause. The
  serendipitous partial mitigation — an incumbent freezing while the lease
  happens to be armed may get escaped by the probe — is luck, not coverage,
  and is not cited as coverage.
- **This wave does NOT implement F3 (rewind corroboration).** R15-6 declines
  to EXTEND rewind authority to unvetted witnesses; ordinary Steps' serving
  witnesses keep their standing single-witness rewind authority (annex F3's
  churn-not-corruption grading unchanged).
- **The caught-up-probe-ends-daemon-round compound pathology** is
  daemon-owned and out of scope (flag 2 above).
- **No claim about real-latency lease behavior beyond the harness** — see
  unverified list.

## Verification summary (convention: top-level `^--- PASS` / FAIL / SKIP)

- **Baseline @ `66adaa4`: 768 / 0 / 0, exit 0**, via `make test-acceptance`
  in a PINNED WORKTREE at the start commit (mandatory this wave: wave 16's
  uncommitted edits sat in the shared tree the whole time — the suite never
  raced the shared tree in either direction). Posture: gate ON
  (`SOLVENT_LIVE_RPC_TESTS=1`), `TEST_DATABASE_URL` → **`solvent_t9w17`**
  (own scratch DB, created this wave), `.env` DSNs exported by the Makefile,
  `SOLVENT_RPC_*` cleared by the target. Target gate: "acceptance mode:
  exit=0 skips=0". 768 matches wave 15's reported final exactly — the
  interval since was docs-only, consistent.
- **Final @ `0aab45d`: 793 / 0 / 0, exit 0**, same posture, same target, in a
  PINNED WORKTREE at `0aab45d` (clean checkout — the shared tree still
  carried wave-16's in-flight edits, which no acceptance evidence of mine may
  include). Gate: "acceptance mode: exit=0 skips=0", "acceptance suite green:
  zero skips". The code delta `ecfe8ce..0aab45d` is sdd-docs-only, so the run
  exercises byte-identical Go trees to the implementation commit.
- **PASS-list diff, both directions: 0 removed, exactly 25 added; 768+25=793.**
  **Sibling reconciliation, explicit:** 15 additions are this wave's tests
  (11 in internal/ingest, 4 in internal/chain — the tables above and R-H);
  the other 10 are wave 16's, landed mid-flight in `5b53306`, and the set
  matches that commit's `+func Test` list NAME FOR NAME
  (TestAmbientPGHostTaintsAcceptance, TestConnectedIdentityRecordsServerTruth,
  TestEnvVsPersistedMismatchTaintsAndNeverWidens,
  TestMigrateUpgradesV8AddingConfiguredIntervalNullEverywhere,
  TestPartialDSNIsRejected, TestPersistSweepIntervalToleratesWriteFailure,
  TestPersistSweepIntervalWritesConfiguredCadence,
  TestPersistedDaemonCadenceGovernsFreshnessBound,
  TestPreMigrationRowsFallBackFailClosed, TestSnapshotDBCapabilityBoundary);
  wave 16 removed/renamed nothing (`-func Test` count zero over the
  interval). No pre-existing test changed name, assertion, or vanished —
  wave-12's R1-R7 rotation suite, both wave-14 latency regressions, the
  walker_test.go caught-up pins and both cmd/indexer scheduling pins all run
  unmodified.
- **-race (internal/ingest + internal/chain — the two packages this wave
  touches) in `golang:1.24` via docker (volume `solvent-gomodcache`), gate ON,
  at the `0aab45d` pinned worktree: exit 0, 104 top-level `^--- PASS` / 0
  FAIL / 0 SKIP, zero DATA RACE, both packages `ok`** — including the live
  OP incident-hash regression and all 15 of this wave's tests. (No DB needed:
  neither package touches Postgres — which is R15-4's point, structurally.)
- **Build/vet:** `go build ./...` clean (the whole tree, wave-16 WIP
  included, compiles against the changed ingest.Chain interface — cmd/indexer
  passes `*chain.Failover`, which satisfies the timed interface additively);
  `go vet ./internal/ingest/ ./internal/chain/` clean.
- **Committed-blob gofmt:** all 7 touched `.go` blobs at `ecfe8ce` extracted
  via `git cat-file` to temp files — `gofmt -l` CLEAN (the working-tree check
  stays CRLF-noisy repo-wide; the blob check is the bar).
- **Environment:** backfill daemon against DB `solvent` untouched (never
  stopped, never signaled); `solvent-db-1` container untouched; tests only
  ever pointed at `solvent_t9w17`.

## Mutation matrix (committed applier `wave16-mutations/mutate.py`; spec `93334b2`, transcript `0aab45d`, tested SHA `93334b2`)

Every pattern exactly-once-asserted; every restore from in-memory copies,
verified byte-identical; `git status` over the mutated file EMPTY after the
loop; every kill names real failing tests — every mutant COMPILES (the spec's
note documents how each replacement keeps orphaned identifiers referenced).

| # | mutation (consult row) | result | killed by |
| --- | --- | --- | --- |
| W17M1 | caught-up probe leaves armed lease untouched — revert R15-1 (R-A) | **KILLED** | `TestFrozenNeighbourCaughtUpProbeIsRejectedAndTheLeaseReArms` |
| W17M2 | fall-through keeps lease spent — revert R15-2a (R-B) | **KILLED** | `TestFallThroughProbeReArmsAndTheTimeoutTaxIsPaidOncePerLease` |
| W17M3 | witness-less arm resets the lease (R-C i) | **KILLED** | both witness-less regressions |
| W17M4 | witness-less guard deleted → witnessed non-landing arm (R-C, adjacent killable shape of ii) | **KILLED** | both witness-less regressions |
| W17M5 | adjudicate on whole-Step wall — revert R15-3, re-includes store time R15-4 (R-D + R-E) | **KILLED** | `TestProbeAdjudicatesOnTheServingWitnessOwnElapsedNotTheWalkWall` (+ subtest), `TestSlowStoreCommitsNeverArmTheLease` |
| W17M6 | probe rewind authority restored — revert R15-6 (R-F) | **KILLED** | both R-F regressions |
| W17M7 | probe-target cursor never advances — revert R15-7 (R-G) | **KILLED** | `TestRejectedProbeCyclesTheTargetPastTheShieldToTheFastPeer` |
| W17M8 | W14M1 re-anchored: lease removed, unconditional retention | **KILLED** | both wave-14 latency regressions |
| W17M9 | W14M2 re-anchored: probe adopts unconditionally | **KILLED** | `TestSlowerProbeReturnsToTheIncumbentAndReArmsTheLease` |
| W17M10 | W14M3 re-anchored: budget drifted to the blind-spot ceiling | **KILLED** | `TestSlowSuccessfulEndpointIsEscapedWithinTheStatedBound` |

**The consult's R-C mutant "(ii) restore the early-return bypass" is NOT in
the spec, on purpose, disclosed:** the consult itself records the wave-14
bypass as *"behaviorally identical for this posture but structurally
lawless"* — at the current arm count no schedule distinguishes a
before-the-defer return from the witness-less arm, so listing that mutant as
KILLED would be a fixture that cannot fail (the round-13 lesson). The two
killable adjacent shapes (W17M3 reset, W17M4 guard deletion) are speced and
killed; the structural law itself ("no return between resolution and the
handler") is enforced by the seam's comment and this disclosure, and becomes
mechanically killable the day a second witnessed arm lands in the handler.

Wave-12's and wave-14's committed specs remain valid FOR THEIR RECORDED SHAs
only (`d6cb441`, `0340ed0`); their landed-arm/comparison/budget patterns
moved again this wave, which is why the three wave-14 properties are
RE-ANCHORED here as W17M8-10 rather than re-run blind (the consult's
restate-don't-rerun instruction).

## Unverified / limits (nothing hidden)

- **The lease/probe machinery's behavior under REAL latency remains proven at
  the fake layer only** (the walker's `now` seam + the fake's shared-clock
  contract). What IS now proven in production code, hermetically, is the
  chain layer's attempt-scoped measurement (R-H, real Dial); the composition
  of that measurement with the lease under real half-minute latencies still
  has no live slow-endpoint injection run. Wave-14's disclosure carries
  forward, narrowed by exactly R-H.
- **The witness-less arm's structural seam membership has no killable mutant
  at the current arm count** — disclosed above with the reason; behavioral
  preservation itself is pinned twice (R-C legs) and both adjacent evasion
  shapes die.
- **The (n−1)(L+1) bound is pinned at n=3 exactly** (R-G) and reduces to the
  shipped n=2 pin; no n≥4 trace is asserted (the bound's derivation is
  arithmetic over the same cycle, but only n∈{2,3} are test-witnessed).
- **The R15-6 refusal's fall-through sub-case** (probe Step, resolution fell
  through to the incumbent, incumbent reports a genuine mismatch → incumbent
  rewinds THIS Step with standing authority) is argued above and covered by
  inspection; no dedicated regression scripts that triple coincidence (probe
  + neighbour-down + reorg in one Step). The two R-F legs pin the two
  adversarial faces (unvetted-witness refusal; genuine-reorg one-Step delay).
- **Daemon-side figures** (×0.6 compound-pathology throughput, ≤2T/round
  probe tax) are restated from the consult, not measured here — cmd/indexer
  is wave-16 surface; flagged for the closing round.
- The R-H timing assertions use generous margins (wall ≥ 200ms, served
  < 100ms on a local loopback) — on a pathologically loaded CI box the
  served bound could in principle flake; the 2× headroom and the `> 0` floor
  are the chosen trade against a fixture that cannot fail.

## Returns to Codex under D-006 — the ingest closing round, attempt two

Recommended framing: diff `68ccfdb` (wave-12 base) → this wave's final,
restricted to `internal/ingest/**`, `internal/chain/**`, `cmd/indexer/**` —
that range now contains the whole wave-12 surface, wave 14, round-15's fixes
(this wave), and wave 16's cmd/indexer sibling commits (whose review is
wave-16's own round; the overlap is disclosed so neither round's framing
misses `cmd/indexer/main.go` interval changes). Suggested targets: the
corrected probe ordering's arm coverage (rejectProbe's three callers, the
witness-less guard, the probing caught-up leg), the Σ-attempts accumulation
sites (five reads + the rewind pointer), doFromTimed vs doFrom parity, the
R15-6 witness-scoping argument, probe-target cycle arithmetic at n≥3, and
the R15-8 one-Step residual.
