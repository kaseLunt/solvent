package main

// OPT-IN LIVE surface for the L2 basket-continuity wave (chain-truth
// basket-continuity ruling, L6/L7).
//
// TWO test families live here:
//
//  1. THE L6 PROBE (TestLiveL6BlockHashGetLogsProbe): the ruling's own
//     precondition — "Before the wave cuts: a transcribed probe that the
//     configured SOLVENT_RECON_RPC_OP endpoints serve the blockHash form of
//     eth_getLogs at frame-era depth ... Observed numbers or it didn't
//     happen." The foundation served RANGE-form getLogs for the whole
//     backfill (ledger), but the EIP-234 blockHash form was unprobed and no
//     getLogs helper existed in cmd/reconcile at all. The probe asks each
//     configured endpoint SEPARATELY (production failover would mask a
//     one-endpoint capability hole), pins one of the 31 frozen cases' STORED
//     raw_logs hashes, and cross-checks the blockHash answer against the
//     equivalent single-block range answer log-by-log. Endpoints are
//     reported by env-var name + ordinal ONLY — never by URL (house secrets
//     law).
//
//  2. THE L7 CAPTURE (TestLiveCaptureContinuityFixtures): re-runs the exact
//     production read set per frozen case against the live endpoints
//     (READ-ONLY) and commits the raw envelopes + call words to
//     testdata/continuity/, where the hermetic suite replays them through
//     the SAME strict decode path. Gated separately so a probe run cannot
//     accidentally rewrite fixtures.
//
// Opt-in: SOLVENT_P3_LIVE=1 (probe) / SOLVENT_P3_CONTINUITY_CAPTURE=1
// (capture) plus SOLVENT_RECON_RPC_OP. Unset ⇒ SKIP; once opted in it FAILS
// rather than skips (the house law for opt-in harnesses).

import (
	"bytes"
	"compress/gzip"
	"context"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"math/big"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/ethereum/go-ethereum/common"
	gethrpc "github.com/ethereum/go-ethereum/rpc"
	"github.com/stretchr/testify/require"

	"github.com/kaselunt/solvent/cmd/reconcile/snapshotdb"
)

// l6ProbeLog is the probe's MINIMAL wire decode: enough to count, echo-check
// and identity-compare. The production sweep uses the strict presence-gated
// decoder in basket_continuity.go; the probe deliberately reads the same raw
// wire shape so a provider that omits fields is VISIBLE here too.
type l6ProbeLog struct {
	Address   string   `json:"address"`
	Topics    []string `json:"topics"`
	Data      string   `json:"data"`
	BlockHash string   `json:"blockHash"`
	TxHash    string   `json:"transactionHash"`
	LogIndex  string   `json:"logIndex"`
}

// l6Identity renders one log's comparison identity for the hash-vs-range
// cross-check.
func l6Identity(l l6ProbeLog) string {
	return strings.ToLower(l.LogIndex + "|" + l.Address + "|" + strings.Join(l.Topics, ",") + "|" + l.Data)
}

func l6GetLogs(ctx context.Context, t *testing.T, c *gethrpc.Client, arg map[string]any) ([]l6ProbeLog, error) {
	t.Helper()
	var raw json.RawMessage
	if err := c.CallContext(ctx, &raw, "eth_getLogs", arg); err != nil {
		return nil, err
	}
	if len(raw) == 0 || string(raw) == "null" {
		return nil, fmt.Errorf("null result — a provider non-answer, not an empty window")
	}
	var logs []l6ProbeLog
	if err := json.Unmarshal(raw, &logs); err != nil {
		return nil, err
	}
	return logs, nil
}

// TestLiveL6BlockHashGetLogsProbe is the ruling's Step-0 gate. Per configured
// SOLVENT_RECON_RPC_OP endpoint, per probed frozen case:
//
//	q1: eth_getLogs{blockHash: storedPin, address: [DebtManager proxy]}
//	q2: eth_getLogs{fromBlock: N, toBlock: N, address: [DebtManager proxy]}
//	    — the range-form cross-check; the two answers must agree log-by-log
//	q3: eth_getLogs{blockHash: storedPin, address: [proxy], topics: [[Liquidated]]}
//	    — proves the topics filter composes with the blockHash form; must
//	    contain the case's own event at its stored log_index
//	q4: eth_getLogs{blockHash: storedPin, address: [CashEventEmitter]} and its
//	    range twin — the netting-sweep address at frame-era depth
func TestLiveL6BlockHashGetLogsProbe(t *testing.T) {
	requireLive(t)
	raw := strings.TrimSpace(os.Getenv("SOLVENT_RECON_RPC_OP"))
	require.NotEmpty(t, raw, "SOLVENT_RECON_RPC_OP must be set: the ruling's L6 probe is about THIS env family")
	var urls []string
	for _, u := range strings.Split(raw, ",") {
		if u = strings.TrimSpace(u); u != "" {
			urls = append(urls, u)
		}
	}
	ctx, cancel := context.WithTimeout(context.Background(), 6*time.Minute)
	defer cancel()

	// Two frozen cases spanning the era: the first case of B0 (the deepest
	// pin) and the force-included two-pass pair's block in B4, selected by
	// its committed selection tag rather than a positional index.
	var twoPass *backtestCase
	for i := range backtestFrame {
		if strings.Contains(backtestFrame[i].Selection, "two-pass") {
			twoPass = &backtestFrame[i]
			break
		}
	}
	require.NotNil(t, twoPass)
	probeCases := []backtestCase{backtestFrame[0], *twoPass}
	require.Equal(t, uint64(150057202), probeCases[0].Block)
	require.Equal(t, uint64(152007376), probeCases[1].Block)

	for i, u := range urls {
		name := fmt.Sprintf("SOLVENT_RECON_RPC_OP[%d]", i)
		t.Run(name, func(t *testing.T) {
			c, err := gethrpc.DialContext(ctx, u)
			require.NoError(t, err, "%s: dial", name)
			defer c.Close()
			for _, fc := range probeCases {
				pin := strings.ToLower(fc.BlockHash)
				blockArg := fmt.Sprintf("0x%x", fc.Block)
				pace := func() { time.Sleep(400 * time.Millisecond) }

				// q1: the EIP-234 blockHash form, DM proxy.
				pace()
				hashLogs, err := l6GetLogs(ctx, t, c, map[string]any{
					"blockHash": pin, "address": []string{liveDMProxy.Hex()},
				})
				require.NoError(t, err, "%s: blockHash-form eth_getLogs at %d — if this is a refusal, the endpoint does NOT serve EIP-234 at frame-era depth", name, fc.Block)
				for _, l := range hashLogs {
					require.Equal(t, pin, strings.ToLower(l.BlockHash),
						"%s: blockHash echo must equal the requested stored pin", name)
				}

				// q2: the equivalent single-block range form (the ledger-proven
				// family) as the cross-check.
				pace()
				rangeLogs, err := l6GetLogs(ctx, t, c, map[string]any{
					"fromBlock": blockArg, "toBlock": blockArg, "address": []string{liveDMProxy.Hex()},
				})
				require.NoError(t, err, "%s: range-form cross-check at %d", name, fc.Block)
				require.Equal(t, len(rangeLogs), len(hashLogs),
					"%s: blockHash form answered a DIFFERENT count than the range form at %d — empty-when-range-form-isn't is the failure L6 names", name, fc.Block)
				rangeIDs := map[string]bool{}
				for _, l := range rangeLogs {
					rangeIDs[l6Identity(l)] = true
				}
				for _, l := range hashLogs {
					require.True(t, rangeIDs[l6Identity(l)],
						"%s: a blockHash-form log at %d is absent from the range-form answer (logIndex %s)", name, fc.Block, l.LogIndex)
				}

				// q3: topics compose with blockHash; the case's own Liquidated
				// must be present at its stored log_index.
				pace()
				liqLogs, err := l6GetLogs(ctx, t, c, map[string]any{
					"blockHash": pin, "address": []string{liveDMProxy.Hex()},
					"topics": [][]string{{"0x" + topicDMLiquidated}},
				})
				require.NoError(t, err, "%s: blockHash+topics form at %d", name, fc.Block)
				wantIdx := fmt.Sprintf("0x%x", fc.LogIndex)
				found := false
				for _, l := range liqLogs {
					if strings.EqualFold(l.LogIndex, wantIdx) {
						found = true
					}
				}
				require.True(t, found,
					"%s: the case's own Liquidated (logIndex %d) is missing from the blockHash+topic0 answer at %d", name, fc.LogIndex, fc.Block)

				// q4: the CashEventEmitter address (netting sweep (c)) in both
				// forms — counts must agree (zero is an honest answer only if
				// BOTH forms say zero).
				pace()
				emitHash, err := l6GetLogs(ctx, t, c, map[string]any{
					"blockHash": pin, "address": []string{cashEventEmitterOP.Hex()},
				})
				require.NoError(t, err, "%s: blockHash-form emitter query at %d", name, fc.Block)
				pace()
				emitRange, err := l6GetLogs(ctx, t, c, map[string]any{
					"fromBlock": blockArg, "toBlock": blockArg, "address": []string{cashEventEmitterOP.Hex()},
				})
				require.NoError(t, err, "%s: range-form emitter cross-check at %d", name, fc.Block)
				require.Equal(t, len(emitRange), len(emitHash),
					"%s: emitter counts disagree between forms at %d", name, fc.Block)

				sample := "(no logs)"
				if len(hashLogs) > 0 {
					sample = hashLogs[0].BlockHash
				}
				t.Logf("%s @%d (pin %s): DM-proxy hash-form %d logs / range-form %d; Liquidated-topic %d (case log_index %d present); emitter hash-form %d / range-form %d; sample echo %s",
					name, fc.Block, pin, len(hashLogs), len(rangeLogs), len(liqLogs), fc.LogIndex, len(emitHash), len(emitRange), sample)
			}
		})
	}
}

// --- the L7 capture ---------------------------------------------------------

// continuityCapture is one frozen case's committed chain evidence: the RAW
// getLogs envelopes and eth_call return words the hermetic suite replays
// through the SAME strict decode path production uses, plus the proof outcome
// observed at capture time (pinned by basket_continuity_captured_test.go so
// the behavior over real chain data cannot drift silently).
type continuityCapture struct {
	Case        string `json:"case"`
	Block       uint64 `json:"block_number"`
	LogIndex    uint32 `json:"log_index"`
	Pin         string `json:"pin"`
	TxHash      string `json:"tx_hash"`
	Account     string `json:"account"`
	CapturedAt  string `json:"captured_at"`
	EndpointEnv string `json:"endpoint_env"`
	ParentHash  string `json:"parent_hash"`

	// Call words (hex; the capture ran the production decode once to prove
	// they decode, and the hermetic suite decodes them again).
	ParentCollateralRet string `json:"parent_collateral_ret"`
	ExecCollateralRet   string `json:"exec_collateral_ret"`
	// The supported-collateral enumerations at both pins (addendum
	// adjustment 1): getCollateralTokens()@parentHash(N-1) and @pinHash(N) —
	// their union is the swept address list.
	ParentSupportedRet string `json:"parent_supported_ret"`
	ExecSupportedRet   string `json:"exec_supported_ret"`
	// The ADMIN_IMPL_POSITION reads at both pins (Codex round 11 H1,
	// admin_epoch.go): the core accessor's eth_call word AND the raw
	// eth_getStorageAt word, so the hermetic suite pins
	// accessor == slot == the audited constant on committed chain bytes
	// (TestCapturedAdminImplIsTheAuditedConstantAtBothPins).
	ParentAdminImplRet  string `json:"parent_admin_impl_ret"`
	ExecAdminImplRet    string `json:"exec_admin_impl_ret"`
	ParentAdminImplSlot string `json:"parent_admin_impl_slot"`
	ExecAdminImplSlot   string `json:"exec_admin_impl_slot"`

	// The R12 Fork-1 three-surface observation (code_epoch.go): the ERC1967
	// impl-slot words at both pins plus each surface's observed code keccak
	// and byte length at both pins, all taken through the PRODUCTION
	// readCodeSurfaces path at capture time. The full code BYTES are
	// committed ONCE per surface (testdata/code_epoch/*.hex — constancy is
	// the pinned fact, so per-case byte copies would be 31 identical files);
	// the hermetic suite re-runs readCodeSurfaces over those bytes + these
	// slot words and re-keccaks locally, so the production path is exercised
	// end-to-end without the network.
	ParentERC1967ImplSlot string                `json:"parent_erc1967_impl_slot"`
	ExecERC1967ImplSlot   string                `json:"exec_erc1967_impl_slot"`
	CodeSurfaces          []capturedCodeSurface `json:"code_surfaces"`

	// The R12 Fork-2 Step-A block trace: committed per DISTINCT block as
	// testdata/traces/<blockhash>.json.gz (raw provider bytes, gzip — the
	// loader gunzips to the EXACT bytes production consumed), with the scan
	// outcome pinned here.
	TraceFile string `json:"trace_file"`

	// Raw envelopes, verbatim provider bytes.
	DMLiquidatedEnvelope json.RawMessage `json:"dm_liquidated_envelope"`
	TransfersOutEnvelope json.RawMessage `json:"transfers_out_envelope"`
	TransfersInEnvelope  json.RawMessage `json:"transfers_in_envelope"`
	NettingEnvelope      json.RawMessage `json:"netting_envelope"`

	// The proof outcome at capture time.
	Expected struct {
		Proven   bool     `json:"proven"`
		Refusals []string `json:"refusals,omitempty"`
		// AdminScanClean / AdminScanRefusal pin the Step-A frame-scan
		// outcome over the committed trace (admin_trace.go).
		AdminScanClean   bool   `json:"admin_scan_clean"`
		AdminScanRefusal string `json:"admin_scan_refusal,omitempty"`
	} `json:"expected"`
}

// capturedCodeSurface is one surface's capture-time observation, mirroring
// codeSurfaceObservation with hex-rendered hashes.
type capturedCodeSurface struct {
	Surface    string `json:"surface"`
	Address    string `json:"address"`
	ParentHash string `json:"parent_keccak"`
	ExecHash   string `json:"exec_keccak"`
	ParentLen  int    `json:"parent_len"`
	ExecLen    int    `json:"exec_len"`
}

// recordingLogsBackend wraps the live backend and records each sweep's RAW
// answer by question class, so the committed envelope is BYTE-IDENTICAL to
// what production's assembler consumed.
type recordingLogsBackend struct {
	inner         rawLogsBackend
	out, inn, net json.RawMessage
}

func (r *recordingLogsBackend) rawLogsAtHash(ctx context.Context, op string, q logsQuery) (json.RawMessage, error) {
	raw, err := r.inner.rawLogsAtHash(ctx, op, q)
	if err != nil {
		return nil, err
	}
	switch {
	case strings.Contains(op, "transfers-out"):
		r.out = raw
	case strings.Contains(op, "transfers-in"):
		r.inn = raw
	default:
		r.net = raw
	}
	return raw, nil
}

// witnessFromSweptLog converts one swept DM log into the T6Witness shape the
// proof's attribution law consumes (the same fields the snapshot collector
// reads from raw_logs).
func witnessFromSweptLog(l sweptLog) snapshotdb.T6Witness {
	w := snapshotdb.T6Witness{
		LogIndex: uint32(l.LogIndex),
		Address:  hexLower(l.Address.Hex()),
		TxHash:   strings.TrimPrefix(strings.ToLower(l.TxHash.Hex()), "0x"),
		Data:     hex.EncodeToString(l.Data),
	}
	if len(l.Topics) > 0 {
		w.Topic0 = strings.TrimPrefix(strings.ToLower(l.Topics[0].Hex()), "0x")
	}
	pick := func(i int) string {
		if i < len(l.Topics) {
			return hex.EncodeToString(l.Topics[i][12:])
		}
		return ""
	}
	w.Topic1Addr, w.Topic2Addr, w.Topic3Addr = pick(1), pick(2), pick(3)
	return w
}

// continuityCaptureInputs rebuilds the proof inputs from a capture through
// the PRODUCTION decoders — shared by the capture writer (to record the
// expected outcome) and the hermetic replay test (to assert it).
func continuityCaptureInputs(t *testing.T, cap *continuityCapture) (*continuitySweep, []snapshotdb.T6Seizure, []snapshotdb.T6Witness) {
	t.Helper()
	pin := common.HexToHash(cap.Pin)
	safe := common.HexToAddress(cap.Account)

	parentRet, err := hex.DecodeString(strings.TrimPrefix(cap.ParentCollateralRet, "0x"))
	require.NoError(t, err)
	execRet, err := hex.DecodeString(strings.TrimPrefix(cap.ExecCollateralRet, "0x"))
	require.NoError(t, err)
	parentList, _, err := unpackTokenAmountList(dmCollateralOfABI, "collateralOf", parentRet)
	require.NoError(t, err, "case %s: parent collateralOf words must decode through the production unpacker", cap.Case)
	execList, _, err := unpackTokenAmountList(dmCollateralOfABI, "collateralOf", execRet)
	require.NoError(t, err, "case %s: exec collateralOf words must decode through the production unpacker", cap.Case)
	var parentLegs, execLegs []collateralLeg
	for _, l := range parentList {
		parentLegs = append(parentLegs, collateralLeg{token: l.Token, amount: l.Amount})
	}
	for _, l := range execList {
		execLegs = append(execLegs, collateralLeg{token: l.Token, amount: l.Amount})
	}

	// The supported-collateral sets at both pins (addendum adjustment 1),
	// through the SAME strict unpacker the frame decode layer uses. A capture
	// without them cannot rebuild the production question and must fail
	// loudly, never fall back to the narrower legs∪seized list.
	require.NotEmpty(t, cap.ParentSupportedRet,
		"case %s: capture predates adjustment 1 (no parent_supported_ret) — re-capture required", cap.Case)
	require.NotEmpty(t, cap.ExecSupportedRet,
		"case %s: capture predates adjustment 1 (no exec_supported_ret) — re-capture required", cap.Case)
	pSupRet, err := hex.DecodeString(strings.TrimPrefix(cap.ParentSupportedRet, "0x"))
	require.NoError(t, err)
	eSupRet, err := hex.DecodeString(strings.TrimPrefix(cap.ExecSupportedRet, "0x"))
	require.NoError(t, err)
	parentSupported, err := unpackAddressListStrict(dmGetCollateralTokensABI, "getCollateralTokens", pSupRet)
	require.NoError(t, err, "case %s: parent getCollateralTokens words must decode through the production unpacker", cap.Case)
	execSupported, err := unpackAddressListStrict(dmGetCollateralTokensABI, "getCollateralTokens", eSupRet)
	require.NoError(t, err, "case %s: exec getCollateralTokens words must decode through the production unpacker", cap.Case)

	// The case's own Liquidated (and every earlier-pass Liquidated witness)
	// from the captured DM envelope, through the strict envelope decode.
	dmLogs, err := decodeLogsEnvelope(cap.DMLiquidatedEnvelope)
	require.NoError(t, err)
	require.NoError(t, validateSweepAnswer(dmLogs, pin, []common.Address{liveDMProxy}))
	var seizures []snapshotdb.T6Seizure
	var witnesses []snapshotdb.T6Witness
	sawOwn := false
	for _, l := range dmLogs {
		w := witnessFromSweptLog(l)
		if l.LogIndex == uint64(cap.LogIndex) {
			sawOwn = true
			seized, derr := ownSeizures(w)
			require.NoError(t, derr, "case %s: the case's own Liquidated payload must decode", cap.Case)
			seizures = seized
			continue
		}
		if l.LogIndex < uint64(cap.LogIndex) {
			witnesses = append(witnesses, w)
		}
	}
	require.True(t, sawOwn, "case %s: the captured DM envelope must contain the case's own Liquidated at log_index %d", cap.Case, cap.LogIndex)

	backend := &fakeLogsBackend{out: cap.TransfersOutEnvelope, in: cap.TransfersInEnvelope, net: cap.NettingEnvelope}
	sw := assembleContinuitySweep(context.Background(), backend, newGateFrame(gateBacktest),
		cap.Case, pin, cap.Block, cap.LogIndex, common.HexToHash(cap.TxHash), safe,
		parentLegs, execLegs, parentSupported, execSupported, seizures)
	return sw, seizures, witnesses
}

// ownSeizures decodes the case's own Liquidated payload into T6Seizure rows.
func ownSeizures(w snapshotdb.T6Witness) ([]snapshotdb.T6Seizure, error) {
	seized, _, err := decodeWitnessLiquidated(w)
	if err != nil {
		return nil, err
	}
	var out []snapshotdb.T6Seizure
	for i, s := range seized {
		out = append(out, snapshotdb.T6Seizure{
			Seq: uint16(i), AssetHex: hexLower(s.Token.Hex()),
			Amount: s.Amount, Bonus: big.NewInt(0),
		})
	}
	return out, nil
}

// rawStorageAtHash reads ONE storage word via eth_getStorageAt in the
// EIP-1898 form (READ-ONLY), walking the dialed endpoints in order. It is
// capture-only plumbing: production cannot issue this method (the chainReader
// surface has no storage read — the implWitnessDeviation limitation), which
// is exactly why the capture cross-checks the production accessor against the
// raw slot here and commits both words.
func rawStorageAtHash(ctx context.Context, clients []*gethrpc.Client, addr common.Address, slot common.Hash, blockArg any) (string, error) {
	var errs []string
	for i, c := range clients {
		var out string
		if err := c.CallContext(ctx, &out, "eth_getStorageAt", addr, slot, blockArg); err != nil {
			errs = append(errs, fmt.Sprintf("endpoint %d: %v", i, err))
			continue
		}
		if strings.TrimSpace(out) == "" {
			errs = append(errs, fmt.Sprintf("endpoint %d: empty storage answer (protocol violation)", i))
			continue
		}
		return strings.ToLower(out), nil
	}
	return "", fmt.Errorf("eth_getStorageAt: every endpoint failed: %s", strings.Join(errs, " | "))
}

// blockHashArg renders the EIP-1898 blockHash block parameter.
func blockHashArg(h common.Hash) map[string]any {
	return map[string]any{"blockHash": strings.ToLower(h.Hex())}
}

// TestLiveCaptureContinuityFixtures runs the production read set per frozen
// case against the live endpoints (READ-ONLY: eth_call + eth_getLogs +
// eth_getStorageAt at stored pins) and commits the envelopes + call words +
// observed proof outcome to testdata/continuity/. Opt-in:
// SOLVENT_P3_CONTINUITY_CAPTURE=1.
func TestLiveCaptureContinuityFixtures(t *testing.T) {
	if os.Getenv("SOLVENT_P3_CONTINUITY_CAPTURE") == "" {
		t.Skip("SOLVENT_P3_CONTINUITY_CAPTURE unset: fixture capture is opt-in")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Minute)
	defer cancel()
	r := liveReader(t, "op", "SOLVENT_RECON_RPC_OP", "SOLVENT_RPC_OP")

	raw := strings.TrimSpace(os.Getenv("SOLVENT_RECON_RPC_OP"))
	require.NotEmpty(t, raw)
	var urls []string
	for _, u := range strings.Split(raw, ",") {
		if u = strings.TrimSpace(u); u != "" {
			urls = append(urls, u)
		}
	}
	logsR, err := dialPinnedLogs(ctx, "op", urls, newRPCRunner(1.5, 5, &rpcCallLog{}))
	require.NoError(t, err)

	// The R12 evidence reader — the PRODUCTION backend for the three-surface
	// code-hash pin and the Step-A block traces, so capture-time questions
	// are production's questions by construction.
	evR, err := dialPinnedEvidence(ctx, "op", urls, newRPCRunner(1.5, 5, &rpcCallLog{}))
	require.NoError(t, err)
	wroteSurfaceBytes := false
	writtenTraces := map[string]bool{}

	// Raw clients for the eth_getStorageAt cross-check (capture-only; see
	// rawStorageAtHash). Same URL list, endpoints named by env ordinal only.
	var storageClients []*gethrpc.Client
	for i, u := range urls {
		c, derr := gethrpc.DialContext(ctx, u)
		require.NoError(t, derr, "dial SOLVENT_RECON_RPC_OP[%d] for the storage cross-check", i)
		defer c.Close()
		storageClients = append(storageClients, c)
	}

	// THE AUDITED-CONSTANT ESTABLISHMENT READ (round-11 dispatch step 3),
	// before any case runs: the admin implementation at the CURRENT HEAD,
	// through BOTH read families. Head and frame era must agree with the
	// audited pin — a difference is a REAL admin epoch boundary and the whole
	// run STOPS for chain-truth adjudication, never papers over.
	gdaData, err := dmGetDebtManagerAdminABI.Pack("getDebtManagerAdmin")
	require.NoError(t, err)
	var headCallRet string
	require.NoError(t, storageClients[0].CallContext(ctx, &headCallRet, "eth_call",
		map[string]any{"to": strings.ToLower(liveDMProxy.Hex()), "data": "0x" + hex.EncodeToString(gdaData)}, "latest"),
		"head eth_call getDebtManagerAdmin")
	headCallBytes, err := hex.DecodeString(strings.TrimPrefix(headCallRet, "0x"))
	require.NoError(t, err)
	headAccessor, err := unpackAddressStrict(dmGetDebtManagerAdminABI, "getDebtManagerAdmin", headCallBytes)
	require.NoError(t, err)
	headSlotHex, err := rawStorageAtHash(ctx, storageClients, liveDMProxy, dmAdminImplSlot, "latest")
	require.NoError(t, err, "head eth_getStorageAt(ADMIN_IMPL_POSITION)")
	headSlotBytes, err := hex.DecodeString(strings.TrimPrefix(headSlotHex, "0x"))
	require.NoError(t, err)
	require.Len(t, headSlotBytes, 32)
	headSlot := common.BytesToAddress(headSlotBytes[12:])
	t.Logf("admin-impl establishment @head: accessor %s, raw slot %s, audited %s",
		headAccessor.Hex(), headSlot.Hex(), auditedDMAdminImpl.Hex())
	if headAccessor != auditedDMAdminImpl || headSlot != auditedDMAdminImpl {
		t.Fatalf("STOP: the CURRENT HEAD's admin implementation (accessor %s, slot %s) differs from the audited constant %s — a real admin epoch boundary; re-audit and re-pin before any capture, never absorb",
			headAccessor.Hex(), headSlot.Hex(), auditedDMAdminImpl.Hex())
	}

	require.NoError(t, os.MkdirAll(filepath.Join("testdata", "continuity"), 0o755))
	captured, failed := 0, 0
	for _, fc := range backtestFrame {
		key := strings.TrimPrefix(strings.ToLower(fc.TxHash), "0x") + fmt.Sprintf(":%d", fc.LogIndex)
		pin := common.HexToHash(fc.BlockHash)
		safe := common.HexToAddress(fc.Account)
		capOne := func() error {
			cap := &continuityCapture{
				Case: key, Block: fc.Block, LogIndex: fc.LogIndex,
				Pin: strings.ToLower(fc.BlockHash), TxHash: strings.ToLower(fc.TxHash),
				Account: strings.ToLower(fc.Account), CapturedAt: time.Now().UTC().Format(time.RFC3339),
				EndpointEnv: "SOLVENT_RECON_RPC_OP",
			}
			// The DM Liquidated envelope (blockHash + topic0), for the case's
			// own elements and same-block earlier passes.
			dmRaw, err := logsR.rawLogsAtHash(ctx, key+":capture:dm-liquidated", logsQuery{
				BlockHash: pin, Addresses: []common.Address{liveDMProxy},
				Topics: [][]common.Hash{{common.HexToHash("0x" + topicDMLiquidated)}},
			})
			if err != nil {
				return fmt.Errorf("dm envelope: %w", err)
			}
			cap.DMLiquidatedEnvelope = dmRaw

			// The honest N-1 pin from the pinned block's own state.
			gbData, err := multicall3GetBlockHashABI.Pack("getBlockHash", new(big.Int).SetUint64(fc.Block-1))
			if err != nil {
				return err
			}
			gbRet, _, err := r.callAtHash(ctx, key+":capture:parentHash", multicall3Address, gbData, pin)
			if err != nil {
				return fmt.Errorf("parent hash: %w", err)
			}
			parentHash, err := unpackBytes32Strict(multicall3GetBlockHashABI, "getBlockHash", gbRet)
			if err != nil {
				return err
			}
			if parentHash == (common.Hash{}) {
				return fmt.Errorf("BLOCKHASH answered zero for the parent")
			}
			cap.ParentHash = strings.ToLower(parentHash.Hex())

			// The two leg frames (L2 a).
			coData, err := dmCollateralOfABI.Pack("collateralOf", safe)
			if err != nil {
				return err
			}
			pRet, _, err := r.callAtHash(ctx, key+":capture:collateralOf@parent", liveDMProxy, coData, parentHash)
			if err != nil {
				return fmt.Errorf("parent collateralOf: %w", err)
			}
			eRet, _, err := r.callAtHash(ctx, key+":capture:collateralOf@pin", liveDMProxy, coData, pin)
			if err != nil {
				return fmt.Errorf("exec collateralOf: %w", err)
			}
			cap.ParentCollateralRet = "0x" + hex.EncodeToString(pRet)
			cap.ExecCollateralRet = "0x" + hex.EncodeToString(eRet)

			// The supported-collateral enumerations at both pins (addendum
			// adjustment 1) — the swept address universe.
			gctData, err := dmGetCollateralTokensABI.Pack("getCollateralTokens")
			if err != nil {
				return err
			}
			pSupRet, _, err := r.callAtHash(ctx, key+":capture:getCollateralTokens@parent", liveDMProxy, gctData, parentHash)
			if err != nil {
				return fmt.Errorf("parent getCollateralTokens: %w", err)
			}
			eSupRet, _, err := r.callAtHash(ctx, key+":capture:getCollateralTokens@pin", liveDMProxy, gctData, pin)
			if err != nil {
				return fmt.Errorf("exec getCollateralTokens: %w", err)
			}
			cap.ParentSupportedRet = "0x" + hex.EncodeToString(pSupRet)
			cap.ExecSupportedRet = "0x" + hex.EncodeToString(eSupRet)

			// The ADMIN_IMPL_POSITION reads at both pins (round-11 H1): the
			// production accessor through the pinned reader, AND the raw slot
			// word through eth_getStorageAt — both committed, so the hermetic
			// suite pins accessor == slot == audited on chain bytes.
			pAdmRet, _, err := r.callAtHash(ctx, key+":capture:getDebtManagerAdmin@parent", liveDMProxy, gdaData, parentHash)
			if err != nil {
				return fmt.Errorf("parent getDebtManagerAdmin: %w", err)
			}
			eAdmRet, _, err := r.callAtHash(ctx, key+":capture:getDebtManagerAdmin@pin", liveDMProxy, gdaData, pin)
			if err != nil {
				return fmt.Errorf("exec getDebtManagerAdmin: %w", err)
			}
			cap.ParentAdminImplRet = "0x" + hex.EncodeToString(pAdmRet)
			cap.ExecAdminImplRet = "0x" + hex.EncodeToString(eAdmRet)
			pSlotHex, err := rawStorageAtHash(ctx, storageClients, liveDMProxy, dmAdminImplSlot, blockHashArg(parentHash))
			if err != nil {
				return fmt.Errorf("parent eth_getStorageAt(ADMIN_IMPL_POSITION): %w", err)
			}
			eSlotHex, err := rawStorageAtHash(ctx, storageClients, liveDMProxy, dmAdminImplSlot, blockHashArg(pin))
			if err != nil {
				return fmt.Errorf("exec eth_getStorageAt(ADMIN_IMPL_POSITION): %w", err)
			}
			cap.ParentAdminImplSlot, cap.ExecAdminImplSlot = pSlotHex, eSlotHex
			// STOP semantics (dispatch step 6's re-capture clause): ANY case
			// showing a non-audited address at either pin, via either read
			// family, is a REAL historical epoch — halt the whole capture
			// immediately and report; do not paper over.
			for _, side := range []struct {
				label   string
				ret     []byte
				slotHex string
			}{
				{"parent(N-1)", pAdmRet, pSlotHex},
				{"exec(N)", eAdmRet, eSlotHex},
			} {
				acc, uerr := unpackAddressStrict(dmGetDebtManagerAdminABI, "getDebtManagerAdmin", side.ret)
				if uerr != nil {
					return fmt.Errorf("%s getDebtManagerAdmin decode: %w", side.label, uerr)
				}
				slotBytes, herr := hex.DecodeString(strings.TrimPrefix(side.slotHex, "0x"))
				if herr != nil || len(slotBytes) != 32 {
					return fmt.Errorf("%s raw slot word malformed (%q): %v", side.label, side.slotHex, herr)
				}
				slotAddr := common.BytesToAddress(slotBytes[12:])
				if acc != auditedDMAdminImpl || slotAddr != auditedDMAdminImpl {
					t.Fatalf("STOP: case %s %s carries admin impl accessor=%s slot=%s, audited=%s — a REAL historical admin epoch inside the frozen frame; halt, report, re-adjudicate (never re-pin silently)",
						key, side.label, acc.Hex(), slotAddr.Hex(), auditedDMAdminImpl.Hex())
				}
			}
			// ---- R12 Fork 1: the three-surface code-hash pin, PRODUCTION path.
			surfaces, serr := readCodeSurfaces(ctx, evR, key+":capture", liveDMProxy, parentHash, pin)
			if serr != nil {
				return fmt.Errorf("three-surface code reads: %w", serr)
			}
			if note := codeHashConstancyRefusal(surfaces); note != "" {
				// STOP semantics: a hash mismatch inside the frozen frame is a
				// REAL mid-frame upgrade (or a provider fork) — halt the whole
				// capture and report, never paper over.
				t.Fatalf("STOP: case %s code-hash pin refused at capture time — %s", key, note)
			}
			pWord, serr := evR.storageAtHash(ctx, key+":capture:implslot@parent", liveDMProxy, erc1967ImplSlot, parentHash)
			if serr != nil {
				return fmt.Errorf("ERC1967 impl slot @parent: %w", serr)
			}
			eWord, serr := evR.storageAtHash(ctx, key+":capture:implslot@pin", liveDMProxy, erc1967ImplSlot, pin)
			if serr != nil {
				return fmt.Errorf("ERC1967 impl slot @pin: %w", serr)
			}
			cap.ParentERC1967ImplSlot, cap.ExecERC1967ImplSlot = strings.ToLower(pWord.Hex()), strings.ToLower(eWord.Hex())
			for _, o := range surfaces {
				cap.CodeSurfaces = append(cap.CodeSurfaces, capturedCodeSurface{
					Surface: o.Surface, Address: strings.ToLower(o.Address.Hex()),
					ParentHash: strings.ToLower(o.ParentHash.Hex()), ExecHash: strings.ToLower(o.ExecHash.Hex()),
					ParentLen: o.ParentLen, ExecLen: o.ExecLen,
				})
			}
			// The full surface BYTES, committed once (constancy is the pinned
			// fact — every other case's hashes are asserted against the same
			// constants above, so one byte copy per surface is the honest
			// deduplication, not a shortcut).
			if !wroteSurfaceBytes {
				if err := os.MkdirAll(filepath.Join("testdata", "code_epoch"), 0o755); err != nil {
					return err
				}
				for _, s := range []struct {
					file string
					addr common.Address
				}{
					{"proxy.hex", liveDMProxy},
					{"core-impl.hex", common.BytesToAddress(eWord[12:])},
					{"admin-impl.hex", auditedDMAdminImpl},
				} {
					code, cerr := evR.codeAtHash(ctx, key+":capture:bytes:"+s.file, s.addr, pin)
					if cerr != nil {
						return fmt.Errorf("surface bytes %s: %w", s.file, cerr)
					}
					if err := os.WriteFile(filepath.Join("testdata", "code_epoch", s.file),
						[]byte("0x"+hex.EncodeToString(code)+"\n"), 0o644); err != nil {
						return err
					}
				}
				wroteSurfaceBytes = true
			}

			// ---- R12 Fork 2 Step A: the block trace + frame scan, PRODUCTION path.
			traceRaw, terr := evR.traceBlockByHash(ctx, key+":capture:trace", pin)
			if terr != nil {
				return fmt.Errorf("block trace: %w", terr)
			}
			entries, terr := decodeTraceEnvelope(traceRaw)
			if terr != nil {
				return fmt.Errorf("block trace decode: %w", terr)
			}
			scanNote := adminTraceScanRefusal(entries, common.HexToHash(fc.TxHash), liveDMProxy)
			cap.Expected.AdminScanClean = scanNote == ""
			cap.Expected.AdminScanRefusal = scanNote
			if scanNote != "" {
				// STOP semantics: an admin-write frame inside the frozen frame
				// is chain truth requiring adjudication before any capture ships.
				t.Fatalf("STOP: case %s admin-continuity scan refused at capture time — %s", key, scanNote)
			}
			traceName := strings.TrimPrefix(strings.ToLower(fc.BlockHash), "0x") + ".json.gz"
			cap.TraceFile = filepath.ToSlash(filepath.Join("traces", traceName))
			if !writtenTraces[traceName] {
				if err := os.MkdirAll(filepath.Join("testdata", "traces"), 0o755); err != nil {
					return err
				}
				var buf bytes.Buffer
				zw, _ := gzip.NewWriterLevel(&buf, gzip.BestCompression)
				if _, err := zw.Write(traceRaw); err != nil {
					return err
				}
				if err := zw.Close(); err != nil {
					return err
				}
				if err := os.WriteFile(filepath.Join("testdata", "traces", traceName), buf.Bytes(), 0o644); err != nil {
					return err
				}
				writtenTraces[traceName] = true
			}

			parentSupported, err := unpackAddressListStrict(dmGetCollateralTokensABI, "getCollateralTokens", pSupRet)
			if err != nil {
				return fmt.Errorf("parent getCollateralTokens decode: %w", err)
			}
			execSupported, err := unpackAddressListStrict(dmGetCollateralTokensABI, "getCollateralTokens", eSupRet)
			if err != nil {
				return fmt.Errorf("exec getCollateralTokens decode: %w", err)
			}

			// The sweeps, through the PRODUCTION assembler over a recording
			// wrapper — capture-time questions are production's questions by
			// construction.
			parentList, _, err := unpackTokenAmountList(dmCollateralOfABI, "collateralOf", pRet)
			if err != nil {
				return fmt.Errorf("parent collateralOf decode: %w", err)
			}
			execList, _, err := unpackTokenAmountList(dmCollateralOfABI, "collateralOf", eRet)
			if err != nil {
				return fmt.Errorf("exec collateralOf decode: %w", err)
			}
			var parentLegs, execLegs []collateralLeg
			for _, l := range parentList {
				parentLegs = append(parentLegs, collateralLeg{token: l.Token, amount: l.Amount})
			}
			for _, l := range execList {
				execLegs = append(execLegs, collateralLeg{token: l.Token, amount: l.Amount})
			}
			dmLogs, err := decodeLogsEnvelope(dmRaw)
			if err != nil {
				return fmt.Errorf("dm envelope decode: %w", err)
			}
			if verr := validateSweepAnswer(dmLogs, pin, []common.Address{liveDMProxy}); verr != nil {
				return fmt.Errorf("dm envelope validation: %w", verr)
			}
			var seizures []snapshotdb.T6Seizure
			var witnesses []snapshotdb.T6Witness
			for _, l := range dmLogs {
				w := witnessFromSweptLog(l)
				if l.LogIndex == uint64(fc.LogIndex) {
					if seizures, err = ownSeizures(w); err != nil {
						return fmt.Errorf("own Liquidated decode: %w", err)
					}
				} else if l.LogIndex < uint64(fc.LogIndex) {
					witnesses = append(witnesses, w)
				}
			}
			rec := &recordingLogsBackend{inner: logsR}
			sw := assembleContinuitySweep(ctx, rec, newGateFrame(gateBacktest), key, pin, fc.Block,
				fc.LogIndex, common.HexToHash(fc.TxHash), safe, parentLegs, execLegs,
				parentSupported, execSupported, seizures)
			if sw.Refusal != "" {
				return fmt.Errorf("sweep refused at capture time: %s", sw.Refusal)
			}
			cap.TransfersOutEnvelope, cap.TransfersInEnvelope, cap.NettingEnvelope = rec.out, rec.inn, rec.net

			outc := proveBasketContinuity(sw, seizures, witnesses)
			cap.Expected.Proven = outc.Proven
			cap.Expected.Refusals = outc.Refusals
			t.Logf("case %s @%d: %d parent legs, %d exec legs, %d transfers, %d netting events, %d witnesses -> proven=%v (%d refusal(s))",
				key, fc.Block, len(parentLegs), len(execLegs), len(sw.Transfers), len(sw.Netting), len(witnesses), outc.Proven, len(outc.Refusals))

			body, err := json.MarshalIndent(cap, "", " ")
			if err != nil {
				return err
			}
			name := filepath.Join("testdata", "continuity",
				strings.TrimPrefix(strings.ToLower(fc.TxHash), "0x")+fmt.Sprintf("-%d.json", fc.LogIndex))
			return os.WriteFile(name, append(body, '\n'), 0o644)
		}
		if err := capOne(); err != nil {
			failed++
			t.Errorf("case %s: capture FAILED (%v) — the hermetic suite will REFUSE this case (continuity unproven, disclosed) rather than fabricate", key, err)
			continue
		}
		captured++
	}
	t.Logf("capture complete: %d/%d cases captured, %d failed", captured, len(backtestFrame), failed)
}
