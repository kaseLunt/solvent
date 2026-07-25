package main

// Fake-clock tests for the time-based walker backoff (fix wave): the old
// round-counting backoff was burnable — a busy sibling keeps the daemon's
// inner loop spinning hot, so "skip 5 rounds" could elapse in milliseconds.
// The timestamp form must hold its full delay no matter how often a hot
// loop polls ready().

import (
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

// fakeClock is a manually-advanced clock for backoff tests.
type fakeClock struct{ t time.Time }

func (c *fakeClock) now() time.Time          { return c.t }
func (c *fakeClock) advance(d time.Duration) { c.t = c.t.Add(d) }
func newBackoff(c *fakeClock, r float64) *retryBackoff {
	return &retryBackoff{now: c.now, rand: func() float64 { return r }}
}

// TestWalkerBackoffHotLoopDoesNotBurn is the named hot-loop backoff failure
// injection: while a sibling walker advances continuously (thousands of hot
// rounds, each polling ready()), a backed-off walker must sit out its FULL
// wall-clock delay — polls move no state — and become ready exactly when
// the timestamp passes.
func TestWalkerBackoffHotLoopDoesNotBurn(t *testing.T) {
	clock := &fakeClock{t: time.Unix(1_000_000, 0)}
	b := newBackoff(clock, 0.5) // rand=0.5 → jitter factor exactly 1.0

	require.True(t, b.ready(), "a fresh walker is ready")
	delay := b.failure()
	require.Equal(t, retryBackoffBase, delay)

	// The sibling's hot loop: 10k rounds burn through in ~10ms of wall time.
	for i := 0; i < 10_000; i++ {
		require.False(t, b.ready(), "a hot loop must not burn the backoff (round %d)", i)
		clock.advance(time.Microsecond)
	}
	require.Equal(t, 1, b.failures, "polling ready() must not touch state")

	clock.advance(retryBackoffBase) // past the deadline
	require.True(t, b.ready(), "the walker re-arms when the timestamp passes, not after N rounds")
}

// TestWalkerBackoffExponentialToCap: consecutive failures double the delay
// from the base up to the cap, where it stays (no overflow past the guard).
func TestWalkerBackoffExponentialToCap(t *testing.T) {
	clock := &fakeClock{t: time.Unix(1_000_000, 0)}
	b := newBackoff(clock, 0.5)

	want := []time.Duration{
		30 * time.Second, // 1st failure
		1 * time.Minute,
		2 * time.Minute,
		4 * time.Minute,
		8 * time.Minute,
		10 * time.Minute, // 16m capped
		10 * time.Minute, // stays capped
	}
	for i, w := range want {
		require.Equal(t, w, b.failure(), "failure %d", i+1)
	}
	// Deep failure counts (shift guard territory) still yield the cap.
	b.failures = 40
	require.Equal(t, retryBackoffCap, b.failure())
}

// TestWalkerBackoffJitterBounds: the jitter multiplies the delay by a factor
// in [1-j, 1+j] — rand=0 and rand→1 pin the extremes.
func TestWalkerBackoffJitterBounds(t *testing.T) {
	clock := &fakeClock{t: time.Unix(1_000_000, 0)}

	low := newBackoff(clock, 0)
	require.Equal(t, time.Duration(float64(retryBackoffBase)*(1-retryBackoffJitter)), low.failure(),
		"rand=0 → -20 percent")

	high := newBackoff(clock, 0.999999)
	got := high.failure()
	require.Greater(t, got, retryBackoffBase, "rand→1 jitters upward")
	require.LessOrEqual(t, got, time.Duration(float64(retryBackoffBase)*(1+retryBackoffJitter)))
}

// TestWalkerBackoffSuccessResets: one clean round fully re-arms the walker —
// the next failure starts back at the base delay.
func TestWalkerBackoffSuccessResets(t *testing.T) {
	clock := &fakeClock{t: time.Unix(1_000_000, 0)}
	b := newBackoff(clock, 0.5)

	b.failure()
	b.failure()
	require.Equal(t, 2, b.failures)
	require.False(t, b.ready())

	b.success()
	require.True(t, b.ready(), "success clears any scheduled delay")
	require.Equal(t, retryBackoffBase, b.failure(), "the exponent restarts from the base")
}
