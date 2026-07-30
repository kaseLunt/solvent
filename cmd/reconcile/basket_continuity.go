// L2 — the basket-continuity proof (chain-truth basket-continuity ruling,
// NORMATIVE, archived verbatim at
// .superpowers/sdd/p3-consults/chain-truth-basket-continuity-ruling.md).
//
// This file is the ONLY sanctioned discharger of L1's basketContinuityProven
// conjunct. Per case, per basket token (union of the parent collateralOf legs,
// the seized tokens, and — a strictly-wider closing of the same law — the exec
// frame's own legs, so an inbound NEW token cannot sit outside the sweep):
//
//	(a) collateralOf(user)@pinHash(N): the exec-frame leg read (the parent
//	    frame's @parentHash(N-1) twin already existed);
//	(b) Transfer sweep: eth_getLogs pinned by blockHash (EIP-234) = the case's
//	    STORED raw_logs pin — two calls, topics [Transfer, safe] (outbound) and
//	    [Transfer, ·, safe] (inbound), over the basket-token address list;
//	(c) Netting sweep: eth_getLogs(blockHash=pin, address=CashEventEmitter,
//	    topics=[[WithdrawalRequested, WithdrawalAmountUpdated,
//	    WithdrawalCancelled, WithdrawalProcessed], [safe]]).
//
// CLOSURE IDENTITY, per token (the per-case standardness-and-quiescence proof
// — no token allowlist, ever):
//
//	leg@N − leg@N-1 == Σ signed Transfers − Δpending(decoded from (c))
//
// because the CashLens leg is balanceOf(safe) − pendingWithdrawalAmount
// (CashLens.sol:539-546): Δleg = Δbalance − Δpending, Δbalance is the signed
// Transfer sum for a standard token, and Δpending folds from the emitter's own
// withdrawal lifecycle (CashModuleSetters.sol:329-349 _requestWithdrawal sets
// from a base _cancelOldWithdrawal always empties first; CashModuleStorage-
// Contract.sol:191-208 cancel = −amounts; :298-333 process = −amounts AND real
// outbound Transfers, so its net leg effect is zero). Any mismatch → continuity
// unproven. WithdrawalAmountUpdated has NO caller in the committed cash-v3
// source and its payload carries an absolute amount, not a delta — one in the
// block makes Δpending underivable and REFUSES (refusal-over-fabrication).
//
// ATTRIBUTION LAW (pre-boundary = logIndex < L, direction-blind, no magnitude
// filter — ruling L4): every pre-boundary Transfer touching the safe and every
// pre-boundary netting event must attribute to a custodied witness's tx —
// the case's own seizure elements (per-token aggregate; chain-guaranteed
// pre-boundary by DebtManagerCore.sol:575 < :584), an earlier-pass Liquidated's
// decoded elements, or a WithdrawalCancelled in the same tx as a witnessed
// liquidation. Unattributed either direction → unproven. Attributed-but-
// unmodeled (an earlier pass's cancellation freeing netted amounts the
// replay's legs exclude) → refuse per round-5 all-or-nothing; completing the
// model is the sanctioned extension, refusal is the floor implemented here.
//
// L6 RESPONSE-VALIDATION LAW: every getLogs response is validated as answering
// the question asked — each log's blockHash == the requested pin, address ∈
// the requested set, topic count EXACTLY 3 for Transfer (excludes ERC721
// same-topic0 collisions), data EXACTLY 32 bytes for Transfer, strict decode
// everywhere, presence-gated wire fields (an absent field never decodes as a
// plausible zero). Any violation refuses the WHOLE proof for the case.
package main

import (
	"context"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"math/big"
	"sort"
	"strings"

	"github.com/ethereum/go-ethereum/common"
	gethrpc "github.com/ethereum/go-ethereum/rpc"

	"github.com/kaselunt/solvent/cmd/reconcile/snapshotdb"
	"github.com/kaselunt/solvent/internal/chain"
)

// cashEventEmitterOP is the CashEventEmitter singleton on OP (chain 10) — the
// netting sweep's address. Provenance: recon/report.md:15 (code-verified at
// recon time against the cash-v3 deployments manifest); the contract source is
// the committed recon/cash-v3/src/modules/cash/CashEventEmitter.sol. It is NOT
// a walked stream address (recon/report.md — "not a stream"), which is exactly
// why the netting term is outside walked custody and this sweep exists.
var cashEventEmitterOP = common.HexToAddress("0x380B2e96799405be6e3D965f4044099891881acB")

// erc20TransferABI carries the canonical ERC20 Transfer event. Like
// dmWitnessABI it is an abi.ABI object so the topic0 is DERIVED, never
// hand-written (the Task-6 round-3 lesson); the signature transcription is
// pinned in tests by an independent keccak derivation AND against captured
// chain logs.
var erc20TransferABI = mustParseABI(`[
	{"type":"event","name":"Transfer","inputs":[
		{"name":"from","type":"address","indexed":true},
		{"name":"to","type":"address","indexed":true},
		{"name":"value","type":"uint256","indexed":false}]}
]`)

// cashEmitterABI is the CashEventEmitter withdrawal-lifecycle surface,
// transcribed VERBATIM from the committed artifact
// recon/cash-v3/src/modules/cash/CashEventEmitter.sol:52-78 (no forge
// artifact JSON is committed for this contract; the source file is the
// committed artifact). Topic0s are derived from this object; the
// transcription is pinned in tests against the .sol declarations themselves
// and by an independent keccak path.
var cashEmitterABI = mustParseABI(`[
	{"type":"event","name":"WithdrawalRequested","inputs":[
		{"name":"safe","type":"address","indexed":true},
		{"name":"tokens","type":"address[]","indexed":false},
		{"name":"amounts","type":"uint256[]","indexed":false},
		{"name":"recipient","type":"address","indexed":true},
		{"name":"finalizeTimestamp","type":"uint256","indexed":false}]},
	{"type":"event","name":"WithdrawalAmountUpdated","inputs":[
		{"name":"safe","type":"address","indexed":true},
		{"name":"token","type":"address","indexed":true},
		{"name":"amount","type":"uint256","indexed":false}]},
	{"type":"event","name":"WithdrawalCancelled","inputs":[
		{"name":"safe","type":"address","indexed":true},
		{"name":"tokens","type":"address[]","indexed":false},
		{"name":"amounts","type":"uint256[]","indexed":false},
		{"name":"recipient","type":"address","indexed":true}]},
	{"type":"event","name":"WithdrawalProcessed","inputs":[
		{"name":"safe","type":"address","indexed":true},
		{"name":"tokens","type":"address[]","indexed":false},
		{"name":"amounts","type":"uint256[]","indexed":false},
		{"name":"recipient","type":"address","indexed":true}]}
]`)

// emitterTopic0 derives one netting event's topic0 from the ABI object.
func emitterTopic0(event string) common.Hash {
	ev, ok := cashEmitterABI.Events[event]
	if !ok {
		panic("reconcile: cashEmitterABI has no event " + event)
	}
	return ev.ID
}

// The sweep topic0s, derived once at init — never hand-written.
var (
	topicERC20Transfer       = erc20TransferABI.Events["Transfer"].ID
	topicWithdrawalRequested = emitterTopic0("WithdrawalRequested")
	topicWithdrawalAmountUpd = emitterTopic0("WithdrawalAmountUpdated")
	topicWithdrawalCancelled = emitterTopic0("WithdrawalCancelled")
	topicWithdrawalProcessed = emitterTopic0("WithdrawalProcessed")
)

// --- the eth_getLogs plumbing (L6: new plumbing, none existed) --------------

// logsQuery is one EIP-234 blockHash-form eth_getLogs question.
type logsQuery struct {
	BlockHash common.Hash
	Addresses []common.Address
	Topics    [][]common.Hash
}

// param renders the wire argument. The shape mirrors the pinned client's
// toFilterArg for the blockHash arm (internal/chain filterArg): blockHash +
// address + topics, never a from/to pair alongside. A nil/empty topic tier
// marshals as null — the JSON-RPC wildcard.
func (q logsQuery) param() map[string]any {
	addrs := make([]string, len(q.Addresses))
	for i, a := range q.Addresses {
		addrs[i] = strings.ToLower(a.Hex())
	}
	arg := map[string]any{
		"blockHash": strings.ToLower(q.BlockHash.Hex()),
		"address":   addrs,
	}
	if len(q.Topics) > 0 {
		topics := make([][]string, len(q.Topics))
		for i, tier := range q.Topics {
			if len(tier) == 0 {
				continue // stays nil → marshals as null (wildcard)
			}
			topics[i] = make([]string, len(tier))
			for j, h := range tier {
				topics[i][j] = strings.ToLower(h.Hex())
			}
		}
		arg["topics"] = topics
	}
	return arg
}

// rawLogsBackend answers one getLogs question with the provider's RAW result
// bytes. Production is pinnedLogsReader (live endpoints, failover, pacing);
// the hermetic suite is capturedLogsBackend (committed envelopes) — BOTH feed
// the same strict decode, so the fixtures exercise the production path.
type rawLogsBackend interface {
	rawLogsAtHash(ctx context.Context, op string, q logsQuery) (json.RawMessage, error)
}

// pinnedLogsReader is the production backend: raw JSON-RPC clients dialed
// from the SAME URL list as the pinned reader (SOLVENT_RECON_RPC_OP family),
// walked in order per attempt under the shared runner (token bucket, bounded
// retries, per-attempt classification) and the F5 gate sentinel — the same
// entry-point posture as every pinnedReader method.
type pinnedLogsReader struct {
	name    string
	clients []*gethrpc.Client
	run     *rpcRunner
}

// dialPinnedLogs dials every URL. A URL that does not dial is an error now
// rather than a silent hole in the failover walk.
func dialPinnedLogs(ctx context.Context, name string, urls []string, run *rpcRunner) (*pinnedLogsReader, error) {
	if len(urls) == 0 {
		return nil, fmt.Errorf("dial %s logs: no endpoints configured", name)
	}
	r := &pinnedLogsReader{name: name, run: run}
	for i, u := range urls {
		c, err := gethrpc.DialContext(ctx, u)
		if err != nil {
			for _, cc := range r.clients {
				cc.Close()
			}
			return nil, fmt.Errorf("dial %s logs endpoint %d: %w", name, i, err)
		}
		r.clients = append(r.clients, c)
	}
	return r, nil
}

func (r *pinnedLogsReader) rawLogsAtHash(ctx context.Context, op string, q logsQuery) (json.RawMessage, error) {
	if err := snapshotdb.Gate().Violation("getLogsAtHash:" + op); err != nil {
		return nil, err
	}
	arg := q.param()
	var out json.RawMessage
	_, err := r.run.run(ctx, r.name, op, func(ctx context.Context) (chain.EndpointToken, error) {
		var walkErrs []string
		for i, c := range r.clients {
			var raw json.RawMessage
			err := c.CallContext(ctx, &raw, "eth_getLogs", arg)
			if err == nil {
				if len(raw) == 0 || string(raw) == "null" {
					// The provider's honest "no logs" is []; null is a
					// non-answer and must not impersonate one (the
					// internal/chain wave-8 canon, applied to this decode
					// path too).
					walkErrs = append(walkErrs, fmt.Sprintf("endpoint %d: null getLogs result (protocol violation)", i))
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

// --- the strict envelope decode (L6) ----------------------------------------

// wireLog is one eth_getLogs entry at the bytes level, PRESENCE-TRACKED: every
// consumed field is a pointer, so an omitted field surfaces as absent instead
// of decoding to a plausible zero (the internal/chain reportedLog posture,
// re-implemented here because this package may not reach that unexported
// decode and the L6 law is stricter anyway).
type wireLog struct {
	Address   *string  `json:"address"`
	Topics    []string `json:"topics"`
	Data      *string  `json:"data"`
	BlockHash *string  `json:"blockHash"`
	TxHash    *string  `json:"transactionHash"`
	LogIndex  *string  `json:"logIndex"`
}

// sweptLog is one decoded, validated log.
type sweptLog struct {
	Address   common.Address
	Topics    []common.Hash
	Data      []byte
	BlockHash common.Hash
	TxHash    common.Hash
	LogIndex  uint64
}

// hexQuantity decodes a canonical 0x quantity (no leading zeros, per the JSON-
// RPC spec) into a uint64.
func hexQuantity(field, s string) (uint64, error) {
	if !strings.HasPrefix(s, "0x") || len(s) < 3 {
		return 0, fmt.Errorf("%s %q is not a 0x quantity", field, s)
	}
	digits := s[2:]
	if len(digits) > 1 && digits[0] == '0' {
		return 0, fmt.Errorf("%s %q carries leading zeros — not the canonical quantity encoding", field, s)
	}
	var v uint64
	if _, err := fmt.Sscanf(strings.ToLower(digits), "%x", &v); err != nil {
		return 0, fmt.Errorf("%s %q does not decode: %w", field, s, err)
	}
	return v, nil
}

// hexFixed decodes 0x-prefixed hex of exactly n bytes.
func hexFixed(field, s string, n int) ([]byte, error) {
	if !strings.HasPrefix(s, "0x") {
		return nil, fmt.Errorf("%s %q is not 0x-prefixed hex", field, s)
	}
	b, err := hex.DecodeString(s[2:])
	if err != nil {
		return nil, fmt.Errorf("%s %q is not hex: %w", field, s, err)
	}
	if len(b) != n {
		return nil, fmt.Errorf("%s %q is %d bytes, want exactly %d", field, s, len(b), n)
	}
	return b, nil
}

// decodeLogsEnvelope strictly decodes a raw eth_getLogs result. Every entry
// must be present-complete; null is refused before this is called (backends)
// but re-refused here so a fixture cannot slip one through.
func decodeLogsEnvelope(raw json.RawMessage) ([]sweptLog, error) {
	trimmed := strings.TrimSpace(string(raw))
	if trimmed == "" || trimmed == "null" {
		return nil, fmt.Errorf("getLogs result is null — a non-answer must not impersonate an empty window")
	}
	var wire []wireLog
	if err := json.Unmarshal(raw, &wire); err != nil {
		return nil, fmt.Errorf("getLogs result does not decode as a log array: %w", err)
	}
	out := make([]sweptLog, 0, len(wire))
	for i, w := range wire {
		var missing []string
		if w.Address == nil {
			missing = append(missing, "address")
		}
		if w.Topics == nil {
			missing = append(missing, "topics")
		}
		if w.Data == nil {
			missing = append(missing, "data")
		}
		if w.BlockHash == nil {
			missing = append(missing, "blockHash")
		}
		if w.TxHash == nil {
			missing = append(missing, "transactionHash")
		}
		if w.LogIndex == nil {
			missing = append(missing, "logIndex")
		}
		if len(missing) > 0 {
			return nil, fmt.Errorf("log entry %d omits required field(s) %s — an absent field must surface as absent, never as a plausible zero", i, strings.Join(missing, ", "))
		}
		addr, err := hexFixed(fmt.Sprintf("log %d address", i), *w.Address, 20)
		if err != nil {
			return nil, err
		}
		blockHash, err := hexFixed(fmt.Sprintf("log %d blockHash", i), *w.BlockHash, 32)
		if err != nil {
			return nil, err
		}
		txHash, err := hexFixed(fmt.Sprintf("log %d transactionHash", i), *w.TxHash, 32)
		if err != nil {
			return nil, err
		}
		idx, err := hexQuantity(fmt.Sprintf("log %d logIndex", i), *w.LogIndex)
		if err != nil {
			return nil, err
		}
		dataHex := strings.TrimPrefix(*w.Data, "0x")
		if strings.HasPrefix(*w.Data, "0x") == false {
			return nil, fmt.Errorf("log %d data %q is not 0x-prefixed hex", i, *w.Data)
		}
		data, err := hex.DecodeString(dataHex)
		if err != nil {
			return nil, fmt.Errorf("log %d data is not hex: %w", i, err)
		}
		l := sweptLog{
			Address:   common.BytesToAddress(addr),
			BlockHash: common.BytesToHash(blockHash),
			TxHash:    common.BytesToHash(txHash),
			LogIndex:  idx,
			Data:      data,
		}
		if l.BlockHash == (common.Hash{}) {
			return nil, fmt.Errorf("log %d reports a zero blockHash — an unverifiable identity", i)
		}
		if l.TxHash == (common.Hash{}) {
			return nil, fmt.Errorf("log %d reports a zero transactionHash — an unverifiable identity", i)
		}
		for j, tp := range w.Topics {
			tb, err := hexFixed(fmt.Sprintf("log %d topic %d", i, j), tp, 32)
			if err != nil {
				return nil, err
			}
			l.Topics = append(l.Topics, common.BytesToHash(tb))
		}
		out = append(out, l)
	}
	return out, nil
}

// validateSweepAnswer is the L6 "answers the question asked" gate common to
// every sweep: blockHash echo == the requested pin, address ∈ the requested
// set. Sweep-specific shape laws (Transfer arity/width) live with each
// decoder.
func validateSweepAnswer(logs []sweptLog, pin common.Hash, addrs []common.Address) error {
	set := map[common.Address]bool{}
	for _, a := range addrs {
		set[a] = true
	}
	for _, l := range logs {
		if l.BlockHash != pin {
			return fmt.Errorf("log %d echoes blockHash %s where the question pinned %s — the response does not answer the question asked", l.LogIndex, l.BlockHash.Hex(), pin.Hex())
		}
		if !set[l.Address] {
			return fmt.Errorf("log %d comes from address %s, outside the requested address set", l.LogIndex, l.Address.Hex())
		}
	}
	return nil
}

// topicAddress extracts the address payload of an indexed-address topic,
// refusing dirty padding (the freeze's own zero-dirty-padding posture).
func topicAddress(l sweptLog, i int) (common.Address, error) {
	if i >= len(l.Topics) {
		return common.Address{}, fmt.Errorf("log %d has no topic %d", l.LogIndex, i)
	}
	h := l.Topics[i]
	for _, b := range h[:12] {
		if b != 0 {
			return common.Address{}, fmt.Errorf("log %d topic %d carries dirty padding above the address payload", l.LogIndex, i)
		}
	}
	return common.BytesToAddress(h[12:]), nil
}

// sweptTransfer is one validated ERC20 Transfer touching the safe.
type sweptTransfer struct {
	Token    common.Address
	From, To common.Address
	Value    *big.Int
	TxHash   common.Hash
	LogIndex uint64
}

// decodeTransferSweep applies the Transfer shape law: topic count EXACTLY 3
// (topic0 + from + to — an ERC721 Transfer shares the topic0 but carries 4),
// data EXACTLY 32 bytes, dirty-padding-free address topics.
func decodeTransferSweep(logs []sweptLog) ([]sweptTransfer, error) {
	var out []sweptTransfer
	for _, l := range logs {
		if len(l.Topics) == 0 || l.Topics[0] != topicERC20Transfer {
			return nil, fmt.Errorf("log %d topic0 is not Transfer — the response does not answer the question asked", l.LogIndex)
		}
		if len(l.Topics) != 3 {
			return nil, fmt.Errorf("log %d is a %d-topic Transfer — the ERC20 shape is EXACTLY 3 (an ERC721 collides on topic0 and must be refused, ruling L6)", l.LogIndex, len(l.Topics))
		}
		if len(l.Data) != 32 {
			return nil, fmt.Errorf("log %d Transfer data is %d bytes — the ERC20 value word is EXACTLY 32 (ruling L6)", l.LogIndex, len(l.Data))
		}
		from, err := topicAddress(l, 1)
		if err != nil {
			return nil, err
		}
		to, err := topicAddress(l, 2)
		if err != nil {
			return nil, err
		}
		out = append(out, sweptTransfer{
			Token: l.Address, From: from, To: to,
			Value: new(big.Int).SetBytes(l.Data), TxHash: l.TxHash, LogIndex: l.LogIndex,
		})
	}
	return out, nil
}

// nettingEvent is one decoded CashEventEmitter withdrawal-lifecycle event for
// the safe.
type nettingEvent struct {
	Kind     string // "WithdrawalRequested" | "WithdrawalAmountUpdated" | "WithdrawalCancelled" | "WithdrawalProcessed"
	TxHash   common.Hash
	LogIndex uint64
	Tokens   []common.Address
	Amounts  []*big.Int
}

// decodeNettingSweep strictly decodes sweep (c). Every event must be one of
// the four lifecycle topics (the question asked exactly those), be FOR the
// requested safe, and unpack strictly through cashEmitterABI.
func decodeNettingSweep(logs []sweptLog, safe common.Address) ([]nettingEvent, error) {
	var out []nettingEvent
	for _, l := range logs {
		if len(l.Topics) == 0 {
			return nil, fmt.Errorf("log %d carries no topics", l.LogIndex)
		}
		var kind string
		switch l.Topics[0] {
		case topicWithdrawalRequested:
			kind = "WithdrawalRequested"
		case topicWithdrawalAmountUpd:
			kind = "WithdrawalAmountUpdated"
		case topicWithdrawalCancelled:
			kind = "WithdrawalCancelled"
		case topicWithdrawalProcessed:
			kind = "WithdrawalProcessed"
		default:
			return nil, fmt.Errorf("log %d topic0 %s is not one of the four withdrawal-lifecycle events the question asked for", l.LogIndex, l.Topics[0].Hex())
		}
		evSafe, err := topicAddress(l, 1)
		if err != nil {
			return nil, err
		}
		if evSafe != safe {
			return nil, fmt.Errorf("log %d %s names safe %s where the question pinned %s", l.LogIndex, kind, evSafe.Hex(), safe.Hex())
		}
		ev := nettingEvent{Kind: kind, TxHash: l.TxHash, LogIndex: l.LogIndex}
		args := cashEmitterABI.Events[kind].Inputs.NonIndexed()
		vals, err := args.Unpack(l.Data)
		if err != nil {
			return nil, fmt.Errorf("log %d %s payload does not unpack: %w", l.LogIndex, kind, err)
		}
		if kind == "WithdrawalAmountUpdated" {
			tok, err := topicAddress(l, 2)
			if err != nil {
				return nil, err
			}
			amt, ok := vals[0].(*big.Int)
			if !ok || amt == nil {
				return nil, fmt.Errorf("log %d WithdrawalAmountUpdated amount is not a uint256", l.LogIndex)
			}
			ev.Tokens = []common.Address{tok}
			ev.Amounts = []*big.Int{new(big.Int).Set(amt)}
		} else {
			toks, ok := vals[0].([]common.Address)
			if !ok {
				return nil, fmt.Errorf("log %d %s tokens is %T, not address[]", l.LogIndex, kind, vals[0])
			}
			amts, ok := vals[1].([]*big.Int)
			if !ok {
				return nil, fmt.Errorf("log %d %s amounts is %T, not uint256[]", l.LogIndex, kind, vals[1])
			}
			if len(toks) != len(amts) {
				return nil, fmt.Errorf("log %d %s tokens/amounts lengths disagree (%d vs %d)", l.LogIndex, kind, len(toks), len(amts))
			}
			for i := range toks {
				if amts[i] == nil {
					return nil, fmt.Errorf("log %d %s amount %d is nil", l.LogIndex, kind, i)
				}
				ev.Tokens = append(ev.Tokens, toks[i])
				ev.Amounts = append(ev.Amounts, new(big.Int).Set(amts[i]))
			}
		}
		out = append(out, ev)
	}
	return out, nil
}

// --- the assembled per-case sweep -------------------------------------------

// continuitySweep is the L2 proof's complete input set for one case: the two
// leg frames, the validated transfer and netting sweeps, and the identities
// the attribution law needs. Built by runBacktestCase from live pinned reads,
// or by the hermetic suite from committed captures/synthesized envelopes —
// through the SAME decoders either way.
type continuitySweep struct {
	Pin              common.Hash
	Block            uint64
	BoundaryLogIndex uint32
	CaseTx           common.Hash
	Safe             common.Address
	// Tokens is the union list the sweeps were issued over, sorted.
	Tokens []common.Address
	// ParentLegs / ExecLegs are leg@N-1 / leg@N (absent token = 0).
	ParentLegs map[common.Address]*big.Int
	ExecLegs   map[common.Address]*big.Int
	Transfers  []sweptTransfer
	Netting    []nettingEvent
	// Refusal, when non-empty, records that the sweep itself could not be
	// taken or did not validate — the proof refuses with this reason and
	// nothing else is consulted.
	Refusal string
}

// refusedSweep is the refusal-shaped input (backend unavailable, validation
// failure, uncaptured hermetic case).
func refusedSweep(reason string) *continuitySweep {
	return &continuitySweep{Refusal: reason}
}

// continuityOutcome is the proof's verdict. Proven=true is the ONE thing that
// may discharge L1's conjunct.
type continuityOutcome struct {
	Proven   bool
	Outcome  string
	Refusals []string
	// CancelledPreBoundary aggregates pre-boundary WithdrawalCancelled
	// amounts per token — the L5 discrimination input: a token with an
	// observed release evidences explanation (b); one without stays (a).
	CancelledPreBoundary map[common.Address]*big.Int
}

// witnessLiquidationSeizures decodes the per-token seizure aggregates of every
// witnessed (logIndex < L) Liquidated for THIS safe, grouped by tx, plus the
// case's own elements under the case tx. The witness list is the custodied
// raw_logs surface the replay already consumes; TxHash joins it to the sweeps.
type txSeizures struct {
	perToken map[common.Address]*big.Int
	// liquidatedIndexes are the witnessed Liquidated log indexes in this tx
	// (the case's own boundary index included for the case tx) — the
	// netting-attribution ordering law consults them.
	liquidatedIndexes []uint64
}

func collectSeizureAggregates(sw *continuitySweep, caseSeizures []snapshotdb.T6Seizure,
	witnesses []snapshotdb.T6Witness) (map[common.Hash]*txSeizures, []string) {
	var refusals []string
	byTx := map[common.Hash]*txSeizures{}
	get := func(tx common.Hash) *txSeizures {
		if byTx[tx] == nil {
			byTx[tx] = &txSeizures{perToken: map[common.Address]*big.Int{}}
		}
		return byTx[tx]
	}
	// The case's own elements: chain-guaranteed pre-boundary in the case's
	// own tx (DebtManagerCore.sol:575 < :584).
	own := get(sw.CaseTx)
	own.liquidatedIndexes = append(own.liquidatedIndexes, uint64(sw.BoundaryLogIndex))
	for _, s := range caseSeizures {
		if s.Amount == nil || s.Amount.Sign() == 0 {
			continue
		}
		tok := common.HexToAddress(s.AssetHex)
		if own.perToken[tok] == nil {
			own.perToken[tok] = new(big.Int)
		}
		own.perToken[tok].Add(own.perToken[tok], s.Amount)
	}
	// Earlier-pass Liquidated witnesses for this safe.
	safeHex := hexLower(sw.Safe.Hex())
	for _, w := range witnesses {
		if w.Topic0 != topicDMLiquidated || !strings.EqualFold(w.Topic2Addr, safeHex) {
			continue
		}
		if w.TxHash == "" {
			refusals = append(refusals, fmt.Sprintf("witnessed Liquidated at log_index %d carries no tx hash — its seizure transfers cannot be attributed", w.LogIndex))
			continue
		}
		tx := common.HexToHash("0x" + strings.TrimPrefix(strings.ToLower(w.TxHash), "0x"))
		seized, _, err := decodeWitnessLiquidated(w)
		if err != nil {
			refusals = append(refusals, fmt.Sprintf("witnessed Liquidated at log_index %d did not decode (%v) — its seizure transfers cannot be attributed", w.LogIndex, err))
			continue
		}
		ts := get(tx)
		ts.liquidatedIndexes = append(ts.liquidatedIndexes, uint64(w.LogIndex))
		for _, s := range seized {
			if s.Amount.Sign() == 0 {
				continue
			}
			if ts.perToken[s.Token] == nil {
				ts.perToken[s.Token] = new(big.Int)
			}
			ts.perToken[s.Token].Add(ts.perToken[s.Token], s.Amount)
		}
	}
	return byTx, refusals
}

// proveBasketContinuity is THE L2 proof. Its outcome is the only thing that
// may set L1's basketContinuityProven conjunct.
func proveBasketContinuity(sw *continuitySweep, caseSeizures []snapshotdb.T6Seizure,
	witnesses []snapshotdb.T6Witness) continuityOutcome {
	out := continuityOutcome{CancelledPreBoundary: map[common.Address]*big.Int{}}
	if sw == nil {
		out.Refusals = append(out.Refusals, "no continuity sweep was taken for this case — the proof cannot run")
		return out
	}
	if sw.Refusal != "" {
		out.Refusals = append(out.Refusals, sw.Refusal)
		return out
	}

	tokenSet := map[common.Address]bool{}
	for _, t := range sw.Tokens {
		tokenSet[t] = true
	}
	// A transfer of a token outside the union list would mean the sweep asked
	// a narrower question than the basket needs — refuse rather than reason
	// over a partial answer.
	for _, tr := range sw.Transfers {
		if !tokenSet[tr.Token] {
			out.Refusals = append(out.Refusals, fmt.Sprintf("swept Transfer at log_index %d concerns token %s outside the basket union — the sweep does not cover the question", tr.LogIndex, tr.Token.Hex()))
		}
	}

	seizuresByTx, wRefusals := collectSeizureAggregates(sw, caseSeizures, witnesses)
	out.Refusals = append(out.Refusals, wRefusals...)

	// --- Δpending per token, whole block, decoded from (c) ------------------
	deltaPending := map[common.Address]*big.Int{}
	addPending := func(tok common.Address, v *big.Int) {
		if deltaPending[tok] == nil {
			deltaPending[tok] = new(big.Int)
		}
		deltaPending[tok].Add(deltaPending[tok], v)
	}
	for _, ev := range sw.Netting {
		switch ev.Kind {
		case "WithdrawalRequested":
			for i, tok := range ev.Tokens {
				addPending(tok, ev.Amounts[i])
			}
		case "WithdrawalCancelled", "WithdrawalProcessed":
			for i, tok := range ev.Tokens {
				addPending(tok, new(big.Int).Neg(ev.Amounts[i]))
			}
		case "WithdrawalAmountUpdated":
			// The payload carries an ABSOLUTE amount, not a delta, and the
			// committed cash-v3 source has NO caller for the emit — the delta
			// is underivable from events. Refusal over fabrication.
			out.Refusals = append(out.Refusals, fmt.Sprintf("WithdrawalAmountUpdated at log_index %d: the payload is an absolute pending amount whose prior value no event states — Δpending is underivable and continuity cannot be proven", ev.LogIndex))
		}
	}

	// --- the closure identity, per token in the union -----------------------
	for _, tok := range sw.Tokens {
		legN := big.NewInt(0)
		if v := sw.ExecLegs[tok]; v != nil {
			legN = v
		}
		legP := big.NewInt(0)
		if v := sw.ParentLegs[tok]; v != nil {
			legP = v
		}
		deltaLeg := new(big.Int).Sub(legN, legP)
		signed := new(big.Int)
		for _, tr := range sw.Transfers {
			if tr.Token != tok {
				continue
			}
			// from == to == safe nets to zero by construction.
			if tr.To == sw.Safe && tr.From != sw.Safe {
				signed.Add(signed, tr.Value)
			}
			if tr.From == sw.Safe && tr.To != sw.Safe {
				signed.Sub(signed, tr.Value)
			}
		}
		dp := big.NewInt(0)
		if v := deltaPending[tok]; v != nil {
			dp = v
		}
		// leg@N − leg@N-1 == Σ signed Transfers − Δpending. This is the
		// per-case standardness-and-quiescence proof: rebasing accrual,
		// fee-on-transfer skims and any non-standard balance write break the
		// identity BY ARITHMETIC — no token allowlist, ever.
		want := new(big.Int).Sub(signed, dp)
		if deltaLeg.Cmp(want) != 0 {
			out.Refusals = append(out.Refusals, fmt.Sprintf(
				"closure identity FAILS for token %s: leg@N − leg@N-1 = %s but Σ signed Transfers − Δpending = %s − (%s) = %s — a balance write the Transfer and netting layers do not explain (non-standard token behavior, or an unswept channel); continuity unproven",
				tok.Hex(), deltaLeg, signed, dp, want))
		}
	}

	// --- attribution, pre-boundary only (logIndex < L), direction-blind -----
	boundary := uint64(sw.BoundaryLogIndex)
	preOutbound := map[common.Hash]map[common.Address]*big.Int{}
	for _, tr := range sw.Transfers {
		if tr.LogIndex >= boundary {
			continue
		}
		inbound := tr.To == sw.Safe && tr.From != sw.Safe
		outbound := tr.From == sw.Safe && tr.To != sw.Safe
		switch {
		case inbound:
			// No custodied witness moves tokens INTO a Safe — every honest
			// deposit is a plain transfer with no DM event (the only deposit
			// path). Ruling L4's inbound narrative, no magnitude filter.
			out.Refusals = append(out.Refusals, fmt.Sprintf(
				"unattributed INBOUND pre-boundary movement: %s of token %s into the safe at log_index %d (tx %s) — a non-custodied basket increase pre-boundary; a modeled crossing cannot be certified to have held",
				tr.Value, tr.Token.Hex(), tr.LogIndex, tr.TxHash.Hex()))
		case outbound:
			if preOutbound[tr.TxHash] == nil {
				preOutbound[tr.TxHash] = map[common.Address]*big.Int{}
			}
			if preOutbound[tr.TxHash][tr.Token] == nil {
				preOutbound[tr.TxHash][tr.Token] = new(big.Int)
			}
			preOutbound[tr.TxHash][tr.Token].Add(preOutbound[tr.TxHash][tr.Token], tr.Value)
		}
	}
	// Outbound attribution: per (tx, token), the pre-boundary aggregate must
	// EQUAL the decoded seizure aggregate of that tx's witnessed liquidations
	// (the case's own included). Equality is two-sided: a missing seizure
	// transfer is chain-impossible (:575 < :584) and refuses exactly like an
	// unattributed extra one.
	txs := map[common.Hash]bool{}
	for tx := range preOutbound {
		txs[tx] = true
	}
	for tx := range seizuresByTx {
		txs[tx] = true
	}
	for _, tx := range sortedHashes(txs) {
		obs := preOutbound[tx]
		ts := seizuresByTx[tx]
		if ts == nil {
			for _, tok := range sortedAddrKeys(obs) {
				out.Refusals = append(out.Refusals, fmt.Sprintf(
					"unattributed OUTBOUND pre-boundary movement: %s of token %s leaves the safe in tx %s, which carries no witnessed liquidation — a non-custodied basket reduction pre-boundary; a candidate uncaptured cause (the crossing may not be the witnessed write's). Outbound NEVER upgrades to marginal: per-case archive reads inform, they do not classify",
					obs[tok], tok.Hex(), tx.Hex()))
			}
			continue
		}
		toks := map[common.Address]bool{}
		for tok := range ts.perToken {
			toks[tok] = true
		}
		for tok := range obs {
			toks[tok] = true
		}
		for _, tok := range sortedAddrs(toks) {
			o := big.NewInt(0)
			if v := obs[tok]; v != nil {
				o = v
			}
			s := big.NewInt(0)
			if v := ts.perToken[tok]; v != nil {
				s = v
			}
			if o.Cmp(s) != 0 {
				out.Refusals = append(out.Refusals, fmt.Sprintf(
					"pre-boundary OUTBOUND aggregate of token %s in tx %s is %s but the tx's decoded Liquidated elements seize %s — the movement does not attribute to the custodied witness (a liquidation-case sweep without its own seizure transfers is chain-impossible, DebtManagerCore.sol:575<:584)",
					tok.Hex(), tx.Hex(), o, s))
			}
		}
	}
	// Netting attribution. A pre-boundary lifecycle event must be a
	// WithdrawalCancelled in the same tx as a witnessed liquidation; and even
	// then it is MODELED only when it belongs to the case's own final pass —
	// a cancellation FOLLOWED by a witnessed Liquidated below L frees netted
	// amounts the replay's legs exclude before a replayed eligibility state
	// the model then certifies (the ruling's attributed-but-unmodeled
	// example) → refuse per all-or-nothing.
	for _, ev := range sw.Netting {
		if ev.LogIndex >= boundary {
			continue
		}
		ts := seizuresByTx[ev.TxHash]
		if ev.Kind != "WithdrawalCancelled" || ts == nil {
			out.Refusals = append(out.Refusals, fmt.Sprintf(
				"unattributed pre-boundary netting event: %s at log_index %d (tx %s) attributes to no witnessed liquidation — the netting term moved outside custody (CashLens.sol:544-546); continuity unproven",
				ev.Kind, ev.LogIndex, ev.TxHash.Hex()))
			continue
		}
		// Attributed: record for the L5 discrimination regardless of the
		// modeling question below.
		for i, tok := range ev.Tokens {
			if out.CancelledPreBoundary[tok] == nil {
				out.CancelledPreBoundary[tok] = new(big.Int)
			}
			out.CancelledPreBoundary[tok].Add(out.CancelledPreBoundary[tok], ev.Amounts[i])
		}
		followedByWitnessedLiq := false
		for _, li := range ts.liquidatedIndexes {
			if li > ev.LogIndex && li < boundary {
				followedByWitnessedLiq = true
			}
		}
		if ev.TxHash != sw.CaseTx || followedByWitnessedLiq {
			nonzero := false
			for _, a := range ev.Amounts {
				if a.Sign() != 0 {
					nonzero = true
				}
			}
			if nonzero {
				out.Refusals = append(out.Refusals, fmt.Sprintf(
					"attributed-but-unmodeled netting release: WithdrawalCancelled at log_index %d (tx %s) frees netted amounts BEFORE a witnessed liquidation below the boundary — the replay's legs exclude the freed pending, so the replayed eligibility state it certifies is computed over the wrong basket (ruling: refuse per round-5 all-or-nothing; completing the model from the decoded amounts is the sanctioned extension, refusal is the floor)",
					ev.LogIndex, ev.TxHash.Hex()))
			}
		}
		// The remaining shape — a cancellation in the CASE'S OWN tx with no
		// witnessed Liquidated between it and L — is the case's own pass's
		// _cancelOldWithdrawal: it executes AFTER the :526 eligibility check
		// (DebtManagerCore.sol:568 → CashModuleCore.sol:228-231), so it
		// cannot move the boundary the proof certifies. Attributed, modeled
		// (the closure identity consumed its Δpending), no refusal.
	}

	sort.Strings(out.Refusals)
	if len(out.Refusals) > 0 {
		return out
	}
	out.Proven = true
	preN := 0
	for _, ev := range sw.Netting {
		if ev.LogIndex < boundary {
			preN++
		}
	}
	out.Outcome = fmt.Sprintf(
		"proven: per-token closure identity leg@N − leg@N-1 == Σ signed Transfers − Δpending holds for all %d basket token(s) at pin %s; every pre-boundary movement attributes to a custodied witness's tx (%d transfer(s) swept, %d netting event(s) swept, %d pre-boundary netting event(s) attributed); the netting channel was closed from the CashEventEmitter sweep, never assumed quiescent",
		len(sw.Tokens), sw.Pin.Hex(), len(sw.Transfers), len(sw.Netting), preN)
	return out
}

// sortedHashes / sortedAddrKeys are deterministic-iteration helpers (refusal
// ordering is part of the artifact and must not depend on map order).
func sortedHashes(m map[common.Hash]bool) []common.Hash {
	out := make([]common.Hash, 0, len(m))
	for h := range m {
		out = append(out, h)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Hex() < out[j].Hex() })
	return out
}

func sortedAddrKeys(m map[common.Address]*big.Int) []common.Address {
	out := make([]common.Address, 0, len(m))
	for a := range m {
		out = append(out, a)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Hex() < out[j].Hex() })
	return out
}

// assembleContinuitySweep issues sweeps (b) and (c) at the case's STORED pin
// and builds the proof's input set. The basket-token union is the parent legs
// ∪ the seized tokens (the ruling's list) ∪ the exec frame's own legs (a
// strictly-wider closing: an inbound NEW token would otherwise sit outside
// the swept address set and its closure violation would be invisible). ANY
// failure — transport, envelope, L6 validation, decode — returns a REFUSED
// sweep carrying the reason; the proof then refuses the case. Nothing here
// fabricates.
func assembleContinuitySweep(ctx context.Context, backend rawLogsBackend, f *gateFrame,
	key string, pin common.Hash, block uint64, boundary uint32, caseTx common.Hash,
	safe common.Address, parentLegs, execLegs []collateralLeg,
	seizures []snapshotdb.T6Seizure) *continuitySweep {
	sw := &continuitySweep{
		Pin: pin, Block: block, BoundaryLogIndex: boundary, CaseTx: caseTx, Safe: safe,
		ParentLegs: map[common.Address]*big.Int{}, ExecLegs: map[common.Address]*big.Int{},
	}
	union := map[common.Address]bool{}
	for _, l := range parentLegs {
		sw.ParentLegs[l.token] = new(big.Int).Set(l.amount)
		union[l.token] = true
	}
	for _, l := range execLegs {
		sw.ExecLegs[l.token] = new(big.Int).Set(l.amount)
		union[l.token] = true
	}
	for _, s := range seizures {
		union[common.HexToAddress(s.AssetHex)] = true
	}
	sw.Tokens = sortedAddrs(union)

	safeTopic := common.BytesToHash(common.LeftPadBytes(safe.Bytes(), 32))
	fetch := func(op string, q logsQuery) ([]sweptLog, error) {
		raw, err := backend.rawLogsAtHash(ctx, op, q)
		if err != nil {
			return nil, err
		}
		logs, err := decodeLogsEnvelope(raw)
		if err != nil {
			return nil, err
		}
		if err := validateSweepAnswer(logs, pin, q.Addresses); err != nil {
			return nil, err
		}
		return logs, nil
	}

	if len(sw.Tokens) > 0 {
		outLogs, err := fetch(fmt.Sprintf("%s:continuity:transfers-out@%d", key, block), logsQuery{
			BlockHash: pin, Addresses: sw.Tokens,
			Topics: [][]common.Hash{{topicERC20Transfer}, {safeTopic}},
		})
		if err != nil {
			sw.Refusal = "Transfer sweep (outbound, ruling L2 b) refused: " + err.Error()
			return sw
		}
		inLogs, err := fetch(fmt.Sprintf("%s:continuity:transfers-in@%d", key, block), logsQuery{
			BlockHash: pin, Addresses: sw.Tokens,
			Topics: [][]common.Hash{{topicERC20Transfer}, nil, {safeTopic}},
		})
		if err != nil {
			sw.Refusal = "Transfer sweep (inbound, ruling L2 b) refused: " + err.Error()
			return sw
		}
		// Merge the two directions; logIndex is unique per block, so it
		// dedupes a safe→safe self-transfer that answers both questions.
		seen := map[uint64]bool{}
		var merged []sweptLog
		for _, l := range append(outLogs, inLogs...) {
			if seen[l.LogIndex] {
				continue
			}
			seen[l.LogIndex] = true
			merged = append(merged, l)
		}
		sort.Slice(merged, func(i, j int) bool { return merged[i].LogIndex < merged[j].LogIndex })
		trs, err := decodeTransferSweep(merged)
		if err != nil {
			sw.Refusal = "Transfer sweep decode (ruling L6) refused: " + err.Error()
			return sw
		}
		for _, tr := range trs {
			if tr.From != safe && tr.To != safe {
				sw.Refusal = fmt.Sprintf("Transfer sweep answered a log (index %d) touching neither side of the safe — the response does not answer the question asked (ruling L6)", tr.LogIndex)
				return sw
			}
		}
		sw.Transfers = trs
		f.use(srcBTTransferSweep)
	}

	netLogs, err := fetch(fmt.Sprintf("%s:continuity:netting@%d", key, block), logsQuery{
		BlockHash: pin, Addresses: []common.Address{cashEventEmitterOP},
		Topics: [][]common.Hash{
			{topicWithdrawalRequested, topicWithdrawalAmountUpd, topicWithdrawalCancelled, topicWithdrawalProcessed},
			{safeTopic},
		},
	})
	if err != nil {
		sw.Refusal = "netting sweep (ruling L2 c) refused: " + err.Error()
		return sw
	}
	evs, err := decodeNettingSweep(netLogs, safe)
	if err != nil {
		sw.Refusal = "netting sweep decode (ruling L6) refused: " + err.Error()
		return sw
	}
	sw.Netting = evs
	f.use(srcBTNettingSweep)
	return sw
}

// overSeizureDiscrimination renders the L5 note upgrade: with sweep (c) in
// hand, the two honest over-seizure explanations are DISCRIMINATED per the
// ruling's L5 paragraph instead of listed blind.
func overSeizureDiscrimination(o continuityOutcome, sweepTaken bool) string {
	if !sweepTaken {
		return "sweep (c) unavailable for this case: the two honest explanations — (a) an unseen pre-pass inbound transfer, (b) the netting release — remain undiscriminated"
	}
	if len(o.CancelledPreBoundary) == 0 {
		return "sweep (c) observed NO pre-boundary WithdrawalCancelled for this safe — no netting release occurred, so the over-seizure is explanation (a): an unseen pre-pass inbound transfer into the Safe (collateral moves without DM events, derivation-notes caveat 4 — evidence, never excuse)"
	}
	parts := make([]string, 0, len(o.CancelledPreBoundary))
	for _, tok := range sortedAddrKeys(o.CancelledPreBoundary) {
		parts = append(parts, fmt.Sprintf("%s freed %s", tok.Hex(), o.CancelledPreBoundary[tok]))
	}
	return "sweep (c) observed a pre-boundary WithdrawalCancelled netting release (" + strings.Join(parts, "; ") +
		") — explanation (b) is evidenced for those tokens: parent legs are netted while seizure operates un-netted after _cancelOldWithdrawal (DebtManagerCore.sol:568 → CashModuleCore.sol:228-231), so a pending-withdrawal Safe over-seizes vs the netted leg with no unseen transfer at all; any residual gap beyond the freed amounts remains explanation (a)"
}
