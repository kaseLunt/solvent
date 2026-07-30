package store

// Risk materialization (P3 Task 5): the read surface `cmd/riskd` takes its
// repeatable-read snapshot through, and the write surface it commits a batch
// with. Migration 00013 owns the tables.
//
// EVERY PUBLIC HERE IS ADDITIVE. Nothing in this file changes an existing
// signature or an existing table, per the frozen-signatures law.
//
// TWO SHAPES, AND THE SPLIT IS DELIBERATE:
//
//   - the READ side takes a `Querier`, never a *Store, exactly as
//     reconcile.go's readers do — the CALLER owns the transactional scope, and
//     riskd's scope is one `REPEATABLE READ, READ ONLY` transaction per pass
//     (chain-truth R1). A reader that opened its own connection would defeat
//     the whole point: the watermark vector and the substrate it gates must
//     come from ONE database snapshot, or the gate judges a state the
//     computation did not use.
//   - the WRITE side is a *Store method, because it is one transaction with a
//     fixed shape (batch + every child row + retention prune) and no caller has
//     a legitimate reason to split it (chain-truth R6.5: half-written batches
//     are unservable).
//
// WHAT THIS FILE DOES NOT DO: it does not import internal/risk, and it must not
// start. Storage holds decimal integers in the emitting protocol's own
// denominators; the conversion to risk's types, the per-field param fold and
// the unit-convention checks live in internal/riskfeed, one layer up, where the
// per-engine denominator is already known. A store that spoke risk's types
// would have to pick a convention, and picking is the 1e16 error param_history
// was designed to make impossible.

import (
	"context"
	"encoding/hex"
	"errors"
	"fmt"
	"math/big"
	"sync"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

// ---------------------------------------------------------------------------
// Errors.
// ---------------------------------------------------------------------------

var (
	// ErrRiskBatchIncomplete is returned by WriteRiskBatch when the caller's
	// declared position set and its child rows disagree — a batch that would be
	// unservable the moment it landed. Refusing at write time turns a
	// permanently-skipped batch into a loud failure.
	ErrRiskBatchIncomplete = errors.New("risk batch refused: child rows do not match the declared positions")
	// ErrRiskRetentionInvalid rejects a non-positive retention. A zero would
	// delete every batch inside the transaction that just wrote one.
	ErrRiskRetentionInvalid = errors.New("risk batch refused: retention must be positive")
)

// ---------------------------------------------------------------------------
// Read side — the RR snapshot.
// ---------------------------------------------------------------------------

// RiskPriceKey names ONE price witness a risk pass intends to consume:
// a (chain, asset, source) triple, which with the newest-valid-row rule is
// exactly `LatestUsablePrice`'s identity.
//
// THE CALLER NAMES THE SOURCES, AND THAT IS THE POINT. The Aave valuation may
// consume only adapter-output/engine-exact rows: the P2 feed stream is
// deliberately UNCAPPED, so valuing Aave collateral from it goes wrong exactly
// when a cap binds (design spec §7, Codex round 1 [H4]). internal/risk refuses
// such a row on provenance, but a refusal at the far end of the pipeline still
// means the query fetched it and something had to remember not to use it. Here
// the uncapped rows are never SELECTED at all — the exclusion is in the
// predicate, not in a downstream convention.
type RiskPriceKey struct {
	ChainID uint64
	Asset   []byte
	Source  string
}

// RiskSnapshotSpec is what one pass intends to read. Every bound is explicit
// because the snapshot is the unit of coherence: an engine read at a block the
// caller did not gate is a number with no custody behind it.
type RiskSnapshotSpec struct {
	// PositionEngines are the engines whose position_balances and
	// snapshot_sweeps rows are truth for this pass.
	PositionEngines []string
	// SweptEngines are the engines whose collateral comes from the snapshot
	// sweep, and therefore the engines whose sweep AGGREGATE is part of the
	// watermark vector. Defaults to PositionEngines when empty.
	//
	// It is separate from PositionEngines because not every position engine has
	// a sweep — Aave collateral is event-derived — and an all-zero aggregate row
	// for an engine with no sweeper is not the same statement as "no sweeper".
	// The daemon must pass the SAME set here that it passes to
	// RiskSweepStateFor for its cheap poll, or the vector it gates on and the
	// vector it re-reads inside the snapshot will differ in length and the
	// drift assertion will (correctly) fire.
	SweptEngines []string
	// IndexBounds caps each engine's rate_indexes read at that engine's own
	// derive cursor. An index above the cursor describes a block the engine has
	// not claimed custody of.
	IndexBounds map[string]uint64
	// DMParamBlock bounds the Debt Manager param read (its OP cursor), and
	// AaveParamEngine/AaveParamBlock the Aave one (its ETH cursor). Params
	// key on (block_number, log_index) per chain and join per engine —
	// never date-effective, never cross-chain by timestamp (chain-truth R3).
	DMParamBlock uint64
	// AaveParamEngine is the param-deriver engine name ("aave_param"); empty
	// skips the Aave param read entirely.
	AaveParamEngine string
	AaveParamChain  uint64
	AaveParamBlock  uint64
	// Prices are the exact witnesses to fetch. An empty set fetches none.
	Prices []RiskPriceKey
}

// RiskBalanceRow is one position_balances row, with the source and update block
// a freshness judgement needs.
type RiskBalanceRow struct {
	Engine       string
	Account      []byte
	Asset        []byte
	Side         string
	Source       string
	Amount       *big.Int
	UpdatedBlock uint64
}

// RiskRateIndexRow is the newest rate_indexes value of one kind for one asset,
// at or below its engine's derive cursor, WITH the block it was observed at.
//
// The block is not decoration. rate_indexes rows exist only where
// ReserveDataUpdated fired, so an index can trail the cursor by a long way, and
// a current balances watermark sitting over an old index hides the debt leg's
// true shelf life (Codex round 1 [H5]). There is no timestamp because this
// database holds no block headers; the block IS the as-of, and inventing a time
// from insertion would be the fabricated-freshness class migration 00012 closed.
type RiskRateIndexRow struct {
	Engine string
	Asset  []byte
	Kind   string
	Value  *big.Int
	Block  uint64
}

// RiskSweepRow is one snapshot_sweeps row: the THREE-STATE disambiguation
// migration 00003 exists for. Absence of a row means NEVER ATTEMPTED, which is
// a different fact from a failed attempt and from a successful sweep that found
// nothing — and collapsing any of the three into "no collateral" is a false
// liquidation alarm (chain-truth R6.4).
type RiskSweepRow struct {
	Engine           string
	Account          []byte
	Status           string
	LastAttemptBlock uint64
	LastSuccessBlock uint64
	Generation       uint64
	Attempts         uint32
	UpdatedAt        time.Time
}

// RiskSweepWatermark is one engine's DURABLE sweep state, aggregated — the
// recompute trigger's sweep leg and the batch's sweep stamp.
//
// # Why the derive cursors are not sufficient
//
// `ApplySweepBatch` writes `snapshot_sweeps` and the snapshot-sourced
// `position_balances` rows, and moves NO derive cursor and NO reorg epoch. Debt
// Manager collateral is exactly those rows. So a trigger watching only cursors is
// blind to both directions that matter:
//
//   - a first SUCCESSFUL sweep leaves a published `SWEEP_NEVER` refusal standing
//     even though the account's collateral is now known;
//   - a FAILED sweep after a prior success leaves the previously published,
//     UNFLAGGED result standing with no staleness disclosure on it.
//
// Either could persist until some unrelated cursor happened to move — up to a
// full poll cadence of published wrongness, or indefinitely on a quiet chain.
//
// # Why these four aggregates
//
// The key has to change on every transition an operator would care about, while
// staying a fixed-size read:
//
//   - Rows — a first-ever attempt creates a row (0 → 1), which is the
//     never-swept → swept transition.
//   - Failed — a success→failure or failure→success flip moves this even when no
//     block and no row count changed.
//   - SuccessSum — the SUM (not MAX) of `last_success_block`, so a lagging
//     account catching up behind an already-higher peer still moves the key; a
//     MAX would silently miss it.
//   - MaxUpdatedAt — the database's own stamp on the most recent write, which
//     catches a re-attempt that changed nothing else.
//
// Generation/GenerationOpen come from `sweep_generations` and additionally
// distinguish "a sweep pass is in flight" from "the pass completed", which is
// what a freshness disclosure needs.
type RiskSweepWatermark struct {
	Engine         string
	Rows           int64
	Failed         int64
	SuccessSum     *big.Int
	MaxUpdatedAt   time.Time
	HasUpdatedAt   bool
	Generation     uint64
	GenerationOpen bool
}

// RiskPriceRow is one usable price witness with its full disclosure, read
// through the same predicate as LatestUsablePrice: newest VALID row for the
// key, positive by migration 00005's CHECK.
//
// HasSourceAsOf false means the row carries no chain-asserted as-of. It is NOT
// a licence to substitute ObservedAt, which is database insertion time and
// backfill-contaminated; the consumer must treat it as a MISSING INPUT (design
// spec §7, G1).
type RiskPriceRow struct {
	ChainID       uint64
	Asset         []byte
	Source        string
	Value         *big.Int
	Decimals      int32
	BlockNumber   uint64
	ObservedAt    time.Time
	HasSourceAsOf bool
	SourceAsOf    time.Time
}

// RiskInputs is everything one pass read inside its snapshot.
//
// Cursors and MaxEpochs are re-read HERE, inside the same transaction the
// caller already gated on, so the batch is stamped with the vector it was
// judged against rather than with a second, later read. riskd asserts the two
// agree — under one repeatable-read snapshot they must, and proving it is
// cheaper than trusting it.
type RiskInputs struct {
	Cursors   []DeriveCursorState
	MaxEpochs map[int64]int64

	Balances []RiskBalanceRow
	// BalanceConflicts names accounts holding the same (asset, side) under BOTH
	// 'event' and 'snapshot' sources. Their rows are WITHHELD from Balances: the
	// same per-account source-exclusivity posture Store.BalancesFor and
	// ReconBalancesForAccounts enforce. A conflicted account is refused, never
	// silently resolved by picking.
	//
	// IT IS A TYPED LIST, NOT A KEYED MAP, AND THE CONSUMER MUST ENUMERATE IT.
	// The first version keyed conflicts by a composite string while the assembler
	// enumerated accounts from `Balances` alone — so withholding the rows made the
	// account VANISH from the batch entirely, and the recorded conflict was never
	// visited. A disappeared position reads downstream as "no position here",
	// which is the false-safe direction and precisely the opposite of the refusal
	// the withholding was supposed to produce. Carrying engine and account as
	// FIELDS makes the conflicted set independently iterable, so the assembler can
	// seed from the union of "has rows" and "has a conflict".
	BalanceConflicts []RiskBalanceConflict

	Indexes []RiskRateIndexRow
	Sweeps  []RiskSweepRow
	// SweepState is the per-engine DURABLE AGGREGATE of the sweep tables — the
	// recompute trigger's sweep leg. See RiskSweepWatermark for why the cursor
	// pair alone is not enough.
	SweepState []RiskSweepWatermark
	// AaveParams and DMParams are LEDGER PREFIXES in (block, log_index) order,
	// not folded views. The fold is last-non-nil PER FIELD and lives in
	// internal/riskfeed — see ParamsAsOf's doc comment for why a last-row-wins
	// fold would mask a live liquidation threshold with a registry row.
	AaveParams []ParamRow
	DMParams   []ParamRow

	Prices []RiskPriceRow

	// ReadAt is the DATABASE clock inside the snapshot. Every age riskd judges
	// is measured against this, never against a process clock (chain-truth
	// R4.1).
	ReadAt time.Time
}

// ---------------------------------------------------------------------------
// Single-writer enforcement for the materializer.
// ---------------------------------------------------------------------------

// The advisory-lock coordinates for the risk materializer role.
//
// pg_advisory_lock's two-int form takes a (classid, objid) pair, which is used
// here as a NAMESPACE plus a ROLE so the numbers are readable rather than magic:
//
//	classid 0x536F6C76 = ASCII "Solv"  — this repo's advisory-lock namespace
//	objid   1                          — the risk materializer
//
// The key is spelled out here, in the code that takes it, because a lock constant
// that lives only in a migration comment is a constant nobody checks against the
// caller.
const (
	riskLockNamespace    int32 = 0x536F6C76 // "Solv"
	riskLockMaterializer int32 = 1
)

// ErrRiskMaterializerLocked is returned when another process already holds the
// materializer lock.
var ErrRiskMaterializerLocked = errors.New("risk materializer lock is already held by another process")

// AcquireRiskMaterializerLock takes the session-scoped advisory lock that makes
// riskd a structural single writer, and returns the release function.
//
// # Why a lock at all, when the key is already deterministic
//
// The deterministic materialization key is what makes CORRECTNESS independent of
// how many processes run: two instances computing the same materialization collide
// and the second adopts. The lock is the complementary statement — concurrent
// honest instances are EXCLUDED rather than merely handled — so the wasted work,
// the duplicated NOTIFY doorbells, and the interleaved retention pruning do not
// happen either. It is defence in depth, and the key remains the guarantee.
//
// # What it does NOT promise, stated plainly
//
// The lock is SESSION-scoped: it lives on the connection this call holds and is
// released automatically if that connection drops. A network partition can
// therefore let a second instance acquire while the first still believes it holds
// — the standard limitation of advisory locks used as leases, and the reason the
// deterministic key rather than this lock is where correctness rests.
//
// The returned release closes over the held connection and must be called on
// shutdown; it is idempotent.
func (s *Store) AcquireRiskMaterializerLock(ctx context.Context) (release func(), err error) {
	conn, err := s.pool.Acquire(ctx)
	if err != nil {
		return nil, fmt.Errorf("acquire connection for materializer lock: %w", err)
	}
	var got bool
	if err := conn.QueryRow(ctx,
		`SELECT pg_try_advisory_lock($1, $2)`, riskLockNamespace, riskLockMaterializer).Scan(&got); err != nil {
		conn.Release()
		return nil, fmt.Errorf("take materializer advisory lock: %w", err)
	}
	if !got {
		conn.Release()
		return nil, fmt.Errorf("%w: namespace %d object %d — refusing to start a second materializer",
			ErrRiskMaterializerLocked, riskLockNamespace, riskLockMaterializer)
	}

	var once sync.Once
	return func() {
		once.Do(func() {
			// Best effort: the lock also dies with the session, so a failure to
			// unlock cleanly is not a correctness problem.
			_, _ = conn.Exec(context.Background(),
				`SELECT pg_advisory_unlock($1, $2)`, riskLockNamespace, riskLockMaterializer)
			conn.Release()
		})
	}, nil
}

// Querier exposes the store's pool as the shared read surface, so a caller
// holding a *Store can run the package's Querier-taking readers without opening
// a second connection of its own.
//
// It is READ-shaped by the interface, not by promise: `Querier` declares only
// Query and QueryRow, so nothing reached through it can write. A caller needing
// transactional scope takes BeginRiskSnapshot instead.
func (s *Store) Querier() Querier { return s.pool }

// BeginRiskSnapshot opens the transaction one risk pass reads everything
// through: `REPEATABLE READ, READ ONLY`.
//
// It exists so the isolation level has ONE home. The watermark vector and the
// substrate it gates must come from a single database snapshot — under READ
// COMMITTED each statement would get its own, which is precisely the mid-flush
// race the gate exists to close (chain-truth R1) — and a daemon that spelled the
// TxOptions itself is a daemon that can spell them wrong. READ ONLY is not
// decoration either: it is the structural half of "riskd never writes P2 state",
// enforced by the transaction as well as by the role grants in migration 00013.
//
// The caller MUST Commit or Rollback, and MUST NOT make a network call while it
// is open (round-10 M5, xmin retention). riskd satisfies the second trivially:
// it makes zero RPC calls.
func (s *Store) BeginRiskSnapshot(ctx context.Context) (pgx.Tx, error) {
	tx, err := s.pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
	if err != nil {
		return nil, fmt.Errorf("begin risk snapshot tx: %w", err)
	}
	return tx, nil
}

// RiskInputSnapshot reads the whole substrate of one risk pass through q.
//
// CALL IT INSIDE A `REPEATABLE READ, READ ONLY` TRANSACTION. Every read below
// is a separate statement, and under READ COMMITTED each would get its own
// snapshot — which is exactly the mid-flush race the design closes by holding
// one snapshot across the pass (chain-truth R1). It is sound because every P2
// producer write is a single transaction (ApplyDerivedWithRates, RewindDerived,
// ApplySweepBatch, ApplyParamEvents), so any PG snapshot is transactionally
// coherent; repeatable read only makes riskd's several statements share one.
//
// NO NETWORK MAY RUN WHILE THAT SNAPSHOT IS OPEN (round-10 M5, xmin retention).
// riskd satisfies this trivially — it makes zero RPC calls (chain-truth R6.3) —
// but the constraint belongs on this function's contract, not on a daemon's
// good behaviour.
func RiskInputSnapshot(ctx context.Context, q Querier, spec RiskSnapshotSpec) (RiskInputs, error) {
	var in RiskInputs

	if err := q.QueryRow(ctx, `SELECT now()`).Scan(&in.ReadAt); err != nil {
		return RiskInputs{}, fmt.Errorf("read snapshot clock: %w", err)
	}
	in.ReadAt = in.ReadAt.UTC()

	cursors, err := DeriveCursorStates(ctx, q)
	if err != nil {
		return RiskInputs{}, err
	}
	in.Cursors = cursors

	maxEpochs, err := MaxReorgEpochs(ctx, q)
	if err != nil {
		return RiskInputs{}, err
	}
	in.MaxEpochs = maxEpochs

	if in.Balances, in.BalanceConflicts, err = riskBalances(ctx, q, spec.PositionEngines); err != nil {
		return RiskInputs{}, err
	}
	if in.Indexes, err = riskRateIndexes(ctx, q, spec.IndexBounds); err != nil {
		return RiskInputs{}, err
	}
	if in.Sweeps, err = riskSweeps(ctx, q, spec.PositionEngines); err != nil {
		return RiskInputs{}, err
	}
	swept := spec.SweptEngines
	if len(swept) == 0 {
		swept = spec.PositionEngines
	}
	if in.SweepState, err = riskSweepState(ctx, q, swept); err != nil {
		return RiskInputs{}, err
	}
	if spec.AaveParamEngine != "" {
		if in.AaveParams, err = ParamsAsOfQ(ctx, q, spec.AaveParamEngine, spec.AaveParamChain, spec.AaveParamBlock); err != nil {
			return RiskInputs{}, err
		}
	}
	if in.DMParams, err = DMParamsAsOf(ctx, q, spec.DMParamBlock); err != nil {
		return RiskInputs{}, err
	}
	if in.Prices, err = RiskUsablePrices(ctx, q, spec.Prices); err != nil {
		return RiskInputs{}, err
	}
	return in, nil
}

// RiskBalanceConflict is one account whose balance rows were withheld because
// the same (asset, side) exists under BOTH the event- and snapshot-derived
// sources. It carries its own engine and account so a consumer can produce a
// refusal ROW for it rather than merely knowing a conflict happened.
type RiskBalanceConflict struct {
	Engine  string
	Account []byte
	Detail  string
}

func riskBalances(ctx context.Context, q Querier, engines []string) ([]RiskBalanceRow, []RiskBalanceConflict, error) {
	if len(engines) == 0 {
		return nil, nil, nil
	}
	rows, err := q.Query(ctx,
		`SELECT engine, account, asset, side, source, amount::text, updated_block
		 FROM position_balances WHERE engine = ANY($1)
		 ORDER BY engine, account, asset, side, source`, engines)
	if err != nil {
		return nil, nil, fmt.Errorf("query risk balances: %w", err)
	}
	defer rows.Close()

	var out []RiskBalanceRow
	conflictAt := map[string]RiskBalanceConflict{}
	var conflictOrder []string
	seen := map[string]string{} // engine/acct/asset/side → source
	for rows.Next() {
		var r RiskBalanceRow
		var amount string
		if err := rows.Scan(&r.Engine, &r.Account, &r.Asset, &r.Side, &r.Source, &amount, &r.UpdatedBlock); err != nil {
			return nil, nil, fmt.Errorf("scan risk balance row: %w", err)
		}
		v, ok := new(big.Int).SetString(amount, 10)
		if !ok {
			return nil, nil, fmt.Errorf("risk balance %s/%x/%x/%s: amount %q is not an integer",
				r.Engine, r.Account, r.Asset, r.Side, amount)
		}
		r.Amount = v
		acct := r.Engine + "/" + hex.EncodeToString(r.Account)
		key := acct + "/" + hex.EncodeToString(r.Asset) + "/" + r.Side
		if prev, dup := seen[key]; dup && prev != r.Source {
			if _, done := conflictAt[acct]; !done {
				conflictAt[acct] = RiskBalanceConflict{
					Engine:  r.Engine,
					Account: append([]byte(nil), r.Account...),
					Detail: fmt.Sprintf("%v: engine %q account %x asset %x side %q has both event- and snapshot-sourced rows",
						ErrBalanceSourceConflict, r.Engine, r.Account, r.Asset, r.Side),
				}
				conflictOrder = append(conflictOrder, acct)
			}
			continue
		}
		seen[key] = r.Source
		out = append(out, r)
	}
	if err := rows.Err(); err != nil {
		return nil, nil, fmt.Errorf("iterate risk balance rows: %w", err)
	}
	if len(conflictAt) == 0 {
		return out, nil, nil
	}
	kept := out[:0]
	for _, r := range out {
		if _, bad := conflictAt[r.Engine+"/"+hex.EncodeToString(r.Account)]; bad {
			continue // a conflicted account reports the conflict, never rows
		}
		kept = append(kept, r)
	}
	conflicts := make([]RiskBalanceConflict, 0, len(conflictOrder))
	for _, acct := range conflictOrder {
		conflicts = append(conflicts, conflictAt[acct])
	}
	return kept, conflicts, nil
}

func riskRateIndexes(ctx context.Context, q Querier, bounds map[string]uint64) ([]RiskRateIndexRow, error) {
	if len(bounds) == 0 {
		return nil, nil
	}
	engines := make([]string, 0, len(bounds))
	blocks := make([]int64, 0, len(bounds))
	for e, b := range bounds {
		engines = append(engines, e)
		blocks = append(blocks, int64(b))
	}
	rows, err := q.Query(ctx,
		`SELECT DISTINCT ON (r.engine, r.asset, r.kind)
		        r.engine, r.asset, r.kind, r.value::text, r.block_number
		 FROM rate_indexes r
		 JOIN unnest($1::text[], $2::bigint[]) AS b(engine, max_block) ON b.engine = r.engine
		 WHERE r.block_number <= b.max_block
		 ORDER BY r.engine, r.asset, r.kind, r.block_number DESC`, engines, blocks)
	if err != nil {
		return nil, fmt.Errorf("query risk rate indexes: %w", err)
	}
	defer rows.Close()
	var out []RiskRateIndexRow
	for rows.Next() {
		var r RiskRateIndexRow
		var value string
		if err := rows.Scan(&r.Engine, &r.Asset, &r.Kind, &value, &r.Block); err != nil {
			return nil, fmt.Errorf("scan risk rate index row: %w", err)
		}
		v, ok := new(big.Int).SetString(value, 10)
		if !ok {
			return nil, fmt.Errorf("rate index %s/%x/%s at %d: %q is not an integer", r.Engine, r.Asset, r.Kind, r.Block, value)
		}
		r.Value = v
		out = append(out, r)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate risk rate index rows: %w", err)
	}
	return out, nil
}

func riskSweeps(ctx context.Context, q Querier, engines []string) ([]RiskSweepRow, error) {
	if len(engines) == 0 {
		return nil, nil
	}
	rows, err := q.Query(ctx,
		`SELECT engine, account, status, last_attempt_block, last_success_block,
		        generation, attempts, updated_at
		 FROM snapshot_sweeps WHERE engine = ANY($1) ORDER BY engine, account`, engines)
	if err != nil {
		return nil, fmt.Errorf("query risk sweeps: %w", err)
	}
	defer rows.Close()
	var out []RiskSweepRow
	for rows.Next() {
		var r RiskSweepRow
		if err := rows.Scan(&r.Engine, &r.Account, &r.Status, &r.LastAttemptBlock,
			&r.LastSuccessBlock, &r.Generation, &r.Attempts, &r.UpdatedAt); err != nil {
			return nil, fmt.Errorf("scan risk sweep row: %w", err)
		}
		r.UpdatedAt = r.UpdatedAt.UTC()
		out = append(out, r)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate risk sweep rows: %w", err)
	}
	return out, nil
}

// RiskSweepStateFor is the exported sweep-aggregate read, so the daemon's
// cheap watermark POLL can take the sweep leg without pulling the whole
// substrate. `RiskInputSnapshot` calls the same implementation, so the poll and
// the pass cannot drift into two different notions of "the sweep moved".
//
// Call it inside the pass's snapshot transaction.
func RiskSweepStateFor(ctx context.Context, q Querier, engines []string) ([]RiskSweepWatermark, error) {
	return riskSweepState(ctx, q, engines)
}

// riskSweepState aggregates the sweep tables per engine, INSIDE the pass's
// snapshot. One row per requested engine is always returned — including an
// all-zero row for an engine that has never swept, because "no sweep has ever
// happened" is a state the trigger must be able to see CHANGE, and an absent row
// would make the first sweep look like nothing at all.
func riskSweepState(ctx context.Context, q Querier, engines []string) ([]RiskSweepWatermark, error) {
	if len(engines) == 0 {
		return nil, nil
	}
	rows, err := q.Query(ctx,
		`SELECT e.engine,
		        COALESCE(s.rows, 0), COALESCE(s.failed, 0),
		        COALESCE(s.success_sum, 0)::text, s.max_updated_at,
		        COALESCE(g.current_generation, 0),
		        (g.engine IS NOT NULL AND g.completed_at IS NULL)
		 FROM unnest($1::text[]) AS e(engine)
		 LEFT JOIN (
		     SELECT engine,
		            count(*)                                        AS rows,
		            count(*) FILTER (WHERE status <> 'success')      AS failed,
		            sum(last_success_block)                         AS success_sum,
		            max(updated_at)                                 AS max_updated_at
		     FROM snapshot_sweeps GROUP BY engine
		 ) s ON s.engine = e.engine
		 LEFT JOIN sweep_generations g ON g.engine = e.engine
		 ORDER BY e.engine`, engines)
	if err != nil {
		return nil, fmt.Errorf("query risk sweep state: %w", err)
	}
	defer rows.Close()
	var out []RiskSweepWatermark
	for rows.Next() {
		var w RiskSweepWatermark
		var sum string
		var updatedAt *time.Time
		if err := rows.Scan(&w.Engine, &w.Rows, &w.Failed, &sum, &updatedAt,
			&w.Generation, &w.GenerationOpen); err != nil {
			return nil, fmt.Errorf("scan risk sweep state: %w", err)
		}
		v, ok := new(big.Int).SetString(sum, 10)
		if !ok {
			return nil, fmt.Errorf("risk sweep state %s: success sum %q is not an integer", w.Engine, sum)
		}
		w.SuccessSum = v
		if updatedAt != nil {
			w.HasUpdatedAt, w.MaxUpdatedAt = true, updatedAt.UTC()
		}
		out = append(out, w)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate risk sweep state: %w", err)
	}
	return out, nil
}

// RiskUsablePrices reads the newest VALID row for each requested key, through
// the SAME predicate as LatestUsablePrice — `valid` plus newest block — so the
// batch path and the single-key path cannot drift apart into two answers.
//
// Keys with no usable row are simply ABSENT from the result. That is not a
// silent drop: the caller holds the key set it asked for, and an asset whose
// price is missing must be recorded as a missing input on the position that
// needed it (design spec §7 G1, "never silently drop an unpriced asset").
func RiskUsablePrices(ctx context.Context, q Querier, keys []RiskPriceKey) ([]RiskPriceRow, error) {
	if len(keys) == 0 {
		return nil, nil
	}
	chains := make([]int64, len(keys))
	assets := make([][]byte, len(keys))
	sources := make([]string, len(keys))
	for i, k := range keys {
		chains[i] = int64(k.ChainID)
		assets[i] = k.Asset
		sources[i] = k.Source
	}
	rows, err := q.Query(ctx,
		`SELECT DISTINCT ON (p.chain_id, p.asset, p.source)
		        p.chain_id, p.asset, p.source, p.price::text, p.price_decimals,
		        p.block_number, p.observed_at, p.source_as_of
		 FROM prices p
		 JOIN unnest($1::bigint[], $2::bytea[], $3::text[]) AS k(chain_id, asset, source)
		   ON k.chain_id = p.chain_id AND k.asset = p.asset AND k.source = p.source
		 WHERE p.valid
		 ORDER BY p.chain_id, p.asset, p.source, p.block_number DESC`,
		chains, assets, sources)
	if err != nil {
		return nil, fmt.Errorf("query risk usable prices: %w", err)
	}
	defer rows.Close()
	var out []RiskPriceRow
	for rows.Next() {
		var r RiskPriceRow
		var priceText string
		var asOf *time.Time
		if err := rows.Scan(&r.ChainID, &r.Asset, &r.Source, &priceText, &r.Decimals,
			&r.BlockNumber, &r.ObservedAt, &asOf); err != nil {
			return nil, fmt.Errorf("scan risk price row: %w", err)
		}
		v, ok := new(big.Int).SetString(priceText, 10)
		if !ok {
			return nil, fmt.Errorf("risk price %s/%x (chain %d): %q is not an integer", r.Source, r.Asset, r.ChainID, priceText)
		}
		// Defence in depth, exactly as LatestUsablePrice keeps: the SQL
		// predicate and migration 00005's CHECK both already exclude this, so
		// reaching it means the schema was altered out from under the contract.
		if v.Sign() <= 0 {
			return nil, fmt.Errorf("risk price %s/%x (chain %d) is %s: the validity gate has been defeated, refusing to return it",
				r.Source, r.Asset, r.ChainID, v)
		}
		r.Value = v
		r.ObservedAt = r.ObservedAt.UTC()
		if asOf != nil {
			r.HasSourceAsOf, r.SourceAsOf = true, asOf.UTC()
		}
		out = append(out, r)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate risk price rows: %w", err)
	}
	return out, nil
}

// ParamsAsOfQ is the Querier-taking twin of Store.ParamsAsOf, so a risk pass can
// read the param ledger INSIDE its own snapshot rather than through the pool on
// a second one. The query, the ordering and the ledger-not-a-view contract are
// identical — see ParamsAsOf for why the fold is not performed here.
func ParamsAsOfQ(ctx context.Context, q Querier, engine string, chainID uint64, block uint64) ([]ParamRow, error) {
	rows, err := q.Query(ctx, `SELECT engine, chain_id, asset, ltv::text, liq_threshold::text, liq_bonus::text,
		emode_category, atoken, variable_debt_token, strategy,
		effective_block, effective_log_index, source_event, tx_hash
		FROM param_history
		WHERE engine = $1 AND chain_id = $2 AND effective_block <= $3
		ORDER BY effective_block, effective_log_index`, engine, chainID, block)
	if err != nil {
		return nil, fmt.Errorf("query params as of %d for %q: %w", block, engine, err)
	}
	defer rows.Close()
	return scanParamRows(rows, engine, block)
}

func scanParamRows(rows pgx.Rows, engine string, block uint64) ([]ParamRow, error) {
	var out []ParamRow
	for rows.Next() {
		var r ParamRow
		var ltv, lt, bonus *string
		var emode *int16
		var blockNumber int64
		var logIdx int32
		if err := rows.Scan(&r.Engine, &r.ChainID, &r.Asset, &ltv, &lt, &bonus,
			&emode, &r.AToken, &r.VariableDebtToken, &r.Strategy,
			&blockNumber, &logIdx, &r.SourceEvent, &r.TxHash); err != nil {
			return nil, fmt.Errorf("scan param row: %w", err)
		}
		for _, f := range []struct {
			text **string
			dst  **big.Int
			name string
		}{{&ltv, &r.LTV, "ltv"}, {&lt, &r.LiqThreshold, "liq_threshold"}, {&bonus, &r.LiqBonus, "liq_bonus"}} {
			if *f.text == nil {
				continue
			}
			v, ok := new(big.Int).SetString(**f.text, 10)
			if !ok {
				return nil, fmt.Errorf("parse %s %q: not an integer", f.name, **f.text)
			}
			*f.dst = v
		}
		if emode != nil {
			if *emode < 0 || *emode > 255 {
				return nil, fmt.Errorf("emode_category %d is outside uint8", *emode)
			}
			c := uint8(*emode)
			r.EModeCategory = &c
		}
		r.EffectiveBlock = uint64(blockNumber)
		r.EffectiveLogIndex = uint32(logIdx)
		out = append(out, r)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate params as of %d for %q: %w", block, engine, err)
	}
	return out, nil
}

// DMParamsAsOf returns the Debt Manager's risk-parameter ledger prefix as of
// block, in the SAME ParamRow shape param_history uses, built from the
// record-only `position_events` rows the DM deriver has persisted since genesis.
//
// ZERO NEW RPC, AND ZERO NEW CUSTODY (chain-truth R3). The DM's param history is
// already in custody: the walker's getLogs filter is address-only, so raw_logs
// holds every log the contract emitted, and the deriver already writes
// `collateral_token_config_set` events carrying ltv / liquidation_threshold /
// liquidation_bonus in their payload. Re-fetching those from an archive node at
// historical blocks would be re-buying what the custody chain already holds —
// the blocking anti-pattern the consult named.
//
// DENOMINATORS ARE RAW: the Debt Manager's ratios use HUNDRED_PERCENT = 100e18,
// and the returned rows are tagged Engine = "debt_manager" so nothing can route
// them to a surface expecting Aave basis points. The two conventions differ by
// 1e16 and the engine tag is the only evidence of which one a row carries.
//
// # Removal is a discontinuity, and it removes the row
//
// `CollateralTokenRemoved` is not a parameter change; it is the token leaving
// the engine's valuation entirely — the lens omits it and `convert` reverts
// (design spec §8). A token whose LAST lifecycle event is a removal therefore
// yields NO param row, so a position still holding it REFUSES on a missing
// liquidation threshold instead of being valued at the threshold it had before
// it was delisted. Valuing it would count collateral the engine does not count:
// an overstated health factor, which is the false-safety direction. A later
// `CollateralTokenAdded` re-opens the token, and its config rows are read
// normally from there.
func DMParamsAsOf(ctx context.Context, q Querier, block uint64) ([]ParamRow, error) {
	const dmEngine = "debt_manager"
	rows, err := q.Query(ctx,
		`SELECT chain_id, asset, event_type, block_number, log_index, tx_hash,
		        payload->>'ltv', payload->>'liquidation_threshold', payload->>'liquidation_bonus'
		 FROM position_events
		 WHERE engine = $1 AND block_number <= $2
		   AND event_type IN ('collateral_token_config_set', 'collateral_token_removed', 'collateral_token_added')
		 ORDER BY block_number, log_index, seq`, dmEngine, block)
	if err != nil {
		return nil, fmt.Errorf("query dm params as of %d: %w", block, err)
	}
	defer rows.Close()

	type entry struct {
		row     ParamRow
		removed bool
		present bool
	}
	byAsset := map[string]*entry{}
	var order []string

	for rows.Next() {
		var chainID uint64
		var asset, txHash []byte
		var eventType string
		var blockNumber uint64
		var logIndex int32
		var ltv, lt, bonus *string
		if err := rows.Scan(&chainID, &asset, &eventType, &blockNumber, &logIndex, &txHash,
			&ltv, &lt, &bonus); err != nil {
			return nil, fmt.Errorf("scan dm param event: %w", err)
		}
		key := hex.EncodeToString(asset)
		e, ok := byAsset[key]
		if !ok {
			e = &entry{}
			byAsset[key] = e
			order = append(order, key)
		}
		switch eventType {
		case "collateral_token_removed":
			e.removed = true
			continue
		case "collateral_token_added":
			e.removed = false
			continue
		}
		// collateral_token_config_set — a full tuple every time (unlike Aave's
		// per-field events), but parsed field-by-field so a payload missing a
		// key is absent rather than zero.
		r := ParamRow{
			Engine:            dmEngine,
			ChainID:           chainID,
			Asset:             asset,
			EffectiveBlock:    blockNumber,
			EffectiveLogIndex: uint32(logIndex),
			SourceEvent:       eventType,
			TxHash:            txHash,
		}
		for _, f := range []struct {
			text *string
			dst  **big.Int
			name string
		}{{ltv, &r.LTV, "ltv"}, {lt, &r.LiqThreshold, "liquidation_threshold"}, {bonus, &r.LiqBonus, "liquidation_bonus"}} {
			if f.text == nil {
				continue
			}
			v, ok := new(big.Int).SetString(*f.text, 10)
			if !ok {
				return nil, fmt.Errorf("dm param %x at %d/%d: %s %q is not an integer", asset, blockNumber, logIndex, f.name, *f.text)
			}
			*f.dst = v
		}
		e.row = r
		e.present = true
		e.removed = false
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate dm param events as of %d: %w", block, err)
	}

	var out []ParamRow
	for _, key := range order {
		e := byAsset[key]
		if !e.present || e.removed {
			continue
		}
		out = append(out, e.row)
	}
	// The caller folds a (block, log_index)-ordered ledger; keep the contract.
	sortParamRows(out)
	return out, nil
}

func sortParamRows(rows []ParamRow) {
	for i := 1; i < len(rows); i++ {
		for j := i; j > 0; j-- {
			a, b := rows[j-1], rows[j]
			if a.EffectiveBlock < b.EffectiveBlock ||
				(a.EffectiveBlock == b.EffectiveBlock && a.EffectiveLogIndex <= b.EffectiveLogIndex) {
				break
			}
			rows[j-1], rows[j] = b, a
		}
	}
}

// ---------------------------------------------------------------------------
// Write side — one batch, one transaction.
// ---------------------------------------------------------------------------

// RiskBatchWatermark is one engine's stamp: the (last_block, acked_epoch) pair
// the batch computed from, plus its chain's max epoch at compute time.
type RiskBatchWatermark struct {
	Engine            string
	ChainID           int64
	LastBlock         uint64
	AckedEpoch        int64
	MaxEpochAtCompute int64
	// Sweep is the engine's sweep state at compute time, set only for engines
	// that actually have a collateral sweep. Absence stays distinguishable from
	// "zero rows": nil means this engine has no sweep, not that its sweep is
	// empty.
	Sweep *RiskSweepWatermark
}

// RiskPositionWrite is one account's verdict. Engine-specific fields are
// pointers so "not applicable on this engine" and "zero" stay distinguishable —
// a Debt Manager row has no TotalCollateralBase, and writing 0 would be a
// number a reader could take for a fact.
type RiskPositionWrite struct {
	Engine        string
	Account       []byte
	Status        string
	RefusalCode   string
	RefusalDetail string
	RefusalAsset  []byte
	Flags         []string

	ValueDecimals uint8

	HFNum      *big.Int
	HFDen      *big.Int
	HFWad      *big.Int
	HFInfinite bool

	TotalCollateralBase *big.Int
	TotalDebtBase       *big.Int
	WeightedLTSum       *big.Int
	AvgLTBps            *big.Int

	CollateralValueUSD *big.Int
	MaxBorrowLT        *big.Int
	Borrowings         *big.Int
	Liquidatable       *bool

	BalancesBlock uint64
	ParamsBlock   uint64
	SweepBlock    uint64

	OldestPriceInput *time.Time
	StalePriceInputs bool

	Legs   []RiskLegWrite
	Prices []RiskPriceInputWrite
}

// RiskLegWrite is one asset's contribution to a position, carrying that
// reserve's OWN rate-index as-of blocks.
type RiskLegWrite struct {
	Asset    []byte
	Decimals uint8

	ScaledDebt           *big.Int
	ScaledCollateral     *big.Int
	LiveDebt             *big.Int
	LiveCollateral       *big.Int
	DebtBase             *big.Int
	CollateralBase       *big.Int
	WeightedLT           *big.Int
	UsedAsCollateral     *bool
	DebtIndexBlock       *uint64
	CollateralIndexBlock *uint64

	Amount                *big.Int
	ValueUSD              *big.Int
	MaxBorrowContribution *big.Int

	LiqThreshold *big.Int
	LiqBonus     *big.Int
}

// RiskPriceInputWrite is the FULL snapshot of one price input, copied into the
// batch. It is never an identity reference — see migration 00013's comment and
// design spec §7 (Codex round 1 [H6]).
//
// Value nil with Verdict "missing" is how an unpriced asset is recorded; the
// asset is still named on the position that refused because of it.
type RiskPriceInputWrite struct {
	Asset      []byte
	ChainID    uint64
	Source     string
	Provenance string

	Value       *big.Int
	Decimals    *int16
	BlockNumber *uint64
	SourceAsOf  *time.Time

	BudgetSeconds int64
	Verdict       string
	AgeSeconds    *int64
}

// RiskEngineAggregate is one engine's rollup for a batch, in that engine's own
// scale. The two engines are never summed together (spec §5.2).
type RiskEngineAggregate struct {
	Engine        string
	ValueDecimals uint8

	Positions             int
	ComputedPositions     int
	RefusedPositions      int
	FlaggedPositions      int
	LiquidatablePositions int

	TotalCollateral *big.Int
	TotalDebt       *big.Int
}

// RiskBatchWrite is one complete pass, ready to commit.
type RiskBatchWrite struct {
	Producer   string
	Watermarks []RiskBatchWatermark
	Positions  []RiskPositionWrite
	Aggregates []RiskEngineAggregate
	// RequiredEngines are the engines whose stamps MUST be present for the batch
	// to be servable. Persisted so NewestCompleteBatch can check the stamp SET
	// rather than merely that some stamp exists — supersession is judged per
	// engine, so a batch missing one engine's pair cannot be judged for it.
	// Defaults to the engines in Watermarks when empty.
	RequiredEngines []string
	// MaterializationKey identifies WHAT IS BEING MATERIALIZED — deterministically,
	// so that ANY honest process computing the same thing derives the same key.
	// Required.
	//
	// A per-attempt key is not sufficient, and assuming otherwise was the earlier
	// mistake: it only covers a lost commit acknowledgement whose reconciliation
	// lookup then succeeds. A reconciliation that fails on the same network event,
	// a restart, or a second instance each re-read the committed post-move price
	// as their baseline, mint a fresh key, and write an UNFLAGGED DUPLICATE. With
	// a deterministic key the second computation collides with the first and
	// ADOPTS it, so the duplicate cannot be created at all.
	//
	// Build it with riskfeed.ComputeMaterializationIdentity.
	MaterializationKey string
	// MaterializationVector and SubstrateDigest are the identity BEHIND the key,
	// persisted so adoption can be VERIFIED. A key that matches while the identity
	// differs is a refusal, never a silent adoption — the same
	// refuse-don't-pick discipline the divergent-replay guards use.
	MaterializationVector string
	SubstrateDigest       string
	// RequiredSweepEngines are the engines whose watermark row MUST carry a
	// complete sweep disclosure. Without recording this, a restored batch could
	// omit the Debt Manager's sweep payload entirely and still satisfy every
	// count and required-engine check, leaving a swept engine indistinguishable
	// from one with no sweeper. Defaults to the engines whose stamps carry a
	// non-nil Sweep.
	RequiredSweepEngines []string
	// Retention keeps the newest N batches; older ones and their children are
	// deleted in the SAME transaction (plan Task 5: SOLVENT_RISK_RETENTION,
	// default 5000). Pruning outside the write would leave a window in which
	// the table is unbounded, and a separate transaction is a second failure
	// mode for a housekeeping job that has no reason to have one.
	Retention int
	// Notify, when non-empty, is the channel a `pg_notify` fires on at commit.
	//
	// IT IS ISSUED INSIDE THE TRANSACTION, WHICH IS WHAT "POST-COMMIT" MEANS
	// HERE: PostgreSQL queues NOTIFY and delivers it at COMMIT, so a notify
	// enqueued in this transaction fires if and only if the batch landed. The
	// alternative — a separate statement after Commit returns — has a real
	// window where the batch exists and the doorbell was never rung. Either way
	// it is a DOORBELL ONLY: the payload is the batch id, `cmd/api` re-reads
	// the tables, and no listener may parse state out of it (chain-truth R1).
	Notify string
}

// WriteRiskBatch commits one batch and every child row in ONE transaction, then
// prunes to the retention bound inside the same transaction.
//
// HALF-WRITTEN BATCHES MUST BE UNSERVABLE (chain-truth R6.5), and this function
// makes that true twice over. The children are inserted first against an id
// reserved from the sequence, and the `risk_batches` row lands LAST — so a
// visible batch id already has its children by write order. Independently,
// `NewestCompleteBatch` verifies the actual child count against the declared
// `position_count` and requires the watermark stamps to exist, which catches a
// torn state this function could not have produced (a hand-written row, a
// partially restored dump).
//
// The declared/actual disagreement is ALSO refused here, before the write: a
// caller whose positions and count disagree would otherwise commit a batch that
// can never be served, and a permanently-invisible batch is a silent failure.
func (s *Store) WriteRiskBatch(ctx context.Context, w RiskBatchWrite) (int64, error) {
	if w.Retention <= 0 {
		return 0, fmt.Errorf("%w: got %d", ErrRiskRetentionInvalid, w.Retention)
	}
	if len(w.Watermarks) == 0 {
		return 0, fmt.Errorf("%w: a batch with no watermark stamps cannot be checked for supersession", ErrRiskBatchIncomplete)
	}
	if w.MaterializationKey == "" {
		return 0, fmt.Errorf("%w: a materialization key is required — without one an ambiguous commit cannot be reconciled and a retry silently double-writes the batch", ErrRiskBatchIncomplete)
	}

	// ADOPT BEFORE WRITING. The key is deterministic in the materialization, so a
	// pre-flight lookup catches the restart and second-instance cases without
	// waiting for a constraint violation — and, more importantly, without doing
	// the work twice. The verification inside adoptRiskBatch is what keeps this
	// from being a silent shortcut.
	if id, adopted, err := s.adoptRiskBatch(ctx, w); err != nil {
		return 0, err
	} else if adopted {
		return id, nil
	}

	// The sweep-disclosure requirement defaults to the engines actually carrying
	// one, so a producer cannot forget to declare what it just stamped.
	requiredSweep := w.RequiredSweepEngines
	if requiredSweep == nil {
		for _, m := range w.Watermarks {
			if m.Sweep != nil {
				requiredSweep = append(requiredSweep, m.Engine)
			}
		}
	}
	sweepStamped := map[string]bool{}
	for _, m := range w.Watermarks {
		if m.Sweep != nil {
			sweepStamped[m.Engine] = true
		}
	}
	for _, e := range requiredSweep {
		if !sweepStamped[e] {
			return 0, fmt.Errorf("%w: engine %q requires a sweep disclosure but its stamp carries none", ErrRiskBatchIncomplete, e)
		}
	}
	// The required stamp set defaults to what is actually being stamped; an
	// explicit set that names an unstamped engine is a caller bug, refused here
	// rather than producing a batch that can never be served.
	required := w.RequiredEngines
	if len(required) == 0 {
		for _, m := range w.Watermarks {
			required = append(required, m.Engine)
		}
	}
	stamped := map[string]bool{}
	for _, m := range w.Watermarks {
		stamped[m.Engine] = true
	}
	for _, e := range required {
		if !stamped[e] {
			return 0, fmt.Errorf("%w: engine %q is required but carries no watermark stamp", ErrRiskBatchIncomplete, e)
		}
	}
	// Aggregates must account for every position, or a book total silently omits
	// one. Checked here so the disagreement is a loud refusal at write time
	// rather than a batch NewestCompleteBatch will skip forever in silence.
	aggPositions := 0
	for _, a := range w.Aggregates {
		aggPositions += a.Positions
	}
	if aggPositions != len(w.Positions) {
		return 0, fmt.Errorf("%w: aggregates account for %d positions but the batch carries %d",
			ErrRiskBatchIncomplete, aggPositions, len(w.Positions))
	}
	seen := map[string]bool{}
	for _, p := range w.Positions {
		if p.Engine == "" || len(p.Account) == 0 {
			return 0, fmt.Errorf("%w: a position needs an engine and an account", ErrRiskBatchIncomplete)
		}
		key := p.Engine + "/" + hex.EncodeToString(p.Account)
		if seen[key] {
			return 0, fmt.Errorf("%w: duplicate position %s", ErrRiskBatchIncomplete, key)
		}
		seen[key] = true
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return 0, fmt.Errorf("begin: %w", err)
	}
	defer tx.Rollback(ctx)

	var batchID int64
	if err := tx.QueryRow(ctx, `SELECT nextval('risk_batches_id_seq')`).Scan(&batchID); err != nil {
		return 0, fmt.Errorf("reserve risk batch id: %w", err)
	}

	for _, m := range w.Watermarks {
		var rows, failed, gen any
		var sum any
		var updatedAt any
		var open any
		if m.Sweep != nil {
			rows, failed, gen = m.Sweep.Rows, m.Sweep.Failed, int64(m.Sweep.Generation)
			sum = numericParam(orZeroBig(m.Sweep.SuccessSum))
			open = m.Sweep.GenerationOpen
			if m.Sweep.HasUpdatedAt {
				updatedAt = m.Sweep.MaxUpdatedAt
			}
		}
		if _, err := tx.Exec(ctx, `INSERT INTO risk_batch_watermarks
			(batch_id, engine, chain_id, last_block, acked_epoch, max_epoch_at_compute,
			 sweep_rows, sweep_failed, sweep_success_sum, sweep_max_updated_at,
			 sweep_generation, sweep_generation_open, sweep_applicable)
			VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
			batchID, m.Engine, m.ChainID, int64(m.LastBlock), m.AckedEpoch, m.MaxEpochAtCompute,
			rows, failed, sum, updatedAt, gen, open, m.Sweep != nil); err != nil {
			return 0, fmt.Errorf("insert risk watermark %s: %w", m.Engine, err)
		}
	}

	for _, p := range w.Positions {
		flags := p.Flags
		if flags == nil {
			flags = []string{}
		}
		if _, err := tx.Exec(ctx, `INSERT INTO risk_positions
			(batch_id, engine, account, status, refusal_code, refusal_detail, refusal_asset, flags,
			 value_decimals, hf_num, hf_den, hf_wad, hf_infinite,
			 total_collateral_base, total_debt_base, weighted_lt_sum, avg_lt_bps,
			 collateral_value_usd, max_borrow_lt, borrowings, liquidatable,
			 balances_block, params_block, sweep_block, oldest_price_input, stale_price_inputs)
			VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26)`,
			batchID, p.Engine, p.Account, p.Status, p.RefusalCode, p.RefusalDetail, p.RefusalAsset, flags,
			int16(p.ValueDecimals), numericParam(p.HFNum), numericParam(p.HFDen), numericParam(p.HFWad), p.HFInfinite,
			numericParam(p.TotalCollateralBase), numericParam(p.TotalDebtBase),
			numericParam(p.WeightedLTSum), numericParam(p.AvgLTBps),
			numericParam(p.CollateralValueUSD), numericParam(p.MaxBorrowLT),
			numericParam(p.Borrowings), p.Liquidatable,
			int64(p.BalancesBlock), int64(p.ParamsBlock), int64(p.SweepBlock),
			p.OldestPriceInput, p.StalePriceInputs); err != nil {
			return 0, fmt.Errorf("insert risk position %s/%x: %w", p.Engine, p.Account, err)
		}

		for _, l := range p.Legs {
			if _, err := tx.Exec(ctx, `INSERT INTO risk_position_legs
				(batch_id, engine, account, asset, decimals,
				 scaled_debt, scaled_collateral, live_debt, live_collateral,
				 debt_base, collateral_base, weighted_lt, used_as_collateral,
				 debt_index_block, collateral_index_block,
				 amount, value_usd, max_borrow_contribution, liq_threshold, liq_bonus)
				VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)`,
				batchID, p.Engine, p.Account, l.Asset, int16(l.Decimals),
				numericParam(l.ScaledDebt), numericParam(l.ScaledCollateral),
				numericParam(l.LiveDebt), numericParam(l.LiveCollateral),
				numericParam(l.DebtBase), numericParam(l.CollateralBase),
				numericParam(l.WeightedLT), l.UsedAsCollateral,
				nullableBlock(l.DebtIndexBlock), nullableBlock(l.CollateralIndexBlock),
				numericParam(l.Amount), numericParam(l.ValueUSD),
				numericParam(l.MaxBorrowContribution),
				numericParam(l.LiqThreshold), numericParam(l.LiqBonus)); err != nil {
				return 0, fmt.Errorf("insert risk leg %s/%x/%x: %w", p.Engine, p.Account, l.Asset, err)
			}
		}

		for _, pr := range p.Prices {
			if _, err := tx.Exec(ctx, `INSERT INTO risk_price_inputs
				(batch_id, engine, account, asset, chain_id, source, provenance,
				 value, decimals, block_number, source_as_of,
				 budget_seconds, verdict, age_seconds)
				VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
				batchID, p.Engine, p.Account, pr.Asset, int64(pr.ChainID), pr.Source, pr.Provenance,
				numericParam(pr.Value), pr.Decimals, nullableBlock(pr.BlockNumber), pr.SourceAsOf,
				pr.BudgetSeconds, pr.Verdict, pr.AgeSeconds); err != nil {
				return 0, fmt.Errorf("insert risk price input %s/%x/%x: %w", p.Engine, p.Account, pr.Asset, err)
			}
		}
	}

	refused, flagged := 0, 0
	for _, p := range w.Positions {
		if p.Status == RiskPositionRefused {
			refused++
		}
		if len(p.Flags) > 0 {
			flagged++
		}
	}

	for _, a := range w.Aggregates {
		if _, err := tx.Exec(ctx, `INSERT INTO risk_batch_aggregates
			(batch_id, engine, value_decimals, positions, computed_positions,
			 refused_positions, flagged_positions, liquidatable_positions,
			 total_collateral, total_debt)
			VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
			batchID, a.Engine, int16(a.ValueDecimals), a.Positions, a.ComputedPositions,
			a.RefusedPositions, a.FlaggedPositions, a.LiquidatablePositions,
			numericParam(orZeroBig(a.TotalCollateral)), numericParam(orZeroBig(a.TotalDebt))); err != nil {
			return 0, fmt.Errorf("insert risk aggregate %s: %w", a.Engine, err)
		}
	}

	legCount, priceCount := 0, 0
	for _, p := range w.Positions {
		legCount += len(p.Legs)
		priceCount += len(p.Prices)
	}

	// The batch row lands LAST: a visible id already has its children.
	if _, err := tx.Exec(ctx, `INSERT INTO risk_batches
		(id, computed_at, status, position_count, leg_count, price_input_count,
		 aggregate_count, required_engines, refused_count, flagged_count, producer,
		 materialization_key, materialization_vector, substrate_digest,
		 required_sweep_engines)
		VALUES ($1, now(), $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
		batchID, RiskBatchComplete, len(w.Positions), legCount, priceCount,
		len(w.Aggregates), required, refused, flagged, w.Producer,
		w.MaterializationKey, w.MaterializationVector, w.SubstrateDigest,
		nonNilStrings(requiredSweep)); err != nil {
		// A UNIQUE violation on the idempotency key means THIS PREPARED PASS
		// ALREADY LANDED — the ordinary shape of a retry after a lost commit
		// acknowledgement, where the first attempt committed and said otherwise.
		// It is reconciled to the committed batch rather than reported, for the
		// same reason the commit path reconciles: recomputing instead would write
		// a duplicate whose step-comparison baseline is the first attempt's own
		// post-move price, silently erasing a large-step warning.
		//
		// The collision can surface HERE or at COMMIT depending on where the
		// retry was interrupted, so both paths reconcile. Any other error is real.
		if isUniqueViolation(err) {
			// A concurrent or racing producer landed this exact materialization
			// between our pre-flight lookup and here. Adopt it — with the same
			// identity verification, so a colliding key still refuses loudly.
			if id, adopted, adoptErr := s.adoptRiskBatch(ctx, w); adoptErr != nil {
				return 0, adoptErr
			} else if adopted {
				return id, nil
			}
		}
		return 0, fmt.Errorf("insert risk batch: %w", err)
	}

	// Retention, in the same transaction. Children go with ON DELETE CASCADE.
	if _, err := tx.Exec(ctx, `DELETE FROM risk_batches WHERE id IN (
			SELECT id FROM risk_batches ORDER BY id DESC OFFSET $1)`, w.Retention); err != nil {
		return 0, fmt.Errorf("prune risk batches to %d: %w", w.Retention, err)
	}

	if w.Notify != "" {
		if _, err := tx.Exec(ctx, `SELECT pg_notify($1, $2)`, w.Notify, fmt.Sprintf("%d", batchID)); err != nil {
			return 0, fmt.Errorf("enqueue risk batch doorbell: %w", err)
		}
	}

	// THE COMMIT IS THE AMBIGUOUS STEP, AND IT IS RECONCILED RATHER THAN TRUSTED.
	//
	// A Commit error does not mean "not committed". The transaction may have
	// landed and the acknowledgement died on the wire, and the two outcomes are
	// indistinguishable from here. Returning the error and letting the daemon
	// retry would then double-write the batch — and the duplicate is the harm:
	// the committed first attempt becomes the step-comparison baseline, so a
	// large price move it correctly flagged is re-judged against its own
	// post-move value, and the newest batch loses a warning an operator was
	// meant to see.
	//
	// So on ANY commit error the idempotency key is looked up on a FRESH
	// connection (the tx's own is not trustworthy — it just failed). If the key
	// is there, the write landed: report it as the success it was. If it is not,
	// the transaction genuinely rolled back and the error is real.
	if err := commitRiskBatchTx(ctx, tx); err != nil {
		// The reconciliation is a best-effort SHORTCUT, not the safety net. If it
		// also fails — one network event commonly kills both — the error is
		// returned and the NEXT pass recomputes the same materialization, derives
		// the SAME deterministic key, and adopts whatever landed. That is why the
		// key had to stop being per-attempt: correctness must not depend on this
		// lookup succeeding.
		if id, adopted, adoptErr := s.adoptRiskBatch(ctx, w); adoptErr == nil && adopted {
			return id, nil
		}
		return 0, fmt.Errorf("commit risk batch: %w", err)
	}
	return batchID, nil
}

// ErrRiskMaterializationConflict is raised when a batch already exists under this
// materialization key but the identity BEHIND that key differs.
//
// It is a loud refusal rather than an adoption because the two possible causes are
// both serious: a SHA-256 collision (astronomically unlikely, and if it happened
// we would want to know), or an identity function that is not actually
// deterministic — a map iteration, a clock, a locale-dependent format leaking into
// the key. Silently adopting would serve one materialization's numbers under
// another's name, which is the precise failure the key exists to prevent.
var ErrRiskMaterializationConflict = errors.New("risk batch refused: materialization key already exists with a DIFFERENT identity")

// adoptLookupHook lets a test fail the adoption lookup. Production always returns
// nil; see adoptRiskBatch for why the seam has to exist.
var adoptLookupHook = func() error { return nil }

// adoptRiskBatch resolves an existing batch for w's materialization key, verifying
// that the identity behind the key matches before adopting it.
//
// adopted=false with a nil error means "no batch exists for this key" — the
// ordinary path, proceed with the write.
func (s *Store) adoptRiskBatch(ctx context.Context, w RiskBatchWrite) (int64, bool, error) {
	// adoptLookupHook is a seam for the one scenario that cannot be provoked
	// honestly: the reconciliation lookup failing on the SAME network event that
	// swallowed the commit acknowledgement. Correctness must not depend on this
	// lookup succeeding, and the only way to prove that is to break it.
	if err := adoptLookupHook(); err != nil {
		return 0, false, fmt.Errorf("resolve risk batch by materialization key: %w", err)
	}
	var id int64
	var vector, digest string
	err := s.pool.QueryRow(ctx,
		`SELECT id, materialization_vector, substrate_digest
		 FROM risk_batches WHERE materialization_key = $1`, w.MaterializationKey).
		Scan(&id, &vector, &digest)
	if errors.Is(err, pgx.ErrNoRows) {
		return 0, false, nil
	}
	if err != nil {
		return 0, false, fmt.Errorf("resolve risk batch by materialization key: %w", err)
	}
	// VERIFY, don't assume. The key is a digest; the identity is the thing.
	if vector != w.MaterializationVector || digest != w.SubstrateDigest {
		return 0, false, fmt.Errorf("%w: key %s is batch %d, whose vector/substrate differ from this pass's",
			ErrRiskMaterializationConflict, w.MaterializationKey, id)
	}
	return id, true, nil
}

// isUniqueViolation reports whether err is PostgreSQL's unique-constraint
// violation (SQLSTATE 23505). Matched on the CODE, never on the message: an
// error string is a presentation detail that changes between server versions
// and locales, and a reconciliation that fires on a substring would eventually
// either miss a real collision or swallow an unrelated failure.
func isUniqueViolation(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "23505"
}

// commitRiskBatchTx is a seam so a test can produce the one state that cannot be
// provoked honestly: a commit that SUCCEEDED and reported failure. Everything
// downstream of it — the reconciliation, the no-duplicate guarantee, the retained
// flag — is unreachable without being able to simulate that.
var commitRiskBatchTx = func(ctx context.Context, tx pgx.Tx) error { return tx.Commit(ctx) }

// Risk batch/position status vocabularies. Closed sets, so a typo is a compile
// error rather than a row nothing will ever select.
const (
	RiskBatchComplete = "complete"

	RiskPositionComputed = "computed"
	RiskPositionRefused  = "refused"
)

// RiskBatch is a served batch header with its stamp vector.
type RiskBatch struct {
	ID            int64
	ComputedAt    time.Time
	Status        string
	PositionCount int
	RefusedCount  int
	FlaggedCount  int
	Producer      string
	Watermarks    []RiskBatchWatermark
}

// NewestCompleteBatch returns the newest batch that is actually whole, or
// found=false when none is.
//
// COMPLETENESS IS VERIFIED, NOT TRUSTED. The predicate requires status
// 'complete', at least one watermark stamp (without one no supersession check
// can run, so the batch is undisclosable), and the ACTUAL `risk_positions` count
// to equal the declared `position_count`. A batch missing children is SKIPPED
// and an older whole batch is served instead — never a torn aggregate
// (chain-truth R6.5). WriteRiskBatch cannot produce that state; a restored dump,
// a manual delete or a hand-written row can, and this is what stands between
// those and a served number.
func (s *Store) NewestCompleteBatch(ctx context.Context) (RiskBatch, bool, error) {
	var b RiskBatch
	err := s.pool.QueryRow(ctx, `
		SELECT b.id, b.computed_at, b.status, b.position_count, b.refused_count, b.flagged_count, b.producer
		FROM risk_batches b
		WHERE b.status = $1
		  -- Every mandatory child relation is checked against its DECLARED
		  -- cardinality. A positions-only check passed a batch holding position
		  -- headers with no price disclosures and no aggregates, which serves a
		  -- health factor with no input evidence and a book total that reads
		  -- empty.
		  AND (SELECT count(*) FROM risk_positions    p WHERE p.batch_id = b.id) = b.position_count
		  AND (SELECT count(*) FROM risk_position_legs l WHERE l.batch_id = b.id) = b.leg_count
		  AND (SELECT count(*) FROM risk_price_inputs  i WHERE i.batch_id = b.id) = b.price_input_count
		  AND (SELECT count(*) FROM risk_batch_aggregates a WHERE a.batch_id = b.id) = b.aggregate_count
		  -- The REQUIRED STAMP SET, not merely "some stamp exists": supersession
		  -- is judged per engine, so a batch missing one engine's pair cannot be
		  -- judged for that engine and must not be served at all.
		  AND NOT EXISTS (
		      SELECT 1 FROM unnest(b.required_engines) AS r(engine)
		      WHERE NOT EXISTS (
		          SELECT 1 FROM risk_batch_watermarks w
		          WHERE w.batch_id = b.id AND w.engine = r.engine))
		  AND cardinality(b.required_engines) > 0
		  -- EVERY ENGINE THAT REQUIRES A SWEEP DISCLOSURE MUST CARRY A COMPLETE
		  -- ONE. Existence of the watermark row was not enough: the sweep columns
		  -- are nullable by necessity (Aave has no sweeper), so a restored batch
		  -- could hold a debt_manager stamp with cursor fields only, pass every
		  -- count and required-engine check, and read back with Sweep nil — making
		  -- a swept engine indistinguishable from an unswept one and letting
		  -- hour-stale collateral be served as current.
		  --
		  -- The row-level CHECK already forbids a PARTIAL payload, so
		  -- sweep_applicable is the whole test here; the explicit column checks
		  -- are belt-and-braces against a constraint being dropped out from under
		  -- this predicate.
		  AND NOT EXISTS (
		      SELECT 1 FROM unnest(b.required_sweep_engines) AS r(engine)
		      WHERE NOT EXISTS (
		          SELECT 1 FROM risk_batch_watermarks w
		          WHERE w.batch_id = b.id AND w.engine = r.engine
		            AND w.sweep_applicable
		            AND w.sweep_rows IS NOT NULL
		            AND w.sweep_failed IS NOT NULL
		            AND w.sweep_success_sum IS NOT NULL
		            AND w.sweep_generation IS NOT NULL
		            AND w.sweep_generation_open IS NOT NULL))
		  -- Aggregates must account for every position, or a book total silently
		  -- omits one.
		  AND COALESCE((SELECT sum(a.positions) FROM risk_batch_aggregates a
		                WHERE a.batch_id = b.id), 0) = b.position_count
		ORDER BY b.id DESC LIMIT 1`, RiskBatchComplete).
		Scan(&b.ID, &b.ComputedAt, &b.Status, &b.PositionCount, &b.RefusedCount, &b.FlaggedCount, &b.Producer)
	if errors.Is(err, pgx.ErrNoRows) {
		return RiskBatch{}, false, nil
	}
	if err != nil {
		return RiskBatch{}, false, fmt.Errorf("read newest complete risk batch: %w", err)
	}
	b.ComputedAt = b.ComputedAt.UTC()

	rows, err := s.pool.Query(ctx,
		`SELECT engine, chain_id, last_block, acked_epoch, max_epoch_at_compute,
		        sweep_rows, sweep_failed, sweep_success_sum::text, sweep_max_updated_at,
		        sweep_generation, sweep_generation_open, sweep_applicable
		 FROM risk_batch_watermarks WHERE batch_id = $1 ORDER BY engine`, b.ID)
	if err != nil {
		return RiskBatch{}, false, fmt.Errorf("read risk batch watermarks: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var m RiskBatchWatermark
		var sweepRows, sweepFailed, sweepGen *int64
		var sweepSum *string
		var sweepUpdated *time.Time
		var sweepOpen *bool
		var sweepApplicable bool
		if err := rows.Scan(&m.Engine, &m.ChainID, &m.LastBlock, &m.AckedEpoch, &m.MaxEpochAtCompute,
			&sweepRows, &sweepFailed, &sweepSum, &sweepUpdated, &sweepGen, &sweepOpen,
			&sweepApplicable); err != nil {
			return RiskBatch{}, false, fmt.Errorf("scan risk batch watermark: %w", err)
		}
		// APPLICABILITY IS THE ROW'S OWN STATEMENT, not an inference from which
		// columns happen to be non-null. Inferring it from `sweep_rows != nil`
		// silently reclassified a partially-filled row as "no sweeper", which is
		// the confusion the whole distinction exists to prevent. A nil Sweep now
		// means the engine HAS no sweeper, and nothing else.
		if sweepApplicable {
			sw := &RiskSweepWatermark{Engine: m.Engine, Rows: *sweepRows}
			if sweepFailed != nil {
				sw.Failed = *sweepFailed
			}
			if sweepSum != nil {
				v, ok := new(big.Int).SetString(*sweepSum, 10)
				if !ok {
					return RiskBatch{}, false, fmt.Errorf("risk batch %d sweep sum %q is not an integer", b.ID, *sweepSum)
				}
				sw.SuccessSum = v
			}
			if sweepUpdated != nil {
				sw.HasUpdatedAt, sw.MaxUpdatedAt = true, sweepUpdated.UTC()
			}
			if sweepGen != nil {
				sw.Generation = uint64(*sweepGen)
			}
			if sweepOpen != nil {
				sw.GenerationOpen = *sweepOpen
			}
			m.Sweep = sw
		}
		b.Watermarks = append(b.Watermarks, m)
	}
	if err := rows.Err(); err != nil {
		return RiskBatch{}, false, fmt.Errorf("iterate risk batch watermarks: %w", err)
	}
	return b, true, nil
}

// RiskBatchPriceInputs reads back the FULL price snapshots a batch recorded,
// ordered deterministically.
//
// It exists so a disclosure can be served — and proved — WITHOUT touching
// `prices`. The regression that matters (design spec §7, Codex round 1 [H6]) is
// that neutralizing and superseding a source row after the batch committed
// leaves what this returns byte-identical, because these are copies and not
// references.
func (s *Store) RiskBatchPriceInputs(ctx context.Context, batchID int64) ([]RiskBatchPriceInput, error) {
	rows, err := s.pool.Query(ctx,
		`SELECT engine, account, asset, chain_id, source, provenance,
		        value::text, decimals, block_number, source_as_of,
		        budget_seconds, verdict, age_seconds
		 FROM risk_price_inputs WHERE batch_id = $1
		 ORDER BY engine, account, asset, source`, batchID)
	if err != nil {
		return nil, fmt.Errorf("read risk batch price inputs: %w", err)
	}
	defer rows.Close()
	var out []RiskBatchPriceInput
	for rows.Next() {
		var r RiskBatchPriceInput
		var value *string
		if err := rows.Scan(&r.Engine, &r.Account, &r.Asset, &r.ChainID, &r.Source, &r.Provenance,
			&value, &r.Decimals, &r.BlockNumber, &r.SourceAsOf,
			&r.BudgetSeconds, &r.Verdict, &r.AgeSeconds); err != nil {
			return nil, fmt.Errorf("scan risk batch price input: %w", err)
		}
		if value != nil {
			v, ok := new(big.Int).SetString(*value, 10)
			if !ok {
				return nil, fmt.Errorf("risk batch price input %x/%s: %q is not an integer", r.Asset, r.Source, *value)
			}
			r.Value = v
		}
		if r.SourceAsOf != nil {
			t := r.SourceAsOf.UTC()
			r.SourceAsOf = &t
		}
		out = append(out, r)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate risk batch price inputs: %w", err)
	}
	return out, nil
}

// RiskBatchPriceInput is one persisted price snapshot, as served.
type RiskBatchPriceInput struct {
	Engine     string
	Account    []byte
	Asset      []byte
	ChainID    int64
	Source     string
	Provenance string

	Value       *big.Int
	Decimals    *int16
	BlockNumber *int64
	SourceAsOf  *time.Time

	BudgetSeconds int64
	Verdict       string
	AgeSeconds    *int64
}

// RiskBatchPositions reads a batch's position rows. Used by the daemon's
// step-move baseline (G5) and by tests; `cmd/api` gets its own richer read.
func (s *Store) RiskBatchPositions(ctx context.Context, batchID int64) ([]RiskBatchPosition, error) {
	rows, err := s.pool.Query(ctx,
		`SELECT engine, account, status, refusal_code, refusal_detail, flags,
		        value_decimals, hf_num::text, hf_den::text, hf_wad::text, hf_infinite,
		        total_collateral_base::text, total_debt_base::text,
		        collateral_value_usd::text, max_borrow_lt::text, borrowings::text, liquidatable,
		        balances_block, params_block, sweep_block, oldest_price_input, stale_price_inputs
		 FROM risk_positions WHERE batch_id = $1 ORDER BY engine, account`, batchID)
	if err != nil {
		return nil, fmt.Errorf("read risk batch positions: %w", err)
	}
	defer rows.Close()
	var out []RiskBatchPosition
	for rows.Next() {
		var p RiskBatchPosition
		var hfNum, hfDen, hfWad, tc, td, cv, mb, bw *string
		if err := rows.Scan(&p.Engine, &p.Account, &p.Status, &p.RefusalCode, &p.RefusalDetail, &p.Flags,
			&p.ValueDecimals, &hfNum, &hfDen, &hfWad, &p.HFInfinite,
			&tc, &td, &cv, &mb, &bw, &p.Liquidatable,
			&p.BalancesBlock, &p.ParamsBlock, &p.SweepBlock, &p.OldestPriceInput, &p.StalePriceInputs); err != nil {
			return nil, fmt.Errorf("scan risk batch position: %w", err)
		}
		for _, f := range []struct {
			text *string
			dst  **big.Int
		}{{hfNum, &p.HFNum}, {hfDen, &p.HFDen}, {hfWad, &p.HFWad},
			{tc, &p.TotalCollateralBase}, {td, &p.TotalDebtBase},
			{cv, &p.CollateralValueUSD}, {mb, &p.MaxBorrowLT}, {bw, &p.Borrowings}} {
			if f.text == nil {
				continue
			}
			v, ok := new(big.Int).SetString(*f.text, 10)
			if !ok {
				return nil, fmt.Errorf("risk position %s/%x: %q is not an integer", p.Engine, p.Account, *f.text)
			}
			*f.dst = v
		}
		out = append(out, p)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate risk batch positions: %w", err)
	}
	return out, nil
}

// RiskBatchPosition is one persisted position row, as served.
type RiskBatchPosition struct {
	Engine        string
	Account       []byte
	Status        string
	RefusalCode   string
	RefusalDetail string
	Flags         []string
	ValueDecimals int16

	HFNum      *big.Int
	HFDen      *big.Int
	HFWad      *big.Int
	HFInfinite bool

	TotalCollateralBase *big.Int
	TotalDebtBase       *big.Int
	CollateralValueUSD  *big.Int
	MaxBorrowLT         *big.Int
	Borrowings          *big.Int
	Liquidatable        *bool

	BalancesBlock    int64
	ParamsBlock      int64
	SweepBlock       int64
	OldestPriceInput *time.Time
	StalePriceInputs bool
}

// RiskBatchAggregates reads a batch's per-engine rollups.
func (s *Store) RiskBatchAggregates(ctx context.Context, batchID int64) ([]RiskEngineAggregate, error) {
	rows, err := s.pool.Query(ctx,
		`SELECT engine, value_decimals, positions, computed_positions, refused_positions,
		        flagged_positions, liquidatable_positions, total_collateral::text, total_debt::text
		 FROM risk_batch_aggregates WHERE batch_id = $1 ORDER BY engine`, batchID)
	if err != nil {
		return nil, fmt.Errorf("read risk batch aggregates: %w", err)
	}
	defer rows.Close()
	var out []RiskEngineAggregate
	for rows.Next() {
		var a RiskEngineAggregate
		var dec int16
		var tc, td string
		if err := rows.Scan(&a.Engine, &dec, &a.Positions, &a.ComputedPositions, &a.RefusedPositions,
			&a.FlaggedPositions, &a.LiquidatablePositions, &tc, &td); err != nil {
			return nil, fmt.Errorf("scan risk batch aggregate: %w", err)
		}
		a.ValueDecimals = uint8(dec)
		for _, f := range []struct {
			text string
			dst  **big.Int
		}{{tc, &a.TotalCollateral}, {td, &a.TotalDebt}} {
			v, ok := new(big.Int).SetString(f.text, 10)
			if !ok {
				return nil, fmt.Errorf("risk aggregate %s: %q is not an integer", a.Engine, f.text)
			}
			*f.dst = v
		}
		out = append(out, a)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate risk batch aggregates: %w", err)
	}
	return out, nil
}

func nullableBlock(v *uint64) any {
	if v == nil {
		return nil
	}
	return int64(*v)
}

// nonNilStrings turns a nil slice into an empty one, because the columns these
// feed are NOT NULL arrays and pgx encodes a nil slice as NULL.
func nonNilStrings(in []string) []string {
	if in == nil {
		return []string{}
	}
	return in
}

func orZeroBig(v *big.Int) *big.Int {
	if v == nil {
		return new(big.Int)
	}
	return v
}
