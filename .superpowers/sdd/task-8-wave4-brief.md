### Task 8 — fix wave 4 (Codex round-3 findings)

Repo `C:\Users\kasel\source\repos\etherfi\Solvent`, branch `main`, base `893c244`.
Wave 3 landed at `8907588`; Codex round 3 returned **NO-SHIP** with 4 high + 1 medium.

Read first, all tracked files: `.superpowers/sdd/task-8-codex-round3.md` (verdict verbatim + the
controller's adjudication), then rounds 2 and 1 for what is already settled.

**All 5 findings ACCEPTED.** Trend is 11 → 8 → 5; this wave should close it.

---

## READ THIS FIRST: test integrity is a graded deliverable this wave

Three waves have produced three test-integrity failures. This is now the primary risk, above any
individual finding:

1. **Wave 1** committed a *passing* test asserting `require.Empty(t, st.rows, "and the polled history
   is gone — this loss is real")`. A green suite certified irreversible data loss as intended.
2. **Wave 3's replacement** for it exercises only *total* probe failure — so it passes while the
   mixed failure-then-lower-match path still deletes canonical history. Finding A1 survived because
   the test's *assertion* was right and its *coverage* was not.
3. **Wave 3's legacy-adoption test** sets `st.unacked = false` directly. The real store cannot make
   that transition. The test therefore proved a path that does not exist, masking a permanent
   production deadlock.

Binding rules for this wave, and you will be reviewed against them:

- **No test may assume a state transition the real store cannot produce.** If the fake permits it and
  Postgres does not, the fake is wrong. Prefer a live-store test for any state-machine claim.
- **Every guard, refusal, or verification test must cover partial and mixed failure, not just total
  failure.** "All probes fail" is the easy case; "some fail, then one matches" is where the bug lives.
- **A test that documents a limitation must assert the safe behaviour, never the harmful one.** If the
  code loses data in a scenario, the test asserts refusal — or the scenario is a bug, not a limit.
- State the case space you enumerated in your report, and which test covers each case.

---

## The findings

### A1 [high] — a failed newer probe does not prevent deletion above a lower matching anchor (`internal/prices/poller.go:882-895`)

**A1 has now survived three attempts**, each fixing the cases its author imagined. Anchors are probed
newest-first; a failed probe sets `probeFailed`, but a subsequent lower anchor that matches returns
`floorVerified` **without considering that failure**. Repair rewinds to the lower floor, deletes every
poll-owned row and anchor above it, and acks the epoch — erasing canonical history that was never
proven non-canonical.

**Do this (Codex's recommendation):** only accept a matching floor after **every newer anchor has been
successfully probed and mismatched**. Any error above the candidate floor must refuse repair and retry.

**Stop patching; enumerate.** The invariant is: *never delete or ack without positive proof of
non-canonicality for everything above the floor.* Enumerate the state space and show a test per case:
no anchors at all; legacy unanchored rows; every probe fails; **some** probes fail; mixed
failure-then-lower-match; a canonical anchor below a page boundary; interleaving with a walker rewind.

### Deadlock [high] — pending epoch + legacy unanchored rows stalls the poller permanently (`internal/prices/poller.go:441-466`)

`Step` always routes an unacknowledged epoch to repair before legacy-anchor adoption. Repair refuses
when owned rows lack anchors. Adoption is only reachable once the epoch is no longer pending. And the
poller's acknowledgement advances **only** through rewind. So nothing can ever clear it — poll-price
ingestion stalls forever after an upgrade-time reorg. Wave 3's test hid this by fabricating
`st.unacked = false`.

**Do this:** provide a real fail-closed transition for the pending-epoch legacy state — e.g. ack only
after proving no owned rows exist above the effective epoch target — or an explicit durable
adoption/recovery workflow. **Test it against the real store**, starting from a cursor, an
unacknowledged epoch, owned rows, and no anchors. Fail-closed must not mean fail-forever: a refusal
that no path can clear is an outage, not safety.

### Snapshot [high] — snapshot ingestion can stall indefinitely while readiness stays green (`cmd/indexer/main.go:427-444`)

The snapshot worker wrapper treats every nil error as recovery and clears failure state. The
snapshotter's all-endpoints-stale path returns `(false, nil)` repeatedly without landing a batch, so
this semantic stall raises no readiness condition, and snapshot cursors are absent from the generic
no-progress pass. `/readyz` stays 200 while collateral snapshots stop advancing.

**Do this:** expose snapshot semantic-stall/progress state as a health condition included in
readiness. Regression test: every endpoint repeatedly produces stale sweep batches returning
`(false, nil)`.

### Frontier [high] — readiness does not require derivation workers to catch up to their input frontier (`cmd/indexer/main.go:454-510`)

The progress check looks only at how *recently* a cursor moved, not how far it remains behind its
durable input frontier. A worker advancing small backfill windows keeps refreshing `updated_at` and
never trips `no_progress`, however stale it is. Price workers are excluded outright.

**This one carries a correction you should absorb:** wave 3's report claimed not-ready-until-chain-head
behaviour, the controller relayed that to the owner as fact, and **it is false as implemented.** Do not
restate the claim; implement it, then describe exactly what it does.

**Do this:** compare each derivation and feed cursor against its minimum durable ingest frontier and
keep readiness red until caught up within an **explicitly justified** bound. Add restart tests with raw
logs at head and derivation cursors far behind.

### Timestamp [medium] — future-timestamp refusal changes across restart without a new durable fact (`internal/prices/feed.go:683-698`)

Classification depends on the current wall clock, so the same persisted log is rejected while its
`updatedAt` is >2 minutes ahead and **accepted** after a later restart once the clock approaches it.
Acceptance then moves `lastUsable` to that future time, greening readiness for the tolerance *plus* a
full heartbeat-and-grace window with no new publication. Wave 3's claim that the same log always
yields the same refusal identically across restarts is false.

**Do this:** bind timestamp validity to durable observation context — a persisted receipt/block time,
or durable rejection state — so a previously implausible log cannot become usable without a new durable
fact. Add a restart/rehydration test crossing the two-minute boundary.

---

## Documentation honesty — third round with findings here

Round 3 found two more false claims (not-ready-until-chain-head; identical-refusal-across-restarts).
Every comment or doc line asserting a bound, a guarantee, or a detection capability must either be
enforced by code or deleted. Prefer understating. If you find yourself writing "always", "never", or
"guaranteed", verify it or cut it.

## Verification

Baseline, controller-measured at `8907588`: **451 top-level PASS / 0 FAIL / 0 SKIP** (510 counting 59
subtests). **Report top-level counts and say so** — this delta has caused confusion twice.

```bash
export PATH="$PATH:/c/Program Files/Go/bin:/c/Users/kasel/go/bin"
export TEST_DATABASE_URL='postgres://solvent:solvent@localhost:5432/solvent?sslmode=disable'
go build ./... && go vet ./... && gofmt -l .   # exits 0 even when it lists files — READ it
go test ./... -count=1
```

`-race` needs the `golang:1.24` container (host lacks cgo); wave 3 reached live Postgres from it via
`host.docker.internal`.

## Scope and process

- W1 `allowed_paths`: `internal/**`, `cmd/**`, `config/**`, `.superpowers/sdd/**`, `recon/derivation-notes.md`,
  `recon/feeds.json`, `go.mod`, `go.sum`, `.gitignore`, `docs/plans/**`.
- **`.env.example` is out of scope.** `SOLVENT_HEALTH_ADDR` stays documented in `internal/config/config.go`.
- **Never touch `roadmap/**`.**
- Forward migration `00006` if schema changes are needed; never edit `00001`–`00005`.
- Stage by explicit pathspec, never `git add -A`. If a gate blocks you, report it — never bypass.

## Reporting

`.superpowers/sdd/task-8-wave4-report-p2.md`. Per finding: what changed, which test pins it, deviation
or not. Plus a dedicated section on **test adequacy**: the case space you enumerated for A1 and the
deadlock, the test covering each case, and confirmation that no test relies on a store transition
Postgres cannot perform.

Returns to Codex for round 4 under D-006.
