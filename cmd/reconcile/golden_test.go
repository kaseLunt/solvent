// Golden-row tests (brief §4 / §10). The fake chain here is fixture-real:
// it can serve, lie, refuse on capability, and reject pinned state — and it
// RECORDS every read, which is what makes mutation target 11 killable:
// TestGoldenRowAIsALiveChainReadAtTheW1Pin asserts a live pinned read
// actually happened at 25,584,990 and that Row A's chain leg came from that
// read, so a mutant that substitutes the fixture constants for the live
// read fails on BOTH counts.
package main

import (
	"context"
	"encoding/binary"
	"fmt"
	"math/big"
	"testing"
	"time"

	"github.com/ethereum/go-ethereum/common"
	"github.com/stretchr/testify/require"

	"github.com/kaselunt/solvent/internal/chain"
)

type fakeCall struct {
	kind  string // headerHash | headerTime | call
	block uint64
	to    common.Address
	data  []byte
	hash  common.Hash
}

type fakeChain struct {
	hashes    map[uint64]common.Hash
	times     map[uint64]uint64
	handler   func(to common.Address, data []byte, hash common.Hash) ([]byte, error)
	endpoints int
	calls     []fakeCall
}

func (f *fakeChain) HeaderHashFrom(_ context.Context, _ int, n uint64) (common.Hash, chain.EndpointToken, error) {
	f.calls = append(f.calls, fakeCall{kind: "headerHash", block: n})
	h, ok := f.hashes[n]
	if !ok {
		return common.Hash{}, chain.EndpointToken{Index: -1}, &chain.PinnedCallError{Op: "headerHash", Attempts: []chain.AttemptError{
			{Endpoint: 0, Err: fmt.Errorf("header for block %d not found", n)},
		}}
	}
	return h, chain.EndpointToken{Index: 0}, nil
}

func (f *fakeChain) HeaderTimeFrom(_ context.Context, _ int, n uint64) (uint64, chain.EndpointToken, error) {
	f.calls = append(f.calls, fakeCall{kind: "headerTime", block: n})
	return f.times[n], chain.EndpointToken{Index: 0}, nil
}

func (f *fakeChain) CallAtHashFrom(_ context.Context, start int, to common.Address, data []byte, blockHash common.Hash) ([]byte, chain.EndpointToken, error) {
	f.calls = append(f.calls, fakeCall{kind: "call", to: to, data: append([]byte{}, data...), hash: blockHash})
	ret, err := f.handler(to, data, blockHash)
	if err != nil {
		return nil, chain.EndpointToken{Index: -1}, &chain.PinnedCallError{Op: "callAtHash", Attempts: []chain.AttemptError{
			{Endpoint: start % f.EndpointCount(), Err: err},
		}}
	}
	return ret, chain.EndpointToken{Index: start % f.EndpointCount()}, nil
}

func (f *fakeChain) EndpointCount() int {
	if f.endpoints == 0 {
		return 2
	}
	return f.endpoints
}

func testReader(f *fakeChain) *pinnedReader {
	r := newRPCRunner(100000, 2, &rpcCallLog{})
	noSleep := func(context.Context, time.Duration) error { return nil }
	r.sleep = noSleep
	r.limiter.sleep = noSleep
	return &pinnedReader{name: "eth", c: f, run: r}
}

func hashFor(pin uint64) common.Hash {
	var h common.Hash
	binary.BigEndian.PutUint64(h[24:], pin)
	h[0] = 0x77
	return h
}

func packUint(t *testing.T, v *big.Int) []byte {
	t.Helper()
	ret, err := aaveScaledBalanceOfABI.Methods["scaledBalanceOf"].Outputs.Pack(v)
	require.NoError(t, err)
	return ret
}

// goldenFakeEnv wires a fake chain that serves DISTINCT live values at the
// W1 pin and the exact fixture constants at the fixture pin.
func goldenFakeEnv(t *testing.T, vec goldenVectors) (*fakeChain, common.Address, map[string]common.Address, map[string]*big.Int) {
	t.Helper()
	pool := common.HexToAddress("0x0AA97c284e98396202b6A04024F5E2c65026F3c0")
	aWeETH := common.HexToAddress("0xbe1F842e7e0afd2c2322aae5d34bA899544b29db")
	vTokens := map[common.Address]common.Address{
		common.HexToAddress(vec.Borrowers[0].DebtReserve): common.HexToAddress("0x9355032d0e5c8Dc8bBcbB55f1b1e18DD6E971b8C"),
		common.HexToAddress(vec.Borrowers[1].DebtReserve): common.HexToAddress("0xD2cf07dE00000000000000000000000000000001"),
	}
	atokens := map[string]common.Address{
		hexLower(vec.Borrowers[0].CollateralReserve): aWeETH,
	}
	// Live values at the W1 pin — deliberately DIFFERENT from the fixture
	// constants, so a fixture-substituting mutant is distinguishable.
	w1Live := map[string]*big.Int{
		hexLower(vec.Borrowers[0].Address) + "/debt":       big.NewInt(999),
		hexLower(vec.Borrowers[0].Address) + "/collateral": big.NewInt(888),
		hexLower(vec.Borrowers[1].Address) + "/debt":       big.NewInt(777),
		hexLower(vec.Borrowers[1].Address) + "/collateral": big.NewInt(666),
	}
	fixtureByKey := map[string]*big.Int{
		hexLower(vec.Borrowers[0].Address) + "/debt":       bi(vec.Borrowers[0].FixtureScaledDebt),
		hexLower(vec.Borrowers[0].Address) + "/collateral": bi(vec.Borrowers[0].FixtureScaledCollateral),
		hexLower(vec.Borrowers[1].Address) + "/debt":       bi(vec.Borrowers[1].FixtureScaledDebt),
		hexLower(vec.Borrowers[1].Address) + "/collateral": bi(vec.Borrowers[1].FixtureScaledCollateral),
	}
	f := &fakeChain{
		hashes: map[uint64]common.Hash{
			vec.W1PinETH:      hashFor(vec.W1PinETH),
			vec.FixturePinETH: hashFor(vec.FixturePinETH),
		},
		times: map[uint64]uint64{},
	}
	f.handler = func(to common.Address, data []byte, hash common.Hash) ([]byte, error) {
		sel := common.Bytes2Hex(data[:4])
		switch sel {
		case "365090a0": // getReserveVariableDebtToken(reserve)
			reserve := common.BytesToAddress(data[4+12 : 4+32])
			ret, err := poolReserveDebtTokenABI.Methods["getReserveVariableDebtToken"].Outputs.Pack(vTokens[reserve])
			require.NoError(t, err)
			return ret, nil
		case "1da24f3e": // scaledBalanceOf(user)
			user := common.BytesToAddress(data[4+12 : 4+32])
			side := "debt"
			if to == aWeETH {
				side = "collateral"
			}
			key := hexLower(user.Hex()) + "/" + side
			if hash == f.hashes[vec.W1PinETH] {
				return packUint(t, w1Live[key]), nil
			}
			return packUint(t, fixtureByKey[key]), nil
		}
		return nil, fmt.Errorf("unexpected selector %s", sel)
	}
	return f, pool, atokens, w1Live
}

// dbSideMatching builds a goldenDBSide whose W1 sums equal the fake's live
// values and whose fixture sums equal the fixture constants.
func dbSideMatching(vec goldenVectors, w1Live map[string]*big.Int) goldenDBSide {
	db := goldenDBSide{
		AsOfW1:      map[string]map[string]map[string]*big.Int{},
		AsOfFixture: map[string]map[string]map[string]*big.Int{},
	}
	put := func(m map[string]map[string]map[string]*big.Int, acct, res, side string, v *big.Int) {
		if m[acct] == nil {
			m[acct] = map[string]map[string]*big.Int{}
		}
		if m[acct][res] == nil {
			m[acct][res] = map[string]*big.Int{}
		}
		m[acct][res][side] = v
	}
	for _, b := range vec.Borrowers {
		acct := hexLower(b.Address)
		put(db.AsOfW1, acct, hexLower(b.DebtReserve), "debt", w1Live[acct+"/debt"])
		put(db.AsOfW1, acct, hexLower(b.CollateralReserve), "collateral", w1Live[acct+"/collateral"])
		put(db.AsOfFixture, acct, hexLower(b.DebtReserve), "debt", bi(b.FixtureScaledDebt))
		put(db.AsOfFixture, acct, hexLower(b.CollateralReserve), "collateral", bi(b.FixtureScaledCollateral))
	}
	return db
}

func TestLoadGoldenVectorsPinsAreFixed(t *testing.T) {
	vec, err := loadGoldenVectors()
	require.NoError(t, err)
	require.EqualValues(t, 25584990, vec.W1PinETH, "the literal W1 clause block")
	require.EqualValues(t, 25593800, vec.FixturePinETH, "the Task 6 fixture capture block")
	require.Len(t, vec.Borrowers, 2)
	require.Equal(t, "0x70daaac436465a0d03e45916fa68ddee6086e5fe", vec.Borrowers[0].Address)
	require.Equal(t, "125415", vec.Borrowers[0].FixtureScaledDebt)
	require.Equal(t, "58420665095130", vec.Borrowers[0].FixtureScaledCollateral)
	require.Equal(t, "0xe649a394fb16b58ee2e59feb2ea571e7733c812a", vec.Borrowers[1].Address)
	require.Equal(t, "83", vec.Borrowers[1].FixtureScaledDebt)
	require.Equal(t, "7045575913579", vec.Borrowers[1].FixtureScaledCollateral)
}

// TestGoldenRowAIsALiveChainReadAtTheW1Pin — mutation target 11's kill.
func TestGoldenRowAIsALiveChainReadAtTheW1Pin(t *testing.T) {
	vec, err := loadGoldenVectors()
	require.NoError(t, err)
	f, pool, atokens, w1Live := goldenFakeEnv(t, vec)
	db := dbSideMatching(vec, w1Live)
	db.IntervalCount = 0

	rows, err := runGoldenChainSide(context.Background(), testReader(f), vec, db, pool, atokens)
	require.NoError(t, err)

	// (1) A header read at EXACTLY 25,584,990 happened this run.
	headerAtW1 := false
	for _, c := range f.calls {
		if c.kind == "headerHash" && c.block == vec.W1PinETH {
			headerAtW1 = true
		}
	}
	require.True(t, headerAtW1, "Row A requires a LIVE header read at the W1 pin — no fixture substitute")

	// (2) scaledBalanceOf reads pinned BY THE W1 PIN'S HASH happened.
	pinnedReads := 0
	for _, c := range f.calls {
		if c.kind == "call" && c.hash == hashFor(vec.W1PinETH) && common.Bytes2Hex(c.data[:4]) == "1da24f3e" {
			pinnedReads++
		}
	}
	require.Equal(t, 4, pinnedReads, "2 borrowers × debt+collateral, all pinned at HeaderHashFrom(25,584,990)")

	// (3) Row A's chain legs are the LIVE values the fake served — not the
	// fixture constants (they differ by construction).
	rowACount := 0
	for _, g := range rows {
		if g.Row != "A" {
			continue
		}
		rowACount++
		require.EqualValues(t, vec.W1PinETH, g.Pin)
		key := hexLower(g.Borrower) + "/" + g.Side
		require.Equal(t, w1Live[key].String(), g.Chain,
			"Row A's chain leg must be the live pinned read, never a fixture constant")
		require.Equal(t, verdictExact, g.Verdict)
		require.Empty(t, g.Fixture, "Row A carries NO fixture constant — constants never cross pins")
	}
	require.Equal(t, 4, rowACount)

	// Row B welds all three legs at the fixtures' own pin.
	for _, g := range rows {
		if g.Row == "B" {
			require.Equal(t, verdictExact, g.Verdict)
			require.Equal(t, verdictExact, g.Legs["db_vs_chain"])
			require.Equal(t, verdictExact, g.Legs["chain_vs_fixture"])
			require.Equal(t, verdictExact, g.Legs["db_vs_fixture"])
		}
	}
	// Row C: quiescence documented and gated.
	var rowC *goldenRow
	for i := range rows {
		if rows[i].Row == "C" {
			rowC = &rows[i]
		}
	}
	require.NotNil(t, rowC)
	require.Equal(t, verdictExact, rowC.Verdict)
}

// TestGoldenRowAFailsWhenDBDisagreesWithTheLiveRead: the disproof clause
// arm — Row A is grounded in the live read, so a DB that disagrees with the
// chain FAILS even when it matches the fixture constants perfectly.
func TestGoldenRowAFailsWhenDBDisagreesWithTheLiveRead(t *testing.T) {
	vec, err := loadGoldenVectors()
	require.NoError(t, err)
	f, pool, atokens, _ := goldenFakeEnv(t, vec)
	// DB carries the FIXTURE constants at the W1 pin — the classic
	// constants-ported-across-pins mistake (L0-2). Row A must fail.
	wrongLive := map[string]*big.Int{}
	for _, b := range vec.Borrowers {
		acct := hexLower(b.Address)
		wrongLive[acct+"/debt"] = bi(b.FixtureScaledDebt)
		wrongLive[acct+"/collateral"] = bi(b.FixtureScaledCollateral)
	}
	db := dbSideMatching(vec, wrongLive)
	rows, err := runGoldenChainSide(context.Background(), testReader(f), vec, db, pool, atokens)
	require.NoError(t, err)
	drifted := 0
	for _, g := range rows {
		if g.Row == "A" && g.Verdict == verdictDrift {
			drifted++
		}
	}
	require.Equal(t, 4, drifted, "fixture constants at the W1 pin are NOT the chain state there — Row A must refuse")
}

// TestGoldenRowBLocalizesTheLyingLeg: a chain answer that disagrees with
// the committed constant while the DB matches the constant shows up as
// chain_vs_fixture + db_vs_chain drift with db_vs_fixture exact — the
// three-way weld localizes the broken leg (lying endpoint or stale
// provenance, not the deriver).
func TestGoldenRowBLocalizesTheLyingLeg(t *testing.T) {
	vec, err := loadGoldenVectors()
	require.NoError(t, err)
	f, pool, atokens, w1Live := goldenFakeEnv(t, vec)
	base := f.handler
	f.handler = func(to common.Address, data []byte, hash common.Hash) ([]byte, error) {
		if hash == hashFor(vec.FixturePinETH) && common.Bytes2Hex(data[:4]) == "1da24f3e" {
			return packUint(t, big.NewInt(31337)), nil // the lie
		}
		return base(to, data, hash)
	}
	db := dbSideMatching(vec, w1Live)
	rows, err := runGoldenChainSide(context.Background(), testReader(f), vec, db, pool, atokens)
	require.NoError(t, err)
	for _, g := range rows {
		if g.Row != "B" {
			continue
		}
		require.Equal(t, verdictDrift, g.Verdict)
		require.Equal(t, verdictDrift, g.Legs["chain_vs_fixture"])
		require.Equal(t, verdictDrift, g.Legs["db_vs_chain"])
		require.Equal(t, verdictExact, g.Legs["db_vs_fixture"], "the DB matches the committed constant — the broken leg is the endpoint")
	}
}

// TestGoldenRowCCountsIntervalEvents: nonzero interval events break the
// quiescence explanation and the row fails (gated documentation).
func TestGoldenRowCCountsIntervalEvents(t *testing.T) {
	vec, err := loadGoldenVectors()
	require.NoError(t, err)
	f, pool, atokens, w1Live := goldenFakeEnv(t, vec)
	db := dbSideMatching(vec, w1Live)
	db.IntervalCount = 2
	rows, err := runGoldenChainSide(context.Background(), testReader(f), vec, db, pool, atokens)
	require.NoError(t, err)
	for _, g := range rows {
		if g.Row == "C" {
			require.Equal(t, verdictDrift, g.Verdict)
			require.EqualValues(t, 2, *g.Count)
		}
	}
}

// TestGoldenArchiveMissSurfacesAsPinnedFailure: a pruned rejection at the
// deep pin classifies state-pruned through the runner and aborts the golden
// run — never a skip, never a fixture substitution.
func TestGoldenArchiveMissSurfacesAsPinnedFailure(t *testing.T) {
	vec, err := loadGoldenVectors()
	require.NoError(t, err)
	f, pool, atokens, w1Live := goldenFakeEnv(t, vec)
	f.handler = func(to common.Address, data []byte, hash common.Hash) ([]byte, error) {
		return nil, fmt.Errorf("missing trie node 0xdead (state pruned)")
	}
	db := dbSideMatching(vec, w1Live)
	_, err = runGoldenChainSide(context.Background(), testReader(f), vec, db, pool, atokens)
	require.Error(t, err)
	var pf *pinnedFailure
	require.ErrorAs(t, err, &pf)
	require.Equal(t, classStatePruned, pf.Class)
	mapped := aavePhaseErr(fmt.Errorf("golden: %w", pf))
	var a *runAbort
	require.ErrorAs(t, mapped, &a)
	require.Equal(t, exitPrecondition, a.code, "an archive miss at the golden pin is exit 2 (brief §4)")
}
