package main

// The middleware chain: sanitization, the 429 shape, CORS, read-only refusal, and
// the JSON 404.

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

// TestSanitizeRedactsEndpointsAndDSNs pins the round-22 M2 class: no served
// string may carry an endpoint URL or a connection string.
func TestSanitizeRedactsEndpointsAndDSNs(t *testing.T) {
	for _, tc := range []struct {
		name  string
		in    string
		gone  []string
		kept  string
		redac string
	}{
		{
			name:  "postgres dsn with credentials",
			in:    `dial error: postgres://solvent:s3cret@db.internal:5432/solvent?sslmode=disable refused`,
			gone:  []string{"s3cret", "db.internal", "solvent:s3cret"},
			kept:  "dial error",
			redac: "[redacted-dsn]",
		},
		{
			name:  "postgres dsn without credentials",
			in:    `read cursor: postgresql://db.internal:5432/solvent timed out`,
			gone:  []string{"db.internal"},
			kept:  "read cursor",
			redac: "[redacted-dsn]",
		},
		{
			name:  "rpc endpoint",
			in:    `provider https://opt-mainnet.g.alchemy.com/v2/KEYKEYKEY returned 429`,
			gone:  []string{"alchemy.com", "KEYKEYKEY"},
			kept:  "returned 429",
			redac: "[redacted-url]",
		},
		{
			name:  "websocket endpoint",
			in:    `subscription wss://rpc.example.org/ws?token=abc dropped`,
			gone:  []string{"rpc.example.org", "token=abc"},
			kept:  "dropped",
			redac: "[redacted-url]",
		},
		{
			name:  "env assignment",
			in:    `refusing to start: SOLVENT_DATABASE_URL=postgres://u:p@h/db is unset?`,
			gone:  []string{"u:p@h"},
			kept:  "refusing to start",
			redac: "[redacted",
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			out := sanitize(tc.in)
			for _, g := range tc.gone {
				require.NotContains(t, out, g, "sanitize must remove %q", g)
			}
			require.Contains(t, out, tc.kept, "sanitize must keep the diagnostic prose")
			require.Contains(t, out, tc.redac)
		})
	}
}

// TestSanitizeLeavesOrdinaryProseAlone is the discriminator for the test above: a
// sanitizer that redacted everything would pass every NotContains assertion.
func TestSanitizeLeavesOrdinaryProseAlone(t *testing.T) {
	in := "G1: no usable price input for asset 0xCd5fE23C85820F7B72D0926FC9b05b43E359b7ee (verdict over-ceiling, budget 180s)"
	require.Equal(t, in, sanitize(in),
		"an ordinary refusal detail must survive sanitization byte-for-byte; a sanitizer that mangles it is not a sanitizer, it is a redactor")
}

func TestRateLimit429Shape(t *testing.T) {
	// A bucket of exactly one token: the first request passes, the second is
	// refused, and the refusal must carry the documented envelope AND the header.
	s := &server{
		cfg:     serverConfig{RateLimit: 1, RateBurst: 1},
		limiter: newIPLimiter(1, 1, time.Minute),
	}
	h := s.rateLimit(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, map[string]string{"ok": "yes"})
	}))

	first := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/v1/meta", nil)
	req.RemoteAddr = "203.0.113.7:51000"
	h.ServeHTTP(first, req)
	require.Equal(t, http.StatusOK, first.Code)

	second := httptest.NewRecorder()
	h.ServeHTTP(second, req)
	require.Equal(t, http.StatusTooManyRequests, second.Code)
	require.Equal(t, "application/json; charset=utf-8", second.Header().Get("Content-Type"))

	retry := second.Header().Get("Retry-After")
	require.NotEmpty(t, retry, "a 429 without Retry-After tells a client to guess")
	secs, err := strconv.ParseInt(retry, 10, 64)
	require.NoError(t, err)
	require.GreaterOrEqual(t, secs, int64(1))

	var body errorBody
	require.NoError(t, json.Unmarshal(second.Body.Bytes(), &body))
	require.Equal(t, codeRateLimited, body.Error.Code)
	require.Contains(t, body.Error.Message, "rate limit exceeded")
	require.NotNil(t, body.Error.RetryAfterSeconds)
	require.Equal(t, secs, *body.Error.RetryAfterSeconds)
}

// TestRateLimitIsPerClientAddress pins that one client's exhausted bucket does
// not refuse another client.
func TestRateLimitIsPerClientAddress(t *testing.T) {
	s := &server{cfg: serverConfig{RateLimit: 1, RateBurst: 1}, limiter: newIPLimiter(1, 1, time.Minute)}
	h := s.rateLimit(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(http.StatusOK) }))

	call := func(addr string) int {
		rec := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodGet, "/v1/meta", nil)
		req.RemoteAddr = addr
		h.ServeHTTP(rec, req)
		return rec.Code
	}
	require.Equal(t, http.StatusOK, call("198.51.100.1:1000"))
	require.Equal(t, http.StatusTooManyRequests, call("198.51.100.1:1001"),
		"the same address on a different source port is the same client")
	require.Equal(t, http.StatusOK, call("198.51.100.2:1000"),
		"a different address has its own bucket")
}

// TestRateLimitEvictsIdleBuckets pins the memory bound. The clock is a seam
// precisely so this does not have to sleep for the TTL.
func TestRateLimitEvictsIdleBuckets(t *testing.T) {
	l := newIPLimiter(10, 10, time.Minute)
	base := time.Date(2026, 7, 29, 12, 0, 0, 0, time.UTC)
	l.now = func() time.Time { return base }

	for i := 0; i < 5; i++ {
		ok, _ := l.allow("10.0.0." + strconv.Itoa(i))
		require.True(t, ok)
	}
	require.Equal(t, 5, l.size())

	// Two minutes later a SIXTH address arrives; the five idle buckets are swept.
	l.now = func() time.Time { return base.Add(2 * time.Minute) }
	ok, _ := l.allow("10.0.0.99")
	require.True(t, ok)
	require.Equal(t, 1, l.size(), "idle buckets past the TTL must be evicted, or a source-address scan grows the map without bound")
}

func TestCORSIsOpenAndPreflightIsAnswered(t *testing.T) {
	h := cors(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(http.StatusOK) }))

	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/v1/book", nil))
	require.Equal(t, "*", rec.Header().Get("Access-Control-Allow-Origin"))

	pre := httptest.NewRecorder()
	h.ServeHTTP(pre, httptest.NewRequest(http.MethodOptions, "/v1/book", nil))
	require.Equal(t, http.StatusNoContent, pre.Code)
	require.Equal(t, "*", pre.Header().Get("Access-Control-Allow-Origin"))
	require.Contains(t, pre.Header().Get("Access-Control-Allow-Methods"), "GET")
	require.NotContains(t, pre.Header().Get("Access-Control-Allow-Methods"), "POST")
}

func TestReadOnlyRefusesMutatingMethods(t *testing.T) {
	h := readOnly(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Fatal("a mutating method reached the handler")
	}))
	for _, m := range []string{http.MethodPost, http.MethodPut, http.MethodPatch, http.MethodDelete} {
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, httptest.NewRequest(m, "/v1/book", nil))
		require.Equal(t, http.StatusMethodNotAllowed, rec.Code, "method %s", m)
		require.Equal(t, "GET, HEAD, OPTIONS", rec.Header().Get("Allow"))
		var body errorBody
		require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &body))
		require.Equal(t, codeBadRequest, body.Error.Code)
		require.Contains(t, body.Error.Message, "read-only")
	}
}

func TestUnknownRouteAnswersJSON404(t *testing.T) {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /v1/book", func(w http.ResponseWriter, r *http.Request) { writeJSON(w, map[string]bool{"ok": true}) })
	h := notFoundJSON(mux)

	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/v1/nope", nil))
	require.Equal(t, http.StatusNotFound, rec.Code)
	require.Equal(t, "application/json; charset=utf-8", rec.Header().Get("Content-Type"))
	var body errorBody
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &body))
	require.Equal(t, codeNotFound, body.Error.Code)
	require.Contains(t, body.Error.Message, "/v1/book")

	// The discriminator: a REAL route must still get its own body through the
	// same wrapper, unmodified.
	ok := httptest.NewRecorder()
	h.ServeHTTP(ok, httptest.NewRequest(http.MethodGet, "/v1/book", nil))
	require.Equal(t, http.StatusOK, ok.Code)
	require.JSONEq(t, `{"ok":true}`, ok.Body.String())
}

func TestPanicRecoveryDoesNotEchoThePanicValue(t *testing.T) {
	h := recoverPanics(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		panic("dial postgres://solvent:s3cret@db.internal/solvent: boom")
	}))
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/v1/book", nil))
	require.Equal(t, http.StatusInternalServerError, rec.Code)
	require.NotContains(t, rec.Body.String(), "s3cret")
	require.NotContains(t, rec.Body.String(), "db.internal")
	var body errorBody
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &body))
	require.Equal(t, codeInternal, body.Error.Code)
}

func TestParseAddressIsStrict(t *testing.T) {
	good, err := parseAddress("0xCd5fE23C85820F7B72D0926FC9b05b43E359b7ee")
	require.NoError(t, err)
	require.Equal(t, "0xCd5fE23C85820F7B72D0926FC9b05b43E359b7ee", good.Hex())

	// Every one of these would be SILENTLY accepted by common.HexToAddress, which
	// truncates and zero-pads — resolving to an account the caller never asked
	// about and answering "no position" with confidence.
	for _, bad := range []string{
		"", "0x", "Cd5fE23C85820F7B72D0926FC9b05b43E359b7ee",
		"0xCd5fE23C85820F7B72D0926FC9b05b43E359b7e",
		"0xCd5fE23C85820F7B72D0926FC9b05b43E359b7eee",
		"0xCd5fE23C85820F7B72D0926FC9b05b43E359b7eg",
		"0x00000000000000000000000000000000000000000000000000000000000000ff",
	} {
		_, err := parseAddress(bad)
		require.Error(t, err, "must refuse %q", bad)
	}
}

func TestWriteErrorSanitizesTheMessage(t *testing.T) {
	rec := httptest.NewRecorder()
	writeError(rec, http.StatusInternalServerError, codeInternal,
		"read newest complete risk batch: dial postgres://u:p@h:5432/solvent failed", nil)
	require.NotContains(t, rec.Body.String(), "u:p@h")
	require.Contains(t, rec.Body.String(), "read newest complete risk batch")
	require.Equal(t, "no-store", rec.Header().Get("Cache-Control"))
}

// TestParseGridRefusesNonDescending pins the config guard: the monotonicity
// invariant is only meaningful on a strictly descending single-factor grid.
func TestParseGridRefusesNonDescending(t *testing.T) {
	_, err := parseGrid("1000000000000000000,900000000000000000")
	require.NoError(t, err)

	for _, bad := range []string{
		"900000000000000000,1000000000000000000",
		"1000000000000000000,1000000000000000000",
		"0",
		"-1",
		"",
		"abc",
	} {
		_, err := parseGrid(bad)
		require.Error(t, err, "must refuse grid %q", bad)
	}
}

func TestDefaultWaterfallGridOpensAtOne(t *testing.T) {
	grid := defaultWaterfallGrid()
	require.NotEmpty(t, grid)
	require.Equal(t, "1000000000000000000", grid[0].String(),
		"the first grid point must be the UNSHOCKED book: it is where the standing bad-debt line comes from, and relabelling a shocked point as `current` would be a fabrication")
	for i := 1; i < len(grid); i++ {
		require.Negative(t, grid[i].Cmp(grid[i-1]))
	}
	require.Equal(t, "500000000000000000", grid[len(grid)-1].String())
}

// TestStandingDisclosuresNameTheHardLimits keeps the honest small print from
// quietly disappearing: each of these is a limitation the design spec requires on
// the surface, and a passing test with an empty list would be worthless.
func TestStandingDisclosuresNameTheHardLimits(t *testing.T) {
	s := &server{}
	joined := strings.Join(s.standingDisclosures(), "\n")
	for _, want := range []string{
		"60-second samples",
		"BY CONSTRUCTION",
		"sweep-dominated",
		"rate_indexes",
		"PROJECTION",
		"zero RPC calls",
		"NEVER summed",
		"Refused positions are served WITH their reason",
	} {
		require.Contains(t, joined, want)
	}
	require.GreaterOrEqual(t, len(s.standingDisclosures()), 8)
}
