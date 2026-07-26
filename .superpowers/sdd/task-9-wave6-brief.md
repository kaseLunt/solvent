### Task 9 — wave 6: round-5 fixes (chain layer) — the response must answer the question asked

Repo `C:\Users\kasel\source\repos\etherfi\Solvent`, branch `main`. Base: current HEAD at
start. Read `.superpowers/sdd/task-9-codex-round5.md` (verbatim + adjudication),
`task-9-wave5-report-p2.md`. CLOSED — do not re-open: the reported-hash principle itself
(structurally sound), the EIP-1898 pin, the routing seam, aggregate classification.

## The rule (state it at the validation site)

Trusting the provider's REPORTED fields must be paired with verifying the response
ANSWERS THE QUESTION ASKED. A well-formed response for the wrong height, or one missing a
required field, is a PROTOCOL VIOLATION → the attempt FAILS → rotation proceeds — exactly
the zero-hash posture, uniformly applied.

## F1 [high] — exact-height equality for every numbered read (`chain.go:90-100`)

`validateReportedHeader` never compares `Number` to the requested height; a proxy
answering `latest` for numeric requests passes, poisoning HeaderTime freshness and walker
ancestry (spurious mass rewind instead of rotation).

**Do:** pass the expected height into validation; require exact equality on every
numbered read (head reads validate internal consistency only). Mismatch = failed attempt
→ next endpoint. **Regressions (Codex's, binding):** a mismatched response ROTATES to the
healthy next endpoint; a mismatched response can never influence walker ancestry
(cursor-height reads) or HeaderTime.

## F2 [medium] — required-field presence tracking (`chain.go:75-99`)

Non-pointer `Time` decodes an omitted `timestamp` as zero and passes — the old
types.Header decoder rejected it. Epoch-aged heads make failover STOP at a malformed
primary instead of reaching a healthy secondary.

**Do:** presence-tracked decode (pointer fields or explicit raw-message checks) for every
required field (hash, number, timestamp, parentHash); absence = protocol violation →
failed attempt → rotation, BEFORE the attempt is marked successful. Fix the wave-5 report
claim it contradicts (note the correction in your report; the wave-5 report itself is
immutable history — do not edit it).

## Harness — the missing fixture layer

Hermetic RAW-JSON adapter tests BELOW the rpcClient fake seam (drive the actual decode +
validation with crafted JSON, no fake chain): missing hash / missing timestamp / missing
number; `null` result (block beyond head — distinguish from protocol violation: null is a
legitimate "not found" that must surface as such, not as a zero header); malformed hex;
wrong-height well-formed response; and the ROTATION assertions (each violation rotates,
a healthy secondary lands the round). Mutations: the height-equality check, each
required-field presence check, the null-vs-violation discrimination. Properties stated;
committed applier per wave-16 rule.

## Scope & environment (binding)

Touch ONLY `internal/chain/**`, `.superpowers/sdd/**`. `internal/prices/**` only if a
signature genuinely forces it (justify loudly). NEVER `internal/ingest/**`,
`internal/snapshot/**`, `cmd/**`, `internal/store/**`, migrations, `roadmap/**`. Pathspec
staging. **Backfill daemon RUNNING** against DB `solvent` — tests on `solvent_t9w1`
(`TEST_DATABASE_URL='postgres://solvent:solvent@localhost:5432/solvent_t9w1?sslmode=disable'`);
never stop the daemon/container. Commit before mutation loops; in-memory restores;
CRLF-aware patching; committed-blob gofmt via temp files. Baseline at start commit
(top-level `^--- PASS`; wave-5 final 613/0/0 at `ce21cd3` WITH `SOLVENT_LIVE_RPC_TESTS=1`
— state your gate posture explicitly both runs); zero FAIL/SKIP; build/vet/gofmt READ;
`-race` (prices+chain) in `golang:1.24` via `host.docker.internal`;
`dangerouslyDisableSandbox: true` + PATH export.

## Reporting

`.superpowers/sdd/task-9-wave6-report-p2.md`: both gates, the raw-JSON fixture layer,
every regression cited to its test, the null-vs-violation semantics, mutation matrix,
anything unverified. Returns to Codex under D-006 — expected closing round for the chain
reopen.
