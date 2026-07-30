package main

// L2 basket-continuity: the decode layer, the closure identity, and the
// attribution law — every fixture drives assembleContinuitySweep +
// proveBasketContinuity, the EXACT production path, from raw JSON envelopes
// (the golden-vectors posture: a fixture that bypasses the decode proves the
// arithmetic, not the gate).
//
// FIXTURE-REALISM LAW (ruling L7, the P0 lesson): every honest fixture below
// satisfies the closure identity, and every liquidation-case fixture carries
// the case's own pre-boundary seizure transfers — their absence is
// chain-impossible (DebtManagerCore.sol:575 < :584), and
// TestContinuityMissingSeizureTransfersIsRefused pins that a fixture WITHOUT
// them cannot pass.

import (
	"context"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"math/big"
	"os"
	"regexp"
	"strings"
	"testing"

	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/crypto"
	"github.com/stretchr/testify/require"

	"github.com/kaselunt/solvent/cmd/reconcile/snapshotdb"
)

// --- topic0 derivation pins (the round-3 hand-written-topic0 lesson) --------

// TestContinuityTopicsAreDerivedFromTheCommittedEmitterSource re-derives the
// four netting topic0s from the COMMITTED artifact itself — the event
// declarations in recon/cash-v3/src/modules/cash/CashEventEmitter.sol — and
// compares them with the ABI-derived IDs production sweeps with. A drifted
// transcription (a renamed event, a changed parameter type) fails here
// against a file nobody hand-wrote for this test.
func TestContinuityTopicsAreDerivedFromTheCommittedEmitterSource(t *testing.T) {
	src, err := os.ReadFile("../../recon/cash-v3/src/modules/cash/CashEventEmitter.sol")
	require.NoError(t, err, "the committed cash-v3 artifact must be present")
	re := regexp.MustCompile(`(?m)^\s*event\s+(WithdrawalRequested|WithdrawalAmountUpdated|WithdrawalCancelled|WithdrawalProcessed)\s*\(([^)]*)\)\s*;`)
	matches := re.FindAllStringSubmatch(string(src), -1)
	require.Len(t, matches, 4, "the committed source declares exactly the four withdrawal-lifecycle events")

	canon := map[string]string{}
	for _, m := range matches {
		var types []string
		for _, param := range strings.Split(m[2], ",") {
			fields := strings.Fields(strings.TrimSpace(param))
			require.NotEmpty(t, fields, "event %s declares an empty parameter", m[1])
			types = append(types, fields[0]) // the TYPE; "indexed" and the name follow
		}
		canon[m[1]] = m[1] + "(" + strings.Join(types, ",") + ")"
	}
	for name, want := range map[string]common.Hash{
		"WithdrawalRequested":     topicWithdrawalRequested,
		"WithdrawalAmountUpdated": topicWithdrawalAmountUpd,
		"WithdrawalCancelled":     topicWithdrawalCancelled,
		"WithdrawalProcessed":     topicWithdrawalProcessed,
	} {
		sig, ok := canon[name]
		require.True(t, ok, "event %s missing from the committed source", name)
		require.Equal(t, common.BytesToHash(crypto.Keccak256([]byte(sig))), want,
			"topic0 for %s: the ABI transcription disagrees with the committed .sol declaration (%s)", name, sig)
	}
}

// TestContinuityTransferTopicIsCanonical pins the Transfer topic0 two ways:
// keccak over the canonical EIP-20 signature, and the standard's published
// constant (cross-pin only — production NEVER consumes a hand-written hash).
func TestContinuityTransferTopicIsCanonical(t *testing.T) {
	require.Equal(t, common.BytesToHash(crypto.Keccak256([]byte("Transfer(address,address,uint256)"))), topicERC20Transfer)
	require.Equal(t, "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef",
		topicERC20Transfer.Hex(), "the EIP-20 canonical Transfer topic")
}

// --- envelope builders (raw JSON, through the production decode) ------------

var (
	contPin   = common.HexToHash("0x9e536de1af09f42ee10c674b850dbe452db3d8222bd61b9792b1288c8af4f8e5")
	contCase  = common.HexToHash("0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc01")
	contSafe  = common.HexToAddress("0x983e36549d27ccfe30d37e615d35222f52fc104d")
	contOther = common.HexToAddress("0x0c51a1690899b4482458f432a5e80c9682574205")
)

func padTopic(a common.Address) string {
	return "0x" + hex.EncodeToString(common.LeftPadBytes(a.Bytes(), 32))
}

func envLog(addr common.Address, pin, tx common.Hash, idx uint64, topics []string, data []byte) map[string]any {
	return map[string]any{
		"address":         strings.ToLower(addr.Hex()),
		"topics":          topics,
		"data":            "0x" + hex.EncodeToString(data),
		"blockHash":       strings.ToLower(pin.Hex()),
		"transactionHash": strings.ToLower(tx.Hex()),
		"logIndex":        fmt.Sprintf("0x%x", idx),
	}
}

func envelope(t *testing.T, logs ...map[string]any) json.RawMessage {
	t.Helper()
	if logs == nil {
		logs = []map[string]any{}
	}
	b, err := json.Marshal(logs)
	require.NoError(t, err)
	return b
}

// transferLog packs one ERC20 Transfer wire log.
func transferLog(token, from, to common.Address, val *big.Int, pin, tx common.Hash, idx uint64) map[string]any {
	return envLog(token, pin, tx, idx,
		[]string{topicERC20Transfer.Hex(), padTopic(from), padTopic(to)},
		common.LeftPadBytes(val.Bytes(), 32))
}

// nettingLog packs one CashEventEmitter lifecycle wire log through the SAME
// ABI object production decodes with.
func nettingLog(t *testing.T, kind string, safe common.Address, tokens []common.Address,
	amounts []*big.Int, pin, tx common.Hash, idx uint64) map[string]any {
	t.Helper()
	var data []byte
	var err error
	switch kind {
	case "WithdrawalRequested":
		data, err = cashEmitterABI.Events[kind].Inputs.NonIndexed().Pack(tokens, amounts, big.NewInt(1_700_000_000))
	case "WithdrawalCancelled", "WithdrawalProcessed":
		data, err = cashEmitterABI.Events[kind].Inputs.NonIndexed().Pack(tokens, amounts)
	case "WithdrawalAmountUpdated":
		data, err = cashEmitterABI.Events[kind].Inputs.NonIndexed().Pack(amounts[0])
	default:
		t.Fatalf("unknown netting kind %s", kind)
	}
	require.NoError(t, err)
	topics := []string{emitterTopic0(kind).Hex(), padTopic(safe), padTopic(contOther)}
	if kind == "WithdrawalAmountUpdated" {
		topics = []string{emitterTopic0(kind).Hex(), padTopic(safe), padTopic(tokens[0])}
	}
	return envLog(cashEventEmitterOP, pin, tx, idx, topics, data)
}

// fakeLogsBackend serves the three sweep questions in issue order:
// transfers-out, transfers-in, netting.
type fakeLogsBackend struct {
	out, in, net json.RawMessage
	asked        []logsQuery
}

func (f *fakeLogsBackend) rawLogsAtHash(_ context.Context, op string, q logsQuery) (json.RawMessage, error) {
	f.asked = append(f.asked, q)
	switch {
	case strings.Contains(op, "transfers-out"):
		return f.out, nil
	case strings.Contains(op, "transfers-in"):
		return f.in, nil
	default:
		return f.net, nil
	}
}

// seiz builds one T6Seizure element.
func seiz(tok common.Address, amount int64) snapshotdb.T6Seizure {
	return snapshotdb.T6Seizure{AssetHex: hexLower(tok.Hex()), Amount: big.NewInt(amount), Bonus: big.NewInt(0)}
}

func legs(pairs ...any) []collateralLeg {
	var out []collateralLeg
	for i := 0; i < len(pairs); i += 2 {
		out = append(out, collateralLeg{token: pairs[i].(common.Address), amount: big.NewInt(pairs[i+1].(int64))})
	}
	return out
}

// driveSweep runs the PRODUCTION assembler over the fake backend. The
// supported set defaults to the legs∪seized union so every pre-adjustment
// fixture keeps its exact address list (supported ⊇ union holds by equality);
// fixtures about the WIDER supported set use driveSweepSupported.
func driveSweep(t *testing.T, b rawLogsBackend, boundary uint32,
	parentLegs, execLegs []collateralLeg, seizures []snapshotdb.T6Seizure) *continuitySweep {
	t.Helper()
	var supported []common.Address
	seen := map[common.Address]bool{}
	for _, l := range append(append([]collateralLeg{}, parentLegs...), execLegs...) {
		if !seen[l.token] {
			seen[l.token] = true
			supported = append(supported, l.token)
		}
	}
	for _, s := range seizures {
		tok := common.HexToAddress(s.AssetHex)
		if !seen[tok] {
			seen[tok] = true
			supported = append(supported, tok)
		}
	}
	return driveSweepSupported(t, b, boundary, parentLegs, execLegs, seizures, supported, supported)
}

// driveSweepSupported is driveSweep with the supported-collateral sets given
// explicitly (addendum adjustment 1: the swept address list is the supported
// set at both pins, not the legs∪seized union).
func driveSweepSupported(t *testing.T, b rawLogsBackend, boundary uint32,
	parentLegs, execLegs []collateralLeg, seizures []snapshotdb.T6Seizure,
	parentSupported, execSupported []common.Address) *continuitySweep {
	t.Helper()
	if fb, ok := b.(*fakeLogsBackend); ok {
		if fb.out == nil {
			fb.out = envelope(t)
		}
		if fb.in == nil {
			fb.in = envelope(t)
		}
		if fb.net == nil {
			fb.net = envelope(t)
		}
	}
	return assembleContinuitySweep(context.Background(), b, newGateFrame(gateBacktest),
		"unit-case", contPin, 150000000, boundary, contCase, contSafe, parentLegs, execLegs,
		parentSupported, execSupported, seizures)
}

// witnessWithTx decorates a packedWitness with its tx identity (the L2
// attribution join).
func witnessWithTx(w snapshotdb.T6Witness, tx common.Hash) snapshotdb.T6Witness {
	w.TxHash = strings.TrimPrefix(strings.ToLower(tx.Hex()), "0x")
	return w
}

// --- the honest shapes (closure holds, everything attributes) ---------------

// TestContinuityHonestSinglePassLiquidationProves is the canonical honest
// case: the case's own seizure leaves the basket pre-boundary as an outbound
// Transfer whose per-token aggregate equals the decoded elements; closure
// balances; nothing else moved. The proof must be PROVEN — this is the
// positive control every refusal fixture is measured against.
func TestContinuityHonestSinglePassLiquidationProves(t *testing.T) {
	b := &fakeLogsBackend{
		out: envelope(t, transferLog(tokA, contSafe, contOther, big.NewInt(10_000_000), contPin, contCase, 95)),
	}
	sw := driveSweep(t, b, 100, legs(tokA, int64(30_000_000)), legs(tokA, int64(20_000_000)),
		[]snapshotdb.T6Seizure{seiz(tokA, 10_000_000)})
	require.Empty(t, sw.Refusal)
	o := proveBasketContinuity(sw, []snapshotdb.T6Seizure{seiz(tokA, 10_000_000)}, nil)
	require.Empty(t, o.Refusals)
	require.True(t, o.Proven, "the honest single-pass liquidation is exactly what the proof exists to certify")
	require.Contains(t, o.Outcome, "proven:", "the outcome text is the evidence the marginal arm carries")

	// The two sweep (b) questions really were asked as the ruling writes
	// them: [Transfer, safe] and [Transfer, ·, safe] over the token list.
	require.Len(t, b.asked, 3)
	require.Equal(t, []common.Address{tokA}, b.asked[0].Addresses)
	require.Equal(t, topicERC20Transfer, b.asked[0].Topics[0][0])
	require.Len(t, b.asked[1].Topics, 3, "the inbound question wildcards `from` and pins `to`")
	require.Empty(t, b.asked[1].Topics[1])
	require.Equal(t, []common.Address{cashEventEmitterOP}, b.asked[2].Addresses,
		"sweep (c) is pinned to the CashEventEmitter singleton")
	require.Len(t, b.asked[2].Topics[0], 4, "all four lifecycle topics are asked at once")
}

// TestContinuityPendingWithdrawalLiquidationProves is the shape that made the
// Codex-literal remedy UNSOUND (ruling Part 1 item 3): a pending-withdrawal
// Safe is liquidated — _cancelOldWithdrawal frees the pending amount with
// ZERO transfers inside the case's own tx, then the seizure transfers out the
// collateral. A balance/Transfer-only proof spuriously refuses this honest
// case; the Δpending term closes it. PROVEN is the required verdict.
//
// Mutation m2 (drop the Δpending term from the closure): this fixture
// FALSE-REFUSES (−20 != −50), while its sibling below FALSE-PASSES — the two
// directions the mutation spec demands.
func TestContinuityPendingWithdrawalLiquidationProves(t *testing.T) {
	// Parent: balance 100, pending 30 → netted leg 70. The tx cancels the
	// pending (idx 90) and seizes 50 (idx 95); exec: balance 50, pending 0 →
	// leg 50. Δleg = −20 == Σtransfers(−50) − Δpending(−30).
	b := &fakeLogsBackend{
		out: envelope(t, transferLog(tokA, contSafe, contOther, big.NewInt(50_000_000), contPin, contCase, 95)),
		net: envelope(t, nettingLog(t, "WithdrawalCancelled", contSafe,
			[]common.Address{tokA}, []*big.Int{big.NewInt(30_000_000)}, contPin, contCase, 90)),
	}
	sw := driveSweep(t, b, 100, legs(tokA, int64(70_000_000)), legs(tokA, int64(50_000_000)),
		[]snapshotdb.T6Seizure{seiz(tokA, 50_000_000)})
	require.Empty(t, sw.Refusal)
	o := proveBasketContinuity(sw, []snapshotdb.T6Seizure{seiz(tokA, 50_000_000)}, nil)
	require.Empty(t, o.Refusals,
		"a pending-withdrawal liquidation is HONEST chain behavior; refusing it is the exact unsoundness the ruling found in the balance-only remedy")
	require.True(t, o.Proven)
	require.Equal(t, "30000000", o.CancelledPreBoundary[tokA].String(),
		"the attributed release is recorded for the L5 discrimination")
}

// TestContinuityNettingMovedBalanceOnlyIsRefused is m2's OTHER direction: the
// exec leg does NOT reflect the freed pending (a lens/balance write the
// transfer layer cannot explain). The honest proof refuses on the closure
// identity; a Δpending-less mutant would false-PASS exactly here, because
// Δleg then equals the raw transfer sum.
func TestContinuityNettingMovedBalanceOnlyIsRefused(t *testing.T) {
	b := &fakeLogsBackend{
		out: envelope(t, transferLog(tokA, contSafe, contOther, big.NewInt(50_000_000), contPin, contCase, 95)),
		net: envelope(t, nettingLog(t, "WithdrawalCancelled", contSafe,
			[]common.Address{tokA}, []*big.Int{big.NewInt(30_000_000)}, contPin, contCase, 90)),
	}
	// exec leg 20: consistent with Δbalance alone (70−50), NOT with the
	// netting term (the true netted leg would be 50).
	sw := driveSweep(t, b, 100, legs(tokA, int64(70_000_000)), legs(tokA, int64(20_000_000)),
		[]snapshotdb.T6Seizure{seiz(tokA, 50_000_000)})
	require.Empty(t, sw.Refusal)
	o := proveBasketContinuity(sw, []snapshotdb.T6Seizure{seiz(tokA, 50_000_000)}, nil)
	require.False(t, o.Proven)
	require.Len(t, o.Refusals, 1)
	require.Contains(t, o.Refusals[0], "closure identity FAILS",
		"the netting term is load-bearing: leg@N − leg@N-1 = −50 while Σtransfers − Δpending = −20")
}

// TestContinuityQuiescentBasketProves: no movement at all — the common case on
// this population. Closure holds trivially on every token; nothing to
// attribute; proven.
func TestContinuityQuiescentBasketProves(t *testing.T) {
	sw := driveSweep(t, &fakeLogsBackend{}, 100, legs(tokA, int64(30_000_000)), legs(tokA, int64(30_000_000)), nil)
	require.Empty(t, sw.Refusal)
	o := proveBasketContinuity(sw, nil, nil)
	require.True(t, o.Proven)
	require.Empty(t, o.Refusals)
}

// --- the required refusal fixtures (ruling L7) ------------------------------

// TestContinuityUnattributedInboundIsRefused: a pre-boundary transfer INTO the
// safe with no custodied cause — the H2 false-marginal direction. Closure
// balances (the exec leg reflects it), so the refusal is PURELY the
// attribution law: evidence, never excuse. Kills m3 (accept unattributed
// movements).
func TestContinuityUnattributedInboundIsRefused(t *testing.T) {
	txY := common.HexToHash("0xdddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd02")
	b := &fakeLogsBackend{
		in: envelope(t, transferLog(tokA, contOther, contSafe, big.NewInt(5_000_000), contPin, txY, 40)),
	}
	sw := driveSweep(t, b, 100, legs(tokA, int64(30_000_000)), legs(tokA, int64(35_000_000)), nil)
	require.Empty(t, sw.Refusal)
	o := proveBasketContinuity(sw, nil, nil)
	require.False(t, o.Proven)
	require.Len(t, o.Refusals, 1)
	require.Contains(t, o.Refusals[0], "unattributed INBOUND pre-boundary movement")
	require.Contains(t, o.Refusals[0], "a modeled crossing cannot be certified to have held",
		"the L4 inbound narrative, verbatim direction")
}

// TestContinuityUnattributedOutboundIsRefused: the other direction — a
// pre-boundary transfer OUT of the safe in a tx with no witnessed
// liquidation. L4: outbound NEVER upgrades to marginal; the refusal narrative
// names it a candidate uncaptured cause. Kills m3.
func TestContinuityUnattributedOutboundIsRefused(t *testing.T) {
	txY := common.HexToHash("0xdddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd03")
	b := &fakeLogsBackend{
		out: envelope(t, transferLog(tokA, contSafe, contOther, big.NewInt(5_000_000), contPin, txY, 40)),
	}
	sw := driveSweep(t, b, 100, legs(tokA, int64(30_000_000)), legs(tokA, int64(25_000_000)), nil)
	require.Empty(t, sw.Refusal)
	o := proveBasketContinuity(sw, nil, nil)
	require.False(t, o.Proven)
	require.Len(t, o.Refusals, 1)
	require.Contains(t, o.Refusals[0], "unattributed OUTBOUND pre-boundary movement")
	require.Contains(t, o.Refusals[0], "Outbound NEVER upgrades to marginal",
		"the L4 outbound narrative: chain-truth R1 admits only custodied witnesses as flip explanations")
}

// TestContinuityClosureViolationIsRefused: a non-standard token (rebase/skim)
// — the balance moved without a Transfer. The closure identity refuses BY
// ARITHMETIC; no allowlist anywhere.
func TestContinuityClosureViolationIsRefused(t *testing.T) {
	sw := driveSweep(t, &fakeLogsBackend{}, 100, legs(tokA, int64(30_000_000)), legs(tokA, int64(30_000_777)), nil)
	require.Empty(t, sw.Refusal)
	o := proveBasketContinuity(sw, nil, nil)
	require.False(t, o.Proven)
	require.Len(t, o.Refusals, 1)
	require.Contains(t, o.Refusals[0], "closure identity FAILS")
	require.Contains(t, o.Refusals[0], "non-standard token",
		"the refusal names the class: rebasing accrual / fee-on-transfer / any unswept balance write")
}

// TestContinuityUnattributedNettingEventIsRefused: a pre-boundary
// WithdrawalRequested (a user's own netting move) — closure balances via the
// Δpending term, so the refusal is again purely attributional.
func TestContinuityUnattributedNettingEventIsRefused(t *testing.T) {
	txY := common.HexToHash("0xdddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd04")
	b := &fakeLogsBackend{
		net: envelope(t, nettingLog(t, "WithdrawalRequested", contSafe,
			[]common.Address{tokA}, []*big.Int{big.NewInt(30_000_000)}, contPin, txY, 50)),
	}
	sw := driveSweep(t, b, 100, legs(tokA, int64(100_000_000)), legs(tokA, int64(70_000_000)), nil)
	require.Empty(t, sw.Refusal)
	o := proveBasketContinuity(sw, nil, nil)
	require.False(t, o.Proven)
	require.Len(t, o.Refusals, 1)
	require.Contains(t, o.Refusals[0], "unattributed pre-boundary netting event: WithdrawalRequested")
	require.Contains(t, o.Refusals[0], "CashLens.sol:544-546")
}

// TestContinuityEarlierPassCancellationIsUnmodeledRefusal is the ruling's own
// attributed-but-unmodeled example: the cancellation precedes a witnessed
// Liquidated below the boundary, so the freed netting feeds a replayed
// eligibility state whose legs exclude it. Attribution SUCCEEDS; the model
// gap refuses per all-or-nothing (refusal is the floor; completing the model
// is the sanctioned extension).
func TestContinuityEarlierPassCancellationIsUnmodeledRefusal(t *testing.T) {
	// Two-pass tx: cancel(30)@80 → pass-1 seizure transfer 20@85 →
	// Liquidated₁@90 (witnessed) → case seizure transfer 50@95 → case
	// Liquidated@100. Balance 100→30, pending 30→0; parent leg 70, exec 30.
	liqW := witnessWithTx(packedWitness(t, "Liquidated", 90,
		hexLower(contOther.Hex()), hexLower(contSafe.Hex()), hexLower(replayTestUSDC.Hex()),
		[]seizedTuple{{Token: tokA, Amount: big.NewInt(20_000_000), LiquidationBonus: big.NewInt(200_000)}},
		big.NewInt(40_000_000), big.NewInt(20_000_000)), contCase)
	b := &fakeLogsBackend{
		out: envelope(t,
			transferLog(tokA, contSafe, contOther, big.NewInt(20_000_000), contPin, contCase, 85),
			transferLog(tokA, contSafe, contOther, big.NewInt(50_000_000), contPin, contCase, 95)),
		net: envelope(t, nettingLog(t, "WithdrawalCancelled", contSafe,
			[]common.Address{tokA}, []*big.Int{big.NewInt(30_000_000)}, contPin, contCase, 80)),
	}
	sw := driveSweep(t, b, 100, legs(tokA, int64(70_000_000)), legs(tokA, int64(30_000_000)),
		[]snapshotdb.T6Seizure{seiz(tokA, 50_000_000)})
	require.Empty(t, sw.Refusal)
	o := proveBasketContinuity(sw, []snapshotdb.T6Seizure{seiz(tokA, 50_000_000)}, []snapshotdb.T6Witness{liqW})
	require.False(t, o.Proven)
	require.Len(t, o.Refusals, 1, "closure holds and every transfer attributes — the ONE refusal is the model gap")
	require.Contains(t, o.Refusals[0], "attributed-but-unmodeled netting release")
	require.Contains(t, o.Refusals[0], "refusal is the floor")
}

// TestContinuityMissingSeizureTransfersIsRefused is the fixture-realism law
// with teeth: a "liquidation" whose sweep shows NO outbound seizure transfers
// is chain-impossible (:575 < :584). The two-sided per-token aggregate
// equality refuses it even though the (dishonestly static) legs make the
// closure identity trivially true.
func TestContinuityMissingSeizureTransfersIsRefused(t *testing.T) {
	sw := driveSweep(t, &fakeLogsBackend{}, 100, legs(tokA, int64(30_000_000)), legs(tokA, int64(30_000_000)),
		[]snapshotdb.T6Seizure{seiz(tokA, 10_000_000)})
	require.Empty(t, sw.Refusal)
	o := proveBasketContinuity(sw, []snapshotdb.T6Seizure{seiz(tokA, 10_000_000)}, nil)
	require.False(t, o.Proven)
	require.Len(t, o.Refusals, 1)
	require.Contains(t, o.Refusals[0], "chain-impossible")
	require.Contains(t, o.Refusals[0], "0 but the tx's decoded Liquidated elements seize 10000000")
}

// TestContinuityWithdrawalAmountUpdatedIsRefused: the payload carries an
// absolute amount whose prior value no event states — Δpending underivable,
// refusal over fabrication (and the committed source has no caller for it,
// so one appearing is doubly anomalous).
func TestContinuityWithdrawalAmountUpdatedIsRefused(t *testing.T) {
	txY := common.HexToHash("0xdddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd05")
	b := &fakeLogsBackend{
		net: envelope(t, nettingLog(t, "WithdrawalAmountUpdated", contSafe,
			[]common.Address{tokA}, []*big.Int{big.NewInt(9_000_000)}, contPin, txY, 50)),
	}
	sw := driveSweep(t, b, 100, legs(tokA, int64(30_000_000)), legs(tokA, int64(30_000_000)), nil)
	require.Empty(t, sw.Refusal)
	o := proveBasketContinuity(sw, nil, nil)
	require.False(t, o.Proven)
	require.NotEmpty(t, o.Refusals)
	require.Contains(t, strings.Join(o.Refusals, " | "), "Δpending is underivable")
}

// --- the L6 response-validation refusals (through the assembler) ------------

// TestContinuityWrongBlockHashEchoIsRefused: the provider answered a log from
// a DIFFERENT block than the pinned question — the response does not answer
// the question asked. Kills m4 (skip the echo validation).
func TestContinuityWrongBlockHashEchoIsRefused(t *testing.T) {
	wrong := common.HexToHash("0x60a1dc499938a1c70dc6377408b31bc0f8e6490ebeb4a18b1eb37b214687caf7")
	b := &fakeLogsBackend{
		out: envelope(t, transferLog(tokA, contSafe, contOther, big.NewInt(10_000_000), wrong, contCase, 95)),
	}
	sw := driveSweep(t, b, 100, legs(tokA, int64(30_000_000)), legs(tokA, int64(20_000_000)),
		[]snapshotdb.T6Seizure{seiz(tokA, 10_000_000)})
	require.NotEmpty(t, sw.Refusal, "a wrong echo refuses the WHOLE sweep")
	require.Contains(t, sw.Refusal, "does not answer the question asked")
	o := proveBasketContinuity(sw, []snapshotdb.T6Seizure{seiz(tokA, 10_000_000)}, nil)
	require.False(t, o.Proven, "a refused sweep can never discharge the conjunct")
	require.Contains(t, strings.Join(o.Refusals, " "), "echoes blockHash")
}

// TestContinuityFourTopicTransferIsRefused: the ERC721 topic0 collision — a
// 4-topic Transfer from a swept address is a shape violation, refused loudly
// (an "ERC20" that emits it is not standard, which is exactly what the proof
// exists to catch).
func TestContinuityFourTopicTransferIsRefused(t *testing.T) {
	nft := envLog(tokA, contPin, contCase, 95,
		[]string{topicERC20Transfer.Hex(), padTopic(contSafe), padTopic(contOther), padTopic(contOther)},
		[]byte{})
	b := &fakeLogsBackend{out: envelope(t, nft)}
	sw := driveSweep(t, b, 100, legs(tokA, int64(30_000_000)), legs(tokA, int64(20_000_000)),
		[]snapshotdb.T6Seizure{seiz(tokA, 10_000_000)})
	require.NotEmpty(t, sw.Refusal)
	require.Contains(t, sw.Refusal, "4-topic Transfer")
	require.False(t, proveBasketContinuity(sw, nil, nil).Proven)
}

// TestContinuityDataWidthAndAddressSetAreRefused: the remaining L6 shape laws.
func TestContinuityDataWidthAndAddressSetAreRefused(t *testing.T) {
	t.Run("data not exactly 32 bytes", func(t *testing.T) {
		short := envLog(tokA, contPin, contCase, 95,
			[]string{topicERC20Transfer.Hex(), padTopic(contSafe), padTopic(contOther)},
			[]byte{0x01, 0x02})
		b := &fakeLogsBackend{out: envelope(t, short)}
		sw := driveSweep(t, b, 100, legs(tokA, int64(30_000_000)), nil, nil)
		require.NotEmpty(t, sw.Refusal)
		require.Contains(t, sw.Refusal, "EXACTLY 32")
	})
	t.Run("address outside the requested set", func(t *testing.T) {
		foreign := transferLog(tokB, contSafe, contOther, big.NewInt(1), contPin, contCase, 95)
		b := &fakeLogsBackend{out: envelope(t, foreign)}
		sw := driveSweep(t, b, 100, legs(tokA, int64(30_000_000)), nil, nil)
		require.NotEmpty(t, sw.Refusal)
		require.Contains(t, sw.Refusal, "outside the requested address set")
	})
	t.Run("null result is a non-answer", func(t *testing.T) {
		b := &fakeLogsBackend{out: json.RawMessage("null")}
		sw := driveSweep(t, b, 100, legs(tokA, int64(30_000_000)), nil, nil)
		require.NotEmpty(t, sw.Refusal)
		require.Contains(t, sw.Refusal, "null")
	})
	t.Run("absent wire field refuses", func(t *testing.T) {
		l := transferLog(tokA, contSafe, contOther, big.NewInt(1), contPin, contCase, 95)
		delete(l, "logIndex")
		b := &fakeLogsBackend{out: envelope(t, l)}
		sw := driveSweep(t, b, 100, legs(tokA, int64(30_000_000)), nil, nil)
		require.NotEmpty(t, sw.Refusal)
		require.Contains(t, sw.Refusal, "omits required field")
	})
	t.Run("non-canonical logIndex refuses", func(t *testing.T) {
		l := transferLog(tokA, contSafe, contOther, big.NewInt(1), contPin, contCase, 95)
		l["logIndex"] = "0x05f" // leading zero
		b := &fakeLogsBackend{out: envelope(t, l)}
		sw := driveSweep(t, b, 100, legs(tokA, int64(30_000_000)), nil, nil)
		require.NotEmpty(t, sw.Refusal)
		require.Contains(t, sw.Refusal, "leading zeros")
	})
	t.Run("dirty topic padding refuses", func(t *testing.T) {
		l := transferLog(tokA, contSafe, contOther, big.NewInt(1), contPin, contCase, 95)
		topics := l["topics"].([]string)
		topics[1] = "0x01" + topics[1][4:] // dirt above the address payload
		b := &fakeLogsBackend{out: envelope(t, l)}
		sw := driveSweep(t, b, 100, legs(tokA, int64(30_000_000)), nil, nil)
		require.NotEmpty(t, sw.Refusal)
		require.Contains(t, sw.Refusal, "dirty padding")
	})
}

// TestContinuityPostBoundaryMovementsNeedNoAttribution: attribution is a
// PRE-boundary law. A post-boundary transfer (logIndex > L) participates in
// the closure identity but attributes to nothing — the boundary claim ends at
// L, and refusing honest post-boundary activity would manufacture refusals on
// busy blocks.
func TestContinuityPostBoundaryMovementsNeedNoAttribution(t *testing.T) {
	txY := common.HexToHash("0xdddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd06")
	b := &fakeLogsBackend{
		out: envelope(t,
			transferLog(tokA, contSafe, contOther, big.NewInt(10_000_000), contPin, contCase, 95),
			transferLog(tokA, contSafe, contOther, big.NewInt(7_000_000), contPin, txY, 120)),
	}
	sw := driveSweep(t, b, 100, legs(tokA, int64(30_000_000)), legs(tokA, int64(13_000_000)),
		[]snapshotdb.T6Seizure{seiz(tokA, 10_000_000)})
	require.Empty(t, sw.Refusal)
	o := proveBasketContinuity(sw, []snapshotdb.T6Seizure{seiz(tokA, 10_000_000)}, nil)
	require.True(t, o.Proven, "post-boundary movement is closure-consumed, never attribution-refused")
	require.Empty(t, o.Refusals)
}

// TestContinuityNoSweepRefuses pins the refusal posture the production
// composition rests on: nil sweep / refused sweep → not proven, reason
// carried.
func TestContinuityNoSweepRefuses(t *testing.T) {
	o := proveBasketContinuity(nil, nil, nil)
	require.False(t, o.Proven)
	require.NotEmpty(t, o.Refusals)

	o = proveBasketContinuity(refusedSweep("no eth_getLogs surface"), nil, nil)
	require.False(t, o.Proven)
	require.Contains(t, o.Refusals[0], "no eth_getLogs surface")
}
