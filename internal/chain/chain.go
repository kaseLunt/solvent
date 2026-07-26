package chain

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"math/big"
	"strings"
	"sync"
	"time"

	"github.com/ethereum/go-ethereum"
	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/common/hexutil"
	"github.com/ethereum/go-ethereum/core/types"
	"github.com/ethereum/go-ethereum/ethclient"
	"github.com/ethereum/go-ethereum/rpc"
)

// defaultAttemptTimeout bounds a single RPC attempt against one endpoint so a
// hung endpoint rotates to the next instead of stalling the walker forever.
const defaultAttemptTimeout = 30 * time.Second

type rpcClient interface {
	BlockNumber(ctx context.Context) (uint64, error)
	// ReportedHeaderByNumber returns the block's PROVIDER-REPORTED identity —
	// the hash/parentHash/number/timestamp fields of a raw
	// eth_getBlockByNumber(number, false) response, the hash taken verbatim
	// and never locally recomputed (see ReportedHeader's trust posture). A nil
	// number asks for "latest"; a nil header with a nil error means the
	// endpoint does not have the block.
	//
	// This interface deliberately carries NO method returning *types.Header:
	// a header this package cannot see is a header it cannot re-hash, so the
	// wave-5 principle — the chain layer never locally recomputes a header
	// hash — holds structurally, not by convention (the same argument
	// prices.PollChain makes by not carrying CallAtFrom).
	ReportedHeaderByNumber(ctx context.Context, number *big.Int) (*ReportedHeader, error)
	FilterLogs(ctx context.Context, q ethereum.FilterQuery) ([]types.Log, error)
	ChainID(ctx context.Context) (*big.Int, error)
	TransactionByHash(ctx context.Context, hash common.Hash) (*types.Transaction, bool, error)
	CallContract(ctx context.Context, msg ethereum.CallMsg, blockNumber *big.Int) ([]byte, error)
	// CallContractAtHash is the EIP-1898 form of CallContract: the call executes
	// against the state of the block with EXACTLY this hash, or the node rejects
	// the request ("block not found" class) — it can never be silently served
	// from a different block that happens to share the height.
	CallContractAtHash(ctx context.Context, msg ethereum.CallMsg, blockHash common.Hash) ([]byte, error)
}

// ReportedHeader is a block's identity AS THE PROVIDER REPORTS IT: the hash,
// parentHash, number and timestamp fields of the raw eth_getBlockByNumber
// response, verbatim. Every hash this package hands out comes from here.
//
// TRUST POSTURE (Task 9 wave 5; forensic proof committed at
// .superpowers/sdd/r001-probe/hashcheck.go). The previous acquisition —
// ethclient.HeaderByNumber + types.Header.Hash(), i.e. keccak over the
// re-RLP-encoded KNOWN fields — was a FALSE guarantee: go-ethereum v1.13.0
// cannot represent the 2026 OP-mainnet header shape, so its recomputation is
// silently non-canonical for every modern OP block (computed 0x70f6bea2…
// where the canonical hash of OP block 150,105,227 is 0x3d957321…; MATCH
// false, live-proven). Local recomputation is not a stronger claim than the
// provider's word — L2 consensus is NOT locally verifiable from header bytes
// — and pretending otherwise broke exactly the cross-checks it was supposed
// to strengthen. Reported hashes keep every one of those checks meaningful on
// its honest terms:
//
//   - reorg detection compares reported-now against reported-then;
//   - the walker's tip-log equality compares two provider-internal values;
//   - the EIP-1898 pin round-trips the same identity back to the node, which
//     either recognizes its own hash or rejects — a recomputed hash no node
//     ever issued is rejected FOREVER.
//
// The refusals stay, and since Task 9 wave 6 (Codex round 5) the decode is
// PRESENCE-TRACKED: every field is a pointer precisely so an omitted JSON
// field decodes as nil instead of as a plausible zero value. The previous
// non-pointer Time turned an omitted timestamp into a Unix-epoch head — a
// malformed primary could freeze failover with a false stale verdict instead
// of rotating to a healthy secondary (the F2 defect; the old types.Header
// decoder rejected a missing timestamp, and swapping in a minimal decoder
// silently dropped that gate). A mined block whose response omits hash,
// parentHash, number or timestamp — or reports a zero hash — is a provider
// protocol violation (validateReportedHeader), refused before the value can
// reach any consumer. Since Task 9 wave 7 (Codex round 6) presence is paired
// with a BYTES-level canon: number and timestamp decode through strict
// quantity wrappers (UnmarshalJSON → strictNumber/strictTime →
// checkCanonicalQuantity) because the pinned hexutil decoders read the empty
// string as ZERO — a present-but-empty quantity must fail the attempt, never
// impersonate the Unix epoch or height 0.
type ReportedHeader struct {
	Hash       *common.Hash    `json:"hash"`
	ParentHash *common.Hash    `json:"parentHash"`
	Number     *hexutil.Big    `json:"number"`
	Time       *hexutil.Uint64 `json:"timestamp"`
}

// UnmarshalJSON decodes the raw eth_getBlockByNumber result through a
// BYTES-level wire shape: the two quantity fields pass checkCanonicalQuantity
// (via the strictNumber/strictTime wrappers) BEFORE any hexutil conversion
// runs. The gate cannot live after the conversion: the pinned go-ethereum
// v1.13.0 hexutil decoders read the empty JSON string as ZERO (non-nil), so
// by the time a *hexutil.Big exists, "number":"" has already become height 0
// and "timestamp":"" the Unix epoch — presence tracking sees a present field
// and the F2 failover-stopping class walks back in through decode leniency
// (Task 9 wave 7, Codex round 6).
//
// The two HASH fields carry no analogous leniency to gate, audited: the
// pinned common.Hash decoder (hexutil.UnmarshalFixedJSON → UnmarshalFixedText)
// accepts EXACTLY a JSON string of "0x" plus 64 hex digits — "" and "0x" fail
// its length check ("hex string has length 0, want 64"), a missing prefix and
// odd lengths are named errors — so no empty or truncated hash can decode
// into a value; every malformed shape already fails the attempt. The one
// accepted residue: mixed-CASE hex digits decode (both nibble cases), which —
// unlike "" → 0 — cannot mint a wrong VALUE: the 32 decoded bytes are
// identical either way and every downstream comparison uses the decoded
// value. Fixed-length DATA therefore stays on the library's exact-length
// gate; the canon gate is scoped to QUANTITIES, where leniency manufactures
// values out of non-answers. (VARIABLE-length data — a log's payload, a
// transaction's input — has no exact-length gate to lean on and carries its
// own bytes canon since Task 9 wave 8: checkCanonicalData.)
func (rh *ReportedHeader) UnmarshalJSON(input []byte) error {
	var w struct {
		Hash       *common.Hash  `json:"hash"`
		ParentHash *common.Hash  `json:"parentHash"`
		Number     *strictNumber `json:"number"`
		Time       *strictTime   `json:"timestamp"`
	}
	if err := json.Unmarshal(input, &w); err != nil {
		return err
	}
	rh.Hash = w.Hash
	rh.ParentHash = w.ParentHash
	rh.Number = (*hexutil.Big)(w.Number)
	rh.Time = (*hexutil.Uint64)(w.Time)
	return nil
}

// strictNumber and strictTime are ReportedHeader's two quantity fields at the
// bytes level: hexutil values whose decode is gated by checkCanonicalQuantity
// first. Each wrapper covers exactly one field, so a violation names the
// field it arrived in and each field's gate is independently attackable (the
// wave-7 mutation matrix bypasses them one at a time). An omitted or null
// field never reaches a wrapper — encoding/json leaves the pointer nil — so
// presence tracking (wave 6) is untouched: absence still surfaces as absence,
// and the wrapper judges only bytes that claim to BE a quantity.
type strictNumber hexutil.Big

func (q *strictNumber) UnmarshalJSON(input []byte) error {
	if err := checkCanonicalQuantity("header response number", input); err != nil {
		return err
	}
	return (*hexutil.Big)(q).UnmarshalJSON(input)
}

type strictTime hexutil.Uint64

func (q *strictTime) UnmarshalJSON(input []byte) error {
	if err := checkCanonicalQuantity("header response timestamp", input); err != nil {
		return err
	}
	return (*hexutil.Uint64)(q).UnmarshalJSON(input)
}

// checkCanonicalQuantity is the wave-7 rule (Codex round 6): "the response
// must answer the question asked" holds at the BYTES level. raw is the
// untouched JSON text of one quantity field, and it either IS a canonical
// JSON-RPC quantity or the attempt fails — violation = failed attempt =
// rotation, the uniform posture of every gate in this file. field names the
// wire location the bytes arrived in ("header response number",
// "eth_blockNumber response result"): since Task 9 wave 8 (Codex round 7)
// the canon guards EVERY quantity this package decodes from an RPC
// response, not only the header's two — the arms below are unchanged, only
// the naming generalized.
//
// THE CANON, pinned: a canonical JSON-RPC quantity is exactly what the
// reference encoder (hexutil.EncodeUint64 / hexutil.EncodeBig — the same
// pinned library that decodes) emits for some value: a JSON string holding
// "0x" followed by one or more lowercase hex digits [0-9a-f], the first digit
// nonzero unless the whole digit string is exactly "0". Canonical bytes
// round-trip decode∘encode to themselves; nothing else does. Rejected BY
// NAME, in check order:
//
//   - not a JSON string (bare number, object, array, boolean);
//   - the empty string — THE round-6 finding: v1.13.0's *hexutil.Big and
//     *hexutil.Uint64 decode "" as ZERO (non-nil), so "timestamp":"" passed
//     the wave-6 presence gate as the Unix epoch and "number":"" passed
//     HeadFrom as height 0 — the F2 failover-stopping class one decoder
//     layer down;
//   - a string without the "0x" prefix;
//   - "0x" with no digits (the spec: zero is "0x0");
//   - leading zero digits (the spec: the most compact representation);
//   - any byte after the prefix that is not a lowercase hex digit —
//     uppercase decodes to the same value under hexutil, but a
//     representation the reference encoder can never emit is not the
//     protocol's answer, and acceptance leniency one layer below the gates
//     is exactly how this finding class survives.
//
// Canon is decidable from the bytes alone, which is why the gate runs BEFORE
// hexutil: nothing hexutil tolerates can reach it. Where the canon and
// hexutil's own strictness overlap (missing prefix, "0x", leading zeros), the
// gate still owns the rejection — the refusal must never RELY on the leniency
// profile of the library whose "" → 0 is the finding.
func checkCanonicalQuantity(field string, raw []byte) error {
	violation := func(reason string) error {
		return fmt.Errorf("%s %s is not a canonical JSON-RPC quantity (%s) — a provider protocol violation; the response must answer the question asked at the bytes level, so a non-answer is refused before a lenient decoder can turn it into a plausible value", field, raw, reason)
	}
	if len(raw) < 2 || raw[0] != '"' || raw[len(raw)-1] != '"' {
		return violation("not a JSON string")
	}
	s := raw[1 : len(raw)-1]
	if len(s) == 0 {
		return violation("empty — an empty quantity is a non-answer, not zero")
	}
	if len(s) < 2 || s[0] != '0' || s[1] != 'x' {
		return violation(`missing the "0x" prefix`)
	}
	digits := s[2:]
	if len(digits) == 0 {
		return violation(`"0x" carries no digits — zero is "0x0"`)
	}
	if len(digits) > 1 && digits[0] == '0' {
		return violation("leading zero digits — the canon is the most compact representation")
	}
	for _, c := range digits {
		if (c < '0' || c > '9') && (c < 'a' || c > 'f') {
			return violation(fmt.Sprintf("%q is not a lowercase hex digit", c))
		}
	}
	return nil
}

// checkCanonicalData is checkCanonicalQuantity's sibling for VARIABLE-length
// data payloads — a log's data, a transaction's input (Task 9 wave 8, Codex
// round 7). raw is the untouched JSON text of one field, and it either IS
// canonical hex data — exactly what the reference encoder (hexutil.Encode,
// the same pinned library that decodes) emits for some byte string: a JSON
// string holding "0x" followed by an EVEN number of lowercase hex digits,
// zero digits included ("0x" IS the canonical empty payload, unlike a
// quantity's "0x0") — or the attempt fails.
//
// The leniency it closes, audit-executed against the pinned v1.13.0:
// hexutil.Bytes decodes the empty string "" as an EMPTY payload without
// error, so a non-answer impersonates "this log/transaction carried no
// data" — and unlike the fixed-length hash fields there is no exact-length
// gate underneath to refuse it. The minted empty payload is not a transient
// routing wart: log data is PERSISTED as the raw-log source of truth and
// calldata is DERIVED FROM (the migration-genesis borrower seeds), so the
// non-answer must be refused before the lenient decoder turns it into a
// plausible value. Uppercase digits decode too (to the same bytes), and the
// wave-7 reference-encoder argument applies unchanged: a representation the
// encoder can never emit is not the protocol's answer. Check order and
// violation shape mirror the quantity canon; odd digit counts are named
// (data is whole bytes), and where the canon overlaps hexutil's own
// strictness (odd length, missing prefix, non-string) the gate still owns
// the rejection — the refusal must never rely on the leniency profile of
// the library whose "" → empty is the finding.
func checkCanonicalData(field string, raw []byte) error {
	violation := func(reason string) error {
		return fmt.Errorf("%s %s is not canonical JSON-RPC hex data (%s) — a provider protocol violation; the response must answer the question asked at the bytes level, so a non-answer is refused before a lenient decoder can turn it into a plausible value", field, raw, reason)
	}
	if len(raw) < 2 || raw[0] != '"' || raw[len(raw)-1] != '"' {
		return violation("not a JSON string")
	}
	s := raw[1 : len(raw)-1]
	if len(s) == 0 {
		return violation(`empty — an empty payload is a non-answer; the canonical empty payload is "0x"`)
	}
	if len(s) < 2 || s[0] != '0' || s[1] != 'x' {
		return violation(`missing the "0x" prefix`)
	}
	digits := s[2:]
	if len(digits)%2 != 0 {
		return violation("odd digit count — hex data encodes whole bytes")
	}
	for _, c := range digits {
		if (c < '0' || c > '9') && (c < 'a' || c > 'f') {
			return violation(fmt.Sprintf("%q is not a lowercase hex digit", c))
		}
	}
	return nil
}

// validateReportedHeader is the protocol gate every header read passes
// through, and THE RULE lives here (Task 9 wave 6, Codex round 5): trusting
// the provider's REPORTED fields is only sound when paired with verifying the
// response ANSWERS THE QUESTION ASKED. Concretely:
//
//   - a nil header is an honest "not found" — the legitimate answer for a
//     block beyond the endpoint's head. It surfaces AS not-found: it is NOT a
//     protocol violation, and it is never fabricated into a zero header.
//   - a PRESENT block must carry every required field: hash, parentHash,
//     number, timestamp. The struct's fields are pointers so absence is
//     decodable (F2): an omitted timestamp is a protocol violation, not a
//     Unix-epoch head that stops failover at a malformed primary.
//   - a reported ZERO hash stays refused (the wave-5 gate): an anchor holding
//     it would "verify" against nothing during reorg repair.
//   - the number must be a uint64, and on every NUMBERED read (want non-nil)
//     it must EQUAL the height the caller asked for (F1). A well-formed
//     header for the WRONG height — a proxy answering "latest" for numeric
//     requests — would date HeaderTime's freshness measurement off the wrong
//     block and feed walker ancestry a hash for a block nobody asked about
//     (spurious mass rewind instead of rotation). Head reads (want nil)
//     validate internal consistency only: "latest" pins no height, so there
//     is no asked question to compare against.
//
// Any violation FAILS THE ATTEMPT: the failover walk rotates to the next
// endpoint, exactly the zero-hash posture, uniformly applied — nothing in a
// protocol-violating response is trustworthy, so no field of it may influence
// any consumer.
func validateReportedHeader(rh *ReportedHeader, what string, want *uint64) error {
	if rh == nil {
		return fmt.Errorf("header %s not found", what)
	}
	var missing []string
	if rh.Hash == nil {
		missing = append(missing, "hash")
	}
	if rh.ParentHash == nil {
		missing = append(missing, "parentHash")
	}
	if rh.Number == nil {
		missing = append(missing, "number")
	}
	if rh.Time == nil {
		missing = append(missing, "timestamp")
	}
	if len(missing) > 0 {
		return fmt.Errorf("header %s response omits required field(s) %s — a provider protocol violation; an absent field must surface as absent, never decode as a plausible zero value", what, strings.Join(missing, ", "))
	}
	if *rh.Hash == (common.Hash{}) {
		return fmt.Errorf("header %s reports a zero hash — a provider protocol violation; refusing to hand out an unverifiable block identity", what)
	}
	if !(*big.Int)(rh.Number).IsUint64() {
		return fmt.Errorf("header %s reports number %v, not a uint64", what, rh.Number)
	}
	if want != nil && (*big.Int)(rh.Number).Uint64() != *want {
		return fmt.Errorf("header %s response answers for height %d — a provider protocol violation; a numbered read serves exactly the block asked for or fails the attempt", what, (*big.Int)(rh.Number).Uint64())
	}
	return nil
}

// endpointClient is one endpoint's rpcClient: go-ethereum's typed client for
// every call that consumes decoded VALUES, plus the raw connection for the
// one read the typed client cannot be trusted with — a header's identity.
// ethclient.HeaderByNumber decodes into types.Header and DERIVES the hash by
// re-RLP-hashing the fields it knows, which is silently non-canonical on any
// chain whose header shape is newer than the vendored geth (the live-proven
// OP case; see ReportedHeader). The raw response's own hash field is the only
// honest source, so header identity reads go through the raw client.
type endpointClient struct {
	*ethclient.Client
	raw *rpc.Client
}

func (e *endpointClient) ReportedHeaderByNumber(ctx context.Context, number *big.Int) (*ReportedHeader, error) {
	arg := "latest"
	if number != nil {
		arg = hexutil.EncodeBig(number)
	}
	var rh *ReportedHeader
	if err := e.raw.CallContext(ctx, &rh, "eth_getBlockByNumber", arg, false); err != nil {
		return nil, err
	}
	return rh, nil // nil (not found) when the endpoint answered null
}

// BlockNumber shadows the embedded ethclient method with a strict raw
// quantity decode (Task 9 wave 8, Codex round 7). The typed client decodes
// eth_blockNumber straight into hexutil.Uint64, where the empty string
// becomes height ZERO without error (audit-executed against the pinned
// v1.13.0): the closure records zero, the attempt SUCCEEDS, no rotation
// happens, and Walker.Step sees a head below confirmations and repeatedly
// makes no progress despite a healthy secondary — the F2 failover-stopping
// class through the one head-probe path the walker paces itself by. The raw
// result passes checkCanonicalQuantity BEFORE any hexutil conversion, so a
// non-answer fails the attempt and rotates.
//
// The strict-raw-decode form was chosen over Codex's alternative (deriving
// the height from the strictly decoded latest header) because it keeps the
// QUESTION on the wire unchanged: eth_blockNumber stays eth_blockNumber —
// the recorded-ask regressions pin it — rather than becoming
// eth_getBlockByNumber("latest"), which would couple the walker's cheap
// head probe to full-header availability and silently conflate two
// provider surfaces the failover measures separately. One-fetch-path
// uniformity is real for header IDENTITY reads (wave 5), but a height
// probe asks a different question, and the gate belongs on the answer to
// the question actually asked.
func (e *endpointClient) BlockNumber(ctx context.Context) (uint64, error) {
	var raw json.RawMessage
	if err := e.raw.CallContext(ctx, &raw, "eth_blockNumber"); err != nil {
		return 0, err
	}
	if err := checkCanonicalQuantity("eth_blockNumber response result", raw); err != nil {
		return 0, err
	}
	var v hexutil.Uint64
	if err := json.Unmarshal(raw, &v); err != nil {
		return 0, err
	}
	return uint64(v), nil
}

// ChainID shadows the embedded ethclient method with the same strict raw
// quantity decode (Task 9 wave 8 sweep). The typed path decodes eth_chainId
// into hexutil.Big, where "" becomes chain id ZERO without error.
// VerifyChainID's equality check would still refuse the minted zero against
// any real configured chain id — but that refusal would RELY on a
// wrong-value comparison one layer up, the exact leniency dependence the
// wave-7 canon forbids (and for a hypothetical want of zero it would not
// refuse at all). The violation is named at the bytes instead. On this
// every-endpoint-must-agree path a violation fails the whole verification
// rather than rotating — VerifyChainID's designed posture, unchanged.
func (e *endpointClient) ChainID(ctx context.Context) (*big.Int, error) {
	var raw json.RawMessage
	if err := e.raw.CallContext(ctx, &raw, "eth_chainId"); err != nil {
		return nil, err
	}
	if err := checkCanonicalQuantity("eth_chainId response result", raw); err != nil {
		return nil, err
	}
	var v hexutil.Big
	if err := json.Unmarshal(raw, &v); err != nil {
		return nil, err
	}
	return (*big.Int)(&v), nil
}

// reportedLog is one eth_getLogs entry AS THE PROVIDER REPORTS IT, at the
// bytes level — ReportedHeader's wire-shape pattern extended to the
// package's second raw decode path (Task 9 wave 8, Codex round 7). The
// pinned types.Log decoder is lenient in exactly the ways the canon
// forbids, audit-executed against v1.13.0: its quantity fields decode ""
// as a PRESENT ZERO (blockNumber, logIndex, transactionIndex), its
// optional fields decode ABSENCE as zero values (an omitted blockHash
// silently becomes the zero hash; an omitted logIndex becomes index 0),
// and its data field decodes "" as an empty payload. A log's blockNumber
// and logIndex are the raw-log IDENTITY AND ORDER the store persists as
// source of truth, so a minted zero here is not a transient routing wart —
// it corrupts derivation ordering at the root. Every field is therefore a
// pointer (presence-tracked, the wave-6 rule), every consumed quantity
// decodes through a per-field strict wrapper and the payload through the
// data canon (the wave-7 rule, one wrapper per field so the violation
// names the field it arrived in), and validateReportedLog holds the
// presence and zero-hash gates. Any violation fails the WHOLE attempt —
// violation = failed attempt = rotation, the file's uniform posture.
type reportedLog struct {
	Address     *common.Address   `json:"address"`
	Topics      []common.Hash     `json:"topics"`
	Data        *strictLogData    `json:"data"`
	BlockNumber *strictLogNumber  `json:"blockNumber"`
	TxHash      *common.Hash      `json:"transactionHash"`
	TxIndex     *strictLogTxIndex `json:"transactionIndex"`
	BlockHash   *common.Hash      `json:"blockHash"`
	Index       *strictLogIndex   `json:"logIndex"`
	Removed     *bool             `json:"removed"`
}

// strictLogNumber, strictLogIndex, strictLogTxIndex and strictLogData are
// reportedLog's consumed wire fields at the bytes level — one wrapper per
// field, so each field's gate is independently attackable (the wave-8
// mutation matrix bypasses them one at a time) and a violation names its
// field. An omitted or null field never reaches a wrapper — encoding/json
// leaves the pointer nil — so absence stays validateReportedLog's question;
// the wrappers judge only bytes that claim to BE an answer.
type strictLogNumber hexutil.Uint64

func (q *strictLogNumber) UnmarshalJSON(input []byte) error {
	if err := checkCanonicalQuantity("log response blockNumber", input); err != nil {
		return err
	}
	return (*hexutil.Uint64)(q).UnmarshalJSON(input)
}

type strictLogIndex hexutil.Uint

func (q *strictLogIndex) UnmarshalJSON(input []byte) error {
	if err := checkCanonicalQuantity("log response logIndex", input); err != nil {
		return err
	}
	return (*hexutil.Uint)(q).UnmarshalJSON(input)
}

type strictLogTxIndex hexutil.Uint

func (q *strictLogTxIndex) UnmarshalJSON(input []byte) error {
	if err := checkCanonicalQuantity("log response transactionIndex", input); err != nil {
		return err
	}
	return (*hexutil.Uint)(q).UnmarshalJSON(input)
}

type strictLogData hexutil.Bytes

func (b *strictLogData) UnmarshalJSON(input []byte) error {
	if err := checkCanonicalData("log response data", input); err != nil {
		return err
	}
	return (*hexutil.Bytes)(b).UnmarshalJSON(input)
}

// validateReportedLog is validateReportedHeader's sibling for one
// eth_getLogs entry. Every field this package's consumers read must be
// PRESENT: eth_getLogs answers a numbered block range, so every returned
// log is MINED — the pending-log shape that legitimately omits block
// coordinates cannot occur on this path, and an absence is a provider
// protocol violation, never a zero value. Reported hash identities must be
// nonzero (the wave-5 posture: an identity of all zeroes verifies against
// nothing — the audit confirmed the fixed-length gate happily decodes 64
// zero digits). `removed` is the ONE optional field, deliberately: its
// absence decodes as false, the only honest value a mined-range query can
// carry (removal markers belong to filter-change notifications); a present
// `true` is refused by the walker's batch validation, and a present
// non-bool is an encoding/json type error that already fails the attempt
// (audit-executed). The topics slice must be present but MAY be empty — an
// anonymous LOG0 event carries no topics, and refusing [] would be
// over-tightening (the wave-6 lesson's other face).
func validateReportedLog(l *reportedLog, position int) error {
	var missing []string
	if l.Address == nil {
		missing = append(missing, "address")
	}
	if l.Topics == nil {
		missing = append(missing, "topics")
	}
	if l.Data == nil {
		missing = append(missing, "data")
	}
	if l.BlockNumber == nil {
		missing = append(missing, "blockNumber")
	}
	if l.TxHash == nil {
		missing = append(missing, "transactionHash")
	}
	if l.TxIndex == nil {
		missing = append(missing, "transactionIndex")
	}
	if l.BlockHash == nil {
		missing = append(missing, "blockHash")
	}
	if l.Index == nil {
		missing = append(missing, "logIndex")
	}
	if len(missing) > 0 {
		return fmt.Errorf("log response entry %d omits required field(s) %s — a provider protocol violation; an absent field must surface as absent, never decode as a plausible zero value", position, strings.Join(missing, ", "))
	}
	if *l.BlockHash == (common.Hash{}) {
		return fmt.Errorf("log response entry %d reports a zero blockHash — a provider protocol violation; refusing to persist an unverifiable block identity", position)
	}
	if *l.TxHash == (common.Hash{}) {
		return fmt.Errorf("log response entry %d reports a zero transactionHash — a provider protocol violation; refusing to persist an unverifiable log identity", position)
	}
	return nil
}

// FilterLogs shadows the embedded ethclient method with a raw, gated decode
// (Task 9 wave 8, Codex round 7). ethclient.FilterLogs decodes straight
// into types.Log, whose pinned decoder turns "" quantities into present
// zeros and absences into zero values — so an otherwise valid mined log
// with "logIndex":"" made the attempt SUCCEED, stopped failover at the
// malformed primary, and handed downstream validation a plausible index
// zero to persist as the raw-log identity/order. The raw result now
// decodes through reportedLog (strict wrappers + presence + zero-hash
// gates) BEFORE conversion to types.Log, and a null result — which the
// typed path silently serves as an empty window (audit-executed) — is a
// protocol violation: the provider's honest "no logs in this range" is [],
// and a non-answer must not impersonate it. The QUESTION on the wire is
// unchanged — filterArg mirrors the pinned client's toFilterArg byte for
// byte — only the answer's decode gained gates. Violations fail the
// attempt; rotation is doFrom's, uniformly.
func (e *endpointClient) FilterLogs(ctx context.Context, q ethereum.FilterQuery) ([]types.Log, error) {
	arg, err := filterArg(q)
	if err != nil {
		return nil, err
	}
	var raw json.RawMessage
	if err := e.raw.CallContext(ctx, &raw, "eth_getLogs", arg); err != nil {
		return nil, err
	}
	if trimmed := bytes.TrimSpace(raw); len(trimmed) == 0 || bytes.Equal(trimmed, []byte("null")) {
		return nil, fmt.Errorf("log response result is null — a provider protocol violation; an empty window is answered with [], so a null non-answer is refused before it can impersonate one")
	}
	var wire []reportedLog
	if err := json.Unmarshal(raw, &wire); err != nil {
		return nil, err
	}
	out := make([]types.Log, len(wire))
	for i := range wire {
		l := &wire[i]
		if err := validateReportedLog(l, i); err != nil {
			return nil, err
		}
		var removed bool
		if l.Removed != nil {
			removed = *l.Removed
		}
		out[i] = types.Log{
			Address:     *l.Address,
			Topics:      l.Topics,
			Data:        []byte(*l.Data),
			BlockNumber: uint64(*l.BlockNumber),
			TxHash:      *l.TxHash,
			TxIndex:     uint(*l.TxIndex),
			BlockHash:   *l.BlockHash,
			Index:       uint(*l.Index),
			Removed:     removed,
		}
	}
	return out, nil
}

// filterArg and blockNumArg mirror the pinned ethclient's toFilterArg and
// toBlockNumArg exactly (go-ethereum v1.13.0), so FilterLogs' raw decode
// changes NOTHING about the question on the wire — same params, same
// encodings, same BlockHash/range exclusivity error. Kept verbatim rather
// than simplified to this package's actual call shape (numbered from/to,
// addresses only) so the override can never silently ask a different
// question than the typed client it shadows.
func filterArg(q ethereum.FilterQuery) (interface{}, error) {
	arg := map[string]interface{}{
		"address": q.Addresses,
		"topics":  q.Topics,
	}
	if q.BlockHash != nil {
		arg["blockHash"] = *q.BlockHash
		if q.FromBlock != nil || q.ToBlock != nil {
			return nil, fmt.Errorf("cannot specify both BlockHash and FromBlock/ToBlock")
		}
		return arg, nil
	}
	if q.FromBlock == nil {
		arg["fromBlock"] = "0x0"
	} else {
		arg["fromBlock"] = blockNumArg(q.FromBlock)
	}
	arg["toBlock"] = blockNumArg(q.ToBlock)
	return arg, nil
}

func blockNumArg(number *big.Int) string {
	if number == nil {
		return "latest"
	}
	if number.Sign() >= 0 {
		return hexutil.EncodeBig(number)
	}
	// Negative numbers are the rpc package's named specials.
	if number.IsInt64() {
		return rpc.BlockNumber(number.Int64()).String()
	}
	return fmt.Sprintf("<invalid %d>", number)
}

// strictTxInput is the transaction's input field at the bytes level — the
// ONE field TxCalldata consumes from the transaction envelope, gated by
// the data canon exactly like a log's payload.
type strictTxInput hexutil.Bytes

func (b *strictTxInput) UnmarshalJSON(input []byte) error {
	if err := checkCanonicalData("transaction response input", input); err != nil {
		return err
	}
	return (*hexutil.Bytes)(b).UnmarshalJSON(input)
}

// TransactionByHash shadows the embedded ethclient method to gate the one
// field this package consumes from it (Task 9 wave 8 sweep). TxCalldata
// reads tx.Data() alone, and the pinned transaction decoder reads
// "input":"" as an EMPTY calldata payload without error (audit-executed) —
// a non-answer impersonating "this transaction carried no data", which on
// the migration-genesis path would mint zero borrower seeds out of a
// malformed response. The raw result's input bytes pass checkCanonicalData
// and a presence check (the pinned decoder also refuses an omitted input,
// but the refusal must not RELY on the lenient library's required-field
// list), then the SAME raw bytes decode through types.Transaction exactly
// as the typed client would.
//
// THE RESPONSE MUST ANSWER THE QUESTION ASKED, AND THE ANSWER MUST BE
// AUTHENTICATED (the wave-6 rule, completed by Task 9 wave 9 after Codex
// round 8): a hash-keyed read serves exactly the transaction asked for.
// The response's reported hash field is required present and EQUAL to the
// asked hash — kept as a cheap early tripwire for sloppier lies — but the
// GATE is the decoded comparison after it: tx.Hash() recomputed over the
// decoded body must equal the asked hash, or the attempt fails and
// rotates. The controller's round-8 adjudication line, verbatim, because
// waves 5 and 9 could otherwise read as contradictory:
//
//	Local recomputation is BANNED where the pinned library's type model
//	is incomplete (headers — wave 5's law: v1.13.0 cannot represent
//	modern OP headers, so a computed header hash is garbage), and
//	REQUIRED where the type model is complete and recomputation is the
//	only authentication (signed transactions — `tx.Hash()` over the
//	decoded body is consensus-stable for every type v1.13.0 can decode,
//	and a tx type it cannot decode fails loudly into rotation). The
//	reported `hash` FIELD authenticates nothing: the decoder ignores it,
//	so it is merely the provider agreeing with itself.
//
// Both arms follow from one principle: authenticate with the strongest
// tool the type model makes sound. Without the decoded comparison, a
// provider echoing the asked hash over ANOTHER transaction's signed body
// passes the field check — echoing the label cannot authenticate the
// body — and TxCalldata would silently feed the deriver the substituted
// transaction's calldata. The undecodable-type arm is structural, not
// aspirational: a tx type the pinned decoder cannot represent errors out
// of json.Unmarshal below and fails the attempt into rotation, so no
// body ever reaches a recomputation the type model cannot make sound.
//
// Mirrored from the pinned ethclient: a null result is ethereum.NotFound
// (the honest not-found, exactly the header path's discrimination), a
// signature-less response is refused verbatim, and pending-ness is
// blockNumber's absence. NOT mirrored, disclosed: the sender-address cache
// (setSenderFromServer) — TxCalldata never reads the sender, no other
// caller consumes this method, and a Sender() call would fall back to
// signature recovery rather than misbehave.
func (e *endpointClient) TransactionByHash(ctx context.Context, hash common.Hash) (*types.Transaction, bool, error) {
	var raw json.RawMessage
	if err := e.raw.CallContext(ctx, &raw, "eth_getTransactionByHash", hash); err != nil {
		return nil, false, err
	}
	if trimmed := bytes.TrimSpace(raw); len(trimmed) == 0 || bytes.Equal(trimmed, []byte("null")) {
		return nil, false, ethereum.NotFound
	}
	var probe struct {
		Hash        *common.Hash     `json:"hash"`
		Input       *strictTxInput   `json:"input"`
		BlockNumber *json.RawMessage `json:"blockNumber"`
	}
	if err := json.Unmarshal(raw, &probe); err != nil {
		return nil, false, err
	}
	if probe.Input == nil {
		return nil, false, fmt.Errorf("transaction response omits required field input — a provider protocol violation; an absent field must surface as absent, never decode as a plausible zero value")
	}
	if probe.Hash == nil {
		return nil, false, fmt.Errorf("transaction response omits required field hash — a provider protocol violation; an absent field must surface as absent, never decode as a plausible zero value")
	}
	if *probe.Hash != hash {
		return nil, false, fmt.Errorf("transaction response answers for transaction %s — a provider protocol violation; a hash-keyed read serves exactly the transaction asked for or fails the attempt", *probe.Hash)
	}
	var tx types.Transaction
	if err := json.Unmarshal(raw, &tx); err != nil {
		return nil, false, err
	}
	if _, r, _ := tx.RawSignatureValues(); r == nil {
		return nil, false, fmt.Errorf("server returned transaction without signature")
	}
	// The identity GATE (Task 9 wave 9): the decoded body must hash to the
	// asked hash. The reported-field equality above is only a tripwire —
	// the doc comment carries the adjudication's recomputation line — and
	// a decoded body that is not the transaction asked for is a protocol
	// violation that fails the attempt into rotation.
	if recomputed := tx.Hash(); recomputed != hash {
		return nil, false, fmt.Errorf("transaction response body hashes to %s, not the asked %s — a provider protocol violation; the reported hash field is the provider agreeing with itself, so only the hash recomputed over the decoded signed body authenticates the answer, and echoing the label cannot authenticate the body", recomputed, hash)
	}
	return &tx, probe.BlockNumber == nil, nil
}

// EndpointToken identifies which endpoint served a successful semantic-layer
// call (CallWithToken / CallFrom). A caller that later judges that response
// semantically unusable (e.g. an endpoint frozen on stale chain state, which
// never fails at the RPC layer and so never trips error-driven rotation)
// routes ITSELF around that exact endpoint on subsequent calls — CallFrom
// starting one past Token.Index — a caller-scoped exclusion that leaves the
// shared routing hint alone.
type EndpointToken struct {
	// Index is the position of the serving endpoint in the failover's client
	// list; -1 when the call failed on every endpoint (nothing to reject).
	Index int
}

type Failover struct {
	clients []rpcClient
	mu      sync.Mutex
	// active is a routing hint, not a health registry: it always names the
	// endpoint that most recently succeeded on the SHARED path (do). Under
	// concurrent callers the last writer wins, which is safe — every
	// candidate value refers to an endpoint that just served a successful
	// call. Callers holding a SEMANTIC exclusion (a "successful" response
	// judged unusable, e.g. an endpoint frozen on stale chain state, which
	// never fails at the RPC layer and so never trips do's error-driven
	// rotation) deliberately do NOT write this hint: they route themselves
	// around the bad endpoint with CallFrom, which neither reads nor writes
	// active. A shared hint cannot carry a caller-specific exclusion — any
	// other caller's success on the excluded endpoint would legitimately
	// re-pin the hint right back onto it.
	active int
	// attemptTimeout bounds each per-endpoint attempt inside doFrom.
	attemptTimeout time.Duration
}

func Dial(ctx context.Context, urls []string) (*Failover, error) {
	if len(urls) == 0 {
		return nil, fmt.Errorf("no rpc urls given")
	}
	clients := make([]rpcClient, 0, len(urls))
	for _, u := range urls {
		// Dial the RAW connection and wrap the typed client around it: the
		// typed client serves the value-decoding calls, and the raw handle
		// serves ReportedHeaderByNumber, whose whole point is to bypass the
		// typed client's hash recomputation (see endpointClient).
		rc, err := rpc.DialContext(ctx, u)
		if err != nil {
			return nil, fmt.Errorf("dial %s: %w", u, err)
		}
		clients = append(clients, &endpointClient{Client: ethclient.NewClient(rc), raw: rc})
	}
	return newFailover(clients), nil
}

func newFailover(clients []rpcClient) *Failover {
	return &Failover{clients: clients, attemptTimeout: defaultAttemptTimeout}
}

// do walks the endpoints starting from the sticky active hint and, on
// success, re-pins the hint onto the endpoint that served the attempt —
// SHARED-path routing, moved only by observed successes and failures (see
// doFrom for the walk itself). Semantic-layer callers with an endpoint
// exclusion use CallFrom instead, which bypasses this hint entirely.
func (f *Failover) do(ctx context.Context, op string, fn func(ctx context.Context, c rpcClient) error) (int, error) {
	f.mu.Lock()
	start := f.active
	f.mu.Unlock()

	idx, err := f.doFrom(ctx, op, start, fn)
	if err != nil {
		return idx, err
	}
	f.mu.Lock()
	f.active = idx
	f.mu.Unlock()
	return idx, nil
}

// doFrom walks the endpoints starting at start, rotating on error, and
// returns the index of the endpoint that served the successful attempt (-1
// when all failed). Each attempt is bounded by attemptTimeout so a hung
// endpoint fails its attempt and rotates instead of blocking on the caller's
// (possibly unbounded) context. doFrom itself NEVER touches the shared
// active hint: do layers the sticky re-pin on top for shared-path callers,
// while CallFrom deliberately does not — a caller-scoped routing preference
// must not fight the error-driven routing other callers depend on.
func (f *Failover) doFrom(ctx context.Context, op string, start int, fn func(ctx context.Context, c rpcClient) error) (int, error) {
	var lastErr error
	for i := 0; i < len(f.clients); i++ {
		if err := ctx.Err(); err != nil {
			return -1, fmt.Errorf("%s aborted: %w", op, err)
		}
		idx := (start + i) % len(f.clients)
		attemptCtx, cancel := context.WithTimeout(ctx, f.attemptTimeout)
		err := fn(attemptCtx, f.clients[idx])
		cancel()
		if err != nil {
			lastErr = err
			slog.Warn("rpc endpoint failed, rotating", "op", op, "endpoint", idx, "err", err)
			continue
		}
		return idx, nil
	}
	return -1, fmt.Errorf("all rpc endpoints failed (%s): %w", op, lastErr)
}

// AttemptError is ONE endpoint's own failure inside the pinned-call walk
// (CallAtHashFrom), named by the endpoint that produced it — the token
// discipline mirrored onto failures: EndpointToken names the endpoint that
// served a success, and an attempt record names the endpoint that produced
// each failure, so a caller judging the walk's OUTCOME can see what every
// attempted endpoint said instead of only what the last one said.
type AttemptError struct {
	// Endpoint is the failing endpoint's position in the failover's client
	// list — the index the EndpointToken would have carried had this attempt
	// succeeded.
	Endpoint int
	// Err is that endpoint's own error, verbatim and unwrapped: recognizing
	// a rejection class in it is the caller's per-attempt judgment to make.
	Err error
}

// PinnedCallError is the PINNED-CALL path's total-failure error: every
// attempted endpoint failed, and every per-attempt outcome is RETAINED in
// walk order. Additive for Task 9 wave 4 (Codex round 3 [medium]): doFrom
// keeps only the LAST endpoint's error, which made the price poller's
// round-outcome classification depend on failover ORDER — endpoint 0
// transport-failing while endpoint 1 rejects the pin read as a discard when
// the walk started at 0 and as an error when it started at 1, for the same
// persistent outage. The aggregate is what lets the caller hold ONE
// classification authority per outcome: a posture computed over EVERY
// attempt, never over whichever attempt happened to run last.
//
// Error() and Unwrap() deliberately mirror doFrom's total-failure shape —
// "all rpc endpoints failed (op): <last error>", unwrapping to the last
// attempt's error — so surfaced wording and errors.Is/As chains over the
// last error are unchanged for every existing consumer.
type PinnedCallError struct {
	// Op names the failed operation, doFrom's wording ("callAtHash").
	Op string
	// Attempts holds every attempted endpoint's own failure, in walk order.
	// Never empty: the walk constructs this error only after at least one
	// attempt failed (a pre-attempt context abort returns a plain error).
	Attempts []AttemptError
}

func (e *PinnedCallError) Error() string {
	return fmt.Sprintf("all rpc endpoints failed (%s): %v", e.Op, e.last())
}

// Unwrap exposes the LAST attempt's error — doFrom's %w target — so existing
// matching against the surfaced error keeps working unchanged.
func (e *PinnedCallError) Unwrap() error { return e.last() }

func (e *PinnedCallError) last() error {
	if len(e.Attempts) == 0 {
		return nil
	}
	return e.Attempts[len(e.Attempts)-1].Err
}

// doFromAttempts is doFrom's exact walk with the per-attempt failures
// RETAINED: the same rotation, the same per-attempt timeout, the same
// abort-on-context behavior — but a total failure returns a *PinnedCallError
// carrying every attempted endpoint's own error instead of only the last
// one. It exists for the PINNED-CALL path alone (CallAtHashFrom, Task 9
// wave 4's sanctioned additive change); every other method keeps doFrom, so
// no other caller's error shape moves.
func (f *Failover) doFromAttempts(ctx context.Context, op string, start int, fn func(ctx context.Context, c rpcClient) error) (int, error) {
	var attempts []AttemptError
	for i := 0; i < len(f.clients); i++ {
		if err := ctx.Err(); err != nil {
			return -1, fmt.Errorf("%s aborted: %w", op, err)
		}
		idx := (start + i) % len(f.clients)
		attemptCtx, cancel := context.WithTimeout(ctx, f.attemptTimeout)
		err := fn(attemptCtx, f.clients[idx])
		cancel()
		if err != nil {
			attempts = append(attempts, AttemptError{Endpoint: idx, Err: err})
			slog.Warn("rpc endpoint failed, rotating", "op", op, "endpoint", idx, "err", err)
			continue
		}
		return idx, nil
	}
	return -1, &PinnedCallError{Op: op, Attempts: attempts}
}

// NOTE: RotateAwayFrom (the shared-hint semantic rotation) and its rotation
// revision counter were retired in fix wave 6, superseded by CallFrom's
// caller-scoped routing: a shared-hint rotation could not survive an
// interleaved shared-path success on the rejected endpoint (e.g. the
// walker's BlockNumber succeeding on an endpoint whose eth_call state is
// frozen), which legitimately re-pinned the hint and bounced the semantic
// caller straight back — forever. The exclusion now lives with the caller.

// EndpointCount reports how many RPC endpoints this Failover rotates across.
func (f *Failover) EndpointCount() int {
	return len(f.clients)
}

// VerifyChainID queries every endpoint and errors unless all report want.
// Unlike do, this is not failover semantics: each endpoint is checked
// individually, because a single misconfigured endpoint would silently feed
// wrong-chain data whenever rotation lands on it.
func (f *Failover) VerifyChainID(ctx context.Context, want uint64) error {
	for i, c := range f.clients {
		attemptCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
		got, err := c.ChainID(attemptCtx)
		cancel()
		if err != nil {
			return fmt.Errorf("chain id check failed on endpoint %d: %w", i, err)
		}
		if !got.IsUint64() || got.Uint64() != want {
			return fmt.Errorf("endpoint %d reports chain id %s, want %d", i, got, want)
		}
	}
	return nil
}

func (f *Failover) BlockNumber(ctx context.Context) (uint64, error) {
	var out uint64
	_, err := f.do(ctx, "blockNumber", func(ctx context.Context, c rpcClient) error {
		v, err := c.BlockNumber(ctx)
		out = v
		return err
	})
	return out, err
}

// HeaderHash returns the PROVIDER-REPORTED hash of block n, under ordinary
// shared-path failover. The value is the raw response's own hash field —
// never a local types.Header.Hash() recomputation, which is silently
// non-canonical for chains whose header shape postdates the vendored geth
// (see ReportedHeader's trust posture; live-proven on OP mainnet at block
// 150,105,227).
func (f *Failover) HeaderHash(ctx context.Context, n uint64) (common.Hash, error) {
	var out common.Hash
	_, err := f.do(ctx, "headerHash", func(ctx context.Context, c rpcClient) error {
		rh, err := c.ReportedHeaderByNumber(ctx, new(big.Int).SetUint64(n))
		if err != nil {
			return err
		}
		if err := validateReportedHeader(rh, fmt.Sprintf("%d", n), &n); err != nil {
			return err
		}
		out = *rh.Hash
		return nil
	})
	return out, err
}

// HeaderTime returns the header TIMESTAMP (unix seconds) of block n, under
// ordinary shared-path failover.
//
// It exists because a block DISTANCE is not an elapsed time. The daemon's
// liquidation-facing freshness requirement is stated in time, and converting it
// through a nominal block cadence (12s slots, 2s OP blocks) is a unit-conversion
// fallacy: missed slots or degraded production make the same block count span
// materially longer, so a distance gate can read green while the state served is
// hours old. Measuring `now - ts(cursor block)` gates the property directly, and
// the only place that timestamp exists is the header.
//
// It deliberately uses the SHARED path (do), not a caller-scoped walk: the
// measurement is not a liveness probe that has to route around ingestion's
// endpoint, and sharing the sticky hint means it rides the endpoint ingestion is
// already using rather than warming a second one.
// HeaderTime returns the header TIMESTAMP (unix seconds) of block n, under
// ordinary shared-path failover.
//
// It exists because a block DISTANCE is not an elapsed time. The daemon's
// liquidation-facing freshness requirement is stated in time, and converting it
// through a nominal block cadence (12s slots, 2s OP blocks) is a unit-conversion
// fallacy: missed slots or degraded production make the same block count span
// materially longer, so a distance gate can read green while the state served is
// hours old. Measuring `now - ts(cursor block)` gates the property directly, and
// the only place that timestamp exists is the header.
//
// It deliberately uses the SHARED path (do), not a caller-scoped walk: the
// measurement is not a liveness probe that has to route around ingestion's
// endpoint, and sharing the sticky hint means it rides the endpoint ingestion is
// already using rather than warming a second one.
//
// Since Task 9 wave 5 it shares the REPORTED-header fetch. Its field use was
// never wrong — the timestamp always came decoded from the provider's own
// response, untouched by the hash-recomputation defect — but one fetch path
// means one protocol gate: a response malformed enough to fail
// validateReportedHeader is not trusted for its timestamp either.
func (f *Failover) HeaderTime(ctx context.Context, n uint64) (uint64, error) {
	var out uint64
	_, err := f.do(ctx, "headerTime", func(ctx context.Context, c rpcClient) error {
		rh, err := c.ReportedHeaderByNumber(ctx, new(big.Int).SetUint64(n))
		if err != nil {
			return err
		}
		if err := validateReportedHeader(rh, fmt.Sprintf("%d", n), &n); err != nil {
			return err
		}
		out = uint64(*rh.Time)
		return nil
	})
	return out, err
}

// Head is a chain head observation: the height, the header's own TIMESTAMP and
// its hash. The timestamp is the part that makes a head observation
// falsifiable — a node frozen on old state still answers eth_blockNumber with a
// plausible-looking height, but it cannot make that block's header claim to be
// recent. A caller judging "is this node actually at a live head" must look at
// Time, not only at Number. Hash is the PROVIDER-REPORTED hash of the head
// block (Task 9 wave 5; see ReportedHeader) — never a local recomputation.
type Head struct {
	Number uint64
	Time   uint64
	Hash   common.Hash
}

// HeadFrom reads the latest header with a CALLER-SCOPED starting endpoint, the
// same routing discipline as CallFrom: the attempt walk starts at startIndex
// (mod the endpoint count) rather than at the shared sticky hint, and success
// neither reads nor writes that hint. It exists so a caller can probe the head
// through an endpoint OTHER than the one ingestion is currently pinned to: a
// liveness probe that shares its dependency with the pipeline it is supposed to
// be judging cannot distinguish "the feeds stopped publishing" from "our RPC
// froze".
//
// With a single configured endpoint there is nothing to route around and the
// probe is NOT independent; callers that rely on independence must say so and
// carry another guard (see internal/prices' verdict TTL).
// HeadFrom reads the latest header with a CALLER-SCOPED starting endpoint, the
// same routing discipline as CallFrom: the attempt walk starts at startIndex
// (mod the endpoint count) rather than at the shared sticky hint, and success
// neither reads nor writes that hint. It exists so a caller can probe the head
// through an endpoint OTHER than the one ingestion is currently pinned to: a
// liveness probe that shares its dependency with the pipeline it is supposed to
// be judging cannot distinguish "the feeds stopped publishing" from "our RPC
// froze".
//
// The returned Head's hash is the PROVIDER-REPORTED hash of the latest block
// (see ReportedHeader), which is what makes it usable as a pin: the EIP-1898
// round presents it back to the node that issued it.
//
// With a single configured endpoint there is nothing to route around and the
// probe is NOT independent; callers that rely on independence must say so and
// carry another guard (see internal/prices' verdict TTL).
func (f *Failover) HeadFrom(ctx context.Context, startIndex int) (Head, EndpointToken, error) {
	n := len(f.clients)
	start := ((startIndex % n) + n) % n // normalize, negatives included
	var out Head
	idx, err := f.doFrom(ctx, "head", start, func(ctx context.Context, c rpcClient) error {
		rh, err := c.ReportedHeaderByNumber(ctx, nil)
		if err != nil {
			return err
		}
		if err := validateReportedHeader(rh, "latest", nil); err != nil {
			return err
		}
		out = Head{Number: (*big.Int)(rh.Number).Uint64(), Time: uint64(*rh.Time), Hash: *rh.Hash}
		return nil
	})
	if err != nil {
		return Head{}, EndpointToken{Index: -1}, err
	}
	return out, EndpointToken{Index: idx}, nil
}

// ActiveEndpoint reports the SHARED routing hint's current index — the endpoint
// that most recently served a shared-path call, which is the one ingestion is
// effectively pinned to. It is exposed so a semantic caller can deliberately
// route AROUND it (HeadFrom(active+1)) instead of unknowingly sharing it. It is
// a hint, not a health verdict: by the time a caller acts on it another call may
// have moved it, which is harmless — the point is only to prefer a different
// endpoint, not to guarantee one.
func (f *Failover) ActiveEndpoint() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.active
}

// HeaderHashFrom is HeaderHash with a CALLER-SCOPED starting endpoint (see
// CallFrom for why the shared hint stays out of it) and an EndpointToken naming
// the endpoint that answered. Callers use it to re-verify a hash they recorded
// earlier against the live chain — the check that turns "the chain may have
// reorged under this row" from an assumption into a decidable question.
// HeaderHashFrom is HeaderHash with a CALLER-SCOPED starting endpoint (see
// CallFrom for why the shared hint stays out of it) and an EndpointToken naming
// the endpoint that answered. Callers use it to re-verify a hash they recorded
// earlier against the live chain — the check that turns "the chain may have
// reorged under this row" from an assumption into a decidable question. Both
// sides of that comparison are PROVIDER-REPORTED values (see ReportedHeader):
// reported-then against reported-now is the only form of the question an L2
// client can honestly decide.
func (f *Failover) HeaderHashFrom(ctx context.Context, startIndex int, n uint64) (common.Hash, EndpointToken, error) {
	count := len(f.clients)
	start := ((startIndex % count) + count) % count
	var out common.Hash
	idx, err := f.doFrom(ctx, "headerHash", start, func(ctx context.Context, c rpcClient) error {
		rh, err := c.ReportedHeaderByNumber(ctx, new(big.Int).SetUint64(n))
		if err != nil {
			return err
		}
		if err := validateReportedHeader(rh, fmt.Sprintf("%d", n), &n); err != nil {
			return err
		}
		out = *rh.Hash
		return nil
	})
	if err != nil {
		return common.Hash{}, EndpointToken{Index: -1}, err
	}
	return out, EndpointToken{Index: idx}, nil
}

// HeaderTimeFrom is HeaderTime with a CALLER-SCOPED starting endpoint and an
// EndpointToken naming the endpoint that answered — the exact routing shape of
// HeaderHashFrom, for the same reason: a caller that pinned other reads to a
// specific endpoint (or that must DISCLOSE which endpoint served a header) has
// no honest use for the shared-hint path, whose serving endpoint it can neither
// choose nor report. Additive for Task 9 wave 10: cmd/reconcile's DM
// index-integrity check derives an accrual interval dt from two header times
// and records the serving endpoint of each read in its artifact; the plain
// HeaderTime has no routing and names no endpoint, which would leave that
// interval's provenance undisclosed (brief §3.6 / L2-13).
func (f *Failover) HeaderTimeFrom(ctx context.Context, startIndex int, n uint64) (uint64, EndpointToken, error) {
	count := len(f.clients)
	start := ((startIndex % count) + count) % count
	var out uint64
	idx, err := f.doFrom(ctx, "headerTime", start, func(ctx context.Context, c rpcClient) error {
		rh, err := c.ReportedHeaderByNumber(ctx, new(big.Int).SetUint64(n))
		if err != nil {
			return err
		}
		if err := validateReportedHeader(rh, fmt.Sprintf("%d", n), &n); err != nil {
			return err
		}
		out = uint64(*rh.Time)
		return nil
	})
	if err != nil {
		return 0, EndpointToken{Index: -1}, err
	}
	return out, EndpointToken{Index: idx}, nil
}

// TxCalldata returns the raw input data (selector included) of the
// transaction with hash txHash. Additive method for the debt_manager
// deriver's migration-genesis path (Phase 2 Task 5): the 7,337 migrated
// borrower seeds live in the 80 migration txs' calldata, not in any log
// (recon/derivation-notes.md "Migration finding").
func (f *Failover) TxCalldata(ctx context.Context, txHash common.Hash) ([]byte, error) {
	var out []byte
	_, err := f.do(ctx, "txCalldata", func(ctx context.Context, c rpcClient) error {
		tx, _, err := c.TransactionByHash(ctx, txHash)
		if err != nil {
			return err
		}
		if tx == nil {
			return fmt.Errorf("transaction %s not found", txHash)
		}
		out = tx.Data()
		return nil
	})
	return out, err
}

// Call executes a read-only eth_call against `to` with calldata data at the
// LATEST block, under failover rotation. Additive method for the Phase 2
// snapshotter (Task 7): batched multicall3 reads of Debt Manager
// collateralOf views — OP collateral is not event-derivable (recon caveat 4),
// so its only honest source is a live view sweep.
func (f *Failover) Call(ctx context.Context, to common.Address, data []byte) ([]byte, error) {
	out, _, err := f.CallWithToken(ctx, to, data)
	return out, err
}

// CallWithToken is Call plus an EndpointToken naming the endpoint that served
// the response. Semantic-layer callers (the snapshotter) keep the token so
// that a response later judged semantically stale can be routed around
// EXACTLY the endpoint that produced it (CallFrom starting past the token's
// index), not around whatever endpoint happens to be active by the time the
// judgment lands.
func (f *Failover) CallWithToken(ctx context.Context, to common.Address, data []byte) ([]byte, EndpointToken, error) {
	var out []byte
	idx, err := f.do(ctx, "call", func(ctx context.Context, c rpcClient) error {
		res, err := c.CallContract(ctx, ethereum.CallMsg{To: &to, Data: data}, nil)
		if err != nil {
			return err
		}
		out = res
		return nil
	})
	if err != nil {
		return nil, EndpointToken{Index: -1}, err
	}
	return out, EndpointToken{Index: idx}, nil
}

// CallFrom is CallWithToken with a CALLER-SCOPED starting endpoint: the
// attempt walk starts at startIndex (mod the endpoint count) instead of the
// shared sticky active hint, and a success neither reads nor writes that
// hint. This is the semantic-failover entry: a caller that judged an
// endpoint's well-formed responses unusable (stale chain state — invisible
// to error-driven rotation, since the RPC calls succeed) owns a persistent
// preference of its own and starts every retry past the rejected endpoint.
// The shared hint deliberately stays out of it: semantic callers must not
// fight error-driven routing — any other caller's success on the rejected
// endpoint would legitimately re-pin the shared hint there, and a shared-
// hint-driven exclusion would bounce straight back to the bad endpoint.
// Error-driven rotation WITHIN this call's own attempt walk still applies.
func (f *Failover) CallFrom(ctx context.Context, startIndex int, to common.Address, data []byte) ([]byte, EndpointToken, error) {
	n := len(f.clients)
	start := ((startIndex % n) + n) % n // normalize, negatives included
	var out []byte
	idx, err := f.doFrom(ctx, "call", start, func(ctx context.Context, c rpcClient) error {
		res, err := c.CallContract(ctx, ethereum.CallMsg{To: &to, Data: data}, nil)
		if err != nil {
			return err
		}
		out = res
		return nil
	})
	if err != nil {
		return nil, EndpointToken{Index: -1}, err
	}
	return out, EndpointToken{Index: idx}, nil
}

// CallAtFrom is CallFrom PINNED AT A BLOCK NUMBER: the eth_call executes
// against the state of block `block` rather than "latest", with the same
// caller-scoped routing and token discipline (the attempt walk starts at
// startIndex, success neither reads nor writes the shared hint, and the token
// names the endpoint that answered). Added for the price poller's
// endpoint-coherent rounds (Task 9 wave 1); RETIRED FROM THE POLLER in wave 2
// (Codex round 1 [medium]): a NUMBER names a height on whatever fork the
// serving node is on, not a block — one load-balanced hostname is many nodes,
// so headers from fork A and a number-pinned call served by fork B at the
// same height pass every height check. prices.PollChain deliberately does not
// carry this method; a caller that needs execution bound to a block's
// IDENTITY must use CallAtHashFrom.
//
// The pin is a REQUEST, not a proof: a provider that silently serves other
// state still reports the execution block inside responses that carry one
// (multicall3's blockNumber output), and callers that depend on the pin must
// check it there.
func (f *Failover) CallAtFrom(ctx context.Context, startIndex int, to common.Address, data []byte, block uint64) ([]byte, EndpointToken, error) {
	n := len(f.clients)
	start := ((startIndex % n) + n) % n // normalize, negatives included
	var out []byte
	idx, err := f.doFrom(ctx, "callAt", start, func(ctx context.Context, c rpcClient) error {
		res, err := c.CallContract(ctx, ethereum.CallMsg{To: &to, Data: data}, new(big.Int).SetUint64(block))
		if err != nil {
			return err
		}
		out = res
		return nil
	})
	if err != nil {
		return nil, EndpointToken{Index: -1}, err
	}
	return out, EndpointToken{Index: idx}, nil
}

// CallAtHashFrom is CallFrom PINNED AT A BLOCK HASH — the EIP-1898 block-hash
// object form of eth_call, with CallFrom's exact caller-scoped routing and
// token discipline (the attempt walk starts at startIndex, success neither
// reads nor writes the shared hint, and the token names the endpoint that
// answered). Additive for the price poller's rounds (Task 9 wave 2, Codex
// round 1 [medium]): a number pin binds a HEIGHT, which every fork has one
// of, while the hash pin binds the block's IDENTITY — the node either
// executes against exactly the block the caller verified or rejects the
// request outright, so state from a same-height fork can never be served
// under this pin.
//
// requireCanonical is left at its EIP-1898 default (false): the pin's job is
// IDENTITY, and detecting that the pinned block later stopped being canonical
// stays the anchor machinery's job (the poller's closing re-read, the next
// round's anchor-divergence check, reorg repair).
//
// The honest trust boundary is the NODE'S IMPLEMENTATION of the pin — a
// dishonest node could claim execution at a hash while serving other state,
// the same trust class every read here carries. The observed behavior class
// (live matrix, 2026-07-26, all four production endpoints across both
// chains): the hash-pinned call executed exactly at the pinned block, and a
// fabricated hash was REJECTED with "block not found" everywhere — negative
// controls included. Callers treat that rejection class as "the serving node
// does not have this block" (exploration-worthy), not as a transport fault.
//
// TOTAL FAILURE RETAINS EVERY PER-ATTEMPT OUTCOME (Task 9 wave 4, Codex
// round 3 [medium]): the walk runs through doFromAttempts, so when every
// endpoint fails the returned error is a *PinnedCallError carrying each
// attempted endpoint's own error in walk order. The surfaced wording and
// the unwrap target (the last attempt's error) are unchanged; what is new
// is that a caller classifying the OUTCOME can require unanimity across
// attempts instead of trusting whichever error the rotation happened to
// leave last. The aggregate is the pinned-call path's alone — every other
// method keeps doFrom's last-error shape.
func (f *Failover) CallAtHashFrom(ctx context.Context, startIndex int, to common.Address, data []byte, blockHash common.Hash) ([]byte, EndpointToken, error) {
	n := len(f.clients)
	start := ((startIndex % n) + n) % n // normalize, negatives included
	var out []byte
	idx, err := f.doFromAttempts(ctx, "callAtHash", start, func(ctx context.Context, c rpcClient) error {
		res, err := c.CallContractAtHash(ctx, ethereum.CallMsg{To: &to, Data: data}, blockHash)
		if err != nil {
			return err
		}
		out = res
		return nil
	})
	if err != nil {
		return nil, EndpointToken{Index: -1}, err
	}
	return out, EndpointToken{Index: idx}, nil
}

func (f *Failover) Logs(ctx context.Context, from, to uint64, addrs []common.Address) ([]types.Log, error) {
	var out []types.Log
	_, err := f.do(ctx, "getLogs", func(ctx context.Context, c rpcClient) error {
		logs, err := c.FilterLogs(ctx, ethereum.FilterQuery{
			FromBlock: new(big.Int).SetUint64(from),
			ToBlock:   new(big.Int).SetUint64(to),
			Addresses: addrs,
		})
		out = logs
		return err
	})
	return out, err
}
