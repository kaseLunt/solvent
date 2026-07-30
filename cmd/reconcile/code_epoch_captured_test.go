package main

// The DEFAULT-HERMETIC captured suite for the R12 evidence (chain-truth R12
// ruling): every frozen case's committed code-surface observations, ERC1967
// slot words and callTracer block traces replayed through the PRODUCTION
// paths (readCodeSurfaces → codeHashConstancyRefusal; decodeTraceEnvelope →
// adminTraceScanRefusal), with outcomes pinned to what the live chain
// answered at capture time. No network, no DB.
//
// PRE-WAVE CAPTURES REFUSE LOUDLY (the established adjustment-1 precedent): a
// capture missing the R12 fields predates this wave and must be re-captured —
// named per case, never defaulted and never silently skipped.

import (
	"compress/gzip"
	"context"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/crypto"
	"github.com/stretchr/testify/require"
)

// committedSurfaceBytes reads one committed surface byte file
// (testdata/code_epoch/<file>, "0x…" hex).
func committedSurfaceBytes(t *testing.T, file string) []byte {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join("testdata", "code_epoch", file))
	require.NoError(t, err, "the committed surface bytes %s must be present (written by the R12 capture)", file)
	s := strings.TrimSpace(string(raw))
	require.True(t, strings.HasPrefix(s, "0x"), "%s must be 0x-prefixed hex", file)
	return common.FromHex(s)
}

// TestCommittedSurfaceBytesKeccakToTheAuditedConstants exercises the local-
// keccak leg over the REAL committed bytes: the one byte copy per surface
// must hash to the dual-established audited constant. This is what makes the
// hermetic replay below an end-to-end run of the production recomputation
// (raw bytes → keccak → compare), not a hash-of-a-hash theater.
func TestCommittedSurfaceBytesKeccakToTheAuditedConstants(t *testing.T) {
	for _, s := range []struct {
		file string
		want common.Hash
	}{
		{"proxy.hex", auditedDMProxyCodeHash},
		{"core-impl.hex", auditedDMCoreImplCodeHash},
		{"admin-impl.hex", auditedDMAdminImplCodeHash},
	} {
		code := committedSurfaceBytes(t, s.file)
		require.NotEmpty(t, code, "%s: empty surface bytes would be the zero-hash lie", s.file)
		require.Equal(t, s.want, crypto.Keccak256Hash(code),
			"%s: the committed bytes must keccak to the audited constant — a drift means the committed copy is not the established bytecode", s.file)
	}
}

// capturedCodeBackend serves the committed surface bytes + a capture's slot
// words through the production rawCodeBackend interface, so the hermetic
// suite drives readCodeSurfaces exactly as production does.
type capturedCodeBackend struct {
	code       map[common.Address][]byte
	parentPin  common.Hash
	execPin    common.Hash
	parentWord common.Hash
	execWord   common.Hash
}

func (b *capturedCodeBackend) codeAtHash(_ context.Context, _ string, addr common.Address, _ common.Hash) ([]byte, error) {
	return b.code[addr], nil
}

func (b *capturedCodeBackend) storageAtHash(_ context.Context, _ string, _ common.Address, _ common.Hash, blockHash common.Hash) (common.Hash, error) {
	switch blockHash {
	case b.parentPin:
		return b.parentWord, nil
	case b.execPin:
		return b.execWord, nil
	}
	return common.Hash{}, nil
}

// TestCapturedCodeSurfacesReplayCleanThroughTheProductionPath replays every
// frozen case's R12 Fork-1 evidence: the captured slot words + the committed
// surface bytes go through readCodeSurfaces and codeHashConstancyRefusal —
// the exact production pair — and must pass; the capture-time observations
// must be byte-stable against both the replay and the audited constants.
func TestCapturedCodeSurfacesReplayCleanThroughTheProductionPath(t *testing.T) {
	caps := loadContinuityCaptures(t)
	require.NotEmpty(t, caps)
	proxyCode := committedSurfaceBytes(t, "proxy.hex")
	coreCode := committedSurfaceBytes(t, "core-impl.hex")
	adminCode := committedSurfaceBytes(t, "admin-impl.hex")

	for key, cap := range caps {
		t.Run(key, func(t *testing.T) {
			require.NotEmpty(t, cap.ParentERC1967ImplSlot,
				"case %s: capture predates the R12 wave (no parent_erc1967_impl_slot) — re-capture required", key)
			require.NotEmpty(t, cap.ExecERC1967ImplSlot,
				"case %s: capture predates the R12 wave (no exec_erc1967_impl_slot) — re-capture required", key)
			require.Len(t, cap.CodeSurfaces, 3,
				"case %s: capture predates the R12 wave (no three-surface observation) — re-capture required", key)

			parentWord := common.HexToHash(cap.ParentERC1967ImplSlot)
			execWord := common.HexToHash(cap.ExecERC1967ImplSlot)
			parentImpl := common.BytesToAddress(parentWord[12:])
			execImpl := common.BytesToAddress(execWord[12:])
			require.NotEqual(t, common.Address{}, parentImpl)
			require.Equal(t, parentImpl, execImpl,
				"case %s: the ERC1967 slot resolved different addresses at the two pins — that would have STOPPED the capture", key)

			parentHash := common.HexToHash(cap.ParentHash)
			pin := common.HexToHash(cap.Pin)
			backend := &capturedCodeBackend{
				code: map[common.Address][]byte{
					liveDMProxy:        proxyCode,
					execImpl:           coreCode,
					auditedDMAdminImpl: adminCode,
				},
				parentPin: parentHash, execPin: pin,
				parentWord: parentWord, execWord: execWord,
			}
			obs, err := readCodeSurfaces(context.Background(), backend, key, liveDMProxy, parentHash, pin)
			require.NoError(t, err)
			require.Empty(t, codeHashConstancyRefusal(obs),
				"case %s: the production three-surface check must pass over the committed chain bytes", key)

			// Byte-stability: the replayed observation equals the capture-time
			// one, and both equal the audited constants.
			wantHash := map[string]common.Hash{
				"proxy":      auditedDMProxyCodeHash,
				"core-impl":  auditedDMCoreImplCodeHash,
				"admin-impl": auditedDMAdminImplCodeHash,
			}
			recorded := map[string]capturedCodeSurface{}
			for _, cs := range cap.CodeSurfaces {
				recorded[cs.Surface] = cs
			}
			for _, o := range obs {
				rec, ok := recorded[o.Surface]
				require.True(t, ok, "case %s: capture records surface %s", key, o.Surface)
				require.Equal(t, wantHash[o.Surface], o.ParentHash)
				require.Equal(t, wantHash[o.Surface], o.ExecHash)
				require.Equal(t, strings.ToLower(wantHash[o.Surface].Hex()), rec.ParentHash,
					"case %s surface %s: the capture-time parent keccak drifted", key, o.Surface)
				require.Equal(t, strings.ToLower(wantHash[o.Surface].Hex()), rec.ExecHash)
				require.Equal(t, rec.ParentLen, o.ParentLen,
					"case %s surface %s: the committed byte copy's length disagrees with the capture-time observation", key, o.Surface)
				require.Equal(t, rec.ExecLen, o.ExecLen)
			}
		})
	}
}

// loadCommittedTrace gunzips one committed block trace to the EXACT raw
// bytes production's assembler consumed at capture time.
func loadCommittedTrace(t *testing.T, traceFile string) []byte {
	t.Helper()
	f, err := os.Open(filepath.Join("testdata", filepath.FromSlash(traceFile)))
	require.NoError(t, err, "committed trace %s must be present (written by the R12 capture)", traceFile)
	defer f.Close()
	zr, err := gzip.NewReader(f)
	require.NoError(t, err)
	defer zr.Close()
	raw, err := io.ReadAll(zr)
	require.NoError(t, err)
	return raw
}

// TestCapturedTraceScansReplayToTheirPinnedOutcome replays every frozen
// case's committed block trace through the production decode + Step-A scan
// and requires the EXACT capture-time outcome (all 31 scanned clean at
// capture, which is why they hold verdicts at all). Fixture realism rides
// on the scan's own anchors: the case's tx must be present and must carry a
// DM-proxy frame, or the scan refuses — a trace fixture that cannot fail
// those anchors cannot exist here.
func TestCapturedTraceScansReplayToTheirPinnedOutcome(t *testing.T) {
	caps := loadContinuityCaptures(t)
	require.NotEmpty(t, caps)
	clean := 0
	for key, cap := range caps {
		t.Run(key, func(t *testing.T) {
			require.NotEmpty(t, cap.TraceFile,
				"case %s: capture predates the R12 wave (no trace_file) — re-capture required", key)
			raw := loadCommittedTrace(t, cap.TraceFile)
			entries, err := decodeTraceEnvelope(raw)
			require.NoError(t, err, "case %s: the committed trace must decode through the production envelope decode", key)
			note := adminTraceScanRefusal(entries, common.HexToHash("0x"+strings.TrimPrefix(cap.TxHash, "0x")), liveDMProxy)
			require.Equal(t, cap.Expected.AdminScanClean, note == "",
				"case %s: the scan outcome over the SAME chain bytes drifted from the capture-time outcome (note: %s)", key, note)
			require.Equal(t, cap.Expected.AdminScanRefusal, note,
				"case %s: the refusal text must be byte-stable — a changed refusal is a changed law", key)
			if note == "" {
				clean++
			}

			// The anchor facts, asserted explicitly for the reviewer: the
			// case's own tx is in the trace and touches the DM proxy.
			caseTx := common.HexToHash("0x" + strings.TrimPrefix(cap.TxHash, "0x"))
			found := false
			for _, e := range entries {
				if e.TxHash == caseTx {
					found = true
					require.True(t, frameTouchesAddress(e.Root, liveDMProxy),
						"case %s: the case tx's trace must contain a DM-proxy frame (the liquidation call itself)", key)
				}
			}
			require.True(t, found, "case %s: the case tx must be present in the committed trace", key)
		})
	}
	t.Logf("captured trace replay: %d/%d scans clean", clean, len(caps))
}
