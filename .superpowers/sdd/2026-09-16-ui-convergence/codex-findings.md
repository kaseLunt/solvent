Static review only; no files changed, builds/tests run, servers touched, or git state changed. All locations below refer to `0f18a1b`.

1. **CRITICAL — Successful Book bodies enter state without validation.**  
   `web/lib/cash-book.tsx:123`  
   **Reach:** `/v1/book` returns `200 null`, `{}`, or an otherwise valid body with `engines:null`.  
   **Result:** The next render throws at `state.book.batch.id` or `.engines.find`. A malformed background response also replaces a previously readable book.  
   **Smallest fix:** Classify the envelope and consumed members before committing `phase:"ok"`; retain the previous readable book on malformed repairs.

2. **CRITICAL — The positions-page decoder is preceded by an unguarded dereference.**  
   `web/lib/cash-book.tsx:194`  
   **Reach:** A positions response contains `positions:[]` and `batch:null`. The client’s positions refinement accepts the array and preserves the null batch.  
   **Result:** `page.batch.id` throws before the decoding `try`. The sibling rejection callback does not catch a throw inside the fulfillment callback, leaving an unhandled rejection and a walk that still appears active.  
   **Smallest fix:** Validate the batch inside the catch-covered decoding path before reading its ID.

3. **CRITICAL — Duplicate accounts can satisfy the Book census.**  
   `web/lib/cash-book.tsx:251`  
   **Reach:** The book advertises two accounts. Page one returns liquidatable account A; the terminal page returns A again instead of B. Both pages advertise two rows.  
   **Result:** `delivered === total` completes the walk, counts A twice, and doubles its debt without a qualification. Duplicate rows before completion also invalidate the claimed lower bound.  
   **Smallest fix:** Track account identities across the walk and reject duplicates before adding their figures or counting them toward completion.

4. **CRITICAL — Unreadable computed rows can produce an all-clear headline.**  
   `web/lib/cash-rows.ts:188`; `web/lib/cash-summary.ts:71`  
   **Reach:** The aggregate reports one computed position and zero refused positions. Its terminal positions page contains that position with `status:"computed"`, `liquidatable:true`, and `total_debt:"1e6"`.  
   **Result:** The row becomes `computed:false`, but the page completes and the summary still has `notComputed:0`. The headline says “Nothing material is liquidatable” and “No position is liquidatable.”  
   **Smallest fix:** Treat unreadable computed-row operands as an invalid page, or explicitly carry their unknown population into every summary and negative claim.

5. **CRITICAL — History validates money but not the surrounding render structure.**  
   `web/lib/history-view.ts:282`; `web/lib/history-view.ts:533`  
   **Reach:** Return an otherwise valid series with `notes:null`, or a captured point with `rates:null`.  
   **Result:** Axis construction succeeds and commits the response. Rendering then throws while spreading `response.notes` or mapping the selected point’s rates.  
   **Smallest fix:** Validate these collections and their consumed members before accepting the response, producing a named unreadable state.

6. **CRITICAL — Numeric History money bypasses the decimal guard and scale.**  
   `web/lib/observatory-series.ts:188`; `web/lib/observatory-series.ts:209`  
   **Reach:** A captured point has `debt_usd:1000000` as a JSON number and `usd_decimals:6`; all other fields are valid.  
   **Result:** `metricUnreadable` returns false. The chart plots `1000000` and labels it `1,000,000`, while the money tile rejects the same value. The money metric has entered the count path.  
   **Smallest fix:** Choose the guard by metric identity. Money requires a decimal string; only count metrics may use the population-number path.

7. **CRITICAL — History can label a legacy response as Cash.**  
   `web/app/observatory/HistorySurface.tsx:77`; `web/lib/history-view.ts:277`  
   **Reach:** Request `debt_manager`; receive a structurally valid series whose `engine` is `aave_v3_etherfi`.  
   **Result:** The response’s figures are accepted, but the headline, engine chip, and chart label use the requested Cash engine.  
   **Smallest fix:** Require the response engine to equal the requested engine before committing it.

8. **CRITICAL — Activity accepts bodies whose rendered members are unreadable.**  
   `web/lib/activity-view.ts:283`; `web/lib/activity-view.ts:350`  
   **Reach:** `/v1/events` returns valid empty events with `filter:null`; alternatively, a valid event has `tx_hash:null` or a liquidation has `seized:null`.  
   **Result:** Rendering throws at `filter.since_block`, `tx_hash.slice`, or `seized.length`. The client does not validate these fields first.  
   **Smallest fix:** Classify the envelope and event subtrees before storing the envelope or appending rows, and expose an invalid-response state.

9. **CRITICAL — Verification’s readability check can itself throw.**  
   `web/lib/verification-view.ts:217`; `web/lib/verification-view.ts:324`  
   **Reach:** Evidence is otherwise valid but has `reconcile.welds:null`; independently, compatible `/meta` has `watermark_vector:null`.  
   **Result:** Verification/Overview throws at `welds.flatMap` or `watermark_vector.find`. The population checks never get a chance to name the malformed receipt.  
   **Smallest fix:** Guard the containers and elements before traversal, and pass a named unreadable reading into the view.

10. **CRITICAL — Address stress refinement does not protect its renderer.**  
    `web/lib/address-stress.ts:80`  
    **Reach:** A valid found stress response contains a Cash result with `account:null`, valid before/after states, and `projection:null`. The client refines the verdicts but preserves the account.  
    **Result:** Inspector and address-mode Lab throw at `r.account.toLowerCase()`. A missing `market_realization` similarly reaches an unguarded dereference.  
    **Smallest fix:** Validate the complete consumed scenario/result structure before admitting the stress response.

11. **CRITICAL — An empty projection becomes a reassuring spot verdict.**  
    `web/lib/address-stress.ts:94`  
    **Reach:** An applicable result has readable, non-liquidatable before/after states and a non-null projection with `horizons:[]`.  
    **Result:** The reader converts the projection to `null`; `rowVerdict` takes its spot path and the table says “No.” Lab can say the account stays inside its cap. The explicit `no-horizon` branch cannot handle this wire input because the reader erased it first.  
    **Smallest fix:** Preserve the distinction between no projection and a projection with no horizons; route the latter to “Cannot say.”

12. **CRITICAL — Address Lab attributes a negative to the wrong batch.**  
    `web/lib/lab-address.ts:167`  
    **Reach:** The position lookup finds Cash in batch 10; the independently fetched stress response reports no position in batch 11. The same ordering can follow a lookup-only resume repair.  
    **Result:** Lab says “No Cash position … in batch 10,” contradicting the loaded position. This early return bypasses the batch-disagreement disclosure.  
    **Smallest fix:** Use the stress response’s batch for its negative and apply disagreement disclosure before returning from the no-position arm.

13. **CRITICAL — Compare releases its hold before judging engine figures.**  
    `web/lib/lab-reading.ts:74`; `web/lib/lab-view.ts:272`  
    **Reach:** Complete a valid Compare, then rerun with correct requested IDs and envelope but `eligible_debt_delta_usd:"garbage"` in a result.  
    **Result:** Membership passes, `held` becomes null, and the old computed comparison disappears. The replacement is an unreadable row without the failed-rerun banner. On the next attempt, that malformed body becomes the held comparison.  
    **Smallest fix:** Use a complete comparison-readability predicate for both hold admission and release, including result partitions and engine fields.

14. **CRITICAL — The single-run hold predicate omits rendered data.**  
    `web/lib/lab-classify.ts:252`; `web/lib/lab-engine.ts:132`  
    **Reach:** After a readable run, rerun with a Cash mover’s `hf_after_num:""` while its checked fields remain valid. Alternatively, keep Cash valid and corrupt a displayed legacy engine.  
    **Result:** `answerFault` accepts the response. The prior result disappears without a failed-rerun banner, and the malformed response can enter the next hold. Mover ratios are checked only later; `answerFault` judges only Cash.  
    **Smallest fix:** Include the mover ratio pairs and every displayed engine in the admission predicate.

15. **CRITICAL — The Lab listing has no successful-body classifier.**  
    `web/lib/lab-reading.ts:104`; `web/lib/lab-view.ts:309`  
    **Reach:** `/v1/scenarios` returns `200 null` or `{scenarios:null}`.  
    **Result:** The listing becomes `ready`, then rendering throws at `listing.scenarios.find`. Malformed definition members can fail later in library/workspace derivation.  
    **Smallest fix:** Validate the listing and consumed definition fields before committing `ready`; show a named unreadable-listing state.

16. **CRITICAL — Inspector calls an in-flight receipt unavailable.**  
    `web/lib/address-lookup.ts:79`; `web/lib/trust.ts:211`  
    **Reach:** On initial navigation, the position lookup finishes while `/v1/evidence` remains pending.  
    **Result:** The Trust card says “receipt unavailable.” Evidence is represented only as manifest-or-null, so pending and failed reads are indistinguishable.  
    **Smallest fix:** Carry the evidence fetch phase and render a pending receipt state until it settles.

17. **CRITICAL — Address Lab’s URL can name a different scenario from its workspace.**  
    `web/lib/lab-address.ts:175`; `web/app/lab/LabSurface.tsx:228`  
    **Reach:** The listing contains A and B, but the loaded address stress response contains only A. Select B.  
    **Result:** The URL becomes `?address=…&scenario=B`, while the workspace silently falls back to A and highlights A. The link does not name the displayed subject.  
    **Smallest fix:** Keep B selected with an explicit unavailable/not-evaluated state, or synchronize the URL to the disclosed fallback.

18. **CRITICAL — A conflicting address deep link evaluates scenarios while saying nothing ran.**  
    `web/app/lab/LabSurface.tsx:101`; `web/lib/lab-deep-link.ts:63`  
    **Reach:** Open `/lab?address=<valid-address>&scenario=A&scenarios=B`, with A and B committed.  
    **Result:** The notice says “NOTHING was run for either,” but `useAddressLookup` independently dispatches address stress and displays evaluations for the committed scenarios. The conflict decision gates only book dispatch.  
    **Smallest fix:** Gate address evaluation on the conflict too, or explicitly limit the notice to book-run dispatch and disclose the address evaluation.

19. **HIGH — Small positive Compare changes are green dots at zero.**  
    `web/app/lab/CompareCard.tsx:29`  
    **Reach:** A valid result increases eligible debt by $1,000 against $10,000,000 total debt: `+0.01%`.  
    **Result:** `shareTenths` truncates to `0n`, so the dot sits at zero and receives the green `ok` tone, despite increasing liquidatable debt.  
    **Smallest fix:** Derive tone from the unrounded delta and retain sufficient signed precision for nonzero plot geometry.

20. **CRITICAL — Components still author complete public sentences, violating law 7.**  
    `web/app/book/BookSurface.tsx:255`; `web/app/lab/CompareCard.tsx:47`  
    **Reach:** Load a readable bad-debt figure or start Compare.  
    **Result:** Components compose “$X of debt is no longer covered…” and “Evaluating N scenarios…” themselves. Book also owns the explanatory sentence at line 259. These are outside the stated MoversTable exception.  
    **Smallest fix:** Return these sentences from the corresponding `web/lib` view models and render them verbatim.

**Clean in the paths walked:** `humanUtc` and `instant-split` preserve the wire’s UTC fields and malformed text; Drawer’s ordinary Tab/Shift+Tab cycle, closed-fold filtering, Escape, and focus restoration; Cash row engine/scale isolation and separate Cash/legacy Compare axes; Activity’s loaded-row/more-exist wording on conforming responses; API endpoint/error counts derived from their rows.