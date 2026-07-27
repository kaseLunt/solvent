package chain

// Task 9 wave 17 — R-H: the timed From variants proven at the REAL-DIAL
// raw-JSON layer (the wave-7/8 hermetic harness style, below every fake
// seam). What R-H pins, verbatim from the chain-truth round-15 consult (Q3
// fixture-realism): servedElapsed is ATTEMPT-SCOPED IN PRODUCTION CODE — a
// slow-failing primary's dwell is paid by the call's WALL clock but never
// enters the serving attempt's own measurement. Without this test,
// per-witness timing would be proven at the walker's fake layer only — a
// fixture that cannot fail at the exact boundary round-15 finding 3 is
// about ("I refuse to certify Q3 without it").
//
// Schedule: the primary holds every ask ~200ms and then FAILS it (a real
// degraded-provider posture: slow AND broken); the secondary answers fast.
// The walk pays the primary's dwell, rotates, and lands on the secondary —
// so the call wall is >= the primary's delay while the token's servedElapsed
// is a fast local roundtrip, far below it. The divergence between those two
// numbers IS the property: an implementation measuring the whole walk cannot
// produce it.

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/core/types"
	"github.com/stretchr/testify/require"
)

// slowFailDelay is the primary's scripted dwell. servedFastBound is the
// generous ceiling the SERVING attempt must sit under: a local loopback
// roundtrip is sub-millisecond, so anything under half the dwell already
// proves the dwell is excluded; 100ms keeps the assertion honest on a loaded
// machine while staying "far below 200ms" (the consult's ≪ requirement).
const (
	slowFailDelay   = 200 * time.Millisecond
	servedFastBound = 100 * time.Millisecond
)

// slowFailingRawEndpoint holds EVERY JSON-RPC ask for delay and then fails it
// with a 500 — slow and broken at once, the finding-3 primary posture.
func slowFailingRawEndpoint(t *testing.T, delay time.Duration) *httptest.Server {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		time.Sleep(delay)
		http.Error(w, "backend overloaded", http.StatusInternalServerError)
	}))
	t.Cleanup(srv.Close)
	return srv
}

// timedDial dials the REAL stack (Dial → rpc.Client over HTTP) with the slow
// failing primary first and the given healthy secondary behind it.
func timedDial(t *testing.T, secondary *rawJSONEndpoint) *Failover {
	t.Helper()
	slow := slowFailingRawEndpoint(t, slowFailDelay)
	f, err := Dial(context.Background(), []string{slow.URL, secondary.srv.URL})
	require.NoError(t, err)
	return f
}

// requireAttemptScoped asserts the R-H property on one call's measurements:
// the wall paid the primary's dwell, the serving attempt did not.
func requireAttemptScoped(t *testing.T, wall, served time.Duration, tok EndpointToken) {
	t.Helper()
	require.Equal(t, 1, tok.Index, "the healthy secondary served, under its own token")
	require.GreaterOrEqual(t, wall, slowFailDelay,
		"the call WALL includes the slow-failing primary's dwell — the walk really paid it")
	require.Less(t, served, servedFastBound,
		"servedElapsed is the SERVING attempt's own cost: the primary's dwell sits outside it")
	require.Greater(t, served, time.Duration(0),
		"a real measured attempt, not an unpopulated zero")
}

func TestBlockNumberFromTimedMeasuresTheServingAttemptAlone(t *testing.T) {
	secondary := newRawJSONEndpoint(t, map[string]string{}).
		scriptMethod("eth_blockNumber", hexQuoted(rawHead))
	f := timedDial(t, secondary)

	began := time.Now()
	n, tok, served, err := f.BlockNumberFromTimed(context.Background(), 0)
	wall := time.Since(began)
	require.NoError(t, err)
	require.Equal(t, rawHead, n, "the value is the secondary's own answer")
	requireAttemptScoped(t, wall, served, tok)
}

func TestHeaderHashFromTimedMeasuresTheServingAttemptAlone(t *testing.T) {
	f := timedDial(t, healthyRawEndpoint(t))

	began := time.Now()
	h, tok, served, err := f.HeaderHashFromTimed(context.Background(), 0, rawCursor)
	wall := time.Since(began)
	require.NoError(t, err)
	require.Equal(t, rawCursorHash, h, "the hash is the secondary's reported header, verbatim")
	requireAttemptScoped(t, wall, served, tok)
}

func TestLogsFromTimedMeasuresTheServingAttemptAlone(t *testing.T) {
	secondary := newRawJSONEndpoint(t, map[string]string{}).
		scriptMethod("eth_getLogs", rawLogsResult(rawLogEntry()))
	f := timedDial(t, secondary)

	began := time.Now()
	logs, tok, served, err := f.LogsFromTimed(context.Background(), 0, rawCursor, rawCursor, []common.Address{rawLogAddr})
	wall := time.Since(began)
	require.NoError(t, err)
	require.Equal(t, []types.Log{wantRawLog()}, logs,
		"the full window lands from the honest endpoint")
	requireAttemptScoped(t, wall, served, tok)
}

// The total-failure face: when every endpoint fails, there is no serving
// attempt and therefore no measurement — the timed variants return a zero
// elapsed with the -1 token, never a fabricated number.
func TestTimedFromTotalFailureCarriesNoMeasurement(t *testing.T) {
	slow := slowFailingRawEndpoint(t, 1*time.Millisecond)
	f, err := Dial(context.Background(), []string{slow.URL})
	require.NoError(t, err)

	_, tok, served, err := f.BlockNumberFromTimed(context.Background(), 0)
	require.Error(t, err)
	require.Equal(t, -1, tok.Index)
	require.Zero(t, served, "no serving attempt, no measurement")
}
