package ingest

// Task 9 wave 17 — the probe OUTCOME DISCIPLINE regressions (Codex round-15
// findings 1-4 as corrected by the chain-truth round-15 consult; schedules
// R-A through R-G plus the note-level R-I/R-J guards; R-H lives in
// internal/chain/chain_timed_from_test.go).
//
// THE LAW UNDER TEST, the consult's corrected total ordering: every probe
// Step's outcome is TOTAL AND TERMINAL —
//
//   - LANDED strictly faster (per-witness Σ-attempts) → ADOPT;
//   - LANDED no faster / tie, CAUGHT-UP, FALL-THROUGH to the incumbent →
//     REJECT: lease re-arms IN FULL, probe-target cursor advances, routing
//     untouched (startPref never moved);
//   - NON-LANDING with a resolved witness → the wave-12 seam arm VERBATIM:
//     advance past the probe witness, lease dissolves (at n=2 this IS
//     return-to-incumbent; at n>=3 it is the escape past a content-broken
//     neighbour — the reject-on-failure ordering is REFUTED);
//   - WITNESS-LESS total failure → the seam's witness-less arm: startPref
//     unchanged, lease PRESERVED (the round-2 law's antecedent is
//     unsatisfied — a witness-less failure is evidence about nobody).
//
// Every fixture is a state a real endpoint fleet can be in (fixture-realism
// law): a frozen-head neighbour, a hung-to-timeout provider, a network blip,
// a minority fork view below finality, a slow Postgres commit.

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/ethereum/go-ethereum/common"
	"github.com/stretchr/testify/require"
)

// probeHarness builds an n-endpoint latency schedule: every view fully
// synced and content-healthy, per-read costs scripted per endpoint, the
// walker's clock wired to the fake's (the wave-14 latencyHarness generalized
// to n endpoints for the round-15 n>=3 schedules).
func probeHarness(t *testing.T, costs ...time.Duration) (*fakeEndpointChain, *fakeStore, *Walker, *stepClock) {
	t.Helper()
	clk := newStepClock()
	ch := newFakeEndpointChain(len(costs)).setHeadAll(1000).canonAll()
	for i, c := range costs {
		ch.view(i).readCost = c
	}
	ch.advanceClock = clk.advance
	st := &fakeStore{}
	w := walker(ch, st)
	w.now = clk.now
	return ch, st, w, clk
}

// landSteps drives count Steps that must all LAND, failing loudly otherwise.
func landSteps(t *testing.T, w *Walker, count int, what string) {
	t.Helper()
	for i := 0; i < count; i++ {
		advanced, err := w.Step(context.Background())
		require.NoError(t, err, "%s: step %d must land", what, i+1)
		require.True(t, advanced, "%s: step %d must land", what, i+1)
	}
}

// R-A — CODEX ROUND-15 FINDING 1, VERBATIM: incumbent A lands slowly with
// windows available; probe B reports a FROZEN head whose safe height equals
// the durable cursor while A keeps advancing. Pre-fix the caught-up probe
// left the armed lease untouched, so every subsequent Step probed frozen B
// and returned caught-up forever — cursor frozen, healthy incumbent never
// revisited, durable freshness red with no repair. THE FIX (R15-1): a
// caught-up probe carries ZERO landing-latency evidence and is REJECTED —
// the lease re-arms in full and the armed state lives exactly ONE Step.
func TestFrozenNeighbourCaughtUpProbeIsRejectedAndTheLeaseReArms(t *testing.T) {
	slowRead := chainAttemptTimeout - time.Second
	ch, st, w, _ := probeHarness(t, slowRead, 0)
	// B is FROZEN: its head sits exactly where safe==cursor will be after
	// three landed windows (100..249 at window 50), and its chain simply
	// stops at that head — heights above it answer honest not-found, heights
	// at or below it are canonical (a frozen node is stale, not forked).
	vB := ch.view(1)
	vB.head = 254 // cursor 249 + confirmations 5
	vB.canon = false
	vB.hashes[249] = blockHashAt(249)

	// Steps 1-3: three slow landings on A spend the lease.
	landSteps(t, w, 3, "lease spend")
	require.Equal(t, uint64(249), st.cursor.Block)

	// Step 4: the probe. B answers caught-up (safe == cursor) — zero
	// landing-latency evidence. NOT an error, NOT an advance; REJECTED.
	advanced, err := w.Step(context.Background())
	require.NoError(t, err, "a caught-up probe is an honest caught-up, not a failure")
	require.False(t, advanced)
	// R15-8, the disclosed one-Step residual: the probe Step stamped the
	// readiness observation from the probed (frozen) witness…
	head, seen := w.ObservedHead()
	require.True(t, seen)
	require.Equal(t, uint64(254), head, "one-Step readiness residual from the probed witness (R15-8, disclosed)")

	// Steps 5-7: the armed state lived exactly ONE Step — the stream is back
	// on the incumbent, landing and advancing, while the lease re-spends.
	landSteps(t, w, 3, "post-rejection")
	require.Equal(t, uint64(399), st.cursor.Block, "the cursor advances every non-probe Step — the finding's frozen-cursor wedge is dead")
	head, _ = w.ObservedHead()
	require.Equal(t, uint64(1000), head, "…and the incumbent's next Step corrected it")

	// Step 8: the next spent lease probes B again — one probe per spent
	// lease, bounded and periodic. This time the cursor (399) sits above
	// B's frozen chain: B cannot serve the pinned reorg check, the walk
	// rotates to A, and the token mismatch is a coherence DISCARD — a
	// witnessed non-landing through the seam, never a wedge.
	advanced, err = w.Step(context.Background())
	var discard *DiscardError
	require.ErrorAs(t, err, &discard, "a frozen-below neighbour cannot serve the pinned reorg check: coherence discard")
	require.False(t, advanced)

	require.Equal(t, []int{0, 0, 0, 1, 0, 0, 0, 1}, ch.blockStarts,
		"THE ARMED STATE LIVES ONE STEP: probe, reject, three fresh landings on the incumbent, probe again — never probe-forever")
	require.Equal(t, 0, w.startPref, "routing never moved: every rejection is a routing no-op")
	require.Equal(t, 0, ch.active, "the shared hint is neither consulted nor written")
}

// R-B — CODEX ROUND-15 FINDING 2, VERBATIM: A lands six 29-second reads per
// Step (T-1s, inside the blind spot), B HANGS to the attempt timeout on
// every ask (down + readCost=T — spend charges before the down check, the
// real hung-provider posture). Pre-fix the fall-through probe left the lease
// spent, so EVERY Step re-probed B and paid its timeout — the ~17-minute
// round, worse than the original starvation. THE FIX (R15-2a): a
// fall-through probe re-arms the lease in full; the liveness owed a
// recovering neighbour is paid ONCE per spent lease, at the next expiry.
func TestFallThroughProbeReArmsAndTheTimeoutTaxIsPaidOncePerLease(t *testing.T) {
	slowRead := chainAttemptTimeout - time.Second
	ch, st, w, clk := probeHarness(t, slowRead, 0)
	vB := ch.view(1)
	vB.down = errors.New("connection hangs until the attempt deadline")
	vB.readCost = chainAttemptTimeout // hung-to-timeout: the full T is paid before the failure

	slowStepWall := stepMaxPinnedReads * slowRead
	var stepWalls []time.Duration
	for i := 0; i < 8; i++ {
		before := clk.now()
		advanced, err := w.Step(context.Background())
		require.NoError(t, err, "step %d: every Step of the schedule LANDS — the probe costs no landing", i+1)
		require.True(t, advanced, "step %d", i+1)
		stepWalls = append(stepWalls, clk.now().Sub(before))
	}

	require.Equal(t, []int{0, 0, 0, 1, 0, 0, 0, 1}, ch.blockStarts,
		"one fall-through probe per spent lease, then three quiet landings — never a probe every Step")
	require.Equal(t, uint64(499), st.cursor.Block, "all 8 windows landed")
	require.Equal(t, 0, w.startPref)

	// CLOCK ARITHMETIC, exact: B's timeout is paid on the two probe Steps
	// and NOWHERE else — the per-Step timeout tax of the finding is gone.
	// (Step 1 is the fresh walk: no reorg check and no cursor recheck, so
	// its shape is four reads, not six.)
	require.Equal(t, 4*slowRead, stepWalls[0], "fresh-walk step: four pinned reads, no B contact")
	for _, i := range []int{1, 2, 4, 5, 6} {
		require.Equal(t, slowStepWall, stepWalls[i],
			"step %d wall excludes B's timeout entirely", i+1)
	}
	for _, i := range []int{3, 7} {
		require.Equal(t, chainAttemptTimeout+slowStepWall, stepWalls[i],
			"probe step %d pays B's hang exactly once", i+1)
	}
	// The stated bound: extra cost <= 1×T per MaxConsecutiveSlowLandings+1
	// Steps (the consult's bounded probe tax; there is no faster peer to
	// escape to, so bounded tax — not escape — is the correct property).
	require.LessOrEqual(t, stepWalls[3]-slowStepWall, chainAttemptTimeout)
}

// R-C (mid-spend leg) — THE WITNESS-LESS ARM (R15-2b): a total resolution
// failure — a network blip, nobody answered the head read — is evidence
// about NOBODY. The lease count, baseline and routing all survive it: the
// landings on either side of the blip are still consecutive landings on the
// retained endpoint, and the probe fires after exactly ONE more slow landing
// — a flapping network can no longer suppress probes forever (the consult's
// refuted-reset reading). The incumbent is endpoint 1 on purpose: a
// witness-less failure mis-routed through the non-landing advance would
// visibly drag startPref to 0.
func TestWitnessLessFailurePreservesTheLeaseMidSpend(t *testing.T) {
	slowRead := chainAttemptTimeout - time.Second
	ch, st, w, _ := probeHarness(t, 0, slowRead)
	ch.active = 1 // the stream's very first resolution seeds from the hint: endpoint 1

	// Steps 1-2: two slow landings on the incumbent (endpoint 1).
	landSteps(t, w, 2, "pre-blip")
	require.Equal(t, 1, w.startPref)
	require.Equal(t, 2, w.slowLandings)

	// Step 3: the blip — every endpoint down; the head read fails everywhere.
	blip := errors.New("network blip: dial refused")
	ch.view(0).down, ch.view(1).down = blip, blip
	advanced, err := w.Step(context.Background())
	require.ErrorContains(t, err, "head:")
	require.False(t, advanced)
	require.Equal(t, 1, w.startPref, "witness-less: routing untouched — there is no witness to route past")
	require.Equal(t, 2, w.slowLandings, "witness-less: the lease count SURVIVES the blip")
	require.Equal(t, 6*slowRead, w.slowBaseline, "…and so does the baseline")

	// Recovery: one more slow landing spends the lease; the NEXT Step probes.
	ch.view(0).down, ch.view(1).down = nil, nil
	landSteps(t, w, 1, "post-blip spend")
	require.Equal(t, 3, w.slowLandings)

	advanced, err = w.Step(context.Background())
	require.NoError(t, err)
	require.True(t, advanced)
	require.Equal(t, []int{1, 1, 1, 1, 0}, ch.blockStarts,
		"the probe fired after exactly ONE more slow landing — the blip interrupted nothing")
	require.Equal(t, 0, w.startPref, "the fast neighbour was adopted on its own evidence")
	require.Equal(t, uint64(299), st.cursor.Block, "every witnessed Step landed")
	require.Equal(t, 1, ch.active, "the shared hint was read once at seed time and never written")
}

// R-C (armed leg) — the witness-less arm preserves the ARMED state too: a
// blip that lands on the probe Step itself (nobody answers, not even the
// incumbent) leaves the lease spent and the probe target unchanged, so the
// probe fires — at the SAME target — on the first Step after recovery.
func TestWitnessLessFailureWhileArmedPreservesTheArmedProbe(t *testing.T) {
	slowRead := chainAttemptTimeout - time.Second
	ch, st, w, _ := probeHarness(t, 0, slowRead)
	ch.active = 1

	// Steps 1-3: the lease spends on incumbent 1.
	landSteps(t, w, 3, "lease spend")
	require.Equal(t, 3, w.slowLandings)

	// Step 4: an ARMED Step — it starts as the probe (target 0) — and the
	// whole fleet is down: witness-less.
	blip := errors.New("network blip: dial refused")
	ch.view(0).down, ch.view(1).down = blip, blip
	advanced, err := w.Step(context.Background())
	require.ErrorContains(t, err, "head:")
	require.False(t, advanced)
	require.Equal(t, 1, w.startPref, "startPref untouched through the witness-less probe Step")
	require.Equal(t, 3, w.slowLandings, "the ARMED flag survives the blip")

	// Step 5: recovery — the probe fires again, same target, and adjudicates.
	ch.view(0).down, ch.view(1).down = nil, nil
	advanced, err = w.Step(context.Background())
	require.NoError(t, err)
	require.True(t, advanced)
	require.Equal(t, []int{1, 1, 1, 0, 0}, ch.blockStarts,
		"armed lease survives the blip and probes the same target on recovery")
	require.Equal(t, 0, w.startPref, "…and the fast neighbour is adopted on its own evidence")
	require.Equal(t, uint64(299), st.cursor.Block, "the probe Step landed the fourth window")
}

// R-D — CODEX ROUND-15 FINDING 3, VERBATIM (both halves): n=3, incumbent A's
// baseline ≈31s Σ, B hangs to the attempt timeout, C serves the whole Step
// in 6 seconds of its own work. The probe resolves PAST hung B into C; the
// adjudicated quantity is C's OWN Σ-attempts (6s), not the walk wall (36s):
//
//   - half one: C is ADOPTED (6s < 31.2s) — under whole-walk wall it would
//     read 36s > 31.2s and be judged "no faster" FOREVER despite being five
//     times faster;
//   - half two: C's lease starts CLEAN (slowLandings==0; its own 6s is under
//     budget) — under wall it would inherit ONE slow landing from B's hang
//     (36s > 30s budget): the count-resets-but-evidence-inherited defect.
func TestProbeAdjudicatesOnTheServingWitnessOwnElapsedNotTheWalkWall(t *testing.T) {
	run := func(t *testing.T, aRead time.Duration) (*fakeEndpointChain, *fakeStore, *Walker) {
		t.Helper()
		ch, st, w, _ := probeHarness(t, aRead, 0, time.Second)
		vB := ch.view(1)
		vB.down = errors.New("connection hangs until the attempt deadline")
		vB.readCost = chainAttemptTimeout // hung-to-timeout

		// Step 1 is the fresh walk (four reads — under budget at these
		// per-read costs; the lease stays quiet); steps 2-4 are the three
		// over-budget cursor-bearing landings that spend it.
		landSteps(t, w, 4, "lease spend")
		require.Equal(t, 3, w.slowLandings)
		require.Equal(t, 6*aRead, w.slowBaseline, "baseline is the incumbent's own Σ-attempts")

		// Step 5: the probe. Resolution: B hangs (T on the wall), the walk
		// rotates into C, C serves the whole Step at 1s/read → Σ_C = 6s,
		// wall = T + 6s.
		landSteps(t, w, 1, "the probe lands via C")
		// Step 6: retention transferred — the stream stays on C.
		landSteps(t, w, 1, "retention on C")

		require.Equal(t, []int{0, 0, 0, 0, 1, 2}, ch.blockStarts,
			"probe asked for B (frozen target), C answered, C retained")
		require.Equal(t, 2, w.startPref, "C ADOPTED on its own six seconds of work")
		return ch, st, w
	}

	t.Run("adopted despite the walk wall exceeding the baseline", func(t *testing.T) {
		// Σ_A = 31.2s; probe wall = 36s > 31.2s, probe Σ = 6s < 31.2s.
		_, st, w := run(t, 5200*time.Millisecond)
		require.Equal(t, 0, w.slowLandings, "C's lease is CLEAN: B's hang is nobody's landing evidence")
		require.Equal(t, uint64(399), st.cursor.Block, "every Step landed")
	})

	t.Run("no slow landing inherited when the wall alone is over budget", func(t *testing.T) {
		// Σ_A = 40.2s; wall-adjudication would ADOPT here too (36s < 40.2s)
		// but seed slowLandings=1 (36s > 30s budget) — the inherited-evidence
		// defect. Per-witness measurement starts C clean.
		_, _, w := run(t, 6700*time.Millisecond)
		require.Equal(t, 0, w.slowLandings,
			"adoption starts from the witness's OWN measurement: 6s under budget → zero slow landings")
		require.Equal(t, time.Duration(0), w.slowBaseline)
	})
}

// R-E — CODEX ROUND-15 FINDING 4, subsumed BY CONSTRUCTION: three fast-RPC
// Steps over a PostgreSQL that takes 45 seconds per commit (a real degraded
// store posture) must never spend the lease — store time is not endpoint
// evidence, and it cannot enter the Σ-attempts measure because only RPC
// attempts are summable. Asserted as a property (the lease stays quiet while
// the WALL is provably over budget every Step), not as a subtraction.
func TestSlowStoreCommitsNeverArmTheLease(t *testing.T) {
	ch, st, w, clk := probeHarness(t, 0, 0)
	st.saveCost = 45 * time.Second // > slowStepBudget, every Step
	st.clock = clk.advance

	var stepWalls []time.Duration
	for i := 0; i < 4; i++ {
		before := clk.now()
		advanced, err := w.Step(context.Background())
		require.NoError(t, err)
		require.True(t, advanced)
		stepWalls = append(stepWalls, clk.now().Sub(before))
	}

	for i, wall := range stepWalls {
		require.Greater(t, wall, slowStepBudget,
			"step %d: the fixture is real — the Step WALL exceeds the budget on store time alone", i+1)
	}
	require.Equal(t, []int{0, 0, 0, 0}, ch.blockStarts,
		"the lease never armed and no probe ever fired: SaveBatch occupancy is outside the lease's jurisdiction")
	require.Equal(t, 0, w.slowLandings)
	require.Equal(t, uint64(299), st.cursor.Block, "all four windows landed")
}

// R-F — R15-6: A PROBE STEP CARRIES NO REWIND AUTHORITY. The lease is spent;
// probed B sits on a minority/stale view whose hash at the cursor height
// contradicts the durable cursor (annex S3: same height, two truths, below
// finality). B's sole word must not authorize a destructive rewind — the
// mismatch is a DISCARD — and the incumbent rewinds only if IT sees the
// mismatch on its own Step.
func TestProbedWitnessCursorMismatchDiscardsInsteadOfRewinding(t *testing.T) {
	slowRead := chainAttemptTimeout - time.Second
	ch, st, w, _ := probeHarness(t, slowRead, 0)

	landSteps(t, w, 3, "lease spend")
	require.Equal(t, uint64(249), st.cursor.Block)

	// B diverges at EXACTLY the cursor height — a minority view, not a dead
	// node: everything else about B is healthy and canonical.
	ch.view(1).hashes[249] = common.HexToHash("0xb4d")

	// Step 4: the probe. B reports the contradiction; the probe REFUSES the
	// rewind arm and discards.
	advanced, err := w.Step(context.Background())
	var discard *DiscardError
	require.ErrorAs(t, err, &discard)
	require.Contains(t, discard.Reason, "no rewind authority")
	require.False(t, advanced)
	require.Nil(t, st.rewound, "store.Rewind is NEVER called on a probed witness's sole word")
	require.Equal(t, uint64(249), st.cursor.Block, "nothing destructive happened: the cursor stands")

	// Step 5: the discard advanced past B — at n=2 that IS the incumbent.
	// A agrees with the durable cursor, so no rewind happens at all: the
	// contradiction was B's minority view, and the stream just walks on.
	advanced, err = w.Step(context.Background())
	require.NoError(t, err)
	require.True(t, advanced)
	require.Nil(t, st.rewound, "the incumbent saw no mismatch: no rewind, ever")
	require.Equal(t, uint64(299), st.cursor.Block)
	require.Equal(t, []int{0, 0, 0, 1, 0}, ch.blockStarts,
		"probe, discard, straight back to the incumbent as an ordinary Step")
}

// R-F (genuine-reorg leg): when the reorg is REAL — every view contradicts
// the durable cursor — the probe Step still refuses to rewind on the probed
// witness's word; the rewind happens ONE Step later, on the incumbent's own
// (retained-witness) authority. Cost of the refusal: exactly one Step of
// delay on a genuine reorg that lands inside a probe Step.
func TestGenuineReorgRewindsOnTheIncumbentStepNotTheProbeStep(t *testing.T) {
	slowRead := chainAttemptTimeout - time.Second
	ch, st, w, _ := probeHarness(t, slowRead, 0)

	landSteps(t, w, 3, "lease spend")
	require.Equal(t, uint64(249), st.cursor.Block)

	// The chain reorgs below the cursor on EVERY view; block 150 is the
	// verified ancestor (stored hash == live hash).
	ch.setHashAll(249, common.HexToHash("0xdead"))
	st.highestLogs = map[uint64][]byte{150: blockHashAt(150).Bytes()}

	// Step 4: the probe sees the mismatch — discard, no rewind.
	advanced, err := w.Step(context.Background())
	var discard *DiscardError
	require.ErrorAs(t, err, &discard)
	require.False(t, advanced)
	require.Nil(t, st.rewound, "a genuine reorg still does not rewind on the probe Step")

	// Step 5: the incumbent sees the same mismatch on its own Step and
	// rewinds with retained-witness authority.
	advanced, err = w.Step(context.Background())
	require.NoError(t, err)
	require.True(t, advanced, "rewind is a durable write: advanced=true")
	require.NotNil(t, st.rewound)
	require.Equal(t, uint64(150), st.rewound.toBlock, "rewound to the verified ancestor, one Step late")
	require.Equal(t, []int{0, 0, 0, 1, 0}, ch.blockStarts)
}

// R-F (round-17 fall-through leg) — CODEX ROUND 17, THE REVIEWER'S EXACT
// COMBINATION: the lease is spent, probe target B fails the HEAD read, the
// failover walk wraps to incumbent A, and A reports a genuine cursor
// mismatch. Wave 17 scoped the rewind refusal to the probed witness
// (`servedBy.Index != incumbent`), so exactly this Step — probing, served by
// the incumbent — kept rewind authority and executed store.Rewind. The
// round-17 adjudication REVERSED that deviation: A PROBE STEP NEVER REWINDS,
// no exceptions, no witness attribution. The Step DISCARDS (store.Rewind
// never called, no landing), the seam advances past the serving witness, the
// lease dissolves — and the NEXT Step, a non-probe, performs the IDENTICAL
// rewind through the normal arm: the reorg response is deferred one Step,
// never lost.
func TestFallThroughProbeMismatchDiscardsAndTheRewindDefersToTheNextStep(t *testing.T) {
	slowRead := chainAttemptTimeout - time.Second
	ch, st, w, _ := probeHarness(t, slowRead, 0)

	landSteps(t, w, 3, "lease spend")
	require.Equal(t, uint64(249), st.cursor.Block)
	require.Equal(t, 3, w.slowLandings, "the lease is spent: the next Step probes")

	// The compound posture: B's head probe is broken (its header path still
	// answers — a degraded provider, not a dead node), AND the chain has
	// genuinely reorged below the cursor on EVERY view; block 150 is the
	// verified ancestor (stored hash == live hash).
	ch.view(1).headErr = errors.New("head probe broken on the probe target")
	ch.setHashAll(249, common.HexToHash("0xdead"))
	st.highestLogs = map[uint64][]byte{150: blockHashAt(150).Bytes()}

	// Step 4: the probe. Resolution starts at B, B fails the head read, the
	// walk wraps to incumbent A — and A reports the mismatch. probing is
	// true, so the Step DISCARDS: no landing, store.Rewind NEVER called.
	advanced, err := w.Step(context.Background())
	var discard *DiscardError
	require.ErrorAs(t, err, &discard)
	require.Contains(t, discard.Reason, "no rewind authority")
	require.False(t, advanced, "a discard is a non-landing")
	require.Nil(t, st.rewound, "store.Rewind is NEVER called on a probe Step — the incumbent-served fall-through included")
	require.Equal(t, uint64(249), st.cursor.Block, "nothing destructive happened: the cursor stands")
	require.Equal(t, 1, w.startPref, "the seam advanced past the Step's serving witness (the incumbent)")
	require.Equal(t, 0, w.slowLandings, "the lease dissolved with the witnessed non-landing")

	// Step 5: NON-probe (the lease just dissolved). It starts at B (the
	// seam's advance), B's head read still fails, the walk wraps to A again —
	// and A performs the IDENTICAL rewind through the normal arm, to the same
	// verified-ancestor target the probe Step refused: deferred, never lost.
	advanced, err = w.Step(context.Background())
	require.NoError(t, err)
	require.True(t, advanced, "rewind is a durable write: advanced=true")
	require.NotNil(t, st.rewound, "the reorg response arrives exactly one Step late")
	require.Equal(t, uint64(150), st.rewound.toBlock, "the identical rewind: same verified ancestor")
	require.Equal(t, blockHashAt(150).Bytes(), st.rewound.hash)
	require.Equal(t, []int{0, 0, 0, 1, 1}, ch.blockStarts,
		"step 4 asked for the probe target; step 5 asked for the seam's advance — same start index, different law")
	require.Equal(t, 0, ch.active, "the shared hint is neither consulted nor written")
}

// R-G — R15-7: THE n>=3 PROBE SHIELD. A is slow, B lands but always SLOWER
// than A's baseline (rejected every lease, never failing), C is fast. With
// the probe target a pure function of startPref, B would shield C forever —
// the round-12 pin recreated one level up. The probe-target cursor cycles
// the displacement across spent leases: B is measured once, C is measured at
// the SECOND spent lease and adopted, and the general escape bound
// (n-1)×(MaxConsecutiveSlowLandings+1) Steps is met exactly.
func TestRejectedProbeCyclesTheTargetPastTheShieldToTheFastPeer(t *testing.T) {
	slowRead := chainAttemptTimeout - time.Second
	ch, st, w, _ := probeHarness(t, slowRead, slowRead+100*time.Millisecond, time.Second)

	// Steps 1-8: lease spends on A; probe 1 measures B (no faster →
	// rejected, target advances); lease re-spends on A; probe 2 measures C
	// (faster → adopted). Step 9 retains C. Every Step lands.
	landSteps(t, w, 9, "shield schedule")

	require.Equal(t, []int{0, 0, 0, 1, 0, 0, 0, 2, 2}, ch.blockStarts,
		"THE SHIELD IS BROKEN: the second spent lease probes PAST the no-faster neighbour to the fast peer")
	require.Equal(t, 2, w.startPref, "retention transferred to the endpoint that is actually fast")
	require.Equal(t, 0, w.slowLandings, "adopted clean: C's own Σ is under budget")
	require.Equal(t, uint64(549), st.cursor.Block, "no landing sacrificed anywhere in the schedule")
	require.Equal(t, 0, ch.active, "the shared hint is untouched throughout")

	// The stated general bound, computed from the same constants: escape at
	// Step (n-1)×(L+1) exactly — the n=2 instance reduces to the shipped
	// wave-14 bound (L+1), whose traces are byte-identical under cycling.
	escapeStep := (ch.EndpointCount() - 1) * (MaxConsecutiveSlowLandings + 1)
	require.Equal(t, 8, escapeStep, "the bound the report states: (n-1)(L+1) Steps")
	require.Equal(t, 2, ch.blockStarts[escapeStep-1], "…and the fast peer was reached exactly there")
}

// R-I — the n=1 armed-lease leg (wave-14's disclosed gap): a single
// configured endpoint has nowhere to probe. The lease may spend, the count
// may grow past MaxConsecutiveSlowLandings, and the honest behavior is NO
// probe, NO pretend rotation, retention standing.
func TestSingleEndpointSpentLeaseNeverProbesAndRetentionStands(t *testing.T) {
	clk := newStepClock()
	ch := newFakeEndpointChain(1).setHeadAll(1000).canonAll()
	ch.view(0).readCost = chainAttemptTimeout - time.Second
	ch.advanceClock = clk.advance
	st := &fakeStore{}
	w := walker(ch, st)
	w.now = clk.now

	landSteps(t, w, 6, "single-endpoint slow landings")

	require.Equal(t, []int{0, 0, 0, 0, 0, 0}, ch.blockStarts,
		"no probe and no pretend rotation: every Step starts at the only endpoint there is")
	require.Equal(t, 0, w.startPref)
	require.Equal(t, 6, w.slowLandings,
		"the count grows past the lease bound honestly — spending it changes nothing with nowhere to go")
	require.Equal(t, uint64(399), st.cursor.Block, "every Step landed")
}

// R-J — the ask-count guard (R15-9): stepMaxPinnedReads is a DESCRIPTION of
// the window Step's shape, and nothing mechanical kept it true until now.
// One maximal cursor-bearing window Step performs exactly that many RPC
// asks: the resolving head read, the reorg-check header, the tip header, the
// logs window, the tip recheck and the cursor recheck.
func TestMaximalWindowStepAskCountMatchesStepMaxPinnedReads(t *testing.T) {
	ch, _, w, _ := probeHarness(t, 0, 0)

	// Step 1 establishes a cursor (a fresh walk has no reorg check and no
	// cursor recheck — it is not the maximal shape).
	landSteps(t, w, 1, "establish cursor")
	before := len(ch.blockStarts) + len(ch.headerAsks) + len(ch.logsAsks)

	// Step 2 is the maximal shape: cursor-bearing, window available.
	landSteps(t, w, 1, "maximal window step")
	asks := len(ch.blockStarts) + len(ch.headerAsks) + len(ch.logsAsks) - before

	require.Equal(t, stepMaxPinnedReads, asks,
		"the constant IS the Step's shape: if Step gains or loses a pinned read, this refuses the drift")
}
