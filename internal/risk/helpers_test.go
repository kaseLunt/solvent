package risk

// Shared fixture builders. Deliberately explicit: every value a test depends
// on is written in that test, not defaulted here, so a reader never has to
// hunt for where a number came from.

import (
	"math/big"
	"testing"
	"time"

	"github.com/ethereum/go-ethereum/common"
	"github.com/stretchr/testify/require"
)

// Real registry addresses (recon/derivation-notes.md "Asset registry").
var (
	// Aave v3 ether.fi market, chain 1.
	aWeETH = common.HexToAddress("0xCd5fE23C85820F7B72D0926FC9b05b43E359b7ee")
	aUSDC  = common.HexToAddress("0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48")
	aPYUSD = common.HexToAddress("0x6c3ea9036406852006290770BEdFcAbA0e23A0e8")
	aFRAX  = common.HexToAddress("0x853d955aCEf822Db058eb8505911ED77F175b99e")

	// Debt Manager, chain 10.
	dWeETH  = common.HexToAddress("0x5A7fACB970D094B6C7FF1df0eA68D99E6e73CBFF")
	dWETH   = common.HexToAddress("0x4200000000000000000000000000000000000006")
	dUSDC   = common.HexToAddress("0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85")
	dUSDT   = common.HexToAddress("0x94b008aA00579c1307B0EF2c499aD98a8ce58e58")
	dFrxUSD = common.HexToAddress("0x80Eede496655FB9047dd39d9f418d5483ED600df")
	dLiqETH = common.HexToAddress("0xf0bb20865277aBd641a307eCe5Ee04E79073416C")
	dLiqUSD = common.HexToAddress("0x08c6F91e2B681FaF5e17227F2a44C307b3C1364C")
	dLiqBTC = common.HexToAddress("0x5f46d540b6eD704C3c8789105F30E075AA900726")
	dEBTC   = common.HexToAddress("0x657e8C867D8B37dCC18fA4Caead9C45EB088C642")
	dETHFI  = common.HexToAddress("0xe0080d2F853ecDdbd81A643dC10DA075Df26fD3f")
	dSETHFI = common.HexToAddress("0x86B5780b606940Eb59A062aA85a07959518c0161")

	// Test accounts.
	acctA = common.HexToAddress("0x70daaac436465a0d03e45916fa68ddee6086e5fe")
	acctB = common.HexToAddress("0x464c71f6c2f760dda6093dcb91c24c39e5d6e18c")
	acctC = common.HexToAddress("0x849b5e5100000000000000000000000000000001")
)

// Shared watermarks. Every engine input must carry a balances block —
// ComputeAaveHealth/ComputeDMHealth refuse an input without one — so the
// fixtures state real block numbers rather than zeros: the ETH probe pin
// 25,635,618 and the OP cursor 154,848,114 (recon/p3-probes.md).
var (
	testAaveMarks = Watermarks{BalancesBlock: 25635618, ParamsBlock: 25635610}
	testDMMarks   = Watermarks{BalancesBlock: 154848114, ParamsBlock: 154848114, SweepBlock: 154840000}
)

// fixedTime is the only clock this suite has. Nothing in the package reads a
// real clock, and nothing in the tests may either.
var fixedTime = time.Date(2026, 7, 29, 3, 16, 0, 0, time.UTC)

// bi parses a decimal literal at fixture-build time, panicking on garbage.
// Test bodies use mustBig; builders use this so they stay expression-shaped.
func bi(s string) *big.Int {
	v, ok := new(big.Int).SetString(s, 10)
	if !ok {
		panic("risk test fixture: not a decimal integer: " + s)
	}
	return v
}

// adapterPrice is an Aave-side price input (provenance adapter-output, the
// only class the Aave valuation may consume), 8-decimal base currency.
func adapterPrice(a common.Address, value string) PriceInput {
	return PriceInput{
		ChainID: 1, Asset: a, Source: "aaveoracle:0x43b64f28A678944E0655404B0B98E443851cC34F",
		Block: 25635618, AsOf: fixedTime, Value: bi(value), Decimals: 8,
		BudgetSeconds: 180, Provenance: ProvenanceAdapterOutput, Fresh: true,
	}
}

// enginePrice is a Debt Manager price input (provenance engine-exact — the
// exact function the engine charges against), 6-decimal USD.
func enginePrice(a common.Address, value string) PriceInput {
	return PriceInput{
		ChainID: 10, Asset: a, Source: "priceproviderv2:0x44dd2372FE7B97C4B4D6a7d4DeCf72466485BAcB",
		Block: 154848114, AsOf: fixedTime, Value: bi(value), Decimals: 6,
		BudgetSeconds: 180, Provenance: ProvenanceEngineExact, Fresh: true,
	}
}

// aaveParam builds a param row in Aave basis points (denominator 1e4).
func aaveParam(a common.Address, ltBps, bonusBps string) ParamRow {
	return ParamRow{
		Engine: AaveParamEngine, ChainID: 1, Asset: a,
		LTV: bi("7800"), LiqThreshold: bi(ltBps), LiqBonus: bi(bonusBps),
		EffectiveBlock: 20713917, EffectiveLogIndex: 7,
		Source: "CollateralConfigurationChanged",
	}
}

// dmParam builds a param row in the Debt Manager's HUNDRED_PERCENT convention
// (denominator 100e18).
func dmParam(a common.Address, lt, bonus string) ParamRow {
	return ParamRow{
		Engine: DMEngine, ChainID: 10, Asset: a,
		LTV: bi("50000000000000000000"), LiqThreshold: bi(lt), LiqBonus: bi(bonus),
		EffectiveBlock: 149965263, EffectiveLogIndex: 243,
		Source: "CollateralTokenConfigSet",
	}
}

// simpleReserve is an Aave reserve whose indexes are exactly RAY, so the
// scaled balance IS the live balance. Used where a test is about the
// valuation or threshold arithmetic rather than the ray projection (which the
// probe vectors in math_test.go pin on their own).
func simpleReserve(a common.Address, decimals uint8, scaledCollateral, scaledDebt string, usedAsCollateral bool) AaveReserve {
	return AaveReserve{
		Asset: a, Decimals: decimals,
		ScaledCollateral: bi(scaledCollateral), ScaledDebt: bi(scaledDebt),
		CollateralIndex: RayUnit(), DebtIndex: RayUnit(),
		IndexBlock: 25635600, IndexTime: fixedTime,
		UsedAsCollateral: usedAsCollateral,
	}
}

// requireBig asserts a *big.Int against a decimal literal with a readable
// failure message.
func requireBig(t *testing.T, want string, got *big.Int, msgAndArgs ...any) {
	t.Helper()
	require.NotNil(t, got, msgAndArgs...)
	require.Equal(t, want, got.String(), msgAndArgs...)
}

// mustAddr parses a hex address, panicking on garbage — fixture builders only.
func mustAddr(s string) common.Address {
	if !common.IsHexAddress(s) {
		panic("risk test fixture: not a hex address: " + s)
	}
	return common.HexToAddress(s)
}
