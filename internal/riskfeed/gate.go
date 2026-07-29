package riskfeed

// The compute-time reorg gate, in ONE importable home.
//
// # Why this lives here and not in cmd/riskd
//
// The gate is the predicate that decides whether derived rows may be computed
// from at all. Three callers need it — `cmd/riskd` (the producer), the
// pipeline-replay harness (whose reorg leg asserts a riskd-shaped consumer
// refuses at the gate), and eventually `cmd/api`'s supersession surface.
//
// `cmd/riskd` is `package main` and therefore importable by nobody, so a gate
// implemented only there forces every other caller to write its own. Two
// implementations of "how deep must an ack reach before derived state is
// trustworthy" is the same hazard `store.rewindTarget` exists as a single home to
// prevent: the copy passes while the original is wrong, and the gate is the last
// thing standing between a rewound chain and a published health factor.
//
// # A GATE REFUSES ON WHAT IT CANNOT SEE, NOT ONLY ON WHAT LOOKS WRONG
//
// The first version of this file took engine NAMES and treated an absent cursor
// as a reportable-but-passing condition. That was a false pass with two teeth:
//
//   - an absent `aave_param` or `debt_manager` cursor sailed through the
//     pass-level gate, so riskd computed against a parameter or position head
//     that had never been proven to exist;
//   - with no expected chain to compare against, a cursor bound to the WRONG
//     chain was gated against that wrong chain's epoch set — which is how an ETH
//     parameter query gets bounded by an OP cursor height and a liquidation
//     threshold comes from a block nobody verified.
//
// The requirement is therefore an (engine, chain_id) PAIR, and every one of the
// three failure modes — missing, wrong-chain, lagging — is a NAMED refusal that
// sets OK=false. A blocker that is merely reported is not a blocker.

import (
	"errors"
	"fmt"
	"sort"

	"github.com/kaselunt/solvent/internal/store"
)

// ErrNoRequiredCursors refuses an empty requirement set as a HARD ERROR rather
// than answering "allowed".
//
// A gate with nothing required can only ever pass, so a caller that computed its
// requirement list wrongly — an empty config, a typo'd engine set — would get a
// green light from the very check meant to stop it. The degenerate case is a
// programming error, and it says so.
var ErrNoRequiredCursors = errors.New("riskfeed: epoch gate called with an empty requirement set — a gate with nothing required can only ever allow, which is never the intended answer")

// Refusal classes, so a caller (and a test) can assert WHICH law fired rather
// than matching on prose.
const (
	// GateReasonMissingCursor — the engine has no derive_cursors row. It has
	// therefore never proven custody of anything, and computing against its
	// rows would be computing against an unproven head.
	GateReasonMissingCursor = "missing_cursor"
	// GateReasonChainMismatch — the cursor exists but is bound to a different
	// chain than the requirement names. Gating it against the wrong chain's
	// epochs, or bounding a query with its height, mixes two chains' block
	// numbers — which are not comparable quantities.
	GateReasonChainMismatch = "chain_mismatch"
	// GateReasonUnackedEpoch — the cursor is on the right chain but has not
	// acknowledged every reorg epoch recorded there.
	GateReasonUnackedEpoch = "unacked_epoch"
)

// RequiredCursor is one binding a pass depends on: an engine AND the chain it
// must be bound to. The chain is not optional — see this file's header.
type RequiredCursor struct {
	Engine  string
	ChainID int64
}

// EpochGateRefusal is one engine's reason for refusing a pass.
type EpochGateRefusal struct {
	Engine string
	// Class is one of the GateReason* constants.
	Class string
	// WantChainID is the chain the requirement named; GotChainID is the chain the
	// cursor is actually bound to (equal except on a chain mismatch, and
	// meaningless when the cursor is missing).
	WantChainID int64
	GotChainID  int64
	AckedEpoch  int64
	MaxEpoch    int64
	Reason      string
}

// EpochGateVerdict is the gate's decision over a whole requirement set.
type EpochGateVerdict struct {
	OK       bool
	Refusals []EpochGateRefusal
}

// Reasons renders every refusal, engine-ordered, for a log line or an error.
func (v EpochGateVerdict) Reasons() []string {
	out := make([]string, 0, len(v.Refusals))
	for _, r := range v.Refusals {
		out = append(out, r.Reason)
	}
	return out
}

// Classes returns the refusal classes present, engine-ordered — the shape a test
// asserts on when it cares WHICH law fired.
func (v EpochGateVerdict) Classes() []string {
	out := make([]string, 0, len(v.Refusals))
	for _, r := range v.Refusals {
		out = append(out, r.Class)
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
// `ApplyDerivedWithRates` makes on the write side — and requiring the cursor to
// EXIST and to name the EXPECTED CHAIN closes the two ways that check can be
// evaded rather than failed.
//
// # It must be called on a SINGLE SNAPSHOT
//
// `cursors` and `maxEpochs` must come from one repeatable-read transaction
// (`store.BeginRiskSnapshot` + the two verbatim readers). Read under autocommit
// they can straddle a rewind and describe a state no instant of the database ever
// held — the race the gate exists to close, reintroduced inside the gate.
//
// # The refusal is RETRYABLE, never fatal
//
// Every class here is transient in normal operation: a lagging ack lands on the
// next step, a missing cursor appears once the engine applies its first window.
// A caller that stops has produced nothing and changed nothing.
func GateEpochs(cursors []store.DeriveCursorState, maxEpochs map[int64]int64, required []RequiredCursor) (EpochGateVerdict, error) {
	byEngine := make(map[string]store.DeriveCursorState, len(cursors))
	for _, c := range cursors {
		byEngine[c.Engine] = c
	}

	// Deduplicate on the PAIR, not the name: the Debt Manager's param engine IS
	// its position engine, so one engine legitimately appears twice with the same
	// chain. The same engine required on TWO different chains is a caller bug and
	// must not be silently collapsed — both requirements stand, and at most one
	// can be satisfied, so the other refuses as a chain mismatch.
	seen := map[RequiredCursor]bool{}
	want := make([]RequiredCursor, 0, len(required))
	for _, r := range required {
		if r.Engine == "" || seen[r] {
			continue
		}
		seen[r] = true
		want = append(want, r)
	}
	if len(want) == 0 {
		return EpochGateVerdict{}, ErrNoRequiredCursors
	}
	sort.Slice(want, func(i, j int) bool {
		if want[i].Engine != want[j].Engine {
			return want[i].Engine < want[j].Engine
		}
		return want[i].ChainID < want[j].ChainID
	})

	v := EpochGateVerdict{OK: true}
	for _, req := range want {
		c, ok := byEngine[req.Engine]
		if !ok {
			v.OK = false
			v.Refusals = append(v.Refusals, EpochGateRefusal{
				Engine: req.Engine, Class: GateReasonMissingCursor,
				WantChainID: req.ChainID,
				Reason: fmt.Sprintf(
					"engine %s has NO derive cursor (expected chain %d): it has never proven custody of any block, so nothing derived from its rows may be computed or served",
					req.Engine, req.ChainID),
			})
			continue
		}
		if c.ChainID != req.ChainID {
			v.OK = false
			v.Refusals = append(v.Refusals, EpochGateRefusal{
				Engine: req.Engine, Class: GateReasonChainMismatch,
				WantChainID: req.ChainID, GotChainID: c.ChainID,
				Reason: fmt.Sprintf(
					"engine %s is bound to chain %d but this pass requires chain %d: its height would bound a query on the wrong chain, and its epochs are another chain's epochs",
					req.Engine, c.ChainID, req.ChainID),
			})
			continue
		}
		maxEpoch := maxEpochs[c.ChainID]
		if c.AckedEpoch < maxEpoch {
			v.OK = false
			v.Refusals = append(v.Refusals, EpochGateRefusal{
				Engine: req.Engine, Class: GateReasonUnackedEpoch,
				WantChainID: req.ChainID, GotChainID: c.ChainID,
				AckedEpoch: c.AckedEpoch, MaxEpoch: maxEpoch,
				Reason: fmt.Sprintf(
					"engine %s on chain %d carries unacknowledged reorg epoch %d (acked %d): its derived rows may describe blocks the raw rewind already deleted",
					req.Engine, c.ChainID, maxEpoch, c.AckedEpoch),
			})
		}
	}
	return v, nil
}
