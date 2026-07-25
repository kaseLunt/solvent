### Task 8 — wave 10: round-8 fixes (prices unit)

Repo `C:\Users\kasel\source\repos\etherfi\Solvent`, branch `main`. Base: current HEAD when you start
(check `git log` — wave 9 is landing health-surface commits concurrently; your files are disjoint).

Codex round 8 on wave 8: **NO-SHIP — 1 critical blocker, 5 high, 1 medium; R6 approved.** Read
`.superpowers/sdd/task-8-codex-round8.md` (verbatim findings + adjudication) and
`roadmap/decisions/D-012-polled-prices-are-samples.md` (governing). All 7 findings ACCEPTED.

**CONCURRENCY RULES (a second implementer owns the health surface):**
- Touch ONLY: `internal/prices/**`, `internal/store/prices*.go`,
  `internal/store/migrations/00007_*` (if needed — **`00006` belongs to wave 9**), `.superpowers/sdd/**`.
- Do NOT touch `cmd/indexer/**`, `internal/store/derive.go`, `internal/snapshot/**`,
  `internal/ingest/**`. Never `roadmap/**`.
- Stage by explicit pathspec ONLY. Never `git add -A` (this is what makes parallel writers safe here).
- The shared Postgres may be running wave 9's tests concurrently. During development prefer scoped
  `-run` selections; run the full suite at the end, and if a failure looks like external interference
  (rows appearing/vanishing mid-test), re-run the failing package once before investigating.

---

## F1 [critical][blocker] — gate the no-checkpoint arm (`poller.go:1411-1415`)

`checkpointCorroborated` returns `(true, false, "")` when `!p.probeCheckpointSet`, and the
`floorUnverifiable` no-anchor path never sets a checkpoint — so legacy unanchored rows are marked
with ZERO endpoint-count enforcement and no `singleView` disclosure. Controller confirmed by reading.

**Do (Codex's recommendation):** apply the configured-count rule BEFORE the no-checkpoint return:
zero configured → fail closed; ≥2 configured → fail closed (agreement is impossible to obtain for a
proof that doesn't exist — retention is the safe default; note this makes multi-endpoint fleets
refuse to mark unanchored legacy rows, which is correct under clause 4 and harmless in production
where that population is zero); exactly 1 → proceed with `singleView=true` and the range disclosure.
Tests: no-anchor cases at endpoint counts 0, 1, and 2 [cite D-012 clause 4]. Mutation: remove the new
gate, state the property, confirm which test dies.

## F2 [high] — stop fabricating offline provenance (`prices.go:468-486`)

`applyPrices` inserts one height-wide anchor unconditionally; unsuperseded neutralized rows at the
same height then become indistinguishable from rows that anchor vouches for — poisoning the offline
recovery input D-012 clause 2 promises. (This corrects the controller's own round-7 adjudication:
removing the online consumer removed the exploitation path, not the write-side corruption.)

**Do:** prefer Codex's first option — **bind provenance per observation**: rows reference the anchor
that vouches for them (an `anchor_block`-style column or the poll-generation link, migration `00007`,
additive, with upgrade-path test from the pushed baseline; existing rows backfill NULL = "vouched by
the height anchor if one predates neutralization" is NOT assumable — document exactly what NULL
means, fail toward unprovable). If you judge per-observation binding disproportionate, the minimum
acceptable is: refuse anchor creation while any unsuperseded neutralized row exists at that height —
but then show that the new round's own rows still get provenance (they must not become unanchored
collateral damage; if they would, the refusal option is wrong and binding is required — say which and
why). Regressions: partial-revert and all-revert rounds at a neutralized height prove old rows remain
durably unanchored/un-vouched [cite clause 2].

## F3 [high] — clause 2 on every store path (`prices.go:1666-1680`)

`NeutralizeUnverifiablePrices` accepts any engine; `RewindPrices` (legal for non-poll engines)
deletes every anchor above target. A non-poll neutralized state then loses its provenance.

**Do (structural, matching R2's style):** restrict `NeutralizeUnverifiablePrices` to poll-owned
identities (sentinel error otherwise) — the marking semantics are poll-specific by D-012's own
framing (samples). AND add the neutralized-height NOT EXISTS exemption to `RewindPrices`' anchor
deletion as defence-in-depth, this time WITH the live-Postgres regression (round 8 explicitly noted
the deleted defence-in-depth test would have caught this). Both cited to clause 2.

## F4 [high] — incremental prune (`prices.go:742-754`)

Permanently-protected anchors are reconsidered by `pruneOldPollAnchors` on every anchored round.
**Do:** make pruning not reconsider them — track the prune frontier (below-frontier heights are
settled: only ever-protected anchors remain there) or add the covering partial index in `00007`.
Evidence: `EXPLAIN ANALYZE` with many retained neutralized heights (hundreds), included in the report.

## F5 [high] — stats: transition-only means transition-only (`prices.go:1228-1232`, `poller.go:711-715`, `552-561`, `1660-1661`)

Three violations: `readDurableState` unconditionally recounts (fires after every uncertain apply);
neutralization recounts twice; the aggregate full-scans without a covering index.
**Do:** (a) recount exactly once per genuine transition (neutralize, supersede, hydration at startup);
(b) the uncertain-apply Reset path re-uses the last known count with `neutralizedKnown` semantics
rather than rescanning; (c) either the `00007` partial covering index (chain_id, owner_engine +
marker predicate) with `EXPLAIN ANALYZE` evidence at projected scale, or a transactional counter —
your choice, justified. [cite clause 6]

## F6 [high] — failed recount marks unknown (`poller.go:1710-1718`)

**Do:** `neutralizedKnown = false` on every recount failure; next ordinary round retries. Tests:
upward and downward transitions with an injected recount failure → the stale value is NOT exposed as
current, and the next round corrects it. [cite clause 6 / the durable-fact rule]

## F7 [medium] — fix the citations

The one-endpoint WARN cites clause 4 (it comes from wave-8 brief R4); the exposure-query filtering
cites clause 1 (which does not specify it). **Do:** correct both to their actual normative sources —
inventing a source is worse than citing none; if a behavior has no normative source, either give it
one in the report (controller can ratify) or delete the behavior. Re-audit the entire clause table in
your report.

---

## Method (binding, unchanged)
- Commit BEFORE mutation loops. Mutation rows state the PROPERTY, and after round 8: check the
  mutation covers ALL arms of the guarded behavior — M5/M5b validated only the checkpointed arm and
  missed the blocker.
- Every new/changed guard test cites its clause. No test asserts harmful behavior as expected.
- Fake varies substance.
- If a pre-commit gate blocks you, report it; never bypass.

## Verification
Baseline at your start = whatever HEAD holds (wave 9 may have landed; measure, state the number and
convention). Zero FAIL / zero SKIP. Build/vet/gofmt (READ the output). `-race` in `golang:1.24` via
`host.docker.internal`.

## Reporting
`.superpowers/sdd/task-8-wave10-report-p2.md`: per finding F1-F7 — change, citing test, mutation
property + result, the F2 design choice justified, F4/F5 EXPLAIN evidence, and anything unverified.

Returns to Codex round 9 (prices unit) under D-006.
