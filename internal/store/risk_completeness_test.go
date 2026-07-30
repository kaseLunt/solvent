package store

// Completeness: one INDEPENDENT negative per mandatory relation.
//
// NewestCompleteBatch exists to guard against torn batches, so a guard that does
// not guard its own premise is a false pass — worse than no guard, because it is
// believed. The original predicate checked only the position count and that SOME
// watermark existed, which meant a partial restore holding every position header
// but no price disclosures and no aggregates was selected as complete: a stored
// health factor served with NO input evidence, and a book total that reads empty.
//
// # DECLARED vs ACTUAL is the whole shape of the bug
//
// A torn batch is one whose writer PROMISED n children and whose storage HOLDS
// fewer — a restore that stopped halfway, a manual delete, a hand-written row.
// So the fixture below carries the two numbers SEPARATELY, and each negative
// drops an ACTUAL child while leaving the DECLARED count intact. Conflating them
// is not a small mistake: a fixture that lowers both stays self-consistent, is
// correctly judged COMPLETE, and the test then passes for a reason that has
// nothing to do with what it claims to check.

import (
	"context"
	"testing"

	"github.com/stretchr/testify/require"
)

// syntheticBatch describes a batch inserted WITHOUT WriteRiskBatch. That is the
// point: WriteRiskBatch cannot produce a torn batch, and the serving predicate
// must still refuse one that arrives by restore, manual delete, or a
// hand-written row.
type syntheticBatch struct {
	// Declared* are what the batch row CLAIMS.
	declaredPositions  int
	declaredLegs       int
	declaredPrices     int
	declaredAggregates int
	declaredAggPos     int
	// requiredSweepEngines are the engines whose stamp MUST carry a complete sweep
	// payload; sweepEngines are the ones that actually get one.
	requiredSweepEngines []string
	sweepEngines         []string
	// actual* are what is really inserted.
	actualPositions  int
	actualLegs       int
	actualPrices     int
	actualAggregates int

	requiredEngines []string
	stampEngines    []string
}

func insertSyntheticBatch(t *testing.T, s *Store, spec syntheticBatch) int64 {
	t.Helper()
	ctx := context.Background()
	var id int64
	require.NoError(t, s.pool.QueryRow(ctx, `SELECT nextval('risk_batches_id_seq')`).Scan(&id))

	required := spec.requiredEngines
	if required == nil {
		// NOT NULL column: an absent set is the EMPTY array, which is precisely
		// the "nothing required" state the predicate must reject.
		required = []string{}
	}

	// The parent goes first here because each statement is its own transaction;
	// WriteRiskBatch writes children first inside ONE transaction, which the
	// deferred FKs permit.
	_, err := s.pool.Exec(ctx, `INSERT INTO risk_batches
		(id, status, position_count, leg_count, price_input_count, aggregate_count,
		 required_engines, materialization_key, required_sweep_engines)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
		id, RiskBatchComplete, spec.declaredPositions, spec.declaredLegs,
		spec.declaredPrices, spec.declaredAggregates, required, newTestKey(),
		nonNilStrings(spec.requiredSweepEngines))
	require.NoError(t, err)

	sweepy := map[string]bool{}
	for _, e := range spec.sweepEngines {
		sweepy[e] = true
	}
	for _, e := range spec.stampEngines {
		if sweepy[e] {
			_, err = s.pool.Exec(ctx, `INSERT INTO risk_batch_watermarks
				(batch_id, engine, chain_id, last_block, acked_epoch, max_epoch_at_compute,
				 sweep_rows, sweep_failed, sweep_success_sum, sweep_generation,
				 sweep_generation_open, sweep_applicable)
				VALUES ($1,$2,10,154796552,4,4, 1, 0, 154790000, 3, false, true)`, id, e)
		} else {
			_, err = s.pool.Exec(ctx, `INSERT INTO risk_batch_watermarks
				(batch_id, engine, chain_id, last_block, acked_epoch, max_epoch_at_compute)
				VALUES ($1,$2,1,25635700,4,4)`, id, e)
		}
		require.NoError(t, err)
	}

	accounts := make([][]byte, 0, spec.actualPositions)
	for i := 0; i < spec.actualPositions; i++ {
		acct := addr20(byte(0xD0 + i))
		accounts = append(accounts, acct)
		_, err = s.pool.Exec(ctx, `INSERT INTO risk_positions
			(batch_id, engine, account, status, value_decimals, balances_block, params_block)
			VALUES ($1,$2,$3,$4,8,25635700,25635700)`,
			id, riskAaveEngine, acct, RiskPositionComputed)
		require.NoError(t, err)
	}
	for i := 0; i < spec.actualLegs && i < len(accounts); i++ {
		_, err = s.pool.Exec(ctx, `INSERT INTO risk_position_legs
			(batch_id, engine, account, asset, decimals) VALUES ($1,$2,$3,$4,18)`,
			id, riskAaveEngine, accounts[i], addr20(0xC1))
		require.NoError(t, err)
	}
	for i := 0; i < spec.actualPrices && i < len(accounts); i++ {
		_, err = s.pool.Exec(ctx, `INSERT INTO risk_price_inputs
			(batch_id, engine, account, asset, chain_id, source, provenance, budget_seconds, verdict)
			VALUES ($1,$2,$3,$4,1,$5,'adapter-output',180,'fresh')`,
			id, riskAaveEngine, accounts[i], addr20(0xC1), riskAaveOracleSource)
		require.NoError(t, err)
	}
	for i := 0; i < spec.actualAggregates; i++ {
		_, err = s.pool.Exec(ctx, `INSERT INTO risk_batch_aggregates
			(batch_id, engine, value_decimals, positions, computed_positions,
			 refused_positions, flagged_positions, liquidatable_positions,
			 total_collateral, total_debt)
			VALUES ($1,$2,8,$3,$3,0,0,0,0,0)`, id, riskAaveEngine, spec.declaredAggPos)
		require.NoError(t, err)
	}
	return id
}

// wholeSynthetic is a fully coherent synthetic batch: every declared count equals
// its actual, every required engine is stamped, aggregates account for every
// position. It is the CONTROL — if this did not pass, the negatives would prove
// nothing.
func wholeSynthetic() syntheticBatch {
	return syntheticBatch{
		declaredPositions: 2, actualPositions: 2,
		declaredLegs: 2, actualLegs: 2,
		declaredPrices: 2, actualPrices: 2,
		declaredAggregates: 1, actualAggregates: 1,
		declaredAggPos:  2,
		requiredEngines: []string{riskAaveEngine, riskPollEngine1},
		stampEngines:    []string{riskAaveEngine, riskPollEngine1},
	}
}

func TestNewestCompleteBatchAcceptsAWholeSyntheticBatch(t *testing.T) {
	s := testRiskStore(t)
	ctx := context.Background()
	id := insertSyntheticBatch(t, s, wholeSynthetic())

	batch, found, err := s.NewestCompleteBatch(ctx)
	require.NoError(t, err)
	require.True(t, found)
	require.Equal(t, id, batch.ID,
		"the CONTROL must be servable, or every negative below is vacuous")
}

// TestNewestCompleteBatchDisqualifiesEachBrokenRelation breaks exactly one
// relation per case, always by dropping an ACTUAL child while the DECLARED count
// stands. In every case the broken batch is the NEWEST, and the older whole batch
// must be served instead.
//
// MUTANT EACH CASE KILLS: remove the corresponding conjunct from
// NewestCompleteBatch's predicate and exactly one case below fails. The
// pre-fix predicate (positions + "some watermark") fails five of the seven.
func TestNewestCompleteBatchDisqualifiesEachBrokenRelation(t *testing.T) {
	cases := []struct {
		name   string
		why    string
		broken func(b *syntheticBatch)
	}{
		{
			name:   "missing positions",
			why:    "1 of 2 declared position headers present — the original check, retained",
			broken: func(b *syntheticBatch) { b.actualPositions = 1 },
		},
		{
			name:   "missing legs",
			why:    "positions all present but a declared per-asset leg absent: that reserve's own index as-of is gone",
			broken: func(b *syntheticBatch) { b.actualLegs = 1 },
		},
		{
			name:   "missing price disclosures",
			why:    "a stored health factor with NO input evidence behind it",
			broken: func(b *syntheticBatch) { b.actualPrices = 0 },
		},
		{
			name:   "missing aggregates",
			why:    "book totals would read empty over a populated batch",
			broken: func(b *syntheticBatch) { b.actualAggregates = 0 },
		},
		{
			name:   "missing a required stamp",
			why:    "supersession is judged PER ENGINE; an unstamped engine cannot be judged at all",
			broken: func(b *syntheticBatch) { b.stampEngines = []string{riskAaveEngine} },
		},
		{
			name:   "aggregates undercount positions",
			why:    "a book total that silently omits a position",
			broken: func(b *syntheticBatch) { b.declaredAggPos = 1 },
		},
		{
			name:   "no required engines declared",
			why:    "an empty required set would make the stamp check vacuous",
			broken: func(b *syntheticBatch) { b.requiredEngines = nil },
		},
	}

	for _, tc := range cases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			s := testRiskStore(t)
			ctx := context.Background()

			goodID, err := s.WriteRiskBatch(ctx, sampleBatch(10))
			require.NoError(t, err)

			spec := wholeSynthetic()
			tc.broken(&spec)
			brokenID := insertSyntheticBatch(t, s, spec)
			require.Greater(t, brokenID, goodID, "the broken batch must be the NEWEST")

			batch, found, err := s.NewestCompleteBatch(ctx)
			require.NoError(t, err)
			require.True(t, found)
			require.Equal(t, goodID, batch.ID,
				"the newest batch is incomplete (%s: %s); the older WHOLE batch must be served instead",
				tc.name, tc.why)
		})
	}
}

// ---------------------------------------------------------------------------
// Sweep applicability: a required sweep disclosure cannot be absent or partial.
// ---------------------------------------------------------------------------
//
// The gap this closes: "every required engine has a watermark row" was satisfied
// by a debt_manager row carrying ONLY cursor fields. The sweep columns must stay
// nullable — Aave genuinely has no sweeper — so a restored batch could omit the
// sweep payload, pass every count and required-engine check, and read back with
// Sweep nil. A swept engine then looks exactly like an unswept one, no consumer
// can compare the batch against later sweep movement, and hour-stale Debt Manager
// collateral becomes servable as current.

// TestNewestCompleteBatchRejectsMissingRequiredSweepDisclosure: the DM engine is
// declared to require a sweep disclosure and its stamp carries none.
//
// MUTANT THIS KILLS: drop the required_sweep_engines conjunct from
// NewestCompleteBatch. The batch below then passes every other check — counts,
// required engines, aggregates — and is served with a DM stamp that cannot be
// compared against later sweep movement.
func TestNewestCompleteBatchRejectsMissingRequiredSweepDisclosure(t *testing.T) {
	s := testRiskStore(t)
	ctx := context.Background()

	goodID, err := s.WriteRiskBatch(ctx, sampleBatch(10))
	require.NoError(t, err)

	spec := wholeSynthetic()
	spec.stampEngines = append(spec.stampEngines, riskDMEngine)
	spec.requiredEngines = append(spec.requiredEngines, riskDMEngine)
	// DM is DECLARED to require a sweep disclosure...
	spec.requiredSweepEngines = []string{riskDMEngine}
	// ...but is NOT given one.
	spec.sweepEngines = nil
	brokenID := insertSyntheticBatch(t, s, spec)
	require.Greater(t, brokenID, goodID)

	batch, found, err := s.NewestCompleteBatch(ctx)
	require.NoError(t, err)
	require.True(t, found)
	require.Equal(t, goodID, batch.ID,
		"a required sweep disclosure that is ABSENT must disqualify the batch")
}

// TestRiskBatchWatermarkRejectsPartialSweepPayload: the row-level CHECK makes a
// half-filled sweep payload unrepresentable, so the "partial columns" shape
// cannot even be stored.
//
// A partial payload is not a degraded disclosure — it is an uninterpretable one:
// a NULL could mean "no sweeper", "not recorded", or "zero", and each licenses a
// different conclusion about freshness.
func TestRiskBatchWatermarkRejectsPartialSweepPayload(t *testing.T) {
	s := testRiskStore(t)
	ctx := context.Background()

	id, err := s.WriteRiskBatch(ctx, sampleBatch(10))
	require.NoError(t, err)

	// applicable=true with only SOME sweep columns present.
	_, err = s.pool.Exec(ctx, `INSERT INTO risk_batch_watermarks
		(batch_id, engine, chain_id, last_block, acked_epoch, max_epoch_at_compute,
		 sweep_rows, sweep_applicable)
		VALUES ($1, 'partial_engine', 10, 1, 0, 0, 1, true)`, id)
	require.Error(t, err, "an applicable row missing sweep columns must be refused by the CHECK")
	require.Contains(t, err.Error(), "sweep_all_or_nothing")

	// The mirror image: not applicable, yet carrying sweep data.
	_, err = s.pool.Exec(ctx, `INSERT INTO risk_batch_watermarks
		(batch_id, engine, chain_id, last_block, acked_epoch, max_epoch_at_compute,
		 sweep_rows, sweep_failed, sweep_success_sum, sweep_generation,
		 sweep_generation_open, sweep_applicable)
		VALUES ($1, 'contradictory_engine', 10, 1, 0, 0, 1, 0, 5, 1, false, false)`, id)
	require.Error(t, err, "a non-applicable row carrying sweep data is equally uninterpretable")
	require.Contains(t, err.Error(), "sweep_all_or_nothing")
}

// TestNewestCompleteBatchAcceptsNoSweeperStamp is the POSITIVE CONTROL, and the
// reason the tightening above had to be scoped rather than blanket: the Aave
// engine has NO collateral sweeper, its stamp legitimately carries no sweep
// payload, and that must remain servable. "No sweeper" and "swept nothing" stay
// different facts.
func TestNewestCompleteBatchAcceptsNoSweeperStamp(t *testing.T) {
	s := testRiskStore(t)
	ctx := context.Background()

	spec := wholeSynthetic()
	spec.stampEngines = append(spec.stampEngines, riskDMEngine)
	spec.requiredEngines = append(spec.requiredEngines, riskDMEngine)
	spec.requiredSweepEngines = []string{riskDMEngine}
	spec.sweepEngines = []string{riskDMEngine} // only DM gets one
	id := insertSyntheticBatch(t, s, spec)

	batch, found, err := s.NewestCompleteBatch(ctx)
	require.NoError(t, err)
	require.True(t, found)
	require.Equal(t, id, batch.ID,
		"Aave's sweeper-less stamp must NOT disqualify a batch — it is not a missing disclosure")

	var dmSweep, aaveSweep *RiskSweepWatermark
	for _, w := range batch.Watermarks {
		switch w.Engine {
		case riskDMEngine:
			dmSweep = w.Sweep
		case riskAaveEngine:
			aaveSweep = w.Sweep
		}
	}
	require.NotNil(t, dmSweep, "the swept engine reads back WITH its disclosure")
	require.Nil(t, aaveSweep, "and the sweeper-less engine reads back with none — a real distinction, preserved")
}

// TestWriteRiskBatchRefusesUndisclosedRequiredSweep: the same law at WRITE time,
// so a producer cannot create the state in the first place.
func TestWriteRiskBatchRefusesUndisclosedRequiredSweep(t *testing.T) {
	s := testRiskStore(t)
	ctx := context.Background()

	b := sampleBatch(10)
	b.RequiredSweepEngines = []string{riskAaveEngine} // Aave has no sweeper to disclose
	_, err := s.WriteRiskBatch(ctx, b)
	require.ErrorIs(t, err, ErrRiskBatchIncomplete)
	require.Contains(t, err.Error(), "requires a sweep disclosure")
}

// TestNewestCompleteBatchRequiresWatermarks: a batch with no stamp vector at all
// cannot be checked for supersession, so it is not disclosable.
func TestNewestCompleteBatchRequiresWatermarks(t *testing.T) {
	s := testRiskStore(t)
	ctx := context.Background()

	goodID, err := s.WriteRiskBatch(ctx, sampleBatch(10))
	require.NoError(t, err)

	unstamped := insertSyntheticBatch(t, s, syntheticBatch{
		requiredEngines: []string{riskAaveEngine},
	})
	require.Greater(t, unstamped, goodID)

	batch, found, err := s.NewestCompleteBatch(ctx)
	require.NoError(t, err)
	require.True(t, found)
	require.Equal(t, goodID, batch.ID, "an unstamped batch has no supersession legs and is unservable")
}

// TestWriteRiskBatchRefusesAggregateMismatch: the same coherence law, enforced at
// WRITE time so the disagreement is a loud refusal rather than a batch the
// serving path skips forever in silence.
func TestWriteRiskBatchRefusesAggregateMismatch(t *testing.T) {
	s := testRiskStore(t)
	ctx := context.Background()

	b := sampleBatch(10)
	b.Aggregates[0].Positions = 5 // 5 + 1 != 2 positions
	_, err := s.WriteRiskBatch(ctx, b)
	require.ErrorIs(t, err, ErrRiskBatchIncomplete)
	require.Contains(t, err.Error(), "account for")

	_, found, err := s.NewestCompleteBatch(ctx)
	require.NoError(t, err)
	require.False(t, found, "the refusal left nothing behind")
}

// TestWriteRiskBatchRefusesUnstampedRequiredEngine: an explicit required set that
// names an engine with no stamp would produce a batch that can never be served.
func TestWriteRiskBatchRefusesUnstampedRequiredEngine(t *testing.T) {
	s := testRiskStore(t)
	ctx := context.Background()

	b := sampleBatch(10)
	b.RequiredEngines = []string{riskAaveEngine, "an_engine_nobody_stamped"}
	_, err := s.WriteRiskBatch(ctx, b)
	require.ErrorIs(t, err, ErrRiskBatchIncomplete)
	require.Contains(t, err.Error(), "an_engine_nobody_stamped")
}

// TestCompletenessPredicateStatusLiteralMatchesTheConstant guards the one thing
// the shared SQL fragment cannot express in Go: it hard-codes 'complete', and if
// RiskBatchComplete were ever renamed the predicate would silently match nothing
// and NewestCompleteBatch would report "no batch" forever.
func TestCompletenessPredicateStatusLiteralMatchesTheConstant(t *testing.T) {
	require.Equal(t, "complete", RiskBatchComplete)
	require.Contains(t, riskBatchCompleteConjuncts, "b.status = 'complete'")
}

// TestAdoptionRejectsAnIncompleteRestoredBatch is the round-3 [medium] #4 finding.
//
// An honest partial restore leaves a batch header whose materialization identity
// MATCHES, with children missing. Adoption used to verify only the header, so riskd
// reported a successful materialization for a batch the reader then refused — the
// vector recorded as handled, and no current complete result anywhere.
//
// The chosen remedy is REPLACE rather than refuse, because refusing livelocks: the
// same deterministic identity is derived on every subsequent pass, so the same
// incomplete header would be refused forever until a human deleted a row. Replacing
// is safe because the batch is unservable (nothing was disclosed from it), the
// identity is verified equal (same materialization), and the delete happens inside
// the write transaction (no instant with neither batch).
//
// MUTANT THIS KILLS: drop the completeness check from adoptRiskBatch. The write
// then returns the incomplete id as a success, the batch count stays at the damaged
// one, and NewestCompleteBatch still finds nothing servable.
func TestAdoptionRejectsAnIncompleteRestoredBatch(t *testing.T) {
	s := testRiskStore(t)
	ctx := context.Background()

	key := newTestKey()
	original, err := s.WriteRiskBatch(ctx, sampleBatchKeyed(10, key))
	require.NoError(t, err)

	// THE PARTIAL RESTORE: the header survives, its price disclosures do not.
	_, err = s.pool.Exec(ctx, `DELETE FROM risk_price_inputs WHERE batch_id = $1`, original)
	require.NoError(t, err)

	_, found, err := s.NewestCompleteBatch(ctx)
	require.NoError(t, err)
	require.False(t, found, "the damaged batch is correctly unservable")

	// The next pass derives the SAME identity and must heal rather than adopt.
	healed, err := s.WriteRiskBatch(ctx, sampleBatchKeyed(10, key))
	require.NoError(t, err)
	require.NotEqual(t, original, healed,
		"the unservable batch is REPLACED, so the healed batch has a new id")

	var n int
	require.NoError(t, s.pool.QueryRow(ctx, `SELECT count(*) FROM risk_batches`).Scan(&n))
	require.Equal(t, 1, n, "the damaged batch is gone, not accumulated beside its replacement")

	batch, found, err := s.NewestCompleteBatch(ctx)
	require.NoError(t, err)
	require.True(t, found, "a COMPLETE, servable batch now exists — the daemon healed itself")
	require.Equal(t, healed, batch.ID)

	prices, err := s.RiskBatchPriceInputs(ctx, healed)
	require.NoError(t, err)
	require.NotEmpty(t, prices, "and its disclosures are back")
}

// TestAdoptionOfACompleteBatchStillAdopts is the control: the replace path must not
// fire on a healthy batch, or every pass would rewrite the book.
func TestAdoptionOfACompleteBatchStillAdopts(t *testing.T) {
	s := testRiskStore(t)
	ctx := context.Background()

	key := newTestKey()
	first, err := s.WriteRiskBatch(ctx, sampleBatchKeyed(10, key))
	require.NoError(t, err)
	second, err := s.WriteRiskBatch(ctx, sampleBatchKeyed(10, key))
	require.NoError(t, err)
	require.Equal(t, first, second, "a COMPLETE batch is adopted, never replaced")

	var n int
	require.NoError(t, s.pool.QueryRow(ctx, `SELECT count(*) FROM risk_batches`).Scan(&n))
	require.Equal(t, 1, n)
}

// TestAdoptionRejectsEachIncompleteRelation: the adoption path applies the WHOLE
// serving predicate, not a subset of it.
func TestAdoptionRejectsEachIncompleteRelation(t *testing.T) {
	for _, tc := range []struct {
		name   string
		damage string
	}{
		{"positions", `DELETE FROM risk_positions WHERE batch_id = $1`},
		{"legs", `DELETE FROM risk_position_legs WHERE batch_id = $1`},
		{"price disclosures", `DELETE FROM risk_price_inputs WHERE batch_id = $1`},
		{"aggregates", `DELETE FROM risk_batch_aggregates WHERE batch_id = $1`},
		{"watermark stamps", `DELETE FROM risk_batch_watermarks WHERE batch_id = $1`},
	} {
		t.Run(tc.name, func(t *testing.T) {
			s := testRiskStore(t)
			ctx := context.Background()

			key := newTestKey()
			original, err := s.WriteRiskBatch(ctx, sampleBatchKeyed(10, key))
			require.NoError(t, err)
			_, err = s.pool.Exec(ctx, tc.damage, original)
			require.NoError(t, err)

			healed, err := s.WriteRiskBatch(ctx, sampleBatchKeyed(10, key))
			require.NoError(t, err)
			require.NotEqual(t, original, healed,
				"a batch missing its %s is unservable and must be replaced, not adopted", tc.name)

			_, found, err := s.NewestCompleteBatch(ctx)
			require.NoError(t, err)
			require.True(t, found, "and the replacement is servable")
		})
	}
}

// TestWriteRiskBatchRequiresAnIdempotencyKey: without one, an ambiguous commit
// cannot be reconciled and a retry silently double-writes.
func TestWriteRiskBatchRequiresAnIdempotencyKey(t *testing.T) {
	s := testRiskStore(t)
	ctx := context.Background()

	b := sampleBatch(10)
	b.MaterializationKey = ""
	_, err := s.WriteRiskBatch(ctx, b)
	require.ErrorIs(t, err, ErrRiskBatchIncomplete)
	require.Contains(t, err.Error(), "materialization key")
}
