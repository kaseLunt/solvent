# Deriver-lifecycle wave report (consolidated Codex-review completion)

Implementer: fable. Scope: `internal/derive/**`, `internal/decode/events.go` (one doc note),
`recon/derivation-notes.md` (erratum annotation only). Mandate: the two convergent Codex senior
reviews (019f8dfd-a9dd-7e50-950b-48b188048733 Aave / 019f8e04-f2b2-7fb3-81c7-2d81bb11b71e DM) —
both engines mathematically approved; this wave supplies the state lifecycle between in-memory
derivation and persisted rows, plus the four named hardening fixes.

## Commits (pathspec, on main)

| SHA | Message | Files |
|---|---|---|
| `7eafe37` | feat: attempt-scoped deriver state lifecycle with committed-truth hydration | engine.go, aave.go, debtmanager.go, aave_test.go, debtmanager_test.go, lifecycle_test.go |
| `9d164c4` | fix: same-tx index requirement, tx-aware regime boundary, window pinning, deficit ordering | aave.go, aave_test.go |
| `6f1c27c` | fix: configured-stable borrow conversion, typed terminal errors; erratum corrections | debtmanager.go, debtmanager_test.go, rpc_fixtures_test.go, decode/events.go, dm_golden_liq fixture, recon notes |

## Fix 1 — attempt-scoped state lifecycle (critical/high, BOTH engines)

- `derive.Engine` amended exactly per the mandated shape (controller-authorized unfreeze; the
  FROZEN comment now documents the BeginBatch → Process* → ApplyDerived → Commit/Discard and
  RewindDerived → Reset contract). `StateReader` is satisfied by `*store.Store` AS-IS
  (`var _ StateReader = (*store.Store)(nil)` compile check; no store API change, no adapter).
- Both engines: two-layer state. PROMOTED layer mirrors committed truth, hydrated lazily per
  account on first touch through the reader — the Codex "map absence" objection is answered
  mechanically: absence in COMMITTED state means zero because derivation always starts at genesis;
  there is no in-memory seed map anywhere. WORKING layer is a per-account copy-on-write overlay;
  CommitBatch promotes, DiscardBatch drops (hydration writes survive discard by design — they
  mirror committed truth). Reset drops everything; next BeginBatch re-hydrates.
- Old paths deleted: `NewDebtManager` lost its `priorNormalized` seed-map parameter; Aave's
  implicit-zero first-touch is gone (every touch goes through hydration). Rates/index caches and
  same-tx markers are batch-scoped too (never hydrated: same-tx RDU requirement / same-block IIU
  requirement re-establish them in any replayed range; rewinds are block-aligned).
- DM's migration calldata fetch now uses the batch context (previously context.Background()).

Tests (`lifecycle_test.go`): restart-equals-continuous over the committed golden fixtures for BOTH
engines — continuous vs 3 commits vs discard+retry-in-the-middle vs Reset-mid-stream+re-hydration
from a fake reader carrying the committed fold — all four produce identical PositionEvents and
identical final state (post-Reset state checked as an exact subset: untouched accounts live in the
store, absent from memory). Codex's drift example as a test: i = 6RAY/5, hydrated s = 4, Mint
transition to 5 — delta is exactly 1 (the naive rayDivCeil(Value, i) = 2 amplification is the
asserted counterfactual). Failed-persistence retry: identical events, no double-mutation (golden
and synthetic variants). Hydration-once-per-lifetime-until-Reset; reader errors surface (never a
silent zero); lifecycle guards (Process outside batch, double Begin, nil reader/ctx).

## Fix 2 — same-tx RDU requirement (high, Aave)

`aaveReserveRates` now carries (block, txHash, logIndex). Every indexed action — Borrow, Repay,
LiquidationCall (paired AND unpaired; LiquidationLogic :573 always precedes :425-434) — requires
the cached RDU to share ITS OWN tx hash and precede it in log order; violations wrap the exported
`ErrMissingSameTxIndex`. DeficitCreated is deliberately EXEMPT (index-free zero-out; its reserve's
RDU follows it in-tx — all four historical deficits confirm, fixture-checked). Fixture sweep run
during implementation: all 266 action events satisfy the requirement, zero violations. Negative
tests: older-tx RDU + own-RDU absent; same-tx RDU after the action; none at all; repay/liq gating.

## Fix 3 — configured-stable conversion + typed terminal errors (high, DM)

`dmStableBorrowDecimals`: USDC/USDT 6-dec (usd = amount), frxUSD 18-dec (usd = amount/1e12 with a
mandatory exactness check — remainder ⇒ loud data error, never a floor). Non-stable borrow tokens
(liquidUSD, EURC, weEUR, liquidRESERVE×2) wrap exported `ErrUnsupportedBorrowToken` — the
errors.Is-matchable TERMINAL capability error (runner: mark unhealthy, do not retry; gate fires
before the index join). Tests: USDT fold + repay round-trip, frxUSD exact + 1-wei-remainder
refusal (asserted NOT errors.Is the capability sentinel), EURC/liquidUSD terminal matches.

## Fix 4 — window pinning + boundary tx-awareness (medium, Aave)

(a) `tokenMathRegime(block, logIndex)`: regime B applies at 23088584 only from logIndex 542 (the
weETH aToken's Upgraded log) onward. `TestAaveRegimeBoundaryBoundToFixture` binds both constants
to the committed fixture bytes (block/index/address/impl-topic/governance-tx). Regime tests now
cover before-block / before-log-542 / at-log-600 / after-block.
(b) **Window pinning: ARCHIVED, not pending.** eth.drpc.org served archive state for all eight
capture points (publicnode refused — archive behind a token). cast `scaledBalanceOf`, 2026-07-23:
- `0xe17b347b…` vUSDC 474724123 @24371584 → 0 @24371585 (full repay, log 324)
- `0xe17b347b…` vFRAX 9991129357032481316289 @24371594 → 0 @24371595 (full repay, log 534)
- `0xbd0c6f59…` vUSDC 998962552 @24788837 → 530542774 @24788838 (partial repay, log 1020)
- `0x5280be3a…` vUSDC 2302612 @24466430 → 0 @24466431 (deficit+liq pair, logs 587/596)
`TestAaveWindowPinnedArchiveScaledDebt` asserts all eight against the derived fold (end-of-block
state = Σ deltas with block ≤ B); vToken addresses resolved from the data provider
(vUSDC 0x9355032d747f1e08F8720CD01950E652eE15cdB7, vFRAX 0xfd3aDA5AAbdc6531C7C2AC46c00eBf870f5a0E6B).
The unverified-Pool caveat in the package comment now lists archive pinning as leg (d).
(c) False order-independence claim corrected: package comment states the pairing is exact only in
the DEPLOYED deficit-first order, and the deriver enforces it — same-tx LiquidationCall followed
by DeficitCreated for the same (user, debtAsset) is a loud error (+ test).

## Fix 5 — sweep

- BalanceTransfer fan-out: per-event payload maps (+ aliasing test).
- Impossible-state detector: Mint/Burn with BalanceIncrease > 0 on a ZERO tracked balance errors
  in both regimes (interest cannot accrue on nothing) — defense-in-depth under hydration (+ test).
- `decode.ATokenBurn` doc: two-regime note added (regime-A formula as written; regime-B Value =
  previousBalance − nextBalance, citing derive/aave.go).
- `dm_golden_liq_ac5f3ce9.json` provenance and the rpcfixtures generator template + Logf:
  15,289,230 → 15,289,260.
- `recon/derivation-notes.md`: figure corrected to 15,289,260 (both occurrences in the sentence)
  with the mandated inline `[ERRATUM 2026-07-23: …]` bracket note; nothing else touched.

## Verification (final gates, all on 6f1c27c)

- `gofmt -l internal/derive/ internal/decode/` → empty.
- `go vet ./...` → clean; also clean with `-tags rpcfixtures`.
- `go test ./internal/derive/ -v` → **ALL PASS pristine: 77 test runs (53 top-level + 24
  subtests), 0 failures.**
- **Golden integrity: bit-exact, untouched.** Aave golden full-history replay (125415 /
  58420665095130 / 83 / 7045575913579, deficit zero-outs, 138/103/25/4/314 counts) and all four DM
  golden vectors (963813→1004681, 3985789485→4154797137, 7153773→7457111, liq −15289260→view
  15845260) pass with the exact pre-wave numbers; determinism replay byte-identical.
- Full `go test ./...` green with live TEST_DATABASE_URL (store suite included).

## Concerns / notes for reviewers

1. The restart-equals-continuous Reset scenario compares post-Reset promoted state as a SUBSET of
   the continuous engine's state (untouched committed accounts are deliberately absent from
   memory); event-stream equality is asserted in full. This is the semantically correct check —
   flagging in case reviewers want a store-backed full-equality harness instead.
2. Paired LiquidationCall now VALIDATES the same-tx RDU (deployed order guarantees it) without
   consulting the value — strictly more refusals than before, zero golden movement.
3. CommitBatch/DiscardBatch are no-ops outside a batch (interface returns no error there); misuse
   of Process outside a batch is the loud path.
4. drpc archive coverage was the only free endpoint that served the window blocks; if drpc ever
   prunes, the eight pinned values live in the test as committed constants with full provenance.

## Round 2

Adjudicated findings from Codex session 019f8e3a-f94c-70c2-96a1-82b1182c5f05; implementer: fable.
Commit: `fix: reset-on-ambiguous-commit contract, contract-faithful stable floor conversion, honest
window claim` (pathspec: internal/derive + the phase-2 plan).

### Fix 1 [high] — indeterminate-commit reconciliation (contract, not store)

ApplyDerived returns `tx.Commit(ctx)` verbatim (store/derive.go:259): the error can surface AFTER
Postgres committed, so DiscardBatch would preserve pre-batch promoted memory (and hydration marks)
against an advanced store + cursor — silent desync. Fixed at the CONTRACT: engine.go's lifecycle
doc now mandates **any ApplyDerived error → Engine.Reset(), never DiscardBatch** (Reset drops all
layers; the next BeginBatch re-hydrates committed truth — correct whether or not the tx landed);
DiscardBatch is reserved for failures the runner KNOWS never reached ApplyDerived (Process error
mid-batch). Matching wording fixed in both engines' CommitBatch/DiscardBatch docs and the
lifecycle_test scenario-3 comment; the plan's Task 7 runner bullet carries the exact rule. New
`lifecycle_live_test.go` (real store, live db, schema-isolated `derive_lifecycle_live` so
`go test ./...`'s concurrent store-suite TRUNCATEs can't race it):
- `TestIndeterminateCommitResetRehydratesExact` — batch applied through the real store, commit
  LANDS, runner simulates the observed-error path → Reset → BeginBatch(real reader): committed
  truth (balance 100, cursor 100) re-hydrates exactly; the full-balance repay folds bit-exact and
  1 USD more is refused; the recovered lifecycle continues to a clean second commit (balance 0).
- `TestIndeterminateCommitDiscardDesyncs` — same landed commit answered with DiscardBatch: engine
  memory 0 vs committed 100 asserted UNEQUAL (the pinned hazard), and the truth-valid full repay
  is refused ("negative").

### Fix 2 [high] — contract-faithful frxUSD floor conversion

The deployed borrow path prices via convertCollateralTokenToUsd — `amount * price / 10^decimals`
with Solidity FLOOR division (verified in recon/cash-v3 `DebtManagerCore.sol:378`, reached from
`borrow()` at :468) — so the prior remainder-rejection spec refused valid events. borrowUsd's
18-dec arm is now `floor(amount/1e12)` (guard DELETED); dmStableBorrowDecimals doc cites the
contract lines. Test converted: `TestBorrowFrxUSD18DecFloorConversion` folds 5e18+1 frxUSD wei
SUCCESSFULLY → usd 5,000,000 (floored), delta ceil-normalized as usual.

### Fix 3 [high→documented invariant] — out-of-band stable snap

Adjudicated posture implemented: (a) every Borrowed position event's payload now records
`"price_source": "stable_snap_1e6"` (`dmPriceSourceStableSnap`); (b) the invariant is documented
on borrowUsd — the snap assumption is EMPIRICALLY ENFORCED by golden bit-exactness + Task 9's
≥25-borrower derived-vs-borrowingOf reconciliation (any historical out-of-band borrow surfaces as
a mismatch); (c) forward guard = the runner's standing Task 9 health reconciliation. Deliberately
NO per-event refusal (would freeze on valid in-band events). Borrow tests assert the new payload
key; no golden expectation moved (payload addition only, per the mandate's carve-out).

### Fix 4 [medium] — narrowed window claim

aave.go's unverified-Pool caveat and the window test's doc now claim exactly: the window is
OUTCOME-PINNED for all observed actions (sandwich + verified vToken + golden replay + 8 archive
points), but the floor-vs-half-up question is UNDISCRIMINATED by the observed events — all three
window repays produce identical results under both rules (Codex verified) and the deficit pair is
index-free — so the regime-B rule is an assumption inherited from the verified v3.5 successor impl
via the sandwich, not a discriminated fact. No stronger claim remains anywhere.

### Verification (round-2 gates)

- `gofmt -l internal/derive/` → empty; `go vet ./...` clean (also with `-tags rpcfixtures`).
- `go test ./internal/derive/ -v` → ALL PASS pristine: **79 runs (55 top-level + 24 subtests), 0
  failures** (77 pre-round + 2 new live tests).
- Golden integrity: **bit-exact unchanged** — all Aave and DM golden assertions pass with the
  exact pre-round numbers; the ONLY event-shape change is the added borrow-payload
  `price_source` key (specified exception).
- Full `go test -count=1 ./...` green with live TEST_DATABASE_URL — derive and store live suites
  ran concurrently, proving the dedicated-schema isolation.

### Concerns

1. The live tests exercise the DM engine only; the Aave engine shares the identical
   promoted/working/hydration mechanics, so the contract rule is engine-generic — flagging in
   case reviewers want a mirrored Aave live pair.
2. The desync contrast test pins one concrete divergence direction (stale-low memory refusing a
   truth-valid repay); the cursor-advanced/re-derive double-apply direction is prevented by the
   same rule but not separately staged.
3. `price_source` is asserted as the literal `"stable_snap_1e6"` in tests (pins the persisted wire
   value against accidental constant renames).
