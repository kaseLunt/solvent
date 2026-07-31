package store

// P5 Task B1: price history with provenance and quarantine (GET
// /v1/prices/{asset}).
//
// FULL HISTORY, INCLUDING INVALID ROWS. An invalid price row (non-positive
// answer, D-012 reorg neutralization) is a recorded fact and part of the
// story; hiding it would smooth over exactly the ranges a reader most needs
// to see (spec §3.6: "quarantined ranges rendered visibly untrusted (never
// smoothed or hidden)").
//
// THE DOWNSAMPLING LAW: a bucket NEVER aggregates across a validity
// boundary. Buckets are cut by block step, then SPLIT at every valid-flag
// transition (and at decimals changes — aggregating mixed scales is a silent
// 10^k error), so a min/max/sum can never blend a quarantined value into a
// trusted statistic. Invalid runs carry counts, block bounds and reasons but
// NO price aggregates: the raw values stay reachable at step<=1, but a
// summarized quarantined range is a warning, not a chart line.
//
// NO FLOATS, NO MEANS: aggregates are exact big.Int Open/Close/Min/Max/Sum
// plus a row count. A consumer that wants an average derives it from
// Sum/Rows in its own arithmetic, with the rounding it can defend.

import (
	"context"
	"fmt"
	"math/big"
	"time"
)

// PriceSeriesQuery names the series. Source "" means every source of the
// (chain, asset) pair — sources are NEVER merged into one series; each
// source yields its own points/buckets (mixing an engine-exact oracle read
// with a raw feed would blend provenances).
type PriceSeriesQuery struct {
	ChainID   uint64
	Asset     []byte
	Source    string
	FromBlock *uint64
	ToBlock   *uint64
	// Step is the downsampling bucket width in blocks. 0 or 1 = raw rows.
	Step uint64
}

// PricePoint is one raw prices row, verbatim.
type PricePoint struct {
	Source      string
	OwnerEngine string
	BlockNumber uint64
	Price       *big.Int
	Decimals    int32
	// ObservedAt is DATABASE INSERTION TIME — the writer-health clock, never
	// a valuation as-of. SourceAsOf is the chain-asserted as-of and is nil
	// where none was custodied (pre-00012 rows); it is NEVER backfilled from
	// ObservedAt.
	ObservedAt    time.Time
	SourceAsOf    *time.Time
	Valid         bool
	InvalidReason string
}

// PriceBucket is one maximal same-validity (and same-decimals) run within
// one step bucket of one source's series.
type PriceBucket struct {
	Source   string
	Decimals int32
	Valid    bool
	// FromBlock/ToBlock are the run's first/last ROW blocks (not the bucket's
	// nominal bounds), so a run never claims coverage it does not have.
	FromBlock uint64
	ToBlock   uint64
	Rows      int64
	// Exact aggregates over the run — nil on invalid runs (see the law above).
	Open  *big.Int
	Close *big.Int
	Min   *big.Int
	Max   *big.Int
	Sum   *big.Int
	// Distinct invalid_reason values of an invalid run, in first-seen order.
	InvalidReasons []string
}

// QuarantinedRange summarizes one maximal run of CONSECUTIVE invalid rows in
// a source's series (independent of step bucketing).
type QuarantinedRange struct {
	Source    string
	FromBlock uint64
	ToBlock   uint64
	Rows      int64
	Reasons   []string
}

type PriceSeriesResult struct {
	// Points is populated in raw mode (Step <= 1), Buckets in downsampled
	// mode. Quarantined is computed in BOTH modes over the selected range.
	Points      []PricePoint
	Buckets     []PriceBucket
	Quarantined []QuarantinedRange
}

// PriceSeries reads one asset's price history on one chain.
func (s *Store) PriceSeries(ctx context.Context, q PriceSeriesQuery) (PriceSeriesResult, error) {
	if len(q.Asset) == 0 {
		return PriceSeriesResult{}, fmt.Errorf("price series: asset is required")
	}
	sql := `SELECT source, owner_engine, block_number, price::text, price_decimals,
	               observed_at, source_as_of, valid, invalid_reason
	        FROM prices
	        WHERE chain_id = $1 AND asset = $2`
	args := []any{int64(q.ChainID), q.Asset}
	if q.Source != "" {
		args = append(args, q.Source)
		sql += fmt.Sprintf(" AND source = $%d", len(args))
	}
	if q.FromBlock != nil {
		args = append(args, int64(*q.FromBlock))
		sql += fmt.Sprintf(" AND block_number >= $%d", len(args))
	}
	if q.ToBlock != nil {
		args = append(args, int64(*q.ToBlock))
		sql += fmt.Sprintf(" AND block_number <= $%d", len(args))
	}
	// Source-major, block-ascending: the bucketing pass below consumes each
	// source's series as one contiguous ordered run.
	sql += ` ORDER BY source ASC, block_number ASC`

	rows, err := s.pool.Query(ctx, sql, args...)
	if err != nil {
		return PriceSeriesResult{}, fmt.Errorf("price series: %w", err)
	}
	defer rows.Close()

	var points []PricePoint
	for rows.Next() {
		var p PricePoint
		var blockNumber int64
		var priceText string
		var sourceAsOf *time.Time
		if err := rows.Scan(&p.Source, &p.OwnerEngine, &blockNumber, &priceText, &p.Decimals,
			&p.ObservedAt, &sourceAsOf, &p.Valid, &p.InvalidReason); err != nil {
			return PriceSeriesResult{}, fmt.Errorf("scan price row: %w", err)
		}
		p.BlockNumber = uint64(blockNumber)
		p.ObservedAt = p.ObservedAt.UTC()
		if sourceAsOf != nil {
			t := sourceAsOf.UTC()
			p.SourceAsOf = &t
		}
		v, ok := new(big.Int).SetString(priceText, 10)
		if !ok {
			return PriceSeriesResult{}, fmt.Errorf("price %q is not an integer", priceText)
		}
		p.Price = v
		points = append(points, p)
	}
	if err := rows.Err(); err != nil {
		return PriceSeriesResult{}, fmt.Errorf("iterate price rows: %w", err)
	}

	res := PriceSeriesResult{Quarantined: quarantinedRanges(points)}
	if q.Step <= 1 {
		res.Points = points
		return res, nil
	}
	res.Buckets = bucketPriceSeries(points, q.Step, q.FromBlock)
	return res, nil
}

// bucketPriceSeries cuts each source's ordered run into step buckets and
// splits every bucket at validity and decimals boundaries. points arrive
// source-major, block-ascending.
func bucketPriceSeries(points []PricePoint, step uint64, fromBlock *uint64) []PriceBucket {
	var out []PriceBucket
	var cur *PriceBucket
	var curBucketIdx uint64
	var base uint64
	var haveBase bool
	flush := func() {
		if cur != nil {
			out = append(out, *cur)
			cur = nil
		}
	}
	prevSource := ""
	for _, p := range points {
		if p.Source != prevSource {
			flush()
			prevSource = p.Source
			// The bucket grid is anchored at FromBlock when given (stable
			// across pages/refreshes), else at the source's first row.
			if fromBlock != nil {
				base, haveBase = *fromBlock, true
			} else {
				haveBase = false
			}
		}
		if !haveBase {
			base, haveBase = p.BlockNumber, true
		}
		bucketIdx := (p.BlockNumber - base) / step
		boundary := cur == nil ||
			bucketIdx != curBucketIdx ||
			// THE LAW: a validity flip ends the run unconditionally.
			p.Valid != cur.Valid ||
			// Mixed scales never aggregate.
			p.Decimals != cur.Decimals
		if boundary {
			flush()
			cur = &PriceBucket{
				Source: p.Source, Decimals: p.Decimals, Valid: p.Valid,
				FromBlock: p.BlockNumber, ToBlock: p.BlockNumber,
			}
			curBucketIdx = bucketIdx
			if p.Valid {
				cur.Open = new(big.Int).Set(p.Price)
				cur.Min = new(big.Int).Set(p.Price)
				cur.Max = new(big.Int).Set(p.Price)
				cur.Sum = new(big.Int)
			}
		}
		cur.ToBlock = p.BlockNumber
		cur.Rows++
		if p.Valid {
			cur.Close = new(big.Int).Set(p.Price)
			if p.Price.Cmp(cur.Min) < 0 {
				cur.Min.Set(p.Price)
			}
			if p.Price.Cmp(cur.Max) > 0 {
				cur.Max.Set(p.Price)
			}
			cur.Sum.Add(cur.Sum, p.Price)
		} else if p.InvalidReason != "" && !containsString(cur.InvalidReasons, p.InvalidReason) {
			cur.InvalidReasons = append(cur.InvalidReasons, p.InvalidReason)
		}
	}
	flush()
	return out
}

// quarantinedRanges finds each source's maximal consecutive invalid runs.
func quarantinedRanges(points []PricePoint) []QuarantinedRange {
	var out []QuarantinedRange
	var cur *QuarantinedRange
	prevSource := ""
	flush := func() {
		if cur != nil {
			out = append(out, *cur)
			cur = nil
		}
	}
	for _, p := range points {
		if p.Source != prevSource {
			flush()
			prevSource = p.Source
		}
		if p.Valid {
			flush()
			continue
		}
		if cur == nil {
			cur = &QuarantinedRange{Source: p.Source, FromBlock: p.BlockNumber}
		}
		cur.ToBlock = p.BlockNumber
		cur.Rows++
		if p.InvalidReason != "" && !containsString(cur.Reasons, p.InvalidReason) {
			cur.Reasons = append(cur.Reasons, p.InvalidReason)
		}
	}
	flush()
	return out
}

func containsString(list []string, s string) bool {
	for _, v := range list {
		if v == s {
			return true
		}
	}
	return false
}
