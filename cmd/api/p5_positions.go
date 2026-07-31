package main

// GET /v1/positions — the position table, cursor-paginated and BATCH-STABLE.
//
// The page is drawn entirely from ONE batch. The cursor is minted by the store
// (internal/store.PositionsPage) and pins (batch, engine, sort, rank); this
// layer's job is the supersession law around it:
//
//   - a cursor whose pinned batch is no longer the NEWEST SERVABLE batch
//     answers 409 `batch_superseded` naming BOTH batch ids — the client
//     restarts from page one, honestly, and never receives a page silently
//     mixing two materializations;
//   - a request for a WITHHELD engine answers `refused: true` with the named
//     engine refusal, `total_positions: null` and an empty page — never an
//     empty book;
//   - `hf` on the Debt Manager is a 400: there is no DM health factor, and
//     inventing an ordering for it would blend the engines' comparators.
//
// Rows are the LEAN PositionSummary (contract 1.2.0, AMENDMENT 1/E): the
// ranked page's own fields — status, refusal, health factor, verdict, totals
// in the engine's OWN unit, boundary distance, as-of marks — without the
// per-leg and per-price fan-out (the FULL Position stays on /v1/address).
// Each summary is a PURE PROJECTION of the full wirePosition row, which
// therefore remains the single place row semantics (refusal wording,
// reconstruction refusals, HF notes, the liquidation-price solve) are chosen:
// the projection selects fields, it never re-derives them — except the
// boundary-distance kind, which folds the solve's own flags and the engine's
// own comparator into the closed LiqDistance vocabulary below.

import (
	"errors"
	"math/big"
	"net/http"
	"strconv"
	"time"

	"github.com/ethereum/go-ethereum/common"

	"github.com/kaselunt/solvent/internal/risk"
	"github.com/kaselunt/solvent/internal/store"
)

type positionsResponse struct {
	ServedAt time.Time `json:"served_at"`
	Batch    wireBatch `json:"batch"`
	Engine   string    `json:"engine"`
	Sort     string    `json:"sort"`
	Limit    int       `json:"limit"`
	// Refused is true when the requested ENGINE's whole book is withheld on
	// this batch. `positions` is then empty FOR THAT REASON — never because the
	// book is empty — and `total_positions` is null, never 0.
	Refused        bool                  `json:"refused"`
	Refusal        *wireEngineRefusal    `json:"refusal"`
	TotalPositions *int                  `json:"total_positions"`
	Positions      []wirePositionSummary `json:"positions"`
	NextCursor     *string               `json:"next_cursor"`
	Notes          []string              `json:"notes"`
}

// wireLiqDistance is the contract's closed LiqDistance vocabulary: the row's
// distance to ITS OWN engine's liquidation boundary, lean. The exact rational
// scale factor is the wire's statement — rendering a percentage from it is
// the consumer's display-precision work, never an eligibility decision.
type wireLiqDistance struct {
	Kind           string  `json:"kind"`
	ScaleFactorNum *string `json:"scale_factor_num"`
	ScaleFactorDen *string `json:"scale_factor_den"`
	FactorAsset    *string `json:"factor_asset"`
	FactorSymbol   string  `json:"factor_symbol,omitempty"`
	Reason         *string `json:"reason"`
}

// wirePositionSummary is the lean /v1/positions row (AMENDMENT 1/E).
type wirePositionSummary struct {
	Engine        string            `json:"engine"`
	Account       string            `json:"account"`
	Status        string            `json:"status"`
	ValueDecimals int16             `json:"value_decimals"`
	Refusal       *wireRefusal      `json:"refusal"`
	Flags         []string          `json:"flags"`
	HealthFactor  *wireHealthFactor `json:"health_factor"`
	Liquidatable  *bool             `json:"liquidatable"`
	// TotalCollateral/TotalDebt are the ENGINE's own totals at ValueDecimals
	// — Aave's base-currency pair, the Debt Manager's swept collateral value
	// and borrowings. Null stays null; never rendered as 0.
	TotalCollateral *string         `json:"total_collateral"`
	TotalDebt       *string         `json:"total_debt"`
	LiqDistance     wireLiqDistance `json:"liq_distance"`
	BalancesBlock   uint64          `json:"balances_block"`
	ParamsBlock     uint64          `json:"params_block"`
	SweepBlock      uint64          `json:"sweep_block"`
}

// wadOne is 1e18 — the boundary the Aave wad comparator compares against.
var wadOne = new(big.Int).Exp(big.NewInt(10), big.NewInt(18), nil)

// summaryLiquidatable applies each engine's OWN comparator to the full row:
// the Debt Manager's strict boolean verbatim; Aave's wad-vs-1e18 comparison
// ON THE WAD (never a re-derived float). false covers both "not liquidatable"
// and "no verdict publishable" — its only consumer is the breached-arm fold
// below, where an unpublishable verdict must not manufacture a breach.
func summaryLiquidatable(full wirePosition) bool {
	if full.Liquidatable != nil {
		return *full.Liquidatable
	}
	hf := full.HealthFactor
	if hf == nil || hf.Infinite || hf.Wad == nil {
		return false
	}
	wad, ok := new(big.Int).SetString(*hf.Wad, 10)
	if !ok {
		return false
	}
	return wad.Cmp(wadOne) < 0
}

// liqDistance folds the liquidation-price solve (or its absence) into the
// closed LiqDistance vocabulary. Nothing here re-solves anything: every
// input is the solve's own flag or the row's own verdict field.
func (s *server) liqDistance(full wirePosition) wireLiqDistance {
	lp := full.LiquidationPrice
	if lp == nil {
		// No solve: a refused row (including reconstruction refusals) names
		// its refusal code as the reason; otherwise the absence stands bare.
		var reason *string
		if full.Refusal != nil {
			reason = strPtr(full.Refusal.Code)
		}
		return wireLiqDistance{Kind: "none", Reason: reason}
	}
	if lp.AlreadyBreached || summaryLiquidatable(full) {
		return wireLiqDistance{Kind: "breached"}
	}
	if lp.NeverLiquidatable {
		return wireLiqDistance{Kind: "never", Reason: strPtrNonEmpty(lp.Reason)}
	}
	if !lp.InFactor || lp.ScaleFactorNum == nil || lp.ScaleFactorDen == nil {
		return wireLiqDistance{Kind: "none", Reason: strPtrNonEmpty(lp.Reason)}
	}
	out := wireLiqDistance{
		Kind:           "distance",
		ScaleFactorNum: lp.ScaleFactorNum,
		ScaleFactorDen: lp.ScaleFactorDen,
	}
	if len(lp.FactorAssets) > 0 {
		out.FactorAsset = strPtr(lp.FactorAssets[0])
		if spec, ok := s.registry.Spec(full.Engine, common.HexToAddress(lp.FactorAssets[0])); ok {
			out.FactorSymbol = spec.Symbol
		}
	}
	return out
}

func strPtrNonEmpty(v string) *string {
	if v == "" {
		return nil
	}
	return strPtr(v)
}

// positionSummary projects the FULL wire row — built by the SAME
// s.wirePosition path /v1/address serves, reconstruction refusals included —
// onto the lean page shape. Selection only; the full row stays the one place
// row semantics are chosen.
func (s *server) positionSummary(v *batchView, p *positionRow) wirePositionSummary {
	full := s.wirePosition(v, p)
	out := wirePositionSummary{
		Engine:        full.Engine,
		Account:       full.Account,
		Status:        full.Status,
		ValueDecimals: full.ValueDecimals,
		Refusal:       full.Refusal,
		Flags:         full.Flags,
		HealthFactor:  full.HealthFactor,
		Liquidatable:  full.Liquidatable,
		BalancesBlock: full.AsOf.BalancesBlock,
		ParamsBlock:   full.AsOf.ParamsBlock,
		SweepBlock:    full.AsOf.SweepBlock,
	}
	// The engine's OWN totals under the summary's one name pair —
	// value_decimals states the scale, and the quantities are never blended
	// across engines (an Aave row never serves a USD-6 figure and vice versa).
	switch full.Engine {
	case risk.AaveEngine:
		out.TotalCollateral, out.TotalDebt = full.TotalCollateralBase, full.TotalDebtBase
	case risk.DMEngine:
		out.TotalCollateral, out.TotalDebt = full.CollateralValueUSD, full.Borrowings
	}
	out.LiqDistance = s.liqDistance(full)
	return out
}

// batchSupersededBody is the 409's own shape: it must NAME both batches, so a
// client told "conflict" can distinguish a stale cursor from its own bug.
type batchSupersededBody struct {
	Error batchSupersededDetail `json:"error"`
}

type batchSupersededDetail struct {
	Code          string `json:"code"`
	Message       string `json:"message"`
	CursorBatchID int64  `json:"cursor_batch_id"`
	// CurrentBatchID is null in the race where no batch is servable at answer
	// time — a retry then meets a 503.
	CurrentBatchID *int64 `json:"current_batch_id"`
}

// writeBatchSuperseded emits the 409.
func (s *server) writeBatchSuperseded(w http.ResponseWriter, r *http.Request, cursorBatch int64) {
	var current *int64
	if b, found, err := s.store.NewestCompleteBatch(r.Context()); err == nil && found {
		id := b.ID
		current = &id
	}
	msg := "the cursor was minted against batch " + strconv.FormatInt(cursorBatch, 10) +
		", which is no longer the newest servable batch; restart pagination from page one"
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(http.StatusConflict)
	writeJSONBody(w, batchSupersededBody{Error: batchSupersededDetail{
		Code:           "batch_superseded",
		Message:        sanitize(msg),
		CursorBatchID:  cursorBatch,
		CurrentBatchID: current,
	}})
}

var positionsSorts = map[string]store.PositionSort{
	"liq_distance": store.PositionSortLiqDistance,
	"debt":         store.PositionSortDebt,
	"hf":           store.PositionSortHF,
	"status":       store.PositionSortStatus,
}

func (s *server) handlePositions(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()

	engine := q.Get("engine")
	switch engine {
	case risk.AaveEngine, risk.DMEngine:
	case "":
		writeError(w, http.StatusBadRequest, codeBadRequest,
			"engine is REQUIRED: the two engines' books rank on different comparators (Aave's wad vs the Debt Manager's strict boolean) and are never blended into one list. Pass engine=aave_v3_etherfi or engine=debt_manager.", nil)
		return
	default:
		writeError(w, http.StatusBadRequest, codeBadRequest,
			"unknown engine "+strconv.Quote(engine)+": the vocabulary is aave_v3_etherfi | debt_manager", nil)
		return
	}

	sortName := q.Get("sort")
	if sortName == "" {
		sortName = "liq_distance"
	}
	sort, ok := positionsSorts[sortName]
	if !ok {
		writeError(w, http.StatusBadRequest, codeBadRequest,
			"unknown sort "+strconv.Quote(sortName)+": the vocabulary is liq_distance | debt | hf | status", nil)
		return
	}

	limit := defaultPositionsLimit
	if raw := q.Get("limit"); raw != "" {
		n, err := strconv.Atoi(raw)
		if err != nil || n < 1 || n > maxPositionsLimit {
			writeError(w, http.StatusBadRequest, codeBadRequest,
				"limit must be an integer in 1.."+strconv.Itoa(maxPositionsLimit), nil)
			return
		}
		limit = n
	}

	cursor := q.Get("cursor")

	// Resolve the batch the page pins. Without a cursor it is the newest
	// servable batch; with one it is the cursor's pinned batch, judged for
	// supersession BEFORE any row is read.
	batch, found, err := s.store.NewestCompleteBatch(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, codeInternal, err.Error(), nil)
		return
	}
	if !found {
		serveReadError(w, errNoBatch)
		return
	}
	batchID := batch.ID
	if cursor != "" {
		cursorBatch, err := store.PositionsCursorBatch(cursor)
		if err != nil {
			writeError(w, http.StatusBadRequest, codeBadRequest, "malformed cursor: "+err.Error(), nil)
			return
		}
		still, err := s.store.BatchStillNewestServable(r.Context(), cursorBatch)
		if err != nil {
			writeError(w, http.StatusInternalServerError, codeInternal, err.Error(), nil)
			return
		}
		if !still {
			s.writeBatchSuperseded(w, r, cursorBatch)
			return
		}
		batchID = cursorBatch
	}

	// The ranked page, from the store's batch-stable reader.
	page, err := s.store.PositionsPage(r.Context(), batchID, engine, sort, cursor, limit)
	switch {
	case err == nil:
	case errors.Is(err, store.ErrPositionsSortUnsupported):
		writeError(w, http.StatusBadRequest, codeBadRequest,
			"sort "+strconv.Quote(sortName)+" is not defined for engine "+strconv.Quote(engine)+
				": the Debt Manager publishes a strict liquidatable boolean, not a health factor, and this service does not invent an ordering for it. Use liq_distance, debt or status.", nil)
		return
	case errors.Is(err, store.ErrPositionsCursorMismatch):
		writeError(w, http.StatusBadRequest, codeBadRequest,
			"cursor does not match this request: "+err.Error()+" — a cursor is bound to the (engine, sort) it was minted for; do not change parameters mid-pagination.", nil)
		return
	case errors.Is(err, store.ErrPositionsBatchMissing):
		// The pinned batch was pruned between the supersession probe and the
		// page read — which can only happen because a newer batch superseded
		// it. The honest answer is the same 409 restart.
		s.writeBatchSuperseded(w, r, batchID)
		return
	default:
		if cursor != "" && isCursorMessage(err) {
			writeError(w, http.StatusBadRequest, codeBadRequest, "malformed cursor: "+err.Error(), nil)
			return
		}
		writeError(w, http.StatusInternalServerError, codeInternal, err.Error(), nil)
		return
	}

	// The full child rows for exactly this page's accounts, through the SAME
	// read/reconstruction path /v1/address uses.
	accounts := make([][]byte, 0, len(page.Positions))
	for _, p := range page.Positions {
		accounts = append(accounts, p.Account)
	}
	v, err := s.readBatchAccounts(r.Context(), accounts)
	if err != nil {
		serveReadError(w, err)
		return
	}
	// THE MIXED-BATCH GUARD: readBatchAccounts reads the newest servable
	// batch. If a new batch landed between the page read and here, the child
	// rows would describe a different materialization than the page's ranking
	// — exactly the lie batch-stable pagination exists to prevent — so the
	// answer is the honest 409 restart, never a spliced page.
	if v.Batch.ID != batchID {
		s.writeBatchSuperseded(w, r, batchID)
		return
	}

	out := positionsResponse{
		ServedAt:  v.Now,
		Batch:     batchEnvelope(v),
		Engine:    engine,
		Sort:      sortName,
		Limit:     limit,
		Positions: []wirePositionSummary{},
		Notes: []string{
			"every row on this page was drawn from batch " + strconv.FormatInt(batchID, 10) +
				"; `next_cursor` is bound to that batch and answers 409 `batch_superseded` once it is no longer the newest servable batch. Restart from page one on 409 — a page mixing two materializations is exactly what that status exists to prevent.",
			"refused rows are ROWS: they stay on the page, named and counted, exactly as they are counted in every aggregate.",
			"rows are the lean PositionSummary; the FULL Position (legs, price inputs, liquidation-price solve, per-input provenance) is served by /v1/address/{addr}.",
		},
	}

	// The engine's persisted rollup: the total (refused rows INCLUDED) and the
	// engine-scoped withholding verdict.
	var agg *store.RiskEngineAggregate
	for i := range v.Aggregates {
		if v.Aggregates[i].Engine == engine {
			agg = &v.Aggregates[i]
			break
		}
	}
	if agg == nil {
		writeError(w, http.StatusInternalServerError, codeInternal,
			"batch "+strconv.FormatInt(batchID, 10)+" carries no aggregate for engine "+engine+
				" — the completeness predicate should make this unreachable", nil)
		return
	}
	if agg.RefusalCode != "" {
		// WITHHELD. The page is empty FOR THAT REASON; total stays null (never
		// 0) and no cursor is minted over a book nobody may read.
		out.Refused = true
		out.Refusal = &wireEngineRefusal{
			Engine: engine,
			Code:   agg.RefusalCode,
			Detail: sanitize(agg.RefusalDetail),
			Note:   engineRefusalNote(agg.RefusalCode),
		}
		out.Notes = append(out.Notes,
			"WITHHELD: this engine's whole book is refused on this batch. `positions` is empty for that reason — never because the book is empty — and `total_positions` is null, never 0.")
		writeJSON(w, out)
		return
	}
	total := agg.Positions
	out.TotalPositions = &total

	// Reorder the fully-read rows into the page's rank order.
	byKey := map[string]*positionRow{}
	for _, p := range v.Positions {
		byKey[positionKey(p.Engine, p.Account)] = p
	}
	for _, sp := range page.Positions {
		p, ok := byKey[positionKey(sp.Engine, sp.Account)]
		if !ok {
			// Same batch, same account set: a missing row means the two reads
			// disagreed about an immutable batch, which is a defect here.
			writeError(w, http.StatusInternalServerError, codeInternal,
				"page row "+common.BytesToAddress(sp.Account).Hex()+" is absent from the child-row read of the same batch", nil)
			return
		}
		out.Positions = append(out.Positions, s.positionSummary(v, p))
	}
	if page.NextCursor != "" {
		nc := page.NextCursor
		out.NextCursor = &nc
	}
	writeJSON(w, out)
}
