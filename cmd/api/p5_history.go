package main

// GET /v1/address/{addr}/history — one address's health factor, totals and
// refusals across retained batches.
//
// EVERY POINT IS A PERSISTED ROW from a retained COMPLETE batch — nothing is
// recomputed for this response, so the history is exactly what was served at
// the time, including the batches that REFUSED the position (a refused batch
// is a POINT, never a gap: a missing point reads as "no risk here", the
// false-safety direction).
//
// # The covered window, and the three-valued answer over it
//
// `limit` covers the newest N RETAINED COMPLETE batches (the contract's
// definition), and every claim below is scoped to that window:
//
//   - `found: true`  — at least one persisted point in the window;
//   - `found: false` — a DEFINITIVE negative: every engine was consultable in
//     every covered batch and no row exists anywhere in the window;
//   - `found: null`  — an engine's whole book was WITHHELD somewhere in the
//     window, so the negative cannot be established. Never rendered as "no
//     position".
//
// A batch in which an engine's whole book was withheld has no row for ANY
// account on that engine, so such batches are named per series in
// `withheld_batch_ids` — without that list, an engine-wide refusal would be
// indistinguishable from an account that closed its position.

import (
	"context"
	"net/http"
	"strconv"
	"time"

	"github.com/kaselunt/solvent/internal/risk"
	"github.com/kaselunt/solvent/internal/store"
)

type wireHistoryPoint struct {
	BatchID       int64     `json:"batch_id"`
	ComputedAt    time.Time `json:"computed_at"`
	BalancesBlock uint64    `json:"balances_block"`
	// SweepBlock is the account's own last successful collateral sweep AS
	// PERSISTED IN THIS POINT's batch — the collateral clock behind this
	// point's Liquidatable verdict, carried per point exactly as
	// PositionSummary carries it per row (contract 1.2.1). 0 on Aave (no
	// sweeper) and on a never-swept Debt Manager account: an ABSENT sweep,
	// disclosed, never "swept at genesis". A point's verdict is from ITS OWN
	// batch, so the envelope's newest-batch watermarks cannot vouch for it —
	// serving the verdict without this watermark is the mixed-clock boolean
	// the MOTION license forbids.
	SweepBlock   uint64            `json:"sweep_block"`
	Status       string            `json:"status"`
	Refusal      *wireRefusal      `json:"refusal"`
	HealthFactor *wireHealthFactor `json:"health_factor"`
	// Liquidatable is the Debt Manager's strict verdict at that batch. Null on
	// Aave, and null on a refused row — a withheld verdict, never "false".
	Liquidatable        *bool   `json:"liquidatable"`
	TotalCollateralBase *string `json:"total_collateral_base"`
	TotalDebtBase       *string `json:"total_debt_base"`
}

type wireHistoryEngine struct {
	Engine           string             `json:"engine"`
	ValueDecimals    int                `json:"value_decimals"`
	Points           []wireHistoryPoint `json:"points"`
	WithheldBatchIDs []int64            `json:"withheld_batch_ids"`
	Note             string             `json:"note"`
}

type addressHistoryResponse struct {
	ServedAt           time.Time           `json:"served_at"`
	Batch              wireBatch           `json:"batch"`
	Address            string              `json:"address"`
	Limit              int                 `json:"limit"`
	Engines            []wireHistoryEngine `json:"engines"`
	Found              *bool               `json:"found"`
	LookupComplete     bool                `json:"lookup_complete"`
	WithheldEngines    []wireEngineRefusal `json:"withheld_engines"`
	LookupCompleteNote string              `json:"lookup_complete_note"`
	Notes              []string            `json:"notes"`
}

func (s *server) handleAddressHistory(w http.ResponseWriter, r *http.Request) {
	addr, err := parseAddress(r.PathValue("addr"))
	if err != nil {
		writeError(w, http.StatusBadRequest, codeBadRequest, "invalid address: "+err.Error(), nil)
		return
	}
	limit := defaultHistoryLimit
	if raw := r.URL.Query().Get("limit"); raw != "" {
		n, err := strconv.Atoi(raw)
		if err != nil || n < 1 || n > maxHistoryLimit {
			writeError(w, http.StatusBadRequest, codeBadRequest,
				"limit must be an integer in 1.."+strconv.Itoa(maxHistoryLimit), nil)
			return
		}
		limit = n
	}

	// The newest servable batch: the vantage this history is served from, and
	// the source of the response-level withheld_engines disclosure.
	v, err := s.readBatchAccounts(r.Context(), [][]byte{})
	if err != nil {
		serveReadError(w, err)
		return
	}

	// The covered window: the newest `limit` COMPLETE batches, with each
	// batch's per-engine rollups (the refusal codes live there).
	window, err := s.readHistoryWindow(r.Context(), limit)
	if err != nil {
		writeError(w, http.StatusInternalServerError, codeInternal, err.Error(), nil)
		return
	}
	inWindow := map[int64]bool{}
	for _, b := range window {
		inWindow[b.BatchID] = true
	}

	// The address's persisted points, filtered to the window: the store reader
	// consults the newest batches CARRYING THE ACCOUNT, which can reach past
	// the requested window when the account left the book long ago — the
	// contract's `limit` covers retained batches, so points beyond it wait for
	// a larger limit rather than silently widening the window.
	points, err := s.store.AddressHistory(r.Context(), addr.Bytes(), limit)
	if err != nil {
		writeError(w, http.StatusInternalServerError, codeInternal, err.Error(), nil)
		return
	}

	type engineSeries struct {
		points   []wireHistoryPoint
		withheld []int64
		decimals int
	}
	series := map[string]*engineSeries{}
	engineOf := func(engine string) *engineSeries {
		es, ok := series[engine]
		if !ok {
			es = &engineSeries{points: []wireHistoryPoint{}, withheld: []int64{},
				decimals: engineValueDecimals[engine]}
			series[engine] = es
		}
		return es
	}
	// Every engine present in the window's rollups gets a series, so an
	// account with no points still discloses the window's shape per engine.
	// Window order is newest-first; withheld ids inherit it.
	for _, b := range window {
		for _, a := range b.Aggregates {
			es := engineOf(a.Engine)
			es.decimals = int(a.ValueDecimals)
			if a.RefusalCode != "" {
				es.withheld = append(es.withheld, b.BatchID)
			}
		}
	}
	anyPoint := false
	for _, pt := range points {
		if !inWindow[pt.BatchID] {
			continue
		}
		anyPoint = true
		p := pt.Position
		wp := wireHistoryPoint{
			BatchID:       pt.BatchID,
			ComputedAt:    pt.ComputedAt,
			BalancesBlock: uint64(p.BalancesBlock),
			SweepBlock:    uint64(p.SweepBlock),
			Status:        p.Status,
			Liquidatable:  p.Liquidatable,
		}
		if p.Status == store.RiskPositionRefused {
			wp.Refusal = &wireRefusal{
				Code:   p.RefusalCode,
				Detail: sanitize(p.RefusalDetail),
				Note:   refusalNote(p.RefusalCode),
			}
		}
		if p.HFInfinite || p.HFWad != nil || p.HFNum != nil {
			hf := &wireHealthFactor{
				Wad: bigStr(p.HFWad), Num: bigStr(p.HFNum), Den: bigStr(p.HFDen),
				Infinite: p.HFInfinite,
			}
			if p.Engine == risk.AaveEngine {
				hf.Note = "compare against 1e18 ON THE WAD; do not re-derive a float from num/den to decide eligibility."
			} else {
				hf.Note = "the Debt Manager has no health-factor wad: num/den is the exact ratio maxBorrowLT/borrowings, a disclosure. The verdict is `liquidatable`."
			}
			wp.HealthFactor = hf
		}
		// Totals in the ENGINE's own unit (the series' value_decimals): Aave's
		// base-currency totals, the Debt Manager's USD collateral/borrowings.
		if p.Engine == risk.AaveEngine {
			wp.TotalCollateralBase = bigStr(p.TotalCollateralBase)
			wp.TotalDebtBase = bigStr(p.TotalDebtBase)
		} else {
			wp.TotalCollateralBase = bigStr(p.CollateralValueUSD)
			wp.TotalDebtBase = bigStr(p.Borrowings)
		}
		engineOf(p.Engine).points = append(engineOf(p.Engine).points, wp)
	}

	// The three-valued answer over the WINDOW.
	windowWithheld := false
	for _, es := range series {
		if len(es.withheld) > 0 {
			windowWithheld = true
		}
	}
	var found *bool
	switch {
	case anyPoint:
		yes := true
		found = &yes
	case windowWithheld:
		found = nil
	default:
		no := false
		found = &no
	}
	complete := !windowWithheld
	note := "every engine was consultable in every covered batch, so `found` is a definitive answer over the window; each point speaks only for its own batch."
	if !complete {
		note = "an engine's whole book was WITHHELD in at least one covered batch (see each series' `withheld_batch_ids`): `found: true` is a floor, and `found: null` means the answer could not be established over the window and must NEVER be rendered as `no position`."
	}

	out := addressHistoryResponse{
		ServedAt:           v.Now,
		Batch:              batchEnvelope(v),
		Address:            addr.Hex(),
		Limit:              limit,
		Engines:            []wireHistoryEngine{},
		Found:              found,
		LookupComplete:     complete,
		WithheldEngines:    engineRefusals(v),
		LookupCompleteNote: note,
		Notes: []string{
			"points are PERSISTED rows from retained complete batches, newest first; nothing is recomputed for this response, so a refused batch appears as a refusal point, never a gap.",
			"retention bounds this history: batches outside the retention window are gone from this surface, and their absence is stated by `limit`, never rendered as a flat line.",
			"totals are in each ENGINE's own unit at the series' `value_decimals` (Aave: pool base currency; Debt Manager: USD) and are never blended.",
		},
	}
	for _, engine := range []string{risk.AaveEngine, risk.DMEngine} {
		es, ok := series[engine]
		if !ok {
			continue
		}
		out.Engines = append(out.Engines, wireHistoryEngine{
			Engine:           engine,
			ValueDecimals:    es.decimals,
			Points:           es.points,
			WithheldBatchIDs: es.withheld,
			Note:             "points are persisted rows, newest batch first. A batch id in `withheld_batch_ids` had this ENGINE's whole book withheld: no account on the engine has a row there, so a missing point at that id means `could not be established`, never `no position at that batch`.",
		})
	}
	writeJSON(w, out)
}

// readHistoryWindow reads the newest `limit` complete batches' per-engine
// rollups in one snapshot — the covered window's shape, including which
// batches withheld which engines.
func (s *server) readHistoryWindow(ctx context.Context, limit int) ([]observatoryBatch, error) {
	tx, err := s.store.BeginRiskSnapshot(ctx)
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	ids, err := store.CompleteBatchIDs(ctx, tx, limit)
	if err != nil {
		return nil, err
	}
	if len(ids) == 0 {
		return nil, nil
	}
	window, err := readObservatorySeries(ctx, tx, ids)
	if err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return window, nil
}
