# Task 9 — wave 2 report (P2): routing advance on coherence discards + EIP-1898 hash-pinned execution

Brief: `.superpowers/sdd/task-9-wave2-brief.md` (Codex round 1: 1 high + 1 medium, both ACCEPTED,
verbatim in `task-9-codex-round1.md`). Base: `cad9d76` (the round-1 archive / wave-2 brief commit;
wave-1 code tip `84ca9d2` unchanged beneath it). Implementation commits, in order, all
pathspec-staged on `main`:

| commit | contents |
|---|---|
| `115e4d2` | both fixes + the full fleet: `chain.Failover.CallAtHashFrom` (EIP-1898), `PollChain` swaps to the hash-pinned call, readRound pins to `hashBefore` itself, rejection-to-discard arm, routing advance on every serving-inconsistency discard, package-contract rewrite + prose class sweep, harness split-backend support, 5 new tests, 4 extended tests |
| `2981f3e` | mutation matrix spec (`.superpowers/sdd/t9w2-mutations/mutations.json`, run through the wave-16 committed applier) |
| (transcript commit) | mutation transcript tied to the tested SHA |
| (this report's commit) | `.superpowers/sdd/task-9-wave2-report-p2.md` |

Code is untouched after `115e4d2`; every later commit is `.superpowers/sdd/**` only.

## Test counts (top-level `^--- PASS` convention: `go test -v -count=1 ./...` piped through `grep -c '^--- PASS'`, subtests indented and not counted)

- **Baseline at `cad9d76`: 587 PASS, 0 FAIL, 0 SKIP**, exit 0 — measured clean before any edit,
  `TEST_DATABASE_URL` at the wave's dedicated DB `solvent_t9w1` (created by wave 1; the running
  backfill daemon's DB `solvent` was never touched). Matches wave-1's final count.
- **Final (code state `115e4d2`): 592 PASS, 0 FAIL, 0 SKIP**, exit 0, same convention, same DB.
- Delta +5, PASS-lists diffed BOTH directions (nothing deleted, nothing renamed away):
  `TestCallAtHashFromPinsHashAndLeavesSharedHintAlone`, `TestCallAtHashFromWrapsModuloAndRotatesOnError`
  (chain), `TestPollerCoherenceDiscardMovesTheNextRoundToAHealthyPeer`,
  `TestPollerHashPinRefusesASplitForkBackendAtTheSameHeight`,
  `TestPollerPinRejectionExploresAndTheNextRoundLandsElsewhere` (prices).

## F2 [medium] — execution bound to the hash: EIP-1898 pinned eth_call

The round-1 finding: an `EndpointToken` names a URL, not a backend; one lb hostname is many
nodes, so fork-A headers plus a fork-B **number**-pinned call at the same height passed every
wave-1 guard, and the package contract still claimed multicall-supplied hash provenance. The
controller proved the strengthening viable live (ledger, 2026-07-26: EIP-1898 `eth_call`
`{"blockHash": h}` executed exactly at the pinned block on all four reachable endpoints;
fabricated hash REJECTED "block not found" on all four), so wave 2 makes the guarantee true
instead of shrinking the claim.

### What changed

- **`chain.Failover.CallAtHashFrom`** (internal/chain/chain.go, additive): `CallFrom`'s exact
  composition and token discipline — caller-scoped start over `doFrom`, shared hint neither read
  nor written, token names the server, `Index:-1` on total failure — with the pin forwarded as
  `ethclient.CallContractAtHash`, which issues the EIP-1898 object form
  (`rpc.BlockNumberOrHashWithHash(hash, false)`; `requireCanonical` stays at the EIP-1898
  default per the brief — the pin's job is identity, absence-of-fork detection stays the anchor
  machinery's job). The rpcClient interface gains `CallContractAtHash` (ethclient has carried it
  since well before the pinned v1.13.0). The doc states the honest trust boundary (the node's
  implementation of the pin) and cites the live matrix's negative-control class.
- **`PollChain` swaps `CallAtFrom` → `CallAtHashFrom`** (internal/prices/prices.go). The
  number-pinned variant is deliberately NOT carried: a method the interface does not declare
  cannot be called — the same structural argument PollStore makes about deletion — so no poller
  code path can regress to pinning by height. `chain.Failover.CallAtFrom` itself STAYS (additive
  posture, snapshotter untouched), re-documented as retired from the poller with the reason.
- **`readRound` pins to `hashBefore` itself** (internal/prices/poller.go): the block-identity
  the round verified. The `blockNumber == N` cross-check is RETAINED — it is now the detector
  for a node that ignores the pin rather than rejecting it (a serving inconsistency, discarded).
- **"block not found"-class rejection is a DISCARD + routing advance**, not an error: the
  serving node may genuinely lack the fork its own head named — exploration-worthy information.
  Classification is by error text with the bound stated at `isBlockNotFoundErr`: the accepted
  phrasings mirror the live matrix's uniformly observed rejection plus the dominant client
  families' wordings (geth "header for hash not found", erigon "block not found", nethermind
  "unknown block"); anything phrased outside the class degrades to the ERROR posture, which is
  fail-closed — it can delay recovery, it can never land a round or misroute one. The failover
  layer surfaces the LAST endpoint's error, so an all-endpoints rejection stays classifiable
  through the wrapping (pinned by the second `TestCallAtHashFromWrapsModuloAndRotatesOnError`
  assertion); a mixed rejection/transport total failure surfaces whatever failed last and may
  take the error posture — disclosed, same fail-closed direction.
- **Package contract rewritten** (prices.go, the round-1 citation): the stale "multicall3
  returns the execution block HASH; the decoder keeps it" claim is GONE; the contract now states
  exactly what the anchor attests (execution pinned to `hashBefore` by EIP-1898, bound to block
  identity, not height), why the same-height split backend cannot land, and the honest trust
  boundary with the live matrix's negative controls cited as the observed behavior class.
- **Prose class sweep** (the round-13/14 lesson): `multicall3ABI`'s doc and
  `unpackMulticallResult`'s doc re-anchored ("the round's anchor hash is the serving endpoint's
  HeaderHash(N), which the multicall executes PINNED TO by EIP-1898, never this output");
  poller.go package comment and `Step`/`pollRound`/coherence-test prose moved from
  "block-pinned/pinned at N" to hash-pinned language. Swept `internal/prices/**` and
  `internal/chain/chain.go` for "block-pinned", "pinned at", "header path", "multicall…hash"
  claims. `internal/store/derive.go` mentions of "multicall execution block" are the
  SNAPSHOTTER's number semantics (accurate, not anchor provenance) and out of this wave's scope.

### The split-fork regression (the mandated harness)

`fakePollChain` gained the "one URL, many nodes" split: `splitCallBackendOn(endpoint)` gives an
endpoint a call-path chain view SEPARATE from its header view, and the fake's `CallAtHashFrom`
executes ONLY on a backend that HAS the pinned block — an unknown hash rejects with the observed
"block not found" class and rotates on, mirroring the live matrix's negative controls. The fake
keeps a number-pinned `CallAtFrom` (production cannot reach it) with the reason written at the
method: it exists solely so the hash→number regression stays expressible as a compilable
mutation instead of a compiler error nobody learns from.

`TestPollerHashPinRefusesASplitForkBackendAtTheSameHeight`: one endpoint token; header path fork
A at N=5000 (hash `blockHashAt(5000)`), call path fork B at the SAME height with its own block.
Every wave-1 guard passes in that world. With the hash pin the round DISCARDS (no error, nothing
stored, `ch.served` empty — no backend lacking the block ever executed, `atHashes` proves the
pin was A's hash); under a number pin the round LANDS B's observations under A's hash, which the
empty-store assertions refuse — the mutation-mandated kill, proven scoped (W2M1s below).

## F1 [high] — a coherence discard moves the round's starting point

The round-1 finding: endpoint 0 serving heads while permanently failing pinned calls starved the
poller forever — every cadence re-resolved endpoint 0, discarded on token mismatch, wrote
nothing, healthy peer idle. The fail-closed-not-fail-forever class a fourth time (wave 13
scheduling starvation, wave 15 rotation liveness, cause-unknown exploration before both).

**The fix**: every coherence/serving-inconsistency discard — multicall token mismatch,
closing-header token mismatch, `blockNumber != pin`, hash-pin rejection — now calls
`routeNextRoundPastDiscard(servedBy)`, which advances the CALLER-SCOPED exploration start one
past the round's endpoint via the existing `advanceExploration`. The invariant is stated at the
helper, verbatim per the brief: *a discard that cannot name a healthy endpoint must at least
ensure the NEXT round starts somewhere else.* It is exploration, not attribution: no endpoint is
accused, the shared routing hint is never written (d1e7d54's ambiguity rules preserved — the
helper documents this), genuine progress releases the hint exactly as before, and with a single
configured endpoint `advanceExploration` already says "nothing to explore towards" rather than
pretending. The MID-ROUND-REORG discard deliberately does NOT advance — that is evidence about
the chain, not the endpoint — and both the exclusion and its reason are pinned in code comment
AND test AND mutation (W2M5).

**The multi-cadence harness the brief demanded**,
`TestPollerCoherenceDiscardMovesTheNextRoundToAHealthyPeer`: endpoint 0 serves heads,
permanently fails eth_call; round 1 discards (coherence breach) and MOVES the start; round 2 —
the next cadence — resolves endpoint 1 (`headStarts [0,1]` proves the advanced start was USED)
and lands a FULL round: 20 observations, the `(5000, blockHashAt(5000))` anchor, cursor at 5000,
exploration hint released on progress, `preferredStart` still `-1` (nothing was ever accused).
Not merely "the first round discards".

## Every wave-2 guard, cited to its test (poller tests in `internal/prices/poller_test.go`, chain tests in `internal/chain/chain_test.go`)

| guard / property | test |
|---|---|
| the multicall executes pinned to the resolved head's HASH, never a bare height, never latest (`atHashes`, `atBlocks` empty) | `TestPollerRoundIsEndpointCoherentAndPinnedAtHead` (extended) |
| a same-height split backend can never land its state under the header path's hash; the rejection is a discard, not an error | `TestPollerHashPinRefusesASplitForkBackendAtTheSameHeight` |
| a pin rejection advances the start and the next cadence lands elsewhere, anchored to the healthy view's hash | `TestPollerPinRejectionExploresAndTheNextRoundLandsElsewhere` |
| a coherence discard moves the start; the NEXT cadence lands a full round (anchor + observations + cursor) through the healthy peer | `TestPollerCoherenceDiscardMovesTheNextRoundToAHealthyPeer` |
| multicall token-mismatch discard advances the start, attribution-free | `TestPollerDiscardsRoundWhenMulticallServedByAnotherEndpoint` (extended) |
| closing-recheck token-mismatch discard advances the start | `TestPollerDiscardsRoundWhenClosingRecheckServedByAnotherEndpoint` (extended) |
| `blockNumber != pin` discard advances the start | `TestPollerDiscardsRoundWhenExecutionBlockDivergesFromPin` (extended, now 2 endpoints so the advance is observable) |
| mid-round reorg discard does NOT advance (chain evidence, not endpoint evidence) | `TestPollerDiscardsRoundOnMidRoundReorg` (extended, now 2 endpoints so a wrong advance is observable) |
| chain: the EIP-1898 hash is forwarded to eth_call; `Call` stays latest; `CallAtFrom` stays a number; caller-scoped start; shared hint untouched | `TestCallAtHashFromPinsHashAndLeavesSharedHintAlone` |
| chain: start normalization, rotation on the "block not found" class, `Index -1` + rejection class surviving the failover wrapping | `TestCallAtHashFromWrapsModuloAndRotatesOnError` |

Wave-1 guards all still stand on the new composition — the four discard tests, the zero-hash
refusals, the happy-path anchor tests, the live durable-footprint test
(`TestPollerLiveRoundWritesAnchorAndBoundObservations`, real store, 00007 semantics unchanged)
all pass unmodified in behavior; the only edits to existing tests ADD routing assertions or
widen a fixture from 1 to 2 endpoints so the routing assertion is load-bearing.

## The closing re-read: KEPT, with its changed job stated

The brief required a documented decision. **Decision: keep it.** Reasoning, written into
readRound's contract (the "THE CLOSING RE-READ IS KEPT" section) and at the re-read site:

- It no longer guards fabrication — the pin binds execution to `hashBefore` whatever happens
  mid-round. Claiming otherwise would be the overclaim class round 1 just closed, so the
  contract says what it now buys instead.
- What it buys, for ONE header read per round (1/min cadence): a mid-round reorg that orphans N
  is caught NOW and costs one discarded round. Without it, the round lands an anchor already
  orphaned at commit time; the cost of that is a walker epoch, a repair pass, and — because
  D-012 clause 3 makes markings PERMANENT classifications — possibly-permanent row markings
  later. Prevention is strictly cheaper than the marking it prevents.
- Secondary: the `hashAfter` zero-check arm (wave-1 M7's property — a degraded provider surfaces
  as an ERROR at the moment of contact) exists only if the re-read exists, and the re-read's
  token check keeps the round's close attested by the round's own endpoint.
- Dropping it would also have re-specified wave-1's reviewed M3/M5/M7 mutation ground for an RPC
  saving of one header read per minute — the wrong side of every trade this project has ratified.

## Mutation matrix

Run per the wave-16 class rule through the committed applier
(`.superpowers/sdd/wave16-mutations/mutate.py`: exactly-one-occurrence assertion per edit,
byte-level backups, in-memory restores verified byte-identical — never `git checkout`; files are
CRLF in the working tree so multi-line patterns embed `\r\n` explicitly in the spec). Spec:
`.superpowers/sdd/t9w2-mutations/mutations.json` (committed at `2981f3e` BEFORE the loop ran).
Transcript: `.superpowers/sdd/t9w2-mutations/transcript.md`, tested SHA `2981f3e` — whose code
is byte-identical to the code tip `115e4d2`, the only intervening commit being the spec itself;
restore verification in the transcript: all three mutated files byte-identical to `2981f3e`
after the run.

**10 mutants, 10 KILLED, 0 survived — every kill by test assertion, zero compiler kills** (every
mutant compiled and ran its suite; W2M1's two-edit design below is what keeps the headline
mutant compilable). Per mutation, the property it certifies:

| id | mutation | property certified | killed by (headline) |
|---|---|---|---|
| W2M1 | PollChain + readRound revert to the number-pinned call (2 edits) | execution is bound to the verified block IDENTITY, not a height: a same-height split backend must never land its state under the header path's hash | `TestPollerHashPinRefusesASplitForkBackendAtTheSameHeight` (+ `PinRejectionExplores…`, `RoundIsEndpointCoherentAndPinnedAtHead`) |
| W2M1s | W2M1 re-run scoped to `-run '^TestPollerHashPinRefusesASplitForkBackendAtTheSameHeight$'` | the brief's mandated killer kills the pin regression BY ITSELF | `TestPollerHashPinRefusesASplitForkBackendAtTheSameHeight`, alone |
| W2M2 | rejection-to-discard arm severed (`if false && isBlockNotFoundErr…`) | a "block not found" pin rejection is a DISCARD that moves the start, never an error loop | `TestPollerHashPinRefusesASplitForkBackendAtTheSameHeight`, `TestPollerPinRejectionExploresAndTheNextRoundLandsElsewhere` |
| W2M3 | `routeNextRoundPastDiscard` becomes a no-op | the F1 transition: a coherence discard ADVANCES the next round's caller-scoped start | `TestPollerCoherenceDiscardMovesTheNextRoundToAHealthyPeer` + all four extended discard tests |
| W2M4 | chain layer degrades the hash pin to a latest call | `CallAtHashFrom` forwards the EIP-1898 pin to eth_call — no silent degradation | both `TestCallAtHashFrom…` tests |
| W2M5 | the mid-round-reorg discard GAINS an advance | the deliberate exclusion: a mid-round reorg must NOT move routing (chain evidence, not endpoint evidence) | `TestPollerDiscardsRoundOnMidRoundReorg` |
| W2M6 | closing-recheck arm's advance dropped | every serving-inconsistency arm advances — recheck arm included | `TestPollerDiscardsRoundWhenClosingRecheckServedByAnotherEndpoint` |
| W2M7 | pin-divergence arm's advance dropped | every serving-inconsistency arm advances — divergence arm included | `TestPollerDiscardsRoundWhenExecutionBlockDivergesFromPin` |
| W2M8 | multicall token-mismatch arm's advance dropped | dropping this arm alone restores the round-1 [high] starvation verbatim | `TestPollerCoherenceDiscardMovesTheNextRoundToAHealthyPeer`, `TestPollerDiscardsRoundWhenMulticallServedByAnotherEndpoint` |
| W2M9 | rejection arm's advance dropped | the pin-rejection discard moves the start — only exploration ends the private-fork round-shape | `TestPollerPinRejectionExploresAndTheNextRoundLandsElsewhere` |

Design notes, disclosed in the spec's meta verbatim:

- **W2M1 is a two-edit mutation BY DESIGN.** `PollChain` carries only the hash-pinned call
  (structural closure), so the hash→number regression is only expressible by reverting the
  interface line together with the call site; `chain.Failover` keeps `CallAtFrom` and the fake
  carries one so the mutant COMPILES and dies by assertion — an uninformative compiler kill
  would certify nothing about the tests.
- **W2M1s** repeats W2M1 scoped to `-run '^TestPollerHashPinRefusesASplitForkBackendAtTheSameHeight$'`,
  proving the brief's mandated killer kills the pin regression WITHOUT help from the fleet.
- **Not mutation-testable, stated**: the package-contract rewrite and prose sweep (comments
  carry no behavior); the closing-re-read KEEP decision (keeping an existing guard adds no new
  arm — its behavior stays certified by wave-1's M3/M5/M7, whose tests still pass here).
- The discard arms' REFUSAL half (nothing lands, nothing recorded) is wave-1 mutation ground
  (t9w1 M2/M4/M5 at `53c0688`); wave 2 attacks the ROUTING half those arms gained, plus the
  chain-layer pin (W2M4) and the deliberate mid-reorg exclusion in the direction wave-1 could
  not express (W2M5 ADDS the advance and must die).

## Verification bar

- `go build ./...` — clean. `go vet ./...` — clean.
- `gofmt`: working tree is a CRLF checkout, so per the wave-1 discipline the COMMITTED BLOBS
  were checked: `git show HEAD:<file> | gofmt -l` is empty for every file this wave touched
  (chain.go, chain_test.go, prices.go, poller.go, prices_test.go, poller_test.go); additionally
  each touched file was verified clean pre-commit via a CR-stripped `gofmt -l`.
- Full suite `go test -v -count=1 ./...` with `TEST_DATABASE_URL` set (so nothing skips):
  **592 PASS / 0 FAIL / 0 SKIP**, exit 0, at code tip `115e4d2`.
- `-race` in the `golang:1.24` container (host Go lacks cgo), DB via `host.docker.internal`,
  live tests included: `ok internal/prices 1.993s`, `ok internal/chain 1.041s`. Command:
  `MSYS_NO_PATHCONV=1 docker run --rm -v "C:/Users/kasel/source/repos/etherfi/Solvent:/src" -w /src
  -e TEST_DATABASE_URL='postgres://solvent:solvent@host.docker.internal:5432/solvent_t9w1?sslmode=disable'
  -e GOFLAGS=-buildvcs=false --add-host=host.docker.internal:host-gateway golang:1.24
  go test -race -count=1 ./internal/prices/... ./internal/chain/...`.
- Environment discipline: the Task 9 backfill daemon (DB `solvent`, writer advisory lock) was
  never stopped and no test or mutation run ever pointed at its database; every run used
  `solvent_t9w1`. Pathspec staging throughout; no `git add -A`; no `git checkout` restores.

## Unverified / out of scope, stated plainly

- **No real-chain contact was made by this wave.** The EIP-1898 pin's live viability rests on
  the controller's four-endpoint matrix (ledger, 2026-07-26), reproduced in the fake's rejection
  semantics; the proof that the poller anchors against mainnet/OP through the hash pin is the
  controller's restart of the daemons onto the fixed binary after D-006 review — deliberately
  not attempted from here.
- `isBlockNotFoundErr`'s class list is text-matching with a stated fail-closed degradation; a
  provider rejecting EIP-1898 pins with phrasing outside the class (none observed in the live
  matrix) would take the error posture until the class list is extended — delay, never
  fabrication or misrouting. Also disclosed at the helper itself.
- The `-race` run covers `./internal/prices/... ./internal/chain/...` per the brief, not the
  whole repo (the whole repo's non-race suite is green; no other package changed).
- `internal/store/derive.go`'s "multicall execution block" prose (snapshotter semantics,
  accurate) was inspected during the class sweep and left alone: `internal/store/**` is outside
  this wave's write scope and the text makes no anchor-provenance claim.

Returns to Codex (prices unit) under D-006. Nothing pushed; `roadmap/` untouched.
