### Task 8 — consolidated fix wave (Codex round 1)

Repo `C:\Users\kasel\source\repos\etherfi\Solvent`, branch `main`, base commit `f0755e5`.
Task 8 landed at `bf72d8e`; Codex reviewed it and returned **needs-attention / NO-SHIP**.

Codex session: `019f96e2-9294-7b02-996b-ae49b36f5184` (job `review-mrzow24c-wamugo`).
Full verdict text: `.superpowers/sdd/task-8-codex-round1.md`.

**All 11 findings are ADJUDICATED AS ACCEPTED by the controller.** None is waived. Codex supplied a
concrete recommendation for each; those recommendations are your spec. Prior experience is
unambiguous — waves that implement Codex's own proposed remedy close in one round; waves that invent
a different remedy generate new findings.

---

## Already CLEARED — do not re-litigate, do not "improve"

Codex explicitly cleared these. Changing them re-opens settled ground:

- `RewindDerived`'s extraction into `rewindTarget` **preserves** its SQL, ordering, errors, and WARN
  behavior. The refactor is sound.
- **Epoch pruning includes every feed cursor** (review flag M4 is satisfied).
- All proxy / aggregator / start-block values in `recon/feeds.json` **match the normative recon
  table**.
- **`ratio.decimals: 18` is now VERIFIED** — Codex independently confirmed `RATIO_DECIMALS=18` from
  the deployed adapter bytecode at `0xf112aF6F0A332B815fbEf3Ff932c057E570b62d3`. The implementer's
  disclosed-unverified item is closed; leave the value alone.
- All 20 OP registry entries resolve to supported `PriceProviderV2.price(address)`, with unknown
  methods refused at construction. The closed `pollViews` map is correct.
- multicall3 duplication, `priceSet` last-wins semantics, current cursor namespaces, and the
  chain-1-only 64-block slack are all accepted as-is.

---

## Cluster A — durability and rewind correctness (schema-bearing)

**A1 [high] Poller rewinds can irreversibly erase all canonical price history**
(`internal/prices/poller.go:324-370`)

Codex's analysis supersedes the implementer's own D-3 framing: keeping the poller on the epoch gate
**is necessary** (ack-but-keep would leave prices attached to replaced blocks), but the current
implementation is still unsafe because it lowers the poll cursor to the raw-log walker's deepest
sparse-log ancestor — a block unrelated to where polls actually occurred. A full rewalk can therefore
delete every polled row, including canonical history that cannot be reconstructed from logs. The store
documentation additionally understates the exposure as "at most one interval."

**Do this (Codex's third strategy):** the multicall already returns a block hash and the decoder
currently discards it. Persist the multicall execution block/hash as a durable poll anchor. During
reorg repair, find the nearest hash-verified poll ancestor and delete **only the unverified suffix**,
retaining the epoch gate. Correct the contradictory loss documentation.

**A2 [high] Phase change leaves orphaned old-source rows after the epoch is acknowledged**
(`internal/store/prices.go:315-330`)

`RewindPrices` deletes only rows whose `source` is in the currently-loaded registry, then acks every
chain epoch in the same transaction. After the documented manual Chainlink phase update,
`FeedDeriver` owns only `chainlink:<new-agg>`; historical `chainlink:<old-agg>` rows are no longer in
`sources`. A later deep reorg crossing that boundary leaves old-source rows above the effective
target while advancing `acked_epoch` — and once the epoch is pruned there is no remaining repair
trigger.

**Do this:** persist durable engine→source ownership history, or store an owner engine on every price
row and rewind by owner rather than by the current registry's source list. Add a
phase-change-then-deep-reorg regression test.

**Schema note for A1+A2:** both need storage changes. Use a **forward migration `00005`**. Do NOT edit
`00001`–`00004` — they are pushed, and editing a pushed migration is a process violation this project
already paid for (the `00003` incident, corrected at `5b63614`). Include an upgrade-path test from the
current pushed baseline.

## Cluster B — health must not report green while broken

This family is one bug repeated in four places: freshness/health state derived from process memory or
from "a round committed" rather than from durable truth.

**B1 [high] Poller health stays green while one or every oracle is failing**
(`internal/prices/poller.go:313-321`) — when all targets revert or return undecodable data,
`readRound` returns an empty *successful* batch; `ApplyPrices` advances the cursor and `Step`
unconditionally refreshes `lastLanded`, so `Health` stays healthy forever with no price recorded.
Partial failures are invisible too, so a single asset can stay stale indefinitely.
**Do this:** track successful freshness **per target**; do not count an empty batch as a
health-landed round; fail health when any required asset misses its grace window. Test persistent
all-target and single-target failure across multiple intervals.

**B2 [high] Restart and rewind reset already-dead feeds to healthy for another full threshold**
(`internal/prices/feed.go:501-517`) — `lastSeen` is process memory only. After restart a caught-up
cursor prevents replay of older `AnswerUpdated` logs, so a feed that died *before* restart is treated
as unobserved and measured from a fresh `liveSince` — reported healthy for another 26h. Rewind clears
the same state, reproducing the blind spot when the latest canonical answer is below the target.
**Do this:** hydrate each feed's latest canonical `updatedAt` from durable raw logs (or persist
dedicated feed-freshness state) **before** issuing any live verdict. Rehydrate after every rewind.
Cover restart-with-preexisting-stale-feed.

**B3 [high] One global 26h threshold misses failures far beyond a feed's real heartbeat**
(`internal/config/config.go:120-125`) — the code acknowledges heartbeats differ yet applies one value.
This is **permissive, not conservative**, for liquidation-facing freshness: the exact ETH/USD proxy
used here is consumed with a **3600-second** heartbeat by deployed code
(`0x641169f048ee8de8b3037c9d9c840060fe03e463`), so a stopped ETH/USD stream can evade the signal for
~25h beyond its contractual bound.
**Do this:** record and validate a **per-feed heartbeat plus explicit grace** in `feeds.json`, use it
in staleness evaluation, and add fixtures pinning every configured stream's threshold.

**B4 [high] The claimed "failed health check" is only a log message**
(`cmd/indexer/main.go:455-473`) — `priceHealth`/`engineHealth` feed only periodic WARN logs. They do
not affect process status, readiness, liveness, or any queryable supervisor surface, and ordinary
price `Step` errors never reach `priceHealth` unless the worker's separate `Health` also fails. A
supervisor sees a live process through stale feeds, missing poll targets, and persistent apply
failures. The daemon price pass has no unit test.
**Do this:** expose a real daemon health/readiness surface composed from both maps, preserving the
terminal-vs-recoverable classification. Add fake-worker tests for failure, backoff, recovery, and
supervisor visibility.

**B5 [medium] The head gate can misdiagnose a frozen RPC/ingest pipeline as four stale feeds**
(`internal/prices/feed.go:474-498`) — the liveness probe shares a dependency class with ingestion and
accepts any head within 64 blocks of the stored frontier; if both freeze at the same height the gap
stays small and wall-clock aging marks every feed stale and re-resolves proxies, masking the real
failure. After one successful live verdict, repeated `BlockNumber` errors preserve `lastLive`
indefinitely — there is no verdict TTL.
**Do this:** expire cached live verdicts after a bounded TTL; validate head freshness via block
timestamp/hash through an independently routed endpoint; surface RPC/ingest lag separately from feed
publication staleness.

## Cluster C — binding contract compliance

**C1 [high] Feed ingestion violates the apply-error reset contract**
(`internal/prices/feed.go:328-352`)

**The controller independently confirmed this by reading the code.** Line 338 calls
`f.observe(agg, answer.UpdatedAt)` inside the decode loop — *before* `ApplyPrices` on line 341 — and
line 352 returns on every apply error other than the reactive epoch case **without resetting** the
freshness state it already mutated. In the rollback world memory reflects a window absent from
`prices` and the cursor; in the commit-with-lost-ack world the caller cannot know what landed. This
is exactly the partial-preservation shortcut the Task 8 brief forbade, and it keeps `Health`
optimistic while persisted ingestion is stalled. The fake store already models
commit-landed-with-error but no test exercises it.

**Do this:** stage freshness updates until commit is confirmed; after ANY `ApplyPrices`-class error,
discard all staged/in-memory apply state and rehydrate cursor + freshness from durable truth. Test
both the rollback and the committed-with-lost-ack outcomes.

## Cluster D — semantics and honest documentation

**D1 [medium] Non-positive observations are indistinguishable from usable prices**
(`internal/store/prices.go:213-230`) — zero/negative answers land in the canonical table with no
validity field or constraint; only an ephemeral WARN marks them. A P3 latest-price query can select
them, giving divide-by-zero, inverted valuation, or invalid liquidation math. Rejecting the replay
would wedge the feed, but recording an invalid fact as a normal usable price is not the only option.
**Do this:** advance the cursor while **quarantining** non-positive observations or marking them
explicitly invalid, and provide a store-level latest-**usable**-price contract that can never return
them. Add downstream invariant tests.

**D2 [medium] Comments tell P3 to reproduce the uncapped weETH value as the adapter price**
(`internal/config/feeds.go:54-63`) — `FeedRatio` says the adapter's USD price is
`getRate() × ETH/USD`. Normative recon says the adapter uses a **growth-capped** rate; the raw
composition equals adapter output only while the cap is not binding. This contradicts the accurate
caveat already in `internal/prices` and could make P3 treat an uncapped reference as engine truth
during exactly the depeg/exploit scenarios where it matters.
**Do this:** state that the two rows compose only an **uncapped reference value, never the adapter's
guaranteed output**, and that P3 must implement or independently read the growth-cap behavior before
claiming adapter equivalence. Fix the matching test comment.
*This is the overclaiming class that cost Task 7 five review rounds — sweep for it everywhere, not
just at the cited lines.*

**D3 [medium] Deep-reorg cursor regressions are not bounded to one misattributed round**
(`internal/prices/poller.go:379-412`) — the comment claims one endpoint pin, but if the walker is in
backoff it may take up to its ten-minute capped delay to record the epoch. Through that window every
cadence-due poll returns `ErrDeriveCursorRegression`, rotates away from another healthy endpoint, and
can raise the all-endpoints-behind alarm. No wrong row commits, but the diagnosis is false for
multiple rounds.
**Do this:** treat cursor regression as cause-unknown until reorg state and live block ancestry are
checked; suppress endpoint-specific rotation/all-behind conclusions while a reorg remains possible;
test the walker-backoff interleaving.

---

## Verification

**Baseline you must not regress: 348 PASS / 0 FAIL / 0 SKIP** — measured by the controller at
`bf72d8e`, not claimed by an agent. Postgres `solvent-db-1` is up.

**Important:** Codex could **not** execute `go build`/`go test`/`-race` — its sandbox denied Go
temp-directory creation, so it reviewed by inspection only. Its "not independently reproducible" note
refers to that sandbox limit. Your run is the real test evidence, so report actual numbers.

```bash
export PATH="$PATH:/c/Program Files/Go/bin:/c/Users/kasel/go/bin"
export TEST_DATABASE_URL='postgres://solvent:solvent@localhost:5432/solvent?sslmode=disable'
go build ./... && go vet ./... && gofmt -l .   # gofmt exits 0 even when it lists files — READ the output
go test ./...
```

`-race` needs the `golang:1.24` container (host lacks cgo). If you cannot run it, say so plainly.

## Scope and process

- W1 `allowed_paths` only: `internal/**`, `cmd/**`, `config/**`, `go.mod`, `go.sum`, `docs/plans/**`,
  `recon/derivation-notes.md`, `recon/feeds.json`, `.gitignore`.
- **Never touch `roadmap/**`.** Governance is the controller's.
- Forward migration `00005` only; never edit a pushed migration.
- Stage by explicit pathspec. Never `git add -A`.
- If a pre-commit gate blocks you, report it — never bypass.
- Serena's semantic tools work here (gopls installed). Prefer them for navigation and edits.

## Reporting

Write `.superpowers/sdd/task-8-fixwave-report-p2.md`. For **each of the 11 findings** state: what you
changed, which test now pins it, and whether you implemented Codex's recommendation or deviated (and
if you deviated, why — deviations are adjudicated fairly, but only when disclosed).

This wave **returns to Codex** under D-006; Task 8 is not trusted until Codex approves. Write for a
hostile reader. Fix the whole class on first occurrence, not just the cited lines.
