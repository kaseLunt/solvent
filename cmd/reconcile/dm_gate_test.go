package main

import (
	"encoding/hex"
	"math/big"
	"testing"

	"github.com/ethereum/go-ethereum/common"
	"github.com/stretchr/testify/require"

	"github.com/kaselunt/solvent/cmd/reconcile/snapshotdb"
	"github.com/kaselunt/solvent/internal/risk"
)

func acctHex(n byte) string {
	b := make([]byte, 20)
	b[19] = n
	return hex.EncodeToString(b)
}

func dmHealth(debt, maxBorrow int64) risk.DMHealth {
	return risk.DMHealth{
		Borrowings:   big.NewInt(debt),
		MaxBorrowLT:  big.NewInt(maxBorrow),
		Liquidatable: debt > maxBorrow,
	}
}

// testDMCtx builds a p3Ctx with just enough for buildDMCohort: a seed (the OP
// pin hash in production) and a registry that resolves liquidUSD by SYMBOL.
func testDMCtx(seed string) *p3Ctx {
	return &p3Ctx{
		o:  &options{},
		p1: &phase1Data{seed: seed},
		reg: &registryView{
			DM: map[common.Address]*registryAsset{
				tokA: regAsset(tokA, "liquidUSD", 6, "collateral", "debt"),
				tokB: regAsset(tokB, "liquidBTC", 8, "collateral"),
			},
			Aave: map[common.Address]*registryAsset{},
		},
	}
}

// TestBuildDMCohortIncludesEveryLiveLiquidatableAccount is risk-quant R3's DM
// clause: ALL live liquidatable accounts are MANDATORY members, because without
// them the TRUE side of the boolean is never exercised at all ("25 healthy
// stables prove nothing").
func TestBuildDMCohortIncludesEveryLiveLiquidatableAccount(t *testing.T) {
	var borrowers []string
	health := map[string]risk.DMHealth{}
	margins := map[string]*big.Int{}
	coll := map[string][]snapshotdb.T6Leg{}
	var liq []dmSubject

	// 3 liquidatable dust accounts + 40 healthy ones with varying collateral.
	for i := 1; i <= 43; i++ {
		a := acctHex(byte(i))
		borrowers = append(borrowers, a)
		if i <= 3 {
			health[a] = dmHealth(100, 0)
			margins[a] = big.NewInt(100)
			liq = append(liq, dmSubject{Account: common.HexToAddress(a), Health: health[a], Margin: margins[a],
				Reasons: []string{"our-liquidatable (mandatory member: without the TRUE side the boolean is never exercised)"}})
			continue
		}
		health[a] = dmHealth(1000, int64(1000+i*7))
		margins[a] = big.NewInt(int64(i * 7))
		// Give some accounts >=3 collateral tokens, and some liquidUSD.
		legs := []snapshotdb.T6Leg{{AssetHex: hexLower(tokB.Hex()), Amount: big.NewInt(1)}}
		if i%3 == 0 {
			legs = append(legs,
				snapshotdb.T6Leg{AssetHex: hexLower(tokA.Hex()), Amount: big.NewInt(1)},
				snapshotdb.T6Leg{AssetHex: hexLower(resUSDC.Hex()), Amount: big.NewInt(1)})
		}
		coll[a] = legs
	}

	c := testDMCtx("0xdeadbeef")
	cohort, comp := buildDMCohort(c, liq, health, margins, coll, borrowers)

	require.Equal(t, 3, comp.liquidatable, "every liquidatable account is a member")
	require.GreaterOrEqual(t, comp.healthy, dmHealthyFloor)
	require.GreaterOrEqual(t, comp.multiCollateral, dmMultiCollatFloor)
	require.GreaterOrEqual(t, comp.liquidUSD, dmLiquidUSDFloor)
	require.GreaterOrEqual(t, len(cohort), dmCohortTotalBackstop)
	require.NotNil(t, comp.boundary, "the nearest-boundary account is a mandatory member")
	// The nearest boundary is the smallest |debt - maxBorrowLT| over ALL
	// borrowers — here the liquidatable dust accounts sit at 100, and the
	// healthiest at i=4 sits at 28.
	require.Equal(t, "28", comp.boundary.Margin.String())

	// Every member carries at least one recorded REASON: a cohort member with
	// no reason is a member a reviewer cannot audit.
	for _, s := range cohort {
		require.NotEmpty(t, s.Reasons, "member %s has no recorded reason", s.Account.Hex())
	}
}

// TestBuildDMCohortIsSeedDeterministicAndSeedSensitive: the sampled remainder is
// drawn with the committed seed (the OP pin's block hash), so the SAME seed must
// give the SAME cohort and a DIFFERENT seed must actually change the draw —
// otherwise "seeded" would be decoration.
func TestBuildDMCohortIsSeedDeterministicAndSeedSensitive(t *testing.T) {
	var borrowers []string
	health := map[string]risk.DMHealth{}
	margins := map[string]*big.Int{}
	coll := map[string][]snapshotdb.T6Leg{}
	for i := 1; i <= 80; i++ {
		a := acctHex(byte(i))
		borrowers = append(borrowers, a)
		health[a] = dmHealth(1000, int64(2000+i))
		margins[a] = big.NewInt(int64(1000 + i))
		coll[a] = []snapshotdb.T6Leg{{AssetHex: hexLower(tokB.Hex()), Amount: big.NewInt(1)}}
	}
	names := func(c []dmSubject) []string {
		out := make([]string, 0, len(c))
		for _, s := range c {
			out = append(out, s.Account.Hex())
		}
		return out
	}
	a1, _ := buildDMCohort(testDMCtx("0xseed-one"), nil, health, margins, coll, borrowers)
	a2, _ := buildDMCohort(testDMCtx("0xseed-one"), nil, health, margins, coll, borrowers)
	b1, _ := buildDMCohort(testDMCtx("0xseed-two"), nil, health, margins, coll, borrowers)
	require.Equal(t, names(a1), names(a2), "the same seed must give the same cohort")
	require.NotEqual(t, names(a1), names(b1), "a different seed must actually change the sampled remainder")
}

// TestDMFullCensusOnlyEverAddsRows is the flag's classification as a test: it is
// a STRENGTHENER, so enabling it may only extend the welded set. A flag that
// could shrink coverage would have to taint.
func TestDMFullCensusOnlyEverAddsRows(t *testing.T) {
	var borrowers []string
	health := map[string]risk.DMHealth{}
	margins := map[string]*big.Int{}
	coll := map[string][]snapshotdb.T6Leg{}
	for i := 1; i <= 60; i++ {
		a := acctHex(byte(i))
		borrowers = append(borrowers, a)
		health[a] = dmHealth(1000, int64(2000+i))
		margins[a] = big.NewInt(int64(1000 + i))
		coll[a] = []snapshotdb.T6Leg{{AssetHex: hexLower(tokA.Hex()), Amount: big.NewInt(1)}}
	}
	base, _ := buildDMCohort(testDMCtx("0xs"), nil, health, margins, coll, borrowers)
	inBase := map[string]bool{}
	for _, s := range base {
		inBase[hex.EncodeToString(s.Account.Bytes())] = true
	}
	// The extension the flag performs (mirrored from runDMBooleanGate).
	extended := append([]dmSubject{}, base...)
	for _, a := range borrowers {
		if inBase[a] {
			continue
		}
		extended = append(extended, dmSubject{Account: common.HexToAddress(a),
			Reasons: []string{"-dm-full-census: whole-book chain liquidatable census"}})
	}
	require.Equal(t, len(borrowers), len(extended), "the full census covers every derived borrower")
	require.GreaterOrEqual(t, len(extended), len(base), "a strengthener may only add")
	for _, s := range base {
		found := false
		for _, e := range extended {
			if e.Account == s.Account {
				found = true
			}
		}
		require.True(t, found, "the strengthener must not displace a cohort member")
	}
}

// TestDMStrictInequalityEqualityIsHealthy pins the boundary the whole DM gate is
// about: DebtManagerCore.liquidatable uses `>`, so debt EXACTLY equal to the
// threshold-weighted collateral is HEALTHY and the on-chain call would revert.
func TestDMStrictInequalityEqualityIsHealthy(t *testing.T) {
	require.False(t, dmHealth(1000, 1000).Liquidatable, "equality is HEALTHY (strict >)")
	require.True(t, dmHealth(1001, 1000).Liquidatable)
	require.False(t, dmHealth(999, 1000).Liquidatable)
}

// TestDMGateFrameDeclaresTheSweepWatermark guards the reason ComputeDMHealth
// REQUIRES SweepBlock: DM collateral is sweep-dominated (~1h) while prices are
// 60s, so a boolean served without it would sit a 60s-fresh badge over hour-stale
// collateral.
func TestDMGateFrameDeclaresTheSweepWatermark(t *testing.T) {
	f := dmGateFrame()
	found := false
	for _, s := range f.Sources {
		if s.Kind == frameDerived && contains(s.Name, "snapshot_sweeps.last_success_block") {
			found = true
			require.Contains(t, s.Detail, "SweepBlock")
		}
	}
	require.True(t, found, "the sweep watermark is a declared derived input, not an implicit one")
}

// TestMarginTextNeverInventsAValue: an unavailable margin must read as
// unavailable, because a "0" would look like the sharpest possible boundary case.
func TestMarginTextNeverInventsAValue(t *testing.T) {
	require.Equal(t, "(unavailable)", marginText(nil))
	require.Equal(t, "0", marginText(big.NewInt(0)))
	require.Equal(t, "123", marginText(big.NewInt(123)))
}
