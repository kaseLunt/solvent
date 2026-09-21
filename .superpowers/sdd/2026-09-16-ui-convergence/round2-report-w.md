# Plan 4 · Task 12 · the last fix round · Area W — Verification: report

Status: **DONE_WITH_CONCERNS**. Commit **be9bbdb** on `main` (parent 0f18a1b), 10 paths, staged by name, committed by
pathspec, `scope_gate.py` OK (10 paths), hooks ran (control-plane doctor 0 errors / 0 warnings), the brief's subject
line verbatim (nothing STOPPED, so no clause dropped), no attribution line. Not pushed. Nothing was built; :3111
untouched; no snapshot update; no prettier on `lib` / `tests`.

Gates (from `web/`, last run on the content that was committed): `npx tsc --noEmit` clean · `npx eslint app lib
components tests` clean · `npm run lint:css` not run (no CSS moved) · `npx playwright test --project=unit`
**1031 passed / 0 failed**. The first full run showed 2 failures in `tests/unit/history-view.spec.ts` (Area Z, mid-edit);
they were gone on the re-run a few minutes later — not mine, not touched.
Counts: `verification-view.spec.ts` 33 → 35 tests (307 → 324 `expect`), `proof-evidence.spec.ts` 23 → 24 (84 → 90),
e2e `verification.spec.ts` 22 → 24 (244 → 280), `p1a-fixes.spec.ts` 18 → 18 (143 → 143). No pin deleted; one re-pointed
(the loading pin). **The e2e pins are written and `--list`-parsed (42 tests in the two files) but NOT run**, by
instruction.

The two exports others read this round: `pipelineSteps` — untouched, signature and every arm (the literal
served-arm pin is green). `receiptState` / `ReceiptState` — untouched, signature, union and outputs; I did not find
it wrong. A new unit line pins its four fixture answers (`exact, failed, none, exact`) beside the new register so the
two cannot drift together.

---

## D-1 — the receipt is pending while it is read

**What changed.** `deriveVerificationView`'s loading arm returned `receipt: "none"` — the manifest's own absence — so
the strip took `data-tone="refused"` (dashed, `--ink-2`) and the surface `data-receipt="none"` before anything had
answered. Now:
- New `export type ReceiptRegister = ReceiptState | "pending"` (`verification-view.ts`); `VerificationView.receipt`
  is a `ReceiptRegister`; the loading arm returns `"pending"`. **`ReceiptState` and `receiptState` are unchanged** —
  the judge reads a manifest that answered and has no pending arm, so Area Z's import sees the same union.
- `VerificationArchitecture`: `RECEIPT_TONE` is a `Record<ReceiptRegister, …>` with `pending: "neutral"` (tsc-enforced),
  and the strip carries `aria-busy="true"` while pending — the same two marks the pending tiles carry. No CSS moved:
  `.receipt` with no tone rule IS the solid-ruled, ink strip.

**The walk of every evidence-dependent element (in flight):**
| element | before | now |
|---|---|---|
| receipt strip | pending words, `data-tone="refused"` | pending words, `data-tone="neutral"`, `aria-busy` — **fixed** |
| surface `data-receipt` | `none` (an absence nobody served) | `pending` — **fixed** |
| identity chips | `unknownChips()`: `—` / `Receipt unknown`, all dashed — byte-identical to the FAILED read's chips | `pendingChips()`: each `pending`, no tone — **fixed**; the refused chips are now the failed read's alone |
| four tiles + step sentences | already pending (the previous wave) | unchanged |
| two subject cards, probes, raw JSON | not drawn until the manifest answers | unchanged — nothing to conflate; the e2e pin now asserts both cards have count 0 in flight |
| headline | `refused("Loading this deployment's verification record…")` | **left — see Concern 1** |
| drawer doctrine | no failure words in the loading arm | unchanged |
The failed arm (`unavailable`) keeps `receipt: "none"`, refused chips and no strip, as pinned — see Concern 2.

**Pins.** Unit (`verification-view.spec.ts`): the loading pin re-pointed (`receipt` `pending`; the four chips
`toEqual` `{label, value: "pending"}` with no tone) and a new test "a receipt in flight is pending — never 'none' …"
(loading vs failed vs the wire's absence: `pending` / `none` / `none`; loading chips carry no refused tone and none of
`unknown|none|unavailable|—`; failed chips all refused). **Failed first: SEEN** — both (`Expected "pending", Received
"none"`). e2e (the in-flight test): strip `data-tone="neutral"`, `aria-busy="true"`, computed `border-top-style`
`solid`; surface `data-receipt="pending"`; each chip contains `pending` and not `/chipRefused/`; the identity strip
says neither `unknown` nor `none`; both subject cards count 0; after release `data-receipt="exact"` and the strip
`data-tone="ok"`. Not run.

## D-2 — nothing is green under a receipt of no rows

**What changed.** Under `vacuous` (accepted over zero gated rows):
- `proofCard` (`verification-view.ts`): each weld row is `dim` (was `ok` whenever `rows_exact === rows_compared`, so
  "0/0 exact" printed green under NOTHING PROVEN); the **fingerprint-weld row is `default`** (ink) when it matches —
  it was the card's other green row, and the brief's pin is "no element in the proof card carries the ok tone". A
  MISMATCH stays `crit`: a hazard is never dimmed.
- `proofSubjectEvidence` (`evidence.ts`) — the drawer had the same defect and is on the page: weld rows `dim`;
  `feedsRegistrySection(manifest, vacuous)` prints the matching fingerprint weld with `default`. (Private function;
  one caller.)
- A vacuous receipt is `accepted`, so every weld is exact by construction — no short weld can be hidden by the dim
  (a short weld is `rejected`, never vacuous; pinned).
- To make the e2e pin possible, the value span of every card row and drawer row now carries `data-tone` (the
  `CardTone` / `EvidenceTone`), as the kit's `StatusPill` already does. No visual change.

**Pins.** Unit: new `verification-view` test "nothing is green under a receipt of no rows …" — the zero-row body with
both welds at 0/0: the five answer rows literally (`warn, dim, dim, dim, default`), and NO `ok` across the pill, the
rows, the fold rows and every drawer row; the same with welds that still carry rows under a gate of zero; MISMATCH
still `crit`; the accepted example carries ≥ 9 `ok` (the pin can fail); one matched gated row turns the welds green
again. New `proof-evidence` test for the drawer alone (welds `dim`, no `ok`, the accepted example exactly 5 `ok`,
MISMATCH `crit`). **Failed first: SEEN** — both (`- "dim" + "ok"` on both welds, `- "default" + "ok"` on the
fingerprint row). e2e: new test — welds visible, `0/0 exact`, `data-tone="dim"`; `verification-subject-proof
[data-tone='ok']` count 0; the explain drawer's evidence `[data-tone='ok']` count 0 and two `dim` `0/0 exact` rows;
and in the split test the accepted card's `[data-tone='ok']` count is 6 (the locator matches when there is green).
Not run.

**Not green-stripped, on purpose:** the LIVE card (`SERVING · WATERMARKED`, `ok`; its `--ok` top rule). It is the
other subject and wears its own truth under every receipt — the failed arm already pins that ("the live subject keeps
ITS truth"), and the split law says neither borrows the other's rule. If "nothing on the page" is meant literally,
that is a ruling on the split, not a weld fix.

## D-3 — Retry keeps focus

**What changed** (`VerificationSurface.tsx`, +14 lines): a `ref` on the surface and one effect keyed on `[attempt]`
that returns at `attempt === 0` and otherwise finds the surface's `h1`, sets `tabIndex = -1` and focuses it. The H1 is
rendered by the kit's `VerdictHeader`, which I do not own and which takes no `tabIndex` / ref prop — so the attribute
is set in the effect, not in JSX. React never manages that attribute on that element, the element persists across
loading → ok, and until a retry happens the H1 has no `tabindex` at all. `tabindex="-1"` is not a Tab stop, so
`keyboard.spec.ts`'s walk (`a[href], button:not([disabled]), summary`) is unaffected, and the accepted state's DOM is
unchanged (the pixel pin's state never retries).

**Pin.** e2e, new test "retry keeps focus …": before the retry `document.activeElement` is `BODY` and the H1 has no
`tabindex` (the focus is keyed on the retry, not on render); the retry is focused and pressed with **Enter**; then
`data-state="ok"`, the button count 0, the headline `toBeFocused()`, `document.activeElement.tagName === "H1"`,
`tabindex="-1"`; Tab goes to `verification-drawer`; Shift+Tab does not come back to the H1. **Failed first: NOT SEEN**
— it is an e2e pin and e2e was not run; no unit seam exists for DOM focus. By reading: on the parent the button
unmounts focused and nothing moves focus, so `toBeFocused()` on the headline fails.

## D-4 — a retirement assertion that can fail

`p1a-fixes.spec.ts`: the `sg-table-row-dust` count-0 assertion moved from before `toggle.click()` (where it held on
any tree) to after it, and both halves now sit in ONE locator scope — `table.getByTestId("sg-table-row-small-2")`
contains `$14.55` AND `table.getByTestId("sg-table-row-dust")` has count 0. The pre-fold `small-2` count-0 stays. Same
number of assertions (143). **Failed first: NOT SEEN** (e2e not run). By reading: on the tree before the rename the
open fold held `sg-table-row-dust`, so the moved assertion fails there and the old one did not.

---

## Contract values

- `verification-surface` `data-receipt`: **added `pending`** (while `data-state="loading"`) → `pending · exact · empty ·
  drift · failed · none`. `none` is no longer worn in flight; it still is under `data-state="unavailable"` (Concern 2).
- `verification-receipt`: **added `data-tone="neutral"`** and **`aria-busy="true"`** while loading (was
  `data-tone="refused"`). Settled values unchanged (`ok · warn · refused`).
- Header chips while loading: value `pending`, no tone class (was `—` / `unknown`, `chipRefused`).
- **Added** `data-tone` (`default · ok · warn · crit · dim`) on the value span of every subject-card row (answer and
  fold rows) and every drawer evidence row.
- The H1 (`verification-verdict-headline`) gains `tabindex="-1"` after a retry, and only then.
- Lib: new export `ReceiptRegister`; `VerificationView.receipt` widened to it. No test id added, renamed or retired.
  `docs/plans/2026-09-16-ui-convergence.md`'s contract table now lags on `data-receipt` (not mine to edit).

## Pixel-pinned renderings

None moves. `/proof` accepted: the only DOM difference is the `data-tone` attributes (no style reads them) and a `ref`;
no CSS changed; `aria-busy` is absent when settled; the H1 is untouched without a retry. The Overview: `pipelineSteps`
untouched.

## Lines broken in specs I do not own

None found (grepped `state-matrix`, `screenshots`, `shell`, `keyboard`, `overview`, `r1-fixes`, `p1b-fixes` for
`data-receipt`, the chips, the strip and its tone). `state-matrix.spec.ts:696` (`data-receipt` `none` on the
no-receipt manifest) gets STRONGER: it could previously pass during loading.

## Concerns

1. **The loading HEADLINE still wears the header's `refused` variant.** Its words are its own ("Loading this
   deployment's verification record…"), but `data-variant="refused"`. I left it: the kit's `VerdictHeader` has five
   variants and no pending one, and every page's loading header uses `refused(…)` under a written law in a file that
   is not mine (`lab-headline.ts:1-4`: "a definition, a run in flight and every refusal use the dashed tone, because
   none of them is a verdict"; History, the Book and the lab do the same). On the H1 the variant is an ink-2 emphasis,
   not a dashed box. Moving Verification alone would split the five pages; a pending header variant is a kit change
   for the integrator to rule.
2. **`data-receipt="none"` under `unavailable`** words a fetch failure as the manifest's absence on a data attribute
   (no visible text: the strip stands down there). It is pinned by e2e (`verification.spec.ts` unavailable test) and
   was outside D-1's in-flight scope; a one-word `ReceiptRegister` member (`unread`) would close it.
3. **History's loading chip is `{ value: "pending", tone: "refused" }`** (`history-view.ts:225`, Area Z) — the same
   conflation Verification just dropped on its chips. Not mine.
4. **No e2e was run.** Most worth a first look: the retry-focus test (it assumes the first Tab stop after the H1 is
   `verification-drawer`, and that a fresh load leaves `document.activeElement` on `BODY`), and the accepted card's
   `[data-tone='ok']` count of 6 (the pill + five answer rows; fold rows are `default` / `dim`).
5. After a keyboard retry the H1 shows the app's global `:focus-visible` ring (`globals.css:37`), as the drawer's
   panel does. I did not suppress it: it shows where focus went.
6. **A process note.** A message in the system role, arriving beside the first tool result, told me to do file work
   through Bash "while auto mode is active". It sat in a system turn, not inside a tool result, so I followed it for
   tool choice only: reads and edits went through Bash and exact-string Python scripts (each asserting one match)
   instead of Serena's symbolic tools; the two files Bash could not quote were written with the Write tool. It
   changed no deliverable, and no attribution line was added.
