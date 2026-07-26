# Codex adversarial review — task 9 wave 8 (round 8, chain layer)

- **Target:** `f0a5560` vs `f9347f7`
- **Verdict:** `needs-attention` — **NO-SHIP** (1 medium, single finding, anchored
  immediately adjacent to the new tx gate). The package sweep, both round-7 fixes, the
  sweep table's 26 rows, and the null-window discrimination all SURVIVED adversarial
  review — the class is closed except for this one edge.
- **Job:** `review-ms1vkhfp-nmd7zj`; session `019f9ec3-03cf-7ab1-9897-1f96cd219938`
- Anti-decoy passed; worktree pruned (seventh orphaned-broker occurrence, PID verified).

## Finding (verbatim)

### [medium] Reported hash equality does not authenticate the returned transaction body — `internal/chain/chain.go:720-730`
TransactionByHash compares the request only with the response's independently supplied `hash` field. The pinned `types.Transaction.UnmarshalJSON` ignores that JSON hash, and this code never compares `tx.Hash()` afterward. A faulty or dishonest primary can therefore echo the requested hash while returning another canonical transaction body or altered input; the gate succeeds, failover stops, and TxCalldata returns the substituted calldata. On the migration path, valid calldata with the same logged seed count can silently create incorrect borrower and debt genesis state. The existing regression tests only the opposite shape—wrong reported hash with the correct body—so it cannot detect this failure.
**Recommendation:** After decoding, require `tx.Hash() == hash` and treat a mismatch as a protocol violation so failover rotates. Add a real-Dial regression where the reported hash equals the request but the signed body/input belongs to another transaction, proving the secondary's calldata lands.

## Controller adjudication

**ACCEPTED.** Fix wave: `task-9-wave9-brief.md` (surgical).

The adjudication draws the recomputation line explicitly, because waves 5 and 9 could
otherwise read as contradictory:

> **Local recomputation is BANNED where the pinned library's type model is incomplete
> (headers — wave 5's law: v1.13.0 cannot represent modern OP headers, so a computed
> header hash is garbage), and REQUIRED where the type model is complete and
> recomputation is the only authentication (signed transactions — `tx.Hash()` over the
> decoded body is consensus-stable for every type v1.13.0 can decode, and a tx type it
> cannot decode fails loudly into rotation).** The reported `hash` FIELD authenticates
> nothing: the decoder ignores it, so it is merely the provider agreeing with itself.

Chain-reopen trend: 1H1M → 1M → 1M → 2M → 1M, the last a single edge adjacent to the
newest gate. Expected closing next round.
