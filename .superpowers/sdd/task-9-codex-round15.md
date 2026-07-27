# Codex adversarial review — task 9 wave 14 (round 15, ingest CLOSING round attempt)

- **Target:** detached `b9c5c33`, range `68ccfdb..b9c5c33` restricted to
  `internal/ingest/**`, `internal/chain/**`, `cmd/indexer/**` (the wave-14 report's
  mandated framing — covers the full wave-12 surface incl. `10ed6d8`/`b6e7c2f` that
  round 12's framing missed, plus wave 14 and the report).
- **Verdict:** **NO-SHIP** — 2 high, 2 medium, 1 low.
- **Job:** `task-ms2m79po-dm43mx`; session `019fa16d-99c2-7a43-b3936f7e482c7`
  (verbatim from dispatch record); worktree
  `C:/wt-solvent-w14close` (short path forced by Windows long-path limits on
  `roadmap/insights/INS-*.md`), pruned post-review; thirteenth orphaned-broker killed
  (PID verified against `--cwd` before kill).
- **Confirmed sound:** the wave-12 outcome flag, R3 caller-scoped routing, R9
  discard/backoff composition, additive chain methods; and the CONTROLLER'S -RACE
  PROVENANCE CHAIN for the recovered wave-14 report — "`67cda28` is an ancestor of
  `33fd775`; `internal/ingest`, `internal/chain`, `cmd/indexer`, `go.mod`, `go.sum`
  have identical Git object IDs at both commits" — independently verified by the
  reviewer at the object-ID level.
- **REVIEWER ERRATUM (recorded, does not affect findings):** the dispatch note claimed
  "main had advanced past b9c5c33 (current tip 3cc34da)". FALSE: at retrieval time
  `origin/main == 05ffd9a` (this controller's push); `3cc34da` is a DEEP ANCESTOR of
  main (the D-007/generation-5 governance commit from the claim-lease era, days old),
  confirmed via `git branch --contains` + `git log`. The reviewer read a stale
  snapshot as current. The review itself was pinned at detached `b9c5c33`, the correct
  tip at dispatch, so the target and findings stand.

## Findings (verbatim)

### 1. [high] `internal/ingest/walker.go:454-457,497-502,555-557` — armed probe permanently stalls on a responsive-frozen neighbor
An armed probe can permanently stall on a responsive-frozen neighbor. After incumbent A spends its lease, let probe B report a frozen head whose safe height equals the durable cursor while A continues advancing. B successfully answers the head and cursor-header reads, so the Step returns caught-up; the deferred arm preserves both `startPref=A` and the spent lease. Every subsequent Step therefore probes B again and returns caught-up forever. No error rotates routing, and the healthy incumbent is never revisited. Durable freshness eventually reports red but cannot repair routing.

### 2. [high] `internal/ingest/walker.go:385-402,466-471` — fall-through probe retried every Step; total resolution failure bypasses the seam
A probe that falls through to the incumbent is retried every Step instead of rearming, while a total resolution failure bypasses the seam entirely. With A taking six 29-second successful reads and B hanging until its 30-second attempt timeout, three A landings arm the lease. Every later Step starts at B, pays B's timeout, wraps to A, lands, increments the already-spent count, and remains armed. `stepWalkers` can consequently spend roughly 17 minutes on five Steps every round—worse than the original starvation schedule. If nobody answers once, the return before the defer preserves the same spent state for recovery.

### 3. [medium] `internal/ingest/walker.go:365-375,465-466` — measured latency is not per-witness across a failover resolution walk
Suppose A's baseline is 31 seconds, B times out after 30 seconds, and third endpoint C serves the complete Step in 6 seconds. The recorded probe wall is 36 seconds, so C is judged "no faster" and A remains preferred forever despite C being about five times faster. Conversely, with a 40-second A baseline, C is adopted but starts with one slow landing charged against it because B's timeout made the combined wall exceed 30 seconds. The numeric count resets on witness change, but the evidence used to create that count is inherited from another witness.

### 4. [medium] `internal/ingest/walker.go:465,493-496,707` — store latency folded into endpoint adjudication without a bound or attribution guard
Three fast-RPC Steps with slow successful PostgreSQL commits can spend the lease and trigger probes despite no endpoint problem. Store-time variation can then make a slower RPC endpoint appear faster and transfer retention to it. A consistently slow write also invalidates the report's stated wall-clock upper bound because `SaveBatch` time is not bounded by `stepMaxPinnedReads × chainAttemptTimeout`. The fake latency tests model only RPC read cost.

### 5. [low] `internal/ingest/walker.go:215,261`, `internal/chain/chain.go:24`, `internal/snapshot/snapshot.go:159` — both restated constants can drift silently
Comments document the relationship, and `cmd/indexer/walker_latency_scheduling_test.go:87` guards only the lease-versus-daemon inequality; nothing mechanically checks either equality. If the chain timeout drops to 5 seconds while ingest remains at 30 seconds, six successful 4-second reads remain permanently below ingest's budget despite consuming almost five chain-attempt budgets. Likewise, changing the ratified ambiguity lease without updating ingest silently diverges the claimed shared policy.

## Controller adjudication (provisional pending chain-truth consult; wave 17 to follow)

All five read VALID. The shared root of the two highs: the armed probe has no outcome
discipline — arming is bounded (the lease) but the ARMED state itself is unbounded in
both directions (retry-forever on fall-through; point-forever at a caught-up-reporting
neighbor). Direction for the brief, to be sharpened by chain-truth:

1. **Probe outcomes become total and terminal:** a probe Step that does not LAND a
   window strictly faster than the baseline — caught-up, failure, fall-through to the
   incumbent, slower landing, tie — REJECTS the probe: routing returns to the
   incumbent (a no-op, `startPref` never moved) and the lease RE-ARMS IN FULL. The
   "liveness owed a recovering neighbour" is paid at the NEXT lease expiry (bounded:
   one probe per spent lease), not every Step. This kills finding 1 (frozen B answers
   caught-up → rejected → next Step starts at A) and finding 2's per-Step timeout tax.
2. **The early-return path joins the seam** (finding 2's second half): total
   resolution failure must flow through the deferred outcome handler like every other
   posture — no return bypasses it.
3. **Per-witness measurement** (finding 3): adjudicate on the LANDING WITNESS's own
   elapsed time (the per-endpoint fake already carries `readCost` — production
   accumulates per-endpoint elapsed during the walk), never the whole-walk wall.
4. **The clock stops before the store** (finding 4): the budget's own rationale is RPC
   occupancy; make it structural — measure the resolution walk only, exclude
   `SaveBatch`. (Slow-store visibility is a separate daemon-health signal, not
   endpoint adjudication.)
5. **Kill the drift** (finding 5): export the chain attempt timeout (the wave-14
   report itself proposed this for the next chain-open wave — this is one) and assert
   equality from ingest; same treatment for the lease-length restatement chain
   (export/assert against the ratified source).

Scope note: wave 16 (running) owns `cmd/reconcile/**`, `internal/store/**`,
`cmd/indexer/**` — wave 17 therefore owns `internal/ingest/**` + `internal/chain/**`
(+ the minimal export in `internal/snapshot`/`internal/prices` IF forced — flag it)
and must NOT touch `cmd/indexer`; any daemon-level assertion it cannot express at the
walker layer is flagged for the closing round, not smuggled in.

Ingest trend: R12 1H → R15 2H2M1L — breadth up because the probe is NEW surface (wave
14 built it); the wave-12 substrate held (all four standing targets confirmed sound).
