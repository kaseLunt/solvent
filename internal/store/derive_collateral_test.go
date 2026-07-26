package store

// LIVE-DATABASE tests for the COLLATERAL USABILITY record — the durable facts the
// daemon's collateral_unusable readiness gate is computed from.
//
// WHY THESE ARE LIVE TESTS. Every claim here is a claim about what Postgres does:
// which ON CONFLICT arm fires on a replay, whether an UPDATE inside RewindDerived's
// transaction reaches a surviving row, how `now() - interval` compares against a
// stamp written by the same clock. A fake modelling those transitions would be
// asserting its own model — the failure mode this series has already shipped twice.
//
// The gate they support answers a question snapshot_failures structurally cannot:
// snapshot_failures is keyed on EXHAUSTED CURRENT-GENERATION failures, so a first
// failure leaves it silent while the account may never have produced collateral at
// all, and opening the next generation drops the row out of the count before
// anything succeeded. These counts are keyed on the durable SUCCESS record, which
// nothing but a landed success can move.

import (
	"context"
	"math/big"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

// collateralBudget is the retry budget these tests pass to SweepProgress; it
// matches snapshot.MaxSweepAttempts, which this package cannot import.
const collateralBudget = 4

// seedCollateralRegistry gives each account a debt-side position event below
// `through`, which is what the usability count's registry read (DISTINCT debt-side
// accounts) selects on. Without it every count is zero and a test would pass by
// measuring an empty set.
func seedCollateralRegistry(t *testing.T, s *Store, engine string, block uint64, accounts ...[]byte) {
	t.Helper()
	ctx := context.Background()
	events := make([]PositionEvent, 0, len(accounts))
	for i, acct := range accounts {
		events = append(events, PositionEvent{
			ChainID: 10, Engine: engine, Account: acct, Asset: addr20(0xC0),
			Side: "debt", EventType: "borrow", Delta: big.NewInt(1),
			BlockNumber: block, TxHash: hash32(byte(0xE0 + i)), LogIndex: uint32(i),
		})
	}
	require.NoError(t, s.ApplyDerived(ctx, engine, 10, events, block))
}

// successStamp reads an account's durable collateral-success record.
func successStamp(t *testing.T, s *Store, engine string, account []byte) (*time.Time, uint64) {
	t.Helper()
	var at *time.Time
	var block uint64
	require.NoError(t, s.pool.QueryRow(context.Background(),
		`SELECT last_success_at, last_success_block FROM snapshot_sweeps WHERE engine = $1 AND account = $2`,
		engine, account).Scan(&at, &block))
	return at, block
}

// AMENDMENT A2 — the ==-REPLAY STAMP GUARD.
//
// The monotonic stale-failover guard deliberately admits execBlock ==
// last_success_block so a crash-replay converges idempotently. A replay observes NO
// NEW CHAIN STATE, so re-stamping the freshness time for one would refresh the
// collateral signal on zero new evidence — and that is not a hypothetical shape:
// an endpoint frozen at a fixed eth_call state whose BlockNumber view still advances
// (the adversary internal/snapshot documents) re-lands the SAME execution block
// every generation, forever. Without the guard the usability gate would read green
// through that indefinitely; with it, the frozen loop trips StaleSuccess once the
// bound elapses, which makes this gate the first thing that catches that failure.
func TestSweepSuccessStampAdvancesOnlyOnANewBlock(t *testing.T) {
	s := testDeriveStore(t)
	ctx := context.Background()
	engine := "debt_manager"
	acct := addr20(0xA1)
	seedCollateralRegistry(t, s, engine, 100, acct)

	gen, err := s.OpenSweepGeneration(ctx, engine)
	require.NoError(t, err)
	success := func(g, block uint64) {
		t.Helper()
		require.NoError(t, s.ApplySweepBatch(ctx, engine, g, block, []SweepResult{
			{Account: acct, OK: true, Balances: map[string]map[string]*big.Int{}},
		}))
	}

	success(gen, 500)
	first, block := successStamp(t, s, engine, acct)
	require.NotNil(t, first, "a first success stamps the freshness time")
	require.EqualValues(t, 500, block)

	// THE REPLAY LEG: the same execution block again. The stale-failover guard
	// admits it (execBlock == last_success_block), the row is rewritten, attempts
	// increments — and the freshness stamp must come back BYTE-IDENTICAL.
	success(gen, 500)
	replayed, block := successStamp(t, s, engine, acct)
	require.NotNil(t, replayed)
	require.Equal(t, *first, *replayed,
		"a replay at the same block observed no new chain state, so it must not refresh the freshness stamp")
	require.EqualValues(t, 500, block)
	var attempts int
	require.NoError(t, s.pool.QueryRow(ctx,
		`SELECT attempts FROM snapshot_sweeps WHERE engine = $1 AND account = $2`, engine, acct).Scan(&attempts))
	require.Equal(t, 2, attempts,
		"the replay really did rewrite the row — the stamp held because of the guard, not because nothing happened")

	// AND IT IS NOT SIMPLY FROZEN: a strictly higher block is a genuine new
	// observation and does refresh it.
	success(gen, 501)
	advanced, block := successStamp(t, s, engine, acct)
	require.NotNil(t, advanced)
	require.True(t, advanced.After(*first),
		"a strictly higher execution block IS a new observation and refreshes the stamp")
	require.EqualValues(t, 501, block)

	// A FAILURE touches neither field (invariant I3′): an attempt is not an
	// observation, so it must not be able to move the record either way.
	require.NoError(t, s.ApplySweepBatch(ctx, engine, gen, 600, []SweepResult{{Account: acct, OK: false}}))
	afterFailure, block := successStamp(t, s, engine, acct)
	require.NotNil(t, afterFailure)
	require.Equal(t, *advanced, *afterFailure, "a failed attempt must not restamp the last success")
	require.EqualValues(t, 501, block, "nor move the last success block")
}

// INVARIANT I4′ — the staleness boundary, pinned at bound ± 1s.
//
// Both rows are aged by the DATABASE clock in the same statement shape the judging
// query uses, because exact equality against a live clock is untestable: Postgres
// now() advances between the aging UPDATE and the judging SELECT, so a row written
// at exactly `now() - bound` lands on whichever side of the comparison the
// intervening microseconds put it. One second of margin each way is far larger than
// that drift and far smaller than any real bound.
//
// The NULL leg is the one that matters most: a NULL stamp means "this row predates
// migration 00006 and ended failed, or a rewind cleared it", and an unknown success
// time must count as STALE rather than as fresh-by-absence.
func TestCollateralStalenessBoundaryAndNullStamps(t *testing.T) {
	s := testDeriveStore(t)
	ctx := context.Background()
	engine := "debt_manager"
	fresh, stale, unknown, never := addr20(0xA1), addr20(0xA2), addr20(0xA3), addr20(0xA4)
	seedCollateralRegistry(t, s, engine, 100, fresh, stale, unknown, never)

	gen, err := s.OpenSweepGeneration(ctx, engine)
	require.NoError(t, err)
	require.NoError(t, s.ApplySweepBatch(ctx, engine, gen, 500, []SweepResult{
		{Account: fresh, OK: true, Balances: map[string]map[string]*big.Int{}},
		{Account: stale, OK: true, Balances: map[string]map[string]*big.Int{}},
		{Account: unknown, OK: true, Balances: map[string]map[string]*big.Int{}},
		{Account: never, OK: false},
	}))

	const bound = 30 * time.Minute
	// Age the two stamped rows relative to the DATABASE's own clock, one second
	// inside the bound and one second outside it.
	_, err = s.pool.Exec(ctx,
		`UPDATE snapshot_sweeps SET last_success_at = now() - make_interval(secs => $3::double precision)
		 WHERE engine = $1 AND account = $2`,
		engine, fresh, (bound - time.Second).Seconds())
	require.NoError(t, err)
	_, err = s.pool.Exec(ctx,
		`UPDATE snapshot_sweeps SET last_success_at = now() - make_interval(secs => $3::double precision)
		 WHERE engine = $1 AND account = $2`,
		engine, stale, (bound + time.Second).Seconds())
	require.NoError(t, err)
	// The NULL shape: a success BLOCK with no success TIME.
	_, err = s.pool.Exec(ctx,
		`UPDATE snapshot_sweeps SET last_success_at = NULL WHERE engine = $1 AND account = $2`, engine, unknown)
	require.NoError(t, err)

	p, found, err := s.SweepProgress(ctx, engine, collateralBudget, bound)
	require.NoError(t, err)
	require.True(t, found)
	require.Equal(t, int64(2), p.StaleSuccess,
		"one second PAST the bound counts, and a NULL stamp counts — one second INSIDE it does not")
	require.Equal(t, int64(1), p.NeverSucceeded, "the account that only ever failed has no success block at all")
	require.False(t, p.OldestSuccessAt.IsZero(),
		"the oldest surviving stamp is reported so the operator sees the age, not just the count")

	// The bound is the CALLER'S question, not a store constant: widening it past the
	// aged row's age reclassifies it, without any row changing.
	p, _, err = s.SweepProgress(ctx, engine, collateralBudget, bound+2*time.Minute)
	require.NoError(t, err)
	require.Equal(t, int64(1), p.StaleSuccess,
		"only the NULL stamp survives a wider bound: an unknown success time can never be certified fresh at any bound")

	// A non-positive bound cannot express the question and is refused rather than
	// defaulted — every default here would be a number nobody derived.
	_, _, err = s.SweepProgress(ctx, engine, collateralBudget, 0)
	require.ErrorContains(t, err, "must be positive")
	_, _, err = s.SweepProgress(ctx, engine, collateralBudget, -time.Second)
	require.ErrorContains(t, err, "must be positive")
}

// THE FINDING ITSELF: "preserve unresolved status across generation rollover, and
// clear it only after that account succeeds."
//
// This is what snapshot_failures could not do. Opening a new generation moves every
// row's generation stamp, so a current-generation failure count drops to zero the
// instant the rollover happens — with nothing about the account resolved. The
// usability counts are keyed on the success record, so a real OpenSweepGeneration
// leaves them untouched, and only a landed success for THAT account clears its
// membership.
func TestCollateralUnusableSurvivesGenerationRollover(t *testing.T) {
	s := testDeriveStore(t)
	ctx := context.Background()
	engine := "debt_manager"
	broken, ok := addr20(0xA1), addr20(0xA2)
	seedCollateralRegistry(t, s, engine, 100, broken, ok)

	gen, err := s.OpenSweepGeneration(ctx, engine)
	require.NoError(t, err)
	// `broken` burns its whole budget; `ok` succeeds.
	for i := 0; i < collateralBudget; i++ {
		require.NoError(t, s.ApplySweepBatch(ctx, engine, gen, 500+uint64(i), []SweepResult{
			{Account: broken, OK: false},
		}))
	}
	require.NoError(t, s.ApplySweepBatch(ctx, engine, gen, 510, []SweepResult{
		{Account: ok, OK: true, Balances: map[string]map[string]*big.Int{}},
	}))

	const bound = time.Hour
	p, _, err := s.SweepProgress(ctx, engine, collateralBudget, bound)
	require.NoError(t, err)
	require.Equal(t, int64(1), p.Exhausted, "the status-keyed count sees it while the generation is current")
	require.Equal(t, int64(1), p.NeverSucceeded, "and so does the success-keyed one")

	// THE ROLLOVER, through the real store transition.
	next, err := s.OpenSweepGeneration(ctx, engine)
	require.NoError(t, err)
	require.Greater(t, next, gen)

	p, _, err = s.SweepProgress(ctx, engine, collateralBudget, bound)
	require.NoError(t, err)
	require.Zero(t, p.Failed, "the status-keyed count went to zero on the rollover alone")
	require.Zero(t, p.Exhausted, "which is exactly the erasure the finding is about")
	require.Equal(t, int64(1), p.NeverSucceeded,
		"the usability count is untouched: nothing about that account was resolved by opening a generation")

	// AND IT CLEARS ONLY ON THAT ACCOUNT'S OWN SUCCESS. A success for the OTHER
	// account must not clear it — a per-account fact needs a per-account remedy.
	require.NoError(t, s.ApplySweepBatch(ctx, engine, next, 600, []SweepResult{
		{Account: ok, OK: true, Balances: map[string]map[string]*big.Int{}},
	}))
	p, _, err = s.SweepProgress(ctx, engine, collateralBudget, bound)
	require.NoError(t, err)
	require.Equal(t, int64(1), p.NeverSucceeded, "another account's success is not this account's success")

	require.NoError(t, s.ApplySweepBatch(ctx, engine, next, 601, []SweepResult{
		{Account: broken, OK: true, Balances: map[string]map[string]*big.Int{}},
	}))
	p, _, err = s.SweepProgress(ctx, engine, collateralBudget, bound)
	require.NoError(t, err)
	require.Zero(t, p.NeverSucceeded, "its own landed success is what clears it, and the only thing that does")
	require.Zero(t, p.StaleSuccess)
}

// THE NEITHER-SET LEG, which is what keeps the two gates genuinely complementary
// rather than one being a renaming of the other.
//
// An account can be EXHAUSTED (status='failed', budget spent — snapshot_failures
// fires) while its collateral is perfectly usable: it succeeded moments ago and then
// hit a transient revert. It must be in the exhausted count and in NEITHER usability
// count. A mutant that computed usability from `status` instead of from the success
// record would report it unusable here, and this leg is what kills that mutant.
func TestExhaustedFailureWithFreshCollateralIsInNeitherUsabilityCount(t *testing.T) {
	s := testDeriveStore(t)
	ctx := context.Background()
	engine := "debt_manager"
	acct := addr20(0xA1)
	seedCollateralRegistry(t, s, engine, 100, acct)

	gen, err := s.OpenSweepGeneration(ctx, engine)
	require.NoError(t, err)
	// A real, fresh success first...
	require.NoError(t, s.ApplySweepBatch(ctx, engine, gen, 500, []SweepResult{
		{Account: acct, OK: true, Balances: map[string]map[string]*big.Int{
			"00000000000000000000000000000000000000bb": {"collateral": big.NewInt(42)},
		}},
	}))
	// ...then the whole retry budget spent on transient reverts.
	for i := 0; i < collateralBudget; i++ {
		require.NoError(t, s.ApplySweepBatch(ctx, engine, gen, 501+uint64(i), []SweepResult{
			{Account: acct, OK: false},
		}))
	}

	p, found, err := s.SweepProgress(ctx, engine, collateralBudget, time.Hour)
	require.NoError(t, err)
	require.True(t, found)
	require.Equal(t, int64(1), p.Exhausted,
		"the account IS out of retries, which is what snapshot_failures reports")
	require.Zero(t, p.NeverSucceeded,
		"but its collateral was read successfully, so it is not in the never-succeeded set")
	require.Zero(t, p.StaleSuccess,
		"and that read is fresh, so it is not in the stale set either — the two gates answer different questions")
	require.Equal(t, map[string]string{"00000000000000000000000000000000000000bb/collateral": "42@500"},
		balanceRows(t, s, engine, acct, "snapshot"), "and the collateral figure really is there to serve")
}

// AMENDMENT A1 / INVARIANT I11 — THE REWIND CLAMP.
//
// RewindDerived deletes every snapshots history row above the effective target, but
// a SURVIVING account's snapshot_sweeps row kept claiming a success at a block the
// canonical chain no longer has. Two things followed, and both are load-bearing:
//
//   - ApplySweepBatch's monotonic guard compares the next honest success against
//     that phantom block. After a reorg the canonical head is BELOW it, so every
//     honest success is skipped as stale and the account WEDGES permanently —
//     nothing else lowers the number.
//   - the freshness stamp survived too, so the usability gate would have certified
//     exactly the accounts whose collateral the rewind had just invalidated.
//
// This drives the real RewindDerived and asserts all three consequences of the fix:
// the clamped account is counted unusable, its history is gone, and the next
// canonical success LANDS (proving the guard is un-wedged) and clears the count.
func TestRewindClampsSweepSuccessAboveTarget(t *testing.T) {
	s := testDeriveStore(t)
	ctx := context.Background()
	engine := "debt_manager"
	// Both accounts keep a debt event BELOW the rewind target, so both survive the
	// orphan deletion — the clamp is about survivors, not about orphans.
	high, low := addr20(0xA1), addr20(0xA2)
	seedCollateralRegistry(t, s, engine, 100, high, low)

	gen, err := s.OpenSweepGeneration(ctx, engine)
	require.NoError(t, err)
	// `low` succeeded at 400 (at or below the target — still canonical);
	// `high` succeeded at 900 (above the target — invalidated by the rewind).
	require.NoError(t, s.ApplySweepBatch(ctx, engine, gen, 400, []SweepResult{
		{Account: low, OK: true, Balances: map[string]map[string]*big.Int{}},
	}))
	require.NoError(t, s.ApplySweepBatch(ctx, engine, gen, 900, []SweepResult{
		{Account: high, OK: true, Balances: map[string]map[string]*big.Int{
			"00000000000000000000000000000000000000bb": {"collateral": big.NewInt(7)},
		}},
	}))

	const bound = time.Hour
	p, _, err := s.SweepProgress(ctx, engine, collateralBudget, bound)
	require.NoError(t, err)
	require.Zero(t, p.NeverSucceeded, "before the rewind both accounts have usable collateral")
	require.Zero(t, p.StaleSuccess)

	// THE REORG, through the real store transition.
	require.NoError(t, s.RewindDerived(ctx, engine, 10, 500))

	// (1) The clamped account is failed CLOSED into the never-succeeded set, and the
	// stamp is gone with the block — a fresh stamp beside a zeroed block would be
	// exactly the certification this amendment removes.
	at, block := successStamp(t, s, engine, high)
	require.Nil(t, at, "the freshness stamp of an invalidated observation must not survive it")
	require.Zero(t, block, "nor the block")
	at, block = successStamp(t, s, engine, low)
	require.NotNil(t, at, "an at-or-below-target success is still canonical and is left alone")
	require.EqualValues(t, 400, block)

	p, _, err = s.SweepProgress(ctx, engine, collateralBudget, bound)
	require.NoError(t, err)
	require.Equal(t, int64(1), p.NeverSucceeded,
		"the account whose only observation the rewind invalidated is now counted unusable")
	require.Zero(t, p.StaleSuccess, "and it is counted as never-succeeded, not as stale — there is no observation to age")

	// (2) The history that observation produced is gone.
	var n int
	require.NoError(t, s.pool.QueryRow(ctx,
		`SELECT count(*) FROM snapshots WHERE engine = $1 AND account = $2 AND block_number = 900`,
		engine, high).Scan(&n))
	require.Zero(t, n, "the rewind deleted the history above the target in the same transaction")
	// The position_balances SNAPSHOT rows deliberately survive — RewindDerived only
	// deletes them for accounts reorged out of the registry, and this account is
	// still in it. That is exactly why the clamp is the load-bearing half: a stale
	// collateral figure is still sitting in the table, describing a block that no
	// longer exists, and the ONLY thing stopping a reader treating it as current is
	// this gate reporting the account unusable.
	require.Equal(t, map[string]string{"00000000000000000000000000000000000000bb/collateral": "7@900"},
		balanceRows(t, s, engine, high, "snapshot"),
		"the invalidated collateral figure is still in position_balances, which is what the gate exists to flag")

	// (3) THE UN-WEDGING, which is the half a count alone cannot show. The rewind's
	// generation bump has already queued the re-sweep; a success at a CANONICAL
	// block (below the phantom 900) must now LAND rather than be skipped as stale.
	nextGen, open, _, err := s.SweepGeneration(ctx, engine)
	require.NoError(t, err)
	require.True(t, open, "the rewind's own bump opened the re-sweep durably")
	require.Greater(t, nextGen, gen)
	queue, err := s.SweepWorkBatch(ctx, engine, nextGen, collateralBudget, 10)
	require.NoError(t, err)
	require.Len(t, queue, 2, "both surviving accounts lag the new generation")

	require.NoError(t, s.ApplySweepBatch(ctx, engine, nextGen, 550, []SweepResult{
		{Account: high, OK: true, Balances: map[string]map[string]*big.Int{
			"00000000000000000000000000000000000000bb": {"collateral": big.NewInt(9)},
		}},
	}))
	at, block = successStamp(t, s, engine, high)
	require.NotNil(t, at, "the honest post-reorg success LANDED — without the clamp the guard would have skipped it forever")
	require.EqualValues(t, 550, block)
	require.Equal(t, map[string]string{"00000000000000000000000000000000000000bb/collateral": "9@550"},
		balanceRows(t, s, engine, high, "snapshot"),
		"and it replaced the stale figure wholesale")

	p, _, err = s.SweepProgress(ctx, engine, collateralBudget, bound)
	require.NoError(t, err)
	require.Zero(t, p.NeverSucceeded, "and the condition clears on that account's own success")
}

// LastPassDuration is the second input to the daemon's staleness bound, and the
// reason the bound cannot be a constant: SweepWorkBatch never re-selects a
// current-generation success, so an account is re-read once per full pass and a
// bound ignoring the achieved pass duration is permanently exceeded on a healthy
// system.
//
// The duration is stamped DURABLY by the same guarded UPDATE that closes a
// generation (migration 00008), so it survives the next open. Before that it was
// derived from completed_at - opened_at and was therefore destroyed the instant
// OpenSweepGeneration NULLed completed_at, leaving the daemon's process memory as
// the only copy — Codex round 9's restart finding, and the reason the final leg of
// this test now asserts the opposite of what it used to.
func TestSweepProgressReportsAchievedPassDuration(t *testing.T) {
	s := testDeriveStore(t)
	ctx := context.Background()
	engine := "debt_manager"
	seedCollateralRegistry(t, s, engine, 100, addr20(0xA1))

	gen, err := s.OpenSweepGeneration(ctx, engine)
	require.NoError(t, err)
	p, _, err := s.SweepProgress(ctx, engine, collateralBudget, time.Hour)
	require.NoError(t, err)
	require.Zero(t, p.LastPassDuration, "no generation has EVER completed, so there is no achieved cadence to report")

	// Back-date the open time so the completed pass has a measurable duration
	// (the alternative is sleeping, which pins nothing extra).
	_, err = s.pool.Exec(ctx,
		`UPDATE sweep_generations SET opened_at = now() - interval '25 minutes' WHERE engine = $1`, engine)
	require.NoError(t, err)
	_, stamped, err := s.CompleteSweepGeneration(ctx, engine, gen)
	require.NoError(t, err)
	require.True(t, stamped)

	p, _, err = s.SweepProgress(ctx, engine, collateralBudget, time.Hour)
	require.NoError(t, err)
	require.InDelta(t, (25 * time.Minute).Seconds(), p.LastPassDuration.Seconds(), 5,
		"a completed generation reports completed_at - opened_at, which is what the pass actually took")

	closed := p.LastPassDuration

	// REOPENING CLEARS completed_at — and used to clear the only surviving record of
	// the achieved cadence with it. That is the restart-continuity defect: from this
	// instant the store reported zero, so the daemon's in-memory copy was the only
	// thing standing between a restart and a collapsed bound, and a restart is
	// exactly what memory does not survive. The durable column is named by no
	// statement that opens a generation, so the fact outlives the open.
	_, err = s.OpenSweepGeneration(ctx, engine)
	require.NoError(t, err)
	p, _, err = s.SweepProgress(ctx, engine, collateralBudget, time.Hour)
	require.NoError(t, err)
	require.True(t, p.Open, "the generation really is open again: completed_at is gone")
	require.Equal(t, closed, p.LastPassDuration,
		"an OPEN generation still reports the last COMPLETED pass, byte-identically: a process that restarts here judges with the same bound its predecessor had")

	// And the same fact is readable through the narrow hydration path the daemon
	// uses before its first verdict.
	d, found, err := s.SweepLastPassDuration(ctx, engine)
	require.NoError(t, err)
	require.True(t, found)
	require.Equal(t, closed, d)
}
