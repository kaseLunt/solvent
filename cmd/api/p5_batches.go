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
	LiquidatablePositions *int               `json:"liquidatable_positions"`
	TotalCollateral       *string            `json:"total_collateral"`
	TotalDebt             *string            `json:"total_debt"`
	Refusal               *wireEngineRefusal `json:"refusal"`
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
	now, err := s.dbNow(ctx)
	if err != nil {
		writeError(w, http.StatusInternalServerError, codeInternal, err.Error(), nil)
		return
	}

	// The batch's own immutable identity row.
	var out batchResponse
	err = s.store.Querier().QueryRow(ctx, `
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
	out.ServedAt = now
	out.ComputedAt = out.ComputedAt.UTC()
	out.Producer = sanitize(out.Producer)

	// Servability, through the store's ONE completeness authority.
	newest, foundNewest, err := s.store.NewestCompleteBatch(ctx)
	if err != nil {
		writeError(w, http.StatusInternalServerError, codeInternal, err.Error(), nil)
		return
	}
	complete := false
	if foundNewest && newest.ID == id {
		complete = true
	} else {
		ids, err := store.CompleteBatchIDs(ctx, s.store.Querier(), batchServabilityProbeLimit)
		if err != nil {
			writeError(w, http.StatusInternalServerError, codeInternal, err.Error(), nil)
			return
		}
		for _, cid := range ids {
			if cid == id {
				complete = true
				break
			}
		}
	}

	switch {
	case foundNewest && newest.ID == id:
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

	if complete {
		aggs, err := readAggregates(ctx, s.store.Querier(), id)
		if err != nil {
			writeError(w, http.StatusInternalServerError, codeInternal, err.Error(), nil)
			return
		}
		wireAggs := make([]wireBatchAggregate, 0, len(aggs))
		for _, a := range aggs {
			wa := wireBatchAggregate{
				Engine:            a.Engine,
				ValueDecimals:     int(a.ValueDecimals),
				Positions:         a.Positions,
				ComputedPositions: a.ComputedPositions,
				RefusedPositions:  a.RefusedPositions,
				FlaggedPositions:  a.FlaggedPositions,
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
	writeJSON(w, out)
}
