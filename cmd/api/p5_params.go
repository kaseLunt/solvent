package main

// GET /v1/params — the parameter timeline.
//
// The ledger is APPEND-ONLY and each row records only what its own event said:
// a field the event did not speak to is ABSENT from `fields`, never
// back-filled, and `prior` is the prior value THE EVENT ITSELF carried (the
// Debt Manager's config-set events emit old values; Aave's configurator events
// do not) — never a ledger lookback.
//
// DENOMINATORS ARE VERBATIM AND NAMED PER FIELD (the migration-00011 law):
// Aave publishes basis points (1e4 scale); the Debt Manager's percent scale is
// 100e18 and its admin APY is per-second at that same scale. The two differ by
// 1e16 and a silent unit mix is a mispriced liquidation, so no cross-engine
// normalization exists anywhere on this surface.

import (
	"math/big"
	"net/http"
	"strconv"
	"time"

	"github.com/ethereum/go-ethereum/common"

	"github.com/kaselunt/solvent/internal/risk"
	"github.com/kaselunt/solvent/internal/store"
)

// The per-field unit names, engine-exact.
const (
	unitBps       = "bps"
	unitDMPercent = "percent-100e18"
	unitDMApy     = "per-second-100e18"
	unitAddress   = "address"
	unitCount     = "count"
)

type wireParamField struct {
	Name    string  `json:"name"`
	Value   *string `json:"value"`
	Address *string `json:"address"`
	Prior   *string `json:"prior"`
	Unit    string  `json:"unit"`
}

type wireParamChange struct {
	Engine            string           `json:"engine"`
	ChainID           uint64           `json:"chain_id"`
	Asset             *string          `json:"asset"`
	Symbol            string           `json:"symbol,omitempty"`
	Fields            []wireParamField `json:"fields"`
	EffectiveBlock    uint64           `json:"effective_block"`
	EffectiveLogIndex uint32           `json:"effective_log_index"`
	SourceEvent       string           `json:"source_event"`
	TxHash            string           `json:"tx_hash"`
	BlockTime         *time.Time       `json:"block_time"`
}

type paramsResponse struct {
	ServedAt   time.Time         `json:"served_at"`
	Engine     *string           `json:"engine"`
	Asset      *string           `json:"asset"`
	Params     []wireParamChange `json:"params"`
	NextCursor *string           `json:"next_cursor"`
	Notes      []string          `json:"notes"`
}

func (s *server) handleParams(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()

	engine, ok := parseEngineParam(w, q.Get("engine"))
	if !ok {
		return
	}
	var engineEcho *string
	if engine != "" {
		engineEcho = strPtr(engine)
	}

	var asset []byte
	var assetEcho *string
	if raw := q.Get("asset"); raw != "" {
		addr, err := parseAddress(raw)
		if err != nil {
			writeError(w, http.StatusBadRequest, codeBadRequest, "invalid asset: "+err.Error(), nil)
			return
		}
		asset = addr.Bytes()
		assetEcho = strPtr(addr.Hex())
	}

	cursor := q.Get("cursor")
	res, err := s.store.ParamTimeline(r.Context(), engine, asset, cursor, defaultParamsLimit)
	if err != nil {
		if cursor != "" && isCursorMessage(err) {
			writeError(w, http.StatusBadRequest, codeBadRequest, "malformed cursor: "+err.Error(), nil)
			return
		}
		writeError(w, http.StatusInternalServerError, codeInternal, err.Error(), nil)
		return
	}

	now, err := s.dbNow(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, codeInternal, err.Error(), nil)
		return
	}

	out := paramsResponse{
		ServedAt: now,
		Engine:   engineEcho,
		Asset:    assetEcho,
		Params:   []wireParamChange{},
		Notes: []string{
			"denominations are the ENGINE's own and are named per field: Aave publishes bps (1e4 scale); the Debt Manager's percent scale is 100e18 and its admin APY is per-second at that scale. No cross-engine normalization exists — the two differ by 1e16 and a silent unit mix is a mispriced liquidation.",
			"the ledger is append-only: each row records only what its own event said. A field the event did not speak to is absent; `prior` is the prior value the event itself carried, never a ledger lookback — read the preceding row for the preceding value.",
			"`block_time` is null until the block's header is custodied — never fabricated.",
		},
	}

	for _, e := range res.Entries {
		wc := wireParamChange{
			Engine:            publicParamEngine(e.Engine),
			ChainID:           e.ChainID,
			Asset:             hexAddrPtr(e.Asset),
			Fields:            paramFields(e),
			EffectiveBlock:    e.BlockNumber,
			EffectiveLogIndex: e.LogIndex,
			SourceEvent:       e.SourceEvent,
			TxHash:            hexBytes(e.TxHash),
			BlockTime:         e.BlockTime,
		}
		if len(e.Asset) > 0 {
			if spec, ok := s.registry.Spec(wc.Engine, common.BytesToAddress(e.Asset)); ok {
				wc.Symbol = spec.Symbol
			}
		}
		out.Params = append(out.Params, wc)
	}
	if res.NextCursor != "" {
		out.NextCursor = strPtr(res.NextCursor)
	}
	writeJSON(w, out)
}

// publicParamEngine maps the ledger's WRITER identity onto the public engine
// vocabulary: the PoolConfigurator stream (`aave_param`) writes the Aave
// instance's parameters.
func publicParamEngine(writer string) string {
	if writer == risk.AaveParamEngine {
		return risk.AaveEngine
	}
	return writer
}

// paramFields renders exactly the fields ONE EVENT spoke to, in a fixed order.
func paramFields(e store.ParamTimelineEntry) []wireParamField {
	out := []wireParamField{}
	numeric := func(name string, v, prior *big.Int, unit string) {
		if v == nil {
			return
		}
		out = append(out, wireParamField{Name: name, Value: bigStr(v), Prior: bigStr(prior), Unit: unit})
	}
	addr := func(name string, b []byte) {
		if len(b) == 0 {
			return
		}
		out = append(out, wireParamField{Name: name, Address: hexAddrPtr(b), Unit: unitAddress})
	}

	ratioUnit := unitBps
	if e.Engine == risk.DMEngine {
		ratioUnit = unitDMPercent
	}
	numeric("ltv", e.LTV, e.PriorLTV, ratioUnit)
	numeric("liq_threshold", e.LiqThreshold, e.PriorLiqThreshold, ratioUnit)
	numeric("liq_bonus", e.LiqBonus, e.PriorLiqBonus, ratioUnit)
	if e.EModeCategory != nil {
		v := strconv.FormatUint(uint64(*e.EModeCategory), 10)
		out = append(out, wireParamField{Name: "emode_category", Value: &v, Unit: unitCount})
	}
	addr("atoken", e.AToken)
	addr("variable_debt_token", e.VariableDebtToken)
	addr("strategy", e.Strategy)
	numeric("borrow_apy", e.BorrowAPY, e.PriorBorrowAPY, unitDMApy)
	return out
}
