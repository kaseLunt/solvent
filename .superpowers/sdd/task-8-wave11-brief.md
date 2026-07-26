### Task 8 — wave 11: round-9 fixes (HEALTH unit)

Repo `C:\Users\kasel\source\repos\etherfi\Solvent`, branch `main`. Base: current HEAD when you start
(`git log` first — the prices wave may still be landing commits; your files are disjoint).

Codex round 9 on the health unit: **NO-SHIP — 1 high, 3 medium.** Read
`.superpowers/sdd/task-8-codex-round9-health.md` (verbatim + adjudication) and the wave-9 context
(`.superpowers/sdd/task-8-wave9-brief.md`, `task-8-wave9-report-p2.md`). All 4 findings ACCEPTED.

**CONCURRENCY RULES (a second implementer owns `internal/prices/**` + `internal/store/prices*.go`):**
- Touch ONLY: `cmd/indexer/**`, `internal/store/derive.go` (flagged — 6th modification of
  Codex-approved ground; additive only), `internal/snapshot/**` if H4 genuinely requires it (flag),
  `internal/store/migrations/<next-free>_*.sql` if H2 needs one (**`00006` and `00007` are taken** —
  check what exists at your HEAD), `.superpowers/sdd/**`.
- Never `roadmap/**`, never `.env.example`, never migrations `00001`–`00007`.
- Stage by explicit pathspec ONLY. Shared Postgres may be running the other wave's tests: scoped
  `-run` during development, full suite at the end, re-run once on suspected interference. If the
  shared tree contains foreign mid-edit files, verify from a `git archive` export of your own commit
  (wave 9's method) and say so.

---

## H1 [high] — the throttle must survive a real historical backfill (`main.go:783-809`)

The cross-block reuse condition (`retained age <= bound/2`) can NEVER hold once cursor timestamps are
genuinely old — which is the definition of historical backfill — so every gated worker refetches
every hot round (~13 sequential reads/round), taxing the same endpoints ingestion needs. The wave-9
cost harness modeled fresh advancing cursors; its numbers do not describe the hard case. Also fix the
report inconsistency Codex noted: with the per-chain down-set, the no-cooldown failure estimate is one
fetch per chain per round, not 13.

**Do (Codex's recommendation):** bounded fail-closed reuse for stale advancing cursors — during
deep-stale advance, reuse the retained (older-or-equal ⇒ age only OVER-estimated, can never
false-green) stamp for a bounded number of rounds/blocks with periodic exact refreshes (pick the
refresh cadence and justify it from the fetch budget; state both bounds in the comment). **Replace
the cost harness with old cursor timestamps** and assert fetch counts for (a) stale successful
backfill and (b) dead-chain. The harness change is as load-bearing as the code change: measured
evidence must measure the hard case.

## H2 [medium] — the adaptive bound must survive restart (`derive.go:1301-1308`)

`completed_at` is NULLed on open/rewind; `LastPassDuration` reads only the closed row; restart during
a long healthy sweep ⇒ naive bound ⇒ false-red for the rest of the generation.
**Do:** persist the last completed pass duration so it survives an open generation — either a
retained-history read (previous completed generation row, if rows survive — check
`sweep_generations` lifecycle first) or a small additive migration. Hydrate before the first health
verdict. Test: restart mid-open-generation ⇒ bound unchanged from pre-restart.

## H3 [medium] — skew check at every reuse, not just at fetch (`main.go:773-790`)

Memo/throttle hits return before the future-skew validation; a >60s clock rollback makes a cached
stamp grossly future, `stalenessAge` clamps negative to zero ⇒ false-green forever at that block.
**Do:** apply the L2 check on EVERY reuse path; a beyond-tolerance retained stamp is evicted and the
round emits `staleness_unmeasured`. Test: clock-rollback (fake clock) ⇒ unmeasured, then refetch
recovers. This is the round-8-blocker shape (one arm gated, the other open) — sweep for any OTHER
validation applied at write-in but not read-out before you claim the class closed.

## H4 [medium] — the quiet-refusal test must drive the real path (`health_test.go:2200-2225`)

**Test-integrity failure #6**: the test hand-builds a closed generation containing a stale account —
a state `ErrStaleSweepBatch` cannot produce (it applies no status update; the account stays in
`SweepWorkBatch`; the generation cannot reach empty-batch completion).
**Do (Codex's recommendation):** real open generation, prior stale success, an actual
`ErrStaleSweepBatch` refusal driven through the store/snapshotter path, asserting
`collateral_unusable` is the resulting guard. If driving the real snapshotter requires a fake CHAIN
(not a fake STORE), build that — the prohibition is on impossible *store* transitions.

---

## Method (binding; the citation rule did not prevent H4 — substance over attribution)
- No test may assume a state transition the real store cannot produce. When in doubt, drive the real
  component against live Postgres.
- Commit before mutation loops; mutations state the property; check every ARM of a guarded behavior.
- Measured evidence must measure the hard case (H1's lesson — say what scenario each number models).
- Citations to actual normative sources only.

## Verification
Measure baseline at your start commit, state it + convention. Zero FAIL / zero SKIP (foreign-file
caveat above). Build/vet/gofmt (READ output). `-race` in `golang:1.24` via `host.docker.internal`.
`TEST_DATABASE_URL='postgres://solvent:solvent@localhost:5432/solvent?sslmode=disable'`;
`dangerouslyDisableSandbox: true` + PATH export for go commands.

## Reporting
`.superpowers/sdd/task-8-wave11-report-p2.md`: per finding — change, citing test, mutation property +
result; the H1 harness rebuild with both scenarios' measured counts; anything unverified.

Returns to Codex (health unit) under D-006.
