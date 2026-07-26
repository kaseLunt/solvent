### Task 9 — wave 1: poller anchor acquisition is impossible on real EVM (P0)

Repo `C:\Users\kasel\source\repos\etherfi\Solvent`, branch `main`. Base: current HEAD at start
(`git log` first — controller commits ledger/brief around your start).

## The defect (live-proven; read the ledger entry dated 2026-07-26 first)

`Poller.readRound` (poller.go:791-867) anchors each round to the `blockHash` output of
Multicall3 `tryBlockAndAggregate`. On-chain that field is `blockhash(block.number)`, and EVM
BLOCKHASH serves only the 256 blocks BEFORE the executing one — **the field is
deterministically zero on every real chain** (controller proved it live: empty
tryBlockAndAggregate on ETH mainnet at 25,615,440 → 0x000…0; both daemons' pollers refuse
every round, 0 anchors ever written). The zero-hash guard at prices.go:511-512 is CORRECT
paranoia and stays. The atomic premise ("hash and observations from one execution context")
is simply unavailable via eth_call. The snapshotter is NOT affected — its own
`unpackMulticallResult` (snapshot.go) never reads the hash field. Do not touch it.

**Why every review missed it:** all poll fakes return a NONZERO multicall blockHash — a
value physically impossible on real EVM. That is the fixture-realism failure to fix
alongside the code.

## The fix (mirror the walker's reviewed coherent-window pattern, walker.go Step)

Recompose `readRound` as an **endpoint-coherent, block-pinned round**:

1. Resolve the serving endpoint FIRST, respecting the existing `exploreStart` /
   `preferredStart` / default machinery and its ambiguity rules (d1e7d54) — then perform
   EVERY read of the round from that one endpoint (`HeadFrom`/`HeaderHashFrom`/`CallFrom`
   style; the Failover already has the `doFrom` discipline).
2. `N` := that endpoint's head; `hashBefore` := HeaderHash(N) from it.
3. eth_call the multicall **pinned at block N** — this needs an additive block-pinned call
   variant on `chain.Failover` (mirror the existing Call/CallFrom/CallWithToken trio's
   composition and token discipline; additive only).
4. Require the multicall's returned `blockNumber == N` — else DISCARD the round (serving
   inconsistency; retry next cadence).
5. `hashAfter` := HeaderHash(N) from the same endpoint; require `hashAfter == hashBefore`
   — else DISCARD (mid-round reorg; the walker's tip-changed posture, same log shape).
6. Anchor = `(N, hashBefore)`. The multicall's own blockHash output is **ignored**, with a
   comment stating WHY (EVM BLOCKHASH semantics; Multicall3 gotcha) — sweep and fix every
   comment that claims the multicall supplies the anchor hash.
7. Keep the zero-hash refusal for the HEADER path (a header hash of zero is a provider
   protocol violation).

Optional strong variant (your + Codex's judgment, not required): prepend
`getBlockHash(N-1)` as call #0 for an in-call parent witness verified against
HeaderHash(N-1). State the honest limit either way: a fork diverging exactly at N with an
identical parent is caught by the before/after pin, not atomically — the same residual the
walker accepts.

Downstream semantics (00007 per-observation `anchor_block` binding, D-012 classification,
neutralization) are UNCHANGED — this wave fixes acquisition, not meaning. No migration.

## Test integrity (binding; the six rules apply)

- **Fixture realism is the headline:** the fake multicall MUST now return a ZERO blockHash
  (real-EVM behavior). A test must pin the property: the poller anchors WITHOUT consuming
  the multicall hash field.
- Regressions: happy path anchors (N, hashBefore) on the realistic fake; `blockNumber != N`
  discard; `hashAfter != hashBefore` discard; header-zero refusal retained; endpoint
  coherence (fake chain records which token served each call; assert one token per round);
  live-store test that a real round writes `price_poll_anchors` + bound observations
  (00007 semantics unchanged).
- Mutations: every new guard arm, each stating the PROPERTY it certifies. Commit the
  applier per the wave-16 class rule if you use one.

## Scope & environment (binding)

- Touch ONLY `internal/prices/**`, `internal/chain/chain.go` + `chain_test.go` (additive
  pinned-call variant), `.superpowers/sdd/**`. NEVER `internal/snapshot/**`,
  `cmd/indexer/**`, `internal/store/**`, `roadmap/**`, migrations. Pathspec staging only.
- **THE TASK 9 BACKFILL DAEMON IS RUNNING** against DB `solvent` and holds the writer
  advisory lock. Do NOT stop it, do NOT restart the container, do NOT point tests at its
  DB. Create a dedicated DB first:
  `docker exec solvent-db-1 psql -U solvent -d postgres -c "CREATE DATABASE solvent_t9w1 OWNER solvent;"`
  then `export TEST_DATABASE_URL='postgres://solvent:solvent@localhost:5432/solvent_t9w1?sslmode=disable'`.
- Commit before mutation loops; in-memory restores only (never `git checkout`).
- Baseline at your start commit, top-level `^--- PASS` convention stated; zero FAIL/SKIP;
  build/vet/gofmt (READ the output); `-race` in `golang:1.24` via `host.docker.internal`;
  `dangerouslyDisableSandbox: true` + PATH export `"$PATH:/c/Program Files/Go/bin:/c/Users/kasel/go/bin"`.

## Reporting

`.superpowers/sdd/task-9-wave1-report-p2.md`: the recomposition, every guard cited to its
test, the fixture-realism change, mutation matrix, anything unverified. Returns to Codex
(prices unit) under D-006 — the controller restarts the backfill daemon onto the fixed
binary only after approval.
