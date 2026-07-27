# Task 10 — wave 1: anvil-fork replay test (opt-in) — DRAFT, dispatch after the acceptance run

**Calibration (binding, owner 2026-07-27, ledger 2e61277):** demo-grade honest-use bar.
Target: ONE implementation wave + ONE Codex round. Findings requiring a non-honest
actor become disclosed limitations, not fix waves.

Repo `C:/Users/kasel/source/repos/etherfi/Solvent`, branch `main`. Plan authority:
`docs/plans/2026-07-22-solvent-phase2-positions-prices.md` §Task 10 — "opt-in
`ANVIL_FORK_RPC` integration test replaying a covered OP range against a fork and
asserting derived balances vs fork view calls."

## De-risk results (2026-07-27, controller — all PASS, do not re-derive)

- **Toolchain:** Foundry v1.7.1 (commit 4072e48) at `C:/Users/kasel/tools/foundry/`
  (`anvil.exe`, `cast.exe`, `forge.exe`, `chisel.exe`). NOT on PATH — tests must take
  the anvil binary path from env (`ANVIL_BIN` or equivalent), never hardcode.
- **Fork source:** the main dRPC OP endpoint (`SOLVENT_RPC_OP`) serves ARCHIVE state —
  probed `eth_getBalance` at head−2M (block 152,794,575-era) → real balance returned.
- **End-to-end smoke:** `anvil --fork-url <drpc-op> --fork-block-number 154793000
  --port 8546` came up serving exactly the pinned block; `cast call` WETH
  (`0x4200...0006`) `totalSupply()` through the fork returned live state (~2.137e22).
  Startup-to-serving well under 60s on this box.

## Test shape (the wave's deliverable)

- Opt-in integration test: **skips cleanly unless `ANVIL_FORK_RPC` is set** (the plan's
  env contract — the var carries the fork-capable OP RPC URL). CI never runs it; local
  acceptance evidence records it.
- Test spawns anvil (path from env), forks OP at a PINNED block inside the covered
  range (pick from the acceptance-run artifacts once they exist — the OP pin the
  harness echoes is the natural choice), replays/derives against the fork, and asserts
  **derived balances (from the live DB, at that pin) == fork view calls** for the
  golden-vector borrower's engine siblings and a small sampled set (≥3 Debt Manager
  borrowers, mirroring W1 acceptance language).
- Process hygiene: anvil spawned per-test with `t.Cleanup` kill; port chosen
  dynamically or from env to avoid collisions; bounded startup wait with a hard
  timeout; test FAILS (not skips) if anvil dies after the env var opted in.
- **Read-only against the live DB** (same posture as `cmd/reconcile`); never mutates
  daemon state; daemon may be running during the test.

## Scope

Owned: new test file(s) under the package the wave argues is right (likely
`internal/` integration-test home or `cmd/reconcile`-adjacent — justify), `Makefile`
(target), `.env.example` (document `ANVIL_FORK_RPC`/`ANVIL_BIN`), `.superpowers/sdd/**`.
NEVER: `internal/ingest/**`, `internal/chain/**`, `internal/prices/**`,
`cmd/reconcile/**` reviewed code paths (all closed surfaces — additive test-only work).

## Blockers before dispatch

1. Acceptance evidence run must complete (its artifacts pin the OP block this test
   forks; W1 receipts precede Task 10 in the plan's closure order).
2. Owner-present W1 receipt/stamp step is NOT a blocker for this wave (parallel-safe,
   file-disjoint), but the phase-gate half of Task 10 IS blocked on it.
