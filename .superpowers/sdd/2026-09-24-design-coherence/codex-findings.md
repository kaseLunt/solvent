[codex task-mufitgmo-pw54x6 | completed | ~6 min 30s] — the design-coherence change `5f8f6d0..960f164` (brief: `codex-brief.md`). Verbatim.

1. **CRITICAL — `web/app/feed/ActivityTable.tsx:111` — Mixed-engine amounts still share a digit axis.** Reach: select All engines and load Cash and legacy rows with readable scales, so neither has a raw-units tag. Although `alignAmounts` is false, `COLUMNS` still right-aligns Amount, and `KitTable` applies `text-align: right` with tabular digits. Both engines' figures align in one column, violating law 2. Smallest fix: make the column alignment conditional on `alignAmounts`.

2. **CRITICAL — `web/lib/cash-summary.ts:314` — Missing percentages become "No accounts."** Reach: complete a Cash book containing computed accounts whose caps are zero and debts positive. This is supported by `ComputeDMHealth`; `headroomTenths` returns null, and `roomPercentiles` therefore returns a null median. The Median room tile shows "No accounts / No room to measure" despite liquidatable accounts being present. Smallest fix: reserve "No accounts" for an empty population; otherwise explain that no room percentage exists.

3. **CRITICAL — `web/lib/lab-compare.ts:269` — The zero-change headline includes excluded projections.** Reach: compare `weeth_market_depeg_oracles_held`, with zero spot delta, and `dm_rate_horizon_plus_200bps`, on a book where projected interest crosses an account's cap. The projection is excluded from `points`, but the headline says "No scenario in this set makes more Cash debt liquidatable." Its scope includes the projection that can do exactly that over its horizon. Smallest fix: say "No ranked spot scenario…" whenever members are excluded, retaining their explanations.

4. **CRITICAL — `web/lib/verification-view.ts:904` — A pending book request is labeled unavailable.** Reach: `/v1/evidence` fails before the concurrent `/v1/book` request settles. `deriveVerificationView` calls `unavailableChips` with `BOOK_LOADING`. The Live batch chip shows "unavailable" while Compute remains pending. Smallest fix: preserve `PENDING` when `reading.phase === "loading"`.

5. **CRITICAL — `web/lib/overview-copy.ts:123` — Overview overwrites the receipt's state and tone.** Reach: evidence loads successfully with `reconcile: null`. `pipelineSteps` assigns "No committed receipt" the refused state and tone; Verification preserves them. Overview replaces them with neutral/unavailable, producing a solid frame for the same receipt state shown as refused elsewhere. Smallest fix: preserve the supplied `state`, `stateWord`, and tone when adapting a step without a figure.

6. **CRITICAL — `web/lib/activity-view.ts:698`, `web/lib/history-view.ts:361`, `web/lib/verification-view.ts:1043` — Fetch rejection is presented as proof the request never arrived.** Reach: the server receives a request, but the connection fails before the browser receives its response, or CORS blocks access. The error has no HTTP status, and these pages say the request "did not reach the service." That conclusion is unsupported and can be false. Smallest fix: say the page could not receive a response, without asserting where delivery failed.

- **Law 3: clean** for the changed numeric formatters inspected: money registers and paired precision, percent truncation, exact timestamps, hexadecimal shortening, age formatting, and ASCII exact/clipboard values.
- **Law 6: clean** for the reviewed copy relocations, excluding the brief's expressly listed pre-existing component copy.
- **Law 7: clean** for underlying calculations, contracts, and requested data: the reviewed changes preserve those; new retry controls repeat existing reads.
- **Additional checks: clean** for negative-room chart domains and zero visibility, held-comparison age anchors after failed reruns, FAILED-versus-drift proof tones, PriceProvider v2 attribution, Cash account identity, and band-versus-lane wording.

NOT APPROVED

Codex session ID: 01a0d36f-5041-7830-9bea-cdcaae75a113
Resume in Codex: codex resume 01a0d36f-5041-7830-9bea-cdcaae75a113
