// The THREE-SURFACE CODE-HASH CONSTANCY PIN — chain-truth R12 ruling, FORK 1
// (B), NORMATIVE (ADDENDUM 2 of
// .superpowers/sdd/p3-consults/chain-truth-basket-continuity-ruling.md).
//
// THE FINDING (Codex round 12): the gate pinned ADDRESSES (the proxy, the
// admin impl) but never bound an address to BYTECODE. The decode authority of
// every replayed event — Borrowed/Repaid/Liquidated/IIU semantics — lives in
// the ERC1967 core implementation, and the admin surface's semantics live in
// the admin impl; an upgrade at either address between establishment and a
// case's boundary would leave every decode running under the wrong
// generation's ABI with zero refusal. Fork 1's (A) — compile the committed
// source and compare — was REJECTED by the ruling: we do not custody the
// build pipeline (compiler, optimizer, via-ir, CBOR trailer), recon/cash-v3
// is a gitignored working copy so there is no committed source to compile,
// and a compile-compare loosened until green is calibrating the instrument
// against its target. (B) is the law: pin the BYTES.
//
// THE (B) LAW, implemented here and wired in runBacktestCase:
//
//  1. eth_getCode (EIP-1898 blockHash form — probed first, transcribed in
//     recon/p3-probes.md "R12 Fork-1 probe") at parentHash(N-1) and
//     pinHash(N) for all 31 cases plus the run's head pin; keccak the
//     returned bytes LOCALLY (permitted recomputation — raw bytes→keccak is
//     a complete model); all hashes must equal ONE audited constant per
//     surface. Case mismatch → case refusal (sibling class of
//     admin-impl-epoch: "decode-authority-epoch"); head mismatch →
//     preflightExit posture.
//  2. THREE surfaces, not one: (i) the proxy itself, (ii) the ERC1967 core
//     implementation (impl slot read at both pins by the same two-pin
//     discipline, then the resolved address's code), (iii) the admin impl.
//     Pinning only the admin closes half the finding.
//  3. Establishment of each constant is a DUAL-PROVIDER read (both
//     SOLVENT_RECON_RPC_OP endpoints × head + two frame-depth pins,
//     recon/derivation-notes.md "Debt Manager code-hash constancy pins");
//     frame reads thereafter may be single-provider — they compare against
//     the dual-established constant. Non-empty code required: an EMPTY
//     getCode answer is a refusal, never a zero-hash.
//
// WHAT THE PINNED HASH CERTIFIES (chain-truth R12 ruling, disclosure text
// VERBATIM — tests pin it literally):
//
//	"The pinned code hash certifies that the bytecode at the audited address
//	is byte-identical at every frame boundary read and at establishment, and
//	that the replay's decode semantics were empirically anchored against
//	logs emitted by this exact bytecode (the captured fixtures come from
//	these very blocks). Interior-of-block constancy follows from EIP-6780
//	(active on OP since Ecotone, 2024-03, before frame start 150,057,202):
//	code deployed in a prior block cannot change mid-block. It does NOT
//	certify that any Solidity source text corresponds to this bytecode — no
//	compile bridge exists; source correspondence rests on fixture anchoring
//	plus human source review, and is a trust posture, not a proof."
package main

import (
	"context"
	"fmt"
	"strings"

	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/crypto"
	gethrpc "github.com/ethereum/go-ethereum/rpc"

	"github.com/kaselunt/solvent/cmd/reconcile/snapshotdb"
	"github.com/kaselunt/solvent/internal/chain"
)

// erc1967ImplSlot is the ERC-1967 implementation slot,
// keccak256("eip1967.proxy.implementation") − 1 (EIP-1967, "Implementation
// slot" — the standard subtracts one exactly so the slot has no known keccak
// preimage). Derived and pinned the same source-anchored way as
// ADMIN_IMPL_POSITION: TestERC1967ImplSlotDerivesFromTheStandard recomputes
// keccak256 of the standard's preimage string and subtracts one on every
// suite run, so this literal can never drift from its derivation.
var erc1967ImplSlot = common.HexToHash("0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc")

// The three AUDITED code-hash constants — keccak256 of the deployed runtime
// bytecode at each surface, ESTABLISHED 2026-07-30 by dual-provider reads
// (both SOLVENT_RECON_RPC_OP endpoints × head("latest") + frame pins
// 150,057,202 (0x9e536de1…) and 153,399,414 (0xd0df4d30…), all by stored
// hash; TestLiveCodeHashGetCodeProbe, transcribed in recon/p3-probes.md and
// recorded in recon/derivation-notes.md "Debt Manager code-hash constancy
// pins"). Every read of a surface answered the ONE hash pinned here; the
// ERC1967 impl slot resolved ONE address at every read
// (auditedDMCoreImplAddr). A future honest upgrade changes the chain and NOT
// these constants, so every case refuses loudly (decode-authority-epoch)
// until the new bytecode is audited and the pin consciously re-established —
// the same refusal-over-absorption posture as the admin address pin.
var (
	// proxy: 122 bytes at every establishment read.
	auditedDMProxyCodeHash = common.HexToHash("0xe428fca70a96823c60ffaa430edc8cc501377a4709bdb3a070d024d616d81ff5")
	// core impl (resolved from the ERC1967 slot): 18,156 bytes at every read.
	auditedDMCoreImplCodeHash = common.HexToHash("0xdf7eab5a9862bab8b11aef543878afc87f1abbecd61dd4ccd6c4e61a44055fda")
	// admin impl (the audited address admin_epoch.go pins): 11,219 bytes.
	auditedDMAdminImplCodeHash = common.HexToHash("0x58d08134cbfa191f9e45e44ce0da6f643caae51b50257ed99a4236dd27f7de75")
	// auditedDMCoreImplAddr is the ONE address the ERC1967 impl slot resolved
	// at every establishment read. Recorded for the artifact; the LAW is the
	// hash constancy above (bytecode identity), not address identity — the
	// slot is re-read at both pins of every case and whatever address it
	// resolves must carry the audited BYTES.
	auditedDMCoreImplAddr = common.HexToAddress("0x0392347936B84Fd2d9De67F178f1D8e0bFc14a19")
)

// decodeAuthorityCertifies is the ruling's certification-limits disclosure,
// VERBATIM (the "what the pinned hash certifies" text). It travels on every
// passing case's obligation-2 row under the decode_authority evidence key,
// alongside the admin_impl_epoch sibling, so no reviewer can read the pin as
// a source-correspondence proof.
const decodeAuthorityCertifies = "The pinned code hash certifies that the bytecode at the audited address is byte-identical at every frame boundary read and at establishment, and that the replay's decode semantics were empirically anchored against logs emitted by this exact bytecode (the captured fixtures come from these very blocks). Interior-of-block constancy follows from EIP-6780 (active on OP since Ecotone, 2024-03, before frame start 150,057,202): code deployed in a prior block cannot change mid-block. It does NOT certify that any Solidity source text corresponds to this bytecode — no compile bridge exists; source correspondence rests on fixture anchoring plus human source review, and is a trust posture, not a proof."

// decodeAuthorityEvidence is the passing case's decode_authority key: the
// three-surface pass statement plus the certification-limits text verbatim.
var decodeAuthorityEvidence = "three-surface code-hash constancy pinned at both case pins: proxy, ERC1967 core impl (slot-resolved per pin) and admin impl all keccak to the dual-established audited constants (" +
	auditedDMProxyCodeHash.Hex() + " / " + auditedDMCoreImplCodeHash.Hex() + " / " + auditedDMAdminImplCodeHash.Hex() +
	"; established 2026-07-30, recon/derivation-notes.md). " + decodeAuthorityCertifies

// codeSurfaceObservation is ONE surface's two-pin observation: the keccak of
// the code bytes at each pin, plus the byte lengths (an empty read never
// reaches a hash — the reader refuses first, but the pure check re-refuses so
// a fixture cannot smuggle an empty surface through).
type codeSurfaceObservation struct {
	Surface    string // "proxy" | "core-impl" | "admin-impl"
	Address    common.Address
	ParentHash common.Hash // keccak256(code@parentHash(N-1))
	ExecHash   common.Hash // keccak256(code@pinHash(N))
	ParentLen  int
	ExecLen    int
}

// codeHashConstancyRefusal is THE Fork-1 check (mutation target mA): every
// surface's code hash at BOTH pins must equal its audited constant, and no
// surface may be empty. Pure function, same shape as adminImplEpochRefusal,
// so the regression drives it directly and the mutation floor has a single
// behavioural cut point; runBacktestCase wiring is pinned by
// TestCodeHashCheckIsWiredIntoRunBacktestCase.
func codeHashConstancyRefusal(obs []codeSurfaceObservation) string {
	want := map[string]common.Hash{
		"proxy":      auditedDMProxyCodeHash,
		"core-impl":  auditedDMCoreImplCodeHash,
		"admin-impl": auditedDMAdminImplCodeHash,
	}
	seen := map[string]bool{}
	for _, o := range obs {
		audited, ok := want[o.Surface]
		if !ok {
			return fmt.Sprintf("DECODE-AUTHORITY EPOCH: unknown code surface %q — the conjunction is exactly {proxy, core-impl, admin-impl} and nothing else may impersonate a member", o.Surface)
		}
		seen[o.Surface] = true
		if o.ParentLen == 0 || o.ExecLen == 0 {
			return fmt.Sprintf("DECODE-AUTHORITY EPOCH: surface %s (%s) answered EMPTY code at a case pin (parent %d bytes, exec %d bytes) — an empty getCode is a refusal, never a zero-hash (chain-truth R12 Fork 1)", o.Surface, o.Address.Hex(), o.ParentLen, o.ExecLen)
		}
		if o.ParentHash != audited || o.ExecHash != audited {
			return fmt.Sprintf("DECODE-AUTHORITY EPOCH: surface %s (%s) code hash does not equal the AUDITED constant at both case pins — parent(N-1) %s, exec(N) %s, audited %s. The replay's decode semantics are anchored to the audited bytecode; a different hash at either pin means the events this case replays may have been emitted by DIFFERENT code, and a replay under the wrong generation's semantics proves nothing. The case REFUSES — a real epoch boundary requiring chain-truth adjudication and a consciously re-established pin, never a verdict (chain-truth R12 Fork 1)", o.Surface, o.Address.Hex(), o.ParentHash.Hex(), o.ExecHash.Hex(), audited.Hex())
		}
	}
	for _, s := range []string{"proxy", "core-impl", "admin-impl"} {
		if !seen[s] {
			return fmt.Sprintf("DECODE-AUTHORITY EPOCH: surface %s was NOT observed — the three-surface conjunction is the law (proxy, core-impl, admin-impl; chain-truth R12: pinning only the admin closes half the finding), and an unobserved surface refuses exactly like a mismatched one", s)
		}
	}
	return ""
}

// headCodeHashRefusal is the RUN-level head check: the same three surfaces at
// the run's own head pin. A mismatch here is preflightExit POSTURE (the
// ruling's words): the whole gate's decode authority is stale, so every case
// refuses with the head epoch named — reported as a gated frame failure,
// never a shrunk N and never a verdict.
func headCodeHashRefusal(obs []codeSurfaceObservation) string {
	// The head observation reuses the two-pin shape with both pins = the head
	// pin, so the SAME pure check applies (one law, one cut point).
	return codeHashConstancyRefusal(obs)
}

// --- the raw evidence plumbing (eth_getCode / eth_getStorageAt / block bodies) ---

// rawCodeBackend answers the Fork-1 questions: code bytes and one storage
// word, both EIP-1898 blockHash-pinned. Production is pinnedEvidenceReader
// (live endpoints, shared runner); the hermetic suite is the captured backend
// — BOTH feed the same keccak + pure-check path.
type rawCodeBackend interface {
	codeAtHash(ctx context.Context, op string, addr common.Address, blockHash common.Hash) ([]byte, error)
	storageAtHash(ctx context.Context, op string, addr common.Address, slot common.Hash, blockHash common.Hash) (common.Hash, error)
}

// rawTraceBackend answers the Step-A question: the callTracer block trace at
// a stored pin (debug_traceBlockByHash(pin, {tracer: callTracer})), raw
// provider bytes. Step B's block-body form was NOT implemented: the Step-A
// probe fired SERVED (recon/p3-probes.md), so the trace law is the landed
// fork and the calldata-substring scan never exists to be confused with it.
type rawTraceBackend interface {
	traceBlockByHash(ctx context.Context, op string, blockHash common.Hash) ([]byte, error)
}

// pinnedEvidenceReader is the production backend for both: raw JSON-RPC
// clients dialed from the SAME URL list as the pinned reader
// (SOLVENT_RECON_RPC_OP family), walked in order per attempt under the shared
// runner — the same entry-point posture as pinnedLogsReader.
type pinnedEvidenceReader struct {
	name    string
	clients []*gethrpc.Client
	run     *rpcRunner
}

// dialPinnedEvidence dials every URL; a URL that does not dial is an error
// now rather than a silent hole in the failover walk.
func dialPinnedEvidence(ctx context.Context, name string, urls []string, run *rpcRunner) (*pinnedEvidenceReader, error) {
	if len(urls) == 0 {
		return nil, fmt.Errorf("dial %s evidence: no endpoints configured", name)
	}
	r := &pinnedEvidenceReader{name: name, run: run}
	for i, u := range urls {
		c, err := gethrpc.DialContext(ctx, u)
		if err != nil {
			for _, cc := range r.clients {
				cc.Close()
			}
			return nil, fmt.Errorf("dial %s evidence endpoint %d: %w", name, i, err)
		}
		r.clients = append(r.clients, c)
	}
	return r, nil
}

// walk runs one JSON-RPC question across the endpoint walk under the shared
// runner, refusing null/empty answers (a non-answer must not impersonate one).
func (r *pinnedEvidenceReader) walk(ctx context.Context, op, method string, check func(raw string) error, args ...any) (string, error) {
	if err := snapshotdb.Gate().Violation(method + ":" + op); err != nil {
		return "", err
	}
	var out string
	_, err := r.run.run(ctx, r.name, op, func(ctx context.Context) (chain.EndpointToken, error) {
		var walkErrs []string
		for i, c := range r.clients {
			var raw string
			err := c.CallContext(ctx, &raw, method, args...)
			if err == nil {
				if strings.TrimSpace(raw) == "" {
					walkErrs = append(walkErrs, fmt.Sprintf("endpoint %d: empty %s result (protocol violation)", i, method))
					continue
				}
				if cerr := check(raw); cerr != nil {
					walkErrs = append(walkErrs, fmt.Sprintf("endpoint %d: %v", i, cerr))
					continue
				}
				out = raw
				return chain.EndpointToken{Index: i}, nil
			}
			walkErrs = append(walkErrs, fmt.Sprintf("endpoint %d: %v", i, err))
		}
		return chain.EndpointToken{Index: -1}, fmt.Errorf("%s: every endpoint failed: %s", op, strings.Join(walkErrs, " | "))
	})
	if err != nil {
		return "", err
	}
	return out, nil
}

func (r *pinnedEvidenceReader) codeAtHash(ctx context.Context, op string, addr common.Address, blockHash common.Hash) ([]byte, error) {
	raw, err := r.walk(ctx, op, "eth_getCode", func(raw string) error {
		if !strings.HasPrefix(raw, "0x") {
			return fmt.Errorf("eth_getCode answered %q — not 0x-prefixed hex", raw)
		}
		return nil
	}, addr, map[string]any{"blockHash": strings.ToLower(blockHash.Hex())})
	if err != nil {
		return nil, err
	}
	return common.FromHex(raw), nil
}

func (r *pinnedEvidenceReader) storageAtHash(ctx context.Context, op string, addr common.Address, slot common.Hash, blockHash common.Hash) (common.Hash, error) {
	raw, err := r.walk(ctx, op, "eth_getStorageAt", func(raw string) error {
		if len(common.FromHex(raw)) != 32 {
			return fmt.Errorf("eth_getStorageAt answered %q — not one 32-byte storage word", raw)
		}
		return nil
	}, addr, slot, map[string]any{"blockHash": strings.ToLower(blockHash.Hex())})
	if err != nil {
		return common.Hash{}, err
	}
	return common.BytesToHash(common.FromHex(raw)), nil
}

// traceBlockByHash serves the Step-A trace question through the SAME walk
// posture: raw provider bytes, null refused as a non-answer. The probe
// showed SOLVENT_RECON_RPC_OP[0] refuses debug_ methods while [1] serves
// them — exactly what the ordered walk exists for: the refusing endpoint is
// a recorded walk error, the serving one answers.
func (r *pinnedEvidenceReader) traceBlockByHash(ctx context.Context, op string, blockHash common.Hash) ([]byte, error) {
	if err := snapshotdb.Gate().Violation("debug_traceBlockByHash:" + op); err != nil {
		return nil, err
	}
	var out []byte
	_, err := r.run.run(ctx, r.name, op, func(ctx context.Context) (chain.EndpointToken, error) {
		var walkErrs []string
		for i, c := range r.clients {
			var raw jsonRawCopy
			err := c.CallContext(ctx, &raw, "debug_traceBlockByHash",
				strings.ToLower(blockHash.Hex()), map[string]any{"tracer": "callTracer"})
			if err == nil {
				if len(raw) == 0 || string(raw) == "null" {
					// null means "no such block" — for a STORED custody pin
					// that is a provider non-answer, never an empty trace.
					walkErrs = append(walkErrs, fmt.Sprintf("endpoint %d: null debug_traceBlockByHash result for a stored pin (non-answer)", i))
					continue
				}
				out = raw
				return chain.EndpointToken{Index: i}, nil
			}
			walkErrs = append(walkErrs, fmt.Sprintf("endpoint %d: %v", i, err))
		}
		return chain.EndpointToken{Index: -1}, fmt.Errorf("%s: every endpoint failed: %s", op, strings.Join(walkErrs, " | "))
	})
	if err != nil {
		return nil, err
	}
	return out, nil
}

// jsonRawCopy is a raw JSON capture target (json.RawMessage under a local
// name so the geth rpc client unmarshals into it verbatim).
type jsonRawCopy []byte

func (j *jsonRawCopy) UnmarshalJSON(b []byte) error {
	*j = append((*j)[:0], b...)
	return nil
}

// readCodeSurfaces takes the Fork-1 observation set for one case: the three
// surfaces at both pins, through the SAME backend production and the
// hermetic suite share. Any read failure returns an error — the caller
// refuses the case as unread (a pin that cannot be taken certifies nothing).
func readCodeSurfaces(ctx context.Context, backend rawCodeBackend, opPrefix string,
	dmProxy common.Address, parentHash, pinHash common.Hash) ([]codeSurfaceObservation, error) {
	read := func(surface string, addr common.Address) (codeSurfaceObservation, error) {
		p, err := backend.codeAtHash(ctx, opPrefix+":code:"+surface+"@parent", addr, parentHash)
		if err != nil {
			return codeSurfaceObservation{}, fmt.Errorf("surface %s: eth_getCode@parentHash: %w", surface, err)
		}
		e, err := backend.codeAtHash(ctx, opPrefix+":code:"+surface+"@pin", addr, pinHash)
		if err != nil {
			return codeSurfaceObservation{}, fmt.Errorf("surface %s: eth_getCode@pinHash: %w", surface, err)
		}
		o := codeSurfaceObservation{Surface: surface, Address: addr, ParentLen: len(p), ExecLen: len(e)}
		if len(p) > 0 {
			o.ParentHash = crypto.Keccak256Hash(p)
		}
		if len(e) > 0 {
			o.ExecHash = crypto.Keccak256Hash(e)
		}
		return o, nil
	}
	proxy, err := read("proxy", dmProxy)
	if err != nil {
		return nil, err
	}
	// The core impl: the ERC1967 slot is read at BOTH pins (the two-pin
	// discipline), each pin's code read at the address THAT pin resolves — a
	// mid-frame impl-address move with identical bytes still passes the hash
	// law (the certification is bytecode constancy), while a move to
	// different bytes refuses on the hash.
	pImplWord, err := backend.storageAtHash(ctx, opPrefix+":implslot@parent", dmProxy, erc1967ImplSlot, parentHash)
	if err != nil {
		return nil, fmt.Errorf("ERC1967 impl slot @parentHash: %w", err)
	}
	eImplWord, err := backend.storageAtHash(ctx, opPrefix+":implslot@pin", dmProxy, erc1967ImplSlot, pinHash)
	if err != nil {
		return nil, fmt.Errorf("ERC1967 impl slot @pinHash: %w", err)
	}
	pImpl := common.BytesToAddress(pImplWord[12:])
	eImpl := common.BytesToAddress(eImplWord[12:])
	if pImpl == (common.Address{}) || eImpl == (common.Address{}) {
		return nil, fmt.Errorf("ERC1967 impl slot resolved a ZERO address (parent %s, exec %s) — an uninitialized proxy word is a refusal, never a surface", pImpl.Hex(), eImpl.Hex())
	}
	pCore, err := backend.codeAtHash(ctx, opPrefix+":code:core-impl@parent", pImpl, parentHash)
	if err != nil {
		return nil, fmt.Errorf("surface core-impl: eth_getCode@parentHash: %w", err)
	}
	eCore, err := backend.codeAtHash(ctx, opPrefix+":code:core-impl@pin", eImpl, pinHash)
	if err != nil {
		return nil, fmt.Errorf("surface core-impl: eth_getCode@pinHash: %w", err)
	}
	core := codeSurfaceObservation{Surface: "core-impl", Address: eImpl, ParentLen: len(pCore), ExecLen: len(eCore)}
	if len(pCore) > 0 {
		core.ParentHash = crypto.Keccak256Hash(pCore)
	}
	if len(eCore) > 0 {
		core.ExecHash = crypto.Keccak256Hash(eCore)
	}
	admin, err := read("admin-impl", auditedDMAdminImpl)
	if err != nil {
		return nil, err
	}
	return []codeSurfaceObservation{proxy, core, admin}, nil
}
