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
// BOOLEAN leg (liquidatable, strict >) stays gated at the pin: it is the served
// product and it welded 46/46 through the same gap.
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
)

// dmGateFrame declares the gate's exhaustive input frame.
func dmGateFrame() *gateFrame {
	return newGateFrame(gateDMBoolean,
		derived("position_balances(source=event, engine=debt_manager, side=debt).amount@P_op",
			"the NORMALIZED debt our DB fold produced — the thing under test on the debt side"),
		derived(dmCollateralSnapshotSource,
			"the swept collateral amounts (the CashLens collateralOf multicall, which nets pending withdrawals) our sweeper persisted — the thing under test on the collateral side. Declared at S(account) because that IS their clock: the sweeper executes at its own block and ApplySweepBatch replaces the legs wholesale. Declaring these @P_op was accept-r4's FALSE declaration (chain-truth ruling 08:55): it hid that the maxBorrow leg welds a sample-clock input against pin-clock chain state, which is why that leg carries the three-state verdict law (classifyDMMaxBorrow) instead of a single-clock compareExact"),
		derived("dm_param_history (position_events collateral_token_config_set) ledger prefix <= P_op, folded by riskfeed.FoldParams",
			"the liquidation thresholds our DM event custody produced, HUNDRED_PERCENT-denominated, folded by the SAME function riskd folds with. The own-clock discrimination weld re-cuts the SAME ledger at <= S(account), so both clocks fold one custody chain"),
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
	sweepRows, excluded := classifySweepTestimony(c, t6, debtUSDByAccount)
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
	weldRows, err := weldDMCohort(ctx, c, f, cohort, healthByAccount, st, collByAccount, debtUSDByAccount)
	rows = append(rows, weldRows...)
	if err != nil {
		return rows, err
	}

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
func classifySweepTestimony(c *p3Ctx, t6 *snapshotdb.Task6Data, borrowers map[string]*big.Int) ([]p3Row, map[string]bool) {
	var rows []p3Row
	excluded := map[string]bool{}
	accounts := make([]string, 0, len(borrowers))
	for a := range borrowers {
		accounts = append(accounts, a)
	}
	sort.Strings(accounts)

	abovePin, never, invariantBreaks := 0, 0, 0
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
			never++
			excluded[acct] = true
			rows = append(rows, p3Row{
				Gate: gateDMBoolean, Subject: "0x" + acct, Leg: "collateral-testimony-at-pin",
				Expected: "at least one successful collateral sweep at any height",
				Actual:   "no successful sweep has ever completed for this account",
				Verdict:  verdictUnscannable, Gated: true, Class: sweepNever,
				Note:     "GATED, unlike sweep-above-pin: a borrower the sweeper has NEVER successfully read is a persistent hole rather than a clock difference, and the served surface would refuse it too (the 0xe957...bf20 posture). Re-pinning cannot fix it",
				Evidence: map[string]string{"last_attempt_status": st.Status},
			})
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
	rows = append(rows, p3Row{
		Gate: gateDMBoolean, Subject: "cohort:collateral-testimony", Leg: "evaluable-universe",
		Expected: fmt.Sprintf("%d derived borrowers", len(accounts)),
		Actual:   fmt.Sprintf("%d evaluable, %d excluded sweep-above-pin (not gated), %d excluded never-swept (gated)", len(accounts)-abovePin-never, abovePin, never),
		Verdict:  verdictExact, Gated: true,
		Note: "the evaluable universe every cohort floor below is judged against. The sweep-above-pin exclusions are a duty-cycle property of pinning below the sweeper's head (~2% of accounts at a ~34% duty cycle when this was measured); they are disclosed rather than gated, and the per-account invariant above proves each one discarded nothing the pin could see",
	})
	if invariantBreaks > 0 {
		rows[len(rows)-1].Verdict = verdictDrift
		rows[len(rows)-1].Class = "exclusion-discards-evidence"
	}
	return rows, excluded
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
		readNote := map[common.Address]string{}
		vectorNote := map[common.Address]string{}
		for i, tg := range tags {
			if !res[i].Success {
				switch tg.kind {
				case "max":
					readNote[tg.acct] = "getMaxBorrowAmount reverted at S"
				case "vector":
					vectorNote[tg.acct] = "collateralOf reverted at S"
				}
				// A reverted price at S surfaces as a per-account refusal below.
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
			case "price":
				v, err := unpackUint256Strict(dmConvertCollateralToUsdABI, "convertCollateralTokenToUsd", res[i].ReturnData)
				if err != nil {
					continue
				}
				priceAt[tg.tok] = v
				f.use(dmOwnClockPriceSource)
			}
		}

		// The param ledger re-cut at S: the SAME custody chain, the SAME fold.
		var ledgerAtS []store.ParamRow
		for _, r := range c.t6.DMParams {
			if r.EffectiveBlock <= s {
				ledgerAtS = append(ledgerAtS, r)
			}
		}
		foldedAtS, err := riskfeed.FoldParams(dmEngine, 10, ledgerAtS)
		if err != nil {
			fail("fold dm param ledger at S: " + err.Error())
			continue
		}

		for _, p := range group {
			r := &dmOwnClockResult{Block: s, Hash: hash}
			out[p.key] = r
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
			in := risk.DMInput{
				Account: p.acct,
				DebtUSD: orZeroBig(debtUSD[p.key]),
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
		}
	}
	return out
}

// weldDMCohort welds the boolean, the threshold-weighted collateral and the
// live debt total against the chain, per cohort member. The maxBorrow leg is
// judged by the three-state law (classifyDMMaxBorrow); the boolean and debt
// legs stay single-clock pin welds.
func weldDMCohort(ctx context.Context, c *p3Ctx, f *gateFrame, cohort []dmSubject, health map[string]risk.DMHealth,
	st dmTokenState, coll map[string][]snapshotdb.T6Leg, debtUSD map[string]*big.Int) ([]p3Row, error) {
	var rows []p3Row
	if len(cohort) == 0 {
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

	for _, s := range cohort {
		subject := s.Account.Hex()
		acct := hex.EncodeToString(s.Account.Bytes())
		if note, bad := unread[s.Account]; bad {
			rows = append(rows, unreadRow(gateDMBoolean, subject, "boolean-weld", note))
			continue
		}
		h := health[acct]
		if cm := chainMax[s.Account]; cm != nil && h.MaxBorrowLT != nil {
			rows = append(rows, dmMaxBorrowRow(c, subject, acct, cm, h.MaxBorrowLT, ownResults[acct]))
		}
		if acct == controlKey {
			rows = append(rows, dmOwnClockControlRow(subject, probeReason[acct], ownResults[acct]))
		}
		if cd := chainDebt[s.Account]; cd != nil && h.Borrowings != nil {
			rows = append(rows, compareExact(gateDMBoolean, subject, "borrowingOf(user).total",
				cd, h.Borrowings, "index-replayed-debt"))
		}
		ours, chain := h.Liquidatable, chainBool[s.Account]
		row := p3Row{
			Gate: gateDMBoolean, Subject: subject, Leg: "liquidatable(strict >)",
			Expected: fmt.Sprintf("%v", chain), Actual: fmt.Sprintf("%v", ours), Gated: true,
			Evidence: map[string]string{
				"cohort_reasons": fmt.Sprint(s.Reasons),
				"margin_usd6":    marginText(s.Margin),
			},
		}
		if ours == chain {
			row.Verdict = verdictExact
		} else {
			row.Verdict = verdictDrift
			row.Class = "boolean-direction"
			if ours && !chain {
				row.Note = "FALSE POSITIVE direction: we would raise a liquidation alert the chain refuses. Localise with the getMaxBorrowAmount and borrowingOf legs above — a boolean disagreement whose two inputs both weld exactly is a strict-inequality bug, not an input problem"
			} else {
				row.Note = "FALSE NEGATIVE direction: the chain says liquidatable and we do not. This is the alert product's worst failure and is gated at head; the realized-liquidation backtest is the historical half of the same direction (neither substitutes for the other, risk-quant R2)"
			}
		}
		rows = append(rows, row)
	}
	return rows, nil
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
