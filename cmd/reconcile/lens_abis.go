// Hand-authored SINGLE-METHOD lens ABIs (brief §5). Each view this harness
// calls gets its own one-method ABI with a provenance comment naming the
// verified source ABI it was transcribed from; the two borrowingOf overloads
// are TWO SEPARATE ABIs, which sidesteps go-ethereum's `borrowingOf0`
// overload-mangling entirely — pack and unpack always name the method by its
// unambiguous single-method name. Selectors are pinned by unit tests against
// crypto.Keccak256 AND hardcoded hex (lens_abis_test.go), so a transcription
// typo in any input tuple cannot survive.
package main

import (
	"fmt"
	"math/big"
	"reflect"
	"strings"

	"github.com/ethereum/go-ethereum/accounts/abi"
	"github.com/ethereum/go-ethereum/common"
)

func mustParseABI(jsonArray string) abi.ABI {
	parsed, err := abi.JSON(strings.NewReader(jsonArray))
	if err != nil {
		panic(fmt.Sprintf("reconcile: build abi: %v", err))
	}
	return parsed
}

// dmBorrowingOfAllABI: borrowingOf(user) → (TokenData[] borrowTokenData,
// uint256 totalBorrowingInUsd). Provenance: recon/abis/DebtManagerCore.json
// (the one-arg overload; the contract assembly-trims the array to NONZERO
// tokens only — DebtManagerStorageContract.sol:575-605 — which is why the DB
// side of the set equality is zero-filtered too, brief §3.3). Selector
// 0x186c66cc.
var dmBorrowingOfAllABI = mustParseABI(`[{
	"type": "function", "name": "borrowingOf", "stateMutability": "view",
	"inputs": [{"name": "user", "type": "address"}],
	"outputs": [
		{"name": "", "type": "tuple[]", "components": [
			{"name": "token", "type": "address"},
			{"name": "amount", "type": "uint256"}
		]},
		{"name": "", "type": "uint256"}
	]
}]`)

// dmBorrowingOfOneABI: borrowingOf(user, borrowToken) → uint256. Provenance:
// recon/abis/DebtManagerCore.json (the two-arg overload — its own ABI so the
// overload pair never coexists in one abi.ABI). Selector 0x4142152e.
var dmBorrowingOfOneABI = mustParseABI(`[{
	"type": "function", "name": "borrowingOf", "stateMutability": "view",
	"inputs": [
		{"name": "user", "type": "address"},
		{"name": "borrowToken", "type": "address"}
	],
	"outputs": [{"name": "", "type": "uint256"}]
}]`)

// dmGetCurrentIndexABI: getCurrentIndex(borrowToken) → uint256 (1e18 index).
// Provenance: recon/abis/DebtManagerCore.json;
// DebtManagerStorageContract.sol:559-567. Selector 0x64752eec.
var dmGetCurrentIndexABI = mustParseABI(`[{
	"type": "function", "name": "getCurrentIndex", "stateMutability": "view",
	"inputs": [{"name": "borrowToken", "type": "address"}],
	"outputs": [{"name": "", "type": "uint256"}]
}]`)

// dmCollateralOfABI: collateralOf(user) → (TokenData[], uint256 totalUsd).
// Provenance: recon/abis/DebtManagerCore.json — the SAME lens the collateral
// sweeper calls (internal/snapshot's dmLensABI), re-declared here because the
// deep collateral replay re-executes the sweeper's read. Selector 0x1aefb107
// (pinned identically by internal/snapshot's TestRequestShape).
var dmCollateralOfABI = mustParseABI(`[{
	"type": "function", "name": "collateralOf", "stateMutability": "view",
	"inputs": [{"name": "user", "type": "address"}],
	"outputs": [
		{"name": "", "type": "tuple[]", "components": [
			{"name": "token", "type": "address"},
			{"name": "amount", "type": "uint256"}
		]},
		{"name": "", "type": "uint256"}
	]
}]`)

// dmGetBorrowTokensABI: getBorrowTokens() → address[]. Provenance:
// recon/abis/DebtManagerCore.json. Selector 0x5a52477a.
var dmGetBorrowTokensABI = mustParseABI(`[{
	"type": "function", "name": "getBorrowTokens", "stateMutability": "view",
	"inputs": [],
	"outputs": [{"name": "", "type": "address[]"}]
}]`)

// dmBorrowTokenConfigABI: borrowTokenConfig(borrowToken) → BorrowTokenConfig.
// Provenance: recon/abis/DebtManagerCore.json (struct
// DebtManagerStorageContract.BorrowTokenConfig). The F1 aggregate weld reads
// totalNormalizedBorrowingAmount: every contract mutation moves that total
// and the per-user map by the SAME integer (DebtManagerCore.sol:472-473
// borrow, :599 repay, :579-580 liquidation, :551-552 residue), so
// Σ derived-per-account == this total is a ZERO-bound census weld.
// Selector 0x7e5cdc5e.
var dmBorrowTokenConfigABI = mustParseABI(`[{
	"type": "function", "name": "borrowTokenConfig", "stateMutability": "view",
	"inputs": [{"name": "borrowToken", "type": "address"}],
	"outputs": [{"name": "", "type": "tuple", "components": [
		{"name": "interestIndexSnapshot", "type": "uint256"},
		{"name": "totalNormalizedBorrowingAmount", "type": "uint256"},
		{"name": "totalSharesOfBorrowTokens", "type": "uint256"},
		{"name": "lastUpdateTimestamp", "type": "uint64"},
		{"name": "borrowApy", "type": "uint64"},
		{"name": "minShares", "type": "uint128"}
	]}]
}]`)

// aaveScaledBalanceOfABI: scaledBalanceOf(user) → uint256. Provenance: Aave
// v3 IScaledBalanceToken (recon/abis, aToken/variableDebtToken surfaces);
// identical selector on both token kinds. Selector 0x1da24f3e.
var aaveScaledBalanceOfABI = mustParseABI(`[{
	"type": "function", "name": "scaledBalanceOf", "stateMutability": "view",
	"inputs": [{"name": "user", "type": "address"}],
	"outputs": [{"name": "", "type": "uint256"}]
}]`)

// aaveScaledTotalSupplyABI: scaledTotalSupply() → uint256. Provenance: Aave
// v3 IScaledBalanceToken — the F1 Aave weld's chain side (mint/burn move
// user scaled and total by the same rayDiv result; BalanceTransfer
// conserves; the DeficitCreated burn is included). Selector 0xb1bf962d.
var aaveScaledTotalSupplyABI = mustParseABI(`[{
	"type": "function", "name": "scaledTotalSupply", "stateMutability": "view",
	"inputs": [],
	"outputs": [{"name": "", "type": "uint256"}]
}]`)

// erc20BalanceOfABI: balanceOf(user) → uint256. Provenance: ERC-20; on the
// variable debt token this is the LIVE debt value (scaled × index, half-up)
// — the right side of the §3.4(b) live-value identity. Selector 0x70a08231.
var erc20BalanceOfABI = mustParseABI(`[{
	"type": "function", "name": "balanceOf", "stateMutability": "view",
	"inputs": [{"name": "user", "type": "address"}],
	"outputs": [{"name": "", "type": "uint256"}]
}]`)

// poolReserveDebtTokenABI: getReserveVariableDebtToken(asset) → address.
// Provenance: Aave v3.2+ Pool (the deployed ether.fi Pool is a v3.3-line
// instance — recon/derivation-notes.md). Resolved AT THE PIN so the debt
// token address itself carries no porting risk. Selector 0x365090a0.
var poolReserveDebtTokenABI = mustParseABI(`[{
	"type": "function", "name": "getReserveVariableDebtToken", "stateMutability": "view",
	"inputs": [{"name": "asset", "type": "address"}],
	"outputs": [{"name": "", "type": "address"}]
}]`)

// poolReservesListABI: getReservesList() → address[]. Provenance: Aave v3
// Pool. THE AUTHORITATIVE Aave weld universe source (round-10 F3): the F1
// welds iterate getReservesList(@pin) ∪ derived-assets, so a reserve the DB
// never derived — the exact phantom-debt shape risk-quant F1 names — still
// gets a weld row, and an unreadable leg surfaces as weld-unread instead of
// silently vanishing. Selector 0xd1946dbc.
var poolReservesListABI = mustParseABI(`[{
	"type": "function", "name": "getReservesList", "stateMutability": "view",
	"inputs": [],
	"outputs": [{"name": "", "type": "address[]"}]
}]`)

// poolReserveATokenABI: getReserveAToken(asset) → address. Provenance: Aave
// v3.2+ Pool (same lens family as getReserveVariableDebtToken — the
// deployed ether.fi Pool is a v3.3-line instance). Resolves the aToken for
// universe reserves the config streams don't name, so the collateral weld's
// universe stays authoritative too. Selector 0xcff027d9.
var poolReserveATokenABI = mustParseABI(`[{
	"type": "function", "name": "getReserveAToken", "stateMutability": "view",
	"inputs": [{"name": "asset", "type": "address"}],
	"outputs": [{"name": "", "type": "address"}]
}]`)

// poolNormalizedDebtABI: getReserveNormalizedVariableDebt(asset) → uint256
// (ray). Provenance: Aave v3 Pool. The §3.4(b) identity multiplies the
// derived scaled figure by THIS value at the SAME pin, so the contract does
// its own compounding — no approximation is replicated. Selector 0x386497fd.
var poolNormalizedDebtABI = mustParseABI(`[{
	"type": "function", "name": "getReserveNormalizedVariableDebt", "stateMutability": "view",
	"inputs": [{"name": "asset", "type": "address"}],
	"outputs": [{"name": "", "type": "uint256"}]
}]`)

// multicall3ABI: tryBlockAndAggregate(requireSuccess, calls) — chosen over
// aggregate3 because it returns the EXECUTION block number atomically with
// the results: the per-chunk in-band block assertion (chunk block == P,
// brief §5 multicall discipline) reads it. Provenance: canonical multicall3
// (same address every major EVM chain); selector 0x399542e9, pinned
// identically by internal/snapshot. requireSuccess=false so an individually
// reverting view is a per-row failure, not a chunk abort.
var multicall3ABI = mustParseABI(`[{
	"type": "function", "name": "tryBlockAndAggregate", "stateMutability": "payable",
	"inputs": [
		{"name": "requireSuccess", "type": "bool"},
		{"name": "calls", "type": "tuple[]", "components": [
			{"name": "target", "type": "address"},
			{"name": "callData", "type": "bytes"}
		]}
	],
	"outputs": [
		{"name": "blockNumber", "type": "uint256"},
		{"name": "blockHash", "type": "bytes32"},
		{"name": "returnData", "type": "tuple[]", "components": [
			{"name": "success", "type": "bool"},
			{"name": "returnData", "type": "bytes"}
		]}
	]
}]`)

// multicall3Address is the canonical multicall3 deployment (same address on
// OP and ETH mainnet), mirroring internal/snapshot.Multicall3Address.
var multicall3Address = common.HexToAddress("0xcA11bde05977b3631167028862bE2a173976CA11")

// tokenAmount is one decoded TokenData tuple element.
type tokenAmount struct {
	Token  common.Address
	Amount *big.Int
}

// unpackTokenAmountList decodes a (TokenData[], uint256) return — the shared
// shape of borrowingOf(address) and collateralOf(address).
func unpackTokenAmountList(a abi.ABI, method string, ret []byte) (list []tokenAmount, total *big.Int, err error) {
	defer func() {
		if rec := recover(); rec != nil {
			list, total, err = nil, nil, fmt.Errorf("unpack %s: recovered panic: %v", method, rec)
		}
	}()
	vals, err := a.Unpack(method, ret)
	if err != nil {
		return nil, nil, fmt.Errorf("unpack %s: %w", method, err)
	}
	if len(vals) != 2 {
		return nil, nil, fmt.Errorf("unpack %s: expected 2 values, got %d", method, len(vals))
	}
	tokens := reflect.ValueOf(vals[0])
	if tokens.Kind() != reflect.Slice {
		return nil, nil, fmt.Errorf("unpack %s: token list is %T, not a slice", method, vals[0])
	}
	for i := 0; i < tokens.Len(); i++ {
		el := tokens.Index(i)
		token, ok := el.Field(0).Interface().(common.Address)
		if !ok {
			return nil, nil, fmt.Errorf("unpack %s: element %d token is not an address", method, i)
		}
		amount, ok := el.Field(1).Interface().(*big.Int)
		if !ok || amount == nil {
			return nil, nil, fmt.Errorf("unpack %s: element %d carries no amount", method, i)
		}
		list = append(list, tokenAmount{Token: token, Amount: new(big.Int).Set(amount)})
	}
	total, ok := vals[1].(*big.Int)
	if !ok || total == nil {
		return nil, nil, fmt.Errorf("unpack %s: total is %T, not *big.Int", method, vals[1])
	}
	return list, new(big.Int).Set(total), nil
}

// unpackUint256 decodes a single-uint256 return.
func unpackUint256(a abi.ABI, method string, ret []byte) (*big.Int, error) {
	vals, err := a.Unpack(method, ret)
	if err != nil {
		return nil, fmt.Errorf("unpack %s: %w", method, err)
	}
	if len(vals) != 1 {
		return nil, fmt.Errorf("unpack %s: expected 1 value, got %d", method, len(vals))
	}
	v, ok := vals[0].(*big.Int)
	if !ok || v == nil {
		return nil, fmt.Errorf("unpack %s: value is %T, not *big.Int", method, vals[0])
	}
	return new(big.Int).Set(v), nil
}

// unpackAddress decodes a single-address return.
func unpackAddress(a abi.ABI, method string, ret []byte) (common.Address, error) {
	vals, err := a.Unpack(method, ret)
	if err != nil {
		return common.Address{}, fmt.Errorf("unpack %s: %w", method, err)
	}
	if len(vals) != 1 {
		return common.Address{}, fmt.Errorf("unpack %s: expected 1 value, got %d", method, len(vals))
	}
	v, ok := vals[0].(common.Address)
	if !ok {
		return common.Address{}, fmt.Errorf("unpack %s: value is %T, not address", method, vals[0])
	}
	return v, nil
}

// unpackAddressList decodes a single-address[] return (getBorrowTokens).
func unpackAddressList(a abi.ABI, method string, ret []byte) ([]common.Address, error) {
	vals, err := a.Unpack(method, ret)
	if err != nil {
		return nil, fmt.Errorf("unpack %s: %w", method, err)
	}
	if len(vals) != 1 {
		return nil, fmt.Errorf("unpack %s: expected 1 value, got %d", method, len(vals))
	}
	v, ok := vals[0].([]common.Address)
	if !ok {
		return nil, fmt.Errorf("unpack %s: value is %T, not []address", method, vals[0])
	}
	return v, nil
}

// borrowTokenConfigResult is the decoded borrowTokenConfig(token) tuple.
type borrowTokenConfigResult struct {
	InterestIndexSnapshot          *big.Int
	TotalNormalizedBorrowingAmount *big.Int
	TotalSharesOfBorrowTokens      *big.Int
	LastUpdateTimestamp            uint64
	BorrowApy                      uint64
	MinShares                      *big.Int
}

// unpackBorrowTokenConfig decodes the BorrowTokenConfig struct return.
func unpackBorrowTokenConfig(ret []byte) (cfg borrowTokenConfigResult, err error) {
	defer func() {
		if rec := recover(); rec != nil {
			cfg, err = borrowTokenConfigResult{}, fmt.Errorf("unpack borrowTokenConfig: recovered panic: %v", rec)
		}
	}()
	vals, err := dmBorrowTokenConfigABI.Unpack("borrowTokenConfig", ret)
	if err != nil {
		return borrowTokenConfigResult{}, fmt.Errorf("unpack borrowTokenConfig: %w", err)
	}
	if len(vals) != 1 {
		return borrowTokenConfigResult{}, fmt.Errorf("unpack borrowTokenConfig: expected 1 value, got %d", len(vals))
	}
	el := reflect.ValueOf(vals[0])
	if el.Kind() != reflect.Struct || el.NumField() != 6 {
		return borrowTokenConfigResult{}, fmt.Errorf("unpack borrowTokenConfig: value is %T, not the 6-field tuple", vals[0])
	}
	cfg.InterestIndexSnapshot = el.Field(0).Interface().(*big.Int)
	cfg.TotalNormalizedBorrowingAmount = el.Field(1).Interface().(*big.Int)
	cfg.TotalSharesOfBorrowTokens = el.Field(2).Interface().(*big.Int)
	cfg.LastUpdateTimestamp = el.Field(3).Interface().(uint64)
	cfg.BorrowApy = el.Field(4).Interface().(uint64)
	cfg.MinShares = el.Field(5).Interface().(*big.Int)
	if cfg.InterestIndexSnapshot == nil || cfg.TotalNormalizedBorrowingAmount == nil {
		return borrowTokenConfigResult{}, fmt.Errorf("unpack borrowTokenConfig: nil numeric field")
	}
	return cfg, nil
}

// multicallCall is one (target, callData) pair; field names map to the ABI
// component names via go-ethereum's capitalization rule.
type multicallCall struct {
	Target   common.Address `abi:"target"`
	CallData []byte         `abi:"callData"`
}

// multicallResult mirrors tryBlockAndAggregate's per-call result tuple.
type multicallResult struct {
	Success    bool   `abi:"success"`
	ReturnData []byte `abi:"returnData"`
}

// packTryBlockAndAggregate packs a chunk (requireSuccess always false: an
// individually reverting view must be a per-row failure, never a chunk
// abort).
func packTryBlockAndAggregate(calls []multicallCall) ([]byte, error) {
	data, err := multicall3ABI.Pack("tryBlockAndAggregate", false, calls)
	if err != nil {
		return nil, fmt.Errorf("pack tryBlockAndAggregate: %w", err)
	}
	return data, nil
}

// unpackTryBlockAndAggregate decodes (blockNumber, blockHash, results[]).
func unpackTryBlockAndAggregate(ret []byte) (blockNumber *big.Int, blockHash common.Hash, results []multicallResult, err error) {
	defer func() {
		if rec := recover(); rec != nil {
			blockNumber, results, err = nil, nil, fmt.Errorf("unpack tryBlockAndAggregate: recovered panic: %v", rec)
		}
	}()
	vals, err := multicall3ABI.Unpack("tryBlockAndAggregate", ret)
	if err != nil {
		return nil, common.Hash{}, nil, fmt.Errorf("unpack tryBlockAndAggregate: %w", err)
	}
	if len(vals) != 3 {
		return nil, common.Hash{}, nil, fmt.Errorf("unpack tryBlockAndAggregate: expected 3 values, got %d", len(vals))
	}
	blockNumber, ok := vals[0].(*big.Int)
	if !ok || blockNumber == nil {
		return nil, common.Hash{}, nil, fmt.Errorf("unpack tryBlockAndAggregate: blockNumber is %T", vals[0])
	}
	hashBytes, ok := vals[1].([32]byte)
	if !ok {
		return nil, common.Hash{}, nil, fmt.Errorf("unpack tryBlockAndAggregate: blockHash is %T", vals[1])
	}
	raw := reflect.ValueOf(vals[2])
	if raw.Kind() != reflect.Slice {
		return nil, common.Hash{}, nil, fmt.Errorf("unpack tryBlockAndAggregate: results is %T, not a slice", vals[2])
	}
	for i := 0; i < raw.Len(); i++ {
		el := raw.Index(i)
		results = append(results, multicallResult{
			Success:    el.Field(0).Interface().(bool),
			ReturnData: el.Field(1).Interface().([]byte),
		})
	}
	return blockNumber, common.Hash(hashBytes), results, nil
}
