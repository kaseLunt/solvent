# cmd/reconcile and the evidence surface: current state, and where an aave_v4_cash gate plugs in

## 1. How cmd/reconcile is built

- **What it is.** A read-only CLI that runs once. The phase order is mandatory (`cmd/reconcile/main.go:1-27`). Exit codes are 0 pass, 1 verdict fail, 2 precondition, 3 retryable, 4 usage (`main.go:52-58`).
  - **Phase 0**, preflight: `main.go:689`.
  - **Phase 1**, one REPEATABLE READ snapshot holding every DB read: `main.go:925-934`.
  - **Phase 2**, RPC comparisons: a fork weld runs first (`main.go:1005-1030`), then `runDMPhase` / `runAavePhase` (`:1032-1050`), then the P3 "Task-6" gate set inside the before/after weld bracket (`:1052-1100`).
  - **Phase 3**, rewind re-check on a fresh connection, then the weld again (`:1111-1150`).
  - **Phase 4**, `computeResult`, then `writeArtifacts` (`:1152-1170`).
- **The -engine flag.** It accepts `all|debt_manager|aave_v3_etherfi` (`main.go:147`), checked by a closed switch at `:177-181`.
  - Any value other than `all` taints acceptance: "acceptance evidence requires both engines" (`:234-235`).
  - Engine selection is two hardcoded booleans, `wantDM` / `wantAave` (`:787-788`). Each engine is tied to one reader: DM uses `opReader`, Aave uses `ethReader` (`:902`).
  - Pins are keyed by engine (`p3_phase.go:104`) and taken from each engine's derive cursor (`main.go:880-882`, `:997`). The engine constants are at `snapshotdb/snapshotdb.go:82-83`.
- **snapshotdb.** A Phase-1 package whose import list is restricted: the compiler proves it cannot reach the network (`snapshotdb.go:1-50`). `Collect(..., wantDM, wantAave bool, ...)` is at `:491`. The Task-6 derived side is collected in `task6db.go` (`collectTask6` at `:372`); several of its queries hardcode `engine='debt_manager'` (`task6db.go:969-1056`).
- **hf_gate.go** (Aave V3, Ethereum).
  - It declares an input frame (`:158-202`) in which the expected side is `Pool.getUserAccountData(user)@pinHash(P_eth)` (`:190-191`). Indexes and prices are declared as pinned reads (`:180-187`).
  - It recomputes with `risk.ComputeAaveHealth` (`:829`). Exact legs: `totalCollateralBase`, `totalDebtBase`, and `healthFactor` with an explicit marker↔max-uint mapping (`:848-872`). `currentLiquidationThreshold` is gated (`:881`).
  - Evidence only: `availableBorrowsBase` (`:892`). Gated: eMode==0 (`:794`).
  - Census set-equality against the raw_logs candidate universe (`:342`), never-seen probes (`:1121+`), cohort floors (`:1001-1005`).
- **dm_gate.go.** A boolean weld of `liquidatable := borrowingOf.total > getMaxBorrowAmount` (`:1-12`), with three recorded "clock corrections" for sweep-block skew (`:20-60`). `runDMBooleanGate` is at `:229`.
- **backtest.go.** The realized-liquidation backtest over a frozen 31-case frame with four obligations (`:1-27`). It is DM-only: it runs only in the OP-side block (`p3_phase.go:205-210`), and its SQL is DM-specific.
- **Gate plumbing.**
  - Gate IDs: `p3_inputframe.go:53-61`.
  - Input-frame ledger law (undeclared or unconsumed sources become gated failures): `p3_inputframe.go:1-27`.
  - Row schema `p3Row{gate, subject, leg, expected_chain, actual_derived, verdict, gated, ...}`: `p3_registry.go:85-96`.
  - Every family joins one `gatedFailures` counter (`main.go:1092`) and one `tallyTotals` (`main.go:1343-1398`).
- **artifact.go.** Schema `solvent.reconcile.drift-report/v1` (`:27`).
  - The `driftReport` struct has engine-named sections (`dm_rows`, `dm_weld`, `aave_rows`, `aave_weld`, `golden`, `p3_task6`) (`:73-104`).
  - The hash covers a hardcoded list of sections (`:39`). Output is canonical JSON; the default output path is `roadmap/evidence/artifacts/w1-reconcile` (`main.go:162`).

## 2. The committed receipt

`drift-report.json` from run r10: result `pass`; gated 30,838/30,838; 0 drift; 699 advisory; comparison sha `a34d7a53…`; finished 2026-08-02T02:42:31Z. It holds `aave_rows` = 14, `dm_rows` = 29 and 31,429 P3 rows:

| P3 gate | exact | other |
|---|---|---|
| `aave_hf` | 1,143 | 463 evidence |
| `dm_boolean_weld` | 28,606 | 154 sample-gap-disclosed, 200 unscannable |
| realized-liquidation backtest | 623 | 13 evidence |

The receipt `roadmap/evidence/receipts/E-w2-acceptance.md:1-40` restates this and names the command `go run ./cmd/reconcile -rps 1.0 -timeout 120m -rpc-attempts 8`.

## 3. How the API serves it (cmd/api/p5_evidence.go)

- **Loading.** The path defaults to `roadmap/evidence/artifacts/w1-reconcile/drift-report.json` (`:40`), overridable by `SOLVENT_API_RECONCILE_ARTIFACT` (`:46-51`). It is loaded once at startup (`cmd/api/main.go:429`) and served at `GET /v1/evidence` (`main.go:732`).
- **What it reads.** `reconcileArtifact` takes only schema, summary totals, `run.finished_at`, `comparison_sha256`, and the verdicts of `aave_rows` / `dm_rows` (`:283-304`).
- **Welds are hardcoded to two engines**, and each is built from Phase-2 sampled custody rows (`:350-353`). The P3 HF gate's 1,143 health-factor comparisons never become a weld. They only reach the page inside `gated_rows`.
- **Verdict.** `proofSubjectFrom` loops over the welds generically (`:155-159`), so a third weld would automatically join the conjunction.
- **Response shape.** Two subjects, proof and live (`:104-127`, `:163-178`). The notes say "Nothing here is measured at request time" and "A live batch never reads as reconciled-exact" (`:212-214`).
- **OpenAPI.** `ReconcileWeld.engine` is a free string with no enum (`api/openapi.yaml:5811-5818`). The example shows exactly two welds (`:2059-2062`).

## 4. What the Verification page claims, per engine

The page (`web/app/proof/VerificationSurface.tsx`) reads `/v1/evidence`, `/v1/book` and `/v1/meta`.

- **Proof card.** Status: "Accepted · every checked row matched the chain exactly" (`web/lib/evidence.ts:878`). Then one row per weld, `"{engineName} · account comparisons" X/Y exact` (`verification-view.ts:673-680`, `evidence.ts:895-897`).
  - Today that prints "Cash · account comparisons 29/29 exact" and "Aave v3 market (legacy) · account comparisons 14/14 exact".
  - `engineName` knows only those two engines and otherwise prints the raw wire id (`inspector-headline.ts:49-53`).
  - `WELDS_NOTE` says the welds count checked and advisory rows alike (`evidence.ts:916-921`).
- **Verify step.** "N/N checked rows exact" (`verification-view.ts:527-545`, `:338`).
- **Index step.** Reads only the Cash and legacy watermarks (`:406-407`).
- **Compute step.** Counts only the Cash census (`:115-119`).

## 5. Per-batch vs one-shot

There is no per-batch or live verification today. All exactness belongs to the one-shot pinned run:

- "Two subjects, never one… a serving batch does not refresh the proof" (`verification-view.ts:153-159`).
- The live subject is "not covered by the reconcile run" (`evidence.ts:844-847`, `:185-187`), and its marker is "operational" unconditionally (`evidence.ts:1089`, `:1143`).
- The proof pill reads "Proof exact @ {pin}" (`evidence.ts:1073`, `:839-842`).
- The only per-batch evidence is the DM sweep-watermark disclosure (`cmd/api/p5_sweepproof_db_test.go:1-20`). It is not a weld.

## Implications for the V4 design

**Must change**
- Add `aave_v4_cash` to the `-engine` flag help and switch (`main.go:147`, `:177-181`). Reword the "both engines" taint (`:235`). Replace the `wantDM`/`wantAave` booleans (`main.go:787`, `snapshotdb.Collect` `:491`, `runP3Phase` `p3_phase.go:95-98`).
- V4 is on OP but needs its own pin: the generation's hash-pinned block, not a derive cursor (compare `main.go:880`). `rewindMoved` is per-engine (`:551-576`); V4 needs a matching cursor or an equivalent generation re-check.
- Add a `gateAaveV4HF` constant (`p3_inputframe.go:53-61`) with a declared frame. The derived side is the stored generation inputs recomputed the way riskd does it; the chain side is `getUserAccountData` re-read at the generation block hash. A stored copy from the sweeper would count as derived, not as a pinned read.
- If V4 gets its own artifact sections, add them to `hashScope.Sections` (`artifact.go:39`) and to `tallyTotals` (`main.go:1343-1398`). Otherwise they sit outside the hash and the verdict.
- API: add a V4 rows field to `reconcileArtifact` (`p5_evidence.go:298-299`) and a third weld (`:350-353`). Decide whether that weld counts per-account HF rows. Today's welds count custody rows, not HF.
- Web: add `aave_v4_cash` to `engineName` (`inspector-headline.ts:49-53`), the Index step (`verification-view.ts:406`), and the census. Update the OpenAPI example and fixtures (`web/tests/fixtures/generate-proof.mjs:133`).

**Can reuse**
- The p3Row helpers (`compareExact`, `driftRow`, `exactRow`), the frame ledger, cohort floors, never-seen probes, the hash-pinned multicall (`main.go:419`), and the generic weld conjunction (`p5_evidence.go:155-159`).
- The completeness ring (Σ drawnShares == hub) has the same shape as the existing aggregate Σ welds (`dm_weld` / `aave_weld`).

**Would break or conflict**
- A live per-generation weld doesn't fit the two-subject law. The page and API state that the live subject never carries exactness (`evidence.ts:1089`; `p5_evidence.go:214`). Surfacing it needs a new, persisted third kind of evidence with its own wire field and copy. It must not flip the live marker to "proven", and it must be persisted rather than measured at request time.
- The DM-only backtest and task6 SQL (`task6db.go:969+`) have no V4 equivalent. A V4 realized-liquidation backtest would be new work.