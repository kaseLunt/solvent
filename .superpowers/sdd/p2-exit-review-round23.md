# P2 exit review — round 23 (D-006 clause 2: whole-branch Codex + standard reviewer)

- **Tree:** HEAD `2cbe3c4`, both legs pinned/read there.
- **Codex leg:** tree-level holistic task (not a diff review), session
  `019fa615-9ca3-7ba2-a1c7-0b96c32f4e83`, job `task-ms3wpntm-q3hcre`, ~18m,
  132 files. **Verdict: needs-attention — 2 high, 1 medium, 4 low.** All findings are
  NEW tree-level items; no component finding reopened. Static-only (sandbox denied
  go test temp dir).
- **Standard leg:** maintainability/docs/hygiene pass. 1 high, 1 medium; everything
  else explicitly checked-and-fine (README truthful, deps tidy, no dead code/TODOs,
  conventions consistent, panics are init-time ABI guards only).

## Codex findings (compressed; verbatim in the session record)

1. **[high] Reconcile can certify while a reorg epoch is unacknowledged.** Window
   between the walker's rewind commit (store.go:356-393) and the runner's ack
   (derive.go:198-229) — consecutive daemon passes (main.go:2551-2562), durable across
   a crash. Reconcile reads MAX(epoch) informationally only; pins from the unchanged
   derive cursor; final check detects only ack MOVEMENT or cursor-below-pin. Honest-use
   vacuous green. Fix: `acked_epoch >= MAX(epoch)` gates inside the repeatable-read
   snapshot AND at final recheck; keep the movement check.
2. **[high] Task 10 plan-vs-delivered:** the plan (§477, §605-607) and W1 (§47-57)
   require the fork replay to exercise the WALKER/RUNNER pipeline over a covered
   range; delivered test compares already-derived DB state vs fork view calls. Census
   real and useful; vacuous FOR THE PIPELINE-REPLAY LEG it claims to satisfy.
   Implement or formally amend before exit.
3. **[medium] W1 canonical test command fails by construction:** exports
   TEST_DATABASE_URL=/solvent then `go test ./...` — the wave-10 destructive guard
   fatals on the live name. Fails safe, but an honest operator following canonical
   text gets an immediate embarrassing failure. Must be /solvent_test +
   SOLVENT_DATABASE_URL.
4. **[low] Rewind can recreate snapshot history for an orphaned account:**
   RewindDerived deletes history (derive.go:565-591) but Runner.rewind leaves
   pendingOrder/pendingSet (runner.go:430-458) → later flush inserts an EMPTY
   debt-history document. Balances/reconciliation unaffected; hygiene claim false.
5. **[low] Normative doc drift:** migration seeds described as `(address,uint256)[]`
   in recon+plan vs the validated parser's `abi.encode(address[],uint256[])` parallel
   arrays; recon precision bullet still uniform-half-up vs the delivered regime A/B
   law; plan retains the 15,289,230 liquidation digit typo.
6. **[low] Stale half-up comment survived round 21** at lens_abis.go:133-135 (round-21
   "none remain" claim was aave.go-scoped — new evidence against the ledger wording).
7. **[low, known] W1 deliverables glob blocks the stamp** — already queued, correctly
   disclosed, not a dropped disclosure.

**No new finding:** migration-chain coherence 00001→00010; config/ABI/deployed-reality
coherence (address book independently confirmed; selectors recomputed); disclosed-
limitations ledger complete (all four discoverable).

## Standard-leg findings

- **[high] cmd/indexer/main.go: 2,644 lines, no orientation comment** — composition
  root mixed with 5 separable domains; the repo's own cmd/reconcile (11 headed topic
  files) and the indexer's own 8-topic test suite demonstrate the partition. First
  file an evaluator opens.
- **[medium] .env.example under-documents config.Load:** SOLVENT_SNAPSHOT_INTERVAL,
  SOLVENT_PRICE_INTERVAL, SOLVENT_HEALTH_ADDR missing.

## Adjudication (honest-use demo-grade; owner consulted 2026-07-27 ~17:40)

| # | Verdict | Disposition |
|---|---------|-------------|
| C1 epoch gate | ACCEPTED | fix wave dispatched (reopens cmd/reconcile + store read surface; returns to Codex) |
| C2 fork replay leg | ESCALATED | owner deciding implement-vs-amend (tradeoffs delivered; controller recommends amend given Task 9's full-history backfill exercised the real pipeline) |
| C3 W1 canonical command | ACCEPTED | rides the owner-present stamp step (same W1 edit train as the glob fix) |
| C4 rewind pendings | ACCEPTED | in the C1 fix wave (small, regression-tested) |
| C5 doc drift | ACCEPTED | FIXED this commit (recon 3 sites, plan 3 sites, ERRATUM convention) |
| C6 lens_abis comment | ACCEPTED | in the C1 fix wave |
| C7 W1 glob | known | task #9 (stamp step) |
| S1 main.go split | ACCEPTED, owner-approved | behavior-identity wave dispatched (declaration-set identity proof required) |
| S2 .env.example | ACCEPTED | FIXED this commit |

Phase close holds until: C1 wave + Codex re-verification, S1 wave verified, owner's C2
decision recorded, stamp step complete.
