# mutation transcript

- spec: `mutations.json`
- repo: `C:\Users\kasel\source\repos\etherfi\Solvent`
- **tested SHA: `73a5698f47ec931f97767993bccacfa8b3157074`**  (chore(sdd): wave-9 mutation spec â€” W9M1 deletes the decoded comparison, committed before the loop)
- started (UTC): 2026-07-26T14:37:53+00:00
- applier: `mutate.py`, exactly-one-occurrence assertion in `apply_edit`

## W9M1 — the decoded comparison is deleted: the reported hash field — the provider agreeing with itself — becomes the only identity check, restoring the round-8 finding

**Property under attack:** ECHOING THE LABEL CANNOT AUTHENTICATE THE BODY: a response whose reported hash field EQUALS the asked hash but whose validly-signed body belongs to another transaction is a protocol violation refused by recomputation (tx.Hash() over the decoded body) — under the mutant that read SUCCEEDS at the lying primary, no rotation happens, and TxCalldata hands the deriver the substituted transaction's calldata (on the migration path: incorrect borrower and debt genesis state from valid-looking calldata)

```diff
--- internal/chain/chain.go:752
-	if recomputed := tx.Hash(); recomputed != hash {
-		return nil, false, fmt.Errorf("transaction response body hashes to %s, not the asked %s — a provider protocol violation; the reported hash field is the provider agreeing with itself, so only the hash recomputed over the decoded signed body authenticates the answer, and echoing the label cannot authenticate the body", recomputed, hash)
-	}
+	// MUTANT W9M1: the decoded comparison is deleted — the reported hash field (the provider agreeing with itself) is the only identity check
```
APPLIED at internal/chain/chain.go:752 (1 occurrence, asserted)

`go test ./internal/chain/ -count=1`

Killed by:
  - `TestRawJSONEchoedHashOverForeignSignedBodyIsAViolationThatRotates`

**Result: KILLED**

## restore verification

`git status --porcelain` over the 1 mutated file(s) is EMPTY: every file is byte-identical to `73a5698`. Restores came from in-memory copies taken before each edit; `git checkout` is never used.

## summary

| # | result | property | killed by |
|---|---|---|---|
| W9M1 | **KILLED** | ECHOING THE LABEL CANNOT AUTHENTICATE THE BODY: a response whose reported hash field EQUALS the asked hash but whose validly-signed body belongs to another transaction is a protocol violation refused by recomputation (tx.Hash() over the decoded body) — under the mutant that read SUCCEEDS at the lying primary, no rotation happens, and TxCalldata hands the deriver the substituted transaction's calldata (on the migration path: incorrect borrower and debt genesis state from valid-looking calldata) | `TestRawJSONEchoedHashOverForeignSignedBodyIsAViolationThatRotates` |

1 mutants, 1 killed, 0 survived.
