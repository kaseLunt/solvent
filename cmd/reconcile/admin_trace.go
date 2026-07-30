// FORK 2, STEP A — the ADMIN-WRITE TRACE-FRAME LAW (chain-truth R12 ruling,
// ADDENDUM 2 of .superpowers/sdd/p3-consults/chain-truth-basket-continuity-ruling.md).
//
// THE FINDING THIS DISCHARGES: setAdminImpl (DebtManagerCore.sol:715-718) is
// onlyRoleRegistryOwner, a bare sstore, NO event — the one writer of
// ADMIN_IMPL_POSITION is invisible to log custody. The two-pin slot read
// (admin_epoch.go) sees every persistent swap, but a within-block
// swap-and-revert strictly between the two read points is invisible to it BY
// CONSTRUCTION. Codex round 12 H2b REFUTED the prior D-013 adjudication of
// that residual ("evasion-shaped choreography only"): an honest migration
// bundle — swap admin, run a migration write, restore — has exactly that
// shape, so the residual was NEVER adversary-only and the old text was
// the-RPC-said-so applied to our own prose.
//
// THE STEP-A PROBE FIRED SERVED (recon/p3-probes.md "R12 Step-A probe",
// 2026-07-30): debug_traceBlockByHash + callTracer at frame depth —
// SOLVENT_RECON_RPC_OP[0] refuses the method (403, not whitelisted);
// SOLVENT_RECON_RPC_OP[1] serves full call-frame trees at BOTH probe pins
// (150,057,202: 39 tx traces; 153,399,414: 69 tx traces), and the one-time
// capture proved the family serves ALL 30 distinct frame blocks. Production
// walks the same endpoint list with failover, so the read family is served
// and STEP A is the landed fork; Step B (the calldata-selector substring
// scan) was NOT taken and its pre-deployed-payload residual never arises.
//
// THE LAW (ruling verbatim, operationalized): refuse the case if any call
// frame, at ANY depth, in any tx with transactionIndex < the case's — PLUS
// the case's own tx at ANY frame position (intra-tx frame-vs-logIndex
// ordering is unresolvable from callTracer, so the case's own tx
// over-refuses) — targets the DM proxy with input prefixed by the
// ABI-DERIVED setAdminImpl(address) selector, or by the
// upgradeTo(address) / upgradeToAndCall(address,bytes) selectors. Frames are
// EXECUTION evidence (a traced CALL ran), so an occurrence here is not the
// Step-B "occurrence ≠ proof" shape — it is the write path itself, observed.
// Txs with index STRICTLY GREATER than the case's are not judged: a
// post-boundary write cannot rewrite the pre-boundary state the case's
// crossing is a function of.
//
// WITH TRACES, THE D-013 RESIDUAL IS RETIRED, NOT RECLASSIFIED (ruling): a
// within-block swap-and-revert MUST place a setAdminImpl call frame in some
// tx at or before the case's, and the scan sees every frame at every depth —
// there is no choreography, honest or adversarial, that writes the slot
// without a frame. The old "evasion-shaped choreography only" disclosure
// text is REMOVED (admin_epoch.go carries the retirement note), and the
// passing case's evidence carries admin_continuity: the trace law's own
// statement.
package main

import (
	"encoding/json"
	"fmt"
	"strings"

	"github.com/ethereum/go-ethereum/common"
)

// dmSetAdminImplABI carries setAdminImpl(address) — transcribed from the
// COMMITTED forge artifact internal/decode/abis/DebtManagerCore.json (the
// interface declaration is IDebtManager.sol:440; the artifact is the
// committed source of truth). The selector is DERIVED from this object,
// never hand-written; TestAdminWriteSelectorsDeriveFromTheCommittedArtifact
// re-derives it from the artifact JSON and by an independent keccak on every
// suite run.
var dmSetAdminImplABI = mustParseABI(`[
	{"type":"function","name":"setAdminImpl","inputs":[{"name":"_adminImpl","type":"address"}],"outputs":[],"stateMutability":"nonpayable"}
]`)

// uupsUpgradeABI carries the two ERC1967/UUPS upgrade entrypoints. The
// committed artifact declares upgradeToAndCall (OZ v5 UUPS — the deployed
// core's generation); upgradeTo(address) is the OZ v4 legacy selector,
// included because the ruling names both and a scan that misses the legacy
// selector would miss a legacy-proxy upgrade path. Both selectors are
// derived from this object and pinned by the same derivation test
// (upgradeToAndCall against the artifact, upgradeTo against the canonical
// signature's independent keccak).
var uupsUpgradeABI = mustParseABI(`[
	{"type":"function","name":"upgradeTo","inputs":[{"name":"newImplementation","type":"address"}],"outputs":[],"stateMutability":"nonpayable"},
	{"type":"function","name":"upgradeToAndCall","inputs":[{"name":"newImplementation","type":"address"},{"name":"data","type":"bytes"}],"outputs":[],"stateMutability":"payable"}
]`)

// adminWriteSelector is one scanned selector with its canonical name.
type adminWriteSelector struct {
	name string
	id   [4]byte
}

// adminWriteSelectors derives the three scanned selectors once at init.
func adminWriteSelectors() []adminWriteSelector {
	sel := func(a string, m string) adminWriteSelector {
		var abiObj = dmSetAdminImplABI
		if a == "uups" {
			abiObj = uupsUpgradeABI
		}
		method, ok := abiObj.Methods[m]
		if !ok {
			panic("reconcile: admin-write ABI has no method " + m)
		}
		var id [4]byte
		copy(id[:], method.ID)
		return adminWriteSelector{name: m, id: id}
	}
	return []adminWriteSelector{
		sel("dm", "setAdminImpl"),
		sel("uups", "upgradeTo"),
		sel("uups", "upgradeToAndCall"),
	}
}

var scannedAdminWriteSelectors = adminWriteSelectors()

// adminContinuityEvidence is the passing case's Step-A disclosure, carried on
// the obligation-2 row under the admin_continuity evidence key (the sibling
// of admin_impl_epoch): the two-pin slot read plus the trace-frame scan
// together close the silent-setAdminImpl channel, and the D-013 within-block
// residual is RETIRED — every slot write must place a call frame, and every
// frame at every depth in every tx at or before the case's was scanned.
const adminContinuityEvidence = "two-pin slot read clean AND trace-frame scan clean (debug_traceBlockByHash+callTracer over the case block: no call frame at any depth, in any tx with index < the case's or anywhere in the case's own tx, targets the DM proxy with the ABI-derived setAdminImpl/upgradeTo/upgradeToAndCall selectors). The D-013 within-block swap-and-revert residual is RETIRED under trace evidence (chain-truth R12 Fork 2 Step A): a slot write with no call frame does not exist, so no within-block choreography — honest migration bundle or otherwise — escapes the scan"

// --- the strict callTracer envelope decode -----------------------------------

// traceCallFrame is one callTracer frame, PRESENCE-TRACKED like every other
// wire decode in this package: consumed fields are pointers so an omitted
// field surfaces as absent, never as a plausible zero.
type traceCallFrame struct {
	Type  *string          `json:"type"`
	To    *string          `json:"to"`
	Input *string          `json:"input"`
	Calls []traceCallFrame `json:"calls"`
}

// traceTxEntry is one transaction's trace: the callTracer block form binds
// each root frame to its transaction hash.
type traceTxEntry struct {
	TxHash *string         `json:"txHash"`
	Result *traceCallFrame `json:"result"`
	Error  *string         `json:"error"`
}

// decodedTraceEntry is one validated entry: the tx hash plus its root frame.
// The slice order IS transaction-index order (the callTracer block form
// traces txs in execution order — cross-anchored per case by requiring the
// case's own tx to sit at the block-body index custody stores for it, via
// the case-tx anchor check in adminTraceScanRefusal).
type decodedTraceEntry struct {
	TxHash common.Hash
	Root   traceCallFrame
}

// decodeTraceEnvelope strictly decodes a raw debug_traceBlockByHash+callTracer
// result. Every entry must carry txHash and result; an entry-level error
// field is a provider statement that the tx did not trace — a non-answer for
// a block the law must judge COMPLETELY, so it refuses.
func decodeTraceEnvelope(raw []byte) ([]decodedTraceEntry, error) {
	trimmed := strings.TrimSpace(string(raw))
	if trimmed == "" || trimmed == "null" {
		return nil, fmt.Errorf("trace result is null — a non-answer must not impersonate an empty block")
	}
	var wire []traceTxEntry
	if err := json.Unmarshal(raw, &wire); err != nil {
		return nil, fmt.Errorf("trace result does not decode as a callTracer tx array: %w", err)
	}
	if len(wire) == 0 {
		return nil, fmt.Errorf("trace result is an EMPTY tx array — a block with zero transactions cannot contain the case's own liquidation tx, so the response does not answer the question asked")
	}
	out := make([]decodedTraceEntry, 0, len(wire))
	for i, e := range wire {
		if e.Error != nil {
			return nil, fmt.Errorf("trace entry %d carries a tracer error (%q) — an untraced tx is an unjudgeable tx, and the law must judge every tx at or before the case's", i, *e.Error)
		}
		if e.TxHash == nil {
			return nil, fmt.Errorf("trace entry %d omits txHash — frames that bind to no transaction cannot be attributed, so the scan refuses", i)
		}
		if e.Result == nil {
			return nil, fmt.Errorf("trace entry %d omits result — an absent frame tree must surface as absent, never as an empty (clean) one", i)
		}
		h, err := hexFixed(fmt.Sprintf("trace entry %d txHash", i), *e.TxHash, 32)
		if err != nil {
			return nil, err
		}
		out = append(out, decodedTraceEntry{TxHash: common.BytesToHash(h), Root: *e.Result})
	}
	return out, nil
}

// frameTargetsAdminWrite walks one frame tree and returns the FIRST admin-
// write hit: a frame whose `to` is the DM proxy and whose input is prefixed
// by one of the scanned selectors. depth is 0 at the tx root.
func frameTargetsAdminWrite(fr traceCallFrame, dmProxy common.Address, depth int) (selector string, atDepth int, missingInput bool) {
	if fr.To != nil {
		toBytes := common.FromHex(*fr.To)
		if len(toBytes) == 20 && common.BytesToAddress(toBytes) == dmProxy {
			if fr.Input == nil {
				// A frame TARGETING the proxy with no input field cannot be
				// judged — the caller refuses rather than assumes clean.
				return "", depth, true
			}
			in := common.FromHex(*fr.Input)
			if len(in) >= 4 {
				for _, s := range scannedAdminWriteSelectors {
					if s.id[0] == in[0] && s.id[1] == in[1] && s.id[2] == in[2] && s.id[3] == in[3] {
						return s.name, depth, false
					}
				}
			}
		}
	}
	for _, c := range fr.Calls {
		if sel, d, miss := frameTargetsAdminWrite(c, dmProxy, depth+1); sel != "" || miss {
			return sel, d, miss
		}
	}
	return "", 0, false
}

// frameTouchesAddress reports whether any frame at any depth targets addr —
// the case-tx anchor check (the case's own liquidation MUST have called the
// DM proxy, so a trace claiming otherwise did not answer the question asked).
func frameTouchesAddress(fr traceCallFrame, addr common.Address) bool {
	if fr.To != nil {
		toBytes := common.FromHex(*fr.To)
		if len(toBytes) == 20 && common.BytesToAddress(toBytes) == addr {
			return true
		}
	}
	for _, c := range fr.Calls {
		if frameTouchesAddress(c, addr) {
			return true
		}
	}
	return false
}

// adminTraceScanRefusal is THE Step-A check (mutation target mC): given the
// decoded block trace, the case's own tx hash and the DM proxy, it returns
// "" when the scan is clean and a named refusal otherwise. Pure function so
// the regression drives it directly; runBacktestCase wiring is pinned by
// TestAdminContinuityScanIsWiredIntoRunBacktestCase.
func adminTraceScanRefusal(entries []decodedTraceEntry, caseTx common.Hash, dmProxy common.Address) string {
	caseIdx := -1
	for i := range entries {
		if entries[i].TxHash == caseTx {
			caseIdx = i
			break
		}
	}
	if caseIdx < 0 {
		return fmt.Sprintf("ADMIN-CONTINUITY SCAN refused: the case's own tx %s is ABSENT from the block trace — the response does not answer the question asked (the trace was requested at the case's stored pin, which contains that tx by custody)", caseTx.Hex())
	}
	if !frameTouchesAddress(entries[caseIdx].Root, dmProxy) {
		return fmt.Sprintf("ADMIN-CONTINUITY SCAN refused: the case's own tx %s trace contains NO frame targeting the DM proxy — chain-impossible for a liquidation tx, so the trace does not answer the question asked", caseTx.Hex())
	}
	for i := 0; i <= caseIdx; i++ {
		sel, depth, missingInput := frameTargetsAdminWrite(entries[i].Root, dmProxy, 0)
		if missingInput {
			return fmt.Sprintf("ADMIN-CONTINUITY SCAN refused: tx index %d (%s) carries a frame targeting the DM proxy whose input field is ABSENT at depth %d — an unjudgeable frame refuses, never assumes clean", i, entries[i].TxHash.Hex(), depth)
		}
		if sel != "" {
			scope := "a tx preceding the case's"
			if i == caseIdx {
				scope = "the case's OWN tx (any frame position over-refuses: intra-tx frame-vs-logIndex ordering is unresolvable from callTracer)"
			}
			return fmt.Sprintf("ADMIN-CONTINUITY EPOCH: tx index %d (%s) — %s — carries a call frame at depth %d targeting the DM proxy with the %s selector (ABI-derived). This is the silent-slot-write path itself, observed as an EXECUTED frame: the admin implementation (or the core, via the upgrade entrypoints) may have differed at the case's boundary from what the two-pin read certifies. The case REFUSES — a real epoch boundary requiring chain-truth adjudication, never a verdict (chain-truth R12 Fork 2 Step A)", i, entries[i].TxHash.Hex(), scope, depth, sel)
		}
	}
	return ""
}
