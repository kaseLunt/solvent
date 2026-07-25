### Task 8 — fix wave 3 (Codex round-2 findings)

Repo `C:\Users\kasel\source\repos\etherfi\Solvent`, branch `main`, base commit `23927f1`.
Wave 1 landed at `ce053bd`; Codex round 2 returned **NO-SHIP** with 4 high + 4 medium.

Read first: `.superpowers/sdd/task-8-codex-round2.md` (the verdict, verbatim) and
`.superpowers/sdd/task-8-codex-round1.md` (round 1, for context on what was already accepted).
**These are now tracked repository files** — round 2 could not see them, which is part of why it found
what it found.

**All 8 findings are ACCEPTED. None waived.** Implement Codex's own recommendation for each.

---

## Do not touch — resolved in wave 1 and confirmed by round 2

A2 owner-scoped rewinds, migration `00005`, the B3 heartbeat provenance labelling, the
`ChainlinkAnswerUpdatedTopic0` decoder export, and the weETH adapter-equivalence documentation are all
**confirmed fixed**. Changing them re-opens settled ground.

---

## Read this before writing any code: the two principles

Wave 1 was told to "fix the class" and only half did, because the class was stated too narrowly.
Round 2's eight findings are two principles, not eight patches. Build the wave around these.

### Principle 1 — health may be refreshed ONLY by a durable, newly-observed fact

Wave 1 fixed *"don't read freshness from process memory."* Round 2 found four surviving variants of
the same disease:

- a **nil error** refreshes health (`poller.go:378-386`) — the store treats an equal-height,
  equal-hash replay as idempotent success without inserting a row or touching `observed_at`, so an
  endpoint frozen exactly at the cursor refreshes health every interval, forever;
- an **invalid row** counts as fresh (`prices.go:490-500`) — `LatestPriceFreshness` deliberately
  includes quarantined non-positive rows, so an oracle returning zero every interval stays "fresh"
  and `/readyz` stays green;
- a **clamped process timestamp** becomes the receipt time (`feed.go:540-553`) — a future
  `updatedAt` is clamped to `f.now()`, and that derived value re-clamps on every hydration, so
  repeated restarts keep a dead feed healthy;
- **readiness is green before anything is verified** (`main.go:205-219`).

**Codex's concrete remedy, and the spine of this wave:** *the store must return which rows were
actually inserted and their database timestamps, and only those may refresh health.* Change the
`ApplyPolledPrices` / `ApplyPrices` contract to report durable insert results, and make every health
refresh derive from that return value. If a call inserts nothing, nothing gets fresher — by
construction, not by a check someone can forget.

### Principle 2 — destructive and permissive defaults must fail CLOSED

`verifiedFloor` degrading to `0` on a transient probe outage and readiness defaulting to
`Ready=true` at startup are the same bug: **choosing the permissive default when information is
missing.** Missing information must produce refusal, not permission.

---

## The findings

### A1 [high] — anchor verification failure still destroys unrecoverable canonical history (`internal/prices/poller.go:576-582`)

**A1 is not closed.** `verifiedFloor` collapses anchor-read errors, `HeaderHashFrom` failures, and
exhaustion of the eight-anchor probe limit into `floor=0`. `rewind` then calls `RewindPrices`, acks the
epoch, and deletes every poll-owned row above the sparse walker target.

**The committed fallback test explicitly asserts that a transient hash-probe outage leaves polled
history empty.** Wave 1 shipped a test documenting irreversible data loss as expected behavior. That
test encodes the bug; fix the behavior and rewrite the test to assert refusal.

Loss also remains possible before the first post-upgrade anchor, and when a canonical anchor exists
below the eight-row probe limit.

**Do this (Codex's recommendation):** do not acknowledge the epoch or delete rows when anchor
verification is unavailable. Retry verification; paginate retained anchors across bounded `Step`s
rather than giving up at eight; and establish an explicit, safe one-time anchor/backfill policy for
legacy unanchored history. Add upgrade, no-anchor, and deep-reorg tests.

### B-frozen [high] — same-height frozen RPC keeps freshness and readiness green (`internal/prices/poller.go:378-386`)
See Principle 1. **Do this:** have the store return actually-inserted rows with their DB timestamps;
refresh health only from those; and fail readiness when the execution block/head does not advance
within a bounded TTL. Test a frozen endpoint pinned exactly at the cursor across multiple intervals.

### B-invalid [high] — quarantined non-positive answers count as healthy freshness (`internal/store/prices.go:490-500`)
**Do this:** expose latest *validity* alongside durable freshness and add an explicit invalid-answer
condition. Invalid observations may advance cursors — they must never refresh usable-price health or
readiness. The feed path has the same hole: it treats every `AnswerUpdated` as fresh regardless of
whether `Current` is usable. Add downstream invariant tests.

### B-workers [high] — readiness ignores core ingestion and non-price workers (`cmd/indexer/main.go:393-485`)
Walker failures only log and back off locally; derivation `Step` errors and snapshot failures never
populate `healthState`. Only price workers contribute, and the heartbeat still advances after these
failures — so `/readyz` can return 200 indefinitely while Debt Manager or Aave ingestion, position
derivation, or snapshot ingestion is stalled.
**Do this:** route walker, derivation, and snapshot errors/backoff into recoverable readiness
conditions, preserving the terminal-vs-recoverable classification, and add durable progress/head-lag
checks so a silent no-progress stall also fails readiness.

### B-clamp [medium] — future `updatedAt` hydration reintroduces the restart reset (`internal/prices/feed.go:540-553`)
**Do this:** treat an implausible future timestamp as an unhealthy **durable** condition, or persist a
deterministic receipt/block timestamp once and reuse it on every hydration. Never re-derive it from
process time.

### D3-stall [medium] — the no-anchor cause-unknown branch can stall forever (`internal/prices/poller.go:716-723`)
**Codex is correcting its own round-1 guidance here.** Wave 1 followed "treat regression as
cause-unknown" literally and removed exploratory routing entirely. Result: against an endpoint frozen
below the cursor, every `eth_call` succeeds at the old height, every apply regresses, no round can
ever land the anchor that would make classification decidable, and error-driven failover never fires
because the RPC calls themselves succeed. The "one round" cost is an indefinite stall.
**Do this:** *separate diagnosis from recovery.* Keep cause-unknown **attribution** while still
performing bounded exploratory calls across alternate endpoints, or compare independently obtained
heads/hashes, until either progress or reorg evidence appears. Test the multi-endpoint repeated
cause-unknown case.

### D3-bound [medium] — frontier-below-cursor misattribution is not bounded to one pin (`internal/prices/poller.go:696-704`)
The docs claim one misattributed pin released by next-round progress; progress is not guaranteed. If
the canonical head stays below the cursor, every healthy endpoint regresses, the same lower anchor
keeps verifying, and each round calls `onStaleEndpoint` again — cycling all endpoints and emitting the
false all-endpoints-behind diagnosis throughout the walker backoff window.
**Do this:** do not attribute a regression to an endpoint unless the verified anchor **reaches the
cursor**. Treat frontier-below-cursor as cause-unknown, and correct the documentation unless you add
an independent cursor-height ancestry check.

### Ready-start [medium] — readiness starts green before any dependency is verified (`cmd/indexer/main.go:205-219`)
**Do this:** initialize health with an explicit startup/not-initialized readiness condition and clear
it only after dependency checks, worker construction, hydration, and one complete daemon round have
all succeeded.

---

## Documentation honesty

Round 1 cost the previous task five rounds on documentation that promised detection or reconciliation
the code did not implement. Wave 1 improved this but round 2 still found two overclaims (the
"one misattributed pin" bound, and the anchor-verification comments). **Sweep every comment and doc
line you touch:** if it claims a guarantee, a bound, or a detection capability, either the code must
enforce it or the sentence must go. State limits plainly.

## Verification

Baseline to beat, controller-measured at `ce053bd`: **423 PASS / 0 FAIL / 0 SKIP**. Postgres
`solvent-db-1` is up.

```bash
export PATH="$PATH:/c/Program Files/Go/bin:/c/Users/kasel/go/bin"
export TEST_DATABASE_URL='postgres://solvent:solvent@localhost:5432/solvent?sslmode=disable'
go build ./... && go vet ./... && gofmt -l .   # gofmt exits 0 even when it lists files — READ it
go test ./... -count=1
```

`-race` needs the `golang:1.24` container (host lacks cgo); wave 1 reached live Postgres from the
container via `host.docker.internal`. If you cannot run it, say so plainly.

## Scope and process

- W1 `allowed_paths` now includes `.superpowers/sdd/**` (rescoped at `211966c`, generation 6), plus
  `internal/**`, `cmd/**`, `config/**`, `go.mod`, `go.sum`, `docs/plans/**`,
  `recon/derivation-notes.md`, `recon/feeds.json`, `.gitignore`.
- `.env.example` is still **out of scope** — do not edit it. `SOLVENT_HEALTH_ADDR` remains documented
  in `internal/config/config.go` only; note it in your report rather than widening scope.
- **Never touch `roadmap/**`.**
- Forward migration `00006` if you need schema changes; never edit a pushed migration.
- Stage by explicit pathspec, never `git add -A`. If a gate blocks you, report it — never bypass.
- Leave the commit to the controller if you prefer, or commit with a pathspec; say which you did.

## Reporting

Write `.superpowers/sdd/task-8-wave3-report-p2.md`. For **each of the 8 findings**: what changed,
which test pins it, and whether you followed Codex's recommendation or deviated (with reasoning).
Address the two principles explicitly — show where the durable-fact invariant is now enforced
structurally rather than by convention.

This returns to Codex for round 3 under D-006. Never claim a guarantee you did not implement.
