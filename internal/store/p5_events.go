package store

// P5 Task B1: the durable chain-action feed (GET /v1/events) — the display
// vocabulary, the per-row amount-unit semantics, the two-mode chronological
// page, and the liquidation detail extraction from structured payloads.
//
// THE DISPLAY VOCABULARY IS A TOTAL FUNCTION over the two CLOSED per-engine
// event_type sets internal/derive emits (aave.go's aaveEvent call sites plus
// the two collateral-flag constants this package owns; debtmanager.go's dmEv*
// constant block). Every raw type either maps to a display class or is
// EXPLICITLY bookkeeping-filtered with its reason recorded here; an unmapped
// type is a TEST FAILURE (p5_events_vocab_test.go parses the derive sources
// and requires exact set equality in both directions), never a silently
// dropped feed row.
//
// THE ORDERING LAW (corrected mid-wave by plan review — the naive
// cross-engine (block_number …) DESC is WRONG across chains, because ETH
// (~25.6M) and OP (~150M+) heights are incomparable and OP would dominate
// regardless of actual time):
//
//   * ENGINE-SCOPED page (the filter names exactly one engine, hence one
//     chain): (block_number, tx_hash, log_index, seq) DESC — heights are
//     comparable within one chain; exact and complete.
//   * CROSS-ENGINE page: block_time DESC (block_headers custody, Task B2)
//     with the deterministic chain-aware tiebreak (chain_id, block_number,
//     tx_hash, log_index, seq) DESC; rows LACKING a custodied block_time
//     sort AFTER every timed row (disclosed by their nil BlockTime — never
//     interleaved by incomparable heights, never given an invented time).
//     Cross-engine chronology is therefore exactly as complete as header
//     custody: before custody/backfill, the untimed tail is ordered by the
//     tiebreak alone, and B3/W5 must present it as "time unknown".
//   * since_block is REJECTED on a cross-engine page (a height bound over
//     incomparable chains means nothing); it is honest only engine-scoped.
//
// Custody can land BETWEEN two pages of one cross-engine walk, promoting a
// row from the untimed tail into the timed section; the keyset makes each
// page internally exact, but a concurrent backfill can move not-yet-served
// rows across the boundary. That is disclosed here rather than papered over
// — the feed is a live surface, not a pinned batch.

import (
	"context"
	"encoding/hex"
	"fmt"
	"math/big"
	"sort"
	"strconv"
	"strings"
	"time"
)

// EventDisplayClass is the feed's public event vocabulary — what a raw
// engine-specific event_type renders AS. It is deliberately coarser than the
// raw sets: the raw type always travels alongside it (FeedEvent.RawType), so
// nothing is erased, only grouped.
type EventDisplayClass string

const (
	EventDisplayBorrow         EventDisplayClass = "borrow"
	EventDisplayRepay          EventDisplayClass = "repay"
	EventDisplaySupply         EventDisplayClass = "supply"
	EventDisplayWithdraw       EventDisplayClass = "withdraw"
	EventDisplayTransfer       EventDisplayClass = "transfer"
	EventDisplayLiquidation    EventDisplayClass = "liquidation"
	EventDisplayCollateralFlag EventDisplayClass = "collateral_flag"
	EventDisplayBadDebt        EventDisplayClass = "bad_debt"
	EventDisplayMigration      EventDisplayClass = "migration"
	EventDisplayConfig         EventDisplayClass = "config"
)

// EventAmountUnit names the SEMANTIC UNIT of a row's Delta — established
// from the deriver source per raw type, never assumed. The engines'
// internal accounting units are NOT user-display token amounts:
//
//   - The Debt Manager folds debt in NORMALIZED units (delta =
//     usd·1e18/index at fold time; the USD-6 view is value·index/1e18) —
//     debtmanager.go's credit/debit. The event's own USD-6 figure travels
//     in the payload ("usd"), never in Delta.
//   - The Aave engine folds SCALED (ray-divided) aToken/debtToken units
//     (delta = rayDiv(amount, index) per regime) — aave.go's folds. The
//     nominal token amount travels in the payload ("amount",
//     "debt_to_cover", …).
//
// A renderer that showed a Delta as a token amount would misstate both
// engines; the unit tag is what lets the API label it honestly. A future
// raw type whose unit cannot be established from the deriver source must be
// tagged AmountUnitOpaque, never guessed.
type EventAmountUnit string

const (
	// AmountUnitNone: the row is record-only (Delta is nil); any amounts it
	// carries are payload facts with their own documented units.
	AmountUnitNone EventAmountUnit = "none"
	// AmountUnitDMNormalizedDebt: Debt Manager normalized debt units
	// (18-dec normalized; USD-6 view = value·interest_index/1e18).
	AmountUnitDMNormalizedDebt EventAmountUnit = "dm_normalized_debt"
	// AmountUnitAaveScaled: Aave ray-scaled aToken/variableDebtToken units
	// (nominal token amount = rayMul(scaled, live index)).
	AmountUnitAaveScaled EventAmountUnit = "aave_scaled"
	// AmountUnitOpaque: the fail-honest tag for a delta whose unit is not
	// established from the deriver source. No current type carries it; the
	// well-formedness test forbids an EMPTY unit, so a new type must choose.
	AmountUnitOpaque EventAmountUnit = "opaque"
)

var knownAmountUnits = map[EventAmountUnit]bool{
	AmountUnitNone: true, AmountUnitDMNormalizedDebt: true,
	AmountUnitAaveScaled: true, AmountUnitOpaque: true,
}

// eventClassification is one raw type's verdict: either a display class, or
// an explicit bookkeeping filter with the reason it is not a feed row — plus
// the semantic unit of its Delta. "Bookkeeping" is a POSITIVE statement, not
// an omission — the totality weld counts these rows too.
type eventClassification struct {
	Display     EventDisplayClass
	Bookkeeping bool
	// Why this raw type is filtered from the feed (bookkeeping rows only).
	Reason string
	// The semantic unit of the row's Delta (see EventAmountUnit).
	DeltaUnit EventAmountUnit
}

// aaveEventDisplay classifies every event_type the Aave deriver emits.
var aaveEventDisplay = map[string]eventClassification{
	"aave_borrow":           {Display: EventDisplayBorrow, DeltaUnit: AmountUnitAaveScaled},
	"aave_repay":            {Display: EventDisplayRepay, DeltaUnit: AmountUnitAaveScaled},
	"aave_supply":           {Display: EventDisplaySupply, DeltaUnit: AmountUnitNone},
	"aave_withdraw":         {Display: EventDisplayWithdraw, DeltaUnit: AmountUnitNone},
	"aave_liquidation_call": {Display: EventDisplayLiquidation, DeltaUnit: AmountUnitAaveScaled},
	// DeficitCreated is the protocol writing off unrecoverable debt — a
	// first-class risk event (two have happened on this instance), not noise.
	"aave_deficit_created":      {Display: EventDisplayBadDebt, DeltaUnit: AmountUnitAaveScaled},
	AaveCollateralEnabledEvent:  {Display: EventDisplayCollateralFlag, DeltaUnit: AmountUnitNone},
	AaveCollateralDisabledEvent: {Display: EventDisplayCollateralFlag, DeltaUnit: AmountUnitNone},
	// The fold event for an aToken transfer between two users IS a user
	// action (collateral moved wallets) and has no Supply/Withdraw twin.
	"atoken_balance_transfer": {Display: EventDisplayTransfer, DeltaUnit: AmountUnitAaveScaled},

	// Bookkeeping — filtered from the feed, each with its stated reason.
	"aave_reserve_data_updated": {Bookkeeping: true, DeltaUnit: AmountUnitNone,
		Reason: "rate-index custody (no account, no user action); served via rate_indexes, not the feed"},
	"atoken_mint": {Bookkeeping: true, DeltaUnit: AmountUnitAaveScaled,
		Reason: "the balance fold behind aave_supply — rendering both would show one deposit twice"},
	"atoken_burn": {Bookkeeping: true, DeltaUnit: AmountUnitAaveScaled,
		Reason: "the balance fold behind aave_withdraw — rendering both would show one withdrawal twice"},
	"atoken_transfer": {Bookkeeping: true, DeltaUnit: AmountUnitNone,
		Reason: "record-only nominal-units duplicate of the authoritative Mint/Burn/BalanceTransfer in the same tx"},
}

// dmEventDisplay classifies every event_type the Debt Manager deriver emits.
var dmEventDisplay = map[string]eventClassification{
	"borrow":      {Display: EventDisplayBorrow, DeltaUnit: AmountUnitDMNormalizedDebt},
	"repay":       {Display: EventDisplayRepay, DeltaUnit: AmountUnitDMNormalizedDebt},
	"liquidation": {Display: EventDisplayLiquidation, DeltaUnit: AmountUnitDMNormalizedDebt},
	// supplied / withdraw_borrow_token are record-only flows (supplier-share
	// state is not event-derivable): Delta nil, raw token amount in payload.
	"supplied":              {Display: EventDisplaySupply, DeltaUnit: AmountUnitNone},
	"withdraw_borrow_token": {Display: EventDisplayWithdraw, DeltaUnit: AmountUnitNone},
	// A position seeded by the V1→V2 migration is a real, one-time chain
	// action an inspector of that address must be able to see.
	"migration_genesis": {Display: EventDisplayMigration, DeltaUnit: AmountUnitDMNormalizedDebt},

	// The five DM config classes double as the param-timeline's DM leg
	// (dmParamConfigEventTypes welds to this classification by test).
	"borrow_apy_set":              {Display: EventDisplayConfig, DeltaUnit: AmountUnitNone},
	"borrow_token_config_set":     {Display: EventDisplayConfig, DeltaUnit: AmountUnitNone},
	"collateral_token_added":      {Display: EventDisplayConfig, DeltaUnit: AmountUnitNone},
	"collateral_token_removed":    {Display: EventDisplayConfig, DeltaUnit: AmountUnitNone},
	"collateral_token_config_set": {Display: EventDisplayConfig, DeltaUnit: AmountUnitNone},

	// Bookkeeping — filtered from the feed, each with its stated reason.
	"liquidation_collateral": {Bookkeeping: true, DeltaUnit: AmountUnitNone,
		Reason: "per-asset seizure detail of its seq-0 liquidation row; consumed by LiquidationDetail extraction, rendering it standalone would double-count the liquidation"},
	"residue_zeroed": {Bookkeeping: true, DeltaUnit: AmountUnitDMNormalizedDebt,
		Reason: "sub-wei accounting artifact of the contract's second-liquidation residue rule, not a user action"},
}

// EventDisplayFor answers one raw type's classification. known=false means
// the type is outside BOTH closed sets — the caller treats that as drift
// between the derivers and this vocabulary (the weld test makes it
// unreachable in a green tree).
func EventDisplayFor(engine, rawType string) (class EventDisplayClass, bookkeeping bool, known bool) {
	c, ok := eventClassificationFor(engine, rawType)
	if !ok {
		return "", false, false
	}
	return c.Display, c.Bookkeeping, true
}

func eventClassificationFor(engine, rawType string) (eventClassification, bool) {
	m, ok := eventDisplayMaps[engine]
	if !ok {
		return eventClassification{}, false
	}
	c, ok := m[rawType]
	return c, ok
}

// eventDisplayMaps is the per-engine classification table, in one place so
// the filter compiler and the vocabulary tests iterate the same thing.
var eventDisplayMaps = map[string]map[string]eventClassification{
	EngineAave:        aaveEventDisplay,
	EngineDebtManager: dmEventDisplay,
}

// rawEventTypesFor compiles (engines, display classes) into the exact
// event_type IN-list the page query uses. Empty classes means "every
// displayable class"; bookkeeping rows are NEVER selected into the feed.
// The result is sorted for deterministic SQL parameters.
func rawEventTypesFor(engines []string, classes []EventDisplayClass) ([]string, error) {
	if len(engines) == 0 {
		engines = []string{EngineAave, EngineDebtManager}
	}
	wanted := map[EventDisplayClass]bool{}
	for _, c := range classes {
		if !knownDisplayClasses[c] {
			return nil, fmt.Errorf("unknown display type %q — the display vocabulary is closed", c)
		}
		wanted[c] = true
	}
	var out []string
	for _, e := range engines {
		m, ok := eventDisplayMaps[e]
		if !ok {
			return nil, fmt.Errorf("unknown engine %q — engines are never silently combined, and an unknown one cannot be filtered honestly", e)
		}
		for raw, c := range m {
			if c.Bookkeeping {
				continue
			}
			if len(wanted) > 0 && !wanted[c.Display] {
				continue
			}
			out = append(out, raw)
		}
	}
	sort.Strings(out)
	return out, nil
}

var knownDisplayClasses = map[EventDisplayClass]bool{
	EventDisplayBorrow: true, EventDisplayRepay: true, EventDisplaySupply: true,
	EventDisplayWithdraw: true, EventDisplayTransfer: true, EventDisplayLiquidation: true,
	EventDisplayCollateralFlag: true, EventDisplayBadDebt: true,
	EventDisplayMigration: true, EventDisplayConfig: true,
}

// ---------------------------------------------------------------------------
// The page.
// ---------------------------------------------------------------------------

// EventsFilter narrows the feed. Zero values mean "no filter" for every
// field; Engines defaults to both known engines (a CROSS-ENGINE page).
// SinceBlock is legal only when Engines names exactly one engine.
type EventsFilter struct {
	Engines      []string
	Account      []byte
	DisplayTypes []EventDisplayClass
	SinceBlock   *uint64
}

// FeedEvent is one feed row: the raw persisted fact plus its display class,
// the semantic unit of its Delta, the chain-asserted header time WHERE
// CUSTODIED (nil otherwise — never fabricated), and the liquidation detail
// extract on liquidation rows.
type FeedEvent struct {
	ChainID     uint64
	Engine      string
	BlockNumber uint64
	// BlockTime is the block_headers.block_time custody (Task B2) and is nil
	// until that custody exists for the block. NEVER substituted with any
	// database insertion clock (the migration-00012 law).
	BlockTime   *time.Time
	TxHash      []byte
	LogIndex    uint32
	Seq         uint16
	DisplayType EventDisplayClass
	RawType     string
	Account     []byte
	Asset       []byte
	Side        string
	// Delta in the engine's own accounting unit, named by DeltaUnit — NOT a
	// user-display token amount (see EventAmountUnit).
	Delta     *big.Int
	DeltaUnit EventAmountUnit
	Payload   map[string]string
	// Liquidation is non-nil exactly on liquidation display rows.
	Liquidation *LiquidationDetail
}

type EventsPageResult struct {
	Events []FeedEvent
	// NextCursor is "" when the page reached the end of the filtered feed.
	NextCursor string
}

const (
	eventsCursorTag = "p5ev1"
	// Cursor mode discriminators: an engine-scoped cursor and a cross-engine
	// cursor rank by DIFFERENT keys and are not interchangeable.
	eventsCursorModeScoped = "x"
	eventsCursorModeCross  = "t"
	// The bt cursor field's "row had no custodied time" marker.
	eventsCursorNoTime = "-"
)

// EventsPage reads one page of the chain-action feed under the two-mode
// ordering law documented in the file header.
func (s *Store) EventsPage(ctx context.Context, filter EventsFilter, cursor string, limit int) (EventsPageResult, error) {
	if limit <= 0 {
		return EventsPageResult{}, fmt.Errorf("events page: limit must be positive, got %d", limit)
	}
	rawTypes, err := rawEventTypesFor(filter.Engines, filter.DisplayTypes)
	if err != nil {
		return EventsPageResult{}, fmt.Errorf("events page: %w", err)
	}
	crossEngine := len(filter.Engines) != 1
	if filter.SinceBlock != nil && crossEngine {
		return EventsPageResult{}, fmt.Errorf("events page: since_block requires the filter to name exactly one engine — a block-height bound across chains with incomparable heights is meaningless")
	}
	if len(rawTypes) == 0 {
		// A well-formed filter that selects nothing (e.g. migration events on
		// the Aave engine) has an empty page as its honest answer.
		return EventsPageResult{}, nil
	}
	headersPresent, err := s.p5BlockHeadersPresent(ctx)
	if err != nil {
		return EventsPageResult{}, err
	}

	mode := eventsCursorModeScoped
	if crossEngine {
		mode = eventsCursorModeCross
	}

	// SELECT shape: block_time rides along via LEFT JOIN when the custody
	// table exists (also the cross-engine sort key); a database without
	// migration 00015 degrades to "every row untimed", never to an error.
	selectCols := `e.chain_id, e.engine, e.block_number, e.tx_hash, e.log_index, e.seq, e.event_type,
	               e.account, e.asset, e.side, e.delta::text, e.payload`
	fromClause := ` FROM position_events e`
	if headersPresent {
		selectCols += `, bh.block_time`
		fromClause += ` LEFT JOIN block_headers bh ON bh.chain_id = e.chain_id AND bh.block_number = e.block_number`
	} else {
		selectCols += `, NULL::bigint AS block_time`
	}

	q := `SELECT ` + selectCols + fromClause + ` WHERE e.event_type = ANY($1)`
	args := []any{rawTypes}
	arg := func(v any) string {
		args = append(args, v)
		return fmt.Sprintf("$%d", len(args))
	}
	if len(filter.Engines) > 0 {
		q += ` AND e.engine = ANY(` + arg(filter.Engines) + `)`
	}
	if len(filter.Account) > 0 {
		q += ` AND e.account = ` + arg(filter.Account)
	}
	if filter.SinceBlock != nil {
		q += ` AND e.block_number >= ` + arg(int64(*filter.SinceBlock))
	}

	if cursor != "" {
		cur, err := decodeEventsCursor(cursor, mode)
		if err != nil {
			return EventsPageResult{}, fmt.Errorf("events page: %w", err)
		}
		tie := fmt.Sprintf("(e.chain_id, e.block_number, e.tx_hash, e.log_index, e.seq) < (%s, %s, %s, %s, %s)",
			arg(int64(cur.chain)), arg(int64(cur.block)), arg(cur.txHash), arg(int32(cur.logIndex)), arg(int32(cur.seq)))
		switch {
		case !crossEngine:
			// One chain: heights comparable, tiebreak tuple IS the order.
			q += ` AND ` + tie
		case !headersPresent:
			// Every row is untimed here. After a timed cursor the whole
			// untimed section follows (no predicate); after an untimed
			// cursor, the tiebreak continues the tail. The timed-cursor arm
			// is unreachable in practice (custody tables are not dropped),
			// but stated rather than assumed.
			if !cur.hasTime {
				q += ` AND ` + tie
			}
		case cur.hasTime:
			// Rows strictly older, equal-time rows later in the tiebreak,
			// and the ENTIRE untimed tail.
			t := arg(cur.blockTime)
			q += ` AND (bh.block_time < ` + t + ` OR (bh.block_time = ` + t + ` AND ` + tie + `) OR bh.block_time IS NULL)`
		default:
			// An untimed cursor: only the untimed tail continues.
			q += ` AND bh.block_time IS NULL AND ` + tie
		}
	}

	tieOrder := `e.chain_id DESC, e.block_number DESC, e.tx_hash DESC, e.log_index DESC, e.seq DESC`
	if crossEngine {
		if headersPresent {
			q += ` ORDER BY bh.block_time DESC NULLS LAST, ` + tieOrder
		} else {
			q += ` ORDER BY ` + tieOrder
		}
	} else {
		q += ` ORDER BY e.block_number DESC, e.tx_hash DESC, e.log_index DESC, e.seq DESC`
	}
	q += ` LIMIT ` + arg(limit+1)

	rows, err := s.pool.Query(ctx, q, args...)
	if err != nil {
		return EventsPageResult{}, fmt.Errorf("events page: %w", err)
	}
	defer rows.Close()

	type pageRow struct {
		event   FeedEvent
		hasTime bool
		unix    int64
	}
	var page []pageRow
	for rows.Next() {
		var e FeedEvent
		var chainID, blockNumber int64
		var logIndex, seq int32
		var deltaText *string
		var blockTime *int64
		if err := rows.Scan(&chainID, &e.Engine, &blockNumber, &e.TxHash, &logIndex, &seq,
			&e.RawType, &e.Account, &e.Asset, &e.Side, &deltaText, &e.Payload, &blockTime); err != nil {
			return EventsPageResult{}, fmt.Errorf("scan feed event: %w", err)
		}
		e.ChainID = uint64(chainID)
		e.BlockNumber = uint64(blockNumber)
		e.LogIndex = uint32(logIndex)
		e.Seq = uint16(seq)
		if e.Delta, err = p5BigFromText("feed event delta", deltaText); err != nil {
			return EventsPageResult{}, err
		}
		c, known := eventClassificationFor(e.Engine, e.RawType)
		if !known || c.Bookkeeping {
			// Unreachable while the IN-list and the vocabulary agree; loud if
			// they ever stop agreeing, never a mislabeled row.
			return EventsPageResult{}, fmt.Errorf("feed row %s/%s escaped the display vocabulary — the IN-list and classification maps have drifted", e.Engine, e.RawType)
		}
		e.DisplayType = c.Display
		e.DeltaUnit = c.DeltaUnit
		r := pageRow{event: e}
		if blockTime != nil {
			t := time.Unix(*blockTime, 0).UTC()
			e.BlockTime = &t
			r.event.BlockTime = &t
			r.hasTime, r.unix = true, *blockTime
		}
		page = append(page, r)
	}
	if err := rows.Err(); err != nil {
		return EventsPageResult{}, fmt.Errorf("iterate feed events: %w", err)
	}

	next := ""
	if len(page) > limit {
		page = page[:limit]
		last := page[len(page)-1]
		bt := eventsCursorNoTime
		if last.hasTime {
			bt = strconv.FormatInt(last.unix, 10)
		}
		next = p5EncodeCursor(eventsCursorTag, mode, bt,
			strconv.FormatUint(last.event.ChainID, 10),
			strconv.FormatUint(last.event.BlockNumber, 10),
			hex.EncodeToString(last.event.TxHash),
			strconv.FormatUint(uint64(last.event.LogIndex), 10),
			strconv.FormatUint(uint64(last.event.Seq), 10))
	}

	events := make([]FeedEvent, len(page))
	for i, r := range page {
		events[i] = r.event
	}
	if err := s.attachLiquidationDetails(ctx, events); err != nil {
		return EventsPageResult{}, err
	}
	return EventsPageResult{Events: events, NextCursor: next}, nil
}

type eventsCursor struct {
	hasTime   bool
	blockTime int64
	chain     uint64
	block     uint64
	txHash    []byte
	logIndex  uint64
	seq       uint64
}

func decodeEventsCursor(cursor, wantMode string) (eventsCursor, error) {
	fields, err := p5DecodeCursor(cursor, eventsCursorTag, 7)
	if err != nil {
		return eventsCursor{}, err
	}
	if fields[0] != wantMode {
		return eventsCursor{}, fmt.Errorf("cursor was minted for a %s page but this request is %s-mode — engine-scoped and cross-engine pages rank by different keys and their cursors are not interchangeable",
			eventsCursorModeName(fields[0]), eventsCursorModeName(wantMode))
	}
	var c eventsCursor
	if fields[1] != eventsCursorNoTime {
		t, err := strconv.ParseInt(fields[1], 10, 64)
		if err != nil {
			return eventsCursor{}, fmt.Errorf("cursor block_time %q is not an integer", fields[1])
		}
		c.hasTime, c.blockTime = true, t
	}
	if c.chain, err = p5CursorUint(fields[2], "chain"); err != nil {
		return eventsCursor{}, err
	}
	if c.block, err = p5CursorUint(fields[3], "block"); err != nil {
		return eventsCursor{}, err
	}
	if c.txHash, err = hex.DecodeString(fields[4]); err != nil {
		return eventsCursor{}, fmt.Errorf("cursor tx hash is not hex: %w", err)
	}
	if c.logIndex, err = p5CursorUint(fields[5], "log"); err != nil {
		return eventsCursor{}, err
	}
	if c.seq, err = p5CursorUint(fields[6], "seq"); err != nil {
		return eventsCursor{}, err
	}
	return c, nil
}

func eventsCursorModeName(mode string) string {
	switch mode {
	case eventsCursorModeScoped:
		return "engine-scoped"
	case eventsCursorModeCross:
		return "cross-engine"
	default:
		return fmt.Sprintf("unknown(%q)", mode)
	}
}

// ---------------------------------------------------------------------------
// Liquidation detail extraction.
// ---------------------------------------------------------------------------

// LiquidationSeizure is one seized-collateral tuple element of a Debt
// Manager liquidation — decoded by the deriver from the Liquidated event's
// collateral array into seq>=1 liquidation_collateral rows.
type LiquidationSeizure struct {
	Asset []byte
	Seq   uint16
	// Amount in Asset's own token units; Bonus is the realized bonus the
	// contract recorded for this element. Both verbatim payload facts.
	Amount *big.Int
	Bonus  *big.Int
}

// LiquidationDetail is the typed extract behind a liquidation feed row.
// Engine-specific halves are nil on the other engine's rows — the two
// engines' liquidation semantics are never blended (spec §2).
type LiquidationDetail struct {
	// Liquidator exactly as the deriver recorded it (0x-hex).
	Liquidator string

	// Debt Manager: USD 6-dec payload facts + the seize rows.
	DebtRepaidUSD *big.Int
	BeforeDebtUSD *big.Int
	InterestIndex *big.Int
	Seized        []LiquidationSeizure

	// Aave: token-unit payload facts (debt asset / collateral asset units).
	DebtToCover                *big.Int
	CollateralAsset            []byte
	LiquidatedCollateralAmount *big.Int
	ReceiveAToken              *bool
	// DeficitPaired marks the same-tx DeficitCreated pairing (the debt
	// movement lives on the bad_debt row, not this one).
	DeficitPaired bool
}

// attachLiquidationDetails fills FeedEvent.Liquidation for every liquidation
// display row in the page. DM seize rows are fetched in ONE batched query by
// the parent rows' log identity; payload parsing is STRICT — a stored
// liquidation payload missing a key it was written with is corrupt evidence
// and errs loudly rather than rendering a partial ledger row.
func (s *Store) attachLiquidationDetails(ctx context.Context, events []FeedEvent) error {
	var dmIdx []int
	for i := range events {
		if events[i].DisplayType != EventDisplayLiquidation {
			continue
		}
		switch events[i].Engine {
		case EngineAave:
			d, err := aaveLiquidationDetail(events[i])
			if err != nil {
				return err
			}
			events[i].Liquidation = d
		case EngineDebtManager:
			d, err := dmLiquidationDetail(events[i])
			if err != nil {
				return err
			}
			events[i].Liquidation = d
			dmIdx = append(dmIdx, i)
		}
	}
	if len(dmIdx) == 0 {
		return nil
	}

	chains := make([]int64, len(dmIdx))
	txs := make([][]byte, len(dmIdx))
	logs := make([]int32, len(dmIdx))
	for j, i := range dmIdx {
		chains[j] = int64(events[i].ChainID)
		txs[j] = events[i].TxHash
		logs[j] = int32(events[i].LogIndex)
	}
	rows, err := s.pool.Query(ctx, `
		SELECT chain_id, tx_hash, log_index, seq, asset, payload
		FROM position_events
		WHERE event_type = 'liquidation_collateral'
		  AND (chain_id, tx_hash, log_index) IN (
		      SELECT * FROM unnest($1::bigint[], $2::bytea[], $3::int[]))
		ORDER BY chain_id, tx_hash, log_index, seq`, chains, txs, logs)
	if err != nil {
		return fmt.Errorf("read liquidation seize rows: %w", err)
	}
	defer rows.Close()

	type liqKey struct {
		chain    uint64
		tx       string
		logIndex uint32
	}
	byKey := map[liqKey]*FeedEvent{}
	for _, i := range dmIdx {
		byKey[liqKey{events[i].ChainID, hex.EncodeToString(events[i].TxHash), events[i].LogIndex}] = &events[i]
	}
	for rows.Next() {
		var chainID int64
		var txHash []byte
		var logIndex, seq int32
		var asset []byte
		var payload map[string]string
		if err := rows.Scan(&chainID, &txHash, &logIndex, &seq, &asset, &payload); err != nil {
			return fmt.Errorf("scan liquidation seize row: %w", err)
		}
		parent, ok := byKey[liqKey{uint64(chainID), hex.EncodeToString(txHash), uint32(logIndex)}]
		if !ok {
			return fmt.Errorf("seize row %x/%d/%d matched no liquidation row in the page — batched lookup drifted", txHash, logIndex, seq)
		}
		amount, err := payloadBig(payload, "amount", "liquidation_collateral")
		if err != nil {
			return err
		}
		bonus, err := payloadBig(payload, "bonus", "liquidation_collateral")
		if err != nil {
			return err
		}
		parent.Liquidation.Seized = append(parent.Liquidation.Seized, LiquidationSeizure{
			Asset: asset, Seq: uint16(seq), Amount: amount, Bonus: bonus,
		})
	}
	if err := rows.Err(); err != nil {
		return fmt.Errorf("iterate liquidation seize rows: %w", err)
	}
	return nil
}

func dmLiquidationDetail(e FeedEvent) (*LiquidationDetail, error) {
	usd, err := payloadBig(e.Payload, "usd", "liquidation")
	if err != nil {
		return nil, err
	}
	before, err := payloadBig(e.Payload, "before_debt_usd", "liquidation")
	if err != nil {
		return nil, err
	}
	index, err := payloadBig(e.Payload, "index", "liquidation")
	if err != nil {
		return nil, err
	}
	liquidator, err := payloadString(e.Payload, "liquidator", "liquidation")
	if err != nil {
		return nil, err
	}
	return &LiquidationDetail{
		Liquidator:    liquidator,
		DebtRepaidUSD: usd,
		BeforeDebtUSD: before,
		InterestIndex: index,
	}, nil
}

func aaveLiquidationDetail(e FeedEvent) (*LiquidationDetail, error) {
	debtToCover, err := payloadBig(e.Payload, "debt_to_cover", "aave_liquidation_call")
	if err != nil {
		return nil, err
	}
	seized, err := payloadBig(e.Payload, "liquidated_collateral_amount", "aave_liquidation_call")
	if err != nil {
		return nil, err
	}
	liquidator, err := payloadString(e.Payload, "liquidator", "aave_liquidation_call")
	if err != nil {
		return nil, err
	}
	collateralHex, err := payloadString(e.Payload, "collateral_asset", "aave_liquidation_call")
	if err != nil {
		return nil, err
	}
	collateral, err := payloadAddr(collateralHex, "collateral_asset")
	if err != nil {
		return nil, err
	}
	receiveRaw, err := payloadString(e.Payload, "receive_atoken", "aave_liquidation_call")
	if err != nil {
		return nil, err
	}
	receive := receiveRaw == "true"
	return &LiquidationDetail{
		Liquidator:                 liquidator,
		DebtToCover:                debtToCover,
		CollateralAsset:            collateral,
		LiquidatedCollateralAmount: seized,
		ReceiveAToken:              &receive,
		DeficitPaired:              e.Payload["deficit_paired"] == "true",
	}, nil
}

func payloadString(payload map[string]string, key, what string) (string, error) {
	v, ok := payload[key]
	if !ok {
		return "", fmt.Errorf("%s payload is missing %q — the deriver always writes it, so this row is corrupt evidence", what, key)
	}
	return v, nil
}

func payloadBig(payload map[string]string, key, what string) (*big.Int, error) {
	raw, err := payloadString(payload, key, what)
	if err != nil {
		return nil, err
	}
	v, ok := new(big.Int).SetString(raw, 10)
	if !ok {
		return nil, fmt.Errorf("%s payload %s %q is not an integer", what, key, raw)
	}
	return v, nil
}

// payloadAddr decodes a payload "0x"-prefixed 20-byte address.
func payloadAddr(hexAddr, what string) ([]byte, error) {
	if len(hexAddr) != 42 || hexAddr[:2] != "0x" {
		return nil, fmt.Errorf("%s %q is not a 0x-prefixed 20-byte address", what, hexAddr)
	}
	b, err := hex.DecodeString(strings.ToLower(hexAddr[2:]))
	if err != nil {
		return nil, fmt.Errorf("%s %q is not hex: %w", what, hexAddr, err)
	}
	return b, nil
}
