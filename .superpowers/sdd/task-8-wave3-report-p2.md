# Task 8 — fix wave 3 report (Codex round-2 findings)

Repo `C:\Users\kasel\source\repos\etherfi\Solvent`, branch `main`. Base `23927f1`;
wave 1 landed at `ce053bd`. All 8 round-2 findings addressed, none waived.

## Verification

```
go build ./...                      clean
go vet ./...                        clean
gofmt -l .                          EMPTY (output read, not just exit code)
go test ./... -count=1              510 PASS / 0 FAIL / 0 SKIP   (baseline 423)
go test ./... -count=1 -race        PASS, all 9 packages
```

`-race` ran in the `golang:1.24` container against live Postgres via
`host.docker.internal` (`MSYS_NO_PATHCONV=1 docker run --rm -v
C:/Users/kasel/source/repos/etherfi/Solvent:/src -w //src -e
TEST_DATABASE_URL=…host.docker.internal… --add-host=host.docker.internal:host-gateway`).
Live-Postgres tests ran on the host too (`solvent-db-1`); `internal/store` is 20s of
real database work, not skipped.

+87 net test cases. No migration was needed — see "Deviations".

## The two principles, and where they are enforced

### Principle 1 — health may be refreshed ONLY by a durable, newly-observed fact

**The apply contract now returns what it durably did.** This is the structural
change Codex asked for, and it is the spine of the wave.

`internal/store/prices.go`:

```go
type PriceInsert struct {
    Asset []byte; Source string; BlockNumber uint64
    ObservedAt time.Time      // prices.observed_at, as the DATABASE assigned it
    Valid bool; InvalidReason string
}
type ApplyResult struct {
    Inserted         []PriceInsert  // ONLY rows this call created
    AnchorInserted   bool           // ONLY when a NEW anchor row came into existence
    AnchorBlock      uint64
    AnchorObservedAt time.Time
}
func (s *Store) ApplyPrices(...)       (ApplyResult, error)
func (s *Store) ApplyPolledPrices(...) (ApplyResult, error)
```

`insertPrice` and `insertPollAnchor` obtain the timestamp from the INSERT's own
`RETURNING observed_at`, so `pgx.ErrNoRows` **is** the "this was an idempotent
replay" signal. There is no code path that can produce a timestamp for a row the
call did not create.

**Where the invariant becomes structural rather than conventional** —
`internal/prices/poller.go`, `recordDurableInserts`:

- It is the **only** function in the poller that moves a health signal forward,
  and its only input is a `store.ApplyResult`.
- It derives no timestamp. There is no way to express "this round was fresh"
  without a row to point at. `res.Inserted == nil` ⇒ every cache is untouched.
- A frozen endpoint's equal-height replay therefore cannot refresh anything **by
  construction**. `Step`'s success path contains no `p.now()` at all.
- On commit error the store returns `ApplyResult{}` and discards the result
  entirely (`applyPrices`' commit arm), because a commit error does not prove the
  batch failed to persist — recovering the truth is the caller's re-hydration job.

Pinned by `TestApplyPricesReportsOnlyRowsItActuallyInserted`,
`TestApplyPolledPricesReportsAnchorInsertionOnlyOnce` (store, live DB) and
`TestPollerFrozenEndpointAtCursorRefreshesNothing` (worker).

The same rule closed the other three variants: validity is reported alongside
freshness (B-invalid), the anchor ROW's existence answers "is the chain moving"
(B-frozen readiness TTL), an unusable oracle timestamp yields a refusal rather
than a process clock (B-clamp), and readiness starts closed (Ready-start).

### Principle 2 — destructive and permissive defaults must fail CLOSED

- `verifiedFloor`'s collapse to `0` is gone. `Poller.repair` refuses to call
  `RewindPrices` **at all** while it owns rows it cannot prove canonical: no ack,
  no deletion, no cursor move, `ConditionPollRewindBlocked` on `/readyz`, retry
  next Step. `floor = 0` from the poller now means "there is nothing above the
  target to lose" (proved by `CountOwnedPricesAbove`), never "we gave up looking".
- `healthState` is built CLOSED. `newHealthState` leaves `initialised = false`, so
  the first `/readyz` answer is 503 with status `"starting"`. It clears only via
  `markInitialized`, which requires a completed round, no terminal entry and no
  worker step error — and derives that from the surface itself, so a caller cannot
  declare a readiness the conditions contradict.
- Both `AdoptPollAnchor` and `applyProgressConditions` follow the same rule: the
  first refuses while any epoch is unacked, the second issues no verdict when its
  read fails (a fabricated stall would be its own defect).

---

## The 8 findings

### A1 [high] — anchor verification failure destroys unrecoverable canonical history

**Followed Codex's recommendation.** Four parts:

1. **Do not ack or delete when verification is unavailable.** `Poller.repair`
   classifies verification into five outcomes (`floorOutcome`): `floorVerified`
   and `floorNothingAtRisk` proceed; `floorUnprobed` (probe failed, or budget
   spent), `floorNoAnchors` (rows exist that no anchor covers) and
   `floorAllOrphaned` (paged to the bottom, nothing survives) all **refuse** —
   `blockRepair` sets `ConditionPollRewindBlocked` naming the missing evidence, and
   nothing is deleted. Refusal is not a Step error: erroring every round would burn
   the daemon's backoff on a state only an operator or a recovered endpoint can
   change, and the condition surface is where it belongs.
2. **Retry.** The refusal is re-evaluated on the next Step; a recovered probe
   endpoint completes the same verification and repair proceeds.
3. **Paginate across bounded Steps instead of giving up at eight.**
   `PollAnchorsAbove` → `PollAnchorsBelow(engine, chain, belowOrAt, limit)`; each
   Step spends `anchorProbePage` (8) probes and, if every anchor in the page was
   checked and orphaned, lowers `probeResumeFrom` so the next Step continues
   **deeper**. A page in which any probe ERRORED does not lower the resume point,
   so a transient outage re-probes rather than skipping past unverified anchors.
4. **Explicit, safe one-time policy for legacy unanchored history.** New store
   calls `UnanchoredPriceBlocks` + `AdoptPollAnchor`. The poller adopts anchors for
   owned-but-unanchored blocks from the live chain, bounded to
   `anchorAdoptionPerStep` per Step, latching off once nothing is left.
   `store.AdoptPollAnchor` enforces three gates: the engine must own a row at that
   exact block; **no reorg epoch may be unacked** (adopting during a pending reorg
   could take a REPLACEMENT block's hash and let a later probe "verify" rows
   describing the block the chain discarded — the exact failure anchors prevent);
   and a divergent hash at an already-anchored height is still
   `ErrPollAnchorDivergence`. The safety argument and its limit ("this does not
   prove the rows were read at this block — that fact was never recorded") are in
   the code, and the WARN says so at runtime.

**The committed test that asserted data loss is gone.**
`TestPollerRewindWithoutVerifiableAnchorFallsBackToWalkerTarget` — which asserted
`require.Empty(t, st.rows, "and the polled history is gone — this loss is real")` —
is replaced by `TestPollerRewindRefusesWhenAnchorVerificationIsUnavailable`, which
asserts `RewindPrices` was never called, the cursor is untouched, the row survives,
the epoch stays unacked, `/readyz` is red, and that a recovered probe then completes
the repair while retaining the row.

Tests pinning A1: `TestPollerRewindRefusesWhenAnchorVerificationIsUnavailable`
(no-anchor / probe outage + retry), `TestPollerRewindPagesAnchorProbesAcrossStepsWithoutDeleting`
(deep reorg, two pages, nothing deleted mid-verification),
`TestPollerRewindRefusesWhenEveryRetainedAnchorIsOrphaned`,
`TestPollerAdoptsAnchorsForLegacyUnanchoredRowsThenCanRepair` (**upgrade path**:
refuse → adopt → repair),
`TestPollerAnchorAdoptionRefusedWhileEpochPending`,
`TestUnanchoredPriceBlocksAndAnchorAdoption` and
`TestCountOwnedPricesAboveIsOwnerAndHeightScoped` (store, live DB).
`TestPollerRewindRetainsRowsBelowVerifiedAnchor` still pins the happy path.

**Disclosed residual:** a reorg deeper than the entire retained anchor set (4096
anchors, ~2.8 days at the default cadence) is not repaired automatically. The
poller reports it and stalls rather than deleting ~3 days of unrecoverable history
on that evidence. That is a deliberate operator hand-off, not an oversight.

### B-frozen [high] — same-height frozen RPC keeps freshness and readiness green

**Followed Codex's recommendation, both halves.**

*Half 1 — refresh health only from durable results.* Done structurally; see
Principle 1. `Step`'s success path is `recordDurableInserts(res)` and nothing else.
`logRoundOutcome` additionally WARNs when a round commits and creates nothing, so
the replay is visible in the operator log rather than silent.

*Half 2 — fail readiness when the execution block does not advance within a bounded
TTL.* New `ConditionPollBlockAdvance`, measured from
`res.AnchorObservedAt` / `NewestPollAnchor().ObservedAt` — the **anchor row's own
database timestamp**. A frozen endpoint replays the same `(block, hash)`, the
anchor conflicts, `AnchorInserted` is false, and the clock does not move. A restart
hydrates the same durable timestamp, so it cannot buy a fresh window either.

`blockAdvanceTTL` is an absolute 5-minute floor (widened to `pollHealthGrace`
intervals if the cadence is slower), deliberately **not** a multiple of the cadence:
two rounds may legitimately land on the same execution block when the cadence is
shorter than the chain's block time, and 5 minutes is far above 2s (OP) / 12s (ETH).

Pinned by `TestPollerFrozenEndpointAtCursorRefreshesNothing` (a frozen endpoint
across **seven** intervals: rounds keep committing, `st.rows` stays at 20, no new
anchor, and all three conditions fire) and
`TestPollerHydratesBlockAdvanceClockFromDurableAnchor` (restart cannot reset it).
The fake store now models real insert/anchor identity and the monotonic cursor
guard (`enforceCursorMonotonic`), because scripting the refusal would presuppose
the classification the poller is supposed to derive.

### B-invalid [high] — quarantined non-positive answers count as healthy freshness

**Followed Codex's recommendation:** expose latest validity alongside durable
freshness, add an explicit invalid-answer condition, let invalid observations
advance cursors but never refresh usable-price health.

*Store.* `PriceFreshness` now carries `Valid` / `InvalidReason` (the newest row of
any validity — "did we reach the oracle") **and** `HasValid` /
`ValidBlockNumber` / `ValidObservedAt` (the newest VALID row — "is there a usable
price, and how recent"). `LatestPriceFreshness` computes both in one query
(`newest` ⟕ `newest_valid`). `PriceInsert.Valid` reports the same for an insert.

*Poller.* `lastUsable` replaces `lastPriced` and only a **valid** insert moves it;
`lastRound` likewise. `invalidNewest` marks keys whose newest durable row is
quarantined, reported as `ConditionPollInvalidAnswer` — separate from freshness
because the remedies differ and an operator must be able to tell "no data" from
"poisoned data". Cursors still advance on quarantined answers.

*Feed path — the hole Codex flagged in the same finding.* It treated every
`AnswerUpdated` as fresh regardless of `Current`. `lastSeen` became `lastUsable`
(newest answer that is both positive and plausibly timestamped), staleness is
measured from it, and `ConditionFeedInvalidAnswer` names streams whose newest
answer is unusable. A window that contains a good answer followed by a zero keeps
the good answer's freshness and marks the zero — the two are tracked separately in
`stagedAnswer` on purpose.

Downstream invariant tests: `TestLatestPriceFreshnessSeparatesReachedFromUsable`
(store, live DB), `TestPollerQuarantinedAnswerDoesNotRefreshUsableFreshness`,
`TestPollerHydratesQuarantineMarkerAcrossRestart`,
`TestFeedDeriverNonPositiveAnswerDoesNotRefreshFreshness`. The existing
`LatestUsablePrice` contract tests still pin that no consumer can select one.

### B-workers [high] — readiness ignores core ingestion and non-price workers

**Followed Codex's recommendation:** route walker, derivation and snapshot
errors/backoff into recoverable readiness conditions, preserve the
terminal-vs-recoverable classification, add durable progress/head-lag checks.

`cmd/indexer/main.go` now has three extracted, unit-testable passes mirroring
`stepPriceWorkers`, driven through narrow interfaces (`ingestWorker`,
`deriveWorker`, `snapshotWorker`) so the composition is testable without a chain
or a database:

- `stepWalkers` — records `step_error` (with the consecutive count and the backoff
  delay) and reads conditions **while backing off**, which is when the signal
  matters most.
- `stepRunners` — terminal capability errors keep their own channel
  (`setTerminal`); ordinary Step errors become recoverable `step_error`, which
  previously populated nothing at all.
- `stepSnapshotter` — same, under worker name `snapshotter`.
- `applyProgressConditions` — `no_progress` when a watched walker's or runner's
  **durable** cursor has not moved within `noProgressBound` (15 min), read from
  `store.IngestCursorProgress` / `DeriveCursorProgress`. The timestamp is the
  database's `updated_at`, so a restart cannot grant a wedged worker a fresh
  window.
- `stepWalkers` also reports `head_lag` from `ingest.Walker.HeadLag()` (a fresh
  `(head, cursor)` observation per Step) when the cursor is more than
  `headLagBound` (5000) blocks behind the head the walker last saw. It fires during
  backfill on purpose — a process that has not reached the chain is not ready — the
  same posture the feed deriver's `rpc_ingest_lag` already takes.

`roundConditions` composes all non-price conditions for a round and publishes once,
because `setWorkerConditions` replaces by worker: publishing a step error and a
no-progress verdict from separate passes would let one erase the other and the
survivor would depend on pass order.

Pinned by `TestStepWalkersRoutesErrorsIntoReadiness`,
`TestStepWalkersReportsHeadLag`, `TestStepRunnersRoutesBothFailureClasses`,
`TestStepSnapshotterRoutesErrorsIntoReadiness`,
`TestNonPricePassesTreatCancellationAsShutdown`,
`TestApplyProgressConditionsFailsReadinessOnASilentStall`,
`TestRoundConditionsComposeStepErrorAndNoProgressTogether`,
`TestApplyProgressConditionsIssuesNoVerdictOnReadFailure`.

**Disclosed scope limit, stated in the code too:** the no-progress check
deliberately does **not** judge price workers. `derive_cursors.updated_at` refreshes
on an idempotent same-height upsert, which is exactly what a frozen poller
produces, so the timestamp would lie about it; the poller is judged by
`poll_block_advance` (a row's existence) instead. Neither a walker nor a runner can
produce that shape — both return early when caught up and only write a window they
are about to advance past — so for those two it is a faithful signal.
`store.CursorProgress`'s doc comment states this rather than implying a guarantee.

### B-clamp [medium] — future `updatedAt` hydration reintroduces the restart reset

**Followed Codex's first recommended option** (treat an implausible future
timestamp as an unhealthy durable condition). The second option — persist a
deterministic receipt/block timestamp — would need a schema column and a
migration for a medium finding whose durability requirement the first option
already satisfies exactly; noted as a deviation in emphasis, not in remedy.

`clampUpdatedAt` is gone. `classifyUpdatedAt` returns either the oracle's own
timestamp verbatim or a **reason** — never a substitute. An out-of-int64 value and a
value more than `futureTimestampTolerance` (2 min) ahead both establish **no**
freshness and raise `ConditionFeedTimestamp`. Nothing derived from `f.now()` is ever
stored as an observation time, so the same raw log re-decodes to the same verdict on
every restart, rewind and apply-error hydration.

Two limits are stated in the code, plainly:

- A within-tolerance future timestamp is accepted verbatim and therefore suppresses
  staleness by up to 2 minutes (~2% of the tightest 90-minute threshold). Accepted:
  substituting our own clock is the defect.
- The future test compares against wall clock, so a future timestamp stops being
  future once wall-clock reaches it, granting one threshold window starting at the
  **claimed** time. That is bounded, deterministic and identical across restarts —
  and until then the feed is UNHEALTHY, so a year-3000 timestamp now fails readiness
  for centuries instead of silencing the feed for centuries.

Pinned by `TestFeedDeriverRefusesImplausibleUpdatedAtInsteadOfClamping`, whose third
phase is the finding itself: a second `FeedDeriver` starting 3 hours later, reading
the same durable log, must reach the identical verdict.
`TestFeedDeriverAcceptsSmallClockSkewInUpdatedAt` pins the tolerance.

**Additional disclosed limit** (in `hydrateFreshness`): `LatestLogsByTopic` returns
only the newest log per aggregator, so when that newest answer is unusable,
hydration cannot see an older usable one behind it and that aggregator's
publication clock restarts from `liveSince`. It is not a false-green — the flaw
marker is durable and unhealthy, so readiness stays red while the newest answer is
unusable, and the publication sub-verdict is redundant while that holds. Recovering
the older timestamp would need a per-aggregator scan back through `raw_logs`, which
is not done; the limit is stated instead of implied.

### D3-stall [medium] — the no-anchor cause-unknown branch can stall forever

**Followed Codex's corrected guidance: separate diagnosis from recovery.**

`onCauseUnknown` still suppresses every **conclusion** — no endpoint implicated, no
attribution recorded, `staleRotations` reset so the all-endpoints-behind diagnosis
cannot fire — but it now advances an `exploreStart` hint one endpoint past whatever
served the undiagnosable round. `readRound` gives that hint precedence over the
attribution pin (when the cause is unknown the pin's evidence no longer explains
what we are seeing) and both are released together by `recordProgress`, or by
`onReorgSuspected` once reorg evidence appears. Exploration costs **no extra RPC** —
it re-routes the round the poller was going to make anyway. `Conditions` never
reports it, so it is a routing guess and not a diagnosis.

`TestPollerRepeatedCauseUnknownExploresAlternateEndpointsUntilProgress` is the
multi-endpoint repeated cause-unknown case Codex asked for: endpoints 0 and 1 frozen
below the cursor, endpoint 2 healthy, no anchor, and the store's real monotonic
cursor guard rather than a scripted error. Three rounds; `ch.starts == [1, 2]`; the
cursor reaches 5100; `preferredStart` stays −1 and `staleRotations` stays 0
throughout; no "stale rpc endpoint" or "all endpoints behind" is ever logged.
`TestPollerCauseUnknownWithOneEndpointCannotExplore` pins that with one endpoint
exploration is unavailable rather than faked — stated in the code comment too.

### D3-bound [medium] — frontier-below-cursor misattribution is not bounded to one pin

**Followed Codex's recommendation: do not attribute unless the verified anchor
reaches the cursor; treat frontier-below-cursor as cause-unknown; correct the
documentation.**

`classifyRegression` now requires three things before blaming an endpoint: durable
reorg state clean, `NewestPollAnchor().BlockNumber >= DeriveCursor()`, and that
anchor re-verifying as canonical. When the anchor is below the cursor the probe is
**not even issued** — it cannot answer the question — and the round is
cause-unknown.

The overclaim is deleted. The old text ("the cost is bounded at one misattributed
pin against a healthy endpoint, released by the next round's progress") is replaced
by the reason it was false, and by the honest cost of the new branch: no endpoint
is recorded as implicated, so an operator does not learn from these rounds which
node is behind. Recovery does not depend on that knowledge (exploration routes
regardless), but the diagnosis is genuinely absent rather than delayed. No
independent cursor-height ancestry check was added, so the weaker claim is what the
comment makes.

Pinned by `TestPollerRegressionWithFrontierBelowCursorIsCauseUnknown`: four
consecutive rounds, three endpoints, a lower anchor that **does** verify; nothing is
pinned, no streak accrues, no probe is issued, and the false all-endpoints-behind
diagnosis never appears.

### Ready-start [medium] — readiness starts green before any dependency is verified

**Followed Codex's recommendation.** `newHealthState` starts with
`initialised = false`; `report()` synthesises `daemon/startup` and reports
`Status: "starting"`, `Ready: false` (and `Live: true` — a process that has not
finished starting must not be restarted for it). The daemon calls
`health.markInitialized()` after `heartbeat()` each round; it clears only when a
round has completed, no terminal entry exists and no worker carries a
`step_error` — so dependency checks, worker construction, hydration and one full
round have all had to succeed, since any failure in them surfaces as one of those.
The decision is derived from the surface, not from a caller's boolean, so the two
cannot drift.

The startup entry lives in its own field rather than in the `recoverable` map,
because `setWorkerConditions` replaces by name prefix and stream names come from
config and legitimately contain colons — a coincidentally-named worker must not be
able to clear it.

Pinned by `TestHealthStartsClosedUntilInitialised` (503 before anything; a failing
worker and a terminal engine each defer it; a clean round clears it and latches;
later failures report as themselves) and
`TestHealthStartupConditionSurvivesWorkerNamedLikeIt`.

---

## Documentation honesty sweep

Every claim touched was checked against the code. Corrected or removed:

- `internal/prices/prices.go` — the "WHAT IS STILL LOST" paragraph said repair
  "falls back to the walker's target and the old unbounded loss applies". It now
  states that repair fails closed, what the one justified deletion is, and that a
  reorg deeper than the retained anchor set is left to an operator.
- `internal/prices/poller.go` — the "one misattributed pin" bound is gone
  (D3-bound); `verifiedFloor`'s "degrades to the conservative (lossy) target"
  comment is gone; the "cause-unknown costs one round" framing is replaced by the
  indefinite-stall explanation and the exploration remedy.
- `internal/store/prices.go` — "REORG REPAIR IS NOT UNIFORMLY LOSSY" now says who
  refuses and that a caller's `floor = 0` means "nothing at risk", not "we gave up".
- `internal/store/prices_provenance_test.go` —
  `TestRewindPricesWithoutFloorStillLosesEverything` is renamed
  `…WithZeroFloorDeletesEverythingAboveTheTarget` with a comment distinguishing the
  store contract from the poller's posture.
- `cmd/indexer/health.go` — the readiness/liveness doc states that readiness starts
  closed and lists what `/readyz` now fails for.

New limits stated rather than implied: the `futureTimestampTolerance` cost and the
wall-clock crossover (B-clamp); the hydration-sees-only-the-newest-log limit; the
`CursorProgress.UpdatedAt` idempotent-replay caveat and why price workers are
excluded; `AdoptPollAnchor` not proving the rows were read at the adopted block;
exploration being unavailable with one endpoint; the poller's `startedAt` residual
bound (one grace window when there is genuinely no durable fact to measure from);
the retained-anchor-depth ceiling on automatic repair.

## Deviations

1. **No migration `00006`.** None was needed: `prices.observed_at`,
   `price_poll_anchors.observed_at`, `ingest_cursors.updated_at` and
   `derive_cursors.updated_at` all already exist, so every new durable timestamp is
   read from a column migration 00002/00005 already created. `00001`–`00005` are
   untouched.
2. **B-clamp took Codex's first option, not the second.** An unhealthy durable
   condition rather than a persisted receipt timestamp. The second would need a new
   column and a migration; the first satisfies the durability requirement exactly
   (the verdict is a function of the log alone) and is what the tests pin.
3. **`PollAnchorsAbove` was replaced, not extended.** It became
   `PollAnchorsBelow(engine, chain, belowOrAt, limit)` plus `NewestPollAnchor`,
   because pagination needs an at-or-below bound and regression classification needs
   only the newest anchor. Both call sites and their tests moved with it; no stale
   references remain.
4. **`internal/ingest/walker.go` was touched** (in scope, but it is a
   round-1-cleared file). The change is additive: three unexported fields recording
   the `(head, cursor)` pair each Step already reads, and an exported `HeadLag()`.
   No ingestion logic changed. The comment states that `HeadLag` is not safe to call
   concurrently with `Step` and that the daemon reads it from the same loop
   goroutine.
5. **Walker/runner/snapshot passes were refactored behind interfaces** so the
   composition is unit-testable without a chain or a database — the same reason
   `stepPriceWorkers` was extracted in wave 1. `stepSnapshotter`'s nil guard stays
   at the call site, because a nil `*snapshot.Snapshotter` in an interface is not a
   nil interface; the doc comment says so.
6. **`head_lag` and `no_progress` make `/readyz` red during backfill.** Deliberate
   and consistent with the existing `rpc_ingest_lag` posture, but it is a behaviour
   change for a fresh deploy: the daemon reports "not ready" until it reaches the
   chain.
7. **`.env.example` untouched**, as instructed. `SOLVENT_HEALTH_ADDR` remains
   documented in `internal/config/config.go` only. This wave adds **no** new
   environment variables or config keys; every new bound is a named constant with
   its reasoning in the comment.
8. **Not committed.** All 15 files are staged-ready but uncommitted, left to the
   controller. No pre-commit gate was hit or bypassed.

## Files changed

```
cmd/indexer/health.go            cmd/indexer/health_test.go
cmd/indexer/main.go              internal/ingest/walker.go
internal/prices/feed.go          internal/prices/feed_test.go
internal/prices/poller.go        internal/prices/poller_test.go
internal/prices/prices.go        internal/prices/prices_test.go
internal/store/prices.go         internal/store/prices_provenance_test.go
internal/store/store.go          internal/store/prices_test.go
internal/store/migrate_upgrade_prices_test.go
```

Nothing under `roadmap/**`, no migration edited, no `.env.example`.
