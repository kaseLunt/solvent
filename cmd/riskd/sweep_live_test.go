package main

// The sweep leg of the recompute trigger, end to end against a live database.
//
// EVERY DERIVE CURSOR AND EVERY REORG EPOCH IS HELD ABSOLUTELY FIXED in these
// tests, and asserted so. The only thing that moves is `snapshot_sweeps`, which
// is what `ApplySweepBatch` moves in production — no cursor, no epoch. So a
// trigger that watched only cursors returns "nothing changed" for every scenario
// below, and the corresponding wrong answer stays published:
//
//	first success after never-swept → a SWEEP_NEVER refusal stands over
//	                                  collateral that is now KNOWN
//	failure after a prior success   → the previous UNFLAGGED result stands with
//	                                  no staleness disclosure on it
//
// Both are wrong answers to an honest operator, and neither heals until some
// unrelated cursor happens to move.

import (
	"context"
	"math/big"
	"testing"
	"time"

	"github.com/stretchr/testify/require"

	"github.com/kaselunt/solvent/internal/risk"
	"github.com/kaselunt/solvent/internal/riskfeed"
	"github.com/kaselunt/solvent/internal/store"
)

const (
	fxDMDebtToken  = "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85" // USDC (OP)
	fxDMCollateral = "0x5A7fACB970D094B6C7FF1df0eA68D99E6e73CBFF" // weETH (OP)
	fxDMBlock      = uint64(154_796_552)
)

// seedDMPosition lands one Debt Manager borrower with debt and swept collateral
// rows, plus its params and price — everything except the sweep STATUS row, which
// each test controls.
func (f *riskdFixture) seedDMPosition(t *testing.T) {
	t.Helper()
	debt := common20(fxDMDebtToken)
	coll := common20(fxDMCollateral)

	require.NoError(t, f.store.ApplyDerivedWithRates(f.ctx, risk.DMEngine, 10,
		[]store.PositionEvent{
			{ChainID: 10, Engine: risk.DMEngine, BlockNumber: fxDMBlock, TxHash: []byte{0x21}, LogIndex: 0,
				EventType: "borrowed", Account: fxAcct.Bytes(), Asset: debt,
				Side: "debt", Delta: mustBig("1000000000")},
			// The DM param ledger lives in position_events (chain-truth R3).
			{ChainID: 10, Engine: risk.DMEngine, BlockNumber: 150_000_000, TxHash: []byte{0x22}, LogIndex: 0,
				EventType: "collateral_token_config_set", Account: []byte{}, Asset: coll,
				Payload: map[string]string{
					"ltv":                   "80000000000000000000",
					"liquidation_threshold": "85000000000000000000",
					"liquidation_bonus":     "1000000000000000000",
				}},
		},
		[]store.RateObservation{
			{Asset: debt, Block: 154_700_000, Kind: "borrow_index", Value: mustBig("1000000000000000000")},
		},
		fxDMBlock))

	// The swept collateral balance (source 'snapshot', as ApplySweepBatch writes).
	_, err := f.admin.Exec(f.ctx, `INSERT INTO position_balances
		(engine, account, asset, side, source, amount, updated_block)
		VALUES ($1, $2, $3, 'collateral', 'snapshot', 1000000000000000000, 154790000)`,
		risk.DMEngine, fxAcct.Bytes(), coll)
	require.NoError(t, err)

	// The OP price poller's row and cursor.
	_, err = f.store.ApplyPolledPrices(f.ctx, "prices:poll:10", 10, []store.PriceObservation{
		{Asset: coll, Source: "priceproviderv2", Price: mustBig("3000000000"), Decimals: 6,
			BlockNumber: 154_790_000, SourceAsOf: time.Now().UTC()},
	}, 154_790_000, store.PollAnchor{BlockNumber: 154_790_000, BlockHash: hash32(0x10)})
	require.NoError(t, err)
}

func common20(hexAddr string) []byte {
	b := make([]byte, 20)
	// Strip "0x" then decode; the fixture addresses are well-formed literals.
	src := hexAddr[2:]
	for i := 0; i < 20; i++ {
		hi := hexNibble(src[2*i])
		lo := hexNibble(src[2*i+1])
		b[i] = hi<<4 | lo
	}
	return b
}

func hexNibble(c byte) byte {
	switch {
	case c >= '0' && c <= '9':
		return c - '0'
	case c >= 'a' && c <= 'f':
		return c - 'a' + 10
	case c >= 'A' && c <= 'F':
		return c - 'A' + 10
	}
	panic("bad hex nibble")
}

// cursorSnapshot captures every derive cursor and reorg epoch, so a test can
// PROVE none of them moved.
func cursorSnapshot(t *testing.T, f *riskdFixture) map[string]string {
	t.Helper()
	rows, err := f.admin.Query(f.ctx,
		`SELECT engine, chain_id::text || '/' || last_block::text || '/' || acked_epoch::text
		 FROM derive_cursors ORDER BY engine`)
	require.NoError(t, err)
	defer rows.Close()
	out := map[string]string{}
	for rows.Next() {
		var k, v string
		require.NoError(t, rows.Scan(&k, &v))
		out[k] = v
	}
	require.NoError(t, rows.Err())

	var epochs int64
	require.NoError(t, f.admin.QueryRow(f.ctx,
		`SELECT COALESCE(count(*), 0) FROM reorg_epochs`).Scan(&epochs))
	out["__epochs__"] = big.NewInt(epochs).String()
	return out
}

func dmPositionOf(t *testing.T, f *riskdFixture, batchID int64) store.RiskBatchPosition {
	t.Helper()
	positions, err := f.store.RiskBatchPositions(f.ctx, batchID)
	require.NoError(t, err)
	for _, p := range positions {
		if p.Engine == risk.DMEngine {
			return p
		}
	}
	t.Fatalf("no debt_manager position in batch %d (%d positions)", batchID, len(positions))
	return store.RiskBatchPosition{}
}

// TestRiskdSweepFirstSuccessForcesRecompute is the first stale direction.
//
// MUTANT THIS KILLS: remove the sweep leg from watermarkVector.Changed. The
// `vectorChanged` assertion below returns false, no recompute is triggered, and
// the published SWEEP_NEVER refusal stands over collateral the sweep has now
// successfully read.
func TestRiskdSweepFirstSuccessForcesRecompute(t *testing.T) {
	f := newRiskdFixture(t)
	f.seedDMPosition(t)

	// Pass 1: no snapshot_sweeps row at all → never swept → REFUSED.
	first, err := runPass(f.ctx, f.store, f.cfg)
	require.NoError(t, err)
	require.False(t, first.Gated)
	refused := dmPositionOf(t, f, first.BatchID)
	require.Equal(t, store.RiskPositionRefused, refused.Status)
	require.Equal(t, riskfeed.GateSweepNever, refused.RefusalCode,
		"an account whose collateral has never been read must refuse, not serve HF over zero")

	cursorsBefore := cursorSnapshot(t, f)

	// The sweep SUCCEEDS. ApplySweepBatch moves snapshot_sweeps and nothing else.
	_, err = f.admin.Exec(f.ctx, `INSERT INTO snapshot_sweeps
		(engine, account, last_attempt_block, last_success_block, status)
		VALUES ($1, $2, 154790000, 154790000, 'success')`, risk.DMEngine, fxAcct.Bytes())
	require.NoError(t, err)

	require.Equal(t, cursorsBefore, cursorSnapshot(t, f),
		"NOT ONE derive cursor or epoch moved — if this fails the test is not isolating the sweep leg")

	changed, _, _, err := pollTrigger(f.ctx, f.store, f.cfg, first.Vector)
	require.NoError(t, err)
	require.True(t, changed,
		"a first successful sweep MUST trigger a recompute: otherwise the SWEEP_NEVER refusal stands over known collateral")

	// And the recompute publishes the real number.
	second, err := runPass(f.ctx, f.store, f.cfg)
	require.NoError(t, err)
	require.Greater(t, second.BatchID, first.BatchID)
	computed := dmPositionOf(t, f, second.BatchID)
	require.Equal(t, store.RiskPositionComputed, computed.Status)
	require.NotNil(t, computed.Liquidatable)
	require.False(t, *computed.Liquidatable, "$1000 debt against $3000 collateral at 85% LT is healthy")
	require.EqualValues(t, 154_790_000, computed.SweepBlock)
	require.NotContains(t, computed.Flags, riskfeed.FlagSweepStale)
}

// TestRiskdSweepFailureAfterSuccessForcesRecompute is the second stale direction.
//
// MUTANT THIS KILLS: the same missing sweep leg. Without it the previously
// published UNFLAGGED result stands, carrying no staleness disclosure over
// collateral whose latest read FAILED.
func TestRiskdSweepFailureAfterSuccessForcesRecompute(t *testing.T) {
	f := newRiskdFixture(t)
	f.seedDMPosition(t)

	_, err := f.admin.Exec(f.ctx, `INSERT INTO snapshot_sweeps
		(engine, account, last_attempt_block, last_success_block, status)
		VALUES ($1, $2, 154790000, 154790000, 'success')`, risk.DMEngine, fxAcct.Bytes())
	require.NoError(t, err)

	first, err := runPass(f.ctx, f.store, f.cfg)
	require.NoError(t, err)
	clean := dmPositionOf(t, f, first.BatchID)
	require.Equal(t, store.RiskPositionComputed, clean.Status)
	require.NotContains(t, clean.Flags, riskfeed.FlagSweepStale,
		"the baseline result is UNFLAGGED — that is what must not be allowed to stand")

	cursorsBefore := cursorSnapshot(t, f)

	// The next sweep FAILS. last_success_block is unchanged; only the status and
	// the attempt block move.
	_, err = f.admin.Exec(f.ctx,
		`UPDATE snapshot_sweeps SET status = 'failed', last_attempt_block = 154796000,
		        updated_at = now() + interval '1 second'
		 WHERE engine = $1 AND account = $2`, risk.DMEngine, fxAcct.Bytes())
	require.NoError(t, err)

	require.Equal(t, cursorsBefore, cursorSnapshot(t, f),
		"NOT ONE derive cursor or epoch moved")

	changed, _, _, err := pollTrigger(f.ctx, f.store, f.cfg, first.Vector)
	require.NoError(t, err)
	require.True(t, changed,
		"a post-success sweep failure MUST trigger a recompute: otherwise an unflagged result stands over stale collateral")

	second, err := runPass(f.ctx, f.store, f.cfg)
	require.NoError(t, err)
	require.Greater(t, second.BatchID, first.BatchID)

	stale := dmPositionOf(t, f, second.BatchID)
	require.Equal(t, store.RiskPositionComputed, stale.Status,
		"the collateral IS known, just old — so it computes, with the flag")
	require.Contains(t, stale.Flags, riskfeed.FlagSweepStale)
	require.EqualValues(t, 154_790_000, stale.SweepBlock,
		"the stamp stays the last SUCCESSFUL read, never the failed attempt")
}

// TestRiskdSweepStateIsStampedOnTheBatch: the sweep state a batch CONSUMED is
// persisted alongside the cursor pair, so a serving surface can ask whether what
// it is about to serve is still current.
func TestRiskdSweepStateIsStampedOnTheBatch(t *testing.T) {
	f := newRiskdFixture(t)
	f.seedDMPosition(t)
	_, err := f.admin.Exec(f.ctx, `INSERT INTO snapshot_sweeps
		(engine, account, last_attempt_block, last_success_block, status)
		VALUES ($1, $2, 154790000, 154790000, 'success')`, risk.DMEngine, fxAcct.Bytes())
	require.NoError(t, err)

	res, err := runPass(f.ctx, f.store, f.cfg)
	require.NoError(t, err)

	batch, found, err := f.store.NewestCompleteBatch(f.ctx)
	require.NoError(t, err)
	require.True(t, found)
	require.Equal(t, res.BatchID, batch.ID)

	var dm, aave *store.RiskSweepWatermark
	for _, w := range batch.Watermarks {
		switch w.Engine {
		case risk.DMEngine:
			dm = w.Sweep
		case risk.AaveEngine:
			aave = w.Sweep
		}
	}
	require.NotNil(t, dm, "the Debt Manager's consumed sweep state must be stamped")
	require.EqualValues(t, 1, dm.Rows)
	require.Zero(t, dm.Failed)
	require.Equal(t, "154790000", dm.SuccessSum.String())
	require.True(t, dm.HasUpdatedAt)
	require.Nil(t, aave, "the Aave engine has no collateral sweep, and absence stays absence")
}

// TestRiskdQuietDatabaseDoesNotRecompute is the guard against over-triggering: if
// the sweep key moved on every read, riskd would recompute forever and the sweep
// leg would be indistinguishable from a busy-loop.
func TestRiskdQuietDatabaseDoesNotRecompute(t *testing.T) {
	f := newRiskdFixture(t)
	f.seedDMPosition(t)
	_, err := f.admin.Exec(f.ctx, `INSERT INTO snapshot_sweeps
		(engine, account, last_attempt_block, last_success_block, status)
		VALUES ($1, $2, 154790000, 154790000, 'success')`, risk.DMEngine, fxAcct.Bytes())
	require.NoError(t, err)

	res, err := runPass(f.ctx, f.store, f.cfg)
	require.NoError(t, err)

	for i := 0; i < 3; i++ {
		changed, _, _, err := pollTrigger(f.ctx, f.store, f.cfg, res.Vector)
		require.NoError(t, err)
		require.False(t, changed, "nothing moved; the sweep aggregate must compare EQUAL across reads")
	}
}

// TestRiskdConflictedAccountLandsAsARefusedRow is finding #3 end to end:
// RiskInputSnapshot → Assemble → a persisted REFUSAL row, through the real
// database.
//
// MUTANT THIS KILLS: seeding Assemble's account enumeration from the balances map
// alone. `store.riskBalances` withholds every row of an account whose
// (asset, side) exists under BOTH sources, so under that code the account has no
// rows to be found, produces no position, and DISAPPEARS from the batch — which
// downstream reads as "no position here", the false-safe direction. The
// assertions below fail on exactly that disappearance.
func TestRiskdConflictedAccountLandsAsARefusedRow(t *testing.T) {
	f := newRiskdFixture(t)
	f.seedDMPosition(t)
	_, err := f.admin.Exec(f.ctx, `INSERT INTO snapshot_sweeps
		(engine, account, last_attempt_block, last_success_block, status)
		VALUES ($1, $2, 154790000, 154790000, 'success')`, risk.DMEngine, fxAcct.Bytes())
	require.NoError(t, err)

	// The baseline: the account computes normally.
	clean, err := runPass(f.ctx, f.store, f.cfg)
	require.NoError(t, err)
	require.Equal(t, store.RiskPositionComputed, dmPositionOf(t, f, clean.BatchID).Status)

	// Now manufacture the SOURCE-EXCLUSIVITY CONFLICT: the same (asset, side)
	// under BOTH 'event' and 'snapshot'. This is the state the store detects and
	// withholds rows for.
	_, err = f.admin.Exec(f.ctx, `INSERT INTO position_balances
		(engine, account, asset, side, source, amount, updated_block)
		VALUES ($1, $2, $3, 'collateral', 'event', 999, 154791000)`,
		risk.DMEngine, fxAcct.Bytes(), common20(fxDMCollateral))
	require.NoError(t, err)

	// Proof the store really is in the withheld state, so the assertions below
	// are not testing a path that never triggers.
	tx, err := f.store.BeginRiskSnapshot(f.ctx)
	require.NoError(t, err)
	in, err := store.RiskInputSnapshot(f.ctx, tx, f.cfg.snapshotSpec(
		newWatermarkVector(nil, nil, nil, f.cfg.consumedEngines())))
	require.NoError(t, err)
	require.NoError(t, tx.Commit(f.ctx))
	require.Len(t, in.BalanceConflicts, 1, "the store must have detected the conflict")
	require.Equal(t, fxAcct.Bytes(), in.BalanceConflicts[0].Account)
	for _, b := range in.Balances {
		require.NotEqual(t, fxAcct.Bytes(), b.Account,
			"and it must have WITHHELD every row for that account")
	}

	// The recompute must land the account as a REFUSAL, not drop it.
	res, err := runPass(f.ctx, f.store, f.cfg)
	require.NoError(t, err)
	require.Greater(t, res.BatchID, clean.BatchID)

	p := dmPositionOf(t, f, res.BatchID)
	require.Equal(t, store.RiskPositionRefused, p.Status,
		"a conflicted account must be REFUSED in the batch, never absent from it")
	require.Equal(t, riskfeed.GateStoreUnreadable, p.RefusalCode)
	require.Contains(t, p.RefusalDetail, "both event- and snapshot-sourced rows")
	require.Nil(t, p.Liquidatable, "a refusal asserts no verdict")

	// And it is COUNTED in the aggregate — a book that omitted it would report a
	// clean total over an account nobody could evaluate.
	aggs, err := f.store.RiskBatchAggregates(f.ctx, res.BatchID)
	require.NoError(t, err)
	var dm store.RiskEngineAggregate
	for _, a := range aggs {
		if a.Engine == risk.DMEngine {
			dm = a
		}
	}
	require.Equal(t, 1, dm.Positions)
	require.Equal(t, 1, dm.RefusedPositions)
	require.Equal(t, 0, dm.ComputedPositions)
	require.Equal(t, "0", dm.TotalDebt.String(),
		"a refused position contributes NOTHING to the totals — folding it in as zero would understate the book")
}

var _ = context.Background
