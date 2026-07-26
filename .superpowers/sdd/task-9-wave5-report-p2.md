# Task 9 — wave 5 report: provider-reported header hashes

Brief: `task-9-wave5-brief.md` (`0808f10`). Base: `1e3941c` (round-4 APPROVE archive commit; code
bytes identical to wave-4's code tip `0a46218`). Branch `main`, serial tree — no other wave in
flight.

**THIS WAVE REOPENS APPROVED CHAIN-LAYER SURFACE.** `internal/chain/chain.go` was part of the
senior-approved stack consumed under D-006 (walker/decode via `d8c462b`-lineage, runner+daemon
`d1e7d54`, and wave 4's pinned-call aggregate approved at round 4 with zero findings).
`HeaderHash`, `HeaderHashFrom`, `HeadFrom` and `HeaderTime` — behavior the walker, poller, feed
deriver and daemon staleness gate all consume — have been re-cut from local recomputation to
provider-reported values. Wave-4's `doFromAttempts`/`PinnedCallError` surface is untouched, as are
`Call*`, `Logs`, `BlockNumber`, `TxCalldata`, `VerifyChainID`. This returns to Codex under D-006
with that reopening stated up front.

| commit | contents |
| --- | --- |
| `ce21cd3` | the conversion + the whole regression fleet (chain.go, chain_test.go, new `chain_reported_hash_test.go`, new `chain_live_test.go`, poller_test.go round-trip pair) |
| `d555683` | mutation spec `.superpowers/sdd/t9w5-mutations/mutations.json`, committed BEFORE any loop ran |
| (transcript commit) | `t9w5-mutations/transcript.md`, 6/6 killed, tested SHA `d555683` (code bytes identical to `ce21cd3` — the delta is `.superpowers/sdd/**` only) |
| (this report's commit) | `task-9-wave5-report-p2.md` |

## Test counts (top-level `^--- PASS` convention: `go test -v -count=1 ./...` through `grep -c '^--- PASS'`, subtests not counted)

- **Baseline at `1e3941c`: 604 PASS / 0 FAIL / 0 SKIP**, exit 0 — measured clean before any edit,
  `TEST_DATABASE_URL` at `solvent_t9w1`. Matches wave-4's final count.
- **Final (code tip `ce21cd3`): 613 PASS / 0 FAIL / 0 SKIP**, exit 0, same convention, same DB,
  with `SOLVENT_LIVE_RPC_TESTS=1` so the network-gated live regression RAN (and passed) inside the
  counted suite — zero SKIP is literal, not carve-out.
- Delta +9, PASS-lists diffed BOTH directions on test names: zero deletions, zero renames. The
  nine: `TestHeaderHashIsTheProviderReportedHashNotARecomputation`,
  `TestHeaderHashFromServesTheReportedHashWithItsToken`,
  `TestHeadFromCarriesTheReportedHashOfAnOPShapedHead`, `TestHeaderTimeIsTheReportedTimestamp`,
  `TestHeaderReadsRefuseAZeroReportedHash`, `TestHeaderReadsTreatAMissingBlockAsNotFound`,
  `TestLiveOPIncidentBlockHashIsTheReportedCanonicalHash` (internal/chain);
  `TestPollerPinnedRoundTripLandsOnAnOPShapedReportedHash`,
  `TestPollerPinnedRoundWithARecomputedHashCanNeverLand` (internal/prices).
- `internal/ingest` was NEVER touched and its suite passes unchanged — the brief's STOP condition
  (any ingest test breaking) did not trigger. The fix sits beneath the walker.

## The reported-hash design

**One principle: the chain layer never locally recomputes a header hash.** Every hash the
`Failover` hands out is the provider-REPORTED `hash` field of a raw
`rpc.CallContext("eth_getBlockByNumber", <num|"latest">, false)` decoded into the minimal
`ReportedHeader{Hash, ParentHash, Number, Time}` — the four fields the layer actually consumes.
Unknown 2026-era header fields are simply not decoded, which is the point: the defect was
re-RLP-hashing a *representation* v1.13.0 cannot faithfully hold (hashcheck.go: computed
`0x70f6bea2…` vs canonical `0x3d957321…` at OP 150,105,227, MATCH false).

Mechanics:

- **`rpcClient` dropped `HeaderByNumber` entirely.** The interface now carries
  `ReportedHeaderByNumber(ctx, number *big.Int) (*ReportedHeader, error)` (nil = latest; nil
  header + nil error = not found) and NO method returning `*types.Header`: a header the package
  cannot see is a header it cannot re-hash, so the principle holds structurally, not by
  convention — the same argument `prices.PollChain` makes by not carrying `CallAtFrom`.
- **`Dial` wraps each endpoint as `endpointClient{*ethclient.Client, raw *rpc.Client}`** (built
  from one `rpc.DialContext` connection): the typed client keeps serving every value-decoding call
  (logs, txs, eth_call, chainID, blockNumber); the raw handle serves the one read the typed client
  cannot be trusted with — a header's identity.
- **`validateReportedHeader` is the retained zero/absent-hash refusal, enforced at the source**:
  nil header → honest "not found"; PRESENT header with a ZERO hash, or an absent/non-uint64
  number → protocol violation. Either way it is an ATTEMPT failure inside the walk closure, so the
  rotation moves past the violating endpoint exactly like any endpoint fault, and only a walk with
  no honest endpoint left surfaces the violation. (Previously the chain layer had NO zero-hash
  check — only the poller did, at readRound; that poller guard is untouched and its regression
  `TestPollerRefusesZeroHeaderHash` still passes. The chain layer now refuses one level earlier as
  well.)
- **Trust posture stated at the type** (`ReportedHeader`, citing hashcheck.go): local
  recomputation was a FALSE guarantee — L2 consensus is not locally verifiable from header bytes —
  and reported hashes keep every cross-check meaningful on its honest terms: reorg detection
  compares reported-now vs reported-then; the walker's tip-log equality compares two
  provider-internal values; the EIP-1898 pin round-trips the same identity back to the node that
  issued it.

## Consumer sweep table — every hash-bearing path, converted or justified

Chain-layer surface:

| path | disposition |
| --- | --- |
| `HeaderHash` | **CONVERTED** — returns `ReportedHeader.Hash`; the walker's cursor/tip/ancestry hashes all ride this |
| `HeaderHashFrom` | **CONVERTED** — same value + token; the poller's `hashAfter` re-read and every repair/ancestry probe |
| `HeadFrom` (`Head.Hash`) | **CONVERTED** — the head's reported hash; where the poller's `hashBefore` is born |
| `Head` struct | doc updated: `Hash` is the PROVIDER-REPORTED hash (wave-5 note at the type) |
| `HeaderTime` | **CONVERTED to the shared reported fetch** — its field use was never wrong (the timestamp always came decoded from the response; only `Hash()` recomputed), but one fetch path means one protocol gate; behavior change is confined to refusing protocol-violating responses it previously had no opinion on |
| `BlockNumber` | untouched — carries no hash |
| `Logs` | untouched, justified: `types.Log.BlockHash` is DECODED from the provider's response, never recomputed — the log side of the walker's tip-log equality was always reported; it was the header side that lied |
| `TxCalldata`, `VerifyChainID` | untouched per brief — no header hashes |
| `Call` / `CallWithToken` / `CallFrom` / `CallAtFrom` / `CallAtHashFrom` | untouched — they FORWARD caller-supplied pins and never produce a header hash; wave-4's aggregate error path unchanged |

Downstream consumers:

| consumer | hash source | changes |
| --- | --- | --- |
| `internal/ingest/walker.go` (its `Chain.HeaderHash`, 6 call sites: cursor check 152, tip pin 181/189, recheck 202, rewind scan 313/339) | `Failover.HeaderHash` | **ZERO** — fix beneath it; every comparison it makes is now reported-vs-reported (cursor hashes it stores, tip-log equality, ancestry) |
| `internal/prices` poller `readRound` `hashBefore` (poller.go:928→950) | `HeadFrom`'s `Head.Hash` | **ZERO** — verified: `pin, hashBefore := head.Number, head.Hash` |
| poller `hashAfter` + repair/ancestry/frontier probes (poller.go:1032, 1684, 1761, 2530) | `HeaderHashFrom` | **ZERO** |
| `internal/prices` feed deriver `probeHead` (feed.go:1089) | `HeadFrom` — consumes `Number`/`Time` only | **ZERO** |
| `cmd/indexer` staleness gate (main.go:2193 → health headerTimes) | `HeaderTime` | **ZERO** — still the reported timestamp |
| `internal/snapshot` | none (eth_call surface only) | **ZERO** |

## Poller changes: NONE required — verified, stated

The brief's conjecture holds. `internal/prices/poller.go` acquires every hash through `HeadFrom`
and `HeaderHashFrom` and never touches `types.Header`; both methods were converted beneath it, so
the poller's production code needed ZERO changes and got zero. `internal/prices/**` changes are
TEST-ONLY (`poller_test.go`: the two round-trip regressions + the `core/types` import for the
fixture's recomputed-hash half). The EIP-1898 pin now presents a hash the serving node actually
issued — on OP that is the difference between discard-forever and landing.

## Harness: fixture realism is the headline

This bug lived 16 waves and 14 review rounds because every fake ever written served
SELF-CONSISTENT hashes — computed-vs-reported divergence was unrepresentable. The wave-5 fixtures
make it representable and then assert it:

- **The OP-shaped chain fixture** (`opShapedEndpoint`, chain_reported_hash_test.go): one block,
  BOTH representations — reported hash = the canonical `0x3d9573…fe23` at height 150,105,227;
  `fullHeaders` carries a `*types.Header` whose `Hash()` provably differs. The fixture SELF-CHECKS
  `NotEqual` so it can never degenerate back into a self-consistent fake. `fakeRPC` keeps
  `HeaderByNumber` (off-interface) SOLELY so the revert mutants compile and die by assertion — the
  `fakePollChain.CallAtFrom`/W2M1 precedent, stated at the fake.
- **The OP-shaped prices fixture**: `fakePollChain`'s views already speak reported-only hashes and
  its `CallAtHashFrom` recognizes only hashes the backend view carries (the live-matrix EIP-1898
  behavior); the round-trip tests script the incident block with the canonical reported hash, and
  the counterfactual splits the call backend to model the PRE-wave world (header path recomputed,
  node recognizes only reported).

Every regression, cited:

| property | test |
| --- | --- |
| `HeaderHash` returns the REPORTED value for an OP-shaped header (the W5M1 revert dies on exactly this) | `TestHeaderHashIsTheProviderReportedHashNotARecomputation` (internal/chain) |
| `HeaderHashFrom` serves the same reported identity + token | `TestHeaderHashFromServesTheReportedHashWithItsToken` |
| `Head{Hash,Number,Time}` are the reported fields for an OP-shaped LATEST | `TestHeadFromCarriesTheReportedHashOfAnOPShapedHead` |
| `HeaderTime` is the reported timestamp | `TestHeaderTimeIsTheReportedTimestamp` |
| zero reported hash refused on all four paths; refusal ROTATES past the violator | `TestHeaderReadsRefuseAZeroReportedHash` (6 subtests) |
| null result = honest not-found, rotates | `TestHeaderReadsTreatAMissingBlockAsNotFound` |
| LIVE: incident block's hash via mainnet.optimism.io == `0x3d9573215de44873740c98df8ad6c062c85b6135cbcbd0cc62381f886d07fe23`, both HeaderHash and HeaderHashFrom, real Dial→adapter→Failover stack | `TestLiveOPIncidentBlockHashIsTheReportedCanonicalHash` (network-gated) |
| ROUND TRIP: the poller's EIP-1898 pinned round LANDS on the OP-shaped fake — pin presents the reported hash, fake recognizes it, durable anchor carries it (impossible before this wave) | `TestPollerPinnedRoundTripLandsOnAnOPShapedReportedHash` (internal/prices) |
| the pre-wave composition, pinned as a counterfactual: a recomputed `hashBefore` is a pin no node recognizes — WARN-discard, nothing recorded, forever | `TestPollerPinnedRoundWithARecomputedHashCanNeverLand` |
| poller-level zero-hash refusal (pre-existing, retained) | `TestPollerRefusesZeroHeaderHash` (unchanged) |

## The ungated live-test run, recorded

Gating: `SOLVENT_LIVE_RPC_TESTS=1` (poller_live_test.go's skip-cleanly-with-instructions
convention applied to the network axis; the DB-gated tests keep `TEST_DATABASE_URL`).

- Scoped ungated run: 2026-07-26T11:37:06Z, `go test ./internal/chain/ -count=1 -run
  TestLiveOPIncidentBlockHashIsTheReportedCanonicalHash -v` → `--- PASS (0.53s)`, exit 0, against
  `https://mainnet.optimism.io`.
- The FINAL counted full suite also ran with the gate ON: the live test is one of the 613 PASS
  (zero SKIP anywhere).
- Gated-off behavior verified earlier the same session: clean `--- SKIP` with the instruction
  message, suite exit 0.

## Mutation matrix (committed applier, spec+transcript tied to tested SHA)

Run through `.superpowers/sdd/wave16-mutations/mutate.py` (exactly-one-occurrence per edit,
byte-level in-memory restores, verified byte-identical) against `d555683` (code bytes ==
`ce21cd3`); spec `t9w5-mutations/mutations.json` committed before the loop, transcript committed
after. `SOLVENT_LIVE_RPC_TESTS` unset for every run (no endpoint-hammering loops);
`TEST_DATABASE_URL` set so nothing DB-gated skipped. **6 mutants, 6 killed, 0 survived**;
properties stated per mutant in the spec.

| # | mutant | result | killed by |
| --- | --- | --- | --- |
| W5M1 | the v1.13.0 revert at `HeaderHash` (interface regains `HeaderByNumber`; closure back to `h.Hash()`) | KILLED | `TestHeaderHashIsTheProviderReportedHashNotARecomputation` — via a deliberately SCOPED `-run`, so "killed by exactly this test" is a recorded fact, not an inference (the package-wide kill list is a superset) |
| W5M2 | zero-hash protocol gate deleted from `validateReportedHeader` | KILLED | `TestHeaderReadsRefuseAZeroReportedHash` + all 5 subtests |
| W5M3 | `Head.Hash` plumbing slips to the reported parentHash (nonzero-but-wrong — invisible to any NotZero check) | KILLED | `TestHeadFromCarriesTheReportedHashOfAnOPShapedHead` |
| W5M4 | `HeaderHashFrom` hands out the reported parentHash | KILLED | `TestHeaderHashFromServesTheReportedHashWithItsToken`, `TestHeaderHashFromIsRoutableAndForkSensitive` |
| W5M5 | the v1.13.0 revert at `HeadFrom` (the poller's `hashBefore` recomputed — the OP incident itself) | KILLED | `TestHeadFromCarriesTheReportedHashOfAnOPShapedHead` (+ zero-hash arm) |
| W5M6 | `HeadFrom` computes-and-discards the protocol gate's verdict | KILLED | `TestHeaderReadsRefuseAZeroReportedHash/HeadFrom` |

Disclosed in the spec's design notes: the revert mutants carry the interface re-add edit so they
die by ASSERTION, not compile error; the prices suite is structurally blind to chain.go mutants
(the fake seam sits at `PollChain`) — W5M3/W5M5 include `./internal/prices/` anyway so the
transcript records that blindness, and the composition is pinned from the prices side by the two
round-trip regressions.

## Verification bar

- `go build ./...`, `go vet ./...` — clean at the code tip.
- gofmt: working-tree files CRLF-checked via CR-stripped temp copies; COMMITTED BLOBS at `ce21cd3`
  verified via `git show` → temp file → `gofmt -l` empty (never `/dev/stdin`) for all five touched
  Go files.
- Full suite: baseline 604/0/0 at `1e3941c`; final 613/0/0 at `ce21cd3` (live gate ON). PASS-lists
  diffed both directions; +9, zero deletions.
- `-race` in `golang:1.24` via `host.docker.internal` (wave-3's exact command shape):
  `ok internal/prices`, `ok internal/chain`, exit 0, at the final code bytes.
- Environment discipline: the backfill daemon (DB `solvent`; ETH arm active, OP arm wedged by this
  very defect) was never stopped and nothing ever pointed at its DB — every run used
  `solvent_t9w1`. Pathspec staging throughout; in-memory mutation restores only.

## Unverified / honest limits, stated plainly

- **`endpointClient.ReportedHeaderByNumber` (the raw call, arg encoding, null pass-through) is
  covered ONLY by the live regression** — the fake seam sits at `rpcClient`, one level above the
  adapter. The live test ran ungated and passed (recorded above), and it exercises the full
  Dial→adapter→Failover stack on the incident block, but it is network-gated in ordinary runs; no
  hermetic test drives the adapter. Mutants inside the adapter would be killable only by the gated
  test and were therefore not included (disclosed in the spec).
- **ETH-side live behavior is inferred, not re-proven**: v1.13.0 hashes current ETH headers
  correctly (ledger evidence: dense post-Cancun ranges walked with zero mismatches), so on ETH the
  reported value equals what recomputation produced and nothing observable changes. No ETH live
  test was added.
- **Stored OP cursor hashes remain computed-garbage** and the OP walker stays wedged until the
  controller's post-approval steps (OP stream state reset, daemon restart on the approved stack,
  re-walk, live anchor proof) — explicitly controller work per the brief, not this wave's.
- `HeaderTime` now refuses protocol-violating header responses it previously had no opinion on
  (uniform gate). Deliberate, tested (`.../HeaderTime` subtest); called out in case the closing
  round reads it as scope creep — the alternative was two fetch paths with asymmetric trust.
- Line endings: chain.go/chain_test.go/poller_test.go are CRLF in the working tree (as since
  wave 4); the two NEW test files were committed with LF working copies and will normalize to CRLF
  on next checkout — committed blobs are LF like every other Go file, diffs contain only real
  changes. The mutation spec's `\r\n` patterns target chain.go only, whose CRLF form was verified.
- `-race` covers `./internal/prices/... ./internal/chain/...` per the standing bar, not the whole
  repo (whole-repo non-race suite is green; no other package changed).
