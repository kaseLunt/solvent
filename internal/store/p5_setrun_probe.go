package store

// The set-run freshness probe (contract 1.7.0).
//
// It exists because `BatchStillNewestServable` cannot answer the question the
// set-run has to disclose. That method returns ONLY a bool off `s.pool`
// (`p5_positions_page.go`), and its own comment says so: "false with a nil
// error means either a newer servable batch exists or none does". Those are
// two different facts and a reader needs two different sentences for them, so
// filling `evaluation.newest_servable_batch_id` from it would need a SECOND,
// unsynchronized query — and a second query is a second instant. Between the
// two, a batch may land or be pruned, and the response would then carry a
// freshness verdict and an id that disagree, inside the one block whose whole
// job is to be readable on its own.
//
// So the id AND the clock come from ONE statement. `BatchStillNewestServable`
// is left exactly as it is for its existing pagination caller.

import (
	"context"
	"fmt"
	"time"
)

// NewestServableBatchAt returns the newest batch satisfying THE SERVING
// completeness predicate, and the database instant that answer was true at.
//
// The id is nil when NO batch satisfies the predicate — the scalar subquery
// yields SQL NULL, which is a different fact from "the batch you measured is
// no longer newest" and is served under its own `none_servable` arm.
//
// # One statement, deliberately
//
// The scalar subquery and `now()` are evaluated by the same statement, so the
// id and the instant cannot come from different moments. `freshness` is then
// DERIVED from the id by a total four-way comparison against the measured
// batch id, in the handler — nothing here decides which sentence to publish.
//
// # The predicate is the SERVING one, verbatim
//
// `riskBatchCompleteConjuncts` is the same fragment `NewestCompleteBatchQ`
// applies, so the probe and the resolution cannot drift. It also means
// completeness is not a frozen property of a batch row: the fragment re-counts
// child rows and re-checks the required stamp set at PROBE time, which is
// exactly why a `newest_is_older` answer is derivable at all.
func (s *Store) NewestServableBatchAt(ctx context.Context) (*int64, time.Time, error) {
	var id *int64
	var at time.Time
	err := s.pool.QueryRow(ctx, `
		SELECT (SELECT b.id FROM risk_batches b
		         WHERE `+riskBatchCompleteConjuncts+`
		         ORDER BY b.id DESC LIMIT 1), now()`).Scan(&id, &at)
	if err != nil {
		return nil, time.Time{}, fmt.Errorf("newest servable batch probe: %w", err)
	}
	return id, at.UTC(), nil
}
