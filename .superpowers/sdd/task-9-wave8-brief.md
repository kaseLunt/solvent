### Task 9 — wave 8: round-7 fixes (chain layer) — the canon applies to the whole package

Repo `C:\Users\kasel\source\repos\etherfi\Solvent`, branch `main`. Base: current HEAD at
start. Read `.superpowers/sdd/task-9-codex-round7.md` (verbatim + adjudication — note the
adjudication owns the scope-narrowing as a BRIEFING error: the rule was right, its
application was two fields short of the package), `task-9-wave7-report-p2.md` (the canon
you are extending — `checkCanonicalQuantity` and the wire-shape pattern are closed law).

## The job — close the class at package scope

**Inventory EVERY field the package decodes from an RPC response** and put each in the
report's sweep table: field → decode path → STRICT-GATED (cite the gate + test) or
JUSTIFIED-OPAQUE (state why leniency cannot mint a wrong value). The inventory includes at
minimum: the BlockNumber closure, FilterLogs/types.Log consumed metadata, VerifyChainID's
chainId, TxCalldata's transaction fields, Call/CallAtHashFrom result envelopes (opaque
bytes — justify), and anything else a grep for rpc/ethclient decode sites surfaces.

## F1 [medium] — BlockNumber (`chain.go:527-534`)

`""` → hexutil.Uint64 zero → success → no rotation → walker sees height below
confirmations and starves. **Do:** strict raw quantity decode for the closure (Codex's
alternative — derive from the strictly-decoded latest header — is acceptable if you argue
one-fetch-path uniformity; pick one and justify). **Regression:** real-Dial — empty
primary result FAILS the attempt, secondary's height LANDS.

## F2 [medium] — log metadata (`chain.go:890-900`)

`logIndex` `""` → present zero → attempt succeeds → zero persisted as raw-log
identity/order. **Do:** raw-decode mined log results through presence-tracked strict
wrappers for every CONSUMED quantity field (blockNumber, logIndex at minimum — inventory
decides the full list) before conversion to types.Log; violation = failed attempt =
rotation. Audit the non-quantity log fields (blockHash/txHash/address/topics/data) for
analogous leniency and table them (common.Hash's fixed-length gate may already refuse —
verify by execution like wave 7's hash audit, not by assertion). **Regression:**
real-Dial — malformed-primary log response (empty logIndex) FAILS, rotation, healthy
secondary LANDS the window.

## Harness & mutations

Real-Dial regressions for both named fixes (full landing, not primary-skipped). Extend
the raw-JSON matrix to the new gates. Mutations: each new gate arm (property: an empty
quantity can never become a value THROUGH THIS PATH), per-path isolation visible in kill
lists; committed applier per wave-16 rule.

## Scope & environment (binding, unchanged)

Touch ONLY `internal/chain/**`, `.superpowers/sdd/**`. NEVER anything else. Pathspec
staging. **Backfill daemon RUNNING** against DB `solvent` — tests on `solvent_t9w1`
(`TEST_DATABASE_URL='postgres://solvent:solvent@localhost:5432/solvent_t9w1?sslmode=disable'`);
never stop the daemon/container. Commit before mutation loops; in-memory restores;
CRLF-aware patching; committed-blob gofmt via `git cat-file` → temp files. Baseline at
start commit (top-level `^--- PASS`; wave-7 final 624/0/0 at `93b7658` code tip, gate ON
— state posture both runs); zero FAIL/SKIP; build/vet/gofmt READ; `-race` (prices+chain)
in `golang:1.24` via `host.docker.internal`; `dangerouslyDisableSandbox: true` + PATH
export.

## Reporting

`.superpowers/sdd/task-9-wave8-report-p2.md`: THE SWEEP TABLE (every wire-decoded field,
gated-or-justified — this is what makes round 8 decidable), both fixes cited to tests,
mutation matrix, anything unverified. Returns to Codex under D-006 — the sweep table is
the closing argument.
