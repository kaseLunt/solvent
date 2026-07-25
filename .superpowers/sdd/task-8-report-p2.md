# Task 8 report — `internal/prices` (oracle price ingestion), Phase 2

Base commit `3cc34da`, branch `main`, worker W1.

---

## 1. What was built, file by file

### New — `internal/prices/` (the task's package)

| File | Lines | Contents |
|---|---|---|
| `prices.go` | 598 | Package doc (all normative recon facts + honest caveats); pseudo-engine cursor keys (`PollCursorEngine`/`FeedCursorEngine`); `prices.source` naming (`SourcePriceProviderV2`, `ChainlinkSource`, `RatioSource`); the CLOSED `pollViews` capability map (`price(address)`, `getRate()`) with per-view pack/unpack/source; `chainlinkProxyABI.aggregator()`; multicall3 plumbing; `PriceStore` / `PollChain` / `FeedChain` surfaces; `priceSet` (last-wins batch dedupe); `buildPollTargets` / `sourcesOf` registry resolution. |
| `poller.go` | 445 | `Poller` — one multicall3 `tryBlockAndAggregate` round per cadence interval over every registry poll obligation on a chain, landed through one `ApplyPrices`. Reorg-first ordering, cadence anchor consumed by the *attempt*, per-asset revert/undecodable skips, all-failed DEGRADED, frozen-endpoint routing (pin + ambiguity lease + release on progress), recoverable `Health()`. |
| `feed.go` | 595 | `FeedDeriver` — reader over committed `raw_logs` for `AnswerUpdated`, mapping aggregator→asset through the registry. Mirrors `derive.Runner.Step` (reorg-first, resume-from-cursor, windowed, min-over-streams frontier). Staleness surface: live-head gating, WARN, FAILED health check, rate-limited proxy `aggregator()` re-resolution with phase-change vs. dead-aggregator discrimination. |
| `prices_test.go` | 581 | Shared fakes (store/chains, ordering-faithful `RawLogsInRange`), response builders through the production ABIs, selector pins, source-naming/cursor-namespace pins, `priceSet` semantics, registry resolution, unpack hardening. |
| `poller_test.go` | 503 | 21 poller tests (below). |
| `feed_test.go` | 643 | 26 feed-deriver tests (below). |

### New — store surface (additive only)

`internal/store/prices.go` (335 lines):

- `PriceObservation{Asset, Source, Price, Decimals, BlockNumber}` — no `ChainID` field, so a cross-chain observation is *structurally* impossible rather than validated.
- `ApplyPrices(ctx, engine, chainID, obs, throughBlock)` — the epoch-gated write. Same gate order as `ApplyDerivedWithRates`: chain binding → reorg-epoch gate (incl. the no-cursor bootstrap refusal) → inserts → monotonic chain-bound cursor upsert with read-back disambiguation. Per-row semantics: identical replay is a no-op; divergent **price OR scale** aborts the whole batch. Rejects an observation above `throughBlock`. An empty batch still advances the cursor.
- `RewindPrices(ctx, engine, chainID, toBlock, sources)` — chain-binding refusal, then shared effective-target computation, then a **source-scoped** `DELETE` and the epoch ack **in one transaction**. Touches nothing `RewindDerived` touches.
- `insertPrice` — the one implementation of the write semantics, so both writers get the same idempotence/divergence rules and the same non-positive-price WARN.

`internal/store/prices_test.go` (417 lines): 19 live-DB tests.

`internal/store/derive.go` (+34/−12): extracted `rewindTarget(ctx, tx, engine, chainID, ackedEpoch, toBlock) (effectiveTarget, maxEpoch, err)` from `RewindDerived` and now shared with `RewindPrices`. **Behaviour-preserving**: identical SQL, identical statement order, identical WARN message and attributes — verified by diff and by the pre-existing rewind tests.

### New — config surface

`internal/config/feeds.go` (355 lines): `LoadFeeds(path, chains)` — the `recon/feeds.json` registry loader the plan asked for, with the `poll|chainlink_stream` vocabulary (`KnownFeedKinds`), chain-key→chain-id resolution, and strict per-kind validation. `Feeds.PollAssets/RatioAssets/StreamAssets` selectors.

`internal/config/config.go` (+40/−3): `PriceInterval` (`SOLVENT_PRICE_INTERVAL`, default 60s, positive-only) and `FeedStaleness` (`SOLVENT_FEED_STALENESS`, default 26h, positive-only).

`internal/config/feeds_test.go` (289 lines): the positive case reads the **real** `recon/feeds.json` and pins the normative facts; 26 table-driven refusal branches; 2 env-knob tests.

### Modified — registry and daemon

`recon/feeds.json` (+9/−0): **additive only** — see deviation D-1.

`cmd/indexer/main.go` (+163/−23): `-feeds` flag (default `recon/feeds.json`); registry load against `cfg.Chains`; per-chain `Poller` construction (deterministic, sorted chain keys); per-`chainlink_feed`-spec `FeedDeriver`; a price pass in the hot loop with jittered retry backoff; a **separate, recoverable** `priceHealth` map + DEGRADED tick summary.

`cmd/indexer/main_test.go` (+9/−9): mechanical rename only — see deviation D-2.

---

## 2. Verification — actual observed output

Environment: `TEST_DATABASE_URL='postgres://solvent:solvent@localhost:5432/solvent?sslmode=disable'`, `solvent-db-1` already up and migrated.

**Measured baseline at `3cc34da`, before any edit** (reproduced, not assumed):

```
go build ./...   → BUILD OK
go vet ./...     → VET OK
gofmt -l .       → (no output)
go test ./... -count=1 -v | grep '^--- ' | awk '{print $2}' | sort | uniq -c
   265 PASS:
```

265 PASS, 0 FAIL, **0 SKIP** — matches the brief exactly.

**Final, at HEAD of this work:**

```
go build ./...   → BUILD OK
go vet ./...     → VET OK
gofmt -l .       → (no output)

go test ./... -count=1 -v | grep '^--- ' | awk '{print $2}' | sort | uniq -c
   348 PASS:

go test ./... -count=1
ok  github.com/kaselunt/solvent/cmd/indexer       0.556s
ok  github.com/kaselunt/solvent/internal/chain    0.544s
ok  github.com/kaselunt/solvent/internal/config   0.466s
ok  github.com/kaselunt/solvent/internal/decode   0.545s
ok  github.com/kaselunt/solvent/internal/derive   1.323s
ok  github.com/kaselunt/solvent/internal/ingest   0.482s
ok  github.com/kaselunt/solvent/internal/prices   0.597s
ok  github.com/kaselunt/solvent/internal/snapshot 0.597s
ok  github.com/kaselunt/solvent/internal/store    7.401s
```

**348 PASS, 0 FAIL, 0 SKIP** = 265 baseline + 83 new. No coverage lost.

**`-race` — actually run, in a container with the live DB** (the host lacks cgo):

```
docker run --rm --network solvent_default -v "//c/.../Solvent://src" -w //src \
  -e "TEST_DATABASE_URL=postgres://solvent:solvent@db:5432/solvent?sslmode=disable" \
  golang:1.24 go test -race ./... -count=1 -v

   348 --- PASS:
   ok (all 9 packages)
   0 occurrences of "WARNING: DATA RACE"
```

The `internal/store` package took 7.1s under `-race` with the container DSN, confirming the live-DB tests genuinely executed rather than skipping.

### The 83 new tests

`internal/store` (19, live DB): round-trip; verbatim recording (stable snap `1e6`, zero, negative); idempotent replay; divergent-value whole-batch abort (with cursor-did-not-move assertion); divergent-**scale** abort; above-through-block refusal; validation (nil price, empty source, non-address asset, out-of-range scale — all before any write); empty batch advances cursor; cursor regression → `ErrDeriveCursorRegression`; same-block re-admission; chain mismatch; the epoch gate (refuse → `RewindPrices` → admit); no-cursor bootstrap refusal naming `RewindPrices`; source-scoped deletion leaving the co-tenant writer's rows and cursor untouched; lowering to the deepest unacked epoch + max-epoch ack; rewind chain mismatch deleting nothing; empty-sources ack; **`PruneAckedReorgEpochs` waits for a price cursor (M4)**; per-writer cursor independence incl. non-collision with a derive engine.

`internal/config` (29): the real-registry pin (20 OP poll / 4 ETH streams / PriceProviderV2 address / 6-dec / 8-dec / 4 raw aggregators + 4 proxies / weETH ratio 18-dec / both `liquidRESERVE` contracts surviving); 26 refusal branches; shared-aggregator refusal; missing/malformed file; the two env knobs.

`internal/prices` (35): selector pins against `keccak(signature)` plus recon's/snapshot's independently-recorded literals (`0xaea91078`, `0x679aefce`, `0x245a7bfc`, `0x399542e9`) and the AnswerUpdated topic0; source naming incl. case-insensitivity; cursor-namespace non-collision (both directions — it also fails if a `config.KnownEngines` value ever gains a colon); `priceSet` last-wins + defensive copies + nil pass-through; registry resolution incl. unsupported-method and two-contracts-one-source refusals; unpack hardening (short words, wrong result count, panic→error). Poller: request shape against the real 20-asset registry (target, selector, calldata, order, `requireSuccess=false`), observations, the ETH `getRate()` ratio row, per-asset revert, per-asset undecodable return, all-failed-still-advances, cadence gate, failed round consumes its slot, malformed envelope, reorg-before-cadence, resume-from-cursor-read-back, bootstrap target 0, missing-cursor contract violation, reactive epoch rewind, stale-endpoint pin + `CallFrom` routing + release on progress, all-endpoints-behind, ambiguity lease retain×2 then rotate, no-lease-without-pin, recoverable health, constructor validation, oversized-registry refusal. Feed deriver: exact registry↔config match (both directions + malformed address), constructor validation, window derivation with per-log block stamps, last-wins within a block, verbatim negative answer, unknown-topic skip, decode-error fails the Step, min-over-streams frontier, waits for every stream cursor, window cap, reorg-first + staleness-tracking reset, bootstrap target, resume-from-cursor-read-back, missing-cursor violation, reactive epoch rewind, **staleness suspended during backfill**, stale-at-live-head WARN + FAILED health + one proxy re-resolution, phase-change naming the new aggregator, resume clears health, never-published trips after the threshold, streams-below-their-startBlock exempt, head-probe failure keeps the verdict, head-probe rate limiting, caught-up-is-not-progress, `Sources()`, implausible-`updatedAt` clamping (future + out-of-int64).

---

## 3. Design decisions carried in, and how they were satisfied

1. **Own derive cursor for `chainlink_feed`, and epoch pruning must wait for it (M4).** Cursor keys are colon-namespaced and **chain-id**-qualified: `prices:chainlink_feed:1`, `prices:poll:10`, `prices:poll:1`. Colons cannot appear in a `config.KnownEngines` value, so collision is structurally impossible — and a test fails if that ever changes. The pruning obligation is proved by `TestPruneAckedReorgEpochsWaitsForPriceCursor`: a chain-10 epoch acked by `debt_manager` but not by the price cursor prunes **0** rows; after the price cursor acks, it prunes 1.
2. **Feed reorg handling joins the unacked-epoch gate, with `prices` deletion inside the rewind/ack transaction.** `store.RewindPrices` does exactly this, and the deletion is **source-scoped** so co-tenant writers on the same chain are not collateral damage (`TestRewindPricesDeletesOnlyOwnSources`). Chain 1 genuinely has two price writers today (feed deriver + weETH ratio poller), so this is not hypothetical.
3. **Staleness → WARN + failed health check + proxy `aggregator()` re-resolution; config repair manual.** Implemented; no auto-repointing anywhere. The re-resolution log discriminates the two cases (proxy re-pointed → names the new address and says update `config/contracts.json` **and** `recon/feeds.json` by hand; proxy unchanged → says this is not a phase change, the aggregator itself stopped).
4. **OP is poll-only and engine-exact; supplier side out of scope.** `pollViews` is a closed set; an unlisted method is a construction refusal. Values are recorded verbatim — the `1e6` stable snap is asserted as a stored fact, never re-derived.

**Binding rules:** always resume from `DeriveCursor` (both workers re-read after every rewind and assert the store created one); commit indeterminacy respected (no in-memory derived state to desync — documented explicitly, with the one telemetry-only residue named at `observe()`); `ErrUnackedReorgEpoch` recovered from, never fatal, in both workers; merged per-chain `(block_number, log_index)` order via `RawLogsInRange` with the full address set (and the test fake now *sorts* to match the real contract); advisory-lock liveness untouched (still per round, still fatal); time-based jittered backoff (see D-2); store additive only; **no mainnet daemon run**.

---

## 4. Disclosed deviations

### D-1 — I added two fields to `recon/feeds.json` (a NORMATIVE artifact). Additive only.

`recon/feeds.json` is in W1's `allowed_paths`, but it is normative for Tasks 4–10, so this needs explicit adjudication. I changed **no existing value**; I added:

- **`oracle.proxy`** on each of the four `chainlink_stream` entries, taken verbatim from the recon table's "Underlying CL proxy" column (`0x5f4eC3Df…`, `0x8fFfFfd4…`, `0x8f1dF6D7…`, `0xB9E1E3A9…`).
  *Why required:* design decision 3 mandates re-resolving *the proxy's* `aggregator()` on staleness. `feeds.json` carried only the raw aggregator, and `aggregator()` **reverts on the cap adapters** — so without the proxy address there is nothing to call. The values already exist in `derivation-notes.md`; this makes them machine-readable.
- **`ratio`** (`contract` / `method` / `decimals`) on the ETH weETH entry.
  *Why required:* the brief mandates recording a polled `getRate()` ratio row, and the recon notes state the weETH USD price "additionally needs the daily-moving `getRate()` ratio (poll)" with `RATIO_PROVIDER() = weETH getRate()`. The alternative was hard-coding one asset's second oracle in Go, which contradicts "drive the asset list from the registry".

I did **not** touch `recon/derivation-notes.md`.

**Unverified value inside D-1:** `ratio.decimals: 18`. I did not read it on-chain (no mainnet run is in scope). It comes from the recon note's 18-dec weETH/ETH rate convention and Aave's `RATIO_DECIMALS = 18` for the weETH adapter. If the reviewer wants it verified, that is a one-call check in Task 9. **Treat 18 as declared-not-verified.** A wrong scale here would misprice weETH in P3 composition, so it is worth a Task 9 assertion.

### D-2 — I renamed `walkerBackoff` → `retryBackoff` in `cmd/indexer` (touches Task 7-era `main_test.go`).

The brief requires "time-based backoff with jitter on errors" for the new workers. `cmd/indexer` already had exactly that implementation, named for its only user. Rather than write a second copy inside `internal/prices`, I renamed the existing type and its three constants and reused it for the price workers. `main_test.go` changed by 9 identifier substitutions; no assertion, no logic, no constant value changed. Alternative considered and rejected: a private duplicate in `internal/prices` — same policy, two places to drift.

### D-3 — I gave the POLLER an epoch-gated cursor too, not just the feed deriver.

Design decision 2 speaks only about *feed* reorg handling. I extended the same mechanism to the poller, deliberately, and this is the change I most want scrutinised.

*Reason:* a poll row is stamped with the block the multicall executed at. Leaving the poller outside the gate means a reorg can leave `prices` rows asserting engine-exact liquidation prices at heights the chain replaced — on a money-adjacent, source-of-truth table — and I did not want to ship that hole silently. Routing both writers through one mechanism also means there is exactly one implementation of the write and rewind semantics.

*Costs, stated plainly:*
- The poller's cursor now also gates `PruneAckedReorgEpochs` on its chain. A permanently-stopped poller holds its chain's epochs forever — the same bounded, visible cost the derive engines already carry.
- **The poller's rewind is LOSSY and cannot be re-derived.** The store lowers the target to the walker's *verified ancestor*, which can sit well below the actual fork point when raw logs are sparse, and degenerately (`fullRewalk`) is `StartBlock-1`. The poller only ever reads `latest`, so deleted rows are gone for good: a deep rewind discards polled price history for heights that were in all likelihood canonical, and the worst case discards **all** of it. The next round re-establishes a price at the new head within one cadence interval. The distance discarded is WARNed (`blocksDiscarded`) rather than left silent. This is documented in `prices.go`'s package doc, in `store/prices.go`'s ASYMMETRY note, and on `Poller.rewind`. **If the reviewer prefers "ack but keep the rows", the change is one call site (pass an empty `sources` list) — the store already supports it and there is a test for that path.**

### D-4 — `LoadFeeds` uses `DisallowUnknownFields`; `config.Load` does not.

Deliberate asymmetry. Every *required* registry field is bounds-checked, so a typo'd required key already fails validation via its zero value — but a typo'd **optional** key (`"ratios"` for `"ratio"`) would silently drop an entire prices row family with no error anywhere. Consequence: the registry schema carries no annotation fields (unlike `recon/abis/*.json`'s `_provenance`); notes belong in `derivation-notes.md`. Documented at the call site.

### D-5 — Three test files instead of the plan's single `internal/prices/prices_test.go`.

`prices_test.go` (shared fakes + core pins), `poller_test.go`, `feed_test.go`. 1,727 test lines in one file would be worse to review. No coverage difference.

### D-6 — The multicall3 plumbing is DUPLICATED from `internal/snapshot`, not extracted.

`internal/prices` carries its own copy of the `tryBlockAndAggregate` ABI, call tuple and panic-hardened unpacker. Extraction to a shared package would mean editing the nine-wave-approved snapshotter *and* its response builders, which is outside a price task's blast radius. The copy is independently selector-pinned (against `keccak`, and cross-checked against the literal `snapshot` pins) and independently panic-hardened. Flagged in a code comment as a recommended follow-up, not a silent divergence. I consider this the weakest of my calls and will take the reviewer's ruling either way.

### D-7 — Test-only: config refusal cases are generated from an in-line template into `t.TempDir()`, not carried as `internal/config/testdata/*.json` files.

26 refusal branches × one file each would be 26 new fixtures. Existing config tests use `testdata/`; I matched that style only for the positive path (which reads the real registry).

### D-8 — The daemon now depends on `recon/feeds.json` at RUNTIME.

`run()` fails to start if the registry cannot be loaded. That makes a research directory an operational dependency. Mitigated by the `-feeds` flag (an operator can point at a deployed copy), and it matches the plan ("`feeds.json` loader (extends config surface)"). I flag it because "no registry ⇒ daemon will not start" is a deployment-shape change, not just a code change. If the reviewer prefers the registry live under `config/`, that is a file move plus a default-flag change.

---

## 5. Things I could not verify

1. **`ratio.decimals: 18` for weETH `getRate()`** — declared from recon convention, not read on-chain (see D-1). This is the single unverified *value* in the change.
2. **No mainnet daemon run**, per the brief. Everything about live behaviour — that `PriceProviderV2.price()` actually returns 6-dec USD for all 20 OP assets, that all 20 succeed inside one multicall's gas budget, that the four proxies' `aggregator()` return the configured raw aggregators today — is asserted from recon, not observed by me. `maxPollTargets = 100` and the "21 obligations fit one `eth_call`" claim are *reasoned* (mirroring the snapshotter's 100-per-multicall budget), **not measured**. Task 9 should measure it.
3. **The daemon's price pass in `cmd/indexer/main.go` has no unit test.** The `retryBackoff` reuse and the health-map handling are exercised only by compilation and by `main_test.go`'s pre-existing backoff tests. Testing the loop needs live chain clients + a DB; consistent with how the walker/runner/snapshotter passes are already (not) tested there. The *workers* are heavily tested in isolation.
4. **The `SOLVENT_FEED_STALENESS` default (26h) does not match any individual feed's heartbeat.** Per-feed heartbeats are not recorded in `feeds.json` and I did not query them. The value is a deliberately generous single global bound (24h + 2h grace); a per-feed threshold is a declared deferral, documented on the config field. I make **no claim** that 26h is right for any specific feed.
5. **`liveSlackBlocks = 64` is calibrated for Ethereum** (~13 min at 12s blocks) and is the only chain the feed deriver runs on today. On a 2s chain it would be a ~2 min window. Documented, not measured.
6. **Reorg behaviour is tested against fakes plus the live store**, never against a real reorg. Same posture as Tasks 4–7.

---

## 6. Where I think the reviewer should attack hardest

1. **D-3: should the poller be on the epoch gate at all, given its rewind is lossy?** This is the real judgement call. Deleting canonical polled history because the *walker's* verified ancestor happened to be deep is a genuine cost; keeping rows that reference replaced blocks is a genuine correctness hole. I chose the latter risk over the former. The switch is one call site.
2. **Staleness measurement.** I track each aggregator's `updatedAt` in **process memory**, fed from decoded logs (not from committed rows), and only render a verdict when a rate-limited head probe says the frontier is within 64 blocks of head. Consequences to attack: (a) a restart resets tracking, so a feed that died before startup is announced up to one threshold late — an accepted warm-up, not a silence; (b) `liveSince` is the reference *only* for never-observed feeds — it is deliberately **not** a floor under an observed timestamp, and making it one was a real bug I found and fixed while testing (it suppressed every genuine stall); (c) if the walker stalls, all four feeds eventually read stale, which I consider correct but is arguably the walker's signal to raise.
3. **`ApplyPrices`' divergence refusal as a wedge risk.** A divergent price at an already-recorded `(chain, asset, source, block)` aborts the whole batch. For the poller this self-heals (the next round is at a new head) unless head is frozen — which is itself the failure worth surfacing. For the feed deriver, a re-derivation after a reorg could in principle meet a surviving row with a different value; `RewindPrices` deletes above the effective target in the same transaction as the ack specifically to prevent that. **Is there a path where a feed row survives at or below the effective target with a value re-derivation will contradict?** I believe not (the walker's target is a hash-verified ancestor), but that is the invariant I would attack.
4. **Non-positive prices are RECORDED, not refused** (WARN only). Rationale: refusing would wedge the feed deriver forever on a log that already exists in `raw_logs`, and this layer's job is to persist what the oracle said. Someone could reasonably argue a zero/negative USD price should be refused at the boundary instead of handed to P3.
5. **The "one multicall per round" invariant** and its construction-time refusal above 100 obligations. I chose a hard refusal over silent chunking so that giving up the single-as-of-block property is a deliberate act. That is a landmine for whoever grows the registry past 100 assets — is the refusal the right ergonomics?
6. **The frozen-endpoint policy was copied from `internal/snapshot` in spirit, not in code.** I re-derived the pin / ambiguity-lease / release-on-progress state machine for a different trigger (`ErrDeriveCursorRegression` instead of `ErrStaleSweepBatch`). Worth checking that I did not lose a lesson the snapshotter learned across its waves — in particular whether treating a cursor regression as *always* endpoint staleness is safe. I found and documented one imprecision: a deep reorg can move head backward, and a poll inside the window before the walker notices would mis-attribute the low block to the endpoint. Cost is one round's pin against a healthy endpoint.
7. **D-6, the multicall duplication.** If the ruling is "extract it", I will.

---

## 7. Scope and governance

- Changed paths, all inside W1's `allowed_paths`: `internal/prices/**` (new), `internal/store/prices.go`, `internal/store/prices_test.go`, `internal/store/derive.go`, `internal/config/feeds.go`, `internal/config/feeds_test.go`, `internal/config/config.go`, `cmd/indexer/main.go`, `cmd/indexer/main_test.go`, `recon/feeds.json`.
- **Nothing** under `roadmap/` was read for mutation or written. No claim, decision, STATUS or ROADMAP file touched.
- `go.mod` / `go.sum` unchanged (no new dependency).
- **No migration.** `prices` already exists at `00002_positions.sql:92` with PK `(chain_id, asset, source, block_number)` — which is exactly the identity this task needs, *and* the right index prefix for P3's "latest price at or below block N for (chain, asset, source)". I found no defect requiring a `00005`. One deferral noted: `RewindPrices`' `DELETE … WHERE chain_id = $1 AND block_number > $2 AND source = ANY($3)` can only use the PK's `chain_id` prefix, so it scans that chain's rows. Acceptable for a rare reorg; a supporting index would be a future migration, not a defect fix.
- Staged by explicit pathspec. Never `git add -A` / `git add .`.
- Pre-commit gates (doctor + scope gate) ran and **passed**; nothing was bypassed.
