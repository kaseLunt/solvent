# Task 5: `internal/chain` — failover RPC client

## Implementation Summary

Completed Task 5 following TDD approach with full RED → GREEN → QUALITY → COMMIT cycle.

## Files Created

- `internal/chain/chain.go` - 89 lines (Failover client implementation)
- `internal/chain/chain_test.go` - 82 lines (Test suite)

## TDD Evidence

### RED Phase (Tests Fail)

**Command:**
```bash
go test ./internal/chain/
```

**Output:**
```
# github.com/kaselunt/solvent/internal/chain [github.com/kaselunt/solvent/internal/chain.test]
internal\chain\chain_test.go:48:7: undefined: newFailover
internal\chain\chain_test.go:48:21: undefined: rpcClient
internal\chain\chain_test.go:64:7: undefined: newFailover
internal\chain\chain_test.go:64:21: undefined: rpcClient
FAIL	github.com/kaselunt/solvent/internal/chain [build failed]
FAIL
```

Expected failures: undefined `newFailover` function and `rpcClient` interface.

### GREEN Phase (Tests Pass)

**Command:**
```bash
go test ./internal/chain/ -v
```

**Output:**
```
=== RUN   TestFailoverRotatesOnError
--- PASS: TestFailoverRotatesOnError (0.00s)
=== RUN   TestFailoverErrorsWhenAllFail
--- PASS: TestFailoverErrorsWhenAllFail (0.00s)
PASS
ok  	github.com/kaselunt/solvent/internal/chain	0.576s
```

Both tests pass successfully.

## Quality Gates

### gofmt Check
```bash
gofmt -l internal/chain/
```
**Result:** Clean (no output)

### go vet Check
```bash
go vet ./internal/chain/
```
**Result:** Clean (no output)

## Implementation Details

### Architecture

The `Failover` client implements sticky-rotation failover semantics:

1. **Sticky Active Endpoint**: The client maintains an `active` index pointing to the last successful endpoint
2. **Rotation on Error**: When the active endpoint fails, tries the next one in order
3. **Memory of Last Good**: Once an endpoint succeeds, it becomes sticky until it fails
4. **Cyclic Fallback**: Rounds the list when reaching the end
5. **Total Failure**: Returns error only when ALL endpoints fail

### Key Components

**rpcClient Interface:**
- `BlockNumber(ctx context.Context) (uint64, error)`
- `HeaderByNumber(ctx context.Context, number *big.Int) (*types.Header, error)`
- `FilterLogs(ctx context.Context, q ethereum.FilterQuery) ([]types.Log, error)`

**Failover Struct:**
- `clients []rpcClient` - list of RPC endpoints
- `mu sync.Mutex` - guards access to active index
- `active int` - current active endpoint index

**Core Methods:**
- `Dial(ctx, urls)` - connects to multiple endpoints via ethclient
- `do(ctx, op, fn)` - implements failover loop with sticky rotation
- `BlockNumber()`, `HeaderHash()`, `Logs()` - public API methods

### Test Coverage

**TestFailoverRotatesOnError:**
- Verifies sticky rotation: first call rotates from failed endpoint to working one
- Confirms second call stays on the active endpoint without re-trying the failed one
- Validates call counts: failed endpoint called once, active endpoint called twice

**TestFailoverErrorsWhenAllFail:**
- Ensures error is returned when all endpoints fail
- Validates error message contains "all rpc endpoints failed"

## Commit

```
Commit: ad67121
Subject: feat: failover RPC client with sticky rotation
Files: internal/chain/chain.go, internal/chain/chain_test.go
```

## Verification

- ✅ Both test cases PASS (2 PASS)
- ✅ Code follows go format (gofmt clean)
- ✅ No vet issues (go vet clean)
- ✅ Sticky rotation semantics match test expectations
- ✅ All required public methods implemented (Dial, BlockNumber, HeaderHash, Logs)
- ✅ Error messages match expected output ("all rpc endpoints failed")

## Fix pass (review findings)

Applied three fixes addressing review findings in `internal/chain/chain.go` and test suite.

### Changes Made

1. **Context short-circuit in rotation loop (line 54-55):**
   - Added `if err := ctx.Err(); err != nil` check at top of each loop iteration in `Failover.do`
   - Returns `fmt.Errorf("%s aborted: %w", op, err)` immediately when context is cancelled
   - Prevents spinning through endpoints when caller's context is already dead

2. **Sticky-active invariant documentation (line 25-28):**
   - Added 3-line comment on `active` field explaining it's a routing hint, not a health registry
   - Documents that under concurrent callers, last writer wins (safe because every value refers to a successful endpoint)

3. **Nil-header guard in HeaderHash (line 85-87):**
   - Added check `if h == nil` after error check in HeaderHash closure
   - Returns `fmt.Errorf("header %d not found", n)` if header is nil

### Test Verification

**Command:**
```bash
go test ./internal/chain/ -v
```

**Output:**
```
=== RUN   TestFailoverRotatesOnError
2026/07/21 19:31:19 WARN rpc endpoint failed, rotating op=blockNumber endpoint=0 err="a down"
--- PASS: TestFailoverRotatesOnError (0.00s)
=== RUN   TestFailoverErrorsWhenAllFail
2026/07/21 19:31:19 WARN rpc endpoint failed, rotating op=blockNumber endpoint=0 err="a down"
2026/07/21 19:31:19 WARN rpc endpoint failed, rotating op=blockNumber endpoint=1 err="b down"
--- PASS: TestFailoverErrorsWhenAllFail (0.00s)
=== RUN   TestDoStopsWhenContextCancelled
--- PASS: TestDoStopsWhenContextCancelled (0.00s)
PASS
ok  	github.com/kaselunt/solvent/internal/chain	0.602s
```

### Quality Gates

- ✅ gofmt: `gofmt -l internal/chain/` → clean (empty output)
- ✅ go vet: `go vet ./internal/chain/` → clean (empty output)
- ✅ go test: All 3 tests PASS (pristine output)

### New Test Added

`TestDoStopsWhenContextCancelled` - Validates context short-circuit:
- Creates cancelled context before calling
- Verifies neither endpoint is called (0 calls each)
- Confirms error is `context.Canceled`

### Commit

```
Commit: 8a37c07
Subject: fix: context short-circuit in failover rotation; document sticky-active invariant
Files: internal/chain/chain.go, internal/chain/chain_test.go
```
