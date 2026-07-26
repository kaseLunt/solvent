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
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"

	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/common/hexutil"
	"github.com/stretchr/testify/require"
)

// rawJSONEndpoint is a hermetic JSON-RPC HTTP server serving crafted raw
// `result` payloads for eth_getBlockByNumber, keyed by the request's block
// argument ("0x5a", "latest"). An argument with no scripted entry is answered
// with JSON null — the provider does not have the block. Every ask is
// recorded so tests can assert the exact question the adapter put on the
// wire.
type rawJSONEndpoint struct {
	srv *httptest.Server

	mu      sync.Mutex
	results map[string]string
	asks    []rawAsk
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
	}
	e.mu.Unlock()
	w.Header().Set("Content-Type", "application/json")
	fmt.Fprintf(w, `{"jsonrpc":"2.0","id":%s,"result":%s}`, req.ID, result)
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
