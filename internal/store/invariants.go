// Invariant scans (Task 9 wave 10, brief §6): the SQL lives here as package
// constants and is executed through the SAME Querier-taking functions by (a)
// cmd/reconcile inside its REPEATABLE READ snapshot (results embedded in the
// drift report), (b) the read-only evidence tests against the live database
// (invariants_live_test.go, gated SOLVENT_RECON_DATABASE_URL), and (c) the
// falsifiability tests that seed one violation inside a rolled-back
// transaction and assert the detector fires (invariants_test.go, gated
// TEST_DATABASE_URL → the writable scratch database solvent_test). One SQL
// constant per scan means the thing the tests prove is the thing the
// reconcile run executes.
//
// Normative clauses (each scan's doc cites its own): W1's Phase 1 deferred
// item "distinct-hash-per-height invariant scan" (pre-gate wording) and the
// Task 9 post-gate bullets — event sums equal event-source balances;
// borrow_index monotonic non-decreasing per (engine, asset).
package store

import (
	"context"
	"fmt"
)

// InvariantDistinctHashSQL is scan 1 — distinct-hash-per-height (W1 Phase 1
// deferred item, pre-gate wording): every (chain_id, block_number) in
// raw_logs must carry EXACTLY one block_hash. More than one means two
// incompatible chain states were ingested at the same height without a
// rewind separating them. Expected result: zero rows. HAVING > 1 is the
// invariant boundary: exactly one hash per height is the healthy case, so a
// >= 1 (or dropped) predicate would flag every populated height.
const InvariantDistinctHashSQL = `
SELECT chain_id, block_number, COUNT(DISTINCT block_hash) AS hashes,
       array_agg(DISTINCT encode(block_hash,'hex')) AS conflicting
FROM raw_logs GROUP BY chain_id, block_number
HAVING COUNT(DISTINCT block_hash) > 1`

// InvariantEventSumSQL is scan 2 — event sums == event-source balances
// (Task 9 post-gate bullet). STRICT `IS DISTINCT FROM`, deliberately: both
// live application and RewindDerived's no-HAVING rebuild (derive.go)
// materialize amount-0 rows, so a zero-sum allowance or a double-COALESCE
// "treat missing as zero" variant is a fixture-that-cannot-fail for the real
// orphan classes (L0-4) — a balance row with NO event rows, an event group
// with NO balance row, and a zero-vs-missing disagreement are all real
// violations this scan must surface. Snapshot-source rows are excluded by
// the source = 'event' predicate (source-exclusivity: collateral balances
// are sweep-derived and have no event trail to sum). Expected: zero rows.
//
// The ev CTE's predicate is DELIBERATELY WIDER than the fold predicate
// (derive.go live fold and rebuild both use `side <> ” AND delta IS NOT
// NULL`; this CTE uses `delta IS NOT NULL` only — risk-quant consult F3): a
// future delta-bearing side-less event would be silently DROPPED by the fold
// and must SURFACE here as an ev-orphan rather than be silently consistent.
// The named sub-assertion for that class is CountReconRows'
// SidelessDeltaBearingRows == 0 (and NullAssetDeltaBearingRows == 0 for the
// NULL-asset twin, which would un-pair this join): while both counts are
// zero — true today for every event type — the wide and fold predicates
// agree; the moment they diverge, the sub-assertion names the divergence
// taxonomy-violation instead of leaving it to read as join noise.
const InvariantEventSumSQL = `
WITH ev AS (
  SELECT engine, account, asset, side, SUM(delta) AS total
  FROM position_events WHERE delta IS NOT NULL
  GROUP BY engine, account, asset, side
), bal AS (
  SELECT engine, account, asset, side, amount
  FROM position_balances WHERE source = 'event'
)
SELECT COALESCE(ev.engine,bal.engine), COALESCE(ev.account,bal.account),
       COALESCE(ev.asset,bal.asset),  COALESCE(ev.side,bal.side),
       ev.total::text AS event_sum, bal.amount::text AS balance
FROM ev FULL OUTER JOIN bal
  ON bal.engine=ev.engine AND bal.account=ev.account
 AND bal.asset=ev.asset  AND bal.side=ev.side
WHERE ev.total IS DISTINCT FROM bal.amount`

// InvariantBorrowIndexSQL is scan 3 — borrow_index monotonic non-decreasing
// per (engine, asset) (Task 9 post-gate bullet; the Debt Manager index
// accrues linearly and compounds at updates — DebtManagerStorageContract.sol
// :559-567 — so a decrease is impossible on a canonical history). Expected:
// zero rows. kind='borrow_index' ONLY: borrow_apy is excluded by design (not
// persisted to rate_indexes at all — see runner.go's collect — and an APY is
// policy, not monotonic); the Aave sibling kinds get a SEPARATE advisory
// scan below so an advisory finding can never fail the mandated scan.
const InvariantBorrowIndexSQL = `
SELECT engine, encode(asset,'hex') AS asset, block_number,
       value::text, prev_value::text
FROM (
  SELECT engine, asset, block_number, value,
         LAG(value) OVER (PARTITION BY engine, asset ORDER BY block_number) AS prev_value
  FROM rate_indexes WHERE kind = 'borrow_index'
) t
WHERE prev_value IS NOT NULL AND value < prev_value`

// InvariantAaveIndexSQL is the ADVISORY sibling of scan 3 for the Aave kinds
// (variable_borrow_index / liquidity_index — both ray indexes that only
// grow). Advisory because no plan clause mandates them (brief §6): its
// findings are reported, never gated, and never conflated with the mandated
// borrow_index scan.
const InvariantAaveIndexSQL = `
SELECT engine, encode(asset,'hex') AS asset, kind, block_number,
       value::text, prev_value::text
FROM (
  SELECT engine, asset, kind, block_number, value,
         LAG(value) OVER (PARTITION BY engine, asset, kind ORDER BY block_number) AS prev_value
  FROM rate_indexes WHERE kind IN ('variable_borrow_index','liquidity_index')
) t
WHERE prev_value IS NOT NULL AND value < prev_value`

// InvariantEventLogOrphanSQL is scan 4 — position_events → raw_logs
// referential integrity on (chain_id, tx_hash, log_index) (risk-quant
// consult F5.1): every derived event must trace to an ingested raw log.
// Zero orphans is the invariant. This verifies the reorg-epoch machinery's
// OUTCOME as a standing database fact — a derived row whose raw log was
// rewound away (or never existed) is exactly the state the epoch ack
// protocol exists to make impossible — instead of trusting the protocol.
// seq is deliberately absent from the join: multiple derived events fan out
// from ONE raw log (the position_events PK comment), all tracing to the same
// (chain_id, tx_hash, log_index) row.
const InvariantEventLogOrphanSQL = `
SELECT e.chain_id, encode(e.tx_hash,'hex') AS tx_hash, e.log_index,
       e.engine, e.event_type, e.block_number
FROM position_events e
LEFT JOIN raw_logs r
  ON r.chain_id = e.chain_id AND r.tx_hash = e.tx_hash AND r.log_index = e.log_index
WHERE r.tx_hash IS NULL`

// InvariantIIUCoverageSQL is scan 5 — same-block InterestIndexUpdated
// coverage (risk-quant consult F5.2): every block hosting a DM debt-mutating
// event (borrow / repay / liquidation) must carry a
// rate_indexes(kind='borrow_index') row for the SAME token at the SAME
// block. This is the deriver's own one-IIU-per-mutating-block invariant
// (debtmanager.go's same-block index join; empirically 154/154 in recon's
// validation) persisted as a DB fact: the deriver could not have priced the
// event without it, so its absence means the rate row was lost after the
// fold. residue_zeroed is excluded (it shares its liquidation's block);
// migration_genesis is excluded (calldata-seeded, no index math at the
// migration blocks). Zero rows is the invariant.
const InvariantIIUCoverageSQL = `
SELECT DISTINCT e.block_number, encode(e.asset,'hex') AS asset, e.event_type
FROM position_events e
WHERE e.engine = 'debt_manager'
  AND e.event_type IN ('borrow','repay','liquidation')
  AND NOT EXISTS (
    SELECT 1 FROM rate_indexes ri
    WHERE ri.engine = 'debt_manager' AND ri.kind = 'borrow_index'
      AND ri.asset = e.asset AND ri.block_number = e.block_number)`

// HashViolation is one scan-1 row: a height carrying more than one hash.
type HashViolation struct {
	ChainID     int64
	BlockNumber uint64
	Hashes      int64
	Conflicting []string
}

// InvariantDistinctHashViolations runs scan 1. Zero rows is the invariant.
func InvariantDistinctHashViolations(ctx context.Context, q Querier) ([]HashViolation, error) {
	rows, err := q.Query(ctx, InvariantDistinctHashSQL)
	if err != nil {
		return nil, fmt.Errorf("scan 1 (distinct hash per height): %w", err)
	}
	defer rows.Close()
	var out []HashViolation
	for rows.Next() {
		var v HashViolation
		if err := rows.Scan(&v.ChainID, &v.BlockNumber, &v.Hashes, &v.Conflicting); err != nil {
			return nil, fmt.Errorf("scan 1 row: %w", err)
		}
		out = append(out, v)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("scan 1 iterate: %w", err)
	}
	return out, nil
}

// SumMismatch is one scan-2 row. EventSum/Balance are decimal text; nil
// pointer semantics are preserved as empty-string-with-Present=false so a
// missing side is distinguishable from a zero.
type SumMismatch struct {
	Engine   string
	Account  []byte
	Asset    []byte
	Side     string
	EventSum *string
	Balance  *string
}

// InvariantEventSumMismatches runs scan 2. Zero rows is the invariant.
//
// Note recorded for reviewers (brief §6): aave_liquidation_call rows can
// carry delta = 0 (non-nil) — harmless for sums; "has a delta row" ≠ "moved
// a balance". The companion sub-assertion for NULL-asset delta rows lives in
// CountReconRows (NullAssetDeltaBearingRows == 0): a NULL asset would un-pair
// this scan's join, so its absence is itself asserted.
func InvariantEventSumMismatches(ctx context.Context, q Querier) ([]SumMismatch, error) {
	rows, err := q.Query(ctx, InvariantEventSumSQL)
	if err != nil {
		return nil, fmt.Errorf("scan 2 (event sums vs balances): %w", err)
	}
	defer rows.Close()
	var out []SumMismatch
	for rows.Next() {
		var m SumMismatch
		if err := rows.Scan(&m.Engine, &m.Account, &m.Asset, &m.Side, &m.EventSum, &m.Balance); err != nil {
			return nil, fmt.Errorf("scan 2 row: %w", err)
		}
		out = append(out, m)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("scan 2 iterate: %w", err)
	}
	return out, nil
}

// IndexRegression is one scan-3 (or advisory sibling) row: an index that
// moved backwards between consecutive observed blocks.
type IndexRegression struct {
	Engine      string
	AssetHex    string
	Kind        string // "borrow_index" for scan 3; the observed kind for the advisory scan
	BlockNumber uint64
	Value       string
	PrevValue   string
}

// InvariantBorrowIndexRegressions runs scan 3 (mandated, gated).
func InvariantBorrowIndexRegressions(ctx context.Context, q Querier) ([]IndexRegression, error) {
	rows, err := q.Query(ctx, InvariantBorrowIndexSQL)
	if err != nil {
		return nil, fmt.Errorf("scan 3 (borrow_index monotonicity): %w", err)
	}
	defer rows.Close()
	var out []IndexRegression
	for rows.Next() {
		var r IndexRegression
		if err := rows.Scan(&r.Engine, &r.AssetHex, &r.BlockNumber, &r.Value, &r.PrevValue); err != nil {
			return nil, fmt.Errorf("scan 3 row: %w", err)
		}
		r.Kind = "borrow_index"
		out = append(out, r)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("scan 3 iterate: %w", err)
	}
	return out, nil
}

// InvariantAaveIndexRegressions runs the ADVISORY Aave-kind sibling scan
// (reported, never gated).
func InvariantAaveIndexRegressions(ctx context.Context, q Querier) ([]IndexRegression, error) {
	rows, err := q.Query(ctx, InvariantAaveIndexSQL)
	if err != nil {
		return nil, fmt.Errorf("advisory aave index scan: %w", err)
	}
	defer rows.Close()
	var out []IndexRegression
	for rows.Next() {
		var r IndexRegression
		if err := rows.Scan(&r.Engine, &r.AssetHex, &r.Kind, &r.BlockNumber, &r.Value, &r.PrevValue); err != nil {
			return nil, fmt.Errorf("advisory scan row: %w", err)
		}
		out = append(out, r)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("advisory scan iterate: %w", err)
	}
	return out, nil
}

// EventLogOrphan is one scan-4 row: a derived event with no raw log.
type EventLogOrphan struct {
	ChainID     int64
	TxHashHex   string
	LogIndex    int32
	Engine      string
	EventType   string
	BlockNumber uint64
}

// InvariantEventLogOrphans runs scan 4 (gated; risk-quant F5.1).
func InvariantEventLogOrphans(ctx context.Context, q Querier) ([]EventLogOrphan, error) {
	rows, err := q.Query(ctx, InvariantEventLogOrphanSQL)
	if err != nil {
		return nil, fmt.Errorf("scan 4 (event→log referential integrity): %w", err)
	}
	defer rows.Close()
	var out []EventLogOrphan
	for rows.Next() {
		var o EventLogOrphan
		if err := rows.Scan(&o.ChainID, &o.TxHashHex, &o.LogIndex, &o.Engine, &o.EventType, &o.BlockNumber); err != nil {
			return nil, fmt.Errorf("scan 4 row: %w", err)
		}
		out = append(out, o)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("scan 4 iterate: %w", err)
	}
	return out, nil
}

// IIUCoverageGap is one scan-5 row: a DM debt-mutating block with no
// same-block borrow_index observation for its token.
type IIUCoverageGap struct {
	BlockNumber uint64
	AssetHex    string
	EventType   string
}

// InvariantIIUCoverageGaps runs scan 5 (gated; risk-quant F5.2).
func InvariantIIUCoverageGaps(ctx context.Context, q Querier) ([]IIUCoverageGap, error) {
	rows, err := q.Query(ctx, InvariantIIUCoverageSQL)
	if err != nil {
		return nil, fmt.Errorf("scan 5 (same-block IIU coverage): %w", err)
	}
	defer rows.Close()
	var out []IIUCoverageGap
	for rows.Next() {
		var g IIUCoverageGap
		if err := rows.Scan(&g.BlockNumber, &g.AssetHex, &g.EventType); err != nil {
			return nil, fmt.Errorf("scan 5 row: %w", err)
		}
		out = append(out, g)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("scan 5 iterate: %w", err)
	}
	return out, nil
}

// InvariantDataVerdict is RequireDataVerdict's decision for an evidence test
// observing an empty population.
type InvariantDataVerdict int

const (
	// VerdictRun: population present — run the scan and assert zero rows.
	VerdictRun InvariantDataVerdict = iota
	// VerdictSkip: population empty and SOLVENT_INVARIANT_REQUIRE_DATA is
	// unset — skip WITH the counts printed (a dev pointing at an empty DB).
	VerdictSkip
	// VerdictFail: population empty and SOLVENT_INVARIANT_REQUIRE_DATA=1 —
	// the evidence run demanded data, so an empty table is a FAILURE, not a
	// skip: the receipt command sets the variable exactly so the evidence
	// run cannot vacuously pass against an empty or wrong database (brief
	// §6, pre-empted finding 7).
	VerdictFail
)

// RequireDataVerdict decides what an evidence test does about an empty
// population. Extracted as a pure function so the escalation is directly
// unit-testable and mutation-killable (mutation target 7: "REQUIRE_DATA
// escalation removed — skip becomes pass").
func RequireDataVerdict(populationCount int64, requireData bool) InvariantDataVerdict {
	if populationCount > 0 {
		return VerdictRun
	}
	if requireData {
		return VerdictFail
	}
	return VerdictSkip
}
