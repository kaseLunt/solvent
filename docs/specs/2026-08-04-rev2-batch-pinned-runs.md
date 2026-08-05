# status: REV2 | pending Codex gate

« CONTRACT 1.7.0 (ADDITIVE) : BATCH-PINNED MULTI-SCENARIO EVALUATION (SET-RUN) »

Revision 2. Every semantic claim below was re-derived from the code named beside
it. Research pass only: nothing in the repo outside this file was modified.

---

## 0. Decision

**Ship shape (A): a set-run endpoint, `POST /v1/scenarios/run-book-set`.**
**Do not ship shape (B) (a `batch_id` pin on the existing per-scenario route) as
the tornado mechanism.**

Three facts settle it.

1. **The expensive work is what (B) repeats and (A) does once.** `POST
   /v1/scenarios/{id}/run-book` served in 1.04 to 1.91 s (n=20, median about
   1.45 s) against the local deployment. `GET /v1/meta`, which performs the
   *same* `s.readBatch(ctx, nil)` plus `reconstructAll` and then only cheap
   queries, served in 1.10 to 1.67 s. The batch read and the reconstruction are
   the dominant term. (B) pays that term N times for no additional information.

2. **The before side is scenario-invariant at a fixed batch, structurally.**
   `risk.Waterfall` accumulates strictly through `engineOf(m.engine, ...)`
   (`internal/risk/waterfall.go:206-267`): a position contributes only to its own
   engine's row, and there is no cross-engine coupling anywhere in the walk.
   `measureRunBook`'s non-Waterfall walk (`cmd/api/p5_runbook.go:653-719`) is
   likewise strictly per position, keyed by `pos.Engine`. A set-run may therefore
   compute the before side once over a union-scoped book and slice it per engine.
   This is the load-bearing argument. An empirical diff over 12 scenarios at
   batch 5759 agreed with it, but that observation covered 12 of the 15 committed
   scenarios against a stale binary and is corroboration, not proof; Test Laws 2
   and 3 are what pin it.

3. **A serial sweep genuinely straddles batches.** Observed materialization
   cadence over the measurement window was about one batch every 50 s (batch 5756
   `computed_at` 20:34:04.909Z to batch 5759 `computed_at` 20:36:34.909Z, three
   batches in 150.2 s), against a serial sweep of roughly 21 s. One sweep of 15
   ids (23.9 s) spanned two batches; another (20.6 s) landed wholly on one. It is
   a coin flip per sweep, which is exactly the condition the web's cohort
   machinery exists to refuse. Refusing a comparison is not the same as being
   able to answer it.

(B) leaves the cross-scenario sentence to be assembled client-side out of N
independently resolved responses, which is the machinery of
`web/app/lab/matrixCells.ts`. (A) makes the sentence true by the shape of the
response: one batch, one census, one envelope, N results.

Shape (B)'s optional `batch_id` remains worth having for drill-down only. It is
subordinate to (A), not an alternative to it. See Open Question 1.

---

## 1. What the code says

Every row was read in this pass. Where an earlier revision asserted something the
code does not support, the correction is in the third column.

| Fact | Where | Consequence |
|---|---|---|
| The run-book resolves the batch per request, always the newest complete one | `cmd/api/p5_runbook.go:400` to `s.readBatch(r.Context(), nil)` to `cmd/api/read.go:321` to `store.NewestCompleteBatchQ` | Two POSTs may evaluate different books. There is no batch pin on this route today. |
| Resolution happens **inside** the read snapshot | `cmd/api/read.go:335-354` (wave H8) | A set-run inherits this: one `BeginRiskSnapshot`, one `SELECT now()`, one batch, one set of child rows. Nothing tears. |
| The committed set is **15 files, all embedded and all loaded** | `internal/risk/scenarios/*.json` (15 files, `eth_minus_40/50/60` included), `internal/risk/scenario.go:45` `//go:embed scenarios/*.json`, `cmd/api/main.go:281-288` loads every one into `s.byID` | N for the tornado is 15 on a binary built from this tree. The 404s observed during measurement were a stale deployment, not the id space. Any 404 example must use an id that is **not** committed. |
| `runBookMovers` has **two different rules**, one per engine | `cmd/api/p5_runbook.go:755-833`. Aave: `drop := b.hfWad - a.hfWad; if drop.Sign() <= 0 { continue }`, with **no eligibility test**. DM: `if b.eligible \|\| !a.eligible { continue }`, the strict false-to-true flip | `movers_total` means **health factors that strictly dropped** on Aave and **eligibility flips** on DM. `api/openapi.yaml` `RunBookEngine.movers_total` already scopes the flip wording to "On the Debt Manager"; `web/app/lab/labRunBookLines.ts:142-159` (`moversSubject`) keeps two subjects, discriminated by `before.hf_histogram.comparator === "hf_wad"`. One field named `flipped_to_eligible` cannot carry both. |
| The Aave movement count has an **excluded population**, and the code insists it be named | `cmd/api/p5_runbook.go:779-783` skips an account when `b.infinite \|\| a.infinite \|\| b.hfWad == nil \|\| a.hfWad == nil`; `p5_runbook.go:772-775` skips any before-side account absent from the after side, on both engines. `runBookMoversNote` (`:843-845`) serves "An account with no debt has an unbounded health factor on either side, so it has no drop to rank and is not counted here, it is not a quiet zero." | `hf_dropped_accounts: 0` beside `accounts: 46` reads as "none of 46 health factors dropped" when the truth may be "most of the 46 carry no health factor at all". The denominator of the movement count must be on the wire, not only in prose. |
| The count of debt-free accounts is published today, and only inside the histogram | `cmd/api/p5_runbook.go:266-267` increments `m.infinite`; `p5_runbook.go:304` serves it as `hf_histogram.infinite_count`, described at `:308` as "accounts with no debt" | A summary that drops the histogram drops the only published count of the population the Aave movement rule cannot test. |
| `AppliedShock` is the **only** wire carrier of `snapped`, `base_snapped`, `cap_bound` | `api/openapi.yaml:2387-2391`, `snapped` described as "The Debt Manager's stable snap band swallowed the move"; built per run at `cmd/api/p5_runbook.go:471-486` from the batch's own before and after price values | `ScenarioDefinition` (`api/openapi.yaml:2494-2497`) publishes `[id, version, label, description, path_assumption, engines, shocks, out_of_model]` and **not** `propagation`, so a scenario file's `stable_snap` is on no wire a set-run client can reach. Whether a requested shock actually moved a price is derivable from nothing else the set-run would serve. |
| A committed **control** scenario exists whose correct answer is all zeros | `internal/risk/scenarios/stable_depeg_0995_in_band.json`: three OP stables at 995/1000, `stable_snap: true` on every propagation row, description "995000 lies STRICTLY INSIDE the snap band (990000, 1010000), so PriceProviderV2 pins it back to exactly 1e6 and nothing moves", `out_of_model` "this scenario is the CONTROL: it must produce zero change on every position" | Beside `stable_depeg_099_boundary` (0.99, band open, does not snap) drawing a real bar, an undisclosed all-zero row reads as "the book is insensitive to a 0.5 percent depeg" when the truth is "the oracle pins any sub-1-percent depeg to par, so this scenario tests the oracle and not the book". `stable_depeg_098_unsnapped` is the partly-snapped case and any binding Aave cap adapter is the third. |
| That scenario's own text points at the missing field | the same file's `out_of_model`: "eUSD ... is therefore correctly HELD FLAT by this scenario; it appears in the held-flat disclosure rather than the propagation matrix" | The committed configuration already refers a reader to a disclosure. A response that omits it sends the reader nowhere. |
| A **projection** scenario declares a shock and runs no `ApplyScenario` pass at all | `internal/risk/scenarios/dm_rate_horizon_plus_200bps.json` has one shock and a projection; `cmd/api/p5_runbook.go:462` gates the whole pass on `sc.Projection == nil` and `:489-491` sets `afterInputs = beforeInputs` | Its applied-shock set is empty **for a different reason** than a shock that reached nothing. An empty array with no arm to explain it is a third wrong reading. |
| A scenario may declare **no** shock | `internal/risk/scenarios/weeth_market_depeg_oracles_held.json`: 0 shocks, 2 market realizations. The pass still runs, vacuously | "No shock reached the book" and "no shock was asked for" are different facts and need different sentences. |
| Aave debt is **priced**, so it moves under a price shock | `cmd/api/p5_runbook.go:663` sums `h.TotalDebtBase`; `internal/risk/aave.go:182` `rv.DebtBase = MulDivCeil(rv.LiveDebt, p.Value, den)` | An engine's total debt has a before side and an after side, and on Aave they differ. A single `total_debt_usd` is a denominator whose side is unstated. DM's `Borrowings` is `in.DebtUSD` carried through (`internal/risk/dm.go:104`, `165`) and is shock-invariant, which is why a DM-only test cannot see this. |
| `coverage.excluded` holds **reconstruction failures only** | `cmd/api/handlers.go:690-716`: `refused_in_batch` counts `p.Status == store.RiskPositionRefused`; `excluded_by_this_layer` and `excluded[]` count `p.reconstructionErr != ""` | The two classes are kept strictly apart in the census. |
| `refusedByEngine` **mixes** those two classes | `cmd/api/p5_runbook.go:424-430` increments for every covered-engine position with `p.input == nil`; `cmd/api/read.go:692-707` skips non-`Computed` rows **without** setting `reconstructionErr` | A batch-refused row has `input == nil` and an empty `reconstructionErr`, so today's `refused_positions` is refused-in-batch plus unrebuildable, under a label that names only the second. The set-run must serve the two separately. |
| The position status vocabulary is closed | `internal/store/risk.go:1563-1568`: `computed`, `refused` | `input == nil` implies refused-in-batch or unrebuildable, with no third case. That is what makes an exact census partition possible. |
| `measureRunBook` and `Waterfall` **return on the first bad position** | `cmd/api/p5_runbook.go:656-698`; `internal/risk/waterfall.go:226-239` | Measuring the **whole** book, rather than the engines the request actually needs, would let a defective position on an engine no requested scenario covers refuse the whole set. The shared measure must be **union-scoped**, and each after measure must be **scenario-scoped**. |
| An empty or fully refused book serves an all-zero engine row under a green census | `cmd/api/p5_runbook.go:720` returns before the Waterfall when the book is empty; `p5_runbook.go:570-576` substitutes `newRunMeasure()` when an engine has no measure; `cmd/api/handlers.go:714` sets `StressCoverageIsFull = ExcludedByThisLayer == 0 && len(withheld) == 0`; `cmd/api/read.go:398-406` "Zero POSITIONS stay legal" | A batch whose positions are all refused yields `excluded_by_this_layer: 0`, no withheld engine, `stress_coverage_is_full: true`, `in_book: 0`, and every aggregate `"0"`, including the denominator. An engine with zero measurable accounts must be a **named absence**, never a numeric row. |
| Withheld engines still enter the run **on the single-scenario route** | `cmd/api/p5_runbook.go:425-440` filters on `covers(sc.Engines, p.Engine)` only; the withheld skip happens later, at `p5_runbook.go:562-565` | Two consequences. `len(beforeInputs)` (today's `coverage.in_book`) includes positions of a withheld covered engine that contribute no row, so any "positions in the run equals the sum of the engine rows" law is false there. And a defective position on a covered-but-withheld engine reaches `measureRunBook` and `risk.Waterfall` and **500s the single route**, which is the asymmetry Invariant 5 must not paper over. |
| `BatchStillNewestServable` returns **only a bool**, off `s.pool` | `internal/store/p5_positions_page.go:481-494`. Its own comment: "false with a nil error means either a newer servable batch exists or none does" | It cannot fill a newest-batch id, and it does not share a snapshot with anything. A probe built from it plus a separate id query plus a separate `now()` can serve a self-contradictory pair. One statement must return both. |
| `riskBatchCompleteConjuncts` is a parameterless predicate over alias `b`, evaluated **live** against child-row counts and the required stamp set | `internal/store/risk.go:1583` and the conjuncts that follow | The probe reuses the serving predicate verbatim, so the two cannot drift. It also means completeness is not a frozen property of a batch row: it is re-evaluated at probe time. |
| Retention prunes **oldest first** | `internal/store/risk.go:1416-1419`, `DELETE ... WHERE id IN (SELECT id FROM risk_batches ORDER BY id DESC OFFSET $1)`; `defaultRetention = 5000` (`cmd/riskd/main.go:66`) | Pruning alone cannot make an older batch servable while the measured one is not. It makes "the newest servable batch is older than the batch measured here" implausible. It does not make it impossible, and a derivation over an ordered id must be **total** either way. |
| The re-clock vocabulary is exactly `{batch_id, computed_at, bucket_start}` | `cmd/api/contract_sweep_law_test.go:101` | A schema requiring `batch_id` **is** a re-clock by the contract's own law. An `evaluation.batch_id` field would therefore be a self-inflicted re-clock. |
| The sweep records a violation **only** at a liquidatable-family property | `cmd/api/contract_sweep_law_test.go:288-360`: `reclocks` sets `licensed = false`, and `st.violations` is appended only where `liquidatableFamily(propName) && !licensed` | The sweep **does** catch a per-scenario `batch_id`, because `Projection.becomes_liquidatable` (`api/openapi.yaml:2440`) sits beneath it. It does **not** catch a re-clock in a block with no liquidatable descendant. The structural backstop is real for the results subtree and absent for a freshness block. |
| `SweepStamp.success_sum` is a **required `Decimal` with no `usd_decimals` in scope** | `api/openapi.yaml:1671-1682` | A walk that says "every `Decimal` under this root must sit beneath a node requiring `usd_decimals`" is red on arrival for every response that carries the batch envelope. The money walk must be rooted at the money-bearing subtree, with the envelope's Decimals pinned as an exact, justified exception set. |
| `BookCoverage` is sealed and its meaning is bound to its description | `api/openapi.yaml:2044-2074`, `additionalProperties: false`, "The audit of what reached the derived arithmetic" | Reusing the component while redefining `in_book` from run-scoped to book-scoped gives one generated type two meanings. The set-run needs its own component. |
| `ipLimiter.allow` is a **one-token API**, and its `Retry-After` is a bucket refill instant | `cmd/api/middleware.go:343-377` calls `lim.ReserveN(now, 1)` and returns `res.DelayFrom(now)`; `rateLimit` (`middleware.go:392-408`) rounds it up into the header | An N-token charge needs an `allowN` and an explicit charge point. And `DelayFrom` is meaningful **only** for a token bucket: it is the instant this bucket refills. It computes nothing about a semaphore whose holder may have twelve more seconds of arithmetic left. The limiter's `now` field (`middleware.go:322-323`) is already a test seam, so a frozen-clock test is available. |
| The web's 429 arm **discards** the envelope message | `web/lib/runbook.ts:158-162` returns `{kind: "rate-limited", retryAfterSeconds}` and drops `envelope.message`; `web/app/lab/matrixCells.ts:2149-2152` renders exactly "rate limited (429), and the service says retry after Ns" | A concurrency refusal served as 429 tells a client that has sent one request in ten minutes that it exceeded a rate it did not exceed, and hands it a retry instant nothing computed. A distinguishing message in the body is invisible: the client never reads it. The 503 arm, by contrast, does carry `envelope.message` (`runbook.ts:149-157`). |
| `BatchSupersededBody` is the standing precedent for a refusal that needs its **own** code | `api/openapi.yaml:3076-3103`: its own body type, `code` enum `[batch_superseded]`, outside `ErrorBody`'s sealed enum, "Its own shape rather than `ErrorBody` because it must NAME both batches: a client told only 'conflict' cannot distinguish a stale cursor from its own bug" | A new refusal may carry a new code without widening the sealed enum, and the argument for doing so is exactly the one that applies here. |
| `errNoBatch` is raised **inside** the batch read | `cmd/api/read.go:352`, inside `readBatchAccounts`, reached from `read.go:321` | Anything acquired before the batch read is held when that 503 is raised. It is the release path that matters, and it is the one an ordering that refuses 400s and 404s earlier can never exercise. |
| No `WriteTimeout` and no `ReadTimeout` on the server | `cmd/api/main.go:605-613`: `ReadHeaderTimeout: 10s`, `IdleTimeout: 120s` only, deliberately so SSE is not severed | A 6 to 13 s synchronous response is not cut off, and nothing bounds how many such responses are in flight at once. Concurrency has to be bounded deliberately. |
| Rate limit 20 rps, burst 40, per IP | `cmd/api/main.go:79-80`, `middleware.go:392` | Cost-blind: it counts requests, not scenarios. |
| The 200 example is **captured, not written** | `cmd/api/p5_runbook_example_db_test.go`, `TestRunBookExampleIsAServedBody` (line 561), normalizing exactly the four fields in `runBookExampleServeTimeFields` (line 228) | The set-run example is subject to the same law. No number may be written into this spec or into the contract by hand. |
| No handler in `cmd/api` reads a request body today | grep for `r.Body` and `json.NewDecoder`: zero non-test hits | The set-run is the first. Body-size bound and `DisallowUnknownFields` are new discipline established here. |
| `readOnly` opens for exactly one POST path | `cmd/api/middleware.go:180-206`, `isRunBookPath` at `:198` | `/v1/scenarios/run-book-set` 405s until the gate is widened, by an **exact-match** second predicate. |
| Refuse-before-classify, identity joined by triple | `web/app/lab/matrixCells.ts`: `bookRefusal` (591), `definitionSkew` (550), `rowIdentity` (447), `servedIdentity` (460), `bookContradiction` (346), `resolveBatchCohort` (1439), `anchorBatchOfPhase` (1214) | Every per-scenario result must carry `scenario_id` and `scenario_version`, and the envelope must carry `scenario_config_version`, or `ScenarioIdentity` cannot be formed per row. |

---

## 2. Wire shape

### 2.1 Endpoint

```
POST /v1/scenarios/run-book-set
Content-Type: application/json
```

Three path segments, so no collision with `POST /v1/scenarios/{id}/run-book`
(four) or `GET /v1/scenarios` (two).

**Rejected alternative:** `/v1/scenarios/set/run-book`. It would satisfy the
existing `isRunBookPath`, but `set` matches `^[a-z0-9_]{1,64}$` and is therefore
a legal committed-scenario id. Reserving a word out of the id space is a trap
that fires the day someone commits a scenario called `set`.

### 2.2 Request: `SetRunRequest`

```json
{
  "scenario_ids": ["eth_minus_10", "eth_minus_30", "eth_minus_60",
                   "weeth_rate_minus_5", "btc_leg_minus_20"]
}
```

| Field | Type | Semantics |
|---|---|---|
| `scenario_ids` | `string[]`, required, `minItems: 1`, `maxItems: 24`, `uniqueItems: true`, each `^[a-z0-9_]{1,64}$` | The committed ids to evaluate against **one** resolved batch. There is no implicit "all": a request whose meaning changes when the committed set grows is a request the client cannot reason about, and a shared link built on it would silently mean something different tomorrow. The client has `GET /v1/scenarios`; it names what it wants. |

Decoding discipline, new to this package:

- `http.MaxBytesReader` at **8 KiB**. 24 ids of 64 characters plus JSON overhead
  is under 2 KiB.
- `json.Decoder` with **`DisallowUnknownFields`**. A client that sends
  `{"scenarios": [...]}` must be told the field name is wrong, not handed a 400
  about an empty set, because that 400 reads as "you asked for nothing", which
  is a different and false statement.
- A body that is not a JSON object, or absent entirely, is a 400 naming the
  required field.

`maxItems: 24` is a literal because a schema needs one. It sits above today's 15
with headroom and below `defaultRateBurst` 40 (see section 6).

### 2.3 Response: `RunBookSetResponse`

```
served_at                 date-time              the resolving snapshot's DATABASE clock
batch                     Batch                  ONE, shared. The batch every result was measured on.
evaluation                SetRunEvaluation       NEW. The freshness probe. Section 2.8.
scenario_config_version   string                 ONE, shared. The set's token.
requested_scenario_ids    string[]               echoed verbatim, in REQUEST order
results                   SetRunScenarioResult[] one per requested id, in REQUEST order
excluded_engines          EngineRefusal[]        ONE, shared. Withholding is a BATCH property.
coverage                  SetRunCoverage         NEW component. A census of the BATCH. Section 2.9.
notes                     string[]
```

**`batch` is the only batch.** It is `batchEnvelope(v)` unchanged: id,
`computed_at`, `age_seconds`, producer, status, counts, the full watermark vector
with per-engine sweep stamps, and `supersession`. It is what licenses every
liquidatable-family field beneath it under the contract sweep law, and it is what
the client pins the whole cohort to.

**`excluded_engines` is shared and appears once.** A withheld engine is withheld
on the batch, not on a scenario. Publishing it per scenario would invite a reader
to think one scenario was refused an engine another got. Per-result
`withheld_engines` carries **names only** (section 2.4), so the two arrays are
different types as well as different scopes and a generated client cannot conflate
them.

**`coverage` is a NEW component, `SetRunCoverage`, not the shared
`BookCoverage`.** The reason is not fastidiousness. `BookCoverage` is sealed
(`additionalProperties: false`) and its description binds `in_book` to "what
reached the derived arithmetic", which on the single-scenario route is
**run-scoped**: measured at batch 5759, `eth_minus_30` served `in_book: 9908` and
`btc_leg_minus_20` served `in_book: 9862`, because `coverage(v.Positions,
len(beforeInputs), refused)` passes the run's size. The set-run's census is
**book-scoped**. Keeping the same component would give one generated type two
meanings depending on which endpoint produced it, which is the defect this spec
is trying to remove rather than relocate. The new component carries the
book-scoped meaning in its **schema description**, not only in a served note.

### 2.4 `SetRunScenarioResult`

```
scenario_id            string    required. The identity triple, part 1.
scenario_version       string    required. The identity triple, part 2.
                                 (Part 3, scenario_config_version, is on the envelope.)
label                  string
path_assumption        string
shocks                 Shock[]   exact rationals, as everywhere. What was REQUESTED.

shock_reach            SetRunShockReach   required, never null. What ARRIVED.
                                 Whether the requested shock moved a mark at all,
                                 and what swallowed it if not. Section 2.5.

covered_engines        string[]  the committed definition's `engines`, echoed
withheld_engines       string[]  names only. The code and detail for each is in
                                 the shared excluded_engines.
unmeasurable_engines   SetRunEngineAbsence[]   covered, not withheld, and carrying
                                 no measurable position. Section 2.7.
engines                SetRunEngineSummary[]   one per covered engine that is neither
                                 withheld nor unmeasurable

positions_answered     integer   Sum of engines[].accounts. Positions that produced
                                 the numbers in this result.
positions_withheld     integer   reconstructable positions on covered-but-WITHHELD
                                 engines. They are in the batch and they are not in
                                 any number here.
note                   string
```

**`shocks` and `shock_reach` are two different statements and both are
required.** `shocks` is the committed definition's request: the exact rationals
this scenario asks the world to apply. `shock_reach` is what the engines' own
pricing transforms did with it. On this deployment those two routinely disagree
by design, and section 2.5 is the whole argument.

**The engine partition is published, in three parts.** The web currently
*derives* the hole (`isAllHoleBook` at `matrixCells.ts:212`, `bookHoleEngines` at
`:255`) by joining a served body against a listing it holds in the browser.
Publishing every part makes the partition checkable on the wire:

> `sort(engines[].engine ++ withheld_engines ++ unmeasurable_engines[].engine)
> == sort(covered_engines)`, and the three are pairwise disjoint.

An earlier revision had two parts and therefore no place to put a covered engine
with nothing to measure; it fell through into `engines[]` as a row of zeros.
Three parts is the smallest partition that has no such fall-through.

**`positions_in_run` is gone, replaced by two counts.** Revision 1 claimed
`positions_in_run == Σ engines[].accounts`. That is false whenever a covered
engine is withheld: `cmd/api/p5_runbook.go:425-440` admits a withheld engine's
reconstructable positions into the run, and only `:562-565` drops the engine's
row. The two counts state the same book without the false equality, and
`positions_answered + positions_withheld` is exactly the reconstructable
population of this scenario's covered engines, tied to the census by Invariant 4.

**`out_of_model` is deliberately absent.** It is about 1.2 KB per scenario and it
is already published, verbatim and versioned, on `GET /v1/scenarios`, which the
client necessarily already has, since that is where it got the ids. The identity
triple makes that join exact. A set-level note says so, and says that reading a
shocked number without it is reading it wrong.

`out_of_model` does **not** cover what `shock_reach` covers. It is prose about
what the model omits. `shock_reach` is arithmetic about what this batch's own
prices did under this scenario's own factors, and it is different on every batch.

### 2.5 `SetRunShockReach`, and the control that renders as three zero bars

This component exists because of a wrong reading this deployment can produce
today, from a scenario committed today.

`internal/risk/scenarios/stable_depeg_0995_in_band.json` shocks three OP stables
by 995/1000. Its `propagation` rows all carry `stable_snap: true`, its
description says "995000 lies STRICTLY INSIDE the snap band (990000, 1010000), so
PriceProviderV2 pins it back to exactly 1e6 and nothing moves", and its
`out_of_model` says "this scenario is the CONTROL: it must produce zero change on
every position". In a summary that carries only the three deltas it serves
`eligible_debt_delta_usd: "0"`, `bad_debt_delta_usd: "0"`,
`eligible_accounts_delta: 0`, `market_realization: null`, `projection: null`,
beside a real `before_eligible_debt_usd` and beside `shocks: [995/1000, ...]`.

Next to `stable_depeg_099_boundary` (0.99, band open, does **not** snap) drawing
a real bar, a reader concludes "the book is insensitive to a 0.5 percent depeg".
The truth is "the oracle pins any sub-1-percent depeg to par, so this scenario
tests the oracle and not the book". That is section 2.6's own law violated in
exactly the form it names: not an unknowable rendered as zero, but a known and
serious result rendered as zero.

Nothing else on this surface can carry the fact. `ScenarioDefinition`
(`api/openapi.yaml:2494-2497`) does not publish `propagation`, so `stable_snap`
reaches no client through `GET /v1/scenarios`. `AppliedShock`
(`api/openapi.yaml:2387-2391`) carries `snapped`, `base_snapped` and `cap_bound`,
and `cmd/api/p5_runbook.go:471-486` builds those rows per run out of the batch's
own before and after price values, so they are a property of **this batch under
this scenario** and are derivable from no listing. The same hole hits
`stable_depeg_098_unsnapped` (partly snapped legs) and any Aave cap adapter that
binds.

```
SetRunShockReach:
  declared_shocks     integer          len(definition.shocks). What was ASKED FOR.
  reach               enum             six arms, derived in the order below
  applied_shocks      AppliedShock[]   the existing sealed component, verbatim, over
                                       THIS scenario's own book. Empty in the first
                                       three arms.
  marks_moved         integer          applied_shocks rows whose `before` and `after`
                                       decimal strings DIFFER. The load-bearing count.
  marks_snapped       integer          rows with snapped == true
  marks_base_snapped  integer          rows with base_snapped == true
  marks_cap_bound     integer          rows with cap_bound == true
  held_flat_marks     integer          distinct held-flat marks over this scenario's book
  held_flat_assets    Address[]        the distinct assets behind them, sorted. Addresses
                                       only; the exact held values are on the
                                       single-scenario route.
  note                string           the arm's own sentence
```

`reach` is derived by a switch **in this order**, with no default arm, so it is
total:

| arm | condition | what it means |
|---|---|---|
| `projection_no_spot_pass` | `definition.projection != nil` | No `ApplyScenario` pass ran at all (`p5_runbook.go:462`, `:489-491`): the after side **is** the before side. `dm_rate_horizon_plus_200bps` declares a shock and lands here, so an empty `applied_shocks` here means "no pass", not "the shock reached nothing". |
| `no_shocks_declared` | `declared_shocks == 0` | The definition asks for no price move. `weeth_market_depeg_oracles_held` lands here; its information is in `market_realization`, which Invariant 9 makes mandatory. |
| `no_shock_reached_the_book` | the pass ran and `len(applied_shocks) == 0` | Shocks were asked for and no position in this scenario's book holds an asset any of them names. The book, not the oracle, is the reason. |
| `no_mark_moved` | `len(applied_shocks) > 0` and `marks_moved == 0` | Every shocked mark came back at the value it started at. **The control case.** The three deltas are zero because the pricing transform swallowed the move, not because the book is insensitive. |
| `some_marks_held` | `0 < marks_moved < len(applied_shocks)` | Partly reached. `stable_depeg_098_unsnapped` and any binding cap adapter land here. A bar drawn from this result is a bar over a partly applied shock, and the counts say how partly. |
| `every_mark_moved` | `marks_moved == len(applied_shocks) > 0` | The shock reached every mark it touched. An all-zero delta under **this** arm is a real finding about the book, and the note says so. |

Four rules that the counts must be read under, stated here because each is a
place a reader would otherwise invent an implication:

- **`snapped` does not imply `before == after`.** The snap pins the shocked value
  into the band; if the persisted price was already off par, the pinned value
  differs from it and the mark moved. `marks_snapped` and `marks_moved` are
  therefore independent counts and no partition is asserted between them.
  `marks_moved` alone answers "did a price change".
- **`marks_moved <= len(applied_shocks)`**, and each of `marks_snapped`,
  `marks_base_snapped`, `marks_cap_bound` is also `<= len(applied_shocks)`. Those
  three may overlap each other and are not summed.
- **`applied_shocks` is scoped to this scenario's own book** (covered,
  non-withheld engines, section 3.6), which is the same book its engine rows were
  measured over. When a covered engine is withheld, the set-run's applied set may
  be a strict subset of what the single-scenario route serves for the same
  scenario, because that route admits withheld engines' positions into the pass
  (`p5_runbook.go:425-440`). Test Law 2's applied-shock row is conditional on no
  covered engine being withheld, and Test Law 13 asserts the subset relation in
  the withheld fixture.
- **`held_flat_assets` carries addresses, not values.** The full held-flat rows
  with their exact marks are 2,287 B on a single body and are the single-scenario
  route's job. What the set needs is the count and the names, so a reader learns
  that eUSD was held flat and where to go for its value. Naming an absence with a
  pointer is disclosure; carrying 34 KB of marks a tornado never plots is not.

**Why not a `shock_did_not_reach` absence in the `SetRunEngineAbsence` manner.**
Considered and rejected. Shock reach is a property of the **scenario against the
batch**, not of an engine's measurability, and the engine rows in the
`no_mark_moved` arm are real: their `before_*` values are a true measurement of a
real book and must still be served. Suppressing the row would delete a true
number to hide a true zero. The honest shape keeps the row and publishes the
cause beside it, which is what `market_realization` and `projection` already do
for the other two structurally-zero classes.

### 2.6 `SetRunEngineSummary`, and why it is not "the three deltas"

The tornado needs three numbers per (scenario, engine): eligible-debt delta,
bad-debt delta, net eligible-accounts change. **Serving only those three is a
D-013 defect**, and this shape is defensible only because it does not.

```
engine                          string
usd_decimals                    integer   THIS engine's unit. Never a shared one.
movement_rule                   enum      hf_strictly_dropped | eligibility_flipped_false_to_true

accounts                        integer   measurable positions of this engine (before == after)
infinite_accounts               integer   of those, accounts with NO DEBT and therefore an
                                          unbounded health factor on the before side
movement_excluded_accounts      integer   of those, accounts runBookMovers could not TEST
                                          for movement at all. The movement count's
                                          denominator is accounts minus this.
refused_in_batch_positions      integer   covered-engine positions the BATCH refused
unrebuildable_positions         integer   covered-engine positions THIS LAYER could not rebuild

before_eligible_accounts        integer
after_eligible_accounts         integer
eligible_accounts_delta         integer   NET: after minus before. May be negative.
flipped_to_eligible             integer | null   DM only. Flips false to true ONLY.
hf_dropped_accounts             integer | null   Aave only. Health factors that STRICTLY dropped.

before_eligible_debt_usd        Decimal
eligible_debt_delta_usd         Decimal   DELTA-ONLY. May be negative.
before_bad_debt_usd             Decimal
bad_debt_delta_usd              Decimal   DELTA-ONLY. May be negative.

before_collateral_at_risk_usd   Decimal
after_collateral_at_risk_usd    Decimal   two SIDES, never a delta. See below.

total_debt_usd_before           Decimal   the sanctioned denominator
total_debt_usd_after            Decimal   Aave debt is PRICED and moves under a shock
total_collateral_usd_before     Decimal
total_collateral_usd_after      Decimal

market_realization              Shortfall | null    MANDATORY when the scenario has one
projection                      Projection | null   MANDATORY when the scenario has one
note                            string    engine-specific clauses only
```

Eight design points, each closing a specific wrong reading.

- **The movement count is split, because the engines count different things.**
  `runBookMovers` (`cmd/api/p5_runbook.go:755-833`) counts eligibility flips
  false-to-true on the Debt Manager and accounts whose health factor **strictly
  dropped** on Aave, with no eligibility test in the Aave branch at all.
  `movers_total` is `len()` of whichever list. Revision 1 collapsed both into one
  field called `flipped_to_eligible` with a universal note reading "counts flips
  false to true ONLY". On Aave that publishes a count of health-factor drops
  under a label asserting that accounts entered liquidation eligibility, which is
  a wrong number in the plainest sense. This is the house rule already applied to
  `hf_before_wad` against `hf_before_num`/`hf_before_den` on `RunBookMover`
  (`api/openapi.yaml:3870-3900`): serve both fields, and null the one the engine
  does not speak. `movement_rule` is the discriminator, served as an enum rather
  than left to prose, so a renderer picks its sentence from the wire instead of
  parsing a note. It mirrors `moversSubject`'s own discriminator in
  `web/app/lab/labRunBookLines.ts:142-159`.

- **The movement count's denominator is on the wire, because on Aave it is not
  `accounts`.** `cmd/api/p5_runbook.go:779-783` skips an account entirely when
  `b.infinite || a.infinite || b.hfWad == nil || a.hfWad == nil`, and
  `p5_runbook.go:772-775` skips any before-side account missing from the after
  side, on both engines. So `hf_dropped_accounts` counts only accounts carrying a
  finite health factor on **both** sides. `hf_dropped_accounts: 0` beside
  `accounts: 46` reads as "none of 46 health factors dropped" when the truth can
  be "most of the 46 have no health factor at all", and this book's Aave side is
  46 positions of residual dust where that is a live possibility.
  `movement_excluded_accounts` is exactly the population those two guards skip,
  and `infinite_accounts` is `m.infinite` (`p5_runbook.go:266-267`), the count
  today published only as `hf_histogram.infinite_count` (`:304`), which this
  summary does not carry. The code already insists the exclusion be named:
  `runBookMoversNote` (`:843-845`) serves "An account with no debt has an
  unbounded health factor on either side, so it has no drop to rank and is not
  counted here, it is not a quiet zero." A summary that keeps the count and drops
  the sentence recreates the quiet zero the sentence exists to prevent. Both the
  number and the clause are mandated, because a note is not checkable and a bare
  count is not readable.

- **`before_*` beside every delta.** `bad_debt_delta_usd: "0"` is read as "this
  scenario adds no bad debt", which is true. It is also read as "there is no bad
  debt", which is false whenever `before_bad_debt_usd` is nonzero. A delta
  without its base is a number read wrong.

- **`total_debt_usd_before` and `total_debt_usd_after`, both sides.**
  `measureRunBook` accumulates Aave debt as `h.TotalDebtBase`
  (`p5_runbook.go:663`), and `internal/risk/aave.go:182` computes `rv.DebtBase =
  MulDivCeil(rv.LiveDebt, p.Value, den)`. The debt is priced, so on Aave it moves
  under a price shock exactly as collateral does. Revision 1 served one
  `total_debt_usd` labelled "the DENOMINATOR" and then computed a share against
  it, so the reading divided an after-minus-before numerator by a denominator
  whose side was unstated, over two different books. DM's `Borrowings` is
  shock-invariant (`internal/risk/dm.go:104`), which is precisely why a DM-only
  test would not have caught it. **The sanctioned denominator is
  `total_debt_usd_before`**, and the engine note says so in one clause: the share
  a reader may legitimately compute is `eligible_debt_delta_usd` over
  `total_debt_usd_before`, the scenario's contribution as a fraction of the book
  as it stands. A ratio against the after side is a different question and this
  surface does not ask it.

- **`flipped_to_eligible` / `hf_dropped_accounts` beside
  `eligible_accounts_delta`.** The net is what the tornado plots, and the net is
  also what hides churn: five accounts flipping in and five flipping out is a net
  of 0 and is not "nothing happened". This is the distinction
  `RunBookEngine.movers_total`'s own contract note already draws against
  `newly_eligible_accounts` (`api/openapi.yaml:3963-3970`). The summary must not
  lose it.

- **`market_realization` and `projection` are mandatory, not decoration.**
  `weeth_market_depeg_oracles_held` moves no oracle mark by construction: its
  three deltas are all `"0"`, and its entire information content is
  `execution_shortfall_usd` and `bad_debt_at_liquidation_usd`.
  `dm_rate_horizon_plus_200bps` is a projection, whose after side *is* its before
  side (`p5_runbook.go:489-491`). A summary that dropped these would render both
  as three zero-length bars, and a reader would conclude they are harmless. That
  is the "an unknowable never renders as zero" law violated in its most expensive
  form: not an unknowable rendered as zero, but a known and serious result
  rendered as zero. Section 2.5 is the same argument for the two structurally
  zero classes those two fields do **not** cover: a shock the oracle swallowed,
  and a mark held flat.

- **`before_collateral_at_risk_usd` and `after_collateral_at_risk_usd` are served
  as two sides, never as a delta.** `WaterfallSeries`'s own doc comment
  (`internal/risk/waterfall.go:127-133`) states that collateral-at-risk carries
  **no monotonicity invariant**: it legitimately falls when already-crossed
  accounts are worth less. A delta on that axis is not a ranking key and must not
  be offered as one.

- **The two refusal counters are split.** `refusedByEngine`
  (`cmd/api/p5_runbook.go:424-430`) increments for every covered-engine position
  with `p.input == nil`, and `reconstructAll` (`cmd/api/read.go:692-707`) skips
  non-`Computed` rows without setting `reconstructionErr`. A batch-refused row
  therefore has `input == nil` and no reconstruction error, so today's single
  `refused_positions` is the two classes added together under a label naming only
  the second, while `coverage()` keeps them strictly apart as separate cells.
  Two counters, and Invariant 4 ties their sums to the census so the two
  attributions cannot drift.

The per-engine `note` carries **only engine-specific clauses**, and there are
exactly five: this engine's decimals; its `movement_rule` sentence; the
**excluded population** of that movement count, in the vocabulary
`runBookMoversNote` already uses; the sanctioned denominator; and the
collateral-at-risk warning. The invariant prose that is identical on every row
lives once in the envelope's `notes[]`. Revision 1 repeated a roughly 590 byte
note on every engine of every result, which is about 17 KB of identical text in a
15-scenario response and is also how a reader learns to stop reading notes.

### 2.7 `SetRunEngineAbsence`

```
engine   string
reason   enum   no_positions_in_batch
                | all_positions_refused_in_batch
                | all_positions_unrebuildable
                | mixed_no_measurable_positions
counts   { positions_in_batch, refused_in_batch, unrebuildable }  all integers
note     string
```

This component exists because of a legal state the current handler renders as
zeros. `measureRunBook` returns before the Waterfall when the book is empty
(`p5_runbook.go:720`), and every engine with no measure falls through
`if eb == nil { eb = newRunMeasure() }` (`p5_runbook.go:570-576`) to all zeros.
`reconstructAll` skips non-`Computed` rows without recording a reconstruction
error, so a batch whose positions are all refused yields
`excluded_by_this_layer: 0`, no withheld engine, `stress_coverage_is_full: true`
and `in_book: 0`. `cmd/api/read.go:398-406` confirms zero positions is a legal
state. The result on the single-scenario route today is an engine row where every
`before_*`, every delta and the denominator all read `"0"`, under a census
claiming full coverage.

On a tornado that becomes 15 scenarios of zero-length bars beside a green census,
and `total_debt_usd_before: "0"` is a denominator the D-013 argument above makes
load-bearing. **An engine with `accounts == 0` gets no numeric row.** It is named
here, with the reason and the counts behind the reason, and it draws no bar.

`SetRunCoverage.book_is_measurable` (section 2.9) is false when `in_book == 0`,
for the same reason.

This is the **absence** class: nothing to measure. Section 2.5 is the **reach**
class: something was measured and the shock did not move it. They are different
facts, they are served in different places, and neither is a zero.

### 2.8 `SetRunEvaluation`

```
resolved_at                 date-time    == served_at. The snapshot instant the batch
                                         was resolved at, before any arithmetic.
probed_at                   date-time    the DATABASE clock read AFTER the arithmetic,
                                         in the same statement as the probe.
scenarios_evaluated         integer      == len(results)
freshness                   enum         still_newest | superseded | newest_is_older
                                         | none_servable
newest_servable_batch_id    int64 | null null exactly when freshness == none_servable
note                        string
```

**There is no `batch_id` field here, and that is a correction, not an
omission.** `cmd/api/contract_sweep_law_test.go:101` defines the re-clock
vocabulary as exactly `{batch_id, computed_at, bucket_start}`. A block requiring
`batch_id` **is** a re-clock by the contract's own law, so revision 1's
`evaluation.batch_id` violated the very invariant it was written under. It is
also unnecessary: `batch.id` is one field away on the same object.

Revision 1 further claimed the existing sweep enforces this structurally. It does
not, in general. `sweepWalk` (`contract_sweep_law_test.go:288-360`) records a
violation only where a **liquidatable-family** property is met while unlicensed.
`SetRunEvaluation` has no liquidatable descendant, so a re-clock there would have
been greened silently. The claim is true only for the results subtree, where
`Projection.becomes_liquidatable` (`api/openapi.yaml:2440`) sits beneath
`engines[]`: a per-scenario or per-engine `batch_id` would void the envelope's
license and fail the existing sweep. Invariant 1 and Test Law 11 below are scoped
to say exactly that and no more.

`newest_servable_batch_id` is not in the re-clock vocabulary and is not a clock
for anything in this block: the block carries no measurement, only a statement
about which batch was newest at `probed_at`.

**`freshness` is an enum with four arms, and the fourth exists because the
derivation is over an ordered id.** The store's own comment says
`BatchStillNewestServable` "false with a nil error means either a newer servable
batch exists or none does" (`internal/store/p5_positions_page.go:476-480`). Those
are different facts and a reader needs different sentences for them. That
observation gives three arms. The fourth is forced by arithmetic: the probe
returns an id, and an id compared against `batch.id` has **four** outcomes, not
three. `null`, equal, greater, and **less**.

An earlier derivation read "`none_servable` when null, `still_newest` when it
equals `batch.id`, `superseded` otherwise", which routes a lesser id into
`superseded` and then mandates the sentence "Batch M has since materialized"
about a batch **older** than the one measured. That body would fail Test Law 8's
own assertion that `newest_servable_batch_id` is strictly greater exactly for
`superseded`: a specified derivation producing a body its own law rejects.

Is the lesser-id state reachable? Retention prunes oldest first
(`internal/store/risk.go:1416-1419`, `ORDER BY id DESC OFFSET $1`), so pruning
alone cannot leave an older batch servable while the measured one is not. But
`riskBatchCompleteConjuncts` (`internal/store/risk.go:1583`) is not a frozen flag:
it re-counts child rows and re-checks the required stamp set at **probe time**, so
a batch that was complete at resolution is not guaranteed to be complete two
seconds later. **This spec does not claim the state is unreachable.** It names it,
derives it totally, gives it its own sentence, and tests it. A derivation with an
`otherwise` arm that silently absorbs an unconsidered case is how a wrong sentence
gets served with full confidence; a fourth arm costs one enum value and one
sentence. Section 5 gives one sentence per arm.

### 2.9 `SetRunCoverage` and `SetRunEngineCensus`

```
SetRunCoverage:
  batch_positions        integer   every position row the batch carries
  in_book                integer   positions THIS LAYER rebuilt, over the WHOLE batch,
                                   whatever any scenario's model reaches
  refused_in_batch       integer   positions the BATCH refused
  excluded_by_this_layer integer   positions this layer could not rebuild
  excluded               Excluded[]  reuses the existing sealed component, unchanged
  book_is_measurable     boolean   false when in_book == 0, or any position is excluded,
                                   or any engine is withheld
  engines                SetRunEngineCensus[]   one row per engine present in the batch
  note                   string

SetRunEngineCensus:
  engine                 string
  positions_in_batch     integer
  measurable             integer   rebuilt, so available to the arithmetic
  refused_in_batch       integer
  unrebuildable          integer
  withheld               boolean   this engine's whole book is refused on this batch
```

Two properties follow, and both are asserted rather than asserted-about:

- Σ over `engines[]` of each of `positions_in_batch`, `measurable`,
  `refused_in_batch`, `unrebuildable` equals the corresponding set-level field
  (`batch_positions`, `in_book`, `refused_in_batch`, `excluded_by_this_layer`).
- `batch_positions == in_book + refused_in_batch + excluded_by_this_layer`,
  exactly, because the position status vocabulary is closed to
  `{computed, refused}` (`internal/store/risk.go:1563-1568`) and
  `reconstructAll` records a reconstruction error for every computed row it fails
  on. There is no third way for a position to be absent from the book.

Note that this partition does **not** hold on the existing single-scenario route,
where `in_book` is `len(beforeInputs)` and positions on engines the scenario does
not cover are in none of the three cells. That is a second reason the component is
new rather than reused.

`book_is_measurable` deliberately does not reuse the name
`stress_coverage_is_full`, whose computation (`cmd/api/handlers.go:714`) does not
consider `in_book == 0` and would read green over an unmeasurable book.

---

## 3. Endpoint behavior

1. **Method gate.** `readOnly` gains a second exact-match predicate,
   `isRunBookSetPath(p) { return p == "/v1/scenarios/run-book-set" }`. Exact
   match, not a prefix family, carrying forward the existing comment's discipline
   that "the gate opens for exactly the one computed route, not for a path
   family". The 405 message is widened to name both POSTs.

2. **Request validation, all of it, before any compute.** Decode, then shape,
   then membership. See section 4. Every refusal in this step happens before the
   in-flight slot is acquired and before the second token charge, so a malformed
   or unknown-id request can neither hold a slot nor cost N tokens.

3. **The remaining rate-limit charge.** After validation and before any read, the
   handler charges `len(scenario_ids) - 1` further tokens. Section 6.3 names why
   the charge is split and where each half is paid.

4. **Acquire the in-flight slot, then read.** The slot is acquired here, after
   the charge and **before** `s.readBatch`, and released by a `defer` that runs on
   every exit path including panics. Section 6.2 gives the bound, the refusal and
   the release law. The ordering matters for exactly one reason: `errNoBatch` is
   raised **inside** `readBatchAccounts` (`cmd/api/read.go:352`), so the 503 for
   "no complete servable batch" is raised while the slot is held. That is the
   leak path, and it is the one a release law must name.

5. **One resolution.** `s.readBatch(ctx, nil)` exactly as today: one
   `BeginRiskSnapshot`, one `SELECT now()`, `NewestCompleteBatchQ` inside it, all
   child rows, `reconstructAll` after the snapshot releases. `served_at = v.Now`.
   This happens once for the whole request.

6. **One before measure, union-scoped.** `measureRunBook` is called once, over
   the reconstructable positions whose engine is in
   `⋃ sc.Engines` over the **requested** scenarios, minus withheld engines. The
   result is sliced per engine for each scenario, which is sound because
   `risk.Waterfall` accumulates only through `engineOf(m.engine, ...)` and
   `measureRunBook`'s walk is per position.

   Revision 1 measured the whole book. That is a real defect and not a
   simplification: `measureRunBook` returns on the first
   `ComputeAaveHealth`/`ComputeDMHealth` error (`p5_runbook.go:656-698`) and
   `risk.Waterfall` returns on the first `ApplyScenario`/`measurePosition` error
   (`internal/risk/waterfall.go:226-239`), and section 4.1 Class 2 turns any of
   those into a 500 for the whole set. Measuring the whole book therefore lets a
   defective position on an engine **no requested scenario covers** refuse a
   set-run that N single runs would each have served.

   `refusedInBatchByEngine` and `unrebuildableByEngine` are computed over the same
   union, from `p.Status == store.RiskPositionRefused` and
   `p.reconstructionErr != ""` respectively, which is what makes the two counters
   of section 2.6 separable.

7. **Per scenario, in request order, over that scenario's own book.** Take the
   covered, non-withheld engines; filter the union book to them; that filtered
   book is **this scenario's book** and everything below is scoped to it:
   `risk.ApplyScenario` per position (skipped entirely for a projection scenario,
   whose after side *is* its before side); one after `measureRunBook`, whose
   internal `risk.Waterfall` (`p5_runbook.go:723`) therefore walks this
   scenario's book and not the union; `risk.ExecutionShortfall` if the scenario
   declares market realizations; `runBookProjection` if it declares a projection.
   The applied-shock and held-flat sets of section 2.5 are accumulated over the
   same pass, from the same `shocked.Scenario.Applied` and
   `shocked.Scenario.HeldFlat` rows the single route already collects
   (`p5_runbook.go:471-486`), deduplicated by the same keys. Reduce to the
   summary. Engines with `accounts == 0` become `unmeasurable_engines` entries
   instead of rows.

   **The per-scenario scope is the scenario's own covered set, never the union.**
   This is the design, and section 6.1 prices it as such. A DM-only scenario in a
   mixed set walks the DM positions, not the union. Slicing the shared **before**
   measure by engine still gives that scenario exactly what a scenario-scoped
   before measure would give, because both are per-engine keyed.

8. **One freshness probe, one statement.** A new store method,

   ```
   NewestServableBatchAt(ctx) (id *int64, at time.Time, err error)
   ```

   issuing a single statement:

   ```sql
   SELECT (SELECT b.id FROM risk_batches b
            WHERE <riskBatchCompleteConjuncts>
            ORDER BY b.id DESC LIMIT 1), now()
   ```

   The scalar subquery yields NULL when nothing is servable, and `now()` is that
   same statement's clock, so the id and the instant cannot disagree.
   `freshness` is **derived** from the id by a total four-way comparison against
   `batch.id`: `none_servable` when null, `still_newest` when equal, `superseded`
   when greater, `newest_is_older` when less. There is no `otherwise` arm.

   Revision 1 specified `store.BatchStillNewestServable` plus "a `SELECT now()`",
   described as two cheap queries. That method returns only a bool
   (`internal/store/p5_positions_page.go:481-494`) and resolves `newest`
   internally, so filling `newest_servable_batch_id` needed a third, unsynchronized
   query. The shape could then serve `still_newest_servable: true` beside
   `newest_servable_batch_id: N+1` (a batch landing between probes), or `false`
   beside `newest_servable_batch_id: N` (the newer batch pruned between probes),
   inside the block that exists so the freshness statement reads on its own.
   `BatchStillNewestServable` is left untouched for its existing pagination caller.

9. **Determinism.** `results` is in **request order**, not sorted: the client
   asked in an order and gets its answer back in it, and the tornado's row order
   is the client's to choose. Within a result, `engines`,
   `unmeasurable_engines`, `withheld_engines` and `covered_engines` are sorted by
   engine name; `shock_reach.applied_shocks` is sorted by the same
   `appliedShockKey` the single route uses (`p5_runbook.go:537`) and
   `shock_reach.held_flat_assets` by address; `coverage.engines` likewise. Two
   set-runs with the same body against the same batch serve byte-identical
   responses modulo `served_at`, `evaluation.resolved_at`,
   `evaluation.probed_at` and the derived age fields.

10. **Writes nothing.** `TestAPIIssuesNoWritingSQL` already sweeps this package
    and covers the new file with no change.

---

## 4. Refusal semantics

### 4.1 The rule: all-or-nothing, both times, and no per-scenario refusal register

Every way a scenario can fail today falls into exactly one of two classes, and
neither belongs inside a 200.

**Class 1, a property of the REQUEST, knowable before any compute.** An id that
is not in the committed set; a duplicate id; an empty or over-cap array; an id
that fails the pattern. The client got its ids from `GET /v1/scenarios`; an id
this deployment does not know means the client's set and the deployment's set
have diverged. Serving 14 of 15 under a shared envelope while dropping one is the
silent-hole class the whole surface is built to refuse: the reader would see 14
bars and no statement that a 15th was asked for. **Refuse the whole request,
before any compute, naming every offending id.**

**Class 2, a SERVICE DEFECT.** Look at what the current handler calls these.
`ApplyScenario` refusing is "a defect in this layer, not a property of the data"
(`p5_runbook.go:465-470`); a `Waterfall` refusal, an `ExecutionShortfall` refusal
and an unparseable committed projection delta are all `codeInternal`
(`p5_runbook.go:451`, `:494`, `:504`, `:619`). Dressing one of those as a polite
per-scenario refusal inside a 200 would let a broken deployment serve 14 bars and
one apology, and the reader would take "this scenario is unavailable" for a
property of the scenario when the truth is that the service is broken. **Refuse
the whole request: 500.**

Because the shared measure is union-scoped and each after measure is
scenario-scoped (section 3.6, 3.7), Class 2 fires only on positions the request's
own scenarios reach. **The set refuses only if a member would have refused
alone.** The converse does not hold and section 3.6 says why; Invariant 5 states
the direction that is true and names the exception.

So: **no `scenario_refusals[]` array, and no partial 200.** In a 200,
`requested_scenario_ids` and `results[].scenario_id` are the same multiset, and
that is the strongest membership law available: one line to check, impossible to
satisfy while hiding a hole.

What does live inside the 200 is the class that is **not a failure**:

- an engine **not covered** by a scenario's definition: a property of the
  definition, absent from `covered_engines`, and named in the result's `note`;
- an engine **withheld on the batch**: in `withheld_engines` and in the shared
  `excluded_engines`, contributing no row and no zero;
- an engine **covered and not withheld but carrying nothing measurable**: in
  `unmeasurable_engines`, with the reason and the counts, and no zero row;
- a scenario **all of whose covered engines are withheld or unmeasurable**:
  `engines: []`. It is evaluated, it counts in `scenarios_evaluated`, and it draws
  no bar and says why. Not a zero bar;
- a scenario whose **shock did not reach a mark**: real engine rows with real
  `before_*` values, three zero deltas, and `shock_reach` naming what swallowed
  the move. Disclosed, not suppressed and not silently zero.

### 4.2 Server-side register (wire)

| Status | Code | When | Body |
|---|---|---|---|
| 400 | `bad_request` | body absent, not an object, over 8 KiB, or carrying an unknown field | `ErrorBody`, naming the field |
| 400 | `bad_request` | `scenario_ids` missing or empty | `ErrorBody`: "there is no implicit 'all': name the ids you want, from GET /v1/scenarios" |
| 400 | `bad_request` | duplicate ids | `ErrorBody` naming **every** repeated id. A set is a set; a repeat doubles the cost and breaks the membership law. |
| 400 | `bad_request` | more than 24 ids | `ErrorBody` naming the bound and the count received |
| 400 | `bad_request` | an id fails `^[a-z0-9_]{1,64}$` | `ErrorBody` naming **every** malformed id |
| 404 | `not_found` | one or more ids are not committed **here** | `ErrorBody` naming **every** unknown id, and stating that the whole set is refused rather than partly served |
| 429 | `rate_limited` | the N-token charge exceeded the bucket | `ErrorBody` plus `Retry-After`, message naming the per-scenario cost and the count asked for. The header is `res.DelayFrom(now)` and is meaningful: it is when this bucket refills. |
| 503 | `set_run_busy` | the in-flight set-run bound is full | **`SetRunBusyBody`**, its own type, naming the bound and the count in flight. **No `Retry-After`.** Section 6.2. |
| 503 | `unavailable` | no complete servable batch | `ErrorBody` plus `Retry-After`, the existing register unchanged |
| 500 | `internal` | any arithmetic refusal, anywhere in the set | `ErrorBody`. **No partial body.** |

```
SetRunBusyBody:
  error:
    code           enum [set_run_busy]
    message        string
    max_in_flight  integer   this deployment's bound, the same number /v1/meta publishes
    in_flight      integer   how many were running when this request was refused
```

**The `ErrorBody.code` enum is untouched.** `set_run_busy` lives on its own body
type with its own single-value enum, which is exactly the `BatchSupersededBody`
precedent (`api/openapi.yaml:3076-3103`) and its stated reason: "Its own shape
rather than `ErrorBody` because it must NAME both batches: a client told only
'conflict' cannot distinguish a stale cursor from its own bug." A client told
only "503" cannot distinguish an overloaded evaluator from an empty book, and
that is the same defect.

**Why 503 and not 429, reversing revision 1.** Revision 1 refused the
concurrency overflow with 429 plus `Retry-After` and argued that "429 is a
statement about this client's admission" which "`unansweredReason` already renders
honestly", with "no client mapping change". Both halves are false against the
code.

- `web/lib/runbook.ts:158-162` returns `{kind: "rate-limited", retryAfterSeconds}`
  and **discards** `envelope.message`. `web/app/lab/matrixCells.ts:2149-2152`
  renders exactly "rate limited (429), and the service says retry after Ns". A
  client that has sent one request in ten minutes and is refused because another
  operator holds one of two slots is told it exceeded a rate it did not exceed.
  The distinguishing message revision 1 relied on is never read. Revision 1
  rejected 503 because `runbook.ts:149-157` maps it to `{kind: "no-batch"}` and
  renders "a flatly false statement about the book"; the same test applied to 429
  gives a false statement about the client, and the client is not a less important
  subject than the book.
- The `Retry-After` was invented. `ipLimiter.allow` derives it from
  `res.DelayFrom(now)` (`cmd/api/middleware.go:369-374`), which is the instant a
  **token bucket** refills. A semaphore has no such instant: the holder may have
  twelve more seconds of arithmetic left and the refusing goroutine does not know
  it. **So there is no `Retry-After` on this refusal**, and the message says why
  in one clause: "nothing here computes when a slot frees, so no retry instant is
  offered rather than one invented." That is the same discipline as
  `newest_servable_batch_id` being null rather than 0.

503 is the register whose plain meaning is "the server is temporarily unable to
handle the request because it is overloaded", which is precisely true. The
ambiguity with `errNoBatch` is removed structurally, by the code on the body,
not by prose. Test Law 19 asserts a client reads the code before the status.

### 4.3 Client-side register additions (`web/app/lab/`, `web/lib/`)

Following R12's precedent exactly: **validate the body against itself before
classifying anything.**

The set-run gets its own fetch module, `web/lib/runbookSet.ts`, with its own
`SetRunOutcome` union. It is not a widening of `RunBookOutcome`
(`web/lib/runbook.ts:49-55`), whose `ok` arm is typed to `LabRunBook` and cannot
carry a set body, and whose 429 arm is the one that erases messages. **Dispatch
is code-first, status-second:** read the error envelope, switch on
`error.code`, and use the status only when no envelope parses.

| Register | Trigger | Consequence |
|---|---|---|
| **`SERVICE BUSY`** (new outcome arm, `{kind: "busy", message, maxInFlight, inFlight}`) | 503 with `error.code === "set_run_busy"` | "This deployment evaluates at most K set-runs at once and K are running. Nothing here computes when a slot frees, so no retry time is offered." No cell state, no pin movement, no cohort change: it is a statement about the service's capacity and about nothing in the book. Distinct from `no-batch` (503 with `code: "unavailable"`) and from `rate-limited` (429). |
| **`CONTRADICTORY SET`** | a `scenario_id` appears twice in `results[]`; a result's id was not in `requested_scenario_ids`; a requested id has no result; `scenarios_evaluated` disagrees with `len(results)` | The body answers the set two ways, or fails to answer it. No cell, no pin, no cohort, no anchor movement, for every row the set covers. Refused whole, like `bookContradiction` (`matrixCells.ts:346`), and deliberately not borrowing that register's sentence: "a book named nobody" is a false account of a set that named somebody twice. |
| **`CONTRADICTORY BOOK`** (existing, applied per result) | the three engine arrays are not a partition of `covered_engines`, or an engine repeats within any of them | R12's rule at result granularity. One result contradicting itself refuses **that result only**: it is a statement about one scenario's answer, not about the set's membership. |
| **`COVERAGE SKEW`** (new) | a result's served `covered_engines` disagrees with the listing's `engines` for that id **while the identity triple agrees** | A contract violation: the definition changed without its `version` moving. Not silently reconciled in either direction. Row refused, named. Test Law 12 is the server-side law that makes this unreachable in a correct deployment. |
| **`DEFINITION CHANGED`** (existing) | the identity triple on a result disagrees with the listing | Unchanged. `servedIdentity` reads `scenario_id` and `scenario_version` off the result and `scenario_config_version` off the envelope. |
| **`SHOCK DID NOT REACH`** (new, per result) | `shock_reach.reach` is `no_mark_moved` or `no_shock_reached_the_book` | **No bar, on any engine of that result.** The cell states which: "every shocked mark came back at the value it started at (K of K snapped)", or "no position in this book holds an asset this scenario names". The `before_*` numbers still render, because they are a true measurement. This is the register that keeps `stable_depeg_0995_in_band` from reading as a flat book. |
| **`PARTLY REACHED`** (new, per result) | `shock_reach.reach === "some_marks_held"` | Bars draw, and the cell carries `marks_moved` of `applied_shocks.length` with the snapped and cap-bound counts. A bar over a partly applied shock is a real bar with a stated qualification, never an unqualified one. |
| **`PROJECTION, NO SPOT PASS`** (new, per result) | `shock_reach.reach === "projection_no_spot_pass"` | The three delta bars are never drawn for this row. The `projection` block is the cell. Its declared `shocks` are shown as declared and explicitly not applied. |
| **`NO DENOMINATOR`** (new, per engine cell) | `total_debt_usd_before === "0"` on an answered engine | No bar. The cell states that the engine's book carries no debt to take a share of. Section 9.4 is the axis law this belongs to. |
| **Movement-denominator disclosure**, not a cell state | `movement_excluded_accounts > 0` on an answered engine | The movement count renders as "K of M accounts", where M is `accounts - movement_excluded_accounts`, never as "K of `accounts`". On Aave a bare "0 of 46" is the wrong number the excluded population exists to prevent. |
| Header disclosure, not a cell state | `evaluation.freshness !== "still_newest"` | Every cell in the set is equally affected; a per-cell state would repeat one fact thirty times. One header clause per arm, section 5. |

---

## 5. Freshness and supersession mid-run

The batch is resolved once, at the start, inside a snapshot. Over the 6 to 13 s
of arithmetic a newer batch will often land: at the observed cadence of roughly
one per 50 s, more often than not for a large set.

**Nothing is torn, and that is provable rather than hoped.** `readBatchAccounts`
resolves the batch and reads every child row inside one `BeginRiskSnapshot`
(wave H8, `cmd/api/read.go:321-436`), so a materialization landing afterward is
invisible to every row already in memory. The arithmetic runs on that in-memory
book. The result is internally consistent: every scenario measured the same
positions of the same batch at the same instant. Cross-scenario comparison is
exactly as valid as it would have been had nothing landed.

**What the envelope must disclose, and what it must not claim.**

- `batch.supersession` **does not answer this question**. It is the design spec
  section 4 reorg posture (acked epoch moved, last block rewound, unacked epoch
  recorded, cursor absent), evaluated against a live read of the cursor and epoch
  tables inside the resolving snapshot. It is about rewinds, not about a newer
  materialization. Its own note already says a superseded batch is still served.

- `evaluation.freshness` is the new fact, and it is a **disclosure about the
  instant the response was composed**, never a promise about now. It has four
  arms and each gets its own sentence. Revision 1 had one boolean and one
  mandated sentence, which asserted a materialization that had not happened
  whenever the true state was anything but the second arm.

  | `freshness` | `newest_servable_batch_id` | The sentence, and the header clause |
  |---|---|---|
  | `still_newest` | `== batch.id` | "Batch N was still the newest complete servable batch at `probed_at`. That is what was true when this response was built, never a promise about the reader's present." Header: the batch id alone. |
  | `superseded` | a newer id, `> batch.id` | "Every scenario here was evaluated against batch N, resolved once at `resolved_at`. The comparison across scenarios is therefore exact and cross-scenario reading is sound. Batch M has since materialized: these numbers describe batch N and not the current head of the book." Header: both ids, plus a re-run affordance for the whole set. |
  | `newest_is_older` | an older id, `< batch.id` | "Every scenario here was evaluated against batch N, resolved once at `resolved_at`, when N satisfied the completeness predicate. At `probed_at` the newest batch satisfying that predicate was P, which is OLDER than N: batch N no longer satisfies it. These numbers are a real measurement of batch N taken while it was servable, and a re-run now would answer on batch P, an older book." Header: both ids, the word OLDER, and a re-run affordance carrying that warning. |
  | `none_servable` | `null` | "At `probed_at` NO batch satisfied the completeness predicate, batch N included. These numbers are a real measurement of batch N, taken when it was servable. Nothing newer has replaced it: there is currently nothing to replace it with." Header: names the state, and the re-run affordance is disabled with that reason, because a re-run would 503. |

- The `newest_is_older` arm is not expected in a healthy deployment and this spec
  does not claim it is reachable. It exists because the derivation compares two
  ordered ids and must be total, and because the alternative was an `otherwise`
  arm serving "Batch M has since materialized" about a batch that predates the
  measurement. Test Law 8 exercises it through the store seam rather than
  asserting it away.

- No arm is a refusal, a degradation, or a reason to withhold anything. The
  numbers describe batch N. They are a real measurement of a real book.

- `newest_servable_batch_id` is **null exactly in the `none_servable` arm**, never
  0 and never `batch.id` in that arm: the same shape and the same reason as
  `BatchSupersededBody.current_batch_id`.

**A superseded batch is never re-resolved mid-flight and the result is never
discarded.** Discarding and retrying would make the endpoint's latency unbounded
under load and would throw away a correct measurement because the world moved,
which is what the whole surface refuses to do elsewhere (R8: "a run that could
not answer says nothing about the answer already held").

---

## 6. Latency, concurrency, rate limiting, payload

### 6.1 Budget

All measurements below were taken on this machine against a local deployment
(local Postgres, `riskd` materializing concurrently), batch 5748 to 5759, 9,909
positions, 9,863 `debt_manager` and 46 `aave_v3_etherfi`, 1 refused. A noisy box,
so brackets rather than points. Figures marked **derived** are arithmetic over
those measurements, not measurements.

| Term | Cost | Paid |
|---|---|---|
| `readBatch` plus `reconstructAll` over 9,909 positions | 1.0 to 1.3 s (derived: `/v1/meta`'s floor against run-book's floor, the two sharing exactly this term) | **once** |
| shared BEFORE measure over the UNION book (health walk plus one identity `Waterfall`) | 0.05 to 0.20 s (derived) | **once** |
| per scenario, over **that scenario's own covered book**: `ApplyScenario` pass, then a full AFTER `measureRunBook`, which is itself a health walk **plus a `Waterfall` over the same scenario-scoped book**, plus optional shortfall or projection | 0.30 to 0.50 s (derived) | **times N** |
| freshness probe (one statement) | under 10 ms | once |
| serialization | under 40 ms | once |

**The per-scenario term is scenario-scoped, and it is not small.** Section 3.7
filters the union book to each scenario's covered, non-withheld engines and does
the pass and the after measure over that. So the per-scenario cost is proportional
to the **scenario's own** covered subset, not to the union.

**At this book's shape that distinction is worth under half a percent, and the
budget below is therefore shape-specific.** The reconstructable book is 9,908
positions: 9,862 `debt_manager` and 46 `aave_v3_etherfi`. A DM-only scenario
(`btc_leg_minus_20`, `dm_composition_census`, the three stable-depeg scenarios,
`ethfi_minus_50`) walks 9,862; a both-engines scenario walks 9,908. That is
99.54 percent of the union in the worst case, so the 0.30 to 0.50 s bracket and
everything derived from it stands whether the scope is the union or the
scenario's own book. **On a book with a balanced engine mix it would not**, and
the budget must then be re-derived rather than carried across: an engine-mix
change is a budget change. Revision 1 and an earlier pass of this document priced
the per-scenario term over the union while specifying a scenario-scoped pass, two
different designs under one set of numbers; the numbers happen to survive here
only because Aave is 0.46 percent of this book.

**N = 15: 1.2 + 0.15 + 15 x 0.40, about 7.4 s.** Budget it as **6 to 11 s p50,
15 s p95** on a loaded box. **At the cap, N = 24: 1.2 + 0.15 + 24 x 0.50, about
13.4 s.**

Compared with N sequential single-scenario POSTs at a measured median of 1.45 s:
15 x 1.45, about 22 s, measured directly at 20.58 s wall for a sweep of the
deployed set, and with a coin-flip chance of straddling a batch. The set-run is
roughly 2 to 3 times faster and it is atomic. Revision 1 claimed 3 to 4 times;
that followed from an understated per-scenario term.

### 6.2 A cap, and a concurrency bound

**No async pattern.** There is no job queue in this product, and inventing one to
serve a 7 second computation would be new durable state on a service whose entire
posture is that it writes nothing (`TestAPIIssuesNoWritingSQL`, the SELECT-only
role in production). A job queue means a job table, a job id, a poll endpoint, a
retention policy for job results, and a new class of "your job expired" refusal,
all to save a few seconds of an already explicit, user-initiated action. The
server sets no `WriteTimeout` (`cmd/api/main.go:605-613`, deliberate, for SSE),
so a 13 second response is not severed.

**`maxItems: 24` bounds ONE request.** It bounds that request's worst-case
latency and its memory: the shared before measure holds a `states` map and
per-asset collateral maps for the union book for the life of the request, once
rather than N times, while each after measure is transient.

**A separate bound is required for the deployment.** With no `ReadTimeout` and no
`WriteTimeout`, and a token charge of 24 against 20 rps, one address sustains
roughly 0.8 set-runs per second against a 7 to 13 s service time: five to ten
concurrent set-runs in steady state, each holding a reconstructed
9.9k-position book with legs and price inputs, each arrival lengthening the rest.
That is a memory and CPU bound the per-request cap does not touch.

**Ship a non-blocking in-flight bound.** `SOLVENT_API_MAX_INFLIGHT_SET_RUNS`,
default **2**, published on `/v1/meta`'s `constants`. A request that cannot
acquire is refused **immediately**, not queued, so no connection is held waiting
and worst-case latency stays the single-request bound.

**Acquire and release, named precisely, because one path leaks and the obvious
one cannot.**

- The slot is acquired at step 3.4: **after** decode, shape validation, the
  membership check and the token charge, and **before** `s.readBatch`.
- It is released by a `defer` established immediately after a successful acquire,
  so it runs on every return and on a panic.
- **The 400, 404 and 429 paths refuse before the acquire and therefore can never
  hold a slot.** Asserting "the semaphore is released on the 404 path" is
  vacuous: nothing was acquired. What the test must assert on those paths is the
  **precondition**, that the in-flight gauge never rose, which is a different and
  checkable claim.
- **The path that matters is the 503 for no servable batch.** `errNoBatch` is
  raised inside `readBatchAccounts` (`cmd/api/read.go:352`, reached from
  `read.go:321`), which is after the acquire. A slot leaked there is leaked for
  the life of the process and the second leak takes the deployment to zero
  capacity permanently. It is named here, and Test Law 19 exercises it directly.
- The 500 path (any arithmetic refusal) is also after the acquire and is
  exercised too.

**The refusal is 503 with `SetRunBusyBody` and no `Retry-After`.** Section 4.2
gives the argument in full: 429 renders as a per-client rate limit the client did
not exceed, because `web/lib/runbook.ts:158-162` discards the message the
distinguishability depended on; a bare 503 is indistinguishable from an empty
book; the `Retry-After` a token bucket computes means nothing for a semaphore.
Its own body and its own code, in the `BatchSupersededBody` manner, gives the
client a structurally distinguishable arm. **The client mapping does change, and
that is the point rather than a cost:** the set-run's fetch module dispatches on
the envelope's code, and section 4.3 defines its `busy` arm.

### 6.3 Rate limiting: charge N tokens, and name where each is paid

The existing limiter (20 rps, burst 40, per IP, `x/time/rate`) counts
**requests**. A set-run is up to 24 times the cost of a normal request, so a
cost-blind limiter lets one client turn burst-40 into 960 scenario evaluations.

Revision 1 said "charge one token per scenario, `limiter.AllowN(now,
len(scenario_ids))`" and left the mechanism unnamed. There is no `AllowN` on
`ipLimiter`: `allow` (`cmd/api/middleware.go:343-377`) calls `lim.ReserveN(now,
1)` and is the whole API. And `rateLimit` (`middleware.go:392-408`) is middleware
keyed on the connection address that runs **before** the handler and cannot see a
body it has not buffered, while section 2.2 puts the decode discipline in the
handler.

**The mechanism, named:**

1. `ipLimiter` gains `allowN(key string, n int) (bool, time.Duration)`, the
   existing body with `ReserveN(now, n)`. `allow(key)` becomes `allowN(key, 1)`,
   so there is one implementation and the existing `!res.OK()` arm (burst smaller
   than the request cost) is inherited rather than duplicated.
2. The **middleware charge is unchanged**: every request, set-run included, pays
   1 token before reaching any handler. The middleware never reads a body.
3. The **handler charges the remainder**: after decode, shape and membership
   validation succeed, and before the in-flight acquire and the batch read, it
   calls `s.limiter.allowN(clientKey(r), len(scenario_ids)-1)`. Total charge is
   exactly `len(scenario_ids)`. For `n == 1` the handler charges nothing.
4. A refused handler charge writes the same 429 and `Retry-After` the middleware
   writes, from the same helper, so there is one 429 shape on this route. That
   header is `res.DelayFrom(now)` and it is honest here: a token bucket does
   compute when it refills.

Two consequences worth stating rather than discovering. A malformed or unknown-id
request costs **1 token**, not N, because it is refused before the second charge
and it did no compute. And a refused handler charge has already spent the
middleware's token; that is honest, since the request really did cost a decode
and a membership check.

The message names the cost so a reader is not puzzled by a first request being
refused:

> "rate limit exceeded: this surface admits 20 requests per second per client
> address, burst 40, and a set-run costs one token per scenario. This request
> asked for 15."

**Config invariant, checked at startup, fail fast:** `rate_burst >=
max_set_run_scenarios`. With defaults (40 >= 24) it holds. `ReserveN` returns
`!res.OK()` when `n > burst`, so an operator who lowers
`SOLVENT_API_RATE_BURST` below the cap makes a legal request permanently
unservable, and must be told at boot rather than discovering it in production.

`/v1/meta`'s `constants` block, which already publishes `rate_limit_requests_per_second`
and `rate_limit_burst` as "a POLICY OF THIS DEPLOYMENT" (`cmd/api/meta.go:357-373`,
`api/openapi.yaml:2898-2921`), gains three properties additively:
`max_set_run_scenarios`, `set_run_token_cost_per_scenario` and
`max_inflight_set_runs`. Policy discoverable rather than folklore, and
`max_inflight_set_runs` is the same number `SetRunBusyBody.max_in_flight` carries,
so a refused client and a curious one read one figure.

### 6.4 Payload: summary, not full bodies

**Measured**, at batch 5759:

| | bytes |
|---|---|
| one full `RunBookResponse` (`eth_minus_30`, 2 engines) | **40,226** |
| 12 full bodies | **350,604** |

Composition of the 40 KB body, measured: `collateral_by_asset` 14,496 B (both
sides, both engines, 19 DM assets each), `movers` 9,896 B, histograms 6,302 B,
`held_flat` 2,287 B, `out_of_model` 1,214 B, batch envelope 1,256 B,
`applied_shocks` 966 B, notes and prose about 2,000 B.

Of that list, exactly one item is a thing a tornado must carry:
**`applied_shocks`, 966 B**. It is the only wire carrier of `snapped`,
`base_snapped` and `cap_bound` (section 2.5), and without it a snapped control
and an insensitive book are the same three zero bars. `held_flat`'s 2,287 B is
carried as a count plus the distinct asset addresses, roughly 150 to 250 B,
because what the set needs is that a mark was held and which asset it was, not
the exact value of every mark. Everything else on the list is drill-down and
stays on the single-scenario route.

**Estimated**, and labelled as such because the shape does not exist yet:
`SetRunEngineSummary` carries 24 scalars, about 490 B, plus an engine-specific
note of about 230 B (five clauses, not four), so roughly 720 B per engine row. A
result adds identity, label, path assumption, shocks, three engine arrays and two
counts, about 500 B, plus `shock_reach` at about 400 B for a one-axis scenario
and up to about 1.2 KB for an eight-shock one. A two-engine one-axis result is
therefore about **2.3 KB** and a one-engine one-axis result about **1.6 KB**.
Fifteen mixed results plus the envelope (batch 1.3 KB, coverage with a per-engine
census, and the shared `notes[]`) is about **33 to 42 KB**.

That is up from the 25 to 31 KB an earlier pass estimated, and the increase is
`shock_reach`. It is the right trade: about 10 KB buys the difference between "a
0.5 percent depeg does nothing to this book" and "the oracle pinned it back to
par before it reached this book", which is the D-013 defect this whole document
exists to refuse.

Against 15 full bodies (about 440 KB, extrapolated from the two measurements) the
ratio is roughly **10 to 13 times**.

**Decision: summary only. No `detail: "full"` mode in 1.7.0.** Two response
shapes on one endpoint means two contract examples to capture, two schema sweeps
and two sets of test laws, and the field's existence invites a client to fetch
440 KB routinely. Drill-down is the single-scenario endpoint's job, and Open
Question 1 is what makes that drill-down comparable to the bar it came from.

---

## 7. The example, and why no numbers appear in this spec

**There is no worked numeric example in this document, deliberately.**

Revision 1 carried one, presented as "real: the projection of two bodies this
deployment actually served". It was not a body any server can serve. Its Aave row
read `flipped_to_eligible: 12` beside `before_eligible_accounts: 3`,
`after_eligible_accounts: 3` and `eligible_accounts_delta: 0`. Under that
document's own definition of the field (flips false to true only), a net of 0
with 12 flips in requires 12 flips out: twelve Aave accounts leaving liquidation
eligibility under a 30 percent ETH collateral shock, while the same row showed
collateral falling by 30 percent. Nothing in `measurePosition`
(`internal/risk/waterfall.go:321-349`, where Aave eligibility is
`h.Liquidatable()`, strictly below 1e18) produces that. The 12 was `movers_total`,
which on Aave is a count of health-factor drops, pasted under a label that says
something else. One mislabelled field produced an illustration that could not
exist, and the illustration then read as evidence for the field.

The standing law is that the contract's example is **captured, not written**
(`cmd/api/p5_runbook_example_db_test.go`, `TestRunBookExampleIsAServedBody`).
Writing numbers here is how a hand-written example gets into the contract by way
of a copy and paste. So this section specifies the **shape** and the **coherence
checks the captured body must satisfy**, and nothing else.

### 7.1 The shape

```
{
  "served_at":               <date-time>,
  "batch":                   <Batch, verbatim batchEnvelope(v)>,
  "evaluation": {
    "resolved_at":              <date-time, == served_at>,
    "probed_at":                <date-time, >= resolved_at>,
    "scenarios_evaluated":      <integer, == len(results)>,
    "freshness":                "still_newest" | "superseded"
                                | "newest_is_older" | "none_servable",
    "newest_servable_batch_id": <int64 or null, per the section 5 table>,
    "note":                     <the sentence for this arm, from the section 5 table>
  },
  "scenario_config_version": <string>,
  "requested_scenario_ids":  [<id>, ...],
  "results": [
    {
      "scenario_id":          <id>,
      "scenario_version":     <string>,
      "label":                <string>,
      "path_assumption":      <string>,
      "shocks":               [<Shock, exact rationals>],
      "shock_reach": {
        "declared_shocks":     <integer, == len(shocks)>,
        "reach":               <one of the six arms of section 2.5>,
        "applied_shocks":      [<AppliedShock>, ...],
        "marks_moved":         <integer>,
        "marks_snapped":       <integer>,
        "marks_base_snapped":  <integer>,
        "marks_cap_bound":     <integer>,
        "held_flat_marks":     <integer>,
        "held_flat_assets":    [<Address>, ...],
        "note":                <the arm's sentence>
      },
      "covered_engines":      [<engine>, ...],
      "withheld_engines":     [<engine>, ...],
      "unmeasurable_engines": [<SetRunEngineAbsence>, ...],
      "engines":              [<SetRunEngineSummary>, ...],
      "positions_answered":   <integer>,
      "positions_withheld":   <integer>,
      "note":                 <string>
    }
  ],
  "excluded_engines": [<EngineRefusal>, ...],
  "coverage":        <SetRunCoverage, with its per-engine census>,
  "notes":           [<the shared invariant prose, once>]
}
```

The captured example's id set must include **at least one scenario whose shock
does not fully reach**, so the `shock_reach` arms are exercised by the contract's
own example and not only by a test: `stable_depeg_0995_in_band` beside
`stable_depeg_099_boundary` is the pair the committed set already provides, and
they differ by one thousandth in the request and by everything in the answer.

The 404 refusal example, whose values **can** be written because they are the
request's own ids echoed back:

```json
{
  "error": {
    "code": "not_found",
    "message": "no committed scenario \"eth_minus_99\", \"eth_plus_10\": this endpoint evaluates the COMMITTED scenario set only (the same set GET /v1/scenarios publishes and /v1/address/{addr}/stress serves), never arbitrary user scenarios. The WHOLE set is refused rather than partly served: a comparison missing a member it was asked for is not the comparison that was asked for, and serving the rest under a shared envelope would leave the absence unnamed."
  }
}
```

`eth_minus_99` and `eth_plus_10` are used because they are **not** committed.
Revision 1 used `eth_minus_40`, `eth_minus_50` and `eth_minus_60`, all three of
which are committed files in `internal/risk/scenarios/`, embedded unconditionally
by `internal/risk/scenario.go:45` and loaded into `s.byID` by
`cmd/api/main.go:281-288`. A binary built from this tree serves them 200. The
observed 404s were a stale deployment, and a stale deployment's id set is not the
committed set.

The 503 busy example, whose values are likewise the deployment's own published
constants:

```json
{
  "error": {
    "code": "set_run_busy",
    "message": "this deployment evaluates at most 2 set-runs concurrently and 2 are running. The request was refused immediately rather than queued, so no connection is held waiting. Nothing here computes when a slot frees, so no Retry-After is offered rather than one invented. This is a statement about the evaluator's capacity and about nothing in the book: the batch is fine.",
    "max_in_flight": 2,
    "in_flight": 2
  }
}
```

### 7.2 Coherence checks the captured body must satisfy

These are the assertions in Test Law 1, listed here because they are the
specification of the example:

1. `served_at == evaluation.resolved_at`, and both inside the request's DB-clock
   bracket.
2. `evaluation.resolved_at <= evaluation.probed_at`, and `probed_at` inside the
   same bracket.
3. `batch.age_seconds == served_at - batch.computed_at`, and each
   `watermarks[].sweep.age_seconds == served_at -` that stamp's own
   `max_updated_at`, derived rather than written (wave W-EX-B's rule).
4. `scenarios_evaluated == len(results) == len(requested_scenario_ids)`.
5. The engine partition and the count partitions of Invariants 3 and 4.
6. `freshness` and `newest_servable_batch_id` agree, per the section 5 table.
7. Per result, `shock_reach.declared_shocks == len(shocks)`,
   `shock_reach.reach` is the arm section 2.5's ordered derivation yields for that
   result's own counts, and `marks_moved <= len(applied_shocks)`.

---

## 8. Test laws

1. **`TestRunBookSetExampleIsAServedBody`.** The contract's 200 example is
   captured, not written. Extend the `p5_runbook_example_db_test.go` fixture, run
   the real handler for a real committed id set, and assert the openapi example
   **is** that body, byte for byte, modulo exactly six serve-time fields:
   `served_at`, `batch.computed_at`, `batch.age_seconds`,
   `batch.watermarks[].sweep.age_seconds`, `evaluation.resolved_at`,
   `evaluation.probed_at`. The normalizer must fail if any of the six is absent,
   exactly as `normalizeServeTime` does today. Carry over W-EX-B's derivation
   rule (ages are arithmetic over anchors, never literals) and W-EX-C's two
   outside readings (`requireRawStampsAreThePersistedOnes`,
   `requireServedAtWithinDBClock`), plus the section 7.2 checks. The captured id
   set must include a scenario whose shock does not fully reach. Note that
   `evaluation` carries **no** `batch_id` to normalize or to exempt.

2. **`TestSetRunEqualsNSingleRunsAtTheSameBatch`.** The equivalence law, and what
   makes the shared-before optimization safe. Seed one batch; call the set
   endpoint for `{A, B}`; call the single endpoint for `A` and for `B`. For every
   (scenario, engine) the set-run **answers**, assert each summary field is
   byte-identical to the corresponding field of the single body, over this exact
   mapping:

   | set-run | single body |
   |---|---|
   | `usd_decimals` | `usd_decimals` |
   | `accounts` | `before.accounts`, and `after.accounts` |
   | `infinite_accounts` | `before.hf_histogram.infinite_count` |
   | `before_eligible_accounts` | `before.eligible_accounts` |
   | `after_eligible_accounts` | `after.eligible_accounts` |
   | `eligible_accounts_delta` | `newly_eligible_accounts` |
   | `flipped_to_eligible` (DM) | `movers_total` |
   | `hf_dropped_accounts` (Aave) | `movers_total` |
   | `before_eligible_debt_usd` | `before.eligible_debt_usd` |
   | `eligible_debt_delta_usd` | `eligible_debt_delta_usd` |
   | `before_bad_debt_usd` | `before.bad_debt_usd` |
   | `bad_debt_delta_usd` | `bad_debt_delta_usd` |
   | `before_collateral_at_risk_usd` | `before.collateral_at_risk_usd` |
   | `after_collateral_at_risk_usd` | `after.collateral_at_risk_usd` |
   | `total_debt_usd_before` | `before.total_debt_usd` |
   | `total_debt_usd_after` | `after.total_debt_usd` |
   | `total_collateral_usd_before` | `before.total_collateral_usd` |
   | `total_collateral_usd_after` | `after.total_collateral_usd` |
   | `market_realization` | `market_realization` |
   | `projection` | `projection` |

   And per result, not per engine:

   | set-run | single body |
   |---|---|
   | `shock_reach.applied_shocks` | `applied_shocks`, element for element |
   | `shock_reach.held_flat_marks` | `len(held_flat)` |
   | `shock_reach.held_flat_assets` | the sorted distinct `held_flat[].asset` |

   The `movers_total` row is **engine-conditional**, selected by
   `movement_rule`. Revision 1 mapped `movers_total` to `flipped_to_eligible` for
   every engine, which enshrined the wrong reading in the test that was supposed
   to catch it.

   The three per-result rows hold **only when no covered engine is withheld**, and
   the fixture must assert that precondition explicitly rather than assume it: the
   single route admits withheld engines' positions into its `ApplyScenario` pass
   (`p5_runbook.go:425-440`) while the set-run does not, so with a withheld engine
   the set's applied set is a subset. Test Law 13 covers that case.

   `refused_in_batch_positions`, `unrebuildable_positions` and
   `movement_excluded_accounts` have no single-body counterpart (the single body
   adds the first two into the histogram's `refused_count` and never publishes the
   third), so their laws are Test Laws 4 and 16.

   No materializer runs in the fixture, so the batch cannot move between calls.
   If slicing the shared before measure ever diverges from a per-scenario
   filtered measure, this is the test that fails.

3. **`TestSetRunBeforeSideIsScenarioInvariant`.** Over one seeded batch, assert
   equality across all scenarios covering an engine of **exactly these eleven
   fields**, enumerated and never pattern-matched: `accounts`,
   `infinite_accounts`, `movement_excluded_accounts`,
   `refused_in_batch_positions`, `unrebuildable_positions`,
   `before_eligible_accounts`, `before_eligible_debt_usd`,
   `before_bad_debt_usd`, `before_collateral_at_risk_usd`,
   `total_debt_usd_before`, `total_collateral_usd_before`.

   `movement_excluded_accounts` is in this set on purpose and is the one
   non-obvious member: on Aave the exclusion depends on the **after** side too
   (`p5_runbook.go:781` reads `a.infinite` and `a.hfWad`), and a shock does not
   give a debt-free account a health factor or take one away, so the population is
   invariant. If a scenario ever makes it vary, that is a finding and this test is
   where it surfaces.

   Revision 1 wrote this law over the prefixes `before_*` and `total_*`.
   `total_collateral_usd_after` and `total_debt_usd_after` match `total_*` and are
   after-side quantities that vary with the shock by construction, so the law as
   written failed on the body that document published. Never pattern-match a
   prefix for a semantic law.

4. **`TestSetRunCountsPartitionExactly`.**
   (a) `sorted(results[].scenario_id) == sorted(requested_scenario_ids)`, as
   multisets, in every 200.
   (b) `len(results) == evaluation.scenarios_evaluated`.
   (c) per result, `sort(engines[].engine ++ withheld_engines ++
   unmeasurable_engines[].engine) == sort(covered_engines)`, and the three are
   pairwise disjoint.
   (d) per result, `positions_answered == Σ engines[].accounts`, and
   `positions_answered + positions_withheld == Σ` over `covered_engines` of
   `coverage.engines[e].measurable`.
   (e) `coverage.batch_positions == coverage.in_book + coverage.refused_in_batch
   + coverage.excluded_by_this_layer`.
   (f) Σ over `coverage.engines[]` of each of `positions_in_batch`, `measurable`,
   `refused_in_batch`, `unrebuildable` equals the corresponding set-level field.
   (g) per (result, engine), `refused_in_batch_positions ==
   coverage.engines[e].refused_in_batch` and `unrebuildable_positions ==
   coverage.engines[e].unrebuildable` and `accounts ==
   coverage.engines[e].measurable`.
   (h) per (result, engine), `infinite_accounts <= accounts` and
   `movement_excluded_accounts <= accounts`; on Aave
   `hf_dropped_accounts <= accounts - movement_excluded_accounts`; on DM
   `flipped_to_eligible <= accounts - movement_excluded_accounts`.
   (i) per result, `marks_moved <= len(shock_reach.applied_shocks)` and each of
   `marks_snapped`, `marks_base_snapped`, `marks_cap_bound` likewise. **No sum or
   disjointness is asserted among the last three or against `marks_moved`**: a
   snapped mark whose persisted price was off par does move, so an assertion that
   `marks_snapped + marks_moved == len(applied_shocks)` would be a false law that
   passes on today's fixtures.

   Clause (g) is the one that keeps the two refusal classes from drifting apart,
   which revision 1 had no clause for; clause (h) is the movement denominator.

5. **`TestSetRunIsAtomicOnAnUnknownId`.** A set containing one uncommitted id
   answers 404, the body names **every** unknown id, no partial body is served,
   and no compute happened. Assert the last through a handler-level counter seam,
   not through timing. Assert also that the in-flight gauge never rose, which is
   the precondition form of the release law (see Test Law 19). Use an id that is
   genuinely not committed (`eth_minus_99`), asserted against
   `risk.LoadScenarios()` in the test itself so the fixture cannot rot the day
   someone commits it.

6. **`TestSetRunRefusesDuplicatesAndOverCap`.** Duplicate ids give 400 naming
   every repeat; 25 ids give 400 naming the bound and the count; an empty array
   gives 400 stating there is no implicit "all"; an unknown JSON field gives 400
   naming the field, not a 400 about an empty set; a 9 KiB body gives 400 about
   the size.

7. **`TestSetRunSupersessionMidComputeDisclosesAndDoesNotTear`.** Using the
   existing `bookInterleave` seam (`cmd/api/read.go:371-375`,
   `book_prune_race_db_test.go`): seed batch N, arm the seam to write batch N+1
   after the snapshot is established, run the set. Assert (a) `batch.id == N`,
   (b) every number equals a set-run over batch N alone, so nothing leaked,
   (c) `evaluation.freshness == "superseded"`, (d)
   `evaluation.newest_servable_batch_id == N+1`, (e) the response is still
   **200**: supersession mid-run is a disclosure, never a refusal.

8. **`TestSetRunFreshnessProbeIsOneStatementAndIsTotal`.** Four cases against the
   derived enum, one per arm: still newest; superseded; the resolved batch pruned
   with nothing servable; and **the resolved batch made incomplete while an older
   one remains servable**, driven through a store seam that removes a required
   watermark row for batch N so `riskBatchCompleteConjuncts` stops selecting it.
   Assert in every case that `freshness` and `newest_servable_batch_id` agree
   (null exactly for `none_servable`, equal to `batch.id` exactly for
   `still_newest`, strictly greater exactly for `superseded`, strictly less
   exactly for `newest_is_older`), and assert the note served is the arm's own
   sentence, in particular that the `newest_is_older` body never contains "has
   since materialized". Assert directly that the probe issues **one** statement,
   so the id and the clock cannot come from different instants. Assert the
   derivation is a switch over the four comparison outcomes with **no default
   arm**, by a source-level check in the same shape as the existing predicate
   tests: an `otherwise` arm is how the wrong sentence got specified in the first
   place.

9. **`TestSetRunNeverSumsAcrossEngines`.** A contract sweep in the shape of
   `contract_sweep_law_test.go`. Two parts, because one part alone is either red
   or vacuous:

   (a) Walk from each `RunBookSetResponse.results[].engines[]` item. Assert every
   `Decimal` and `NullableDecimal` property reachable from there is beneath a node
   requiring `usd_decimals`. No hand-maintained field list inside the money
   subtree.

   (b) Walk from the `RunBookSetResponse` root and collect every
   `Decimal`/`NullableDecimal` property **outside** that subtree. Assert the
   collected set is **exactly**
   `{Batch.watermarks[].sweep.success_sum, AppliedShock.factor_num,
   AppliedShock.factor_den, AppliedShock.before, AppliedShock.after}`, each pinned
   as a named exception with its justification in the test: `success_sum` is a
   sweep row counter on the envelope, and the four `AppliedShock` fields are an
   exact rational and a pair of **oracle marks in the price feed's own units**,
   not money quantities in an engine's USD unit. That distinction is why
   `AppliedShock` carries no `usd_decimals` today and must not be given one: a
   price is not a book total, and pretending it is would be the cross-engine
   defect in a new place.

   Revision 1 specified only part (a) rooted at the response, which is red on
   arrival: `SweepStamp.success_sum` is a required `Decimal`
   (`api/openapi.yaml:1671-1682`) with no `usd_decimals` ancestor, on every
   response that carries the batch envelope. A law that fails on its first run
   gets weakened rather than fixed, and the property it was protecting ends up
   with no test at all. The exact-set pin in (b) keeps the "no inventory" spirit:
   the set may only shrink, and any new envelope Decimal fails the test until
   somebody justifies it in writing.

10. **`TestSetRunHasNoFloats`.** Same walk from the set-run roots: no
    `type: number` anywhere, and every money quantity is `Decimal` or
    `NullableDecimal`. (`type: number` does exist in the contract, at
    `Constants.rate_limit_requests_per_second`, which the set-run root does not
    reach.)

11. **`TestSetRunNeverReClocksBelowTheEnvelope`.** Assert directly that no schema
    reachable from the set-run root, other than `Batch` itself, requires
    `batch_id`, `computed_at` or `bucket_start`. `SetRunEvaluation` is included in
    that assertion, which is why it carries no `batch_id`.

    State the structural backstop **accurately**: the existing
    liquidatable-disclosure sweep enforces this for the **results subtree only**,
    because `Projection.becomes_liquidatable` (`api/openapi.yaml:2440`) sits
    beneath `results[].engines[]`, so a `batch_id` there voids the envelope's
    license and fails `TestLiquidatableDisclosureLawSweepsTheWholeContract`. It
    enforces nothing about a block with no liquidatable descendant, because
    `sweepWalk` records violations only at liquidatable-family properties
    (`contract_sweep_law_test.go:342-345`). Revision 1 claimed the sweep was the
    backstop for the whole response. It is not, and this test is why the claim is
    not needed.

12. **`TestCommittedScenarioVersionMovesWithItsEngines`.** A law over
    `internal/risk/scenarios/*.json` and a checked-in golden of
    `(id, version) -> sorted(engines)`. If a scenario's `engines` set changes, its
    `version` must change. This makes the client's identity join sound and makes
    the `COVERAGE SKEW` register unreachable in a correct deployment.

13. **`TestSetRunWithheldEngineIsNamedAndNotZeroed`.** Seed a withheld engine;
    set-run a scenario covering it; assert it appears in `withheld_engines` and in
    `excluded_engines`, appears nowhere in `engines[]` or
    `unmeasurable_engines[]`, contributes to `positions_withheld` and not to
    `positions_answered`, and that a scenario covering only withheld engines
    returns `engines: []` while still counting in `scenarios_evaluated`. Assert
    also that `shock_reach.applied_shocks` is a **subset** of what the
    single-scenario route serves for the same scenario at the same batch, and that
    the result's note names the withheld engine as the reason, so the subset is
    disclosed rather than discovered.

14. **`TestSetRunUnmeasurableEngineIsNamedAndNotZeroed`.** The absence law, in
    three fixtures: (a) a batch whose positions are all `refused`, (b) a covered
    engine with zero positions in the batch, (c) a covered engine all of whose
    positions fail reconstruction. In each, assert the engine appears in
    `unmeasurable_engines` with the right `reason` and counts, appears nowhere in
    `engines[]`, that **no** `"0"` denominator is served for it, and that
    `coverage.book_is_measurable` is false when `in_book == 0`. Also assert, as a
    negative control against the current single-scenario route, that a run over
    the same fixture on `POST /v1/scenarios/{id}/run-book` still serves the
    all-zero row, so the difference is deliberate and recorded rather than
    accidental (see Open Question 5).

15. **`TestSetRunMovementCountIsEngineCorrect`.** Seed an Aave position whose
    health factor drops without crossing into eligibility, and a DM position that
    flips. Assert the Aave row serves `hf_dropped_accounts` non-null with
    `flipped_to_eligible: null` and `movement_rule: "hf_strictly_dropped"`, the DM
    row the mirror image, that exactly one of the two counts is non-null on every
    engine row, and that neither is ever null on both. This is the designed-mutant
    kill for the mislabelled-count defect: a summary that fills
    `flipped_to_eligible` from `movers_total` on Aave fails here.

16. **`TestSetRunMovementCountPublishesItsDenominator`.** The quiet-zero law for
    the count itself. Seed an Aave book of M accounts of which **all but one carry
    no debt**, and shock it so the one indebted account's health factor does not
    drop. Assert the served row has `hf_dropped_accounts: 0`,
    `accounts: M`, `infinite_accounts: M-1`, and
    `movement_excluded_accounts: M-1`, so `0` is visibly out of a denominator of
    1 and not out of M. Assert the engine `note` carries all **five** mandated
    clauses and that its exclusion clause is the `runBookMoversNote` sentence
    (`p5_runbook.go:843-845`) rather than a paraphrase, checked by substring so a
    reworded note fails. Assert the DM row on the same body serves
    `movement_excluded_accounts: 0` and that the count is a real zero there.
    Designed-mutant kill: a summary that drops either the field or the clause
    serves `0 of 46` on this deployment's Aave side and reads as "no health factor
    dropped".

17. **`TestSetRunShockReachDisclosesASnappedControl`.** The finding-1 law, and the
    one this whole component exists for. Seed a batch carrying DM stable
    collateral. Run the set `{stable_depeg_0995_in_band,
    stable_depeg_099_boundary}` in one request. Assert:

    (a) the in-band result serves `reach == "no_mark_moved"`, `marks_moved == 0`,
    `marks_snapped == len(applied_shocks) > 0`, and every `applied_shocks[]` row
    carries `snapped: true` with `before == after` as exact strings;
    (b) the boundary result serves `reach == "every_mark_moved"` with
    `marks_snapped == 0`, because the band is open at 0.99
    (`api/openapi.yaml:2389`);
    (c) the in-band result's engine rows are **present**, with a nonzero
    `before_eligible_debt_usd` and three `"0"` deltas, so no true number was
    suppressed to hide a true zero;
    (d) the in-band result's `note` and `shock_reach.note` both state that the
    zero is the oracle's doing and not the book's;
    (e) the two results are distinguishable **from the body alone**, with no join
    against `GET /v1/scenarios` and no access to `propagation`, which
    `ScenarioDefinition` does not publish (`api/openapi.yaml:2494-2497`).

    Then the general law, over **every** result of every fixture in this file:
    **an all-zero engine row must carry a published cause.** If all three of
    `eligible_debt_delta_usd`, `bad_debt_delta_usd` and `eligible_accounts_delta`
    are zero on every engine of a result, then at least one of these must hold:
    `reach` is one of the four non-`every_mark_moved` arms; or
    `market_realization` is non-null; or `projection` is non-null. A result that
    serves three zeros under `reach == "every_mark_moved"` with neither block is a
    genuine finding about the book and is allowed **only** when the fixture
    asserts it deliberately, with the note saying so. A snapped control can never
    render as an undisclosed zero.

18. **`TestSetRunShockReachArmsAreTotalAndOrdered`.** The six arms, each from a
    committed scenario or a seeded fixture: `projection_no_spot_pass` from
    `dm_rate_horizon_plus_200bps` (which declares **one** shock and still lands
    here, so the ordering is exercised, not assumed);  `no_shocks_declared` from
    `weeth_market_depeg_oracles_held`; `no_shock_reached_the_book` from a book
    holding none of a scenario's shocked assets; `no_mark_moved` from
    `stable_depeg_0995_in_band`; `some_marks_held` from
    `stable_depeg_098_unsnapped`; `every_mark_moved` from `eth_minus_30`. Assert
    the derivation is a switch with no default, that `applied_shocks` is empty in
    exactly the first three arms, and that no arm's note is served under another
    arm.

19. **`TestSetRunInFlightBoundRefusesWith503AndNeverLeaksASlot`.** With the bound
    set to 1 and a handler seam holding the first request inside the arithmetic,
    assert the second is refused **503** with `error.code == "set_run_busy"`,
    immediately rather than queued, with `max_in_flight` and `in_flight` on the
    body and **no `Retry-After` header**, and that `web/lib/runbookSet.ts` maps it
    to `{kind: "busy"}` and not to `{kind: "no-batch"}` or `{kind:
    "rate-limited"}`, dispatching on the code rather than the status.

    Then the release law, over the paths that actually acquire:
    (a) the **503 for no servable batch**, raised inside `s.readBatch`
    (`cmd/api/read.go:352`) after the acquire: run it against an empty database
    and assert the in-flight gauge returns to zero and a subsequent set-run is
    admitted. This is the leak that takes a deployment to zero capacity
    permanently and it is the arm an earlier revision did not name;
    (b) the **500** for an arithmetic refusal, likewise;
    (c) a **panic** inside the arithmetic, through a seam, asserting the `defer`
    releases;
    (d) the normal 200.

    And the precondition form for the paths that do not acquire: on 400, 404 and
    the 429 token refusal, assert the gauge **never rose**. Asserting a release
    there is vacuous, because section 3 refuses those before the acquire; the
    checkable claim is that nothing was taken.

20. **`TestSetRunTokenChargeIsPerScenario`.** With `ipLimiter.now` frozen through
    its existing seam (`cmd/api/middleware.go:322-323`) so no refill occurs:
    burst 40 admits two 15-scenario set-runs (2 middleware tokens plus 28 handler
    tokens, 30 total) and refuses the third (45 > 40) with 429 and `Retry-After`,
    the message naming the per-scenario cost. Assert the 429 here is `ErrorBody`
    with `code: "rate_limited"`, structurally distinct from the 503 busy body, so
    the two refusals cannot be confused by a client or in a log. Assert a 400
    request costs exactly 1 token, not N. Plus a startup assertion that
    `rate_burst >= max_set_run_scenarios`, and a boot-refusal test for a burst
    below the cap.

21. **`TestSetRunBlastRadiusIsOnlyIf`.** Three fixtures, because the property is
    a one-way implication and the fixture that would prove a biconditional does
    not exist.
    (a) Seed a batch carrying a position that refuses under `ComputeAaveHealth`,
    on an engine **no requested scenario covers**. Assert the set-run serves 200.
    Then request a scenario that does cover that engine and assert 500, and that
    the single-scenario endpoint 500s for the same scenario.
    (b) The **withheld** asymmetry, asserted rather than papered over. Seed the
    same defective position on an engine that is **covered by the requested
    scenario and withheld on the batch**. Assert the single-scenario route
    **500s**, because `p5_runbook.go:425-440` filters only on
    `covers(sc.Engines, p.Engine)` and the defective position therefore reaches
    `measureRunBook` and `risk.Waterfall` before `:562-565` ever drops the row.
    Assert the set-run serves **200**, because section 3.6 scopes the union
    measure to covered engines **minus withheld**. Record this as a deliberate
    divergence, in the same manner as Test Law 14's negative control: the set-run
    behaviour is the better one, and the point of the test is that "the set
    refuses **if and only if** a member would have refused alone" is **false in
    the reverse direction** and must never be written that way again.
    (c) Assert the direction that is true, over both fixtures: the set refuses
    **only if** at least one requested scenario would have refused alone.

22. **`TestSetRunResultsAreInRequestOrder`** and
    **`TestSetRunIsByteDeterministic`.** Two identical requests against one seeded
    batch produce identical bytes modulo the three clock fields and the derived
    ages; `results` follows request order including a deliberately unsorted
    request; every engine-bearing array within a result is sorted by engine name,
    `applied_shocks` by `appliedShockKey` and `held_flat_assets` by address.

23. **`TestReadOnlyGateAdmitsExactlyTwoPosts`.** `POST
    /v1/scenarios/run-book-set` is admitted; `POST
    /v1/scenarios/run-book-set/anything` is 405; `POST
    /v1/scenarios/set/run-book` is **not** special-cased and reaches the id route
    as the id `set`, giving a 404 about a committed scenario, which is the honest
    answer. The 405 body names both admitted POSTs.

24. `TestAPIIssuesNoWritingSQL` already sweeps the package; the new file is
    covered with no change.

---

## 9. Web and deep-link implications

### 9.1 The tornado is a new surface, not a widened matrix

`LabRunBookEngine` carries `before`/`after` full aggregates, histograms,
`collateral_by_asset` and `movers`. **Do not widen it to admit a summary.** A
summary flowing into `cellState`'s `{state: "result", engine}` arm would render
blank histograms and empty collateral tables, filling holes with zeros, which is
the exact defect `matrixCells.ts` was built across R8 to R17 to prevent.

Ship two sibling modules, not a widening:

- `web/lib/runbookSet.ts`, the fetch and outcome module, with its own
  `SetRunOutcome` union including the `busy` arm of section 4.3, dispatching on
  the error envelope's `code` before the HTTP status. `RunBookOutcome`
  (`web/lib/runbook.ts:49-55`) is left alone: its `ok` arm is typed to
  `LabRunBook`, and its 429 arm discards the envelope message, which is the
  behaviour section 4.2 routes around rather than inherits.
- `web/app/lab/tornadoCells.ts`, the decision module, which **reuses**
  `matrixCells`' vocabulary (`ScenarioIdentity`, `rowIdentity`, `skewFields`,
  `definitionSkew`, `DEFINITION CHANGED`, `resolveBatchCohort`,
  `anchorBatchOfPhase`) and defines its own cell and bar states over the summary
  shape. One identity join, one skew sentence, two renderers.

### 9.2 Deep links

- **New param `?scenarios=a,b,c`** (comma-separated committed ids). Rides the same
  listing-arrival callback as today's `?scenario=` (`LabBookPanel.tsx:893-928`),
  for the same reason: membership becomes knowable only when the listing lands, so
  the auto-run can never POST an id the deployment does not publish.
- **`?scenario=` and `?scenarios=` together run nothing, and say so.** Two
  mutually exclusive selections in one URL is a link nobody wrote. Render a named
  notice; do not guess a precedence.
- **Ids in `?scenarios=` absent from the listing are filtered before dispatch and
  NAMED in a visible notice.** Today's single deep link silently returns on a
  non-member (`LabBookPanel.tsx:907`). For a set that silence becomes a hole: the
  client must filter, since an unknown id 404s the whole set by section 4, so it
  must disclose what it filtered. "You asked for 15, this deployment publishes 12,
  here are the three it does not", never a quiet 12.
- **No `?scenarios=*`.** A link whose meaning changes when the committed set
  changes is a link that lies to whoever opens it tomorrow. Same rule as the
  request body's no-implicit-all.
- **No `?batch=` in this wave.** See Open Question 3.

### 9.3 Dispatch and settle

One request writes **N phases at once**, each
`{kind: "running", attempt: identities.get(id)}`, the existing `MatrixPhase`
shape, so R14's dispatch-time identity stamping works unchanged and the whole set
is judged by the definitions on screen at the instant of dispatch.

On settle, one body fans out to N phases. The set-level gate
(`CONTRADICTORY SET`) runs **first**, over the whole body, before any row is
classified: R12's validate-before-classify, at set granularity. A set that
contradicts its own membership produces no cell, no pin and no cohort for any row
it covers.

A bodyless settlement (429, the 503 busy arm, the 503 no-batch arm, network)
fails **all N rows at once**, each keeping whatever it held at its own batch pin,
each with `rerunFailed` carrying the settlement's own identity stamp (R16), and
each naming **which** of those four it was. One request, one failure, N
disclosures, which is strictly more honest than today's N independent failures,
because the reader learns one fact instead of inferring it from N.

### 9.4 The axis law

This is a named law, in the same register as the cohort rule below, because
nothing in revision 1 forbade the thing it made easy.

**One axis per engine. Never one axis across engines.** A DM bar and an Aave bar
are integers in different units: 6 decimals and 8 decimals, from
`engineValueDecimals` (`cmd/api/p5_common.go:81`) and confirmed per row by the
summary's own `usd_decimals`. Plotting them on one axis compares a
6-decimal integer with an 8-decimal one, which is not a comparison. The tornado
renders one panel per engine, each labelled with that engine's decimals, or it
renders one engine at a time.

**The only sanctioned normalization is the engine's own book.** A bar's length
may be `eligible_debt_delta_usd` over `total_debt_usd_before`, on that engine's
own row. That ratio is dimensionless and therefore comparable across engines, and
the before side is the sanctioned denominator for the reason given in section 2.6.
Every **printed** number remains the engine's own exact decimal string at its own
`usd_decimals`; the ratio is a layout quantity, never a served or displayed
figure, and it is never rounded into a claim.

**A zero denominator draws no bar.** When `total_debt_usd_before` is `"0"` on an
answered engine (a real state: an engine whose measurable accounts all carry no
debt), the cell enters `NO DENOMINATOR` and says so. It does not draw a
zero-length bar, and it does not divide.

**A shock that did not reach draws no bar.** When
`shock_reach.reach` is `no_mark_moved` or `no_shock_reached_the_book`, every
engine of that result enters `SHOCK DID NOT REACH` (section 4.3) and no bar is
drawn for it, at any length, in any panel. A zero-length bar beside a real one is
the exact reading `stable_depeg_0995_in_band` would otherwise produce, and the
axis law is where the renderer is forbidden it. When the arm is
`some_marks_held`, the bar draws **with** the reach counts in the cell, never
bare.

**A movement count is never printed without its denominator.** `hf_dropped_accounts`
renders as "K of M", where M is `accounts - movement_excluded_accounts`, never as
a bare K and never against `accounts`.

**No cross-engine total, anywhere.** There is no "total impact" bar, no summed
tornado, and no average. Invariant 7 and Test Law 9 are the server-side half;
this is the client-side half, and the two exist separately because a renderer can
sum numbers a server never summed.

### 9.5 The cohort still applies, and must

The set-run makes the cohort trivial *for the rows it covers*, one batch by
construction. It does **not** make it unnecessary: a single-row re-run through the
existing endpoint lands at whatever batch is newest and raises the anchor above
the set's batch. `resolveBatchCohort` then correctly demotes every set row to
`SUPERSEDED`.

**Tornado-specific rule:** a tornado is one sentence across scenarios, so a bar
from another batch breaks it. The tornado draws a bar **only** for rows whose
pinned batch equals the set's batch. A re-run row leaves the chart into its own
named state with its own batch id and a re-run affordance for the *set*. It does
not get drawn shorter, greyer, or beside the others.

### 9.6 Header

One line, composed once and rendered by every surface (the file's habit since
R13): the set's batch id; the `evaluation.freshness` clause for the arm in force,
with the newer batch id and a re-run affordance in the `superseded` arm, the older
batch id and the word OLDER in the `newest_is_older` arm, and a disabled
affordance with its reason in the `none_servable` arm; the count of bars drawn
against scenarios requested; the count of scenarios whose shock did not reach; the
count of engines named absent rather than drawn; and, when non-empty, the
deep-link ids that were filtered.

---

## Invariants claimed

1. **ONE BATCH.** Every `RunBookSetResponse` carries exactly one `batch` object,
   and no schema reachable from the set-run root other than `Batch` itself
   requires `batch_id`, `computed_at` or `bucket_start`. Asserted directly (Test
   Law 11). The existing liquidatable-disclosure sweep enforces this **for the
   `results` subtree only**, where `Projection.becomes_liquidatable` sits beneath
   `engines[]`; it enforces nothing for a block with no liquidatable descendant,
   and no claim is made that it does.

2. **MEMBERSHIP PARTITIONS EXACTLY.** In every 200,
   `sorted(results[].scenario_id) == sorted(requested_scenario_ids)` as
   multisets, no id in two results and no id in none, and
   `len(results) == evaluation.scenarios_evaluated`. There is no partial 200.

3. **ENGINE PARTITION, PER SCENARIO, IN THREE PARTS.** For every result,
   `sort(engines[].engine ++ withheld_engines ++ unmeasurable_engines[].engine)
   == sort(covered_engines)`, and the three are pairwise disjoint. No covered
   engine may be absent from all three (the hole class), none may appear in more
   than one (the R12 contradiction class), and none may appear in `engines[]`
   with `accounts == 0` (the zero-row class).

4. **COUNTS PARTITION EXACTLY, AND THE TWO REFUSAL CLASSES STAY SEPARATE.** Per
   result, `positions_answered == Σ engines[].accounts` and
   `positions_answered + positions_withheld == Σ` over `covered_engines` of the
   census's `measurable`. At set level,
   `batch_positions == in_book + refused_in_batch + excluded_by_this_layer`
   exactly, which holds because the position status vocabulary is closed to
   `{computed, refused}`. The per-engine census sums to each set-level field, and
   per (result, engine) the summary's `accounts`, `refused_in_batch_positions`
   and `unrebuildable_positions` equal the census's `measurable`,
   `refused_in_batch` and `unrebuildable`. `coverage.in_book` is the whole
   reconstructable book, not any one scenario's run.

5. **SET-RUN EQUALS N SINGLE RUNS AT ONE BATCH, AND ITS BLAST RADIUS IS NO WIDER.**
   For every (scenario, engine) the set answers, each summary field is
   byte-identical to the corresponding field of the single-scenario body computed
   over the same batch, under the explicit mapping of Test Law 2. The shared
   before measure is an optimization, never a different measurement.

   The blast-radius property is a **one-way implication and is stated as one**:
   because the shared measure is union-scoped over the requested scenarios'
   covered engines and each after measure is scoped to its own scenario's covered
   engines, **the set refuses with 500 only if at least one requested scenario
   would have refused alone.**

   The converse is **false**, and the exception is named rather than hidden. On
   the single-scenario route a covered-but-**withheld** engine's reconstructable
   positions still enter `beforeInputs` (`p5_runbook.go:425-440` filters only on
   `covers(sc.Engines, p.Engine)`; the withheld row is dropped later, at
   `:562-565`), so they reach `measureRunBook` and `risk.Waterfall`, both of which
   return on the first bad position. A defective position there therefore 500s the
   single route while the set-run, whose union excludes withheld engines
   (section 3.6), serves 200. The set-run behaviour is the better one. Test Law
   21(b) exercises the divergence so it is recorded rather than accidental, and no
   biconditional is claimed anywhere in this document.

6. **THE BEFORE SIDE IS SCENARIO-INVARIANT, OVER ELEVEN ENUMERATED FIELDS.** At a
   fixed batch, `accounts`, `infinite_accounts`, `movement_excluded_accounts`,
   `refused_in_batch_positions`, `unrebuildable_positions`,
   `before_eligible_accounts`, `before_eligible_debt_usd`, `before_bad_debt_usd`,
   `before_collateral_at_risk_usd`, `total_debt_usd_before` and
   `total_collateral_usd_before` are equal across all scenarios covering that
   engine. No after-side quantity is in this set, and the law is never stated over
   a name prefix. Structural cause: `risk.Waterfall` accumulates only through
   `engineOf(m.engine, ...)` and `measureRunBook`'s walk is per position, so an
   engine's outputs never depend on another engine's rows.

7. **NO CROSS-ENGINE MONEY.** Every `Decimal`/`NullableDecimal` property under
   `results[].engines[]` is reachable only through a node requiring
   `usd_decimals`. The only money-typed properties elsewhere under the set-run
   root are `Batch.watermarks[].sweep.success_sum` (a sweep counter) and
   `AppliedShock`'s `factor_num`, `factor_den`, `before` and `after` (an exact
   rational and two oracle marks in the feed's own units, not money in any
   engine's USD unit), pinned as an exact named exception set. There is no total,
   sum, average or rollup of money across engines anywhere in the response, and
   section 9.4 forbids one in the renderer.

8. **NO FLOATS.** No `type: number` appears anywhere under the set-run schemas;
   every money quantity and every price mark is an exact decimal integer string.

9. **AN UNKNOWABLE IS NEVER ZERO, AN ABSENCE IS NEVER ZERO, AND A ZERO ALWAYS
   CARRIES ITS CAUSE.** Four classes, all four disclosed.
   (a) A withheld engine contributes no row and no zero; it is named in
   `withheld_engines` and in `excluded_engines`.
   (b) A covered engine with no measurable position contributes no row and no
   zero; it is named in `unmeasurable_engines` with its reason and its counts.
   (c) `market_realization` and `projection` are present whenever the committed
   definition declares them, so a scenario whose three deltas are structurally
   zero because it moves no oracle mark, or because it is a projection, never
   renders as three zero bars.
   (d) **`shock_reach` is present on every result**, so a scenario whose three
   deltas are zero because the pricing transform swallowed the move (a snapped
   stable), because a cap adapter bound it, because the mark was held flat, or
   because no position holds the shocked asset, says which. Its six arms are
   total and ordered, its `applied_shocks` carry `snapped`, `base_snapped` and
   `cap_bound` verbatim, and `marks_moved` answers "did a price change" from the
   body alone, with no join and no access to `propagation`, which
   `ScenarioDefinition` does not publish.
   An all-zero engine row is legal **only** with a published cause from (c) or
   (d), or as a deliberately asserted finding about the book under
   `reach == "every_mark_moved"`. A scenario with no answerable engine returns
   `engines: []` and still counts in `scenarios_evaluated`.

10. **EVERY DELTA CARRIES ITS BASE AND ITS DENOMINATOR, AND THE DENOMINATOR NAMES
    ITS SIDE.** `eligible_debt_delta_usd` and `bad_debt_delta_usd` are each
    served beside their `before_*` value and beside both
    `total_debt_usd_before` and `total_debt_usd_after`, at the same
    `usd_decimals`. The sanctioned ratio is against the **before** side, stated in
    the engine note, because Aave debt is priced and its two sides are different
    books. `eligible_accounts_delta` (NET) is served beside the engine's own
    movement count, so a net of zero cannot hide equal churn in both directions.

11. **THE MOVEMENT COUNT IS THE ENGINE'S OWN, AND IT CARRIES ITS DENOMINATOR.**
    Exactly one of `flipped_to_eligible` (DM, flips false to true) and
    `hf_dropped_accounts` (Aave, health factors that strictly dropped) is non-null
    on every engine row, selected by `movement_rule`, which is served as an enum.
    Never both, never neither, and never one engine's count under the other's
    name. And the count's **excluded population is on the wire**:
    `movement_excluded_accounts` is the accounts `runBookMovers` could not test at
    all (`p5_runbook.go:772-783`), `infinite_accounts` is the debt-free population
    `hf_histogram.infinite_count` publishes today, and the mandated engine note
    carries the exclusion clause in `runBookMoversNote`'s own words. The movement
    count's denominator is `accounts - movement_excluded_accounts` and is never
    `accounts`.

12. **ATOMICITY.** Any unknown, duplicate, malformed, over-cap or missing scenario
    id refuses the whole request before any batch read, any arithmetic, any
    in-flight slot and any per-scenario token, naming every offending id. Any
    arithmetic refusal refuses the whole request with 500. No response ever
    carries some scenarios and silently omits others.

13. **FRESHNESS IS DISCLOSED IN FOUR TOTAL ARMS, NEVER TORN, NEVER A REFUSAL.**
    Batch resolution and every child read happen inside one `BeginRiskSnapshot`,
    so a batch landing mid-compute is invisible to the arithmetic. The response
    carries the resolved batch, answers 200, and `evaluation.freshness` is one of
    `still_newest`, `superseded`, `newest_is_older`, `none_servable`, each with
    its own served sentence. `newest_servable_batch_id` is null exactly in the
    fourth arm, equal to `batch.id` exactly in the first, strictly greater exactly
    in the second and strictly less exactly in the third. The derivation is a
    total four-way comparison with **no default arm**, so no unconsidered state
    can inherit another arm's sentence. The id and the enum come from **one
    statement**, so they cannot contradict each other.

14. **TEMPORAL COHERENCE.** `served_at == evaluation.resolved_at ==` the resolving
    snapshot's database clock; `evaluation.probed_at >= resolved_at`; both lie
    inside a bracket of `SELECT now()` readings taken either side of the request;
    `batch.age_seconds == served_at - batch.computed_at`, and each
    `watermarks[].sweep.age_seconds == served_at -` that stamp's own
    `max_updated_at`.

15. **IDENTITY IS JOINABLE PER ROW.** Every result carries `scenario_id` and
    `scenario_version`, and the envelope carries `scenario_config_version`, so
    `matrixCells.ts`'s `ScenarioIdentity` triple can be formed for each row and
    `definitionSkew` can refuse a row it may not classify. Corollary law over the
    committed set: a scenario's `version` must change whenever its `engines` set
    changes.

16. **DETERMINISM.** Two identical requests against the same batch serve
    byte-identical responses modulo `served_at`, `evaluation.resolved_at`,
    `evaluation.probed_at` and the derived age fields. `results` is in request
    order; every engine-bearing array is sorted by engine name, `applied_shocks`
    by `appliedShockKey` and `held_flat_assets` by address.

17. **COST IS BOUNDED, CHARGED, CONCURRENCY IS BOUNDED, AND EVERY REFUSAL SAYS
    WHAT IT IS.** `len(scenario_ids) <= max_set_run_scenarios` (24); the limiter is
    charged exactly `len(scenario_ids)` tokens, 1 in the middleware and the
    remainder in the handler after validation; the deployment satisfies
    `rate_burst >= max_set_run_scenarios`, validated at startup so no legal
    request is permanently unservable; and at most `max_inflight_set_runs`
    (default 2) set-runs are in flight, with the overflow refused **immediately**,
    never queued.

    The three refusals a busy or throttled deployment can produce are
    **structurally distinguishable in the body**, not by prose: 429 with
    `ErrorBody{code: rate_limited}` and a meaningful `Retry-After` (a token bucket
    refill instant, `res.DelayFrom(now)`); 503 with `SetRunBusyBody{code:
    set_run_busy, max_in_flight, in_flight}` and **no** `Retry-After`, because
    nothing computes when a semaphore slot frees and no instant is invented; 503
    with `ErrorBody{code: unavailable}` for no servable batch. No refusal tells a
    client it exceeded a rate it did not exceed, and none makes a statement about
    the book that is a statement about the service.

18. **THE SLOT IS NEVER LEAKED, AND THE PATHS ARE NAMED.** The in-flight slot is
    acquired after validation and the token charge and before the batch read, and
    released by a `defer` on every exit: the 200, the 500, the **503 for no
    servable batch raised inside `s.readBatch` (`cmd/api/read.go:352`)**, and a
    panic. The 400, 404 and 429 paths refuse **before** the acquire, so their law
    is the precondition that the gauge never rose, never a vacuous claim that
    something was released.

19. **THE SURFACE WRITES NOTHING.** The set-run handler issues no writing SQL
    (covered without change by `TestAPIIssuesNoWritingSQL`), and the `readOnly`
    gate admits exactly two POST paths, by exact match, never by path family.

---

## Open questions

- **Should 1.7.0 also add an optional `batch_id` to `POST
  /v1/scenarios/{id}/run-book`, for drill-down only?** RECOMMEND YES, as a
  subordinate item. Without it, clicking a tornado bar re-resolves the newest
  batch and the detail view shows numbers that differ from the bar it came from,
  which is a D-013 defect the day the tornado ships. It is cheap:
  `internal/store/risk.go:1583`'s `riskBatchCompleteConjuncts` is parameterless
  over alias `b`, so a by-id read is `WHERE b.id = $1 AND` plus the same fragment,
  and superseded-batch positions are provably still readable
  (`internal/store/p5_positions_page.go` reads `risk_positions` for an arbitrary
  pinned batch and refuses only when the batch row is gone,
  `ErrPositionsBatchMissing` at line 67, existence probe at line 365). At
  `defaultRetention = 5000` (`cmd/riskd/main.go:66`) and the observed cadence a
  batch stays readable roughly 69 hours. It needs one new refusal (a batch that is
  no longer evaluable, pruned or never complete) which should follow the
  `BatchSupersededBody` precedent rather than widening the sealed `ErrorBody` code
  enum, which is the same precedent `SetRunBusyBody` follows. **It is severable:**
  ship (A) alone if the wave must be narrow, and the web falls back to its
  existing `SUPERSEDED` register, which already tells the truth.

- **Should `evaluation` be added to the existing `RunBookResponse` too?**
  RECOMMEND YES. The single-scenario endpoint has the same 1.0 to 1.9 s exposure
  and discloses nothing about it today; a reader cannot tell whether the batch it
  names is still the head. It is additive in the established 1.6.0 manner, it
  costs one cheap statement, and it lets the web's cohort machinery learn the fact
  from the wire instead of inferring it. Cost: the openapi run-book example must
  be re-captured (the test law already forces that), and the generated client plus
  `web/lib/proof-contract.gen.ts` must be regenerated.

- **Should `shock_reach` be added to the existing `RunBookResponse` too?** OPEN,
  and probably unnecessary. That body already carries `applied_shocks` and
  `held_flat` in full, so a client can compute `marks_moved` itself. What it does
  not carry is the **arm**: nothing on the single body distinguishes "a projection
  ran no pass" from "the shock reached nothing", and `web/app/lab` derives neither
  today. A cheap additive middle ground is `shock_reach` minus its
  `applied_shocks` array (the counts, the arm and the note), about 200 B on a
  40 KB body. Recommend a following wave, after the set-run's arms have been
  exercised against real books.

- **Should the tornado deep link pin the batch?** RECOMMEND NO in 1.7.0, and it
  is a genuine trade. A pinned link reproduces exactly what the sender saw, which
  is desirable for sharing a finding, but it makes a live risk surface open on a
  stale book by default and it dies once retention prunes the batch. Recommend:
  the link names ids only, the page re-runs at the current batch, and `evaluation`
  plus the batch envelope make the difference visible and dated. Revisit if
  operators actually ask to share frozen views; it depends on Open Question 1
  shipping first.

- **Should the set-run offer `detail: "full"`?** RECOMMEND NO. Measured: 12 full
  bodies are 350,604 bytes, 15 extrapolate to about 440 KB, against an estimated
  33 to 42 KB for the summary shape, a 10 to 13 times difference for data a
  tornado does not plot. Two response shapes on one endpoint means two contract
  examples to capture, two schema sweeps and two sets of test laws, and the
  field's mere existence invites routine 440 KB fetches. Drill-down belongs to the
  single-scenario endpoint.

- **Should `RunBookEngine` gain the same zero-row treatment the set-run's
  `unmeasurable_engines` introduces, and the same movement denominator?** OPEN,
  and recommended for a following wave rather than this one. The all-zero engine
  row on an unmeasurable book is a standing D-013 hazard on `POST
  /v1/scenarios/{id}/run-book` today (`p5_runbook.go:570-576` beside
  `handlers.go:714`), and Test Law 14's negative control pins the current
  behaviour so the divergence is recorded rather than accidental. The movement
  denominator is a smaller and easier fix there, since the single body already
  serves `before.hf_histogram.infinite_count` beside `movers_total`; what it lacks
  is the exclusion count itself, which is not the same number. Closing either on
  the existing route is not additive in the same easy way: it changes what an
  existing required field means, and it needs its own example re-capture and its
  own client wave.

- **Per-scenario failure semantics: named refusal inside a 200, or
  all-or-nothing?** RECOMMEND ALL-OR-NOTHING, twice over, and therefore no
  per-scenario refusal register at all. Every current failure mode is either a
  request property knowable before compute (refuse the whole request, name every
  offender) or something the existing handler already classifies as a service
  defect (`p5_runbook.go:465-470` calls an `ApplyScenario` refusal "a defect in
  this layer, not a property of the data"; `Waterfall`, `ExecutionShortfall` and
  projection-delta failures are all `codeInternal`). Dressing a defect as a
  per-scenario refusal would let a broken deployment serve 14 bars and one apology.
  The cost is real (one bad id wastes 14 good evaluations) but it is paid before
  any compute, so it costs milliseconds. If experience later shows genuine
  per-scenario partial failures that are not defects, add a `scenario_refusals[]`
  array then, additively, and shrink the membership law from equality to
  `evaluated ⊎ refused`.

- **Is `max_inflight_set_runs = 2` the right default?** OPEN, and the one number
  here with no measurement behind it. Two bounds steady-state memory at roughly
  two reconstructed books while still absorbing a second operator, and it is
  operator-tunable and published on `/v1/meta` and on every `SetRunBusyBody`.
  Revisit with production concurrency data, not with argument.

- **Is `newest_is_older` reachable?** OPEN, deliberately. Retention prunes oldest
  first (`internal/store/risk.go:1416-1419`), which rules out the obvious route,
  but `riskBatchCompleteConjuncts` is re-evaluated live at probe time over child
  counts and the required stamp set, so completeness is not monotone in the way a
  reachability argument would need. The arm is shipped, sentenced and tested
  through a store seam because the alternative was an `otherwise` arm serving
  "Batch M has since materialized" about a batch older than the measurement.
  If a later pass proves unreachability, the arm becomes a defensive branch with a
  test that documents why, which is a strictly better resting place than an
  assumption.

---

## Cost notes

All figures measured on this machine against a local deployment (local Postgres,
`riskd` materializing concurrently), batch 5748 to 5759, 9,909 positions
(9,863 `debt_manager`, 46 `aave_v3_etherfi`, 1 refused; 9,908 reconstructable,
9,862 DM and 46 Aave). Noisy box, so brackets not points. **Every figure below is
labelled MEASURED, DERIVED or ESTIMATED, and no derived figure is presented as a
measurement.**

MEASURED, per-request latency (curl `time_total`, n=20 across the ids the
deployed binary served):

```
POST /v1/scenarios/{id}/run-book        1.04 - 1.91 s, median about 1.45 s
  dm_rate_horizon_plus_200bps (projection, no ApplyScenario pass)   1.04 - 1.62 s
  btc_leg_minus_20 (DM only, 1 shock)                               1.20 - 1.44 s
  eth_minus_30 (both engines, 1 shock)                              1.34 - 1.91 s
  dm_composition_census (DM only, 8 shocks)                         1.47 - 2.06 s
  weeth_market_depeg_oracles_held (both engines + shortfall)        1.52 - 1.60 s
GET /v1/meta    1.10 - 1.67 s   performs the SAME readBatch + reconstructAll
                                (cmd/api/meta.go:555) then only cheap queries
GET /v1/book    1.77 - 1.79 s
GET /v1/scenarios  0.0025 s     configuration, no batch read: the contrast that
                                isolates the read
```

DERIVED, cost decomposition. `/v1/meta` and run-book share the batch read and
reconstruction and differ only in the arithmetic; meta's floor (1.10 s) against
run-book's floor (1.04 s) puts the shared read at roughly 1.0 to 1.3 s. The
projection-versus-shock spread (1.04 to 1.62 against 1.34 to 1.91) prices one
explicit `ApplyScenario` pass over about 9.9k positions at roughly 0.25 to
0.30 s. A single measure (health walk plus one `Waterfall` over the same book) is
the remainder, roughly 0.05 to 0.20 s.

DERIVED, what a set-run amortizes, and what it does not:

```
readBatch + reconstructAll                              1.0 - 1.3 s    ONCE
shared BEFORE measure over the UNION book               0.05 - 0.20 s  ONCE
per scenario, over THAT SCENARIO'S OWN covered book:
  ApplyScenario pass + a full after-side measureRunBook
  (health walk + Waterfall over the same scoped book)
  + optional shortfall or projection                    0.30 - 0.50 s  x N
freshness probe (one statement)                         < 10 ms        once
serialization                                           < 40 ms        once
```

**The per-scenario scope is the scenario's own covered engines, not the union**
(section 3.7). At this book's shape that is worth under half a percent, because a
DM-only scenario walks 9,862 of the 9,908-position union and a both-engines
scenario walks all 9,908: Aave is 0.46 percent of this book. The bracket above and
everything derived from it therefore holds under either reading **here**, and is
**shape-specific**: on a book with a balanced engine mix a DM-only scenario would
pay proportionally less and the budget must be re-derived rather than carried.
An engine-mix change is a budget change.

N = 15: about 7.4 s. Plan on 6 to 11 s p50, 15 s p95.
Worst case at the cap, N = 24: about 13.4 s.
Shape B for the same 15: 15 x 1.45, about 22 s. MEASURED directly: a serial
sweep of the deployed set took 20.58 s wall.

**The saving is the read, the reconstruction and one before measure. It is not
the per-scenario term.** Each scenario still pays a `Waterfall` over its own book
on its after side (`p5_runbook.go:723`), so 24 scenarios is 24 such walks, each of
which is 99.5 to 100 percent of the union at this book's shape. The honest ratio
against shape B is about 2 to 3 times, plus atomicity, not 3 to 4 times.

MEASURED, payload. One full `RunBookResponse` (`eth_minus_30`, both engines) is
40,226 B. Composition: `collateral_by_asset` 14,496 B, `movers` 9,896 B,
histograms 6,302 B, `held_flat` 2,287 B, `out_of_model` 1,214 B, batch envelope
1,256 B, `applied_shocks` 966 B, notes and prose about 2,000 B. Of that,
`applied_shocks` is the one item a tornado must carry, because it is the only wire
carrier of `snapped`, `base_snapped` and `cap_bound`; `held_flat` is carried as a
count plus distinct addresses; the rest is drill-down. Twelve full bodies are
350,604 B; fifteen extrapolate to about 440 KB.

ESTIMATED, and only estimated, because the shape does not exist:
`SetRunEngineSummary` is 24 scalars plus a five-clause engine note, about 720 B;
`SetRunShockReach` about 400 B for a one-axis scenario and up to about 1.2 KB for
an eight-shock one; a two-engine one-axis result about 2.3 KB, a one-engine
one-axis result about 1.6 KB; fifteen mixed results plus envelope and per-engine
census about 33 to 42 KB. Ratio to shape B about 10 to 13 times. The increase over
an earlier 25 to 31 KB estimate is `shock_reach`, and it buys the difference
between "a 0.5 percent depeg does nothing to this book" and "the oracle pinned it
back to par before it reached this book".

MEMORY. The shared before measure holds one `states` map and per-asset collateral
maps for the union book for the life of the request, once rather than N times;
each after measure is transient and scoped to its scenario's own book. The large
allocation either way is `v.Positions` with legs and price inputs for 9,909 rows,
and a set-run holds exactly one copy where shape B allocates N. The per-request
cap bounds one request; the in-flight bound of section 6.2 is what bounds the
deployment.

MEASURED, batch cadence, and why it settles the question. Batch 5756
`computed_at` 20:34:04.909Z to batch 5759 `computed_at` 20:36:34.909Z is three
batches in 150.2 s, about one every 50 s (the design note in `matrixCells.ts`
says about 2 per minute). Against a roughly 21 s serial sweep that is a coin
flip: one sweep of 15 ids (23.9 s) spanned two batches, three scenarios measured
on one book and four on another; a second sweep (20.6 s) landed wholly on one.
Retention is 5,000 batches (`cmd/riskd/main.go:66`) and prunes oldest first
(`internal/store/risk.go:1416-1419`), so at that cadence a batch stays readable
about 69 hours: ample for shape B's pin, irrelevant to shape A, and the reason
`newest_is_older` is implausible rather than impossible.

SERVER LIMITS. No `WriteTimeout` and no `ReadTimeout` are set
(`cmd/api/main.go:605-613`, deliberate so SSE is not severed), so a 6 to 13 s
synchronous response is not cut off and nothing bounds concurrency;
`ReadHeaderTimeout` is 10 s and applies to request headers only.
`web/lib/runbook.ts` sets no fetch timeout. The rate limit is 20 rps and burst 40
per IP (`cmd/api/main.go:79-80`) and counts REQUESTS, which is why the N-token
charge and the in-flight bound are both required rather than either alone. The
limiter's `Retry-After` is `res.DelayFrom(now)` (`middleware.go:369-374`), a token
bucket refill instant, which is why it is served on the 429 and withheld from the
semaphore refusal.

CAVEAT ON THE MEASUREMENTS. They were taken against a binary that served 12 of
the 15 committed scenarios; `eth_minus_40`, `eth_minus_50` and `eth_minus_60`
404'd on it although all three are committed files loaded unconditionally by any
binary built from this tree. The latency and payload measurements stand, since
they are per-scenario. The before-side invariance observation covers 12 of 15 and
is corroboration only; the structural argument and Test Laws 2 and 3 are what
carry that claim. No `shock_reach` figure is measured, because the shape does not
exist; its `applied_shocks` component is measured, at 966 B on `eth_minus_30`.
