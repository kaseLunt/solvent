# Codex adversarial review — task 9 wave 5 (round 5, chain layer)

- **Target:** `ce21cd3` vs `1e3941c`
- **Verdict:** `needs-attention` — **NO-SHIP** (1 high, 1 medium)
- **Job:** `review-ms1qlj40-33f6dj`; session `019f9e43-9c7f-7af1-8d1a-13cdc01cf028`
- Anti-decoy passed (transcript + independent source spot-check of both findings);
  worktree pruned (fourth orphaned-broker occurrence, PID verified before kill; the
  reviewer also disclosed and self-cleaned a backslash-mangled worktree path and a stray
  0-byte artifact — mechanics held).

## Findings (verbatim)

### [high] Fixed-height reads accept a header for the wrong block — `internal/chain/chain.go:90-100`
validateReportedHeader only checks that Number fits uint64; HeaderHash, HeaderHashFrom, and HeaderTime never require it to equal the requested height. A buggy proxy returning `latest` for every numeric request is therefore treated as successful. HeaderTime can date an old cursor using the current head and report false-green freshness; walker reorg checks can compare cursor N against head M, spuriously rewind through all stored logs, and potentially trigger a full rewalk instead of rotating to a healthy endpoint. The new tests and mutations always return the requested number, so they cannot detect this.
**Recommendation:** Pass the expected height into validation and require exact equality for every numbered read. Add regressions proving a mismatched response rotates to the next endpoint and cannot influence walker ancestry or HeaderTime.

### [medium] Missing timestamps now bypass the protocol gate — `internal/chain/chain.go:75-99`
Time is a non-pointer value, so an omitted `timestamp` decodes as zero and validateReportedHeader accepts it. The previous types.Header decoder rejected a missing timestamp as a required-field error. A malformed primary endpoint can now make HeaderTime return Unix epoch and HeadFrom report an epoch-aged head; failover stops instead of reaching a healthy secondary, causing false stale readiness/feed-health verdicts. This contradicts the report's claim that HeaderTime only gained stricter refusal behavior.
**Recommendation:** Decode timestamp with presence tracking, reject absent timestamps before marking the attempt successful, and add hermetic raw-JSON adapter tests covering missing fields, null results, malformed hex, and rotation.

## Controller adjudication

**Both ACCEPTED.** Fix wave: `task-9-wave6-brief.md`.

The class: swapping a strict decoder (types.Header required-field errors) for a minimal
one silently DROPPED two protocol gates. The reported-hash principle survives untouched —
what round 5 caught is that "trust the provider's reported fields" must be paired with
"verify the response answers the question asked" (right height, required fields present).
A response failing either is a PROTOCOL VIOLATION → failed attempt → rotation, exactly
like the zero-hash refusal. The blind-spot lesson repeats: fakes that always answer
correctly cannot test the decoder — hermetic raw-JSON tests below the fake seam are the
missing fixture layer.
