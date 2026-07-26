# Task 9 — wave 10 report: cmd/reconcile + invariant scans (W1 acceptance-evidence harness)

Brief: `task-9-wave10-brief.md` (12-agent synthesis + controller preamble, BINDING in its
entirety) **plus the mid-wave BINDING amendment** from the risk-quant consult
(`.superpowers/sdd/consult-riskquant-wave10.md`, committed `24ad989`, adjudicated `40de9dd`):
F1 (BLOCKING) aggregate completeness welds joined the gated set; F2/F3/F5 folded in this
wave; F4/F6/F8 carried as named notes (see §Amendment). Base: start commit `bf9db2a` (the
brief commit; `40de9dd` landed mid-wave, docs-only). Branch `main`, serial tree.

| commit | contents |
| --- | --- |
| `24ad989`/`40de9dd` | (controller, mid-wave) risk-quant consult + adjudication — disclosed, docs-only |
| `2d475b9` | THE IMPLEMENTATION: `cmd/reconcile/` (16 files), `internal/store/reconcile.go` + `invariants.go` + 3 test files, additive `chain.HeaderTimeFrom` |
| `dc6782b` | mutation spec `.superpowers/sdd/t9w10-mutations/mutations.json` (19 entries / 20 mutants), committed BEFORE the loop; + `schemaGateOK` extraction so the schema-gate mutant is unit-killable |
| `725026e` | `t9w10-mutations/transcript.md`, **20/20 KILLED**, tested SHA `dc6782b` |
| (this report's commit) | `task-9-wave10-report-p2.md` |

Scope: `git diff --name-only bf9db2a..HEAD` = `cmd/reconcile/**` (new), `internal/chain/chain.go`
(additive `HeaderTimeFrom` only), `internal/store/{reconcile,invariants}.go` + 3 test files (new),
`.superpowers/sdd/t9w10-mutations/**`, this report. **Plus three working-tree files the scope
gate BLOCKED from committing — see §Blocker.**

## §Blocker (STOP-and-report per the brief's scope note)

`docker-compose.yml` (db-init one-shot service provisioning `solvent_test`), `.env.example`
(TEST_DATABASE_URL → `solvent_test` + SOLVENT_RECON_* documentation), and `Makefile`
(`db-up` runs db-init; new `reconcile` target with the exit-2 bare-shell hint) are
**implemented and verified in the working tree but UNCOMMITTED**: the pre-commit scope gate
refused them because `roadmap/claims/CLAIM-claude-integrator.md` is **generation 7, issued
2026-07-25 — before the W1 allowed_paths amendment** — and its committed authority list
(scope_hash-bound) lacks the three paths, though the W1 work object carries them. Per the
brief ("if the scope gate still refuses a path, STOP and report — do not work around") I did
not bypass the hook, did not edit the claim, and did not stage them. **Controller action:
reissue the integrator claim against the amended W1 scope, then `git add docker-compose.yml
.env.example Makefile` commits cleanly** (contents are final and verified below). Everything
else in the wave proceeded — no other deliverable depends on those three files being
committed.

## Verification summary (convention: top-level `^--- PASS` / FAIL / SKIP)

- **Baseline @ `bf9db2a`: 633 / 0 / 0** — gate ON (`SOLVENT_LIVE_RPC_TESTS=1`),
  `TEST_DATABASE_URL` → `solvent_t9w1` (pre-split posture). Identical to wave-9's final.
- **Final @ `dc6782b` code state (post-`1c62a6b` tree, code bytes identical): 726 / 0 / 0,
  exit 0** — gate ON, `TEST_DATABASE_URL` → `solvent_test` (post-split posture),
  `SOLVENT_RECON_DATABASE_URL` → the LIVE `solvent` database **read-only** so the evidence
  tests run instead of skipping (zero `SKIP` strings in the whole verbose log). Posture
  stated both runs; both runs' full verbose logs retained in the session scratchpad.
- **PASS-list diff, both directions: 0 removed, exactly 93 added** — all 93 are this wave's
  tests, enumerated in the transcript of the diff (no pre-existing test changed name or
  vanished).
- **Bonus live signal from the zero-SKIP posture**: all five gated invariant scans + the
  advisory Aave scan ran against the LIVE mid-backfill database (single-statement
  consistency, read-only session enforced and itself tested) and returned **zero
  violations** — scans 1–5 hold on the real data as of this run. This is NOT the acceptance
  evidence run (controller work), just an early health signal.
- **-race in `golang:1.24` via host.docker.internal** (own scratch DB `solvent_t9w10race`,
  same env posture): result recorded below in §Race.
- **Build/vet**: `go build ./...` and `go vet ./...` clean. **Committed-blob gofmt**: all 26
  committed `.go` blobs extracted via `git cat-file` to temp files — `gofmt -l` CLEAN.
- **Mutation matrix: 20/20 KILLED** through the committed applier
  (`wave16-mutations/mutate.py`), spec committed before the loop, restores verified
  byte-identical, `git status` clean after (§Mutations).

## Design § → test/verification map (every § cited or deferred-with-reason)

**§0 Phase architecture.** `cmd/reconcile/main.go` `execute()` drives Phase 0 (preflight, no
snapshot) → Phase 1 (`phase1.go`: ONE `pgx.Conn`, `BEGIN ISOLATION LEVEL REPEATABLE READ
READ ONLY`, ALL DB reads, COMMIT before comparisons) → Phase 2 (`phase2.go`, sequential OP
then ETH) → Phase 3 (fresh-connection rewind re-check + weld re-run) → Phase 4 (artifact +
verdict). Never calls `AcquireWriterLock`/`Migrate` — reconcile uses raw `pgx` + the Querier
functions, never a `store.Store`; the session itself is forced
`default_transaction_read_only=on` (`readOnlyDSN`, `TestReadOnlyDSNInjectsSessionOption`) and
the evidence connection's inability to write is itself asserted live
(`TestInvariantEvidenceConnectionIsReadOnly`). One disclosed nuance: the pin-hash/pin-time
header reads (the seed default needs the OP pin hash before the sampling query) are the ONLY
RPC inside Phase 1 — two headers per chain, seconds, disclosed in the phase doc.
**Live Phase-0 smoke** (the brief-permitted smoke, nothing further): `--help` exit 0;
DSN-tripwire negative run against the real env → **exit 2 with the brief-verbatim message**
("test and live DSNs identical; physical split required (see runbook §DB-split)", identity
`solvent@172.19.0.2/32:5432` both sides); `-engine debt_manager -preflight-only` → **exit 0
"preflight OK"** (schema gate at 8, cursor read, OP chain-id verify, pinned `borrowingOf`
shape probe SERVED at the OP derive cursor, head-lag within 30m — incidentally proving the
daemon is near-head on OP). ETH archive probes were NOT run live (no archive key available
to this agent — see §Unverified).

**§1 Environment and DB safety.** (1) Physical split: `solvent_test` created in the running
container via `docker exec CREATE DATABASE` (no restart — container uptime continuous
through the wave), the whole store suite then ran green against it; AND the compose path
verified: `docker compose up -d db-init` ran the new idempotent one-shot against the EXISTING
healthy db service (db-init exit 0, `solvent-db-1` untouched at "Up 44 hours") — **both
paths verified** (file uncommitted per §Blocker; behavior verified from the working tree).
(2) Tripwire: `checkDSNSplit` compares LIVE `DatabaseIdentity` of both DSNs (connects, never
string-parses; unverifiable test DSN fails CLOSED), verified live (exit 2 above) and killed
as mutant W10M14. (3) Evidence tests gate on `SOLVENT_RECON_DATABASE_URL`, read-only
session, never Migrate, hazard header verbatim (`invariants_live_test.go`); falsifiability
helper additionally refuses a database literally named `solvent`. (4) Runbook sequencing:
recorded here (§Receipt-sequencing) for the controller's receipt.

**§2 Sampling.** SQL verbatim-adapted in `store.SampleDMBorrowers` (one `::text` cast added
to `md5($2::text || …)` for parameter-type resolution); classified population + precedence
partition + determinism pinned by `TestSampleDMBorrowersStrataPrecedenceAndDeterminism`
(db); precedence mutant W10M16 killed. Go-side selection (`sampling.go`): quotas 9/8/8=25
(`TestSelectSampleQuotasAndLiveFirst`, `TestQuotasForRaisesRoundRobin`), live-first with
zero-net phantom probes, residue priority ≥3 with take-all-degradation never exit 2
(`TestSelectSampleResiduePriority`, `TestSelectSampleResidueDegradesNeverFails` — L0-9),
shortfall backfill in fixed order (`TestSelectSampleShortfallRedistribution`), determinism
(`TestSelectSampleDeterminism`), forced includes deduped on top of quota with the 3 DM
anchors + liquidation Safe as pinned literals and net-normalized provenance constants
recorded in the artifact's sample section (`TestSelectSampleForcedIncludesOnTopAndDeduped`),
`-include` and `-accounts` replay (`TestFileSampleBypassesSampling`). Population
preconditions in `execute()`: genesis SEED-ROW count == 7,337 (`COUNT(*)`, never distinct —
`TestCountReconRowsSubAssertions` pins the rows-vs-distinct split surfacing), empty-stratum
tripwire, borrower count > 0 — all exit 2 with artifact written.

**§3.1 Pin choice + welds.** P = derive cursor read INSIDE the snapshot; `-pin-*` overrides
refused above the cursor with the disproof-clause citation (exit 2). No lag-based
serveability inference exists anywhere; `-max-head-lag` is a pure staleness QUALITY gate
(flag text says so). Welds: greatest raw_logs ≤ P hash vs live header, PLUS ingest-cursor
hash when a stream of the engine sits exactly at P (L0-10), run after snapshot commit
(before comparisons) AND re-run in Phase 3 (L1-8); a failed weld is exit 3 with aborted
artifact. Weld logic `phase1Data.runWeld`; the DB side is snapshot-scoped. Exercised through
fakes at the phase level; no dedicated weld unit test — the SQL side is
`ReconHighestLogAtOrBelow` (Querier twin of the tested `HighestLogAtOrBelow`), and the
comparison is four lines; stated as a conscious residual (§Unverified item 6).

**§3.2 As-of mechanics.** `store.AsOfEventSums`: SUM(delta) ≤ P by (account, asset, side),
inclusive boundary and genesis inclusion pinned (`TestAsOfEventSumsIncludesMigrationGenesisAndBoundary`;
mutants W10M2/W10M3 killed). NUMERIC → `pgtype.Numeric` → `NumericToBigInt`: no float path
ever; the brief's "Exp == 0 asserted loudly" is enforced at VALUE level — pgx's binary codec
normalizes integral values into (Int, Exp≥0) base-10 exponents, so Exp≥0 is rescaled exactly
and Exp<0 (genuinely fractional) is refused loudly (`TestNumericToBigIntRefusesFractions`);
deviation-with-reason recorded (§Deviations 1). Internal-inconsistency cross-check:
`EventBalanceInternalCheck` (FULL OUTER JOIN, strict IS DISTINCT FROM, fold predicate on the
ev side), gated, class `internal_inconsistency`
(`TestEventBalanceInternalCheckLocalizesMismatch`).

**§3.3 Debt Manager.** Proxy resolved from `op:debt-manager` Addresses[0]
(`resolveContracts` — nothing hardcoded). `borrowingOf(address)` one-arg token-set graft
with pinned zero-trim on BOTH sides + per-token bridge + Σ==total
(`compareDMRow`: `TestCompareDMRowZeroTrimSetEquality` both directions — subset mutant
W10M4 killed; `TestCompareDMRowSumAgainstTotal`). Bridge = `mulDivFloor`, contract-cited,
recon triple reproduced bit-exact + floor/ceil edge (`TestMulDivFloorBridge`, W10M1) +
injectivity at I=1e18 and 1e18+1 (`TestBridgeInjectivityEdge`); the injectivity sentence is
emitted verbatim into `summary.injectivity`. Multicall: ≤15/chunk
(`TestMulticallChunksAtFifteen`), in-band block == P asserted per chunk with exit-3 abort
(`TestMulticallInBandBlockAssertion`), per-chunk endpoint recorded, no single-endpoint
assertion.

**§3.4 Aave.** Assets keyed by underlying reserve address everywhere; aTokens resolved from
the four `eth:atoken-*` streams, variable debt tokens via
`Pool.getReserveVariableDebtToken(reserve)` AT THE PIN. Scaled comparison bit-exact
(`TestCompareScaledBitExact`); live-value identity via local `rayMulHalfUp` (WadRayMath
half-up, discriminating boundary case `TestRayMulHalfUp`; `TestLiveValueIdentity`), gated at
0. Golden borrowers gated at fresh P_eth (both vectors run at head); top-10 by |scaled
debt| labeled supplementary, never gated (F4 carried as note, §Amendment).

**§3.5 Tolerance policy.** Zero, bit-exact, every gated row. `-tolerance-dm-wei` nonzero
structurally forces `fail-with-tolerance` (`computeResult`,
`TestNonzeroToleranceCannotProducePass`, mutant W10M18) and taints acceptance
(`TestAcceptanceTaints`). **`--allow-residue-tolerance` DELETED per amendment F2** — replaced
by the exact residue hypothesis (below). Classification labels (`residue-shaped` |
`missing-genesis` | `index-class` | `internal_inconsistency` | `stable-snap-suspect` |
`unclassified`) are diagnosis only — every class fails (`classifyDMMismatch`,
`TestClassifyDMMismatchPrecedence`). Second opinion: different endpoint index, both answers
recorded; single-endpoint / failed / fell-back-to-first-opinion all yield "no second opinion
available" — never corroboration (`secondOpinion`, `TestSecondOpinionHonesty`, L1-9).

**§3.6 Index integrity.** APY sourced from position_events PAYLOADS (borrow_apy_set.new_apy
/ borrow_token_config_set.borrow_apy; `store.LatestAPYObservation`,
`TestLatestAPYObservationOrdersAcrossBothPayloadSources`) — never the never-written
rate_indexes borrow_apy kind. Recurrence `recomputeIndex` = one mulDiv floor
(`TestRecomputeIndexRecurrence`); dt from `HeaderTimeFrom` (the additive, token-routed chain
method — the ONLY internal/chain change; endpoint disclosed per read in the rpc log).
Verdict table: `no-iiu-history` not gated (never a vacuous pass), `unrunnable-missing-apy`
gated fail when sampled debt exists, exact/mismatch gated, SEPARATE verdict class
(`evaluateIndexCheck`, `TestEvaluateIndexCheckVerdicts`).

**§4 Golden dual-pin.** `golden_vectors.json` (go:embed, provenance blocks) validated
against the fixed pins and both borrowers' constants (`loadGoldenVectors`,
`TestLoadGoldenVectorsPinsAreFixed`); pin overrides taint acceptance. Row A = live pinned
read at 25,584,990, proven BY RECORDED CALLS + value provenance
(`TestGoldenRowAIsALiveChainReadAtTheW1Pin`; mutant W10M12 killed) and by the inverse arm
(`TestGoldenRowAFailsWhenDBDisagreesWithTheLiveRead` — a DB matching fixture constants at
the W1 pin FAILS). Row B three-way weld with per-leg localization
(`TestGoldenRowBLocalizesTheLyingLeg`). Row C interval quiescence gated
(`TestGoldenRowCCountsIntervalEvents`). Archive miss → state-pruned → exit 2 naming
endpoint, never skipped/fixture-substituted (`TestGoldenArchiveMissSurfacesAsPinnedFailure`).
Cursor < vector block → exit 2 precondition (`execute()`). Honest note (first empirical
Aave validation, engine-defect-first adjudication) — carried in this report and in the
freshness/artifact notes for the controller's receipt.

**§5 CLI, store contract, classifier.** All flags per brief (plus `-preflight-only`, the
smoke mode; deviation §Deviations 4); `-sample` ≥25 floor with `-allow-small` taint
(`TestParseFlagsValidation`, `TestAcceptanceTaints`). Store API: `store.Querier` interface
exactly as specified; every new store function takes it explicitly; identical answers
through pool and tx (`TestQuerierContractPoolAndTx`). Exit codes 0/1/2/3/4 wired through
`runAbort`. Classifier `rpcclass.go`: three buckets + 403 capability + transport-other,
bucket table (`TestClassifierBucketTable`; "method not found" ≠ block-not-found), pruned
never throttle (W10M9), pruned only after the FULL bounded budget with a
success-mid-budget arm (`TestRunnerPrunedOnlyAfterFullBudget` — the load-balancer wrinkle),
403 terminal immediately with zero backoff (`TestRunnerAll403IsTerminalImmediately`), 429
backoff with jitter (`TestRunnerRetriesThrottleWithBackoff`), token bucket
(`TestLimiterPacesCalls`), every attempt's endpoint + class into the artifact
(`TestRunnerLogsEveryAttempt`). Schema gate exact both directions (`schemaGateOK`,
`TestSchemaGateIsExactBothDirections`, W10M15). Env bootstrap: `config.Load` with the
"run via make reconcile or export .env" hint; SOLVENT_RECON_RPC_* override with
SOLVENT_RPC_* fallback, env-var provenance (never URLs) recorded in `run.rpc_source`.
`make reconcile` exists (§Blocker file).

**§6 Invariant scans.** SQL as package constants in `internal/store/invariants.go`, executed
by (a) reconcile inside the RR snapshot (`runInvariantScans` → artifact `invariants`
section), (b) evidence tests (read-only, live DB), (c) falsifiability tests — all through
the same exported Querier functions. Scan 1 (W1 pre-gate clause cited in doc):
falsifiability + healthy-shape kill (`TestInvariantScan1DistinctHashFalsifiability`, W10M6).
Scan 2 (post-gate bullet cited): strict IS DISTINCT FROM, **WIDE ev predicate per amendment
F3** (delta-only; the fold-predicate divergence is named by the SidelessDeltaBearingRows +
NullAssetDeltaBearingRows sub-assertions in `CountReconRows`, gated in the reconcile
verdict), all three orphan classes + snapshot-source exclusion + amount-0 health
(`TestInvariantScan2EventSumFalsifiability`, W10M5 + W10M5b). Scan 3 (post-gate bullet
cited): monotone non-decreasing, equal allowed, Aave kinds in a SEPARATE advisory scan that
cannot fail it (`TestInvariantScan3BorrowIndexFalsifiability` proves both scopes, W10M7).
**Scans 4–5 added per amendment F5** (event→raw_logs referential integrity incl. seq
fan-out health; same-block-IIU coverage with residue/migration exclusions):
falsifiability (`TestInvariantScan4EventLogOrphanFalsifiability`,
`TestInvariantScan5IIUCoverageFalsifiability`, W10M19) + evidence twins. Evidence mode:
population-first with `RequireDataVerdict` escalation
(`TestRequireDataVerdictEscalation`, W10M8); canonical receipt command in the live-test
header comment verbatim from the brief. All six evidence tests PASSED against the live DB
in the final-suite posture (zero violations, populations logged).

**§7 Freshness.** Registry LEFT JOIN (never-swept VISIBLE, L0-6), sampled-gate/fleet-advisory
split with the named threshold, NULL last_success_at fail-closed, never-succeeded classes
(`evaluateFreshness`, `TestEvaluateFreshnessGateAndFleet`). Bound: auto =
max(2×interval, 2×last_pass_seconds) from the SAME durable column the daemon uses, labeled
**policy** per F7 (`freshnessBound`, `TestFreshnessBoundIsPolicyMax`). Zero-collateral
conditional (L2-12: absence never misread; `TestZeroCollateralConditional`).
Source-exclusivity probe through the snapshot (`ReconBalancesFor`,
`TestReconBalancesForSourceConflict`). Spot read report-only with the reason on the row
(`TestBuildSpotReadRowIsReportOnly`). Deep replay: sweeper-identical folding
(`TestFoldCollateralOfMatchesSweeperSemantics`), bit-exact both directions vs the snapshots
HISTORY row (`TestCompareCollateralReplayBitExactBothDirections`), gates only when served —
state-pruned degrades to report-only with class + depth (`runDMPhase`), never exit 1/2
alone. F8 registry-exclusion note carried in the freshness section verbatim (asserted in
`TestEvaluateFreshnessGateAndFleet`).

**§8 Rewind detection.** Baseline (acked_epoch + last_block per engine, MAX(reorg_epochs)
informational) in the snapshot; Phase-3 re-check on a FRESH connection: acked_epoch
unchanged AND last_block ≥ P (`rewindMoved`, `TestRewindMovedIsPruneImmune` — the exact
rewind+ack+prune scenario with MAX unchanged; mutant W10M11 killed); movement → exit 3,
artifact `status:"aborted: rewind during run"`; welds re-run in the same phase.

**§9 Artifacts.** `drift-report.json` schema `solvent.reconcile.drift-report/v1`, canonical
serialization (sorted keys, json.Number round-trip — 77-digit values survive byte-identically;
`TestCanonicalJSONSortsKeysAndPreservesBigNumbers`, `TestArtifactRedeployStable`). Embedded
`comparison_sha256` over the NAMED hash scope (sections + redacted volatile keys listed in
the artifact itself): stable across routing/second-opinion/run-metadata noise, moved by any
comparison value (`TestComparisonHashIgnoresRoutingNoise`). `drift-report.txt` rendered from
the same struct; ABORTED line 1 + JSON status on aborts (`TestAbortedRunStampsBothFiles`).
Never a `.md` (`TestArtifactsAreNeverMarkdown` — L2-6). Sections per brief: run (git
commit via buildinfo, resolved seed — `TestArtifactEchoesResolvedSeed`, W10M13 — cmdline,
config sha256, db name, rpc env provenance, derive-lag), pins with weld before/after,
cursors incl. acked start/end, counts (incl. genesis rows vs distinct + price_source census
per F6), sample, dm_rows/dm_weld/dm_index_check, internal_inconsistencies, aave_rows/
aave_weld, golden, freshness/spot/replay, invariants, rpc, summary.

**§Receipt-sequencing (for the controller).** Suite-green evidence (`go test ./...`) against
`solvent_test`; reconcile + `SOLVENT_RECON_DATABASE_URL=$SOLVENT_DATABASE_URL
SOLVENT_INVARIANT_REQUIRE_DATA=1 go test ./internal/store -run 'TestInvariant' -count=1 -v`
against the live DB; DB names (no credentials) into the receipt's environment; artifacts +
receipt committed TOGETHER, then `doctor.py --receipt-basis W1 --snapshot <that commit>`,
then stamp. Path dependency: `roadmap/evidence/**` commits under the integrator claim's
`roadmap/**` authority, not W1's own allowed_paths.

## §Amendment (binding, folded in; consult file cited)

Per `.superpowers/sdd/consult-riskquant-wave10.md` (24ad989) and the controller's amendment
message:

- **F1 (BLOCKING) — DONE, gated.** DM: Σ ALL-accounts derived net normalized per token
  (`store.AssetNetSums` — deliberately NO account parameter,
  `TestAssetNetSumsHasNoAccountFilter`) == `borrowTokenConfig(t).totalNormalizedBorrowingAmount`
  @ pinHash(P_op), zero bound, union of key sets, migration-era seeding caveat NAMED on
  every row (`weldDMAggregate`, `TestWeldDMAggregateZeroBoundAndUnion`); verdict class
  `aggregate-mismatch`, exit 1. Aave: Σ derived scaled == `scaledTotalSupply()` per debt
  reserve GATED, aToken collateral weld ADVISORY first run (`weldAaveAggregate`,
  `TestWeldAaveAggregate`). Sample-coverage diagnostic recorded per token. **(c) named
  mutation kill: W10M17 / `TestComputeDMWeldInputsCoversAllAccounts` — KILLED.**
- **F2 — DONE.** `--allow-residue-tolerance` deleted; `residueShaped` = fully-liquidated ∧
  no residue_zeroed for the exact (account, token) (`store.ResidueZeroedAssets`,
  `TestResidueZeroedAssetsPerToken`) ∧ floor((n−1)·I/1e18) == amount bit-exact —
  derived-high-only, magnitude exactly one normalized wei, no tunable anywhere
  (`TestResidueShapedExactHypothesis`, W10M10).
- **F3 — DONE.** Scan 2 ev predicate kept WIDE with the fold-predicate divergence named by
  the `SidelessDeltaBearingRows` sub-assertion (+ NULL-asset twin), gated, commented with
  the fold citation.
- **F5 — DONE (two gated scans).** Scan 4 (referential) + scan 5 (same-block IIU) as above.
  The full-history index recurrence sweep is **ADVISORY-DEFERRED with reason**: rate_indexes
  carries no header times, so the sweep needs per-block header reads (hundreds of RPC calls
  against the shared budget) — deferred; the single-interval §3.6 recurrence at P is
  implemented and gated, and the deferral is stated in the artifact's invariants note.
- **F4 (note carried):** gated Aave census = the two golden borrowers; top-10 is labeled
  advisory; liquidation/deficit/regime-A paths have NO gated per-account coverage this wave
  — named here and in the artifact row labels. The F1 scaledTotalSupply weld partially
  compensates (any per-account miss that moves an aggregate surfaces); per-account Aave
  strata remain future work per the controller's adjudication.
- **F6 (note carried + taxonomy):** `stable-snap-suspect` classification exists
  (hypothesis label, still fails); borrow price_source census in counts
  (`TestCountReconRowsSubAssertions`); detection limit stated in the census field's doc.
- **F7 (done):** bound labeled `policy` in inputs and artifact.
- **F8 (note carried):** registry-exclusion statement in the freshness notes, asserted by
  test.

## §Mutations (committed applier; spec `dc6782b`, transcript `1c62a6b`)

20/20 KILLED at tested SHA `dc6782b` (transcript committed `725026e`); exactly-one-occurrence
asserted per edit; in-memory restores verified byte-identical; `git status --porcelain` over
all 7 mutated files EMPTY after the loop. `TEST_DATABASE_URL=solvent_test`,
`SOLVENT_LIVE_RPC_TESTS` unset.

| id | target (brief §10 / verification bar / amendment) | killed by |
|---|---|---|
| W10M1 | bridge floor→ceil | TestMulDivFloorBridge |
| W10M2 | migration_genesis dropped from as-of predicate | TestAsOfEventSumsIncludesMigrationGenesisAndBoundary |
| W10M3 | as-of boundary <= → < | TestAsOfEventSumsIncludesMigrationGenesisAndBoundary |
| W10M4 | set equality → subset | TestCompareDMRowZeroTrimSetEquality |
| W10M5 | scan 2 IS DISTINCT FROM → = | TestInvariantScan2EventSumFalsifiability |
| W10M5b | scan 2 zero-sum allowance re-added | TestInvariantScan2EventSumFalsifiability |
| W10M6 | scan 1 HAVING >1 → >=1 | TestInvariantScan1DistinctHashFalsifiability |
| W10M7 | scan 3 comparison inverted | TestInvariantScan3BorrowIndexFalsifiability |
| W10M8 | REQUIRE_DATA escalation removed | TestRequireDataVerdictEscalation |
| W10M9 | pruned misfiled as throttle | TestClassifier* + TestRunnerPrunedOnlyAfterFullBudget |
| W10M10 | residue class without fully_liquidated | TestResidueShapedExactHypothesis |
| W10M11 | rewind check trusts MAX(reorg_epochs) | TestRewindMovedIsPruneImmune |
| W10M12 | golden Row A → fixture comparison | TestGoldenRowA* (both) |
| W10M13 | seed not echoed | TestArtifactEchoesResolvedSeed |
| W10M14 | DSN tripwire disabled | TestDSNTripwireDetectsSameDatabase |
| W10M15 | schema gate → >= | TestSchemaGateIsExactBothDirections |
| W10M16 | strata precedence inverted | TestSampleDMBorrowersStrataPrecedenceAndDeterminism |
| W10M17 | F1 weld over sampled accounts only | TestComputeDMWeldInputsCoversAllAccounts |
| W10M18 | tolerance guard removed | TestNonzeroToleranceCannotProducePass |
| W10M19 | scan 5 loses the repay arm | TestInvariantScan5IIUCoverageFalsifiability |

## §Race

`docker run golang:1.24 go test -race ./...` via host.docker.internal against
`solvent_t9w10race` (fresh scratch DB), gate ON, recon evidence pointed read-only at the
live DB: **all 10 packages ok, exit 0, zero FAIL, zero DATA RACE** (cmd/reconcile included
— its first -race exposure).

## §Deviations (each with reason)

1. **"Exp == 0 asserted loudly" → value-level integer assertion.** pgx v5's binary NUMERIC
   codec represents integral values with positive base-10 exponents (1e6 can arrive as
   {Int:1, Exp:6}); a literal Exp==0 assertion would false-alarm on legitimate integers.
   `NumericToBigInt` rescales Exp≥0 exactly and refuses Exp<0 (fractional) loudly — the
   brief's intent (no float path, integers only, loud failure) holds; tested.
2. **Retry-After not honored** (brief §5 asked for it): geth's `rpc.HTTPError` carries
   status + body only — no headers survive the pinned client. Bounded exponential backoff
   with jitter (429-only) is the whole policy, stated in the code comment.
3. **Comparison-hash scope interpretation**: the brief says "deterministically-serialized
   comparison sections" without enumerating; freshness/spot/replay/cursors are excluded
   (wall-clock ages, routing volatility) and the scope + redacted keys are DECLARED inside
   the artifact (`hash_scope`), so a reviewer sees exactly what the hash covers.
4. **`-preflight-only` flag added** (not in the brief's flag list): the wave needed a smoke
   that provably exits before Phase 1; it runs Phase 0 verbatim and stops.
5. **`-engine != all` taints acceptance** (my addition): a single-engine run cannot back
   the two-engine acceptance claim; recorded rather than silently permitted.
6. **No dedicated unit test for `runWeld`'s 4-line hash comparison** (§3.1 note above); the
   store side is the Querier twin of tested code. Stated plainly rather than padded.
7. **Second opinion re-reads the drifted token's two-arg `borrowingOf(user,token)`** rather
   than the full one-arg array — one comparable value, both answers recorded; the full-array
   re-read would burn budget for no additional verdict information.
8. **Phase-0 aborts (exit 2/4 before the snapshot) write no artifact** — there is nothing
   collected yet; every abort at Phase 1+ writes both files with the aborted stamp.
9. **R-001 risk-file update NOT made**: `roadmap/**` is controller-owned in this wave's
   scope (the brief's key-files line predates that restriction); the controller's gate
   results are already recorded in the preamble and ledger.
10. **Scope-gate blocker on the three DB-split files** — §Blocker above; not worked around.

## §Unverified (stated plainly)

- **The full Phase 1→4 pipeline has NOT run end-to-end against the live database** — that
  is the controller's evidence run by design (brief: "you do not run the acceptance
  evidence"). Phases are verified by unit tests over fixture-real fakes (pruned rejections,
  429 storms, wrong-height chunks, lying endpoints) plus the live Phase-0 smoke.
- **ETH deep-pin archive preflight not live-verified by this agent** (no archive-capable
  key in this environment; the controller's own gate runs — Alchemy serving both pins —
  stand as the evidence). The in-tool probe path is tested via fakes
  (`TestGoldenArchiveMissSurfacesAsPinnedFailure`, `TestRunnerPrunedOnlyAfterFullBudget`).
- **DM index-integrity live numbers** (real idx_b/apy/dt against `getCurrentIndex@P`) await
  the evidence run; only the arithmetic and verdict logic are proven here.
- **Aave collateral weld exactness on real data** (advisory first run per amendment) —
  expected exact, unproven until the evidence run.
- The wave-9 report's known non-blocking doc typo (19 vs 35 mutation runs) remains untouched
  — controller's later doc pass.

## Environment safety accounting

The backfill daemon and `solvent-db-1` were never stopped or restarted. Live-DB access this
wave was read-only and enumerated: the tripwire smoke's two identity SELECTs, the preflight
smoke's cursor/schema reads, and the final-suite evidence scans (read-only session enforced
by `default_transaction_read_only=on` and itself asserted by a test). Live RPC this wave:
one `mainnet.optimism.io` regression dial per suite run (the pre-existing gate-ON test),
plus the preflight smoke's ~6 OP calls. No getLogs anywhere. `-race` and mutation loops ran
against scratch databases (`solvent_t9w10race`, `solvent_test`); `solvent_t9w1` remains as
the pre-split baseline DB, unused going forward.
