package store

// P5 Task B1: the observatory time-series read (GET /v1/observatory/series),
// over Task B2's observatory_points rollup (migration 00016, landed by the
// sibling wave in this same tree — the WRITER is B2's; this file is
// read-only).
//
// The reader tolerates the table NOT EXISTING on the serving database (the
// API role migrates nothing, so it can face a deploy whose daemon has not
// applied 00016 yet): that answers ErrObservatoryUnavailable, a typed
// refusal Task B3 renders as the Observatory's honest degraded mode — never
// an empty series pretending the record exists and is blank.
//
// What a point IS (00016's header is normative): an hourly observation of
// the newest complete batch's per-engine aggregate at write time, surviving
// batch retention. Engines are never blended; a refused engine's point
// carries its refusal_code and its zero counts mean WITHHELD, not empty.

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math/big"
	"time"
)

// ErrObservatoryUnavailable: the rollup table does not exist on this
// database (migration 00016 not applied here yet).
var ErrObservatoryUnavailable = errors.New("observatory series: observatory_points does not exist on this database — the rollup (Task B2, migration 00016) has not been applied")

// ObservatoryPoint is one engine's rollup bucket, verbatim from
// observatory_points. Totals are exact decimal integers in the engine's own
// value_decimals scale.
type ObservatoryPoint struct {
	BucketStart time.Time
	Engine      string
	// Observation provenance: when the tick wrote it, which batch it
	// observed (id + deterministic materialization key — the key survives
	// batch retention), and that batch's own database-clock stamp.
	ObservedAt         time.Time
	BatchID            int64
	BatchComputedAt    time.Time
	MaterializationKey string
	// The engine's WATERMARK VECTOR in the observed batch, copied at write
	// time (00016): the chain-side anchor plus the reorg-honesty stamp pair.
	ChainID           uint64
	LastBlock         uint64
	AckedEpoch        int64
	MaxEpochAtCompute int64

	ValueDecimals         int16
	Positions             int
	ComputedPositions     int
	RefusedPositions      int
	FlaggedPositions      int
	LiquidatablePositions int
	TotalCollateral       *big.Int
	TotalDebt             *big.Int

	// The engine-scoped refusal, copied so a withheld book stays visibly
	// withheld in the series. Empty = not refused.
	RefusalCode   string
	RefusalDetail string

	// Rates is the writer's per-(asset, kind) snapshot VERBATIM as raw JSON:
	// its shape is B2's contract (00016 documents it), and decoding it here
	// would fossilize that shape in a second place.
	Rates json.RawMessage
}

// ObservatorySeries reads one engine's points in [from, to], ascending by
// bucket. from/to are optional bounds; limit caps the rows returned.
func (s *Store) ObservatorySeries(ctx context.Context, engine string, from, to *time.Time, limit int) ([]ObservatoryPoint, error) {
	if engine == "" {
		return nil, fmt.Errorf("observatory series: engine is required — engines are never silently combined")
	}
	if limit <= 0 {
		return nil, fmt.Errorf("observatory series: limit must be positive, got %d", limit)
	}
	var present bool
	if err := s.pool.QueryRow(ctx, `SELECT to_regclass('observatory_points') IS NOT NULL`).Scan(&present); err != nil {
		return nil, fmt.Errorf("observatory series: presence check: %w", err)
	}
	if !present {
		return nil, ErrObservatoryUnavailable
	}

	q := `SELECT bucket_start, engine, observed_at, batch_id, batch_computed_at, materialization_key,
	             chain_id, last_block, acked_epoch, max_epoch_at_compute,
	             value_decimals, positions, computed_positions, refused_positions,
	             flagged_positions, liquidatable_positions,
	             total_collateral::text, total_debt::text,
	             refusal_code, refusal_detail, rates
	      FROM observatory_points
	      WHERE engine = $1`
	args := []any{engine}
	if from != nil {
		args = append(args, *from)
		q += fmt.Sprintf(" AND bucket_start >= $%d", len(args))
	}
	if to != nil {
		args = append(args, *to)
		q += fmt.Sprintf(" AND bucket_start <= $%d", len(args))
	}
	args = append(args, limit)
	q += fmt.Sprintf(" ORDER BY bucket_start ASC LIMIT $%d", len(args))

	rows, err := s.pool.Query(ctx, q, args...)
	if err != nil {
		return nil, fmt.Errorf("observatory series: %w", err)
	}
	defer rows.Close()

	var out []ObservatoryPoint
	for rows.Next() {
		var p ObservatoryPoint
		var chainID, lastBlock int64
		var tc, td string
		var rates []byte
		if err := rows.Scan(&p.BucketStart, &p.Engine, &p.ObservedAt, &p.BatchID, &p.BatchComputedAt, &p.MaterializationKey,
			&chainID, &lastBlock, &p.AckedEpoch, &p.MaxEpochAtCompute,
			&p.ValueDecimals, &p.Positions, &p.ComputedPositions, &p.RefusedPositions,
			&p.FlaggedPositions, &p.LiquidatablePositions,
			&tc, &td, &p.RefusalCode, &p.RefusalDetail, &rates); err != nil {
			return nil, fmt.Errorf("scan observatory point: %w", err)
		}
		p.BucketStart = p.BucketStart.UTC()
		p.ObservedAt = p.ObservedAt.UTC()
		p.BatchComputedAt = p.BatchComputedAt.UTC()
		p.ChainID = uint64(chainID)
		p.LastBlock = uint64(lastBlock)
		var ok bool
		if p.TotalCollateral, ok = new(big.Int).SetString(tc, 10); !ok {
			return nil, fmt.Errorf("observatory total_collateral %q is not an integer", tc)
		}
		if p.TotalDebt, ok = new(big.Int).SetString(td, 10); !ok {
			return nil, fmt.Errorf("observatory total_debt %q is not an integer", td)
		}
		p.Rates = json.RawMessage(rates)
		out = append(out, p)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate observatory points: %w", err)
	}
	return out, nil
}
