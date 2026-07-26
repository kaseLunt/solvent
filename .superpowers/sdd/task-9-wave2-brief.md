### Task 9 — wave 2: round-1 fixes (prices unit)

Repo `C:\Users\kasel\source\repos\etherfi\Solvent`, branch `main`. Base: current HEAD at start
(`git log` first — controller commits archive/ledger around your start).

Codex round 1 (prices): **NO-SHIP — 1 high, 1 medium; both ACCEPTED.** Read
`.superpowers/sdd/task-9-codex-round1.md` (verbatim + adjudication),
`task-9-wave1-report-p2.md`, `task-9-wave1-brief.md`. Do not re-open what round 1 did not
question: the pin-and-verify composition, the fixture-realism change, 00007 binding.

## F1 [high] — a coherence discard must MOVE the round's starting point (`poller.go:896-903`)

Endpoint 0 serving heads while permanently failing pinned calls starves the poller forever:
every cadence re-resolves endpoint 0, discards on token mismatch, writes nothing. The
discard is correct; the routing state is not. This is the fail-closed-not-fail-forever
class (wave 13 starvation, wave 15 rotation liveness — read those ledger entries).

**Do (Codex's recommendation):** on EVERY coherence/serving-inconsistency discard (call
token mismatch, closing-header token mismatch, blockNumber != N, hash-pin failure below),
advance the CALLER-SCOPED exploration start to a viable alternate endpoint — never write
the shared routing hint (preserve d1e7d54's ambiguity rules; state the invariant in a
comment: a discard that cannot name a healthy endpoint must at least ensure the NEXT round
starts somewhere else). **Harness:** a multi-cadence test — endpoint 0 serves heads,
permanently fails eth_call; assert the NEXT cadence lands a full round through endpoint 1
(anchor + observations written), not merely that the first round discards. Mutation on the
routing-state transition (property: a coherence discard advances the next round's start).

## F2 [medium] — bind execution to the hash: EIP-1898 pinned eth_call (`prices.go:99-104` + `poller.go`)

The wave-1 anchor attested the header path, not the eth_call backend: one lb hostname is
many nodes, so headers from fork A and a number-pinned call served by fork B at the same
height pass every guard — fabrication returns through the side door. Codex offered
document-the-limitation or strengthen; the controller PROVED the strengthening viable and
wave 2 takes it:

**Live matrix (controller, 2026-07-26, in the ledger):** EIP-1898 `eth_call` with
`{"blockHash": h}` executed exactly at the pinned block on ALL FOUR reachable endpoints
(drpc-keyed eth+op, mainnet.optimism.io, publicnode-eth), and a fabricated hash was
REJECTED ("block not found") on all four — negative controls included.

**Do:**
- Change the pinned call to EIP-1898 form: pin to **`hashBefore` itself** (the block-hash
  object form; default `requireCanonical` — absence-of-fork detection stays the anchor
  machinery's job, the pin's job is identity). The additive chain method becomes/gains a
  hash-pinned variant (`CallAtHashFrom` or refit `CallAtFrom` — your call; keep the token
  discipline; additive to `Failover`, snapshotter untouched).
- A "block not found"-class rejection is a DISCARD (+ F1's routing advance — the serving
  node may genuinely lack the fork; that is exploration-worthy information, not an error
  loop).
- With execution hash-bound, decide and DOCUMENT whether the closing `HeaderHash(N)`
  re-read still earns its RPC (it no longer guards fabrication — the pin does). Either
  keep it with a stated reason or drop it with the reasoning in the round contract.
- Rewrite the package contract at `prices.go:99-104`: remove the stale Multicall3-hash
  claim entirely; state precisely what the anchor now attests — execution pinned to
  `hashBefore` by EIP-1898, honest trust boundary being the node's implementation of the
  pin (cite the live matrix's negative controls as the observed behavior class).
- Sweep for any other prose still claiming multicall-supplied or header-path-only
  provenance (the round-13/14 lesson: close the class, then re-audit citations once).

**Harness:** same-height split-fork regression — fake chain models two backends behind one
endpoint token at height N (fork A headers, fork B state); with the hash pin the round
must land on A's state or discard, NEVER store B's observations under A's hash. The fake's
hash-pinned call must REJECT unknown hashes (mirror the observed "block not found"
behavior). Mutations: the pin argument (hash→number regression must be KILLED by the
split-fork test), the rejection-to-discard arm, the F1 transition.

## Scope & environment (binding, unchanged from wave 1)

Touch ONLY `internal/prices/**`, `internal/chain/chain.go` + `chain_test.go`,
`.superpowers/sdd/**`. NEVER `internal/snapshot/**`, `cmd/indexer/**`, `internal/store/**`,
migrations, `roadmap/**`. Pathspec staging. **The backfill daemon is STILL RUNNING against
DB `solvent`** — dedicated test DB `solvent_t9w1` exists; export
`TEST_DATABASE_URL='postgres://solvent:solvent@localhost:5432/solvent_t9w1?sslmode=disable'`.
Never stop the daemon or the container. Commit before mutation loops; in-memory restores.
Baseline at your start commit (top-level `^--- PASS` convention; wave-1 final was 587);
zero FAIL/SKIP; build/vet/gofmt (READ output; committed-blob check for CRLF);
`-race` in `golang:1.24` via `host.docker.internal`; `dangerouslyDisableSandbox: true` +
PATH export `"$PATH:/c/Program Files/Go/bin:/c/Users/kasel/go/bin"`.

## Reporting

`.superpowers/sdd/task-9-wave2-report-p2.md`: both fixes, every guard cited to its test,
the split-fork regression, the re-read keep/drop decision with reasoning, mutation matrix,
anything unverified. Returns to Codex (prices unit) under D-006.
