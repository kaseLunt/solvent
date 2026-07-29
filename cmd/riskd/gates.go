package main

// The pass gate and the recompute trigger — the two places where riskd decides
// whether a number may exist at all.

import (
	"fmt"
	"sort"
	"strings"

	"github.com/kaselunt/solvent/internal/riskfeed"
	"github.com/kaselunt/solvent/internal/store"
)

// watermarkVector is the per-engine (last_block, acked_epoch) pairs plus the
// per-chain max reorg epoch, as read INSIDE one snapshot.
//
// IT IS A VECTOR, NOT A SCALAR (chain-truth R1). The coherent derived head is
// per engine: two position engines on two chains, a param engine, and the price
// pollers' unified cursors. A scalar "latest block" would be a number belonging
// to no engine.
type watermarkVector struct {
	Engines   map[string]store.DeriveCursorState
	MaxEpochs map[int64]int64
	// Sweep is the per-engine durable sweep aggregate. It is part of the vector
	// because `ApplySweepBatch` moves Debt Manager collateral WITHOUT moving any
	// derive cursor or reorg epoch — see store.RiskSweepWatermark for the two
	// stale-publication directions a cursor-only trigger misses.
	Sweep map[string]store.RiskSweepWatermark
}

func newWatermarkVector(cursors []store.DeriveCursorState, maxEpochs map[int64]int64, sweeps []store.RiskSweepWatermark, consumed []string) watermarkVector {
	want := map[string]bool{}
	for _, e := range consumed {
		if e != "" {
			want[e] = true
		}
	}
	v := watermarkVector{
		Engines:   map[string]store.DeriveCursorState{},
		MaxEpochs: map[int64]int64{},
		Sweep:     map[string]store.RiskSweepWatermark{},
	}
	for _, c := range cursors {
		if want[c.Engine] {
			v.Engines[c.Engine] = c
		}
	}
	for chain, epoch := range maxEpochs {
		v.MaxEpochs[chain] = epoch
	}
	for _, s := range sweeps {
		v.Sweep[s.Engine] = s
	}
	return v
}

// sweepEqual compares two sweep aggregates by VALUE. *big.Int needs Cmp (a
// pointer comparison would report every read as a change and recompute forever),
// and the timestamp needs its presence flag so "never swept" stays distinct from
// "swept at the zero time".
func sweepEqual(a, b store.RiskSweepWatermark) bool {
	if a.Rows != b.Rows || a.Failed != b.Failed ||
		a.Generation != b.Generation || a.GenerationOpen != b.GenerationOpen ||
		a.HasUpdatedAt != b.HasUpdatedAt {
		return false
	}
	if a.HasUpdatedAt && !a.MaxUpdatedAt.Equal(b.MaxUpdatedAt) {
		return false
	}
	switch {
	case a.SuccessSum == nil && b.SuccessSum == nil:
	case a.SuccessSum == nil || b.SuccessSum == nil:
		return false
	default:
		if a.SuccessSum.Cmp(b.SuccessSum) != 0 {
			return false
		}
	}
	return true
}

// Changed reports whether this vector differs from the previous one.
//
// THE COMPARISON IS ON (last_block, acked_epoch), NEVER last_block ALONE. After
// a rewind→ack→prune cycle the walker re-walks and `last_block` regains its old
// height, so a height-only comparison sees nothing changed and riskd keeps
// serving numbers computed from a chain that no longer exists — the ABA
// blindspot (chain-truth R1/R2). acked_epoch is monotone and survives pruning,
// so it is the leg that always moves.
//
// A vanished engine counts as a change: its rows are about to stop being truth.
func (v watermarkVector) Changed(prev watermarkVector) bool {
	if len(v.Engines) != len(prev.Engines) {
		return true
	}
	for engine, cur := range v.Engines {
		old, ok := prev.Engines[engine]
		if !ok {
			return true
		}
		if cur.LastBlock != old.LastBlock || cur.AckedEpoch != old.AckedEpoch || cur.ChainID != old.ChainID {
			return true
		}
	}
	// A recorded-but-unacked epoch is a change even when no cursor moved: it is
	// the complementary leg of the same signal, and the pass gate below will
	// refuse on it — which is a state the daemon must notice in order to report.
	if len(v.MaxEpochs) != len(prev.MaxEpochs) {
		return true
	}
	for chain, epoch := range v.MaxEpochs {
		if prev.MaxEpochs[chain] != epoch {
			return true
		}
	}
	// THE SWEEP LEG. A sweep transition moves no cursor and no epoch, so without
	// this a first successful sweep leaves a published SWEEP_NEVER refusal
	// standing, and a post-success failure leaves the previous UNFLAGGED result
	// standing — each until some unrelated cursor happened to move.
	if len(v.Sweep) != len(prev.Sweep) {
		return true
	}
	for engine, cur := range v.Sweep {
		old, ok := prev.Sweep[engine]
		if !ok || !sweepEqual(cur, old) {
			return true
		}
	}
	return false
}

// String renders the vector for logs, deterministically.
func (v watermarkVector) String() string {
	engines := make([]string, 0, len(v.Engines))
	for e := range v.Engines {
		engines = append(engines, e)
	}
	sort.Strings(engines)
	parts := make([]string, 0, len(engines))
	for _, e := range engines {
		c := v.Engines[e]
		parts = append(parts, fmt.Sprintf("%s@%d/ack%d", e, c.LastBlock, c.AckedEpoch))
	}
	chains := make([]int64, 0, len(v.MaxEpochs))
	for c := range v.MaxEpochs {
		chains = append(chains, c)
	}
	sort.Slice(chains, func(i, j int) bool { return chains[i] < chains[j] })
	for _, c := range chains {
		parts = append(parts, fmt.Sprintf("chain%d:maxepoch%d", c, v.MaxEpochs[c]))
	}
	return strings.Join(parts, " ")
}

// gateResult is the pass gate's verdict.
type gateResult struct {
	OK      bool
	Reasons []string
}

// Err renders the refusal, or nil.
func (g gateResult) Err() error {
	if g.OK {
		return nil
	}
	return fmt.Errorf("%w: %s", errPassGated, strings.Join(g.Reasons, "; "))
}

// gatePass is the compute-time reorg gate (design spec §3 step 2, chain-truth
// R1/R2 Window A).
//
// # What it closes
//
// `store.Rewind` commits a reorg epoch atomically with the raw-log deletion; the
// derive runner's acknowledgement lands on its NEXT step. Between those two
// commits, `position_balances` holds state derived from blocks that no longer
// exist. A pass computing in that window produces a health factor for a chain
// that was never mined and stamps it "fresh". Requiring
// `acked_epoch >= COALESCE(max_epoch(chain), 0)` for every engine whose rows
// this pass treats as TRUTH refuses exactly that window — the same refusal
// `ApplyDerivedWithRates` makes on the write side.
//
// # Why the refusal is retryable and not fatal
//
// The condition is transient by construction: the runner's next step acks. A
// pass that aborts here has produced nothing, changed nothing, and will be
// retried on the next poll tick. Treating it as an error would turn ordinary
// reorg handling into an outage.
//
// # Which engines are gated here, and which are not
//
// Position and param engines are gated at the PASS level: their rows are the
// truth a batch is made of, and there is no honest partial answer when they are
// mid-rewind. PRICE engines are deliberately NOT gated here — they are gated
// per position by G2 (design spec §7), so an unacknowledged price reorg on one
// chain refuses that chain's positions instead of the whole book, including the
// other chain's.
//
// # Where the arithmetic lives
//
// It DELEGATES to riskfeed.GateEpochs, which is the single importable home for
// the predicate (see internal/riskfeed/gate.go). The pipeline-replay harness's
// reorg leg and, later, cmd/api need the same decision, and `package main`
// cannot be imported — so a gate implemented only here would force every other
// caller to write a lookalike, and a lookalike that passes while the original is
// wrong is the whole hazard. This function keeps the daemon-shaped signature and
// owns none of the arithmetic.
func gatePass(v watermarkVector, gated []riskfeed.RequiredCursor) (gateResult, error) {
	cursors := make([]store.DeriveCursorState, 0, len(v.Engines))
	for _, c := range v.Engines {
		cursors = append(cursors, c)
	}
	verdict, err := riskfeed.GateEpochs(cursors, v.MaxEpochs, gated)
	if err != nil {
		// An empty requirement set is a PROGRAMMING error, not a gated pass: the
		// daemon must not proceed on a gate that could only ever have allowed.
		return gateResult{}, err
	}
	return gateResult{OK: verdict.OK, Reasons: verdict.Reasons()}, nil
}

// stampsFor renders the vector as the per-engine batch stamps (design spec §4).
//
// Every consumed engine is stamped, gated or not: the supersession check
// `cmd/api` runs needs the price engines' pairs too, because a price reorg after
// compute time supersedes a batch exactly as a position reorg does.
func stampsFor(v watermarkVector) []store.RiskBatchWatermark {
	engines := make([]string, 0, len(v.Engines))
	for e := range v.Engines {
		engines = append(engines, e)
	}
	sort.Strings(engines)
	out := make([]store.RiskBatchWatermark, 0, len(engines))
	for _, e := range engines {
		c := v.Engines[e]
		m := store.RiskBatchWatermark{
			Engine:            c.Engine,
			ChainID:           c.ChainID,
			LastBlock:         c.LastBlock,
			AckedEpoch:        c.AckedEpoch,
			MaxEpochAtCompute: v.MaxEpochs[c.ChainID],
		}
		// The sweep state the batch CONSUMED is stamped alongside the cursor
		// pair, for the same reason the pair is stamped: a serving surface has to
		// be able to ask whether what it is about to serve is still current, and
		// for Debt Manager collateral the sweep IS the freshness.
		if s, ok := v.Sweep[c.Engine]; ok {
			sw := s
			m.Sweep = &sw
		}
		out = append(out, m)
	}
	return out
}
