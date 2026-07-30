// The P3 Task-6 phase: the gate set's driver, run INSIDE the existing
// before/after weld bracket and joined to the existing verdict machinery.
//
// chain-truth R5.4 is explicit about the shape: "New gates join the existing
// verdict machinery — computeResult / taint set / tallyTotals, before/after weld
// bracket, artifact schema — never a side-channel exit path." So this file
// exposes ONE function that returns rows, and Phase 2 sums their gated failures
// into the SAME `gatedFailures` counter every pre-existing gate feeds. There is
// no exit, no os.Exit, no second verdict function; a Task-6 failure reaches the
// process exit code through exactly the path a DM row drift reaches it by.
//
// It runs BETWEEN the "before" fork weld and the Phase-3 "after" fork weld, for
// the reason chain-truth R1.2 gives: requireCanonical=false means an orphaned
// pin serves silently, and the end-of-run re-weld is the only thing that catches
// it. A gate appended after Phase 3 would sit outside that bracket.
package main

import (
	"context"
	"fmt"
	"path/filepath"
	"time"

	"github.com/ethereum/go-ethereum/common"

	"github.com/kaselunt/solvent/cmd/reconcile/snapshotdb"
)

// p3Ctx is the gate set's shared context: readers, pins, the snapshot's derived
// side, the parsed registry and the frame ledger. Everything in it is either a
// plain value or a reader the shared runner owns — there is no database handle,
// because Phase 1 closed it.
type p3Ctx struct {
	o    *options
	p1   *phase1Data
	t6   *snapshotdb.Task6Data
	reg  *registryView
	opR  *pinnedReader
	ethR *pinnedReader
	// logsR is the raw eth_getLogs surface for the L2 basket-continuity
	// sweeps (blockHash-pinned; basket-continuity ruling L2/L6). Nil means no
	// surface is configured and every continuity proof REFUSES — disclosed,
	// never skipped.
	logsR rawLogsBackend

	pinOP, pinETH   uint64
	hashOP, hashETH common.Hash
	dmProxy         common.Address
	aavePool        common.Address

	frames *frameSet
	now    time.Time
	// boundaryTimes memoises hash-bound header timestamps at custody-domain
	// boundaries (several feeds share one boundary).
	boundaryTimes map[uint64]chainHeaderTime
	// scenarioRoot is where internal/risk/scenarios lives relative to the process
	// CWD. Empty means the repo root (the acceptance posture, since `make reconcile`
	// runs there); tests point it at their own relative path.
	scenarioRoot string
}

// scenarioDir resolves the committed scenario definitions the base-composition
// weld loads its EXPECTED side from.
func (c *p3Ctx) scenarioDir() string {
	if c.scenarioRoot == "" {
		return canonicalScenarioDir
	}
	return filepath.Join(c.scenarioRoot, canonicalScenarioDir)
}

// p3Result is everything the phase produces for the artifact.
type p3Result struct {
	Rows        []p3Row              `json:"rows"`
	Frames      []map[string]any     `json:"input_frames"`
	Tolerances  map[string][]string  `json:"tolerance_appearances"`
	TokenConfig []tokenConfigRow     `json:"tokenconfig_sweep"`
	Backtest    []backtestCaseResult `json:"backtest_cases"`
	Heartbeat   []heartbeatVerdict   `json:"b3_heartbeat"`
	Summary     map[string]any       `json:"summary"`
}

// runP3Phase executes every Task-6 gate and returns the rows plus the artifact
// sections. It never aborts on a gate FINDING — only on an environment failure
// that makes further reads meaningless (the existing dmPhaseErr / aavePhaseErr
// classification decides which).
func runP3Phase(ctx context.Context, o *options, p1 *phase1Data, reg *registryView,
	opR, ethR *pinnedReader, opLogs rawLogsBackend, dmProxy, aavePool common.Address, wantDM, wantAave bool) (*p3Result, error) {
	if p1.Task6 == nil {
		return nil, fmt.Errorf("P3 gate set enabled but the Phase-1 snapshot collected no Task-6 derived side — the two are wired from ONE flag, so this is a wiring bug, not a data condition")
	}
	c := &p3Ctx{
		o: o, p1: p1, t6: p1.Task6, reg: reg, opR: opR, ethR: ethR, logsR: opLogs,
		pinOP: p1.Pins[dmEngine], pinETH: p1.Pins[aaveEngine],
		hashOP: p1.pinHashes["op"], hashETH: p1.pinHashes["eth"],
		dmProxy: dmProxy, aavePool: aavePool,
		frames: &frameSet{}, now: time.Now().UTC(),
	}
	out := &p3Result{Summary: map[string]any{}}

	// FINALIZE ON EVERY PATH, including an abort. An aborted run still writes its
	// artifact (main.go's finish), and an artifact whose input-frame declarations
	// and tolerance table are empty is exactly the evidence a reviewer needs most
	// when a run died halfway: it says which gates were reached and what they had
	// declared. Filling these only on the success path would make the abort
	// artifact quieter than the pass artifact, which is backwards.
	defer func() {
		for _, v := range c.frames.violations() {
			out.Rows = append(out.Rows, p3Row{
				Gate: "input_frame_law", Subject: "frame-ledger", Leg: "declaration",
				Verdict: verdictDrift, Gated: true, Class: "input-frame-violation", Note: v,
			})
		}
		out.Frames = c.frames.section()
		out.Tolerances = c.frames.toleranceAppearances()
		out.Summary["gated_failures"] = tallyP3(out.Rows)
		out.Summary["rows"] = len(out.Rows)
		out.Summary["gates_reached"] = len(c.frames.frames)
		out.Summary["tolerance_law"] = "exactly three tolerances are permitted in the whole run (1-wei residue on fully-liquidated accounts; one-token-wei seizure round-trip per element; the disclosed intra-block marginality band). Every other comparison in this phase is bit-exact, zero units; any other epsilon is tolerance-as-carpet and blocks"
		out.Summary["weld_direction"] = "the CHAIN is the expected side of every weld in this phase, without exception: expected_chain vs actual_derived on every row"
		out.Summary["never_seen_seed"] = neverSeenSeed
		out.Summary["backtest_frame_seed"] = backtestFrameSeed
		out.Summary["backtest_frame_digest"] = backtestFrameDigest
		out.Summary["dm_cohort_seed"] = p1.seed + " (the OP pin's block hash, per-gate salted with |dm|<account>)"
	}()

	// --- ETH-side gates -----------------------------------------------------
	if wantAave && ethR != nil {
		rows, err := runAaveHFGate(ctx, c)
		out.Rows = append(out.Rows, rows...)
		if err != nil {
			return out, err
		}
		rows, err = runAaveParamWeld(ctx, c)
		out.Rows = append(out.Rows, rows...)
		if err != nil {
			return out, err
		}
		rows, err = runAdapterOutputWeld(ctx, c)
		out.Rows = append(out.Rows, rows...)
		if err != nil {
			return out, err
		}
		rows, hb, err := runHeartbeatScan(ctx, c, c.now)
		out.Rows = append(out.Rows, rows...)
		out.Heartbeat = hb
		if err != nil {
			return out, err
		}
	}

	// --- OP-side gates ------------------------------------------------------
	if wantDM && opR != nil {
		// The chain's token universe and the per-token pinned state are read
		// ONCE here and shared by every OP-side gate: the DM boolean weld, the
		// DM param weld, the registry gate, the tokenConfig sweep and the
		// backtest all consume the same decimals / engine-exact prices /
		// indexes. Re-issuing them per gate would multiply a deep-archive budget
		// for no extra evidence, and each consumer still records the usage
		// through its own frame, so the declarations stay honest.
		universe, borrow, uRows, err := readDMTokenUniverse(ctx, c)
		out.Rows = append(out.Rows, uRows...)
		if err != nil {
			return out, err
		}
		decimals, prices, indexes, tokenNotes, err := readDMTokenState(ctx, c, universe, borrow)
		if err != nil {
			return out, err
		}
		st := dmTokenState{universe: universe, borrow: borrow, decimals: decimals,
			prices: prices, indexes: indexes, notes: tokenNotes}

		rows, err := runDMBooleanGate(ctx, c, st)
		out.Rows = append(out.Rows, rows...)
		if err != nil {
			return out, err
		}
		rows, err = runDMParamWeld(ctx, c, universe)
		out.Rows = append(out.Rows, rows...)
		if err != nil {
			return out, err
		}
		if wantAave && ethR != nil {
			rows, err = runRegistryGate(ctx, c, universe, borrow, decimals, prices)
			out.Rows = append(out.Rows, rows...)
			if err != nil {
				return out, err
			}
		}
		rows, sweep, err := runTokenConfigSweep(ctx, c, universe, decimals)
		out.Rows = append(out.Rows, rows...)
		out.TokenConfig = sweep
		if err != nil {
			return out, err
		}
		rows, cases, err := runBacktest(ctx, c, decimals)
		out.Rows = append(out.Rows, rows...)
		out.Backtest = cases
		if err != nil {
			return out, err
		}
	}

	// The input-frame law's own verdict, the frame section, the tolerance table
	// and the summary are all filled by the DEFERRED finalizer above, so they are
	// present on the abort path too.
	return out, nil
}

// p3Counts summarises the rows per gate for the text rendering.
func p3Counts(rows []p3Row) map[string][3]int {
	out := map[string][3]int{}
	for _, r := range rows {
		c := out[r.Gate]
		if r.Gated {
			c[0]++
			// THE SAME predicate the JSON tally and the exit code use (Codex round 2,
			// finding M4). This counter feeds the human artifact's per-gate "failed"
			// column and its total; counting every gated non-exact verdict here put a
			// provenance UPGRADE, a QUALIFIER and a causation-proven MARGINAL case in
			// the failure column while the JSON and the exit code passed — two
			// acceptance artifacts giving an operator contradictory answers.
			if verdictIsFailure(r.Verdict) {
				c[1]++
			}
		} else {
			c[2]++
		}
		out[r.Gate] = c
	}
	return out
}
