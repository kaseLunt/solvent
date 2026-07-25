# Task 8 — consolidated fix wave report (Codex round 1)

Repo `C:\Users\kasel\source\repos\etherfi\Solvent`, branch `main`, base commit `f0755e5`.
Reviewed target was `bf72d8e`; this wave answers all 11 findings from
`.superpowers/sdd/task-8-codex-round1.md`, adjudicated ACCEPTED in
`.superpowers/sdd/task-8-fixwave-brief.md`.

**Codex's own recommendation was implemented for all 11 findings.** There are no substitutions. Four
places where I did MORE than the recommendation, and every residual limit I am aware of, are listed
under "Deviations, additions and disclosed limits" — nothing is left implicit.

---

## Verification (actual numbers, this machine, this wave)

```
export PATH="$PATH:/c/Program Files/Go/bin:/c/Users/kasel/go/bin"
export TEST_DATABASE_URL='postgres://solvent:solvent@localhost:5432/solvent?sslmode=disable'
```

| Gate | Result |
|---|---|
| `go build ./...` | clean |
| `go vet ./...` | clean |
| `gofmt -l .` | **empty output** (read, not inferred from the exit code) |
| `go test ./...` | all 9 packages `ok` |
| `go test ./... -count=1 -v` | **423 PASS / 0 FAIL / 0 SKIP** (top-level) + 59 subtests PASS |
| `go test -race ./...` in `golang:1.24` | all 9 packages `ok`, **including the live-Postgres `internal/store` package** |

Baseline was 348 PASS / 0 FAIL / 0 SKIP at `bf72d8e`. This wave: **423 PASS / 0 FAIL / 0 SKIP**, i.e.
**+75 tests, zero skips**. No test was deleted to make a number; the store suite still runs against
live Postgres `solvent-db-1` (0 skips proves `TEST_DATABASE_URL` was actually set — the store tests
skip loudly without it).

`-race` DID run: host Go lacks cgo, so it was run in the `golang:1.24` container with the database
reached over `host.docker.internal`, which is why the live store tests are included rather than
skipped:

```
MSYS_NO_PATHCONV=1 docker run --rm -v "C:/Users/kasel/source/repos/etherfi/Solvent:/src" -w /src \
  -e TEST_DATABASE_URL='postgres://solvent:solvent@host.docker.internal:5432/solvent?sslmode=disable' \
  --add-host=host.docker.internal:host-gateway golang:1.24 go test -race ./...
```

No pre-commit gate was hit or bypassed; nothing is committed — the tree is left staged-free for the
controller.

### Scope

Changed files, all inside W1 `allowed_paths` (`internal/**`, `cmd/**`, `recon/derivation-notes.md`,
`recon/feeds.json`). **`roadmap/**` untouched.** New: `internal/store/migrations/00005_price_provenance.sql`,
`cmd/indexer/health.go`, and four test files. `00001`–`00004` are **not** edited — verified by the
upgrade tests, which reconstruct the v3 and v4 baselines from the same embedded set and assert those
baselines lack the new shapes.

**One in-scope correction to disclose:** I first edited `.env.example` to document
`SOLVENT_HEALTH_ADDR` and the retirement of `SOLVENT_FEED_STALENESS`, then noticed `.env.example` is
NOT in W1's `allowed_paths` and reverted it (`git checkout -- .env.example`; it is clean). The
operator-facing documentation for both variables therefore lives only in `internal/config/config.go`'s
field comments and in this report. **Controller follow-up:** `.env.example` should gain
`SOLVENT_HEALTH_ADDR=127.0.0.1:9090` and a note that `SOLVENT_FEED_STALENESS` is now refused.

---

## Cluster A — durability and rewind correctness

### A1 [high] Poller rewinds can irreversibly erase all canonical price history

**Codex's recommendation:** persist the multicall execution block hash per round or in a durable
anchor table; find the nearest hash-verified poll ancestor during reorg repair; delete only the
unverified suffix; correct the contradictory loss documentation. **Implemented as specified.**

**What changed**

1. **The decoder stops discarding the hash.** `unpackMulticallResult`
   (`internal/prices/prices.go`) now returns `(block, blockHash, results, err)`. A **zero** hash is
   refused: multicall3 returns `blockhash(block.number)`, never zero for the executing block, and an
   anchor holding a zero hash would "verify" against nothing.
2. **Durable anchor table.** Migration `00005` adds `price_poll_anchors (engine, chain_id,
   block_number, block_hash, observed_at)`, PK `(engine, block_number)`.
3. **Written atomically with the round.** New `store.ApplyPolledPrices(..., anchor store.PollAnchor)`
   inserts the anchor inside the same transaction as the rows and the cursor move, so an anchor can
   never describe a round that did not commit. It enforces `anchor.BlockNumber == throughBlock` and a
   32-byte hash. A re-anchor with a **different** hash aborts the batch with the new
   `store.ErrPollAnchorDivergence` (the chain at that height changed — a reorg to repair, not a fact
   to overwrite).
4. **Repair deletes only the unverified suffix.** `Poller.rewind` calls `verifiedFloor`, which walks
   this engine's anchors newest-first (bounded by `maxAnchorProbes = 8`), re-checking each hash
   against the live chain via the new `chain.Failover.HeaderHashFrom` — routed across endpoints so
   one frozen/forked node cannot answer every question with the same wrong history — and stops at the
   first match. `store.RewindPrices` gained a `verifiedFloor uint64` parameter that **raises** the
   effective target back above the walker's deepest unacknowledged `rewound_to`. The epoch ack is
   unchanged (still reaches the chain's max epoch, atomically). A floor above `toBlock` is refused
   outright. Anchors above the effective target are deleted with the rows they describe.
5. **Contradictory loss documentation corrected.** The "Losing at most one poll interval of history"
   sentence in `internal/store/prices.go` is **gone** (grepped: zero occurrences repo-wide). Both
   package docs and `Poller.rewind` now state exactly what is still lost — rows above the highest
   matching anchor, and everything above the walker's target when nothing verifies or retention has
   aged the anchors out — and both fallbacks are WARNed with their numbers.
6. **Why this is not "ack-but-keep"** (the strategy Codex ruled out): rows are retained only where a
   hash re-check says the block is still present. Every unverified row is deleted.

**Tests that pin it**

- `prices.TestPollerRoundPersistsHashAnchor` — the anchor accompanies every landed round.
- `prices.TestUnpackMulticallKeepsBlockHash`, `TestUnpackMulticallRefusesZeroBlockHash`.
- `prices.TestPollerRewindRetainsRowsBelowVerifiedAnchor` — walker target 100, anchors at
  4800/4900/5000 with 5000 orphaned → cursor lands at **4900**, rows at 4800+4900 survive, probes are
  `[5000, 4900]` (walk-down-and-stop proven, not asserted by comment).
- `prices.TestPollerRewindWithoutVerifiableAnchorFallsBackToWalkerTarget` — the honest lossy path,
  including the WARN text.
- `prices.TestPollerRewindAnchorProbesAreBounded`, `TestPollerBootstrapRewindTargetsZero`.
- `store.TestApplyPolledPricesAnchorsAtomically`, `TestApplyPolledPricesValidatesAnchor`,
  `TestApplyPolledPricesAnchorDivergenceAbortsBatch`,
  `TestRewindPricesVerifiedFloorRetainsProvenHistory`,
  `TestRewindPricesWithoutFloorStillLosesEverything`, `TestRewindPricesRefusesFloorAboveTarget`,
  `TestRewindPricesFloorNeverLowersTheTarget`, `TestPollAnchorRetentionIsBounded`,
  `TestPollAnchorsAboveOrderingAndScope`.
- `chain.TestHeaderHashFromIsRoutableAndForkSensitive` (+ `…AllEndpointsFail`).

### A2 [high] Phase change leaves orphaned old-source rows after the epoch is acknowledged

**Codex's recommendation:** persist durable engine→source ownership history, **or** store an owner
engine on every price row and rewind by owner rather than the current registry's source list; add a
phase-change-then-deep-reorg regression test. **Implemented — the second option, exactly as offered.**

**What changed**

- `00005` adds `prices.owner_engine TEXT NOT NULL`, backfilled from the source families this codebase
  has ever written (`chainlink:%` → `prices:chainlink_feed:<chain>`; `priceproviderv2` / `ratio:%` →
  `prices:poll:<chain>`), then `DROP DEFAULT` plus `CHECK (owner_engine <> '')` so an unowned row is
  structurally impossible. The backfill **RAISEs** if any row's source is unrecognised, so a future
  source family cannot silently produce the very orphan this fixes. Index
  `prices_owner_idx (chain_id, owner_engine, block_number)` serves the rewind predicate.
- `insertPrice` records the applying engine; the divergence check now compares value, scale **and
  owner**, so a replay from a different engine is refused rather than silently re-attributed.
- `RewindPrices` deletes `WHERE owner_engine = $engine`. The `sources []string` parameter is **gone**
  from the signature — the failure mode is removed, not merely worked around. `Sources()` remains on
  both workers for logs/introspection and is documented as no longer being the rewind scope.

**Tests that pin it**

- `store.TestRewindPricesDeletesRetiredPhaseRowsByOwner` — the full requested regression: writes under
  aggregator A, phase-changes to B, another writer on the same chain, then a **deep reorg crossing the
  boundary**. The `chainlink:A` rows above the target are deleted although no current registry names
  that source; the other writer's row survives; the ack still reaches the chain's max epoch; and
  `PruneAckedReorgEpochs` then prunes with no orphan stranded.
- `store.TestApplyPricesRecordsDurableOwner`, `TestApplyPricesRefusesReplayFromAnotherOwner`,
  `TestApplyPricesRequiresEngine`.
- `store.TestMigrateUpgradesV4PriceBaselineWithoutDataLoss` re-runs the orphan scenario **on a
  database upgraded from the pushed v4 baseline**, where the retired aggregator's row was written
  before `owner_engine` existed.

### Schema note — forward migration only

`internal/store/migrations/00005_price_provenance.sql` is the only migration added; `00001`–`00004`
are untouched. Two upgrade-path tests exist:

- `store.TestMigrateUpgradesV4PriceBaselineWithoutDataLoss` (**new**, the one the brief required):
  from the **current pushed baseline v4** — proves v4 lacks the new shapes, seeds rows in every source
  family plus two non-positive answers, runs the production `Migrate`, then asserts complete
  attribution, quarantine without deletion, all three CHECKs actually refusing the bad writes, and all
  of apply / polled-apply+anchor / latest-usable / per-asset-freshness / owner-scoped-rewind working
  afterwards.
- `store.TestMigrateUpgradesV3BaselineWithoutDataLoss` (pre-existing) updated to assert the head
  version via a new `currentSchemaVersion = 5` constant instead of a hardcoded 4, so a future
  migration cannot land without its own upgrade proof.

---

## Cluster B — health must not report green while broken

Codex called this one bug in four places; the brief said fix the class. The class fix is: **no health
verdict is derived from process memory or from "a round committed" — every verdict is hydrated from
durable storage, re-hydrated whenever an outcome is uncertain, and fails CLOSED when hydration is
impossible.** Applied to both workers, not only where cited.

### B1 [high] Poller health stays green while one or every oracle is failing

**Codex's recommendation:** track successful freshness **per target**; do not count an empty batch as
a health-landed round; fail health when any required asset misses its grace window; test persistent
all-target and single-target failures over multiple intervals. **Implemented as specified.**

- `Poller.lastLanded` (one process-memory timestamp refreshed on every non-erroring apply) is
  replaced by `lastPriced map[key]time.Time` keyed `(asset, source)` plus `lastRound`, which advances
  **only when `len(obs) > 0`**. An all-oracles-reverted round still advances the cursor for the epoch
  ack and is explicitly not a landed round.
- Freshness is **hydrated from durable rows** via the new
  `store.LatestPriceFreshness(chainID, ownerEngine)` (newest `block_number`/`observed_at` per
  `(asset, source)` for that owner), so a restart cannot reset a dead oracle's clock — that is the B2
  class applied to the poller as well.
- Two separately-keyed conditions: `poll_round` (the poller is writing nothing at all) and
  `poll_target_freshness` (named assets missing while others are current).

**Tests:** `TestPollerHealthFailsWhenEveryOracleKeepsFailing` (4 intervals, cursor advances every
round, both conditions fire, reason says "never priced"); `TestPollerHealthFailsForOneStaleAssetWhileOthersLand`
(5 intervals, `poll_round` deliberately **absent**, the asset named by symbol and address, "1 of 20");
`TestPollerHydratesStaleFreshnessAcrossRestart`; `TestPollerUnhydratedFreshnessFailsClosed`;
`TestPollerHealthIsRecoverable`; `store.TestLatestPriceFreshnessIsPerKeyAndOwnerScoped`;
`store.TestLatestPriceFreshnessFollowsRewind`.

### B2 [high] Restart and rewind reset already-dead feeds to healthy for another full threshold

**Codex's recommendation:** hydrate each feed's latest canonical `updatedAt` from durable raw logs (or
persist dedicated feed-freshness state) **before** issuing any live verdict; rehydrate after every
rewind; cover restart-with-preexisting-stale-feed. **Implemented — the raw-logs option, which Codex
listed first.**

- New `store.LatestLogsByTopic(chainID, addresses, topic0, throughBlock)` returns the newest matching
  log per address (`DISTINCT ON (address) … ORDER BY address, block_number DESC, log_index DESC`).
  `decode.ChainlinkAnswerUpdatedTopic0` is now exported, derived from the embedded ABI (never a
  hand-copied literal), so the SQL filter cannot drift from the decoder.
- `FeedDeriver.hydrateFreshness` rebuilds `lastSeen` from those logs at or below the **durable derive
  cursor**, decoding each through the real registry to read `updatedAt`. It runs before the first
  verdict and again whenever the cursor has moved without this process observing the move (restart,
  rewind, lost ack). `evaluateStaleness` **returns early while `!hydrated`** — Codex's binding order,
  enforced in code.
- `rewind` now **re-hydrates instead of clearing**. Clearing was the blind spot: it made every feed
  "unobserved" and restarted the never-published grace window.
- Hydration failure sets `hydrated = false`, which reports `feed_freshness_unhydrated` and suppresses
  publication verdicts — fail closed, never green on unknown state.
- Cost control: because a successful apply records `hydratedThrough = to`, a normal derive loop
  hydrates **once** at startup and never again during backfill.

**Tests:** `TestFeedDeriverHydratesPreexistingStaleFeedOnRestart` (caught-up cursor, nothing derived,
nothing applied — so process memory alone would know nothing — yet the 30h-dead USDC stream is caught
immediately while weETH is not implicated); `TestFeedDeriverRewindRehydratesRatherThanClearingFreshness`
(the surviving 30h-old answer is what USDC is measured from after the rewind, and it is stale on the
spot); `TestFeedDeriverFailedRehydrationSuppressesVerdict`;
`store.TestLatestLogsByTopicNewestPerAddressBounded`.

### B3 [high] One global 26h threshold misses failures far beyond a feed's real heartbeat

**Codex's recommendation:** record and validate a **per-feed heartbeat plus explicit grace** in
`feeds.json`, use it in staleness evaluation, and add fixtures pinning every configured stream's
threshold. **Implemented as specified.**

- `recon/feeds.json` `chainlink_stream` entries gain `heartbeatSeconds` and `graceSeconds`. Both are
  **required** and range-checked for streams, and **refused** for polls (a view call has no
  publication stream). `config.FeedOracle.StalenessThreshold()` = heartbeat + grace.
- `FeedDeriver` judges each stream against its **own** threshold; `FeedConfig.Staleness` is deleted;
  `NewFeedDeriver` refuses a stream with no positive threshold so no stream can silently inherit a
  default. `Thresholds()` exposes them per symbol and the startup log names them individually.
- `Config.FeedStaleness` and `SOLVENT_FEED_STALENESS` are **retired and refused** — `Load` errors if
  the variable is set, naming `oracle.heartbeatSeconds`. Silently ignoring it would leave an operator
  believing a bound they configured is still in force.

**Values and their provenance — stated per value, because they are not equally well established:**

| Stream | heartbeat | grace | threshold | provenance |
|---|---|---|---|---|
| weETH (ETH/USD leg, proxy `0x5f4e…8419`) | 3600s | 1800s | 1h30m | **Evidence-backed** — Codex round 1 independently observed deployed code consuming this exact proxy with a 3600s bound (constructor evidence `0x641169f048ee8de8b3037c9d9c840060fe03e463`). |
| USDC / PYUSD / FRAX | 86400s | 3600s | 25h | **NOT independently verified by this wave.** 86400s is the published Chainlink mainnet heartbeat for those feeds; I did not confirm it from bytecode or a consumer's constructor. |

The grace values are **this repo's operator margin, not contractual quantities**. Every threshold is
**tighter** than the 26h it replaces, so no feed became more permissive; a fixture test enforces that
ceiling so a future registry edit cannot silently loosen a liquidation-facing bound. Independently
confirming the three published heartbeats remains **open work**, recorded as such in
`recon/derivation-notes.md` (new subsection "Per-feed staleness thresholds — and exactly how well each
value is evidenced").

**Tests:** `config.TestRealFeedRegistryStalenessThresholds` (pins all four heartbeats, graces and
thresholds against the real registry, plus the ≤26h ceiling and zero-for-polls);
`config.TestLoadFeedsRefusals` gains 7 cases (missing/zero/absurd heartbeat, missing/absurd grace,
poll-with-heartbeat, poll-with-grace); `config.TestLoadRefusesRetiredFeedStalenessVariable`;
`prices.TestFeedDeriverPerFeedThresholds`; `prices.TestNewFeedDeriverRefusesStreamWithoutOwnThreshold`;
`prices.TestFeedDeriverPerFeedThresholdsDecideIndependently` (**the differential**: one 100-minute gap
is stale for the 1h-heartbeat ETH/USD stream and fresh for the three 24h streams — something one
global bound cannot express); `prices.TestFeedDeriverNeverPublishedTripsAfterThreshold` (weETH trips at
2h while PYUSD does not).

### B4 [high] The claimed "failed health check" is only a log message

**Codex's recommendation:** expose a real daemon health/readiness surface composed from both maps,
preserving the terminal-vs-recoverable classification; add fake-worker tests for failure, backoff,
recovery, and supervisor visibility. **Implemented as specified.**

- New `cmd/indexer/health.go`: `healthState` holds `terminal` (engine capability errors; entries only
  ever appear) and `recoverable` (price-worker conditions; **replaced per worker each round** so
  recovery is visible), plus a loop heartbeat. All state is behind a mutex and `report()` returns
  copies, so an HTTP handler never touches worker state.
- **Real HTTP surface**, served from `run()` before any dependency: `GET /readyz` (200 only when
  nothing is wrong — 503 for stale feeds, missing poll targets, persistent apply failures, gated
  engines), `GET /healthz` (liveness: the daemon loop heartbeat), `GET /health` (always 200, full JSON
  detail). Address from `SOLVENT_HEALTH_ADDR`, default `127.0.0.1:9090`; **a bind failure is fatal**,
  because a probe that silently failed to come up recreates the exact defect being fixed. `off` is the
  only opt-out, and it logs a WARN saying the process now exposes no probe.
- **Readiness vs liveness is a deliberate split, documented in the file:** `/readyz` fails for either
  class; `/healthz` does **not** fail on a terminal engine error, because a supervisor's response to a
  liveness failure is a restart and restarting the same binary on a capability error only crash-loops.
  A **wedged loop** does fail liveness — the one case where a restart is right.
- **Ordinary Step errors now reach the surface.** The price pass is extracted into
  `stepPriceWorkers(ctx, workers, health)` and records a `step_error` condition carrying the
  consecutive count and the retry delay. Previously the error was logged and dropped unless the
  worker's separate `Health()` also failed — precisely Codex's point. `context.Canceled` is shutdown:
  no backoff, no health entry. Conditions are read even while a worker is backing off.
- The package-level `engineHealth`/`priceHealth` maps are gone; the per-tick WARN is now a **mirror**
  of the queryable surface rather than the surface itself.
- Workers report **named** `prices.Condition`s rather than one blended string, so `feed_publication`
  and `rpc_ingest_lag` arrive as separately-keyed, separately-routable entries (this is also what B5
  needs).

**Tests (new `cmd/indexer/health_test.go`, 17 tests, fake workers throughout):** composition
(`…CleanState`, `…RecoverableIsDegradedNotDead`, `…TerminalIsUnhealthyButNotALivenessFailure`,
`…ComposesBothMaps`, `…WorkerConditionsAreReplacedPerWorker`, `…TerminalNeverClears`); liveness
(`…LivenessFailsOnWedgedLoop`); the price pass (`…RecordsStepError`,
`…ConditionsReadWhileBackingOff`, `…RecoveryClearsTheSurface`, `…PersistentFailureStaysUnready`,
`…ContextCancelIsNotAFailure`, `…BoundedPerRound`, `…AreIndependent`); **supervisor visibility over
real HTTP** (`TestHealthEndpointsReflectWorkerFailure` asserts the 200→503 transition on `/readyz`
with `/healthz` still 200, `TestHealthEndpointLivenessFailsWhenLoopWedges`,
`TestServeHealthServesAndShutsDown` on a real socket, `TestServeHealthBindFailureIsAnError`).
`config.TestLoadHealthAddr` pins the default, the override and the explicit `off`.

### B5 [medium] The head gate can misdiagnose a frozen RPC/ingest pipeline as four stale feeds

**Codex's recommendation:** expire cached live verdicts after a bounded TTL; validate head freshness
via block timestamp/hash through an independently routed endpoint; surface RPC/ingest lag separately
from feed publication staleness. **All three implemented.**

1. **TTL.** `liveVerdictTTL = 5 × headProbeInterval` (5 min). A live verdict with no fresh confirming
   probe expires, `lastLive` is cleared and `rpc_ingest_lag` is raised. Previously one success plus
   unbounded probe failures preserved `lastLive` forever.
2. **Header timestamp, independently routed.** `chain.Failover.HeadFrom(ctx, startIndex)` returns
   `Head{Number, Time, Hash}` with caller-scoped routing that does not touch the shared hint;
   `ActiveEndpoint()` exposes that hint so `probeHead` starts **one endpoint past** the one ingestion
   is pinned to. A head whose own header timestamp is older than `headFreshnessBound` (10 min) is
   treated as **our** dependency failing — this is the co-frozen case the block-gap test cannot see,
   since a node frozen at the same height as our frontier keeps the gap small.
3. **Separate surfacing.** `rpc_ingest_lag` is its own condition and, while set, publication verdicts
   are suppressed entirely: with no view of the chain there is no basis for one. Backfill is likewise
   reported as lag, not as feed staleness.
   **Disclosed:** with a **single** configured endpoint independent routing is impossible; the probe
   still runs and the timestamp check plus the TTL are the only guards. Said in the code
   (`chain.HeadFrom` doc, `probeHead` doc, and the `independentlyRouted` log field) and pinned by a
   test, rather than left implied.

**Tests:** `TestFeedDeriverLiveVerdictExpiresAndReportsLagNotStaleFeeds` (one hiccup does not flip the
verdict; past the TTL it does, and `feed_publication` is deliberately **absent**);
`TestFeedDeriverFrozenHeadTimestampIsReportedAsLagNotStaleFeeds` (same height, small gap, 3h-old
header → lag, not four stale feeds, and clean recovery); `TestFeedDeriverHeadProbeAvoidsTheSharedIngestEndpoint`
(asserts the probe's start index tracks the shared hint as it moves);
`TestFeedDeriverSingleEndpointProbeIsNotIndependent`; `TestFeedDeriverStalenessSuspendedDuringBackfill`;
`chain.TestHeadFromStartsWhereTheCallerSays`, `…DoesNotMoveTheSharedHint`, `…RotatesWithinItsWalk`,
`…AllEndpointsFail`, `…NormalizesStartIndex`.

---

## Cluster C — binding contract compliance

### C1 [high] Feed ingestion violates the apply-error reset contract

**Codex's recommendation:** stage freshness updates until commit is confirmed; after ANY
`ApplyPrices`-class error, discard all staged/in-memory apply state and rehydrate cursor + freshness
from durable truth; test both the rollback and the committed-with-lost-ack outcomes. **Implemented as
specified.**

- The `f.observe(...)` call **inside the decode loop before `ApplyPrices`** is gone. The loop now
  writes into a local `staged map[common.Address]time.Time` (`stageObservation`), which touches no
  committed state. The staged window is merged into `lastSeen` **only after the apply returns nil**.
- Every apply-error path — including the reactive-epoch case, which previously returned early —
  first calls `discardAndRehydrate`: the staged map is dropped unmerged, `hydrated` is cleared, the
  **cursor is re-read**, and freshness is re-hydrated from raw_logs at whatever cursor the store
  actually holds. This covers both indeterminate worlds without the layer needing to know which
  happened. A failed re-hydration leaves `hydrated = false`, so no verdict is issued at all.
- The now-superseded `observe()` doc claiming the from-decoded-logs signal was "immune to commit
  indeterminacy in the one direction that matters" has been **rewritten**, not left standing.
- The same discipline is applied to the poller (`rehydrateAfterUncertainty`), which Codex did not ask
  for — see "Additions".

**Tests (both worlds, plus the failure of the reset itself):**

- `TestFeedDeriverApplyErrorRollbackResetsStagedFreshness` — the rolled-back window's fresh answer is
  **not** retained; hydration reads twice at the **unmoved** cursor; and the consequence the finding
  named is demonstrated: with persisted ingestion stalled at the old cursor and the deriver caught up
  and live, USDC is reported STALE. Pre-fix, `lastSeen` would hold the rolled-back window's fresh
  timestamp and this would report healthy.
- `TestFeedDeriverApplyErrorCommittedResetPicksUpWhatLanded` — the fake store models
  commit-landed-with-lost-ack (the shape Codex noted was modelled but never exercised). Re-hydration
  reads at the cursor the commit actually left, discovers the landed answer, and health is correctly
  healthy.
- `TestFeedDeriverFailedRehydrationSuppressesVerdict`.
- Poller side: `TestPollerRehydratesFreshnessAfterAmbiguousApply`,
  `TestPollerFailedRehydrationMarksVerdictUntrusted`.

---

## Cluster D — semantics and honest documentation

### D1 [medium] Non-positive observations are indistinguishable from usable prices

**Codex's recommendation:** advance the cursor while **quarantining** non-positive observations or
marking them explicitly invalid, and provide a store-level latest-**usable**-price contract that can
never return them; add downstream invariant tests. **Implemented — marking, plus the contract.**

- `00005` adds `prices.valid BOOLEAN NOT NULL` and `invalid_reason TEXT NOT NULL`, backfills existing
  non-positive rows to invalid, and adds two CHECKs: `NOT valid OR price > 0` (a non-positive row can
  never be marked valid — the load-bearing one, since it binds future writers too) and a
  reason-iff-invalid coherence check. Partial index
  `prices_usable_latest_idx (chain_id, asset, source, block_number DESC) WHERE valid` serves the read
  directly: an invalid row is not in the index at all.
- `insertPrice` **derives** validity from the price's sign rather than accepting it from the caller, so
  no writer can mark a broken answer usable. The raw fact still lands and the cursor still advances —
  refusing would wedge a feed deriver on a log that already exists in raw_logs.
- New `store.LatestUsablePrice(chainID, asset, source) (UsablePrice, bool, error)` filters `WHERE
  valid` in SQL, plus a defence-in-depth refusal if a non-positive value ever reaches it (which would
  mean the schema was altered out from under the contract). It makes **no freshness claim** — the
  caller must judge `BlockNumber`/`ObservedAt` itself, and that is stated in the doc.

**Tests:** `store.TestApplyPricesQuarantinesNonPositiveAnswers` (raw facts intact, cursor advances);
`store.TestLatestUsablePriceNeverReturnsQuarantinedRows` (the newest row for the key is the zero, and
the contract returns the older good one; a key whose only rows are quarantined reports absence, never
a poisoned price); `store.TestLatestUsablePriceIsAlwaysStrictlyPositive` (the **downstream invariant**,
as a property over a mixed table, plus both `UPDATE` attacks on the marker being refused by the
schema); `store.TestLatestUsablePriceNumericRoundTrip`.

### D2 [medium] Comments tell P3 to reproduce the uncapped weETH value as the adapter price

**Codex's recommendation:** state that the two rows compose only an **uncapped reference value, never
the adapter's guaranteed output**, and that P3 must implement or independently read the growth-cap
behaviour before claiming adapter equivalence; fix the matching test comment. **Implemented as
specified, and swept beyond the cited lines as the brief instructed.**

Corrected in four places:

1. `internal/config/feeds.go` `FeedRatio` doc (the cited lines) — now states the product is an uncapped
   reference value, never the adapter's guaranteed output; that the deployed adapter growth-caps the
   rate; that they diverge exactly in the depeg/exploit scenarios where it is most expensive; and the
   explicit P3 obligation.
2. `internal/config/feeds_test.go` — **the matching test comment** Codex named.
3. `internal/prices/prices.go` package doc — the weETH-gets-both-rows paragraph now carries the same
   statement rather than only the general cap caveat.
4. `recon/derivation-notes.md` stream caveat (i) — the same sentence added at the normative source.

Sweep evidence: `grep -rn "getRate() x ETH/USD\|adapter price\|adapter output\|cap adapter\|uncapped"`
over `--include=*.go --include=*.md` (excluding `roadmap/`, `.superpowers/`) — every remaining hit is
one of the four corrected sites or the pre-existing accurate `internal/prices` caveat.

### D3 [medium] Deep-reorg cursor regressions are not bounded to one misattributed round

**Codex's recommendation:** treat cursor regression as cause-unknown until reorg state and live block
ancestry are checked; suppress endpoint-specific rotation/all-behind conclusions while a reorg remains
possible; test the walker-backoff interleaving. **Implemented as specified.**

`Poller.classifyRegression` replaces the unconditional `onStaleEndpoint`:

1. **Durable reorg state first** (cheap, no RPC). An unacknowledged epoch → reorg, no endpoint
   implicated.
2. **Live ancestry of the poller's OWN newest anchor**, probed one endpoint **past** the one that
   served the suspicious round (asking the suspect about its own history is worthless):
   - anchor still canonical → a reorg has not touched our recorded heights, so the endpoint **is**
     behind → pin + streak + all-behind telemetry (the cleared pre-existing behaviour, now earned);
   - anchor **orphaned** → `onReorgSuspected`: no pin change, streak reset, WARN naming the evidence,
     wait for the walker's epoch;
   - **not checkable** (no anchor, or the probe failed) → `onCauseUnknown`: **neither** rotation
     **nor** the all-behind conclusion, per Codex's literal wording.
3. `ErrPollAnchorDivergence` is positive proof of a reorg at one of our own heights and takes the reorg
   branch directly.
4. The comment claiming "a deep reorg costs one endpoint pin" is gone; the honest bounds are stated.

**Tests:** `TestPollerRegressionDuringWalkerBackoffSuppressesEndpointBlame` — **the walker-backoff
interleaving Codex asked for**: three cadence-due rounds with no epoch recorded and an orphaned
frontier anchor; `preferredStart` stays `-1` and `staleRotations` stays 0 in every round, the reorg
diagnosis is logged, and both "all endpoints behind" and "stale rpc endpoint" are asserted **absent**.
Plus `TestPollerRegressionWithUndeterminedCauseSuppressesRotation`,
`TestPollerRegressionWithFailedAncestryProbeSuppressesRotation`,
`TestPollerRegressionWithRecordedEpochNeedsNoProbe` (no RPC at all),
`TestPollerAnchorDivergenceIsTreatedAsReorg`,
`TestPollerStaleEndpointPinsNextEndpointAfterVerifyingFrontier` (the endpoint branch still works, and
the probe's start index proves it avoided the suspect), `TestPollerAllEndpointsBehindWarns`.

---

## Cleared items — untouched

Per the brief, none of these was modified or re-litigated: `RewindDerived`/`rewindTarget` (its SQL,
ordering, errors and WARN behaviour are unchanged — `RewindPrices` calls the same helper), epoch
pruning covering every feed cursor, the proxy/aggregator/start-block values in `recon/feeds.json`
(only additive heartbeat/grace keys were added), **`ratio.decimals: 18`** (untouched — still pinned by
`TestBuildPollTargetsFromRealRegistry` and `TestLoadRealFeedRegistry`), the 20 OP registry entries and
the closed `pollViews` map, the multicall3 duplication, `priceSet` last-wins, the cursor namespaces,
and the chain-1-only 64-block slack (`liveSlackBlocks` is unchanged; the timestamp check and TTL are
**added alongside** it, not a replacement).

---

## Deviations, additions and disclosed limits

**No deviations from any recommendation.** Four additions beyond what was asked, all in service of the
class fix the brief demanded:

1. **Poller freshness is hydrated from durable rows** (B2's remedy applied to B1's finding). Codex
   asked for per-target tracking; process-memory-only tracking would have reproduced the B2 blind spot
   in the poller after every restart.
2. **The poller also honours the C1 reset contract** (`rehydrateAfterUncertainty` on every apply
   error). C1 was filed against the feed deriver only.
3. **Named `Condition`s instead of one blended health string.** B5 asks to surface RPC/ingest lag
   "separately"; separate keys are what makes that true at the health endpoint, not just in prose.
4. **Fail-closed unhydrated conditions** (`poll_freshness_unhydrated`, `feed_freshness_unhydrated`).
   Not requested; without them "cannot read durable truth" would have read as healthy — the same class
   again.

**Residual limits, stated rather than papered over:**

- **A1:** rows above the highest matching anchor are still lost, as is everything above the walker's
  target when no anchor verifies within `maxAnchorProbes = 8` or retention (`pollAnchorRetention =
  4096`, ≈2.8 days at the 60s cadence) has aged the anchors out. Both paths WARN with numbers.
- **A1 trust boundary:** the hash re-check is only as good as the endpoint answering it. Probes are
  spread across endpoints, but this is not a cryptographic proof against a hostile provider — it is the
  same trust every ingested log already rests on. The word "proof" was deliberately softened to
  "entails … subject to the endpoint being honest" in all three doc sites.
- **D3 cause-unknown cost:** in the narrow window where the poller has a cursor but no anchor (right
  after a bootstrap rewind, or once retention aged them out), a genuinely frozen endpoint is **not**
  routed around for that round. Following Codex's wording literally; disclosed in `classifyRegression`.
- **D3 endpoint-branch imprecision:** the frontier anchor can sit below the cursor, so a reorg strictly
  between them is invisible to the check and such a round would still be attributed to the endpoint. It
  cannot orphan a polled row (rows exist only at anchored blocks), so the cost is one misattributed pin
  released by the next round's progress. Better than the pre-check behaviour; not exact, and not
  claimed to be.
- **B1 clock assumption:** durable freshness carries the **database's** `observed_at` and the grace
  comparison uses the daemon's clock. They are assumed to agree well within the 3-interval grace
  window. Documented on `Poller.Conditions`.
- **B3:** three of the four heartbeats are published values, not independently verified by this wave
  (table above). This is the single item I would most expect a reviewer to press on, and it is recorded
  as open work in `recon/derivation-notes.md` rather than presented as verified.
- **B5:** with one configured endpoint the head probe cannot be independently routed.
- **`00005` legacy attribution** relies on the three source families this codebase has ever written.
  The migration RAISEs rather than leaving an unowned row, so a future family fails the upgrade loudly
  instead of silently recreating A2.
- **`.env.example`** is out of W1 scope and was reverted; see "Scope" for the controller follow-up.

---

## Files

**New:** `internal/store/migrations/00005_price_provenance.sql`, `cmd/indexer/health.go`,
`cmd/indexer/health_test.go`, `internal/chain/chain_head_test.go`,
`internal/store/migrate_upgrade_prices_test.go`, `internal/store/prices_provenance_test.go`.

**Modified:** `cmd/indexer/main.go`, `internal/chain/chain.go`, `internal/chain/chain_test.go`,
`internal/config/config.go`, `internal/config/feeds.go`, `internal/config/feeds_test.go`,
`internal/decode/decode.go`, `internal/prices/{prices,poller,feed}.go` + their tests,
`internal/store/prices.go`, `internal/store/prices_test.go`, `internal/store/derive_test.go`
(`price_poll_anchors` added to the suite TRUNCATE), `internal/store/migrate_upgrade_test.go`,
`recon/derivation-notes.md`, `recon/feeds.json`.

`git diff --stat`: 19 modified files, +3322/−584, plus 1796 lines across the 6 new files.
