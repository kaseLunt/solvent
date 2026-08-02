package main

// The batch read layer, and the reconstruction of `internal/risk`'s own input
// form from the PERSISTED rows of one batch.
//
// # Why this package owns its SQL
//
// `internal/store`'s risk readers take no Querier and read the whole batch
// unconditionally, so they cannot participate in one snapshot with the live
// cursor read supersession needs, and they cannot be scoped to one address.
// Extending them would be the tidier shape and is owed forward; the store's
// public surface is frozen for this task, so this file holds the reads instead.
// The one thing it does NOT re-implement is the COMPLETENESS PREDICATE —
// `store.NewestCompleteBatch` stays the single authority on which batch is
// servable, because a second spelling of that predicate is a second answer to
// "is this batch whole".
//
// # Why every read is one snapshot
//
// A batch header read at one instant and cursors read at another can describe a
// state no instant of the database ever held — and the supersession verdict is
// precisely a comparison between the two. `REPEATABLE READ, READ ONLY` makes the
// comparison meaningful. The batch's own child rows are immutable once
// committed, so their read is coherent with anything.

import (
	"context"
	"errors"
	"fmt"
	"math/big"
	"sort"
	"time"

	"github.com/ethereum/go-ethereum/common"

	"github.com/kaselunt/solvent/internal/risk"
	"github.com/kaselunt/solvent/internal/riskfeed"
	"github.com/kaselunt/solvent/internal/store"
)

// errNoBatch is the honest 503: riskd has not yet committed a servable batch (or
// every batch present is incomplete and therefore unservable). It is NOT an
// empty book — an empty book is a claim about the chain, and this is a statement
// about this service.
var errNoBatch = errors.New("no complete risk batch is available yet")

// errCompleteBatchNoAggregates / errCompleteBatchNoStamps are the fail-closed
// cardinality refusals (wave H8, the permalink's H6b second defense ported to
// the batch read layer). Inside one snapshot these states are unreachable
// through WriteRiskBatch — a complete batch always carries its aggregates and
// its stamped engine set — so reading back ZERO aggregate rows or an EMPTY
// watermark vector for a batch that PASSED the completeness predicate is a
// hand-written or torn "complete" batch (a restore, a manual edit), and
// serving it would publish a complete book with nothing in it. POSITION-count
// zero is legal and stays served: an honest empty book has aggregates saying
// so — the refusal is about aggregates and stamps, never about positions.
var (
	errCompleteBatchNoAggregates = errors.New("passed the completeness predicate but carries no aggregate rows — refusing to serve a complete batch as an empty healthy book (a hand-written or torn state)")
	errCompleteBatchNoStamps     = errors.New("passed the completeness predicate but carries no watermark stamps — refusing to serve its counts without their sweep clock")
)

// refusalReconstruction is the refusal code this package raises against ITSELF.
//
// It fires when the position rebuilt from the batch's persisted rows does not
// reproduce the health factor the batch persisted. That is a defect in THIS
// layer, not in the data, and the honest response is a refused row naming it —
// never a stress number computed from a book that does not match the published
// one, and never a silent omission.
const refusalReconstruction = "API_RECONSTRUCTION_MISMATCH"

// legRow is one risk_position_legs row.
type legRow struct {
	Engine  string
	Account []byte
	Asset   []byte
	// Decimals is the ASSET's ERC20 decimals — the denominator of the
	// per-reserve `balance × price / 10^dec` division.
	Decimals int16

	ScaledDebt           *big.Int
	ScaledCollateral     *big.Int
	LiveDebt             *big.Int
	LiveCollateral       *big.Int
	DebtBase             *big.Int
	CollateralBase       *big.Int
	WeightedLT           *big.Int
	UsedAsCollateral     *bool
	DebtIndexBlock       *uint64
	CollateralIndexBlock *uint64

	Amount                *big.Int
	ValueUSD              *big.Int
	MaxBorrowContribution *big.Int

	LiqThreshold *big.Int
	LiqBonus     *big.Int
}

// positionRow is one risk_positions row plus its children.
type positionRow struct {
	Engine        string
	Account       []byte
	Status        string
	RefusalCode   string
	RefusalDetail string
	RefusalAsset  []byte
	Flags         []string

	ValueDecimals int16

	HFNum      *big.Int
	HFDen      *big.Int
	HFWad      *big.Int
	HFInfinite bool

	TotalCollateralBase *big.Int
	TotalDebtBase       *big.Int
	WeightedLTSum       *big.Int
	AvgLTBps            *big.Int

	CollateralValueUSD *big.Int
	MaxBorrowLT        *big.Int
	Borrowings         *big.Int
	Liquidatable       *bool

	BalancesBlock uint64
	ParamsBlock   uint64
	SweepBlock    uint64

	OldestPriceInput *time.Time
	StalePriceInputs bool

	Legs   []legRow
	Prices []store.RiskBatchPriceInput

	// input is the reconstructed pure-library form, present only for a computed
	// position that reproduced its persisted verdict exactly.
	input *risk.PositionInput
	// reconstructionErr, when non-empty, is why `input` is absent. It becomes a
	// refusal on the wire.
	reconstructionErr string
}

// batchView is one coherent read: the servable batch, the live cursor state its
// supersession is judged against, and the batch's rows.
type batchView struct {
	Batch store.RiskBatch
	// Now is the DATABASE clock, read inside the snapshot. Every age this service
	// publishes is `Now − a durable stamp`; nothing is measured against this
	// process's wall clock.
	Now time.Time

	Cursors   []store.DeriveCursorState
	MaxEpochs map[int64]int64
	Sweeps    []store.RiskSweepWatermark

	Positions  []*positionRow
	Aggregates []store.RiskEngineAggregate

	// Params is the INDEPENDENT param-ledger witness at each position's own
	// params_block. See paramWitness.
	Params *paramWitness
}

// sweepStamps returns the batch's per-engine sweep stamps, keyed by engine. A
// PRESENT key holding nil is the recorded "this engine has no sweeper"
// absence; readBatchAccounts has already refused any view whose served
// engines are not all stamped, so a serving path's lookup cannot miss.
func (v *batchView) sweepStamps() map[string]*store.RiskSweepWatermark {
	out := map[string]*store.RiskSweepWatermark{}
	for _, m := range v.Batch.Watermarks {
		out[m.Engine] = m.Sweep
	}
	return out
}

// paramWitness is the effective param set the CUSTODIED LEDGER asserts, folded
// per (engine, params_block) — an independent witness against which a batch's
// persisted leg thresholds and bonuses are welded.
//
// # Why a second witness is needed at all
//
// Reconstruction copies each leg's `liq_threshold` and `liq_bonus` into the pure
// library's param rows, so recomputing and comparing the result against the same
// row is TAUTOLOGICAL: a wrong or mis-mapped persisted bonus would echo back
// unchanged and pass. That matters because the bonus is not decoration — it drives
// collateral-at-risk and bad debt on the waterfall and every market-realization
// number — and because dropping it is not a visible failure: `internal/risk` falls
// back to a 1.00x seizure multiplier, which silently reports par recovery and
// UNDERSTATES bad debt.
//
// The ledger is the honest second witness. Params are LEDGER DATA keyed on
// (block_number, log_index) (design spec §8), the read is bounded by the batch's
// OWN durable `params_block` stamp, and param history is append-only — so this is
// not a serve-time re-derivation of a value that could have moved underneath the
// batch (the thing design spec §7 forbids for PRICES, which are superseded in
// place). It is the same weld discipline the reconcile extension applies at its
// pins, run against the rows the batch itself was built from.
//
// The fold is `riskfeed.FoldParams` — the single implementation, last-non-nil PER
// FIELD, so a registry row landing later cannot mask a live threshold.
type paramWitness struct {
	// byEngineBlock is keyed engine → params_block → asset.
	byEngineBlock map[string]map[uint64]map[common.Address]risk.ParamRow
}

func (w *paramWitness) row(engine string, block uint64, asset common.Address) (risk.ParamRow, bool) {
	if w == nil {
		return risk.ParamRow{}, false
	}
	byBlock, ok := w.byEngineBlock[engine]
	if !ok {
		return risk.ParamRow{}, false
	}
	byAsset, ok := byBlock[block]
	if !ok {
		return risk.ParamRow{}, false
	}
	r, ok := byAsset[asset]
	return r, ok
}

// readParamWitness folds the ledger once per (engine, params_block) actually
// present in the batch.
//
// It is keyed on the position's OWN params_block rather than on a single
// batch-wide height, because that stamp is what the position's numbers claim to
// have been computed at; welding against a different height would compare a
// threshold to one that was not in force.
func (s *server) readParamWitness(ctx context.Context, q store.Querier, positions []*positionRow) (*paramWitness, error) {
	w := &paramWitness{byEngineBlock: map[string]map[uint64]map[common.Address]risk.ParamRow{}}
	needed := map[string]map[uint64]bool{}
	for _, p := range positions {
		if p.Status != store.RiskPositionComputed {
			continue
		}
		if _, ok := needed[p.Engine]; !ok {
			needed[p.Engine] = map[uint64]bool{}
		}
		needed[p.Engine][p.ParamsBlock] = true
	}

	for engine, blocks := range needed {
		for block := range blocks {
			var ledger []store.ParamRow
			var err error
			var foldEngine string
			var chainID uint64
			switch engine {
			case risk.AaveEngine:
				// Aave params are the PoolConfigurator stream's own engine identity.
				foldEngine, chainID = s.cfg.Aave.ParamEngine, s.cfg.Aave.ChainID
				ledger, err = store.ParamsAsOfQ(ctx, q, foldEngine, chainID, block)
			case risk.DMEngine:
				// The Debt Manager's params ARE its own position_events (design spec §8,
				// zero new RPC), and DMParamsAsOf already returns them folded per asset.
				foldEngine, chainID = risk.DMEngine, s.cfg.DM.ChainID
				ledger, err = store.DMParamsAsOf(ctx, q, block)
			default:
				continue
			}
			if err != nil {
				return nil, err
			}
			folded, err := riskfeed.FoldParams(foldEngine, chainID, ledger)
			if err != nil {
				return nil, fmt.Errorf("fold %s param ledger at block %d: %w", engine, block, err)
			}
			byAsset := make(map[common.Address]risk.ParamRow, len(folded))
			for _, r := range folded {
				byAsset[r.Asset] = r
			}
			if _, ok := w.byEngineBlock[engine]; !ok {
				w.byEngineBlock[engine] = map[uint64]map[common.Address]risk.ParamRow{}
			}
			w.byEngineBlock[engine][block] = byAsset
		}
	}
	return w, nil
}

// refresh is the SSE loop's read, routed through a seam.
//
// `readFailure` is nil in production and exists only so a test can drive the
// read-health latch DETERMINISTICALLY. The alternative — closing the pool or
// dropping the table under a running stream — makes the failure real but also
// makes it unrecoverable and untimed, so the recovery half of the latch could not
// be exercised at all. Time and failure are the variables under test here, so they
// have to be inputs.
//
// It is an ATOMIC because the test sets it while the stream goroutine is reading
// it; a plain field would be a data race. It is unexported with no configuration
// path, so production cannot reach a non-nil value.
func (s *server) refresh(ctx context.Context) (*batchView, error) {
	if s.readFailure != nil {
		if p := s.readFailure.Load(); p != nil && *p != nil {
			return nil, *p
		}
	}
	return s.readBatch(ctx, nil)
}

// readBatch reads the newest complete batch and everything needed to serve it.
//
// account, when non-nil, scopes the CHILD rows (positions, legs, price inputs)
// to one address. The batch header, its stamps and the engine aggregates are
// always whole — an address response still has to disclose which batch it came
// from and whether that batch is superseded.
func (s *server) readBatch(ctx context.Context, account []byte) (*batchView, error) {
	if account == nil {
		return s.readBatchAccounts(ctx, nil)
	}
	return s.readBatchAccounts(ctx, [][]byte{account})
}

// readBatchAccounts is readBatch generalized to an ACCOUNT SET — the P5
// positions page needs the full child rows (legs, price inputs, param witness,
// reconstruction) for up to one page of accounts at a time, and a per-account
// loop would be one snapshot per row. nil means "every account"; an EMPTY
// non-nil set means "no child rows" (the envelope and aggregates still read).
func (s *server) readBatchAccounts(ctx context.Context, accounts [][]byte) (*batchView, error) {
	// ONE SNAPSHOT FOR EVERY STAGE, BATCH RESOLUTION INCLUDED (wave H8 — the
	// shape-sibling of the permalink's H6b fix, promoted from that wave's
	// survey). This used to resolve the newest complete batch on the POOL and
	// only then open the snapshot for the child reads — and batches are
	// PRUNABLE. A retention prune landing between the two statements deleted
	// the resolved batch, and every child read then returned EMPTY without
	// error: positions, aggregates and params all read zero rows, the
	// stamped-engine check below passed VACUOUSLY, and /v1/book and
	// /v1/address served an apparently-successful empty book. Resolving
	// INSIDE the snapshot makes the served batch "newest complete AT SNAPSHOT
	// TIME" — strictly more coherent (one database instant end to end): the
	// pre-prune batch serves WHOLE, or the resolution honestly finds the
	// next-newest batch or errNoBatch — never a torn mixture.
	tx, err := s.store.BeginRiskSnapshot(ctx)
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	v := &batchView{}
	if err := tx.QueryRow(ctx, `SELECT now()`).Scan(&v.Now); err != nil {
		return nil, fmt.Errorf("read database clock: %w", err)
	}
	v.Now = v.Now.UTC()

	batch, found, err := store.NewestCompleteBatchQ(ctx, tx)
	if err != nil {
		return nil, err
	}
	if !found {
		return nil, errNoBatch
	}
	v.Batch = batch
	// FAIL CLOSED ON THE STAMP VECTOR (H6b's second remedy, ported): the
	// completeness predicate requires a non-empty required-engine set with
	// every member stamped, so an empty vector on a batch that passed it is a
	// torn read or a hand-written row — and every sweep and age disclosure in
	// this view hangs off these stamps.
	if len(batch.Watermarks) == 0 {
		return nil, fmt.Errorf("batch %d %w", batch.ID, errCompleteBatchNoStamps)
	}

	// TEST SEAM (nil in production): the retention-prune interleave point —
	// after the batch resolution, before the child reads. The snapshot is
	// already established (the clock read above was this transaction's first
	// statement), so a prune fired here must be invisible to every read
	// below. Same atomic shape as batchInterleave, for the same reason: a
	// test arms it while a server goroutine reads it. See
	// book_prune_race_db_test.go.
	if s.bookInterleave != nil {
		if p := s.bookInterleave.Load(); p != nil && *p != nil {
			(*p)()
		}
	}

	if v.Cursors, err = store.DeriveCursorStates(ctx, tx); err != nil {
		return nil, err
	}
	if v.MaxEpochs, err = store.MaxReorgEpochs(ctx, tx); err != nil {
		return nil, err
	}
	if v.Sweeps, err = store.RiskSweepStateFor(ctx, tx, s.sweptEngines()); err != nil {
		return nil, err
	}
	if v.Positions, err = readPositions(ctx, tx, batch.ID, accounts); err != nil {
		return nil, err
	}
	if err := attachLegs(ctx, tx, batch.ID, accounts, v.Positions); err != nil {
		return nil, err
	}
	if err := attachPrices(ctx, tx, batch.ID, accounts, v.Positions); err != nil {
		return nil, err
	}
	if v.Aggregates, err = readAggregates(ctx, tx, batch.ID); err != nil {
		return nil, err
	}
	// FAIL CLOSED ON CARDINALITY (H6b's second remedy, ported). Inside one
	// snapshot this state is unreachable through WriteRiskBatch — a complete
	// batch always carries its aggregates — so an empty set here is a
	// hand-written or torn "complete" batch, and serving it would publish an
	// empty healthy book that nothing in the store backs. Zero POSITIONS stay
	// legal: an honest empty book is exactly a batch whose aggregates say so.
	if len(v.Aggregates) == 0 {
		return nil, fmt.Errorf("batch %d %w", batch.ID, errCompleteBatchNoAggregates)
	}
	// EVERY ENGINE THIS VIEW SERVES MUST BE STAMPED ON THE BATCH'S OWN VECTOR
	// (1.2.2): each aggregate row and each degradation-posture row serves its
	// engine's sweep stamp from it, and a row with no stamp cannot name the
	// sweep-cut its liquidatable count belongs to. Unreachable through
	// WriteRiskBatch (a complete batch stamps every consumed engine); fail
	// CLOSED against hand-written or torn state here, once, rather than
	// letting a serving path improvise `sweep: null` — which is the no-sweeper
	// CLAIM, not an absence disclosure.
	stamped := map[string]bool{}
	for _, m := range batch.Watermarks {
		stamped[m.Engine] = true
	}
	for _, a := range v.Aggregates {
		if !stamped[a.Engine] {
			return nil, fmt.Errorf("batch %d carries an aggregate for engine %s but no watermark stamp for it — refusing to serve its counts without the sweep clock they belong to", batch.ID, a.Engine)
		}
	}
	for _, p := range v.Positions {
		if !stamped[p.Engine] {
			return nil, fmt.Errorf("batch %d carries a position for engine %s but no watermark stamp for it — refusing to serve its rows without the sweep clock they belong to", batch.ID, p.Engine)
		}
	}
	// The param-ledger witness, read in the SAME snapshot as the rows it welds
	// against so the two describe one instant of the database.
	if v.Params, err = s.readParamWitness(ctx, tx, v.Positions); err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("commit read snapshot: %w", err)
	}

	// Reconstruction happens AFTER the snapshot is released: it is pure CPU work
	// over rows already in memory, and holding a transaction open across it would
	// pin xmin for no reason (round-10 M5).
	s.reconstructAll(v.Positions, v.Params)
	return v, nil
}

// positionKey identifies a position within a batch.
func positionKey(engine string, account []byte) string {
	return engine + "/" + common.BytesToAddress(account).Hex()
}

func readPositions(ctx context.Context, q store.Querier, batchID int64, accounts [][]byte) ([]*positionRow, error) {
	const base = `SELECT engine, account, status, refusal_code, refusal_detail, refusal_asset, flags,
	        value_decimals, hf_num::text, hf_den::text, hf_wad::text, hf_infinite,
	        total_collateral_base::text, total_debt_base::text, weighted_lt_sum::text, avg_lt_bps::text,
	        collateral_value_usd::text, max_borrow_lt::text, borrowings::text, liquidatable,
	        balances_block, params_block, sweep_block, oldest_price_input, stale_price_inputs
	   FROM risk_positions
	  WHERE batch_id = $1 AND ($2::bytea[] IS NULL OR account = ANY($2::bytea[]))
	  ORDER BY engine, account`
	rows, err := q.Query(ctx, base, batchID, accounts)
	if err != nil {
		return nil, fmt.Errorf("read risk positions: %w", err)
	}
	defer rows.Close()
	var out []*positionRow
	for rows.Next() {
		p := &positionRow{}
		var hfNum, hfDen, hfWad, tc, td, wlt, avg, cv, mb, bw *string
		if err := rows.Scan(&p.Engine, &p.Account, &p.Status, &p.RefusalCode, &p.RefusalDetail,
			&p.RefusalAsset, &p.Flags, &p.ValueDecimals,
			&hfNum, &hfDen, &hfWad, &p.HFInfinite,
			&tc, &td, &wlt, &avg, &cv, &mb, &bw, &p.Liquidatable,
			&p.BalancesBlock, &p.ParamsBlock, &p.SweepBlock,
			&p.OldestPriceInput, &p.StalePriceInputs); err != nil {
			return nil, fmt.Errorf("scan risk position: %w", err)
		}
		if err := scanBigs(p.Engine, p.Account, []bigField{
			{hfNum, &p.HFNum}, {hfDen, &p.HFDen}, {hfWad, &p.HFWad},
			{tc, &p.TotalCollateralBase}, {td, &p.TotalDebtBase},
			{wlt, &p.WeightedLTSum}, {avg, &p.AvgLTBps},
			{cv, &p.CollateralValueUSD}, {mb, &p.MaxBorrowLT}, {bw, &p.Borrowings},
		}); err != nil {
			return nil, err
		}
		if p.OldestPriceInput != nil {
			t := p.OldestPriceInput.UTC()
			p.OldestPriceInput = &t
		}
		out = append(out, p)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate risk positions: %w", err)
	}
	return out, nil
}

func attachLegs(ctx context.Context, q store.Querier, batchID int64, accounts [][]byte, positions []*positionRow) error {
	rows, err := q.Query(ctx,
		`SELECT engine, account, asset, decimals,
		        scaled_debt::text, scaled_collateral::text, live_debt::text, live_collateral::text,
		        debt_base::text, collateral_base::text, weighted_lt::text, used_as_collateral,
		        debt_index_block, collateral_index_block,
		        amount::text, value_usd::text, max_borrow_contribution::text,
		        liq_threshold::text, liq_bonus::text
		   FROM risk_position_legs
		  WHERE batch_id = $1 AND ($2::bytea[] IS NULL OR account = ANY($2::bytea[]))
		  ORDER BY engine, account, asset`, batchID, accounts)
	if err != nil {
		return fmt.Errorf("read risk position legs: %w", err)
	}
	defer rows.Close()
	byKey := map[string]*positionRow{}
	for _, p := range positions {
		byKey[positionKey(p.Engine, p.Account)] = p
	}
	for rows.Next() {
		var l legRow
		var scaledDebt, scaledColl, liveDebt, liveColl, debtBase, collBase, wlt *string
		var amount, valueUSD, maxBorrow, lt, bonus *string
		var debtBlock, collBlock *int64
		if err := rows.Scan(&l.Engine, &l.Account, &l.Asset, &l.Decimals,
			&scaledDebt, &scaledColl, &liveDebt, &liveColl,
			&debtBase, &collBase, &wlt, &l.UsedAsCollateral,
			&debtBlock, &collBlock,
			&amount, &valueUSD, &maxBorrow, &lt, &bonus); err != nil {
			return fmt.Errorf("scan risk position leg: %w", err)
		}
		if err := scanBigs(l.Engine, l.Asset, []bigField{
			{scaledDebt, &l.ScaledDebt}, {scaledColl, &l.ScaledCollateral},
			{liveDebt, &l.LiveDebt}, {liveColl, &l.LiveCollateral},
			{debtBase, &l.DebtBase}, {collBase, &l.CollateralBase}, {wlt, &l.WeightedLT},
			{amount, &l.Amount}, {valueUSD, &l.ValueUSD}, {maxBorrow, &l.MaxBorrowContribution},
			{lt, &l.LiqThreshold}, {bonus, &l.LiqBonus},
		}); err != nil {
			return err
		}
		if debtBlock != nil {
			b := uint64(*debtBlock)
			l.DebtIndexBlock = &b
		}
		if collBlock != nil {
			b := uint64(*collBlock)
			l.CollateralIndexBlock = &b
		}
		if p, ok := byKey[positionKey(l.Engine, l.Account)]; ok {
			p.Legs = append(p.Legs, l)
		}
	}
	if err := rows.Err(); err != nil {
		return fmt.Errorf("iterate risk position legs: %w", err)
	}
	return nil
}

func attachPrices(ctx context.Context, q store.Querier, batchID int64, accounts [][]byte, positions []*positionRow) error {
	rows, err := q.Query(ctx,
		`SELECT engine, account, asset, chain_id, source, provenance,
		        value::text, decimals, block_number, source_as_of,
		        budget_seconds, verdict, age_seconds
		   FROM risk_price_inputs
		  WHERE batch_id = $1 AND ($2::bytea[] IS NULL OR account = ANY($2::bytea[]))
		  ORDER BY engine, account, asset, source`, batchID, accounts)
	if err != nil {
		return fmt.Errorf("read risk price inputs: %w", err)
	}
	defer rows.Close()
	byKey := map[string]*positionRow{}
	for _, p := range positions {
		byKey[positionKey(p.Engine, p.Account)] = p
	}
	for rows.Next() {
		var r store.RiskBatchPriceInput
		var value *string
		if err := rows.Scan(&r.Engine, &r.Account, &r.Asset, &r.ChainID, &r.Source, &r.Provenance,
			&value, &r.Decimals, &r.BlockNumber, &r.SourceAsOf,
			&r.BudgetSeconds, &r.Verdict, &r.AgeSeconds); err != nil {
			return fmt.Errorf("scan risk price input: %w", err)
		}
		if value != nil {
			v, ok := new(big.Int).SetString(*value, 10)
			if !ok {
				return fmt.Errorf("risk price input %x/%s: %q is not an integer", r.Asset, r.Source, *value)
			}
			r.Value = v
		}
		if r.SourceAsOf != nil {
			t := r.SourceAsOf.UTC()
			r.SourceAsOf = &t
		}
		if p, ok := byKey[positionKey(r.Engine, r.Account)]; ok {
			p.Prices = append(p.Prices, r)
		}
	}
	if err := rows.Err(); err != nil {
		return fmt.Errorf("iterate risk price inputs: %w", err)
	}
	return nil
}

// readAggregates reads a batch's per-engine rollups INCLUDING the engine-scoped
// refusal.
//
// `refusal_code` / `refusal_detail` (migration 00014) are not optional colour.
// An engine's book can be withheld for a reason that is a property of the LEDGER
// rather than of any account — unproven derivation coverage is the case that
// forced the columns — and such a refusal SURVIVES AN EMPTY ACCOUNT SET. The deep
// rewind that opens the collateral-flag replay deletes every event-sourced Aave
// balance, so a pass in that window has no position row to hang a refusal on and
// persists a zeroed rollup carrying only the code. Omitting these two columns is
// therefore exactly how a withheld engine gets served as "nothing at risk here".
func readAggregates(ctx context.Context, q store.Querier, batchID int64) ([]store.RiskEngineAggregate, error) {
	rows, err := q.Query(ctx,
		`SELECT engine, value_decimals, positions, computed_positions, refused_positions,
		        flagged_positions, liquidatable_positions, total_collateral::text, total_debt::text,
		        refusal_code, refusal_detail
		   FROM risk_batch_aggregates WHERE batch_id = $1 ORDER BY engine`, batchID)
	if err != nil {
		return nil, fmt.Errorf("read risk batch aggregates: %w", err)
	}
	defer rows.Close()
	var out []store.RiskEngineAggregate
	for rows.Next() {
		var a store.RiskEngineAggregate
		var dec int16
		var tc, td string
		if err := rows.Scan(&a.Engine, &dec, &a.Positions, &a.ComputedPositions, &a.RefusedPositions,
			&a.FlaggedPositions, &a.LiquidatablePositions, &tc, &td,
			&a.RefusalCode, &a.RefusalDetail); err != nil {
			return nil, fmt.Errorf("scan risk batch aggregate: %w", err)
		}
		a.ValueDecimals = uint8(dec)
		var ok bool
		if a.TotalCollateral, ok = new(big.Int).SetString(tc, 10); !ok {
			return nil, fmt.Errorf("risk aggregate %s: total_collateral %q is not an integer", a.Engine, tc)
		}
		if a.TotalDebt, ok = new(big.Int).SetString(td, 10); !ok {
			return nil, fmt.Errorf("risk aggregate %s: total_debt %q is not an integer", a.Engine, td)
		}
		out = append(out, a)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate risk batch aggregates: %w", err)
	}
	return out, nil
}

type bigField struct {
	text *string
	dst  **big.Int
}

func scanBigs(engine string, subject []byte, fields []bigField) error {
	for _, f := range fields {
		if f.text == nil {
			continue
		}
		v, ok := new(big.Int).SetString(*f.text, 10)
		if !ok {
			return fmt.Errorf("%s/%x: %q is not an integer", engine, subject, *f.text)
		}
		*f.dst = v
	}
	return nil
}

// ---------------------------------------------------------------------------
// Reconstruction: persisted rows → internal/risk's input form.
// ---------------------------------------------------------------------------

// reconstructAll rebuilds every computed position's pure-library input and
// VERIFIES it against the persisted verdict.
//
// # Why reconstruct at all
//
// The stress and waterfall surfaces are pure functions of a book in
// `internal/risk`'s input form, and `risk_scenarios` / `risk_waterfall` are
// deliberately unpopulated (migration 00013). The alternative — re-reading the
// substrate and re-assembling — is the serve-time re-derivation design spec §7
// forbids: a poll superseding a price key between riskd's pass and this request
// would give the stress page a different input than the batch it is labelled
// with. Reconstructing from the batch's OWN rows keeps every surface describing
// one materialization.
//
// # Why the verification is not optional
//
// A reconstruction that silently disagreed with the batch would publish stress
// numbers for a book nobody computed. So each rebuilt position is run back
// through the same pure function riskd ran, and the result is compared to the
// persisted row EXACTLY — health factor on the WAD (never a re-derived float),
// totals, and the Debt Manager's strict boolean. A disagreement makes the
// position a REFUSED row naming `API_RECONSTRUCTION_MISMATCH`; it is never
// dropped, and it never reaches the book.
func (s *server) reconstructAll(positions []*positionRow, w *paramWitness) {
	for _, p := range positions {
		if p.Status != store.RiskPositionComputed {
			continue
		}
		in, err := s.reconstruct(p)
		if err != nil {
			p.reconstructionErr = err.Error()
			continue
		}
		if err := verifyReconstruction(p, in, w); err != nil {
			p.reconstructionErr = err.Error()
			continue
		}
		p.input = &in
	}
}

// book returns the reconstructed, verified positions in stable order.
func book(positions []*positionRow) []risk.PositionInput {
	var out []risk.PositionInput
	for _, p := range positions {
		if p.input != nil {
			out = append(out, *p.input)
		}
	}
	return out
}

// reconstruct rebuilds one position's input.
//
// # The identity-index reconstruction, and why it is exact
//
// A batch persists each leg's LIVE amounts (index already applied) and the
// index's as-of BLOCK, but not the index VALUE — so the scaled→live step cannot
// be replayed from the row. It does not need to be: `AaveLiveDebt(x, RAY) =
// rayMulCeil(x, RAY) = ceil(x·RAY/RAY) = x` and `AaveLiveCollateral(x, RAY) =
// floor(x·RAY/RAY) = x`, both exactly, for every x. Feeding the persisted live
// amount with an identity index therefore reproduces that same live amount —
// BIT-IDENTICALLY, not approximately — and every downstream component then runs
// on the numbers the batch actually used. The as-of block still comes from the
// persisted column, so no disclosure borrows a freshness it does not have.
//
// `TestIdentityIndexReproducesLiveAmounts` pins the algebra with concrete
// integers rather than trusting the argument.
func (s *server) reconstruct(p *positionRow) (risk.PositionInput, error) {
	prices, err := reconstructPrices(p)
	if err != nil {
		return risk.PositionInput{}, err
	}
	account := common.BytesToAddress(p.Account)

	switch p.Engine {
	case risk.AaveEngine:
		in := risk.AaveInput{
			Account: account,
			Regime:  risk.RegimeB,
			Prices:  prices,
			Marks:   risk.Watermarks{BalancesBlock: p.BalancesBlock, ParamsBlock: p.ParamsBlock},
		}
		for _, l := range p.Legs {
			asset := common.BytesToAddress(l.Asset)
			r := risk.AaveReserve{
				Asset:            asset,
				Decimals:         uint8(l.Decimals),
				UsedAsCollateral: l.UsedAsCollateral != nil && *l.UsedAsCollateral,
			}
			if l.LiveDebt != nil && l.LiveDebt.Sign() > 0 {
				r.ScaledDebt = new(big.Int).Set(l.LiveDebt)
				r.DebtIndex = risk.RayUnit()
			}
			if l.LiveCollateral != nil && l.LiveCollateral.Sign() > 0 {
				r.ScaledCollateral = new(big.Int).Set(l.LiveCollateral)
				r.CollateralIndex = risk.RayUnit()
			}
			switch {
			case l.CollateralIndexBlock != nil:
				r.IndexBlock = *l.CollateralIndexBlock
			case l.DebtIndexBlock != nil:
				r.IndexBlock = *l.DebtIndexBlock
			}
			in.Reserves = append(in.Reserves, r)
			if l.LiqThreshold != nil {
				in.Params = append(in.Params, risk.ParamRow{
					Engine:         risk.AaveParamEngine,
					ChainID:        s.cfg.Aave.ChainID,
					Asset:          asset,
					LiqThreshold:   new(big.Int).Set(l.LiqThreshold),
					LiqBonus:       cloneOrNil(l.LiqBonus),
					EffectiveBlock: p.ParamsBlock,
					Source:         "risk_position_legs",
				})
			}
		}
		return risk.PositionInput{Engine: risk.AaveEngine, Aave: &in, Marks: in.Marks}, nil

	case risk.DMEngine:
		in := risk.DMInput{
			Account: account,
			DebtUSD: cloneOrZero(p.Borrowings),
			Prices:  prices,
			Marks: risk.Watermarks{
				BalancesBlock: p.BalancesBlock,
				ParamsBlock:   p.ParamsBlock,
				SweepBlock:    p.SweepBlock,
			},
		}
		for _, l := range p.Legs {
			asset := common.BytesToAddress(l.Asset)
			// A leg with NO amount is a PURE DEBT leg — the borrow token with no
			// swept balance behind it. Its debt is already inside DebtUSD (the
			// position's borrowings), and it must NOT become a zero-amount
			// collateral entry: `amount` NULL is "this leg has no collateral
			// side", not "this leg holds zero", and a phantom zero entry would
			// make the recomputation emit collateral outputs (zeros) that the
			// persisted leg honestly does not carry. A leg carrying BOTH sides —
			// the merged shape assembleDM writes for a borrow token held as
			// collateral — has a non-NULL amount and flows through here as a
			// collateral entry like any other.
			if l.Amount != nil {
				in.Collateral = append(in.Collateral, risk.DMCollateral{
					Asset:    asset,
					Amount:   new(big.Int).Set(l.Amount),
					Decimals: uint8(l.Decimals),
				})
			}
			if l.LiqThreshold != nil {
				in.Params = append(in.Params, risk.ParamRow{
					Engine:         risk.DMEngine,
					ChainID:        s.cfg.DM.ChainID,
					Asset:          asset,
					LiqThreshold:   new(big.Int).Set(l.LiqThreshold),
					LiqBonus:       cloneOrNil(l.LiqBonus),
					EffectiveBlock: p.ParamsBlock,
					Source:         "risk_position_legs",
				})
			}
		}
		return risk.PositionInput{Engine: risk.DMEngine, DM: &in, Marks: in.Marks}, nil
	}
	return risk.PositionInput{}, fmt.Errorf("engine %q has no reconstruction", p.Engine)
}

// reconstructPrices turns the batch's persisted price snapshots back into
// `internal/risk` inputs.
//
// The values, decimals, blocks, as-ofs, sources, provenance classes and budgets
// all come from the ROW — never from a fresh read of `prices`. The freshness
// BOOLEAN is likewise read off the persisted verdict rather than re-judged
// against the current clock, because re-judging it would age the batch's inputs
// after the fact and change a number the batch already published.
//
// A row with no value (verdict `missing`) is dropped: the position that refused
// because of it is a refused row, and a computed position carries none.
//
// CapValue is deliberately absent. Cap-adapter ceilings are not persisted on the
// snapshot, so an UPWARD shock cannot be capped here; every committed scenario
// is a down-shock or a rate/market axis, and /v1/address/{addr}/stress discloses
// the omission rather than implying a cap was checked.
func reconstructPrices(p *positionRow) ([]risk.PriceInput, error) {
	var out []risk.PriceInput
	for _, pr := range p.Prices {
		if pr.Value == nil {
			continue
		}
		if pr.Decimals == nil {
			return nil, fmt.Errorf("price input %x/%s carries a value with no decimals", pr.Asset, pr.Source)
		}
		in := risk.PriceInput{
			ChainID:       uint64(pr.ChainID),
			Asset:         common.BytesToAddress(pr.Asset),
			Source:        pr.Source,
			Provenance:    pr.Provenance,
			Value:         new(big.Int).Set(pr.Value),
			Decimals:      uint8(*pr.Decimals),
			BudgetSeconds: pr.BudgetSeconds,
			Fresh:         pr.Verdict == riskfeed.VerdictFresh,
		}
		if pr.BlockNumber != nil {
			in.Block = uint64(*pr.BlockNumber)
		}
		if pr.SourceAsOf != nil {
			in.AsOf = *pr.SourceAsOf
		}
		out = append(out, in)
	}
	return out, nil
}

// verifyReconstruction re-runs the pure function riskd ran and demands exact
// agreement with the persisted row.
//
// # The surface it covers, and why each part is on it
//
// EVERY DIRECTLY SERVED HEALTH DISCLOSURE is compared, not just the headline: the
// health-factor wad, the EXACT RATIONAL behind it (`hf_num`/`hf_den`, which the
// address surface publishes and every liquidation-price solve consumes), the
// AVERAGE LIQUIDATION THRESHOLD (`avg_lt_bps`, published as a disclosure), the
// totals, and the Debt Manager's strict boolean. A disclosure that is served but
// not verified is a number this layer could get wrong without noticing.
//
// PER-LEG OUTPUTS are compared too — live amounts, base values, the weighted
// threshold contribution, the Debt Manager's per-token value and threshold
// contribution — because the address surface publishes each of them and because
// they are the only place a mis-scaled decimals or a mis-mapped threshold shows up
// as arithmetic rather than as a label.
//
// PER-LEG THRESHOLDS AND BONUSES are welded against the PARAM LEDGER, not against
// the recomputation. Comparing them to the recomputation would be tautological —
// reconstruction feeds them IN, so a wrong value echoes back unchanged — and the
// bonus is precisely the input whose corruption is otherwise invisible: it moves
// collateral-at-risk, bad debt and every market-realization number, and dropping
// it makes `internal/risk` fall back to a 1.00x seizure multiplier that reports par
// recovery and UNDERSTATES bad debt. See paramWitness for why the ledger is a
// legitimate second witness rather than a serve-time re-derivation.
func verifyReconstruction(p *positionRow, in risk.PositionInput, w *paramWitness) error {
	switch p.Engine {
	case risk.AaveEngine:
		h, err := risk.ComputeAaveHealth(*in.Aave)
		if err != nil {
			return fmt.Errorf("recompute refused the reconstructed position: %w", err)
		}
		// THE SCALE WELD, Aave arm. Aave's scale is legitimately the oracle
		// base currency's, carried by the price witnesses — and every computed
		// Aave position consumed at least one (a nonzero leg with no witness
		// is a refusal, an all-zero account is not a position), so the
		// recomputed BaseDecimals is always witness-backed here. The persisted
		// label must match it, or the row's money columns mean something other
		// than what they say — the same corruption class the DM arm refuses.
		if uint8(p.ValueDecimals) != h.BaseDecimals {
			return fmt.Errorf("position value_decimals %d, the recomputed base-currency scale is %d — the row's money columns are labeled at the wrong magnitude",
				p.ValueDecimals, h.BaseDecimals)
		}
		if h.IsInfinite != p.HFInfinite {
			return fmt.Errorf("reconstructed health factor is infinite=%v, the batch persisted infinite=%v", h.IsInfinite, p.HFInfinite)
		}
		// THE WAD, NOT A RE-DERIVED FLOAT. Component 7 is a half-up composite that
		// can land one wad ULP above the exact rational's floor, so a float or a
		// re-division comparison would report a false mismatch on carry vectors.
		if !h.IsInfinite && !eqBig(h.HealthFactorWad, p.HFWad) {
			return fmt.Errorf("reconstructed health factor wad %s, the batch persisted %s", showBig(h.HealthFactorWad), showBig(p.HFWad))
		}
		// THE VERDICT WELD, Aave arm (Wave R2 Finding A) — the exact twin of the
		// DM arm's below, and absent until now for the same reason the assembler
		// never wrote the field: Aave's verdict is DERIVED, so there was nothing
		// obvious to compare. It is a directly served disclosure (`liquidatable`
		// on the position wire, and the engine rollup's count of it), and this
		// function's own law is that a served disclosure which is not verified is
		// a number this layer could get wrong without noticing.
		//
		// A NULL here is refused, not tolerated. Every batch materialized before
		// AlgorithmRevision 6 carries NULL on every computed Aave row; rev 6
		// guarantees the corrected binary cannot ADOPT such a batch, so the only
		// way one reaches this line is a batch produced by a binary this one has
		// already declared incompatible. Serving stress and waterfall numbers off
		// it is precisely the "publish stress numbers for a book nobody computed"
		// this verification exists to prevent — so the row becomes a visible,
		// named API_RECONSTRUCTION_MISMATCH refusal, which is the honest reading
		// of a stale batch and heals on the next materializer pass.
		if p.Liquidatable == nil {
			return errors.New("the batch persisted no liquidatable verdict for a computed Aave position: every batch below algorithm revision 6 carries none, and a rollup counting the absence as not-liquidatable is the unknown-printed-as-zero this layer must refuse rather than serve")
		}
		if h.Liquidatable() != *p.Liquidatable {
			return fmt.Errorf("reconstructed liquidatable=%v, the batch persisted %v", h.Liquidatable(), *p.Liquidatable)
		}
		checks := []bigCheck{
			{"total_collateral_base", h.TotalCollateralBase, p.TotalCollateralBase},
			{"total_debt_base", h.TotalDebtBase, p.TotalDebtBase},
			{"weighted_lt_sum", h.WeightedLTSum, p.WeightedLTSum},
			{"avg_lt_bps", h.AvgLiquidationThresholdBps, p.AvgLTBps},
		}
		if !h.IsInfinite {
			// The exact rational is a SERVED disclosure and the input to every
			// liquidation-price solve, so it is verified alongside the wad.
			checks = append(checks,
				bigCheck{"hf_num", h.HealthFactor.Num, p.HFNum},
				bigCheck{"hf_den", h.HealthFactor.Den, p.HFDen})
		}
		if err := runBigChecks(checks); err != nil {
			return err
		}

		byAsset := map[common.Address]risk.AaveReserveValue{}
		for _, rv := range h.Reserves {
			byAsset[rv.Asset] = rv
		}
		for _, l := range p.Legs {
			asset := common.BytesToAddress(l.Asset)
			rv, ok := byAsset[asset]
			if !ok {
				return fmt.Errorf("leg %s is absent from the recomputation", asset.Hex())
			}
			if err := runBigChecks([]bigCheck{
				{"leg " + asset.Hex() + " live_debt", rv.LiveDebt, l.LiveDebt},
				{"leg " + asset.Hex() + " live_collateral", rv.LiveCollateral, l.LiveCollateral},
				{"leg " + asset.Hex() + " debt_base", rv.DebtBase, l.DebtBase},
				{"leg " + asset.Hex() + " collateral_base", rv.CollateralBase, l.CollateralBase},
				{"leg " + asset.Hex() + " weighted_lt", rv.WeightedLT, l.WeightedLT},
			}); err != nil {
				return err
			}
			if err := weldLegParams(w, risk.AaveEngine, p.ParamsBlock, asset, l); err != nil {
				return err
			}
		}
		return nil

	case risk.DMEngine:
		h, err := risk.ComputeDMHealth(*in.DM)
		if err != nil {
			return fmt.Errorf("recompute refused the reconstructed position: %w", err)
		}
		// THE SCALE WELD (Codex round 6 [HIGH]). The sums below verify the
		// MAGNITUDES; this verifies what the magnitudes MEAN. A DM row whose
		// value_decimals differs from the engine's declared USD scale labels
		// every money column 10^|Δ| off — live batch 3 carried 44 rows at 0
		// over USD-6 borrowings, and a sums-only verification served them,
		// because every sum was internally consistent under the wrong label.
		// h.UsdDecimals is the engine's own structural declaration
		// (risk.DMUsdDecimals), independent of the witness set, so the
		// comparison holds for the debt-only shape that consults no witnesses.
		if uint8(p.ValueDecimals) != h.UsdDecimals {
			return fmt.Errorf("position value_decimals %d, the Debt Manager's declared USD scale is %d — the row's money columns are labeled at the wrong magnitude",
				p.ValueDecimals, h.UsdDecimals)
		}
		if p.Liquidatable == nil {
			return errors.New("the batch persisted no liquidatable verdict for a computed Debt Manager position")
		}
		if h.Liquidatable != *p.Liquidatable {
			return fmt.Errorf("reconstructed liquidatable=%v, the batch persisted %v", h.Liquidatable, *p.Liquidatable)
		}
		checks := []bigCheck{
			{"collateral_value_usd", h.CollateralValueUSD, p.CollateralValueUSD},
			{"max_borrow_lt", h.MaxBorrowLT, p.MaxBorrowLT},
			{"borrowings", h.Borrowings, p.Borrowings},
		}
		if !h.IsInfinite {
			checks = append(checks,
				bigCheck{"hf_num", h.HealthFactor.Num, p.HFNum},
				bigCheck{"hf_den", h.HealthFactor.Den, p.HFDen})
		}
		if err := runBigChecks(checks); err != nil {
			return err
		}

		byAsset := map[common.Address]risk.DMCollateralValue{}
		for _, cv := range h.Collateral {
			byAsset[cv.Asset] = cv
		}
		// The DEBT-SIDE WELD accumulates alongside the per-leg collateral
		// checks: every borrow leg's live_debt must sum EXACTLY to the
		// borrowings the health factor divided by. The collateral side is
		// welded per leg below; without this sum the debt legs would be served
		// numbers nothing verifies — and a leg merge that silently dropped a
		// debt side (the borrow token held as collateral carries BOTH sides on
		// one row) would be invisible.
		liveDebtSum := new(big.Int)
		for _, l := range p.Legs {
			asset := common.BytesToAddress(l.Asset)
			if l.LiveDebt != nil {
				liveDebtSum.Add(liveDebtSum, l.LiveDebt)
			}
			if l.Amount == nil {
				// A PURE DEBT leg has no collateral side and therefore no
				// collateral outputs to compare. That absence is VERIFIED, not
				// assumed: a value_usd or max_borrow_contribution on it would be
				// a served number the recomputation never produces.
				if l.ValueUSD != nil || l.MaxBorrowContribution != nil {
					return fmt.Errorf("leg %s carries collateral outputs (value_usd %s, max_borrow_contribution %s) with no collateral amount behind them",
						asset.Hex(), showBig(l.ValueUSD), showBig(l.MaxBorrowContribution))
				}
				if err := weldLegParams(w, risk.DMEngine, p.ParamsBlock, asset, l); err != nil {
					return err
				}
				continue
			}
			cv, ok := byAsset[asset]
			if !ok {
				return fmt.Errorf("leg %s is absent from the recomputation", asset.Hex())
			}
			if err := runBigChecks([]bigCheck{
				{"leg " + asset.Hex() + " value_usd", cv.ValueUSD, l.ValueUSD},
				{"leg " + asset.Hex() + " max_borrow_contribution", cv.MaxBorrowContribution, l.MaxBorrowContribution},
			}); err != nil {
				return err
			}
			if err := weldLegParams(w, risk.DMEngine, p.ParamsBlock, asset, l); err != nil {
				return err
			}
		}
		if liveDebtSum.Cmp(cloneOrZero(p.Borrowings)) != 0 {
			return fmt.Errorf("legs' live_debt sums to %s, the batch persisted borrowings %s — a debt side was dropped or double-counted",
				liveDebtSum, showBig(p.Borrowings))
		}
		return nil
	}
	return fmt.Errorf("engine %q has no verification", p.Engine)
}

type bigCheck struct {
	name string
	got  *big.Int
	want *big.Int
}

func runBigChecks(checks []bigCheck) error {
	for _, c := range checks {
		if !eqBig(c.got, c.want) {
			return fmt.Errorf("reconstructed %s %s, the batch persisted %s", c.name, showBig(c.got), showBig(c.want))
		}
	}
	return nil
}

// weldLegParams compares one leg's persisted risk parameters against the
// custodied ledger at the position's own params_block.
//
// A leg carrying a liquidation threshold is a leg that COUNTED as collateral, and
// riskd only writes that threshold because the ledger asserted one. So a threshold
// with NO ledger row behind it is refused: "a gap is a wrong liquidation
// threshold" (design spec §8), and a threshold nobody custodied is exactly that
// gap. A leg with no threshold — a pure debt leg, or collateral that does not
// count — has nothing to weld.
func weldLegParams(w *paramWitness, engine string, paramsBlock uint64, asset common.Address, l legRow) error {
	if l.LiqThreshold == nil {
		return nil
	}
	row, ok := w.row(engine, paramsBlock, asset)
	if !ok {
		return fmt.Errorf("leg %s carries a liquidation threshold (%s) that NO custodied param row asserts at params_block %d — a param gap is a wrong liquidation threshold",
			asset.Hex(), showBig(l.LiqThreshold), paramsBlock)
	}
	if !eqBig(row.LiqThreshold, l.LiqThreshold) {
		return fmt.Errorf("leg %s liquidation threshold %s disagrees with the param ledger's %s at params_block %d",
			asset.Hex(), showBig(l.LiqThreshold), showBig(row.LiqThreshold), paramsBlock)
	}
	// THE BONUS IS WELDED TOO, and it is the reason this function exists. It never
	// reaches a health factor, so nothing above would notice a wrong one — while it
	// drives collateral-at-risk, bad debt and every market-realization number, and
	// its ABSENCE silently becomes a 1.00x seizure multiplier that reports par
	// recovery.
	if !eqBig(row.LiqBonus, l.LiqBonus) {
		return fmt.Errorf("leg %s liquidation bonus %s disagrees with the param ledger's %s at params_block %d — the bonus drives collateral-at-risk and bad debt, and a wrong one moves no health factor to signal it",
			asset.Hex(), showBig(l.LiqBonus), showBig(row.LiqBonus), paramsBlock)
	}
	return nil
}

// eqBig compares two optionally-absent integers. Absent equals absent; absent
// never equals a value, not even zero — "not applicable on this engine" and
// "zero" are different statements and migration 00013 keeps them distinct.
func eqBig(a, b *big.Int) bool {
	switch {
	case a == nil && b == nil:
		return true
	case a == nil || b == nil:
		return false
	default:
		return a.Cmp(b) == 0
	}
}

func showBig(v *big.Int) string {
	if v == nil {
		return "<absent>"
	}
	return v.String()
}

func cloneOrNil(v *big.Int) *big.Int {
	if v == nil {
		return nil
	}
	return new(big.Int).Set(v)
}

func cloneOrZero(v *big.Int) *big.Int {
	if v == nil {
		return new(big.Int)
	}
	return new(big.Int).Set(v)
}

// ---------------------------------------------------------------------------
// Observatory reads (many batches, aggregates only).
// ---------------------------------------------------------------------------

// observatoryBatch is one point of the migration time series.
type observatoryBatch struct {
	BatchID    int64
	ComputedAt time.Time
	// Watermarks is THIS batch's stamped engine vector — cursor pair, epoch
	// stamps AND the per-engine sweep stamp — read from
	// risk_batch_watermarks in the same snapshot as the aggregates (1.2.2).
	// The point re-clocks the response (its own batch_id/computed_at), so
	// the envelope's vector cannot vouch for it; without its OWN vector the
	// liquidatable counts below would aggregate a sweep-cut the surface
	// never names.
	Watermarks []store.RiskBatchWatermark
	Aggregates []store.RiskEngineAggregate
}

// rateIndexRow is one `rate_indexes` row: the engine's per-asset accrual index
// and the block it was last observed at.
type rateIndexRow struct {
	Engine string
	Asset  []byte
	Kind   string
	Value  *big.Int
	Block  uint64
}

// readObservatory reads the newest `limit` COMPLETE batches' aggregates plus the
// current rate indexes, in one snapshot with the database clock.
//
// SELECTION GOES THROUGH `store.CompleteBatchIDs`, which applies the store's own
// completeness predicate — the same one `NewestCompleteBatch` applies. This file
// previously spelled a WEAKER version of that predicate inline (status, position
// count, aggregate count, required-engine presence), omitting the leg and
// price-input cardinalities, the required watermark and sweep-payload sets, and
// the aggregate-to-position sum. After an honest partial restore that duplicate
// admitted a batch the serving path refused, so the series could publish a point
// no route would serve — and a series that quietly includes torn batches shows a
// book dropping and recovering for a reason that is not on the chain. There is one
// completeness authority, and this is now behind it.
func (s *server) readObservatory(ctx context.Context, limit int) (now time.Time, out []observatoryBatch, indexes []rateIndexRow, err error) {
	tx, err := s.store.BeginRiskSnapshot(ctx)
	if err != nil {
		return time.Time{}, nil, nil, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	if err := tx.QueryRow(ctx, `SELECT now()`).Scan(&now); err != nil {
		return time.Time{}, nil, nil, fmt.Errorf("read database clock: %w", err)
	}
	now = now.UTC()

	ids, err := store.CompleteBatchIDs(ctx, tx, limit)
	if err != nil {
		return time.Time{}, nil, nil, err
	}
	// ONLY the aggregate series depends on there being a complete batch. Rate-index
	// custody is INDEPENDENT of it — the derivers write `rate_indexes` on their own
	// cadence — so an honest startup or a partial restore can hold valid current
	// indexes with no servable batch yet. Returning early here reported those
	// indexes as absent, which is the same class of lie as an empty book: data that
	// exists, served as data that does not.
	if len(ids) > 0 {
		if out, err = readObservatorySeries(ctx, tx, ids); err != nil {
			return time.Time{}, nil, nil, err
		}
	}

	if indexes, err = readRateIndexes(ctx, tx); err != nil {
		return time.Time{}, nil, nil, err
	}

	if err := tx.Commit(ctx); err != nil {
		return time.Time{}, nil, nil, fmt.Errorf("commit observatory snapshot: %w", err)
	}
	return now, out, indexes, nil
}

// readObservatorySeries reads the per-engine rollups of the given batch ids.
func readObservatorySeries(ctx context.Context, q store.Querier, ids []int64) ([]observatoryBatch, error) {
	rows, err := q.Query(ctx, `
		SELECT b.id, b.computed_at, a.engine, a.value_decimals, a.positions, a.computed_positions,
		       a.refused_positions, a.flagged_positions, a.liquidatable_positions,
		       a.total_collateral::text, a.total_debt::text, a.refusal_code, a.refusal_detail
		  FROM risk_batches b
		  JOIN risk_batch_aggregates a ON a.batch_id = b.id
		 WHERE b.id = ANY($1::bigint[])
		 ORDER BY b.id DESC, a.engine`, ids)
	if err != nil {
		return nil, fmt.Errorf("read observatory series: %w", err)
	}
	defer rows.Close()
	byID := map[int64]*observatoryBatch{}
	var order []int64
	for rows.Next() {
		var id int64
		var computedAt time.Time
		var a store.RiskEngineAggregate
		var dec int16
		var tc, td string
		if err := rows.Scan(&id, &computedAt, &a.Engine, &dec, &a.Positions, &a.ComputedPositions,
			&a.RefusedPositions, &a.FlaggedPositions, &a.LiquidatablePositions, &tc, &td,
			&a.RefusalCode, &a.RefusalDetail); err != nil {
			return nil, fmt.Errorf("scan observatory row: %w", err)
		}
		a.ValueDecimals = uint8(dec)
		var ok bool
		if a.TotalCollateral, ok = new(big.Int).SetString(tc, 10); !ok {
			return nil, fmt.Errorf("observatory batch %d engine %s: total_collateral %q is not an integer", id, a.Engine, tc)
		}
		if a.TotalDebt, ok = new(big.Int).SetString(td, 10); !ok {
			return nil, fmt.Errorf("observatory batch %d engine %s: total_debt %q is not an integer", id, a.Engine, td)
		}
		b, seen := byID[id]
		if !seen {
			b = &observatoryBatch{BatchID: id, ComputedAt: computedAt.UTC()}
			byID[id] = b
			order = append(order, id)
		}
		b.Aggregates = append(b.Aggregates, a)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate observatory series: %w", err)
	}
	sort.Slice(order, func(i, j int) bool { return order[i] > order[j] })

	vectors, err := readBatchWatermarkVectors(ctx, q, ids)
	if err != nil {
		return nil, err
	}
	out := make([]observatoryBatch, 0, len(order))
	for _, id := range order {
		b := byID[id]
		b.Watermarks = vectors[id]
		if len(b.Watermarks) == 0 {
			// Structurally unreachable for a COMPLETE batch (the predicate
			// requires a non-empty stamped engine set), so an empty vector here
			// is a torn read and must fail loudly: the contract requires the
			// vector (minItems 1) precisely because the point's liquidatable
			// counts are licensed through it.
			return nil, fmt.Errorf("observatory batch %d passed the completeness predicate but carries no watermark stamps — refusing to serve its counts without their sweep clock", id)
		}
		out = append(out, *b)
	}
	return out, nil
}

// readBatchWatermarkVectors reads the FULL stamped engine vector — cursor
// pair, epoch stamps and sweep stamp — for each given batch id, keyed by
// batch id and ordered by engine within each vector.
//
// The sweep columns are assembled under the same law as the store's own
// batch reader: applicability is the ROW'S OWN statement (`sweep_applicable`),
// never inferred from which columns happen to be non-null, and a nil Sweep
// means the engine HAS no sweeper — a disclosed absence, not an empty stamp.
func readBatchWatermarkVectors(ctx context.Context, q store.Querier, ids []int64) (map[int64][]store.RiskBatchWatermark, error) {
	rows, err := q.Query(ctx, `
		SELECT batch_id, engine, chain_id, last_block, acked_epoch, max_epoch_at_compute,
		       sweep_rows, sweep_failed, sweep_success_sum::text, sweep_max_updated_at,
		       sweep_generation, sweep_generation_open, sweep_applicable
		  FROM risk_batch_watermarks
		 WHERE batch_id = ANY($1::bigint[])
		 ORDER BY batch_id, engine`, ids)
	if err != nil {
		return nil, fmt.Errorf("read batch watermark vectors: %w", err)
	}
	defer rows.Close()
	out := map[int64][]store.RiskBatchWatermark{}
	for rows.Next() {
		var batchID int64
		var m store.RiskBatchWatermark
		var sweepRows, sweepFailed, sweepGen *int64
		var sweepSum *string
		var sweepUpdated *time.Time
		var sweepOpen *bool
		var sweepApplicable bool
		if err := rows.Scan(&batchID, &m.Engine, &m.ChainID, &m.LastBlock, &m.AckedEpoch, &m.MaxEpochAtCompute,
			&sweepRows, &sweepFailed, &sweepSum, &sweepUpdated, &sweepGen, &sweepOpen,
			&sweepApplicable); err != nil {
			return nil, fmt.Errorf("scan batch watermark vector: %w", err)
		}
		if sweepApplicable {
			sw := &store.RiskSweepWatermark{Engine: m.Engine}
			if sweepRows != nil {
				sw.Rows = *sweepRows
			}
			if sweepFailed != nil {
				sw.Failed = *sweepFailed
			}
			if sweepSum != nil {
				v, ok := new(big.Int).SetString(*sweepSum, 10)
				if !ok {
					return nil, fmt.Errorf("batch %d sweep_success_sum %q is not an integer", batchID, *sweepSum)
				}
				sw.SuccessSum = v
			}
			if sweepUpdated != nil {
				sw.HasUpdatedAt, sw.MaxUpdatedAt = true, sweepUpdated.UTC()
			}
			if sweepGen != nil {
				sw.Generation = uint64(*sweepGen)
			}
			if sweepOpen != nil {
				sw.GenerationOpen = *sweepOpen
			}
			m.Sweep = sw
		}
		out[batchID] = append(out[batchID], m)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate batch watermark vectors: %w", err)
	}
	return out, nil
}

// readRateIndexes reads the CURRENT accrual index per (engine, asset, kind).
//
// It is deliberately independent of the batch series: `rate_indexes` is written by
// the derivers on their own cadence, so valid current indexes can exist with no
// servable risk batch at all.
//
// DISTINCT ON, because the table is keyed on (engine, asset, block_number, kind)
// and therefore holds the whole history: the latest row per (engine, asset, kind)
// is the current index, and its OWN block is the as-of the surface must disclose.
// `rate_indexes` updates only on ReserveDataUpdated and can trail the derive
// cursor badly (design spec §5, Codex round 1 [H5]) — which is exactly why the
// block travels with the value.
func readRateIndexes(ctx context.Context, q store.Querier) ([]rateIndexRow, error) {
	rows, err := q.Query(ctx,
		`SELECT DISTINCT ON (engine, asset, kind) engine, asset, kind, value::text, block_number
		   FROM rate_indexes
		  ORDER BY engine, asset, kind, block_number DESC`)
	if err != nil {
		return nil, fmt.Errorf("read rate indexes: %w", err)
	}
	defer rows.Close()
	var out []rateIndexRow
	for rows.Next() {
		var r rateIndexRow
		var value string
		var block int64
		if err := rows.Scan(&r.Engine, &r.Asset, &r.Kind, &value, &block); err != nil {
			return nil, fmt.Errorf("scan rate index: %w", err)
		}
		v, ok := new(big.Int).SetString(value, 10)
		if !ok {
			return nil, fmt.Errorf("rate index %s/%x/%s: %q is not an integer", r.Engine, r.Asset, r.Kind, value)
		}
		r.Value, r.Block = v, uint64(block)
		out = append(out, r)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate rate indexes: %w", err)
	}
	return out, nil
}
