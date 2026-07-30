package main

// THE THREE-SURFACE CODE-HASH CONSTANCY PIN regressions (chain-truth R12
// ruling, Fork 1 — code_epoch.go).
//
// ---------------------------------------------------------------------------
// MUTATION SPEC — committed BEFORE the implementation loop.
//
//   mA  one surface dropped from the Fork-1 conjunction (the core impl
//       unpinned): codeHashConstancyRefusal stops judging the "core-impl"
//       surface (its comparison removed, or the missing-surface belt cut),
//       so a case whose ERC1967 implementation carries DIFFERENT bytecode at
//       a pin sails through to a verdict — the finding's exact false pass
//       (the Liquidated/IIU decode authority unbound, the identical
//       version-skew scenario one slot over from the admin pin; the ruling
//       names this omission BLOCKING).
//       KILLED BY: TestCodeHashConstancyRefusalNamesEveryEpoch's moved-core-
//       impl fixture (refused → passing under the mutant) and its
//       missing-surface fixture (an observation set WITHOUT core-impl must
//       refuse; under the belt-cut mutant it passes).
//       TestCodeHashCheckIsWiredIntoRunBacktestCase pins the call site so
//       the check cannot be detached from the case path instead of cut.
//
// Behavioural mutants only; a mutant that fails to compile is re-cut.
// ---------------------------------------------------------------------------

import (
	"context"
	"fmt"
	"go/ast"
	"go/parser"
	"go/token"
	"math/big"
	"strings"
	"testing"

	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/crypto"
	"github.com/stretchr/testify/require"
)

// TestERC1967ImplSlotDerivesFromTheStandard is the slot-provenance pin, the
// same source-anchored discipline as TestAdminImplSlotDerivesFromTheCommittedSource:
// EIP-1967 defines the implementation slot as
// keccak256("eip1967.proxy.implementation") − 1 (minus one exactly so the
// slot has no known keccak preimage). Both sides are recomputed here — the
// keccak AND the subtraction — so the literal can never drift from its
// derivation.
func TestERC1967ImplSlotDerivesFromTheStandard(t *testing.T) {
	h := crypto.Keccak256([]byte("eip1967.proxy.implementation"))
	derived := new(big.Int).Sub(new(big.Int).SetBytes(h), big.NewInt(1))
	require.Equal(t, erc1967ImplSlot, common.BigToHash(derived),
		"erc1967ImplSlot must equal keccak256(\"eip1967.proxy.implementation\") - 1 (EIP-1967) — a drifted slot reads garbage and calls it an implementation")
}

// auditedObservations is the honest three-surface observation set: every
// hash the audited constant, every length nonzero.
func auditedObservations() []codeSurfaceObservation {
	return []codeSurfaceObservation{
		{Surface: "proxy", Address: liveDMProxy, ParentHash: auditedDMProxyCodeHash, ExecHash: auditedDMProxyCodeHash, ParentLen: 122, ExecLen: 122},
		{Surface: "core-impl", Address: auditedDMCoreImplAddr, ParentHash: auditedDMCoreImplCodeHash, ExecHash: auditedDMCoreImplCodeHash, ParentLen: 18156, ExecLen: 18156},
		{Surface: "admin-impl", Address: auditedDMAdminImpl, ParentHash: auditedDMAdminImplCodeHash, ExecHash: auditedDMAdminImplCodeHash, ParentLen: 11219, ExecLen: 11219},
	}
}

// TestCodeHashConstancyRefusalNamesEveryEpoch is the Fork-1 regression and
// mA's primary kill: every mismatched, empty or missing surface refuses with
// the surface NAMED; the honest set passes.
func TestCodeHashConstancyRefusalNamesEveryEpoch(t *testing.T) {
	moved := crypto.Keccak256Hash([]byte("some other generation's bytecode"))

	t.Run("guard: the audited set at both pins passes", func(t *testing.T) {
		require.Empty(t, codeHashConstancyRefusal(auditedObservations()),
			"the honest steady state on all 31 frozen cases must pass — the pin is a constancy law, not a veto")
	})

	t.Run("mA fixture: a MOVED CORE-IMPL hash refuses by name", func(t *testing.T) {
		obs := auditedObservations()
		obs[1].ExecHash = moved
		note := codeHashConstancyRefusal(obs)
		require.NotEmpty(t, note,
			"a core-impl bytecode change at the exec pin MUST refuse — under mutation mA (core surface dropped) this fixture goes from refused to PASSING, which is the ruling's named blocking omission")
		require.Contains(t, note, "core-impl", "the refusal names the surface")
		require.Contains(t, note, moved.Hex(), "the refusal prints the observed hash")
		require.Contains(t, note, auditedDMCoreImplCodeHash.Hex(), "the refusal prints the audited constant")
		require.Contains(t, note, "REFUSES", "the disposition is a refusal, never a verdict")
	})

	t.Run("a moved proxy hash at the parent pin refuses", func(t *testing.T) {
		obs := auditedObservations()
		obs[0].ParentHash = moved
		note := codeHashConstancyRefusal(obs)
		require.Contains(t, note, "proxy")
		require.Contains(t, note, moved.Hex())
	})

	t.Run("a moved admin-impl hash refuses", func(t *testing.T) {
		obs := auditedObservations()
		obs[2].ParentHash, obs[2].ExecHash = moved, moved
		note := codeHashConstancyRefusal(obs)
		require.Contains(t, note, "admin-impl")
	})

	t.Run("EMPTY code is a refusal, never a zero-hash", func(t *testing.T) {
		obs := auditedObservations()
		obs[0].ParentLen = 0
		obs[0].ParentHash = common.Hash{}
		note := codeHashConstancyRefusal(obs)
		require.Contains(t, note, "EMPTY")
		require.Contains(t, note, "proxy")
	})

	t.Run("mA belt: an observation set MISSING the core-impl surface refuses", func(t *testing.T) {
		obs := []codeSurfaceObservation{auditedObservations()[0], auditedObservations()[2]}
		note := codeHashConstancyRefusal(obs)
		require.NotEmpty(t, note,
			"two surfaces are NOT the conjunction — pinning only proxy+admin closes half the finding (chain-truth R12: the core-impl omission is BLOCKING)")
		require.Contains(t, note, "core-impl")
		require.Contains(t, note, "NOT observed")
	})

	t.Run("an unknown surface cannot impersonate a member", func(t *testing.T) {
		obs := append(auditedObservations(), codeSurfaceObservation{Surface: "beacon", ParentLen: 1, ExecLen: 1})
		require.Contains(t, codeHashConstancyRefusal(obs), "unknown code surface")
	})

	t.Run("the head check is the same law over the same shape", func(t *testing.T) {
		require.Empty(t, headCodeHashRefusal(auditedObservations()))
		obs := auditedObservations()
		obs[1].ParentHash = moved
		require.NotEmpty(t, headCodeHashRefusal(obs))
	})
}

// TestDecodeAuthorityEvidenceCarriesTheVerbatimCertificationText pins the
// ruling's certification-limits disclosure LITERALLY (the ruling says "use
// verbatim"), and that the passing case's evidence value carries it plus the
// three audited constants.
func TestDecodeAuthorityEvidenceCarriesTheVerbatimCertificationText(t *testing.T) {
	const verbatim = "The pinned code hash certifies that the bytecode at the audited address is byte-identical at every frame boundary read and at establishment, and that the replay's decode semantics were empirically anchored against logs emitted by this exact bytecode (the captured fixtures come from these very blocks). Interior-of-block constancy follows from EIP-6780 (active on OP since Ecotone, 2024-03, before frame start 150,057,202): code deployed in a prior block cannot change mid-block. It does NOT certify that any Solidity source text corresponds to this bytecode — no compile bridge exists; source correspondence rests on fixture anchoring plus human source review, and is a trust posture, not a proof."
	require.Equal(t, verbatim, decodeAuthorityCertifies,
		"the certification-limits text is NORMATIVE and used verbatim (chain-truth R12 Fork 1) — tests pin it literally so it cannot be softened")
	require.Contains(t, decodeAuthorityEvidence, verbatim)
	require.Contains(t, decodeAuthorityEvidence, auditedDMProxyCodeHash.Hex())
	require.Contains(t, decodeAuthorityEvidence, auditedDMCoreImplCodeHash.Hex())
	require.Contains(t, decodeAuthorityEvidence, auditedDMAdminImplCodeHash.Hex())
}

// fakeCodeBackend drives the PRODUCTION readCodeSurfaces path hermetically:
// code bytes by address, slot words by pin.
type fakeCodeBackend struct {
	code  map[common.Address][]byte
	slots map[common.Hash]common.Hash // blockHash → impl-slot word
	errOn string
}

func (f *fakeCodeBackend) codeAtHash(_ context.Context, op string, addr common.Address, _ common.Hash) ([]byte, error) {
	if f.errOn != "" && strings.Contains(op, f.errOn) {
		return nil, fmt.Errorf("fake: %s unserved", op)
	}
	return f.code[addr], nil
}

func (f *fakeCodeBackend) storageAtHash(_ context.Context, op string, _ common.Address, slot common.Hash, blockHash common.Hash) (common.Hash, error) {
	if f.errOn != "" && strings.Contains(op, f.errOn) {
		return common.Hash{}, fmt.Errorf("fake: %s unserved", op)
	}
	if slot != erc1967ImplSlot {
		return common.Hash{}, fmt.Errorf("fake: unexpected slot %s", slot.Hex())
	}
	return f.slots[blockHash], nil
}

// TestReadCodeSurfacesThroughTheProductionPath drives readCodeSurfaces over a
// fake backend: the observation set carries locally-keccak'd hashes for all
// three surfaces (the permitted recomputation — raw bytes → keccak), the
// impl address comes from the slot word PER PIN, and a zero slot word or a
// failed read refuses the whole set.
func TestReadCodeSurfacesThroughTheProductionPath(t *testing.T) {
	parentHash := common.HexToHash("0x1111111111111111111111111111111111111111111111111111111111111111")
	pinHash := common.HexToHash("0x2222222222222222222222222222222222222222222222222222222222222222")
	impl := common.HexToAddress("0x0392347936B84Fd2d9De67F178f1D8e0bFc14a19")
	proxyCode, coreCode, adminCode := []byte{0x60, 0x80}, []byte{0x60, 0x40, 0x52}, []byte{0xfe, 0x01}
	backend := &fakeCodeBackend{
		code: map[common.Address][]byte{
			liveDMProxy:        proxyCode,
			impl:               coreCode,
			auditedDMAdminImpl: adminCode,
		},
		slots: map[common.Hash]common.Hash{
			parentHash: common.BytesToHash(impl.Bytes()),
			pinHash:    common.BytesToHash(impl.Bytes()),
		},
	}

	obs, err := readCodeSurfaces(context.Background(), backend, "t", liveDMProxy, parentHash, pinHash)
	require.NoError(t, err)
	require.Len(t, obs, 3)
	require.Equal(t, "proxy", obs[0].Surface)
	require.Equal(t, crypto.Keccak256Hash(proxyCode), obs[0].ParentHash)
	require.Equal(t, crypto.Keccak256Hash(proxyCode), obs[0].ExecHash)
	require.Equal(t, "core-impl", obs[1].Surface)
	require.Equal(t, impl, obs[1].Address, "the core surface's address is the slot resolvee")
	require.Equal(t, crypto.Keccak256Hash(coreCode), obs[1].ParentHash)
	require.Equal(t, "admin-impl", obs[2].Surface)
	require.Equal(t, crypto.Keccak256Hash(adminCode), obs[2].ExecHash)

	t.Run("a ZERO impl-slot word refuses the read set", func(t *testing.T) {
		b2 := &fakeCodeBackend{code: backend.code, slots: map[common.Hash]common.Hash{}}
		_, err := readCodeSurfaces(context.Background(), b2, "t", liveDMProxy, parentHash, pinHash)
		require.Error(t, err)
		require.Contains(t, err.Error(), "ZERO address")
	})

	t.Run("a failed surface read refuses the read set", func(t *testing.T) {
		b3 := &fakeCodeBackend{code: backend.code, slots: backend.slots, errOn: "admin-impl@pin"}
		_, err := readCodeSurfaces(context.Background(), b3, "t", liveDMProxy, parentHash, pinHash)
		require.Error(t, err)
		require.Contains(t, err.Error(), "admin-impl")
	})
}

// TestCodeHashCheckIsWiredIntoRunBacktestCase pins the call sites (the
// admin-epoch AST discipline): codeHashConstancyRefusal must be CALLED from
// runBacktestCase, headCodeHashRefusal from runBacktest, and the passing
// path must disclose the decode_authority evidence key — a check detached
// from the case path is the same false pass as the check deleted (mutation
// mA's detachment shape).
func TestCodeHashCheckIsWiredIntoRunBacktestCase(t *testing.T) {
	fset := token.NewFileSet()
	file, err := parser.ParseFile(fset, "backtest.go", nil, 0)
	require.NoError(t, err)

	calledIn := func(fnName, callee string) (bool, bool) {
		var called, evidenceKey bool
		for _, d := range file.Decls {
			fn, ok := d.(*ast.FuncDecl)
			if !ok || fn.Name.Name != fnName {
				continue
			}
			ast.Inspect(fn.Body, func(n ast.Node) bool {
				if call, ok := n.(*ast.CallExpr); ok {
					if id, ok := call.Fun.(*ast.Ident); ok && id.Name == callee {
						called = true
					}
				}
				if lit, ok := n.(*ast.BasicLit); ok && lit.Kind == token.STRING && strings.Contains(lit.Value, "decode_authority") {
					evidenceKey = true
				}
				return true
			})
		}
		return called, evidenceKey
	}
	caseCalled, caseEvidence := calledIn("runBacktestCase", "codeHashConstancyRefusal")
	require.True(t, caseCalled, "codeHashConstancyRefusal must be CALLED from runBacktestCase")
	require.True(t, caseEvidence, "the PASSING path must disclose the decode_authority evidence key — a silent pass hides the certification limits")
	headCalled, _ := calledIn("runBacktest", "headCodeHashRefusal")
	require.True(t, headCalled, "headCodeHashRefusal must be CALLED from runBacktest — the ruling's head arm ('plus the run's head pin') is part of the law, not the capture harness")
}

// TestAuditedCodeHashConstantsAreEstablished guards against a zero-valued
// constant shipping: a zero hash would make the empty-code refusal and the
// constancy law collide, and a zero constant means the establishment record
// was never taken.
func TestAuditedCodeHashConstantsAreEstablished(t *testing.T) {
	for name, h := range map[string]common.Hash{
		"proxy":      auditedDMProxyCodeHash,
		"core-impl":  auditedDMCoreImplCodeHash,
		"admin-impl": auditedDMAdminImplCodeHash,
	} {
		require.NotEqual(t, common.Hash{}, h, "surface %s: the audited constant must be established (dual-provider, recon/derivation-notes.md), never zero", name)
	}
	require.NotEqual(t, common.Address{}, auditedDMCoreImplAddr)
	// And the keccak-of-empty sentinel must not sneak in as a "constant".
	empty := crypto.Keccak256Hash(nil)
	require.NotEqual(t, empty, auditedDMProxyCodeHash)
	require.NotEqual(t, empty, auditedDMCoreImplCodeHash)
	require.NotEqual(t, empty, auditedDMAdminImplCodeHash)
}
