package store

// P5 Task B1: the parameter timeline (GET /v1/params) — every risk-parameter
// change from BOTH custody paths merged into one chronology:
//
//   * param_history (the `aave_param` PoolConfigurator ledger, migration
//     00011), read via param_history_asset_idx / param_history_asof_idx;
//   * the Debt Manager's config event classes in position_events
//     (collateral_token_config_set / _added / _removed, borrow_apy_set,
//     borrow_token_config_set), whose payloads carry PRIOR VALUES where the
//     contract emitted them (old_ltv / old_liquidation_threshold /
//     old_liquidation_bonus / old_apy).
//
// DENOMINATORS ARE VERBATIM, exactly as stored (the migration-00011 law):
// Aave ratios are BASIS POINTS (1e4), Debt Manager ratios and APYs are
// HUNDRED_PERCENT = 100e18. This reader never normalizes — the two
// conventions differ by 1e16 and a silent unit mix is a mispriced
// liquidation. Conversion is a render-time concern with the engine attached.

import (
	"context"
	"encoding/hex"
	"fmt"
	"math/big"
	"strconv"
	"time"
)

// dmParamConfigEventTypes is the DM leg of the timeline. WELDED BY TEST to
// the display vocabulary: this list must equal exactly the dmEventDisplay
// entries classified EventDisplayConfig (p5_events_vocab_test.go), which are
// themselves welded to the deriver's closed set — so a new DM config event
// class cannot appear without extending this timeline.
var dmParamConfigEventTypes = []string{
	"borrow_apy_set",
	"borrow_token_config_set",
	"collateral_token_added",
	"collateral_token_removed",
	"collateral_token_config_set",
}

// ParamTimelineEntry is one parameter fact. Per-field nils mean "this event
// did not speak to this field" (the param_history NULL discipline), never
// zero.
type ParamTimelineEntry struct {
	// Engine is the WRITER identity verbatim: "aave_param" for configurator
	// ledger rows, "debt_manager" for DM config events.
	Engine  string
	ChainID uint64
	Asset   []byte

	BlockNumber uint64
	LogIndex    uint32
	TxHash      []byte
	// BlockTime from block_headers custody where present; nil otherwise,
	// never fabricated.
	BlockTime *time.Time
	// SourceEvent: the decoded event name (param_history.source_event) or
	// the position_events.event_type for DM rows.
	SourceEvent string

	// Snapshot values, in the emitting protocol's OWN denominator.
	LTV          *big.Int
	LiqThreshold *big.Int
	LiqBonus     *big.Int
	// Prior values where the payload carries them (DM config-set events).
	PriorLTV          *big.Int
	PriorLiqThreshold *big.Int
	PriorLiqBonus     *big.Int

	// Aave-only registry facts (ReserveInitialized) and eMode selector.
	EModeCategory     *uint8
	AToken            []byte
	VariableDebtToken []byte
	Strategy          []byte

	// DM borrow-APY facts (HUNDRED_PERCENT denominator).
	BorrowAPY      *big.Int
	PriorBorrowAPY *big.Int
}

type ParamTimelineResult struct {
	Entries    []ParamTimelineEntry
	NextCursor string
}

const paramsCursorTag = "p5par1"

// ParamTimeline reads one page of the merged parameter chronology, newest
// first, ordered (block_number, chain_id, tx_hash, log_index, seq) DESC —
// the same total order and the same cross-chain caveat as EventsPage.
//
// engine filters by the PUBLIC engine name ("" = both): EngineAave selects
// the aave_param ledger (the configurator writes the Aave instance's
// parameters), EngineDebtManager selects the DM config events. asset
// narrows to one reserve/token.
func (s *Store) ParamTimeline(ctx context.Context, engine string, asset []byte, cursor string, limit int) (ParamTimelineResult, error) {
	if limit <= 0 {
		return ParamTimelineResult{}, fmt.Errorf("param timeline: limit must be positive, got %d", limit)
	}
	includeAave, includeDM := true, true
	switch engine {
	case "":
	case EngineAave:
		includeDM = false
	case EngineDebtManager:
		includeAave = false
	default:
		return ParamTimelineResult{}, fmt.Errorf("param timeline: unknown engine %q", engine)
	}

	// Two UNION legs projected onto one column shape; source discriminates
	// the decode. Filters are applied per leg (each leg has its own asset
	// column); the keyset and order apply to the union.
	args := []any{}
	arg := func(v any) string {
		args = append(args, v)
		return fmt.Sprintf("$%d", len(args))
	}

	legs := ""
	if includeAave {
		leg := `SELECT 'param_history' AS src, engine, chain_id, asset,
		               effective_block AS block_number, effective_log_index AS log_index, 0 AS seq, tx_hash,
		               source_event, ltv::text AS ltv, liq_threshold::text AS liq_threshold, liq_bonus::text AS liq_bonus,
		               emode_category, atoken, variable_debt_token, strategy, NULL::jsonb AS payload
		        FROM param_history
		        WHERE engine = ` + arg(paramEngineAave)
		if len(asset) > 0 {
			leg += ` AND asset = ` + arg(asset)
		}
		legs = leg
	}
	if includeDM {
		leg := `SELECT 'position_events' AS src, engine, chain_id, asset,
		               block_number, log_index, seq, tx_hash,
		               event_type AS source_event, NULL, NULL, NULL,
		               NULL::smallint, NULL::bytea, NULL::bytea, NULL::bytea, payload
		        FROM position_events
		        WHERE engine = ` + arg(EngineDebtManager) + ` AND event_type = ANY(` + arg(dmParamConfigEventTypes) + `)`
		if len(asset) > 0 {
			leg += ` AND asset = ` + arg(asset)
		}
		if legs != "" {
			legs += "\nUNION ALL\n"
		}
		legs += leg
	}

	q := `SELECT * FROM (` + legs + `) t`
	where := ""
	if cursor != "" {
		fields, err := p5DecodeCursor(cursor, paramsCursorTag, 5)
		if err != nil {
			return ParamTimelineResult{}, fmt.Errorf("param timeline: %w", err)
		}
		block, err := p5CursorUint(fields[0], "block")
		if err != nil {
			return ParamTimelineResult{}, fmt.Errorf("param timeline: %w", err)
		}
		chain, err := p5CursorUint(fields[1], "chain")
		if err != nil {
			return ParamTimelineResult{}, fmt.Errorf("param timeline: %w", err)
		}
		txHash, err := hex.DecodeString(fields[2])
		if err != nil {
			return ParamTimelineResult{}, fmt.Errorf("param timeline: cursor tx hash is not hex: %w", err)
		}
		logIndex, err := p5CursorUint(fields[3], "log")
		if err != nil {
			return ParamTimelineResult{}, fmt.Errorf("param timeline: %w", err)
		}
		seq, err := p5CursorUint(fields[4], "seq")
		if err != nil {
			return ParamTimelineResult{}, fmt.Errorf("param timeline: %w", err)
		}
		where = fmt.Sprintf(" WHERE (t.block_number, t.chain_id, t.tx_hash, t.log_index, t.seq) < (%s, %s, %s, %s, %s)",
			arg(int64(block)), arg(int64(chain)), arg(txHash), arg(int32(logIndex)), arg(int32(seq)))
	}
	q += where + ` ORDER BY t.block_number DESC, t.chain_id DESC, t.tx_hash DESC, t.log_index DESC, t.seq DESC LIMIT ` + arg(limit+1)

	rows, err := s.pool.Query(ctx, q, args...)
	if err != nil {
		return ParamTimelineResult{}, fmt.Errorf("param timeline: %w", err)
	}
	defer rows.Close()

	type rawEntry struct {
		entry ParamTimelineEntry
		seq   int32
	}
	var raw []rawEntry
	for rows.Next() {
		var src string
		var e ParamTimelineEntry
		var chainID, blockNumber int64
		var logIndex, seq int32
		var ltv, lt, bonus *string
		var emode *int16
		var payload map[string]string
		if err := rows.Scan(&src, &e.Engine, &chainID, &e.Asset, &blockNumber, &logIndex, &seq, &e.TxHash,
			&e.SourceEvent, &ltv, &lt, &bonus, &emode,
			&e.AToken, &e.VariableDebtToken, &e.Strategy, &payload); err != nil {
			return ParamTimelineResult{}, fmt.Errorf("scan param timeline row: %w", err)
		}
		e.ChainID = uint64(chainID)
		e.BlockNumber = uint64(blockNumber)
		e.LogIndex = uint32(logIndex)
		switch src {
		case "param_history":
			if e.LTV, err = p5BigFromText("ltv", ltv); err != nil {
				return ParamTimelineResult{}, err
			}
			if e.LiqThreshold, err = p5BigFromText("liq_threshold", lt); err != nil {
				return ParamTimelineResult{}, err
			}
			if e.LiqBonus, err = p5BigFromText("liq_bonus", bonus); err != nil {
				return ParamTimelineResult{}, err
			}
			if emode != nil {
				if *emode < 0 || *emode > 255 {
					return ParamTimelineResult{}, fmt.Errorf("emode_category %d is outside uint8", *emode)
				}
				c := uint8(*emode)
				e.EModeCategory = &c
			}
		case "position_events":
			if err := decodeDMParamPayload(&e, payload); err != nil {
				return ParamTimelineResult{}, err
			}
		default:
			return ParamTimelineResult{}, fmt.Errorf("param timeline: unknown source %q", src)
		}
		raw = append(raw, rawEntry{entry: e, seq: seq})
	}
	if err := rows.Err(); err != nil {
		return ParamTimelineResult{}, fmt.Errorf("iterate param timeline: %w", err)
	}

	next := ""
	if len(raw) > limit {
		raw = raw[:limit]
		last := raw[len(raw)-1]
		next = p5EncodeCursor(paramsCursorTag,
			strconv.FormatUint(last.entry.BlockNumber, 10),
			strconv.FormatUint(last.entry.ChainID, 10),
			hex.EncodeToString(last.entry.TxHash),
			strconv.FormatUint(uint64(last.entry.LogIndex), 10),
			strconv.FormatUint(uint64(uint32(last.seq)), 10))
	}

	entries := make([]ParamTimelineEntry, len(raw))
	keys := map[p5BlockKey]struct{}{}
	for i, r := range raw {
		entries[i] = r.entry
		keys[p5BlockKey{ChainID: r.entry.ChainID, BlockNumber: r.entry.BlockNumber}] = struct{}{}
	}
	times, err := s.p5BlockTimes(ctx, keys)
	if err != nil {
		return ParamTimelineResult{}, err
	}
	for i := range entries {
		if t, ok := times[p5BlockKey{ChainID: entries[i].ChainID, BlockNumber: entries[i].BlockNumber}]; ok {
			tt := t
			entries[i].BlockTime = &tt
		}
	}
	return ParamTimelineResult{Entries: entries, NextCursor: next}, nil
}

// decodeDMParamPayload extracts the typed fields a DM config event carries.
// Extraction is STRICT per event class — the deriver always writes these
// keys (debtmanager.go's recordOnly call sites), so absence is corrupt
// evidence, not an optional field.
func decodeDMParamPayload(e *ParamTimelineEntry, payload map[string]string) error {
	var err error
	switch e.SourceEvent {
	case "collateral_token_config_set":
		if e.LTV, err = payloadBig(payload, "ltv", e.SourceEvent); err != nil {
			return err
		}
		if e.LiqThreshold, err = payloadBig(payload, "liquidation_threshold", e.SourceEvent); err != nil {
			return err
		}
		if e.LiqBonus, err = payloadBig(payload, "liquidation_bonus", e.SourceEvent); err != nil {
			return err
		}
		if e.PriorLTV, err = payloadBig(payload, "old_ltv", e.SourceEvent); err != nil {
			return err
		}
		if e.PriorLiqThreshold, err = payloadBig(payload, "old_liquidation_threshold", e.SourceEvent); err != nil {
			return err
		}
		if e.PriorLiqBonus, err = payloadBig(payload, "old_liquidation_bonus", e.SourceEvent); err != nil {
			return err
		}
	case "borrow_apy_set":
		if e.BorrowAPY, err = payloadBig(payload, "new_apy", e.SourceEvent); err != nil {
			return err
		}
		if e.PriorBorrowAPY, err = payloadBig(payload, "old_apy", e.SourceEvent); err != nil {
			return err
		}
	case "borrow_token_config_set":
		if e.BorrowAPY, err = payloadBig(payload, "borrow_apy", e.SourceEvent); err != nil {
			return err
		}
	case "collateral_token_added", "collateral_token_removed":
		// Membership changes carry no numeric payload; the SourceEvent IS the
		// fact.
	default:
		return fmt.Errorf("param timeline: DM event %q reached the decoder without a case — dmParamConfigEventTypes and this switch have drifted", e.SourceEvent)
	}
	return nil
}
