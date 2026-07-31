package store

// P5 Task B1 live-db tests for PositionsPage / BatchStillNewestServable:
// engine-aware sort semantics, deterministic tiebreaks, rank-cursor
// pagination exactness, and — the behavioural core — BATCH STABILITY under a
// concurrent newer batch (the wave's first named mutant).

import (
	"context"
	"encoding/hex"
	"math/big"
	"testing"

	"github.com/stretchr/testify/require"
)

// p5Book builds one complete batch whose per-engine orderings are known by
// construction. Accounts are named by their intended liq_distance order.
func p5Book(retention int) RiskBatchWrite {
	w := RiskBatchWrite{
		Producer: "p5-b1-test", Retention: retention,
		MaterializationKey: newTestKey(),
		Watermarks: []RiskBatchWatermark{
			{Engine: riskAaveEngine, ChainID: 1, LastBlock: 25_000_000, AckedEpoch: 1, MaxEpochAtCompute: 1},
			{Engine: riskDMEngine, ChainID: 10, LastBlock: 155_000_000, AckedEpoch: 2, MaxEpochAtCompute: 2},
		},
		Positions: []RiskPositionWrite{
			// Aave: A1 (hf 1.05) and A5 (hf 1.05, higher account bytes) tie —
			// account ASC breaks it; A2 (hf 2.0); A3 zero-debt (infinite);
			// A4 refused.
			{Engine: riskAaveEngine, Account: addr20(0x01), Status: RiskPositionComputed, ValueDecimals: 8,
				HFNum: big.NewInt(105), HFDen: big.NewInt(100), HFWad: bigStr("1050000000000000000"),
				TotalCollateralBase: bigStr("300000000000"), TotalDebtBase: bigStr("200000000000"),
				BalancesBlock: 25_000_000, ParamsBlock: 25_000_000},
			{Engine: riskAaveEngine, Account: addr20(0x05), Status: RiskPositionComputed, ValueDecimals: 8,
				HFNum: big.NewInt(105), HFDen: big.NewInt(100), HFWad: bigStr("1050000000000000000"),
				TotalCollateralBase: bigStr("100000000000"), TotalDebtBase: bigStr("50000000000"),
				BalancesBlock: 25_000_000, ParamsBlock: 25_000_000},
			{Engine: riskAaveEngine, Account: addr20(0x02), Status: RiskPositionComputed, ValueDecimals: 8,
				HFNum: big.NewInt(2), HFDen: big.NewInt(1), HFWad: bigStr("2000000000000000000"),
				TotalCollateralBase: bigStr("900000000000"), TotalDebtBase: bigStr("400000000000"),
				BalancesBlock: 25_000_000, ParamsBlock: 25_000_000},
			{Engine: riskAaveEngine, Account: addr20(0x03), Status: RiskPositionComputed, ValueDecimals: 8,
				HFInfinite: true, TotalCollateralBase: bigStr("50000000000"),
				BalancesBlock: 25_000_000, ParamsBlock: 25_000_000},
			{Engine: riskAaveEngine, Account: addr20(0x04), Status: RiskPositionRefused,
				RefusalCode: "G1", RefusalDetail: "price budget exceeded", ValueDecimals: 8,
				BalancesBlock: 25_000_000, ParamsBlock: 25_000_000},

			// DM: D1 liquidatable (headroom -100), D2 near (headroom +100),
			// D6 safest (headroom +1000), D3 refused.
			{Engine: riskDMEngine, Account: addr20(0x11), Status: RiskPositionComputed, ValueDecimals: 6,
				CollateralValueUSD: bigStr("2000"), MaxBorrowLT: bigStr("900"), Borrowings: bigStr("1000"),
				Liquidatable: boolp(true), BalancesBlock: 155_000_000, ParamsBlock: 155_000_000},
			{Engine: riskDMEngine, Account: addr20(0x12), Status: RiskPositionComputed, ValueDecimals: 6,
				CollateralValueUSD: bigStr("1500"), MaxBorrowLT: bigStr("600"), Borrowings: bigStr("500"),
				Liquidatable: boolp(false), BalancesBlock: 155_000_000, ParamsBlock: 155_000_000},
			{Engine: riskDMEngine, Account: addr20(0x16), Status: RiskPositionComputed, ValueDecimals: 6,
				CollateralValueUSD: bigStr("9000"), MaxBorrowLT: bigStr("1200"), Borrowings: bigStr("200"),
				Liquidatable: boolp(false), BalancesBlock: 155_000_000, ParamsBlock: 155_000_000},
			{Engine: riskDMEngine, Account: addr20(0x13), Status: RiskPositionRefused,
				RefusalCode: "SWEEP_NEVER", RefusalDetail: "collateral never read", ValueDecimals: 6,
				BalancesBlock: 155_000_000, ParamsBlock: 155_000_000},
		},
		Aggregates: []RiskEngineAggregate{
			{Engine: riskAaveEngine, ValueDecimals: 8, Positions: 5, ComputedPositions: 4, RefusedPositions: 1,
				TotalCollateral: bigStr("1350000000000"), TotalDebt: bigStr("650000000000")},
			{Engine: riskDMEngine, ValueDecimals: 6, Positions: 4, ComputedPositions: 3, RefusedPositions: 1,
				LiquidatablePositions: 1, TotalCollateral: bigStr("12500"), TotalDebt: bigStr("1700")},
		},
	}
	return w
}

func pageAccounts(res PositionsPageResult) []string {
	var out []string
	for _, p := range res.Positions {
		out = append(out, hex.EncodeToString(p.Account[19:]))
	}
	return out
}

func TestPositionsPageSortSemantics(t *testing.T) {
	s := testB1Store(t)
	ctx := context.Background()
	batchID, err := s.WriteRiskBatch(ctx, p5Book(10))
	require.NoError(t, err)

	cases := []struct {
		name   string
		engine string
		sort   PositionSort
		want   []string
	}{
		// Aave liq_distance: the 1.05 tie breaks by account (01 before 05);
		// infinite-HF after finite; refused last.
		{"aave liq_distance", riskAaveEngine, PositionSortLiqDistance, []string{"01", "05", "02", "03", "04"}},
		{"aave hf", riskAaveEngine, PositionSortHF, []string{"01", "05", "02", "03", "04"}},
		// Aave debt DESC: 02 (400) > 01 (200) > 05 (50) > 03 (zero-debt, NULL
		// debt sorts after values) > refused.
		{"aave debt", riskAaveEngine, PositionSortDebt, []string{"02", "01", "05", "03", "04"}},
		// Aave status: refused FIRST for triage, then risk order.
		{"aave status", riskAaveEngine, PositionSortStatus, []string{"04", "01", "05", "02", "03"}},
		// DM liq_distance: headroom ASC — liquidatable (-100), near (+100),
		// safe (+1000), refused last.
		{"dm liq_distance", riskDMEngine, PositionSortLiqDistance, []string{"11", "12", "16", "13"}},
		{"dm debt", riskDMEngine, PositionSortDebt, []string{"11", "12", "16", "13"}},
		{"dm status", riskDMEngine, PositionSortStatus, []string{"13", "11", "12", "16"}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			res, err := s.PositionsPage(ctx, batchID, tc.engine, tc.sort, "", 50)
			require.NoError(t, err)
			require.Equal(t, tc.want, pageAccounts(res))
			require.Empty(t, res.NextCursor)
			require.Equal(t, batchID, res.BatchID)
		})
	}

	t.Run("hf on debt_manager is refused, not invented", func(t *testing.T) {
		_, err := s.PositionsPage(ctx, batchID, riskDMEngine, PositionSortHF, "", 50)
		require.ErrorIs(t, err, ErrPositionsSortUnsupported)
	})
	t.Run("unknown engine / sort / limit", func(t *testing.T) {
		_, err := s.PositionsPage(ctx, batchID, "aave", PositionSortDebt, "", 50)
		require.ErrorContains(t, err, "unknown engine")
		_, err = s.PositionsPage(ctx, batchID, riskAaveEngine, "size", "", 50)
		require.ErrorContains(t, err, "unknown sort")
		_, err = s.PositionsPage(ctx, batchID, riskAaveEngine, PositionSortDebt, "", 0)
		require.ErrorContains(t, err, "limit must be positive")
	})

	// Refusal rows stay first-class: visible, code carried.
	res, err := s.PositionsPage(ctx, batchID, riskAaveEngine, PositionSortStatus, "", 1)
	require.NoError(t, err)
	require.Equal(t, "refused", res.Positions[0].Status)
	require.Equal(t, "G1", res.Positions[0].RefusalCode)
}

func TestPositionsPagePaginationIsExact(t *testing.T) {
	s := testB1Store(t)
	ctx := context.Background()
	batchID, err := s.WriteRiskBatch(ctx, p5Book(10))
	require.NoError(t, err)

	full, err := s.PositionsPage(ctx, batchID, riskAaveEngine, PositionSortLiqDistance, "", 50)
	require.NoError(t, err)

	var walked []string
	cursor := ""
	for {
		page, err := s.PositionsPage(ctx, batchID, riskAaveEngine, PositionSortLiqDistance, cursor, 2)
		require.NoError(t, err)
		walked = append(walked, pageAccounts(page)...)
		if page.NextCursor == "" {
			break
		}
		require.Equal(t, batchID, mustCursorBatch(t, page.NextCursor))
		cursor = page.NextCursor
	}
	require.Equal(t, pageAccounts(full), walked)
}

func mustCursorBatch(t *testing.T, cursor string) int64 {
	t.Helper()
	id, err := PositionsCursorBatch(cursor)
	require.NoError(t, err)
	return id
}

func TestPositionsPageCursorIsNotInterchangeable(t *testing.T) {
	s := testB1Store(t)
	ctx := context.Background()
	batchID, err := s.WriteRiskBatch(ctx, p5Book(10))
	require.NoError(t, err)

	page, err := s.PositionsPage(ctx, batchID, riskAaveEngine, PositionSortLiqDistance, "", 2)
	require.NoError(t, err)
	require.NotEmpty(t, page.NextCursor)

	// Different sort: silently re-ranking under the old rank would produce a
	// garbage page — refused.
	_, err = s.PositionsPage(ctx, batchID, riskAaveEngine, PositionSortDebt, page.NextCursor, 2)
	require.ErrorIs(t, err, ErrPositionsCursorMismatch)
	// Different engine.
	_, err = s.PositionsPage(ctx, batchID, riskDMEngine, PositionSortLiqDistance, page.NextCursor, 2)
	require.ErrorIs(t, err, ErrPositionsCursorMismatch)
	// Different batch.
	_, err = s.PositionsPage(ctx, batchID+1, riskAaveEngine, PositionSortLiqDistance, page.NextCursor, 2)
	require.ErrorIs(t, err, ErrPositionsCursorMismatch)
	// Foreign cursor (another reader's tag).
	_, err = s.PositionsPage(ctx, batchID, riskAaveEngine, PositionSortLiqDistance,
		p5EncodeCursor("p5ev1", "1", "2", "aa", "3", "4"), 2)
	require.Error(t, err)
}

// THE BATCH-STABILITY LAW (named mutant M1): a newer batch arriving between
// two pages of one pagination must change NOTHING about the walk — the
// cursor pins the batch, so the union of pages equals the PINNED batch's
// ordering exactly, and none of the newer batch's rows leak in.
func TestPositionsPageIsBatchStableUnderConcurrentNewerBatch(t *testing.T) {
	s := testB1Store(t)
	ctx := context.Background()
	batch1, err := s.WriteRiskBatch(ctx, p5Book(10))
	require.NoError(t, err)

	full, err := s.PositionsPage(ctx, batch1, riskAaveEngine, PositionSortLiqDistance, "", 50)
	require.NoError(t, err)

	// Page 1 of the pinned batch.
	page1, err := s.PositionsPage(ctx, batch1, riskAaveEngine, PositionSortLiqDistance, "", 2)
	require.NoError(t, err)
	require.NotEmpty(t, page1.NextCursor)

	// A NEWER batch lands mid-pagination, with a composition designed so
	// that EVERY rank beyond the already-served page differs from the pinned
	// batch's: a new hottest account (0x00) shifts all ranks, AND A2's HF
	// moves (2.0 → 1.02) so the tail order itself changes — an unpinned
	// implementation cannot reproduce the pinned walk even by coincidence.
	w2 := p5Book(10)
	w2.Positions = append([]RiskPositionWrite{{
		Engine: riskAaveEngine, Account: addr20(0x00), Status: RiskPositionComputed, ValueDecimals: 8,
		HFNum: big.NewInt(101), HFDen: big.NewInt(100), HFWad: bigStr("1010000000000000000"),
		TotalCollateralBase: bigStr("100000000000"), TotalDebtBase: bigStr("90000000000"),
		BalancesBlock: 25_000_100, ParamsBlock: 25_000_100,
	}}, w2.Positions...)
	for i := range w2.Positions {
		if w2.Positions[i].Engine == riskAaveEngine && w2.Positions[i].Account[19] == 0x02 {
			w2.Positions[i].HFNum = big.NewInt(102)
			w2.Positions[i].HFDen = big.NewInt(100)
			w2.Positions[i].HFWad = bigStr("1020000000000000000")
		}
	}
	w2.Aggregates[0].Positions = 6
	w2.Aggregates[0].ComputedPositions = 5
	batch2, err := s.WriteRiskBatch(ctx, w2)
	require.NoError(t, err)
	require.Greater(t, batch2, batch1)

	// The walk continues on the PINNED batch, undisturbed.
	page2, err := s.PositionsPage(ctx, batch1, riskAaveEngine, PositionSortLiqDistance, page1.NextCursor, 2)
	require.NoError(t, err)
	page3, err := s.PositionsPage(ctx, batch1, riskAaveEngine, PositionSortLiqDistance, page2.NextCursor, 2)
	require.NoError(t, err)
	walked := append(append(pageAccounts(page1), pageAccounts(page2)...), pageAccounts(page3)...)
	require.Equal(t, pageAccounts(full), walked,
		"pages after the newer batch landed must continue the PINNED batch exactly — no leaked rows, no re-ranking")
	for _, acct := range walked {
		require.NotEqual(t, "00", acct, "a row from the newer batch leaked into the pinned pagination")
	}

	// And the supersession probe tells the caller to restart.
	still, err := s.BatchStillNewestServable(ctx, batch1)
	require.NoError(t, err)
	require.False(t, still, "batch1 is superseded")
	still, err = s.BatchStillNewestServable(ctx, batch2)
	require.NoError(t, err)
	require.True(t, still)
}

// A pruned pinned batch is a typed refusal, never an empty page pretending
// the book is empty.
func TestPositionsPagePrunedBatchRefusesLoudly(t *testing.T) {
	s := testB1Store(t)
	ctx := context.Background()
	batch1, err := s.WriteRiskBatch(ctx, p5Book(10))
	require.NoError(t, err)
	// Retention 1 prunes batch1 when batch2 lands.
	_, err = s.WriteRiskBatch(ctx, p5Book(1))
	require.NoError(t, err)

	_, err = s.PositionsPage(ctx, batch1, riskAaveEngine, PositionSortLiqDistance, "", 2)
	require.ErrorIs(t, err, ErrPositionsBatchMissing)
}

func TestBatchStillNewestServableWithNoBatches(t *testing.T) {
	s := testB1Store(t)
	still, err := s.BatchStillNewestServable(context.Background(), 1)
	require.NoError(t, err)
	require.False(t, still)
}
