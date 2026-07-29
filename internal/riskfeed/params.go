// Package riskfeed is the store→risk adapter layer: it turns the durable rows
// `internal/store` reads into the exact input types `internal/risk` consumes,
// and turns risk's results back into the row shapes `store.WriteRiskBatch`
// persists.
//
// # Why this is a package and not a file inside cmd/riskd
//
// The param fold below is the arithmetic that decides which liquidation
// threshold a health factor uses. `cmd/riskd` needs it; so does the Task-6
// reconcile weld, which compares event-derived CURRENT params against pinned
// `getConfiguration` reads and must fold the same ledger the same way. Two
// implementations of "what is the effective parameter set" is how a weld passes
// against a fold nobody else uses — the same failure shape `rewindTarget`
// exists as a single home to prevent (internal/store/params.go). One
// implementation, importable, unit-tested without a database.
//
// # This package performs no I/O
//
// It imports `internal/store` for its row TYPES and `internal/risk` for its
// input types, and nothing else that touches a database, a socket or a clock.
// Every judgement it makes about time is made against a clock passed IN — the
// database's `now()` read inside the pass's snapshot — because every age
// Solvent publishes is DB-clock minus a durable stamp, never a process clock
// (chain-truth R4.1).
package riskfeed

import (
	"errors"
	"fmt"
	"math/big"
	"sort"

	"github.com/ethereum/go-ethereum/common"

	"github.com/kaselunt/solvent/internal/risk"
	"github.com/kaselunt/solvent/internal/store"
)

var (
	// ErrParamLedgerUnordered refuses a ledger prefix that is not in
	// (effective_block, effective_log_index) order. The fold is
	// LAST-non-nil-per-field, and "last" is meaningless over an unordered
	// slice: the same rows in a different order would produce a different
	// liquidation threshold. store.ParamsAsOf and store.DMParamsAsOf both
	// guarantee the order; this refuses a caller that assembled its own.
	ErrParamLedgerUnordered = errors.New("riskfeed: param ledger is not in (block, log_index) order")
	// ErrParamEngineMismatch refuses a row tagged with an engine other than the
	// one being folded. The Aave and Debt Manager threshold denominators differ
	// by 1e16 and the engine tag is the only evidence of which one a row
	// carries, so a mis-tagged row silently mixed into a fold is a 1e16× error
	// in a liquidation threshold.
	ErrParamEngineMismatch = errors.New("riskfeed: param row engine does not match the fold")
	// ErrParamChainMismatch refuses a row from another chain. Params key on
	// (block_number, log_index) PER CHAIN and join per engine — two chains'
	// block numbers are not comparable and folding them together would order
	// facts by a coincidence of height (chain-truth R3).
	ErrParamChainMismatch = errors.New("riskfeed: param row chain does not match the fold")
	// ErrParamBadAddress refuses a stored address that is not 20 bytes. The
	// store carries raw bytes and go-ethereum's common.Address is a fixed
	// array, so a short value would be silently left-padded into a DIFFERENT
	// address rather than rejected.
	ErrParamBadAddress = errors.New("riskfeed: param row asset is not a 20-byte address")
	// ErrParamEModeUnsupported refuses a fold containing a nonzero eMode
	// category. See FoldParams' doc comment: riskd cannot read a USER's eMode
	// category under the zero-RPC law, so it computes as category 0, and that
	// is only honest while no category exists to be in.
	ErrParamEModeUnsupported = errors.New("riskfeed: param ledger declares a nonzero eMode category, which riskd cannot resolve per user")
)

// FoldParams folds a (block, log_index)-ordered param LEDGER PREFIX into ONE
// effective risk.ParamRow per asset, by LAST-NON-NIL PER FIELD.
//
// # Why per field, and why this is the whole point of the function
//
// store.ParamRow records what ITS OWN EVENT said and nothing else. A
// `CollateralConfigurationChanged` row carries LTV / liquidation threshold /
// liquidation bonus with nil registry fields; a `ReserveInitialized` row
// carries the registry addresses and nil ratios. nil means "this event did not
// speak to this field", never zero.
//
// A last-ROW-wins fold therefore lets a registry row that landed later MASK a
// live liquidation threshold — the effective threshold becomes nil, the health
// factor becomes wrong, and nothing anywhere says so. store/params.go's
// ParamsAsOf documents exactly this and deliberately returns the ledger rather
// than folding, leaving the fold to be written once, here, where the per-engine
// denominator is already known. TestFoldParamsRegistryRowCannotMaskThreshold
// is the masking-attempt fixture.
//
// # What is carried through, and why LiqBonus is named
//
// LTV, LiqThreshold and LiqBonus all fold independently. LiqBonus is called out
// because dropping it is not a missing field — `internal/risk` falls back to a
// 1.00× seizure multiplier when a bonus is absent, so an Aave book folded
// without bonuses silently reports par recovery and UNDERSTATES bad debt. The
// deriver populates it from CollateralConfigurationChanged; this is the link
// that gets it to the arithmetic.
//
// Engine and ChainID are carried through UNCHANGED. `internal/risk` refuses a
// param row whose engine tag does not match the consuming surface
// (ErrParamEngineMismatch there), and that guard is load-bearing: it is the only
// thing standing between a 100e18-denominated Debt Manager threshold and an Aave
// surface that would divide it by 1e4. Normalizing, defaulting or dropping the
// tag here would disarm it.
//
// # The effective position stamped on the result
//
// EffectiveBlock/EffectiveLogIndex are the position of the newest row that
// CONTRIBUTED a field — not the newest row mentioning the asset. A
// ReserveInitialized landing after a threshold change does not move the
// effective threshold, so it must not move the stamp that says when the
// threshold last changed.
//
// # eMode
//
// A nonzero eMode category anywhere in the ledger is REFUSED. eMode categories
// override every reserve threshold with category parameters, and the category a
// given USER is in is `getUserEMode` — an on-chain read riskd may not make
// (chain-truth R6.3, zero RPC). Computing with category-0 thresholds while a
// category exists would be a wrong health factor with no signal that it is
// wrong. The probe settled category 0 for every live borrower, so this refusal
// is currently inert; it is here so that stops being an assumption the moment
// governance changes it.
func FoldParams(engine string, chainID uint64, ledger []store.ParamRow) ([]risk.ParamRow, error) {
	type acc struct {
		row   risk.ParamRow
		order int
	}
	byAsset := map[common.Address]*acc{}
	var order []common.Address

	prevBlock, prevLog := uint64(0), uint32(0)
	for i, r := range ledger {
		if i > 0 && (r.EffectiveBlock < prevBlock ||
			(r.EffectiveBlock == prevBlock && r.EffectiveLogIndex < prevLog)) {
			return nil, fmt.Errorf("%w: row %d at (%d,%d) follows (%d,%d)",
				ErrParamLedgerUnordered, i, r.EffectiveBlock, r.EffectiveLogIndex, prevBlock, prevLog)
		}
		prevBlock, prevLog = r.EffectiveBlock, r.EffectiveLogIndex

		if r.Engine != engine {
			return nil, fmt.Errorf("%w: row %x/%d is engine %q, folding %q",
				ErrParamEngineMismatch, r.Asset, r.EffectiveLogIndex, r.Engine, engine)
		}
		if r.ChainID != chainID {
			return nil, fmt.Errorf("%w: row %x/%d is chain %d, folding chain %d",
				ErrParamChainMismatch, r.Asset, r.EffectiveLogIndex, r.ChainID, chainID)
		}
		if r.EModeCategory != nil && *r.EModeCategory != 0 {
			return nil, fmt.Errorf("%w: asset %x category %d at block %d",
				ErrParamEModeUnsupported, r.Asset, *r.EModeCategory, r.EffectiveBlock)
		}
		if len(r.Asset) != common.AddressLength {
			return nil, fmt.Errorf("%w: %d bytes (%x)", ErrParamBadAddress, len(r.Asset), r.Asset)
		}
		asset := common.BytesToAddress(r.Asset)

		a, ok := byAsset[asset]
		if !ok {
			a = &acc{row: risk.ParamRow{Engine: r.Engine, ChainID: r.ChainID, Asset: asset}, order: len(order)}
			byAsset[asset] = a
			order = append(order, asset)
		}

		// LAST-NON-NIL PER FIELD. A row that did not speak to a field leaves the
		// accumulated value alone — this is the masking guard, and it is the
		// only line in this function that has to be right.
		contributed := false
		if r.LTV != nil {
			a.row.LTV = new(big.Int).Set(r.LTV)
			contributed = true
		}
		if r.LiqThreshold != nil {
			a.row.LiqThreshold = new(big.Int).Set(r.LiqThreshold)
			contributed = true
		}
		if r.LiqBonus != nil {
			a.row.LiqBonus = new(big.Int).Set(r.LiqBonus)
			contributed = true
		}
		if contributed {
			a.row.EffectiveBlock = r.EffectiveBlock
			a.row.EffectiveLogIndex = uint(r.EffectiveLogIndex)
			a.row.Source = r.SourceEvent
		}
	}

	out := make([]risk.ParamRow, 0, len(order))
	for _, asset := range order {
		out = append(out, byAsset[asset].row)
	}
	// Deterministic output order: assets sort bytewise. The map iteration above
	// is already avoided by `order`, but insertion order depends on ledger
	// content, and a caller diffing two folds wants a stable sequence.
	sort.Slice(out, func(i, j int) bool {
		return string(out[i].Asset.Bytes()) < string(out[j].Asset.Bytes())
	})
	return out, nil
}

// ParamsByAsset indexes a folded set for lookup, refusing duplicates. FoldParams
// cannot produce a duplicate; this is the wall for a caller that concatenated
// two folds.
func ParamsByAsset(rows []risk.ParamRow) (map[common.Address]risk.ParamRow, error) {
	out := make(map[common.Address]risk.ParamRow, len(rows))
	for _, r := range rows {
		if _, dup := out[r.Asset]; dup {
			return nil, fmt.Errorf("riskfeed: duplicate folded param row for asset %s", r.Asset.Hex())
		}
		out[r.Asset] = r
	}
	return out, nil
}
