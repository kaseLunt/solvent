### Task 9 — wave 7: round-6 fix (chain layer) — strict quantity decoding

Repo `C:\Users\kasel\source\repos\etherfi\Solvent`, branch `main`. Base: current HEAD at
start. Read `.superpowers/sdd/task-9-codex-round6.md` (verbatim + adjudication),
`task-9-wave6-report-p2.md`. CLOSED — everything prior rounds confirmed. This wave is
SURGICAL: one finding, one fix, two mandated regressions.

## F1 [medium] — empty JSON quantities bypass the gate (`chain.go:84-88`)

v1.13.0's `*hexutil.Big`/`*hexutil.Uint64` decode `""` as zero (non-nil), so
`"timestamp":""` passes presence as epoch and `"number":""` passes HeadFrom as height 0 —
the F2 failover-stopping class through the library's decode leniency.

**Do (Codex's recommendation, binding):** decode number and timestamp (and audit hash /
parentHash string fields for the analogous leniency — fixed-length hex must be exactly
that) through STRICT raw/string wrappers that reject empty and non-canonical JSON
quantities BEFORE conversion; violation = failed attempt = rotation. State the rule at
the wrapper: "the response must answer the question asked" holds at the BYTES level — a
quantity that is not a canonical JSON quantity is a protocol violation regardless of what
convenience decoders tolerate.

**Regressions (binding):** real-Dial raw-JSON tests where `"timestamp":""` and
`"number":""` each FAIL the attempt and the healthy secondary DEMONSTRABLY LANDS
HeaderTime and HeadFrom respectively (full landing, not merely primary-skipped). Extend
the malformed-hex matrix beyond `0xnope`: `""`, `"0x"`, leading-zero non-canonical forms
if the wrapper rejects them — pin exactly what the wrapper's canon IS. Mutations: the
strict wrapper's empty-rejection arm (property: an empty quantity can never become a
value), one per wrapped field; committed applier per wave-16 rule.

## Scope & environment (binding, unchanged from wave 6)

Touch ONLY `internal/chain/**`, `.superpowers/sdd/**`. NEVER anything else. Pathspec
staging. **Backfill daemon RUNNING** against DB `solvent` — tests on `solvent_t9w1`
(`TEST_DATABASE_URL='postgres://solvent:solvent@localhost:5432/solvent_t9w1?sslmode=disable'`);
never stop the daemon/container. Commit before mutation loops; in-memory restores;
CRLF-aware patching; committed-blob gofmt via `git cat-file` → temp files. Baseline at
start commit (top-level `^--- PASS`; wave-6 final 622/0/0 at `15a4e11` code tip, gate ON
— state your `SOLVENT_LIVE_RPC_TESTS` posture both runs); zero FAIL/SKIP; build/vet/gofmt
READ; `-race` (prices+chain) in `golang:1.24` via `host.docker.internal`;
`dangerouslyDisableSandbox: true` + PATH export.

## Reporting

`.superpowers/sdd/task-9-wave7-report-p2.md`: the wrapper's canon (exactly what is
rejected and why), both rotation regressions cited, mutation matrix, anything unverified.
Returns to Codex under D-006 — expected closing round for the chain reopen.
