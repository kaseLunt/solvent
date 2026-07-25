# Task 8 — fix wave 5 report (Codex round-4 findings)

Base `4004589` (wave 4 code at `e262f0a`), branch `main`. All **4 findings implemented as Codex
recommended**; no waivers, no deferrals.

## Verification

Convention: **top-level `--- PASS` lines** (`go test ./... -count=1 -v`), with the subtest count
reported separately, matching the controller's baseline convention.

| | baseline `e262f0a` | wave 5 |
|---|---|---|
| top-level PASS | 472 | **480** |
| incl. subtests | 536 (64 sub) | **558** (78 sub) |
| FAIL / SKIP | 0 / 0 | **0 / 0** |

+8 top-level (3 poller, 1 store, 4 daemon), +14 subtests. Live Postgres `solvent-db-1` via
`TEST_DATABASE_URL`.

```
go build ./...   → clean
go vet ./...     → clean
gofmt -l .       → prints NOTHING (read, not inferred from exit code)
go test ./... -count=1                       → ok, all 9 packages
go test ./... -count=1 -race (golang:1.24)   → ok, all 9 packages, no races
```

`-race` ran in the `golang:1.24` container against live Postgres over `host.docker.internal`.

---

## Finding A1 [high] — paged mismatch proof survives a later reorg (`internal/prices/poller.go`)

### What changed

`probeResumeFrom` carried only a height, so "every anchor above this height was probed and
MISMATCHED" — a statement about one chain state — stayed trusted across `Step`s. Paging state is now
bound to **both** of the things Codex named, and the binding is revalidated at the destructive act:

1. **Reorg generation.** `store.PriceRepairExposure` gained `ReorgGeneration` (the chain's
   `MAX(epoch)`, read in the *same transaction* as the existing counts, so a generation can never be
   paired with counts from another instant). `verifyFloor` stamps its paging state with it and
   `resetVerification` discards the whole pass when it moves — verification restarts from the newest
   anchor rather than resuming into a range whose verdicts may have flipped.
2. **Live-chain checkpoint.** The generation only moves once the *walker* has noticed, which it may
   not have. So the pass also records the highest anchor height it successfully probed, the hash the
   chain reported there, and the endpoint that said so (`noteCheckpoint`, monotone upward within a
   pass). `repair` re-reads that one height **immediately before** `rewindTo`/`neutralize`
   (`checkpointStillHolds`) — because a block hash commits to its whole ancestry, an unchanged answer
   entails every proof at or below it still holds, and a changed answer entails at least one may not.

Three outcomes: unchanged → proceed; **changed** → discard the pass, restart from the newest anchor,
`ConditionPollRewindBlocked`, delete nothing; **unreadable** → treated exactly like a failed anchor
probe (retry, keep the pass), so a probe outage is not confused with a reorg.

The gate wraps only `floorVerified`, `floorProvenOrphaned` and `floorUnverifiable`.
`floorNothingAtRisk` consumes no proof (nothing is above the boundary) and `floorUnprobed` acts on
nothing, so spending a probe there would only shrink the page budget trying to reach a conclusion.

`clearRepairState` clears the checkpoint and the generation stamp too, so a new epoch is never
verified against the last one's checkpoint.

### (a) What differs between `Step`s in the fake, and why that is a real reorg

This is the specific thing wave 4 got wrong, so stating it exactly.

In `TestPollerRewindDiscardsAnchorProofsWhenALaterEpochRestoresThem` and
`TestPollerRewindRefusesWhenTheCheckpointMovedBeforeDeletion`, **the fake chain's answers for the
same heights change between `Step`s**:

- Step 1: `ch.hashes[b] = 0xbeef` for all 16 anchored heights 4000…4150 — chain B, every recorded
  round replaced, so page 1 (4150→4080) mismatches and lowers the resume point to 4079.
- Between Steps: `for _, b := range blocks { ch.hashes[b] = blockHashAt(b) }` — chain A restored, so
  every one of those heights now carries **exactly the hash its anchor recorded**.

That is a reorg in substance, not shape: the canonicality of the specific anchors the cached proof
was about is *inverted*, which is the only thing that can make a stale mismatch dangerous. Wave 4's
interleaving test moved only `st.rewindDeepTo` and left `ch.hashes` untouched, so no anchor's
canonicality ever changed and the path was never entered. A fake returning constant hashes cannot
test a reorg.

The chain state is kept **self-consistent**: the restored chain carries *all* of 4000…4150, never a
mixture where a high block is canonical while its ancestors are not (which no chain can produce).

The two tests differ in exactly one axis, which is what makes them a pair:

| | epoch recorded? | what must catch it |
|---|---|---|
| `…WhenALaterEpochRestoresThem` | yes (`recordReorgEpoch`) | the reorg generation |
| `…WhenTheCheckpointMovedBeforeDeletion` | **no** (walker hasn't noticed) | the checkpoint alone |

**Mutation-verified.** With both mechanisms disabled, the tests fail *on data loss*, not on a
cosmetic assertion: 8 of 16 rows are deleted (`should have 16 item(s), but has 8` — only 4000…4070
survive) and the accepted floor is 4070 instead of 4150. Both gates restored → pass.

`TestPollerRewindRefusesWhenTheCheckpointCannotBeReRead` covers the third outcome: a new fake control
`hashFailAfter` fails only the *second* read of a height, which is the only way to script the
checkpoint re-read apart from the anchor probe of the same height — without it the test would have
been exercising a page containing a failed probe, i.e. an already-covered case.

### Test-integrity correction carried out here

`TestPollerRewindHandlesADeeperEpochArrivingMidVerification` (wave 4) lowered `st.rewindDeepTo`
**without recording an epoch**. A deeper `MIN(rewound_to)` can only come from a new `reorg_epochs`
row, so that was a store state no walker can produce — the rule the brief calls still-binding. It now
lowers the target through `recordReorgEpoch`, and therefore exercises the consequence (a new
generation discards the pass and verification restarts), with a third `Step`. Its old comment claimed
the accumulated mismatches "stay true"; they do not, and that claim is gone.

The fake models the generation honestly rather than by assertion: `reorgGeneration()` floors at 1
whenever `unacked` is true, because the real `HasUnackedReorg` returns false outright when
`MAX(epoch)` is 0 — so `unacked && generation == 0` is a state the store cannot be in.

### Deviations / disclosed costs

- **One extra `eth_getBlockByNumber` per completing repair** (the checkpoint re-read). Deliberate:
  it also closes the *within-`Step`* window, where a reorg lands between probing the top of a page
  and probing the match 8 RPCs later. `TestPollerRewindRetainsRowsBelowVerifiedAnchor` now pins the
  probe sequence `[5000, 4900, 5000]` for exactly that reason.
- **The re-read is routed through the endpoint that established the checkpoint**, deviating from this
  file's otherwise-uniform "spread probes across endpoints" rule. Asking a *different* node conflates
  "the chain moved" with "these two nodes disagree", and the second reading would refuse repairs
  forever on any fleet with one lagging member. Stated in the code.
- **Residual, unchanged trust boundary:** the checkpoint is only as good as the endpoint answering
  it. If that endpoint is gone, failover answers from another and a genuine disagreement reads as
  "the chain moved" → the pass is discarded and re-established from whoever answers now. Fail-closed
  and terminating, not a wedge.

---

## Finding 2 [high] — the frontier pass erased the feed deriver's conditions (`cmd/indexer`)

### What changed

`stepPriceWorkers` no longer touches the surface. It writes into the round's `roundConditions` like
every other pass, and `run()` publishes **once** after the progress/frontier pass. The Chainlink feed
deriver is claimed by two passes (it is a price worker *and* a raw-log consumer), and while they
published independently the later one replaced — deleted — the earlier one's entries: entirely with no
frontier lag, or leaving only `frontier_lag` with it.

### (b) What now prevents a future publisher from silently replacing another's conditions

Two things, and the second is the part that matters for "impossible to repeat" rather than "fixed
here":

1. **There is no per-worker replace primitive left to misuse.** `healthState.setWorkerConditions` is
   gone; the only mutator of the recoverable map is `publishRound(map[string]map[string]string)`,
   which takes the **whole round's composition**. A new publisher has nowhere to write except into a
   `roundConditions` that other passes also write to, and `roundConditions.set` merges by condition
   name. Getting it wrong now requires actively constructing a second map.
2. **A second publication of the same worker inside one round is detected, and is non-destructive.**
   `healthState` counts rounds (`heartbeat` advances the counter — the daemon's real round boundary)
   and records the round each worker was last published in. A repeat inside the same round **merges
   instead of replacing** and logs at `Error` naming the worker. So even if the mistake is made, no
   signal is lost; only the next round replaces, so recovery stays visible.

Additionally `roundConditions.set` reports a **key collision** (two publishers writing the same
condition name for one worker) at `Error`, keeping the first deterministically — readiness turns on a
condition's presence, so the collision itself is the defect worth surfacing.

### Test

`TestFeedWorkerConditionsSurviveTheFrontierPass` runs a whole round in the daemon's real pass order
(price pass → progress/frontier pass → one publication) with a feed worker that both fails its `Step`
and reports a stale stream, and asserts **both** conditions survive:

- `no frontier lag` — the case that used to erase them entirely (consumer exactly at its frontier, so
  the frontier pass has no verdict of its own);
- `frontier lag present` — the case that used to leave only `frontier_lag`;
- `startup cannot clear` — `markInitialized` derives from the surface, so a deleted `step_error` also
  let a daemon whose feed deriver had never completed a round declare itself initialised.

`TestPublishingAWorkerTwiceInOneRoundMergesInsteadOfErasing` pins the guard itself, including that
replacement resumes next round.

**Mutation-verified.** Making `roundConditions.touch` reset rather than register (the same
later-pass-destroys-earlier-pass class) fails all three subtests, including
`does not contain "prices:chainlink_feed:1/step_error"`. Disabling the round guard fails the guard
test.

### Deviations

- ~10 `health_test.go` call sites moved to two helpers, `publishRound` (publish, then close the
  round) and `runPriceRound`, so tests model rounds the way the daemon does. Tests that previously
  published the same worker twice without a round boundary now advance the round — which is what the
  daemon actually does and is why those assertions were meaningful in the first place.

---

## Finding 3 [high] — closed degraded sweep generations treated as healthy

### What changed

**`internal/store/derive.go` was edited, and finding 3 requires it**: its recommendation is literally
to expose these facts "through `SweepProgress`", which lives there. The change is additive — three new
fields and one new parameter; no existing query or semantic was altered.

- `SweepProgress` gains `Failed` (current-generation `status='failed'`), `Exhausted` (those with
  `attempts >= maxAttempts`) and `LastSuccessAt` (newest successful sweep of any account).
- `SweepProgress(ctx, engine, maxAttempts int)` — the budget is the snapshotter's policy, not the
  store's, exactly as `SweepWorkBatch` already treats it. `snapshot.maxSweepAttempts` is now exported
  as `snapshot.MaxSweepAttempts` and the daemon passes it, so a second independently-written copy
  cannot drift and misclassify stuck accounts as still-retrying.
- New condition `snapshot_failures`, and `applySweepProgressCondition` no longer returns early for
  every closed generation.

**Gated on `Exhausted`, not on `Failed`** — the reasoning, since it is a judgement call: a failure with
budget left is *in flight* within the generation (reporting it would make the gate red through every
ordinary transient revert), whereas one without budget is stuck until the next generation opens, a
wait bounded only by `SOLVENT_SNAPSHOT_INTERVAL`. A generation cannot close while an account still
owes work, and a failed account with budget remaining still owes work — so in a closed generation
`Failed == Exhausted` by construction, and this one gate covers both the closed-degraded case *and*
the still-open-but-stuck case, firing as soon as an account burns its budget rather than waiting for
the close. The no-progress verdict is unchanged and still does not judge a closed generation (idle by
cadence ≠ stalled); the two verdicts are separate keys.

### Tests

- `TestSweepProgressReportsExhaustedFailuresThroughGenerationClose` (**live Postgres**) is the test
  Codex asked for. It drives the whole real transition: `SweepWorkBatch` → `ApplySweepBatch` until the
  durable `attempts` counter is spent, then `CompleteSweepGeneration`. Nothing writes a status row or
  an `attempts` value directly — the store's own arithmetic must reach the exhausted state, or the
  test would prove nothing. It pins: `Failed=1, Exhausted=0` while budget remains; exactly
  `MaxSweepAttempts` rounds; `Failed=1, Exhausted=1` after the close; and that the **next** generation
  clears both (the state is recoverable, which is why it belongs in the recoverable half of the
  surface).
- `TestSnapshotExhaustedFailuresFailReadinessEvenWhenTheGenerationClosed` (daemon) covers closed-red,
  open-and-already-exhausted-red, within-budget-green, clean-green, never-swept-green, and asserts the
  daemon passes the snapshotter's own budget.

**Mutation-verified.** Restoring the early return for closed generations fails the closed subtest.

---

## Finding 4 [medium] — two 5,000-block allowances composed into ~10,000

### What changed — and the freshness requirement it is derived from

`headLagBound` and `frontierLagBound` are **gone**. One requirement, stated in time, converted per
chain:

> **`maxDerivedStaleness = 10 * time.Minute`** — derived, liquidation-facing state must be no more
> than ten minutes of chain time behind the chain head the walkers observed.

The derivation, stated because "it matches an existing constant" is the reasoning that was rejected:

- **What the state is for.** These tables answer "is this position liquidatable at the current
  price". An answer computed from state `T` behind head is blind to every borrow, repay, collateral
  move and liquidation inside `T`, and is wrong in the expensive direction — a position reported
  healthy may already be liquidatable. So the requirement is an upper bound on `T`, in time.
- **The floor (achievability).** Ingestion trails head by `confirmations` **by design** — 5 on both
  configured streams, ≈60s of Ethereum chain time at 12s blocks, ≈10s on OP at 2s — and a caught-up
  consumer ends each round at its walkers' frontier. No achievable bound is tighter than roughly one
  minute on Ethereum; below that /readyz would be permanently red on a healthy pipeline, i.e.
  meaningless rather than strict.
- **The ceiling (what this process already refuses to call current).** The feed deriver stops judging
  oracle publication at all once the head block's **own header timestamp** is more than ten minutes
  old, reporting `rpc_ingest_lag` instead (`internal/prices.headFreshnessBound`) — this daemon already
  declares that a view of the chain older than ten minutes is *our* pipeline failing. Serving derived
  state that is further behind head than the process's own threshold for "we can see the chain" cannot
  honestly be called ready.
- **Therefore ten minutes**: the loosest value at which /readyz still means anything, ~10× above the
  achievable floor on the slower chain so ordinary jitter cannot trip it.

Per chain: `chainLagBound(chainID) = maxDerivedStaleness / blockTime` — **50 blocks** on Ethereum
(12s slots), **300** on OP (2s). `fallbackBlockTime = 12s` for an unlisted chain, which is the
**fail-closed** direction (a larger assumed block time yields a *smaller* allowance, so an unlisted
chain gets the tightest bound, not the most permissive); startup WARNs when it is used.

**Why this is not a re-tuning.** Bounding two hops separately cannot bound a path. Both gates now
measure distance from the **same origin** (chain head), so the worst of them *is* the end-to-end
distance and there is no second constant to add to a first:

- `head_lag` on a walker: its own `HeadLag()`.
- `head_lag` on a consumer: `observedHead - deriveCursor`, using the new
  `ingest.Walker.ObservedHead()` — a consumer's cursor and frontier are both in the database, but the
  head they are behind is known only to the walker that read it.
- `frontier_lag` is **retained as attribution only** (which component is behind), against the *same*
  bound. Since the frontier is at or below head, it can never exceed the head distance, so it cannot
  widen the total. Its reason string now says what it measures; the `head_lag` message reports the
  head, the frontier and the split of the gap across the two hops.

### Test

`TestLagBoundsDoNotComposeIntoAWiderTotal` is the boundary case: walker at **exactly** its permitted
lag (so its own `head_lag` is correctly silent) feeding a consumer **exactly** its full allowance
below that frontier → end-to-end `2 × bound` → `head_lag` fires and readiness is red. Plus: a
caught-up consumer behind a walker at its limit stays **ready** (equality passes, so the gate is not
just always-red); one block past the bound from either hop fails; and the bound is chain-specific and
equals `maxDerivedStaleness / blockTime` for both chains and the fallback.

**Mutation-verified.** Restoring the frontier-only consumer gate fails both the composition subtest
(`does not contain "aave_v3_etherfi/head_lag"`) and the consumer-one-block-over subtest.

### New hazard introduced by the single bound, and how it is surfaced

A walker sits `confirmations` behind head by design, so a stream configured with
`confirmations >= chainLagBound(chain)` could never satisfy the gate — readiness red forever on a
healthy pipeline. That is a configuration/requirement conflict, not a stall, and `run()` now WARNs at
startup naming the stream, its confirmations and the bound. Today's config (5 vs 50/300) is three
orders inside it.

---

## Scope and process

- Files touched: `cmd/indexer/{main,health,health_test}.go`,
  `internal/prices/{poller,prices,poller_test,prices_test}.go`, `internal/ingest/walker.go`,
  `internal/snapshot/{snapshot,snapshot_test}.go`,
  `internal/store/{derive,prices,prices_repair_test}.go`. All inside W1 `allowed_paths`.
- **`internal/store/derive.go` was touched, and finding 3 requires it** (see above). Additive only.
- `internal/store/prices.go` gained one field on `PriceRepairExposure`, read inside the existing
  transaction. No migration was needed — `ReorgGeneration` comes from `reorg_epochs`, which already
  exists; **no `00006`, and `00001`–`00005` untouched**.
- `.env.example` untouched. `roadmap/**` untouched. No `git add -A`; staged by explicit pathspec.
- No pre-commit gate blocked anything, and nothing was bypassed.

## Honest residuals

- **The checkpoint is not a cryptographic proof.** It rests on the same RPC trust every ingested log
  rests on, and is re-read through the endpoint that established it (reasoning above).
- **A consumer's `head_lag` needs a walker to have observed a head.** Before the first successful head
  read there is no origin to measure from, so only `frontier_lag` applies; the walkers' own step
  errors are the signal meanwhile. First-round-only in practice, since the walker pass runs first.
- **`snapshot_failures` does not bound how long a failed account stays failed.** It reports the state
  and how stale the surviving snapshot is; the remedy is the next generation. No new time bound was
  invented for it.
- **`maxDerivedStaleness` is now a single knob** governing every lag gate. That is the point, but it
  means a change to it moves both gates at once — which is why the requirement, not the number, is
  what the comment defends.

Returns to Codex for round 5 under D-006.
