package main

// Live-database choreography for one riskd pass: the compute-time reorg gate
// under an INJECTED epoch lag, the ABA recompute trigger driven through real
// cursor movement, and one end-to-end pass whose numbers are hand-computed.

import (
	"context"
	"fmt"
	"math/big"
	"net/url"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/ethereum/go-ethereum/common"
	"github.com/jackc/pgx/v5"
	"github.com/stretchr/testify/require"

	"github.com/kaselunt/solvent/internal/config"
	"github.com/kaselunt/solvent/internal/decode"
	"github.com/kaselunt/solvent/internal/risk"
	"github.com/kaselunt/solvent/internal/riskfeed"
	"github.com/kaselunt/solvent/internal/store"
)

// riskdTestDSN resolves this package's OWN scratch database, derived from
// TEST_DATABASE_URL by appending a fixed suffix.
//
// # Why a package-exclusive database and not TEST_DATABASE_URL itself
//
// `go test ./...` runs PACKAGES IN PARALLEL. These fixtures TRUNCATE
// position_balances, derive_cursors, prices, reorg_epochs and friends — the same
// tables `internal/store`'s suite is truncating and asserting on at the same
// moment. Sharing one database makes both suites flaky in a way that looks like a
// product bug: the first full-suite run of this wave failed five riskd tests AND
// `internal/store`'s TestPruneAckedReorgEpochs, none of which had anything wrong
// with them. Per-package isolation is the house pattern for exactly this
// (`cmd/reconcile`'s ensureDerivedDB); this is that pattern.
//
// The guard posture is unchanged: DEV MODE skips when TEST_DATABASE_URL is unset,
// ACCEPTANCE MODE makes that fatal (a skipped live-db suite can never produce
// suite-green evidence, round-10 F1), and a base DSN pointing at the live
// `solvent` database is refused outright.
// fxAaveBinding is the WALKED SURFACE the riskd fixtures claim: the weETH reserve's
// stream at the audited genesis. Both the config's expectation and the coverage the
// fixture stamps are built from it, so they agree by construction — a fixture whose
// two halves disagreed would refuse every Aave book for the wrong reason.
var fxAaveBinding = store.CoverageBindingOf(1, []store.CoverageStream{
	{Address: fxAave.Bytes(), StartBlock: fxAaveGenesis},
})

func riskdTestDSN(t *testing.T) string {
	t.Helper()
	base := os.Getenv("TEST_DATABASE_URL")
	if base == "" {
		if os.Getenv("SOLVENT_ACCEPTANCE") == "1" {
			t.Fatal("acceptance mode (SOLVENT_ACCEPTANCE=1): TEST_DATABASE_URL is REQUIRED — a skipped live-db suite can never produce suite-green evidence")
		}
		t.Skip("TEST_DATABASE_URL not set; run `make db-up` and export it (dev-mode skip)")
	}
	u, err := url.Parse(base)
	require.NoError(t, err)
	if u.Path == "/solvent" {
		t.Fatalf("TEST_DATABASE_URL points at the LIVE database %q — these tests TRUNCATE; point it at solvent_test", u.Path)
	}
	baseName := strings.TrimPrefix(u.Path, "/")
	require.NotEmpty(t, baseName)
	name := baseName + "_riskd"
	require.NotEqual(t, "solvent", name)

	ctx := context.Background()
	admin, err := pgx.Connect(ctx, base)
	require.NoError(t, err)
	defer admin.Close(ctx)
	var exists bool
	require.NoError(t, admin.QueryRow(ctx,
		`SELECT EXISTS(SELECT 1 FROM pg_database WHERE datname = $1)`, name).Scan(&exists))
	if !exists {
		// CREATE DATABASE cannot be parameterized; the name is derived from the
		// operator's own scratch DSN plus a fixed suffix.
		_, err = admin.Exec(ctx, fmt.Sprintf(`CREATE DATABASE %q`, name))
		// A racing sibling test process may have created it between the check
		// and here; that is success, not failure.
		if err != nil {
			require.NoError(t, admin.QueryRow(ctx,
				`SELECT EXISTS(SELECT 1 FROM pg_database WHERE datname = $1)`, name).Scan(&exists))
			require.True(t, exists, "creating the riskd scratch database failed: %v", err)
		}
	}
	du := *u
	du.Path = "/" + name
	return du.String()
}

type riskdFixture struct {
	store *store.Store
	admin *pgx.Conn
	cfg   *daemonConfig
	ctx   context.Context
	dsn   string
	feeds *config.Feeds
}

// restartedConfig is a FRESH daemonConfig over the same database — a restarted
// process, for every purpose that matters here: no in-memory watermark baseline,
// so its first pass is mandatory, and its G5 baseline comes from whatever the
// newest committed batch disclosed.
//
// It deliberately reuses the same policy values, because a restart of the SAME
// build must derive the SAME materialization identity. (A policy change is a
// different materialization, and identity_test.go pins that separately.)
func (f *riskdFixture) restartedConfig(t *testing.T) *daemonConfig {
	t.Helper()
	registry, err := riskfeed.NewRegistry(f.feeds)
	require.NoError(t, err)
	// FIELD BY FIELD, NOT `fresh := *f.cfg`.
	//
	// daemonConfig carries a VALUE atomic now (the clock skew), so a wholesale copy
	// is a vet copylocks violation — but the deeper reason is that the copy was
	// wrong before vet could say so: it duplicated a POINTER to one shared clock
	// between two configs the tests treat as independent daemons, so moving one
	// moved the other. Listing the policy fields also makes "what does a restart
	// preserve?" explicit instead of implicit, and TestDaemonConfigFieldsAreCloned
	// fails if a new field is added without a decision here.
	//
	// Every MUTABLE policy value is carried over, because tests legitimately tune
	// them (Retention, for one) and a restart of the same build must reproduce the
	// same materialization identity. The clock skew is deliberately NOT carried: a
	// restarted process starts at the real clock.
	fresh := &daemonConfig{
		Registry:     registry,
		Aave:         f.cfg.Aave,
		DM:           f.cfg.DM,
		PollInterval: f.cfg.PollInterval,
		Retention:    f.cfg.Retention,
		Budget:       f.cfg.Budget,
		StepBps:      f.cfg.StepBps,
		Producer:     f.cfg.Producer,
	}
	return fresh
}

// configWithSkew is a config with the SAME policy and an INDEPENDENT clock, moved
// to d.
//
// It replaces the `advanced := *f.cfg; advanced.clockSkewNanos = nil` idiom, which
// only worked because the field was a pointer that could be detached — and which
// read as "copy a config, then undo part of the copy". What the tests actually want
// is a second daemon over the same policy whose clock they can move without
// touching the first one's, and that is what this constructs.
func (f *riskdFixture) configWithSkew(t *testing.T, d time.Duration) *daemonConfig {
	t.Helper()
	cfg := f.restartedConfig(t)
	cfg.setSkew(d)
	return cfg
}

// secondInstance is a separate store handle plus config over the same database —
// a second honest riskd process.
func (f *riskdFixture) secondInstance(t *testing.T) *riskdFixture {
	t.Helper()
	s, err := store.Open(f.ctx, f.dsn)
	require.NoError(t, err)
	t.Cleanup(s.Close)
	return &riskdFixture{
		store: s, admin: f.admin, ctx: f.ctx, dsn: f.dsn, feeds: f.feeds,
		cfg: f.restartedConfig(t),
	}
}

var (
	fxAave          = common.HexToAddress("0xCd5fE23C85820F7B72D0926FC9b05b43E359b7ee") // weETH (ETH)
	fxAaveDb        = common.HexToAddress("0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48") // USDC (ETH)
	fxOracle        = common.HexToAddress("0x43b64f28A678944E0655404B0B98E443851cC34F")
	fxPriceProvider = common.HexToAddress("0x44dd2372FE7B97C4B4D6a7d4DeCf72466485BAcB")
	fxAcct          = common.HexToAddress("0xAAaa0000000000000000000000000000000000A1")
)

const (
	// fxAaveGenesis is the ether.fi Aave market's configured start block — the
	// coverage the flag-custody gate requires a walk to reach back to.
	fxAaveGenesis = uint64(20_625_519)
	fxAaveBlock   = uint64(25_635_618)
	fxParamBlock  = uint64(25_635_618)
	fxPriceBlock  = uint64(25_635_600)
)

func newRiskdFixture(t *testing.T) *riskdFixture {
	t.Helper()
	ctx := context.Background()
	dsn := riskdTestDSN(t)
	require.NoError(t, store.Migrate(ctx, dsn))

	s, err := store.Open(ctx, dsn)
	require.NoError(t, err)
	t.Cleanup(s.Close)

	admin, err := pgx.Connect(ctx, dsn)
	require.NoError(t, err)
	t.Cleanup(func() { _ = admin.Close(context.Background()) })

	_, err = admin.Exec(ctx, `TRUNCATE position_events, position_balances, derive_cursors, prices,
		price_poll_anchors, snapshots, snapshot_sweeps, sweep_generations, rate_indexes,
		reorg_epochs, raw_logs, ingest_cursors, param_history`)
	require.NoError(t, err)
	_, err = admin.Exec(ctx, `TRUNCATE risk_batches, risk_batch_watermarks, risk_positions,
		risk_position_legs, risk_price_inputs, risk_batch_aggregates, risk_scenarios, risk_waterfall
		RESTART IDENTITY CASCADE`)
	require.NoError(t, err)

	feeds := &config.Feeds{Assets: []config.Feed{
		{Chain: "eth", ChainID: 1, Engine: risk.AaveEngine, Address: fxAave, Symbol: "weETH", Decimals: 18,
			Oracle: config.FeedOracle{Kind: config.FeedKindPoll, Contract: fxOracle,
				Method: "getAssetPrice(address)", PriceDecimals: 8}},
		{Chain: "eth", ChainID: 1, Engine: risk.AaveEngine, Address: fxAaveDb, Symbol: "USDC", Decimals: 6,
			Oracle: config.FeedOracle{Kind: config.FeedKindPoll, Contract: fxOracle,
				Method: "getAssetPrice(address)", PriceDecimals: 8}},
		// The OP / Debt Manager side, valued from PriceProviderV2 (engine-exact).
		{Chain: "op", ChainID: 10, Engine: risk.DMEngine,
			Address: common.BytesToAddress(common20(fxDMCollateral)), Symbol: "weETH", Decimals: 18,
			Oracle: config.FeedOracle{Kind: config.FeedKindPoll, Contract: fxPriceProvider,
				Method: "price(address)", PriceDecimals: 6}},
		{Chain: "op", ChainID: 10, Engine: risk.DMEngine,
			Address: common.BytesToAddress(common20(fxDMDebtToken)), Symbol: "USDC", Decimals: 6,
			Oracle: config.FeedOracle{Kind: config.FeedKindPoll, Contract: fxPriceProvider,
				Method: "price(address)", PriceDecimals: 6}},
	}}
	registry, err := riskfeed.NewRegistry(feeds)
	require.NoError(t, err)

	f := &riskdFixture{
		store: s, admin: admin, ctx: ctx, dsn: dsn, feeds: feeds,
		cfg: &daemonConfig{
			Registry: registry,
			Aave: riskfeed.EngineBinding{Engine: risk.AaveEngine, ChainID: 1,
				ParamEngine: risk.AaveParamEngine, PriceEngine: "prices:poll:1",
				GenesisBlock: fxAaveGenesis, CoverageBinding: fxAaveBinding},
			DM: riskfeed.EngineBinding{Engine: risk.DMEngine, ChainID: 10,
				ParamEngine: risk.DMEngine, PriceEngine: "prices:poll:10"},
			PollInterval: time.Second,
			Retention:    5,
			Budget:       riskfeed.PriceBudget{Seconds: 180},
			StepBps:      2000,
			Producer:     "riskd-live-test",
		},
	}
	f.seedRequiredCursors(t)
	return f
}

// seedRequiredCursors gives EVERY engine the pass gate requires a derive cursor
// on its own chain, with no rows behind it.
//
// This is not fixture convenience — it is the gate's contract made explicit. A
// missing required cursor now REFUSES the pass, and rightly: a batch computed
// while `debt_manager` has never proven custody would omit that entire engine
// while presenting itself as the book, which reads downstream as "no Debt Manager
// risk exists". An empty batch on an engine with custody is a different and
// honest statement, and that is what these cursors establish.
//
// An empty event batch legitimately advances a cursor — a window containing no
// activity still extends custody — so this is the production path, not a poke.
func (f *riskdFixture) seedRequiredCursors(t *testing.T) {
	t.Helper()
	// The Aave cursor is established WITH DERIVATION COVERAGE from the engine's
	// genesis, because that is what a database whose flag ledger has actually been
	// walked looks like — and without it the assembler refuses the whole Aave book
	// (GateFlagCustodyUnproven), correctly. Stating it here makes the precondition
	// part of every Aave fixture's premise rather than an accident; the UNPROVEN
	// state gets its own explicit fixture in
	// TestRiskdRefusesTheAaveBookOnAnUnbackfilledFlagLedger.
	require.NoError(t, f.store.ApplyDerivedWindow(f.ctx, risk.AaveEngine, 1, nil, nil, fxAaveBlock,
		store.DerivationCoverage{FromBlock: fxAaveGenesis, DecoderRevision: decode.RegistryRevision,
			Binding: fxAaveBinding}))
	require.NoError(t, f.store.ApplyParamEvents(f.ctx, risk.AaveParamEngine, 1, nil, fxParamBlock))
	require.NoError(t, f.store.ApplyDerived(f.ctx, risk.DMEngine, 10, nil, fxDMBlock))
}

// seedHealthyAavePosition lands one borrower whose numbers are hand-computed in
// TestRiskdPassCommitsABatch's comment.
func (f *riskdFixture) seedHealthyAavePosition(t *testing.T) {
	t.Helper()
	// ApplyDerivedWindow, WITH coverage, because that is what a walker does — and
	// because the coverage-free entry point deliberately CLEARS the stamp
	// (store.ApplyDerivedWithRates: a window nobody vouched for makes the stored
	// range unattributable). Seeding a position through it would leave the fixture
	// unproven and refuse the very book these tests are about, which is the merge
	// rule behaving correctly, not a workaround being needed.
	require.NoError(t, f.store.ApplyDerivedWindow(f.ctx, risk.AaveEngine, 1,
		[]store.PositionEvent{
			{ChainID: 1, Engine: risk.AaveEngine, BlockNumber: fxAaveBlock, TxHash: []byte{0x01}, LogIndex: 0,
				EventType: "atoken_mint", Account: fxAcct.Bytes(), Asset: fxAave.Bytes(),
				Side: "collateral", Delta: mustBig("1000000000000000000")},
			// THE COLLATERAL-FLAG WITNESS, and it is not a workaround for the
			// retired assume-true posture — it is what the chain does. A first
			// supply into a collateral-configured reserve emits
			// ReserveUsedAsCollateralEnabled in the SAME TRANSACTION as the aToken
			// Mint, one log later; a fixture that folded the mint without the
			// enable would be seeding a state the Pool cannot produce. The
			// assertions below (300000000000 counted collateral, HF 2.43) are
			// unchanged and now rest on a witness instead of an assumption.
			{ChainID: 1, Engine: risk.AaveEngine, BlockNumber: fxAaveBlock, TxHash: []byte{0x01}, LogIndex: 1,
				EventType: store.AaveCollateralEnabledEvent, Account: fxAcct.Bytes(), Asset: fxAave.Bytes()},
			{ChainID: 1, Engine: risk.AaveEngine, BlockNumber: fxAaveBlock, TxHash: []byte{0x02}, LogIndex: 0,
				EventType: "aave_borrow", Account: fxAcct.Bytes(), Asset: fxAaveDb.Bytes(),
				Side: "debt", Delta: mustBig("1000000000")},
		},
		[]store.RateObservation{
			{Asset: fxAave.Bytes(), Block: 25_600_000, Kind: "liquidity_index", Value: mustBig("1000000000000000000000000000")},
			{Asset: fxAaveDb.Bytes(), Block: 25_610_000, Kind: "variable_borrow_index", Value: mustBig("1000000000000000000000000000")},
		},
		fxAaveBlock,
		store.DerivationCoverage{FromBlock: fxAaveGenesis, DecoderRevision: decode.RegistryRevision,
			Binding: fxAaveBinding}))

	require.NoError(t, f.store.ApplyParamEvents(f.ctx, risk.AaveParamEngine, 1, []store.ParamRow{
		{Engine: risk.AaveParamEngine, ChainID: 1, Asset: fxAave.Bytes(),
			LTV: big.NewInt(7800), LiqThreshold: big.NewInt(8100), LiqBonus: big.NewInt(10600),
			EffectiveBlock: 20_714_007, EffectiveLogIndex: 5,
			SourceEvent: "aave_cfg_collateral_configuration_changed", TxHash: []byte{0x0c}},
		// The registry row that a last-ROW-wins fold would let mask the
		// threshold above — the masking hazard, live and end to end.
		{Engine: risk.AaveParamEngine, ChainID: 1, Asset: fxAave.Bytes(),
			AToken: []byte{0xbe, 0x01}, VariableDebtToken: []byte{0xbe, 0x02},
			EffectiveBlock: 20_800_000, EffectiveLogIndex: 2,
			SourceEvent: "aave_cfg_reserve_initialized", TxHash: []byte{0x0d}},
		{Engine: risk.AaveParamEngine, ChainID: 1, Asset: fxAaveDb.Bytes(),
			LTV: big.NewInt(7500), LiqThreshold: big.NewInt(7800), LiqBonus: big.NewInt(10450),
			EffectiveBlock: 20_714_100, EffectiveLogIndex: 2,
			SourceEvent: "aave_cfg_collateral_configuration_changed", TxHash: []byte{0x0e}},
	}, fxParamBlock))

	f.seedPrices(t, time.Now().UTC().Add(-30*time.Second), "300000000000", "100000000")
}

func (f *riskdFixture) seedPrices(t *testing.T, asOf time.Time, collateral, debt string) {
	t.Helper()
	source := "aaveoracle:0x43b64f28a678944e0655404b0b98e443851cc34f"
	_, err := f.store.ApplyPolledPrices(f.ctx, "prices:poll:1", 1, []store.PriceObservation{
		{Asset: fxAave.Bytes(), Source: source, Price: mustBig(collateral), Decimals: 8,
			BlockNumber: fxPriceBlock, SourceAsOf: asOf},
		{Asset: fxAaveDb.Bytes(), Source: source, Price: mustBig(debt), Decimals: 8,
			BlockNumber: fxPriceBlock, SourceAsOf: asOf},
	}, fxPriceBlock, store.PollAnchor{BlockNumber: fxPriceBlock, BlockHash: hash32(0xab)})
	require.NoError(t, err)
}

// hash32 builds a distinct 32-byte block hash — poll anchors refuse anything
// that is not hash-shaped.
func hash32(b byte) []byte {
	h := make([]byte, 32)
	h[31] = b
	return h
}

func mustBig(s string) *big.Int {
	v, ok := new(big.Int).SetString(s, 10)
	if !ok {
		panic("bad integer literal: " + s)
	}
	return v
}

// TestRiskdPassCommitsABatch is the end-to-end happy path. The health factor is
// the SAME hand-computed integer the riskfeed unit test pins, arrived at here
// through the real database, the real fold, the real price predicate and the
// real write transaction:
//
//	collateral base = floor(1e18 × 300000000000 / 1e18)         = 300000000000
//	debt base       = floor(1000000000 × 100000000 / 1e6)       = 100000000000
//	weighted LT sum = 300000000000 × 8100                       = 2430000000000000
//	HF              = floor(2430000000000000 × 1e18 / 1e15)     = 2430000000000000000
func TestRiskdPassCommitsABatch(t *testing.T) {
	f := newRiskdFixture(t)
	f.seedHealthyAavePosition(t)

	res, err := runPass(f.ctx, f.store, f.cfg)
	require.NoError(t, err)
	require.False(t, res.Gated)
	require.Positive(t, res.BatchID)
	require.Equal(t, 1, res.Positions)
	require.Zero(t, res.Refused)

	batch, found, err := f.store.NewestCompleteBatch(f.ctx)
	require.NoError(t, err)
	require.True(t, found)
	require.Equal(t, res.BatchID, batch.ID)

	positions, err := f.store.RiskBatchPositions(f.ctx, batch.ID)
	require.NoError(t, err)
	require.Len(t, positions, 1)
	p := positions[0]
	require.Equal(t, store.RiskPositionComputed, p.Status)
	require.Equal(t, "2430000000000000000", p.HFWad.String(),
		"the live pipeline reproduces the hand-computed health factor exactly")
	require.Equal(t, "300000000000", p.TotalCollateralBase.String())
	require.Equal(t, "100000000000", p.TotalDebtBase.String())
	require.EqualValues(t, fxAaveBlock, p.BalancesBlock)
	require.EqualValues(t, fxParamBlock, p.ParamsBlock)

	// The registry row did NOT mask the threshold — proven through the database.
	var lt string
	require.NoError(t, f.admin.QueryRow(f.ctx,
		`SELECT liq_threshold::text FROM risk_position_legs WHERE batch_id = $1 AND asset = $2`,
		batch.ID, fxAave.Bytes()).Scan(&lt))
	require.Equal(t, "8100", lt)

	// Every stamped engine is present, including the price cursor.
	stamped := map[string]bool{}
	for _, w := range batch.Watermarks {
		stamped[w.Engine] = true
	}
	require.True(t, stamped[risk.AaveEngine])
	require.True(t, stamped[risk.AaveParamEngine])
	require.True(t, stamped["prices:poll:1"])

	// FULL price snapshots landed, with the class the Aave surface may consume.
	prices, err := f.store.RiskBatchPriceInputs(f.ctx, batch.ID)
	require.NoError(t, err)
	require.Len(t, prices, 2)
	for _, pr := range prices {
		require.Equal(t, risk.ProvenanceAdapterOutput, pr.Provenance,
			"Aave valuation consumes adapter-output ONLY — the uncapped feed is never fetched")
		require.NotNil(t, pr.SourceAsOf)
		require.Equal(t, "fresh", pr.Verdict)
	}
}

// TestRiskdPassGatesOnInjectedEpochLag is the compute-time Window A refusal:
// a reorg epoch is recorded on the engine's chain and the engine's ack has NOT
// landed. The pass must refuse — retryably — and write NOTHING.
func TestRiskdPassGatesOnInjectedEpochLag(t *testing.T) {
	f := newRiskdFixture(t)
	f.seedHealthyAavePosition(t)

	// A first pass succeeds, so the refusal below cannot be confused with an
	// unseeded fixture.
	first, err := runPass(f.ctx, f.store, f.cfg)
	require.NoError(t, err)
	require.False(t, first.Gated)

	// The walker's rewind: an epoch lands atomically with the raw deletion, and
	// the runner's ack has not yet happened. This is the durable state a crash
	// between the two commits leaves behind.
	_, err = f.admin.Exec(f.ctx,
		`INSERT INTO reorg_epochs (chain_id, rewound_to) VALUES (1, $1)`, fxAaveBlock-10)
	require.NoError(t, err)

	gated, err := runPass(f.ctx, f.store, f.cfg)
	require.NoError(t, err, "a gate refusal is an ordinary outcome, never an error return")
	require.True(t, gated.Gated)
	require.ErrorIs(t, gated.GateErr, errPassGated)
	require.Contains(t, gated.GateErr.Error(), risk.AaveEngine)
	require.Zero(t, gated.BatchID)

	// Nothing new landed: the newest servable batch is still the first one.
	batch, found, err := f.store.NewestCompleteBatch(f.ctx)
	require.NoError(t, err)
	require.True(t, found)
	require.Equal(t, first.BatchID, batch.ID,
		"a gated pass writes nothing; the previous batch stands until the ack lands")

	// The ack lands (RewindDerived's effect), and the pass runs again.
	var maxEpoch int64
	require.NoError(t, f.admin.QueryRow(f.ctx,
		`SELECT max(epoch) FROM reorg_epochs WHERE chain_id = 1`).Scan(&maxEpoch))
	_, err = f.admin.Exec(f.ctx,
		`UPDATE derive_cursors SET acked_epoch = $1 WHERE chain_id = 1`, maxEpoch)
	require.NoError(t, err)

	healed, err := runPass(f.ctx, f.store, f.cfg)
	require.NoError(t, err)
	require.False(t, healed.Gated, "the gate is transient by construction: the next pass proceeds")
	require.Greater(t, healed.BatchID, first.BatchID)

	// And the new batch's stamps carry the acked epoch, which is what survives
	// PruneAckedReorgEpochs.
	batch, _, err = f.store.NewestCompleteBatch(f.ctx)
	require.NoError(t, err)
	for _, w := range batch.Watermarks {
		if w.ChainID == 1 {
			require.Equal(t, maxEpoch, w.AckedEpoch)
			require.Equal(t, maxEpoch, w.MaxEpochAtCompute)
		}
	}
}

// TestRiskdABARecomputeFiresOnLiveCursors drives the ABA sequence through REAL
// cursor rows and asserts the daemon's trigger fires — with the height proven
// identical, so a last_block-only comparison would provably have missed it.
func TestRiskdABARecomputeFiresOnLiveCursors(t *testing.T) {
	f := newRiskdFixture(t)
	f.seedHealthyAavePosition(t)

	res, err := runPass(f.ctx, f.store, f.cfg)
	require.NoError(t, err)
	require.False(t, res.Gated)
	baseline := res.Vector
	baselineHeight := baseline.Engines[risk.AaveEngine].LastBlock

	// Quiet chain: nothing moved, so nothing recomputes.
	changed, _, _, err := pollTrigger(f.ctx, f.store, f.cfg, baseline)
	require.NoError(t, err)
	require.False(t, changed)

	// (A→B) The walker rewinds and the deriver acknowledges.
	_, err = f.admin.Exec(f.ctx,
		`INSERT INTO reorg_epochs (chain_id, rewound_to) VALUES (1, $1)`, fxAaveBlock-20)
	require.NoError(t, err)
	var maxEpoch int64
	require.NoError(t, f.admin.QueryRow(f.ctx,
		`SELECT max(epoch) FROM reorg_epochs WHERE chain_id = 1`).Scan(&maxEpoch))
	_, err = f.admin.Exec(f.ctx,
		`UPDATE derive_cursors SET last_block = $1, acked_epoch = $2 WHERE engine = $3`,
		fxAaveBlock-20, maxEpoch, risk.AaveEngine)
	require.NoError(t, err)

	// (B→A) The re-walk regains the ORIGINAL height.
	_, err = f.admin.Exec(f.ctx,
		`UPDATE derive_cursors SET last_block = $1 WHERE engine = $2`, fxAaveBlock, risk.AaveEngine)
	require.NoError(t, err)

	// And the epoch is PRUNED, erasing the MAX(reorg_epochs.epoch) evidence —
	// the state in which a naive detector has nothing left to look at.
	_, err = f.admin.Exec(f.ctx, `DELETE FROM reorg_epochs WHERE chain_id = 1`)
	require.NoError(t, err)

	changed, after, _, err := pollTrigger(f.ctx, f.store, f.cfg, baseline)
	require.NoError(t, err)
	require.Equal(t, baselineHeight, after.Engines[risk.AaveEngine].LastBlock,
		"the cursor regained its original height — a last_block-only comparison sees nothing")
	require.Equal(t, baseline.MaxEpochs, after.MaxEpochs,
		"and the epoch row was pruned — MAX(reorg_epochs.epoch) is back where it started")
	require.True(t, changed,
		"the acked_epoch leg must still fire: it is monotone and prune-immune")

	// The recompute really happens and produces a NEW batch.
	again, err := runPass(f.ctx, f.store, f.cfg)
	require.NoError(t, err)
	require.False(t, again.Gated)
	require.Greater(t, again.BatchID, res.BatchID)
}

// TestRiskdPassRefusesPositionOnStalePriceCeiling exercises G1's over-ceiling
// arm end to end: the price row is real and valid, just far too old.
func TestRiskdPassRefusesPositionOnStalePriceCeiling(t *testing.T) {
	f := newRiskdFixture(t)
	f.seedHealthyAavePosition(t)
	// Overwrite the chain as-of with one well past 2 × 180s.
	_, err := f.admin.Exec(f.ctx,
		`UPDATE prices SET source_as_of = now() - interval '2 hours' WHERE chain_id = 1`)
	require.NoError(t, err)

	res, err := runPass(f.ctx, f.store, f.cfg)
	require.NoError(t, err)
	require.False(t, res.Gated, "a stale PRICE is position-scoped, never a pass refusal")
	require.Equal(t, 1, res.Refused)

	positions, err := f.store.RiskBatchPositions(f.ctx, res.BatchID)
	require.NoError(t, err)
	require.Len(t, positions, 1)
	require.Equal(t, store.RiskPositionRefused, positions[0].Status)
	require.Equal(t, riskfeed.GateMissingInput, positions[0].RefusalCode)
	require.Nil(t, positions[0].HFWad, "a refused position serves no health factor")

	// The refused input is still disclosed, with the verdict and the budget it
	// was judged against.
	prices, err := f.store.RiskBatchPriceInputs(f.ctx, res.BatchID)
	require.NoError(t, err)
	require.NotEmpty(t, prices)
	require.Equal(t, riskfeed.VerdictOverCeiling, prices[0].Verdict)
	require.EqualValues(t, 180, prices[0].BudgetSeconds)
	require.NotNil(t, prices[0].AgeSeconds)
	require.Greater(t, *prices[0].AgeSeconds, int64(360))
}

// TestRiskdPassRefusesPositionWhenSourceAsOfIsNull is the durable-truthful-as-of
// law at the daemon level: pre-00012 rows carry NULL, and `observed_at` — which
// is fresh — must never be substituted.
func TestRiskdPassRefusesPositionWhenSourceAsOfIsNull(t *testing.T) {
	f := newRiskdFixture(t)
	f.seedHealthyAavePosition(t)
	_, err := f.admin.Exec(f.ctx, `UPDATE prices SET source_as_of = NULL WHERE chain_id = 1`)
	require.NoError(t, err)

	res, err := runPass(f.ctx, f.store, f.cfg)
	require.NoError(t, err)
	require.Equal(t, 1, res.Refused)

	prices, err := f.store.RiskBatchPriceInputs(f.ctx, res.BatchID)
	require.NoError(t, err)
	require.NotEmpty(t, prices)
	require.Equal(t, riskfeed.VerdictNoAsOf, prices[0].Verdict)
	require.Nil(t, prices[0].AgeSeconds, "no as-of means no age; a computed one would be fabricated")
}

// TestRiskdRetentionHoldsAcrossPasses: the prune runs inside each write.
func TestRiskdRetentionHoldsAcrossPasses(t *testing.T) {
	f := newRiskdFixture(t)
	f.seedHealthyAavePosition(t)
	f.cfg.Retention = 2

	// Each pass must be a genuinely DIFFERENT materialization, or they all adopt
	// the first and there is nothing to prune. That is not a fixture workaround —
	// it is the daemon's real behaviour: it recomputes only when the vector moves,
	// and a pass over unchanged state now correctly resolves to the batch that
	// already describes it.
	var ids []int64
	for i := 0; i < 4; i++ {
		f.seedPricesAt(t, fxPriceBlock+uint64(10*(i+1)),
			"30000000000"+string(rune('0'+i)), "100000000")
		res, err := runPass(f.ctx, f.store, f.cfg)
		require.NoError(t, err)
		ids = append(ids, res.BatchID)
	}
	require.Len(t, uniqueInt64(ids), 4, "four distinct materializations, four distinct batches")
	var count int
	require.NoError(t, f.admin.QueryRow(f.ctx, `SELECT count(*) FROM risk_batches`).Scan(&count))
	require.Equal(t, 2, count)

	batch, found, err := f.store.NewestCompleteBatch(f.ctx)
	require.NoError(t, err)
	require.True(t, found)
	require.Equal(t, ids[3], batch.ID)
}

// TestRiskdG5FlagsALargeStepAgainstThePreviousBatch proves the step baseline is
// the number we PUBLISHED, read back from the batch's own snapshots.
func TestRiskdG5FlagsALargeStepAgainstThePreviousBatch(t *testing.T) {
	f := newRiskdFixture(t)
	f.seedHealthyAavePosition(t)

	first, err := runPass(f.ctx, f.store, f.cfg)
	require.NoError(t, err)

	// The first pass has NO flags at all, and that is now a real assertion rather
	// than an unavailable one. Under the retired assume-true posture every Aave
	// position carried `aave_collateral_flag_unwitnessed` by construction, so a
	// flag-count assertion here could never discriminate anything. With the flag
	// witnessed — and the fixture's witness saying ENABLED — a clean position is
	// genuinely clean, so the G5 flag appearing in the second pass is visible as a
	// transition from empty rather than as one entry among a permanent one.
	firstPositions, err := f.store.RiskBatchPositions(f.ctx, first.BatchID)
	require.NoError(t, err)
	require.Len(t, firstPositions, 1)
	require.Empty(t, firstPositions[0].Flags,
		"a witnessed-enabled, fresh-priced, first-pass position carries nothing to disclose")

	// A later poll lands a −40% move on the collateral asset.
	f.seedPricesAt(t, fxPriceBlock+10, "180000000000", "100000000")

	second, err := runPass(f.ctx, f.store, f.cfg)
	require.NoError(t, err)
	require.Greater(t, second.BatchID, first.BatchID)

	positions, err := f.store.RiskBatchPositions(f.ctx, second.BatchID)
	require.NoError(t, err)
	require.Len(t, positions, 1)
	require.Contains(t, positions[0].Flags, riskfeed.FlagLargeStep,
		"a 40% single-interval move is beyond the 20% policy bound and must be disclosed")
	require.Equal(t, store.RiskPositionComputed, positions[0].Status,
		"G5 NEVER refuses: the polled price IS the engine's charging price")

	// The new price really was consumed — so the flag describes a move that
	// actually happened, not a stale baseline.
	prices, err := f.store.RiskBatchPriceInputs(f.ctx, second.BatchID)
	require.NoError(t, err)
	var collateralValue string
	for _, pr := range prices {
		if common.BytesToAddress(pr.Asset) == fxAave {
			collateralValue = pr.Value.String()
		}
	}
	require.Equal(t, "180000000000", collateralValue)

	aggs, err := f.store.RiskBatchAggregates(f.ctx, second.BatchID)
	require.NoError(t, err)
	for _, a := range aggs {
		if a.Engine == risk.AaveEngine {
			require.Equal(t, 1, a.FlaggedPositions, "the flag propagates into the aggregate")
		}
	}
}

// seedFreshPrices lands a healthy Aave position whose price as-ofs are the
// DATABASE'S OWN now(), then proves it.
//
// The base fixture seeds its as-of 30 seconds in the process's past, which is fine
// for the default 180s budget but makes any tight-budget test race: a loaded
// PostgreSQL or a scheduler hiccup can consume the fresh window before the first
// assertion runs, and the test flaps between fresh, stale and over-ceiling. Anchoring
// to the database clock inside the same statement removes wall-clock timing from the
// setup entirely — every freshness test then moves time through
// daemonConfig.clockSkew, deterministically, instead of waiting for it.
func (f *riskdFixture) seedFreshPrices(t *testing.T) {
	t.Helper()
	f.seedHealthyAavePosition(t)

	// Re-anchor every price as-of to the database's own clock. No value, scale,
	// block or validity is touched — only the as-of — so nothing about which row is
	// usable changes.
	_, err := f.admin.Exec(f.ctx, `UPDATE prices SET source_as_of = now() WHERE chain_id = 1`)
	require.NoError(t, err)

	// PROVE the premise rather than assume it: every consumed row must be inside
	// the fresh window by the database's reckoning, or a test that later observes a
	// crossing is observing nothing.
	var maxAge float64
	require.NoError(t, f.admin.QueryRow(f.ctx,
		`SELECT COALESCE(MAX(EXTRACT(EPOCH FROM (now() - source_as_of))), 0)
		 FROM prices WHERE chain_id = 1 AND valid`).Scan(&maxAge))
	require.Less(t, maxAge, float64(f.cfg.Budget.Seconds),
		"the seeded prices must start INSIDE the fresh window (age %.2fs vs budget %ds)",
		maxAge, f.cfg.Budget.Seconds)
}

func uniqueInt64(in []int64) []int64 {
	seen := map[int64]bool{}
	var out []int64
	for _, v := range in {
		if !seen[v] {
			seen[v] = true
			out = append(out, v)
		}
	}
	return out
}

func (f *riskdFixture) seedPricesAt(t *testing.T, block uint64, collateral, debt string) {
	t.Helper()
	asOf := time.Now().UTC()
	source := "aaveoracle:0x43b64f28a678944e0655404b0b98e443851cc34f"
	_, err := f.store.ApplyPolledPrices(f.ctx, "prices:poll:1", 1, []store.PriceObservation{
		{Asset: fxAave.Bytes(), Source: source, Price: mustBig(collateral), Decimals: 8,
			BlockNumber: block, SourceAsOf: asOf},
		{Asset: fxAaveDb.Bytes(), Source: source, Price: mustBig(debt), Decimals: 8,
			BlockNumber: block, SourceAsOf: asOf},
	}, block, store.PollAnchor{BlockNumber: block, BlockHash: hash32(0xcd)})
	require.NoError(t, err)
}
