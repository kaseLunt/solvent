package derive

import (
	"context"
	"encoding/hex"
	"errors"
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
// State lifecycle (derive.Engine): the running normalized cache is
// two-layered. The PROMOTED layer mirrors committed truth, hydrated lazily
// per account, on first touch inside a batch, from the batch's StateReader
// (side "debt" of store.BalancesFor -- the running normalized sum
// ApplyDerived maintains). Absence of a committed row mechanically means
// zero: derivation always starts at genesis (migration seeds + full replay),
// so there is no seed map and no implicit warm start. The WORKING layer is a
// copy-on-write overlay taking every Process mutation until CommitBatch
// promotes it (after the runner's ApplyDerived returned nil) or DiscardBatch
// drops it (a PRE-persistence failure -- a Process error that never reached
// ApplyDerived; a retry of the same logs reproduces identical events with no
// double-mutation). An ApplyDerived ERROR takes Reset instead, never
// DiscardBatch: the commit may have landed despite the error (see
// derive.Engine's commit-indeterminacy rule). Reset drops everything (after
// RewindDerived or an ambiguous commit); the next BeginBatch re-hydrates. The
// per-token index snapshots and per-tx liquidation markers are batch-scoped
// the same way but never hydrated: mutating events REQUIRE a same-block
// index update (re-emitted in any replayed range) and same-tx log runs never
// span a rewind point (rewinds are block-aligned).
//
// The running cache exists so the deriver can model the contract's silent
// 1-wei residue zeroing after full liquidation (DebtManagerCore.sol:549-553
// emits nothing; recon caveat 2) and refuse impossible negative balances.
//
// DebtManager is NOT safe for concurrent use; the runner's single-writer
// contract (D-004) provides serial Process calls in (block, logIndex) order.
type DebtManager struct {
	chain DMChainReads

	// Promoted layer (committed truth).
	promoted      map[common.Address]map[common.Address]*big.Int // account -> borrow token -> normalized
	hydrated      map[common.Address]bool
	promotedIndex map[common.Address]indexSnapshot // borrow token -> latest index
	promotedLiq   dmLiqMarkers

	// Working layer (current attempt), valid only while inBatch.
	inBatch      bool
	batchCtx     context.Context
	reader       StateReader
	working      map[common.Address]map[common.Address]*big.Int
	workingIndex map[common.Address]indexSnapshot
	workingLiq   dmLiqMarkers
}

var _ Engine = (*DebtManager)(nil)

// indexSnapshot values are immutable once stored (updates replace the whole
// value with a fresh big.Int), which makes the shallow per-batch map copy
// sound.
type indexSnapshot struct {
	value *big.Int
	block uint64
}

type liqPair struct {
	user, token common.Address
}

// dmLiqMarkers is the per-tx Liquidated bookkeeping for the residue rule:
// the contract's liquidate() runs up to two passes (50% then remainder)
// inside ONE tx and zeroes a <=1-wei normalized leftover silently after the
// second. Batch-scoped like all other engine state.
type dmLiqMarkers struct {
	tx     string // lowercase hex of the tx the counts belong to
	counts map[liqPair]int
}

func (m dmLiqMarkers) clone() dmLiqMarkers {
	c := dmLiqMarkers{tx: m.tx, counts: make(map[liqPair]int, len(m.counts))}
	for k, v := range m.counts {
		c.counts[k] = v
	}
	return c
}

// DMChainReads is the single chain dependency of the Debt Manager deriver:
// fetching a migration transaction's raw calldata (selector included), where
// the per-borrower genesis seeds live (they are in no log). Implemented by
// *chain.Failover.TxCalldata.
type DMChainReads interface {
	TxCalldata(ctx context.Context, txHash common.Hash) ([]byte, error)
}

// dmStableBorrowDecimals lists the CONFIGURED STABLE borrow tokens (recon
// "Asset registry" roles + caveat 1) with their decimals. For these,
// PriceProviderV2.isStableToken snaps the price to exactly 1e6 USD (6-dec)
// per whole token inside a ±1% band (archive spot-checks held across the
// full range), so Borrowed's token amount converts to USD by the contract's
// own decimal rescaling:
//
//	6-dec  (USDC, USDT): usd = amount
//	18-dec (frxUSD):     usd = floor(amount / 1e12)
//
// The floor is the CONTRACT'S arithmetic, not a deriver choice: the deployed
// borrow path prices the amount via convertCollateralTokenToUsd — usd =
// amount * price / 10^decimals with Solidity's flooring integer division
// (recon/cash-v3 DebtManagerCore.sol:378, reached from borrow() at :468) —
// so with the 1e6 stable snap any sub-1e12 remainder is truncated by the
// contract itself. Refusing non-divisible amounts would reject events the
// contract accepted.
//
// 100% of the 305,045 historical Borrowed events are USDC; USDT and frxUSD
// have zero borrow history but are configured borrow tokens whose stable
// snap makes event-only derivation exact.
var dmStableBorrowDecimals = map[common.Address]uint{
	common.HexToAddress("0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85"): 6,  // USDC
	common.HexToAddress("0x94b008aA00579c1307B0EF2c499aD98a8ce58e58"): 6,  // USDT
	common.HexToAddress("0x80Eede496655FB9047dd39d9f418d5483ED600df"): 18, // frxUSD
}

// ErrUnsupportedBorrowToken is a TERMINAL capability error, not a transient
// one: the borrow token is not a configured stable (recon caveat 1 names the
// genuinely non-stable borrow tokens — liquidUSD, EURC, weEUR, and the two
// liquidRESERVE contracts), so exact USD reconstruction from events alone is
// impossible; it needs the emit-time oracle price. The runner must branch on
// errors.Is and mark the engine UNHEALTHY rather than retry — no replay can
// succeed until the deriver grows oracle-priced derivation.
var ErrUnsupportedBorrowToken = errors.New("debt_manager: unsupported borrow token: exact USD reconstruction requires emit-time oracle pricing")

var (
	oneE18 = big.NewInt(1_000_000_000_000_000_000)
	oneE12 = big.NewInt(1_000_000_000_000)
)

// borrowUsd converts a Borrowed token amount into the USD 6-dec figure the
// contract priced it at, under the stable-snap model documented on
// dmStableBorrowDecimals (6-dec: usd = amount; 18-dec: floor(amount/1e12) --
// the contract's own flooring division, DebtManagerCore.sol:378). Non-stable
// borrow tokens wrap ErrUnsupportedBorrowToken (terminal).
//
// STABLE-SNAP INVARIANT (out-of-band depeg risk; adjudicated posture): the
// 1e6 snap holds only while PriceProviderV2 keeps the token inside its ±1%
// stable band -- a borrow taken while the oracle price sat OUTSIDE the band
// would be silently mispriced here, and per-event archive pricing of all
// 305k historical borrows is infeasible on free RPC. The assumption is
// therefore (a) RECORDED on every borrow (payload "price_source" =
// dmPriceSourceStableSnap), and (b) checked ONLY by sampled evidence with
// explicit detection limits. Attained today: the golden suite's 3 borrowers,
// bit-exact. Planned, not yet run: Task 9's stratified >=25-borrower
// derived-vs-borrowingOf reconciliation. An out-of-band borrow affecting
// only unsampled borrowers would NOT be detected by either; no recurring
// full-population reconciliation exists (a standing health check is a
// P3/riskd deliverable, not implemented here). Deliberately NO per-event
// refusal: it would freeze the deriver on valid in-band events it cannot
// cheaply prove in-band.
func borrowUsd(token common.Address, amount *big.Int, l store.RawLog) (*big.Int, error) {
	decimals, ok := dmStableBorrowDecimals[token]
	if !ok {
		return nil, fmt.Errorf("%w: token %s (block %d, tx %x)",
			ErrUnsupportedBorrowToken, hexAddr(token), l.BlockNumber, l.TxHash)
	}
	switch decimals {
	case 6:
		return new(big.Int).Set(amount), nil
	case 18:
		// floor(amount / 1e12): the contract's usd = amount*price/10^decimals
		// floors (DebtManagerCore.sol:378), so a sub-1e12 remainder is a
		// valid event's truncated dust, never an error.
		return new(big.Int).Quo(amount, oneE12), nil
	default:
		return nil, fmt.Errorf("debt_manager: stable borrow token %s configured with unhandled decimals %d -- config bug", hexAddr(token), decimals)
	}
}

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

// dmPriceSourceStableSnap is stamped into every Borrowed position event's
// payload ("price_source" key): the USD figure was reconstructed under the
// stable-snap-1e6 assumption, not read from an emit-time oracle. Recording
// the provenance per event is leg (a) of the stable-snap invariant posture
// documented on borrowUsd.
const dmPriceSourceStableSnap = "stable_snap_1e6"

// dmEngineName is the engine identifier shared with config/contracts.json,
// the decode registry and the store's derived tables.
const dmEngineName = "debt_manager"

// NewDebtManager builds the Debt Manager deriver with no in-memory state:
// the first BeginBatch hydrates committed truth per touched account (there
// is deliberately NO seed-map constructor path -- committed state is read
// through the StateReader, never injected).
//
// chain supplies migration-tx calldata (may be nil in contexts that are
// guaranteed to never traverse a MigrationBorrowerPositionsSet log; hitting
// one with a nil chain is a loud error, never a skip).
func NewDebtManager(chain DMChainReads) *DebtManager {
	dm := &DebtManager{chain: chain}
	dm.Reset()
	return dm
}

// Name implements Engine.
func (dm *DebtManager) Name() string { return dmEngineName }

// BeginBatch implements Engine: starts an attempt whose mutations land in a
// working overlay, hydrated lazily from reader (committed truth) on first
// touch of each account.
func (dm *DebtManager) BeginBatch(ctx context.Context, reader StateReader) error {
	if dm.inBatch {
		return fmt.Errorf("debt_manager: BeginBatch while a batch is in progress -- Commit or Discard the previous attempt first")
	}
	if ctx == nil || reader == nil {
		return fmt.Errorf("debt_manager: BeginBatch requires a non-nil context and StateReader -- committed-truth hydration is not optional")
	}
	dm.batchCtx, dm.reader = ctx, reader
	dm.working = make(map[common.Address]map[common.Address]*big.Int)
	dm.workingIndex = make(map[common.Address]indexSnapshot, len(dm.promotedIndex))
	for tok, snap := range dm.promotedIndex {
		dm.workingIndex[tok] = snap // snapshots are immutable; shallow copy is sound
	}
	dm.workingLiq = dm.promotedLiq.clone()
	dm.inBatch = true
	return nil
}

// CommitBatch implements Engine: promotes the working overlay. Call ONLY
// after the runner's ApplyDerived returned nil. No-op outside a batch.
func (dm *DebtManager) CommitBatch() {
	if !dm.inBatch {
		return
	}
	for acct, tokens := range dm.working {
		dm.promoted[acct] = tokens
	}
	dm.promotedIndex = dm.workingIndex
	dm.promotedLiq = dm.workingLiq
	dm.endBatch()
}

// DiscardBatch implements Engine: drops the working overlay (PRE-persistence
// failure -- the attempt provably never reached ApplyDerived; an ApplyDerived
// error takes Reset instead, per derive.Engine's commit-indeterminacy rule);
// promoted state and hydration marks are untouched -- hydrated values are
// committed truth and stay valid across a failed attempt. No-op outside a
// batch.
func (dm *DebtManager) DiscardBatch() {
	if !dm.inBatch {
		return
	}
	dm.endBatch()
}

func (dm *DebtManager) endBatch() {
	dm.working, dm.workingIndex = nil, nil
	dm.workingLiq = dmLiqMarkers{}
	dm.batchCtx, dm.reader = nil, nil
	dm.inBatch = false
}

// Reset implements Engine: drops ALL in-memory state (promoted, hydration
// marks, index snapshots, liquidation markers, any in-flight attempt). Call
// after RewindDerived; the next BeginBatch re-hydrates from committed truth.
func (dm *DebtManager) Reset() {
	dm.promoted = make(map[common.Address]map[common.Address]*big.Int)
	dm.hydrated = make(map[common.Address]bool)
	dm.promotedIndex = make(map[common.Address]indexSnapshot)
	dm.promotedLiq = dmLiqMarkers{}
	dm.endBatch()
}

// hydrate loads the account's committed normalized debt through the batch's
// reader into the promoted layer, once per account per engine lifetime
// (until Reset). Hydration writes are durable across DiscardBatch by design:
// they mirror committed truth, which a failed attempt does not change.
func (dm *DebtManager) hydrate(account common.Address) error {
	if dm.hydrated[account] {
		return nil
	}
	bals, err := dm.reader.BalancesFor(dm.batchCtx, dmEngineName, account.Bytes())
	if err != nil {
		return fmt.Errorf("debt_manager: hydrating account %s from committed state: %w", hexAddr(account), err)
	}
	tokens := make(map[common.Address]*big.Int)
	for assetHex, sides := range bals {
		raw, err := hex.DecodeString(assetHex)
		if err != nil || len(raw) != common.AddressLength {
			return fmt.Errorf("debt_manager: hydrating account %s: committed asset key %q is not an address", hexAddr(account), assetHex)
		}
		token := common.BytesToAddress(raw)
		for side, amount := range sides {
			switch side {
			case sideDebt:
				if amount == nil || amount.Sign() < 0 {
					return fmt.Errorf("debt_manager: hydrating account %s: committed debt balance for token %s is %v -- committed truth must be a non-negative integer",
						hexAddr(account), hexAddr(token), amount)
				}
				tokens[token] = new(big.Int).Set(amount)
			case "collateral":
				// Snapshot-owned (recon caveat 4): collateral rows belong to
				// the snapshotter, not to this deriver's normalized cache.
			default:
				return fmt.Errorf("debt_manager: hydrating account %s: committed token %s carries unknown side %q", hexAddr(account), hexAddr(token), side)
			}
		}
	}
	dm.promoted[account] = tokens
	dm.hydrated[account] = true
	return nil
}

// tokensFor returns the account's normalized-debt map for reading: working
// overlay first, else the (hydrated-on-demand) promoted layer. Callers must
// not mutate the result -- use mutableTokensFor for writes.
func (dm *DebtManager) tokensFor(account common.Address) (map[common.Address]*big.Int, error) {
	if tokens, ok := dm.working[account]; ok {
		return tokens, nil
	}
	if err := dm.hydrate(account); err != nil {
		return nil, err
	}
	return dm.promoted[account], nil
}

// mutableTokensFor copies the account's promoted map into the working
// overlay (copy-on-write) so Process mutations never touch committed truth.
func (dm *DebtManager) mutableTokensFor(account common.Address) (map[common.Address]*big.Int, error) {
	if tokens, ok := dm.working[account]; ok {
		return tokens, nil
	}
	if err := dm.hydrate(account); err != nil {
		return nil, err
	}
	tokens := make(map[common.Address]*big.Int, len(dm.promoted[account]))
	for tok, v := range dm.promoted[account] {
		tokens[tok] = new(big.Int).Set(v)
	}
	dm.working[account] = tokens
	return tokens, nil
}

// Process implements Engine. It MUST be called in (block, logIndex) order;
// the same-block index join relies on it (the contract updates the index
// before any same-block debt math, so the InterestIndexUpdated log always
// precedes the mutating log it prices). Only valid inside a batch
// (BeginBatch).
func (dm *DebtManager) Process(l store.RawLog, d decode.Event) ([]store.PositionEvent, error) {
	if !dm.inBatch {
		return nil, fmt.Errorf("debt_manager: Process called outside a batch -- BeginBatch starts the attempt lifecycle (see derive.Engine)")
	}
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
	dm.workingIndex[ev.Token] = indexSnapshot{value: new(big.Int).Set(ev.NewIndex), block: l.BlockNumber}
	return nil, nil
}

func (dm *DebtManager) processBorrowed(l store.RawLog, ev decode.DMBorrowed) ([]store.PositionEvent, error) {
	// Capability gate first: a non-stable borrow token is terminal
	// (ErrUnsupportedBorrowToken) regardless of index state.
	usd, err := borrowUsd(ev.Token, ev.Amount, l)
	if err != nil {
		return nil, err
	}
	idx, err := dm.sameBlockIndex(ev.Token, l.BlockNumber)
	if err != nil {
		return nil, err
	}
	delta := mulDivCeil(usd, oneE18, idx)
	if err := dm.credit(ev.User, ev.Token, delta); err != nil {
		return nil, err
	}
	return []store.PositionEvent{dm.debtEvent(l, 0, dmEvBorrow, ev.User, ev.Token, delta, map[string]string{
		"token_amount": ev.Amount.String(),
		"usd":          usd.String(),
		"index":        idx.String(),
		"price_source": dmPriceSourceStableSnap,
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
	if tx := hex.EncodeToString(l.TxHash); tx != dm.workingLiq.tx {
		dm.workingLiq = dmLiqMarkers{tx: tx, counts: make(map[liqPair]int)}
	}
	pair := liqPair{ev.User, ev.DebtToken}
	dm.workingLiq.counts[pair]++
	if dm.workingLiq.counts[pair] == 2 && remaining.Sign() > 0 && remaining.Cmp(big.NewInt(1)) <= 0 {
		residue := new(big.Int).Set(remaining)
		if err := dm.setNormalized(ev.User, ev.DebtToken, new(big.Int)); err != nil {
			return nil, err
		}
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
	// The fetch runs under the batch's context (BeginBatch) and is a
	// read-only idempotent call additionally bounded per-attempt by the
	// chain layer's own timeout (chain.Failover.attemptTimeout).
	calldata, err := dm.chain.TxCalldata(dm.batchCtx, common.BytesToHash(l.TxHash))
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
		if err := dm.credit(s.Borrower, ev.Token, delta); err != nil {
			return nil, err
		}
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
	snap, ok := dm.workingIndex[token]
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

// normalizedOf returns the account's running normalized debt for token,
// hydrating the account's committed truth on first touch. Zero when no
// committed or working entry exists (absence means zero, post-genesis
// invariant). The result must not be mutated.
func (dm *DebtManager) normalizedOf(user, token common.Address) (*big.Int, error) {
	tokens, err := dm.tokensFor(user)
	if err != nil {
		return nil, err
	}
	if v, ok := tokens[token]; ok {
		return v, nil
	}
	return new(big.Int), nil
}

func (dm *DebtManager) setNormalized(user, token common.Address, v *big.Int) error {
	tokens, err := dm.mutableTokensFor(user)
	if err != nil {
		return err
	}
	tokens[token] = v
	return nil
}

func (dm *DebtManager) credit(user, token common.Address, amount *big.Int) error {
	cur, err := dm.normalizedOf(user, token)
	if err != nil {
		return err
	}
	return dm.setNormalized(user, token, new(big.Int).Add(cur, amount))
}

// debit subtracts amount from the account's running normalized debt,
// refusing to go negative: the contract's uint256 cannot, so a negative here
// means the replay diverged from chain state (most likely missing committed
// genesis state) and continuing would persist garbage.
func (dm *DebtManager) debit(user, token common.Address, amount *big.Int, what string, l store.RawLog) (*big.Int, error) {
	cur, err := dm.normalizedOf(user, token)
	if err != nil {
		return nil, err
	}
	next := new(big.Int).Sub(cur, amount)
	if next.Sign() < 0 {
		return nil, fmt.Errorf("debt_manager: %s at block %d (tx %x) would drive %s/%s normalized negative (%s): missing genesis seed / committed warm-start state, or divergent replay",
			what, l.BlockNumber, l.TxHash, hexAddr(user), hexAddr(token), next)
	}
	if err := dm.setNormalized(user, token, next); err != nil {
		return nil, err
	}
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
