package main

// THE ADMIN-WRITE TRACE-FRAME LAW regressions (chain-truth R12 ruling, Fork 2
// Step A — admin_trace.go).
//
// ---------------------------------------------------------------------------
// MUTATION SPEC — committed BEFORE the implementation loop.
//
//   mC  the Step-A evidence check deleted: adminTraceScanRefusal's frame walk
//       removed (`return ""` unconditionally, or the selector comparison
//       cut), so a block carrying an executed setAdminImpl/upgradeToAndCall
//       call frame at or before the case's tx sails through to a verdict —
//       the silent-slot-write false pass the whole fork exists to close,
//       with the D-013 residual already declared RETIRED on the strength of
//       exactly this check.
//       KILLED BY: TestAdminTraceScanRefusalLaw (every admin-write fixture
//       demands a NAMED refusal; under the mutant all answer "" and the
//       composed no-refusal assertion of the pre-boundary fixtures fails).
//       TestAdminContinuityScanIsWiredIntoRunBacktestCase pins the call site
//       so the check cannot be detached instead of cut, and
//       TestCapturedTraceScansReplayToTheirPinnedOutcome binds the same law
//       over committed chain bytes.
//
// Behavioural mutants only; a mutant that fails to compile is re-cut.
// ---------------------------------------------------------------------------

import (
	"encoding/hex"
	"encoding/json"
	"go/ast"
	"go/parser"
	"go/token"
	"strings"
	"testing"

	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/crypto"
	"github.com/stretchr/testify/require"
)

// TestAdminWriteSelectorsDeriveFromTheCommittedArtifact is the selector-
// provenance weld (the round-3 lesson applied to FUNCTION selectors):
// setAdminImpl and upgradeToAndCall are pinned against the COMMITTED forge
// artifact's own method IDs, and all three against an independent keccak of
// the canonical signature (upgradeTo is the OZ-v4 legacy entrypoint the
// artifact's OZ-v5 generation no longer declares — its authority is the
// canonical signature itself, stated rather than laundered).
func TestAdminWriteSelectorsDeriveFromTheCommittedArtifact(t *testing.T) {
	artifact := committedDMCoreABI(t)

	bySelector := map[string][4]byte{}
	for _, s := range scannedAdminWriteSelectors {
		bySelector[s.name] = s.id
	}
	require.Len(t, bySelector, 3, "exactly three scanned selectors: setAdminImpl, upgradeTo, upgradeToAndCall")

	art, ok := artifact.Methods["setAdminImpl"]
	require.True(t, ok, "the committed artifact declares setAdminImpl (IDebtManager.sol:440)")
	setSel := bySelector["setAdminImpl"]
	require.Equal(t, art.ID, setSel[:], "setAdminImpl selector must equal the committed artifact's method ID")

	art, ok = artifact.Methods["upgradeToAndCall"]
	require.True(t, ok, "the committed artifact declares upgradeToAndCall (UUPS)")
	upSel := bySelector["upgradeToAndCall"]
	require.Equal(t, art.ID, upSel[:])

	_, hasLegacy := artifact.Methods["upgradeTo"]
	require.False(t, hasLegacy, "the artifact's OZ-v5 generation drops upgradeTo — if this starts passing, re-anchor the upgradeTo pin to the artifact")

	// Independent keccak for all three (never trust one derivation path).
	for sig, want := range map[string][4]byte{
		"setAdminImpl(address)":           bySelector["setAdminImpl"],
		"upgradeTo(address)":              bySelector["upgradeTo"],
		"upgradeToAndCall(address,bytes)": bySelector["upgradeToAndCall"],
	} {
		var id [4]byte
		copy(id[:], crypto.Keccak256([]byte(sig))[:4])
		require.Equal(t, id, want, "selector for %s must equal the independent keccak derivation", sig)
	}
}

// --- trace fixture builders ---------------------------------------------------

func tracePtr(s string) *string { return &s }

// mkFrame builds one callTracer frame.
func mkFrame(to common.Address, input []byte, calls ...traceCallFrame) traceCallFrame {
	fr := traceCallFrame{Type: tracePtr("CALL"), To: tracePtr(strings.ToLower(to.Hex())), Input: tracePtr("0x" + hex.EncodeToString(input)), Calls: calls}
	return fr
}

func mkEntry(tx common.Hash, root traceCallFrame) decodedTraceEntry {
	return decodedTraceEntry{TxHash: tx, Root: root}
}

var (
	traceCaseTx  = common.HexToHash("0x5cd2000000000000000000000000000000000000000000000000000000000001")
	traceOtherTx = common.HexToHash("0x9cdc000000000000000000000000000000000000000000000000000000000002")
	traceThirdTx = common.HexToHash("0x086d000000000000000000000000000000000000000000000000000000000003")
	traceSomeone = common.HexToAddress("0x00000000000000000000000000000000000aaaa1")
)

// selInput renders selector||args calldata for one scanned selector name.
func selInput(t *testing.T, name string, tail int) []byte {
	t.Helper()
	for _, s := range scannedAdminWriteSelectors {
		if s.name == name {
			return append(s.id[:], make([]byte, tail)...)
		}
	}
	t.Fatalf("no scanned selector named %s", name)
	return nil
}

// liquidateFrame is the case tx's anchor: a frame targeting the DM proxy
// with a non-admin selector (the liquidation call itself).
func liquidateFrame() traceCallFrame {
	return mkFrame(liveDMProxy, []byte{0xea, 0x51, 0x51, 0x61, 0x00})
}

// TestAdminTraceScanRefusalLaw is the Step-A law end-to-end over synthetic
// frame trees, and mC's primary kill: every executed admin-write frame at or
// before the case's tx refuses BY NAME; post-boundary txs are not judged;
// the anchors (case tx present, case tx touches the proxy) are enforced as
// answers-the-question validation.
func TestAdminTraceScanRefusalLaw(t *testing.T) {
	cleanBlock := func() []decodedTraceEntry {
		return []decodedTraceEntry{
			mkEntry(traceOtherTx, mkFrame(traceSomeone, []byte{0x01, 0x02, 0x03, 0x04})),
			mkEntry(traceCaseTx, mkFrame(traceSomeone, nil, liquidateFrame())),
			mkEntry(traceThirdTx, mkFrame(traceSomeone, []byte{0xde, 0xad})),
		}
	}

	t.Run("guard: a clean block passes", func(t *testing.T) {
		require.Empty(t, adminTraceScanRefusal(cleanBlock(), traceCaseTx, liveDMProxy))
	})

	t.Run("setAdminImpl frame in an EARLIER tx refuses (nested at depth 2)", func(t *testing.T) {
		entries := cleanBlock()
		entries[0] = mkEntry(traceOtherTx, mkFrame(traceSomeone, nil,
			mkFrame(traceSomeone, []byte{0x11, 0x22, 0x33, 0x44},
				mkFrame(liveDMProxy, selInput(t, "setAdminImpl", 32)))))
		note := adminTraceScanRefusal(entries, traceCaseTx, liveDMProxy)
		require.NotEmpty(t, note, "an EXECUTED setAdminImpl frame before the boundary is the silent-slot-write path itself — under mutation mC this answers empty and the case false-passes")
		require.Contains(t, note, traceOtherTx.Hex(), "the refusal names the tx hash")
		require.Contains(t, note, "setAdminImpl", "the refusal names the selector")
		require.Contains(t, note, "depth 2", "the refusal names the frame depth")
		require.Contains(t, note, "REFUSES")
	})

	t.Run("upgradeToAndCall in the case's OWN tx refuses at any frame position", func(t *testing.T) {
		entries := cleanBlock()
		entries[1] = mkEntry(traceCaseTx, mkFrame(traceSomeone, nil,
			liquidateFrame(),
			mkFrame(liveDMProxy, selInput(t, "upgradeToAndCall", 64))))
		note := adminTraceScanRefusal(entries, traceCaseTx, liveDMProxy)
		require.Contains(t, note, "upgradeToAndCall")
		require.Contains(t, note, "over-refuses", "the case's own tx over-refuses: intra-tx frame-vs-logIndex ordering is unresolvable from callTracer")
	})

	t.Run("legacy upgradeTo refuses too", func(t *testing.T) {
		entries := cleanBlock()
		entries[0] = mkEntry(traceOtherTx, mkFrame(liveDMProxy, selInput(t, "upgradeTo", 32)))
		require.Contains(t, adminTraceScanRefusal(entries, traceCaseTx, liveDMProxy), "upgradeTo")
	})

	t.Run("an admin-write frame in a LATER tx is not judged", func(t *testing.T) {
		entries := cleanBlock()
		entries[2] = mkEntry(traceThirdTx, mkFrame(liveDMProxy, selInput(t, "setAdminImpl", 32)))
		require.Empty(t, adminTraceScanRefusal(entries, traceCaseTx, liveDMProxy),
			"a post-boundary write cannot rewrite the pre-boundary state the crossing is a function of — judging it would be a new law")
	})

	t.Run("the selector at a NON-proxy address is not an admin write on the DM", func(t *testing.T) {
		entries := cleanBlock()
		entries[0] = mkEntry(traceOtherTx, mkFrame(traceSomeone, selInput(t, "setAdminImpl", 32)))
		require.Empty(t, adminTraceScanRefusal(entries, traceCaseTx, liveDMProxy))
	})

	t.Run("an input shorter than a selector cannot match", func(t *testing.T) {
		entries := cleanBlock()
		entries[0] = mkEntry(traceOtherTx, mkFrame(liveDMProxy, []byte{0x40, 0x8d}))
		require.Empty(t, adminTraceScanRefusal(entries, traceCaseTx, liveDMProxy))
	})

	t.Run("the case tx ABSENT from the trace refuses — the answer does not match the question", func(t *testing.T) {
		entries := cleanBlock()[:1]
		note := adminTraceScanRefusal(entries, traceCaseTx, liveDMProxy)
		require.Contains(t, note, "ABSENT")
		require.Contains(t, note, traceCaseTx.Hex())
	})

	t.Run("a case tx trace with NO proxy frame refuses — chain-impossible for a liquidation", func(t *testing.T) {
		entries := cleanBlock()
		entries[1] = mkEntry(traceCaseTx, mkFrame(traceSomeone, []byte{0x01}))
		require.Contains(t, adminTraceScanRefusal(entries, traceCaseTx, liveDMProxy), "NO frame targeting the DM proxy")
	})

	t.Run("a proxy-targeting frame with an ABSENT input field refuses, never assumes clean", func(t *testing.T) {
		entries := cleanBlock()
		fr := traceCallFrame{Type: tracePtr("CALL"), To: tracePtr(strings.ToLower(liveDMProxy.Hex()))}
		entries[0] = mkEntry(traceOtherTx, traceCallFrame{Type: tracePtr("CALL"), To: tracePtr(strings.ToLower(traceSomeone.Hex())), Input: tracePtr("0x"), Calls: []traceCallFrame{fr}})
		require.Contains(t, adminTraceScanRefusal(entries, traceCaseTx, liveDMProxy), "input field is ABSENT")
	})
}

// TestDecodeTraceEnvelopeRefusals pins the strict wire decode: null, empty,
// error-bearing, hash-less and result-less entries all refuse by name.
func TestDecodeTraceEnvelopeRefusals(t *testing.T) {
	mk := func(entries ...map[string]any) []byte {
		b, err := json.Marshal(entries)
		require.NoError(t, err)
		return b
	}
	okFrame := map[string]any{"type": "CALL", "to": strings.ToLower(traceSomeone.Hex()), "input": "0x01020304"}

	t.Run("null is a non-answer", func(t *testing.T) {
		_, err := decodeTraceEnvelope([]byte("null"))
		require.ErrorContains(t, err, "null")
	})
	t.Run("an empty tx array cannot contain the case tx", func(t *testing.T) {
		_, err := decodeTraceEnvelope([]byte("[]"))
		require.ErrorContains(t, err, "EMPTY")
	})
	t.Run("a tracer error entry refuses the block", func(t *testing.T) {
		_, err := decodeTraceEnvelope(mk(map[string]any{"txHash": traceCaseTx.Hex(), "error": "execution timeout"}))
		require.ErrorContains(t, err, "tracer error")
	})
	t.Run("a hash-less entry cannot be attributed", func(t *testing.T) {
		_, err := decodeTraceEnvelope(mk(map[string]any{"result": okFrame}))
		require.ErrorContains(t, err, "txHash")
	})
	t.Run("a result-less entry must not read as clean", func(t *testing.T) {
		_, err := decodeTraceEnvelope(mk(map[string]any{"txHash": traceCaseTx.Hex()}))
		require.ErrorContains(t, err, "result")
	})
	t.Run("the observed provider shape decodes", func(t *testing.T) {
		entries, err := decodeTraceEnvelope(mk(map[string]any{"txHash": traceCaseTx.Hex(), "result": okFrame}))
		require.NoError(t, err)
		require.Len(t, entries, 1)
		require.Equal(t, traceCaseTx, entries[0].TxHash)
	})
}

// TestAdminContinuityScanIsWiredIntoRunBacktestCase pins the call site and
// the evidence key, the same AST discipline as the admin-epoch and code-hash
// pins: detachment is mC's second shape.
func TestAdminContinuityScanIsWiredIntoRunBacktestCase(t *testing.T) {
	fset := token.NewFileSet()
	file, err := parser.ParseFile(fset, "backtest.go", nil, 0)
	require.NoError(t, err)
	var called, evidenceKey bool
	for _, d := range file.Decls {
		fn, ok := d.(*ast.FuncDecl)
		if !ok || fn.Name.Name != "runBacktestCase" {
			continue
		}
		ast.Inspect(fn.Body, func(n ast.Node) bool {
			if call, ok := n.(*ast.CallExpr); ok {
				if id, ok := call.Fun.(*ast.Ident); ok && id.Name == "adminTraceScanRefusal" {
					called = true
				}
			}
			if lit, ok := n.(*ast.BasicLit); ok && lit.Kind == token.STRING && strings.Contains(lit.Value, "admin_continuity") {
				evidenceKey = true
			}
			return true
		})
	}
	require.True(t, called, "adminTraceScanRefusal must be CALLED from runBacktestCase")
	require.True(t, evidenceKey, "the PASSING path must disclose the admin_continuity evidence key")
}

// TestAdminContinuityEvidencePinsTheRetirementAndTheWithdrawal pins the
// disclosure texts' load-bearing content: the Step-A key states the scan and
// the RETIREMENT; the admin_impl_epoch key no longer stands behind the
// refuted D-013 classification — the old claim appears only as QUOTED and
// WITHDRAWN, never asserted.
func TestAdminContinuityEvidencePinsTheRetirementAndTheWithdrawal(t *testing.T) {
	require.Contains(t, adminContinuityEvidence, "trace-frame scan clean")
	require.Contains(t, adminContinuityEvidence, "setAdminImpl/upgradeTo/upgradeToAndCall")
	require.Contains(t, adminContinuityEvidence, "RETIRED")
	require.Contains(t, adminContinuityEvidence, "R12 Fork 2 Step A")

	require.Contains(t, adminImplEpochEvidence, "refuted")
	require.Contains(t, adminImplEpochEvidence, "withdrawn")
	require.Contains(t, adminImplEpochEvidence, "'evasion-shaped choreography only' adjudication was refuted",
		"the old claim may appear ONLY as a quoted, withdrawn adjudication")
	require.NotContains(t, adminImplEpochEvidence, "excluded per D-013",
		"the pre-R12 assertion shape must be gone (round 12 H2b: the residual was never adversary-only)")
	require.Contains(t, adminImplEpochEvidence, "honest migration bundle",
		"the withdrawal names the honest shape that refuted the old classification")
}
