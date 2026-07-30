package store

// The Aave collateral flag: a per-(reserve, user) boolean whose ONLY witness is
// a pair of Pool events, read back here as a latest-wins fold.
//
// # Why this is a fold over position_events and not a state read
//
// `isUsingAsCollateral` lives in a packed bitmap behind `getUserConfiguration`,
// an on-chain read riskd may not make (chain-truth R6.3). But the flag is fully
// EVENT-WITNESSED: every path that can set it emits through the Pool — supply
// auto-enable, an explicit `setUserUseReserveAsCollateral`, and
// `finalizeTransfer` on an aToken transfer or liquidation — and the Pool address
// has been in the walker's stream set from this market's genesis block with an
// ADDRESS-ONLY getLogs filter. So raw_logs holds every one of those logs from
// genesis by the walker's coherent-window Step law, and the fold below is exact
// rather than a sample. The registry simply skipped the two topic0s until now
// (the deliberate unknown-topic contract), which is why the logs were in custody
// but not derived.
//
// # Why the event-type strings live HERE, next to the reader
//
// `DMParamsAsOf` spells its event types as SQL literals and the DM deriver
// spells the same strings again in Go — a duplication that survives because a
// typo there produces a LOUD wrong-params failure. It would not survive here: a
// writer/reader spelling mismatch on these two strings yields an EMPTY fold,
// which the law below turns into "no history ⇒ not collateral" for every row on
// the book. That is a silent, uniform collapse of every collateral aggregate,
// so the writer (internal/derive) and the reader (this file) share ONE constant
// and cannot drift.

import (
	"context"
	"fmt"
)

// The two event_type values internal/derive writes for the Pool's collateral
// flag pair, and the only two this fold reads.
//
// TWO TYPES, NOT ONE TYPE PLUS A DIRECTION FIELD. The direction is the entire
// payload of these events, and it belongs in the column the fold reads, not
// inside a JSONB blob the fold would have to extract. The precedent is exactly
// this shape one engine over: the Debt Manager writes
// `collateral_token_added` / `collateral_token_removed` as two types for the
// same reason. It also keeps `event_type` — a plain TEXT column with no enum
// constraint (migration 00002) — doing the discriminating, so THE EVENT LEDGER
// NEEDS NO SCHEMA CHANGE: there is no enum to extend.
//
// (Migration 00014 does exist, but for an unrelated reason: the
// derivation-coverage provenance columns below. Nothing about the two event
// types required it.)
const (
	AaveCollateralEnabledEvent  = "aave_collateral_enabled"
	AaveCollateralDisabledEvent = "aave_collateral_disabled"
)

// CollateralFlagRow is the LATEST flag witness for one (reserve, user) pair at
// or below a bounding block, with the (block, log_index) that witnessed it.
//
// The stamp is not decoration. A flag can be years older than the balance it
// governs — the one live opt-out on this book was set at block 22,551,863 — and
// a disclosure that reported the fold without its as-of would be claiming the
// balances cursor's freshness for a much older fact.
type CollateralFlagRow struct {
	Engine   string
	ChainID  uint64
	Reserve  []byte
	User     []byte
	Enabled  bool
	Block    uint64
	LogIndex uint32
}

// CollateralFlagsAsOf folds the collateral-flag ledger to its latest state per
// (reserve, user), at or below `block`.
//
// # The ordering is the whole correctness argument
//
// `DISTINCT ON (asset, account)` with `ORDER BY asset, account, block_number
// DESC, log_index DESC, seq DESC` takes the LAST event in (block, log_index)
// order, which is chain order. Two flag events for the same pair in one block
// are legal — a transfer that zeroes a balance (disable) followed by a supply
// that re-enables it — and ordering by block alone would let Postgres pick
// either one. `seq` is included for completeness even though these events are
// always one-per-log (seq 0): an ordering that is only unique by accident is an
// ordering that breaks the first time the accident stops holding.
//
// # The bound is the engine's own cursor, and it is not optional
//
// A flag row above the Aave derive cursor describes a block the engine has not
// claimed custody of. Reading it would let a batch assert a collateral posture
// for a block whose balances it has not folded — the two halves of one position
// judged at two different blocks.
//
// # What ABSENCE means, stated here because the consumer depends on it
//
// A (reserve, user) pair with NO row is not an error and not "unknown": under
// genesis-complete custody it is the chain fact "this user has never had this
// reserve enabled as collateral". internal/riskfeed turns that into FALSE. See
// its collateral law for why that is chain-exact rather than a default.
func CollateralFlagsAsOf(ctx context.Context, q Querier, engine string, chainID uint64, block uint64) ([]CollateralFlagRow, error) {
	if engine == "" {
		return nil, nil
	}
	rows, err := q.Query(ctx,
		`SELECT DISTINCT ON (asset, account)
		        asset, account, event_type, block_number, log_index
		 FROM position_events
		 WHERE engine = $1 AND chain_id = $2 AND block_number <= $3
		   AND event_type IN ($4, $5)
		 ORDER BY asset, account, block_number DESC, log_index DESC, seq DESC`,
		engine, int64(chainID), int64(block),
		AaveCollateralEnabledEvent, AaveCollateralDisabledEvent)
	if err != nil {
		return nil, fmt.Errorf("query collateral flags for %q as of %d: %w", engine, block, err)
	}
	defer rows.Close()

	var out []CollateralFlagRow
	for rows.Next() {
		var r CollateralFlagRow
		var eventType string
		var blockNumber int64
		var logIndex int32
		if err := rows.Scan(&r.Reserve, &r.User, &eventType, &blockNumber, &logIndex); err != nil {
			return nil, fmt.Errorf("scan collateral flag row for %q: %w", engine, err)
		}
		// The event type is re-checked rather than assumed from the predicate: a
		// third type reaching this fold would mean the writer grew a case this
		// reader does not understand, and mapping it to a boolean by default is
		// exactly the guess a strict reader refuses.
		switch eventType {
		case AaveCollateralEnabledEvent:
			r.Enabled = true
		case AaveCollateralDisabledEvent:
			r.Enabled = false
		default:
			return nil, fmt.Errorf("collateral flag fold for %q: event_type %q is neither %q nor %q — the writer and this reader have drifted",
				engine, eventType, AaveCollateralEnabledEvent, AaveCollateralDisabledEvent)
		}
		r.Engine = engine
		r.ChainID = chainID
		r.Block = uint64(blockNumber)
		r.LogIndex = uint32(logIndex)
		out = append(out, r)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate collateral flag rows for %q: %w", engine, err)
	}
	return out, nil
}
