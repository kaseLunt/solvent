# Mutation transcript — Wave R2 (correctness): Finding A + Finding B

Durable mutation evidence for two blockers:

- **Finding A** — `/v1/book` served `aave_v3_etherfi.liquidatable_positions: 0`
  while the SAME payload's histogram counted 3 accounts below HF 1.00 and its
  bad-debt census reported `eligible_positions: 3, insolvent_positions: 3`. Root
  cause: `assembleAave` never wrote `liquidatable`, so every Aave row of every
  batch carried NULL, and `aggregate` counted only `true`.
- **Finding B** — the SSE client sent a non-CORS-safelisted `Cache-Control`
  request header that the API's `Access-Control-Allow-Headers` did not permit, so
  the browser preflight failed and the live layer never connected.

Both defects shipped under a fully green suite. The mutants below therefore have
a second job beyond proving the new tests bite: M1 and M3 restore the EXACT
pre-fix source, so their red tails are this wave's red-first evidence.

## Spec — written BEFORE the loop

Three behavioural mutants:

- **M1 — the verdict assignment deleted** (`internal/riskfeed/assemble.go`):
  `liq := h.Liquidatable(); p.Liquidatable = &liq` removed from `assembleAave`,
  byte-for-byte the code that produced live batches 3, 4 and 5. Expected kill:
  `TestAssembleAavePersistsTheDerivedLiquidatableVerdict` (all three subtests) and
  `TestAaveRollupAgreesWithTheShortfallCensusOnTheSameBook`.
- **M2 — the strict boundary loosened** (`internal/risk/types.go`):
  `AaveHealth.Liquidatable`'s comparison changed from `Cmp(wadUnit) < 0` to
  `<= 0`, so HF exactly 1e18 reads liquidatable. Expected kill: ONLY the
  `exactly 1.00 is healthy` subtest — the subtest that stops the M1 test from
  degenerating into "the field is non-nil". Also expected to reach
  `internal/risk`'s own `TestAaveEligibilityIsStrictAtExactlyOne`, since
  waterfall.go and shortfall.go now route through the same function.
- **M3 — the CORS header removed** (`cmd/api/middleware.go`): `Cache-Control`
  dropped from `Access-Control-Allow-Headers`, restoring the exact pre-fix list.
  Expected kill: `TestCORSPreflightAllowsTheStreamsCacheControlHeader`. The
  pre-existing `TestCORSIsOpenAndPreflightIsAnswered` is expected to STAY GREEN —
  that is the measurement of how much coverage this surface previously had.

Kill-suite commands (pure tests, no DB):

- M1: `go test ./internal/riskfeed -run 'TestAssembleAavePersistsTheDerivedLiquidatableVerdict|TestAggregateRefusesAComputedPositionWithNoVerdict|TestAaveRollupAgreesWithTheShortfallCensusOnTheSameBook' -count=1`
- M2: `go test ./internal/riskfeed -run 'TestAssembleAavePersistsTheDerivedLiquidatableVerdict' -count=1` and `go test ./internal/risk -count=1`
- M3: `go test ./cmd/api -run 'TestCORSPreflightAllowsTheStreamsCacheControlHeader|TestCORSIsOpenAndPreflightIsAnswered' -count=1`

Fixed-file sha256 (before-hash AND required after-restore hash):

- `internal/riskfeed/assemble.go`
  `a9cb98a971894c4c7586d222c290ff9f1388a892b86504e82d9bb8f0b9acdc12`
- `internal/risk/types.go`
  `126db78ee8a59e96ffd757e5f82c50efe3e42bfc48030e1a112d1cf7063862d5`
- `cmd/api/middleware.go`
  `3e9275df684017cd99870d9b3a6c6cf5c412f77e3322008a779d8eb9d17861d4`

## Results — 3/3 KILLED, every restore byte-identical

### M1 — the verdict assignment deleted (the pre-fix code)

Mutated-file sha256:
`e9e125d2e640e9522fe22d2cde9998cf973ec115045ad8f8b5678738e1f4c0b9`

KILLED (exit 1). All three subtests plus the cross-surface weld failed, and every
one of them failed on the SAME error — `Assemble` itself refused to produce a
batch:

```
--- FAIL: TestAssembleAavePersistsTheDerivedLiquidatableVerdict
    --- FAIL: .../exactly_1.00_is_healthy_(strict,...)
        Error: Received unexpected error:
          riskfeed: engine aave_v3_etherfi account aaaa…00a1 is COMPUTED but
          carries no liquidatable verdict: an absent verdict counted as
          not-liquidatable would understate this engine's rollup, which is the
          unknown-printed-as-zero the aggregate must never publish
    --- FAIL: .../one_scaled_debt_unit_under_the_bar_is_liquidatable,_and_the_rollup_counts_it
    --- FAIL: .../zero_debt_is_never_liquidatable_and_still_carries_a_verdict
--- FAIL: TestAaveRollupAgreesWithTheShortfallCensusOnTheSameBook
```

This is the strongest available outcome and it is worth stating plainly: under
the pre-fix source the fixed tree **cannot materialize a batch at all**. The
`aggregate` guard fires before any assertion about the field's value, so the
defect went from "silently understates a rollup" to "the pass fails and names
itself". The three original batches could not be written by this tree.

`TestAggregateRefusesAComputedPositionWithNoVerdict` stayed GREEN under M1 — it
constructs its rows by hand rather than through `assembleAave`, which is exactly
why it is the guard's own test rather than a duplicate of the ones above.

Restored sha256:
`a9cb98a971894c4c7586d222c290ff9f1388a892b86504e82d9bb8f0b9acdc12` — identical to
the pre-mutation hash. Kill suite green after restore.

### M2 — the strict boundary loosened to `<=`

Mutated-file sha256:
`60465ea065f33aa00a4d944c1cee7765d1fe70122980830c889bfe33152e221c`

KILLED (exit 1), and killed NARROWLY, which is the point:

```
--- FAIL: TestAssembleAavePersistsTheDerivedLiquidatableVerdict
    --- FAIL: .../exactly_1.00_is_healthy_(strict, like the Debt Manager's debt > maxBorrowLT)
        Error:    Should be false
        Messages: HF == 1e18 is healthy: Aave liquidates STRICTLY below
```

The other two subtests PASSED — they sit off the boundary, so a mutant that only
moves the boundary cannot reach them. That asymmetry is the evidence that the
boundary subtest carries real weight and that the test as a whole is not a
non-nil assertion in disguise. The fixture is hand-derived to land on exactly
1e18 (`HF_wad = floor(floor((1e15 × 1e18 + ⌊D/2⌋)/D)/1e4)` with `D = 1e11`), so
"exactly on the bar" is arithmetic, not luck.

Blast radius as predicted — `internal/risk` also went red on its own
boundary test, because waterfall.go and shortfall.go now read the law from the
same function instead of spelling it inline:

```
--- FAIL: TestAaveEligibilityIsStrictAtExactlyOne
FAIL    github.com/kaselunt/solvent/internal/risk
```

Restored sha256:
`126db78ee8a59e96ffd757e5f82c50efe3e42bfc48030e1a112d1cf7063862d5` — identical.
`./internal/risk` and `./internal/riskfeed` both green after restore.

### M3 — `Cache-Control` removed from the CORS allow-list (the pre-fix line)

Mutated-file sha256:
`02623c007773e60a892bec90911f38c886bab679624372bdb1434dd18e7d0978`

KILLED (exit 1), with the production allow-list quoted back verbatim:

```
--- FAIL: TestCORSPreflightAllowsTheStreamsCacheControlHeader
    Error:    Should be true
    Messages: preflight for /v1/stream requested "cache-control"; the allow-list
              is "Content-Type, Accept, Last-Event-ID" — a browser refuses the
              connect and the live layer never opens
```

`TestCORSIsOpenAndPreflightIsAnswered` — the CORS test that existed before this
wave — **stayed GREEN under M3**. That is the measurement the mutant was run for:
the pre-existing test asserts the origin and the method vocabulary and never
looks at the header allow-list, so the entire browser-reachability property was
unguarded. Go's httptest, curl and Node's fetch do not preflight, so nothing else
in the suite could have caught it either.

Restored sha256:
`3e9275df684017cd99870d9b3a6c6cf5c412f77e3322008a779d8eb9d17861d4` — identical.
Both CORS tests PASS after restore.

## Note on the client half of Finding B

The client change (`packages/client-ts/src/fetch-event-source.ts` no longer sends
the redundant request header) is guarded by two new tests in
`test/sse-server.test.ts`, which drive a real `node:http` server and inspect the
headers it actually received. They are not mutated here because the mutant is the
deleted line itself and the first of those tests asserts the whole authored
header set against the Fetch standard's safelist — a re-added `Cache-Control`
fails it by construction, as does any future non-safelisted addition.
`npm run verify`: typecheck clean, 314/314 tests, build clean.
