# Codex adversarial review — Task 8 fix wave (round 2)

- **Target:** `ce053bd` (fix wave for round-1 findings), diffed against `bf72d8e`
- **Verdict:** `needs-attention` — **NO-SHIP**
- **Codex session:** `019f974b-5122-76e3-9fdf-299db764187e` (job `review-mrzsz6d2-4ybbhj`, ~8m32s)
- **Resume:** `codex resume 019f974b-5122-76e3-9fdf-299db764187e`
- **Identity confirmed** at `ce053bd` against `bf72d8e` before finalizing (anti-decoy check after round 1's near-miss).

> NO-SHIP. A2, migration 00005, B3 provenance, decoder export, and adapter-equivalence documentation appear genuinely fixed, but A1 still permits irreversible canonical-history deletion and Cluster B/D3/health retain false-green or permanent-stall paths.

## RESOLVED from round 1

- **A2** — `RewindPrices` owner-scoping; retired Chainlink phase rows can no longer be orphaned.
- **Migration `00005`** — forward-only, upgrade path sound, `00001`–`00004` untouched.
- **B3 provenance** — the uneven-evidence labelling is honest.
- **Decoder export** — `ChainlinkAnswerUpdatedTopic0` is genuinely additive; no behavioral effect.
- **Adapter-equivalence documentation** — the weETH overclaim is corrected.

## STILL OPEN / NEW (8 findings, verbatim)

### [high] Anchor verification failure still destroys unrecoverable canonical history — `internal/prices/poller.go:576-582`
`verifiedFloor` collapses anchor-read errors, `HeaderHashFrom` failures, and exhaustion of the eight-anchor probe limit into `floor=0`. `rewind` then proceeds with `RewindPrices`, acknowledges the epoch, and deletes every poll-owned row above the sparse walker target. The committed fallback test explicitly confirms that a transient hash-probe outage leaves the polled history empty. The same loss remains possible before the first post-upgrade anchor or when a canonical anchor exists below the eight-row limit, so A1 is not closed.
**Recommendation:** Do not acknowledge the epoch or delete rows when anchor verification is unavailable. Retry verification, paginate retained anchors over bounded Steps, and establish a safe one-time anchor/backfill policy for legacy unanchored history.

### [high] A same-height frozen RPC keeps poll freshness and readiness green indefinitely — `internal/prices/poller.go:378-386`
After any nil `ApplyPolledPrices` result, the poller stamps every returned target and `lastRound` with process time. The store accepts an equal-height, equal-hash replay as an idempotent success without inserting a new row or changing `observed_at`. An endpoint frozen exactly at the cursor therefore returns the same block forever: no cursor regression fires, no new durable observation lands, yet these assignments refresh health every interval. This directly violates the durable-freshness contract and hides a stalled oracle/RPC path.
**Recommendation:** Have the store return which rows were actually inserted and their database timestamps, refresh health only from those durable results, and fail readiness when the execution block/head fails to advance within a bounded TTL.

### [high] Quarantined non-positive answers still count as healthy freshness — `internal/store/prices.go:490-500`
`LatestPriceFreshness` deliberately includes invalid rows. Consequently a poll oracle returning zero or negative values every interval remains fresh, while the feed path likewise treats every `AnswerUpdated` publication as fresh regardless of whether `Current` is usable. `LatestUsablePrice` may have no current usable value, but `/readyz` can remain green. Quarantining protects consumers from selecting the bad row but does not provide honest health.
**Recommendation:** Expose latest validity with durable freshness and add an explicit invalid-answer condition. Invalid observations may advance cursors, but must not refresh usable-price health or readiness.

### [high] Readiness ignores failures in core ingestion and non-price workers — `cmd/indexer/main.go:393-485`
Walker failures only log and enter local backoff; derivation `Step` errors and snapshot failures likewise do not populate `healthState`. Only price workers contribute recoverable step-error conditions, while heartbeat still advances after these failures. Thus `/readyz` can report 200 indefinitely while Debt Manager or Aave raw ingestion, position derivation, or snapshot ingestion is stalled.
**Recommendation:** Route walker, derivation, and snapshot errors/backoff into recoverable readiness conditions and add durable progress/head-lag checks so silent no-progress stalls also fail readiness.

### [medium] Future `updatedAt` hydration reintroduces the restart freshness reset — `internal/prices/feed.go:540-553`
A future or out-of-range `updatedAt` is clamped to `f.now()`. That derived receipt time is not durable: restart, rewind, or apply-error hydration decodes the same raw log and clamps it again to the new process time. Repeated restarts inside the threshold can therefore keep a feed with one malformed future timestamp healthy indefinitely, contradicting the claim that freshness cannot reset from process memory.
**Recommendation:** Treat implausible future timestamps as an unhealthy durable condition, or persist a deterministic receipt/block timestamp once and reuse that value during every hydration.

### [medium] The no-anchor regression branch can stall forever despite healthy alternate endpoints — `internal/prices/poller.go:716-723`
When no anchor exists, `classifyRegression` returns cause-unknown and performs no exploratory routing. If the shared endpoint is genuinely frozen below the cursor, every `eth_call` succeeds at that old height, every apply regresses, and no round can ever land the anchor that the comments say will make classification decidable. Error-driven failover never tries the healthy endpoints because the RPC calls themselves succeed, so the alleged one-round cost is an indefinite stall.
**Recommendation:** Separate diagnosis from recovery: retain cause-unknown attribution while performing bounded exploratory calls across alternate endpoints or comparing independently obtained heads/hashes until progress or reorg evidence appears.

### [medium] Frontier-below-cursor misattribution is not bounded to one pin — `internal/prices/poller.go:696-704`
The documentation claims a reorg in the gap between a lower frontier anchor and the cursor costs one misattributed pin released by next-round progress. Progress is not guaranteed: if the canonical head remains below the cursor, every healthy endpoint regresses, the same lower anchor still verifies, and each round calls `onStaleEndpoint` again until the walker records an epoch or the head catches up. This can cycle all endpoints and emit the false all-endpoints-behind diagnosis throughout the walker backoff window.
**Recommendation:** Do not attribute a regression to an endpoint unless the verified anchor reaches the cursor. Treat frontier-below-cursor as cause-unknown and correct the documentation unless an independent cursor-height ancestry check is added.

### [medium] Readiness starts green before any dependency or worker is verified — `cmd/indexer/main.go:205-219`
The health server is intentionally exposed before registry loading, database connection, migrations, chain verification, worker construction, or the first daemon round. `healthState`'s initial report has `Ready=true`, so `/readyz` returns 200 during initialization or a hung dependency connection even though ingestion has never started.
**Recommendation:** Initialize health with a startup/not-initialized readiness condition and clear it only after dependency checks, worker construction, hydration, and one complete daemon round succeed.

## Codex's next steps (verbatim)

- Make anchor verification failures non-destructive and add upgrade/no-anchor/deep-reorg tests.
- Add same-height frozen-endpoint and repeated cause-unknown regression tests across multiple endpoints.
- Make invalid and malformed-timestamp states durably fail readiness.
- Start readiness closed and compose health across every ingestion worker.

## Controller adjudication

**All 8 findings ACCEPTED**, none waived. Fix spec: `.superpowers/sdd/task-8-wave3-brief.md`.

**Root principle the round-2 findings share** — and the reason the round-1 "fix the class"
instruction only partly landed: *health may be refreshed only by a durable, newly-observed fact.*
Round 1 fixed "don't read freshness from process memory." Round 2 shows four remaining variants of
the same disease: a nil error refreshes health (frozen same-height replay), an invalid row counts as
fresh, a clamped process timestamp becomes the receipt time, and readiness is green before anything
is verified. Codex's own remedy makes it concrete: **the store must return which rows were actually
inserted and their database timestamps, and only those may refresh health.** Wave 3 should be built
around that single invariant rather than eight separate patches.

Second theme: **destructive operations must fail closed.** `verifiedFloor` degrading to `0` on a
transient probe outage is the mirror of readiness degrading to `Ready=true` at startup — both choose
the permissive default on missing information. Two findings, one principle.

## Review-visibility defect found by this round

Codex **could not read** `.superpowers/sdd/task-8-codex-round1.md` or the fix-wave report: they were
gitignored and the job ran in a worktree pinned at `ce053bd`, so they were absent from the checkout.
Codex disclosed this instead of fabricating access, and fell back to the summarized context in the
dispatch prompt plus tracked `recon/derivation-notes.md`. **A fix wave was therefore verified without
the reviewer being able to read the findings it was verifying.** Fixed at `211966c` by rescoping W1 to
track `.superpowers/sdd/**` (markdown only; the 1.9MB of review diffs stay ignored). Round 3 onward
will see the full trail.

## Dispatch hygiene (worked this round)

The dispatch call was backgrounded, and a single poll path was used. Status went
`running` → `verifying` → `completed` with no wedge, unlike round 1's four SIGTERM'd attempts.
