# Round 2 — report, Area Z · History, the stress reader, the Inspector's trust

Status: **DONE_WITH_CONCERNS** — all six items landed in one commit, nothing STOPPED. The concerns are decisions made
inside the rulings, one slip of mine outside my files (working-tree line endings only, no content, nothing committed),
and the fact that no e2e pin was run (by instruction).

Commit **c192523** on `main` (on top of Area W's `be9bbdb`), 16 paths, staged by name, committed by pathspec,
`scope_gate.py` OK (`16 path(s)`), hooks ran (control-plane doctor 0 errors), subject verbatim (no clause dropped), no
attribution line, not pushed.

Gates (all from `web/`, on the final tree after the commit): `npx tsc --noEmit` exit 0, no output ·
`npx eslint app lib components tests` clean · `npm run lint:css` not run (no CSS moved) ·
`npx playwright test --project=unit` **1073 passed, 0 failed** (the whole list read; mid-run I saw failures in
`book-headline.spec`, `cash-view.spec` and `lab-address.spec:491` — Areas X and Y mid-edit, their fail-first pins —
all gone on the final run). My unit specs gained **8 tests**, none deleted: `history-view` +2, `observatory-series` +1,
`address-stress` +1, `trust` +3, `inspector-view` +1 (C-1 / C-2 are new assertions inside two existing tests). e2e,
written, typechecked and `--list`-parsed, **NOT run**: `history.spec.ts` +2, `inspector.spec.ts` +3. No build, :3111
untouched (the unit run reused the server already listening there), no `--update-snapshots`, no prettier.

Files: `web/lib/{observatory-series,observatory-data,history-view,address-stress,address-lookup,trust,inspector-view}.ts`,
**new** `web/lib/inspector-evidence.ts`, `web/app/observatory/HistorySurface.tsx`, the five unit specs, the two e2e specs.

## Per item

### 1. wave-review I-1 = Codex #6 — money is judged as money whatever its type

`lib/observatory-series.ts`: new exported `isMoneyMetric(metric)` (`debt_usd` / `collateral_usd`); `rawMetric` now
returns `unknown` (the body is cast, not validated). The three deciders branch on the METRIC:
- `metricUnreadable` = a money metric whose value is not null and not a wire decimal STRING — so a malformed string, a
  number of any sign or size, and a missing member are all the unreadable hole; a count is never "unreadable";
- `displayMetric`: money → the decimal guard then `renderUsdAmount`, else the em dash; count → `readWirePopulation`
  whatever the value's type;
- `geometryOf(raw, metric, decimals)`: money is placed only as a guarded decimal string; a count through
  `readWirePopulation`.
The count law is untouched in kind: a malformed COUNT still throws (the four pins stand). One consequence to know:
a count served as a STRING (`accounts: "1412"`) used to enter the money path, be plotted through `formatUnits` and
labelled `$0.001412`, throwing only at an end hour; it now throws on the count's own read everywhere — the same law,
applied by identity. The module head's law and `rawMetric` / `geometryOf` docs say this.

Pins:
- unit THROUGH `deriveHistoryView` — `history-view.spec.ts` "money is judged as money whatever its type, THROUGH the
  view…" (`27828808.216758`, `27828808216758`, `1000000`, `-5`, `0` at the newest hour: state `ok`, the unreadable
  headline, the dashed debt tile, the other three tiles neutral, the finding, the key, the record's dash with its
  cause; an OLDER hour; the collateral metric). **SEEN FAILING FIRST**: `WireIntegerError: debt_usd is not a wire
  population … got 27828808.216758` at `displayMetric (observatory-series.ts:209) ← buildMetricSeries (:281) ← tileOf
  ← deriveHistoryView` — the path the review named.
- unit through the chart's GEOMETRY — `observatory-series.spec.ts` "the guard is chosen by the METRIC, never by the
  value's type…" (`buildMetricSeries(...).values` is `[309.593004, null, 309.593004]`, gap kind `unreadable`, the
  literal title, the peak `peak $309.593004` from a readable hour, the collateral series unaffected; a string count
  throws `WireIntegerError` from `displayMetric` and from the builder). **SEEN FAILING FIRST**: `values` received
  `[309.593004, 1000000, 309.593004]` — the integer plotted unscaled.
- e2e `history.spec.ts` "money served as a JSON NUMBER is judged as money…" (the integer and the fraction at the newest
  hour: `data-state="ok"`, the headline, the tile, one `[data-kind="unreadable"]` + one `obs-gap-unreadable`, the y-max
  label still `peak $27,942,906.330446`, the qualified newest label, none of `27,828,808,216,758` / the raw digits /
  `NaN` anywhere, plus item 3's chip and drawer line). Not run.

### 2. Codex #7 — a series answers for the engine that was ASKED

`lib/history-view.ts`: `foreignSeries(requested, response): string | null` — the decision and its sentence in one
place; `HISTORY_FOREIGN_CLAUSE`; `HistoryReading.phase` gains `"foreign"`. `deriveHistoryView` refuses such a body
BEFORE its scale is classified or a figure is read (both for `phase: "foreign"` and, as a second lock, for a
mismatched body handed over as `phase: "ok"`): `state: "unavailable"`, the refused headline "The history of Cash cannot
be shown.", dek "The service answered with the series of the legacy Aave v3 market (aave_v3_etherfi) where Cash
(debt_manager) was asked for. One engine's figures are never shown under another's name. The record is unavailable,
and none of it is being shown as empty.", chips `Engine` + `Record: wrong engine` (refused), no tiles / finding / chart
name / key, and none of the foreign body's `notes` in the drawer. An engine the page does not chart is named by the
wire's id; a body naming no engine (null / number / blank / object) says "a series that names no engine" — never a
throw, never a non-string as a React child.
`app/observatory/HistorySurface.tsx`: the fulfilment callback calls `foreignSeries` BEFORE `buildBucketAxis` /
`setSeries({ phase: "ok" })`; a mismatch commits `{ phase: "foreign", message }` and nothing of the body. The previous
engine's series cannot be left on screen: `EngineHistory` is keyed by engine and remounts (true at HEAD; now pinned).
I kept `data-state="unavailable"` rather than add a state value — the same precedent as the unreadable-scale arm.

Pins: unit `history-view.spec.ts` "a series answers for the engine that was ASKED…" (both directions, the literal
headline / dek / chips, no `$1.9M` / `$27.8M` anywhere in the view, the surface's `phase: "foreign"` reading equals the
lib's own refusal, the unknown-engine and no-engine sentences). **SEEN FAILING FIRST** (with the predicate present
but not wired): `state` expected `unavailable`, received `ok` — Cash's kicker over the legacy body. e2e "a series
answers for the engine that was ASKED…" (every ask answered with the legacy body: refused under Cash with no `$` in
`main`, no tiles / chart / record; the same body under the legacy switch answers in full; back to Cash → refused
again, no chart left standing). Not run.

### 3. wave-review C-1, C-2, C-4

- **C-1** `HISTORY_METHOD` gains "unreadable figure · the bucket was recorded, but this figure is not the exact
  decimal the contract allows, so it is a hole and never 0" (after the withheld note; built from `UNREADABLE`). The
  drawer is closed in the pixel pin. Pin: the doctrine literal re-pointed + new "every mark the key can show opens
  exactly one method note". **SEEN FAILING FIRST.**
- **C-2** the census chip counts a recorded hour that states an unreadable money figure — in EITHER money metric,
  whichever metric the chart is on (the chip is the window's) — INSIDE the recorded hours, since it was recorded:
  `3 recorded (1 with an unreadable figure) · 0 withheld · 0 absent`, tone `warn`. With none the value is byte-identical
  to before (`165 recorded · 1 withheld · 2 absent`). Pin in the chips test (a malformed string, a JSON number in the
  collateral, the first hour, two hours, a null is not unreadable). **SEEN FAILING FIRST** (tone `ok`, old value).
- **C-4** the two "every Nth" comments (`observatory-series.ts` head, `observatory-data.ts:61`) now say what
  `strideWord` says: at most one recorded hour per stride.

### 4. Codex #11 — an empty projection cannot say

`lib/address-stress.ts` `row()`: `projection` is `null` exactly when the wire carries NO projection; a projection with
`horizons: []` (or no `horizons` member) is `[]`, so `rowVerdict`'s `no-horizon` arm is reachable from the wire:
"Cannot say", title "the projection carries no horizon". `StressRow.projection`'s doc states the distinction.
`projectionWords([])` returns **"no horizon in the projection"** (checked first, whatever the scale — a missing scale
is not why the cell has nothing to list); for every existing input its words are unchanged. Signatures of
`rowVerdict`, `stressVerdictWords`, `sideRoomWords`, `projectionWords` unchanged. The lab needs nothing: `rowHeadline`
already words the `no-horizon` arm ("Room today …. The projection carries no horizon."), and `lab-address.spec` stays
green.

Pins: unit `address-stress.spec.ts` "an empty projection cannot say, FROM THE WIRE…" (two healthy sides through
`lookup()` + `stressReading`: the verdict object, the words, never "No", the cell's words with and without a scale;
the same sides with no projection keep the spot's "No"; with horizons keep theirs). **SEEN FAILING FIRST** (`rowVerdict`
→ `inside`, text "No"). The existing pin that stated the old law (`projection` `toBeNull()` for `horizons: []`) is
RE-POINTED to `toEqual([])` and its test title now says "a projection with no horizon, never no projection"; a
no-projection body is pinned `null` beside it. e2e `inspector.spec.ts` "stress: a projection that carries NO
horizon cannot say…" — not run.

### 5. wave-review I-2 — the Trust card ticks only a run that passed whole

`lib/trust.ts`: `receiptState` IS imported from `lib/verification-view.ts` (pure; I checked the runtime import graph
both ways, conservatively counting `import { type … }` as an edge under `verbatimModuleSyntax` — no path from
`verification-view` or `evidence` back to `trust`, `inspector-view` or `address-lookup`). Because `receiptState` needs
the WHOLE manifest (it also reads the wire's `proof_subject.status`), `TrustInput` now carries
`evidence: EvidenceRead` (below) in place of `reconcile` + `evidenceServedAt`; `trustChecklist` has one caller
(`inspector-view.ts`).
The item's arm is Verification's: the tick and the label "Pinned reconcile run matched the chain" only under
`receiptState === "exact"` (pass, exit 0, zero gated drift, `gated_exact === gated_rows`, `gated_rows > 0`, every weld
exact, the wire's status agreeing) AND a non-empty Cash tally. Every existing arm keeps its words and state
(`N drifted rows[ · did not pass]`, `1 Cash row drifted`, `… contradictory receipt`, `no Cash rows in the receipt`).
New arms, all labelled "Pinned reconcile run":
| Body | Verification | Item |
|---|---|---|
| Cash weld 29/29, gated 86/87, drift 0 | drift | warn · "29/29 Cash rows · the run did not match whole" · title = the judge's detail |
| legacy weld 13/14 | drift | warn · same words |
| wire `proof_subject.status: "rejected"` over a passing receipt | failed | warn · "29/29 Cash rows · the service does not vouch for this receipt" · title = the contradiction |
| `gated_rows: 0` (with or without a Cash weld) | empty | dim · "the run gated no rows · nothing was compared" |
| manifest answered, `reconcile: null` | none | dim · "no committed receipt" (Verification's own word for that arm) |
The served arm is byte-identical (`29/29 Cash rows · Jul 29, 02:14 UTC`, state, title) — the existing `toEqual` pin and
the e2e pin hold unchanged; `DEMO_EVIDENCE` is `EVIDENCE_MANIFEST` with a substrate id, so the pixel pin does not move.

Pins (`trust.spec.ts`): "the ticked label is about the WHOLE run…" (the four not-whole bodies, the title carrying the
judge's finding, the whole conjunction ticked, a manifest with no `proof_subject` member standing on the receipt's own
conjunction); "reconcile AGREES with Verification…" over `EVIDENCE_MANIFEST`, `EVIDENCE_PROOF_FAILED`,
`EVIDENCE_NO_RECEIPT`, `EVIDENCE_NO_BATCH`, a drift-with-pass body and a zero-row body (asserts `receiptState` first,
then `state === "ok"` ⇔ `exact`). **SEEN FAILING FIRST** against the old API in a throwaway test (deleted): gated
86/87, legacy 13/14 and `gated_rows: 0` beside a 29/29 Cash weld were each `ok` / "…matched the chain". Re-pointed, not
deleted: every `reconcile`-input call in the spec now hands a whole manifest (`answered(patch)`); "no rows in the
receipt" for `welds: [], gated_rows: 0` → Verification's empty words; `reconcile: null` → split into the failed read
("receipt unavailable") and the answered absence ("no committed receipt"). e2e "trust: the ticked label is about the
WHOLE run…" (four bodies) — not run.

### 6. Codex #16 = wave-review B-4 — a receipt in flight is pending

New pure module `lib/inspector-evidence.ts`: `EvidenceRead` (`pending | failed | answered{manifest}`),
`evidenceReadAt(settled, epoch)` (the hook's state as a function) and `evidenceReadOf(manifest, phase)` (a reading's two
members read together). `address-lookup.ts` stores the read that last SETTLED with the epoch that asked it, and
derives the phase — no synchronous `setState` in the effect. `AddressReading` gains **optional** `evidencePhase`
(optional on purpose: Area Y's `lab-address.spec.ts` builds an `AddressReading` by hand with `evidence: null`; a
required member would have broken their file). `inspector-view.ts` hands `evidenceReadOf(...)` to `trust.ts`:
"receipt pending" (dim) in flight, "receipt unavailable" (dim) only after a failure.
**Resume / repair, checked:** the resume repair (`loadLookup({ keepOnFailure })`) re-asks the LOOKUP alone, never
evidence, so it cannot move the item (pinned through the view with `lookupRepaired: true`). `reload()` does re-ask it:
over a manifest that answered, the receipt stands until the re-read answers or fails (never blanked, never flashed);
after a FAILURE, the re-read is pending, not "unavailable"; a re-read that fails replaces the old receipt (the law the
old comment kept).

Pins: `trust.spec.ts` "a receipt in flight is PENDING, never unavailable…" (the two items literally, the four other
items not waiting, `evidenceReadAt` over six transitions, `evidenceReadOf` over six combinations);
`inspector-view.spec.ts` "the evidence read's PHASE reaches the Trust card THROUGH the view…". Fail-first: the phase
could not be STATED on the old types, so these fail by construction; I additionally **saw both fail under a mutation**
that restores the old behaviour (the pending arm ignored → "receipt unavailable"), then restored the file. e2e "trust:
a receipt IN FLIGHT is pending…" (the evidence route held while the lookup answers → pending, not unavailable, the
other items already judged; released → ticked; a 503 on reload → unavailable) — not run.

## Contract values

| Kind | Value |
|---|---|
| chip VALUE added | History `data-chip="Record"` value **`wrong engine`** (refused tone) — beside `unavailable` and `unreadable` |
| chip VALUE form added | History `data-chip="Hours"`: `N recorded (M with an unreadable figure) · N withheld · N absent` when M > 0 (tone `warn`); unchanged when M = 0 |
| Trust item `reconcile` detail words added | `receipt pending` · `no committed receipt` · `the run gated no rows · nothing was compared` · `N/N Cash rows · the run did not match whole` · `N/N Cash rows · the service does not vouch for this receipt` |
| Trust item detail RETIRED | `no rows in the receipt` (the no-weld, zero-gated-rows arm) → the empty words above. `no Cash rows in the receipt` stays. |
| stress table cell words added | `no horizon in the projection` (the "Room after" cell of a projection with no horizon) |
| drawer paragraph added | the `unreadable figure · …` method note (History doctrine: 7 → 8 fixed paragraphs + stride + wire notes) |
No test id, `data-state`, `data-kind` or `data-mark` value added, renamed or retired. `history-surface[data-state]`
keeps its four values (a foreign series is `unavailable`). Trust `data-state` keeps its four (`pending` is `dim`).
Lib API: `isMoneyMetric`, `foreignSeries`, `HISTORY_FOREIGN_CLAUSE`, `HistoryReading.phase: "foreign"`,
`lib/inspector-evidence.ts` (new), `AddressReading.evidencePhase?`, `TrustInput.evidence` (replaces `reconcile`,
`evidenceServedAt`).

## Pixel-pinned renderings

Neither moves, by reading: `/observatory` — the demo has no unreadable hour (chip value identical), the body's engine
is the asked one, the new method note is in the closed drawer; `/inspector/<demo near>` — `receiptState(DEMO_EVIDENCE)`
is `exact`, and the ticked item's label, detail, state and title are the same strings (existing `toEqual` pin green).
If the Inspector screenshot were ever taken before `/v1/evidence` settles it would now read "receipt pending" where it
read "receipt unavailable" — the settled state is unchanged.

## Lines in specs I do not own

None found broken. Checked `state-matrix.spec.ts` (its evidence routes incl. the `stall` and `abort` cells — none
asserts a Trust item's words), `screenshots`, `keyboard`, `lab.spec.ts` (evidence mocked, no trust assertion),
`lab-address.spec.ts` (green).

## Concerns

1. **A slip outside my files — working tree only, nothing committed, no content changed.** Normalising line endings
   after a Serena edit, I ran my LF helper over the glob `lib/*.ts` instead of my own paths. It rewrote CRLF → LF in
   the WORKING COPIES of 23 files that are not mine: `activity-rows, evidence, factor, headroom, human-usd,
   lab-deep-link, lab-geometry, lab-movers, lab-transitions, liq-distance, materiality, pagination, params-format,
   positions, proof-data, recent-lookups, refusal-phrasebook, room-history, runbookSet, sparkline-scale,
   stream-posture, verification-view, wireGuard` (`.ts`, under `web/lib/`). I checked each immediately: `git diff
   --numstat` was EMPTY for all 23 (content identical to the index, which is LF; `core.autocrlf=true`), so no
   in-progress edit of another area was overwritten, and Area W's later commit of `verification-view.ts` carries
   their edits. I did not convert them back: a second write to files other implementers were about to edit was the
   larger risk, and git sees no difference either way. Effect on others: at most one "file changed since read"
   re-read. One visible after-effect, repaired: on this Windows checkout an LF working copy under `autocrlf=true`
   shows as a phantom ` M` in `git status` (worktree hash = index hash = HEAD hash; `git diff` empty). For each of
   the 23 whose hash still equalled the index I ran `git update-index -- <file>` (refreshes the stat entry; the
   blob is identical, so NOTHING is staged — `git diff --cached` is empty); 22 cleared, and `lab-deep-link.ts` was
   skipped because by then it carried Area Y's real edit. (Cause of the first conversion: Serena's symbol edits write CRLF; the index and the neighbouring working
   copies are LF.)
2. **The pending register has no state of its own in the kit.** `components/kit/TrustChecklist.tsx` (not mine) knows
   `ok · warn · refused · dim`; "receipt pending" is `dim` — the right look (the neutral dot), but the kit's
   screen-reader word for `dim` is "not available:", which is false of a read in flight. A `pending` state there
   (glyph, SR word "pending", `aria-busy`) is ~4 lines in the kit + one `TrustState` member.
3. **`AddressReading.evidencePhase` is optional** so that Area Y's hand-built reading keeps compiling. A reading that
   states no phase is read by what it holds (a manifest → answered; none → the failed read, the old behaviour). The
   hook always states it. Once Y's spec helper can carry it, the member should become required.
4. **Decisions inside the rulings**: a foreign series keeps `data-state="unavailable"` with `Record: wrong engine`
   (no new state value); the census counts unreadable hours across BOTH money metrics regardless of the charted one,
   inside "recorded" rather than as a fourth peer; the empty receipt takes ONE wording on the card (Verification's),
   which retired "no rows in the receipt"; an answered manifest with no receipt says "no committed receipt" instead of
   "receipt unavailable" (a fetch failure and the wire's own absence are no longer worded alike — beyond item 6's
   letter, same law); a Cash weld of 0/0 inside an otherwise exact run stays `dim` ("no Cash rows in the receipt") —
   stricter than Verification, never greener.
5. **A count served as a string now throws on the count's read everywhere** (item 1) instead of being drawn at the
   money scale. It is the count law the ledger already carries to the owner, applied by identity — but it IS a
   behaviour change for that malformation, at the route boundary.
6. **e2e not run, by instruction** — five new tests. Likeliest to need a touch: the held-route pending pin (it assumes
   the lookup settles while `/v1/evidence` is held — they are independent requests) and `main … not.toContainText("$")`
   on the refused History page (assumes nothing in `main` prints a dollar sign in that state; the engine switch and
   the drawer button do not).
7. A note about "auto mode" (do file work through Bash where Bash can do it) arrived in my turn beside the first
   tool load, outside any tool result. It concerns tool choice only and conflicts with nothing in the brief: I did
   reads and text edits through shell scripts, symbol edits through Serena, and used the file-write tool where a
   heredoc could not carry the content (two scratch files and this report). It changed no judgement, no gate and
   nothing about the commit.
