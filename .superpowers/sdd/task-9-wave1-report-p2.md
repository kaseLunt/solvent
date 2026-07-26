# Task 9 — wave 1 report (P2): poller anchor acquisition recomposed for real EVM

Brief: `.superpowers/sdd/task-9-wave1-brief.md`. Base: `13ea0da` (the brief/ledger commit).
Implementation commits, in order, all pathspec-staged on `main`:

| commit | contents |
|---|---|
| `463b344` | the recomposition: `readRound` endpoint-coherent + block-pinned, additive `chain.Failover.CallAtFrom`, decoder drops the multicall hash, fixture-realism change, full regression-fleet adaptation |
| `84ca9d2` | the new guard tests + the live-store durable-footprint test |
| `53c0688` | mutation matrix spec (`.superpowers/sdd/t9w1-mutations/mutations.json`, run through the wave-16 committed applier) |
| `47ac763` | mutation transcript — 13/13 killed at `53c0688` |
| (this report's commit) | `.superpowers/sdd/task-9-wave1-report-p2.md` |

Code is untouched after `84ca9d2`; every later commit is `.superpowers/sdd/**` only.

## Test counts (top-level `^--- PASS` convention: `go test -v -count=1 ./...` piped through `grep -c '^--- PASS'`, subtests indented and not counted)

- **Baseline at `13ea0da`: 577 PASS, 0 FAIL, 0 SKIP** — measured in a clean `git worktree` of the start
  commit (the working tree already carried edits when the first baseline attempt ran, so it was
  discarded and re-measured clean), with `TEST_DATABASE_URL` pointed at the wave's dedicated DB.
- **Final (code state `84ca9d2`): 587 PASS, 0 FAIL, 0 SKIP**, exit 0, same convention, same DB.
- Delta +10 = new tests (+7 poller guard tests, +1 live-store, +2 chain `CallAtFrom`, +2 unpack
  tests replacing the 2 deleted ones — `TestUnpackMulticallKeepsBlockHash` and
  `TestUnpackMulticallRefusesZeroBlockHash` asserted the defect and are gone).

## Environment discipline

The Task 9 backfill daemon (DB `solvent`, writer advisory lock) was never stopped, and no test ever
pointed at its database. First action of the wave:
`docker exec solvent-db-1 psql -U solvent -d postgres -c "CREATE DATABASE solvent_t9w1 OWNER solvent;"`,
then `TEST_DATABASE_URL='postgres://solvent:solvent@localhost:5432/solvent_t9w1?sslmode=disable'`
for every test run (live tests additionally schema-isolate themselves inside it).

## 1. The recomposition

The defect (ledger 2026-07-26, live-proven): `readRound` anchored each round to multicall3
`tryBlockAndAggregate`'s `blockHash` output, which is `blockhash(block.number)` — out of BLOCKHASH's
256-ancestor range for the executing block, therefore **deterministically zero on every real
chain** — so the (correct) zero-hash guard refused every round on both chains. The atomic premise
"hash + observations from one execution context" does not exist via `eth_call`.

`readRound` (internal/prices/poller.go) is now the walker's reviewed coherent-window pattern
(`ingest.Walker.Step`), transplanted to `eth_call`:

1. **Resolve ONE serving endpoint** via `HeadFrom(start)`, where `start` honours the existing
   routing machinery unchanged in shape and precedence: `exploreStart` if set, else
   `preferredStart` if set, else the shared hint via the new `ActiveEndpoint()` read (READ, never
   written — a caller-scoped round must not fight error-driven routing; same discipline the feed
   deriver already uses). Whichever endpoint answers the head read IS the round's endpoint.
2. **N := that endpoint's head; `hashBefore` := HeaderHash(N)** — taken from the head header
   itself, so N and its hash come from one response on one endpoint.
3. **Zero-hash refusal, relocated**: a zero `hashBefore` (or later `hashAfter`) is refused as a
   provider protocol violation *before any multicall is issued*. The guard the decoder used to
   apply to the wrong hash now protects the hash the anchor actually rests on.
4. **Multicall PINNED AT N** via the additive `chain.Failover.CallAtFrom` (below), started at the
   round's endpoint; an answer the failover served from any other endpoint DISCARDS the round.
5. **`blockNumber == N` required** — the one atomic fact the response carries about its own
   execution context; divergence (a serving inconsistency behind one URL) DISCARDS.
6. **`hashAfter` := HeaderHash(N) re-read from the same endpoint** (token-checked); mismatch with
   `hashBefore` is a mid-round reorg and DISCARDS with the walker's exact posture and log shape
   (`"tip changed mid-round, discarding round"` / warn / no error / nothing recorded / the
   already-spent cadence slot prevents a retry storm). `Step` maps a discard to `(false, nil)`.
7. **Anchor = (N, hashBefore)**; observations are stamped with N. The multicall's hash output is
   decoded (a malformed word still refuses the response) but its value never leaves
   `unpackMulticallResult` — the signature (now matching the snapshotter's own copy) carries no way
   to retrieve it, so no caller can anchor to it. The WHY is stated at the decoder, at
   `multicall3ABI`, and in the package comment.

Downstream semantics are UNCHANGED: `ApplyPolledPrices` still writes the anchor in the round's own
transaction, 00007's per-observation `anchor_block` binding and D-012 classification are untouched
(proven live, below); no migration. `internal/snapshot`, `cmd/indexer`, `internal/store` untouched.

### The additive chain method

`chain.Failover.CallAtFrom(ctx, startIndex, to, data, block)` — `CallFrom`'s exact composition and
token discipline (caller-scoped start over `doFrom`, shared hint neither read nor written, token
names the server, `Index:-1` on total failure) plus the block pin forwarded to `CallContract`. The
doc states the pin is a *request*, not a proof — which is exactly why readRound cross-checks the
returned `blockNumber`. Nothing else in chain.go changed; `Call`/`CallWithToken`/`CallFrom` remain
(the snapshotter uses them).

### Interface change (internal/prices only)

`PollChain` is now `HeadFrom + CallAtFrom + HeaderHashFrom + ActiveEndpoint + EndpointCount`;
`CallWithToken`/`CallFrom` are dropped from the interface (a method the interface does not carry
cannot be called — the same structural argument PollStore already makes). `*chain.Failover` still
satisfies it via the existing compile-time assertion, so `cmd/indexer` needed (and received) no
edit.

### Honest limits, stated

- A fork diverging at exactly N is caught by the before/after pin only if it lands between the two
  header reads; one landing after `hashAfter` is caught by the next round's anchor-divergence check
  or by repair — the same TOCTOU residual the walker's reviewed window accepts, now stated in
  readRound's doc.
- **The optional strong variant (a `getBlockHash(N-1)` call #0 as in-call parent witness) was NOT
  implemented** — judgment call, allowed by the brief. Its only marginal coverage over
  blockNumber==N + endpoint coherence + the before/after pin is a provider serving *different
  forks to its eth_call and header paths at the same height simultaneously*; against that adversary
  the witness is also not decisive (the paths could disagree above N-1). It would complicate the
  request shape (index offset on every decode path) for every round to cover it partially. If Codex
  judges the residual worth closing, it is a small additive follow-up.

## 2. Fixture realism (the headline)

Every poll fake used to return a NONZERO multicall `blockHash` — physically impossible on real EVM,
and the reason 16 waves and 14 Codex rounds missed the P0. Now:

- `encodeMulticall` (the fleet's default response builder) embeds the **ZERO** hash, with the
  fixture-realism rule written at the builder. Every existing poll test therefore now exercises the
  real-chain shape; a test that wants a nonzero value must say so explicitly
  (`encodeMulticallWithHash`), and the only such uses are tests *proving the field is ignored*.
- `fakePollChain` gained scripted per-endpoint HEADS (`setHead`/`setHeadOn`, refusing rounds against
  chains a test never described) and models the real `doFrom` failover walk on **every** read
  (`HeadFrom`, `CallAtFrom`, `HeaderHashFrom`), stamping tokens with the endpoint that actually
  answered — which is what makes the coherence guards testable at all. It also records
  `headStarts`/`headServed`/`atBlocks`, the evidence the routing and pin assertions read.
- `blockHashAt` is re-documented as the stand-in for HEADER hashes only.

## 3. Every guard, cited to its test (all in `internal/prices/poller_test.go` unless noted)

| guard | test |
|---|---|
| anchors happy-path as (N, hashBefore) on the realistic (zero-hash) fake | `TestPollerRoundPersistsHashAnchor` |
| anchors WITHOUT consuming the multicall hash field (poisoned nonzero fed and ignored) | `TestPollerAnchorsWithoutConsumingMulticallHashField` |
| real-EVM zero multicall hash decodes cleanly; nonzero equally ignored | `TestUnpackMulticallAcceptsRealChainZeroBlockHash`, `TestUnpackMulticallIgnoresNonzeroBlockHash` (prices_test.go) |
| one token serves every read; multicall pinned at the resolved head | `TestPollerRoundIsEndpointCoherentAndPinnedAtHead` |
| `blockNumber != N` → discard, nothing recorded, slot spent | `TestPollerDiscardsRoundWhenExecutionBlockDivergesFromPin` |
| `hashAfter != hashBefore` → discard (walker posture + log shape) | `TestPollerDiscardsRoundOnMidRoundReorg` |
| multicall served by another endpoint → discard | `TestPollerDiscardsRoundWhenMulticallServedByAnotherEndpoint` |
| closing re-read served by another endpoint → discard | `TestPollerDiscardsRoundWhenClosingRecheckServedByAnotherEndpoint` |
| header-zero refusal retained, both bracketing reads, before-arm positioned before RPC spend | `TestPollerRefusesZeroHeaderHash` (`/before`, `/after`) |
| default routing resolves from the shared hint; pin/explore precedence over it | `TestPollerRoundIsEndpointCoherentAndPinnedAtHead`, `TestPollerStaleEndpointPinsNextEndpointAfterVerifyingFrontier`, `TestPollerRepeatedCauseUnknownExploresAlternateEndpointsUntilProgress` |
| live: a real round writes `price_poll_anchors` (N, hashBefore) + 20 rows each `anchor_block = N`, `valid`, cursor at N — 00007 unchanged | `TestPollerLiveRoundWritesAnchorAndBoundObservations` (poller_live_test.go, schema-isolated real store) |
| chain: pin forwarded to eth_call; `Call` stays "latest"; caller-scoped start; hint untouched; rotation + `-1` token | `TestCallAtFromPinsBlockAndLeavesSharedHintAlone`, `TestCallAtFromWrapsModuloAndRotatesOnError` (internal/chain/chain_test.go) |

Adapted regressions worth naming: the stale-endpoint/exploration/ambiguity fleet now asserts
routing through `headStarts`/`headServed` (the resolution IS the routing decision now);
`hashCalls` assertions that used to be "empty" now name the rounds' own closing re-reads, which
keeps "no ancestry probe was issued" as a real assertion instead of deleting it;
`TestPollerRegressionWithFailedAncestryProbeSuppressesRotation` scripts the probe outage per-height
(`failProbe(5000)`) so the outage hits the ancestry check alone, not the round's own reads.

## 4. Mutation matrix

Run per the wave-16 class rule through the committed applier
(`.superpowers/sdd/wave16-mutations/mutate.py`: exactly-one-occurrence assertion, byte-level
backups, in-memory restores verified byte-identical — never `git checkout`). Spec:
`.superpowers/sdd/t9w1-mutations/mutations.json`; transcript (tested SHA `53c0688`, whole packages
run so kills attribute to real tests): `.superpowers/sdd/t9w1-mutations/transcript.md`.

**13 mutants, 13 killed, 0 survived.** Per mutation, the property it certifies:

| id | mutation | property certified | killed by (headline) |
|---|---|---|---|
| M1 | decoder refuses zero multicall hash again | the real-EVM zero decodes cleanly — refusing it is the P0 | 43 tests incl. `TestUnpackMulticallAcceptsRealChainZeroBlockHash`, the live test, every landed-round regression |
| M2 | `block != pin` guard off | an off-pin multicall can never land | `TestPollerDiscardsRoundWhenExecutionBlockDivergesFromPin` |
| M3 | `hashAfter != hashBefore` off | a mid-round reorg never writes an anchor | `TestPollerDiscardsRoundOnMidRoundReorg` |
| M4 | multicall coherence check off | another endpoint's answer cannot join the round | `TestPollerDiscardsRoundWhenMulticallServedByAnotherEndpoint` |
| M5 | re-read coherence check off | the close must be the round's own endpoint's | `TestPollerDiscardsRoundWhenClosingRecheckServedByAnotherEndpoint` |
| M6 | zero-hash refusal (before) off | zero header hash refused BEFORE any RPC spend | `TestPollerRefusesZeroHeaderHash/before` (its `Empty(ch.calls)` assertion is the load-bearing one) |
| M7 | zero-hash refusal (after) off | zero on the close is an ERROR, never a silent discard | `TestPollerRefusesZeroHeaderHash/after` |
| M8 | Step's discard arm off | a discarded round records NOTHING | all four discard tests |
| M9 | anchor hash zeroed at Step | the anchor persists the verified header hash bytes | `TestPollerRoundPersistsHashAnchor`, live test, 2 more |
| M10 | multicall pinned at N+1 | pinned height == header-verified height | `TestPollerRoundIsEndpointCoherentAndPinnedAtHead` |
| M11 | default start hard-coded 0 | default resolution follows the shared hint | coherence + stale-endpoint tests |
| M12 | chain pin dropped to latest | the pin is forwarded to eth_call | both `CallAtFrom` tests |
| M13 | chain walk starts past caller's index | caller-scoped start discipline | both `CallAtFrom` tests |

Disclosed exclusions (in the spec's meta, verbatim): two **equivalent mutants** (observations
stamped with the multicall's block instead of the pin; anchor to `hashAfter` instead of
`hashBefore`) are equivalent *post-guard* and carry no row — killing either requires first killing
the guard M2/M3 already attack. **Not mutation-testable**: the comment sweep (prose), and the
explore-over-pin precedence *inside* readRound, which is pre-existing behaviour carried over
verbatim, not a new guard arm of this wave.

## 5. Verification bar

- `go build ./...` — clean. `go vet ./...` — clean.
- `gofmt -l .` output READ: it lists files, all of which are the working tree's CRLF-checkout
  artifact (the clean baseline worktree at `13ea0da` lists 57 files including ones this wave never
  touched). Per the brief, the committed BLOBS were checked instead:
  `git show HEAD:<file> | gofmt -l` is empty for **every file this wave touched** (chain.go,
  chain_test.go, prices.go, poller.go, prices_test.go, poller_test.go, poller_clause4_test.go,
  poller_live_test.go).
- Full suite `go test -v -count=1 ./...` with `TEST_DATABASE_URL` set (so nothing skips):
  **587 PASS / 0 FAIL / 0 SKIP**, exit 0.
- `-race` in the `golang:1.24` container (host Go lacks cgo), DB via `host.docker.internal`, live
  tests included: `ok internal/prices 2.041s`, `ok internal/chain 1.042s`.
  Command: `MSYS_NO_PATHCONV=1 docker run --rm -v "C:/Users/kasel/source/repos/etherfi/Solvent:/src"
  -w /src -e TEST_DATABASE_URL='postgres://solvent:solvent@host.docker.internal:5432/solvent_t9w1?sslmode=disable'
  -e GOFLAGS=-buildvcs=false --add-host=host.docker.internal:host-gateway golang:1.24
  go test -race -count=1 ./internal/prices/... ./internal/chain/...`.

## 6. Unverified / out of scope, stated plainly

- **No real-chain contact was made by this wave.** The fix reproduces the live mechanism through
  the realistic fake (zero multicall hash) and pins every guard, but the proof that the poller now
  anchors against mainnet/OP is the controller's restart of the daemons onto the fixed binary after
  D-006 review — deliberately not attempted from here (the running backfill daemon was not to be
  touched).
- The `-race` run covers `./internal/prices/... ./internal/chain/...` per the brief, not the whole
  repo (the whole repo's non-race suite is green; no other package changed).
- The optional parent-witness variant is not implemented (judgment stated in §1).
- Wave-16 transcripts note UTF-8 em-dashes render as `�` in the Windows console capture; the
  committed transcript file itself is clean UTF-8.

Returns to Codex (prices unit) under D-006. Nothing pushed; `roadmap/` untouched.
