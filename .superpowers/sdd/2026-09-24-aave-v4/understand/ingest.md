## Ingest and streams: findings for `aave_v4_cash`

### 1. How a stream is defined
- **JSON schema.** `fileStream` at `internal/config/config.go:88-96` has these fields: `name, chain, engine, addresses[], startBlock, window, confirmations`. The live config is `config/contracts.json:6-106`. There is **no topics field**.
- **Validation** in `Load` (`config.go:185-225`):
  - the engine must be in `KnownEngines` (`:13-24`; no `aave_v4_cash` yet);
  - stream names must be unique (`:195`);
  - window and confirmations must be above 0, startBlock must be above 0, and addresses must not be empty (`:202-213`).
- **Unknown JSON keys are silently dropped.** `Load` uses plain `json.Unmarshal` (`config.go:109`), unlike `feeds.go:257`, which calls `DisallowUnknownFields`. A misspelled `"topic0s"` key would therefore run the stream **address-only without any warning**.
- Nothing stops two streams from sharing an address. Only the name is checked.

### 2. The getLogs filter is address-only
- `Step` calls `w.chain.LogsFromTimed(ctx, servedBy.Index, next, to, w.cfg.Addresses)` at `internal/ingest/walker.go:808`.
- `Failover.LogsFromTimed` builds `ethereum.FilterQuery{FromBlock, ToBlock, Addresses}` with **no Topics** (`internal/chain/chain.go:1544-1566`; the same holds for `Logs`/`LogsFrom` at `:1498`/`:1521`).
- `filterArg` already puts `q.Topics` on the wire (`chain.go:630-634`). Supporting topics needs **no wire change**, only a new parameter.
- `WalkerConfig` has no topics (`walker.go:83-90`). The indexer builds it from `config.Stream` at `cmd/indexer/main.go:1254-1261`.
- The only per-log membership gate is the address check (`walker.go:873-876`). There is no topic gate.
- The coherence checks (`walker.go:797-852`: tip hash before and after, cursor recheck; `:881-895`: fork consistency and tip-hash match per log) compare logs against headers **only when logs exist**. They never assume every log of an address is present. So they stay valid under a topic filter. Only the *custody meaning* of an empty window changes.

### 3. Identity and custody claim in the DB
- `ingest_cursors(stream PK, chain_id, last_block, last_block_hash, updated_at)` is defined at `internal/store/migrations/00001_ingest.sql:2-8`.
- `raw_logs` is keyed `(chain_id, tx_hash, log_index)` and has **no stream column** (`00001_ingest.sql:10-21`). Custody is therefore implicit: address × [startBlock, cursor].
- **No stream filter fingerprint exists anywhere.** The nearest analogue is the *derive-side* `CoverageBindingOf`, a sha256 over the sorted `address@startBlock` pairs (`internal/store/derivecoverage.go:97-117`). It is built per engine in `BuildRunnerSpecs` (`internal/derive/runner.go:239-249`) and checked by riskd against an audited constant (`cmd/riskd/main.go:334`). It does not cover topics, so a topic-set change leaves it unchanged.
- **Readers select by address, not by stream.** `RawLogsInRange` filters `address = ANY($2)` (`internal/store/derive.go:888-893`).
- **Reorg handling is chain-wide.** `HighestLogAtOrBelow` scans every raw log on the chain (`store.go:220-236`). `Rewind` deletes raw_logs and block_headers chain-wide, records `reorg_epochs`, and rewinds sibling cursors (`store.go:356-402`).
- The `SaveBatch` cursor upsert checks only height and hash monotonicity (`store.go:295-311`).

### 4. Code that assumes a stream holds every log of its address
- `internal/store/collateralflags.go:10-17`: collateral-flag fold, relying on the "ADDRESS-ONLY getLogs filter".
- `internal/riskfeed/assemble.go:641-653`: "CHAIN-EXACT under genesis-complete custody … getLogs filter is address-only".
- `internal/store/risk.go:815-818` (`DMParamsAsOf`) and `cmd/riskd/main.go:470-474`: DM params are taken from position_events "since genesis".
- `cmd/reconcile/heartbeat_scan.go:17-21, 190`: "no holes by construction … address-only filters".
- `internal/decode/decode.go:262-273`: address-blind topic0 dispatch, which is only safe with one pinned address per stream.
- `internal/derive/runner.go:167-175` and `derivecoverage.go:53-65`: the coverage claim is address@startBlock only.

All of these are on the DM, V3 or Chainlink engines. None would read a V4 stream, as long as topic filtering is **refused for those engines**.

### 5. Minimal safe way to add a topic0 allowlist
1. **Config** (`config.go`):
   - add `Topic0s []string \`json:"topic0s,omitempty"\``;
   - switch the decoder to `DisallowUnknownFields`;
   - validate each entry as a 32-byte hex value, deduplicate and sort them;
   - refuse `topic0s` on any engine except `aave_v4_cash`;
   - refuse any address that appears in two streams on the same chain (otherwise address-keyed readers mix a filtered and an unfiltered history).
2. **Stream filter fingerprint.** Define `sha256("stream-filter/v1;chain;sorted addrs;sorted topic0s|*")`. Add a migration with `ingest_cursors.filter_fingerprint TEXT NOT NULL DEFAULT '<the v1 address-only value>'` (or backfill the value computed from the current config).
   - `Cursor` returns it.
   - `SaveBatch` upserts it and adds `AND ingest_cursors.filter_fingerprint = EXCLUDED.filter_fingerprint` to the WHERE clause, so a mismatch surfaces as the existing "cursor regression" refusal.
   - `Step` refuses (a typed error, not a discard) when the stored fingerprint differs from the configured one. A topic-set change then requires an explicit operator reset or re-walk instead of silently extending old custody.
   - `Rewind`'s sibling UPDATE leaves the column untouched, which is fine.
3. **Walker.** Add `Topic0s []common.Hash` to `WalkerConfig`. Thread it through `Chain.LogsFromTimed` (`walker.go:49`, `chain.go:1544`, fake at `walker_fake_test.go:349`) as `Topics: [][]common.Hash{topic0s}`, or nil when the list is empty. Add a per-log gate next to `walker.go:873` that rejects a log with no topics or a topic0 outside the allowlist, since a provider could ignore the filter.
4. **Coverage.** Add the topic set to `CoverageStream`/`CoverageBindingOf` for filtered streams only, with a v2 prefix, so existing address-only bindings (including `AuditedAaveCoverageBinding`) hash exactly as they do today.
5. **Decode.** Add a `aave_v4_cash` table to `engineTopics` (`decode.go:233-241`) and bump `RegistryRevision` (`:176`). Assert in a test that every configured topic0 is registered for the engine, and the reverse: a filtered-out topic that the decoder knows is dead code.

### 6. How the decode layer registers events
- ABIs are embedded from `internal/decode/abis/*.json` (`decode.go:27-40`), not read from recon at runtime, and parsed in `mustParseWrappedABI` (`:51`).
- Per-engine maps from topic0 to decode function are filled in `init()` (`decode.go:204-231`) using the ABI's `Events[...].ID`. They are joined in `engineTopics` (`:233-241`); `aave_param` uses `configuratorTopics` from `configurator.go`.
- An unknown topic0 is a silent `(nil,false,nil)` (`decode.go:274-276, 296-300`), and the runner skips it (`internal/derive/runner.go:435-437`). The param runner is the exception: it errors on an unknown topic0 (`internal/derive/params.go:185`).

### 7. `MigratedToLendGateway(address,uint256)`
- **The DM decoder does not know it.** The `debtManagerTopics` registrations (`decode.go:208-219`) do not include it. The event name, "LendGateway" and the `4836b2e4` prefix all have zero matches anywhere in the repo.
- **It is not in any ABI.** The event lists of `recon/abis/DebtManagerCore.json`, `recon/abis/DebtManagerAdmin.json` and `internal/decode/abis/DebtManagerCore.json` are the same 21 events, and this one is not among them.
- **The DM stream is address-only.** `contracts.json:7-15` names a single address, `0x0078C5a4…9553`, from startBlock 149521228, and no Topics are sent (`chain.go:1549-1553`). So any such log **emitted by that exact address** below the `op:debt-manager` cursor is already in `raw_logs` and has been silently skipped by the deriver.
- Two things are unverified, because I made no RPC or DB calls and had no local keccak tool:
  - whether the event is emitted by the DM proxy itself rather than by another contract;
  - the full topic0 value.

  A read-only check would be: `SELECT count(*) FROM raw_logs WHERE chain_id=10 AND address='\x0078c5a459132e279056b2371fe8a8ec973a9553' AND substring(topics[1] from 1 for 4)='\x4836b2e4'`.

### Implications for the V4 design
- **Must change:**
  - `config.go`: `topic0s` field, `DisallowUnknownFields`, the engine gate for filtering, the cross-stream duplicate-address refusal, and `KnownEngines += aave_v4_cash`;
  - `WalkerConfig` and the `LogsFromTimed` signature (plus 1 fake and 1 chain test);
  - the walker's topic0 gate;
  - a migration adding `ingest_cursors.filter_fingerprint`, enforced in `Cursor`, `SaveBatch` and `Step`;
  - topics in `CoverageBindingOf` for filtered streams;
  - the V4 decode table and a `RegistryRevision` bump.
- **Can be reused as-is:** the coherent-window Step (hash pinning and fork checks), `filterArg`'s Topics support, `SaveBatch` dedup and divergence refusal, chain-wide `Rewind` and reorg epochs, and the `RawLogsInRange` address feed.
- **What would break or needs care:**
  - A V4 reorg on OP rewinds the **DM** cursors and invalidates DM derived state, because rewinds are chain-wide (`store.go:386-390`, `reorg_epochs`).
  - Without the fingerprint, adding a topic later leaves history below the cursor that was never fetched, while coverage still reads as complete.
  - Allowing topic filtering on the DM, V3 or Chainlink streams would falsify the six "complete custody" arguments in section 4.
  - If the V4 stream ever holds more than one address, the address-blind dispatch at `decode.go:262-273` must be revisited.