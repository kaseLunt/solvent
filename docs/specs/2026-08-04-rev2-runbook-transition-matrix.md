# Contract 1.7.0 `hf_transitions`: the server-provided before-to-after transition matrix on the scenario run-book

**Status:** REV4, gate round 46 findings applied. Read-only research; nothing in this document has been written to the repo outside this file.
**Scope:** `POST /v1/scenarios/{id}/run-book`, `RunBookEngine`. Additive only.
**Supersedes:** `docs/specs/2026-08-04-draft-runbook-transition-matrix.md`.

**Sources re-read and verified for this revision.** Every symbol named here was located before it was cited; a name that could not be located was removed rather than kept.

- `cmd/api/p5_runbook.go` (`handleRunBook`, `measureRunBook`, `runMeasure.bucket` at `:265`, `runMeasure.wire`, `runBookMovers`)
- `cmd/api/handlers.go` (`histogramEdges` `:392-403`, `edgeWad`, `histogramComparator` `:415`, `bucketIndexOf`, `coverage` `:690-715`, `engineRefusals` `:119`, `wirePosition`)
- `cmd/api/read.go` (`reconstructAll` `:692-707`)
- `cmd/api/fixture_test.go` (`fxAavePosition` `:183`, `fxAaveRefused` `:250`, `fxDMRefused` `:422`, `fxPositions` `:745`, `fxMDCollateralDown` `:609`, `fxMDDebtInShockedAsset` `:657`, `fxMixedDirectionBatchWrite` `:706`, `fxWithheldAggregates` `:805`)
- `cmd/api/fixture_db_test.go` (`seedWithheldBatch` `:398`, `seedBatch` `:423`)
- `cmd/api/p5_runbook_bsplit_db_test.go` (`seedMixedDirectionBatch` `:229`, `TestRunBookMoversTotalIsNotTheNetEligibilityChange` `:252-335`)
- `cmd/api/contract_sweep_law_test.go`, `cmd/api/p5_runbook_bsplit_test.go`, `cmd/api/p5_runbook_example_db_test.go`, `cmd/api/p5_runbook_evidence_db_test.go`
- `internal/risk/aave.go`, `internal/risk/dm.go`, `internal/risk/math.go`, `internal/risk/scenario.go`, `internal/risk/types.go`, `internal/risk/scenarios/*.json` (15 files)
- `internal/store/risk.go` (the `const` block `:1563-1568`, whose POSITION status vocabulary is `:1566-1567` and whose `:1564` is the unrelated batch status `RiskBatchComplete`; `riskBatchCompleteConjuncts` `:1583-1631`), `internal/store/migrations/00013_risk_tables.sql`
- `api/openapi.yaml`, `packages/client-ts/test/readme-sync.test.ts` (`SEALED_FIELD_NAMES` `:130-155`, `HAZARDOUS_NAMES` `:165`, the lint regex `:168` applied at `:316`, `MarginProbeBudget` `:195`, `DeepNullableBooleanKeys` `:226-242`, `DeepSchemaSweep` `:257-259`, the two both-ways constants `:297` and `:300`), `packages/client-ts/src/generated/schema.ts`, `packages/client-ts/src/types.ts`
- `packages/client-ts/src/client.ts` (`SolventClient` `:233`, `SCENARIO_ID_PATTERN` `:106`, **`runBookScenario` `:559`**), `packages/client-ts/dist/client.d.ts` `:294`
- `web/app/lab/labRunBookLines.ts`, `web/lib/runbook.ts` (module header preamble), `web/tests/fixtures/`

**Quotation law used in this document.** Where a repo string is quoted in a blockquote below, the source's em-dashes are normalized to commas so this document stays inside the no-em-dash prose rule. Those blockquotes are therefore NOT byte-exact against their sources, and each one says so at the point of use. Every other citation is a line reference, not a transcription.

---

## 1. Why the two histograms provably cannot do this

The run-book already carries `before.hf_histogram` and `after.hf_histogram` per engine, plus a `movers` list capped at 20. The web layer already states, in its own code, that the flow question is unanswerable from that pair. From `web/app/lab/labRunBookLines.ts`, `histogramShiftReadingLine`'s docblock, joining `:49-52` and `:56-58`, with the source's em-dash after "POPULATIONS" (`:50`) normalized to a comma per the quotation law above:

> "The only quantity derivable here is `belowOne(after) − belowOne(before)`, and that is a difference of two POPULATIONS, not a count of accounts that crossed. An account that fell below 1.00 and another that rose above it cancel exactly, and this response carries nothing that would reveal either. The honest options were: serve the gross count (the API does not), compute it here (impossible from two histograms), or DISCLOSE the limitation."

Two marginals do not determine a joint distribution. For 8 buckets there are combinatorially many joint tables with the same two margins, and the client has no basis to pick one. `movers` does not close it either: it is capped at 20, it is ranked by drop magnitude on Aave and by eligibility flip on the Debt Manager rather than by lane change, and on Aave it structurally excludes every account whose health factor rose and every no-debt account (`runBookMovers`, `cmd/api/p5_runbook.go:781-787`). A Sankey drawn from marginals plus a truncated top-20 would be a picture the server never computed, which is a D-013 defect: it invites a confident wrong reading from an honest user.

The joint distribution must come from the server, because only the server holds both sides of the same position row in the same request.

### 1.1 The committed fixture that makes the case concretely

`seedMixedDirectionBatch` plus `eth_minus_30` (`cmd/api/p5_runbook_bsplit_db_test.go:229`, asserted at `:252-335`) already seeds the offsetting case, and the existing test already pins the numbers:

| account | before | after | before lane | after lane |
|---|---|---|---|---|
| A (`0xD0D0…0001`) | 1.20 | 0.84 | 4 (`1.10 – 1.25`) | 0 (`< 0.90`) |
| B (`0xD0D0…0002`) | 1.08 | 0.756 | 3 (`1.05 – 1.10`) | 0 (`< 0.90`) |
| C (`0xD0D0…0003`) | 0.74375 | 1.0625 | 0 (`< 0.90`) | 3 (`1.05 – 1.10`) |

The below-1.00 population moves by exactly one (1 to 2) while three rows changed lane and one of them left the region entirely. No pair of marginals distinguishes that book from a book where one account fell and nothing else moved.

This is also the fixture that carries the debt asymmetry of §2.1: C's DEBT leg is weETH (`fxMDDebtInShockedAsset`, `cmd/api/fixture_test.go:657`), so the same shock that sinks A and B shrinks C's priced debt. §5.3 gives the exact strings.

### 1.2 The non-goal, stated up front

`hf_transitions` does not publish an eligibility verdict. On the Debt Manager the lanes are the exact rational `maxBorrowLT/borrowings`, a disclosure per `histogramComparator` (`cmd/api/handlers.go:415-423`), and a transition into a below-1.00 lane is not a liquidation flip. The verdict path remains `newly_eligible_accounts` and `movers` / `movers_total`. The server must not serve a "crossed into eligible" count derived from lanes. A client that knows the comparator may derive a region count from the cells and must label it in the comparator's own vocabulary, exactly as `LabRunBookDetail.tsx` already does with its crit-tint asymmetry.

---

## 2. Wire shape

New field on `RunBookEngine`, per engine and not per aggregate, because the matrix spans both sides and is a property of neither one:

```
RunBookEngine.hf_transitions: RunBookTransitions   (required, additive)
```

### 2.0 The unit is a POSITION ROW, and one naming law covers the whole subtree

Every counter on this surface counts POSITION ROWS on this engine in this batch, not distinct addresses. This is forced by the code: `m.accounts++` fires once per position in `measureRunBook` (`cmd/api/p5_runbook.go:661` and `:698`), and `m.bucket(...)` is called once per position beside it, so the histogram tallies the matrix must reconcile against are themselves per-row.

The repo already has this vocabulary and it is used here rather than a second one: `coverage.batch_positions`, and `Batch.refused_count`, whose contract description reads "Refused POSITION ROWS" (`api/openapi.yaml:1777-1782`).

**THE NAMING LAW, stated so that it is checkable and so that this subtree obeys it.** In `hf_transitions` and its children:

1. A field whose name ends in `rows` holds a count of position rows, or an array of such counts, and nothing else. That covers `total_rows`, `measured_rows`, `unmeasured_rows`, `unmeasured_refused_in_batch_rows`, `unmeasured_excluded_by_this_layer_rows`, `held_rows`, `lane_changed_rows`, the two dense margin arrays `from_rows` and `to_rows`, and a cell's `rows`.
2. No field in this subtree is named `*_accounts`. The 1.6.0 fields `before.accounts` / `after.accounts` keep their existing names (additive-only forbids renaming them) and the note states that they carry the same per-row semantics.
3. Arrays of OBJECTS are named for their elements, never for a count: `lanes`, `outflows`, `cells`. Nothing named `*_rows` is an array of objects, and nothing holding objects ends in `rows`.

Rule 3 is the correction the earlier draft of this revision needed. It had `RunBookTransitions.rows` as an array of row objects while `RunBookTransitionCell.rows` was an integer count, two levels apart, so `transitions.rows.length` meant "10 lanes" and `cell.rows` meant "a population". The row-object array is now `outflows`.

**The two margins are also symmetric.** Both are dense integer arrays at the top level, in lane order: `from_rows[i]` is lane i's whole BEFORE population and `to_rows[i]` is lane i's whole AFTER population. The earlier shape put the row margin inside `rows[i].from_rows` and the column margin in a bare array, which made two identical facts look like two different kinds of fact and duplicated the row margin inside an object that also carried the cells.

**One row IS one account on this engine today, but that fact belongs to the store and not to the wire.** `risk_positions` declares `PRIMARY KEY (batch_id, engine, account)` (`internal/store/migrations/00013_risk_tables.sql:317`). The serving layer does not get to assume it silently, and it does not get to check only half of it either: the check must cover EVERY row the matrix places, measured and unmeasured alike. §4.5 does that over the whole lane slice; the earlier `len(m.states) == m.accounts` test could not, because both of those fields are written only inside `measureRunBook` (`:661`/`:671` and `:698`/`:710`) and the unmeasured rows are appended by the handler fold (§4.3), which touches neither.

`movers` is account-level (it joins the two `states` maps, which are keyed by `common.Address` and collapse duplicates). The matrix is row-level. The note names the difference so the two counts are never subtracted from one another.

### 2.1 The lane vocabulary: one bucket law, extended by exactly two lanes

Lanes are the ordered vocabulary both margins are stated in. There are `len(histogramEdges) + 2 = 10` of them.

| index | kind | meaning |
|---|---|---|
| 0…7 | `bucket` | the SAME eight buckets `hf_histogram.buckets` serves, in the same order, with the same `label` / `lower_wad` / `upper_wad`, placed by the same `bucketIndexOf` |
| 8 | `infinite` | rows with NO DEBT. The health factor is undefined-because-unbounded, never a large number and never a bucket. This is `hf_histogram.infinite_count`'s population. |
| 9 | `unmeasured` | rows this run measured on NEITHER side. This is `hf_histogram.refused_count`'s population. §2.2 says exactly what is in it and where the reader finds those rows. |

The lane count is `N+2`, not `N`, precisely so the row and column margins can equal the WHOLE histogram rather than only its bucket array. A matrix over 8 lanes would silently drop the infinite and unmeasured populations, which is the failure mode this surface exists to make unconstructible.

Lane 9's `kind` is `unmeasured` and its label is `"not measured"`. The 1.6.0 histogram field it reconciles against is called `refused_count`, and that name predates the finding in §2.2. The note states the identity in one sentence so the two names cannot read as two populations, and §9.2 corrects the 1.6.0 description that gives `refused_count` the wrong definition.

```yaml
    RunBookTransitionLane:
      type: object
      additionalProperties: false
      required: [index, kind, label, lower_wad, upper_wad]
      description: |
        One lane of the transition matrix (ADDED 1.7.0). Lanes 0..N-1 ARE the
        buckets `hf_histogram` serves: same order, same labels, same edges,
        placed by the same law. The two lanes after them are the two tallies
        that sit BESIDE those buckets on every histogram this surface serves.
        There is no lane a histogram does not have and no histogram tally
        without a lane.
      properties:
        index:
          type: integer
          description: |
            This lane's position. It is the value `outflows[].from` and
            `cells[].to` reference, and the index at which `from_rows` and
            `to_rows` carry this lane's two whole populations.
        kind:
          type: string
          enum: [bucket, infinite, unmeasured]
        label:
          type: string
          description: |
            For a `bucket` lane this is byte-identical to the corresponding
            `hf_histogram.buckets[].label`. For the two others it names the
            population in the words that describe it: "no debt (unbounded)" and
            "not measured".
        lower_wad: { $ref: "#/components/schemas/NullableDecimal" }
        upper_wad:
          allOf: [{ $ref: "#/components/schemas/NullableDecimal" }]
          description: |
            Null on the open-ended top bucket AND on both non-bucket lanes,
            which have no edges at all. An unbounded health factor is not a
            large number, and a row nobody measured has no health factor to
            bound.

    RunBookTransitionCell:
      type: object
      additionalProperties: false
      required: [to, rows, debt_before_usd, debt_after_usd]
      description: |
        One occupied cell (ADDED 1.7.0): the position rows whose BEFORE lane is
        this outflow's `from` and whose AFTER lane is `to`. A cell is emitted
        only when it holds at least one row.
      properties:
        to:
          type: integer
          description: The AFTER lane's `index`.
        rows:
          type: integer
          minimum: 1
          description: |
            Position rows in this cell. An empty cell is ABSENT, never a row of
            zeros. Like every other field here whose name ends in `rows`, this
            is a COUNT of position rows.
        debt_before_usd:
          allOf: [{ $ref: "#/components/schemas/NullableDecimal" }]
          description: |
            The exact sum of BEFORE-side debt over the rows in this cell THAT
            THIS RUN MEASURED, at this engine's `usd_decimals`, in this engine's
            own unit, never summed with another engine's. Each row contributes
            the debt computed on the BEFORE side for that row; the figure is
            derived per side and never from the lane. NULL, never "0", when this
            run measured none of this cell's rows, which today is exactly the
            (9,9) cell: a debt nobody computed and a debt of zero are different
            facts. A no-debt row (lane 8) contributes an exact "0" on the side
            where it has no debt, because that zero IS knowable.
        debt_after_usd:
          allOf: [{ $ref: "#/components/schemas/NullableDecimal" }]
          description: |
            The same sum on the AFTER side, derived the same way. It is a
            SEPARATE figure because debt on this engine may be PRICED: Aave's
            `total_debt_base` is the per-reserve sum of
            `MulDivCeil(live_debt, price, den)`, so a shock that moves the price
            of an asset a row BORROWS moves it. The Debt Manager's `borrowings`
            is USD-normalized and is copied verbatim across the shock, so on
            that engine the two figures are equal by construction. One debt
            number per cell could conserve on at most one margin.

    RunBookTransitionOutflow:
      type: object
      additionalProperties: false
      required: [from, cells]
      description: |
        One BEFORE lane's outflow (ADDED 1.7.0): where that lane's rows went.
        Every lane gets an entry, including empty ones, so the shape is stable.
        This lane's whole BEFORE population is `from_rows[from]`; it is not
        repeated here.
      properties:
        from: { type: integer }
        cells:
          type: array
          description: The occupied cells of this outflow, ascending by `to`. Empty when this lane held no row before the shock.
          items: { $ref: "#/components/schemas/RunBookTransitionCell" }

    RunBookTransitions:
      type: object
      additionalProperties: false
      required:
        [comparator, wad_scale, lanes, outflows, from_rows, to_rows, total_rows,
         measured_rows, unmeasured_rows, unmeasured_refused_in_batch_rows,
         unmeasured_excluded_by_this_layer_rows, held_rows, lane_changed_rows, note]
      description: |
        The BEFORE-to-AFTER flow of this engine's POSITION ROWS (ADDED 1.7.0): a
        joint distribution over the SAME lanes the two `hf_histogram`s beside it
        are stated in.

        THE TWO HISTOGRAMS CANNOT PRODUCE THIS. Two marginals do not determine a
        joint: a row that fell below 1.00 and another that rose above it cancel
        exactly in a marginal difference, and no client-side arithmetic can
        separate them. `movers` cannot either: it is capped, and it is ranked by
        drop magnitude or by an eligibility flip rather than by lane change. So
        the joint is computed HERE, in the one place that holds both sides of
        the same row.

        The lanes ARE the histogram's tallies, so the margins of this matrix are
        the two histograms exactly. Nothing is bucketed twice and no second edge
        table exists.

        EVERY FIELD HERE WHOSE NAME ENDS IN `rows` IS A COUNT of position rows
        on this engine, or an array of such counts, in the same unit
        `coverage.batch_positions` uses, never a count of distinct addresses.
        Arrays of objects are named for their elements: `lanes`, `outflows`,
        `cells`.
      properties:
        comparator:
          type: string
          enum: [hf_wad, hf_num/hf_den]
          description: |
            The SAME per-engine vocabulary `RunBookHistogram` names, repeated so
            this matrix is readable without the histograms in scope. On the Debt
            Manager the lanes are the exact rational maxBorrowLT/borrowings, a
            DISCLOSURE. A move into a below-1.00 lane is NOT an eligibility
            flip; take eligibility from `newly_eligible_accounts` and `movers`.
        wad_scale: { $ref: "#/components/schemas/Decimal" }
        lanes:
          type: array
          minItems: 1
          items: { $ref: "#/components/schemas/RunBookTransitionLane" }
        outflows:
          type: array
          minItems: 1
          description: |
            One entry per lane, in lane order, always. A lane with no BEFORE
            population still gets an entry, with no cells; its zero is stated by
            `from_rows` at the same index.
          items: { $ref: "#/components/schemas/RunBookTransitionOutflow" }
        from_rows:
          type: array
          minItems: 1
          description: |
            THE ROW MARGIN: each lane's whole BEFORE population, in lane order.
            `from_rows[i]` EQUALS the corresponding tally on
            `before.hf_histogram` (`buckets[i].count` for a bucket lane,
            `infinite_count` for lane N, `refused_count` for lane N+1), and it
            equals the sum of `outflows[i].cells[].rows`.
          items: { type: integer }
        to_rows:
          type: array
          minItems: 1
          description: |
            THE COLUMN MARGIN: each lane's whole AFTER population, in lane order,
            stated the same way against `after.hf_histogram`. It equals the
            column sums of the cells. Both margins are served densely so that
            the sparse cells lose nothing: an absent cell is a KNOWABLE zero,
            and these dense margins are what make that knowable.
          items: { type: integer }
        total_rows:
          type: integer
          description: |
            Every position row of THIS ENGINE that this run touched, the grand
            total of the matrix. It is `before.accounts` plus `unmeasured_rows`,
            and it is also `after.accounts` plus the same number. Nothing is in
            two cells and nothing is in none.

            IT IS A PER-ENGINE TOTAL AND IT RECONCILES AGAINST NOTHING ELSE.
            It is not `coverage.batch_positions`, which counts the WHOLE batch
            including engines this scenario does not cover. It is not
            `coverage.in_book` either, and summing it across `engines[]` does not
            produce `coverage.in_book`: a WITHHELD engine's rebuildable rows are
            inside `coverage.in_book` while that engine has no `engines[]` entry
            at all, and every engine's unmeasured rows are inside `total_rows`
            while being outside `coverage.in_book`. The two errors can cancel on
            a given book, so an equality observed once is not the law. The note
            beside this field says the same thing in prose.
        measured_rows:
          type: integer
          description: |
            The rows this run MEASURED on both sides, that is `total_rows` minus
            `unmeasured_rows`. It equals `before.accounts` and `after.accounts`.
            It is the denominator every movement statement on this surface is
            made against.
        unmeasured_rows:
          type: integer
          description: |
            Rows of this engine that reached NO arithmetic in this run. They
            carry no health factor on either side, they sit in exactly one cell
            (lane N+1 to lane N+1), and this run computed no debt for them, so
            that cell's two debt figures are null rather than "0". This is NOT a
            statement that the row holds no debt: the batch's persisted numbers
            for these rows are served, unchanged, by `/v1/positions` and
            `/v1/address/{addr}`.
        unmeasured_refused_in_batch_rows:
          type: integer
          description: |
            The part of `unmeasured_rows` that RISKD itself refused: rows whose
            persisted status is `refused` (a missing price witness, a
            never-swept collateral position, and the rest of the gate
            vocabulary). Every one of them is inside `coverage.refused_in_batch`,
            which is a BOOK-WIDE count on this response, and each is served per
            row with its refusal code and detail by `/v1/positions` and
            `/v1/address/{addr}`. They are NOT in `coverage.excluded`.
        unmeasured_excluded_by_this_layer_rows:
          type: integer
          description: |
            The part of `unmeasured_rows` that riskd COMPUTED and THIS SERVICE
            could not rebuild or could not verify against the persisted row.
            Every one of these is listed, with its engine, account, code and
            reason, in `coverage.excluded`, and counted in
            `coverage.excluded_by_this_layer`.
        held_rows:
          type: integer
          nullable: true
          description: |
            MEASURED rows whose lane did not change: the diagonal over lanes 0..N,
            excluding the unmeasured lane entirely. NULL when `measured_rows` is
            0, because "0 rows held" over a book this run never measured would
            claim a measurement nobody made. When non-null,
            `held_rows + lane_changed_rows + unmeasured_rows == total_rows`.
            HAZARD: `null` and `0` are different statements and `!held_rows`
            collapses them.
        lane_changed_rows:
          type: integer
          nullable: true
          description: |
            MEASURED rows whose LANE changed: the off-diagonal, and the gross
            count the two histograms structurally could not give. NULL under the
            same condition as `held_rows`, and hazardous under `!` for the same
            reason.

            READ IT FOR WHAT IT IS. A row that moved a long way INSIDE one lane
            is not counted. A row that moved one wei across an edge is. It is
            therefore a function of `histogramEdges`, the histogram's own bucket
            table, and not of the scenario's magnitude. It is NOT `movers_total`
            (Aave ranks strict health-factor drops; the Debt Manager counts
            eligibility flips) and NOT `newly_eligible_accounts` (a signed net),
            and on a real committed fixture all three are different numbers. It
            is also not a crossing count of any particular edge: derive that
            from the cells, and on the Debt Manager label it as the comparator's
            disclosure rather than as a verdict.
        note: { type: string }
```

### 2.2 What lane 9 actually holds, and where the reader finds those rows

Lane 9's population is exactly the rows that reached no arithmetic. That is `p.input == nil` on an engine the scenario covers (the branch is `cmd/api/p5_runbook.go:426-431`, inside the loop opened at `:425`, whose `refusedByEngine` map is declared at `:424`), folded onto BOTH sides' refused tally by the existing handler (`eb.refused += n; ea.refused += n`, `:581-584`), because a shock does not make a row rebuildable.

That population has TWO upstream causes, and they land in two DIFFERENT places on the coverage block. `reconstructAll` never attempts a row whose `Status != store.RiskPositionComputed` (`cmd/api/read.go:692-707`), so a non-computed row always reaches the handler with `reconstructionErr == ""`, and a row with a non-empty `reconstructionErr` is always `computed`. The two causes are therefore disjoint today, and each has its own coverage surface:

| cause | THE PREDICATE `coverage()` ACTUALLY USES | where coverage puts it |
|---|---|---|
| riskd refused the row | `p.Status == store.RiskPositionRefused` (`cmd/api/handlers.go:701`) | `coverage.refused_in_batch` (a book-wide COUNT; no per-row list on this response) |
| this layer could not rebuild or could not verify it | `p.reconstructionErr != ""` (`cmd/api/handlers.go:704`) | `coverage.excluded_by_this_layer` and the per-row `coverage.excluded[]` array |

**The first predicate is a POSITIVE test on one token, not a negation.** This matters and it is easy to get wrong: `p.Status != store.RiskPositionComputed` and `p.Status == store.RiskPositionRefused` coincide only because the Go POSITION vocabulary is closed to those two tokens, `RiskPositionComputed` and `RiskPositionRefused` at `internal/store/risk.go:1566-1567` (the same `const` block opens at `:1563` with `RiskBatchComplete`, which is a BATCH status and not part of this vocabulary), and `risk_positions.status` carries NO CHECK constraint in the schema. Migration 00013 documents the vocabulary in a comment only:

```sql
    -- 'computed' | 'refused'
    status         TEXT   NOT NULL,
```

A row carrying any third token would satisfy `!= computed`, be counted in `unmeasured_refused_in_batch_rows`, and be served beside a note telling the reader to find it in `coverage.refused_in_batch`, which is incremented on `== refused` and therefore would not contain it. That is a served count pointing at a surface that does not hold its rows, which is the exact defect class this split exists to remove. §4.3 implements the positive test and FAILS CLOSED on anything else.

`coverage()` puts only `p.reconstructionErr != ""` rows into `excluded`. The two refused fixtures the contract example is built from, `fxAaveRefused` and `fxDMRefused`, are both `Status: store.RiskPositionRefused` (`cmd/api/fixture_test.go:254` and `:426`), so the committed 200 example carries `excluded_by_this_layer: 0`, `excluded: []`, `refused_in_batch: 2` (`api/openapi.yaml:1322-1331`). A note that pointed a reader at `coverage.excluded` for those rows would point at an empty array, and it would relabel an UPSTREAM riskd refusal as a serving-layer reconstruction failure.

The wire therefore SPLITS the count rather than paraphrasing it: `unmeasured_refused_in_batch_rows` and `unmeasured_excluded_by_this_layer_rows` sum to `unmeasured_rows`, and each names the coverage field that actually holds its rows. This costs two integers per engine and it is the only way a per-engine pointer can be honest, because `coverage.refused_in_batch` is book-wide while `coverage.excluded[]` is per row with an `engine` field.

**These rows are not empty rows.** `fxDMRefused` carries `Borrowings: bi("1500000000")` (`cmd/api/fixture_test.go:431`) and `wirePosition` serves `Borrowings: bigStr(p.Borrowings)` unconditionally (`cmd/api/handlers.go:965`), so `/v1/positions` and `/v1/address/{addr}` publish 1,500.000000 USD of debt for the very row this matrix describes with two nulls. The null is correct and the reason must be stated correctly: THIS RUN measured nothing for the row. The row itself has persisted numbers on other surfaces, and a user reconciling the two must not find a contradiction.

**There is no second population in lane 9, and the code proves it.** The draft claimed lane 9 also held "measured rows carrying no comparator on that side". No such row is constructible through `measureRunBook`:

- Aave. `ComputeAaveHealth` initializes `IsInfinite: true` (`internal/risk/aave.go:83`) and sets `out.HealthFactorWad = hf` and `out.IsInfinite = false` in the same block, guarded by `AaveHealthFactorWad`'s `ok` (`internal/risk/aave.go:239-247`), and that function returns `ok=false` exactly when `totalDebtBase <= 0` (`internal/risk/math.go:275-278`). So `HealthFactorWad == nil` if and only if `IsInfinite`, and `runMeasure.bucket` tests `st.infinite` first (`cmd/api/p5_runbook.go:266-269`).
- Debt Manager. `ComputeDMHealth` initializes `IsInfinite: true` (`internal/risk/dm.go:80`) and sets `HealthFactor` with `IsInfinite = false` only when `borrowings.Sign() > 0` (`internal/risk/dm.go:171-178`), and `NewRational` refuses a non-positive denominator (`internal/risk/types.go:289-296`). `measureRunBook` copies `st.hfNum, st.hfDen` only `if !h.IsInfinite` (`cmd/api/p5_runbook.go:707-709`), so `hfDen > 0` whenever it is non-nil.

`bucketIndexOf` returns −1 only for a nil `hfWad` on Aave or a nil/non-positive `hfDen` on the Debt Manager (`cmd/api/handlers.go:548-581`). Neither is reachable from this walk. `runMeasure.refused` is therefore structurally 0 from the walk, and `hf_histogram.refused_count` is 100% the unmeasured fold.

Two design consequences follow, and the revision takes both rather than shipping machinery for a population that does not exist:

1. **The mixed cell is deleted.** No cell can hold measured and unmeasured rows together, so `RunBookTransitionCell` carries no per-cell unmeasured counter. A cell's two debts are null exactly when the cell holds only rows this run never measured, which today is exactly cell (9,9). `unmeasured_rows` at the top level is the single statement of that population's size.
2. **The unreachable branch becomes a refusal, not a silent lane.** `measureRunBook` refuses with a named 500 if `bucketIndexOf` ever returns −1 for a state it built (§4.2). Routing such a row into lane 9 would put a MEASURED row's debt behind a null and break the debt reconciliation in §11.10; counting it there would also make lane 9 mean two things. If a future engine legitimately has a comparator-free measured state, the correct response is a NEW lane in this vocabulary and a new histogram tally beside it, and a 500 is what forces that conversation instead of hiding it.

### 2.3 What the shock cannot move, stated as a bound and not as a hope

Lanes 8 and 9 are FIXED SETS across the shock under every committed scenario, and the matrix's description must not imply otherwise.

- **Lane 9.** Its population is the unmeasured fold, which the handler adds to both sides identically. Fixed by construction.
- **Lane 8, Debt Manager.** `infinite` is `borrowings == 0`, and `ApplyScenario` copies debt verbatim: `cp.DebtUSD = copyBig(in.DM.DebtUSD)` (`internal/risk/scenario.go:780`). Fixed exactly.
- **Lane 8, Aave.** `infinite` is `totalDebtBase == 0`. `ApplyScenario` shocks PRICES only; balances are cloned, not scaled. Debt is `MulDivCeil(rv.LiveDebt, p.Value, den)` (`internal/risk/aave.go:182`), which is at least 1 for any positive leg at any positive price, and `indexPrices` refuses a non-positive price outright (`internal/risk/aave.go:299`). So a shocked book either keeps every Aave row's infinite status or fails the whole request with "measuring the shocked book refused".

The honest boundary: the code does not forbid a lane-8 transition in general, it forbids it under the shocks that exist. A hypothetical shock that floored a price to zero would produce a 500, not a row entering lane 8. The note therefore says that entry to and exit from the no-debt lane is not producible by any committed scenario, and `lane_changed_rows`'s description says it counts lane changes without claiming the two non-bucket lanes participate.

There are 15 committed scenarios (`internal/risk/scenarios/*.json`); the deepest price factor among them is 40/100 (`eth_minus_60.json`), which is nowhere near flooring an 8-decimal or 6-decimal price to zero.

### 2.3.1 Which engine's debt can actually move, and under which scenario

This is the fact the two per-cell debt figures rest on, and it must be stated exactly rather than by example.

- **Debt Manager: NEVER.** `borrowings` is USD-normalized and `ApplyScenario` copies it verbatim (`internal/risk/scenario.go:780`), and `ComputeDMHealth` takes `borrowings := orZero(in.DebtUSD)` (`internal/risk/dm.go:104`). `debt_before_usd == debt_after_usd` on every DM cell of every scenario, by construction. `stable_depeg_098_unsnapped` re-prices stable COLLATERAL and not debt; its own `out_of_model` says so ("the Debt Manager's debt leg is USD-NORMALIZED, so a stable depeg re-prices stable COLLATERAL but not outstanding debt - the asymmetry is the point of this scenario").
- **Aave: whenever a shocked asset is a DEBT leg.** `rv.DebtBase = MulDivCeil(rv.LiveDebt, p.Value, den)` per reserve (`internal/risk/aave.go:182`), so the priced sum moves with the price.
- **The three `stable_depeg_*` scenarios cannot move Aave debt at all**, because they declare `engines: ["debt_manager"]` and therefore emit no `aave_v3_etherfi` entry in `engines[]`. Eight committed scenarios name both engines (`eth_minus_{10,20,30,40,50,60}`, `weeth_rate_minus_5`, `weeth_market_depeg_oracles_held`); the other seven name `debt_manager` alone (`btc_leg_minus_20`, `dm_composition_census`, `dm_rate_horizon_plus_200bps`, `ethfi_minus_50`, `stable_depeg_098_unsnapped`, `stable_depeg_0995_in_band`, `stable_depeg_099_boundary`).
- **The committed witness that DOES move it** is `seedMixedDirectionBatch` under `eth_minus_30`. That book's third Aave account, `fxMDDebtInShockedAsset` (`cmd/api/fixture_test.go:657`), holds USDC as collateral and **weETH as debt**: `LiveDebt: fxMDCWeETHDebt = "2000000000000000000"` against `DebtBase: fxMDCDebtBase = "800000000000"`. `eth_minus_30`'s chain-1 propagation set is `{weETH}`, so that leg re-prices at 70/100 and the account's `total_debt_base` goes from `"800000000000"` to `"560000000000"`. The engine's two served totals differ accordingly: `before.total_debt_usd` `"1640000000000"` against `after.total_debt_usd` `"1400000000000"`. §5.3 lays the whole matrix out.
- **The contract's own 200 example does NOT move it.** `weeth_market_depeg_oracles_held` has an empty `shocks` list, and `fxAavePosition`'s only debt leg is USDC, which no committed ETH scenario shocks. Both figures are equal there, which is why the example alone would not have justified serving two.

### 2.4 Sparse cells, dense everything else

- `lanes`: dense, always 10.
- `outflows`: dense, always 10, in lane order.
- `from_rows`: dense, always 10.
- `to_rows`: dense, always 10.
- `cells`: SPARSE. Only cells with `rows >= 1`, ascending by `to`.

An absent cell is a knowable zero, and it is admissible here only because both margins and the full lane vocabulary are on the wire beside it. This is the one absence-as-zero on this surface, and the note says so in as many words. The cost argument is in §6.

---

## 3. Endpoint behavior

No route change, no parameter change, no status-code change. `POST /v1/scenarios/{id}/run-book` continues to 400 on a malformed id, 404 on an uncommitted id, 503 with no servable batch, and to WRITE NOTHING (`TestAPIIssuesNoWritingSQL` continues to hold; this wave adds no SQL literal).

Every engine row that exists today gains exactly one field.

| case | behavior |
|---|---|
| withheld engine | Unchanged. No `engines[]` row at all; named in `excluded_engines`. There is no `refused` / `refusal` pair on `hf_transitions` for the same reason `RunBookHistogram` has none. |
| engine not covered by the scenario | Unchanged. Absent from `engines[]`, named in `notes`. |
| engine with zero rows in the run | `hf_transitions` is served with the full lane vocabulary, both margins all-zero, all outflows empty, `total_rows` 0, `measured_rows` 0, and `held_rows` / `lane_changed_rows` NULL. Same shape law the histogram already follows. |
| engine whose rows are ALL unmeasured | `total_rows == unmeasured_rows`, `measured_rows` 0, both movement scalars NULL, and the only occupied cell is (9,9) with two null debts. This is the case the draft got wrong; see §5.2. |
| market-realization scenario (`weeth_market_depeg_oracles_held`) | `after == before` by construction (the scenario's `shocks` list is empty), so the matrix is exactly diagonal. Serve it. It says "this scenario moved no row between lanes" and nothing more. |
| rate PROJECTION scenario | `afterInputs = beforeInputs` (`cmd/api/p5_runbook.go:489-491`), so the matrix is exactly diagonal. Serve it: suppressing the field would make its absence ambiguous. |
| a covered engine `measureRunBook` has no arm for | 500 with a named reason (§4.6). Today's switch has arms for `risk.AaveEngine` and `risk.DMEngine` only, with no default, so such a row would silently be in zero cells while every margin still "partitioned exactly". |

**The diagonal is NOT a witness of `hfs_unchanged`.** The draft claimed it was, and that claim is deleted rather than reworded. `hfs_unchanged` comes from `risk.ExecutionShortfall(beforeInputs, sc.MarketRealizationsFor())` (`cmd/api/p5_runbook.go:501-508`), which compares health factors on the MARKET-REALIZATION axis. The matrix's diagonality comes from `ApplyScenario` over the scenario's own shock set. Different inputs, and the matrix is strictly weaker: because it buckets, it stays diagonal for ANY health-factor movement that does not cross an edge. A reader told the diagonal corroborates `hfs_unchanged` would conclude the two sides' health factors are bit-identical, which the matrix cannot establish. The engine's existing `market_realization.note` already carries the real assertion ("computed not promised"), and this field adds nothing to it.

---

## 4. Implementation shape (Go)

### 4.1 The shared lane law

In `cmd/api/handlers.go`, immediately beside `bucketIndexOf`. `histogramEdges` is a package-level `var` slice, so these must be `var` and not `const` (`len()` of a slice is not a constant expression):

```go
// The two lanes that sit BESIDE the buckets on every histogram this service
// serves, given indices so a matrix can state its margins over the whole
// histogram rather than over its bucket array alone.
var (
	laneInfinite   = len(histogramEdges)     // rows with NO DEBT
	laneUnmeasured = len(histogramEdges) + 1 // rows this run measured on neither side
	laneCount      = len(histogramEdges) + 2
)
```

There is no `laneIndexOf` wrapper. `bucketIndexOf` stays exactly as it is, and the lane assignment lives in the one place that already computes the tally (§4.2), so a matrix that disagreed with its histogram would require one function to write two different numbers.

### 4.2 The tally and the lane record come from one statement, and the impossible case refuses

`runMeasure.bucket` becomes `runMeasure.place`, which returns an error. The `-1` arm no longer folds into `m.refused`, because §2.2 shows that arm is unreachable and folding it there would give lane 9 two meanings:

```go
type runLaneEntry struct {
	account common.Address
	lane    int
	debtUSD *big.Int // nil ONLY on an unmeasured row
}

// runMeasure gains exactly one field:
//   lanes []runLaneEntry  // ORDERED, one entry per position, in walk order

func (m *runMeasure) place(engine string, st *runAccountState) error {
	lane := laneInfinite
	if !st.infinite {
		idx := bucketIndexOf(engine, st.hfWad, st.hfNum, st.hfDen)
		if idx < 0 {
			// UNREACHABLE by construction: ComputeAaveHealth sets
			// HealthFactorWad exactly when it clears IsInfinite, and
			// ComputeDMHealth sets the rational exactly when borrowings > 0.
			// If this ever fires, the engine has grown a measured state with no
			// comparator and it needs its OWN lane and its OWN histogram tally.
			// Folding it into the unmeasured lane would put a MEASURED row's
			// debt behind a null and break the debt reconciliation.
			return fmt.Errorf("%s: account %s was measured but carries no comparator, "+
				"so it belongs in no bucket and in no existing lane; the histogram and the "+
				"transition matrix both need a new tally before this row can be served",
				engine, st.account.Hex())
		}
		lane = idx
	}
	switch lane {
	case laneInfinite:
		m.infinite++
	default:
		m.buckets[lane]++
	}
	m.lanes = append(m.lanes, runLaneEntry{account: st.account, lane: lane, debtUSD: st.debtUSD})
	return nil
}
```

`runAccountState` gains `account common.Address`, already available as `h.Account` at both call sites in `measureRunBook`.

### 4.3 The unmeasured rows, split by cause with a POSITIVE test on each cause

`refusedByEngine map[string]int` (`cmd/api/p5_runbook.go:424`) becomes a per-engine record. The handler loop already holds the `positionRow`, and it already has both facts.

**This code sits INSIDE `handleRunBook`, which returns nothing.** `handleRunBook` is `func (s *server) handleRunBook(w http.ResponseWriter, r *http.Request)` (`cmd/api/p5_runbook.go:386`), so a refusal here cannot be a `return fmt.Errorf(...)`. It takes the same form every other refusal on this path takes, `writeError(...)` followed by a bare `return`, modeled exactly on the existing "applying scenario ... refused a verified position" arm (`cmd/api/p5_runbook.go:468-470`). The `fmt.Errorf` form appears in this spec only inside helpers that DO return an error: `measureRunBook` (§4.2, §4.6) and `runBookTransitions` (§4.4, §4.5).

```go
type runUnmeasured struct {
	accounts            []common.Address
	refusedInBatch      int // riskd refused: counted by coverage.refused_in_batch
	excludedByThisLayer int // this layer could not rebuild: listed in coverage.excluded
}

// Declared where refusedByEngine is today (cmd/api/p5_runbook.go:424), and it
// REPLACES that map. unmeasuredFor is the get-or-create over it; there is no
// other writer.
unmeasuredByEngine := map[string]*runUnmeasured{}
unmeasuredFor := func(engine string) *runUnmeasured {
	u := unmeasuredByEngine[engine]
	if u == nil {
		u = &runUnmeasured{}
		unmeasuredByEngine[engine] = u
	}
	return u
}

// In handleRunBook's position loop (the loop opens at cmd/api/p5_runbook.go:425
// and this branch is :426-431), replacing refusedByEngine[p.Engine]++ :
if p.input == nil {
	if covers(sc.Engines, p.Engine) {
		acct := common.BytesToAddress(p.Account)
		cause, err := classifyUnmeasured(p.Engine, acct, p.Status, p.reconstructionErr)
		if err != nil {
			// THE HANDLER'S OWN REFUSAL FORM: write and return. There is no
			// error to return from here.
			writeError(w, http.StatusInternalServerError, codeInternal, err.Error(), nil)
			return
		}
		u := unmeasuredFor(p.Engine)
		u.accounts = append(u.accounts, acct)
		if cause == unmeasuredRefusedInBatch {
			u.refusedInBatch++
		} else {
			u.excludedByThisLayer++
		}
	}
	// The ordinary skip for a row that reached no arithmetic. The refusal
	// above has already left the handler, so this is reached only on the two
	// live causes and on a row whose engine this scenario does not cover.
	continue
}
```

**The classification is a PURE function, deliberately, so §7.2 can assert all three of its arms with no database.** The handler holds the `http.ResponseWriter`; the predicate does not need it.

```go
type unmeasuredCause int

const (
	unmeasuredRefusedInBatch unmeasuredCause = iota + 1
	unmeasuredExcludedByThisLayer
)

// EACH LIVE ARM IS THE POSITIVE PREDICATE OF THE COVERAGE COUNTER IT POINTS AT,
// not the negation of the other one. coverage() increments RefusedInBatch on
// `p.Status == store.RiskPositionRefused` (handlers.go:701) and
// ExcludedByThisLayer on `p.reconstructionErr != ""` (handlers.go:704).
// risk_positions.status has NO CHECK constraint (migration 00013:271-272
// documents the vocabulary in a comment only), so a third token must not be
// silently swept into either count.
func classifyUnmeasured(engine string, account common.Address, status, reconstructionErr string) (unmeasuredCause, error) {
	switch {
	case status == store.RiskPositionRefused && reconstructionErr == "":
		return unmeasuredRefusedInBatch, nil
	case status == store.RiskPositionComputed && reconstructionErr != "":
		return unmeasuredExcludedByThisLayer, nil
	default:
		return 0, fmt.Errorf("run-book: %s account %s reached no arithmetic with status %q "+
			"and reconstruction error %q; it is in neither coverage.refused_in_batch nor "+
			"coverage.excluded, so no per-engine count on this response could name a "+
			"surface that actually holds it",
			engine, account.Hex(), sanitize(status), sanitize(reconstructionErr))
	}
}
```

The two live arms are exhaustive over today's data and the reason is checkable: `reconstructAll` sets `reconstructionErr` only on rows it attempted, and it attempts only `Status == computed` rows (`cmd/api/read.go:692-707`). The `default` arm is what makes the served pointer honest if that ever stops being true, and it fires as a named 500 rather than a wrong count.

Two shape points, because an earlier revision got both wrong. First, the refusal in the LOOP is `writeError(...)` plus a bare `return`, never `return fmt.Errorf(...)`: `handleRunBook` returns nothing, so the `fmt.Errorf` form would not compile there. Second, the two exits sit at different depths on purpose. The refusal leaves the handler outright; the `continue` at the bottom of the branch is the ordinary skip.

The existing both-sides fold (`cmd/api/p5_runbook.go:581-584`) keeps its exact semantics and gains the paired lane entries:

```go
if u := unmeasuredByEngine[engine]; u != nil {
	for _, acct := range u.accounts {
		eb.refused++
		ea.refused++
		eb.lanes = append(eb.lanes, runLaneEntry{account: acct, lane: laneUnmeasured})
		ea.lanes = append(ea.lanes, runLaneEntry{account: acct, lane: laneUnmeasured})
	}
}
```

`debtUSD` is nil on both entries, which is what makes cell (9,9)'s two debts null rather than "0".

**THE SPLIT HAS TO REACH THE WIRE BUILDER, AND NOTHING ABOVE CARRIES IT.** This is the correction round 46 forced, and it is a data-path defect rather than a wording one. `runLaneEntry` holds `account`, `lane` and `debtUSD` (§4.2); the fold above appends `{account, lane}` and drops the cause on the floor; `runBookTransitions` as first drafted took `(engine, before, after, dec)`. Every one of those is cause-blind, so `unmeasured_refused_in_batch_rows` and `unmeasured_excluded_by_this_layer_rows` were **not constructible from the builder's own inputs**, and two required fields of §2.1's schema had no derivation. The two counts exist exactly once, on the per-engine `*runUnmeasured` record `classifyUnmeasured` fills, so that record is what the builder is handed.

Deliberately NOT the alternatives. Putting a `cause` field on `runLaneEntry` would put the classification on every measured entry too, where it has no meaning, and would let a measured row carry a refusal cause. Re-deriving the split inside `runBookTransitions` would need the `[]*positionRow` slice, which would make the builder a second reader of `p.Status` and `p.reconstructionErr` and give the repo two places that must agree with `coverage()`. Passing the record keeps the classification in the one function §7.2 tests directly.

### 4.4 The zip: pairing by POSITION, with an account guard

`beforeInputs` and `afterInputs` are index-aligned by construction. `afterInputs` is built 1:1 from `run` in the same order, or IS `beforeInputs` on a projection, and `ApplyScenario` neither reorders nor drops (`out := in`, then one engine field replaced). `measureRunBook` walks its argument in slice order, so the two per-engine `lanes` slices are index-aligned too.

Pairing by index rather than by account map is what makes marginal agreement hold BY CONSTRUCTION. The account equality check is the guard against a future refactor that filters one side:

```go
// u is the per-engine unmeasured record of §4.3, and it is the ONLY carrier of
// the cause split. nil means this engine folded no unmeasured row, which is a
// legal book and not a missing argument: a nil record reads as 0 and 0.
func runBookTransitions(engine string, before, after *runMeasure, dec uint8, u *runUnmeasured) (wireRunBookTransitions, error) {
	if len(before.lanes) != len(after.lanes) {
		return wireRunBookTransitions{}, fmt.Errorf(
			"%s: %d before-lane records against %d after-lane records; the two sides "+
				"measured different books and a matrix over them would have margins "+
				"neither histogram supports", engine, len(before.lanes), len(after.lanes))
	}
	// ... zip, requiring b.account == a.account at each index, accumulating
	// counts into cell[b.lane][a.lane] and the two debt sums from b.debtUSD and
	// a.debtUSD respectively (never from the lane) ...

	// unmeasuredRows is counted from the lane slice itself, so the split is
	// checked against the population the matrix actually placed rather than
	// against the number the handler believes it folded.
	unmeasuredRows := 0
	for _, b := range before.lanes {
		if b.lane == laneUnmeasured {
			unmeasuredRows++
		}
	}
	refusedInBatch, excludedByThisLayer := 0, 0
	if u != nil {
		refusedInBatch, excludedByThisLayer = u.refusedInBatch, u.excludedByThisLayer
	}
	if refusedInBatch+excludedByThisLayer != unmeasuredRows {
		return wireRunBookTransitions{}, fmt.Errorf(
			"%s: %d unmeasured rows in the matrix against a cause split of %d refused-in-batch "+
				"plus %d excluded-by-this-layer; serving that split would point a per-engine "+
				"count at a coverage surface that does not hold those rows",
			engine, unmeasuredRows, refusedInBatch, excludedByThisLayer)
	}
	// ... UnmeasuredRows = unmeasuredRows,
	//     UnmeasuredRefusedInBatchRows = refusedInBatch,
	//     UnmeasuredExcludedByThisLayerRows = excludedByThisLayer ...
}
```

The equality is Invariant 7's wire law checked at the point of construction rather than asserted about it, and it is cheap: two integers against a count the zip already accumulates (it is written as its own loop above only to keep the snippet readable in isolation). It is what makes the two served counts derivations rather than restatements, and it fails closed if a future refactor ever folds a lane-9 entry the classifier never saw.

A refusal here is a defect in this layer, not a property of the data, so it is a 500 with a named reason. `runBookTransitions` and `measureRunBook` are helpers that RETURN an error, which is why `fmt.Errorf` is correct inside them; the handler that calls them converts it in the one form `handleRunBook` has, the same one the existing "applying scenario ... refused a verified position" arm uses (`cmd/api/p5_runbook.go:468-470`):

```go
tr, err := runBookTransitions(engine, mb, ma, dec, unmeasuredByEngine[engine])
if err != nil {
	writeError(w, http.StatusInternalServerError, codeInternal, err.Error(), nil)
	return
}
```

`unmeasuredByEngine` is in scope at this call site: it is declared where `refusedByEngine` is today (`cmd/api/p5_runbook.go:424`, §4.3) and the `engines[]` loop that builds each engine's wire object runs later in the same function. A map read of an absent engine yields the nil the signature documents.

It never degrades to a matrix with wrong margins.

### 4.5 The one-row-one-account check, over EVERY row the matrix places

The check runs inside the zip of §4.4, over the whole BEFORE lane slice, which is the measured entries appended by `place` PLUS the unmeasured entries appended by the fold:

```go
seen := make(map[common.Address]struct{}, len(before.lanes))
for k, b := range before.lanes {
	if _, dup := seen[b.account]; dup {
		return wireRunBookTransitions{}, fmt.Errorf(
			"%s: account %s appears in more than one position row of this batch; the "+
				"row-level matrix and the account-level movers list would count different "+
				"things and neither could be read against the other",
			engine, b.account.Hex())
	}
	seen[b.account] = struct{}{}
	// ... the positional guard of §4.4 at the same index ...
}
```

One map, one pass, folded into the zip that already runs. Two properties make this the right place for it rather than `len(m.states) == m.accounts`:

1. **It covers the whole matrix population.** `m.accounts` and `m.states` are written only inside `measureRunBook` (`:661`/`:671` and `:698`/`:710`); the lane-9 rows never touch either. A check on those two fields covers `measured_rows` and says nothing about `unmeasured_rows`, so it could not license a note sentence about the matrix as a whole. Distinctness over `before.lanes` covers both halves, and it subsumes `len(m.states) == m.accounts` exactly (a duplicate measured account is what collapses `states` below `accounts`).
2. **One side is enough.** The positional guard already asserts `before.lanes[k].account == after.lanes[k].account` for every k, so distinctness on the BEFORE slice carries to the AFTER slice with no second map.

`risk_positions`'s primary key (`internal/store/migrations/00013_risk_tables.sql:317`) makes a violation impossible today. Checking it is what licenses the note's sentence "on this batch one row is one account on this engine", instead of the wire asserting a database constraint the wire cannot see over a population the check cannot see.

### 4.6 The engine arm that does not exist

`measureRunBook`'s switch gains a default that returns an error:

```go
default:
	return nil, fmt.Errorf("run-book measure has no arm for engine %q: the scenario covers it "+
		"and its rows are in the run, but nothing here counts them, so every distribution "+
		"this response serves would silently omit them", pos.Engine)
```

Today's switch (`cmd/api/p5_runbook.go:654-718`) silently skips any third engine: such a position enters `run` and `beforeInputs`, and therefore `coverage.in_book`, while producing no `m.accounts++`, no tally and no lane entry. It would be in zero cells while every margin still reconciled. This is a pre-existing hole that the matrix's partition claim makes untenable, so this wave closes it. It is unconstructible with today's committed scenarios (every one names `aave_v3_etherfi` and/or `debt_manager`), and it converts a silent omission into a named 500.

### 4.7 The note the server composes

`TestRunBookExampleIsAServedBody` means every sentence in the contract example is a sentence the server composes. Required claims, in one server-owned string:

1. Rows are the BEFORE lane, columns the AFTER lane, over the POSITION ROWS of this engine in this run. Every count here counts rows, the same unit `coverage.batch_positions` uses; on this batch one row is one account on this engine, and the server checked that over every row in this matrix, measured and unmeasured alike, rather than assuming it.
2. Lanes 0…N−1 are the SAME buckets, on the SAME comparator and edges, that the two `hf_histogram`s beside them serve. Lane N is rows with NO DEBT, unbounded and never a bucket, and IS `infinite_count`'s population. Lane N+1 is rows this run measured on NEITHER side, and IS `refused_count`'s population.
3. `from_rows` IS the before histogram and `to_rows` IS the after histogram, lane for lane. A weld, not a hope.
4. A cell absent from `cells` holds ZERO rows. The dense `lanes`, `outflows`, `from_rows` and `to_rows` arrays are what make that omission complete.
5. Lane N+1's rows reached no arithmetic here: `unmeasured_refused_in_batch_rows` of them riskd refused (counted in `coverage.refused_in_batch`, served per row by `/v1/positions` and `/v1/address/{addr}`) and `unmeasured_excluded_by_this_layer_rows` of them this service could not rebuild (listed per row in `coverage.excluded`). Their persisted numbers still exist on those surfaces. THIS RUN measured none of them, which is why their cell's two debts are null and never "0".
6. Debt is in THIS engine's own unit at its own decimals and is never summed with another engine's. The two sides are separate figures because Aave's debt is a PRICED sum and a shock can move it, while the Debt Manager's is USD-normalized and copied across the shock unchanged. A no-debt row's "0" is a knowable zero; a null is an unknowable.
7. `lane_changed_rows` counts rows whose LANE changed. A move inside one lane is not counted and a move of one wei across an edge is, so it follows the histogram's edges rather than the scenario's magnitude. It is NOT `movers_total` and NOT `newly_eligible_accounts`, and it is not a crossing count of any particular edge.
8. Under this scenario no row can enter or leave the no-debt lane or the not-measured lane, so every lane change here is between buckets.
9. On the Debt Manager these lanes are a DISCLOSURE, not the liquidation verdict.
10. When `measured_rows` is 0, `held_rows` and `lane_changed_rows` are NULL: this run measured no row on this engine and a zero would claim a measurement nobody made.
11. `total_rows` is THIS ENGINE's whole book in this run. It is not `coverage.batch_positions`, which counts the whole batch including engines this scenario does not cover, and summing it across engines does not give `coverage.in_book`: a withheld engine's rebuildable rows are inside `coverage.in_book` with no `engines[]` entry, and this engine's unmeasured rows are inside `total_rows` and outside `coverage.in_book`. The two differences can cancel on a given book, so an equality seen once is not a law.

Claim 8 is conditional on the scenario and is composed from the same fact the code enforces; the server emits it because it is true of every committed scenario, and §2.3 records the boundary that makes it true. Claim 11 exists because `total_rows` is the number this response most invites a reader to sum across engines, and §2.1's schema description forwards to this claim by content rather than by a section number the reader does not have.

---

## 5. Worked examples

### 5.1 The contract's declared 200 example

The contract's 200 example is `weeth_market_depeg_oracles_held` (`api/openapi.yaml:1130-1336`), realized by `newRunBookExampleFixture` in `cmd/api/p5_runbook_example_db_test.go`. Its committed numbers:

- **aave_v3_etherfi**, `usd_decimals` 8: `before.accounts` 1, `total_debt_usd` `"600000000000"`, buckets all 0 except `"1.05 – 1.10"` (index 3) = 1, `infinite_count` 0, `refused_count` 1. `after` is a YAML anchor alias of `before` (oracle marks held, and the scenario's shock list is empty).
- **debt_manager**, `usd_decimals` 6: `before.accounts` 1, `total_debt_usd` `"4620000000"`, `"< 0.90"` (index 0) = 1, `infinite_count` 0, `refused_count` 1. `after` aliases `before`.
- The batch carries 4 positions and `coverage` reads `batch_positions: 4, in_book: 2, refused_in_batch: 2, excluded_by_this_layer: 0, excluded: []`. Both refused rows are riskd refusals, one per engine.

`hf_transitions` sits beside `before` and `after` on the engine object, not inside the aliased aggregate block, so the anchor is unaffected.

```yaml
                    hf_transitions:
                      comparator: "hf_wad"
                      wad_scale: "1000000000000000000"
                      lanes:
                        - { index: 0, kind: "bucket", label: "< 0.90",      lower_wad: null,                  upper_wad: "900000000000000000" }
                        - { index: 1, kind: "bucket", label: "0.90 – 1.00", lower_wad: "900000000000000000",  upper_wad: "1000000000000000000" }
                        - { index: 2, kind: "bucket", label: "1.00 – 1.05", lower_wad: "1000000000000000000", upper_wad: "1050000000000000000" }
                        - { index: 3, kind: "bucket", label: "1.05 – 1.10", lower_wad: "1050000000000000000", upper_wad: "1100000000000000000" }
                        - { index: 4, kind: "bucket", label: "1.10 – 1.25", lower_wad: "1100000000000000000", upper_wad: "1250000000000000000" }
                        - { index: 5, kind: "bucket", label: "1.25 – 1.50", lower_wad: "1250000000000000000", upper_wad: "1500000000000000000" }
                        - { index: 6, kind: "bucket", label: "1.50 – 2.00", lower_wad: "1500000000000000000", upper_wad: "2000000000000000000" }
                        - { index: 7, kind: "bucket", label: ">= 2.00",     lower_wad: "2000000000000000000", upper_wad: null }
                        - { index: 8, kind: "infinite",   label: "no debt (unbounded)", lower_wad: null, upper_wad: null }
                        - { index: 9, kind: "unmeasured", label: "not measured",        lower_wad: null, upper_wad: null }
                      from_rows: [0, 0, 0, 1, 0, 0, 0, 0, 0, 1]
                      to_rows:   [0, 0, 0, 1, 0, 0, 0, 0, 0, 1]
                      outflows:
                        - { from: 0, cells: [] }
                        - { from: 1, cells: [] }
                        - { from: 2, cells: [] }
                        - from: 3
                          cells:
                            - to: 3
                              rows: 1
                              debt_before_usd: "600000000000"
                              debt_after_usd: "600000000000"
                        - { from: 4, cells: [] }
                        - { from: 5, cells: [] }
                        - { from: 6, cells: [] }
                        - { from: 7, cells: [] }
                        - { from: 8, cells: [] }
                        - from: 9
                          cells:
                            # The row this run never measured. Its two debts are
                            # UNKNOWABLE HERE, so they are null and never "0".
                            # The batch's own numbers for it are served by
                            # /v1/positions and /v1/address/{addr}.
                            - to: 9
                              rows: 1
                              debt_before_usd: null
                              debt_after_usd: null
                      total_rows: 2
                      measured_rows: 1
                      unmeasured_rows: 1
                      unmeasured_refused_in_batch_rows: 1
                      unmeasured_excluded_by_this_layer_rows: 0
                      held_rows: 1
                      lane_changed_rows: 0
                      note: "<the server-composed sentence, §4.7>"
```

Debt Manager, same structure with its own lane and unit: `from_rows: [1,0,0,0,0,0,0,0,0,1]`, `to_rows: [1,0,0,0,0,0,0,0,0,1]`, `outflows[0].cells: [{to: 0, rows: 1, debt_before_usd: "4620000000", debt_after_usd: "4620000000"}]`, `outflows[9]` the same unmeasured diagonal cell, `total_rows` 2, `measured_rows` 1, `unmeasured_rows` 1, `unmeasured_refused_in_batch_rows` 1, `unmeasured_excluded_by_this_layer_rows` 0, `held_rows` 1, `lane_changed_rows` 0, `comparator: "hf_num/hf_den"`.

**The reconciliations this example satisfies, checkable by eye:**

| law | Aave | DM |
|---|---|---|
| `from_rows` equals the before histogram tallies | `[0,0,0,1,0,0,0,0]` + inf 0 + ref 1 | `[1,0,0,0,0,0,0,0]` + inf 0 + ref 1 |
| `to_rows` equals the after histogram tallies | identical (marks held) | identical |
| Σ all cells' `rows` equals `total_rows` | 1 + 1 = 2 | 1 + 1 = 2 |
| `total_rows` equals `before.accounts + unmeasured_rows` | 1 + 1 = 2 | 1 + 1 = 2 |
| `measured_rows` equals `before.accounts` and `after.accounts` | 1 | 1 |
| the two unmeasured split counts sum to `unmeasured_rows` | 1 + 0 = 1 | 1 + 0 = 1 |
| Σ non-null `debt_before_usd` equals `before.total_debt_usd` | `"600000000000"` | `"4620000000"` |
| Σ non-null `debt_after_usd` equals `after.total_debt_usd` | `"600000000000"` | `"4620000000"` |
| `held_rows + lane_changed_rows + unmeasured_rows` equals `total_rows` | 1 + 0 + 1 = 2 | 1 + 0 + 1 = 2 |

Note the last row against the draft's version, which served `held_accounts: 2` over a book where exactly one row was ever computed. Here the diagonal counts only what was measured, and the row nobody measured is in its own term.

Note also what this example does NOT witness: both debt figures are equal on both engines, because `weeth_market_depeg_oracles_held` has an empty shock list. The two-figure design is justified by §2.3.1 and witnessed by §5.3, not by this body.

> **The example is CAPTURED, not composed.** `TestRunBookExampleIsAServedBody` re-runs the seeded book through the real handler and asserts byte equality against the contract. The block above is a PREDICTION from the example's own committed numbers; the capture is the authority, and any divergence is a defect in this spec, not in the test.

### 5.2 The engine nobody measured

If an engine's whole covered book is unmeasured (`before[engine] == nil`, so `newRunMeasure()`, and every row in the unmeasured fold), the served object is:

```yaml
                      total_rows: N
                      measured_rows: 0
                      unmeasured_rows: N
                      held_rows: null
                      lane_changed_rows: null
```

with `from_rows[9] == to_rows[9] == N`, one cell `{to: 9, rows: N, debt_before_usd: null, debt_after_usd: null}` under `outflows[9]`, and every other outflow empty.

The draft would have served `held_rows: N, lane_changed_rows: 0` here, which an honest user reads as "this scenario moved nobody on this engine" over a book where nothing was measured. The repo had already ledgered and refused exactly that shape: `web/app/lab/labRunBookLines.ts:36-41` defines `measuredCount` as buckets plus `infinite_count` and deliberately EXCLUDES `refused_count`, and lines 91-97 return "This scenario measured no account on this engine, so there is no shift to read" under the comment "'0 accounts moved' would claim a measurement nobody made." The null pair is that guard moved to the server, where the client cannot forget it.

### 5.3 The off-diagonal case, the three counts that must not be confused, and the two debt strings

**The single-crossing book.** From `newP5Fixture` plus `eth_minus_10` (`cmd/api/p5_runbook_bsplit_db_test.go:49-130`): the Aave row is at HF 1.08 before (lane 3) and 0.972 after (lane 1); the DM row is `< 0.90` on both sides (lane 0); each engine carries one unmeasured batch row.

**aave_v3_etherfi**

| from \ to | 1 (`0.90 – 1.00`) | 9 (`not measured`) | `from_rows` |
|---|---|---|---|
| 3 (`1.05 – 1.10`) | **1** | | 1 |
| 9 (`not measured`) | | **1** | 1 |
| `to_rows` | 1 | 1 | `total_rows` 2 |

`measured_rows` 1, `held_rows` 0, `lane_changed_rows` 1, `unmeasured_rows` 1. `eth_minus_10` shocks `eth_usd`; this Aave row's only debt leg is USDC, held flat, so `debt_before_usd == debt_after_usd` on the occupied cell.

**debt_manager**: `outflows[0]` gets `{to: 0, rows: 1, ...}` (3200/4200 = 0.762 before, 2880/4200 = 0.686 after, both `< 0.90`), plus the unmeasured diagonal. `measured_rows` 1, `held_rows` 1, `lane_changed_rows` 0. The finding the existing test already pins ("the DM distribution does NOT move") becomes explicit as `lane_changed_rows: 0` rather than an inference from two identical histograms.

**The mixed-direction book: three offsetting moves and the debt asymmetry, in one committed body.** From `seedMixedDirectionBatch` plus `eth_minus_30` (§1.1), with all four positions in the book and none refused, so `coverage` reads `batch_positions: 4, in_book: 4, refused_in_batch: 0, excluded_by_this_layer: 0`. Three of those four are PINNED by the existing test, `batch_positions` and `in_book` and `excluded_by_this_layer` at `cmd/api/p5_runbook_bsplit_db_test.go:270-272` (with `before.accounts` and `after.accounts` at `:273-274`). **`refused_in_batch` is asserted nowhere in that test**; its value of 0 follows from the fixture, where all four positions are written `RiskPositionComputed`, and this spec claims it as derived rather than as pinned. §7.3's end-to-end test is where it becomes pinned.

Aave, `usd_decimals` 8. `from_rows: [1,0,0,1,1,0,0,0,0,0]`, `to_rows: [2,0,0,1,0,0,0,0,0,0]`, `total_rows` 3, `measured_rows` 3, `unmeasured_rows` 0, `held_rows` 0, `lane_changed_rows` 3.

| cell | account | rows | `debt_before_usd` | `debt_after_usd` |
|---|---|---|---|---|
| (4 → 0) | A, 1.20 to 0.84 | 1 | `"540000000000"` | `"540000000000"` |
| (3 → 0) | B, 1.08 to 0.756 | 1 | `"300000000000"` | `"300000000000"` |
| (0 → 3) | C, 0.74375 to 1.0625 | 1 | `"800000000000"` | `"560000000000"` |

A and B borrow USDC, which `eth_minus_30` does not shock, so their two figures are equal. C borrows weETH (`fxMDDebtInShockedAsset`), which the scenario re-prices at 70/100, so `MulDivCeil(2e18, shocked weETH price, 1e18)` falls from 8,000.00 to 5,600.00 USD and the cell carries TWO DIFFERENT DEBT STRINGS. The column sums confirm it against the engine's own served aggregates: `Σ debt_before_usd` = 540 + 300 + 800 = `"1640000000000"` = `before.total_debt_usd`; `Σ debt_after_usd` = 540 + 300 + 560 = `"1400000000000"` = `after.total_debt_usd`. This is the whole case for two figures per cell, on a committed fixture and a committed scenario, and it is also why the after-side HF of C is 1.0625 rather than 0.74375: the shock shrank the denominator.

**Why `lane_changed_rows` is not `movers_total`,** on the same book:

| quantity | Aave value | what it counts |
|---|---|---|
| `lane_changed_rows` | 3 | A (4→0), B (3→0), C (0→3) |
| `movers_total` | 2 | strict health-factor drops only; C rose, so it is not a mover |
| `newly_eligible_accounts` | 1 | a signed net: 2 eligible after minus 1 before |
| below-1.00 population delta | +1 | a difference of two marginals |

Four numbers about the same three rows, and none of them is any of the others. The converse hazard is equally real and equally on the record: a book in which every health factor drops 20% without leaving its bucket serves `lane_changed_rows: 0` beside `movers_total: N`. Both hazards are named in the note (§4.7 claim 7), because the field's value alone disambiguates neither.

### 5.4 What `total_rows` does NOT reconcile against

`Σ_engines hf_transitions.total_rows` is not `coverage.batch_positions` and not `coverage.in_book`. The reasons are structural, and each is verified:

1. `coverage.batch_positions` is `len(positions)` over the WHOLE batch (`cmd/api/handlers.go:692`), including engines the scenario does not cover. It coincides with the matrix total on the contract example only because that batch happens to be 2+2 across exactly the two covered engines.
2. **Withheld engines push `coverage.in_book` UP relative to the sum.** `coverage.in_book` is `len(beforeInputs)` (`cmd/api/p5_runbook.go:525`), and `beforeInputs` is built from `run`, which filters on `covers(sc.Engines, p.Engine)` and NOT on withheld (`:425-440`). The `engines[]` loop, by contrast, skips withheld engines entirely (`:562-565`). So every rebuildable row on a covered-but-withheld engine is inside `coverage.in_book` and inside no matrix.
3. **Unmeasured rows push the sum UP relative to `coverage.in_book`.** A row with `p.input == nil` never enters `beforeInputs`, so it is outside `coverage.in_book`, and it is inside `total_rows` as part of `unmeasured_rows`.
4. Before §4.6, a covered engine with no `measureRunBook` arm would be in `coverage.in_book` and in no cell.

**Reasons 2 and 3 push in opposite directions and can cancel exactly, which is why an observed equality proves nothing.** The committed `web/tests/fixtures/run-book.weeth-withheld.json` is precisely that case: `coverage` is `{batch_positions: 4, in_book: 2, refused_in_batch: 2, excluded_by_this_layer: 0}`, `engines[]` carries `debt_manager` alone, and that engine's row has `before.accounts: 1` with `hf_histogram.refused_count: 1`. So DM `total_rows` is 1 + 1 = 2 and `Σ_engines total_rows` = 2 = `in_book` = 2. The withheld Aave engine's one rebuildable row (reason 2) and the DM engine's one unmeasured row (reason 3) cancel. The two 2s are not the same 2, and §7.3 pins the decomposition rather than the coincidence.

The only reconciliation the code supports, and therefore the only one the spec claims, is per engine: `total_rows == before.accounts + unmeasured_rows == after.accounts + unmeasured_rows`.

---

## 6. Size and cost

**Bounded by the lane count, not by the book.** `laneCount` is 10 today (8 edges plus 2). Cells per engine are at most 100 whether the book holds 4 positions or 400,000. Engines per response are at most the scenario's `engines[]`, which is at most 2 today: eight committed scenarios name both engines and seven name `debt_manager` alone (§2.3.1). The bound is 2, and half the committed scenarios do not reach it.

Measured baseline: `web/tests/fixtures/run-book.weeth_market_depeg_oracles_held.json` is **20,862 bytes** for the two-engine contract example. The full run-book fixture family is **14 files, 253,028 bytes**.

Per-element estimates (JSON, no whitespace):

| element | bytes | note |
|---|---|---|
| one cell | 87 to 105 | `{"to":9,"rows":123456,"debt_before_usd":"600000000000","debt_after_usd":"600000000000"}` is exactly 87 B: a 6-digit `rows` and two 12-digit debts. Widening both debts to 21 digits adds 9 B each, so 105 B, and only a `rows` past 6 digits goes higher. The draft's cell was ~139 B; dropping the per-cell unmeasured counter (§2.2) removed ~25 B. |
| one lane | 85 to 115 | 85 for a non-bucket lane with both wads null, 115 for a bucket with both edges. No per-lane note. |
| one empty outflow stub | 21 | `{"from":4,"cells":[]}`. The earlier shape's `{"from":4,"from_rows":0,"cells":[]}` was 35 B; moving the row margin out to a dense array saves 14 B on each of ten stubs and costs 33 B once. |
| `from_rows` | ~33 | `"from_rows":` plus ten integers |
| `to_rows` | ~31 | same, shorter key |
| `comparator` + `wad_scale` | ~63 | |
| the seven scalars | ~204 | including the two long `unmeasured_*_rows` names |
| the note | **2,907** | MEASURED, not estimated: the eleven required claims of §4.7 as written, whitespace normalized, are 345 + 301 + 108 + 145 + 473 + 339 + 319 + 134 + 78 + 162 + 503 characters. `TestRunBookExampleIsAServedBody` means the served string must actually carry them, so this is the note's real size and not a budget for it. |

An earlier revision of this table carried ~1,250 B here, which was 2.3x low, and every total below it moved. The corrected figures:

Fixed cost per engine: lanes ~1.05 KB, ten outflow stubs ~0.21 KB, the two margins ~0.06 KB, comparator and scale ~0.06 KB, scalars ~0.20 KB (1.58 KB for all of that), plus the note at 2.91 KB, so **~4.49 KB**, plus 87 to 105 B per occupied cell. All KB in this section are 1,000 bytes, and the baseline body is the measured 20,862-byte fixture.

| shape | bytes added per engine | body total | delta |
|---|---|---|---|
| contract example, 2 occupied cells per engine | ~4.66 KB | ~30.2 KB | +45% |
| realistic shocked book, 10 to 25 occupied cells | ~5.36 to 7.12 KB | ~31.6 to 35.1 KB | +51% to +68% |
| dense cells, all 100 occupied (rejected) | ~13.2 to 15.0 KB | ~47.2 to 50.9 KB | +126% to +144% |

The dense row is still the entire argument for sparse cells, and the correction does not move that conclusion: dense cells add ~7.8 KB per engine on top of the realistic sparse case, which remains the largest single lever in the table. What the correction does change is the honest headline, from "+29% on the contract example" to "+45%", and the note is now unambiguously the single largest fixed element at 65% of the per-engine fixed cost. That is still the correct place to spend the bytes, because every claim in it is a claim the response would otherwise invite a reader to get wrong, but the price is named at its real size rather than at half of it.

**Compute.** One slice append per position per side, inside walks that already compute the health factor, the bucket index and the debt. One O(P) zip per engine, carrying the distinctness map of §4.5. One O(occupied cells) emit, with no sort (outflows emit in lane order by index, cells ascending by `to` by index). No second walk of the book, no second `risk.Waterfall` evaluation, no additional database read. `handleRunBook` today already performs two full `measureRunBook` walks and two whole-book `risk.Waterfall` evaluations at the identity grid point (`cmd/api/p5_runbook.go:449`, `:492`, `:723`); this addition is well under 1% of that.

**Memory.** Two `[]runLaneEntry` slices of P entries each, ~40 B per entry (a 20-byte address, an int and a `*big.Int`, padded), plus one `map[common.Address]struct{}` of P entries for §4.5, transient inside the zip. At P = 10,000 positions that is ~1.1 MB transient per request, freed with the request. The existing `states map[common.Address]*runAccountState` already allocates one entry per account per side, each holding several `*big.Int`, so the lane slices plus the distinctness map remain cheaper than what the handler already allocates.

A zero-extra-memory variant exists (store `lane int` on `runAccountState` and zip over sorted accounts) and is rejected: it makes marginal agreement contingent on `risk_positions`'s primary key and on `len(states)` equalling the per-position tallies, rather than true by construction. §4.5 checks that constraint; the matrix should not depend on it.

**Latency.** Dominated entirely by the two existing whole-book `Waterfall` evaluations. The matrix adds one linear pass and a bounded emit.

---

## 7. Test laws

### 7.1 The headline: marginal agreement, enforced in Go

`TestRunBookTransitionsAgreeWithBothMarginals` (`cmd/api/p5_runbook_transition_test.go`, **no DB**: table-driven over `runMeasure` pairs constructed in memory, including the §5.1 and §5.3 shapes, with no seed and no fixture). Over the SAME `wire()` outputs the response carries, not a re-derivation, for both engines:

```
for i in 0..laneCount-1:
    Σ_j cell[i][j].rows == from_rows[i] == beforeTally(i)
for j in 0..laneCount-1:
    Σ_i cell[i][j].rows == to_rows[j]   == afterTally(j)
where tally(k) = histogram.buckets[k].count for k < N
               = histogram.infinite_count   for k == laneInfinite
               = histogram.refused_count    for k == laneUnmeasured
```

**Mutations this kills:** bucketing the matrix on its own edge table; dropping unmeasured rows from the joint while the histogram counts them; building the matrix from the account-keyed `states` maps when a count and a state disagree; folding the unmeasured rows onto one side only.

### 7.2 The rest of the Go unit laws (`cmd/api/p5_runbook_transition_test.go`, no DB)

**The file split is a repo convention and this section obeys it literally.** `cmd/api` splits every suite into a pure half and a database half by filename, exactly as `p5_runbook_bsplit_test.go` sits beside `p5_runbook_bsplit_db_test.go`. Every `apiFixture` construction skips the whole test when `TEST_DATABASE_URL` is unset (`cmd/api/fixture_db_test.go:53`), so a fixture-driven test placed in the no-DB file does not fail there, it SILENTLY SKIPS, which is worse. `seedMixedDirectionBatch` is a database seed: it is `func (f *apiFixture) seedMixedDirectionBatch` at `cmd/api/p5_runbook_bsplit_db_test.go:229`, and it calls `f.seedAaveUSDCParams` and `f.store.WriteRiskBatch`. So **no test in this table touches `seedMixedDirectionBatch`, `newP5Fixture`, `newRunBookExampleFixture` or any other seed.** The three laws that need that book, including the wave's headline anti-regression, are in §7.3 where they will actually run. Every test below constructs its `runMeasure` pairs and lane slices in memory, or exercises the pure library directly.

| test | claim | mutation killed |
|---|---|---|
| `TestRunBookTransitionLanesAreTheHistogramsOwnBuckets` | `lanes[0..N-1]` byte-identical (`label`, `lower_wad`, `upper_wad`) to the served `hf_histogram.buckets`, in order; `lanes[N].kind == "infinite"`; `lanes[N+1].kind == "unmeasured"`; `len(lanes) == len(histogramEdges)+2 == len(outflows) == len(from_rows) == len(to_rows)` | a second edge table; an edge that moves in one place only |
| `TestRunBookTransitionCountsPartitionTheRun` | Σ all cells equals `total_rows` equals `before.accounts + unmeasured_rows` equals `after.accounts + unmeasured_rows`; `measured_rows == before.accounts`; every cell `rows >= 1`; `to` unique and ascending within an outflow | a row in two cells or in none; an emitted zero cell |
| `TestRunBookTransitionNamesNoFieldItDoesNotCount` | over the generated schema: every property of `RunBookTransitions`, `RunBookTransitionOutflow` and `RunBookTransitionCell` whose name ends in `rows` is an integer or an array of integers, and no property holding objects has a name ending in `rows` | the `rows`-array-versus-`rows`-count collision returning under a new name |
| **`TestRunBookTransitionHoldsNoOpinionWhenNothingWasMeasured`** | an engine whose whole covered book is unmeasured serves `measured_rows: 0` with `held_rows` and `lane_changed_rows` BOTH null, and the note carries the "measured no row" sentence | serving `held_rows: N, lane_changed_rows: 0` over a book nobody measured, which is the draft's defect and the exact shape `labRunBookLines.ts` already refuses |
| `TestRunBookTransitionMovementPartitionsTheMeasured` | when `measured_rows > 0`: `held_rows + lane_changed_rows + unmeasured_rows == total_rows`, and `held_rows` counts only cells with `from == to` over lanes 0..N | counting the (N+1,N+1) cell as "held" |
| **`TestRunBookTransitionUnmeasuredSplitUsesTheCoverageCountersOwnPredicates`** | the two split counts sum to `unmeasured_rows`, and each is computed by the POSITIVE predicate of the coverage counter it names: `p.Status == store.RiskPositionRefused` for `unmeasured_refused_in_batch_rows` (matching `handlers.go:701`) and `p.reconstructionErr != ""` for `unmeasured_excluded_by_this_layer_rows` (matching `handlers.go:704`). A row satisfying neither is a named error. Table-driven directly over the pure `classifyUnmeasured` of §4.3, including a synthetic third status token, so no database is needed to cover all three arms | using `p.Status != computed` as a stand-in for `== refused`, which silently absorbs any status the schema's missing CHECK constraint permits, and then points the reader at a coverage count that does not hold the row |
| **`TestRunBookTransitionLaneNPlusOneHoldsOnlyUnmeasuredRows`** | `from_rows[N+1] == to_rows[N+1] == unmeasured_rows`, the outflow's only cell is `(N+1, N+1)`, and that cell's two debts are null; no other cell carries a null debt | reusing lane N+1 for a measured row and hiding its debt behind a null |
| **`TestMeasuredStatesAlwaysCarryAComparator`** | over `ComputeAaveHealth`: `HealthFactorWad != nil` if and only if `!IsInfinite`; over `ComputeDMHealth`: `HealthFactor.Den` is positive if and only if `!IsInfinite`. Table-driven over zero-debt, positive-debt and boundary inputs | the assumption in §2.2 silently ceasing to hold; this is the replacement for the draft's unfailable mixed-cell test |
| `TestRunBookMeasureRefusesAMeasuredRowItCannotBucket` | `place()` returns the named error rather than incrementing `m.refused` | folding an impossible state into the unmeasured lane |
| `TestRunBookTransitionInfiniteLaneDebtIsAKnowableZero` | cell `(N, N)` carries `"0"` on both sides, never null | collapsing knowable-zero and unknowable into one representation |
| `TestRunBookTransitionDebtReconcilesPerSide` | over IN-MEMORY `runMeasure` pairs carrying hand-written per-row debts, including one pair whose two sides differ: Σ non-null `debt_before_usd` (big.Int over decimal strings) equals the before-side sum and Σ non-null `debt_after_usd` equals the after-side sum, and the two sums are asserted UNEQUAL on that pair so the law cannot pass vacuously. The reconciliation against the SERVED `before.total_debt_usd` and `after.total_debt_usd` is §7.3's, because those aggregates come from a seeded book | a float anywhere; a cell debt taken from the wrong side; a lane-derived debt; a single debt figure copied into both |
| `TestRunBookTransitionRefusesAMisPairedZip` | unequal lane-slice lengths, or an account mismatch at an index, produce an error (500 with a named reason), never a matrix with wrong margins | a future refactor that filters one side and serves a plausible-looking wrong joint |
| `TestRunBookTransitionRefusesTwoRowsForOneAccount` | a duplicate account anywhere in the BEFORE lane slice is a named 500, asserted separately for a duplicate among MEASURED entries and for a duplicate between a measured entry and an UNMEASURED one | inheriting `risk_positions`'s primary key as an unstated assumption, and checking only the measured half of the population the note's sentence covers |
| `TestRunBookMeasureRefusesAnEngineItHasNoArmFor` | a `PositionInput` on a third engine produces the named error instead of being skipped | a covered engine silently in zero cells while every margin still reconciles |
| `TestRunBookTransitionIsDeterministic` | repeated builds over the same measures are byte-identical | map-iteration order leaking to the wire |

### 7.3 DB-backed (`cmd/api/p5_runbook_transition_db_test.go`)

Everything here needs a seeded book, so everything here is in the `_db_test` file, per the convention §7.2 states. Three of these laws were misfiled in the no-DB table in an earlier revision, where they would have skipped silently whenever `TEST_DATABASE_URL` was unset (`cmd/api/fixture_db_test.go:53`), taking the wave's stated reason for existing with them.

`TestRunBookServesTheTransitionMatrix`, `newP5Fixture` plus `eth_minus_10`, through the real handler and the real contract validator (`f.postJSON(..., runBookContractPath, 200)`): the Aave crossing appears at `outflows[3].cells[to=1].rows == 1`; the unmeasured row sits at `(9,9)` with two nulls; `unmeasured_refused_in_batch_rows == 1` and `unmeasured_excluded_by_this_layer_rows == 0` on both engines (both fixtures are `Status: refused`); both margins equal the two served histograms field for field; `lane_changed_rows == 1` on Aave and `0` on the Debt Manager.

**`TestRunBookTransitionSplitsAnUnrebuildableRowFromARefusedOne`** (NEW in REV4, and it is the end-to-end half the §7.2 table cannot supply). Every committed run-book fixture puts its unmeasured rows in the `refused` cause: `fxAaveRefused` and `fxDMRefused` are both `Status: store.RiskPositionRefused` (`cmd/api/fixture_test.go:254`, `:426`), so `TestRunBookServesTheTransitionMatrix` above pins `unmeasured_excluded_by_this_layer_rows == 0` on both engines and could not distinguish the two counts from a single count copied into the first slot. This law drives the OTHER cause through the real handler.

Fixture: `seedMixedDirectionBatch` plus `eth_minus_30`, whose four rows are all written `RiskPositionComputed` with no refusals, then account **A** (`fxMDAcctDropsA`, the 1.20 to 0.84 row) is made unrebuildable by the committed mutation technique of `TestLiqBonusMutationRefusesTheReconstruction` (`cmd/api/round1_db_test.go:166-212`): `UPDATE risk_position_legs SET liq_bonus = ...` against that account's weETH collateral leg, which `fxMDCollateralDown` writes with a real `LiqBonus` (`cmd/api/fixture_test.go:642`). The statement is **scoped by `(batch_id, engine, account, asset)`** and not by asset alone, because both `fxMDCollateralDown` rows carry a weETH collateral leg and an asset-scoped update would exclude two rows instead of one. The mutation touches no position count, so `riskBatchCompleteConjuncts` still holds and the batch stays servable, which is why that technique is the one reused. Assertions, on the Aave engine of the served body:

1. **The split is the reconstruction cause, not the refusal cause.** `unmeasured_refused_in_batch_rows == 0` and `unmeasured_excluded_by_this_layer_rows == 1`. A mutation that classified on `p.Status != store.RiskPositionComputed` reports 1 and 0 and fails here; against every other fixture in the suite it passes.
2. **The coverage surfaces the counts point at actually hold the row.** `coverage.refused_in_batch == 0`, `coverage.excluded_by_this_layer == 1`, and `coverage.excluded` carries exactly one entry whose `engine` is `aave_v3_etherfi`, whose `account` is the mutated one and whose `code` is `API_RECONSTRUCTION_MISMATCH` (`cmd/api/handlers.go:704-712`, `read.go:69`). This is the assertion that makes the served pointer checkable rather than decorative: the count that is 1 names the array that has 1 in it, and the count that is 0 names the count that is 0.
3. **The split sums.** `unmeasured_refused_in_batch_rows + unmeasured_excluded_by_this_layer_rows == unmeasured_rows == 1`, and `from_rows[9] == to_rows[9] == 1` with the only cell of `outflows[9]` being `(9,9)` carrying two null debts. This is the §4.4 construction guard observed on the wire.
4. **The rest of the matrix loses exactly that row and no other.** Aave `total_rows == 3`, `measured_rows == 2`, `coverage.in_book == 3`; the two surviving measured rows are B `(3→0)` and C `(0→3)`, so `held_rows == 0` and `lane_changed_rows == 2`. The Debt Manager row is untouched: `unmeasured_rows == 0` and both split counts 0, which also pins that a nil `*runUnmeasured` reads as 0 and 0 rather than as a missing argument.

Mutations killed: building the two counts from anything the lane records carry (they carry no cause, §4.3); serving one count and deriving the other by subtraction, which cannot distinguish 0+1 from 1+0; classifying by negation of `computed`; dropping the §4.4 sum guard so a fold the classifier never saw serves a split that does not add up.

**`TestRunBookTransitionSeparatesOffsettingMoves`** (this is **the wave's reason for existing**, and there is exactly ONE of it: an earlier revision listed both this name in the no-DB table and a `TestRunBookTransitionSeparatesOffsettingMovesEndToEnd` twin here, which was one test written twice). `seedMixedDirectionBatch` plus `eth_minus_30`, through the real handler. It asserts, in one body over one seeded book:

1. **The offsetting moves.** The below-1.00 marginal delta is +1 while `lane_changed_rows == 3`, and all three off-diagonal cells `(4→0)`, `(3→0)` and `(0→3)` are present. Any "matrix" reconstructed from the two histograms fails this.
2. **Debt is summed per side, not per lane.** The two Aave totals genuinely DIFFER on this book (`"1640000000000"` against `"1400000000000"`): the `(0→3)` cell carries `debt_before_usd: "800000000000"` and `debt_after_usd: "560000000000"`, the two other cells carry equal pairs, and both column sums reconcile against the engine's served `before.total_debt_usd` and `after.total_debt_usd`. The unequal pair is asserted as unequal, so a mutation collapsing the two figures fails rather than passing vacuously. This is the only place in the suite where the two-figure design can be falsified, which is why it must not sit in a file that can skip.
3. **A lane change is not a mover.** `lane_changed_rows == 3`, `movers_total == 2`, `newly_eligible_accounts == 1`, all three read off one engine row of one response, and the note carries the disambiguating sentence (§4.7 claim 7).
4. **`coverage` on this book.** `batch_positions: 4, in_book: 4, refused_in_batch: 0, excluded_by_this_layer: 0`. This is where `refused_in_batch: 0` becomes pinned; `cmd/api/p5_runbook_bsplit_db_test.go` asserts the other three and not that one (§5.3).

Mutations killed: serving one debt figure per cell or copying one side's into both; a two-debt test written on a fixture where the two are equal and could never fail; serving a lane-crossing count under a name or description that reads as the mover count.

**The two withheld-engine tests, and why there must be two.** `coverage.in_book` differs from `Σ_engines total_rows` for two reasons that push in opposite directions (§5.4, reasons 2 and 3), so a single fixture can show either a difference or a coincidence, and the committed withheld fixture happens to show the coincidence. Both are pinned:

1. `TestRunBookTransitionOnAWithheldEngineBookIsACoincidence`. The `run-book.weeth-withheld` shape, which needs a NEW Go seed (`seedWithheldOverStandardBook`) because `seedWithheldBatch` (`cmd/api/fixture_db_test.go:398`) writes a withheld Aave aggregate with ZERO positions behind it, while the web fixture is the four-position `fxPositions` book with the Aave aggregate carrying `riskfeed.GateFlagCustodyUnproven`. Assertions: the withheld engine has NO `engines[]` row and therefore no matrix; `Σ_engines total_rows == 2 == coverage.in_book`; and the assertion message states the decomposition that produces it, namely that `in_book` 2 is one withheld-Aave rebuildable row plus one DM rebuildable row, while `Σ total_rows` 2 is one DM measured row plus one DM unmeasured row. The test asserts an EQUALITY and names it a coincidence. It is not the anti-regression.
2. `TestRunBookTotalRowsIsNotCoverageInBook`. `fxMixedDirectionBatchWrite` with `RefusalCode: riskfeed.GateFlagCustodyUnproven` set on the Aave aggregate (its `Positions: 3` unchanged, so `riskBatchCompleteConjuncts`'s aggregate-sum check at `internal/store/risk.go` still passes and the batch is servable), run under `eth_minus_30`. That book has three rebuildable Aave rows, one rebuildable DM row and no refusals, so `coverage.in_book` is 4 while `engines[]` carries `debt_manager` alone with `total_rows` 1. **4 does not equal 1**, the gap is exactly the three withheld rows, and this is the falsifiable anti-regression for §5.4. It fails the moment anyone makes `total_rows` a book-wide count or sums it across engines against `in_book`.

### 7.4 Laws that extend, and laws that CHANGE

- **`TestRunBookExampleIsAServedBody`**: no change to the test, but the contract example must be RE-CAPTURED (run the fixture through the handler, transplant the response). Hand-writing `hf_transitions` into the yaml fails it.
- **`TestRunBookHistogramCountsWhatItCannotBucket`** (`cmd/api/p5_runbook_bsplit_test.go:121`): **this test changes.** It currently calls `m.bucket(risk.AaveEngine, &runAccountState{hfWad: nil})` directly and asserts the row is counted refused. After §4.2 that call returns the named error. The test is rewritten in two halves: the tally half keeps asserting that the unmeasured fold plus the infinite tally plus the buckets account for the whole run, and the new half asserts that a measured comparator-free state REFUSES with a named reason. The rewrite is not a weakening: today's assertion pins a behavior on a state the handler cannot construct, and the code it pins is exactly what §2.2 shows is dead.
- **`web/tests/unit/lab-runbook-lines.spec.ts`**: **this file changes, and REV4 adds it to this checklist because §10 item 10 retires the copy it is the standing law for.** Its assertions currently REQUIRE the "NET only, crossings are impossible" reading, so they turn red the moment `histogramShiftReadingLine` is rewritten over the matrix, and leaving it off this list is what would make that rewrite look like a two-line copy edit. Five tests carry the obligation, and the file header's law list at `:12-17` moves with them:
  - `:129` `"THE NET CAVEAT: the sentence never claims accounts CROSSED, in either direction"`. **Retire the impossibility copy law explicitly**, do not reword it. It asserts `toContain("serves the two populations, not the crossings between them")` and `toContain("no gross crossing count is claimed here")`, and it forbids the exact vocabulary the matrix now licenses: `not.toContain("crossed into that region")`, `not.toContain("left that region")`, `not.toContain("accounts that moved")`. Every one of those five is a claim about what the response CANNOT carry, and `hf_transitions` carries it. The replacement test is named for what is now true (the crossings are served and are DERIVED from the cells) and the negative assertions invert: the sentence must no longer say a gross crossing count is unavailable.
  - `:106`, `:151`, `:166` (`grew by`, `did not change`, `shrank by`). The net arithmetic and its singular/plural forms stay; what changes is that each must now carry the gross split beside the net rather than a caveat instead of it. `:151` is the case that gains the most: an unchanged population with one entry and one exit is now a statable fact rather than the thing the caveat existed to warn about.
  - `:207` `"REFUSED ROWS ARE NAMED in the same breath as the shift"`. Its asserted string is `"2 more rows are counted refused and sit in neither distribution"`, and **the second half is now false**: those rows sit in lane N+1, which IS a position in the joint distribution, with `from_rows[N+1] == to_rows[N+1] == unmeasured_rows` and the cause split beside it. The replacement keeps the naming obligation (the rows are still named in the same breath) and states where they sit instead of claiming they sit nowhere. It should read the server's `measured_rows` rather than recomputing `measuredCount`, per §10 item 10.

  **The replacement assertions, over the §5.3 mixed-direction matrix.** Stated as concrete numbers so the rewrite is checkable rather than left to the implementer. The test builds the matrix from the fixture as a TEMPLATE and fills its own cells, exactly as `histogramWith` (`:50-67`) already does for histograms today; it does not depend on `run-book.eth_minus_30.json` carrying that book. With `from_rows: [1,0,0,1,1,0,0,0,0,0]`, `to_rows: [2,0,0,1,0,0,0,0,0,0]` and the three occupied cells `(4→0)`, `(3→0)`, `(0→3)`, over below-one lanes `{0, 1}` (the `belowOneCount` rule the file already pins at `:73-88`):

  | quantity | value | derivation |
  |---|---|---|
  | below-one net delta | **+1** | `Σ to_rows[{0,1}] − Σ from_rows[{0,1}]` = 2 − 1. The number today's sentence already carries. |
  | entries below one | **2** | cells with `to ∈ {0,1}` and `from ∉ {0,1}`: `(4→0)` and `(3→0)` |
  | exits from below one | **1** | cells with `from ∈ {0,1}` and `to ∉ {0,1}`: `(0→3)` |
  | all lane changes | **3** | `lane_changed_rows`, read off the wire |

  Four distinct numbers on one engine of one book, which is what makes the test discriminating: a rewrite that prints the net twice, or that prints `lane_changed_rows` where the crossing count belongs, fails. **The three must be asserted independently and the third must NOT be computed from the first two.** `entries + exits == lane_changed_rows` holds on this book only because no measured row here changes lane without crossing the below-one boundary; it is a coincidence of the fixture and not a law, and §4.7 claim 7 is explicit that `lane_changed_rows` counts lane changes and not crossings of any particular edge. The Debt Manager sentence keeps its DISCLOSURE clause unchanged (`:180-205`): the comparator argument of §1.2 is untouched by serving the joint.

- **`TestRunBookMoversTotalIsNotTheNetEligibilityChange`** (`cmd/api/p5_runbook_bsplit_db_test.go:252`): unchanged and now load-bearing for two more claims. It already pins the mixed-direction book's histograms, mover list and net count, which §5.3's matrix must reproduce exactly.
- **`TestAPIIssuesNoWritingSQL`**: continues to hold; this wave adds no SQL literal.
- **`TestLiquidatableDisclosureLawSweepsTheWholeContract`**: continues to hold. See §9.1 for why it does not police this subtree and what does.
- **`packages/client-ts/test/example-clock.test.ts`**: the four serve-time fields are untouched; the example's clock coherence is unaffected.

### 7.5 Client and web laws

| where | law |
|---|---|
| `packages/client-ts/test/drift.test.ts` | regenerating from `api/openapi.yaml` must reproduce `src/generated/schema.ts` byte for byte; run `npm run gen` and commit |
| `packages/client-ts/test/fixtures.test.ts` | asserts `contract.version === CONTRACT_VERSION`; bump `CONTRACT_VERSION` from `"1.6.0"` to `"1.7.0"` in `src/types.ts:240` |
| `packages/client-ts/src/types.ts` (new) | **`TransitionLaneKind` is defined here and its definition is `export type TransitionLaneKind = RunBookTransitionLane["kind"]`**, an indexed access on the regenerated schema type rather than a hand-written union. `RunBookTransitionLane.kind` is an INLINE enum on that schema (§2.1) and not a named component, so the `Schemas["EventAmountUnit"]` form used at `types.ts:108` is unavailable and the indexed access is what makes the alias track the contract. Then `const TRANSITION_LANE_KIND_SET = { bucket: true, infinite: true, unmeasured: true } as const satisfies Record<TransitionLaneKind, true>` and `export const TRANSITION_LANE_KINDS = Object.keys(TRANSITION_LANE_KIND_SET) as readonly TransitionLaneKind[]`, the `EVENT_AMOUNT_UNITS` pattern verbatim (`types.ts:190-196`), total BOTH ways: a lane kind the contract adds breaks the compile on a missing key and one it drops breaks it on an excess key. An earlier revision used the name `TransitionLaneKind` without ever saying where it comes from and named the exported constant two different ways in two sections; both are fixed here |
| `packages/client-ts/test/readme-sync.test.ts` | see §9.3. The existing sweep is typed to `boolean \| null` and cannot see `held_rows` / `lane_changed_rows`; widening it in place does NOT compile, and the replacement is a second, parallel law |
| `web/tests/unit/proof-contract-fidelity.spec.ts` | re-extracts from the yaml and fails on drift; regenerate `web/lib/proof-contract.gen.ts` |
| new `web/tests/unit/lab-transition.spec.ts` | the client-side derivation module re-checks marginal agreement AGAINST the served histograms and refuses to render a matrix whose margins disagree; the `matrixCells.ts` precedent ("nothing is classified before it is validated"), applied to a body that could arrive from an older or a broken deployment. It must also assert that a null `held_rows` renders as "not measured" and never as 0 |
| new `web/tests/e2e/runbook-transition.spec.ts` | sibling of `runbook-bsplit.spec.ts`, driven from the regenerated fixture family |

---

## 8. AlgorithmRevision impact: nothing persisted changes

`riskfeed.AlgorithmRevision` (currently **6**, `internal/riskfeed/assemble.go:126`) versions the laws in that file and everything they derive: the riskd pass, its persisted rows, and the batch identity vector that carries `rev=%d;`. This wave touches none of it.

- The matrix is computed at SERVE TIME in `cmd/api` from already-persisted rows plus the pure library. `handleRunBook` still writes nothing.
- No column is added, changed or reinterpreted. No migration; `schema_version` is unchanged.
- `bucketIndexOf`, `histogramEdges`, `edgeWad` and `histogramComparator` are unchanged. The lane vocabulary calls `bucketIndexOf` and adds no edge and no comparator.
- No scenario definition changes, so `scenario_config_version` is unchanged.
- The substrate digest, the registry fingerprint and the materialization key are inputs to the PASS, not to this handler.

**Conclusion: `AlgorithmRevision` stays 6.** `cmd/riskd/legacy_revision_live_test.go`'s pin ("must be 6 AND actually serialized") is unaffected. If a future wave ever moves an edge in `histogramEdges`, that is a different question and would move both histograms and this matrix together, which is exactly the property the shared-law design buys.

The §4.2, §4.3 and §4.6 refusals are serve-layer behavior changes on paths that are unreachable with today's engines, today's status vocabulary and today's committed scenarios. They change no persisted value and no served value on any constructible request.

---

## 9. Contract-law compliance

### 9.1 The liquidatable-disclosure sweep, and why it is not the guard here

`cmd/api/contract_sweep_law_test.go` walks every response schema carrying one bit of state, "licensed", and flags any property whose name contains "liquidatable" that it meets while unlicensed. Two rules bear on this subtree:

- **The re-clock vocabulary is `batch_id`, `computed_at`, `bucket_start`** (`reclockNames`, line 101). A schema requiring one of them speaks for a clock the response envelope cannot vouch for, and re-clocking without attaching sweep evidence voids the outer license. `RunBookTransitions` and its three child schemas require NONE of them, deliberately: this matrix is computed at the response envelope's own batch, and giving it its own clock field would be a claim about provenance that is false.
- **The run-book root is already licensed** through `RunBookResponse.batch` to `Batch.watermarks` (required, `minItems: 1`) to `Stamp`, which requires `sweep` (`api/openapi.yaml:1687`). That is why `ProjectionHorizon.becomes_liquidatable`, already served under `RunBookEngine.projection`, passes today.

The consequence is worth stating plainly rather than leaving implicit: because the root is licensed, a field named `liquidatable_lane` or `newly_liquidatable_rows` inside `hf_transitions` would slip past this sweep without a violation. The sweep is not the guard on this surface. The design is: §1.2 makes the lanes a disclosure and not a verdict, and no property name in this subtree contains "liquidatable" because none of them is one. A reviewer should treat any future proposal to add one as requiring the §1.2 argument to be reopened, not as a contract-lint question.

### 9.2 Two 1.6.0 descriptions that this wave must correct

The draft inherited a false claim from the contract itself. `RunBookHistogram.refused_count`'s description (`api/openapi.yaml:3807-3814`) opens:

> "Positions on this engine carrying no comparator on this side, including the rows this layer could not rebuild (which are also in `coverage.excluded`)."

That is the description's first sentence, quoted with only the YAML block scalar's line wrapping folded; it carries no em-dash and is otherwise byte-exact.

Both halves are wrong, per §2.2: no measured row carries no comparator, and the rows in question are predominantly riskd refusals, which are in `coverage.refused_in_batch` and NOT in `coverage.excluded`. On the contract's own committed example the sentence points at an empty array.

The served note has the same defect. `runMeasure.wire` composes (`cmd/api/p5_runbook.go:306-309`), quoted here with the source's em-dash at `:308` normalized to a comma per the quotation law in the header, so this blockquote is NOT byte-exact against the served bytes:

> "`infinite_count` is accounts with no debt and `refused_count` is positions carrying no comparator, both are counted here rather than dropped, so the buckets plus these two account for the whole run."

Two corrections, and they are different kinds of change:

| what | kind | blast radius |
|---|---|---|
| `RunBookHistogram.refused_count` description in `api/openapi.yaml` | documentation only, no field added or removed, no served byte changes | regenerate `web/lib/proof-contract.gen.ts`; `drift.test.ts` and `proof-contract-fidelity.spec.ts` |
| the `refused_count` clause in `runMeasure.wire`'s composed note | SERVED BYTES change | re-capture the run-book 200 example, regenerate all 14 run-book web fixtures (253,028 bytes), and re-check `/v1/book`'s histogram note is untouched (it is: `histogramComparator`'s note is shared, the corrected clause is not) |

Both land in this wave. Leaving them would put the lane-9 vocabulary in direct contradiction with the field it reconciles against, in the same body, which is a new D-013 defect created by shipping the matrix beside a stale description.

### 9.3 A hazard the client-ts seal cannot see, and why the obvious fix does not compile

`packages/client-ts/test/readme-sync.test.ts` holds `SEALED_FIELD_NAMES` to a compile-time sweep over every field whose type is exactly `boolean | null` at any depth (`DeepNullableBooleanKeys`, `:226-242`; `DeepSchemaSweep`, `:257-259`), and it holds the two BOTH WAYS at module scope:

```ts
const everySealedFieldIsListed:  [SealedClassFieldName] extends [ListedFieldName] ? true : "…" = true;  // :297
const everyListedFieldIsSealed:  [ListedFieldName] extends [SealedClassFieldName] ? true : "…" = true;  // :300
```

`held_rows` and `lane_changed_rows` are `number | null`, so the sweep does not see them, and they carry the same falsiness hazard one type over: `!t.held_rows` reads `null` ("this run measured no row") and `0` ("every measured row changed lane") as the same branch.

**The obvious fix is wrong and must not be attempted.** Widening `DeepNullableBooleanKeys`'s leaf test to `number | null` and adding only the two new names to `SEALED_FIELD_NAMES` breaks `npm run verify` at typecheck, immediately. `packages/client-ts/src/generated/schema.ts` already carries **26 distinct `number | null` field names**: `accounts`, `age_seconds`, `amount_decimals`, `anchor_block`, `block_number`, `collateral_index_block`, `covered_from_block`, `current_acked_epoch`, `current_batch_id`, `current_last_block`, `current_max_epoch`, `debt_decimals`, `debt_index_block`, `decimals`, `eligible_positions`, `from_block`, `highest_quarantined_block`, `insolvent_positions`, `liquidatable_positions`, `observed_max_gap_seconds`, `since_block`, `step`, `step_seconds`, `tested_budget_seconds`, `to_block`, `total_positions`. The `everySealedFieldIsListed` direction fails on all 26 at once.

Sealing all 26 is worse, and the reason must be stated accurately because an earlier revision of this section overstated it. `HAZARDOUS_NAMES` is `[...SEALED_FIELD_NAMES, ...HEURISTIC_CHAIN_NAMES]` (`:165`) and is compiled directly into the docs-lint regex, `new RegExp(HAZARDOUS_NAMES.join("|"), "iu")` (`:168`), matched UNANCHORED as `suspect.test(chain)` (`:316`).

**`liquidatable_positions` is NOT a new harm: it is already matched today.** `liquidatable` is already a member of `SEALED_FIELD_NAMES` (`:135`), and the match is a substring test, so `!x.liquidatable_positions` is already flagged by today's lint. Adding the longer name as its own alternative changes the regex's behavior on that string not at all. That half of the earlier justification was a harm that has already happened, which is exactly the class of unchecked knock-on claim this document refuses to inherit, so it is withdrawn rather than reworded.

**The surviving reason is `age_seconds` and `decimals`, and it is sufficient.** Neither matches any alternative in today's vocabulary (checked against the twelve members: `found`, `liquidatable`, `used_as_collateral`, `becomes_liquidatable`, `deficit_paired`, `became_eligible`, `liquidation_verdict`, `collateral_use`, `result`, `lookup`, `verdict`, `outcome`), so sealing the whole set genuinely does drag them in for the first time. They are legitimately-falsy quantities: a zero age and a zero decimal count are ordinary values, and `!x` on them is not the withheld-statement hazard the vocabulary describes. Overloading one regex with two different hazard classes makes both weaker, and one new false-positive class is enough to reject the widening on its own.

**The recommendation is a SECOND, PARALLEL law rather than a widened one.** Separate the INVENTORY (closed by the compiler, over the whole class) from the HAZARD VOCABULARY (curated, feeding the regex):

1. Add `DeepNullableNumberKeys` beside `DeepNullableBooleanKeys`, identical recursion, and a `DeepSchemaNumberSweep<Budget>` beside `DeepSchemaSweep`.

   **THE LEAF TEST IS TWO PARTS AND THE SECOND PART IS NOT OPTIONAL.** `DeepNullableBooleanKeys`'s leaf (`packages/client-ts/test/readme-sync.test.ts:234-238`) is not a single `extends`; it is a widening test followed by a null-membership guard:

   ```ts
   [Required<T>[K]] extends [boolean | null]
     ? [null] extends [Required<T>[K]]   // :235, THE GUARD
       ? K
       : never
     : never
   ```

   The inner `[null] extends [Required<T>[K]]` is the entire reason that sweep selects `boolean | null` and NOT plain `boolean`: a plain `boolean` satisfies `boolean extends boolean | null`, so the outer test alone matches it. The new sweep carries the guard verbatim, one type over:

   ```ts
   [Required<T>[K]] extends [number | null]
     ? [null] extends [Required<T>[K]]   // THE SAME GUARD, and it is load-bearing
       ? K
       : never
     : never
   ```

   Dropping it is not a style difference. `src/generated/schema.ts` carries **94 distinct field names declared somewhere as plain `number`** (`accounts`, `acked_epoch`, `advisory_rows`, `algorithm_revision`, `batch_positions`, `count`, `in_book`, `infinite_count`, `movers_total`, `position_count`, `refused_count`, `rows`, `usd_decimals`, `value_decimals` and the rest); **85 of them appear nowhere as `number | null`**, the other 9 being names the two lists share (`accounts`, `age_seconds`, `block_number`, `decimals`, `from_block`, `liquidatable_positions`, `since_block`, `step`, `to_block`, each plain on one schema and nullable on another). So a guardless leaf makes the sweep yield an inventory of 111 names, `NULLABLE_COUNT_FIELD_NAMES` at 28 fails its `everySealedFieldIsListed` direction against it, and `npm run verify` dies at typecheck. That is the exact failure this section exists to forbid, reproduced by its own remedy, so the guard is written out here rather than left to "identical recursion".
2. Add `export const NULLABLE_COUNT_FIELD_NAMES` listing all 28 names (the 26 above plus `held_rows` and `lane_changed_rows`), held BOTH WAYS against the new sweep exactly as `SEALED_FIELD_NAMES` is. Any future `number | null` field then fails compilation until it is named and considered.
3. Add `export const HAZARDOUS_COUNT_NAMES = ["held_rows", "lane_changed_rows"] as const` and fold it into `HAZARDOUS_NAMES` alongside `SEALED_FIELD_NAMES` and `HEURISTIC_CHAIN_NAMES`. Only these two reach the docs-lint regex, because only these two carry the withheld-statement hazard.
4. Reuse `SweepBudget` and the `SweepBudgetExhausted` poison value unchanged; the new sweep must be probed on `MarginProbeBudget` too, or the budget assertion covers only half the class.

The alternative, documenting the pair in README prose only, leaves the next such field uncovered and is rejected.

**Depth check (unchanged and correct).** `DeepSchemaSweep` spends one budget unit entering each object or array. `MarginProbeBudget` is 8 (`:195`), matching today's deepest chain (`StressResponse` to `scenarios[]` to `Scenario` to `results[]` to `ScenarioResult` to `projection` to `horizons[]` to `ProjectionHorizon`). The new chain is `RunBookResponse` to `engines[]` to `RunBookEngine` to `RunBookTransitions` to `outflows[]` to `RunBookTransitionOutflow` to `cells[]` to `RunBookTransitionCell`, which is exactly 8. It TIES the probe rather than exceeding it, so no budget grows, but the margin probe is now saturated by two chains instead of one: any future wave that nests one more level under a cell must grow `MarginProbeBudget` and `SweepBudget` together.

---

## 10. Client-ts and web weld checklist

**`packages/client-ts/`**

1. `npm run gen` to regenerate `src/generated/schema.ts`; commit (enforced by `drift.test.ts`).
2. `src/types.ts`: add `RunBookTransitions`, `RunBookTransitionLane`, `RunBookTransitionOutflow`, `RunBookTransitionCell` aliases to the "Book-wide scenario run" section; add the `TransitionLaneKind` alias (`= RunBookTransitionLane["kind"]`, §7.5) with its `TRANSITION_LANE_KIND_SET` weld and the `TRANSITION_LANE_KINDS` export derived from it; bump `CONTRACT_VERSION` to `"1.7.0"`.
3. **`src/client.ts`: `SolventClient.runBookScenario` ALREADY EXISTS and IS on this checklist.** It is `async runBookScenario(id: string, signal?: AbortSignal): Promise<RunBookResponse>` at `packages/client-ts/src/client.ts:559`, inside `export class SolventClient` (`:233`), refusing an off-pattern id locally against `SCENARIO_ID_PATTERN` (`:106`, used at `:560`) before any request is sent, and it is published at `packages/client-ts/dist/client.d.ts:294`. An earlier revision of this section claimed the method did not exist, propagating the stale header comment in `web/lib/runbook.ts` instead of checking the symbol; the claim is deleted, not softened, because it excluded from the weld the one typed entry point through which `hf_transitions` reaches every consumer of this package. What actually changes: **no new method and no signature change**, because `RunBookResponse` widens through the regenerated schema and every existing call site keeps compiling; and **the method's contract docblock (`:553-558`) must gain the `hf_transitions` sentence**, since it enumerates what the route serves and would otherwise describe a 1.6.0 body while returning a 1.7.0 one.
4. `test/readme-sync.test.ts`: per §9.3, add the parallel `number | null` sweep and its both-ways `NULLABLE_COUNT_FIELD_NAMES` law (28 names), and add `HAZARDOUS_COUNT_NAMES` with the two new fields only. Do NOT widen the existing boolean sweep. **The new sweep's leaf test must carry the `[null] extends [Required<T>[K]]` guard** copied from `:235`; without it the sweep selects all 94 plain-`number` names and typecheck fails on arrival (§9.3 step 1). Note the separate coercion hazard for consumers: `Number(cell.debt_before_usd)` coerces `null` to `0`, and a null cell debt means THIS RUN MEASURED NOTHING and must never be coerced.
5. `test/fixtures.test.ts`: no fixture change. The committed client fixtures cover address, book, stress, observatory and meta, and carry no run-book body.

**`web/`**

6. `web/lib/proof-contract.gen.ts` is GENERATED by `tests/fixtures/generate-proof.mjs`; regenerate rather than hand-edit. Three things move: `CONTRACT_META.version` to `"1.7.0"`, the run-book operation `description` (the new ADDED-1.7.0 paragraph plus the §9.2 correction), and its `example` (now carrying `hf_transitions`).
7. **Regenerate the run-book fixture family.** `web/tests/fixtures/generate.mjs` extracts the contract's 200 example verbatim into `run-book.weeth_market_depeg_oracles_held.json`, and `generate-lab-book.mjs` derives the rest (including `run-book.weeth-withheld.json`, hand-derived at `:6528`). That is 14 files, 253,028 bytes today. The §9.2 note correction touches all of them independently of `hf_transitions`.
8. `web/lib/runbook.ts`: **the TYPES need no change, the PREAMBLE does.** `RunBookEngine` is `components["schemas"]["RunBookEngine"]` and `LabRunBookEngine` overrides only `projection`, so `hf_transitions` flows through untouched. But this module's header comment is now false in two places: it says the run-book route's "client method lands LATER" and it closes "Replace with `client.runBookScenario()` when the client grows it." The client HAS grown it (item 3, `client.ts:559`). Leaving a stale "until then" preamble standing beside a shipped method is the same defect class this wave exists to remove, one file over, and it is what an earlier revision of this spec read and believed instead of the code. Correcting the comment costs zero served bytes and belongs in this wave. Whether to retire the stand-in module itself is a separate decision, ledgered in §12.
9. New component. **Do not name it `LabMatrix`**: `web/app/lab/LabMatrix.tsx` is the scenario-by-engine matrix (Wave W-SD-A) and the collision would be a real one. Use `LabRunBookTransition.tsx` with a pure decision layer in `labTransition.ts` (the `matrixCells.ts` split). Structural requirements only, since another wave owns the copy strings: it consumes `engine.hf_transitions`; ribbon and cell weight is `rows`, with debt as the annotation; a null cell debt renders in the refusal register (the `styles.unpricedTag` named-absence pattern `LabRunBookDetail.tsx` already uses) and never as `$0`; a null `held_rows` or `lane_changed_rows` renders as "this run measured no row on this engine" and never as 0; one count scale within one engine's matrix; no cross-engine aggregate anywhere; the wire's `note` renders verbatim; the Debt Manager comparator gets no crit tint, matching the existing `eligibleTint = comparator === "hf_wad"` asymmetry.
10. `web/app/lab/labRunBookLines.ts`: `histogramShiftReadingLine`'s NET disclosure must be RETIRED, not reworded. Its central claim ("compute it here (impossible from two histograms)") becomes false the moment this ships, and a stale impossibility caveat beside a served gross count is itself a D-013 defect. The derivation changes from `belowOne(after) − belowOne(before)` (a difference of populations) to a sum over cells whose `to` is a below-one lane and whose `from` is not (a gross crossing count), with the Debt Manager comparator still labeled a disclosure. Two constraints on the rewrite: the sentence must keep `measuredCount`'s exclusion of the unmeasured tail (it is now `measured_rows` on the wire, so the client should read the server's number rather than recompute it), and it must not describe `lane_changed_rows` as a 1.00-crossing count, because it is not one.
11. Backward compatibility: a 1.6.0-generated validator with `additionalProperties: false` will reject a 1.7.0 body. That is inherent to this contract's style and was equally true at 1.6.0; readers that merely index fields are unaffected. Worth one line in the release note.

---

## 11. Invariants claimed

1. **LANE VOCABULARY.** `len(lanes) == len(histogramEdges) + 2 == len(outflows) == len(from_rows) == len(to_rows)`; `lanes[i].index == i` and `outflows[i].from == i` for all i; `lanes[0..N-1].kind == "bucket"` and equal the served `hf_histogram.buckets[i]` in `label`, `lower_wad` and `upper_wad` byte for byte; `lanes[N].kind == "infinite"`; `lanes[N+1].kind == "unmeasured"`.
2. **ROW MARGIN** (the headline law). For every lane i, the sum over `outflows[i].cells` of `rows` equals `from_rows[i]` equals `beforeTally(i)`, where `beforeTally(k)` is `before.hf_histogram.buckets[k].count` for k < N, `before.hf_histogram.infinite_count` for k == N, and `before.hf_histogram.refused_count` for k == N+1.
3. **COLUMN MARGIN.** For every lane j, the sum over all outflows of the `rows` in the cell with `to == j` equals `to_rows[j]` equals `afterTally(j)`, with `afterTally` defined against `after.hf_histogram` by the same three-way rule.
4. **GRAND TOTAL PARTITION.** The sum over every cell of `rows` equals `total_rows` equals `before.accounts + unmeasured_rows` equals `after.accounts + unmeasured_rows`, and `measured_rows == before.accounts == after.accounts`. No position row is in two cells and none is in zero cells. `total_rows` is NOT claimed to equal `coverage.batch_positions`, and `Σ_engines total_rows` is NOT claimed to equal `coverage.in_book`; §5.4 gives the four reasons and shows why an observed equality is not evidence.
5. **MOVEMENT PARTITION, OVER THE MEASURED ONLY.** When `measured_rows > 0`: `held_rows + lane_changed_rows + unmeasured_rows == total_rows`, where `held_rows` sums cells with `from == to` over lanes 0..N and `lane_changed_rows` sums cells with `from != to` over the same lanes. When `measured_rows == 0`: both are null and `total_rows == unmeasured_rows`.
6. **SPARSITY IS TOTAL.** Every emitted cell has `rows >= 1`; within an outflow the `to` values are strictly ascending and unique; a lane pair absent from `cells` holds exactly zero rows, a knowable zero made complete by the dense `lanes`, `outflows`, `from_rows` and `to_rows` arrays.
7. **THE UNMEASURED LIVE ON ONE CELL, AND THEY ARE SPLIT BY CAUSE ON THE COVERAGE COUNTERS' OWN PREDICATES.** `from_rows[N+1] == to_rows[N+1] == unmeasured_rows`; the only cell in outflow N+1 is `(N+1, N+1)`; `unmeasured_refused_in_batch_rows + unmeasured_excluded_by_this_layer_rows == unmeasured_rows`; the first count is incremented on `p.Status == store.RiskPositionRefused`, the same positive predicate `coverage()` uses for `refused_in_batch` (`cmd/api/handlers.go:701`), and the second on `p.reconstructionErr != ""`, the same predicate `coverage()` uses for `excluded` (`:704`); an unmeasured row matching neither is a named 500. The two counts are CARRIED to the wire builder on the per-engine `*runUnmeasured` record (§4.3, §4.4), because nothing else in the data path holds a cause: neither `runLaneEntry` nor the both-sides fold does. The builder re-checks the sum against the lane-N+1 population it actually placed and refuses with a named 500 on disagreement, so the split is derived at the point of construction rather than restated beside it.
8. **UNKNOWABLE NEVER ZERO.** Cell `(N+1, N+1)` carries `debt_before_usd == null` and `debt_after_usd == null`. Every other emitted cell carries non-null exact decimal strings on both. The string `"0"` is never served for a population this run did not measure.
9. **KNOWABLE ZERO IS SERVED AS ZERO, ON THE SIDE THAT KNOWS IT.** Cell `(N, N)` carries `"0"` on both sides. In general a cell's debt on one side is the exact sum of the contributing rows' debt AS COMPUTED ON THAT SIDE, never a value inferred from either lane, so a hypothetical cell `(i, N)` with i < N would carry a positive `debt_before_usd` and `"0"` after. That cell is not reachable under any committed scenario (§2.3).
10. **DEBT RECONCILES PER SIDE, AND THE TWO SIDES CAN DIFFER.** The sum over all cells of `debt_before_usd` (as big.Int over the decimal strings, nulls skipped) equals `before.total_debt_usd` exactly; the sum of `debt_after_usd` equals `after.total_debt_usd` exactly. Both are in this engine's own `usd_decimals` and are never added to another engine's. On the Debt Manager the two sums are equal by construction (`internal/risk/scenario.go:780`); on Aave they differ whenever a shocked asset is a debt leg, witnessed at `"1640000000000"` against `"1400000000000"` by `seedMixedDirectionBatch` under `eth_minus_30`.
11. **ONE BUCKET LAW.** Every lane assignment routes through `bucketIndexOf`; the histogram tally and the lane record are written by the single `runMeasure.place` call, so no code path can increment one without appending the other. A measured state `bucketIndexOf` cannot place is a named 500, never a silent lane.
12. **PAIRING IS POSITIONAL AND GUARDED.** `len(before.lanes) == len(after.lanes)`, and `before.lanes[k].account == after.lanes[k].account` for every k. A violation is a 500 with a named reason, never a served matrix.
13. **THE UNIT IS CHECKED OVER THE WHOLE MATRIX, NOT ASSUMED AND NOT HALF-CHECKED.** The accounts of `before.lanes` are pairwise distinct across BOTH populations it holds, the measured entries appended by `place` and the unmeasured entries appended by the handler fold. Invariant 12 carries the property to the after side. A violation is a 500 with a named reason, so the note's "one row is one account on this engine" covers every row in the matrix rather than only the measured ones.
14. **NO SILENT ENGINE.** A `PositionInput` on an engine `measureRunBook` has no arm for is a named 500, not a row in zero cells.
15. **COMPARATOR AGREEMENT.** `hf_transitions.comparator == before.hf_histogram.comparator == after.hf_histogram.comparator`, and `hf_transitions.wad_scale == risk.WadUnit().String() ==` both histograms' `wad_scale`.
16. **DETERMINISM.** Two runs of the same batch and scenario serve byte-identical `hf_transitions`: outflows in lane order, cells ascending by `to`, no map iteration reaching the wire.
17. **BOUNDEDNESS.** Emitted cells per engine are at most `(len(histogramEdges) + 2)^2 == 100`, independent of the number of positions in the book.
18. **NO CLOCK OF ITS OWN.** `RunBookTransitions` and its children require none of `batch_id`, `computed_at`, `bucket_start`, so the contract sweep's re-clock rule does not fire and the response envelope's batch is the only clock these numbers are stated at.
19. **NAMING.** In this subtree, every field name ending in `rows` holds a count of position rows or an array of such counts; no field name ends in `accounts`; every array of objects is named for its elements (`lanes`, `outflows`, `cells`) and none of those names ends in `rows`.
20. **NOTHING PERSISTED CHANGES.** `riskfeed.AlgorithmRevision` stays 6, the store `schema_version` is unchanged, `scenario_config_version` is unchanged, and `TestAPIIssuesNoWritingSQL` still passes over `cmd/api`.

---

## 12. Open questions

- **Should `held_rows` and `lane_changed_rows` be nullable, or should the note carry the whole disclosure?** RECOMMENDATION: nullable, as specified. A zero over an unmeasured book is the exact shape `labRunBookLines.ts` already refuses to print, and a note is a weaker guard than a type, because a note can be skipped by a machine consumer and a null cannot. The cost is the falsiness hazard in §9.3, which is real and is why the parallel client-ts law should land in the same wave rather than later.
- **Should the two `unmeasured_*_rows` split counters be served, or should the note simply name both coverage fields?** RECOMMENDATION: serve them. `coverage.refused_in_batch` is book-wide, so without the split there is no per-engine way for a reader to know which coverage field holds this engine's unmeasured rows, and the draft's failure mode was precisely a confident pointer at the wrong one. Two integers per engine is the cheapest honest fix, and §4.3's fail-closed default is what keeps the pointer true if the status vocabulary ever grows a third token the schema does not forbid.
- **ONE DEBT FIGURE OR TWO PER CELL?** RECOMMENDATION: two. Aave's `total_debt_base` is the per-reserve sum of `MulDivCeil(live_debt, price, den)` (`internal/risk/aave.go:182`), so a shock that re-prices an asset a row BORROWS moves it, while the Debt Manager's `borrowings` is copied verbatim (`internal/risk/scenario.go:780`) and its two figures are equal on every scenario. With one figure, either the row sums or the column sums would fail to reconcile on the Aave side and the reader would have no way to know which. The witness is committed: `seedMixedDirectionBatch` under `eth_minus_30`, where the (0→3) cell carries `"800000000000"` before and `"560000000000"` after because that account's debt leg is weETH (§5.3). Note what is NOT a witness: the three `stable_depeg_*` scenarios declare `engines: ["debt_manager"]` and emit no Aave row at all, so no stable scenario can move Aave debt, and the contract's own 200 example has an empty shock list. Cost is roughly 33 bytes per occupied cell.
- **SPARSE OR DENSE CELLS?** RECOMMENDATION: sparse cells, dense `lanes` / `outflows` / `from_rows` / `to_rows`. Dense cells cost ~13.8 KB per engine (+133% on the 20,862-byte contract-example body); sparse costs ~0.2 to 2.8 KB of cell payload. Absence is honest here only because both margins and the full lane vocabulary are served densely beside it, and the note says so.
- **SHOULD THE ROW MARGIN LIVE INSIDE THE OUTFLOW OBJECT OR IN A DENSE ARRAY?** RECOMMENDATION: a dense array, symmetric with `to_rows`. The two margins are the same kind of fact about the same lane vocabulary, and putting one inside an object and the other in a bare array made them look like different kinds of fact while duplicating the row margin beside the cells that already sum to it. The dense-array form is also 14 bytes cheaper on each empty lane. This is what forces the object array to be named `outflows`: with `rows` free, `cell.rows` and `from_rows[]` both mean the same thing, and nothing named `rows` holds objects.
- **PER-CELL COLLATERAL AS WELL AS DEBT?** RECOMMENDATION: no. It would roughly double the cell payload for a quantity the flow view does not need, and `collateral_by_asset` already decomposes each side.
- **PER-CELL ACCOUNT IDENTITIES?** RECOMMENDATION: no. The list is unbounded in the book size, and `movers` is already the bounded identity surface with its cap disclosed. A cell that named its accounts would be a second, differently ranked, uncapped movers list. If drill-down is wanted later, add a separate bounded endpoint.
- **FIELD NAME: `hf_transitions` versus `transitions` versus `hf_transition_matrix`.** RECOMMENDATION: `hf_transitions`. It parallels `hf_histogram`, the register's existing `hf_` prefix for anything stated on the health-factor comparator, and it reads correctly on both engines, where the Debt Manager's lanes are a disclosure rather than a health factor as such.
- **LABELS FOR THE TWO NON-BUCKET LANES.** These are new server-owned strings that appear in the captured contract example and, verbatim, in the UI. RECOMMENDATION: `"no debt (unbounded)"` for lane N and `"not measured"` for lane N+1. Note that `"not measured"` deliberately does NOT echo the 1.6.0 field name `refused_count`, because §2.2 shows that name is wrong; §9.2 corrects the description rather than propagating the error into a second place. Confirm both with whoever owns the copy register before capture: changing them later means re-capturing the contract example and regenerating 14 web fixtures.
- **SHOULD `lane_changed_rows` BE NAMED SOMETHING ELSE AGAIN?** The name deliberately does not contain "moved", "crossed" or "movers". Alternatives considered: `bucket_changed_rows` (accurate but wrong once the lane vocabulary exceeds the buckets) and `edge_crossings` (implies a particular edge, and breaks the `*_rows` naming law of §2.0). RECOMMENDATION: keep `lane_changed_rows` and rely on the note's claim 7 for the three disambiguations, since no single name distinguishes it from `movers_total` on its own.
- **SHOULD A PROJECTION OR MARKET-REALIZATION SCENARIO CARRY A MATRIX AT ALL?** Both are exactly diagonal by construction. RECOMMENDATION: serve it, and say only "this scenario moved no row between lanes". Making the field conditional would turn its absence into an ambiguous signal. Do NOT describe the diagonal as corroborating `hfs_unchanged`; §3 gives the reason.
- **SHOULD THE MIS-PAIRED ZIP, THE DUPLICATE-ACCOUNT CHECK, THE UNCLASSIFIABLE UNMEASURED ROW AND THE MISSING ENGINE ARM 500 OR DEGRADE?** RECOMMENDATION: 500 with a named reason in all four cases, matching the existing "applying scenario ... refused a verified position" path. Inputs here are reconstruction-verified and the two sides are index-aligned by construction, so each is a defect in the serve layer or a violation of a database constraint rather than a property of the data, and a matrix with wrong margins (or a count pointing at a coverage surface that does not hold its rows) is exactly the artifact this wave exists to make unconstructible.
- **SHOULD `web/lib/runbook.ts` BE RETIRED IN FAVOR OF `client.runBookScenario()`?** The stand-in exists because the route's client method was expected to land later; it landed (`packages/client-ts/src/client.ts:559`). The module still does two things the method does not: it seals the outcome into a union so a deployment 404 renders as "not yet served" rather than as an error, and it refines projections through `refineProjection` before any component sees them. RECOMMENDATION: out of scope for this wave, and correct the false preamble now (§10 item 8). Retiring the module is a `web/` refactor with its own test surface and no bearing on `hf_transitions`, which flows through either path unchanged; doing it here would couple a contract wave to a client-layer migration. Worth a follow-up that re-homes the outcome union on top of the real method rather than beside it.
- **CLIENT-SIDE MARGIN VALIDATION IN `web/`: should the Lab refuse to render a matrix whose margins disagree with the served histograms?** RECOMMENDATION: yes, following the `matrixCells.ts` precedent ("nothing is classified before it is validated", the CONTRADICTORY BOOK state). The body can arrive from an older or a broken deployment, and rendering a Sankey whose ribbons do not sum to the bars printed beside them is a wrong answer to an honest user.
- **DOES THE §9.2 SERVED-NOTE CORRECTION BELONG IN THIS WAVE?** RECOMMENDATION: yes. It changes served bytes and forces a re-capture plus a 14-file fixture regeneration, which is real cost, but the alternative is shipping a lane labeled "not measured" whose margin is a field the same body's contract calls "positions carrying no comparator". Two names for one population in one document, one of them false, is a new D-013 defect created by this wave, and deferring the fix is what would create it.
- **SHOULD `risk_positions.status` GAIN A CHECK CONSTRAINT?** The Go POSITION vocabulary is closed to `{computed, refused}` (`internal/store/risk.go:1566-1567`) but the column is bare `TEXT NOT NULL` with the vocabulary in a comment (migration 00013:271-272). §4.3's fail-closed default makes the serving layer honest without it. RECOMMENDATION: out of scope for this wave, because a CHECK constraint is a migration and this wave adds none, and worth a follow-up: the constraint would make §4.3's default arm provably dead rather than merely unreached.
- **SHOULD `RunBookHistogram` GAIN THE SAME `unmeasured_*_rows` SPLIT?** It has the same reader problem: `refused_count` alone does not say which coverage field holds those rows. Adding the split there would be additive and cheap. RECOMMENDATION: out of scope for this wave, and worth a follow-up. Note if it is taken up: the histogram is per aggregate and the split is identical on both sides by construction, so it would be served twice per engine for one fact, which argues for leaving it on `hf_transitions` alone.
