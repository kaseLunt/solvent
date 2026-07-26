# Task 9 — wave 4 report (P2): one classification authority per round outcome

Brief: `.superpowers/sdd/task-9-wave4-brief.md` (Codex round 3: 1 medium, ACCEPTED; verbatim +
adjudication in `task-9-codex-round3.md`). Base: `d25b1e8` (the round-3 archive / wave-4 brief
commit; wave-3 code tip `1b89fb5` unchanged beneath it). ONE fix this wave: order-independent
round-outcome classification from the AGGREGATE of per-attempt results. The wave-3 non-landing
routing seam is closed law and was NOT touched — re-certified by mutation at the rewritten site
(W4M7/W4M8 below). Implementation commits, in order, all pathspec-staged on `main`:

| commit | contents |
|---|---|
| `f09cbb4` | chain layer (the sanctioned additive change): `CallAtHashFrom` walks through `doFromAttempts`, retaining every attempted endpoint's own error; total failure returns `*chain.PinnedCallError` (`AttemptError` per attempt, walk order); `Error()`/`Unwrap()` mirror `doFrom`'s exact total-failure shape; 3 new chain tests |
| `0a46218` | poller: `readRound`'s posture computed by `allAttemptsRejectedPin` over the aggregate, THE RULE stated verbatim at the classification site; fake chain's pinned walk mirrors the aggregate; daemon-worker-wrapper replica harness + 3 multi-cadence regression tests (both mixed orders + all-rejections); prose updated where last-error-wins was asserted (**the code tip** — no code file changes after it) |
| `a68b991` | mutation matrix spec (`.superpowers/sdd/t9w4-mutations/mutations.json`, wave-16 committed applier), committed BEFORE any loop ran |
| `f8e4411` | mutation transcript tied to tested SHA `a68b991` (code bytes identical to `0a46218` — the delta is `.superpowers/sdd/**` only) |
| (this report's commit) | `.superpowers/sdd/task-9-wave4-report-p2.md` |

## Test counts (top-level `^--- PASS` convention: `go test -v -count=1 ./...` piped through `grep -c '^--- PASS'`, subtests indented and not counted)

- **Baseline at `d25b1e8`: 598 PASS, 0 FAIL, 0 SKIP**, exit 0 — measured clean before any edit,
  `TEST_DATABASE_URL` at the wave's dedicated DB `solvent_t9w1` (the running backfill daemon's DB
  `solvent` was never touched). Matches wave-3's final count.
- **Final (tip `f8e4411`, code files identical to `0a46218`): 604 PASS, 0 FAIL, 0 SKIP**, exit 0,
  same convention, same DB.
- Delta +6, PASS-lists diffed BOTH directions on test names. Zero deletions, zero renames. The six:
  `TestCallAtHashFromRetainsPerAttemptOutcomesInBothWalkOrders`,
  `TestOnlyThePinnedCallPathCarriesTheAttemptAggregate`,
  `TestCallAtHashFromAbortIsNotAnAttemptAggregate` (internal/chain),
  `TestPollerMixedOutageTransportThenRejectionNeverResetsTheDaemonBackoff`,
  `TestPollerMixedOutageRejectionThenTransportKeepsStepErrorAcrossAlternation`,
  `TestPollerAllRejectionsRoundStillDiscardsCleanlyThroughTheDaemonWrapper` (internal/prices).

## The aggregate outcome design

**Chain layer** (`internal/chain/chain.go`, additive, sanctioned by the brief). `doFrom` keeps only
the LAST endpoint's error — that retention is what made the poller's posture an accident of
rotation. The pinned-call path alone now walks through `doFromAttempts`: the same rotation, the
same per-attempt timeout, the same abort-on-context behavior, but a total failure returns
`*PinnedCallError{Op, Attempts}` where each `AttemptError{Endpoint, Err}` carries one attempted
endpoint's own error, verbatim, in walk order — the token discipline mirrored onto failures
(`EndpointToken` names the endpoint that served a success; an attempt record names the endpoint
that produced each failure). Compatibility is deliberate and tested: `Error()` renders doFrom's
exact wording (`all rpc endpoints failed (callAtHash): <last error>`) and `Unwrap()` exposes the
last attempt's error (doFrom's old `%w` target), so surfaced logs and `errors.Is/As` chains over
the last error are unchanged. Every other method keeps `doFrom`; the snapshotter and every
shared-path caller see no change — pinned by `TestOnlyThePinnedCallPathCarriesTheAttemptAggregate`
(CallFrom / Call / CallAtFrom / BlockNumber all still fail withOUT the aggregate). A context abort
mid-walk is NOT an aggregate (`TestCallAtHashFromAbortIsNotAnAttemptAggregate`): an interrupted
walk proves nothing about unattempted endpoints, so it can never read as unanimity.

**Poller** (`internal/prices/poller.go`, the classification site in `readRound`). THE RULE, stated
in a comment at the site verbatim: **one classification authority per round outcome — the posture
is computed from the AGGREGATE of per-attempt outcomes, never from whichever endpoint's error the
failover walk happened to surface last. Discard posture ONLY when every failed attempt is a
recognized pin rejection; ANY transport or unknown involvement retains the fail-closed ERROR
posture (the daemon's backoff streak grows, `step_error` stays visible). The deferred routing
advance applies unconditionally to every non-landing round — the seam is closed law.**
`allAttemptsRejectedPin` implements it: `errors.As` to `*chain.PinnedCallError`, then
`isBlockNotFoundErr` per attempt; no aggregate (an abort, or a chain surface that does not retain
attempts) fails closed to ERROR. `isBlockNotFoundErr` itself is unchanged (same class list, same
text matching); what changed is WHERE it is applied — per attempt, under a unanimity requirement —
and its contract comment now says so.

**Fake chain** (`internal/prices/prices_test.go`). `fakePollChain.CallAtHashFrom` mirrors
`doFromAttempts`: per-attempt outcomes retained, total failure returns the same
`*chain.PinnedCallError`. A fake that kept last-error-wins would have made the aggregate
classification untestable in the direction that matters (no test could present a mixed walk to
refuse); its fidelity to the REAL walk is pinned from the chain side by the new chain tests plus
W4M4/W4M5.

## The daemon-worker-wrapper harness, and the one scope-forced replication

The brief requires the regressions driven "through the daemon worker wrapper" — and the wrapper
(`priceWorkerState` + `retryBackoff` + `stepPriceWorkers`) lives in `cmd/indexer`, package `main`,
which is both OUT OF SCOPE for this wave and unimportable from any test. So the harness REPLICATES
it in `internal/prices/poller_test.go` and drives the REAL `*Poller` through the replica (the
wave-13/15 health-harness precedent: drive the real component; the daemon's own health tests drive
fake workers, this drives the real one). Mirrored VERBATIM, cited to `cmd/indexer/main.go`:
`retryBackoff.ready()/failure()/success()` including the guarded shift and the jitter formula
(lines 64–98; the harness pins `rand` to 0.5, which zeroes the ±20% jitter term exactly — the
health harness's own convention), the constants `retryBackoffBase`=30s / `retryBackoffCap`=10min /
`stepsPerRound`=5 (lines 46–62), and `stepPriceWorkers`' loop body for one worker (lines 524–570):
step until the first error or first non-advancing Step; a non-nil non-canceled error consumes one
backoff unit and is RETAINED; a clean round resets; `step_error` is recomputed from the retained
error every daemon round INCLUDING rounds spent waiting out the backoff window, carrying the
consecutive count in `stepPriceWorkers`' exact format string. This replication is the wave's one
deviation from a literal reading of the brief, forced by the scope bound, and it is disclosed here
rather than papered over. `cmd/**` was never touched.

## Both mixed-order regressions, cited to tests (all in internal/prices/poller_test.go)

| obligation (brief) | test |
|---|---|
| **Order A, transport→rejection** — endpoint 0 transport-fails the pinned call, endpoint 1 rejects the pin; the walk from 0 surfaces the RECOGNIZED rejection LAST, the exact shape last-error-wins misread as a clean discard on the outage's FIRST round (Codex's headline). Aggregate: ERROR posture, streak 1→2→3→4 monotone, `retryIn` doubling 30s→240s toward the cap, `step_error` present each round and carrying the honest streak; the round-1 assertion pins that the rejection WAS the surfaced headline and the posture stayed the error | `TestPollerMixedOutageTransportThenRejectionNeverResetsTheDaemonBackoff` |
| **Order B, rejection→transport** — the mirror fixture; round 1 (rejection first) was already an error under the old code, and round 2 — where the deferred advance rotates the walk so the rejection runs LAST — is where the old classification flipped to a discard, reset the streak mid-outage and blanked `step_error`. Aggregate: the streak is monotone THROUGH round 2 (asserted by name), `step_error` never disappears across the alternation | `TestPollerMixedOutageRejectionThenTransportKeepsStepErrorAcrossAlternation` |
| (a) persistent transport involvement never resets the backoff streak | both tests above: `require.Equal(t, i, h.bo.failures)` every round, 4 rounds, both orders |
| (b) `step_error` remains visible across the alternation — including daemon rounds spent INSIDE the backoff window, where no Step is attempted and the retained condition must keep publishing | order-A test's mid-window check (advance 1s into the round-2 window: no `HeadFrom`, condition still `"Step failed 2 consecutive round(s)"`); order-B test's per-round `NotEmpty` |
| (c) routing still advances every non-landing round | `exploreStart == i%2` every round in both mixed tests; `headStarts == [0,1,0,1]` (the alternation Codex described — now with a posture that no longer alternates with it); the all-rejections test asserts the advance on the DISCARD side too |
| (d) the all-rejections round still discards cleanly | `TestPollerAllRejectionsRoundStillDiscardsCleanlyThroughTheDaemonWrapper`: two mixed rounds build a real streak (contrast), then unanimity — streak resets to 0, `step_error` clears, the WARN with evidence is logged, nothing recorded, and the start keeps advancing multi-cadence |

The wave-3 fleet stands unmodified: the principle test's 12 rows, the six named wave-3 regressions
and the liveness ping-pong all pass with no assertion weakened. The wave-2/3 masked-rejection test
(`TestPollerMixedRejectionTransportFailureRecoversThroughThePeersOwnHead`) now certifies the same
outage under the aggregate (mixed → error, routing advances) and killed four of the eight mutants.
Both mixed-order wrapper tests end (order A) or bound (order B) with recovery/`applied`-empty
assertions, so the error posture is proven fail-closed, not fail-forever.

## Mutation matrix

Run per the wave-16 class rule through the committed applier
(`.superpowers/sdd/wave16-mutations/mutate.py`: exactly-one-occurrence assertion per edit,
byte-level backups, in-memory restores verified byte-identical — never `git checkout`). Spec:
`.superpowers/sdd/t9w4-mutations/mutations.json`, committed at `a68b991` BEFORE any loop ran.
Transcript: `.superpowers/sdd/t9w4-mutations/transcript.md`, **tested SHA `a68b991`** — whose code
bytes are the code tip `0a46218` exactly (the delta is the spec file itself). Restore verification
in the transcript: both mutated files byte-identical after the run.

**8 mutants, 8 KILLED, 0 survived — every kill by named test assertion, zero compiler kills**
(every killer list in the transcript names failing tests; a compile kill would name none).

| id | mutation | property certified | killed by (headline) |
|---|---|---|---|
| W4M1 | last-error-wins restored at the classification site (`isBlockNotFoundErr(err)` over the surfaced error) | the posture is computed from the AGGREGATE and is order-independent | both mixed-order wrapper tests + the all-rejections wrapper test |
| W4M2 | unanimity flipped to any-rejection-wins | ANY transport/unknown involvement retains the ERROR posture | both mixed wrapper tests, the wave-3 masked-rejection test, principle row, all-rejections test |
| W4M3 | the aggregate is never consulted (every total failure → error posture) | the all-rejections round still discards cleanly (WARN, no backoff burn) | all-rejections wrapper test, `TestPollerHashPinRefusesASplitForkBackendAtTheSameHeight`, `TestPollerPinRejectionExploresAndTheNextRoundLandsElsewhere`, principle row |
| W4M4 | chain wiring reverted: `CallAtHashFrom` back on `doFrom` | the REAL pinned path retains per-attempt outcomes (the contract the fake models) | `TestCallAtHashFromRetainsPerAttemptOutcomesInBothWalkOrders` |
| W4M5 | `doFromAttempts` keeps only the LAST attempt (a window of one wearing the aggregate's type) | the aggregate carries EVERY attempted endpoint's outcome | `TestCallAtHashFromRetainsPerAttemptOutcomesInBothWalkOrders` |
| W4M6 | only the FIRST attempt judged (front-biased order dependence) | order-independence, attacked from the opposite end to W4M1/W4M5 | both mixed wrapper tests, masked-rejection test, principle row, all-rejections test |
| W4M7 | the rewritten unanimous-rejection discard dodges the seam (`landed = true`) | the seam is closed law at the rewritten site, discard side | `TestPollerPinRejectionExploresAndTheNextRoundLandsElsewhere`, all-rejections test, principle rows |
| W4M8 | the rewritten post-call ERROR return dodges the seam (`landed = true`) | the seam is closed law at the rewritten site, error side | both mixed wrapper tests, masked-rejection test, liveness ping-pong, 3 principle rows |

Design notes, disclosed in the spec's meta verbatim:

- **W4M4/W4M5 are invisible to the prices suite, stated in the transcript by construction**: their
  test commands include `./internal/prices/` and the killer lists show only chain tests — the
  poller tests drive the fake, which models the aggregate contract; the chain tests are what pin
  the REAL `Failover` to that contract. Same fidelity discipline that kept the fake's last-error
  walk honest in waves 2–3, now pointing the other way.
- **Not mutation-testable, stated**: the empty-`Attempts` guard in `allAttemptsRejectedPin`
  (`doFromAttempts` constructs the error only after ≥1 failed attempt and `Dial` refuses zero
  endpoints, so no reachable behavior distinguishes it — defensive depth, fails closed);
  `PinnedCallError.Error()/Unwrap()`'s last-error mirroring (pinned by the chain tests' wording
  assertions instead); the harness itself (test code — mutants attack production code only).

## Verification bar

- `go build ./...` — clean. `go vet ./...` (incl. both touched packages) — clean.
- `gofmt`: CRLF working tree, so each touched file was verified clean via a CR-stripped
  `gofmt -l` AND the COMMITTED BLOBS were checked via TEMP FILES (`git show HEAD:<file>` → temp →
  `gofmt -l` empty; never `/dev/stdin`, which silently no-ops on Windows — wave-3's trap) for all
  five touched Go files at the code tip.
- Full suite `go test -v -count=1 ./...` with `TEST_DATABASE_URL` set (so nothing skips):
  **604 PASS / 0 FAIL / 0 SKIP**, exit 0, at tip `f8e4411` (code files byte-identical to
  `0a46218`).
- `-race` in the `golang:1.24` container (host Go lacks cgo), DB via `host.docker.internal`, live
  tests included: `ok internal/prices`, `ok internal/chain`, exit 0, run at the same code bytes.
  Command as in the wave-3 report (MSYS_NO_PATHCONV=1, volume mount, GOFLAGS=-buildvcs=false,
  --add-host=host.docker.internal:host-gateway).
- Environment discipline: the Task 9 backfill daemon (DB `solvent`) was never stopped and no test
  or mutation run ever pointed at its database; every run used `solvent_t9w1`. Pathspec staging
  throughout; no `git add -A`; in-memory mutation restores only.

## Unverified / out of scope, stated plainly

- **No real-chain contact was made by this wave.** The aggregate's production behavior rests on
  the chain package's fake-RPC tests (which drive the real `Failover` walk) and on wave 2's live
  matrix for the rejection class; the poller-side regressions rest on the fake chain's mirror of
  that contract. The two are stitched by W4M4/W4M5: mutants that decouple the real walk from the
  contract the fake models die in the chain suite.
- **The daemon worker wrapper is a verbatim replica, not the daemon's own code** (scope-forced;
  see the harness section). If `cmd/indexer`'s composition ever changes shape (constants, the
  retained-error publication, the stepsPerRound loop), the replica does not fail by itself — the
  mirror is cited line-by-line so a future wave can re-verify it, and moving the wrapper into an
  importable package is the structural fix, deliberately not made here (cmd/** is out of scope).
- **Line endings**: `internal/chain/chain.go` / `chain_test.go` were LF in the working tree before
  this wave and are CRLF after (a side effect of the editing tools). Committed blobs are LF via
  `core.autocrlf` and the diffs contain only real changes; disclosed because the mutation spec's
  `\r\n`-embedded patterns depend on the working-tree form.
- `-race` covers `./internal/prices/... ./internal/chain/...` per the standing bar, not the whole
  repo (the whole repo's non-race suite is green; no other package changed).
- `isBlockNotFoundErr`'s class list is unchanged and still text-matching. The wave-4 residual is
  NARROWER than wave 3's: an out-of-class rejection wording on any single endpoint now pushes a
  genuinely-unanimous rejection walk to the ERROR posture (backoff time and log precision, never
  liveness, and never a false discard) — fail-closed in the safe direction by construction.
- The all-rejections discard resets the daemon streak BY DESIGN (nil is the wrapper's success
  path): a unanimous rejection is the serving node possibly alone on its fork, health-relevant via
  the WARN and freshness aging, not backoff-relevant. An outage ALTERNATING between unanimous
  rejection and transport involvement round-by-round would still see streak resets on the unanimous
  rounds — that is the honest reading of the postures, not a residue of the bug (the posture no
  longer depends on walk order, only on what the round's own attempts actually were).

Returns to Codex (prices unit) under D-006 — expected closing round. Nothing pushed;
`roadmap/` untouched; `internal/ingest/**` (the walker-layer class recorded in round 3) untouched.
