---
id: E-w1-acceptance
type: evidence
title: "W1 acceptance evidence: reconcile 87/87 exact + fork replay census + full suite live-db"
status: recorded
work: W1
result: pass
observed_at: 2026-07-28T03:41:00Z
tested_commit: acd3f4192d56a9f78fe420c99c9df0df5a89f3f9
environment: "Windows 11 dev box; Go 1.24; Postgres 16.11 in docker (solvent-db-1, system_identifier 7665718114346942498); live DB `solvent` at goose schema v10 with the daemon RUNNING and ready:true; destructive tests on `solvent_test` (physical-split guard proven); Foundry anvil v1.7.1; RPC: dRPC free tier (ETH+OP) with archive-capable recon endpoints"
contract_fingerprint: sha256:7d11aaf631ccbf55d7684d1f750bb55fb845a9595f89655283b2003403c2d190
input_fingerprint: sha256:23ef2fc850937e5a2328fc519a2aec70b86e3f1067eb8cc851a3baf48fd5c242
commands:
  - "TEST_DATABASE_URL=postgres://solvent:solvent@localhost:5432/solvent_test?sslmode=disable make test"
  - "make reconcile"
  - "make test-fork-replay"
updated: 2026-07-28
---

# E-w1-acceptance — W1 acceptance evidence (2026-07-27 local / 2026-07-28Z)

All three commands executed sequentially at `acd3f41` against the LIVE database with the
daemon running; exit codes captured directly (not inferred).

1. **Full suite (live-db, fork opted in):** exit 0, 12/12 packages ok, zero FAIL lines.
   Store's destructive suite ran against `solvent_test` behind the physical-split guard
   (pg_control system_identifier + database OID + name); the opt-in fork-replay test ran
   (not skipped) via the `.env`-exported `ANVIL_BIN`/`ANVIL_FORK_RPC`.
2. **`make reconcile` (DEFAULT posture — any flag deviation self-taints):** `result: pass`,
   **0 gated failures, 87/87 gated rows exact** (21 advisory rows), `acceptance: true`.
   Comparison sha256 `88c7ef7246c4d61b88dcbb0d2e34bb50f543562647af4a3f19364259b9a441d2`.
   Pins (hash-bound): eth 25,628,676; op 154,805,582; golden-A eth 25,584,990 (the W1
   golden-vector borrower `0x70daaac436465a0d03e45916fa68ddee6086e5fe`); golden-B eth
   25,593,800 (fixture). Covers: golden vectors at pinned AND fresh state, sampled
   borrowers vs direct pinned contract reads (seed = OP pin block hash), the §3.4(b)
   live-value identity (deployed-token ceiling rounding), aggregate completeness welds
   both engines, deep collateral replay, six evidence scans, reorg-epoch gates (snapshot
   + atomic final recheck), DB-identity binding, freshness gate against the
   generation-bound sweep cadence. Artifacts: `roadmap/evidence/artifacts/w1-reconcile/`.
3. **`make test-fork-replay`:** PASS (69.26s). Anvil-forked OP at the earlier acceptance
   run's hash-bound pin 154,796,552 (`0x509cc3ed…478498`); census-gated: 3 borrowers with
   pinned identity+stratum (incl. a migration-genesis account), 3/3 token equalities,
   3 set, 3 sum-vs-total, 3 net cross-checks, 1 pin-hash assertion — all exact.

Review provenance: D-006 program of ~23 adversarial rounds (Tasks 8–10 per-surface closes;
P2 exit whole-branch review + four-round fix train, final verdict SHIP, zero material
findings). Session IDs and disclosed limitations: `.superpowers/sdd/progress-phase2.md`
and the round archives.
