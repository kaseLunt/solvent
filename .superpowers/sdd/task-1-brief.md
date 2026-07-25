### Task 1: Config hygiene (deferred Phase 1 items)

**Files:**
- Modify: `internal/config/config.go`
- Modify: `internal/config/config_test.go`
- Create: `internal/config/testdata/empty_name.json`, `internal/config/testdata/bad_engine.json`, `internal/config/testdata/bad_address.json`, `internal/config/testdata/zero_window.json`

**Interfaces:**
- Consumes: existing `config.Load` and fixtures.
- Produces: unchanged public API; new validation: engine vocabulary + trimmed URLs. Engine vocabulary constant `config.KnownEngines = map[string]bool{"debt_manager": true, "aave_v3_etherfi": true, "chainlink_feed": true}` (exported — Task 8 adds streams with `chainlink_feed`).

- [ ] **Step 1: Write the failing tests** (append to `config_test.go`)

```go
func TestLoadTrimsWhitespaceInRPCURLs(t *testing.T) {
	t.Setenv("SOLVENT_RPC_OP", " https://a.example , https://b.example ")
	t.Setenv("SOLVENT_DATABASE_URL", "postgres://x")
	cfg, err := Load("testdata/contracts.json")
	require.NoError(t, err)
	require.Equal(t, []string{"https://a.example", "https://b.example"}, cfg.Chains["op"].RPCURLs)
}

func TestLoadFailsOnEmptyStreamName(t *testing.T) {
	t.Setenv("SOLVENT_RPC_OP", "https://a.example")
	t.Setenv("SOLVENT_DATABASE_URL", "postgres://x")
	_, err := Load("testdata/empty_name.json")
	require.ErrorContains(t, err, "name must not be empty")
}

func TestLoadFailsOnUnknownEngine(t *testing.T) {
	t.Setenv("SOLVENT_RPC_OP", "https://a.example")
	t.Setenv("SOLVENT_DATABASE_URL", "postgres://x")
	_, err := Load("testdata/bad_engine.json")
	require.ErrorContains(t, err, "unknown engine")
}

func TestLoadFailsOnInvalidAddress(t *testing.T) {
	t.Setenv("SOLVENT_RPC_OP", "https://a.example")
	t.Setenv("SOLVENT_DATABASE_URL", "postgres://x")
	_, err := Load("testdata/bad_address.json")
	require.ErrorContains(t, err, "invalid address")
}

func TestLoadFailsOnZeroWindow(t *testing.T) {
	t.Setenv("SOLVENT_RPC_OP", "https://a.example")
	t.Setenv("SOLVENT_DATABASE_URL", "postgres://x")
	_, err := Load("testdata/zero_window.json")
	require.ErrorContains(t, err, "window and confirmations")
}

func TestProductionContractsJSONParses(t *testing.T) {
	t.Setenv("SOLVENT_RPC_OP", "https://a.example")
	t.Setenv("SOLVENT_RPC_ETH", "https://b.example")
	t.Setenv("SOLVENT_DATABASE_URL", "postgres://x")
	cfg, err := Load("../../config/contracts.json")
	require.NoError(t, err)
	require.NotEmpty(t, cfg.Streams)
}
```
Fixtures: each a copy of `testdata/contracts.json` with exactly one mutation — `empty_name.json`: `"name": ""`; `bad_engine.json`: `"engine": "compound_v3"`; `bad_address.json`: `"addresses": ["0xNOTANADDRESS"]`; `zero_window.json`: `"window": 0`.

- [ ] **Step 2: Run to verify failures**

Run: `go test ./internal/config/ -run 'TestLoadTrims|TestLoadFailsOnEmptyStreamName|TestLoadFailsOnUnknownEngine|TestProductionContracts' -v`
Expected: FAIL — trim test (whitespace preserved), empty-name + unknown-engine (no such validation yet), production-parse (passes already or fails — record which; invalid-address and zero-window tests should PASS already, they pin existing behavior).

- [ ] **Step 3: Implement** — in `config.Load`: add `KnownEngines` package var as specified above; in the chain loop wrap each split URL with `strings.TrimSpace` (skip empties after trim, error if none survive: `"rpc env %s (chain %q) contains no urls"`); in the stream loop add, before the existing checks: `if fs.Name == "" { return nil, fmt.Errorf("stream name must not be empty") }` and `if !KnownEngines[fs.Engine] { return nil, fmt.Errorf("stream %q: unknown engine %q", fs.Name, fs.Engine) }`.

- [ ] **Step 4: Run full package**

Run: `go test ./internal/config/ -v`
Expected: all PASS (prior 6 + new 6).

- [ ] **Step 5: Commit**

```bash
git add internal/config/
git commit -m "fix: trim RPC urls; validate engine vocabulary, stream names; pin production config parse"
```

---

