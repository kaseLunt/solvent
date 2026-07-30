package main

import (
	"encoding/hex"
	"errors"
	"math/big"
	"testing"

	"github.com/ethereum/go-ethereum/accounts/abi"
	"github.com/ethereum/go-ethereum/crypto"
	"github.com/stretchr/testify/require"

	"github.com/kaselunt/solvent/cmd/reconcile/snapshotdb"
)

// TestP3SelectorsArePinned pins every new lens selector TWO ways, exactly as
// lens_abis_test.go does for the pre-existing set: against crypto.Keccak256 over
// the canonical signature, and against hardcoded hex. A transcription typo in an
// input tuple changes the signature, which changes both — so the pair cannot
// drift silently.
func TestP3SelectorsArePinned(t *testing.T) {
	cases := []struct {
		name     string
		a        abi.ABI
		method   string
		sig      string
		selector string
	}{
		{"getUserAccountData", poolUserAccountDataABI, "getUserAccountData", "getUserAccountData(address)", "bf92857c"},
		{"getUserConfiguration", poolUserConfigurationABI, "getUserConfiguration", "getUserConfiguration(address)", "4417a583"},
		{"getUserEMode", poolUserEModeABI, "getUserEMode", "getUserEMode(address)", "eddf1b79"},
		{"getConfiguration", poolGetConfigurationABI, "getConfiguration", "getConfiguration(address)", "c44b11f7"},
		{"getReserveNormalizedIncome", poolNormalizedIncomeABI, "getReserveNormalizedIncome", "getReserveNormalizedIncome(address)", "d15e0053"},
		{"getAssetPrice", aaveOracleGetAssetPriceABI, "getAssetPrice", "getAssetPrice(address)", "b3596f07"},
		{"collateralTokenConfig", dmCollateralTokenConfigABI, "collateralTokenConfig", "collateralTokenConfig(address)", "f0ba097e"},
		{"getCollateralTokens", dmGetCollateralTokensABI, "getCollateralTokens", "getCollateralTokens()", "b58eb63f"},
		{"liquidatable", dmLiquidatableABI, "liquidatable", "liquidatable(address)", "ffec70af"},
		{"getMaxBorrowAmount", dmGetMaxBorrowAmountABI, "getMaxBorrowAmount", "getMaxBorrowAmount(address,bool)", "cebcff89"},
		{"convertCollateralTokenToUsd", dmConvertCollateralToUsdABI, "convertCollateralTokenToUsd", "convertCollateralTokenToUsd(address,uint256)", "c5b66b4a"},
		{"getDebtManagerAdmin", dmGetDebtManagerAdminABI, "getDebtManagerAdmin", "getDebtManagerAdmin()", "d6d3ec9c"},
		{"price", priceProviderPriceABI, "price", "price(address)", "aea91078"},
		{"tokenConfig", priceProviderTokenConfigABI, "tokenConfig", "tokenConfig(address)", "fe136c4e"},
		{"isBaseAsset", priceProviderIsBaseAssetABI, "isBaseAsset", "isBaseAsset(address)", "2175fe3d"},
		{"decimals", erc20DecimalsABI, "decimals", "decimals()", "313ce567"},
		{"aggregator", chainlinkProxyAggregatorABI, "aggregator", "aggregator()", "245a7bfc"},
		{"getBlockHash", multicall3GetBlockHashABI, "getBlockHash", "getBlockHash(uint256)", "ee82ac5e"},
	}
	for _, tc := range cases {
		m, ok := tc.a.Methods[tc.method]
		require.True(t, ok, "%s: method missing from its ABI", tc.name)
		require.Equal(t, tc.sig, m.Sig, "%s: canonical signature drifted — the input tuple was transcribed wrong", tc.name)
		require.Equal(t, tc.selector, hex.EncodeToString(m.ID), "%s: hardcoded selector", tc.name)
		require.Equal(t, tc.selector, hex.EncodeToString(crypto.Keccak256([]byte(tc.sig))[:4]),
			"%s: keccak over the signature must reproduce the selector", tc.name)
	}
}

// TestAnswerUpdatedTopic0IsCanonical re-derives the topic0 the snapshot package
// carries as a literal. That package may not import a hashing surface (its
// import allowlist is a capability boundary), so the derivation check has to
// live here — a copied string with a typo would silently scan zero rounds and
// report "no gaps".
func TestAnswerUpdatedTopic0IsCanonical(t *testing.T) {
	want := hex.EncodeToString(crypto.Keccak256([]byte("AnswerUpdated(int256,uint256,uint256)")))
	require.Equal(t, want, snapshotdb.AnswerUpdatedTopic0)
}

// TestEveryNewUnpackerRefusesEmptyReturndata is chain-truth R1.4 as a test: a
// zero-length answer is an ARCHIVE artifact — geth answers `0x` with success for
// a call to an address with no code at that block, and Multicall3 answers empty
// for a revert — and must never decode to zero.
func TestEveryNewUnpackerRefusesEmptyReturndata(t *testing.T) {
	assertRefused := func(name string, err error) {
		t.Helper()
		require.Error(t, err, "%s must refuse empty returndata", name)
		var e *emptyReturndataError
		require.True(t, errors.As(err, &e),
			"%s must refuse with the NAMED empty-returndata sentinel so the gate can classify the row weld-unread rather than ABI skew; got %v", name, err)
	}
	_, err := unpackUserAccountData(nil)
	assertRefused("getUserAccountData", err)
	_, err = unpackPackedUint256Struct(poolUserConfigurationABI, "getUserConfiguration", []byte{})
	assertRefused("getUserConfiguration", err)
	_, err = unpackPackedUint256Struct(poolGetConfigurationABI, "getConfiguration", nil)
	assertRefused("getConfiguration", err)
	_, err = unpackUint256Strict(poolNormalizedIncomeABI, "getReserveNormalizedIncome", nil)
	assertRefused("getReserveNormalizedIncome", err)
	_, err = unpackUint256Strict(aaveOracleGetAssetPriceABI, "getAssetPrice", nil)
	assertRefused("getAssetPrice", err)
	_, err = unpackBoolStrict(dmLiquidatableABI, "liquidatable", nil)
	assertRefused("liquidatable", err)
	_, err = unpackUint8Strict(erc20DecimalsABI, "decimals", nil)
	assertRefused("decimals", err)
	_, err = unpackAddressStrict(chainlinkProxyAggregatorABI, "aggregator", nil)
	assertRefused("aggregator", err)
	_, err = unpackAddressListStrict(dmGetCollateralTokensABI, "getCollateralTokens", nil)
	assertRefused("getCollateralTokens", err)
	_, err = unpackBytes32Strict(multicall3GetBlockHashABI, "getBlockHash", nil)
	assertRefused("getBlockHash", err)
	_, err = unpackCollateralTokenConfig(nil)
	assertRefused("collateralTokenConfig", err)
	_, err = unpackTokenConfig(nil)
	assertRefused("tokenConfig", err)
}

// TestEmptyAddressListIsNotEmptyReturndata is the distinction R1.4 actually
// draws: an EMPTY LIST is a legal chain answer and must decode; only empty BYTES
// are refused. Conflating the two would make a legitimately empty enumeration
// read as an archive failure — and vice versa.
func TestEmptyAddressListIsNotEmptyReturndata(t *testing.T) {
	// The canonical encoding of an empty dynamic array: an offset word (0x20)
	// followed by a zero length word.
	raw := make([]byte, 64)
	raw[31] = 0x20
	list, err := unpackAddressListStrict(dmGetCollateralTokensABI, "getCollateralTokens", raw)
	require.NoError(t, err, "an empty LIST is a legal chain answer and must decode")
	require.Empty(t, list)
}

// TestUnpackUserAccountDataComponentOrder pins the six-component order against a
// hand-built encoding. Component order is the difference between a health factor
// and an availableBorrows figure, and go-ethereum will happily decode a
// permuted tuple.
func TestUnpackUserAccountDataComponentOrder(t *testing.T) {
	want := []*big.Int{
		big.NewInt(12305519),          // totalCollateralBase
		big.NewInt(13720591),          // totalDebtBase
		big.NewInt(0),                 // availableBorrowsBase
		big.NewInt(8100),              // currentLiquidationThreshold
		big.NewInt(7800),              // ltv
		mustBig("726460718055075032"), // healthFactor (the P-2 golden value)
	}
	raw := make([]byte, 0, 6*32)
	for _, v := range want {
		raw = append(raw, common32(v)...)
	}
	got, err := unpackUserAccountData(raw)
	require.NoError(t, err)
	require.Equal(t, "12305519", got.TotalCollateralBase.String())
	require.Equal(t, "13720591", got.TotalDebtBase.String())
	require.Equal(t, "0", got.AvailableBorrowsBase.String())
	require.Equal(t, "8100", got.CurrentLiquidationThreshold.String())
	require.Equal(t, "7800", got.LTV.String())
	require.Equal(t, "726460718055075032", got.HealthFactor.String(),
		"the golden borrower's chain healthFactor from recon/p3-probes.md P-2 (fused floor; half-up would end …033)")
}

// TestDecodeAaveReserveConfigBitLayout pins the ReserveConfigurationMap layout
// with a hand-built word: a wrong shift here is a wrong liquidation threshold,
// which is a wrong health factor for the whole reserve.
func TestDecodeAaveReserveConfigBitLayout(t *testing.T) {
	// LTV 7800 (bits 0-15), LT 8100 (16-31), bonus 10600 (32-47), decimals 18
	// (48-55), active (56), borrowing enabled (58) — the weETH values the
	// configurator ledger records as its single CollateralConfigurationChanged.
	packed := new(big.Int)
	packed.Or(packed, big.NewInt(7800))
	packed.Or(packed, new(big.Int).Lsh(big.NewInt(8100), 16))
	packed.Or(packed, new(big.Int).Lsh(big.NewInt(10600), 32))
	packed.Or(packed, new(big.Int).Lsh(big.NewInt(18), 48))
	packed.SetBit(packed, 56, 1)
	packed.SetBit(packed, 58, 1)

	got := decodeAaveReserveConfig(packed)
	require.Equal(t, "7800", got.LTVBps.String())
	require.Equal(t, "8100", got.LiquidationThresholdBps.String())
	require.Equal(t, "10600", got.LiquidationBonusBps.String())
	require.Equal(t, uint8(18), got.Decimals)
	require.True(t, got.Active)
	require.False(t, got.Frozen)
	require.True(t, got.BorrowingEnabled)
	require.False(t, got.Paused)

	// Field isolation: a bonus of 10600 must NOT bleed into the threshold.
	onlyBonus := new(big.Int).Lsh(big.NewInt(10600), 32)
	iso := decodeAaveReserveConfig(onlyBonus)
	require.Equal(t, "0", iso.LTVBps.String())
	require.Equal(t, "0", iso.LiquidationThresholdBps.String())
	require.Equal(t, "10600", iso.LiquidationBonusBps.String())
}

// TestDecodeAaveUserConfigurationBitPairs pins the (2i, 2i+1) pair law using the
// golden borrower's worked example from the probe record: bitmap 6 = weETH
// (reserve index 0) collateral-only, USDC (index 1) borrowing-only.
func TestDecodeAaveUserConfigurationBitPairs(t *testing.T) {
	bitmap := big.NewInt(6) // 0b110
	weeth := decodeAaveUserConfiguration(bitmap, 0)
	require.False(t, weeth.Borrowing, "bit 0 (borrowing reserve 0)")
	require.True(t, weeth.UsedAsCollateral, "bit 1 (collateral reserve 0)")
	usdc := decodeAaveUserConfiguration(bitmap, 1)
	require.True(t, usdc.Borrowing, "bit 2 (borrowing reserve 1)")
	require.False(t, usdc.UsedAsCollateral, "bit 3 (collateral reserve 1)")
	// Reserves the account never touched read false on both bits.
	require.Equal(t, aaveUserFlags{}, decodeAaveUserConfiguration(bitmap, 2))
	// Defensive: nil / negative index must not panic and must not claim
	// collateral (an accidental true here would inflate collateral aggregates).
	require.False(t, decodeAaveUserConfiguration(nil, 0).UsedAsCollateral)
	require.False(t, decodeAaveUserConfiguration(bitmap, -1).UsedAsCollateral)
}

func mustBig(s string) *big.Int {
	v, ok := new(big.Int).SetString(s, 10)
	if !ok {
		panic("bad big: " + s)
	}
	return v
}

// common32 left-pads v into a 32-byte ABI word.
func common32(v *big.Int) []byte {
	out := make([]byte, 32)
	b := v.Bytes()
	copy(out[32-len(b):], b)
	return out
}
