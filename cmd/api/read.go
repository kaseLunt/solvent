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
}

// readBatch reads the newest complete batch and everything needed to serve it.
//
// account, when non-nil, scopes the CHILD rows (positions, legs, price inputs)
// to one address. The batch header, its stamps and the engine aggregates are
// always whole — an address response still has to disclose which batch it came
// from and whether that batch is superseded.
func (s *server) readBatch(ctx context.Context, account []byte) (*batchView, error) {
	batch, found, err := s.store.NewestCompleteBatch(ctx)
	if err != nil {
		return nil, err
	}
	if !found {
		return nil, errNoBatch
	}

	tx, err := s.store.BeginRiskSnapshot(ctx)
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	v := &batchView{Batch: batch}
	if err := tx.QueryRow(ctx, `SELECT now()`).Scan(&v.Now); err != nil {
		return nil, fmt.Errorf("read database clock: %w", err)
	}
	v.Now = v.Now.UTC()

	if v.Cursors, err = store.DeriveCursorStates(ctx, tx); err != nil {
		return nil, err
	}
	if v.MaxEpochs, err = store.MaxReorgEpochs(ctx, tx); err != nil {
		return nil, err
	}
	if v.Sweeps, err = store.RiskSweepStateFor(ctx, tx, s.sweptEngines()); err != nil {
		return nil, err
	}
	if v.Positions, err = readPositions(ctx, tx, batch.ID, account); err != nil {
		return nil, err
	}
	if err := attachLegs(ctx, tx, batch.ID, account, v.Positions); err != nil {
		return nil, err
	}
	if err := attachPrices(ctx, tx, batch.ID, account, v.Positions); err != nil {
		return nil, err
	}
	if v.Aggregates, err = readAggregates(ctx, tx, batch.ID); err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("commit read snapshot: %w", err)
	}

	// Reconstruction happens AFTER the snapshot is released: it is pure CPU work
	// over rows already in memory, and holding a transaction open across it would
	// pin xmin for no reason (round-10 M5).
	s.reconstructAll(v.Positions)
	return v, nil
}

// positionKey identifies a position within a batch.
func positionKey(engine string, account []byte) string {
	return engine + "/" + common.BytesToAddress(account).Hex()
}

func readPositions(ctx context.Context, q store.Querier, batchID int64, account []byte) ([]*positionRow, error) {
	const base = `SELECT engine, account, status, refusal_code, refusal_detail, refusal_asset, flags,
	        value_decimals, hf_num::text, hf_den::text, hf_wad::text, hf_infinite,
	        total_collateral_base::text, total_debt_base::text, weighted_lt_sum::text, avg_lt_bps::text,
	        collateral_value_usd::text, max_borrow_lt::text, borrowings::text, liquidatable,
	        balances_block, params_block, sweep_block, oldest_price_input, stale_price_inputs
	   FROM risk_positions
	  WHERE batch_id = $1 AND ($2::bytea IS NULL OR account = $2)
	  ORDER BY engine, account`
	rows, err := q.Query(ctx, base, batchID, account)
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

func attachLegs(ctx context.Context, q store.Querier, batchID int64, account []byte, positions []*positionRow) error {
	rows, err := q.Query(ctx,
		`SELECT engine, account, asset, decimals,
		        scaled_debt::text, scaled_collateral::text, live_debt::text, live_collateral::text,
		        debt_base::text, collateral_base::text, weighted_lt::text, used_as_collateral,
		        debt_index_block, collateral_index_block,
		        amount::text, value_usd::text, max_borrow_contribution::text,
		        liq_threshold::text, liq_bonus::text
		   FROM risk_position_legs
		  WHERE batch_id = $1 AND ($2::bytea IS NULL OR account = $2)
		  ORDER BY engine, account, asset`, batchID, account)
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

func attachPrices(ctx context.Context, q store.Querier, batchID int64, account []byte, positions []*positionRow) error {
	rows, err := q.Query(ctx,
		`SELECT engine, account, asset, chain_id, source, provenance,
		        value::text, decimals, block_number, source_as_of,
		        budget_seconds, verdict, age_seconds
		   FROM risk_price_inputs
		  WHERE batch_id = $1 AND ($2::bytea IS NULL OR account = $2)
		  ORDER BY engine, account, asset, source`, batchID, account)
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

func readAggregates(ctx context.Context, q store.Querier, batchID int64) ([]store.RiskEngineAggregate, error) {
	rows, err := q.Query(ctx,
		`SELECT engine, value_decimals, positions, computed_positions, refused_positions,
		        flagged_positions, liquidatable_positions, total_collateral::text, total_debt::text
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
			&a.FlaggedPositions, &a.LiquidatablePositions, &tc, &td); err != nil {
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
func (s *server) reconstructAll(positions []*positionRow) {
	for _, p := range positions {
		if p.Status != store.RiskPositionComputed {
			continue
		}
		in, err := s.reconstruct(p)
		if err != nil {
			p.reconstructionErr = err.Error()
			continue
		}
		if err := verifyReconstruction(p, in); err != nil {
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
			in.Collateral = append(in.Collateral, risk.DMCollateral{
				Asset:    asset,
				Amount:   cloneOrZero(l.Amount),
				Decimals: uint8(l.Decimals),
			})
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
func verifyReconstruction(p *positionRow, in risk.PositionInput) error {
	switch p.Engine {
	case risk.AaveEngine:
		h, err := risk.ComputeAaveHealth(*in.Aave)
		if err != nil {
			return fmt.Errorf("recompute refused the reconstructed position: %w", err)
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
		for _, c := range []struct {
			name string
			got  *big.Int
			want *big.Int
		}{
			{"total_collateral_base", h.TotalCollateralBase, p.TotalCollateralBase},
			{"total_debt_base", h.TotalDebtBase, p.TotalDebtBase},
			{"weighted_lt_sum", h.WeightedLTSum, p.WeightedLTSum},
		} {
			if !eqBig(c.got, c.want) {
				return fmt.Errorf("reconstructed %s %s, the batch persisted %s", c.name, showBig(c.got), showBig(c.want))
			}
		}
		return nil

	case risk.DMEngine:
		h, err := risk.ComputeDMHealth(*in.DM)
		if err != nil {
			return fmt.Errorf("recompute refused the reconstructed position: %w", err)
		}
		if p.Liquidatable == nil {
			return errors.New("the batch persisted no liquidatable verdict for a computed Debt Manager position")
		}
		if h.Liquidatable != *p.Liquidatable {
			return fmt.Errorf("reconstructed liquidatable=%v, the batch persisted %v", h.Liquidatable, *p.Liquidatable)
		}
		for _, c := range []struct {
			name string
			got  *big.Int
			want *big.Int
		}{
			{"collateral_value_usd", h.CollateralValueUSD, p.CollateralValueUSD},
			{"max_borrow_lt", h.MaxBorrowLT, p.MaxBorrowLT},
			{"borrowings", h.Borrowings, p.Borrowings},
		} {
			if !eqBig(c.got, c.want) {
				return fmt.Errorf("reconstructed %s %s, the batch persisted %s", c.name, showBig(c.got), showBig(c.want))
			}
		}
		return nil
	}
	return fmt.Errorf("engine %q has no verification", p.Engine)
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
// Completeness is applied by joining on the same header fields
// `NewestCompleteBatch` requires and then filtering to batch ids whose declared
// child cardinalities are met — expressed here as a subquery over the ids the
// store's predicate would admit. A series that quietly included torn batches
// would show a book that dropped and recovered for no reason on the chain.
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

	rows, err := tx.Query(ctx, `
		WITH servable AS (
		  SELECT b.id, b.computed_at
		    FROM risk_batches b
		   WHERE b.status = 'complete'
		     AND (SELECT count(*) FROM risk_positions p WHERE p.batch_id = b.id) = b.position_count
		     AND (SELECT count(*) FROM risk_batch_aggregates a WHERE a.batch_id = b.id) = b.aggregate_count
		     AND cardinality(b.required_engines) > 0
		   ORDER BY b.id DESC
		   LIMIT $1)
		SELECT s.id, s.computed_at, a.engine, a.value_decimals, a.positions, a.computed_positions,
		       a.refused_positions, a.flagged_positions, a.liquidatable_positions,
		       a.total_collateral::text, a.total_debt::text
		  FROM servable s
		  JOIN risk_batch_aggregates a ON a.batch_id = s.id
		 ORDER BY s.id DESC, a.engine`, limit)
	if err != nil {
		return time.Time{}, nil, nil, fmt.Errorf("read observatory series: %w", err)
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
			&a.RefusedPositions, &a.FlaggedPositions, &a.LiquidatablePositions, &tc, &td); err != nil {
			return time.Time{}, nil, nil, fmt.Errorf("scan observatory row: %w", err)
		}
		a.ValueDecimals = uint8(dec)
		var ok bool
		if a.TotalCollateral, ok = new(big.Int).SetString(tc, 10); !ok {
			return time.Time{}, nil, nil, fmt.Errorf("observatory batch %d engine %s: total_collateral %q is not an integer", id, a.Engine, tc)
		}
		if a.TotalDebt, ok = new(big.Int).SetString(td, 10); !ok {
			return time.Time{}, nil, nil, fmt.Errorf("observatory batch %d engine %s: total_debt %q is not an integer", id, a.Engine, td)
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
		return time.Time{}, nil, nil, fmt.Errorf("iterate observatory series: %w", err)
	}
	sort.Slice(order, func(i, j int) bool { return order[i] > order[j] })
	for _, id := range order {
		out = append(out, *byID[id])
	}

	// DISTINCT ON, because `rate_indexes` is keyed on (engine, asset,
	// block_number, kind) and therefore holds the whole history: the latest row
	// per (engine, asset, kind) is the current index, and its own block is the
	// as-of the surface must disclose. `rate_indexes` updates only on
	// ReserveDataUpdated and can trail the derive cursor badly (design spec §5,
	// Codex round 1 [H5]) — which is exactly why the block travels with the value.
	irows, err := tx.Query(ctx,
		`SELECT DISTINCT ON (engine, asset, kind) engine, asset, kind, value::text, block_number
		   FROM rate_indexes
		  ORDER BY engine, asset, kind, block_number DESC`)
	if err != nil {
		return time.Time{}, nil, nil, fmt.Errorf("read rate indexes: %w", err)
	}
	defer irows.Close()
	for irows.Next() {
		var r rateIndexRow
		var value string
		var block int64
		if err := irows.Scan(&r.Engine, &r.Asset, &r.Kind, &value, &block); err != nil {
			return time.Time{}, nil, nil, fmt.Errorf("scan rate index: %w", err)
		}
		v, ok := new(big.Int).SetString(value, 10)
		if !ok {
			return time.Time{}, nil, nil, fmt.Errorf("rate index %s/%x/%s: %q is not an integer", r.Engine, r.Asset, r.Kind, value)
		}
		r.Value, r.Block = v, uint64(block)
		indexes = append(indexes, r)
	}
	if err := irows.Err(); err != nil {
		return time.Time{}, nil, nil, fmt.Errorf("iterate rate indexes: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return time.Time{}, nil, nil, fmt.Errorf("commit observatory snapshot: %w", err)
	}
	return now, out, indexes, nil
}
