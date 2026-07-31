package store

// P5 Task B1 live-db tests for EventsPage: ordering, keyset pagination,
// filters, bookkeeping exclusion, liquidation detail extraction and header
// time enrichment.
//
// Gating: TEST_DATABASE_URL (the writable scratch database), the standard
// destructive-suite discipline. The liquidation rows come from
// testdata/p5_liquidation_rows.json — REAL CAPTURED position_events rows
// (payloads exactly as the derivers wrote them from chain logs; see the
// fixture's provenance block), applied through ApplyDerived, the production
// writer. Synthetic rows are used only as page FILLER (borrows, config,
// bookkeeping), never as payload-extraction subjects.

import (
	"context"
	"encoding/hex"
	"encoding/json"
	"math/big"
	"os"
	"path/filepath"
	"strconv"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

// testB1Store is testRiskStore plus the P5 sibling tables this wave reads.
func testB1Store(t *testing.T) *Store {
	t.Helper()
	s := testRiskStore(t)
	_, err := s.pool.Exec(context.Background(), `TRUNCATE block_headers, observatory_points`)
	require.NoError(t, err)
	return s
}

type p5FixtureEvent struct {
	ChainID     uint64            `json:"chain_id"`
	Engine      string            `json:"engine"`
	BlockNumber uint64            `json:"block_number"`
	TxHash      string            `json:"tx_hash"`
	LogIndex    uint32            `json:"log_index"`
	Seq         uint16            `json:"seq"`
	EventType   string            `json:"event_type"`
	Account     string            `json:"account"`
	Asset       string            `json:"asset"`
	Side        string            `json:"side"`
	Delta       *string           `json:"delta"`
	Payload     map[string]string `json:"payload"`
}

func loadP5LiquidationFixture(t *testing.T) []PositionEvent {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join("testdata", "p5_liquidation_rows.json"))
	require.NoError(t, err)
	var doc struct {
		Events []p5FixtureEvent `json:"events"`
	}
	require.NoError(t, json.Unmarshal(raw, &doc))
	require.NotEmpty(t, doc.Events)
	out := make([]PositionEvent, len(doc.Events))
	for i, fe := range doc.Events {
		ev := PositionEvent{
			ChainID: fe.ChainID, Engine: fe.Engine, BlockNumber: fe.BlockNumber,
			TxHash: mustHex(t, fe.TxHash), LogIndex: fe.LogIndex, Seq: fe.Seq,
			EventType: fe.EventType, Account: mustHex(t, fe.Account),
			Asset: mustHex(t, fe.Asset), Side: fe.Side, Payload: fe.Payload,
		}
		if fe.Delta != nil {
			v, ok := new(big.Int).SetString(*fe.Delta, 10)
			require.True(t, ok, "fixture delta %q", *fe.Delta)
			ev.Delta = v
		}
		out[i] = ev
	}
	return out
}

func mustHex(t *testing.T, s string) []byte {
	t.Helper()
	b, err := hex.DecodeString(s)
	require.NoError(t, err)
	return b
}

// p5Tx mints a distinct tx hash for synthetic filler events.
func p5Tx(b byte) []byte {
	h := make([]byte, 32)
	h[0], h[31] = 0x99, b
	return h
}

var (
	p5AccountA = addr20(0xA7) // DM filler account
	p5AccountB = addr20(0xB8) // Aave filler account
	p5AssetUSD = addr20(0xC9)
)

// seedP5Events writes the fixture liquidations plus synthetic filler through
// ApplyDerived (the production position_events writer) and returns the
// account bytes of the DM liquidation's subject.
func seedP5Events(t *testing.T, s *Store) []byte {
	t.Helper()
	ctx := context.Background()
	fixture := loadP5LiquidationFixture(t)
	var dmEvents, aaveEvents []PositionEvent
	var dmLiqAccount []byte
	for _, ev := range fixture {
		switch ev.Engine {
		case EngineDebtManager:
			dmEvents = append(dmEvents, ev)
			if ev.EventType == "liquidation" {
				dmLiqAccount = ev.Account
			}
		case EngineAave:
			aaveEvents = append(aaveEvents, ev)
		}
	}
	require.NotNil(t, dmLiqAccount)

	// DM filler around the captured liquidation (block 153_399_414).
	dmEvents = append(dmEvents,
		PositionEvent{ChainID: 10, Engine: EngineDebtManager, BlockNumber: 153_399_400,
			TxHash: p5Tx(0x01), LogIndex: 5, EventType: "borrow", Account: p5AccountA,
			Asset: p5AssetUSD, Side: "debt", Delta: big.NewInt(100),
			Payload: map[string]string{"usd": "100"}},
		PositionEvent{ChainID: 10, Engine: EngineDebtManager, BlockNumber: 153_399_420,
			TxHash: p5Tx(0x02), LogIndex: 7, EventType: "repay", Account: p5AccountA,
			Asset: p5AssetUSD, Side: "debt", Delta: big.NewInt(-40),
			Payload: map[string]string{"usd": "40"}},
		// Bookkeeping: must NEVER surface in the feed.
		PositionEvent{ChainID: 10, Engine: EngineDebtManager, BlockNumber: 153_399_421,
			TxHash: p5Tx(0x03), LogIndex: 2, EventType: "residue_zeroed", Account: p5AccountA,
			Asset: p5AssetUSD, Side: "debt", Delta: big.NewInt(-1),
			Payload: map[string]string{"residue": "1"}},
		// Config class.
		PositionEvent{ChainID: 10, Engine: EngineDebtManager, BlockNumber: 153_399_425,
			TxHash: p5Tx(0x04), LogIndex: 9, EventType: "borrow_apy_set", Account: []byte{},
			Asset: p5AssetUSD, Payload: map[string]string{"old_apy": "1", "new_apy": "2"}},
	)
	// Aave filler around the captured liquidation (block 24_466_431).
	aaveEvents = append(aaveEvents,
		PositionEvent{ChainID: 1, Engine: EngineAave, BlockNumber: 24_466_400,
			TxHash: p5Tx(0x11), LogIndex: 3, EventType: "aave_borrow", Account: p5AccountB,
			Asset: p5AssetUSD, Side: "debt", Delta: big.NewInt(777),
			Payload: map[string]string{"amount": "777"}},
		// Bookkeeping: must NEVER surface.
		PositionEvent{ChainID: 1, Engine: EngineAave, BlockNumber: 24_466_405,
			TxHash: p5Tx(0x12), LogIndex: 1, EventType: "aave_reserve_data_updated",
			Account: make([]byte, 20), Asset: p5AssetUSD,
			Payload: map[string]string{"variable_borrow_index": "1", "liquidity_index": "1"}},
		PositionEvent{ChainID: 1, Engine: EngineAave, BlockNumber: 24_466_440,
			TxHash: p5Tx(0x13), LogIndex: 8, EventType: AaveCollateralEnabledEvent,
			Account: p5AccountB, Asset: p5AssetUSD},
	)
	require.NoError(t, s.ApplyDerived(ctx, EngineDebtManager, 10, dmEvents, 153_399_425))
	require.NoError(t, s.ApplyDerived(ctx, EngineAave, 1, aaveEvents, 24_466_440))
	return dmLiqAccount
}

// eventKey renders a row compactly for exact-order assertions.
func eventKey(e FeedEvent) string {
	return e.Engine + "/" + e.RawType + "@" + strconv.FormatUint(e.BlockNumber, 10)
}

// Cross-engine page with NO header custody: the whole feed is the untimed
// tail, ordered by the deterministic chain-aware tiebreak (chain_id DESC
// puts OP's rows first here BY TIEBREAK, disclosed as untimed — never
// presented as chronology), and no bookkeeping row appears.
func TestEventsPageOrderingAndBookkeepingFilter(t *testing.T) {
	s := testB1Store(t)
	seedP5Events(t, s)

	res, err := s.EventsPage(context.Background(), EventsFilter{}, "", 50)
	require.NoError(t, err)
	require.Empty(t, res.NextCursor)

	var got []string
	for _, e := range res.Events {
		got = append(got, eventKey(e))
	}
	// NO bookkeeping row (residue_zeroed, aave_reserve_data_updated,
	// atoken_*, liquidation_collateral) appears.
	require.Equal(t, []string{
		"debt_manager/borrow_apy_set@153399425",
		"debt_manager/repay@153399420",
		"debt_manager/liquidation@153399414",
		"debt_manager/borrow@153399400",
		"aave_v3_etherfi/aave_collateral_enabled@24466440",
		"aave_v3_etherfi/aave_liquidation_call@24466431",
		"aave_v3_etherfi/aave_borrow@24466400",
	}, got)

	// Display classes and Delta units ride along; block times are ABSENT
	// (no header custody rows yet), never fabricated.
	require.Equal(t, EventDisplayConfig, res.Events[0].DisplayType)
	require.Equal(t, EventDisplayLiquidation, res.Events[2].DisplayType)
	for _, e := range res.Events {
		require.Nil(t, e.BlockTime, "%s: no header custody exists, so no time may be served", eventKey(e))
	}
}

// The corrected cross-engine chronology law: with header custody present,
// timed rows order by block_time DESC — a MAINNET row whose height (24.4M)
// is dwarfed by OP's (153M) leads the feed when its TIME is newest — and
// untimed rows follow the timed section, ordered by tiebreak alone.
func TestEventsPageCrossEngineChronologyOrdersByHeaderTime(t *testing.T) {
	s := testB1Store(t)
	seedP5Events(t, s)
	ctx := context.Background()

	// Custody three of the seven blocks; times INVERT the height order.
	for _, h := range []struct {
		chain, block uint64
		unix         int64
	}{
		{1, 24_466_440, 1_753_902_000}, // aave collateral flag — NEWEST time
		{10, 153_399_425, 1_753_901_500},
		{10, 153_399_420, 1_753_901_400},
	} {
		up, err := s.UpsertBlockHeader(ctx, BlockHeaderWrite{
			ChainID: h.chain, Block: h.block, Hash: bytes32(byte(h.block)), Time: h.unix})
		require.NoError(t, err)
		require.True(t, up.Stored)
	}

	res, err := s.EventsPage(ctx, EventsFilter{}, "", 50)
	require.NoError(t, err)
	var got []string
	for _, e := range res.Events {
		got = append(got, eventKey(e))
	}
	require.Equal(t, []string{
		// Timed section, block_time DESC — mainnet leads on TIME.
		"aave_v3_etherfi/aave_collateral_enabled@24466440",
		"debt_manager/borrow_apy_set@153399425",
		"debt_manager/repay@153399420",
		// Untimed tail, tiebreak order, ALWAYS after the timed section.
		"debt_manager/liquidation@153399414",
		"debt_manager/borrow@153399400",
		"aave_v3_etherfi/aave_liquidation_call@24466431",
		"aave_v3_etherfi/aave_borrow@24466400",
	}, got)
	require.NotNil(t, res.Events[0].BlockTime)
	require.Nil(t, res.Events[3].BlockTime, "the untimed tail is disclosed, never given an invented time")
}

// Engine-scoped ordering: one engine = one chain, so heights ARE the
// chronology — (block_number, tx, log, seq) DESC, unchanged.
func TestEventsPageEngineScopedOrdering(t *testing.T) {
	s := testB1Store(t)
	seedP5Events(t, s)

	res, err := s.EventsPage(context.Background(), EventsFilter{Engines: []string{EngineDebtManager}}, "", 50)
	require.NoError(t, err)
	var got []string
	for _, e := range res.Events {
		got = append(got, eventKey(e))
	}
	require.Equal(t, []string{
		"debt_manager/borrow_apy_set@153399425",
		"debt_manager/repay@153399420",
		"debt_manager/liquidation@153399414",
		"debt_manager/borrow@153399400",
	}, got)
}

// The Delta unit tags: engine accounting units named per raw type, never
// presented as user token amounts.
func TestEventsPageDeltaUnits(t *testing.T) {
	s := testB1Store(t)
	seedP5Events(t, s)

	res, err := s.EventsPage(context.Background(), EventsFilter{}, "", 50)
	require.NoError(t, err)
	units := map[string]EventAmountUnit{}
	for _, e := range res.Events {
		units[e.Engine+"/"+e.RawType] = e.DeltaUnit
	}
	require.Equal(t, AmountUnitDMNormalizedDebt, units["debt_manager/borrow"])
	require.Equal(t, AmountUnitDMNormalizedDebt, units["debt_manager/liquidation"])
	require.Equal(t, AmountUnitNone, units["debt_manager/borrow_apy_set"])
	require.Equal(t, AmountUnitAaveScaled, units["aave_v3_etherfi/aave_borrow"])
	require.Equal(t, AmountUnitAaveScaled, units["aave_v3_etherfi/aave_liquidation_call"])
	require.Equal(t, AmountUnitNone, units["aave_v3_etherfi/aave_collateral_enabled"])
}

// Keyset pagination exactness in BOTH modes, including the cross-engine walk
// across the timed→untimed boundary.
func TestEventsPageKeysetPaginationIsExact(t *testing.T) {
	s := testB1Store(t)
	seedP5Events(t, s)
	ctx := context.Background()

	// Custody a subset so the cross-engine walk crosses the boundary.
	for _, h := range []struct {
		chain, block uint64
		unix         int64
	}{
		{1, 24_466_440, 1_753_902_000},
		{10, 153_399_425, 1_753_901_500},
		{10, 153_399_420, 1_753_901_400},
	} {
		_, err := s.UpsertBlockHeader(ctx, BlockHeaderWrite{
			ChainID: h.chain, Block: h.block, Hash: bytes32(byte(h.block)), Time: h.unix})
		require.NoError(t, err)
	}

	for name, filter := range map[string]EventsFilter{
		"cross-engine":  {},
		"engine-scoped": {Engines: []string{EngineDebtManager}},
	} {
		t.Run(name, func(t *testing.T) {
			full, err := s.EventsPage(ctx, filter, "", 50)
			require.NoError(t, err)
			require.NotEmpty(t, full.Events)

			var walked []string
			cursor := ""
			pages := 0
			for {
				page, err := s.EventsPage(ctx, filter, cursor, 2)
				require.NoError(t, err)
				for _, e := range page.Events {
					walked = append(walked, eventKey(e))
				}
				pages++
				require.LessOrEqual(t, pages, 10, "pagination did not terminate")
				if page.NextCursor == "" {
					break
				}
				cursor = page.NextCursor
			}
			var want []string
			for _, e := range full.Events {
				want = append(want, eventKey(e))
			}
			require.Equal(t, want, walked, "page union must equal the full feed — no duplicate, no gap")
		})
	}
}

// Engine-scoped and cross-engine cursors rank by different keys: replaying
// one against the other mode is refused, never silently re-ranked.
func TestEventsPageCursorModesAreNotInterchangeable(t *testing.T) {
	s := testB1Store(t)
	seedP5Events(t, s)
	ctx := context.Background()

	scoped, err := s.EventsPage(ctx, EventsFilter{Engines: []string{EngineDebtManager}}, "", 2)
	require.NoError(t, err)
	require.NotEmpty(t, scoped.NextCursor)
	_, err = s.EventsPage(ctx, EventsFilter{}, scoped.NextCursor, 2)
	require.ErrorContains(t, err, "not interchangeable")

	cross, err := s.EventsPage(ctx, EventsFilter{}, "", 2)
	require.NoError(t, err)
	require.NotEmpty(t, cross.NextCursor)
	_, err = s.EventsPage(ctx, EventsFilter{Engines: []string{EngineDebtManager}}, cross.NextCursor, 2)
	require.ErrorContains(t, err, "not interchangeable")
}

func TestEventsPageFilters(t *testing.T) {
	s := testB1Store(t)
	dmLiqAccount := seedP5Events(t, s)
	ctx := context.Background()

	t.Run("engine", func(t *testing.T) {
		res, err := s.EventsPage(ctx, EventsFilter{Engines: []string{EngineAave}}, "", 50)
		require.NoError(t, err)
		require.Len(t, res.Events, 3)
		for _, e := range res.Events {
			require.Equal(t, EngineAave, e.Engine)
		}
	})
	t.Run("account", func(t *testing.T) {
		res, err := s.EventsPage(ctx, EventsFilter{Account: dmLiqAccount}, "", 50)
		require.NoError(t, err)
		require.Len(t, res.Events, 1)
		require.Equal(t, "liquidation", res.Events[0].RawType)
	})
	t.Run("display types", func(t *testing.T) {
		res, err := s.EventsPage(ctx, EventsFilter{DisplayTypes: []EventDisplayClass{EventDisplayLiquidation}}, "", 50)
		require.NoError(t, err)
		require.Len(t, res.Events, 2)
		require.Equal(t, "liquidation", res.Events[0].RawType)
		require.Equal(t, "aave_liquidation_call", res.Events[1].RawType)
	})
	t.Run("since block is engine-scoped only", func(t *testing.T) {
		since := uint64(153_399_414)
		// Cross-engine: a height bound over incomparable chains is refused.
		_, err := s.EventsPage(ctx, EventsFilter{SinceBlock: &since}, "", 50)
		require.ErrorContains(t, err, "exactly one engine")
		// Engine-scoped: heights are comparable, the bound is honest.
		res, err := s.EventsPage(ctx, EventsFilter{
			Engines: []string{EngineDebtManager}, SinceBlock: &since}, "", 50)
		require.NoError(t, err)
		require.Len(t, res.Events, 3) // 153399425, 153399420, 153399414
	})
	t.Run("well-formed but empty selection", func(t *testing.T) {
		res, err := s.EventsPage(ctx, EventsFilter{
			Engines: []string{EngineAave}, DisplayTypes: []EventDisplayClass{EventDisplayMigration}}, "", 50)
		require.NoError(t, err)
		require.Empty(t, res.Events)
	})
	t.Run("refusals", func(t *testing.T) {
		_, err := s.EventsPage(ctx, EventsFilter{Engines: []string{"aave"}}, "", 50)
		require.ErrorContains(t, err, "unknown engine")
		_, err = s.EventsPage(ctx, EventsFilter{DisplayTypes: []EventDisplayClass{"swap"}}, "", 50)
		require.ErrorContains(t, err, "unknown display type")
		_, err = s.EventsPage(ctx, EventsFilter{}, "", 0)
		require.ErrorContains(t, err, "limit must be positive")
		_, err = s.EventsPage(ctx, EventsFilter{}, "not-a-cursor!!", 5)
		require.Error(t, err)
	})
}

// The liquidation detail extraction, against the CAPTURED rows: every value
// asserted below is the deriver's own recorded payload from the real chain
// events (see the fixture provenance), not hand-built JSON.
func TestEventsPageLiquidationDetailFromCapturedRows(t *testing.T) {
	s := testB1Store(t)
	seedP5Events(t, s)

	res, err := s.EventsPage(context.Background(),
		EventsFilter{DisplayTypes: []EventDisplayClass{EventDisplayLiquidation}}, "", 10)
	require.NoError(t, err)
	require.Len(t, res.Events, 2)

	dm, aave := res.Events[0], res.Events[1]
	require.Equal(t, EngineDebtManager, dm.Engine)
	require.Equal(t, EngineAave, aave.Engine)

	t.Run("debt_manager", func(t *testing.T) {
		d := dm.Liquidation
		require.NotNil(t, d)
		require.Equal(t, "0x7d829d50aaf400b8b29b3b311f4ad70ad819dc6e", d.Liquidator)
		require.Equal(t, "179038", d.DebtRepaidUSD.String())
		require.Equal(t, "358077", d.BeforeDebtUSD.String())
		require.Equal(t, "1040759558956902860", d.InterestIndex.String())
		// The full seize vector: 13 tuple elements, seq order 1..13, the
		// zero-amount elements PRESERVED (the contract emitted them; dropping
		// them would misstate the event's shape).
		require.Len(t, d.Seized, 13)
		for i, sz := range d.Seized {
			require.Equal(t, uint16(i+1), sz.Seq)
		}
		last := d.Seized[12]
		require.Equal(t, "f0bb20865277abd641a307ece5ee04e79073416c", hex.EncodeToString(last.Asset))
		require.Equal(t, "109428055803643", last.Amount.String())
		require.Equal(t, "5210859800173", last.Bonus.String())
		require.Equal(t, "0", d.Seized[0].Amount.String())
		// Aave-only fields stay empty on a DM detail.
		require.Nil(t, d.DebtToCover)
		require.Nil(t, d.CollateralAsset)
	})
	t.Run("aave", func(t *testing.T) {
		d := aave.Liquidation
		require.NotNil(t, d)
		require.Equal(t, "0x36331E299247E5D0D3261e1d9852f6E0cFFEe95C", d.Liquidator)
		require.Equal(t, "2429404", d.DebtToCover.String())
		require.Equal(t, "1201164823925659", d.LiquidatedCollateralAmount.String())
		require.Equal(t, "cd5fe23c85820f7b72d0926fc9b05b43e359b7ee", hex.EncodeToString(d.CollateralAsset))
		require.NotNil(t, d.ReceiveAToken)
		require.False(t, *d.ReceiveAToken)
		require.True(t, d.DeficitPaired)
		// DM-only fields stay empty on an Aave detail.
		require.Nil(t, d.DebtRepaidUSD)
		require.Empty(t, d.Seized)
	})
	t.Run("non-liquidation rows carry no detail", func(t *testing.T) {
		full, err := s.EventsPage(context.Background(), EventsFilter{}, "", 50)
		require.NoError(t, err)
		for _, e := range full.Events {
			if e.DisplayType != EventDisplayLiquidation {
				require.Nil(t, e.Liquidation, eventKey(e))
			}
		}
	})
}

// Header-time enrichment: a custodied block serves its chain-asserted time,
// an uncustodied one serves nil — never an invented value.
func TestEventsPageBlockTimeEnrichment(t *testing.T) {
	s := testB1Store(t)
	seedP5Events(t, s)
	ctx := context.Background()

	// Custody one block via the B2 writer (hash-validation happens in the
	// caller; the writer stores what it is given).
	const liqUnix = int64(1_753_900_000)
	up, err := s.UpsertBlockHeader(ctx, BlockHeaderWrite{
		ChainID: 10, Block: 153_399_414, Hash: bytes32(0xAB), Time: liqUnix})
	require.NoError(t, err)
	require.True(t, up.Stored)

	res, err := s.EventsPage(ctx, EventsFilter{}, "", 50)
	require.NoError(t, err)
	found := false
	for _, e := range res.Events {
		if e.ChainID == 10 && e.BlockNumber == 153_399_414 {
			require.NotNil(t, e.BlockTime)
			require.Equal(t, time.Unix(liqUnix, 0).UTC(), *e.BlockTime)
			found = true
		} else {
			require.Nil(t, e.BlockTime, eventKey(e))
		}
	}
	require.True(t, found, "the custodied block's row must be in the page")
}

func bytes32(b byte) []byte {
	h := make([]byte, 32)
	h[31] = b
	return h
}
