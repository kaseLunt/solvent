package riskfeed

// Assembly: one snapshot of durable rows → the positions a batch is made of.
//
// EVERY POSITION IS EITHER COMPUTED OR REFUSED, AND BOTH ARE ROWS. An account
// that vanishes from a batch reads downstream as "no risk here", which is the
// false-safety direction; so a refusal is written with its gate code and the
// asset that caused it, and the previous batch's number stands until the next
// pass heals it (design spec §7).

import (
	"encoding/hex"
	"fmt"
	"math/big"
	"sort"
	"time"

	"github.com/ethereum/go-ethereum/common"

	"github.com/kaselunt/solvent/internal/decode"
	"github.com/kaselunt/solvent/internal/risk"
	"github.com/kaselunt/solvent/internal/store"
)

// AlgorithmRevision is the version of THE LAWS IN THIS FILE and everything they
// call. It is part of the materialization identity, and it lives here — at the top
// of the assembler, not in some config package — so that anyone editing the
// arithmetic below sees it in the same diff.
//
// # BUMP THIS WHENEVER THE MATH OR THE REFUSAL RULES CHANGE
//
// Changing what a number MEANS without bumping this is a silent correctness bug,
// and a specific one: an upgraded binary computing over unchanged state derives the
// OLD key, adopts the OLD-code batch, and publishes the previous release's numbers
// under the new release's name. The corrected arithmetic never reaches anyone.
//
// It must be bumped for a change to any of:
//
//   - this file — assembly, refusal codes, gate ordering, aggregation;
//   - prices.go — provenance classification, freshness phases, budget/ceiling law;
//   - params.go — the per-field fold, engine/chain tagging, eMode handling;
//   - registry.go — how a valuation witness is chosen;
//   - internal/risk — any health-factor, valuation, or rounding change. That
//     package carries no revision constant of its own, so this one stands in for
//     it: a math change there REQUIRES a bump here.
//
// It must NOT be bumped for comments, logging, test-only changes, or refactors that
// provably preserve every output — those are the same laws, and a bump would
// pointlessly re-materialize the entire book.
//
// Revision log:
//
//	1 — P3 Task 5 initial materializer (assembly, G1-G5, per-field param fold).
//	2 — The COLLATERAL LAW changed from assume-true to witness-derived
//	    (see assembleAave). Every Aave position's TotalCollateralBase,
//	    WeightedLTSum, AvgLTBps and per-leg CollateralBase can move, and the
//	    engine aggregate's TotalCollateral drops. This is exactly the
//	    "changing what a number MEANS" case above: an unbumped binary would
//	    re-derive the old key over unchanged state, adopt the assume-true batch,
//	    and publish the overstated collateral under the corrected release's name.
const AlgorithmRevision = 2

// Balance sides and sources, as internal/derive writes them.
const (
	sideDebt       = "debt"
	sideCollateral = "collateral"

	sourceEvent    = "event"
	sourceSnapshot = "snapshot"
)

// Rate-index kinds, as internal/derive's runner persists them.
const (
	kindVariableBorrowIndex = "variable_borrow_index"
	kindLiquidityIndex      = "liquidity_index"
	kindBorrowIndex         = "borrow_index"
)

// Refusal codes beyond the G-gates: sweep custody, and engine-level refusals
// raised by internal/risk itself.
const (
	// GateSweepNever — the account has never had a SUCCESSFUL collateral
	// sweep: either no snapshot_sweeps row at all (never attempted) or a row
	// whose last_success_block is still 0. Its collateral is of UNKNOWN size,
	// not zero, and serving HF≈0 over it is a false liquidation alarm — the
	// `0xe957…bf20` posture, at the row level (chain-truth R6.4).
	GateSweepNever = "SWEEP_NEVER"
	// GateEngine — internal/risk refused the input. The wrapped error is
	// carried into refusal_detail verbatim, because it already names the asset
	// and the reason.
	GateEngine = "ENGINE"
	// GateFlagCustodyUnproven — the Aave engine's derived state cannot be shown
	// to have been walked from its start block under a decode registry that
	// includes the collateral-flag events, so the collateral law's
	// absence-is-truth reading is not licensed.
	//
	// IT IS WHOLE-ENGINE, NOT PER POSITION, and that is the finding it closes.
	// The precondition is a property of the LEDGER, so if it fails, every Aave
	// row is suspect — not the one that happens to be missing a witness. A
	// per-position version would let 23 genuinely-enabled weETH legs be published
	// as zero collateral (health factor zero, a false liquidation alarm) while the
	// batch reported itself clean, which is exactly what an unbackfilled database
	// would have produced. Refusing the book is the "cannot verify is never
	// advisory" posture applied to derivation provenance.
	GateFlagCustodyUnproven = "FLAG_CUSTODY_UNPROVEN"
)

// EngineBinding is one engine's identity across the tables it touches.
type EngineBinding struct {
	// Engine is the internal/risk surface identity (risk.AaveEngine / risk.DMEngine).
	Engine string
	// ChainID is the chain its derive cursor is bound to.
	ChainID uint64
	// ParamEngine is the engine whose param rows this surface consumes:
	// "aave_param" for Aave, "debt_manager" for the Debt Manager (whose params
	// are a view over its OWN position_events).
	ParamEngine string
	// PriceEngine is the derive-cursor engine that OWNS the valuation price
	// rows on this chain ("prices:poll:<chain>"). Its acked_epoch is what gate
	// G2 reads.
	PriceEngine string
	// GenesisBlock is the engine's own start block — the lowest block its streams
	// are configured to walk from.
	//
	// It is here because a law that reads ABSENCE as chain truth needs to know how
	// far back the walk behind the current state must reach for that reading to be
	// licensed, and "as far back as the engine begins" is the only honest answer.
	// Zero is not "no requirement": store.CoverageProvenBack refuses a zero
	// genesis outright, so an unwired binding fails CLOSED rather than declaring
	// every engine proven. See GateFlagCustodyUnproven.
	GenesisBlock uint64
}

// AssembleConfig is everything a pass needs that is not in the snapshot.
type AssembleConfig struct {
	Registry *Registry
	Aave     EngineBinding
	DM       EngineBinding

	Budget  PriceBudget
	StepBps int64

	// PrevPrices are the values the PREVIOUS batch disclosed, keyed by
	// priceKey(); nil on the first pass. The G5 comparison is against what we
	// last told somebody, which is the only baseline that makes "this moved a
	// lot since you last looked" a true statement.
	PrevPrices map[string]*big.Int
}

// AssembleResult is a pass's output, ready for store.WriteRiskBatch.
type AssembleResult struct {
	Positions  []store.RiskPositionWrite
	Aggregates []store.RiskEngineAggregate
	// Book is the COMPUTED positions in internal/risk's own input form. The
	// stress and waterfall surfaces consume it; this task does not persist
	// their outputs (see migration 00013's note on risk_scenarios /
	// risk_waterfall), and the field exists so those producers do not have to
	// re-assemble the book from the persisted rows — which would be a second
	// assembly, and a second place for it to be wrong.
	Book []risk.PositionInput
	// Consulted is every price witness the assembler consulted — the single
	// output-relevant price set. It feeds the materialization identity (BOTH the
	// freshness-phase section and the price half of the substrate digest) and the
	// scheduler's next-boundary deadline. See ConsultedPrice.
	Consulted []ConsultedPrice
	// ConsultedFlags is every collateral-flag WITNESS ROW the assembler read, in
	// consultation order — the same discipline ConsultedPrice enforces, applied
	// to the new input family. It is what the substrate digest hashes; see
	// ConsultedCollateralFlag.
	ConsultedFlags []ConsultedCollateralFlag
}

// ConsultedCollateralFlag is one collateral-flag witness row that INFLUENCED the
// output: a (reserve, user) pair whose latest-wins fold was read while building
// a leg, together with the state it asserted and the (block, log_index) that
// asserted it.
//
// # Why this is a NEW INPUT FAMILY in the identity, and why it must be
//
// The materialization identity's law is that every input the output depends on is
// in the identity. The flags are such an input now: they decide each leg's
// `used_as_collateral`, and through it the position's collateral base, weighted
// LT sum, average LT and the engine aggregate. Leaving them out would reopen the
// D-012 class in a new place, and with a concrete trigger already scheduled — the
// owner-gated rewind-and-rederive that backfills the 173 historical flag logs
// ends with the Aave cursor back at the SAME head it started from. Cursors,
// epochs, sweep state and prices would all be byte-identical while the flag
// ledger beneath them is new, so a post-backfill pass would derive the OLD key,
// ADOPT the pre-backfill batch, and the corrected collateral would never reach a
// served number. The digest section is what makes that impossible.
//
// # Why only PRESENT rows are recorded — no phantom entries
//
// This mirrors ConsultedPrice's scoping law but NOT its absence rule, and the
// difference is principled. An absent price row produces a G1 REFUSAL, so the
// absence is itself a substrate fact the identity must carry. An absent flag row
// produces `false` from a CONSTANT OF THE ALGORITHM — the no-history law below —
// and constants live in AlgorithmRevision, not in the substrate digest. Recording
// absences would mint digest entries keyed on the mere presence of an account in
// the book, with no witness row behind them; and it would buy nothing, because
// the only way an absence becomes a presence is a new row, which changes the
// digest through the row itself.
//
// # Recorded AT CONSULTATION, including on a position that then refuses
//
// A witness read before a later asset refuses the position stays in this slice,
// exactly as ConsultedPrice keeps its G2 and absent consultations. It is not
// bookkeeping laziness — the flag genuinely can determine a refusal: a reserve
// that COUNTS as collateral must carry a liquidation threshold, and
// internal/risk's ErrMissingParam refusal therefore appears or disappears with the
// flag. Since a consulted flag may be output-relevant on either path and cannot
// be classified per case, the inclusive rule is the one taken, and the asymmetry
// is deliberate: an extra entry costs one needless re-materialization, while a
// missing entry lets a pass ADOPT a batch whose refusal it had just corrected.
// Publishing stale is worse than recomputing.
type ConsultedCollateralFlag struct {
	Engine  string
	ChainID uint64
	Reserve []byte
	User    []byte
	// Enabled is the state the witnessed fold asserted.
	Enabled bool
	// Block and LogIndex are the witness's own as-of — the flag can be far older
	// than the balance it governs, and a disclosure must not borrow the balance
	// cursor's freshness for it.
	Block    uint64
	LogIndex uint32
}

// PriceKeyID is the stable identity of one price witness, used for the
// previous-batch step baseline.
func PriceKeyID(chainID uint64, asset []byte, source string) string {
	return fmt.Sprintf("%d/%x/%s", chainID, asset, source)
}

// Assemble turns one snapshot into a batch's worth of positions.
//
// `now` is the DATABASE clock read inside the pass's snapshot — every age
// judged below is DB-now minus a durable stamp, never a process clock
// (chain-truth R4.1).
func Assemble(in store.RiskInputs, cfg AssembleConfig) (AssembleResult, error) {
	if cfg.Registry == nil {
		return AssembleResult{}, fmt.Errorf("riskfeed: assemble needs a registry")
	}
	now := in.ReadAt

	cursors := map[string]store.DeriveCursorState{}
	for _, c := range in.Cursors {
		cursors[c.Engine] = c
	}

	// Gate G2 is evaluated ONCE per price-owning engine and applied per
	// position: an unacknowledged reorg epoch on the price engine's chain means
	// its rows may describe blocks the raw rewind already deleted. It is
	// position-scoped rather than pass-fatal so a price reorg on one chain does
	// not refuse the other chain's book (design spec §7).
	priceReorg := map[string]bool{}
	for _, b := range []EngineBinding{cfg.Aave, cfg.DM} {
		if b.PriceEngine == "" {
			continue
		}
		c, ok := cursors[b.PriceEngine]
		if !ok {
			// No cursor means the poller has never written on this chain. That
			// is not a reorg; it is an absent input, and the per-asset G1 path
			// reports it with the asset named.
			continue
		}
		priceReorg[b.PriceEngine] = c.AckedEpoch < in.MaxEpochs[c.ChainID]
	}

	// Fold the two param ledgers ONCE per pass. The fold is last-non-nil per
	// field and refuses a mis-tagged or cross-chain row; see FoldParams.
	aaveParams, err := FoldParams(cfg.Aave.ParamEngine, cfg.Aave.ChainID, in.AaveParams)
	if err != nil {
		return AssembleResult{}, fmt.Errorf("fold aave params: %w", err)
	}
	aaveParamByAsset, err := ParamsByAsset(aaveParams)
	if err != nil {
		return AssembleResult{}, err
	}
	dmParams, err := FoldParams(cfg.DM.ParamEngine, cfg.DM.ChainID, in.DMParams)
	if err != nil {
		return AssembleResult{}, fmt.Errorf("fold dm params: %w", err)
	}
	dmParamByAsset, err := ParamsByAsset(dmParams)
	if err != nil {
		return AssembleResult{}, err
	}

	indexes := indexRateIndexes(in.Indexes)
	sweeps := indexSweeps(in.Sweeps)
	priceRows := indexPriceRows(in.Prices)
	balances := indexBalances(in.Balances)
	collateralFlags, err := indexCollateralFlags(in.CollateralFlags)
	if err != nil {
		return AssembleResult{}, err
	}

	// CONFLICTED ACCOUNTS ARE SEEDED EXPLICITLY, because they have NO balance
	// rows to be discovered from. `store.riskBalances` withholds every row of an
	// account whose (asset, side) exists under both sources — the correct
	// posture — which means enumerating accounts from `Balances` alone makes the
	// account vanish from the batch entirely. A vanished position reads
	// downstream as "no position here": the false-safe direction, and the exact
	// opposite of the G3 refusal the withholding exists to produce. So the
	// account set is the UNION of "has rows" and "has a conflict".
	conflicts := map[string]string{}
	conflictAccounts := map[string][][]byte{}
	for _, c := range in.BalanceConflicts {
		key := c.Engine + "/" + accountKey(c.Account)
		if _, dup := conflicts[key]; dup {
			continue
		}
		conflicts[key] = c.Detail
		conflictAccounts[c.Engine] = append(conflictAccounts[c.Engine], c.Account)
	}

	res := AssembleResult{}

	// --- Aave -------------------------------------------------------------
	aaveCursor := cursors[cfg.Aave.Engine]
	aaveParamCursor := cursors[cfg.Aave.ParamEngine]

	// THE COLLATERAL LAW'S PRECONDITION, evaluated ONCE per pass because it is a
	// property of the LEDGER rather than of any position.
	//
	// The law below reads a missing flag witness as the chain fact "never enabled".
	// That is licensed only when the walk behind this derived state began at or
	// below the engine's genesis AND ran under a decode registry that recognized
	// the flag events. Neither is implied by a cursor at head: the registry's
	// contract for an unknown topic0 is a silent skip, so a pre-flag binary leaves
	// a head cursor over an EMPTY flag ledger — and reading that as truth zeroes
	// the collateral of every genuinely-enabled position. Unproven ⇒ the whole Aave
	// book refuses. See GateFlagCustodyUnproven.
	aaveFlagCustodyProven := store.CoverageProvenBack(
		aaveCursor.CoveredFromBlock, aaveCursor.DecoderRevision,
		cfg.Aave.GenesisBlock, decode.RevisionAaveCollateralFlags)

	for _, account := range accountSet(balances[cfg.Aave.Engine], conflictAccounts[cfg.Aave.Engine]) {
		p, book, err := assembleAave(assembleArgs{
			cfg:             cfg,
			now:             now,
			account:         account,
			assets:          balances[cfg.Aave.Engine][accountKey(account)],
			conflicts:       conflicts,
			indexes:         indexes,
			priceRows:       priceRows,
			params:          aaveParamByAsset,
			collateralFlags: collateralFlags,
			flagCustody:     aaveFlagCustodyProven,
			priceReorg:      priceReorg[cfg.Aave.PriceEngine],
			balanceBlk:      aaveCursor.LastBlock,
			paramBlk:        aaveParamCursor.LastBlock,
			consulted:       &res.Consulted,
			consultedFlags:  &res.ConsultedFlags,
		})
		if err != nil {
			return AssembleResult{}, err
		}
		if p == nil {
			continue
		}
		res.Positions = append(res.Positions, *p)
		if book != nil {
			res.Book = append(res.Book, *book)
		}
	}

	// --- Debt Manager -----------------------------------------------------
	dmCursor := cursors[cfg.DM.Engine]
	for _, account := range accountSet(balances[cfg.DM.Engine], conflictAccounts[cfg.DM.Engine]) {
		p, book, err := assembleDM(assembleArgs{
			cfg:        cfg,
			now:        now,
			account:    account,
			assets:     balances[cfg.DM.Engine][accountKey(account)],
			conflicts:  conflicts,
			indexes:    indexes,
			priceRows:  priceRows,
			params:     dmParamByAsset,
			sweeps:     sweeps,
			priceReorg: priceReorg[cfg.DM.PriceEngine],
			balanceBlk: dmCursor.LastBlock,
			paramBlk:   dmCursor.LastBlock,
			consulted:  &res.Consulted,
		})
		if err != nil {
			return AssembleResult{}, err
		}
		if p == nil {
			continue
		}
		res.Positions = append(res.Positions, *p)
		if book != nil {
			res.Book = append(res.Book, *book)
		}
	}

	res.Aggregates = aggregate(res.Positions, cfg)
	return res, nil
}

type assembleArgs struct {
	cfg       AssembleConfig
	now       time.Time
	account   []byte
	assets    map[common.Address]map[string]store.RiskBalanceRow
	conflicts map[string]string
	indexes   map[string]store.RiskRateIndexRow
	priceRows map[string]store.RiskPriceRow
	params    map[common.Address]risk.ParamRow
	// collateralFlags is the latest-wins flag fold keyed by
	// collateralFlagKey(reserve, user). A MISSING key is the chain fact "never
	// enabled", never "unknown" — see assembleAave's collateral law.
	collateralFlags map[string]store.CollateralFlagRow
	// flagCustody is the pass-level verdict on whether the collateral law's
	// absence-is-truth reading is licensed for this engine's ledger at all.
	flagCustody bool
	sweeps      map[string]store.RiskSweepRow
	priceReorg  bool
	balanceBlk  uint64
	paramBlk    uint64
	// consulted collects EVERY price witness the assembler consulted, in
	// consultation order — the single output-relevant price set both projections of
	// the materialization identity are built from. See ConsultedPrice.
	consulted *[]ConsultedPrice
	// consultedFlags collects every collateral-flag witness ROW read, same
	// discipline. See ConsultedCollateralFlag.
	consultedFlags *[]ConsultedCollateralFlag
}

// assembleAave builds one Aave position, or a refusal.
//
// # THE COLLATERAL LAW: witnessed, three states, one direction
//
// Aave's `isUsingAsCollateral` is a bitmap in `getUserConfiguration`, an
// on-chain read riskd may not make (chain-truth R6.3). It is nonetheless FULLY
// EVENT-WITNESSED, and this function now reads that witness instead of assuming:
//
//	latest flag WITNESSED-ENABLED   → true
//	latest flag WITNESSED-DISABLED  → false
//	NO FLAG HISTORY AT ALL          → false
//
// The third line is the one that deserves an argument, because a default is
// exactly where a guess hides. It is not a default; it is CHAIN-EXACT under
// genesis-complete custody. Every path that can turn the flag on emits through
// the Pool — supply auto-enable, `setUserUseReserveAsCollateral(true)`, and
// `finalizeTransfer` on an aToken transfer or a liquidation — the Pool has been
// in the walker's stream set since this market's genesis block, and the walker's
// getLogs filter is address-only, so raw_logs holds every one of those logs by
// the coherent-window Step law. A (reserve, user) pair with no row therefore has
// never been enabled, full stop. Four independent witnesses agree on that
// completeness: the custody argument just given; a third-party-corroborated
// Pool-address log census; the state-machine closure that every disabling user
// has a prior enable (94 == 94, so no enable log is missing); and the param
// ledger's own prediction that reserves initialized at LTV 0 can have no
// auto-enable event at all.
//
// And the direction is conservative regardless: false SHRINKS counted
// collateral. If the completeness argument were ever wrong, the error would
// understate health, never overstate it — the opposite of the posture this
// replaces, which counted every positive aToken balance as collateral and was
// therefore wrong in the FALSE-SAFETY direction for every user who had opted out.
//
// # EXPECTED, DISCLOSED BEHAVIOUR CHANGE
//
// Measured on the live book (read-only, at Aave cursor 25,643,063): of 58
// positive collateral rows, 23 are witnessed-ENABLED and unchanged, 1 is
// witnessed-DISABLED, and 34 have NO HISTORY — 35 of 58 flip to not-collateral.
// The 34 are USDC (25 rows), FRAX (6) and PYUSD (3): reserves initialized at LTV 0
// and never collateral-configured, so their auto-enable never fired. Served Aave
// collateral aggregates DROP accordingly. The 1 disabled row is a genuine opt-out
// (weETH dust, flag off since block 22,551,863) and it DOES move a health factor,
// which is the point.
//
// ONE SHARPENING OF THAT DISCLOSURE, from the data rather than from the
// expectation. The consult predicted health factors would be unchanged on the
// stable rows because their LT is zero. On this book their LT is not zero — it is
// ABSENT: `param_history` carries a liquidation threshold for weETH alone (8100),
// and the stable reserves have only a ReserveInitialized row, so their folded
// threshold is nil. Under the retired posture those legs COUNTED, and
// internal/risk refuses a counting reserve with no threshold. So the first riskd
// pass over the live book would have REFUSED all 31 accounts holding stable
// collateral, not merely overstated them. Reading the flag turns those refusals
// into computed positions, because a reserve the chain never enabled needs no
// threshold. Both directions are pinned by
// TestAssembleAaveStableReserveWithNoThresholdRowComputesOnlyOnceWitnessed.
//
// # PER-ROW PROVENANCE REPLACES THE BLANKET FLAG
//
// The retired `aave_collateral_flag_unwitnessed` marked EVERY Aave position,
// which made `flagged_positions` uninformative — a count that is always the
// whole book discloses nothing. In its place the truth is carried where it
// belongs: each leg's `used_as_collateral` is now a witnessed boolean, and a
// position is flagged only when a POSITIVE collateral balance is NOT being
// counted, with the flag naming WHICH witness state excluded it
// (`aave_collateral_opted_out` vs `aave_collateral_never_enabled`). That is the
// fact an operator needs to reconcile "this account holds collateral" against
// "its counted collateral is lower than that".
func assembleAave(a assembleArgs) (*store.RiskPositionWrite, *risk.PositionInput, error) {
	engine := a.cfg.Aave.Engine
	acct := common.BytesToAddress(a.account)

	base := store.RiskPositionWrite{
		Engine:        engine,
		Account:       a.account,
		ValueDecimals: 8, // Aave base currency
		BalancesBlock: a.balanceBlk,
		ParamsBlock:   a.paramBlk,
	}

	if msg, bad := a.conflicts[engine+"/"+accountKey(a.account)]; bad {
		return refuse(base, GateStoreUnreadable, msg, nil), nil, nil
	}

	// THE LEDGER PRECONDITION, before any per-asset reasoning.
	//
	// It is checked here rather than after the asset loop so an unproven ledger is
	// reported as ITSELF, not as whichever per-asset problem happened to surface
	// first — a G1 "missing price" on a book that should not be valued at all would
	// send an operator after the wrong thing. It nonetheless applies the
	// "is this a position at all" test FIRST (hasNonzeroBalance), so a fully-closed
	// account is still not a position: a refusal row for an account holding nothing
	// would be noise, and it would inflate the refused count an operator reads as
	// "this much of the book is broken".
	if !a.flagCustody {
		if !hasNonzeroBalance(a.assets) {
			return nil, nil, nil
		}
		return refuse(base, GateFlagCustodyUnproven,
			fmt.Sprintf("engine %s cannot be valued: the derived flag ledger's coverage is UNPROVEN "+
				"(needs a walk from block <= %d under decode registry revision >= %d). The collateral law reads a "+
				"missing ReserveUsedAsCollateral* witness as \"never enabled as collateral\", which is chain-exact ONLY "+
				"when the walk behind this state could decode those events — a pre-flag binary leaves a cursor at head "+
				"over an empty flag ledger, and reading that as truth publishes zero collateral and health factor zero "+
				"for healthy borrowers. Re-derive this engine from its start block (rewind-and-rederive) before serving "+
				"its book.",
				engine, a.cfg.Aave.GenesisBlock, decode.RevisionAaveCollateralFlags),
			nil), nil, nil
	}

	var reserves []risk.AaveReserve
	var priceInputs []risk.PriceInput
	var snapshots []store.RiskPriceInputWrite
	var legs []store.RiskLegWrite
	var flags []string
	nonzero := false

	for _, asset := range sortedAssets(a.assets) {
		sides := a.assets[asset]
		scaledDebt := sideAmount(sides, sideDebt, sourceEvent)
		scaledCollateral := sideAmount(sides, sideCollateral, sourceEvent)
		if scaledDebt.Sign() == 0 && scaledCollateral.Sign() == 0 {
			continue
		}
		nonzero = true

		spec, known := a.cfg.Registry.Spec(engine, asset)
		if !known {
			// No configured valuation witness for an asset the account holds.
			// The asset is NEVER dropped: it is named on the refusal.
			return refuse(base, GateMissingInput,
				fmt.Sprintf("asset %s is held but has no configured price witness for %s", asset.Hex(), engine),
				asset.Bytes()), nil, nil
		}

		// THE COLLATERAL LAW, applied per leg. The witness is consulted for
		// EVERY reserve in the position, not only the collateral-bearing ones,
		// because `used_as_collateral` is persisted on every leg — so the flag is
		// a genuine output dependency of every leg, and recording the
		// consultation is what keeps the identity honest rather than phantom.
		usedAsCollateral := false
		if w, witnessed := a.collateralFlags[collateralFlagKey(asset, acct)]; witnessed {
			usedAsCollateral = w.Enabled
			if a.consultedFlags != nil {
				*a.consultedFlags = append(*a.consultedFlags, ConsultedCollateralFlag{
					Engine:   w.Engine,
					ChainID:  w.ChainID,
					Reserve:  append([]byte(nil), w.Reserve...),
					User:     append([]byte(nil), w.User...),
					Enabled:  w.Enabled,
					Block:    w.Block,
					LogIndex: w.LogIndex,
				})
			}
			if !w.Enabled && scaledCollateral.Sign() > 0 {
				flags = append(flags, FlagCollateralOptedOut)
			}
		} else if scaledCollateral.Sign() > 0 {
			// No witness row and a positive balance: never enabled. Disclosed,
			// because the operator reconciling a collateral total against a
			// balance needs to know the balance is real and simply does not count.
			flags = append(flags, FlagCollateralNeverEnabled)
		}

		r := risk.AaveReserve{
			Asset:            asset,
			Decimals:         spec.Decimals,
			ScaledDebt:       scaledDebt,
			ScaledCollateral: scaledCollateral,
			UsedAsCollateral: usedAsCollateral,
		}
		leg := store.RiskLegWrite{
			Asset:            asset.Bytes(),
			Decimals:         spec.Decimals,
			ScaledDebt:       scaledDebt,
			ScaledCollateral: scaledCollateral,
			UsedAsCollateral: boolPtr(usedAsCollateral),
		}

		if scaledDebt.Sign() > 0 {
			idx, ok := a.indexes[indexKey(engine, asset, kindVariableBorrowIndex)]
			if !ok {
				return refuse(base, GateStoreUnreadable,
					fmt.Sprintf("asset %s carries scaled debt but no variable borrow index", asset.Hex()),
					asset.Bytes()), nil, nil
			}
			r.DebtIndex = idx.Value
			r.IndexBlock = idx.Block
			b := idx.Block
			leg.DebtIndexBlock = &b
		}
		if scaledCollateral.Sign() > 0 {
			idx, ok := a.indexes[indexKey(engine, asset, kindLiquidityIndex)]
			if !ok {
				return refuse(base, GateStoreUnreadable,
					fmt.Sprintf("asset %s carries scaled collateral but no liquidity index", asset.Hex()),
					asset.Bytes()), nil, nil
			}
			r.CollateralIndex = idx.Value
			// IndexBlock is per RESERVE and one field; when both legs exist,
			// the OLDER of the two is the honest stamp — a disclosure must not
			// claim the fresher of two inputs it used both of.
			if r.IndexBlock == 0 || idx.Block < r.IndexBlock {
				r.IndexBlock = idx.Block
			}
			b := idx.Block
			leg.CollateralIndexBlock = &b
		}

		if pr, ok := a.params[asset]; ok {
			leg.LiqThreshold = pr.LiqThreshold
			leg.LiqBonus = pr.LiqBonus
		}

		j, err := judge(a, spec)
		if err != nil {
			return nil, nil, err
		}
		snapshots = append(snapshots, j.Snapshot)
		if !j.Usable {
			return refuseWithPrices(base, j.Gate,
				fmt.Sprintf("asset %s price %s: %s", asset.Hex(), spec.Key.Source, j.Snapshot.Verdict),
				asset.Bytes(), snapshots), nil, nil
		}
		flags = append(flags, j.Flags()...)
		priceInputs = append(priceInputs, j.Input)

		reserves = append(reserves, r)
		legs = append(legs, leg)
	}

	if !nonzero {
		return nil, nil, nil // a fully closed position is not a position
	}

	// Params for every reserve that COUNTS as collateral must exist; risk
	// refuses otherwise, and its refusal names the asset, so it is used as-is.
	in := risk.AaveInput{
		Account:  acct,
		Reserves: reserves,
		Params:   paramsFor(a.params, reserves),
		EMode:    0,
		Prices:   priceInputs,
		Regime:   risk.RegimeAtBlock(a.balanceBlk),
		Marks: risk.Watermarks{
			BalancesBlock: a.balanceBlk,
			ParamsBlock:   a.paramBlk,
		},
	}

	h, err := risk.ComputeAaveHealth(in)
	if err != nil {
		return refuseWithPrices(base, GateEngine, err.Error(), nil, snapshots), nil, nil
	}

	p := base
	p.Status = store.RiskPositionComputed
	p.Flags = dedupe(flags)
	p.ValueDecimals = h.BaseDecimals
	p.TotalCollateralBase = h.TotalCollateralBase
	p.TotalDebtBase = h.TotalDebtBase
	p.WeightedLTSum = h.WeightedLTSum
	p.AvgLTBps = h.AvgLiquidationThresholdBps
	p.HFWad = h.HealthFactorWad
	p.HFInfinite = h.IsInfinite
	if !h.IsInfinite {
		p.HFNum, p.HFDen = h.HealthFactor.Num, h.HealthFactor.Den
	}
	p.StalePriceInputs = h.StalePriceInputs
	if !h.OldestPriceInput.IsZero() {
		t := h.OldestPriceInput.UTC()
		p.OldestPriceInput = &t
	}
	p.Prices = snapshots
	p.Legs = mergeAaveLegs(legs, h)

	book := risk.PositionInput{Engine: engine, Aave: &in, Marks: in.Marks}
	return &p, &book, nil
}

// assembleDM builds one Debt Manager position, or a refusal.
//
// # The three-state sweep, honoured exactly (migration 00003, chain-truth R6.4)
//
//	no row at all                  → NEVER ATTEMPTED  → REFUSED (SWEEP_NEVER)
//	status failed, no success ever → NEVER SUCCEEDED  → REFUSED (SWEEP_NEVER)
//	status failed, prior success   → STALE COLLATERAL → computed, FLAGGED,
//	                                                    stamped at last_success_block
//	status success                 → current          → computed at last_success_block
//
// The two refusals are the point: an account whose collateral has never been
// read holds an UNKNOWN amount, not zero, and computing HF over zero collateral
// would publish a liquidation alarm against a borrower who may be perfectly
// healthy. The middle case is not refused because the collateral IS known — just
// old — and its age is disclosed by the sweep block stamped on the row plus the
// flag.
func assembleDM(a assembleArgs) (*store.RiskPositionWrite, *risk.PositionInput, error) {
	engine := a.cfg.DM.Engine
	acct := common.BytesToAddress(a.account)

	base := store.RiskPositionWrite{
		Engine:        engine,
		Account:       a.account,
		ValueDecimals: 6, // Debt Manager USD
		BalancesBlock: a.balanceBlk,
		ParamsBlock:   a.paramBlk,
	}

	if msg, bad := a.conflicts[engine+"/"+accountKey(a.account)]; bad {
		return refuse(base, GateStoreUnreadable, msg, nil), nil, nil
	}

	// Debt first: floor(normalized × currentIndex / 1e18), summed across borrow
	// tokens, USD 6-dec (recon derivation notes, NORMATIVE).
	debtUSD := new(big.Int)
	var legs []store.RiskLegWrite
	nonzero := false
	for _, asset := range sortedAssets(a.assets) {
		normalized := sideAmount(a.assets[asset], sideDebt, sourceEvent)
		if normalized.Sign() == 0 {
			continue
		}
		nonzero = true
		idx, ok := a.indexes[indexKey(engine, asset, kindBorrowIndex)]
		if !ok || idx.Value.Sign() <= 0 {
			return refuse(base, GateStoreUnreadable,
				fmt.Sprintf("borrow token %s carries normalized debt but no positive interest index", asset.Hex()),
				asset.Bytes()), nil, nil
		}
		live := risk.MulDivFloor(normalized, idx.Value, wad())
		debtUSD.Add(debtUSD, live)
		b := idx.Block
		legs = append(legs, store.RiskLegWrite{
			Asset:          asset.Bytes(),
			Decimals:       6, // the USD figure's scale; the token's own decimals are irrelevant to a normalized debt
			ScaledDebt:     normalized,
			LiveDebt:       live,
			DebtIndexBlock: &b,
		})
	}

	// Collateral: the sweep's snapshot rows, and only if a sweep ever succeeded.
	sweep, hasSweep := a.sweeps[engine+"/"+accountKey(a.account)]
	var collateralAssets []common.Address
	for _, asset := range sortedAssets(a.assets) {
		if sideAmount(a.assets[asset], sideCollateral, sourceSnapshot).Sign() != 0 {
			collateralAssets = append(collateralAssets, asset)
			nonzero = true
		}
	}
	if !nonzero {
		return nil, nil, nil
	}

	flags := []string{}
	switch {
	case !hasSweep:
		return refuse(base, GateSweepNever,
			"account has no snapshot_sweeps row: its collateral has NEVER been read, and unknown collateral is not zero collateral",
			nil), nil, nil
	case sweep.LastSuccessBlock == 0:
		return refuse(base, GateSweepNever,
			fmt.Sprintf("collateral sweep status %q with no successful sweep ever (last attempt block %d): collateral size is unknown, not zero",
				sweep.Status, sweep.LastAttemptBlock),
			nil), nil, nil
	case sweep.Status != "success":
		flags = append(flags, FlagSweepStale)
	}
	base.SweepBlock = sweep.LastSuccessBlock

	var collateral []risk.DMCollateral
	var priceInputs []risk.PriceInput
	var snapshots []store.RiskPriceInputWrite
	for _, asset := range collateralAssets {
		spec, known := a.cfg.Registry.Spec(engine, asset)
		if !known {
			return refuse(base, GateMissingInput,
				fmt.Sprintf("asset %s is held as collateral but has no configured price witness for %s", asset.Hex(), engine),
				asset.Bytes()), nil, nil
		}
		amount := sideAmount(a.assets[asset], sideCollateral, sourceSnapshot)
		collateral = append(collateral, risk.DMCollateral{Asset: asset, Amount: amount, Decimals: spec.Decimals})

		leg := store.RiskLegWrite{Asset: asset.Bytes(), Decimals: spec.Decimals, Amount: amount}
		if pr, ok := a.params[asset]; ok {
			leg.LiqThreshold = pr.LiqThreshold
			leg.LiqBonus = pr.LiqBonus
		}
		legs = append(legs, leg)

		j, err := judge(a, spec)
		if err != nil {
			return nil, nil, err
		}
		snapshots = append(snapshots, j.Snapshot)
		if !j.Usable {
			return refuseWithPrices(base, j.Gate,
				fmt.Sprintf("asset %s price %s: %s", asset.Hex(), spec.Key.Source, j.Snapshot.Verdict),
				asset.Bytes(), snapshots), nil, nil
		}
		flags = append(flags, j.Flags()...)
		priceInputs = append(priceInputs, j.Input)
	}

	in := risk.DMInput{
		Account:    acct,
		DebtUSD:    debtUSD,
		Collateral: collateral,
		Params:     dmParamsFor(a.params, collateral),
		Prices:     priceInputs,
		Marks: risk.Watermarks{
			BalancesBlock: a.balanceBlk,
			ParamsBlock:   a.paramBlk,
			SweepBlock:    sweep.LastSuccessBlock,
		},
	}

	h, err := risk.ComputeDMHealth(in)
	if err != nil {
		return refuseWithPrices(base, GateEngine, err.Error(), nil, snapshots), nil, nil
	}

	p := base
	p.Status = store.RiskPositionComputed
	p.Flags = dedupe(flags)
	p.ValueDecimals = h.UsdDecimals
	p.CollateralValueUSD = h.CollateralValueUSD
	p.MaxBorrowLT = h.MaxBorrowLT
	p.Borrowings = h.Borrowings
	liq := h.Liquidatable
	p.Liquidatable = &liq
	p.HFInfinite = h.IsInfinite
	if !h.IsInfinite {
		p.HFNum, p.HFDen = h.HealthFactor.Num, h.HealthFactor.Den
	}
	p.StalePriceInputs = h.StalePriceInputs
	if !h.OldestPriceInput.IsZero() {
		t := h.OldestPriceInput.UTC()
		p.OldestPriceInput = &t
	}
	p.Prices = snapshots
	p.Legs = mergeDMLegs(legs, h)

	book := risk.PositionInput{Engine: engine, DM: &in, Marks: in.Marks}
	return &p, &book, nil
}

// judge evaluates one asset's price witness for the position being assembled.
func judge(a assembleArgs, spec AssetSpec) (PriceJudgement, error) {
	id := PriceKeyID(spec.Key.ChainID, spec.Key.Asset, spec.Key.Source)
	var row *store.RiskPriceRow
	if r, ok := a.priceRows[id]; ok {
		rr := r
		row = &rr
	}
	j, err := JudgePriceInput(spec.Asset, spec.Key, row, a.cfg.Budget, a.now,
		a.cfg.PrevPrices[id], a.cfg.StepBps, a.priceReorg)
	if err != nil {
		return j, err
	}
	// EVERY consultation is recorded, including the ones that consulted no phase.
	// A G2 return and an absent row still influenced the output — the first by
	// refusing, the second by being missing — so both belong in the digest. Only
	// PhaseRelevant entries contribute a freshness phase.
	if a.consulted != nil {
		c := ConsultedPrice{
			ChainID:       spec.Key.ChainID,
			Asset:         spec.Key.Asset,
			Source:        spec.Key.Source,
			Present:       row != nil,
			Phase:         j.Phase,
			PhaseRelevant: j.PhaseRelevant,
			AsOf:          j.AsOf,
			HasAsOf:       !j.AsOf.IsZero(),
		}
		if row != nil {
			c.Value = new(big.Int).Set(row.Value)
			c.Decimals = row.Decimals
			c.BlockNumber = row.BlockNumber
		}
		*a.consulted = append(*a.consulted, c)
	}
	return j, nil
}

// ---------------------------------------------------------------------------
// Refusal construction.
// ---------------------------------------------------------------------------

func refuse(base store.RiskPositionWrite, code, detail string, asset []byte) *store.RiskPositionWrite {
	return refuseWithPrices(base, code, detail, asset, nil)
}

// refuseWithPrices writes the refusal AND every price snapshot the assembly got
// as far as taking. Discarding them would erase the evidence of what was
// refused and why — including, for a G1 refusal, the very row whose absence
// caused it.
func refuseWithPrices(base store.RiskPositionWrite, code, detail string, asset []byte, prices []store.RiskPriceInputWrite) *store.RiskPositionWrite {
	p := base
	p.Status = store.RiskPositionRefused
	p.RefusalCode = code
	p.RefusalDetail = detail
	p.RefusalAsset = asset
	p.Prices = prices
	// A refused position carries no health factor, no totals, and no flags: a
	// refusal is the absence of a number, and decorating it with zeros would
	// make it look like one.
	return &p
}

// ---------------------------------------------------------------------------
// Aggregation — the flag propagation leg.
// ---------------------------------------------------------------------------

// aggregate rolls positions up PER ENGINE, in each engine's own scale.
//
// FLAGS PROPAGATE. A position carrying any flag increments its engine's
// flagged_positions, so an operator reading a book total cannot see a clean
// number over degraded rows (oracle-sentinel R2/G4).
//
// REFUSED POSITIONS CONTRIBUTE NOTHING TO THE SUMS and are counted separately.
// Folding a refusal in as zero would understate exactly the book the refusal
// exists to protect.
func aggregate(positions []store.RiskPositionWrite, cfg AssembleConfig) []store.RiskEngineAggregate {
	order := []EngineBinding{cfg.Aave, cfg.DM}
	decimals := map[string]uint8{cfg.Aave.Engine: 8, cfg.DM.Engine: 6}
	acc := map[string]*store.RiskEngineAggregate{}
	for _, b := range order {
		acc[b.Engine] = &store.RiskEngineAggregate{
			Engine:          b.Engine,
			ValueDecimals:   decimals[b.Engine],
			TotalCollateral: new(big.Int),
			TotalDebt:       new(big.Int),
		}
	}
	for _, p := range positions {
		a, ok := acc[p.Engine]
		if !ok {
			continue
		}
		a.Positions++
		if len(p.Flags) > 0 {
			a.FlaggedPositions++
		}
		if p.Status == store.RiskPositionRefused {
			a.RefusedPositions++
			continue
		}
		a.ComputedPositions++
		if p.Liquidatable != nil && *p.Liquidatable {
			a.LiquidatablePositions++
		}
		if p.TotalCollateralBase != nil {
			a.TotalCollateral.Add(a.TotalCollateral, p.TotalCollateralBase)
		}
		if p.CollateralValueUSD != nil {
			a.TotalCollateral.Add(a.TotalCollateral, p.CollateralValueUSD)
		}
		if p.TotalDebtBase != nil {
			a.TotalDebt.Add(a.TotalDebt, p.TotalDebtBase)
		}
		if p.Borrowings != nil {
			a.TotalDebt.Add(a.TotalDebt, p.Borrowings)
		}
	}
	var out []store.RiskEngineAggregate
	for _, b := range order {
		out = append(out, *acc[b.Engine])
	}
	return out
}

// ---------------------------------------------------------------------------
// Indexing helpers.
// ---------------------------------------------------------------------------

func indexBalances(rows []store.RiskBalanceRow) map[string]map[string]map[common.Address]map[string]store.RiskBalanceRow {
	out := map[string]map[string]map[common.Address]map[string]store.RiskBalanceRow{}
	for _, r := range rows {
		if len(r.Asset) != common.AddressLength {
			continue
		}
		byAcct, ok := out[r.Engine]
		if !ok {
			byAcct = map[string]map[common.Address]map[string]store.RiskBalanceRow{}
			out[r.Engine] = byAcct
		}
		acct := hex.EncodeToString(r.Account)
		byAsset, ok := byAcct[acct]
		if !ok {
			byAsset = map[common.Address]map[string]store.RiskBalanceRow{}
			byAcct[acct] = byAsset
		}
		asset := common.BytesToAddress(r.Asset)
		sides, ok := byAsset[asset]
		if !ok {
			sides = map[string]store.RiskBalanceRow{}
			byAsset[asset] = sides
		}
		sides[r.Side+"/"+r.Source] = r
	}
	return out
}

func indexRateIndexes(rows []store.RiskRateIndexRow) map[string]store.RiskRateIndexRow {
	out := make(map[string]store.RiskRateIndexRow, len(rows))
	for _, r := range rows {
		if len(r.Asset) != common.AddressLength {
			continue
		}
		out[indexKey(r.Engine, common.BytesToAddress(r.Asset), r.Kind)] = r
	}
	return out
}

func indexSweeps(rows []store.RiskSweepRow) map[string]store.RiskSweepRow {
	out := make(map[string]store.RiskSweepRow, len(rows))
	for _, r := range rows {
		out[r.Engine+"/"+hex.EncodeToString(r.Account)] = r
	}
	return out
}

// indexCollateralFlags keys the latest-wins flag fold by (reserve, user).
//
// It REFUSES a duplicate key rather than letting the last row win. The store's
// `DISTINCT ON (asset, account)` already guarantees one row per pair, so a
// duplicate here means the fold's uniqueness assumption is broken — and silently
// picking one of two contradictory collateral verdicts is the class of decision
// that only shows up as a wrong number much later.
func indexCollateralFlags(rows []store.CollateralFlagRow) (map[string]store.CollateralFlagRow, error) {
	out := make(map[string]store.CollateralFlagRow, len(rows))
	for _, r := range rows {
		if len(r.Reserve) != common.AddressLength || len(r.User) != common.AddressLength {
			return nil, fmt.Errorf("riskfeed: collateral flag row for engine %q carries a %d-byte reserve and a %d-byte user; both must be %d-byte addresses",
				r.Engine, len(r.Reserve), len(r.User), common.AddressLength)
		}
		key := collateralFlagKey(common.BytesToAddress(r.Reserve), common.BytesToAddress(r.User))
		if prev, dup := out[key]; dup {
			return nil, fmt.Errorf("riskfeed: two collateral flag rows for reserve %x user %x (enabled=%t at %d/%d and enabled=%t at %d/%d) — the latest-wins fold is not unique",
				r.Reserve, r.User, prev.Enabled, prev.Block, prev.LogIndex, r.Enabled, r.Block, r.LogIndex)
		}
		out[key] = r
	}
	return out, nil
}

func collateralFlagKey(reserve, user common.Address) string {
	return reserve.Hex() + "/" + user.Hex()
}

// hasNonzeroBalance reports whether the account holds anything at all on either
// side, under the event source the Aave engine writes.
//
// It exists so the whole-engine custody refusal can preserve the "a fully closed
// position is not a position" law: rewind rebuilds leave amount=0 rows behind
// deliberately (so "closed" stays distinguishable from "never existed"), and an
// account made only of those must not acquire a refusal row.
func hasNonzeroBalance(byAsset map[common.Address]map[string]store.RiskBalanceRow) bool {
	for _, sides := range byAsset {
		for _, side := range []string{sideDebt, sideCollateral} {
			if sideAmount(sides, side, sourceEvent).Sign() != 0 {
				return true
			}
		}
	}
	return false
}

func indexPriceRows(rows []store.RiskPriceRow) map[string]store.RiskPriceRow {
	out := make(map[string]store.RiskPriceRow, len(rows))
	for _, r := range rows {
		out[PriceKeyID(r.ChainID, r.Asset, r.Source)] = r
	}
	return out
}

func indexKey(engine string, asset common.Address, kind string) string {
	return engine + "/" + asset.Hex() + "/" + kind
}

func accountKey(account []byte) string { return hex.EncodeToString(account) }

// accountSet is the UNION of the accounts that have balance rows and the
// accounts that have a withheld-rows conflict, deduplicated and ordered.
//
// The union is the fix for a false-safe disappearance: a conflicted account has
// no rows by construction, so an enumeration over `byAcct` alone would drop it
// from the batch instead of refusing it.
func accountSet(byAcct map[string]map[common.Address]map[string]store.RiskBalanceRow, extra [][]byte) [][]byte {
	keys := make(map[string]bool, len(byAcct)+len(extra))
	for k := range byAcct {
		keys[k] = true
	}
	for _, a := range extra {
		keys[accountKey(a)] = true
	}
	ordered := make([]string, 0, len(keys))
	for k := range keys {
		ordered = append(ordered, k)
	}
	sort.Strings(ordered)
	out := make([][]byte, 0, len(ordered))
	for _, k := range ordered {
		b, err := hex.DecodeString(k)
		if err != nil {
			continue
		}
		out = append(out, b)
	}
	return out
}

func sortedAssets(byAsset map[common.Address]map[string]store.RiskBalanceRow) []common.Address {
	out := make([]common.Address, 0, len(byAsset))
	for a := range byAsset {
		out = append(out, a)
	}
	sort.Slice(out, func(i, j int) bool { return string(out[i].Bytes()) < string(out[j].Bytes()) })
	return out
}

func sideAmount(sides map[string]store.RiskBalanceRow, side, source string) *big.Int {
	r, ok := sides[side+"/"+source]
	if !ok || r.Amount == nil {
		return new(big.Int)
	}
	return new(big.Int).Set(r.Amount)
}

func paramsFor(all map[common.Address]risk.ParamRow, reserves []risk.AaveReserve) []risk.ParamRow {
	var out []risk.ParamRow
	for _, r := range reserves {
		if p, ok := all[r.Asset]; ok {
			out = append(out, p)
		}
	}
	return out
}

func dmParamsFor(all map[common.Address]risk.ParamRow, collateral []risk.DMCollateral) []risk.ParamRow {
	var out []risk.ParamRow
	for _, c := range collateral {
		if p, ok := all[c.Asset]; ok {
			out = append(out, p)
		}
	}
	return out
}

// mergeAaveLegs folds the computed per-reserve values back onto the leg rows,
// so a persisted leg carries what the math produced rather than only what went
// into it.
func mergeAaveLegs(legs []store.RiskLegWrite, h risk.AaveHealth) []store.RiskLegWrite {
	byAsset := map[string]risk.AaveReserveValue{}
	for _, rv := range h.Reserves {
		byAsset[rv.Asset.Hex()] = rv
	}
	for i := range legs {
		rv, ok := byAsset[common.BytesToAddress(legs[i].Asset).Hex()]
		if !ok {
			continue
		}
		legs[i].LiveDebt = rv.LiveDebt
		legs[i].LiveCollateral = rv.LiveCollateral
		legs[i].DebtBase = rv.DebtBase
		legs[i].CollateralBase = rv.CollateralBase
		legs[i].WeightedLT = rv.WeightedLT
		if rv.LiquidationThresholdBps != nil {
			legs[i].LiqThreshold = rv.LiquidationThresholdBps
		}
		if rv.LiquidationBonusBps != nil {
			legs[i].LiqBonus = rv.LiquidationBonusBps
		}
	}
	return legs
}

func mergeDMLegs(legs []store.RiskLegWrite, h risk.DMHealth) []store.RiskLegWrite {
	byAsset := map[string]risk.DMCollateralValue{}
	for _, cv := range h.Collateral {
		byAsset[cv.Asset.Hex()] = cv
	}
	for i := range legs {
		cv, ok := byAsset[common.BytesToAddress(legs[i].Asset).Hex()]
		if !ok {
			continue
		}
		legs[i].ValueUSD = cv.ValueUSD
		legs[i].MaxBorrowContribution = cv.MaxBorrowContribution
		if cv.LiquidationThreshold != nil {
			legs[i].LiqThreshold = cv.LiquidationThreshold
		}
		if cv.LiquidationBonus != nil {
			legs[i].LiqBonus = cv.LiquidationBonus
		}
	}
	return legs
}

func dedupe(in []string) []string {
	if len(in) == 0 {
		return nil
	}
	seen := map[string]bool{}
	var out []string
	for _, s := range in {
		if s == "" || seen[s] {
			continue
		}
		seen[s] = true
		out = append(out, s)
	}
	sort.Strings(out)
	return out
}

func boolPtr(b bool) *bool { return &b }

func wad() *big.Int { return risk.WadUnit() }
