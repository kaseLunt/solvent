# Task 10 — wave 1 report: opt-in anvil-fork replay test

Dispatch: task-10-wave1-brief.md. Calibration: demo-grade honest-use, one wave.
Worked at HEAD 38b1b46 (Task 9 closed). Nothing committed or staged — controller integrates.

## Deliverables (exactly the owned scope, nothing else touched)

1. **`internal/forkreplay/fork_replay_test.go`** — new test-only package holding
   `TestForkReplayDMBorrowers`.
2. **`Makefile`** — new `test-fork-replay` target (+ `.PHONY`), mirroring the
   `reconcile` target's .env-exported style. `test-acceptance` untouched.
3. **`.env.example`** — `ANVIL_BIN` and `ANVIL_FORK_RPC` entries, one-line comments.

Not touched: internal/ingest, internal/chain, internal/prices, cmd/reconcile,
cmd/indexer, config, .env, .github, and **zero store changes** — the existing
surfaces fit (see decision 2).

## What the test does

- **Skip gate:** skips with a named reason unless BOTH `ANVIL_FORK_RPC` and
  `ANVIL_BIN` are set. After opt-in, every problem `t.Fatal`s — missing
  `SOLVENT_DATABASE_URL`, anvil startup timeout (120s hard bound), wrong fork
  hash, RPC/DB errors. Never a post-opt-in skip.
- **Anvil:** spawned from `ANVIL_BIN`, forked at the pin on a dynamically
  reserved localhost port, combined output captured (mutex-guarded buffer,
  race-clean), `t.Cleanup` kill + bounded wait; early process exit fails with
  the captured output.
- **Chain truth:** fork pinned at OP block **154,796,552**; the test reads the
  PROVIDER-REPORTED `eth_getBlockByNumber` hash (internal/chain's posture —
  never a local header recompute) and requires it equal the hardcoded
  `0x509cc3ed…478498`. Env override `ANVIL_FORK_PIN_BLOCK`+`ANVIL_FORK_PIN_HASH`
  allowed TOGETHER only — an overridden block never runs without its own hash bound.
- **DB:** live DB via `SOLVENT_DATABASE_URL`, session forced
  `default_transaction_read_only=on` (mirrors cmd/reconcile and
  invariants_live_test.go); no Migrate, no Store construction; daemon-safe.
- **Borrower rule (deterministic, documented in the package comment):**
  `store.SampleDMBorrowers(pin)` → keep `Live` (net ≠ 0 as-of pin) → sort by
  `AccountHex` ascending → first 3 (the three lexicographically-smallest
  borrower addresses with nonzero derived debt at the pin).
- **Derivation:** `store.AsOfEventSums("debt_manager", accounts, pin)` (existing
  as-of surface), side="debt" per asset; bridged =
  `floor(net × getCurrentIndex(token)@pin / 1e18)`.
- **Assertions per borrower:** per-token bridged == `borrowingOf(user)` amount
  through the fork; nonzero-token SET equality (contract assembly-trims to
  nonzero, so the DB side is zero-filtered identically to compareDMRow); Σ
  per-token == reported total. Plus per-net non-negativity (documents
  Quo-as-floor validity) and pinned selectors.

## Decisions + justifications

1. **Package `internal/forkreplay`:** cmd/reconcile is a closed surface;
   internal/store is DB-only (an anvil process manager doesn't belong there); a
   fresh test-only package imports store's read surfaces and touches nothing
   closed. `go build ./...`, `go vet ./...`, `go test ./...` all handle the
   test-only package cleanly (verified).
2. **No new store methods.** `SampleDMBorrowers` (fully deterministic SQL —
   `ORDER BY stratum, live DESC, account`) + `AsOfEventSums` cover selection and
   derivation exactly as cmd/reconcile uses them. Additive-only clause not needed.
3. **Real ABI from the allowlist:** parses `recon/abis/DebtManagerCore.json`
   (Foundry artifact, `"abi"` key). `borrowingOf` is overloaded and go-ethereum
   mangles one overload's map key, so methods are selected by RawName + input
   arity, then selector-pinned to `0x186c66cc` (borrowingOf(address)) and
   `0x64752eec` (getCurrentIndex) — the same values lens_abis_test.go keccak-pins
   — so a wrong or drifted ABI file cannot silently change what is called.
4. **Rounding law:** the DM live-debt bridge is **floor**
   (`DebtManagerStorageContract.sol:520-522`, the identity validated bit-exactly
   in derivation-notes §Debt identity validation). The **CEILING** law
   (derivation-notes §Aave, corrected 2026-07-27) governs the AAVE debt token's
   scaled→live projection on ETH — a different engine with a different deployed
   rounding. This fork is OP/DM-only, so floor is engine-exact here; the package
   comment explicitly forbids porting either rounding across engines.
5. **Free-tier upstream reality (mid-wave find + fix):** the first opted-in run
   FAILED live — dRPC's free plan returns HTTP 408 under anvil's cold
   storage-fetch burst inside `borrowingOf`. Fix, two layers: anvil spawn flags
   `--compute-units-per-second 300 --timeout 45000 --retries 10
   --fork-retry-backoff 1000` (throttle + absorb queueing), and a BOUNDED
   per-view retry (5 attempts, 2s backoff) in the test. Retrying is not
   skipping: anvil caches every fork slot fetched before an error, so attempts
   make monotonic progress; exhausting the bound still FAILS loudly.

## Test results

- **Skip path:** `go test ./...` with ANVIL vars unset — **all 12 packages ok**
  (exit 0), forkreplay skips with the named reason
  `opt-in anvil-fork replay (Task 10): ANVIL_FORK_RPC and ANVIL_BIN unset…`.
  Re-run green after the final edits.
- **Opted-in live run** (`ANVIL_BIN=C:/Users/kasel/tools/foundry/anvil.exe`,
  `ANVIL_FORK_RPC` = the dRPC OP entry from `.env`'s `SOLVENT_RECON_RPC_OP`,
  live `SOLVENT_DATABASE_URL`): **PASS in 31.84s**.
  - Pin-hash assertion: 1 (fork reported exactly `0x509cc3ed…478498` at 154,796,552).
  - Borrowers (the rule's picks): `0003d7bf…c3b5` (**migrated** stratum, total 1),
    `00075e7f…faae` (post_migration, total 1), `000a46d0…e153` (post_migration,
    total 10,400,057 USD-6dec).
  - **3 token equalities (all exact), 3 set equalities, 3 sum-vs-total
    equalities, 1 pin-hash assertion** — 10 gating assertions, all passed, plus
    3 non-negativity guards and 2 selector pins. The migrated-stratum borrower
    matching exactly incidentally re-proves genesis-snapshot coverage through a
    fork, not just through an archive RPC.
- **Hygiene:** `tr -d '\r' < internal/forkreplay/fork_replay_test.go | gofmt -d`
  → empty; `go vet ./...` clean; `go build ./...` clean; live run's retry path
  race-guarded (syncBuffer) though `-race` was not run (not requested).

## Flags for the controller (honest notes)

1. **Brief fact correction:** the dRPC endpoint is the **second** entry of
   `SOLVENT_RECON_RPC_OP` in `.env` — the first is `mainnet.optimism.io`. I used
   the dRPC entry (the brief's substantive designation); the run PASSed on it.
2. **Acceptance-mode interaction (decision needed, out of my scope):**
   `make test-acceptance` fails on ANY `--- SKIP`. A future acceptance run
   without `ANVIL_BIN`+`ANVIL_FORK_RPC` exported will fail on this test's skip.
   The acceptance recipe does NOT unset `ANVIL_*` (only `SOLVENT_RPC_*` /
   `SOLVENT_RECON_RPC_*`), so exporting both in `.env` makes acceptance run the
   fork test for real — which matches the brief's "local acceptance evidence
   records it". I did not touch `test-acceptance`.
3. **Unverified paths:** the wrong-hash failure arm and the pin-override
   both-or-neither guard are code-reviewed but not live-exercised; first live
   run's 408 failure proved the RPC-error arm fails loudly as specified.
4. `gofmt -l .` (`make fmt`) lists many PRE-EXISTING files on this CRLF working
   tree — unchanged by this wave; the new file is not among them.

---

# Wave 1b — Codex round-22 fixes (1 high, 2 medium, all ACCEPTED)

Base: HEAD 7f8c42e (wave 1 landed). All three findings fixed inside
`internal/forkreplay/fork_replay_test.go` only; nothing else touched, nothing
committed or staged.

## F1 [high] — vacuous token comparisons → now structurally impossible

- **Nonempty-set gates:** every selected borrower must have a NONEMPTY derived
  nonzero-debt token set AND a nonempty chain `borrowingOf` set before any
  comparison counts; an empty union fails by name instead of comparing two nil
  sets equal.
- **Net cross-check:** per borrower, Σ retained per-asset as-of sums must equal
  the sampled row's own `Net` — a Live row whose deltas were discarded by the
  per-asset retention (empty asset / wrong side) FAILS instead of vanishing.
- **Gating census:** under the default pin, `tokenAsserts` must equal the
  fixture's `defaultExpectedTokenAsserts = 3` via `require.Equal` — gating, no
  longer merely logged. (Override path: census not pinned, but the nonempty-set
  gates still force ≥1 token assertion per borrower.)

## F2 [medium] — DB can no longer select its own subjects

- **Default pin fixture:** `defaultExpectedBorrowers` pins the three account
  hexes AND strata from the verified wave-1 runs — `0003d7bf…c3b5:migrated`,
  `00075e7f…faae:post_migration`, `000a46d0…e153:post_migration` — and the
  sample must resolve to exactly those accounts with those strata, rank by
  rank. A migration_genesis regression that evicts an expected borrower now
  fails by name instead of silently re-picking.
- **Override path:** `ANVIL_FORK_PIN_BLOCK` + `ANVIL_FORK_PIN_HASH` +
  `ANVIL_FORK_EXPECT` (acct:stratum,×3) are required as a TRIPLE; any partial
  override is refused — never silently sampled.

## F3 [medium] — fork credential can no longer leak through anvil output

- `sanitizeForkOutput(s, forkURL)`: exact fork-URL replacement first (covers
  anvil's Endpoint banner), then regex redaction of URL userinfo
  (`scheme://user:pass@` → `scheme://<redacted>@`), credential-shaped query
  params (`api[-_]?key|apikey|dkey|key|token|secret|auth|password`), and long
  opaque path segments (Alchemy-style `/v2/<key>`, ≥20 chars).
- Wired into EVERY sink: both startAnvilFork Fatals (early-exit incl. the exit
  error itself, startup timeout) and callView's retry Logf/Fatalf (anvil relays
  upstream provider errors verbatim — the observed 408 path).
- **Regression test `TestSanitizeForkOutputRedactsSecrets`:** pure unit, NOT
  opt-in-gated, runs in every `go test ./...` — synthetic secret in banner,
  userinfo, opaque-path, query-param and prefix-extended forms must not
  survive, in both the known-URL and empty-URL arms.

## Wave-1b verification

- `tr -d '\r' < fork_replay_test.go | gofmt -d` → empty; `go vet ./...` clean.
- Env-free run: `TestForkReplayDMBorrowers` SKIPS with the named reason;
  `TestSanitizeForkOutputRedactsSecrets` PASSES (proving it is not gated).
  Full `go test ./...` green (all 12 packages).
- **Opted-in live run via `make test-fork-replay`** (ANVIL vars from .env):
  **PASS in 50.18s** (one 408 retry absorbed; its logged error text passed
  through the sanitizer). Assertion census, all gating:
  **3 borrowers, 3 token equalities (census-gated: 3), 3 set equalities,
  3 sum-vs-total equalities, 6 fixture account+stratum equalities, 3 net
  cross-checks, 1 pin-hash assertion** — fixture matched exactly
  (0003d7bf…/migrated, 00075e7f…/post_migration, 000a46d0…/post_migration;
  totals 1, 1, 10,400,057 USD-6dec, unchanged from wave 1).
- Unverified: the override-triple refusal arm and the selection-drift failure
  arm are code-reviewed, not live-exercised (exercising them needs a second
  hash-bound pin fixture).
