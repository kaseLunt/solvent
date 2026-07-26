### Task 9 — wave 5: provider-reported header hashes (chain layer; reopens approved surface)

Repo `C:\Users\kasel\source\repos\etherfi\Solvent`, branch `main`. Base: current HEAD at
start (`git log` first — round-4 archive commits may interleave). **Do not start while any
other wave is unmerged in `internal/chain`/`internal/prices` — the controller dispatches
you only when the tree is serial again.**

Read FIRST: the ledger entry "P0 ROOT CAUSE #2, FORENSICALLY PROVEN" near the end of
`.superpowers/sdd/progress-phase2.md`, and `r001-probe/hashcheck.go` (the committed
forensic probe). Then `task-9-wave1-report-p2.md` §recomposition (where `hashBefore`
comes from) and `internal/chain/chain.go` (`HeaderHash`, `HeaderHashFrom`, `HeadFrom`,
`Head`, `HeaderTime`, and wave-4's `doFromAttempts`).

## The defect (live-proven)

go-ethereum v1.13.0's `types.Header` cannot represent the 2026 OP-mainnet header shape,
so `h.Hash()` — keccak over the re-RLP-encoded KNOWN fields — is silently non-canonical
for every modern OP block: computed `0x70f6bea2…` vs canonical `0x3d957321…` at
150,105,227 (hashcheck.go, MATCH false). Provider data was proven canonical on both OP
providers for the exact stalled range. Consequences: the OP walker is wedged on the
tip-log equality check (the only computed-vs-reported comparison); every stored OP
`ingest_cursors.last_block_hash` is computed-garbage; the wave-1/2/3 EIP-1898 pin would
present an unrecognizable hash on OP and discard forever.

## The fix — one principle

**The chain layer never locally recomputes a header hash again.** Every hash the Failover
hands out is the provider-REPORTED `hash` field of `eth_getBlockByNumber` (raw
`rpc.CallContext` into a minimal header struct — hash, number, parentHash, timestamp; the
zero/absent-hash refusal stays, it is a protocol violation). State the trust posture at
the type: local recomputation was a FALSE guarantee (cite hashcheck.go) — L2 consensus is
not locally verifiable, and reported hashes keep every cross-check meaningful (reorg
detection compares reported-now vs reported-then; the walker's tip-log equality compares
provider-internal values; the EIP-1898 pin round-trips the same identity back to the
node).

Sweep EVERY hash-bearing path: `HeaderHash`, `HeaderHashFrom`, `Head`/`HeadFrom` (their
hash field), and whatever wave 1 used for `hashBefore` (if it flows from `HeadFrom`, the
poller may need ZERO changes — verify and say so). `HeaderTime` may share the raw fetch
but its field use was never wrong. `TxCalldata`, `VerifyChainID`, `CallAtHashFrom`
untouched. This REOPENS approved chain-layer behavior consumed by the decode/runner units
under D-006 — the walker itself must NOT change (the fix is beneath it), but say loudly in
the report if any `internal/ingest` test breaks: STOP rather than touch ingest.

## Harness (fixture realism is again the headline)

- The fake chain gains an OP-SHAPED header: one whose reported hash deliberately differs
  from what re-RLP-hashing its known fields would produce. Regression: `HeaderHash`
  returns the REPORTED value for it (the v1.13.0-revert mutant — swap back to `h.Hash()`
  — must be killed by exactly this).
- LIVE pinned regression against the incident block (network-gated, follow the
  `poller_live_test.go` gating conventions): `HeaderHash(op, 150105227) ==
  0x3d9573215de44873740c98df8ad6c062c85b6135cbcbd0cc62381f886d07fe23` via
  mainnet.optimism.io. Skip cleanly when the network/env gate is absent.
- Round-trip regression: the poller's pinned call on the OP-shaped fake lands (the pin
  presents the reported hash and the fake recognizes it) — the exact composition that was
  impossible before this wave.
- Zero-hash refusal retained (header with zero hash → error, never anchor).
- Mutations: the revert-to-recomputation mutant, the zero-hash guard, the reported-hash
  plumbing through Head/HeadFrom. Properties stated; committed applier per wave-16 rule.

## Scope & environment (binding)

Touch ONLY `internal/chain/**`, `internal/prices/**` (only if the hashBefore path
genuinely needs it — justify), `.superpowers/sdd/**`. NEVER `internal/ingest/**`,
`internal/snapshot/**`, `cmd/**`, `internal/store/**`, migrations, `roadmap/**`. Pathspec
staging. **Backfill daemon RUNNING** against DB `solvent` (ETH arm active; OP arm wedged
by this very defect — leave it) — tests on `solvent_t9w1`
(`TEST_DATABASE_URL='postgres://solvent:solvent@localhost:5432/solvent_t9w1?sslmode=disable'`);
never stop the daemon/container. Commit before mutation loops; in-memory restores;
CRLF-aware patching; committed-blob gofmt via temp files. Baseline at start commit
(top-level `^--- PASS`; wave-4 final 604/0/0 at code tip `0a46218`); zero FAIL/SKIP;
build/vet/gofmt READ; `-race` (prices+chain) in `golang:1.24` via `host.docker.internal`;
`dangerouslyDisableSandbox: true` + PATH export.

Post-approval steps are CONTROLLER work, not yours: OP stream state reset (cursors +
chain-10 rows), daemon restart on the approved stack, OP re-walk, live anchor
verification.

## Reporting

`.superpowers/sdd/task-9-wave5-report-p2.md`: the reported-hash design, the consumer
sweep table (every hash-bearing path converted-or-justified), whether the poller needed
changes, every regression cited to its test, mutation matrix, anything unverified.
Returns to Codex under D-006 — and state plainly that this wave reopens approved
chain-layer surface.
