### Task 9 — wave 20: round-19 fixes (reconcile) — instance-binding, platform truth, provenance closure, wire-level regressions

Repo `C:/Users/kasel/source/repos/etherfi/Solvent`, branch `main`. Base: current HEAD
at start. **You own `cmd/reconcile/**` (incl. snapshotdb), `internal/store/**`,
`cmd/indexer/**`, `.superpowers/sdd/**`. NEVER `internal/ingest/**` (closed at round
18 — SHIP), `internal/chain/**`, `internal/prices/**`.** Pathspec staging; scope-gate
refusal = STOP. Own scratch DB `solvent_t9w20`. No parallel wave.

Read: `.superpowers/sdd/task-9-codex-round19.md` (verbatim + adjudication — the work
order), `task-9-wave19-report-p2.md`, `task-9-codex-round16.md`. Closed law (round 19
CONFIRMED — do not regress): the effective-DSN rejection (the reviewer DSN dies), F2,
the 17-name PG* table, the transcript SHA-binding discipline, migration 00010's
mask-by-construction shape.

## H1 — cadence binds to the INSTANCE, not just the generation (`cmd/indexer/main.go:841-849`)

Restart does not roll `current_generation`, so a prior instance's stamp==current value
survives a new instance whose writes fail. **Pick and justify:**
- (a) durable daemon-start epoch joins the stamp (cadence readable only when BOTH
  generation and epoch match the running instance's), or
- (b) the pre-loop cadence overwrite becomes MANDATORY AND FATAL — the daemon refuses
  to run if it cannot persist its own cadence at startup (no new availability
  dependency: the daemon already cannot run without the DB). Per-round write failures
  may then stay tolerated+surfaced, because startup guarantees the readable value
  belongs to THIS instance. If you choose (b), argue why mid-run generation rollover
  with a failed row-write still fails closed (the 00010 mask should already taint —
  demonstrate it).
**Regression (binding, Codex's exact scenario):** open generation, interval=2h,
stamp==current from a "previous instance"; new daemon configured 30m with
startup/per-round writes failing → reconcile must NOT receive 2h as verified
(mechanism-dependent: taint, or the daemon never runs). Mutant: instance-binding
removed → killed.

## H2 — APPDATA predicate becomes platform-true (`cmd/reconcile/env.go:289-296`)

- **Non-Windows:** pgx never reads APPDATA — the judge must IGNORE it (no false
  taint).
- **Windows:** unpinned TLS defaults are unverified EVEN WHEN APPDATA IS EMPTY — pgx
  then builds `filepath.Join("", "postgresql", "root.crt")`, a CWD-relative trust
  path a planted file satisfies. Taint whenever trust material is unpinned and the
  platform default path (absolute OR relative) could supply it; clean only when the
  DSN pins the material or the sslmode makes it irrelevant.
- Cite pgx v5.5.1 source for both platforms (defaults_windows.go, the non-Windows
  sibling, config.go trust loading). Tests BOTH directions (Windows empty-APPDATA
  taints when unpinned; non-Windows nonempty-APPDATA stays clean). Build-tagged or
  GOOS-parameterized implementation — justify the mechanism; the non-native branch
  must still be testable on Windows CI/dev (seam for the platform input).
  Mutants: predicate reverted to empty==clean → killed; non-Windows ignore removed →
  killed (false-taint regression).

## M3 — function-value provenance closure (`snapshotdb/boundary_test.go:614-635`)

`dial := conn.Config().DialFunc; dial(ctx, ...)` survives the scan. **Do:** ban
FORMATION of function-typed fields from non-allowlisted types (or full local
provenance tracking with an explicit justification list — pick the mechanism that
makes the next alias generation unrepresentable rather than merely detected; justify).
Mutant: the exact DialFunc-alias shape inserted after `gate.Enter()` → killed.

## L4 — the regression protects the WIRING (`pgxdsn_test.go:129-150`)

Execute-level seam or structural call-site assertion so that DELETING the execute
call that appends the claimed-vs-connected taint fails a test. Mutant: the execute
wiring removed (the predecessor's exact unwired state) → killed. (W19M2 stays — it
kills the inert-judge half.)

## Environment & reporting (standard)

Own scratch DB `solvent_t9w20`; daemon is currently DOWN by controller decision and
stays down (do NOT start it); `solvent-db-1` container must stay up — if you find it
down, start the container only. Baseline `make test-acceptance` at your start commit
in a pinned worktree (expect 802/0/0; `SOLVENT_LIVE_RPC_TESTS=1`; "acceptance mode:
exit=0 skips=0"). Final same posture, zero FAIL/SKIP, PASS-diff name-for-name.
Mutation spec `.superpowers/sdd/t9w20-mutations/mutations.json` BEFORE the loop;
applier `wave16-mutations/mutate.py`; in-memory restores byte-identical; behavioral
kills; if any post-spec commit touches a mutated file, RE-RUN the loop at the new SHA
(the wave-19 discipline). `-race` (reconcile + snapshotdb + store + indexer)
golang:1.24 docker. Committed-blob gofmt; vet. Report
`.superpowers/sdd/task-9-wave20-report-p2.md`: the H1 mechanism chosen with the
rollover argument, the platform-true APPDATA table both directions, the provenance
mechanism, the wire-level regression, mutation matrix, anything unverified. Returns to
Codex under D-006 — reconcile closing round, attempt three; diff base..final
restricted to the three path prefixes.
