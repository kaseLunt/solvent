// Package decode provides typed event decoding for every Solvent ingest
// stream: the Debt Manager (OP, engine "debt_manager"), the Aave v3
// ether.fi-market Pool + its four aToken contracts (ETH, engine
// "aave_v3_etherfi"), and the raw Chainlink aggregators (ETH, engine
// "chainlink_feed"). ABIs are embedded from recon/abis/ (re-exported, "abi"
// field only) plus a verified aToken ABI and a trimmed verified Chainlink
// aggregator ABI fetched from Blockscout -- see abis/*.json headers/README
// for provenance. Semantics (field meanings, indexing, units) come from
// recon/derivation-notes.md, never guessed.
package decode

import (
	"bytes"
	_ "embed"
	"encoding/json"
	"fmt"
	"math/big"
	"reflect"
	"strings"

	"github.com/ethereum/go-ethereum/accounts/abi"
	"github.com/ethereum/go-ethereum/common"

	"github.com/kaselunt/solvent/internal/store"
)

//go:embed abis/DebtManagerCore.json
var debtManagerCoreRaw []byte

//go:embed abis/DebtManagerAdmin.json
var debtManagerAdminRaw []byte

//go:embed abis/AaveV3Pool.json
var aaveV3PoolRaw []byte

//go:embed abis/AToken.json
var aTokenRaw []byte

//go:embed abis/ChainlinkAggregator.json
var chainlinkAggregatorRaw []byte

// abiWrapper matches the {"abi": [...]} shape shared by every embedded ABI
// file (recon/abis/*.json forge artifacts and the hand-fetched aToken /
// aggregator copies alike); any sibling keys (bytecode, sourceMap,
// _provenance, ...) are ignored.
type abiWrapper struct {
	ABI json.RawMessage `json:"abi"`
}

func mustParseWrappedABI(raw []byte) abi.ABI {
	var w abiWrapper
	if err := json.Unmarshal(raw, &w); err != nil {
		panic(fmt.Sprintf("decode: parse embedded abi wrapper: %v", err))
	}
	parsed, err := abi.JSON(bytes.NewReader(w.ABI))
	if err != nil {
		panic(fmt.Sprintf("decode: build abi: %v", err))
	}
	return parsed
}

func mustParseRawABI(jsonArray string) abi.ABI {
	parsed, err := abi.JSON(strings.NewReader(jsonArray))
	if err != nil {
		panic(fmt.Sprintf("decode: build hand-authored abi: %v", err))
	}
	return parsed
}

var (
	// debtManagerABI carries the full Debt Manager event set (Core and Admin
	// embed identical event lists -- both are sourced per the task brief;
	// decode_test.go's TestDebtManagerCoreAndAdminEventsMatch pins the
	// cross-check).
	debtManagerABI = mustParseWrappedABI(debtManagerCoreRaw)
	aavePoolABI    = mustParseWrappedABI(aaveV3PoolRaw)
	aTokenABI      = mustParseWrappedABI(aTokenRaw)
	chainlinkABI   = mustParseWrappedABI(chainlinkAggregatorRaw)

	// migrationABI is hand-constructed: MigrationBorrowerPositionsSet is not
	// present in any recon ABI dump (it belongs to a since-replaced Debt
	// Manager implementation -- recon/derivation-notes.md "Migration
	// finding"). topic0 0x3f1c4431cbe26a58837755d2461e40a6561ee3edd0e31ca91edb845637acda8b
	// matches `cast sig-event "MigrationBorrowerPositionsSet(address,uint256)"`
	// exactly and the real on-chain logs decoded against it (see
	// testdata/dm_migration_borrower_positions_set.json).
	migrationABI = mustParseRawABI(`[{
		"anonymous": false,
		"inputs": [
			{"indexed": true, "internalType": "address", "name": "token", "type": "address"},
			{"indexed": false, "internalType": "uint256", "name": "count", "type": "uint256"}
		],
		"name": "MigrationBorrowerPositionsSet",
		"type": "event"
	}]`)

	// commitAndExecuteABI / execute302ABI are hand-constructed from the two
	// LayerZero delivery-path signatures observed on real migration
	// transactions (verified via `cast sig` against the exact selectors
	// found on-chain -- see testdata/migration_calldata_*.json provenance).
	commitAndExecuteABI = mustParseRawABI(`[{
		"type": "function",
		"name": "commitAndExecute",
		"stateMutability": "nonpayable",
		"inputs": [
			{"name": "_receiveLib", "type": "address"},
			{"name": "_lzReceiveParam", "type": "tuple", "components": [
				{"name": "origin", "type": "tuple", "components": [
					{"name": "srcEid", "type": "uint32"},
					{"name": "sender", "type": "bytes32"},
					{"name": "nonce", "type": "uint64"}
				]},
				{"name": "executor", "type": "address"},
				{"name": "guid", "type": "bytes32"},
				{"name": "message", "type": "bytes"},
				{"name": "extraData", "type": "bytes"},
				{"name": "gas", "type": "uint256"},
				{"name": "value", "type": "uint256"}
			]},
			{"name": "_nativeDropParams", "type": "tuple[]", "components": [
				{"name": "recipient", "type": "address"},
				{"name": "amount", "type": "uint256"}
			]}
		],
		"outputs": []
	}]`)

	execute302ABI = mustParseRawABI(`[{
		"type": "function",
		"name": "execute302",
		"stateMutability": "nonpayable",
		"inputs": [
			{"name": "_executionParams", "type": "tuple", "components": [
				{"name": "receiver", "type": "address"},
				{"name": "origin", "type": "tuple", "components": [
					{"name": "srcEid", "type": "uint32"},
					{"name": "sender", "type": "bytes32"},
					{"name": "nonce", "type": "uint64"}
				]},
				{"name": "guid", "type": "bytes32"},
				{"name": "message", "type": "bytes"},
				{"name": "extraData", "type": "bytes"},
				{"name": "gasLimit", "type": "uint256"}
			]}
		],
		"outputs": []
	}]`)
)

// decodeFn decodes one log's topics (topics[0] is topic0) and non-indexed
// data into a concrete Event.
type decodeFn func(topics [][]byte, data []byte) (Event, error)

var debtManagerTopics = map[common.Hash]decodeFn{}
var aaveTopics = map[common.Hash]decodeFn{}
var chainlinkTopics = map[common.Hash]decodeFn{}

func init() {
	reg := func(m map[common.Hash]decodeFn, id common.Hash, fn decodeFn) {
		m[id] = fn
	}
	reg(debtManagerTopics, debtManagerABI.Events["Borrowed"].ID, decodeDMBorrowed)
	reg(debtManagerTopics, debtManagerABI.Events["Repaid"].ID, decodeDMRepaid)
	reg(debtManagerTopics, debtManagerABI.Events["Supplied"].ID, decodeDMSupplied)
	reg(debtManagerTopics, debtManagerABI.Events["WithdrawBorrowToken"].ID, decodeDMWithdrawBorrowToken)
	reg(debtManagerTopics, debtManagerABI.Events["Liquidated"].ID, decodeDMLiquidated)
	reg(debtManagerTopics, debtManagerABI.Events["InterestIndexUpdated"].ID, decodeDMInterestIndexUpdated)
	reg(debtManagerTopics, debtManagerABI.Events["BorrowApySet"].ID, decodeDMBorrowApySet)
	reg(debtManagerTopics, debtManagerABI.Events["BorrowTokenConfigSet"].ID, decodeDMBorrowTokenConfigSet)
	reg(debtManagerTopics, debtManagerABI.Events["CollateralTokenAdded"].ID, decodeDMCollateralTokenAdded)
	reg(debtManagerTopics, debtManagerABI.Events["CollateralTokenRemoved"].ID, decodeDMCollateralTokenRemoved)
	reg(debtManagerTopics, debtManagerABI.Events["CollateralTokenConfigSet"].ID, decodeDMCollateralTokenConfigSet)
	reg(debtManagerTopics, migrationABI.Events["MigrationBorrowerPositionsSet"].ID, decodeDMMigrationBorrowerPositionsSet)

	// aave_v3_etherfi is one engine spanning two contract families sharing
	// one topic0 space: the Pool itself and its four aToken streams
	// (config/contracts.json: eth:aave-etherfi + eth:atoken-<sym>, all
	// engine "aave_v3_etherfi").
	reg(aaveTopics, aavePoolABI.Events["Borrow"].ID, decodeAaveBorrow)
	reg(aaveTopics, aavePoolABI.Events["Repay"].ID, decodeAaveRepay)
	reg(aaveTopics, aavePoolABI.Events["Supply"].ID, decodeAaveSupply)
	reg(aaveTopics, aavePoolABI.Events["Withdraw"].ID, decodeAaveWithdraw)
	reg(aaveTopics, aavePoolABI.Events["LiquidationCall"].ID, decodeAaveLiquidationCall)
	reg(aaveTopics, aavePoolABI.Events["ReserveDataUpdated"].ID, decodeAaveReserveDataUpdated)
	reg(aaveTopics, aavePoolABI.Events["DeficitCreated"].ID, decodeAaveDeficitCreated)
	reg(aaveTopics, aTokenABI.Events["Transfer"].ID, decodeATokenTransfer)
	reg(aaveTopics, aTokenABI.Events["Mint"].ID, decodeATokenMint)
	reg(aaveTopics, aTokenABI.Events["Burn"].ID, decodeATokenBurn)
	reg(aaveTopics, aTokenABI.Events["BalanceTransfer"].ID, decodeATokenBalanceTransfer)

	reg(chainlinkTopics, chainlinkABI.Events["AnswerUpdated"].ID, decodeChainlinkAnswerUpdated)
}

var engineTopics = map[string]map[common.Hash]decodeFn{
	"debt_manager":    debtManagerTopics,
	"aave_v3_etherfi": aaveTopics,
	"chainlink_feed":  chainlinkTopics,
}

// ChainlinkAnswerUpdatedTopic0 is the topic0 of
// AnswerUpdated(int256,uint256,uint256), derived from the embedded aggregator ABI
// (never a hand-copied literal). It is exported because a caller that needs to
// find the NEWEST stored answer per aggregator has to filter raw_logs by topic0
// in SQL rather than decode every log in a range — internal/prices hydrates its
// per-feed publication freshness that way, and the alternative would be a second
// copy of the signature string in another package.
var ChainlinkAnswerUpdatedTopic0 = chainlinkABI.Events["AnswerUpdated"].ID

// Registry decodes raw logs into typed Events using the embedded ABIs. It is
// stateless (all lookup tables are package-level) and safe for concurrent use.
type Registry struct{}

// NewRegistry builds a Registry from the embedded ABIs.
func NewRegistry() *Registry { return &Registry{} }

// Decode looks up l's topic0 in engine's allowlist and decodes it.
//
// Note on address-blind keying: dispatch below keys purely on (engine,
// topic0) -- l.Address is never consulted. This is safe only because every
// stream in config/contracts.json filters ingestion to a single, pinned
// contract address per stream (each stream's `addresses` array is a
// singleton); e.g. the aave_v3_etherfi engine's shared aTokenTopics table
// means an ERC20 Transfer topic0 can only ever have been ingested from one
// of the four pinned aToken addresses (eth:atoken-<sym> streams), never from
// an arbitrary ERC20. If a future stream ever adds a second address or a
// wildcard/discovery mode to any engine, this address-blind assumption no
// longer holds and this dispatch must be revisited (e.g. by threading
// l.Address through to the decode functions and validating it there).
//
//   - Unknown engine, or a topic0 outside engine's allowlist: (nil, false, nil)
//     -- a deliberate skip, never an error (unallowlisted logs are routine,
//     e.g. an ERC20 Approval alongside a Transfer we do care about).
//   - Known topic0 but malformed data (wrong length, array length mismatch,
//     etc.): (nil, false, err).
//
// Any panic during decoding (defensive only -- by construction a topic0
// match guarantees the ABI shape) is itself converted into an error rather
// than propagated, so a single bad log can never crash a caller's ingest loop.
func (r *Registry) Decode(engine string, l store.RawLog) (ev Event, ok bool, err error) {
	defer func() {
		if rec := recover(); rec != nil {
			ev, ok, err = nil, false, fmt.Errorf("decode: recovered panic decoding engine %q: %v", engine, rec)
		}
	}()

	if len(l.Topics) == 0 {
		return nil, false, nil
	}
	fns, known := engineTopics[engine]
	if !known {
		return nil, false, nil
	}
	topic0 := common.BytesToHash(l.Topics[0])
	fn, known := fns[topic0]
	if !known {
		return nil, false, nil
	}
	decoded, decodeErr := fn(l.Topics, l.Data)
	if decodeErr != nil {
		return nil, false, fmt.Errorf("decode %s (topic0 %s): %w", engine, topic0, decodeErr)
	}
	return decoded, true, nil
}

// ---------------------------------------------------------------------------
// Shared unpacking helpers.
// ---------------------------------------------------------------------------

// unpackNonIndexed unpacks the non-indexed portion of an event's data,
// returning one interface{} per non-indexed argument in ABI-declared order.
func unpackNonIndexed(ev abi.Event, data []byte) ([]interface{}, error) {
	args := ev.Inputs.NonIndexed()
	vals, err := args.Unpack(data)
	if err != nil {
		return nil, fmt.Errorf("unpack non-indexed data: %w", err)
	}
	if len(vals) != len(args) {
		return nil, fmt.Errorf("unpack non-indexed data: got %d values, want %d", len(vals), len(args))
	}
	return vals, nil
}

// requireTopics checks the exact topic count (topic0 + indexed args); a
// mismatch means the log doesn't match the event's declared indexing and is
// treated as malformed data.
func requireTopics(eventName string, topics [][]byte, want int) error {
	if len(topics) != want {
		return fmt.Errorf("%s: expected %d topics, got %d", eventName, want, len(topics))
	}
	return nil
}

func topicAddress(t []byte) common.Address {
	return common.BytesToAddress(t)
}

func topicUint256(t []byte) *big.Int {
	return new(big.Int).SetBytes(t)
}

// topicInt256 decodes a 32-byte big-endian two's-complement signed integer,
// needed for Chainlink AnswerUpdated's indexed `int256 current`.
func topicInt256(t []byte) *big.Int {
	v := new(big.Int).SetBytes(t)
	if len(t) == 32 && t[0]&0x80 != 0 {
		v.Sub(v, new(big.Int).Lsh(big.NewInt(1), 256))
	}
	return v
}

// tupleField reads the i-th component of a reflect.StructOf-generated tuple
// value (as returned by abi.Arguments.Unpack for a tuple-typed argument),
// positionally -- robust regardless of go-ethereum's internal field-naming
// scheme for the component.
func tupleField(tuple interface{}, i int) interface{} {
	return reflect.ValueOf(tuple).Field(i).Interface()
}

func tupleLen(slice interface{}) int {
	return reflect.ValueOf(slice).Len()
}

func tupleIndex(slice interface{}, i int) interface{} {
	return reflect.ValueOf(slice).Index(i).Interface()
}

// ---------------------------------------------------------------------------
// Debt Manager decode functions.
// ---------------------------------------------------------------------------

func decodeDMBorrowed(topics [][]byte, data []byte) (Event, error) {
	if err := requireTopics("DMBorrowed", topics, 3); err != nil {
		return nil, err
	}
	vals, err := unpackNonIndexed(debtManagerABI.Events["Borrowed"], data)
	if err != nil {
		return nil, fmt.Errorf("DMBorrowed: %w", err)
	}
	return DMBorrowed{
		User:   topicAddress(topics[1]),
		Token:  topicAddress(topics[2]),
		Amount: vals[0].(*big.Int),
	}, nil
}

func decodeDMRepaid(topics [][]byte, data []byte) (Event, error) {
	if err := requireTopics("DMRepaid", topics, 4); err != nil {
		return nil, err
	}
	vals, err := unpackNonIndexed(debtManagerABI.Events["Repaid"], data)
	if err != nil {
		return nil, fmt.Errorf("DMRepaid: %w", err)
	}
	return DMRepaid{
		User:      topicAddress(topics[1]),
		Payer:     topicAddress(topics[2]),
		Token:     topicAddress(topics[3]),
		UsdAmount: vals[0].(*big.Int),
	}, nil
}

func decodeDMSupplied(topics [][]byte, data []byte) (Event, error) {
	if err := requireTopics("DMSupplied", topics, 4); err != nil {
		return nil, err
	}
	vals, err := unpackNonIndexed(debtManagerABI.Events["Supplied"], data)
	if err != nil {
		return nil, fmt.Errorf("DMSupplied: %w", err)
	}
	return DMSupplied{
		Sender: topicAddress(topics[1]),
		User:   topicAddress(topics[2]),
		Token:  topicAddress(topics[3]),
		Amount: vals[0].(*big.Int),
	}, nil
}

func decodeDMWithdrawBorrowToken(topics [][]byte, data []byte) (Event, error) {
	if err := requireTopics("DMWithdrawBorrowToken", topics, 3); err != nil {
		return nil, err
	}
	vals, err := unpackNonIndexed(debtManagerABI.Events["WithdrawBorrowToken"], data)
	if err != nil {
		return nil, fmt.Errorf("DMWithdrawBorrowToken: %w", err)
	}
	return DMWithdrawBorrowToken{
		Withdrawer:  topicAddress(topics[1]),
		BorrowToken: topicAddress(topics[2]),
		Amount:      vals[0].(*big.Int),
	}, nil
}

func decodeDMLiquidated(topics [][]byte, data []byte) (Event, error) {
	if err := requireTopics("DMLiquidated", topics, 4); err != nil {
		return nil, err
	}
	vals, err := unpackNonIndexed(debtManagerABI.Events["Liquidated"], data)
	if err != nil {
		return nil, fmt.Errorf("DMLiquidated: %w", err)
	}
	n := tupleLen(vals[0])
	collateral := make([]LiquidationTokenData, n)
	for i := 0; i < n; i++ {
		elem := tupleIndex(vals[0], i)
		collateral[i] = LiquidationTokenData{
			Token:  tupleField(elem, 0).(common.Address),
			Amount: tupleField(elem, 1).(*big.Int),
			Bonus:  tupleField(elem, 2).(*big.Int),
		}
	}
	return DMLiquidated{
		Liquidator:        topicAddress(topics[1]),
		User:              topicAddress(topics[2]),
		DebtToken:         topicAddress(topics[3]),
		Collateral:        collateral,
		BeforeDebtUsd:     vals[1].(*big.Int),
		DebtLiquidatedUsd: vals[2].(*big.Int),
	}, nil
}

func decodeDMInterestIndexUpdated(topics [][]byte, data []byte) (Event, error) {
	if err := requireTopics("DMInterestIndexUpdated", topics, 2); err != nil {
		return nil, err
	}
	vals, err := unpackNonIndexed(debtManagerABI.Events["InterestIndexUpdated"], data)
	if err != nil {
		return nil, fmt.Errorf("DMInterestIndexUpdated: %w", err)
	}
	return DMInterestIndexUpdated{
		Token:    topicAddress(topics[1]),
		OldIndex: vals[0].(*big.Int),
		NewIndex: vals[1].(*big.Int),
	}, nil
}

func decodeDMBorrowApySet(topics [][]byte, data []byte) (Event, error) {
	if err := requireTopics("DMBorrowApySet", topics, 2); err != nil {
		return nil, err
	}
	vals, err := unpackNonIndexed(debtManagerABI.Events["BorrowApySet"], data)
	if err != nil {
		return nil, fmt.Errorf("DMBorrowApySet: %w", err)
	}
	return DMBorrowApySet{
		Token:  topicAddress(topics[1]),
		OldApy: vals[0].(*big.Int),
		NewApy: vals[1].(*big.Int),
	}, nil
}

func decodeDMBorrowTokenConfigSet(topics [][]byte, data []byte) (Event, error) {
	if err := requireTopics("DMBorrowTokenConfigSet", topics, 2); err != nil {
		return nil, err
	}
	vals, err := unpackNonIndexed(debtManagerABI.Events["BorrowTokenConfigSet"], data)
	if err != nil {
		return nil, fmt.Errorf("DMBorrowTokenConfigSet: %w", err)
	}
	cfg := vals[0]
	return DMBorrowTokenConfigSet{
		Token: topicAddress(topics[1]),
		Config: BorrowTokenConfig{
			InterestIndexSnapshot:          tupleField(cfg, 0).(*big.Int),
			TotalNormalizedBorrowingAmount: tupleField(cfg, 1).(*big.Int),
			TotalSharesOfBorrowTokens:      tupleField(cfg, 2).(*big.Int),
			LastUpdateTimestamp:            tupleField(cfg, 3).(uint64),
			BorrowApy:                      tupleField(cfg, 4).(uint64),
			MinShares:                      tupleField(cfg, 5).(*big.Int),
		},
	}, nil
}

func decodeDMCollateralTokenAdded(topics [][]byte, data []byte) (Event, error) {
	if err := requireTopics("DMCollateralTokenAdded", topics, 1); err != nil {
		return nil, err
	}
	vals, err := unpackNonIndexed(debtManagerABI.Events["CollateralTokenAdded"], data)
	if err != nil {
		return nil, fmt.Errorf("DMCollateralTokenAdded: %w", err)
	}
	return DMCollateralTokenAdded{Token: vals[0].(common.Address)}, nil
}

func decodeDMCollateralTokenRemoved(topics [][]byte, data []byte) (Event, error) {
	if err := requireTopics("DMCollateralTokenRemoved", topics, 1); err != nil {
		return nil, err
	}
	vals, err := unpackNonIndexed(debtManagerABI.Events["CollateralTokenRemoved"], data)
	if err != nil {
		return nil, fmt.Errorf("DMCollateralTokenRemoved: %w", err)
	}
	return DMCollateralTokenRemoved{Token: vals[0].(common.Address)}, nil
}

func decodeDMCollateralTokenConfigSet(topics [][]byte, data []byte) (Event, error) {
	if err := requireTopics("DMCollateralTokenConfigSet", topics, 2); err != nil {
		return nil, err
	}
	vals, err := unpackNonIndexed(debtManagerABI.Events["CollateralTokenConfigSet"], data)
	if err != nil {
		return nil, fmt.Errorf("DMCollateralTokenConfigSet: %w", err)
	}
	mk := func(v interface{}) CollateralTokenConfig {
		return CollateralTokenConfig{
			LTV:                  tupleField(v, 0).(*big.Int),
			LiquidationThreshold: tupleField(v, 1).(*big.Int),
			LiquidationBonus:     tupleField(v, 2).(*big.Int),
		}
	}
	return DMCollateralTokenConfigSet{
		CollateralToken: topicAddress(topics[1]),
		OldConfig:       mk(vals[0]),
		NewConfig:       mk(vals[1]),
	}, nil
}

func decodeDMMigrationBorrowerPositionsSet(topics [][]byte, data []byte) (Event, error) {
	if err := requireTopics("DMMigrationBorrowerPositionsSet", topics, 2); err != nil {
		return nil, err
	}
	vals, err := unpackNonIndexed(migrationABI.Events["MigrationBorrowerPositionsSet"], data)
	if err != nil {
		return nil, fmt.Errorf("DMMigrationBorrowerPositionsSet: %w", err)
	}
	return DMMigrationBorrowerPositionsSet{
		Token: topicAddress(topics[1]),
		Count: vals[0].(*big.Int),
	}, nil
}

// ---------------------------------------------------------------------------
// Aave Pool decode functions.
// ---------------------------------------------------------------------------

func decodeAaveBorrow(topics [][]byte, data []byte) (Event, error) {
	if err := requireTopics("AaveBorrow", topics, 4); err != nil {
		return nil, err
	}
	vals, err := unpackNonIndexed(aavePoolABI.Events["Borrow"], data)
	if err != nil {
		return nil, fmt.Errorf("AaveBorrow: %w", err)
	}
	return AaveBorrow{
		Reserve:          topicAddress(topics[1]),
		OnBehalfOf:       topicAddress(topics[2]),
		User:             vals[0].(common.Address),
		Amount:           vals[1].(*big.Int),
		InterestRateMode: vals[2].(uint8),
		BorrowRate:       vals[3].(*big.Int),
	}, nil
}

func decodeAaveRepay(topics [][]byte, data []byte) (Event, error) {
	if err := requireTopics("AaveRepay", topics, 4); err != nil {
		return nil, err
	}
	vals, err := unpackNonIndexed(aavePoolABI.Events["Repay"], data)
	if err != nil {
		return nil, fmt.Errorf("AaveRepay: %w", err)
	}
	return AaveRepay{
		Reserve:    topicAddress(topics[1]),
		User:       topicAddress(topics[2]),
		Repayer:    topicAddress(topics[3]),
		Amount:     vals[0].(*big.Int),
		UseATokens: vals[1].(bool),
	}, nil
}

func decodeAaveSupply(topics [][]byte, data []byte) (Event, error) {
	if err := requireTopics("AaveSupply", topics, 4); err != nil {
		return nil, err
	}
	vals, err := unpackNonIndexed(aavePoolABI.Events["Supply"], data)
	if err != nil {
		return nil, fmt.Errorf("AaveSupply: %w", err)
	}
	return AaveSupply{
		Reserve:    topicAddress(topics[1]),
		OnBehalfOf: topicAddress(topics[2]),
		User:       vals[0].(common.Address),
		Amount:     vals[1].(*big.Int),
	}, nil
}

func decodeAaveWithdraw(topics [][]byte, data []byte) (Event, error) {
	if err := requireTopics("AaveWithdraw", topics, 4); err != nil {
		return nil, err
	}
	vals, err := unpackNonIndexed(aavePoolABI.Events["Withdraw"], data)
	if err != nil {
		return nil, fmt.Errorf("AaveWithdraw: %w", err)
	}
	return AaveWithdraw{
		Reserve: topicAddress(topics[1]),
		User:    topicAddress(topics[2]),
		To:      topicAddress(topics[3]),
		Amount:  vals[0].(*big.Int),
	}, nil
}

func decodeAaveLiquidationCall(topics [][]byte, data []byte) (Event, error) {
	if err := requireTopics("AaveLiquidationCall", topics, 4); err != nil {
		return nil, err
	}
	vals, err := unpackNonIndexed(aavePoolABI.Events["LiquidationCall"], data)
	if err != nil {
		return nil, fmt.Errorf("AaveLiquidationCall: %w", err)
	}
	return AaveLiquidationCall{
		CollateralAsset:            topicAddress(topics[1]),
		DebtAsset:                  topicAddress(topics[2]),
		User:                       topicAddress(topics[3]),
		DebtToCover:                vals[0].(*big.Int),
		LiquidatedCollateralAmount: vals[1].(*big.Int),
		Liquidator:                 vals[2].(common.Address),
		ReceiveAToken:              vals[3].(bool),
	}, nil
}

func decodeAaveReserveDataUpdated(topics [][]byte, data []byte) (Event, error) {
	if err := requireTopics("AaveReserveDataUpdated", topics, 2); err != nil {
		return nil, err
	}
	vals, err := unpackNonIndexed(aavePoolABI.Events["ReserveDataUpdated"], data)
	if err != nil {
		return nil, fmt.Errorf("AaveReserveDataUpdated: %w", err)
	}
	return AaveReserveDataUpdated{
		Reserve:             topicAddress(topics[1]),
		LiquidityRate:       vals[0].(*big.Int),
		VariableBorrowRate:  vals[2].(*big.Int), // vals[1] = stableBorrowRate, intentionally discarded
		LiquidityIndex:      vals[3].(*big.Int),
		VariableBorrowIndex: vals[4].(*big.Int),
	}, nil
}

func decodeAaveDeficitCreated(topics [][]byte, data []byte) (Event, error) {
	if err := requireTopics("AaveDeficitCreated", topics, 3); err != nil {
		return nil, err
	}
	vals, err := unpackNonIndexed(aavePoolABI.Events["DeficitCreated"], data)
	if err != nil {
		return nil, fmt.Errorf("AaveDeficitCreated: %w", err)
	}
	return AaveDeficitCreated{
		User:          topicAddress(topics[1]),
		DebtAsset:     topicAddress(topics[2]),
		AmountCreated: vals[0].(*big.Int),
	}, nil
}

// ---------------------------------------------------------------------------
// aToken decode functions.
// ---------------------------------------------------------------------------

func decodeATokenTransfer(topics [][]byte, data []byte) (Event, error) {
	if err := requireTopics("ATokenTransfer", topics, 3); err != nil {
		return nil, err
	}
	vals, err := unpackNonIndexed(aTokenABI.Events["Transfer"], data)
	if err != nil {
		return nil, fmt.Errorf("ATokenTransfer: %w", err)
	}
	return ATokenTransfer{
		From:  topicAddress(topics[1]),
		To:    topicAddress(topics[2]),
		Value: vals[0].(*big.Int),
	}, nil
}

func decodeATokenMint(topics [][]byte, data []byte) (Event, error) {
	if err := requireTopics("ATokenMint", topics, 3); err != nil {
		return nil, err
	}
	vals, err := unpackNonIndexed(aTokenABI.Events["Mint"], data)
	if err != nil {
		return nil, fmt.Errorf("ATokenMint: %w", err)
	}
	return ATokenMint{
		Caller:          topicAddress(topics[1]),
		OnBehalfOf:      topicAddress(topics[2]),
		Value:           vals[0].(*big.Int),
		BalanceIncrease: vals[1].(*big.Int),
		Index:           vals[2].(*big.Int),
	}, nil
}

func decodeATokenBurn(topics [][]byte, data []byte) (Event, error) {
	if err := requireTopics("ATokenBurn", topics, 3); err != nil {
		return nil, err
	}
	vals, err := unpackNonIndexed(aTokenABI.Events["Burn"], data)
	if err != nil {
		return nil, fmt.Errorf("ATokenBurn: %w", err)
	}
	return ATokenBurn{
		From:            topicAddress(topics[1]),
		Target:          topicAddress(topics[2]),
		Value:           vals[0].(*big.Int),
		BalanceIncrease: vals[1].(*big.Int),
		Index:           vals[2].(*big.Int),
	}, nil
}

func decodeATokenBalanceTransfer(topics [][]byte, data []byte) (Event, error) {
	if err := requireTopics("ATokenBalanceTransfer", topics, 3); err != nil {
		return nil, err
	}
	vals, err := unpackNonIndexed(aTokenABI.Events["BalanceTransfer"], data)
	if err != nil {
		return nil, fmt.Errorf("ATokenBalanceTransfer: %w", err)
	}
	return ATokenBalanceTransfer{
		From:  topicAddress(topics[1]),
		To:    topicAddress(topics[2]),
		Value: vals[0].(*big.Int),
		Index: vals[1].(*big.Int),
	}, nil
}

// ---------------------------------------------------------------------------
// Chainlink decode function.
// ---------------------------------------------------------------------------

func decodeChainlinkAnswerUpdated(topics [][]byte, data []byte) (Event, error) {
	if err := requireTopics("ChainlinkAnswerUpdated", topics, 3); err != nil {
		return nil, err
	}
	vals, err := unpackNonIndexed(chainlinkABI.Events["AnswerUpdated"], data)
	if err != nil {
		return nil, fmt.Errorf("ChainlinkAnswerUpdated: %w", err)
	}
	updatedAt, ok := vals[0].(*big.Int)
	if !ok || !updatedAt.IsUint64() {
		return nil, fmt.Errorf("ChainlinkAnswerUpdated: updatedAt out of uint64 range")
	}
	return ChainlinkAnswerUpdated{
		Current:   topicInt256(topics[1]),
		RoundId:   topicUint256(topics[2]),
		UpdatedAt: updatedAt.Uint64(),
	}, nil
}

// ---------------------------------------------------------------------------
// Migration calldata decoding (recon "Migration finding").
// ---------------------------------------------------------------------------

// maxMigrationSeeds bounds the number of borrower positions one migration tx
// may seed: the downstream position_events schema discriminates multiple
// events from one log via a uint16 `seq` column (internal/store/derive.go),
// so a batch producing more than 65536 seeds cannot be represented and is
// rejected here at the producer (this package), per senior-review
// adjudication recorded in .superpowers/sdd/progress-phase2.md (Task 3b).
const maxMigrationSeeds = 65536

var (
	selectorCommitAndExecute = [4]byte{0xdc, 0xfd, 0xeb, 0x60} // commitAndExecute(address,(...),(address,uint256)[])
	selectorExecute302       = [4]byte{0xcf, 0xc3, 0x25, 0x70} // execute302((...))
)

// DecodeMigrationCalldata recovers the per-borrower (address, normalizedAmount)
// seeds from a migration transaction's raw calldata (tx.input, selector
// included). Two LayerZero delivery paths were observed on real migration
// transactions and are both supported (see testdata/migration_calldata_*.json
// for the exact real transactions this was validated against):
//
//   - commitAndExecute(address, LzReceiveParam, NativeDropParam[]) -- a
//     DVN-commit-then-execute path; the seeds live in
//     LzReceiveParam.message.
//   - execute302(ExecutionParam) -- a direct-executor path; the seeds live
//     in ExecutionParam.message.
//
// In both cases `message` is itself abi.encode(address[] borrowers,
// uint256[] amounts) -- two parallel dynamic arrays, NOT an interleaved
// (address,uint256)[] tuple array (confirmed empirically: all N addresses
// are contiguous, followed by a fresh length word and N amounts).
func DecodeMigrationCalldata(input []byte) ([]MigrationSeed, error) {
	if len(input) < 4 {
		return nil, fmt.Errorf("migration calldata: input too short (%d bytes, need >= 4 for the selector)", len(input))
	}
	var selector [4]byte
	copy(selector[:], input[:4])

	var message []byte
	var err error
	switch selector {
	case selectorCommitAndExecute:
		message, err = extractCommitAndExecuteMessage(input[4:])
	case selectorExecute302:
		message, err = extractExecute302Message(input[4:])
	default:
		return nil, fmt.Errorf("migration calldata: unrecognized selector 0x%x", selector)
	}
	if err != nil {
		return nil, fmt.Errorf("migration calldata: %w", err)
	}

	addrs, amounts, err := unpackAddressUint256Arrays(message)
	if err != nil {
		return nil, fmt.Errorf("migration calldata: %w", err)
	}
	return buildMigrationSeeds(addrs, amounts)
}

// unpackOuterCanonical unpacks args from data via go-ethereum's generic
// abi.Arguments.Unpack, then re-Packs the unpacked values with that same
// arguments spec and requires the result to be byte-identical to data --
// a full-consumption canonicality backstop at the OUTER (commitAndExecute /
// execute302) calldata layer, mirroring the inner migration-message parser's
// own re-encode-and-compare backstop (unpackAddressUint256Arrays, above).
//
// Unpack alone is permissive in exactly the ways that matter here: it
// tolerates trailing bytes appended after otherwise-complete calldata, dirty
// (non-zero) upper-12-byte padding on an outer address word, non-canonical
// (but still resolvable) dynamic-field offsets, and tail-aliasing between two
// outer dynamic fields. A genuine abi.encode-produced call never produces any
// of those shapes, so any re-encode mismatch here is treated as malformed/
// adversarial calldata, not a false positive on real traffic.
//
// Error text is deliberately distinct from the inner parser's ("non-canonical
// offset" / "trailing bytes" / "dirty address padding" / "array length
// mismatch" / "fan-out exceeds" / "canonicality backstop: ...") so callers
// can tell which layer rejected the input.
func unpackOuterCanonical(args abi.Arguments, data []byte, label string) ([]interface{}, error) {
	vals, err := args.Unpack(data)
	if err != nil {
		return nil, fmt.Errorf("unpack %s args: %w", label, err)
	}
	reEncoded, err := args.Pack(vals...)
	if err != nil {
		return nil, fmt.Errorf("%s: non-canonical outer calldata (re-encode failed: %v)", label, err)
	}
	if !bytes.Equal(reEncoded, data) {
		return nil, fmt.Errorf("%s: non-canonical outer calldata", label)
	}
	return vals, nil
}

func extractCommitAndExecuteMessage(data []byte) (message []byte, err error) {
	defer func() {
		if rec := recover(); rec != nil {
			message, err = nil, fmt.Errorf("commitAndExecute: recovered panic: %v", rec)
		}
	}()
	vals, unpackErr := unpackOuterCanonical(commitAndExecuteABI.Methods["commitAndExecute"].Inputs, data, "commitAndExecute")
	if unpackErr != nil {
		return nil, unpackErr
	}
	if len(vals) != 3 {
		return nil, fmt.Errorf("commitAndExecute: expected 3 args, got %d", len(vals))
	}
	msg, ok := tupleField(vals[1], 3).([]byte) // _lzReceiveParam.message
	if !ok {
		return nil, fmt.Errorf("commitAndExecute: _lzReceiveParam.message is not []byte")
	}
	return msg, nil
}

func extractExecute302Message(data []byte) (message []byte, err error) {
	defer func() {
		if rec := recover(); rec != nil {
			message, err = nil, fmt.Errorf("execute302: recovered panic: %v", rec)
		}
	}()
	vals, unpackErr := unpackOuterCanonical(execute302ABI.Methods["execute302"].Inputs, data, "execute302")
	if unpackErr != nil {
		return nil, unpackErr
	}
	if len(vals) != 1 {
		return nil, fmt.Errorf("execute302: expected 1 arg, got %d", len(vals))
	}
	msg, ok := tupleField(vals[0], 3).([]byte) // _executionParams.message
	if !ok {
		return nil, fmt.Errorf("execute302: _executionParams.message is not []byte")
	}
	return msg, nil
}

// migrationMessageArgs is the (address[], uint256[]) ABI-arguments pair used
// solely by unpackAddressUint256Arrays's final canonicality backstop: an
// independent re-encode of the values this package just parsed, byte-
// compared against the original payload. It is NOT used to parse untrusted
// input (see unpackAddressUint256Arrays for why go-ethereum's generic
// abi.Arguments.Unpack is deliberately not trusted for that).
var migrationMessageArgs = func() abi.Arguments {
	addrArrType, err := abi.NewType("address[]", "", nil)
	if err != nil {
		panic(fmt.Sprintf("decode: build address[] type: %v", err))
	}
	uintArrType, err := abi.NewType("uint256[]", "", nil)
	if err != nil {
		panic(fmt.Sprintf("decode: build uint256[] type: %v", err))
	}
	return abi.Arguments{{Type: addrArrType}, {Type: uintArrType}}
}()

var zero12Pad [12]byte

// unpackAddressUint256Arrays performs a strict, allocation-safe manual parse
// of `message` as the canonical ABI encoding of (address[] borrowers,
// uint256[] amounts) -- two parallel dynamic arrays, back to back, with
// nothing else in the buffer.
//
// These bytes seed the majority of migrated borrowers' debt genesis (recon
// "Migration finding"), so this package cannot trust go-ethereum's generic
// abi.Arguments.Unpack the way the original implementation did: that decoder
// tolerates trailing garbage after the declared arrays, dirty (non-zero)
// upper-12-byte padding on an address word, and only checks an oversized
// declared array length AFTER allocating storage for it. All three are
// silent-acceptance footguns for a parser whose job is to recover real money
// amounts from calldata nobody but the sender controls. Solidity's own
// abi.encode/abi.decode never produces any of these three shapes, so
// rejecting them costs nothing against genuine calldata while closing off a
// class of parser-differential attack.
//
// Canonical wire layout (head, then two tails, nothing else):
//
//	[0:32)                 offsetA -- must be exactly 64 (two head words)
//	[32:64)                offsetB -- must be exactly 64+32+32*lenA
//	[64:96)                lenA (array1 length; bounds-checked BEFORE any
//	                        allocation)
//	[96:96+32*lenA)        lenA address words (upper 12 bytes must be zero)
//	[offsetB:offsetB+32)   lenB (array2 length; bounds-checked BEFORE any
//	                        allocation; must equal lenA)
//	[offsetB+32:offsetB+32+32*lenB) lenB amount words
//
// len(message) must equal offsetB+32+32*lenB exactly: anything else is
// trailing (or missing) bytes.
func unpackAddressUint256Arrays(message []byte) ([]common.Address, []*big.Int, error) {
	const headSize = 64 // two head words: offsetA, offsetB

	if len(message) < headSize {
		return nil, nil, fmt.Errorf("message too short for head (%d bytes, need >= %d)", len(message), headSize)
	}

	offsetA := new(big.Int).SetBytes(message[0:32])
	if offsetA.Cmp(big.NewInt(headSize)) != 0 {
		return nil, nil, fmt.Errorf("non-canonical offset: array1 offset must be exactly %d, got %s", headSize, offsetA)
	}

	lenAWordStart := headSize
	if len(message) < lenAWordStart+32 {
		return nil, nil, fmt.Errorf("message too short for array1 length word")
	}
	// Length read (and bounds-checked against the same uint16-seq-column
	// bound `buildMigrationSeeds` enforces, maxMigrationSeeds) BEFORE any
	// allocation: an attacker-supplied astronomical length word must fail
	// here, not after this package tries to make() storage for it.
	lenABig := new(big.Int).SetBytes(message[lenAWordStart : lenAWordStart+32])
	if lenABig.Cmp(big.NewInt(maxMigrationSeeds)) > 0 {
		return nil, nil, fmt.Errorf("fan-out exceeds: array1 length %s exceeds max %d", lenABig, maxMigrationSeeds)
	}
	lenA := int(lenABig.Int64()) // safe: bounded above by maxMigrationSeeds

	tailAStart := lenAWordStart + 32
	tailASize := lenA * 32
	offsetBWant := int64(headSize) + 32 + int64(tailASize)

	offsetBGot := new(big.Int).SetBytes(message[32:64])
	if !offsetBGot.IsInt64() || offsetBGot.Int64() != offsetBWant {
		return nil, nil, fmt.Errorf("non-canonical offset: array2 offset must be exactly %d (64 + 32 + 32*lenA), got %s", offsetBWant, offsetBGot)
	}
	offsetB := int(offsetBWant)

	if len(message) < offsetB+32 {
		return nil, nil, fmt.Errorf("message too short for array2 length word")
	}
	lenBBig := new(big.Int).SetBytes(message[offsetB : offsetB+32])
	if lenBBig.Cmp(big.NewInt(maxMigrationSeeds)) > 0 {
		return nil, nil, fmt.Errorf("fan-out exceeds: array2 length %s exceeds max %d", lenBBig, maxMigrationSeeds)
	}
	lenB := int(lenBBig.Int64())

	if lenA != lenB {
		return nil, nil, fmt.Errorf("array length mismatch: array1 len %d != array2 len %d", lenA, lenB)
	}

	tailBStart := offsetB + 32
	tailBSize := lenB * 32
	wantTotalLen := tailBStart + tailBSize
	if len(message) < wantTotalLen {
		return nil, nil, fmt.Errorf("message too short for array2 tail (%d bytes, need %d)", len(message), wantTotalLen)
	}
	if len(message) > wantTotalLen {
		return nil, nil, fmt.Errorf("trailing bytes: message is %d bytes, expected exactly %d (arrays fully consumed at that point)", len(message), wantTotalLen)
	}

	addrs := make([]common.Address, lenA)
	for i := 0; i < lenA; i++ {
		word := message[tailAStart+i*32 : tailAStart+i*32+32]
		if !bytes.Equal(word[:12], zero12Pad[:]) {
			return nil, nil, fmt.Errorf("dirty address padding: array1[%d] has a non-zero upper-12-byte pad", i)
		}
		addrs[i] = common.BytesToAddress(word)
	}

	amounts := make([]*big.Int, lenB)
	for i := 0; i < lenB; i++ {
		word := message[tailBStart+i*32 : tailBStart+i*32+32]
		amounts[i] = new(big.Int).SetBytes(word)
	}

	// Final canonicality backstop: independently re-encode the parsed values
	// via the abi package and byte-compare against the original payload.
	// Given every check above, this should always match for a well-formed
	// input; it exists as defense-in-depth against a bug in this function
	// itself, not as the primary validation.
	reEncoded, err := migrationMessageArgs.Pack(addrs, amounts)
	if err != nil {
		return nil, nil, fmt.Errorf("canonicality backstop: re-encode failed: %w", err)
	}
	if !bytes.Equal(reEncoded, message) {
		return nil, nil, fmt.Errorf("canonicality backstop: re-encoded bytes do not match payload")
	}

	return addrs, amounts, nil
}

func buildMigrationSeeds(addrs []common.Address, amounts []*big.Int) ([]MigrationSeed, error) {
	if len(addrs) != len(amounts) {
		return nil, fmt.Errorf("borrower/amount array length mismatch (%d vs %d)", len(addrs), len(amounts))
	}
	if len(addrs) > maxMigrationSeeds {
		return nil, fmt.Errorf("%d seeds exceeds max %d (uint16 seq bound)", len(addrs), maxMigrationSeeds)
	}
	seeds := make([]MigrationSeed, len(addrs))
	for i := range addrs {
		seeds[i] = MigrationSeed{Borrower: addrs[i], NormalizedAmount: amounts[i]}
	}
	return seeds, nil
}
