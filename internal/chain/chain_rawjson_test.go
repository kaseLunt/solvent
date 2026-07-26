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

// Malformed hex in a required field is a decode failure of the attempt — the
// rpc layer rejects the response before validation ever sees it, and the walk
// rotates like any endpoint fault.
func TestRawJSONMalformedHexFailsTheAttemptAndRotates(t *testing.T) {
	garbled := func() *rawJSONEndpoint {
		fields := rawBlockFields(rawCursor, rawCursorHash, rawCursorParent, rawCursorTime)
		fields["timestamp"] = "0xnope"
		return newRawJSONEndpoint(t, map[string]string{"0x5a": rawJSON(fields)})
	}

	f := rawDial(t, garbled())
	_, err := f.HeaderTime(context.Background(), rawCursor)
	require.ErrorContains(t, err, "all rpc endpoints failed")
	require.ErrorContains(t, err, "invalid hex", "the decode failure names the garbage")

	broken := garbled()
	f = rawDial(t, broken, healthyRawEndpoint(t))
	ts, err := f.HeaderTime(context.Background(), rawCursor)
	require.NoError(t, err)
	require.Equal(t, rawCursorTime, ts, "the healthy secondary lands the read")
	require.Equal(t, []string{"0x5a"}, broken.blockAsks(t))
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
