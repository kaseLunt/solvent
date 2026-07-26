// DM collateral freshness (brief §7). Stated purpose, carried into the
// artifact verbatim: collateral is non-custodial and poll-only (collateralOf
// reads live Safe ERC20 balances via CashLens and moves EVENTLESSLY), so it
// CANNOT be event-reconciled; honest evidence is sweep-pipeline health plus
// bounded live checks — never a fabricated event identity.
package main

import (
	"fmt"
	"math/big"
	"sort"
	"time"

	"github.com/kaselunt/solvent/internal/store"
)

// advisoryFleetFreshFraction is the NAMED advisory threshold (brief §7 /
// L2-9): fleet-wide aggregates are REPORTED against it so one
// permanently-reverting Safe cannot deadlock W1 forever — only the SAMPLED
// accounts gate the exit code. Policy value, not a theorem: 95% of the
// registry fresh is the "pipeline is healthy" orientation line.
const advisoryFleetFreshFraction = 0.95

// freshnessBound resolves `-snapshot-max-age auto` (brief §7 / L2-9):
// max(2 × SOLVENT_SNAPSHOT_INTERVAL, 2 × sweep_generations.last_pass_seconds)
// — hydrated from the SAME durable column the daemon's own
// collateralStaleBound uses. Both inputs and the resolved bound are
// recorded; the bound is labeled POLICY in the artifact (risk-quant F7): an
// operator margin, not a contract-derived quantity.
func freshnessBound(snapshotInterval time.Duration, lastPassSeconds *int64) (bound time.Duration, inputs map[string]string) {
	bound = 2 * snapshotInterval
	inputs = map[string]string{
		"snapshot_interval": snapshotInterval.String(),
		"last_pass_seconds": "(null)",
		"label":             "policy",
	}
	if lastPassSeconds != nil {
		inputs["last_pass_seconds"] = fmt.Sprintf("%d", *lastPassSeconds)
		if p := 2 * time.Duration(*lastPassSeconds) * time.Second; p > bound {
			bound = p
		}
	}
	inputs["resolved_bound"] = bound.String()
	return bound, inputs
}

// accountFreshnessVerdict is one SAMPLED account's gate row.
type accountFreshnessVerdict struct {
	AccountHex       string `json:"account"`
	Status           string `json:"status"` // success | failed | never-swept
	LastSuccessBlock uint64 `json:"last_success_block"`
	LastSuccessAge   string `json:"last_success_age,omitempty"`
	Verdict          string `json:"verdict"` // fresh | stale | failed | never-swept
	Gated            bool   `json:"gated"`
}

// fleetAggregates is the registry-wide advisory picture (registry LEFT JOIN
// — never-swept accounts are COUNTED, not invisible; L0-6).
type fleetAggregates struct {
	Registry          int     `json:"registry_accounts"`
	Fresh             int     `json:"fresh"`
	StaleSuccess      int     `json:"stale_success"`
	Failed            int     `json:"failed"`
	NeverSwept        int     `json:"never_swept"`
	FreshFraction     float64 `json:"fresh_fraction"`
	AdvisoryThreshold float64 `json:"advisory_threshold"`
	AdvisoryBreached  bool    `json:"advisory_breached"`
	Note              string  `json:"note"`
}

// freshnessResult is the §7 section: sampled rows gate; fleet advises.
type freshnessResult struct {
	BoundInputs  map[string]string         `json:"bound_inputs"` // label:policy (F7)
	Sampled      []accountFreshnessVerdict `json:"sampled"`
	GateFailures int                       `json:"gate_failures"`
	Fleet        fleetAggregates           `json:"fleet"`
	Notes        []string                  `json:"notes"`
}

// registryExclusionNote is risk-quant F8, stated so the reviewer never
// discovers it as a surprise.
const registryExclusionNote = "collateral-only Safes are OUT OF CENSUS by design: the registry is distinct debt-side accounts, so a Safe holding collateral with zero debt (no liquidation exposure) appears in neither the sampling universe nor this freshness registry; it enters on its first debt event"

// evaluateFreshness is the pure §7 gate/advisory computation.
func evaluateFreshness(rows []store.AccountFreshness, sampled map[string]bool, bound time.Duration, boundInputs map[string]string, now time.Time) freshnessResult {
	res := freshnessResult{
		BoundInputs: boundInputs,
		Notes: []string{
			"collateral is non-custodial and poll-only (collateralOf reads live Safe ERC20 balances, moves eventlessly) — it cannot be event-reconciled; this section is sweep-pipeline health plus bounded live checks",
			"gate scope: SAMPLED accounts gate the exit code; fleet-wide aggregates are advisory against the named threshold so one permanently-reverting Safe cannot deadlock W1",
			registryExclusionNote,
		},
	}
	for _, r := range rows {
		verdict := ""
		switch {
		case !r.HasRow || r.LastSuccessBlock == 0:
			// NeverSucceeded class: a missing registry row or
			// last_success_block = 0 counts RED (L0-6) — aggregates computed
			// on snapshot_sweeps alone are vacuous for never-swept accounts.
			verdict = "never-swept"
			res.Fleet.NeverSwept++
		case r.Status != "success":
			verdict = "failed"
			res.Fleet.Failed++
		case r.LastSuccessAt == nil:
			// NULL last_success_at is fail-closed per migration 00006: the
			// only rows left NULL are exactly the ones whose snapshots are
			// most likely stale.
			verdict = "stale"
			res.Fleet.StaleSuccess++
		case now.Sub(*r.LastSuccessAt) > bound:
			verdict = "stale"
			res.Fleet.StaleSuccess++
		default:
			verdict = "fresh"
			res.Fleet.Fresh++
		}
		res.Fleet.Registry++

		acctHex := fmt.Sprintf("%x", r.Account)
		if sampled[acctHex] {
			v := accountFreshnessVerdict{
				AccountHex:       acctHex,
				LastSuccessBlock: r.LastSuccessBlock,
				Verdict:          verdict,
				Gated:            true,
			}
			switch verdict {
			case "never-swept":
				v.Status = "never-swept"
			default:
				v.Status = r.Status
			}
			if r.LastSuccessAt != nil {
				v.LastSuccessAge = now.Sub(*r.LastSuccessAt).Round(time.Second).String()
			}
			if verdict != "fresh" {
				res.GateFailures++
			}
			res.Sampled = append(res.Sampled, v)
		}
	}
	sort.Slice(res.Sampled, func(i, j int) bool { return res.Sampled[i].AccountHex < res.Sampled[j].AccountHex })
	if res.Fleet.Registry > 0 {
		res.Fleet.FreshFraction = float64(res.Fleet.Fresh) / float64(res.Fleet.Registry)
	}
	res.Fleet.AdvisoryThreshold = advisoryFleetFreshFraction
	res.Fleet.AdvisoryBreached = res.Fleet.FreshFraction < advisoryFleetFreshFraction
	res.Fleet.Note = "advisory only — never gates the exit code (named threshold, brief §7)"
	return res
}

// zeroCollateralConditional is the L2-12 sub-check: an EMPTY collateral
// document is a valid observation writing zero position_balances rows, so
// the check reads "IF snapshot-source rows exist, their updated_block ==
// last_success_block" — absence of rows is NEVER misread as failure (the
// independent status/last_success_at gate covers pipeline health).
func zeroCollateralConditional(snapshotRows []store.BalanceRow, lastSuccessBlock uint64) (ok bool, detail string) {
	if len(snapshotRows) == 0 {
		return true, "no snapshot-source rows — a valid zero-collateral observation"
	}
	for _, r := range snapshotRows {
		if r.UpdatedBlock != lastSuccessBlock {
			return false, fmt.Sprintf("snapshot row %s/%s updated at block %d but last_success_block is %d",
				r.AssetHex, r.Side, r.UpdatedBlock, lastSuccessBlock)
		}
	}
	return true, fmt.Sprintf("%d snapshot rows all at last_success_block %d", len(snapshotRows), lastSuccessBlock)
}

// foldCollateralOf folds a decoded collateralOf return with the SWEEPER'S
// OWN semantics (internal/snapshot.decodeCollateralOf: zero amounts skipped,
// duplicate tokens summed) so the deep replay compares like with like.
func foldCollateralOf(list []tokenAmount) map[string]*big.Int {
	out := map[string]*big.Int{}
	for _, t := range list {
		if t.Amount.Sign() == 0 {
			continue
		}
		key := fmt.Sprintf("%x", t.Token.Bytes())
		if out[key] == nil {
			out[key] = new(big.Int)
		}
		out[key].Add(out[key], t.Amount)
	}
	return out
}

// collateralReplayRow is one deep-replay row (brief §7, graft 4 reshaped by
// L0-5/L1-5/L2-10): the sweeper's collateralOf re-executed at
// HeaderHashFrom(last_success_block) against the snapshots HISTORY row at
// exactly that block. Gates ONLY when the pinned replay was actually served
// — last_success_block can sit beyond non-archive horizons on OP, so a
// state-pruned classification degrades the row to report-only with endpoint
// + depth recorded, never exit 1/2 by itself. A SERVED-and-mismatched
// replay IS gated.
type collateralReplayRow struct {
	AccountHex string   `json:"account"`
	Block      uint64   `json:"block"`
	Served     bool     `json:"served"`
	Gated      bool     `json:"gated"`
	Verdict    string   `json:"verdict"` // exact | drift | not-served
	Diffs      []string `json:"diffs,omitempty"`
	Class      string   `json:"rpc_class,omitempty"`
	DepthNote  string   `json:"depth_note,omitempty"`
	Endpoints  []int    `json:"endpoints_consulted,omitempty"`
}

// compareCollateralReplay compares the history document with the folded
// chain read, bit-exact both directions.
func compareCollateralReplay(doc map[string]string, chainFolded map[string]*big.Int) (verdict string, diffs []string) {
	keys := map[string]bool{}
	for k := range doc {
		keys[k] = true
	}
	for k := range chainFolded {
		keys[k] = true
	}
	ordered := make([]string, 0, len(keys))
	for k := range keys {
		ordered = append(ordered, k)
	}
	sort.Strings(ordered)
	for _, k := range ordered {
		docVal, inDoc := doc[k]
		chainVal, onChain := chainFolded[k]
		switch {
		case inDoc && !onChain:
			diffs = append(diffs, fmt.Sprintf("token %s: history %s, chain absent", k, docVal))
		case !inDoc && onChain:
			diffs = append(diffs, fmt.Sprintf("token %s: history absent, chain %s", k, chainVal))
		default:
			d, ok := new(big.Int).SetString(docVal, 10)
			if !ok {
				diffs = append(diffs, fmt.Sprintf("token %s: history value %q unparseable", k, docVal))
				continue
			}
			if d.Cmp(chainVal) != 0 {
				diffs = append(diffs, fmt.Sprintf("token %s: history %s, chain %s", k, docVal, chainVal))
			}
		}
	}
	if len(diffs) == 0 {
		return verdictExact, nil
	}
	return verdictDrift, diffs
}

// spotReadRow is the non-gating collateral spot read (brief §7):
// collateralOf(account)@pinHash(P_op) vs snapshot-source balances,
// report-only WITH the reason it cannot gate stated — the snapshot rows were
// read at last_success_block, the spot read at P, and collateral moves
// eventlessly between any two blocks, so inequality is expected motion, not
// drift.
type spotReadRow struct {
	AccountHex    string   `json:"account"`
	SnapshotBlock uint64   `json:"snapshot_block"`
	PinBlock      uint64   `json:"pin_block"`
	BlockDistance int64    `json:"block_distance"`
	Match         bool     `json:"match"`
	Diffs         []string `json:"diffs,omitempty"`
	Note          string   `json:"note"`
}

const spotReadNote = "report-only BY CONSTRUCTION: snapshot rows were read at last_success_block, this read at P, and collateral moves eventlessly between any two blocks — a mismatch here is expected motion, not drift; the gated instrument for sweep correctness is the deep replay at the sweeper's own block"

// buildSpotReadRow assembles one spot row from already-fetched values.
func buildSpotReadRow(accountHex string, snapshotRows []store.BalanceRow, chainFolded map[string]*big.Int, snapshotBlock, pinBlock uint64) spotReadRow {
	doc := map[string]string{}
	for _, r := range snapshotRows {
		if r.Source == "snapshot" && r.Side == "collateral" {
			doc[r.AssetHex] = r.Amount.String()
		}
	}
	verdict, diffs := compareCollateralReplay(doc, chainFolded)
	return spotReadRow{
		AccountHex:    accountHex,
		SnapshotBlock: snapshotBlock,
		PinBlock:      pinBlock,
		BlockDistance: int64(pinBlock) - int64(snapshotBlock),
		Match:         verdict == verdictExact,
		Diffs:         diffs,
		Note:          spotReadNote,
	}
}
