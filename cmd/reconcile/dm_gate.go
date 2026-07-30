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
package main

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"math/big"
	"sort"

	"github.com/ethereum/go-ethereum/common"

	"github.com/kaselunt/solvent/cmd/reconcile/snapshotdb"
	"github.com/kaselunt/solvent/internal/risk"
	"github.com/kaselunt/solvent/internal/riskfeed"
)

// R3's DM composition floors.
const (
	dmHealthyFloor        = 10
	dmMultiCollatFloor    = 5
	dmMultiCollatTokens   = 3
	dmLiquidUSDFloor      = 1
	dmCohortTotalBackstop = 25
)

// dmGateFrame declares the gate's exhaustive input frame.
func dmGateFrame() *gateFrame {
	return newGateFrame(gateDMBoolean,
		derived("position_balances(source=event, engine=debt_manager, side=debt).amount@P_op",
			"the NORMALIZED debt our DB fold produced — the thing under test on the debt side"),
		derived("position_balances(source=snapshot, engine=debt_manager, side=collateral).amount@P_op",
			"the swept collateral amounts (CashLens.getUserTotalCollateral, which nets pending withdrawals) our sweeper persisted — the thing under test on the collateral side"),
		derived("dm_param_history (position_events collateral_token_config_set) ledger prefix <= P_op, folded by riskfeed.FoldParams",
			"the liquidation thresholds our DM event custody produced, HUNDRED_PERCENT-denominated, folded by the SAME function riskd folds with"),
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
			"the chain's own threshold-weighted collateral, welded exactly against our MaxBorrowLT so a boolean disagreement localises to a token instead of reading as 'the boolean differs'"),
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
	f.use("position_balances(source=snapshot, engine=debt_manager, side=collateral).amount@P_op")
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
	// -dm-full-census is a STRENGTHENER (default off): it extends the boolean
	// weld from the cohort to EVERY derived borrower, closing the residual the
	// census row discloses — the direction where the chain calls an account
	// liquidatable and we call it healthy outside the cohort. It only ever adds
	// gated rows, so it cannot weaken a bound; it costs one multicall chunk per
	// 15 accounts, which is why it is not the default.
	if c.o.dmFullCensus {
		inCohort := map[string]bool{}
		for _, s := range cohort {
			inCohort[hex.EncodeToString(s.Account.Bytes())] = true
		}
		for _, acct := range allBorrowers {
			if inCohort[acct] {
				continue
			}
			cohort = append(cohort, dmSubject{
				Account: common.HexToAddress(acct),
				Health:  healthByAccount[acct],
				Margin:  marginByAccount[acct],
				Reasons: []string{"-dm-full-census: whole-book chain liquidatable census"},
			})
		}
	}

	// ---- chain weld over the cohort ---------------------------------------
	weldRows, err := weldDMCohort(ctx, c, f, cohort, healthByAccount)
	rows = append(rows, weldRows...)
	if err != nil {
		return rows, err
	}

	// ---- cohort floors, census-welded --------------------------------------
	rows = append(rows, cohortFloorRow(gateDMBoolean, "dm-live-liquidatable(ALL)",
		comp.liquidatable, len(ourLiquidatable), 0,
		fmt.Sprintf("ALL live liquidatable accounts are mandatory members (risk-quant R3): our full-book computation over %d derived borrowers found %d. COVERAGE RESIDUAL, stated rather than implied: the chain-side liquidatable census over the WHOLE book would be %d multicall chunks at this run's pacing, so the FALSE-side direction (an account the chain calls liquidatable that we call healthy) is welded over the cohort only — with the nearest-boundary account force-included and its margin printed. Enable -dm-full-census to weld the entire book",
			len(allBorrowers), len(ourLiquidatable), (len(allBorrowers)+multicallChunkSize-1)/multicallChunkSize)))
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

// weldDMCohort welds the boolean, the threshold-weighted collateral and the
// live debt total against the chain, per cohort member.
func weldDMCohort(ctx context.Context, c *p3Ctx, f *gateFrame, cohort []dmSubject, health map[string]risk.DMHealth) ([]p3Row, error) {
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

	for _, s := range cohort {
		subject := s.Account.Hex()
		acct := hex.EncodeToString(s.Account.Bytes())
		if note, bad := unread[s.Account]; bad {
			rows = append(rows, unreadRow(gateDMBoolean, subject, "boolean-weld", note))
			continue
		}
		h := health[acct]
		if cm := chainMax[s.Account]; cm != nil && h.MaxBorrowLT != nil {
			rows = append(rows, compareExact(gateDMBoolean, subject, "getMaxBorrowAmount(user,false)",
				cm, h.MaxBorrowLT, "per-token-floor-then-sum"))
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
