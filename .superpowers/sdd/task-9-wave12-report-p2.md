# Task 9 — wave 12 report: walker rotation seam (ingest + chain reopen)

Brief: `task-9-wave12-brief.md` (BINDING scope cut). Annex: `consult-chaintruth-walker-rotation.md`
(the full ruling; R/M schedules cited per item below). Law transposed: `task-9-codex-round2.md`
("landing is the only outcome that keeps the starting point") in the `internal/prices/poller.go`
:913-948 deferred-seam shape. Base: start commit `68ccfdb` (wave-11 close + round-11 dispatch;
`f2612e1..68ccfdb` verified docs-only over my surface). Branch `main`, parallel tree —
wave 13 (reconcile) was dispatched mid-wave and runs beside this one; interleavings disclosed below.

**THIS WAVE REOPENS CODEX-APPROVED SURFACE UNDER D-006 — SAY-SO, PLAINLY:**
`internal/chain/chain.go` (senior-approved through the wave 5-9 chain reopen) is touched
ADDITIVELY (two new methods, zero modified lines), and `internal/ingest/walker.go`
(round-1-cleared, additively touched in Task 8 waves 3/5) is structurally reworked.
`cmd/indexer/main.go` is modified in exactly one function. A Codex adversarial round over
this wave is mandatory before any of it is treated as settled; the consult predicted R3 and
R9 as the two regressions Codex would otherwise write — both are in the suite.

| commit | contents |
| --- | --- |
| `10ed6d8` | HARNESS PRECONDITION: per-endpoint fake (`walker_fake_test.go`, prices wave-6 `endpointView` pattern, doFrom walk mirrored), all 21 pre-existing tests ported verbatim and run GREEN against the UNCHANGED walker |
| `b6e7c2f` | chain layer, ADDITIVE: `BlockNumberFrom` / `LogsFrom` (exact wire questions kept, no aggregate propagation) + R8 real-Dial raw-JSON regressions (`chain_from_rawjson_test.go`) |
| `6adfc95` | THE WALKER SEAM (F1+F2 core): endpoint-aware `Chain` interface, `startPref`, one deferred outcome seam, token-coherent windows, retention-not-reset, typed `DiscardError`; regressions R1-R7 (`walker_rotation_test.go`) |
| `d0ed01e` | **THE `cmd/indexer/main.go` MODIFICATION (flagged)**: stepWalkers discard/streak seam + R9/R2-daemon regressions (`walker_discard_seam_test.go`, NEW file — deviation disclosed below) |
| `d6cb441` | mutation spec `.superpowers/sdd/t9w12-mutations/mutations.json` (M1-M7), committed BEFORE the loop |
| `4feecf6` | mutation transcript, **7/7 KILLED**, tested SHA `d6cb441`, in-memory restores verified byte-identical |
| (this commit) | `task-9-wave12-report-p2.md` |

Scope: `git diff --name-only 68ccfdb..4feecf6` restricted to my allowlist =
`internal/ingest/{walker.go, walker_test.go, walker_fake_test.go, walker_rotation_test.go}`,
`internal/chain/{chain.go, chain_from_rawjson_test.go}`, `cmd/indexer/{main.go,
walker_discard_seam_test.go}`, `.superpowers/sdd/t9w12-mutations/**`. Pathspec staging on every
commit; the scope gate accepted each. Interleaved mid-wave (between `b6e7c2f` and `6adfc95`),
none mine, all docs/control-plane, verified by `git show --stat`: `4ece7cb` (W1 claim gen-9),
`325a9cb`/`9d9578c` (owner doc edits), `ffb3235` (round-11 archive + wave-13 brief).

## The flagged deviations (2)

1. **`cmd/indexer/main.go`** — modified as the brief allows: ONLY `stepWalkers` (its body + its
   contract comment). Nothing else in the file: not the pass order, not the conditions
   machinery, not the wiring. The seam: a `*ingest.DiscardError` round takes the failure branch
   (streak grows, backoff paces) and publishes `step_error` with a discard-specific reason;
   plain-error rounds are byte-equivalent to the pre-wave composition (the pre-existing
   stepWalkers tests in `health_test.go` pass unmodified, which is the proof).
2. **`cmd/indexer/walker_discard_seam_test.go` is a NEW file in cmd/indexer**, which the brief's
   file list did not name. Justification: R9 is IN-scope blocking and exercises `stepWalkers` +
   `retryBackoff` + `roundConditions`, all unexported package-main composition — the regression
   can only live in this package. It is a new file: zero collision surface with the sibling
   waves (11 closed; 13 owns `cmd/reconcile/**` and explicitly must not touch `cmd/indexer/**`).
   `health_test.go` (not mine) was NOT touched; the new file reuses its fakes by package
   visibility.

## Verification summary (convention: top-level `^--- PASS` / FAIL / SKIP)

- **Baseline @ `68ccfdb`: 739 / 0 / 0, exit 0**, via `make test-acceptance` — posture: gate ON
  (`SOLVENT_LIVE_RPC_TESTS=1`), `TEST_DATABASE_URL` → `solvent_test`, `.env` DSNs exported
  (`SOLVENT_DATABASE_URL`, `SOLVENT_RECON_DATABASE_URL` → live, read-only evidence tests),
  `SOLVENT_RPC_*` cleared by the target. The target's own gate: "acceptance mode: exit=0
  skips=0". Identical counts to wave-11's final (739/0/0) — consistent, since the interval was
  docs-only.
- **Final @ `4feecf6`: 754 / 0 / 0, exit 0**, same posture, same target — the target's gate
  reported "acceptance mode: exit=0 skips=0" and "acceptance suite green: zero skips". The
  acceptance-mode skip count is EXPLICITLY ZERO, measured by the gate that refuses >0.
- **DISCLOSED INCIDENT — first final-run attempt collided with a concurrent suite:** the first
  final run (same SHA `4feecf6`) exited 1 with 6 FAILs, ALL in `internal/store` — a package this
  wave never touched — with interference signatures (duplicate-PK inserts, foreign unacked
  reorg epochs, a row vanishing mid-test into a nil-deref panic). The parallel wave's executor
  baselines against the same `solvent_test` scratch database; `pg_stat_activity` was quiet on
  re-check and the FULL suite re-run at the same SHA was clean. This is the two-writers-one-
  scratch-DB class, not a code regression; the store package's own serial-writer guard is
  wave-11/13 territory and NOT mine to touch. Both logs retained
  (`/tmp/t9w12-final-suite.log`, `/tmp/t9w12-final2-suite.log`).
- **PASS-list diff, duration-normalized, both directions: 0 removed, exactly 15 added** — all
  15 are this wave's tests (10 in internal/ingest, 3 in internal/chain, 2 in cmd/indexer;
  enumerated in the regression table below; 739 + 15 = 754). Sibling reconciliation (the
  wave-4/-9 interleaving precedent): the interval `68ccfdb..4feecf6` contains no sibling CODE
  commits — the four interleaved commits are docs/control-plane only, verified by
  `git show --stat` — and wave 13 had landed nothing by the final run, so the expectation was
  additions = exactly this wave's tests, zero removals: MET EXACTLY. No pre-existing test
  changed name or vanished; the two behavior-updated tests are in place under their own names
  (`TestTipChangedMidStepAborts` / `TestCursorRecheckMismatchAborts` now assert the typed
  discard — recorded in the adoption record below).
- **-race (brief scope: ingest+chain) in `golang:1.24` via docker: exit 0, 87 / 0 / 0, zero
  DATA RACE** — gate ON inside the container (the live OP-incident chain regression ran and
  passed there too).
- **Build/vet**: `go build ./...`, `go vet ./...` clean at `4feecf6`. **Committed-blob gofmt**:
  all 8 touched `.go` blobs at HEAD extracted via `git cat-file` to temp files — `gofmt -l`
  CLEAN (working-tree `gofmt -l` stays CRLF-noisy repo-wide; the blob check is the bar).
- **Mutation matrix: 7/7 KILLED** through the committed applier (`wave16-mutations/mutate.py`),
  spec committed before the loop (`d6cb441`), tested SHA `d6cb441`, every pattern
  exactly-once-asserted, restores from in-memory copies verified byte-identical, `git status`
  over both mutated files EMPTY after the loop.
- **Environment**: backfill daemon against DB `solvent` left untouched throughout (never
  stopped, never signaled); `solvent-db-1` untouched; tests only ever pointed at `solvent_test`.

## F1 — the seam structure (what shipped, precisely)

**Chain layer (`b6e7c2f`, additive only).** `BlockNumberFrom(ctx, start)` and
`LogsFrom(ctx, start, from, to, addrs)` — plain `doFrom` wrappers in the exact
`HeaderHashFrom` shape (same normalization, same token stamping). The wire questions are
UNCHANGED: `eth_blockNumber` stays `eth_blockNumber` through the wave-8 strict raw-quantity
gate (chain.go's recorded rationale for why the head probe must not become
`eth_getBlockByNumber("latest")` binds these too); `eth_getLogs` keeps the identical filter
through the wave-8 per-log canon gates. NO aggregate outcome propagation
(`doFromAttempts` stays pinned-call-only): the walker advances routing on both failure
postures, so unanimity machinery would be dead weight — the smallest possible reopen.

**Walker (`6adfc95`).** The structure, in the poller's shape:

1. **Resolution**: `Step` resolves its serving endpoint on the FIRST read —
   `BlockNumberFrom(startPref)` → `servedBy`; `startPref` is -1 until first touched, in which
   case the shared hint is READ once (`ActiveEndpoint()`); the hint is never written by
   anything in the package (the interface carries no writer — structural, not conventional).
   `startPref` joins the existing single-writer per-Step field contract: zero new concurrency
   surface.
2. **The one deferred seam**, keyed on a three-state outcome flag whose ZERO VALUE IS
   NON-LANDING: `stepLanded` → `startPref = servedBy.Index` (retention); `stepCaughtUp` → keep,
   unchanged; anything else → `routeNextStepPastNonLanding(servedBy)` = `startPref =
   (servedBy+1) mod n`, with the single-endpoint arm logging "nowhere else to start" instead of
   pretending. A future failure arm gets the advance by NOT setting the flag — never by
   remembering a helper (the per-arm approach missed twice at the poller; not re-run here).
   Deviation from the poller's two-state seam, named: the walker genuinely has a third outcome
   (caught-up — no window attempted, nothing to judge), so the flag is an enum rather than a
   bool; the default remains the advance, so the fail-safe direction is preserved.
3. **Endpoint-coherent Steps**: every read after resolution is `From servedBy.Index` with token
   equality REQUIRED (`coherent()` — one gate, all six read sites: reorg check, tip header,
   logs window, tip recheck, cursor recheck, and both rewind-path probe shapes). Mismatch =
   coherence discard: non-landing, nothing saved. Rider that came for free: the
   tip-log-vs-tipBefore arm is now a SAME-WITNESS contradiction, and the publicnode-403 churn
   tax is paid once per window start instead of silently assembling cross-endpoint windows.
4. **Retention, not reset** (annex Q2.3 verbatim): landing sets `startPref = servedBy.Index`;
   nothing ever resets it to the hint. **Rewind counts as landing** (durable write; its probes
   are pinned and coherence-gated; on any rewind-path incoherence NO Rewind executes).
   **Caught-up keeps the start** — including head-below-confirmations.
5. **Resolution failure** (all endpoints failed the head read) returns BEFORE the seam is
   installed: there is no serving endpoint to route past — the poller's exact shape
   (regression: `TestResolutionFailureLeavesRoutingUntouched`).

## F2 — discards join the failure streak

`(false, nil)` no longer exists as a discard shape. The three discard arms (tip-changed,
cursor-recheck, token-coherence) return `*ingest.DiscardError` — a typed outcome, distinct
from success, caught-up and plain error. At the daemon (`d0ed01e`): a discard round takes
`bo.failure()` (streak grows monotonically toward the 10-minute cap — bounded pacing
preserved) and publishes `step_error` with the reason "ingest window DISCARDED (non-landing) N
consecutive round(s)...". Routing advances via the walker's seam, not via anything here.
Only a genuine landing (batch saved / rewound) or a clean caught-up reaches `bo.success()`.

**Cited law:** Codex task-9 round 3 [medium] — "persistent [failure] involvement neither
resets the backoff streak nor clears step_error"; the round-3 pacing/visibility
recommendation is transposed verbatim as R9. **One interpretive decision, argued:** the
condition KEY stays `step_error` for both postures (the discard is distinguished in the
REASON). The alternative — a separate `step_discard` key — fails R9's own text under a mixed
discard/error outage: the postures alternate round-to-round, so each key would flicker off on
alternating rounds, which is precisely the visibility failure round 3 closed. The brief's
"distinct condition (visible in health)" is satisfied where the operator reads: the reason
names the outcome, and the typed error preserves machine distinguishability end to end.

## Harness precondition — per-endpoint fake adoption record

`walker_fake_test.go` (`10ed6d8`): one PRIVATE `walkerEndpointView` per endpoint (head, hashes,
per-call `headerSeq` with optional stable looping, logs, `down`/`errAt`/`logsErr`/`headErr`,
`canon` = fully-synced-on-the-canonical-chain); From methods mirror `doFrom` exactly —
normalize, rotate on error, stamp the serving token, never touch the hint; absent heights
answer an honest not-found that fails the attempt and rotates (the real adapter's null-result
behavior, pinned by chain_rawjson_test.go — no default hash exists anywhere; fixture-realism
law). Asks are recorded (`blockStarts`/`blockServed`/`headerAsks`/`logsAsks`) so tests assert
the WALKER's routing decisions, not the fake's.

Adoption: all **21** pre-existing tests ported VERBATIM in name/scenario/assertion onto the
fake in the `agreeingChain` posture (two endpoints, full agreement — the single-view world
expressed honestly) and run GREEN against the UNCHANGED walker at `10ed6d8` before any fix
landed (the wave-6 discipline). The old single-view `fakeChain` is retired. At `6adfc95` the
walker's interface changed and exactly TWO of the 21 changed assertion (recorded): the two
discard-posture tests (`TestTipChangedMidStepAborts`, `TestCursorRecheckMismatchAborts`) now
require the typed `*DiscardError` where they previously required `NoError` — that assertion
delta IS F2, stated in each test's comment. The blind bridge methods the unchanged-walker run
needed were removed with the interface they bridged (noted in the fake's own comment).

## Regressions — every schedule item cited

| Schedule | Test | Where |
| --- | --- | --- |
| R1 incident replay (multi-round, custody + routing) | `TestContentFaultAdvancesRoutingAndLandsOnHealthyPeer` | internal/ingest |
| R2 silent-discard split — routing half | `TestSilentDiscardSplitAdvancesRoutingAndLandsOnHealthyPeer` | internal/ingest |
| R2 — daemon streak half | `TestStepWalkersDiscardRoundsGrowTheFailureStreak` | cmd/indexer |
| R3 sibling interference (kills any shared-hint impl) | `TestSiblingLandingOnOffenderDoesNotDragThisStreamBack` | internal/ingest |
| R4 coherence (logs face + header face) | `TestCrossEndpointWindowPiecesAreDiscardedNotSaved` | internal/ingest |
| R5 retention + liveness, n=2 termination trace pinned (`[0,0,0,1,1,1,0]`) | `TestRetentionKeepsLandingEndpointAndRecoveryIsReprobedWithinOneRotation` | internal/ingest |
| R5 single-endpoint leg (no pretend rotation; telemetry captured and asserted) | `TestSingleEndpointNonLandingKeepsStartAndSaysSo` | internal/ingest |
| R6 caught-up keeps start (first half; F4 half not adopted — below) | `TestCaughtUpKeepsTheStartingPoint` | internal/ingest |
| R7 rewind interplay, first half (rewind = landing; F3 half OUT by the cut) | `TestGenuineReorgRewindsAndReingestsFromTheSameStart` | internal/ingest |
| R8 real-Dial raw-JSON, both From methods + start honoring | `TestRawJSONBlockNumberFromEmptyQuantityFailsAttemptAndSecondaryLands`, `TestRawJSONLogsFromMalformedEnvelopeFailsAttemptAndSecondaryLands`, `TestRawJSONFromMethodsHonourTheCallerScopedStart` | internal/chain |
| R9 daemon wrapper, multi-round mixed posture (streak monotone to cap; step_error never flickers) | `TestStepWalkersMixedDiscardErrorPostureNeverResetsPacingOrVisibility` | cmd/indexer |
| (edge) resolution failure ≠ routing change | `TestResolutionFailureLeavesRoutingUntouched` | internal/ingest |

R6's conditional second sentence and R7's second sentence belong to F4/F3 respectively and are
not claimed. The brief's scope line ("R1–R5, R8, R9") is met in full; R6-first-half and
R7-first-half ride along because the brief's own schedule parenthetical names caught-up and
the F1 clause makes rewind-as-landing load-bearing.

## Mutation matrix (committed applier; spec `d6cb441`, transcript `4feecf6`)

| # | mutation | property (stated in spec verbatim) | result | killed by |
| --- | --- | --- | --- | --- |
| M1 | delete the deferred advance | every non-landing outcome advances the start | **KILLED** | R1, R2, R5 |
| M2 | exempt the tip-changed discard arm (forced caught-up) | discards are non-landing (W2M5 reversal transposed) | **KILLED** | R2 |
| M3 | stepWalkers counts a discard as non-erring (reaches bo.success) | discards consume a backoff unit and stay visible | **KILLED** | R2-daemon, R9 |
| M4 | drop token equality (`coherent` accepts everyone) | cross-endpoint pieces never reach SaveBatch | **KILLED** | R4 |
| M5 | the advance defers to the shared hint (`ActiveEndpoint()`) | the advance is caller-scoped, never the hint | **KILLED** | R3 |
| M6 | landing resets startPref to follow the hint | retention, not reset | **KILLED** | R5 |
| M7 | remove the tip-log validation arm | the validation itself is load-bearing custody | **KILLED** | R1 |

Adaptation, named in the spec: the consult's M5 ("write the shared hint on non-landing") is
not compilable as written — the walker HAS no hint-write surface, structurally, which is
itself the design under test — so M5 is realized as the read-through form (the advance defers
to `ActiveEndpoint()`), the routing behavior any shared-hint implementation exhibits and
exactly what R3's schedule kills.

## F4 — decision: NOT adopted; recorded OPEN (implementer discretion exercised)

The rider (caught-up while the stream's durable freshness is red for ≥K rounds counts as
non-landing) is not implemented, for two structural reasons. (1) The freshness verdict is the
DAEMON's, computed by the durable progress pass from the cursor block's header timestamp —
deliberately outside the walker (the deleted head_lag gate's lesson: the daemon must not
depend on a walker's in-memory view, and symmetrically the walker has no honest access to the
durable verdict). Plumbing it in crosses the daemon's pass composition, outside this wave's
stepWalkers-only allowance. (2) A walker-local K-round caught-up counter WITHOUT the freshness
signal advances on genuinely idle chains — healthy caught-up is the steady state for a synced
stream, so the naive form is rotation churn with no defect present. The class is real (Task 7
found it live at the snapshotter, ledger :23) and stays OPEN with the same discipline this
wave's class was recorded with: S5 responsive-frozen endpoint → permanent caught-up stall; no
arm fires; the seam deliberately does not claim it (stated in the `stepCaughtUp` comment and
in R6's test comment). Needs its own clause defining K and the freshness linkage.

## F3 — OUT (controller's cut, complied with)

No rewind corroboration was implemented. What DID land on the rewind path is narrower and
belongs to F1: the rewind's probes are pinned to the Step's serving endpoint with coherence
required, so the destructive Rewind can no longer be authorized by evidence assembled from
two witnesses (that specific ambiguity is closed); the single-witness false-rewind churn class
(S3) remains open pending F3's own ratified clause, as the consult prescribes. The
`rewindToVerifiedAncestor` doc comment states both halves.

## F5 / F6 disclosures (report-only, per the brief)

- **F5**: partial-range silent truncation (successful-but-incomplete getLogs) is UNTOUCHED by
  this wave. Rotation does not and cannot see it; the walker's trust boundary comment still
  discloses it; the detection net remains the wave-10 reconcile aggregate welds. Wave 12
  claims nothing here.
- **F6**: walker successes no longer feed the shared hint (they went through `do()` before;
  they are caller-scoped now). Remaining `do()` consumers — HeaderTime freshness probes,
  TxCalldata, and the poller's default-start READ of the hint — are hint-tolerant by design:
  the hint remains error-driven-rotation state for the shared path, just no longer refreshed
  by walker traffic. Review-note only; no code.

## Unverified / limits

- The seam's behavior under REAL split-backend providers is proven at the fake and raw-JSON
  layers; no live two-endpoint fault-injection run exists (the live gate-ON regressions cover
  the reported-hash law and the new From methods' happy path, not a live content fault).
- The daemon-level interplay of the discard streak with the durable no-progress and staleness
  conditions is asserted only to the extent R9 composes them (`step_error` + readiness); the
  15-minute no-progress bound's interaction with a capped discard loop is argued from
  constants (10m cap < 15m bound), not tested.
- F4/F3 classes remain open, as scoped.
- The first final-run attempt's interference is attributed to a concurrent suite on
  `solvent_test` from observed signatures and the quiet re-check; the colliding process was
  not caught in the act (`pg_stat_activity` was already empty). The clean same-SHA re-run is
  the evidence the attribution rests on.

## Returns to Codex under D-006

This wave reopens approved ingest+chain surface (and one function of the daemon). The
adversarial round should target: the seam's outcome-flag discipline (any return path that
could bypass the defer), the coherence gate's coverage of ALL post-resolution reads, the
retention/liveness pair under adversarial hint movement, and the R9 pacing composition. R3
and R9 — the two regressions the consult predicted Codex would write — are already in the
suite; the round should try to break them rather than re-derive them.
