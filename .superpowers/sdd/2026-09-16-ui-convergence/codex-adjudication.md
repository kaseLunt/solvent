# Codex round — adjudicated

Source: `codex-findings.md` (Codex task `task-muatuhow-l6fdyy`, 13m36s, read-only, range `a941a39..0f18a1b`, source
only; 20 findings, 19 self-labelled CRITICAL, 1 HIGH). Adjudicated by the integrator under the owner's delegation,
2026-09-20 ~23:15 USMST.

**The fact that re-grades seven of them.** `web/app/error.tsx` is a ROOT route boundary: a render-time throw replaces
only the segment below `layout.tsx` with `RouteRefusal` — the header and nav stay mounted and the failure is named. So
"a malformed 2xx member throws at render" on a page OTHER than the lab ends in an honest, coarse refusal — not a false
statement, not a white screen. Plan 4's R11 took the whole-envelope law for the LAB only (Task 9), deliberately. A
finding is FIX NOW when the page would say something FALSE or show a STUCK / STALE state — not merely refuse coarsely.

## FIX NOW — the Codex round's fix wave

| # | Finding (Codex's words, shortened) | Verdict | Area |
|---|---|---|---|
| 2 | A positions page with `batch: null` throws at `page.batch.id` BEFORE the decoding `try`, inside the fulfilment callback: an unhandled rejection and **a walk that still appears active** | **FIX** — a read in flight forever is a false state; validate inside the catch-covered path → the walk fails by name | X · Book |
| 1 (half) | A malformed background REPAIR response **replaces a previously readable book** and crashes a working page | **FIX** — judge the envelope (`batch`, `engines`) before committing `phase: "ok"`; a malformed repair leaves the readable book standing (a result is never silently replaced) | X · Book |
| 3 | **Duplicate accounts can satisfy the census**: page one returns A, the terminal page returns A again — `delivered === total` completes the walk, counts A twice, doubles its debt with no qualification | **FIX** — track account identities across the walk; a duplicate is a named walk fault, never a counted row | X · Book |
| 4 | An unreadable COMPUTED row (`status: "computed"`, `liquidatable: true`, `total_debt: "1e6"`) becomes `computed: false` while the summary keeps `notComputed: 0`: the headline says **"No position is liquidatable"** | **FIX** — law 1 on the front page's own verdict: an unreadable computed row is counted as unknown and blocks every negative claim | X · Book |
| 6 | History: `debt_usd: 1000000` as a JSON NUMBER passes `metricUnreadable`; the chart plots and labels it while the tile refuses it — money entered the count path | **FIX** — this wave's own code (Area C's I3 guard): the guard is chosen by METRIC IDENTITY; money requires a decimal string | Z · History |
| 7 | History asks for `debt_manager`, receives a valid series whose `engine` is `aave_v3_etherfi`: the figures are labelled Cash | **FIX** — law 2's neighbour (the legacy market's figures under Cash's name): the response's engine must equal the requested one, else a named refusal | Z · History |
| 11 | A projection with `horizons: []` is erased to `null` by the reader; `rowVerdict` takes the spot path and says **"No"**; the `no-horizon` branch can never see it | **FIX** — a false reassurance: keep "no projection" and "a projection with no horizons" distinct; the latter is "Cannot say" | Z · stress |
| 16 | Inspector: while `/v1/evidence` is still pending the Trust card says **"receipt unavailable"** (pending and failed are both `null`) | **FIX** — the wave's own law (a read in flight has not failed), third page: carry the evidence fetch phase; a pending receipt is pending | Z · Inspector |
| 12 | Address Lab: the lookup finds Cash in batch 10, the stress response reports no position in batch 11 → the page says "No Cash position … in batch 10", contradicting the loaded position; the early return bypasses the batch-disagreement disclosure | **FIX** — the negative is the STRESS response's, named with ITS batch, after the disagreement disclosure | Y · lab |
| 13 | Compare releases its hold on membership alone: a re-run with `eligible_debt_delta_usd: "garbage"` drops the held comparison with no banner, and the malformed body becomes the next hold | **FIX** — Task 9's law on the set path: ONE complete readability predicate for both admission and release | Y · lab |
| 14 | The single-run hold predicate omits rendered data: a mover's `hf_after_num: ""`, or a corrupted displayed LEGACY engine, is admitted; the prior result disappears with no banner | **FIX** — the predicate covers every member the result renders: mover ratio pairs and every displayed engine | Y · lab |
| 15 | `/v1/scenarios` returning `200 null` or `{ scenarios: null }` becomes `ready`, then throws at `listing.scenarios.find` | **FIX** — the lab's own law (R11) missed its listing: a named unreadable-listing state | Y · lab |
| 17 | The listing has A and B, the address's stress response only A: selecting B writes `?scenario=B` while the workspace silently falls back to A — the link names a different subject | **FIX** — this wave's own W-lab-url: the URL names the subject the workspace SHOWS (the disclosed fallback), or B stays selected under a named not-evaluated state | Y · lab |
| 18 | `/lab?address=…&scenario=A&scenarios=B`: the notice says "NOTHING was run for either" while `useAddressLookup` dispatches the address stress and shows evaluations | **FIX** — the notice claims only what it gates (the book run), and says the address evaluation is shown | Y · lab |
| 19 | Compare: `+0.01%` truncates to `0n` tenths — the dot sits at zero in the green `ok` tone though liquidatable debt ROSE | **FIX** — tone from the unrounded delta's sign; a nonzero change is never drawn as none | Y · lab |

## OWNER'S LIST — one named workstream: "every page's reader classifies its envelope"

Findings **1 (first half), 5, 8, 9, 10**: `/v1/book` `200 null` / `engines: null`; History `notes: null` / `rates: null`;
Activity `filter: null`, `tx_hash: null`, `seized: null`; Verification / Overview `reconcile.welds: null`,
`watermark_vector: null`; the stress reader `account: null`, a missing `market_realization`. Each ends TODAY at the
route boundary's named refusal — honest, coarse, and (for #9) on the front door. The lab's law (a 2xx body of any shape
ends in a NAMED state on the page itself) applied surface-wide is a workstream of its own: seven readers, a state and
pins each. Codex's list is its spec. Not taken in Plan 4 by R11's deliberate boundary.

## CARRY-FORWARD

**20** — components author whole public sentences (`BookSurface.tsx:255,259`, `CompareCard.tsx:47`): true, pre-existing
on owner-approved pages, no figure or claim is wrong; joins `MoversTable.tsx` on the copy-to-lib list.

## Clean, per Codex

`humanUtc` and `instant-split`; the Drawer's Tab / Shift+Tab cycle, closed-fold filtering, Escape and focus
restoration; Cash row engine / scale isolation and the separate Cash / legacy Compare axes; Activity's loaded-row
wording on conforming responses; the API's counts derived from their rows.
