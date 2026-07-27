### Task 9 — wave 16: round-14 fixes (reconcile) — the taint domain includes what your LIBRARIES read; the boundary must be capability-true, not namespace-true

Repo `C:/Users/kasel/source/repos/etherfi/Solvent`, branch `main`. Base: current HEAD at
start. **No parallel sibling wave this time**, but scope is still bounded: you own
`cmd/reconcile/**` (incl. snapshotdb), `internal/store/**` (F4's migration + sweep-write
site ONLY), `cmd/indexer/**` (F4 wiring ONLY, if the daemon must write the interval),
`.superpowers/sdd/**`. NEVER `internal/ingest/**`, `internal/chain/**`,
`internal/prices/**` — an ingest Codex round is reviewing that surface concurrently and
it must diff against a quiet tree. Pathspec staging every commit; if the scope gate
refuses a path, STOP and report (standing rule). Own scratch DB: create
`solvent_t9w16`.

Read first: `.superpowers/sdd/task-9-codex-round14.md` (verbatim findings + the
controller adjudication — now RATIFIED as this brief's work order),
`task-9-wave15-report-p2.md`, `task-9-wave15-brief.md`. Closed law you must not
regress: the wave-15 env-surface taint table, the snapshotdb package split itself, the
DB-backed gate lifecycle test (EXTEND it, never weaken), blanket `-accounts` taint,
D-012.

## F1 [high] — linked-library env inputs join the taint domain (`env_test.go:125-140`, the DSN accept path)

pgx v5.5.1 reads `PGHOST`/`PGPORT`/`PGDATABASE`/`PGUSER`/`PGSERVICE*`/`PGSSLMODE`/etc.
A partial DSN + ambient `PGHOST` connects to a DIFFERENT server while the artifact
records `db_name=solvent`. **Do ALL of:**

- **Reject partial DSNs in acceptance:** the recon DSN must carry explicit host AND
  database; anything less rejects/taints.
- **Extend the closed env table to linked-library inputs:** enumerate the `PG*`
  variables from pgx v5.5.1's ACTUAL source (read the module in the module cache /
  `go doc` — cite file+line in the report), not from memory. Produce the table like
  wave 13's flag table / wave 15's env table. Present-in-environment during
  acceptance → taint (or provably neutralized before connect — justify which).
- **Record CONNECTED identity, not parsed intent:** the artifact's db identity becomes
  the wave-11 identity tuple (`current_database()`, `inet_server_addr()`,
  `inet_server_port()`, server version) read over the SAME connection the snapshot
  used — the recorded fact is what the server says, never what the URL claimed.
- **Regression (binding):** ambient `PGHOST` pointed at a second scratch DB + partial
  DSN → non-pass, and the artifact records the CONNECTED identity. Mutation:
  PG*-taint check removed → killed.

## F2 [medium] — ordered cleanup; the gate exits LAST (`snapshotdb.go:324-344`)

LIFO defers run `Gate.Exit` before `tx.Rollback`/`conn.Close`, so the RPC surface
reopens while the transaction still holds xmin. **Do:** one ordered cleanup path —
rollback, then close, THEN `Gate.Exit` — a single deferred function whose internal
order is explicit, not three stacked defers. **Test (binding):** the lifecycle test
must observe the gate DURING rollback and close — a seam/hook that blocks each in turn
while the test asserts the gate is still closed. Mutation: cleanup order swapped
(gate-first) → killed by that observation, not by post-return state.

## F3 [medium] — capability boundary, not namespace boundary (`boundary_test.go:43-61`)

Allowlisting `os` grants `os.StartProcess`. **Do:** hoist the config-hash read OUT of
snapshotdb — compute it before entry and pass the value in — then REMOVE `os` from
snapshotdb's imports entirely, so the import list states the true capability set.
Strengthen the AST test with go/types semantics: resolve underlying interface types
(`context.Context`, `any`) rather than literal spellings; make `Gate` non-assignable
(unexported function field or equivalent — justify). **Negative mutants (binding, one
per evasion shape):** (a) `os` reintroduced → killed by the import-list assertion;
(b) a capability smuggled through a still-allowed package → killed (pick the sharpest
real shape the remaining allowlist permits and show it dies); (c) named-interface
indirection → killed by the go/types resolution. Each demonstrably KILLED via the
committed applier.

## F4 [medium] — evaluate the daemon's REAL freshness rule from durable state (`env.go:51-69`)

The 1h cap permanently fails a supported 2h cadence: the daemon's actual healthy bound
is `2*(interval+lastPass)`, and lastPass alone cannot reproduce the additive interval
term. **Primary (mandated unless you justify the alternative):**

- Additive migration (`internal/store/migrations/000XX_...sql`): the daemon persists
  its CONFIGURED snapshot interval with each sweep-generation row (the same durable
  surface that already carries `last_pass_seconds` — migration 00006/00008 lineage).
- The daemon writes it every pass (smallest wiring change in `cmd/indexer` /
  `internal/store` — additive, no behavior change to sweeps themselves).
- Reconcile evaluates `2*(interval+lastPass)` FROM THE PERSISTED ROW. The env var
  demotes to cross-check: env-vs-persisted mismatch → taint. Never widen a bound from
  an env claim.
- **Fallback semantics (required):** rows predating the migration carry no interval →
  reconcile falls back to wave-15's 1h-default bound, and TAINTS if env claims wider.
  Fail-closed, never fail-forever, never silently widened.
- **Regressions (binding):** persisted 2h interval + zero failures → PASS (the
  fail-forever posture dies); env-vs-persisted mismatch → taint; pre-migration rows →
  fallback + documented taint path. Mutation: persisted-read replaced by env-read →
  killed.

**Alternative** (bar is HIGH): enforce ≤1h as a daemon configuration contract (reject
at startup) — only if you argue persistence is disproportionate; note the primary also
dissolves the unverifiable-operator-assertion objection, which the alternative does
not.

**Operational note:** the RUNNING daemon binary predates this wave — do NOT restart or
signal it (`solvent-db-1` and DB `solvent` untouched; the controller restarts the
daemon after the wave lands so a sweep writes the interval). Your DB tests run only
against `solvent_t9w16`.

## Environment (binding)

Own scratch DB `solvent_t9w16`; live DB read-only via `SOLVENT_RECON_DATABASE_URL`.
Commit before mutation loops; in-memory restores verified byte-identical; CRLF-aware
patching; committed-blob gofmt via `git cat-file` → temp files; `-race` (cmd/reconcile
+ snapshotdb + any touched internal/store, cmd/indexer packages) in `golang:1.24` via
docker at `host.docker.internal`; `dangerouslyDisableSandbox: true` + PATH export.
Baseline at your start commit via `make test-acceptance` (top-level `^--- PASS`
convention, posture stated both runs; wave-15 final was 768/0/0 and wave-14 landed +4
inside that number's lineage — reconcile expectation: baseline == 768 unless
interleaved docs shifted nothing). Zero FAIL/SKIP; acceptance-mode skip count stated.
The migration must also prove no-op safety against a copy of the LIVE schema shape
(restore schema-only into your scratch DB; never touch `solvent`).

## Reporting

`.superpowers/sdd/task-9-wave16-report-p2.md`: the pgx `PG*` enumeration table WITH
source citations, the connected-identity recording, the ordered-cleanup shape, the
capability-boundary proof, the F4 choice + fallback semantics + migration lineage,
mutation matrix (committed applier), anything unverified. Returns to Codex under D-006
— expected closing round for the reconcile harness.
