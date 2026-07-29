# Solvent Phase 3 — Execution Ledger (W2: risk engine + API)

Append-only. Every wave, review round, decision, and transition lands here. Cold-start order:
this file → `docs/plans/2026-07-28-solvent-phase3-risk-engine-api.md` →
`docs/specs/2026-07-28-solvent-phase3-risk-engine-api-design.md` →
`.superpowers/sdd/p3-consults/*.md` → `recon/derivation-notes.md` (NORMATIVE) → D-006/D-012/D-013.

## Standing calibration

- **D-013 binds every review brief** (honest-use correctness, demo-grade; adjudication line
  quoted verbatim in each Codex dispatch). Ratified at P2 (ledger 2e61277), re-affirmed by the
  owner at P3 entry 2026-07-28, promoted to a durable decision in this entry train.
- Serial writer; D-006 Codex approval gate on complex surfaces; per-wave mutation discipline
  carries over from P2 unchanged.
- P3 finish line: built + proven, not deployed (owner decision 2026-07-28).

## Entries

- P3 ENTRY (2026-07-28): Design consults dispatched to the three standing personas (risk-quant,
  oracle-sentinel, chain-truth; fable). Verdicts: risk-quant "numbers do not hold as proposed"
  (3 blockers), oracle-sentinel "provenance breaks as drafted" (BL-1..6), chain-truth "custody
  holds" (conditional, 6 items) — ALL blockers adopted into the spec before any code; rulings
  archived verbatim in `.superpowers/sdd/p3-consults/`. Cross-consult resolution of record:
  params are LEDGER data (chain-truth) — PoolConfigurator stream chosen over pinned-poll
  sampling; risk-quant's poll fallback subsumed into the reconcile weld. Owner approvals this
  session: architecture = riskd + api daemons over pure internal/risk; spec approved ("looks
  good"); Codex pass placed at plan stage (owner asked; controller recommended plan-stage over
  spec-stage — spec already carried three domain-adversarial passes). Plan authored
  (`docs/plans/2026-07-28-solvent-phase3-risk-engine-api.md`, repo-native format, staged like
  P2), self-review fixed three defects (undefined PositionInput, missing ProjectDMDebt, missing
  riskd PG role). Codex plan review dispatched pre-Task-0. W2 object + this ledger drafted for
  the entry train. PENDING: Codex findings → fix inline → entry train (D-013 + spec + plan +
  consults + probes doc + W2 + claim + W1 archive + ROADMAP/STATUS) as ONE coherent snapshot
  under owner ack.
- CODEX PLAN REVIEW ROUND 1 (session 019fab99-baf0-7630-89bd-5e8b8600ad3c): needs-attention,
  7H/1M — ALL EIGHT ADOPTED under D-013 (every finding an honest-use wrong-answer or
  gate-mechanics class; zero hostile-actor findings — the D-013 brief calibration held).
  [H1] entry train violates scope_gate's bootstrap-metadata-only law (VERIFIED
  scope_gate.py:1006) → Task 0 split into roadmap-only commit A + artifacts commit B.
  [H2] W1 "archive" semantics — PARTIALLY REFUTED: `archived` IS a legal work status
  (doctor.py:54) and archived work skips ALL achieved-state re-validation; CONFIRMED half:
  active work's depends_on must be achieved (doctor.py:721) → W1 achieved→archived in commit
  A, W2 depends_on: [] with prose lineage. [H3] configurator stream unrunnable as written →
  dedicated `aave_param` engine wired end-to-end (config enum, decode, indexer, health) +
  atomic RewindParams before epoch ack + harness param-replacement proof. [H4] riskd had no
  durable adapter-output price source (uncapped feed rows would misvalue exactly at cap-bind)
  → ETH poller extended to poll AaveOracle.getAssetPrice per reserve, anchored, provenance
  class `adapter-output`; riskd Aave valuation consumes only that class; reconcile weld added.
  [H5] missing rate-index watermark → per-asset IndexBlock/IndexTime on AaveReserve + DM APY
  observation block, stamped + disclosed; stale-interval test. [H6] price-row identity doesn't
  freeze the input (in-place neutralization/supersession) → batches snapshot FULL numeric
  inputs + disclosures; post-batch mutation regression. [H7] acceptance vacuity → reconcile
  cohort floors (Aave≥20, DM≥25, probes≥10/class, backtest≥25, welds all-reserves) + seeded
  exact-value API suite. [M8] market-depeg had no implementing surface → MarketRealization
  axis + ShortfallResult + pinned HFs-unchanged-AND-shortfall>0 test. Plan+spec+W2 amended in
  place; round 2 re-review dispatched.
- CODEX PLAN REVIEW ROUND 2 (session 019fabb5-d287-7ba1-91ed-9c65bff9bafd; fresh dispatch —
  the companion CLI exposes no resume for review jobs, verified against handleReviewCommand):
  needs-attention; 6/8 round-1 fixes VERIFIED (H1, H4, H5, H6, H7, M8); H2 re-refuted
  correctly, H3 incomplete, +2 new H, +1 new M — ALL FIVE ADOPTED under D-013.
  [H2] archived W1 does NOT protect its receipt: doctor visits every evidence object and
  validate_evidence_receipt unconditionally recomputes current-snapshot fingerprints (VERIFIED
  doctor.py:331-352) → commit A gains a doctor archived-evidence policy (referenced work
  archived/superseded ⇒ skip current-drift comparisons, keep tested-commit-internal checks) +
  selftest both-directions case; the Task 0 files list no longer edits the receipt and no
  longer claims W1 stays achieved. [H3] RewindParams(ctx, chainID, height, epoch) was NOT
  RewindDerived's contract — stacked honest reorgs orphan rows under a green cursor →
  full-contract signature RewindParams(ctx, engine, chainID, toBlock) with deepest-unacked
  target + MAX-epoch ack in one tx + stacked-epoch regression. [NEW-H] W2 invalidated_by
  omitted ALL implementation surfaces (stale-green evidence post-achievement) → expanded to
  internal/{store,risk,derive,prices,decode}/**, cmd/{riskd,api,reconcile}/**, api/**,
  packages/client-ts/**. [NEW-H] adapter-output rows had no durable truthful as-of
  (observed_at/anchor timestamps are DB insert time; PriceObservation carries no chain time)
  → additive prices.source_as_of (poll: pinned anchor-block header timestamp; feed:
  AnswerUpdated.updatedAt); NULL refused for as-of purposes; delayed-insertion test. [NEW-M]
  p3-consults/ was GITIGNORED (the `*` + `!*.md` descendant trap) → .gitignore re-inclusion
  landed + verified check-ignore clean; archives added to W2 deliverables; ls-files gate on
  commit B. Round 3 dispatched.
- OWNER AUTHORIZATION (2026-07-28 19:49, verbatim: "Good work, once this approves let's keep
  things moving"): entry-train execution incl. the commit-A owner ack is delegated,
  CONDITIONAL on the plan review reaching SHIP. Recorded as the delegation basis for the
  CONTROL_PLANE_OWNER_REVIEWED commit, same shape as the P2 stamp-train delegation.
- CODEX PLAN REVIEW ROUND 3 (session 019fabc3-df5e-77e1-809a-8c259c34f1af): needs-attention;
  3/5 round-2 fixes VERIFIED (invalidation scopes, source_as_of incl. all three tests,
  gitignore re-inclusion); H2 correctly held NOT-FIXED (plan prose is not an applied fix) and
  H3 held PARTIALLY (regression geometry non-discriminating — a deepest-target call passes a
  broken implementation). BOTH FIXED AND APPLIED: doctor.py archived-evidence policy
  IMPLEMENTED (validate_evidence_receipt gains historical=...; tested-commit-internal checks
  retained — recorded==tested contract/inputs, ancestry, schema, commands — current-snapshot
  drift comparisons skipped when the referenced work is archived/superseded; evidence-object
  branch passes historical from the referenced work's status) + selftest
  test_archived_evidence_policy with BOTH directions green in the full suite (0 failing:
  evidence:achieved-input-mutation-still-errors, evidence:archived-work-receipt-is-historical);
  commit-A enumeration now names both tool files; RewindParams regression re-specified with
  the discriminating derive_test.go:618-642 geometry (unacked targets 50/80, rows 60/90, call
  with SHALLOW 80, assert row-60 deletion + cursor 50 + acked==MAX). Round 4 dispatched.
