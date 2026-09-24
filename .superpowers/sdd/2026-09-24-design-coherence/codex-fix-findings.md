[codex task-mufk6b50-413a8i | completed | ~2m35s] — re-verification of the six findings over `960f164..35d322a` (brief: `codex-fix-brief.md`). Verbatim.

1. **CLOSED — Mixed-engine digit axis.** `web/app/feed/ActivityTable.tsx:50` makes Amount alignment conditional; `web/components/kit/KitTable.tsx:34` applies explicit left/right classes to headers and cells. All-engine amounts no longer share the right-aligned digit axis.

2. **CLOSED — "No accounts" over zero-cap accounts.** `web/lib/cash-summary.ts:318` handles the entirely refused population first; `:323` reserves "No accounts" for zero computed accounts, while `:324` gives nonempty zero-cap populations "Not measurable" in the unavailable register. A new scope error in its explanation is reported below.

3. **CLOSED — All-zero compare headline.** `web/lib/lab-compare.ts:271` qualifies the sentence as "No ranked spot scenario" whenever any member is excluded. `:272` retains each exclusion's explanation.

4. **CLOSED — Pending book labeled unavailable.** `web/lib/verification-view.ts:900` preserves "pending" while the book read is loading; the subsequent branches distinguish a served batch, no servable batch, and failure.

5. **CLOSED — Overview overwrites missing-receipt register.** `web/lib/overview-copy.ts:124` preserves the shared step's state and state word, retaining its refused tone. `web/lib/verification-view.ts:501` supplies refused / "No committed receipt."

6. **CLOSED — Unsupported request-delivery claim.** `web/lib/activity-view.ts:721`, `web/lib/history-view.ts:379`, and `web/lib/verification-view.ts:1038` now say the page could not get a response. `web/lib/fetch-failure.ts:13` distinguishes malformed 2xx answers from non-2xx failures, and the three views consume that distinction. `web/lib/verification-view.ts:903` gives the book's no-batch response its refused chip and matching words.

**NEW — CRITICAL — `web/lib/cash-summary.ts:324` at `35d322a`: the new explanation turns refused accounts' unknown caps into absent caps.** Reach: finish a Cash walk containing one computed account with zero cap and positive debt, plus one account refused because its collateral sweep never succeeded. This is supported by `internal/riskfeed/assemble.go:999`. Refused rows have no room percentage; `summarizeCash` still considers the walk whole when no computed row is unreadable (`web/lib/cash-summary.ts:110`). Thus `computed > 0`, `notComputed > 0`, and the median is null. The tile displays "Not measurable / No account has a borrow cap to measure room against." The refused account's cap is unknown, so that whole-book negative is unsupported and can be false, violating laws 1 and 5. Smallest fix: scope the explanation to the computed population—for example, "No computed account has a positive borrow cap to measure room against."

NOT APPROVED

Codex session ID: 01a0d392-1592-7a33-869f-e1fb09e4db5c
