package main

// The DM boolean weld, live: OUR boolean against
// DebtManager.liquidatable(user)@pinHash, over subjects taken from the derived
// book AT THE SAME INSTANT AS THE PIN.
//
// # WHY THIS TEST WAS REWRITTEN (methodology defect, found 2026-07-29)
//
// The first version hard-coded a cohort — accounts and their collateral-leg
// counts — from a SELECT taken at one time, then welded it against chain state
// pinned 40-55 minutes later. That is a CROSS-TIME COMPARISON MACHINE, and it
// manufactured a false finding: subject 0x9fd6...0747 was frozen as
// "collateralLegs: 0" from a SELECT taken inside the collateral sweeper's
// 15-minute generation blind window (the account made its first-ever borrow at
// 03:16 and was swept 0.59s after generation 51 opened at 03:31). By the pin it
// held 3 legs. The test reported a "sweeper data gap" that does not exist — the
// sweeper's read was byte-exact with chain at its own block.
//
// A frozen literal can only be honest if the derived side cannot have moved
// between the SELECT and the pin, and on a live book it always can.
//
// # THE FIX, AND WHY THIS OPTION
//
// Two were available: read the derived side live inside the test, or constrain
// the frozen cohort to accounts provably immune to the window. This takes the
// FIRST, and does it by calling the PRODUCTION collector (snapshotdb.Collect with
// Task6 on) rather than hand-rolling SQL:
//
//   - ONE repeatable-read snapshot supplies the derived side, and the pin is the
//     derive cursor read INSIDE that same transaction — so the two sides are the
//     same instant BY CONSTRUCTION, not by luck. No window is left for a
//     generation boundary to open in.
//   - it exercises the real collector, including the pin-filtered sweep watermark
//     (snapshotdb.T6SweepState), so this test now also covers the fix for the
//     defect the probe root-caused. The constrained-frozen-cohort option would
//     have left that path untested here.
//   - the cohort is DERIVED FROM the snapshot, so it cannot go stale and needs no
//     maintenance as the book moves.
//
// The cost, stated: this test now needs SOLVENT_DATABASE_URL as well as the RPC
// env, and it reads the live database — strictly read-only, exactly as reconcile
// does. That is the right trade: a weld whose two sides come from different
// moments is not a weld.

import (
	"context"
	"math/big"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"testing"
	"time"

	"github.com/ethereum/go-ethereum/common"
	"github.com/stretchr/testify/require"

	"github.com/kaselunt/solvent/cmd/reconcile/snapshotdb"
	"github.com/kaselunt/solvent/internal/config"
	"github.com/kaselunt/solvent/internal/risk"
	"github.com/kaselunt/solvent/internal/riskfeed"
)

// liveDMSubjectCap bounds how many evaluable borrowers the weld covers, so the
// test stays inside a sane RPC budget (4 calls per subject).
const liveDMSubjectCap = 12

func TestLiveDMBooleanWeldOverOneSnapshotAndItsOwnPin(t *testing.T) {
	requireLive(t)
	if strings.TrimSpace(os.Getenv("SOLVENT_DATABASE_URL")) == "" {
		t.Skip("SOLVENT_DATABASE_URL unset: this weld reads the derived side live, in ONE snapshot, so it needs the database")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Minute)
	defer cancel()

	// The canonical config path is repo-root relative and `go test` runs with the
	// package directory as CWD, so it is resolved explicitly here rather than
	// depending on where the test was invoked from.
	cfg, err := config.Load(filepath.Join("..", "..", canonicalConfigPath))
	require.NoError(t, err)
	roDSN, err := readOnlyDSN(cfg.DatabaseURL)
	require.NoError(t, err, "the derived side is read STRICTLY read-only, exactly as reconcile reads it")

	// ONE repeatable-read snapshot: the derived side AND the pin, one instant.
	snap, err := snapshotdb.Collect(ctx, snapshotdb.Params{
		Task6:                 true,
		AdapterRowsPerReserve: adapterRowsPerReserve,
	}, cfg, roDSN, snapshotdb.GoldenSpec{}, true /*wantDM*/, false /*wantAave*/, nil)
	require.NoError(t, err)
	require.NotNil(t, snap.Task6)
	pin := snap.Pins[snapshotdb.DMEngine]
	require.NotZero(t, pin)
	t.Logf("ONE snapshot: pin = the DM derive cursor %d, read inside the SAME transaction as the derived side", pin)

	r := liveReader(t, "op", "SOLVENT_RECON_RPC_OP", "SOLVENT_RPC_OP")
	hash, _, err := r.headerHash(ctx, pin)
	require.NoError(t, err)
	t.Logf("pin hash %s", hash.Hex())

	c := &p3Ctx{
		o: &options{}, p1: &phase1Data{Data: *snap, seed: hash.Hex()}, t6: snap.Task6,
		opR: r, pinOP: pin, hashOP: hash,
		dmProxy: liveDMProxy, frames: &frameSet{}, now: time.Now().UTC(),
	}
	universe, borrowTokens, _, err := readDMTokenUniverse(ctx, c)
	require.NoError(t, err)
	require.NotEmpty(t, universe, "the chain token enumeration must read at the pin")
	decimals, prices, indexes, _, err := readDMTokenState(ctx, c, universe, borrowTokens)
	require.NoError(t, err)

	// OUR debt: the derived normalized fold x the PINNED index.
	debtUSD := map[string]*big.Int{}
	for _, l := range snap.Task6.DMDebtLegs {
		idx := indexes[common.HexToAddress(l.AssetHex)]
		if idx == nil {
			continue
		}
		if debtUSD[l.AccountHex] == nil {
			debtUSD[l.AccountHex] = new(big.Int)
		}
		debtUSD[l.AccountHex].Add(debtUSD[l.AccountHex], mulDivFloor(l.Amount, idx))
	}
	require.NotEmpty(t, debtUSD, "the derived book must carry borrowers")

	// Exclude accounts with no collateral testimony AT THE PIN — the same
	// classification the gate applies, so this test also covers that fix.
	_, excluded := classifySweepTestimony(c, nil, snap.Task6, debtUSD, nil)
	collByAccount := map[string][]snapshotdb.T6Leg{}
	for _, l := range snap.Task6.DMCollLegs {
		collByAccount[l.AccountHex] = append(collByAccount[l.AccountHex], l)
	}
	var subjects []string
	for acct := range debtUSD {
		if !excluded[acct] {
			subjects = append(subjects, acct)
		}
	}
	sort.Strings(subjects)
	t.Logf("derived borrowers %d; evaluable at the pin %d; excluded (no collateral testimony at the pin) %d",
		len(debtUSD), len(subjects), len(excluded))
	require.NotEmpty(t, subjects, "at least one borrower must be evaluable at the pin")

	// Cover the TRUE side deliberately: fewest-collateral-legs first (those have
	// the smallest maxBorrowLT, so they are where the boolean is true), then the
	// rest in account order. Both keys are structural, never a value that could
	// steer the selection toward agreeing accounts.
	sort.SliceStable(subjects, func(i, j int) bool {
		li, lj := len(collByAccount[subjects[i]]), len(collByAccount[subjects[j]])
		if li != lj {
			return li < lj
		}
		return subjects[i] < subjects[j]
	})
	if len(subjects) > liveDMSubjectCap {
		subjects = subjects[:liveDMSubjectCap]
	}

	// Chain side, batched.
	var calls []multicallCall
	type tag struct {
		kind string
		acct common.Address
	}
	var tags []tag
	for _, acct := range subjects {
		a := common.HexToAddress(acct)
		for _, spec := range []struct {
			kind string
			data []byte
		}{
			{"bool", mustPack(t, dmLiquidatableABI, "liquidatable", a)},
			{"maxBorrow", mustPack(t, dmGetMaxBorrowAmountABI, "getMaxBorrowAmount", a, false)},
			{"borrowingOf", mustPack(t, dmBorrowingOfAllABI, "borrowingOf", a)},
			{"collateralOf", mustPack(t, dmCollateralOfABI, "collateralOf", a)},
		} {
			calls = append(calls, multicallCall{Target: liveDMProxy, CallData: spec.data})
			tags = append(tags, tag{spec.kind, a})
		}
	}
	res, _, err := r.multicall(ctx, "live:dmBoolean", pin, hash, calls)
	require.NoError(t, err)

	chainBool := map[common.Address]bool{}
	chainMax := map[common.Address]*big.Int{}
	chainDebt := map[common.Address]*big.Int{}
	chainLegs := map[common.Address]int{}
	chainCollUSD := map[common.Address]*big.Int{}
	for i, tg := range tags {
		require.True(t, res[i].Success, "%s for %s reverted at the pin", tg.kind, tg.acct.Hex())
		switch tg.kind {
		case "bool":
			v, uerr := unpackBoolStrict(dmLiquidatableABI, "liquidatable", res[i].ReturnData)
			require.NoError(t, uerr)
			chainBool[tg.acct] = v
		case "maxBorrow":
			v, uerr := unpackUint256Strict(dmGetMaxBorrowAmountABI, "getMaxBorrowAmount", res[i].ReturnData)
			require.NoError(t, uerr)
			chainMax[tg.acct] = v
		case "borrowingOf":
			_, total, uerr := unpackTokenAmountList(dmBorrowingOfAllABI, "borrowingOf", res[i].ReturnData)
			require.NoError(t, uerr)
			chainDebt[tg.acct] = total
		case "collateralOf":
			list, total, uerr := unpackTokenAmountList(dmCollateralOfABI, "collateralOf", res[i].ReturnData)
			require.NoError(t, uerr)
			chainLegs[tg.acct] = len(list)
			chainCollUSD[tg.acct] = total
		}
	}

	// OUR side through the PRODUCTION law and the SAME snapshot's params.
	folded, err := riskfeed.FoldParams(dmEngine, 10, snap.Task6.DMParams)
	require.NoError(t, err)

	boolExact, debtExact, maxExact, legsAgree, trueSide := 0, 0, 0, 0, 0
	for _, acct := range subjects {
		a := common.HexToAddress(acct)
		in := risk.DMInput{
			Account: a, DebtUSD: debtUSD[acct], Params: folded,
			Marks: risk.Watermarks{
				BalancesBlock: pin, ParamsBlock: pin,
				SweepBlock: snap.Task6.DMSweepByAccount[acct].AtOrBelowPin,
			},
		}
		for _, l := range collByAccount[acct] {
			tok := common.HexToAddress(l.AssetHex)
			dec, okDec := decimals[tok]
			p := prices[tok]
			require.True(t, okDec && p != nil, "%s: collateral token %s has no pinned decimals/price", acct, tok.Hex())
			in.Collateral = append(in.Collateral, risk.DMCollateral{Asset: tok, Amount: l.Amount, Decimals: dec})
			in.Prices = append(in.Prices, risk.PriceInput{
				ChainID: 10, Asset: tok, Source: "dm:convertCollateralTokenToUsd@pin", Block: pin,
				Value: p, Decimals: 6, Provenance: risk.ProvenanceEngineExact, Fresh: true,
			})
		}
		h, cerr := risk.ComputeDMHealth(in)
		require.NoError(t, cerr, "%s: internal/risk refused over the declared frame", acct)

		okBool := h.Liquidatable == chainBool[a]
		okDebt := h.Borrowings.Cmp(chainDebt[a]) == 0
		okMax := h.MaxBorrowLT.Cmp(chainMax[a]) == 0
		okLegs := len(collByAccount[acct]) == chainLegs[a]
		if okBool {
			boolExact++
		}
		if okDebt {
			debtExact++
		}
		if okMax {
			maxExact++
		}
		if okLegs {
			legsAgree++
		}
		if chainBool[a] {
			trueSide++
		}
		margin := new(big.Int).Sub(h.Borrowings, h.MaxBorrowLT)
		t.Logf("0x%s sweepBlock=%d\n    ours:  debt=%s maxBorrowLT=%s liquidatable=%v margin=%s legs=%d\n    chain: debt=%s maxBorrowLT=%s liquidatable=%v legs=%d collateralOf=%s USD-6\n    exact: bool=%v debt=%v maxBorrow=%v legs=%v",
			acct, snap.Task6.DMSweepByAccount[acct].AtOrBelowPin,
			h.Borrowings, h.MaxBorrowLT, h.Liquidatable, margin, len(collByAccount[acct]),
			chainDebt[a], chainMax[a], chainBool[a], chainLegs[a], chainCollUSD[a],
			okBool, okDebt, okMax, okLegs)
	}

	n := len(subjects)
	t.Logf("DM BOOLEAN WELD over %d evaluable borrowers, ONE snapshot, pin %d:", n, pin)
	t.Logf("  liquidatable(strict >)         EXACT %d/%d   (chain TRUE on %d of them)", boolExact, n, trueSide)
	t.Logf("  borrowingOf(user).total        EXACT %d/%d   (our normalized fold x the PINNED index)", debtExact, n)
	t.Logf("  getMaxBorrowAmount(user,false) EXACT %d/%d   (per-token floor then sum)", maxExact, n)
	t.Logf("  collateral leg count agrees    %d/%d   (our swept legs vs CashLens AT THE SAME PIN)", legsAgree, n)

	require.Equal(t, n, debtExact,
		"our index-replayed live debt must equal borrowingOf(user).total bit-exactly")
	require.Equal(t, n, maxExact,
		"our threshold-weighted collateral must equal getMaxBorrowAmount(user,false) bit-exactly (per-token floor, then sum)")
	require.Equal(t, n, legsAgree,
		"our swept collateral legs must agree with CashLens AT THE SAME PIN. This is the assertion the old frozen-literal cohort could not make honestly: its two sides came from moments ~45 minutes apart, so a disagreement there said nothing about the sweeper")
	require.Equal(t, n, boolExact,
		"the boolean must agree on every evaluable subject: a FALSE NEGATIVE is the alert product's worst failure, and a FALSE POSITIVE is an alert the chain refuses")
}
