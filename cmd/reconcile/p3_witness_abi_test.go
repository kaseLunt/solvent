package main

// FIXTURE-BACKED regressions for the same-block witness ABI (Codex round 3).
//
// The finding these close: the five witness topic0s were hard-coded hashes computed
// from signatures written out by hand, and `InterestIndexUpdated` was transcribed
// with two arguments instead of the deployed three. Its hash matched nothing, so
// every genuine interest-index witness fell through as `unrelated`.
//
// The lesson is about the PROOF, not just the constant: a hash pinned against
// another hand-written signature re-derives the same mistake. So every assertion
// below is anchored to something I did not write —
//
//   - internal/decode/testdata/*.json, the real decoder fixtures (captured logs),
//   - internal/decode/abis/DebtManagerCore.json, the committed forge artifact,
//
// and the ABI object in backtest.go is checked against BOTH.

import (
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/ethereum/go-ethereum/accounts/abi"
	"github.com/ethereum/go-ethereum/common"
	"github.com/stretchr/testify/require"

	"github.com/kaselunt/solvent/cmd/reconcile/snapshotdb"
)

// decodeTestdata is the real decoder fixture directory, repo-root relative.
func decodeTestdata(t *testing.T, name string) []byte {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join("..", "..", "internal", "decode", "testdata", name))
	require.NoError(t, err, "the real decoder fixture must be readable — it is the anchor for these assertions")
	return raw
}

// fixtureTopic0 extracts the topic0 of the first log in a decoder fixture. The
// fixtures are captured chain logs, so this is a topic0 the CHAIN produced.
func fixtureTopic0(t *testing.T, name string) string {
	t.Helper()
	var probe any
	require.NoError(t, json.Unmarshal(decodeTestdata(t, name), &probe))
	found := firstTopic0(probe)
	require.NotEmpty(t, found, "fixture %s carries no topics[0]", name)
	return strings.ToLower(strings.TrimPrefix(found, "0x"))
}

// firstTopic0 walks an arbitrary fixture shape for the first topics[0] it finds.
func firstTopic0(v any) string {
	switch t := v.(type) {
	case map[string]any:
		if raw, ok := t["topics"]; ok {
			if list, ok := raw.([]any); ok && len(list) > 0 {
				if s, ok := list[0].(string); ok {
					return s
				}
			}
		}
		for _, key := range sortedAnyKeys(t) {
			if got := firstTopic0(t[key]); got != "" {
				return got
			}
		}
	case []any:
		for _, el := range t {
			if got := firstTopic0(el); got != "" {
				return got
			}
		}
	}
	return ""
}

// committedDMEventID parses the COMMITTED forge artifact and returns one event's
// topic0. Nothing here comes from a signature written in this repository's Go code.
func committedDMEventID(t *testing.T, event string) string {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join("..", "..", "internal", "decode", "abis", "DebtManagerCore.json"))
	require.NoError(t, err)
	var wrapper struct {
		ABI json.RawMessage `json:"abi"`
	}
	require.NoError(t, json.Unmarshal(raw, &wrapper))
	parsed, err := abi.JSON(strings.NewReader(string(wrapper.ABI)))
	require.NoError(t, err)
	ev, ok := parsed.Events[event]
	require.True(t, ok, "the committed DebtManagerCore ABI must declare %s", event)
	return hex.EncodeToString(ev.ID.Bytes())
}

// TestWitnessTopic0sMatchTheFixturesAndTheCommittedABI is the round-3 H kill, and
// the audit Codex asked for over ALL FIVE witness events.
//
// RESULT OF THE AUDIT, stated either way: exactly ONE of the five was wrong.
// InterestIndexUpdated was transcribed from a two-argument signature and hashed to
// 84057b54…e82f, which matches no real log; the deployed event is three-argument and
// the chain emits c6ecd996…f802. Liquidated, CollateralTokenConfigSet, Borrowed and
// Repaid were all already correct against both anchors — verified here rather than
// assumed, because one wrong signature is reason to re-check every one.
func TestWitnessTopic0sMatchTheFixturesAndTheCommittedABI(t *testing.T) {
	cases := []struct {
		event   string
		fixture string
		got     string
	}{
		{"Liquidated", "dm_liquidated.json", topicDMLiquidated},
		{"InterestIndexUpdated", "dm_interest_index_updated.json", topicDMInterestIndexUpdated},
		{"CollateralTokenConfigSet", "dm_collateral_token_config_set.json", topicDMCollateralConfigSet},
		{"Borrowed", "dm_borrowed.json", topicDMBorrowed},
		{"Repaid", "dm_repaid.json", topicDMRepaid},
	}
	for _, tc := range cases {
		t.Run(tc.event, func(t *testing.T) {
			fromFixture := fixtureTopic0(t, tc.fixture)
			fromCommittedABI := committedDMEventID(t, tc.event)
			require.Equal(t, fromFixture, fromCommittedABI,
				"%s: the committed ABI and the captured log must agree — if they do not, the ABI is stale and neither is a safe anchor", tc.event)
			require.Equal(t, fromFixture, tc.got,
				"%s: the replay's topic0 must equal the one the CHAIN emitted in internal/decode/testdata/%s. A hash derived from a hand-written signature is exactly how the InterestIndexUpdated defect shipped", tc.event, tc.fixture)
		})
	}

	// The specific defect, pinned by value so a regression is unmistakable.
	require.Equal(t, "c6ecd996cf998cfeedb2b1379b047e8579d888439dacbc60641c6dfd07f1f802",
		topicDMInterestIndexUpdated,
		"the DEPLOYED three-argument InterestIndexUpdated topic0")
	require.NotEqual(t, "84057b54cc0f0532aa9d0ce233280f15c2e7f7cc24d05461b7a360e23baae82f",
		topicDMInterestIndexUpdated,
		"the two-argument signature's hash matched no real log and made every interest-index witness invisible")
}

// TestWitnessABIArgumentShapesMatchTheCommittedABI catches the class rather than the
// instance: a topic0 is only right if the whole argument list is, so the ABI object's
// inputs are compared field by field against the committed artifact.
func TestWitnessABIArgumentShapesMatchTheCommittedABI(t *testing.T) {
	raw, err := os.ReadFile(filepath.Join("..", "..", "internal", "decode", "abis", "DebtManagerCore.json"))
	require.NoError(t, err)
	var wrapper struct {
		ABI json.RawMessage `json:"abi"`
	}
	require.NoError(t, json.Unmarshal(raw, &wrapper))
	committed, err := abi.JSON(strings.NewReader(string(wrapper.ABI)))
	require.NoError(t, err)

	for _, name := range []string{"Liquidated", "InterestIndexUpdated", "CollateralTokenConfigSet", "Borrowed", "Repaid"} {
		mine, ok := dmWitnessABI.Events[name]
		require.True(t, ok, "dmWitnessABI must declare %s", name)
		theirs, ok := committed.Events[name]
		require.True(t, ok)
		require.Equal(t, theirs.Sig, mine.Sig,
			"%s: the canonical signature must match the committed ABI — this is the assertion that would have caught the two-argument InterestIndexUpdated at the moment it was written", name)
		require.Len(t, mine.Inputs, len(theirs.Inputs), "%s: argument count", name)
		for i := range theirs.Inputs {
			require.Equal(t, theirs.Inputs[i].Name, mine.Inputs[i].Name, "%s arg %d name", name, i)
			require.Equal(t, theirs.Inputs[i].Type.String(), mine.Inputs[i].Type.String(), "%s arg %d type", name, i)
			require.Equal(t, theirs.Inputs[i].Indexed, mine.Inputs[i].Indexed, "%s arg %d indexed", name, i)
		}
	}
}

// TestInterestIndexWitnessIsVisibleUsingTheRealFixture drives the replay with the
// ACTUAL captured log. Before the fix this returned Proven=false, so a case whose
// only custodied cause was an index move failed as UNEXPLAINED on an honest run.
func TestInterestIndexWitnessIsVisibleUsingTheRealFixture(t *testing.T) {
	// From internal/decode/testdata/dm_interest_index_updated.json: the DM proxy, the
	// real topic0, and USDC(OP) in topics[1].
	dm := common.HexToAddress("0x0078c5a459132e279056b2371fe8a8ec973a9553")
	usdc := common.HexToAddress("0x0b2c639c533813f4aa9d7837caf62653d097ff85")
	fixtureT0 := fixtureTopic0(t, "dm_interest_index_updated.json")
	require.Equal(t, fixtureT0, topicDMInterestIndexUpdated)

	acct := common.HexToAddress("0x4d81ce1dd1b1e10f96313e080bf7b12136ff7e76")
	w := snapshotdb.T6Witness{
		LogIndex: 7, Address: hexLower(dm.Hex()), Topic0: fixtureT0,
		Topic1Addr: hexLower(usdc.Hex()),
	}
	got := replaySameBlockCauses([]snapshotdb.T6Witness{w}, dm, acct, usdc, map[common.Address]bool{tokA: true})
	require.True(t, got.Proven,
		"a REAL interest-index log for the debt token must be a proven cause; with the two-argument topic0 it fell through as unrelated and the case failed UNEXPLAINED")
	require.Equal(t, 0, got.Unrelated)
	require.Contains(t, got.Causes[0], "InterestIndexUpdated")

	// A different token's index still proves nothing.
	other := snapshotdb.T6Witness{
		LogIndex: 7, Address: hexLower(dm.Hex()), Topic0: fixtureT0,
		Topic1Addr: hexLower(common.HexToAddress("0x94b008aa00579c1307b0ef2c499ad98a8ce58e58").Hex()),
	}
	require.False(t, replaySameBlockCauses([]snapshotdb.T6Witness{other}, dm, acct, usdc, nil).Proven)
}

// TestRepaidPayerIsNotMistakenForTheDebtor is the round-3 M kill, using the real
// third-party repayment in the fixture.
//
// dm_repaid.json's second entry is a genuine third-party repayment: topics[1] (the
// indebted user) is 0x57e6d3f7…ab09 and topics[2] (the payer) is 0x39161a44…a539.
// Sampling the PAYER must yield `unrelated` — its own position did not move.
func TestRepaidPayerIsNotMistakenForTheDebtor(t *testing.T) {
	dm := common.HexToAddress("0x0078c5a459132e279056b2371fe8a8ec973a9553")
	usdc := common.HexToAddress("0x0b2c639c533813f4aa9d7837caf62653d097ff85")
	debtor := common.HexToAddress("0x57e6d3f754c45c94418cdb11ea8433854c87ab09")
	payer := common.HexToAddress("0x39161a44588ec2327a18d4707ea5216c721ba539")
	t0 := fixtureTopic0(t, "dm_repaid.json")
	require.Equal(t, t0, topicDMRepaid, "the Repaid topic0 comes from the captured log")

	w := snapshotdb.T6Witness{
		LogIndex: 3, Address: hexLower(dm.Hex()), Topic0: t0,
		Topic1Addr: hexLower(debtor.Hex()),
		Topic2Addr: hexLower(payer.Hex()),
		Topic3Addr: hexLower(usdc.Hex()),
	}

	// THE KILL: sampling the PAYER must not prove a cause.
	asPayer := replaySameBlockCauses([]snapshotdb.T6Witness{w}, dm, payer, usdc, nil)
	require.False(t, asPayer.Proven,
		"paying a third party's debt does not move the payer's own position (_repayWithBorrowToken decrements userNormalizedBorrowings[user], never the payer's), so accepting topic2 turned an UNEXPLAINED case into a passing marginal verdict")
	require.Equal(t, 1, asPayer.Unrelated)

	// And the DEBTOR is still a proven cause.
	asDebtor := replaySameBlockCauses([]snapshotdb.T6Witness{w}, dm, debtor, usdc, nil)
	require.True(t, asDebtor.Proven)
	require.Contains(t, asDebtor.Causes[0], "Repaid FOR THIS account")

	// The self-repay entry (topic1 == topic2) is a proven cause either way, which is
	// why the fixture's THIRD-PARTY entry is the discriminating one.
	self := w
	self.Topic2Addr = hexLower(debtor.Hex())
	require.True(t, replaySameBlockCauses([]snapshotdb.T6Witness{self}, dm, debtor, usdc, nil).Proven)
}

// TestBorrowedTokenSlotIsNotMistakenForTheAccount is the same defect's other half:
// Borrowed's topics are [t0, user, token], so the old combined branch also accepted
// the account in the TOKEN slot.
func TestBorrowedTokenSlotIsNotMistakenForTheAccount(t *testing.T) {
	dm := common.HexToAddress("0x0078c5a459132e279056b2371fe8a8ec973a9553")
	usdc := common.HexToAddress("0x0b2c639c533813f4aa9d7837caf62653d097ff85")
	borrower := common.HexToAddress("0x983e36549d27ccfe30d37e615d35222f52fc104d")
	t0 := fixtureTopic0(t, "dm_borrowed.json")
	require.Equal(t, t0, topicDMBorrowed)

	w := snapshotdb.T6Witness{
		LogIndex: 2, Address: hexLower(dm.Hex()), Topic0: t0,
		Topic1Addr: hexLower(borrower.Hex()),
		Topic2Addr: hexLower(usdc.Hex()),
	}
	require.True(t, replaySameBlockCauses([]snapshotdb.T6Witness{w}, dm, borrower, usdc, nil).Proven,
		"the borrower in topic1 is a proven cause: its total borrowings rose inside the block")

	// Sampling the TOKEN address as if it were an account proves nothing.
	asToken := replaySameBlockCauses([]snapshotdb.T6Witness{w}, dm, usdc, usdc, nil)
	require.False(t, asToken.Proven, "topic2 is the TOKEN, not a party to the position")
	require.Equal(t, 1, asToken.Unrelated)

	// A borrow of a DIFFERENT token by this account IS still a cause: liquidatable
	// compares borrowingOf(user)'s TOTAL across every borrow token, so any borrow
	// raises the total and can flip eligibility.
	otherToken := w
	otherToken.Topic2Addr = hexLower(common.HexToAddress("0x94b008aa00579c1307b0ef2c499ad98a8ce58e58").Hex())
	require.True(t, replaySameBlockCauses([]snapshotdb.T6Witness{otherToken}, dm, borrower, usdc, nil).Proven)
}
