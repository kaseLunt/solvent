package store

// P5 Task B1: the QUERYABLE HALVES of the /v1/evidence manifest.
//
// The manifest is deploy-bound; its fields split by authority:
//
//   * FROM THE DATABASE (this reader): the newest SERVABLE batch's identity
//     — materialization key, human-readable vector, substrate digest,
//     producer, counts, computed_at — and the applied schema version from
//     goose's own ledger. These are read here because the database is their
//     source of truth.
//
//   * FROM CODE, AT BUILD/DEPLOY TIME (deliberately NOT here): service
//     commit, verdict-registry and algorithm revisions,
//     scenario_config_version, the feeds-registry hash, and committed
//     reconcile/probe artifacts. Their authoritative sources are the
//     packages and files that define them; re-deriving them from the DB
//     would invert authority and invent a second source of truth. Task B3
//     composes both halves into the endpoint.

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
)

type EvidenceInputs struct {
	// HasBatch is false when no servable batch exists (fresh deploy, or every
	// batch torn) — the manifest then says so instead of inventing identity.
	HasBatch bool
	BatchID  int64
	// ComputedAt is the batch's database-clock stamp.
	ComputedAt time.Time
	Producer   string
	// The idempotency key, the human-readable materialization vector and the
	// substrate digest — the batch's full identity triple (migration 00013).
	MaterializationKey    string
	MaterializationVector string
	SubstrateDigest       string
	PositionCount         int
	RefusedCount          int
	FlaggedCount          int
	// SchemaVersion is the highest applied goose migration version.
	SchemaVersion int64
}

// EvidenceInputs reads the database-owned evidence fields. The batch is
// selected under the SAME servability predicate every serving path uses —
// evidence about a batch nothing would serve is not evidence.
func (s *Store) EvidenceInputs(ctx context.Context) (EvidenceInputs, error) {
	var out EvidenceInputs
	if err := s.pool.QueryRow(ctx,
		`SELECT COALESCE(max(version_id), 0) FROM goose_db_version WHERE is_applied`).
		Scan(&out.SchemaVersion); err != nil {
		return EvidenceInputs{}, fmt.Errorf("evidence inputs: read schema version: %w", err)
	}

	err := s.pool.QueryRow(ctx, `
		SELECT b.id, b.computed_at, b.producer,
		       b.materialization_key, b.materialization_vector, b.substrate_digest,
		       b.position_count, b.refused_count, b.flagged_count
		FROM risk_batches b
		WHERE `+riskBatchCompleteConjuncts+`
		ORDER BY b.id DESC LIMIT 1`).
		Scan(&out.BatchID, &out.ComputedAt, &out.Producer,
			&out.MaterializationKey, &out.MaterializationVector, &out.SubstrateDigest,
			&out.PositionCount, &out.RefusedCount, &out.FlaggedCount)
	if errors.Is(err, pgx.ErrNoRows) {
		return out, nil
	}
	if err != nil {
		return EvidenceInputs{}, fmt.Errorf("evidence inputs: read newest servable batch: %w", err)
	}
	out.HasBatch = true
	out.ComputedAt = out.ComputedAt.UTC()
	return out, nil
}
