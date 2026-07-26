# Task 9 — wave 3 report (P2): one routing invariant closes the class

Brief: `.superpowers/sdd/task-9-wave3-brief.md` (Codex round 2: 2 high, both ACCEPTED, verbatim +
controller ruling in `task-9-codex-round2.md`). Base: `8bd1f29` (the round-2 archive / wave-3
brief commit; wave-2 code tip `115e4d2` unchanged beneath it). Implementation commits, in order,
all pathspec-staged on `main`:

| commit | contents |
|---|---|
| `ed86b1d` | the seam: readRound's single deferred outcome handler keyed on a round-landed flag; per-arm advances removed; mismatch arm subsumed; `isBlockNotFoundErr` demoted to posture-only; helper renamed `routeNextRoundPastNonLanding` carrying the ruling verbatim; 6 new tests + the reversed/renamed mismatch test + the keep-side assertion |
| `a80d78e` | mutation matrix spec (`.superpowers/sdd/t9w3-mutations/mutations.json`, wave-16 committed applier) |
| `1b89fb5` | prose sweep, comments only: the package FAILURE POSTURE bullets and readRound's discard contract no longer assert the bracketing mismatch IS a reorg (the ruling makes that unknowable from one token); the posture section now names the seam's invariant |
| (transcript commit) | mutation transcript tied to the tested SHA `1b89fb5` — the code tip itself |
| (this report's commit) | `.superpowers/sdd/task-9-wave3-report-p2.md` |

Code is untouched after `1b89fb5` (whose diff over `ed86b1d` is comments only — verified by the
suite, gofmt and the re-run mutation loop below); every later commit is `.superpowers/sdd/**` only.

## Test counts (top-level `^--- PASS` convention: `go test -v -count=1 ./...` piped through `grep -c '^--- PASS'`, subtests indented and not counted)

- **Baseline at `8bd1f29`: 592 PASS, 0 FAIL, 0 SKIP**, exit 0 — measured clean before any edit,
  `TEST_DATABASE_URL` at the wave's dedicated DB `solvent_t9w1` (the running backfill daemon's DB
  `solvent` was never touched). Matches wave-2's final count.
- **Final (code tip `1b89fb5`): 598 PASS, 0 FAIL, 0 SKIP**, exit 0, same convention, same DB.
- Delta +6, PASS-lists diffed BOTH directions. One RENAME, disclosed:
  `TestPollerDiscardsRoundOnMidRoundReorg` → `TestPollerBracketingHashMismatchDiscardsAndMovesTheStart` —
  the old name asserted an attribution ("mid-round reorg") the round-2 ruling declares unknowable,
  and the old body PINNED the no-advance behavior the ruling reverses; keeping the name while
  reversing the assertion would have been the confidence-theatre shape. Six additions:
  `TestPollerStableSameTokenBackendSplitRecoversThroughTheHealthyPeer`,
  `TestPollerMixedRejectionTransportFailureRecoversThroughThePeersOwnHead`,
  `TestPollerMalformedEnvelopeAdvancesAndTheNextRoundLandsElsewhere`,
  `TestPollerClosingHeaderFailureAdvancesAndTheNextRoundLandsElsewhere`,
  `TestPollerEveryNonLandingOutcomeAdvancesTheRoundsStartingPoint` (the principle test),
  `TestPollerBothEndpointsHalfBrokenPingPongsAndObservesRecovery` (the liveness hold-over).
  Nothing else deleted or renamed away.

## The seam — structure, and why a future arm cannot dodge it

The invariant, stated verbatim in code at `routeNextRoundPastNonLanding` and applied at exactly
one place:

> **Landing is the only outcome that keeps the starting point.** Once a round has resolved its
> serving endpoint, every non-landing outcome — named discard, ambiguous hash mismatch,
> out-of-class rejection, transport failure, malformed envelope, closing-header failure —
> advances the caller-scoped exploration start. Failure classification decides the ERROR POSTURE
> (discard vs error vs backoff), never whether routing moves.

**The shape** (internal/prices/poller.go, `readRound`): the moment `HeadFrom` resolves the
serving endpoint — before the zero-hash refusal, before the pinned call, before anything that can
fail post-resolution — readRound installs

```go
landed := false
defer func() {
    if !landed {
        p.routeNextRoundPastNonLanding(servedBy)
    }
}()
```

and exactly ONE statement in the function sets the flag: the landed return at the bottom, marked
`THE ONE LANDED RETURN — the only exit that keeps the starting point`.

**Why a future arm gets the advance for free.** The advance is no longer a call any arm makes —
it is the default consequence of RETURNING. A new failure arm added anywhere after resolution
(a new discard class, a new error return, even a panic unwinding through the defer) advances the
start without its author knowing the seam exists, because the only way to keep the starting point
is the affirmative act of marking the round landed first. "Forgot the helper" — the failure mode
that produced round 1's [high] and both round-2 findings across two waves of per-arm enumeration —
is no longer expressible as an omission; it requires writing `landed = true` on a non-landing
path, which is precisely the edit shape the mutation matrix attacks (W3M2–W3M9) and the principle
test kills on every currently reachable exit. Wave 2's four per-arm `routeNextRoundPastDiscard`
calls are deleted, not augmented: enumerate nothing, so nothing can be missed.

**What classification still does, and only that.** `isBlockNotFoundErr` picks the report: a
recognized rejection is a WARN discard (the serving node may genuinely lack its own head's fork —
operator-relevant, not backoff-worthy); anything else — out-of-class wording, a trailing
transport failure masking a rejection (the failover layer surfaces only the LAST endpoint's
error), a malformed envelope, a closing-header failure — keeps the fail-closed ERROR posture.
Neither branch touches routing; both docs say so and W3M13 certifies the posture bound
independently of routing.

**The mismatch subsumption (round-2 finding 1), and why the false-attribution objection is
void** — stated at the arm: a before/after hash mismatch from one token is ambiguous between
chain movement and a stable backend split behind the same URL. The advance is caller-scoped
exploration: no endpoint is accused (`preferredStart` untouched, asserted in every wave-3 test),
the shared routing hint is never written (d1e7d54 preserved — the fake's `active` field is
asserted unchanged in the principle test, and the poller has no interface method to write it),
and a genuine reorg discard that advances merely begins its next round elsewhere at zero
correctness cost. Advancing on ambiguity costs nothing; starving on it costs everything.

**Scope boundary, stated.** The seam owns the ROUND READ: resolution → landed return. Apply-time
failures (`Step`'s arms) remain owned by the reviewed classification machinery — an anchor
divergence is POSITIVE reorg proof answered by the epoch gate, a cursor regression classifies
into stale/reorg/cause-unknown (which explores on its own arm), and an ambiguous commit is
bounded by the d1e7d54 lease, which the ruling explicitly preserves. The invariant's keep side
is pinned exactly there: a LANDED round leaves the exploration start alone even when its apply
errs ambiguously (`TestPollerAmbiguousApplyWithoutPinConsumesNoLease`, extended; W3M12's killer).

## Every wave-3 obligation, cited to its test (all in internal/prices/poller_test.go)

| obligation (brief) | test |
|---|---|
| stable same-token header-backend split (fork-A head+call, fork-B closing header, EVERY cadence) + healthy peer: next cadence lands a FULL round through the peer | `TestPollerStableSameTokenBackendSplitRecoversThroughTheHealthyPeer` |
| the mismatch discard advances (reversed W2M5's ground) and stays a discard, attribution-free | `TestPollerBracketingHashMismatchDiscardsAndMovesTheStart` (rename of the old mid-round-reorg test, assertion reversed per the ruling) |
| mixed rejection/transport: endpoint 0 serves private-fork head A, both endpoints reject hash A, the FINAL surfaced error is transport (masking the recognized class); next cadence lands through endpoint 1's OWN head B | `TestPollerMixedRejectionTransportFailureRecoversThroughThePeersOwnHead` |
| malformed-envelope shape: error posture, advance, recovery through the peer | `TestPollerMalformedEnvelopeAdvancesAndTheNextRoundLandsElsewhere` |
| closing-header-total-failure shape: error posture, advance, recovery through the peer's own (different-height) head | `TestPollerClosingHeaderFailureAdvancesAndTheNextRoundLandsElsewhere` |
| the principle test: EVERY currently reachable post-resolution non-landing exit, table-driven, one uniform assertion block (nothing recorded, `exploreStart` advanced, `preferredStart` untouched, shared hint unwritten); landed + pre-resolution controls bracket the table | `TestPollerEveryNonLandingOutcomeAdvancesTheRoundsStartingPoint` — 12 rows: pin rejection, ambiguous mismatch, multicall switch, pin divergence, recheck switch, zero hash at head, trailing transport masking, out-of-class wording, total transport, malformed envelope, closing re-read total failure, zero hash at close |
| liveness under BOTH endpoints half-broken (round-2 question (a)): the advance ping-pongs, each broken endpoint is revisited, recovery is observed within ONE rotation of the fleet — recovery scripted on the endpoint the start is parked AWAY from, the worst case for an oscillation lock | `TestPollerBothEndpointsHalfBrokenPingPongsAndObservesRecovery` |
| the keep side: a landed round keeps the start even under an ambiguous apply error | `TestPollerAmbiguousApplyWithoutPinConsumesNoLease` (extended with the `exploreStart` assertion) |

The wave-2 fleet stands unmodified in behavior: the four discard tests, the split-fork refusal,
the pin-rejection exploration, the coherence-discard recovery and both zero-hash refusals all
pass with no assertion weakened — their per-arm advances are now served by the seam, which is
exactly the restructure-don't-enumerate instruction. No fake-chain changes were needed: the
stable split, the masked transport failure and the recovery flips are all expressible with
wave 2's `splitCallBackendOn` / per-endpoint views (`prices_test.go` untouched).

## Mutation matrix

Run per the wave-16 class rule through the committed applier
(`.superpowers/sdd/wave16-mutations/mutate.py`: exactly-one-occurrence assertion per edit,
byte-level backups, in-memory restores verified byte-identical — never `git checkout`; CRLF
working tree, so multi-line patterns embed `\r\n` in the spec). Spec:
`.superpowers/sdd/t9w3-mutations/mutations.json`, committed at `a80d78e` BEFORE any loop ran.
Transcript: `.superpowers/sdd/t9w3-mutations/transcript.md`, **tested SHA `1b89fb5` — the code
tip itself** (the loop was deliberately re-run after the comment-only prose commit so the
transcript's SHA and the final code bytes are identical; an earlier identical 14/14 run at
`a80d78e` was superseded by it). Restore verification in the transcript: poller.go byte-identical
to `1b89fb5` after the run.

**14 mutants, 14 KILLED, 0 survived — every kill by test assertion, zero compiler kills.** The
dodge shape IS the attack shape: with the seam, "this arm forgets to advance" is only expressible
as `landed = true` on a non-landing path, so that is what W3M2–W3M9 inject. Per mutation, the
property it certifies:

| id | mutation | property certified | killed by (headline) |
|---|---|---|---|
| W3M1 | the deferred seam severed (`if false && !landed`) | every post-resolution non-landing exit advances through the ONE seam | the principle test (all 12 rows) + all six named regression tests + the liveness test |
| W3M1s | W3M1 re-run scoped to `-run '^TestPollerEveryNonLandingOutcomeAdvancesTheRoundsStartingPoint$'` | the class-closer kills the severed seam BY ITSELF | the principle test, alone |
| W3M2 | the mismatch arm dodges (`landed = true`) — **W2M5 REVERSED**: wave 2's no-advance behavior restored | the ambiguous mismatch MUST move the start (round-2 finding 1) | `TestPollerBracketingHashMismatchDiscardsAndMovesTheStart`, `TestPollerStableSameTokenBackendSplitRecoversThroughTheHealthyPeer`, principle row |
| W3M3 | the pin-rejection arm dodges | the recognized rejection still moves the start | `TestPollerPinRejectionExploresAndTheNextRoundLandsElsewhere`, principle row |
| W3M4 | the multicall-coherence arm dodges | dropping this arm's advance restores round 1's [high] starvation verbatim | `TestPollerDiscardsRoundWhenMulticallServedByAnotherEndpoint`, `TestPollerCoherenceDiscardMovesTheNextRoundToAHealthyPeer`, liveness, principle row |
| W3M5 | the pin-divergence arm dodges | a mis-serving backend cannot re-resolve itself every cadence | `TestPollerDiscardsRoundWhenExecutionBlockDivergesFromPin`, principle row |
| W3M6 | the recheck-coherence arm dodges | an endpoint that cannot close its own round cannot re-resolve itself | `TestPollerDiscardsRoundWhenClosingRecheckServedByAnotherEndpoint`, principle row |
| W3M7 | the post-call ERROR return dodges (out-of-class / masked transport) | routing must not depend on RECOGNIZING the failure (round-2 finding 2) | `TestPollerMixedRejectionTransportFailureRecoversThroughThePeersOwnHead`, liveness, 3 principle rows |
| W3M8 | the malformed-envelope ERROR return dodges | the garbage-serving endpoint cannot re-resolve itself | `TestPollerMalformedEnvelopeAdvancesAndTheNextRoundLandsElsewhere`, principle row |
| W3M9 | the closing-header-failure ERROR return dodges | the next cadence stays free to land through a peer's own head | `TestPollerClosingHeaderFailureAdvancesAndTheNextRoundLandsElsewhere`, principle row |
| W3M10 | `routeNextRoundPastNonLanding` becomes a no-op | the seam's advance is real, not ceremonial | same fleet as W3M1 |
| W3M11 | oscillation lock: `advanceExploration` refuses to move an active hint | the ping-pong keeps revisiting every endpoint; a recovered endpoint is observed within one rotation | `TestPollerBothEndpointsHalfBrokenPingPongsAndObservesRecovery`, `TestPollerRepeatedCauseUnknownExploresAlternateEndpointsUntilProgress` |
| W3M12 | the landed flag is never set: even a landed round advances | **the KEEP side**: landing is the only outcome that keeps the start — and it DOES keep it, pinned where recordProgress cannot mask it (an ambiguous apply after a landed round) | `TestPollerAmbiguousApplyWithoutPinConsumesNoLease` |
| W3M13 | classification loses its bound: every failure classified as the recognized rejection | classification decides POSTURE ONLY, and unknown wording stays fail-closed ERROR (a transport failure must surface, never be swallowed as a discard); routing is indifferent to this mutant by construction | `TestPollerFailedRoundConsumesCadenceSlot`, `TestPollerMixedRejectionTransportFailureRecoversThroughThePeersOwnHead`, 3 principle rows |

Design notes, disclosed in the spec's meta verbatim:

- **Not mutation-testable, stated**: the invariant prose (comments carry no behavior); the
  REMOVAL of the per-arm `routeNextRoundPastDiscard` calls — their absence is the tested
  structure, and re-adding one alongside the seam would be behaviorally invisible because
  `advanceExploration` is idempotent for a fixed `servedBy` (base := servedBy.Index), so no
  honest test can distinguish it; the Step-side comment updates.
- The discard/refusal halves of every arm (nothing lands, nothing recorded) remain wave-1/wave-2
  mutation ground (t9w1 M2/M4/M5 at `53c0688`; t9w2 W2M2 at `2981f3e`); wave 3 attacks only what
  wave 3 changed: WHERE the advance lives and WHICH outcomes it covers.

## Verification bar

- `go build ./...` — clean. `go vet ./...` — clean.
- `gofmt`: CRLF working tree, so per the standing discipline each touched file was verified
  clean via a CR-stripped `gofmt -l` AND the COMMITTED BLOBS were checked:
  `git show HEAD:<file>` piped to a temp file → `gofmt -l` empty, for poller.go and
  poller_test.go at the code tip. (The first blob check attempt used `/dev/stdin`, which gofmt
  cannot read on Windows and which silently reports clean — it was redone via temp files; noted
  so nobody repeats the trap.)
- Full suite `go test -v -count=1 ./...` with `TEST_DATABASE_URL` set (so nothing skips):
  **598 PASS / 0 FAIL / 0 SKIP**, exit 0, at code tip `1b89fb5`.
- `-race` in the `golang:1.24` container (host Go lacks cgo), DB via `host.docker.internal`,
  live tests included: `ok internal/prices`, `ok internal/chain`. Command:
  `MSYS_NO_PATHCONV=1 docker run --rm -v "C:/Users/kasel/source/repos/etherfi/Solvent:/src" -w /src
  -e TEST_DATABASE_URL='postgres://solvent:solvent@host.docker.internal:5432/solvent_t9w1?sslmode=disable'
  -e GOFLAGS=-buildvcs=false --add-host=host.docker.internal:host-gateway golang:1.24
  go test -race -count=1 ./internal/prices/... ./internal/chain/...`.
- Environment discipline: the Task 9 backfill daemon (DB `solvent`, writer advisory lock) was
  never stopped and no test or mutation run ever pointed at its database; every run used
  `solvent_t9w1`. Pathspec staging throughout; no `git add -A`; in-memory mutation restores only,
  never `git checkout`.

## Unverified / out of scope, stated plainly

- **No real-chain contact was made by this wave.** Everything rests on the fake chain's failover
  semantics (which reproduce `chain.Failover.doFrom`'s walk and last-error retention) and on
  wave 2's live matrix for the rejection class. The chain layer needed — and received — no
  changes this wave, as the brief predicted: `internal/chain/**` untouched, `prices.go`
  untouched, `prices_test.go` (the fake) untouched.
- The `-race` runs cover `./internal/prices/... ./internal/chain/...` per the standing bar, not
  the whole repo (the whole repo's non-race suite is green; no other package changed). The
  race-clean claim was captured at `ed86b1d`; the only later code-file change (`1b89fb5`) is
  comments-only, over which the full non-race suite, gofmt, and the re-run mutation loop all
  passed — a `-race` re-run at the tip was not repeated for a comment diff, disclosed.
- `isBlockNotFoundErr`'s class list is unchanged from wave 2 and still text-matching; what
  changed is the blast radius of a miss — with routing independent of recognition, unknown
  wording now costs backoff time and log precision, never liveness. The residual (a provider
  whose rejection wording is outside the class takes the error posture until the list grows) is
  disclosed at the helper.
- The principle test drives every arm through `Step` with per-row FAILURE SHAPES injected at the
  fake chain — per-row arrangement is irreducible (each failure must be manufactured somewhere)
  — but the assertion block is uniform and the advance it asserts is produced by the one seam,
  not by per-arm code. An arm the fake cannot yet express would still get the advance
  structurally (the defer does not enumerate), but would need a new row here to be PINNED;
  stated in the test's contract comment.
- Liveness is proven for the 2-endpoint fleet (the configured production shape and the shape
  round-2's question named); the ping-pong argument generalizes by `advanceExploration`'s modulo
  arithmetic but is not separately tested for n>2 beyond the 3-endpoint cause-unknown rotation
  test that already existed.

Returns to Codex (prices unit) under D-006 — expected closing round. Nothing pushed;
`roadmap/` untouched.
