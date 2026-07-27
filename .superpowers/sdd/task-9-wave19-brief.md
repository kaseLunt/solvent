### Task 9 — wave 19: round-16 fixes (reconcile) — the claim is what the library computes; capabilities close over first-party packages; a fallback that can widen is a bypass

Repo `C:/Users/kasel/source/repos/etherfi/Solvent`, branch `main`. Base: current HEAD
at start. **PARALLEL to wave 18 (surgical ingest) — you own `cmd/reconcile/**` (incl.
snapshotdb), `internal/store/**`, `cmd/indexer/**`, `.superpowers/sdd/**`. NEVER
`internal/ingest/**` (wave 18 owns), `internal/chain/**`, `internal/prices/**`.**
Pathspec staging; scope-gate refusal = STOP. Own scratch DB `solvent_t9w19`.

Read: `.superpowers/sdd/task-9-codex-round16.md` (verbatim + adjudication — the work
order), `task-9-wave16-report-p2.md`, `task-9-wave15-report-p2.md`. Closed law (round
16 CONFIRMED — do not regress): F2's ordered cleanup + during-observation lifecycle
test, the 17-name PG* table, W16M5's go/types resolution, the serialized-verification
discipline, migration 00009 itself.

## M1 — claimed identity follows pgx's semantics (`main.go:281`, `main.go:1081`)

- Compute the CLAIMED database the way pgx computes the effective one: parse via
  pgx's own `ParseConfig` (or replicate its documented precedence exactly — path,
  then `dbname` query param including empty-value override; cite pgconn source
  file:line in the report). Reject DSNs whose effective database is absent or
  overridden-empty. `db_name_claimed` records the EFFECTIVE claim.
- Claimed-vs-connected mismatch becomes VERDICT-BEARING: taint, both directions.
- **Regressions:** the reviewer's exact DSN (`postgres://solvent@db/claimed?dbname=`)
  → rejected/tainted; a mismatch between effective claim and server-reported identity
  → taint. Mutants: guard reverted to path-only → killed; mismatch made informational
  → killed.

## M2 — pgx's non-PG* OS inputs join the classified table (`env.go:270-280`)

- Sweep pgx v5.5.1's platform-defaults sources (`defaults_windows.go` AND the
  non-Windows sibling) for EVERY OS-env input; extend the classified env table with
  each, source-cited. `APPDATA` is verdict-bearing whenever it can select TLS trust
  material (client cert/key, root CA) for the connection — i.e., unless the DSN pins
  `sslrootcert`/certs explicitly or the sslmode makes trust material irrelevant;
  justify the exact predicate against pgx's config.go:685-693 loading logic.
- **Regression:** verify-full DSN without explicit sslrootcert + APPDATA present →
  taint (or the connection's trust material provably pinned — whichever mechanism you
  choose, it must fail CLOSED). Mutant: APPDATA reclassified inert → killed.

## M3 — capability closure over first-party packages (`snapshotdb/boundary_test.go:550-587`)

- `store.Open` (dial+ping) is reachable from snapshotdb without tripping any boundary
  test. Prefer the STRUCTURAL fix: make the dial capability unreachable from inside
  the gate's scope (snapshotdb already receives its connection; restrict
  internal/store call targets to an audited entry-point allowlist in the semantic
  scan — named symbols, not the whole package). Non-selector calls and locally-aliased
  function values join the scan (the reviewer named local aliasing of `pgx.Connect`
  as an equivalent gap).
- **Mutants (binding, per shape):** `store.Open(ctx, dsn)` inserted after
  `gate.Enter()` → killed; locally-aliased `pgx.Connect` via non-selector call →
  killed. Both through the committed applier, behavioral kills.

## M4 — cadence binding: current generation only; the widening fallback dies (`env.go:310-336`, `derive.go:1530-1537`, `cmd/indexer/main.go:832-836`)

- Reconcile reads `configured_interval_seconds` from the CURRENT sweep generation
  ONLY (the generation whose evidence the freshness check consumes). A stale value
  from a prior generation/instance must be unreadable by construction, not filtered
  by judgment.
- **Absent/NULL in acceptance mode → TAINT.** Not a guessed bound. (Not fail-forever:
  the daemon writes every round — one round after restart the value exists. State
  this distinction in code comment and report.)
- **The 2×default fallback DIES** — round 16 proved it can be WIDER than the daemon's
  real bound (30m daemon → real 80m vs fallback 2h). A fallback that can widen is a
  bypass. Non-acceptance mode may keep a clearly-labeled advisory path if you argue
  it, but acceptance verdicts never rest on an unverified cadence.
- Cadence-write failures stop being silent: surface into the sweep-evidence/step-error
  path (smallest honest mechanism — the daemon already has both; justify the choice).
  The UPDATE-only write gains whatever binding your current-generation read requires
  (write it on the generation row it belongs to).
- **Regressions:** the reviewer's exact scenario (prior-gen 2h persisted, current gen
  absent, env unset → taint, never `2*(2h+lastPass)`); NULL + acceptance → taint;
  write-failure surfacing observable. Mutants: prior-generation read allowed → killed;
  fallback restored → killed.

## Environment & reporting (standard)

Own scratch DB `solvent_t9w19`; daemon + `solvent-db-1` untouched (restart remains the
controller's post-wave step); live DB read-only via SOLVENT_RECON_DATABASE_URL.
Baseline `make test-acceptance` at start commit in a pinned worktree (expect 793/0/0
± wave-18's additions — reconcile the PASS-diff explicitly; posture stated:
`SOLVENT_LIVE_RPC_TESTS=1`, TEST DSN → scratch). Mutation spec
`.superpowers/sdd/t9w19-mutations/mutations.json` BEFORE the loop; applier
`wave16-mutations/mutate.py`; in-memory restores byte-identical. `-race` (reconcile +
snapshotdb + store + indexer) golang:1.24 docker. Committed-blob gofmt; vet. Zero
FAIL/SKIP. Report `.superpowers/sdd/task-9-wave19-report-p2.md`: the pgx-semantics
claim mechanism (source-cited), the extended OS-input table, the capability-closure
mechanism, the generation-bound cadence semantics with the acceptance-taint
distinction, mutation matrix, anything unverified. Returns to Codex under D-006 —
reconcile closing round, attempt two; diff for that round: your base..final restricted
to reconcile/store/indexer paths.
