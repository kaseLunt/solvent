package main

// The ADJUSTMENT wave — the chain-truth authority's ACK/ADJUST on the L2 wave
// (ADDENDUM of .superpowers/sdd/p3-consults/chain-truth-basket-continuity-
// ruling.md, NORMATIVE, 2026-07-30):
//
//   ADJUSTMENT 1 — the swept address list is the DM's SUPPORTED-COLLATERAL SET
//   AT BOTH PINS: getCollateralTokens()@parentHash(N-1) ∪ @pinHash(N), read
//   inside the shared frame decode loop so the wave-8 per-subcall law covers
//   the two new reads with no special-casing. This closes the
//   in-and-out-within-block gap: a supported token inbound pre-boundary and
//   fully outbound post-boundary is zero-balance at both edges, invisible to
//   the old parent∪seized∪exec union, and raises boundary maxBorrowLT exactly
//   like H2's top-up. The old union is KEPT as a minimality check (legs∪seized
//   ⊄ supported is a decode/config anomaly → refuse). Codex round 9 (session
//   019fb48b-4434-73f2-96be-e915636a2a2e) independently found the SAME gap as
//   its sole HIGH ("Transfer sweep omits transient boundary tokens … a
//   supported token transferred into the Safe before boundary L and removed
//   again after L appears in none of those endpoint sets"); the fixtures
//   below carry the reviewer's exact regression shape, and the round-9
//   recommendation's netting-event-token clause lands as a belt: a netting
//   event naming a token outside the swept set refuses (its Δpending would
//   feed a closure identity the loop never computed).
//
//   ADJUSTMENT 2 — THE INVARIANT, explicit and fixture-pinned: the case's
//   OWN-PASS WithdrawalCancelled must NEVER enter the boundary-ELIGIBILITY
//   basket. The contract judged eligibility NETTED (the :526/:544 check
//   precedes preLiquidate's _cancelOldWithdrawal), so the own-pass
//   cancellation is post-check — attributed for closure, available to the
//   seizure/L5 accounting, but the boundary crossing is evaluated against the
//   NETTED basket. FINDING: the implementation was ALREADY CORRECT — the
//   replay's basket starts from the CashLens-netted parent legs and only
//   DM-custodied witnesses touch it (replaySameBlockCauses filters on the DM
//   proxy address; a CashEventEmitter event never reaches the basket), and
//   "models the basket effect" on the own-pass arm always meant the CLOSURE
//   identity consuming Δpending, never an eligibility-basket write. No code
//   change; this file pins it.
//
// ---------------------------------------------------------------------------
// MUTATION SPEC — committed BEFORE the loop. Behavioural cuts, sha256-verified
// restores, kills recorded in the wave report.
//
//   m1  revert the sweep list to parent∪seized∪exec (assembleContinuitySweep
//       builds its union from the legs and seizures again; the minimality
//       check degenerates to a tautology).
//       KILLED BY: TestAdjust1SupportedButInAndOutTokenIsRefused — the
//       honest-provider backend answers ONLY the addresses asked, so under
//       the mutant the narrower question never sees the in-and-out token's
//       transfers and the fixture FALSE-PASSES (proven) where the supported-
//       set sweep refuses both unattributed directions.
//   m2  the netting re-applied (the already-correct case's inversion):
//       obligation2Eligibility adds the proof's CancelledPreBoundary amounts
//       to the eligibility basket before maxBorrowAtFrame.
//       KILLED BY: TestOwnPassCancellationNeverEntersTheBoundaryEligibilityBasket
//       — the netted-boundary assertions fail (maxBorrowLT@exec prints the
//       un-netted 100M and the marginal verdict regresses to UNEXPLAINED,
//       because the un-netted basket un-crosses the boundary).
// ---------------------------------------------------------------------------

import (
	"context"
	"encoding/json"
	"math/big"
	"strings"
	"testing"

	"github.com/ethereum/go-ethereum/common"
	"github.com/stretchr/testify/require"

	"github.com/kaselunt/solvent/cmd/reconcile/snapshotdb"
)

// honestFilteringBackend answers each getLogs question the way an HONEST
// provider does: only logs whose address is IN the asked address set are
// served. This is what makes m1 a real false-pass mutation rather than an L6
// refusal — a narrower question honestly answered simply never shows the
// in-and-out token's movements.
type honestFilteringBackend struct {
	t            *testing.T
	out, in, net []map[string]any
	asked        []logsQuery
}

func (h *honestFilteringBackend) rawLogsAtHash(_ context.Context, op string, q logsQuery) (json.RawMessage, error) {
	h.asked = append(h.asked, q)
	var pool []map[string]any
	switch {
	case strings.Contains(op, "transfers-out"):
		pool = h.out
	case strings.Contains(op, "transfers-in"):
		pool = h.in
	default:
		pool = h.net
	}
	set := map[string]bool{}
	for _, a := range q.Addresses {
		set[strings.ToLower(a.Hex())] = true
	}
	filtered := []map[string]any{}
	for _, l := range pool {
		if set[l["address"].(string)] {
			filtered = append(filtered, l)
		}
	}
	b, err := json.Marshal(filtered)
	require.NoError(h.t, err)
	return b, nil
}

// TestAdjust1SupportedButInAndOutTokenIsRefused is THE fixture adjustment 1
// exists for — and the Codex round-9 HIGH's exact regression shape: a
// supported token (tokB — in the DM's getCollateralTokens at both pins but
// ABSENT from the parent legs, the exec legs AND the case's seizures) is
// transferred INTO the safe before the boundary L and removed again, so it is
// zero-balance at both edges and the closure identity holds trivially for it.
// ONLY the wider supported-set question surfaces the movements. Two exit
// shapes, both refused:
//
//	(a) exit BEFORE L (the mutation-floor shape): both movements are
//	    pre-boundary and unattributed — the proof refuses BOTH directions;
//	(b) exit AFTER L (the round-9 reviewer's variant: "enters before L and
//	    removed again after L"): the pre-boundary inbound raised the basket
//	    across the boundary evaluation exactly like H2's top-up — the proof
//	    refuses the inbound (the post-boundary exit needs no attribution;
//	    the boundary claim ends at L).
//
// Kills m1: under the reverted legs∪seized∪exec list the honest provider
// answers the narrower question, the movements are invisible in BOTH shapes,
// and the proof false-passes.
func TestAdjust1SupportedButInAndOutTokenIsRefused(t *testing.T) {
	drive := func(t *testing.T, exitIdx uint64) continuityOutcome {
		t.Helper()
		txX := common.HexToHash("0xdddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd0a01")
		b := &honestFilteringBackend{
			t: t,
			out: []map[string]any{
				// tokB fully leaves again at exitIdx (unattributed: no
				// witnessed liquidation in tx X).
				transferLog(tokB, contSafe, contOther, big.NewInt(5_000_000), contPin, txX, exitIdx),
				// The case's own honest seizure transfer (fixture-realism law).
				transferLog(tokA, contSafe, contOther, big.NewInt(10_000_000), contPin, contCase, 95),
			},
			in: []map[string]any{
				// tokB enters at idx 30 (pre-boundary, unattributed inbound).
				transferLog(tokB, contOther, contSafe, big.NewInt(5_000_000), contPin, txX, 30),
			},
		}
		supported := []common.Address{tokA, tokB}
		sw := driveSweepSupported(t, b, 100,
			legs(tokA, int64(30_000_000)), legs(tokA, int64(20_000_000)),
			[]snapshotdb.T6Seizure{seiz(tokA, 10_000_000)}, supported, supported)
		require.Empty(t, sw.Refusal)
		require.Equal(t, []common.Address{tokA, tokB}, sw.Tokens,
			"the swept list is the supported set, NOT the legs∪seized union")

		// The wider question was actually ASKED: both Transfer sweeps went
		// out over the full supported set.
		require.GreaterOrEqual(t, len(b.asked), 2)
		require.Equal(t, []common.Address{tokA, tokB}, b.asked[0].Addresses,
			"the outbound question covers the supported set")
		require.Equal(t, []common.Address{tokA, tokB}, b.asked[1].Addresses,
			"the inbound question covers the supported set")

		o := proveBasketContinuity(sw, []snapshotdb.T6Seizure{seiz(tokA, 10_000_000)}, nil)
		require.False(t, o.Proven,
			"the in-and-out supported token moved the basket mid-block with no custodied cause — the class adjustment 1 closes; a proof here is the H2 false-marginal")
		require.Contains(t, strings.Join(o.Refusals, " | "), tokB.Hex(),
			"the refusals name the in-and-out token")
		return o
	}

	t.Run("exit pre-boundary: both directions refuse", func(t *testing.T) {
		o := drive(t, 60)
		joined := strings.Join(o.Refusals, " | ")
		require.Contains(t, joined, "unattributed INBOUND pre-boundary movement",
			"the entry leg refuses under L4's inbound narrative")
		require.Contains(t, joined, "unattributed OUTBOUND pre-boundary movement",
			"the exit leg refuses under L4's outbound narrative")
	})
	t.Run("exit post-boundary: the round-9 reviewer's variant refuses on the inbound", func(t *testing.T) {
		o := drive(t, 120)
		joined := strings.Join(o.Refusals, " | ")
		require.Contains(t, joined, "unattributed INBOUND pre-boundary movement",
			"the pre-boundary entry raised the basket across the boundary evaluation — the H2 false-marginal direction, refused")
		require.NotContains(t, joined, "unattributed OUTBOUND",
			"the post-boundary exit needs no attribution: the boundary claim ends at L")
	})
}

// TestAdjust1NettingEventTokenOutsideSweptSetRefuses pins the round-9
// recommendation's netting-event-token clause: sweep (c) is address-filtered
// to the CashEventEmitter, so every lifecycle event is visible — but an event
// naming a token OUTSIDE the swept supported set would contribute a Δpending
// to a closure identity the proof never computed. The belt refuses; it should
// be unreachable (netting applies only to supported collateral), so a firing
// belt means the supported-set premise itself broke. The event sits
// POST-boundary deliberately: attribution cannot refuse it, so the ONLY thing
// standing between this shape and a proof is the belt.
func TestAdjust1NettingEventTokenOutsideSweptSetRefuses(t *testing.T) {
	txY := common.HexToHash("0xdddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd0a02")
	b := &fakeLogsBackend{
		net: envelope(t, nettingLog(t, "WithdrawalRequested", contSafe,
			[]common.Address{tokB}, []*big.Int{big.NewInt(7_000_000)}, contPin, txY, 120)),
	}
	sw := driveSweepSupported(t, b, 100,
		legs(tokA, int64(30_000_000)), legs(tokA, int64(30_000_000)), nil,
		[]common.Address{tokA}, []common.Address{tokA})
	require.Empty(t, sw.Refusal)
	o := proveBasketContinuity(sw, nil, nil)
	require.False(t, o.Proven)
	joined := strings.Join(o.Refusals, " | ")
	require.Contains(t, joined, "OUTSIDE the swept supported set")
	require.Contains(t, joined, tokB.Hex(), "the belt names the out-of-set token")
	require.Contains(t, joined, "supported-set premise broke")
}

// TestAdjust1MinimalityViolationRefuses pins the KEPT old union as a refusal
// check: a token in the legs or seized elements that BOTH pins' supported
// sets lack is a decode/config anomaly the sweep cannot reason over — refuse,
// never sweep a question narrower than the basket.
func TestAdjust1MinimalityViolationRefuses(t *testing.T) {
	sw := driveSweepSupported(t, &fakeLogsBackend{}, 100,
		legs(tokA, int64(30_000_000)), legs(tokA, int64(30_000_000)), nil,
		[]common.Address{tokB}, []common.Address{tokB})
	require.NotEmpty(t, sw.Refusal)
	require.Contains(t, sw.Refusal, "MINIMALITY violation")
	require.Contains(t, sw.Refusal, tokA.Hex(), "the refusal names the anomalous token")
	o := proveBasketContinuity(sw, nil, nil)
	require.False(t, o.Proven, "a minimality-refused sweep can never discharge the conjunct")
}

// TestAdjust1SweepAsksOverTheSupportedUnion pins the UNION semantics: a token
// supported only at N-1 and a token supported only at N are BOTH in the swept
// address list (a mid-block CollateralTokenAdded/Removed is DM-custodied, and
// the union of both pins covers its token without any event surveillance).
func TestAdjust1SweepAsksOverTheSupportedUnion(t *testing.T) {
	b := &fakeLogsBackend{}
	sw := driveSweepSupported(t, b, 100,
		legs(tokA, int64(30_000_000)), legs(tokA, int64(30_000_000)), nil,
		[]common.Address{tokA}, []common.Address{tokB})
	require.Empty(t, sw.Refusal)
	require.Equal(t, []common.Address{tokA, tokB}, sw.Tokens)
	require.Equal(t, []common.Address{tokA, tokB}, b.asked[0].Addresses)
	require.Equal(t, []common.Address{tokA, tokB}, b.asked[1].Addresses)
	require.True(t, proveBasketContinuity(sw, nil, nil).Proven,
		"a quiescent basket over the wider list still proves — the widening is refusal-widening only")
}

// TestAdjust1SupportedSetJoinsTheWave8DecodeLaw is the "verify and pin"
// clause of adjustment 1: the two getCollateralTokens reads go through the
// SHARED frame decode loop, so the wave-8 per-subcall law (Success=false /
// empty / undecodable ⇒ the WHOLE frame is UNREAD with the subcall NAMED)
// covers them automatically — in BOTH frames.
func TestAdjust1SupportedSetJoinsTheWave8DecodeLaw(t *testing.T) {
	degrade := func(t *testing.T, full bool, mut func([]backtestFrameTag, []multicallResult)) *frameState {
		t.Helper()
		tags := wave8Plan(t, full)
		res := wave8Honest(t, tags, 100_000_000)
		mut(tags, res)
		return wave8Decode(t, full, tags, res)
	}
	forEachFrame := func(t *testing.T, name string, mut func([]backtestFrameTag, []multicallResult)) {
		for _, full := range []bool{true, false} {
			frame := "exec"
			if full {
				frame = "parent"
			}
			t.Run(name+" ("+frame+" frame)", func(t *testing.T) {
				st := degrade(t, full, mut)
				require.NotEmpty(t, st.unread,
					"a degraded getCollateralTokens subcall must mark the frame UNREAD — the supported set is the sweep's address universe and a silently absent set would shrink the question")
				require.Contains(t, st.unread, "getCollateralTokens", "the refusal names the subcall")
				require.Empty(t, st.supported, "nothing decoded, nothing invented")
			})
		}
	}
	setKind := func(res []multicallResult, tags []backtestFrameTag, kind string, r multicallResult) {
		for i, tg := range tags {
			if tg.kind == kind {
				res[i] = r
			}
		}
	}
	forEachFrame(t, "success=false", func(tags []backtestFrameTag, res []multicallResult) {
		setKind(res, tags, "collateralTokens", multicallResult{Success: false})
	})
	forEachFrame(t, "empty return data", func(tags []backtestFrameTag, res []multicallResult) {
		setKind(res, tags, "collateralTokens", multicallResult{Success: true, ReturnData: []byte{}})
	})
	forEachFrame(t, "undecodable return data", func(tags []backtestFrameTag, res []multicallResult) {
		garbage := make([]byte, 32)
		for i := range garbage {
			garbage[i] = 0xff
		}
		setKind(res, tags, "collateralTokens", multicallResult{Success: true, ReturnData: garbage})
	})
	t.Run("honest frames decode the supported set", func(t *testing.T) {
		for _, full := range []bool{true, false} {
			tags := wave8Plan(t, full)
			st := wave8Decode(t, full, tags, wave8Honest(t, tags, 100_000_000))
			require.Empty(t, st.unread)
			require.Equal(t, []common.Address{tokA}, st.supported,
				"the frame carries its pin's supported-collateral enumeration")
		}
	})
}

// idxTwoTicks is 1.00000002e18: floor(70,000,000 × 1.00000002) = 70,000,001 —
// one USD-6 above the 70M netted maxBorrowLT, the smallest crossing this
// fixture's numbers admit.
func idxTwoTicks() *big.Int { return big.NewInt(1_000_000_020_000_000_000) }

// TestOwnPassCancellationNeverEntersTheBoundaryEligibilityBasket is
// adjustment 2's fixture pin, driven through the REAL production composition
// (obligation2Eligibility) with the pending-withdrawal sweep assembled from
// raw envelopes by the REAL assembler.
//
// The shape (the sibling of TestContinuityPendingWithdrawalLiquidationProves,
// which pins the same envelopes at the proof layer): Safe balance 100, pending
// withdrawal 30 → NETTED parent leg 70. The case's own tx cancels the pending
// (idx 90, zero transfers) and seizes 50 (idx 95). An earlier same-block
// index tick moves the debt from 70,000,000 to 70,000,001 — a real crossing,
// but ONLY against the NETTED 70M basket: against the un-netted 100M the
// account never crosses.
//
// THE INVARIANT (addendum adjustment 2): the boundary crossing is evaluated
// against the NETTED basket — the contract's own :526/:544 check ran before
// _cancelOldWithdrawal freed anything. The own-pass cancellation is
// attributed for closure and recorded for L5, but it must never raise the
// eligibility basket. An implementation that "modeled its basket effect" by
// adding the freed 30M would compute maxBorrowLT@exec = 100M, un-cross the
// boundary, and regress this marginal-disclosed verdict to UNEXPLAINED —
// modeling the ONE cancellation that must not affect the check (m2). The
// earlier-pass arm keeps its own polarity:
// TestContinuityEarlierPassCancellationIsUnmodeledRefusal (the cancellation
// that DID un-net the basket before the case's check refuses until modeled).
func TestOwnPassCancellationNeverEntersTheBoundaryEligibilityBasket(t *testing.T) {
	usdcHex := hexLower(replayTestUSDC.Hex())

	// The pending-withdrawal sweep, from raw envelopes through the production
	// assembler — the SAME bytes shape the proof-layer sibling pins.
	b := &fakeLogsBackend{
		out: envelope(t, transferLog(tokA, contSafe, contOther, big.NewInt(50_000_000), contPin, contCase, 95)),
		net: envelope(t, nettingLog(t, "WithdrawalCancelled", contSafe,
			[]common.Address{tokA}, []*big.Int{big.NewInt(30_000_000)}, contPin, contCase, 90)),
	}
	seizures := []snapshotdb.T6Seizure{seiz(tokA, 50_000_000)}
	sw := driveSweep(t, b, 100, legs(tokA, int64(70_000_000)), legs(tokA, int64(50_000_000)), seizures)
	require.Empty(t, sw.Refusal)

	// The crossing: parent-boundary debt 70,000,000 vs netted maxBorrowLT
	// 70,000,000 (ineligible under the strict >); the witnessed tick moves it
	// to 70,000,001 — eligible against 70M, NOT against 100M.
	n := big.NewInt(70_000_000)
	idxW := packedWitness(t, "InterestIndexUpdated", 2, usdcHex, "", "",
		new(big.Int).Set(wad), idxTwoTicks())
	row := compositionRow(n, n, idxTwoTicks(), []snapshotdb.T6Witness{idxW})
	row.Seizures = seizures
	parent, exec := compositionFrames(70_000_000, 1_000_000, 1_000_000)

	o2, f := driveObligation2WithSweep(t, row, parent, exec, contSafe, sw)

	// The proof proves (own-pass arm: attributed, closure-consumed, no
	// refusal) AND the crossing certifies — marginal-disclosed.
	require.Contains(t, o2.row.Evidence["basket_continuity"], "proven:",
		"the own-pass cancellation is attributed and closure-consumed — the proof must not refuse it")
	require.Equal(t, "flipped-in-block-with-custodied-witness", o2.eligState)
	require.Equal(t, verdictMarginal, o2.row.Verdict,
		"the crossing is real against the NETTED basket; an un-netted eligibility basket would erase it (m2)")
	require.Contains(t, o2.row.Note, "InterestIndexUpdated")

	// THE NETTED-BOUNDARY ASSERTION (the invariant, pinned): the eligibility
	// basket at the boundary is the NETTED 70M — never 70M + the freed 30M.
	require.Equal(t, "70000000", o2.row.Evidence["our_max_borrow_lt_at_exec"],
		"the boundary-eligibility basket STAYS NETTED on the own-pass arm: the :526/:544 check preceded _cancelOldWithdrawal, so the freed pending never raises maxBorrowLT")
	require.Contains(t, o2.row.Evidence["exec_eligibility_basket"], "REPLAYED BOUNDARY BASKET",
		"the recomputation ran over the replayed boundary basket (L3), which only DM-custodied witnesses may touch")
	require.Equal(t, "true", o2.row.Evidence["eligible_at_liquidation_boundary"],
		"the crossing evaluation is UNCHANGED by the cancellation")
	require.Equal(t, []toleranceID{tolIntraBlockMarginality}, f.cited)
}
