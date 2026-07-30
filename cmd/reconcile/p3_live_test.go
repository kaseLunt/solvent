package main

// OPT-IN LIVE SMOKE for the P3 Task-6 read families.
//
// WHY IT EXISTS. Every gate in this wave rests on two things a unit test cannot
// check: that the new pinned reads are actually SERVEABLE at the pins the gates
// use (including deep-archive OP blocks at 150M and each backtest case's stored
// raw_logs hash), and that our recompute matches the chain BIT-EXACTLY on real
// state. `make reconcile` proves both, but it is gated on the live database's
// schema matching this binary exactly — by design, and correctly so. When the
// database sits behind the binary (a daemon that has not restarted since the
// last migration landed), the whole gate set becomes unrunnable while the CHAIN
// side is perfectly checkable. This test is that check.
//
// It uses the PRODUCTION ABIs, the PRODUCTION strict unpackers, the PRODUCTION
// bit decoders and the PRODUCTION comparison helpers — never a second copy. A
// probe that re-implements the decode would prove the probe works.
//
// Opt-in: SOLVENT_P3_LIVE=1 plus the same RPC env `make reconcile` uses
// (SOLVENT_RECON_RPC_ETH / _OP, falling back to SOLVENT_RPC_*). Unset ⇒ SKIP.
// Once opted in it FAILS rather than skips, per the house law for opt-in
// harnesses (internal/forkreplay's posture).

import (
	"context"
	"math/big"
	"os"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/ethereum/go-ethereum/common"
	"github.com/stretchr/testify/require"

	"github.com/kaselunt/solvent/internal/chain"
)

func liveReader(t *testing.T, name, primaryEnv, fallbackEnv string) *pinnedReader {
	t.Helper()
	raw := strings.TrimSpace(os.Getenv(primaryEnv))
	if raw == "" {
		raw = strings.TrimSpace(os.Getenv(fallbackEnv))
	}
	require.NotEmpty(t, raw, "%s (or %s) must be set once SOLVENT_P3_LIVE is on", primaryEnv, fallbackEnv)
	var urls []string
	for _, u := range strings.Split(raw, ",") {
		if u = strings.TrimSpace(u); u != "" {
			urls = append(urls, u)
		}
	}
	c, err := chain.Dial(context.Background(), urls)
	require.NoError(t, err, "dial %s", name)
	// The SAME shared runner shape the harness uses: one token bucket, bounded
	// retries, per-attempt classification. The rate is deliberately the
	// canonical 1.5 rps — this test must not out-consume the live daemon's
	// provider budget any more than a real run would.
	return &pinnedReader{name: name, c: c, run: newRPCRunner(1.5, 5, &rpcCallLog{})}
}

func requireLive(t *testing.T) {
	t.Helper()
	if os.Getenv("SOLVENT_P3_LIVE") == "" {
		t.Skip("SOLVENT_P3_LIVE unset: the live read-family smoke is opt-in")
	}
}

// TestLiveBacktestParentPinIsDerivedFromTheStoredPin proves the honest N-1 pin.
// chain-truth R1 bans resolving a backtest pin by NUMBER, and raw_logs stores
// only block N's hash — so the parent hash is taken from block N's OWN state via
// Multicall3's BLOCKHASH, at the stored pin. This test also proves the whole
// parent frame is SERVEABLE at 150M+ (the deep-archive posture the gate needs).
func TestLiveBacktestParentPinIsDerivedFromTheStoredPin(t *testing.T) {
	requireLive(t)
	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Minute)
	defer cancel()
	r := liveReader(t, "op", "SOLVENT_RECON_RPC_OP", "SOLVENT_RPC_OP")

	// The frozen frame's two-pass case — the hardest accounting in the frame.
	var twoPass *backtestCase
	for i := range backtestFrame {
		if strings.Contains(backtestFrame[i].Selection, "two-pass") {
			twoPass = &backtestFrame[i]
			break
		}
	}
	require.NotNil(t, twoPass, "the frame must carry the force-included two-pass pair")
	pinHash := common.HexToHash(twoPass.BlockHash)
	account := common.HexToAddress(twoPass.Account)
	usdcOP := common.HexToAddress("0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85")

	gbData, err := multicall3GetBlockHashABI.Pack("getBlockHash", new(big.Int).SetUint64(twoPass.Block-1))
	require.NoError(t, err)
	gbRet, _, err := r.callAtHash(ctx, "live:getBlockHash", multicall3Address, gbData, pinHash)
	require.NoError(t, err, "the case's STORED raw_logs hash must be serveable — a state-pruned verdict here is preflightExit semantics, never a shrunk N")
	parent, err := unpackBytes32Strict(multicall3GetBlockHashABI, "getBlockHash", gbRet)
	require.NoError(t, err)
	require.NotEqual(t, common.Hash{}, parent,
		"BLOCKHASH must assert the parent: a zero here means the N-1 frame cannot be pinned honestly")
	t.Logf("case %s @%d: parentHash derived from the stored pin = %s", twoPass.TxHash, twoPass.Block, parent.Hex())

	// Cross-check ONLY (never the pin): the provider's own header for N-1.
	byNumber, _, err := r.headerHash(ctx, twoPass.Block-1)
	require.NoError(t, err)
	require.Equal(t, byNumber.Hex(), parent.Hex(),
		"the BLOCKHASH-derived parent must be the canonical parent; it is used as the PIN precisely because it comes from the pinned block's own state rather than from a number lookup")

	// The whole parent frame the gate reads, at the derived hash.
	calls := []multicallCall{
		{Target: liveDMProxy, CallData: mustPack(t, dmCollateralOfABI, "collateralOf", account)},
		{Target: liveDMProxy, CallData: mustPack(t, dmGetCollateralTokensABI, "getCollateralTokens")},
	}
	res, _, err := r.multicall(ctx, "live:parentFrame", twoPass.Block-1, parent, calls)
	require.NoError(t, err, "the parent frame must be serveable at 150M+ archive depth")
	require.True(t, res[0].Success, "collateralOf@parentHash")
	list, total, err := unpackTokenAmountList(dmCollateralOfABI, "collateralOf", res[0].ReturnData)
	require.NoError(t, err)
	t.Logf("collateralOf(user)@parentHash: %d legs, total USD-6 %s", len(list), total)
	require.True(t, res[1].Success)
	tokens, err := unpackAddressListStrict(dmGetCollateralTokensABI, "getCollateralTokens", res[1].ReturnData)
	require.NoError(t, err)
	t.Logf("getCollateralTokens()@parentHash: %d tokens", len(tokens))

	// The post-liquidation residue leg (obligation 4's chain side) at the case's
	// own pin.
	boData, err := dmBorrowingOfOneABI.Pack("borrowingOf", account, usdcOP)
	require.NoError(t, err)
	boRet, _, err := r.callAtHash(ctx, "live:borrowingOf", liveDMProxy, boData, pinHash)
	require.NoError(t, err)
	after, err := unpackUint256Strict(dmBorrowingOfOneABI, "borrowingOf", boRet)
	require.NoError(t, err)
	t.Logf("borrowingOf(user, USDC)@caseHash (post-liquidation, obligation 4's chain side) = %s", after)
}

// TestLiveDMTokenUniverseAndTokenConfigSweep proves the OP-side read families:
// the chain enumeration every coverage floor counts against, the engine-exact
// price path that avoids assuming a provider address, and the tokenConfig sweep
// with its baseAsset closure.
func TestLiveDMTokenUniverseAndTokenConfigSweep(t *testing.T) {
	requireLive(t)
	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Minute)
	defer cancel()
	r := liveReader(t, "op", "SOLVENT_RECON_RPC_OP", "SOLVENT_RPC_OP")

	pin := livePin(t, "SOLVENT_P3_LIVE_PIN_OP", 154892958)
	hash, _, err := r.headerHash(ctx, pin)
	require.NoError(t, err)
	t.Logf("OP pin %d hash %s", pin, hash.Hex())

	res, _, err := r.multicall(ctx, "live:dmUniverse", pin, hash, []multicallCall{
		{Target: liveDMProxy, CallData: mustPack(t, dmGetCollateralTokensABI, "getCollateralTokens")},
		{Target: liveDMProxy, CallData: mustPack(t, dmGetBorrowTokensABI, "getBorrowTokens")},
	})
	require.NoError(t, err)
	require.True(t, res[0].Success && res[1].Success)
	collateral, err := unpackAddressListStrict(dmGetCollateralTokensABI, "getCollateralTokens", res[0].ReturnData)
	require.NoError(t, err)
	borrow, err := unpackAddressListStrict(dmGetBorrowTokensABI, "getBorrowTokens", res[1].ReturnData)
	require.NoError(t, err)
	t.Logf("CHAIN enumeration at pin: %d collateral tokens, %d borrow tokens (the coverage floor counts against THIS, never the registry)",
		len(collateral), len(borrow))
	require.NotEmpty(t, collateral)
	require.NotEmpty(t, borrow)

	liquidUSD := common.HexToAddress("0x08c6F91e2B681FaF5e17227F2a44C307b3C1364C")
	decRet, _, err := r.callAtHash(ctx, "live:decimals", liquidUSD, mustPack(t, erc20DecimalsABI, "decimals"), hash)
	require.NoError(t, err)
	dec, err := unpackUint8Strict(erc20DecimalsABI, "decimals", decRet)
	require.NoError(t, err)

	// The engine-exact price WITHOUT assuming a provider address: the DM
	// resolves its provider through etherFiDataProvider at the called block, and
	// convertCollateralTokenToUsd(token, 10^dec) returns P exactly.
	cvData, err := dmConvertCollateralToUsdABI.Pack("convertCollateralTokenToUsd", liquidUSD, pow10Big(dec))
	require.NoError(t, err)
	cvRet, _, err := r.callAtHash(ctx, "live:engineExactPrice", liveDMProxy, cvData, hash)
	require.NoError(t, err)
	enginePrice, err := unpackUint256Strict(dmConvertCollateralToUsdABI, "convertCollateralTokenToUsd", cvRet)
	require.NoError(t, err)

	// The provider-identity weld: the CLAIMED provider must be the one the
	// engine charges against.
	ppData, err := priceProviderPriceABI.Pack("price", liquidUSD)
	require.NoError(t, err)
	ppRet, _, err := r.callAtHash(ctx, "live:providerPrice", liveProvider, ppData, hash)
	require.NoError(t, err)
	providerPrice, err := unpackUint256Strict(priceProviderPriceABI, "price", ppRet)
	require.NoError(t, err)
	require.Equal(t, enginePrice.String(), providerPrice.String(),
		"recon/feeds.json's claimed provider must be the address the Debt Manager actually charges against at the pin — the CLAIM welded, not assumed")
	t.Logf("liquidUSD: decimals=%d engine-exact price=%s (provider-identity weld EXACT)", dec, enginePrice)

	// The tokenConfig sweep and its baseAsset closure.
	tcData, err := priceProviderTokenConfigABI.Pack("tokenConfig", liquidUSD)
	require.NoError(t, err)
	tcRet, _, err := r.callAtHash(ctx, "live:tokenConfig", liveProvider, tcData, hash)
	require.NoError(t, err)
	cfg, err := unpackTokenConfig(tcRet)
	require.NoError(t, err, "an ABI-skew failure here is weld-unread, never a partial decode")
	t.Logf("tokenConfig(liquidUSD): oracle=%s chainlinkType=%v oracleDec=%d maxStaleness=%s dataType=%d isStable=%v baseAsset=%s",
		cfg.Oracle.Hex(), cfg.IsChainlinkType, cfg.OraclePriceDecimals, cfg.MaxStaleness, cfg.DataType, cfg.IsStableToken, cfg.BaseAsset.Hex())
	require.NotEqual(t, common.Address{}, cfg.Oracle,
		"a zeroed struct is the FACT 'unconfigured', and liquidUSD is in the chain's collateral universe")

	if cfg.BaseAsset != (common.Address{}) {
		bData, err := priceProviderTokenConfigABI.Pack("tokenConfig", cfg.BaseAsset)
		require.NoError(t, err)
		bRet, _, err := r.callAtHash(ctx, "live:tokenConfig(base)", liveProvider, bData, hash)
		require.NoError(t, err)
		base, err := unpackTokenConfig(bRet)
		require.NoError(t, err)
		t.Logf("  base %s: oracle=%s isStable=%v baseAsset=%s (terminal=%v)",
			cfg.BaseAsset.Hex(), base.Oracle.Hex(), base.IsStableToken, base.BaseAsset.Hex(), base.BaseAsset == (common.Address{}))
		require.NotEqual(t, common.Address{}, base.Oracle,
			"a token priced in terms of a baseAsset whose own config is unreadable has no complete composition — the liquidUSD defect class one level down")
		require.Equal(t, common.Address{}, base.BaseAsset,
			"PriceProviderV2 states chaining base assets is not supported; a chained base would break the composition model")
	}

	// The DM param weld's chain side.
	ctcData, err := dmCollateralTokenConfigABI.Pack("collateralTokenConfig", liquidUSD)
	require.NoError(t, err)
	ctcRet, _, err := r.callAtHash(ctx, "live:collateralTokenConfig", liveDMProxy, ctcData, hash)
	require.NoError(t, err)
	ctc, err := unpackCollateralTokenConfig(ctcRet)
	require.NoError(t, err)
	t.Logf("collateralTokenConfig(liquidUSD): ltv=%s lt=%s bonus=%s (HUNDRED_PERCENT = 100e18)",
		ctc.LTV, ctc.LiquidationThreshold, ctc.LiquidationBonus)
	require.Equal(t, "0", new(big.Int).Mod(ctc.LiquidationThreshold, pow10Big(16)).String(),
		"a HUNDRED_PERCENT-denominated threshold is a whole percent times 1e18; a bps value here would be 1e16x wrong")
}

// TestLiveB3PhaseChangeCheck performs the pinned proxy.aggregator() read for
// every configured stream. chain-truth R4.2: this is what separates "the feed
// stopped" from "the proxy re-pointed and our walked aggregator went quiet".
func TestLiveB3PhaseChangeCheck(t *testing.T) {
	requireLive(t)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()
	r := liveReader(t, "eth", "SOLVENT_RECON_RPC_ETH", "SOLVENT_RPC_ETH")
	pin := livePin(t, "SOLVENT_P3_LIVE_PIN_ETH", 25643189)
	hash, _, err := r.headerHash(ctx, pin)
	require.NoError(t, err)

	for _, f := range []struct{ symbol, proxy, walked string }{
		{"weETH/ETH", "0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419", "0x7d4E742018fb52E48b08BE73d041C18B21de6Fb5"},
		{"USDC/USD", "0x8fFfFfd4AfB6115b954Bd326cbe7B4BA576818f6", "0xc9E1a09622afdB659913fefE800fEaE5DBbFe9d7"},
		{"PYUSD/USD", "0x8f1dF6D7F2db73eECE86a18b4381F4707b918FB1", "0x39E31761911b9aaBAEF5fb81B18Fd1C24a60E884"},
		{"FRAX/USD", "0xB9E1E3A9feFf48998E45Fa90847ed4D467E8BcfD", "0x8F73090a7c58B8BDcC9A93cBB6816e5cC4f01E8c"},
	} {
		data, err := chainlinkProxyAggregatorABI.Pack("aggregator")
		require.NoError(t, err)
		ret, _, err := r.callAtHash(ctx, "live:aggregator", common.HexToAddress(f.proxy), data, hash)
		require.NoError(t, err, "%s: the phase-change check must be performable, or the scan is unscannable rather than free to issue a heartbeat verdict", f.symbol)
		got, err := unpackAddressStrict(chainlinkProxyAggregatorABI, "aggregator", ret)
		require.NoError(t, err)
		match := strings.EqualFold(got.Hex(), f.walked)
		t.Logf("%-10s proxy.aggregator()@pin = %s ; walked = %s ; MATCH = %v", f.symbol, got.Hex(), f.walked, match)
		if !match {
			t.Logf("  ^^ STREAM REQUIRES RE-RESOLUTION for %s: this is a custody-config finding in its own failure class, NOT a heartbeat verdict", f.symbol)
		}
	}
}

// --- helpers ----------------------------------------------------------------

var (
	liveAavePool   = common.HexToAddress("0x0AA97c284e98396202b6A04024F5E2c65026F3c0")
	liveAaveOracle = common.HexToAddress("0x43b64f28A678944E0655404B0B98E443851cC34F")
	liveDMProxy    = common.HexToAddress("0x0078C5a459132e279056B2371fE8A8eC973A9553")
	liveProvider   = common.HexToAddress("0x44dd2372FE7B97C4B4D6a7d4DeCf72466485BAcB")
)

func livePin(t *testing.T, envKey string, fallback uint64) uint64 {
	t.Helper()
	if v := strings.TrimSpace(os.Getenv(envKey)); v != "" {
		n, err := strconv.ParseUint(v, 10, 64)
		require.NoError(t, err, "%s must be a block number", envKey)
		return n
	}
	return fallback
}

func mustPack(t *testing.T, a abiPacker, method string, args ...any) []byte {
	t.Helper()
	data, err := a.Pack(method, args...)
	require.NoError(t, err, "pack %s", method)
	return data
}

type abiPacker interface {
	Pack(name string, args ...any) ([]byte, error)
}

// liveReserveState is one reserve's pinned state in the live smoke.
type liveReserveState struct {
	cfg     aaveReserveConfig
	income  *big.Int
	varDebt *big.Int
	price   *big.Int
}

func get(m map[common.Address]*liveReserveState, k common.Address) *liveReserveState {
	if m[k] == nil {
		m[k] = &liveReserveState{}
	}
	return m[k]
}
