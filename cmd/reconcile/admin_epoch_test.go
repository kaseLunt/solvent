package main

// The ADMIN-IMPLEMENTATION EPOCH wave — Codex round 11 H1 under the
// integrator's D-013 adjudication (admin_epoch.go carries the whole design
// argument and the accepted-and-disclosed within-block residual).
//
// ---------------------------------------------------------------------------
// MUTATION SPEC — committed BEFORE the implementation loop.
//
//   mH  the admin check deleted: adminImplEpochRefusal's comparison removed
//       (`return ""` unconditionally), so a case whose ADMIN_IMPL_POSITION
//       holds an unaudited implementation at either pin sails through to a
//       verdict — the finding's exact false pass (a silent admin swap
//       bypassing the event inventory and the replay refusal).
//       KILLED BY: TestAdminImplEpochMismatchRefusesTheCase — every mismatch
//       arm requires a NAMED refusal; under the mutant all of them answer ""
//       and the test fails. TestCapturedAdminImplIsTheAuditedConstantAtBothPins
//       additionally binds the same check over the committed chain bytes, and
//       TestAdminImplEpochCheckIsWiredIntoRunBacktestCase pins the call site
//       so the check cannot be detached from the case path instead of cut.
//
// Behavioural mutants only; a mutant that fails to compile is re-cut.
// ---------------------------------------------------------------------------

import (
	"encoding/hex"
	"go/ast"
	"go/parser"
	"go/token"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"

	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/crypto"
	"github.com/stretchr/testify/require"
)

// TestAdminImplSlotDerivesFromTheCommittedSource is the slot-provenance pin
// (dispatch step 1): dmAdminImplSlot is never a hand-trusted hash. BOTH the
// literal and its claimed keccak preimage are extracted from the COMMITTED
// source text (recon/cash-v3/src/debt-manager/DebtManagerStorageContract.sol:
// 98-99), the keccak is recomputed here, and all three — source literal,
// keccak(preimage), our constant — must agree. A source upgrade that moves
// the slot, renames the preimage, or breaks the comment's derivation claim
// fails this test by name instead of silently reading the wrong slot.
func TestAdminImplSlotDerivesFromTheCommittedSource(t *testing.T) {
	src, err := os.ReadFile(filepath.Join("..", "..", "recon", "cash-v3", "src", "debt-manager", "DebtManagerStorageContract.sol"))
	require.NoError(t, err, "the committed storage-contract source must be present — it is the slot's source of truth")

	// The declaration and its derivation comment, as one anchored pair: the
	// comment line names keccak256("<preimage>"), the next declaration line
	// carries the literal the EVM actually sloads.
	re := regexp.MustCompile(`keccak256\("([^"]+)"\)[^\n]*\n\s*bytes32 constant ADMIN_IMPL_POSITION = (0x[0-9a-fA-F]{64});`)
	m := re.FindSubmatch(src)
	require.NotNil(t, m, "DebtManagerStorageContract.sol must declare ADMIN_IMPL_POSITION with its keccak derivation comment (source lines 98-99); if the source moved, re-anchor this pin — never re-transcribe by hand")
	preimage, literal := string(m[1]), string(m[2])

	require.Equal(t, strings.ToLower(literal), strings.ToLower(dmAdminImplSlot.Hex()),
		"dmAdminImplSlot must be the source's own literal — the value sload consumes")
	require.Equal(t, strings.ToLower(literal),
		"0x"+hex.EncodeToString(crypto.Keccak256([]byte(preimage))),
		"the source's declared derivation must HOLD: keccak256(%q) must reproduce the literal — if this fails the source comment lies and the pin needs re-adjudication, not a silent pick of one side", preimage)
}

// TestAdminImplSubcallJoinsTheWave8DecodeLaw is the dispatch's wave-8 clause:
// the two getDebtManagerAdmin reads go through the SHARED frame decode loop,
// so the per-subcall law (Success=false / empty / undecodable ⇒ the WHOLE
// frame is UNREAD with the subcall NAMED) covers them automatically — in
// BOTH frames. A degraded slot read must never yield a zero-address
// adminImpl that the epoch check then judges (that would convert an archive
// artifact into an epoch refusal, or worse, a mutant into a pass).
func TestAdminImplSubcallJoinsTheWave8DecodeLaw(t *testing.T) {
	degrade := func(t *testing.T, full bool, mut func([]backtestFrameTag, []multicallResult)) *frameState {
		t.Helper()
		tags := wave8Plan(t, full)
		res := wave8Honest(t, tags, 100_000_000)
		mut(tags, res)
		return wave8Decode(t, full, tags, res)
	}
	forEachFrame := func(t *testing.T, name string, mut func([]backtestFrameTag, []multicallResult)) {
		for _, full := range []bool{true, false} {
			frame := "exec"
			if full {
				frame = "parent"
			}
			t.Run(name+" ("+frame+" frame)", func(t *testing.T) {
				st := degrade(t, full, mut)
				require.NotEmpty(t, st.unread,
					"a degraded getDebtManagerAdmin subcall must mark the frame UNREAD — the epoch check may only ever judge a DECODED slot value, never a defaulted zero")
				require.Contains(t, st.unread, "getDebtManagerAdmin", "the refusal names the subcall")
				require.Equal(t, common.Address{}, st.adminImpl, "nothing decoded, nothing invented")
			})
		}
	}
	setKind := func(res []multicallResult, tags []backtestFrameTag, kind string, r multicallResult) {
		for i, tg := range tags {
			if tg.kind == kind {
				res[i] = r
			}
		}
	}
	forEachFrame(t, "success=false", func(tags []backtestFrameTag, res []multicallResult) {
		setKind(res, tags, "adminImpl", multicallResult{Success: false})
	})
	forEachFrame(t, "empty return data", func(tags []backtestFrameTag, res []multicallResult) {
		setKind(res, tags, "adminImpl", multicallResult{Success: true, ReturnData: []byte{}})
	})
	forEachFrame(t, "undecodable return data", func(tags []backtestFrameTag, res []multicallResult) {
		// 31 bytes: a malformed word no address unpack can accept. (A full
		// 32-byte garbage word would DECODE — go-ethereum takes the low 20
		// bytes — and land in the EPOCH check instead; that arm is
		// TestAdminImplEpochMismatchRefusesTheCase's territory.)
		garbage := make([]byte, 31)
		for i := range garbage {
			garbage[i] = 0xff
		}
		setKind(res, tags, "adminImpl", multicallResult{Success: true, ReturnData: garbage})
	})
	t.Run("honest frames decode the audited address", func(t *testing.T) {
		for _, full := range []bool{true, false} {
			tags := wave8Plan(t, full)
			st := wave8Decode(t, full, tags, wave8Honest(t, tags, 100_000_000))
			require.Empty(t, st.unread)
			require.Equal(t, auditedDMAdminImpl, st.adminImpl,
				"the frame carries its pin's decoded admin implementation")
		}
	})
}

// TestAdminImplEpochMismatchRefusesTheCase is the H1 regression (dispatch
// step 6) and mH's primary kill: a case whose ADMIN_IMPL_POSITION differs
// from the audited constant at EITHER pin refuses with the epoch named —
// never any verdict but the refusal class. The refusal text must print all
// three addresses, because "which epoch was that?" is the first question the
// adjudication needs answered.
func TestAdminImplEpochMismatchRefusesTheCase(t *testing.T) {
	swapped := common.HexToAddress("0x00000000000000000000000000000000000dead1")
	audited := auditedDMAdminImpl

	requireRefusal := func(t *testing.T, note string, parentImpl, execImpl common.Address) {
		t.Helper()
		require.NotEmpty(t, note, "an unaudited admin implementation at either pin MUST refuse — an empty answer here is the finding's silent-swap false pass, verbatim (mutation mH)")
		require.Contains(t, note, "ADMIN-IMPLEMENTATION EPOCH", "the refusal names the epoch class")
		require.Contains(t, note, parentImpl.Hex(), "the refusal prints the parent-pin value")
		require.Contains(t, note, execImpl.Hex(), "the refusal prints the exec-pin value")
		require.Contains(t, note, audited.Hex(), "the refusal prints the audited constant")
		require.Contains(t, note, "REFUSES", "the disposition is a refusal, never a verdict")
	}

	t.Run("swap visible at the N pin (post-parent, persistent)", func(t *testing.T) {
		requireRefusal(t, adminImplEpochRefusal(audited, swapped), audited, swapped)
	})
	t.Run("swap visible at the N-1 pin (pre-boundary, persistent)", func(t *testing.T) {
		requireRefusal(t, adminImplEpochRefusal(swapped, audited), swapped, audited)
	})
	t.Run("a whole foreign epoch (both pins)", func(t *testing.T) {
		requireRefusal(t, adminImplEpochRefusal(swapped, swapped), swapped, swapped)
	})
	t.Run("an unset slot is not the audited epoch either", func(t *testing.T) {
		requireRefusal(t, adminImplEpochRefusal(common.Address{}, common.Address{}), common.Address{}, common.Address{})
	})
	t.Run("guard: the audited epoch at both pins passes, with the D-013 residual disclosed", func(t *testing.T) {
		require.Empty(t, adminImplEpochRefusal(audited, audited),
			"the check must not become a blanket veto — both pins audited is the honest steady state on all 31 frozen cases")
		require.Contains(t, adminImplEpochEvidence, "D-013",
			"the passing case's evidence carries the adjudicated residual disclosure")
		require.Contains(t, adminImplEpochEvidence, audited.Hex(),
			"the disclosure names the audited address it certifies")
	})
}

// TestAdminImplEpochCheckIsWiredIntoRunBacktestCase pins the call site (the
// p3_wiring_round1_test.go discipline): the pure check exists so it can be
// regression-driven, which also means mH could be "cut" by detaching the call
// instead of the comparison. This AST pin makes detachment loud: the check
// must be CALLED from runBacktestCase with the parent frame's value first and
// the exec frame's second, and the passing path must disclose the evidence
// key.
func TestAdminImplEpochCheckIsWiredIntoRunBacktestCase(t *testing.T) {
	fset := token.NewFileSet()
	file, err := parser.ParseFile(fset, "backtest.go", nil, 0)
	require.NoError(t, err)

	var inRunCase bool
	var args []string
	var sawEvidenceKey bool
	root := func(e ast.Expr) string {
		for {
			switch v := e.(type) {
			case *ast.Ident:
				return v.Name
			case *ast.SelectorExpr:
				e = v.X
			default:
				return "(expr)"
			}
		}
	}
	for _, d := range file.Decls {
		fn, ok := d.(*ast.FuncDecl)
		if !ok || fn.Name.Name != "runBacktestCase" {
			continue
		}
		ast.Inspect(fn.Body, func(n ast.Node) bool {
			if call, ok := n.(*ast.CallExpr); ok {
				if id, ok := call.Fun.(*ast.Ident); ok && id.Name == "adminImplEpochRefusal" {
					inRunCase = true
					for _, a := range call.Args {
						args = append(args, root(a))
					}
				}
			}
			if lit, ok := n.(*ast.BasicLit); ok && lit.Kind == token.STRING && strings.Contains(lit.Value, "admin_impl_epoch") {
				sawEvidenceKey = true
			}
			return true
		})
	}
	require.True(t, inRunCase,
		"adminImplEpochRefusal must be CALLED from runBacktestCase — the check detached from the case path is the same false pass as the check deleted (mutation mH's detachment shape)")
	require.Equal(t, []string{"parent", "exec"}, args,
		"the check consumes BOTH frames' slot reads, parent first — two pins is the whole point (a one-pin check misses every persistent pre-boundary swap on one side)")
	require.True(t, sawEvidenceKey,
		"the PASSING path must disclose the admin_impl_epoch evidence key (D-013 5b) — a silent pass hides the accepted residual")
}

// TestCapturedAdminImplIsTheAuditedConstantAtBothPins re-proves the
// audited-constant fact over the COMMITTED chain bytes, hermetically, for
// every frozen case (dispatch step 3's frame-wide verification, pinned so it
// cannot drift): both pins' accessor words decode to the audited address,
// the RAW eth_getStorageAt words carry the same address (accessor == slot,
// chain-proven, closing the "the accessor could lie" objection for the whole
// frame), and the production check passes over exactly these values. A
// capture missing the admin words predates this wave and must be re-captured
// — refused loudly, never defaulted (the adjustment-1 precedent).
func TestCapturedAdminImplIsTheAuditedConstantAtBothPins(t *testing.T) {
	caps := loadContinuityCaptures(t)
	require.NotEmpty(t, caps)
	for key, cap := range caps {
		t.Run(key, func(t *testing.T) {
			for _, side := range []struct {
				pin, ret, slot string
			}{
				{"parent(N-1)", cap.ParentAdminImplRet, cap.ParentAdminImplSlot},
				{"exec(N)", cap.ExecAdminImplRet, cap.ExecAdminImplSlot},
			} {
				require.NotEmpty(t, side.ret,
					"case %s: capture predates the admin-impl provenance wave (no %s accessor word) — re-capture required", key, side.pin)
				require.NotEmpty(t, side.slot,
					"case %s: capture predates the admin-impl provenance wave (no %s raw slot word) — re-capture required", key, side.pin)

				retBytes, err := hex.DecodeString(strings.TrimPrefix(side.ret, "0x"))
				require.NoError(t, err)
				got, err := unpackAddressStrict(dmGetDebtManagerAdminABI, "getDebtManagerAdmin", retBytes)
				require.NoError(t, err, "case %s %s: the accessor word must decode through the production unpacker", key, side.pin)
				require.Equal(t, auditedDMAdminImpl, got,
					"case %s %s: the accessor must answer the AUDITED admin implementation — anything else is a real historical epoch and a STOP, not a re-pin", key, side.pin)

				slotBytes, err := hex.DecodeString(strings.TrimPrefix(side.slot, "0x"))
				require.NoError(t, err)
				require.Len(t, slotBytes, 32, "case %s %s: the raw slot word is one storage word", key, side.pin)
				require.Equal(t, make([]byte, 12), slotBytes[:12],
					"case %s %s: the slot's upper 12 bytes must be zero — an address, nothing smuggled", key, side.pin)
				require.Equal(t, auditedDMAdminImpl, common.BytesToAddress(slotBytes[12:]),
					"case %s %s: raw eth_getStorageAt must agree with the accessor — accessor == slot is the identity that makes the eth_call read a slot read", key, side.pin)
			}
			// And the production check, over exactly the captured values.
			pRet, _ := hex.DecodeString(strings.TrimPrefix(cap.ParentAdminImplRet, "0x"))
			eRet, _ := hex.DecodeString(strings.TrimPrefix(cap.ExecAdminImplRet, "0x"))
			p, err := unpackAddressStrict(dmGetDebtManagerAdminABI, "getDebtManagerAdmin", pRet)
			require.NoError(t, err)
			e, err := unpackAddressStrict(dmGetDebtManagerAdminABI, "getDebtManagerAdmin", eRet)
			require.NoError(t, err)
			require.Empty(t, adminImplEpochRefusal(p, e),
				"case %s: the production epoch check must pass over the captured chain bytes", key)
		})
	}
}
