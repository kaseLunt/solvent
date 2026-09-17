# Task 5 review: `lab-movers` and the ruled narrowing (fd1f27f..cf124d3)

### Spec Compliance

- ✅ Exports present: `MoverRow` (web/lib/lab-movers.ts:24), `MoversTable` (:36), `roomFromRatio` (:46), `moversTable` (:73), `moversCaption` (:116), `MoverEngine` (:22), `RunBookMover` (:15); `LaneEngine` (web/lib/lab-transitions.ts:17). `RunBookEngine` is local (:14) — the brief's "Produces" line never listed it; only its code block did; controller-accepted.
- ✅ The module body is the brief's code verbatim except the ruled parameter type `moversTable(engine: MoverEngine)` (:73) and the `MoverEngine` alias with its law comment (:17-22).
- ✅ R5 wire order: `engine.movers.map` (:79) — no sort, no filter, no dedupe; pinned by the account-order `toEqual` (spec:301-306).
- ✅ Rooms recomputed by hand against `percentTenths` (BigInt floor, web/lib/percent.ts:7-10) and `formatTenths` (drops a zero tenth, :12-18): 190,500,000×1000 ÷ 5,012,500,000 = 38 → `3.8%`; 500M×1000 ÷ 2,000M = 250 → `25%`; 300M×1000 ÷ 1,300M = 230 → `23%`; 400M×1000 ÷ 1,400M = 285 → `28.5%`; `10/4` → 600 → `60%`. Every after side (num×7 vs den×10) has `num < den` → `over cap`; `4/4` → `at cap`; `5/0` → `no debt`.
- ✅ Tiers: `materialityTier` lines are $100 and $1 in base units (web/lib/materiality.ts:4-5, 17-21): 4,822,000,000 @6 ≥ 100,000,000 → `material`; 50,000,000 ≥ 1,000,000 and < 100,000,000 → `small`; null debt → `tier: null` (lab-movers.ts:104). Rows stay counted (`shown: rows.length`, :114).
- ✅ Money register: `humanUsdFull` (web/lib/human-price.ts:25-34): 4,822,000,000 @6 → 482,200 cents → 4,822 dollars ≥ 1,000 → `$4,822`; 1,500,000,000 → `$1,500`; 50,000,000 → 5,000 cents → `$50` (rem 0). A null `debt_usd` never reaches it (`debtText = "—"`, :86-88).
- ✅ Legacy wads through the Book: `hfDisplayFromWad` = `truncateToDisplay(parseDecimal(wad), 18)` (web/lib/book-format.ts:140-142); `truncateToDisplay` divides by 10^15, keeps three fraction digits, truncates, trims trailing zeros (:129-137): 1,080,000,000,000,000,000 → 1080 → `1.08`; 756,000,000,000,000,000 → 756 → `0.756`. The pin change `"0.75"` → `"0.756"` is exactly what brief Step 4 sanctioned; the spec's comment (spec:357-358) states the law, not the round.
- ✅ Wire guards: `isWireDecimal` before every `BigInt` — both ratio sides checked before either converts (:58-61), debt (:90-91); `wad()` guards before `hfDisplayFromWad` (:66-70); `isWireScale` on `usd_decimals` refuses the whole table (:75-78); `isWirePopulation` on `movers_total` (:110-113). `WIRE_DECIMAL = /^-?[0-9]+$/` (web/lib/wireGuard.ts:22-27) refuses `"1e9"` and `"0x10"`; `isWirePopulation(-1)` and `isWireScale(1.5)` are false (:169-176, :46-54).
- ✅ `unreadable[]` names, exact: `movers[i].hf_before_num` / `_den`, `movers[i].hf_after_num` / `_den` (:58-60 via `${at}_num`), `movers[i].hf_before_wad` / `hf_after_wad` (:83-84), `movers[i].debt_usd` (:93), `movers_total` (:111), `usd_decimals` (:77). Push order is read order, and the pin fixes it (spec:382).
- ✅ Caption: `showing 4 of 118 accounts moved`, `showing 1 of 1 account moved`, `showing 1 account moved · total not stated` (:116-120; `groupInt` is `toLocaleString("en-US")`, web/lib/prose.ts:14-16); `movers_note` carried verbatim (:114, :77).
- ✅ Pins: the `roomFromRatio`, Cash and legacy tests are the brief's line for line (legacy: the one sanctioned value change plus a two-line law comment). The unreadable test's every `expect` is verbatim (spec:378-386 vs brief:130-138). The fixture rebuild is correct and necessary: the brief's own `mover("…", "1e9", …)` would have thrown `BigInt("1e9")` inside the spec helper (spec:267) before `moversTable` ran; the rebuild (spec:372) leaves exactly `hf_before_num` unreadable and the after side readable (`7000000000/10000000000` → `over cap`).
- ✅ Narrowing is type-only. lab-transitions diff = the `LaneEngine` alias + comment (:17-22) and two parameter annotations (`guards` :129, `laneReading` :278). Every `engine.` read in that file is `hf_transitions`, `before`, or `usd_decimals` (lines 131, 132, 134, 141, 142, 321, 340 — all inside `guards` or `laneReading`, the file's last declaration), so the Pick is exactly the read set and no third function was left on the wire type. lab-library diff = one call `laneReading(cash, { merge: true })` (:57) + its doc comment. `laneReading` never reads `projection`, so dropping the `{ ...cash, projection: null }` copy changes nothing observable.
- ✅ The sealed engine is assignable without a cast: `LabRunBookEngine = Omit<RunBookEngine, "projection"> & { projection: RefinedProjection | null }` (web/lib/runbook.ts:50-52); the six picked fields pass through `Omit` with their wire types.
- ✅ Spec typing: `RunBookMover.engine` is `type: string` (api/openapi.yaml:4800), so the spec helper's inferred `engine: string` fits `Partial<Engine>`; `cashEngine` defaults `usd_decimals: 6`, `legacyEngine` 8 (web/tests/unit/helpers/run-book-engine.ts:157-158) — the `t.decimals` pin of 6 is the helper's, not a manufactured one; `usd_decimals: 1.5` typechecks as `number`.
- ✅ `web/lib/**` untouched beyond the two ruled files; four paths in the commit (the diff's file list).
- ✅ Comments state the law in all four files; no round or task references.
- ⚠️ Cannot verify from diff: the "21 passed" run and the typecheck/lint exit codes (not re-run, per instruction). Every pinned value was recomputed by hand against the helpers' source and agrees with the module's arithmetic; the assignability argument is structural.

### Strengths

- The unreadable-test rebuild is the right kind of deviation: the implementer found that the brief's fixture failed in the scaffolding (`BigInt("1e9")` at spec:267), not in the module, isolated the malformed field to exactly `hf_before_num`, and kept every assertion verbatim so the pin still tests what the brief meant.
- `ratio()` (lab-movers.ts:55-62) evaluates both guards before converting either side and names each failing side on its own, so a row with two bad sides names both — this is stricter than a first-failure early return would be.
- `LaneEngine` and `MoverEngine` are exactly the read sets (verified line by line against every `engine.` access in lab-transitions.ts), and their comments say why the projection never crosses. The bridge in lab-library is gone rather than papered over.
- `hfBefore`/`hfAfter` on a Cash row and `roomBefore`/`roomAfter` on a legacy row are `null`/`—`, never a zero; `debt: bigint | null` keeps the raw value beside its text so a page can size without re-parsing.

### Issues

#### Critical (Must Fix)

None. No path lets a malformed value reach `BigInt` or print as a number; the two narrowed files change no behavior.

#### Important (Should Fix)

- **Plan-mandated shape, labeled so:** `moversCaption` on a scale-refused table returns `showing 0 accounts moved · total not stated` (lab-movers.ts:75-78 sets `shown: 0`, `total: null`; :116-120 captions it). That sentence reads as a computed claim ("0 accounts moved") when the truth is "the scale could not be read". It is the brief's own code (brief Step 3) and no pin covers the refused caption, so it is not an implementer error — but a page that calls `moversCaption` without first gating on `unreadable.includes("usd_decimals")` would print a zero-looking unknowable, which is the class Solvent's law forbids. Route to the controller: either the page brief must gate captioning on `unreadable`, or `moversCaption` refuses when the table was refused (one branch, one pin).

#### Minor (Nice to Have)

- **Controller concern 1 — half-null ratio pair (num set, den null → quiet `—`): deferred minor.** The server sets or nulls both sides together (`cmd/api/p5_runbook.go:1049-1056`: "An infinite side carries nulls rather than a stand-in"), so a half-null pair is out of contract, and the schema's "Null when that side has no debt" on `hf_before_num` (api/openapi.yaml:4812) describes the pair. The dash is an honest non-statement (no room can be stated from one side), not a manufactured number. A two-line improvement for a later round: when exactly one side is null, name the null side in `unreadable[]`.
- **Controller concern 2 — `"unreadable"` shares the `string` type with a real reading: deferred minor.** The brief's interface (`roomBefore: string`, `hfBefore: string | null`); `unreadable[]` is the designed signal and it is pinned. If the page needs to tone a cell (as the kit does, "a row is a value or a refusal by type", ff534e9), a value-or-refusal union on `MoverRow` would be the better shape; that is the page task's call, not this one's.
- **Controller concern 3 — `mover.engine` unchecked against the parent: deferred minor.** `MoverEngine` deliberately omits `engine` (lab-movers.ts:22), so the check cannot be added without widening the Pick; the server stamps each mover with the enclosing engine's id (p5_runbook.go:1044). Not in the brief.
- `roomFromRatio`'s `"unreadable"` arm (lab-movers.ts:51) is reachable only with a negative side (`percentTenths` returns null for `num ≤ 0`, percent.ts:8), and when reached it prints `unreadable` without naming a field. `WIRE_DECIMAL` admits a leading `-` by contract, so `roomFromRatio(5n, -4n)` would print `180%`. The server's rational is `big.Int` from nonnegative quantities, and every other `isWireDecimal` surface in the app admits the sign the same way, so this is the app-wide class, not this task's; a sign refusal naming the side would close it here.
- `decimals: 0` in the refused table (lab-movers.ts:77) is a stand-in scale forced by `decimals: number`. Nothing in this task formats with it (no rows), but a page must not print it for a table whose `unreadable` names `usd_decimals`. Brief's shape.
- The `no debt` arm (`den === 0n`, :47) is unreachable from this server: an infinite side is the null pair, which prints `—`. The arm is still correct law for a `den: "0"` and is pinned directly; noting so no one expects `no debt` to appear on the live page.
- `let total … if (!isWirePopulation(…)) { total = null }` (:110-113) reads as two steps for one decision; `const total = isWirePopulation(x) ? x : null` beside the push would be the same law in one line. Brief's code; polish only.

### Assessment

**Task quality:** Approved

**Reasoning:** The module is the brief's code with the ruled narrowing, every pin recomputes to the module's output by hand, all five deviations are correct and sanctioned, and the two touched lib files change only type annotations and one now-unnecessary object copy. The one Important item is the brief's own caption shape for a refused table, which the controller should route to the page brief (gate on `unreadable`) or accept as a one-branch follow-up here.

## Re-review 1 (88f0518)

Scope: `git show 88f0518` (parent a444953), two files: `web/lib/lab-movers.ts` (+8/−1) and `web/tests/unit/lab-movers.spec.ts` (+16). The working tree's two files are byte-identical to the commit and no later commit touches them (`git diff 88f0518 -- <both>` empty; `git log 88f0518..HEAD -- <both>` empty).

**1. Important — scale-refused caption: ADDRESSED.** `moversCaption` (lab-movers.ts:119-122) now opens with `if (t.unreadable.includes("usd_decimals")) return "not readable: unreadable scale";` before either counting branch. The key is exact: `usd_decimals` enters `unreadable[]` only through the refused return at :75-78, and the per-row path never pushes it, so the branch fires for a refused table and nothing else. Pinned on the existing `badScale` table (spec:136); the pin can fail — before this commit the same table captioned `showing 0 accounts moved · total not stated`. The three readable captions (spec:79, :112, :132) are untouched by construction (none of their tables name `usd_decimals`). The comment states the law ("0 accounts" would be a claim about the book). No consumer outside the module and its spec calls `moversCaption` or `moversTable` (grep across `web/`), so no downstream pin is broken.

**2. Minor (taken) — half-null ratio pair: ADDRESSED.** `ratio()` (lab-movers.ts:55-65) returns `—` only on `num === null && den === null`; otherwise each side meets `isWireDecimal`, whose `typeof value === "string"` check (wireGuard.ts:26) refuses `null`, so a lone null side is pushed as `${at}_den` / `${at}_num` (`movers[0].hf_before_den`) and the cell prints `unreadable` — the same path as any guard failure. The new pin (spec:139-152) is a Cash mover with `hf_before_den: null` and an after pair null together: `roomBefore` `unreadable`, `roomAfter` `—`, `unreadable` exactly `["movers[0].hf_before_den"]`; it can fail (before: `—` and `[]`). The legacy pin's both-null pairs still dash (spec:108). The comment states the law (a side with no debt is null on both sides together — matching `cmd/api/p5_runbook.go:1049-1056`).

**Typecheck, focused:** this commit makes the aliased-predicate narrowing load-bearing for the first time — before it, `num`/`den` were already `string` past the `||` early return; now `BigInt(num)` / `BigInt(den)` (:65) rely on `const n = isWireDecimal(num)` narrowing through `if (!n || !d) return`. `npx tsc --noEmit -p web` on the identical tree: exit 0, no output. Holds.

**New breakage in this diff:** none found. Comments state the law; no round references; nothing outside the two files.

Carried minors (not in this round's scope, unchanged): `"unreadable"` shares the `string` type with a reading; `mover.engine` unchecked; the app-wide signed-`WIRE_DECIMAL` admission; `decimals: 0` on a refused table.

**RE-REVIEW: closed.**
