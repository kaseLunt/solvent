# Task 8 — fix wave 6 report: price-pipeline unit (A1, under D-010)

- **Base:** `300b2ea` — **Commit:** `ed2f26e`
- **Scope touched:** `internal/prices/**`, `internal/store/prices*.go`, `.superpowers/sdd/**` only.
- **Verdict on the shape of the change:** the A1 machinery **shrank**; the only net addition is
  clause 4, which is a new obligation D-010 creates rather than guard logic. Numbers in §5.

---

## 1. The harness, rebuilt first (D-010 clause 3)

Codex round 5: *"The fake returns hashes by height only, so the new tests cannot model this
disagreement."* That was the binding constraint, so it was fixed before a line of the fix was written.

### What changed

`internal/prices/prices_test.go`. The old surface was four maps keyed by **height alone** —
`hashes`, `hashErr`, `hashErrAt`, `hashFailAfter` — plus a `HeaderHashFrom` that returned
`hashes[block]` and stamped the token with the **requested** start index.

It is now `views map[int]*endpointView`, one private chain per endpoint:

```go
type endpointView struct {
    hashes    map[uint64]common.Hash // THIS endpoint's chain
    down      error                  // this node is unreachable
    errAt     map[uint64]error       // this node cannot answer THIS height
    failAfter map[uint64]int         // this node answers n times, then fails
    reads     map[uint64]int
}
```

and `HeaderHashFrom` **walks endpoints from the requested start exactly as `chain.Failover.doFrom`
does**, returns the first answer, and stamps the token with the endpoint that actually replied. A new
`hashServed []int` records, per probe, which endpoint answered.

### What it can now express that it could not before

| Scenario | Old fake | New fake |
|---|---|---|
| Two endpoints **disagree** about the same height | impossible — one map, one answer | `setHashOn(0, h, x)` / `setHashOn(1, h, y)` |
| **Silent failover**: endpoint 0 errors, endpoint 1 answers in its place | impossible — no walk; the token always named the *requested* index, so a substitution was indistinguishable from a direct answer | modelled; `hashServed` shows endpoint 1 answered a probe requested from 0 |
| One endpoint healthy **except** at one height | impossible — `hashErrAt` failed that height on every endpoint | `failProbeOn(e, h, err)` |
| "Which chain view did this proof come from?" | unanswerable | `probeEndpoints(ch)` |

Helpers that write to *every* endpoint (`setHash`, `canonicalAt`, `failAll`, `failProbe`,
`failAfter`) keep the ~20 tests that are not about divergence readable. **Checkpoint:** the rebuilt
harness was run against the *unchanged* poller and all existing tests still passed — the harness
change is behaviour-preserving on its own, which is what makes the subsequent failures meaningful.

### Codex's scenario, reproduced as a regression

`TestPollerRepairRunsOneCoherentEndpointAcrossDivergentAncestries` — anchors at 4800/4900/5000:

- endpoint 0: 5000 replaced, **4900 and 4800 canonical** (the checkpoint chain);
- endpoint 1: 5000 replaced, **4900 replaced on another fork**, 4800 canonical.

Run against the wave-5 code it produced `RewindPrices(engine, 10, toBlock 5000, verifiedFloor 4800)`
— the mixed pass took "4900 orphaned" from endpoint 1, and the unchanged endpoint-0 checkpoint
authorised destroying a round that is canonical on that very chain. **Finding A1, reproduced
verbatim.**

---

## 2. D-010 clause by clause

### Clause 1 — the poller never deletes polled price rows. **Removed, not guarded.**

**Structural, not a rule.** `RewindPrices` moved off `PriceStore` onto `FeedStore`. `PollStore`
embeds `PriceStore`, so **the poller's store interface no longer declares any deletion primitive** —
a future edit to `poller.go` cannot call one. `FeedStore` keeps it because that deriver's rows are
decoded from `raw_logs` and replay; D-010's non-goal is respected and `RewindDerived` /
`internal/store/derive.go` / the walker / snapshot were **not touched**.

**Code removed** from `internal/prices/poller.go`:

- `func (p *Poller) rewindTo(...)` — **deleted entirely** (0 occurrences remain);
- the `floorVerified` and `floorProvenOrphaned` **rewind arms** in `repair`, replaced by the same
  `neutralize` call the other arms use;
- the bootstrap `rewindTo(0,0,0,…)` arm;
- field `probeCheckpointBy` (0 occurrences remain) — redundant once a pass has one endpoint;
- **GATE 1** (~10 lines): the "a lower anchor matched but a newer probe failed" refusal, and the
  `probeFailed` bookkeeping and `if !probeFailed && …` resume condition that supported it. A pass now
  *ends* at its first failed probe, so the situation the gate existed for cannot arise inside one
  pass. This is strictly stronger: the lower anchor is never probed at all.

`repair` now has one action for every arm that acts. The outcomes differ only in the **floor** they
carry (how much provably-canonical history keeps its validity) and the justification they record.

### Clause 2 — endpoint coherence, done properly

Option (a) of the clause: *one coherent endpoint without silent failover*.

- `pinProbeEndpoint()` (7 code lines) fixes **one** endpoint for the whole pass — every page, across
  every Step, **and the checkpoint re-read**. The initial choice still respects the exploration /
  attribution routing hints.
- `probeAnchor()` (11 code lines) rejects any answer whose `EndpointToken.Index` is not the pinned
  endpoint. `HeaderHashFrom` is a failover call; reading the hash and ignoring the token is how a
  pass mixes ancestries *without anyone deciding to* — no rotation needed, just a timeout.
- `abandonPass()` (8 code lines) ends the pass on any probe the pinned endpoint did not answer,
  discards the accumulated proofs, and moves the pin one endpoint along. Both halves are load-bearing:
  discarding keeps proofs single-view, rotating stops a dead pin from stalling forever.
- `resetVerification` **deliberately keeps the pin** (generation/checkpoint changes are statements
  about the *chain*, not the endpoint). This was a real defect I introduced and the new
  silent-failover test caught: `probeGeneration` is written only by `noteCheckpoint`, so a pass whose
  **first** probe fails never records one, the generation check fires again next Step, and clearing
  the pin put it straight back on the endpoint that had just failed — forever. The reason is written
  into the code comment.

**Endpoint disagreement retains data and never authorises marking**: the disagreeing endpoint is
never consulted within a pass, and a substituted answer is treated as a probe failure → refuse and
retry.

**What this does NOT establish** — stated in the code, not only here: it bounds a pass to one chain
view. It does **not** show that view is the canonical chain. A pinned endpoint alone on a minority
fork yields a self-consistent pass with too low a floor. The consequence is *marked* rows, which the
`insertPrice` supersede arm undoes when a canonical answer lands at that height — which is exactly
the asymmetry D-010 turns on, and the reason stopping here is defensible.

Preserved as instructed and still under test: the `floorOutcome` partition, the reorg-generation
stamping, and the live-chain checkpoint re-read immediately before the (now non-destructive) act.

### Clause 3 — harness first

§1. Done before the fix, and the fix's first version was **falsified by it** (see the
`resetVerification` defect above).

### Clause 4 — neutralized rows are an operational surface

- `store.NeutralizedPriceStats(ctx, engine, chainID)` → `{Rows, Oldest, Newest, HighestBlock}`,
  scoped to the engine and to the `InvalidReasonUnverifiableReorg` marker. **No migration needed** —
  `prices` already carries `observed_at`, `block_number`, `invalid_reason`, `owner_engine`; `00006`
  was not created.
- `Poller.refreshNeutralizedBacklog` re-reads it at hydration and after every neutralization, and
  WARNs with count + age of the oldest + highest block when the count changes. `Poller.NeutralizedBacklog()`
  is the introspection half.
- **Deliberately NOT a health condition**, and a test pins that. Nothing retires these rows
  (reconciliation is explicitly out of scope), so a condition keyed on their existence would latch
  `/readyz` red **forever** — an outage, not a signal. The acute case is already covered by
  `ConditionPollInvalidAnswer`, which clears when a valid observation lands. **This is a narrower
  reading of "exposed" than a metrics endpoint would be, and I am flagging it as a judgement call.**
- The read is **non-fatal**: it decides nothing, so a failing count leaves the poller hydrated and
  the backlog *unknown* rather than reported as zero.

**One in-scope store change beyond the surface**: `NeutralizeUnverifiablePrices`' UPDATE predicate
changed from `invalid_reason <> $4` to `valid`. A row quarantined for a *different* reason (a
non-positive oracle answer) is already unreadable; re-marking it changed nothing observable, **over-wrote
the true reason**, and inflated the clause-4 count with rows that were never reorg fallout.

---

## 3. Mutation verification — 8 mutations, 8 killed

Every mutation was applied to the committed tree, the single target test run, then reverted.

| # | Mutation | Test | Observed failure |
|---|---|---|---|
| M1 | probe per-endpoint again (`probeStart(probes)`) | `…RunsOneCoherentEndpointAcrossDivergentAncestries` | `Not equal: expected: 0x1324 actual: 0x12c0` — *"the floor is the highest anchor that is canonical on THE ONE endpoint the pass ran against"* (floor 4900 → 4800) |
| M2 | drop the `servedBy.Index != endpoint` check | `…RefusesAProbeSilentlyServedByAnotherEndpoint` | `Should be false` — *"the pinned endpoint did not answer, so nothing was concluded"* |
| M3 | put `RewindPrices` back on `PriceStore` | `TestPollStoreHasNoDeletionPrimitive` | `Should not be: "RewindPrices"` — *"PollStore must not expose a price deletion primitive (D-010 clause 1)"* |
| M4 | M3 + restore the `floorProvenOrphaned` rewind arm | `…NeutralizesWhenEveryAnchorIsProvenOrphaned` | `Should be empty, but was [{prices:poll:10 10 4070 0}]` — *"even a complete negative does not authorise deleting a polled row"* |
| M5 | remove `abandonPass` (fail ends the page, keeps the pass) | `…DiscardsAHalfWalkedPassWhenItsEndpointStopsAnswering` | `Should be false` — *"the first page's mismatches came from an endpoint that stopped answering, so they are discarded"* |
| M6 | make `refreshNeutralizedBacklog` a no-op | `TestPollerExposesTheNeutralizedBacklog` | `Should be true` — *"the backlog was read from durable rows during hydration"* |
| M7 | on read failure, claim the backlog is known | `TestPollerBacklogReadFailureDoesNotBreakHydration` | `Should be false` — *"and it reports the number as unknown rather than as zero"* |
| M8 | restore the `invalid_reason <> $4` predicate | `TestNeutralizedPriceStatsCountsOnlyReorgMarkedRowsOfOneEngine` | `Not equal: expected: 2 actual: 3` — *"the non-positive row already carried a different reason"* |

---

## 4. Test integrity

Against the four prior failures in this series:

- **No test asserts harmful behaviour as expected.** Every rewrite of a wave-5 test *tightened* the
  safety assertion. `…DeletesWhenEveryAnchorIsProvenOrphaned` (which asserted `st.rows` empty) is now
  `…NeutralizesWhenEveryAnchorIsProvenOrphaned` and asserts every row is still present and unreadable.
- **Two assertions were relaxed, and both are disclosed.** (i) `…RefusesWhenTheCheckpointCannotBeReRead`
  used to require the pass *survive* an unreadable checkpoint; it now requires the pass be discarded,
  with the fail-forever reasoning written into the test. Every safety assertion in it (nothing marked,
  nothing acked, nothing deleted, recovery works) is unchanged or stronger. (ii) The
  "a NEWER anchor above it could not be probed" log assertion is gone because GATE 1 is gone; it is
  replaced by `require.Equal(t, []uint64{5000}, ch.hashCalls)` — proof the lower anchor was never
  probed, which is a stronger claim than the log line was.
- **No test assumes a transition Postgres cannot make.** The store-side clause-4 test is a **live**
  Postgres test (`internal/store/prices_repair_test.go`), because the claim is about which rows a
  predicate selects. Nothing sets `st.unacked` directly.
- **Guard tests cover partial and mixed failure.** Total (`failAll`), single-height on all endpoints
  (`failProbe`), single-height on **one** endpoint (`failProbeOn`, the silent-failover path), and the
  **mixed** shape — `…DiscardsAHalfWalkedPassWhenItsEndpointStopsAnswering`, where a complete first
  page succeeds and the endpoint dies partway into the second.
- 7 new top-level tests, all mutation-verified.

---

## 5. Did code disappear?

`internal/prices/poller.go`, non-comment lines: **92 removed, 108 added (net +16)**.

That +16 is **entirely clause 4**: `refreshNeutralizedBacklog` + `NeutralizedBacklog` are 24 code
lines, and D-010 clause 4 creates that obligation — it is an operational surface, not guard logic.
Excluding it, the repair path is **~81 added against 92 removed, net −11**, and the new code is three
small helpers (7 + 11 + 8 = 26 lines) that *replace* a larger amount: `rewindTo`, GATE 1, the
`probeFailed` bookkeeping, `probeCheckpointBy`, and two rewind dispatch arms. The proof obligation is
gone rather than discharged again.

---

## 6. Verification

```
go build ./...   OK
go vet ./...     OK
gofmt -l .       (no files listed — read, not just exit code)
go test ./... -count=1
```

**487 top-level PASS / 565 incl. 78 subtests / 0 FAIL / 0 SKIP** (baseline 480 / 558 / 0 / 0 at
`cb00f09`; +7 = the 7 new tests). **Convention:** "top-level" = `^--- PASS` at column 0; the 565
figure additionally counts indented subtest lines. Live Postgres `solvent-db-1` via
`TEST_DATABASE_URL`.

`go test ./... -count=1 -race` in the `golang:1.24` container against live Postgres over
`host.docker.internal`: **all 9 packages ok, no races.**

No pre-commit gate blocked anything; `control-plane doctor` reported 0 errors / 0 warnings and
`scope-gate: OK — 10 path(s)`. Staged by explicit pathspec.

---

## 7. Things I could not verify, and one process failure

1. **PROCESS FAILURE, disclosed in full.** During the first mutation run I used
   `git checkout -- internal/prices internal/store` to revert a mutation while the wave's work was
   **uncommitted**. It destroyed the entire working tree of this wave. I rebuilt it from the edit
   record, re-verified (same 487/565/0/0), and **committed before re-running any mutation**. The
   mutation results in §3 are all from the committed tree `ed2f26e`; M1 was additionally observed
   pre-loss with an identical failure message. Nothing shipped from the lost tree, but the incident is
   a real defect in my method and would have been unrecoverable had I not held the full edit record.
2. **Line endings after `git checkout`.** `core.autocrlf=true`, so the checkout re-materialised the
   four mutated source files with CRLF and `gofmt -l .` then listed them. I first mis-diagnosed this
   (`grep -c $'\r'` expanded to an empty pattern and matched every line in every file, which is why my
   initial reading was wrong). Resolved by `gofmt -w`; `git diff HEAD --name-only` is empty, so the
   working tree is byte-identical to `ed2f26e`. **The final `gofmt -l .` output is empty.**
3. **The coherence rule is not a canonicality proof.** Stated in §2 and in the code. A single pinned
   endpoint on a minority fork produces a self-consistent, wrong floor. Per-endpoint agreement
   (clause 2's option b) would narrow this further and was not built — option (a) is what D-010
   sanctions and it costs less code.
4. **Clause 4 is logs + an accessor, not a metrics surface.** `Poller.NeutralizedBacklog()` has no
   production consumer today because the health/readiness surface is wave 7's and out of scope here.
   Whether that satisfies "exposed" is a judgement I am flagging rather than asserting.
5. **`abandonPass` liveness is bounded by argument, not by test.** Rotation guarantees a *different*
   endpoint next pass; it does not bound how long a fleet where every endpoint is intermittently
   flaky takes to complete a pass. That is the same posture as the pre-existing failed-page refusal
   (which likewise never completed under continuous failure) and is reported through
   `ConditionPollRewindBlocked`, but no test bounds the time.
6. **Not exercised against a real multi-endpoint RPC fleet.** All endpoint-divergence evidence is
   against the rebuilt fake.
7. **Untouched as instructed:** `cmd/indexer/health.go`, the readiness composition in
   `cmd/indexer/main.go`, lag bounds, `internal/store/derive.go`, `internal/ingest/walker.go`,
   `internal/snapshot/snapshot.go`, `roadmap/**`, `.env.example`, migrations `00001`–`00005`. Round
   5's other two findings are untouched and remain open for wave 7.

Returns to Codex for round 6 under D-006.
