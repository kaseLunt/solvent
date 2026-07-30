// The ADMIN-IMPLEMENTATION EPOCH CHECK — Codex round 11 H1, adjudicated under
// D-013 (proportionate remedy; integrator's adjudication, recorded in
// .superpowers/sdd/progress-phase3.md, round-11 dispatch).
//
// THE FINDING: DebtManagerCore.setAdminImpl (DebtManagerCore.sol:715-721)
// writes ADMIN_IMPL_POSITION with a bare sstore and NO event — no Upgraded,
// nothing in the DM log stream — and the proxy's fallback
// (DebtManagerCore.sol:746-763) delegatecalls whatever that slot holds. The
// two-Upgraded census therefore proves only the UUPS CORE era; an honest
// governance admin swap before a case's boundary could change admin-emitted
// event semantics with zero refusal, and the replay would apply (or ignore)
// the write under the wrong generation's ABI.
//
// THE REMEDY IMPLEMENTED — the TWO-PIN SLOT READ, not trace scanning: the
// reviewer's debug_traceTransaction remedy needs tracing plumbing the
// standard endpoints do not serve and the demo-grade bar does not warrant
// (D-013). Instead, EVERY case reads ADMIN_IMPL_POSITION at BOTH of its pins
// — @parentHash(N-1) and @pinHash(N) — and refuses at frame level unless
// both reads equal the AUDITED admin implementation constant below. A
// persistent pre-boundary swap is visible at BOTH pins; a swap landing
// inside block N is visible at the N pin. Either way the case refuses with
// the epoch named, never a verdict.
//
// HOW THE SLOT IS READ, and why through the core's own accessor:
// reconcile's chain surface (internal/chain.Failover → chainReader) exposes
// headerHash / headerTime / callAtHash and NO eth_getStorageAt — the exact
// limitation the tokenConfig sweep already disclosed (implWitnessDeviation,
// tokenconfig_sweep.go) — and internal/chain is outside this wave's tree. So
// the production read is the CORE-DECLARED accessor getDebtManagerAdmin()
// (DebtManagerCore.sol:699-707: `addr := sload(ADMIN_IMPL_POSITION)` and
// nothing else), issued as a frame subcall through the same Multicall3
// machinery as every other pinned read, in BOTH frames, under the wave-8
// per-subcall decode law (failed/empty/undecodable ⇒ frame unread). Two
// facts make the accessor a faithful slot read rather than a trust-me:
//
//  1. Solidity dispatches DECLARED selectors before the fallback, so the
//     admin implementation this check polices can never shadow or intercept
//     the accessor — only the CORE could lie, and core identity is pinned
//     separately (recon/report.md:13, the EIP-1967 impl read; the Upgraded
//     census over the walked stream).
//  2. The capture harness cross-checks the accessor against a RAW
//     eth_getStorageAt(proxy, ADMIN_IMPL_POSITION) — EIP-1898 blockHash
//     form — at BOTH pins of every frozen case, and the committed capture
//     words pin accessor == raw slot byte-for-byte in the hermetic suite
//     (TestCapturedAdminImplIsTheAuditedConstantAtBothPins). The identity is
//     chain-proven across the whole frame, not assumed.
//
// THE ACCEPTED-AND-DISCLOSED RESIDUAL (D-013): a WITHIN-BLOCK swap-and-revert
// — setAdminImpl(X) → admin write → setAdminImpl(audited) all strictly
// between the two read points — is invisible to a two-pin read by
// construction. Honest governance has no swap-back motive; the scenario
// requires deliberately evasion-shaped choreography (the swap must also be
// unwound inside the same block to evade the N-pin read). Accepted, recorded
// here, in the passing case's evidence (adminImplEpochEvidence), and carried
// to Codex round 12 as the adjudicated disclosure — never silently.
package main

import (
	"fmt"

	"github.com/ethereum/go-ethereum/common"
)

// dmAdminImplSlot is ADMIN_IMPL_POSITION — the Debt Manager's admin
// implementation storage slot, transcribed from the COMMITTED source:
// recon/cash-v3/src/debt-manager/DebtManagerStorageContract.sol:99
// (`bytes32 constant ADMIN_IMPL_POSITION = 0x49d4…5d21;`), whose own
// declaration comment (:98) derives it as keccak256("DebtManager.admin.impl").
// NEVER hand-trusted: TestAdminImplSlotDerivesFromTheCommittedSource extracts
// BOTH the literal and the keccak preimage from the source text and pins this
// constant against the literal AND against crypto.Keccak256 of the preimage —
// the derivation holds exactly (verified 2026-07-30).
var dmAdminImplSlot = common.HexToHash("0x49d4a010ddc5f453173525f0adf6cfb97318b551312f237c11fd9f432a1f5d21")

// auditedDMAdminImpl is the AUDITED DebtManagerAdmin implementation address —
// the admin-epoch analogue of the core pin at recon/report.md:13, established
// with the same provenance discipline as riskfeed.AuditedAavePoolAddress
// (constant in code, source of truth cited, live-verified):
//
//   - READ LIVE 2026-07-30 from BOTH SOLVENT_RECON_RPC_OP endpoints, via BOTH
//     read families (raw eth_getStorageAt(proxy, ADMIN_IMPL_POSITION) and the
//     core accessor getDebtManagerAdmin()), at THREE pins: the current head
//     ("latest"), the deepest frozen-frame pin (block 150,057,202, stored
//     hash 0x9e536de1…) and the last frozen-frame pin (block 153,399,414,
//     stored hash 0xd0df4d30…). All twelve reads answered this one address —
//     head and frame era MATCH, so no admin epoch boundary exists on this
//     frame (the STOP condition the wave brief named did not fire).
//   - The contract behind it is the committed audited source
//     recon/cash-v3/src/debt-manager/DebtManagerAdmin.sol (the cash-v3 clone
//     recon/report.md's address table is built from); the deployment scripts
//     pin its CREATE3 salt as keccak256("DebtManagerAdminImpl")
//     (recon/cash-v3/scripts/SetupOptimismProd.s.sol:57).
//   - Re-verified across the WHOLE frame by the capture harness: all 31
//     cases × both pins × both read families carry exactly this address
//     (testdata/continuity, ParentAdminImpl*/ExecAdminImpl* fields), asserted
//     hermetically on every suite run.
//
// A future honest admin upgrade changes the chain and NOT this constant, so
// every case will refuse loudly (admin-impl-epoch) until the new epoch is
// audited and this pin is consciously re-established — exactly the
// refusal-over-absorption posture the core pins already have.
var auditedDMAdminImpl = common.HexToAddress("0x8E87938C7FdF1d4728D87639e15E425A98a2d94F")

// adminImplEpochEvidence is the passing case's disclosure (D-013 5b): short by
// direction, carried on the obligation-2 row so a reviewer of any marginal or
// exact verdict sees the epoch premise AND its accepted residual.
const adminImplEpochEvidence = "admin impl pinned at both ends (getDebtManagerAdmin@N-1 == @N == audited 0x8E87938C7FdF1d4728D87639e15E425A98a2d94F); within-block swap-and-revert excluded per D-013 (disclosed residual, evasion-shaped choreography only)"

// adminImplEpochRefusal is THE admin-epoch check (round-11 H1, step 4 of the
// dispatch): both pins' slot reads must equal the audited constant, else the
// case refuses at frame level with every address printed. Pure function so the
// regression can drive it directly and the mutation floor (mH: this check
// deleted) has a single behavioural cut point; runBacktestCase wiring is
// pinned by TestAdminImplEpochCheckIsWiredIntoRunBacktestCase.
func adminImplEpochRefusal(parentImpl, execImpl common.Address) string {
	if parentImpl == auditedDMAdminImpl && execImpl == auditedDMAdminImpl {
		return ""
	}
	return fmt.Sprintf(
		"ADMIN-IMPLEMENTATION EPOCH: ADMIN_IMPL_POSITION (read via the core's own getDebtManagerAdmin accessor, DebtManagerCore.sol:699-707) does not hold the AUDITED admin implementation at both case pins — parent(N-1) %s, exec(N) %s, audited %s. setAdminImpl writes this slot with NO event (DebtManagerCore.sol:715-721), so the two-Upgraded census cannot exclude an admin swap; a swap changes which generation's ABI the proxy's fallback events come from, and a replay under the wrong generation proves nothing. The case REFUSES — this is a real epoch boundary requiring chain-truth adjudication and a re-audited pin, never a verdict (Codex round 11 H1, D-013)",
		parentImpl.Hex(), execImpl.Hex(), auditedDMAdminImpl.Hex())
}
