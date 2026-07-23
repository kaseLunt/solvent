package derive

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math/big"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/ethereum/go-ethereum/accounts/abi"
	"github.com/ethereum/go-ethereum/common"
	"github.com/stretchr/testify/require"

	"github.com/kaselunt/solvent/internal/decode"
	"github.com/kaselunt/solvent/internal/store"
)

var (
	tUser  = common.HexToAddress("0x1111111111111111111111111111111111111111")
	tUser2 = common.HexToAddress("0x2222222222222222222222222222222222222222")
	tPayer = common.HexToAddress("0x3333333333333333333333333333333333333333")
	tLiqor = common.HexToAddress("0x4444444444444444444444444444444444444444")
	tWeETH = common.HexToAddress("0x5A7fACB970D094B6C7FF1df0eA68D99E6e73CBFF")
	tUSDC  = common.HexToAddress("0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85")
	tUSDT  = common.HexToAddress("0x94b008aA00579c1307B0EF2c499aD98a8ce58e58")
	// frxUSD (18-dec stable) and the genuinely non-stable borrow tokens
	// (recon "Asset registry" + caveat 1).
	tFrxUSD    = common.HexToAddress("0x80Eede496655FB9047dd39d9f418d5483ED600df")
	tEURC      = common.HexToAddress("0xDCB612005417Dc906fF72c87DF732e5a90D49e11")
	tLiquidUSD = common.HexToAddress("0x08c6F91e2B681FaF5e17227F2a44C307b3C1364C")
)

func num(s string) *big.Int {
	v, ok := new(big.Int).SetString(s, 10)
	if !ok {
		panic("bad big.Int literal: " + s)
	}
	return v
}

// tLog builds a minimal RawLog identity for unit tests: Process only reads
// ChainID, BlockNumber, TxHash and LogIndex (decoding already happened).
func tLog(block uint64, tx byte, logIndex uint32) store.RawLog {
	txh := make([]byte, 32)
	txh[31] = tx
	return store.RawLog{ChainID: 10, BlockNumber: block, TxHash: txh, LogIndex: logIndex}
}

// newDM builds a batch-started DebtManager whose committed state is served by
// r (empty when nil).
func newDM(t *testing.T, chain DMChainReads, r StateReader) *DebtManager {
	t.Helper()
	dm := NewDebtManager(chain)
	beginBatch(t, dm, r)
	return dm
}

// feedIndex pushes a DMInterestIndexUpdated through Process and requires the
// no-position-event contract for it.
func feedIndex(t *testing.T, dm *DebtManager, block uint64, token common.Address, newIndex *big.Int) {
	t.Helper()
	evs, err := dm.Process(tLog(block, 0xee, 1), decode.DMInterestIndexUpdated{
		Token: token, OldIndex: big.NewInt(1), NewIndex: newIndex,
	})
	require.NoError(t, err)
	require.Empty(t, evs, "InterestIndexUpdated must not emit position events (rate_indexes owns that stream)")
}

type fakeChainReads struct {
	calldata map[common.Hash][]byte
	err      error
	calls    int
}

func (f *fakeChainReads) TxCalldata(_ context.Context, h common.Hash) ([]byte, error) {
	f.calls++
	if f.err != nil {
		return nil, f.err
	}
	cd, ok := f.calldata[h]
	if !ok {
		return nil, fmt.Errorf("fakeChainReads: no calldata for %s", h)
	}
	return cd, nil
}

// buildExecute302Calldata packs a canonical execute302 migration call whose
// LayerZero message is abi.encode(address[] borrowers, uint256[] amounts) --
// the exact wire shape decode.DecodeMigrationCalldata accepts (selector
// 0xcfc32570, observed on 69 of the 80 real migration txs in the step-0
// sweep).
func buildExecute302Calldata(t *testing.T, borrowers []common.Address, amounts []*big.Int) []byte {
	t.Helper()
	addrArr, err := abi.NewType("address[]", "", nil)
	require.NoError(t, err)
	uintArr, err := abi.NewType("uint256[]", "", nil)
	require.NoError(t, err)
	message, err := abi.Arguments{{Type: addrArr}, {Type: uintArr}}.Pack(borrowers, amounts)
	require.NoError(t, err)

	execTuple, err := abi.NewType("tuple", "", []abi.ArgumentMarshaling{
		{Name: "receiver", Type: "address"},
		{Name: "origin", Type: "tuple", Components: []abi.ArgumentMarshaling{
			{Name: "srcEid", Type: "uint32"},
			{Name: "sender", Type: "bytes32"},
			{Name: "nonce", Type: "uint64"},
		}},
		{Name: "guid", Type: "bytes32"},
		{Name: "message", Type: "bytes"},
		{Name: "extraData", Type: "bytes"},
		{Name: "gasLimit", Type: "uint256"},
	})
	require.NoError(t, err)

	type origin struct {
		SrcEid uint32
		Sender [32]byte
		Nonce  uint64
	}
	param := struct {
		Receiver  common.Address
		Origin    origin
		Guid      [32]byte
		Message   []byte
		ExtraData []byte
		GasLimit  *big.Int
	}{
		Receiver:  common.HexToAddress("0x0078C5a459132e279056B2371fE8A8eC973A9553"),
		Origin:    origin{SrcEid: 30111, Nonce: 7},
		Message:   message,
		ExtraData: []byte{},
		GasLimit:  big.NewInt(1_000_000),
	}
	packed, err := abi.Arguments{{Type: execTuple}}.Pack(param)
	require.NoError(t, err)
	return append([]byte{0xcf, 0xc3, 0x25, 0x70}, packed...)
}

// ---------------------------------------------------------------------------
// Engine contract.
// ---------------------------------------------------------------------------

func TestDebtManagerImplementsEngine(t *testing.T) {
	var _ Engine = (*DebtManager)(nil)
	require.Equal(t, "debt_manager", NewDebtManager(nil).Name())
}

// ---------------------------------------------------------------------------
// Borrow: +ceil(usd*1e18/idx), USDC stable-snap only.
// ---------------------------------------------------------------------------

func TestBorrowCeilRounding(t *testing.T) {
	dm := newDM(t, nil, nil)
	feedIndex(t, dm, 100, tUSDC, num("2000000000000000000")) // idx = 2e18

	// Non-exact division: 5*1e18/2e18 = 2.5 -> ceil = 3.
	evs, err := dm.Process(tLog(100, 0x01, 5), decode.DMBorrowed{User: tUser, Token: tUSDC, Amount: big.NewInt(5)})
	require.NoError(t, err)
	require.Len(t, evs, 1)
	ev := evs[0]
	require.Equal(t, "borrow", ev.EventType)
	require.Equal(t, "debt", ev.Side)
	require.Equal(t, "debt_manager", ev.Engine)
	require.Equal(t, uint64(10), ev.ChainID)
	require.Equal(t, uint64(100), ev.BlockNumber)
	require.Equal(t, uint16(0), ev.Seq)
	require.Equal(t, tUser.Bytes(), ev.Account)
	require.Equal(t, tUSDC.Bytes(), ev.Asset)
	require.Equal(t, 0, big.NewInt(3).Cmp(ev.Delta), "ceil(2.5) = 3, got %s", ev.Delta)
	require.Equal(t, "5", ev.Payload["usd"])
	require.Equal(t, "2000000000000000000", ev.Payload["index"])
	require.Equal(t, "stable_snap_1e6", ev.Payload["price_source"],
		"every borrow records its stable-snap pricing provenance (see borrowUsd invariant)")

	// Exact division: 4*1e18/2e18 = 2 exactly -> ceil must NOT bump.
	evs, err = dm.Process(tLog(100, 0x02, 7), decode.DMBorrowed{User: tUser, Token: tUSDC, Amount: big.NewInt(4)})
	require.NoError(t, err)
	require.Len(t, evs, 1)
	require.Equal(t, 0, big.NewInt(2).Cmp(evs[0].Delta), "exact division must not be bumped by ceil, got %s", evs[0].Delta)
}

// TestBorrowUSDTFoldsAsConfiguredStable: USDT is a configured 6-dec stable
// (isStableToken snaps to exactly 1e6 USD per whole token), so usd == amount
// and the borrow folds exactly like USDC.
func TestBorrowUSDTFoldsAsConfiguredStable(t *testing.T) {
	dm := newDM(t, nil, nil)
	feedIndex(t, dm, 100, tUSDT, num("2000000000000000000")) // idx = 2e18

	evs, err := dm.Process(tLog(100, 0x01, 5), decode.DMBorrowed{User: tUser, Token: tUSDT, Amount: big.NewInt(5)})
	require.NoError(t, err)
	require.Len(t, evs, 1)
	require.Equal(t, "borrow", evs[0].EventType)
	require.Equal(t, tUSDT.Bytes(), evs[0].Asset)
	require.Equal(t, 0, big.NewInt(3).Cmp(evs[0].Delta), "ceil(5*1e18/2e18) = 3")
	require.Equal(t, "5", evs[0].Payload["usd"], "6-dec stable: usd == amount")
	require.Equal(t, "stable_snap_1e6", evs[0].Payload["price_source"])

	// The fold lands on the running cache: repaying exactly it succeeds.
	evs, err = dm.Process(tLog(100, 0x02, 7), decode.DMRepaid{User: tUser, Payer: tPayer, Token: tUSDT, UsdAmount: big.NewInt(6)})
	require.NoError(t, err)
	require.Equal(t, 0, big.NewInt(-3).Cmp(evs[0].Delta))
}

// TestBorrowFrxUSD18DecFloorConversion: frxUSD is a configured 18-dec stable;
// usd = floor(amount/1e12) — the CONTRACT's own flooring division
// (DebtManagerCore.sol:378, reached from borrow() :468), so a non-divisible
// amount is a valid event whose sub-1e12 remainder the contract truncated —
// it must FOLD, never be refused.
func TestBorrowFrxUSD18DecFloorConversion(t *testing.T) {
	dm := newDM(t, nil, nil)
	feedIndex(t, dm, 100, tFrxUSD, num("1000000000000000000")) // idx = 1e18

	// 5 whole frxUSD = 5e18 token units -> exactly 5,000,000 USD 6-dec.
	evs, err := dm.Process(tLog(100, 0x01, 5), decode.DMBorrowed{User: tUser, Token: tFrxUSD, Amount: num("5000000000000000000")})
	require.NoError(t, err)
	require.Len(t, evs, 1)
	require.Equal(t, "5000000", evs[0].Payload["usd"], "18-dec stable: usd = amount/1e12, exact")
	require.Equal(t, "5000000000000000000", evs[0].Payload["token_amount"])
	require.Equal(t, "stable_snap_1e6", evs[0].Payload["price_source"], "stable-snap provenance recorded per borrow")
	require.Equal(t, 0, num("5000000").Cmp(evs[0].Delta), "ceil(5e6*1e18/1e18) = 5e6")

	// One wei over an integral USD amount: the contract floors the remainder
	// away — usd is still 5,000,000 and the fold SUCCEEDS, normalized via
	// ceil as usual (idx 1e18 -> delta 5,000,000).
	evs, err = dm.Process(tLog(100, 0x02, 7), decode.DMBorrowed{User: tUser, Token: tFrxUSD, Amount: num("5000000000000000001")})
	require.NoError(t, err, "non-divisible 18-dec amount is a VALID event (contract-floored), not an error")
	require.Len(t, evs, 1)
	require.Equal(t, "5000000", evs[0].Payload["usd"], "floor((5e18+1)/1e12) = 5,000,000 — remainder truncated by the contract's own division")
	require.Equal(t, "5000000000000000001", evs[0].Payload["token_amount"])
	require.Equal(t, 0, num("5000000").Cmp(evs[0].Delta))
}

// TestBorrowUnsupportedTokenIsTerminal: genuinely non-stable borrow tokens
// (liquidUSD, EURC, weEUR, liquidRESERVE x2) need emit-time oracle pricing —
// the deriver wraps ErrUnsupportedBorrowToken, the errors.Is-matchable
// TERMINAL capability error the planned runner will use to mark the engine unhealthy
// instead of retrying.
func TestBorrowUnsupportedTokenIsTerminal(t *testing.T) {
	for _, token := range []common.Address{tEURC, tLiquidUSD} {
		dm := newDM(t, nil, nil)
		// No index fed on purpose: the capability gate must fire first.
		evs, err := dm.Process(tLog(100, 0x01, 5), decode.DMBorrowed{User: tUser, Token: token, Amount: big.NewInt(5)})
		require.Error(t, err)
		require.ErrorIs(t, err, ErrUnsupportedBorrowToken)
		require.Contains(t, err.Error(), strings.ToLower(token.Hex()))
		require.Empty(t, evs)
	}
}

func TestBorrowMissingSameBlockIndexErrors(t *testing.T) {
	// No index at all.
	dm := newDM(t, nil, nil)
	_, err := dm.Process(tLog(100, 0x01, 5), decode.DMBorrowed{User: tUser, Token: tUSDC, Amount: big.NewInt(5)})
	require.Error(t, err)
	require.Contains(t, err.Error(), "InterestIndexUpdated")

	// Index exists but from an OLDER block: the one-index-update-per-mutating-
	// block invariant says the mutating block must carry its own update.
	dm = newDM(t, nil, nil)
	feedIndex(t, dm, 100, tUSDC, num("1000000000000000000"))
	_, err = dm.Process(tLog(101, 0x01, 5), decode.DMBorrowed{User: tUser, Token: tUSDC, Amount: big.NewInt(5)})
	require.Error(t, err)
	require.Contains(t, err.Error(), "InterestIndexUpdated")
	require.Contains(t, err.Error(), "101")
}

// ---------------------------------------------------------------------------
// Repay: -floor(usd*1e18/idx).
// ---------------------------------------------------------------------------

func TestRepayFloorRounding(t *testing.T) {
	dm := newDM(t, nil, nil)
	feedIndex(t, dm, 100, tUSDC, num("2000000000000000000"))
	_, err := dm.Process(tLog(100, 0x01, 5), decode.DMBorrowed{User: tUser, Token: tUSDC, Amount: big.NewInt(8)}) // +4
	require.NoError(t, err)

	// Non-exact: 5*1e18/2e18 = 2.5 -> floor = 2.
	evs, err := dm.Process(tLog(100, 0x02, 9), decode.DMRepaid{User: tUser, Payer: tPayer, Token: tUSDC, UsdAmount: big.NewInt(5)})
	require.NoError(t, err)
	require.Len(t, evs, 1)
	ev := evs[0]
	require.Equal(t, "repay", ev.EventType)
	require.Equal(t, "debt", ev.Side)
	require.Equal(t, tUser.Bytes(), ev.Account)
	require.Equal(t, tUSDC.Bytes(), ev.Asset)
	require.Equal(t, 0, big.NewInt(-2).Cmp(ev.Delta), "floor(2.5) = 2 removed, got %s", ev.Delta)
	require.Equal(t, "0x3333333333333333333333333333333333333333", ev.Payload["payer"])

	// Exact: 4*1e18/2e18 = 2 exactly.
	evs, err = dm.Process(tLog(100, 0x03, 11), decode.DMRepaid{User: tUser, Payer: tPayer, Token: tUSDC, UsdAmount: big.NewInt(4)})
	require.NoError(t, err)
	require.Equal(t, 0, big.NewInt(-2).Cmp(evs[0].Delta))
}

func TestRepayWithoutPriorDebtErrors(t *testing.T) {
	dm := newDM(t, nil, nil)
	feedIndex(t, dm, 100, tUSDC, num("1000000000000000000"))
	_, err := dm.Process(tLog(100, 0x01, 5), decode.DMRepaid{User: tUser, Payer: tPayer, Token: tUSDC, UsdAmount: big.NewInt(5)})
	require.Error(t, err)
	require.Contains(t, err.Error(), "negative")
	require.Contains(t, err.Error(), "missing genesis seed")
}

// ---------------------------------------------------------------------------
// Liquidation: debt decrement + per-tuple collateral records + residue rule.
// ---------------------------------------------------------------------------

func TestLiquidationFanOut(t *testing.T) {
	dm := newDM(t, nil, newFakeReader().seed(tUser, tUSDC, "debt", big.NewInt(100)))
	feedIndex(t, dm, 200, tUSDC, num("1000000000000000000"))

	evs, err := dm.Process(tLog(200, 0x01, 5), decode.DMLiquidated{
		Liquidator: tLiqor, User: tUser, DebtToken: tUSDC,
		Collateral: []decode.LiquidationTokenData{
			{Token: tWeETH, Amount: big.NewInt(7000), Bonus: big.NewInt(70)},
			{Token: tUSDC, Amount: big.NewInt(500), Bonus: big.NewInt(5)},
		},
		BeforeDebtUsd: big.NewInt(100), DebtLiquidatedUsd: big.NewInt(50),
	})
	require.NoError(t, err)
	require.Len(t, evs, 3, "1 debt event + 2 collateral records")

	debt := evs[0]
	require.Equal(t, "liquidation", debt.EventType)
	require.Equal(t, "debt", debt.Side)
	require.Equal(t, uint16(0), debt.Seq)
	require.Equal(t, tUser.Bytes(), debt.Account)
	require.Equal(t, tUSDC.Bytes(), debt.Asset)
	require.Equal(t, 0, big.NewInt(-50).Cmp(debt.Delta))
	require.Equal(t, "100", debt.Payload["before_debt_usd"])
	require.Equal(t, "50", debt.Payload["usd"])

	for i, wantTok := range []common.Address{tWeETH, tUSDC} {
		rec := evs[i+1]
		require.Equal(t, "liquidation_collateral", rec.EventType)
		require.Equal(t, uint16(i+1), rec.Seq)
		require.Equal(t, "", rec.Side, "collateral seize is RECORD-ONLY (collateral is snapshot-owned, recon caveat 4)")
		require.Nil(t, rec.Delta)
		require.Equal(t, tUser.Bytes(), rec.Account)
		require.Equal(t, wantTok.Bytes(), rec.Asset)
	}
	require.Equal(t, "7000", evs[1].Payload["amount"])
	require.Equal(t, "70", evs[1].Payload["bonus"])
}

func TestLiquidationResidueZeroedOnSecondPass(t *testing.T) {
	dm := newDM(t, nil, newFakeReader().seed(tUser, tUSDC, "debt", big.NewInt(100)))
	feedIndex(t, dm, 200, tUSDC, num("1000000000000000000"))

	mkLiq := func(usd int64, withCollateral bool) decode.DMLiquidated {
		var coll []decode.LiquidationTokenData
		if withCollateral {
			coll = []decode.LiquidationTokenData{{Token: tWeETH, Amount: big.NewInt(1), Bonus: big.NewInt(0)}}
		}
		return decode.DMLiquidated{
			Liquidator: tLiqor, User: tUser, DebtToken: tUSDC,
			Collateral: coll, BeforeDebtUsd: big.NewInt(0), DebtLiquidatedUsd: big.NewInt(usd),
		}
	}

	// First pass in tx 0x0a: -50, remaining 50. No residue.
	evs, err := dm.Process(tLog(200, 0x0a, 5), mkLiq(50, false))
	require.NoError(t, err)
	require.Len(t, evs, 1)

	// Second pass in the SAME tx: -49, remaining 1 -> residue_zeroed fires
	// (DebtManagerCore.sol:549-553 zeroes silently; the deriver models it).
	evs, err = dm.Process(tLog(200, 0x0a, 7), mkLiq(49, true))
	require.NoError(t, err)
	require.Len(t, evs, 3, "debt event + 1 collateral record + residue_zeroed")
	require.Equal(t, "liquidation", evs[0].EventType)
	require.Equal(t, 0, big.NewInt(-49).Cmp(evs[0].Delta))
	require.Equal(t, "liquidation_collateral", evs[1].EventType)
	res := evs[2]
	require.Equal(t, "residue_zeroed", res.EventType)
	require.Equal(t, uint16(2), res.Seq, "residue event follows the collateral records")
	require.Equal(t, "debt", res.Side)
	require.Equal(t, tUser.Bytes(), res.Account)
	require.Equal(t, tUSDC.Bytes(), res.Asset)
	require.Equal(t, 0, big.NewInt(-1).Cmp(res.Delta))

	// Cache is now zero: any further repay errors.
	_, err = dm.Process(tLog(200, 0x0b, 9), decode.DMRepaid{User: tUser, Payer: tPayer, Token: tUSDC, UsdAmount: big.NewInt(1)})
	require.Error(t, err)
}

func TestLiquidationNoResidueAcrossTxBoundary(t *testing.T) {
	dm := newDM(t, nil, newFakeReader().seed(tUser, tUSDC, "debt", big.NewInt(100)))
	feedIndex(t, dm, 200, tUSDC, num("1000000000000000000"))

	liq := func(usd int64) decode.DMLiquidated {
		return decode.DMLiquidated{Liquidator: tLiqor, User: tUser, DebtToken: tUSDC,
			BeforeDebtUsd: big.NewInt(0), DebtLiquidatedUsd: big.NewInt(usd)}
	}

	// -50 in tx 0x0a, then -49 in a DIFFERENT tx 0x0b: remaining 1 wei but the
	// contract's zeroing only runs within one liquidate() call's passes.
	_, err := dm.Process(tLog(200, 0x0a, 5), liq(50))
	require.NoError(t, err)
	evs, err := dm.Process(tLog(200, 0x0b, 7), liq(49))
	require.NoError(t, err)
	require.Len(t, evs, 1, "no residue_zeroed across tx boundary")

	// The 1-wei residue is still there: repaying exactly it succeeds.
	evs, err = dm.Process(tLog(200, 0x0c, 9), decode.DMRepaid{User: tUser, Payer: tPayer, Token: tUSDC, UsdAmount: big.NewInt(1)})
	require.NoError(t, err)
	require.Equal(t, 0, big.NewInt(-1).Cmp(evs[0].Delta))
}

func TestLiquidationNoResidueWhenSecondPassLeavesZeroOrMore(t *testing.T) {
	for _, tc := range []struct {
		name       string
		second     int64
		wantEvents int
	}{
		{"second pass leaves exactly zero", 50, 1},
		{"second pass leaves 2 wei", 48, 1},
	} {
		t.Run(tc.name, func(t *testing.T) {
			dm := newDM(t, nil, newFakeReader().seed(tUser, tUSDC, "debt", big.NewInt(100)))
			feedIndex(t, dm, 200, tUSDC, num("1000000000000000000"))
			liq := func(usd int64) decode.DMLiquidated {
				return decode.DMLiquidated{Liquidator: tLiqor, User: tUser, DebtToken: tUSDC,
					BeforeDebtUsd: big.NewInt(0), DebtLiquidatedUsd: big.NewInt(usd)}
			}
			_, err := dm.Process(tLog(200, 0x0a, 5), liq(50))
			require.NoError(t, err)
			evs, err := dm.Process(tLog(200, 0x0a, 7), liq(tc.second))
			require.NoError(t, err)
			require.Len(t, evs, tc.wantEvents, "no residue_zeroed unless 0 < remaining <= 1 wei")
		})
	}
}

func TestLiquidationOverdrawErrors(t *testing.T) {
	dm := newDM(t, nil, nil)
	feedIndex(t, dm, 200, tUSDC, num("1000000000000000000"))
	_, err := dm.Process(tLog(200, 0x01, 5), decode.DMLiquidated{
		Liquidator: tLiqor, User: tUser, DebtToken: tUSDC,
		BeforeDebtUsd: big.NewInt(50), DebtLiquidatedUsd: big.NewInt(50),
	})
	require.Error(t, err)
	require.Contains(t, err.Error(), "negative")
}

// ---------------------------------------------------------------------------
// Migration genesis.
// ---------------------------------------------------------------------------

func TestMigrationGenesisSeedsInCalldataOrder(t *testing.T) {
	borrowers := []common.Address{tUser, tUser2, tPayer}
	amounts := []*big.Int{big.NewInt(7), big.NewInt(8), big.NewInt(9)}
	l := tLog(300, 0x0c, 5)
	chain := &fakeChainReads{calldata: map[common.Hash][]byte{
		common.BytesToHash(l.TxHash): buildExecute302Calldata(t, borrowers, amounts),
	}}
	dm := newDM(t, chain, nil)

	evs, err := dm.Process(l, decode.DMMigrationBorrowerPositionsSet{Token: tUSDC, Count: big.NewInt(3)})
	require.NoError(t, err)
	require.Equal(t, 1, chain.calls)
	require.Len(t, evs, 3)
	for i := range borrowers {
		ev := evs[i]
		require.Equal(t, "migration_genesis", ev.EventType)
		require.Equal(t, uint16(i), ev.Seq, "seq must follow calldata order")
		require.Equal(t, "debt", ev.Side)
		require.Equal(t, borrowers[i].Bytes(), ev.Account)
		require.Equal(t, tUSDC.Bytes(), ev.Asset)
		require.Equal(t, 0, amounts[i].Cmp(ev.Delta), "delta is the ALREADY-NORMALIZED seed, no index division")
	}

	// Seeds must warm the running cache: repaying against a seeded position works.
	feedIndex(t, dm, 301, tUSDC, num("1000000000000000000"))
	rEvs, err := dm.Process(tLog(301, 0x0d, 3), decode.DMRepaid{User: tUser, Payer: tPayer, Token: tUSDC, UsdAmount: big.NewInt(7)})
	require.NoError(t, err)
	require.Equal(t, 0, big.NewInt(-7).Cmp(rEvs[0].Delta))
}

func TestMigrationCountMismatchErrors(t *testing.T) {
	l := tLog(300, 0x0c, 5)
	chain := &fakeChainReads{calldata: map[common.Hash][]byte{
		common.BytesToHash(l.TxHash): buildExecute302Calldata(t,
			[]common.Address{tUser, tUser2}, []*big.Int{big.NewInt(7), big.NewInt(8)}),
	}}
	dm := newDM(t, chain, nil)

	evs, err := dm.Process(l, decode.DMMigrationBorrowerPositionsSet{Token: tUSDC, Count: big.NewInt(3)})
	require.Error(t, err)
	require.Contains(t, err.Error(), "count mismatch")
	require.Empty(t, evs, "count mismatch must never yield partial genesis")
}

func TestMigrationChainReadFailurePropagates(t *testing.T) {
	chain := &fakeChainReads{err: errors.New("rpc down")}
	dm := newDM(t, chain, nil)
	_, err := dm.Process(tLog(300, 0x0c, 5), decode.DMMigrationBorrowerPositionsSet{Token: tUSDC, Count: big.NewInt(1)})
	require.Error(t, err)
	require.Contains(t, err.Error(), "rpc down")
}

func TestMigrationWithoutChainReadsErrors(t *testing.T) {
	dm := newDM(t, nil, nil)
	_, err := dm.Process(tLog(300, 0x0c, 5), decode.DMMigrationBorrowerPositionsSet{Token: tUSDC, Count: big.NewInt(1)})
	require.Error(t, err)
	require.Contains(t, err.Error(), "DMChainReads")
}

// ---------------------------------------------------------------------------
// Record-only events.
// ---------------------------------------------------------------------------

func TestRecordOnlyEvents(t *testing.T) {
	cases := []struct {
		name        string
		ev          decode.Event
		wantType    string
		wantAccount []byte
		wantAsset   []byte
	}{
		{"supplied", decode.DMSupplied{Sender: tPayer, User: tUser, Token: tUSDC, Amount: big.NewInt(5)},
			"supplied", tUser.Bytes(), tUSDC.Bytes()},
		{"withdraw", decode.DMWithdrawBorrowToken{Withdrawer: tUser, BorrowToken: tUSDC, Amount: big.NewInt(5)},
			"withdraw_borrow_token", tUser.Bytes(), tUSDC.Bytes()},
		{"borrow apy", decode.DMBorrowApySet{Token: tUSDC, OldApy: big.NewInt(1), NewApy: big.NewInt(2)},
			"borrow_apy_set", []byte{}, tUSDC.Bytes()},
		{"borrow token config", decode.DMBorrowTokenConfigSet{Token: tUSDC, Config: decode.BorrowTokenConfig{
			InterestIndexSnapshot:          big.NewInt(1),
			TotalNormalizedBorrowingAmount: big.NewInt(2),
			TotalSharesOfBorrowTokens:      big.NewInt(3),
			LastUpdateTimestamp:            4,
			BorrowApy:                      5,
			MinShares:                      big.NewInt(6),
		}}, "borrow_token_config_set", []byte{}, tUSDC.Bytes()},
		{"collateral added", decode.DMCollateralTokenAdded{Token: tWeETH},
			"collateral_token_added", []byte{}, tWeETH.Bytes()},
		{"collateral removed", decode.DMCollateralTokenRemoved{Token: tWeETH},
			"collateral_token_removed", []byte{}, tWeETH.Bytes()},
		{"collateral config", decode.DMCollateralTokenConfigSet{CollateralToken: tWeETH,
			OldConfig: decode.CollateralTokenConfig{LTV: big.NewInt(1), LiquidationThreshold: big.NewInt(2), LiquidationBonus: big.NewInt(3)},
			NewConfig: decode.CollateralTokenConfig{LTV: big.NewInt(4), LiquidationThreshold: big.NewInt(5), LiquidationBonus: big.NewInt(6)},
		}, "collateral_token_config_set", []byte{}, tWeETH.Bytes()},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			dm := newDM(t, nil, nil)
			evs, err := dm.Process(tLog(400, 0x01, 5), tc.ev)
			require.NoError(t, err)
			require.Len(t, evs, 1)
			ev := evs[0]
			require.Equal(t, tc.wantType, ev.EventType)
			require.Equal(t, "", ev.Side, "record-only: no balance movement")
			require.Nil(t, ev.Delta)
			require.Equal(t, tc.wantAccount, ev.Account)
			require.NotNil(t, ev.Account, "account must be non-nil ([]byte{}) -- position_events.account is NOT NULL")
			require.Equal(t, tc.wantAsset, ev.Asset)
			require.Equal(t, uint16(0), ev.Seq)
		})
	}
}

func TestUnsupportedEventTypeErrors(t *testing.T) {
	dm := newDM(t, nil, nil)
	_, err := dm.Process(tLog(400, 0x01, 5), decode.AaveBorrow{})
	require.Error(t, err)
	require.Contains(t, err.Error(), "unsupported")
}

// ---------------------------------------------------------------------------
// Determinism: same log stream + same committed state => identical events.
// ---------------------------------------------------------------------------

func TestProcessIsDeterministic(t *testing.T) {
	run := func() []store.PositionEvent {
		dm := newDM(t, nil, newFakeReader().seed(tUser2, tUSDC, "debt", big.NewInt(40)))
		var all []store.PositionEvent
		feedIndex(t, dm, 100, tUSDC, num("1030000000000000000"))
		for i, step := range []struct {
			l store.RawLog
			d decode.Event
		}{
			{tLog(100, 0x01, 2), decode.DMBorrowed{User: tUser, Token: tUSDC, Amount: big.NewInt(1234567)}},
			{tLog(100, 0x02, 4), decode.DMRepaid{User: tUser, Payer: tUser, Token: tUSDC, UsdAmount: big.NewInt(234567)}},
			{tLog(100, 0x03, 6), decode.DMLiquidated{Liquidator: tLiqor, User: tUser2, DebtToken: tUSDC,
				Collateral:    []decode.LiquidationTokenData{{Token: tWeETH, Amount: big.NewInt(9), Bonus: big.NewInt(1)}},
				BeforeDebtUsd: big.NewInt(41), DebtLiquidatedUsd: big.NewInt(20)}},
		} {
			evs, err := dm.Process(step.l, step.d)
			require.NoError(t, err, "step %d", i)
			all = append(all, evs...)
		}
		return all
	}
	require.Equal(t, run(), run())
}

// ---------------------------------------------------------------------------
// Golden tests: recon "Debt identity validation" replayed bit-exactly through
// the deriver from committed real-log fixtures (see testdata provenance).
// ---------------------------------------------------------------------------

type dmGoldenLog struct {
	BlockNumber uint64   `json:"blockNumber"`
	BlockHash   string   `json:"blockHash"`
	TxHash      string   `json:"txHash"`
	LogIndex    uint32   `json:"logIndex"`
	Address     string   `json:"address"`
	Topics      []string `json:"topics"`
	Data        string   `json:"data"`
}

func (f dmGoldenLog) rawLog() store.RawLog {
	topics := make([][]byte, len(f.Topics))
	for i, tp := range f.Topics {
		topics[i] = common.FromHex(tp)
	}
	return store.RawLog{
		ChainID:     10,
		BlockNumber: f.BlockNumber,
		BlockHash:   common.FromHex(f.BlockHash),
		TxHash:      common.FromHex(f.TxHash),
		LogIndex:    f.LogIndex,
		Address:     common.FromHex(f.Address),
		Topics:      topics,
		Data:        common.FromHex(f.Data),
	}
}

type dmGoldenFile struct {
	Provenance        string            `json:"provenance"`
	ChainID           uint64            `json:"chainId"`
	Borrower          string            `json:"borrower"`
	MigrationCalldata map[string]string `json:"migrationCalldata"`
	Logs              []dmGoldenLog     `json:"logs"`
}

func loadGolden(t *testing.T, name string) dmGoldenFile {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join("testdata", name))
	require.NoError(t, err)
	var fx dmGoldenFile
	require.NoError(t, json.Unmarshal(raw, &fx))
	require.NotEmpty(t, fx.Logs)
	return fx
}

// replayGolden decodes every fixture log through the real decode.Registry and
// folds it through one batch-started DebtManager (empty committed state --
// these fixtures are complete from genesis), returning all emitted position
// events -- the full bytes -> decode -> derive path, exactly what the runner
// will do.
func replayGolden(t *testing.T, fx dmGoldenFile) []store.PositionEvent {
	t.Helper()
	var chain DMChainReads
	if len(fx.MigrationCalldata) > 0 {
		m := map[common.Hash][]byte{}
		for txh, data := range fx.MigrationCalldata {
			m[common.HexToHash(txh)] = common.FromHex(data)
		}
		chain = &fakeChainReads{calldata: m}
	}
	dm := newDM(t, chain, nil)
	reg := decode.NewRegistry()
	var all []store.PositionEvent
	for i, fl := range fx.Logs {
		raw := fl.rawLog()
		ev, ok, err := reg.Decode("debt_manager", raw)
		require.NoError(t, err, "fixture log %d (block %d)", i, fl.BlockNumber)
		require.True(t, ok, "fixture log %d (block %d): topic0 not in debt_manager allowlist", i, fl.BlockNumber)
		evs, err := dm.Process(raw, ev)
		require.NoError(t, err, "fixture log %d (block %d, tx %s)", i, fl.BlockNumber, fl.TxHash)
		all = append(all, evs...)
	}
	return all
}

// netNormalized sums the debt-side deltas for one account -- the exact fold
// store.ApplyDerived performs into position_balances.
func netNormalized(events []store.PositionEvent, account common.Address) *big.Int {
	net := new(big.Int)
	for _, ev := range events {
		if ev.Side == "debt" && ev.Delta != nil && bytes.Equal(ev.Account, account.Bytes()) {
			net.Add(net, ev.Delta)
		}
	}
	return net
}

func countType(events []store.PositionEvent, account common.Address, eventType string) int {
	n := 0
	for _, ev := range events {
		if ev.EventType == eventType && bytes.Equal(ev.Account, account.Bytes()) {
			n++
		}
	}
	return n
}

// pinCurrentIndex is getCurrentIndex(USDC) at recon's PIN block 154,021,227
// (recon "Debt identity validation").
var pinCurrentIndex = num("1042402553573226850")

func TestGoldenBorrowersBitExact(t *testing.T) {
	cases := []struct {
		fixture        string
		borrower       common.Address
		borrows        int
		repays         int
		wantNormalized string
		wantAtPin      string
	}{
		{"dm_golden_borrower_0303a641.json", common.HexToAddress("0x0303a641b9255a4240e879c76efc704dc1c6383d"), 43, 12, "963813", "1004681"},
		{"dm_golden_borrower_0b7043c8.json", common.HexToAddress("0x0b7043c82c5ad152137ad7d503daa02f5e777f85"), 38, 7, "3985789485", "4154797137"},
		{"dm_golden_borrower_05e3a665.json", common.HexToAddress("0x05e3a665efc843d77e3867ee6db41bc38d1ed33f"), 41, 13, "7153773", "7457111"},
	}
	for _, tc := range cases {
		t.Run(tc.fixture, func(t *testing.T) {
			fx := loadGolden(t, tc.fixture)
			require.Equal(t, tc.borrower.Hex(), common.HexToAddress(fx.Borrower).Hex())
			events := replayGolden(t, fx)

			// Fixture completeness: exactly the recon-tabulated event counts.
			require.Equal(t, tc.borrows, countType(events, tc.borrower, "borrow"), "Borrowed event count")
			require.Equal(t, tc.repays, countType(events, tc.borrower, "repay"), "Repaid event count")

			net := netNormalized(events, tc.borrower)
			require.Equal(t, tc.wantNormalized, net.String(), "net normalized (recon table)")

			atPin := new(big.Int).Quo(new(big.Int).Mul(net, pinCurrentIndex), big.NewInt(1_000_000_000_000_000_000))
			require.Equal(t, tc.wantAtPin, atPin.String(), "floor(net*currentIndex/1e18) must equal borrowingOf @ PIN")
		})
	}
}

func TestGoldenLiquidationVector(t *testing.T) {
	safe := common.HexToAddress("0xac5f3ce95f602e31b672cc38cddf7a3ea9ae5fcc")
	liqIdx := num("1036365345262130760")
	fx := loadGolden(t, "dm_golden_liq_ac5f3ce9.json")
	events := replayGolden(t, fx)

	// Genesis: the Safe's debt exists ONLY via migration (recon "Migration
	// finding": zero Borrowed events) -- its seed is 30,578,521 normalized.
	require.Equal(t, 0, countType(events, safe, "borrow"), "migrated Safe must have zero Borrowed events")
	require.Equal(t, 1, countType(events, safe, "migration_genesis"))
	for _, ev := range events {
		if ev.EventType == "migration_genesis" && bytes.Equal(ev.Account, safe.Bytes()) {
			require.Equal(t, "30578521", ev.Delta.String(), "migration seed (already normalized, no index division)")
		}
	}

	// The Liquidated at block 151,731,530 (idx 1036365345262130760) removes
	// EXACTLY 15,289,260 normalized = floor(15,845,260 * 1e18 / idx).
	//
	// RECON ERRATUM (documented in task-5-report-p2.md): recon's prose says
	// "removed 15,289,230" -- a digit typo. 15,289,260 is the only value
	// consistent with (a) exact integer arithmetic on the real event bytes,
	// (b) recon's own beforeDebtAmount 31,690,519 = floor(seed 30,578,521 x
	// idx / 1e18), and (c) recon's own view-after 15,845,260 = floor((seed -
	// 15,289,260) x idx / 1e18); the claimed 15,289,230 would yield a view of
	// 15,845,291, contradicting the recon vector itself.
	var liqDeltas []*big.Int
	for _, ev := range events {
		if ev.EventType == "liquidation" && ev.BlockNumber == 151_731_530 && bytes.Equal(ev.Account, safe.Bytes()) {
			liqDeltas = append(liqDeltas, ev.Delta)
			require.Equal(t, "1036365345262130760", ev.Payload["index"])
			require.Equal(t, "15845260", ev.Payload["usd"])
			require.Equal(t, "31690519", ev.Payload["before_debt_usd"],
				"event beforeDebtAmount must equal floor(seed*idx/1e18) -- genesis seed validated against the contract's own view")
		}
	}
	require.Len(t, liqDeltas, 1, "exactly one Liquidated at the golden block")
	require.Equal(t, "-15289260", liqDeltas[0].String(), "removed normalized")

	// After the liquidation, the replayed position values to EXACTLY the
	// contract view: floor(net * idx / 1e18) = 15,845,260 (the naive
	// USD-subtraction answer would be 15,845,259 -- recon's ±1-wei class).
	net := netNormalized(events, safe)
	view := new(big.Int).Quo(new(big.Int).Mul(net, liqIdx), big.NewInt(1_000_000_000_000_000_000))
	require.Equal(t, "15845260", view.String(), "borrowingOf at the liquidation block")
}
