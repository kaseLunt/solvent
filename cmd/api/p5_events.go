package main

// GET /v1/events — the durable chain-action feed.
//
// # The display-vocabulary bridge
//
// The store's feed vocabulary (internal/store.EventDisplayClass) is wider than
// the contract's: it also classifies aToken balance transfers, migration
// genesis imports and the Debt Manager's config events, because the STORE's
// vocabulary must be total over the derivers' closed event sets. The contract
// (api/openapi.yaml, EventDisplayType) deliberately narrows the FEED to user
// chain actions: transfers and migration imports are bookkeeping there, and
// parameter changes are served by /v1/params. This file owns that bridge, in
// both directions, as CLOSED MAPS — an unmapped class is a loud 500 (vocabulary
// drift), never a silently dropped or mislabeled row.
//
// # block_time is chain-asserted or absent
//
// A row's block_time comes from block-header custody (Task B2) and is NULL
// until the header is custodied. This layer NEVER substitutes a database clock
// — the null is the honest state and the client renders the block number.
//
// # Amounts are the CUSTODIED deltas, verbatim
//
// FeedEvent.Delta is the engine's own accounting unit (Debt Manager: normalized
// debt; Aave: ray-scaled token units) — NOT a display-ready token amount, and
// the store tags each row's unit (DeltaUnit). The pinned 1.1.0 contract has no
// per-row unit field (that is amendment C2's correction), so this layer serves
// the delta VERBATIM with `amount_decimals: null` — "no display scale is
// asserted for this figure" — and states the unit law in the response notes.
// Rescaling the delta into token units here would be exactly the re-derivation
// this service refuses everywhere else.

import (
	"fmt"
	"math/big"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/ethereum/go-ethereum/common"

	"github.com/kaselunt/solvent/internal/risk"
	"github.com/kaselunt/solvent/internal/riskfeed"
	"github.com/kaselunt/solvent/internal/store"
)

// feedTypeParam maps one CONTRACT display type to the store class that serves
// it. rawType, when non-empty, narrows the class to one raw event type
// (the store's collateral_flag class covers both toggle directions; the
// contract names them separately).
type feedTypeParam struct {
	class   store.EventDisplayClass
	rawType string
}

// contractFeedTypes is the contract's closed EventDisplayType vocabulary.
var contractFeedTypes = map[string]feedTypeParam{
	"borrow":              {class: store.EventDisplayBorrow},
	"repay":               {class: store.EventDisplayRepay},
	"supply":              {class: store.EventDisplaySupply},
	"withdraw":            {class: store.EventDisplayWithdraw},
	"liquidation":         {class: store.EventDisplayLiquidation},
	"deficit_created":     {class: store.EventDisplayBadDebt},
	"collateral_enabled":  {class: store.EventDisplayCollateralFlag, rawType: store.AaveCollateralEnabledEvent},
	"collateral_disabled": {class: store.EventDisplayCollateralFlag, rawType: store.AaveCollateralDisabledEvent},
}

// contractFeedClasses is every store class the contract's feed serves — the
// default filter when no `types` are requested. Transfer, Migration and Config
// are DELIBERATELY absent: the contract bookkeeping-filters transfers and
// migration imports, and parameter changes belong to /v1/params.
var contractFeedClasses = []store.EventDisplayClass{
	store.EventDisplayBorrow, store.EventDisplayRepay,
	store.EventDisplaySupply, store.EventDisplayWithdraw,
	store.EventDisplayLiquidation, store.EventDisplayBadDebt,
	store.EventDisplayCollateralFlag,
}

// contractDisplayType maps a served row back onto the contract vocabulary.
// ok=false means the row's class is outside the contract's feed — reaching
// that on a row the filter admitted is vocabulary drift and a loud failure.
func contractDisplayType(e store.FeedEvent) (string, bool) {
	switch e.DisplayType {
	case store.EventDisplayBorrow:
		return "borrow", true
	case store.EventDisplayRepay:
		return "repay", true
	case store.EventDisplaySupply:
		return "supply", true
	case store.EventDisplayWithdraw:
		return "withdraw", true
	case store.EventDisplayLiquidation:
		return "liquidation", true
	case store.EventDisplayBadDebt:
		return "deficit_created", true
	case store.EventDisplayCollateralFlag:
		switch e.RawType {
		case store.AaveCollateralEnabledEvent:
			return "collateral_enabled", true
		case store.AaveCollateralDisabledEvent:
			return "collateral_disabled", true
		}
	}
	return "", false
}

type wireEventFilter struct {
	Engine     *string  `json:"engine"`
	Account    *string  `json:"account"`
	Types      []string `json:"types"`
	SinceBlock *int64   `json:"since_block"`
}

type wireSeizedCollateral struct {
	Asset    string `json:"asset"`
	Symbol   string `json:"symbol,omitempty"`
	Amount   string `json:"amount"`
	Decimals int    `json:"decimals"`
}

type wireLiquidationDetail struct {
	Liquidator   string                 `json:"liquidator"`
	DebtAsset    *string                `json:"debt_asset"`
	DebtRepaid   *string                `json:"debt_repaid"`
	DebtDecimals *int                   `json:"debt_decimals"`
	Seized       []wireSeizedCollateral `json:"seized"`
	// RealizedBonusBps is served ONLY when the payload's own facts establish it
	// in bps. Neither engine's payload does today (the Debt Manager records its
	// realized bonus in its 100e18 denomination, and Aave's would need
	// event-time prices this service does not re-read), so it is null — never
	// estimated, never unit-converted into a plausible-looking number.
	RealizedBonusBps *string `json:"realized_bonus_bps"`
	// ConfiguredBonusBps is the configured bonus AT THIS EVENT's effective
	// params, read from the custodied param ledger. Aave publishes bps (the
	// premium over par); the Debt Manager's denomination is 100e18, not bps, so
	// its rows serve null rather than a silent unit conversion.
	ConfiguredBonusBps *string `json:"configured_bonus_bps"`
	Note               string  `json:"note"`
}

type wireChainEvent struct {
	ChainID     uint64     `json:"chain_id"`
	Engine      string     `json:"engine"`
	BlockNumber uint64     `json:"block_number"`
	BlockTime   *time.Time `json:"block_time"`
	TxHash      string     `json:"tx_hash"`
	LogIndex    uint32     `json:"log_index"`
	Seq         uint16     `json:"seq"`
	Type        string     `json:"type"`
	RawType     string     `json:"raw_type"`
	Account     string     `json:"account"`
	Asset       *string    `json:"asset"`
	Symbol      string     `json:"symbol,omitempty"`
	Amount      *string    `json:"amount"`
	// AmountDecimals is null on every row this build serves: `amount` is the
	// engine's own custodied accounting delta (normalized debt on the Debt
	// Manager, ray-scaled units on Aave), and asserting a token display scale
	// for it would misstate both engines. The unit vocabulary lands on the
	// contract with amendment C2.
	AmountDecimals *int                   `json:"amount_decimals"`
	Liquidation    *wireLiquidationDetail `json:"liquidation"`
}

type eventsResponse struct {
	ServedAt   time.Time        `json:"served_at"`
	Filter     wireEventFilter  `json:"filter"`
	Limit      int              `json:"limit"`
	Events     []wireChainEvent `json:"events"`
	NextCursor *string          `json:"next_cursor"`
	Notes      []string         `json:"notes"`
}

func (s *server) handleEvents(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()

	engine, ok := parseEngineParam(w, q.Get("engine"))
	if !ok {
		return
	}

	var account []byte
	var accountHex *string
	if raw := q.Get("account"); raw != "" {
		addr, err := parseAddress(raw)
		if err != nil {
			writeError(w, http.StatusBadRequest, codeBadRequest, "invalid account: "+err.Error(), nil)
			return
		}
		account = addr.Bytes()
		accountHex = strPtr(addr.Hex())
	}

	limit := defaultEventsLimit
	if raw := q.Get("limit"); raw != "" {
		n, err := strconv.Atoi(raw)
		if err != nil || n < 1 || n > maxEventsLimit {
			writeError(w, http.StatusBadRequest, codeBadRequest,
				"limit must be an integer in 1.."+strconv.Itoa(maxEventsLimit), nil)
			return
		}
		limit = n
	}

	// The display-type filter, in the CONTRACT vocabulary.
	var requestedTypes []string
	requested := map[string]bool{}
	classes := contractFeedClasses
	if raw := q.Get("types"); raw != "" {
		classSet := map[store.EventDisplayClass]bool{}
		classes = nil
		for _, part := range strings.Split(raw, ",") {
			part = strings.TrimSpace(part)
			if part == "" {
				continue
			}
			p, ok := contractFeedTypes[part]
			if !ok {
				writeError(w, http.StatusBadRequest, codeBadRequest,
					"unknown display type "+strconv.Quote(part)+": the display vocabulary is closed (borrow, repay, supply, withdraw, liquidation, collateral_enabled, collateral_disabled, deficit_created)", nil)
				return
			}
			if !requested[part] {
				requested[part] = true
				requestedTypes = append(requestedTypes, part)
			}
			if !classSet[p.class] {
				classSet[p.class] = true
				classes = append(classes, p.class)
			}
		}
		if len(classes) == 0 {
			classes = contractFeedClasses
			requested = map[string]bool{}
			requestedTypes = nil
		}
	}
	sort.Strings(requestedTypes)

	var sinceBlock *uint64
	var sinceEcho *int64
	if raw := q.Get("since_block"); raw != "" {
		n, err := strconv.ParseInt(raw, 10, 64)
		if err != nil || n < 0 {
			writeError(w, http.StatusBadRequest, codeBadRequest, "since_block must be a non-negative integer", nil)
			return
		}
		if engine == "" {
			// The store refuses this too; refusing here keeps the message a
			// clean parameter error rather than a wrapped read error.
			writeError(w, http.StatusBadRequest, codeBadRequest,
				"since_block requires `engine`: a block-height bound across two chains with incomparable heights is meaningless. Name one engine to scope the bound to its chain.", nil)
			return
		}
		u := uint64(n)
		sinceBlock = &u
		sinceEcho = int64Ptr(n)
	}

	filter := store.EventsFilter{Account: account, DisplayTypes: classes, SinceBlock: sinceBlock}
	var engineEcho *string
	if engine != "" {
		filter.Engines = []string{engine}
		engineEcho = strPtr(engine)
	}

	cursor := q.Get("cursor")
	page, err := s.store.EventsPage(r.Context(), filter, cursor, limit)
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

	out := eventsResponse{
		ServedAt: now,
		Filter: wireEventFilter{
			Engine:     engineEcho,
			Account:    accountHex,
			Types:      orEmpty(requestedTypes),
			SinceBlock: sinceEcho,
		},
		Limit:  limit,
		Events: []wireChainEvent{},
		Notes: []string{
			"`block_time` is null until the block's header is custodied — header time is chain-asserted or absent, never fabricated, and no database clock is ever substituted. Render the block number while it is null.",
			"engine-scoped pages order by (block_number, tx_hash, log_index, seq) DESC — exact within one chain. Cross-engine pages order by custodied block_time DESC; rows without a custodied time sort AFTER every timed row (their order there is a deterministic tiebreak, NOT chronology — two chains' block heights are incomparable as time).",
			"`amount` is the engine's own CUSTODIED accounting delta, verbatim: normalized debt units on the Debt Manager (USD-6 view = value x interest index / 1e18), ray-scaled token units on Aave. It is not a display-ready token amount, which is why `amount_decimals` is null; the per-row unit vocabulary is a coming contract amendment.",
			"a cross-engine page's untimed tail can shrink between pages while header backfill runs: a row acquiring its time moves into the timed section. Each page is internally exact; the feed is a live surface, not a pinned batch.",
		},
	}

	for _, e := range page.Events {
		displayType, ok := contractDisplayType(e)
		if !ok {
			writeError(w, http.StatusInternalServerError, codeInternal,
				"feed row "+e.Engine+"/"+e.RawType+" has no contract display type — the vocabulary bridge and the filter have drifted", nil)
			return
		}
		if len(requested) > 0 && !requested[displayType] {
			// The store's collateral_flag class covers both toggle directions;
			// a filter naming only one narrows here. The cursor still walks the
			// store's ordering, so pagination stays exact — a page may simply
			// carry fewer rows than `limit`.
			continue
		}
		if len(e.Account) == 0 {
			writeError(w, http.StatusInternalServerError, codeInternal,
				"feed row "+e.Engine+"/"+e.RawType+" carries no account — every contract feed class is a user action, so this row escaped the filter", nil)
			return
		}
		we := wireChainEvent{
			ChainID:     e.ChainID,
			Engine:      e.Engine,
			BlockNumber: e.BlockNumber,
			BlockTime:   e.BlockTime,
			TxHash:      hexBytes(e.TxHash),
			LogIndex:    e.LogIndex,
			Seq:         e.Seq,
			Type:        displayType,
			RawType:     e.RawType,
			Account:     common.BytesToAddress(e.Account).Hex(),
			Asset:       hexAddrPtr(e.Asset),
			Amount:      bigStr(e.Delta),
		}
		if len(e.Asset) > 0 {
			if spec, ok := s.registry.Spec(e.Engine, common.BytesToAddress(e.Asset)); ok {
				we.Symbol = spec.Symbol
			}
		}
		if displayType == "liquidation" {
			detail, err := s.wireLiquidation(r, e)
			if err != nil {
				writeError(w, http.StatusInternalServerError, codeInternal, err.Error(), nil)
				return
			}
			we.Liquidation = detail
		}
		out.Events = append(out.Events, we)
	}
	if page.NextCursor != "" {
		out.NextCursor = strPtr(page.NextCursor)
	}
	writeJSON(w, out)
}

// wireLiquidation renders the typed extract behind one liquidation row.
// Nothing here is inferred: a field the payload does not establish is null.
func (s *server) wireLiquidation(r *http.Request, e store.FeedEvent) (*wireLiquidationDetail, error) {
	d := e.Liquidation
	if d == nil {
		return nil, nil
	}
	out := &wireLiquidationDetail{
		Liquidator: d.Liquidator,
		DebtAsset:  hexAddrPtr(e.Asset),
		Seized:     []wireSeizedCollateral{},
	}
	switch e.Engine {
	case risk.DMEngine:
		out.DebtRepaid = bigStr(d.DebtRepaidUSD)
		// The Debt Manager's liquidation figure is its own USD-6 quantity, from
		// the event's payload — a value, not a token amount.
		out.DebtDecimals = intPtr(engineValueDecimals[risk.DMEngine])
		for _, sz := range d.Seized {
			// The contract's Liquidated event enumerates EVERY supported
			// collateral token with zero tuple elements for the ones it did not
			// touch. `seized` is the contract's "every collateral asset seized"
			// — a zero element was not seized, so it is not a seizure row. The
			// full fan-out stays custodied in position_events either way.
			if sz.Amount == nil || sz.Amount.Sign() == 0 {
				continue
			}
			wsz := wireSeizedCollateral{
				Asset:  common.BytesToAddress(sz.Asset).Hex(),
				Amount: orZeroString(sz.Amount),
			}
			spec, ok := s.registry.Spec(e.Engine, common.BytesToAddress(sz.Asset))
			if !ok {
				return nil, seizedDecimalsErr(e, sz.Asset)
			}
			wsz.Symbol = spec.Symbol
			wsz.Decimals = int(spec.Decimals)
			out.Seized = append(out.Seized, wsz)
		}
		out.Note = "extracted from the event's own structured payload. `debt_repaid` is the Debt Manager's USD-6 figure; seized amounts are each token's own units (the event's zero-amount tuple elements enumerate untouched collateral and are not seizures; the full fan-out stays custodied). The realized bonus the contract recorded is in its 100e18 denomination, not bps, so `realized_bonus_bps` is null rather than a unit conversion; the configured bonus is likewise 100e18-denominated and served on /v1/params, not converted here."
	case risk.AaveEngine:
		out.DebtRepaid = bigStr(d.DebtToCover)
		if len(e.Asset) > 0 {
			if spec, ok := s.registry.Spec(e.Engine, common.BytesToAddress(e.Asset)); ok {
				out.DebtDecimals = intPtr(int(spec.Decimals))
			}
		}
		if len(d.CollateralAsset) > 0 {
			wsz := wireSeizedCollateral{
				Asset:  common.BytesToAddress(d.CollateralAsset).Hex(),
				Amount: orZeroString(d.LiquidatedCollateralAmount),
			}
			spec, ok := s.registry.Spec(e.Engine, common.BytesToAddress(d.CollateralAsset))
			if !ok {
				return nil, seizedDecimalsErr(e, d.CollateralAsset)
			}
			wsz.Symbol = spec.Symbol
			wsz.Decimals = int(spec.Decimals)
			out.Seized = append(out.Seized, wsz)
		}
		configured, err := s.aaveConfiguredBonusBps(r, d.CollateralAsset, e.BlockNumber)
		if err != nil {
			return nil, err
		}
		out.ConfiguredBonusBps = configured
		out.Note = "extracted from the event's own structured payload; amounts are in each asset's own token units. `configured_bonus_bps` is the ledger's bonus AT THIS EVENT's effective params, decoded from Aave's own encoding (liquidationBonus 10500 = a 500bps premium); null when param custody does not cover the event's block. `realized_bonus_bps` would need event-time prices this service does not re-read, so it is null — never estimated."
	}
	return out, nil
}

func seizedDecimalsErr(e store.FeedEvent, asset []byte) error {
	return fmt.Errorf("liquidation row %s/%d seized asset %s is not in the committed feed registry, so its token decimals cannot be stated — refusing to serve a seizure amount with an invented scale",
		hexBytes(e.TxHash), e.LogIndex, common.BytesToAddress(asset).Hex())
}

// aaveConfiguredBonusBps reads the custodied param ledger at the event's block
// and decodes Aave's liquidationBonus encoding (10500 = 105% of par) into the
// premium in bps. nil when the ledger does not cover (asset, block).
func (s *server) aaveConfiguredBonusBps(r *http.Request, collateral []byte, block uint64) (*string, error) {
	if len(collateral) == 0 {
		return nil, nil
	}
	ledger, err := store.ParamsAsOfQ(r.Context(), s.store.Querier(), s.cfg.Aave.ParamEngine, s.cfg.Aave.ChainID, block)
	if err != nil {
		return nil, err
	}
	folded, err := riskfeed.FoldParams(s.cfg.Aave.ParamEngine, s.cfg.Aave.ChainID, ledger)
	if err != nil {
		return nil, err
	}
	target := common.BytesToAddress(collateral)
	for _, row := range folded {
		if row.Asset == target && row.LiqBonus != nil {
			premium := new(big.Int).Sub(row.LiqBonus, big.NewInt(10_000))
			return strPtr(premium.String()), nil
		}
	}
	return nil, nil
}
