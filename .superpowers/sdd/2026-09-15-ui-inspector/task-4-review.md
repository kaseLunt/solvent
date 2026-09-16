# Task 4 review — `trust`: the five checklist items

**Range reviewed:** `a755bb0..92aa73b` (one commit, `92aa73b`)
**Verdicts:** SPEC ✅ · QUALITY needs-fixes (four Important findings, each with a reproduced failing input; all four are in code the brief supplied verbatim, so they are defects of the brief's design that the implementer faithfully reproduced, not deviations)

## How the evidence was gathered

- Read the brief, the implementer's report and the review package in that order.
- The package's `--stat` lists exactly two new files (`web/lib/trust.ts`, 98 lines; `web/tests/unit/trust.spec.ts`, 74 lines). Nothing under `web/lib/**` that already existed is touched.
- Diffed the committed module and spec against the brief's Step 1 and Step 3 code by eye: byte-for-byte the same, as the report claims.
- Read the dependencies symbolically (Serena `find_symbol`): `oldestPriceAge` (`web/lib/inspector-position.ts:222-225`, max of non-null ages, else null), `symbolFor` (`:89-92`), `CASH = "debt_manager"` (`:14`), `VERDICT_RANK` (`:227`), `pricesChip` (`:229-239`), `plainCause` (`web/lib/refusal-phrasebook.ts:12-17`), `readWirePopulation` (`web/lib/wireGuard.ts:213-219`) and `isWirePopulation` (`:152-159`), `humanAge` (`web/lib/freshness.ts:31-38`), `deriveProofSubjectStatus` (`web/lib/evidence.ts:559-605`), Task 1's `TrustCheckItem` (`web/components/kit/TrustChecklist.tsx:3-10`).
- Read the wire shapes in `web/node_modules/@solvent/client/src/generated/schema.ts`: `PriceInput` (line 1002; `verdict` is the six-value enum, `provenance: string` documented as "engine-exact, adapter-output, uncapped-feed or ratio-reference", `age_seconds: number | null`, `budget_seconds: number`), `SweepStamp` (648), `ReconcileSummary` (3272; `result: string`, `exit_code: number`), `Refusal` (951), `AsOf.sweep_block` (1041). `ManifestReconcile` in `evidence.ts:538` is the same `ReconcileSummary` schema.
- Read ruling R5 (`docs/plans/2026-09-15-ui-inspector.md:42`), spec §5.3 (`docs/specs/2026-09-15-ui-product-register-design.md:240-263`) and the mockup's `.k-check` list (`docs/specs/2026-09-15-ui-mockups/pages-console.html:250-256`).
- Re-ran `npx playwright test --project=unit tests/unit/trust.spec.ts` from `web/` → `5 passed (2.4s)`. Serena diagnostics on `web/lib/trust.ts` → none.
- Ran 39 read-only probes against the committed module through `tsx` from the scratchpad (`trust-probe.mts`, imports the real `lib/trust.ts`, `near()` and the two fixtures). Every failing input below is quoted from that run, not inferred from reading.

---

## A. SPEC COMPLIANCE

### Files

| Requirement | Evidence | |
|---|---|---|
| Create `web/lib/trust.ts` | package `--stat`: new file, 98 lines | ✅ |
| Test `web/tests/unit/trust.spec.ts` | package `--stat`: new file, 74 lines | ✅ |
| Nothing else; existing `web/lib/**` untouched | `2 files changed, 172 insertions(+)`, both `new file mode` | ✅ |

### Interfaces (brief "Interfaces")

| Interface | Evidence | |
|---|---|---|
| `TrustState = "ok" \| "warn" \| "refused" \| "dim"` | `trust.ts:14` | ✅ |
| `TrustId` = the five ids | `trust.ts:15` | ✅ |
| `TrustItem { id, label, detail, state, title? }` all `readonly` | `trust.ts:17-23` | ✅ |
| `TrustInput { position, batchId, sweep: SweepStamp \| null, reconcile: ReconcileSummary \| null }` | `trust.ts:25-30`, aliases at `:11-12` | ✅ |
| `trustChecklist(input): TrustItem[]`, always five, in order computed · prices · sweep · provenance · reconcile | `trust.ts:96-98` returns a fixed five-element literal in that order | ✅ |
| Consumes exactly the named imports (`PriceInput`, `RefinedPosition`, `components`; `symbolFor`, `oldestPriceAge`, `CASH`; `plainCause`; `humanAge`; `readWirePopulation`) | `trust.ts:5-9` | ✅ |
| Structurally a `TrustCheckItem` (plan self-review) | `TrustChecklist.tsx:3-10`: `id: string` ⊇ `TrustId`; identical state union; `title?: string` | ✅ |

### The five test cases (brief Step 1), each re-run and each pinned value re-derived

| # | Case | Evidence | |
|---|---|---|---|
| 1 | Five ids in order; happy account: `batch 18,251` ok · `35s · within 180s` ok · `1 of 3 rows failed · gen 4` warn · `engine-exact` ok · `Book reconciles to chain` / `29/29 Cash rows exact · committed receipt` ok | `trust.spec.ts:14-24`; fixture sweep `rows 3, failed 1, generation 4` (`tests/fixtures/inspector.ts:63-76`); manifest weld `debt_manager 29/29` (`evidence-manifest.json`); `near()` ages 35/35, budgets 180/180 | ✅ |
| 2 | Refused position → `collateral sweep never ran`, title `SWEEP_NEVER`; stale weETH → warn `weETH 210s old · budget 180s`; missing ETHFI → refused `ETHFI price missing`; empty inputs → dim `no price inputs` | `trust.spec.ts:26-46`; phrasebook entry `refusal-phrasebook.ts:5`; `isFreshOrStale` at `trust.ts:33` keeps `stale` out of the refused arm | ✅ |
| 3 | `sweep_block 0` → refused `never swept · collateral clock absent`; clean stamp → ok `gen 4 · 20m ago`; null stamp → dim `no sweep stamp on this batch` | `trust.spec.ts:48-54`; `humanAge(1205)` = `20m` (`freshness.ts:34-35`) | ✅ |
| 4 | adapter-output → label `weETH price is adapter output`, detail `not oracle-direct`, warn; unknown `replayed` → dim, verbatim | `trust.spec.ts:56-66`; mockup row `pages-console.html:254` carries the same words | ✅ |
| 5 | `fail`/drift 2 → warn `2 drifted rows · fail`; null receipt → dim `receipt unavailable`; no weld → ok `87/87 rows exact · committed receipt` | `trust.spec.ts:68-74`; gated totals 87/87 in the manifest | ✅ |

Step 2 (module-not-found first) is reported, not independently verifiable; Step 4 re-run: `5 passed`. Step 5: the commit message matches the brief's; the report's `git commit -- <two paths>` and `scope-gate: OK` are consistent with the two-file package.

### Ruling R5 and the global constraints (the lens)

| Constraint | Holds? | Evidence |
|---|---|---|
| Five items, R5 order | ✅ | `trust.ts:97` |
| Reconcile is BOOK-level: label `Book reconciles to chain`, detail `… · committed receipt`, `debt_manager` weld when present else gated totals | ✅ | `trust.ts:85, 91-93` |
| `ok` only when the wire affirms it; what the wire does not carry is `dim` | ✅ for the dim arms (`no price inputs`, `no sweep stamp on this batch`, `receipt unavailable`, unknown provenance) — **but the reconcile `ok` arm accepts receipts the wire does not affirm (Important 4)** | `trust.ts:45, 61, 74, 80, 86`; probes R1–R4 |
| Missing price input, `sweep_block` 0, refused position are `refused`, never `dim` | ✅ for each alone (`trust.ts:40, 48, 62`) — **`sweep_block` 0 with a null stamp renders `dim` (Important 3)** | probe S1 |
| Every printed wire population passes `readWirePopulation` | `generation`, `failed`, `rows` (where printed), `gated_*`, weld rows: ✅ (`trust.ts:63-66, 87, 92`) — **price `age_seconds`/`budget_seconds` and the sweep `age_seconds` are printed unguarded (Important 2)** | probes P9, P10, P12, S9 |
| `plainCause` is the only source of refusal prose; wire names only in `title` | ✅ for the computed item (`trust.ts:40`) — **the prices refused arm prints the wire verdict word as prose (Important 1b)** | probes P5–P7 |
| `title` carries wire words only and never leads the visible text | ✅ rendering-wise (`TrustChecklist.tsx:27` puts it on `<li title>`); codes (`:40`), verdicts (`:48`), provenance words (`:77, 80`), artifact path (`:89, 93`). One synthesized word, `unnamed` (`:39-40`), is not a wire word (Minor 7) | |

**Spec verdict: ✅.** The interface and all five cases are met; the module and spec are the brief's code verbatim and the pinned strings are reproduced by the real fixtures. The four constraint failures below are on inputs the brief's spec does not pin, in code the brief itself supplied.

---

## B. CODE QUALITY

Ranked. Each Important finding names a reproduced input → output from the probe run and a concrete fix. None is an implementer deviation; each is a design defect in the brief's verbatim code, so the controller should decide whether the fix lands as a Task 4 follow-up or before Task 11 mounts the list.

### Important

**1. `pricesItem` prints a self-contradicting detail when the oldest input is not the tightest-budget input, and prints wire verdict words as refusal prose.**
`web/lib/trust.ts:55-57` (ok arm) and `:46-48` (refused arm).

- (a) Ok arm. `oldest` is the max age over all inputs; `budget` is the min budget over all inputs; the two are read from different inputs and printed as one claim. Probe P1: `[{age 150, budget 180, fresh}, {age 35, budget 120, fresh}]` → `ok | Prices fresh | 150s · within 120s`. Both inputs are `fresh` on the wire, so `ok` is right, but the detail asserts 150 ≤ 120. R5's wording ("oldest age vs smallest budget") produces this when read literally. Fix: pick ONE input — the tightest, `argmax(age/budget)` over inputs with a non-null age — and print its own `age` and its own `budget`; the fixture pin `35s · within 180s` is unchanged. Add a pin for the P1 shape.
- (b) Refused arm. `detail: \`${symbol} price ${broken.verdict}\`` puts the wire enum word in the visible detail. Probes P5–P7: `weETH price no-as-of`, `weETH price reorg-unacked`, `weETH price over-ceiling`. `missing` reads as English (and the brief pins `ETHFI price missing`), the other three do not, and the global constraint reserves refusal prose for the phrasebook and wire words for `title`. Fix: a `Record<PriceVerdict, string>` of plain words welded total against the enum, the way `VERDICT_RANK` (`inspector-position.ts:227`) is: `missing → "missing"`, `over-ceiling → "over its ceiling"`, `no-as-of → "has no chain as-of"`, `reorg-unacked → "awaiting reorg acknowledgement"`; `title` keeps the wire word. Pin one of the three.

**2. Price ages and budgets, and the sweep age, are printed without `readWirePopulation`.**
`web/lib/trust.ts:52-53` (`stale.age_seconds`, `stale.budget_seconds`), `:55-57` (`oldest`, `budget`), `:68` (`sweep.age_seconds` into `humanAge`).

`evidence.ts:439-443` guards `budget_seconds` and `age_seconds` for the same wire object; here they are `String()`ed raw. Probes: P9 `budget_seconds: -0` → `ok | 35s · within 0s`; P10 `age_seconds: NaN` → `ok | NaNs · within 180s`; P12 stale with `budget_seconds: -0` → `warn | weETH 210s old · budget 0s`; S9 sweep `age_seconds: NaN` → `ok | gen 4 · NaNh NaNm ago`. `oldestPriceAge` lives in an untouched file, so guard in this module: map inputs through `readWirePopulation(i.age_seconds, "price_inputs[].age_seconds")` when non-null and `readWirePopulation(i.budget_seconds, …)` before the arithmetic, and guard `sweep.age_seconds` before `humanAge`. Throwing is the house convention (evidence.ts p1b-14 comment), so this matches how `generation`/`failed` already behave two lines up.

**3. `sweepItem` lets a null stamp mask a never-swept account: `sweep_block` 0 renders `dim`.**
`web/lib/trust.ts:61-62` — the null check precedes the `sweep_block === 0` check.

Probe S1: `sweep: null`, `as_of.sweep_block: 0` → `dim | Collateral sweep | no sweep stamp on this batch`. The account-level fact (never swept, a refusal-grade condition the engine itself names `SWEEP_NEVER`) is stronger than the batch-level absence of a stamp, and the constraint says `sweep_block` 0 is `refused`, never `dim`. The implementer noticed the order ("checked after the null-stamp check, so a null stamp is dim, not refused") and read it as intended; the brief's own test for `never` passes a non-null stamp, so the combination is never exercised. Fix: swap lines 61 and 62; add a pin with `sweep: null` and `sweep_block: 0` → `refused`. If the controller instead rules that the batch-level item should stay `dim` because item 1 already carries the account's refusal, record that ruling — but then the constraint's wording needs the same amendment.

**4. `reconcileItem`'s ok arm accepts receipts the evidence module rejects.**
`web/lib/trust.ts:87-93`.

The arm requires only `result === "pass"` and `gated_drift === 0`. `deriveProofSubjectStatus` (`evidence.ts:559-605`, on the same `ReconcileSummary` type per `:538`) additionally demotes to `rejected` on `exit_code !== 0`, `gated_exact !== gated_rows`, and any weld with `rows_exact !== rows_compared`, with the comment "this surface would rather call a contradictory receipt rejected than launder it into a proof". Probes: R2 weld `28/29`, pass, drift 0 → `ok | 28/29 Cash rows exact · committed receipt` (a green check beside a fraction that is not whole); R3 no weld, gated `86/87` → `ok | 86/87 rows exact · committed receipt`; R4 `exit_code: 1` with pass → `ok`; R1 weld `rows_compared: 0` → `ok | 0/0 Cash rows exact · committed receipt` (a vacuous claim — the receipt compared no Cash rows, so it affirms nothing about the Cash book). Fix: before the ok return, `warn` when the printed pair is not equal or `exit_code !== 0` (detail naming the fraction, as the warn arm does), and `dim` with `no Cash rows compared · committed receipt` when the weld's `rows_compared` is 0 (or fall through to the gated totals). The cleanest long-term fix is to export the receipt conjunction from `evidence.ts` and call it here — out of scope for this task's "existing `lib/**` untouched" rule, so a follow-up.

### Minor

5. `web/lib/trust.ts:65-69` — a stamp with `rows: 0, failed: 0` prints as a clean sweep (`ok | gen 4 · 20m ago`, probe S2); the ok arm never reads `rows`. Say `0 rows` or `dim`. Same arm: `generation_open: true` is ignored (probe S4 → `ok | gen 4 · 20m ago`); if an open generation means a tally still being written, append `· in progress` or `warn`. And `failed > rows` prints verbatim (`5 of 3 rows failed`, probe S5).
6. `web/lib/trust.ts:79-80` — the schema documents four provenance words; `uncapped-feed` and `ratio-reference` fall into the "unknown" arm and print the wire word as `dim` (probes V3, V4). If either can value a Cash position it is a caveat (`warn`, not oracle-direct), not "not available". Also an empty provenance string yields an empty detail (probe V6: `dim | Price provenance | ` with `title=`); say `provenance unstated`.
7. `web/lib/trust.ts:39-40` — `code = refusal?.code ?? "unnamed"` puts a synthesized word in the `title` slot reserved for wire words (probe C1: `title=unnamed`). Omit `title` when there is no code.
8. `web/lib/trust.ts:46, 75` — only the first broken price / first adapter input is named (probes P8, V5: two broken → `weETH price missing`; both adapter → `weETH price is adapter output`), and an adapter `warn` hides an unknown-provenance input entirely (probes V1, V2). Consider `+1 more` or joining the symbols.
9. `web/lib/trust.ts:89` — `reconcile.result` is printed verbatim in the warn detail (brief-pinned for `fail`; probe R7 prints `0 drifted rows · PRECONDITION`). Acceptable as pinned; note the leak.
10. `web/lib/trust.ts:62` — the sweep refused arm carries no `title`; the wire fact (`as_of.sweep_block = 0`) could ride the hover as the other refused arms do.
11. `web/tests/unit/trust.spec.ts:12` — `byId` relies on the `any`-returning `Object.fromEntries` overload, so every `t.<id>` is `any` (implementer noted). `Object.fromEntries(items.map((i) => [i.id, i] as const))` keeps the type. None of the probed combinations (P1, P5–P7, P9, S1, R1–R4) is pinned; the fixes above should each land with a pin.

### What is right

- The five-arm structure reads top-down as refused → warn → ok with dim for absence, and every dim string names what is absent rather than a zero.
- `stale` + `missing` → `refused` wins (probe P4), as the constraint requires.
- `generation` and `failed` are guarded before either branch, and `rows` is guarded on the only branch that prints it (probes S6–S8 confirm nothing unguarded reaches the string).
- Malformed `gated_drift` throws from `readWirePopulation` (probes R5, R6) — the house convention (`evidence.ts:565-570`), so Task 11 must mount `trustChecklist` inside the same route boundary rather than let it take the page down.
- `computedItem` prefers the refusal when `status === "computed"` and `refusal` is non-null (probe C2) — the conservative reading of an inconsistent wire.
- `title` never leads the visible text: the kit renders it as the `<li>` hover only.

---

## Re-review (01d28f5)

**Range:** `9418851..01d28f5` (one commit; `web/lib/trust.ts` 98 → 207 lines, `web/tests/unit/trust.spec.ts` 74 → 143 lines; the report's "173 / 142" line counts are slightly off, nothing else). Exported interface unchanged (`trust.ts:25-41`).
**Verdict:** RE-REVIEW open — all eleven findings are addressed in substance and nothing regressed; three Minor items remain, none blocking.

### How this was verified

- Working tree equals `01d28f5` for both files (`git diff 01d28f5 -- …` empty). `npx playwright test --project=unit tests/unit/trust.spec.ts` → `10 passed (2.6s)`. `npx eslint` on both files → clean. Serena diagnostics on both files → none.
- Re-ran the round-1 probe set (39 inputs) against the fixed module, plus 24 new probes for the cases the fix round's pins do not cover (`trust-probe2.mts`, scratchpad). Every value below is quoted from those runs.
- Re-derived each new pin by hand against `near()` (weETH/ETHFI, ages 35/35, budgets 180/180), the fixture stamp (`rows 3, failed 1, generation 4, age 1205, generation_open false`) and the manifest (`pass`, exit 0, 87/87/0, weld `debt_manager` 29/29, artifact path).

### The coordinator's rulings, one by one

| # | Ruling | Code | Probe / pin | |
|---|---|---|---|---|
| 1 | Oldest input speaks with ITS OWN budget; all-null ages → dim `age unknown · budget Ns` | `trust.ts:129-135` (`dated` filter, `reduce` on age, own `budget`); `:130-133` dim with the smallest budget | P1 `[150/180, 35/120]` → `ok · 150s · within 180s`; P3 all null → `dim · age unknown · budget 180s`; Q7 budgets 180/120 → `budget 120s`; pins `spec:89-90` | ✅ |
| 2 | Every printed count/age/budget/exit code through `readWirePopulation` | `readPrices` `:101-108` (age when non-null, budget, per index); sweep `:145-148` (all four, before any branch); reconcile `:182-183, 193-194` | P9–P12, S6–S9, R5–R6, Q6, T1–T2, U6 all THROW with the field path; pin `spec:101` | ✅ |
| 3 | `sweep_block === 0` before the null stamp → refused, title `sweep_block: 0` | `:141-144` | S1 `sweep: null` + `sweep_block 0` → `refused · never swept · collateral clock absent · title=sweep_block: 0`; pin `spec:106` | ✅ |
| 4 | ok only when pass ∧ exit 0 ∧ drift 0 ∧ pair equal ∧ compared > 0; unequal → `N Cash row(s) drifted`; compared 0 → dim `no Cash rows in the receipt`; not-pass / exit ≠ 0 → `… · did not pass`, result word in title | `:184-188` (`passed`, suffix, `title: result: … · exit …`); `:191-202` (weld else gated; `compared === 0` dim; `exact > compared` warn; `exact !== compared` warn; ok) | R1 → `dim · no Cash rows in the receipt`; R2 28/29 → `warn · 1 Cash row drifted`; R3 gated 86/87 → `warn · 1 row drifted`; R4 exit 1 → `warn · 0 drifted rows · did not pass · title=result: pass · exit 1`; U1 pass+drift 2 → `warn · 2 drifted rows`; U5 → `title=result: PRECONDITION · exit 2`; pins `spec:77, 140-142`; regression `spec:30, 80` hold (29/29 weld; 87/87 gated) | ✅ |
| 5 | rows 0 → dim `sweep stamp empty`; `generation_open` → warn `gen N open · sweep in progress`; failed > rows → `contradictory stamp` | `:149-152`, in that order before the ok arm | S2, S4, S5; T4 rows 0 + open → dim (absence outranks progress); pins `spec:108-110`; regression `spec:28, 59` hold | ✅ |
| 6 | `uncapped-feed` / `ratio-reference` → warn `not oracle-direct` with plain labels; unknown → dim `provenance not recognised` (title = word); `""` → `provenance not stated`, no title | `PROVENANCE_CAVEATS` `:57-61`; `:163-170`; `:174-176` | V3 → `weETH price is from an uncapped feed`; V4 → `… is a ratio reference`; M4 `[replayed, ""]` → `dim · provenance not recognised · title=replayed`; V6 → `dim · provenance not stated`, no title; pins `spec:72, 116-125` | ✅ |
| 7 | No synthesized `unnamed` title; detail `refused without a code` | `:87-89` | C1 → `refused · refused without a code`, no title; pin `spec:128-132` | ✅ |
| 8 | Every affected input named | prices broken `:115-119` (grouped by verdict, wire order); stale `:122-125`; provenance caveats `:165-170` (`andList`) | P8 → `weETH price missing; ETHFI price past its ceiling · title=missing; over-ceiling`; Q5 → `weETH, ETHFI prices missing`; stale pair `spec:97-100`; V5 → `weETH and ETHFI prices are adapter output` | ✅ for prices and stale; **provenance incomplete — see Open 1** |
| 9 | Result word in title | `:187` | R4, R7, U5 titles carry `result: <word> · exit <n>`; the detail never does | ✅ |
| 10 | Refused sweep arm titled | `:142` | S1 and `spec:106` | ✅ |
| 11 | Typed `byId`; pins for every arm | `spec:12` (`as Record<TrustId, TrustItem>`); five new test blocks `spec:85-143` | every arm the rulings CHANGED is pinned; **several unchanged or new arms are not — see Open 3** | ✅ / partial |

### The five accepted deviations, checked

`oldestPriceAge` import gone (`:16`; `inspector-position.ts` untouched) and the oldest INPUT found by `reduce` (`:134`, first-seen wins ties, so the fixture still prints `35s · within 180s`) ✅. Drift pluralised (`plural`, `:44, :186, :200`; `1 Cash row drifted`, `0 drifted rows`) ✅. `exact > compared` → warn `30 exact of 29 Cash rows · contradictory receipt` (U2) ✅. `exit_code` guarded (`:183`; U6 throws on `-0`) ✅. No title on `provenance not stated` (V6, `spec:125`) ✅.

### No wire verdict or provenance word as visible prose

Walked every `detail` and `label` string: `BROKEN_WORDS` (`:47-52`) is total over `Exclude<PriceVerdict, "fresh" | "stale">`, so a new wire verdict fails typecheck rather than leaking; the `?? g.key` fallback at `:168` is unreachable (the group came from `PROVENANCE_CAVEATS.has`); reconcile's `result` rides only the title. One exception remains, brief-pinned — Open 2. (`plainCause`'s own `refused (G3)` fallback, probe C4, prints the code by the phrasebook's design in an untouched file; not this module's doing.)

### Regression sweep

All ten original pins hold, re-derived (`spec:25-30, 40-52, 57-60, 67-72, 77-80`). The 39 round-1 inputs now produce: every Important case corrected (P1, P5–P7, P9–P12, S1, S9, R1–R4), every Minor case corrected (S2, S4, S5, P8, V3–V6, C1) — except the provenance mix in Open 1. Nothing that was right in round 1 changed for the worse; the only behavioural widenings are the guards, which now throw on malformed `rows`/`age_seconds` on the clean sweep branch (S6, S9) as the ruling asked.

### Open

1. **Minor · `web/lib/trust.ts:163-171`** — with a caveat word AND an unrecognised or unstated word in the same set, the caveat arm returns early and the other input is named nowhere: M1 `[adapter-output, replayed]` → label `weETH price is adapter output`, title `adapter-output` (ETHFI's `replayed` is absent from label, detail and title); M3 `[adapter-output, ""]` likewise. Ruling #8 asks that every affected input be named. Fix: after the caveat clauses, append `; ETHFI provenance not recognised` (or `not stated`) to the label and the unrecognised words to the title; pin M1.
2. **Minor · `web/lib/trust.ts:161` (pinned at `spec:29`)** — the provenance ok arm's visible detail is the wire word `engine-exact` (M5). This is the brief's own pin and R5's wording ("`engine-exact` ok"), so it was not among the eleven findings; the coordinator's re-review rule ("no arm can print a wire verdict/provenance word as visible prose") reaches it. Needs a ruling either way: keep the pin as the sanctioned exception, or change the detail to plain words (`oracle-direct`) with `title: "engine-exact"` and update `spec:29`.
3. **Minor · `web/tests/unit/trust.spec.ts`** — ruling #11 "pins for every arm" is not complete. Unpinned arms, each producing sane output in the probes: provenance dim `no price inputs` (`trust.ts:158`, M6); reconcile `contradictory receipt` (`:197`, U2 — the implementer flagged it); reconcile pass-with-drift `2 drifted rows` without the suffix (`:186`, U1); the gated fallback's `1 row drifted` and `no rows in the receipt` (`:196, :200`, U3–U4); the `reorg-unacked` word (`:51`, Q4 `weETH price behind an unacknowledged reorg`); stale with a null age (`:124`, Q3 `weETH age unknown · budget 180s`).

Not opened (nits, for the record): the header comment at `trust.ts:12-13` says an unmeasured age is dim, but a partially unmeasured set is `ok` on the measured oldest (Q1/Q2 `35s · within 180s`), which is what ruling #1 asked for — the comment overstates by one word; the broken-price group joins symbols with `, ` (`weETH, ETHFI prices missing`, Q5) while provenance uses `andList` (`weETH and ETHFI prices …`) — two styles for the same job.

---

## Re-review 2 (f4ff9d7)

**Range:** `16d5710..f4ff9d7` (one commit; `web/lib/trust.ts` +16/−8, all inside `provenanceItem` at `:156-186`; `web/tests/unit/trust.spec.ts` +16/−1: one pin updated, eight added). Exported interface unchanged.
**Verdict:** RE-REVIEW all-addressed. The three open items are closed, nothing regressed, and no arm prints a wire verdict or provenance word as visible prose.

### How this was verified

- Working tree equals `f4ff9d7` for both files (`git diff f4ff9d7 -- …` empty; HEAD is `f4ff9d7`). `npx playwright test --project=unit tests/unit/trust.spec.ts` → `10 passed (2.2s)`. `npx eslint` on both files → clean. Serena diagnostics on both files → none.
- Re-ran both probe files (63 inputs) against the round-2 module; quoted below. Grepped every probe's visible `label | detail` for the eight wire words (`engine-exact`, `adapter-output`, `uncapped-feed`, `ratio-reference`, `replayed`, `no-as-of`, `over-ceiling`, `reorg-unacked`): no hit in either file's output.
- Re-derived each new pin by hand against the fixtures.

### The three items

| # | Ruling | Code | Probe / pin | |
|---|---|---|---|---|
| 1 | A caveat word beside an unrecognised/unstated one names the second input in the detail and carries its word in the title | `trust.ts:165-168` splits `offDirect` into `caveats` and `others`; `:168` one clause per other input (`… provenance not recognised` / `not stated`); `:179` detail `["not oracle-direct", ...otherClauses]`; `:181` title = caveat words then non-empty other words; `:184-185` dim arms read the same `others` split | M1 `[adapter-output, replayed]` → `warn · weETH price is adapter output · not oracle-direct; ETHFI provenance not recognised · title=adapter-output; replayed`; M2 order swapped names weETH; M3 `[adapter-output, ""]` → `… ; ETHFI provenance not stated · title=adapter-output` (an empty word is not put in the title); M4 `[replayed, ""]` unchanged → `dim · provenance not recognised · title=replayed`; pin `spec:128-134` | ✅ |
| 2 | Ok arm's visible detail `the engine's own inputs`, `engine-exact` in the title; no arm prints a wire provenance/verdict word as prose | `trust.ts:161-162` | M5 → `ok · Price provenance · the engine's own inputs · title=engine-exact`; pin `spec:29` updated with the title asserted; the wire-word grep over all 63 probes is empty (the only wire word in visible text anywhere is `missing`, which is English and brief-pinned; `plainCause`'s `refused (G3)` fallback, C4, is the phrasebook's own in an untouched file) | ✅ |
| 3 | The previously unpinned arms are pinned | `spec:102` `reorg-unacked` → `weETH price behind an unacknowledged reorg`, title `reorg-unacked` (`BROKEN_WORDS`, `trust.ts:51`); `spec:103` stale with null age → detail contains `age unknown` (`:124`); `spec:135` `provenance([])` → dim `no price inputs` (`:158`); `spec:153` weld 30/29 → `30 exact of 29 Cash rows · contradictory receipt` (`:206`); `spec:155` pass, exit 0, drift 2 → `2 drifted rows` (exact string, so the absent suffix is pinned; `:195`); `spec:156` `welds: []`, 86/87 → `1 row drifted` (`:209`, `plural(1)`); `spec:157` `welds: []`, 0/0 → `no rows in the receipt` (`:205`) | each re-derived: 30 > 29 → the contradictory arm; `passed` true ∧ drift 2 → no suffix; 87 − 86 = 1 → singular; compared 0 → dim with `cash = ""` | ✅ |

### Regression

The nine untouched original pins hold; the tenth (`spec:29`) changed by ruling #2 and is asserted with its title. Every round-1 and round-2 probe outside `provenanceItem` produced the same output as at `01d28f5` (reconcile R1–R8 and computed C1–C4 quoted identically; the sweep and prices sections are untouched by this diff). Within `provenanceItem`, V3–V6 are unchanged; only V1/V2 (the mixed case) changed, in the ruled direction.

### The two accepted nits

Neither is load-bearing: the header comment at `trust.ts:12-13` describes intent one word too strongly and steers no code path; the `, ` join at `:118` versus `andList` at `:173` is a style difference between two arms that both name every input. Leaving both as-is is fine.

### Open

None.
