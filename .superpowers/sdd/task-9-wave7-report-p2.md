# Task 9 — wave 7 report: the answer holds at the bytes level

Brief: `task-9-wave7-brief.md` (round-6 fix wave, F1 [medium] ACCEPTED — surgical). Base: start
commit `e3a2150` (control-plane tip; code directories byte-identical to wave-6's code tip
`15a4e11`, verified by an empty `git diff 15a4e11 HEAD --stat -- internal/ cmd/ migrations/`
before any edit). Branch `main`, serial tree. CLOSED law respected: the reported-hash principle,
the EIP-1898 pin, the wave-6 presence gates and exact-height equality, and the null-vs-violation
discrimination are all untouched; this wave puts a BYTES-level gate under the presence gates,
exactly one decoder layer down from where wave 6 stopped.

| commit | contents |
| --- | --- |
| `93b7658` | the fix + both binding regressions + the malformed-quantity matrix (chain.go, chain_rawjson_test.go — the only two files touched) |
| `1e5f268` | mutation spec `.superpowers/sdd/t9w7-mutations/mutations.json`, committed BEFORE any loop ran |
| `7fcb4f4` | `t9w7-mutations/transcript.md`, **6/6 killed**, tested SHA `1e5f268` (code bytes identical to `93b7658` — the delta is `.superpowers/sdd/**` only) |
| (this report's commit) | `task-9-wave7-report-p2.md` |

## Test counts (top-level `^--- PASS` convention: `go test -v -count=1 ./...` through `grep -c '^--- PASS'`, subtests not counted)

- **Baseline at `e3a2150`: 622 PASS / 0 FAIL / 0 SKIP**, exit 0, measured clean before any
  edit — `TEST_DATABASE_URL` at `solvent_t9w1` AND **`SOLVENT_LIVE_RPC_TESTS=1` (gate ON)**;
  the live regression ran inside the counted baseline (`TestLiveOPIncidentBlockHashIsThe
  ReportedCanonicalHash`, 0.48s — executed, not skipped). Matches wave-6's final count.
- **Final (tree at `7fcb4f4`, code bytes == `93b7658`): 624 PASS / 0 FAIL / 0 SKIP**, exit 0,
  same convention, same DB, **gate ON again** — identical posture both runs; zero SKIP is
  literal on both.
- Delta +2, PASS-lists diffed BOTH directions on test names: zero deletions, zero renames.
  The two: `TestRawJSONEmptyTimestampFailsTheAttemptAndTheSecondaryLandsHeaderTime`,
  `TestRawJSONEmptyNumberFailsTheAttemptAndTheSecondaryLandsHeadFrom` (the brief's binding
  pair). The wave-6 matrix test `TestRawJSONMalformedHexFailsTheAttemptAndRotates` was
  EXTENDED in place (same top-level name, 14 matrix arms + 2 pinning subtests), so it appears
  in neither diff direction.
- Scope: `git diff --stat e3a2150 93b7658` touches exactly `internal/chain/chain.go` and
  `internal/chain/chain_rawjson_test.go`. `internal/prices/**` needed ZERO changes and got
  zero; nothing outside `internal/chain/**` + `.superpowers/sdd/**` changed in any commit.

## The finding, restated at the layer it lived

Wave 6 moved the required-field gate to pointer-nil ("presence tracking") — but the LIBRARY's
decode semantics define what becomes non-nil, and the pinned go-ethereum v1.13.0 hexutil
decoders read the empty JSON string as ZERO. Reproduced verbatim in this wave's executed audit
(see below): `json.Unmarshal(`""`, &b)` yields **err=nil, val=0x0** for both `*hexutil.Big` and
`*hexutil.Uint64`. So `"timestamp":""` passed presence as a non-nil Unix epoch and
`"number":""` passed `HeadFrom` as height 0 — the F2 failover-stopping class walking back in
one decoder layer down. The wave-6 raw-JSON matrix covered only `0xnope`, a form hexutil
happens to reject; the forms it lenient-ACCEPTS were the blind spot.

## The fix: a canon gate at the bytes, before conversion

`ReportedHeader` gained an `UnmarshalJSON` that decodes the raw result through a bytes-level
wire shape: `number` and `timestamp` arrive as `*strictNumber` / `*strictTime` — wrapper types
whose `UnmarshalJSON` runs `checkCanonicalQuantity` on the UNTOUCHED JSON text of the field
and only then delegates to the hexutil decoder. The gate cannot live after the conversion: by
the time a `*hexutil.Big` exists, `""` has already become a plausible value. It runs BEFORE,
so nothing hexutil tolerates can reach it. A violation is an `UnmarshalJSON` error → the raw
`CallContext` fails → **the attempt fails → rotation**, the uniform posture of every gate in
the file. One wrapper per field, so the violation names the field it arrived in and each
field's gate is independently attackable (the mutation matrix does exactly that).

Presence semantics are untouched: an omitted or `null` field never reaches a wrapper
(encoding/json leaves the pointer nil), so wave-6's absence-surfaces-as-absence gates observe
exactly what they observed before — the wrapper judges only bytes that claim to BE a quantity.
`ReportedHeader`'s public field types are unchanged (`*hexutil.Big` / `*hexutil.Uint64`); the
fake seam still scripts post-decode VALUES, which is its designed layer, and no wave-6 fixture
or assertion was altered. A `null` RESULT still bypasses `UnmarshalJSON` entirely (json sets
the `*ReportedHeader` nil without invoking it) — the honest not-found discrimination is
byte-for-byte the wave-6 behavior, and its tests still pass unmodified.

### THE CANON, pinned (this is the wrapper's contract, stated in `checkCanonicalQuantity`'s doc)

A canonical JSON-RPC quantity is **exactly what the reference encoder emits**
(`hexutil.EncodeUint64` / `hexutil.EncodeBig` — the same pinned library that decodes): a JSON
string holding `0x` followed by one or more lowercase hex digits `[0-9a-f]`, the first digit
nonzero unless the whole digit string is exactly `0`. Canonical bytes round-trip decode∘encode
to themselves; nothing else does. Rejected BY NAME, in check order:

1. not a JSON string (bare number, object, array, boolean);
2. the empty string — THE finding: "empty — an empty quantity is a non-answer, not zero";
3. a string without the `0x` prefix;
4. `0x` with no digits (the spec: zero is `0x0`);
5. leading zero digits (the spec: the most compact representation);
6. any non-lowercase-hex byte after the prefix — uppercase decodes to the same value under
   hexutil, but a representation the reference encoder can never emit is not the protocol's
   answer, and acceptance leniency one layer below the gates is exactly how this class survives.

Every violation message carries the marker `not a canonical JSON-RPC quantity`, the field
name, the offending bytes, and the arm's reason: *"the response must answer the question asked
at the bytes level, so a non-answer is refused before a lenient decoder can turn it into a
plausible value."* The one compactness exception is pinned from the accepting side too: the
matrix's genesis subtest proves `0x0` decodes and serves (a gate that rejected it would break
genesis-height reads — over-tightening, the other face of the wave-6 lesson), and that a
REPORTED zero timestamp is a value like any other; only a non-answer is refused.

## The hash/parentHash audit (mandated), EXECUTED not just read

Run against the pinned v1.13.0 decode (`common.Hash` ← `hexutil.UnmarshalFixedJSON` →
`UnmarshalFixedText`), controller-side scratch program, output verbatim:

| form | result |
| --- | --- |
| `""` | err `hex string has length 0, want 64 for common.Hash` |
| `"0x"` | err `hex string has length 0, want 64 for common.Hash` |
| `"0x8a1f"` (truncated) | err `hex string has length 4, want 64` |
| 64 digits, no `0x` | err `hex string without 0x prefix` |
| `0x` + 64 UPPERCASE digits | **accepted**, decodes to the same 32 bytes |

**Verdict: no analogous leniency exists to gate.** Fixed-length hex is already exactly that —
every empty, truncated, unprefixed or odd-length form is a named decode error that fails the
attempt; no non-answer can become a hash VALUE. The one residue, accepted and documented in
code (`ReportedHeader.UnmarshalJSON` doc): mixed-case digits decode — which, unlike `""` → 0,
cannot mint a wrong value (the 32 decoded bytes are identical either way, and every downstream
comparison — reorg equality, EIP-1898 round-trip — uses the decoded value, re-emitted
lowercase by `Hex()`). The canon gate is therefore scoped to QUANTITIES, where leniency
manufactures values out of non-answers; DATA fields stay on the library's exact-length gate.
This is a deliberate asymmetry, disclosed, not an oversight.

## Both binding rotation regressions, cited (real Dial, real decode, full landing)

| property | test |
| --- | --- |
| **`"timestamp":""` fails the attempt** (named: canon marker + `header response timestamp` + the empty arm's reason), no epoch value escapes, and with a healthy secondary present HeaderTime LANDS the honest endpoint's own timestamp — primary asked exactly once and rotated past | `TestRawJSONEmptyTimestampFailsTheAttemptAndTheSecondaryLandsHeaderTime` |
| **`"number":""` fails the attempt** (named likewise), no height-0 head escapes (token −1, zero Head), and with a healthy secondary HeadFrom lands the FULL head — `Head{Number, Time, Hash}` all equal the honest endpoint's crafted fields, token names index 1 — full landing, not merely primary-skipped | `TestRawJSONEmptyNumberFailsTheAttemptAndTheSecondaryLandsHeadFrom` |

Both drive the REAL stack — `Dial` → `rpc.Client` (HTTP) → `ReportedHeader.UnmarshalJSON` →
wrappers → gate — against crafted raw payloads; the recorded asks prove the malformed primary
was attempted once. These are the two tests in the +2 PASS delta.

## The malformed-quantity matrix (extending wave 6's single `0xnope`)

`TestRawJSONMalformedHexFailsTheAttemptAndRotates`, same top-level name, now 7 forms × 2
fields, each asserting: attempt fails, the CANON GATE owns the refusal (marker), the violation
names the field, and the arm's reason appears; plus the genesis `0x0` acceptance subtest and a
per-field rotation subtest (healthy secondary lands past a garbled `number` and a garbled
`timestamp`).

| form | vs the pinned hexutil | kill class |
| --- | --- | --- |
| `""` | **lenient-ACCEPTED as zero** — the finding | behavioral (gate off ⇒ value escapes) |
| `"0x5A"` | **lenient-ACCEPTED as the value** | behavioral (gate off ⇒ read SUCCEEDS — for `number` it even passes the wave-6 exact-height gate, 0x5A == 90 == asked) |
| `"0x"` | hexutil also rejects (ErrEmptyNumber) | canon-marker (name-level) |
| `"0x05a"` | hexutil also rejects (ErrLeadingZero) | canon-marker (name-level) |
| `"5a"` | hexutil also rejects (ErrMissingPrefix) | canon-marker (name-level) |
| `"0xnope"` | hexutil also rejects (ErrSyntax) | canon-marker (retained wave-6 form) |
| bare `90` | hexutil also rejects (errNonString) | canon-marker (name-level) |

Disclosed assertion change (the wave's one behavioral edit to an existing test): the wave-6
version asserted hexutil's `invalid hex` wording for `0xnope`; the gate now refuses those bytes
FIRST, so the assertion moved to the canon gate's owned violation name. The property — the
attempt fails, the garbage is named, rotation lands the healthy secondary — is unchanged, and
the ask-recording assertions are retained. No other wave-5/wave-6 test was touched in any way.

## Mutation matrix (committed applier, spec+transcript tied to tested SHA)

Run through `.superpowers/sdd/wave16-mutations/mutate.py` (exactly-one-occurrence per edit,
byte-level in-memory restores verified byte-identical) against `1e5f268` (code bytes ==
`93b7658`); spec committed before the loop, transcript after. `SOLVENT_LIVE_RPC_TESTS` unset
for every run (no endpoint hammering in loops; the raw-JSON servers are local httptest);
`TEST_DATABASE_URL` at `solvent_t9w1`. **6 mutants, 6 killed, 0 survived.** Every mutant lives
in the wave-7 canon gate — and the fake seam is STRUCTURALLY BLIND to all six by design (it
scripts post-decode values), so every kill came from the raw-JSON layer, which is itself the
proof that layer reaches the wrappers.

| # | mutant | result | killed by (headline) |
| --- | --- | --- | --- |
| W7M1 | the number wrapper skips the canon gate — `""` decodes as height 0 (the binding per-field empty arm) | KILLED, behavioral | `TestRawJSONEmptyNumberFails…` + all 7 number matrix arms |
| W7M2 | the timestamp wrapper skips the canon gate — `""` decodes as the epoch (the binding per-field empty arm) | KILLED, behavioral | `TestRawJSONEmptyTimestampFails…` + all 7 timestamp matrix arms |
| W7M3 | the shared empty-rejection arm deleted — `""` falls through to the prefix arm | KILLED, name-level (disclosed) | both binding tests + both `empty string` arms (the empty reason vanishes) |
| W7M4 | the lowercase arm relaxed — uppercase passes the canon | KILLED, behavioral | both `uppercase hex digits` arms (the reads SUCCEED under the mutant) |
| W7M5 | the leading-zero arm deleted — hexutil's ErrLeadingZero dominates | KILLED, name-level (disclosed) | both `leading zero digits` arms (canon marker gone) |
| W7M6 | the no-digits arm deleted — hexutil's ErrEmptyNumber dominates | KILLED, name-level (disclosed) | both `0x with no digits` arms (canon marker gone) |

Disclosed in the spec's design notes and restated here: **W7M3/W7M5/W7M6 are name-level
kills** — the bytes each arm rejects are still refused after the mutation (by the next canon
arm, or by hexutil one layer down), so rotation is identical and the observable is the
violation's NAME. That name is the property: a gate whose rejections silently devolve to the
library's own leniency profile is one library upgrade away from re-admitting the class —
`"" → 0` IS that library's current profile one form over. W7M5 subtlety, disclosed: hexutil's
own message happens to contain the words "leading zero digits", so that kill rides the canon-
marker assertion, not the reason assertion. **W7M1/W7M2 (the brief's binding pair) and W7M4
are behavioral**: under each, a read that must fail SUCCEEDS with a manufactured or
non-canonical value. Per-field isolation is visible in the transcript: W7M1's kill list is
purely number-side, W7M2's purely timestamp-side.

## Verification bar

- `go build ./...`, `go vet ./...` — clean at the final code bytes.
- gofmt: working-tree copies of all five chain Go files checked via CR-stripped temp files —
  all formatted; COMMITTED BLOBS at `93b7658` verified via `git cat-file -p` → temp file →
  `gofmt -l` empty for both touched files (never `/dev/stdin`, never `git show > file`), and
  the blobs verified to contain ZERO CR bytes (`tr -dc '\r' | wc -c` = 0 — the definitive
  check; an earlier `od | grep` false-positived and was discarded).
- Full suite: baseline **622/0/0** at `e3a2150`; final **624/0/0** at `7fcb4f4` (code bytes ==
  `93b7658`) — **gate ON for both** (`SOLVENT_LIVE_RPC_TESTS=1`, live regression executed
  inside both counted suites), PASS-lists diffed both directions, +2, zero deletions.
- `-race` in `golang:1.24` via `host.docker.internal` (wave-3's exact command shape):
  `ok internal/prices 1.955s`, `ok internal/chain 1.088s`, exit 0, at the final code bytes.
- Environment discipline: the backfill daemon (DB `solvent`) was never stopped and nothing
  pointed at its DB — every run used `solvent_t9w1`. Pathspec staging throughout; in-memory
  mutation restores only (verified byte-identical to `1e5f268` by the applier); the loop ran
  against committed work; no repo file was edited after the loop (the transcript's tested SHA
  shares the final code bytes).
- Line endings: chain.go is a uniform-CRLF working copy (`file(1)`-verified after editing;
  the spec's `\r\n` patterns matched exactly once each, applier-asserted).
  chain_rawjson_test.go remains an LF working copy (will normalize to CRLF on next checkout,
  as wave 6 predicted for its siblings); committed blobs are LF for both.

## Unverified / honest limits, stated plainly

- **The canon is stricter than the written eth JSON-RPC spec on ONE axis: digit case.** The
  spec pins the prefix, the compactness rule and `0x0`-for-zero (all enforced here) but is
  silent on case; this canon rejects uppercase because the reference encoder cannot emit it
  and every geth-derived node encodes lowercase. This is deliberate fail-closed posture, with
  a bounded blast radius — a hypothetical uppercase-emitting provider is treated as one more
  violating ENDPOINT (named violation, rotation past it), never a wrong value — and the
  gate-ON live regression passing against a real OP endpoint in both counted suites is the
  empirical check that real providers speak the canon. If Codex judges this over-tightened,
  the uppercase arm is one line plus two matrix rows to relax; the empty/compactness/prefix
  arms do not depend on it.
- **The hash mixed-case residue is accepted, not gated** — the audit and its rationale are in
  the report body and the code docs; the asymmetry (quantities strict, fixed-length data on
  the library's exact-length gate) is deliberate and disclosed. The audit program itself is
  controller-side scratch evidence (its verbatim output is tabled above); it is NOT committed,
  since the repo's committed proof layer for decode behavior is the raw-JSON test fleet.
- **Hermetic realism, not live proof, for the malformed forms**: no real provider was observed
  emitting `""` — the matrix asserts what the decoder does with crafted bytes; the live
  regression remains the canonical-value proof for the happy path. HTTP is the one transport
  exercised hermetically; ws rides the same `rpc.Client` decode but is not separately driven
  (wave-6 limit, unchanged).
- **The canon gate guards `ReportedHeader`'s decode only** — the package's single raw-JSON
  decode path (header identity). The typed ethclient calls (`BlockNumber`, logs, calldata,
  EIP-1898 calls) consume go-ethereum's own decoded values per the wave-5 law; auditing THEIR
  quantity leniency was not in this wave's mandate and was not done.
- W7M3/W7M5/W7M6 are name-level kills and W7M5's kill rides the marker assertion — both
  disclosed above and in the committed spec, not discoveries a reviewer has to make.
- Stored OP cursor state and the daemon restart remain the controller's post-approval steps
  (unchanged from waves 5–6); nothing in this wave touches them.

Returns to Codex under D-006 — the round-6 finding class (representation-level leniency) is
closed at the bytes; the chain-reopen trend 1H1M → 1M → 1M now has nowhere below the bytes to
descend.
