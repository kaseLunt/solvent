package main

// GET /v1/observatory/series — the durable per-engine rollup over
// observatory_points (Task B2's table, Task B1's reader).
//
// Each point states what the engine's book looked like AT ITS BUCKET: a bucket
// captured while the engine's whole book was withheld carries NULL totals and
// names its refusal code — a rollup that rendered an unproven book as zero
// debt would fabricate the exact reassurance this surface exists to withhold.
//
// A `step` larger than the native hourly bucket serves every Nth captured
// bucket VERBATIM — never an average of the buckets it skips.
//
// A database whose daemon has not applied migration 00016 yet answers a typed
// `unavailable` error naming the missing rollup — never an empty series
// pretending the record exists and is blank.

import (
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"sort"
	"strconv"
	"time"

	"github.com/ethereum/go-ethereum/common"

	"github.com/kaselunt/solvent/internal/store"
)

// observatoryRatesDoc is the rates snapshot's persisted JSON shape — B2's
// 00016 contract: {"<asset-hex>": {"<kind>": {"value": "<decimal>", "block": N}}}.
type observatoryRateEntry struct {
	Value string `json:"value"`
	Block int64  `json:"block"`
}

type wireObservatorySeriesPoint struct {
	BucketStart time.Time `json:"bucket_start"`
	LastBlock   uint64    `json:"last_block"`
	// Observation provenance (1.2.0): which batch the bucket observed — the
	// id, the deterministic materialization key (it SURVIVES batch retention,
	// so the observation stays attributable after the batch is pruned) and
	// the reorg-honesty stamp pair copied from the batch's watermark vector.
	BatchID            int64  `json:"batch_id"`
	MaterializationKey string `json:"materialization_key"`
	AckedEpoch         int64  `json:"acked_epoch"`
	MaxEpochAtCompute  int64  `json:"max_epoch_at_compute"`
	// The engine's sweep stamp in the observed batch's watermark vector,
	// copied at capture time (1.2.2, migration 00018) — the bucket's
	// liquidatable count belongs to this sweep-cut, not to the bucket's
	// block/time clocks. SweepRecorded false is the pre-00018 point whose
	// batch was pruned before the backfill: the record genuinely does not
	// exist, and a null there is UNRECORDED — never "this engine has no
	// sweeper", which is what a null under SweepRecorded=true means.
	SweepRecorded bool            `json:"sweep_recorded"`
	Sweep         *wireSweepStamp `json:"sweep"`
	// Refused is true when the engine's whole book was withheld at capture
	// time. Totals are then null FOR THAT REASON, never 0.
	Refused     bool    `json:"refused"`
	RefusalCode *string `json:"refusal_code"`
	Accounts    *int    `json:"accounts"`
	// RefusedPositions counts refused POSITION ROWS in the bucket — zero on a
	// withheld engine with no rows behind it, which is why `refused` exists on
	// the point itself.
	RefusedPositions      int             `json:"refused_positions"`
	LiquidatablePositions *int            `json:"liquidatable_positions"`
	DebtUSD               *string         `json:"debt_usd"`
	CollateralUSD         *string         `json:"collateral_usd"`
	Rates                 []wireRateIndex `json:"rates"`
}

type observatorySeriesResponse struct {
	ServedAt    time.Time                    `json:"served_at"`
	Engine      string                       `json:"engine"`
	UsdDecimals int                          `json:"usd_decimals"`
	From        *time.Time                   `json:"from"`
	To          *time.Time                   `json:"to"`
	StepSeconds *int                         `json:"step_seconds"`
	Points      []wireObservatorySeriesPoint `json:"points"`
	Notes       []string                     `json:"notes"`
}

func (s *server) handleObservatorySeries(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	engine := q.Get("engine")
	if engine == "" {
		writeError(w, http.StatusBadRequest, codeBadRequest,
			"engine is REQUIRED: the rollup is per engine and engines are never silently combined. Pass engine=aave_v3_etherfi or engine=debt_manager.", nil)
		return
	}
	if _, ok := parseEngineParam(w, engine); !ok {
		return
	}

	parseTime := func(name string) (*time.Time, bool) {
		raw := q.Get(name)
		if raw == "" {
			return nil, true
		}
		t, err := time.Parse(time.RFC3339, raw)
		if err != nil {
			writeError(w, http.StatusBadRequest, codeBadRequest,
				name+" must be an RFC 3339 date-time (e.g. 2026-07-29T08:00:00Z)", nil)
			return nil, false
		}
		u := t.UTC()
		return &u, true
	}
	from, ok := parseTime("from")
	if !ok {
		return
	}
	to, ok := parseTime("to")
	if !ok {
		return
	}

	var step int
	var stepEcho *int
	if raw := q.Get("step"); raw != "" {
		n, err := strconv.Atoi(raw)
		if err != nil || n < 3600 {
			writeError(w, http.StatusBadRequest, codeBadRequest,
				"step must be an integer number of seconds, at least the native bucket (3600)", nil)
			return
		}
		step = n
		stepEcho = intPtr(n)
	}

	points, err := s.store.ObservatorySeries(r.Context(), engine, from, to, maxObservatorySeriesPoints)
	if errors.Is(err, store.ErrObservatoryUnavailable) {
		// The rollup table does not exist on this database (pre-00016 deploy).
		// The honest degraded answer is a TYPED error naming the reason — never
		// an empty series pretending the record exists and is blank.
		writeError(w, http.StatusInternalServerError, codeUnavailable,
			"the observatory rollup (observatory_points, migration 00016) has not been applied on this database, so the series cannot be served. This is a statement about the deployment, not a claim that the record is empty.", nil)
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, codeInternal, err.Error(), nil)
		return
	}

	now, err := s.dbNow(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, codeInternal, err.Error(), nil)
		return
	}

	out := observatorySeriesResponse{
		ServedAt:    now,
		Engine:      engine,
		UsdDecimals: engineValueDecimals[engine],
		From:        from,
		To:          to,
		StepSeconds: stepEcho,
		Points:      []wireObservatorySeriesPoint{},
		Notes: []string{
			"a withheld bucket carries NULL totals and names its refusal code: a rollup that rendered an unproven book as zero debt would fabricate the exact reassurance this surface exists to withhold.",
			"every served point is an exact captured bucket, oldest first; a `step` larger than the native hour serves every Nth captured bucket VERBATIM — nothing is averaged, interpolated or smoothed.",
			"each point's `last_block` is the engine's balances watermark AT CAPTURE TIME — the bucket's own as-of, never a chain head observed later — and each rate index carries its OWN as-of block.",
			"each point names the batch it observed (`batch_id`, `materialization_key`) and the reorg-honesty stamp pair copied from that batch's watermark vector; the materialization key survives batch retention, so an observation stays attributable after its batch is pruned.",
			"each point's `sweep` is the observed batch's own sweep stamp, copied at capture time: Debt Manager collateral is sweep-sourced, so the bucket's liquidatable count belongs to that sweep-cut, not to the bucket's block or time clocks. `sweep_recorded: false` marks pre-00018 history whose batch was pruned before the stamp could be recovered — an absent record, disclosed, never rendered as \"no sweeper\".",
		},
	}
	if len(points) > 0 {
		out.UsdDecimals = int(points[0].ValueDecimals)
	}
	if len(points) == maxObservatorySeriesPoints {
		out.Notes = append(out.Notes,
			"this response reached the server's per-request point cap ("+strconv.Itoa(maxObservatorySeriesPoints)+"); narrow `from`/`to` to read the rest — the series was TRUNCATED at the cap, newest buckets first to go.")
	}

	var lastServed time.Time
	served := false
	for _, p := range points {
		if step > 0 && served && p.BucketStart.Before(lastServed.Add(time.Duration(step)*time.Second)) {
			continue
		}
		wp, err := wireObservatoryPointFrom(now, p)
		if err != nil {
			writeError(w, http.StatusInternalServerError, codeInternal, err.Error(), nil)
			return
		}
		if len(wp.Rates) > 0 {
			for i := range wp.Rates {
				if spec, ok := s.registry.Spec(engine, common.HexToAddress(wp.Rates[i].Asset)); ok {
					wp.Rates[i].Symbol = spec.Symbol
				}
			}
		}
		out.Points = append(out.Points, wp)
		lastServed, served = p.BucketStart, true
	}
	writeJSON(w, out)
}

// wireObservatoryPointFrom renders one captured bucket. A refused bucket's
// totals are null — the persisted zeros mean WITHHELD, and republishing them
// as values is exactly how an unproven book becomes "nothing at risk".
//
// `now` is the response's database clock, used ONLY for the sweep stamp's
// age_seconds (DB-now minus the stamp) — every other field is the bucket's
// immutable capture-time record.
func wireObservatoryPointFrom(now time.Time, p store.ObservatoryPoint) (wireObservatorySeriesPoint, error) {
	out := wireObservatorySeriesPoint{
		BucketStart:        p.BucketStart,
		LastBlock:          p.LastBlock,
		BatchID:            p.BatchID,
		MaterializationKey: p.MaterializationKey,
		AckedEpoch:         p.AckedEpoch,
		MaxEpochAtCompute:  p.MaxEpochAtCompute,
		SweepRecorded:      p.SweepRecorded,
		Sweep:              wireSweepFrom(now, p.Sweep),
		RefusedPositions:   p.RefusedPositions,
		Rates:              []wireRateIndex{},
	}
	if p.RefusalCode != "" {
		out.Refused = true
		out.RefusalCode = strPtr(p.RefusalCode)
	} else {
		accounts := p.Positions
		liq := p.LiquidatablePositions
		out.Accounts = &accounts
		out.LiquidatablePositions = &liq
		out.DebtUSD = bigStr(p.TotalDebt)
		out.CollateralUSD = bigStr(p.TotalCollateral)
	}

	// Decode the rates snapshot (B2's persisted shape, verbatim decimal
	// strings with their own as-of blocks).
	if len(p.Rates) > 0 {
		var doc map[string]map[string]observatoryRateEntry
		if err := json.Unmarshal(p.Rates, &doc); err != nil {
			return out, fmt.Errorf("observatory bucket %s/%s: rates snapshot does not decode: %w",
				p.Engine, p.BucketStart.Format(time.RFC3339), err)
		}
		for assetHex, kinds := range doc {
			assetBytes, err := hex.DecodeString(assetHex)
			if err != nil || len(assetBytes) != 20 {
				return out, fmt.Errorf("observatory bucket %s/%s: rates snapshot asset %q is not a 20-byte hex address",
					p.Engine, p.BucketStart.Format(time.RFC3339), assetHex)
			}
			for kind, entry := range kinds {
				out.Rates = append(out.Rates, wireRateIndex{
					Engine:    p.Engine,
					Asset:     common.BytesToAddress(assetBytes).Hex(),
					Kind:      kind,
					Scale:     rateIndexScale(kind),
					Value:     entry.Value,
					AsOfBlock: uint64(entry.Block),
					Note:      "as of its OWN last update (ReserveDataUpdated / the DM admin event), which can trail the bucket.",
				})
			}
		}
		sort.Slice(out.Rates, func(i, j int) bool {
			if out.Rates[i].Asset != out.Rates[j].Asset {
				return out.Rates[i].Asset < out.Rates[j].Asset
			}
			return out.Rates[i].Kind < out.Rates[j].Kind
		})
	}
	return out, nil
}
