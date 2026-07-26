# Task 9 — wave 9 report: authenticate the body, not the label

Brief: `task-9-wave9-brief.md` (round-8 F1 [medium] ACCEPTED, surgical: one finding, one
fix, one inverse regression). Base: start commit `2c259e6` (control-plane tip; code bytes
for `internal/` identical to wave-8's `f0a5560` — verified by empty diff). Branch `main`,
serial tree. One concurrent controller commit disclosed: `bdefc0c` (docs-only, one line in
`.superpowers/sdd/progress-phase2.md`) landed between the start snapshot and this wave's
first commit — zero code bytes touched, the baseline remains valid for the code tested.

| commit | contents |
| --- | --- |
| `990c9f0` | THE FIX: `TransactionByHash` requires `tx.Hash()` recomputed over the decoded signed body to EQUAL the asked hash (mismatch = named protocol violation = failed attempt = rotation); the wave-8 reported-field equality is kept as the cheap early tripwire; the method doc carries the round-8 adjudication's recomputation line verbatim; + the inverse regression and the one disclosed wave-8 subtest re-fixture (chain.go, chain_rawjson_test.go — the only two code files touched all wave) |
| `73a5698` | mutation spec `.superpowers/sdd/t9w9-mutations/mutations.json` (1 mutant, W9M1), committed BEFORE the loop ran |
| `598183f` | `t9w9-mutations/transcript.md`, **1/1 killed**, tested SHA `73a5698` (code bytes identical to `990c9f0` — the delta is `.superpowers/sdd/**` only) |
| (this report's commit) | `task-9-wave9-report-p2.md` |

Scope: `git diff --name-only 2c259e6..598183f` minus the controller's `bdefc0c` is exactly
`internal/chain/chain.go`, `internal/chain/chain_rawjson_test.go`, and the two
`t9w9-mutations/` files. Nothing else changed in any of this wave's commits.

## The fix (F1 [medium] — `chain.go`, the `TransactionByHash` identity gate)

The wave-8 gate compared the request only with the response's independently supplied
`hash` field — which `types.Transaction.UnmarshalJSON` ignores entirely, so it is the
provider agreeing with itself. Since this wave, after the raw bytes decode through
`types.Transaction`, the recomputed `tx.Hash()` over the decoded body must equal the
asked hash; a mismatch is a named protocol violation ("transaction response body hashes
to X, not the asked Y … echoing the label cannot authenticate the body") that fails the
attempt and rotates. The reported-field check survives ABOVE the gate as an earlier,
cheaper tripwire for sloppier lies (and its presence arm is unchanged), but the DECODED
comparison is the gate. Gate ordering, deliberate: null→NotFound, input canon + presence,
hash presence + reported-field tripwire, full decode, signature presence (ethclient-
mirrored), THEN recomputation — so no unsigned or undecodable body ever reaches the
recomputed hash.

The method doc carries the controller's round-8 adjudication line verbatim (diffed
word-for-word against `task-9-codex-round8.md` — the sole delta is the markdown bold
markers, which are not carried into the Go comment; the backticked identifiers are):
recomputation is BANNED where the pinned library's type model is incomplete (headers —
the wave-5 law) and REQUIRED where it is complete and the only authentication (signed
transactions), both from one principle: authenticate with the strongest tool the type
model makes sound. The undecodable-type arm is structural, not aspirational: a tx type
v1.13.0 cannot decode errors out of `json.Unmarshal` and fails the attempt into rotation
before any recomputation could run.

## The inverse regression (binding)

`TestRawJSONEchoedHashOverForeignSignedBodyIsAViolationThatRotates` — real `Dial` →
`rpc.Client` (HTTP) → the raw decode, against the crafted-JSON endpoint. The lying body
is built from a VALIDLY-SIGNED different transaction: deterministic test key material
(`crypto.HexToECDSA` + `types.SignTx`, `HomesteadSigner`), different nonce, recipient,
and calldata, signature proven genuine in-test by sender recovery (`types.Sender`
round-trip to the key's address). Its `hash` field is then overwritten to EQUAL the
asked hash — asserted in-test on the raw bytes: the lie is affirmative. Asserted legs:

- alone, the attempt FAILS with the decoded-comparison violation by name, and
  `require.NotContains(err, "answers for transaction")` proves the wave-8 tripwire is
  NOT what fired — the echoed label passed the field check; only recomputation refused
  the body;
- no foreign calldata escapes (`require.Nil(data)`);
- with a healthy secondary the fixture's calldata LANDS byte-for-byte (full landing) and
  the liar was asked exactly once and rotated past.

**One wave-8 test edit, disclosed (closed-law-adjacent):** the "canonical empty payload
stays servable" subtest of `TestRawJSONEmptyTxInputFailsTheAttemptAndTheSecondaryLandsCalldata`
formerly grafted `"input":"0x"` onto the fixture body while the response still reported
the fixture's hash. Under the new law that graft IS a forged body — altered input under
an echoed label, the exact class the finding names — and the gate now (correctly)
refuses it. The subtest is re-fixtured to a self-consistent plain transfer (genuinely
empty calldata) asked for by ITS OWN hash; the asserted property is unchanged and still
guards over-tightening: a plain transfer's empty calldata is a value, only a non-answer
is refused. No other wave-5/6/7/8 test or assertion changed; `rawTxJSON` was split into
a delegating wrapper over the new `rawTxJSONFor` (byte-identical behavior for every
existing caller).

## Mutation (committed applier, spec+transcript tied to tested SHA)

Run through `.superpowers/sdd/wave16-mutations/mutate.py` (exactly-one-occurrence
asserted, byte-level in-memory restores verified byte-identical, `git status --porcelain`
over the mutated file EMPTY after the loop) against `73a5698` (code bytes == `990c9f0`);
spec committed before the loop, transcript after. `SOLVENT_LIVE_RPC_TESTS` unset for the
run; `TEST_DATABASE_URL` at `solvent_t9w1`. **1 mutant, 1 killed, 0 survived.**

| # | mutant | kill class | isolation |
| --- | --- | --- | --- |
| W9M1 | the decoded comparison deleted — the reported field (the provider agreeing with itself) becomes the only identity check, restoring the round-8 finding faithfully (the tripwire survives intact) | **behavioral on every asserted leg** (the liar-alone read succeeds, the foreign calldata escapes, no rotation happens) | kill list is EXACTLY `TestRawJSONEchoedHashOverForeignSignedBodyIsAViolationThatRotates` — the brief's "killed by exactly this regression", and the proof the wave-8 wrong-tx test (label disagrees) and the new test (label lies affirmatively) partition the two shapes between tripwire and gate |

## Test counts (top-level `^--- PASS` convention: `go test -v -count=1 ./...` through `grep -c '^--- PASS'`, subtests not counted)

- **Baseline at `2c259e6`: 632 PASS / 0 FAIL / 0 SKIP**, exit 0, measured clean before
  any edit — `TEST_DATABASE_URL` at `solvent_t9w1` AND **`SOLVENT_LIVE_RPC_TESTS=1`
  (gate ON)**; the live regression ran inside the counted baseline
  (`TestLiveOPIncidentBlockHashIsTheReportedCanonicalHash`, 0.52s — executed, not
  skipped). Matches wave-8's final count exactly.
- **Final (tree at `598183f`, code bytes == `990c9f0`): 633 PASS / 0 FAIL / 0 SKIP**,
  exit 0, same convention, same DB, **gate ON again** (live regression executed, 0.47s) —
  identical posture both runs; zero SKIP is literal on both.
- Delta +1, PASS-lists diffed BOTH directions on test names: zero deletions, zero
  renames. The one addition is exactly the binding inverse regression,
  `TestRawJSONEchoedHashOverForeignSignedBodyIsAViolationThatRotates` (the re-fixtured
  empty-payload subtest keeps its wave-8 name and is a subtest — not counted by the
  top-level convention, changed as disclosed above).

## Verification bar

- `go build ./...`, `go vet ./...` — clean at the final code bytes.
- gofmt: working-tree copies of both touched files via CR-stripped temp files —
  formatted; COMMITTED BLOBS at `990c9f0` verified via `git cat-file -p` → temp file →
  `gofmt -l` empty, blobs contain ZERO CR bytes (both files).
- `-race` in `golang:1.24` via `host.docker.internal` (DB `solvent_t9w1`):
  `ok internal/prices 1.998s`, `ok internal/chain 1.141s`, exit 0, at the final code
  bytes.
- Environment discipline: the backfill daemon (DB `solvent`) was never stopped and
  nothing pointed at its DB — every run used `solvent_t9w1`. Pathspec staging throughout;
  the mutation loop ran against committed work with in-memory restores only; no code file
  was edited after the loop (the transcript's tested SHA shares the final code bytes).
- Line endings: chain.go remains a uniform-CRLF working copy (CR count == line count,
  re-verified after every edit — 1351/1351 final); chain_rawjson_test.go's working copy
  became uniform CRLF this wave (it was the LF anomaly wave 6 predicted would normalize;
  the editing toolchain normalized it — uniform, not mixed, verified 1125/1125);
  committed blobs are LF for both, and the staged diff is content-only (no line-ending
  churn — 2 files, 146 insertions, 15 deletions at `990c9f0`).

## Unverified / honest limits, stated plainly

- **Hermetic realism, not live proof** (the standing wave-6/7/8 limit, carried): no live
  provider was observed substituting a foreign signed body under an echoed hash; the
  regression asserts what the real Dial stack does with crafted bytes. The gate-ON live
  regression still pins the happy path for header identity only.
- **The foreign body is a legacy (Homestead-signed) transaction.** The gate is
  type-agnostic — `tx.Hash()` is consensus-stable for every type v1.13.0 can decode, and
  the happy-path fixtures round-trip through the same pinned encoder — but no
  typed-envelope (1559/2930/4844) foreign-body fixture was added this wave; the surgical
  brief named one regression and got exactly it.
- **The adjudication line is carried verbatim minus markdown bold markers** (`**`), which
  do not survive into a Go comment; the backticked identifiers and every word are
  byte-diffed identical (verified mechanically against `task-9-codex-round8.md`).
- **The tripwire's independent value is name-level only**: with the decoded gate present,
  removing the tripwire would change which violation NAME a sloppy lie surfaces (the
  W8M13/W8M14 kills still pin its arms behaviorally at wave-8's shape — under the wave-9
  gate those mutants' lying fixtures would now die one check later). No wave-8 mutant was
  re-run this wave; the wave-9 spec is the single surgical mutant the brief bound.
- Stored cursor state and the daemon restart remain the controller's post-approval steps;
  nothing in this wave touches them.

Returns to Codex under D-006 — expected CLOSING round for the chain-layer reopen. The
round-8 edge (reported-field equality authenticating nothing) is closed by recomputation
exactly where the adjudication requires it, the inverse regression partitions the lie
shapes between tripwire and gate, and the recomputation line now lives in the code where
waves 5 and 9 meet.
