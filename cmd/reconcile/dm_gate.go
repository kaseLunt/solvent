// The Debt Manager boolean weld and its cohort (risk-quant R3, DM clause).
//
// The Debt Manager has no health factor. Its ground truth is a STRICT
// INEQUALITY:
//
//	liquidatable(user) := borrowingOf(user).total > getMaxBorrowAmount(user,false)
//
// (DebtManagerCore.sol:126-130), where getMaxBorrowAmount floors PER TOKEN and
// then sums (:139-165). Equality is HEALTHY. So the weld is a boolean weld, and
// R3's composition constraints exist because "25 healthy stables prove
// nothing": without the live liquidatable accounts the TRUE side of the boolean
// is never exercised at all.
//
// Direction note, recorded because neither leg substitutes for the other
// (risk-quant R2): this gate catches FALSE POSITIVES (we say liquidatable, the
// chain does not) and false negatives at head; the realized-liquidation
// backtest catches false negatives historically. The residual this gate does
// NOT close is stated on the census row itself.
//
// CORRECTION, recorded because the first version of this gate got it backwards
// (2026-07-29). This gate's initial live run reported a DM false positive and
// attributed it to a "sweep gap" in the collateral sweeper's data. That
// attribution was WRONG on both counts. The sweeper's read was byte-exact with
// chain at its own block; the disagreement was THIS GATE'S OWN CLOCK
// DISAGREEMENT — an unfiltered sweep watermark certifying collateral legs that
// the gate's own pin filter had discarded (see snapshotdb.T6SweepState for the
// mechanism and the 199-account measurement, and classifyDMSweep for the fix).
// The subject that produced the report was additionally a timing artifact of a
// frozen-literal test cohort compared across ~45 minutes; that test now reads its
// derived side live inside ONE snapshot (p3_dm_live_test.go). No claim about the
// sweeper's data quality survives from that finding.
//
// SECOND CLOCK CORRECTION, same defect family, found by accept-r4 (2026-07-31,
// 233 getMaxBorrowAmount drifts over 28,622 census welds). The frame DECLARED
// the swept collateral amounts @P_op. That declaration was FALSE: the sweeper's
// multicall executes at each account's OWN sweep block S(account) and
// ApplySweepBatch replaces the legs wholesale, so the persisted vector is
// @S(account), never @P_op — the maxBorrow leg was silently welding a
// SAMPLE-CLOCK input against PIN-CLOCK chain state. Three independent lanes
// converged on the classification (chain-truth ruling 08:55, risk-quant ruling
// 08:42, read-only dissection 08:58): the sweeper's custody is EXACT at its own
// clock (own-clock collateralOf byte-identical to the persisted snapshot 5/5),
// the recompute law is exact (pin-vector substitution reproduces
// getMaxBorrowAmount@pin bit-exactly 5/5), and the 233 were eventless basket
// motion inside the sweep→pin gap (a plain ERC20 transfer moves DM collateral
// with 0 raw logs, by design — the same motion collateral_spot_reads labels
// "expected, report-only BY CONSTRUCTION"). The fix is the THREE-STATE verdict
// law in classifyDMMaxBorrow: a verdict class with its own discrimination read,
// NOT a fourth tolerance — risk-quant refused any epsilon over the 233 as
// tolerance-as-carpet, and the three-tolerance law stands untouched. The
// BOOLEAN leg (liquidatable, strict >) initially stayed a single-clock pin
// weld: it welded 46/46 through the same gap that run.
//
// THIRD CLOCK CORRECTION — THE BOOLEAN LEG (Wave H3, adjudicated 2026-07-31:
// chain-truth + risk-quant boolean-leg rulings, the UNION). The accept-r5
// fresh run produced the PREDICTED case: two liquidatable false positives
// whose maxBorrow legs proved honest motion (sample-gap with the vector
// certificate) — the pin-clock boolean gate was re-litigating the settled
// snapshot architecture stochastically (~0-3 per 9.5k per draw; near the
// boundary the boolean is a step function, so no staleness bound translates
// into a boolean error bound, and A PASS UNDER A STOCHASTIC GATE CERTIFIES
// THE DRAW, NOT THE SYSTEM). The product serves the PAIR (verdict, sweep
// watermark); the gate was asking the pin a question the product answers at
// S. liquidatable is therefore THREE-STATE (classifyDMBoolean): EXACT;
// boundary-crossing-motion (gated=false, evidence) reachable ONLY through
// constructive per-row proof — the sample-gap certificate, debt EXACT at pin,
// the S-CLOCK BOOLEAN CUSTODY WELD (ComputeDMHealth over ALL inputs at S vs
// liquidatable@blockHash(S)), the Law@P PIN-VECTOR SUBSTITUTION (scalar AND
// boolean over the chain's own pin vector vs getMaxBorrowAmount@P and
// liquidatable@P), and the sweep age inside the cadence budget — and DRIFT/
// weld-unread for everything else, with the S-weld-fails-over-passing-
// certificate case ESCALATED as custody drift (the composition law diverging
// from chain). NO margin appears in ANY predicate; a standing census row
// gates the population at ~1% (sweeper-health); the never-swept law is
// reshaped the same wave (refusal-weld + cycle arithmetic + census
// denominator — see classifySweepTestimony).
//
// VECTOR STRENGTHENING of the own-clock weld (Codex round 2 on the proof
// surface, finding 1, 2026-07-31). Wave H's committed own-clock weld proved
// only the risk-weighted SCALAR at S: getMaxBorrowAmount@blockHash(S) against
// the recompute over the persisted vector. That is WEAKER than the diagnosis
// that justified it — the dissection byte-compared the VECTOR (own-clock
// collateralOf vs the persisted snapshot, 5/5 byte-identical), and two wrong
// snapshot rows whose price×LT products cancel at S (two stables swapped or
// offset with equal price and LT) keep the scalar exact, classify
// sample-gap-disclosed, and excuse the real corruption's pin-clock mismatch.
// The committed gate now performs the dissection's own read: collateralOf
// (user)@blockHash(S) — the EXACT read the sweeper persists
// (internal/snapshot/snapshot.go:634; DebtManagerCore.sol:170-183) — and
// BYTE-COMPARES the (token, amount) pairs against the persisted snapshot
// document, order-insensitive by token address, zero tolerance
// (compareDMCollateralVector). sample-gap(disclosed) is reachable ONLY when
// the vector matches; ANY vector mismatch is snapshot-custody-drift and
// GATES. The scalar recompute stays as a secondary law check: a vector match
// with a scalar mismatch is a divergence in the recompute law itself
// (own-clock-law-divergence), gated separately so custody and law cannot
// blur.
package main

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"math/big"
	"sort"
	"strings"
	"time"

	"github.com/ethereum/go-ethereum/common"

	"github.com/kaselunt/solvent/cmd/reconcile/snapshotdb"
	"github.com/kaselunt/solvent/internal/risk"
	"github.com/kaselunt/solvent/internal/riskfeed"
	"github.com/kaselunt/solvent/internal/store"
)

// R3's DM composition floors.
const (
	dmHealthyFloor        = 10
	dmMultiCollatFloor    = 5
	dmMultiCollatTokens   = 3
	dmLiquidUSDFloor      = 1
	dmCohortTotalBackstop = 25
)

// The own-clock discrimination read's frame-source names, shared between the
// declaration and every f.use so the two cannot drift into a frame violation.
const (
	dmCollateralSnapshotSource = "position_balances(source=snapshot, engine=debt_manager, side=collateral).amount@S(account) (the sweep block, NOT the run pin)"
	dmOwnClockMaxBorrowSource  = "DebtManager.getMaxBorrowAmount(user,false)@ownSweepBlockHash(S(account))"
	dmOwnClockVectorSource     = "DebtManager.collateralOf(user)@ownSweepBlockHash(S(account))"
	dmOwnClockPriceSource      = "DebtManager.convertCollateralTokenToUsd(token, 10^dec)@ownSweepBlockHash(S(account))"
	dmOwnClockHeaderSource     = "headerHash@ownSweepBlock(S(account)) resolved through the pinned reader"
	// Wave-H3 boolean-leg sources (the adjudicated three-state liquidatable
	// law — chain-truth conjunct iii, risk-quant conjunct iv, and the
	// never-swept reshape). Declared here so the declaration and every f.use
	// share one spelling.
	dmSClockLiquidatableSource = "DebtManager.liquidatable(user)@ownSweepBlockHash(S(account))"
	dmSClockIndexSource        = "DebtManager.getCurrentIndex(borrowToken)@ownSweepBlockHash(S(account))"
	dmPinVectorSource          = "DebtManager.collateralOf(user)@pinHash(P_op)"
	dmDebtFoldAtSSource        = "position_events(engine=debt_manager, side=debt) SUM(delta) <= S(account) — the Stage-A correlated aggregate inside the snapshot tx"
	dmFirstDebtSource          = "position_events(engine=debt_manager, side=debt) MIN(block_number) per account <= P_op (first debt event, Stage-A)"
	dmSweepCycleSource         = "sweep_generations(current_generation, completed_at) + snapshot_sweeps per-generation attempt-block spans (Stage-A, the sweep-cycle witness)"
	dmParamLedgerSource        = "position_events DM config ledger (collateral_token_config_set/removed/added) FULL raw prefix <= P_op (Stage-A, re-foldable at any S)"
	dmSweepAgeClockSource      = "headerTime@P_op and headerTime@ownSweepBlock(S(account)) through the pinned reader (the sweep-age clock)"
	dmServingPostureSource     = "internal/risk.ComputeDMHealth watermark refusal (requireWatermarks REQUIRES Marks.SweepBlock) — the serving posture CONSUMED as a read, never asserted"
)

// dmGateFrame declares the gate's exhaustive input frame.
func dmGateFrame() *gateFrame {
	return newGateFrame(gateDMBoolean,
		derived("position_balances(source=event, engine=debt_manager, side=debt).amount@P_op",
			"the NORMALIZED debt our DB fold produced — the thing under test on the debt side"),
		derived(dmCollateralSnapshotSource,
			"the swept collateral amounts (the CashLens collateralOf multicall, which nets pending withdrawals) our sweeper persisted — the thing under test on the collateral side. Declared at S(account) because that IS their clock: the sweeper executes at its own block and ApplySweepBatch replaces the legs wholesale. Declaring these @P_op was accept-r4's FALSE declaration (chain-truth ruling 08:55): it hid that the maxBorrow leg welds a sample-clock input against pin-clock chain state, which is why that leg carries the three-state verdict law (classifyDMMaxBorrow) instead of a single-clock compareExact"),
		derived("dm_param_history (position_events collateral_token_config_set) ledger prefix <= P_op, folded by riskfeed.FoldParams",
			"the liquidation thresholds our DM event custody produced, HUNDRED_PERCENT-denominated, folded by the SAME function riskd folds with. This is the PIN fold; the own-clock welds fold the SAME custody chain at <= S(account) from the RAW Stage-A ledger prefix (the dmParamLedgerSource below) — the collapsed pin view cannot be re-cut at S (Wave H4a, Codex F4)"),
		derived("snapshot_sweeps.last_success_block per account, FILTERED at the run pin",
			"the SweepBlock watermark. ComputeDMHealth REQUIRES it: DM collateral is sweep-dominated (~1h) while prices are 60s, so a boolean served without it would sit a fresh badge over hour-stale collateral. It carries THE SAME pin filter as the collateral legs — an unfiltered watermark certifies legs the pin cannot see and manufactures false liquidatable verdicts (T6SweepState)"),
		pinned("DebtManager.getCurrentIndex(borrowToken)@pinHash(P_op)",
			"the interest index that converts our normalized debt to live USD. Pinned for the same reason the Aave indexes are: our persisted index is the last mutating block's"),
		pinned("DebtManager.convertCollateralTokenToUsd(token, 10^dec)@pinHash(P_op)",
			"the ENGINE-EXACT price: it resolves the price provider through etherFiDataProvider AT THE PIN and returns floor(10^dec x P / 10^dec) = P exactly, so no provider address is assumed"),
		pinned("ERC20.decimals(token)@pinHash(P_op)",
			"the 10^dec valuation denominator, read from the token itself"),
		pinned("DebtManager.getCollateralTokens()@pinHash(P_op) and getBorrowTokens()@pinHash(P_op)",
			"the CHAIN's own token universe — what the cohort's coverage is counted against, never the registry"),
		pinned("DebtManager.liquidatable(user)@pinHash(P_op)",
			"the CHAIN side of the boolean weld — the expected side"),
		pinned("DebtManager.getMaxBorrowAmount(user,false)@pinHash(P_op)",
			"the chain's own threshold-weighted collateral at the pin. The collateral vector under it is @S(account), so this leg is judged by the verdict law in classifyDMMaxBorrow: bit-exact when the weld holds at one clock; sample-gap(disclosed) when only the pin value differs AND the own-clock VECTOR proof at S is byte-identical AND the scalar check holds; snapshot-custody-drift(gated) on any vector mismatch; own-clock-law-divergence(gated) when a matching vector still recomputes differently"),
		pinned(dmOwnClockMaxBorrowSource,
			"the own-clock DISCRIMINATION read's SCALAR law check: getMaxBorrowAmount re-read at blockHash(S(account)) for every pin-drifting member plus one always-on control. The dissection proved the sweeper byte-exact at this clock; a failure here over a matching vector is a divergence in the recompute law itself (own-clock-law-divergence, gated). S is deep-finalized, so the hash-bound read is as strong as the pin reads"),
		pinned(dmOwnClockVectorSource,
			"the own-clock CUSTODY PROOF (Codex round 2, finding 1): collateralOf(user) — the EXACT read the sweeper persists (internal/snapshot/snapshot.go:634; DebtManagerCore.sol:170-183) — re-issued at blockHash(S(account)) and BYTE-COMPARED as (token, amount) pairs against the persisted snapshot document, order-insensitive by token address, zero tolerance. sample-gap(disclosed) is reachable ONLY when this vector matches: the scalar recompute alone is weaker than the diagnosis (two wrong rows whose price×LT products cancel at S keep the scalar exact), so any vector mismatch is snapshot-custody-drift and GATES"),
		pinned(dmOwnClockPriceSource,
			"the engine-exact price AT S(account), feeding the own-clock recompute the same way the pin price feeds the pin recompute (internal/risk/dm.go:102-134, the per-token floor-then-sum law DebtManagerCore.sol:139-165)"),
		pinned(dmOwnClockHeaderSource,
			"the number->hash resolution for S(account) so the own-clock reads are hash-bound. S sits below the run pin and is deep-finalized"),
		pinned("DebtManager.borrowingOf(user).total@pinHash(P_op)",
			"the chain's own live debt total, welded exactly against our index-replayed value"),
		pinned(dmSClockLiquidatableSource,
			"the S-CLOCK BOOLEAN CUSTODY WELD's chain side (chain-truth conjunct iii, boolean-leg ruling): risk.ComputeDMHealth recomputed over ALL inputs at S — the Stage-A debt fold at S bridged through getCurrentIndex@S, the persisted collateral vector, params re-cut <= S, engine prices @S — must weld BIT-EXACT against liquidatable(user)@blockHash(S). A failure here over a PASSING collateral certificate is the composition law diverging from chain: custody drift, ESCALATE immediately"),
		pinned(dmSClockIndexSource,
			"the interest index AT S that bridges the Stage-A normalized debt fold at S to the USD-6 debt the S-clock boolean weld consumes — the same shape the pin-side bridge uses with getCurrentIndex@pin"),
		pinned(dmPinVectorSource,
			"the Law@P PIN-VECTOR SUBSTITUTION (risk-quant conjunct iv, boolean-leg ruling): the chain's OWN enumerated netted collateral vector at the pin (DebtManagerCore.sol:170-183). The scalar AND the boolean are recomputed over THIS vector with the run's pinned prices/params/decimals and the welded debt@P, and must equal getMaxBorrowAmount@P and liquidatable@P bit-exact — the flip then is a theorem of two chain-attested endpoints, and the motion IS vector@P minus vector@S"),
		derived(dmDebtFoldAtSSource,
			"the S-clock debt input for the boolean custody weld: per (account, asset), the Σ of our custodied debt deltas at block_number <= S(account), pre-collected inside the one snapshot transaction because Stage B cannot know which booleans flip until the DB is closed (the F5 seam)"),
		derived(dmFirstDebtSource,
			"each borrower's arrival edge for the never-swept race arithmetic (risk-quant's correction: any-never-swept-gates was stochastic on borrower arrival; the lawful form asks whether a sweep cycle both started after this block and completed before the pin)"),
		derived(dmSweepCycleSource,
			"the CYCLE-SPECIFIC witness the never-swept race decision consumes (Wave H4a, Codex F2): the engine's sweep_generations row and the per-generation attempt-block spans over snapshot_sweeps. The fleet's MINIMUM historical success block is NOT a cycle witness — one stale straggler success pins that floor across generations, and a borrower a later COMPLETED generation genuinely skipped would classify honest-race (a pass-that-should-fail). Honest-race is claimable ONLY on positive per-generation evidence that no cycle both opened after the arrival edge and completed at or below the pin; missing or sticky cycle evidence GATES"),
		derived(dmParamLedgerSource,
			"the FULL DM config event ledger prefix at P_op, kept RAW so the S-clock welds can fold it independently at each S(account) (Wave H4a, Codex F4). Filtering the COLLAPSED pin fold (latest P-effective row per asset) by EffectiveBlock <= S cannot reconstruct S when a token's config changed — or was removed/re-added — inside (S, P]: the S-effective row is gone from the collapsed view, so ordinary parameter motion would fail the honest S weld"),
		pinned(dmSweepAgeClockSource,
			"the chain-time sweep age for the freshness-budget conjunct (v): headerTime(P_op) minus headerTime(S(account)), judged against the sweeper-cadence bound (§7). Motion OUTSIDE the budget is a freshness violation and gates THERE — never absorbed as motion"),
		committed(dmServingPostureSource,
			"the MOTION license's premise (risk-quant B4): the served surface structurally attaches the sweep watermark to every DM boolean — internal/risk requireWatermarks refuses a SweepBlock-less compute (internal/risk/dm.go:49-58), and the API contract carries it as a REQUIRED field (api/openapi.yaml AsOf.sweep_block; PositionSummary.sweep_block). Consumed as a READ every run: the gate calls ComputeDMHealth with SweepBlock=0 and requires the refusal; the same read proves each never-swept account is refused by the serving path rather than asserted to be"),
		committed("cohort sampling seed = the OP pin's block hash (a chain fact, echoed in the report)",
			"the sampled remainder's ordering. The seed is not operator-chosen: overriding it taints the run"),
	)
}

// dmTokenState is the per-token pinned state the phase driver reads ONCE and
// every OP-side gate shares. Re-issuing these reads per gate would multiply a
// deep-archive budget for no additional evidence; each consuming gate still
// records the usage through its OWN frame, so the declaration stays honest.
type dmTokenState struct {
	universe []common.Address
	borrow   []common.Address
	decimals map[common.Address]uint8
	prices   map[common.Address]*big.Int
	indexes  map[common.Address]*big.Int
	notes    map[common.Address]bool
}

// dmSubject is one cohort member with the facts that put it there.
type dmSubject struct {
	Account common.Address
	Reasons []string
	Health  risk.DMHealth
	Margin  *big.Int // |Borrowings - MaxBorrowLT| in USD-6
}

// runDMBooleanGate computes OUR boolean over the WHOLE derived book, then welds
// the cohort against the chain.
func runDMBooleanGate(ctx context.Context, c *p3Ctx, st dmTokenState) ([]p3Row, error) {
	f := c.frames.add(dmGateFrame())
	t6 := c.t6
	var rows []p3Row

	universe, decimals, priceByToken, indexByToken, tokenNotes :=
		st.universe, st.decimals, st.prices, st.indexes, st.notes
	if len(universe) > 0 {
		f.use("DebtManager.getCollateralTokens()@pinHash(P_op) and getBorrowTokens()@pinHash(P_op)")
		f.use("ERC20.decimals(token)@pinHash(P_op)")
		f.use("DebtManager.convertCollateralTokenToUsd(token, 10^dec)@pinHash(P_op)")
		f.use("DebtManager.getCurrentIndex(borrowToken)@pinHash(P_op)")
	}
	for _, tok := range universe {
		if tokenNotes[tok] {
			rows = append(rows, unreadRow(gateDMBoolean, tok.Hex(), "token-state",
				"one or more of {ERC20.decimals, convertCollateralTokenToUsd, getCurrentIndex} did not DECODE at the pin (a revert on convertCollateralTokenToUsd is expected and NOT counted here for a borrow-only token, whose isCollateralToken check reverts by design)"))
		}
	}

	// ---- OUR boolean over the whole derived book ---------------------------
	folded, err := riskfeed.FoldParams(dmEngine, 10, t6.DMParams)
	if err != nil {
		return rows, fmt.Errorf("fold dm param ledger: %w", err)
	}
	f.use("dm_param_history (position_events collateral_token_config_set) ledger prefix <= P_op, folded by riskfeed.FoldParams")

	collByAccount := map[string][]snapshotdb.T6Leg{}
	for _, l := range t6.DMCollLegs {
		collByAccount[l.AccountHex] = append(collByAccount[l.AccountHex], l)
	}
	f.use(dmCollateralSnapshotSource)
	f.use("snapshot_sweeps.last_success_block per account, FILTERED at the run pin")

	// Live debt USD from OUR normalized debt and the PINNED index, per token,
	// then summed — the same shape borrowingOf(user) sums server-side.
	debtUSDByAccount := map[string]*big.Int{}
	debtRefusals := map[string]string{}
	for _, l := range t6.DMDebtLegs {
		f.use("position_balances(source=event, engine=debt_manager, side=debt).amount@P_op")
		idx := indexByToken[common.HexToAddress(l.AssetHex)]
		if idx == nil {
			debtRefusals[l.AccountHex] = "no pinned getCurrentIndex for borrow token 0x" + l.AssetHex
			continue
		}
		if debtUSDByAccount[l.AccountHex] == nil {
			debtUSDByAccount[l.AccountHex] = new(big.Int)
		}
		debtUSDByAccount[l.AccountHex].Add(debtUSDByAccount[l.AccountHex], mulDivFloor(l.Amount, idx))
	}

	// ---- collateral testimony AT THE PIN, per account ----------------------
	// Accounts whose newest successful sweep sits ABOVE the run pin have no
	// collateral testimony a pinned read can see (the sweeper's multicall runs at
	// chain HEAD and ApplySweepBatch replaces legs wholesale). They are EXCLUDED
	// from the evaluable universe rather than scored over discarded collateral —
	// see T6SweepState for the defect this closes and the 199-account measurement.
	var evaluable []string
	sweepRows, excluded := classifySweepTestimony(c, f, t6, debtUSDByAccount, folded)
	rows = append(rows, sweepRows...)
	for acct := range debtUSDByAccount {
		if !excluded[acct] {
			evaluable = append(evaluable, acct)
		}
	}
	sort.Strings(evaluable)

	var ourLiquidatable []dmSubject
	healthByAccount := map[string]risk.DMHealth{}
	marginByAccount := map[string]*big.Int{}
	var allBorrowers []string
	for _, acct := range evaluable {
		debtUSD := debtUSDByAccount[acct]
		allBorrowers = append(allBorrowers, acct)
		in := risk.DMInput{
			Account: common.HexToAddress(acct),
			DebtUSD: debtUSD,
			Params:  folded,
			Marks: risk.Watermarks{
				BalancesBlock: c.pinOP, ParamsBlock: c.pinOP,
				SweepBlock: t6.DMSweepByAccount[acct].AtOrBelowPin,
			},
		}
		for _, l := range collByAccount[acct] {
			tok := common.HexToAddress(l.AssetHex)
			dec, okDec := decimals[tok]
			p := priceByToken[tok]
			if !okDec || p == nil {
				in.Collateral = nil
				debtRefusals[acct] = "collateral token 0x" + l.AssetHex + " has no pinned price and/or decimals"
				break
			}
			in.Collateral = append(in.Collateral, risk.DMCollateral{Asset: tok, Amount: l.Amount, Decimals: dec})
			in.Prices = append(in.Prices, risk.PriceInput{
				ChainID: 10, Asset: tok, Source: "dm:convertCollateralTokenToUsd@pin", Block: c.pinOP,
				Value: p, Decimals: 6, Provenance: risk.ProvenanceEngineExact, Fresh: true,
			})
		}
		if _, refused := debtRefusals[acct]; refused {
			continue
		}
		h, err := risk.ComputeDMHealth(in)
		if err != nil {
			debtRefusals[acct] = "internal/risk refused: " + err.Error()
			continue
		}
		healthByAccount[acct] = h
		m := new(big.Int).Sub(h.Borrowings, h.MaxBorrowLT)
		marginByAccount[acct] = m.Abs(m)
		if h.Liquidatable {
			ourLiquidatable = append(ourLiquidatable, dmSubject{
				Account: in.Account, Health: h, Margin: marginByAccount[acct],
				Reasons: []string{"our-liquidatable (mandatory member: without the TRUE side the boolean is never exercised)"},
			})
		}
	}
	sort.Slice(ourLiquidatable, func(i, j int) bool {
		return ourLiquidatable[i].Account.Hex() < ourLiquidatable[j].Account.Hex()
	})

	// ---- cohort assembly ---------------------------------------------------
	cohort, comp := buildDMCohort(c, ourLiquidatable, healthByAccount, marginByAccount, collByAccount, allBorrowers)
	// THE CHAIN-SIDE CENSUS IS MANDATORY (Codex round 1, finding 4).
	//
	// It used to be opt-in (-dm-full-census, default off) on cost grounds, with the
	// residual disclosed on the census row. Codex withdrew that: the census side
	// must not be SELF-DERIVED. With the mandatory population taken from
	// ourLiquidatable — the implementation under test — a chain-liquidatable account
	// we misclassify as healthy simply never entered the sample, so the FALSE
	// NEGATIVE direction (the alert product's worst failure) could not be detected
	// at all. That is a vacuous green, not a coverage trade-off.
	//
	// Every evaluable borrower is therefore welded against pinned
	// liquidatable(user), and the cohort is the UNION of chain-true and derived-true
	// plus the composition force-includes. -dm-full-census survives only as an
	// explicit opt-OUT for bisecting, and disabling it TAINTS.
	inCohort := map[string]bool{}
	for _, s := range cohort {
		inCohort[hex.EncodeToString(s.Account.Bytes())] = true
	}
	if c.o.dmFullCensus {
		for _, acct := range evaluable {
			if inCohort[acct] {
				continue
			}
			inCohort[acct] = true
			cohort = append(cohort, dmSubject{
				Account: common.HexToAddress(acct),
				Health:  healthByAccount[acct],
				Margin:  marginByAccount[acct],
				Reasons: []string{"mandatory chain-side census: every evaluable borrower is welded against pinned liquidatable(user)"},
			})
		}
	}

	// ---- chain weld over the cohort ---------------------------------------
	weldRows, err := weldDMCohort(ctx, c, f, cohort, healthByAccount, st, collByAccount, debtUSDByAccount,
		folded, len(evaluable))
	rows = append(rows, weldRows...)
	if err != nil {
		return rows, err
	}

	// ---- the serving-surface disclosure receipt (risk-quant B4) -------------
	// The MOTION license's premise, stated as a frame-level fact with its
	// citations: the served boolean is STRUCTURALLY accompanied by its sweep
	// watermark. The posture itself is CONSUMED as a read every run
	// (classifySweepTestimony's refusal probe against dmServingPostureSource);
	// this row is the receipt line the artifact carries.
	rows = append(rows, evidenceRow(gateDMBoolean, "serving-surface", "boolean-disclosure-structure",
		"the (verdict, sweep watermark) PAIR is the served product",
		"risk-quant B4, the motion license's premise: internal/risk.ComputeDMHealth REQUIRES Marks.SweepBlock (requireWatermarks, internal/risk/dm.go:49-58) — the risk batch cannot produce a DM boolean without the account's own sweep watermark; the API contract carries the marks as REQUIRED fields (api/openapi.yaml: AsOf requires sweep_block; PositionSummary requires sweep_block; Position requires as_of), and cmd/api's cross-surface pin asserts the /v1/positions row's sweep_block equals the /v1/address as_of (p5_positions_db_test.go). The gate additionally CONSUMES the refusal posture as a read each run: ComputeDMHealth with SweepBlock=0 must refuse, or the run gates as serving-posture-broken"))

	// ---- cohort floors, census-welded --------------------------------------
	rows = append(rows, cohortFloorRow(gateDMBoolean, "dm-live-liquidatable(ALL)",
		comp.liquidatable, len(ourLiquidatable), 0,
		fmt.Sprintf("ALL live liquidatable accounts are mandatory members (risk-quant R3): our full-book computation over %d evaluable borrowers found %d. The CHAIN-SIDE census is mandatory too (Codex round 1, finding 4): every evaluable borrower is welded against pinned liquidatable(user), so the union of chain-true and derived-true is covered and a chain-liquidatable account we call healthy CANNOT escape by falling outside a sample. Cost at this pacing: %d multicall chunks",
			len(allBorrowers), len(ourLiquidatable), (len(allBorrowers)*3+multicallChunkSize-1)/multicallChunkSize)))
	rows = append(rows, dmCensusCoverageRow(evaluable, cohort))
	rows = append(rows, cohortFloorRow(gateDMBoolean, "dm-healthy-debtors",
		comp.healthy, dmHealthyFloor, dmHealthyFloor,
		"healthy accounts carrying debt — the FALSE side of the boolean"))
	rows = append(rows, cohortFloorRow(gateDMBoolean, fmt.Sprintf("dm-multi-collateral(>=%d tokens)", dmMultiCollatTokens),
		comp.multiCollateral, dmMultiCollatFloor, dmMultiCollatFloor,
		"exercises the per-token-floor-then-sum path, which sum-then-floor would silently pass on single-token accounts"))
	rows = append(rows, cohortFloorRow(gateDMBoolean, "dm-liquidUSD-holders",
		comp.liquidUSD, dmLiquidUSDFloor, dmLiquidUSDFloor,
		"the base-snap asset MUST appear in a welded valuation: liquidUSD is the token whose composition (rate x snap(USDC)) was the defect class the sweep exists to close"))
	rows = append(rows, cohortFloorRow(gateDMBoolean, "dm-cohort-total",
		len(cohort), dmCohortTotalBackstop, dmCohortTotalBackstop,
		fmt.Sprintf("population %d borrowers; sampled remainder drawn with the committed seed (the OP pin's block hash, echoed in the report) — %d forced, %d sampled", len(allBorrowers), comp.forced, comp.sampled)))

	if comp.boundary != nil {
		rows = append(rows, p3Row{
			Gate: gateDMBoolean, Subject: comp.boundary.Account.Hex(), Leg: "nearest-boundary-margin",
			Expected: "force-included by |debt - maxBorrowLT| rank 1",
			Actual:   comp.boundary.Margin.String() + " USD-6",
			Verdict:  verdictExact, Gated: true,
			Note: fmt.Sprintf("the nearest-boundary account is a MANDATORY member (risk-quant R3): borrowings %s vs maxBorrowLT %s. It is the sharpest available test of the strict inequality — equality is healthy, and a >= instead of > would flip exactly here first",
				comp.boundary.Health.Borrowings, comp.boundary.Health.MaxBorrowLT),
		})
	} else {
		rows = append(rows, p3Row{
			Gate: gateDMBoolean, Subject: "cohort:nearest-boundary", Leg: "nearest-boundary-margin",
			Verdict: verdictCohortFloor, Gated: true, Class: verdictCohortFloor,
			Note: "no nearest-boundary account could be identified — the cohort is missing its sharpest member (risk-quant R3 force-include)",
		})
	}

	// Accounts our own library REFUSED are surfaced, never dropped: a refusal
	// is the served surface refusing too.
	refusals := make([]string, 0, len(debtRefusals))
	for a := range debtRefusals {
		refusals = append(refusals, a)
	}
	sort.Strings(refusals)
	for _, a := range refusals {
		rows = append(rows, p3Row{
			Gate: gateDMBoolean, Subject: "0x" + a, Leg: "our-boolean-computable",
			Expected: "computable", Actual: debtRefusals[a],
			Verdict: verdictDrift, Gated: true, Class: "position-unvaluable",
			Note: "a derived borrower our own inputs cannot value at the pin. Gated: the served surface refuses the same account, so this is a hole in what the product can say, not a harmless gap in the gate",
		})
	}
	return rows, nil
}

// Collateral-testimony classes at the pin.
const (
	// sweepEvaluable: a successful sweep at or below the pin, so the legs the pin
	// can see are the legs that sweep wrote. The position is scoreable.
	sweepEvaluable = "evaluable"
	// sweepAbovePin: the newest successful sweep is ABOVE the pin. The sweep's
	// legs are invisible to a pinned read AND its watermark certifies nothing the
	// pin can see, so the position is NOT EVALUABLE AT THIS PIN. This is a timing
	// property of the pin (the sweeper runs at head; the run pins at the derive
	// cursor), not a data defect — it is recorded, not gated.
	sweepAbovePin = "sweep-above-pin"
	// sweepNever: no successful sweep at any height. Unlike sweepAbovePin this is
	// a PERSISTENT hole rather than a clock difference, so it IS gated.
	sweepNever = "never-swept"
)

// classifyDMSweep decides one account's collateral-testimony class at the pin.
//
// This is the function the sweep-gap defect lived in the absence of. The
// decisive arm is the second one: an account whose newest successful sweep is
// above the pin must NOT be evaluable, because its legs were filtered out by the
// leg predicate while its watermark — read without the pin filter — still
// claimed they had been read. With the watermark pinned, AtOrBelowPin is 0 and
// this returns sweepAbovePin.
func classifyDMSweep(st snapshotdb.T6SweepState, pin uint64) string {
	switch {
	case st.AtOrBelowPin > 0:
		return sweepEvaluable
	case st.Newest > pin:
		return sweepAbovePin
	default:
		return sweepNever
	}
}

// sweepExclusionInvariant is the GATED cross-check that keeps an exclusion
// honest: an account with no watermark at the pin must also have no legs the pin
// can see. If it had visible legs, excluding it would be discarding evidence
// rather than admitting we have none — and if it had a watermark while having no
// visible legs, that is exactly the defect (a certificate for discarded
// collateral). Both directions are one equivalence, asserted per account.
func sweepExclusionInvariant(st snapshotdb.T6SweepState) bool {
	if st.AtOrBelowPin == 0 {
		// EXCLUDED: we must genuinely have nothing the pin can see.
		return st.LegsAtOrBelowPin == 0
	}
	// EVALUABLE: zero visible legs is legitimate here — a sweep that ran at or
	// below the pin and found no collateral is honest testimony that the account
	// holds none, which is exactly the real zero-collateral population.
	return true
}

// classifySweepTestimony emits the per-account testimony rows and returns the
// set of accounts EXCLUDED from the evaluable universe.
//
// NEVER-SWEPT RESHAPE (Wave H3, risk-quant's correction of the blessed shape):
// any-never-swept-gates was STOCHASTIC ON BORROWER ARRIVAL — a borrower who
// arrives between two sweep passes fails the run through no defect anywhere.
// The lawful form is three conjuncts per never-swept account:
//
//	REFUSAL-WELD   the served surface's refusal of the account is PROVEN by a
//	               consumed read (risk.ComputeDMHealth with the account's own
//	               inputs and SweepBlock=0 must refuse — the 0xe957…bf20
//	               posture), never asserted;
//	AGE GUARD      derived from the sweeper's own PER-GENERATION state
//	               (dmNeverSweptRace, Wave H4a Codex F2): honest-race is
//	               claimable ONLY on a cycle-specific witness that NO sweep
//	               generation both opened after the account's first
//	               debt-event block and completed at or below P_op →
//	               disclosed coverage-gap (gated=false); a completed
//	               generation that skipped the account — or missing/sticky
//	               cycle evidence — → GATED. (The Wave-H3 shape compared the
//	               arrival edge against the fleet's MINIMUM historical
//	               success block, which is not a cycle: one stale straggler
//	               success pinned that floor across generations, and a
//	               borrower a later completed generation genuinely skipped
//	               classified honest-race — a pass-that-should-fail.);
//	CENSUS         the class carries its denominator, and coverage-gaps
//	               exceeding ~1% of the borrower census gate as
//	               sweeper-health — a STOPPED sweeper classifies every new
//	               borrower as an honest race per row, and this is the
//	               vacuous-pass guard that fails it en masse.
//
// last_attempt_status distinguishes never-attempted from attempted-and-failed
// (chain-truth's minor): Stage A now reads zero-success snapshot_sweeps rows
// too, so the attempt state is a fact, not an inference.
func classifySweepTestimony(c *p3Ctx, f *gateFrame, t6 *snapshotdb.Task6Data, borrowers map[string]*big.Int,
	folded []risk.ParamRow) ([]p3Row, map[string]bool) {
	var rows []p3Row
	excluded := map[string]bool{}
	accounts := make([]string, 0, len(borrowers))
	for a := range borrowers {
		accounts = append(accounts, a)
	}
	sort.Strings(accounts)

	// The serving-posture PROBE, always-on (the frame source must be consumed
	// every run, and the MOTION license's premise must hold every run): a
	// SweepBlock-less compute must refuse. If it does not, the serving surface
	// can produce a bare boolean over collateral of unknown freshness — the
	// license collapses (risk-quant B4, D-013 always-fix) and the run gates.
	refuse := func(acctHex string, debt *big.Int) (bool, string) {
		in := risk.DMInput{
			Account: common.HexToAddress(acctHex),
			DebtUSD: orZeroBig(debt),
			Params:  folded,
			Marks:   risk.Watermarks{BalancesBlock: c.pinOP, ParamsBlock: c.pinOP, SweepBlock: 0},
		}
		_, err := risk.ComputeDMHealth(in)
		if err == nil {
			return false, ""
		}
		return true, err.Error()
	}
	f.use(dmServingPostureSource)
	if ok, _ := refuse("0000000000000000000000000000000000000001", big.NewInt(1)); !ok {
		rows = append(rows, driftRow(gateDMBoolean, "serving-posture", "sweepless-compute-refusal",
			"risk.ComputeDMHealth(SweepBlock=0) refuses",
			"the compute SUCCEEDED without a sweep watermark",
			"serving-posture-broken",
			"the serving posture the MOTION license and the never-swept disclosure both rest on has broken: a DM boolean can be produced without the account's sweep watermark, so a surface could serve the bare boolean. D-013 always-fix; every disclosure below this line is suspect until internal/risk requires the watermark again"))
	}

	// The sweep-cycle witness the race arithmetic consumes: per-generation
	// state from Stage A (Wave H4a, Codex F2). NOT the fleet's minimum
	// historical success block — that floor spans generations, so one stale
	// straggler success (an account with an old success and recent failures)
	// pins it below every later borrower's arrival forever, and a borrower a
	// later COMPLETED generation genuinely skipped would classify honest-race.
	cycles := t6.DMSweepCycles
	f.use(dmSweepCycleSource)
	f.use(dmFirstDebtSource)

	abovePin, neverGated, coverageGaps, invariantBreaks := 0, 0, 0, 0
	for _, acct := range accounts {
		st := t6.DMSweepByAccount[acct]
		switch classifyDMSweep(st, c.pinOP) {
		case sweepEvaluable:
			continue
		case sweepAbovePin:
			abovePin++
			excluded[acct] = true
			rows = append(rows, p3Row{
				Gate: gateDMBoolean, Subject: "0x" + acct, Leg: "collateral-testimony-at-pin",
				Expected: fmt.Sprintf("a successful sweep at or below the pin %d", c.pinOP),
				Actual:   fmt.Sprintf("newest successful sweep %d is ABOVE the pin", st.Newest),
				Verdict:  verdictUnscannable, Gated: false, Class: sweepAbovePin,
				Note: "NOT EVALUABLE AT THIS PIN, recorded and NOT gated. The collateral sweeper's multicall executes at chain HEAD, above the derive cursor this run pins at, and ApplySweepBatch replaces an account's legs WHOLESALE — so this account's legs are invisible to a pinned read and its watermark certifies nothing the pin can see. Scoring it would sum ZERO collateral against real debt and manufacture a liquidation alert (the 199-account defect T6SweepState documents). The pin is the run's own choice, so this is a clock difference, not a data gap; the cohort floors below are judged over the EVALUABLE population, so an exclusion set large enough to hollow out the gate fails there instead",
				Evidence: map[string]string{
					"newest_success_block": fmt.Sprintf("%d", st.Newest),
					"legs_visible_at_pin":  fmt.Sprintf("%d", st.LegsAtOrBelowPin),
					"last_attempt_status":  st.Status,
					"pin":                  fmt.Sprintf("%d", c.pinOP),
				},
			})
		case sweepNever:
			excluded[acct] = true
			attemptState := "never-attempted (no snapshot_sweeps row)"
			if st.Attempted {
				attemptState = fmt.Sprintf("attempted-and-failed (last_attempt_status=%q)", st.Status)
			}
			var firstDebt uint64
			if t6.DMFirstDebtBlock != nil {
				firstDebt = t6.DMFirstDebtBlock[acct]
			}
			refused, refusalProof := refuse(acct, borrowers[acct])
			race, raceWitness := dmNeverSweptRace(firstDebt, c.pinOP, cycles)
			ev := map[string]string{
				"last_attempt_status": st.Status,
				"attempt_state":       attemptState,
				"first_debt_block":    fmt.Sprintf("%d", firstDebt),
				"cycle_witness":       raceWitness,
				"sweep_cycle_state":   dmSweepCycleSummary(cycles),
				"refusal_proof":       refusalProof,
			}
			row := p3Row{
				Gate: gateDMBoolean, Subject: "0x" + acct, Leg: "collateral-testimony-at-pin",
				Expected: "at least one successful collateral sweep at any height",
				Actual:   "no successful sweep has ever completed for this account",
				Evidence: ev,
			}
			switch {
			case !refused:
				neverGated++
				row.Verdict = verdictDrift
				row.Gated = true
				row.Class = "never-swept(served-without-refusal)"
				row.Note = "GATED AND LOUD: the serving posture did NOT refuse this sweepless account — the surface would serve a boolean over collateral of unknown freshness (the wrong answer, served). The refusal-weld is a CONSUMED read of risk.ComputeDMHealth, never an assertion (risk-quant's never-swept correction)"
			case race:
				coverageGaps++
				row.Verdict = verdictUnscannable
				row.Gated = false
				row.Class = "never-swept-coverage-gap(honest-race)"
				row.Note = "DISCLOSED, not gated: the sweeper's own PER-GENERATION state positively witnesses that no sweep generation both opened after this account's first debt event and completed at or below the pin (the cycle_witness evidence), so the sweeper has not yet OWED this account a visit — an honest race on borrower arrival, self-healing on the next completed pass. The served surface PROVABLY refuses the account meanwhile (the consumed refusal read above), so no wrong answer can be served. The census row below carries the denominator: a STOPPED sweeper classifies every arrival as a race per row and fails there en masse (the vacuous-pass guard)"
			default:
				neverGated++
				row.Verdict = verdictUnscannable
				row.Gated = true
				row.Class = sweepNever
				row.Note = "GATED: no cycle-specific witness clears the sweeper — either a sweep generation opened after this account's first debt event, completed at or below the pin, and STILL never read this account (a sweeper defect, not a race), or the per-generation evidence is missing/sticky, and missing cycle evidence is GATED, never disclosed (Wave H4a, Codex F2). The served surface refuses the account (consumed read above), so the failure is the pipeline's coverage, not a served wrong answer. Re-pinning cannot fix it"
			}
			rows = append(rows, row)
		}
		// The exclusion must be structurally justified, whichever arm produced it.
		if !sweepExclusionInvariant(t6.DMSweepByAccount[acct]) {
			invariantBreaks++
			rows = append(rows, driftRow(gateDMBoolean, "0x"+acct, "sweep-exclusion-invariant",
				"no watermark at the pin IMPLIES no legs visible at the pin",
				fmt.Sprintf("watermark 0 but %d leg(s) visible at the pin", t6.DMSweepByAccount[acct].LegsAtOrBelowPin),
				"exclusion-discards-evidence",
				"an excluded account has collateral legs the pin CAN see, so the exclusion is discarding evidence rather than admitting we have none. Either the watermark filter and the leg filter disagree, or the sweep table and position_balances have drifted apart"))
		}
	}
	never := neverGated + coverageGaps
	rows = append(rows, p3Row{
		Gate: gateDMBoolean, Subject: "cohort:collateral-testimony", Leg: "evaluable-universe",
		Expected: fmt.Sprintf("%d derived borrowers", len(accounts)),
		Actual:   fmt.Sprintf("%d evaluable, %d excluded sweep-above-pin (not gated), %d excluded never-swept (%d gated, %d disclosed coverage-gap)", len(accounts)-abovePin-never, abovePin, never, neverGated, coverageGaps),
		Verdict:  verdictExact, Gated: true,
		Note: "the evaluable universe every cohort floor below is judged against. The sweep-above-pin exclusions are a duty-cycle property of pinning below the sweeper's head (~2% of accounts at a ~34% duty cycle when this was measured); they are disclosed rather than gated, and the per-account invariant above proves each one discarded nothing the pin could see",
	})
	if invariantBreaks > 0 {
		rows[len(rows)-1].Verdict = verdictDrift
		rows[len(rows)-1].Class = "exclusion-discards-evidence"
	}
	rows = append(rows, dmNeverSweptCensusRow(coverageGaps, neverGated, len(accounts), cycles, c.pinOP))
	return rows, excluded
}

// dmSweepCycleSummary renders the Stage-A sweep-cycle witness for evidence
// fields — the reviewer-readable statement of WHICH generation state the race
// arithmetic consumed.
func dmSweepCycleSummary(cy snapshotdb.T6SweepCycles) string {
	if !cy.Read {
		return "UNREAD: Stage A did not collect the sweep-cycle witness"
	}
	if !cy.HaveGenerationRow {
		return "no sweep_generations row: no sweep generation has ever been opened"
	}
	state := "open"
	if cy.CurrentCompleted {
		state = "completed"
	}
	gens := make([]uint64, 0, len(cy.Generations))
	for g := range cy.Generations {
		gens = append(gens, g)
	}
	sort.Slice(gens, func(i, j int) bool { return gens[i] < gens[j] })
	spans := make([]string, 0, len(gens))
	for _, g := range gens {
		s := cy.Generations[g]
		spans = append(spans, fmt.Sprintf("g%d: %d row(s), attempts [%d, %d]", g, s.Rows, s.MinAttemptBlock, s.MaxAttemptBlock))
	}
	return fmt.Sprintf("current generation %d (%s); visible attempt spans: %s", cy.CurrentGeneration, state, strings.Join(spans, "; "))
}

// dmNeverSweptCensusRow is the never-swept class's standing census with its
// DENOMINATOR — the vacuous-pass guard both rulings require: a stopped
// sweeper turns every arriving borrower into a per-row honest race, and only
// the population can refute that. Coverage-gaps exceeding ~1% of the borrower
// census gate as sweeper-health.
func dmNeverSweptCensusRow(coverageGaps, gated, borrowerCensus int, cy snapshotdb.T6SweepCycles, pin uint64) p3Row {
	row := p3Row{
		Gate: gateDMBoolean, Subject: "cohort:never-swept", Leg: "standing-census",
		Expected: fmt.Sprintf("coverage-gaps <= ~1%% of the borrower census (%d)", borrowerCensus),
		Actual:   fmt.Sprintf("%d disclosed coverage-gap(s), %d gated never-swept", coverageGaps, gated),
		Gated:    true,
		Evidence: map[string]string{
			"denominator":             fmt.Sprintf("%d derived borrowers", borrowerCensus),
			"sweep_cycle_state":       dmSweepCycleSummary(cy),
			"pin":                     fmt.Sprintf("%d", pin),
			"disclosed_coverage_gaps": fmt.Sprintf("%d", coverageGaps),
			"gated_never_swept":       fmt.Sprintf("%d", gated),
		},
		Note: "the never-swept census denominator (risk-quant's correction): each coverage-gap is individually proven an honest race (refusal-weld + the per-generation cycle witness), and this row is the guard that fails a STOPPED sweeper en masse — a sweeper that stops makes every new borrower a per-row race, which only the population count can refute",
	}
	if dmMotionPopulationGate(coverageGaps, borrowerCensus) {
		row.Verdict = verdictDrift
		row.Class = "sweeper-health"
		return row
	}
	row.Verdict = verdictExact
	return row
}

// dmCensusCoverageRow asserts that the chain-side census actually covered every
// evaluable borrower. It is the row that makes finding 4's fix checkable rather
// than aspirational: if the cohort is a strict subset of the evaluable universe,
// some account's chain boolean was never read, and the FALSE-NEGATIVE direction is
// open again for exactly those accounts.
func dmCensusCoverageRow(evaluable []string, cohort []dmSubject) p3Row {
	inCohort := map[string]bool{}
	for _, s := range cohort {
		inCohort[hex.EncodeToString(s.Account.Bytes())] = true
	}
	var missing []string
	for _, a := range evaluable {
		if !inCohort[a] {
			missing = append(missing, "0x"+a)
		}
	}
	row := p3Row{
		Gate: gateDMBoolean, Subject: "census:dm-chain-liquidatable", Leg: "coverage(every evaluable borrower welded)",
		Expected: fmt.Sprintf("%d evaluable borrowers", len(evaluable)),
		Actual:   fmt.Sprintf("%d welded against pinned liquidatable(user)", len(evaluable)-len(missing)),
		Gated:    true,
		Note:     "the census side must not be SELF-DERIVED (Codex round 1, finding 4): with the mandatory population taken from our own liquidatable set, an account the chain calls liquidatable that we call healthy never entered the sample, so the alert product's worst failure direction was undetectable. Every evaluable borrower is now read at the pin",
	}
	if len(missing) == 0 {
		row.Verdict = verdictExact
		return row
	}
	row.Verdict = verdictCohortFloor
	row.Class = "chain-census-incomplete"
	capped := missing
	if len(capped) > 20 {
		capped = capped[:20]
	}
	row.Evidence = map[string]string{
		"unwelded_count":  fmt.Sprintf("%d", len(missing)),
		"unwelded_sample": strings.Join(capped, ","),
		"remediation":     "run without -dm-full-census=false; disabling the mandatory chain-side census taints the run",
	}
	return row
}

// dmComposition records how the cohort was assembled, for the report.
type dmComposition struct {
	liquidatable    int
	healthy         int
	multiCollateral int
	liquidUSD       int
	forced          int
	sampled         int
	boundary        *dmSubject
}

// buildDMCohort assembles the cohort per risk-quant R3: ALL live liquidatable,
// ≥10 healthy debtors, ≥5 multi-collateral (≥3 tokens), ≥1 liquidUSD holder,
// the nearest-boundary account force-included, and a seeded remainder.
func buildDMCohort(c *p3Ctx, liquidatable []dmSubject, health map[string]risk.DMHealth,
	margins map[string]*big.Int, coll map[string][]snapshotdb.T6Leg, borrowers []string) ([]dmSubject, dmComposition) {
	var comp dmComposition
	byAccount := map[string]*dmSubject{}
	order := []string{}
	take := func(acct string, reason string) *dmSubject {
		s, ok := byAccount[acct]
		if !ok {
			addr := common.HexToAddress(acct)
			s = &dmSubject{Account: addr, Health: health[acct], Margin: margins[acct]}
			byAccount[acct] = s
			order = append(order, acct)
		}
		for _, r := range s.Reasons {
			if r == reason {
				return s
			}
		}
		s.Reasons = append(s.Reasons, reason)
		return s
	}

	for _, s := range liquidatable {
		acct := hex.EncodeToString(s.Account.Bytes())
		take(acct, s.Reasons[0])
		comp.liquidatable++
	}

	// Nearest boundary over ALL borrowers, by |debt − maxBorrowLT|.
	bestMargin := (*big.Int)(nil)
	bestAcct := ""
	for _, acct := range borrowers {
		m := margins[acct]
		if m == nil {
			continue
		}
		if bestMargin == nil || m.Cmp(bestMargin) < 0 {
			bestMargin, bestAcct = m, acct
		}
	}
	if bestAcct != "" {
		comp.boundary = take(bestAcct, "force-include: nearest boundary by |debt - maxBorrowLT|")
	}

	// liquidUSD holders (by REGISTRY SYMBOL, never a hardcoded address).
	liquidUSD := c.reg.symbolAddress(dmEngine, "liquidUSD")
	if liquidUSD != (common.Address{}) {
		for _, acct := range borrowers {
			if comp.liquidUSD >= dmLiquidUSDFloor {
				break
			}
			for _, l := range coll[acct] {
				if common.HexToAddress(l.AssetHex) == liquidUSD {
					take(acct, "force-include: liquidUSD holder (the base-snap asset must appear in a welded valuation)")
					comp.liquidUSD++
					break
				}
			}
		}
	}

	// Multi-collateral (≥3 tokens).
	for _, acct := range borrowers {
		if comp.multiCollateral >= dmMultiCollatFloor {
			break
		}
		if len(coll[acct]) >= dmMultiCollatTokens {
			take(acct, fmt.Sprintf("force-include: multi-collateral (>=%d tokens)", dmMultiCollatTokens))
			comp.multiCollateral++
		}
	}

	// Healthy debtors.
	for _, acct := range borrowers {
		if comp.healthy >= dmHealthyFloor {
			break
		}
		h, ok := health[acct]
		if !ok || h.Liquidatable {
			continue
		}
		take(acct, "force-include: healthy debtor (the FALSE side of the boolean)")
		comp.healthy++
	}
	comp.forced = len(order)

	// Seeded remainder to the backstop, ordered by sha256(seed|"dm"|account).
	type ranked struct {
		acct string
		key  string
	}
	var pool []ranked
	for _, acct := range borrowers {
		if byAccount[acct] != nil {
			continue
		}
		sum := sha256.Sum256([]byte(c.p1.seed + "|dm|" + acct))
		pool = append(pool, ranked{acct: acct, key: hex.EncodeToString(sum[:])})
	}
	sort.Slice(pool, func(i, j int) bool {
		if pool[i].key != pool[j].key {
			return pool[i].key < pool[j].key
		}
		return pool[i].acct < pool[j].acct
	})
	for _, r := range pool {
		if len(order) >= dmCohortTotalBackstop {
			break
		}
		take(r.acct, "seeded remainder (sha256(seed|dm|account) ascending)")
		comp.sampled++
	}

	// Recount the composition over the FINAL membership so the printed numbers
	// describe the cohort, not the construction order.
	comp.healthy, comp.multiCollateral, comp.liquidUSD = 0, 0, 0
	out := make([]dmSubject, 0, len(order))
	for _, acct := range order {
		s := byAccount[acct]
		if h, ok := health[acct]; ok && !h.Liquidatable {
			comp.healthy++
		}
		if len(coll[acct]) >= dmMultiCollatTokens {
			comp.multiCollateral++
		}
		if liquidUSD != (common.Address{}) {
			for _, l := range coll[acct] {
				if common.HexToAddress(l.AssetHex) == liquidUSD {
					comp.liquidUSD++
					break
				}
			}
		}
		out = append(out, *s)
	}
	return out, comp
}

// readDMTokenUniverse reads getCollateralTokens ∪ getBorrowTokens at the pin —
// the CHAIN's own enumeration, which every coverage floor counts against.
func readDMTokenUniverse(ctx context.Context, c *p3Ctx) ([]common.Address, []common.Address, []p3Row, error) {
	var rows []p3Row
	collData, err := dmGetCollateralTokensABI.Pack("getCollateralTokens")
	if err != nil {
		return nil, nil, rows, err
	}
	borrowData, err := dmGetBorrowTokensABI.Pack("getBorrowTokens")
	if err != nil {
		return nil, nil, rows, err
	}
	res, _, err := c.opR.multicall(ctx, "p3:dm:tokenUniverse", c.pinOP, c.hashOP, []multicallCall{
		{Target: c.dmProxy, CallData: collData},
		{Target: c.dmProxy, CallData: borrowData},
	})
	if err != nil {
		return nil, nil, rows, dmPhaseErr(err)
	}
	if !res[0].Success || !res[1].Success {
		rows = append(rows, unreadRow(gateDMBoolean, c.dmProxy.Hex(), "token-universe",
			"getCollateralTokens and/or getBorrowTokens reverted at the pin"))
		return nil, nil, rows, nil
	}
	collateral, err := unpackAddressListStrict(dmGetCollateralTokensABI, "getCollateralTokens", res[0].ReturnData)
	if err != nil {
		rows = append(rows, unreadRow(gateDMBoolean, c.dmProxy.Hex(), "token-universe", err.Error()))
		return nil, nil, rows, nil
	}
	borrow, err := unpackAddressListStrict(dmGetBorrowTokensABI, "getBorrowTokens", res[1].ReturnData)
	if err != nil {
		rows = append(rows, unreadRow(gateDMBoolean, c.dmProxy.Hex(), "token-universe", err.Error()))
		return nil, nil, rows, nil
	}

	set := map[common.Address]bool{}
	for _, t := range collateral {
		set[t] = true
	}
	for _, t := range borrow {
		set[t] = true
	}
	return sortedAddrs(set), borrow, rows, nil
}

// readDMTokenState reads decimals, the engine-exact price and (for borrow
// tokens) the current index, all at the pin.
func readDMTokenState(ctx context.Context, c *p3Ctx, universe, borrow []common.Address) (
	map[common.Address]uint8, map[common.Address]*big.Int, map[common.Address]*big.Int, map[common.Address]bool, error) {
	decimals := map[common.Address]uint8{}
	prices := map[common.Address]*big.Int{}
	indexes := map[common.Address]*big.Int{}
	bad := map[common.Address]bool{}
	if len(universe) == 0 {
		return decimals, prices, indexes, bad, nil
	}
	// Pass 1: decimals (needed to build the price probe's 10^dec argument).
	var calls []multicallCall
	decData, err := erc20DecimalsABI.Pack("decimals")
	if err != nil {
		return nil, nil, nil, nil, err
	}
	for _, t := range universe {
		calls = append(calls, multicallCall{Target: t, CallData: decData})
	}
	res, _, err := c.opR.multicall(ctx, "p3:dm:decimals", c.pinOP, c.hashOP, calls)
	if err != nil {
		return nil, nil, nil, nil, dmPhaseErr(err)
	}
	for i, t := range universe {
		if !res[i].Success {
			bad[t] = true
			continue
		}
		d, err := unpackUint8Strict(erc20DecimalsABI, "decimals", res[i].ReturnData)
		if err != nil {
			bad[t] = true
			continue
		}
		decimals[t] = d
	}

	// Pass 2: engine-exact price via convertCollateralTokenToUsd(token, 10^dec)
	// and, for borrow tokens, getCurrentIndex.
	calls = calls[:0]
	type tag struct {
		kind string
		tok  common.Address
	}
	var tags []tag
	for _, t := range universe {
		d, ok := decimals[t]
		if !ok {
			continue
		}
		data, err := dmConvertCollateralToUsdABI.Pack("convertCollateralTokenToUsd", t, pow10Big(d))
		if err != nil {
			return nil, nil, nil, nil, err
		}
		calls, tags = append(calls, multicallCall{Target: c.dmProxy, CallData: data}), append(tags, tag{"price", t})
	}
	for _, t := range borrow {
		data, err := dmGetCurrentIndexABI.Pack("getCurrentIndex", t)
		if err != nil {
			return nil, nil, nil, nil, err
		}
		calls, tags = append(calls, multicallCall{Target: c.dmProxy, CallData: data}), append(tags, tag{"index", t})
	}
	res, _, err = c.opR.multicall(ctx, "p3:dm:priceAndIndex", c.pinOP, c.hashOP, calls)
	if err != nil {
		return nil, nil, nil, nil, dmPhaseErr(err)
	}
	for i, tg := range tags {
		if !res[i].Success {
			// A revert on convertCollateralTokenToUsd is EXPECTED for a
			// borrow-only token (`!isCollateralToken` reverts), so it only marks
			// the token bad when it is in the collateral universe. The caller
			// surfaces a missing price as an unvaluable position, gated.
			continue
		}
		switch tg.kind {
		case "price":
			v, err := unpackUint256Strict(dmConvertCollateralToUsdABI, "convertCollateralTokenToUsd", res[i].ReturnData)
			if err != nil {
				bad[tg.tok] = true
				continue
			}
			prices[tg.tok] = v
		case "index":
			v, err := unpackUint256Strict(dmGetCurrentIndexABI, "getCurrentIndex", res[i].ReturnData)
			if err != nil {
				bad[tg.tok] = true
				continue
			}
			indexes[tg.tok] = v
		}
	}
	return decimals, prices, indexes, bad, nil
}

// dmOwnClockResult is one account's own-clock discrimination weld: the chain's
// own collateral VECTOR at blockHash(S(account)) byte-compared against the
// persisted snapshot document (the custody proof), plus getMaxBorrowAmount at
// the same hash beside our recompute over the SAME persisted vector with
// S-clock prices and the param ledger re-cut at S (the scalar law check).
type dmOwnClockResult struct {
	Block    uint64
	Hash     common.Hash
	ChainMax *big.Int
	OurMax   *big.Int
	// VectorRead / VectorMatch / VectorDiff are the CUSTODY PROOF (Codex round
	// 2, finding 1): collateralOf(user)@blockHash(S) decoded and byte-compared
	// against the persisted document. VectorRead=false means the proof was not
	// produced, and the classifier refuses to reach sample-gap without it.
	// VectorLegs counts the persisted legs compared, for the evidence column.
	VectorRead  bool
	VectorMatch bool
	VectorDiff  string
	VectorLegs  int
	// Err is non-empty when a side could not be produced (a reverted or
	// undecodable read, a param fold failure, a library refusal). The classifier
	// turns it into weld-unread — "cannot verify" is never advisory — EXCEPT
	// when the vector proof already failed: a proven vector mismatch is custody
	// drift whatever the scalar legs managed to do.
	Err string

	// --- the S-CLOCK BOOLEAN CUSTODY WELD (Wave H3, chain-truth conjunct iii)
	// risk.ComputeDMHealth recomputed over ALL inputs at S: the Stage-A debt
	// fold at S bridged through getCurrentIndex@blockHash(S), the persisted
	// collateral vector, params re-cut <= S, engine prices @S — welded
	// bit-exact against liquidatable(user)@blockHash(S).
	BoolRead        bool // liquidatable(user)@S answered and decoded
	ChainLiqS       bool // the chain's own boolean at S
	OursLiqComputed bool // the full S-clock recompute produced a boolean
	OursLiqS        bool // ComputeDMHealth(all inputs at S).Liquidatable
	DebtUSDAtS      *big.Int
	// BoolErr names why the boolean weld specifically could not be produced,
	// kept separate from Err so the scalar law check's semantics are untouched.
	BoolErr string

	// --- the sweep-age clock (Wave H3, freshness conjunct v)
	// headerTime(P_op) − headerTime(S), chain time. AgeKnown=false means one
	// of the header reads did not answer — "cannot verify", never a default.
	AgeKnown   bool
	AgeSeconds int64
}

// dmPersistedVector folds an account's persisted snapshot legs into the
// (token → amount) map the byte-compare consumes. Duplicate rows (never
// observed; defensive) accumulate additively, mirroring the sweeper's own
// decodeCollateralOf normalization.
func dmPersistedVector(legs []snapshotdb.T6Leg) map[common.Address]*big.Int {
	out := map[common.Address]*big.Int{}
	for _, l := range legs {
		tok := common.HexToAddress(l.AssetHex)
		if prev, ok := out[tok]; ok {
			out[tok] = new(big.Int).Add(prev, l.Amount)
		} else {
			out[tok] = new(big.Int).Set(l.Amount)
		}
	}
	return out
}

// compareDMCollateralVector is the own-clock CUSTODY PROOF's comparison law
// (Codex round 2, finding 1): the (token, amount) pairs of
// collateralOf(user)@blockHash(S) against the persisted snapshot document,
// order-insensitive by token address, ZERO tolerance. Zero-amount chain
// entries are dropped and duplicate entries accumulate additively BEFORE
// comparing — the SAME normalization the sweeper applies when it persists
// (internal/snapshot decodeCollateralOf: absence IS zero under wholesale
// replacement) — so the comparison is persisted-document vs
// would-be-persisted-document, byte for byte. Both directions are mismatches:
// a chain token the document lacks and a document token the chain lacks.
func compareDMCollateralVector(chain []tokenAmount, persisted map[common.Address]*big.Int) (match bool, diff string) {
	chainVec := map[common.Address]*big.Int{}
	for _, e := range chain {
		if e.Amount == nil || e.Amount.Sign() == 0 {
			continue
		}
		if prev, ok := chainVec[e.Token]; ok {
			chainVec[e.Token] = new(big.Int).Add(prev, e.Amount)
		} else {
			chainVec[e.Token] = new(big.Int).Set(e.Amount)
		}
	}
	union := map[common.Address]bool{}
	for t := range chainVec {
		union[t] = true
	}
	for t := range persisted {
		union[t] = true
	}
	var diffs []string
	for _, tok := range sortedAddrs(union) {
		c, p := chainVec[tok], persisted[tok]
		switch {
		case c == nil:
			diffs = append(diffs, fmt.Sprintf("%s: persisted %s, ABSENT from collateralOf@S", tok.Hex(), p))
		case p == nil:
			diffs = append(diffs, fmt.Sprintf("%s: collateralOf@S %s, ABSENT from the persisted document", tok.Hex(), c))
		case c.Cmp(p) != 0:
			diffs = append(diffs, fmt.Sprintf("%s: collateralOf@S %s != persisted %s", tok.Hex(), c, p))
		}
	}
	if len(diffs) > 0 {
		return false, strings.Join(diffs, "; ")
	}
	return true, ""
}

// classifyDMMaxBorrow is the verdict law for the maxBorrow leg (adjudicated:
// chain-truth ruling 08:55 + risk-quant ruling 08:42 + the dissection verdict
// 08:58 on accept-r4; VECTOR-strengthened by Codex round 2 finding 1). It is a
// pure function so the law is unit-tested and mutation-killable in isolation.
//
//	bit-exact                 the weld holds at ONE clock: the pin values agree.
//	sample-gap(disclosed)     the pin values differ, the own-clock VECTOR at
//	                          S(account) is byte-identical to the persisted
//	                          document (the custody proof), AND the scalar law
//	                          check holds. The pin delta is eventless basket
//	                          motion inside the sweep->pin gap — the same
//	                          motion collateral_spot_reads labels report-only
//	                          BY CONSTRUCTION. Disclosed with magnitude and
//	                          sweep age, never gated. Reachable ONLY through a
//	                          vector match: the scalar alone is weaker than the
//	                          diagnosis (two wrong rows whose price×LT products
//	                          cancel at S keep the scalar exact).
//	snapshot-custody-drift    the VECTOR disagrees at the account's own clock:
//	                          real custody drift, GATED — whatever the scalar
//	                          legs produced, including a canceling match.
//	own-clock-law-divergence  the vector matches byte-for-byte but the scalar
//	                          recompute disagrees with getMaxBorrowAmount@S:
//	                          custody is exonerated by the vector and the
//	                          divergence is in the recompute law itself. GATED,
//	                          named separately so custody and law cannot blur.
//
// This is a verdict class with its own read, NOT a fourth tolerance: any
// epsilon over the pin delta was refused as tolerance-as-carpet, and the
// three-tolerance law stands untouched.
func classifyDMMaxBorrow(pinChain, ours *big.Int, own *dmOwnClockResult) (verdict, class string) {
	if pinChain.Cmp(ours) == 0 {
		return verdictExact, ""
	}
	// The CUSTODY PROOF outranks everything below: a proven vector mismatch at
	// S is real drift even when the scalar legs could not be produced (Err set
	// by a refused price or a reverted getMaxBorrowAmount changes nothing the
	// vector already proved).
	if own != nil && own.VectorRead && !own.VectorMatch {
		return verdictDrift, "snapshot-custody-drift"
	}
	if own == nil || own.Err != "" {
		return verdictWeldUnread, "own-clock-read-unread"
	}
	if !own.VectorRead {
		// No custody proof was produced and no error explains why: sample-gap
		// is unreachable without the vector, so this is "cannot verify".
		return verdictWeldUnread, "own-clock-read-unread"
	}
	if own.ChainMax.Cmp(own.OurMax) != 0 {
		return verdictDrift, "own-clock-law-divergence"
	}
	return verdictSampleGap, verdictSampleGap
}

// dmPinVectorResult is one account's Law@P PIN-VECTOR SUBSTITUTION (risk-quant
// conjunct iv, boolean-leg ruling): the chain's OWN enumerated netted
// collateral vector read at pinHash(P_op), with the scalar AND the boolean
// recomputed over it using the run's pinned prices/params/decimals and the
// welded debt@P. When both weld bit-exact against getMaxBorrowAmount@P and
// liquidatable@P, the flip is a theorem of two chain-attested endpoints and
// the motion IS vector@P − vector@S.
type dmPinVectorResult struct {
	Read bool   // collateralOf@pinHash answered and decoded
	Err  string // why the substitution could not be produced (weld-unread)

	ScalarP    *big.Int // our recompute of the LT-weighted scalar over the CHAIN pin vector
	BoolP      bool     // our recompute of the strict > boolean over the CHAIN pin vector + welded debt@P
	ScalarWeld bool     // ScalarP == getMaxBorrowAmount(user,false)@pinHash
	BoolWeld   bool     // BoolP == liquidatable(user)@pinHash

	// The motion ledger: per-token LT-weighted USD-6 contribution deltas
	// (vector@P − vector@S, both sides through the SAME per-token
	// floor-then-sum law with the run's pinned prices and params), their sum,
	// and whether the sum reconciles arithmetically to
	// getMaxBorrowAmount@P − ourMax(mixed) — the number whose sign and size
	// produce the flip.
	PerTokenDeltas []string
	DeltaSum       *big.Int
	Reconciles     bool
}

// dmBooleanFacts is the pure classifier's input — every conjunct of the
// adjudicated three-state liquidatable law as an already-established fact.
//
// GUARDRAIL (both consultants, verbatim): there is DELIBERATELY NO MARGIN
// FIELD in this struct and no numeric threshold anywhere in the classifier.
// The disclosed class is reachable ONLY through constructive per-row proof —
// margins are evidence the rows print, never a predicate input. An epsilon
// here would be the tolerance-as-carpet both rulings refused.
type dmBooleanFacts struct {
	Ours  bool // the served mixed-clock verdict (ComputeDMHealth over debt@P + collateral@S)
	Chain bool // liquidatable(user)@pinHash(P_op)

	// Conjunct (i): the account's maxBorrow leg classified sample-gap-disclosed
	// THIS run with the full certificate (vector byte-identical at
	// blockHash(S) + scalar law recompute) — the verdict classifyDMMaxBorrow
	// produced for the leg row.
	MaxBorrowLegVerdict string
	// Conjunct (ii): borrowingOf(user).total@pinHash welds EXACT against our
	// index-replayed debt. Debt is same-clock event-derived — any disagreement
	// is drift, never motion.
	DebtExactAtPin bool
	// Conjunct (iii) + (v): the own-clock result carrying the S-clock boolean
	// custody weld and the sweep-age clock.
	Own *dmOwnClockResult
	// Conjunct (iv): the Law@P pin-vector substitution.
	PinVec *dmPinVectorResult
	// Conjunct (v)'s budget: the sweeper-cadence freshness bound in seconds
	// (§7, the daemon's own persisted cadence). <= 0 means no budget was
	// resolvable — "cannot verify", never a free pass.
	BudgetSeconds int64
}

// The boolean leg's class strings. Direction-tagged (the boolean's OWN
// granularity, chain-truth's evidence obligation): a false NEGATIVE at pin is
// the risk-hiding direction and is rendered louder.
const (
	dmDirectionFalsePositive = "false-positive-at-pin"
	dmDirectionFalseNegative = "false-negative-at-pin"
	// dmClassSClockCustodyDrift is the ESCALATION arm, named per chain-truth:
	// the S-clock boolean weld failing while the collateral certificate passes
	// is the composition law diverging from chain — custody drift immediately,
	// never motion and never a retry.
	dmClassSClockCustodyDrift = "s-clock-boolean-custody-drift(composition-law-diverges-from-chain-at-S; ESCALATE)"
)

// classifyDMBoolean is the adjudicated THREE-STATE law for liquidatable
// (strict >) — the union of the chain-truth and risk-quant boolean-leg
// rulings, the stronger conjunct set everywhere. Pure so the law is
// unit-tested and mutation-killable in isolation.
//
//	EXACT                      derived == liquidatable(user)@pinHash. Unchanged.
//	boundary-crossing-motion   gated=false, evidence: reachable ONLY through
//	                           ALL of, per account —
//	                           (i)   the maxBorrow leg sample-gap-disclosed
//	                                 with the full vector certificate;
//	                           (ii)  debt EXACT at pin;
//	                           (iii) the S-clock boolean custody weld:
//	                                 ComputeDMHealth over ALL inputs at S,
//	                                 bit-exact against liquidatable@S;
//	                           (iv)  the Law@P pin-vector substitution: scalar
//	                                 AND boolean over the chain's own pin
//	                                 vector weld bit-exact, and the per-token
//	                                 delta reconciles to the flip;
//	                           (v)   the row's own sweep age inside the
//	                                 freshness budget.
//	DRIFT / weld-unread        anything else, gated. An S-clock weld failure
//	                           over a PASSING collateral certificate is
//	                           dmClassSClockCustodyDrift (ESCALATE).
//
// The strict-> discrimination stays OWN-CLOCK: conjuncts (iii) and (iv) both
// recompute the SAME strict inequality (ComputeDMHealth's own `>`,
// internal/risk/dm.go:141) at two chain-attested endpoints. What that
// GUARANTEES is bounded and stated honestly (Wave H4a, Codex's note): an
// inequality-direction defect (a >= where > belongs) flips the boolean only
// where an endpoint sits at EXACT equality, so the welds detect it exactly
// when either chain-attested endpoint lands on the boundary — which is what
// the equality unit test (TestDMStrictInequalityEqualityIsHealthy) pins, and
// why the nearest-boundary account is a MANDATORY cohort member: it is the
// sharpest available probe of the boundary, not a proof the welds catch every
// >= at every input. Off-boundary endpoints weld identically under > and >=,
// and the conjuncts make no stronger claim.
//
// There is NO count tolerance here: each row is individually proven, and the
// population-level census (dmMotionCensusRow) gates separately.
func classifyDMBoolean(fx dmBooleanFacts) (verdict, class string, gated bool, reasons []string) {
	if fx.Ours == fx.Chain {
		return verdictExact, "", true, nil
	}
	direction := dmDirectionFalsePositive
	if fx.Chain && !fx.Ours {
		direction = dmDirectionFalseNegative
	}

	// Conjunct (i): without the sample-gap certificate the pin difference has
	// no proven mechanical cause — the disagreement localises to the quantity
	// legs and gates as plain boolean drift.
	if fx.MaxBorrowLegVerdict != verdictSampleGap {
		return verdictDrift, "boolean-direction(" + direction + ")", true,
			[]string{fmt.Sprintf("conjunct (i) failed: the maxBorrow leg classified %q, not %s — motion is provable only through the full sample-gap certificate (vector byte-identical at S + scalar law recompute)", fx.MaxBorrowLegVerdict, verdictSampleGap)}
	}
	// Conjunct (ii): debt is same-clock event-derived. Any disagreement is
	// drift, never motion.
	if !fx.DebtExactAtPin {
		return verdictDrift, "boolean-direction(" + direction + ")", true,
			[]string{"conjunct (ii) failed: borrowingOf(user).total@pin does not weld EXACT against our index-replayed debt — debt is same-clock event-derived, so any disagreement is drift, never motion"}
	}
	// Conjunct (iii): the S-clock boolean custody weld.
	if fx.Own == nil || !fx.Own.BoolRead || !fx.Own.OursLiqComputed {
		why := "the S-clock boolean custody weld was not produced"
		if fx.Own != nil && fx.Own.BoolErr != "" {
			why += ": " + fx.Own.BoolErr
		}
		return verdictWeldUnread, "s-clock-boolean-weld-unread", true, []string{why}
	}
	if fx.Own.OursLiqS != fx.Own.ChainLiqS {
		// The collateral certificate PASSED (conjunct i) and the composition
		// law still disagrees with the chain at the one clock where every
		// input is proven identical: the law itself diverges. ESCALATE.
		return verdictDrift, dmClassSClockCustodyDrift, true,
			[]string{fmt.Sprintf("conjunct (iii) FAILED over a PASSING collateral certificate: ComputeDMHealth over all-S inputs says liquidatable=%v while liquidatable(user)@blockHash(S) says %v — the composition law diverging from chain is custody drift, escalated immediately (chain-truth, boolean-leg ruling)", fx.Own.OursLiqS, fx.Own.ChainLiqS)}
	}
	// Conjunct (iv): the Law@P pin-vector substitution.
	if fx.PinVec == nil || !fx.PinVec.Read {
		why := "the pin-vector substitution was not produced"
		if fx.PinVec != nil && fx.PinVec.Err != "" {
			why += ": " + fx.PinVec.Err
		}
		return verdictWeldUnread, "pin-vector-substitution-unread", true, []string{why}
	}
	if fx.PinVec.Err != "" {
		return verdictWeldUnread, "pin-vector-substitution-unread", true, []string{fx.PinVec.Err}
	}
	if !fx.PinVec.ScalarWeld || !fx.PinVec.BoolWeld {
		return verdictDrift, "pin-vector-law-divergence(" + direction + ")", true,
			[]string{fmt.Sprintf("conjunct (iv) failed: over the CHAIN's own pin vector with the run's pinned prices/params/decimals and the welded debt@P, scalar weld=%v boolean weld=%v — the law@P substitution must reproduce getMaxBorrowAmount@P AND liquidatable@P bit-exact", fx.PinVec.ScalarWeld, fx.PinVec.BoolWeld)}
	}
	if !fx.PinVec.Reconciles {
		return verdictDrift, "motion-not-reconciled(" + direction + ")", true,
			[]string{"conjunct (iv) failed: the per-token LT-weighted vector delta does not arithmetically produce the flip (Σ per-token deltas != getMaxBorrowAmount@P − ourMax(mixed))"}
	}
	// Conjunct (v): the freshness budget. Motion OUTSIDE the budget is a
	// freshness violation and gates THERE — never absorbed as motion.
	if !fx.Own.AgeKnown || fx.BudgetSeconds <= 0 {
		return verdictWeldUnread, "sweep-age-unread", true,
			[]string{"conjunct (v) unprovable: the sweep-age clock (headerTime@P_op − headerTime@S) or the cadence budget was not available — a motion row cannot be disclosed without its bounded staleness"}
	}
	if fx.Own.AgeSeconds > fx.BudgetSeconds {
		return verdictDrift, "motion-outside-freshness-budget(" + direction + ")", true,
			[]string{fmt.Sprintf("conjunct (v) failed: sweep age %ds exceeds the sweeper-cadence budget %ds — this row's staleness is a freshness defect, not weather", fx.Own.AgeSeconds, fx.BudgetSeconds)}
	}
	return verdictBoundaryMotion, "boolean-boundary-crossing(motion-proven, " + direction + ")", false, nil
}

// dmMotionPopulationGate is the population-level guard on the disclosed class
// (both rulings): a MOTION count exceeding ~1% of the evaluable universe is
// weather refuted by its own frequency — the sweep cadence collapsing — and
// gates as sweeper-health. No count tolerance exists on the rows themselves;
// this is a census over individually-proven rows.
func dmMotionPopulationGate(motionCount, evaluableCount int) bool {
	return motionCount*100 > evaluableCount
}

// dmNeverSweptRace is the never-swept AGE GUARD, decided from the sweeper's
// own PER-GENERATION state (Wave H4a, Codex F2 — replacing the Wave-H3
// fleet-minimum shape, which could FALSE-PASS: the fleet's minimum historical
// success block is a floor over MANY generations, so one stale straggler
// success — an account with an old success and recent failed attempts —
// pinned it below every later borrower's arrival forever, and a borrower a
// later COMPLETED generation genuinely skipped classified "honest race").
//
// THE LAW: honest-race is claimable ONLY on a positive cycle-specific witness
// that NO sweep generation both opened after the account's first-debt block
// and completed at or below the pin. Anything unprovable GATES — missing or
// sticky cycle evidence is never disclosed.
//
// WHAT THE SCHEMA CAN AND CANNOT STATE (studied, not assumed):
// sweep_generations keeps ONE row per engine — current_generation, opened_at,
// completed_at (wall-clock; opening the next generation overwrites the stamp,
// and a rewind bumps the generation WITHOUT completing it), so only the
// CURRENT generation's completion is durably knowable, and no generation's
// open/complete BLOCK is recorded anywhere. snapshot_sweeps keeps each
// account's LAST attempt (generation, last_attempt_block), so per-generation
// attempt spans are reconstructable but can only SHRINK as later generations
// overwrite rows. Three sound derivations survive those bounds:
//
//	(1) an attempt row of generation g at block a proves open(g) <= a
//	    (attempts execute only after their generation opens), and opens are
//	    monotone in g — so ANY attempt by a generation >= K at or below B
//	    proves open(K) <= B and hence open(g) <= B for every g <= K;
//	(2) the CURRENT generation's rows are complete (nothing overwrites them),
//	    so when it is stamped complete, max(last_attempt_block) over them IS
//	    its completion block;
//	(3) K — the newest generation that could have completed at or below the
//	    pin — is the current generation when (2) puts its completion at or
//	    below the pin, else the one before it (later generations open later,
//	    so proving open(K) <= firstDebt clears every candidate at once).
//
// firstDebt == 0 (arrival unknown) fails CLOSED. No generation row at all
// means no cycle has EVER completed — race proven structurally per row, and
// the census denominator guard is what fails a stopped/never-started sweeper
// en masse (the vacuous-pass guard both rulings require).
//
// The returned witness string is the receipt: it states WHICH generation
// evidence carried the decision, and the per-account evidence field prints it.
func dmNeverSweptRace(firstDebt, pin uint64, cy snapshotdb.T6SweepCycles) (bool, string) {
	if firstDebt == 0 {
		return false, "arrival edge unknown (no custodied first debt block at or below the pin): a race cannot be claimed for an account whose arrival custody cannot state — fails closed"
	}
	if !cy.Read {
		return false, "Stage A did not collect the sweep-cycle witness (DMSweepCycles unread): missing cycle evidence is GATED, never disclosed"
	}
	if !cy.HaveGenerationRow {
		return true, "no sweep_generations row: no sweep generation has ever been opened, so no cycle can have completed since this account arrived — the stopped/never-started-sweeper shape, which the census denominator guard fails en masse"
	}
	// K = the newest generation that could have completed at or below the pin.
	k := cy.CurrentGeneration
	if cy.CurrentCompleted {
		span, ok := cy.Generations[k]
		switch {
		case !ok:
			return false, fmt.Sprintf("generation %d is stamped complete but no snapshot_sweeps row witnesses any of its attempts: sticky cycle evidence — a race needs a positive per-generation witness, so this GATES", k)
		case span.MaxAttemptBlock > pin:
			// The current generation completed ABOVE the pin (its rows are
			// complete, so the max attempt block is its true completion
			// block): it is not a candidate; the one before it is.
			k--
		}
	} else {
		// The current generation is still open: it has completed nothing.
		k--
	}
	if k == 0 {
		return true, fmt.Sprintf("current generation %d has completed nothing at or below pin %d and no earlier generation exists: no cycle can both have opened after the arrival edge %d and completed at or below the pin", cy.CurrentGeneration, pin, firstDebt)
	}
	// The opening-edge witness for K: any attempt by a generation >= K at or
	// below the arrival edge proves open(K) <= firstDebt (derivation 1), and
	// then EVERY candidate generation <= K opened at or before the arrival —
	// no cycle has been OWED this account yet.
	for g := k; g <= cy.CurrentGeneration; g++ {
		if span, ok := cy.Generations[g]; ok && span.Rows > 0 && span.MinAttemptBlock <= firstDebt {
			return true, fmt.Sprintf("generation %d attempted at block %d <= first debt block %d, so generation %d (the newest that could have completed at or below pin %d) opened at or before the arrival — no completed cycle has been owed this account", g, span.MinAttemptBlock, firstDebt, k, pin)
		}
	}
	return false, fmt.Sprintf("no attempt by generation >= %d is witnessed at or below the arrival edge %d: either a completed generation opened after this account arrived and still skipped it (a sweeper defect), or the opening edge is unwitnessable — both GATE, because missing or sticky cycle evidence is never disclosed", k, firstDebt)
}

// dmParamsAtBlock folds the FULL raw DM config ledger prefix at `block` into
// the effective ParamRow set — the SAME latest-wins / removal / re-addition
// semantics as store.DMParamsAsOf (internal/store/risk.go), replayed over the
// Stage-A raw rows so ANY historical cut S <= P_op is reconstructable:
//
//   - collateral_token_config_set replaces the asset's effective row;
//   - collateral_token_removed hides the asset (the last config row is KEPT,
//     exactly as the store keeps it);
//   - collateral_token_added un-hides it, REVIVING the pre-removal config row
//     without a new row of its own.
//
// This is deliberately NOT a call into internal/store (the sibling wave owns
// that package; the gate reads the ledger through cmd/reconcile's own Stage-A
// SQL per the package's standing precedent) — but the semantics are the
// store's, and the transition tests in wave_h4a_fixes_test.go pin all three
// arms against the collapsed-filter shape this replaces.
func dmParamsAtBlock(ledger []snapshotdb.T6DMParamEvent, block uint64) []store.ParamRow {
	type entry struct {
		row     store.ParamRow
		removed bool
		present bool
	}
	byAsset := map[string]*entry{}
	var order []string
	for _, ev := range ledger {
		if ev.Block > block {
			continue
		}
		e, ok := byAsset[ev.AssetHex]
		if !ok {
			e = &entry{}
			byAsset[ev.AssetHex] = e
			order = append(order, ev.AssetHex)
		}
		switch ev.EventType {
		case "collateral_token_removed":
			e.removed = true
			continue
		case "collateral_token_added":
			e.removed = false
			continue
		}
		asset, err := hex.DecodeString(ev.AssetHex)
		if err != nil {
			// Stage A encodes the hex itself; an undecodable asset would be a
			// collector defect. Refusing the row (leaving the asset absent) is
			// the fail-closed direction: the S weld then refuses loudly on the
			// missing param rather than folding a fabricated one.
			continue
		}
		tx, _ := hex.DecodeString(ev.TxHashHex)
		e.row = store.ParamRow{
			Engine:            dmEngine,
			ChainID:           ev.ChainID,
			Asset:             asset,
			LTV:               ev.LTV,
			LiqThreshold:      ev.LiqThreshold,
			LiqBonus:          ev.LiqBonus,
			EffectiveBlock:    ev.Block,
			EffectiveLogIndex: ev.LogIndex,
			SourceEvent:       ev.EventType,
			TxHash:            tx,
		}
		e.present = true
		e.removed = false
	}
	var out []store.ParamRow
	for _, key := range order {
		e := byAsset[key]
		if !e.present || e.removed {
			continue
		}
		out = append(out, e.row)
	}
	// The caller folds a (block, log_index)-ordered ledger; keep the contract.
	sort.SliceStable(out, func(i, j int) bool {
		if out[i].EffectiveBlock != out[j].EffectiveBlock {
			return out[i].EffectiveBlock < out[j].EffectiveBlock
		}
		return out[i].EffectiveLogIndex < out[j].EffectiveLogIndex
	})
	return out
}

// dmFoldParamsAtS is the S-clock param fold the own-clock welds consume: the
// raw ledger cut at S, folded by the ONE fold implementation riskd folds with.
// A Task6 snapshot without the raw ledger (a fixture that predates Wave H4a,
// or a wiring gap) REFUSES rather than falling back to filtering the
// collapsed pin view — the fallback IS the F4 defect.
func dmFoldParamsAtS(t6 *snapshotdb.Task6Data, s uint64) ([]risk.ParamRow, error) {
	if t6 == nil || !t6.DMParamLedgerRead {
		return nil, fmt.Errorf("Stage A did not collect the raw DM config ledger (DMParamLedgerRead=false): the S-clock param cut cannot be reconstructed from the collapsed pin fold (Wave H4a, Codex F4)")
	}
	return riskfeed.FoldParams(dmEngine, 10, dmParamsAtBlock(t6.DMParamLedger, s))
}

// dmOwnClockProbe names one account the discrimination read is issued for.
type dmOwnClockProbe struct {
	acct   common.Address
	key    string
	sweep  uint64
	reason string
}

// runDMOwnClockWelds performs the own-clock discrimination welds, grouped by
// sweep block so accounts sharing an S share one hash resolution and one
// multicall. Every failure is recorded per account, never fatal: a dead read at
// one S must not erase the classification of every other account.
func runDMOwnClockWelds(ctx context.Context, c *p3Ctx, f *gateFrame, probes []dmOwnClockProbe,
	st dmTokenState, coll map[string][]snapshotdb.T6Leg, debtUSD map[string]*big.Int) map[string]*dmOwnClockResult {
	out := map[string]*dmOwnClockResult{}
	if len(probes) == 0 {
		return out
	}
	byS := map[uint64][]dmOwnClockProbe{}
	for _, p := range probes {
		byS[p.sweep] = append(byS[p.sweep], p)
	}
	sweeps := make([]uint64, 0, len(byS))
	for s := range byS {
		sweeps = append(sweeps, s)
	}
	sort.Slice(sweeps, func(i, j int) bool { return sweeps[i] < sweeps[j] })

	// The sweep-age clock's pin endpoint (conjunct v), read ONCE for the whole
	// probe set. A failed read leaves every age unknown — "cannot verify" for
	// any motion candidate, never a default age.
	pinTime, _, pinTimeErr := c.opR.headerTime(ctx, c.pinOP)

	for _, s := range sweeps {
		group := byS[s]
		fail := func(note string) {
			for _, p := range group {
				out[p.key] = &dmOwnClockResult{Block: s, Err: note}
			}
		}
		if s == 0 {
			fail("no successful sweep at or below the pin, so there is no own clock to weld at")
			continue
		}
		hash, _, err := c.opR.headerHash(ctx, s)
		if err != nil {
			fail(fmt.Sprintf("headerHash(%d) did not resolve: %v", s, err))
			continue
		}
		f.use(dmOwnClockHeaderSource)

		// The sweep-age clock's S endpoint. S is deep-finalized, same posture
		// as the headerHash resolution above.
		ageKnown, ageSeconds := false, int64(0)
		if pinTimeErr == nil {
			if sTime, _, err := c.opR.headerTime(ctx, s); err == nil {
				ageKnown, ageSeconds = true, int64(pinTime)-int64(sTime)
				f.use(dmSweepAgeClockSource)
			}
		}

		// The token set the recompute needs at S: the union of the group's
		// persisted legs. Decimals are the pin reads (an ERC20's decimals is
		// immutable by convention; a token that changed them between S and the pin
		// would fail this weld loudly, which is the correct direction).
		tokenSet := map[common.Address]bool{}
		for _, p := range group {
			for _, l := range coll[p.key] {
				tokenSet[common.HexToAddress(l.AssetHex)] = true
			}
		}
		tokens := sortedAddrs(tokenSet)

		var calls []multicallCall
		type tag struct {
			kind string
			acct common.Address
			tok  common.Address
		}
		var tags []tag
		bad := false
		for _, p := range group {
			d, err := dmGetMaxBorrowAmountABI.Pack("getMaxBorrowAmount", p.acct, false)
			if err != nil {
				fail("pack getMaxBorrowAmount: " + err.Error())
				bad = true
				break
			}
			calls, tags = append(calls, multicallCall{Target: c.dmProxy, CallData: d}), append(tags, tag{kind: "max", acct: p.acct})
			// The CUSTODY PROOF: the exact read the sweeper persists
			// (collateralOf, internal/snapshot/snapshot.go:634), re-issued at S.
			if d, err = dmCollateralOfABI.Pack("collateralOf", p.acct); err != nil {
				fail("pack collateralOf: " + err.Error())
				bad = true
				break
			}
			calls, tags = append(calls, multicallCall{Target: c.dmProxy, CallData: d}), append(tags, tag{kind: "vector", acct: p.acct})
			// The S-CLOCK BOOLEAN CUSTODY WELD's chain side (conjunct iii):
			// liquidatable(user) at the account's own sweep hash.
			if d, err = dmLiquidatableABI.Pack("liquidatable", p.acct); err != nil {
				fail("pack liquidatable: " + err.Error())
				bad = true
				break
			}
			calls, tags = append(calls, multicallCall{Target: c.dmProxy, CallData: d}), append(tags, tag{kind: "bool", acct: p.acct})
		}
		if bad {
			continue
		}
		// The interest index AT S for every borrow token: the bridge from the
		// Stage-A normalized debt fold at S to the USD-6 debt the boolean weld
		// consumes — the same bridge shape the pin side uses. The whole borrow
		// universe is packed (bounded, single-digit) rather than a per-account
		// subset so the read is alive whenever any probe runs.
		for _, t := range st.borrow {
			d, err := dmGetCurrentIndexABI.Pack("getCurrentIndex", t)
			if err != nil {
				fail("pack getCurrentIndex: " + err.Error())
				bad = true
				break
			}
			calls, tags = append(calls, multicallCall{Target: c.dmProxy, CallData: d}), append(tags, tag{kind: "index", tok: t})
		}
		if bad {
			continue
		}
		for _, t := range tokens {
			dec, ok := st.decimals[t]
			if !ok {
				// The pin pass could not read this token's decimals; the account
				// carrying it was already refused as position-unvaluable at the pin,
				// so a probe reaching here is a bookkeeping error surfaced per account
				// below by the missing price.
				continue
			}
			d, err := dmConvertCollateralToUsdABI.Pack("convertCollateralTokenToUsd", t, pow10Big(dec))
			if err != nil {
				fail("pack convertCollateralTokenToUsd: " + err.Error())
				bad = true
				break
			}
			calls, tags = append(calls, multicallCall{Target: c.dmProxy, CallData: d}), append(tags, tag{kind: "price", tok: t})
		}
		if bad {
			continue
		}
		res, _, err := c.opR.multicall(ctx, fmt.Sprintf("p3:dm:ownClockWeld@%d", s), s, hash, calls)
		if err != nil {
			fail(fmt.Sprintf("own-clock multicall at %d did not answer: %v", s, err))
			continue
		}
		chainMaxAt := map[common.Address]*big.Int{}
		chainVecAt := map[common.Address][]tokenAmount{}
		vecDecoded := map[common.Address]bool{}
		priceAt := map[common.Address]*big.Int{}
		indexAt := map[common.Address]*big.Int{}
		chainLiqAt := map[common.Address]bool{}
		liqDecoded := map[common.Address]bool{}
		readNote := map[common.Address]string{}
		vectorNote := map[common.Address]string{}
		boolNote := map[common.Address]string{}
		for i, tg := range tags {
			if !res[i].Success {
				switch tg.kind {
				case "max":
					readNote[tg.acct] = "getMaxBorrowAmount reverted at S"
				case "vector":
					vectorNote[tg.acct] = "collateralOf reverted at S"
				case "bool":
					boolNote[tg.acct] = "liquidatable reverted at S"
				}
				// A reverted price or index at S surfaces as a per-account
				// refusal below.
				continue
			}
			switch tg.kind {
			case "max":
				v, err := unpackUint256Strict(dmGetMaxBorrowAmountABI, "getMaxBorrowAmount", res[i].ReturnData)
				if err != nil {
					readNote[tg.acct] = err.Error()
					continue
				}
				chainMaxAt[tg.acct] = v
				f.use(dmOwnClockMaxBorrowSource)
			case "vector":
				list, _, err := unpackTokenAmountList(dmCollateralOfABI, "collateralOf", res[i].ReturnData)
				if err != nil {
					vectorNote[tg.acct] = err.Error()
					continue
				}
				chainVecAt[tg.acct] = list
				vecDecoded[tg.acct] = true
				f.use(dmOwnClockVectorSource)
			case "bool":
				v, err := unpackBoolStrict(dmLiquidatableABI, "liquidatable", res[i].ReturnData)
				if err != nil {
					boolNote[tg.acct] = err.Error()
					continue
				}
				chainLiqAt[tg.acct] = v
				liqDecoded[tg.acct] = true
				f.use(dmSClockLiquidatableSource)
			case "index":
				v, err := unpackUint256Strict(dmGetCurrentIndexABI, "getCurrentIndex", res[i].ReturnData)
				if err != nil {
					continue
				}
				indexAt[tg.tok] = v
				f.use(dmSClockIndexSource)
			case "price":
				v, err := unpackUint256Strict(dmConvertCollateralToUsdABI, "convertCollateralTokenToUsd", res[i].ReturnData)
				if err != nil {
					continue
				}
				priceAt[tg.tok] = v
				f.use(dmOwnClockPriceSource)
			}
		}

		// The param ledger re-cut at S: the SAME custody chain, the SAME fold —
		// folded from the FULL raw Stage-A ledger prefix, never by filtering
		// the collapsed pin view (Wave H4a, Codex F4: DMParamsAsOf(P) keeps
		// only each asset's newest P-effective row, so a token whose config
		// changed — or was removed/re-added — inside (S, P] has no S-effective
		// row left to filter, and ordinary parameter motion would fail the
		// honest S weld as a wrong rejection).
		foldedAtS, err := dmFoldParamsAtS(c.t6, s)
		if err != nil {
			fail("fold dm param ledger at S: " + err.Error())
			continue
		}
		f.use(dmParamLedgerSource)

		for _, p := range group {
			r := &dmOwnClockResult{Block: s, Hash: hash, AgeKnown: ageKnown, AgeSeconds: ageSeconds}
			out[p.key] = r
			// The S-clock boolean's CHAIN side, recorded first so a refusal on
			// any later leg still leaves the read-presence fact honest.
			if note := boolNote[p.acct]; note != "" {
				r.BoolErr = note
			} else if liqDecoded[p.acct] {
				r.BoolRead = true
				r.ChainLiqS = chainLiqAt[p.acct]
			} else {
				r.BoolErr = "liquidatable produced no decoded value at S"
			}
			// The CUSTODY PROOF first: byte-compare the chain's own vector at S
			// against the persisted document before any scalar leg can refuse.
			// A vector that did not decode leaves VectorRead=false, which the
			// classifier turns into weld-unread; a vector MISMATCH is custody
			// drift whatever the scalar legs below produce.
			if note := vectorNote[p.acct]; note != "" {
				r.Err = note
			} else if vecDecoded[p.acct] {
				persisted := dmPersistedVector(coll[p.key])
				r.VectorRead = true
				r.VectorLegs = len(persisted)
				r.VectorMatch, r.VectorDiff = compareDMCollateralVector(chainVecAt[p.acct], persisted)
			} else {
				r.Err = "collateralOf produced no decoded value at S"
			}
			if r.Err != "" {
				continue
			}
			if note := readNote[p.acct]; note != "" {
				r.Err = note
				continue
			}
			cm := chainMaxAt[p.acct]
			if cm == nil {
				r.Err = "getMaxBorrowAmount produced no decoded value at S"
				continue
			}
			// The S-clock DEBT bridge (conjunct iii): the Stage-A fold at S
			// through getCurrentIndex@S — the same bridge shape the pin side
			// uses. A nil Stage-A map is a wiring/fixture gap and refuses the
			// BOOLEAN weld only; a missing account entry is the honest zero
			// (no debt events at or below the account's own S).
			var debtS *big.Int
			if c.t6 == nil || c.t6.DMDebtFoldAtS == nil {
				if r.BoolErr == "" {
					r.BoolErr = "Stage A did not collect the debt fold at S (DMDebtFoldAtS nil)"
				}
			} else {
				f.use(dmDebtFoldAtSSource)
				debtS = new(big.Int)
				folds := c.t6.DMDebtFoldAtS[p.key]
				tokHexes := make([]string, 0, len(folds))
				for tokHex := range folds {
					tokHexes = append(tokHexes, tokHex)
				}
				sort.Strings(tokHexes)
				for _, tokHex := range tokHexes {
					n := folds[tokHex]
					if n == nil || n.Sign() == 0 {
						continue
					}
					idx := indexAt[common.HexToAddress("0x"+tokHex)]
					if idx == nil {
						debtS = nil
						if r.BoolErr == "" {
							r.BoolErr = "no decoded getCurrentIndex@S for borrow token 0x" + tokHex
						}
						break
					}
					debtS.Add(debtS, mulDivFloor(n, idx))
				}
			}
			// ONE compute over ALL inputs at S when the debt bridge produced:
			// the boolean then IS ComputeDMHealth's own strict > — the served
			// composition law, never a re-implementation. When the bridge
			// refused, the compute falls back to the pin debt so the SCALAR law
			// check (debt-independent) keeps its established semantics, and the
			// boolean stays honestly unproduced.
			computeDebt := orZeroBig(debtUSD[p.key])
			if debtS != nil {
				computeDebt = debtS
			}
			in := risk.DMInput{
				Account: p.acct,
				DebtUSD: computeDebt,
				Params:  foldedAtS,
				Marks:   risk.Watermarks{BalancesBlock: s, ParamsBlock: s, SweepBlock: s},
			}
			refused := ""
			for _, l := range coll[p.key] {
				tok := common.HexToAddress(l.AssetHex)
				dec, okDec := st.decimals[tok]
				pr := priceAt[tok]
				if !okDec || pr == nil {
					refused = "collateral token 0x" + l.AssetHex + " has no own-clock price and/or pinned decimals"
					break
				}
				in.Collateral = append(in.Collateral, risk.DMCollateral{Asset: tok, Amount: l.Amount, Decimals: dec})
				in.Prices = append(in.Prices, risk.PriceInput{
					ChainID: 10, Asset: tok, Source: "dm:convertCollateralTokenToUsd@ownSweepBlock", Block: s,
					Value: pr, Decimals: 6, Provenance: risk.ProvenanceEngineExact, Fresh: true,
				})
			}
			if refused != "" {
				r.Err = refused
				continue
			}
			h, err := risk.ComputeDMHealth(in)
			if err != nil {
				r.Err = "internal/risk refused at S: " + err.Error()
				continue
			}
			r.ChainMax, r.OurMax = cm, h.MaxBorrowLT
			if debtS != nil {
				// Every input at S: the boolean is the compute's own verdict.
				r.OursLiqComputed = true
				r.OursLiqS = h.Liquidatable
				r.DebtUSDAtS = debtS
			}
		}
	}
	return out
}

// runDMPinVectorSubstitution performs the Law@P PIN-VECTOR SUBSTITUTION
// (risk-quant conjunct iv) for the named subjects: collateralOf(user) read at
// the RUN PIN's hash — the chain's own enumerated netted vector
// (DebtManagerCore.sol:170-183) — then the scalar and the boolean recomputed
// over THAT vector with the run's pinned prices/params/decimals and the
// welded chain debt@P, welded bit-exact against getMaxBorrowAmount@P and
// liquidatable@P. Every failure is recorded per account, never fatal.
func runDMPinVectorSubstitution(ctx context.Context, c *p3Ctx, f *gateFrame, subjects []common.Address,
	st dmTokenState, folded []risk.ParamRow, chainDebt, chainMax map[common.Address]*big.Int,
	chainBool map[common.Address]bool, health map[string]risk.DMHealth) map[string]*dmPinVectorResult {
	out := map[string]*dmPinVectorResult{}
	if len(subjects) == 0 {
		return out
	}
	var calls []multicallCall
	for _, a := range subjects {
		d, err := dmCollateralOfABI.Pack("collateralOf", a)
		if err != nil {
			for _, a2 := range subjects {
				out[hex.EncodeToString(a2.Bytes())] = &dmPinVectorResult{Err: "pack collateralOf: " + err.Error()}
			}
			return out
		}
		calls = append(calls, multicallCall{Target: c.dmProxy, CallData: d})
	}
	res, _, err := c.opR.multicall(ctx, "p3:dm:pinVectorSubstitution", c.pinOP, c.hashOP, calls)
	if err != nil {
		for _, a := range subjects {
			out[hex.EncodeToString(a.Bytes())] = &dmPinVectorResult{Err: fmt.Sprintf("pin-vector multicall did not answer: %v", err)}
		}
		return out
	}
	for i, a := range subjects {
		key := hex.EncodeToString(a.Bytes())
		r := &dmPinVectorResult{}
		out[key] = r
		if !res[i].Success {
			r.Err = "collateralOf reverted at the pin"
			continue
		}
		list, _, err := unpackTokenAmountList(dmCollateralOfABI, "collateralOf", res[i].ReturnData)
		if err != nil {
			r.Err = "collateralOf did not decode at the pin: " + err.Error()
			continue
		}
		r.Read = true
		f.use(dmPinVectorSource)

		// The chain's pin vector, normalized exactly like the persisted
		// document (zero-drop, duplicate-add) so both endpoints are the same
		// document shape.
		pinVec := map[common.Address]*big.Int{}
		for _, e := range list {
			if e.Amount == nil || e.Amount.Sign() == 0 {
				continue
			}
			if prev, ok := pinVec[e.Token]; ok {
				pinVec[e.Token] = new(big.Int).Add(prev, e.Amount)
			} else {
				pinVec[e.Token] = new(big.Int).Set(e.Amount)
			}
		}

		cd, cm := chainDebt[a], chainMax[a]
		if cd == nil || cm == nil {
			r.Err = "the pin-side borrowingOf/getMaxBorrowAmount legs are unavailable — the substitution has nothing chain-attested to weld against"
			continue
		}
		in := risk.DMInput{
			Account: a,
			DebtUSD: cd, // the WELDED chain debt@P (conjunct ii holds it equal to ours)
			Params:  folded,
			Marks:   risk.Watermarks{BalancesBlock: c.pinOP, ParamsBlock: c.pinOP, SweepBlock: c.pinOP},
		}
		refused := ""
		for _, tok := range sortedAddrs(func() map[common.Address]bool {
			set := map[common.Address]bool{}
			for t := range pinVec {
				set[t] = true
			}
			return set
		}()) {
			dec, okDec := st.decimals[tok]
			p := st.prices[tok]
			if !okDec || p == nil {
				refused = "pin-vector token " + tok.Hex() + " has no pinned price and/or decimals"
				break
			}
			in.Collateral = append(in.Collateral, risk.DMCollateral{Asset: tok, Amount: pinVec[tok], Decimals: dec})
			in.Prices = append(in.Prices, risk.PriceInput{
				ChainID: 10, Asset: tok, Source: "dm:convertCollateralTokenToUsd@pin", Block: c.pinOP,
				Value: p, Decimals: 6, Provenance: risk.ProvenanceEngineExact, Fresh: true,
			})
		}
		if refused != "" {
			r.Err = refused
			continue
		}
		h, err := risk.ComputeDMHealth(in)
		if err != nil {
			r.Err = "internal/risk refused over the pin vector: " + err.Error()
			continue
		}
		r.ScalarP, r.BoolP = h.MaxBorrowLT, h.Liquidatable
		r.ScalarWeld = r.ScalarP.Cmp(cm) == 0
		r.BoolWeld = r.BoolP == chainBool[a]

		// The MOTION LEDGER: per-token LT-weighted USD-6 contribution deltas,
		// vector@P − vector@S(mixed), both through ComputeDMHealth's own
		// per-token floor-then-sum law with the same pinned prices and params.
		mixed, okMixed := health[key]
		if okMixed && mixed.MaxBorrowLT != nil {
			contribP := map[common.Address]*big.Int{}
			for _, cv := range h.Collateral {
				contribP[cv.Asset] = cv.MaxBorrowContribution
			}
			contribS := map[common.Address]*big.Int{}
			for _, cv := range mixed.Collateral {
				contribS[cv.Asset] = cv.MaxBorrowContribution
			}
			union := map[common.Address]bool{}
			for t := range contribP {
				union[t] = true
			}
			for t := range contribS {
				union[t] = true
			}
			sum := new(big.Int)
			for _, tok := range sortedAddrs(union) {
				p, sv := orZeroBig(contribP[tok]), orZeroBig(contribS[tok])
				d := new(big.Int).Sub(p, sv)
				sum.Add(sum, d)
				if d.Sign() != 0 {
					r.PerTokenDeltas = append(r.PerTokenDeltas,
						fmt.Sprintf("%s: ΔLT-weighted %s USD-6 (P %s − S %s, Δamount × pinned price through the LT law)", tok.Hex(), d, p, sv))
				}
			}
			r.DeltaSum = sum
			// The flip's arithmetic: Σ per-token deltas must BE the distance
			// between the chain's own scalar at P and the mixed scalar the
			// served verdict used.
			r.Reconciles = sum.Cmp(new(big.Int).Sub(cm, mixed.MaxBorrowLT)) == 0
		}
	}
	return out
}

// weldDMCohort welds the boolean, the threshold-weighted collateral and the
// live debt total against the chain, per cohort member. The maxBorrow leg is
// judged by the three-state law (classifyDMMaxBorrow); the debt leg stays a
// single-clock pin weld; the BOOLEAN leg is judged by the adjudicated
// three-state law (classifyDMBoolean, Wave H3).
func weldDMCohort(ctx context.Context, c *p3Ctx, f *gateFrame, cohort []dmSubject, health map[string]risk.DMHealth,
	st dmTokenState, coll map[string][]snapshotdb.T6Leg, debtUSD map[string]*big.Int,
	folded []risk.ParamRow, evaluableCount int) ([]p3Row, error) {
	var rows []p3Row
	if len(cohort) == 0 {
		// The standing motion census exists EVERY run — an empty cohort still
		// states its zero.
		rows = append(rows, dmMotionCensusRow(nil, evaluableCount, 0))
		return rows, nil
	}
	var calls []multicallCall
	type tag struct {
		kind string
		acct common.Address
	}
	var tags []tag
	for _, s := range cohort {
		d, err := dmLiquidatableABI.Pack("liquidatable", s.Account)
		if err != nil {
			return rows, err
		}
		calls, tags = append(calls, multicallCall{Target: c.dmProxy, CallData: d}), append(tags, tag{"bool", s.Account})
		if d, err = dmGetMaxBorrowAmountABI.Pack("getMaxBorrowAmount", s.Account, false); err != nil {
			return rows, err
		}
		calls, tags = append(calls, multicallCall{Target: c.dmProxy, CallData: d}), append(tags, tag{"maxBorrow", s.Account})
		if d, err = dmBorrowingOfAllABI.Pack("borrowingOf", s.Account); err != nil {
			return rows, err
		}
		calls, tags = append(calls, multicallCall{Target: c.dmProxy, CallData: d}), append(tags, tag{"borrowingOf", s.Account})
	}
	res, _, err := c.opR.multicall(ctx, "p3:dm:booleanWeld", c.pinOP, c.hashOP, calls)
	if err != nil {
		return rows, dmPhaseErr(err)
	}
	chainBool := map[common.Address]bool{}
	chainMax := map[common.Address]*big.Int{}
	chainDebt := map[common.Address]*big.Int{}
	unread := map[common.Address]string{}
	for i, tg := range tags {
		if !res[i].Success {
			unread[tg.acct] = tg.kind + " reverted at the pin"
			continue
		}
		switch tg.kind {
		case "bool":
			v, err := unpackBoolStrict(dmLiquidatableABI, "liquidatable", res[i].ReturnData)
			if err != nil {
				unread[tg.acct] = err.Error()
				continue
			}
			chainBool[tg.acct] = v
		case "maxBorrow":
			v, err := unpackUint256Strict(dmGetMaxBorrowAmountABI, "getMaxBorrowAmount", res[i].ReturnData)
			if err != nil {
				unread[tg.acct] = err.Error()
				continue
			}
			chainMax[tg.acct] = v
		case "borrowingOf":
			_, total, err := unpackTokenAmountList(dmBorrowingOfAllABI, "borrowingOf", res[i].ReturnData)
			if err != nil {
				unread[tg.acct] = err.Error()
				continue
			}
			chainDebt[tg.acct] = total
		}
	}
	f.use("DebtManager.liquidatable(user)@pinHash(P_op)")
	f.use("DebtManager.getMaxBorrowAmount(user,false)@pinHash(P_op)")
	f.use("DebtManager.borrowingOf(user).total@pinHash(P_op)")
	f.use("cohort sampling seed = the OP pin's block hash (a chain fact, echoed in the report)")

	// ---- the own-clock discrimination probes -------------------------------
	// Every member whose pin-clock maxBorrow weld drifts gets the own-clock
	// read, PLUS one always-on CONTROL: the first weldable member with a sweep
	// block and at least one persisted leg. The control keeps the discrimination
	// read alive (and its frame sources consumed) on an all-exact run — a
	// discrimination read that only ever fires on failure is a read nobody has
	// proven the archive can still serve.
	probeReason := map[string]string{}
	var probes []dmOwnClockProbe
	addProbe := func(s dmSubject, reason string) {
		key := hex.EncodeToString(s.Account.Bytes())
		if prev, ok := probeReason[key]; ok {
			probeReason[key] = prev + "+" + reason
			return
		}
		probeReason[key] = reason
		probes = append(probes, dmOwnClockProbe{
			acct: s.Account, key: key,
			sweep:  c.t6.DMSweepByAccount[key].AtOrBelowPin,
			reason: reason,
		})
	}
	controlKey := ""
	for _, s := range cohort {
		acct := hex.EncodeToString(s.Account.Bytes())
		h := health[acct]
		cm := chainMax[s.Account]
		if cm == nil || h.MaxBorrowLT == nil {
			continue
		}
		if cm.Cmp(h.MaxBorrowLT) != 0 {
			addProbe(s, "pin-drift")
		}
		if controlKey == "" && c.t6.DMSweepByAccount[acct].AtOrBelowPin > 0 && len(coll[acct]) > 0 {
			controlKey = acct
			addProbe(s, "control")
		}
	}
	ownResults := runDMOwnClockWelds(ctx, c, f, probes, st, coll, debtUSD)

	// ---- the Law@P pin-vector substitution subjects -------------------------
	// Every member whose pin-clock boolean FLIPS (the only rows the motion law
	// can classify), PLUS the always-on control — the substitution read stays
	// alive and its frame source consumed on an all-exact run, same doctrine
	// as the own-clock control.
	var pinVecSubjects []common.Address
	seenPV := map[common.Address]bool{}
	addPV := func(a common.Address) {
		if !seenPV[a] {
			seenPV[a] = true
			pinVecSubjects = append(pinVecSubjects, a)
		}
	}
	for _, s := range cohort {
		acct := hex.EncodeToString(s.Account.Bytes())
		if _, bad := unread[s.Account]; bad {
			continue
		}
		if h, ok := health[acct]; ok && h.Liquidatable != chainBool[s.Account] {
			addPV(s.Account)
		}
		if acct == controlKey {
			addPV(s.Account)
		}
	}
	pinVecs := runDMPinVectorSubstitution(ctx, c, f, pinVecSubjects, st, folded, chainDebt, chainMax, chainBool, health)

	// The freshness budget (conjunct v): the sweeper-cadence bound §7 resolved
	// in Phase 1 — the daemon's own persisted cadence, never an operator knob.
	var budgetSeconds int64
	if c.p1 != nil {
		budgetSeconds = int64(c.p1.freshBound / time.Second)
	}

	var motions []dmMotionStat
	for _, s := range cohort {
		subject := s.Account.Hex()
		acct := hex.EncodeToString(s.Account.Bytes())
		if note, bad := unread[s.Account]; bad {
			rows = append(rows, unreadRow(gateDMBoolean, subject, "boolean-weld", note))
			continue
		}
		h := health[acct]
		maxLegVerdict := ""
		if cm := chainMax[s.Account]; cm != nil && h.MaxBorrowLT != nil {
			mrow := dmMaxBorrowRow(c, subject, acct, cm, h.MaxBorrowLT, ownResults[acct])
			maxLegVerdict = mrow.Verdict
			rows = append(rows, mrow)
		}
		if acct == controlKey {
			rows = append(rows, dmOwnClockControlRow(subject, probeReason[acct], ownResults[acct]))
		}
		debtExact := false
		if cd := chainDebt[s.Account]; cd != nil && h.Borrowings != nil {
			rows = append(rows, compareExact(gateDMBoolean, subject, "borrowingOf(user).total",
				cd, h.Borrowings, "index-replayed-debt"))
			debtExact = cd.Cmp(h.Borrowings) == 0
		}
		ours, chain := h.Liquidatable, chainBool[s.Account]
		fx := dmBooleanFacts{
			Ours: ours, Chain: chain,
			MaxBorrowLegVerdict: maxLegVerdict,
			DebtExactAtPin:      debtExact,
			Own:                 ownResults[acct],
			PinVec:              pinVecs[acct],
			BudgetSeconds:       budgetSeconds,
		}
		verdict, class, gated, reasons := classifyDMBoolean(fx)
		row := p3Row{
			Gate: gateDMBoolean, Subject: subject, Leg: "liquidatable(strict >)",
			Expected: fmt.Sprintf("%v", chain), Actual: fmt.Sprintf("%v", ours),
			Verdict: verdict, Gated: gated, Class: class,
			Evidence: map[string]string{
				"cohort_reasons": fmt.Sprint(s.Reasons),
				"margin_usd6":    marginText(s.Margin),
			},
		}
		switch verdict {
		case verdictExact:
			// unchanged: the bit-exact arm needs no note.
		case verdictBoundaryMotion:
			motion := dmMotionStat{
				direction:  class,
				margin:     s.Margin,
				ageBlocks:  c.pinOP - fx.Own.Block,
				ageSeconds: fx.Own.AgeSeconds,
			}
			motions = append(motions, motion)
			dmMotionEvidence(&row, fx, s, chainDebt[s.Account], chainMax[s.Account], c.pinOP, budgetSeconds)
			row.Note = dmMotionNote(fx)
		case verdictWeldUnread:
			row.Note = "read-presence is a first-class fact: " + strings.Join(reasons, "; ") +
				" — a boolean flip whose motion proof cannot be completed is GATED, never disclosed (chain-truth R1.5: cannot-verify is never advisory)"
		default:
			row.Note = dmBooleanDriftNote(fx, class, reasons)
		}
		rows = append(rows, row)
	}
	rows = append(rows, dmMotionCensusRow(motions, evaluableCount, budgetSeconds))
	return rows, nil
}

// dmMotionStat is one MOTION row's census contribution.
type dmMotionStat struct {
	direction  string
	margin     *big.Int
	ageBlocks  uint64
	ageSeconds int64
}

// dmMotionEvidence fills the evidence a MOTION row owes at the boolean's own
// granularity (chain-truth conjunct vi): the VERDICT TRIANGLE, margins at both
// clocks, the sweep age against its budget, the per-token motion ledger and
// the certificate references.
func dmMotionEvidence(row *p3Row, fx dmBooleanFacts, s dmSubject, chainDebt, chainMax *big.Int, pin uint64, budgetSeconds int64) {
	own, pv := fx.Own, fx.PinVec
	row.Evidence["verdict_triangle"] = fmt.Sprintf(
		"served(mixed-clock)=%v chain@pin=%v chain@S=%v — the mixed verdict may equal neither pure clock; all three printed",
		fx.Ours, fx.Chain, own.ChainLiqS)
	row.Evidence["margin_mixed_usd6"] = marginText(s.Margin)
	if chainDebt != nil && chainMax != nil {
		row.Evidence["margin_at_pin_usd6(chain, debt-maxBorrowLT)"] = new(big.Int).Sub(chainDebt, chainMax).String()
	}
	if own.DebtUSDAtS != nil && own.OurMax != nil {
		row.Evidence["margin_at_S_usd6(debt@S-maxBorrowLT@S)"] = new(big.Int).Sub(own.DebtUSDAtS, own.OurMax).String()
	}
	row.Evidence["sweep_block"] = fmt.Sprintf("%d", own.Block)
	row.Evidence["sweep_age_blocks"] = fmt.Sprintf("%d", pin-own.Block)
	row.Evidence["sweep_age_seconds"] = fmt.Sprintf("%d (budget %ds — inside; fleet freshness green is a run precondition)", own.AgeSeconds, budgetSeconds)
	row.Evidence["motion_ledger"] = strings.Join(pv.PerTokenDeltas, "; ")
	row.Evidence["motion_sum_usd6"] = fmt.Sprintf("%s == getMaxBorrowAmount@P − ourMax(mixed): the motion IS vector@P − vector@S, both endpoints chain-attested", pv.DeltaSum)
	row.Evidence["certificate"] = fmt.Sprintf(
		"maxBorrow leg sample-gap-disclosed with the vector certificate at S: collateralOf@%s byte-identical to the persisted document (%d leg(s)); S-clock boolean weld EXACT; pin-vector substitution scalar+boolean EXACT",
		own.Hash.Hex(), own.VectorLegs)
	row.Evidence["serving_disclosure"] = "the served surface structurally attaches the sweep watermark to every DM boolean: internal/risk requireWatermarks(Marks.SweepBlock) refuses a sweepless compute (internal/risk/dm.go:49-58); api/openapi.yaml carries AsOf.sweep_block and PositionSummary.sweep_block as REQUIRED contract fields"
}

// dmMotionNote renders a MOTION row's note, direction-tagged with the false
// negative LOUDER (the risk-hiding direction).
func dmMotionNote(fx dmBooleanFacts) string {
	base := "every conjunct of the motion proof holds: the sample-gap certificate (vector byte-identical at S + scalar law recompute), debt EXACT at pin, the S-clock boolean custody weld (ComputeDMHealth over ALL inputs at S == liquidatable@blockHash(S)), the Law@P pin-vector substitution (scalar AND boolean over the CHAIN's own pin vector bit-exact against getMaxBorrowAmount@P and liquidatable@P), and the sweep age inside the cadence budget. The flip is a theorem of two chain-attested endpoints; the product serves the (verdict, sweep watermark) PAIR and this row is that pair's honest disclosure at the pin. NO margin appears in any predicate — margins are evidence only, never an epsilon (both rulings)"
	if fx.Chain && !fx.Ours {
		return "BOUNDARY-CROSSING MOTION, FALSE NEGATIVE AT PIN — THE RISK-HIDING DIRECTION, disclosed loudly: the chain calls this account liquidatable at the pin and the served (sweep-clock) verdict does not, because collateral left the account inside the sweep->pin gap. A subsequent on-chain liquidation of this account lands in the realized-liquidation backtest frame (the historical half of the same direction, risk-quant R2) — cross-reference it there. " + base
	}
	return "BOUNDARY-CROSSING MOTION, false positive at pin, disclosed and not gated: collateral entered the account inside the sweep->pin gap, so the served (sweep-clock) verdict raises an alert the pin refuses. " + base
}

// dmBooleanDriftNote is the D-013 note fix (boolean-leg ruling, always-fix):
// the old note claimed "a boolean disagreement whose two inputs both weld
// exactly is a strict-inequality bug" UNCONDITIONALLY — false for the
// accept-r5 rows, whose maxBorrow legs were sample-gap. The note now branches
// on the ACTUAL quantity-leg verdicts and prints the strict-inequality
// diagnosis only in the one state where it is true.
func dmBooleanDriftNote(fx dmBooleanFacts, class string, reasons []string) string {
	direction := "FALSE POSITIVE direction: we would raise a liquidation alert the chain refuses."
	if fx.Chain && !fx.Ours {
		direction = "FALSE NEGATIVE direction — RISK-HIDING, the alert product's worst failure, gated at head: the chain says liquidatable and we do not. A subsequent on-chain liquidation of this account lands in the realized-liquidation backtest frame (the historical half of the same direction, risk-quant R2) — cross-reference it there."
	}
	if class == dmClassSClockCustodyDrift {
		return direction + " ESCALATE: " + strings.Join(reasons, "; ")
	}
	if fx.MaxBorrowLegVerdict == verdictExact && fx.DebtExactAtPin {
		return direction + " Both quantity legs weld EXACTLY at the pin, so this IS a strict-inequality bug in the composition law (a >= where > belongs, or an inverted comparison) — the one state where this diagnosis is true, which is why the note now branches on the actual leg verdicts (D-013: the accept-r5 artifact printed it over sample-gap legs, where it was false)"
	}
	legState := fmt.Sprintf("getMaxBorrowAmount leg verdict %q; borrowingOf leg exact=%v", fx.MaxBorrowLegVerdict, fx.DebtExactAtPin)
	return direction + " The quantity legs do NOT both weld exactly at the pin (" + legState + ") — the boolean disagreement localises to those inputs, and MOTION was not provable: " + strings.Join(reasons, "; ")
}

// dmMotionCensusRow is the STANDING boundary-crossing-motion census, emitted
// every run (a zero is a statement): count by direction, margin extremes, the
// worst sweep age, the evaluable denominator — and the POPULATION gate: a
// motion count exceeding ~1% of the evaluable universe gates as
// sweeper-health, because weather refuted by its own frequency is the sweep
// cadence collapsing (both rulings).
func dmMotionCensusRow(motions []dmMotionStat, evaluableCount int, budgetSeconds int64) p3Row {
	fp, fn := 0, 0
	var minMargin, maxMargin *big.Int
	maxAgeBlocks, maxAgeSeconds := uint64(0), int64(0)
	for _, m := range motions {
		if strings.Contains(m.direction, dmDirectionFalseNegative) {
			fn++
		} else {
			fp++
		}
		if m.margin != nil {
			if minMargin == nil || m.margin.Cmp(minMargin) < 0 {
				minMargin = m.margin
			}
			if maxMargin == nil || m.margin.Cmp(maxMargin) > 0 {
				maxMargin = m.margin
			}
		}
		if m.ageBlocks > maxAgeBlocks {
			maxAgeBlocks = m.ageBlocks
		}
		if m.ageSeconds > maxAgeSeconds {
			maxAgeSeconds = m.ageSeconds
		}
	}
	row := p3Row{
		Gate: gateDMBoolean, Subject: "cohort:boundary-crossing-motion", Leg: "standing-census",
		Expected: fmt.Sprintf("<= ~1%% of the evaluable universe (%d borrowers)", evaluableCount),
		Actual:   fmt.Sprintf("%d motion row(s): %d false-positive-at-pin, %d false-negative-at-pin", len(motions), fp, fn),
		Gated:    true,
		Evidence: map[string]string{
			"count_false_positive_at_pin": fmt.Sprintf("%d", fp),
			"count_false_negative_at_pin": fmt.Sprintf("%d", fn),
			"min_margin_usd6":             marginText(minMargin),
			"max_margin_usd6":             marginText(maxMargin),
			"max_sweep_age":               fmt.Sprintf("%d blocks / %d seconds (budget %ds)", maxAgeBlocks, maxAgeSeconds, budgetSeconds),
			"denominator":                 fmt.Sprintf("%d evaluable borrowers", evaluableCount),
		},
		Note: "the standing motion census: every MOTION row below it is INDIVIDUALLY proven (no count tolerance exists on the class), and this row is the population-level gate — a disclosed class whose frequency refutes the weather explanation is the sweep cadence collapsing, and that is a sweeper-health failure, not more weather",
	}
	if dmMotionPopulationGate(len(motions), evaluableCount) {
		row.Verdict = verdictDrift
		row.Class = "sweeper-health"
		return row
	}
	row.Verdict = verdictExact
	return row
}

// dmMaxBorrowRow renders one maxBorrow leg under the three-state law.
func dmMaxBorrowRow(c *p3Ctx, subject, acct string, pinChain, ours *big.Int, own *dmOwnClockResult) p3Row {
	verdict, class := classifyDMMaxBorrow(pinChain, ours, own)
	switch verdict {
	case verdictExact:
		return exactRow(gateDMBoolean, subject, "getMaxBorrowAmount(user,false)", pinChain.String(), ours.String())
	case verdictWeldUnread:
		why := "the pin values differ and the own-clock discrimination read did not answer"
		if own != nil && own.Err != "" {
			why += ": " + own.Err
		}
		return unreadRow(gateDMBoolean, subject, "getMaxBorrowAmount(user,false) own-clock read", why)
	}
	sweep := c.t6.DMSweepByAccount[acct].AtOrBelowPin
	delta := new(big.Int).Sub(ours, pinChain)
	ev := map[string]string{
		"delta_usd6(ours-chain@pin)": delta.String(),
		"sweep_block":                fmt.Sprintf("%d", sweep),
		"sweep_age_blocks":           fmt.Sprintf("%d", c.pinOP-sweep),
		"own_clock_hash":             own.Hash.Hex(),
	}
	if own.VectorRead {
		if own.VectorMatch {
			ev["own_clock_vector"] = fmt.Sprintf("match: collateralOf@S byte-identical to the persisted document (%d leg(s), order-insensitive, zero tolerance)", own.VectorLegs)
		} else {
			ev["own_clock_vector"] = "MISMATCH: " + own.VectorDiff
		}
	} else {
		ev["own_clock_vector"] = "not produced"
	}
	// The scalar legs can be absent when the vector proof already decided the
	// verdict (a refused own-clock price cannot un-prove a vector mismatch).
	if own.ChainMax != nil {
		ev["own_clock_chain_max"] = own.ChainMax.String()
	}
	if own.OurMax != nil {
		ev["own_clock_our_max"] = own.OurMax.String()
	}
	row := p3Row{
		Gate: gateDMBoolean, Subject: subject, Leg: "getMaxBorrowAmount(user,false)",
		Expected: pinChain.String(), Actual: ours.String(),
		Verdict: verdict, Gated: true, Class: class,
		Evidence: ev,
	}
	switch class {
	case verdictSampleGap:
		row.Note = "SAMPLE GAP, disclosed and not gated: the own-clock weld at the account's own sweep block S is BIT-EXACT ON THE VECTOR — collateralOf@blockHash(S) byte-identical to the persisted document, order-insensitive, zero tolerance (Codex round 2 finding 1: the scalar alone can be kept exact by canceling wrong rows) — AND on the scalar law check (recompute internal/risk/dm.go:102-134 against getMaxBorrowAmount, DebtManagerCore.sol:139-165). The pin delta is eventless basket motion inside the sweep->pin gap — the motion collateral_spot_reads labels report-only BY CONSTRUCTION. A verdict class with its own read, never a fourth tolerance (chain-truth ruling 08:55; risk-quant refused any epsilon over this population as tolerance-as-carpet)"
	case "own-clock-law-divergence":
		row.Note = "OWN-CLOCK LAW DIVERGENCE, gated: the persisted vector IS byte-identical to collateralOf at the account's own sweep block (custody exonerated by the vector proof), but the scalar recompute over that proven-identical vector disagrees with getMaxBorrowAmount@S — the divergence is in the recompute law itself (internal/risk/dm.go:102-134 vs DebtManagerCore.sol:139-165), the arm pin-vector substitution found empty 5/5 in the dissection"
	default:
		row.Note = "SNAPSHOT CUSTODY DRIFT, gated: the persisted collateral VECTOR disagrees with collateralOf(user) at the account's OWN sweep block — byte-compare, order-insensitive, zero tolerance. This is the arm the dissection found empty (own-clock vector byte-identical 5/5) — a row here is a real sweeper-custody defect, not a clock artifact, and it flips the accept-r4 classification. The vector proof decides regardless of the scalar: two wrong rows whose price×LT products cancel at S keep the scalar exact and are exactly what this comparison exists to catch (Codex round 2, finding 1)"
	}
	return row
}

// dmOwnClockControlRow is the always-on control's own row: proof BOTH
// discrimination reads — the collateralOf vector proof and the
// getMaxBorrowAmount scalar check — are live against this archive even on an
// all-exact run.
func dmOwnClockControlRow(subject, reason string, own *dmOwnClockResult) p3Row {
	if own == nil || own.Err != "" || !own.VectorRead {
		why := "the control's own-clock weld did not answer"
		if own != nil && own.Err != "" {
			why += ": " + own.Err
		} else if own != nil && !own.VectorRead {
			why += ": the collateralOf vector proof was not produced"
		}
		return unreadRow(gateDMBoolean, subject, "own-clock-control", why)
	}
	if !own.VectorMatch {
		return driftRow(gateDMBoolean, subject, "own-clock-control",
			"collateralOf@S byte-identical to the persisted document", own.VectorDiff, "snapshot-custody-drift",
			"the CONTROL account's own-clock VECTOR proof failed: the persisted document disagrees with collateralOf at its own sweep block — real custody drift on the account chosen precisely because it was expected clean (Codex round 2, finding 1: the vector is the custody proof)")
	}
	if own.ChainMax.Cmp(own.OurMax) == 0 {
		row := exactRow(gateDMBoolean, subject, "own-clock-control",
			own.ChainMax.String(), own.OurMax.String())
		row.Note = "the ALWAYS-ON own-clock control (" + reason + "): collateralOf at blockHash(S) byte-identical to the persisted document (" + fmt.Sprintf("%d leg(s)", own.VectorLegs) + ", the custody proof) AND getMaxBorrowAmount at the same hash welds bit-exact against our recompute over it, proving both discrimination reads live and the archive serving S-clock state this run"
		row.Evidence = map[string]string{
			"own_clock_block":  fmt.Sprintf("%d", own.Block),
			"own_clock_hash":   own.Hash.Hex(),
			"own_clock_vector": fmt.Sprintf("match (%d persisted leg(s))", own.VectorLegs),
		}
		return row
	}
	return driftRow(gateDMBoolean, subject, "own-clock-control",
		own.ChainMax.String(), own.OurMax.String(), "own-clock-law-divergence",
		"the CONTROL account's scalar law check failed over a vector the custody proof holds byte-identical: the recompute law itself diverges from getMaxBorrowAmount at S — a law defect surfaced by the account chosen precisely because it was expected clean")
}

func marginText(m *big.Int) string {
	if m == nil {
		return "(unavailable)"
	}
	return m.String()
}

// symbolAddress resolves a registry symbol to its address for one engine. It
// returns the zero address when the symbol is absent, and callers turn that
// into a cohort-floor miss rather than substituting a hardcoded address.
func (v *registryView) symbolAddress(engine, symbol string) common.Address {
	set := v.Aave
	if engine == dmEngine {
		set = v.DM
	}
	addrs := make([]common.Address, 0, len(set))
	for a := range set {
		addrs = append(addrs, a)
	}
	addrs = sortAddrSlice(addrs)
	for _, a := range addrs {
		if set[a].Symbol == symbol {
			return a
		}
	}
	return common.Address{}
}
