# Task 12 Step 5 — the cold-visitor read-through, adjudicated

Source: `task-12-user-readthrough.md` (`solvent-user`, four personas, 52 captures + the no-API "bad day" walked at
:3111): 4 BLOCKER · 33 MAJOR · 11 MINOR. Adjudicated by the integrator under the owner's delegation, 2026-09-20.

The rule of triage. Plan 4's boundary is convergence of four pages onto the kit — "no IA rebuild: routes, data and
sentences unchanged" (§12), since amended at the gate for the four pages' headlines. So:
- **WAVE** = inside that boundary (the four pages, their honest states, the kit), OR an honest-UI law broken anywhere
  (a claim the product cannot back; a failure worded as something else) — fixed now, in Task 12's fix wave.
- **OWNER** = a product / IA / data decision on a page the owner already approved (Overview, Book, Inspector,
  Scenarios), or one needing new data — the owner's list, ranked, as the next plan's raw material.
- **ARTEFACT** = produced by the capture harness (no live stream, a cold-load mock), not by the product.

## Blockers

| # | Finding | Verdict | Why / what |
|---|---|---|---|
| B1 | Activity amounts are raw machine integers; supplies / withdrawals have no amount; Inspector activity "raw units" | **OWNER (rank 1)** + part ARTEFACT | Live, Cash rows scale once the stream delivers `engineValueDecimals` (the pin aborts the stream). But legacy rows, the Inspector's `600000000000000000 weETH [raw units]` and `record-only` are the product as built: the wire carries raw integers and no per-asset decimals on `/v1/events`. Humanising needs a decimals source (params / a registry) — a data decision, not a convergence fix. The column now says "engine units, not USD" (gate round). |
| B2 | Hero "70,000 people" directly above "Accounts 1,412" | **OWNER (rank 2)** | The hero is static, owner-approved copy (Plan 1); 1,412 is the demo dataset's borrowing accounts. Cardholders vs borrowers is a real distinction the hero does not draw. One clause fixes it ("…; N of them borrow against it today") — the owner's words to choose. |
| B3 | API base URL is `http://localhost:8080` in all 41 samples; leaks into error text | **OWNER (known carry-forward)** | Env-driven; the hosted-API workstream (§10.6) is already a carry-forward of this plan. The leak of the URL into a refusal's message is `InspectorFetchError.message` verbatim — goes with the same workstream. |
| B4 | Green "reconciles to chain" ticks (Inspector, Overview) claim more than Verification says is true | **WAVE — W-trust-claim** | CONFIRMED in code: `lib/trust.ts:183` labels the item "Book reconciles to chain" — present tense, about the live Book — with a green tick from a PINNED, dated reconcile run that Verification says the live batch "does not inherit". An overclaim. The label states what the receipt is: the pinned reconcile run matched the chain (N/N Cash rows), with the run's date; never a statement about this batch or this account. The Overview's Verify step already describes the receipt's rows and stays. |

## Majors — WAVE (fixed now)

| # | Finding | Wave item |
|---|---|---|
| M6 | History: the chart's LEFT label ($27,942,906) reads as the starting value above a sentence saying debt rose to $27.8M — it is the window's MAXIMUM; "rose 1 to 49" is ambiguous | **W-history-maxlabel**: the y-max label says what it is (e.g. "peak …") from the lib; the finding says "rose by 1, to 49" / "fell by 52, to 1,412" |
| M8 | History speaks storage vocabulary (stride, buckets, watermark block) | folded into the queued **clarity Tier 2 on History** (Stride chip `hourly`, chip label `Hours … recorded`, tile sub `hour of {iso}`) — which also fixes the 390 overflow |
| M15 | `verificationFailed`: "3 drift named" names nothing; amber headline vs red chip / card | **W-verify-failed**: the failed arm never says "named" unless the manifest names rows (check the body; if it carries the drifted rows, list them); tone — see the owner's list (design's formula kept for now) |
| M16 | `verificationUnavailable`: the message printed twice; no retry | **W-verify-unavailable**: say it once; a retry control as Activity has (the hook's reload) if it is ≤ ~20 lines, else OWNER |
| M18 | `activityRefused` at cold load: the developer error twice; "Load more" offered beside "restart" with zero rows loaded | **W-activity-refused**: with no rows loaded there is no "Load more"; the refusal's words once ("dropped my rows" is ARTEFACT — none were loaded) |
| M30 | The bad day: the Book says "not computed" ten times for a NETWORK failure; Scenarios shows a live "Run" beside "Nothing can run"; a dead "Legacy ↓" anchor | **W-book-unavailable**: CONFIRMED (`bad-book.txt`; `BookSurface.tsx:48` `refusedTiles ? "Not computed."`): a fetch failure is "unavailable", never the engine-refusal word — an unread book is not a refused one. **W-lab-run-disabled**: Run is disabled while the listing is unavailable. The dead anchor: hide the "Legacy ↓" link when the legacy block is not rendered. |
| M17 (part) | `historyDegraded`: "the Book" is not a link | **W-history-degraded-link** only if the dek can carry a link without the component composing copy (a `{ text, href }` part from the lib); else OWNER |

## Majors — OWNER'S LIST (ranked; the next plan's raw material)

1. **M1 / M28** — the Book shows 6 of 27 near-cap accounts and Scenarios 20 of 118 movers: no full table, sort or "see all". (The risk lead and the searcher both stop here.)
2. **M3 / M32** — liquidatable is 2 on the Book and 49 on History (positions vs material accounts; Cash vs the window's count); the legacy market's 46 are a collapsed line at the Book's foot and never headlined.
3. **M21 / M24** — "Not computed 6 — collateral sweep never ran" reads as a broken job and hides ≈ $178K; the Inspector's amber "1 of 3 rows failed · gen 4" never says what it means for the collateral figure.
4. **M13 / M14** — Verification: 87 ≠ 29 + 14 (the other 44 gated rows are never said); "87/87" six times in one viewport; the check is ten days older than the data and the page does not say so in those words.
5. **M12 / M9 / M31 / M29** — builders' vocabulary: Verification's cards (weld, gated, pin, materialization key, `recon/p3-probes.md`), Activity's "Filter echo … since_block … limit 50" and `deficit_created`, the header chips ("Current not projected", Coverage, "both engines", "Out of model"), the API page's raw spec text (unrendered `**` / backticks, "AMENDMENT 1/E", "THE EXCLUSION LAW"; "Contract" reads as a smart contract).
6. **M4 / M5** — Scenarios: three meanings of "moved" (941 / 425 / 118); bands of 4.76% / 9.09% where the Book uses 2 / 5 / 10%.
7. **M10 / M11 / M25 / M26** — Activity has no address filter and liquidations no dollar size; one liquidation row shows two sizes that do not agree on their face; the Inspector's activity ("custodied", raw ISO, a greyed row that looks disabled) and its history (batches not time, no scale, drawn twice).
8. **M7** — History's headline answers the Book's question (how much debt) rather than History's (what changed); no range control; the points' clickability is hidden.
9. **M2** — "$109.45 — below the $100 line" reads as a contradiction (EACH position is below the line; the sum is not). One word ("each") in an owner-approved, pixel-pinned dek.
10. **M22 / M23 / M27 / M33** — the Book's chart card is two-thirds empty; "Room" is dollars on two rows and percent on the rest; Scenarios' selected / must-I-press-Run state; "looks official until the footer's last line".
11. **M17 (rest)** — the API's degraded message names a table, a task and a migration number (the SERVICE's words).

## Artefacts (no action)

- **M20** "Reconnecting" in the nav beside "42s · fresh": the harness aborts the stream. (A visitor on a flaky connection does see it; the pill is honest about the stream, the chip about the batch — noted for the owner under item 5's vocabulary pass.)
- **M19** `activityExhausted` "which filter did I apply": the capture mocks an empty first page with no filter set; the Filter chip is on the page.
- **M18 (part)** "dropped the rows I had": the refusal capture is a cold load; no rows were loaded.

## Minors (11)

Left in `task-12-user-readthrough.md` for the next plan; none is a law.
