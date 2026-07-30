// Hand-authored SINGLE-METHOD lens ABIs for the P3 Task-6 gate set, following
// the lens_abis.go precedent exactly: one ABI per view, a provenance comment
// naming the verified source the tuple was transcribed from, and selectors
// pinned by unit tests against crypto.Keccak256 AND hardcoded hex
// (p3_abis_test.go). Overloads never share an abi.ABI.
//
// STRICT-UNPACKER LAW (chain-truth R1.4, the unpackBorrowTokenConfig
// precedent at dm.go:410-414 promoted to a requirement for every NEW
// unpacker): a decoder here REFUSES len(returndata)==0 instead of decoding
// zero. geth answers `0x` with success for a call to an address with no code
// at that block, and Multicall3 answers success=false with empty returndata
// for a revert; both are zero-SHAPED, neither is a zero the chain asserted.
// Every unpacker below therefore checks emptiness FIRST, by name, so an
// archive that cannot serve the block can never be mistaken for a chain that
// says zero.
package main

import (
	"fmt"
	"math/big"
	"reflect"

	"github.com/ethereum/go-ethereum/accounts/abi"
	"github.com/ethereum/go-ethereum/common"
)

// errEmptyReturndata is the named refusal every new unpacker raises on
// len(returndata)==0. It is a distinct sentinel so the gates can classify the
// row as weld-unread rather than as ABI skew: "the endpoint returned nothing"
// and "the endpoint returned something we cannot read" are different facts
// about the archive.
type emptyReturndataError struct{ method string }

func (e *emptyReturndataError) Error() string {
	return fmt.Sprintf("unpack %s: EMPTY returndata (len 0) — refused, never decoded as zero: geth answers `0x` with success for a call to an address with no code at that block and Multicall3 answers empty for a revert, so a zero here would be an archive artifact wearing a chain fact's clothes (chain-truth R1.4)", e.method)
}

// requireNonEmpty is the first line of every new unpacker.
func requireNonEmpty(method string, ret []byte) error {
	if len(ret) == 0 {
		return &emptyReturndataError{method: method}
	}
	return nil
}

// --- Aave v3 Pool views -----------------------------------------------------

// poolUserAccountDataABI: getUserAccountData(user) → the six-component health
// tuple. Provenance: Aave v3 IPool (the deployed ether.fi Pool is a v3.3-line
// instance — recon/derivation-notes.md); component order is the v3 order and
// is asserted by the selector test plus the golden vectors in
// recon/p3-probes.md (P-2, 12/12 at pin 25,635,618). Selector 0xbf92857c.
var poolUserAccountDataABI = mustParseABI(`[{
	"type": "function", "name": "getUserAccountData", "stateMutability": "view",
	"inputs": [{"name": "user", "type": "address"}],
	"outputs": [
		{"name": "totalCollateralBase", "type": "uint256"},
		{"name": "totalDebtBase", "type": "uint256"},
		{"name": "availableBorrowsBase", "type": "uint256"},
		{"name": "currentLiquidationThreshold", "type": "uint256"},
		{"name": "ltv", "type": "uint256"},
		{"name": "healthFactor", "type": "uint256"}
	]
}]`)

// poolUserConfigurationABI: getUserConfiguration(user) →
// DataTypes.UserConfigurationMap, i.e. a single packed uint256. Provenance:
// Aave v3 IPool + DataTypes.sol. Bit law: for reserve index i,
// bit 2i = borrowing, bit 2i+1 = using-as-collateral (UserConfiguration.sol).
// This read is the Aave gate's DECLARED input:pinned-read for collateral
// flags — chain-truth R5.5: the event-derived flag witness is the
// collateral-flag micro-wave's deliverable and is NOT consumed here.
// Selector 0x4417a583.
var poolUserConfigurationABI = mustParseABI(`[{
	"type": "function", "name": "getUserConfiguration", "stateMutability": "view",
	"inputs": [{"name": "user", "type": "address"}],
	"outputs": [{"name": "", "type": "tuple", "components": [
		{"name": "data", "type": "uint256"}
	]}]
}]`)

// poolUserEModeABI: getUserEMode(user) → uint256 category. Provenance: Aave v3
// IPool. Asserted == 0 per cohort account and GATED (risk-quant R1: nonzero is
// a gated FAIL, never a skip — the non-eMode HF branch would be the wrong
// law). Selector 0xeddf1b79.
var poolUserEModeABI = mustParseABI(`[{
	"type": "function", "name": "getUserEMode", "stateMutability": "view",
	"inputs": [{"name": "user", "type": "address"}],
	"outputs": [{"name": "", "type": "uint256"}]
}]`)

// poolGetConfigurationABI: getConfiguration(asset) →
// DataTypes.ReserveConfigurationMap, a single packed uint256. Provenance: Aave
// v3 IPool + ReserveConfiguration.sol bit layout: bits 0-15 LTV, 16-31
// liquidation threshold, 32-47 liquidation bonus, 48-55 decimals, 56 active,
// 57 frozen, 58 borrowing-enabled, 60 paused. The param weld's B side (the
// CHAIN, the expected side per chain-truth R2/R5). Selector 0xc44b11f7.
var poolGetConfigurationABI = mustParseABI(`[{
	"type": "function", "name": "getConfiguration", "stateMutability": "view",
	"inputs": [{"name": "asset", "type": "address"}],
	"outputs": [{"name": "", "type": "tuple", "components": [
		{"name": "data", "type": "uint256"}
	]}]
}]`)

// poolNormalizedIncomeABI: getReserveNormalizedIncome(asset) → uint256 (ray).
// Provenance: Aave v3 IPool. This is the COLLATERAL-side index at the pin, and
// it is a PINNED READ by law (risk-quant R1): our rate_indexes row is the last
// ReserveDataUpdated and can trail the pin by hundreds of thousands of blocks,
// so consuming it would launder index lag through integer arithmetic.
// Selector 0xd15e0053.
var poolNormalizedIncomeABI = mustParseABI(`[{
	"type": "function", "name": "getReserveNormalizedIncome", "stateMutability": "view",
	"inputs": [{"name": "asset", "type": "address"}],
	"outputs": [{"name": "", "type": "uint256"}]
}]`)

// aaveOracleGetAssetPriceABI: getAssetPrice(asset) → uint256 (base-currency
// units, 8-dec on this instance). Provenance: Aave v3 IAaveOracle
// (0x43b64f28A678944E0655404B0B98E443851cC34F, set once at genesis and never
// changed — recon/p3-probes.md configurator sweep). Two DISTINCT uses:
// (a) the HF gate's pinned gate price at the run pin; (b) the adapter-output
// weld, re-read at each sampled row's OWN STORED ANCHOR HASH (chain-truth R1,
// first read family) — never at the run pin, because re-reading at a different
// block manufactures drift out of honest price movement.
// Selector 0xb3596f07.
var aaveOracleGetAssetPriceABI = mustParseABI(`[{
	"type": "function", "name": "getAssetPrice", "stateMutability": "view",
	"inputs": [{"name": "asset", "type": "address"}],
	"outputs": [{"name": "", "type": "uint256"}]
}]`)

// --- Debt Manager / CashLens views -----------------------------------------

// dmCollateralTokenConfigABI: collateralTokenConfig(token) →
// (uint80 ltv, uint80 liquidationThreshold, uint96 liquidationBonus).
// Provenance: DebtManagerStorageContract.sol:58-62 (struct
// CollateralTokenConfig) via DebtManagerCore.sol:47. Denominator is
// HUNDRED_PERCENT = 100e18, NEVER bps — a unit mix here is a 1e16× error in a
// liquidation threshold. These fields feed getMaxBorrowAmount, so one wrong
// threshold is a wrong boolean for the token's whole cohort (risk-quant R4.4).
// Selector 0xf0ba097e.
var dmCollateralTokenConfigABI = mustParseABI(`[{
	"type": "function", "name": "collateralTokenConfig", "stateMutability": "view",
	"inputs": [{"name": "collateralToken", "type": "address"}],
	"outputs": [{"name": "", "type": "tuple", "components": [
		{"name": "ltv", "type": "uint80"},
		{"name": "liquidationThreshold", "type": "uint80"},
		{"name": "liquidationBonus", "type": "uint96"}
	]}]
}]`)

// dmGetCollateralTokensABI: getCollateralTokens() → address[]. Provenance:
// DebtManagerCore.sol:55. The CHAIN's own collateral universe at the pin —
// half of the authoritative enumeration `getCollateralTokens() ∪
// getBorrowTokens()` that both the param weld and the tokenConfig sweep count
// their coverage floors against (chain-truth R2: never against feeds.json,
// which is the CLAIM). Selector 0xb58eb63f.
var dmGetCollateralTokensABI = mustParseABI(`[{
	"type": "function", "name": "getCollateralTokens", "stateMutability": "view",
	"inputs": [],
	"outputs": [{"name": "", "type": "address[]"}]
}]`)

// dmLiquidatableABI: liquidatable(user) → bool. Provenance:
// DebtManagerCore.sol:126-130 — `borrowingOf(user).total >
// getMaxBorrowAmount(user, false)`, STRICT: equality is healthy. The DM
// boolean weld's chain side. Selector 0xffec70af.
var dmLiquidatableABI = mustParseABI(`[{
	"type": "function", "name": "liquidatable", "stateMutability": "view",
	"inputs": [{"name": "user", "type": "address"}],
	"outputs": [{"name": "", "type": "bool"}]
}]`)

// dmGetMaxBorrowAmountABI: getMaxBorrowAmount(user, forLtv) → uint256 (USD
// 6-dec). Provenance: DebtManagerCore.sol:139-165 —
// Σ mulDiv(collatUsdᵢ, LTᵢ, HUNDRED_PERCENT, Floor) with the floor applied PER
// TOKEN then summed. Recorded as the boundary-margin evidence column beside
// our own MaxBorrowLT so a boolean disagreement can be localised to a token
// rather than reported as "the boolean differs". Selector 0xcebcff89.
var dmGetMaxBorrowAmountABI = mustParseABI(`[{
	"type": "function", "name": "getMaxBorrowAmount", "stateMutability": "view",
	"inputs": [
		{"name": "user", "type": "address"},
		{"name": "forLtv", "type": "bool"}
	],
	"outputs": [{"name": "", "type": "uint256"}]
}]`)

// dmConvertCollateralToUsdABI: convertCollateralTokenToUsd(token, amount) →
// uint256 (USD 6-dec). Provenance: DebtManagerCore.sol:375-379 —
// `(amount × IPriceProvider(dataProvider.getPriceProvider()).price(token)) /
// 10^decimals(token)`.
//
// WHY THIS AND NOT PriceProviderV2.price DIRECTLY, for the historical pins:
// the price provider is resolved through etherFiDataProvider AT THE CALLED
// BLOCK, so calling it with amount = 10^decimals returns floor(10^dec × P /
// 10^dec) = P EXACTLY — the price the engine itself would have charged at that
// block, with no assumption that today's provider address was the provider
// then. feeds.json's provider address is a CLAIM (chain-truth R2) and is
// welded against this read at the run pin rather than trusted at 150M.
// Selector 0xc5b66b4a.
var dmConvertCollateralToUsdABI = mustParseABI(`[{
	"type": "function", "name": "convertCollateralTokenToUsd", "stateMutability": "view",
	"inputs": [
		{"name": "collateralToken", "type": "address"},
		{"name": "collateralAmount", "type": "uint256"}
	],
	"outputs": [{"name": "", "type": "uint256"}]
}]`)

// --- PriceProviderV2 (the tokenConfig sweep) --------------------------------

// priceProviderPriceABI: price(token) → uint256 (USD 6-dec on this
// deployment). Provenance: recon/cash-v3/src/oracle/PriceProviderV2.sol:250.
// Read at the run pin ONLY, to weld feeds.json's claimed provider address
// against the address the Debt Manager actually charges against (see
// dmConvertCollateralToUsdABI). Selector 0xaea91078.
var priceProviderPriceABI = mustParseABI(`[{
	"type": "function", "name": "price", "stateMutability": "view",
	"inputs": [{"name": "token", "type": "address"}],
	"outputs": [{"name": "", "type": "uint256"}]
}]`)

// priceProviderTokenConfigABI: tokenConfig(token) → Config. Provenance:
// PriceProviderV2.sol:40-58 (struct Config) via :196-198, field order
// verbatim: oracle, priceFunctionCalldata, isChainlinkType,
// oraclePriceDecimals, maxStaleness, dataType (enum ReturnType → uint8),
// isStableToken, baseAsset.
//
// SCHEMA LABEL (chain-truth R3.1): this is a SAMPLE, not ledger. The provider
// is not in the walker stream set, so its setTokenConfig-class mutations are
// NOT in custody; every swept row is labeled input:pinned-read and stamped
// with (pin block, pin hash, provider address), with NO continuity claim
// between runs. Selector 0xfe136c4e.
var priceProviderTokenConfigABI = mustParseABI(`[{
	"type": "function", "name": "tokenConfig", "stateMutability": "view",
	"inputs": [{"name": "token", "type": "address"}],
	"outputs": [{"name": "", "type": "tuple", "components": [
		{"name": "oracle", "type": "address"},
		{"name": "priceFunctionCalldata", "type": "bytes"},
		{"name": "isChainlinkType", "type": "bool"},
		{"name": "oraclePriceDecimals", "type": "uint8"},
		{"name": "maxStaleness", "type": "uint24"},
		{"name": "dataType", "type": "uint8"},
		{"name": "isStableToken", "type": "bool"},
		{"name": "baseAsset", "type": "address"}
	]}]
}]`)

// priceProviderIsBaseAssetABI: isBaseAsset(token) → bool. Provenance:
// PriceProviderV2.sol (the second storage mapping, :66-69). Recorded per
// swept token so the baseAsset transitive closure can state whether each
// terminal node the chain names is actually registered as a base asset.
// Selector 0x2175fe3d.
var priceProviderIsBaseAssetABI = mustParseABI(`[{
	"type": "function", "name": "isBaseAsset", "stateMutability": "view",
	"inputs": [{"name": "token", "type": "address"}],
	"outputs": [{"name": "", "type": "bool"}]
}]`)

// --- ERC-20 / proxy / multicall helpers -------------------------------------

// erc20DecimalsABI: decimals() → uint8. Provenance: ERC-20. The 10^dec
// valuation denominator: risk-quant R4.5 gates it against the registry,
// because a wrong denominator is a 10^n price error, not a rounding
// difference. Selector 0x313ce567.
var erc20DecimalsABI = mustParseABI(`[{
	"type": "function", "name": "decimals", "stateMutability": "view",
	"inputs": [],
	"outputs": [{"name": "", "type": "uint8"}]
}]`)

// chainlinkProxyAggregatorABI: aggregator() → address. Provenance: Chainlink
// EACAggregatorProxy. The B3 phase-change check (chain-truth R4.2): a
// Chainlink proxy re-points its aggregator on a phase change, which makes OUR
// walked raw aggregator go permanently quiet while the feed lives on at a new
// address — indistinguishable from a heartbeat stop inside raw_logs alone. Any
// gap open-ended at the scan head, and any gap > 2× the published heartbeat,
// consults this read FIRST; a mismatch is "stream requires re-resolution", its
// own failure class, NOT a heartbeat verdict and NOT a pass.
// Selector 0x245a7bfc.
var chainlinkProxyAggregatorABI = mustParseABI(`[{
	"type": "function", "name": "aggregator", "stateMutability": "view",
	"inputs": [],
	"outputs": [{"name": "", "type": "address"}]
}]`)

// multicall3GetBlockHashABI: getBlockHash(blockNumber) → bytes32. Provenance:
// canonical Multicall3 (same address every major EVM chain, already pinned by
// multicall3Address).
//
// WHY THIS EXISTS — the parent-hash problem, and why it is NOT a fresh
// number→hash resolution: the backtest's three-state intra-block law
// (chain-truth R1) evaluates eligibility at N−1, but raw_logs stores the hash
// of N, not of N−1, and chain-truth R1 bans resolving a backtest pin by
// number. Multicall3.getBlockHash executes the EVM BLOCKHASH opcode INSIDE the
// call, so calling it AT pinHash(N) returns the parent hash as block N's own
// state asserts it. The N−1 hash is therefore DERIVED FROM THE PIN, through
// the same door our logs went through, rather than asked of a provider by
// height. (BLOCKHASH covers the last 256 ancestors; N−1 is one back.)
// Selector 0xee82ac5e.
var multicall3GetBlockHashABI = mustParseABI(`[{
	"type": "function", "name": "getBlockHash", "stateMutability": "view",
	"inputs": [{"name": "blockNumber", "type": "uint256"}],
	"outputs": [{"name": "blockHash", "type": "bytes32"}]
}]`)

// --- strict unpackers -------------------------------------------------------

// userAccountData is the decoded getUserAccountData tuple.
type userAccountData struct {
	TotalCollateralBase         *big.Int
	TotalDebtBase               *big.Int
	AvailableBorrowsBase        *big.Int
	CurrentLiquidationThreshold *big.Int
	LTV                         *big.Int
	HealthFactor                *big.Int
}

// unpackUserAccountData decodes the six-component tuple, refusing empty
// returndata and any arity other than six.
func unpackUserAccountData(ret []byte) (out userAccountData, err error) {
	if err := requireNonEmpty("getUserAccountData", ret); err != nil {
		return userAccountData{}, err
	}
	vals, err := poolUserAccountDataABI.Unpack("getUserAccountData", ret)
	if err != nil {
		return userAccountData{}, fmt.Errorf("unpack getUserAccountData: %w", err)
	}
	if len(vals) != 6 {
		return userAccountData{}, fmt.Errorf("unpack getUserAccountData: expected 6 values, got %d", len(vals))
	}
	dst := []**big.Int{
		&out.TotalCollateralBase, &out.TotalDebtBase, &out.AvailableBorrowsBase,
		&out.CurrentLiquidationThreshold, &out.LTV, &out.HealthFactor,
	}
	for i, d := range dst {
		v, ok := vals[i].(*big.Int)
		if !ok || v == nil {
			return userAccountData{}, fmt.Errorf("unpack getUserAccountData: component %d is %T, not *big.Int", i, vals[i])
		}
		*d = new(big.Int).Set(v)
	}
	return out, nil
}

// unpackPackedUint256Struct decodes a single-field struct wrapping one
// uint256 — the shape of BOTH getUserConfiguration and getConfiguration
// (DataTypes.UserConfigurationMap / ReserveConfigurationMap). It refuses empty
// returndata and any struct that is not exactly one field.
func unpackPackedUint256Struct(a abi.ABI, method string, ret []byte) (*big.Int, error) {
	if err := requireNonEmpty(method, ret); err != nil {
		return nil, err
	}
	vals, err := a.Unpack(method, ret)
	if err != nil {
		return nil, fmt.Errorf("unpack %s: %w", method, err)
	}
	if len(vals) != 1 {
		return nil, fmt.Errorf("unpack %s: expected 1 value, got %d", method, len(vals))
	}
	el := reflect.ValueOf(vals[0])
	if el.Kind() != reflect.Struct || el.NumField() != 1 {
		return nil, fmt.Errorf("unpack %s: value is %T, not the 1-field packed tuple", method, vals[0])
	}
	v, ok := el.Field(0).Interface().(*big.Int)
	if !ok || v == nil {
		return nil, fmt.Errorf("unpack %s: packed field is not a *big.Int", method)
	}
	return new(big.Int).Set(v), nil
}

// unpackUint256Strict is unpackUint256 with the len==0 refusal in front. Every
// NEW single-uint256 read (normalized income, asset price, max borrow, engine
// price) goes through this one, never through the pre-existing lenient helper.
func unpackUint256Strict(a abi.ABI, method string, ret []byte) (*big.Int, error) {
	if err := requireNonEmpty(method, ret); err != nil {
		return nil, err
	}
	return unpackUint256(a, method, ret)
}

// unpackBoolStrict decodes a single-bool return, refusing empty returndata.
func unpackBoolStrict(a abi.ABI, method string, ret []byte) (bool, error) {
	if err := requireNonEmpty(method, ret); err != nil {
		return false, err
	}
	vals, err := a.Unpack(method, ret)
	if err != nil {
		return false, fmt.Errorf("unpack %s: %w", method, err)
	}
	if len(vals) != 1 {
		return false, fmt.Errorf("unpack %s: expected 1 value, got %d", method, len(vals))
	}
	v, ok := vals[0].(bool)
	if !ok {
		return false, fmt.Errorf("unpack %s: value is %T, not bool", method, vals[0])
	}
	return v, nil
}

// unpackUint8Strict decodes a single-uint8 return (decimals), refusing empty
// returndata. Some tokens answer decimals() as uint256; go-ethereum decodes by
// the ABI we declare, so a 32-byte answer still decodes to uint8 correctly
// while a SHORT answer is refused by Unpack.
func unpackUint8Strict(a abi.ABI, method string, ret []byte) (uint8, error) {
	if err := requireNonEmpty(method, ret); err != nil {
		return 0, err
	}
	vals, err := a.Unpack(method, ret)
	if err != nil {
		return 0, fmt.Errorf("unpack %s: %w", method, err)
	}
	if len(vals) != 1 {
		return 0, fmt.Errorf("unpack %s: expected 1 value, got %d", method, len(vals))
	}
	v, ok := vals[0].(uint8)
	if !ok {
		return 0, fmt.Errorf("unpack %s: value is %T, not uint8", method, vals[0])
	}
	return v, nil
}

// unpackAddressStrict decodes a single-address return, refusing empty
// returndata (the aggregator() phase check must never read a zero address as
// "the proxy points at address zero").
func unpackAddressStrict(a abi.ABI, method string, ret []byte) (common.Address, error) {
	if err := requireNonEmpty(method, ret); err != nil {
		return common.Address{}, err
	}
	return unpackAddress(a, method, ret)
}

// unpackAddressListStrict decodes a single-address[] return, refusing empty
// returndata. An EMPTY LIST is a legal chain answer and stays legal — it is
// the empty BYTES that are refused, which is exactly the distinction R1.4
// demands.
func unpackAddressListStrict(a abi.ABI, method string, ret []byte) ([]common.Address, error) {
	if err := requireNonEmpty(method, ret); err != nil {
		return nil, err
	}
	return unpackAddressList(a, method, ret)
}

// unpackBytes32Strict decodes a single-bytes32 return (getBlockHash).
func unpackBytes32Strict(a abi.ABI, method string, ret []byte) (common.Hash, error) {
	if err := requireNonEmpty(method, ret); err != nil {
		return common.Hash{}, err
	}
	vals, err := a.Unpack(method, ret)
	if err != nil {
		return common.Hash{}, fmt.Errorf("unpack %s: %w", method, err)
	}
	if len(vals) != 1 {
		return common.Hash{}, fmt.Errorf("unpack %s: expected 1 value, got %d", method, len(vals))
	}
	v, ok := vals[0].([32]byte)
	if !ok {
		return common.Hash{}, fmt.Errorf("unpack %s: value is %T, not bytes32", method, vals[0])
	}
	return common.Hash(v), nil
}

// collateralTokenConfigResult is the decoded DM collateralTokenConfig tuple.
// All three fields are HUNDRED_PERCENT-denominated (100e18).
type collateralTokenConfigResult struct {
	LTV                  *big.Int
	LiquidationThreshold *big.Int
	LiquidationBonus     *big.Int
}

// unpackCollateralTokenConfig decodes the 3-field tuple. go-ethereum widens
// uint80/uint96 to *big.Int.
func unpackCollateralTokenConfig(ret []byte) (cfg collateralTokenConfigResult, err error) {
	defer func() {
		if rec := recover(); rec != nil {
			cfg, err = collateralTokenConfigResult{}, fmt.Errorf("unpack collateralTokenConfig: recovered panic: %v", rec)
		}
	}()
	if err := requireNonEmpty("collateralTokenConfig", ret); err != nil {
		return collateralTokenConfigResult{}, err
	}
	vals, err := dmCollateralTokenConfigABI.Unpack("collateralTokenConfig", ret)
	if err != nil {
		return collateralTokenConfigResult{}, fmt.Errorf("unpack collateralTokenConfig: %w", err)
	}
	if len(vals) != 1 {
		return collateralTokenConfigResult{}, fmt.Errorf("unpack collateralTokenConfig: expected 1 value, got %d", len(vals))
	}
	el := reflect.ValueOf(vals[0])
	if el.Kind() != reflect.Struct || el.NumField() != 3 {
		return collateralTokenConfigResult{}, fmt.Errorf("unpack collateralTokenConfig: value is %T, not the 3-field tuple", vals[0])
	}
	for i, dst := range []**big.Int{&cfg.LTV, &cfg.LiquidationThreshold, &cfg.LiquidationBonus} {
		v, ok := el.Field(i).Interface().(*big.Int)
		if !ok || v == nil {
			return collateralTokenConfigResult{}, fmt.Errorf("unpack collateralTokenConfig: field %d is %T, not *big.Int", i, el.Field(i).Interface())
		}
		*dst = new(big.Int).Set(v)
	}
	return cfg, nil
}

// tokenConfigResult is the decoded PriceProviderV2 Config struct, field order
// verbatim from PriceProviderV2.sol:40-58.
type tokenConfigResult struct {
	Oracle                common.Address
	PriceFunctionCalldata []byte
	IsChainlinkType       bool
	OraclePriceDecimals   uint8
	MaxStaleness          *big.Int // uint24 widened by go-ethereum
	DataType              uint8    // enum ReturnType: 0 = Int256, 1 = Uint256
	IsStableToken         bool
	BaseAsset             common.Address
}

// unpackTokenConfig decodes the Config struct. An ABI-skew failure here is
// weld-unread, never a partial decode (the buildDMWeldReads pattern,
// dm.go:402-418, applied to the sweep).
func unpackTokenConfig(ret []byte) (cfg tokenConfigResult, err error) {
	defer func() {
		if rec := recover(); rec != nil {
			cfg, err = tokenConfigResult{}, fmt.Errorf("unpack tokenConfig: recovered panic: %v", rec)
		}
	}()
	if err := requireNonEmpty("tokenConfig", ret); err != nil {
		return tokenConfigResult{}, err
	}
	vals, err := priceProviderTokenConfigABI.Unpack("tokenConfig", ret)
	if err != nil {
		return tokenConfigResult{}, fmt.Errorf("unpack tokenConfig: %w", err)
	}
	if len(vals) != 1 {
		return tokenConfigResult{}, fmt.Errorf("unpack tokenConfig: expected 1 value, got %d", len(vals))
	}
	el := reflect.ValueOf(vals[0])
	if el.Kind() != reflect.Struct || el.NumField() != 8 {
		return tokenConfigResult{}, fmt.Errorf("unpack tokenConfig: value is %T, not the 8-field Config tuple", vals[0])
	}
	oracle, ok := el.Field(0).Interface().(common.Address)
	if !ok {
		return tokenConfigResult{}, fmt.Errorf("unpack tokenConfig: oracle is not an address")
	}
	calldata, ok := el.Field(1).Interface().([]byte)
	if !ok {
		return tokenConfigResult{}, fmt.Errorf("unpack tokenConfig: priceFunctionCalldata is not bytes")
	}
	isChainlink, ok := el.Field(2).Interface().(bool)
	if !ok {
		return tokenConfigResult{}, fmt.Errorf("unpack tokenConfig: isChainlinkType is not a bool")
	}
	oracleDec, ok := el.Field(3).Interface().(uint8)
	if !ok {
		return tokenConfigResult{}, fmt.Errorf("unpack tokenConfig: oraclePriceDecimals is not a uint8")
	}
	stale, ok := el.Field(4).Interface().(*big.Int)
	if !ok || stale == nil {
		return tokenConfigResult{}, fmt.Errorf("unpack tokenConfig: maxStaleness is not a *big.Int")
	}
	dataType, ok := el.Field(5).Interface().(uint8)
	if !ok {
		return tokenConfigResult{}, fmt.Errorf("unpack tokenConfig: dataType is not a uint8")
	}
	isStable, ok := el.Field(6).Interface().(bool)
	if !ok {
		return tokenConfigResult{}, fmt.Errorf("unpack tokenConfig: isStableToken is not a bool")
	}
	base, ok := el.Field(7).Interface().(common.Address)
	if !ok {
		return tokenConfigResult{}, fmt.Errorf("unpack tokenConfig: baseAsset is not an address")
	}
	return tokenConfigResult{
		Oracle: oracle, PriceFunctionCalldata: calldata, IsChainlinkType: isChainlink,
		OraclePriceDecimals: oracleDec, MaxStaleness: new(big.Int).Set(stale),
		DataType: dataType, IsStableToken: isStable, BaseAsset: base,
	}, nil
}

// --- Aave bit decoders (pure, unit-tested) ---------------------------------

// aaveReserveConfig is the decoded ReserveConfigurationMap.
type aaveReserveConfig struct {
	LTVBps                  *big.Int
	LiquidationThresholdBps *big.Int
	LiquidationBonusBps     *big.Int
	Decimals                uint8
	Active                  bool
	Frozen                  bool
	BorrowingEnabled        bool
	Paused                  bool
}

// decodeAaveReserveConfig unpacks the ReserveConfigurationMap bit layout
// (Aave v3 ReserveConfiguration.sol): bits 0-15 LTV, 16-31 liquidation
// threshold, 32-47 liquidation bonus, 48-55 decimals, 56 active, 57 frozen,
// 58 borrowing-enabled, 60 paused. All three ratios are BASIS POINTS (1e4).
func decodeAaveReserveConfig(packed *big.Int) aaveReserveConfig {
	field := func(shift, width uint) *big.Int {
		mask := new(big.Int).Lsh(big.NewInt(1), width)
		mask.Sub(mask, big.NewInt(1))
		out := new(big.Int).Rsh(packed, shift)
		return out.And(out, mask)
	}
	return aaveReserveConfig{
		LTVBps:                  field(0, 16),
		LiquidationThresholdBps: field(16, 16),
		LiquidationBonusBps:     field(32, 16),
		Decimals:                uint8(field(48, 8).Uint64()),
		Active:                  packed.Bit(56) == 1,
		Frozen:                  packed.Bit(57) == 1,
		BorrowingEnabled:        packed.Bit(58) == 1,
		Paused:                  packed.Bit(60) == 1,
	}
}

// aaveUserFlags is one reserve's pair of user-configuration bits.
type aaveUserFlags struct {
	Borrowing        bool
	UsedAsCollateral bool
}

// decodeAaveUserConfiguration unpacks the UserConfigurationMap for the reserve
// at index i of getReservesList(): bit 2i = borrowing, bit 2i+1 =
// using-as-collateral (Aave v3 UserConfiguration.sol). The reserve INDEX is
// the position in getReservesList()@pin, which is why that list is read at the
// same pin and never cached across pins.
func decodeAaveUserConfiguration(packed *big.Int, reserveIndex int) aaveUserFlags {
	if packed == nil || reserveIndex < 0 {
		return aaveUserFlags{}
	}
	return aaveUserFlags{
		Borrowing:        packed.Bit(2*reserveIndex) == 1,
		UsedAsCollateral: packed.Bit(2*reserveIndex+1) == 1,
	}
}
