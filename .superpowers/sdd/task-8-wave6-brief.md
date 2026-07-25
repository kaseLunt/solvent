### Task 8 — fix wave 6: price-pipeline unit (A1, under D-010)

Repo `C:\Users\kasel\source\repos\etherfi\Solvent`, branch `main`, base `300b2ea`.
Codex round 5 returned **NO-SHIP** (`.superpowers/sdd/task-8-codex-round5.md`).

**This wave is scoped to the price pipeline only.** Round 5's other two findings (snapshot readiness
gating, timestamp-based lag) belong to the **health/readiness surface**, which is being split into its
own reviewable unit and handled in wave 7. **Do not touch `cmd/indexer/health.go`, the readiness
composition in `cmd/indexer/main.go`, or the lag bounds.** If a change you need appears to require
them, stop and report it rather than widening.

---

## D-010 is binding — read it first

`roadmap/decisions/D-010-never-delete-polled-prices.md` is an **accepted** decision and governs this
wave. Summary of what it obliges:

1. **The poller never deletes polled price rows.** Remove the destructive path; do not guard it. Rows
   that cannot be proven canonical are **neutralized** — retained, marked unreadable and unverifiable —
   using the `NeutralizeUnverifiablePrices` machinery wave 4 already built.
2. **This is not a licence for an unsound marking decision.** Fix round 5's endpoint-coherence defect
   properly: a proof pass runs against **one coherent endpoint without silent failover**, or runs
   complete per-endpoint passes and **requires agreement**. Endpoint disagreement retains data and
   never authorises marking.
3. **The harness is a prerequisite, not a follow-up** — see below.
4. Neutralized rows are an operational surface: expose count and age so accumulation is visible.
   Re-verification/retirement of them is explicitly a P3 concern; do not build it.

**Scope note from D-010:** this applies only to non-replayable **polled** observations.
`RewindDerived` and the event-derived paths are unchanged — event state is replayable from `raw_logs`,
so deletion there stays correct. Do not alter them.

---

## Step 1 — rebuild the test harness BEFORE the fix

The current price fake returns hashes **keyed by height only**. It is therefore *structurally
incapable* of expressing round 5's finding, in which two endpoints disagree about the same height.
Codex said so explicitly: *"The fake returns hashes by height only, so the new tests cannot model this
disagreement."*

**Rebuild it keyed by `(endpoint, height)`**, and model per-endpoint failover so a proof pass can be
observed crossing endpoints. Then reproduce **Codex's exact scenario** as a regression:

> endpoint 0 mismatches the highest anchor while retaining the middle anchor in its ancestry;
> endpoint 1 mismatches that middle anchor on another fork; endpoint 0 matches a lower anchor. The
> unchanged endpoint-0 checkpoint must **not** authorise touching the middle anchor, which is canonical
> on the checkpoint chain.

Do the harness work first and say so in your report. A fix that cannot be falsified is not finished.

## Step 2 — implement D-010 clauses 1 and 2

- Remove the deletion path from the poller's repair. Neutralize instead.
- Make proof passes endpoint-coherent per clause 2.
- Preserve the wave-4/5 properties that Codex has already accepted: the `floorOutcome` partition, the
  reorg-generation stamping, and the live-chain checkpoint re-read immediately before the (now
  non-destructive) act. Those were correct for their dimensions; keep them.
- Expose neutralized-row count and age (clause 4).

**Deleting the destructive path should make code disappear.** If this wave is a net addition of
guard logic, re-read D-010 — the point is that the obligation goes away.

---

## Test integrity — FOUR failures in this series, and one is the same class as the first

1. Wave 1 shipped a passing test asserting polled history was gone, *"this loss is real"*.
2. Wave 3's replacement covered only total probe failure, missing the mixed path.
3. Wave 3 fabricated `st.unacked = false`, a transition Postgres cannot make.
4. **Wave 5's snapshot test expects `Ready=true` with two current failures** — codifying unsafe policy
   instead of detecting it, exactly like #1, after four rounds of instruction.

Binding rules:

- **No test may assert harmful or unsafe behaviour as expected.** If the code does something unsafe in
  a scenario, the test asserts the safe behaviour and the code changes — the test never ratifies it.
- **No test may assume a state transition the real store cannot produce.**
- **Every guard test must cover partial and mixed failure**, not just total failure.
- **A fake that cannot express the failure mode is a defect in the harness**, not an excuse.
- **Mutation-verify every new regression**: disable the fix, confirm the test fails, restore. Report
  the observed failure message. (The controller independently mutation-tested wave 5's checkpoint gate
  and will do so again.)

## Documentation honesty — five rounds, five sets of overclaims

Every round so far has found a claim the code does not enforce. Two of wave 5's *disclosed rationales*
were themselves wrong when examined. If you write "always", "never", "guaranteed", or a bound, either
the code enforces it or the sentence goes.

## Verification

Baseline, controller-measured at `cb00f09`: **480 top-level PASS / 558 incl. 78 subtests / 0 FAIL /
0 SKIP**. Report top-level counts and name the convention.

```bash
export PATH="$PATH:/c/Program Files/Go/bin:/c/Users/kasel/go/bin"
export TEST_DATABASE_URL='postgres://solvent:solvent@localhost:5432/solvent?sslmode=disable'
go build ./... && go vet ./... && gofmt -l .   # exits 0 even when it lists files — READ it
go test ./... -count=1
```

`-race` needs the `golang:1.24` container; reach live Postgres via `host.docker.internal`.

## Scope and process

- Touch only: `internal/prices/**`, `internal/store/prices*.go`, and `.superpowers/sdd/**`.
- **Do not touch** the health/readiness surface (`cmd/indexer/health.go`, readiness composition in
  `cmd/indexer/main.go`, lag bounds) — wave 7 owns it.
- **Do not touch** `internal/store/derive.go` (already modified four times), `internal/ingest/walker.go`,
  or `internal/snapshot/snapshot.go` unless a D-010 clause forces it — and if so, say why.
- **Never touch `roadmap/**`.** `.env.example` is out of scope.
- Forward migration `00006` if needed; never edit `00001`–`00005`.
- Stage by explicit pathspec, never `git add -A`. If a gate blocks you, report it — never bypass.

## Reporting

`.superpowers/sdd/task-8-wave6-report-p2.md`:

- The harness rebuild: what it can now express that it could not before, and the Codex scenario
  reproduced as a test.
- Each D-010 clause: how it is satisfied, and what code was **removed**.
- Mutation results per new regression, with observed failure messages.
- Anything you could not verify.

Returns to Codex for round 6 under D-006.
