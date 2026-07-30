package main

// OPT-IN LIVE surface for the R12 admin-epoch wave (chain-truth R12 ruling,
// ADDENDUM 2 of .superpowers/sdd/p3-consults/chain-truth-basket-continuity-ruling.md).
//
// THREE test families live here:
//
//  1. THE FORK-1 PROBE (TestLiveCodeHashGetCodeProbe): the ruling's own
//     precondition — "eth_getCode (EIP-1898 blockHash form — probe it first,
//     transcribed, both SOLVENT_RECON_RPC_OP endpoints at frame depth)".
//     eth_getCode was NEVER issued by this repo before this wave (the pinned
//     reader serves eth_call/multicall only), so the blockHash form is
//     unprobed plumbing exactly like the L6 getLogs form was. Each endpoint
//     is asked SEPARATELY; pins are the frozen frame's STORED raw_logs
//     hashes; observed numbers (code length, keccak) are transcribed to
//     recon/p3-probes.md. This probe IS also the dual-provider ESTABLISHMENT
//     read for the three audited code-hash constants (head + two frame-depth
//     pins × both endpoints × three surfaces): the constants in
//     code_epoch.go are pinned from what this probe observes, recorded in
//     recon/derivation-notes.md.
//
//  2. THE STEP-A PROBE (TestLiveTraceBlockProbe): debug_traceBlockByHash +
//     callTracer at frame depth, both endpoints, transcribed. Served ⇒ the
//     trace law (Step A) implements and D-013's residual RETIRES; unserved ⇒
//     Step B (the calldata-selector scan) with the residual DISCLOSED.
//
//  3. THE CAPTURE EXTENSION lives in p3_continuity_live_test.go (the one
//     capture harness): per-case getCode/impl-slot words and the full-tx
//     block bodies join the existing continuity capture.
//
// Endpoints are reported by env-var name + ordinal ONLY — never by URL
// (house secrets law); error text is sanitized through sanitizeEndpointErr.

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/crypto"
	gethrpc "github.com/ethereum/go-ethereum/rpc"
	"github.com/stretchr/testify/require"
)

// epochProbeURLs reads the SOLVENT_RECON_RPC_OP list (the ruling names THIS
// env family).
func epochProbeURLs(t *testing.T) []string {
	t.Helper()
	raw := strings.TrimSpace(os.Getenv("SOLVENT_RECON_RPC_OP"))
	require.NotEmpty(t, raw, "SOLVENT_RECON_RPC_OP must be set: the R12 probes are about THIS env family")
	var urls []string
	for _, u := range strings.Split(raw, ",") {
		if u = strings.TrimSpace(u); u != "" {
			urls = append(urls, u)
		}
	}
	return urls
}

// sanitizeEndpointErr strips every configured URL from an error string so a
// transcript can never leak an endpoint (house secrets law: env-var name +
// ordinal only).
func sanitizeEndpointErr(err error, urls []string) string {
	if err == nil {
		return ""
	}
	s := err.Error()
	for i, u := range urls {
		s = strings.ReplaceAll(s, u, fmt.Sprintf("SOLVENT_RECON_RPC_OP[%d]", i))
		// Also strip a scheme-stripped or trailing-slash variant.
		s = strings.ReplaceAll(s, strings.TrimRight(u, "/"), fmt.Sprintf("SOLVENT_RECON_RPC_OP[%d]", i))
	}
	return s
}

// epochProbePins returns the two frame-depth pins the establishment reads use:
// the deepest frozen pin (block 150,057,202 — B0's first case) and the era's
// last pin (block 153,399,414 — the force-included singleton), both by STORED
// raw_logs hash, never a number→hash resolution.
func epochProbePins(t *testing.T) []backtestCase {
	t.Helper()
	var singleton *backtestCase
	for i := range backtestFrame {
		if strings.Contains(backtestFrame[i].Selection, "singleton") && backtestFrame[i].Block == 153399414 {
			singleton = &backtestFrame[i]
		}
	}
	require.NotNil(t, singleton, "the frozen frame carries the 153,399,414 singleton by identity")
	first := backtestFrame[0]
	require.Equal(t, uint64(150057202), first.Block, "backtestFrame[0] is the deepest pin")
	return []backtestCase{first, *singleton}
}

// rawGetCode issues one EIP-1898 eth_getCode and decodes the hex answer.
func rawGetCode(ctx context.Context, c *gethrpc.Client, addr common.Address, blockArg any) ([]byte, error) {
	var out string
	if err := c.CallContext(ctx, &out, "eth_getCode", addr, blockArg); err != nil {
		return nil, err
	}
	if !strings.HasPrefix(out, "0x") {
		return nil, fmt.Errorf("eth_getCode answered %q — not 0x-prefixed hex", out)
	}
	return common.FromHex(out), nil
}

// TestLiveCodeHashGetCodeProbe is the Fork-1 Step-1 gate AND the audited-
// constant establishment read. Per configured endpoint (separately), at the
// two frame-depth stored pins AND at head ("latest"):
//
//	q1: eth_getCode(DM proxy, {blockHash: storedPin}) — the EIP-1898 form the
//	    production pin issues; must be non-empty; cross-checked byte-for-byte
//	    against the number-form answer (the equivalence check L6 ran for
//	    getLogs).
//	q2: eth_getStorageAt(DM proxy, ERC1967 impl slot, {blockHash: storedPin})
//	    → the core implementation address, then eth_getCode of THAT address.
//	q3: eth_getCode(audited admin impl, {blockHash: storedPin}).
//
// Every surface's keccak must agree across endpoints × pins × head — a
// disagreement is a STOP (a REAL mid-frame upgrade or a provider fork),
// reported, never absorbed.
func TestLiveCodeHashGetCodeProbe(t *testing.T) {
	requireLive(t)
	urls := epochProbeURLs(t)
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Minute)
	defer cancel()
	pins := epochProbePins(t)

	type surfaceObs struct{ hashes map[string]bool }
	obs := map[string]*surfaceObs{
		"proxy": {hashes: map[string]bool{}},
		"core":  {hashes: map[string]bool{}},
		"admin": {hashes: map[string]bool{}},
	}
	implAddrs := map[string]bool{}

	for i, u := range urls {
		name := fmt.Sprintf("SOLVENT_RECON_RPC_OP[%d]", i)
		t.Run(name, func(t *testing.T) {
			c, err := gethrpc.DialContext(ctx, u)
			require.NoError(t, err, "%s: dial", name)
			defer c.Close()
			pace := func() { time.Sleep(400 * time.Millisecond) }

			blockArgs := []struct {
				label string
				arg   any
				numHx string
			}{
				{fmt.Sprintf("%d(0x%s…)", pins[0].Block, strings.TrimPrefix(pins[0].BlockHash, "0x")[:8]), blockHashArg(common.HexToHash(pins[0].BlockHash)), fmt.Sprintf("0x%x", pins[0].Block)},
				{fmt.Sprintf("%d(0x%s…)", pins[1].Block, strings.TrimPrefix(pins[1].BlockHash, "0x")[:8]), blockHashArg(common.HexToHash(pins[1].BlockHash)), fmt.Sprintf("0x%x", pins[1].Block)},
				{"head(latest)", "latest", ""},
			}
			for _, ba := range blockArgs {
				// q1: the proxy surface, EIP-1898 blockHash form.
				pace()
				proxyCode, err := rawGetCode(ctx, c, liveDMProxy, ba.arg)
				require.NoError(t, err, "%s @%s: blockHash-form eth_getCode(DM proxy) — if this is a refusal, the endpoint does NOT serve EIP-1898 getCode at frame depth: %s", name, ba.label, sanitizeEndpointErr(err, urls))
				require.NotEmpty(t, proxyCode, "%s @%s: empty proxy code — a refusal, never a zero-hash", name, ba.label)
				proxyHash := crypto.Keccak256Hash(proxyCode)
				obs["proxy"].hashes[proxyHash.Hex()] = true

				// Cross-check: number form answers the SAME bytes (hash-form
				// equivalence, the L6 discipline applied to getCode).
				if ba.numHx != "" {
					pace()
					numCode, err := rawGetCode(ctx, c, liveDMProxy, ba.numHx)
					require.NoError(t, err, "%s @%s: number-form eth_getCode cross-check", name, ba.label)
					require.Equal(t, crypto.Keccak256Hash(numCode), proxyHash,
						"%s @%s: blockHash-form and number-form eth_getCode answered DIFFERENT bytes", name, ba.label)
				}

				// q2: the ERC1967 core implementation surface.
				pace()
				var slotHex string
				require.NoError(t, c.CallContext(ctx, &slotHex, "eth_getStorageAt", liveDMProxy, erc1967ImplSlot, ba.arg),
					"%s @%s: eth_getStorageAt(ERC1967 impl slot)", name, ba.label)
				slotWord := common.FromHex(slotHex)
				require.Len(t, slotWord, 32, "%s @%s: the impl slot answer is one storage word", name, ba.label)
				implAddr := common.BytesToAddress(slotWord[12:])
				require.NotEqual(t, common.Address{}, implAddr, "%s @%s: zero impl address — the proxy would be uninitialized, which is impossible here", name, ba.label)
				implAddrs[implAddr.Hex()] = true
				pace()
				coreCode, err := rawGetCode(ctx, c, implAddr, ba.arg)
				require.NoError(t, err, "%s @%s: eth_getCode(core impl %s)", name, ba.label, implAddr.Hex())
				require.NotEmpty(t, coreCode, "%s @%s: empty core impl code", name, ba.label)
				coreHash := crypto.Keccak256Hash(coreCode)
				obs["core"].hashes[coreHash.Hex()] = true

				// q3: the admin implementation surface.
				pace()
				adminCode, err := rawGetCode(ctx, c, auditedDMAdminImpl, ba.arg)
				require.NoError(t, err, "%s @%s: eth_getCode(admin impl)", name, ba.label)
				require.NotEmpty(t, adminCode, "%s @%s: empty admin impl code", name, ba.label)
				adminHash := crypto.Keccak256Hash(adminCode)
				obs["admin"].hashes[adminHash.Hex()] = true

				t.Logf("%s @%s: proxy len=%d keccak=%s | impl=%s core len=%d keccak=%s | admin len=%d keccak=%s",
					name, ba.label, len(proxyCode), proxyHash.Hex(), implAddr.Hex(), len(coreCode), coreHash.Hex(), len(adminCode), adminHash.Hex())
			}
		})
	}

	// Constancy across every read: ONE hash per surface, ONE impl address.
	for surface, o := range obs {
		require.Len(t, o.hashes, 1,
			"STOP: surface %q observed %d DISTINCT code hashes across endpoints × pins × head (%v) — a real mid-frame upgrade or a provider fork; adjudicate, never absorb", surface, len(o.hashes), o.hashes)
	}
	require.Len(t, implAddrs, 1, "STOP: the ERC1967 impl slot resolved %d distinct addresses (%v)", len(implAddrs), implAddrs)

	// The establishment cross-pin: the observed hashes must equal the audited
	// constants pinned in code_epoch.go (after the first establishment run
	// records them; a later drift is a REAL epoch and must STOP here).
	for surface, want := range map[string]common.Hash{
		"proxy": auditedDMProxyCodeHash,
		"core":  auditedDMCoreImplCodeHash,
		"admin": auditedDMAdminImplCodeHash,
	} {
		if want == (common.Hash{}) {
			t.Logf("surface %q: audited constant not yet pinned — establishment run; record the observed hash", surface)
			continue
		}
		require.True(t, obs[surface].hashes[want.Hex()],
			"STOP: surface %q observed %v, but the audited constant is %s — a real epoch boundary; re-audit and re-pin consciously", surface, obs[surface].hashes, want.Hex())
	}
}

// TestLiveTraceBlockProbe is the Fork-2 Step-A gate: debug_traceBlockByHash +
// callTracer at frame depth, each endpoint separately, transcribed. This test
// NEVER fails on an unserved method — the ruling's fork is A-if-served,
// B-otherwise, so the probe's job is the OBSERVATION, loudly logged for the
// recon/p3-probes.md transcript. It fails only on transport-level breakage
// (cannot dial), which would make the observation itself untrustworthy.
func TestLiveTraceBlockProbe(t *testing.T) {
	requireLive(t)
	urls := epochProbeURLs(t)
	ctx, cancel := context.WithTimeout(context.Background(), 6*time.Minute)
	defer cancel()
	pins := epochProbePins(t)

	for i, u := range urls {
		name := fmt.Sprintf("SOLVENT_RECON_RPC_OP[%d]", i)
		t.Run(name, func(t *testing.T) {
			c, err := gethrpc.DialContext(ctx, u)
			require.NoError(t, err, "%s: dial", name)
			defer c.Close()
			for _, fc := range pins {
				time.Sleep(400 * time.Millisecond)
				var raw json.RawMessage
				err := c.CallContext(ctx, &raw, "debug_traceBlockByHash",
					strings.ToLower(fc.BlockHash), map[string]any{"tracer": "callTracer"})
				if err != nil {
					t.Logf("%s @%d: debug_traceBlockByHash+callTracer UNSERVED: %s", name, fc.Block, sanitizeEndpointErr(err, urls))
					continue
				}
				var frames []json.RawMessage
				if uerr := json.Unmarshal(raw, &frames); uerr != nil {
					t.Logf("%s @%d: debug_traceBlockByHash answered but does not decode as a trace array (%v) — treated as UNSERVED", name, fc.Block, uerr)
					continue
				}
				t.Logf("%s @%d: debug_traceBlockByHash+callTracer SERVED — %d tx trace(s)", name, fc.Block, len(frames))
			}
		})
	}
}
