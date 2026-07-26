// Lens-ABI pinning (brief §10): every selector is asserted BOTH against a
// recomputed keccak of the canonical signature and against a hardcoded hex
// constant, so a transcription typo in an input tuple (which silently
// changes the selector) cannot survive; pack/unpack round-trips run over
// golden shapes including the borrowingOf overload pair.
package main

import (
	"math/big"
	"testing"

	"github.com/ethereum/go-ethereum/accounts/abi"
	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/crypto"
	"github.com/stretchr/testify/require"
)

func selector(t *testing.T, a abi.ABI, method string) []byte {
	t.Helper()
	m, ok := a.Methods[method]
	require.True(t, ok, "method %s missing", method)
	return m.ID
}

func TestLensSelectorsPinned(t *testing.T) {
	cases := []struct {
		abi    abi.ABI
		method string
		sig    string
		hex    string
	}{
		{dmBorrowingOfAllABI, "borrowingOf", "borrowingOf(address)", "186c66cc"},
		{dmBorrowingOfOneABI, "borrowingOf", "borrowingOf(address,address)", "4142152e"},
		{dmGetCurrentIndexABI, "getCurrentIndex", "getCurrentIndex(address)", "64752eec"},
		{dmCollateralOfABI, "collateralOf", "collateralOf(address)", "1aefb107"},
		{dmGetBorrowTokensABI, "getBorrowTokens", "getBorrowTokens()", "5a52477a"},
		{dmBorrowTokenConfigABI, "borrowTokenConfig", "borrowTokenConfig(address)", "7e5cdc5e"},
		{aaveScaledBalanceOfABI, "scaledBalanceOf", "scaledBalanceOf(address)", "1da24f3e"},
		{aaveScaledTotalSupplyABI, "scaledTotalSupply", "scaledTotalSupply()", "b1bf962d"},
		{erc20BalanceOfABI, "balanceOf", "balanceOf(address)", "70a08231"},
		{poolReserveDebtTokenABI, "getReserveVariableDebtToken", "getReserveVariableDebtToken(address)", "365090a0"},
		{poolNormalizedDebtABI, "getReserveNormalizedVariableDebt", "getReserveNormalizedVariableDebt(address)", "386497fd"},
		{multicall3ABI, "tryBlockAndAggregate", "tryBlockAndAggregate(bool,(address,bytes)[])", "399542e9"},
	}
	for _, c := range cases {
		id := selector(t, c.abi, c.method)
		require.Equal(t, crypto.Keccak256([]byte(c.sig))[:4], id, "recomputed selector for %s", c.sig)
		require.Equal(t, c.hex, common.Bytes2Hex(id), "pinned selector for %s", c.sig)
	}
	// The overload pair MUST differ — the whole reason they live in two
	// single-method ABIs (go-ethereum would mangle one into borrowingOf0).
	require.NotEqual(t,
		selector(t, dmBorrowingOfAllABI, "borrowingOf"),
		selector(t, dmBorrowingOfOneABI, "borrowingOf"))
}

func TestBorrowingOfAllPackAndUnpackRoundTrip(t *testing.T) {
	user := common.HexToAddress("0x0303a641b9255A4240E879C76EFc704Dc1C6383D")
	data, err := dmBorrowingOfAllABI.Pack("borrowingOf", user)
	require.NoError(t, err)
	require.Equal(t, "186c66cc", common.Bytes2Hex(data[:4]))
	require.Len(t, data, 4+32)
	require.Equal(t, user.Bytes(), data[4+12:4+32], "address right-aligned in the single word")

	// Golden return: two-token array + total, built through the same ABI's
	// output arguments — the zero-trim shape (nonzero tokens only).
	tok1 := common.HexToAddress("0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85")
	tok2 := common.HexToAddress("0x94b008aA00579c1307B0EF2c499aD98a8ce58e58")
	type td struct {
		Token  common.Address `abi:"token"`
		Amount *big.Int       `abi:"amount"`
	}
	ret, err := dmBorrowingOfAllABI.Methods["borrowingOf"].Outputs.Pack(
		[]td{{tok1, big.NewInt(1004681)}, {tok2, big.NewInt(42)}}, big.NewInt(1004723))
	require.NoError(t, err)
	list, total, err := unpackTokenAmountList(dmBorrowingOfAllABI, "borrowingOf", ret)
	require.NoError(t, err)
	require.Len(t, list, 2)
	require.Equal(t, tok1, list[0].Token)
	require.Equal(t, "1004681", list[0].Amount.String())
	require.Equal(t, "42", list[1].Amount.String())
	require.Equal(t, "1004723", total.String())
}

func TestBorrowingOfOnePackAndUnpack(t *testing.T) {
	user := common.HexToAddress("0xaC5F3cE95F602e31B672cC38CdDF7A3eA9aE5FCC")
	token := common.HexToAddress("0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85")
	data, err := dmBorrowingOfOneABI.Pack("borrowingOf", user, token)
	require.NoError(t, err)
	require.Equal(t, "4142152e", common.Bytes2Hex(data[:4]))
	require.Len(t, data, 4+64)

	ret, err := dmBorrowingOfOneABI.Methods["borrowingOf"].Outputs.Pack(big.NewInt(15845260))
	require.NoError(t, err)
	v, err := unpackUint256(dmBorrowingOfOneABI, "borrowingOf", ret)
	require.NoError(t, err)
	require.Equal(t, "15845260", v.String())
}

func TestBorrowTokenConfigUnpack(t *testing.T) {
	type cfg struct {
		InterestIndexSnapshot          *big.Int `abi:"interestIndexSnapshot"`
		TotalNormalizedBorrowingAmount *big.Int `abi:"totalNormalizedBorrowingAmount"`
		TotalSharesOfBorrowTokens      *big.Int `abi:"totalSharesOfBorrowTokens"`
		LastUpdateTimestamp            uint64   `abi:"lastUpdateTimestamp"`
		BorrowApy                      uint64   `abi:"borrowApy"`
		MinShares                      *big.Int `abi:"minShares"`
	}
	ret, err := dmBorrowTokenConfigABI.Methods["borrowTokenConfig"].Outputs.Pack(cfg{
		InterestIndexSnapshot:          big.NewInt(1042402553573226850),
		TotalNormalizedBorrowingAmount: big.NewInt(999),
		TotalSharesOfBorrowTokens:      big.NewInt(5),
		LastUpdateTimestamp:            1753500000,
		BorrowApy:                      317097919,
		MinShares:                      big.NewInt(1),
	})
	require.NoError(t, err)
	got, err := unpackBorrowTokenConfig(ret)
	require.NoError(t, err)
	require.Equal(t, "1042402553573226850", got.InterestIndexSnapshot.String())
	require.Equal(t, "999", got.TotalNormalizedBorrowingAmount.String())
	require.EqualValues(t, 1753500000, got.LastUpdateTimestamp)
	require.EqualValues(t, 317097919, got.BorrowApy)
}

func TestTryBlockAndAggregateRoundTrip(t *testing.T) {
	calls := []multicallCall{
		{Target: common.HexToAddress("0x0078C5a459132e279056B2371fE8A8eC973A9553"), CallData: []byte{0x18, 0x6c, 0x66, 0xcc}},
	}
	data, err := packTryBlockAndAggregate(calls)
	require.NoError(t, err)
	require.Equal(t, "399542e9", common.Bytes2Hex(data[:4]))
	// requireSuccess is FALSE: an individually reverting view must be a
	// per-row failure, never a chunk abort.
	require.Equal(t, byte(0), data[4+31])

	ret, err := multicall3ABI.Methods["tryBlockAndAggregate"].Outputs.Pack(
		big.NewInt(154021227), [32]byte{0xab}, []multicallResult{{Success: true, ReturnData: []byte{0x01}}})
	require.NoError(t, err)
	blockNum, blockHash, results, err := unpackTryBlockAndAggregate(ret)
	require.NoError(t, err)
	require.Equal(t, "154021227", blockNum.String())
	require.Equal(t, byte(0xab), blockHash[0])
	require.Len(t, results, 1)
	require.True(t, results[0].Success)
	require.Equal(t, []byte{0x01}, results[0].ReturnData)
}

func TestUnpackAddressAndList(t *testing.T) {
	addr := common.HexToAddress("0x9355032d0e5c8Dc8bBcbB55f1b1e18DD6E971b8C")
	ret, err := poolReserveDebtTokenABI.Methods["getReserveVariableDebtToken"].Outputs.Pack(addr)
	require.NoError(t, err)
	got, err := unpackAddress(poolReserveDebtTokenABI, "getReserveVariableDebtToken", ret)
	require.NoError(t, err)
	require.Equal(t, addr, got)

	list := []common.Address{addr, common.HexToAddress("0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85")}
	ret, err = dmGetBorrowTokensABI.Methods["getBorrowTokens"].Outputs.Pack(list)
	require.NoError(t, err)
	gotList, err := unpackAddressList(dmGetBorrowTokensABI, "getBorrowTokens", ret)
	require.NoError(t, err)
	require.Equal(t, list, gotList)
}

func TestUnpackRejectsGarbage(t *testing.T) {
	_, _, err := unpackTokenAmountList(dmBorrowingOfAllABI, "borrowingOf", []byte{0x01, 0x02})
	require.Error(t, err)
	_, err = unpackUint256(dmGetCurrentIndexABI, "getCurrentIndex", nil)
	require.Error(t, err)
	_, err = unpackBorrowTokenConfig([]byte{0xff})
	require.Error(t, err)
	_, _, _, err = unpackTryBlockAndAggregate([]byte{0xff, 0xfe})
	require.Error(t, err)
}
