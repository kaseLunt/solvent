// The INPUT-FRAME DECLARATION LAW (risk-quant R1 / R5-5) and the
// THREE-TOLERANCE REGISTRY (risk-quant R2 / R5-5 corollary), implemented as
// ENFORCEMENT rather than documentation.
//
// R5-5 states the failure this file exists to make impossible: "'All EXACT'
// without a declared input frame lets an implementer weld nothing. A gate that
// reads every input at pin — scaled balances included — re-proves only the law
// (already proven) and tests no derived state." A prose table in a report
// cannot catch that; a run that never notices its own frame drifting will
// happily print EXACT forever.
//
// So the frame is a LEDGER, not a paragraph:
//
//   - every gate DECLARES, before it computes, an exhaustive
//     derived-under-test list and pinned-read list (plus committed inputs:
//     frozen frames, seeds, the registry file);
//   - every value a gate consumes is USED through frameLedger.use(name);
//   - at the end of the phase the ledger is CHECKED, and two conditions are
//     GATED failures: a source consumed that was never declared (the R5-5
//     laundering shape), and a source declared that was never consumed (the
//     shape where a gate quietly stopped testing what its declaration claims).
//
// Names are exact strings, deliberately verbose: `position_balances(source=
// event, engine=aave_v3_etherfi, side=collateral).amount@P_eth` says which
// table, which discriminators and which pin. A vague name would make the
// ledger pass while the frame drifted.
package main

import (
	"fmt"
	"sort"
)

// Frame-kind labels. These are the exact strings the artifact carries, so a
// reviewer reading a row knows whether a number is OUR state under test or the
// chain's testimony holding it up.
const (
	// frameDerived: a value OUR custody chain produced — the thing under test.
	// If a gate's derived list is empty, the gate proves nothing about Solvent.
	frameDerived = "derived-under-test"
	// framePinned: a value read from the chain at a hash-bound pin during this
	// run. Never a stored sample, never a number-pinned read.
	framePinned = "pinned-read"
	// frameCommitted: a value committed to the repository BEFORE the run (the
	// frozen backtest frame, its seed, recon/feeds.json as the CLAIM). Named
	// separately because a committed input is neither our derived state nor
	// chain testimony — it is what we said we would test.
	frameCommitted = "committed-input"
)

// Gate identifiers. One per gate family; the artifact keys frames by these.
const (
	gateAaveHF          = "aave_hf"
	gateAaveAdapterWeld = "aave_adapter_output_weld"
	gateAaveParamWeld   = "aave_param_weld"
	gateDMBoolean       = "dm_boolean_weld"
	gateDMParamWeld     = "dm_param_weld"
	gateTokenConfig     = "tokenconfig_sweep"
	gateRegistry        = "registry_consistency"
	gateBacktest        = "realized_liquidation_backtest"
	gateHeartbeat       = "b3_heartbeat_scan"
)

// --- the three tolerances ---------------------------------------------------

// The COMPLETE set of tolerances permitted anywhere in a Task-6 run. Every
// other comparison is bit-exact, zero units. risk-quant R5-5: "the run's only
// permitted tolerances are the three derived in R1/R2 ... Any other epsilon
// appearing in the Task 6 diff is tolerance-as-carpet and blocks."
//
// Each constant names the mechanism, the direction and the bound, because a
// tolerance without all three is a carpet with a label on it.
// toleranceID is the CLOSED tolerance enum.
//
// THE DEFECT THIS REPLACES (Codex round 1, finding 2): tolerances were cited by
// STRING, so a fourth epsilon could be applied and simply not cited — the row
// would return exact and the ledger would never see it. The law said "exactly
// three" and the mechanism could not enforce it.
//
// As a typed enum with three unexported constants and no exported constructor, a
// fourth tolerance is now a COMPILE error rather than a runtime row: there is no
// value of this type that is not one of the three, and `cite` takes nothing else.
type toleranceID int

const (
	// tolResidueWei — ≤1 NORMALIZED WEI, one direction (derived-high only),
	// ONLY on fully-liquidated accounts. Mechanism: DebtManagerCore.sol:549-553
	// silently zeroes a remaining normalized amount of exactly 1 after the
	// SECOND Liquidated of a tx, without emitting anything. The deriver models
	// it with an explicit residue_zeroed event, so this tolerance applies only
	// where that model did NOT fire.
	tolResidueWei toleranceID = iota + 1

	// tolSeizureTokenWei — ≤1 WEI OF THE COLLATERAL TOKEN per
	// userCollateralLiquidated element, one direction (credited-USD deficit).
	// Mechanism: the seizure converts USD to token units by truncation,
	// floor(u·10^dec/P) (DebtManagerStorageContract.sol:517-521), so the USD
	// round-trip floor(floor(u·10^dec/P)·P/10^dec) lands in
	// [u − ceil(P/10^dec), u] — you cannot seize a fractional wei. For an
	// 8-dec token at P≈1.18e11 that is ≈1,180 USD-6 units (≈$0.0012); for
	// 18-dec and stables it is ≤1 unit. The TOKEN-UNIT comparison itself stays
	// EXACT; this tolerance exists only on the USD re-derivation leg.
	tolSeizureTokenWei

	// tolIntraBlockMarginality — NOT a numeric epsilon: a DISCLOSURE BAND.
	// `liquidatable(user)` is evaluable only at block boundaries, but the
	// liquidation executed mid-block against pre-state that may include
	// same-block earlier transactions (DM prices are push updates). A case
	// whose eligibility flips between the parent frame and the intra-block
	// frame is listed INDIVIDUALLY with |debt − maxBorrowLT| in USD-6 and the
	// price delta printed. It never absorbs a row into a pass: the three-state
	// law (true-at-parent / flipped-in-block-with-custodied-witness /
	// UNEXPLAINED) still gates the third state.
	tolIntraBlockMarginality
)

// String is the artifact spelling: mechanism, direction and bound, because a
// tolerance without all three is a carpet with a label on it.
func (t toleranceID) String() string {
	switch t {
	case tolResidueWei:
		return "residue-1-normalized-wei(DebtManagerCore.sol:549-553; fully-liquidated only; derived-high direction only)"
	case tolSeizureTokenWei:
		return "seizure-1-token-wei-round-trip(DebtManagerStorageContract.sol:517-521 truncation; credited-USD deficit direction only; per element)"
	case tolIntraBlockMarginality:
		return "intra-block-marginality-band(chain-truth R1 three-state law; DISCLOSURE, never absorption; margins printed per case)"
	}
	// Unreachable through the type system; kept loud rather than empty so a
	// future constant added without a String arm cannot render as "".
	return fmt.Sprintf("UNREGISTERED-TOLERANCE(%d)", int(t))
}

// permittedTolerances is the closed set, keyed by the ENUM.
// TestExactlyThreeTolerancesArePermitted asserts len == 3 and that every member
// renders its mechanism/direction/bound.
var permittedTolerances = map[toleranceID]string{
	tolResidueWei:            "risk-quant R2 obligation 4 — the single legitimate standing tolerance in Task 6",
	tolSeizureTokenWei:       "risk-quant R2 obligation 3 — the only derived slack in the seizure recompute, stated with its mechanics",
	tolIntraBlockMarginality: "risk-quant R2 obligation 2 / chain-truth R1 — a disclosed frame caveat, not a numeric allowance",
}

// allTolerances is the enumeration order the report prints in.
var allTolerances = []toleranceID{tolResidueWei, tolSeizureTokenWei, tolIntraBlockMarginality}

// --- the ledger -------------------------------------------------------------

// frameSource is one declared input.
type frameSource struct {
	Kind   string `json:"kind"`
	Name   string `json:"name"`
	Detail string `json:"detail,omitempty"`
}

// gateFrame is one gate's declaration plus its consumption record.
type gateFrame struct {
	Gate       string        `json:"gate"`
	Sources    []frameSource `json:"sources"`
	Tolerances []string      `json:"tolerances,omitempty"`
	// Used is the set of source names the gate actually consumed, recorded at
	// consumption time.
	used map[string]bool
	// declared indexes Sources by name for O(1) use() checks.
	declared map[string]string // name → kind
	// cited is the typed citation record; Tolerances is its artifact rendering.
	cited []toleranceID
}

// newGateFrame declares a gate's exhaustive input frame. Callers list every
// source ONCE, at the top of the gate, before any comparison runs — the
// declaration is meant to be readable as the gate's contract.
func newGateFrame(gate string, sources ...frameSource) *gateFrame {
	f := &gateFrame{Gate: gate, Sources: sources, used: map[string]bool{}, declared: map[string]string{}}
	for _, s := range sources {
		f.declared[s.Name] = s.Kind
	}
	return f
}

// derived / pinned / committed are the declaration constructors.
func derived(name, detail string) frameSource {
	return frameSource{Kind: frameDerived, Name: name, Detail: detail}
}
func pinned(name, detail string) frameSource {
	return frameSource{Kind: framePinned, Name: name, Detail: detail}
}
func committed(name, detail string) frameSource {
	return frameSource{Kind: frameCommitted, Name: name, Detail: detail}
}

// use records that the gate consumed the named source. An undeclared name is
// NOT ignored and NOT panicked on: it is recorded, and violations() turns it
// into a gated failure row — the run must be able to report the violation in
// its artifact, which a panic would prevent.
func (f *gateFrame) use(name string) {
	if f == nil {
		return
	}
	f.used[name] = true
}

// cite records a tolerance appearance. It takes the ENUM, so there is no way to
// cite something outside the closed set — and no way to apply a fourth tolerance
// silently, because there is no fourth value to apply.
func (f *gateFrame) cite(tolerance toleranceID) {
	if f == nil {
		return
	}
	for _, t := range f.cited {
		if t == tolerance {
			return
		}
	}
	f.cited = append(f.cited, tolerance)
	f.Tolerances = append(f.Tolerances, tolerance.String())
}

// violations returns this gate's frame failures, deterministically ordered.
// THREE classes, all gated:
//
//  1. consumed-but-undeclared — the R5-5 laundering shape: a gate reached for
//     an input its declaration does not admit, so nobody reviewing the
//     declaration knows what the gate actually welded.
//  2. declared-but-unconsumed — the silent-scope-shrink shape: the declaration
//     still claims to test something the code stopped reading.
//  3. an unregistered tolerance — tolerance-as-carpet.
func (f *gateFrame) violations() []string {
	if f == nil {
		return nil
	}
	var out []string
	names := make([]string, 0, len(f.used))
	for n := range f.used {
		names = append(names, n)
	}
	sort.Strings(names)
	for _, n := range names {
		if _, ok := f.declared[n]; !ok {
			out = append(out, fmt.Sprintf("gate %s CONSUMED an undeclared source %q — the input frame must be exhaustive (risk-quant R1/R5-5): a component consuming an undeclared source FAILS the run, because a declaration that does not cover the reads cannot tell a reviewer what was welded", f.Gate, n))
		}
	}
	decl := make([]string, 0, len(f.declared))
	for n := range f.declared {
		decl = append(decl, n)
	}
	sort.Strings(decl)
	for _, n := range decl {
		if !f.used[n] {
			out = append(out, fmt.Sprintf("gate %s DECLARED source %q but never consumed it — a stale declaration is how a gate silently stops testing what it claims to test", f.Gate, n))
		}
	}
	// A citation outside the closed set is now UNREPRESENTABLE (cite takes the
	// enum), so this arm is a belt on the type system rather than the mechanism:
	// it catches a future constant added without a permittedTolerances entry.
	for _, t := range f.cited {
		if _, ok := permittedTolerances[t]; !ok {
			out = append(out, fmt.Sprintf("gate %s cites tolerance %q, which is NOT one of the three permitted tolerances — any other epsilon is tolerance-as-carpet and blocks (risk-quant R5-5)", f.Gate, t))
		}
	}
	return out
}

// hasDerived reports whether the frame declares at least one
// derived-under-test source. A gate with none re-proves only the law, which is
// exactly R5-5's vacuity: "a gate that reads every input at pin ... tests no
// derived state". The heartbeat scan and the tokenConfig sweep are the two
// gates whose subject legitimately is not derived arithmetic, and they say so
// through frameNoDerivedJustified.
func (f *gateFrame) hasDerived() bool {
	for _, s := range f.Sources {
		if s.Kind == frameDerived {
			return true
		}
	}
	return false
}

// frameNoDerivedJustified names the gates permitted to declare no
// derived-under-test source, each with the reason. Anything else must weld our
// own state or it is re-proving arithmetic we already proved.
var frameNoDerivedJustified = map[string]string{
	gateTokenConfig: "the sweep's subject is the PROVIDER's attested composition at one pin (chain-truth R3.1: a SAMPLE, not ledger — the provider is not in the walker stream set), welded against the chain universe and the committed registry; there is no derived arithmetic to test, and claiming one would be a false declaration",
	gateRegistry:    "the registry-consistency gate judges recon/feeds.json (the CLAIM) against the chain enumeration at pin (chain-truth R2: C is not a witness at all); both sides are non-derived by construction",
}

// frameSet is the run's whole collection of gate frames.
type frameSet struct {
	frames []*gateFrame
}

func (fs *frameSet) add(f *gateFrame) *gateFrame {
	fs.frames = append(fs.frames, f)
	return f
}

// violations returns every frame's violations plus the no-derived-source
// vacuity check.
func (fs *frameSet) violations() []string {
	var out []string
	for _, f := range fs.frames {
		out = append(out, f.violations()...)
		if !f.hasDerived() {
			if _, ok := frameNoDerivedJustified[f.Gate]; !ok {
				out = append(out, fmt.Sprintf("gate %s declares NO derived-under-test source — it can only re-prove the law, which is risk-quant R5-5's vacuity shape; either weld our own state or argue the gate onto frameNoDerivedJustified with a reason", f.Gate))
			}
		}
	}
	return out
}

// section renders the frames for the artifact: kind-grouped, sorted, with the
// tolerance citations and the no-derived justification where it applies.
func (fs *frameSet) section() []map[string]any {
	out := make([]map[string]any, 0, len(fs.frames))
	for _, f := range fs.frames {
		byKind := map[string][]map[string]string{}
		for _, s := range f.Sources {
			byKind[s.Kind] = append(byKind[s.Kind], map[string]string{
				"name": s.Name, "detail": s.Detail, "consumed": fmt.Sprintf("%v", f.used[s.Name]),
			})
		}
		for k := range byKind {
			rows := byKind[k]
			sort.Slice(rows, func(i, j int) bool { return rows[i]["name"] < rows[j]["name"] })
		}
		row := map[string]any{
			"gate":               f.Gate,
			frameDerived:         byKind[frameDerived],
			framePinned:          byKind[framePinned],
			frameCommitted:       byKind[frameCommitted],
			"tolerances_cited":   f.Tolerances,
			"frame_violations":   f.violations(),
			"declares_derived":   f.hasDerived(),
			"tolerance_registry": "exactly three tolerances are permitted in the whole run; every other comparison is bit-exact, zero units",
		}
		if j, ok := frameNoDerivedJustified[f.Gate]; ok {
			row["no_derived_justification"] = j
		}
		out = append(out, row)
	}
	sort.Slice(out, func(i, j int) bool {
		return out[i]["gate"].(string) < out[j]["gate"].(string)
	})
	return out
}

// toleranceAppearances counts, per permitted tolerance, which gates cited it —
// the report's "the three tolerances' appearances" line. A tolerance with zero
// appearances is recorded as zero rather than dropped: "we never needed it" is
// a finding, and so is "we needed it everywhere".
func (fs *frameSet) toleranceAppearances() map[string][]string {
	out := map[string][]string{}
	for _, t := range allTolerances {
		out[t.String()] = []string{}
	}
	for _, f := range fs.frames {
		for _, t := range f.cited {
			key := t.String()
			out[key] = append(out[key], f.Gate)
		}
	}
	for t := range out {
		sort.Strings(out[t])
	}
	return out
}
