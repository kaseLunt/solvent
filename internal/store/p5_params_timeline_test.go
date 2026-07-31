package store

// P5 Task B1 live-db tests for ParamTimeline: the merged chronology over
// param_history (aave_param) and the DM config event classes, prior-value
// extraction, filters, keyset pagination, and verbatim denominators.

import (
	"context"
	"math/big"
	"strconv"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

var (
	p5ReserveX = addr20(0xE1)
	p5ReserveY = addr20(0xE2)
	p5TokenZ   = addr20(0xE3)
)

func seedP5Params(t *testing.T, s *Store) {
	t.Helper()
	ctx := context.Background()

	// The aave_param ledger (chain 1), through the production writer.
	require.NoError(t, s.ApplyParamEvents(ctx, paramEngineAave, 1, []ParamRow{
		{
			Engine: paramEngineAave, ChainID: 1, Asset: p5ReserveX,
			AToken: addr20(0xF1), VariableDebtToken: addr20(0xF2), Strategy: addr20(0xF3),
			EffectiveBlock: 20_000_000, EffectiveLogIndex: 10,
			SourceEvent: "ReserveInitialized", TxHash: p5Tx(0x21),
		},
		{
			Engine: paramEngineAave, ChainID: 1, Asset: p5ReserveX,
			LTV: big.NewInt(7800), LiqThreshold: big.NewInt(8100), LiqBonus: big.NewInt(10600),
			EffectiveBlock: 20_000_000, EffectiveLogIndex: 11,
			SourceEvent: "CollateralConfigurationChanged", TxHash: p5Tx(0x21),
		},
		{
			Engine: paramEngineAave, ChainID: 1, Asset: p5ReserveY,
			LTV: big.NewInt(7000), LiqThreshold: big.NewInt(7500), LiqBonus: big.NewInt(10500),
			EffectiveBlock: 20_000_050, EffectiveLogIndex: 3,
			SourceEvent: "CollateralConfigurationChanged", TxHash: p5Tx(0x22),
		},
	}, 20_000_050))

	// The DM config events (chain 10), through the production writer. Values
	// are HUNDRED_PERCENT-denominated (100e18) as the contract emits them.
	require.NoError(t, s.ApplyDerived(ctx, EngineDebtManager, 10, []PositionEvent{
		{ChainID: 10, Engine: EngineDebtManager, BlockNumber: 152_999_990,
			TxHash: p5Tx(0x31), LogIndex: 2, EventType: "collateral_token_added",
			Account: []byte{}, Asset: p5TokenZ},
		{ChainID: 10, Engine: EngineDebtManager, BlockNumber: 153_000_000,
			TxHash: p5Tx(0x32), LogIndex: 4, EventType: "collateral_token_config_set",
			Account: []byte{}, Asset: p5TokenZ,
			Payload: map[string]string{
				"old_ltv":                   "50000000000000000000",
				"old_liquidation_threshold": "80000000000000000000",
				"old_liquidation_bonus":     "100000000000000000000",
				"ltv":                       "55000000000000000000",
				"liquidation_threshold":     "82000000000000000000",
				"liquidation_bonus":         "105000000000000000000",
			}},
		{ChainID: 10, Engine: EngineDebtManager, BlockNumber: 153_000_010,
			TxHash: p5Tx(0x33), LogIndex: 6, EventType: "borrow_apy_set",
			Account: []byte{}, Asset: p5TokenZ,
			Payload: map[string]string{"old_apy": "634195839675", "new_apy": "728310502283"}},
		// A NON-config DM event in range: must never enter the timeline.
		{ChainID: 10, Engine: EngineDebtManager, BlockNumber: 153_000_005,
			TxHash: p5Tx(0x34), LogIndex: 1, EventType: "borrow",
			Account: p5AccountA, Asset: p5TokenZ, Side: "debt", Delta: big.NewInt(5),
			Payload: map[string]string{"usd": "5"}},
	}, 153_000_010))
}

func timelineKeys(entries []ParamTimelineEntry) []string {
	var out []string
	for _, e := range entries {
		out = append(out, e.Engine+"/"+e.SourceEvent+"@"+strconv.FormatUint(e.BlockNumber, 10))
	}
	return out
}

func TestParamTimelineMergedChronology(t *testing.T) {
	s := testB1Store(t)
	seedP5Params(t, s)

	res, err := s.ParamTimeline(context.Background(), "", nil, "", 50)
	require.NoError(t, err)
	require.Empty(t, res.NextCursor)
	// Newest first; DM (OP heights) above the aave ledger (mainnet heights,
	// the contract's cross-chain block ordering); the DM `borrow` row is
	// absent; two same-block aave rows order by log index DESC.
	require.Equal(t, []string{
		"debt_manager/borrow_apy_set@153000010",
		"debt_manager/collateral_token_config_set@153000000",
		"debt_manager/collateral_token_added@152999990",
		"aave_param/CollateralConfigurationChanged@20000050",
		"aave_param/CollateralConfigurationChanged@20000000",
		"aave_param/ReserveInitialized@20000000",
	}, timelineKeys(res.Entries))

	// DM config-set: snapshot AND prior values, verbatim HUNDRED_PERCENT
	// denominators — never rescaled.
	cfg := res.Entries[1]
	require.Equal(t, "55000000000000000000", cfg.LTV.String())
	require.Equal(t, "82000000000000000000", cfg.LiqThreshold.String())
	require.Equal(t, "105000000000000000000", cfg.LiqBonus.String())
	require.Equal(t, "50000000000000000000", cfg.PriorLTV.String())
	require.Equal(t, "80000000000000000000", cfg.PriorLiqThreshold.String())
	require.Equal(t, "100000000000000000000", cfg.PriorLiqBonus.String())

	// APY set: new + prior.
	apy := res.Entries[0]
	require.Equal(t, "728310502283", apy.BorrowAPY.String())
	require.Equal(t, "634195839675", apy.PriorBorrowAPY.String())
	require.Nil(t, apy.LTV)

	// Membership change: the event name IS the fact, no numbers invented.
	added := res.Entries[2]
	require.Nil(t, added.LTV)
	require.Nil(t, added.BorrowAPY)

	// The aave ledger row: basis-point denominators verbatim, per-field NULLs
	// preserved (the registry row speaks only to registry fields).
	aaveCfg := res.Entries[4]
	require.Equal(t, "7800", aaveCfg.LTV.String())
	require.Equal(t, "8100", aaveCfg.LiqThreshold.String())
	require.Nil(t, aaveCfg.AToken)
	reg := res.Entries[5]
	require.Nil(t, reg.LTV)
	require.Equal(t, addr20(0xF1), reg.AToken)
}

func TestParamTimelineFilters(t *testing.T) {
	s := testB1Store(t)
	seedP5Params(t, s)
	ctx := context.Background()

	t.Run("engine aave", func(t *testing.T) {
		res, err := s.ParamTimeline(ctx, EngineAave, nil, "", 50)
		require.NoError(t, err)
		require.Len(t, res.Entries, 3)
		for _, e := range res.Entries {
			require.Equal(t, paramEngineAave, e.Engine)
		}
	})
	t.Run("engine dm", func(t *testing.T) {
		res, err := s.ParamTimeline(ctx, EngineDebtManager, nil, "", 50)
		require.NoError(t, err)
		require.Len(t, res.Entries, 3)
		for _, e := range res.Entries {
			require.Equal(t, EngineDebtManager, e.Engine)
		}
	})
	t.Run("asset", func(t *testing.T) {
		res, err := s.ParamTimeline(ctx, "", p5ReserveX, "", 50)
		require.NoError(t, err)
		require.Len(t, res.Entries, 2)
		for _, e := range res.Entries {
			require.Equal(t, p5ReserveX, e.Asset)
		}
	})
	t.Run("unknown engine refused", func(t *testing.T) {
		_, err := s.ParamTimeline(ctx, "aave", nil, "", 50)
		require.ErrorContains(t, err, "unknown engine")
	})
	t.Run("limit refused", func(t *testing.T) {
		_, err := s.ParamTimeline(ctx, "", nil, "", 0)
		require.ErrorContains(t, err, "limit must be positive")
	})
}

func TestParamTimelinePaginationIsExact(t *testing.T) {
	s := testB1Store(t)
	seedP5Params(t, s)
	ctx := context.Background()

	full, err := s.ParamTimeline(ctx, "", nil, "", 50)
	require.NoError(t, err)
	require.Len(t, full.Entries, 6)

	var walked []string
	cursor := ""
	for {
		page, err := s.ParamTimeline(ctx, "", nil, cursor, 2)
		require.NoError(t, err)
		walked = append(walked, timelineKeys(page.Entries)...)
		if page.NextCursor == "" {
			break
		}
		cursor = page.NextCursor
	}
	require.Equal(t, timelineKeys(full.Entries), walked)
}

func TestParamTimelineBlockTimeEnrichment(t *testing.T) {
	s := testB1Store(t)
	seedP5Params(t, s)
	ctx := context.Background()

	const unix = int64(1_753_910_000)
	up, err := s.UpsertBlockHeader(ctx, BlockHeaderWrite{ChainID: 1, Block: 20_000_050, Hash: bytes32(0xCD), Time: unix})
	require.NoError(t, err)
	require.True(t, up.Stored)

	res, err := s.ParamTimeline(ctx, "", nil, "", 50)
	require.NoError(t, err)
	for _, e := range res.Entries {
		if e.ChainID == 1 && e.BlockNumber == 20_000_050 {
			require.NotNil(t, e.BlockTime)
			require.Equal(t, time.Unix(unix, 0).UTC(), *e.BlockTime)
		} else {
			require.Nil(t, e.BlockTime)
		}
	}
}
