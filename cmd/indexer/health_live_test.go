package main

// LIVE-DATABASE tests for the two round-9 findings that cannot be told the truth by
// a fake:
//
//   - [medium] the adaptive collateral bound was lost after a restart during an OPEN
//     generation. Every fact in that sentence is a fact about what Postgres does —
//     which statement NULLs completed_at, what a second process reads back — so the
//     test drives real stores through a real generation lifecycle.
//   - [medium] the quiet-refusal test fabricated a store transition
//     ErrStaleSweepBatch cannot produce (Codex's test-integrity failure #6). Its
//     replacement drives the REAL snapshotter against the REAL store and makes the
//     refusal happen, using a fake CHAIN — the only fake the scenario needs, and the
//     one whose behaviour (an endpoint serving an old execution block) is exactly
//     what production does.
//
// ISOLATION. internal/store's own live suite TRUNCATEs the shared public-schema
// tables at the start of every test and `go test ./...` runs package binaries
// concurrently, so everything here migrates and operates inside a dedicated schema,
// the same convention internal/derive's live suite uses.

import (
	"context"
	"database/sql"
	"encoding/hex"
	"math/big"
	"net/url"
	"os"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/ethereum/go-ethereum/accounts/abi"
	"github.com/ethereum/go-ethereum/common"
	_ "github.com/jackc/pgx/v5/stdlib"
	"github.com/stretchr/testify/require"

	"github.com/kaselunt/solvent/internal/chain"
	"github.com/kaselunt/solvent/internal/snapshot"
	"github.com/kaselunt/solvent/internal/store"
)

// healthLiveSchema is this package's dedicated Postgres schema, dropped and
// re-created per test.
const healthLiveSchema = "indexer_health_live"

// liveEngine is the engine key these tests sweep. It matches the daemon's real
// snapshotter engine so nothing here depends on an engine name production never uses.
const liveEngine = "debt_manager"

// healthLiveDSN scopes dsn's search_path to the test schema.
func healthLiveDSN(t *testing.T, dsn string) string {
	t.Helper()
	u, err := url.Parse(dsn)
	require.NoError(t, err)
	q := u.Query()
	q.Set("options", "-csearch_path="+healthLiveSchema)
	u.RawQuery = q.Encode()
	return u.String()
}

// liveHealthStore returns a real *store.Store over a freshly migrated,
// schema-isolated database, plus the scoped DSN so a test can open a SECOND store
// (which is how a restart is modelled) or an admin connection for the raw
// clock-shifting statements the store has no API for.
func liveHealthStore(t *testing.T) (*store.Store, string) {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("TEST_DATABASE_URL not set; run `make db-up` and export it")
	}
	ctx := context.Background()

	admin, err := sql.Open("pgx", dsn)
	require.NoError(t, err)
	_, err = admin.ExecContext(ctx, "DROP SCHEMA IF EXISTS "+healthLiveSchema+" CASCADE")
	require.NoError(t, err)
	_, err = admin.ExecContext(ctx, "CREATE SCHEMA "+healthLiveSchema)
	require.NoError(t, err)
	require.NoError(t, admin.Close())

	scoped := healthLiveDSN(t, dsn)
	require.NoError(t, store.Migrate(ctx, scoped))
	s, err := store.Open(ctx, scoped)
	require.NoError(t, err)
	t.Cleanup(s.Close)
	return s, scoped
}

// liveAdmin opens a raw connection into the test schema, for the statements that
// shift durable timestamps. Aging a real row on the database's own clock is the same
// technique internal/store's collateral suite uses; it manipulates WHEN a real
// transition happened, never WHICH transitions are possible.
func liveAdmin(t *testing.T, scoped string) *sql.DB {
	t.Helper()
	db, err := sql.Open("pgx", scoped)
	require.NoError(t, err)
	t.Cleanup(func() { _ = db.Close() })
	return db
}

// liveAddr builds a deterministic 20-byte account.
func liveAddr(b byte) []byte {
	a := make([]byte, 20)
	a[19] = b
	return a
}

// liveHash builds a deterministic 32-byte tx hash.
func liveHash(b byte) []byte {
	h := make([]byte, 32)
	h[31] = b
	return h
}

// seedLiveRegistry gives each account a debt-side position event, which is what the
// usability count's registry read (DISTINCT debt-side accounts) and SweepWorkBatch's
// queue both select on. Without it every count is zero and a test would pass by
// measuring an empty set.
func seedLiveRegistry(t *testing.T, s *store.Store, block uint64, accounts ...[]byte) {
	t.Helper()
	events := make([]store.PositionEvent, 0, len(accounts))
	for i, acct := range accounts {
		events = append(events, store.PositionEvent{
			ChainID: 10, Engine: liveEngine, Account: acct, Asset: liveAddr(0xC0),
			Side: "debt", EventType: "borrow", Delta: big.NewInt(1),
			BlockNumber: block, TxHash: liveHash(byte(0xE0 + i)), LogIndex: uint32(i),
		})
	}
	require.NoError(t, s.ApplyDerived(context.Background(), liveEngine, 10, events, block))
}

// ---------------------------------------------------------------------------
// The FAKE CHAIN. Not a fake store — a fake chain, which is the distinction the
// brief draws and the reason this test can exist at all. Everything about the sweep
// that matters (the queue, the monotonic guard, the typed refusal, the status rows)
// runs against real Postgres; the only thing stubbed is the RPC endpoint, and what it
// is stubbed to do — answer a well-formed multicall at an OLD execution block — is
// precisely the production failure the guard exists for.
// ---------------------------------------------------------------------------

func liveMustABI(t *testing.T, jsonArray string) abi.ABI {
	t.Helper()
	parsed, err := abi.JSON(strings.NewReader(jsonArray))
	require.NoError(t, err)
	return parsed
}

// liveSliceLen reads the length of a geth-unpacked anonymous tuple slice. The
// element type is generated by the ABI decoder, so it is read reflectively — the
// same style internal/snapshot's own test harness uses.
func liveSliceLen(t *testing.T, v any) int {
	t.Helper()
	rv := reflect.ValueOf(v)
	require.Equal(t, reflect.Slice, rv.Kind())
	return rv.Len()
}

// The two ABIs, byte-identical in shape to internal/snapshot's (which are unexported).
// A drift between them is LOUD rather than silent: the snapshotter would fail to
// decode this fake's response and Step would return an error, which every assertion
// below would report.
const liveMulticallABI = `[{
	"type": "function",
	"name": "tryBlockAndAggregate",
	"stateMutability": "payable",
	"inputs": [
		{"name": "requireSuccess", "type": "bool"},
		{"name": "calls", "type": "tuple[]", "components": [
			{"name": "target", "type": "address"},
			{"name": "callData", "type": "bytes"}
		]}
	],
	"outputs": [
		{"name": "blockNumber", "type": "uint256"},
		{"name": "blockHash", "type": "bytes32"},
		{"name": "returnData", "type": "tuple[]", "components": [
			{"name": "success", "type": "bool"},
			{"name": "returnData", "type": "bytes"}
		]}
	]
}]`

const liveLensABI = `[{
	"type": "function",
	"name": "collateralOf",
	"stateMutability": "view",
	"inputs": [{"name": "user", "type": "address"}],
	"outputs": [
		{"name": "", "type": "tuple[]", "components": [
			{"name": "token", "type": "address"},
			{"name": "amount", "type": "uint256"}
		]},
		{"name": "", "type": "uint256"}
	]
}]`

type liveTokenData struct {
	Token  common.Address
	Amount *big.Int
}

type liveMCResult struct {
	Success    bool
	ReturnData []byte
}

// stubSweepChain answers every multicall at whatever execution block the test has
// set, with one successful collateralOf per requested account.
//
// block is what drives the scenario: set ABOVE an account's recorded last success it
// lands normally; set BELOW it the store's monotonic guard refuses the whole batch
// and returns ErrStaleSweepBatch — a lagging RPC endpoint, which is the exact thing
// production sees.
type stubSweepChain struct {
	t      *testing.T
	mc     abi.ABI
	lens   abi.ABI
	block  uint64
	tokens []liveTokenData
	calls  int
}

func newStubSweepChain(t *testing.T, block uint64) *stubSweepChain {
	return &stubSweepChain{
		t: t, mc: liveMustABI(t, liveMulticallABI), lens: liveMustABI(t, liveLensABI),
		block:  block,
		tokens: []liveTokenData{{Token: common.HexToAddress("0xbb"), Amount: big.NewInt(9)}},
	}
}

func (c *stubSweepChain) CallWithToken(_ context.Context, _ common.Address, data []byte) ([]byte, chain.EndpointToken, error) {
	c.calls++
	method := c.mc.Methods["tryBlockAndAggregate"]
	require.Equal(c.t, method.ID, data[:4], "the snapshotter must be calling tryBlockAndAggregate")
	vals, err := method.Inputs.Unpack(data[4:])
	require.NoError(c.t, err)
	n := liveSliceLen(c.t, vals[1])

	ret, err := c.lens.Methods["collateralOf"].Outputs.Pack(c.tokens, big.NewInt(0))
	require.NoError(c.t, err)
	results := make([]liveMCResult, n)
	for i := range results {
		results[i] = liveMCResult{Success: true, ReturnData: ret}
	}
	out, err := method.Outputs.Pack(new(big.Int).SetUint64(c.block), [32]byte{0xbb}, results)
	require.NoError(c.t, err)
	return out, chain.EndpointToken{Index: 0}, nil
}

func (c *stubSweepChain) CallFrom(ctx context.Context, _ int, to common.Address, data []byte) ([]byte, chain.EndpointToken, error) {
	return c.CallWithToken(ctx, to, data)
}

func (c *stubSweepChain) EndpointCount() int { return 1 }

// ---------------------------------------------------------------------------
// H2 — THE ADAPTIVE BOUND MUST SURVIVE A RESTART DURING AN OPEN GENERATION.
// ---------------------------------------------------------------------------

// A restart in the middle of an open generation used to collapse the collateral
// staleness bound to the naive interval-only formula for the REST of that
// generation, because the only durable record of the achieved pass duration —
// completed_at - opened_at — is destroyed the instant OpenSweepGeneration NULLs
// completed_at, and the daemon's retained copy lives in process memory.
//
// On a registry whose pass takes hours that is hours of false-red readiness after
// every restart, and it is the restart-continuity class this whole surface exists to
// close: a durable-fact discipline was applied to the SIGNAL and not to the BOUND'S
// INPUT.
//
// The test drives the real lifecycle and then models the restart the way the daemon
// experiences it — a brand-new collateralBoundState (empty process memory) over a
// brand-new *store.Store (a new connection to the surviving durable state).
func TestCollateralBoundSurvivesARestartDuringAnOpenGeneration(t *testing.T) {
	s, scoped := liveHealthStore(t)
	admin := liveAdmin(t, scoped)
	ctx := context.Background()
	acct := liveAddr(0xA1)
	seedLiveRegistry(t, s, 100, acct)

	// A generation opens, runs for 40 minutes, and completes. That 40 minutes is
	// the achieved cadence the bound has to respect: a bound that ignores it is
	// permanently exceeded on a healthy deployment.
	gen, err := s.OpenSweepGeneration(ctx, liveEngine)
	require.NoError(t, err)
	_, err = admin.ExecContext(ctx,
		`UPDATE sweep_generations SET opened_at = now() - interval '40 minutes' WHERE engine = $1`, liveEngine)
	require.NoError(t, err)
	_, stamped, err := s.CompleteSweepGeneration(ctx, liveEngine, gen)
	require.NoError(t, err)
	require.True(t, stamped)

	// The RUNNING daemon learns the cadence and judges with the widened bound.
	running := &collateralBoundState{interval: time.Minute}
	running.hydrate(ctx, s, liveEngine)
	p, found, err := s.SweepProgress(ctx, liveEngine, snapshot.MaxSweepAttempts, running.bound())
	require.NoError(t, err)
	require.True(t, found)
	running.observe(p.LastPassDuration)
	widened := running.bound()
	require.InDelta(t, (40 * time.Minute).Seconds(), running.lastPass.Seconds(), 5,
		"the achieved pass duration is what the bound is built from")
	require.Greater(t, widened, collateralStaleBound(time.Minute, 0),
		"sanity: the adaptive bound really is wider than the naive one, so losing it is a visible regression and not a no-op")

	// THE NEXT GENERATION OPENS — the state a long sweep spends most of its life
	// in, and the state that used to erase the cadence.
	_, err = s.OpenSweepGeneration(ctx, liveEngine)
	require.NoError(t, err)
	open, _, err := s.SweepProgress(ctx, liveEngine, snapshot.MaxSweepAttempts, running.bound())
	require.NoError(t, err)
	require.True(t, open.Open, "the generation really is open again: completed_at is gone")

	// THE RESTART. New process memory, new connection, nothing carried over except
	// what Postgres holds.
	restarted, err := store.Open(ctx, scoped)
	require.NoError(t, err)
	defer restarted.Close()
	fresh := &collateralBoundState{interval: time.Minute}
	require.Equal(t, collateralStaleBound(time.Minute, 0), fresh.bound(),
		"before hydration a fresh process knows nothing — this is exactly the state that used to persist for the rest of the generation")

	fresh.hydrate(ctx, restarted, liveEngine)
	require.Equal(t, widened, fresh.bound(),
		"a restart mid-generation must judge with the SAME bound its predecessor was judging with, to the second")
	require.Equal(t, running.lastPass, fresh.lastPass,
		"and it is the same durable number, not a coincidentally similar recomputation")

	// The per-round read carries it too, so the hydration is not the only path: a
	// process that hydrated before the row existed still picks it up next round.
	again, _, err := s.SweepProgress(ctx, liveEngine, snapshot.MaxSweepAttempts, fresh.bound())
	require.NoError(t, err)
	require.Equal(t, running.lastPass, again.LastPassDuration,
		"SweepProgress reports the durable duration while the generation is OPEN, which is the whole fix")
}

// A REWIND MUST NOT ERASE IT EITHER. RewindDerived performs the same generation bump
// OpenSweepGeneration does, in its own transaction, so a fix that only covered
// OpenSweepGeneration would leave the identical defect reachable through the
// post-rewind re-sweep — which is the path a reorg takes.
func TestARewindDoesNotEraseTheAchievedPassDuration(t *testing.T) {
	s, scoped := liveHealthStore(t)
	admin := liveAdmin(t, scoped)
	ctx := context.Background()
	seedLiveRegistry(t, s, 100, liveAddr(0xA1))

	gen, err := s.OpenSweepGeneration(ctx, liveEngine)
	require.NoError(t, err)
	_, err = admin.ExecContext(ctx,
		`UPDATE sweep_generations SET opened_at = now() - interval '33 minutes' WHERE engine = $1`, liveEngine)
	require.NoError(t, err)
	_, stamped, err := s.CompleteSweepGeneration(ctx, liveEngine, gen)
	require.NoError(t, err)
	require.True(t, stamped)

	before, found, err := s.SweepLastPassDuration(ctx, liveEngine)
	require.NoError(t, err)
	require.True(t, found)
	require.InDelta(t, (33 * time.Minute).Seconds(), before.Seconds(), 5)

	require.NoError(t, s.RewindDerived(ctx, liveEngine, 10, 50))

	after, found, err := s.SweepLastPassDuration(ctx, liveEngine)
	require.NoError(t, err)
	require.True(t, found, "a rewind does not un-happen a pass that really completed")
	require.Equal(t, before, after,
		"the post-rewind re-sweep opens a generation through RewindDerived's own bump; that bump must not name the duration column")
}

// ---------------------------------------------------------------------------
// H4 — THE QUIET-REFUSAL LEG, DRIVEN THROUGH THE REAL REFUSAL.
// ---------------------------------------------------------------------------

// This replaces TestQuietlyRefusedGenerationFailsReadinessThroughUsability, which
// Codex identified as test-integrity failure #6: it hand-built a CLOSED generation
// containing a stale account, and ErrStaleSweepBatch cannot produce that state. The
// refusal applies no status update at all, so the account stays in SweepWorkBatch's
// queue and the generation can never reach the empty-batch completion path. The old
// test asserted a composition that cannot occur.
//
// What CAN occur, and what this drives end to end against live Postgres:
//
//  1. an account is swept successfully at execution block 500;
//  2. time passes — its collateral snapshot ages past the bound;
//  3. a new generation opens (cadence, or a post-rewind re-sweep);
//  4. every endpoint now serves an OLD execution block, so ApplySweepBatch's
//     monotonic guard refuses the whole batch with ErrStaleSweepBatch and the
//     snapshotter's Step returns (false, nil) — no error for the daemon's failure
//     bookkeeping, no advance for the loop, round after round;
//  5. the account is STILL QUEUED (which is the very fact the fabricated test had to
//     contradict), so nothing is failed, nothing is exhausted, and the generation
//     stays open without ever completing.
//
// Every other readiness signal is therefore silent by construction, and
// collateral_unusable is the only thing that catches it.
func TestQuietlyRefusedSweepFailsReadinessThroughARealStaleBatchRefusal(t *testing.T) {
	s, scoped := liveHealthStore(t)
	admin := liveAdmin(t, scoped)
	ctx := context.Background()
	acct := liveAddr(0xA1)
	seedLiveRegistry(t, s, 100, acct)

	// A REAL SUCCESSFUL SWEEP at execution block 500, through the real snapshotter.
	ch := newStubSweepChain(t, 500)
	snap, err := snapshot.New(s, ch, snapshot.Config{
		Engine: liveEngine, Target: common.HexToAddress("0xdead"), Interval: time.Hour, BatchSize: 10,
	})
	require.NoError(t, err)
	advanced, err := snap.Step(ctx)
	require.NoError(t, err)
	require.True(t, advanced, "the first Step opens a generation and lands the batch")
	require.Equal(t, uint64(500), liveSuccessBlock(t, admin, acct), "the success really landed")
	advanced, err = snap.Step(ctx)
	require.NoError(t, err)
	require.True(t, advanced, "and the next Step completes the generation, since nothing lags")

	// TIME PASSES. Both durable timestamps are aged together, which is what really
	// happens: a success that landed three hours ago has a three-hour-old
	// updated_at and a three-hour-old last_success_at.
	_, err = admin.ExecContext(ctx,
		`UPDATE snapshot_sweeps SET updated_at = now() - interval '3 hours', last_success_at = now() - interval '3 hours'
		 WHERE engine = $1`, liveEngine)
	require.NoError(t, err)

	// EVERY ENDPOINT IS NOW BEHIND: the multicall answers at block 100, which is
	// below the account's recorded success at 500. This is semantic staleness — the
	// eth_call succeeds, so the failover client's error-driven rotation never sees a
	// problem.
	ch.block = 100
	snap.TriggerResweep() // the post-rewind fast path; a cadence-due open is identical

	// PIN THE REFUSAL ITSELF, so the composition below rests on the typed error and
	// not on an inference: the same batch the snapshotter is about to send is
	// refused by the real store with ErrStaleSweepBatch, and nothing is applied.
	require.ErrorIs(t,
		s.ApplySweepBatch(ctx, liveEngine, 99, 100, []store.SweepResult{{
			Account: acct, OK: true,
			Balances: map[string]map[string]*big.Int{
				hex.EncodeToString(liveAddr(0xBB)): {"collateral": big.NewInt(1)},
			},
		}}),
		store.ErrStaleSweepBatch,
		"the refusal this scenario depends on is the typed one, driven through the real store")

	// FIVE QUIET ROUNDS through the real daemon wrapper.
	var ss snapshotState
	rc := roundConditions{}
	callsBefore := ch.calls
	for i := 0; i < 5; i++ {
		require.False(t, stepSnapshotter(ctx, snap, &ss, rc),
			"a wholesale-stale batch advances nothing, round %d", i)
	}
	require.Nil(t, ss.lastErr, "and it reports no error either: that is what makes it quiet")
	require.NotContains(t, rc[snapshotName], conditionStepError, "which is exactly why nothing was reported")
	require.Greater(t, ch.calls, callsBefore, "the rounds really did issue multicalls; they were refused, not skipped")

	// THE STATE THE FABRICATED TEST COULD NOT HAVE. The account is untouched by the
	// refusal — still status='success', still stamped by the OLD generation, still
	// carrying block 500 — and therefore still in the queue, which is precisely why
	// the generation cannot complete.
	require.Equal(t, uint64(500), liveSuccessBlock(t, admin, acct),
		"the refusal applied nothing: no status update, no block advance")
	queued, err := s.SweepWorkBatch(ctx, liveEngine, liveGeneration(t, admin), snapshot.MaxSweepAttempts, 10)
	require.NoError(t, err)
	require.Len(t, queued, 1, "the account stays in the work batch — this is the fact the fabricated closed-generation state contradicted")

	// THE VERDICT, from the real store through the daemon's real pass.
	collateral := &collateralBoundState{interval: time.Minute}
	collateral.hydrate(ctx, s, liveEngine)
	applyProgressConditions(ctx, s, time.Now(), rc, progressWatch{
		sweepEngine: liveEngine, sweepMaxAttempts: snapshot.MaxSweepAttempts, collateral: collateral,
	})
	h, _ := newTestHealth()
	publishRound(h, rc)

	rep := h.report()
	require.NotContains(t, rep.Recoverable, snapshotName+"/"+conditionStepError,
		"Step returned no error, round after round")
	require.NotContains(t, rep.Recoverable, snapshotName+"/"+conditionNoProgress,
		"the generation opened moments ago, so the stall bound has not elapsed")
	require.NotContains(t, rep.Recoverable, snapshotName+"/"+conditionSnapshotFailures,
		"the refusal writes no failed status, so there is nothing failed and nothing exhausted")
	require.NotContains(t, rep.Recoverable, snapshotName+"/"+conditionProgressUnmeasured,
		"and every read succeeded")
	require.Contains(t, rep.Recoverable, snapshotName+"/"+conditionCollateralUnusable,
		"every other signal is silent by construction, so this is the only thing that can catch it")
	require.Contains(t, rep.Recoverable[snapshotName+"/"+conditionCollateralUnusable],
		"1 whose newest successful snapshot is older than")
	require.False(t, rep.Ready)
}

// liveSuccessBlock reads an account's durable last_success_block.
func liveSuccessBlock(t *testing.T, db *sql.DB, account []byte) uint64 {
	t.Helper()
	var block uint64
	require.NoError(t, db.QueryRowContext(context.Background(),
		`SELECT last_success_block FROM snapshot_sweeps WHERE engine = $1 AND account = $2`,
		liveEngine, account).Scan(&block))
	return block
}

// liveGeneration reads the engine's current sweep generation.
func liveGeneration(t *testing.T, db *sql.DB) uint64 {
	t.Helper()
	var gen uint64
	require.NoError(t, db.QueryRowContext(context.Background(),
		`SELECT current_generation FROM sweep_generations WHERE engine = $1`, liveEngine).Scan(&gen))
	return gen
}
