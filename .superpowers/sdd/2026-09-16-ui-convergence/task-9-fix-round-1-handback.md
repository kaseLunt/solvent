# Task 9 · fix round 1 — the controller's record of the implementer's hand-back

The implementer (a50c1cf94d886f7a6) reported that its write to `task-9-report.md` was refused, and returned the
section in its hand-back instead. This file is the CONTROLLER's record of that hand-back (2026-09-20), kept beside the
ledger so the reviewer can read it. It is the implementer's account, not a verified one. `task-9-report.md` itself was
not edited on the implementer's behalf.

Commits: STEP 1 `6acf8d1` (13 paths) · STEP 2 `c79a773` (5 paths). Both by pathspec, staged by name, scope gate and
hooks passed, no attribution line. Gates as reported: tsc + eslint clean, unit 937 / 937; e2e pins written,
`--list`-parsed only (lab.spec.ts: 43 tests), not run.

## I1 — a refusal without a string `code`
- `lab-classify.ts`: both envelopes admit a refusal element only when it is an object whose `engine` is a non-empty
  string and whose `code` is a string; the failing member is named (`excluded_engines[i].code` / `.engine`); a
  non-object element is named `excluded_engines[i]`.
- `readEngine` and `readsAsAnswer` classify the envelope first: such a body is unreadable and never enters the hold;
  `plainCause` is never handed a non-string (comment at the call site); `refusal-phrasebook.ts` untouched.
- The spec line that blessed `{ engine: "debt_manager" }` is flipped.
- Pins: envelope spec "a refusal is read only when…" (13 cases, both envelopes); lab-view.spec "a refusal without a
  string code is named and never read…" (three shapes through `readEngine`, the view, the library word; a held result
  stands; an empty code reads as withheld with the phrasebook's sentence); lab-reading.spec (never moves into the hold).
- Failed first: yes, observed (`readsAsAnswer` returned true for the code-less refusal).
- DEVIATION: an EMPTY-string `code` is admitted (`EngineRefusal.code` is `type: string`, no `minLength`,
  api/openapi.yaml:2379; the phrasebook has its own sentence "the engine gave no reason"); `engine` must be non-empty.
  Pinned both ways; reversing is a one-token change in `aRefusal`.

## I2 — a body that is not a JSON object
- `lab-classify.ts`: `BODY_NOT_OBJECT = "the response body is not a JSON object"` and `contractFaults(names)` — the one
  place a classifier's names become the reasons a reader sees. Both envelope classifiers return that sentence first for
  null, a primitive or a list. `lab-view.ts` and `lab-compare.ts` word faults through `contractFaults`.
- Run path → the contradictory state with that sentence, nothing of the body carried. Set path → "The set does not
  answer the request. Faults: the response body is not a JSON object. …". A hold stands on both. `runbookSet.ts`
  needed no change (already verbatim).
- Pins: envelope spec; lab-view.spec "a 2xx body that is not a JSON object is a named answer on both paths…" (five
  shapes, run and set, bare and over a hold); lab-reading.spec (the updaters never throw); lab-compare.spec; e2e
  "compare: a set 2xx whose body is JSON null…" + the null leg of I3's e2e.
- Failed first: yes, observed (`reading 'batch'`, `reading 'evaluation'`).

## I3 — `runbook.ts`: the sealing is total
- `runbook.ts` exports `sealRunBook(body: unknown)`: a non-object body and a non-list `engines` pass verbatim; an
  engine that is not an object, a projection that is not an object or has no horizon list, pass verbatim; each horizon
  is sealed individually via `refineProjectionHorizon`, only when it carries true / false / null.
- Every 2xx JSON body settles `ok` for the classifiers to name; only a transport failure is "unreachable"; a 2xx that
  is not JSON stays the failed arm it was. The five formerly-dead classifier names now print from the caller's seam.
- ONE INPUT CLASS BEYOND THE RULING: a horizon whose `becomes_liquidatable` is not boolean-or-null made
  `liquidationVerdict` throw → "unreachable"; sealing is now per horizon and `classifyRunBookEngine` names
  `projection.horizons[i].becomes_liquidatable` for a horizon left unsealed.
- Pins: new `tests/unit/lab-run-book-seal.spec.ts` (6 tests through `runBookScenario` with a stub `fetchImpl`, each
  asserting `kind: "ok"` and that the classifier's name is reached); e2e "a service that answered 200 is never
  unreachable…" (engines missing → contradictory, names `engines`, never "could not be reached"; over a held result
  the banner names it; after a second answer of JSON null the hold still stands for batch 18,251).
- Failed first: yes, observed (four of six seal tests failed on the old `runbook.ts` with the review's TypeErrors).
  Every committed and demo fixture, sealed then classified, is clean.

## I4 — one word function, the Inspector's words
- `rowVerdictWord` and `RowVerdictWord` retired. `AddressWorkspace.tsx` prints `stressVerdictWords(rowVerdict(r))`
  from `address-stress.ts` — the same expression `StressTable.tsx` uses. A holding projection reads "Not within 90d",
  a flipping one "Within 90d", on both pages; tones unchanged. No stale references (Serena + grep).
- DEVIATION from the ruling's letter: `lab-address.ts` does NOT import the word function — the component imports it
  directly as `StressTable.tsx` does; `lab-address.ts` has no use for it and an unused import fails lint.
- Pins: lab-address.spec (cell test re-pointed); new "one row, one header, one set of words on both pages — by
  construction" (output for a holding and a flipping projection from the shared demo fixture; both table sources call
  the shared function from `@/lib/address-stress`; `lab-address` exports no `*VerdictWord*`); e2e "Yes · within 90d" →
  "Within 90d", the one-address demo test asserts "Not within 90d" with its hover.
- Failed first: by construction only (the source/export assertions fail on the parent; no separate probe).

## Minors
- TAKEN: M1 (both corners PINNED, not unified — the record's rule (the body alone) governs the hold, the view's rule
  (the body under the definition) governs release; they part only when the body is version-skewed or the definition
  does not model Cash while the Cash row is malformed; unifying would make the view call those bodies contradictory
  before "definition changed" / "not modelled" — a behaviour change not taken without a ruling; documented on
  `readsAsAnswer`); M3 (`CompareCard`'s failed-with-nothing-held arm prints the lib's `compareFailedLine`); M4 dek half
  ("A horizon with an unreadable duration carries no verdict." via `sentence(cannotSayTitle(...))`); M5 (`isRecord`,
  `readableSide` un-exported; `Banner`, `HeldCondition`, `Retained` moved to `lab-headline.ts`, re-exported by
  `lab-view.ts`); M6 (printed string scalars classified: run-book `served_at`, `scenario_config_version`,
  `scenario_id`, `scenario_version`, `label`, `path_assumption`; `applied_shocks[i].asset/.source`,
  `held_flat[i].asset/.source`; set `results[i].scenario_id/.label`; `unmeasurable_engines[i].engine/.reason`);
  M7 (the (b) e2e pin's second body is malformed in the Cash row too).
- LEFT: M2 (the Inspector's null-scale room word — cause in `inspector-view.ts`, the lab has the same ambiguity; needs
  a ruling and a view field); M3 remainder (`CompareCard`'s idle/running strings, the freshness notice, "No plot…");
  M4 (three copies of the horizon-interest line; negative `extraInterest` — out by ruling); M5 (`address-stress.ts`
  still imports `UNREADABLE_SCALE` from `lab-headline` — a neutral home is a cross-page move).

## Implementer's concerns
1. The empty-`code` admission (above). 2. The extra I3 input class (above). 3. I4's letter (above). 4. M1 pinned, not
unified (above). 5. The classifier now refuses more (non-string printed scalars, the unsealed horizon) — every
committed and demo fixture classifies clean and every such member is `required` in the schema.
