package derive

// ParamRunner sequencing tests with a fake store and the REAL decode registry.
//
// The log bytes below are REAL: the weETH reserve-init cluster at ETH mainnet
// block 20,713,917, tx
// 0x8dce3e22688d50eaba48fbd1805623e7b7b9cb8910c96e609f279906c3d6ef67 (fetched
// 2026-07-28 via eth_getLogs on the recon RPC and cross-witnessed against
// Blockscout; the same bytes are committed as decode fixtures in
// internal/decode/testdata/configurator_inventory.json). Using the real
// registry rather than a fake decoder is deliberate — the refuse-loud rule and
// the param-row mapping are both properties of the decode/derive SEAM, and a
// fake decoder would let the seam pass while the real one fails.

import (
	"context"
	"errors"
	"fmt"
	"testing"

	"github.com/ethereum/go-ethereum/common"
	"github.com/stretchr/testify/require"

	"github.com/kaselunt/solvent/internal/config"
	"github.com/kaselunt/solvent/internal/decode"
	"github.com/kaselunt/solvent/internal/store"
)

const (
	paramChainID    = uint64(1)
	paramStream     = "eth:aave-param"
	paramStartBlock = uint64(20625519)
)

var paramConfigurator = common.HexToAddress("0x8438F4D29D895d75C86BDC25360c25eF0607E65d")

func paramSpec() RunnerSpec {
	return RunnerSpec{
		Engine: ParamEngineName, Chain: "eth", ChainID: paramChainID,
		Streams: []string{paramStream}, Addresses: [][]byte{paramConfigurator.Bytes()},
		StartBlock: paramStartBlock, Window: 2000,
	}
}

// cfgLog builds a RawLog from real configurator wire bytes.
func cfgLog(block uint64, logIndex uint32, txHash string, topics []string, data string) store.RawLog {
	tp := make([][]byte, len(topics))
	for i, t := range topics {
		tp[i] = common.FromHex(t)
	}
	return store.RawLog{
		ChainID: paramChainID, BlockNumber: block, BlockHash: []byte{0xbb},
		TxHash: common.FromHex(txHash), LogIndex: logIndex,
		Address: paramConfigurator.Bytes(), Topics: tp, Data: common.FromHex(data),
	}
}

const genesisTx = "0x8dce3e22688d50eaba48fbd1805623e7b7b9cb8910c96e609f279906c3d6ef67"

// The three param-bearing logs of the weETH reserve, in their real
// (block, logIndex) order, plus one real non-param inventory log between them.
func realReserveInitialized() store.RawLog {
	return cfgLog(20713917, 123, genesisTx, []string{
		"0x3a0ca721fc364424566385a1aa271ed508cc2c0949c2272575fb3013a163a45f",
		"0x000000000000000000000000cd5fe23c85820f7b72d0926fc9b05b43e359b7ee",
		"0x000000000000000000000000be1f842e7e0afd2c2322aae5d34ba899544b29db",
	}, "0x00000000000000000000000057a994227592652d58bbf3d52e34261df8b354d0"+
		"00000000000000000000000016264412cb72f0d16a446f7d928dd0d822810048"+
		"0000000000000000000000005024e947ef81b9184faf0cff9b485446f01c8ed2")
}

func realSupplyCapChanged() store.RawLog {
	return cfgLog(20713917, 143, genesisTx, []string{
		"0x0263602682188540a2d633561c0b4453b7d8566285e99f9f6018b8ef2facef49",
		"0x000000000000000000000000cd5fe23c85820f7b72d0926fc9b05b43e359b7ee",
	}, "0x0000000000000000000000000000000000000000000000000000000000000000"+
		"000000000000000000000000000000000000000000000000000000000000c350")
}

func realCollateralConfigurationChanged() store.RawLog {
	return cfgLog(20713917, 178, genesisTx, []string{
		"0x637febbda9275aea2e85c0ff690444c8d87eb2e8339bbede9715abcc89cb0995",
		"0x000000000000000000000000cd5fe23c85820f7b72d0926fc9b05b43e359b7ee",
	}, "0x0000000000000000000000000000000000000000000000000000000000001e78"+
		"0000000000000000000000000000000000000000000000000000000000001fa4"+
		"0000000000000000000000000000000000000000000000000000000000002968")
}

func realEModeAssetCategoryChanged() store.RawLog {
	return cfgLog(20713917, 182, genesisTx, []string{
		"0x5bb69795b6a2ea222d73a5f8939c23471a1f85a99c7ca43c207f1b71f10c6264",
		"0x000000000000000000000000cd5fe23c85820f7b72d0926fc9b05b43e359b7ee",
	}, "0x0000000000000000000000000000000000000000000000000000000000000000"+
		"0000000000000000000000000000000000000000000000000000000000000000")
}

// ---------------------------------------------------------------------------
// Fake param store.
// ---------------------------------------------------------------------------

type fakeParamStore struct {
	log *callLog

	cursor      uint64
	cursorFound bool
	ingest      map[string]*store.CursorPos
	logs        []store.RawLog
	unacked     bool

	// applyErr fails the next ApplyParamEvents call (one-shot).
	applyErr error
	// lastRows captures the rows handed to the most recent successful apply.
	lastRows []store.ParamRow

	// rewindDeepTo, when set, lands the cursor at min(requested, rewindDeepTo)
	// — RewindParams' deepest-unacked-epoch lowering.
	rewindDeepTo *uint64
}

func newFakeParamStore(log *callLog) *fakeParamStore {
	return &fakeParamStore{log: log, ingest: map[string]*store.CursorPos{}}
}

func (f *fakeParamStore) DeriveCursor(context.Context, string) (uint64, bool, error) {
	f.log.add("DeriveCursor")
	return f.cursor, f.cursorFound, nil
}

func (f *fakeParamStore) ApplyParamEvents(_ context.Context, _ string, _ uint64, rows []store.ParamRow, throughBlock uint64) error {
	f.log.add(fmt.Sprintf("ApplyParamEvents(rows=%d,through=%d)", len(rows), throughBlock))
	if f.applyErr != nil {
		err := f.applyErr
		f.applyErr = nil
		return err
	}
	f.lastRows = rows
	f.cursor, f.cursorFound = throughBlock, true
	return nil
}

func (f *fakeParamStore) RewindParams(_ context.Context, _ string, _ uint64, toBlock uint64) error {
	f.log.add(fmt.Sprintf("RewindParams(to=%d)", toBlock))
	effective := toBlock
	if f.rewindDeepTo != nil && *f.rewindDeepTo < effective {
		effective = *f.rewindDeepTo
	}
	f.cursor, f.cursorFound = effective, true
	f.unacked = false // RewindParams acks every epoch on the chain
	return nil
}

func (f *fakeParamStore) Cursor(_ context.Context, stream string) (*store.CursorPos, error) {
	f.log.add(fmt.Sprintf("Cursor(%s)", stream))
	return f.ingest[stream], nil
}

func (f *fakeParamStore) RawLogsInRange(_ context.Context, _ uint64, _ [][]byte, fromBlock, toBlock uint64) ([]store.RawLog, error) {
	f.log.add(fmt.Sprintf("RawLogs(%d-%d)", fromBlock, toBlock))
	var out []store.RawLog
	for _, l := range f.logs {
		if l.BlockNumber >= fromBlock && l.BlockNumber <= toBlock {
			out = append(out, l)
		}
	}
	return out, nil
}

func (f *fakeParamStore) HasUnackedReorg(context.Context, string, uint64) (bool, error) {
	f.log.add("HasUnackedReorg")
	return f.unacked, nil
}

var _ ParamStore = (*fakeParamStore)(nil)

func newTestParamRunner(t *testing.T, f *fakeParamStore) *ParamRunner {
	t.Helper()
	r, err := NewParamRunner(f, decode.NewRegistry(), paramSpec())
	require.NoError(t, err)
	return r
}

// ---------------------------------------------------------------------------
// Tests.
// ---------------------------------------------------------------------------

// TestParamRunnerDerivesRealParamRows walks a window of REAL configurator bytes
// and pins exactly which of them become param rows: the three param-bearing
// events do, the non-param inventory event does not (it is strictly decoded and
// then acknowledged), and every row carries its RAW basis-point values with the
// per-field nils intact.
func TestParamRunnerDerivesRealParamRows(t *testing.T) {
	log := &callLog{}
	f := newFakeParamStore(log)
	f.ingest[paramStream] = &store.CursorPos{Block: 20714000}
	f.cursor, f.cursorFound = 20713900, true
	f.logs = []store.RawLog{
		realReserveInitialized(),
		realSupplyCapChanged(), // inventory member, NOT a param
		realCollateralConfigurationChanged(),
		realEModeAssetCategoryChanged(),
	}

	r := newTestParamRunner(t, f)
	advanced, err := r.Step(context.Background())
	require.NoError(t, err)
	require.True(t, advanced)
	require.Len(t, f.lastRows, 3, "4 real logs in, 3 param rows out — the supply cap is not a param")

	weETH := common.HexToAddress("0xcd5fe23c85820f7b72d0926fc9b05b43e359b7ee").Bytes()

	// Row order follows RawLogsInRange's (block, logIndex) order verbatim.
	reg := f.lastRows[0]
	require.Equal(t, "AaveCfgReserveInitialized", reg.SourceEvent)
	require.Equal(t, weETH, reg.Asset)
	require.Equal(t, common.HexToAddress("0xbe1F842e7e0afd2c2322aae5d34bA899544b29db").Bytes(), reg.AToken)
	require.Equal(t, common.HexToAddress("0x16264412cb72f0d16a446f7d928dd0d822810048").Bytes(), reg.VariableDebtToken)
	require.Equal(t, common.HexToAddress("0x5024e947ef81b9184faf0cff9b485446f01c8ed2").Bytes(), reg.Strategy)
	require.Nil(t, reg.LTV, "a registry row asserts nothing about the ratios")
	require.Nil(t, reg.EModeCategory)
	require.Equal(t, uint64(20713917), reg.EffectiveBlock)
	require.Equal(t, uint32(123), reg.EffectiveLogIndex)
	require.Equal(t, common.FromHex(genesisTx), reg.TxHash)
	require.Equal(t, ParamEngineName, reg.Engine)
	require.Equal(t, paramChainID, reg.ChainID)

	cfg := f.lastRows[1]
	require.Equal(t, "AaveCfgCollateralConfigurationChanged", cfg.SourceEvent)
	require.Equal(t, uint32(178), cfg.EffectiveLogIndex)
	require.Equal(t, "7800", cfg.LTV.String(), "raw Aave bps — never normalized in storage")
	require.Equal(t, "8100", cfg.LiqThreshold.String())
	require.Equal(t, "10600", cfg.LiqBonus.String())
	require.Nil(t, cfg.AToken)

	emode := f.lastRows[2]
	require.Equal(t, "AaveCfgEModeAssetCategoryChanged", emode.SourceEvent)
	require.Equal(t, uint32(182), emode.EffectiveLogIndex)
	require.NotNil(t, emode.EModeCategory)
	require.Equal(t, uint8(0), *emode.EModeCategory)
	require.Nil(t, emode.LiqThreshold)

	// The window's through-block is the frontier-capped `to`, not the newest
	// row's block: a quiet governance window still advances custody.
	require.Contains(t, log.calls, "ApplyParamEvents(rows=3,through=20714000)")
}

// TestParamRunnerRefusesUnknownTopic0 is the refuse-loud regression (consult
// R1.2, blocking). An unknown topic0 in this engine's window must ERROR — the
// generic runner's `continue` is exactly what must NOT happen here — and
// nothing may be applied.
func TestParamRunnerRefusesUnknownTopic0(t *testing.T) {
	log := &callLog{}
	f := newFakeParamStore(log)
	f.ingest[paramStream] = &store.CursorPos{Block: 20714000}
	f.cursor, f.cursorFound = 20713900, true

	// A real log body under a topic0 no generation has ever emitted — the
	// shape a gen-7 configurator's new parameter event would arrive in.
	unknown := realCollateralConfigurationChanged()
	unknown.LogIndex = 179
	unknown.Topics = [][]byte{
		common.FromHex("0xfeedfacefeedfacefeedfacefeedfacefeedfacefeedfacefeedfacefeedface"),
		unknown.Topics[1],
	}
	f.logs = []store.RawLog{realCollateralConfigurationChanged(), unknown}

	r := newTestParamRunner(t, f)
	advanced, err := r.Step(context.Background())
	require.Error(t, err, "an unknown topic0 must HALT the param stream, never be skipped")
	require.False(t, advanced)
	require.ErrorContains(t, err, "UNKNOWN topic0")
	require.ErrorContains(t, err, "0xfeedfacefeedfacefeedfacefeedfacefeedfacefeedfacefeedfacefeedface")

	// Nothing was applied: the refusal precedes the write, so the cursor cannot
	// advance past a log this build does not understand.
	require.NotContains(t, fmt.Sprint(log.calls), "ApplyParamEvents")
	require.Equal(t, uint64(20713900), f.cursor)

	// And it is not a one-shot: the SAME Step fails again on retry (the halt is
	// the durable posture until the decode set is extended), while Health stays
	// green because the visibility belongs to step_error, not to a terminal
	// capability state.
	_, err = r.Step(context.Background())
	require.ErrorContains(t, err, "UNKNOWN topic0")
	healthy, reason := r.Health()
	require.True(t, healthy)
	require.Empty(t, reason)
}

// TestParamRunnerBootstrapAckAndReadBackResume covers rules 1, 3 and 4: the
// proactive repair fires FIRST, a cursor-less engine bootstraps via
// RewindParams(StartBlock−1), and the resume point is the cursor READ BACK —
// not the target that was asked for.
func TestParamRunnerBootstrapAckAndReadBackResume(t *testing.T) {
	log := &callLog{}
	f := newFakeParamStore(log)
	f.ingest[paramStream] = &store.CursorPos{Block: paramStartBlock + 5000}
	f.unacked = true
	f.cursorFound = false // brand-new engine on an epoch-carrying chain

	r := newTestParamRunner(t, f)
	advanced, err := r.Step(context.Background())
	require.NoError(t, err)
	require.True(t, advanced, "a completed rewind IS progress")

	// Rule 1: the unacked check precedes everything, including the frontier
	// read — a durable epoch must be answered before any derivation.
	require.Equal(t, []string{
		"HasUnackedReorg",
		"DeriveCursor",
		fmt.Sprintf("RewindParams(to=%d)", paramStartBlock-1),
		"DeriveCursor",
	}, log.calls)

	// Rule 4: the bootstrap target is the PRE-GENESIS block; there is no param
	// history to delete, and the call exists to create the cursor and ack.
	require.Equal(t, paramStartBlock-1, f.cursor)

	// Rule 3: the next Step derives from the cursor READ BACK. Make the store
	// lower the next rewind DEEPER than asked and prove the runner follows the
	// store rather than its own arithmetic.
	deep := paramStartBlock - 100
	f.rewindDeepTo = &deep
	f.unacked = true
	advanced, err = r.Step(context.Background())
	require.NoError(t, err)
	require.True(t, advanced)
	require.Equal(t, deep, f.cursor, "the store lowered the target; the runner adopts it")

	f.logs = []store.RawLog{realCollateralConfigurationChanged()}
	mark := len(log.calls)
	advanced, err = r.Step(context.Background())
	require.NoError(t, err)
	require.True(t, advanced)
	require.Contains(t, log.since(mark), fmt.Sprintf("RawLogs(%d-%d)", deep+1, deep+2000),
		"the window resumes at the LOWERED cursor + 1, never at the originally requested target")
}

// TestParamRunnerReactiveBackstop covers rule 2: an ErrUnackedReorgEpoch out of
// ApplyParamEvents — an epoch recorded AFTER this Step's proactive check —
// triggers the rewind in the same Step, and the Step reports progress.
func TestParamRunnerReactiveBackstop(t *testing.T) {
	log := &callLog{}
	f := newFakeParamStore(log)
	f.ingest[paramStream] = &store.CursorPos{Block: 20714000}
	f.cursor, f.cursorFound = 20713900, true
	f.logs = []store.RawLog{realCollateralConfigurationChanged()}
	f.applyErr = fmt.Errorf("engine %q has %w 7 on chain 1 (acked 6)", ParamEngineName, store.ErrUnackedReorgEpoch)

	r := newTestParamRunner(t, f)
	mark := len(log.calls)
	advanced, err := r.Step(context.Background())
	require.NoError(t, err, "the backstop HANDLES the refusal; it is not an error to the caller")
	require.True(t, advanced)
	require.Equal(t, []string{
		"HasUnackedReorg",
		fmt.Sprintf("Cursor(%s)", paramStream),
		"DeriveCursor",
		"RawLogs(20713901-20714000)", // frontier-capped, well inside the 2000 window
		"ApplyParamEvents(rows=1,through=20714000)",
		"DeriveCursor",
		"RewindParams(to=20713900)",
		"DeriveCursor",
	}, log.since(mark))

	// A non-epoch apply failure is NOT swallowed into a rewind.
	f.applyErr = errors.New("connection reset")
	advanced, err = r.Step(context.Background())
	require.ErrorContains(t, err, "connection reset")
	require.False(t, advanced)
}

// TestParamRunnerFrontierAndCaughtUp: the runner never derives past the block
// its stream has ingested (an incomplete window would silently drop params),
// reports no progress when caught up, and does nothing at all before the first
// ingest cursor exists.
func TestParamRunnerFrontierAndCaughtUp(t *testing.T) {
	log := &callLog{}
	f := newFakeParamStore(log)
	r := newTestParamRunner(t, f)

	// No ingest cursor yet.
	advanced, err := r.Step(context.Background())
	require.NoError(t, err)
	require.False(t, advanced)

	// Frontier below the window cap: the window stops at the frontier.
	f.ingest[paramStream] = &store.CursorPos{Block: paramStartBlock + 10}
	mark := len(log.calls)
	advanced, err = r.Step(context.Background())
	require.NoError(t, err)
	require.True(t, advanced)
	require.Contains(t, log.since(mark), fmt.Sprintf("RawLogs(%d-%d)", paramStartBlock, paramStartBlock+10))

	// Caught up: no window, no apply, no progress.
	mark = len(log.calls)
	advanced, err = r.Step(context.Background())
	require.NoError(t, err)
	require.False(t, advanced)
	require.NotContains(t, fmt.Sprint(log.since(mark)), "RawLogs")
}

// TestNewParamRunnerRefusesMismatchedSpec: the constructor refuses a spec that
// would write one engine's logs under another's cursor — the cursor is what
// every reorg gate keys on, so a mismatch is not a naming nit.
func TestNewParamRunnerRefusesMismatchedSpec(t *testing.T) {
	f := newFakeParamStore(&callLog{})
	spec := paramSpec()
	spec.Engine = "aave_v3_etherfi"
	_, err := NewParamRunner(f, decode.NewRegistry(), spec)
	require.ErrorContains(t, err, "is not \"aave_param\"")

	spec = paramSpec()
	spec.StartBlock = 0
	_, err = NewParamRunner(f, decode.NewRegistry(), spec)
	require.ErrorContains(t, err, "start block")

	_, err = NewParamRunner(nil, decode.NewRegistry(), paramSpec())
	require.ErrorContains(t, err, "store and decoder")
}

// TestBuildRunnerSpecsCarriesTheParamStream: the production config yields an
// aave_param spec with the singleton configurator address, so the daemon's
// wiring switch has something to construct.
func TestBuildRunnerSpecsCarriesTheParamStream(t *testing.T) {
	t.Setenv("SOLVENT_RPC_OP", "https://a.example")
	t.Setenv("SOLVENT_RPC_ETH", "https://b.example")
	t.Setenv("SOLVENT_DATABASE_URL", "postgres://x")
	cfg, err := config.Load("../../config/contracts.json")
	require.NoError(t, err)

	specs, err := BuildRunnerSpecs(cfg)
	require.NoError(t, err)
	var param *RunnerSpec
	for i := range specs {
		if specs[i].Engine == ParamEngineName {
			param = &specs[i]
		}
	}
	require.NotNil(t, param, "the aave_param stream must produce its own runner spec")
	require.Equal(t, uint64(1), param.ChainID)
	require.Equal(t, []string{"eth:aave-param"}, param.Streams)
	require.Len(t, param.Addresses, 1)
	require.Equal(t, paramConfigurator.Bytes(), param.Addresses[0])
	require.Equal(t, uint64(20625519), param.StartBlock)
	require.Equal(t, uint64(2000), param.Window)

	// It must NOT have been folded into the position engine's spec.
	for _, s := range specs {
		if s.Engine != "aave_v3_etherfi" {
			continue
		}
		for _, a := range s.Addresses {
			require.NotEqual(t, paramConfigurator.Bytes(), a,
				"the configurator must never join the Aave Pool engine's address set")
		}
	}

	_, err = NewParamRunner(newFakeParamStore(&callLog{}), decode.NewRegistry(), *param)
	require.NoError(t, err)
}
