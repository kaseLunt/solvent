// Per-round health-condition composition: every daemon pass writes into one
// roundConditions map and the round publishes ONCE, so two passes judging the
// same worker are additive instead of destructive.
package main

import "log/slog"

// roundConditions accumulates EVERY worker's conditions for ONE daemon round so
// each worker's entry set reaches the surface in a single replacement.
//
// IT IS THE ONLY WAY RECOVERABLE CONDITIONS REACH THE SURFACE, and that is a
// correctness property, not a style choice. Publication REPLACES a worker's
// entries — which is what makes recovery visible — so two passes publishing the
// same worker separately erase each other and the survivor depends on pass order.
// That is not hypothetical: the frontier pass and the price pass both own the
// Chainlink feed deriver (it is a raw-log consumer AND a price worker), and while
// they published independently the later one deleted the earlier one's conditions
// every round. Composing first makes them additive.
//
// Two things keep it that way rather than merely fixing that instance:
//
//   - there is no per-worker replace primitive left to misuse. healthState exposes
//     publishRound, which takes the WHOLE round's composition; a new publisher has
//     nowhere to write except into a roundConditions someone else may also write to,
//     and set() merges by condition name.
//   - a second publication of the same worker inside ONE round is detected by
//     healthState and MERGED rather than allowed to replace, with an Error log
//     naming the worker. See healthState.publishRound.
type roundConditions map[string]map[string]string

// set records one condition for one worker. Two different conditions on one worker
// coexist; the same condition name written twice in one round is a NAME COLLISION
// between publishers, which is reported and resolved first-writer-wins — readiness
// turns on a condition's presence, so the collision itself is the defect worth
// surfacing, not which of the two reasons survived.
func (rc roundConditions) set(worker, name, reason string) {
	m := rc[worker]
	if m == nil {
		m = map[string]string{}
		rc[worker] = m
	}
	if existing, dup := m[name]; dup {
		slog.Error("two daemon passes published the SAME condition key for the same worker in one round; keeping the first and reporting the collision — condition keys are an operational contract and must identify one publisher",
			"worker", worker, "condition", name, "kept", existing, "dropped", reason)
		return
	}
	m[name] = reason
}

// touch registers a worker with (so far) no conditions. Without it a recovered
// worker would keep its previous round's entries forever, because publication only
// replaces the workers it knows about.
func (rc roundConditions) touch(worker string) {
	if rc[worker] == nil {
		rc[worker] = map[string]string{}
	}
}

// has reports whether this round already carries a named condition for a worker.
//
// It exists for ONE purpose: making an attribution-only signal structurally unable
// to act as a gate. frontier_lag is emitted only when the same consumer already
// carries a freshness verdict this round (amendment L3), and asking the round's own
// composition is what makes that a property of the code rather than a convention a
// later publisher could quietly break.
func (rc roundConditions) has(worker, name string) bool {
	_, ok := rc[worker][name]
	return ok
}

// publish hands the whole round's composition to the surface in one call.
func (rc roundConditions) publish(health *healthState) {
	health.publishRound(rc)
}
