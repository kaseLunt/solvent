# Codex adversarial review — Task 8 (round 1)

- **Target:** `bf72d8e` (`feat: oracle price ingestion — engine-exact OP polling, chainlink streams`), diffed against `d0cafea`
- **Verdict:** `needs-attention` — **NO-SHIP**
- **Codex session:** `019f96e2-9294-7b02-996b-ae49b36f5184` (job `review-mrzow24c-wamugo`, ~14 min)
- **Resume:** `codex resume 019f96e2-9294-7b02-996b-ae49b36f5184`
- **Scope verified by controller:** job log has `internal/prices` ×8, `d0cafea` ×3, `W03` ×0, `solvent` ×0; worktree `C:/wtcodex1` pinned at `bf72d8e7941b5cc220e004cf792389634312ccea`; every cited `file:line` falls inside real file bounds. (A decoy session `019f9690-449b-…` from a *different* repository — `W03-p1-*`, commits `7fea66d`/`bd9e631` — was ruled out explicitly.)

> NO-SHIP. The change can irreversibly erase canonical poll history, retain orphaned feed rows after phase changes, and report healthy while prices are missing or stale.

## Cleared checks (verbatim)

Cleared: `RewindDerived`'s extraction preserves its SQL, ordering, errors, and WARN behavior; epoch pruning includes every feed cursor; all proxy/aggregator/start-block values match the normative table; deployed adapter bytecode independently indicates `RATIO_DECIMALS=18` (verified contract `0xf112aF6F0A332B815fbEf3Ff932c057E570b62d3`); all 20 OP entries — USDC, USDT, weETH, WETH, frxUSD, liquidETH, liquidBTC, liquidUSD, eBTC, eUSD, EURC, WHYPE, ETHFI, sETHFI, beHYPE, both liquidRESERVE entries, weEUR, liquidRWA, and OP — use supported `PriceProviderV2.price(address)`, with unknown methods refused during construction. Multicall duplication, `priceSet` last-wins semantics, current cursor namespaces, and the chain-1-only 64-block slack were also cleared.

Tests could not be independently executed because the read-only sandbox denied Go temporary-directory creation; `git diff --check` passed.

## Findings (verbatim)

### [high] Poller rewinds can irreversibly erase all canonical price history — `internal/prices/poller.go:324-370`
Keeping the poller on the epoch gate is necessary: ack-but-keep loses no rows but can leave prices attached to replaced blocks. The implemented alternative is still unsafe because it lowers the poll cursor to the raw-log walker's deepest sparse-log ancestor, which is unrelated to the blocks where polls occurred. A full rewalk can therefore delete every polled row, including canonical history that cannot be reconstructed from logs. The store documentation additionally understates this as at most one interval of loss. A third strategy is available: the multicall already returns a block hash, but the decoder discards it; durable poll block/hash anchors would permit deleting only an unverified/orphaned suffix while retaining the epoch gate.
**Recommendation:** Persist the multicall execution block hash with each poll round or in a durable anchor table, find the nearest hash-verified poll ancestor during reorg repair, and delete only the unverified suffix. Correct the contradictory loss documentation.

### [high] A phase change can leave orphaned old-source rows after the epoch is acknowledged — `internal/store/prices.go:315-330`
`RewindPrices` deletes rows only for the source strings supplied by the currently loaded registry, then acknowledges every chain epoch in the same transaction. After the documented manual Chainlink phase update, `FeedDeriver` owns only `chainlink:<new-aggregator>`; historical `chainlink:<old-aggregator>` rows are no longer in sources. A later deep reorg crossing that phase boundary therefore leaves old-source rows above the effective target while advancing `acked_epoch`. Once pruning removes the epoch, those orphaned rows have no remaining repair trigger.
**Recommendation:** Persist durable engine-to-source ownership history, or store an owner engine on every price row and rewind by owner rather than the current registry's source list. Add a phase-change-then-deep-reorg regression test.

### [high] Poller health remains green while one or every oracle is failing — `internal/prices/poller.go:313-321`
When all targets revert or return undecodable data, `readRound` returns an empty successful batch. `ApplyPrices` advances the cursor, and `Step` unconditionally refreshes `lastLanded`, so `Health` remains healthy forever although no price was recorded. Partial failures are also invisible to `Health` as long as any round commits, allowing a single asset's price to remain stale indefinitely. Existing tests assert cursor advancement but do not test the resulting health state.
**Recommendation:** Track successful freshness per target, do not count an empty batch as a health-landed round, and fail health when any required asset misses its grace window. Test persistent all-target and single-target failures over multiple intervals.

### [high] Restart and rewind reset already-dead feeds to healthy for another full threshold — `internal/prices/feed.go:501-517`
`lastSeen` is process memory only. After restart, a persisted caught-up cursor prevents older `AnswerUpdated` logs from being replayed; the feed is treated as unobserved and measured from a newly assigned `liveSince`. A feed that stopped before restart is consequently reported healthy for another 26 hours. Rewind explicitly clears the same state, creating the same blind spot when the latest canonical answer lies below the rewind target.
**Recommendation:** Before issuing a live verdict, hydrate each feed's latest canonical `updatedAt` from durable raw logs or persist dedicated feed-freshness state. Rehydrate it after every rewind and cover restart-with-preexisting-stale-feed in tests.

### [high] The 26-hour global threshold misses feed failures far beyond their configured heartbeat — `internal/config/config.go:120-125`
The default applies one 26-hour threshold to every stream even though the code acknowledges their heartbeats differ. This is permissive, not conservative, for liquidation-facing freshness: the exact ETH/USD proxy used here is consumed with a 3600-second heartbeat by deployed code (constructor evidence `0x641169f048ee8de8b3037c9d9c840060fe03e463`), so a stopped ETH/USD stream can evade this health signal for roughly 25 hours beyond that bound. Other configured feeds have different heartbeat contracts, making one global value incapable of expressing the required guarantees.
**Recommendation:** Record and validate a heartbeat plus explicit grace per feed in `feeds.json`, use it in staleness evaluation, and add fixtures pinning every configured stream's threshold.

### [high] Feed ingestion violates the binding apply-error reset contract — `internal/prices/feed.go:328-352`
`FeedDeriver` mutates `lastSeen` while decoding, before `ApplyPrices`. For every apply error other than the reactive epoch case, it returns without resetting or rehydrating that state. In the rollback world, memory now reflects a window absent from `prices` and the derive cursor; in the commit-with-lost-ack world, the caller still cannot know what landed. This is the exact partial-preservation shortcut forbidden by the brief and can keep `Health` optimistic while persisted price ingestion is stalled. The fake store already models commit-landed-with-error, but no test exercises it.
**Recommendation:** Stage freshness updates until commit is confirmed and, after any `ApplyPrices`-class error, discard all staged/in-memory apply state and rehydrate cursor plus freshness from durable truth. Test both rollback and committed-with-lost-ack outcomes.

### [high] The claimed failed health check is only a log message — `cmd/indexer/main.go:455-473`
`priceHealth` and `engineHealth` are composed only into periodic WARN logs. They do not affect process status, readiness, liveness, or any externally queryable supervisor surface, and ordinary price `Step` errors are not added to `priceHealth` unless the worker's separate `Health` method also fails. A supervisor therefore continues to see a live process during stale feeds, missing poll targets, or persistent apply failures. The daemon price pass has no unit test covering this composition.
**Recommendation:** Expose a real daemon health/readiness surface composed from both maps, preserving terminal versus recoverable classifications, and add fake-worker tests for failure, backoff, recovery, and process-supervisor visibility.

### [medium] The head gate can misdiagnose a frozen RPC or ingest pipeline as four stale feeds — `internal/prices/feed.go:474-498`
The liveness probe uses the same dependency class as ingestion and accepts any head within 64 blocks of the stored frontier. If both freeze at the same old height, the gap remains small and wall-clock aging eventually marks every feed stale and re-resolves proxies even though the failed component is RPC/ingestion. After one successful live verdict, repeated `BlockNumber` errors preserve `lastLive` indefinitely because there is no verdict TTL. This creates incorrect operational routing and masks the actual dependency failure.
**Recommendation:** Expire cached live verdicts after a bounded TTL, validate head freshness using block timestamp/hash through an independently routed endpoint, and surface RPC/ingest lag separately from feed publication staleness.

### [medium] Non-positive observations become indistinguishable from usable prices — `internal/store/prices.go:213-230`
Zero and negative oracle answers are inserted into the canonical `prices` table with no validity field or constraint; only an ephemeral WARN distinguishes them. A latest-price query in P3 can therefore select zero or negative as an ordinary price, causing divide-by-zero, inverted valuation, or invalid liquidation math. Rejecting the whole replay would wedge the feed, but recording an invalid raw fact as a normal usable price is not the only option.
**Recommendation:** Advance the cursor while quarantining non-positive observations or mark them explicitly invalid, and provide a store-level latest-usable-price contract that can never return them. Add downstream invariant tests.

### [medium] Comments direct P3 to reproduce the uncapped weETH value as the adapter price — `internal/config/feeds.go:54-63`
`FeedRatio` says the Aave adapter's USD price is `getRate() × ETH/USD` and that P3 composes those rows. Normative recon says the adapter uses a growth-capped rate; the raw composition equals adapter output only while the cap is not binding. This conflicts with the accurate caveat in `internal/prices` and can cause P3 to treat an uncapped reference as liquidation-engine truth during the exact depeg/exploit scenarios where the distinction matters.
**Recommendation:** State that the two rows compose only an uncapped reference value, never the adapter's guaranteed output, and that P3 must implement or independently read the growth-cap behavior before claiming adapter equivalence. Correct the matching test comment.

### [medium] Deep-reorg cursor regressions are not bounded to one misattributed round — `internal/prices/poller.go:379-412`
The comment claims a deep reorg costs one endpoint pin, but if the walker is in backoff it may take up to its ten-minute capped delay to record the epoch. During that interval each cadence-due poll returns `ErrDeriveCursorRegression`, rotates away from another healthy endpoint, and can emit the all-endpoints-behind alarm. No incorrect row commits, but the operational diagnosis is false and can persist for multiple rounds rather than the documented one.
**Recommendation:** Treat cursor regression as cause-unknown until reorg state and live block ancestry are checked. Suppress endpoint-specific rotation/all-behind conclusions when a reorg remains possible, and test the walker-backoff interleaving.

## Codex's next steps (verbatim)

- Block shipment until the high-severity data-loss, stale-health, apply-reset, and health-surface findings are fixed and re-reviewed under D-006.
- Add regression coverage for hash-anchored poll rewinds, historical feed sources, partial/all poll failures, stale-feed restart, both indeterminate-commit worlds, and daemon health composition.
- Re-run gofmt, go build, go vet, the full Go suite, race tests, and live-Postgres tests in a writable environment; the reported 348-pass result was not independently reproducible in this sandbox.

## Controller adjudication

All 11 findings **ACCEPTED**, none waived. Fix spec: `.superpowers/sdd/task-8-fixwave-brief.md`.

Note on the last bullet: the 348-pass figure *was* independently reproduced — by the controller at
`bf72d8e` (348 PASS / 0 FAIL / 0 SKIP, `go build`/`go vet` clean, `gofmt -l .` empty), before dispatch.
Codex's caveat reflects its own sandbox denying Go temp-directory creation, not a failure to reproduce.

## Dispatch hygiene note

Four earlier dispatch attempts (`review-mrzoj89p-z5dykf`, `review-mrzomt4f-221zew`,
`review-mrzoq7ql-khwvhn`, `review-mrzot4lj-moh1bf`) wedged and produced nothing: the dispatch call
omitted `run_in_background: true`, so each 2-minute foreground timeout SIGTERM'd the detached Codex
child while its state JSON still read `"running"`. Only `review-mrzow24c-wamugo` ran to completion.
**Always background the Codex dispatch call itself.**
