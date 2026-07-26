### Task 9 — wave 9: round-8 fix (chain layer) — authenticate the body, not the label

Repo `C:\Users\kasel\source\repos\etherfi\Solvent`, branch `main`. Base: current HEAD at
start. Read `.superpowers/sdd/task-9-codex-round8.md` (verbatim + the recomputation-line
adjudication — put that line in the code comment), `task-9-wave8-report-p2.md`. This wave
is SURGICAL: one finding, one fix, one inverse regression. Everything else is closed law.

## F1 [medium] — `tx.Hash()` must equal the hash asked (`chain.go:720-730`)

The reported `hash` field authenticates nothing — `types.Transaction.UnmarshalJSON`
ignores it; it is the provider agreeing with itself. **Do:** after decode, require
`tx.Hash() == asked hash`; mismatch = protocol violation = failed attempt = rotation.
Keep the reported-field equality check too if you wish (cheap, catches sloppier lies
earlier) but the DECODED comparison is the gate. Comment carries the adjudication's
recomputation line verbatim (banned for headers / required for signed tx bodies, and
why both follow from one principle: authenticate with the strongest tool the type model
makes sound).

**Regression (binding, the inverse of wave 8's):** real-Dial — reported hash EQUALS the
request but the signed body/input belongs to another transaction; the attempt FAILS and
the secondary's calldata LANDS. (Craft the body by signing/encoding a different valid tx
with the test key material the suite already uses, or lift a canonical fixture; the
response's `hash` field lies affirmatively.) **Mutation:** remove the decoded comparison
→ killed by exactly this regression; property: echoing the label cannot authenticate the
body.

## Scope & environment (binding, unchanged)

Touch ONLY `internal/chain/**`, `.superpowers/sdd/**`. Pathspec staging. **Backfill
daemon RUNNING** against DB `solvent` — tests on `solvent_t9w1`
(`TEST_DATABASE_URL='postgres://solvent:solvent@localhost:5432/solvent_t9w1?sslmode=disable'`);
never stop the daemon/container. Commit before mutation loops; in-memory restores;
CRLF-aware patching; committed-blob gofmt via `git cat-file` → temp files. Baseline at
start commit (top-level `^--- PASS`; wave-8 final 632/0/0 at code tip `f0a5560`, gate ON
— state posture both runs); zero FAIL/SKIP; build/vet/gofmt READ; `-race` (prices+chain)
in `golang:1.24` via `host.docker.internal`; `dangerouslyDisableSandbox: true` + PATH
export.

## Reporting

`.superpowers/sdd/task-9-wave9-report-p2.md`: the fix, the inverse regression cited, the
mutation, anything unverified. Returns to Codex under D-006 — expected CLOSING round for
the chain-layer reopen.
