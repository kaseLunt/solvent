# mutation transcript — phase 1 track A (p1a), reconciled at close (p1a-8)

- spec: `mutations.json`
- repo: `C:\Users\kasel\source\repos\etherfi\Solvent`
- **This is a RECONCILIATION, not a fresh loop.** Every mutant below was applied,
  observed killed IN ISOLATION, and reverted DURING ITS OWN TASK (p1a-1..p1a-6;
  p1a-0 and p1a-7 carried none — the wave-config task and the ledger-only
  convergence pass); no mutant was re-run at close. Sources of record, per
  mutant, are named in each section: the task reports
  (`.superpowers/sdd/2026-08-10-ui-overhaul-phase1-tracka/task-{1,2,3,4,5,6}-report.md`),
  the committed ledger (`.superpowers/sdd/progress-ui-overhaul.md` p1a
  sections), and the repo-root run logs `web-3820-p1a3-mut*.log` /
  `web-3820-p1a4-mut*.log` / `web-3820-p1a4b-mutM4.log` /
  `web-3820-p1a5-mut*.log` / `web-3820-p1a6-mut*.log` (tasks 1–2 kept no
  per-mutant root logs; their kills are recorded prose).
- **Tested SHAs (per task, each mutant at its own task's HEAD):**
  p1a-1 @ `5e3bb9e` · p1a-2 @ `9a8d628` · p1a-3 @ `fbcbae9` · p1a-4 @ `a9881f2`
  · p1a-4b @ `fa67289` · p1a-5 @ `5f43b2e` · p1a-6 @ `4ff851a`.
- **Anchor verification (done at close, HEAD after `4a0f27c`):** every `search`
  string in `mutations.json` — the fixed code each mutant attacked — was
  re-verified present in the current tree. All web sources are CRLF; every
  anchor is single-line or contiguous-line text, so matches are
  line-ending-convention independent. Recorded kill-assertion SPEC lines that
  have since drifted (p1a-4b and p1a-6 appended tests to `p1a-fixes.spec.ts`)
  are re-anchored below as `recorded :N → now :M`; production-file and
  unit-spec anchors were verified UNDRIFTED except where noted.
- transcript reconciled (UTC): 2026-08-10.

## p1a-1-M1 — `--ink-3` dark reverted to `#5f7178` in BOTH dark blocks

**Source of record:** task-1-report.md §Mutation kills; ledger §p1a-1.

**Property under attack:** The §04 amendment is real in the BUILT app: dark
`--ink-3` `#71868e` (4.53:1 on panel) resolves through the full light-first +
media + data-theme cascade. The retired `#5f7178` measured 3.39 — text-illegal.

```diff
--- web/app/tokens.css:150 + :207 (now-lines; media block + data-theme block)
-	--ink-3: #71868e;
+	--ink-3: #5f7178;      (both dark blocks)
```

`npm run build` + `tests/e2e/p1a-fixes.spec.ts` in isolation on
`tests/playwright.p1a.config.ts` (command form reconstructed from the record's
"rebuild; p1a-fixes in isolation").

Killed by:
  - the rendered rgb pin — recorded p1a-fixes.spec.ts:92 → now :101
    (`dark ink-3` expected `rgb(113, 134, 142)`, received `rgb(95, 113, 120)`);
    the other 3 specs stayed green (1 failed / 3 passed — the file carried 4
    tests at p1a-1)

**Result: KILLED** (as recorded in task-1-report.md / ledger §p1a-1)

## p1a-1-M2 — the whole 1920 media step deleted

**Source of record:** task-1-report.md §Mutation kills; ledger §p1a-1.

**Property under attack:** The §02 width contract STEPS on the tokens: at
1920×1080 the shell renders the 1520 step (`--shell-max`/`--breakout-max`
redefined in the `@media (min-width: 1920px)` `:root` block), never the 1280
base.

```diff
--- web/app/tokens.css:243-248 (now-lines)
-	@media (min-width: 1920px) {
-	  :root {
-	    --shell-max: 1520px;
-	    --breakout-max: 1520px;
-	  }
-	}
+	(block deleted)
```

`npm run build` + p1a-fixes in isolation (as M1).

Killed by:
  - the 1520 width pin — recorded p1a-fixes.spec.ts:41 (first assert :45) →
    now :50 (assert :53): the shell held 1280 at 1920×1080; 3 passed

**Result: KILLED** (as recorded in task-1-report.md / ledger §p1a-1; final
tree rebuilt and re-verified 16/16)

## p1a-2-M1 — the stylelint scratch-gate proof (`font-size: 11px` appended)

**Source of record:** task-2-report.md §Proof of gate item 2; ledger §p1a-2
"THE STRUCTURAL-FLOOR PROOF".

**Property under attack:** THE STRUCTURAL FLOOR: a sub-12px font-size literal
in `web/app/**/*.css` + `web/components/**/*.css` is a BUILD ERROR —
`declaration-property-value-allowed-list` holds every `font-size` to
`/^var\(--(t|fs)-/`. **This kill's vehicle is the LINTER, not a test**: the
assertion is exit 2 at the exact scratch line.

```diff
--- web/app/globals.css (appended at EOF; the file is unchanged since p1a-1)
+	.p1a2MutationScratch {
+	  font-size: 11px;
+	}
```

`npm run lint:css`

Killed by:
  - stylelint **FAILED (exit 2)** at exactly `globals.css:127`
    `font-size: 11px` with the token-law message; scratch removed → exit 0
    (the current 123-line file re-lands an appended scratch at the same
    reported line)

**Result: KILLED** (as recorded in task-2-report.md / ledger §p1a-2 — the
gate fired; a sub-12px label is a build error, not a review comment)

## p1a-2-M2 — base `--breakout-max` mutated 1280 → 1300 (pin kill A)

**Source of record:** task-2-report.md §Proof of gate item 3; ledger §p1a-2.

**Property under attack:** The canon's "holds 1280 at 1366" guard: the base
declaration is exactly `1280px`, exactly once — the stepped blocks
(1340/1520/1680) are the only other declarations, so exactly-once pins the
base. (Folded in from Task 1's review, controller-authorized.)

```diff
--- web/app/tokens.css:136 (now-line)
-	--breakout-max: 1280px;
+	--breakout-max: 1300px;
```

`npx playwright test -c tests/playwright.p1a.config.ts --project=unit
tests/unit/tokens-contract.spec.ts` (in isolation; house form — the record
says "in isolation").

Killed by:
  - the exactly-once base pin — tokens-contract.spec.ts:177 (verified
    UNDRIFTED; assert now :182); 13 passed

**Result: KILLED** (as recorded in task-2-report.md / ledger §p1a-2)

## p1a-2-M3 — a fifth `--ink-3` declaration added (pin kill B)

**Source of record:** task-2-report.md §Proof of gate item 4; ledger §p1a-2.

**Property under attack:** `--ink-3` closed accounting: declared exactly 4
times (2 light + 2 dark) — a fifth declaration anywhere (a sneaked
per-surface override) moves the count.

```diff
--- web/app/tokens.css:207 (now-line; the data-theme dark block)
 	--ink-3: #71868e;
+	--ink-3: #71868e;      (duplicated — the fifth declaration)
```

Unit tokens-contract spec in isolation (as M2).

Killed by:
  - the closed-accounting pin — tokens-contract.spec.ts:125 (verified
    UNDRIFTED; assert now :129, `countOf("--ink-3:") === 4`); the p1a-1
    value-count pin at :116 (assert :119) also fired on the duplicated hex;
    12 passed

**Result: KILLED** (as recorded in task-2-report.md / ledger §p1a-2; final
tree re-verified 14/14)

## p1a-3-M1 — the fresh bound widened: `2 × poll → 3 × poll`

**Source of record:** task-3-report.md §Mutation kills; ledger §p1a-3; log
`web-3820-p1a3-mutM1.log`.

**Property under attack:** The FRESH bound is a theorem, not taste:
fresh ≤ 2 × `price_poll_seconds` (the two-sample rule) — 120 is fresh, 121 is
aging under the fallback trio, and the runtime-override and anchored-age laws
ride the same arithmetic.

```diff
--- web/lib/freshnessTiers.ts:71 (now-line)
-	if (ageSeconds <= 2 * c.pricePollSeconds) return "fresh";
+	if (ageSeconds <= 3 * c.pricePollSeconds) return "fresh";   (reconstructed from description)
```

`npx playwright test -c tests/playwright.p1a.config.ts --project=unit
tests/unit/freshness-tiers.spec.ts` (in isolation)

Killed by (3 failed / 8 passed in the log):
  - the 121s boundary pin — freshness-tiers.spec.ts:48 (verified UNDRIFTED;
    test :44 in the log): `freshnessTier(121, TIER_FALLBACK)` expected
    "aging", received "fresh"
  - the runtime-override pin — :72 (test :64)
  - the anchored-age pin — :100 (test :84)

**Result: KILLED** (as recorded in task-3-report.md / ledger §p1a-3 / the mutM1 log)

## p1a-3-M2 — the provider's failure arm claims source `"meta"`

**Source of record:** task-3-report.md §Mutation kills; ledger §p1a-3; log
`web-3820-p1a3-mutM2.log`.

**Property under attack:** A threshold the page invented must never
impersonate one the pipeline stated: every failed meta read — transport, HTTP,
abort, AND `assertCompatible`'s `SchemaVersionMismatchError` — answers the
fallback constants with source `"fallback"`, so the chip can disclose it.

```diff
--- web/lib/meta.tsx:85-87 (now-lines; loadMetaConstants' catch arm)
 	} catch {
-	  return META_CONSTANTS_FALLBACK;
+	  return { constants: META_CONSTANTS_FALLBACK.constants, source: "meta" };
 	}                                         (reconstructed from description)
```

Unit freshness-tiers spec in isolation (as M1).

Killed by (2 failed / 9 passed in the log):
  - THE FALLBACK-SOURCE PIN — freshness-tiers.spec.ts:178 (verified UNDRIFTED;
    test :175): expected "fallback", received "meta"
  - the SchemaVersionMismatchError-arm pin — :191 (test :184):
    `toEqual(META_CONSTANTS_FALLBACK)`

**Result: KILLED** (as recorded in task-3-report.md / ledger §p1a-3 / the mutM2 log)

## p1a-4-M1 — `TIER_CLASS` flattened: every tier → `cQuiet`

**Source of record:** task-4-report.md §Mutation kills; ledger §p1a-4; log
`web-3820-p1a4-mutM1.log`.

**Property under attack:** Tier styling is COMPUTED from the ratified §06
bounds, never painted by hand: the snapshot chip's register is
`TIER_CLASS[freshnessTier(anchoredAge, constants)]` — a chip that stops
computing its tier dies at the resolved-color pins.

```diff
--- web/components/Ribbon.tsx:101-106 (now-lines)
 	const TIER_CLASS: Record<FreshnessTier, string | undefined> = {
 	  fresh: styles.cQuiet,
-	  aging: styles.cWarn,
-	  stale: styles.cCrit,
-	  critical: styles.cCritFill,
+	  aging: styles.cQuiet,
+	  stale: styles.cQuiet,
+	  critical: styles.cQuiet,          (reconstructed from description)
 	};
```

`npm run build` + p1a-fixes in isolation (the log ran the file's 9 tests).

Killed by (1 failed / 8 passed in the log):
  - the tier-register pin — p1a-fixes.spec.ts:267 "tier styling is computed
    from the ratified bounds" (verified UNDRIFTED; the AGING step's resolved
    `--warn-text` assert now :288 read `--ink-2` ink instead)

**Result: KILLED** (as recorded in task-4-report.md / ledger §p1a-4 / the mutM1 log)

## p1a-4-M2 — `LIVE · WATERMARKED` resurrected in the accent arm

**Source of record:** task-4-report.md §Mutation kills; ledger §p1a-4; log
`web-3820-p1a4-mutM2.log`.

**Property under attack:** The retirement CANNOT resurrect: the accent arm
says `STREAM CONNECTED` — posture, never health — and every kept
`LIVE · WATERMARKED` count-0 pin is a permanent resurrection guard firing on
the same render as its CONNECTED-visible twin.

```diff
--- web/lib/stream-posture.ts:87 (now-line; the open+base arm)
-	? { label: STREAM_CONNECTED, tone: "accent" }
+	? { label: "LIVE · WATERMARKED", tone: "accent" }   (reconstructed from description)
```

`npm run build` + the affected e2e files (the log ran 33 tests; command form
reconstructed: p1a-fixes + p0-fixes + r7-fixes).

Killed by (4 failed / 29 passed in the log — 4 pins across 3 files):
  - p1a-fixes "a genuinely open stream is STREAM CONNECTED — an accent chip,
    never green, never LIVE" — recorded-in-log :350 → now :396 (CONNECTED
    visible :426 + the count-0 guard :428 on the same render)
  - p0-fixes.spec.ts:788 "a FRESH batch still shows its age beside the
    connected chip" (verified UNDRIFTED; CONNECTED-visible pin :795)
  - r7-fixes.spec.ts:465 "(4) A HUNG RECONNECT NEVER LEAVES LIVE PAINTED"
    (verified UNDRIFTED; CONNECTED pins :495/:538)
  - r7-fixes.spec.ts:553 "(4) A SERVER THAT HANGS UP TAKES LIVE WITH IT"
    (verified UNDRIFTED; CONNECTED pin :576 + post-hang-up count-0 :586)

**Result: KILLED** (as recorded in task-4-report.md / ledger §p1a-4 / the mutM2 log)

## p1a-4-M3 — the popover omits the as-ofs (`asOfs.slice(0, 0)`)

**Source of record:** task-4-report.md §Mutation kills; ledger §p1a-4; log
`web-3820-p1a4-mutM3.log`.

**Property under attack:** The raw watermark as-ofs are DEMOTED into the
"Data status →" popover but never DROPPED: the popover carries the full
vector — per-engine heights and the sweep's own as-of. The retargeted pins
OPEN the popover and read the heights there.

```diff
--- web/components/Ribbon.tsx:195 (now-line; the popover panel's vector)
-	{props.asOfs.map((asOf) => (
+	{props.asOfs.slice(0, 0).map((asOf) => (      (as recorded)
```

`npm run build` + the affected e2e files (the log ran 59 tests; command form
reconstructed: p1a-fixes + r7-fixes + state-matrix).

Killed by (6 failed / 53 passed in the log — the 5 retargeted watermark pins
plus one unrelated flake):
  - p1a-fixes.spec.ts:310 "raw watermark heights live in the Data status
    popover" (verified UNDRIFTED; opened-popover pins :326-:328)
  - state-matrix.spec.ts `shell × live:sse-snapshot` and `× live:sse-recovered`
    (the parametrized walk, test decl :1167; the retargeted `@25,635,618`
    pins recorded :1096/:1149 → now :1100/:1155)
  - r7-fixes.spec.ts:465 and :553 — the "(4)" pair's popover watermark pins
    (recorded r7:495/:516/:587 → now :498/:521/:598)
  - **the 6th failure is NOT a kill**: r7-fixes:335 "(3)"'s connection-count
    poll flaked under parallel load — recorded in-task as unrelated to the
    mutation and green in both final-tree full runs

**Result: KILLED** (as recorded in task-4-report.md / ledger §p1a-4 / the mutM3 log)

## p1a-4b-M4 — the unbindable-withhold guard deleted (fix-round mutant)

**Source of record:** task-4-report.md §p1a-4b; ledger §p1a-4b; log
`web-3820-p1a4b-mutM4.log`.

**Property under attack:** RENDERED ONLY WHEN UNAMBIGUOUS: a refused engine
carrying no stamp gives the coverage subtraction no honest denominator — the
derivation returns null and the chip is WITHHELD ENTIRELY, never an invented
fraction. (The Task 4 review found the honesty arms unpinned; this mutant
proves the new pins bite.)

```diff
--- web/lib/coverage.ts:47 (now-line)
-	if (withheld.some((engine) => !stamped.includes(engine))) return null;
+	(guard removed)
```

`npm run build` + `npx playwright test -c tests/playwright.p1a.config.ts
tests/e2e/p1a-fixes.spec.ts tests/unit/coverage.spec.ts` (the recorded
invocation; 16 tests).

Killed by (2 failed / 14 passed in the log — exactly the two withheld-arm pins):
  - unit coverage.spec.ts:43 "an UNBINDABLE refusal withholds the derivation
    entirely" (verified UNDRIFTED; asserts :48-:49): received an invented
    `{answered: 1, total: 2, withheld: ["ghost_engine"]}` where null was pinned
  - e2e p1a-fixes.spec.ts:354 (verified UNDRIFTED): `ribbon-coverage` count 1
    where 0 was pinned (:374), while BATCH #1 and SNAPSHOT 42s still render

**Result: KILLED** (as recorded in task-4-report.md / ledger §p1a-4b / the
mutM4 log; guard restored, targeted 16/16 green)

## p1a-5-M1 — the banner's identity enforcement removed

**Source of record:** task-5-report.md §Mutation kills; ledger §p1a-5; log
`web-3820-p1a5-mutM1.log`.

**Property under attack:** THE RATIFIED LAW is structural: a verdict banner
composed without its identity strip renders the warn-register structural
refusal NAMING the omission — never the happy sentence, and not a dev-throw.
Deleting `verdictBannerModel`'s refusal branch lets every render-empty shape
wear the requested variant's banner.

```diff
--- web/lib/kit.ts:71-78 (now-lines; the branch deleted whole)
-	if (identityMissing(identity)) {
-	  return {
-	    kind: "refusal",
-	    toneClass: "vWarn",
-	    answer: VERDICT_IDENTITY_REFUSAL.answer,
-	    qualification: VERDICT_IDENTITY_REFUSAL.qualification,
-	  };
-	}                                        (reconstructed from description)
```

`npx playwright test -c tests/playwright.p1a.config.ts --project=unit
tests/unit/kit.spec.ts` (in isolation)

Killed by (2 failed / 9 passed in the log — exactly the two identity-law pins):
  - kit.spec.ts:30 "the banner NEVER renders without its identity strip —
    every render-empty shape refuses" (verified UNDRIFTED)
  - kit.spec.ts:50 "the refusal names the omission, in the warn register"
    (verified UNDRIFTED)

**Result: KILLED** (as recorded in task-5-report.md / ledger §p1a-5 / the
mutM1 log; restored byte-identical)

## p1a-5-M2 — the affordance forced when human === exact

**Source of record:** task-5-report.md §Mutation kills; ledger §p1a-5; log
`web-3820-p1a5-mutM2.log`.

**Property under attack:** The false-scent law's FORBIDDEN arm: human ===
exact renders PLAIN — no affordance, no title, no glyph. A copy cue over an
identical value lies about there being a second layer.

```diff
--- web/lib/kit.ts:148 (now-line; exactValueMode's body)
-	return human === exact ? "plain" : "affordance";
+	return "affordance";                     (reconstructed from description)
```

Unit kit spec in isolation (as M1).

Killed by (1 failed / 10 passed in the log):
  - the forbidden-arm pin — kit.spec.ts:99 "FORBIDDEN arm: human === exact
    renders PLAIN" (verified UNDRIFTED; assert :100 expected "plain")

**Result: KILLED** (as recorded in task-5-report.md / ledger §p1a-5 / the
mutM2 log; restored byte-identical, post-restore targeted 11/11)

## p1a-6-M1 — `contrastRatio` stubbed to a constant 4.53

**Source of record:** task-6-report.md §Verification; ledger §p1a-6; log
`web-3820-p1a6-mutM1.log`.

**Property under attack:** The styleguide MEASURES its swatches — nothing
prints the canon's numbers. The known-bad probe (`--ink-3` on `--chip-bg`,
the §04 never-on-chip law) renders its failing ratio computed LIVE per theme
(4.29 light · 4.05 dark) — numbers a stubbed computation cannot produce.

```diff
--- web/lib/contrast.ts:69-73 (now-lines; contrastRatio's body)
-	const a = relativeLuminance(fg);
-	const b = relativeLuminance(bg);
-	const hi = Math.max(a, b);
-	const lo = Math.min(a, b);
-	return (hi + 0.05) / (lo + 0.05);
+	return 4.53;                             (reconstructed from description)
```

`NEXT_PUBLIC_SHOW_STYLEGUIDE=1 npm run build` + the p1a-6 styleguide describe
in isolation (the log ran its 8 pins; command form reconstructed).

Killed by (1 failed / 7 passed in the log):
  - the probe's exact-ratio pin — p1a-fixes.spec.ts:469 "every text swatch's
    LIVE ratio clears 4.5 in both themes — and the known-bad probe fails by
    design" (verified UNDRIFTED; the per-theme `data-ratio` attribute pin
    :488 — 4.29/4.05 — cannot be produced by the constant)

**Result: KILLED** (as recorded in task-6-report.md / ledger §p1a-6 / the
mutM1 log; restored to the exact pre-mutation text)

## p1a-6-M2 — the interaction demo's `onKeyDown` removed

**Source of record:** task-6-report.md §Verification; ledger §p1a-6; log
`web-3820-p1a6-mutM2.log`.

**Property under attack:** The §11 interaction register is a WORKING
reference implementation, not a static picture: ArrowRight moves the focus
ring in data order (the register Phase 3 copies).

```diff
--- web/app/styleguide/InteractionRegisterDemo.tsx:114 (now-line; the svg wiring)
-	onKeyDown={onKeyDown}
+	(handler removed)                        (reconstructed from description)
```

Env-var rebuild + the p1a-6 describe in isolation (as M1).

Killed by (1 failed / 7 passed in the log):
  - the ArrowRight pin — p1a-fixes.spec.ts:666 "the interaction register: tab
    enters, arrows traverse, Home/End jump, Enter opens evidence, Esc leaves"
    (verified UNDRIFTED; `data-focus-index` "1" after ArrowRight, assert :690)

**Result: KILLED** (as recorded in task-6-report.md / ledger §p1a-6 / the
mutM2 log; restored to the exact pre-mutation text)

## restore verification

Every task's record states its mutants were REVERTED in-task and the final
tree rebuilt and re-verified (p1a-1: 16/16 targeted; p1a-2: 14/14; p1a-3:
11/11; p1a-4/4b: grep for mutation residue + targeted 16/16; p1a-5: restored
byte-identical, 11/11; p1a-6: exact-text restoration, 9/9 targeted). The
close-time proof is global: each task's FULL-SUITE run on its final tree went
green at its recorded count (1510 → 1522 → 1574 → 1581 → 1588 → 1599 → 1608
passed at each seal, plus p1a-7's 1613 CI-mirror), and the p1a-8 close runs
repeat the full suite green on the sealed tree in BOTH shapes — a surviving
mutant in any of these files would hold at least one of the fifteen kill
assertions red (or, for p1a-2-M1, hold `lint:css` red — which this close also
re-ran clean).

## summary

| # | result | property (compressed) | killed by |
|---|---|---|---|
| p1a-1-M1 | **KILLED** | dark --ink-3 is the amended 4.53:1 value in the built app | rendered rgb pin (p1a-fixes :92→:101) |
| p1a-1-M2 | **KILLED** | the 1920 step is real — shell renders 1520, not base | width pin (p1a-fixes :41→:50) |
| p1a-2-M1 | **KILLED** | sub-12px literal = build error (the structural floor) | **stylelint exit 2** at globals.css:127 |
| p1a-2-M2 | **KILLED** | base breakout-max exactly 1280px, exactly once | tokens-contract.spec.ts:177 |
| p1a-2-M3 | **KILLED** | --ink-3 closed accounting (4 declarations) | tokens-contract.spec.ts:125 (+:116 fired) |
| p1a-3-M1 | **KILLED** | fresh ≤ 2×poll is a theorem — 121s is aging | freshness-tiers.spec.ts:48/:72/:100 |
| p1a-3-M2 | **KILLED** | a failed meta read never claims source "meta" | freshness-tiers.spec.ts:178/:191 |
| p1a-4-M1 | **KILLED** | tier styling computed from the bounds, never hand-painted | tier-register pin (p1a-fixes :267) |
| p1a-4-M2 | **KILLED** | LIVE·WATERMARKED cannot resurrect — CONNECTED + count-0 guards | 4 pins / 3 files (p1a-fixes :350→:396, p0 :788, r7 :465/:553) |
| p1a-4-M3 | **KILLED** | the popover carries the FULL as-of vector | 5 retargeted pins (p1a-fixes :310, state-matrix ×2, r7 ×2) |
| p1a-4b-M4 | **KILLED** | unbindable refusal withholds the chip — never an invented count | coverage.spec.ts:43 + p1a-fixes :354 |
| p1a-5-M1 | **KILLED** | no banner without its identity strip — structural refusal | kit.spec.ts:30/:50 |
| p1a-5-M2 | **KILLED** | human===exact renders PLAIN — the false-scent law | kit.spec.ts:99 |
| p1a-6-M1 | **KILLED** | contrast is MEASURED — the known-bad probe's live per-theme ratios | probe data-ratio pin (p1a-fixes :469/:488) |
| p1a-6-M2 | **KILLED** | the interaction register actually traverses | ArrowRight pin (p1a-fixes :666/:690) |

**15 mutants, 15 killed, 0 survived** — reconciled from the task records (not
predicted, not re-run): p1a-1 ×2, p1a-2 ×3 (one build-gate kill + two folded
pin kills), p1a-3 ×2, p1a-4 ×3 + p1a-4b ×1, p1a-5 ×2, p1a-6 ×2; p1a-0 and
p1a-7 carried none.
