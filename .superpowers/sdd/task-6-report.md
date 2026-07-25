# Task 6 Report: `internal/ingest` — reorg-safe window walker

## Summary

Implemented per the task brief exactly, via strict TDD:
1. Transcribed the brief's `walker_test.go` verbatim into `internal/ingest/walker_test.go`.
2. Ran `go test ./internal/ingest/` — confirmed RED (compile failure: `undefined: Chain/Store/Walker/NewWalker/WalkerConfig`).
3. Transcribed the brief's `walker.go` verbatim into `internal/ingest/walker.go`.
4. Ran `go test ./internal/ingest/ -v` — confirmed GREEN (6/6 PASS).
5. Ran quality gates scoped to `internal/ingest/`: `gofmt -l` clean, `go vet` clean.
6. Committed exactly one commit touching only `internal/ingest/`.

## Files

- Created: `C:\Users\kasel\source\repos\etherfi\Solvent\internal\ingest\walker.go`
- Created: `C:\Users\kasel\source\repos\etherfi\Solvent\internal\ingest\walker_test.go`

## TDD Evidence

### RED — command

```
export PATH="$PATH:/c/Program Files/Go/bin" && go test ./internal/ingest/
```

### RED — output

```
# github.com/kaselunt/solvent/internal/ingest [github.com/kaselunt/solvent/internal/ingest.test]
internal\ingest\walker_test.go:59:16: undefined: Chain
internal\ingest\walker_test.go:59:26: undefined: Store
internal\ingest\walker_test.go:59:34: undefined: Walker
internal\ingest\walker_test.go:60:9: undefined: NewWalker
internal\ingest\walker_test.go:60:27: undefined: WalkerConfig
FAIL	github.com/kaselunt/solvent/internal/ingest [build failed]
FAIL
```

This matches the brief's expected failure exactly (`undefined: Chain`, `undefined: NewWalker`).

### GREEN — command

```
export PATH="$PATH:/c/Program Files/Go/bin" && go test ./internal/ingest/ -v
```

### GREEN — output

```
=== RUN   TestFreshWalkStartsAtStartBlockAndCapsAtWindow
--- PASS: TestFreshWalkStartsAtStartBlockAndCapsAtWindow (0.00s)
=== RUN   TestWalkCapsAtSafeHead
--- PASS: TestWalkCapsAtSafeHead (0.00s)
=== RUN   TestNoAdvanceWhenCaughtUp
--- PASS: TestNoAdvanceWhenCaughtUp (0.00s)
=== RUN   TestReorgDetectedRewindsTwiceConfirmations
2026/07/21 19:38:47 WARN reorg detected, rewinding stream=op:test from=200 to=190
--- PASS: TestReorgDetectedRewindsTwiceConfirmations (0.00s)
=== RUN   TestRewindNeverGoesBelowStartBlock
2026/07/21 19:38:47 WARN reorg detected, rewinding stream=op:test from=105 to=100
--- PASS: TestRewindNeverGoesBelowStartBlock (0.00s)
=== RUN   TestLogsAreConvertedAndSaved
--- PASS: TestLogsAreConvertedAndSaved (0.00s)
PASS
ok  	github.com/kaselunt/solvent/internal/ingest	0.531s
```

All 6 tests PASS. The two `WARN reorg detected, rewinding` lines are expected `slog.Warn` output emitted by the walker's own reorg-detection code path (transcribed directly from the brief) during the two reorg tests — not test failures or noise; they confirm the rewind branch executed as intended.

## Quality Gate (scoped to internal/ingest/)

```
$ gofmt -l internal/ingest/
(no output — clean)

$ go vet ./internal/ingest/
(no output — clean)

$ go test ./internal/ingest/ -v
PASS — 6/6 (see GREEN output above)
```

Note: the full-repo gate (`go vet ./...`, `go test ./...`) was intentionally NOT run — the task instructions restrict this agent to `internal/ingest/`-scoped commands only, since `internal/store` is being modified concurrently by another agent and `go.mod`/`go.sum` are mid-flight (already modified in the working tree, not committed by this task).

## Self-Review: Boundary Arithmetic Verification

Walked through `internal/ingest/walker.go` line by line against each invariant:

1. **Fresh walk starts at StartBlock, window of W covers `[next, next+W-1]`, capped at safe head (`head - Confirmations`).**
   - `cur == nil` → `next = w.cfg.StartBlock`.
   - `to := next + w.cfg.Window - 1`; then `if to > safe { to = safe }`.
   - Verified against `TestFreshWalkStartsAtStartBlockAndCapsAtWindow` (100+50-1=149, safe=995, 149<995 → cursor lands at 149) and `TestWalkCapsAtSafeHead` (149 > safe=125 → capped to 125).

2. **Caught-up (`next > safe`) returns `advanced=false`.**
   - `if next > safe { return false, nil }` immediately after computing `next` in the non-reorg path.
   - Verified against `TestNoAdvanceWhenCaughtUp` (next=126 > safe=125 → false, nil, no rewind touched).

3. **Hash mismatch at cursor → rewind to `max(StartBlock, cursor-2×Confirmations)` → returns `advanced=true` WITHOUT ingesting in the same Step.**
   - `target := w.cfg.StartBlock`; `back := cur.Block - min(cur.Block, 2*w.cfg.Confirmations)`; `if back > target { target = back }`.
   - This is exactly `max(StartBlock, cur.Block - 2*Confirmations)` with underflow-safety via `min(cur.Block, 2*Confirmations)`.
   - After `store.Rewind(...)` succeeds, the function does `return true, nil` immediately — it never falls through to the `Logs`/`SaveBatch` ingestion code in the same `Step` call.
   - Verified against `TestReorgDetectedRewindsTwiceConfirmations` (200 - 10 = 190 > StartBlock(100) → target=190) and `TestRewindNeverGoesBelowStartBlock` (105 - 10 = 95 < StartBlock(100) → target stays 100).

4. **Rewind target hash fetched from chain BEFORE calling `store.Rewind`.**
   - Code order: `targetHash, err := w.chain.HeaderHash(ctx, target)` executes and is checked for error, THEN `w.store.Rewind(ctx, ..., target, targetHash.Bytes())` is called using that already-fetched hash. Confirmed by reading the source top-to-bottom — no reordering possible since `targetHash` is a required argument to `Rewind`.

5. **log→RawLog conversion preserves `BlockNumber`/`LogIndex`/`TxHash`/`BlockHash`/`Address`/`Topics`/`Data`.**
   - `raw[i] = store.RawLog{ ChainID: w.cfg.ChainID, BlockNumber: l.BlockNumber, BlockHash: l.BlockHash.Bytes(), TxHash: l.TxHash.Bytes(), LogIndex: uint32(l.Index), Address: l.Address.Bytes(), Topics: topics, Data: l.Data }` where `topics[j] = t.Bytes()` for each `common.Hash` topic.
   - Verified against `TestLogsAreConvertedAndSaved`: input log at height 110, `Index: 3`, `TxHash: 0x0c` → output `got.BlockNumber == 110`, `got.LogIndex == uint32(3)`, `got.TxHash == common.HexToHash("0x0c").Bytes()`. All three explicit assertions pass; `BlockHash`, `Address`, `Topics`, `Data` are populated by the same unconditional field-by-field conversion (no branching), so they carry through identically.

All five invariants hold as implemented; no deviations from the brief were needed.

## Commit

```
commit 99479d8af134e083a3829f1c7410d31f4e3b07a6
Author: Kase Lunt <klunt@edwisegroup.com>

    feat: reorg-safe log window walker with cursor rewind

 internal/ingest/walker.go      | 128 +++++++++++++++++++++++++++++++++++
 internal/ingest/walker_test.go | 149 +++++++++++++++++++++++++++++++++++++++++
 2 files changed, 277 insertions(+)
```

Only `internal/ingest/` files were staged and committed. `go.mod`/`go.sum` remain modified-but-uncommitted in the working tree (owned by the concurrent `internal/store` task) and were deliberately left untouched.

## Concerns

None. All 6 tests pass, gofmt/vet clean on the package, single scoped commit as required.

## Upgrade pass (verified-ancestor rewind + coherent windows)

Adversarial-review remediation of the two accepted critical findings in the reorg-safety core.

### Finding 1 — Deep-fork masking (fixed by verified-ancestor rewind)

**Problem.** On cursor-hash mismatch the old walker rewound a fixed distance (`2*Confirmations`, clamped to `StartBlock`) and anchored the cursor to the LIVE chain hash at the target. A fork deeper than that distance was therefore never detected again: the cursor now matched the live chain by construction, and every stale stored row below the target was silently blessed as canonical.

**Fix.** `internal/ingest/walker.go` now walks stored logs downward from the mismatched cursor (`rewindToVerifiedAncestor`), using the new additive store query `HighestLogAtOrBelow` (`internal/store/store.go`), and only stops at a block whose STORED hash equals the LIVE header hash. Forks are suffixes: one stored log matching the live chain proves every stored row at or below it is canonical; rows between the verified ancestor and the deleted range cannot exist because the ancestor was the highest stored log at or below the probe. If nothing verifiable remains (no stored logs below, or mismatches all the way down to `StartBlock`/genesis), the walker rewinds to `StartBlock-1` (or 0 when `StartBlock==0`) for a full re-walk. The loop strictly decreases and is bounded by `StartBlock`; deep forks cost extra header fetches only when they actually occur. The rewind target hash is the verified STORED hash (not a fresh live fetch) in the proven case, so the cursor stays anchored to data actually held.

### Finding 2 — Mid-Step reorg race (fixed by coherent-window ingest)

**Problem.** The old call order `HeaderHash(cur) -> Logs -> HeaderHash(to) -> SaveBatch` let a reorg landing between those calls persist a mixed-fork batch whose cursor hash then matched the post-reorg chain — self-masking.

**Fix.** New Step ordering: (1) cursor check (still ahead of the caught-up return); (2) overflow-safe window computation (`to := safe; if delta := safe-next; delta > Window-1 { to = next+Window-1 }` — no `next+Window-1` overflow); (3) `tipBefore := HeaderHash(to)`; (4) `Logs`; (5) `tipAfter := HeaderHash(to)` — mismatch aborts the window with `(false, nil)`; (6) cursor-ancestor re-check — mismatch aborts with `(false, nil)` and lets the next Step's verified-ancestor rewind handle it; (7) strict pre-conversion validation (Removed logs, out-of-window block numbers, addresses outside the configured set — each is an error, nothing saved); (8) conversion with deep-copied `Data`; (9) `SaveBatch(..., to, tipBefore)` — the cursor anchors to the hash observed on BOTH sides of the fetch. The residual TOCTOU (fork between step 6 and SaveBatch) and the trust assumptions (sticky-active endpoint affinity documented not enforced; successful-but-incomplete getLogs trusted) are stated in the Step doc comment.

### TDD evidence

- Store: wrote `TestHighestLogAtOrBelow` first -> `go test ./internal/store/ -run TestHighestLogAtOrBelow` failed red (`s.HighestLogAtOrBelow undefined ... [build failed]`) -> implemented the method -> green.
- Walker: rewrote `walker_test.go` (scriptable `headerSeq` per-call header overrides, `highestLogs` fake data, recorded rewind args, `saveErr` injection) -> red against the old walker (e.g. `TestRejectsForeignAddressLog: An error is expected but got nil`) -> implemented the new walker -> green.

New/adapted walker tests, each pinning a named invariant: `TestCaughtUpWithMismatchStillRewinds` (reorg check not skippable by the caught-up return), `TestDeepForkWalksBackToVerifiedAncestor` (stored 150 and 180, live disagrees at 180, agrees at 150 -> `Rewind(150, storedHash150)`), `TestForkBeyondAllStoredLogsRewindsToStartBlock` (-> `Rewind(99, liveHash99)`), `TestTipChangedMidStepAborts`, `TestCursorRecheckMismatchAborts`, `TestRejectsRemovedLog` / `TestRejectsOutOfRangeLog` / `TestRejectsForeignAddressLog`, `TestHeadBelowConfirmationsNoAdvance`, `TestSaveBatchErrorPropagates`. The two old fixed-distance rewind tests were superseded by the ancestor-verified variants above; all four pre-existing happy-path tests kept passing unchanged in behavior.

### Verification

```
gofmt -l internal/ingest/ internal/store/          -> (empty)
go vet ./internal/ingest/ ./internal/store/        -> clean
go test ./internal/ingest/ ./internal/store/ -v    -> 14 + 6 tests, ALL PASS (store against live db)
go test ./...                                      -> ok: chain, config, ingest, store (cmd/indexer: no test files)
```

### Commits

```
2b8fdf4 feat: HighestLogAtOrBelow for verified-ancestor rewind   (internal/store/store.go, store_test.go; +69)
603a880 feat: verified-ancestor rewind and coherent-window ingest (internal/ingest/walker.go, walker_test.go; +373 -56)
```

`go.mod`/`go.sum` remain modified-but-uncommitted, deliberately untouched as before.

### Concerns

None blocking. Residual TOCTOU and RPC trust assumptions are documented in code as accepted by the review; the verified-ancestor loop issues one `HeaderHash` per distinct stored-log height walked, which is O(fork depth in stored blocks) — acceptable since deep forks are rare and the loop is bounded by `StartBlock`.

## Hardening pass (round-2 adversarial findings)

Completed 2026-07-21. Two commits: `ba087be` (config), `bfca9bd` (walker).

### 1. Overflow-safe caught-up check (walker.go)

**What.** Reordered the caught-up return (`cur.Block >= safe`) BEFORE `next = cur.Block + 1`, with a comment on the invariant.
**Why.** A cursor at `MaxUint64` would wrap `next` to 0 and silently restart the walk from genesis; the caught-up check now fires before the increment can wrap. Pinned by `TestCursorAtMaxUint64DoesNotWrap` (cursor at MaxUint64 with matching hash -> `(false, nil)`, nothing saved, no rewind).

### 2. Batch fork-consistency validation (walker.go)

**What.** The pre-conversion validation loop now also enforces, per batch (any violation aborts the whole batch — nothing saved):
- **One hash per height** — `hashAt: map[uint64][]byte` built while iterating; a second log at the same `BlockNumber` with a different `BlockHash` -> `"mixed block hashes at height %d — fork-inconsistent getLogs response"`.
- **Tip anchoring** — any log with `BlockNumber == to` must carry `BlockHash == tipBefore` -> `"log at window tip does not match anchored tip hash"` otherwise. Closes the gap where the cursor anchors to `tipBefore` but a tip log rode in on a different fork.
- **Duplicate identity keyed (TxHash, Index)** — byte-identical duplicate (reflect.DeepEqual) is coalesced silently (one copy saved); same identity with ANY differing field -> `"conflicting duplicate log %x/%d"`. Previously a conflicting duplicate would be silently dropped by the store's `ON CONFLICT DO NOTHING`, keeping whichever arrived first.
- **Index range guard** — `l.Index > math.MaxInt32` -> error before the `uint32(l.Index)` narrowing (store column is `INT`, written as `int32(l.LogIndex)`).

**Why.** All four are batch-coherence properties the store cannot check row-by-row; the walker is the last point where the whole getLogs response is visible at once.

### 3. StartBlock=0 rejection (config.go)

**What.** Stream validation now rejects `startBlock: 0` with `stream %q: startBlock must be > 0 (genesis-start streams unsupported)`. Fixture `internal/config/testdata/zero_start.json` + `TestLoadFailsOnZeroStartBlock`.
**Why.** The walker's full-rewalk target is `StartBlock-1`; a genesis-start stream makes that target ambiguous (the degenerate `StartBlock==0` branch in `fullRewalk` remains as defense in depth but is now unreachable via config).

### 4. Ancestor-walk accept comment (walker.go)

**What.** Comment on the verified-match accept branch: a stored==live hash match is accepted even below this stream's StartBlock — a hash match is chain-canonical proof; clamping the target up to an unverified height would anchor sibling cursors to unverified (possibly post-fork) hashes; the cost of a deep verified target is a bounded sibling re-walk, not corruption. Pinned by `TestVerifiedMatchBelowStartBlockAccepted` (stored log at 50, StartBlock 100, live agrees -> `Rewind(50, storedHash)`).

### New tests (walker_test.go)

`TestRejectsMixedHashesAtSameHeight`, `TestRejectsTipLogNotMatchingAnchor`, `TestCoalescesIdenticalDuplicateLogs`, `TestRejectsConflictingDuplicateLogs`, `TestRejectsOversizedLogIndex`, `TestCursorAtMaxUint64DoesNotWrap`, `TestVerifiedMatchBelowStartBlockAccepted` — each with a one-line invariant comment, all on the existing fake pattern.

### Verification

```
gofmt -l internal/   -> (empty)
go vet ./...         -> clean
go test ./... -count=1 -> ok: chain (3), config (4), ingest (21), store (6, live db); cmd/indexer no test files
```

### Commits

```
ba087be fix: reject genesis-start streams in config validation                  (config.go, config_test.go, testdata/zero_start.json; +28)
bfca9bd fix: batch fork-consistency validation and overflow-safe caught-up check (walker.go, walker_test.go; +179 -2)
```

### Concerns

None blocking. `reflect.DeepEqual` for duplicate comparison is deliberately field-exhaustive (future geth Log fields are covered automatically); the per-batch `hashAt`/`seen` maps are O(batch size). Cross-batch duplicate handling still relies on the store's idempotent `ON CONFLICT DO NOTHING` — conflicting duplicates are only detectable within a single response, noted as inherent to the RPC model in the Step doc comment.
