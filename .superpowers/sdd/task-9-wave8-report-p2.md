# Task 9 — wave 8 report: the canon applies to the whole package

Brief: `task-9-wave8-brief.md` (round-7 fix wave, F1+F2 [medium] ACCEPTED; the adjudication
owns the scope-narrowing as a briefing error — the rule was right, its application was two
fields short of the package). Base: start commit `f9347f7` (control-plane tip; code bytes
identical to wave-7's `93b7658` for `internal/`). Branch `main`, serial tree. CLOSED law
respected and EXTENDED, not redesigned: `checkCanonicalQuantity`'s six arms are byte-for-byte
untouched; the wire-shape pattern (per-field strict wrappers under a presence-tracked decode)
is applied to the package's remaining decode paths exactly as wave 7 applied it to
`ReportedHeader`. The one closed-law-adjacent edit, disclosed: the violation message's
`"header response "` prefix moved out of `checkCanonicalQuantity`'s format string and into the
caller-supplied field name (`"header response number"` etc.), so the SAME function can name
`"eth_blockNumber response result"` and `"log response logIndex"` — the rendered bytes on
every pre-existing path are identical, and no wave-6/7 test assertion changed.

| commit | contents |
| --- | --- |
| `c7f74b0` | the package-wide sweep's gates: F1 (eth_blockNumber strict raw decode), F2 (the `reportedLog` wire shape + presence + null-window + zero-hash gates), eth_chainId, tx input, `checkCanonicalData`, + the raw-JSON fleet for all of them (chain.go, chain_rawjson_test.go — the only two code files touched all wave) |
| `f0a5560` | the sweep's question-answering pass on the tx path: `TransactionByHash` requires the reported hash present and EQUAL to the asked hash (+ wrong-tx/omitted-hash regressions) |
| `baca034` | mutation spec `.superpowers/sdd/t9w8-mutations/mutations.json` (12 mutants), committed BEFORE any loop ran |
| `29ac4ae` | spec extended with W8M13/W8M14 for the identity gate, committed before the definitive loop |
| `af0dc65` | `t9w8-mutations/transcript.md`, **14/14 killed**, tested SHA `29ac4ae` (code bytes identical to `f0a5560` — the delta is `.superpowers/sdd/**` only) |
| (this report's commit) | `task-9-wave8-report-p2.md` |

## Test counts (top-level `^--- PASS` convention: `go test -v -count=1 ./...` through `grep -c '^--- PASS'`, subtests not counted)

- **Baseline at `f9347f7`: 624 PASS / 0 FAIL / 0 SKIP**, exit 0, measured clean before any
  edit — `TEST_DATABASE_URL` at `solvent_t9w1` AND **`SOLVENT_LIVE_RPC_TESTS=1` (gate ON)**;
  the live regression ran inside the counted baseline
  (`TestLiveOPIncidentBlockHashIsTheReportedCanonicalHash`, 0.63s — executed, not skipped).
  Matches wave-7's final count exactly.
- **Final (tree at `af0dc65`, code bytes == `f0a5560`): 632 PASS / 0 FAIL / 0 SKIP**,
  exit 0, same convention, same DB, **gate ON again** (live regression executed, 0.53s) —
  identical posture both runs; zero SKIP is literal on both.
- Delta +8, PASS-lists diffed BOTH directions on test names: zero deletions, zero renames.
  The eight, all top-level tests in `chain_rawjson_test.go`:
  `TestRawJSONEmptyBlockNumberFailsTheAttemptAndTheSecondaryLandsHeight` (F1 binding),
  `TestRawJSONBlockNumberMatrixFailsEveryNonCanonicalForm`,
  `TestRawJSONEmptyLogIndexFailsTheAttemptAndTheSecondaryLandsTheWindow` (F2 binding),
  `TestRawJSONLogQuantityAndDataMatrixFailsEveryNonCanonicalForm`,
  `TestRawJSONLogPresenceAndNullWindowAreProtocolViolations`,
  `TestRawJSONChainIDStrictQuantity`,
  `TestRawJSONEmptyTxInputFailsTheAttemptAndTheSecondaryLandsCalldata`,
  `TestRawJSONWrongTransactionAnsweredIsAViolationThatRotates`.
- Scope: `git diff --name-only f9347f7 af0dc65` is exactly `internal/chain/chain.go`,
  `internal/chain/chain_rawjson_test.go`, and the two `.superpowers/sdd/t9w8-mutations/`
  files. Nothing else changed in any commit; `internal/ingest`, `internal/prices` and every
  other package needed ZERO changes and got zero.

## THE SWEEP TABLE — every field `internal/chain` decodes from an RPC response

The package's entire wire surface is the `rpcClient` interface (seven methods) plus the
JSON-RPC envelope itself; `Dial` performs no decode. Since this wave, FIVE of the seven
methods decode raw on `endpointClient` (only the two opaque-envelope `eth_call` forms remain
typed, per the brief). Every row is either STRICT-GATED (gate + test cited) or
JUSTIFIED-OPAQUE (with the why-leniency-cannot-mint-a-wrong-value argument, audit-executed
where it rests on library behavior — the executed audit is tabled in the next section).

| # | wire path / field | decode path | status |
| --- | --- | --- | --- |
| 1 | `eth_getBlockByNumber` → `hash` | raw → `ReportedHeader.UnmarshalJSON` → `*common.Hash` | **STRICT-GATED** (waves 5–7, unchanged): presence (`validateReportedHeader`; `TestRawJSONMissingRequiredFieldsAreProtocolViolationsThatRotate`), zero-hash refusal (wave 5), library exact-length gate underneath (audit rows: `""`, `"0x"`, truncated, unprefixed → named errors). Residue: mixed-case digits decode — cannot mint a wrong value (identical 32 bytes; all comparisons on decoded values) — wave-7 disclosure, re-executed |
| 2 | `eth_getBlockByNumber` → `parentHash` | same | **STRICT-GATED** — identical to row 1 |
| 3 | `eth_getBlockByNumber` → `number` | raw → `strictNumber` → `checkCanonicalQuantity` | **STRICT-GATED** (wave 7): canon + presence + uint64 + exact-height equality on numbered reads (wave 6). Tests: `TestRawJSONMalformedHexFailsTheAttemptAndRotates`, `TestRawJSONEmptyNumberFailsTheAttemptAndTheSecondaryLandsHeadFrom`, `TestRawJSONWellFormedWrongHeightResponseIsAViolationThatRotates` |
| 4 | `eth_getBlockByNumber` → `timestamp` | raw → `strictTime` → `checkCanonicalQuantity` | **STRICT-GATED** (wave 7): `TestRawJSONEmptyTimestampFailsTheAttemptAndTheSecondaryLandsHeaderTime` + matrix |
| 5 | `eth_getBlockByNumber` → every other response field | NOT DECODED — the wire struct reads four fields | **JUSTIFIED-OPAQUE**: an unread field cannot mint a value (the wave-5 principle: fields the vendored geth cannot represent are ignored, never re-hashed) |
| 6 | `eth_getBlockByNumber` → `null` result | `*ReportedHeader` stays nil | **STRICT-GATED** as honest not-found discrimination: `TestRawJSONNullResultIsAnHonestNotFoundNotAViolation` — not-found is NOT a violation, and never a zero header |
| 7 | `eth_blockNumber` → result | **NEW**: raw → `checkCanonicalQuantity` → `hexutil.Uint64` (`endpointClient.BlockNumber`) | **STRICT-GATED THIS WAVE (F1)**: `TestRawJSONEmptyBlockNumberFailsTheAttemptAndTheSecondaryLandsHeight` (binding), `TestRawJSONBlockNumberMatrixFailsEveryNonCanonicalForm` (7 forms + null refusal + `0x0` acceptance). Killed mutant: W8M1 |
| 8 | `eth_chainId` → result | **NEW**: raw → `checkCanonicalQuantity` → `hexutil.Big` (`endpointClient.ChainID`) | **STRICT-GATED THIS WAVE**: `TestRawJSONChainIDStrictQuantity` (7 forms; the want-zero arm proves the refusal does not rely on `VerifyChainID`'s equality; acceptance + unchanged mismatch wording). Consumer: `cmd/indexer` startup (`VerifyChainID`, every endpoint, no rotation by design). Killed mutant: W8M10 |
| 9 | `eth_getLogs` → `null` result | **NEW**: raw null check before decode (`endpointClient.FilterLogs`) | **STRICT-GATED THIS WAVE**: null cannot impersonate the honest empty window `[]` (the typed path decoded null as zero logs, audit-executed). Test: `TestRawJSONLogPresenceAndNullWindowAreProtocolViolations/a_null_result…` (+ rotation to a `[]`-serving secondary). Killed mutant: W8M7 |
| 10 | `eth_getLogs` → `address` | **NEW**: `reportedLog` → `*common.Address` | presence **STRICT-GATED** (omission test); value on the library's 20-byte exact-length gate (audit: `""`/truncated → named errors). Residue **JUSTIFIED**: mixed-case decodes to identical 20 bytes; the walker's address-set membership and persistence use the decoded value (`walker.go:231`, tested `walker_test.go:296`) |
| 11 | `eth_getLogs` → `topics` | **NEW**: `[]common.Hash`, presence-checked | presence **STRICT-GATED** (nil refused; `[]` accepted — the LOG0 acceptance test guards over-tightening); each entry on the library's 32-byte gate (audit); case residue as row 10 |
| 12 | `eth_getLogs` → `data` | **NEW**: `strictLogData` → `checkCanonicalData` | **STRICT-GATED THIS WAVE**: `""` → empty payload is a MINT (hexutil.Bytes leniency, audit-executed) and log data is PERSISTED source of truth. Tests: data matrix arms + `"0x"` acceptance. Killed mutants: W8M5 (application), W8M6 (empty arm) |
| 13 | `eth_getLogs` → `blockNumber` | **NEW**: `strictLogNumber` → `checkCanonicalQuantity` + presence | **STRICT-GATED THIS WAVE**: matrix arms + omission test (`""` → present 0 AND omission → 0 were both real, audit-executed). Window membership additionally enforced at the consumer (`walker.go:227`, tested `walker_test.go:280`) — a same-repo tested gate, not a lenient library. Killed mutants: W8M3, W8M9 |
| 14 | `eth_getLogs` → `transactionHash` | **NEW**: `*common.Hash` + presence + zero-hash refusal | **STRICT-GATED THIS WAVE**: omission + zero-hash tests (the library happily decodes 64 zero digits, audit-executed; a zero tx hash is an unverifiable log identity — the wave-5 posture) |
| 15 | `eth_getLogs` → `transactionIndex` | **NEW**: `strictLogTxIndex` → `checkCanonicalQuantity` + presence | **STRICT-GATED THIS WAVE**: consumed via the walker's `reflect.DeepEqual` duplicate-conflict comparison, so a minted zero would alter dedup verdicts; gated uniformly rather than argued around. Matrix + omission tests. Killed mutant: W8M4 |
| 16 | `eth_getLogs` → `blockHash` | **NEW**: `*common.Hash` + presence + zero-hash refusal | **STRICT-GATED THIS WAVE**: an omitted blockHash silently became the ZERO HASH under the pinned decoder (audit-executed) and is persisted as the raw-log fork identity (rewind verification depends on it). Omission + zero-hash tests |
| 17 | `eth_getLogs` → `logIndex` | **NEW**: `strictLogIndex` → `checkCanonicalQuantity` + presence | **STRICT-GATED THIS WAVE (F2)**: `TestRawJSONEmptyLogIndexFailsTheAttemptAndTheSecondaryLandsTheWindow` (binding), matrix arms, omission test, index-0 acceptance. Killed mutants: W8M2, W8M8 |
| 18 | `eth_getLogs` → `removed` | **NEW**: `*bool`, optional | **JUSTIFIED-OPAQUE**: the ONE optional log field. Absence decodes false — the only honest value a mined-range query carries (removal markers belong to filter-change notifications); a present `true` is refused by the consumer (`walker.go:225`, tested `walker_test.go:265`); a present non-bool is an encoding/json TYPE ERROR that fails the attempt (audit-executed: `"removed":""` → error). No lenient path mints a wrong consumed value. Acceptance test: omitted `removed` → false |
| 19 | `eth_getTransactionByHash` → `null` result | **NEW**: raw null → `ethereum.NotFound` | **STRICT-GATED** as honest not-found (mirrors the pinned ethclient; test: the null subtest asserts "not found" and NOT "protocol violation") |
| 20 | `eth_getTransactionByHash` → `hash` (reported) | **NEW**: probe `*common.Hash`, presence + EQUALITY with the asked hash | **STRICT-GATED THIS WAVE**: the wave-6 question-answering rule on the tx path — reported-vs-asked, NO local recomputation (`types.Transaction.Hash()` re-derives from decoded fields, the exact class wave 5 retired for headers). Tests: `TestRawJSONWrongTransactionAnsweredIsAViolationThatRotates` (proxy alone + rotation landing + omitted hash). Killed mutants: W8M13, W8M14 |
| 21 | `eth_getTransactionByHash` → `input` | **NEW**: `strictTxInput` → `checkCanonicalData` + presence | **STRICT-GATED THIS WAVE**: the ONE field `TxCalldata` consumes; `""` → empty calldata is a mint (audit-executed) that would seed the migration-genesis deriver with nothing. Tests: `TestRawJSONEmptyTxInputFailsTheAttemptAndTheSecondaryLandsCalldata` (binding-style: named violation, rotation, landing; uppercase; omission; `"0x"` acceptance). Killed mutants: W8M11, W8M12 |
| 22 | `eth_getTransactionByHash` → `v`/`r`/`s` | pinned `types.Transaction` decode; `r == nil` refusal mirrored from ethclient verbatim | **JUSTIFIED-OPAQUE**: consumed only as a signature-PRESENCE check; the values never escape this package (`TxCalldata` returns `Data()` alone). A `""` there decodes as big-int zero (the leniency class), but a zero r/s/v mints nothing any consumer reads |
| 23 | `eth_getTransactionByHash` → every other envelope field (`nonce`, `gas`, `gasPrice`, `value`, `to`, `type`, fee caps, access list, mined coordinates) | pinned `types.Transaction` decode (its own required-field list) + probe `blockNumber` presence for the pending bool | **JUSTIFIED-OPAQUE**: decoded but UNCONSUMED through this path — `tx.Data()` is the only escape, and the pending bool is returned but read by no caller. Audit-executed leniencies tabled for the record (`gas:""` → 0, `value:""` → 0): a minted zero in an unread field cannot become a wrong value downstream |
| 24 | `eth_call` → result (`CallContract` behind `Call`/`CallWithToken`/`CallFrom`/`CallAtFrom`) | typed `hexutil.Bytes` (ethclient) | **JUSTIFIED-OPAQUE** (per the brief, opaque bytes): the envelope is handed to the caller VERBATIM, uninterpreted — this package mints no value from it. The audit-executed leniencies are `""` → empty (byte-identical to the canonical empty answer `"0x"`) and uppercase (identical bytes): neither can produce bytes that differ from the canonical encoding of SOME honest answer. The residual `""`-vs-`"0x"` ambiguity is bounded: reverts arrive as RPC ERRORS (not results), and the consumers' ABI decoders structurally refuse empty/short blobs for the multicall3 shapes consumed (the prices round decode; the snapshotter). For pinned calls the execution-block echo inside the multicall3 payload is the caller's documented check (`CallAtFrom` doc) |
| 25 | `eth_call` (EIP-1898 object) → result (`CallContractAtHash` behind `CallAtHashFrom`) | typed `hexutil.Bytes` (ethclient) | **JUSTIFIED-OPAQUE**: identical argument to row 24; rejection classes ("block not found") surface as errors and are retained per-attempt in `PinnedCallError` (wave 4) |
| 26 | JSON-RPC envelope (`jsonrpc`, `id`, `error{code,message,data}`, `result` framing) — all paths | `rpc.Client` (pinned) | **JUSTIFIED-OPAQUE**: transport framing. A malformed envelope is a transport error that fails the attempt; `error` objects surface as opaque Go error VALUES (the prices layer classifies by message text, never by decoding envelope numbers into data); no envelope field flows into any persisted or derived value. ws rides the same decode but is not separately driven (wave-6 limit, carried) |

**What makes round 8 decidable:** rows 7, 8, 9, 12, 13, 15, 16, 17, 20, 21 are the wave-8
gates (each with a killed mutant); rows 1–6 are the wave-5/6/7 closed law; rows 5, 18, 22,
23, 24, 25, 26 are the complete set of surviving JUSTIFIED-OPAQUE claims — each argued above
from executed library behavior plus a named consumer-side structural refusal, never from
"providers wouldn't do that".

## The executed leniency audit (the evidence layer under the table)

Controller-side scratch program against the pinned go-ethereum v1.13.0 decode paths
(NOT committed — the repo's committed proof layer for decode behavior is the raw-JSON test
fleet, same as wave 7's hash audit). Output verbatim, abridged only by grouping:

| decode | form | result |
| --- | --- | --- |
| `hexutil.Uint64` (blockNumber) | `""` | **err=nil val=0** — F1, the finding |
| `hexutil.Uint64` | `"0x5A"` | **err=nil val=90** (uppercase accepted) |
| `hexutil.Uint64` | `"0x"` / `"0x05a"` / `"5a"` / bare `90` | named errors (library strictness overlaps the canon; the gate still owns the refusal) |
| `hexutil.Uint` (logIndex/txIndex) | `""` | **err=nil val=0** — F2, the finding |
| `hexutil.Big` (chainId) | `""` | **err=nil val=0** |
| `hexutil.Bytes` (data/input/call result) | `""` | **err=nil, empty** — the data-canon finding |
| `hexutil.Bytes` | `"0x"` | err=nil, empty (the CANONICAL empty — accepted by the gate) |
| `hexutil.Bytes` | `"0xAB"` | **err=nil val=0xab** (uppercase accepted) |
| `hexutil.Bytes` | `"0xabc"` / `"ab"` / bare `12` | named errors |
| `common.Hash` | `""` / `"0x"` / truncated / unprefixed | named errors (exact-length gate) — no non-answer can become a hash value |
| `common.Hash` | 64 UPPERCASE digits | accepted, identical 32 bytes (the wave-7 residue, unchanged) |
| `common.Hash` | 64 ZERO digits | **accepted** — why the zero-hash refusals exist in `validateReportedLog` |
| `common.Address` | `""` / truncated | named errors; mixed/uppercase accepted, identical 20 bytes |
| `types.Log` end-to-end | `"logIndex":""` | **err=nil, Index=0 PRESENT** — the F2 finding through the full pinned decoder |
| `types.Log` | `"blockNumber":""` / `"transactionIndex":""` / `"data":""` | err=nil, minted 0 / 0 / empty |
| `types.Log` | omitted `logIndex`/`blockNumber`/`blockHash`/`transactionIndex` | **err=nil, silent zeros** (incl. zero blockHash) — why the wire shape is presence-tracked |
| `types.Log` | omitted `address`/`topics`/`data`/`transactionHash` | library required-field errors (still re-gated by `validateReportedLog` so the refusal is owned, not inherited) |
| `types.Log` | `"removed":""` | **type error** (bool strictness) — the row-18 justification's library leg |
| `types.Log` | omitted `removed` / `topics:[]` | err=nil, false / empty — the accepted absences |
| `[]types.Log` | `null` result | **err=nil, zero logs** — null impersonates the empty window; why the null gate exists |
| `types.Transaction` | `"input":""` | **err=nil, `Data()` empty** — the tx-input finding |
| `types.Transaction` | omitted `input` | library required-field error (re-gated; W8M12 pins ownership) |
| `types.Transaction` | `"input":"0xCFC32570"` | err=nil, decodes (uppercase accepted) |
| `types.Transaction` | `"gas":""` / `"value":""` | err=nil, minted 0 — unconsumed (row 23) |

## F1 — eth_blockNumber (`endpointClient.BlockNumber`)

The strict-raw-decode form was chosen over Codex's derive-from-latest-header alternative,
and the justification is on the record in the method doc: the raw decode keeps the QUESTION
on the wire unchanged — `eth_blockNumber` stays `eth_blockNumber` (the recorded-ask
regression pins the primary was asked exactly once) — where deriving from the latest header
would change it to `eth_getBlockByNumber("latest")`, coupling the walker's cheap head probe
to full-header availability and silently conflating two provider surfaces the failover
measures separately. One-fetch-path uniformity is the right argument for header IDENTITY
reads (wave 5); a height probe asks a different question, and the gate belongs on the answer
to the question actually asked. Bonus closed by the same gate: a `null` result — which the
ungated typed decode ALSO left as height 0 — is refused as a non-answer.

| property | test |
| --- | --- |
| `""` fails the attempt by name (canon marker + `eth_blockNumber response result` + the empty arm's reason), no height-0 escapes, and with a healthy secondary the height LANDS (150) — primary asked exactly once and rotated past | `TestRawJSONEmptyBlockNumberFailsTheAttemptAndTheSecondaryLandsHeight` |
| all 7 canon forms refused by name; `0x0` serves (genesis guard); `null` refused | `TestRawJSONBlockNumberMatrixFailsEveryNonCanonicalForm` |

## F2 — mined-log metadata (`endpointClient.FilterLogs` → `reportedLog`)

The raw result decodes through the presence-tracked wire shape BEFORE conversion to
`types.Log`: per-field strict wrappers for `blockNumber`/`logIndex`/`transactionIndex`
(inventory decided all three: the first two are the persisted raw-log identity/order, the
third feeds the walker's duplicate-conflict comparison), the data canon for `data`, presence
for all eight mined-log fields (`removed` optional, argued in row 18), zero-hash refusals for
both hash identities, and the null-window gate. The wire REQUEST is unchanged — `filterArg`
mirrors the pinned `toFilterArg` verbatim. Violation = failed attempt = rotation, uniformly.

| property | test |
| --- | --- |
| `"logIndex":""` fails the attempt by name, no index-zero log escapes, and with a healthy secondary the FULL window LANDS (every field of the converted `types.Log` equals the honest endpoint's crafted values) — primary asked exactly once | `TestRawJSONEmptyLogIndexFailsTheAttemptAndTheSecondaryLandsTheWindow` |
| 3 quantity fields × 7 forms + data × 6 forms refused by name; index/height/txIndex 0 and `"0x"` data serve | `TestRawJSONLogQuantityAndDataMatrixFailsEveryNonCanonicalForm` |
| 8 omissions named; `removed` absence accepted; `topics:[]` accepted; zero blockHash/txHash refused; null refused + rotation lands the honest `[]` | `TestRawJSONLogPresenceAndNullWindowAreProtocolViolations` |

## Mutation matrix (committed applier, spec+transcript tied to tested SHA)

Run through `.superpowers/sdd/wave16-mutations/mutate.py` (exactly-one-occurrence per edit,
byte-level in-memory restores verified byte-identical) against `29ac4ae` (code bytes ==
`f0a5560`); spec committed before each loop, transcript after. `SOLVENT_LIVE_RPC_TESTS`
unset for every run; `TEST_DATABASE_URL` at `solvent_t9w1`. **14 mutants, 14 killed, 0
survived.** The fake seam is structurally blind to all fourteen (it scripts post-decode
values), so every kill came from the raw-JSON layer. A 12-mutant run of the identical spec
entries also went 12/12 at `baca034` before the identity gate landed; the committed
transcript is the definitive 14-mutant run.

| # | mutant (each = one new gate arm) | kill class | isolation (kill list is purely this path) |
| --- | --- | --- | --- |
| W8M1 | eth_blockNumber skips the canon | **behavioral** (`""`/null succeed as height 0) | blockNumber tests only |
| W8M2 | logIndex wrapper skips the canon (F2 binding) | **behavioral** (present index 0 escapes) | logIndex tests only |
| W8M3 | log blockNumber wrapper skips the canon | behavioral/name mixed per form | log blockNumber arms only |
| W8M4 | transactionIndex wrapper skips the canon | behavioral/name mixed per form | transactionIndex arms only |
| W8M5 | log data skips the data canon | **behavioral** (`""`/uppercase reads succeed) | data arms only |
| W8M6 | data canon's empty arm deleted | **name-level, disclosed** (`""` falls to the prefix arm; rotation identical) | the two data-canon call sites (log data + tx input) — the shared-arm span is itself the disclosure |
| W8M7 | null-window gate deleted | **behavioral** (null serves as an empty window) | the null subtest only |
| W8M8 | logIndex presence devolves to zero (2 edits — the pinned decoder's own absence leniency, restored faithfully) | **behavioral** | omitted-logIndex subtest only |
| W8M9 | log blockNumber presence devolves to zero (2 edits) | **behavioral** | omitted-blockNumber subtest only |
| W8M10 | eth_chainId skips the canon | **behavioral via the want-zero arm** (`VerifyChainID(0)` PASSES under the mutant) | chainId tests only |
| W8M11 | tx input skips the data canon | **behavioral** (empty calldata escapes) | tx-input test only |
| W8M12 | tx input presence deleted | **name-level, disclosed** (devolves to the library's required-field list) | omitted-input subtest only |
| W8M13 | tx answered-identity gate deleted | **behavioral** (a wrong transaction's calldata escapes) | wrong-transaction test only |
| W8M14 | tx hash presence devolves to a skipped check (2 edits) | **behavioral** | wrong-transaction test only |

## Verification bar

- `go build ./...`, `go vet ./...` — clean at the final code bytes.
- gofmt: working-tree copies of both touched files via CR-stripped temp files — formatted;
  COMMITTED BLOBS at `f0a5560` verified via `git cat-file -p` → temp file → `gofmt -l` empty
  (never `/dev/stdin`, never `git show > file`), blobs contain ZERO CR bytes
  (`tr -dc '\r' | wc -c` = 0 for both).
- Full suite: baseline **624/0/0** at `f9347f7`; final **632/0/0** at `af0dc65` (code
  bytes == `f0a5560`) — **gate ON for both** (`SOLVENT_LIVE_RPC_TESTS=1`, live regression
  executed inside both counted suites: 0.63s baseline, 0.53s final), PASS-lists diffed both
  directions, +8, zero deletions.
- `-race` in `golang:1.24` via `host.docker.internal` (DB `solvent_t9w1`):
  `ok internal/prices 1.980s`, `ok internal/chain 1.145s`, exit 0, at the final code bytes.
- Environment discipline: the backfill daemon (DB `solvent`) was never stopped and nothing
  pointed at its DB — every run used `solvent_t9w1`. Pathspec staging throughout; in-memory
  mutation restores only (applier-verified byte-identical, `git status --porcelain` empty
  over mutated files after both loops); loops ran against committed work; no code file was
  edited after the definitive loop (the transcript's tested SHA shares the final code bytes).
- Line endings: chain.go remains a uniform-CRLF working copy (CR count == line count,
  re-verified after every edit); chain_rawjson_test.go remains LF (normalizes on next
  checkout, as wave 6 predicted); committed blobs are LF for both.

## Unverified / honest limits, stated plainly

- **The data canon carries the wave-7 case-strictness to payloads**: uppercase hex in log
  `data` / tx `input` is refused although it decodes to identical bytes. Same fail-closed
  argument and same bounded blast radius as wave 7 (a violating ENDPOINT rotates; no wrong
  value), same one-line relaxation if Codex judges it over-tightened. The `"0X"` prefix form
  is refused by the prefix arm on both canons (lowercase `0x` only), same posture.
- **The null-getLogs refusal is stricter than an imaginable provider**: geth-derived nodes
  answer empty ranges with `[]` (the typed client's own encoder never emits null results for
  logs), but no live provider was OBSERVED emitting null here — the claim rests on the
  audit + the hermetic fleet. Blast radius if wrong: a null-answering endpoint is rotated
  past (named violation), never a wrong value; the `[]` acceptance test pins that honest
  empties still serve.
- **Hermetic realism, not live proof, for every malformed form** (wave-6/7 limit, carried):
  no real provider was observed emitting `""`/null/wrong-tx shapes; the matrix asserts what
  the decoder does with crafted bytes. The gate-ON live regression pins the happy path for
  header identity ONLY — `BlockNumber`, `Logs`, `ChainID`, `TxCalldata` have no live pinned
  regression (they ride the same `Dial` stack; their happy paths are covered hermetically by
  the crafted-canonical fixtures, including a full `types.Transaction` round-trip through the
  pinned encoder).
- **`TransactionByHash` no longer installs the ethclient sender cache**
  (`setSenderFromServer`) — disclosed in the method doc; `TxCalldata` (the only consumer)
  never reads the sender, and a hypothetical `Sender()` call falls back to signature
  recovery. The signature nil-check and null→NotFound mirror ethclient verbatim.
- **The tx identity gate compares REPORTED hash to asked hash** — it does not prove the
  returned fields belong to that hash (that would require local tx-hash recomputation, the
  wave-5 retired class; a provider lying consistently about the hash field is the same trust
  class every read carries). The gate closes the wrong-QUESTION shape, not provider forgery.
- **W8M6 and W8M12 are name-level kills** (disclosed in the committed spec's design notes and
  the matrix above); every other kill is behavioral on at least one asserted leg.
- **ws transport** rides the same `rpc.Client` decode but is not separately driven (wave-6
  limit, unchanged).
- Stored cursor state and the daemon restart remain the controller's post-approval steps;
  nothing in this wave touches them.

Returns to Codex under D-006 — the round-7 class (the canon stopping at the header) is closed
at package scope: every wire-decoded field is now in the table above, strict-gated with a
killed mutant or justified from executed library behavior plus a tested consumer refusal. The
chain-reopen trend 1H1M → 1M → 1M → 2M has nowhere left in this package to propagate: the
sweep table is the closing argument.
