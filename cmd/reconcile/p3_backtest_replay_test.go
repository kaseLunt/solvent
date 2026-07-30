package main

// Wave-5 fix for Codex round 4's MEDIUM finding (reviewed @ c421213):
//
//   "Witness replay proves contact, not the eligibility transition."
//
// `Repaid` set Proven even though a repayment LOWERS the sampled account's
// debt and therefore cannot cause a healthy→liquidatable flip; likewise
// InterestIndexUpdated and CollateralTokenConfigSet were accepted without
// decoding or applying their old/new values. With the caller computing
// execEligible from BLOCK-END prices, `cause.Proven && execEligible` became a
// non-failing marginal-disclosed verdict — so an honest block containing a
// repayment (or a routine, too-small index update, or an LT-neutral config
// write) BEFORE the liquidation and a price update AFTER it hid exactly the
// false negative this gate exists to expose.
//
// The law now: Proven is true IFF a stateful replay — parent-boundary debt
// fold, parent basket/prices/configs, decoded witness payloads applied
// STRICTLY in log-index order — itself produces the false→true eligibility
// transition at some pre-liquidation point. Directionality is a CONSEQUENCE
// of applying the write, never a special case: a repayment simply cannot
// cross the threshold upward.
//
// ---------------------------------------------------------------------------
// MUTATION SPEC — committed BEFORE the implementation. Each mutant below must
// be killed by the named tests; after the suite passes, every mutant is CUT
// locally, the tests run, the kill confirmed, and the code restored.
//
//   m1  revert Proven to contact-only (any decoded pre-liquidation witness for
//       this account / the debt token / a held token sets Proven).
//       KILLED BY: TestRepaidThenPriceAfterIsUnexplained,
//                  TestRoutineIndexUpdateThenPriceAfterIsUnexplained,
//                  TestConfigWriteWithoutLTCutThenPriceAfterIsUnexplained.
//   m2  drop the causation conjunct from the classifier's marginal arm so
//       post-liquidation evidence (the block-end recomputation, i.e. a price
//       update after the liquidation) yields the marginal verdict on its own.
//       KILLED BY: the same three price-after counterexamples — each asserts
//       the composed verdict is UNEXPLAINED, not marginal-disclosed.
//   m2b drop the strict log-index ordering inside the replay (apply witnesses
//       in slice order instead of log order).
//       KILLED BY: TestReplayAppliesWitnessesInLogIndexOrder.
//   m3  skip applying the decoded write to the replayed state (recompute
//       eligibility from unchanged parent state every time).
//       KILLED BY: TestIndexMoveThatCrossesTheThresholdIsProven,
//                  TestLTCollapseOnHeldTokenIsProven,
//                  TestDebtTokenBorrowThatCrossesTheThresholdIsProven.
//
// Behavioural mutants only; a mutant that fails to compile is re-cut.
// ---------------------------------------------------------------------------
//
// FIXTURE-BACKED-OVER-TRANSCRIBED (Task 6 round-3 law): every ABI-shaped
// payload here either IS a captured chain log (internal/decode/testdata,
// provenance recorded in the fixture) or is packed by the SAME dmWitnessABI
// object that p3_witness_abi_test.go pins field-by-field against the
// committed forge artifact AND the captured logs. No hand-transcribed word
// offsets exist in this file: knife-edge thresholds are computed at runtime
// FROM the decoded fixture values.

import (
	"encoding/json"
	"math/big"
	"strings"
	"testing"

	"github.com/ethereum/go-ethereum/common"
	"github.com/stretchr/testify/require"

	"github.com/kaselunt/solvent/cmd/reconcile/snapshotdb"
)

// fixtureWitnessLog is the raw shape of one captured decoder-fixture entry.
type fixtureWitnessLog struct {
	Provenance string   `json:"provenance"`
	Address    string   `json:"address"`
	Topics     []string `json:"topics"`
	Data       string   `json:"data"`
}

// witnessFixtureEntry loads entry i of a captured decoder fixture.
func witnessFixtureEntry(t *testing.T, name string, i int) fixtureWitnessLog {
	t.Helper()
	var entries []fixtureWitnessLog
	require.NoError(t, json.Unmarshal(decodeTestdata(t, name), &entries))
	require.Greater(t, len(entries), i, "fixture %s has no entry %d", name, i)
	return entries[i]
}

// witnessFromFixture builds a T6Witness exactly as the snapshot collector
// would from the captured log: lowercase hex without 0x, topics decomposed to
// their low-20-byte address payloads, and the FULL data payload carried.
func witnessFromFixture(t *testing.T, name string, i int, logIndex uint32) snapshotdb.T6Witness {
	t.Helper()
	e := witnessFixtureEntry(t, name, i)
	strip := func(s string) string { return strings.ToLower(strings.TrimPrefix(s, "0x")) }
	w := snapshotdb.T6Witness{
		LogIndex: logIndex,
		Address:  strip(e.Address),
		Topic0:   strip(e.Topics[0]),
		Data:     strip(e.Data),
	}
	addrSlot := func(topic string) string {
		h := strip(topic)
		require.Len(t, h, 64, "fixture %s topic is not a 32-byte word", name)
		return h[24:]
	}
	if len(e.Topics) > 1 {
		w.Topic1Addr = addrSlot(e.Topics[1])
	}
	if len(e.Topics) > 2 {
		w.Topic2Addr = addrSlot(e.Topics[2])
	}
	if len(e.Topics) > 3 {
		w.Topic3Addr = addrSlot(e.Topics[3])
	}
	return w
}

// packedWitness builds a T6Witness whose data payload is packed by
// dmWitnessABI itself (the object pinned against the committed artifact and
// the captured logs) — used for event VARIANTS the captured set does not
// contain, e.g. an LT-neutral config write. Never hand-written offsets.
func packedWitness(t *testing.T, event string, logIndex uint32, t1, t2, t3 string, vals ...interface{}) snapshotdb.T6Witness {
	t.Helper()
	data, err := dmWitnessABI.Events[event].Inputs.NonIndexed().Pack(vals...)
	require.NoError(t, err, "packing %s payload via the pinned ABI", event)
	return snapshotdb.T6Witness{
		LogIndex: logIndex, Address: hexLower(replayTestDM.Hex()), Topic0: dmWitnessTopic0(event),
		Topic1Addr: t1, Topic2Addr: t2, Topic3Addr: t3,
		Data: common.Bytes2Hex(data),
	}
}

// cfgTuple mirrors CollateralTokenConfigSet's (ltv, liquidationThreshold,
// liquidationBonus) tuple for ABI packing.
type cfgTuple struct {
	Ltv                  *big.Int `abi:"ltv"`
	LiquidationThreshold *big.Int `abi:"liquidationThreshold"`
	LiquidationBonus     *big.Int `abi:"liquidationBonus"`
}

var (
	// The DM proxy and USDC(OP) as the captured fixtures carry them.
	replayTestDM   = common.HexToAddress("0x0078c5a459132e279056b2371fe8a8ec973a9553")
	replayTestUSDC = common.HexToAddress("0x0b2c639c533813f4aa9d7837caf62653d097ff85")
)

// pctE18 is an 1e18-scaled percentage (the DM's config unit).
func pctE18(n int64) *big.Int { return new(big.Int).Mul(big.NewInt(n), wad) }

// oneLegState is the canonical replay start: one collateral leg of a $1
// six-decimal token (engine-exact price 1e6 USD per whole token), threshold
// lt, and parent-boundary debt `normalized` at `index`.
func oneLegState(tok common.Address, legAmount, lt, normalized, index *big.Int) replayParentState {
	return replayParentState{
		NormalizedAtParent: normalized,
		IndexAtBlock:       index,
		Collateral:         []collateralLeg{{token: tok, amount: new(big.Int).Set(legAmount)}},
		Prices:             map[common.Address]*big.Int{tok: big.NewInt(1_000_000)},
		Configs: map[common.Address]collateralTokenConfigResult{tok: {
			LTV: pctE18(50), LiquidationThreshold: lt, LiquidationBonus: wad,
		}},
		Decimals: map[common.Address]uint8{tok: 6},
	}
}

// decodedIndexPair decodes (oldIndex, newIndex) from the REAL captured
// InterestIndexUpdated log — test-side, through the same pinned ABI — so the
// knife-edge thresholds below are computed from the chain's own values, not
// transcribed ones.
func decodedIndexPair(t *testing.T, w snapshotdb.T6Witness) (oldIdx, newIdx *big.Int) {
	t.Helper()
	vals, err := dmWitnessABI.Events["InterestIndexUpdated"].Inputs.NonIndexed().Unpack(common.Hex2Bytes(w.Data))
	require.NoError(t, err)
	require.Len(t, vals, 2)
	oldIdx, newIdx = vals[0].(*big.Int), vals[1].(*big.Int)
	require.NotNil(t, oldIdx)
	require.NotNil(t, newIdx)
	require.Positive(t, newIdx.Cmp(oldIdx), "the captured update must move the index upward for the knife-edge construction")
	return oldIdx, newIdx
}

// --- the three counterexamples the finding demands --------------------------

// TestRepaidThenPriceAfterIsUnexplained is counterexample (a): a REAL captured
// repayment for the sampled account before the liquidation, plus a price
// update after it (execEligible=true from the block-end recomputation). A
// repayment lowers debt — the replay cannot produce a false→true flip from it
// — so Proven must stay false and the composed verdict must be UNEXPLAINED,
// never marginal-disclosed. Kills m1 (contact-only) and m2 (classifier
// accepting post-liquidation evidence alone).
func TestRepaidThenPriceAfterIsUnexplained(t *testing.T) {
	w := witnessFromFixture(t, "dm_repaid.json", 0, 3)
	debtor := common.HexToAddress("0x" + w.Topic1Addr)

	// Healthy at the parent: debt $10.00 against maxBorrowLT $12.00.
	st := oneLegState(tokA, big.NewInt(12_000_000), pctE18(100), big.NewInt(10_000_000), wad)
	r := replaySameBlockCauses([]snapshotdb.T6Witness{w}, replayTestDM, debtor, replayTestUSDC, st)

	require.Equal(t, 1, r.Applied, "the repayment concerns this account and must be decoded and APPLIED")
	require.Equal(t, 0, r.Unrelated)
	require.False(t, r.Proven,
		"a repayment lowers the account's debt; the replay cannot cross from ineligible to eligible, so contact must not become causation")

	// The block-end recomputation says eligible (the price moved AFTER the
	// liquidation). Without a replayed pre-liquidation cause that is the
	// UNEXPLAINED third state — the honest failing verdict.
	require.Equal(t, eligUnexplainedOutcome, classifyIntraBlock(false, true, true, r.Proven),
		"Repaid-before + price-after must be UNEXPLAINED, not marginal-disclosed")
}

// TestRoutineIndexUpdateThenPriceAfterIsUnexplained is counterexample (b): the
// REAL captured InterestIndexUpdated (a routine accrual tick) applied to a
// position with headroom, plus a post-liquidation price update. The decoded
// move does not cross the threshold, so it proves nothing. Kills m1 and m2.
func TestRoutineIndexUpdateThenPriceAfterIsUnexplained(t *testing.T) {
	w := witnessFromFixture(t, "dm_interest_index_updated.json", 0, 7)
	require.Equal(t, hexLower(replayTestUSDC.Hex()), w.Topic1Addr, "the captured update is for USDC — the case's debt token")
	acct := common.HexToAddress("0x4d81ce1dd1b1e10f96313e080bf7b12136ff7e76")

	oldIdx, newIdx := decodedIndexPair(t, w)
	n := new(big.Int).Exp(big.NewInt(10), big.NewInt(12), nil) // normalized debt at the parent boundary
	debtNew := mulDivFloor(n, newIdx)
	require.Positive(t, debtNew.Cmp(mulDivFloor(n, oldIdx)), "at this position size the captured tick must move the USD debt at all — otherwise the test tests nothing")

	// Headroom: maxBorrowLT equals the POST-update debt, so even after the
	// decoded move the boolean stays false (Cmp > 0 is the eligibility law).
	st := oneLegState(tokA, debtNew, pctE18(100), n, new(big.Int).Set(newIdx))
	r := replaySameBlockCauses([]snapshotdb.T6Witness{w}, replayTestDM, acct, replayTestUSDC, st)

	require.Equal(t, 1, r.Applied)
	require.False(t, r.Proven,
		"a routine index tick that does not cross the threshold is not a cause; before this fix ANY debt-token index update set Proven")
	require.Equal(t, eligUnexplainedOutcome, classifyIntraBlock(false, true, true, r.Proven),
		"index-tick-before + price-after must be UNEXPLAINED, not marginal-disclosed")
}

// TestConfigWriteWithoutLTCutThenPriceAfterIsUnexplained is counterexample
// (c): CollateralTokenConfigSet on a HELD token where the liquidation
// threshold does NOT fall — once LT-unchanged (LTV moved only; ABI-packed
// variant) and once LT-RAISED (the REAL captured first-time set, 95e18 over a
// parent 50e18). Neither can produce a false→true flip. Kills m1 and m2.
func TestConfigWriteWithoutLTCutThenPriceAfterIsUnexplained(t *testing.T) {
	t.Run("LT unchanged (LTV-only write)", func(t *testing.T) {
		held := tokA
		w := packedWitness(t, "CollateralTokenConfigSet", 5, hexLower(held.Hex()), "", "",
			cfgTuple{Ltv: pctE18(50), LiquidationThreshold: pctE18(95), LiquidationBonus: wad},
			cfgTuple{Ltv: pctE18(40), LiquidationThreshold: pctE18(95), LiquidationBonus: wad})

		// Parent: $20.00 basket at LT 95% → maxBorrowLT $19.00; debt $10.00.
		st := oneLegState(held, big.NewInt(20_000_000), pctE18(95), big.NewInt(10_000_000), wad)
		r := replaySameBlockCauses([]snapshotdb.T6Witness{w}, replayTestDM, common.HexToAddress("0xaa"), replayTestUSDC, st)

		require.Equal(t, 1, r.Applied, "a config write on a held token is decoded and applied")
		require.False(t, r.Proven, "an LT-neutral write moves no input of the boolean downward; it cannot be the cause")
		require.Equal(t, eligUnexplainedOutcome, classifyIntraBlock(false, true, true, r.Proven))
	})

	t.Run("LT raised (the captured first-time set)", func(t *testing.T) {
		w := witnessFromFixture(t, "dm_collateral_token_config_set.json", 0, 5)
		held := common.HexToAddress("0x" + w.Topic1Addr)

		// Parent LT 50% on the held token; the captured write raises it to 95e18
		// — maxBorrowLT RISES, which moves the account AWAY from eligibility.
		st := oneLegState(held, big.NewInt(20_000_000), pctE18(50), big.NewInt(8_000_000), wad)
		r := replaySameBlockCauses([]snapshotdb.T6Witness{w}, replayTestDM, common.HexToAddress("0xaa"), replayTestUSDC, st)

		require.Equal(t, 1, r.Applied)
		require.False(t, r.Proven, "an LT-raising write cannot cause a healthy→liquidatable flip")
		require.Equal(t, eligUnexplainedOutcome, classifyIntraBlock(false, true, true, r.Proven))
	})
}

// --- positive controls: the fix must not degenerate into "nothing proves" ---

// TestIndexMoveThatCrossesTheThresholdIsProven drives the REAL captured
// InterestIndexUpdated against a knife-edge position: maxBorrowLT equals the
// PRE-update debt, so the decoded move itself crosses the threshold. The
// replay must produce the false→true transition and the composed verdict is
// the disclosed marginal pass. Kills m3 (skip-apply leaves the state at the
// parent values and no flip ever happens).
func TestIndexMoveThatCrossesTheThresholdIsProven(t *testing.T) {
	w := witnessFromFixture(t, "dm_interest_index_updated.json", 0, 7)
	acct := common.HexToAddress("0x4d81ce1dd1b1e10f96313e080bf7b12136ff7e76")

	oldIdx, newIdx := decodedIndexPair(t, w)
	n := new(big.Int).Exp(big.NewInt(10), big.NewInt(12), nil)
	debtOld := mulDivFloor(n, oldIdx)
	require.Positive(t, mulDivFloor(n, newIdx).Cmp(debtOld), "the captured tick must move the USD debt at this position size")

	// Knife edge: maxBorrowLT == debt at the OLD index (ineligible; the law is
	// strict >), and the decoded new index pushes the debt above it.
	//
	// IndexAtBlock is deliberately handed the POST-update snapshot — exactly
	// what the case's own liquidation event folded with — and the replay must
	// still start from the event's own oldIndex (the chain's statement of the
	// parent-boundary value), or the flip could never be attributed.
	st := oneLegState(tokA, debtOld, pctE18(100), n, new(big.Int).Set(newIdx))
	r := replaySameBlockCauses([]snapshotdb.T6Witness{w}, replayTestDM, acct, replayTestUSDC, st)

	require.True(t, r.Proven,
		"the decoded index move crosses the threshold in the replayed state — this is a genuinely caused flip and must stay a proven cause")
	require.Len(t, r.Causes, 1)
	require.Contains(t, r.Causes[0], "InterestIndexUpdated")
	require.Equal(t, eligFlippedWithWitness, classifyIntraBlock(false, true, true, r.Proven),
		"a replayed pre-liquidation cause plus corroboration is the disclosed marginal state")
}

// TestLTCollapseOnHeldTokenIsProven is the config-side positive control: an
// ABI-packed LT cut (95% → 40%) on the held token drops maxBorrowLT below the
// unchanged debt. Kills m3.
func TestLTCollapseOnHeldTokenIsProven(t *testing.T) {
	held := tokA
	w := packedWitness(t, "CollateralTokenConfigSet", 5, hexLower(held.Hex()), "", "",
		cfgTuple{Ltv: pctE18(50), LiquidationThreshold: pctE18(95), LiquidationBonus: wad},
		cfgTuple{Ltv: pctE18(50), LiquidationThreshold: pctE18(40), LiquidationBonus: wad})

	// Parent: $20.00 basket at LT 95% → maxBorrowLT $19.00 ≥ debt $10.00.
	// After the cut: $8.00 < $10.00 → the replay itself flips the boolean.
	st := oneLegState(held, big.NewInt(20_000_000), pctE18(95), big.NewInt(10_000_000), wad)
	r := replaySameBlockCauses([]snapshotdb.T6Witness{w}, replayTestDM, common.HexToAddress("0xaa"), replayTestUSDC, st)

	require.True(t, r.Proven, "a decoded LT cut that drops maxBorrowLT below the debt is a replayed cause")
	require.Contains(t, r.Causes[0], "CollateralTokenConfigSet")
	require.Equal(t, eligFlippedWithWitness, classifyIntraBlock(false, true, true, r.Proven))
}

// TestDebtTokenBorrowThatCrossesTheThresholdIsProven drives the REAL captured
// Borrowed log (token-native USDC amount in data): the decoded borrow raises
// the replayed debt above maxBorrowLT. Kills m3.
func TestDebtTokenBorrowThatCrossesTheThresholdIsProven(t *testing.T) {
	w := witnessFromFixture(t, "dm_borrowed.json", 0, 2)
	borrower := common.HexToAddress("0x" + w.Topic1Addr)
	require.Equal(t, hexLower(replayTestUSDC.Hex()), w.Topic2Addr, "the captured borrow is USDC — the case's debt token")

	// Parent: debt $1.00 against maxBorrowLT $2.00; the captured borrow is
	// several USD, so the replayed debt crosses.
	st := oneLegState(tokA, big.NewInt(2_000_000), pctE18(100), big.NewInt(1_000_000), wad)
	// The debt token's decimals are needed to value the borrow (the deployed
	// stable-snap law: 6-dec amounts ARE USD-6).
	st.Decimals[replayTestUSDC] = 6
	r := replaySameBlockCauses([]snapshotdb.T6Witness{w}, replayTestDM, borrower, replayTestUSDC, st)

	require.True(t, r.Proven, "a decoded borrow of the debt token that crosses the threshold is a replayed cause")
	require.Contains(t, r.Causes[0], "Borrowed")
	require.Equal(t, eligFlippedWithWitness, classifyIntraBlock(false, true, true, r.Proven))
}

// --- ordering ---------------------------------------------------------------

// TestReplayAppliesWitnessesInLogIndexOrder feeds the replay a slice whose
// ORDER contradicts the log indexes: a big index jump at log 4, a repayment at
// log 2. Applied in log order (repay FIRST, at the old index), the account
// never becomes eligible; applied in slice order the jump would flip it before
// the repayment. Kills m2b.
func TestReplayAppliesWitnessesInLogIndexOrder(t *testing.T) {
	acct := common.HexToAddress("0x4d81ce1dd1b1e10f96313e080bf7b12136ff7e76")
	usdcHex := hexLower(replayTestUSDC.Hex())
	acctHex := hexLower(acct.Hex())

	jump := packedWitness(t, "InterestIndexUpdated", 4, usdcHex, "", "",
		wad, new(big.Int).Mul(big.NewInt(2), wad)) // 1e18 → 2e18
	repay := packedWitness(t, "Repaid", 2, acctHex, acctHex, usdcHex,
		big.NewInt(6_000_000)) // $6.00, USD-6 per the deployed Repaid semantics

	// Parent: debt $8.00 against maxBorrowLT $9.00 (ineligible).
	//   log order:   repay → $2.00 at 1e18; jump → $4.00 at 2e18: never > $9.00.
	//   slice order: jump first → $16.00 > $9.00: a false flip.
	st := oneLegState(tokA, big.NewInt(9_000_000), pctE18(100), big.NewInt(8_000_000), wad)
	r := replaySameBlockCauses([]snapshotdb.T6Witness{jump, repay}, replayTestDM, acct, replayTestUSDC, st)

	require.Equal(t, 2, r.Applied)
	require.False(t, r.Proven,
		"in log-index order the repayment lands BEFORE the index jump and the account never crosses; only an out-of-order replay could claim a flip")
}

// --- honesty caveats --------------------------------------------------------

// TestUndecodableRelevantWitnessProvesNothing: an event that CONCERNS the
// account (a debt-token index update) but carries no decodable payload cannot
// be applied and therefore cannot prove — the case fails UNEXPLAINED rather
// than being excused, and the refusal is recorded.
func TestUndecodableRelevantWitnessProvesNothing(t *testing.T) {
	acct := common.HexToAddress("0x4d81ce1dd1b1e10f96313e080bf7b12136ff7e76")
	w := snapshotdb.T6Witness{
		LogIndex: 9, Address: hexLower(replayTestDM.Hex()),
		Topic0: topicDMInterestIndexUpdated, Topic1Addr: hexLower(replayTestUSDC.Hex()),
		// no Data
	}
	st := oneLegState(tokA, big.NewInt(1), pctE18(100), big.NewInt(1_000_000), wad)
	r := replaySameBlockCauses([]snapshotdb.T6Witness{w}, replayTestDM, acct, replayTestUSDC, st)
	require.False(t, r.Proven, "what cannot be applied cannot prove")
	require.Equal(t, 0, r.Applied)
	require.NotEmpty(t, r.Notes, "the refusal is disclosed, never silent")
}

// TestCrossTokenBorrowIsDisclosedNotProven: a borrow of a DIFFERENT token by
// this account genuinely raises its TOTAL borrowings on chain, but the
// frame's debt model tracks only the case's debt token — the replay cannot
// reproduce that flip, so it must refuse (UNEXPLAINED) and say why, never
// wave the case through on contact.
func TestCrossTokenBorrowIsDisclosedNotProven(t *testing.T) {
	acct := common.HexToAddress("0x983e36549d27ccfe30d37e615d35222f52fc104d")
	otherToken := common.HexToAddress("0x94b008aa00579c1307b0ef2c499ad98a8ce58e58")
	w := packedWitness(t, "Borrowed", 3, hexLower(acct.Hex()), hexLower(otherToken.Hex()), "",
		big.NewInt(50_000_000))

	st := oneLegState(tokA, big.NewInt(2_000_000), pctE18(100), big.NewInt(1_000_000), wad)
	r := replaySameBlockCauses([]snapshotdb.T6Witness{w}, replayTestDM, acct, replayTestUSDC, st)
	require.False(t, r.Proven, "the single-debt-token model cannot replay a cross-token borrow; refusing honestly beats excusing")
	require.NotEmpty(t, r.Notes)
	require.Equal(t, eligUnexplainedOutcome, classifyIntraBlock(false, true, true, r.Proven),
		"an unreplayable write leaves the case UNEXPLAINED — the run fails and the reviewer sees why")
}
