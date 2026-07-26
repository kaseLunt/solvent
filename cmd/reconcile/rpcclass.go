// RPC error classification and paced pinned calling (brief §5, resolving
// L1-2/L1-3): nothing reusable existed — internal/chain's isBlockNotFoundErr
// is unexported and too narrow — so the classifier lives here, over
// chain.PinnedCallError.Attempts, and every attempt's endpoint +
// classification lands in the artifact.
package main

import (
	"context"
	"errors"
	"fmt"
	"math/rand"
	"strings"
	"time"

	gethrpc "github.com/ethereum/go-ethereum/rpc"

	"github.com/kaselunt/solvent/internal/chain"
)

// Classification buckets (brief §5). Three DECISION buckets — block-not-found
// (fork/lagging node → rotation already happened inside the walk),
// state-pruned (archive-capability verdict), transport-throttle (429 →
// bounded backoff) — plus the 403 capability refusal (NEVER backed off:
// waiting cannot grant a capability) and a residual transport bucket.
const (
	classBlockNotFound = "block-not-found"
	classStatePruned   = "state-pruned"
	classThrottle      = "transport-throttle"
	classCapability    = "capability-refusal"
	classTransport     = "transport-other"
)

// classifyAttemptErr classifies ONE endpoint's failure.
//
// Order matters: typed HTTP status first (429/403 are unambiguous), then
// state-pruned strings (the archive verdict must not be shadowed by the
// broad "not found" family), then block-not-found. The block-not-found match
// requires a block/header/hash context word alongside "not found" so a
// "method not found" transport error is never misread as a fork signal.
func classifyAttemptErr(err error) string {
	if err == nil {
		return classTransport
	}
	var httpErr gethrpc.HTTPError
	if errors.As(err, &httpErr) {
		switch httpErr.StatusCode {
		case 429:
			return classThrottle
		case 403:
			return classCapability
		}
	}
	msg := strings.ToLower(err.Error())
	if strings.Contains(msg, "too many requests") || strings.Contains(msg, "rate limit") {
		return classThrottle
	}
	for _, pruned := range []string{
		"missing trie node",
		"required historical state",
		"historical state unavailable",
		"historical state is not available",
		"state is not available",
		"state not available",
		"pruned",
	} {
		if strings.Contains(msg, pruned) {
			return classStatePruned
		}
	}
	if strings.Contains(msg, "unknown block") {
		return classBlockNotFound
	}
	if strings.Contains(msg, "not found") &&
		(strings.Contains(msg, "block") || strings.Contains(msg, "header") || strings.Contains(msg, "hash")) {
		return classBlockNotFound
	}
	return classTransport
}

// attemptRecord is one endpoint attempt's outcome as the artifact records it.
type attemptRecord struct {
	Endpoint int    `json:"endpoint"`
	Class    string `json:"class"`
	Error    string `json:"error"`
}

// classifyFailure explodes an error from a pinned-call walk into per-attempt
// records. A chain.PinnedCallError yields one record per attempted endpoint
// (walk order preserved); any other error yields a single endpoint=-1 record.
func classifyFailure(err error) []attemptRecord {
	var pce *chain.PinnedCallError
	if errors.As(err, &pce) {
		out := make([]attemptRecord, 0, len(pce.Attempts))
		for _, a := range pce.Attempts {
			out = append(out, attemptRecord{Endpoint: a.Endpoint, Class: classifyAttemptErr(a.Err), Error: a.Err.Error()})
		}
		return out
	}
	return []attemptRecord{{Endpoint: -1, Class: classifyAttemptErr(err), Error: err.Error()}}
}

// walkVerdict summarizes one full failed walk for the retry policy.
type walkVerdict struct {
	anyThrottle bool
	anyPruned   bool
	all403      bool
}

func summarizeWalk(records []attemptRecord) walkVerdict {
	v := walkVerdict{all403: len(records) > 0}
	for _, r := range records {
		switch r.Class {
		case classThrottle:
			v.anyThrottle = true
		case classStatePruned:
			v.anyPruned = true
		}
		if r.Class != classCapability {
			v.all403 = false
		}
	}
	return v
}

// pinnedFailure is a pinned call's TERMINAL outcome after the bounded retry
// budget: Class is the final classification the caller maps to an exit code
// (state-pruned at a golden pin → exit 2; at a fresh pin → exit 3; …).
type pinnedFailure struct {
	Op       string
	Class    string
	Attempts []attemptRecord // every retry's every endpoint attempt, in order
}

func (e *pinnedFailure) Error() string {
	return fmt.Sprintf("pinned call %s failed terminally (%s) after %d endpoint attempts", e.Op, e.Class, len(e.Attempts))
}

// limiter is the client-side token bucket (brief §5, `-rps`): ONE bucket
// across ALL endpoints and both chains — the drpc budget is one shared
// provider allowance and the daemon is consuming it concurrently, so
// reconcile paces against RESIDUAL headroom, sequentially.
type limiter struct {
	interval time.Duration
	next     time.Time
	sleep    func(context.Context, time.Duration) error
}

func newLimiter(rps float64, sleep func(context.Context, time.Duration) error) *limiter {
	if rps <= 0 {
		rps = 1.5
	}
	return &limiter{interval: time.Duration(float64(time.Second) / rps), sleep: sleep}
}

func (l *limiter) wait(ctx context.Context) error {
	now := time.Now()
	if now.Before(l.next) {
		if err := l.sleep(ctx, l.next.Sub(now)); err != nil {
			return err
		}
		l.next = l.next.Add(l.interval)
		return nil
	}
	l.next = now.Add(l.interval)
	return nil
}

func realSleep(ctx context.Context, d time.Duration) error {
	t := time.NewTimer(d)
	defer t.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-t.C:
		return nil
	}
}

// rpcRunner executes every comparison-phase RPC read: token bucket before
// each call, full-failover walk per attempt (CallAtHashFrom already rotates
// endpoints), bounded retries with exponential backoff + jitter ONLY when a
// walk saw a 429 (the load-balancer wrinkle: drpc/publicnode can alternate
// archive/pruned backends per request, so state-pruned is classified ONLY
// after the whole retry budget — never from one failed walk). A walk whose
// every attempt was a 403 terminates immediately (capability refusals are
// never backed off — brief §5).
type rpcRunner struct {
	limiter  *limiter
	attempts int
	backoff  time.Duration // first-retry backoff base (only after a 429)
	sleep    func(context.Context, time.Duration) error
	rng      *rand.Rand
	log      *rpcCallLog
	calls    int
}

// rpcCallLog accumulates the artifact's rpc section.
type rpcCallLog struct {
	Entries []rpcLogEntry `json:"entries"`
}

type rpcLogEntry struct {
	Op       string          `json:"op"`
	Chain    string          `json:"chain"`
	Endpoint int             `json:"endpoint"` // serving endpoint; -1 on failure
	Class    string          `json:"class"`    // "" on success
	Attempts []attemptRecord `json:"attempts,omitempty"`
}

func newRPCRunner(rps float64, attempts int, log *rpcCallLog) *rpcRunner {
	if attempts <= 0 {
		attempts = 5
	}
	return &rpcRunner{
		limiter:  newLimiter(rps, realSleep),
		attempts: attempts,
		backoff:  500 * time.Millisecond,
		sleep:    realSleep,
		rng:      rand.New(rand.NewSource(time.Now().UnixNano())),
		log:      log,
	}
}

// run executes fn (one full failover walk) under pacing and the bounded
// retry budget, recording every outcome. fn is typically a closure over
// CallAtHashFrom / HeaderHashFrom / HeaderTimeFrom.
func (r *rpcRunner) run(ctx context.Context, chainName, op string, fn func(ctx context.Context) (chain.EndpointToken, error)) (chain.EndpointToken, error) {
	var allRecords []attemptRecord
	sawPruned, sawThrottle := false, false
	for attempt := 0; attempt < r.attempts; attempt++ {
		if err := r.limiter.wait(ctx); err != nil {
			return chain.EndpointToken{Index: -1}, err
		}
		r.calls++
		token, err := fn(ctx)
		if err == nil {
			r.log.Entries = append(r.log.Entries, rpcLogEntry{Op: op, Chain: chainName, Endpoint: token.Index})
			return token, nil
		}
		records := classifyFailure(err)
		allRecords = append(allRecords, records...)
		v := summarizeWalk(records)
		if v.all403 {
			// Every configured endpoint refused on capability: backing off
			// cannot help and rotation is exhausted — terminal now, and the
			// caller maps it to exit 2.
			fail := &pinnedFailure{Op: op, Class: classCapability, Attempts: allRecords}
			r.log.Entries = append(r.log.Entries, rpcLogEntry{Op: op, Chain: chainName, Endpoint: -1, Class: fail.Class, Attempts: allRecords})
			return chain.EndpointToken{Index: -1}, fail
		}
		sawPruned = sawPruned || v.anyPruned
		sawThrottle = sawThrottle || v.anyThrottle
		if attempt < r.attempts-1 && v.anyThrottle {
			// Exponential backoff with jitter, 429 only (brief §5): the
			// pinned client does not surface Retry-After (geth's
			// rpc.HTTPError carries status and body only), so the bounded
			// exponential policy is the whole implementation — recorded as
			// such in the report.
			d := r.backoff << attempt
			d += time.Duration(r.rng.Int63n(int64(d)/2 + 1))
			if err := r.sleep(ctx, d); err != nil {
				return chain.EndpointToken{Index: -1}, err
			}
		}
	}
	class := classTransport
	switch {
	case sawPruned:
		// Only AFTER the whole bounded budget (load-balanced hosts can
		// alternate archive/pruned backends) does pruned become the verdict.
		class = classStatePruned
	case sawThrottle:
		class = classThrottle
	}
	fail := &pinnedFailure{Op: op, Class: class, Attempts: allRecords}
	r.log.Entries = append(r.log.Entries, rpcLogEntry{Op: op, Chain: chainName, Endpoint: -1, Class: class, Attempts: allRecords})
	return chain.EndpointToken{Index: -1}, fail
}
