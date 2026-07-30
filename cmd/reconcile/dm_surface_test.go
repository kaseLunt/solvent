package main

// LAW 0 regressions (chain-truth R12 ruling, Fork 2 — dm_surface.go and the
// witness loop's refuse-on-sight arms in backtest.go).
//
// ---------------------------------------------------------------------------
// MUTATION SPEC — committed BEFORE the implementation loop.
//
//   mB  the Law-0 arm reverted to default: the ERC1967-upgrade check (and/or
//       the foreign-topic0 membership check) removed from the witness loop,
//       so a pre-boundary Upgraded from the proxy falls through to
//       `out.Unrelated++` — Complete() stays true and a case whose block
//       carries an in-block core upgrade classifies MARGINAL, certifying a
//       crossing under decode semantics the upgrade may have changed
//       mid-block: the finding's exact false pass.
//       KILLED BY: TestLaw0UpgradeEventRefusesOnSight (the composed
//       classifier assertion goes marginal under the mutant) and
//       TestLaw0ForeignTopicRefusesOnSight (same shape for arm ii).
//
// Behavioural mutants only; a mutant that fails to compile is re-cut.
// ---------------------------------------------------------------------------

import (
	"bytes"
	"encoding/hex"
	"encoding/json"
	"math/big"
	"os"
	"path/filepath"
	"strings"
	"testing"

	gethabi "github.com/ethereum/go-ethereum/accounts/abi"
	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/crypto"
	"github.com/stretchr/testify/require"

	"github.com/kaselunt/solvent/cmd/reconcile/snapshotdb"
)

// committedDMCoreABI parses the COMMITTED forge artifact the membership set
// claims to mirror — the authority side of every derivation weld below.
func committedDMCoreABI(t *testing.T) gethabi.ABI {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join("..", "..", "internal", "decode", "abis", "DebtManagerCore.json"))
	require.NoError(t, err, "the committed DebtManagerCore artifact must be present — it is the surface's source of truth")
	var w struct {
		ABI json.RawMessage `json:"abi"`
	}
	require.NoError(t, json.Unmarshal(raw, &w))
	parsed, err := gethabi.JSON(bytes.NewReader(w.ABI))
	require.NoError(t, err)
	return parsed
}

// TestDMSurfaceMembershipDerivesFromTheCommittedArtifact is the Law-0
// membership weld: the transcribed 21-event surface and the committed
// artifact must carry EXACTLY the same event-ID set, both directions. The
// artifact is the authority; a drift in either direction fails by name.
func TestDMSurfaceMembershipDerivesFromTheCommittedArtifact(t *testing.T) {
	artifact := committedDMCoreABI(t)
	artifactIDs := map[string]string{} // topic0 hex (no 0x) → event name
	for name, ev := range artifact.Events {
		artifactIDs[hex.EncodeToString(ev.ID.Bytes())] = name
	}
	require.Len(t, artifactIDs, 21, "the committed artifact carries the 21-event surface the lifecycle wave pinned")

	for id, name := range artifactIDs {
		require.True(t, dmSurfaceTopic0s[id],
			"artifact event %s (topic0 %s) is MISSING from dmSurfaceTopic0s — the transcription drifted from the committed artifact", name, id)
	}
	for id := range dmSurfaceTopic0s {
		_, ok := artifactIDs[id]
		require.True(t, ok,
			"dmSurfaceTopic0s carries topic0 %s that the committed artifact does NOT declare — a surface wider than the artifact re-admits foreign semantics by hand", id)
	}
	require.Len(t, dmSurfaceTopic0s, 21)

	// The 5+2 replay topics are all members (Law 0 never re-judges them).
	for _, id := range []string{topicDMLiquidated, topicDMInterestIndexUpdated, topicDMCollateralConfigSet,
		topicDMBorrowed, topicDMRepaid, topicDMCollateralAdded, topicDMCollateralRemoved} {
		require.True(t, dmSurfaceTopic0s[id], "replay-model topic0 %s must be inside the committed surface", id)
	}
}

// TestERC1967TopicsDeriveFromCanonicalSignatures re-derives the three upgrade
// topic0s by an INDEPENDENT keccak of the canonical EIP-1967 signature
// strings, and pins Upgraded against the committed artifact's own Upgraded
// event (the DM core is UUPS, so the artifact declares it too).
func TestERC1967TopicsDeriveFromCanonicalSignatures(t *testing.T) {
	keccak := func(sig string) string { return hex.EncodeToString(crypto.Keccak256([]byte(sig))) }
	require.Equal(t, keccak("Upgraded(address)"), topicERC1967Upgraded)
	require.Equal(t, keccak("AdminChanged(address,address)"), topicERC1967AdminChanged)
	require.Equal(t, keccak("BeaconUpgraded(address)"), topicERC1967BeaconUpgraded)

	artifact := committedDMCoreABI(t)
	require.Equal(t, hex.EncodeToString(artifact.Events["Upgraded"].ID.Bytes()), topicERC1967Upgraded,
		"the artifact's Upgraded and the canonical ERC1967 Upgraded are the same event — the upgrade arm takes precedence over surface membership for exactly this topic")

	require.Equal(t, "Upgraded", erc1967UpgradeEventName(topicERC1967Upgraded))
	require.Equal(t, "AdminChanged", erc1967UpgradeEventName(topicERC1967AdminChanged))
	require.Equal(t, "BeaconUpgraded", erc1967UpgradeEventName(topicERC1967BeaconUpgraded))
	require.Empty(t, erc1967UpgradeEventName(topicDMLiquidated), "a replay topic is not an upgrade event")
}

// law0CrossingState builds the mB false-pass scaffold: a REAL captured
// Borrowed witness that provably crosses the threshold (the
// TestDebtTokenBorrowThatCrossesTheThresholdIsProven fixture), so that with
// the extra witness under test IGNORED the composed classifier would answer
// MARGINAL — the exact verdict the mutant would falsely emit.
func law0CrossingState(t *testing.T) (snapshotdb.T6Witness, common.Address, replayParentState) {
	t.Helper()
	w := witnessFromFixture(t, "dm_borrowed.json", 0, 2)
	borrower := common.HexToAddress("0x" + w.Topic1Addr)
	st := oneLegState(tokA, big.NewInt(2_000_000), pctE18(100), big.NewInt(1_000_000), wad)
	st.Decimals[replayTestUSDC] = 6
	return w, borrower, st
}

// TestLaw0UpgradeEventRefusesOnSight is Law 0 arm (i) and mB's primary kill:
// a pre-boundary ERC1967 upgrade event from the PROXY refuses the whole
// replay on sight — note → Complete()==false → the composed classifier
// answers UNEXPLAINED even with a proven crossing, corroboration and proven
// continuity. Under the mutant (arm reverted to default) the event counts
// Unrelated, Complete() stays true, and the composition answers MARGINAL —
// the false pass this test exists to make loud.
func TestLaw0UpgradeEventRefusesOnSight(t *testing.T) {
	borrowW, borrower, st := law0CrossingState(t)

	for _, up := range []struct {
		name   string
		topic0 string
	}{
		{"Upgraded", topicERC1967Upgraded},
		{"AdminChanged", topicERC1967AdminChanged},
		{"BeaconUpgraded", topicERC1967BeaconUpgraded},
	} {
		t.Run(up.name, func(t *testing.T) {
			upgrade := snapshotdb.T6Witness{
				LogIndex: 5, Address: hexLower(replayTestDM.Hex()), Topic0: up.topic0,
				Topic1Addr: "00000000000000000000000000000000000dead2",
			}
			r := replaySameBlockCauses([]snapshotdb.T6Witness{borrowW, upgrade}, replayTestDM, borrower, replayTestUSDC, st)
			require.True(t, r.Proven, "the borrow crossing itself still replays — the refusal must come from Law 0, not from a broken scaffold")
			require.False(t, r.Complete(), "an ERC1967 %s from the proxy REFUSES ON SIGHT (Law 0): the replay is incomplete", up.name)
			require.Equal(t, 0, r.Unrelated, "the upgrade event must NEVER be counted as unrelated contact — that is mutation mB's exact shape")
			found := false
			for _, n := range r.Notes {
				if strings.Contains(n, "ERC1967 "+up.name) && strings.Contains(n, "Law 0") {
					found = true
				}
			}
			require.True(t, found, "the refusal note names the event and the law: %v", r.Notes)

			// The composed false-pass probe: everything else green, the Law-0
			// refusal alone must hold the verdict at UNEXPLAINED.
			require.Equal(t, eligUnexplainedOutcome,
				classifyIntraBlock(r.InitialEligible, r.ParentComplete, true, true, r.Proven, r.Complete(), true),
				"with the Law-0 arm reverted (mB) this composition answers MARGINAL — certifying a crossing under decode semantics an in-block upgrade may have changed")
		})
	}
}

// TestLaw0ForeignTopicRefusesOnSight is Law 0 arm (ii): a proxy log whose
// topic0 is NOT in the committed 21-event surface refuses on sight — the
// signature of foreign semantics at the custody address.
func TestLaw0ForeignTopicRefusesOnSight(t *testing.T) {
	borrowW, borrower, st := law0CrossingState(t)
	foreign := snapshotdb.T6Witness{
		LogIndex: 5, Address: hexLower(replayTestDM.Hex()),
		Topic0: hex.EncodeToString(crypto.Keccak256([]byte("TotallyForeign(uint256)"))),
	}
	require.False(t, dmSurfaceTopic0s[foreign.Topic0], "the probe topic must be outside the committed surface")

	r := replaySameBlockCauses([]snapshotdb.T6Witness{borrowW, foreign}, replayTestDM, borrower, replayTestUSDC, st)
	require.False(t, r.Complete(), "a FOREIGN topic0 from the custody address refuses on sight (Law 0 arm ii)")
	require.Equal(t, 0, r.Unrelated, "the foreign log must never be counted as unrelated contact")
	found := false
	for _, n := range r.Notes {
		if strings.Contains(n, "FOREIGN topic0 0x"+foreign.Topic0) {
			found = true
		}
	}
	require.True(t, found, "the refusal note names the foreign topic0: %v", r.Notes)
	require.Equal(t, eligUnexplainedOutcome,
		classifyIntraBlock(r.InitialEligible, r.ParentComplete, true, true, r.Proven, r.Complete(), true))
}

// TestLaw0InSurfaceNonReplayTopicsKeepUnrelatedTreatment pins the ruling's
// non-relitigation clause: a topic0 IN the committed surface but outside the
// 5-event replay model (here Supplied — borrow-token liquidity, no basket or
// debt effect for this account's boolean) keeps its existing adjudicated
// treatment: unrelated contact, never a refusal.
func TestLaw0InSurfaceNonReplayTopicsKeepUnrelatedTreatment(t *testing.T) {
	borrowW, borrower, st := law0CrossingState(t)
	supplied := snapshotdb.T6Witness{
		LogIndex: 5, Address: hexLower(replayTestDM.Hex()),
		Topic0: hex.EncodeToString(dmSurfaceABI.Events["Supplied"].ID.Bytes()),
	}
	require.True(t, dmSurfaceTopic0s[supplied.Topic0])

	r := replaySameBlockCauses([]snapshotdb.T6Witness{borrowW, supplied}, replayTestDM, borrower, replayTestUSDC, st)
	require.True(t, r.Complete(), "an in-surface non-replay event must NOT refuse — Law 0 does not relitigate the adjudicated treatment")
	require.Equal(t, 1, r.Unrelated, "Supplied stays unrelated contact")
	require.True(t, r.Proven)
	require.Equal(t, eligFlippedWithWitness,
		classifyIntraBlock(r.InitialEligible, r.ParentComplete, true, true, r.Proven, r.Complete(), true),
		"the marginal arm survives an in-surface unrelated log — over-refusal here would be a new law, not Law 0")
}
