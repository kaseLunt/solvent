// The committed registry (recon/feeds.json) as the CLAIM, plus the shared row
// type every Task-6 gate emits.
//
// chain-truth R2 is the law this file encodes: there are THREE parties, not
// two. A = our custody chain (event-derived params). B = independent chain
// testimony (pinned state reads). C = recon/feeds.json. "A vs B is the weld …
// C is not a witness at all — it is the CLAIM." Treating our own committed
// registry as an expected truth against which the chain is judged would be
// the-RPC-said-so inverted: the-config-said-so. So the registry is judged
// AGAINST B, both directions, with the direction classified because
// remediation differs.
package main

import (
	"encoding/hex"
	"fmt"
	"sort"
	"strings"

	"github.com/ethereum/go-ethereum/common"

	"github.com/kaselunt/solvent/cmd/reconcile/snapshotdb"
	"github.com/kaselunt/solvent/internal/config"
	"github.com/kaselunt/solvent/internal/prices"
)

// --- verdict vocabulary -----------------------------------------------------

// New verdict labels. verdictExact / verdictDrift / verdictWeldUnread are
// reused from dm.go so the tally has ONE notion of "exact".
const (
	// verdictCohortFloor: a cohort came in below its census-derived floor.
	// Empty arrays are failures, never passes.
	verdictCohortFloor = "cohort-floor-miss"
	// verdictOnlyInChain / verdictOnlyInRegistry: the two directions of a
	// registry set difference (chain-truth R2). BOTH gate; the direction is
	// recorded because the remediation differs (a registry extension under ack
	// vs a stale entry corrected).
	verdictOnlyInChain    = "only-in-chain"
	verdictOnlyInRegistry = "only-in-registry"
	// verdictAnomaly: a successful read where the chain universe predicts
	// revert-or-zero — e.g. a configured price for a token the chain has
	// delisted (chain-truth R3.3, the reverse direction).
	verdictAnomaly = "anomaly"
	// verdictEvidence: a recorded, non-gating column (availableBorrowsBase,
	// composition trees, impl witnesses). Never a pass or a fail.
	verdictEvidence = "evidence"
	// The B3 verdict ladder (chain-truth R4.4 / risk-quant R5-4).
	verdictProvenanceUpgrade = "provenance-upgrade"
	verdictQualifier         = "qualifier"
	verdictBudgetFalsified   = "budget-falsified"
	verdictReResolution      = "stream-requires-re-resolution"
	verdictUnscannable       = "unscannable"
	// verdictUnexplained: the third state of the backtest's intra-block law.
	verdictUnexplained = "UNEXPLAINED"
	// verdictMarginal: a disclosed intra-block-marginality row. It is NOT a
	// pass and NOT a fail on its own — it is listed individually with its
	// margin, and the case's own obligation verdicts still decide.
	verdictMarginal = "marginal-disclosed"
	// verdictSampleGap: the DM maxBorrow leg's middle state (classifyDMMaxBorrow,
	// adjudicated on accept-r4): the pin-clock values differ but the own-clock
	// weld at the account's own sweep block is bit-exact, so the delta is
	// eventless basket motion inside the sweep->pin gap. Disclosed individually
	// with magnitude and sweep age; never a failure and never an epsilon.
	verdictSampleGap = "sample-gap-disclosed"
)

// p3Row is ONE comparison across every Task-6 gate. A single shape keeps the
// artifact, the text rendering and the exit-code accounting to one code path:
// tallyP3 counts Gated && Verdict != exact, and nothing else decides.
//
// Expected is ALWAYS the chain side and Actual ALWAYS ours, without exception
// (chain-truth R5: the chain is the expected side of every weld). Swapping them
// per gate is how a reviewer stops being able to read a diff.
type p3Row struct {
	Gate     string            `json:"gate"`
	Subject  string            `json:"subject"`
	Leg      string            `json:"leg"`
	Expected string            `json:"expected_chain,omitempty"`
	Actual   string            `json:"actual_derived,omitempty"`
	Verdict  string            `json:"verdict"`
	Gated    bool              `json:"gated"`
	Class    string            `json:"classification,omitempty"`
	Note     string            `json:"note,omitempty"`
	Evidence map[string]string `json:"evidence,omitempty"`
}

// exactRow / driftRow / unreadRow / evidenceRow are the constructors; every
// gate uses them so a row cannot be built with a verdict/gated combination the
// tally does not understand.
func exactRow(gate, subject, leg, chain, ours string) p3Row {
	return p3Row{Gate: gate, Subject: subject, Leg: leg, Expected: chain, Actual: ours, Verdict: verdictExact, Gated: true}
}

func driftRow(gate, subject, leg, chain, ours, class, note string) p3Row {
	return p3Row{Gate: gate, Subject: subject, Leg: leg, Expected: chain, Actual: ours,
		Verdict: verdictDrift, Gated: true, Class: class, Note: note}
}

func unreadRow(gate, subject, leg, why string) p3Row {
	return p3Row{Gate: gate, Subject: subject, Leg: leg, Verdict: verdictWeldUnread, Gated: true,
		Note: "read-presence is a first-class fact: " + why + " — absent/reverted/undecodable is GATED, never zero and never silently absent (chain-truth R1.5)"}
}

func evidenceRow(gate, subject, leg, value, note string) p3Row {
	return p3Row{Gate: gate, Subject: subject, Leg: leg, Expected: value, Verdict: verdictEvidence, Gated: false, Note: note}
}

// compareExact is the one comparison helper: bit-exact, zero units, chain on
// the expected side. There is deliberately no epsilon parameter — the three
// permitted tolerances live in their own named code paths, so a reviewer
// grepping for a tolerance finds exactly three sites.
func compareExact(gate, subject, leg string, chain, ours fmt.Stringer, class string) p3Row {
	c, o := chain.String(), ours.String()
	if c == o {
		return exactRow(gate, subject, leg, c, o)
	}
	return driftRow(gate, subject, leg, c, o, class, "bit-exact comparison, tolerance ZERO: this leg's inputs are declared in the gate's input frame, so a divergence is an input-frame inconsistency or a bug, never rounding (risk-quant R1)")
}

// failingVerdicts is the CLOSED SET of verdicts that constitute a gated
// failure. Everything else is a successful or informational outcome.
//
// THE DEFECT THIS REPLACES (Codex round 1, finding 1): tallyP3 previously
// counted "gated AND not exact" as failure, which swept in every richer verdict
// the gate set deliberately introduced — a provenance UPGRADE (the best possible
// B3 outcome), a within-grace QUALIFIER, and a disclosed intra-block MARGINAL
// case. Those are not failures; treating them as such made exit 0 unreachable
// on an honest book, which is the deterministic false-failure class. A gate that
// cannot pass is as useless as one that cannot fail.
//
// The set is CLOSED and asserted complete by TestEveryVerdictHasATallyClass, so
// a new verdict cannot be introduced without a deliberate decision about which
// side of the line it falls on.
var failingVerdicts = map[string]bool{
	verdictDrift:           true, // a numeric or boolean disagreement with the chain
	verdictWeldUnread:      true, // "cannot verify" is never advisory (round-11 F2)
	verdictCohortFloor:     true, // a cohort below its census-derived floor
	verdictOnlyInChain:     true, // registry coverage gap, both directions gate
	verdictOnlyInRegistry:  true, // stale registry entry, both directions gate
	verdictAnomaly:         true, // a successful read where the chain predicts none
	verdictBudgetFalsified: true, // the published freshness budget is refuted
	verdictReResolution:    true, // the walked stream no longer serves the feed
	verdictUnscannable:     true, // no custody domain / no measurable interval
	verdictUnexplained:     true, // the third state of the intra-block law
}

// passingVerdicts is the complementary CLOSED SET: gated outcomes that are
// SUCCESSES. Each is a real verdict the run wants to be able to reach.
var passingVerdicts = map[string]bool{
	verdictExact:             true, // bit-exact agreement
	verdictProvenanceUpgrade: true, // B3's BEST outcome: max gap within the heartbeat
	verdictQualifier:         true, // within the declared operator grace, disclosed
	verdictMarginal:          true, // intra-block flip WITH a proven custodied witness
	verdictSampleGap:         true, // own-clock weld bit-exact; the pin delta is disclosed sweep-age motion
}

// verdictIsFailure decides one row. Gated is a separate axis: an ungated row is
// evidence and never counts, whatever its verdict.
//
// An UNRECOGNISED verdict counts as a FAILURE, deliberately: a verdict nobody
// classified is a verdict nobody reasoned about, and failing closed is the only
// safe default. TestEveryVerdictHasATallyClass makes that path unreachable in
// practice by asserting the two sets cover the vocabulary.
func verdictIsFailure(v string) bool {
	if passingVerdicts[v] {
		return false
	}
	return true
}

// tallyP3 counts the gated failures across a row set.
func tallyP3(rows []p3Row) int {
	n := 0
	for _, r := range rows {
		if r.Gated && verdictIsFailure(r.Verdict) {
			n++
		}
	}
	return n
}

// --- the committed registry (party C) ---------------------------------------

// registryAsset is one feeds.json entry reduced to the facts the gates judge.
type registryAsset struct {
	Address       common.Address
	Symbol        string
	Decimals      uint8
	Roles         map[string]bool
	Engine        string
	ChainID       uint64
	OracleKind    string
	OracleAddress common.Address
	PriceDecimals int32
}

// registryView is the parsed CLAIM, per engine.
type registryView struct {
	// DM is keyed by token address (OP, engine debt_manager).
	DM map[common.Address]*registryAsset
	// Aave is keyed by reserve address (ETH, engine aave_v3_etherfi). The
	// registry carries an asset TWICE for Aave (a chainlink_stream entry and an
	// aaveoracle poll entry), so entries are MERGED by address with their roles
	// unioned — an address-level "equal" verdict that split one reserve into two
	// rows would be an artifact of our own file layout, not a fact.
	Aave map[common.Address]*registryAsset
	// AaveOracle is the adapter-output provider the registry claims.
	AaveOracle common.Address
	// DMProvider is the PriceProviderV2 the registry claims.
	DMProvider common.Address
	// FeedRegistry is the plain-value form Stage A consumes.
	FeedRegistry snapshotdb.FeedRegistry
}

// buildRegistryView parses recon/feeds.json into the CLAIM plus the plain-value
// feed registry Stage A needs. It is deliberately total: any inconsistency
// INSIDE our own file (two different provider addresses for one engine,
// a role outside the closed vocabulary) is a precondition error rather than a
// gate row, because a self-contradictory claim cannot be judged against
// anything.
func buildRegistryView(feeds *config.Feeds, streams map[string]config.Stream) (*registryView, error) {
	v := &registryView{
		DM:   map[common.Address]*registryAsset{},
		Aave: map[common.Address]*registryAsset{},
	}
	v.FeedRegistry.FeedEngine = prices.FeedCursorEngine(1)
	v.FeedRegistry.AavePollEngine = prices.PollCursorEngine(1)

	for _, a := range feeds.Assets {
		target := v.Aave
		if a.Engine == dmEngine {
			target = v.DM
		} else if a.Engine != aaveEngine {
			return nil, fmt.Errorf("feed registry: asset %s carries engine %q, which is neither %s nor %s — the Task-6 gates judge exactly these two books", a.Address.Hex(), a.Engine, dmEngine, aaveEngine)
		}
		entry, ok := target[a.Address]
		if !ok {
			entry = &registryAsset{
				Address: a.Address, Symbol: a.Symbol, Decimals: a.Decimals,
				Roles: map[string]bool{}, Engine: a.Engine, ChainID: a.ChainID,
			}
			target[a.Address] = entry
		}
		if entry.Decimals != a.Decimals {
			return nil, fmt.Errorf("feed registry: asset %s (%s) declares decimals %d and %d in two entries — a self-contradictory claim cannot be judged", a.Address.Hex(), a.Symbol, entry.Decimals, a.Decimals)
		}
		for _, r := range a.Roles {
			entry.Roles[r] = true
		}
		switch a.Oracle.Kind {
		case config.FeedKindPoll:
			entry.OracleKind, entry.OracleAddress, entry.PriceDecimals = a.Oracle.Kind, a.Oracle.Contract, a.Oracle.PriceDecimals
			if a.Engine == dmEngine {
				if v.DMProvider != (common.Address{}) && v.DMProvider != a.Oracle.Contract {
					return nil, fmt.Errorf("feed registry: two different Debt Manager price providers claimed (%s and %s)", v.DMProvider.Hex(), a.Oracle.Contract.Hex())
				}
				v.DMProvider = a.Oracle.Contract
			} else {
				if v.AaveOracle != (common.Address{}) && v.AaveOracle != a.Oracle.Contract {
					return nil, fmt.Errorf("feed registry: two different AaveOracle adapters claimed (%s and %s)", v.AaveOracle.Hex(), a.Oracle.Contract.Hex())
				}
				v.AaveOracle = a.Oracle.Contract
			}
		case config.FeedKindChainlinkStream:
			if entry.OracleKind == "" {
				entry.OracleKind = a.Oracle.Kind
			}
			stream := streamNameForAggregator(streams, a.Oracle.Contract)
			v.FeedRegistry.Feeds = append(v.FeedRegistry.Feeds, snapshotdb.FeedSpec{
				Stream:           stream,
				AggregatorHex:    hex.EncodeToString(a.Oracle.Contract.Bytes()),
				ProxyHex:         hex.EncodeToString(a.Oracle.Proxy.Bytes()),
				AssetHex:         hex.EncodeToString(a.Address.Bytes()),
				Symbol:           a.Symbol,
				Source:           prices.ChainlinkSource(a.Oracle.Contract),
				HeartbeatSeconds: int64(a.Oracle.Heartbeat.Seconds()),
				GraceSeconds:     int64(a.Oracle.Grace.Seconds()),
				StartBlock:       a.Oracle.StartBlock,
			})
		}
	}
	sort.Slice(v.FeedRegistry.Feeds, func(i, j int) bool {
		return v.FeedRegistry.Feeds[i].AggregatorHex < v.FeedRegistry.Feeds[j].AggregatorHex
	})
	if v.AaveOracle == (common.Address{}) {
		return nil, fmt.Errorf("feed registry: no AaveOracle poll entry — the adapter-output weld has no claimed adapter to judge")
	}
	if v.DMProvider == (common.Address{}) {
		return nil, fmt.Errorf("feed registry: no Debt Manager poll entry — the tokenConfig sweep has no claimed provider to judge")
	}
	return v, nil
}

// streamNameForAggregator finds the walker stream whose address set contains
// the raw aggregator. The stream NAME is what bounds the custody domain (its
// ingest cursor), so a feed whose aggregator matches no configured stream is
// named "(unwalked)" and the B3 scan records it unscannable rather than
// scanning a domain it cannot bound.
func streamNameForAggregator(streams map[string]config.Stream, agg common.Address) string {
	names := make([]string, 0, len(streams))
	for n := range streams {
		names = append(names, n)
	}
	sort.Strings(names)
	for _, n := range names {
		for _, a := range streams[n].Addresses {
			if a == agg {
				return n
			}
		}
	}
	return "(unwalked)"
}

// registrySetGate judges the CLAIM against the CHAIN enumeration at the pin,
// both directions, with the direction classified. Coverage floors count against
// `chainSet` — never against the registry (chain-truth R2's coverage-floor
// clause: asserting coverage against your own registry is one witness through
// two doors).
func registrySetGate(gate, subjectPrefix string, chainSet map[common.Address]bool, registrySet map[common.Address]*registryAsset, chainRoles map[common.Address]map[string]bool) []p3Row {
	var rows []p3Row
	all := map[common.Address]bool{}
	for a := range chainSet {
		all[a] = true
	}
	for a := range registrySet {
		all[a] = true
	}
	addrs := sortedAddrs(all)
	for _, a := range addrs {
		inChain, inReg := chainSet[a], registrySet[a] != nil
		subject := subjectPrefix + a.Hex()
		switch {
		case inChain && !inReg:
			rows = append(rows, p3Row{
				Gate: gate, Subject: subject, Leg: "set-membership", Verdict: verdictOnlyInChain, Gated: true,
				Class: verdictOnlyInChain,
				Note:  "the chain configures this asset at the pin and recon/feeds.json does not: an asset with NO configured price witness, which riskd already refuses per-asset (internal/riskfeed/assemble.go:314-320). This is the liquidUSD class — a coverage gap. Remediation is a registry extension under ack; the run FAILS naming the asset (chain-truth R2)",
			})
		case inReg && !inChain:
			rows = append(rows, p3Row{
				Gate: gate, Subject: subject, Leg: "set-membership", Verdict: verdictOnlyInRegistry, Gated: true,
				Class: verdictOnlyInRegistry,
				Note:  "recon/feeds.json claims this asset and the chain does not configure it at the pin: a stale or mistyped entry. Even when a custodied removal event explains it, the row stays FAILING until the registry is corrected — never disclose-and-continue, because both directions gate (chain-truth R2)",
			})
		default:
			rows = append(rows, exactRow(gate, subject, "set-membership", "configured", "configured"))
			// ROLE-LEVEL equality (chain-truth R2): a token borrow-enabled on
			// chain but marked collateral-only in our registry is a missed
			// debt-pricing witness hiding inside an address-level "equal".
			if want, ok := chainRoles[a]; ok {
				got := registrySet[a].Roles
				if !sameRoleSet(want, got) {
					rows = append(rows, driftRow(gate, subject, "roles",
						roleString(want), roleString(got), "role-level-difference",
						"address-level membership agreed but ROLES did not. A token the chain has borrow-enabled while our registry marks it collateral-only is a missed debt-pricing witness that an address-level set comparison would have called equal (chain-truth R2)"))
				} else {
					rows = append(rows, exactRow(gate, subject, "roles", roleString(want), roleString(got)))
				}
			}
		}
	}
	return rows
}

func sameRoleSet(a, b map[string]bool) bool {
	for k, v := range a {
		if v != b[k] {
			return false
		}
	}
	for k, v := range b {
		if v != a[k] {
			return false
		}
	}
	return true
}

func roleString(m map[string]bool) string {
	var out []string
	for k, v := range m {
		if v {
			out = append(out, k)
		}
	}
	sort.Strings(out)
	return strings.Join(out, "+")
}

// cohortFloorRow judges one cohort membership floor. `census` is the
// POPULATION-DERIVED expectation (chain census at the run's own pin where a
// chain census exists, our own census where the consult says so) and `backstop`
// is the hard minimum the chain actually supports. Both consults concur that a
// bare constant above the population is a custody hazard, not a strengthening
// (chain-truth R5.1), so the constant is only ever the FLOOR of the pair.
func cohortFloorRow(gate, cohort string, got, census, backstop int, note string) p3Row {
	want := census
	basis := "population-derived census at the run's own pin"
	if backstop > want {
		want = backstop
		basis = "hard backstop (above the census — recorded as such)"
	}
	row := p3Row{
		Gate: gate, Subject: "cohort:" + cohort, Leg: "floor",
		Expected: fmt.Sprintf("%d (%s)", want, basis),
		Actual:   fmt.Sprintf("%d", got),
		Gated:    true,
		Note:     note,
	}
	if got >= want && got > 0 {
		row.Verdict = verdictExact
		return row
	}
	row.Verdict = verdictCohortFloor
	row.Class = verdictCohortFloor
	if got == 0 {
		row.Note = "EMPTY cohort. Empty arrays are failures, never passes. " + note
	}
	return row
}
