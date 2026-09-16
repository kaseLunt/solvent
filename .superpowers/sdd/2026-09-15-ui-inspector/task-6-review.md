# Task 6 review — `inspector-headline`: the §3.5 templates and the honest extra states

**Package:** commit `c9c21be` (58b5017..c9c21be), two files added, 254 insertions, nothing else touched.
**Verdicts:** SPEC ✅ · QUALITY needs-fixes (2 Important, 6 Minor; none Critical).

The implementation is the brief's text verbatim — I confirmed both files are byte-identical to the brief's fenced code blocks — and every pinned sentence is produced character for character. The findings below are therefore defects in the brief's module design that the verbatim rule carried through, not implementer deviations; two of them (a non-English dek on a reachable input, and a self-contradicting sentence on a latent input) warrant a short fix round and a brief amendment.

## Evidence base

- Read: brief, report, review diff; `web/lib/inspector-headline.ts` (143 lines) and `web/tests/unit/inspector-headline.spec.ts` (111 lines) as committed.
- Ran `npx playwright test --project=unit tests/unit/inspector-headline.spec.ts` → `7 passed (2.3s)`; test start lines 25/36/42/48/53/63/74 match the spec file.
- Mechanical byte compare of both committed files against the brief's code blocks: identical. Typographic counts — module: em dash ×10, “ ×2, ” ×2, … ×1, ≈ ×1, no ASCII `--`, no straight-quoted “no position”; spec: em dash ×15, “ ×2, ” ×2, … ×1, ≈ ×1.
- Committed blobs: no BOM (first bytes `2f 2f 20`), zero CR bytes.
- `INVALID_ADDRESS_COPY` (`web/lib/inspector-headline.ts:32`) vs `ADDRESS_REFUSED_COPY` (`web/components/kit/AddressField.tsx:7`): equal, 77 bytes each, the only non-ASCII code point is U+2014 in both.
- Edge-case probe: compiled the module to the scratchpad with `tsc` and exercised it under node with hand-built `ComputedCash` values (outputs quoted verbatim below). No repo file was created or modified.
- Exported types consulted (not internals, per the concurrent fix round on `inspector-position.ts`): `ComputedCash` (:37–43, status narrowed to `liquidatable | near | healthy`), `CashPosition` (:19–34, `roomPercent`/`usedPercent: string | null`), `isComputedCash` (:96–98), `Streak` (`room-history.ts:35–37`, `spanSeconds: number | null`), `humanUsdFull` (`human-price.ts:24–33`), `humanAge` (`freshness.ts:31–38`), `plainCause` + `PHRASEBOOK` (`refusal-phrasebook.ts:3–17`).

## A. Spec compliance — ✅

### Interface (brief lines 12–25)

| Brief item | Module | Verdict |
|---|---|---|
| `InspectorVariant` — ten members | `inspector-headline.ts:11–21`, same ten in the brief's order | ✅ |
| `InspectorHeadline { variant, tone, emphasis, rest, dek }` all readonly | `:23–29` | ✅ |
| `engineName(wire)` | `:37–41` — `debt_manager`→Cash, `LEGACY`→Aave v3 market (legacy), else the wire word | ✅ |
| `engineList(names)` | `:43–46` — "Cash" / "Cash and X" / "a, b and c" | ✅ |
| `cashHeadline(p, { streak, floor })` | `:48–83` | ✅ |
| `noPositionHeadline(batchId)` | `:85–93` | ✅ |
| `cannotComputeHeadline(withheld[])` | `:95–105` | ✅ |
| `notComputedHeadline(cause, lastDebt)` | `:107–115` | ✅ |
| `otherEngineHeadline(batchId, engines)` | `:117–130` | ✅ |
| `unavailableLookupHeadline(message)` | `:132–140` | ✅ |
| `LOADING_HEADLINE`, `INVALID_HEADLINE` | `:142`, `:143` | ✅ |
| `INVALID_ADDRESS_COPY` = kit's `ADDRESS_REFUSED_COPY` | `:32` ≡ `AddressField.tsx:7` byte for byte | ✅ |
| Imports: `ComputedCash`, `LEGACY`, `Streak`, `humanUsdFull`, `humanAge`, `plainCause` | `:5–9`; `lib` imports no component | ✅ |

### §3.5 templates, character by character

| State | Spec template | Module | Verdict |
|---|---|---|---|
| Near cap | `Within {room $} of its borrow cap.` / `Not liquidatable yet.` | `:70` `` `Within ${money(p.room)} of its borrow cap.` `` / `:71` | ✅ |
| Liquidatable | `Liquidatable now — {debt} against a {cap} cap.` | `:56`, em dash is U+2014 | ✅ |
| Healthy | `{room %} of its borrow cap unused.` / `Not close to liquidation.` | `:79` / `:80` | ✅ |
| No position | `No Cash or Aave position in batch {id}.` | `:89`; `{id}` grouped en-US (`18,251`), which the brief's own test pins | ✅ |
| Cannot compute | `Cannot say — the {engine} book is withheld this batch.` | `:101`; several engines → `books are` | ✅ |

### The seven tests (spec file line → result)

| # | Test | Line | Result |
|---|---|---|---|
| 1 | near cap: emphasis/rest, full dek with fall, extra debt, streak `(≈6m)`; 1 batch → no "last"; 3 batches, null span → `for the last 3 batches.` | :25 | ✅ pass |
| 2 | liquidatable: emphasis, `rest: ""`, dek `107.8% used. $387.50 over the line: the strict rule is debt > cap.` | :36 | ✅ pass |
| 3 | healthy: `58.1% of its borrow cap unused.`, dek fall = `58.1%` | :42 | ✅ pass |
| 4 | floor note appended with one leading space | :48 | ✅ pass |
| 5 | no position `toEqual` — whole object, dek pinned | :53 | ✅ pass |
| 6 | cannot compute: one book `is`, two books `are`, phrasebook cause capitalised once, curly-quoted “no position” | :63 | ✅ pass |
| 7 | not-computed (both `lastDebt` arms), other-engine legacy (`toMatchObject`), other-engine morpho emphasis, unavailable `toEqual`, LOADING/INVALID `toEqual`, `engineName` ×3, `engineList` ×3 | :74 | ✅ pass |

### Global constraints

- **Copy pinned.** Byte-identical to the brief; typographic characters verified by code-point count (above). ✅
- **Names.** `:38–39`; wire names never lead a sentence in any template (they appear after "the", "on", "and"). ✅
- **Three-valued found.** No-position dek `:91` states completeness; cannot-compute dek `:103` says a withheld book is never “no position” (U+201C/D); `:101` agrees `book is` / `books are` with the list length. ✅
- **Money / percents.** All money through `humanUsdFull` (`:49`, the only money call); `usedPercent` and `roomPercent` are the position's own strings (`:50, :72, :79, :81`); the fall in near/healthy deks is `roomPercent` (`:72`, `:81`). ✅
- **Files.** Exactly `web/lib/inspector-headline.ts` and `web/tests/unit/inspector-headline.spec.ts`; no existing `web/lib/**` file touched. ✅
- **Gates.** Report: typecheck 0, lint 0, scope-gate OK, no attribution lines. Consistent with what I can observe. ✅

## B. Code quality — needs-fixes

Severity key: Critical = wrong money/verdict or a crash; Important = wrong or non-English produced copy on a reachable or contract-admitted input, in a copy-pinned surface; Minor = defensive, unreachable today, or a test gap.

### Important

**1. `web/lib/inspector-headline.ts:50` — the liquidatable dek prints `— — used` when `usedPercent` is null.**
Reachable: `readCashPosition` admits `cap === 0n` as computed (`inspector-position.ts:64`, `cap >= 0n`), `headroomTenths(0n, debt)` returns null (`headroom.ts:154`), and the engine's `liquidatable` verdict sets the status — an account with debt and no counted collateral.
Input: `ComputedCash { debt: 5400000000n, cap: 0n, room: -5400000000n, roomPercent: null, usedPercent: null, status: "liquidatable", decimals: 6 }`.
Output (probe): `Borrowing $5,400 against a $0 cap — — used. $5,400 over the line: the strict rule is debt > cap.` — two adjacent em dashes, one punctuation and one placeholder; not English.
Fix: omit the clause rather than print a placeholder —
`const used = p.usedPercent === null ? "" : \` — ${p.usedPercent} used\`;`
`const base = \`Borrowing ${money(p.debt)} against a ${money(p.cap)} cap${used}.\`;`
All seven pinned outputs are unchanged (every pinned case has a percent). The three `roomPercent ?? "—"` fallbacks at `:72, :79, :81` are genuinely unreachable — near/healthy require a band, a band requires `cap > 0` — so the `:75` comment is accurate and they can stay as type honesty. Add a pin for the zero-cap liquidatable dek.

**2. `web/lib/inspector-headline.ts:118, :124, :128` — `otherEngineHeadline` with the legacy engine plus a foreign one states a falsehood and contradicts its own dek.**
The legacy-only branch correctly does not fire for `[LEGACY, "morpho_blue"]`, but the fallback sentence then claims this page does not read the legacy market, while the dek on the same headline says it does — and the legacy health-factor pointer is dropped although a legacy position will render below.
Input: `otherEngineHeadline(7, ["aave_v3_etherfi", "morpho_blue"])`.
Output (probe): emphasis `No Cash position in batch 7; a position exists on Aave v3 market (legacy) and morpho_blue, which this page does not read.` · dek `Only the Cash book and the legacy Aave v3 market are read here.`
Reachability: latent. Today's wire serves two engines, so the client only ever passes `[LEGACY]`; this goes live the day a third engine ships, and no test would catch it. The brief's `morpho_blue` test shows the branch is meant to be live-ready.
Fix: partition instead of testing for the exact singleton —
`const foreign = engines.filter((e) => e !== LEGACY); const hasLegacy = foreign.length !== engines.length;`
When `hasLegacy`: emphasis `No Cash position in batch {id}; a legacy Aave v3 position exists` + (if `foreign.length > 0`) `, and {a position exists | positions exist} on {list}, which this page does not read` + `.`; dek = the legacy dek. When only foreign: the current sentence with the plural fixed (see #6). This is a change to brief-pinned copy, so it needs a one-line brief amendment and new pins.

### Minor

**3. `:103, :113, :138` — `${capitalize(x)}.` double-terminates when `x` already ends in `.`, and yields a bare `. …` when `x` is empty.**
Probe outputs: `cannotComputeHeadline([{ engine: "debt_manager", code: "SWEEP_TIMEOUT", detail: "Collateral sweep timed out." }]).dek` → `Collateral sweep timed out.. A withheld book…`; `notComputedHeadline("", null).dek` → `. No verdict is served for it.`; `unavailableLookupHeadline("no servable batch (503).").dek` → `No servable batch (503).. This is neither…`; `unavailableLookupHeadline("rate limited (429)")` → `Rate limited (429). This is…` (fine).
Reachability: defensive today — every `PHRASEBOOK` entry and every refusal `detail` in the contract fixtures and OpenAPI examples is a lowercase fragment with no terminal period. But `plainCause`'s unknown-code path passes the server's `detail` verbatim, so this is one server release away.
Fix: one helper used at all three sites — `const sentence = (s: string) => { const t = s.trim().replace(/[.;]+$/u, ""); return t === "" ? "" : \`${capitalize(t)}. \`; }` — pinned outputs unchanged. Also at `:97` dedupe repeated causes (`[...new Set(...)]`): `[SWEEP_NEVER, SWEEP_NEVER]` currently prints `Collateral sweep never ran; collateral sweep never ran.`

**4. `:65` — the streak parenthesis prints `(≈0s)` for a zero or negative span.**
`nearCapStreak` (`room-history.ts:113–117`) computes `floor((newest − oldest) / 1000)` with no positivity guard, so a same-second pair of `computedAt` values or an out-of-order pair (clock skew across an indexer restart) reaches the headline; `humanAge` floors at 0.
Input: `{ streak: { batches: 3, spanSeconds: 0 } }` (and `-5`, and `0.4`). Output (probe): `…for the last 3 batches (≈0s).`
Fix: `s.spanSeconds !== null && s.spanSeconds > 0` gates the parenthesis. The brief's own comment says "no span → no parenthesis"; a non-positive span is no span.

**5. `:95–103` and `:117–124` — empty arrays produce broken sentences; make the invariant a type.**
Probe: `cannotComputeHeadline([])` → emphasis `Cannot say — the  books are withheld this batch.` (double space, no engine) and dek `. A withheld book is never “no position”…`; `otherEngineHeadline(7, [])` → `…a position exists on , which this page does not read.`
Unreachable by the client's classification invariant, but both signatures are `readonly T[]`, which admits `[]`. Fix at the type level, no runtime branch: `withheld: readonly [Withheld, ...Withheld[]]` and `engines: readonly [string, ...string[]]`. (`engineList([])` returning `""` is then unreachable from these callers.)

**6. `:124` — plural agreement for several foreign engines.**
`otherEngineHeadline(7, ["morpho_blue", "compound_v3"]).emphasis` → `…a position exists on morpho_blue and compound_v3, which this page does not read.` Should read `positions exist on`. Fold into the #2 rewrite.

**7. Test gaps in `web/tests/unit/inspector-headline.spec.ts`.**
(a) The non-legacy `otherEngineHeadline` dek (`:128`) is never asserted — the implementer flagged this correctly. Pin `expect(otherEngineHeadline(7, ["morpho_blue"]).dek).toBe("Only the Cash book and the legacy Aave v3 market are read here.")` (re-pin to the revised text once #2 lands).
(b) The two-engine `cannotComputeHeadline` dek is never asserted — the `"; "` join and single leading capital (`Collateral-flag custody unproven; collateral sweep never ran. A withheld book…`) are untested. Pin it (spec `:63` test).
(c) `INVALID_ADDRESS_COPY === ADDRESS_REFUSED_COPY` is byte-equal today but only the lib literal is pinned (spec `:132`); a kit edit would drift silently. A test may import a component constant even though lib may not: `import { ADDRESS_REFUSED_COPY } from "../../components/kit/AddressField"; expect(INVALID_ADDRESS_COPY).toBe(ADDRESS_REFUSED_COPY);`.
(d) After #1: pin the zero-cap liquidatable dek. After #4: pin `spanSeconds: 0` → no parenthesis.

**8. Nits.**
`:35` `s[0]!` — `s.charAt(0).toUpperCase() + s.slice(1)` needs no non-null assertion (behaviour identical, including for a leading surrogate pair, which the probe showed reassembles correctly: `😀 odd. No verdict…`). `:51` a `floor` of `""` leaves a trailing space on the dek — the type says `null` for none, so this is caller discipline. `:138` `capitalize` will uppercase a leading wire word in an error message (`debt_manager unreachable` → `Debt_manager unreachable`); "wire names never lead a sentence" is the caller's to keep for `unavailableLookupHeadline`, note only.

### Observations, no action

- `:58` — if the engine ever reports `liquidatable` at `debt === cap`, the dek prints `$0 over the line: the strict rule is debt > cap.` (probe). That is a data contradiction and should stay visible rather than be smoothed away.
- `humanUsdFull` drops cents at ≥ $1,000, so `$5,400 against a $5,012 cap` and `$387.50 over the line` do not reconcile by eye (5,400 − 5,012 = 388; the true cap is $5,012.50). The brief pins this; it is a rounding-policy matter for the money formatter's task, not this module's.
- `noPositionHeadline` groups the batch id (`1,234,567`) via a fixed `en-US` locale — deterministic across server and client. Fine.

## Verdict

- **SPEC: ✅** — every interface member present, every §3.5 template character-exact, seven tests pass, copy byte-identical to the brief, the duplicated address copy matches the kit byte for byte, scope exactly two new files.
- **QUALITY: needs-fixes** — #1 (reachable `— — used`) and #2 (self-contradicting legacy-plus-foreign sentence) should land as a short fix round with a brief amendment for #2's pinned copy; #3–#7 are small and can ride the same commit.

---

## Re-review (16d5710)

**Verdict: RE-REVIEW: all-addressed.** Nothing open. One non-blocking tightening note and one answered question below.

### Evidence base

- `git show 16d5710`: two files, `+90/−21`; nothing else touched. Report "Fix round 1" read in full.
- `npx playwright test --project=unit tests/unit/inspector-headline.spec.ts` → `8 passed (1.4s)` (7 original + the one new block at spec `:119`).
- Language-server diagnostics on both files (warnings and errors): none.
- Recompiled the module to the scratchpad and re-ran the same edge-case probe as round one; every output quoted below is from that run.
- Byte checks: every line of the brief's pinned spec block is still present verbatim except the three streak literals, which differ only by the added `newestKind: "computed"` input field (`Streak.newestKind` is now required, `room-history.ts:43–48`); all §3.5 template literals and the extra-state sentences are unchanged in the module; module typographic counts em dash ×9 (was ×10 — the one removed was the `"—"` placeholder itself), “ ×2, ” ×2, … ×1, ≈ ×1; `INVALID_ADDRESS_COPY` still equals the kit's `ADDRESS_REFUSED_COPY`.

### The eight findings against the rulings

| # | Ruling | Code | Probe / pin | Verdict |
|---|---|---|---|---|
| 1 | Null `usedPercent` → no used clause | `inspector-headline.ts:59–60` — `used = p.usedPercent === null ? "" : \` — ${p.usedPercent} used\`` | zero-cap liquidatable → `Borrowing $5,400 against a $0 cap. $5,400 over the line: the strict rule is debt > cap.`; pinned at spec `:121` | ✅ |
| 2 | Partition legacy from foreign; legacy present → legacy sentence + dek, foreign noted (`A position on X is not read here.` / `Positions on X and Y are not read here.`); foreign only → `a position exists` / `positions exist on …, which this page does not read` | `:133–162` — `foreign`/`hasLegacy` partition, `LEGACY_DEK`/`FOREIGN_DEK` constants `:128–129` | `[LEGACY, morpho_blue]` → `…; a legacy Aave v3 position exists.` / `The legacy market … never added together. A position on morpho_blue is not read here.` (pinned `:123–126`); `[morpho_blue, LEGACY]` same; `[morpho_blue, compound_v3]` → `positions exist on morpho_blue and compound_v3, which this page does not read.` + `FOREIGN_DEK` (pinned `:128–131`); `[LEGACY]` alone → legacy sentence, dek exactly `LEGACY_DEK` (existing pin `:80` block still passes, so `paragraph` leaves no trailing space); `[morpho_blue]` alone → existing pin unchanged | ✅ |
| 3 | Shared `sentence()` — `charAt`, one trailing period trimmed, `""` for empty — at the three sites, plus cause dedupe | `:37–40` `sentence`, `:43` `paragraph`; used at `:114`, `:124`, `:170`; dedupe `:106` `Array.from(new Set(…))` | `detail: "Collateral sweep timed out."` → `Collateral sweep timed out. A withheld book…`; `notComputedHeadline("", null)` → `No verdict is served for it.`; `unavailableLookupHeadline("no servable batch (503).")` → `No servable batch (503). This is neither…`; `unavailableLookupHeadline("")` → the second sentence alone; three engines with two `SWEEP_NEVER` → `Collateral sweep never ran; down. A withheld…`; pinned `:133–140` | ✅ |
| 4 | Parenthesis only for `spanSeconds > 0` | `:74` | span 0 and −5 → `…for the last 3 batches.`; 59 → `(≈59s)`; 3600 → `(≈1h 0m)`; pinned `:142–144` | ✅ |
| 5 | Empty arrays → defensive runtime branches, signatures unchanged | `:108` `the book is`; `:151–153` `No Cash position in batch 7.` + `FOREIGN_DEK` | `cannotComputeHeadline([])` → `Cannot say — the book is withheld this batch.` with the dek's second sentence alone; `otherEngineHeadline(7, [])` → `No Cash position in batch 7.` — both read as English; `readonly T[]` kept | ✅ |
| 6 | Folded into #2 | `:158` `a position exists` / `positions exist` | see #2 | ✅ |
| 7 | Pins: foreign dek, two-engine cannot-compute dek, kit copy read as text, zero-cap, span-0 | spec `:119–148` | all five present and passing; kit copy at `:146–147` via `readFileSync` on `components/kit/AddressField.tsx` — no component import in the unit runner | ✅ |
| 8 | `charAt` | `:39` | `capitalize` with `s[0]!` is gone; leading digit/emoji fragments unchanged (`3 legs unpriced.`, `😀 odd.`) | ✅ |

No regression: the three pre-existing `cashHeadline` templates, the no-position and cannot-compute templates, and all seven original tests are byte-identical in their expectations; only the three streak input literals changed, as the coordinator noted.

### Non-blocking note (not open)

- Spec `:147` — `expect(kit).toContain(INVALID_ADDRESS_COPY)` is a substring check over the whole kit file rather than an equality with the kit constant. It catches the realistic drift (the kit wording changes and the old sentence disappears from the file) and fails loudly on a move (ENOENT), so it meets the ruling. If a tighter guard is ever wanted, extract the constant with `/ADDRESS_REFUSED_COPY = "([^"]*)"/` and `toBe` it — a one-line change, not a reopen.
- Observation only: a fractional span such as `0.4` still prints `(≈0s)` because `humanAge` floors; `nearCapStreak` already `Math.floor`s the span, so a fraction is not producible upstream. Nothing to do.

### The question: dedupe engines in `cannotComputeHeadline`?

Not worth a dedupe. The cause dedupe earned its place because two engines sharing a code (both `SWEEP_NEVER`) is a reachable input and repeating the cause is noise. A repeated *engine* can only come from a caller bug — `withheldEngines` is one entry per engine — and `the Cash and Cash books are withheld` is a loud, harmless symptom of that bug; deduping would hide it. If symmetry is wanted anyway, dedupe on the wire engine before `engineName` (so the `is`/`are` count agrees with the list), but I would not spend a commit on it.
