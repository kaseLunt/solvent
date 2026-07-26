### Task 9 — wave 4: round-3 fix (prices unit) — order-independent outcome classification

Repo `C:\Users\kasel\source\repos\etherfi\Solvent`, branch `main`. Base: current HEAD at
start. Read `.superpowers/sdd/task-9-codex-round3.md` (verbatim + adjudication),
`task-9-wave3-report-p2.md`. CLOSED — do not re-open: the EIP-1898 pin, the non-landing
routing seam (round 3: "structurally sound"), W2M1s/W3M1s, contract rewrite, fixture
realism.

## F1 [medium] — one classification authority per round outcome (`poller.go:940-982`)

Last-error-wins makes the round's posture depend on failover ORDER: endpoint 0 transport
failure + endpoint 1 recognized pin rejection → discard (nil) when starting at 0, error
when starting at 1. The daemon reads nil discards as success — backoff streak resets,
`step_error` clears — so a persistent mixed outage never reaches the 10-minute cap and
failure visibility flickers. This is "one time authority per verdict" transposed: one
CLASSIFICATION authority per outcome, not whichever attempt happened to run last.

**Do (Codex's recommendation, binding):**
- Chain layer (additive; sanctioned this wave): `Failover` propagates typed or aggregate
  PER-ATTEMPT outcomes for the pinned-call path — enough for the caller to know, for
  every attempted endpoint, whether the failure was a recognized pin rejection vs
  transport/unknown. Keep the existing method behavior for other callers (snapshotter
  untouched); mirror the token discipline.
- Poller: the round's posture is computed from the AGGREGATE — **discard posture ONLY
  when every failed attempt is a recognized pin rejection; ANY transport or unknown
  involvement retains the error posture** (backoff streak grows, `step_error` stays).
  The deferred routing advance applies to BOTH postures (the seam is untouched).
- State the authority rule in a comment at the classification site.

**Harness:** multi-cadence tests for BOTH mixed-error orders (transport-then-rejection,
rejection-then-transport) driven through the daemon worker wrapper (the wave-13/15 health
harness precedent — drive the real component), asserting: (a) persistent transport
involvement never resets the backoff streak, (b) `step_error` remains visible across the
alternation, (c) routing still advances every non-landing round, (d) the all-rejections
round still discards cleanly. Mutations: the aggregate-vs-last-error classification
(property: posture is order-independent), the any-transport-retains-error arm, the
all-rejections-discard arm. Committed applier per the wave-16 rule.

## Scope & environment (binding)

Touch ONLY `internal/prices/**`, `internal/chain/chain.go` + `chain_test.go` (the
sanctioned additive outcome propagation), `.superpowers/sdd/**`. NEVER
`internal/snapshot/**`, `cmd/**`, `internal/store/**`, migrations, `roadmap/**`. The
walker-layer content-validation rotation class recorded in round 3's archive is OUT OF
SCOPE — do not touch `internal/ingest/**`. Pathspec staging. **Backfill daemon RUNNING**
(restarted, OP single-provider) against DB `solvent` — use `solvent_t9w1`
(`TEST_DATABASE_URL='postgres://solvent:solvent@localhost:5432/solvent_t9w1?sslmode=disable'`);
never stop the daemon/container. Commit before mutation loops; in-memory restores.
Baseline at start commit (top-level `^--- PASS`; wave-3 final 598/0/0 at code tip
`1b89fb5`); zero FAIL/SKIP; build/vet/gofmt READ + committed-blob check (temp files, not
/dev/stdin — it silently no-ops on Windows, wave-3 report §deviations); `-race` in
`golang:1.24` via `host.docker.internal`; `dangerouslyDisableSandbox: true` + PATH export.

## Reporting

`.superpowers/sdd/task-9-wave4-report-p2.md`: the aggregate outcome design, both
mixed-order regressions cited to tests, mutation matrix, anything unverified. Returns to
Codex (prices unit) under D-006 — expected closing round.
