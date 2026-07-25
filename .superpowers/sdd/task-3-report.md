# Task 3 Report: Internal Config Loader Implementation

## Status: DONE

**Commit:** `732182f` — feat: typed config loader for chains and ingest streams

## Task Summary

Implemented a typed configuration loader for Solvent that:
- Parses `contracts.json` fixture with chains and ingest streams metadata
- Resolves RPC URLs and database configuration from environment variables
- Validates references (chain refs, addresses, required fields)
- Provides `Config`, `Chain`, and `Stream` types used downstream by Task 7

## Files Created

- `internal/config/config.go` — Main implementation with `Load(path string) (*Config, error)` function
- `internal/config/config_test.go` — Test suite (3 test cases)
- `internal/config/testdata/contracts.json` — Valid fixture
- `internal/config/testdata/bad_chain_ref.json` — Invalid fixture for error testing

## TDD Evidence

### RED Phase: Failing Tests

**Command:**
```bash
export PATH="$PATH:/c/Program Files/Go/bin" && go test ./internal/config/ 2>&1
```

**Output (undefined Load):**
```
# github.com/kaselunt/solvent/internal/config [github.com/kaselunt/solvent/internal/config.test]
internal\config\config_test.go:15:14: undefined: Load
internal\config\config_test.go:31:12: undefined: Load
internal\config\config_test.go:38:12: undefined: Load
FAIL	github.com/kaselunt/solvent/internal/config [build failed]
FAIL
```

### GREEN Phase: Passing Tests

**Command:**
```bash
export PATH="$PATH:/c/Program Files/Go/bin" && go test ./internal/config/ -v 2>&1
```

**Output (3 PASS):**
```
=== RUN   TestLoadValidConfig
--- PASS: TestLoadValidConfig (0.01s)
=== RUN   TestLoadFailsWhenRPCEnvMissing
--- PASS: TestLoadFailsWhenRPCEnvMissing (0.00s)
=== RUN   TestLoadFailsOnUnknownChainRef
--- PASS: TestLoadFailsOnUnknownChainRef (0.01s)
PASS
ok  	github.com/kaselunt/solvent/internal/config	0.560s
```

## Quality Gates: PASSED

**gofmt check:**
```bash
export PATH="$PATH:/c/Program Files/Go/bin" && gofmt -l internal/config/
```
Result: No output (all files properly formatted)

**go vet check:**
```bash
export PATH="$PATH:/c/Program Files/Go/bin" && go vet ./internal/config/
```
Result: No output (all checks passed)

**Test execution (detailed):**
```bash
export PATH="$PATH:/c/Program Files/Go/bin" && go test ./internal/config/ -v
```
Result: All 3 tests PASS

## Implementation Details

### Config Type
```go
type Config struct {
    DatabaseURL  string
    PollInterval time.Duration
    Chains       map[string]Chain
    Streams      []Stream
}
```

### Chain Type
```go
type Chain struct {
    ChainID uint64
    RPCURLs []string
}
```

### Stream Type
```go
type Stream struct {
    Name          string
    Chain         string
    Engine        string
    Addresses     []common.Address
    StartBlock    uint64
    Window        uint64
    Confirmations uint64
}
```

### Load() Function Behavior
1. Reads and parses JSON config file
2. Validates `SOLVENT_DATABASE_URL` env var (required, no default)
3. Parses `SOLVENT_POLL_INTERVAL` (optional, defaults to 5s)
4. For each chain: resolves RPC URLs from env var named in `rpcEnv` field
5. For each stream:
   - Validates chain reference exists
   - Validates window and confirmations > 0
   - Validates all addresses are valid hex
6. Returns parsed, validated Config or error

### Error Handling
- Missing env vars: "rpc env X (chain Y) is not set"
- Unknown chain refs: "stream X references unknown chain Y"
- Invalid addresses: "stream X: invalid address Y"
- Invalid durations: "SOLVENT_POLL_INTERVAL: X"
- File read errors: "read config: X"
- JSON parse errors: "parse config: X"

## Test Coverage

| Test | Purpose | Outcome |
|------|---------|---------|
| `TestLoadValidConfig` | Happy path: valid config, env vars set, addresses parse correctly | PASS |
| `TestLoadFailsWhenRPCEnvMissing` | Error path: missing required RPC env var | PASS |
| `TestLoadFailsOnUnknownChainRef` | Error path: stream references nonexistent chain | PASS |

## Fixtures

**contracts.json:**
- Chain "op" with chainId 10, rpcEnv pointing to SOLVENT_RPC_OP
- Stream "op:test" referencing chain "op" with 1 Ethereum address

**bad_chain_ref.json:**
- Identical to contracts.json except stream references nonexistent chain "arbitrum"

## Dependencies

Added to go.mod (not committed per requirements):
- `github.com/stretchr/testify v1.8.4` (testing assertions)
- `github.com/ethereum/go-ethereum v1.13.0` (common.Address type)

## Concerns: None

- Code matches brief exactly
- No extra features implemented
- All tests pass with pristine output
- Quality gates satisfied
- Commit message follows convention
- Only internal/config/ files staged and committed (go.mod/go.sum not committed)

## Summary

Task 3 complete. Typed config loader fully implemented following TDD discipline. All 3 tests pass. Code formatted, vetted, and committed.
