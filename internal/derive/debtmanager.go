package derive

import (
	"bytes"
	"context"
	"fmt"
	"math/big"
	"strings"

	"github.com/ethereum/go-ethereum/common"

	"github.com/kaselunt/solvent/internal/decode"
	"github.com/kaselunt/solvent/internal/store"
)

// DebtManager derives normalized debt positions for the ether.fi Debt
// Manager (OP, engine "debt_manager") using the recon-validated
// normalized-index replay model (recon/derivation-notes.md, NORMATIVE:
// "Debt Manager event semantics" + "Debt identity validation"):
//
//	per-user debt is stored as userNormalizedBorrowings[user][token], a
//	normalized USD amount = USD(6-dec) * 1e18 / interestIndex, and live
//	debt = floor(normalized * currentIndex / 1e18).
//
// Exact replay arithmetic (source rounding, DebtManagerCore.sol citations):
//
//	borrow:  net += ceil(usd * 1e18 / idx)   // :469  Rounding.Ceil
//	repay:   net -= floor(usd * 1e18 / idx)  // :507  Rounding.Floor
//	liq:     net -= floor(usd * 1e18 / idx)  // :578  Rounding.Floor
//
// where idx is the SAME-BLOCK DMInterestIndexUpdated.newIndex -- every
// mutating block carries exactly one index update per borrow token
// (empirically confirmed invariant; recon validated 154/154 blocks), so a
// mutating event whose block has no index update is a loud error, never a
// stale-index fold.
//
// Debt genesis: 7,337 borrower positions were seeded by 80
// MigrationBorrowerPositionsSet batches (blocks 149,985,513-149,986,254)
// with NO Borrowed events (recon "Migration finding"). The per-borrower
// seeds live in each migration tx's calldata; they are ALREADY normalized,
// so each seed becomes a migration_genesis debt event with delta =
// NormalizedAmount directly -- no index division.
//
// The deriver keeps a running per-account normalized cache so it can model
// the contract's silent 1-wei residue zeroing after full liquidation
// (DebtManagerCore.sol:549-553 emits nothing; recon caveat 2). The cache is
// warm-startable: NewDebtManager takes a prior-state seed map so a runner
// resuming from a derive cursor injects the balances it already persisted
// (see NewDebtManager).
//
// DebtManager is NOT safe for concurrent use; the runner's single-writer
// contract (D-004) provides serial Process calls in (block, logIndex) order.
type DebtManager struct {
	chain DMChainReads

	// normalized: account -> borrow token -> running normalized debt.
	normalized map[common.Address]map[common.Address]*big.Int

	// index: borrow token -> latest DMInterestIndexUpdated.newIndex and the
	// block it was emitted in (same-block join for mutating events).
	index map[common.Address]indexSnapshot

	// Per-tx Liquidated bookkeeping for the residue rule: the contract's
	// liquidate() runs up to two passes (50% then remainder) inside ONE tx
	// and zeroes a <=1-wei normalized leftover silently after the second.
	liqTx     []byte
	liqCounts map[liqPair]int
}

type indexSnapshot struct {
	value *big.Int
	block uint64
}

type liqPair struct {
	user, token common.Address
}

// DMChainReads is the single chain dependency of the Debt Manager deriver:
// fetching a migration transaction's raw calldata (selector included), where
// the per-borrower genesis seeds live (they are in no log). Implemented by
// *chain.Failover.TxCalldata.
type DMChainReads interface {
	TxCalldata(ctx context.Context, txHash common.Hash) ([]byte, error)
}

// usdcOP is USDC on OP -- the only borrow token with any borrow history
// (100% of the 305,045 historical Borrowed events; recon caveat 1). The
// PriceProviderV2 stable-snaps it to exactly 1e6 inside a ±1% band
// (archive spot-checks held across the full range), and USDC is 6-dec, so
// usd == amount exactly. Any other borrow token needs emit-time oracle
// pricing, which this deriver refuses loudly rather than approximating.
var usdcOP = common.HexToAddress("0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85")

var oneE18 = big.NewInt(1_000_000_000_000_000_000)

// Event type taxonomy persisted into position_events.event_type.
const (
	dmEvBorrow            = "borrow"
	dmEvRepay             = "repay"
	dmEvLiquidation       = "liquidation"
	dmEvLiquidationSeize  = "liquidation_collateral"
	dmEvResidueZeroed     = "residue_zeroed"
	dmEvMigrationGenesis  = "migration_genesis"
	dmEvSupplied          = "supplied"
	dmEvWithdraw          = "withdraw_borrow_token"
	dmEvBorrowApySet      = "borrow_apy_set"
	dmEvBorrowTokenConfig = "borrow_token_config_set"
	dmEvCollateralAdded   = "collateral_token_added"
	dmEvCollateralRemoved = "collateral_token_removed"
	dmEvCollateralConfig  = "collateral_token_config_set"
)

const sideDebt = "debt"

// NewDebtManager builds the Debt Manager deriver.
//
// chain supplies migration-tx calldata (may be nil in contexts that are
// guaranteed to never traverse a MigrationBorrowerPositionsSet log; hitting
// one with a nil chain is a loud error, never a skip).
//
// priorNormalized warm-seeds the running normalized cache: account -> borrow
// token -> normalized amount. A runner resuming from a derive cursor MUST
// seed every account it will re-touch with the event-sourced "debt" balances
// it already persisted (store.BalancesFor shape: asset-hex -> side -> amount,
// converted to this map's address keys), because the residue rule and the
// negative-balance guard both need the true running value. The map is
// deep-copied; later caller mutations are invisible to the deriver. A full
// from-genesis replay passes nil.
func NewDebtManager(chain DMChainReads, priorNormalized map[common.Address]map[common.Address]*big.Int) *DebtManager {
	normalized := make(map[common.Address]map[common.Address]*big.Int, len(priorNormalized))
	for acct, tokens := range priorNormalized {
		inner := make(map[common.Address]*big.Int, len(tokens))
		for tok, v := range tokens {
			inner[tok] = new(big.Int).Set(v)
		}
		normalized[acct] = inner
	}
	return &DebtManager{
		chain:      chain,
		normalized: normalized,
		index:      make(map[common.Address]indexSnapshot),
		liqCounts:  make(map[liqPair]int),
	}
}

// Name implements Engine.
func (dm *DebtManager) Name() string { return "debt_manager" }

// Process implements Engine. It MUST be called in (block, logIndex) order;
// the same-block index join relies on it (the contract updates the index
// before any same-block debt math, so the InterestIndexUpdated log always
// precedes the mutating log it prices).
func (dm *DebtManager) Process(l store.RawLog, d decode.Event) ([]store.PositionEvent, error) {
	switch ev := d.(type) {
	case decode.DMInterestIndexUpdated:
		return dm.processIndexUpdated(l, ev)
	case decode.DMBorrowed:
		return dm.processBorrowed(l, ev)
	case decode.DMRepaid:
		return dm.processRepaid(l, ev)
	case decode.DMLiquidated:
		return dm.processLiquidated(l, ev)
	case decode.DMMigrationBorrowerPositionsSet:
		return dm.processMigration(l, ev)
	case decode.DMSupplied:
		// Supplier-share state is NOT event-derivable (contract-balance
		// dependence, recon caveat 3): record-only flow.
		return dm.recordOnly(l, dmEvSupplied, ev.User.Bytes(), ev.Token.Bytes(), map[string]string{
			"sender": hexAddr(ev.Sender),
			"amount": ev.Amount.String(),
		}), nil
	case decode.DMWithdrawBorrowToken:
		return dm.recordOnly(l, dmEvWithdraw, ev.Withdrawer.Bytes(), ev.BorrowToken.Bytes(), map[string]string{
			"amount": ev.Amount.String(),
		}), nil
	case decode.DMBorrowApySet:
		return dm.recordOnly(l, dmEvBorrowApySet, []byte{}, ev.Token.Bytes(), map[string]string{
			"old_apy": ev.OldApy.String(),
			"new_apy": ev.NewApy.String(),
		}), nil
	case decode.DMBorrowTokenConfigSet:
		return dm.recordOnly(l, dmEvBorrowTokenConfig, []byte{}, ev.Token.Bytes(), map[string]string{
			"interest_index_snapshot":    ev.Config.InterestIndexSnapshot.String(),
			"total_normalized_borrowing": ev.Config.TotalNormalizedBorrowingAmount.String(),
			"total_shares":               ev.Config.TotalSharesOfBorrowTokens.String(),
			"last_update_timestamp":      fmt.Sprintf("%d", ev.Config.LastUpdateTimestamp),
			"borrow_apy":                 fmt.Sprintf("%d", ev.Config.BorrowApy),
			"min_shares":                 ev.Config.MinShares.String(),
		}), nil
	case decode.DMCollateralTokenAdded:
		return dm.recordOnly(l, dmEvCollateralAdded, []byte{}, ev.Token.Bytes(), nil), nil
	case decode.DMCollateralTokenRemoved:
		return dm.recordOnly(l, dmEvCollateralRemoved, []byte{}, ev.Token.Bytes(), nil), nil
	case decode.DMCollateralTokenConfigSet:
		return dm.recordOnly(l, dmEvCollateralConfig, []byte{}, ev.CollateralToken.Bytes(), map[string]string{
			"old_ltv":                   ev.OldConfig.LTV.String(),
			"old_liquidation_threshold": ev.OldConfig.LiquidationThreshold.String(),
			"old_liquidation_bonus":     ev.OldConfig.LiquidationBonus.String(),
			"ltv":                       ev.NewConfig.LTV.String(),
			"liquidation_threshold":     ev.NewConfig.LiquidationThreshold.String(),
			"liquidation_bonus":         ev.NewConfig.LiquidationBonus.String(),
		}), nil
	default:
		return nil, fmt.Errorf("debt_manager deriver: unsupported decoded event %T -- routing bug (this engine derives only Debt Manager events)", d)
	}
}

// processIndexUpdated snapshots the token's index for same-block joins. It
// deliberately emits NO position event: rate observations are persisted by
// the runner via store.SaveRateIndex on this same decoded event, and an
// index move has no per-account balance effect.
func (dm *DebtManager) processIndexUpdated(l store.RawLog, ev decode.DMInterestIndexUpdated) ([]store.PositionEvent, error) {
	if ev.NewIndex == nil || ev.NewIndex.Sign() <= 0 {
		return nil, fmt.Errorf("debt_manager: InterestIndexUpdated for %s at block %d carries non-positive newIndex %v",
			hexAddr(ev.Token), l.BlockNumber, ev.NewIndex)
	}
	dm.index[ev.Token] = indexSnapshot{value: new(big.Int).Set(ev.NewIndex), block: l.BlockNumber}
	return nil, nil
}

func (dm *DebtManager) processBorrowed(l store.RawLog, ev decode.DMBorrowed) ([]store.PositionEvent, error) {
	if ev.Token != usdcOP {
		// 100% of historical borrows are USDC (stable-snapped 1:1 to USD).
		// Anything else cannot be derived from events alone (recon caveat 1).
		return nil, fmt.Errorf("debt_manager: non-stable borrow token %s requires oracle-priced derivation - not yet supported (block %d, tx %x)",
			hexAddr(ev.Token), l.BlockNumber, l.TxHash)
	}
	idx, err := dm.sameBlockIndex(ev.Token, l.BlockNumber)
	if err != nil {
		return nil, err
	}
	usd := ev.Amount // USDC is 6-dec and snapped to exactly 1e6: usd == amount.
	delta := mulDivCeil(usd, oneE18, idx)
	dm.credit(ev.User, ev.Token, delta)
	return []store.PositionEvent{dm.debtEvent(l, 0, dmEvBorrow, ev.User, ev.Token, delta, map[string]string{
		"token_amount": ev.Amount.String(),
		"usd":          usd.String(),
		"index":        idx.String(),
	})}, nil
}

func (dm *DebtManager) processRepaid(l store.RawLog, ev decode.DMRepaid) ([]store.PositionEvent, error) {
	// Repaid.UsdAmount is ALREADY USD 6-dec (asymmetric with Borrowed --
	// recon "Debt Manager event semantics"), so no token gating is needed.
	idx, err := dm.sameBlockIndex(ev.Token, l.BlockNumber)
	if err != nil {
		return nil, err
	}
	removed := mulDivFloor(ev.UsdAmount, oneE18, idx)
	if _, err := dm.debit(ev.User, ev.Token, removed, "Repaid", l); err != nil {
		return nil, err
	}
	return []store.PositionEvent{dm.debtEvent(l, 0, dmEvRepay, ev.User, ev.Token, new(big.Int).Neg(removed), map[string]string{
		"usd":   ev.UsdAmount.String(),
		"index": idx.String(),
		"payer": hexAddr(ev.Payer),
	})}, nil
}

func (dm *DebtManager) processLiquidated(l store.RawLog, ev decode.DMLiquidated) ([]store.PositionEvent, error) {
	idx, err := dm.sameBlockIndex(ev.DebtToken, l.BlockNumber)
	if err != nil {
		return nil, err
	}
	removed := mulDivFloor(ev.DebtLiquidatedUsd, oneE18, idx)
	remaining, err := dm.debit(ev.User, ev.DebtToken, removed, "Liquidated", l)
	if err != nil {
		return nil, err
	}

	events := make([]store.PositionEvent, 0, len(ev.Collateral)+2)
	events = append(events, dm.debtEvent(l, 0, dmEvLiquidation, ev.User, ev.DebtToken, new(big.Int).Neg(removed), map[string]string{
		"usd":             ev.DebtLiquidatedUsd.String(),
		"before_debt_usd": ev.BeforeDebtUsd.String(),
		"index":           idx.String(),
		"liquidator":      hexAddr(ev.Liquidator),
	}))

	// One RECORD-ONLY event per collateral tuple element: collateral is not
	// custodied by the Debt Manager and not event-derivable (recon caveat 4)
	// -- these document the seizure without folding any balance.
	for i, coll := range ev.Collateral {
		events = append(events, store.PositionEvent{
			ChainID:     l.ChainID,
			Engine:      dm.Name(),
			BlockNumber: l.BlockNumber,
			TxHash:      l.TxHash,
			LogIndex:    l.LogIndex,
			Seq:         uint16(i + 1),
			EventType:   dmEvLiquidationSeize,
			Account:     ev.User.Bytes(),
			Asset:       coll.Token.Bytes(),
			Side:        "",
			Delta:       nil,
			Payload: map[string]string{
				"amount":     coll.Amount.String(),
				"bonus":      coll.Bonus.String(),
				"liquidator": hexAddr(ev.Liquidator),
			},
		})
	}

	// Residue rule (recon caveat 2; DebtManagerCore.sol:549-553): after the
	// SECOND Liquidated of the same tx for this (user, debt token), the
	// contract silently zeroes a remaining normalized amount <= 1 wei. Model
	// it with an explicit residue_zeroed event so the derived balance matches
	// on-chain state bit-exactly instead of drifting by 1 wei forever.
	if !bytes.Equal(dm.liqTx, l.TxHash) {
		dm.liqTx = append(dm.liqTx[:0], l.TxHash...)
		dm.liqCounts = make(map[liqPair]int)
	}
	pair := liqPair{ev.User, ev.DebtToken}
	dm.liqCounts[pair]++
	if dm.liqCounts[pair] == 2 && remaining.Sign() > 0 && remaining.Cmp(big.NewInt(1)) <= 0 {
		residue := new(big.Int).Set(remaining)
		dm.setNormalized(ev.User, ev.DebtToken, new(big.Int))
		events = append(events, dm.debtEvent(l, uint16(len(ev.Collateral)+1), dmEvResidueZeroed,
			ev.User, ev.DebtToken, new(big.Int).Neg(residue), map[string]string{
				"residue": residue.String(),
			}))
	}
	return events, nil
}

// processMigration turns one MigrationBorrowerPositionsSet log into one
// migration_genesis debt event PER SEED decoded from the emitting tx's
// calldata, seq 0..N-1 in calldata order. Seeds are already normalized --
// delta = NormalizedAmount with NO index division (recon "Migration
// finding"). The log's Count field must equal the decoded seed count exactly;
// a mismatch aborts with no partial genesis.
func (dm *DebtManager) processMigration(l store.RawLog, ev decode.DMMigrationBorrowerPositionsSet) ([]store.PositionEvent, error) {
	if dm.chain == nil {
		return nil, fmt.Errorf("debt_manager: MigrationBorrowerPositionsSet at block %d needs the emitting tx's calldata but no DMChainReads was configured", l.BlockNumber)
	}
	// Process carries no context (frozen Engine interface); the fetch is a
	// read-only idempotent call bounded per-attempt by the chain layer's
	// own timeout (chain.Failover.attemptTimeout).
	calldata, err := dm.chain.TxCalldata(context.Background(), common.BytesToHash(l.TxHash))
	if err != nil {
		return nil, fmt.Errorf("debt_manager: fetch migration tx %x calldata: %w", l.TxHash, err)
	}
	seeds, err := decode.DecodeMigrationCalldata(calldata)
	if err != nil {
		return nil, fmt.Errorf("debt_manager: decode migration tx %x calldata: %w", l.TxHash, err)
	}
	if ev.Count == nil || !ev.Count.IsUint64() || ev.Count.Uint64() != uint64(len(seeds)) {
		return nil, fmt.Errorf("debt_manager: migration count mismatch on tx %x: log Count=%v, decoded seeds=%d -- refusing partial genesis", l.TxHash, ev.Count, len(seeds))
	}
	events := make([]store.PositionEvent, 0, len(seeds))
	for i, s := range seeds {
		delta := new(big.Int).Set(s.NormalizedAmount)
		dm.credit(s.Borrower, ev.Token, delta)
		// uint16 cast is safe: DecodeMigrationCalldata bounds len(seeds) at
		// 65,536 (the seq-column bound), so i <= 65,535.
		events = append(events, dm.debtEvent(l, uint16(i), dmEvMigrationGenesis, s.Borrower, ev.Token, delta, map[string]string{
			"migration_count": ev.Count.String(),
		}))
	}
	return events, nil
}

// ---------------------------------------------------------------------------
// Cache + arithmetic helpers.
// ---------------------------------------------------------------------------

// sameBlockIndex returns the token's index for a mutating event at block,
// enforcing the one-index-update-per-mutating-block invariant: the snapshot
// must come from THIS block, or the fold would silently price with a stale
// index.
func (dm *DebtManager) sameBlockIndex(token common.Address, block uint64) (*big.Int, error) {
	snap, ok := dm.index[token]
	if !ok {
		return nil, fmt.Errorf("debt_manager: no InterestIndexUpdated seen for token %s before mutating event at block %d (same-block index required)",
			hexAddr(token), block)
	}
	if snap.block != block {
		return nil, fmt.Errorf("debt_manager: no same-block InterestIndexUpdated for token %s at block %d (last update at block %d) -- one-index-update-per-mutating-block invariant violated",
			hexAddr(token), block, snap.block)
	}
	return snap.value, nil
}

func (dm *DebtManager) normalizedOf(user, token common.Address) *big.Int {
	if tokens, ok := dm.normalized[user]; ok {
		if v, ok := tokens[token]; ok {
			return v
		}
	}
	return new(big.Int)
}

func (dm *DebtManager) setNormalized(user, token common.Address, v *big.Int) {
	tokens, ok := dm.normalized[user]
	if !ok {
		tokens = make(map[common.Address]*big.Int)
		dm.normalized[user] = tokens
	}
	tokens[token] = v
}

func (dm *DebtManager) credit(user, token common.Address, amount *big.Int) {
	dm.setNormalized(user, token, new(big.Int).Add(dm.normalizedOf(user, token), amount))
}

// debit subtracts amount from the account's running normalized debt,
// refusing to go negative: the contract's uint256 cannot, so a negative here
// means the replay diverged from chain state (most likely a missing genesis
// seed / warm-start seed) and continuing would persist garbage.
func (dm *DebtManager) debit(user, token common.Address, amount *big.Int, what string, l store.RawLog) (*big.Int, error) {
	next := new(big.Int).Sub(dm.normalizedOf(user, token), amount)
	if next.Sign() < 0 {
		return nil, fmt.Errorf("debt_manager: %s at block %d (tx %x) would drive %s/%s normalized negative (%s): missing genesis seed / warm-start state, or divergent replay",
			what, l.BlockNumber, l.TxHash, hexAddr(user), hexAddr(token), next)
	}
	dm.setNormalized(user, token, next)
	return next, nil
}

func (dm *DebtManager) debtEvent(l store.RawLog, seq uint16, eventType string, account, asset common.Address, delta *big.Int, payload map[string]string) store.PositionEvent {
	return store.PositionEvent{
		ChainID:     l.ChainID,
		Engine:      dm.Name(),
		BlockNumber: l.BlockNumber,
		TxHash:      l.TxHash,
		LogIndex:    l.LogIndex,
		Seq:         seq,
		EventType:   eventType,
		Account:     account.Bytes(),
		Asset:       asset.Bytes(),
		Side:        sideDebt,
		Delta:       delta,
		Payload:     payload,
	}
}

// recordOnly builds the single record-only event for flow/config logs: no
// side, no delta, never touches balances. account is []byte{} (non-nil --
// position_events.account is NOT NULL) for token-level config events with no
// natural account.
func (dm *DebtManager) recordOnly(l store.RawLog, eventType string, account, asset []byte, payload map[string]string) []store.PositionEvent {
	return []store.PositionEvent{{
		ChainID:     l.ChainID,
		Engine:      dm.Name(),
		BlockNumber: l.BlockNumber,
		TxHash:      l.TxHash,
		LogIndex:    l.LogIndex,
		Seq:         0,
		EventType:   eventType,
		Account:     account,
		Asset:       asset,
		Side:        "",
		Delta:       nil,
		Payload:     payload,
	}}
}

// mulDivFloor returns floor(a*b/den) on non-negative inputs.
func mulDivFloor(a, b, den *big.Int) *big.Int {
	return new(big.Int).Quo(new(big.Int).Mul(a, b), den)
}

// mulDivCeil returns ceil(a*b/den) on non-negative inputs: exact divisions
// are NOT bumped.
func mulDivCeil(a, b, den *big.Int) *big.Int {
	q, r := new(big.Int).QuoRem(new(big.Int).Mul(a, b), den, new(big.Int))
	if r.Sign() != 0 {
		q.Add(q, big.NewInt(1))
	}
	return q
}

func hexAddr(a common.Address) string {
	return strings.ToLower(a.Hex())
}
