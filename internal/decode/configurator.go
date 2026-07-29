package decode

// Aave v3 ether.fi-market PoolConfigurator decoding (ETH chain 1, engine
// "aave_param" -- config/contracts.json stream "eth:aave-param", singleton
// proxy address 0x8438F4D29D895d75C86BDC25360c25eF0607E65d).
//
// SCOPE AND CLOSURE. Phase-3 Task 1's configurator sweep (recon/p3-probes.md,
// "Configurator sweep") enumerated this instance's COMPLETE emitted event set
// over blocks 20,625,519 -> head: 110 logs, 20 distinct topic0, 17
// event-bearing blocks, dual-witnessed (Blockscout REST + Alchemy eth_getLogs,
// byte-identical). All 20 are decoded here; testdata/configurator_inventory.json
// carries a real-bytes fixture for every one of them. THE CLOSURE IS ENFORCED,
// not assumed: derive.ParamRunner REFUSES LOUDLY on any topic0 outside this
// table (see internal/derive/params.go). For params, silence is unavailable --
// a future implementation generation emitting a new parameter event must halt
// the stream, not be skipped into a silently-wrong param_history.
//
// WHY EVERY BODY IS HAND-READ. Unlike the other engines in this package, no
// decode function below calls abi.Arguments.Unpack. The ABI is used for ONE
// thing -- deriving each event's canonical topic0 (its identity) -- and every
// body is then read word by word with exact-length, dirty-padding and
// range checks, in the strict-parse style of unpackAddressUint256Arrays
// (decode.go:930). go-ethereum's generic unpacker tolerates trailing bytes
// after an otherwise-complete body and silently ignores non-zero upper-12-byte
// padding on an address word; a table whose closure is an ENFORCED invariant
// cannot afford a decoder that accepts shapes the chain never emits, because
// then a genuinely new shape can slip through looking ordinary.
//
// THE ReserveInitialized RULING (consult R6.2 / probe anomaly A1) and its
// AMENDMENT. The ruling required that ReserveInitialized be registered under
// the CANONICAL five-address signature hash (the ID the chain actually emits)
// while its body is read by a hand-authored strict reader rather than by an
// ABI unpacker -- that part stands and is implemented exactly (see
// decodeCfgReserveInitialized). The ruling's description of the BODY LAYOUT is
// refuted by the chain and is NOT implemented: A1 reported "no stableDebtToken
// slot: (asset indexed; aToken, variableDebtToken, interestRateStrategy)",
// which would put the aToken in data word 0. The four real ReserveInitialized
// logs (block 20,713,917, tx
// 0x8dce3e22688d50eaba48fbd1805623e7b7b9cb8910c96e609f279906c3d6ef67) carry
// THREE topics -- asset AND aToken are both indexed -- and topics[2] equals the
// aToken proxy of the matching eth:atoken-<sym> stream in all four cases. The
// three data words are (stableDebtToken, variableDebtToken,
// interestRateStrategyAddress): word 0 of the weETH log,
// 0x57a994227592652d58bbf3d52e34261df8b354d0, answers symbol() with
// "stableDebtEthEtherFiweETH" on chain, word 1 with
// "variableDebtEthEtherFiweETH", and word 2 is the same strategy address in all
// four logs. That is the CANONICAL 5-address layout with two indexed arguments,
// which is exactly what a 96-byte body means here; the verified genesis
// implementation ABI (see abis/PoolConfigurator.json) declares it that way too.
// A third, independent witness — CONTRACT STATE rather than a log or an ABI —
// agrees: Pool.getReserveAToken(weETH) returns
// 0xbe1F842e7e0afd2c2322aae5d34bA899544b29db (= topics[2]) and
// Pool.getReserveVariableDebtToken(weETH) returns
// 0x16264412CB72F0d16A446f7D928Dd0D822810048 (= data word 1), read on the
// ether.fi-market Pool 0x0AA97c284e98396202b6A04024F5E2c65026F3c0 (2026-07-28).
// Implementing A1 as written would have recorded the STABLE debt token in the
// aToken registry column -- a wrong answer to an honest operator, which is the
// one outcome the strictness above exists to prevent. The strict 96-byte reader
// is retained on its own merits: it rejects any body that is not exactly three
// words (an unpacker would accept a longer one) and any address word with a
// dirty pad.

import (
	_ "embed"
	"fmt"
	"math/big"

	"github.com/ethereum/go-ethereum/common"
)

//go:embed abis/PoolConfigurator.json
var poolConfiguratorRaw []byte

var (
	// configuratorABI is the verified GENESIS implementation's event set (see
	// abis/PoolConfigurator.json's _provenance): the only generation whose ABI
	// still declares ReserveStableRateBorrowing and EModeAssetCategoryChanged,
	// both of which this instance emitted before the stable-rate removal and
	// whose logs stay in custody forever.
	configuratorABI = mustParseWrappedABI(poolConfiguratorRaw)

	// proxyUpgradedABI is hand-constructed: Upgraded(address indexed
	// implementation) is emitted by the PROXY
	// (InitializableImmutableAdminUpgradeabilityProxy), not by any
	// implementation, so it is absent from every implementation ABI. topic0
	// 0xbc7cd75a20ee27fd9adebab32041f755214dbc6bffa90cc0225b39da2e5c2d3b
	// matches `cast sig-event "Upgraded(address)"` exactly and the five real
	// on-chain logs (blocks 20,920,979 / 21,917,056 / 22,839,362 / 24,196,552 /
	// 24,920,567) decoded against it -- see
	// testdata/configurator_inventory.json.
	proxyUpgradedABI = mustParseRawABI(`[{
		"anonymous": false,
		"inputs": [
			{"indexed": true, "internalType": "address", "name": "implementation", "type": "address"}
		],
		"name": "Upgraded",
		"type": "event"
	}]`)
)

// configuratorTopics is the engine "aave_param" allowlist: the CLOSED
// 20-topic0 inventory of the ether.fi-market PoolConfigurator. Registration
// keys on (engine, topic0) exactly like the other engines (decode.go's
// address-blind-keying note applies unchanged and safely: the aave_param
// stream's `addresses` array is a singleton, the configurator proxy, so a
// topic0 reaching this table can only have been ingested from that one
// contract).
var configuratorTopics = map[common.Hash]decodeFn{}

func init() {
	reg := func(name string, fn decodeFn) {
		ev, ok := configuratorABI.Events[name]
		if !ok {
			panic(fmt.Sprintf("decode: PoolConfigurator ABI has no event %q", name))
		}
		configuratorTopics[ev.ID] = fn
	}

	// The three PARAM-BEARING events (internal/derive/params.go turns these,
	// and only these, into param_history rows).
	reg("CollateralConfigurationChanged", decodeCfgCollateralConfigurationChanged)
	reg("ReserveInitialized", decodeCfgReserveInitialized)
	reg("EModeAssetCategoryChanged", decodeCfgEModeAssetCategoryChanged)

	// The remaining inventory: decoded strictly (which is what proves
	// membership of the closed set) and then acknowledged without a param row.
	reg("ReserveInterestRateDataChanged", decodeCfgReserveInterestRateDataChanged)
	reg("ReserveInterestRateStrategyChanged", decodeCfgReserveInterestRateStrategyChanged)
	reg("ATokenUpgraded", decodeCfgATokenUpgraded)
	reg("VariableDebtTokenUpgraded", decodeCfgVariableDebtTokenUpgraded)
	reg("SupplyCapChanged", decodeCfgSupplyCapChanged)
	reg("BorrowCapChanged", decodeCfgBorrowCapChanged)
	reg("ReserveFactorChanged", decodeCfgReserveFactorChanged)
	reg("DebtCeilingChanged", decodeCfgDebtCeilingChanged)
	reg("LiquidationProtocolFeeChanged", decodeCfgLiquidationProtocolFeeChanged)
	reg("ReserveBorrowing", decodeCfgReserveBorrowing)
	reg("ReserveFlashLoaning", decodeCfgReserveFlashLoaning)
	reg("ReserveStableRateBorrowing", decodeCfgReserveStableRateBorrowing)
	reg("BorrowableInIsolationChanged", decodeCfgBorrowableInIsolationChanged)
	reg("SiloedBorrowingChanged", decodeCfgSiloedBorrowingChanged)
	reg("FlashloanPremiumTotalUpdated", decodeCfgFlashloanPremiumTotalUpdated)
	reg("FlashloanPremiumToProtocolUpdated", decodeCfgFlashloanPremiumToProtocolUpdated)

	// The proxy's own upgrade event (implementation-generation boundaries).
	configuratorTopics[proxyUpgradedABI.Events["Upgraded"].ID] = decodeCfgUpgraded
}

// ConfiguratorTopic0Count is the size of the closed inventory, exported so the
// param deriver's tests and the Task-3 harness can assert the table did not
// silently shrink. It is derived from the table, never a literal.
func ConfiguratorTopic0Count() int { return len(configuratorTopics) }

// ---------------------------------------------------------------------------
// Strict word readers.
//
// Every configurator body below is read through these. They are deliberately
// intolerant of shapes Solidity's own encoder never produces: a body that is
// not exactly the declared number of words, an address word with a non-zero
// upper-12-byte pad, a bool word that is neither 0 nor 1, or an integer word
// wider than its declared type. Cost against genuine traffic: zero.
// ---------------------------------------------------------------------------

// requireDataLen rejects any body whose length is not exactly want bytes.
// go-ethereum's unpacker accepts trailing bytes; this does not.
func requireDataLen(eventName string, data []byte, want int) error {
	if len(data) != want {
		return fmt.Errorf("%s: expected exactly %d data bytes (%d words), got %d",
			eventName, want, want/32, len(data))
	}
	return nil
}

// dataWord returns word i of data. Callers have already length-checked.
func dataWord(data []byte, i int) []byte { return data[i*32 : (i+1)*32] }

// dataAddress reads word i as an address, refusing a dirty upper-12-byte pad
// (the unpackAddressUint256Arrays precedent, decode.go:993).
func dataAddress(eventName string, data []byte, i int, field string) (common.Address, error) {
	w := dataWord(data, i)
	for _, b := range w[:12] {
		if b != 0 {
			return common.Address{}, fmt.Errorf("%s: dirty address padding on %s (word %d has a non-zero upper-12-byte pad)",
				eventName, field, i)
		}
	}
	return common.BytesToAddress(w), nil
}

// topicAddressStrict reads an indexed address topic with the same dirty-pad
// refusal. An indexed address is emitted zero-padded to 32 bytes exactly like a
// data word, so the same canon applies.
func topicAddressStrict(eventName string, topics [][]byte, i int, field string) (common.Address, error) {
	t := topics[i]
	if len(t) != 32 {
		return common.Address{}, fmt.Errorf("%s: %s topic is %d bytes, want 32", eventName, field, len(t))
	}
	for _, b := range t[:12] {
		if b != 0 {
			return common.Address{}, fmt.Errorf("%s: dirty address padding on indexed %s", eventName, field)
		}
	}
	return common.BytesToAddress(t), nil
}

// dataUint256 reads word i as a uint256 (every 32-byte value is in range).
func dataUint256(data []byte, i int) *big.Int {
	return new(big.Int).SetBytes(dataWord(data, i))
}

// dataUintN reads word i as a uintN, refusing a value that does not fit. A
// uint128 word carrying more than 128 significant bits was never produced by
// the emitting contract.
func dataUintN(eventName string, data []byte, i, bits int, field string) (*big.Int, error) {
	v := new(big.Int).SetBytes(dataWord(data, i))
	if v.BitLen() > bits {
		return nil, fmt.Errorf("%s: %s does not fit in uint%d (value %s)", eventName, field, bits, v)
	}
	return v, nil
}

// dataUint8 reads word i as a uint8, refusing anything above 255.
func dataUint8(eventName string, data []byte, i int, field string) (uint8, error) {
	v := new(big.Int).SetBytes(dataWord(data, i))
	if v.BitLen() > 8 {
		return 0, fmt.Errorf("%s: %s does not fit in uint8 (value %s)", eventName, field, v)
	}
	return uint8(v.Uint64()), nil
}

// dataBool reads word i as a bool, refusing any value other than 0 or 1.
func dataBool(eventName string, data []byte, i int, field string) (bool, error) {
	v := new(big.Int).SetBytes(dataWord(data, i))
	switch {
	case v.Sign() == 0:
		return false, nil
	case v.Cmp(big.NewInt(1)) == 0:
		return true, nil
	default:
		return false, fmt.Errorf("%s: %s is neither 0 nor 1 (value %s)", eventName, field, v)
	}
}

// ---------------------------------------------------------------------------
// Param-bearing decode functions.
// ---------------------------------------------------------------------------

// decodeCfgCollateralConfigurationChanged decodes THE param event:
// CollateralConfigurationChanged(address indexed asset, uint256 ltv,
// uint256 liquidationThreshold, uint256 liquidationBonus). All three values
// are Aave BASIS POINTS (1e4 denominator) as emitted -- never normalized here
// or in storage; unit conversion lives in internal/risk.
func decodeCfgCollateralConfigurationChanged(topics [][]byte, data []byte) (Event, error) {
	const name = "AaveCfgCollateralConfigurationChanged"
	if err := requireTopics(name, topics, 2); err != nil {
		return nil, err
	}
	if err := requireDataLen(name, data, 96); err != nil {
		return nil, err
	}
	asset, err := topicAddressStrict(name, topics, 1, "asset")
	if err != nil {
		return nil, err
	}
	return AaveCfgCollateralConfigurationChanged{
		Asset:                asset,
		LTV:                  dataUint256(data, 0),
		LiquidationThreshold: dataUint256(data, 1),
		LiquidationBonus:     dataUint256(data, 2),
	}, nil
}

// decodeCfgReserveInitialized decodes the registry event under the CANONICAL
// five-address topic0 (consult R6.2) with a hand-authored strict body reader:
// exactly 96 bytes -- three address words -- each dirty-pad checked, with
// asset from topics[1] and aToken from topics[2] (both indexed on the wire).
// No ABI unpacker touches this body; see this file's header for the full
// evidence trail, including why probe anomaly A1's field ORDER is not
// implemented.
func decodeCfgReserveInitialized(topics [][]byte, data []byte) (Event, error) {
	const name = "AaveCfgReserveInitialized"
	if err := requireTopics(name, topics, 3); err != nil {
		return nil, err
	}
	if err := requireDataLen(name, data, 96); err != nil {
		return nil, err
	}
	asset, err := topicAddressStrict(name, topics, 1, "asset")
	if err != nil {
		return nil, err
	}
	aToken, err := topicAddressStrict(name, topics, 2, "aToken")
	if err != nil {
		return nil, err
	}
	stableDebt, err := dataAddress(name, data, 0, "stableDebtToken")
	if err != nil {
		return nil, err
	}
	variableDebt, err := dataAddress(name, data, 1, "variableDebtToken")
	if err != nil {
		return nil, err
	}
	strategy, err := dataAddress(name, data, 2, "interestRateStrategyAddress")
	if err != nil {
		return nil, err
	}
	return AaveCfgReserveInitialized{
		Asset:                asset,
		AToken:               aToken,
		StableDebtToken:      stableDebt,
		VariableDebtToken:    variableDebt,
		InterestRateStrategy: strategy,
	}, nil
}

// decodeCfgEModeAssetCategoryChanged decodes
// EModeAssetCategoryChanged(address indexed asset, uint8 oldCategoryId,
// uint8 newCategoryId). Every occurrence on this instance sets category 0
// (recon/p3-probes.md "eMode SETTLED"), but the value is recorded as emitted
// rather than assumed -- an eMode category is a liquidation-threshold
// selector, and assuming it is the whole point of custodying it.
func decodeCfgEModeAssetCategoryChanged(topics [][]byte, data []byte) (Event, error) {
	const name = "AaveCfgEModeAssetCategoryChanged"
	if err := requireTopics(name, topics, 2); err != nil {
		return nil, err
	}
	if err := requireDataLen(name, data, 64); err != nil {
		return nil, err
	}
	asset, err := topicAddressStrict(name, topics, 1, "asset")
	if err != nil {
		return nil, err
	}
	oldCat, err := dataUint8(name, data, 0, "oldCategoryId")
	if err != nil {
		return nil, err
	}
	newCat, err := dataUint8(name, data, 1, "newCategoryId")
	if err != nil {
		return nil, err
	}
	return AaveCfgEModeAssetCategoryChanged{Asset: asset, OldCategoryID: oldCat, NewCategoryID: newCat}, nil
}

// ---------------------------------------------------------------------------
// Inventory-membership decode functions (no param row; see params.go).
// ---------------------------------------------------------------------------

// decodeCfgReserveInterestRateDataChanged decodes
// ReserveInterestRateDataChanged(address indexed asset, address indexed
// strategy, bytes data) -- the only dynamic body in the inventory. The layout
// is hand-parsed under the same canon as unpackAddressUint256Arrays: the head
// offset must be exactly 32, and the buffer must be consumed exactly (offset +
// length word + payload padded to a whole number of words), with the pad bytes
// required to be zero. `data` is carried verbatim (it is the rate-curve blob;
// interpreting it is out of this engine's scope).
func decodeCfgReserveInterestRateDataChanged(topics [][]byte, data []byte) (Event, error) {
	const name = "AaveCfgReserveInterestRateDataChanged"
	if err := requireTopics(name, topics, 3); err != nil {
		return nil, err
	}
	if len(data) < 64 {
		return nil, fmt.Errorf("%s: body is %d bytes, need at least 64 (offset + length words)", name, len(data))
	}
	asset, err := topicAddressStrict(name, topics, 1, "asset")
	if err != nil {
		return nil, err
	}
	strategy, err := topicAddressStrict(name, topics, 2, "strategy")
	if err != nil {
		return nil, err
	}
	offset := new(big.Int).SetBytes(dataWord(data, 0))
	if offset.Cmp(big.NewInt(32)) != 0 {
		return nil, fmt.Errorf("%s: non-canonical offset: the bytes head must be exactly 32, got %s", name, offset)
	}
	blobLen := new(big.Int).SetBytes(dataWord(data, 1))
	// Bounds-check BEFORE any allocation (the decode.go:950 canon): an
	// astronomical length word must fail here, not after a make().
	if !blobLen.IsInt64() || blobLen.Int64() > int64(len(data)) {
		return nil, fmt.Errorf("%s: declared blob length %s exceeds the %d-byte body", name, blobLen, len(data))
	}
	n := int(blobLen.Int64())
	padded := (n + 31) / 32 * 32
	want := 64 + padded
	if len(data) != want {
		return nil, fmt.Errorf("%s: body is %d bytes, expected exactly %d (32 offset + 32 length + %d padded payload)",
			name, len(data), want, padded)
	}
	for _, b := range data[64+n:] {
		if b != 0 {
			return nil, fmt.Errorf("%s: non-zero tail padding after the %d-byte blob", name, n)
		}
	}
	blob := make([]byte, n)
	copy(blob, data[64:64+n])
	return AaveCfgReserveInterestRateDataChanged{Asset: asset, Strategy: strategy, Data: blob}, nil
}

func decodeCfgReserveInterestRateStrategyChanged(topics [][]byte, data []byte) (Event, error) {
	const name = "AaveCfgReserveInterestRateStrategyChanged"
	if err := requireTopics(name, topics, 2); err != nil {
		return nil, err
	}
	if err := requireDataLen(name, data, 64); err != nil {
		return nil, err
	}
	asset, err := topicAddressStrict(name, topics, 1, "asset")
	if err != nil {
		return nil, err
	}
	oldStrategy, err := dataAddress(name, data, 0, "oldStrategy")
	if err != nil {
		return nil, err
	}
	newStrategy, err := dataAddress(name, data, 1, "newStrategy")
	if err != nil {
		return nil, err
	}
	return AaveCfgReserveInterestRateStrategyChanged{Asset: asset, OldStrategy: oldStrategy, NewStrategy: newStrategy}, nil
}

// decodeCfgTokenUpgraded is shared by ATokenUpgraded and
// VariableDebtTokenUpgraded: identical shapes (all three addresses indexed,
// empty body), distinguished only by topic0 and by the type each wraps.
func decodeCfgTokenUpgraded(name string, topics [][]byte, data []byte) (asset, proxy, impl common.Address, err error) {
	if err = requireTopics(name, topics, 4); err != nil {
		return
	}
	if err = requireDataLen(name, data, 0); err != nil {
		return
	}
	if asset, err = topicAddressStrict(name, topics, 1, "asset"); err != nil {
		return
	}
	if proxy, err = topicAddressStrict(name, topics, 2, "proxy"); err != nil {
		return
	}
	impl, err = topicAddressStrict(name, topics, 3, "implementation")
	return
}

func decodeCfgATokenUpgraded(topics [][]byte, data []byte) (Event, error) {
	asset, proxy, impl, err := decodeCfgTokenUpgraded("AaveCfgATokenUpgraded", topics, data)
	if err != nil {
		return nil, err
	}
	return AaveCfgATokenUpgraded{Asset: asset, Proxy: proxy, Implementation: impl}, nil
}

func decodeCfgVariableDebtTokenUpgraded(topics [][]byte, data []byte) (Event, error) {
	asset, proxy, impl, err := decodeCfgTokenUpgraded("AaveCfgVariableDebtTokenUpgraded", topics, data)
	if err != nil {
		return nil, err
	}
	return AaveCfgVariableDebtTokenUpgraded{Asset: asset, Proxy: proxy, Implementation: impl}, nil
}

// decodeCfgAssetOldNewUint256 reads the (address indexed asset, uint256 old,
// uint256 new) shape shared by the cap/factor/ceiling/fee events.
func decodeCfgAssetOldNewUint256(name string, topics [][]byte, data []byte) (asset common.Address, oldV, newV *big.Int, err error) {
	if err = requireTopics(name, topics, 2); err != nil {
		return
	}
	if err = requireDataLen(name, data, 64); err != nil {
		return
	}
	if asset, err = topicAddressStrict(name, topics, 1, "asset"); err != nil {
		return
	}
	return asset, dataUint256(data, 0), dataUint256(data, 1), nil
}

func decodeCfgSupplyCapChanged(topics [][]byte, data []byte) (Event, error) {
	asset, o, n, err := decodeCfgAssetOldNewUint256("AaveCfgSupplyCapChanged", topics, data)
	if err != nil {
		return nil, err
	}
	return AaveCfgSupplyCapChanged{Asset: asset, OldSupplyCap: o, NewSupplyCap: n}, nil
}

func decodeCfgBorrowCapChanged(topics [][]byte, data []byte) (Event, error) {
	asset, o, n, err := decodeCfgAssetOldNewUint256("AaveCfgBorrowCapChanged", topics, data)
	if err != nil {
		return nil, err
	}
	return AaveCfgBorrowCapChanged{Asset: asset, OldBorrowCap: o, NewBorrowCap: n}, nil
}

func decodeCfgReserveFactorChanged(topics [][]byte, data []byte) (Event, error) {
	asset, o, n, err := decodeCfgAssetOldNewUint256("AaveCfgReserveFactorChanged", topics, data)
	if err != nil {
		return nil, err
	}
	return AaveCfgReserveFactorChanged{Asset: asset, OldReserveFactor: o, NewReserveFactor: n}, nil
}

func decodeCfgDebtCeilingChanged(topics [][]byte, data []byte) (Event, error) {
	asset, o, n, err := decodeCfgAssetOldNewUint256("AaveCfgDebtCeilingChanged", topics, data)
	if err != nil {
		return nil, err
	}
	return AaveCfgDebtCeilingChanged{Asset: asset, OldDebtCeiling: o, NewDebtCeiling: n}, nil
}

func decodeCfgLiquidationProtocolFeeChanged(topics [][]byte, data []byte) (Event, error) {
	asset, o, n, err := decodeCfgAssetOldNewUint256("AaveCfgLiquidationProtocolFeeChanged", topics, data)
	if err != nil {
		return nil, err
	}
	return AaveCfgLiquidationProtocolFeeChanged{Asset: asset, OldFee: o, NewFee: n}, nil
}

// decodeCfgAssetFlag reads the (address indexed asset, bool) shape shared by
// ReserveBorrowing / ReserveFlashLoaning / ReserveStableRateBorrowing.
func decodeCfgAssetFlag(name string, topics [][]byte, data []byte) (common.Address, bool, error) {
	if err := requireTopics(name, topics, 2); err != nil {
		return common.Address{}, false, err
	}
	if err := requireDataLen(name, data, 32); err != nil {
		return common.Address{}, false, err
	}
	asset, err := topicAddressStrict(name, topics, 1, "asset")
	if err != nil {
		return common.Address{}, false, err
	}
	enabled, err := dataBool(name, data, 0, "enabled")
	if err != nil {
		return common.Address{}, false, err
	}
	return asset, enabled, nil
}

func decodeCfgReserveBorrowing(topics [][]byte, data []byte) (Event, error) {
	asset, enabled, err := decodeCfgAssetFlag("AaveCfgReserveBorrowing", topics, data)
	if err != nil {
		return nil, err
	}
	return AaveCfgReserveBorrowing{Asset: asset, Enabled: enabled}, nil
}

func decodeCfgReserveFlashLoaning(topics [][]byte, data []byte) (Event, error) {
	asset, enabled, err := decodeCfgAssetFlag("AaveCfgReserveFlashLoaning", topics, data)
	if err != nil {
		return nil, err
	}
	return AaveCfgReserveFlashLoaning{Asset: asset, Enabled: enabled}, nil
}

func decodeCfgReserveStableRateBorrowing(topics [][]byte, data []byte) (Event, error) {
	asset, enabled, err := decodeCfgAssetFlag("AaveCfgReserveStableRateBorrowing", topics, data)
	if err != nil {
		return nil, err
	}
	return AaveCfgReserveStableRateBorrowing{Asset: asset, Enabled: enabled}, nil
}

// decodeCfgBorrowableInIsolationChanged decodes
// BorrowableInIsolationChanged(address asset, bool borrowable). NOTE the
// asset is NOT indexed on this one (verified against the four real logs and
// the verified ABI) -- it is the only asset-bearing configurator event whose
// asset lives in the body, which is exactly the kind of shape a
// copy-the-neighbour decoder gets wrong.
func decodeCfgBorrowableInIsolationChanged(topics [][]byte, data []byte) (Event, error) {
	const name = "AaveCfgBorrowableInIsolationChanged"
	if err := requireTopics(name, topics, 1); err != nil {
		return nil, err
	}
	if err := requireDataLen(name, data, 64); err != nil {
		return nil, err
	}
	asset, err := dataAddress(name, data, 0, "asset")
	if err != nil {
		return nil, err
	}
	borrowable, err := dataBool(name, data, 1, "borrowable")
	if err != nil {
		return nil, err
	}
	return AaveCfgBorrowableInIsolationChanged{Asset: asset, Borrowable: borrowable}, nil
}

func decodeCfgSiloedBorrowingChanged(topics [][]byte, data []byte) (Event, error) {
	const name = "AaveCfgSiloedBorrowingChanged"
	if err := requireTopics(name, topics, 2); err != nil {
		return nil, err
	}
	if err := requireDataLen(name, data, 64); err != nil {
		return nil, err
	}
	asset, err := topicAddressStrict(name, topics, 1, "asset")
	if err != nil {
		return nil, err
	}
	oldState, err := dataBool(name, data, 0, "oldState")
	if err != nil {
		return nil, err
	}
	newState, err := dataBool(name, data, 1, "newState")
	if err != nil {
		return nil, err
	}
	return AaveCfgSiloedBorrowingChanged{Asset: asset, OldState: oldState, NewState: newState}, nil
}

func decodeCfgFlashloanPremiumTotalUpdated(topics [][]byte, data []byte) (Event, error) {
	const name = "AaveCfgFlashloanPremiumTotalUpdated"
	if err := requireTopics(name, topics, 1); err != nil {
		return nil, err
	}
	if err := requireDataLen(name, data, 64); err != nil {
		return nil, err
	}
	oldV, err := dataUintN(name, data, 0, 128, "oldFlashloanPremiumTotal")
	if err != nil {
		return nil, err
	}
	newV, err := dataUintN(name, data, 1, 128, "newFlashloanPremiumTotal")
	if err != nil {
		return nil, err
	}
	return AaveCfgFlashloanPremiumTotalUpdated{OldFlashloanPremiumTotal: oldV, NewFlashloanPremiumTotal: newV}, nil
}

func decodeCfgFlashloanPremiumToProtocolUpdated(topics [][]byte, data []byte) (Event, error) {
	const name = "AaveCfgFlashloanPremiumToProtocolUpdated"
	if err := requireTopics(name, topics, 1); err != nil {
		return nil, err
	}
	if err := requireDataLen(name, data, 64); err != nil {
		return nil, err
	}
	oldV, err := dataUintN(name, data, 0, 128, "oldFlashloanPremiumToProtocol")
	if err != nil {
		return nil, err
	}
	newV, err := dataUintN(name, data, 1, 128, "newFlashloanPremiumToProtocol")
	if err != nil {
		return nil, err
	}
	return AaveCfgFlashloanPremiumToProtocolUpdated{
		OldFlashloanPremiumToProtocol: oldV, NewFlashloanPremiumToProtocol: newV,
	}, nil
}

// decodeCfgUpgraded decodes the PROXY's Upgraded(address indexed
// implementation) -- the implementation-generation boundary. It carries no
// param, but it is the event that would tell an operator WHY a previously
// unknown topic0 has started arriving, which is why it is in the allowlist
// rather than skipped.
func decodeCfgUpgraded(topics [][]byte, data []byte) (Event, error) {
	const name = "AaveCfgUpgraded"
	if err := requireTopics(name, topics, 2); err != nil {
		return nil, err
	}
	if err := requireDataLen(name, data, 0); err != nil {
		return nil, err
	}
	impl, err := topicAddressStrict(name, topics, 1, "implementation")
	if err != nil {
		return nil, err
	}
	return AaveCfgUpgraded{Implementation: impl}, nil
}

// ---------------------------------------------------------------------------
// Typed events.
// ---------------------------------------------------------------------------

// AaveCfgCollateralConfigurationChanged corresponds to
// CollateralConfigurationChanged(address indexed asset, uint256 ltv,
// uint256 liquidationThreshold, uint256 liquidationBonus). Values are Aave
// basis points (1e4) EXACTLY as emitted.
type AaveCfgCollateralConfigurationChanged struct {
	Asset                                       common.Address
	LTV, LiquidationThreshold, LiquidationBonus *big.Int
}

func (AaveCfgCollateralConfigurationChanged) Name() string {
	return "AaveCfgCollateralConfigurationChanged"
}

// AaveCfgReserveInitialized corresponds to ReserveInitialized(address indexed
// asset, address indexed aToken, address stableDebtToken, address
// variableDebtToken, address interestRateStrategyAddress) -- the reserve
// registry event. StableDebtToken is decoded and carried because it is on the
// wire (this deployment really did deploy stable-debt tokens at genesis, per
// their on-chain symbol()); param_history does not store it because nothing
// downstream consumes it, and raw_logs keeps the bytes regardless.
type AaveCfgReserveInitialized struct {
	Asset, AToken                                            common.Address
	StableDebtToken, VariableDebtToken, InterestRateStrategy common.Address
}

func (AaveCfgReserveInitialized) Name() string { return "AaveCfgReserveInitialized" }

// AaveCfgEModeAssetCategoryChanged corresponds to
// EModeAssetCategoryChanged(address indexed asset, uint8 oldCategoryId,
// uint8 newCategoryId).
type AaveCfgEModeAssetCategoryChanged struct {
	Asset                        common.Address
	OldCategoryID, NewCategoryID uint8
}

func (AaveCfgEModeAssetCategoryChanged) Name() string { return "AaveCfgEModeAssetCategoryChanged" }

// AaveCfgReserveInterestRateDataChanged corresponds to
// ReserveInterestRateDataChanged(address indexed asset, address indexed
// strategy, bytes data). Data is the rate-curve blob, carried verbatim.
type AaveCfgReserveInterestRateDataChanged struct {
	Asset, Strategy common.Address
	Data            []byte
}

func (AaveCfgReserveInterestRateDataChanged) Name() string {
	return "AaveCfgReserveInterestRateDataChanged"
}

// AaveCfgReserveInterestRateStrategyChanged corresponds to
// ReserveInterestRateStrategyChanged(address indexed asset, address
// oldStrategy, address newStrategy).
type AaveCfgReserveInterestRateStrategyChanged struct {
	Asset, OldStrategy, NewStrategy common.Address
}

func (AaveCfgReserveInterestRateStrategyChanged) Name() string {
	return "AaveCfgReserveInterestRateStrategyChanged"
}

// AaveCfgATokenUpgraded corresponds to ATokenUpgraded(address indexed asset,
// address indexed proxy, address indexed implementation).
type AaveCfgATokenUpgraded struct {
	Asset, Proxy, Implementation common.Address
}

func (AaveCfgATokenUpgraded) Name() string { return "AaveCfgATokenUpgraded" }

// AaveCfgVariableDebtTokenUpgraded corresponds to
// VariableDebtTokenUpgraded(address indexed asset, address indexed proxy,
// address indexed implementation).
type AaveCfgVariableDebtTokenUpgraded struct {
	Asset, Proxy, Implementation common.Address
}

func (AaveCfgVariableDebtTokenUpgraded) Name() string { return "AaveCfgVariableDebtTokenUpgraded" }

// AaveCfgSupplyCapChanged corresponds to SupplyCapChanged(address indexed
// asset, uint256 oldSupplyCap, uint256 newSupplyCap) -- WHOLE TOKEN units per
// Aave's cap convention, as emitted.
type AaveCfgSupplyCapChanged struct {
	Asset                      common.Address
	OldSupplyCap, NewSupplyCap *big.Int
}

func (AaveCfgSupplyCapChanged) Name() string { return "AaveCfgSupplyCapChanged" }

// AaveCfgBorrowCapChanged corresponds to BorrowCapChanged(address indexed
// asset, uint256 oldBorrowCap, uint256 newBorrowCap).
type AaveCfgBorrowCapChanged struct {
	Asset                      common.Address
	OldBorrowCap, NewBorrowCap *big.Int
}

func (AaveCfgBorrowCapChanged) Name() string { return "AaveCfgBorrowCapChanged" }

// AaveCfgReserveFactorChanged corresponds to ReserveFactorChanged(address
// indexed asset, uint256 oldReserveFactor, uint256 newReserveFactor).
type AaveCfgReserveFactorChanged struct {
	Asset                              common.Address
	OldReserveFactor, NewReserveFactor *big.Int
}

func (AaveCfgReserveFactorChanged) Name() string { return "AaveCfgReserveFactorChanged" }

// AaveCfgDebtCeilingChanged corresponds to DebtCeilingChanged(address indexed
// asset, uint256 oldDebtCeiling, uint256 newDebtCeiling).
type AaveCfgDebtCeilingChanged struct {
	Asset                          common.Address
	OldDebtCeiling, NewDebtCeiling *big.Int
}

func (AaveCfgDebtCeilingChanged) Name() string { return "AaveCfgDebtCeilingChanged" }

// AaveCfgLiquidationProtocolFeeChanged corresponds to
// LiquidationProtocolFeeChanged(address indexed asset, uint256 oldFee,
// uint256 newFee) -- basis points, as emitted.
type AaveCfgLiquidationProtocolFeeChanged struct {
	Asset          common.Address
	OldFee, NewFee *big.Int
}

func (AaveCfgLiquidationProtocolFeeChanged) Name() string {
	return "AaveCfgLiquidationProtocolFeeChanged"
}

// AaveCfgReserveBorrowing corresponds to ReserveBorrowing(address indexed
// asset, bool enabled).
type AaveCfgReserveBorrowing struct {
	Asset   common.Address
	Enabled bool
}

func (AaveCfgReserveBorrowing) Name() string { return "AaveCfgReserveBorrowing" }

// AaveCfgReserveFlashLoaning corresponds to ReserveFlashLoaning(address
// indexed asset, bool enabled).
type AaveCfgReserveFlashLoaning struct {
	Asset   common.Address
	Enabled bool
}

func (AaveCfgReserveFlashLoaning) Name() string { return "AaveCfgReserveFlashLoaning" }

// AaveCfgReserveStableRateBorrowing corresponds to
// ReserveStableRateBorrowing(address indexed asset, bool enabled) -- a
// GENERATION-1 event name: later PoolConfigurator implementations dropped it
// with stable-rate borrowing, but the three emitted logs stay in custody.
type AaveCfgReserveStableRateBorrowing struct {
	Asset   common.Address
	Enabled bool
}

func (AaveCfgReserveStableRateBorrowing) Name() string { return "AaveCfgReserveStableRateBorrowing" }

// AaveCfgBorrowableInIsolationChanged corresponds to
// BorrowableInIsolationChanged(address asset, bool borrowable) -- asset NOT
// indexed (see the decode function).
type AaveCfgBorrowableInIsolationChanged struct {
	Asset      common.Address
	Borrowable bool
}

func (AaveCfgBorrowableInIsolationChanged) Name() string {
	return "AaveCfgBorrowableInIsolationChanged"
}

// AaveCfgSiloedBorrowingChanged corresponds to SiloedBorrowingChanged(address
// indexed asset, bool oldState, bool newState).
type AaveCfgSiloedBorrowingChanged struct {
	Asset              common.Address
	OldState, NewState bool
}

func (AaveCfgSiloedBorrowingChanged) Name() string { return "AaveCfgSiloedBorrowingChanged" }

// AaveCfgFlashloanPremiumTotalUpdated corresponds to
// FlashloanPremiumTotalUpdated(uint128 oldFlashloanPremiumTotal,
// uint128 newFlashloanPremiumTotal) -- no indexed arguments.
type AaveCfgFlashloanPremiumTotalUpdated struct {
	OldFlashloanPremiumTotal, NewFlashloanPremiumTotal *big.Int
}

func (AaveCfgFlashloanPremiumTotalUpdated) Name() string {
	return "AaveCfgFlashloanPremiumTotalUpdated"
}

// AaveCfgFlashloanPremiumToProtocolUpdated corresponds to
// FlashloanPremiumToProtocolUpdated(uint128 oldFlashloanPremiumToProtocol,
// uint128 newFlashloanPremiumToProtocol) -- no indexed arguments.
type AaveCfgFlashloanPremiumToProtocolUpdated struct {
	OldFlashloanPremiumToProtocol, NewFlashloanPremiumToProtocol *big.Int
}

func (AaveCfgFlashloanPremiumToProtocolUpdated) Name() string {
	return "AaveCfgFlashloanPremiumToProtocolUpdated"
}

// AaveCfgUpgraded corresponds to the PROXY's Upgraded(address indexed
// implementation).
type AaveCfgUpgraded struct {
	Implementation common.Address
}

func (AaveCfgUpgraded) Name() string { return "AaveCfgUpgraded" }
