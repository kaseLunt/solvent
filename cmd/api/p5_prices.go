package main

// GET /v1/prices/{asset} — the retained price ledger for one asset, one series
// per (chain_id, source) key.
//
// # Quarantine is evidence, not garbage
//
// Rows carrying valid=false (D-012 reorg neutralization, non-positive answers)
// are RETAINED AND SERVED with their reasons, and each series summarizes its
// quarantined block ranges so a renderer cannot miss them even when `step`
// skips the rows themselves.
//
// # Downsampling SELECTS, never averages
//
// `step` serves every custodied row whose block clears the previously served
// row by at least `step` blocks — each served point is an EXACT row. The
// stride additionally RESTARTS at every validity boundary, so a
// valid-invalid-valid sequence serves exact rows from each segment and a
// quarantined observation can never be smoothed into a valid-looking line.
//
// # source_as_of is chain-asserted or null
//
// Database insert time is never substituted; a row with no as-of says so with
// null. anchor_block is the poll anchor binding the observation to a custodied
// block hash where one survives — null is a provenance statement, not a gap to
// hide. (The store's PriceSeries reader does not carry the anchor yet, so this
// layer reads it from the same table in a supplemental SELECT — a read-only
// composition, owed to the store as a reader extension.)

import (
	"context"
	"fmt"
	"net/http"
	"sort"
	"strconv"
	"time"

	"github.com/kaselunt/solvent/internal/riskfeed"
	"github.com/kaselunt/solvent/internal/store"
)

type wirePricePoint struct {
	BlockNumber   uint64     `json:"block_number"`
	Value         *string    `json:"value"`
	AnchorBlock   *uint64    `json:"anchor_block"`
	SourceAsOf    *time.Time `json:"source_as_of"`
	Valid         bool       `json:"valid"`
	InvalidReason string     `json:"invalid_reason"`
}

type wireQuarantinedRange struct {
	FromBlock uint64      `json:"from_block"`
	ToBlock   uint64      `json:"to_block"`
	Rows      int64       `json:"rows"`
	Reasons   []wireCount `json:"reasons"`
}

type wirePriceSeries struct {
	ChainID     uint64                 `json:"chain_id"`
	Asset       string                 `json:"asset"`
	Symbol      string                 `json:"symbol,omitempty"`
	Source      string                 `json:"source"`
	OwnerEngine string                 `json:"owner_engine"`
	Provenance  string                 `json:"provenance"`
	Decimals    int                    `json:"decimals"`
	Points      []wirePricePoint       `json:"points"`
	Quarantined []wireQuarantinedRange `json:"quarantined_ranges"`
	Note        string                 `json:"note"`
}

type pricesResponse struct {
	ServedAt  time.Time         `json:"served_at"`
	Asset     string            `json:"asset"`
	Source    *string           `json:"source"`
	FromBlock *int64            `json:"from_block"`
	ToBlock   *int64            `json:"to_block"`
	Step      *int64            `json:"step"`
	Series    []wirePriceSeries `json:"series"`
	Notes     []string          `json:"notes"`
}

func (s *server) handlePrices(w http.ResponseWriter, r *http.Request) {
	addr, err := parseAddress(r.PathValue("asset"))
	if err != nil {
		writeError(w, http.StatusBadRequest, codeBadRequest, "invalid asset: "+err.Error(), nil)
		return
	}
	q := r.URL.Query()
	source := q.Get("source")

	parseBlock := func(name string) (*uint64, *int64, bool) {
		raw := q.Get(name)
		if raw == "" {
			return nil, nil, true
		}
		n, err := strconv.ParseInt(raw, 10, 64)
		if err != nil || n < 0 {
			writeError(w, http.StatusBadRequest, codeBadRequest, name+" must be a non-negative integer", nil)
			return nil, nil, false
		}
		u := uint64(n)
		return &u, int64Ptr(n), true
	}
	fromBlock, fromEcho, ok := parseBlock("from_block")
	if !ok {
		return
	}
	toBlock, toEcho, ok := parseBlock("to_block")
	if !ok {
		return
	}
	var step uint64
	var stepEcho *int64
	if raw := q.Get("step"); raw != "" {
		n, err := strconv.ParseInt(raw, 10, 64)
		if err != nil || n < 1 {
			writeError(w, http.StatusBadRequest, codeBadRequest, "step must be a positive integer", nil)
			return
		}
		step = uint64(n)
		stepEcho = int64Ptr(n)
	}

	// The ledger holds rows on both chains; the response is one series per
	// (chain, source) key, so both custody chains are consulted.
	chains := []uint64{s.cfg.Aave.ChainID}
	if s.cfg.DM.ChainID != s.cfg.Aave.ChainID {
		chains = append(chains, s.cfg.DM.ChainID)
	}
	var allPoints []chainPricePoint
	for _, chainID := range chains {
		res, err := s.store.PriceSeries(r.Context(), store.PriceSeriesQuery{
			ChainID: chainID, Asset: addr.Bytes(), Source: source,
			FromBlock: fromBlock, ToBlock: toBlock,
			// Raw rows always: the contract's `step` SELECTS exact rows, and
			// the selection (with its validity-boundary restart) happens here.
		})
		if err != nil {
			writeError(w, http.StatusInternalServerError, codeInternal, err.Error(), nil)
			return
		}
		anchors, err := s.readPriceAnchors(r.Context(), chainID, addr.Bytes(), source, fromBlock, toBlock)
		if err != nil {
			writeError(w, http.StatusInternalServerError, codeInternal, err.Error(), nil)
			return
		}
		for _, p := range res.Points {
			cp := chainPricePoint{chainID: chainID, point: p}
			if a, ok := anchors[anchorKey{p.Source, p.BlockNumber}]; ok {
				cp.anchor = a
			}
			allPoints = append(allPoints, cp)
		}
	}

	now, err := s.dbNow(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, codeInternal, err.Error(), nil)
		return
	}

	out := pricesResponse{
		ServedAt:  now,
		Asset:     addr.Hex(),
		FromBlock: fromEcho,
		ToBlock:   toEcho,
		Step:      stepEcho,
		Series:    []wirePriceSeries{},
		Notes: []string{
			"an asset with no custodied observations answers with an empty `series` — an ANSWER about custody, not a claim that the asset has no price.",
			"downsampling serves EXACT custodied rows and never averages; the stride restarts at every validity boundary, so a quarantined observation never contributes to a valid-looking point and each validity segment serves at least one exact row.",
			"`source_as_of` is the chain-asserted as-of; database insert time is never substituted. `anchor_block` is the poll anchor binding the observation to a custodied block hash; null is a provenance statement, not a gap.",
		},
	}
	if source != "" {
		out.Source = strPtr(source)
	}

	// Group by (chain, source) — the store returns each chain's rows
	// source-major, block-ascending, so grouping preserves order.
	type seriesKey struct {
		chain  uint64
		source string
	}
	grouped := map[seriesKey][]chainPricePoint{}
	var keys []seriesKey
	for _, p := range allPoints {
		k := seriesKey{p.chainID, p.point.Source}
		if _, ok := grouped[k]; !ok {
			keys = append(keys, k)
		}
		grouped[k] = append(grouped[k], p)
	}
	sort.Slice(keys, func(i, j int) bool {
		if keys[i].chain != keys[j].chain {
			return keys[i].chain < keys[j].chain
		}
		return keys[i].source < keys[j].source
	})

	for _, k := range keys {
		rows := grouped[k]
		ws := wirePriceSeries{
			ChainID:     k.chain,
			Asset:       addr.Hex(),
			Source:      sanitize(k.source),
			OwnerEngine: rows[0].point.OwnerEngine,
			Decimals:    int(rows[0].point.Decimals),
			Points:      []wirePricePoint{},
			Quarantined: []wireQuarantinedRange{},
			Note:        "quarantined rows are retained and served with their reasons; they are never deleted and never smoothed into the valid series.",
		}
		if class, err := riskfeed.ProvenanceClass(k.source); err == nil {
			ws.Provenance = class
		}
		if spec, ok := s.symbolByChainAsset(k.chain, addr.Hex()); ok {
			ws.Symbol = spec
		}
		for _, p := range rows {
			// Mixed decimals under one (chain, source) key would make the
			// series' single declared scale a lie for part of it; no writer
			// produces that state, so it is refused loudly rather than served
			// mislabeled.
			if int(p.point.Decimals) != ws.Decimals {
				writeError(w, http.StatusInternalServerError, codeInternal,
					fmt.Sprintf("price series %d/%s carries mixed decimals (%d and %d) — refusing to label the series with a single scale", k.chain, k.source, ws.Decimals, p.point.Decimals), nil)
				return
			}
		}
		for _, p := range stridePricePoints(rows, step) {
			wp := wirePricePoint{
				BlockNumber:   p.point.BlockNumber,
				Value:         bigStr(p.point.Price),
				AnchorBlock:   p.anchor,
				SourceAsOf:    p.point.SourceAsOf,
				Valid:         p.point.Valid,
				InvalidReason: sanitize(p.point.InvalidReason),
			}
			ws.Points = append(ws.Points, wp)
		}
		ws.Quarantined = quarantineRangesWire(rows)
		out.Series = append(out.Series, ws)
	}
	writeJSON(w, out)
}

type chainPricePoint struct {
	chainID uint64
	point   store.PricePoint
	anchor  *uint64
}

// stridePricePoints selects every row whose block clears the previously served
// row by at least `step`, RESTARTING at each validity flip so every validity
// segment serves its first exact row. step 0/1 serves every row.
func stridePricePoints(rows []chainPricePoint, step uint64) []chainPricePoint {
	if step <= 1 {
		return rows
	}
	var out []chainPricePoint
	var lastBlock uint64
	var haveLast, lastValid bool
	for _, p := range rows {
		boundary := !haveLast || p.point.Valid != lastValid
		if boundary || p.point.BlockNumber >= lastBlock+step {
			out = append(out, p)
			lastBlock, lastValid, haveLast = p.point.BlockNumber, p.point.Valid, true
		}
	}
	return out
}

// quarantineRangesWire summarizes each maximal consecutive invalid run with
// PER-REASON COUNTS, computed from the raw rows so the summary stays exact
// whatever `step` skipped.
func quarantineRangesWire(rows []chainPricePoint) []wireQuarantinedRange {
	out := []wireQuarantinedRange{}
	var cur *wireQuarantinedRange
	var reasons map[string]int
	flush := func() {
		if cur == nil {
			return
		}
		cur.Reasons = counts(reasons)
		out = append(out, *cur)
		cur = nil
	}
	for _, p := range rows {
		if p.point.Valid {
			flush()
			continue
		}
		if cur == nil {
			cur = &wireQuarantinedRange{FromBlock: p.point.BlockNumber}
			reasons = map[string]int{}
		}
		cur.ToBlock = p.point.BlockNumber
		cur.Rows++
		if p.point.InvalidReason != "" {
			reasons[sanitize(p.point.InvalidReason)]++
		}
	}
	flush()
	return out
}

// readPriceAnchors reads anchor_block for the selected ledger rows — the one
// column the store's PriceSeries reader does not carry yet.
func (s *server) readPriceAnchors(ctx context.Context, chainID uint64, asset []byte, source string, fromBlock, toBlock *uint64) (map[anchorKey]*uint64, error) {
	sql := `SELECT source, block_number, anchor_block FROM prices WHERE chain_id = $1 AND asset = $2`
	args := []any{int64(chainID), asset}
	if source != "" {
		args = append(args, source)
		sql += fmt.Sprintf(" AND source = $%d", len(args))
	}
	if fromBlock != nil {
		args = append(args, int64(*fromBlock))
		sql += fmt.Sprintf(" AND block_number >= $%d", len(args))
	}
	if toBlock != nil {
		args = append(args, int64(*toBlock))
		sql += fmt.Sprintf(" AND block_number <= $%d", len(args))
	}
	rows, err := s.store.Querier().Query(ctx, sql, args...)
	if err != nil {
		return nil, fmt.Errorf("read price anchors: %w", err)
	}
	defer rows.Close()
	out := map[anchorKey]*uint64{}
	for rows.Next() {
		var src string
		var block int64
		var anchor *int64
		if err := rows.Scan(&src, &block, &anchor); err != nil {
			return nil, fmt.Errorf("scan price anchor: %w", err)
		}
		var a *uint64
		if anchor != nil {
			u := uint64(*anchor)
			a = &u
		}
		out[anchorKey{src, uint64(block)}] = a
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate price anchors: %w", err)
	}
	return out, nil
}

type anchorKey struct {
	source string
	block  uint64
}

// symbolByChainAsset resolves a display symbol from the committed feed
// registry by (chain, asset) — price series are keyed by chain, not engine.
func (s *server) symbolByChainAsset(chainID uint64, assetHex string) (string, bool) {
	for _, f := range s.feeds.Assets {
		if f.ChainID == chainID && f.Address.Hex() == assetHex && f.Symbol != "" {
			return f.Symbol, true
		}
	}
	return "", false
}
