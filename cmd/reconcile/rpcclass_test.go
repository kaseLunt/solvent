// Classifier + paced-runner tests (brief §10: "classifier bucket table";
// mutation target 8: "classifier misfiles state-pruned as
// transport-retryable"). The fakes here CAN fail — 429 storms, capability
// refusals, pruned backends alternating with archive ones — per the house
// fixture-realism law.
package main

import (
	"context"
	"errors"
	"fmt"
	"testing"
	"time"

	gethrpc "github.com/ethereum/go-ethereum/rpc"
	"github.com/stretchr/testify/require"

	"github.com/kaselunt/solvent/internal/chain"
)

func TestClassifierBucketTable(t *testing.T) {
	cases := []struct {
		err  error
		want string
	}{
		{gethrpc.HTTPError{StatusCode: 429, Status: "429 Too Many Requests"}, classThrottle},
		{gethrpc.HTTPError{StatusCode: 403, Status: "403 Forbidden"}, classCapability},
		{errors.New("missing trie node 0xabc"), classStatePruned},
		{errors.New("required historical state unavailable (-32000)"), classStatePruned},
		{errors.New("historical state is not available"), classStatePruned},
		{errors.New("state is not available, request beyond pruned history"), classStatePruned},
		{errors.New("unknown block"), classBlockNotFound},
		{errors.New("header for hash not found"), classBlockNotFound},
		{errors.New("block 0xdeadbeef not found"), classBlockNotFound},
		// "not found" WITHOUT a block/header/hash context word must NOT be
		// misread as a fork signal.
		{errors.New("the method eth_pancakes was not found"), classTransport},
		{errors.New("Too Many Requests"), classThrottle},
		{errors.New("rate limit exceeded"), classThrottle},
		{errors.New("connection refused"), classTransport},
		{fmt.Errorf("wrap: %w", gethrpc.HTTPError{StatusCode: 429}), classThrottle},
	}
	for _, c := range cases {
		require.Equal(t, c.want, classifyAttemptErr(c.err), "error %q", c.err)
	}
}

// TestClassifierPrunedIsNeverThrottle is mutation target 8's kill: a
// state-pruned rejection classified transport-retryable would make the
// runner back off and retry a capability problem — and the preflight would
// then exit 3 (retryable) where the design demands the archive-capability
// verdict (exit 2 at a golden pin).
func TestClassifierPrunedIsNeverThrottle(t *testing.T) {
	err := errors.New("missing trie node deadbeef (state pruned)")
	got := classifyAttemptErr(err)
	require.Equal(t, classStatePruned, got)
	require.NotEqual(t, classThrottle, got)
}

func TestClassifyFailureExplodesPinnedCallError(t *testing.T) {
	pce := &chain.PinnedCallError{Op: "callAtHash", Attempts: []chain.AttemptError{
		{Endpoint: 0, Err: errors.New("missing trie node abc")},
		{Endpoint: 1, Err: gethrpc.HTTPError{StatusCode: 429}},
	}}
	records := classifyFailure(fmt.Errorf("wrapped: %w", pce))
	require.Len(t, records, 2)
	require.Equal(t, 0, records[0].Endpoint)
	require.Equal(t, classStatePruned, records[0].Class)
	require.Equal(t, 1, records[1].Endpoint)
	require.Equal(t, classThrottle, records[1].Class)

	plain := classifyFailure(errors.New("dial tcp: connection refused"))
	require.Len(t, plain, 1)
	require.Equal(t, -1, plain[0].Endpoint)
}

func newTestRunner(attempts int) (*rpcRunner, *[]time.Duration) {
	slept := &[]time.Duration{}
	fakeSleep := func(_ context.Context, d time.Duration) error {
		*slept = append(*slept, d)
		return nil
	}
	r := newRPCRunner(1000, attempts, &rpcCallLog{})
	r.sleep = fakeSleep
	r.limiter.sleep = fakeSleep
	return r, slept
}

// TestRunnerRetriesThrottleWithBackoff: one 429-failing walk then success —
// the runner backs off (exponential base recorded via the fake sleep) and
// the call lands; nothing terminal.
func TestRunnerRetriesThrottleWithBackoff(t *testing.T) {
	r, slept := newTestRunner(5)
	calls := 0
	tok, err := r.run(context.Background(), "op", "test", func(ctx context.Context) (chain.EndpointToken, error) {
		calls++
		if calls == 1 {
			return chain.EndpointToken{Index: -1}, &chain.PinnedCallError{Op: "callAtHash", Attempts: []chain.AttemptError{
				{Endpoint: 0, Err: gethrpc.HTTPError{StatusCode: 429}},
			}}
		}
		return chain.EndpointToken{Index: 1}, nil
	})
	require.NoError(t, err)
	require.Equal(t, 1, tok.Index)
	require.Equal(t, 2, calls)
	require.NotEmpty(t, *slept, "a 429 walk must back off before the retry")
}

// TestRunnerAll403IsTerminalImmediately: capability refusals are NEVER
// backed off — waiting cannot grant a capability (brief §5).
func TestRunnerAll403IsTerminalImmediately(t *testing.T) {
	r, slept := newTestRunner(5)
	calls := 0
	_, err := r.run(context.Background(), "eth", "test", func(ctx context.Context) (chain.EndpointToken, error) {
		calls++
		return chain.EndpointToken{Index: -1}, &chain.PinnedCallError{Op: "callAtHash", Attempts: []chain.AttemptError{
			{Endpoint: 0, Err: gethrpc.HTTPError{StatusCode: 403}},
			{Endpoint: 1, Err: gethrpc.HTTPError{StatusCode: 403}},
		}}
	})
	var pf *pinnedFailure
	require.ErrorAs(t, err, &pf)
	require.Equal(t, classCapability, pf.Class)
	require.Equal(t, 1, calls, "no retry after an all-403 walk")
	require.Empty(t, *slept, "403 is never backed off")
}

// TestRunnerPrunedOnlyAfterFullBudget pins the load-balancer wrinkle (brief
// §5): the same pinned call can alternate archive/pruned backends, so
// state-pruned is classified ONLY after the whole -rpc-attempts budget —
// and when one retry SUCCEEDS (the archive backend answered), no pruned
// verdict is ever issued.
func TestRunnerPrunedOnlyAfterFullBudget(t *testing.T) {
	// Case 1: pruned every walk → terminal state-pruned AFTER exactly
	// `attempts` walks, not one.
	r, _ := newTestRunner(3)
	calls := 0
	_, err := r.run(context.Background(), "eth", "test", func(ctx context.Context) (chain.EndpointToken, error) {
		calls++
		return chain.EndpointToken{Index: -1}, &chain.PinnedCallError{Op: "callAtHash", Attempts: []chain.AttemptError{
			{Endpoint: 0, Err: errors.New("missing trie node 0x1")},
		}}
	})
	var pf *pinnedFailure
	require.ErrorAs(t, err, &pf)
	require.Equal(t, classStatePruned, pf.Class)
	require.Equal(t, 3, calls, "pruned is a verdict about the whole budget, never one failed walk")
	require.Len(t, pf.Attempts, 3)

	// Case 2: pruned, pruned, then the archive backend serves → success.
	r2, _ := newTestRunner(3)
	calls = 0
	tok, err := r2.run(context.Background(), "eth", "test", func(ctx context.Context) (chain.EndpointToken, error) {
		calls++
		if calls < 3 {
			return chain.EndpointToken{Index: -1}, &chain.PinnedCallError{Op: "callAtHash", Attempts: []chain.AttemptError{
				{Endpoint: 0, Err: errors.New("required historical state unavailable")},
			}}
		}
		return chain.EndpointToken{Index: 0}, nil
	})
	require.NoError(t, err)
	require.Equal(t, 0, tok.Index)
	require.Equal(t, 3, calls)
}

// TestRunnerLogsEveryAttempt: every attempt's endpoint + classification
// lands in the artifact's rpc section (brief §5).
func TestRunnerLogsEveryAttempt(t *testing.T) {
	log := &rpcCallLog{}
	r := newRPCRunner(1000, 2, log)
	noSleep := func(context.Context, time.Duration) error { return nil }
	r.sleep = noSleep
	r.limiter.sleep = noSleep
	_, err := r.run(context.Background(), "op", "probe", func(ctx context.Context) (chain.EndpointToken, error) {
		return chain.EndpointToken{Index: -1}, &chain.PinnedCallError{Op: "x", Attempts: []chain.AttemptError{
			{Endpoint: 0, Err: errors.New("connection refused")},
			{Endpoint: 1, Err: errors.New("connection refused")},
		}}
	})
	require.Error(t, err)
	require.Len(t, log.Entries, 1)
	require.Equal(t, -1, log.Entries[0].Endpoint)
	require.Len(t, log.Entries[0].Attempts, 4, "2 walks × 2 endpoint attempts, all recorded")
}

func TestLimiterPacesCalls(t *testing.T) {
	var slept []time.Duration
	l := newLimiter(2, func(_ context.Context, d time.Duration) error {
		slept = append(slept, d)
		return nil
	})
	require.NoError(t, l.wait(context.Background()))
	require.NoError(t, l.wait(context.Background()))
	require.NotEmpty(t, slept, "the second call inside one interval must wait")
}
