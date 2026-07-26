package chain

// Task 9 wave 6: the RAW-JSON fixture layer — hermetic adapter tests BELOW
// the rpcClient fake seam.
//
// Every fake-backed test in this package scripts *ReportedHeader values,
// which means none of them can see the DECODE: what an omitted JSON field
// becomes, what a null result becomes, what malformed hex does. That blind
// spot is exactly where wave 5's F2 defect lived (a non-pointer Time decoding
// an omitted timestamp as zero), and it is the same blind-spot class that hid
// the recomputation bug for 16 waves — fakes that always answer correctly
// cannot test the decoder. Wave 5 disclosed endpointClient.ReportedHeaderByNumber
// as covered ONLY by the network-gated live regression; this file closes that
// gap hermetically.
//
// Each test here drives the REAL stack — Dial → rpc.Client (HTTP) →
// endpointClient's raw CallContext decode → validateReportedHeader — against
// a local JSON-RPC server serving CRAFTED raw JSON, and asserts the wave-6
// rule end to end: the response must answer the question asked (exact height
// on numbered reads, every required field present), any violation fails the
// attempt and ROTATES, and a null result surfaces as an honest not-found —
// never as a violation, never as a zero header.

import (
	"context"
	"encoding/json"
	"fmt"
	"math/big"
	"net/http"
	"net/http/httptest"
	"sort"
	"strconv"
	"strings"
	"sync"
	"testing"

	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/common/hexutil"
	"github.com/ethereum/go-ethereum/core/types"
	"github.com/stretchr/testify/require"
)

// rawJSONEndpoint is a hermetic JSON-RPC HTTP server serving crafted raw
// `result` payloads for eth_getBlockByNumber, keyed by the request's block
// argument ("0x5a", "latest"). Since Task 9 wave 8 it also serves scripted
// results for the other gated methods (scriptMethod: eth_blockNumber,
// eth_chainId, eth_getLogs, eth_getTransactionByHash). A method or argument
// with no scripted entry is answered with JSON null — the provider does not
// have the answer. Every ask is recorded so tests can assert the exact
// question the adapter put on the wire.
type rawJSONEndpoint struct {
	srv *httptest.Server

	mu            sync.Mutex
	results       map[string]string
	methodResults map[string]string
	asks          []rawAsk
}

type rawAsk struct {
	method string
	params []json.RawMessage
}

func newRawJSONEndpoint(t *testing.T, results map[string]string) *rawJSONEndpoint {
	t.Helper()
	e := &rawJSONEndpoint{results: results}
	e.srv = httptest.NewServer(http.HandlerFunc(e.handle))
	t.Cleanup(e.srv.Close)
	return e
}

func (e *rawJSONEndpoint) handle(w http.ResponseWriter, r *http.Request) {
	var req struct {
		ID     json.RawMessage   `json:"id"`
		Method string            `json:"method"`
		Params []json.RawMessage `json:"params"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	e.mu.Lock()
	e.asks = append(e.asks, rawAsk{method: req.Method, params: req.Params})
	result := "null"
	if req.Method == "eth_getBlockByNumber" && len(req.Params) > 0 {
		var arg string
		if err := json.Unmarshal(req.Params[0], &arg); err == nil {
			if res, ok := e.results[arg]; ok {
				result = res
			}
		}
	} else if res, ok := e.methodResults[req.Method]; ok {
		result = res
	}
	e.mu.Unlock()
	w.Header().Set("Content-Type", "application/json")
	fmt.Fprintf(w, `{"jsonrpc":"2.0","id":%s,"result":%s}`, req.ID, result)
}

// scriptMethod scripts a raw `result` payload for one of the wave-8 gated
// methods; the value is served verbatim for every ask of that method.
func (e *rawJSONEndpoint) scriptMethod(method, result string) *rawJSONEndpoint {
	e.mu.Lock()
	defer e.mu.Unlock()
	if e.methodResults == nil {
		e.methodResults = map[string]string{}
	}
	e.methodResults[method] = result
	return e
}

// asksOf counts how many times method was asked — the rotation proof for
// the non-header paths (a malformed primary must be asked exactly once).
func (e *rawJSONEndpoint) asksOf(method string) int {
	e.mu.Lock()
	defer e.mu.Unlock()
	n := 0
	for _, a := range e.asks {
		if a.method == method {
			n++
		}
	}
	return n
}

// blockAsks returns the block argument of every eth_getBlockByNumber request
// served, in order — the questions this endpoint was actually asked.
func (e *rawJSONEndpoint) blockAsks(t *testing.T) []string {
	t.Helper()
	e.mu.Lock()
	defer e.mu.Unlock()
	var out []string
	for _, a := range e.asks {
		if a.method != "eth_getBlockByNumber" || len(a.params) == 0 {
			continue
		}
		var arg string
		require.NoError(t, json.Unmarshal(a.params[0], &arg))
		out = append(out, arg)
	}
	return out
}

// rawBlockFields is the raw eth_getBlockByNumber result a modern (2026-era)
// endpoint serves, reduced to what this harness needs: the four fields the
// decoder consumes, plus fields the vendored geth's types.Header cannot
// faithfully represent — which the reported-header decode must simply ignore,
// never re-hash (the wave-5 principle). Tests delete keys to model a
// protocol-violating provider and overwrite values to model malformed hex.
func rawBlockFields(num uint64, hash, parent common.Hash, ts uint64) map[string]string {
	return map[string]string{
		"hash":            hash.Hex(),
		"parentHash":      parent.Hex(),
		"number":          hexutil.EncodeUint64(num),
		"timestamp":       hexutil.EncodeUint64(ts),
		"withdrawalsRoot": common.Hash{0x77}.Hex(),
		"blobGasUsed":     "0x0",
		"miner":           "0x4200000000000000000000000000000000000011",
	}
}

func rawJSON(fields map[string]string) string {
	b, err := json.Marshal(fields)
	if err != nil {
		panic(err)
	}
	return string(b)
}

// rawJSONOverride serializes fields like rawJSON but injects ONE field as raw
// JSON bytes, un-reencoded — so tests control the exact wire representation
// the strict quantity wrappers judge: `""`, `"0x5A"`, a bare 90 (Task 9
// wave 7 — the canon gate is a BYTES-level gate, so its fixtures must be
// byte-exact).
func rawJSONOverride(fields map[string]string, field, rawValue string) string {
	m := make(map[string]json.RawMessage, len(fields)+1)
	for k, v := range fields {
		b, err := json.Marshal(v)
		if err != nil {
			panic(err)
		}
		m[k] = b
	}
	m[field] = json.RawMessage(rawValue)
	b, err := json.Marshal(m)
	if err != nil {
		panic(err)
	}
	return string(b)
}

var (
	rawCursorHash   = common.HexToHash("0x8a1f00000000000000000000000000000000000000000000000000000000005a")
	rawCursorParent = common.HexToHash("0x8a1f000000000000000000000000000000000000000000000000000000000059")
	rawHeadHash     = common.HexToHash("0x8a1f000000000000000000000000000000000000000000000000000000000096")
	rawHeadParent   = common.HexToHash("0x8a1f000000000000000000000000000000000000000000000000000000000095")
)

const (
	rawCursor     = uint64(90) // "0x5a"
	rawHead       = uint64(150)
	rawCursorTime = uint64(1_700_000_000)
	rawHeadTime   = uint64(1_800_000_000)
)

func rawDial(t *testing.T, endpoints ...*rawJSONEndpoint) *Failover {
	t.Helper()
	urls := make([]string, len(endpoints))
	for i, e := range endpoints {
		urls[i] = e.srv.URL
	}
	f, err := Dial(context.Background(), urls)
	require.NoError(t, err)
	return f
}

// healthyRawEndpoint answers both the cursor question and the latest question
// correctly — the secondary every rotation test expects to land on.
func healthyRawEndpoint(t *testing.T) *rawJSONEndpoint {
	t.Helper()
	return newRawJSONEndpoint(t, map[string]string{
		hexutil.EncodeUint64(rawCursor): rawJSON(rawBlockFields(rawCursor, rawCursorHash, rawCursorParent, rawCursorTime)),
		"latest":                        rawJSON(rawBlockFields(rawHead, rawHeadHash, rawHeadParent, rawHeadTime)),
	})
}

// The happy path through the real decode, with the question asked pinned on
// the wire: the adapter encodes the height as an exact hex quantity (and
// "latest" for head reads), requests header-only (fullTx=false), and every
// value the Failover hands out is the crafted response's own field.
func TestRawJSONAdapterServesTheReportedFieldsAndAsksTheExactQuestion(t *testing.T) {
	e := healthyRawEndpoint(t)
	f := rawDial(t, e)
	ctx := context.Background()

	got, err := f.HeaderHash(ctx, rawCursor)
	require.NoError(t, err)
	require.Equal(t, rawCursorHash, got, "the raw response's own hash field, decoded verbatim")

	ts, err := f.HeaderTime(ctx, rawCursor)
	require.NoError(t, err)
	require.Equal(t, rawCursorTime, ts)

	gotFrom, token, err := f.HeaderHashFrom(ctx, 0, rawCursor)
	require.NoError(t, err)
	require.Equal(t, 0, token.Index)
	require.Equal(t, rawCursorHash, gotFrom)

	head, token, err := f.HeadFrom(ctx, 0)
	require.NoError(t, err)
	require.Equal(t, 0, token.Index)
	require.Equal(t, Head{Number: rawHead, Time: rawHeadTime, Hash: rawHeadHash}, head)

	asks := e.blockAsks(t)
	require.Equal(t, []string{"0x5a", "0x5a", "0x5a", "latest"}, asks,
		"the questions on the wire: exact hex heights for numbered reads, latest for the head read")

	// The header-only flag: the second param of every ask is false.
	e.mu.Lock()
	defer e.mu.Unlock()
	for _, a := range e.asks {
		require.Len(t, a.params, 2)
		require.JSONEq(t, "false", string(a.params[1]), "header identity reads never request full transactions")
	}
}

// A null result is the provider's honest "I do not have this block" — the
// legitimate answer for a height beyond the endpoint's head. It must surface
// as NOT-FOUND: not as a protocol violation (nothing was violated), and never
// as a zero header (no identity may be fabricated for a block the provider
// never served).
func TestRawJSONNullResultIsAnHonestNotFoundNotAViolation(t *testing.T) {
	beyond := newRawJSONEndpoint(t, map[string]string{}) // every ask answers null
	f := rawDial(t, beyond)

	got, err := f.HeaderHash(context.Background(), rawCursor)
	require.ErrorContains(t, err, "header 90 not found", "the not-found surfaces as such")
	require.NotContains(t, err.Error(), "protocol violation",
		"a legitimate not-found must not be misclassified as a violation — that would page operators for honest beyond-head reads")
	require.Equal(t, common.Hash{}, got, "and no fabricated identity accompanies it")

	// Not-found still fails the ATTEMPT, so rotation reaches an endpoint
	// whose head is past the asked height — a lagging primary is walked past.
	lagging := newRawJSONEndpoint(t, map[string]string{})
	f = rawDial(t, lagging, healthyRawEndpoint(t))
	got, err = f.HeaderHash(context.Background(), rawCursor)
	require.NoError(t, err)
	require.Equal(t, rawCursorHash, got, "the endpoint that has the block lands the read")
	require.Equal(t, []string{"0x5a"}, lagging.blockAsks(t), "the lagging endpoint was asked once and rotated past")
}

// F2 below the fake seam: a raw response OMITTING a required field decodes as
// nil (pointer fields), fails validation as a named protocol violation, and
// ROTATES — a malformed primary can no longer stop failover short of a
// healthy secondary.
func TestRawJSONMissingRequiredFieldsAreProtocolViolationsThatRotate(t *testing.T) {
	omitting := func(field string, arg string) *rawJSONEndpoint {
		fields := rawBlockFields(rawCursor, rawCursorHash, rawCursorParent, rawCursorTime)
		if arg == "latest" {
			fields = rawBlockFields(rawHead, rawHeadHash, rawHeadParent, rawHeadTime)
		}
		delete(fields, field)
		return newRawJSONEndpoint(t, map[string]string{arg: rawJSON(fields)})
	}

	for _, field := range []string{"hash", "parentHash", "number", "timestamp"} {
		t.Run("omitted "+field, func(t *testing.T) {
			f := rawDial(t, omitting(field, "0x5a"))
			_, err := f.HeaderHash(context.Background(), rawCursor)
			require.ErrorContains(t, err, "omits required field(s) "+field,
				"the absence is named as what it is — it does not decode into a plausible zero value")
			require.ErrorContains(t, err, "protocol violation")
		})
	}

	t.Run("the F2 incident shape: omitted timestamp cannot become an epoch-aged head", func(t *testing.T) {
		// Pre-wave-6, the non-pointer Time decoded this response's absent
		// timestamp as 0: HeaderTime returned the Unix epoch, HeadFrom
		// reported an epoch-aged head, and failover STOPPED at the malformed
		// primary. Now the violation fails the attempt and the healthy
		// secondary lands both reads.
		primary := omitting("timestamp", "0x5a")
		f := rawDial(t, primary)
		ts, err := f.HeaderTime(context.Background(), rawCursor)
		require.ErrorContains(t, err, "omits required field(s) timestamp")
		require.Zero(t, ts, "no epoch timestamp is handed out")

		primary = omitting("timestamp", "latest")
		f = rawDial(t, primary, healthyRawEndpoint(t))
		head, token, err := f.HeadFrom(context.Background(), 0)
		require.NoError(t, err)
		require.Equal(t, 1, token.Index, "failover reached the healthy secondary instead of stopping at the malformed primary")
		require.Equal(t, rawHeadTime, head.Time, "the head's age is the honest endpoint's reported timestamp, not zero")
		require.Equal(t, []string{"latest"}, primary.blockAsks(t), "the malformed primary was attempted once and rotated past")
	})
}

// The malformed-QUANTITY matrix (Task 9 wave 7, Codex round 6 — extending
// wave 6's single 0xnope form): every non-canonical representation of number
// and timestamp fails the attempt as a NAMED canon violation, judged at the
// bytes level by checkCanonicalQuantity BEFORE hexutil conversion. Two arms
// are forms the pinned hexutil would LENIENT-ACCEPT as values — "" (as zero:
// the round-6 finding) and uppercase digits (as the value) — so their
// assertions are behavioral: with the gate bypassed those reads would
// SUCCEED. The remaining arms overlap hexutil's own strictness; the
// assertions pin the canon gate's NAME on the refusal so the rejection never
// relies on the leniency profile of the library whose "" → 0 is the finding.
// The zero subtest pins the canon's one compactness exception: "0x0" IS
// canonical — a gate that rejected it would break genesis-height reads
// (over-tightening, the other face of the wave-6 lesson).
func TestRawJSONMalformedHexFailsTheAttemptAndRotates(t *testing.T) {
	forms := []struct{ name, raw, reason string }{
		{"empty string", `""`, "an empty quantity is a non-answer, not zero"},
		{"0x with no digits", `"0x"`, `"0x" carries no digits`},
		{"leading zero digits", `"0x05a"`, "leading zero digits"},
		{"uppercase hex digits", `"0x5A"`, "not a lowercase hex digit"},
		{"missing 0x prefix", `"5a"`, `missing the "0x" prefix`},
		{"non-hex garbage", `"0xnope"`, "not a lowercase hex digit"},
		{"bare JSON number", `90`, "not a JSON string"},
	}
	for _, field := range []string{"number", "timestamp"} {
		for _, tc := range forms {
			t.Run(field+" "+tc.name, func(t *testing.T) {
				fields := rawBlockFields(rawCursor, rawCursorHash, rawCursorParent, rawCursorTime)
				e := newRawJSONEndpoint(t, map[string]string{"0x5a": rawJSONOverride(fields, field, tc.raw)})
				f := rawDial(t, e)
				ts, err := f.HeaderTime(context.Background(), rawCursor)
				require.ErrorContains(t, err, "all rpc endpoints failed")
				require.ErrorContains(t, err, "not a canonical JSON-RPC quantity",
					"the canon gate owns the refusal — not whatever hexutil happens to reject")
				require.ErrorContains(t, err, "header response "+field, "the violation names the field it arrived in")
				require.ErrorContains(t, err, tc.reason, "and the arm of the canon it broke")
				require.Zero(t, ts, "a non-canonical quantity never becomes a value")
			})
		}
	}

	t.Run("the canon's zero: genesis-shaped quantities stay servable", func(t *testing.T) {
		// "0x0" is canonical (the spec's one compactness exception) — the
		// reference encoder emits it for zero, and rawBlockFields uses that
		// encoder, so this fixture doubles as the round-trip proof.
		e := newRawJSONEndpoint(t, map[string]string{
			"0x0": rawJSON(rawBlockFields(0, rawCursorHash, rawCursorParent, 0)),
		})
		f := rawDial(t, e)
		got, err := f.HeaderHash(context.Background(), 0)
		require.NoError(t, err)
		require.Equal(t, rawCursorHash, got)
		ts, err := f.HeaderTime(context.Background(), 0)
		require.NoError(t, err)
		require.Zero(t, ts, "a REPORTED zero timestamp is a value like any other — only a non-answer is refused")
	})

	t.Run("rotation lands the healthy secondary for each wrapped field", func(t *testing.T) {
		for _, field := range []string{"number", "timestamp"} {
			fields := rawBlockFields(rawCursor, rawCursorHash, rawCursorParent, rawCursorTime)
			broken := newRawJSONEndpoint(t, map[string]string{"0x5a": rawJSONOverride(fields, field, `"0xnope"`)})
			f := rawDial(t, broken, healthyRawEndpoint(t))
			ts, err := f.HeaderTime(context.Background(), rawCursor)
			require.NoError(t, err)
			require.Equal(t, rawCursorTime, ts, "the healthy secondary lands the read past a garbled "+field)
			require.Equal(t, []string{"0x5a"}, broken.blockAsks(t))
		}
	})
}

// The round-6 finding, face one — "timestamp":"" — as a real-Dial regression:
// the pinned hexutil decoders read the empty string as zero, so without the
// bytes-level gate this response passes the presence gate as a NON-NIL Unix
// epoch and HeaderTime dates staleness off 1970 — the F2 failover-stopping
// class one decoder layer down from wave 6. The gate makes it a named canon
// violation that fails the attempt, and the healthy secondary DEMONSTRABLY
// lands HeaderTime.
func TestRawJSONEmptyTimestampFailsTheAttemptAndTheSecondaryLandsHeaderTime(t *testing.T) {
	emptyTS := func() *rawJSONEndpoint {
		fields := rawBlockFields(rawCursor, rawCursorHash, rawCursorParent, rawCursorTime)
		fields["timestamp"] = ""
		return newRawJSONEndpoint(t, map[string]string{"0x5a": rawJSON(fields)})
	}

	// Alone, the violation surfaces by name and no epoch value escapes.
	f := rawDial(t, emptyTS())
	ts, err := f.HeaderTime(context.Background(), rawCursor)
	require.ErrorContains(t, err, "not a canonical JSON-RPC quantity")
	require.ErrorContains(t, err, "header response timestamp")
	require.ErrorContains(t, err, "an empty quantity is a non-answer, not zero")
	require.Zero(t, ts, "the empty quantity never becomes a value — no Unix epoch is handed out")

	// With a healthy secondary the malformed primary is rotated past and the
	// read LANDS — the honest endpoint's own timestamp, not zero.
	primary := emptyTS()
	f = rawDial(t, primary, healthyRawEndpoint(t))
	ts, err = f.HeaderTime(context.Background(), rawCursor)
	require.NoError(t, err)
	require.Equal(t, rawCursorTime, ts, "HeaderTime lands on the healthy secondary")
	require.Equal(t, []string{"0x5a"}, primary.blockAsks(t), "the malformed primary was attempted once and rotated past")
}

// Face two — "number":"" — the same leniency passing HeadFrom as HEIGHT ZERO:
// a head at height 0 ages every cursor comparison off a block that does not
// exist and stops failover at the malformed primary. The gate fails the
// attempt and the healthy secondary lands the FULL head — number, time and
// hash — not merely a skipped primary.
func TestRawJSONEmptyNumberFailsTheAttemptAndTheSecondaryLandsHeadFrom(t *testing.T) {
	emptyNum := func() *rawJSONEndpoint {
		fields := rawBlockFields(rawHead, rawHeadHash, rawHeadParent, rawHeadTime)
		fields["number"] = ""
		return newRawJSONEndpoint(t, map[string]string{"latest": rawJSON(fields)})
	}

	// Alone: a named canon violation; no height-zero head escapes.
	f := rawDial(t, emptyNum())
	head, token, err := f.HeadFrom(context.Background(), 0)
	require.ErrorContains(t, err, "not a canonical JSON-RPC quantity")
	require.ErrorContains(t, err, "header response number")
	require.ErrorContains(t, err, "an empty quantity is a non-answer, not zero")
	require.Equal(t, Head{}, head, "the empty quantity never becomes a value — no height-0 head is handed out")
	require.Equal(t, -1, token.Index)

	// With a healthy secondary: the full landing.
	primary := emptyNum()
	f = rawDial(t, primary, healthyRawEndpoint(t))
	head, token, err = f.HeadFrom(context.Background(), 0)
	require.NoError(t, err)
	require.Equal(t, 1, token.Index, "failover reached the healthy secondary instead of stopping at the malformed primary")
	require.Equal(t, Head{Number: rawHead, Time: rawHeadTime, Hash: rawHeadHash}, head,
		"the FULL head lands from the honest endpoint — number, time and hash")
	require.Equal(t, []string{"latest"}, primary.blockAsks(t), "the malformed primary was attempted once and rotated past")
}

// F1 below the fake seam: a WELL-FORMED response for the WRONG height — the
// buggy proxy answering "latest" for numeric requests — is a protocol
// violation, not a success. The recorded ask proves the right question was on
// the wire; the response simply did not answer it.
func TestRawJSONWellFormedWrongHeightResponseIsAViolationThatRotates(t *testing.T) {
	// The proxy: asked "0x5a" (block 90), it serves its head block 150 —
	// every field present, valid hex, internally consistent.
	proxy := func() *rawJSONEndpoint {
		return newRawJSONEndpoint(t, map[string]string{
			"0x5a": rawJSON(rawBlockFields(rawHead, rawHeadHash, rawHeadParent, rawHeadTime)),
		})
	}

	p := proxy()
	f := rawDial(t, p)
	_, err := f.HeaderHash(context.Background(), rawCursor)
	require.ErrorContains(t, err, "answers for height 150")
	require.ErrorContains(t, err, "protocol violation")
	require.Equal(t, []string{"0x5a"}, p.blockAsks(t),
		"the question on the wire WAS block 90 — the violation is the answer, not the ask")

	ts, err := f.HeaderTime(context.Background(), rawCursor)
	require.Error(t, err, "freshness can never be dated off the proxy's head")
	require.Zero(t, ts)

	p = proxy()
	f = rawDial(t, p, healthyRawEndpoint(t))
	got, err := f.HeaderHash(context.Background(), rawCursor)
	require.NoError(t, err)
	require.Equal(t, rawCursorHash, got, "the healthy secondary answers the question asked and lands the round")
}

// ---------------------------------------------------------------------------
// Task 9 wave 8 (Codex round 7): the canon applies to the WHOLE package.
// Every quantity the package decodes from an RPC response — eth_blockNumber,
// eth_chainId, a log's blockNumber/logIndex/transactionIndex — passes
// checkCanonicalQuantity at the bytes, every variable-length payload (a
// log's data, a transaction's input) passes checkCanonicalData, and the
// mined-log wire shape is presence-tracked. The fixtures below drive the
// REAL stack (Dial → rpc.Client → the endpointClient overrides → wrappers →
// gates) against byte-exact crafted payloads, exactly like the header fleet
// above. quantityForms is wave 7's matrix verbatim: the canon is ONE, so
// each new path must refuse every form the header fields refuse.
// ---------------------------------------------------------------------------

var quantityForms = []struct{ name, raw, reason string }{
	{"empty string", `""`, "an empty quantity is a non-answer, not zero"},
	{"0x with no digits", `"0x"`, `"0x" carries no digits`},
	{"leading zero digits", `"0x05a"`, "leading zero digits"},
	{"uppercase hex digits", `"0x5A"`, "not a lowercase hex digit"},
	{"missing 0x prefix", `"5a"`, `missing the "0x" prefix`},
	{"non-hex garbage", `"0xnope"`, "not a lowercase hex digit"},
	{"bare JSON number", `90`, "not a JSON string"},
}

var dataForms = []struct{ name, raw, reason string }{
	{"empty string", `""`, "an empty payload is a non-answer"},
	{"odd digit count", `"0xabc"`, "odd digit count"},
	{"uppercase hex digits", `"0xAB"`, "not a lowercase hex digit"},
	{"missing 0x prefix", `"ab"`, `missing the "0x" prefix`},
	{"non-hex garbage", `"0xnope"`, "not a lowercase hex digit"},
	{"bare JSON number", `12`, "not a JSON string"},
}

// The round-7 finding, face one — an empty eth_blockNumber result — as a
// real-Dial regression: the pinned hexutil.Uint64 decodes "" as height ZERO
// without error, so without the gate the closure records zero, the attempt
// SUCCEEDS, failover stops at the malformed primary, and the walker sees a
// head below confirmations and starves. The gate makes it a named canon
// violation that fails the attempt, and the healthy secondary's height
// DEMONSTRABLY lands.
func TestRawJSONEmptyBlockNumberFailsTheAttemptAndTheSecondaryLandsHeight(t *testing.T) {
	empty := newRawJSONEndpoint(t, map[string]string{}).scriptMethod("eth_blockNumber", `""`)
	f := rawDial(t, empty)
	n, err := f.BlockNumber(context.Background())
	require.ErrorContains(t, err, "not a canonical JSON-RPC quantity")
	require.ErrorContains(t, err, "eth_blockNumber response result")
	require.ErrorContains(t, err, "an empty quantity is a non-answer, not zero")
	require.Zero(t, n, "the empty quantity never becomes a height — no zero head can starve the walker")

	primary := newRawJSONEndpoint(t, map[string]string{}).scriptMethod("eth_blockNumber", `""`)
	secondary := newRawJSONEndpoint(t, map[string]string{}).scriptMethod("eth_blockNumber", hexQuoted(rawHead))
	f = rawDial(t, primary, secondary)
	n, err = f.BlockNumber(context.Background())
	require.NoError(t, err)
	require.Equal(t, rawHead, n, "the healthy secondary's height LANDS")
	require.Equal(t, 1, primary.asksOf("eth_blockNumber"), "the malformed primary was asked exactly once and rotated past")
	require.Equal(t, 1, secondary.asksOf("eth_blockNumber"))
}

func hexQuoted(v uint64) string { return strconv.Quote(hexutil.EncodeUint64(v)) }

// The eth_blockNumber gate refuses every non-canonical form the header
// fields refuse (one canon), serves the genesis-shaped zero (the
// over-tightening guard), and refuses a null result — which the ungated
// typed decode would silently leave as height zero too.
func TestRawJSONBlockNumberMatrixFailsEveryNonCanonicalForm(t *testing.T) {
	for _, tc := range quantityForms {
		t.Run(tc.name, func(t *testing.T) {
			e := newRawJSONEndpoint(t, map[string]string{}).scriptMethod("eth_blockNumber", tc.raw)
			f := rawDial(t, e)
			n, err := f.BlockNumber(context.Background())
			require.ErrorContains(t, err, "all rpc endpoints failed")
			require.ErrorContains(t, err, "not a canonical JSON-RPC quantity",
				"the canon gate owns the refusal — not whatever hexutil happens to reject")
			require.ErrorContains(t, err, "eth_blockNumber response result", "the violation names the path it arrived in")
			require.ErrorContains(t, err, tc.reason)
			require.Zero(t, n)
		})
	}

	t.Run("the canon's zero: a genesis-shaped height stays servable", func(t *testing.T) {
		e := newRawJSONEndpoint(t, map[string]string{}).scriptMethod("eth_blockNumber", `"0x0"`)
		f := rawDial(t, e)
		n, err := f.BlockNumber(context.Background())
		require.NoError(t, err)
		require.Zero(t, n, "a REPORTED height 0 is a value like any other — only a non-answer is refused")
	})

	t.Run("a null result is a non-answer, not height zero", func(t *testing.T) {
		e := newRawJSONEndpoint(t, map[string]string{}) // eth_blockNumber unscripted → null
		f := rawDial(t, e)
		n, err := f.BlockNumber(context.Background())
		require.ErrorContains(t, err, "not a canonical JSON-RPC quantity")
		require.ErrorContains(t, err, "not a JSON string")
		require.Zero(t, n)
	})
}

var (
	rawLogTopic  = common.HexToHash("0x8a1f0000000000000000000000000000000000000000000000000000000000aa")
	rawLogTxHash = common.HexToHash("0x8a1f0000000000000000000000000000000000000000000000000000000000bb")
	rawLogAddr   = common.HexToAddress("0x4200000000000000000000000000000000000011")
)

// rawLogEntry is one mined eth_getLogs entry with every field the wire
// decode reads, as RAW JSON values — tests overwrite values byte-exactly
// (the strict wrappers judge exactly these bytes) and delete keys to model
// a provider omitting a field.
func rawLogEntry() map[string]string {
	return map[string]string{
		"address":          `"0x4200000000000000000000000000000000000011"`,
		"topics":           `["` + rawLogTopic.Hex() + `"]`,
		"data":             `"0xcafe"`,
		"blockNumber":      `"0x5a"`,
		"transactionHash":  `"` + rawLogTxHash.Hex() + `"`,
		"transactionIndex": `"0x1"`,
		"blockHash":        `"` + rawCursorHash.Hex() + `"`,
		"logIndex":         `"0x2"`,
		"removed":          `false`,
	}
}

// rawLogsResult serializes entries as the eth_getLogs result array, values
// passed through VERBATIM — rawJSONOverride's byte-exactness principle
// applied to whole objects.
func rawLogsResult(entries ...map[string]string) string {
	objs := make([]string, len(entries))
	for i, m := range entries {
		keys := make([]string, 0, len(m))
		for k := range m {
			keys = append(keys, k)
		}
		sort.Strings(keys)
		parts := make([]string, len(keys))
		for j, k := range keys {
			parts[j] = strconv.Quote(k) + ":" + m[k]
		}
		objs[i] = "{" + strings.Join(parts, ",") + "}"
	}
	return "[" + strings.Join(objs, ",") + "]"
}

// wantRawLog is the types.Log the healthy rawLogEntry converts to — every
// consumed field the crafted response's own, none defaulted.
func wantRawLog() types.Log {
	return types.Log{
		Address:     rawLogAddr,
		Topics:      []common.Hash{rawLogTopic},
		Data:        []byte{0xca, 0xfe},
		BlockNumber: rawCursor,
		TxHash:      rawLogTxHash,
		TxIndex:     1,
		BlockHash:   rawCursorHash,
		Index:       2,
		Removed:     false,
	}
}

// The round-7 finding, face two — "logIndex":"" in an otherwise valid mined
// log — as a real-Dial regression: the pinned *hexutil.Uint decodes "" as a
// PRESENT ZERO without error, so without the gate the attempt SUCCEEDS,
// failover stops at the malformed primary, and index zero persists as the
// raw-log identity/order — source-of-truth corruption, not a routing wart.
// The gate makes it a named canon violation that fails the attempt, and the
// healthy secondary DEMONSTRABLY lands the full window.
func TestRawJSONEmptyLogIndexFailsTheAttemptAndTheSecondaryLandsTheWindow(t *testing.T) {
	brokenLogs := func() *rawJSONEndpoint {
		entry := rawLogEntry()
		entry["logIndex"] = `""`
		return newRawJSONEndpoint(t, map[string]string{}).scriptMethod("eth_getLogs", rawLogsResult(entry))
	}

	// Alone: a named canon violation; no index-zero log escapes.
	f := rawDial(t, brokenLogs())
	logs, err := f.Logs(context.Background(), rawCursor, rawCursor, []common.Address{rawLogAddr})
	require.ErrorContains(t, err, "all rpc endpoints failed")
	require.ErrorContains(t, err, "not a canonical JSON-RPC quantity")
	require.ErrorContains(t, err, "log response logIndex")
	require.ErrorContains(t, err, "an empty quantity is a non-answer, not zero")
	require.Nil(t, logs, "the empty quantity never becomes a raw-log identity — no index-zero log is handed out")

	// With a healthy secondary: rotation, and the secondary LANDS the window.
	primary := brokenLogs()
	secondary := newRawJSONEndpoint(t, map[string]string{}).scriptMethod("eth_getLogs", rawLogsResult(rawLogEntry()))
	f = rawDial(t, primary, secondary)
	logs, err = f.Logs(context.Background(), rawCursor, rawCursor, []common.Address{rawLogAddr})
	require.NoError(t, err)
	require.Equal(t, []types.Log{wantRawLog()}, logs,
		"the FULL window lands from the honest endpoint — every consumed field is the crafted response's own")
	require.Equal(t, 1, primary.asksOf("eth_getLogs"), "the malformed primary was asked exactly once and rotated past")
	require.Equal(t, 1, secondary.asksOf("eth_getLogs"))
}

// Every consumed log quantity refuses every non-canonical form, the data
// payload refuses the data canon's forms, and the zero-valued acceptances
// pin the over-tightening guard: index 0, height 0, txIndex 0 and the "0x"
// empty payload are all VALUES, refused nowhere.
func TestRawJSONLogQuantityAndDataMatrixFailsEveryNonCanonicalForm(t *testing.T) {
	serve := func(t *testing.T, entry map[string]string) ([]types.Log, error) {
		t.Helper()
		e := newRawJSONEndpoint(t, map[string]string{}).scriptMethod("eth_getLogs", rawLogsResult(entry))
		f := rawDial(t, e)
		return f.Logs(context.Background(), 0, rawCursor, []common.Address{rawLogAddr})
	}

	for _, field := range []string{"blockNumber", "logIndex", "transactionIndex"} {
		for _, tc := range quantityForms {
			t.Run(field+" "+tc.name, func(t *testing.T) {
				entry := rawLogEntry()
				entry[field] = tc.raw
				logs, err := serve(t, entry)
				require.ErrorContains(t, err, "all rpc endpoints failed")
				require.ErrorContains(t, err, "not a canonical JSON-RPC quantity",
					"the canon gate owns the refusal — not whatever hexutil happens to reject")
				require.ErrorContains(t, err, "log response "+field, "the violation names the field it arrived in")
				require.ErrorContains(t, err, tc.reason)
				require.Nil(t, logs, "a non-canonical quantity never becomes a value")
			})
		}
	}

	for _, tc := range dataForms {
		t.Run("data "+tc.name, func(t *testing.T) {
			entry := rawLogEntry()
			entry["data"] = tc.raw
			logs, err := serve(t, entry)
			require.ErrorContains(t, err, "all rpc endpoints failed")
			require.ErrorContains(t, err, "not canonical JSON-RPC hex data",
				"the data canon owns the refusal — hexutil.Bytes would lenient-accept the empty and uppercase forms")
			require.ErrorContains(t, err, "log response data")
			require.ErrorContains(t, err, tc.reason)
			require.Nil(t, logs, "a non-canonical payload never becomes log data")
		})
	}

	t.Run("zero-valued quantities and the empty payload stay servable", func(t *testing.T) {
		entry := rawLogEntry()
		entry["blockNumber"] = `"0x0"`
		entry["logIndex"] = `"0x0"`
		entry["transactionIndex"] = `"0x0"`
		entry["data"] = `"0x"`
		logs, err := serve(t, entry)
		require.NoError(t, err)
		require.Len(t, logs, 1)
		require.Zero(t, logs[0].BlockNumber, "a REPORTED genesis height is a value")
		require.Zero(t, logs[0].Index, "log index zero is a value — the first log of a block")
		require.Zero(t, logs[0].TxIndex)
		require.Empty(t, logs[0].Data, `"0x" is the canonical empty payload — only "" is a non-answer`)
	})
}

// The mined-log wire shape is presence-tracked (the wave-6 rule, one decode
// path over): eth_getLogs answers a numbered range, so every returned log
// is mined and every consumed field must be PRESENT — the pinned decoder's
// optional-field leniency (an omitted blockHash silently becoming the zero
// hash, an omitted logIndex becoming index 0) is a protocol violation here,
// never a zero value. `removed` is the one accepted absence; a null result
// cannot impersonate the honest empty window []; zero hash identities are
// refused (the wave-5 posture — the fixed-length gate happily decodes 64
// zero digits, audit-executed).
func TestRawJSONLogPresenceAndNullWindowAreProtocolViolations(t *testing.T) {
	serve := func(t *testing.T, result string) ([]types.Log, error) {
		t.Helper()
		e := newRawJSONEndpoint(t, map[string]string{}).scriptMethod("eth_getLogs", result)
		f := rawDial(t, e)
		return f.Logs(context.Background(), 0, rawCursor, []common.Address{rawLogAddr})
	}

	required := []string{"address", "topics", "data", "blockNumber", "transactionHash", "transactionIndex", "blockHash", "logIndex"}
	for _, field := range required {
		t.Run("omitted "+field, func(t *testing.T) {
			entry := rawLogEntry()
			delete(entry, field)
			logs, err := serve(t, rawLogsResult(entry))
			require.ErrorContains(t, err, "log response entry 0 omits required field(s) "+field,
				"the absence is named as what it is — it does not decode into a plausible zero value")
			require.ErrorContains(t, err, "protocol violation")
			require.Nil(t, logs)
		})
	}

	t.Run("omitted removed is the one accepted absence", func(t *testing.T) {
		entry := rawLogEntry()
		delete(entry, "removed")
		logs, err := serve(t, rawLogsResult(entry))
		require.NoError(t, err)
		require.Len(t, logs, 1)
		require.False(t, logs[0].Removed,
			"absence decodes as false — the only honest value a mined-range query can carry")
	})

	t.Run("an anonymous log's empty topics array is a value, not an absence", func(t *testing.T) {
		entry := rawLogEntry()
		entry["topics"] = `[]`
		logs, err := serve(t, rawLogsResult(entry))
		require.NoError(t, err)
		require.Len(t, logs, 1)
		require.Empty(t, logs[0].Topics, "LOG0 events carry no topics — refusing [] would be over-tightening")
	})

	t.Run("a zero blockHash is refused", func(t *testing.T) {
		entry := rawLogEntry()
		entry["blockHash"] = `"` + common.Hash{}.Hex() + `"`
		logs, err := serve(t, rawLogsResult(entry))
		require.ErrorContains(t, err, "log response entry 0 reports a zero blockHash")
		require.ErrorContains(t, err, "protocol violation")
		require.Nil(t, logs)
	})

	t.Run("a zero transactionHash is refused", func(t *testing.T) {
		entry := rawLogEntry()
		entry["transactionHash"] = `"` + common.Hash{}.Hex() + `"`
		logs, err := serve(t, rawLogsResult(entry))
		require.ErrorContains(t, err, "log response entry 0 reports a zero transactionHash")
		require.Nil(t, logs)
	})

	t.Run("a null result cannot impersonate the empty window", func(t *testing.T) {
		e := newRawJSONEndpoint(t, map[string]string{}) // eth_getLogs unscripted → null
		f := rawDial(t, e)
		logs, err := f.Logs(context.Background(), 0, rawCursor, []common.Address{rawLogAddr})
		require.ErrorContains(t, err, "log response result is null")
		require.ErrorContains(t, err, "protocol violation")
		require.Nil(t, logs, "a non-answer never becomes an empty window")

		// Rotation: the null primary is walked past and the honest EMPTY
		// window [] serves from the secondary — the over-tightening guard.
		primary := newRawJSONEndpoint(t, map[string]string{})
		secondary := newRawJSONEndpoint(t, map[string]string{}).scriptMethod("eth_getLogs", `[]`)
		f = rawDial(t, primary, secondary)
		logs, err = f.Logs(context.Background(), 0, rawCursor, []common.Address{rawLogAddr})
		require.NoError(t, err)
		require.Empty(t, logs, "the provider's honest 'no logs in this range' is [] and it serves")
		require.Equal(t, 1, primary.asksOf("eth_getLogs"), "the null primary was asked exactly once and rotated past")
	})
}

// eth_chainId passes the same bytes canon (the wave-8 sweep): the pinned
// hexutil.Big decodes "" as chain id ZERO, and while VerifyChainID's
// equality would usually catch the minted zero, that refusal would rely on
// a wrong-value comparison one layer up — and for want zero it would not
// refuse at all. On this every-endpoint-must-agree path a violation fails
// the whole verification (no rotation by design).
func TestRawJSONChainIDStrictQuantity(t *testing.T) {
	t.Run("empty chainId is a canon violation, not chain id zero", func(t *testing.T) {
		e := newRawJSONEndpoint(t, map[string]string{}).scriptMethod("eth_chainId", `""`)
		f := rawDial(t, e)
		err := f.VerifyChainID(context.Background(), 10)
		require.ErrorContains(t, err, "chain id check failed on endpoint 0")
		require.ErrorContains(t, err, "not a canonical JSON-RPC quantity")
		require.ErrorContains(t, err, "eth_chainId response result")
		require.ErrorContains(t, err, "an empty quantity is a non-answer, not zero")

		// The sharpest face: a caller wanting zero. Without the bytes gate,
		// "" decodes to 0, 0 == 0, and the malformed endpoint VERIFIES.
		err = f.VerifyChainID(context.Background(), 0)
		require.Error(t, err)
		require.ErrorContains(t, err, "not a canonical JSON-RPC quantity",
			"a minted zero must never satisfy a zero want — the refusal happens at the bytes, not at the equality")
	})

	for _, tc := range quantityForms {
		t.Run(tc.name, func(t *testing.T) {
			e := newRawJSONEndpoint(t, map[string]string{}).scriptMethod("eth_chainId", tc.raw)
			f := rawDial(t, e)
			err := f.VerifyChainID(context.Background(), 10)
			require.ErrorContains(t, err, "not a canonical JSON-RPC quantity")
			require.ErrorContains(t, err, "eth_chainId response result")
			require.ErrorContains(t, err, tc.reason)
		})
	}

	t.Run("a canonical chain id verifies and a mismatch stays a mismatch", func(t *testing.T) {
		e := newRawJSONEndpoint(t, map[string]string{}).scriptMethod("eth_chainId", `"0xa"`)
		f := rawDial(t, e)
		require.NoError(t, f.VerifyChainID(context.Background(), 10))
		err := f.VerifyChainID(context.Background(), 1)
		require.ErrorContains(t, err, "reports chain id 10, want 1",
			"the wave-8 gate did not move the misconfiguration wording")
	})
}

var rawTxCalldata = []byte{0xcf, 0xc3, 0x25, 0x70, 0x01, 0x02}

// rawTxJSON builds a mined transaction's eth_getTransactionByHash result
// from a REAL types.Transaction round-trip (the pinned encoder emits every
// field, so the fixture is canonical by construction), then applies
// byte-exact raw overrides and deletions — the wire control the input gate
// is judged against.
func rawTxJSON(t *testing.T, overrides map[string]string, deletes ...string) string {
	t.Helper()
	to := common.HexToAddress("0x0078C5a459132e279056B2371fE8A8eC973A9553")
	tx := types.NewTx(&types.LegacyTx{
		Nonce: 1, GasPrice: big.NewInt(1), Gas: 21000, To: &to,
		Value: big.NewInt(0), Data: rawTxCalldata,
		V: big.NewInt(27), R: big.NewInt(1), S: big.NewInt(1),
	})
	b, err := tx.MarshalJSON()
	require.NoError(t, err)
	var m map[string]json.RawMessage
	require.NoError(t, json.Unmarshal(b, &m))
	// The mined coordinates a provider reports alongside the envelope.
	m["blockNumber"] = json.RawMessage(`"0x5a"`)
	m["blockHash"] = json.RawMessage(strconv.Quote(rawCursorHash.Hex()))
	m["transactionIndex"] = json.RawMessage(`"0x1"`)
	for k, v := range overrides {
		m[k] = json.RawMessage(v)
	}
	for _, k := range deletes {
		delete(m, k)
	}
	out, err := json.Marshal(m)
	require.NoError(t, err)
	return string(out)
}

// The wave-8 sweep's transaction face: TxCalldata consumes exactly one wire
// field — input — and the pinned decoder reads "input":"" as EMPTY calldata
// without error, a non-answer impersonating "this transaction carried no
// data" (which on the migration-genesis path would mint zero borrower
// seeds). The data canon refuses it by name and rotation lands the healthy
// secondary's calldata.
func TestRawJSONEmptyTxInputFailsTheAttemptAndTheSecondaryLandsCalldata(t *testing.T) {
	someTx := common.HexToHash("0xf57febcab9e40b18b13fe6e24dc0c846935eed5423b41443dfd287aae582f454")
	withInput := func(input string) *rawJSONEndpoint {
		return newRawJSONEndpoint(t, map[string]string{}).
			scriptMethod("eth_getTransactionByHash", rawTxJSON(t, map[string]string{"input": input}))
	}

	// Alone: a named data-canon violation; no empty calldata escapes.
	f := rawDial(t, withInput(`""`))
	data, err := f.TxCalldata(context.Background(), someTx)
	require.ErrorContains(t, err, "all rpc endpoints failed")
	require.ErrorContains(t, err, "not canonical JSON-RPC hex data")
	require.ErrorContains(t, err, "transaction response input")
	require.ErrorContains(t, err, "an empty payload is a non-answer")
	require.Nil(t, data, "the empty payload never becomes calldata")

	// With a healthy secondary: rotation, and the calldata LANDS.
	primary := withInput(`""`)
	secondary := newRawJSONEndpoint(t, map[string]string{}).
		scriptMethod("eth_getTransactionByHash", rawTxJSON(t, nil))
	f = rawDial(t, primary, secondary)
	data, err = f.TxCalldata(context.Background(), someTx)
	require.NoError(t, err)
	require.Equal(t, rawTxCalldata, data, "the healthy secondary's calldata LANDS, byte for byte")
	require.Equal(t, 1, primary.asksOf("eth_getTransactionByHash"), "the malformed primary was asked exactly once and rotated past")

	t.Run("uppercase input is refused at the bytes", func(t *testing.T) {
		f := rawDial(t, withInput(`"0xCFC32570"`))
		_, err := f.TxCalldata(context.Background(), someTx)
		require.ErrorContains(t, err, "not canonical JSON-RPC hex data")
		require.ErrorContains(t, err, "transaction response input")
		require.ErrorContains(t, err, "not a lowercase hex digit")
	})

	t.Run("omitted input is a named absence, not empty calldata", func(t *testing.T) {
		e := newRawJSONEndpoint(t, map[string]string{}).
			scriptMethod("eth_getTransactionByHash", rawTxJSON(t, nil, "input"))
		f := rawDial(t, e)
		_, err := f.TxCalldata(context.Background(), someTx)
		require.ErrorContains(t, err, "transaction response omits required field input")
		require.ErrorContains(t, err, "protocol violation")
	})

	t.Run("the canonical empty payload stays servable", func(t *testing.T) {
		f := rawDial(t, withInput(`"0x"`))
		data, err := f.TxCalldata(context.Background(), someTx)
		require.NoError(t, err)
		require.Empty(t, data, "a plain transfer's empty calldata is a value — only a non-answer is refused")
	})

	t.Run("a null result is the honest not-found, not a violation", func(t *testing.T) {
		e := newRawJSONEndpoint(t, map[string]string{}) // unscripted → null
		f := rawDial(t, e)
		_, err := f.TxCalldata(context.Background(), someTx)
		require.ErrorContains(t, err, "not found")
		require.NotContains(t, err.Error(), "protocol violation",
			"a legitimate not-found must not be misclassified as a violation")
	})
}
