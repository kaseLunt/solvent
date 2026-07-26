# Codex adversarial review — task 9 wave 6 (round 6, chain layer)

- **Target:** `15a4e11` vs `8352af0`
- **Verdict:** `needs-attention` — **NO-SHIP** (1 medium)
- **Job:** `review-ms1s7mk3-fffqvi`; session `019f9e6c-fa9b-7eb3-b493-8e8428b6a60a`
- Anti-decoy passed; worktree pruned (fifth orphaned-broker occurrence, PID verified).
- Codex sandbox again could not execute Go tests (read-only temp dir) — structural review;
  controller executions carry the run evidence.

## Finding (verbatim)

### [medium] Empty JSON quantities bypass the required-field gate — `internal/chain/chain.go:84-88`
ReportedHeader uses *hexutil.Big and *hexutil.Uint64. In the pinned go-ethereum v1.13.0, both decoders accept an empty JSON string and decode it as zero. Consequently, a primary returning `"timestamp":""` produces a non-nil Time, passes validateReportedHeader, and makes HeaderTime/HeadFrom return Unix epoch instead of rotating to a healthy secondary—the exact F2 failure class. `"number":""` likewise passes HeadFrom as height zero. The raw-JSON malformed test only covers `0xnope`, so the claimed real-decode coverage misses this path.
**Recommendation:** Decode number and timestamp through strict raw/string wrappers that reject empty and non-canonical JSON quantities before converting to hexutil values. Add real-Dial tests where `timestamp:""` and `number:""` fail the attempt and the healthy secondary demonstrably lands HeaderTime and HeadFrom.

## Controller adjudication

**ACCEPTED.** Fix wave: `task-9-wave7-brief.md` (surgical).

The class is the round-5 lesson one decoder-layer deeper: presence tracking moved the gate
to pointer-nil, but the LIBRARY's decode semantics define what becomes non-nil — and
v1.13.0's hexutil treats `""` as zero. "The response must answer the question asked" has
to hold at the BYTES level: a quantity that is not a canonical JSON quantity is a protocol
violation, regardless of what convenience decoders tolerate. Chain-reopen trend:
1H1M → 1M → 1M, each strictly narrower; the finding class has descended from semantics to
representation — expected to bottom out next round.
