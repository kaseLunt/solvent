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
// Collateral flags are a PINNED getUserConfiguration read this task
// (chain-truth R5.5): the event-derived flag witness is the collateral-flag
// micro-wave's deliverable, is not in custody yet at this HEAD, and consuming
// riskd's assume-true posture here would weld our own guess.
package main

import (
	"context"
	"encoding/hex"
	"fmt"
	"math/big"
	"sort"

	"github.com/ethereum/go-ethereum/common"

	"github.com/kaselunt/solvent/cmd/reconcile/snapshotdb"
	"github.com/kaselunt/solvent/internal/risk"
	"github.com/kaselunt/solvent/internal/riskfeed"
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
			"the collateral flags. THIS TASK's authoritative source (chain-truth R5.5); it becomes the WELD PARTNER for the event-derived flag once the collateral-flag micro-wave lands"),
		pinned("Pool.getUserEMode(user)@pinHash(P_eth)",
			"asserted == 0 per cohort account and GATED: a nonzero category means the whole HF branch is the wrong law, which is a failure, not a skip"),
		pinned("Pool.getUserAccountData(user)@pinHash(P_eth)",
			"the CHAIN side of the weld — the expected side of every leg"),
		committed("recon/feeds.json aaveoracle priceDecimals",
			"the base-currency scale (8) the price inputs are tagged with. It is a CLAIM, and the weld is what tests it: a wrong scale cannot produce an exact totalCollateralBase"),
		committed("recon/feeds.json asset decimals (Aave reserves)",
			"welded against Pool.getConfiguration's decimals bits — a wrong 10^dec denominator is a 10^n price error, not a rounding difference (risk-quant R4.5)"),
		committed("never-seen subject list (sha256 of "+neverSeenSeed+"|i, first 20 bytes)",
			"the empty-set probe cohort, reproducible from the repository alone"),
	)
}

// aaveCohort is the gate's membership, built from the derived census.
type aaveCohort struct {
	Finite    []common.Address
	ZeroDebt  []common.Address
	NeverSeen []common.Address
	// Control is a known-NONZERO subject included in every all-zero multicall
	// chunk (chain-truth R1.4): a chunk of all zeros with no nonzero control is
	// testimony indistinguishable from a lying default.
	Control      common.Address
	HasControl   bool
	CensusFinite int
	CensusZero   int
}

// buildAaveCohort assembles the cohort from the derived census. Membership is
// ALL finite-HF borrowers (never a sample of them — the population is 12), the
// first aaveZeroDebtFloor+ zero-debt subjects in census order, and the
// committed never-seen list. Order is the census's own deterministic order, so
// the cohort is reproducible without a seed.
func buildAaveCohort(t6 *snapshotdb.Task6Data) aaveCohort {
	c := aaveCohort{CensusFinite: len(t6.AaveBorrowerCensus), CensusZero: len(t6.AaveZeroDebtCensus)}
	for _, a := range t6.AaveBorrowerCensus {
		c.Finite = append(c.Finite, common.HexToAddress(a))
	}
	for _, a := range t6.AaveZeroDebtCensus {
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
		config    aaveReserveConfig
		income    *big.Int
		varDebt   *big.Int
		price     *big.Int
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
	}
	res, _, err := c.ethR.multicall(ctx, "p3:aave:reserveState", c.pinETH, c.hashETH, calls)
	if err != nil {
		return nil, aavePhaseErr(err)
	}
	for i, tg := range tags {
		st := states[tg.reserve]
		if !res[i].Success {
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
	measured := append(append([]common.Address{}, cohort.Finite...), cohort.ZeroDebt...)
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

	for _, acct := range measured {
		key := hex.EncodeToString(acct.Bytes())
		subject := acct.Hex()
		if note, bad := accountNotes[acct]; bad {
			rows = append(rows, unreadRow(gateAaveHF, subject, "account-state", note))
			continue
		}
		chainData := accountData[acct]
		cfgBits := userConfig[acct]

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

	// ---- cohort floors, census-welded --------------------------------------
	rows = append(rows, cohortFloorRow(gateAaveHF, "aave-finite-hf-borrowers",
		len(cohort.Finite), cohort.CensusFinite, aaveFiniteBackstop,
		fmt.Sprintf("membership is ALL finite-HF borrowers, not a sample: the derived census at P_eth is %d accounts with nonzero scaled debt. The plan's original >=20 was refuted by the chain (12 finite-HF borrowers) and both consults ruled a floor no honest run can meet a custody hazard rather than a strengthening (chain-truth R5.1). finite=%d infinite/zero-debt=%d",
			cohort.CensusFinite, cohort.CensusFinite, cohort.CensusZero)))
	rows = append(rows, cohortFloorRow(gateAaveHF, "aave-zero-debt(marker mapping)",
		len(cohort.ZeroDebt), aaveZeroDebtFloor, aaveZeroDebtFloor,
		fmt.Sprintf("accounts with positive derived collateral and no positive debt leg; each welds the marker<->type(uint256).max mapping explicitly. Derived census: %d candidates", cohort.CensusZero)))

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
