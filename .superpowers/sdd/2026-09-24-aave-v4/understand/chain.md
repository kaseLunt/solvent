# Chain reads for the V4 sweeper: what `internal/chain` supports and what must be added

## 1. Hash-pinned and number-pinned `eth_call`

- **Hash pin (EIP-1898) exists.** `rpcClient.CallContractAtHash` is declared at `internal/chain/chain.go:56-60`. `endpointClient` embeds geth's `*ethclient.Client` (`chain.go:362-365`), and the repo uses geth v1.13.0 (`go.mod:6`). That client sends `rpc.BlockNumberOrHashWithHash(blockHash, false)` (module cache `ethclient/ethclient.go:506`).
- **The public entry point is `Failover.CallAtHashFrom`** (`chain.go:1446-1496`). It gives caller-scoped routing, returns an `EndpointToken`, and leaves the shared hint alone. On total failure it returns a `*PinnedCallError` that keeps every endpoint's own error (`chain.go:938-996`).
- **`requireCanonical` is always `false`, and the code says so on purpose** (`chain.go:1457-1460`). No code path sets it to true. The only other mentions are comments that treat the end-of-run re-check as the thing that catches an orphaned pin (`cmd/reconcile/main.go:1054,1147`; `cmd/reconcile/p3_phase.go:13`).
- **Number pin exists but is deprecated in practice.** `CallAtFrom` (`chain.go:1411-1444`) was removed from the poller because a height can match on a different fork. `prices.PollChain` leaves it out of its interface on purpose (`internal/prices/prices.go:860-866`).
- **Getting the hash to pin:** use `HeadFrom` (the latest header's provider-reported hash, `chain.go:1203-1225`) or `HeaderHashFrom(n)` (`chain.go:1250`).
- **There is no header-by-hash read.** No `eth_getBlockByHash` or `HeaderByHash` exists anywhere in `internal/` or `cmd/`.

## 2. How `cmd/reconcile` pins its reads

- **The pin block P** is the engine cursor from the DB snapshot. It is resolved to a hash through `pinnedReader.headerHash`, which calls `HeaderHashFrom(ctx, 0, n)` (`cmd/reconcile/phase1.go:194-206`, `main.go:354-372`).
- **Calls** go through `pinnedReader.callAtHash`, which calls `CallAtHashFrom(ctx, 0, …)`, always starting at endpoint 0 (`main.go:388-400`).
- **Multicalls** go through `pinnedReader.multicall` (`main.go:402-446`):
  - `multicallChunkSize = 15` (`main.go:405-408`), because of free-tier caps and server-side loops.
  - Each chunk's in-band `blockNumber` must equal P, or the run fails with `errChunkDivergence` (`main.go:435-439`).
  - The in-band `blockHash` is thrown away (`_` at `main.go:434`).
  - Different chunks may be served by different endpoints, and their indices are recorded (`main.go:411-413`).
- **Fork weld** runs before and after the comparisons: `runWeld` re-reads live header hashes against stored ones (`main.go:1012-1029`, `1134-1147`; `phase1.go:313-337`).
- **Every read runs under an `rpcRunner`** (`cmd/reconcile/rpcclass.go:188-275`):
  - a token bucket, default 1.5 rps across all endpoints and both chains (`main.go:159`, `rpcclass.go:139-166`);
  - 5 bounded walk retries (`main.go:160`);
  - exponential backoff with jitter on HTTP 429 only (`rpcclass.go:255-263`);
  - error classification into block-not-found, state-pruned, throttle, 403 and other (`rpcclass.go:26-78`). A 403 on every endpoint stops at once. "Pruned" is only the verdict after the whole retry budget is spent (`rpcclass.go:265-270`).
- **Raw-RPC reads pinned by hash** (`eth_getCode`, `eth_getStorageAt`, `debug_traceBlockByHash`) live in reconcile's own `pinnedEvidenceReader`, not in `internal/chain` (`cmd/reconcile/code_epoch.go:200-300`).
- **Reconcile-only:** the `snapshotdb.Gate()` check (`main.go:361`).

## 3. Multicalls in the daemon

- **The snapshotter reads at latest, as you said.** It issues one `tryBlockAndAggregate(requireSuccess=false, …)` per Step (`internal/snapshot/snapshot.go:15-16,645`). That call goes through `CallWithToken` (latest, shared hint), or through `CallFrom` when a stale preference is set (`snapshot.go:648-653`). Only the execution block number is kept; the `blockHash` output is ignored (`snapshot.go:691-725`).
- **Batch size and gas:** `defaultBatchSize = 100` (`snapshot.go:129-132`). The only gas reasoning is a comment: "100 Safes per call stays far below node eth_call gas caps" (`snapshot.go:129-131`). No `CallMsg` in the repo sets `Gas`, so every call gets the node's default gas cap.
- **No JSON-RPC batching and no `aggregate3`** anywhere in the repo (grep for `BatchCallContext` and `aggregate3` finds only comments).
- **The price poller is the one in-daemon pattern that pins by hash.** It lives in `internal/prices/poller.go:958-1080`:
  1. `HeadFrom` picks one serving endpoint and gives the pin and `hashBefore`.
  2. A zero hash is refused (`poller.go:1000-1002`).
  3. `CallAtHashFrom(servedBy.Index, …)` runs the multicall.
  4. The round is discarded if a different endpoint answered (`poller.go:1040-1044`).
  5. The round is discarded if the in-band block differs from the pin (`poller.go:1054-1058`).
  6. A closing `HeaderHashFrom` re-read confirms the block is still canonical (`poller.go:1066`).
  7. If every attempt was a block-not-found rejection, the round is discarded with a warning rather than treated as an error (`allAttemptsRejectedPin`, `poller.go:1231-1243`).

## 4. Failover behavior

- **Walk:** `doFrom` tries each endpoint once, bounds each attempt at 30s (`chain.go:24,35`), and rotates on any error (`chain.go:853-874`). There is no retry or backoff inside the chain layer.
- **Shared hint:** `do` moves the `active` hint to whichever endpoint last succeeded (`chain.go:830-845`). All `*From` methods leave it alone.
- **`EndpointToken`** (`chain.go:776-780`) names the endpoint that served a success, or `-1`.
- **Stale endpoints are handled by the caller, not the chain layer.** A frozen endpoint never fails at the RPC layer, so the snapshotter keeps its own `preferredStart` and starts one past the stale server (`snapshot.go:313-332`). The store's monotonic guard is what detects staleness (`snapshot.go:33-45`). The old shared-hint rotation was retired (`chain.go:990-996`).
- **With a hash pin, a lagging or forked node rejects the call** with block-not-found instead of serving other state. A node that ignores the pin is caught by the `blockNumber != pin` check.

## 5. Pacing in the indexer

- **The indexer has no rate limiter.** The only token bucket in the repo is reconcile's (`rpcclass.go:143`).
- **All workers share one `Failover` per chain** (`cmd/indexer/main.go:1214-1240`).
- **Main loop:** a ticker at `cfg.PollInterval` (`main.go:1508`). `SOLVENT_POLL_INTERVAL` defaults to 5s (`internal/config/config.go:117-123`).
- **While any pass advances, the inner loop repeats with no sleep** (`main.go:1596-1598`). The snapshot pass does "at most one multicall batch per round; a due sweep keeps the loop hot" (`main.go:1528-1531`), so a due sweep is paced only by RPC latency and the other passes.
- **`stepsPerRound = 5`** bounds each walker or runner per round (`main.go:60-63`).
- **Per-worker error backoff** starts at 30s and caps at 10m (`cmd/indexer/backoff.go:17-18`).
- **The walker** uses the timed variants and a slow-step budget tied to `chain.AttemptTimeout` (`internal/ingest/walker.go:240-304`). It pins its log windows by re-reading `HeaderHashFromTimed` before and after (`walker.go:800-816`).
- **The log readers take addresses only.** `Logs`, `LogsFrom` and `LogsFromTimed` build a `FilterQuery` with `Addresses` and no `Topics` (`chain.go:1498-1564`), even though the endpoint's `filterArg` does pass topics through (`chain.go:630-649`).

## Implications for the V4 design

**Can reuse as-is**
- `HeadFrom` and `HeaderHashFrom` to fix the generation's block P and hash H.
- `CallAtHashFrom` for every sweep chunk, with the `EndpointToken` and `PinnedCallError` classification.
- Multicall3 `tryBlockAndAggregate(false, …)` and its ABI/unpack code (`snapshot.go:206-213,691-725` or `cmd/reconcile/lens_abis.go:365-400`).
- The poller's round shape: pin, then check the in-band `blockNumber == P`, then a closing `HeaderHashFrom(P)` re-read, then the discard-or-error posture from `allAttemptsRejectedPin`.
- A durable per-generation work queue shaped like the snapshotter's.

**Must add**
1. **A pinned sweeper.** The snapshotter's latest-block path and its monotonic stale guard don't fit "every input at exactly block P". The sweeper must use `CallAtHashFrom` and refuse any chunk whose `blockNumber != P`. The in-band `blockHash` is not usable evidence; reconcile already ignores it.
2. **Its own chunk size and gas assumption.** There is no gas model today. 100 and 15 are the only precedents, and both are for other views. `getUserPosition`, `getUserReserveStatus` and `getUserAccountData` loop over reserves inside the contract, so the per-call cost needs measuring.
3. **Its own pacing.** With about 50–100 calls per generation, a hot loop against one shared Failover will burn provider budget in bursts. The indexer has nothing like reconcile's `rpcRunner` (limiter, 429 backoff, pruned-after-budget). That would need lifting into a shared package.
4. **A rule for chunks served by different endpoints.** The poller discards a round if the endpoint changes; reconcile accepts it. Either is sound under a hash pin, but the sweeper must choose one, and a generation-long rule matters for the drawn-shares completeness ring.
5. **A topics parameter on the log readers**, for the topic0-filtered discovery stream.
6. **A canonicality check after the sweep** (re-read `HeaderHashFrom(P)`), because `requireCanonical=false` means an orphaned P keeps being served silently.

**Would break**
- Reusing `snapshot.Chain` (`CallWithToken`/`CallFrom` at latest) would mix blocks across chunks.
- `CallAtFrom` (number pin) is also wrong here: it can execute on a different fork at the same height.