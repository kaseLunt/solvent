# chain-truth standing consult — walker-layer rotation class (input to wave-12 brief)

- **Subject:** the OPEN class recorded at ledger "ROUND 3 + OP INCIDENT" (progress-phase2.md:81)
  and task-9-codex-round3.md:29-41 — walker content-validation failures never rotate endpoints.
- **Constitution read:** progress-phase2.md (full, incl. :81-90 forensic chain), D-012,
  task-9-codex-round2.md (the poller ruling), task-9-codex-round3.md, internal/ingest/walker.go,
  internal/chain/chain.go, internal/prices/poller.go (seam :913-1139), cmd/indexer/main.go
  (stepWalkers :648-693), config/contracts.json (all 10 streams: window 2000, conf 5).
- **Verdict:** **CUSTODY HOLDS** for the current walker (fail-closed, proven live); the class is a
  LIVE availability defect with one silent variant. Blocking list and wave-12 scope at the end.

---

## Q1 — Is the class still LIVE post-reported-hash-law? YES, structurally.

### The mechanism is independent of the incident's root cause

The incident's trigger (v1.13.0 recomputed hashes, ledger :82) is closed by wave 5; under the
reported-hash law that exact wedge cannot recur (tip-log hash and tipBefore are now two
provider-reported values — foundation-only proved them equal at 150,105,227). But the wedge
MECHANISM was never the hash defect; it is three structural facts that are all still true:

1. **`walker.go:224-261`** — every validation arm (removed-log :224, out-of-window :227,
   address-set :231, int32 :236, fork-consistency :241, tip-log-vs-tipBefore :250, divergent
   duplicate :255) fires AFTER a successful RPC and returns an error.
2. **`chain.go:819-831`** — `Failover.do` re-pins the shared `active` hint onto the endpoint
   that served the successful attempt. The offender is not merely "not rotated away from" —
   it is **actively pinned** by the very getLogs call that returned the rejected content.
3. **`main.go:671-675`** — `stepWalkers` answers a Step error with backoff only. No routing
   state anywhere in the path changes. Next Step: `BlockNumber` starts at `active` = offender,
   succeeds at the RPC layer, the whole window is re-fetched from the same witness, the same
   bytes fail the same arm. Deterministic, forever, at the 10-minute cap — the observed 19
   identical failures / 2.5h+ shape, regardless of what CAUSES the content fault.

Plus the walker is endpoint-blind by interface (`walker.go:17-21` — no tokens, no From
variants) and its per-Step endpoint affinity is "documented, not enforced" (`walker.go:114-117`),
so window pieces can legitimately be assembled cross-endpoint after any mid-window rotation —
the exact ambiguity that made the OP incident undiagnosable for hours.

### Residual scenarios (post-law), with realism grades

Evidence discipline: grades cite this project's probes/ledger; where a class has no in-project
observation I say so.

| # | Scenario | Arm it trips | Posture today | Realism |
|---|---|---|---|---|
| S1 | **Split lb backends behind one URL**: headers from backend on view A, logs (or the closing header) from backend on view B; also provider header-cache vs log-index eventual consistency (no fork needed) | tip-log-vs-tipBefore :250 (ERROR wedge) or tipBefore≠tipAfter :193 (SILENT discard loop — see F2) | wedge / silent stall | **MODERATE.** The accepted round-1 premise ("a token names a URL, not a backend", ledger :79); dRPC free tier is a routing pool with per-request backend variance (archive contraction, ledger :88). Disagreement windows at depth ≤5 are short but recurring over months of steady state. |
| S2 | **Corrupt/duplicated log-index shard**: divergent duplicate (tx,index) :255, mixed hashes at one height :241, out-of-window rows :227 | validation ERROR | deterministic wedge until the provider repairs the shard | **LOW frequency / HIGH dwell** — the worst wedge profile. No direct in-project observation; graded from provider-ops experience, flagged as inference. This is the class the OP incident LOOKED like from inside for 2.5 hours. |
| S3 | **Wrong-fork/stale serving below finality at cursor height** (ETH conf=5 ≈ 1min, far below ~13min finality — same height, two truths is normal weather) | reorg check :152-157 → NOT a wedge: a **false-rewind churn loop** (Rewind deletes + re-walks; derived epochs cascade each time) | churn, not corruption (raw logs replayable) | **LOW-MODERATE.** Legitimate cross-view disagreement at depth 5 on ETH; on OP (10s deep, single sequencer) rarer. |
| S4 | Address-filter ignored / removed=true leaked into a mined-range query | :231 / :224 ERROR | wedge | **LOW.** No in-project observation. |
| S5 | **Responsive-frozen endpoint** (head stuck at N; every call succeeds) | NO arm fires — permanent caught-up at a stale cursor | silent stall; durable freshness eventually reds, no rotation ever | **MODERATE** — this exact class was live-found for the snapshotter (Task 7, ledger :23 "responsive-frozen endpoint defeats the stale guard"). Adjacent to, not identical with, the validation class; needs its own trigger (F4). |
| S6 | **Partial-range silent truncation** (successful-but-incomplete getLogs) | none — trusted by design (`walker.go:117-118`, disclosed) | silent data gap, NOT a wedge | Not a member of this class; rotation does not touch it. Detection net = wave-10 reconcile aggregate welds. Note only. |
| S7 | int32 log-index overflow :236 | ERROR | — | Negligible; keep the gate, no scenario. |

**Ruling: the class is LIVE.** The reported-hash law removed the one trigger we happened to hit
first; it removed none of the wedge machinery, and S1/S2 wedge identically. Every deterministic
content fault from one witness stalls one stream forever with a healthy witness idle, and the
observed remediation cost is operator intervention (config surgery + restart) — the exact
availability bill the poller's rounds 1-3 were paid to stop.

---

## Q2 — Transpose the poller seam? YES; the shared-hint "nudge" is REFUTED, per-walker machinery must exist.

### The nudge into the shared hint is pre-refuted by this repo's own history — BLOCKING against that option

- `chain.go:944-950`: `RotateAwayFrom` + revision counter were **retired** in Task 7 wave 6
  precisely because a shared-hint semantic rotation cannot survive an interleaved shared-path
  success on the rejected endpoint — and the counter-schedule that killed it was **a walker's
  own BlockNumber success re-pinning the hint** (ledger :23, gate session 019f8f85). Ten walkers
  plus HeaderTime probes share one Failover per chain; any sibling's success re-pins the hint to
  the offender within one round. Content faults are frequently range-scoped (S2), so the sibling's
  success is LEGITIMATE — the hint is doing its job. A shared hint structurally cannot carry a
  caller-specific exclusion. d1e7d54's ambiguity rules and `poller.go:1129` ("the shared routing
  hint is never written") are accepted-decision-level constraints; re-litigating them loses to
  the same schedule.

### The transposition, shaped by what ingest actually is

The poller precedent transposes cleanly because the differences are pacing, not structure:
the poller retries by cadence, the walker by backoff — either way "the next attempt" exists and
"the next attempt's starting endpoint" is the entire fix. Per-stream granularity is CORRECT
(content faults are per-witness and often per-range; exclusion must be per-stream). Design:

1. **Chain layer (additive, minimal — reopens Codex-approved chain.go under D-006):**
   - `BlockNumberFrom(ctx, startIndex) (uint64, EndpointToken, error)` — doFrom + the existing
     strict raw decode. Keep `eth_blockNumber` as the question on the wire: `chain.go:379-388`
     records why the head probe must not become `eth_getBlockByNumber("latest")`.
   - `LogsFrom(ctx, startIndex, from, to, addrs) ([]types.Log, EndpointToken, error)` — doFrom
     over the already-gated FilterLogs.
   - `HeaderHashFrom` already exists (`chain.go:1148`).
   - **NO aggregate propagation** (`doFromAttempts` stays pinned-call-only): the walker does not
     need per-attempt unanimity because routing advances on BOTH postures and both feed the
     failure streak (Q3). Smallest possible reopen surface.

2. **Walker:** a per-walker `startPref` (init -1 → read `ActiveEndpoint()` once, read-only),
   joining the existing single-writer per-Step fields' concurrency contract (`walker.go:49-62`
   — zero new concurrency surface). Step resolves its serving endpoint on the FIRST read
   (`BlockNumberFrom(startPref)` → `servedBy`), pins every subsequent read `From servedBy.Index`,
   and REQUIRES token equality — a read served by a different endpoint is a coherence discard
   (non-landing, nothing saved). One deferred seam keyed on a `landed` flag, the
   `poller.go:933-948` shape verbatim, so **every future failure arm gets the advance for free**
   (the per-arm approach missed twice at the poller; do not re-run that experiment at ingest).

3. **Retention, not reset:** on landing, `startPref = servedBy.Index` (the walker's own
   affinity). Do NOT reset to follow the shared hint after landing — that recreates the A-bounce
   the poller needed the wave-9 bounded lease (d1e7d54) to escape: hint points at the offender
   (sibling re-pinned it), this walker fails, advances, lands elsewhere, resets, bounces back —
   every other Step wasted. Retention converges each stream to a witness that lands for IT, and
   a recovered endpoint is re-probed through the non-landing ping-pong (`poller.go:1134-1136`'s
   liveness property; pin the n=2 termination trace like Task 7's closing gate did).
   Side effect to disclose in the brief: walkers stop feeding the shared hint; remaining `do()`
   consumers (HeaderTime freshness, TxCalldata, poller's :919 default-start READ) are
   hint-tolerant by design — one review-note, no code.

4. **Endpoint-coherent windows are the custody upgrade riding along:** with all six reads
   pinned to one token, the tip-log-vs-tipBefore check becomes a SAME-WITNESS contradiction —
   decidable, attributable — instead of the cross-provider ambiguity that consumed the incident
   night. It also stops paying the publicnode-403 churn tax structurally: a window that starts
   at publicnode discards once on token mismatch, advances, and the stream retains the landing
   endpoint (R-001 probe, ledger :76: publicnode 403s every deep getLogs).

---

## Q3 — Chain-movement discards: subsume, with a geometry argument instead of discrimination machinery.

**The premise "mid-window chain movement near head is ROUTINE" is false for this walker's
geometry.** Both bracketing reads are at the SAME height `to = head − conf` (conf=5 on all 10
streams, contracts.json). A hash at a fixed height does not move when the head advances; it
moves only when a **≥5-deep reorg** crosses it. Post-merge ETH depth-5 reorgs are essentially
unobserved; OP's sequencer makes 10s-deep unsafe reorgs rare. A lagging-but-honest backend at
depth <5 serves the SAME hash; one lagging >5 serves not-found, which is an error that already
rotates inside the doFrom walk. So genuine chain movement is an ANOMALY at these discard arms,
not weather — the routine cause of a walker discard is cross-view disagreement, which is
exactly what should advance routing. (The poller's discards ARE routine because it pins at the
live head; the walker pins 5 blocks deep. Same seam, opposite base rates — and both point the
same way.)

**Rules:**
- Every discard arm (tipBefore≠tipAfter :193, cursor recheck :199, and the new token-mismatch
  coherence discard) is NON-LANDING → advances `startPref`. No discrimination machinery. The
  thrash objection is void for the round-2 reason: the advance attributes no fault and costs one
  preference move; with healthy endpoints discards are rare, so the preference is stable.
- **Caught-up (`walker.go:161-168`) keeps the starting point**: no window was attempted, there
  is no window outcome to judge. (The frozen-head hole this leaves is F4, named separately —
  do not let the seam claim to cover it.)
- **Rewind counts as landing** (a durable write; `:371` returns advanced=true). F3's churn-loop
  rider below is the guard if the controller wants it.
- **Discards join the failure streak (F2, blocking):** today a deterministic discard loop hits
  `main.go:666-668` (`!advanced` → break) and then `:677` `bo.success()` — backoff reset every
  round, no step_error, invisible until durable freshness reds. That is the round-3 [medium]
  (posture flicker destroying outage pacing/visibility) one layer up, ALREADY SHIPPED at ingest.
  Step must surface discard-vs-caught-up distinctly (typed outcome or a third return), and
  stepWalkers must count coherence discards as failure rounds. Cost: a rare genuine deep-reorg
  discard pays one 30s backoff — acceptable; the alternative is the proven silent wedge.

---

## Q4 — The harness wave 12 must ship (house style)

**Precondition finding:** the current fake (`walker_test.go:16-43`) is a single-view fake — one
head, one hash source, one log script. It is **structurally incapable of expressing endpoint
disagreement**: the round-5 "the fake is the limiting factor" law (ledger :48), present at
ingest today. First deliverable: a per-endpoint fake mirroring `doFrom` walk semantics exactly
(the prices wave-6 `endpointView` pattern), run against the UNCHANGED walker first — all
existing tests must pass before the fix lands (the wave-6 discipline that made later failures
meaningful). Fixture-realism law applies (ledger :78): no physically-impossible values; every
guard test CITES the principle clause it enforces (the post-D-012 test-integrity mechanism,
ledger :60); no test may assume a transition the real store/chain cannot produce (ledger :40).

**Regressions:**
- **R1 (the incident schedule):** endpoint 0 deterministically serves an internally-inconsistent
  window (tip log hash ≠ its own header at `to`); endpoint 1 consistent. Assert: Step k errors
  on 0, Step k+1 starts past 0 and LANDS on 1, cursor advances. Multi-round.
- **R2 (silent-discard split):** endpoint 0's two header reads alternate internal backends
  (tipBefore≠tipAfter forever); endpoint 1 healthy. Assert: backoff streak GROWS across discard
  rounds, step_error visible, routing advances, next Step lands on 1.
- **R3 (sibling interference — the design refutation):** walker A excludes endpoint 0 after a
  content failure; sibling walker B lands on 0 legitimately (its range is clean) and re-pins the
  shared hint; assert A's next Step STILL starts past 0. This is the test that kills any
  shared-hint implementation (the Task 7 gate counter-schedule, transposed).
- **R4 (coherence):** logs served by endpoint 1 while tipBefore came from 0 (mid-walk rotation
  inside LogsFrom): window discards, SaveBatch never called with cross-endpoint pieces, routing
  advances.
- **R5 (retention + liveness, n=2 termination trace):** landing keeps the start across Steps;
  A wedges → B lands → stays B; later B wedges → A re-probed within one rotation. Single-endpoint
  leg: no pretend rotation, error posture unchanged, telemetry says so.
- **R6 (caught-up keeps start).** If F4 adopted: freshness-red caught-up ≥K rounds advances.
- **R7 (rewind interplay):** genuine reorg → rewind → re-ingest lands on the same start. If F3
  adopted: second witness contradicts the cursor mismatch → NO rewind, non-landing, advance.
- **R8 (chain layer, real-Dial raw-JSON):** for both new From methods, a ''-quantity/malformed
  envelope fails the attempt and the healthy secondary lands (the wave-7/8 hermetic layer below
  the fake seam).
- **R9 (daemon wrapper, multi-round mixed posture):** endpoint 0 discards, endpoint 1 errors,
  persistently — backoff streak grows monotonically toward the cap, step_error never flickers
  off while nothing lands (round-3's recommendation transposed verbatim).

**Mutations (committed applier, exactly-one-occurrence, property stated per row —
wave16-mutations pattern):**
M1 delete the deferred advance → R1/R2/R5 die. M2 exempt the discard arm → R2 dies (the W2M5
reversal transposed). M3 discard counts as bo.success() → R9 dies. M4 drop token-equality →
R4 dies. M5 write the shared hint on non-landing → R3 dies. M6 reset startPref to hint on
landing → R5's bounce leg dies. M7 remove the tip-log validation arm → R1's custody assertion
dies (the validation, not just the routing, is load-bearing).

---

## Findings register

| ID | Severity | Finding | Prescription |
|---|---|---|---|
| F1 | **blocking** | Content-validation failures never rotate; sticky hint actively re-pins the offender (`walker.go:224-261` + `chain.go:819-831` + `main.go:671-675`). S1/S2 wedge one stream forever with a healthy peer idle. | The Q2 transposition: additive From methods, per-walker startPref, deferred non-landing seam, token coherence, retention-on-landing. Cites: "landing is the only outcome that keeps the starting point" (round-2 ruling, closed law). |
| F2 | **blocking** | Deterministic discard loop is a SILENT wedge: `(false,nil)` at :193/:199 → `bo.success()` (`main.go:666-677`), backoff reset, no step_error — worse detection profile than the incident. | Discards surface distinctly and join the failure streak; discards advance routing (Q3). Cites: round-3 [medium] classification/pacing lesson. |
| F3 | should | False-rewind churn loop under a wrong-fork/stale witness below finality (conf=5 ≪ ETH finality): single-witness mismatch authorizes a destructive Rewind (`walker.go:157`, `:366`). Raw logs are replayable, so churn not corruption — but each loop cascades reorg epochs into the derived layer. | ≥2 endpoints configured ⇒ corroborate the cursor mismatch on a second endpoint before Rewind; 1 configured ⇒ single-view permitted (D-012 clause-4 POSTURE transposed — needs its own brief clause, not a silent import of a prices decision). Alternative cheap guard: K consecutive rewinds without net forward progress = non-landing. |
| F4 | should | Responsive-frozen endpoint → permanent caught-up stall; no validation arm fires; the seam cannot see it (caught-up is landing-equivalent). Task 7 found this exact class at the snapshotter (ledger :23). | Rider: caught-up while the stream's durable freshness condition is red for ≥K rounds counts as non-landing. If cut from wave 12, RECORD it open with the same discipline this class was recorded with. |
| F5 | note | Partial-range silent truncation is untouched by rotation (disclosed trust boundary, `walker.go:117-118`); detection net = wave-10 reconcile welds. Do not let wave 12 claim it. | Disclosure line in the brief. |
| F6 | note | Post-transposition the shared hint is no longer fed by walker successes; remaining `do()` users (HeaderTime, TxCalldata) and the poller's :919 hint-READ are tolerant by design. | One review-note in the brief; no code. |

## Recommended wave-12 scope

**IN (blocking):** F1 + F2 — chain.go `BlockNumberFrom`/`LogsFrom` (additive, no aggregate),
walker seam + coherence + retention, stepWalkers outcome accounting, harness rebuild, R1-R5 +
R8 + R9, M1-M7. **CONTROLLER'S CUT (should):** F3 (requires its own ratified clause), F4 (if
cut, record open). **OUT:** F5, cross-provider window quorum (different class, prohibitive
cost). **Process:** reopens `internal/ingest/walker.go` (round-1-cleared; touched additively in
Task 8 waves 3/5) and `internal/chain/chain.go` (senior-approved through the wave 5-9 chain
reopen) → D-006 Codex adversarial round mandatory; this document's R3 and R9 are the two
regressions Codex will otherwise write for us.

## Verdict

**CUSTODY HOLDS** for the current walker. Every content anomaly fails closed — nothing wrong is
persisted (the incident wedged rather than corrupted; the fail-closed validation is what CAUGHT
a systemic silent defect, ledger :82), and what staleness results is honestly surfaced by the
durable freshness pass. The class is an availability defect with one silent variant — and a
liquidation-risk product's data can be perfectly custodied and uselessly stale, so wave 12 is
justified on the product's own terms. **Blocking for wave 12: F1, F2.**
