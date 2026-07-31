package store

// P5 Task B1 live-db tests for AddressHistory: newest-first per-batch
// points, refusal carried per point, batch-count limit semantics, engine
// separation, and the completeness gate (a torn batch's points never serve).

import (
	"context"
	"math/big"
	"testing"

	"github.com/stretchr/testify/require"
)

var p5HistAccount = addr20(0x77)

// p5HistBatch writes one complete batch holding p5HistAccount with the given
// aave HF wad (nil = refused), plus optionally a DM row for the same account.
func p5HistBatch(t *testing.T, s *Store, hfWad *big.Int, withDM bool) int64 {
	t.Helper()
	w := RiskBatchWrite{
		Producer: "p5-b1-hist", Retention: 50, MaterializationKey: newTestKey(),
		Watermarks: []RiskBatchWatermark{
			{Engine: riskAaveEngine, ChainID: 1, LastBlock: 25_000_000, AckedEpoch: 1, MaxEpochAtCompute: 1},
			{Engine: riskDMEngine, ChainID: 10, LastBlock: 155_000_000, AckedEpoch: 2, MaxEpochAtCompute: 2},
		},
	}
	if hfWad != nil {
		w.Positions = append(w.Positions, RiskPositionWrite{
			Engine: riskAaveEngine, Account: p5HistAccount, Status: RiskPositionComputed, ValueDecimals: 8,
			HFNum: new(big.Int).Set(hfWad), HFDen: bigStr("1000000000000000000"), HFWad: new(big.Int).Set(hfWad),
			TotalCollateralBase: bigStr("300000000000"), TotalDebtBase: bigStr("100000000000"),
			BalancesBlock: 25_000_000, ParamsBlock: 25_000_000,
		})
	} else {
		w.Positions = append(w.Positions, RiskPositionWrite{
			Engine: riskAaveEngine, Account: p5HistAccount, Status: RiskPositionRefused,
			RefusalCode: "G1", RefusalDetail: "price budget exceeded", ValueDecimals: 8,
			BalancesBlock: 25_000_000, ParamsBlock: 25_000_000,
		})
	}
	// An unrelated account rides along in every batch: history must never
	// leak it.
	w.Positions = append(w.Positions, RiskPositionWrite{
		Engine: riskAaveEngine, Account: addr20(0x88), Status: RiskPositionComputed, ValueDecimals: 8,
		HFInfinite: true, BalancesBlock: 25_000_000, ParamsBlock: 25_000_000,
	})
	if withDM {
		w.Positions = append(w.Positions, RiskPositionWrite{
			Engine: riskDMEngine, Account: p5HistAccount, Status: RiskPositionComputed, ValueDecimals: 6,
			CollateralValueUSD: bigStr("2000"), MaxBorrowLT: bigStr("900"), Borrowings: bigStr("400"),
			Liquidatable: boolp(false), BalancesBlock: 155_000_000, ParamsBlock: 155_000_000,
		})
	}
	aave := RiskEngineAggregate{Engine: riskAaveEngine, ValueDecimals: 8, Positions: 2}
	if hfWad != nil {
		aave.ComputedPositions = 2
		aave.TotalCollateral, aave.TotalDebt = bigStr("300000000000"), bigStr("100000000000")
	} else {
		aave.ComputedPositions, aave.RefusedPositions = 1, 1
		aave.TotalCollateral, aave.TotalDebt = new(big.Int), new(big.Int)
	}
	w.Aggregates = []RiskEngineAggregate{aave}
	if withDM {
		w.Aggregates = append(w.Aggregates, RiskEngineAggregate{
			Engine: riskDMEngine, ValueDecimals: 6, Positions: 1, ComputedPositions: 1,
			TotalCollateral: bigStr("2000"), TotalDebt: bigStr("400")})
	}
	id, err := s.WriteRiskBatch(context.Background(), w)
	require.NoError(t, err)
	return id
}

func TestAddressHistoryNewestFirstWithRefusalsAndEngines(t *testing.T) {
	s := testB1Store(t)
	ctx := context.Background()

	b1 := p5HistBatch(t, s, bigStr("2000000000000000000"), false) // hf 2.0
	b2 := p5HistBatch(t, s, nil, false)                           // refused
	b3 := p5HistBatch(t, s, bigStr("1500000000000000000"), true)  // hf 1.5 + DM row

	points, err := s.AddressHistory(ctx, p5HistAccount, 500)
	require.NoError(t, err)
	require.Len(t, points, 4) // b3: aave+dm, b2: refused aave, b1: aave

	// Newest first; engine ASC within a batch.
	require.Equal(t, b3, points[0].BatchID)
	require.Equal(t, riskAaveEngine, points[0].Position.Engine)
	require.Equal(t, "1500000000000000000", points[0].Position.HFWad.String())
	require.Equal(t, b3, points[1].BatchID)
	require.Equal(t, riskDMEngine, points[1].Position.Engine)
	require.Equal(t, "400", points[1].Position.Borrowings.String())

	// The refusal point is a POINT, not a gap, and carries its code.
	require.Equal(t, b2, points[2].BatchID)
	require.Equal(t, "refused", points[2].Position.Status)
	require.Equal(t, "G1", points[2].Position.RefusalCode)
	require.Nil(t, points[2].Position.HFWad)

	require.Equal(t, b1, points[3].BatchID)
	require.Equal(t, "2000000000000000000", points[3].Position.HFWad.String())

	// computed_at is stamped on every point.
	for _, p := range points {
		require.False(t, p.ComputedAt.IsZero())
	}

	// The unrelated account never leaks in.
	for _, p := range points {
		require.Equal(t, p5HistAccount, p.Position.Account)
	}
}

func TestAddressHistoryLimitCountsBatchesNotRows(t *testing.T) {
	s := testB1Store(t)
	ctx := context.Background()

	p5HistBatch(t, s, bigStr("2000000000000000000"), false)
	b2 := p5HistBatch(t, s, bigStr("1800000000000000000"), true) // 2 rows
	b3 := p5HistBatch(t, s, bigStr("1500000000000000000"), false)

	points, err := s.AddressHistory(ctx, p5HistAccount, 2)
	require.NoError(t, err)
	// 2 BATCHES: b3 (1 row) + b2 (2 rows) = 3 points; b1 excluded.
	require.Len(t, points, 3)
	require.Equal(t, b3, points[0].BatchID)
	require.Equal(t, b2, points[1].BatchID)
	require.Equal(t, b2, points[2].BatchID)
}

// The completeness gate: a batch torn AFTER commit (partial restore, manual
// surgery) must drop out of history exactly as it drops out of every other
// serving path.
func TestAddressHistoryExcludesTornBatches(t *testing.T) {
	s := testB1Store(t)
	ctx := context.Background()

	b1 := p5HistBatch(t, s, bigStr("2000000000000000000"), false)
	b2 := p5HistBatch(t, s, bigStr("1500000000000000000"), false)

	// Tear b2: declared cardinality no longer matches actual children.
	_, err := s.pool.Exec(ctx, `UPDATE risk_batches SET position_count = position_count + 1 WHERE id = $1`, b2)
	require.NoError(t, err)

	points, err := s.AddressHistory(ctx, p5HistAccount, 500)
	require.NoError(t, err)
	require.Len(t, points, 1)
	require.Equal(t, b1, points[0].BatchID)
}

func TestAddressHistoryValidation(t *testing.T) {
	s := testB1Store(t)
	_, err := s.AddressHistory(context.Background(), nil, 10)
	require.ErrorContains(t, err, "account is required")
	_, err = s.AddressHistory(context.Background(), p5HistAccount, 0)
	require.ErrorContains(t, err, "limit must be positive")
}

func TestAddressHistoryUnknownAccountIsEmpty(t *testing.T) {
	s := testB1Store(t)
	p5HistBatch(t, s, bigStr("2000000000000000000"), false)
	points, err := s.AddressHistory(context.Background(), addr20(0xFF), 10)
	require.NoError(t, err)
	require.Empty(t, points)
}
