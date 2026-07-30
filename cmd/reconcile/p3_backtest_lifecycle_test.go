package main

// Lifecycle-refusal wave for Codex round 10's HIGH finding (reviewed @ 5f18f28):
//
//   "Collateral support round trips bypass the supported-set universe."
//
// A CollateralTokenAdded→CollateralTokenRemoved sequence before the
// liquidation boundary leaves the token absent from supported@N-1 AND
// supported@N, so the continuity sweep universe never contains it, no endpoint
// leg or seizure names it — and if the Safe already HOLDS the token, its
// transient in-block configuration moves maxBorrowLT with no Transfer and no
// netting event. replaySameBlockCauses treated both lifecycle events as
// UNRELATED (the default branch), so a modeled interest crossing could be
// reversed by the add and re-crossed by the remove while the replay reported
// the original crossing held to L, and continuity could set Proven=true.
//
// THE LAW THIS FILE PINS — THE MINIMAL REFUSAL (the finding's floor): ANY
// pre-boundary CollateralTokenAdded or CollateralTokenRemoved makes the replay
// INCOMPLETE (a Note naming the event and token → Complete()==false →
// UNEXPLAINED through the classifier's structural arm). Membership, config and
// boundary-balance replay is the NAMED EXTENSION, deliberately not attempted —
// mirroring the netting modeled-iff-final-pass precedent: refuse what cannot
// be fully replayed, never approximate it.
//
// ---------------------------------------------------------------------------
// MUTATION SPEC — committed BEFORE the implementation loop.
//
//   m1  revert the lifecycle arms to the default branch (Unrelated): delete
//       the `case topicDMCollateralAdded, topicDMCollateralRemoved` arm so
//       both events fall through as unrelated contact again.
//       KILLED BY: TestAddRemoveRoundTripPreBoundaryCannotPassMarginal — with
//       the arm reverted, Complete() stays true and the composed verdict is
//       eligFlippedWithWitness (the exact false pass the finding names); the
//       test requires eligUnexplainedOutcome with the lifecycle notes present.
//
// Behavioural mutants only; a mutant that fails to compile is re-cut.
// ---------------------------------------------------------------------------
//
// FIXTURE-BACKED-OVER-TRANSCRIBED (Task 6 round-3 law): the lifecycle
// witnesses below are packed through the COMMITTED forge artifact
// (internal/decode/abis/DebtManagerCore.json) — the same object
// TestCollateralLifecycleEventsMatchTheCommittedABI pins dmWitnessABI against
// — and the interest crossing is the REAL captured InterestIndexUpdated log.
// No hand-written topic0 or word offset exists in this file.

import (
	"encoding/hex"
	"encoding/json"
	"math/big"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/ethereum/go-ethereum/accounts/abi"
	"github.com/ethereum/go-ethereum/common"
	"github.com/stretchr/testify/require"

	"github.com/kaselunt/solvent/cmd/reconcile/snapshotdb"
)

// committedDMABI parses the COMMITTED forge artifact's ABI. Nothing below
// derives from a signature written in this repository's Go code.
func committedDMABI(t *testing.T) abi.ABI {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join("..", "..", "internal", "decode", "abis", "DebtManagerCore.json"))
	require.NoError(t, err)
	var wrapper struct {
		ABI json.RawMessage `json:"abi"`
	}
	require.NoError(t, json.Unmarshal(raw, &wrapper))
	parsed, err := abi.JSON(strings.NewReader(string(wrapper.ABI)))
	require.NoError(t, err)
	return parsed
}

// committedLifecycleWitness builds a T6Witness for CollateralTokenAdded /
// CollateralTokenRemoved exactly as the chain emits them per the COMMITTED
// artifact: topic0 from the artifact's own event ID, the token NON-indexed in
// the data payload (DebtManagerAdmin.sol:134, :50 emit the bare token; the
// artifact declares `token` with "indexed": false). Deliberately NOT built via
// dmWitnessABI: in the pre-fix state the replay ABI does not carry these
// events, and the regression must reproduce the false pass against the real
// chain shape, not against whatever the implementation happens to parse.
func committedLifecycleWitness(t *testing.T, committed abi.ABI, event string, logIndex uint32, token common.Address) snapshotdb.T6Witness {
	t.Helper()
	ev, ok := committed.Events[event]
	require.True(t, ok, "the committed DebtManagerCore ABI must declare %s", event)
	require.Len(t, ev.Inputs, 1, "%s carries exactly the token", event)
	require.False(t, ev.Inputs[0].Indexed, "%s's token travels in the DATA payload — the decode arm depends on this", event)
	data, err := ev.Inputs.NonIndexed().Pack(token)
	require.NoError(t, err)
	return snapshotdb.T6Witness{
		LogIndex: logIndex,
		Address:  hexLower(replayTestDM.Hex()),
		Topic0:   hex.EncodeToString(ev.ID.Bytes()),
		Data:     common.Bytes2Hex(data),
	}
}

// TestCollateralLifecycleEventsMatchTheCommittedABI extends the round-3
// fixture-backed discipline to the two lifecycle events: dmWitnessABI must
// declare them with the committed artifact's exact shape, and the derived
// topic0s must equal the artifact's own IDs. There is no captured fixture for
// either event (the 31 frozen cases carry ZERO lifecycle events — that absence
// is itself asserted by the hermetic suite staying 31/31), so the committed
// artifact is the single anchor, exactly as committedDMEventID uses it.
func TestCollateralLifecycleEventsMatchTheCommittedABI(t *testing.T) {
	committed := committedDMABI(t)
	for _, tc := range []struct {
		event string
		got   string
	}{
		{"CollateralTokenAdded", topicDMCollateralAdded},
		{"CollateralTokenRemoved", topicDMCollateralRemoved},
	} {
		t.Run(tc.event, func(t *testing.T) {
			theirs, ok := committed.Events[tc.event]
			require.True(t, ok, "the committed DebtManagerCore ABI must declare %s", tc.event)
			mine, ok := dmWitnessABI.Events[tc.event]
			require.True(t, ok, "dmWitnessABI must declare %s — without it the lifecycle witness falls through as unrelated, which IS the round-10 finding", tc.event)
			require.Equal(t, theirs.Sig, mine.Sig, "%s: canonical signature vs the committed ABI", tc.event)
			require.Len(t, mine.Inputs, len(theirs.Inputs), "%s: argument count", tc.event)
			for i := range theirs.Inputs {
				require.Equal(t, theirs.Inputs[i].Name, mine.Inputs[i].Name, "%s arg %d name", tc.event, i)
				require.Equal(t, theirs.Inputs[i].Type.String(), mine.Inputs[i].Type.String(), "%s arg %d type", tc.event, i)
				require.Equal(t, theirs.Inputs[i].Indexed, mine.Inputs[i].Indexed, "%s arg %d indexed", tc.event, i)
			}
			require.Equal(t, hex.EncodeToString(theirs.ID.Bytes()), tc.got,
				"%s: the replay's topic0 must be the committed artifact's own ID — the round-3 law: ABI-derived, never hand-written", tc.event)
		})
	}
}

// TestAddRemoveRoundTripPreBoundaryCannotPassMarginal is the regression the
// finding's recommendation names, constructed exactly as it describes:
//
//   - a token the Safe already HOLDS (balance > 0 on chain) but which is
//     absent from supported@N-1 AND supported@N — added then removed inside
//     the block. In the replay's model that token is NOT a parent leg
//     (collateralOf@N-1 does not enumerate an unsupported token) and carries
//     no parent config, so the transient mid-block configuration that would
//     have raised maxBorrowLT while supported is invisible to the replay —
//     which is WHY refusal is the floor: there is no balance source to replay
//     membership against;
//   - CollateralTokenAdded + (the paired) CollateralTokenConfigSet +
//     CollateralTokenRemoved, all pre-boundary (DebtManagerAdmin.sol:30-33
//     emits Added then ConfigSet; :40-51 emits Removed and DELETES the
//     config);
//   - an interest crossing (the REAL captured InterestIndexUpdated at a
//     knife-edge position) whose held-ness the transient config would have
//     disturbed: while the pre-held token was supported, maxBorrowLT included
//     its value and the crossing was REVERSED; after the remove it re-crossed.
//     The replay cannot see either movement.
//
// The verdict MUST be UNEXPLAINED — the marginal path cannot pass even with
// basket continuity proven — with the lifecycle refusal notes naming each
// event and the token. Kills m1: with the arms reverted to the default branch
// both events count as Unrelated, Complete() stays true, and the composed
// verdict is eligFlippedWithWitness — the round-10 false pass, verbatim.
func TestAddRemoveRoundTripPreBoundaryCannotPassMarginal(t *testing.T) {
	committed := committedDMABI(t)

	// The real captured interest tick at a knife-edge position: maxBorrowLT
	// equals the debt at the OLD index, so the decoded move itself crosses
	// (the same construction TestIndexMoveThatCrossesTheThresholdIsProven
	// pins as the proven-cause machinery).
	tick := witnessFromFixture(t, "dm_interest_index_updated.json", 0, 3)
	acct := common.HexToAddress("0x4d81ce1dd1b1e10f96313e080bf7b12136ff7e76")
	oldIdx, newIdx := decodedIndexPair(t, tick)
	n := new(big.Int).Exp(big.NewInt(10), big.NewInt(12), nil)
	debtOld := mulDivFloor(n, oldIdx)
	require.Positive(t, mulDivFloor(n, newIdx).Cmp(debtOld), "the captured tick must move the USD debt at this position size")
	st := oneLegState(tokA, debtOld, pctE18(100), n, new(big.Int).Set(newIdx))

	// The round-trip token: tokB stands in for the pre-held token — the Safe
	// holds a nonzero balance on chain, but it is NOT in st.Collateral and has
	// no parent config, because it was unsupported at N-1 (and is again at N).
	added := committedLifecycleWitness(t, committed, "CollateralTokenAdded", 5, tokB)
	pairedCfg := packedWitness(t, "CollateralTokenConfigSet", 6, hexLower(tokB.Hex()), "", "",
		cfgTuple{Ltv: big.NewInt(0), LiquidationThreshold: big.NewInt(0), LiquidationBonus: big.NewInt(0)},
		cfgTuple{Ltv: pctE18(50), LiquidationThreshold: pctE18(90), LiquidationBonus: pctE18(5)})
	removed := committedLifecycleWitness(t, committed, "CollateralTokenRemoved", 8, tokB)

	r := replaySameBlockCauses([]snapshotdb.T6Witness{tick, added, pairedCfg, removed},
		replayTestDM, acct, replayTestUSDC, st)

	// The refusal, not proof-clearing, is the mechanism: the tick's crossing
	// is still real arithmetic over the replayed state, so Proven stays true —
	// and the classifier's structural !Complete() arm refuses it anyway.
	require.True(t, r.Proven, "the interest crossing itself is genuine; the lifecycle refusal must not depend on clearing it")
	require.Equal(t, 1, r.Applied, "only the tick is applied — a lifecycle event is never applied, and never silently unrelated either")
	require.False(t, r.Complete(),
		"ANY pre-boundary CollateralTokenAdded/Removed makes the replay INCOMPLETE — membership, config and boundary balance cannot be replayed (the named extension); before this fix both fell through the default branch as unrelated")

	joined := strings.Join(r.Notes, "\n")
	require.Contains(t, joined, "CollateralTokenAdded", "the refusal note names the event")
	require.Contains(t, joined, "CollateralTokenRemoved", "the refusal note names the event")
	require.Contains(t, joined, "0x"+hexLower(tokB.Hex()), "the refusal note names the token")

	require.Equal(t, eligUnexplainedOutcome,
		classifyIntraBlock(r.InitialEligible, r.ParentComplete, true, true, r.Proven, r.Complete(), true),
		"the marginal path cannot pass EVEN WITH basket continuity proven: the sweep universe (supported@N-1 ∪ supported@N) never contained the round-trip token, so the continuity proof does not cover it — refusing here is the finding's floor")
	require.Equal(t, eligUnexplainedOutcome,
		classifyIntraBlock(r.InitialEligible, r.ParentComplete, true, true, r.Proven, r.Complete(), false))

	// ---- the transient collateral, INSTANTIATED (Codex round 11, M2) -------
	// The replay applies NOTHING for lifecycle events — that is the law the
	// assertions above pin — so tokB's harm is proven COUNTERFACTUALLY, with
	// the SAME production arithmetic the replay consults (maxBorrowAtFrame,
	// mulDivFloor) over hand-built frames, and with the transient config
	// decoded from the pairedCfg WITNESS by the production decoder. Before
	// this section the harm existed only in prose: no balance, no price, no
	// USD contribution — the test stayed green even if tokB could not have
	// affected eligibility at all (the M2 finding, verbatim). Now the exact
	// numbers are asserted at every stage while the verdict above stays
	// UNEXPLAINED: the refusal is conservative BECAUSE the harm is real.
	t.Run("the instantiated harm: tokB's transient config strictly reverses the crossing", func(t *testing.T) {
		stX := oneLegState(tokA, debtOld, pctE18(100), n, new(big.Int).Set(newIdx))

		// STAGE A — after the tick, tokB unsupported: the crossing is real.
		debtNew := mulDivFloor(n, newIdx)
		mbA, pricedA := maxBorrowAtFrame(stX.Collateral, stX.Prices, stX.Configs, stX.Decimals)
		require.True(t, pricedA)
		require.Equal(t, debtOld.String(), mbA.String(),
			"reference: the tokA-only maxBorrowLT IS the knife-edge value (floor($1 leg × LT 100%))")
		require.Positive(t, debtNew.Cmp(mbA), "ELIGIBLE after the tick — the crossing the replay proves")
		margin := new(big.Int).Sub(debtNew, mbA)

		// The transient config is the pairedCfg witness's OWN decoded write —
		// production decoder, never re-typed numbers.
		cfgB, err := decodeWitnessCollateralConfig(pairedCfg)
		require.NoError(t, err)
		require.Equal(t, pctE18(90).String(), cfgB.LiquidationThreshold.String(),
			"the decoded transient threshold is the ConfigSet payload's newConfig")

		// The pre-held balance: NONZERO on chain (liquidBTC-like, 8 decimals,
		// engine price $100.00), sized so tokB's LT contribution strictly
		// exceeds the crossing margin — the reversal is structural, not
		// fixture luck. m2's cut point: a zero balance here contributes $0.
		tokBDec := uint8(8)
		tokBPrice := big.NewInt(100_000_000) // USD-6 per whole token
		usdTarget := new(big.Int).Add(new(big.Int).Mul(margin, big.NewInt(2)), big.NewInt(1_000_000))
		tokBBal := new(big.Int).Div(new(big.Int).Mul(usdTarget, pow10Big(tokBDec)), tokBPrice)
		require.Positive(t, tokBBal.Sign(), "the Safe HOLDS tokB — the nonzero balance is the instantiation M2 demanded")

		// tokB's EXACT maxBorrowLT contribution, the deployed loop shape by
		// hand: floor(bal × P / 10^dec) × LT / HUNDRED_PERCENT.
		usdB := new(big.Int).Div(new(big.Int).Mul(tokBBal, tokBPrice), pow10Big(tokBDec))
		contribB := new(big.Int).Div(new(big.Int).Mul(usdB, cfgB.LiquidationThreshold), hundredPercentDM)
		require.Positive(t, contribB.Cmp(margin),
			"tokB's exact contribution must exceed the crossing margin, or the round trip could not have reversed this crossing")
		t.Logf("reference numbers: debt@oldIdx=%s debt@newIdx=%s margin=%s tokB bal=%s usd=%s contribution=%s",
			debtOld, debtNew, margin, tokBBal, usdB, contribB)

		// STAGE B — while tokB is supported AND configured: INELIGIBLE. The
		// crossing the tick produced is REVERSED by the transient config.
		colB := append(append([]collateralLeg{}, stX.Collateral...), collateralLeg{token: tokB, amount: tokBBal})
		pricesB := map[common.Address]*big.Int{tokA: stX.Prices[tokA], tokB: tokBPrice}
		configsB := map[common.Address]collateralTokenConfigResult{tokA: stX.Configs[tokA], tokB: cfgB}
		decimalsB := map[common.Address]uint8{tokA: 6, tokB: tokBDec}
		mbB, pricedB := maxBorrowAtFrame(colB, pricesB, configsB, decimalsB)
		require.True(t, pricedB)
		require.Equal(t, new(big.Int).Add(mbA, contribB).String(), mbB.String(),
			"reference: maxBorrowLT while configured == knife-edge + tokB's exact contribution (the deployed per-token-floor-then-sum shape)")
		require.True(t, debtNew.Cmp(mbB) <= 0,
			"INELIGIBLE while tokB's transient config counts — the reversal the comments used to narrate, now arithmetic (m2's kill: zero balance makes this assertion fail)")

		// STAGE C — after the remove: membership gone, config DELETED
		// (DebtManagerAdmin.sol:47-48, no ConfigSet emitted). The enumerable
		// basket is tokA-only again and the crossing RE-CROSSES.
		mbC, pricedC := maxBorrowAtFrame(stX.Collateral, stX.Prices, stX.Configs, stX.Decimals)
		require.True(t, pricedC)
		require.Equal(t, mbA.String(), mbC.String())
		require.Positive(t, debtNew.Cmp(mbC),
			"ELIGIBLE again after the removal — add→remove reversed and then restored the crossing with zero Transfers and zero netting events")
		// And there is NO honest way to keep valuing the leg post-remove: the
		// deleted config makes it unvaluable, never zero-thresholded.
		_, pricedDeleted := maxBorrowAtFrame(colB, pricesB,
			map[common.Address]collateralTokenConfigResult{tokA: stX.Configs[tokA]}, decimalsB)
		require.False(t, pricedDeleted,
			"valuing tokB after the config deletion would invent a threshold — maxBorrowAtFrame refuses the basket as incompletely valued instead")

		// THROUGHOUT: tokB is absent from BOTH endpoint enumerations and from
		// every replayable surface — the invisibility that makes refusal the
		// floor rather than a modeling choice.
		parentSupported := []common.Address{tokA}
		execSupported := []common.Address{tokA}
		union := map[common.Address]bool{}
		for _, a := range append(append([]common.Address{}, parentSupported...), execSupported...) {
			union[a] = true
		}
		require.False(t, union[tokB],
			"tokB is in NEITHER pin's getCollateralTokens enumeration — the sweep universe cannot even ask about it")
		for _, leg := range stX.Collateral {
			require.NotEqual(t, tokB, leg.token, "no parent leg carries tokB — collateralOf@N-1 does not enumerate an unsupported token")
		}
		_, hasCfg := stX.Configs[tokB]
		require.False(t, hasCfg, "no parent config exists for tokB — there is nothing to attach the transient threshold to")
	})

	// The refusal must not be weaker when the payload does not decode: an
	// undecodable lifecycle witness still refuses (naming the decode failure),
	// because "cannot read which token" is strictly less knowledge, never more.
	t.Run("an undecodable lifecycle payload still refuses", func(t *testing.T) {
		bad := added
		bad.Data = ""
		r := replaySameBlockCauses([]snapshotdb.T6Witness{tick, bad}, replayTestDM, acct, replayTestUSDC, st)
		require.False(t, r.Complete())
		require.Contains(t, strings.Join(r.Notes, "\n"), "CollateralTokenAdded")
	})

	// THE GUARD: the refusal is EVENT-TRIGGERED, not blanket. The identical
	// case without the lifecycle events is the proven crossing the replay
	// machinery exists to certify — it must still resolve marginal-disclosed
	// once continuity is proven (and UNEXPLAINED while it is not, ruling L1).
	t.Run("guard: the same case WITHOUT lifecycle events stays marginal-disclosed", func(t *testing.T) {
		st2 := oneLegState(tokA, debtOld, pctE18(100), n, new(big.Int).Set(newIdx))
		r := replaySameBlockCauses([]snapshotdb.T6Witness{tick}, replayTestDM, acct, replayTestUSDC, st2)
		require.True(t, r.Proven)
		require.True(t, r.Complete(), "no lifecycle event, no refusal")
		require.Equal(t, eligFlippedWithWitness,
			classifyIntraBlock(r.InitialEligible, r.ParentComplete, true, true, r.Proven, r.Complete(), true),
			"the marginal arm stays intact — the lifecycle refusal must not become a blanket veto")
		require.Equal(t, eligUnexplainedOutcome,
			classifyIntraBlock(r.InitialEligible, r.ParentComplete, true, true, r.Proven, r.Complete(), false))
	})
}
