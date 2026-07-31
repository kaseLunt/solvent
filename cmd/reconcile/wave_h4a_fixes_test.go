// Wave H4a regression tests — the Codex NOT-SHIP remedies on the H3 boolean
// law, each pinned by the designed mutant it must kill
// (testdata/mutation-transcripts/wave-h4a.md):
//
//	F2 (m1)  the never-swept race guard consumes the PER-GENERATION
//	         sweep-cycle witness, never the fleet's minimum historical
//	         success block. The failed-straggler regression: an account with
//	         an OLD success and recent failed attempts pins the fleet-min
//	         floor below every later arrival, so a borrower a later COMPLETED
//	         generation genuinely skipped classified "honest race" under the
//	         H3 shape — a pass-that-should-fail. It must GATE.
//	F3 (m2)  the retro live test is ARTIFACT-BOUND: the accept-r5 subjects
//	         and every expected value are parsed out of the retained
//	         artifact under the H2 bars (digest RECOMPUTED from the bytes,
//	         pins verified, exactly-2 completeness, duplicates refused).
//	         These are the parser's refusal tests — no live environment.
//	F4 (m3)  the S-clock param fold replays the FULL raw config ledger cut
//	         at S; filtering the COLLAPSED pin view (latest P-effective row
//	         per asset) cannot reconstruct S across a config update, a
//	         removal, or a removal+re-addition inside (S, P].
package main

import (
	"fmt"
	"math/big"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/kaselunt/solvent/cmd/reconcile/snapshotdb"
	"github.com/kaselunt/solvent/internal/store"
)

// --- F2: the failed-straggler regression (m1 kill) ---------------------------

// TestNeverSweptFailedStragglerGates is Codex F2's exact scenario, end to end
// through classifySweepTestimony:
//
//   - a STRAGGLER holds an old success at block 100 (its pin-visible
//     watermark) but its recent attempts FAILED — under the Wave-H3 law that
//     stale success pinned the fleet-min floor at 100;
//   - a borrower arrives at block 200;
//   - generation 7 OPENED at ~250 (after the arrival), COMPLETED at ~280
//     (below the pin), and still never read the borrower.
//
// H3 verdict: fleetMin(100) <= firstDebt(200) => "honest race", disclosed —
// and one such row passes the 1% census. A pass-that-should-fail.
// H4a verdict: the per-generation witness shows the last pin-completed cycle
// opened ABOVE the arrival edge => sweeper defect, GATED.
func TestNeverSweptFailedStragglerGates(t *testing.T) {
	const pin = uint64(1000)
	straggler := "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
	sweptPeer := "cccccccccccccccccccccccccccccccccccccccc"
	borrower := "d1fdf1bcb29d8709d1b2b82cc108d2a0755f8ce9"

	c := &p3Ctx{pinOP: pin, o: &options{}}
	t6 := &snapshotdb.Task6Data{
		DMSweepByAccount: map[string]snapshotdb.T6SweepState{
			// The straggler: old success at 100 still pin-visible, latest
			// attempt (generation 7, block 260) FAILED. Under H3 its stale
			// success WAS the fleet floor.
			straggler: {AtOrBelowPin: 100, Newest: 100, LegsAtOrBelowPin: 1, Status: "failed", Attempted: true},
			// A healthy peer generation 7 swept at 270.
			sweptPeer: {AtOrBelowPin: 270, Newest: 270, LegsAtOrBelowPin: 1, Status: "success", Attempted: true},
		},
		DMFirstDebtBlock: map[string]uint64{borrower: 200},
		DMSweepCycles: snapshotdb.T6SweepCycles{
			Read: true, HaveGenerationRow: true,
			CurrentGeneration: 7, CurrentCompleted: true,
			Generations: map[uint64]snapshotdb.T6GenerationSpan{
				// Generation 7's witnessed attempts: [250, 280] — opened
				// after the borrower arrived, completed below the pin.
				7: {MinAttemptBlock: 250, MaxAttemptBlock: 280, Rows: 2},
			},
		},
	}
	borrowers := map[string]*big.Int{
		straggler: big.NewInt(1),
		sweptPeer: big.NewInt(1),
		borrower:  big.NewInt(40310720),
	}

	// The H3 arithmetic, reconstructed for the record: the fleet-min floor the
	// straggler's stale success produces sits BELOW the arrival edge, so the
	// old law would have disclosed this borrower as an honest race.
	fleetMin := uint64(0)
	for _, st := range t6.DMSweepByAccount {
		if st.AtOrBelowPin > 0 && (fleetMin == 0 || st.AtOrBelowPin < fleetMin) {
			fleetMin = st.AtOrBelowPin
		}
	}
	require.Equal(t, uint64(100), fleetMin)
	require.LessOrEqual(t, fleetMin, uint64(200),
		"the H3 predicate (fleetMin <= firstDebt) holds: the old law FALSE-PASSES exactly this shape")

	rows, excluded := classifySweepTestimony(c, nil, t6, borrowers, nil)
	require.True(t, excluded[borrower])
	var r *p3Row
	for i := range rows {
		if rows[i].Subject == "0x"+borrower && rows[i].Leg == "collateral-testimony-at-pin" {
			r = &rows[i]
		}
	}
	require.NotNil(t, r)
	require.True(t, r.Gated,
		"m1 kill: generation 7 opened after this borrower arrived, completed below the pin, and skipped it — a sweeper defect. The fleet-min shape disclosed it as an honest race (the F2 false-pass)")
	require.Equal(t, sweepNever, r.Class)
	require.NotContains(t, r.Class, "coverage-gap")
	require.Contains(t, r.Evidence["cycle_witness"], "GATE",
		"the receipt states why the race is not claimable")
	require.Equal(t, 1, tallyP3(rows), "exactly one gated failure: the skipped borrower")
}

// --- F3: the retro parser's artifact bars (m2 kill) --------------------------

// acceptR5SyntheticDoc builds a minimal accept-r5-shaped artifact that PASSES
// every bar once sealed: both pins, exactly 2 boolean-drift subjects, each
// with its sample-gap maxBorrow companion (S + own_clock_hash evidence) and
// its exact borrowingOf companion.
func acceptR5SyntheticDoc() map[string]any {
	subjects := []string{
		"0xAAaa000000000000000000000000000000000a01",
		"0xBBbb000000000000000000000000000000000B02",
	}
	rows := make([]map[string]any, 0, 3*len(subjects))
	for i, s := range subjects {
		rows = append(rows,
			map[string]any{
				"gate": gateDMBoolean, "subject": s, "leg": "liquidatable(strict >)",
				"verdict": verdictDrift, "expected_chain": "false", "actual_derived": "true",
				"evidence": map[string]any{"margin_usd6": fmt.Sprintf("%d", 15075555+i)},
			},
			map[string]any{
				"gate": gateDMBoolean, "subject": s, "leg": "getMaxBorrowAmount(user,false)",
				"verdict":        verdictSampleGap,
				"expected_chain": fmt.Sprintf("%d", 53950439+i), "actual_derived": fmt.Sprintf("%d", 21858263+i),
				"evidence": map[string]any{
					"sweep_block":    fmt.Sprintf("%d", 154961846+uint64(i)),
					"own_clock_hash": "0x" + strings.Repeat(fmt.Sprintf("%02x", 0x9c+i), 32),
				},
			},
			map[string]any{
				"gate": gateDMBoolean, "subject": s, "leg": "borrowingOf(user).total",
				"verdict":        verdictExact,
				"expected_chain": fmt.Sprintf("%d", 36933818+i), "actual_derived": fmt.Sprintf("%d", 36933818+i),
			},
		)
	}
	return map[string]any{
		"comparison_sha256": h3RetroComparisonSHA, // copied verbatim — the recompute bar must refuse this
		"status":            "aborted: recheck",
		"pins": []map[string]any{
			{"chain": "op", "block": h3RetroPinOP, "hash": h3RetroHashOP},
			{"chain": "eth", "block": h3RetroPinETH, "hash": h3RetroHashETH},
		},
		"p3_task6": map[string]any{"rows": rows},
	}
}

func acceptR5Rows(doc map[string]any) []map[string]any {
	return doc["p3_task6"].(map[string]any)["rows"].([]map[string]any)
}

// TestAcceptR5RetroParserBarsRefuse is the m2 kill: dropping the artifact
// binding (the digest recompute, the completeness equality, the uniqueness
// bar) leaves each of these fixtures parsing — and each must refuse.
func TestAcceptR5RetroParserBarsRefuse(t *testing.T) {
	t.Run("the sealed synthetic doc parses and every value is DERIVED", func(t *testing.T) {
		raw, sha := sealDoc(t, acceptR5SyntheticDoc())
		subs, err := parseAcceptR5RetroSubjectsAgainst(raw, sha)
		require.NoError(t, err)
		require.Len(t, subs, h3RetroSubjectCount)
		require.Equal(t, hexLower("0xAAaa000000000000000000000000000000000a01"), hexLower(subs[0].addr))
		require.True(t, subs[0].servedLiq)
		require.False(t, subs[0].chainLiq)
		require.Equal(t, "15075555", subs[0].margin)
		require.Equal(t, uint64(154961846), subs[0].sweep)
		require.Equal(t, "0x"+strings.Repeat("9c", 32), subs[0].sweepHex)
		require.Equal(t, "53950439", subs[0].chainMax)
		require.Equal(t, "21858263", subs[0].oursMax)
		require.Equal(t, "36933818", subs[0].debtPin)
	})
	t.Run("a wrong digest FAILS (m2 kill: the copied-digest substitute)", func(t *testing.T) {
		// The unsealed doc wears the RECORDED accept-r5 digest verbatim; the
		// recompute bar must refuse it — no self-report is ever trusted.
		_, perr := parseAcceptR5RetroSubjects(marshalDoc(t, acceptR5SyntheticDoc()))
		require.Error(t, perr, "a substitute wearing the copied accept-r5 digest must refuse")
		require.Contains(t, perr.Error(), "recomputed comparison hash")
	})
	t.Run("a mutated row under a STALE digest FAILS", func(t *testing.T) {
		doc := acceptR5SyntheticDoc()
		raw, sha := sealDoc(t, doc)
		acceptR5Rows(doc)[1]["actual_derived"] = "999999" // doctor the maxBorrow companion AFTER sealing
		mutated := marshalDoc(t, doc)
		require.NotEqual(t, raw, mutated)
		_, perr := parseAcceptR5RetroSubjectsAgainst(mutated, sha)
		require.Error(t, perr, "a doctored row under a stale digest must refuse")
		require.Contains(t, perr.Error(), "recomputed comparison hash")
	})
	t.Run("a duplicate subject FAILS", func(t *testing.T) {
		doc := acceptR5SyntheticDoc()
		rows := acceptR5Rows(doc)
		rows[3] = rows[0] // the second subject's boolean row becomes a copy of the first's
		raw, sha := sealDoc(t, doc)
		_, err := parseAcceptR5RetroSubjectsAgainst(raw, sha)
		require.Error(t, err)
		require.Contains(t, err.Error(), "duplicate")
	})
	t.Run("a truncated subject set FAILS", func(t *testing.T) {
		doc := acceptR5SyntheticDoc()
		doc["p3_task6"].(map[string]any)["rows"] = acceptR5Rows(doc)[3:] // drop subject 1 entirely: 1/2
		raw, sha := sealDoc(t, doc)
		_, err := parseAcceptR5RetroSubjectsAgainst(raw, sha)
		require.Error(t, err, "one cherry-picked account is not the accept-r5 population")
		require.Contains(t, err.Error(), "COMPLETENESS failed")
	})
	t.Run("a padded subject set FAILS", func(t *testing.T) {
		doc := acceptR5SyntheticDoc()
		rows := acceptR5Rows(doc)
		extra := map[string]any{
			"gate": gateDMBoolean, "subject": "0xCCcc000000000000000000000000000000000C03",
			"leg": "liquidatable(strict >)", "verdict": verdictDrift,
			"expected_chain": "false", "actual_derived": "true",
			"evidence": map[string]any{"margin_usd6": "1"},
		}
		doc["p3_task6"].(map[string]any)["rows"] = append(rows, extra)
		raw, sha := sealDoc(t, doc)
		_, err := parseAcceptR5RetroSubjectsAgainst(raw, sha)
		require.Error(t, err)
		require.Contains(t, err.Error(), "COMPLETENESS failed")
	})
	t.Run("a drifted pin FAILS", func(t *testing.T) {
		doc := acceptR5SyntheticDoc()
		doc["pins"] = []map[string]any{
			{"chain": "op", "block": h3RetroPinOP + 1, "hash": h3RetroHashOP},
			{"chain": "eth", "block": h3RetroPinETH, "hash": h3RetroHashETH},
		}
		raw, sha := sealDoc(t, doc)
		_, err := parseAcceptR5RetroSubjectsAgainst(raw, sha)
		require.Error(t, err)
		require.Contains(t, err.Error(), "ARTIFACT IDENTITY failed")
	})
	t.Run("a missing pin FAILS", func(t *testing.T) {
		doc := acceptR5SyntheticDoc()
		doc["pins"] = []map[string]any{
			{"chain": "op", "block": h3RetroPinOP, "hash": h3RetroHashOP},
		}
		raw, sha := sealDoc(t, doc)
		_, err := parseAcceptR5RetroSubjectsAgainst(raw, sha)
		require.Error(t, err)
		require.Contains(t, err.Error(), "both accept-r5 pins")
	})
	t.Run("a missing companion leg FAILS", func(t *testing.T) {
		doc := acceptR5SyntheticDoc()
		rows := acceptR5Rows(doc)
		doc["p3_task6"].(map[string]any)["rows"] = rows[:len(rows)-1] // drop subject 1's borrowingOf row
		raw, sha := sealDoc(t, doc)
		_, err := parseAcceptR5RetroSubjectsAgainst(raw, sha)
		require.Error(t, err, "every expected value must come from the artifact — a subject without its companion legs cannot be classified")
		require.Contains(t, err.Error(), "companion")
	})
	t.Run("a non-flip boolean row FAILS", func(t *testing.T) {
		doc := acceptR5SyntheticDoc()
		acceptR5Rows(doc)[0]["expected_chain"] = "true" // equal booleans: not a flip
		raw, sha := sealDoc(t, doc)
		_, err := parseAcceptR5RetroSubjectsAgainst(raw, sha)
		require.Error(t, err)
		require.Contains(t, err.Error(), "EQUAL booleans")
	})
	t.Run("a maxBorrow companion without the sample-gap certificate FAILS", func(t *testing.T) {
		doc := acceptR5SyntheticDoc()
		acceptR5Rows(doc)[1]["verdict"] = "snapshot-custody-drift"
		raw, sha := sealDoc(t, doc)
		_, err := parseAcceptR5RetroSubjectsAgainst(raw, sha)
		require.Error(t, err, "the motion premise needs the artifact's own sample-gap certificate")
		require.Contains(t, err.Error(), verdictSampleGap)
	})
	t.Run("the REAL retained artifact passes every bar when present", func(t *testing.T) {
		p := os.Getenv(h3RetroArtifactEnv)
		if p == "" {
			t.Skip("SOLVENT_ACCEPT_R5_ARTIFACT unset: the real-artifact identity check runs only where the retained artifact is available")
		}
		raw, err := os.ReadFile(filepath.Clean(p))
		require.NoError(t, err)
		subs, perr := parseAcceptR5RetroSubjects(raw)
		require.NoError(t, perr)
		require.Len(t, subs, h3RetroSubjectCount)
		for _, s := range subs {
			t.Logf("bound subject %s: served=%v chain@P=%v margin=%s S=%d chainMax@P=%s oursMax@P=%s debt@P=%s",
				s.addr, s.servedLiq, s.chainLiq, s.margin, s.sweep, s.chainMax, s.oursMax, s.debtPin)
		}
	})
}

// --- F4: the S-clock param fold transition tests (m3 kill) -------------------

func h4aParamEvent(assetHex, eventType string, block uint64, logIndex uint32, lt int64) snapshotdb.T6DMParamEvent {
	e := snapshotdb.T6DMParamEvent{
		ChainID: 10, AssetHex: assetHex, EventType: eventType,
		Block: block, LogIndex: logIndex, TxHashHex: strings.Repeat("ab", 32),
	}
	if eventType == "collateral_token_config_set" {
		e.LTV = big.NewInt(lt - 5)
		e.LiqThreshold = big.NewInt(lt)
		e.LiqBonus = big.NewInt(5)
	}
	return e
}

// collapsedFilterAtS emulates the Wave-H3 defect for contrast: the COLLAPSED
// pin view (dmParamsAtBlock at P reproduces store.DMParamsAsOf(P)'s
// latest-wins-per-asset output) filtered by EffectiveBlock <= S.
func collapsedFilterAtS(ledger []snapshotdb.T6DMParamEvent, p, s uint64) []store.ParamRow {
	var out []store.ParamRow
	for _, r := range dmParamsAtBlock(ledger, p) {
		if r.EffectiveBlock <= s {
			out = append(out, r)
		}
	}
	return out
}

// TestDMParamsAtBlockReconstructsS is the m3 kill: each transition arm shows
// the raw-ledger fold at S producing the true S-effective config while the
// collapsed filter produces the WRONG one — so reverting the S weld's fold to
// the collapsed filter fails here before it can mis-reject a live run.
func TestDMParamsAtBlockReconstructsS(t *testing.T) {
	const (
		assetA = "0b2c639c533813f4aa9d7837caf62653d097ff85"
		s      = uint64(300)
		p      = uint64(600)
	)

	t.Run("config UPDATE between S and P", func(t *testing.T) {
		ledger := []snapshotdb.T6DMParamEvent{
			h4aParamEvent(assetA, "collateral_token_config_set", 100, 1, 60),
			h4aParamEvent(assetA, "collateral_token_config_set", 500, 2, 80), // ordinary parameter motion inside (S, P]
		}
		atS := dmParamsAtBlock(ledger, s)
		require.Len(t, atS, 1, "the asset IS configured at S")
		require.Equal(t, uint64(100), atS[0].EffectiveBlock)
		require.Equal(t, int64(60), atS[0].LiqThreshold.Int64(),
			"the S-effective threshold is the block-100 row, not the block-500 one")

		require.Empty(t, collapsedFilterAtS(ledger, p, s),
			"m3 kill: the collapsed pin view keeps ONLY the block-500 row, so filtering it at S=300 loses the asset entirely — the honest S weld would read the config as ABSENT during ordinary parameter motion (F4's wrong rejection)")

		atP := dmParamsAtBlock(ledger, p)
		require.Len(t, atP, 1)
		require.Equal(t, int64(80), atP[0].LiqThreshold.Int64(), "the pin fold is unchanged")
	})

	t.Run("REMOVAL between S and P", func(t *testing.T) {
		ledger := []snapshotdb.T6DMParamEvent{
			h4aParamEvent(assetA, "collateral_token_config_set", 100, 1, 60),
			h4aParamEvent(assetA, "collateral_token_removed", 400, 2, 0),
		}
		atS := dmParamsAtBlock(ledger, s)
		require.Len(t, atS, 1, "the asset was still configured at S — the removal is above S")
		require.Equal(t, int64(60), atS[0].LiqThreshold.Int64())

		require.Empty(t, dmParamsAtBlock(ledger, p), "removed at P")
		require.Empty(t, collapsedFilterAtS(ledger, p, s),
			"m3 kill: the collapsed view has nothing to filter (the asset is removed at P), so S reads absent — wrong")
	})

	t.Run("removal + RE-ADDITION straddling S", func(t *testing.T) {
		ledger := []snapshotdb.T6DMParamEvent{
			h4aParamEvent(assetA, "collateral_token_config_set", 100, 1, 60),
			h4aParamEvent(assetA, "collateral_token_removed", 200, 2, 0),
			h4aParamEvent(assetA, "collateral_token_added", 400, 3, 0),
		}
		require.Empty(t, dmParamsAtBlock(ledger, s),
			"at S=300 the asset is REMOVED (removed at 200, re-added only at 400)")

		atP := dmParamsAtBlock(ledger, p)
		require.Len(t, atP, 1, "re-addition REVIVES the pre-removal config row (the store's own semantics)")
		require.Equal(t, uint64(100), atP[0].EffectiveBlock)

		got := collapsedFilterAtS(ledger, p, s)
		require.Len(t, got, 1,
			"m3 kill, the OTHER direction: the collapsed view carries the revived block-100 row, so the filter RESURRECTS the asset at S=300 where the chain had it removed")
	})

	t.Run("re-addition visible once S passes it", func(t *testing.T) {
		ledger := []snapshotdb.T6DMParamEvent{
			h4aParamEvent(assetA, "collateral_token_config_set", 100, 1, 60),
			h4aParamEvent(assetA, "collateral_token_removed", 200, 2, 0),
			h4aParamEvent(assetA, "collateral_token_added", 400, 3, 0),
		}
		at450 := dmParamsAtBlock(ledger, 450)
		require.Len(t, at450, 1)
		require.Equal(t, int64(60), at450[0].LiqThreshold.Int64())
	})
}

// TestDMFoldParamsAtSRefusesWithoutTheRawLedger: the weld path refuses a
// Task6 snapshot without the raw ledger instead of falling back to the
// collapsed filter — the fallback IS the F4 defect.
func TestDMFoldParamsAtSRefusesWithoutTheRawLedger(t *testing.T) {
	_, err := dmFoldParamsAtS(nil, 100)
	require.Error(t, err)

	// A fixture carrying ONLY the collapsed pin view must refuse, not degrade.
	stale := &snapshotdb.Task6Data{DMParams: []store.ParamRow{{
		Engine: dmEngine, ChainID: 10,
		Asset:          make([]byte, 20),
		LiqThreshold:   big.NewInt(80),
		EffectiveBlock: 500,
	}}}
	_, err = dmFoldParamsAtS(stale, 300)
	require.Error(t, err)
	require.Contains(t, err.Error(), "collapsed")

	ledger := []snapshotdb.T6DMParamEvent{
		h4aParamEvent("0b2c639c533813f4aa9d7837caf62653d097ff85", "collateral_token_config_set", 100, 1, 60),
		h4aParamEvent("0b2c639c533813f4aa9d7837caf62653d097ff85", "collateral_token_config_set", 500, 2, 80),
	}
	folded, err := dmFoldParamsAtS(&snapshotdb.Task6Data{DMParamLedger: ledger, DMParamLedgerRead: true}, 300)
	require.NoError(t, err)
	require.Len(t, folded, 1)
	require.Equal(t, int64(60), folded[0].LiqThreshold.Int64(),
		"the S fold carries the S-effective threshold through riskfeed.FoldParams — the ONE fold implementation")
}
