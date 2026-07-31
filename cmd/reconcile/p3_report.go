// The human rendering of the Task-6 section. The JSON is the artifact; this
// text is what a reviewer reads first, so it leads with the things a reviewer
// must not have to dig for: the per-gate exact/failed counts, EVERY gated
// failure verbatim, the cohort compositions against their floors, the three
// tolerances' appearances, and the per-gate input-frame declaration.
package main

import (
	"fmt"
	"sort"
	"strings"
)

func renderP3Text(p *p3Result) string {
	var b strings.Builder
	b.WriteString("\n=== P3 Task 6 — the proof surface ===\n")

	counts := p3Counts(p.Rows)
	gates := make([]string, 0, len(counts))
	for g := range counts {
		gates = append(gates, g)
	}
	sort.Strings(gates)
	total := 0
	for _, g := range gates {
		c := counts[g]
		total += c[1]
		fmt.Fprintf(&b, "  %-34s gated %4d  failed %4d  evidence %4d\n", g, c[0], c[1], c[2])
	}
	fmt.Fprintf(&b, "  P3 gated failures: %d over %d rows\n", total, len(p.Rows))

	// EVERY gated failure, verbatim. No cap: a truncated failure list is how a
	// finding stops being reportable.
	var failures []p3Row
	for _, r := range p.Rows {
		if r.Gated && verdictIsFailure(r.Verdict) {
			failures = append(failures, r)
		}
	}
	if len(failures) > 0 {
		b.WriteString("\n  GATED FAILURES (verbatim, uncapped):\n")
		for _, r := range failures {
			fmt.Fprintf(&b, "  - [%s] %s / %s: %s\n      expected(chain)=%s\n      actual(derived)=%s\n",
				r.Verdict, r.Gate, r.Leg, r.Subject, r.Expected, r.Actual)
			if r.Class != "" {
				fmt.Fprintf(&b, "      class=%s\n", r.Class)
			}
			if r.Note != "" {
				fmt.Fprintf(&b, "      %s\n", r.Note)
			}
			for _, k := range sortedMapKeys(r.Evidence) {
				fmt.Fprintf(&b, "      %s = %s\n", k, r.Evidence[k])
			}
		}
	}

	// The gated SUCCESSES that are not plain `exact` — printed in their own section
	// so they are visible without being counted as failures.
	var notable []p3Row
	for _, r := range p.Rows {
		if r.Gated && !verdictIsFailure(r.Verdict) && r.Verdict != verdictExact {
			notable = append(notable, r)
		}
	}
	if len(notable) > 0 {
		b.WriteString("\n  GATED SUCCESSES (not failures; richer verdicts than plain exact):\n")
		for _, r := range notable {
			fmt.Fprintf(&b, "  - [%s] %s / %s: %s\n", r.Verdict, r.Gate, r.Leg, r.Subject)
			if r.Note != "" {
				fmt.Fprintf(&b, "      %s\n", r.Note)
			}
		}
	}

	// The DISCLOSED classes (Wave H3): boundary-crossing motion and never-swept
	// coverage-gaps are ungated EVIDENCE rows, but a disclosure a reviewer
	// cannot see in the human artifact is not a disclosure — printed verbatim,
	// uncapped (both classes are bounded by their own population gates).
	var disclosed []p3Row
	for _, r := range p.Rows {
		if r.Verdict == verdictBoundaryMotion || strings.Contains(r.Class, "never-swept-coverage-gap") {
			disclosed = append(disclosed, r)
		}
	}
	if len(disclosed) > 0 {
		b.WriteString("\n  DISCLOSED CLASSES (ungated evidence rows, each INDIVIDUALLY proven; the census rows below gate their populations):\n")
		for _, r := range disclosed {
			fmt.Fprintf(&b, "  - [%s] %s / %s: %s\n      expected(chain)=%s\n      actual(derived)=%s\n      class=%s\n",
				r.Verdict, r.Gate, r.Leg, r.Subject, r.Expected, r.Actual, r.Class)
			if r.Note != "" {
				fmt.Fprintf(&b, "      %s\n", r.Note)
			}
			for _, k := range sortedMapKeys(r.Evidence) {
				fmt.Fprintf(&b, "      %s = %s\n", k, r.Evidence[k])
			}
		}
	}

	// Cohort floors, always printed whether they passed or not.
	b.WriteString("\n  COHORT FLOORS (population-derived, census-welded):\n")
	for _, r := range p.Rows {
		if !strings.HasPrefix(r.Subject, "cohort:") && !strings.HasPrefix(r.Subject, "composition:") {
			continue
		}
		fmt.Fprintf(&b, "  - %-46s %-8s got %s want %s\n", r.Subject, r.Verdict, r.Actual, r.Expected)
	}

	// The three tolerances' appearances — always all three, including zeros.
	b.WriteString("\n  THE THREE PERMITTED TOLERANCES (appearances; every other comparison is bit-exact, zero units):\n")
	for _, t := range sortedSliceMapKeys(p.Tolerances) {
		where := p.Tolerances[t]
		if len(where) == 0 {
			fmt.Fprintf(&b, "  - %s\n      cited by: (none this run)\n", t)
			continue
		}
		fmt.Fprintf(&b, "  - %s\n      cited by: %s\n", t, strings.Join(where, ", "))
	}

	// Backtest table.
	if len(p.Backtest) > 0 {
		b.WriteString("\n  REALIZED-LIQUIDATION BACKTEST (frozen frame):\n")
		evaluated, states := 0, map[string]int{}
		for _, c := range p.Backtest {
			if c.Evaluated {
				evaluated++
			}
			if c.EligibilityState != "" {
				states[c.EligibilityState]++
			}
		}
		fmt.Fprintf(&b, "    evaluated %d/%d; eligibility states: %v\n", evaluated, len(p.Backtest), states)
		for _, c := range p.Backtest {
			marker := " "
			if !c.Evaluated {
				marker = "!"
			}
			fmt.Fprintf(&b, "  %s %-8s blk %-10d li %-4d fanout %-3d %-42s %s\n",
				marker, c.Bucket, c.Block, c.LogIndex, c.Fanout, c.Selection, c.EligibilityState)
			if c.SkipClass != "" {
				fmt.Fprintf(&b, "        NOT EVALUATED: %s\n", c.SkipClass)
			}
			if c.MarginUSD6 != "" {
				fmt.Fprintf(&b, "        |debt - maxBorrowLT| = %s USD-6; %s\n", c.MarginUSD6, c.PriceDeltaNote)
			}
		}
	}

	// B3 verdicts.
	if len(p.Heartbeat) > 0 {
		b.WriteString("\n  B3 HEARTBEAT SCAN (refute-or-grade):\n")
		for _, v := range p.Heartbeat {
			fmt.Fprintf(&b, "  - %-8s %s %-30s heartbeat %ds grace %ds | updates %d | max gap %ds p99 %ds | %s\n",
				v.Symbol, v.Aggregator, v.Stream, v.Heartbeat, v.Grace, v.Updates, v.MaxGapSeconds, v.P99GapSeconds, v.Verdict)
			fmt.Fprintf(&b, "        domain [%d,%d]; budget after scan %ds; grade: %s\n",
				v.DomainFromBlock, v.DomainToBlock, v.BudgetSeconds, v.ProvenanceGrade)
			if v.MaxGapDetail != "" {
				fmt.Fprintf(&b, "        max gap at %s\n", v.MaxGapDetail)
			}
			if v.PhaseChecked {
				fmt.Fprintf(&b, "        phase-change check: proxy.aggregator()@pin = %s\n", v.PhaseAggregator)
			}
		}
	}

	// tokenConfig composition trees.
	if len(p.TokenConfig) > 0 {
		b.WriteString("\n  TOKENCONFIG SWEEP (input:pinned-read SAMPLE — no continuity claim; composition trees):\n")
		for _, t := range p.TokenConfig {
			fmt.Fprintf(&b, "  - %-12s %s chain=%v registry=%v read=%v stable=%v base=%s\n",
				t.Symbol, t.TokenHex, t.InChain, t.InRegistry, t.Read, t.IsStable, orDash(t.BaseAsset))
			for _, line := range t.Composition {
				fmt.Fprintf(&b, "        %s\n", line)
			}
			if t.ReadNote != "" {
				fmt.Fprintf(&b, "        read note: %s\n", t.ReadNote)
			}
		}
	}

	// The input-frame declarations.
	b.WriteString("\n  INPUT-FRAME DECLARATIONS (a component consuming an undeclared source FAILS the run):\n")
	for _, fr := range p.Frames {
		fmt.Fprintf(&b, "  - gate %s (declares derived: %v)\n", fr["gate"], fr["declares_derived"])
		for _, kind := range []string{frameDerived, framePinned, frameCommitted} {
			rows, _ := fr[kind].([]map[string]string)
			if len(rows) == 0 {
				continue
			}
			fmt.Fprintf(&b, "      %s:\n", kind)
			for _, r := range rows {
				fmt.Fprintf(&b, "        [consumed=%s] %s\n", r["consumed"], r["name"])
			}
		}
		if j, ok := fr["no_derived_justification"].(string); ok {
			fmt.Fprintf(&b, "      no-derived justification: %s\n", j)
		}
		if v, ok := fr["frame_violations"].([]string); ok && len(v) > 0 {
			for _, s := range v {
				fmt.Fprintf(&b, "      FRAME VIOLATION: %s\n", s)
			}
		}
	}

	b.WriteString("\n  SUMMARY KEYS:\n")
	for _, k := range sortedAnyKeys(p.Summary) {
		fmt.Fprintf(&b, "    %s = %v\n", k, p.Summary[k])
	}
	return b.String()
}

func sortedMapKeys(m map[string]string) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	sort.Strings(out)
	return out
}

func sortedSliceMapKeys(m map[string][]string) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	sort.Strings(out)
	return out
}

func sortedAnyKeys(m map[string]any) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	sort.Strings(out)
	return out
}

func orDash(s string) string {
	if s == "" {
		return "USD(terminal)"
	}
	return s
}
