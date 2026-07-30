package main

import (
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
)

// TestExactlyThreeTolerancesArePermitted is risk-quant R5-5's closed set as a
// test: "the run's only permitted tolerances are the three derived in R1/R2 …
// Any other epsilon appearing in the Task 6 diff is tolerance-as-carpet and
// blocks." Three, by count and by identity.
func TestExactlyThreeTolerancesArePermitted(t *testing.T) {
	require.Len(t, permittedTolerances, 3,
		"exactly three tolerances are permitted in the whole run; a fourth is tolerance-as-carpet")
	for _, want := range allTolerances {
		_, ok := permittedTolerances[want]
		require.True(t, ok, "the registry must carry %q", want)
	}
	// Each constant must name its MECHANISM, its DIRECTION and its BOUND — a
	// tolerance missing any of the three is a carpet with a label on it.
	require.Contains(t, tolResidueWei.String(), "DebtManagerCore.sol:549-553", "mechanism cited")
	require.Contains(t, tolResidueWei.String(), "fully-liquidated only", "scope")
	require.Contains(t, tolResidueWei.String(), "derived-high direction only", "direction")
	require.Contains(t, tolSeizureTokenWei.String(), "truncation", "mechanism")
	require.Contains(t, tolSeizureTokenWei.String(), "per element", "bound scope")
	require.Contains(t, tolIntraBlockMarginality.String(), "DISCLOSURE, never absorption", "it is not a numeric allowance")
}

// TestFrameLedgerFailsOnAnUndeclaredConsumption is the R5-5 laundering shape: a
// gate that reaches for an input its declaration does not admit must FAIL the
// run, because nobody reading the declaration would know what the gate welded.
func TestFrameLedgerFailsOnAnUndeclaredConsumption(t *testing.T) {
	f := newGateFrame("test_gate", derived("declared.source", "under test"))
	f.use("declared.source")
	require.Empty(t, f.violations(), "a fully declared, fully consumed frame is clean")

	f.use("smuggled.source@pin")
	v := f.violations()
	require.Len(t, v, 1)
	require.Contains(t, v[0], "CONSUMED an undeclared source")
	require.Contains(t, v[0], "smuggled.source@pin")
}

// TestFrameLedgerFailsOnADeclaredButUnconsumedSource is the other direction: a
// declaration that still claims to test something the code stopped reading is
// how a gate silently shrinks its own scope while its documentation keeps
// promising the old one.
func TestFrameLedgerFailsOnADeclaredButUnconsumedSource(t *testing.T) {
	f := newGateFrame("test_gate",
		derived("consumed.source", ""),
		pinned("forgotten.read@pin", ""),
	)
	f.use("consumed.source")
	v := f.violations()
	require.Len(t, v, 1)
	require.Contains(t, v[0], "DECLARED source")
	require.Contains(t, v[0], "forgotten.read@pin")
	require.Contains(t, v[0], "never consumed it")
}

// TestFrameLedgerRefusesAnUnregisteredTolerance closes the fourth-epsilon door
// at run time as well as at test time: a gate can cite anything, and the ledger
// turns an unregistered citation into a gated row.
func TestFrameLedgerRefusesAnUnregisteredTolerance(t *testing.T) {
	f := newGateFrame("test_gate", derived("s", ""))
	f.use("s")
	// A citation outside the closed set is UNREPRESENTABLE since round 1's
	// finding 2: cite takes toleranceID, and there is no fourth value of that
	// type. The line below does not compile, which IS the enforcement:
	//   f.cite("within-one-percent(because-it-looked-close)")
	// What remains checkable at run time is a constant added without a
	// permittedTolerances entry, so that is what this asserts.
	f.cited = append(f.cited, toleranceID(99))
	v := f.violations()
	require.Len(t, v, 1)
	require.Contains(t, v[0], "NOT one of the three permitted tolerances")
	require.Contains(t, v[0], "tolerance-as-carpet")

	// A registered one is clean, and citing twice does not duplicate.
	g := newGateFrame("test_gate2", derived("s", ""))
	g.use("s")
	g.cite(tolResidueWei)
	g.cite(tolResidueWei)
	require.Empty(t, g.violations())
	require.Len(t, g.cited, 1, "citing twice must not duplicate")
	require.Len(t, g.Tolerances, 1)
}

// TestAGateWithNoDerivedSourceIsVacuousUnlessJustified is R5-5's central
// finding: "a gate that reads every input at pin — scaled balances included —
// re-proves only the law (already proven) and tests no derived state."
func TestAGateWithNoDerivedSourceIsVacuousUnlessJustified(t *testing.T) {
	fs := &frameSet{}
	fs.add(newGateFrame("all_pinned_gate", pinned("everything@pin", "")))
	fs.frames[0].use("everything@pin")
	v := fs.violations()
	require.Len(t, v, 1)
	require.Contains(t, v[0], "declares NO derived-under-test source")
	require.Contains(t, v[0], "vacuity")

	// The two gates whose SUBJECT legitimately is not derived arithmetic are
	// justified by name, with a reason.
	for _, gate := range []string{gateTokenConfig, gateRegistry} {
		fs2 := &frameSet{}
		fs2.add(newGateFrame(gate, pinned("chain@pin", "")))
		fs2.frames[0].use("chain@pin")
		require.Empty(t, fs2.violations(), "%s is justified in frameNoDerivedJustified", gate)
		require.NotEmpty(t, frameNoDerivedJustified[gate], "the justification must state a REASON")
	}
}

// TestEveryRealGateFrameDeclaresBothSidesHonestly walks the production frame
// constructors: each must declare at least one pinned read (a gate with none is
// not welding against the chain at all) and, unless justified, at least one
// derived source.
func TestEveryRealGateFrameDeclaresBothSidesHonestly(t *testing.T) {
	for _, build := range []func() *gateFrame{
		aaveGateFrame, aaveParamWeldFrame, dmParamWeldFrame, registryGateFrame,
		adapterWeldFrame, dmGateFrame, tokenConfigFrame, backtestFrame_, heartbeatFrame,
	} {
		f := build()
		pinnedCount, derivedCount, committedCount := 0, 0, 0
		for _, s := range f.Sources {
			switch s.Kind {
			case framePinned:
				pinnedCount++
			case frameDerived:
				derivedCount++
			case frameCommitted:
				committedCount++
			default:
				t.Fatalf("gate %s declares source %q with unknown kind %q", f.Gate, s.Name, s.Kind)
			}
			require.NotEmpty(t, s.Detail, "gate %s source %q must state WHY it is in the frame", f.Gate, s.Name)
		}
		require.Positive(t, pinnedCount, "gate %s declares no pinned read — it is not welding against the chain", f.Gate)
		if derivedCount == 0 {
			require.NotEmpty(t, frameNoDerivedJustified[f.Gate],
				"gate %s declares no derived source and is not justified", f.Gate)
		}
		_ = committedCount
	}
}

// TestGateFrameNamesAreSpecificEnoughToAudit guards the failure mode a ledger
// cannot catch by itself: a vague name ("the database") would let the ledger
// pass while the frame drifted. Every name must say WHERE the value came from.
func TestGateFrameNamesAreSpecificEnoughToAudit(t *testing.T) {
	for _, build := range []func() *gateFrame{
		aaveGateFrame, aaveParamWeldFrame, dmParamWeldFrame, registryGateFrame,
		adapterWeldFrame, dmGateFrame, tokenConfigFrame, backtestFrame_, heartbeatFrame,
	} {
		f := build()
		for _, s := range f.Sources {
			require.Greater(t, len(s.Name), 20, "gate %s: source name %q is too vague to audit", f.Gate, s.Name)
			switch s.Kind {
			case framePinned:
				require.True(t,
					strings.Contains(s.Name, "@pin") || strings.Contains(s.Name, "@parentHash") ||
						strings.Contains(s.Name, "anchor") || strings.Contains(s.Name, "@own"),
					"gate %s: pinned source %q must name its PIN — an unpinned 'chain read' is not a pinned read", f.Gate, s.Name)
			case frameDerived:
				require.True(t,
					strings.Contains(s.Name, "position_") || strings.Contains(s.Name, "param_history") ||
						strings.Contains(s.Name, "raw_logs") || strings.Contains(s.Name, "prices") ||
						strings.Contains(s.Name, "snapshot_sweeps") || strings.Contains(s.Name, "ingest_cursors") ||
						strings.Contains(s.Name, "price_poll_anchors") || strings.Contains(s.Name, "dm_param_history"),
					"gate %s: derived source %q must name the TABLE it came from", f.Gate, s.Name)
			}
		}
	}
}

// TestToleranceAppearancesAlwaysReportAllThree keeps the report honest in both
// directions: "we never needed it" is a finding and so is "we needed it
// everywhere", so a tolerance with zero appearances is printed as zero rather
// than dropped.
func TestToleranceAppearancesAlwaysReportAllThree(t *testing.T) {
	fs := &frameSet{}
	f := fs.add(newGateFrame(gateBacktest, derived("position_events.delta", "x")))
	f.use("position_events.delta")
	f.cite(tolResidueWei)
	app := fs.toleranceAppearances()
	require.Len(t, app, 3)
	require.Equal(t, []string{gateBacktest}, app[tolResidueWei.String()])
	require.Empty(t, app[tolSeizureTokenWei.String()])
	require.Empty(t, app[tolIntraBlockMarginality.String()])
}
