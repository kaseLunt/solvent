package derive

import (
	"bytes"
	"encoding/json"
	"fmt"
	"math/big"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"testing"

	"github.com/ethereum/go-ethereum/common"
	"github.com/stretchr/testify/require"

	"github.com/kaselunt/solvent/internal/decode"
	"github.com/kaselunt/solvent/internal/store"
)

// ---------------------------------------------------------------------------
// Fixture plumbing (aave-prefixed to avoid colliding with sibling derivers'
// test helpers in this package).
// ---------------------------------------------------------------------------

// aaveFixtureLog mirrors one entry of testdata/aave_*_logs.json: a real log
// re-fetched from primary source via eth_getTransactionReceipt (see the
// file-level provenance strings).
type aaveFixtureLog struct {
	BlockNumber uint64   `json:"blockNumber"`
	BlockHash   string   `json:"blockHash"`
	TxHash      string   `json:"txHash"`
	LogIndex    uint32   `json:"logIndex"`
	Address     string   `json:"address"`
	Topics      []string `json:"topics"`
	Data        string   `json:"data"`
}

// aaveFixtureDoc is the committed fixture file shape: one provenance string
// covering the whole capture, the pin block the golden views were read at,
// and the raw logs.
type aaveFixtureDoc struct {
	Provenance string           `json:"provenance"`
	Synthetic  bool             `json:"synthetic"`
	ChainID    uint64           `json:"chainId"`
	PinBlock   uint64           `json:"pinBlock"`
	Logs       []aaveFixtureLog `json:"logs"`
}

func aaveLoadDoc(t *testing.T, name string) aaveFixtureDoc {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join("testdata", name))
	require.NoError(t, err, "reading testdata/%s", name)
	var doc aaveFixtureDoc
	require.NoError(t, json.Unmarshal(raw, &doc), "unmarshalling testdata/%s", name)
	require.False(t, doc.Synthetic, "golden fixture %s must be real", name)
	require.NotEmpty(t, doc.Logs, "golden fixture %s must not be empty", name)
	return doc
}

func (f aaveFixtureLog) rawLog(chainID uint64) store.RawLog {
	topics := make([][]byte, len(f.Topics))
	for i, tp := range f.Topics {
		topics[i] = common.FromHex(tp)
	}
	return store.RawLog{
		ChainID:     chainID,
		BlockNumber: f.BlockNumber,
		BlockHash:   common.FromHex(f.BlockHash),
		TxHash:      common.FromHex(f.TxHash),
		LogIndex:    f.LogIndex,
		Address:     common.FromHex(f.Address),
		Topics:      topics,
		Data:        common.FromHex(f.Data),
	}
}

func aaveBig(s string) *big.Int {
	v, ok := new(big.Int).SetString(s, 10)
	if !ok {
		panic("bad big.Int literal: " + s)
	}
	return v
}

// aaveRayTimes returns n*RAY for readable synthetic indexes.
func aaveRayTimes(n int64) *big.Int {
	return new(big.Int).Mul(big.NewInt(n), rayUnit)
}

// aaveSynthLog builds a minimal RawLog for synthetic unit-test events;
// Process only reads ChainID/BlockNumber/TxHash/LogIndex/Address from it (the
// typed decode.Event carries the payload).
func aaveSynthLog(block uint64, logIndex uint32, tx byte, address common.Address) store.RawLog {
	txHash := make([]byte, 32)
	txHash[31] = tx
	return store.RawLog{
		ChainID:     1,
		BlockNumber: block,
		TxHash:      txHash,
		LogIndex:    logIndex,
		Address:     address.Bytes(),
	}
}

var (
	aaveUSDC   = common.HexToAddress("0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48")
	aavePYUSD  = common.HexToAddress("0x6c3ea9036406852006290770BEdFcAbA0e23A0e8")
	aaveWEETH  = common.HexToAddress("0xCd5fE23C85820F7B72D0926FC9b05b43E359b7ee")
	aaveFRAX   = common.HexToAddress("0x853d955aCEf822Db058eb8505911ED77F175b99e")
	aaveAWEETH = common.HexToAddress("0xbe1F842e7e0afd2c2322aae5d34bA899544b29db")
	aavePool   = common.HexToAddress("0x0AA97c284e98396202b6A04024F5E2c65026F3c0")
	aaveUserA  = common.HexToAddress("0x1111111111111111111111111111111111111101")
	aaveUserB  = common.HexToAddress("0x1111111111111111111111111111111111111102")
)

// aaveTracked reads the engine's layered tracked balance (working overlay
// first, then promoted committed truth) without triggering hydration — the
// test-side view of the two-layer state.
func aaveTracked(e *AaveEngine, side string, reserve, account common.Address) string {
	st, ok := e.working[account]
	if !ok {
		st, ok = e.promoted[account]
	}
	if !ok {
		return "0"
	}
	if v, ok := st.bySide(side)[reserve]; ok {
		return v.String()
	}
	return "0"
}

// aaveFeedRDU primes the engine's index cache for reserve with the given
// variable-borrow index (liquidity index RAY) inside tx `tx`.
func aaveFeedRDU(t *testing.T, e *AaveEngine, block uint64, logIndex uint32, tx byte, reserve common.Address, vbIndex *big.Int) {
	t.Helper()
	evs, err := e.Process(aaveSynthLog(block, logIndex, tx, aavePool), decode.AaveReserveDataUpdated{
		Reserve:             reserve,
		LiquidityRate:       big.NewInt(0),
		VariableBorrowRate:  big.NewInt(0),
		LiquidityIndex:      new(big.Int).Set(rayUnit),
		VariableBorrowIndex: vbIndex,
	})
	require.NoError(t, err)
	require.Len(t, evs, 1)
}

// ---------------------------------------------------------------------------
// WadRayMath primitives: exact values, including exact-.5 boundaries.
// ---------------------------------------------------------------------------

func TestAaveRayMathRounding(t *testing.T) {
	two := aaveRayTimes(2)
	three := aaveRayTimes(3)
	four := aaveRayTimes(4)

	// rayDiv half-up at an EXACT .5 boundary: 1/2 ray -> 1 (up), while floor
	// keeps 0 (WadRayMath.sol rayDiv :104-112 vs rayDivFloor :125-133).
	require.Equal(t, "1", rayDivHalfUp(big.NewInt(1), two).String())
	require.Equal(t, "0", rayDivFloor(big.NewInt(1), two).String())
	require.Equal(t, "1", rayDivCeil(big.NewInt(1), two).String())
	// 10/4 = 2.5 exactly: half-up 3, floor 2, ceil 3.
	require.Equal(t, "3", rayDivHalfUp(big.NewInt(10), four).String())
	require.Equal(t, "2", rayDivFloor(big.NewInt(10), four).String())
	require.Equal(t, "3", rayDivCeil(big.NewInt(10), four).String())
	// Below .5 stays down under half-up: 1/3 -> 0, 9/4 = 2.25 -> 2.
	require.Equal(t, "0", rayDivHalfUp(big.NewInt(1), three).String())
	require.Equal(t, "2", rayDivHalfUp(big.NewInt(9), four).String())
	require.Equal(t, "3", rayDivCeil(big.NewInt(9), four).String())
	// Above .5 rounds up: 2/3 -> 1, 11/4 = 2.75 -> 3 (floor keeps 2).
	require.Equal(t, "1", rayDivHalfUp(big.NewInt(2), three).String())
	require.Equal(t, "3", rayDivHalfUp(big.NewInt(11), four).String())
	require.Equal(t, "2", rayDivFloor(big.NewInt(11), four).String())

	// rayMul half-up at an EXACT .5 boundary: 1 * RAY/2 = 0.5 -> 1; floor 0;
	// one wei below the boundary stays 0 under half-up.
	half := new(big.Int).Rsh(rayUnit, 1)
	require.Equal(t, "1", rayMulHalfUp(big.NewInt(1), half).String())
	require.Equal(t, "0", rayMulFloor(big.NewInt(1), half).String())
	require.Equal(t, "1", rayMulCeil(big.NewInt(1), half).String())
	require.Equal(t, "0", rayMulHalfUp(big.NewInt(1), new(big.Int).Sub(half, big.NewInt(1))).String())
	// 3 * RAY/2 = 1.5 exactly -> half-up 2.
	require.Equal(t, "2", rayMulHalfUp(big.NewInt(3), half).String())

	// Real regime-A rounding-sensitive case (half-up != floor), cross-checked
	// against archive scaledBalanceOf: the treasury accrual mint at block
	// 22839768 (tx 0x2cbb5618eeeb6bddd04d0e088d09ad27db38bea8f2f6314090c717c223827c1c)
	// minted exactly rayDivHalfUp(26342566995, index) = 26342510857 scaled
	// (cast scaledBalanceOf(0x464c71f6...) @22839767 = 376293386263959309,
	// @22839768 = 376293412606470166, eth.drpc.org, 2026-07-23).
	idx := aaveBig("1000002131081530318762840784")
	require.Equal(t, "26342510857", rayDivHalfUp(aaveBig("26342566995"), idx).String())
	require.Equal(t, "26342510856", rayDivFloor(aaveBig("26342566995"), idx).String())

	// Round-trip identities the deficit zero-out rests on, at i >= RAY:
	// rayDivFloor(rayMulCeil(s, i), i) == s and
	// rayDivHalfUp(rayMulHalfUp(s, i), i) == s.
	for _, s := range []string{"1", "83", "125415", "474254493198165", "3985789485000000"} {
		sv := aaveBig(s)
		require.Equal(t, s, rayDivFloor(rayMulCeil(sv, idx), idx).String(), "floor/ceil round-trip s=%s", s)
		require.Equal(t, s, rayDivHalfUp(rayMulHalfUp(sv, idx), idx).String(), "half-up round-trip s=%s", s)
	}
}

// ---------------------------------------------------------------------------
// ReserveDataUpdated: record-only rate_indexes payload + index cache.
// ---------------------------------------------------------------------------

func TestAaveReserveDataUpdatedRecordEvent(t *testing.T) {
	e := NewAaveEngine()
	beginBatch(t, e, nil)
	vb := aaveBig("1042000000000000000000000000")
	li := aaveBig("1017000000000000000000000000")
	evs, err := e.Process(aaveSynthLog(21000000, 5, 1, aavePool), decode.AaveReserveDataUpdated{
		Reserve: aaveUSDC, LiquidityRate: big.NewInt(0), VariableBorrowRate: big.NewInt(0),
		LiquidityIndex: li, VariableBorrowIndex: vb,
	})
	require.NoError(t, err)
	require.Len(t, evs, 1)
	ev := evs[0]
	require.Equal(t, "aave_reserve_data_updated", ev.EventType)
	require.Equal(t, "", ev.Side, "record-only")
	require.Nil(t, ev.Delta, "record-only")
	require.Equal(t, aaveUSDC.Bytes(), ev.Asset)
	require.Equal(t, uint16(0), ev.Seq)
	// Payload keys are the store.SaveRateIndex kind strings the runner
	// persists rate_indexes rows from.
	require.Equal(t, vb.String(), ev.Payload["variable_borrow_index"])
	require.Equal(t, li.String(), ev.Payload["liquidity_index"])
}

func TestAaveReserveDataUpdatedSubRayIndexError(t *testing.T) {
	e := NewAaveEngine()
	beginBatch(t, e, nil)
	_, err := e.Process(aaveSynthLog(21000000, 5, 1, aavePool), decode.AaveReserveDataUpdated{
		Reserve: aaveUSDC, LiquidityRate: big.NewInt(0), VariableBorrowRate: big.NewInt(0),
		LiquidityIndex: new(big.Int).Set(rayUnit), VariableBorrowIndex: big.NewInt(1),
	})
	require.ErrorContains(t, err, "below RAY")
}

// ---------------------------------------------------------------------------
// Debt folds.
// ---------------------------------------------------------------------------

func TestAaveBorrowMissingIndexError(t *testing.T) {
	e := NewAaveEngine()
	beginBatch(t, e, nil)
	_, err := e.Process(aaveSynthLog(21000000, 7, 1, aavePool), decode.AaveBorrow{
		Reserve: aaveUSDC, User: aaveUserA, OnBehalfOf: aaveUserA,
		Amount: big.NewInt(1000000), InterestRateMode: 2, BorrowRate: big.NewInt(0),
	})
	require.ErrorContains(t, err, "no cached ReserveDataUpdated")
}

func TestAaveBorrowNonVariableModeError(t *testing.T) {
	e := NewAaveEngine()
	beginBatch(t, e, nil)
	aaveFeedRDU(t, e, 21000000, 6, 1, aaveUSDC, new(big.Int).Set(rayUnit))
	_, err := e.Process(aaveSynthLog(21000000, 7, 1, aavePool), decode.AaveBorrow{
		Reserve: aaveUSDC, User: aaveUserA, OnBehalfOf: aaveUserA,
		Amount: big.NewInt(1000000), InterestRateMode: 1, BorrowRate: big.NewInt(0),
	})
	require.ErrorContains(t, err, "not variable(2)")
}

// TestAaveBorrowRegimeRounding: amount 9, index 4*RAY => 2.25 scaled. Regime
// A rounds half-up to 2 (vToken SBTB _mintScaled rayDiv); regime B rounds
// CEIL to 3 (BorrowLogic getVTokenMintScaledAmount). The boundary is
// tx/log-order-aware: at the upgrade block itself, logs BEFORE the Upgraded
// log (logIndex 542) still fold regime A; logs at/after it fold regime B.
func TestAaveBorrowRegimeRounding(t *testing.T) {
	borrow := func(block uint64, rduLog, actionLog uint32) *big.Int {
		e := NewAaveEngine()
		beginBatch(t, e, nil)
		aaveFeedRDU(t, e, block, rduLog, 1, aaveUSDC, aaveRayTimes(4))
		evs, err := e.Process(aaveSynthLog(block, actionLog, 1, aavePool), decode.AaveBorrow{
			Reserve: aaveUSDC, User: aaveUserA, OnBehalfOf: aaveUserB, // delegated: debt lands on OnBehalfOf
			Amount: big.NewInt(9), InterestRateMode: 2, BorrowRate: big.NewInt(0),
		})
		require.NoError(t, err)
		require.Len(t, evs, 1)
		require.Equal(t, "aave_borrow", evs[0].EventType)
		require.Equal(t, "debt", evs[0].Side)
		require.Equal(t, aaveUserB.Bytes(), evs[0].Account, "debt accrues to onBehalfOf")
		require.Equal(t, aaveUSDC.Bytes(), evs[0].Asset)
		require.Equal(t, uint16(0), evs[0].Seq)
		return evs[0].Delta
	}
	require.Equal(t, "2", borrow(aaveTokenMathFromBlock-1, 1, 2).String(), "regime A half-up: 2.25 -> 2")
	require.Equal(t, "2", borrow(aaveTokenMathFromBlock, 1, 2).String(), "upgrade block BEFORE log 542: still regime A")
	require.Equal(t, "3", borrow(aaveTokenMathFromBlock, 600, 601).String(), "upgrade block AT/AFTER log 542: regime B ceil: 2.25 -> 3")
	require.Equal(t, "3", borrow(aaveTokenMathFromBlock+1, 1, 2).String(), "past the upgrade block: regime B")
}

// TestAaveRepayRegimeRounding: amount 11, index 4*RAY => 2.75 scaled. Regime
// A half-up burns 3; regime B FLOOR burns 2 (getVTokenBurnScaledAmount).
func TestAaveRepayRegimeRounding(t *testing.T) {
	repay := func(block uint64, baseLog uint32) *big.Int {
		e := NewAaveEngine()
		beginBatch(t, e, nil)
		aaveFeedRDU(t, e, block, baseLog, 1, aaveUSDC, aaveRayTimes(4))
		_, err := e.Process(aaveSynthLog(block, baseLog+1, 1, aavePool), decode.AaveBorrow{
			Reserve: aaveUSDC, User: aaveUserA, OnBehalfOf: aaveUserA,
			Amount: big.NewInt(100), InterestRateMode: 2, BorrowRate: big.NewInt(0),
		})
		require.NoError(t, err)
		evs, err := e.Process(aaveSynthLog(block, baseLog+2, 1, aavePool), decode.AaveRepay{
			Reserve: aaveUSDC, User: aaveUserA, Repayer: aaveUserA,
			Amount: big.NewInt(11), UseATokens: false,
		})
		require.NoError(t, err)
		require.Len(t, evs, 1)
		require.Equal(t, "aave_repay", evs[0].EventType)
		require.Equal(t, "debt", evs[0].Side)
		return evs[0].Delta
	}
	require.Equal(t, "-3", repay(aaveTokenMathFromBlock-1, 1).String(), "regime A half-up: 2.75 -> 3")
	require.Equal(t, "-3", repay(aaveTokenMathFromBlock, 1).String(), "upgrade block BEFORE log 542: still regime A")
	require.Equal(t, "-2", repay(aaveTokenMathFromBlock, 600).String(), "upgrade block AT/AFTER log 542: regime B floor: 2.75 -> 2")
}

func TestAaveRepayOverdrawnError(t *testing.T) {
	e := NewAaveEngine()
	beginBatch(t, e, nil)
	aaveFeedRDU(t, e, 25000000, 1, 1, aaveUSDC, new(big.Int).Set(rayUnit))
	_, err := e.Process(aaveSynthLog(25000000, 2, 1, aavePool), decode.AaveRepay{
		Reserve: aaveUSDC, User: aaveUserA, Repayer: aaveUserA,
		Amount: big.NewInt(5), UseATokens: false,
	})
	require.ErrorContains(t, err, "negative")
}

// TestAaveLiquidationCallRegimeRounding: unpaired liquidation burns
// debtToCover with half-up (regime A) vs floor (regime B).
func TestAaveLiquidationCallRegimeRounding(t *testing.T) {
	liq := func(block uint64, baseLog uint32) *big.Int {
		e := NewAaveEngine()
		beginBatch(t, e, nil)
		aaveFeedRDU(t, e, block, baseLog, 1, aaveUSDC, aaveRayTimes(4))
		_, err := e.Process(aaveSynthLog(block, baseLog+1, 1, aavePool), decode.AaveBorrow{
			Reserve: aaveUSDC, User: aaveUserA, OnBehalfOf: aaveUserA,
			Amount: big.NewInt(100), InterestRateMode: 2, BorrowRate: big.NewInt(0),
		})
		require.NoError(t, err)
		aaveFeedRDU(t, e, block, baseLog+2, 2, aaveUSDC, aaveRayTimes(4))
		evs, err := e.Process(aaveSynthLog(block, baseLog+3, 2, aavePool), decode.AaveLiquidationCall{
			CollateralAsset: aaveWEETH, DebtAsset: aaveUSDC, User: aaveUserA,
			DebtToCover: big.NewInt(11), LiquidatedCollateralAmount: big.NewInt(1),
			Liquidator: aaveUserB, ReceiveAToken: false,
		})
		require.NoError(t, err)
		require.Len(t, evs, 1)
		require.Equal(t, "aave_liquidation_call", evs[0].EventType)
		require.NotContains(t, evs[0].Payload, "deficit_paired")
		return evs[0].Delta
	}
	require.Equal(t, "-3", liq(aaveTokenMathFromBlock-1, 1).String(), "regime A half-up: 2.75 -> 3")
	require.Equal(t, "-3", liq(aaveTokenMathFromBlock, 1).String(), "upgrade block BEFORE log 542: still regime A")
	require.Equal(t, "-2", liq(aaveTokenMathFromBlock, 600).String(), "upgrade block AT/AFTER log 542: regime B floor: 2.75 -> 2")
}

// TestAaveDeficitZeroOutAndPairing follows the deployed emission order
// (LiquidationLogic.sol :560-563 then :425-434): DeficitCreated first zeroes
// the user's whole tracked scaled debt (needing NO index), then the same-tx
// LiquidationCall for the same (user, debtAsset) folds delta 0 — never
// double-applied. A liquidation in a LATER tx folds normally again.
func TestAaveDeficitZeroOutAndPairing(t *testing.T) {
	e := NewAaveEngine()
	beginBatch(t, e, nil)
	aaveFeedRDU(t, e, 25000000, 1, 1, aaveUSDC, new(big.Int).Set(rayUnit))
	_, err := e.Process(aaveSynthLog(25000000, 2, 1, aavePool), decode.AaveBorrow{
		Reserve: aaveUSDC, User: aaveUserA, OnBehalfOf: aaveUserA,
		Amount: big.NewInt(1000), InterestRateMode: 2, BorrowRate: big.NewInt(0),
	})
	require.NoError(t, err)

	// Deficit tx: DeficitCreated (log 10) precedes LiquidationCall (log 20).
	evs, err := e.Process(aaveSynthLog(25000100, 10, 2, aavePool), decode.AaveDeficitCreated{
		User: aaveUserA, DebtAsset: aaveUSDC, AmountCreated: big.NewInt(400),
	})
	require.NoError(t, err)
	require.Len(t, evs, 1)
	require.Equal(t, "aave_deficit_created", evs[0].EventType)
	require.Equal(t, "-1000", evs[0].Delta.String(), "zero-out of the entire tracked scaled debt")

	aaveFeedRDU(t, e, 25000100, 15, 2, aaveUSDC, new(big.Int).Set(rayUnit))
	evs, err = e.Process(aaveSynthLog(25000100, 20, 2, aavePool), decode.AaveLiquidationCall{
		CollateralAsset: aaveWEETH, DebtAsset: aaveUSDC, User: aaveUserA,
		DebtToCover: big.NewInt(600), LiquidatedCollateralAmount: big.NewInt(1),
		Liquidator: aaveUserB, ReceiveAToken: false,
	})
	require.NoError(t, err)
	require.Len(t, evs, 1)
	require.Equal(t, "0", evs[0].Delta.String(), "paired liquidation is already fully accounted by the deficit zero-out")
	require.Equal(t, "true", evs[0].Payload["deficit_paired"])

	// A second DeficitCreated for the now-empty position is a loud error.
	_, err = e.Process(aaveSynthLog(25000200, 5, 3, aavePool), decode.AaveDeficitCreated{
		User: aaveUserA, DebtAsset: aaveUSDC, AmountCreated: big.NewInt(1),
	})
	require.ErrorContains(t, err, "no tracked")

	// Pairing does NOT leak across txs: a fresh borrow then an unpaired
	// liquidation in a new tx folds normally.
	aaveFeedRDU(t, e, 25000300, 1, 4, aaveUSDC, new(big.Int).Set(rayUnit))
	_, err = e.Process(aaveSynthLog(25000300, 2, 4, aavePool), decode.AaveBorrow{
		Reserve: aaveUSDC, User: aaveUserA, OnBehalfOf: aaveUserA,
		Amount: big.NewInt(50), InterestRateMode: 2, BorrowRate: big.NewInt(0),
	})
	require.NoError(t, err)
	aaveFeedRDU(t, e, 25000301, 1, 5, aaveUSDC, new(big.Int).Set(rayUnit))
	evs, err = e.Process(aaveSynthLog(25000301, 2, 5, aavePool), decode.AaveLiquidationCall{
		CollateralAsset: aaveWEETH, DebtAsset: aaveUSDC, User: aaveUserA,
		DebtToCover: big.NewInt(20), LiquidatedCollateralAmount: big.NewInt(1),
		Liquidator: aaveUserB, ReceiveAToken: false,
	})
	require.NoError(t, err)
	require.Equal(t, "-20", evs[0].Delta.String())
}

// ---------------------------------------------------------------------------
// Collateral folds (aToken streams).
// ---------------------------------------------------------------------------

// TestAaveMintPureInterestRegimeB replays the REAL pure-interest Mint (Value
// == BalanceIncrease) from ETH mainnet tx
// 0x1d5165d743631adca230af5fb45f7d8acb6b9a0e4579410c5ffdb3aa65ef54be, block
// 23357693 log 85 (also decode's atoken_mint.json fixture 0): a transfer-
// accrual Mint whose scaled delta MUST be zero — the same-tx BalanceTransfer
// carries the actual move. Committed pre-state hydrated from a fake reader
// carrying archive scaledBalanceOf (0xa1940ea3... @23357692 =
// 3000000000000000, eth.drpc.org, 2026-07-23).
func TestAaveMintPureInterestRegimeB(t *testing.T) {
	acct := common.HexToAddress("0xa1940ea3f615559255c59da5b16d6da1d1d60e60")
	e := NewAaveEngine()
	beginBatch(t, e, newFakeReader().seed(acct, aaveWEETH, "collateral", aaveBig("3000000000000000")))
	l := aaveSynthLog(23357693, 85, 9, aaveAWEETH)
	evs, err := e.Process(l, decode.ATokenMint{
		Caller: acct, OnBehalfOf: acct,
		Value:           aaveBig("6393244590"),
		BalanceIncrease: aaveBig("6393244590"),
		Index:           aaveBig("1000002131081530318762840784"),
	})
	require.NoError(t, err)
	require.Len(t, evs, 1)
	require.Equal(t, "atoken_mint", evs[0].EventType)
	require.Equal(t, "collateral", evs[0].Side)
	require.Equal(t, "0", evs[0].Delta.String(), "pure interest capitalization: zero new principal, zero scaled delta")
	require.Equal(t, "3000000000000000", aaveTracked(e, "collateral", aaveWEETH, acct))
}

// TestAaveMintRegimeATreasuryAccrual replays the REAL regime-A treasury
// accrual Mint (decode's atoken_mint.json fixture 1): block 22839768 log 385,
// tx 0x2cbb5618eeeb6bddd04d0e088d09ad27db38bea8f2f6314090c717c223827c1c.
// Value 607559443350 INCLUDES BalanceIncrease 581216876355; the scaled delta
// is rayDivHalfUp(Value - BalanceIncrease, index) = 26342510857 — a case
// where half-up differs from floor (26342510856). Pre/post cross-checked
// against archive scaledBalanceOf(0x464c71f6...): @22839767 =
// 376293386263959309, @22839768 = 376293412606470166 (eth.drpc.org, 2026-07-23).
func TestAaveMintRegimeATreasuryAccrual(t *testing.T) {
	treasury := common.HexToAddress("0x464c71f6c2f760dda6093dcb91c24c39e5d6e18c")
	e := NewAaveEngine()
	beginBatch(t, e, newFakeReader().seed(treasury, aaveWEETH, "collateral", aaveBig("376293386263959309")))
	evs, err := e.Process(aaveSynthLog(22839768, 385, 9, aaveAWEETH), decode.ATokenMint{
		Caller: aavePool, OnBehalfOf: treasury,
		Value:           aaveBig("607559443350"),
		BalanceIncrease: aaveBig("581216876355"),
		Index:           aaveBig("1000002131081530318762840784"),
	})
	require.NoError(t, err)
	require.Equal(t, "26342510857", evs[0].Delta.String())
	require.Equal(t, "376293412606470166", aaveTracked(e, "collateral", aaveWEETH, treasury),
		"post-state must equal archive scaledBalanceOf @22839768")
}

// TestAaveRegimeAMintBurnFormulas exercises the three regime-A branches with
// synthetic values on a hydrated base of 10 scaled: supply-path Mint (Value >
// BalanceIncrease), burn-path Mint (Value < BalanceIncrease — interest
// exceeded the withdrawal), and Burn (Value = amount - BalanceIncrease).
func TestAaveRegimeAMintBurnFormulas(t *testing.T) {
	e := NewAaveEngine()
	beginBatch(t, e, newFakeReader().seed(aaveUserA, aaveWEETH, "collateral", big.NewInt(10)))
	idx := aaveRayTimes(2)
	// Supply 100 with 7 accrued: Mint(Value=107, BalanceIncrease=7) =>
	// +rayDivHalfUp(100, 2*RAY) = +50.
	evs, err := e.Process(aaveSynthLog(22000000, 1, 1, aaveAWEETH), decode.ATokenMint{
		Caller: aaveUserA, OnBehalfOf: aaveUserA,
		Value: big.NewInt(107), BalanceIncrease: big.NewInt(7), Index: idx,
	})
	require.NoError(t, err)
	require.Equal(t, "50", evs[0].Delta.String())
	// Withdraw 3 while 10 accrued: _burnScaled emits Mint(Value=7,
	// BalanceIncrease=10) => -rayDivHalfUp(3, 2*RAY) = -2 (1.5 rounds up).
	evs, err = e.Process(aaveSynthLog(22000001, 1, 2, aaveAWEETH), decode.ATokenMint{
		Caller: aaveUserA, OnBehalfOf: aaveUserA,
		Value: big.NewInt(7), BalanceIncrease: big.NewInt(10), Index: idx,
	})
	require.NoError(t, err)
	require.Equal(t, "-2", evs[0].Delta.String())
	// Withdraw 21 with 5 accrued: Burn(Value=16, BalanceIncrease=5) =>
	// -rayDivHalfUp(21, 2*RAY) = -11 (10.5 rounds up).
	evs, err = e.Process(aaveSynthLog(22000002, 1, 3, aaveAWEETH), decode.ATokenBurn{
		From: aaveUserA, Target: aaveUserA,
		Value: big.NewInt(16), BalanceIncrease: big.NewInt(5), Index: idx,
	})
	require.NoError(t, err)
	require.Equal(t, "-11", evs[0].Delta.String())
	require.Equal(t, "47", aaveTracked(e, "collateral", aaveWEETH, aaveUserA), "10 + 50 - 2 - 11")
}

// TestAaveTxGroupedPairsNotDoubleApplied is the MANDATORY tx-grouped fixture
// test: the four weETH aToken logs of liquidation tx
// 0x7714dcf79e5fd1a513df817963af61db0c3e02133c355cbfb2b36c3dbc7dc09d (block
// 25334454), replayed verbatim from the committed golden fixture:
//
//	log 233 Transfer(borrower -> 0x0, 471571038756893)   } ONE burn
//	log 234 Burn(borrower, 471571038756893, bi=0, idx)   }
//	log 236 Transfer(borrower -> treasury, 2684465116263)     } ONE peer transfer
//	log 237 BalanceTransfer(borrower -> treasury, 2684459395462, idx) }
//
// The ERC20 Transfers are record-only overlapping views and MUST NOT fold;
// the Burn folds via the regime-B inversion; the BalanceTransfer's ALREADY-
// SCALED value applies exactly once (-from/+to). Committed pre-states are
// hydrated from a fake reader carrying archive scaledBalanceOf @25334453
// (borrower 0x2ec19e98... = 474254493198165, treasury 0x464c71f6... =
// 385079122245736975); post-states asserted against @25334454 (borrower = 0,
// treasury = 385081806705132437); eth.drpc.org, 2026-07-23.
func TestAaveTxGroupedPairsNotDoubleApplied(t *testing.T) {
	doc := aaveLoadDoc(t, "aave_atoken_weeth_logs.json")
	const tx = "0x7714dcf79e5fd1a513df817963af61db0c3e02133c355cbfb2b36c3dbc7dc09d"
	var group []aaveFixtureLog
	for _, l := range doc.Logs {
		if l.TxHash == tx {
			group = append(group, l)
		}
	}
	require.Len(t, group, 4, "the liquidation tx carries exactly the four weETH aToken logs 233/234/236/237")
	sort.Slice(group, func(i, j int) bool { return group[i].LogIndex < group[j].LogIndex })
	require.Equal(t, []uint32{233, 234, 236, 237}, []uint32{group[0].LogIndex, group[1].LogIndex, group[2].LogIndex, group[3].LogIndex})

	borrower := common.HexToAddress("0x2ec19e982172ead28b312a07faf25105fb3747d8")
	treasury := common.HexToAddress("0x464c71f6c2f760dda6093dcb91c24c39e5d6e18c")
	e := NewAaveEngine()
	beginBatch(t, e, newFakeReader().
		seed(borrower, aaveWEETH, "collateral", aaveBig("474254493198165")).
		seed(treasury, aaveWEETH, "collateral", aaveBig("385079122245736975")))

	r := decode.NewRegistry()
	var folded []store.PositionEvent
	for _, fl := range group {
		raw := fl.rawLog(doc.ChainID)
		d, ok, err := r.Decode(AaveEngineName, raw)
		require.NoError(t, err)
		require.True(t, ok)
		evs, err := e.Process(raw, d)
		require.NoError(t, err)
		folded = append(folded, evs...)
	}
	// 233 Transfer record-only; 234 Burn folds; 236 Transfer record-only;
	// 237 BalanceTransfer fans out Seq 0 (-from) and Seq 1 (+to).
	require.Len(t, folded, 5)
	require.Equal(t, "atoken_transfer", folded[0].EventType)
	require.Nil(t, folded[0].Delta, "ERC20 Transfer is record-only, never folded")
	require.Equal(t, "", folded[0].Side)
	require.Equal(t, "atoken_burn", folded[1].EventType)
	require.Equal(t, "-471570033802703", folded[1].Delta.String(), "regime-B inversion recovers the true scaled burn")
	require.Equal(t, "atoken_transfer", folded[2].EventType)
	require.Nil(t, folded[2].Delta)
	require.Equal(t, "atoken_balance_transfer", folded[3].EventType)
	require.Equal(t, uint16(0), folded[3].Seq)
	require.Equal(t, borrower.Bytes(), folded[3].Account)
	require.Equal(t, "-2684459395462", folded[3].Delta.String())
	require.Equal(t, "atoken_balance_transfer", folded[4].EventType)
	require.Equal(t, uint16(1), folded[4].Seq)
	require.Equal(t, treasury.Bytes(), folded[4].Account)
	require.Equal(t, "2684459395462", folded[4].Delta.String())

	require.Equal(t, "0", aaveTracked(e, "collateral", aaveWEETH, borrower),
		"borrower post-state must equal archive scaledBalanceOf @25334454")
	require.Equal(t, "385081806705132437", aaveTracked(e, "collateral", aaveWEETH, treasury),
		"treasury post-state must equal archive scaledBalanceOf @25334454")
}

func TestAaveATokenUnknownAddressError(t *testing.T) {
	e := NewAaveEngine()
	beginBatch(t, e, nil)
	_, err := e.Process(aaveSynthLog(25000000, 1, 1, aaveUserA), decode.ATokenMint{
		Caller: aaveUserA, OnBehalfOf: aaveUserA,
		Value: big.NewInt(1), BalanceIncrease: big.NewInt(0), Index: new(big.Int).Set(rayUnit),
	})
	require.ErrorContains(t, err, "not one of the four pinned aTokens")
}

func TestAaveBalanceTransferOverdrawnError(t *testing.T) {
	e := NewAaveEngine()
	beginBatch(t, e, nil)
	_, err := e.Process(aaveSynthLog(25000000, 1, 1, aaveAWEETH), decode.ATokenBalanceTransfer{
		From: aaveUserA, To: aaveUserB, Value: big.NewInt(5), Index: new(big.Int).Set(rayUnit),
	})
	require.ErrorContains(t, err, "negative")
}

// ---------------------------------------------------------------------------
// Golden full-history replay.
// ---------------------------------------------------------------------------

// TestAaveGoldenFullHistoryReplay replays the COMPLETE committed history of
// the dormant ether.fi Aave market — every Borrow (138 lifetime) / Repay /
// LiquidationCall / DeficitCreated Pool log with their same-tx
// ReserveDataUpdated logs, interleaved with the complete weETH aToken stream
// (757 logs) — through the deriver in (block, logIndex) order, folding the
// returned PositionEvents alone (never peeking at engine internals), and
// asserts the two recon golden borrowers' derived state against on-chain
// views captured at pin block 25593800 via cast (eth.drpc.org, 2026-07-23):
//
//	0x70daaac436465a0d03e45916fa68ddee6086e5fe:
//	  vUSDC(0x9355032d...).scaledBalanceOf  = 125415
//	  aWeETH(0xbe1F842e...).scaledBalanceOf = 58420665095130
//	  dataProvider.getUserReserveData(USDC).currentVariableDebt = 137184, scaledVariableDebt = 125415
//	0xe649a394fb16b58ee2e59feb2ea571e7733c812a:
//	  vPYUSD(0xD2cf07dE...).scaledBalanceOf = 83
//	  aWeETH.scaledBalanceOf                = 7045575913579
//	  dataProvider.getUserReserveData(PYUSD).currentVariableDebt = 84, scaledVariableDebt = 83
//
// The replay spans both fold regimes (all 138 borrows and most repays are
// regime A; 9 repays, 3 liquidations and 3 deficits are regime B, including
// the unverified-Pool-impl window 24196552..24920566). Bit-exact agreement
// OUTCOME-PINS every observed action; it does NOT discriminate the window's
// rounding rule (every observed window repay is identical under floor and
// half-up — see the package comment), whose assumption remains inherited
// through the verified-implementation sandwich.
func TestAaveGoldenFullHistoryReplay(t *testing.T) {
	pool := aaveLoadDoc(t, "aave_pool_logs.json")
	atoken := aaveLoadDoc(t, "aave_atoken_weeth_logs.json")
	require.Equal(t, pool.PinBlock, atoken.PinBlock, "both fixtures must share the pin block")

	logs := append(append([]aaveFixtureLog{}, pool.Logs...), atoken.Logs...)
	sort.Slice(logs, func(i, j int) bool {
		if logs[i].BlockNumber != logs[j].BlockNumber {
			return logs[i].BlockNumber < logs[j].BlockNumber
		}
		return logs[i].LogIndex < logs[j].LogIndex
	})

	e := NewAaveEngine()
	beginBatch(t, e, nil) // from genesis: committed state is empty
	r := decode.NewRegistry()
	type key struct {
		account common.Address
		asset   common.Address
		side    string
	}
	balances := make(map[key]*big.Int)
	counts := map[string]int{}
	skipped := 0
	for _, fl := range logs {
		raw := fl.rawLog(pool.ChainID)
		d, ok, err := r.Decode(AaveEngineName, raw)
		require.NoError(t, err, "block %d log %d", fl.BlockNumber, fl.LogIndex)
		if !ok {
			skipped++ // Approval/Upgraded/Initialized etc. — outside the decode allowlist
			continue
		}
		evs, err := e.Process(raw, d)
		require.NoError(t, err, "block %d log %d (%s)", fl.BlockNumber, fl.LogIndex, d.Name())
		for _, ev := range evs {
			counts[ev.EventType]++
			if ev.Side == "" || ev.Delta == nil {
				continue
			}
			k := key{common.BytesToAddress(ev.Account), common.BytesToAddress(ev.Asset), ev.Side}
			if balances[k] == nil {
				balances[k] = new(big.Int)
			}
			balances[k].Add(balances[k], ev.Delta)
		}
	}

	require.Equal(t, 138, counts["aave_borrow"], "the dormant market's complete lifetime borrow count")
	require.Equal(t, 103, counts["aave_repay"])
	require.Equal(t, 25, counts["aave_liquidation_call"])
	require.Equal(t, 4, counts["aave_deficit_created"])
	require.Equal(t, 314, counts["aave_reserve_data_updated"])
	require.NotZero(t, skipped, "the aToken stream carries decode-skipped admin logs by design")

	get := func(account, asset common.Address, side string) string {
		if v, ok := balances[key{account, asset, side}]; ok {
			return v.String()
		}
		return "0"
	}
	b1 := common.HexToAddress("0x70daaac436465a0d03e45916fa68ddee6086e5fe")
	b2 := common.HexToAddress("0xe649a394fb16b58ee2e59feb2ea571e7733c812a")
	require.Equal(t, "125415", get(b1, aaveUSDC, "debt"), "borrower 1 scaled USDC debt vs scaledBalanceOf @25593800")
	require.Equal(t, "58420665095130", get(b1, aaveWEETH, "collateral"), "borrower 1 scaled weETH collateral vs scaledBalanceOf @25593800")
	require.Equal(t, "83", get(b2, aavePYUSD, "debt"), "borrower 2 scaled PYUSD debt vs scaledBalanceOf @25593800")
	require.Equal(t, "7045575913579", get(b2, aaveWEETH, "collateral"), "borrower 2 scaled weETH collateral vs scaledBalanceOf @25593800")

	// Deficit write-offs must have zeroed the liquidated borrowers exactly.
	require.Equal(t, "0", get(common.HexToAddress("0x2ec19e982172ead28b312a07faf25105fb3747d8"), common.HexToAddress("0x853d955aCEf822Db058eb8505911ED77F175b99e"), "debt"))
	require.Equal(t, "0", get(common.HexToAddress("0xccaf0e1b0f70157d69dbe771dd2559dd70e78367"), aaveUSDC, "debt"))

	// No tracked balance may ever be negative after a full replay.
	for k, v := range balances {
		require.GreaterOrEqual(t, v.Sign(), 0, "negative %s balance for %s/%s", k.side, k.account.Hex(), k.asset.Hex())
	}
}

// TestAaveGoldenReplayDeterminism replays the merged stream twice and
// requires byte-identical position events — the replay-identity property the
// Engine contract demands.
func TestAaveGoldenReplayDeterminism(t *testing.T) {
	pool := aaveLoadDoc(t, "aave_pool_logs.json")
	atoken := aaveLoadDoc(t, "aave_atoken_weeth_logs.json")
	logs := append(append([]aaveFixtureLog{}, pool.Logs...), atoken.Logs...)
	sort.Slice(logs, func(i, j int) bool {
		if logs[i].BlockNumber != logs[j].BlockNumber {
			return logs[i].BlockNumber < logs[j].BlockNumber
		}
		return logs[i].LogIndex < logs[j].LogIndex
	})
	run := func() string {
		e := NewAaveEngine()
		beginBatch(t, e, nil)
		r := decode.NewRegistry()
		var sb []byte
		for _, fl := range logs {
			raw := fl.rawLog(pool.ChainID)
			d, ok, err := r.Decode(AaveEngineName, raw)
			require.NoError(t, err)
			if !ok {
				continue
			}
			evs, err := e.Process(raw, d)
			require.NoError(t, err)
			for _, ev := range evs {
				delta := "<nil>"
				if ev.Delta != nil {
					delta = ev.Delta.String()
				}
				sb = append(sb, []byte(fmt.Sprintf("%d/%d/%d %s %x %x %s %s %v\n",
					ev.BlockNumber, ev.LogIndex, ev.Seq, ev.EventType, ev.Account, ev.Asset, ev.Side, delta, ev.Payload))...)
			}
		}
		return string(sb)
	}
	require.Equal(t, run(), run())
}

// ---------------------------------------------------------------------------
// Same-tx index requirement, regime boundary, deficit ordering, sweep items.
// ---------------------------------------------------------------------------

// TestAaveRegimeBoundaryBoundToFixture binds the regime-B boundary constants
// to the committed capture: the weETH aToken's Upgraded log to the v3.5 impl
// 0xaa7448de... sits at exactly (block 23088584, logIndex 542) on the aToken
// proxy. If either constant ever drifts from the fixture bytes, this fails.
func TestAaveRegimeBoundaryBoundToFixture(t *testing.T) {
	doc := aaveLoadDoc(t, "aave_atoken_weeth_logs.json")
	const upgradedTopic = "0xbc7cd75a20ee27fd9adebab32041f755214dbc6bffa90cc0225b39da2e5c2d3b"
	const v35ImplTopic = "0x000000000000000000000000aa7448de2be3ebdf9b5b0fa614accd119b3898bc"
	var found []aaveFixtureLog
	for _, l := range doc.Logs {
		if len(l.Topics) >= 2 && strings.EqualFold(l.Topics[0], upgradedTopic) && strings.EqualFold(l.Topics[1], v35ImplTopic) {
			found = append(found, l)
		}
	}
	require.Len(t, found, 1, "exactly one Upgraded-to-v3.5 log in the committed aToken stream")
	require.Equal(t, uint64(aaveTokenMathFromBlock), found[0].BlockNumber)
	require.Equal(t, uint32(aaveTokenMathBoundaryLogIndex), found[0].LogIndex)
	require.Equal(t, aaveAWEETH, common.HexToAddress(found[0].Address))
	require.Equal(t, "0xa17567fa201a78b66c43e6ab178559f8c1d5d308fe944c0bd2c39b5e585097dc", strings.ToLower(found[0].TxHash))
}

// TestAaveIndexedActionRequiresSameTxRDU: every indexed action must be
// preceded, within its own transaction, by its reserve's ReserveDataUpdated
// — the two mandated negative shapes are typed ErrMissingSameTxIndex.
func TestAaveIndexedActionRequiresSameTxRDU(t *testing.T) {
	borrowEv := decode.AaveBorrow{
		Reserve: aaveUSDC, User: aaveUserA, OnBehalfOf: aaveUserA,
		Amount: big.NewInt(5), InterestRateMode: 2, BorrowRate: big.NewInt(0),
	}

	t.Run("older-tx RDU present, own-tx RDU absent", func(t *testing.T) {
		e := NewAaveEngine()
		beginBatch(t, e, nil)
		aaveFeedRDU(t, e, 25000000, 1, 1, aaveUSDC, new(big.Int).Set(rayUnit)) // tx 1
		_, err := e.Process(aaveSynthLog(25000001, 2, 2, aavePool), borrowEv)  // tx 2: no own RDU
		require.ErrorIs(t, err, ErrMissingSameTxIndex)
		require.ErrorContains(t, err, "foreign index")
	})

	t.Run("RDU after the action in the same tx", func(t *testing.T) {
		e := NewAaveEngine()
		beginBatch(t, e, nil)
		aaveFeedRDU(t, e, 25000000, 10, 1, aaveUSDC, new(big.Int).Set(rayUnit)) // tx 1 log 10
		_, err := e.Process(aaveSynthLog(25000000, 5, 1, aavePool), borrowEv)   // tx 1 log 5 < 10
		require.ErrorIs(t, err, ErrMissingSameTxIndex)
		require.ErrorContains(t, err, "AFTER the action")
	})

	t.Run("no RDU at all", func(t *testing.T) {
		e := NewAaveEngine()
		beginBatch(t, e, nil)
		_, err := e.Process(aaveSynthLog(25000000, 5, 1, aavePool), borrowEv)
		require.ErrorIs(t, err, ErrMissingSameTxIndex)
		require.ErrorContains(t, err, "no cached ReserveDataUpdated")
	})

	t.Run("repay and liquidation are gated too", func(t *testing.T) {
		e := NewAaveEngine()
		beginBatch(t, e, nil)
		aaveFeedRDU(t, e, 25000000, 1, 1, aaveUSDC, new(big.Int).Set(rayUnit))
		_, err := e.Process(aaveSynthLog(25000000, 2, 1, aavePool), borrowEv)
		require.NoError(t, err)
		_, err = e.Process(aaveSynthLog(25000001, 2, 2, aavePool), decode.AaveRepay{
			Reserve: aaveUSDC, User: aaveUserA, Repayer: aaveUserA, Amount: big.NewInt(1),
		})
		require.ErrorIs(t, err, ErrMissingSameTxIndex)
		_, err = e.Process(aaveSynthLog(25000001, 3, 2, aavePool), decode.AaveLiquidationCall{
			CollateralAsset: aaveWEETH, DebtAsset: aaveUSDC, User: aaveUserA,
			DebtToCover: big.NewInt(1), LiquidatedCollateralAmount: big.NewInt(1),
			Liquidator: aaveUserB, ReceiveAToken: false,
		})
		require.ErrorIs(t, err, ErrMissingSameTxIndex)
	})
}

// TestAaveDeficitAfterLiquidationCallSameTxErrors: the deficit zero-out is
// exact only in the DEPLOYED deficit-first emission order; a reversed same-tx
// order (LiquidationCall folding before DeficitCreated for the same pair)
// would double-count and must be a loud error.
func TestAaveDeficitAfterLiquidationCallSameTxErrors(t *testing.T) {
	e := NewAaveEngine()
	beginBatch(t, e, nil)
	aaveFeedRDU(t, e, 25000000, 1, 1, aaveUSDC, new(big.Int).Set(rayUnit))
	_, err := e.Process(aaveSynthLog(25000000, 2, 1, aavePool), decode.AaveBorrow{
		Reserve: aaveUSDC, User: aaveUserA, OnBehalfOf: aaveUserA,
		Amount: big.NewInt(1000), InterestRateMode: 2, BorrowRate: big.NewInt(0),
	})
	require.NoError(t, err)

	// Reversed order inside tx 2: LiquidationCall folds first...
	aaveFeedRDU(t, e, 25000100, 5, 2, aaveUSDC, new(big.Int).Set(rayUnit))
	_, err = e.Process(aaveSynthLog(25000100, 6, 2, aavePool), decode.AaveLiquidationCall{
		CollateralAsset: aaveWEETH, DebtAsset: aaveUSDC, User: aaveUserA,
		DebtToCover: big.NewInt(600), LiquidatedCollateralAmount: big.NewInt(1),
		Liquidator: aaveUserB, ReceiveAToken: false,
	})
	require.NoError(t, err)
	// ...then a same-tx DeficitCreated for the same (user, debtAsset): refused.
	_, err = e.Process(aaveSynthLog(25000100, 7, 2, aavePool), decode.AaveDeficitCreated{
		User: aaveUserA, DebtAsset: aaveUSDC, AmountCreated: big.NewInt(400),
	})
	require.ErrorContains(t, err, "deficit-first")
	require.ErrorContains(t, err, "double-count")
}

// TestAaveImpossibleStateDetector: BalanceIncrease > 0 against a ZERO tracked
// scaled balance is impossible on-chain (interest cannot accrue on nothing) —
// under the hydration lifecycle it proves incomplete committed state and must
// error loudly in BOTH regimes, for Mint and Burn alike.
func TestAaveImpossibleStateDetector(t *testing.T) {
	for _, tc := range []struct {
		name  string
		block uint64
	}{
		{"regime A", aaveTokenMathFromBlock - 100},
		{"regime B", aaveTokenMathFromBlock + 100},
	} {
		t.Run(tc.name, func(t *testing.T) {
			e := NewAaveEngine()
			beginBatch(t, e, nil) // empty committed state: tracked s == 0
			_, err := e.Process(aaveSynthLog(tc.block, 1, 1, aaveAWEETH), decode.ATokenMint{
				Caller: aaveUserA, OnBehalfOf: aaveUserA,
				Value: big.NewInt(10), BalanceIncrease: big.NewInt(3), Index: new(big.Int).Set(rayUnit),
			})
			require.ErrorContains(t, err, "impossible-state detector")

			_, err = e.Process(aaveSynthLog(tc.block, 2, 1, aaveAWEETH), decode.ATokenBurn{
				From: aaveUserA, Target: aaveUserA,
				Value: big.NewInt(10), BalanceIncrease: big.NewInt(3), Index: new(big.Int).Set(rayUnit),
			})
			require.ErrorContains(t, err, "impossible-state detector")
		})
	}
}

// TestAaveBalanceTransferPayloadNotShared: the BalanceTransfer fan-out must
// give each of its two events its OWN payload map — mutating one must never
// alias into the other.
func TestAaveBalanceTransferPayloadNotShared(t *testing.T) {
	e := NewAaveEngine()
	beginBatch(t, e, newFakeReader().seed(aaveUserA, aaveWEETH, "collateral", big.NewInt(5)))
	evs, err := e.Process(aaveSynthLog(25000000, 1, 1, aaveAWEETH), decode.ATokenBalanceTransfer{
		From: aaveUserA, To: aaveUserB, Value: big.NewInt(5), Index: new(big.Int).Set(rayUnit),
	})
	require.NoError(t, err)
	require.Len(t, evs, 2)
	require.Equal(t, evs[0].Payload, evs[1].Payload, "same content")
	evs[0].Payload["mutated"] = "yes"
	require.NotContains(t, evs[1].Payload, "mutated", "payload maps must not share storage")
}

// TestAaveWindowPinnedArchiveScaledDebt pins the unverified-Pool window
// (blocks 24196552..24920566, impl 0xbe82113a...) to ARCHIVE TRUTH: for every
// action event inside the window — the three repays and the deficit pair —
// the derived tracked scaled debt immediately before and after the action
// block must equal vToken scaledBalanceOf captured from archive state:
//
//	vUSDC 0x9355032d747f1e08F8720CD01950E652eE15cdB7, vFRAX
//	0xfd3aDA5AAbdc6531C7C2AC46c00eBf870f5a0E6B (data provider
//	getReserveTokensAddresses); captured with cast call
//	"scaledBalanceOf(address)" via https://eth.drpc.org (archive), 2026-07-23:
//
//	0xe17b347b... vUSDC @24371584 = 474724123          -> @24371585 = 0 (full repay, tx 0xb36a650b..., log 324)
//	0xe17b347b... vFRAX @24371594 = 9991129357032481316289 -> @24371595 = 0 (full repay, tx 0x5e45ec96..., log 534)
//	0xbd0c6f59... vUSDC @24788837 = 998962552          -> @24788838 = 530542774 (partial repay, tx 0x53a07dae..., log 1020)
//	0x5280be3a... vUSDC @24466430 = 2302612            -> @24466431 = 0 (deficit+liquidation pair, tx 0xe8348806..., logs 587/596)
//
// A scaled balance only moves on fold events, so "state at end of block B"
// equals the sum of the account's debt deltas over all events with
// BlockNumber <= B. These assertions OUTCOME-PIN every observed window
// action; they do NOT discriminate the window's rounding rule — all three
// window repays produce identical results under floor and under half-up
// division (and the deficit pair is index-free), so the floor/ceil (regime
// B) assumption is inherited from the verified v3.5 successor impl via the
// sandwich, not proven by these events.
func TestAaveWindowPinnedArchiveScaledDebt(t *testing.T) {
	steps := aaveGoldenSteps(t)
	e := NewAaveEngine()
	beginBatch(t, e, nil)
	events := processAll(t, e, steps)

	sumThrough := func(user, reserve common.Address, block uint64) string {
		net := new(big.Int)
		for _, ev := range events {
			if ev.BlockNumber <= block && ev.Side == "debt" && ev.Delta != nil &&
				bytes.Equal(ev.Account, user.Bytes()) && bytes.Equal(ev.Asset, reserve.Bytes()) {
				net.Add(net, ev.Delta)
			}
		}
		return net.String()
	}

	userE17 := common.HexToAddress("0xe17b347be07a423e3eb0ded3c3db82e138a48f51")
	userBD0 := common.HexToAddress("0xbd0c6f59ee76560b26f07d8a1187d12530359cc1")
	user528 := common.HexToAddress("0x5280be3a25a731e2ce0793fe4928f2ebf74c330d")
	for _, c := range []struct {
		name    string
		user    common.Address
		reserve common.Address
		block   uint64
		want    string
	}{
		{"e17b USDC before repay", userE17, aaveUSDC, 24371584, "474724123"},
		{"e17b USDC after repay", userE17, aaveUSDC, 24371585, "0"},
		{"e17b FRAX before repay", userE17, aaveFRAX, 24371594, "9991129357032481316289"},
		{"e17b FRAX after repay", userE17, aaveFRAX, 24371595, "0"},
		{"bd0c USDC before repay", userBD0, aaveUSDC, 24788837, "998962552"},
		{"bd0c USDC after repay", userBD0, aaveUSDC, 24788838, "530542774"},
		{"5280 USDC before deficit pair", user528, aaveUSDC, 24466430, "2302612"},
		{"5280 USDC after deficit pair", user528, aaveUSDC, 24466431, "0"},
	} {
		require.Equal(t, c.want, sumThrough(c.user, c.reserve, c.block),
			"%s: derived scaled debt at end of block %d must equal archive scaledBalanceOf", c.name, c.block)
	}
}
