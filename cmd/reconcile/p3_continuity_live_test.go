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

	// Raw envelopes, verbatim provider bytes.
	DMLiquidatedEnvelope json.RawMessage `json:"dm_liquidated_envelope"`
	TransfersOutEnvelope json.RawMessage `json:"transfers_out_envelope"`
	TransfersInEnvelope  json.RawMessage `json:"transfers_in_envelope"`
	NettingEnvelope      json.RawMessage `json:"netting_envelope"`

	// The proof outcome at capture time.
	Expected struct {
		Proven   bool     `json:"proven"`
		Refusals []string `json:"refusals,omitempty"`
	} `json:"expected"`
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

// TestLiveCaptureContinuityFixtures runs the production read set per frozen
// case against the live endpoints (READ-ONLY: eth_call + eth_getLogs at
// stored pins) and commits the envelopes + call words + observed proof
// outcome to testdata/continuity/. Opt-in: SOLVENT_P3_CONTINUITY_CAPTURE=1.
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
