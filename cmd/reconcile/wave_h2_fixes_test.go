// Wave H2 regression tests: the Codex round-2 proof-surface fixes, each pinned
// by the law it implements and by the designed mutant it must kill
// (testdata/mutation-transcripts/wave-h2.md).
//
//  1. dm_boolean_weld — the own-clock weld proves the VECTOR, not the scalar
//     (mutant m1: the vector proof dropped back to scalar-only; killed with
//     two counterbalancing wrong rows whose price×LT products cancel at S).
//  2. aave_hf balance-census — selection per (account, reserve), not per
//     membership flip (mutant m2: the selection collapsed back to flips).
//  3. accept-r4 refutation — artifact identity + completeness bars (mutant
//     m3: the bars removed; a truncated artifact must FAIL).
package main

import (
	"encoding/json"
	"fmt"
	"math/big"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/ethereum/go-ethereum/common"
	"github.com/stretchr/testify/require"

	"github.com/kaselunt/solvent/internal/risk"
)

// --- fix 1: the vector custody proof -----------------------------------------

// dmScalarOverVector recomputes the maxBorrow scalar over a (token → amount)
// vector exactly as the gate does (internal/risk.ComputeDMHealth — the
// per-token floor-then-sum law, DebtManagerCore.sol:139-165), with one price
// and one LT for every token so the counterbalance below is exact by
// construction.
func dmScalarOverVector(t *testing.T, vec map[common.Address]*big.Int, price, lt *big.Int) *big.Int {
	t.Helper()
	in := risk.DMInput{
		Account: common.HexToAddress("0x5C99e546e5eA286a0aA8DB09fa6f9B1AA675dBb2"),
		DebtUSD: big.NewInt(1),
		Marks:   risk.Watermarks{BalancesBlock: 154_900_000, ParamsBlock: 154_900_000, SweepBlock: 154_900_000},
	}
	toks := make([]common.Address, 0, len(vec))
	for tok := range vec {
		toks = append(toks, tok)
	}
	for _, tok := range sortAddrSlice(toks) {
		in.Collateral = append(in.Collateral, risk.DMCollateral{Asset: tok, Amount: vec[tok], Decimals: 6})
		in.Prices = append(in.Prices, risk.PriceInput{
			ChainID: 10, Asset: tok, Source: "test", Block: 154_900_000,
			Value: price, Decimals: 6, Provenance: risk.ProvenanceEngineExact, Fresh: true,
		})
		in.Params = append(in.Params, risk.ParamRow{
			Engine: risk.DMEngine, ChainID: 10, Asset: tok,
			LiqThreshold: lt, EffectiveBlock: 1,
		})
	}
	h, err := risk.ComputeDMHealth(in)
	require.NoError(t, err)
	return h.MaxBorrowLT
}

// TestClassifyDMMaxBorrowRequiresTheVector is the m1 kill (Codex round 2,
// finding 1): two wrong snapshot rows whose price×LT products cancel at S —
// two stables with equal price and LT, amounts swapped — keep the SCALAR
// recompute exactly equal to getMaxBorrowAmount@S, so a scalar-only own-clock
// weld classifies the corruption sample-gap-disclosed and excuses the real
// pin-clock mismatch. The vector byte-compare is the custody proof: it must
// catch the swap, and the classifier must gate on it REGARDLESS of the
// scalar. The dissection did exactly this comparison by hand (5/5
// byte-identical); this pins that strength into the committed gate.
func TestClassifyDMMaxBorrowRequiresTheVector(t *testing.T) {
	tokA := common.HexToAddress("0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85") // USDC (OP)
	tokB := common.HexToAddress("0x94b008aA00579c1307B0EF2c499aD98a8ce58e58") // USDT (OP)
	price := big.NewInt(1_000_000)                                            // 1.00 USD-6 per whole token: equal across both stables
	lt := new(big.Int).Mul(big.NewInt(95), new(big.Int).Exp(big.NewInt(10), big.NewInt(18), nil))

	persisted := map[common.Address]*big.Int{ // the WRONG stored vector
		tokA: big.NewInt(100_000_000), // 100.00
		tokB: big.NewInt(13_000_000),  // 13.00
	}
	chainTruth := map[common.Address]*big.Int{ // the chain's own state at S: swapped
		tokA: big.NewInt(13_000_000),
		tokB: big.NewInt(100_000_000),
	}

	// The counterbalance is REAL, not assumed: the scalar law over both
	// vectors produces the same number, so the scalar weld cannot see the
	// corruption. This is what makes the mutant kill non-vacuous.
	oursOverPersisted := dmScalarOverVector(t, persisted, price, lt)
	chainAtS := dmScalarOverVector(t, chainTruth, price, lt)
	require.Zero(t, chainAtS.Cmp(oursOverPersisted),
		"fixture precondition: the two wrong rows must cancel in the scalar (price×LT equal) — otherwise this test kills nothing")

	// The vector proof catches what the scalar cannot.
	chainVec := []tokenAmount{
		{Token: tokB, Amount: big.NewInt(100_000_000)},
		{Token: tokA, Amount: big.NewInt(13_000_000)},
	}
	match, diff := compareDMCollateralVector(chainVec, persisted)
	require.False(t, match, "the swapped vector must NOT byte-compare")
	require.Contains(t, diff, tokA.Hex())
	require.Contains(t, diff, tokB.Hex())

	// And the classifier gates on it, scalar agreement notwithstanding.
	pin := big.NewInt(107_350_000)
	ours := big.NewInt(107_351_000) // any pin drift
	own := &dmOwnClockResult{Block: 154_900_000, ChainMax: chainAtS, OurMax: oursOverPersisted,
		VectorRead: true, VectorMatch: false, VectorDiff: diff}
	v, cls := classifyDMMaxBorrow(pin, ours, own)
	require.Equal(t, verdictDrift, v,
		"a vector mismatch with a CANCELING scalar is exactly the corruption the scalar-only weld excused (Codex round 2, finding 1) — it must gate")
	require.Equal(t, "snapshot-custody-drift", cls)
	require.True(t, verdictIsFailure(v))

	// The honest arm still discloses: same scalars, vector MATCHING.
	own = &dmOwnClockResult{Block: 154_900_000, ChainMax: chainAtS, OurMax: oursOverPersisted,
		VectorRead: true, VectorMatch: true, VectorLegs: 2}
	v, cls = classifyDMMaxBorrow(pin, ours, own)
	require.Equal(t, verdictSampleGap, v)
	require.Equal(t, verdictSampleGap, cls)

	// And sample-gap is UNREACHABLE without the vector proof: a scalar-only
	// result (VectorRead false, no error recorded) is "cannot verify".
	own = &dmOwnClockResult{Block: 154_900_000, ChainMax: chainAtS, OurMax: oursOverPersisted}
	v, cls = classifyDMMaxBorrow(pin, ours, own)
	require.Equal(t, verdictWeldUnread, v,
		"sample-gap must be unreachable without the vector custody proof")
	require.Equal(t, "own-clock-read-unread", cls)

	// A vector mismatch outranks a scalar refusal: custody drift is proven
	// even when the scalar legs never produced values.
	own = &dmOwnClockResult{Block: 154_900_000, Err: "convertCollateralTokenToUsd reverted at S",
		VectorRead: true, VectorMatch: false, VectorDiff: diff}
	v, cls = classifyDMMaxBorrow(pin, ours, own)
	require.Equal(t, verdictDrift, v, "a proven vector mismatch cannot be softened to weld-unread by a refused scalar leg")
	require.Equal(t, "snapshot-custody-drift", cls)
}

// TestCompareDMCollateralVectorLaw pins the byte-compare's normalization: the
// SAME one the sweeper applies when it persists (decodeCollateralOf) — zero
// amounts dropped (absence IS zero under wholesale replacement), duplicates
// accumulated additively, order-insensitive by token address, zero tolerance,
// both absence directions mismatches.
func TestCompareDMCollateralVectorLaw(t *testing.T) {
	tokA := common.HexToAddress("0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85")
	tokB := common.HexToAddress("0x94b008aA00579c1307B0EF2c499aD98a8ce58e58")
	persisted := map[common.Address]*big.Int{tokA: big.NewInt(7), tokB: big.NewInt(9)}

	match, diff := compareDMCollateralVector([]tokenAmount{
		{Token: tokB, Amount: big.NewInt(9)}, // order-insensitive
		{Token: tokA, Amount: big.NewInt(7)},
	}, persisted)
	require.True(t, match, diff)

	match, _ = compareDMCollateralVector([]tokenAmount{
		{Token: tokB, Amount: big.NewInt(9)},
		{Token: tokA, Amount: big.NewInt(7)},
		{Token: common.HexToAddress("0x80Eede496655FB9047dd39d9f418d5483ED600df"), Amount: big.NewInt(0)},
	}, persisted)
	require.True(t, match, "a zero-amount chain entry is dropped — the sweeper would not have persisted it (absence IS zero)")

	match, _ = compareDMCollateralVector([]tokenAmount{
		{Token: tokA, Amount: big.NewInt(3)}, // duplicates accumulate: 3+4=7
		{Token: tokB, Amount: big.NewInt(9)},
		{Token: tokA, Amount: big.NewInt(4)},
	}, persisted)
	require.True(t, match, "duplicate chain entries accumulate additively, mirroring decodeCollateralOf")

	match, diff = compareDMCollateralVector([]tokenAmount{
		{Token: tokA, Amount: big.NewInt(7)},
		{Token: tokB, Amount: big.NewInt(10)}, // one unit off
	}, persisted)
	require.False(t, match)
	require.Contains(t, diff, "10 != persisted 9")

	match, diff = compareDMCollateralVector([]tokenAmount{
		{Token: tokA, Amount: big.NewInt(7)},
	}, persisted)
	require.False(t, match, "a persisted token the chain lacks is a mismatch")
	require.Contains(t, diff, "ABSENT from collateralOf@S")

	match, diff = compareDMCollateralVector([]tokenAmount{
		{Token: tokA, Amount: big.NewInt(7)},
		{Token: tokB, Amount: big.NewInt(9)},
		{Token: common.HexToAddress("0x80Eede496655FB9047dd39d9f418d5483ED600df"), Amount: big.NewInt(1)},
	}, persisted)
	require.False(t, match, "a chain token the document lacks is a mismatch")
	require.Contains(t, diff, "ABSENT from the persisted document")

	match, _ = compareDMCollateralVector(nil, map[common.Address]*big.Int{})
	require.True(t, match, "empty vs empty is a match: a sweep that found no collateral persisted none")
}

// --- fix 2: per-(account, reserve) balance-census selection -------------------

// TestSelectMaskedBalancePairsPerAccountReserve is the m2 kill (Codex round 2,
// finding 2): the masking condition is a property of the PAIR. A borrower
// (RawZeroDebt == oneLawZero == false) and a mixed-reserve zero-debt account
// (true in both) flip no membership — under the Wave-H flip selection their
// wrong flag-OFF balances were never welded anywhere.
func TestSelectMaskedBalancePairsPerAccountReserve(t *testing.T) {
	rsvOn := common.HexToAddress("0xCd5fE23C85820F7B72D0926FC9b05b43E359b7ee")
	rsvOff := common.HexToAddress("0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2")
	reserves := []common.Address{rsvOn, rsvOff}

	borrower := common.HexToAddress("0x1199d06D5220Ee3b2911C811955C21A8BE2C716A")
	mixedZero := common.HexToAddress("0x2c64a1D5D602E7Fb6d21dA6211DceCc6E17a0649")
	cleanAcct := common.HexToAddress("0x5C99e546e5eA286a0aA8DB09fa6f9B1AA675dBb2")
	pinnedMasked := common.HexToAddress("0x437a76A38dd0Dc67bBD485ea31E3e1ed6653F969")
	unmeasured := common.HexToAddress("0x90FE7F8bd4170A40C39CA040F52b0B9Bc573AdCF")

	candidates := []common.Address{borrower, mixedZero, cleanAcct, pinnedMasked, unmeasured}
	measured := map[common.Address]bool{borrower: true, mixedZero: true, cleanAcct: true, pinnedMasked: true}

	legs := map[string]map[common.Address][2]*big.Int{
		// A borrower: debt in rsvOn, positive collateral in the flag-OFF rsvOff.
		// Membership flips nothing (both censuses say "not zero-debt").
		hexLower(borrower.Hex()): {
			rsvOn:  {big.NewInt(5_000), big.NewInt(0)},
			rsvOff: {nil, big.NewInt(777)},
		},
		// A zero-debt account with one enabled+valued reserve and one disabled
		// positive reserve: a member under BOTH censuses — no flip either.
		hexLower(mixedZero.Hex()): {
			rsvOn:  {nil, big.NewInt(1_000_000)},
			rsvOff: {nil, big.NewInt(888)},
		},
		// All flags on, all balances welded by the pinned HF leg: not masked.
		hexLower(cleanAcct.Hex()): {
			rsvOn: {nil, big.NewInt(42)},
		},
		// Folded flag ON but the PINNED bitmap OFF: the same invisibility
		// through the other flag door.
		hexLower(pinnedMasked.Hex()): {
			rsvOn: {nil, big.NewInt(31337)},
		},
		// Unmeasured accounts carry legs too; they must be skipped (their
		// account-state row already gated weld-unread).
		hexLower(unmeasured.Hex()): {
			rsvOff: {nil, big.NewInt(1)},
		},
	}
	folded := map[string]map[common.Address]bool{
		hexLower(borrower.Hex()):     {rsvOn: true},               // rsvOff never-enabled => OFF
		hexLower(mixedZero.Hex()):    {rsvOn: true, rsvOff: false}, // explicit disable
		hexLower(cleanAcct.Hex()):    {rsvOn: true},
		hexLower(pinnedMasked.Hex()): {rsvOn: true},
	}
	pinnedOn := func(a, r common.Address) bool {
		if a == pinnedMasked && r == rsvOn {
			return false // the pinned bitmap masks it; the folded fold does not
		}
		// Everyone else's pinned bitmap agrees with the folded fold.
		return folded[hexLower(a.Hex())][r]
	}

	sel := selectMaskedBalancePairs(candidates, measured, reserves, legs, folded, pinnedOn)

	require.Equal(t, []common.Address{rsvOff}, sel.Pairs[borrower],
		"a BORROWER's positive flag-OFF balance must join the weld — membership flips are not the masking condition (Codex round 2, finding 2)")
	require.Equal(t, []common.Address{rsvOff}, sel.Pairs[mixedZero],
		"a mixed-reserve zero-debt account is a member under BOTH censuses; its disabled-reserve balance must still join")
	require.NotContains(t, sel.Pairs, cleanAcct,
		"a balance both flag doors admit is already welded by the pinned HF leg — not masked")
	require.Equal(t, []common.Address{rsvOn}, sel.Pairs[pinnedMasked],
		"folded ON + pinned OFF is the same invisibility through the other door: the pinned HF computation ignores the balance on both sides")
	require.NotContains(t, sel.Pairs, unmeasured, "unmeasured candidates are already gated weld-unread")

	require.Equal(t, 3, sel.PairCount)
	require.Equal(t, 2, sel.FoldedOff)
	require.Equal(t, 1, sel.PinnedOnlyOff)

	// Zero balances never select: absence is zero, and a zero balance in a
	// flag-OFF reserve is exactly what the chain reports too.
	legs[hexLower(borrower.Hex())][rsvOff] = [2]*big.Int{nil, big.NewInt(0)}
	sel = selectMaskedBalancePairs(candidates, measured, reserves, legs, folded, pinnedOn)
	require.NotContains(t, sel.Pairs, borrower)
}

// --- fix 3: the refutation's artifact-identity and completeness bars ---------

// acceptR4SyntheticDoc builds a minimal artifact document that PASSES every
// bar: correct identity fields and exactly 233 + 24 unique drift subjects.
func acceptR4SyntheticDoc() map[string]any {
	rows := make([]map[string]any, 0, acceptR4DMSubjects+acceptR4CensusSubjects)
	for i := 0; i < acceptR4DMSubjects; i++ {
		var a common.Address
		a[0], a[1], a[19] = 0xd1, byte(i>>8), byte(i)
		rows = append(rows, map[string]any{
			"gate": gateDMBoolean, "subject": a.Hex(), "leg": "getMaxBorrowAmount(user,false)",
			"verdict": verdictDrift, "expected_chain": "1000", "actual_derived": fmt.Sprintf("%d", 2000+i),
		})
	}
	for i := 0; i < acceptR4CensusSubjects; i++ {
		var a common.Address
		a[0], a[19] = 0xce, byte(i)
		rows = append(rows, map[string]any{
			"gate": gateAaveHF, "subject": a.Hex(), "leg": "census(zero-debt): chain vs derived",
			"verdict": verdictDrift, "expected_chain": "zero-debt collateral holder = false (chain)",
			"actual_derived": "true (derived)",
		})
	}
	return map[string]any{
		"comparison_sha256": acceptR4ComparisonSHA,
		"pins": []map[string]any{
			{"chain": "op", "block": acceptR4PinOP, "hash": acceptR4HashOP},
			{"chain": "eth", "block": acceptR4PinETH, "hash": acceptR4HashETH},
		},
		"p3_task6": map[string]any{"rows": rows},
	}
}

func marshalDoc(t *testing.T, doc map[string]any) []byte {
	t.Helper()
	raw, err := json.Marshal(doc)
	require.NoError(t, err)
	return raw
}

// sealDoc embeds the doc's OWN recomputed comparison hash (the canonical law
// from artifact.go) and returns the sealed bytes plus that digest. Bar
// subtests seal AFTER mutating so identity passes honestly and the bar under
// test is the one that fires; identity subtests mutate AFTER sealing.
func sealDoc(t *testing.T, doc map[string]any) ([]byte, string) {
	t.Helper()
	var report driftReport
	require.NoError(t, json.Unmarshal(marshalDoc(t, doc), &report))
	h, err := comparisonHash(&report)
	require.NoError(t, err)
	doc["comparison_sha256"] = h
	// comparison_sha256 sits outside the hash scope, so re-embedding it does
	// not change the recomputed value.
	return marshalDoc(t, doc), h
}

// TestAcceptR4ArtifactBarsRefuseTruncationAndIdentityDrift is the m3 kill
// (Codex round 2, finding 3): the previous refutation required only a
// NONEMPTY subset, so a truncated artifact — or the wrong artifact entirely —
// still produced a green refutation. The loader now refuses anything short of
// the full identified row set, and this test proves each bar fails CLOSED.
func TestAcceptR4ArtifactBarsRefuseTruncationAndIdentityDrift(t *testing.T) {
	complete, completeSHA := sealDoc(t, acceptR4SyntheticDoc())
	targets, err := parseAcceptR4ArtifactAgainst(complete, completeSHA)
	require.NoError(t, err)
	require.Len(t, targets.dm, acceptR4DMSubjects)
	require.Len(t, targets.census, acceptR4CensusSubjects)

	t.Run("a truncated DM row set FAILS", func(t *testing.T) {
		doc := acceptR4SyntheticDoc()
		rows := doc["p3_task6"].(map[string]any)["rows"].([]map[string]any)
		doc["p3_task6"].(map[string]any)["rows"] = rows[1:] // drop one DM row: 232/233
		raw, sha := sealDoc(t, doc)
		_, err := parseAcceptR4ArtifactAgainst(raw, sha)
		require.Error(t, err, "a truncated artifact must not refute (Codex round 2, finding 3)")
		require.Contains(t, err.Error(), "COMPLETENESS failed")
		require.Contains(t, err.Error(), "232")
	})
	t.Run("a truncated census row set FAILS", func(t *testing.T) {
		doc := acceptR4SyntheticDoc()
		rows := doc["p3_task6"].(map[string]any)["rows"].([]map[string]any)
		doc["p3_task6"].(map[string]any)["rows"] = rows[:len(rows)-1] // drop one census row: 23/24
		raw, sha := sealDoc(t, doc)
		_, err := parseAcceptR4ArtifactAgainst(raw, sha)
		require.Error(t, err)
		require.Contains(t, err.Error(), "COMPLETENESS failed")
		require.Contains(t, err.Error(), "23 unique zero-debt")
	})
	t.Run("a wrong comparison_sha256 FAILS", func(t *testing.T) {
		// Embedded digest of zeros: even when the caller ASKS for zeros, the
		// recompute bar refuses first — no self-report is ever trusted.
		doc := acceptR4SyntheticDoc()
		doc["comparison_sha256"] = strings.Repeat("00", 32)
		_, err := parseAcceptR4ArtifactAgainst(marshalDoc(t, doc), strings.Repeat("00", 32))
		require.Error(t, err, "the refutation is judged against the run's OWN artifact, never a substitute")
		require.Contains(t, err.Error(), "ARTIFACT IDENTITY failed")
	})
	t.Run("a mutated scoped row with a STALE digest FAILS (Codex round 3 kill)", func(t *testing.T) {
		doc := acceptR4SyntheticDoc()
		raw, sha := sealDoc(t, doc)
		// Mutate one scoped row AFTER sealing: the embedded digest is now a
		// self-report about bytes that no longer exist. The recompute bar
		// must refuse — the self-reported string alone would have passed.
		rows := doc["p3_task6"].(map[string]any)["rows"].([]map[string]any)
		rows[0]["expected_chain"] = "999999"
		mutated := marshalDoc(t, doc)
		require.NotEqual(t, raw, mutated)
		_, err := parseAcceptR4ArtifactAgainst(mutated, sha)
		require.Error(t, err, "a doctored row under a copied digest must refuse")
		require.Contains(t, err.Error(), "recomputed comparison hash")
	})
	t.Run("the round-2 substitute construction FAILS (copied accept-r4 digest)", func(t *testing.T) {
		// Codex round 2 proved a synthetic 233+24 document carrying the
		// COPIED accept-r4 digest parsed successfully. That exact
		// construction must now refuse at the recompute bar.
		doc := acceptR4SyntheticDoc() // embeds acceptR4ComparisonSHA verbatim
		_, err := parseAcceptR4Artifact(marshalDoc(t, doc))
		require.Error(t, err, "a substitute wearing the copied digest must refuse")
		require.Contains(t, err.Error(), "recomputed comparison hash")
	})
	t.Run("a drifted pin FAILS", func(t *testing.T) {
		doc := acceptR4SyntheticDoc()
		doc["pins"] = []map[string]any{
			{"chain": "op", "block": acceptR4PinOP + 1, "hash": acceptR4HashOP},
			{"chain": "eth", "block": acceptR4PinETH, "hash": acceptR4HashETH},
		}
		raw, sha := sealDoc(t, doc)
		_, err := parseAcceptR4ArtifactAgainst(raw, sha)
		require.Error(t, err)
		require.Contains(t, err.Error(), "ARTIFACT IDENTITY failed")
	})
	t.Run("a missing pin FAILS", func(t *testing.T) {
		doc := acceptR4SyntheticDoc()
		doc["pins"] = []map[string]any{
			{"chain": "eth", "block": acceptR4PinETH, "hash": acceptR4HashETH},
		}
		raw, sha := sealDoc(t, doc)
		_, err := parseAcceptR4ArtifactAgainst(raw, sha)
		require.Error(t, err)
		require.Contains(t, err.Error(), "does not carry both accept-r4 pins")
	})
	t.Run("a duplicated subject FAILS even at the right count", func(t *testing.T) {
		doc := acceptR4SyntheticDoc()
		rows := doc["p3_task6"].(map[string]any)["rows"].([]map[string]any)
		rows[1] = rows[0] // 233 rows, 232 unique subjects
		raw, sha := sealDoc(t, doc)
		_, err := parseAcceptR4ArtifactAgainst(raw, sha)
		require.Error(t, err)
		require.Contains(t, err.Error(), "duplicate")
	})
	t.Run("a drift row with equal pin values FAILS", func(t *testing.T) {
		doc := acceptR4SyntheticDoc()
		rows := doc["p3_task6"].(map[string]any)["rows"].([]map[string]any)
		rows[0] = map[string]any{
			"gate": gateDMBoolean, "subject": rows[0]["subject"], "leg": "getMaxBorrowAmount(user,false)",
			"verdict": verdictDrift, "expected_chain": "1000", "actual_derived": "1000",
		}
		raw, sha := sealDoc(t, doc)
		_, err := parseAcceptR4ArtifactAgainst(raw, sha)
		require.Error(t, err)
		require.Contains(t, err.Error(), "EQUAL pin values")
	})
	t.Run("the REAL artifact passes every bar when present", func(t *testing.T) {
		p := os.Getenv(acceptR4Artifact)
		if p == "" {
			t.Skip("SOLVENT_ACCEPT_R4_ARTIFACT unset: the real-artifact identity check runs only where the secured artifact is available")
		}
		raw, err := os.ReadFile(filepath.Clean(p))
		require.NoError(t, err)
		tg, err := parseAcceptR4Artifact(raw)
		require.NoError(t, err)
		require.Len(t, tg.dm, acceptR4DMSubjects)
		require.Len(t, tg.census, acceptR4CensusSubjects)
	})
}
