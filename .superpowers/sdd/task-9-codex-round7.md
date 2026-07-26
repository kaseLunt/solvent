# Codex adversarial review — task 9 wave 7 (round 7, chain layer)

- **Target:** `93b7658` vs `e3a2150`
- **Verdict:** `needs-attention` — **NO-SHIP** (2 medium). **The wave-7 gate itself is
  sound** ("the new ReportedHeader gate appears sound") — the findings are the SAME class
  in paths the wave-7 brief scoped out.
- **Job:** `review-ms1toiek-df1jxc`; session `019f9e92-a078-7d13-863c-4876e9d72fc9`
- Anti-decoy passed; worktree pruned (sixth orphaned-broker occurrence, PID verified).

## Findings (verbatim)

### [medium] eth_blockNumber still accepts an empty quantity as height zero — `internal/chain/chain.go:527-534`
The embedded go-ethereum v1.13.0 BlockNumber implementation decodes directly into hexutil.Uint64, where `""` becomes zero without error. A malformed primary can therefore return an empty result; this closure records zero and reports success, preventing rotation. Walker.Step then sees a height below confirmations and can repeatedly make no progress despite a healthy secondary.
**Recommendation:** Override endpointClient.BlockNumber with a raw strict-quantity decode, or derive it from the strictly decoded latest header. Add a real-Dial regression proving an empty primary result fails and the secondary's height lands.

### [medium] eth_getLogs can still manufacture log index zero from an empty quantity — `internal/chain/chain.go:890-900`
FilterLogs decodes directly into types.Log. In pinned go-ethereum, `logIndex` uses *hexutil.Uint and `""` becomes a present zero without error. An otherwise valid log with an empty logIndex therefore makes this attempt succeed and stops failover; downstream validation accepts index zero and persists it as the raw-log identity/order, potentially corrupting the source-of-truth row and derivation ordering.
**Recommendation:** Raw-decode mined log metadata through presence-tracked strict wrappers for consumed quantity fields, especially blockNumber and logIndex, before converting to types.Log. Add a real-Dial malformed-primary regression proving rotation and healthy-secondary landing.

## Controller adjudication

**Both ACCEPTED — and the scope-narrowing was the CONTROLLER'S briefing error.** Wave 7's
brief applied "the response must answer the question asked" to two ReportedHeader fields
plus a hash audit; the rule's own logic demanded every quantity the package consumes from
the wire. Codex reviewed the rule as stated and found where it wasn't applied — the
close-the-class lesson pointed back at the briefs themselves.

Fix wave: `task-9-wave8-brief.md` — the PACKAGE-WIDE sweep: inventory EVERY field decoded
from an RPC response in `internal/chain` (BlockNumber, log metadata, chainId, transaction
paths, anything else), each one strict-gated or explicitly justified-opaque in a sweep
table; the two named fixes; real-Dial rotation regressions for both. Chain-reopen trend:
1H1M → 1M → 1M → 2M — numerically wider but the same single class propagating outward;
the sweep table is what makes the next round decidable.
