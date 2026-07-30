// LAW 0 — the witness loop's refuse-on-sight surface law (chain-truth R12
// ruling, Fork 2, "zero new reads": ADDENDUM 2 of
// .superpowers/sdd/p3-consults/chain-truth-basket-continuity-ruling.md).
//
// THE LAW: the same-block causation replay refuses on sight — pre-boundary,
// note → Complete()==false → UNEXPLAINED — any DM-PROXY log whose topic0 is
//
//	(i)  an ERC1967 upgrade event (Upgraded / AdminChanged / BeaconUpgraded):
//	     a core upgrade landing before the case's boundary changes the very
//	     semantics the replay decodes under, and setAdminImpl is silent but
//	     upgradeToAndCall is NOT — so this closes the writer-set-mutation
//	     path (core upgrade) entirely inside existing custody; or
//	(ii) NOT in the committed IDebtManager event surface at all: a foreign
//	     topic0 from the custody address is the signature of foreign
//	     semantics — code emitting events the audited ABI does not declare is
//	     code the replay's decode authority does not cover.
//
// Topic0s IN the committed surface but outside the 5-event replay model keep
// their existing adjudicated treatment (unrelated-contact counting, or the
// lifecycle refusal arm) — Law 0 does not relitigate them.
//
// BOTH sets are ABI-DERIVED, never hand lists (the Task-6 round-3 lesson: a
// hand-written signature hashed to nothing and silently unmatched):
//
//   - dmSurfaceABI below is a MECHANICAL transcription of the COMMITTED forge
//     artifact internal/decode/abis/DebtManagerCore.json's full 21-event
//     surface (the same artifact the decode layer embeds and dmWitnessABI's
//     5+2 replay events are pinned against).
//     TestDMSurfaceMembershipDerivesFromTheCommittedArtifact re-derives the
//     event-ID set from the artifact JSON on every suite run and requires
//     EXACT two-sided equality — the membership set can never drift from the
//     artifact, and the artifact, not this file, is the authority.
//   - erc1967EventsABI carries the three canonical ERC-1967 upgrade events;
//     TestERC1967TopicsDeriveFromCanonicalSignatures re-derives each topic0
//     by an independent keccak of the canonical signature string, and pins
//     Upgraded's ID to the committed artifact's own Upgraded event (the DM
//     core is UUPS, so the artifact declares it too).
package main

import "encoding/hex"

// dmSurfaceABI is the COMMITTED IDebtManager event surface — all 21 events of
// internal/decode/abis/DebtManagerCore.json, transcribed mechanically (names,
// input types and tuple components verbatim; only the ID-irrelevant metadata
// dropped). See the file header: the artifact is the authority, the test is
// the weld.
var dmSurfaceABI = mustParseABI(`[
	{"type":"event","name":"BorrowApySet","inputs":[{"name":"token","type":"address","indexed":true},{"name":"oldApy","type":"uint256"},{"name":"newApy","type":"uint256"}]},
	{"type":"event","name":"BorrowTokenAdded","inputs":[{"name":"token","type":"address"}]},
	{"type":"event","name":"BorrowTokenConfigSet","inputs":[{"name":"token","type":"address","indexed":true},{"name":"config","type":"tuple","components":[{"name":"interestIndexSnapshot","type":"uint256"},{"name":"totalNormalizedBorrowingAmount","type":"uint256"},{"name":"totalSharesOfBorrowTokens","type":"uint256"},{"name":"lastUpdateTimestamp","type":"uint64"},{"name":"borrowApy","type":"uint64"},{"name":"minShares","type":"uint128"}]}]},
	{"type":"event","name":"BorrowTokenRemoved","inputs":[{"name":"token","type":"address"}]},
	{"type":"event","name":"Borrowed","inputs":[{"name":"user","type":"address","indexed":true},{"name":"token","type":"address","indexed":true},{"name":"amount","type":"uint256"}]},
	{"type":"event","name":"CollateralTokenAdded","inputs":[{"name":"token","type":"address"}]},
	{"type":"event","name":"CollateralTokenConfigSet","inputs":[{"name":"collateralToken","type":"address","indexed":true},{"name":"oldConfig","type":"tuple","components":[{"name":"ltv","type":"uint80"},{"name":"liquidationThreshold","type":"uint80"},{"name":"liquidationBonus","type":"uint96"}]},{"name":"newConfig","type":"tuple","components":[{"name":"ltv","type":"uint80"},{"name":"liquidationThreshold","type":"uint80"},{"name":"liquidationBonus","type":"uint96"}]}]},
	{"type":"event","name":"CollateralTokenRemoved","inputs":[{"name":"token","type":"address"}]},
	{"type":"event","name":"Initialized","inputs":[{"name":"version","type":"uint64"}]},
	{"type":"event","name":"InterestIndexUpdated","inputs":[{"name":"borrowToken","type":"address","indexed":true},{"name":"oldIndex","type":"uint256"},{"name":"newIndex","type":"uint256"}]},
	{"type":"event","name":"Liquidated","inputs":[{"name":"liquidator","type":"address","indexed":true},{"name":"user","type":"address","indexed":true},{"name":"debtTokenToLiquidate","type":"address","indexed":true},{"name":"userCollateralLiquidated","type":"tuple[]","components":[{"name":"token","type":"address"},{"name":"amount","type":"uint256"},{"name":"liquidationBonus","type":"uint256"}]},{"name":"beforeDebtAmount","type":"uint256"},{"name":"debtAmountLiquidated","type":"uint256"}]},
	{"type":"event","name":"LiquidationThresholdUpdated","inputs":[{"name":"oldThreshold","type":"uint256"},{"name":"newThreshold","type":"uint256"}]},
	{"type":"event","name":"MinSharesOfBorrowTokenSet","inputs":[{"name":"token","type":"address","indexed":true},{"name":"oldMinShares","type":"uint128"},{"name":"newMinShares","type":"uint128"}]},
	{"type":"event","name":"Paused","inputs":[{"name":"account","type":"address"}]},
	{"type":"event","name":"Repaid","inputs":[{"name":"user","type":"address","indexed":true},{"name":"payer","type":"address","indexed":true},{"name":"token","type":"address","indexed":true},{"name":"amount","type":"uint256"}]},
	{"type":"event","name":"Supplied","inputs":[{"name":"sender","type":"address","indexed":true},{"name":"user","type":"address","indexed":true},{"name":"token","type":"address","indexed":true},{"name":"amount","type":"uint256"}]},
	{"type":"event","name":"TotalBorrowingUpdated","inputs":[{"name":"borrowToken","type":"address","indexed":true},{"name":"totalBorrowingAmtBeforeInterest","type":"uint256"},{"name":"totalBorrowingAmtAfterInterest","type":"uint256"}]},
	{"type":"event","name":"Unpaused","inputs":[{"name":"account","type":"address"}]},
	{"type":"event","name":"Upgraded","inputs":[{"name":"implementation","type":"address","indexed":true}]},
	{"type":"event","name":"UserInterestAdded","inputs":[{"name":"user","type":"address","indexed":true},{"name":"borrowingAmtBeforeInterest","type":"uint256"},{"name":"borrowingAmtAfterInterest","type":"uint256"}]},
	{"type":"event","name":"WithdrawBorrowToken","inputs":[{"name":"withdrawer","type":"address","indexed":true},{"name":"borrowToken","type":"address","indexed":true},{"name":"amount","type":"uint256"}]}
]`)

// dmSurfaceTopic0s is the Law-0 membership set: lowercase hex topic0 (no 0x)
// of every event in the committed surface, derived once at init from the ABI
// object above — the same key format the witness rows carry.
var dmSurfaceTopic0s = func() map[string]bool {
	out := make(map[string]bool, len(dmSurfaceABI.Events))
	for _, ev := range dmSurfaceABI.Events {
		out[hex.EncodeToString(ev.ID.Bytes())] = true
	}
	return out
}()

// erc1967EventsABI carries the three canonical ERC-1967 upgrade events
// (EIP-1967 "Upgraded", "AdminChanged", "BeaconUpgraded" — the exact
// signatures the standard specifies). Upgraded is ALSO in the committed DM
// surface (the core is UUPS); Law 0's upgrade arm takes precedence over
// surface membership, because an in-surface Upgraded is still a decode-
// authority epoch inside the case block.
var erc1967EventsABI = mustParseABI(`[
	{"type":"event","name":"Upgraded","inputs":[{"name":"implementation","type":"address","indexed":true}]},
	{"type":"event","name":"AdminChanged","inputs":[{"name":"previousAdmin","type":"address"},{"name":"newAdmin","type":"address"}]},
	{"type":"event","name":"BeaconUpgraded","inputs":[{"name":"beacon","type":"address","indexed":true}]}
]`)

// The three upgrade topic0s, derived once at init — never hand-written.
var (
	topicERC1967Upgraded       = hex.EncodeToString(erc1967EventsABI.Events["Upgraded"].ID.Bytes())
	topicERC1967AdminChanged   = hex.EncodeToString(erc1967EventsABI.Events["AdminChanged"].ID.Bytes())
	topicERC1967BeaconUpgraded = hex.EncodeToString(erc1967EventsABI.Events["BeaconUpgraded"].ID.Bytes())
)

// erc1967UpgradeEventName answers Law 0's arm (i): the canonical name when
// the topic0 is one of the three ERC-1967 upgrade events, else "".
func erc1967UpgradeEventName(topic0 string) string {
	switch topic0 {
	case topicERC1967Upgraded:
		return "Upgraded"
	case topicERC1967AdminChanged:
		return "AdminChanged"
	case topicERC1967BeaconUpgraded:
		return "BeaconUpgraded"
	}
	return ""
}
