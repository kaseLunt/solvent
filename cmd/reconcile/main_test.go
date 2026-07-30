// Orchestration-decision tests (brief §10): flag validation, acceptance
// taints, the tolerance-laundering guard (mutation: tolerance arms), the
// prune-immune rewind re-check (mutation target 10), the DSN tripwire
// decision (mutation: tripwire), and the multicall in-band block assertion.
package main

import (
	"bytes"
	"context"
	"flag"
	"fmt"
	"math/big"
	"strings"
	"testing"
	"time"

	"github.com/ethereum/go-ethereum/common"
	"github.com/stretchr/testify/require"

	"github.com/kaselunt/solvent/cmd/reconcile/snapshotdb"
	"github.com/kaselunt/solvent/internal/store"
)

func TestParseFlagsValidation(t *testing.T) {
	var errBuf bytes.Buffer
	o, err := parseFlags([]string{}, &errBuf)
	require.NoError(t, err)
	require.Equal(t, "all", o.engine)
	require.Equal(t, 25, o.sample)
	require.EqualValues(t, 25584990, o.goldenPinETH)
	require.EqualValues(t, 25593800, o.fixturePinETH)
	require.Equal(t, 1.5, o.rps)
	require.Equal(t, 5, o.rpcAttempts)
	require.Equal(t, 3, o.collateralReplay)

	_, err = parseFlags([]string{"-engine", "bogus"}, &errBuf)
	require.Error(t, err)
	_, err = parseFlags([]string{"-sample", "10"}, &errBuf)
	require.Error(t, err, "below the 25 floor without -allow-small")
	o, err = parseFlags([]string{"-sample", "10", "-allow-small"}, &errBuf)
	require.NoError(t, err)
	require.True(t, o.allowSmall)
}

func TestAcceptanceTaints(t *testing.T) {
	// acceptanceTaints judges the ENV surface too since round-13 F1; pin it
	// to the canonical (unset) state so this test asserts the FLAG surface
	// hermetically whatever the ambient environment carries.
	t.Setenv("SOLVENT_SNAPSHOT_INTERVAL", "")
	var errBuf bytes.Buffer
	o, err := parseFlags([]string{}, &errBuf)
	require.NoError(t, err)
	require.Empty(t, acceptanceTaints(o), "a default invocation is acceptance-clean")

	o, err = parseFlags([]string{"-sample", "5", "-allow-small", "-golden-pin-eth", "123", "-engine", "debt_manager", "-tolerance-dm-wei", "1"}, &errBuf)
	require.NoError(t, err)
	taints := acceptanceTaints(o)
	require.Len(t, taints, 4)
	joined := strings.Join(taints, "\n")
	require.Contains(t, joined, "-sample 5")
	require.Contains(t, joined, "-golden-pin-eth overridden")
	require.Contains(t, joined, "-engine debt_manager")
	require.Contains(t, joined, "-tolerance-dm-wei")

	// Round-10 F2: the bypass flags Codex named — disabling deep replay,
	// disabling the head-lag gate, and ordinary pin overrides — ALL taint.
	o, err = parseFlags([]string{"-collateral-replay", "0", "-max-head-lag", "0", "-pin-op", "154000000", "-pin-eth", "23000000"}, &errBuf)
	require.NoError(t, err)
	taints = acceptanceTaints(o)
	require.Len(t, taints, 4)
	joined = strings.Join(taints, "\n")
	require.Contains(t, joined, "-collateral-replay 0 disables")
	require.Contains(t, joined, "-max-head-lag")
	require.Contains(t, joined, "-pin-op overridden")
	require.Contains(t, joined, "-pin-eth overridden")
}

// TestFlagSurfaceClosed — round-11 F1: the taint GENERATOR is closed over
// the ENTIRE flag surface. Every flag registered in reconFlagSet must be
// classified here as exactly one of (a) mustTaint — a real argv whose
// value weakens a required acceptance bound is parsed through the REAL
// pipeline (parseFlags → acceptanceTaints → computeResult) and must yield
// a non-pass verdict naming the flag — or (b) verdictFree — justified
// below as unable to reach the verdict at all. An unclassified flag fails
// the test, so the surface cannot silently grow an unexamined override;
// dropping a flag's branch from acceptanceTaints fails its mustTaint case
// (mutation W13M1).
func TestFlagSurfaceClosed(t *testing.T) {
	// Env surface pinned canonical (round-13 F1): this test is about the
	// FLAG surface; the env twin is TestEnvSurfaceClosed.
	t.Setenv("SOLVENT_SNAPSHOT_INTERVAL", "")
	type taintCase struct {
		args     []string
		nameHint string // the taint text must name the weakened flag
	}
	mustTaint := map[string]taintCase{
		"config":            {args: []string{"-config", "testdata/other.json"}, nameHint: "-config"},
		"engine":            {args: []string{"-engine", "debt_manager"}, nameHint: "-engine"},
		"sample":            {args: []string{"-sample", "5", "-allow-small"}, nameHint: "-sample"},
		"allow-small":       {args: []string{"-allow-small", "-sample", "1"}, nameHint: "-sample"}, // weakens only jointly with -sample; the joint form taints
		"seed":              {args: []string{"-seed", "operator-chosen"}, nameHint: "-seed"},
		"accounts":          {args: []string{"-accounts", "picked.txt"}, nameHint: "-accounts"},
		"pin-op":            {args: []string{"-pin-op", "1"}, nameHint: "-pin-op"},
		"pin-eth":           {args: []string{"-pin-eth", "1"}, nameHint: "-pin-eth"},
		"golden-pin-eth":    {args: []string{"-golden-pin-eth", "1"}, nameHint: "-golden-pin-eth"},
		"fixture-pin-eth":   {args: []string{"-fixture-pin-eth", "1"}, nameHint: "-fixture-pin-eth"},
		"snapshot-max-age":  {args: []string{"-snapshot-max-age", "2562047h"}, nameHint: "-snapshot-max-age"},
		"tolerance-dm-wei":  {args: []string{"-tolerance-dm-wei", "1"}, nameHint: "-tolerance-dm-wei"},
		"collateral-replay": {args: []string{"-collateral-replay", "1"}, nameHint: "-collateral-replay"},
		"max-head-lag":      {args: []string{"-max-head-lag", "2562047h"}, nameHint: "-max-head-lag"},
		"p3-gates":          {args: []string{"-p3-gates=false"}, nameHint: "-p3-gates"},
		"dm-full-census":    {args: []string{"-dm-full-census=false"}, nameHint: "-dm-full-census"},
	}
	// verdictFree flags CANNOT weaken a required bound; each carries its
	// justification (the report's flag-surface table mirrors this map).
	verdictFree := map[string]string{
		"include":        "additive-only: forced includes are appended ON TOP of quota (selectSample pass 3) — they add gated rows, never displace seed-selected ones",
		"rps":            "pacing only: no verdict bound consumes it; a stall ends in a loud abort (timeout/exit 3), never a pass",
		"rpc-attempts":   "bounded-retry budget: <=0 is coerced to the default (newRPCRunner), exhaustion is a classified loud abort, and retrying more cannot change a hash-pinned answer",
		"out":            "artifact destination only: a failed write is a loud abort, never a pass",
		"timeout":        "whole-run deadline: expiry aborts loudly, and waiting longer only makes the wall-clock staleness gates STRICTER",
		"preflight-only": "exits after Phase 0 with no artifact and no verdict — there is no receipt to launder",
	}

	var errBuf bytes.Buffer
	fs := reconFlagSet(&options{}, &errBuf)
	fs.VisitAll(func(f *flag.Flag) {
		_, taints := mustTaint[f.Name]
		_, free := verdictFree[f.Name]
		require.True(t, taints || free,
			"flag -%s is registered but UNCLASSIFIED — close the taint generator over it before shipping (round-11 F1)", f.Name)
		require.False(t, taints && free, "flag -%s is classified twice", f.Name)
	})
	for name := range mustTaint {
		require.NotNil(t, fs.Lookup(name), "mustTaint names -%s but reconFlagSet does not register it (stale table)", name)
	}
	for name := range verdictFree {
		require.NotNil(t, fs.Lookup(name), "verdictFree names -%s but reconFlagSet does not register it (stale table)", name)
	}

	// Every mustTaint flag: REAL argv → REAL parse → REAL generator → REAL
	// verdict. Non-pass, and the taint names its flag.
	for name, tc := range mustTaint {
		o, err := parseFlags(tc.args, &errBuf)
		require.NoError(t, err, "-%s: %v must parse", name, tc.args)
		taints := acceptanceTaints(o)
		require.NotEmpty(t, taints, "-%s: weakening value %v must taint", name, tc.args)
		require.Contains(t, strings.Join(taints, "\n"), tc.nameHint,
			"-%s: the taint must name the weakened flag", name)
		result, code := computeResult(0, o.toleranceDMWei, taints)
		require.NotEqual(t, "pass", result, "-%s: a weakened bound can never produce pass (round-11 F1)", name)
		require.NotEqual(t, exitPass, code, "-%s: a weakened bound can never produce exit 0", name)
	}

	// And the canonical default invocation stays taint-free and passes.
	o, err := parseFlags(nil, &errBuf)
	require.NoError(t, err)
	require.Empty(t, acceptanceTaints(o), "canonical defaults must not taint")
	result, code := computeResult(0, 0, acceptanceTaints(o))
	require.Equal(t, "pass", result)
	require.Equal(t, exitPass, code)
}

// TestLooseBoundsInvocationIsNonPass — round-11 F1's binding invocation,
// verbatim: `-snapshot-max-age 2562047h -max-head-lag 2562047h` used to
// parse acceptance-clean while making both required age checks vacuous for
// any realistic stale state. Both must taint, and the verdict must be
// structurally non-pass even with zero gated failures. Loose-positive is
// the same class as disabled; tighter-than-canonical stays taint-free
// because it can only strengthen.
func TestLooseBoundsInvocationIsNonPass(t *testing.T) {
	// Env surface pinned canonical (round-13 F1): the loose-bounds class
	// under test here is the FLAG spelling; the env spelling is
	// TestExtremeSnapshotIntervalEnvIsNonPass.
	t.Setenv("SOLVENT_SNAPSHOT_INTERVAL", "")
	var errBuf bytes.Buffer
	o, err := parseFlags([]string{"-snapshot-max-age", "2562047h", "-max-head-lag", "2562047h"}, &errBuf)
	require.NoError(t, err)
	taints := acceptanceTaints(o)
	joined := strings.Join(taints, "\n")
	require.Contains(t, joined, "-snapshot-max-age", "the freshness-bound override must taint")
	require.Contains(t, joined, "-max-head-lag", "the loose-positive head-lag override must taint")
	result, code := computeResult(0, 0, taints)
	require.Equal(t, "tainted", result, "vacuous-via-loose-bounds is the same class as vacuous-via-skip")
	require.Equal(t, exitVerdictFail, code)

	// Loose-positive alone (not disabled): still tainted.
	o, err = parseFlags([]string{"-max-head-lag", "31m"}, &errBuf)
	require.NoError(t, err)
	require.NotEmpty(t, acceptanceTaints(o), "positive-but-looser max-head-lag must taint (round 11)")

	// Tighter-than-canonical: taint-free (can only turn pass into abort).
	o, err = parseFlags([]string{"-max-head-lag", "5m"}, &errBuf)
	require.NoError(t, err)
	require.Empty(t, acceptanceTaints(o), "a TIGHTER bound weakens nothing")

	// The canonical spelling of the default value is not an override.
	o, err = parseFlags([]string{"-snapshot-max-age", "auto", "-max-head-lag", "30m"}, &errBuf)
	require.NoError(t, err)
	require.Empty(t, acceptanceTaints(o), "restating the canonical defaults must not taint")
}

// TestTaintedRunCannotPass — round-10 F2 (mutation: taint-dropped-from-
// verdict): computeResult CONSUMES the taint set, so a tainted run is
// structurally non-pass (result "tainted", exit 1) even when every gated
// row is exact. Taints as metadata can be ignored by a receipt reader; an
// exit code cannot.
func TestTaintedRunCannotPass(t *testing.T) {
	result, code := computeResult(0, 0, []string{"-collateral-replay 0 disables the deep collateral replay (a required check)"})
	require.Equal(t, "tainted", result,
		"zero gated failures + any taint is STILL not a pass — structurally")
	require.Equal(t, exitVerdictFail, code)

	// Precedence: real drift outranks the taint label (both exit 1).
	result, code = computeResult(2, 0, []string{"-engine debt_manager"})
	require.Equal(t, "fail", result)
	require.Equal(t, exitVerdictFail, code)

	// And the clean path still passes.
	result, code = computeResult(0, 0, nil)
	require.Equal(t, "pass", result)
	require.Equal(t, exitPass, code)
}

// TestNonzeroToleranceCannotProducePass — the §3.5 laundering guard
// (mutation: "tolerance arms"): ANY nonzero -tolerance-dm-wei forces
// fail-with-tolerance even when every gated row is exact, so a tolerance
// can never launder into a pass receipt.
func TestNonzeroToleranceCannotProducePass(t *testing.T) {
	result, code := computeResult(0, 0, nil)
	require.Equal(t, "pass", result)
	require.Equal(t, exitPass, code)

	result, code = computeResult(0, 1, nil)
	require.Equal(t, "fail-with-tolerance", result,
		"zero gated failures + nonzero tolerance is STILL not a pass — structurally")
	require.Equal(t, exitVerdictFail, code)

	result, code = computeResult(3, 0, nil)
	require.Equal(t, "fail", result)
	require.Equal(t, exitVerdictFail, code)

	result, code = computeResult(3, -1, nil)
	require.Equal(t, "fail-with-tolerance", result, "negative values are nonzero too")
	require.Equal(t, exitVerdictFail, code)
}

// TestRewindMovedIsPruneImmune — mutation target 10: the re-check reads
// acked_epoch, never MAX(reorg_epochs.epoch). The scenario is the §8 hole:
// a rewind+ack+prune cycle completes mid-run — MAX comes back UNCHANGED
// (the epoch row was pruned) while acked_epoch moved. A MAX-based detector
// sees nothing; the acked_epoch detector must fire.
func TestRewindMovedIsPruneImmune(t *testing.T) {
	baseline := snapshotdb.RewindBaseline{
		AckedEpoch: map[string]int64{"debt_manager": 4, "aave_v3_etherfi": 2},
		LastBlock:  map[string]uint64{"debt_manager": 1000, "aave_v3_etherfi": 500},
		MaxEpoch:   map[int64]int64{10: 4, 1: 2}, // informational — and UNCHANGED below
	}
	pins := map[string]uint64{"debt_manager": 1000, "aave_v3_etherfi": 500}
	// Current chain-max epochs, re-read at end of run (H1 recheck input):
	// quiet run — every epoch acked.
	maxEpochs := map[int64]int64{10: 4, 1: 2}

	// Quiet run: nothing moved.
	current := []store.DeriveCursorState{
		{Engine: "debt_manager", ChainID: 10, LastBlock: 1010, AckedEpoch: 4},
		{Engine: "aave_v3_etherfi", ChainID: 1, LastBlock: 500, AckedEpoch: 2},
	}
	require.Empty(t, rewindMoved(baseline, current, pins, maxEpochs))

	// The prune hole: acked_epoch bumped (RewindDerived always bumps it),
	// MAX(reorg_epochs.epoch) pruned back to the baseline value.
	current[0].AckedEpoch = 5
	current[0].LastBlock = 1010 // even ahead of the pin — the epoch alone convicts
	reasons := rewindMoved(baseline, current, pins, maxEpochs)
	require.Len(t, reasons, 1)
	require.Contains(t, reasons[0], "acked_epoch moved 4 → 5")

	// last_block below the pin is independently fatal.
	current[0].AckedEpoch = 4
	current[0].LastBlock = 900
	reasons = rewindMoved(baseline, current, pins, maxEpochs)
	require.Len(t, reasons, 1)
	require.Contains(t, reasons[0], "fell below pin")

	// The H1 hole (complement of the prune hole): a walker rewind lands
	// MID-RUN and its ack has NOT — acked_epoch UNCHANGED, last_block at the
	// pin, but the chain's current MAX epoch sits above the ack. The movement
	// leg is silent by construction; the MAX leg must convict.
	current[0].AckedEpoch = 4
	current[0].LastBlock = 1010
	reasons = rewindMoved(baseline, current, pins, map[int64]int64{10: 5, 1: 2})
	require.Len(t, reasons, 1)
	require.Contains(t, reasons[0], "unacknowledged reorg epoch 5")

	// A vanished cursor is fatal, not ignored.
	current[0].LastBlock = 900
	reasons = rewindMoved(baseline, current[:1], pins, maxEpochs)
	require.NotEmpty(t, reasons)
}

// TestDSNTripwireDetectsSameDatabase — the §1.2 decision (mutation:
// tripwire): identical PHYSICAL identities collide; a different database on
// the same cluster does not; and — the round-10 F4 point — identity is the
// (system_identifier, OID, name) tuple, so it cannot fork on host-spelling
// aliases the way the old database@addr:port string did.
func TestDSNTripwireDetectsSameDatabase(t *testing.T) {
	live := store.DBIdentity{SystemIdentifier: "7665718114346942498", DatabaseOID: 16384, DatabaseName: "solvent"}
	require.True(t, dsnCollision(live, live),
		"same database identity is THE hazard — the run must die before any test could truncate the backfill")
	require.False(t, dsnCollision(live, store.DBIdentity{SystemIdentifier: "7665718114346942498", DatabaseOID: 16401, DatabaseName: "solvent_test"}),
		"same cluster, different database — the split the wave-10 fix demands")
	require.False(t, dsnCollision(live, store.DBIdentity{SystemIdentifier: "1111111111111111111", DatabaseOID: 16384, DatabaseName: "solvent"}),
		"same name+OID on a DIFFERENT cluster is a different database")
	require.Contains(t, tripwireMsg, "physical split required", "the brief's message, verbatim")
}

func TestReadOnlyDSNInjectsSessionOption(t *testing.T) {
	out, err := readOnlyDSN("postgres://solvent:solvent@localhost:5432/solvent?sslmode=disable")
	require.NoError(t, err)
	require.Contains(t, out, "options=")
	require.Contains(t, out, "default_transaction_read_only%3Don")
	require.Contains(t, out, "sslmode=disable", "existing params survive")
	_, err = readOnlyDSN("host=localhost dbname=x")
	require.Error(t, err, "key-value DSNs are refused rather than silently un-hardened")
}

func TestDBNameClaimed(t *testing.T) {
	// Renamed from dbNameFromDSN by round-16 M1: the claim is the EFFECTIVE
	// database under pgx's own precedence, not the URL path — the override
	// cases live in TestClaimedDBFollowsPgxOverride (pgxdsn_test.go).
	require.Equal(t, "solvent", dbNameClaimed("postgres://u:p@localhost:5432/solvent?sslmode=disable"))
}

// TestSchemaGateIsExactBothDirections — mutation target "schema gate": a
// database AHEAD of the binary is as unacceptable as one behind it.
func TestSchemaGateIsExactBothDirections(t *testing.T) {
	require.True(t, schemaGateOK(8, 8))
	require.False(t, schemaGateOK(7, 8), "a lower database misses tables the queries read")
	require.False(t, schemaGateOK(9, 8), "a HIGHER database may have reshaped them — >= would accept a schema this binary never saw")
}

// TestMulticallInBandBlockAssertion (brief §5 multicall discipline): a
// chunk reporting a block ≠ P aborts with errChunkDivergence (exit 3
// semantics) — never silently accepted.
func TestMulticallInBandBlockAssertion(t *testing.T) {
	pin := uint64(154021227)
	mkChain := func(servedBlock uint64) *fakeChain {
		f := &fakeChain{hashes: map[uint64]common.Hash{pin: hashFor(pin)}}
		f.handler = func(to common.Address, data []byte, hash common.Hash) ([]byte, error) {
			require.Equal(t, multicall3Address, to)
			ret, err := multicall3ABI.Methods["tryBlockAndAggregate"].Outputs.Pack(
				new(big.Int).SetUint64(servedBlock), [32]byte{}, []multicallResult{{Success: true, ReturnData: []byte{0x01}}})
			require.NoError(t, err)
			return ret, nil
		}
		return f
	}
	calls := []multicallCall{{Target: common.HexToAddress("0x01"), CallData: []byte{0xde, 0xad, 0xbe, 0xef}}}

	results, endpoints, err := testReaderFor(mkChain(pin), "op").multicall(context.Background(), "t", pin, hashFor(pin), calls)
	require.NoError(t, err)
	require.Len(t, results, 1)
	require.Len(t, endpoints, 1)

	_, _, err = testReaderFor(mkChain(pin-3), "op").multicall(context.Background(), "t", pin, hashFor(pin), calls)
	require.ErrorIs(t, err, errChunkDivergence, "a diverging chunk block is exit-3 material, never data")
}

func testReaderFor(f *fakeChain, name string) *pinnedReader {
	r := newRPCRunner(100000, 2, &rpcCallLog{})
	noSleep := func(context.Context, time.Duration) error { return nil }
	r.sleep = noSleep
	r.limiter.sleep = noSleep
	return &pinnedReader{name: name, c: f, run: r}
}

// TestMulticallChunksAtFifteen (L1-7): 16 calls split into two chunks.
func TestMulticallChunksAtFifteen(t *testing.T) {
	pin := uint64(1000)
	f := &fakeChain{hashes: map[uint64]common.Hash{pin: hashFor(pin)}}
	invocations := 0
	f.handler = func(to common.Address, data []byte, hash common.Hash) ([]byte, error) {
		invocations++
		n := 15
		if invocations == 2 {
			n = 1
		}
		results := make([]multicallResult, n)
		for i := range results {
			results[i] = multicallResult{Success: true, ReturnData: []byte{byte(i)}}
		}
		ret, err := multicall3ABI.Methods["tryBlockAndAggregate"].Outputs.Pack(new(big.Int).SetUint64(pin), [32]byte{}, results)
		require.NoError(t, err)
		return ret, nil
	}
	calls := make([]multicallCall, 16)
	for i := range calls {
		calls[i] = multicallCall{Target: common.HexToAddress("0x01"), CallData: []byte{0, 0, 0, byte(i)}}
	}
	results, endpoints, err := testReaderFor(f, "op").multicall(context.Background(), "t", pin, hashFor(pin), calls)
	require.NoError(t, err)
	require.Equal(t, 2, invocations, "16 calls → chunks of ≤15 (free-tier gas caps, L1-7)")
	require.Len(t, results, 16)
	require.Len(t, endpoints, 2)
}

// TestSecondOpinionHonesty (§3.5 / L1-9): a single-endpoint config or a
// failing alternative yields "no second opinion available" — NEVER counted
// as corroboration; a fall-back to the first-opinion endpoint is also not
// an opinion.
func TestSecondOpinionHonesty(t *testing.T) {
	pin := hashFor(1)
	to := common.HexToAddress("0x0078C5a459132e279056B2371fE8A8eC973A9553")
	data, err := dmBorrowingOfOneABI.Pack("borrowingOf", common.HexToAddress("0xaa"), common.HexToAddress("0xbb"))
	require.NoError(t, err)

	single := &fakeChain{endpoints: 1}
	opinion, v := testReaderFor(single, "op").secondOpinion(context.Background(), "t", to, data, pin, 0)
	require.Contains(t, opinion, "no second opinion available (single endpoint)")
	require.Nil(t, v)

	failing := &fakeChain{endpoints: 2}
	failing.handler = func(common.Address, []byte, common.Hash) ([]byte, error) {
		return nil, fmt.Errorf("429 Too Many Requests")
	}
	opinion, v = testReaderFor(failing, "op").secondOpinion(context.Background(), "t", to, data, pin, 0)
	require.Contains(t, opinion, "no second opinion available")
	require.Nil(t, v)

	serving := &fakeChain{endpoints: 2}
	serving.handler = func(_ common.Address, _ []byte, _ common.Hash) ([]byte, error) {
		ret, err := dmBorrowingOfOneABI.Methods["borrowingOf"].Outputs.Pack(big.NewInt(42))
		require.NoError(t, err)
		return ret, nil
	}
	opinion, v = testReaderFor(serving, "op").secondOpinion(context.Background(), "t", to, data, pin, 0)
	require.Contains(t, opinion, "endpoint 1 answered 42")
	require.Equal(t, "42", v.String())
}

// TestTallyTotalsCountsGatedAndAdvisory: verdict accounting distinguishes
// gated from advisory rows across every family.
func TestTallyTotalsCountsGatedAndAdvisory(t *testing.T) {
	rep := &driftReport{
		DMRows:   []dmRowResult{{Verdict: verdictExact}, {Verdict: verdictDrift}},
		DMWeld:   []dmWeldRow{{Verdict: verdictExact}},
		AaveRows: []aaveRowResult{{Verdict: verdictExact, Gated: true}, {Verdict: verdictDrift, Gated: false, Supplement: true}},
		AaveWeld: []aaveWeldRow{{Verdict: verdictAggregateMismatch, Gated: true}, {Verdict: verdictExact, Gated: false}},
		Golden:   []goldenRow{{Verdict: verdictExact}},
		DMIndexCheck: []indexCheckRow{
			{Verdict: verdictExact, Gated: true},
			{Verdict: verdictNoIIUHistory, Gated: false},
		},
	}
	tot := rep.tallyTotals()
	require.Equal(t, 7, tot.GatedRows)
	require.Equal(t, 5, tot.GatedExact)
	require.Equal(t, 2, tot.GatedDrift)
	require.Equal(t, 3, tot.AdvisoryRows)
}
