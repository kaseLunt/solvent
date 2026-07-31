// The Wave-H3 RETROACTIVE CLASSIFICATION — the empirical half of the
// boolean-leg ruling: the two accept-r5 liquidatable false positives
// (margins $15.08 / $70.84), re-adjudicated under the adjudicated three-state
// law by running the NEW conjunct reads live at the accept-r5 pins (both
// deep-finalized, hash-anchored — the same experiment completed).
//
// Per account, ALL of:
//
//	(i)   the sample-gap certificate re-proven: the persisted vector at
//	      S(account) recovered from the snapshots HISTORY table (ApplySweepBatch
//	      wrote it atomically with the balances; the sweeper has long re-swept
//	      the live rows), byte-compared against collateralOf@blockHash(S), and
//	      the scalar law recompute bit-exact at S;
//	(ii)  debt exact at pin: our fold@P bridged through getCurrentIndex@P welds
//	      borrowingOf(user).total@pinHash, and reproduces the artifact's number;
//	(iii) the S-CLOCK BOOLEAN CUSTODY WELD: ComputeDMHealth over ALL inputs at
//	      S (Stage-A-shaped debt fold at S bridged through getCurrentIndex@S,
//	      the persisted vector, params re-cut <= S, engine prices @S) welded
//	      bit-exact against liquidatable(user)@blockHash(S);
//	(iv)  the Law@P PIN-VECTOR SUBSTITUTION: collateralOf(user)@pinHash — the
//	      chain's own enumerated netted vector — with the scalar AND boolean
//	      recomputed over it (pinned prices/params/decimals, welded debt@P)
//	      welding getMaxBorrowAmount@P and liquidatable@P bit-exact, and the
//	      per-token LT-weighted delta reconciling to the flip;
//	(v)   the sweep age inside the run's own resolved freshness bound
//	      (3h4m34s, the daemon-cadence policy bound the artifact records).
//
// The test then feeds the assembled facts to classifyDMBoolean — the SAME
// pure classifier the gate runs — and requires boundary-crossing-motion
// (false-positive-at-pin) for BOTH accounts. Any conjunct failing fails this
// test loudly, naming the account and the conjunct: that outcome would mean
// the accept-r5 rows were REAL drift and the ruling's empirical premise is
// wrong.
//
// Opt-in: SOLVENT_H3_RETRO=1, SOLVENT_RECON_RPC_OP (or SOLVENT_RPC_OP), and
// the repo config's database (STRICTLY read-only DSN, exactly as reconcile
// derives it). ~15 archive calls per account, all hash-anchored.
package main

import (
	"context"
	"fmt"
	"math/big"
	"os"
	"sort"
	"testing"
	"time"

	"github.com/ethereum/go-ethereum/common"
	"github.com/stretchr/testify/require"

	"github.com/kaselunt/solvent/internal/risk"
	"github.com/kaselunt/solvent/internal/riskfeed"
	"github.com/kaselunt/solvent/internal/store"
)

// The accept-r5 (aborted, retained, superseded) run's identity and the two
// subject rows, verbatim from its artifact (comparison 4fb7b0ac…).
const (
	h3RetroPinOP         = uint64(154963224)
	h3RetroHashOP        = "0x5c6be10c38b31e7b2f70a0b7681d83e3cc5a7c80727027bac64e316658528aeb"
	h3RetroBudgetSeconds = int64(3*3600 + 4*60 + 34) // the run's resolved bound 3h4m34s (daemon-cadence policy)
)

type h3RetroSubject struct {
	addr     string
	sweep    uint64 // S(account) from the artifact's sample-gap evidence
	sweepHex string // own_clock_hash from the artifact
	chainMax string // getMaxBorrowAmount@P (chain)
	oursMax  string // our mixed recompute @P over the S vector
	debtPin  string // borrowingOf.total@P == our bridged fold (welded exact)
	margin   string // |debt - oursMax| mixed, USD-6
}

var h3RetroSubjects = []h3RetroSubject{
	{
		addr:  "0xc1511991079ADaFf9E20B0e356e97ABd59c0FADB",
		sweep: 154961846, sweepHex: "0x9ce1754570f315fcc2f37408bea0fe5caf11c80b75b9211548e77edecd2fc50c",
		chainMax: "53950439", oursMax: "21858263", debtPin: "36933818", margin: "15075555",
	},
	{
		addr:  "0xcc22486026C6924C11593b6B5Dd1B5B2bde7bAd0",
		sweep: 154961887, sweepHex: "0xd7c67d669b413503bc12f2a0ac0c5bd89c6dec2656d59987b39bc5453abbf79c",
		chainMax: "367300276", oursMax: "171800821", debtPin: "242641955", margin: "70841134",
	},
}

func TestWaveH3RetroactiveBooleanClassification(t *testing.T) {
	if os.Getenv("SOLVENT_H3_RETRO") == "" {
		t.Skip("SOLVENT_H3_RETRO unset: the retroactive boolean classification is opt-in (live DB SELECT-only + deep-archive RPC at the accept-r5 pins)")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Minute)
	defer cancel()
	conn := refuteDB(t, ctx)
	r := liveReader(t, "op", "SOLVENT_RECON_RPC_OP", "SOLVENT_RPC_OP")
	hashOP := common.HexToHash(h3RetroHashOP)

	c := &p3Ctx{
		o: &options{}, opR: r, pinOP: h3RetroPinOP, hashOP: hashOP,
		dmProxy: liveDMProxy, frames: &frameSet{}, now: time.Now().UTC(),
	}
	universe, borrowTokens, _, err := readDMTokenUniverse(ctx, c)
	require.NoError(t, err)
	decimals, pinPrices, pinIndexes, _, err := readDMTokenState(ctx, c, universe, borrowTokens)
	require.NoError(t, err)

	params, err := store.DMParamsAsOf(ctx, conn, h3RetroPinOP)
	require.NoError(t, err)
	foldedPin, err := riskfeed.FoldParams(dmEngine, 10, params)
	require.NoError(t, err)

	pinTime, _, err := r.headerTime(ctx, h3RetroPinOP)
	require.NoError(t, err)

	// A pin-price recompute over an arbitrary (token → amount) vector, the
	// gate's own shape.
	recompute := func(account common.Address, debt *big.Int, vec map[common.Address]*big.Int,
		prices map[common.Address]*big.Int, folded []risk.ParamRow, block uint64) (risk.DMHealth, error) {
		in := risk.DMInput{
			Account: account, DebtUSD: debt, Params: folded,
			Marks: risk.Watermarks{BalancesBlock: block, ParamsBlock: block, SweepBlock: block},
		}
		toks := make([]common.Address, 0, len(vec))
		for tok := range vec {
			toks = append(toks, tok)
		}
		toks = sortAddrSlice(toks)
		for _, tok := range toks {
			dec, okDec := decimals[tok]
			p := prices[tok]
			if !okDec || p == nil {
				return risk.DMHealth{}, fmt.Errorf("token %s has no price/decimals at the requested clock", tok.Hex())
			}
			in.Collateral = append(in.Collateral, risk.DMCollateral{Asset: tok, Amount: vec[tok], Decimals: dec})
			in.Prices = append(in.Prices, risk.PriceInput{
				ChainID: 10, Asset: tok, Source: "dm:convertCollateralTokenToUsd@h3retro", Block: block,
				Value: p, Decimals: 6, Provenance: risk.ProvenanceEngineExact, Fresh: true,
			})
		}
		return risk.ComputeDMHealth(in)
	}

	debtFold := func(account common.Address, upTo uint64) map[common.Address]*big.Int {
		rows, err := conn.Query(ctx, `
			SELECT encode(asset,'hex'), COALESCE(SUM(delta),0)::text
			FROM position_events
			WHERE engine = 'debt_manager' AND chain_id = 10 AND side = 'debt'
			  AND delta IS NOT NULL AND account = $1 AND block_number <= $2
			GROUP BY 1`, account.Bytes(), int64(upTo))
		require.NoError(t, err)
		defer rows.Close()
		out := map[common.Address]*big.Int{}
		for rows.Next() {
			var assetHex, sum string
			require.NoError(t, rows.Scan(&assetHex, &sum))
			v, ok := new(big.Int).SetString(sum, 10)
			require.True(t, ok)
			if v.Sign() != 0 {
				out[common.HexToAddress("0x"+assetHex)] = v
			}
		}
		require.NoError(t, rows.Err())
		return out
	}

	for _, sub := range h3RetroSubjects {
		sub := sub
		t.Run(sub.addr, func(t *testing.T) {
			addr := common.HexToAddress(sub.addr)
			wantChainMax, _ := new(big.Int).SetString(sub.chainMax, 10)
			wantOursMax, _ := new(big.Int).SetString(sub.oursMax, 10)
			wantDebt, _ := new(big.Int).SetString(sub.debtPin, 10)

			// --- the persisted vector at S, from the snapshots HISTORY table ---
			var histBlock int64
			var doc map[string]any
			require.NoError(t, conn.QueryRow(ctx, `
				SELECT block_number, balances FROM snapshots
				WHERE engine='debt_manager' AND side='collateral' AND account=$1
				  AND block_number <= $2
				ORDER BY block_number DESC LIMIT 1`, addr.Bytes(), int64(h3RetroPinOP)).Scan(&histBlock, &doc))
			require.Equal(t, sub.sweep, uint64(histBlock),
				"the newest history document at or below the pin must sit at the artifact's own S")
			inner, ok := doc["balances"].(map[string]any)
			require.True(t, ok)
			persisted := map[common.Address]*big.Int{}
			for assetHex, amt := range inner {
				s, ok := amt.(string)
				require.True(t, ok)
				v, ok := new(big.Int).SetString(s, 10)
				require.True(t, ok)
				if v.Sign() > 0 {
					persisted[common.HexToAddress("0x"+assetHex)] = v
				}
			}

			// --- pin-clock reads: liquidatable, maxBorrow, borrowingOf, collateralOf ---
			var pinCalls []multicallCall
			for _, m := range []struct {
				abiName string
			}{{"liquidatable"}, {"getMaxBorrowAmount"}, {"borrowingOf"}, {"collateralOf"}} {
				var d []byte
				var err error
				switch m.abiName {
				case "liquidatable":
					d, err = dmLiquidatableABI.Pack("liquidatable", addr)
				case "getMaxBorrowAmount":
					d, err = dmGetMaxBorrowAmountABI.Pack("getMaxBorrowAmount", addr, false)
				case "borrowingOf":
					d, err = dmBorrowingOfAllABI.Pack("borrowingOf", addr)
				case "collateralOf":
					d, err = dmCollateralOfABI.Pack("collateralOf", addr)
				}
				require.NoError(t, err)
				pinCalls = append(pinCalls, multicallCall{Target: c.dmProxy, CallData: d})
			}
			pres, _, err := r.multicall(ctx, "h3retro:pin:"+sub.addr, h3RetroPinOP, hashOP, pinCalls)
			require.NoError(t, err)
			for i := range pres {
				require.True(t, pres[i].Success, "pin read %d must answer", i)
			}
			chainLiqP, err := unpackBoolStrict(dmLiquidatableABI, "liquidatable", pres[0].ReturnData)
			require.NoError(t, err)
			chainMaxP, err := unpackUint256Strict(dmGetMaxBorrowAmountABI, "getMaxBorrowAmount", pres[1].ReturnData)
			require.NoError(t, err)
			_, chainDebtP, err := unpackTokenAmountList(dmBorrowingOfAllABI, "borrowingOf", pres[2].ReturnData)
			require.NoError(t, err)
			pinVecList, _, err := unpackTokenAmountList(dmCollateralOfABI, "collateralOf", pres[3].ReturnData)
			require.NoError(t, err)

			require.False(t, chainLiqP, "the chain refused the alert at the pin — the false-positive premise")
			require.Zero(t, chainMaxP.Cmp(wantChainMax), "getMaxBorrowAmount@P must reproduce the artifact (hash-anchored: the same experiment)")
			require.Zero(t, chainDebtP.Cmp(wantDebt), "borrowingOf.total@P must reproduce the artifact")

			// --- conjunct (ii): debt exact at pin, re-derived from custody ---
			foldP := debtFold(addr, h3RetroPinOP)
			ourDebtP := new(big.Int)
			for tok, n := range foldP {
				idx := pinIndexes[tok]
				require.NotNil(t, idx, "pinned getCurrentIndex for %s", tok.Hex())
				ourDebtP.Add(ourDebtP, mulDivFloor(n, idx))
			}
			require.Zero(t, ourDebtP.Cmp(chainDebtP),
				"conjunct (ii): our fold@P bridged through getCurrentIndex@P must weld borrowingOf.total EXACT")

			// --- the served MIXED verdict reproduced (debt@P over vector@S) ---
			hMixed, err := recompute(addr, ourDebtP, persisted, pinPrices, foldedPin, h3RetroPinOP)
			require.NoError(t, err)
			require.Zero(t, hMixed.MaxBorrowLT.Cmp(wantOursMax), "the mixed recompute must reproduce the artifact's actual_derived")
			require.True(t, hMixed.Liquidatable, "the served mixed verdict was TRUE — the flip under adjudication")
			margin := new(big.Int).Abs(new(big.Int).Sub(hMixed.Borrowings, hMixed.MaxBorrowLT))
			require.Equal(t, sub.margin, margin.String(), "the artifact's margin reproduces")

			// --- S-clock reads: the (i)+(iii) conjuncts ---
			hashS, _, err := r.headerHash(ctx, sub.sweep)
			require.NoError(t, err)
			require.Equal(t, sub.sweepHex, hashS.Hex(), "S resolves to the artifact's own_clock_hash (deep-finalized)")
			sTime, _, err := r.headerTime(ctx, sub.sweep)
			require.NoError(t, err)
			ageSeconds := int64(pinTime) - int64(sTime)

			foldS := debtFold(addr, sub.sweep)
			var sCalls []multicallCall
			d, err := dmLiquidatableABI.Pack("liquidatable", addr)
			require.NoError(t, err)
			sCalls = append(sCalls, multicallCall{Target: c.dmProxy, CallData: d})
			d, err = dmGetMaxBorrowAmountABI.Pack("getMaxBorrowAmount", addr, false)
			require.NoError(t, err)
			sCalls = append(sCalls, multicallCall{Target: c.dmProxy, CallData: d})
			d, err = dmCollateralOfABI.Pack("collateralOf", addr)
			require.NoError(t, err)
			sCalls = append(sCalls, multicallCall{Target: c.dmProxy, CallData: d})
			var sTokens []common.Address
			for tok := range persisted {
				sTokens = append(sTokens, tok)
			}
			sTokens = sortAddrSlice(sTokens)
			for _, tok := range sTokens {
				d, err = dmConvertCollateralToUsdABI.Pack("convertCollateralTokenToUsd", tok, pow10Big(decimals[tok]))
				require.NoError(t, err)
				sCalls = append(sCalls, multicallCall{Target: c.dmProxy, CallData: d})
			}
			var sIdxTokens []common.Address
			for tok := range foldS {
				sIdxTokens = append(sIdxTokens, tok)
			}
			sIdxTokens = sortAddrSlice(sIdxTokens)
			for _, tok := range sIdxTokens {
				d, err = dmGetCurrentIndexABI.Pack("getCurrentIndex", tok)
				require.NoError(t, err)
				sCalls = append(sCalls, multicallCall{Target: c.dmProxy, CallData: d})
			}
			sres, _, err := r.multicall(ctx, "h3retro:S:"+sub.addr, sub.sweep, hashS, sCalls)
			require.NoError(t, err)
			for i := range sres {
				require.True(t, sres[i].Success, "S read %d must answer", i)
			}
			chainLiqS, err := unpackBoolStrict(dmLiquidatableABI, "liquidatable", sres[0].ReturnData)
			require.NoError(t, err)
			chainMaxS, err := unpackUint256Strict(dmGetMaxBorrowAmountABI, "getMaxBorrowAmount", sres[1].ReturnData)
			require.NoError(t, err)
			vecS, _, err := unpackTokenAmountList(dmCollateralOfABI, "collateralOf", sres[2].ReturnData)
			require.NoError(t, err)
			pricesS := map[common.Address]*big.Int{}
			for i, tok := range sTokens {
				v, err := unpackUint256Strict(dmConvertCollateralToUsdABI, "convertCollateralTokenToUsd", sres[3+i].ReturnData)
				require.NoError(t, err)
				pricesS[tok] = v
			}
			idxS := map[common.Address]*big.Int{}
			for i, tok := range sIdxTokens {
				v, err := unpackUint256Strict(dmGetCurrentIndexABI, "getCurrentIndex", sres[3+len(sTokens)+i].ReturnData)
				require.NoError(t, err)
				idxS[tok] = v
			}

			// Conjunct (i): the vector certificate + the scalar law at S.
			match, diff := compareDMCollateralVector(vecS, persisted)
			require.True(t, match, "conjunct (i): collateralOf@S must be byte-identical to the persisted document — %s", diff)
			var cutS []store.ParamRow
			for _, pr := range params {
				if pr.EffectiveBlock <= sub.sweep {
					cutS = append(cutS, pr)
				}
			}
			foldedS, err := riskfeed.FoldParams(dmEngine, 10, cutS)
			require.NoError(t, err)
			debtS := new(big.Int)
			for tok, n := range foldS {
				require.NotNil(t, idxS[tok], "getCurrentIndex@S for %s", tok.Hex())
				debtS.Add(debtS, mulDivFloor(n, idxS[tok]))
			}
			hS, err := recompute(addr, debtS, persisted, pricesS, foldedS, sub.sweep)
			require.NoError(t, err)
			require.Zero(t, hS.MaxBorrowLT.Cmp(chainMaxS),
				"conjunct (i): the scalar law recompute at S must weld getMaxBorrowAmount@S bit-exact")

			// The maxBorrow leg through the gate's OWN classifier: sample-gap.
			ownRes := &dmOwnClockResult{
				Block: sub.sweep, Hash: hashS,
				ChainMax: chainMaxS, OurMax: hS.MaxBorrowLT,
				VectorRead: true, VectorMatch: true, VectorLegs: len(persisted),
				BoolRead: true, ChainLiqS: chainLiqS,
				OursLiqComputed: true, OursLiqS: hS.Liquidatable, DebtUSDAtS: debtS,
				AgeKnown: true, AgeSeconds: ageSeconds,
			}
			maxVerdict, maxClass := classifyDMMaxBorrow(chainMaxP, hMixed.MaxBorrowLT, ownRes)
			require.Equal(t, verdictSampleGap, maxVerdict, "conjunct (i): the leg classifies sample-gap (class %s)", maxClass)

			// Conjunct (iii): the S-clock boolean custody weld.
			require.Equal(t, chainLiqS, hS.Liquidatable,
				"conjunct (iii): ComputeDMHealth over ALL inputs at S must weld liquidatable@S bit-exact — a failure here over the passing certificate is the ESCALATION arm")

			// Conjunct (iv): the pin-vector substitution.
			pinVec := map[common.Address]*big.Int{}
			for _, e := range pinVecList {
				if e.Amount != nil && e.Amount.Sign() > 0 {
					if prev, ok := pinVec[e.Token]; ok {
						pinVec[e.Token] = new(big.Int).Add(prev, e.Amount)
					} else {
						pinVec[e.Token] = new(big.Int).Set(e.Amount)
					}
				}
			}
			hP, err := recompute(addr, chainDebtP, pinVec, pinPrices, foldedPin, h3RetroPinOP)
			require.NoError(t, err)
			scalarWeld := hP.MaxBorrowLT.Cmp(chainMaxP) == 0
			boolWeld := hP.Liquidatable == chainLiqP
			require.True(t, scalarWeld, "conjunct (iv): the scalar over the chain's own pin vector must reproduce getMaxBorrowAmount@P (got %s want %s)", hP.MaxBorrowLT, chainMaxP)
			require.True(t, boolWeld, "conjunct (iv): the boolean over the chain's own pin vector must reproduce liquidatable@P")

			contribP := map[common.Address]*big.Int{}
			for _, cv := range hP.Collateral {
				contribP[cv.Asset] = cv.MaxBorrowContribution
			}
			contribS := map[common.Address]*big.Int{}
			for _, cv := range hMixed.Collateral {
				contribS[cv.Asset] = cv.MaxBorrowContribution
			}
			union := map[common.Address]bool{}
			for tok := range contribP {
				union[tok] = true
			}
			for tok := range contribS {
				union[tok] = true
			}
			sum := new(big.Int)
			var ledger []string
			for _, tok := range sortedAddrs(union) {
				dlt := new(big.Int).Sub(orZeroBig(contribP[tok]), orZeroBig(contribS[tok]))
				sum.Add(sum, dlt)
				if dlt.Sign() != 0 {
					ledger = append(ledger, fmt.Sprintf("%s: Δ %s USD-6", tok.Hex(), dlt))
				}
			}
			sort.Strings(ledger)
			reconciles := sum.Cmp(new(big.Int).Sub(chainMaxP, hMixed.MaxBorrowLT)) == 0
			require.True(t, reconciles, "conjunct (iv): Σ per-token deltas (%s) must equal chainMax@P − ourMax(mixed) (%s)",
				sum, new(big.Int).Sub(chainMaxP, hMixed.MaxBorrowLT))

			// Conjunct (v): the freshness budget.
			require.Positive(t, ageSeconds)
			require.LessOrEqual(t, ageSeconds, h3RetroBudgetSeconds,
				"conjunct (v): the sweep age must sit inside the run's resolved bound")

			// --- THE CLASSIFICATION, through the gate's own pure law ---
			fx := dmBooleanFacts{
				Ours: hMixed.Liquidatable, Chain: chainLiqP,
				MaxBorrowLegVerdict: maxVerdict,
				DebtExactAtPin:      true,
				Own:                 ownRes,
				PinVec: &dmPinVectorResult{
					Read: true, ScalarP: hP.MaxBorrowLT, BoolP: hP.Liquidatable,
					ScalarWeld: scalarWeld, BoolWeld: boolWeld,
					PerTokenDeltas: ledger, DeltaSum: sum, Reconciles: reconciles,
				},
				BudgetSeconds: h3RetroBudgetSeconds,
			}
			verdict, class, gated, reasons := classifyDMBoolean(fx)
			require.Equal(t, verdictBoundaryMotion, verdict,
				"THE HEADLINE: the accept-r5 row must classify MOTION under the union law (reasons: %v)", reasons)
			require.False(t, gated)
			require.Contains(t, class, dmDirectionFalsePositive)

			t.Logf("%s: MOTION PROVEN — verdict triangle served(mixed)=%v chain@pin=%v chain@S=%v; margins: mixed %s, @P(chain) %s, @S %s USD-6; sweep age %d blocks / %ds (budget %ds); Σ motion %s over %d token(s): %v",
				sub.addr, hMixed.Liquidatable, chainLiqP, chainLiqS,
				margin, new(big.Int).Sub(chainDebtP, chainMaxP), new(big.Int).Sub(debtS, hS.MaxBorrowLT),
				h3RetroPinOP-sub.sweep, ageSeconds, h3RetroBudgetSeconds, sum, len(ledger), ledger)
		})
	}
}
