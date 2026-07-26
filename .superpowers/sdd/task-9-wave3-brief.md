### Task 9 — wave 3: round-2 fixes (prices unit) — ONE routing principle

Repo `C:\Users\kasel\source\repos\etherfi\Solvent`, branch `main`. Base: current HEAD at
start (`git log` first). Read `.superpowers/sdd/task-9-codex-round2.md` (verbatim +
adjudication), `task-9-wave2-report-p2.md`, `task-9-wave2-brief.md`. CLOSED by round 2 —
do not re-open: the EIP-1898 pin end-to-end, W2M1s, the contract rewrite, fixture realism.

## The ruling (adjudication, binding)

The per-arm routing approach has missed twice (wave 2 advanced four arms; round 2 found
two more shapes). Wave 3 closes the CLASS with one invariant, stated verbatim in the code
at the round's single exit seam:

> **Landing is the only outcome that keeps the starting point.** Once a round has resolved
> its serving endpoint, EVERY non-landing outcome advances the caller-scoped exploration
> start — named discards, the ambiguous before/after hash mismatch (round 2 finding 1),
> out-of-class pin rejections, trailing transport failures, malformed envelopes,
> closing-header failures (round 2 finding 2). Failure classification decides the ERROR
> POSTURE (discard vs error vs backoff) and NOTHING else. The shared routing hint is never
> written (d1e7d54 preserved); caller-scoped exploration attributes no fault.

## Do

1. **Restructure, don't enumerate:** funnel every post-resolution exit of `readRound` (and
   its caller's failure handling, wherever the round outcome is decided) through one seam
   that applies the invariant — success keeps the start, everything else advances it. The
   structural shape matters: a future new failure arm must get the advance FOR FREE, not
   by remembering to call a helper. If the current control flow cannot guarantee that,
   restructure until it can (e.g. a single deferred outcome handler keyed on a
   round-landed flag).
2. Chain-movement discards (before/after mismatch) now advance too — subsumed
   deliberately; state in the comment why the false-attribution objection is void
   (caller-scoped, no fault attribution, hint untouched).
3. Remove or repurpose `isBlockNotFoundErr`'s routing role: classification may still pick
   log wording / discard-vs-error posture, but routing no longer depends on recognizing
   phrasings. Keep its fail-closed error posture for unknown wording.

## Harness (regressions Codex named, plus the principle's own)

- Stable same-token header-backend split (fork-A head+call, fork-B closing header, every
  cadence) + healthy peer: next cadence lands a full round through the peer. **Reverse
  W2M5**: removing the mismatch-arm advance must now be KILLED.
- Mixed rejection/transport: endpoint 0 serves private-fork head A; both endpoints reject
  hash A; the FINAL error is a transport failure (masks the recognized class); assert the
  next cadence lands through endpoint 1's own head B.
- Malformed-envelope and closing-header-total-failure shapes: same recovery assertion.
- The principle test: table-drive EVERY non-landing exit currently reachable; assert each
  advances the start. This test is the class-closer — a new arm that forgets the advance
  must fail it by construction (drive via the seam, not via per-arm setups, to the extent
  the fake chain permits).
- Liveness under BOTH endpoints half-broken (round-2 question (a) held over): advance
  ping-pong between two failing endpoints must still visit each (no oscillation lock that
  never retries a recovered endpoint); a bounded test that endpoint recovery is eventually
  observed.
- Mutations: the seam (removing the advance = killed by the principle test), each named
  regression's arm, W2M5 reversed. Properties stated. Committed applier per wave-16 rule.

## Scope & environment (binding, unchanged)

Touch ONLY `internal/prices/**`, `.superpowers/sdd/**` (chain layer should NOT need
changes this wave — flag loudly if it does). NEVER `internal/snapshot/**`, `cmd/**`,
`internal/store/**`, migrations, `roadmap/**`. Pathspec staging. **Backfill daemon still
RUNNING against DB `solvent`** — use `solvent_t9w1`
(`TEST_DATABASE_URL='postgres://solvent:solvent@localhost:5432/solvent_t9w1?sslmode=disable'`);
never stop the daemon/container. Commit before mutation loops; in-memory restores. Baseline
at start commit (top-level `^--- PASS`; wave-2 final 592/0/0 at 115e4d2); zero FAIL/SKIP;
build/vet/gofmt READ + committed-blob check; `-race` in `golang:1.24` via
`host.docker.internal`; `dangerouslyDisableSandbox: true` + PATH export.

## Reporting

`.superpowers/sdd/task-9-wave3-report-p2.md`: the seam's structure (how a future arm gets
the advance for free), every regression cited to its test, mutation matrix, anything
unverified. Returns to Codex (prices unit) under D-006 — expected closing round.
