// Deterministic sample selection (brief §2). The SQL
// (store.SampleDMBorrowers) CLASSIFIES the whole borrower population inside
// the snapshot in a seed-free deterministic order; orderPopulation below
// applies the md5(seed||account) ordering IN GO (round-10 F5: the default
// seed is the OP pin hash — an RPC fact — and no network call may run while
// the repeatable-read snapshot is open, so the seed ordering happens after
// commit). Selection is a pure function of that row order, so the composite
// stays reproducible end to end: same pin + same seed ⇒ byte-identical
// sample ⇒ byte-identical comparison sections.
package main

import (
	"bufio"
	"crypto/md5"
	"encoding/hex"
	"fmt"
	"os"
	"sort"
	"strings"

	"github.com/kaselunt/solvent/internal/store"
)

// orderPopulation applies the §2 seed ordering with EXACTLY the previous
// SQL semantics (ORDER BY stratum, (net <> 0) DESC, md5(seed || account)):
// stratum ascending (bytewise: liquidated < migrated < post_migration),
// live before zero-net inside each stratum, then ascending lowercase-hex
// md5 of seed||accountHex — the same digest text PostgreSQL's md5() sorts.
// Input order does not matter (the sort key is total); the SQL's seed-free
// retrieval order only exists so the snapshot never needs the seed.
func orderPopulation(rows []store.DMBorrowerRow, seed string) []store.DMBorrowerRow {
	out := make([]store.DMBorrowerRow, len(rows))
	copy(out, rows)
	digest := make(map[string]string, len(rows))
	for _, r := range rows {
		sum := md5.Sum([]byte(seed + r.AccountHex))
		digest[r.AccountHex] = hex.EncodeToString(sum[:])
	}
	sort.SliceStable(out, func(i, j int) bool {
		if out[i].Stratum != out[j].Stratum {
			return out[i].Stratum < out[j].Stratum
		}
		if out[i].Live != out[j].Live {
			return out[i].Live
		}
		return digest[out[i].AccountHex] < digest[out[j].AccountHex]
	})
	return out
}

// Strata names (the SQL's disjoint precedence partition: liquidated >
// migrated > post_migration).
const (
	stratumLiquidated    = "liquidated"
	stratumMigrated      = "migrated"
	stratumPostMigration = "post_migration"
)

// Base quotas: 9 liquidated / 8 migrated / 8 post_migration = 25 floor
// (`-sample` raises, never lowers). Extra capacity beyond 25 is distributed
// round-robin in the fixed stratum order.
var baseQuotas = map[string]int{
	stratumLiquidated:    9,
	stratumMigrated:      8,
	stratumPostMigration: 8,
}

// stratumOrder is the fixed order for quota top-up and shortfall backfill.
var stratumOrder = []string{stratumLiquidated, stratumMigrated, stratumPostMigration}

// residueTarget: prefer ≥3 fully-liquidated accounts with residue_zeroed
// history in the sample — degrade to take-all-and-report-shortfall, NEVER
// exit 2 (L0-9: the class may be empty on real data).
const residueTarget = 3

// liveTarget: prefer ≥15 of 25 live (nonzero net) accounts; realized counts
// are recorded, not gated.
const liveTarget = 15

// selectedAccount is one sample member with its provenance.
type selectedAccount struct {
	Row    store.DMBorrowerRow
	Forced bool   // on top of quota (DM anchors, liquidation Safe, -include)
	Source string // "quota" | "backfill" | "forced" | "include" | "file"
}

// sampleSelection is the deterministic selection outcome; everything a
// reviewer needs to audit the sample lands in the artifact.
type sampleSelection struct {
	Accounts        []selectedAccount
	Quotas          map[string]int
	TakenPerStratum map[string]int
	Shortfalls      map[string]int
	LiveCount       int
	ZeroCount       int
	ResidueCount    int
	Notes           []string
}

// quotasFor computes per-stratum quotas for a total sample floor of n
// (n ≥ 25 enforced by flag validation; extras round-robin in fixed order).
func quotasFor(n int) map[string]int {
	q := map[string]int{}
	for s, v := range baseQuotas {
		q[s] = v
	}
	extra := n - 25
	for i := 0; extra > 0; i++ {
		q[stratumOrder[i%len(stratumOrder)]]++
		extra--
	}
	return q
}

// selectSample is the §2 selection: per stratum take live (nonzero net)
// first, then zero-net (phantom-debt probes — the view must return the empty
// set for them); within the liquidated stratum's zero-net portion,
// residue-bearing fully-liquidated accounts are taken FIRST until the
// residue sub-target is met (deterministic: row order within each group is
// orderPopulation's md5(seed||account) order). An underpopulated stratum takes all
// its rows; the shortfall is backfilled from the other strata's next unused
// rows in fixed order liquidated→migrated→post_migration, and both the
// shortfall and the redistribution are recorded.
//
// forced and includes are hex addresses (no 0x, lowercase enforced by
// normalizeAccountHex) appended on top of quota with Forced=true; accounts
// already selected by quota are only MARKED forced, never duplicated.
func selectSample(rows []store.DMBorrowerRow, total int, forced, includes []string) sampleSelection {
	sel := sampleSelection{
		Quotas:          quotasFor(total),
		TakenPerStratum: map[string]int{},
		Shortfalls:      map[string]int{},
	}
	byStratum := map[string][]store.DMBorrowerRow{}
	for _, r := range rows {
		byStratum[r.Stratum] = append(byStratum[r.Stratum], r)
	}

	picked := map[string]int{} // accountHex -> index into sel.Accounts
	take := func(r store.DMBorrowerRow, source string) {
		if _, dup := picked[r.AccountHex]; dup {
			return
		}
		picked[r.AccountHex] = len(sel.Accounts)
		sel.Accounts = append(sel.Accounts, selectedAccount{Row: r, Source: source})
		sel.TakenPerStratum[r.Stratum]++
	}

	// Pass 1: per-stratum quota fill, live first, then zero-net; residue
	// priority inside liquidated's zero-net portion.
	used := map[string]int{} // per stratum: how many rows consumed by quota fill
	for _, stratum := range stratumOrder {
		quota := sel.Quotas[stratum]
		pool := byStratum[stratum]
		var live, zero []store.DMBorrowerRow
		for _, r := range pool {
			if r.Live {
				live = append(live, r)
			} else {
				zero = append(zero, r)
			}
		}
		if stratum == stratumLiquidated {
			// Residue priority: fully-liquidated accounts WITH
			// residue_zeroed history first among the zero-net probes, until
			// the sub-target is met; order within each class is preserved.
			var withResidue, without []store.DMBorrowerRow
			for _, r := range zero {
				if r.FullyLiquidated && r.Residue {
					withResidue = append(withResidue, r)
				} else {
					without = append(without, r)
				}
			}
			if len(withResidue) > residueTarget {
				without = append(withResidue[residueTarget:], without...)
				withResidue = withResidue[:residueTarget]
			}
			zero = append(withResidue, without...)
		}
		taken := 0
		for _, r := range live {
			if taken >= quota {
				break
			}
			take(r, "quota")
			taken++
		}
		for _, r := range zero {
			if taken >= quota {
				break
			}
			take(r, "quota")
			taken++
		}
		used[stratum] = taken
		if taken < quota {
			sel.Shortfalls[stratum] = quota - taken
			sel.Notes = append(sel.Notes, fmt.Sprintf(
				"stratum %s underpopulated: quota %d, took all %d rows; shortfall %d backfilled in fixed order",
				stratum, quota, taken, quota-taken))
		}
	}

	// Pass 2: shortfall backfill from other strata's next unused rows, in
	// fixed order (deterministic — the pools keep the SQL's ordering).
	shortfall := 0
	for _, s := range stratumOrder {
		shortfall += sel.Shortfalls[s]
	}
	for _, stratum := range stratumOrder {
		if shortfall == 0 {
			break
		}
		pool := byStratum[stratum]
		for _, r := range pool {
			if shortfall == 0 {
				break
			}
			if _, dup := picked[r.AccountHex]; dup {
				continue
			}
			take(r, "backfill")
			shortfall--
		}
	}
	if shortfall > 0 {
		sel.Notes = append(sel.Notes, fmt.Sprintf(
			"population smaller than requested sample: %d slots unfilled after take-all", shortfall))
	}

	// Pass 3: forced includes on top of quota (deduped; an already-selected
	// account is marked forced in place).
	rowByHex := map[string]store.DMBorrowerRow{}
	for _, r := range rows {
		rowByHex[r.AccountHex] = r
	}
	addForced := func(hexAddr, source string) {
		if idx, dup := picked[hexAddr]; dup {
			sel.Accounts[idx].Forced = true
			return
		}
		r, known := rowByHex[hexAddr]
		if !known {
			// A forced account with no derived events still runs: the DB
			// side is the empty set and the chain view must agree.
			r = store.DMBorrowerRow{AccountHex: hexAddr, Stratum: "unsampled", Net: bigZero()}
			sel.Notes = append(sel.Notes, fmt.Sprintf(
				"forced account %s has no debt-side position_events rows at the pin (stratum=unsampled)", hexAddr))
		}
		picked[hexAddr] = len(sel.Accounts)
		sel.Accounts = append(sel.Accounts, selectedAccount{Row: r, Forced: true, Source: source})
		if known {
			sel.TakenPerStratum[r.Stratum]++
		}
	}
	for _, f := range forced {
		addForced(f, "forced")
	}
	for _, inc := range includes {
		addForced(inc, "include")
	}

	for _, a := range sel.Accounts {
		if a.Row.Live {
			sel.LiveCount++
		} else {
			sel.ZeroCount++
		}
		if a.Row.FullyLiquidated && a.Row.Residue {
			sel.ResidueCount++
		}
	}
	if sel.ResidueCount < residueTarget {
		sel.Notes = append(sel.Notes, fmt.Sprintf(
			"residue sub-target degraded: %d of preferred %d fully-liquidated accounts with residue_zeroed history exist in the sample (take-all-and-report, never a precondition failure)",
			sel.ResidueCount, residueTarget))
	}
	if sel.LiveCount < liveTarget {
		sel.Notes = append(sel.Notes, fmt.Sprintf(
			"live target degraded: %d of preferred %d live accounts (recorded, not gated)",
			sel.LiveCount, liveTarget))
	}
	return sel
}

// readAccountsFile loads -accounts FILE (one hex address per line, comments
// with '#') into normalized hex, deduped in file order. Split from the
// selection step (round-10 F5): the file is read BEFORE the snapshot opens
// so its accounts join the snapshot's read set, and the selection runs
// after commit against the classified population.
func readAccountsFile(path string) ([]string, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, fmt.Errorf("open -accounts file: %w", err)
	}
	defer f.Close()
	var out []string
	seen := map[string]bool{}
	sc := bufio.NewScanner(f)
	for sc.Scan() {
		line := strings.TrimSpace(sc.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		hexAddr, err := normalizeAccountHex(line)
		if err != nil {
			return nil, fmt.Errorf("-accounts file line %q: %w", line, err)
		}
		if seen[hexAddr] {
			continue
		}
		seen[hexAddr] = true
		out = append(out, hexAddr)
	}
	if err := sc.Err(); err != nil {
		return nil, fmt.Errorf("read -accounts file: %w", err)
	}
	if len(out) == 0 {
		return nil, fmt.Errorf("-accounts file %s contains no accounts", path)
	}
	return out, nil
}

// fileSample builds the -accounts replay selection from pre-read accounts:
// exact replay, BYPASSES sampling entirely, recorded in the artifact — and
// VALIDATED against the acceptance census requirements by
// validateReplaySelection (round-10 F2), whose violations taint the verdict.
func fileSample(accounts []string, rows []store.DMBorrowerRow, path string) sampleSelection {
	rowByHex := map[string]store.DMBorrowerRow{}
	for _, r := range rows {
		rowByHex[r.AccountHex] = r
	}
	sel := sampleSelection{
		Quotas:          map[string]int{},
		TakenPerStratum: map[string]int{},
		Shortfalls:      map[string]int{},
		Notes:           []string{"sampling BYPASSED: exact account list replay from " + path},
	}
	for _, hexAddr := range accounts {
		r, known := rowByHex[hexAddr]
		if !known {
			r = store.DMBorrowerRow{AccountHex: hexAddr, Stratum: "unsampled", Net: bigZero()}
		}
		sel.Accounts = append(sel.Accounts, selectedAccount{Row: r, Source: "file"})
		sel.TakenPerStratum[r.Stratum]++
		if r.Live {
			sel.LiveCount++
		} else {
			sel.ZeroCount++
		}
	}
	return sel
}

// validateReplaySelection checks a -accounts replay against the census
// discipline sampling itself enforces (round-10 F2: "-accounts replay that
// fails quota/strata/forced-anchor validation" must not back acceptance):
//
//   - required sample size: at least min(sample floor, population size);
//   - strata coverage: each stratum must carry at least
//     min(quota, stratum population) accounts — the same
//     take-all-when-underpopulated degradation selectSample applies, so a
//     replay of a legitimately degraded sample still validates;
//   - forced anchors: every forced DM anchor must be present.
//
// Violations are returned as TAINT strings; computeResult consumes them, so
// a failing replay is structurally non-pass (result "tainted", exit 1).
func validateReplaySelection(sel sampleSelection, population []store.DMBorrowerRow, sampleFloor int, forced []string) []string {
	var v []string
	popByStratum := map[string]int{}
	for _, r := range population {
		popByStratum[r.Stratum]++
	}
	have := map[string]int{}
	haveAcct := map[string]bool{}
	for _, a := range sel.Accounts {
		have[a.Row.Stratum]++
		haveAcct[a.Row.AccountHex] = true
	}
	requiredTotal := sampleFloor
	if len(population) < requiredTotal {
		requiredTotal = len(population)
	}
	if len(sel.Accounts) < requiredTotal {
		v = append(v, fmt.Sprintf("-accounts replay: %d accounts, required sample size %d (population %d)",
			len(sel.Accounts), requiredTotal, len(population)))
	}
	quotas := quotasFor(sampleFloor)
	for _, s := range stratumOrder {
		req := quotas[s]
		if popByStratum[s] < req {
			req = popByStratum[s]
		}
		if have[s] < req {
			v = append(v, fmt.Sprintf("-accounts replay: stratum %s covered by %d account(s), quota requires %d (stratum population %d)",
				s, have[s], req, popByStratum[s]))
		}
	}
	for _, f := range forced {
		if !haveAcct[f] {
			v = append(v, fmt.Sprintf("-accounts replay: forced anchor %s missing", f))
		}
	}
	return v
}

// normalizeAccountHex canonicalizes a 20-byte hex address (with or without
// 0x) to lowercase no-prefix — the sample key format everywhere.
func normalizeAccountHex(s string) (string, error) {
	s = strings.ToLower(strings.TrimPrefix(strings.TrimSpace(s), "0x"))
	if len(s) != 40 {
		return "", fmt.Errorf("%q is not a 20-byte hex address", s)
	}
	for _, c := range s {
		if (c < '0' || c > '9') && (c < 'a' || c > 'f') {
			return "", fmt.Errorf("%q is not hex", s)
		}
	}
	return s, nil
}
