Six findings at `80ffb17`. Review was static: git/file reads only; no changes, builds, tests, or server actions.

1. **CRITICAL — README claims approval beyond the recorded scope.** [README.md:256](/C:/Users/kasel/source/repos/etherfi/Solvent/README.md:256)  
   **Reach:** Read “What is verified” and the review-policy paragraph.  
   **Shows:** “only approved components are cited here,” while lines 91, 103 and 109 explicitly identify cited client/risk changes without closing approval. The present-tense verification claims therefore exceed D-006 clause 5.  
   **Smallest fix:** Scope those claims explicitly to their approved commits and move current, unapproved behavior outside the verified claims; remove the contradictory “only approved” assertion.

2. **CRITICAL — The documented Node prerequisite admits versions that cannot run the instructions.** [README.md:143](/C:/Users/kasel/source/repos/etherfi/Solvent/README.md:143)  
   **Reach:** Fresh clone using Node 20.8, which satisfies “Node.js 20 or later”; follow `npm ci` and `npm run dev`.  
   **Shows:** Startup fails: the locked Next version requires Node `>=20.9.0`. The documented client tests have a stronger requirement: locked Vite/Rolldown require `^20.19.0 || >=22.12.0`.  
   **Smallest fix:** State a version satisfying the entire documented workflow, such as Node 22.18+.

3. **CRITICAL — Zero checked rows is incorrectly stated as zero comparisons.** [web/lib/evidence.ts:936](/C:/Users/kasel/source/repos/etherfi/Solvent/web/lib/evidence.ts:936)  
   **Reach:** An accepted manifest with `gated_rows = gated_exact = gated_drift = 0`, but one exact advisory Aave account comparison. The Go loader counts that account in the weld independently of its gate; its acceptance conjunction permits this state.  
   **Shows:** “the run checked no rows, so nothing was compared,” beside an account-comparison tally of `1/1`. Verification’s other empty-arm strings and Inspector repeat the false absence.  
   **Smallest fix:** Say “no checked rows; no checked-row proof established.” Claim no comparisons only when the comparison evidence also supports that absence.

4. **CRITICAL — Copy still violates the explicit library-only law.** [web/app/book/BookLegacy.tsx:61](/C:/Users/kasel/source/repos/etherfi/Solvent/web/app/book/BookLegacy.tsx:61), [web/app/overview/copy.ts:4](/C:/Users/kasel/source/repos/etherfi/Solvent/web/app/overview/copy.ts:4)  
   **Reach:** Open Overview, or expand a served legacy book.  
   **Shows:** The hero comes from `web/app`; the legacy component constructs `${view.eligibleDebt.text} eligible debt` and selects its absence wording itself. These are reachable violations of law 5.  
   **Smallest fix:** Move hero copy into `web/lib` and return the complete legacy tile wording from its view model.

5. **MEDIUM — Unscaled liquidation repayment bypasses the decimal guard.** [web/lib/activity-view.ts:373](/C:/Users/kasel/source/repos/etherfi/Solvent/web/lib/activity-view.ts:373)  
   **Input:** A liquidation with `debt_repaid: "1e6"` and `debt_decimals: null`.  
   **Shows:** `debt repaid 1e6 raw units`, treating an invalid wire decimal as a figure. Inspector’s corresponding payload formatter correctly calls this unreadable. Today’s Go producer serializes big integers, so this requires wire drift.  
   **Smallest fix:** Guard `debt_repaid` before both the scaled and raw branches; render unreadable on failure.

6. **MEDIUM — Unknown type names can resolve to prototype members.** [web/lib/feed-view.ts:214](/C:/Users/kasel/source/repos/etherfi/Solvent/web/lib/feed-view.ts:214)  
   **Input:** An event whose `type` is `"__proto__"`.  
   **Shows:** `typeLabel` returns `Object.prototype`, which Activity attempts to render as a React child, causing a render error instead of preserving the unknown word. Today’s server vocabulary cannot emit this value.  
   **Smallest fix:** Use a `Map` or an own-property lookup.

Other reviewed areas:

- **Clean — Activity scale fallback:** book-first/stream-first arrivals, failed or unreadable book, missing engine, missing/malformed scales, and engine-specific lookup. Scaling and raw tags change together.
- **Clean — Engine separation:** no cross-engine sum or shared monetary axis introduced.
- **Clean — Book registers and near-cap fold:** running, stopped, over-census, duplicate, unreadable, whole, empty, and entirely refused walks; complementary shown/hidden slices and matching hidden sum.
- **Clean — Receipt green-state parity:** Inspector reaches green only through Verification’s `exact` arm.
- **Clean — `inlineParts` word preservation:** code inside bold, literal stars inside code, adjacent spans, unmatched markers, and empty-marker cases.
- **Clean — Remaining checked wording:** account-comparison counting rule, movers definitions and Go cap of **20**, hourly records, and both `SWEEP_NEVER` cases.

Codex session ID: 01a0d17d-4492-7721-92d7-580076159b3d
Resume in Codex: codex resume 01a0d17d-4492-7721-92d7-580076159b3d
