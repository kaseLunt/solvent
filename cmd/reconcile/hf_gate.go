// The Aave HF gate — EXACT, zero units (risk-quant R1).
//
// R1's whole argument in one line: `getUserAccountData@pin` and our recompute
// run the SAME integer law (rev-3: the wadDiv half-up composite over ceil-summed
// debt, source-proven in p3-consults/risk-quant-component4-7-ruling.md — the
// original P-2 fused floor was an undetectably-close approximation this gate's
// own live smoke refuted), so they can only diverge if the INPUTS differ. There is therefore no legitimate bounded-divergence class here, and
// every candidate one R1 names is an input-frame inconsistency rather than
// rounding:
//
//   - index freshness — our rate_indexes row is the last ReserveDataUpdated
//     and at this pin trails it by ~300k blocks, so consuming it would inherit
//     index lag that no rounding argument bounds. The indexes are PINNED READS.
//   - prices — adapter-output rows are 60-second samples at their own anchors
//     (D-012); gating them against a pin at a different block launders
//     sample-gap uncertainty through integer arithmetic. The gate prices are
//     PINNED getAssetPrice reads, and the stored rows are welded SEPARATELY at
//     their own anchor hashes (adapterOutputWeld, param_weld.go).
//   - eMode and regime — pinned and stamped.
//
// What is therefore under test, exhaustively: the scaled balances our DB fold
// produced, and the param ledger our configurator custody produced. Everything
// else is declared pinned. With that frame, healthFactor,
// totalCollateralBase and totalDebtBase weld BIT-EXACT.
//
// Collateral flags reach this gate through TWO doors, deliberately distinct:
// the HF weld's flags are a PINNED getUserConfiguration read (chain-truth
// R5.5), while the ZERO-DEBT CENSUS's derived side folds the flag from the
// CUSTODIED aave_collateral_enabled/disabled events (store.CollateralFlagsAsOf;
// never-enabled defaults OFF under genesis-complete custody).
//
// CENSUS ONE-LAW CORRECTION (accept-r4, 2026-07-31, 24 zero-debt census
// failures). The derived census predicate was FLAG-BLIND (any positive scaled
// collateral leg) while the chain's is flag-gated and value-projected
// (getUserAccountData.totalCollateralBase sums only flag-ON reserves and floors
// dust to zero in base units) — two predicates asserted as one census. The
// dissection proved both directions clean at the data level: chain scaled ==
// derived scaled EXACT on both exemplars, getUserConfiguration == 0x0, one
// subject NEVER-enabled (USDC does not auto-enable on this market), one
// EXPLICITLY disabled with the aave_collateral_disabled event IN CUSTODY at
// block 22,551,863. The fix folds the derived membership under the CHAIN'S OWN
// law: scaled balance > 0 AND using-as-collateral ON (from the custodied event
// fold) AND the flag-gated value projection > 0 (the same ComputeAaveHealth
// output that welds totalCollateralBase bit-exact). This predicate choice is
// the ADJUDICATED law (chain-truth ruling, ledger 08:55) — recorded here so it
// reads as what it is, not as an assimilation-to-green: the alternative
// (keeping the flag-blind predicate) asserts a census the chain provably does
// not have. The residual the flag gate would otherwise open — a flag that is
// OFF masking a WRONG balance, invisible to the Σ weld because transfers move
// no total — is closed by the per-account scaledBalanceOf@pin weld over every
// census-disagreeing and flag-masked candidate, bit-exact, zero tolerance.
//
// PER-(ACCOUNT, RESERVE) SELECTION CORRECTION (Codex round 2 on the proof
// surface, finding 2, 2026-07-31). Wave H's committed weld selected
// candidates by MEMBERSHIP FLIP (RawZeroDebt != oneLawZero) plus census
// disagreement — WEAKER than the residual it claimed to close. A borrower
// with debt has both memberships false; a zero-debt account with one enabled
// and one disabled reserve is true in both; in either shape a WRONG derived
// balance in a flag-OFF reserve is ignored by the pinned HF computation,
// never enters the weld set, and acceptance passes over wrong stored
// collateral. The masking condition is per (account, reserve), not per
// account — so the selection now is too (selectMaskedBalancePairs): EVERY
// positive derived scaled-collateral balance whose folded flag is OFF at the
// pin joins the scaledBalanceOf@pinHash weld, and so does every pair the
// PINNED bitmap masks (folded ON, pinned OFF — the same invisibility through
// the other flag door, on borrowers where no census row would ever surface
// the disagreement). Bit-exact, zero tolerance; the batch is finite (positive
// derived balances with a masked flag at the pin) and its size is disclosed
// on the selection row.
package main

import (
	"context"
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

// maxUint256 is `type(uint256).max` — what the Pool returns for
// healthFactor when an account carries NO debt. It is NEVER compared as a
// magnitude against our own numbers: risk-quant R1 requires the marker↔max
// mapping to be explicit, because treating it as a very large health factor is
// how "infinitely healthy" becomes "healthiest account on the book" in a sort.
var maxUint256 = func() *big.Int {
	v := new(big.Int).Lsh(big.NewInt(1), 256)
	return v.Sub(v, big.NewInt(1))
}()

// aaveZeroDebtFloor / aaveNeverSeenFloor / aaveFiniteBackstop are risk-quant
// R3's cohort floors for this gate. The FINITE cohort is population-derived
// (ALL finite-HF borrowers, census-welded); 10 is the hard backstop the chain
// actually supports — the plan's original ≥20 was refuted by the book's 12
// borrowers and would have forced either a guaranteed failure or a silently
// padded cohort.
const (
	aaveZeroDebtFloor  = 10
	aaveNeverSeenFloor = 10
	aaveFiniteBackstop = 10
)

// neverSeenSubjects are the COMMITTED empty-set probe subjects. They are
// derived, once, as the first 20 bytes of
// sha256("solvent-p3-task6-neverseen-v1|" + i) for i = 0..11, and
// TestNeverSeenSubjectsAreDerivedFromTheCommittedSeed re-derives them: the
// cohort is reproducible from the repository alone, which a run-time draw over
// "addresses we have not seen" could never be (risk-quant R2's freeze rule).
// Twelve are committed so the ≥10 floor survives two subjects turning out to be
// real addresses later — a subject that IS in custody is a GATED failure, not a
// quiet substitution.
var neverSeenSubjects = []string{
	"0x90fe7f8bd4170a40c39ca040f52b0b9bc573adcf",
	"0xd4b52ee7c7b10a87511ce4973e154b259897dc3a",
	"0x437a76a38dd0dc67bbd485ea31e3e1ed6653f969",
	"0x9cdd829a0459d772d4f8d63efe737a56f2a4779e",
	"0x2381721ea9fe853aa67480814e34961eb695d0f8",
	"0xf919ebaf5ef2452db7ceb861c92c88c4796b8e4c",
	"0xc126c44fb84b3d2e8fb1ce88fc0596f9800d9ae2",
	"0x4c33ed6aa8dee5bd7f57dc2dd7e1cf32ebf634e3",
	"0xcb675a14415c032f56bcef533971181ad0697df3",
	"0x08faf0e671d53f6a7c33dd6ca541d1fb4d66f64e",
	"0xfc5a14e05397c24bdfef571c3108c7bc01b2d7cd",
	"0xf9238663cc0b2acbbd7b6ae3f11b8b642e0840ba",
}

// neverSeenSeed is the committed derivation seed, printed in the report.
const neverSeenSeed = "solvent-p3-task6-neverseen-v1"

// Frame-source names shared between the declaration and every f.use, so the
// declaration and the consumption cannot drift apart (accept-r4's aave_hf frame
// violation was exactly that drift: the committed never-seen list was declared
// and consumed, but the consumption never recorded itself).
const (
	aaveNeverSeenListSource = "never-seen subject list (sha256 of " + neverSeenSeed + "|i, first 20 bytes)"
	aaveFlagLedgerSource    = "position_events(engine=aave_v3_etherfi) collateral-flag ledger (aave_collateral_enabled/aave_collateral_disabled), latest-wins fold <= P_eth"
	aaveReserveATokenSource = "Pool.getReserveAToken(asset)@pinHash(P_eth)"
	aaveScaledBalanceSource = "AToken.scaledBalanceOf(user)@pinHash(P_eth) for census-disagreeing, flag-masked and per-(account,reserve) masked-balance candidates plus a nonzero control"
)

// neverSeenBytes returns the subjects as raw bytes for Stage A.
func neverSeenBytes() [][]byte {
	out := make([][]byte, 0, len(neverSeenSubjects))
	for _, s := range neverSeenSubjects {
		out = append(out, common.HexToAddress(s).Bytes())
	}
	return out
}

// aaveGateFrame declares the gate's exhaustive input frame.
func aaveGateFrame() *gateFrame {
	return newGateFrame(gateAaveHF,
		derived("position_balances(source=event, engine=aave_v3_etherfi, side=debt).amount@P_eth",
			"the scaled variable-debt balance our DB fold produced — component 1, the thing under test"),
		derived("position_balances(source=event, engine=aave_v3_etherfi, side=collateral).amount@P_eth",
			"the scaled aToken balance our DB fold produced — component 1, the thing under test"),
		derived("param_history(engine=aave_param, chain=1) ledger prefix <= P_eth, folded by riskfeed.FoldParams",
			"the liquidation thresholds our PoolConfigurator custody produced, folded by the SAME function riskd folds with (one implementation of 'what is the effective parameter set')"),
		derived("raw_logs candidate universe (walked Aave addresses, user slots topics[3]/topics[4], <= P_eth)",
			"the INDEPENDENT census side: every account custody has ever seen as an Aave user, taken from raw events rather than from the fold under test. Codex round 1 finding 3 - a census computed from position_balances compared the cohort to itself, so an account the fold dropped vanished from BOTH sides at once"),
		derived(aaveFlagLedgerSource,
			"the DERIVED collateral flag, folded latest-wins from the custodied Pool event pair (never-enabled = OFF, a chain fact under genesis-complete custody, store/collateralflags.go). It is the zero-debt census's flag source under the ONE law (chain-truth ruling, ledger 08:55): the chain's census is flag-gated and value-projected, so a flag-blind derived predicate asserts a census the chain does not have"),
		derived("position_events+position_balances absence for the never-seen subjects",
			"the DB half of the phantom-debt probe: risk-quant R3 requires BOTH sides clean"),
		derived("raw_logs absence for the never-seen subjects (chain 1, wide predicate: address, any topic's low 20 bytes, anywhere in data)",
			"the custody half of the phantom-debt probe"),
		pinned("Pool.getReservesList()@pinHash(P_eth)",
			"the CHAIN's own reserve universe and, critically, the reserve INDEX order the UserConfiguration bitmap is addressed by"),
		pinned("Pool.getConfiguration(asset)@pinHash(P_eth)",
			"the reserve's own decimals (bits 48-55) and its chain-side thresholds — the param weld's expected side"),
		pinned("Pool.getReserveNormalizedIncome(asset)@pinHash(P_eth)",
			"the collateral index: pinned by law, because our rate_indexes row is the last ReserveDataUpdated and trails the pin (risk-quant R1)"),
		pinned("Pool.getReserveNormalizedVariableDebt(asset)@pinHash(P_eth)",
			"the debt index: pinned for the same reason"),
		pinned("AaveOracle.getAssetPrice(asset)@pinHash(P_eth)",
			"the gate price: pinned, because a stored 60-second adapter sample judged against a pin at another block launders sample-gap uncertainty through integer arithmetic (risk-quant R1)"),
		pinned("Pool.getUserConfiguration(user)@pinHash(P_eth)",
			"the HF weld's collateral flags (chain-truth R5.5). The event-derived flag fold HAS landed and is consumed beside it — by the census predicate, as its derived side — so a flag disagreement between the two doors surfaces as a census difference with a scaledBalanceOf weld beside it, never as a silent substitution"),
		pinned(aaveReserveATokenSource,
			"the aToken behind each reserve, resolved AT THE PIN through the Pool's own accessor (v3.2+ IPool) — never from the registry and never from the param ledger under test, because the balance-census weld's read target must not come from the custody it is checking"),
		pinned(aaveScaledBalanceSource,
			"the BALANCE-CENSUS weld (chain-truth ruling, ledger 08:55; per-(account,reserve) selection per Codex round 2 finding 2): the raw scaled balance per census-disagreeing / flag-masked account PLUS every (account, reserve) pair whose positive derived balance is masked at the pin (folded flag OFF, or pinned bitmap OFF), bit-exact zero tolerance. Membership flips are NOT the masking condition — a borrower with a wrong flag-OFF balance flips nothing — so selection operates on the pairs themselves. It closes the flag-off masking residual the one-law census opens — the Σ weld has zero power against transfers — and converts aggregate-only evidence into per-account proof. A nonzero control keeps the read provably live on an all-agreeing run"),
		pinned("Pool.getUserEMode(user)@pinHash(P_eth)",
			"asserted == 0 per cohort account and GATED: a nonzero category means the whole HF branch is the wrong law, which is a failure, not a skip"),
		pinned("Pool.getUserAccountData(user)@pinHash(P_eth)",
			"the CHAIN side of the weld — the expected side of every leg"),
		committed("recon/feeds.json aaveoracle priceDecimals",
			"the base-currency scale (8) the price inputs are tagged with. It is a CLAIM, and the weld is what tests it: a wrong scale cannot produce an exact totalCollateralBase"),
		committed("recon/feeds.json asset decimals (Aave reserves)",
			"welded against Pool.getConfiguration's decimals bits — a wrong 10^dec denominator is a 10^n price error, not a rounding difference (risk-quant R4.5)"),
		committed(aaveNeverSeenListSource,
			"the empty-set probe cohort, reproducible from the repository alone"),
	)
}

// aaveCohort is the gate's membership, built from the derived census.
type aaveCohort struct {
	Finite    []common.Address
	ZeroDebt  []common.Address
	NeverSeen []common.Address
	// Candidates is the INDEPENDENT universe every account-level read is issued
	// for: custody's own raw-event user set, unioned with the derived census so
	// both directions of a disagreement are measured (Codex round 1, finding 3).
	Candidates []common.Address
	// DerivedFinite / DerivedZeroDebt are the FOLD's classification, kept separate
	// from the chain's so the two can actually disagree. DerivedZeroDebt is
	// filled RAW (flag-blind: any positive collateral leg) by buildAaveCohort and
	// REPLACED by the gate with the one-law membership (flag-gated,
	// value-projected — the chain's own census law) once the pinned reserve
	// state needed for the value projection is in hand; RawZeroDebt keeps the
	// flag-blind set so the masked difference stays observable.
	DerivedFinite   map[common.Address]bool
	DerivedZeroDebt map[common.Address]bool
	RawZeroDebt     map[common.Address]bool
	// Control is a known-NONZERO subject included in every all-zero multicall
	// chunk (chain-truth R1.4): a chunk of all zeros with no nonzero control is
	// testimony indistinguishable from a lying default.
	Control      common.Address
	HasControl   bool
	CensusFinite int
	CensusZero   int
}

// buildAaveCohort assembles the MEASURED cohort from the INDEPENDENT candidate
// universe, not from the derived fold.
//
// Membership is every candidate custody has ever seen as an Aave user, so an
// account the fold dropped is still measured at the pin — which is what lets the
// census weld below notice the omission. The committed never-seen list is added
// unchanged.
func buildAaveCohort(t6 *snapshotdb.Task6Data) aaveCohort {
	c := aaveCohort{CensusFinite: len(t6.AaveBorrowerCensus), CensusZero: len(t6.AaveZeroDebtCensus)}
	seen := map[common.Address]bool{}
	for _, a := range t6.AaveCandidates {
		addr := common.HexToAddress(a)
		if seen[addr] {
			continue
		}
		seen[addr] = true
		c.Candidates = append(c.Candidates, addr)
	}
	// The derived census members join the candidate set too: an account the fold
	// believes in but raw custody never named is the OTHER direction of the same
	// disagreement, and it must be measured rather than dropped.
	for _, a := range append(append([]string{}, t6.AaveBorrowerCensus...), t6.AaveZeroDebtCensus...) {
		addr := common.HexToAddress(a)
		if !seen[addr] {
			seen[addr] = true
			c.Candidates = append(c.Candidates, addr)
		}
	}
	c.DerivedFinite = map[common.Address]bool{}
	for _, a := range t6.AaveBorrowerCensus {
		c.DerivedFinite[common.HexToAddress(a)] = true
		c.Finite = append(c.Finite, common.HexToAddress(a))
	}
	c.DerivedZeroDebt = map[common.Address]bool{}
	c.RawZeroDebt = map[common.Address]bool{}
	for _, a := range t6.AaveZeroDebtCensus {
		c.DerivedZeroDebt[common.HexToAddress(a)] = true
		c.RawZeroDebt[common.HexToAddress(a)] = true
		c.ZeroDebt = append(c.ZeroDebt, common.HexToAddress(a))
	}
	for _, s := range neverSeenSubjects {
		c.NeverSeen = append(c.NeverSeen, common.HexToAddress(s))
	}
	if len(c.Finite) > 0 {
		c.Control, c.HasControl = c.Finite[0], true
	}
	return c
}

// censusWeldRows welds the DERIVED census against the PINNED chain classification
// of every independent candidate, both directions.
//
// chainHasDebt / chainHasCollateral come from getUserAccountData at the pin — the
// chain's own answer, not ours. A candidate the chain calls a borrower that our
// fold does not is a DROPPED BORROWER, and it is exactly the account the old
// self-derived census could never see.
func censusWeldRows(c aaveCohort, chainDebt, chainColl map[common.Address]bool,
	measured map[common.Address]bool) []p3Row {
	var rows []p3Row
	onlyChainBorrower, onlyDerivedBorrower, agreeBorrower := 0, 0, 0
	onlyChainZero, onlyDerivedZero := 0, 0
	for _, a := range c.Candidates {
		if !measured[a] {
			// Unmeasurable candidates are already reported as account-state
			// weld-unread rows by the caller; classifying them here would invent an
			// answer for a read that did not happen.
			continue
		}
		chainBorrower := chainDebt[a]
		ourBorrower := c.DerivedFinite[a]
		switch {
		case chainBorrower && !ourBorrower:
			onlyChainBorrower++
			rows = append(rows, p3Row{
				Gate: gateAaveHF, Subject: a.Hex(), Leg: "census(borrower): chain vs derived",
				Expected: "borrower (nonzero totalDebtBase at the pin)",
				Actual:   "NOT in the derived finite-HF census",
				Verdict:  verdictDrift, Gated: true, Class: "dropped-borrower",
				Note: "the chain carries debt for a candidate our derived fold does not count as a borrower. This is the account the old self-derived census could never see, because it was absent from BOTH sides at once (Codex round 1, finding 3): the cohort was built from position_balances and then compared to position_balances",
			})
		case ourBorrower && !chainBorrower:
			onlyDerivedBorrower++
			rows = append(rows, p3Row{
				Gate: gateAaveHF, Subject: a.Hex(), Leg: "census(borrower): chain vs derived",
				Expected: "no debt at the pin",
				Actual:   "counted as a finite-HF borrower by the derived fold",
				Verdict:  verdictDrift, Gated: true, Class: "phantom-borrower",
				Note: "our fold believes this account carries debt and the chain does not — phantom debt, the direction that inflates the served book",
			})
		case chainBorrower && ourBorrower:
			agreeBorrower++
		}
		// The zero-debt census: positive collateral, no debt.
		chainZero := chainColl[a] && !chainDebt[a]
		ourZero := c.DerivedZeroDebt[a]
		if chainZero != ourZero {
			if chainZero {
				onlyChainZero++
			} else {
				onlyDerivedZero++
			}
			rows = append(rows, p3Row{
				Gate: gateAaveHF, Subject: a.Hex(), Leg: "census(zero-debt): chain vs derived",
				Expected: fmt.Sprintf("zero-debt collateral holder = %v (chain)", chainZero),
				Actual:   fmt.Sprintf("%v (derived)", ourZero),
				Verdict:  verdictDrift, Gated: true, Class: "zero-debt-census-difference",
				Note: "the zero-debt cohort is the marker<->max-uint mapping's population, so a membership difference means the mapping is being asserted over a different set than the chain has",
			})
		}
	}
	summary := p3Row{
		Gate: gateAaveHF, Subject: "census:aave-borrowers", Leg: "set-equality(independent candidates vs derived fold)",
		Expected: fmt.Sprintf("%d candidates from custodied raw events, classified by pinned chain reads", len(c.Candidates)),
		Actual: fmt.Sprintf("agree %d, only-chain %d, only-derived %d; zero-debt only-chain %d only-derived %d",
			agreeBorrower, onlyChainBorrower, onlyDerivedBorrower, onlyChainZero, onlyDerivedZero),
		Gated: true,
		Note:  "the census side is INDEPENDENT of the state under test: candidates come from raw_logs over the walked Aave addresses and are classified by getUserAccountData at the pin. A borrower the fold dropped therefore shows up here instead of vanishing from both sides (Codex round 1, finding 3)",
	}
	if onlyChainBorrower == 0 && onlyDerivedBorrower == 0 && onlyChainZero == 0 && onlyDerivedZero == 0 {
		summary.Verdict = verdictExact
	} else {
		summary.Verdict = verdictDrift
		summary.Class = "census-set-difference"
	}
	rows = append(rows, summary)
	return rows
}

// buildDerivedFlagMap folds the collateral-flag ledger rows into a
// per-(account, reserve) view for the census predicate. A pair with NO row is
// never-enabled, which the law reads as OFF — a chain fact under
// genesis-complete custody, not a default (store/collateralflags.go).
func buildDerivedFlagMap(rows []store.CollateralFlagRow) map[string]map[common.Address]bool {
	out := map[string]map[common.Address]bool{}
	for _, r := range rows {
		key := hex.EncodeToString(r.User)
		m := out[key]
		if m == nil {
			m = map[common.Address]bool{}
			out[key] = m
		}
		m[common.BytesToAddress(r.Reserve)] = r.Enabled
	}
	return out
}

// derivedCensusReserves clones the HF weld's reserve inputs with the DERIVED
// flag fold substituted for the pinned bitmap — the one-law census's value
// projection input. Dropping the fold here (using the raw balances flag-blind)
// is exactly the accept-r4 regression, so this function is deliberately small
// enough to unit-test and mutate in isolation.
func derivedCensusReserves(reserves []risk.AaveReserve, flags map[common.Address]bool) []risk.AaveReserve {
	out := make([]risk.AaveReserve, len(reserves))
	for i, r := range reserves {
		r.UsedAsCollateral = flags[r.Asset] // nil map => false => never-enabled is OFF
		out[i] = r
	}
	return out
}

// scaledBalanceControl picks the deterministic nonzero control for the
// balance-census weld: the first measured candidate carrying a positive derived
// scaled collateral leg. Zero address means no candidate qualifies (and the
// weld set is then whatever the disagreement sets produced).
func scaledBalanceControl(candidates []common.Address, measured map[common.Address]bool,
	legs map[string]map[common.Address][2]*big.Int) common.Address {
	for _, a := range candidates {
		if !measured[a] {
			continue
		}
		for _, pair := range legs[hex.EncodeToString(a.Bytes())] {
			if pair[1] != nil && pair[1].Sign() > 0 {
				return a
			}
		}
	}
	return common.Address{}
}

// maskedPairSelection is the per-(account, reserve) balance-census selection
// (Codex round 2, finding 2), with the counts the disclosure row prints.
type maskedPairSelection struct {
	// Pairs maps each selected account to the reserves whose positive derived
	// balance is masked at the pin, in reserve-list order.
	Pairs map[common.Address][]common.Address
	// PairCount is the total number of masked (account, reserve) pairs.
	PairCount int
	// FoldedOff counts pairs whose DERIVED (folded) flag is OFF — the Codex
	// round 2 remedy's mandated set.
	FoldedOff int
	// PinnedOnlyOff counts pairs whose folded flag is ON but whose PINNED
	// bitmap flag is OFF: the same invisibility through the other flag door
	// (the pinned HF weld ignores the balance on both sides), which on a
	// borrower never surfaces as any census row.
	PinnedOnlyOff int
}

// selectMaskedBalancePairs selects, per (account, reserve), every POSITIVE
// derived scaled-collateral balance that no bit-exact weld would otherwise
// see: the folded flag is OFF (the value projection ignores it) or the pinned
// bitmap flag is OFF (the pinned HF computation ignores it on BOTH sides).
//
// THE DEFECT THIS CLOSES (Codex round 2, finding 2): selection by membership
// flip. A borrower with debt has RawZeroDebt == oneLawZero == false; a
// zero-debt account with one enabled and one disabled reserve is true in
// both; neither flips, so a wrong derived balance in a flag-OFF reserve was
// never welded anywhere and acceptance passed over wrong stored collateral.
// The masking condition is a property of the PAIR, so the selection is too.
// It is a pure function so the law is unit-tested and mutation-killable in
// isolation.
func selectMaskedBalancePairs(candidates []common.Address, measured map[common.Address]bool,
	reserves []common.Address, legs map[string]map[common.Address][2]*big.Int,
	foldedFlags map[string]map[common.Address]bool,
	pinnedOn func(acct, reserve common.Address) bool) maskedPairSelection {
	sel := maskedPairSelection{Pairs: map[common.Address][]common.Address{}}
	for _, a := range candidates {
		if !measured[a] {
			// account-state already gated weld-unread; a pinned read for it did
			// not decode, so no honest chain side exists to weld against.
			continue
		}
		key := hex.EncodeToString(a.Bytes())
		for _, r := range reserves {
			pair := legs[key][r]
			if pair[1] == nil || pair[1].Sign() <= 0 {
				continue
			}
			foldedOff := !foldedFlags[key][r] // nil map => never-enabled => OFF
			pinnedOff := !pinnedOn(a, r)
			if !foldedOff && !pinnedOff {
				// The balance enters both the value projection and the pinned
				// HF weld; it is not masked and the totalCollateralBase weld
				// already tests it.
				continue
			}
			sel.Pairs[a] = append(sel.Pairs[a], r)
			sel.PairCount++
			if foldedOff {
				sel.FoldedOff++
			} else {
				sel.PinnedOnlyOff++
			}
		}
	}
	return sel
}

// runScaledBalanceCensusWeld reads aToken.scaledBalanceOf(user) at the pin for
// every account in the weld set, across every reserve, and welds each against
// the derived scaled collateral leg (absent leg = zero) bit-exactly.
func runScaledBalanceCensusWeld(ctx context.Context, c *p3Ctx, f *gateFrame,
	weldReason map[common.Address]string, reserves []common.Address,
	aTokenByReserve map[common.Address]common.Address,
	legs map[string]map[common.Address][2]*big.Int) []p3Row {
	var rows []p3Row
	if len(weldReason) == 0 {
		return rows
	}
	accounts := make([]common.Address, 0, len(weldReason))
	for a := range weldReason {
		accounts = append(accounts, a)
	}
	accounts = sortAddrSlice(accounts)

	var calls []multicallCall
	type tag struct {
		acct    common.Address
		reserve common.Address
	}
	var tags []tag
	for _, a := range accounts {
		for _, r := range reserves {
			at := aTokenByReserve[r]
			if at == (common.Address{}) {
				rows = append(rows, unreadRow(gateAaveHF, a.Hex(), "scaledBalanceOf(census weld) reserve "+r.Hex(),
					"the reserve's aToken did not resolve at the pin (getReserveAToken), so the balance-census weld through it cannot be read"))
				continue
			}
			d, err := aTokenScaledBalanceOfABI.Pack("scaledBalanceOf", a)
			if err != nil {
				rows = append(rows, unreadRow(gateAaveHF, a.Hex(), "scaledBalanceOf(census weld) reserve "+r.Hex(), err.Error()))
				continue
			}
			calls, tags = append(calls, multicallCall{Target: at, CallData: d}), append(tags, tag{acct: a, reserve: r})
		}
	}
	if len(calls) == 0 {
		return rows
	}
	res, _, err := c.ethR.multicall(ctx, "p3:aave:scaledBalanceCensusWeld", c.pinETH, c.hashETH, calls)
	if err != nil {
		for _, tg := range tags {
			rows = append(rows, unreadRow(gateAaveHF, tg.acct.Hex(), "scaledBalanceOf(census weld) reserve "+tg.reserve.Hex(),
				"the balance-census multicall did not answer: "+err.Error()))
		}
		return rows
	}
	for i, tg := range tags {
		subject := tg.acct.Hex()
		leg := "scaledBalanceOf(census weld) reserve " + tg.reserve.Hex()
		if !res[i].Success {
			rows = append(rows, unreadRow(gateAaveHF, subject, leg, "scaledBalanceOf reverted at the pin"))
			continue
		}
		chainScaled, err := unpackUint256Strict(aTokenScaledBalanceOfABI, "scaledBalanceOf", res[i].ReturnData)
		if err != nil {
			rows = append(rows, unreadRow(gateAaveHF, subject, leg, err.Error()))
			continue
		}
		f.use(aaveScaledBalanceSource)
		derived := new(big.Int)
		if pair, ok := legs[hex.EncodeToString(tg.acct.Bytes())][tg.reserve]; ok && pair[1] != nil {
			derived = pair[1]
		}
		row := compareExact(gateAaveHF, subject, leg, chainScaled, derived, "balance-census-difference")
		if row.Evidence == nil {
			row.Evidence = map[string]string{}
		}
		row.Evidence["weld_reason"] = weldReason[tg.acct]
		row.Evidence["law"] = "bit-exact, zero tolerance: the raw scaled balance is the fold's own unit, so any difference is a fold defect the flag-gated census would otherwise mask (chain-truth ruling, ledger 08:55 — the Σ weld has zero power against transfers)"
		rows = append(rows, row)
	}
	return rows
}

// zeroControlChunks builds a call list in which position i ≡ 0 (mod
// multicallChunkSize) is ALWAYS the nonzero control, so the fixed 15-call
// chunking puts a control in EVERY chunk. Returns the calls plus, for each
// probe, its index in the result.
//
// This is the mechanical form of chain-truth R1.4: "every multicall chunk that
// contains only expected-zero subjects MUST also carry ≥1 known-nonzero
// control account whose value is independently gated in the same run."
func zeroControlChunks(control multicallCall, probes []multicallCall) (calls []multicallCall, controlIdx []int, probeIdx []int) {
	for _, p := range probes {
		if len(calls)%multicallChunkSize == 0 {
			controlIdx = append(controlIdx, len(calls))
			calls = append(calls, control)
		}
		probeIdx = append(probeIdx, len(calls))
		calls = append(calls, p)
	}
	return calls, controlIdx, probeIdx
}

// runAaveHFGate executes the gate. It returns rows only; the caller sums the
// gated failures into the run's ONE accounting (never a side-channel exit).
func runAaveHFGate(ctx context.Context, c *p3Ctx) ([]p3Row, error) {
	f := c.frames.add(aaveGateFrame())
	t6 := c.t6
	cohort := buildAaveCohort(t6)
	var rows []p3Row

	// ---- reserve universe + per-reserve pinned reads -----------------------
	rlData, err := poolReservesListABI.Pack("getReservesList")
	if err != nil {
		return nil, err
	}
	rlRet, _, err := c.ethR.callAtHash(ctx, "p3:aave:getReservesList", c.aavePool, rlData, c.hashETH)
	if err != nil {
		return nil, aavePhaseErr(err)
	}
	f.use("Pool.getReservesList()@pinHash(P_eth)")
	reserves, err := unpackAddressListStrict(poolReservesListABI, "getReservesList", rlRet)
	if err != nil {
		return nil, err
	}
	reserveIndex := map[common.Address]int{}
	for i, r := range reserves {
		reserveIndex[r] = i
	}

	type reserveState struct {
		config  aaveReserveConfig
		income  *big.Int
		varDebt *big.Int
		price   *big.Int
		// aToken is the pin-resolved token behind the reserve, for the
		// balance-census weld; the zero address means the read did not decode
		// and every scaledBalanceOf weld through it refuses.
		aToken    common.Address
		haveAll   bool
		readNotes []string
	}
	states := map[common.Address]*reserveState{}
	var calls []multicallCall
	type tag struct {
		kind    string
		reserve common.Address
	}
	var tags []tag
	add := func(k string, r common.Address, target common.Address, data []byte) {
		calls = append(calls, multicallCall{Target: target, CallData: data})
		tags = append(tags, tag{kind: k, reserve: r})
	}
	for _, r := range reserves {
		states[r] = &reserveState{}
		d, err := poolGetConfigurationABI.Pack("getConfiguration", r)
		if err != nil {
			return nil, err
		}
		add("config", r, c.aavePool, d)
		if d, err = poolNormalizedIncomeABI.Pack("getReserveNormalizedIncome", r); err != nil {
			return nil, err
		}
		add("income", r, c.aavePool, d)
		if d, err = poolNormalizedDebtABI.Pack("getReserveNormalizedVariableDebt", r); err != nil {
			return nil, err
		}
		add("varDebt", r, c.aavePool, d)
		if d, err = aaveOracleGetAssetPriceABI.Pack("getAssetPrice", r); err != nil {
			return nil, err
		}
		add("price", r, c.reg.AaveOracle, d)
		if d, err = poolGetReserveATokenABI.Pack("getReserveAToken", r); err != nil {
			return nil, err
		}
		add("atoken", r, c.aavePool, d)
	}
	res, _, err := c.ethR.multicall(ctx, "p3:aave:reserveState", c.pinETH, c.hashETH, calls)
	if err != nil {
		return nil, aavePhaseErr(err)
	}
	for i, tg := range tags {
		st := states[tg.reserve]
		if !res[i].Success {
			if tg.kind == "atoken" {
				// Refuses only the balance-census weld through this reserve; the
				// HF weld's haveAll must not depend on the v3.2+ accessor.
				continue
			}
			st.readNotes = append(st.readNotes, tg.kind+" reverted at the pin")
			continue
		}
		switch tg.kind {
		case "config":
			packed, err := unpackPackedUint256Struct(poolGetConfigurationABI, "getConfiguration", res[i].ReturnData)
			if err != nil {
				st.readNotes = append(st.readNotes, err.Error())
				continue
			}
			st.config = decodeAaveReserveConfig(packed)
			f.use("Pool.getConfiguration(asset)@pinHash(P_eth)")
		case "income":
			if st.income, err = unpackUint256Strict(poolNormalizedIncomeABI, "getReserveNormalizedIncome", res[i].ReturnData); err != nil {
				st.readNotes = append(st.readNotes, err.Error())
				continue
			}
			f.use("Pool.getReserveNormalizedIncome(asset)@pinHash(P_eth)")
		case "varDebt":
			if st.varDebt, err = unpackUint256Strict(poolNormalizedDebtABI, "getReserveNormalizedVariableDebt", res[i].ReturnData); err != nil {
				st.readNotes = append(st.readNotes, err.Error())
				continue
			}
			f.use("Pool.getReserveNormalizedVariableDebt(asset)@pinHash(P_eth)")
		case "price":
			if st.price, err = unpackUint256Strict(aaveOracleGetAssetPriceABI, "getAssetPrice", res[i].ReturnData); err != nil {
				st.readNotes = append(st.readNotes, err.Error())
				continue
			}
			f.use("AaveOracle.getAssetPrice(asset)@pinHash(P_eth)")
		case "atoken":
			// A failed aToken resolution refuses only the balance-census weld
			// through this reserve (recorded there), never the HF weld: haveAll
			// stays independent of it, so a v-line without the accessor cannot
			// silently degrade the primary gate.
			v, err := unpackAddressStrict(poolGetReserveATokenABI, "getReserveAToken", res[i].ReturnData)
			if err != nil {
				continue
			}
			st.aToken = v
			f.use(aaveReserveATokenSource)
		}
	}
	for _, r := range reserves {
		st := states[r]
		st.haveAll = st.income != nil && st.varDebt != nil && st.price != nil && len(st.readNotes) == 0
		if !st.haveAll {
			rows = append(rows, unreadRow(gateAaveHF, r.Hex(), "reserve-state",
				fmt.Sprintf("one or more of {getConfiguration, getReserveNormalizedIncome, getReserveNormalizedVariableDebt, getAssetPrice} did not read at the pin: %v", st.readNotes)))
			continue
		}
		// Registry decimals weld (risk-quant R4.5). The CHAIN is the expected
		// side; recon/feeds.json is the claim.
		if reg := c.reg.Aave[r]; reg != nil {
			f.use("recon/feeds.json asset decimals (Aave reserves)")
			rows = append(rows, compareExact(gateAaveHF, r.Hex(), "decimals(chain-config vs registry)",
				bigFromUint(uint64(st.config.Decimals)), bigFromUint(uint64(reg.Decimals)), "decimals-mismatch"))
		}
	}

	// ---- per-account pinned reads ------------------------------------------
	// Cohort accounts (finite + zero-debt) go in one batch; the never-seen
	// subjects go in their OWN batch, chunk-aligned with a nonzero control.
	// EVERY candidate is read, not just the fold's own members: that is what makes
	// the census weld below independent of the state under test.
	measured := cohort.Candidates
	accountData, userConfig, userEMode, accountNotes, err := readAaveAccountLegs(ctx, c, f, measured, "p3:aave:accounts")
	if err != nil {
		return nil, err
	}

	// ---- per-account weld --------------------------------------------------
	folded, err := riskfeed.FoldParams(snapshotdb.AaveParamEngine, 1, t6.AaveParams)
	if err != nil {
		return nil, fmt.Errorf("fold aave param ledger: %w", err)
	}
	f.use("param_history(engine=aave_param, chain=1) ledger prefix <= P_eth, folded by riskfeed.FoldParams")

	legsByAccount := map[string]map[common.Address][2]*big.Int{} // account → reserve → [debt, coll]
	for _, l := range t6.AaveLegs {
		m := legsByAccount[l.AccountHex]
		if m == nil {
			m = map[common.Address][2]*big.Int{}
			legsByAccount[l.AccountHex] = m
		}
		asset := common.HexToAddress(l.AssetHex)
		cur := m[asset]
		if l.Side == "debt" {
			cur[0] = l.Amount
			f.use("position_balances(source=event, engine=aave_v3_etherfi, side=debt).amount@P_eth")
		} else {
			cur[1] = l.Amount
			f.use("position_balances(source=event, engine=aave_v3_etherfi, side=collateral).amount@P_eth")
		}
		m[asset] = cur
	}

	sharpnessWitness := ""
	priceDecimals := aavePriceDecimalsFromRegistry(c)
	f.use("recon/feeds.json aaveoracle priceDecimals")
	f.use("raw_logs candidate universe (walked Aave addresses, user slots topics[3]/topics[4], <= P_eth)")

	// The DERIVED collateral-flag fold — the census predicate's flag source
	// under the one law. Absence means never-enabled means OFF.
	flagMap := buildDerivedFlagMap(t6.AaveCollateralFlags)
	f.use(aaveFlagLedgerSource)

	// The CHAIN's own classification of every candidate, kept separate from the
	// fold's so the two can disagree (Codex round 1, finding 3).
	chainHasDebt := map[common.Address]bool{}
	chainHasCollateral := map[common.Address]bool{}
	measuredOK := map[common.Address]bool{}
	// derivedFlagCollValue is the one-law census's VALUE PROJECTION per
	// candidate: TotalCollateralBase computed over the DERIVED flag fold instead
	// of the pinned bitmap. nil = not computable (the refusal row already gates).
	derivedFlagCollValue := map[string]*big.Int{}

	for _, acct := range measured {
		key := hex.EncodeToString(acct.Bytes())
		subject := acct.Hex()
		if note, bad := accountNotes[acct]; bad {
			rows = append(rows, unreadRow(gateAaveHF, subject, "account-state", note))
			continue
		}
		chainData := accountData[acct]
		cfgBits := userConfig[acct]
		measuredOK[acct] = true
		chainHasDebt[acct] = chainData.TotalDebtBase.Sign() > 0
		chainHasCollateral[acct] = chainData.TotalCollateralBase.Sign() > 0

		// eMode is GATED == 0.
		emode := userEMode[acct]
		rows = append(rows, compareExact(gateAaveHF, subject, "getUserEMode==0",
			emode, big.NewInt(0), "emode-nonzero"))

		in := risk.AaveInput{
			Account: acct,
			EMode:   0,
			Regime:  risk.RegimeAtBlock(c.pinETH),
			Params:  folded,
			Marks:   risk.Watermarks{BalancesBlock: c.pinETH, ParamsBlock: c.pinETH},
		}
		for _, r := range reserves {
			st := states[r]
			if !st.haveAll {
				continue
			}
			legs := legsByAccount[key][r]
			flags := decodeAaveUserConfiguration(cfgBits, reserveIndex[r])
			in.Reserves = append(in.Reserves, risk.AaveReserve{
				Asset:            r,
				Decimals:         st.config.Decimals,
				ScaledDebt:       orZeroBig(legs[0]),
				ScaledCollateral: orZeroBig(legs[1]),
				DebtIndex:        st.varDebt,
				CollateralIndex:  st.income,
				IndexBlock:       c.pinETH,
				UsedAsCollateral: flags.UsedAsCollateral,
			})
			in.Prices = append(in.Prices, risk.PriceInput{
				ChainID: 1, Asset: r, Source: "aaveoracle@pin", Block: c.pinETH,
				Value: st.price, Decimals: priceDecimals,
				Provenance: risk.ProvenanceAdapterOutput, Fresh: true,
			})
		}
		f.use("Pool.getUserConfiguration(user)@pinHash(P_eth)")

		got, err := risk.ComputeAaveHealth(in)
		if err != nil {
			rows = append(rows, driftRow(gateAaveHF, subject, "ComputeAaveHealth", "computable", "refused: "+err.Error(),
				"library-refusal",
				"internal/risk refused to compute over the declared frame. A refusal is a GATED failure here: the served surface would refuse the same account, so the book has a position we cannot value"))
			continue
		}

		// The one-law census's value projection: the SAME computation with the
		// DERIVED flag fold substituted for the pinned bitmap. Its
		// TotalCollateralBase is the chain's value-space law over OUR flags —
		// what decides flag-on-but-value-floors-to-zero (chain-truth ruling,
		// ledger 08:55).
		inDerived := in
		inDerived.Reserves = derivedCensusReserves(in.Reserves, flagMap[key])
		if gotDerived, derr := risk.ComputeAaveHealth(inDerived); derr == nil {
			derivedFlagCollValue[key] = gotDerived.TotalCollateralBase
		}

		rows = append(rows, compareExact(gateAaveHF, subject, "totalCollateralBase",
			chainData.TotalCollateralBase, got.TotalCollateralBase, "component-5-collateral"))
		rows = append(rows, compareExact(gateAaveHF, subject, "totalDebtBase",
			chainData.TotalDebtBase, got.TotalDebtBase, "component-5-debt"))

		// healthFactor with the EXPLICIT marker↔max-uint mapping. Zero-debt
		// accounts are never compared as magnitudes.
		switch {
		case got.IsInfinite && chainData.TotalDebtBase.Sign() == 0:
			if chainData.HealthFactor.Cmp(maxUint256) == 0 {
				rows = append(rows, exactRow(gateAaveHF, subject, "healthFactor(marker<->type(uint256).max)",
					"type(uint256).max", "risk.AaveHealth.IsInfinite"))
			} else {
				rows = append(rows, driftRow(gateAaveHF, subject, "healthFactor(marker<->type(uint256).max)",
					chainData.HealthFactor.String(), "risk.AaveHealth.IsInfinite", "marker-mapping",
					"our side says the health factor is undefined-because-unbounded (zero debt) but the chain did NOT answer type(uint256).max — the marker mapping is explicit by law, so this is a real disagreement about whether the account has debt"))
			}
		case got.IsInfinite != (chainData.HealthFactor.Cmp(maxUint256) == 0):
			rows = append(rows, driftRow(gateAaveHF, subject, "healthFactor(marker<->type(uint256).max)",
				chainData.HealthFactor.String(), fmt.Sprintf("infinite=%v", got.IsInfinite), "marker-mapping",
				"the infinite/finite classification disagrees with the chain's max-uint marker"))
		default:
			rows = append(rows, compareExact(gateAaveHF, subject, "healthFactor",
				chainData.HealthFactor, got.HealthFactorWad, "component-7-composite"))
		}

		// currentLiquidationThreshold — gated EXACT, but only after its law is
		// stated (risk-quant R1): the expected law is
		// floor(Σ(Cᵢ·LTᵢ)/ΣCᵢ), which is Aave v3 GenericLogic's plain integer
		// division of the accumulated weighted sum by the total. If EVERY
		// borrower fails in a uniform pattern the law note was wrong and this
		// gate fails loud — acceptable, and better than an ungated column.
		if got.TotalCollateralBase.Sign() > 0 && got.AvgLiquidationThresholdBps != nil {
			rows = append(rows, compareExact(gateAaveHF, subject, "currentLiquidationThreshold",
				chainData.CurrentLiquidationThreshold, got.AvgLiquidationThresholdBps, "component-6-avg-lt"))
		} else {
			rows = append(rows, evidenceRow(gateAaveHF, subject, "currentLiquidationThreshold",
				chainData.CurrentLiquidationThreshold.String(),
				"no collateral at the pin, so floor(Σ(Cᵢ·LTᵢ)/ΣCᵢ) is undefined on our side; recorded, not gated"))
		}

		// availableBorrowsBase is an EVIDENCE column, NOT a gate (risk-quant
		// R1): its LTV/percentMul path is not probe-proven, and promoting it
		// later requires a derivation, not an observation streak.
		rows = append(rows, evidenceRow(gateAaveHF, subject, "availableBorrowsBase",
			chainData.AvailableBorrowsBase.String(),
			"EVIDENCE ONLY with stated uncertainty: the availableBorrows LTV/percentMul path is NOT probe-proven (risk-quant R1). Promoting it to a gate requires a derivation from the deployed source, never an observation streak"))

		// Component-4 sharpness (risk-quant R1's closing clause): the weld
		// cannot distinguish floor from half-up unless at least one
		// account×reserve product has a NONZERO remainder mod 10^dec.
		if sharpnessWitness == "" {
			if w := component4Witness(subject, got); w != "" {
				sharpnessWitness = w
			}
		}
	}

	// ---- the ONE-LAW derived zero-debt census ------------------------------
	// Membership := no derived debt AND scaled collateral > 0 with the DERIVED
	// flag ON AND the flag-gated value projection > 0 — the chain's own census
	// law (getUserAccountData sums only flag-ON reserves in base units). This
	// predicate choice is the ADJUDICATED law (chain-truth ruling, ledger
	// 08:55), not an assimilation-to-green: the flag-blind predicate asserted a
	// census the chain provably does not have, over accounts whose data both
	// sides agreed on exactly.
	rawZeroCount := len(cohort.ZeroDebt)
	oneLawZero := map[common.Address]bool{}
	cohort.ZeroDebt = nil
	for _, a := range cohort.Candidates {
		v := derivedFlagCollValue[hex.EncodeToString(a.Bytes())]
		if v != nil && v.Sign() > 0 && !cohort.DerivedFinite[a] {
			oneLawZero[a] = true
			cohort.ZeroDebt = append(cohort.ZeroDebt, a)
		}
	}
	cohort.DerivedZeroDebt = oneLawZero

	// ---- the census weld: INDEPENDENT candidates vs the derived fold -------
	rows = append(rows, censusWeldRows(cohort, chainHasDebt, chainHasCollateral, measuredOK)...)

	// ---- the balance-census weld: scaledBalanceOf@pin ----------------------
	// The flag gate above REMOVES accounts from the census, and a removed
	// account with a WRONG scaled balance would be invisible: both sides say
	// non-member, and the aggregate Σ weld has zero power against transfers.
	// So every candidate the one law reclassified (flag-masked) and every
	// candidate still disagreeing with the chain gets its raw scaled balances
	// read at the pin and welded bit-exactly, per reserve — aggregate evidence
	// converted into per-account proof (chain-truth ruling, ledger 08:55). A
	// nonzero control keeps the read provably live when the sets are empty.
	weldReason := map[common.Address]string{}
	for _, a := range cohort.Candidates {
		if !measuredOK[a] {
			continue // account-state already gated weld-unread; no classification exists to disagree with
		}
		if cohort.RawZeroDebt[a] != oneLawZero[a] {
			weldReason[a] = "flag-masked: the flag-blind raw census carried this account and the one-law census does not"
		}
		chainZero := chainHasCollateral[a] && !chainHasDebt[a]
		if oneLawZero[a] != chainZero {
			if weldReason[a] != "" {
				weldReason[a] += "; "
			}
			weldReason[a] += "census-disagreeing: the one-law derived membership still differs from the chain's"
		}
	}
	// PER-(ACCOUNT, RESERVE) selection (Codex round 2, finding 2): membership
	// flips are NOT the masking condition. Every positive derived balance
	// whose folded flag is OFF at the pin — and every pair the pinned bitmap
	// masks the same way — joins the weld, borrowers included.
	masked := selectMaskedBalancePairs(cohort.Candidates, measuredOK, reserves, legsByAccount, flagMap,
		func(a, r common.Address) bool {
			return decodeAaveUserConfiguration(userConfig[a], reserveIndex[r]).UsedAsCollateral
		})
	maskedAccounts := make([]common.Address, 0, len(masked.Pairs))
	for a := range masked.Pairs {
		maskedAccounts = append(maskedAccounts, a)
	}
	for _, a := range sortAddrSlice(maskedAccounts) {
		names := make([]string, 0, len(masked.Pairs[a]))
		for _, r := range masked.Pairs[a] {
			names = append(names, r.Hex())
		}
		reason := "masked-balance pair(s): positive derived scaled collateral the pin cannot otherwise weld (folded flag OFF and/or pinned bitmap OFF) in reserve(s) " +
			strings.Join(names, ",") + " — per-(account,reserve) selection, Codex round 2 finding 2"
		if weldReason[a] != "" {
			weldReason[a] += "; "
		}
		weldReason[a] += reason
	}
	control := scaledBalanceControl(cohort.Candidates, measuredOK, legsByAccount)
	if control != (common.Address{}) && weldReason[control] == "" {
		weldReason[control] = "nonzero control: proves the scaledBalanceOf read live against this archive"
	}
	aTokenByReserve := map[common.Address]common.Address{}
	for r, st := range states {
		aTokenByReserve[r] = st.aToken
	}
	rows = append(rows, runScaledBalanceCensusWeld(ctx, c, f, weldReason, reserves, aTokenByReserve, legsByAccount)...)
	// The selection's honest bound, disclosed (Codex round 2, finding 2): the
	// batch is finite — positive derived balances with a masked flag at the
	// pin — and its composition is printed so a reviewer can audit the cost
	// and the coverage in one place.
	rows = append(rows, p3Row{
		Gate: gateAaveHF, Subject: "census:balance-weld", Leg: "masked-balance-selection(per account x reserve)",
		Expected: "every positive derived scaled-collateral balance whose folded flag is OFF at the pin (plus every pinned-bitmap-OFF pair) joins the scaledBalanceOf weld",
		Actual: fmt.Sprintf("%d masked pair(s) across %d account(s): folded-flag-OFF %d, pinned-only-OFF %d; weld batch %d account(s) x %d reserve(s) = %d scaledBalanceOf read(s)",
			masked.PairCount, len(masked.Pairs), masked.FoldedOff, masked.PinnedOnlyOff, len(weldReason), len(reserves), len(weldReason)*len(reserves)),
		Verdict: verdictExact, Gated: true,
		Note: "the balance-census weld's selection law: masking is a property of the (account, reserve) pair — a borrower with a wrong flag-OFF balance flips no membership and disagrees with no census, so selection by membership flip (the Wave-H shape) left it unwelded and acceptance passed over wrong stored collateral. Selection now operates on the pairs themselves; the flip-selected and census-disagreeing accounts and the nonzero control remain in the set",
	})

	// ---- cohort floors, census-welded --------------------------------------
	rows = append(rows, cohortFloorRow(gateAaveHF, "aave-finite-hf-borrowers",
		len(cohort.Finite), cohort.CensusFinite, aaveFiniteBackstop,
		fmt.Sprintf("membership is ALL finite-HF borrowers, not a sample: the derived census at P_eth is %d accounts with nonzero scaled debt. The plan's original >=20 was refuted by the chain (12 finite-HF borrowers) and both consults ruled a floor no honest run can meet a custody hazard rather than a strengthening (chain-truth R5.1). finite=%d infinite/zero-debt=%d",
			cohort.CensusFinite, cohort.CensusFinite, cohort.CensusZero)))
	rows = append(rows, cohortFloorRow(gateAaveHF, "aave-zero-debt(marker mapping)",
		len(cohort.ZeroDebt), aaveZeroDebtFloor, aaveZeroDebtFloor,
		fmt.Sprintf("ONE-LAW members (no derived debt; scaled collateral > 0 with the DERIVED flag ON; flag-gated value projection > 0 — the chain's own census law, chain-truth ruling ledger 08:55); each welds the marker<->type(uint256).max mapping explicitly. Raw flag-blind candidates: %d; one-law members: %d; flag-masked (removed, scaledBalanceOf-welded instead): %d",
			rawZeroCount, len(cohort.ZeroDebt), rawZeroCount-len(cohort.ZeroDebt))))

	if sharpnessWitness == "" {
		rows = append(rows, p3Row{
			Gate: gateAaveHF, Subject: "cohort:component-4-sharpness", Leg: "discriminator",
			Verdict: verdictDrift, Gated: true, Class: "sharpness-clause-unmet",
			Expected: ">=1 cohort account x reserve with (balance x price) mod 10^dec != 0",
			Actual:   "none found",
			Note:     "risk-quant R1's sharpness clause: without a nonzero component-4 remainder anywhere in the cohort the weld cannot distinguish floor from half-up and proves LESS than it appears. This is a gated failure of the GATE's discriminating power, not of the book",
		})
	} else {
		rows = append(rows, p3Row{
			Gate: gateAaveHF, Subject: "cohort:component-4-sharpness", Leg: "discriminator",
			Verdict: verdictExact, Gated: true,
			Expected: ">=1 cohort account x reserve with (balance x price) mod 10^dec != 0",
			Actual:   sharpnessWitness,
			Note:     "the weld provably distinguishes floor from half-up on this cohort (risk-quant R1 sharpness clause, closing the Task-4 R4-1 item with a chain witness)",
		})
	}

	// ---- empty-set probes with archive-served-zero proof -------------------
	probeRows, err := runNeverSeenProbe(ctx, c, f, cohort)
	if err != nil {
		return nil, err
	}
	rows = append(rows, probeRows...)
	return rows, nil
}

// readAaveAccountLegs reads (getUserAccountData, getUserConfiguration,
// getUserEMode) for each account through the shared multicall.
func readAaveAccountLegs(ctx context.Context, c *p3Ctx, f *gateFrame, accounts []common.Address, op string) (
	map[common.Address]userAccountData, map[common.Address]*big.Int, map[common.Address]*big.Int, map[common.Address]string, error) {
	data := map[common.Address]userAccountData{}
	cfg := map[common.Address]*big.Int{}
	emode := map[common.Address]*big.Int{}
	notes := map[common.Address]string{}
	if len(accounts) == 0 {
		return data, cfg, emode, notes, nil
	}
	var calls []multicallCall
	type tag struct {
		kind string
		acct common.Address
	}
	var tags []tag
	for _, a := range accounts {
		d, err := poolUserAccountDataABI.Pack("getUserAccountData", a)
		if err != nil {
			return nil, nil, nil, nil, err
		}
		calls, tags = append(calls, multicallCall{Target: c.aavePool, CallData: d}), append(tags, tag{"data", a})
		if d, err = poolUserConfigurationABI.Pack("getUserConfiguration", a); err != nil {
			return nil, nil, nil, nil, err
		}
		calls, tags = append(calls, multicallCall{Target: c.aavePool, CallData: d}), append(tags, tag{"cfg", a})
		if d, err = poolUserEModeABI.Pack("getUserEMode", a); err != nil {
			return nil, nil, nil, nil, err
		}
		calls, tags = append(calls, multicallCall{Target: c.aavePool, CallData: d}), append(tags, tag{"emode", a})
	}
	res, _, err := c.ethR.multicall(ctx, op, c.pinETH, c.hashETH, calls)
	if err != nil {
		return nil, nil, nil, nil, aavePhaseErr(err)
	}
	for i, tg := range tags {
		if !res[i].Success {
			notes[tg.acct] = tg.kind + " reverted at the pin"
			continue
		}
		switch tg.kind {
		case "data":
			v, err := unpackUserAccountData(res[i].ReturnData)
			if err != nil {
				notes[tg.acct] = err.Error()
				continue
			}
			data[tg.acct] = v
			f.use("Pool.getUserAccountData(user)@pinHash(P_eth)")
		case "cfg":
			v, err := unpackPackedUint256Struct(poolUserConfigurationABI, "getUserConfiguration", res[i].ReturnData)
			if err != nil {
				notes[tg.acct] = err.Error()
				continue
			}
			cfg[tg.acct] = v
		case "emode":
			v, err := unpackUint256Strict(poolUserEModeABI, "getUserEMode", res[i].ReturnData)
			if err != nil {
				notes[tg.acct] = err.Error()
				continue
			}
			emode[tg.acct] = v
			f.use("Pool.getUserEMode(user)@pinHash(P_eth)")
		}
	}
	for _, a := range accounts {
		if _, ok := notes[a]; ok {
			continue
		}
		if _, ok := data[a]; !ok {
			notes[a] = "getUserAccountData produced no decoded value"
		} else if cfg[a] == nil {
			notes[a] = "getUserConfiguration produced no decoded value"
		} else if emode[a] == nil {
			notes[a] = "getUserEMode produced no decoded value"
		}
	}
	return data, cfg, emode, notes, nil
}

// runNeverSeenProbe is the empty-set / phantom-debt probe. Both sides must be
// clean, and every chunk carries the nonzero control.
func runNeverSeenProbe(ctx context.Context, c *p3Ctx, f *gateFrame, cohort aaveCohort) ([]p3Row, error) {
	var rows []p3Row
	if !cohort.HasControl {
		rows = append(rows, p3Row{
			Gate: gateAaveHF, Subject: "cohort:never-seen", Leg: "archive-served-zero-control",
			Verdict: verdictWeldUnread, Gated: true,
			Note: "no known-NONZERO control subject exists (the finite-HF census is empty), so an all-zero chunk could not be distinguished from a lying default (chain-truth R1.4). The probe is refused rather than run without its control",
		})
		return rows, nil
	}
	dbByAccount := map[string]snapshotdb.T6NeverSeen{}
	for _, n := range c.t6.AaveNeverSeen {
		dbByAccount[n.AccountHex] = n
	}
	f.use("position_events+position_balances absence for the never-seen subjects")
	f.use("raw_logs absence for the never-seen subjects (chain 1, wide predicate: address, any topic's low 20 bytes, anywhere in data)")
	// The COMMITTED list itself is the probe's cohort source, consumed right
	// here where cohort.NeverSeen (built from it) drives every probe call.
	// accept-r4's aave_hf frame violation was this line's absence: the probe
	// provably ran, but the declaration went unconsumed — pure bookkeeping,
	// closed by recording the consumption at the consumption site (the source
	// name is a shared const so declaration and use cannot drift again).
	f.use(aaveNeverSeenListSource)

	controlData, err := poolUserAccountDataABI.Pack("getUserAccountData", cohort.Control)
	if err != nil {
		return nil, err
	}
	control := multicallCall{Target: c.aavePool, CallData: controlData}
	var probes []multicallCall
	for _, a := range cohort.NeverSeen {
		d, err := poolUserAccountDataABI.Pack("getUserAccountData", a)
		if err != nil {
			return nil, err
		}
		probes = append(probes, multicallCall{Target: c.aavePool, CallData: d})
		if d, err = poolUserConfigurationABI.Pack("getUserConfiguration", a); err != nil {
			return nil, err
		}
		probes = append(probes, multicallCall{Target: c.aavePool, CallData: d})
	}
	calls, controlIdx, probeIdx := zeroControlChunks(control, probes)
	res, _, err := c.ethR.multicall(ctx, "p3:aave:never-seen", c.pinETH, c.hashETH, calls)
	if err != nil {
		return nil, aavePhaseErr(err)
	}

	// The control's value is INDEPENDENTLY GATED in this same run, in every
	// chunk it appears in: a zero from the control means the archive is not
	// serving state at this pin, so the zeros beside it prove nothing.
	controlsOK := 0
	for _, idx := range controlIdx {
		chunk := idx / multicallChunkSize
		subject := fmt.Sprintf("control %s (chunk %d)", cohort.Control.Hex(), chunk)
		if !res[idx].Success {
			rows = append(rows, unreadRow(gateAaveHF, subject, "archive-served-zero-control", "the control call reverted at the pin"))
			continue
		}
		v, err := unpackUserAccountData(res[idx].ReturnData)
		if err != nil {
			rows = append(rows, unreadRow(gateAaveHF, subject, "archive-served-zero-control", err.Error()))
			continue
		}
		if v.TotalCollateralBase.Sign() == 0 && v.TotalDebtBase.Sign() == 0 {
			rows = append(rows, driftRow(gateAaveHF, subject, "archive-served-zero-control",
				"nonzero (a borrower with derived debt at the pin)", "all zero", "lying-default-suspected",
				"the KNOWN-NONZERO control answered zero in this chunk, so every expected-zero answer beside it is testimony indistinguishable from a lying default (chain-truth R1.4). The empty-set probe's zeros in this chunk prove nothing"))
			continue
		}
		controlsOK++
		rows = append(rows, exactRow(gateAaveHF, subject, "archive-served-zero-control",
			"nonzero", "collateral="+v.TotalCollateralBase.String()+" debt="+v.TotalDebtBase.String()))
	}

	clean := 0
	for i, a := range cohort.NeverSeen {
		subject := a.Hex()
		dataIdx, cfgIdx := probeIdx[2*i], probeIdx[2*i+1]
		db, haveDB := dbByAccount[hex.EncodeToString(a.Bytes())]
		if !haveDB {
			rows = append(rows, unreadRow(gateAaveHF, subject, "never-seen(db-side)", "no DB-side absence proof was collected for this subject"))
			continue
		}
		if db.RawLogHits != 0 || db.DerivedRows != 0 {
			rows = append(rows, driftRow(gateAaveHF, subject, "never-seen(db-side)",
				"absent from raw_logs AND from derived state",
				fmt.Sprintf("raw_logs hits %d, derived rows %d", db.RawLogHits, db.DerivedRows),
				"never-seen-subject-invalid",
				"a committed never-seen subject turned out to be IN custody. The subject is invalid and the probe cannot use it — recorded as a gated failure rather than silently substituting another address, because a substitution would make the cohort unreproducible"))
			continue
		}
		if !res[dataIdx].Success || !res[cfgIdx].Success {
			rows = append(rows, unreadRow(gateAaveHF, subject, "never-seen(chain-side)", "a probe call reverted at the pin"))
			continue
		}
		chainData, err := unpackUserAccountData(res[dataIdx].ReturnData)
		if err != nil {
			rows = append(rows, unreadRow(gateAaveHF, subject, "never-seen(chain-side)", err.Error()))
			continue
		}
		cfgBits, err := unpackPackedUint256Struct(poolUserConfigurationABI, "getUserConfiguration", res[cfgIdx].ReturnData)
		if err != nil {
			rows = append(rows, unreadRow(gateAaveHF, subject, "never-seen(chain-side)", err.Error()))
			continue
		}
		zeroState := chainData.TotalCollateralBase.Sign() == 0 && chainData.TotalDebtBase.Sign() == 0 && cfgBits.Sign() == 0
		if !zeroState {
			rows = append(rows, driftRow(gateAaveHF, subject, "never-seen(chain-side)",
				fmt.Sprintf("collateral=%s debt=%s userConfig=%s", chainData.TotalCollateralBase, chainData.TotalDebtBase, cfgBits),
				"zero state expected (never-seen)", "phantom-state",
				"an address absent from BOTH our raw custody and our derived state carries chain state at the pin: either the custody predicate is wrong or the address is not what the committed list says it is"))
			continue
		}
		clean++
		rows = append(rows, exactRow(gateAaveHF, subject, "never-seen(both sides clean)",
			"zero chain state at the pin", "absent from raw_logs and from derived state"))
	}
	rows = append(rows, cohortFloorRow(gateAaveHF, "aave-never-seen(phantom-debt probe)",
		clean, aaveNeverSeenFloor, aaveNeverSeenFloor,
		fmt.Sprintf("subjects proven clean on BOTH sides. Committed seed %q; %d controls verified nonzero across %d chunk(s) — every all-zero chunk carried one (chain-truth R1.4)", neverSeenSeed, controlsOK, len(controlIdx))))
	return rows, nil
}

// component4Witness returns a printable witness when any reserve of this
// account has a nonzero (balance × price) mod 10^decimals remainder.
func component4Witness(subject string, h risk.AaveHealth) string {
	for _, rv := range h.Reserves {
		if rv.Price.Value == nil {
			continue
		}
		den := pow10Big(rv.Decimals)
		for _, leg := range []struct {
			name string
			bal  *big.Int
		}{{"liveCollateral", rv.LiveCollateral}, {"liveDebt", rv.LiveDebt}} {
			if leg.bal == nil || leg.bal.Sign() == 0 {
				continue
			}
			prod := new(big.Int).Mul(leg.bal, rv.Price.Value)
			rem := new(big.Int).Mod(prod, den)
			if rem.Sign() != 0 {
				return fmt.Sprintf("%s reserve %s %s=%s price=%s 10^%d remainder=%s",
					subject, rv.Asset.Hex(), leg.name, leg.bal, rv.Price.Value, rv.Decimals, rem)
			}
		}
	}
	return ""
}

// aavePriceDecimalsFromRegistry reads the claimed adapter price scale. It is a
// CLAIM (frameCommitted); the weld against totalCollateralBase is what tests it.
func aavePriceDecimalsFromRegistry(c *p3Ctx) uint8 {
	for _, a := range c.reg.Aave {
		if a.OracleKind == "poll" && a.PriceDecimals > 0 {
			return uint8(a.PriceDecimals)
		}
	}
	return 8
}

func bigFromUint(v uint64) *big.Int { return new(big.Int).SetUint64(v) }

func orZeroBig(v *big.Int) *big.Int {
	if v == nil {
		return new(big.Int)
	}
	return v
}

func pow10Big(n uint8) *big.Int {
	return new(big.Int).Exp(big.NewInt(10), big.NewInt(int64(n)), nil)
}

// sortAddrSlice keeps address slices deterministic where a map was the source.
func sortAddrSlice(in []common.Address) []common.Address {
	out := append([]common.Address{}, in...)
	sort.Slice(out, func(i, j int) bool { return out[i].Hex() < out[j].Hex() })
	return out
}
