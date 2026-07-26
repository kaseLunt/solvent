// Sample-selection tests (brief §10: "sampler determinism (same seed+rows ⇒
// same selection; shortfall redistribution)"). The rows here arrive in the
// order the SQL's ORDER BY produces — selection must be a pure function of
// that order.
package main

import (
	"crypto/md5"
	"encoding/hex"
	"fmt"
	"math/big"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/kaselunt/solvent/internal/store"
)

func mkRow(acct, stratum string, live bool, net int64, residue, fullyLiq bool) store.DMBorrowerRow {
	return store.DMBorrowerRow{
		AccountHex: acct, Stratum: stratum, Live: live,
		Net: big.NewInt(net), Residue: residue, FullyLiquidated: fullyLiq,
	}
}

// population builds n rows per stratum with deterministic fake ordering:
// live rows first (as the SQL orders), then zero-net rows.
func population(liqLive, liqZero, migLive, migZero, postLive, postZero int) []store.DMBorrowerRow {
	var rows []store.DMBorrowerRow
	add := func(stratum string, live int, zero int, tag string) {
		for i := 0; i < live; i++ {
			rows = append(rows, mkRow(fmt.Sprintf("%s%02d%036d", tag, i, 1), stratum, true, 100+int64(i), false, false))
		}
		for i := 0; i < zero; i++ {
			// Zero-net liquidated rows are fully-liquidated; every second
			// one carries residue history.
			rows = append(rows, mkRow(fmt.Sprintf("%s%02d%036d", tag, live+i, 0), stratum, false, 0,
				stratum == stratumLiquidated && i%2 == 0, stratum == stratumLiquidated))
		}
	}
	add(stratumLiquidated, liqLive, liqZero, "aa")
	add(stratumMigrated, migLive, migZero, "bb")
	add(stratumPostMigration, postLive, postZero, "cc")
	return rows
}

func TestSelectSampleQuotasAndLiveFirst(t *testing.T) {
	rows := population(6, 10, 12, 4, 20, 2)
	sel := selectSample(rows, 25, nil, nil)
	require.Len(t, sel.Accounts, 25)
	require.Equal(t, 9, sel.TakenPerStratum[stratumLiquidated])
	require.Equal(t, 8, sel.TakenPerStratum[stratumMigrated])
	require.Equal(t, 8, sel.TakenPerStratum[stratumPostMigration])
	// Liquidated: 6 live + 3 zero-net (phantom probes); live always first.
	liveLiq, zeroLiq := 0, 0
	for _, a := range sel.Accounts {
		if a.Row.Stratum == stratumLiquidated {
			if a.Row.Live {
				liveLiq++
			} else {
				zeroLiq++
			}
		}
	}
	require.Equal(t, 6, liveLiq)
	require.Equal(t, 3, zeroLiq)
	require.Empty(t, sel.Shortfalls)
}

func TestSelectSampleDeterminism(t *testing.T) {
	rows := population(6, 10, 12, 4, 20, 2)
	a := selectSample(rows, 25, forcedDMAnchors, nil)
	b := selectSample(rows, 25, forcedDMAnchors, nil)
	require.Equal(t, a, b, "same rows (same seed-ordered input) ⇒ byte-identical selection")
}

// TestSelectSampleResiduePriority: the liquidated stratum's zero-net
// portion takes fully-liquidated residue-bearing accounts FIRST until the
// ≥3 sub-target is met (deterministically), and the realized count is
// recorded.
func TestSelectSampleResiduePriority(t *testing.T) {
	rows := population(2, 12, 8, 0, 20, 0)
	sel := selectSample(rows, 25, nil, nil)
	require.GreaterOrEqual(t, sel.ResidueCount, residueTarget,
		"with residue-bearing rows available the sub-target must be met")
}

// TestSelectSampleResidueDegradesNeverFails (L0-9): an EMPTY residue class
// degrades to take-all-and-report — never a precondition failure.
func TestSelectSampleResidueDegradesNeverFails(t *testing.T) {
	var rows []store.DMBorrowerRow
	for i := 0; i < 12; i++ {
		rows = append(rows, mkRow(fmt.Sprintf("aa%038d", i), stratumLiquidated, true, 5, false, false))
	}
	rows = append(rows, population(0, 0, 12, 0, 12, 0)...)
	sel := selectSample(rows, 25, nil, nil)
	require.Zero(t, sel.ResidueCount)
	found := false
	for _, n := range sel.Notes {
		if strings.HasPrefix(n, "residue sub-target degraded") {
			found = true
		}
	}
	require.True(t, found, "the shortfall is REPORTED: %v", sel.Notes)
}

// TestSelectSampleShortfallRedistribution: an underpopulated stratum takes
// all its rows and the shortfall backfills from the other strata's next
// unused rows in fixed order liquidated→migrated→post_migration.
func TestSelectSampleShortfallRedistribution(t *testing.T) {
	rows := population(2, 1, 3, 0, 30, 5) // liquidated has 3 (quota 9), migrated 3 (quota 8)
	sel := selectSample(rows, 25, nil, nil)
	require.Len(t, sel.Accounts, 25, "shortfalls are redistributed, the floor holds")
	require.Equal(t, 6, sel.Shortfalls[stratumLiquidated])
	require.Equal(t, 5, sel.Shortfalls[stratumMigrated])
	// The backfill lands on post_migration (the only stratum with spare
	// rows): 8 quota + 11 backfill.
	require.Equal(t, 19, sel.TakenPerStratum[stratumPostMigration])
	require.NotEmpty(t, sel.Notes)
}

func TestSelectSampleForcedIncludesOnTopAndDeduped(t *testing.T) {
	rows := population(9, 0, 8, 0, 8, 0)
	// Force one account that quota selection ALREADY picked and one unknown.
	alreadyPicked := rows[0].AccountHex
	sel := selectSample(rows, 25, []string{alreadyPicked, forcedDMAnchors[0]}, []string{"deadbeefdeadbeefdeadbeefdeadbeefdeadbeef"})
	require.Len(t, sel.Accounts, 25+2, "forced accounts land ON TOP of quota; the dedup marks in place")
	byHex := map[string]selectedAccount{}
	for _, a := range sel.Accounts {
		byHex[a.Row.AccountHex] = a
	}
	require.True(t, byHex[alreadyPicked].Forced, "an already-selected forced account is MARKED, not duplicated")
	require.Equal(t, "quota", byHex[alreadyPicked].Source)
	require.True(t, byHex[forcedDMAnchors[0]].Forced)
	require.Equal(t, "unsampled", byHex[forcedDMAnchors[0]].Row.Stratum, "a forced account with no derived rows still runs (empty-set comparison)")
	require.True(t, byHex["deadbeefdeadbeefdeadbeefdeadbeefdeadbeef"].Forced)
	require.Equal(t, "include", byHex["deadbeefdeadbeefdeadbeefdeadbeefdeadbeef"].Source)
}

func TestQuotasForRaisesRoundRobin(t *testing.T) {
	q := quotasFor(25)
	require.Equal(t, map[string]int{stratumLiquidated: 9, stratumMigrated: 8, stratumPostMigration: 8}, q)
	q = quotasFor(30)
	require.Equal(t, 30, q[stratumLiquidated]+q[stratumMigrated]+q[stratumPostMigration])
	require.Equal(t, 11, q[stratumLiquidated], "extras distribute in fixed stratum order")
	require.Equal(t, 10, q[stratumMigrated])
	require.Equal(t, 9, q[stratumPostMigration])
}

func TestFileSampleBypassesSampling(t *testing.T) {
	rows := population(3, 0, 3, 0, 3, 0)
	dir := t.TempDir()
	path := filepath.Join(dir, "accounts.txt")
	content := "# replay list\n0x" + rows[0].AccountHex + "\n" + rows[4].AccountHex + "\n\n"
	require.NoError(t, os.WriteFile(path, []byte(content), 0o644))
	accounts, err := readAccountsFile(path)
	require.NoError(t, err)
	require.Len(t, accounts, 2)
	sel := fileSample(accounts, rows, path)
	require.Len(t, sel.Accounts, 2)
	require.Equal(t, "file", sel.Accounts[0].Source)
	require.Contains(t, sel.Notes[0], "BYPASSED")

	empty := filepath.Join(dir, "empty.txt")
	require.NoError(t, os.WriteFile(empty, []byte("# nothing\n"), 0o644))
	_, err = readAccountsFile(empty)
	require.Error(t, err, "an empty replay file is refused up front")
}

// TestOrderPopulationSeedOrderingSemantics pins the Go-side seed ordering
// (round-10 F5 — the ordering moved out of the SQL so the snapshot never
// needs an RPC-derived seed). The semantics are EXACTLY the previous
// ORDER BY: stratum ascending, live before zero-net, then ascending
// lowercase-hex md5(seed || accountHex) — verified against an explicitly
// computed digest — and the result is a pure function of (rows, seed):
// same seed reproduces, a different seed permutes within groups, and the
// input order never matters.
func TestOrderPopulationSeedOrderingSemantics(t *testing.T) {
	rows := population(3, 3, 2, 2, 2, 2)
	seedA, seedB := "0x77aa", "0x77ab"

	ordered := orderPopulation(rows, seedA)
	require.Len(t, ordered, len(rows))

	// Stratum-major, live-first inside each stratum.
	var groups []string
	for _, r := range ordered {
		groups = append(groups, fmt.Sprintf("%s/%v", r.Stratum, r.Live))
	}
	require.Equal(t, []string{
		"liquidated/true", "liquidated/true", "liquidated/true",
		"liquidated/false", "liquidated/false", "liquidated/false",
		"migrated/true", "migrated/true", "migrated/false", "migrated/false",
		"post_migration/true", "post_migration/true", "post_migration/false", "post_migration/false",
	}, groups)

	// The tie-break is the md5 hex digest, ascending — computed explicitly.
	md5hex := func(seed, acct string) string {
		sum := md5.Sum([]byte(seed + acct))
		return hex.EncodeToString(sum[:])
	}
	for i := 1; i < len(ordered); i++ {
		a, b := ordered[i-1], ordered[i]
		if a.Stratum == b.Stratum && a.Live == b.Live {
			require.Less(t, md5hex(seedA, a.AccountHex), md5hex(seedA, b.AccountHex),
				"within a (stratum, live) group the order IS the md5(seed||account) hex order")
		}
	}

	// Determinism + input-order independence.
	shuffled := make([]store.DMBorrowerRow, len(rows))
	copy(shuffled, rows)
	for i, j := range []int{5, 2, 9, 0, 13, 7, 1, 11, 3, 8, 12, 4, 10, 6} {
		shuffled[i] = rows[j]
	}
	require.Equal(t, ordered, orderPopulation(shuffled, seedA),
		"the ordering is a pure function of (set, seed) — retrieval order can never leak into the sample")
	require.Equal(t, ordered, orderPopulation(rows, seedA))

	// A different seed permutes within groups (the whole point of seeding).
	orderedB := orderPopulation(rows, seedB)
	require.NotEqual(t, ordered, orderedB, "a different seed must produce a different within-group order for this population")
}

// TestValidateReplaySelection pins the round-10 F2 replay validation: a
// -accounts file that misses the required size, a stratum's (population-
// bounded) quota, or a forced anchor produces TAINT strings; a replay
// meeting all three produces none; and an underpopulated stratum degrades
// the requirement exactly like sampling's take-all rule.
func TestValidateReplaySelection(t *testing.T) {
	rows := population(9, 3, 8, 2, 8, 2) // 32 accounts: quotas 9/8/8 fully satisfiable
	anchors := []string{rows[0].AccountHex, rows[12].AccountHex}

	full := fileSample(accountHexes(rows), rows, "replay.txt")
	require.Empty(t, validateReplaySelection(full, rows, 25, anchors),
		"a replay covering quotas and anchors is VALID — that is what makes -accounts usable for acceptance at all")

	// Missing anchor + too small + a stratum below quota.
	tiny := fileSample([]string{rows[0].AccountHex, rows[1].AccountHex}, rows, "replay.txt")
	v := validateReplaySelection(tiny, rows, 25, anchors)
	joined := strings.Join(v, "\n")
	require.Contains(t, joined, "required sample size 25")
	require.Contains(t, joined, "stratum migrated covered by 0")
	require.Contains(t, joined, "forced anchor "+rows[12].AccountHex+" missing")

	// Population-bounded degradation: a 4-account population cannot supply
	// 9/8/8, so replaying ALL of it is valid (take-all semantics).
	small := population(1, 1, 1, 0, 1, 0)
	all := fileSample(accountHexes(small), small, "replay.txt")
	require.Empty(t, validateReplaySelection(all, small, 25, []string{small[0].AccountHex}),
		"take-all over an underpopulated stratum satisfies the degraded quota, exactly like selectSample")
}

func accountHexes(rows []store.DMBorrowerRow) []string {
	out := make([]string, 0, len(rows))
	for _, r := range rows {
		out = append(out, r.AccountHex)
	}
	return out
}

func TestNormalizeAccountHex(t *testing.T) {
	h, err := normalizeAccountHex("0x0303A641B9255a4240e879c76efc704dc1c6383d")
	require.NoError(t, err)
	require.Equal(t, "0303a641b9255a4240e879c76efc704dc1c6383d", h)
	_, err = normalizeAccountHex("0x1234")
	require.Error(t, err)
	_, err = normalizeAccountHex("zz03a641b9255a4240e879c76efc704dc1c6383d")
	require.Error(t, err)
}
