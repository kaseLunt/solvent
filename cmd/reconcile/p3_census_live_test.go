package main

// The Aave HF gate's CENSUS weld, live, over ALL TWELVE finite-HF borrowers
// (risk-quant R3: the cohort IS the population, never a sample of it).
//
// It welds the seven components internal/risk computes against
// getUserAccountData at the run pin, bit-exact and tolerance zero, with every
// index and price read AT THE PIN (risk-quant R1's declared frame). It also
// classifies a one-sided debt miss against a CEILING base-currency conversion,
// because a systematic one-sided miss is a LAW finding rather than a rounding
// difference — and a law finding needs the count, not an anecdote.
//
// Opt-in through the same SOLVENT_P3_LIVE pair as p3_live_test.go.

import (
	"context"
	"math/big"
	"testing"
	"time"

	"github.com/ethereum/go-ethereum/common"
	"github.com/stretchr/testify/require"

	"github.com/kaselunt/solvent/internal/risk"
)

// The four reserves the Pool has ever initialised (recon/p3-probes.md).
const (
	weethHex = "0xCd5fE23C85820F7B72D0926FC9b05b43E359b7ee"
	usdcHex  = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48"
	fraxHex  = "0x853d955aCEf822Db058eb8505911ED77F175b99e"
	pyusdHex = "0x6c3ea9036406852006290770BEdFcAbA0e23A0e8"
)

// liveAaveBorrower is one census member's DERIVED-UNDER-TEST scaled balances,
// hard-coded from a read-only SELECT over position_balances (source=event) so the
// weld is a real comparison rather than a tautology over whatever the database
// holds at run time. Aave balances move only on Pool events and this book has
// been quiet, so a leg that HAS since moved surfaces as a collateral mismatch
// rather than as a silent pass.
type liveAaveBorrower struct {
	account string
	scaled  map[string][2]string // reserve hex -> [scaledDebt, scaledCollateral]
}

// liveAaveCensus is ALL TWELVE finite-HF borrowers at the observed pin.
var liveAaveCensus = []liveAaveBorrower{
	{"0x0319bc4625896d0d8dd3c2d4c3fff7b5d611da44", map[string][2]string{
		weethHex: {"0", "50000000000000000"}, usdcHex: {"48039809", "0"}}},
	{"0x07132f1829f05925f80da33afb21b3d3af4a0a16", map[string][2]string{
		weethHex: {"0", "2594742446582019444"}, usdcHex: {"1805144685", "0"}}},
	{"0x0f2a32f4f54ec9d52a193e9e3493fb5fea86cbbe", map[string][2]string{
		weethHex: {"0", "25000000000000000"}, fraxHex: {"999684360900721725", "531518777687504"}}},
	{"0x121c5314a6ddadea5087c36cf4e2a315cf31597d", map[string][2]string{
		weethHex: {"0", "554876157816416097"}, usdcHex: {"495652277", "0"}}},
	{"0x35f79e4934f6fdf80b2f20316e9e098410652b13", map[string][2]string{
		weethHex: {"0", "10000000000000000"}, usdcHex: {"899720", "0"}}},
	{"0x58f2aa5b752e284c45894ab0d435d0d53a8794cc", map[string][2]string{
		weethHex: {"0", "1904748544591569"}, usdcHex: {"0", "3000000"},
		fraxHex: {"500000000000000000", "0"}}},
	{"0x70daaac436465a0d03e45916fa68ddee6086e5fe", map[string][2]string{
		weethHex: {"0", "58420665095130"}, usdcHex: {"125415", "0"}}},
	{"0x80b3153f39aeec1ef68adc038913698e103e6e1d", map[string][2]string{
		weethHex: {"0", "30578709992554"}, fraxHex: {"102248215580140429", "0"}}},
	{"0x849b5e5116f1c3e8adeb8ef85562233cce4c696b", map[string][2]string{
		weethHex: {"0", "47475903460681"}, fraxHex: {"93397950466494289", "0"}}},
	{"0xe649a394fb16b58ee2e59feb2ea571e7733c812a", map[string][2]string{
		weethHex: {"0", "7045575913579"}, pyusdHex: {"83", "0"}}},
	{"0xf6ce8f4d9af917823fee582298810e4f0d947e0e", map[string][2]string{
		weethHex: {"0", "257573847593987775"}, fraxHex: {"244495570517561770611", "0"}}},
	{"0xfff68a87b36fb5634456346cb39256f13ca97a21", map[string][2]string{
		weethHex: {"0", "35133988020193047"}, fraxHex: {"53894913056166", "0"}}},
}

func TestLiveAaveCensusWeldOverEveryFiniteHFBorrower(t *testing.T) {
	requireLive(t)
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Minute)
	defer cancel()
	r := liveReader(t, "eth", "SOLVENT_RECON_RPC_ETH", "SOLVENT_RPC_ETH")

	pin := livePin(t, "SOLVENT_P3_LIVE_PIN_ETH", 25643189)
	hash, _, err := r.headerHash(ctx, pin)
	require.NoError(t, err, "pin header hash")
	t.Logf("ETH pin %d hash %s", pin, hash.Hex())

	rlData, err := poolReservesListABI.Pack("getReservesList")
	require.NoError(t, err)
	rlRet, _, err := r.callAtHash(ctx, "live:getReservesList", liveAavePool, rlData, hash)
	require.NoError(t, err)
	reserves, err := unpackAddressListStrict(poolReservesListABI, "getReservesList", rlRet)
	require.NoError(t, err)
	t.Logf("CHAIN reserve enumeration at the pin: %d", len(reserves))

	states := readLiveReserveStates(ctx, t, r, reserves, pin, hash)
	for _, res := range reserves {
		st := states[res]
		t.Logf("  reserve %s dec=%d ltBps=%s ltvBps=%s income=%s varDebt=%s price=%s",
			res.Hex(), st.cfg.Decimals, st.cfg.LiquidationThresholdBps, st.cfg.LTVBps,
			st.income, st.varDebt, st.price)
	}

	// Per-account pinned reads, batched.
	var calls []multicallCall
	type atag struct {
		kind string
		acct common.Address
	}
	var atags []atag
	for _, b := range liveAaveCensus {
		acct := common.HexToAddress(b.account)
		for _, spec := range []struct {
			kind string
			data []byte
		}{
			{"accountData", mustPack(t, poolUserAccountDataABI, "getUserAccountData", acct)},
			{"userConfig", mustPack(t, poolUserConfigurationABI, "getUserConfiguration", acct)},
			{"eMode", mustPack(t, poolUserEModeABI, "getUserEMode", acct)},
		} {
			calls = append(calls, multicallCall{Target: liveAavePool, CallData: spec.data})
			atags = append(atags, atag{spec.kind, acct})
		}
	}
	res, _, err := r.multicall(ctx, "live:accounts", pin, hash, calls)
	require.NoError(t, err, "the multicall's IN-BAND block equality is part of what this asserts")
	chainData := map[common.Address]userAccountData{}
	userCfg := map[common.Address]*big.Int{}
	eMode := map[common.Address]*big.Int{}
	for i, tg := range atags {
		require.True(t, res[i].Success, "%s for %s reverted at the pin", tg.kind, tg.acct.Hex())
		switch tg.kind {
		case "accountData":
			v, uerr := unpackUserAccountData(res[i].ReturnData)
			require.NoError(t, uerr)
			chainData[tg.acct] = v
		case "userConfig":
			v, uerr := unpackPackedUint256Struct(poolUserConfigurationABI, "getUserConfiguration", res[i].ReturnData)
			require.NoError(t, uerr)
			userCfg[tg.acct] = v
		case "eMode":
			v, uerr := unpackUint256Strict(poolUserEModeABI, "getUserEMode", res[i].ReturnData)
			require.NoError(t, uerr)
			eMode[tg.acct] = v
		}
	}

	var collExact, debtExact, hfExact, ltExact int
	var debtMatchesCeil, debtMatchesNeither int
	var sharpness string
	for _, b := range liveAaveCensus {
		acct := common.HexToAddress(b.account)
		require.Equal(t, "0", eMode[acct].String(),
			"%s: eMode must be 0 — a nonzero category is a GATED failure, never a skip", b.account)

		in := risk.AaveInput{
			Account: acct, EMode: 0, Regime: risk.RegimeAtBlock(pin),
			Marks: risk.Watermarks{BalancesBlock: pin, ParamsBlock: pin},
		}
		for i, reserve := range reserves {
			st := states[reserve]
			legs := b.scaled[reserve.Hex()]
			sd, sc := new(big.Int), new(big.Int)
			if legs[0] != "" {
				sd = mustBig(legs[0])
			}
			if legs[1] != "" {
				sc = mustBig(legs[1])
			}
			flags := decodeAaveUserConfiguration(userCfg[acct], i)
			in.Reserves = append(in.Reserves, risk.AaveReserve{
				Asset: reserve, Decimals: st.cfg.Decimals,
				ScaledDebt: sd, ScaledCollateral: sc,
				DebtIndex: st.varDebt, CollateralIndex: st.income,
				IndexBlock: pin, UsedAsCollateral: flags.UsedAsCollateral,
			})
			in.Prices = append(in.Prices, risk.PriceInput{
				ChainID: 1, Asset: reserve, Source: "aaveoracle@pin", Block: pin,
				Value: st.price, Decimals: 8, Provenance: risk.ProvenanceAdapterOutput, Fresh: true,
			})
			in.Params = append(in.Params, risk.ParamRow{
				Engine: risk.AaveParamEngine, ChainID: 1, Asset: reserve,
				LTV: st.cfg.LTVBps, LiqThreshold: st.cfg.LiquidationThresholdBps,
				LiqBonus: st.cfg.LiquidationBonusBps, EffectiveBlock: pin,
			})
		}
		got, cerr := risk.ComputeAaveHealth(in)
		require.NoError(t, cerr, "%s: internal/risk refused to compute over the declared frame", b.account)

		cd := chainData[acct]
		okColl := cd.TotalCollateralBase.Cmp(got.TotalCollateralBase) == 0
		okDebt := cd.TotalDebtBase.Cmp(got.TotalDebtBase) == 0
		okLT := got.AvgLiquidationThresholdBps != nil &&
			cd.CurrentLiquidationThreshold.Cmp(got.AvgLiquidationThresholdBps) == 0
		okHF := got.HealthFactorWad != nil && cd.HealthFactor.Cmp(got.HealthFactorWad) == 0
		if okColl {
			collExact++
		}
		if okDebt {
			debtExact++
		}
		if okLT {
			ltExact++
		}
		if okHF {
			hfExact++
		}

		// Reclassify a debt miss against a CEILING base-currency conversion.
		ceilDebt := new(big.Int)
		for _, rv := range got.Reserves {
			if rv.LiveDebt.Sign() == 0 {
				continue
			}
			den := pow10Big(rv.Decimals)
			num := new(big.Int).Mul(rv.LiveDebt, orZeroBig(rv.Price.Value))
			num.Add(num, new(big.Int).Sub(den, big.NewInt(1)))
			ceilDebt.Add(ceilDebt, num.Quo(num, den))
		}
		switch {
		case okDebt:
		case cd.TotalDebtBase.Cmp(ceilDebt) == 0:
			debtMatchesCeil++
		default:
			debtMatchesNeither++
		}
		t.Logf("%s coll[%v] debt[%v ours=%s chain=%s ceilRederive=%s] currentLT[%v] HF[%v ours=%v chain=%s]",
			b.account, okColl, okDebt, got.TotalDebtBase, cd.TotalDebtBase, ceilDebt,
			okLT, okHF, got.HealthFactorWad, cd.HealthFactor)
		if sharpness == "" {
			sharpness = component4Witness(b.account, got)
		}
	}

	n := len(liveAaveCensus)
	t.Logf("CENSUS WELD over ALL %d finite-HF borrowers at pin %d:", n, pin)
	t.Logf("  totalCollateralBase          EXACT %d/%d", collExact, n)
	t.Logf("  currentLiquidationThreshold  EXACT %d/%d   law: floor(sum(Ci*LTi)/sum(Ci))", ltExact, n)
	t.Logf("  totalDebtBase                EXACT %d/%d   misses: %d reproduce under a CEIL base conversion, %d under neither",
		debtExact, n, debtMatchesCeil, debtMatchesNeither)
	t.Logf("  healthFactor (fused floor)    EXACT %d/%d", hfExact, n)
	t.Logf("  component-4 sharpness witness: %s", sharpness)
	require.NotEmpty(t, sharpness,
		"risk-quant R1's sharpness clause: without a nonzero component-4 remainder the weld cannot distinguish floor from half-up")

	require.Equal(t, n, collExact, "component 5 collateral must be bit-exact for every census member")
	require.Equal(t, n, ltExact, "component 6 must be bit-exact for every census member")
	require.Equal(t, n, debtExact,
		"component 5 DEBT must be bit-exact for every census member; %d of the misses reproduce EXACTLY under a CEILING base-currency conversion, which makes this a LAW finding in internal/risk (component 4 floors the debt leg where the deployed Pool never understates debt in base currency) rather than a rounding difference",
		debtMatchesCeil)
	require.Equal(t, n, hfExact,
		"component 7 must be bit-exact for every census member; an overstated health factor is the FALSE-SAFETY direction")
}

// readLiveReserveStates batches the per-reserve pinned reads.
func readLiveReserveStates(ctx context.Context, t *testing.T, r *pinnedReader,
	reserves []common.Address, pin uint64, hash common.Hash) map[common.Address]*liveReserveState {
	t.Helper()
	states := map[common.Address]*liveReserveState{}
	var calls []multicallCall
	type rtag struct {
		kind string
		res  common.Address
	}
	var rtags []rtag
	for _, res := range reserves {
		for _, spec := range []struct {
			kind   string
			target common.Address
			data   []byte
		}{
			{"config", liveAavePool, mustPack(t, poolGetConfigurationABI, "getConfiguration", res)},
			{"income", liveAavePool, mustPack(t, poolNormalizedIncomeABI, "getReserveNormalizedIncome", res)},
			{"varDebt", liveAavePool, mustPack(t, poolNormalizedDebtABI, "getReserveNormalizedVariableDebt", res)},
			{"price", liveAaveOracle, mustPack(t, aaveOracleGetAssetPriceABI, "getAssetPrice", res)},
		} {
			calls = append(calls, multicallCall{Target: spec.target, CallData: spec.data})
			rtags = append(rtags, rtag{spec.kind, res})
		}
	}
	res, _, err := r.multicall(ctx, "live:reserveState", pin, hash, calls)
	require.NoError(t, err)
	for i, tg := range rtags {
		require.True(t, res[i].Success, "%s for %s reverted at the pin", tg.kind, tg.res.Hex())
		switch tg.kind {
		case "config":
			packed, uerr := unpackPackedUint256Struct(poolGetConfigurationABI, "getConfiguration", res[i].ReturnData)
			require.NoError(t, uerr)
			get(states, tg.res).cfg = decodeAaveReserveConfig(packed)
		case "income":
			v, uerr := unpackUint256Strict(poolNormalizedIncomeABI, "getReserveNormalizedIncome", res[i].ReturnData)
			require.NoError(t, uerr)
			get(states, tg.res).income = v
		case "varDebt":
			v, uerr := unpackUint256Strict(poolNormalizedDebtABI, "getReserveNormalizedVariableDebt", res[i].ReturnData)
			require.NoError(t, uerr)
			get(states, tg.res).varDebt = v
		case "price":
			v, uerr := unpackUint256Strict(aaveOracleGetAssetPriceABI, "getAssetPrice", res[i].ReturnData)
			require.NoError(t, uerr)
			get(states, tg.res).price = v
		}
	}

	return states
}
