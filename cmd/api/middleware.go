package main

// Middleware: the per-IP token bucket, open CORS, read-only enforcement, panic
// recovery, and the string sanitizer every served string passes through.

import (
	"encoding/json"
	"log/slog"
	"math"
	"net"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	"golang.org/x/time/rate"
)

// ---------------------------------------------------------------------------
// Sanitization (design spec §10: "Every string surface sanitized of endpoint
// URLs" — the round-22 M2 class).
// ---------------------------------------------------------------------------

// sanitizePatterns are the shapes an endpoint URL or a DSN takes in a string
// this service might otherwise hand to the public.
//
// EVERY string that leaves this process goes through sanitize(): refusal
// details (which carry wrapped errors from internal/risk and could one day
// carry a connection error), error bodies, and log lines. It is a BELT over
// braces — no current message is known to embed a DSN — and it is the belt that
// survives the next change, which the braces do not.
//
// Order matters: the credential pattern runs FIRST so that a DSN carrying a
// password is redacted whole rather than leaving `user:secret@` behind after the
// scheme is replaced.
var sanitizePatterns = []struct {
	re   *regexp.Regexp
	with string
}{
	// scheme://user:password@host…  — the credential-bearing form.
	{regexp.MustCompile(`(?i)\b[a-z][a-z0-9+.-]*://[^\s/@]*:[^\s/@]*@\S*`), "[redacted-dsn]"},
	// postgres/postgresql URLs without credentials.
	{regexp.MustCompile(`(?i)\bpostgres(ql)?://\S*`), "[redacted-dsn]"},
	// any other absolute URL: an RPC endpoint, a provider host, an internal
	// service address.
	{regexp.MustCompile(`(?i)\b(https?|wss?)://\S*`), "[redacted-url]"},
	// `KEY=value` for the env names that name endpoints.
	{regexp.MustCompile(`(?i)\bSOLVENT_[A-Z0-9_]*(DATABASE_URL|RPC[A-Z0-9_]*)\s*=\s*\S+`), "[redacted-env]"},
}

// sanitize redacts endpoint URLs and DSNs from s.
func sanitize(s string) string {
	for _, p := range sanitizePatterns {
		s = p.re.ReplaceAllString(s, p.with)
	}
	return s
}

// sanitizeAll applies sanitize to every element of a slice, in place-safe form.
func sanitizeAll(in []string) []string {
	if in == nil {
		return nil
	}
	out := make([]string, len(in))
	for i, s := range in {
		out[i] = sanitize(s)
	}
	return out
}

// ---------------------------------------------------------------------------
// The error envelope.
// ---------------------------------------------------------------------------

// Error codes. A closed set, so a client can branch on the code rather than
// parsing prose.
const (
	codeBadRequest  = "bad_request"
	codeNotFound    = "not_found"
	codeRateLimited = "rate_limited"
	codeUnavailable = "unavailable"
	codeInternal    = "internal"
)

type errorBody struct {
	Error errorDetail `json:"error"`
}

type errorDetail struct {
	Code    string `json:"code"`
	Message string `json:"message"`
	// RetryAfterSeconds is set on 429 and 503 — the two statuses where waiting is
	// the correct client behaviour.
	RetryAfterSeconds *int64 `json:"retry_after_seconds,omitempty"`
}

// writeError emits the error envelope. The message is sanitized here rather than
// at every call site, so a new call site cannot forget.
func writeError(w http.ResponseWriter, status int, code, message string, retryAfter *int64) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	if retryAfter != nil {
		w.Header().Set("Retry-After", strconv.FormatInt(*retryAfter, 10))
	}
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(errorBody{Error: errorDetail{
		Code:              code,
		Message:           sanitize(message),
		RetryAfterSeconds: retryAfter,
	}})
}

// writeJSON emits a success body.
func writeJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	// A risk number is never cacheable: the batch behind it moves on riskd's
	// cadence and supersession is judged against a LIVE cursor read.
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(http.StatusOK)
	if err := json.NewEncoder(w).Encode(v); err != nil {
		// The status is already written; all that is left is to record it.
		slog.Error("api: encoding response failed after the header was written", "err", sanitize(err.Error()))
	}
}

// ---------------------------------------------------------------------------
// CORS — open, because every byte here is public and read-only.
// ---------------------------------------------------------------------------

func cors(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h := w.Header()
		h.Set("Access-Control-Allow-Origin", "*")
		h.Set("Access-Control-Allow-Methods", "GET, HEAD, POST, OPTIONS")
		h.Set("Access-Control-Allow-Headers", "Content-Type, Accept, Last-Event-ID")
		h.Set("Access-Control-Max-Age", "600")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

// ---------------------------------------------------------------------------
// Read-only enforcement.
// ---------------------------------------------------------------------------

// readOnly refuses every method that is not a read.
//
// The router's patterns are almost all `GET`, so net/http would already answer
// 405 — this exists so the refusal is a PROPERTY OF THE SERVICE rather than a
// consequence of how the routes happen to be spelled, and so the 405 carries the
// same JSON envelope as every other error.
//
// The ONE admitted POST is /v1/scenarios/{id}/run-book, which is per-request
// COMPUTE over the newest servable batch and writes nothing — the read-only
// property is still enforced structurally by TestAPIIssuesNoWritingSQL, which
// scans this package's SQL, and by the SELECT-only database role in
// production. POST here is a statement about request semantics (the evaluation
// is computed on demand), never about mutation.
func readOnly(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == http.MethodGet, r.Method == http.MethodHead, r.Method == http.MethodOptions:
			next.ServeHTTP(w, r)
		case r.Method == http.MethodPost && isRunBookPath(r.URL.Path):
			next.ServeHTTP(w, r)
		default:
			w.Header().Set("Allow", "GET, HEAD, OPTIONS")
			writeError(w, http.StatusMethodNotAllowed, codeBadRequest,
				"this API is read-only: "+r.Method+" is not accepted on this route "+
					"(the one POST is /v1/scenarios/{id}/run-book, which computes and writes nothing)", nil)
		}
	})
}

// isRunBookPath matches /v1/scenarios/{id}/run-book with a NON-EMPTY single
// path segment for {id}. It is deliberately narrow: the read-only gate opens
// for exactly the one computed route, not for a path family.
func isRunBookPath(path string) bool {
	rest, ok := strings.CutPrefix(path, "/v1/scenarios/")
	if !ok {
		return false
	}
	id, ok := strings.CutSuffix(rest, "/run-book")
	return ok && id != "" && !strings.Contains(id, "/")
}

// notFoundJSON turns net/http's text 404/405 into the JSON envelope.
//
// It works by SNIFFING the status the router wrote: net/http's ServeMux answers
// an unmatched path itself, and there is no hook to replace that body. Buffering
// only the not-found/method-not-allowed cases keeps every real response
// streaming (which /v1/stream requires).
func notFoundJSON(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		sw := &statusSniffer{ResponseWriter: w}
		next.ServeHTTP(sw, r)
		if !sw.wrote {
			return
		}
	})
}

// statusSniffer replaces net/http's plain-text 404 and 405 bodies with the JSON
// envelope. Anything else passes through untouched, headers and all.
type statusSniffer struct {
	http.ResponseWriter
	wrote     bool
	suppress  bool
	sniffedOK bool
}

func (s *statusSniffer) WriteHeader(status int) {
	s.wrote = true
	if !s.sniffedOK && (status == http.StatusNotFound || status == http.StatusMethodNotAllowed) {
		// Only net/http's own bodies are text/plain here; a handler that already
		// produced the JSON envelope has set the JSON content type.
		if ct := s.Header().Get("Content-Type"); ct == "" || strings.HasPrefix(ct, "text/plain") {
			s.suppress = true
			code, msg := codeNotFound, "no such route: this API serves /v1/book, /v1/positions, /v1/address/{addr}, /v1/address/{addr}/stress, /v1/address/{addr}/history, /v1/observatory, /v1/observatory/series, /v1/events, /v1/params, /v1/prices/{asset}, /v1/scenarios/{id}/run-book, /v1/evidence, /v1/stream and /v1/meta"
			if status == http.StatusMethodNotAllowed {
				code, msg = codeBadRequest, "this API is read-only: only GET, HEAD and OPTIONS are accepted (plus POST on /v1/scenarios/{id}/run-book, which computes and writes nothing)"
			}
			s.Header().Set("Content-Type", "application/json; charset=utf-8")
			s.ResponseWriter.WriteHeader(status)
			_ = json.NewEncoder(s.ResponseWriter).Encode(errorBody{Error: errorDetail{Code: code, Message: msg}})
			return
		}
	}
	s.sniffedOK = true
	s.ResponseWriter.WriteHeader(status)
}

func (s *statusSniffer) Write(b []byte) (int, error) {
	if s.suppress {
		return len(b), nil // net/http's text body, already replaced
	}
	if !s.wrote {
		s.wrote, s.sniffedOK = true, true
	}
	return s.ResponseWriter.Write(b)
}

// Flush keeps the SSE handler's flusher reachable through the wrapper. Without
// it the stream would buffer until the connection closed, which is the same as
// not streaming at all.
func (s *statusSniffer) Flush() {
	if f, ok := s.ResponseWriter.(http.Flusher); ok {
		f.Flush()
	}
}

// ---------------------------------------------------------------------------
// Panic recovery.
// ---------------------------------------------------------------------------

func recoverPanics(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			if v := recover(); v != nil {
				// The panic value is NOT echoed: it can contain anything, including a
				// connection string from a driver error. The log gets it (sanitized);
				// the client gets a code.
				slog.Error("api: panic serving request", "path", r.URL.Path, "panic", sanitize(fmtAny(v)))
				writeError(w, http.StatusInternalServerError, codeInternal,
					"the service failed to build this response", nil)
			}
		}()
		next.ServeHTTP(w, r)
	})
}

func fmtAny(v any) string {
	if err, ok := v.(error); ok {
		return err.Error()
	}
	if s, ok := v.(string); ok {
		return s
	}
	return "non-error panic value"
}

// ---------------------------------------------------------------------------
// Rate limit: x/time/rate per-IP token bucket, env-tuned.
// ---------------------------------------------------------------------------

// ipLimiter is a bounded map of per-IP token buckets.
//
// # Why the map is swept
//
// A bucket per source address is unbounded memory in the presence of a scan (or
// of IPv6, where an attacker owns more addresses than there are buckets). Idle
// buckets are evicted after RateTTL, which is safe because an evicted bucket is
// recreated FULL — the only thing an attacker gains by cycling addresses is the
// burst they would have had anyway on a first request from that address.
type ipLimiter struct {
	mu      sync.Mutex
	buckets map[string]*ipBucket
	limit   rate.Limit
	burst   int
	ttl     time.Duration
	// now is a seam so the eviction test does not have to sleep.
	now func() time.Time
}

type ipBucket struct {
	limiter *rate.Limiter
	seen    time.Time
}

func newIPLimiter(rps float64, burst int, ttl time.Duration) *ipLimiter {
	return &ipLimiter{
		buckets: map[string]*ipBucket{},
		limit:   rate.Limit(rps),
		burst:   burst,
		ttl:     ttl,
		now:     time.Now,
	}
}

// allow reports whether this key may proceed, and how long it should wait if
// not.
func (l *ipLimiter) allow(key string) (bool, time.Duration) {
	l.mu.Lock()
	now := l.now()
	b, ok := l.buckets[key]
	if !ok {
		b = &ipBucket{limiter: rate.NewLimiter(l.limit, l.burst)}
		l.buckets[key] = b
	}
	b.seen = now
	// Sweep opportunistically, under the lock we already hold: no timer
	// goroutine to leak, and the cost is proportional to the map we are about to
	// bound.
	if len(l.buckets) > 1 {
		for k, v := range l.buckets {
			if k != key && now.Sub(v.seen) > l.ttl {
				delete(l.buckets, k)
			}
		}
	}
	lim := b.limiter
	l.mu.Unlock()

	res := lim.ReserveN(now, 1)
	if !res.OK() {
		// Burst is smaller than the request cost; a bucket configured this way can
		// never admit anything, so say so rather than promising a retry.
		return false, 0
	}
	if d := res.DelayFrom(now); d > 0 {
		res.CancelAt(now)
		return false, d
	}
	return true, 0
}

// size reports the number of live buckets (tests only).
func (l *ipLimiter) size() int {
	l.mu.Lock()
	defer l.mu.Unlock()
	return len(l.buckets)
}

// rateLimit applies the per-IP bucket.
//
// The key is the CONNECTION's remote address, not an X-Forwarded-For header: a
// client-supplied header is a client-chosen bucket, which is not a rate limit at
// all. Deploying behind a proxy therefore needs a deliberate decision about
// which header to trust — that decision belongs to P5's deployment work, and
// until it is made this refuses to pretend it has been.
func (s *server) rateLimit(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		key := clientKey(r)
		ok, wait := s.limiter.allow(key)
		if ok {
			next.ServeHTTP(w, r)
			return
		}
		secs := int64(math.Ceil(wait.Seconds()))
		if secs < 1 {
			secs = 1
		}
		writeError(w, http.StatusTooManyRequests, codeRateLimited,
			"rate limit exceeded: this surface admits "+
				strconv.FormatFloat(float64(s.limiter.limit), 'f', -1, 64)+
				" requests per second per client address, burst "+
				strconv.Itoa(s.limiter.burst), &secs)
	})
}

// clientKey is the limiter key: the remote IP, port stripped.
func clientKey(r *http.Request) string {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}
