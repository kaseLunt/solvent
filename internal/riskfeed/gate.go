package riskfeed

// The compute-time reorg gate, in ONE importable home.
//
// # Why this lives here and not in cmd/riskd
//
// The gate is the predicate that decides whether derived rows may be computed
// from at all: every consumed engine must have acknowledged every reorg epoch on
// its chain. Three callers need it — `cmd/riskd` (the producer), the
// pipeline-replay harness (whose reorg leg asserts a riskd-shaped consumer
// refuses at the gate), and eventually `cmd/api`'s supersession surface.
//
// `cmd/riskd` is `package main` and therefore importable by nobody, so a gate
// implemented only there forces every other caller to write its own. The P3 plan
// anticipated exactly this: the harness's leg (c) "asserts through a thin test
// consumer using store.DeriveCursorStates/MaxReorgEpochs directly (same
// predicate, promoted to the real reader in Task 5's wave)". This is that
// promotion — the real reader, exported, so the harness can consume the
// implementation it is meant to be testing instead of a lookalike.
//
// Two implementations of "how deep must an ack reach before derived state is
// trustworthy" is the same hazard `store.rewindTarget` exists as a single home to
// prevent: the copy passes while the original is wrong, and the gate is the last
// thing standing between a rewound chain and a published health factor.

import (
	"fmt"
	"sort"

	"github.com/kaselunt/solvent/internal/store"
)

// EpochGateRefusal is one engine's reason for refusing a pass.
type EpochGateRefusal struct {
	Engine     string
	ChainID    int64
	AckedEpoch int64
	MaxEpoch   int64
	Reason     string
}

// EpochGateVerdict is the gate's decision over a whole engine set.
type EpochGateVerdict struct {
	OK       bool
	Refusals []EpochGateRefusal
	// Missing names engines that have no derive cursor row at all. That is a
	// COLD START, not a reorg — an engine which has never applied a window has
	// no rows a rewind could have invalidated — so it does NOT refuse the pass.
	// It is reported because a caller may have its own reason to care (the
	// harness asserts on the distinction; riskd lets the per-position paths
	// report the resulting absent inputs by name).
	Missing []string
}

// Reasons renders every refusal, engine-ordered, for a log line or an error.
func (v EpochGateVerdict) Reasons() []string {
	out := make([]string, 0, len(v.Refusals))
	for _, r := range v.Refusals {
		out = append(out, r.Reason)
	}
	return out
}

// GateEpochs is the compute-time reorg gate (design spec §3 step 2; chain-truth
// R1/R2 Window A).
//
// # What it closes
//
// `store.Rewind` commits a reorg epoch atomically with the raw-log deletion; the
// derive runner's acknowledgement lands on its NEXT step. Between those two
// commits, `position_balances` holds state derived from blocks that no longer
// exist. A consumer computing in that window produces a health factor for a
// chain that was never mined and stamps it "fresh". Requiring
// `acked_epoch >= COALESCE(max_epoch(chain), 0)` for every engine whose rows are
// treated as TRUTH refuses exactly that window — the same refusal
// `ApplyDerivedWithRates` makes on the write side.
//
// # It must be called on a SINGLE SNAPSHOT
//
// `cursors` and `maxEpochs` must come from one repeatable-read transaction
// (`store.BeginRiskSnapshot` + the two verbatim readers). Read under autocommit
// they can straddle a rewind and describe a state no instant of the database
// ever held — which is the race the gate exists to close, reintroduced in the
// gate itself.
//
// # The refusal is RETRYABLE, never fatal
//
// The condition is transient by construction: the runner's next step acks. A
// caller that stops here has produced nothing and changed nothing.
func GateEpochs(cursors []store.DeriveCursorState, maxEpochs map[int64]int64, engines []string) EpochGateVerdict {
	byEngine := make(map[string]store.DeriveCursorState, len(cursors))
	for _, c := range cursors {
		byEngine[c.Engine] = c
	}

	want := make([]string, 0, len(engines))
	seen := map[string]bool{}
	for _, e := range engines {
		if e == "" || seen[e] {
			continue
		}
		seen[e] = true
		want = append(want, e)
	}
	sort.Strings(want)

	v := EpochGateVerdict{OK: true}
	for _, engine := range want {
		c, ok := byEngine[engine]
		if !ok {
			v.Missing = append(v.Missing, engine)
			continue
		}
		maxEpoch := maxEpochs[c.ChainID]
		if c.AckedEpoch < maxEpoch {
			v.OK = false
			v.Refusals = append(v.Refusals, EpochGateRefusal{
				Engine: engine, ChainID: c.ChainID, AckedEpoch: c.AckedEpoch, MaxEpoch: maxEpoch,
				Reason: fmt.Sprintf(
					"engine %s on chain %d carries unacknowledged reorg epoch %d (acked %d): its derived rows may describe blocks the raw rewind already deleted",
					engine, c.ChainID, maxEpoch, c.AckedEpoch),
			})
		}
	}
	return v
}
