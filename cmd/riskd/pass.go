package main

// One riskd pass: read the vector, gate, read the substrate, commit the read,
// compute, write the batch.
//
// THE ORDER IS THE DESIGN (spec §3), and each step is where it is for a reason:
//
//  1. read the watermark vector INSIDE the snapshot — a vector read outside it
//     describes a different database than the one the numbers come from;
//  2. GATE on it before reading anything else — a refused pass should cost one
//     query, not a full substrate scan;
//  3. read the substrate in the SAME snapshot — so the gate judged exactly the
//     state that was consumed;
//  4. COMMIT the read transaction, then compute — nothing is held open across
//     arbitrary CPU work (xmin retention, round-10 M5);
//  5. write the batch in ONE separate transaction, stamped with the step-1
//     vector.

import (
	"context"
	"errors"
	"fmt"
	"math/big"

	"github.com/kaselunt/solvent/internal/riskfeed"
	"github.com/kaselunt/solvent/internal/store"
)

// errPassGated is the retryable refusal the reorg gate raises. It is a sentinel
// because the daemon must be able to distinguish "the chain is mid-rewind, try
// again in two seconds" from "something is broken" — the first is ordinary
// operation and must not look like an outage.
var errPassGated = errors.New("risk pass gated")

// errVectorDrift is raised when the watermark vector re-read inside the
// snapshot disagrees with the one the gate judged. Under one repeatable-read
// snapshot that is impossible, which is exactly why it is asserted: if it ever
// fires, the pass was NOT running in the isolation it believes it is, and every
// stamp it would write is a claim about a state it did not read.
var errVectorDrift = errors.New("risk pass: watermark vector changed inside the snapshot")

// passResult is what one pass did, for logging and for tests.
type passResult struct {
	Gated     bool
	GateErr   error
	BatchID   int64
	Positions int
	Refused   int
	Flagged   int
	Vector    watermarkVector
}

// runPass executes one materialization pass.
//
// It returns (result, nil) with Gated=true for a gated pass: a gate refusal is
// an ordinary outcome of a correct system, not an error condition, and the
// caller schedules the next tick either way.
func runPass(ctx context.Context, s *store.Store, cfg *daemonConfig) (passResult, error) {
	var res passResult

	tx, err := s.BeginRiskSnapshot(ctx)
	if err != nil {
		return res, err
	}
	// Rollback is the normal exit for a gated pass and a no-op after Commit.
	defer func() { _ = tx.Rollback(ctx) }()

	// Step 1 — the vector, read inside the snapshot. DeriveCursorStates and
	// MaxReorgEpochs are the store's own readers, reused verbatim (chain-truth
	// R1): a second implementation of "what is the derived head" is a second
	// answer to it.
	cursors, err := store.DeriveCursorStates(ctx, tx)
	if err != nil {
		return res, err
	}
	maxEpochs, err := store.MaxReorgEpochs(ctx, tx)
	if err != nil {
		return res, err
	}
	vector := newWatermarkVector(cursors, maxEpochs, cfg.consumedEngines())
	res.Vector = vector

	// Step 2 — the gate. Position and param engines only; price engines are
	// gated per position by G2.
	if g := gatePass(vector, cfg.gatedEngines()); !g.OK {
		res.Gated, res.GateErr = true, g.Err()
		return res, nil
	}

	// Step 3 — the substrate, same snapshot.
	inputs, err := store.RiskInputSnapshot(ctx, tx, cfg.snapshotSpec(vector))
	if err != nil {
		return res, err
	}

	// The snapshot re-read the vector; under REPEATABLE READ it must be the one
	// the gate judged. Proving it costs nothing and turns an isolation
	// regression from a silent wrong stamp into a loud refusal.
	reread := newWatermarkVector(inputs.Cursors, inputs.MaxEpochs, cfg.consumedEngines())
	if reread.Changed(vector) {
		return res, fmt.Errorf("%w: gated %s, snapshot %s", errVectorDrift, vector, reread)
	}

	// Step 4 — release the snapshot BEFORE computing.
	if err := tx.Commit(ctx); err != nil {
		return res, fmt.Errorf("commit risk snapshot: %w", err)
	}

	// The previous batch's disclosed prices are the G5 step baseline: "this
	// moved a lot since you last looked" is only true against what we last
	// showed somebody.
	prev, err := previousPrices(ctx, s)
	if err != nil {
		return res, err
	}

	assembled, err := riskfeed.Assemble(inputs, cfg.assembleConfig(prev))
	if err != nil {
		return res, err
	}

	// Step 5 — one write transaction: batch + every child row + retention prune
	// + the doorbell.
	batchID, err := s.WriteRiskBatch(ctx, store.RiskBatchWrite{
		Producer:   cfg.Producer,
		Watermarks: stampsFor(vector),
		Positions:  assembled.Positions,
		Aggregates: assembled.Aggregates,
		Retention:  cfg.Retention,
		Notify:     notifyChannel,
	})
	if err != nil {
		return res, err
	}

	res.BatchID = batchID
	res.Positions = len(assembled.Positions)
	for _, p := range assembled.Positions {
		if p.Status == store.RiskPositionRefused {
			res.Refused++
		}
		if len(p.Flags) > 0 {
			res.Flagged++
		}
	}
	return res, nil
}

// previousPrices reads the price values the newest COMPLETE batch disclosed,
// keyed by witness identity.
//
// It reads the persisted SNAPSHOTS, not the `prices` table. That is the whole
// point of persisting them: the baseline for "did this move" has to be the
// number we published, and a re-read of `prices` would compare today's value
// against today's value the moment a poll superseded the key.
func previousPrices(ctx context.Context, s *store.Store) (map[string]*big.Int, error) {
	batch, found, err := s.NewestCompleteBatch(ctx)
	if err != nil {
		return nil, err
	}
	if !found {
		return nil, nil
	}
	rows, err := s.RiskBatchPriceInputs(ctx, batch.ID)
	if err != nil {
		return nil, err
	}
	out := map[string]*big.Int{}
	for _, r := range rows {
		if r.Value == nil {
			continue
		}
		out[riskfeed.PriceKeyID(uint64(r.ChainID), r.Asset, r.Source)] = r.Value
	}
	return out, nil
}
