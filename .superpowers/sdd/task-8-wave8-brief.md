### Task 8 — fix wave 8: implement D-012 (price pipeline)

Repo `C:\Users\kasel\source\repos\etherfi\Solvent`, branch `main`, base `1da0fa4`.
Codex round 7 returned NO-SHIP (2 critical, 2 high, 2 medium, 1 low). The governing decision changed
in response: **read `roadmap/decisions/D-012-polled-prices-are-samples.md` first** — it supersedes
D-011 and resolves every round-7 finding by classification, ratification, or required fix. Then read
`.superpowers/sdd/task-8-codex-round7.md` for the verbatim findings.

**This is predominantly a REMOVAL wave.** D-012 reframes polled prices as sampled telemetry:
neutralization is a permanent classification in the running system; provenance (rows + anchors) is
retained forever so *offline* recovery stays possible; the *online* revalidation subsystem is
removed. If your diff is net-positive in the repair path, re-read the decision.

---

## Work items, mapped to D-012 clauses and round-7 findings

### R1 — remove the online revalidation subsystem (clause 3; dissolves both criticals)
Delete: `NeutralizedPriceAnchors`, `RevalidateNeutralizedPrices`, `Poller.revalidateNeutralized`,
and the per-Step backlog-drain scheduling. The circular-provenance [critical] and starvation
[critical] live in this machinery; removing it removes them. Preserve `NeutralizeUnverifiablePrices`
itself, the supersede arm in `insertPrice` (a *current* poll landing at a neutralized height is still
a genuinely new observation), and everything round 6 confirmed (no deletion primitive on `PollStore`
+ reflection test; the `(endpoint,height)` harness; endpoint-coherent passes).

### R2 — structural rejection of `RewindPrices` for poll-owned engines (clause 1; round-7 [medium])
The store itself must refuse `RewindPrices` for a poll-owned engine identity — not rely on the poller
lacking the method. Pick the enforcement Codex suggested (reject in the store), add a live-Postgres
test proving the rejection, and fix the repository tests that currently invoke it with poll-engine
identities.

### R3 — anchor retention on every path (clause 2)
No prune, retention bound, or rewind may expire an anchor belonging to a neutralized height, on any
store path. Wave 7 covered `pruneOldPollAnchors`; R2 closes the `RewindPrices` path; audit for any
other and pin each with a test.

### R4 — the endpoint-count rule (clause 4; round-7 [high] #4)
- **≥2 endpoints configured:** agreement unobtainable ⇒ fail closed — retain unmarked, repair
  blocked, readiness condition raised. No marking, ever, without corroboration.
- **Exactly 1 endpoint configured:** single-view marking permitted (ratified by D-012). Log at WARN
  that a single-view classification occurred, naming the height range.
The distinction is **configured count, not reachable count** — two configured with one reachable is a
fault and fails closed. Kill the `agreementUnobtainable`-authorizes-marking path for the multi-
endpoint case entirely.

### R5 — cheap gap visibility (clause 6; round-7 [medium] #6)
Neutralized count/age visibility stays, but its cost may not scale with total price history. With the
per-Step drain gone, the stats only change when `NeutralizeUnverifiablePrices` or the supersede arm
runs — recompute on those transitions (or add a partial index via forward migration `00006`, with
`EXPLAIN` evidence at realistic scale). State which you chose and why.

### R6 — honest operator text (clause 7; round-7 [low])
The warning in `NeutralizeUnverifiablePrices` and the package docs must describe D-012 reality:
permanent classification, anchored vs unanchored reported distinctly, provenance retained,
offline revalidation possible but not built. No text may promise online recovery.

### R7 — tests re-specified, not just kept green
Wave 7's tests asserting "this state lasts forever" for unanchored rows now describe **specified**
behavior (clause 5) — keep them, but re-comment them to cite the clause. The revalidation tests
(including `TestPollerRevalidatesAPastHeightWithoutAnotherPollThere`) are removed with their subject.
The wave-5-era snapshot test that expected `Ready=true` with failures is out of your scope (health
surface, wave 9) — do not touch it.

---

## Test integrity — the mechanism is changing, not the exhortation

Five test-integrity failures this series. The recurring cause: tests written to pin *current
behavior* rather than *specified properties*. New binding rule for this wave:

**Every guard/refusal/permanence test must carry a comment citing the D-012 clause (or other
normative source) it enforces.** A test that cannot name its clause is pinning implementation, not
specification — rewrite or delete it. Your report lists each new/modified test with its citation.

Mutation checks remain required for new guards (R2, R4), with observed failure messages — but state
the *property* each mutation validates, not just that tests died. A killed mutation certifies current
behavior; only the clause citation makes it evidence of correctness. (Round 7 found two mutations
mislabelled as safety evidence; that is the trap.)

**Commit before running mutation loops** — wave 6 destroyed its own uncommitted work mid-mutation.

## Verification

Baseline, controller-measured at `8f0eeef`: **497 top-level PASS / 575 incl. 78 subtests / 0 FAIL /
0 SKIP**. A removal wave may legitimately reduce the count — state exactly which tests were removed
with their subject and which remain. Zero FAIL / zero SKIP is unconditional.

```bash
export PATH="$PATH:/c/Program Files/Go/bin:/c/Users/kasel/go/bin"
export TEST_DATABASE_URL='postgres://solvent:solvent@localhost:5432/solvent?sslmode=disable'
go build ./... && go vet ./... && gofmt -l .   # exits 0 even when it lists files — READ it
go test ./... -count=1
```

`-race` in the `golang:1.24` container (host lacks cgo), live Postgres via `host.docker.internal`.

## Scope and process

- Touch only: `internal/prices/**`, `internal/store/prices*.go`, `internal/store/migrations/00006_*`
  (only if R5 needs the index), `.superpowers/sdd/**`.
- Do NOT touch the health/readiness surface (`cmd/indexer/health.go`, readiness composition in
  `cmd/indexer/main.go`, lag bounds) — wave 9 owns it. If a removal ripples into `cmd/indexer` (e.g.
  a deleted method referenced there), make the minimal call-site removal and flag it prominently.
- Do not touch `internal/store/derive.go`, `internal/ingest/walker.go`, `internal/snapshot/snapshot.go`.
- Never touch `roadmap/**`. `.env.example` out of scope. Never edit migrations `00001`–`00005`.
- Stage by explicit pathspec, never `git add -A`. If a gate blocks you, report it — never bypass.

## Reporting

`.superpowers/sdd/task-8-wave8-report-p2.md`: per work item R1–R7 — what was removed/changed, the
clause citation per test, mutation results with the property each validates, net line delta for the
repair path, and anything unverified.

Returns to Codex for round 8 under D-006, with D-012 as governing context.
