// Stage A for the P3 Task-6 gate set: the DERIVED (and committed-input)
// side of every new gate, read inside the SAME repeatable-read read-only
// transaction as the rest of Phase 1.
//
// WHY IT IS HERE AND NOT IN cmd/reconcile. The F5 seam (round-10 F5 /
// round-13 F2) is absolute: every DB read of the run happens in ONE
// transaction which is committed and closed BEFORE any chain read; while it is
// open the process's RPC surface is refused by the Gate sentinel. A Task-6 gate
// that read its derived side "just before comparing" would hold the live
// database's xmin across deep-archive OP calls at 150M — the exact
// vacuum hazard the seam exists to remove. So the derived side is collected
// here, up front, and the gates in cmd/reconcile receive PLAIN VALUES.
//
// The queries below are hand-written SQL rather than new internal/store
// helpers for one reason worth stating: the other P3 wave owns
// internal/store this cycle, and a reconcile gate must not race it. They read
// only tables whose shapes are fixed by committed migrations, they are
// read-only by construction, and they run through the Querier this package is
// handed — never a connection of their own (the round-16 M3 discipline, which
// the boundary test enforces structurally).
package snapshotdb

import (
	"context"
	"encoding/hex"
	"fmt"
	"math/big"
	"time"

	"github.com/kaselunt/solvent/internal/store"
)

// numericText parses a NUMERIC read as ::text into a *big.Int. NUMERIC's scale
// is never interpreted (the store's own discipline): every value written binds
// pgtype.Numeric{Exp: 0}, so the text form is always an integer.
func numericText(s string) (*big.Int, error) {
	v, ok := new(big.Int).SetString(s, 10)
	if !ok {
		return nil, fmt.Errorf("parse numeric %q: not an integer", s)
	}
	return v, nil
}

// T6Leg is one derived position-balance row (account, asset, side, amount) at
// the pin. amount is SCALED for Aave and NORMALIZED for the Debt Manager's
// debt side — raw as stored, never projected here.
type T6Leg struct {
	AccountHex string   `json:"account"`
	AssetHex   string   `json:"asset"`
	Side       string   `json:"side"`
	Source     string   `json:"source"`
	Amount     *big.Int `json:"-"`
	AmountText string   `json:"amount"`
	// UpdatedBlock is the block the row last moved at — recorded so a reviewer
	// can see how stale a leg is relative to the pin.
	UpdatedBlock uint64 `json:"updated_block"`
}

// T6NeverSeen is one empty-set probe subject's DB-side proof. Both legs are
// required by risk-quant R3 ("assert BOTH sides clean"): absent from raw_logs
// AND carrying no derived state.
type T6NeverSeen struct {
	AccountHex string `json:"account"`
	// RawLogHits counts raw_logs rows on the engine's chain that mention the
	// address at all — as the emitting address, inside any topic's low 20
	// bytes, or anywhere in the ABI-encoded data. Nonzero means the address is
	// NOT never-seen and the probe subject is invalid (gated).
	RawLogHits int64 `json:"raw_log_hits"`
	// DerivedRows counts position_events + position_balances rows for the
	// engine.
	DerivedRows int64 `json:"derived_rows"`
}

// T6BacktestRow is one frozen-frame case's DERIVED side, read at the case's
// own (block, log_index).
type T6BacktestRow struct {
	TxHash   string `json:"tx_hash"`
	LogIndex uint32 `json:"log_index"`
	Block    uint64 `json:"block_number"`
	// StoredBlockHash is the raw_logs pin for this case, re-read at run time
	// and compared byte-for-byte with the COMMITTED frame's BlockHash: the
	// committed frame is an input, and an input that no longer matches custody
	// is a gated failure rather than a silent re-pin.
	StoredBlockHash string `json:"stored_block_hash"`
	Present         bool   `json:"present"`

	AccountHex   string `json:"account"`
	DebtAssetHex string `json:"debt_asset"`

	// BeforeDebtUSD is the event's OWN beforeDebtAmount, from the Liquidated
	// payload — the chain's statement, and obligation 1's expected value.
	BeforeDebtUSD *big.Int `json:"-"`
	// LiquidatedUSD is the event's liquidatedAmt.
	LiquidatedUSD *big.Int `json:"-"`
	// IndexAtBlock is the same-block interest index the deriver folded with
	// (the contract's interestIndexSnapshot after _updateInterestIndex).
	IndexAtBlock *big.Int `json:"-"`
	// NormalizedBefore is Σ deltas over position_events for (account, debt
	// asset, side=debt) STRICTLY BEFORE this event in the total order
	// (block_number, log_index, seq) — OUR fold at the pre-liquidation point.
	// This is the derived-under-test value of obligation 1.
	NormalizedBefore *big.Int `json:"-"`
	// NormalizedDelta is this event's own delta (negative).
	NormalizedDelta *big.Int `json:"-"`
	// NormalizedAfter is NormalizedBefore + NormalizedDelta, plus the residue
	// event's delta when this event triggered the 1-wei zeroing.
	NormalizedAfter *big.Int `json:"-"`
	// ResidueZeroed is true when the deriver emitted a residue_zeroed event at
	// this (tx, log_index) — meaning DebtManagerCore.sol:549-553's silent
	// zeroing was MODELLED, so the residue tolerance must not also be spent.
	ResidueZeroed     bool        `json:"residue_zeroed"`
	ResidueAmount     *big.Int    `json:"-"`
	BeforeDebtText    string      `json:"before_debt_usd"`
	LiquidatedText    string      `json:"liquidated_usd"`
	IndexText         string      `json:"index_at_block"`
	NormBeforeText    string      `json:"normalized_before"`
	NormDeltaText     string      `json:"normalized_delta"`
	NormAfterText     string      `json:"normalized_after"`
	ResidueText       string      `json:"residue,omitempty"`
	LiquidatorHex     string      `json:"liquidator"`
	Seizures          []T6Seizure `json:"seizures"`
	SameBlockEarlier  []string    `json:"same_block_earlier_custodied_witnesses"`
	PriorPassLogIndex *uint32     `json:"prior_pass_log_index,omitempty"`
}

// T6Seizure is one userCollateralLiquidated element as the deriver recorded it
// (record-only: collateral is not custodied by the Debt Manager).
type T6Seizure struct {
	Seq        uint16   `json:"seq"`
	AssetHex   string   `json:"asset"`
	Amount     *big.Int `json:"-"`
	Bonus      *big.Int `json:"-"`
	AmountText string   `json:"amount"`
	BonusText  string   `json:"bonus"`
}

// T6FeedRound is one aggregator round as CUSTODY holds it: the block, and the
// chain's own statement of when the answer was agreed (prices.source_as_of,
// filled by the STRICT Go decoder from AnswerUpdated.updatedAt — never by a
// SQL substring over `data`, which migration 00012 explicitly refuses, and
// never observed_at, which is insertion time).
type T6FeedRound struct {
	Block      uint64
	SourceAsOf time.Time
	HasAsOf    bool
}

// T6FeedScan is one raw aggregator's custody-bounded scan input.
type T6FeedScan struct {
	Stream        string `json:"stream"`
	AggregatorHex string `json:"aggregator"`
	ProxyHex      string `json:"proxy"`
	AssetHex      string `json:"asset"`
	Symbol        string `json:"symbol"`
	Source        string `json:"price_source"`
	Heartbeat     int64  `json:"heartbeat_seconds"`
	Grace         int64  `json:"grace_seconds"`
	StartBlock    uint64 `json:"configured_start_block"`
	// IngestCursor is the stream's own last_block: the UPPER bound of the
	// custody domain (chain-truth R4.1 — below the cursor a walked address has
	// no holes by construction; above it there is no testimony at all).
	IngestCursor uint64 `json:"ingest_cursor"`
	// RawLogCount / RawDistinctBlocks are the AnswerUpdated census straight
	// from raw_logs over the domain — the completeness witness the price rows
	// are welded against.
	RawLogCount       int64  `json:"raw_answerupdated_logs"`
	RawDistinctBlocks int64  `json:"raw_answerupdated_distinct_blocks"`
	RawFirstBlock     uint64 `json:"raw_first_block"`
	RawLastBlock      uint64 `json:"raw_last_block"`
	// Rounds is the per-block round list, ordered by block.
	Rounds []T6FeedRound `json:"-"`
	// MissingAsOf counts domain rows with NULL source_as_of — UNSCANNABLE, never
	// extrapolated over (chain-truth R4.1).
	MissingAsOf int64 `json:"rows_missing_source_as_of"`
}

// T6AdapterRow is one sampled adapter-output price row with its OWN stored
// anchor (chain-truth R1, first read family). AnchorHash is the pin the weld
// re-reads at — never the run pin.
type T6AdapterRow struct {
	AssetHex    string   `json:"asset"`
	Source      string   `json:"source"`
	Block       uint64   `json:"block_number"`
	AnchorBlock uint64   `json:"anchor_block"`
	AnchorHash  string   `json:"anchor_hash"`
	HasAnchor   bool     `json:"has_anchor"`
	Price       *big.Int `json:"-"`
	PriceText   string   `json:"price"`
	Decimals    int      `json:"price_decimals"`
	Valid       bool     `json:"valid"`
	SourceAsOf  string   `json:"source_as_of,omitempty"`
}

// Task6Data is the whole derived/committed side of the Task-6 gate set.
type Task6Data struct {
	// Aave: the derived legs at P_eth, event-source only (the Aave engine has
	// no sweep, so `event` is the whole derived truth).
	AaveLegs []T6Leg
	// AaveBorrowerCensus / AaveZeroDebtCensus are the DB-side censuses the
	// cohort floors are welded against (risk-quant R3: population-derived, not
	// a bare constant). A borrower is an account with nonzero derived debt at
	// the pin; a zero-debt subject has positive derived collateral and no
	// positive debt leg.
	AaveBorrowerCensus []string
	AaveZeroDebtCensus []string
	AaveNeverSeen      []T6NeverSeen
	// AaveParams is the aave_param ledger prefix at P_eth — folded by
	// riskfeed.FoldParams in cmd/reconcile (ONE implementation of "what is the
	// effective parameter set", shared with riskd).
	AaveParams []store.ParamRow

	// DM: normalized debt legs and swept collateral legs at P_op.
	DMDebtLegs []T6Leg
	DMCollLegs []T6Leg
	DMParams   []store.ParamRow
	// DMSweepByAccount is the per-account collateral-testimony state at the pin —
	// the SweepBlock watermark ComputeDMHealth REQUIRES (a boolean served over
	// collateral whose freshness is unknown is the posture riskd refuses), with
	// the pin discipline that keeps it in step with the leg filter. See
	// T6SweepState for the defect this replaced.
	DMSweepByAccount map[string]T6SweepState

	// Backtest: one row per frozen frame case, keyed "<txhex>:<logindex>".
	Backtest map[string]T6BacktestRow

	// Heartbeat scan inputs, one per raw aggregator stream.
	Feeds []T6FeedScan

	// Adapter-output weld sample rows.
	AdapterRows []T6AdapterRow
	// AdapterAnchorTotals records, per asset, how many DISTINCT anchors exist
	// at or below the pin — the population the ">=3 rows per reserve across
	// distinct anchors" floor is judged against (a floor above the population
	// is a custody hazard, chain-truth R5.1).
	AdapterAnchorTotals map[string]int64
}

// collectTask6 runs inside the Phase-1 snapshot. It is called from Collect
// after the pins are resolved, so every read below is as-of the same pins the
// rest of the run uses.
func collectTask6(ctx context.Context, q store.Querier, prm Params, cfg FeedRegistry, pins map[string]uint64, wantDM, wantAave bool, ingest []store.IngestCursorState) (*Task6Data, error) {
	t := &Task6Data{
		Backtest:            map[string]T6BacktestRow{},
		DMSweepByAccount:    map[string]T6SweepState{},
		AdapterAnchorTotals: map[string]int64{},
	}
	if wantAave {
		pinETH := pins[AaveEngine]
		var err error
		if t.AaveLegs, err = collectLegs(ctx, q, AaveEngine, "event", pinETH); err != nil {
			return nil, err
		}
		t.AaveBorrowerCensus, t.AaveZeroDebtCensus = censusFromLegs(t.AaveLegs)
		if t.AaveNeverSeen, err = collectNeverSeen(ctx, q, AaveEngine, 1, prm.NeverSeenProbe); err != nil {
			return nil, err
		}
		if t.AaveParams, err = store.ParamsAsOfQ(ctx, q, AaveParamEngine, 1, pinETH); err != nil {
			return nil, fmt.Errorf("aave param ledger at %d: %w", pinETH, err)
		}
		if t.AdapterRows, t.AdapterAnchorTotals, err = collectAdapterRows(ctx, q, cfg, pinETH, prm.AdapterRowsPerReserve); err != nil {
			return nil, err
		}
		if t.Feeds, err = collectFeedScans(ctx, q, cfg, pinETH, ingest); err != nil {
			return nil, err
		}
	}
	if wantDM {
		pinOP := pins[DMEngine]
		var err error
		if t.DMDebtLegs, err = collectLegsSide(ctx, q, DMEngine, "event", "debt", pinOP); err != nil {
			return nil, err
		}
		if t.DMCollLegs, err = collectLegsSide(ctx, q, DMEngine, "snapshot", "collateral", pinOP); err != nil {
			return nil, err
		}
		if t.DMParams, err = store.DMParamsAsOf(ctx, q, pinOP); err != nil {
			return nil, fmt.Errorf("dm param ledger at %d: %w", pinOP, err)
		}
		// The watermark is filtered at the SAME pin as the legs, and is handed the
		// visible legs so the exclusion stays checkable (T6SweepState).
		if err := collectSweepBlocks(ctx, q, DMEngine, pinOP, t.DMSweepByAccount, t.DMCollLegs); err != nil {
			return nil, err
		}
		if err := collectBacktest(ctx, q, prm.BacktestKeys, t.Backtest); err != nil {
			return nil, err
		}
	}
	return t, nil
}

// collectLegs reads every positive derived leg for an engine/source at the pin.
func collectLegs(ctx context.Context, q store.Querier, engine, source string, pin uint64) ([]T6Leg, error) {
	rows, err := q.Query(ctx, `
		SELECT encode(account,'hex'), encode(asset,'hex'), side, source, amount::text, updated_block
		FROM position_balances
		WHERE engine = $1 AND source = $2 AND amount > 0 AND updated_block <= $3
		ORDER BY account, side, asset`, engine, source, int64(pin))
	if err != nil {
		return nil, fmt.Errorf("task6 legs (%s/%s): %w", engine, source, err)
	}
	defer rows.Close()
	var out []T6Leg
	for rows.Next() {
		var l T6Leg
		var block int64
		if err := rows.Scan(&l.AccountHex, &l.AssetHex, &l.Side, &l.Source, &l.AmountText, &block); err != nil {
			return nil, fmt.Errorf("scan task6 leg: %w", err)
		}
		if l.Amount, err = numericText(l.AmountText); err != nil {
			return nil, err
		}
		l.UpdatedBlock = uint64(block)
		out = append(out, l)
	}
	return out, rows.Err()
}

// collectLegsSide is collectLegs narrowed to one side.
func collectLegsSide(ctx context.Context, q store.Querier, engine, source, side string, pin uint64) ([]T6Leg, error) {
	rows, err := q.Query(ctx, `
		SELECT encode(account,'hex'), encode(asset,'hex'), side, source, amount::text, updated_block
		FROM position_balances
		WHERE engine = $1 AND source = $2 AND side = $3 AND amount > 0 AND updated_block <= $4
		ORDER BY account, asset`, engine, source, side, int64(pin))
	if err != nil {
		return nil, fmt.Errorf("task6 legs (%s/%s/%s): %w", engine, source, side, err)
	}
	defer rows.Close()
	var out []T6Leg
	for rows.Next() {
		var l T6Leg
		var block int64
		if err := rows.Scan(&l.AccountHex, &l.AssetHex, &l.Side, &l.Source, &l.AmountText, &block); err != nil {
			return nil, fmt.Errorf("scan task6 leg: %w", err)
		}
		if l.Amount, err = numericText(l.AmountText); err != nil {
			return nil, err
		}
		l.UpdatedBlock = uint64(block)
		out = append(out, l)
	}
	return out, rows.Err()
}

// censusFromLegs derives the two Aave censuses from the legs, in deterministic
// order. Doing it here rather than in SQL keeps ONE definition of "borrower"
// (a positive debt leg) that the cohort builder and the census assertion both
// read — a second SQL predicate would be a second definition.
func censusFromLegs(legs []T6Leg) (borrowers, zeroDebt []string) {
	hasDebt := map[string]bool{}
	hasColl := map[string]bool{}
	var order []string
	seen := map[string]bool{}
	for _, l := range legs {
		if !seen[l.AccountHex] {
			seen[l.AccountHex] = true
			order = append(order, l.AccountHex)
		}
		switch l.Side {
		case "debt":
			hasDebt[l.AccountHex] = true
		case "collateral":
			hasColl[l.AccountHex] = true
		}
	}
	for _, a := range order {
		if hasDebt[a] {
			borrowers = append(borrowers, a)
		} else if hasColl[a] {
			zeroDebt = append(zeroDebt, a)
		}
	}
	return borrowers, zeroDebt
}

// collectNeverSeen proves the empty-set probe subjects clean on the DB side.
//
// The raw_logs predicate is deliberately WIDE: the address as the emitting
// contract, inside any topic's low 20 bytes (the indexed-address encoding), or
// anywhere inside `data` (the ABI-encoded non-indexed encoding). A narrow
// predicate would let an address that IS in custody pass as never-seen, which
// would make the phantom-debt probe a probe of nothing.
func collectNeverSeen(ctx context.Context, q store.Querier, engine string, chainID int64, subjects [][]byte) ([]T6NeverSeen, error) {
	out := make([]T6NeverSeen, 0, len(subjects))
	for _, s := range subjects {
		row := T6NeverSeen{AccountHex: hex.EncodeToString(s)}
		if err := q.QueryRow(ctx, `
			SELECT count(*) FROM raw_logs r
			WHERE r.chain_id = $1
			  AND ( r.address = $2
			     OR position($2 in r.data) > 0
			     OR EXISTS (SELECT 1 FROM unnest(r.topics) tp WHERE substring(tp FROM 13 FOR 20) = $2) )`,
			chainID, s).Scan(&row.RawLogHits); err != nil {
			return nil, fmt.Errorf("never-seen raw_logs probe for %s: %w", row.AccountHex, err)
		}
		if err := q.QueryRow(ctx, `
			SELECT (SELECT count(*) FROM position_events WHERE engine = $1 AND account = $2)
			     + (SELECT count(*) FROM position_balances WHERE engine = $1 AND account = $2)`,
			engine, s).Scan(&row.DerivedRows); err != nil {
			return nil, fmt.Errorf("never-seen derived probe for %s: %w", row.AccountHex, err)
		}
		out = append(out, row)
	}
	return out, nil
}

// T6SweepState is one account's COLLATERAL-TESTIMONY state at the pin.
//
// THE DEFECT THIS TYPE EXISTS TO CLOSE (found by the sweep-gap probe against
// this wave's own gate, 2026-07-29). collectLegsSide filters collateral legs at
// `updated_block <= pin`; the sweep watermark was read with NO block filter.
// Those two clocks disagree by construction: the collateral sweeper's multicall
// executes at chain HEAD, which is ABOVE the derive cursor the run pins at, and
// ApplySweepBatch replaces an account's legs WHOLESALE. So an account swept
// above the pin had ALL of its legs discarded by the leg filter while its
// watermark still certified them as read — requireWatermarks passed,
// ComputeDMHealth summed nothing, and `Liquidatable = debt > 0` came out TRUE.
// Measured live: 199 of 9,722 accounts (~2%) sat in that state mid-generation
// at a ~34% duty cycle, and 5/5 chain-checked ones were HEALTHY — including one
// carrying $100,120 of threshold-weighted collateral. That is 199 manufactured
// false liquidation alerts, and it is OUR clock disagreement, not a defect in
// the sweeper's read.
//
// The fix is to give the watermark the SAME pin discipline as the legs, never to
// drop the leg filter: importing above-pin state into a pinned comparison would
// be the two-doors violation this harness exists to refuse.
type T6SweepState struct {
	// AtOrBelowPin is the newest successful sweep at or below the run pin — the
	// ONLY watermark that certifies legs a pinned read can see. 0 means the
	// account has no collateral testimony AT THE PIN, and the gate must refuse
	// it rather than score it over discarded collateral.
	AtOrBelowPin uint64 `json:"sweep_block_at_or_below_pin"`
	// Newest is the newest successful sweep at ANY height (0 = never succeeded).
	// It is what distinguishes "swept, but above this run's pin" (a timing
	// property of the pin) from "never successfully swept" (a persistent hole).
	Newest uint64 `json:"newest_success_block"`
	// LegsAtOrBelowPin counts the account's collateral legs the pin can see. It
	// makes the exclusion CHECKABLE: AtOrBelowPin == 0 must imply zero visible
	// legs, and the gate asserts that as a gated invariant.
	LegsAtOrBelowPin int `json:"legs_at_or_below_pin"`
	// Status is the last sweep ATTEMPT's outcome, recorded for disclosure only.
	// It is deliberately NOT in the predicate: last_success_block is the block of
	// the most recent SUCCESS, so an account whose latest attempt failed still
	// has honest collateral testimony from that success.
	Status string `json:"last_attempt_status"`
}

// collectSweepBlocks reads each account's collateral-testimony state, with the
// watermark filtered at THE SAME PIN as the legs.
func collectSweepBlocks(ctx context.Context, q store.Querier, engine string, pin uint64,
	out map[string]T6SweepState, legs []T6Leg) error {
	visibleLegs := map[string]int{}
	for _, l := range legs {
		visibleLegs[l.AccountHex]++
	}
	rows, err := q.Query(ctx, `
		SELECT encode(account,'hex'), last_success_block, status
		FROM snapshot_sweeps
		WHERE engine = $1 AND last_success_block > 0`, engine)
	if err != nil {
		return fmt.Errorf("task6 sweep state: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var acct, status string
		var block int64
		if err := rows.Scan(&acct, &block, &status); err != nil {
			return fmt.Errorf("scan sweep state: %w", err)
		}
		st := T6SweepState{Newest: uint64(block), Status: status, LegsAtOrBelowPin: visibleLegs[acct]}
		// THE PIN FILTER. A sweep above the pin certifies nothing a pinned read
		// can see, so it does not become a watermark.
		if st.Newest <= pin {
			st.AtOrBelowPin = st.Newest
		}
		out[acct] = st
	}
	return rows.Err()
}

// collectBacktest reads the derived side of every frozen frame case.
//
// keys are "<tx_hash_hex>:<log_index>" strings from the COMMITTED frame. A key
// with no matching derived row comes back Present=false — a gated failure in
// cmd/reconcile, never a skipped case (the frame is frozen: a shrunk N is the
// silent-cap anti-canon).
func collectBacktest(ctx context.Context, q store.Querier, keys []string, out map[string]T6BacktestRow) error {
	for _, key := range keys {
		txHex, logIdx, err := splitFrameKey(key)
		if err != nil {
			return err
		}
		raw, err := hex.DecodeString(txHex)
		if err != nil {
			return fmt.Errorf("frame key %q: %w", key, err)
		}
		row := T6BacktestRow{TxHash: txHex, LogIndex: logIdx}

		var storedHash []byte
		var blockNumber int64
		err = q.QueryRow(ctx, `
			SELECT block_number, block_hash FROM raw_logs
			WHERE chain_id = 10 AND tx_hash = $1 AND log_index = $2`, raw, int32(logIdx)).
			Scan(&blockNumber, &storedHash)
		if err != nil {
			// A missing raw log is recorded, not fatal: the gate reports it as a
			// gated failure with the key named.
			out[key] = row
			continue
		}
		row.Block = uint64(blockNumber)
		row.StoredBlockHash = "0x" + hex.EncodeToString(storedHash)

		var account, asset []byte
		var deltaText, beforeText, liqText, idxText, liquidator string
		err = q.QueryRow(ctx, `
			SELECT account, asset, delta::text,
			       payload->>'before_debt_usd', payload->>'usd', payload->>'index',
			       COALESCE(payload->>'liquidator','')
			FROM position_events
			WHERE engine = 'debt_manager' AND event_type = 'liquidation'
			  AND chain_id = 10 AND tx_hash = $1 AND log_index = $2 AND seq = 0`, raw, int32(logIdx)).
			Scan(&account, &asset, &deltaText, &beforeText, &liqText, &idxText, &liquidator)
		if err != nil {
			out[key] = row
			continue
		}
		row.Present = true
		row.AccountHex = hex.EncodeToString(account)
		row.DebtAssetHex = hex.EncodeToString(asset)
		row.LiquidatorHex = liquidator
		row.BeforeDebtText, row.LiquidatedText, row.IndexText, row.NormDeltaText = beforeText, liqText, idxText, deltaText
		if row.BeforeDebtUSD, err = numericText(beforeText); err != nil {
			return fmt.Errorf("case %s beforeDebtAmount: %w", key, err)
		}
		if row.LiquidatedUSD, err = numericText(liqText); err != nil {
			return fmt.Errorf("case %s liquidatedAmt: %w", key, err)
		}
		if row.IndexAtBlock, err = numericText(idxText); err != nil {
			return fmt.Errorf("case %s index: %w", key, err)
		}
		if row.NormalizedDelta, err = numericText(deltaText); err != nil {
			return fmt.Errorf("case %s delta: %w", key, err)
		}

		// OUR fold at the pre-liquidation point: Σ deltas STRICTLY BEFORE this
		// event in the total order (block_number, log_index, seq). Row-wise
		// tuple comparison is the whole point — a two-pass tx has both events in
		// one block, and the SECOND pass's before-state IS the first pass's
		// after-state, which only a strict total order reproduces.
		var normBefore string
		if err := q.QueryRow(ctx, `
			SELECT COALESCE(SUM(delta),0)::text FROM position_events
			WHERE engine = 'debt_manager' AND chain_id = 10
			  AND account = $1 AND asset = $2 AND side = 'debt' AND delta IS NOT NULL
			  AND (block_number, log_index, seq) < ($3::bigint, $4::int, 0::int)`,
			account, asset, blockNumber, int32(logIdx)).Scan(&normBefore); err != nil {
			return fmt.Errorf("case %s normalized-before fold: %w", key, err)
		}
		if row.NormalizedBefore, err = numericText(normBefore); err != nil {
			return fmt.Errorf("case %s normalized-before: %w", key, err)
		}

		// Residue: the deriver's explicit model of DebtManagerCore.sol:549-553.
		var residueText *string
		if err := q.QueryRow(ctx, `
			SELECT (payload->>'residue') FROM position_events
			WHERE engine = 'debt_manager' AND chain_id = 10 AND tx_hash = $1
			  AND log_index = $2 AND event_type = 'residue_zeroed'
			LIMIT 1`, raw, int32(logIdx)).Scan(&residueText); err != nil {
			residueText = nil
		}
		row.NormalizedAfter = new(big.Int).Add(row.NormalizedBefore, row.NormalizedDelta)
		if residueText != nil {
			row.ResidueZeroed = true
			row.ResidueText = *residueText
			if row.ResidueAmount, err = numericText(*residueText); err != nil {
				return fmt.Errorf("case %s residue: %w", key, err)
			}
			row.NormalizedAfter = new(big.Int).Sub(row.NormalizedAfter, row.ResidueAmount)
		}
		row.NormBeforeText = row.NormalizedBefore.String()
		row.NormAfterText = row.NormalizedAfter.String()

		// The seizure fan-out, record-only rows in seq order.
		srows, err := q.Query(ctx, `
			SELECT seq, encode(asset,'hex'), payload->>'amount', payload->>'bonus'
			FROM position_events
			WHERE engine = 'debt_manager' AND chain_id = 10 AND tx_hash = $1
			  AND log_index = $2 AND event_type = 'liquidation_collateral'
			ORDER BY seq`, raw, int32(logIdx))
		if err != nil {
			return fmt.Errorf("case %s seizures: %w", key, err)
		}
		for srows.Next() {
			var s T6Seizure
			var seq int32
			if err := srows.Scan(&seq, &s.AssetHex, &s.AmountText, &s.BonusText); err != nil {
				srows.Close()
				return fmt.Errorf("scan case %s seizure: %w", key, err)
			}
			s.Seq = uint16(seq)
			if s.Amount, err = numericText(s.AmountText); err != nil {
				srows.Close()
				return err
			}
			if s.Bonus, err = numericText(s.BonusText); err != nil {
				srows.Close()
				return err
			}
			row.Seizures = append(row.Seizures, s)
		}
		srows.Close()
		if err := srows.Err(); err != nil {
			return fmt.Errorf("iterate case %s seizures: %w", key, err)
		}

		// SAME-BLOCK EARLIER CUSTODIED WITNESSES (chain-truth R1's three-state
		// law): every raw_logs row in this block with a LOWER log_index whose
		// address is a walked DM/oracle address. These are the only witnesses
		// permitted to explain an eligibility flip; anything else is UNEXPLAINED.
		wrows, err := q.Query(ctx, `
			SELECT r.log_index, encode(r.address,'hex'), encode(r.topics[1],'hex')
			FROM raw_logs r
			WHERE r.chain_id = 10 AND r.block_number = $1 AND r.log_index < $2
			ORDER BY r.log_index`, blockNumber, int32(logIdx))
		if err != nil {
			return fmt.Errorf("case %s same-block witnesses: %w", key, err)
		}
		for wrows.Next() {
			var li int32
			var addr, topic string
			if err := wrows.Scan(&li, &addr, &topic); err != nil {
				wrows.Close()
				return fmt.Errorf("scan case %s witness: %w", key, err)
			}
			row.SameBlockEarlier = append(row.SameBlockEarlier,
				fmt.Sprintf("log_index %d address 0x%s topic0 0x%s", li, addr, topic))
		}
		wrows.Close()
		if err := wrows.Err(); err != nil {
			return fmt.Errorf("iterate case %s witnesses: %w", key, err)
		}

		// PRIOR PASS: an earlier Liquidated for the SAME (account, debt token) in
		// the SAME tx. Its presence is what makes this case a second pass, and
		// obligation 1 must reproduce the first pass's after-state exactly.
		var priorLog *int32
		if err := q.QueryRow(ctx, `
			SELECT max(log_index) FROM position_events
			WHERE engine = 'debt_manager' AND chain_id = 10 AND tx_hash = $1
			  AND event_type = 'liquidation' AND account = $2 AND asset = $3
			  AND log_index < $4`, raw, account, asset, int32(logIdx)).Scan(&priorLog); err == nil && priorLog != nil {
			v := uint32(*priorLog)
			row.PriorPassLogIndex = &v
		}
		out[key] = row
	}
	return nil
}

// splitFrameKey parses "<tx hex, no 0x>:<log index>".
func splitFrameKey(key string) (string, uint32, error) {
	for i := len(key) - 1; i >= 0; i-- {
		if key[i] == ':' {
			var idx uint32
			if _, err := fmt.Sscanf(key[i+1:], "%d", &idx); err != nil {
				return "", 0, fmt.Errorf("frame key %q: log index: %w", key, err)
			}
			return key[:i], idx, nil
		}
	}
	return "", 0, fmt.Errorf("frame key %q: expected <tx>:<logIndex>", key)
}

// collectAdapterRows samples adapter-output price rows for the weld. Per asset
// it takes the rows at the N HIGHEST DISTINCT anchor blocks at or below the pin
// — deterministic (no seed to steer), archive-friendly (recent blocks), and
// each row carries its OWN anchor hash, which is the pin the weld re-reads at.
func collectAdapterRows(ctx context.Context, q store.Querier, cfg FeedRegistry, pin uint64, perReserve int) ([]T6AdapterRow, map[string]int64, error) {
	totals := map[string]int64{}
	if perReserve <= 0 {
		perReserve = 3
	}
	rows, err := q.Query(ctx, `
		WITH ranked AS (
		  SELECT p.asset, p.source, p.block_number, p.anchor_block, p.price::text AS price,
		         p.price_decimals, p.valid, p.source_as_of,
		         dense_rank() OVER (PARTITION BY p.asset ORDER BY p.anchor_block DESC) AS anchor_rank
		  FROM prices p
		  WHERE p.owner_engine = $1 AND p.source LIKE 'aaveoracle:%'
		    AND p.anchor_block IS NOT NULL AND p.block_number <= $2
		)
		SELECT encode(r.asset,'hex'), r.source, r.block_number, r.anchor_block,
		       COALESCE(encode(a.block_hash,'hex'),''), r.price, r.price_decimals, r.valid,
		       COALESCE(r.source_as_of::text,'')
		FROM ranked r
		LEFT JOIN price_poll_anchors a ON a.engine = $1 AND a.block_number = r.anchor_block
		WHERE r.anchor_rank <= $3
		ORDER BY r.asset, r.anchor_block DESC`, cfg.AavePollEngine, int64(pin), perReserve)
	if err != nil {
		return nil, nil, fmt.Errorf("task6 adapter-output sample: %w", err)
	}
	defer rows.Close()
	var out []T6AdapterRow
	for rows.Next() {
		var r T6AdapterRow
		var block, anchor int64
		var hashHex string
		if err := rows.Scan(&r.AssetHex, &r.Source, &block, &anchor, &hashHex,
			&r.PriceText, &r.Decimals, &r.Valid, &r.SourceAsOf); err != nil {
			return nil, nil, fmt.Errorf("scan adapter row: %w", err)
		}
		r.Block, r.AnchorBlock = uint64(block), uint64(anchor)
		if hashHex != "" {
			r.AnchorHash, r.HasAnchor = "0x"+hashHex, true
		}
		if r.Price, err = numericText(r.PriceText); err != nil {
			return nil, nil, err
		}
		out = append(out, r)
	}
	if err := rows.Err(); err != nil {
		return nil, nil, err
	}
	trows, err := q.Query(ctx, `
		SELECT encode(asset,'hex'), count(DISTINCT anchor_block)
		FROM prices WHERE owner_engine = $1 AND source LIKE 'aaveoracle:%'
		  AND anchor_block IS NOT NULL AND block_number <= $2
		GROUP BY 1`, cfg.AavePollEngine, int64(pin))
	if err != nil {
		return nil, nil, fmt.Errorf("task6 adapter anchor totals: %w", err)
	}
	defer trows.Close()
	for trows.Next() {
		var asset string
		var n int64
		if err := trows.Scan(&asset, &n); err != nil {
			return nil, nil, fmt.Errorf("scan adapter anchor total: %w", err)
		}
		totals[asset] = n
	}
	return out, totals, trows.Err()
}

// collectFeedScans reads the B3 scan's custody-bounded inputs per raw
// aggregator.
func collectFeedScans(ctx context.Context, q store.Querier, cfg FeedRegistry, pin uint64, ingest []store.IngestCursorState) ([]T6FeedScan, error) {
	cursorByStream := map[string]uint64{}
	for _, c := range ingest {
		cursorByStream[c.Stream] = c.LastBlock
	}
	out := make([]T6FeedScan, 0, len(cfg.Feeds))
	for _, f := range cfg.Feeds {
		scan := T6FeedScan{
			Stream: f.Stream, AggregatorHex: f.AggregatorHex, ProxyHex: f.ProxyHex,
			AssetHex: f.AssetHex, Symbol: f.Symbol, Source: f.Source,
			Heartbeat: f.HeartbeatSeconds, Grace: f.GraceSeconds,
			StartBlock: f.StartBlock, IngestCursor: cursorByStream[f.Stream],
		}
		// The scan's UPPER bound is min(ingest cursor, pin): above the cursor
		// there is no testimony, and above the pin the run is not looking.
		upper := scan.IngestCursor
		if upper == 0 || upper > pin {
			upper = pin
		}
		agg, err := hex.DecodeString(f.AggregatorHex)
		if err != nil {
			return nil, fmt.Errorf("feed %s aggregator %q: %w", f.Stream, f.AggregatorHex, err)
		}
		topic, err := hex.DecodeString(AnswerUpdatedTopic0)
		if err != nil {
			return nil, err
		}
		var firstBlock, lastBlock *int64
		if err := q.QueryRow(ctx, `
			SELECT count(*), count(DISTINCT block_number), min(block_number), max(block_number)
			FROM raw_logs WHERE chain_id = 1 AND address = $1 AND topics[1] = $2
			  AND block_number >= $3 AND block_number <= $4`,
			agg, topic, int64(f.StartBlock), int64(upper)).
			Scan(&scan.RawLogCount, &scan.RawDistinctBlocks, &firstBlock, &lastBlock); err != nil {
			return nil, fmt.Errorf("feed %s AnswerUpdated census: %w", f.Stream, err)
		}
		if firstBlock != nil {
			scan.RawFirstBlock = uint64(*firstBlock)
		}
		if lastBlock != nil {
			scan.RawLastBlock = uint64(*lastBlock)
		}
		prows, err := q.Query(ctx, `
			SELECT block_number, source_as_of
			FROM prices
			WHERE chain_id = 1 AND owner_engine = $1 AND source = $2
			  AND block_number >= $3 AND block_number <= $4
			ORDER BY block_number`,
			cfg.FeedEngine, f.Source, int64(f.StartBlock), int64(upper))
		if err != nil {
			return nil, fmt.Errorf("feed %s rounds: %w", f.Stream, err)
		}
		for prows.Next() {
			var block int64
			var asOf *time.Time
			if err := prows.Scan(&block, &asOf); err != nil {
				prows.Close()
				return nil, fmt.Errorf("scan feed %s round: %w", f.Stream, err)
			}
			r := T6FeedRound{Block: uint64(block)}
			if asOf != nil {
				r.SourceAsOf, r.HasAsOf = asOf.UTC(), true
			} else {
				scan.MissingAsOf++
			}
			scan.Rounds = append(scan.Rounds, r)
		}
		prows.Close()
		if err := prows.Err(); err != nil {
			return nil, fmt.Errorf("iterate feed %s rounds: %w", f.Stream, err)
		}
		out = append(out, scan)
	}
	return out, nil
}

// AnswerUpdatedTopic0 is keccak256("AnswerUpdated(int256,uint256,uint256)"),
// the canonical Chainlink aggregator round topic. It is a CONSTANT here rather
// than a keccak call because this package may not import a hashing surface (the
// import allowlist is a capability boundary, not a namespace one). It is
// EXPORTED so TestAnswerUpdatedTopic0IsCanonical in cmd/reconcile can re-derive
// it with crypto.Keccak256: a copied string with one wrong nibble would scan
// zero rounds and report "no gaps", which is the friendliest possible lie.
const AnswerUpdatedTopic0 = "0559884fd3a460db3073b7fc896cc77986f16e378210ded43186175bf646fc5f"

// FeedRegistry is the PLAIN-VALUE feed registry Collect is handed. It is built
// by cmd/reconcile from recon/feeds.json + config/contracts.json — this
// package may not read files (round-14 F3 removed `os` from its import
// allowlist, and an entry earns its place by its whole capability set), so the
// registry arrives as data, already parsed, exactly like Params.ConfigSHA.
type FeedRegistry struct {
	FeedEngine     string
	AavePollEngine string
	Feeds          []FeedSpec
}

// FeedSpec is one raw-aggregator stream's registry facts.
type FeedSpec struct {
	Stream           string
	AggregatorHex    string
	ProxyHex         string
	AssetHex         string
	Symbol           string
	Source           string
	HeartbeatSeconds int64
	GraceSeconds     int64
	StartBlock       uint64
}
