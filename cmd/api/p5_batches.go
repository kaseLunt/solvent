package main

// GET /v1/batches/{id} — the batch permalink (contract 1.2.0, AMENDMENT 1
// item 6): one batch's permanent IDENTITY record — materialization key,
// substrate digest, counts, per-engine aggregate rollups — plus a SERVABILITY
// verdict relative to the batch that is serving now. This is the drawer-pin
// permalink: a batch id captured from any surface resolves to the identity it
// had, for as long as retention keeps it.
//
// # One completeness authority
//
// Whether a batch is COMPLETE is decided exclusively through the store's own
// predicate (`NewestCompleteBatch` / `CompleteBatchIDs`) — this file never
// re-spells it (read.go's header states the law). An id present in
// risk_batches but absent from the complete set is served as
// `unservable_incomplete` with its aggregates WITHHELD (null): an incomplete
// batch's rollups may be torn, and serving them would be a plausible-looking
// rollup of a book nobody may read.
//
// # 404 is a retention disclosure
//
// Batches are pruned on a retention window. A missing id answers 404 whose
// message SAYS SO: "not retained (or never existed)" — never a claim that the
// materialization did not happen.
//
// # Reader gap (owed)
//
// The store has no batch-by-id reader, so the identity row is read here by a
// supplemental SELECT (the same pattern p5_prices.go uses for anchor_block).
// Owed to the store as a reader extension; the aggregates reuse
// readAggregates, which already takes a Querier and a batch id.

import (
	"errors"
	"net/http"
	"strconv"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/kaselunt/solvent/internal/store"
)

// batchServabilityProbeLimit bounds the complete-batch membership probe. It
// is a FORMAL bound only: retention keeps far fewer batches than this, and an
// id older than the whole retained set answers 404 before the probe runs.
const batchServabilityProbeLimit = 100_000

type wireBatchAggregate struct {
	Engine            string `json:"engine"`
	ValueDecimals     int    `json:"value_decimals"`
	Positions         int    `json:"positions"`
	ComputedPositions int    `json:"computed_positions"`
	RefusedPositions  int    `json:"refused_positions"`
	FlaggedPositions  int    `json:"flagged_positions"`
	// LiquidatablePositions and the totals are null on a WITHHELD engine —
	// the persisted zeros behind a refusal mean WITHHELD, and republishing
	// them as values is exactly how an unproven book becomes "nothing at
	// risk".
	LiquidatablePositions *int `json:"liquidatable_positions"`
	// Sweep is this engine's sweep stamp on THIS batch's watermark vector
	// (1.2.2): the permalink's rollups speak for the batch's own clock, so
	// the sweep-cut behind the liquidatable count is named on the row
	// itself. Null means the engine HAS no collateral sweep (Aave) — never
	// "unrecorded": watermark rows live exactly as long as their batch, so
	// a served aggregate always has its stamp.
	Sweep           *wireSweepStamp    `json:"sweep"`
	TotalCollateral *string            `json:"total_collateral"`
	TotalDebt       *string            `json:"total_debt"`
	Refusal         *wireEngineRefusal `json:"refusal"`
}

type batchResponse struct {
	ServedAt        time.Time `json:"served_at"`
	BatchID         int64     `json:"batch_id"`
	Servability     string    `json:"servability"`
	ServabilityNote string    `json:"servability_note"`
	ComputedAt      time.Time `json:"computed_at"`
	Producer        string    `json:"producer"`
	Status          string    `json:"status"`
	PositionCount   int       `json:"position_count"`
	RefusedCount    int       `json:"refused_count"`
	FlaggedCount    int       `json:"flagged_count"`
	Materialization string    `json:"materialization_key"`
	SubstrateDigest string    `json:"substrate_digest"`
	// Aggregates is a POINTER because it must serialize as NULL (not [])
	// exactly when the batch is unservable-incomplete — "withheld" and
	// "empty" are different statements.
	Aggregates *[]wireBatchAggregate `json:"aggregates"`
	Notes      []string              `json:"notes"`
}

func (s *server) handleBatch(w http.ResponseWriter, r *http.Request) {
	raw := r.PathValue("id")
	id, err := strconv.ParseInt(raw, 10, 64)
	if err != nil || id < 1 {
		writeError(w, http.StatusBadRequest, codeBadRequest,
			"batch id must be a positive integer", nil)
		return
	}

	ctx := r.Context()

	// ONE SNAPSHOT FOR EVERY STAGE (wave H6b, Codex round-5 finding 2).
	//
	// Identity, servability, aggregates and the watermark vector used to be
	// read through SEPARATE pool queries — and batches are PRUNABLE. An honest
	// request for the oldest retained batch could read its identity and
	// complete status, race with the next WriteRiskBatch retention prune, and
	// then read EMPTY aggregate/vector sets without error: a supposedly
	// complete batch served with `aggregates: []`, which the contract cannot
	// tell from an honest answer. Under `REPEATABLE READ, READ ONLY` every
	// stage reads one database instant, so the answer is either the WHOLE
	// batch (it was retained when the request began — pin truth) or the 404
	// retention disclosure — never a torn mixture. The isolation level lives
	// in BeginRiskSnapshot, its one home.
	tx, err := s.store.BeginRiskSnapshot(ctx)
	if err != nil {
		writeError(w, http.StatusInternalServerError, codeInternal, err.Error(), nil)
		return
	}
	defer func() { _ = tx.Rollback(ctx) }()

	var out batchResponse
	if err := tx.QueryRow(ctx, `SELECT now()`).Scan(&out.ServedAt); err != nil {
		writeError(w, http.StatusInternalServerError, codeInternal, "read database clock: "+err.Error(), nil)
		return
	}
	out.ServedAt = out.ServedAt.UTC()

	// The batch's own immutable identity row.
	err = tx.QueryRow(ctx, `
		SELECT id, computed_at, producer, status, position_count, refused_count, flagged_count,
		       materialization_key, substrate_digest
		  FROM risk_batches WHERE id = $1`, id).
		Scan(&out.BatchID, &out.ComputedAt, &out.Producer, &out.Status,
			&out.PositionCount, &out.RefusedCount, &out.FlaggedCount,
			&out.Materialization, &out.SubstrateDigest)
	if errors.Is(err, pgx.ErrNoRows) {
		writeError(w, http.StatusNotFound, codeNotFound,
			"batch "+strconv.FormatInt(id, 10)+" is not retained: batches are pruned on a retention window, so this id was either pruned or never existed. This is a statement about RETENTION — never a claim that the materialization did not happen.", nil)
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, codeInternal, err.Error(), nil)
		return
	}
	out.ComputedAt = out.ComputedAt.UTC()
	out.Producer = sanitize(out.Producer)

	// Servability, through the store's ONE completeness authority, read in
	// the SAME snapshot as the identity above. CompleteBatchIDs returns
	// newest-first, so ids[0] names exactly the batch NewestCompleteBatch
	// would serve — from this snapshot, which is the point.
	ids, err := store.CompleteBatchIDs(ctx, tx, batchServabilityProbeLimit)
	if err != nil {
		writeError(w, http.StatusInternalServerError, codeInternal, err.Error(), nil)
		return
	}
	complete := false
	for _, cid := range ids {
		if cid == id {
			complete = true
			break
		}
	}

	switch {
	case complete && ids[0] == id:
		out.Servability = "newest_servable"
		out.ServabilityNote = "this batch is the newest servable batch — every live surface is serving it."
	case complete:
		out.Servability = "superseded_retained"
		out.ServabilityNote = "retained and COMPLETE, but no longer the newest servable batch; its rows are immutable history."
	default:
		out.Servability = "unservable_incomplete"
		out.ServabilityNote = "this batch's row exists but fails the completeness predicate (a torn restore or a partial write); its aggregates are WITHHELD rather than served as a plausible rollup of a book nobody may read."
	}

	out.Notes = []string{
		"this record is the batch's IDENTITY, not its rows: per-position pages are served batch-stable by /v1/positions while the batch is newest-servable.",
		"a withheld engine's aggregate serves NULL totals and names its refusal — persisted zeros under a refusal mean WITHHELD, never an empty healthy book.",
	}

	// TEST SEAM (nil in production): the retention-prune interleave point —
	// after the identity/servability reads, before the aggregate/vector reads.
	// See p5_batches_prune_race_db_test.go.
	if s.batchInterleave != nil {
		if p := s.batchInterleave.Load(); p != nil && *p != nil {
			(*p)()
		}
	}

	if complete {
		aggs, err := readAggregates(ctx, tx, id)
		if err != nil {
			writeError(w, http.StatusInternalServerError, codeInternal, err.Error(), nil)
			return
		}
		// The batch's own watermark stamps, for the per-aggregate sweep
		// disclosure (1.2.2) — same snapshot again.
		vectors, err := readBatchWatermarkVectors(ctx, tx, []int64{id})
		if err != nil {
			writeError(w, http.StatusInternalServerError, codeInternal, err.Error(), nil)
			return
		}
		// FAIL CLOSED ON CARDINALITY (finding 2's second remedy). Inside one
		// snapshot these states are unreachable through WriteRiskBatch — a
		// complete batch always carries its aggregates and its stamped engine
		// set — so an empty set here is a hand-written or torn "complete"
		// batch (a restore, a manual edit), and serving it as `aggregates: []`
		// would publish a complete book with nothing in it, which nothing in
		// the store backs.
		if len(aggs) == 0 {
			writeError(w, http.StatusInternalServerError, codeInternal,
				"batch "+strconv.FormatInt(id, 10)+" passed the completeness predicate but carries no aggregate rows — refusing to serve a complete batch as an empty book (a hand-written or torn state)", nil)
			return
		}
		if len(vectors[id]) == 0 {
			writeError(w, http.StatusInternalServerError, codeInternal,
				"batch "+strconv.FormatInt(id, 10)+" passed the completeness predicate but carries no watermark stamps — refusing to serve its counts without their sweep clock", nil)
			return
		}
		stampByEngine := map[string]store.RiskBatchWatermark{}
		for _, m := range vectors[id] {
			stampByEngine[m.Engine] = m
		}
		wireAggs := make([]wireBatchAggregate, 0, len(aggs))
		for _, a := range aggs {
			// FAIL CLOSED on a missing stamp: a complete batch stamps every
			// consumed engine, so an aggregate row with no watermark row is a
			// hand-written or torn state — and serving its liquidatable count
			// with `sweep: null` would CLAIM "this engine has no sweeper",
			// which nothing in the store backs.
			stamp, stamped := stampByEngine[a.Engine]
			if !stamped {
				writeError(w, http.StatusInternalServerError, codeInternal,
					"batch "+strconv.FormatInt(id, 10)+" carries an aggregate for engine "+a.Engine+" but no watermark stamp for it — refusing to serve the rollup without the sweep clock its counts belong to", nil)
				return
			}
			wa := wireBatchAggregate{
				Engine:            a.Engine,
				ValueDecimals:     int(a.ValueDecimals),
				Positions:         a.Positions,
				ComputedPositions: a.ComputedPositions,
				RefusedPositions:  a.RefusedPositions,
				FlaggedPositions:  a.FlaggedPositions,
				Sweep:             wireSweepFrom(out.ServedAt, stamp.Sweep),
			}
			if a.RefusalCode != "" {
				// WITHHELD: the same rule every serving surface applies.
				wa.Refusal = &wireEngineRefusal{
					Engine: a.Engine, Code: a.RefusalCode,
					Detail: sanitize(a.RefusalDetail), Note: engineRefusalNote(a.RefusalCode),
				}
			} else {
				liq := a.LiquidatablePositions
				wa.LiquidatablePositions = &liq
				wa.TotalCollateral = bigStr(a.TotalCollateral)
				wa.TotalDebt = bigStr(a.TotalDebt)
			}
			wireAggs = append(wireAggs, wa)
		}
		out.Aggregates = &wireAggs
	}
	if err := tx.Commit(ctx); err != nil {
		writeError(w, http.StatusInternalServerError, codeInternal, "commit permalink snapshot: "+err.Error(), nil)
		return
	}
	writeJSON(w, out)
}
