# Task 9 — wave 6 report: the response must answer the question asked

Brief: `task-9-wave6-brief.md` (round-5 fix wave, both findings ACCEPTED). Base: start commit
`8352af0` (control-plane tip; code directories byte-identical to wave-5's code tip `ce21cd3` —
verified by an empty `git diff ce21cd3 HEAD -- internal/ cmd/ migrations/` before any edit).
Branch `main`, serial tree — no other wave in flight. CLOSED law respected: the reported-hash
principle, the EIP-1898 pin, the routing seam and the aggregate classification are all untouched;
this wave hardens the DECODER wave 5 put under them.

| commit | contents |
| --- | --- |
| `15a4e11` | both gates + the whole regression fleet (chain.go; chain_test.go and chain_reported_hash_test.go fixture adaptations; new `chain_answers_test.go`, new `chain_rawjson_test.go`) |
| `71b8302` | mutation spec `.superpowers/sdd/t9w6-mutations/mutations.json`, committed BEFORE any loop ran |
| `64d53c6` | `t9w6-mutations/transcript.md`, **7/7 killed**, tested SHA `71b8302` (code bytes identical to `15a4e11` — the delta is `.superpowers/sdd/**` only) |
| (this report's commit) | `task-9-wave6-report-p2.md` |

## Test counts (top-level `^--- PASS` convention: `go test -v -count=1 ./...` through `grep -c '^--- PASS'`, subtests not counted)

- **Baseline at `8352af0`: 613 PASS / 0 FAIL / 0 SKIP**, exit 0, measured clean before any edit —
  `TEST_DATABASE_URL` at `solvent_t9w1` AND **`SOLVENT_LIVE_RPC_TESTS=1` (gate ON)**, so the
  network-gated live regression ran inside the counted baseline. Matches wave-5's final count.
- **Final (tree at `64d53c6`, code bytes == `15a4e11`): 622 PASS / 0 FAIL / 0 SKIP**, exit 0,
  same convention, same DB, **gate ON again** — the live regression is one of the 622; zero SKIP
  is literal on both runs, identical posture both runs.
- Delta +9, PASS-lists diffed BOTH directions on test names: zero deletions, zero renames. The
  nine (all internal/chain): `TestNumberedReadsRequireTheResponseToAnswerTheHeightAsked`,
  `TestAMismatchedResponseRotatesToTheHealthyNextEndpoint`,
  `TestAMismatchedResponseCannotInfluenceWalkerAncestryOrHeaderTime`,
  `TestHeaderReadsRefuseAResponseMissingARequiredField`,
  `TestRawJSONAdapterServesTheReportedFieldsAndAsksTheExactQuestion`,
  `TestRawJSONNullResultIsAnHonestNotFoundNotAViolation`,
  `TestRawJSONMissingRequiredFieldsAreProtocolViolationsThatRotate`,
  `TestRawJSONMalformedHexFailsTheAttemptAndRotates`,
  `TestRawJSONWellFormedWrongHeightResponseIsAViolationThatRotates`.
- `internal/prices/**` needed ZERO changes and got zero — not even test files. The whole wave is
  `internal/chain/**` + `.superpowers/sdd/**` (diff stat recorded from `8352af0` to the code tip).

## The rule, stated at the validation site

`validateReportedHeader` now carries the wave's one sentence as its contract: **trusting the
provider's REPORTED fields is only sound when paired with verifying the response ANSWERS THE
QUESTION ASKED.** Its signature gained the question — `validateReportedHeader(rh, what, want
*uint64)` — and every violation below fails the ATTEMPT inside the walk closure, so rotation
proceeds past the violator exactly like the zero-hash refusal (uniformly applied); only a walk
with no honest endpoint left surfaces the violation.

### Gate F1 [high] — exact-height equality on every numbered read

`HeaderHash`, `HeaderHashFrom` and `HeaderTime` pass `&n`; the gate requires
`rh.Number == n` after the uint64 check. A WELL-FORMED response for the WRONG height — Codex's
buggy proxy answering `latest` for numeric requests — is now a named protocol violation
("answers for height %d"), not a success: it can no longer date an old cursor with the current
head (false-green freshness) nor hand walker ancestry a hash for a block nobody asked about
(spurious mass rewind through stored logs instead of rotation). `HeadFrom` passes `nil`: a
"latest" read pins no height, so it validates internal consistency only — deliberately NOT
over-tightened.

### Gate F2 [medium] — presence-tracked required fields

`ReportedHeader`'s four fields are now POINTERS (`*common.Hash`, `*common.Hash`, `*hexutil.Big`,
`*hexutil.Uint64`): an omitted JSON field decodes as nil instead of as a plausible zero value,
and the gate refuses any absence as a named violation — "omits required field(s) hash,
parentHash, number, timestamp" as applicable — BEFORE the attempt is marked successful. The
non-pointer `Time` was the defect: an omitted `timestamp` decoded as 0, `HeaderTime` reported the
Unix epoch, `HeadFrom` an epoch-aged head, and failover STOPPED at the malformed primary with a
false stale verdict instead of reaching a healthy secondary. The zero-hash refusal and the
uint64-number check are retained verbatim behind the presence checks; the wave-5 error strings
for both are unchanged.

### Wave-5 report claim, CORRECTED (noted here; the wave-5 report is immutable history, not edited)

`task-9-wave5-report-p2.md` claimed HeaderTime's "behavior change is confined to refusing
protocol-violating responses it previously had no opinion on" — i.e. strictly a tightening. That
claim was FALSE. The wave-5 conversion also silently LOOSENED the decode: the retired
`types.Header` path rejected a missing `timestamp` as a required-field error, and the minimal
`ReportedHeader` decoder accepted it as zero — so HeaderTime traded one gate for another rather
than only gaining one. Codex round 5 caught the contradiction; the class (swapping a strict
decoder for a minimal one silently DROPPING protocol gates) is exactly what this wave's presence
tracking closes, and what its raw-JSON fixture layer makes testable.

## Null vs violation — the discrimination, stated

A `null` result for a numbered read is the provider's honest "I do not have this block" — the
LEGITIMATE answer for a height beyond the endpoint's head. Its semantics are pinned from three
sides:

- it surfaces as NOT-FOUND ("header %d not found"), never as a protocol violation — the error
  text carries the discrimination, because a misclassification would put honest lagging
  endpoints in the malformed bucket and page operators for ordinary beyond-head reads;
- it is never fabricated into a header (zero or otherwise) — no identity exists for a block the
  provider never served;
- it still fails the ATTEMPT, so rotation reaches an endpoint whose head is past the asked
  height — a lagging primary is walked past, not terminal (wave-5 behavior, retained).

Tests: `TestRawJSONNullResultIsAnHonestNotFoundNotAViolation` (below the seam: asserts the
not-found text, asserts "protocol violation" is ABSENT, asserts no fabricated identity, and
proves the lagging→healthy rotation lands); `TestHeaderReadsTreatAMissingBlockAsNotFound`
(wave 5, retained unchanged at the fake seam). Mutants W6M6/W6M7 attack both faces.

## The raw-JSON fixture layer — hermetic adapter tests BELOW the rpcClient fake seam

The blind-spot lesson of rounds 1–5, applied: fakes that always answer correctly cannot test the
decoder. Every fake-seam test scripts `*ReportedHeader` VALUES, so no fake-seam test can see what
an omitted field, a null result or malformed hex DECODES INTO — the exact layer where F2 lived.
`chain_rawjson_test.go` closes that layer: a local `httptest` JSON-RPC server
(`rawJSONEndpoint`) serves CRAFTED raw `result` payloads keyed by the request's block argument,
and every test drives the REAL stack — `Dial` → `rpc.Client` (HTTP) → `endpointClient`'s raw
`CallContext` decode → `validateReportedHeader` — with no fake anywhere in the path. The server
records every ask, so the tests also pin the QUESTION on the wire: exact hex quantities for
numbered reads ("0x5a"), "latest" for head reads, `false` for the fullTx flag. Fixtures carry
2026-era fields the vendored geth cannot represent (`withdrawalsRoot`, `blobGasUsed`), which the
decode must ignore, never re-hash — fixture realism carried down one level.

This also closes wave 5's disclosed honest limit: `endpointClient.ReportedHeaderByNumber` (raw
call, arg encoding, null pass-through) was "covered ONLY by the live regression"; it is now
covered hermetically in every ordinary run, and the live regression remains as the
canonical-value proof (it ran, gate ON, inside both counted suites).

## Every regression, cited

| property | test |
| --- | --- |
| F1: numbered reads refuse a well-formed wrong-height response, per path, with the violation naming the height actually answered | `TestNumberedReadsRequireTheResponseToAnswerTheHeightAsked` (`HeaderHash` / `HeaderHashFrom` / `HeaderTime` subtests) |
| F1: head reads pin no height — "latest" validates internal consistency only | `TestNumberedReadsRequireTheResponseToAnswerTheHeightAsked/head reads pin no height` |
| **Codex's binding regression 1**: a mismatched response ROTATES to the healthy next endpoint, which lands the read; token names the endpoint that answered the question | `TestAMismatchedResponseRotatesToTheHealthyNextEndpoint` |
| **Codex's binding regression 2**: a mismatched response can never influence walker ancestry (cursor-height reads) or HeaderTime — proven at the source both ways: error path hands out NO value; rotation path hands out only the asked block's own hash/timestamp (the walker's six ancestry call sites ride HeaderHash/HeaderHashFrom; the staleness gate rides HeaderTime) | `TestAMismatchedResponseCannotInfluenceWalkerAncestryOrHeaderTime` (both subtests) |
| F1 below the fake seam: the wrong-height proxy against the REAL decode, with the recorded ask proving the right question was on the wire; healthy secondary lands the round | `TestRawJSONWellFormedWrongHeightResponseIsAViolationThatRotates` |
| F2: each omitted required field named as absent, per field, at the fake seam | `TestHeaderReadsRefuseAResponseMissingARequiredField` (`missing hash` / `missing parentHash` / `missing number` / timestamp subtests) |
| F2's incident shape: a malformed primary (omitted timestamp) cannot stop failover — HeaderTime and HeadFrom both reach the healthy secondary; no epoch value escapes | `TestHeaderReadsRefuseAResponseMissingARequiredField/a malformed primary rotates to a healthy secondary`; `TestRawJSONMissingRequiredFieldsAreProtocolViolationsThatRotate/the F2 incident shape…` |
| F2 below the fake seam: raw responses omitting each required field decode as ABSENCE and are refused as named violations | `TestRawJSONMissingRequiredFieldsAreProtocolViolationsThatRotate` (four `omitted <field>` subtests) |
| adapter happy path: every value the Failover hands out is the crafted response's own field, and the exact question (hex height / "latest" / fullTx=false) is on the wire | `TestRawJSONAdapterServesTheReportedFieldsAndAsksTheExactQuestion` |
| null result = honest not-found: surfaces as such, never a violation, never a fabricated header, rotates past a lagging endpoint | `TestRawJSONNullResultIsAnHonestNotFoundNotAViolation`; `TestHeaderReadsTreatAMissingBlockAsNotFound` (retained) |
| malformed hex = decode failure of the attempt; rotation lands the healthy secondary | `TestRawJSONMalformedHexFailsTheAttemptAndRotates` |
| wave-5 surface retained: reported-hash principle, zero-hash refusal on all four paths + rotation, OP-shaped fixtures, live canonical hash | wave-5 fleet unchanged and green (`TestHeaderHashIsTheProviderReportedHash…`, `TestHeaderReadsRefuseAZeroReportedHash` et al.; `TestLiveOPIncidentBlockHashIsTheReportedCanonicalHash` ran gate-ON in both counted suites) |

Fixture adaptations, disclosed: `fakeRPC.fakeReported` and the OP-shaped fixture construct the
pointer fields via new helpers (`hashPtr`/`timePtr`); the wave-5 `zeroAt` fixture gained a present
parentHash and timestamp so the ZERO HASH stays the single violation its subtests observe (the
new presence gates would otherwise fire first and steal those assertions). No wave-5 assertion
was weakened; the zero-hash and not-found error strings are byte-identical.

## Mutation matrix (committed applier, spec+transcript tied to tested SHA)

Run through `.superpowers/sdd/wave16-mutations/mutate.py` (exactly-one-occurrence per edit,
byte-level in-memory restores, verified byte-identical) against `71b8302` (code bytes ==
`15a4e11`); spec committed before the loop, transcript after. `SOLVENT_LIVE_RPC_TESTS` unset for
every run (no endpoint hammering in loops — the raw-JSON layer needs no gate, its servers are
local); `TEST_DATABASE_URL` at `solvent_t9w1`. **7 mutants, 7 killed, 0 survived.** Every mutant
lives inside `validateReportedHeader` (the rule's single enforcement site), and every kill list
records BOTH fronts — the fake-seam regressions AND the raw-JSON tests below the seam.

| # | mutant | result | killed by (headline) |
| --- | --- | --- | --- |
| W6M1 | the F1 gate deleted: numbered reads accept a well-formed answer for ANY height | KILLED | both binding-regression tests + `TestNumberedReadsRequire…` + `TestRawJSONWellFormedWrongHeight…` (9 entries) |
| W6M2 | absent hash backfilled to a zero value for the zero gate to judge | KILLED | `…MissingARequiredField/missing hash` + `TestRawJSON…/omitted hash` |
| W6M3 | absent parentHash backfilled; the read SUCCEEDS with a fabricated lineage | KILLED | `…/missing parentHash` + `TestRawJSON…/omitted parentHash` |
| W6M4 | absent number ECHOED back as the height asked (F1 passes vacuously — the echo-chamber defect) | KILLED | `…/missing number` + `TestRawJSON…/omitted number` |
| W6M5 | absent timestamp decodes as the Unix epoch — the round-5 F2 defect restored verbatim | KILLED | all four timestamp regressions incl. both incident-shape rotation tests |
| W6M6 | null misclassified as a protocol violation | KILLED | `TestHeaderReadsTreatAMissingBlockAsNotFound` + `TestRawJSONNullResult…` |
| W6M7 | null fabricated into an empty header for the gates to judge | KILLED | same pair |

Disclosed in the spec's design notes: **W6M2 is a message-level kill** — an absent hash backfilled
to zero is still refused one line later by the wave-5 zero gate, so rotation is identical either
way and the violation's NAME ("omits" vs "zero hash") is the only observable; that name is the
property (a decoder misreporting absence as a reported zero is the F2 lie one level up), and no
stronger observable exists because the zero gate deliberately dominates. **W6M4's guard**
(`&& want != nil`) leaves the head path un-backfilled, where the later deref would panic — no
test drives that composition (the missing-number kills are numbered reads, dying by assertion);
disclosed so the guard is not mistaken for coverage. W6M5's command includes
`./internal/prices/` solely to re-record that suite's structural blindness to chain.go mutants
(the fake seam sits at `PollChain` — the W5M3/W5M5 precedent).

## Verification bar

- `go build ./...`, `go vet ./...` — clean at the code tip.
- gofmt: working-tree copies checked via CR-stripped temp files; COMMITTED BLOBS at `15a4e11`
  verified via `git cat-file -p` → temp file → `gofmt -l` empty (never `/dev/stdin`) for all five
  touched Go files. (Method note: `git show > file` was observed CRLF-smudging on this Windows
  git, so the blob check uses `cat-file`, whose output was verified LF raw bytes.)
- Full suite: baseline **613/0/0** at `8352af0`; final **622/0/0** at `64d53c6` (code bytes ==
  `15a4e11`) — **gate ON for both**, PASS-lists diffed both directions, +9, zero deletions.
- `-race` in `golang:1.24` via `host.docker.internal` (wave-3's exact command shape):
  `ok internal/prices 1.984s`, `ok internal/chain 1.062s`, exit 0, at the final code bytes.
- Environment discipline: the backfill daemon (DB `solvent`) was never stopped and nothing
  pointed at its DB — every run used `solvent_t9w1`. Pathspec staging throughout ; in-memory
  mutation restores only; the loop ran against committed work.
- Line endings: chain.go and chain_test.go are CRLF working copies (the mutation spec's `\r\n`
  patterns target chain.go only; byte-verified 768/768 CRLF before the loop). The three other
  test files are LF working copies that will normalize to CRLF on next checkout; committed blobs
  are LF for all five (verified), so diffs contain only real changes.

## Unverified / honest limits, stated plainly

- **The raw-JSON layer is hermetic realism, not live proof**: its fixtures assert what the
  decoder does with crafted shapes (per the JSON-RPC spec's field names), and the live regression
  remains the only proof that a real OP endpoint's responses match those shapes and carry the
  canonical hash — it ran gate-ON inside both counted suites and passed. HTTP is the one
  transport exercised hermetically (httptest); ws transports ride the same `rpc.Client` decode
  but are not separately driven.
- **W6M2's kill is message-level and W6M4 carries an untested head-path guard** — both disclosed
  above and in the spec, not discoveries a reviewer has to make.
- The F1 gate compares against `rh.Number` AFTER the presence and uint64 gates, so on the head
  path (`want == nil`) a nil number is still refused by presence — there is no want-nil bypass of
  the earlier gates; asserted implicitly by the head-read subtests, stated here for the record.
- `-race` covers `./internal/prices/... ./internal/chain/...` per the standing bar, not the whole
  repo (whole-repo non-race suite is green; no other package changed).
- Stored OP cursor state and the daemon restart remain the controller's post-approval steps
  (unchanged from wave 5's closing notes); nothing in this wave touches them.

Returns to Codex under D-006 — expected closing round for the chain reopen.
