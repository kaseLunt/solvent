### Task 8 — fix wave 5 (Codex round-4 findings)

Repo `C:\Users\kasel\source\repos\etherfi\Solvent`, branch `main`, base `4004589`.
Wave 4 landed at `e262f0a`; Codex round 4 returned **NO-SHIP** with 3 high + 1 medium.

Read first: `.superpowers/sdd/task-8-codex-round4.md` (verdict verbatim + adjudication). Rounds 1–3
are archived alongside it. All tracked.

**All 4 findings ACCEPTED.** Trend 11 → 8 → 5 → 4.

---

## Two things to understand before coding

### 1. A1's missing dimension is TIME, not case coverage

Wave 4's enumerated `floorOutcome` partition was the right move and **is not the problem**. The problem
is that a *proof* is cached across `Step`s while the thing it proves can change underneath it.
`probeResumeFrom` carries only a block height. A mismatch established under one chain state is still
trusted after a later reorg makes those same skipped anchors canonical again — and then the repair
deletes them without re-probing.

**The rule to internalise:** any cached verification must be invalidated by the epoch or checkpoint it
was computed against, and revalidated immediately before the destructive act. Enumerating *states* is
insufficient when the truth being proven is time-varying; you must enumerate *transitions*.

### 2. Wave 4 introduced a regression — the first of the series

Findings in waves 1–4 were all "the fix didn't go far enough." **Finding 2 this round is "the fix broke
something that worked":** wave 4's frontier gate deletes wave 3's feed-health conditions. Treat the
daemon health surface as a subsystem whose *publication order carries correctness*, not as a few call
sites. Before you add any condition publisher, work out what else publishes under the same worker
prefix and in what order.

---

## The findings

### A1 [high] — paged mismatch proof survives a later reorg that invalidates it (`internal/prices/poller.go:946-950`)

`probeResumeFrom` is reused across `Step`s using only a block height; it is not bound to the reorg
epoch or a live-chain checkpoint. After one page's anchors mismatch, a second reorg can make those
skipped higher anchors canonical again. The next `Step` can accept a lower match, or conclude
`floorProvenOrphaned`, and delete the now-canonical higher rows without re-probing them. Irreversible
loss of non-replayable poll history.

**Do this (Codex's recommendation):** bind paging state to a reorg generation **and** a live-chain
checkpoint. Restart from the newest anchor whenever either changes. Revalidate a checkpoint covering
all prior pages **immediately before deletion**.

**Required regression:** first page mismatches → a later epoch restores a higher anchor → the repair
must **not** delete it.

**On the test that missed this:** wave 4's interleaving test mutates only the effective target and
leaves the previously observed hashes unchanged, so it exercises the scenario's *shape* without its
*substance*. That is the third time a test has passed while missing the case it was written for. When
you write the regression, the chain's answers must actually change between `Step`s — if your fake
returns the same hashes throughout, you have not tested a reorg.

### Health-composition [high] — the frontier pass erases the feed deriver's conditions (`cmd/indexer/main.go:961-971`)

`stepPriceWorkers` publishes the feed deriver's staleness, timestamp, RPC-lag, and `step_error`
conditions. `applyProgressConditions` then registers that same feed worker as a consumer, and
`rc.publish` runs afterward. `setWorkerConditions` **replaces every condition under a worker prefix**,
so the later frontier publication deletes the feed conditions — entirely when frontier lag is absent,
or leaving only `frontier_lag` when present. `/readyz` can go green, and startup can even clear, after
a feed `Step` failure.

**Do this:** compose feed-worker and frontier conditions into the same `roundConditions` entry before a
single replacement, **or** provide condition-level merging instead of worker-wide replacement. Prefer
whichever makes the destructive-replace mistake impossible to repeat rather than merely fixed here.

**Required test:** an integrated round proving a feed `step_error` **and** a publication-staleness
condition both survive the no-lag pass *and* the frontier-lag pass.

### Snapshot [high] — closed degraded sweep generations are treated as healthy (`cmd/indexer/main.go:683-690`)

The progress gate returns immediately for every closed generation. But `CompleteSweepGeneration`
deliberately closes a generation *after* accounts exhaust their retry budget, reporting the failure
only through a WARN — and per-account failures return nil from `ApplySweepBatch`, so snapshot failure
bookkeeping stays clear. Readiness stays green through retries and after degraded completion, while
collateral snapshots are missing or stale until the next cadence, which may exceed `noProgressBound`.

"Closed" does not mean "succeeded." **Do this:** expose current-generation failed/exhausted counts and
last-success age through `SweepProgress`, and keep readiness red for unresolved snapshot failures even
after the generation closes. **Required test:** a closed generation containing `status='failed'` rows
after max attempts.

### Lag-composition [medium] — two 5,000-block allowances compose into ~10,000 blocks (`cmd/indexer/main.go:139-156`)

Each bound is locally defensible; together they are not. Both comparisons permit equality, so a walker
may be 5,000 blocks behind its observed head while a consumer is another 5,000 behind that walker, with
`/readyz` green. On the repository's own 12-second Ethereum calibration that is roughly **33 hours**
behind head. Copying `headLagBound` is not a justification for a liquidation-facing consumer bound.

**Do this:** gate consumers on **end-to-end** distance (or elapsed block time) from chain head, with
chain-specific limits derived from an explicit freshness requirement — state that requirement in the
code. **Required test:** a boundary case combining maximum permitted walker lag with maximum permitted
consumer lag.

---

## Test integrity (still graded)

Round 3 made this a deliverable and round 4 found another instance. The recurring failure is a test
that sets up a scenario's *shape* without its *substance*. For every regression you add, ask: what
would have to be genuinely different between two `Step`s for this bug to occur — and does my fake
actually make it different? A test whose fake returns constant answers cannot test a reorg.

Also still binding: no test may assume a state transition the real store cannot produce, and no test
may assert harmful behaviour as expected.

## Documentation honesty

Four rounds, four sets of overclaims found. State the freshness requirement you derive the new bounds
from, and do not describe a bound as justified because it matches an existing constant.

## Verification

Baseline, controller-measured at `e262f0a`: **472 top-level PASS / 536 incl. 64 subtests / 0 FAIL /
0 SKIP**. Report top-level counts and say so.

```bash
export PATH="$PATH:/c/Program Files/Go/bin:/c/Users/kasel/go/bin"
export TEST_DATABASE_URL='postgres://solvent:solvent@localhost:5432/solvent?sslmode=disable'
go build ./... && go vet ./... && gofmt -l .   # exits 0 even when it lists files — READ it
go test ./... -count=1
```

`-race` needs the `golang:1.24` container (host lacks cgo); reach live Postgres via
`host.docker.internal`.

## Scope and process

- W1 `allowed_paths`: `internal/**`, `cmd/**`, `config/**`, `.superpowers/sdd/**`,
  `recon/derivation-notes.md`, `recon/feeds.json`, `go.mod`, `go.sum`, `.gitignore`, `docs/plans/**`.
- `.env.example` is **out of scope**.
- **Never touch `roadmap/**`.**
- Forward migration `00006` if needed; never edit `00001`–`00005`.
- `internal/store/derive.go` has now been modified three times and is Codex-approved ground — touch it
  only if a finding requires it, and say so.
- Stage by explicit pathspec, never `git add -A`. If a gate blocks you, report it — never bypass.

## Reporting

`.superpowers/sdd/task-8-wave5-report-p2.md`. Per finding: what changed, which test pins it, deviation
or not. Plus: for the A1 regression, state explicitly what differs between `Step`s in your fake and
why that constitutes a real reorg; and for the health composition fix, state what now prevents a future
publisher from silently replacing another's conditions.

Returns to Codex for round 5 under D-006.
