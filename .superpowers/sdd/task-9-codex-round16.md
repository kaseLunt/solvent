# Codex adversarial review — task 9 wave 16 (round 16, reconcile closing attempt)

- **Target:** detached `0a4f21c` (== origin/main tip at fetch, verified and stated);
  range `05ffd9a..0977bcb` restricted to `cmd/reconcile/**`, `internal/store/**`,
  `cmd/indexer/**`. Isolation CONFIRMED: only `5b53306`/`6dff5f3` touch the 18
  restricted-path files; interleaved commits verified out-of-scope.
- **Verdict:** **NO-SHIP** — 4 medium, 0 high.
- **Job:** `task-ms2pplio-t54vn8`; session `019fa1c7-8aa4-7ba0-b8d8-7ccfb3ad110e`;
  worktree pruned; broker PID 73864 verified by `--cwd` and killed.
- **Confirmed sound:** F2 fully fixed (rollback → close → gate exit; the lifecycle
  test genuinely observes the in-progress sequence; the delay-only barrier API
  defensible); the PG* enumeration COMPLETE for pgx v5.5.1 (all 17 names, cited to
  pgconn/config.go:408-425); the serialized-redo methodology sound; the 8/8 mutation
  transcript realistic with W16M5's go/types-only kill consistent.

## Findings (verbatim)

### [medium] Partial-DSN rejection does not follow pgx's database-selection semantics — `cmd/reconcile/main.go:281`
`readOnlyDSN` checks only the URL path. pgx first derives the database from the path, then lets the `dbname` query parameter overwrite it—even with an empty value—at pgconn/config.go:482 and :491. An empty database is omitted from the startup message at pgconn/pgconn.go:325. Concrete scenario: `postgres://solvent@db/claimed?dbname=` passes the guard, but pgx connects to PostgreSQL's default database. No PG* variable need be present, so no taint fires. `db_name` correctly reports the server result, but `db_name_claimed` still reports `claimed` because `dbNameFromDSN` (main.go:1081) ignores pgx's `dbname` override, and the mismatch itself is not verdict-bearing. Thus server truth is not laundered, but partial-DSN rejection and the claimed-identity field remain incomplete.

### [medium] `APPDATA` is not subject-inert as claimed — `cmd/reconcile/env.go:270-280`
env.go says it only chooses a passfile and therefore remains verdict-free. In pgx v5.5.1, however, `APPDATA` also chooses the client certificate, private key, and root CA (pgconn defaults_windows.go:20-43); pgx loads that CA into TLS verification (config.go:685-693). Concrete scenario: on Windows, a DSN using `sslmode=verify-full` but no explicit `sslrootcert` inherits `%APPDATA%\postgresql\root.crt`. Redirecting `APPDATA` to a different trust root can authorize an impersonating database which can self-report the expected database/system identity and return passing data, with no taint. This contradicts the treatment of `PGSSLROOTCERT` as verdict-bearing.

### [medium] The capability test still permits a dial through the already-allowlisted `internal/store` package — `cmd/reconcile/snapshotdb/boundary_test.go:550-587`
The semantic call scan handles direct pgx calls and forbids `internal/config`, but has no restriction for `internal/store` calls. Yet `store.Open` (store.go:41) creates a pgx pool and immediately pings it. Concrete scenario: adding `side, _ := store.Open(ctx, attackerDSN)` after `gate.Enter()` introduces no import, interface, function field, package variable, or direct `pgx.Connect`. All three boundary tests therefore pass while an unaudited network dial/retry occurs with the repeatable-read transaction open. Local aliasing of `pgx.Connect` is another equivalent gap because non-selector calls are skipped. W16M5 genuinely proves named-interface resolution, but not capability closure.

### [medium] Persisted cadence can be absent or stale in a way that widens the bound while remaining clean — `cmd/indexer/main.go:832-836`, `internal/store/derive.go:1530-1537`, `cmd/reconcile/env.go:310-336`
Cadence-write failures are deliberately swallowed; the UPDATE preserves any previous value; reconcile trusts every positive persisted value without an instance, generation, or freshness binding. Concrete scenario: a prior daemon persisted 2h; a restarted daemon is configured for 30m; its cadence UPDATE fails transiently and is tolerated; reconcile runs with its interval env unset. The old 2h value remains clean and produces `2*(2h+lastPass)`, while the running daemon judges with `2*(30m+lastPass)`. A three-hour-old snapshot can pass reconcile while the daemon is red. The NULL fallback is also not universally fail-closed: with a real 30m daemon, 10m last pass, NULL persisted cadence, and unset reconcile env, the fallback gives 2h while the daemon's real bound is 80m. A 100-minute-old sample passes. The schema-8 exact-equality refusal itself is safe and merely an ordering constraint; the unsoundness is in the nullable/stale cadence semantics after migration.

## Controller adjudication

**All four ACCEPTED.** Two are the standing lessons one level deeper; two are honest
incompleteness in new mechanisms:

1. **M1 (dbname override):** the claim must be computed the way THE LIBRARY computes
   it — parse the claimed identity via pgx's own ParseConfig (or equivalent semantics
   including query-param override and empty-value cases), reject DSNs whose effective
   database is absent/overridden-empty, and make claimed-vs-connected mismatch
   VERDICT-BEARING (taint) rather than informational.
2. **M2 (APPDATA):** the wave-16 law ("the taint domain covers what linked libraries
   read") applied to NON-PG* OS inputs: sweep pgx's platform defaults source for every
   OS-env input (APPDATA on Windows; home-dir equivalents elsewhere) and classify each
   with the same rigor as the PG* table — APPDATA is verdict-bearing whenever it can
   select TLS trust material for the connection.
3. **M3 (store.Open):** capability closure includes FIRST-PARTY allowlisted packages —
   the strongest fix is structural again: snapshotdb's scan restricts internal/store
   calls to the audited entry points (or the dial capability is removed from reach);
   non-selector and locally-aliased calls join the scan. Mutants per shape (store.Open
   after Enter; aliased pgx.Connect).
4. **M4 (cadence binding):** reconcile reads the interval from the CURRENT sweep
   generation ONLY; NULL/absent in acceptance mode → TAINT, not a guessed bound (this
   is NOT fail-forever: one daemon round writes it — the round-14 distinction). The
   2×default fallback DIES (Codex showed it can be wider than the daemon's real
   bound — a fallback that can widen is not a fallback, it is a bypass). Cadence-write
   failures stop being silent (surface into sweep evidence / step-error path — smallest
   honest mechanism). Env mismatch taint stays, both directions.

Fix wave: `task-9-wave19-brief.md` (parallel with wave 18, disjoint: wave 18 owns
`internal/ingest/**` only). Reconcile trend: 3H2M → 2H1M → 1H1M → 1H3M → 0H4M — first
zero-high round; the findings are refinements of wave-16's own new mechanisms, not new
classes.
