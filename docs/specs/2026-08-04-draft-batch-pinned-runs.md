# DRAFT - DEFECTIVE per adversarial verify; revision required before implementation

« CONTRACT 1.7.0 — BATCH-PINNED MULTI-SCENARIO EVALUATION (SET-RUN) »
Draft spec. Read-only research pass. Nothing in the repo was modified.

---

## 0. Decision

**Ship shape (A): a set-run endpoint, `POST /v1/scenarios/run-book-set`.**
**Do not ship shape (B) as the tornado mechanism.**

The decision is not aesthetic. Three measured facts settle it, all taken against the live deployment on this machine (batch 5748→5759, 9,909 positions: 9,863 `debt_manager` / 46 `aave_v3_etherfi`, 1 refused):

1. **The expensive work is the part (B) repeats and (A) does once.** `POST /v1/scenarios/{id}/run-book` served in 1.04–1.91 s (n=20, median ≈1.45 s). `GET /v1/meta`, which performs the *same* `s.readBatch(ctx, nil)` + `reconstructAll` and then only cheap queries, served in 1.10–1.67 s. The batch read and reconstruction are the dominant term; the per-scenario arithmetic is the minority. (B) pays the dominant term N times for no additional information.

2. **The BEFORE side is scenario-invariant at a fixed batch — measured, not argued.** I captured all 12 servable committed scenarios at batch 5759 and diffed their `before` aggregates: the `debt_manager` before-side is **byte-identical across all 12**, and the `aave_v3_etherfi` before-side is **byte-identical across all 5** scenarios that cover it. This is structural, not luck: `risk.Waterfall` accumulates strictly through `engineOf(m.engine, …)` (`internal/risk/waterfall.go` ~line 236) so no position contributes to another engine's row, and `measureRunBook`'s non-Waterfall walk (`cmd/api/p5_runbook.go:634`) is likewise per-position. A set-run may therefore compute the before-side **once over the whole reconstructable book and slice it per engine**, and get bytes identical to what N separate runs produce.

3. **A serial sweep genuinely straddles batches.** Two sweeps of the committed set were run. Sweep 1 (15 ids, 23.9 s wall) spanned **batches 5757 and 5758** — three scenarios measured against one book, four against another. Sweep 2 (20.6 s wall) happened to land wholly on 5759. Observed materialization interval over the window: batch 5756 `computed_at` 20:34:04.909Z → batch 5759 `computed_at` 20:36:34.909Z = 3 batches in 150.2 s ≈ one every 50 s, against a ~21 s serial sweep. It is a coin flip per sweep, which is exactly the condition the web's cohort machinery exists to refuse — and refusing it is not the same as being able to answer the question.

(B) leaves the cross-scenario sentence to be assembled client-side out of N independently-resolved responses. That assembly is the machinery of `web/app/lab/matrixCells.ts`, hardened across waves R8–R17 and still growing registers. (A) makes the sentence true **by the shape of the response** rather than by reconciliation: one batch, one census, one envelope, N results.

**Shape (B)'s `batch_id` field is still worth having, for drill-down only** — see Open Question 1. It is subordinate to (A), not an alternative to it.

---

## 1. What was read, and what it establishes

| Fact | Where | Consequence for this spec |
|---|---|---|
| The run-book resolves the batch per request, always the newest complete one | `cmd/api/p5_runbook.go:400` → `s.readBatch(r.Context(), nil)` → `cmd/api/read.go:321` `readBatchAccounts` → `store.NewestCompleteBatchQ` | Two POSTs may evaluate different books. There is no batch pin on this route today. |
| Resolution happens **inside** the read snapshot | `cmd/api/read.go:335–354` (wave H8) | A set-run inherits this for free: one `BeginRiskSnapshot`, one `SELECT now()`, one batch, one set of child rows. Nothing tears. |
| **Positions of a superseded batch remain readable** | `internal/store/p5_positions_page.go` — `PositionsPage` reads `risk_positions WHERE batch_id = $1` for an arbitrary pinned batch and refuses **only** when the batch row is gone (`ErrPositionsBatchMissing`, line 67; existence probe at line 364). `BatchStillNewestServable` (line 481) is a *separate* judgement from readability. `cmd/api/p5_batches.go` reads any retained batch header by id. | Verified: yes. A batch stays fully readable until retention prunes it. `defaultRetention = 5000` (`cmd/riskd/main.go:66`) at the observed ~50 s cadence ≈ **~69 hours** of readability. Shape (B) is therefore *implementable*; it is just not the right shape. |
| `riskBatchCompleteConjuncts` is a parameterless predicate over alias `b` | `internal/store/risk.go:1583` | A by-id complete-batch read is `WHERE b.id = $1 AND ` + the same fragment — the serving and adoption predicates cannot drift. This is what Open Question 1 needs. |
| The client already refuses cross-batch composition | `web/app/lab/matrixCells.ts` header (lines 18–25), `resolveBatchCohort` (line 1439), `anchorBatchOfPhase` (line 1214), `SUPERSEDED` cell state (line 2102) | The set-run does not delete this machinery; it makes the common case trivially satisfy it. The machinery still guards a single-row re-run landing at a newer batch. |
| Refuse-before-classify, and identity-joined-by-triple | `bookRefusal` (line 591), `definitionSkew` (line 550), `rowIdentity` (line 447) | **Hard wire requirement:** every per-scenario result must carry `scenario_id` + `scenario_version`, and the envelope must carry `scenario_config_version`, or `ScenarioIdentity` cannot be formed per row and R12's join breaks. |
| The committed set is 15 files (`internal/risk/scenarios/*.json`); the running binary serves 12 | `cmd/api/scenarios.go`, `s.byID` | N for the tornado is "the committed set", currently 15. `eth_minus_40/50/60` 404'd on the deployed binary — the id space is deployment-scoped, which is why atomicity must name unknown ids rather than silently drop them. |
| The 200 example is **captured, not written** | `cmd/api/p5_runbook_example_db_test.go` (wave W-EX-A/B/C) | The set-run example is subject to the same law and must be captured by an extension of that test. |
| The liquidatable-disclosure sweep walks every operation's every response | `cmd/api/contract_sweep_law_test.go`; `reclockNames = {batch_id, computed_at, bucket_start}` (line 101) | `Projection.becomes_liquidatable` (openapi line 2440) is liquidatable-family. A **per-scenario `batch_id` field would re-clock and void the envelope's license**, failing this test. The law itself forbids the thing the set-run must not do. |
| `readOnly` opens for exactly one POST path | `cmd/api/middleware.go:181` `readOnly`, `isRunBookPath` (line 198) | `/v1/scenarios/run-book-set` will 405 until the gate is widened. Must be an **exact-match** second predicate, not a family. |
| No handler in `cmd/api` reads a request body today | grep for `r.Body` / `json.NewDecoder`: zero non-test hits | The set-run is the first. Body-size bound and `DisallowUnknownFields` are new discipline that must be established here. |
| Rate limit 20 rps / burst 40 per IP | `cmd/api/main.go:80–81`, `middleware.go:392` | Cost-blind: it counts requests, not scenarios. A set-run is up to 24× a normal request. |
| No `WriteTimeout` on the server | `cmd/api/main.go:521–529` (deliberate, for SSE) | A 5–9 s synchronous response is not severed. `ReadHeaderTimeout` 10 s does not apply to the response. |

---

## 2. Wire shape

### 2.1 Endpoint

```
POST /v1/scenarios/run-book-set
Content-Type: application/json
```

Three path segments, so no collision with `POST /v1/scenarios/{id}/run-book` (four) or `GET /v1/scenarios` (two).

**Rejected alternative:** `/v1/scenarios/set/run-book`. It *would* satisfy the existing `isRunBookPath`, but `set` matches `^[a-z0-9_]{1,64}$` and is therefore a legal committed-scenario id. Reserving a word out of the id space is a trap that fires the day someone commits a scenario called `set`.

### 2.2 Request

```json
{
  "scenario_ids": ["eth_minus_10", "eth_minus_20", "eth_minus_30",
                   "weeth_rate_minus_5", "btc_leg_minus_20"]
}
```

| Field | Type | Semantics |
|---|---|---|
| `scenario_ids` | `string[]`, **required**, `minItems: 1`, `maxItems: 24`, `uniqueItems: true`, each `^[a-z0-9_]{1,64}$` | The committed ids to evaluate against **one** resolved batch. There is no implicit "all": a request whose meaning changes when the committed set grows is a request the client cannot reason about, and a shared link built on it would silently mean something different tomorrow. The client has `GET /v1/scenarios`; it names what it wants. |

Decoding discipline (new to this package):
- `http.MaxBytesReader` at **8 KiB**. 24 × 64 chars + JSON overhead is under 2 KiB; 8 KiB is generous and bounded.
- `json.Decoder` with **`DisallowUnknownFields`**. A client that sends `{"scenarios": [...]}` must be told the field name is wrong, not handed a 400 about an empty set — that 400 reads as "you asked for nothing," which is a different and false statement.
- A body that is not a JSON object, or absent entirely, is a 400 naming the required field.

`maxItems: 24` is a literal because a schema needs one. It sits above today's 15 with headroom and below `defaultRateBurst` 40 (see §6).

### 2.3 Response — `RunBookSetResponse`

```
served_at                 date-time     the resolving snapshot's DATABASE clock
batch                     Batch         ONE, shared. The batch every result was measured on.
evaluation                SetRunEvaluation   NEW. The freshness probe. See §5.
scenario_config_version   string        ONE, shared. The set's token.
requested_scenario_ids    string[]      echoed verbatim, in REQUEST order
results                   SetRunScenarioResult[]   one per requested id, in REQUEST order
excluded_engines          EngineRefusal[]  ONE, shared — withholding is a BATCH property
coverage                  BookCoverage     ONE, shared — a census of the BATCH
notes                     string[]
```

**`batch` is the only batch.** It is `batchEnvelope(v)` unchanged — id, `computed_at`, `age_seconds`, producer, status, counts, the full watermark vector with per-engine sweep stamps, and `supersession`. It is what licenses every liquidatable-family field beneath it under the contract sweep law, and it is what the client pins the whole cohort to.

**`excluded_engines` is shared and appears once.** A withheld engine is withheld on the batch, not on a scenario. Publishing it per scenario would invite a reader to think one scenario was refused an engine another got.

**`coverage` is shared and is about the batch, not about any run.** This is a real change from the single-scenario body and it must be stated on the wire, because today `coverage.in_book` is *scenario-scoped*: measured live at batch 5759, `eth_minus_30` served `in_book: 9908` and `btc_leg_minus_20` served `in_book: 9862`, because `coverage(v.Positions, len(beforeInputs), refused)` passes the *run's* size. In a set-run, `in_book` is the **whole reconstructable book** (9908) and "how much of it this scenario's model reached" moves to `results[].positions_in_run`. Two different questions that shared one field name; the set-run separates them.

### 2.4 `SetRunScenarioResult`

```
scenario_id          string      required — the identity triple, half 1
scenario_version     string      required — the identity triple, half 2
                                 (half 3, scenario_config_version, is on the envelope)
label                string
path_assumption      string
shocks               Shock[]     exact rationals, as everywhere
covered_engines      string[]    the definition's `engines`, echoed
withheld_engines     string[]    ⊆ covered_engines. NAMES ONLY; the code+detail
                                 for each is in the shared excluded_engines.
positions_in_run     integer     positions this scenario's model reached
engines              SetRunEngineSummary[]   one per covered, non-withheld engine
note                 string
```

**`covered_engines` + `withheld_engines` is the partition, published.** The web currently *derives* the hole (`isAllHoleBook`, `bookHoleEngines`) by joining a served body against a listing it holds in the browser. Publishing both sides makes the partition checkable **on the wire**:

> `sort(engines[].engine ++ withheld_engines) == sort(covered_engines)`, and the two are disjoint.

That is the hole class closed at the source. The client keeps its own join anyway (it must — the reader sees the *listing's* coverage), but now a server that violates the partition is caught by a test rather than by a cell rendering UNANSWERED.

`out_of_model` is **deliberately absent** from the result. It is ~1.2 KB per scenario and it is already published, verbatim and versioned, on `GET /v1/scenarios` — which the client necessarily already has, since that is where it got the ids. The identity triple makes that join exact. A set-level note says so, and says why reading a shocked number without it is reading it wrong.

### 2.5 `SetRunEngineSummary` — and why it is not "the three deltas"

The tornado needs three numbers per (scenario, engine): eligible-debt delta, bad-debt delta, net eligible-accounts change. **Serving only those three is a D-013 defect**, and the summary shape is defensible only because it does not.

```
engine                          string
usd_decimals                    integer   THIS engine's unit. Never a shared one.

accounts                        integer   positions of this engine in the run (before == after)
refused_positions               integer   covered-engine positions this layer could not rebuild.
                                          Counted on BOTH sides, exactly as today.

before_eligible_accounts        integer
after_eligible_accounts         integer
eligible_accounts_delta         integer   NET: after − before. May be negative.
flipped_to_eligible             integer   flips false→true ONLY. NOT the net.

before_eligible_debt_usd        Decimal
eligible_debt_delta_usd         Decimal   DELTA-ONLY. May be negative.
before_bad_debt_usd             Decimal
bad_debt_delta_usd              Decimal   DELTA-ONLY. May be negative.

before_collateral_at_risk_usd   Decimal
after_collateral_at_risk_usd    Decimal   before/after, NOT a delta — see note below

total_debt_usd                  Decimal   the engine's whole debt in the run: the DENOMINATOR
total_collateral_usd_before     Decimal
total_collateral_usd_after      Decimal   collateral moves under a price shock

market_realization              Shortfall | null    MANDATORY when the scenario has one
projection                      Projection | null   MANDATORY when the scenario has one
note                            string
```

Four of these fields exist because of the D-013 bar, and each closes a specific wrong reading:

- **`before_*` beside every delta.** `bad_debt_delta_usd: "0"` is read as "this scenario adds no bad debt." True. It is *also* read as "there is no bad debt," which is false whenever `before_bad_debt_usd` is nonzero. At batch 5759 `eth_minus_30` on `debt_manager`, `bad_debt_delta_usd` is `"0"` while `before_bad_debt_usd` is `"46"` — a delta of zero over a base that is not zero. A delta without its base is a number read wrong.

- **`total_debt_usd`.** `eligible_debt_delta_usd: "350874918026"` (6-dec) is $350,874.92. Large or small? Against `total_debt_usd: "22750497440865"` it is **1.54 %** of the engine's book. Without the denominator the bar has a length and no meaning, and a tornado is precisely a chart of bar lengths.

- **`flipped_to_eligible` beside `eligible_accounts_delta`.** The net is what the tornado plots; the net is also what hides churn. Five accounts flipping in and five flipping out is a net of 0 and is not "nothing happened." This is `movers_total` on the full body, whose own note already says: *"`movers_total` counts flips to eligible ONLY, so it is not `newly_eligible_accounts`, which is a NET count and also subtracts any flip back to healthy."* The summary must not lose that distinction.

- **`market_realization` and `projection` are mandatory, not optional decoration.** `weeth_market_depeg_oracles_held` moves no oracle mark: its three deltas are all `"0"` by construction, and its entire information content is `execution_shortfall_usd` / `bad_debt_at_liquidation_usd`. `dm_rate_horizon_plus_200bps` is a projection: same, its after-side *is* its before-side. A summary that dropped these would render both scenarios as three zero-length bars, and a reader would conclude they are harmless. That is the "an unknowable never renders as zero" law violated in its most expensive form: not an unknowable rendered as zero, but a *known and serious* result rendered as zero.

`before_collateral_at_risk_usd` / `after_collateral_at_risk_usd` are served **as two sides, never as a delta**, because `WaterfallSeries`'s own doc comment (`internal/risk/waterfall.go:127–133`) states that collateral-at-risk carries **no monotonicity invariant** — it legitimately falls when already-crossed accounts are worth less. A delta on that axis is not a ranking key and must not be offered as one. The engine `note` says so.

### 2.6 `SetRunEvaluation`

```
batch_id                    int64        == batch.id, restated so this block reads alone
resolved_at                 date-time    == served_at. The snapshot instant the batch was
                                         resolved at, before any arithmetic.
probed_at                   date-time    the DATABASE clock read AFTER the arithmetic,
                                         in the freshness probe.
scenarios_evaluated         integer      == len(results)
still_newest_servable       boolean      was batch_id still the newest complete servable
                                         batch at probed_at
newest_servable_batch_id    int64 | null null in the race where nothing is servable at
                                         probe time — never 0, never batch_id
note                        string
```

---

## 3. Endpoint behavior

1. **Method gate.** `readOnly` gains a second exact-match predicate:
   `isRunBookSetPath(p) { return p == "/v1/scenarios/run-book-set" }`. Exact match, not a prefix family — the existing comment's discipline ("the gate opens for exactly the one computed route, not for a path family") carried forward. The 405 message must be widened to name both POSTs.

2. **Request validation, all of it, before any compute.** Decode → shape → membership. See §4.

3. **One resolution.** `s.readBatch(ctx, nil)` exactly as today — one `BeginRiskSnapshot`, one `SELECT now()`, `NewestCompleteBatchQ` inside it, all child rows, `reconstructAll` after the snapshot releases. `served_at = v.Now`. **This happens once for the whole request.**

4. **One BEFORE measure.** `measureRunBook(allReconstructableInputs)` over the whole book, once. Sliced per engine for each scenario. Justified structurally (per-engine accumulation in `Waterfall` and in `measureRunBook`) and confirmed empirically (byte-identical before-sides across 12 scenarios at batch 5759). `refusedByEngine` is still computed **per scenario**, because "covered" is a per-scenario predicate.

5. **Per scenario, in request order:** filter the run to covered, non-withheld engines; `risk.ApplyScenario` per position (skipped for a projection scenario, whose after-side *is* its before-side); one AFTER `measureRunBook`; `risk.ExecutionShortfall` if the scenario declares market realizations; `runBookProjection` if it declares a projection. Reduce to the summary.

6. **One freshness probe.** `store.BatchStillNewestServable(ctx, v.Batch.ID)` plus a `SELECT now()`. Two cheap queries, milliseconds. Fills `evaluation`.

7. **Determinism.** `results` is in **request order**, not sorted — the client asked in an order and gets its answer back in it, and the tornado's row order is the client's to choose. Within a result, `engines` is sorted by engine name (as today). Two set-runs with the same body against the same batch serve **byte-identical** responses modulo `served_at` / `probed_at` / `age_seconds`.

8. **Writes nothing.** `TestAPIIssuesNoWritingSQL` already sweeps this package and covers the new file automatically.

---

## 4. Refusal semantics

### 4.1 The rule: **all-or-nothing, both times, and there is no per-scenario refusal register**

Every way a scenario can fail today falls into exactly one of two classes, and neither belongs inside a 200.

**Class 1 — a property of the REQUEST, knowable before any compute.** An id that is not in the committed set; a duplicate id; an empty or over-cap array; an id that fails the pattern. The client got its ids from `GET /v1/scenarios`; an id this deployment does not know means the client's set and the deployment's set have diverged. Serving 14 of 15 under a shared envelope while dropping one is the silent-hole class the whole surface is built to refuse — the reader would see 14 bars and no statement that a 15th was asked for. **Refuse the whole request, before any compute, naming every offending id.**

**Class 2 — a SERVICE DEFECT.** Look at what the current handler already calls these: `ApplyScenario` refusing is *"a defect in this layer, not a property of the data"* (`p5_runbook.go:466`); a `Waterfall` refusal, an `ExecutionShortfall` refusal and an unparseable committed projection delta are all `codeInternal`. Dressing one of those as a polite per-scenario refusal inside a 200 would let a broken deployment serve 14 bars and one apology, and the reader would take "this scenario is unavailable" for a property of the scenario when the truth is that the service is broken. **Refuse the whole request: 500.**

So: **no `scenario_refusals[]` array, and no partial 200.** In a 200, `requested_scenario_ids` and `results[].scenario_id` are the *same multiset*, and that is the strongest partition law available — one line to check, impossible to satisfy while hiding a hole.

What *does* live inside the 200 is the class that is **not a failure**:
- an engine **not covered** by a scenario's definition — a property of the definition, absent from `covered_engines`, named in the result's `note` exactly as today;
- an engine **withheld on the batch** — in `withheld_engines` and in the shared `excluded_engines`, contributing no row and no zero;
- a scenario **all of whose covered engines are withheld** — `engines: []`, `withheld_engines` = `covered_engines`. It is *evaluated*, it counts in `scenarios_evaluated`, and it draws **no bar and says why**. Not a zero bar.

### 4.2 Server-side register (wire)

| Status | Code | When | Body |
|---|---|---|---|
| 400 | `bad_request` | body absent / not an object / over 8 KiB / unknown field | `ErrorBody`, naming the field |
| 400 | `bad_request` | `scenario_ids` missing or empty | `ErrorBody`: *"…there is no implicit 'all': name the ids you want, from `GET /v1/scenarios`"* |
| 400 | `bad_request` | duplicate ids | `ErrorBody` naming **every** repeated id. A set is a set; a repeat doubles the cost and breaks the partition. |
| 400 | `bad_request` | more than 24 ids | `ErrorBody` naming the bound and the count received |
| 400 | `bad_request` | an id fails `^[a-z0-9_]{1,64}$` | `ErrorBody` naming **every** malformed id |
| 404 | `not_found` | one or more ids are not committed **here** | `ErrorBody` naming **every** unknown id: *"…this endpoint evaluates the COMMITTED scenario set only. Unknown here: a, b. The whole set is refused rather than partly served: a comparison missing a member it was asked for is not the comparison that was asked for."* |
| 429 | `rate_limited` | the N-token charge exceeded the bucket | `ErrorBody` + `Retry-After`, message naming the cost: *"this request costs N tokens, one per scenario"* |
| 503 | `unavailable` | no complete servable batch | `ErrorBody` + `Retry-After`, unchanged register |
| 500 | `internal` | any arithmetic refusal, anywhere in the set | `ErrorBody`. **No partial body.** |

**No new error code constant.** The `ErrorBody.code` enum (`bad_request, not_found, rate_limited, unavailable, internal`) is untouched, and no `batch_superseded`-style second body type is needed — the set-run has no cursor to invalidate.

### 4.3 Client-side register additions (`web/app/lab/`)

Following R12's precedent exactly: **validate the body against itself before classifying anything.**

| Register | Trigger | Consequence |
|---|---|---|
| **`CONTRADICTORY SET`** | a `scenario_id` appears twice in `results[]`; a result's id was not in `requested_scenario_ids`; a requested id has no result | The body answers the set two ways, or fails to answer it. **No cell, no pin, no cohort, no anchor movement — for every row the set covers.** Refused whole, like `bookContradiction`, and deliberately *not* borrowing that register's sentence: "a book named nobody" is a false account of a *set* that named somebody twice. |
| **`CONTRADICTORY BOOK`** (existing, per result) | `engines[].engine` ∩ `withheld_engines` ≠ ∅, or a repeat within either | The existing R12 rule, applied per result. One result contradicting itself refuses **that result only** — it is a statement about one scenario's answer, not about the set's membership. |
| **`COVERAGE SKEW`** *(new)* | a result's served `covered_engines` disagrees with the listing's `engines` for that id **while the identity triple agrees** | A contract violation: the definition changed without its `version` moving. It must not be silently reconciled in either direction. Row refused, named. See Invariant 14 and Test Law 12 — the server-side law that makes this unreachable. |
| **`DEFINITION CHANGED`** (existing) | the identity triple on a result disagrees with the listing | Unchanged. `servedIdentity` reads `scenario_id` + `scenario_version` off the result and `scenario_config_version` off the envelope. |
| Header disclosure, **not a cell state** | `evaluation.still_newest_servable === false` | Every cell in the set is equally affected; a per-cell state would repeat one fact thirty times. One header clause naming both batch ids, with a re-run affordance. |

---

## 5. Supersession mid-run

The batch is resolved once, at the start, inside a snapshot. Over the 5–9 s of arithmetic a newer batch will often land — at the observed ~50 s cadence, roughly one time in six to one in eight.

**Nothing is torn, and that is provable rather than hoped.** `readBatchAccounts` resolves the batch and reads every child row inside one `BeginRiskSnapshot` (wave H8, `read.go:322–336`), so a materialization landing afterward is invisible to every row already in memory. The arithmetic runs on that in-memory book. The result is **internally consistent**: every scenario measured the same positions of the same batch at the same instant. Cross-scenario comparison is exactly as valid as it would have been had nothing landed.

**What the envelope must disclose, and what it must not claim.**

- `batch.supersession` **does not answer this question** and must not be read as if it did. It is the design-spec §4 reorg posture — acked-epoch moved, last-block rewound, unacked epoch — evaluated against a live cursor read *inside the resolving snapshot*. It is about rewinds, not about a newer materialization. Its own note already says a superseded batch is still served.

- `evaluation.still_newest_servable` is the new fact, and it is a **disclosure about the instant the response was composed**, never a promise about now. The note must say so in those words: *"measured at `probed_at`. A batch can be superseded a millisecond later; this is what was true when this response was built, not a claim about the reader's present."*

- `still_newest_servable: false` is **not a refusal, not a degradation, and not a reason to withhold anything.** The numbers describe batch N. They are a real measurement of a real book. The note must say the two things that are both true and that a reader will otherwise conflate:

  > *"Every scenario in this response was evaluated against batch N, resolved once at `resolved_at`. The comparison across scenarios is therefore exact and cross-scenario reading is sound. A newer batch has since materialized: these numbers describe batch N and not the current head of the book."*

- `newest_servable_batch_id` is **null, never 0 and never `batch_id`**, in the race where nothing is servable at probe time — the same shape and the same reason as `BatchSupersededBody.current_batch_id`.

**A superseded batch is never re-resolved mid-flight and the result is never discarded.** Discarding and retrying would make the endpoint's latency unbounded under load and would throw away a correct measurement because the world moved — which is what the whole surface refuses to do elsewhere (R8: *"a run that could not answer says nothing about the answer already held"*).

---

## 6. Latency, size, rate limiting

### 6.1 Budget for N = 15

All figures measured on this machine against the live deployment (Windows, local Postgres, `riskd` materializing concurrently — a noisy box, so brackets rather than points).

| Term | Cost | Paid |
|---|---|---|
| `readBatch` + `reconstructAll` over 9,909 positions | **1.0–1.3 s** | **once** |
| shared BEFORE measure (health walk + one identity `Waterfall`) | **0.05–0.20 s** | **once** |
| per scenario: `ApplyScenario` pass + AFTER measure (+ shortfall / projection) | **0.25–0.45 s** | **× N** |
| freshness probe (2 queries) | < 10 ms | once |
| serialization (~21 KB) | < 20 ms | once |

**N = 15: ≈ 1.2 + 0.15 + 15 × 0.35 ≈ 6.5 s.** Budget it as **5–9 s p50, 12 s p95** on a loaded box.

**Compared with N sequential single-scenario POSTs: 15 × 1.45 ≈ 22 s** (measured: 12 real POSTs = 19.9 s of the 20.6 s sweep), **and** with a coin-flip chance of straddling a batch. The set-run is ~3–4× faster *and* atomic.

### 6.2 No cap-by-async, but a cap

**No async pattern.** There is no job queue in this product, and inventing one to serve a 6-second computation would be new durable state on a service whose entire posture is that it writes nothing (`TestAPIIssuesNoWritingSQL`, the SELECT-only role in production). A job queue means a job table, a job id, a poll endpoint, a retention policy for job results, and a new class of "your job expired" refusal — all to save ~6 s of an already-explicit, user-initiated action. The server has **no `WriteTimeout`** (`main.go:521–529`, deliberate, for SSE), so a 9-second response is not severed.

**But a cap, for two reasons.** `maxItems: 24` bounds the worst case at ~1.2 + 24 × 0.45 ≈ 12 s, and it bounds the memory: the shared before-measure holds a `states` map and per-asset collateral maps for ~9.9 k positions for the life of the request (once, not N times), while each after-measure is transient.

### 6.3 Rate limiting: charge N tokens, not one

The existing limiter (20 rps, burst 40, per IP, `x/time/rate`) counts **requests**. A set-run is up to 24× the cost of a normal request, so a cost-blind limiter would let one client turn burst-40 into 960 scenario-evaluations ≈ 350 s of CPU.

**Charge one token per scenario** — `limiter.AllowN(now, len(scenario_ids))`. This needs no new refusal register: the 429 is the existing `rate_limited`, which `web/lib/runbook.ts` already maps to `{kind: "rate-limited", retryAfterSeconds}` and `unansweredReason` already renders honestly. The message names the cost so a reader is not puzzled by a first request being refused:

> *"rate limit exceeded: this surface admits 20 requests per second per client address, burst 40, and a set-run costs one token per scenario — this request asked for 15."*

**Config invariant, checked at startup, fail-fast:** `rate_burst >= max_set_run_scenarios`. With defaults (40 ≥ 24) it holds; an operator who lowers `SOLVENT_API_RATE_BURST` below the cap must be told at boot rather than discovering that a legal request is permanently unservable. And `/v1/meta`'s `constants` block — which already publishes `rate_limit_rps` and `rate_limit_burst` as *"a POLICY OF THIS DEPLOYMENT"* — gains `max_set_run_scenarios` and `set_run_token_cost_per_scenario`, additively, so the policy is discoverable rather than folklore.

**Rejected:** a per-process in-flight semaphore with its own 503. It needs a new refusal body (503 `unavailable` would be mapped by the web client to `{kind: "no-batch"}` and rendered as *"no servable batch"* — a flatly false statement about the book), for a guard the token charge already provides. Not in 1.7.0.

### 6.4 Payload: summary, not full bodies

Measured, at batch 5759:

| | bytes |
|---|---|
| one full `RunBookResponse` (`eth_minus_30`, 2 engines) | **40,226** |
| 12 full bodies (the servable committed set) | **350,604** |
| 15 full bodies, extrapolated | **≈ 440 KB** |
| one purpose-built `SetRunScenarioResult` | **≈ 1.1–1.3 KB** |
| 15 results + shared envelope + census | **≈ 18–21 KB** |

Composition of the 40 KB body: `collateral_by_asset` 14,496 B (both sides, both engines — 19 DM assets × 2), `movers` 9,896 B, histograms 6,302 B, `held_flat` 2,287 B, `out_of_model` 1,214 B, the batch envelope 1,256 B, notes and prose ~2,000 B. **None of it is what a tornado plots.** A tornado that ships 440 KB to draw 90 numbers has bought the reader nothing and cost them a second of transfer and parse.

**Decision: summary only. No `detail: "full"` mode in 1.7.0.** Two response shapes on one endpoint means two contract examples to capture, two schemas to sweep, two sets of test laws — and it invites a client to fetch 440 KB routinely because the field is there. Drill-down is the single-scenario endpoint's job; Open Question 1 is what makes that drill-down *comparable* to the bar it came from.

---

## 7. Worked example

The values below are **real**: they are the projection of two bodies this deployment actually served, `eth_minus_30` and `btc_leg_minus_20`, both at batch 5759, captured in the sweep described in §0. Their `debt_manager` before-sides were byte-identical, which is why one shared before-measure produces them both.

The contract's example, however, must be **captured, not written** — that is wave W-EX-A's standing law and it extends to this endpoint (Test Law 1). What follows is the spec's illustration; the openapi example will be whatever `TestRunBookSetExampleIsTheServedBody` captures over the seeded fixture.

### Request

```json
{ "scenario_ids": ["eth_minus_30", "btc_leg_minus_20"] }
```

### Response (200)

```json
{
  "served_at": "2026-08-04T20:37:28.908991Z",
  "batch": {
    "id": 5759,
    "computed_at": "2026-08-04T20:36:34.908945Z",
    "age_seconds": 54,
    "producer": "riskd",
    "status": "complete",
    "position_count": 9909,
    "refused_count": 1,
    "refused_engines": [],
    "flagged_count": 30,
    "watermarks": [ "… the batch's own five-engine vector, verbatim: aave_param, aave_v3_etherfi, debt_manager, prices:poll:1, prices:poll:10, each with its sweep stamp …" ],
    "supersession": {
      "superseded": false,
      "legs": [],
      "note": "a superseded batch is still served: the flag is the contract and it heals at the next materializer pass (design spec §4). The legs are evaluated against a LIVE read of the cursor and epoch tables inside the same snapshot as the database clock."
    }
  },
  "evaluation": {
    "batch_id": 5759,
    "resolved_at": "2026-08-04T20:37:28.908991Z",
    "probed_at": "2026-08-04T20:37:31.104772Z",
    "scenarios_evaluated": 2,
    "still_newest_servable": true,
    "newest_servable_batch_id": 5759,
    "note": "every scenario in this response was evaluated against batch 5759, resolved ONCE at `resolved_at` and read inside one database snapshot. The comparison ACROSS scenarios is therefore exact. `still_newest_servable` was measured at `probed_at`, after the arithmetic: it is what was true when this response was built, never a promise about the reader's present."
  },
  "scenario_config_version": "v1",
  "requested_scenario_ids": ["eth_minus_30", "btc_leg_minus_20"],
  "results": [
    {
      "scenario_id": "eth_minus_30",
      "scenario_version": "v1",
      "label": "ETH -30 percent",
      "path_assumption": "instantaneous mark move; no oracle lag modeled",
      "shocks": [{ "axis": "eth_usd", "factor_num": 70, "factor_den": 100 }],
      "covered_engines": ["aave_v3_etherfi", "debt_manager"],
      "withheld_engines": [],
      "positions_in_run": 9908,
      "engines": [
        {
          "engine": "aave_v3_etherfi",
          "usd_decimals": 8,
          "accounts": 46,
          "refused_positions": 0,
          "before_eligible_accounts": 3,
          "after_eligible_accounts": 3,
          "eligible_accounts_delta": 0,
          "flipped_to_eligible": 12,
          "before_eligible_debt_usd": "33803989",
          "eligible_debt_delta_usd": "0",
          "before_bad_debt_usd": "7326344",
          "bad_debt_delta_usd": "7943293",
          "before_collateral_at_risk_usd": "28066305",
          "after_collateral_at_risk_usd": "19646414",
          "total_debt_usd": "282356679893",
          "total_collateral_usd_before": "819148540820",
          "total_collateral_usd_after": "573403978573",
          "market_realization": null,
          "projection": null,
          "note": "delta-only: after minus before over the positions in the run, in this engine's own 8-decimal unit. `before_*` is published beside every delta because a delta without its base is a number read wrong. `flipped_to_eligible` counts flips false→true ONLY and is NOT `eligible_accounts_delta`, which is a NET count that also subtracts flips back to healthy. `collateral_at_risk` is served as two SIDES and never as a delta: it carries no monotonicity invariant and is not a ranking key."
        },
        {
          "engine": "debt_manager",
          "usd_decimals": 6,
          "accounts": 9862,
          "refused_positions": 1,
          "before_eligible_accounts": 46,
          "after_eligible_accounts": 214,
          "eligible_accounts_delta": 168,
          "flipped_to_eligible": 168,
          "before_eligible_debt_usd": "46",
          "eligible_debt_delta_usd": "350874918026",
          "before_bad_debt_usd": "46",
          "bad_debt_delta_usd": "0",
          "before_collateral_at_risk_usd": "2",
          "after_collateral_at_risk_usd": "365330121673",
          "total_debt_usd": "22750497440865",
          "total_collateral_usd_before": "104099052983102",
          "total_collateral_usd_after": "89374390555696",
          "market_realization": null,
          "projection": null,
          "note": "delta-only: after minus before over the positions in the run, in this engine's own 6-decimal unit. …"
        }
      ],
      "note": "every engine this scenario's committed definition covers is answered here or named in `withheld_engines`; the two sets partition `covered_engines` exactly."
    },
    {
      "scenario_id": "btc_leg_minus_20",
      "scenario_version": "v1",
      "label": "BTC leg -20 percent (liquidBTC, eBTC)",
      "path_assumption": "instantaneous mark move; no oracle lag modeled",
      "shocks": [{ "axis": "asset_usd", "asset": "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599", "factor_num": 80, "factor_den": 100 }],
      "covered_engines": ["debt_manager"],
      "withheld_engines": [],
      "positions_in_run": 9862,
      "engines": [
        {
          "engine": "debt_manager",
          "usd_decimals": 6,
          "accounts": 9862,
          "refused_positions": 1,
          "before_eligible_accounts": 46,
          "after_eligible_accounts": 51,
          "eligible_accounts_delta": 5,
          "flipped_to_eligible": 5,
          "before_eligible_debt_usd": "46",
          "eligible_debt_delta_usd": "1592067466",
          "before_bad_debt_usd": "46",
          "bad_debt_delta_usd": "0",
          "before_collateral_at_risk_usd": "2",
          "after_collateral_at_risk_usd": "1670350715",
          "total_debt_usd": "22750497440865",
          "total_collateral_usd_before": "104099052983102",
          "total_collateral_usd_after": "103260002097631",
          "market_realization": null,
          "projection": null,
          "note": "delta-only …"
        }
      ],
      "note": "aave_v3_etherfi is outside this scenario's committed model and contributes no row: a property of the DEFINITION, not withholding. Withheld engines are in `withheld_engines` and in the response's `excluded_engines`."
    }
  ],
  "excluded_engines": [],
  "coverage": {
    "batch_positions": 9909,
    "in_book": 9908,
    "refused_in_batch": 1,
    "excluded_by_this_layer": 0,
    "excluded": [],
    "withheld_engines": [],
    "stress_coverage_is_full": true,
    "note": "this census is about the BATCH, not about any one run: `in_book` is every position of batch 5759 this layer could rebuild, whatever any scenario's model reaches. How much of it each scenario reached is `results[].positions_in_run`."
  },
  "notes": [
    "every result here was evaluated against ONE batch, resolved once. That is what makes reading them against each other legitimate; two separate POSTs to /v1/scenarios/{id}/run-book carry no such guarantee and must never be compared.",
    "aggregates are per engine in each engine's OWN unit and decimals; they are never summed across engines, and there is no cross-engine total anywhere in this response.",
    "deltas are DELTA-ONLY: after minus before, the scenario's own contribution over the positions in its run. Each is published beside the BEFORE value it is a delta of, and beside `total_debt_usd`, because a delta with no base and no denominator is a number read wrong.",
    "a scenario whose deltas are all zero is not a harmless scenario: a market-realization scenario moves no oracle mark by construction and carries its whole result in `market_realization`, and a rate scenario carries its whole result in `projection`. Both are served here and neither may be rendered as a zero.",
    "`out_of_model` is NOT republished here. It is part of each committed definition and is served, versioned, by GET /v1/scenarios — join on (`scenario_id`, `scenario_version`, `scenario_config_version`). A shocked number read without it is a number read wrong.",
    "this response is a SUMMARY. Histograms, per-asset collateral and the moved accounts are on POST /v1/scenarios/{id}/run-book, which resolves its own batch — so a drill-down taken later may be measured on a different book, and its envelope will say so."
  ]
}
```

### Refusal example (404) — the whole set, naming every unknown id

```json
{
  "error": {
    "code": "not_found",
    "message": "no committed scenario \"eth_minus_40\", \"eth_minus_50\": this endpoint evaluates the COMMITTED scenario set only (the same set GET /v1/scenarios publishes and /v1/address/{addr}/stress serves), never arbitrary user scenarios. The WHOLE set is refused rather than partly served: a comparison missing a member it was asked for is not the comparison that was asked for, and serving the rest under a shared envelope would leave the absence unnamed."
  }
}
```

*(This refusal is realizable today: the running binary serves 12 of the 15 committed scenario files, and `eth_minus_40/50/60` 404 on it.)*

---

## 8. Test laws

1. **`TestRunBookSetExampleIsTheServedBody`** — the contract's 200 example is **captured**, not written. Seed the `p5_runbook_example_db_test.go` fixture (batch id 1, four positions, two refused, one flagged), run the real handler for a real committed id set, assert the openapi example **is** that body, byte for byte, modulo exactly six serve-time fields: `served_at`, `batch.computed_at`, `batch.age_seconds`, `batch.watermarks[].sweep.age_seconds`, `evaluation.resolved_at`, `evaluation.probed_at`. `evaluation.batch_id` is **not** normalized (it is the fixture's id). Carry over W-EX-B's derivation rule (ages are arithmetic over anchors, never literals) and W-EX-C's two outside readings (`requireRawStampsAreThePersistedOnes`, `requireServedAtWithinDBClock`), plus a new one: `resolved_at <= probed_at`, both inside the request's DB-clock bracket.

2. **`TestSetRunEqualsNSingleRunsAtTheSameBatch`** — the equivalence law, and the one that makes the shared-BEFORE optimization safe. Seed one batch; call the set endpoint for `{A, B}`; call the single endpoint for `A` and for `B`. For every (scenario, engine), assert the set's summary fields are **byte-identical** to the corresponding fields of the single body (`before.eligible_accounts` → `before_eligible_accounts`, `eligible_debt_delta_usd` → `eligible_debt_delta_usd`, `movers_total` → `flipped_to_eligible`, and so on for all sixteen). No materializer runs in the fixture, so the batch cannot move between calls. **If slicing the shared before-measure ever diverges from a per-scenario filtered measure, this is the test that fails.**

3. **`TestSetRunBeforeSideIsScenarioInvariant`** — the direct statement of the property the optimization rests on. Over one seeded batch, assert every result's per-engine `before_*` / `total_*` fields are equal across **all** scenarios covering that engine. (Confirmed empirically today: identical across 12/12 for `debt_manager`, 5/5 for `aave_v3_etherfi`, at batch 5759.)

4. **`TestSetRunCountsPartitionExactly`** — (a) `sorted(results[].scenario_id) == sorted(requested_scenario_ids)`, as multisets, in every 200; (b) `len(results) == evaluation.scenarios_evaluated`; (c) per result, `sort(engines[].engine ++ withheld_engines) == sort(covered_engines)` and the two are disjoint; (d) per result, `positions_in_run == Σ engines[].accounts`; (e) `coverage.batch_positions == coverage.in_book + coverage.refused_in_batch + coverage.excluded_by_this_layer`.

5. **`TestSetRunIsAtomicOnAnUnknownId`** — a set containing one uncommitted id answers **404**, the body names **every** unknown id, no partial body is served, and **no compute happened** (assert via a handler-level counter seam, or by asserting the response arrives in well under the read time).

6. **`TestSetRunRefusesDuplicatesAndOverCap`** — duplicate ids → 400 naming every repeat; 25 ids → 400 naming the bound and the count; empty array → 400 stating there is no implicit "all"; unknown JSON field → 400 naming the field (not a 400 about an empty set).

7. **`TestSetRunSupersessionMidComputeDisclosesAndDoesNotTear`** — the most important new test. Using the existing `bookInterleave` seam pattern (`cmd/api/read.go:371`, `book_prune_race_db_test.go`): seed batch N, arm the seam to write batch N+1 after the snapshot is established, run the set. Assert (a) every result carries `batch.id == N`, (b) the numbers equal a set-run over batch N alone — nothing leaked, (c) `evaluation.still_newest_servable == false`, (d) `evaluation.newest_servable_batch_id == N+1`, (e) the response is still **200** — supersession mid-run is a disclosure, never a refusal.

8. **`TestSetRunFreshnessProbeRaceServesNull`** — with the resolved batch pruned and nothing servable at probe time, `newest_servable_batch_id` is **`null`**, never `0` and never `batch_id`.

9. **`TestSetRunNeverSumsAcrossEngines`** — a contract sweep in the shape of `contract_sweep_law_test.go`: walk the `RunBookSetResponse` root; assert **every** `Decimal`/`NullableDecimal`-typed property is reachable only through a node that requires `usd_decimals`. No hand-maintained list of field names. This is the law that keeps a "total impact" bar from ever growing on the tornado.

10. **`TestSetRunHasNoFloats`** — same walk: no `type: number` anywhere under the set-run roots; every money field is `Decimal` or `NullableDecimal`.

11. **`TestSetRunNeverReClocks`** — no schema under the set-run roots requires `batch_id`, `computed_at` or `bucket_start` **below** the envelope. Asserted directly here *and* enforced structurally by the existing liquidatable-disclosure sweep, which will fail on `Projection.becomes_liquidatable` the day a per-scenario `batch_id` appears and voids the envelope's license.

12. **`TestCommittedScenarioVersionMovesWithItsEngines`** — a law over `internal/risk/scenarios/*.json` and a checked-in golden of `(id, version) → sorted(engines)`. If a scenario's `engines` set changes, its `version` must change. This is what makes the client's identity join sound and makes the `COVERAGE SKEW` register unreachable in a correct deployment.

13. **`TestSetRunWithheldEngineIsNamedAndNotZeroed`** — seed a withheld engine; set-run a scenario covering it; assert it appears in `withheld_engines` and in `excluded_engines`, appears **nowhere** in `engines[]`, and that a scenario covering *only* withheld engines returns `engines: []` while still counting in `scenarios_evaluated`.

14. **`TestSetRunTokenChargeIsPerScenario`** — a burst-40 bucket admits two 15-scenario set-runs and refuses the third with 429 + `Retry-After`, message naming the per-scenario cost. Plus a startup assertion that `rate_burst >= max_set_run_scenarios`.

15. **`TestSetRunResultsAreInRequestOrder`** and **`TestSetRunIsByteDeterministic`** — two identical requests against one seeded batch produce identical bytes modulo the three clock fields.

16. **`TestReadOnlyGateAdmitsExactlyTwoPosts`** — `POST /v1/scenarios/run-book-set` is admitted; `POST /v1/scenarios/run-book-set/anything` is 405; `POST /v1/scenarios/set/run-book` is **not** special-cased and reaches the id route as the id `set` (a 404 about a committed scenario, which is the honest answer).

17. `TestAPIIssuesNoWritingSQL` — already sweeps the package; the new file is covered with no change.

---

## 9. Web / deep-link implications

### 9.1 The tornado is a new surface, not a widened matrix

`LabRunBookEngine` carries `before`/`after` full aggregates, histograms, `collateral_by_asset` and `movers`. **Do not widen it to admit a summary.** A summary flowing into `cellState`'s `{state: "result", engine}` arm would render blank histograms and empty collateral tables — filling holes with zeros, which is the exact defect `matrixCells.ts` was built across R8–R17 to prevent.

Ship a sibling decision module (`web/app/lab/tornadoCells.ts`) that **reuses** `matrixCells`' vocabulary — `ScenarioIdentity`, `rowIdentity`, `skewFields`, `definitionSkew`, `DEFINITION CHANGED`, `resolveBatchCohort` — and defines its own cell/bar states over the summary shape. One identity join, one skew sentence, two renderers.

### 9.2 Deep links

- **New param `?scenarios=a,b,c`** (comma-separated committed ids). Rides the same listing-arrival callback as today's `?scenario=` (`LabBookPanel.tsx:893–928`), for the same reason: membership becomes knowable only when the listing lands, so the auto-run can never POST an id the deployment does not publish.

- **`?scenario=` and `?scenarios=` together → run nothing, and say so.** Two mutually exclusive selections in one URL is a link nobody wrote. Render a named notice; do not guess a precedence.

- **Ids in `?scenarios=` that are absent from the listing are filtered before dispatch and NAMED in a visible notice.** Today's single deep link silently `return`s on a non-member (`line 907`). For a set that silence becomes a hole: the client *must* filter (an unknown id 404s the whole set, by §4), so it must disclose what it filtered. "You asked for 15, this deployment publishes 12, here are the three it does not" — never a quiet 12.

- **No `?scenarios=*`.** A link whose meaning changes when the committed set changes is a link that lies to whoever opens it tomorrow. Same rule as the request body's "no implicit all."

- **No `?batch=` in this wave.** See Open Question 3.

### 9.3 Dispatch and settle

One request writes **N phases at once**, each `{kind: "running", attempt: identities.get(id)}` — the existing `MatrixPhase` shape, so R14's dispatch-time identity stamping works unchanged and the whole set is judged by the definitions on screen at the instant of dispatch.

On settle, one body fans out to N phases. The set-level gate (`CONTRADICTORY SET`) runs **first**, over the whole body, before any row is classified — R12's "validate before classify," at set granularity. A set that contradicts its own membership produces no cell, no pin, no cohort for **any** row it covers.

A bodyless settlement (429, 503, network) fails **all N rows at once**, each keeping whatever it held at its own batch pin, each with `rerunFailed` carrying the settlement's own identity stamp (R16). One request, one failure, N disclosures — which is strictly more honest than today's N independent failures, because the reader learns one fact instead of inferring it from N.

### 9.4 The cohort still applies, and must

The set-run makes the cohort trivial *for the rows it covers* — one batch by construction. It does **not** make it unnecessary: a single-row re-run through the existing endpoint lands at whatever batch is newest and raises the anchor above the set's batch. `resolveBatchCohort` then correctly demotes every set row to `SUPERSEDED`.

**Tornado-specific rule:** a tornado is one sentence across scenarios, so a bar from another batch breaks it. The tornado draws a bar **only** for rows whose pinned batch equals the set's batch; a re-run row leaves the chart into its own named state with its own batch id and a re-run affordance for the *set*. It does not get drawn shorter, greyer, or beside the others.

### 9.5 Header

One line, composed once and rendered by every surface (the file's habit since R13):
the set's batch id; `still_newest_servable` and, when false, the newer batch id and a re-run affordance; the count of bars drawn versus scenarios requested; and, when non-empty, the deep-link ids that were filtered.


---

## Invariants claimed

1. ONE BATCH: every RunBookSetResponse carries exactly one `batch` object, and no schema reachable from the set-run root requires `batch_id`, `computed_at` or `bucket_start` below it. (Directly asserted, and structurally enforced by cmd/api/contract_sweep_law_test.go's reclockNames = {batch_id, computed_at, bucket_start}: a per-scenario batch_id would void the envelope's sweep license over Projection.becomes_liquidatable and fail the existing sweep.)
2. MEMBERSHIP PARTITIONS EXACTLY: in every 200, sorted(results[].scenario_id) == sorted(requested_scenario_ids) as multisets — no id in two cells, no id in none — and len(results) == evaluation.scenarios_evaluated. There is no partial 200.
3. ENGINE PARTITION, PER SCENARIO: for every result, sort(engines[].engine ++ withheld_engines) == sort(covered_engines), and engines[].engine ∩ withheld_engines == ∅. No covered engine may be absent from both arrays (the hole class), and none may appear in both (the R12 contradiction class).
4. POSITION PARTITION: for every result, positions_in_run == Σ engines[].accounts; and at set level coverage.batch_positions == coverage.in_book + coverage.refused_in_batch + coverage.excluded_by_this_layer. `coverage.in_book` is the whole reconstructable book, NOT any one scenario's run.
5. SET-RUN ≡ N SINGLE RUNS AT ONE BATCH: for every (scenario, engine), each summary field is byte-identical to the corresponding field of the single-scenario run-book body computed over the same batch. The shared before-measure is an optimization, never a different measurement.
6. THE BEFORE SIDE IS SCENARIO-INVARIANT: at a fixed batch, every result's per-engine before_* and total_* fields are equal across all scenarios covering that engine. (Structural: risk.Waterfall accumulates only through engineOf(m.engine, ...) so no position contributes to another engine's row. Empirically confirmed at batch 5759: byte-identical across 12/12 scenarios for debt_manager and 5/5 for aave_v3_etherfi.)
7. NO CROSS-ENGINE MONEY: every Decimal/NullableDecimal-typed property under the set-run root is reachable only through a node that requires `usd_decimals`. There is no total, sum, average or rollup of money across engines anywhere in the response.
8. NO FLOATS: no `type: number` appears anywhere under the set-run schemas; every money quantity is an exact decimal integer string (Decimal / NullableDecimal).
9. AN UNKNOWABLE IS NEVER ZERO: a withheld engine contributes no row to engines[] and no zero — it is named in withheld_engines and in the shared excluded_engines. A scenario all of whose covered engines are withheld returns engines: [] and still counts in scenarios_evaluated. market_realization and projection are present whenever the committed definition declares them, so a scenario whose three deltas are structurally zero never renders as three zero bars.
10. EVERY DELTA CARRIES ITS BASE AND ITS DENOMINATOR: each of eligible_debt_delta_usd and bad_debt_delta_usd is served beside its before_* value and beside total_debt_usd, at the same usd_decimals. eligible_accounts_delta (NET) is served beside flipped_to_eligible (flips false→true only), so a net of zero cannot hide equal churn in both directions.
11. ATOMICITY: any unknown, duplicate, malformed, over-cap or missing scenario id refuses the WHOLE request before any batch read or arithmetic, naming every offending id; any arithmetic refusal refuses the WHOLE request with 500. No response ever carries some scenarios and silently omits others.
12. SUPERSESSION IS DISCLOSED, NEVER TORN AND NEVER A REFUSAL: batch resolution and every child read happen inside one BeginRiskSnapshot, so a batch landing mid-compute is invisible to the arithmetic; the response still carries the resolved batch, still answers 200, and evaluation.still_newest_servable / newest_servable_batch_id state the fact measured at probed_at. newest_servable_batch_id is null (never 0, never batch_id) when nothing is servable at probe time.
13. TEMPORAL COHERENCE: served_at == evaluation.resolved_at == the resolving snapshot's database clock; evaluation.probed_at >= resolved_at; both lie inside a bracket of SELECT now() readings taken either side of the request; batch.age_seconds == served_at − batch.computed_at and each watermarks[].sweep.age_seconds == served_at − that stamp's own max_updated_at.
14. IDENTITY IS JOINABLE PER ROW: every result carries scenario_id and scenario_version, and the envelope carries scenario_config_version, so web/app/lab/matrixCells.ts's ScenarioIdentity triple can be formed for each row and definitionSkew can refuse a row it may not classify. Corollary law over the committed set: a scenario's `version` MUST change whenever its `engines` set changes.
15. DETERMINISM: two identical requests against the same batch serve byte-identical responses modulo served_at, evaluation.resolved_at, evaluation.probed_at and the derived age_seconds fields. `results` is in REQUEST order; `engines` within a result is sorted by engine name.
16. COST IS BOUNDED AND CHARGED: len(scenario_ids) <= max_set_run_scenarios (24); the rate limiter is charged len(scenario_ids) tokens; and the deployment satisfies rate_burst >= max_set_run_scenarios, validated at startup so no legal request is permanently unservable.
17. THE SURFACE WRITES NOTHING: the set-run handler issues no writing SQL (covered without change by cmd/api/purity_test.go's TestAPIIssuesNoWritingSQL), and the readOnly gate admits exactly two POST paths, by exact match, never by path family.

## Open questions

- Should contract 1.7.0 ALSO add shape (B)'s optional `batch_id` to the existing POST /v1/scenarios/{id}/run-book, for drill-down only? RECOMMEND YES, as a subordinate item. Without it, clicking a tornado bar re-resolves the newest batch and the detail view shows numbers that differ from the bar it came from — a D-013 defect the day the tornado ships. It is cheap: internal/store/risk.go:1583's riskBatchCompleteConjuncts is parameterless over alias `b`, so the by-id read is `WHERE b.id = $1 AND ` + the same fragment, and superseded-batch positions are provably still readable (internal/store/p5_positions_page.go reads risk_positions for an arbitrary pinned batch and refuses only when the row is gone). It needs one new refusal — a batch that is no longer evaluable, i.e. pruned or never complete — which should follow the BatchSupersededBody precedent (its own 409/404 body naming both the requested id and the current one) rather than widening the sealed ErrorBody code enum. It is SEVERABLE: ship (A) alone if the wave must be narrow, and the web falls back to its existing SUPERSEDED register, which already tells the truth.
- Should `evaluation` (or at least still_newest_servable + newest_servable_batch_id) be added to the EXISTING RunBookResponse too? RECOMMEND YES. The single-scenario endpoint has the same 1.0–1.9 s exposure and discloses nothing about it today; a reader cannot tell whether the batch it names is still the head. It is additive in the established 1.6.0 manner (new properties added to `properties` and `required`), it costs two cheap queries, and it lets the web's cohort machinery learn the fact from the wire instead of inferring it. Cost: the openapi run-book example must be re-captured (the test law already forces that), and the generated client plus web/lib/proof-contract.gen.ts must be regenerated.
- Should the tornado deep link pin the batch (`?scenarios=a,b,c&batch=5759`)? RECOMMEND NO in 1.7.0, and it is a genuine trade. A pinned link reproduces exactly what the sender saw — desirable for sharing a finding — but it makes a live risk surface open on a stale book by default, and it dies silently once retention prunes the batch (~69 h at the observed cadence). Recommend: the link names ids only, the page re-runs at the current batch, and `evaluation` plus the batch envelope make the difference visible and dated. Revisit if operators actually ask to share frozen views; it depends on Open Question 1 shipping first.
- Should the set-run offer `detail: "full"` returning complete RunBookResponse bodies? RECOMMEND NO. Measured: 12 full bodies = 350,604 bytes, 15 ≈ 440 KB, against ≈18–21 KB for the summary shape — a 20–25× difference for data a tornado does not plot (collateral_by_asset 14,496 B and movers 9,896 B of a single 40,226 B body). Two response shapes on one endpoint means two contract examples to capture, two schema sweeps and two sets of test laws, and the field's mere existence invites routine 440 KB fetches. Drill-down belongs to the single-scenario endpoint.
- Is `maxItems: 24` the right cap? RECOMMEND 24 and revisit only with evidence. Today's committed set is 15 files (12 on the deployed binary), so 24 leaves headroom for growth while bounding the worst case at ≈1.2 + 24 × 0.45 ≈ 12 s and staying under defaultRateBurst 40. The alternative — no cap, bounded only by the token charge — makes worst-case latency a function of the burst size, which is operator-tunable and therefore not a bound the contract can state.
- Per-scenario failure semantics: named refusal inside a 200, or all-or-nothing? RECOMMEND ALL-OR-NOTHING, twice over, and therefore NO per-scenario refusal register at all. Every current failure mode is either a request property knowable before compute (unknown/duplicate/malformed id — refuse the whole request, name every offender) or something the existing handler already classifies as a service defect (cmd/api/p5_runbook.go:466 calls an ApplyScenario refusal "a defect in this layer, not a property of the data"; Waterfall, ExecutionShortfall and projection-delta failures are all codeInternal). Dressing a defect as a per-scenario refusal would let a broken deployment serve 14 bars and one apology, and the reader would take "this scenario is unavailable" for a property of the scenario. The cost is real — one bad id wastes 14 good evaluations — but it is paid before any compute, so it costs milliseconds, not seconds. If experience later shows genuine per-scenario partial failures that are NOT defects, add a `scenario_refusals[]` array then, additively, and shrink the membership partition law from equality to `evaluated ⊎ refused`.
- Should a per-process in-flight semaphore back up the token charge? RECOMMEND NO in 1.7.0. The N-token charge already makes the existing 20 rps / burst 40 budget cost-aware and reuses the 429 `rate_limited` register the web client already renders honestly. A semaphore needs a new refusal: 503 `unavailable` is wrong because web/lib/runbook.ts maps 503 to {kind: "no-batch"}, which renders as "no servable batch" — a flatly false statement about the book — so it would need its own body type in the BatchSupersededBody manner. Revisit only if production shows CPU saturation the token charge does not contain.

## Cost notes

"ALL FIGURES MEASURED against the live deployment on this machine (api-2178014.exe, local Postgres, riskd materializing concurrently), batch 5748→5759, 9,909 positions = 9,863 debt_manager + 46 aave_v3_etherfi, 1 refused. Noisy box, so brackets not points.\n\nPER-REQUEST LATENCY (curl time_total, n=20 across the committed set):\n  POST /v1/scenarios/{id}/run-book   1.04 – 1.91 s, median ≈1.45 s\n    dm_rate_horizon_plus_200bps (projection; no explicit ApplyScenario pass)  1.04 – 1.62 s\n    btc_leg_minus_20 (DM only, 1 shock)                                        1.20 – 1.44 s\n    eth_minus_30 (both engines, 1 shock)                                       1.34 – 1.91 s\n    dm_composition_census (DM only, 8 shocks)                                  1.47 – 2.06 s\n    weeth_market_depeg_oracles_held (both engines + ExecutionShortfall)        1.52 – 1.60 s\n  GET /v1/meta   1.10 – 1.67 s   — performs the SAME s.readBatch(ctx, nil) + reconstructAll (cmd/api/meta.go:555) and then only cheap price/sweep queries\n  GET /v1/book   1.77 – 1.79 s\n  GET /v1/scenarios  0.0025 s     — configuration, no batch read: the contrast that isolates the read\n\nCOST DECOMPOSITION. /v1/meta and run-book share the batch read and reconstruction and differ only in the arithmetic; meta's floor (1.10 s) against run-book's floor (1.04–1.34 s) puts the shared read at roughly 1.0–1.3 s and the per-scenario arithmetic at roughly 0.25–0.45 s. The projection-vs-shock delta (1.04–1.62 vs 1.34–1.91) prices one explicit ApplyScenario pass over ~9.9 k positions at ≈0.25–0.30 s.\n\nWHAT A SET-RUN AMORTIZES:\n  readBatch + reconstructAll   1.0 – 1.3 s      ONCE (vs N times under shape B)\n  shared BEFORE measure        0.05 – 0.20 s    ONCE\n  per scenario (ApplyScenario + AFTER measure + optional shortfall/projection)   0.25 – 0.45 s   × N\n  freshness probe (BatchStillNewestServable + SELECT now())   < 10 ms   once\n  serialization of ≈21 KB      < 20 ms          once\n\nBUDGET FOR N = 15:  1.2 + 0.15 + 15 × 0.35 ≈ 6.5 s.  Plan on 5–9 s p50, 12 s p95.\nWORST CASE AT THE CAP (N = 24):  ≈1.2 + 24 × 0.45 ≈ 12 s.\nSHAPE B FOR THE SAME 15:  15 × 1.45 ≈ 22 s. Measured directly: a serial sweep of the deployed set took 20.58 s wall (12 real POSTs ≈ 19.9 s of compute, 3 unknown ids 404'd in 57–193 ms).\n\nTHE SHARED-BEFORE OPTIMIZATION IS SOUND, MEASURED. Captured all 12 servable scenarios at batch 5759 and diffed their `before` aggregates: the debt_manager before-side is BYTE-IDENTICAL across all 12; the aave_v3_etherfi before-side is BYTE-IDENTICAL across all 5 scenarios covering it. Structural cause: risk.Waterfall accumulates only through engineOf(m.engine, ...) (internal/risk/waterfall.go ~236) and measureRunBook's walk is per-position (cmd/api/p5_runbook.go:653), so per-engine outputs never depend on another engine's rows. One before-measure over the whole book, sliced per engine, is therefore the same measurement — and Test Law 2 pins it.\n\nPAYLOAD. One full RunBookResponse (eth_minus_30, both engines) = 40,226 B. Composition: collateral_by_asset 14,496 B (both sides, both engines, 19 DM assets × 2), movers 9,896 B, histograms 6,302 B, held_flat 2,287 B, out_of_model 1,214 B, batch envelope 1,256 B, applied_shocks 966 B, notes/prose ≈2,000 B. NONE of that is what a tornado plots. Twelve full bodies = 350,604 B; fifteen ≈ 440 KB. A purpose-built SetRunScenarioResult measures 818 B in its minimal form and ≈1.1–1.3 KB with market_realization and projection included; 15 results + shared envelope + census ≈ 18–21 KB. Ratio ≈ 20–25×.\n\nMEMORY. The shared before-measure holds one `states` map and per-asset collateral maps for ~9.9 k positions for the life of the request — once, not N times; each after-measure is transient. The large allocation either way is v.Positions with legs and price inputs for 9,909 rows, and a set-run holds exactly one copy of it where shape B allocates N.\n\nBATCH CADENCE, AND WHY IT SETTLES THE QUESTION. Observed: batch 5756 computed_at 20:34:04.909Z → batch 5759 computed_at 20:36:34.909Z = 3 batches in 150.2 s ≈ one every 50 s (design note in web/app/lab/matrixCells.ts says ~2/min). Against a ~21 s serial sweep that is a coin flip: sweep 1 of 15 ids (23.9 s) spanned batches 5757 AND 5758 — three scenarios measured on one book, four on another; sweep 2 (20.6 s) landed wholly on 5759. Retention is 5,000 batches (cmd/riskd/main.go:66), so at the observed cadence a batch stays readable ≈ 69 h — ample for shape B's pin, irrelevant to shape A.\n\nSERVER LIMITS. No WriteTimeout is set (cmd/api/main.go:521–529, deliberate so SSE is not severed), so a 5–12 s synchronous response is not cut off; ReadHeaderTimeout is 10 s and applies to request headers only. web/lib/runbook.ts sets no fetch timeout. Rate limit is 20 rps / burst 40 per IP (cmd/api/main.go:80–81) and counts REQUESTS, not scenarios — cost-blind, which is why the N-token charge is required: without it a burst-40 client turns 40 requests into up to 960 scenario-evaluations ≈ 350 s of CPU."

---

## ADVERSARIAL VERIFY: DEFECTIVE (16 findings)

### Finding 1

**`flipped_to_eligible` mislabels the Aave number (D-013, primary).** Verified in `C:/Users/kasel/source/repos/etherfi/Solvent/cmd/api/p5_runbook.go:755-833`: `runBookMovers` has TWO rules. The DM branch counts eligibility flips false→true (`if b.eligible || !a.eligible { continue }`); the Aave branch counts accounts whose health factor STRICTLY DROPPED (`drop := Sub(b.hfWad, a.hfWad); if drop.Sign() <= 0 { continue }`) — no eligibility test at all. `movers_total` is `len(all)` of whichever list. The contract already scopes the flip semantics explicitly: `api/openapi.yaml` RunBookEngine.movers_total says "**On the Debt Manager** it counts flips to eligible ONLY", and `web/app/lab/labRunBookLines.ts:145-158` (`moversSubject`) keeps two subjects — "whose health factor strictly dropped" for Aave, "whose debt became eligible" for DM. The spec's §2.5 collapses both into one field named `flipped_to_eligible` with a universal note "counts flips false→true ONLY", Invariant 10 rests on it, and Test Law 2 enshrines the wrong mapping (`movers_total → flipped_to_eligible`, byte-identical, for every (scenario, engine)). WRONG NUMBER: on `aave_v3_etherfi` the tornado publishes a count of health-factor drops under a label that says accounts entered liquidation eligibility. FIX: serve two fields, each null on the engine that does not speak it (`hf_dropped_accounts` / `flipped_to_eligible`) — the house rule this file already applies to `hf_before_wad` vs `hf_before_num/den` — or name the field per engine and carry the engine's own subject in the note.

### Finding 2

**The §7 worked example is not a body any server can serve** (violates the run-book example law). The Aave row serves `flipped_to_eligible: 12` beside `before_eligible_accounts: 3`, `after_eligible_accounts: 3`, `eligible_accounts_delta: 0`. Under the spec's own definition (flips false→true only), net 0 with 12 flips IN requires 12 flips OUT — 12 Aave accounts leaving liquidation eligibility under a −30% ETH collateral shock, while the same row shows collateral falling 819148540820 → 573403978573 and `before_eligible_debt_usd` unchanged. Nothing in `measurePosition` (`internal/risk/waterfall.go:321-349`, Aave eligibility is `HF < 1e18`) produces that. The 12 is `movers_total` (HF drops) pasted under the new label, which is direct evidence that finding 1 already contaminated the illustration. FIX: regenerate the example from a real served body once the field split in finding 1 lands, as W-EX-A requires.

### Finding 3

**The 404 refusal example names ids that ARE committed.** The spec asserts "*This refusal is realizable today: the running binary serves 12 of the 15 committed scenario files, and `eth_minus_40/50/60` 404 on it*". Verified false against the source: `internal/risk/scenarios/` holds 15 files including `eth_minus_40.json`, `eth_minus_50.json`, `eth_minus_60.json` (I read `eth_minus_40.json` — a complete, valid definition), `internal/risk/scenario.go:45` embeds `scenarios/*.json` unconditionally, and `cmd/api/main.go:285-287` loads every one into `s.byID`, which is what `handleRunBook` looks up at `p5_runbook.go:393`. A binary built from this tree serves those ids 200, not 404. The observed 404s are a stale deployment, not the id space. This also weakens §0 fact 2: the empirical before-side invariance was measured over 12 of 15 scenarios, omitting the three deepest ETH shocks. FIX: build the 404 example on an id that is not committed (e.g. `eth_minus_99`), and stop citing the deployed binary's id set as the committed set.

### Finding 4

**`evaluation.batch_id` violates Invariant 1 and Test Law 11, and the claimed structural enforcement does not exist.** `cmd/api/contract_sweep_law_test.go:101` defines `reclockNames = {batch_id, computed_at, bucket_start}` — exactly the vocabulary. §2.6 REQUIRES `evaluation.batch_id`, so a schema reachable from the set-run root requires `batch_id`, and Test Law 11 ("no schema under the set-run roots requires `batch_id` … below the envelope", "asserted directly here") fails on the spec's own design. Separately, the sweep cannot be the backstop the invariant claims: `sweepWalk` (lines 327-345) only sets `licensed = false` on a re-clock and records a violation solely where a *liquidatable-family* property is met while unlicensed. `SetRunEvaluation` carries none, so the existing law greens a re-clocked evaluation block silently. FIX: drop `batch_id` from `SetRunEvaluation` — `batch.id` is one field away and the block does not read alone anyway once `resolved_at` is on it — or scope Invariant 1 to "below `batch`" and stop claiming the sweep enforces it.

### Finding 5

**Test Law 9 is red on arrival, so Invariant 7 is unenforced.** The law says: walk the `RunBookSetResponse` root, assert EVERY `Decimal`/`NullableDecimal` property is reachable only through a node that requires `usd_decimals`, with no hand-maintained field list. But the envelope itself violates that: `Batch.watermarks[]` → `Stamp.sweep` → `SweepStamp.success_sum` is `$ref: "#/components/schemas/Decimal"` (`api/openapi.yaml`, SweepStamp required list includes `success_sum`), and no ancestor requires `usd_decimals`. Every response on this surface already carries it. The law as written fails on the first run and would be deleted or weakened rather than fixed — which leaves the actual property (no money summed across engines) with no test behind it. FIX: root the walk at `results[].engines[]` (the only money-bearing subtree) and assert the batch envelope's Decimals are the named sweep counters, as an explicit, justified exclusion.

### Finding 6

**`total_debt_usd` is side-ambiguous, and on Aave the two sides differ — a wrong denominator.** `measureRunBook` accumulates Aave debt as `h.TotalDebtBase` (`p5_runbook.go:663`), and `internal/risk/aave.go:182` computes `rv.DebtBase = MulDivCeil(rv.LiveDebt, p.Value, den)` — the debt is PRICED, so it moves under a price shock exactly as collateral does. The spec serves `total_collateral_usd_before` AND `total_collateral_usd_after` ("collateral moves under a price shock") but a single `total_debt_usd` labelled "the engine's whole debt in the run: the DENOMINATOR". §2.5's own reading — "1.54 % of the engine's book" — therefore divides an after-minus-before numerator by a denominator whose side is unstated, and on Aave the two candidate denominators are different books. A DM-only test cannot see this (DM `Borrowings` is shock-invariant), which is why it would ship. FIX: `total_debt_usd_before` and `total_debt_usd_after`, and state in the note which side the ratio a reader will compute is legitimate against.

### Finding 7

**Invariant 6 / Test Law 3 are false against the spec's own example.** They assert that every per-engine `before_*` and `total_*` field is equal across all scenarios covering that engine at a fixed batch. `total_collateral_usd_after` matches the `total_*` prefix and is an after-side quantity that varies with the shock by construction — the §7 example has DM `total_collateral_usd_after` = 89374390555696 for `eth_minus_30` and 103260002097631 for `btc_leg_minus_20`, same batch, same engine. Test Law 3 as written fails on the body §7 publishes. (The structural half of the claim IS sound: I verified `internal/risk/waterfall.go:206-260` accumulates strictly through `engineOf(m.engine, …)` with no cross-engine coupling, so per-engine slicing of a whole-book measure is safe.) FIX: enumerate the invariant fields explicitly; never pattern-match a prefix for a semantic law.

### Finding 8

**The shared before-measure over the WHOLE book widens the 500 blast radius and breaks Invariant 5.** §3.4 computes `measureRunBook(allReconstructableInputs)` over the entire book, while today's handler filters the run to covered engines first (`p5_runbook.go:432`, `covers(sc.Engines, p.Engine)`). `measureRunBook` returns on the first `ComputeAaveHealth`/`ComputeDMHealth` error (`p5_runbook.go:656-698`) and `risk.Waterfall` returns on the first `ApplyScenario`/`measurePosition` error (`internal/risk/waterfall.go:229-236`); §4.1 Class 2 turns any of those into a 500 for the whole set. So a defective position on an engine that NO requested scenario covers 500s a set-run that N single runs would each have served. That is Invariant 5 violated in the one case where the optimization is not merely an optimization, and it makes one bad row a deployment-wide outage for the tornado. FIX: build the shared measure over the union of the requested scenarios' covered engines, and say so.

### Finding 9

**The freshness probe is three unsynchronized reads, one of which does not exist.** `Store.BatchStillNewestServable` (`internal/store/p5_positions_page.go:481-494`) resolves `newest` internally and RETURNS ONLY A BOOL — it cannot fill `newest_servable_batch_id`. §3.6's "two cheap queries" is therefore wrong; a third `s.pool` query is required, and none of the three share a snapshot. WRONG NUMBER: a response can carry `still_newest_servable: true` beside `newest_servable_batch_id: N+1` (N+1 lands between probes) or `false` beside `newest_servable_batch_id: N` (N+1 pruned between probes) — a self-contradictory pair inside the block §2.6 designed "so this block reads alone", and Test Law 8 only exercises the null case. FIX: one query inside one `BeginRiskSnapshot` returning `(newest_id, now())`; derive the boolean from the id.

### Finding 10

**`still_newest_servable: false` conflates supersession with "nothing is servable", and the spec mandates a false sentence for the second case.** The store's own doc comment: "*false with a nil error means either a newer servable batch exists or none does*". §5 requires the verbatim note "*A newer batch has since materialized: these numbers describe batch N and not the current head of the book*" whenever the flag is false, and §9.5 composes a header naming "the newer batch id". When the resolved batch was pruned or completeness regressed, no newer batch exists, `newest_servable_batch_id` is null, and the served sentence asserts a materialization that did not happen. FIX: three disclosed states — still newest / superseded by id N+1 / nothing servable — each with its own sentence and its own header clause.

### Finding 11

**An empty or all-refused book serves N scenarios of zero bars under a green `stress_coverage_is_full`.** `coverage()` at `cmd/api/handlers.go:714` computes `StressCoverageIsFull = ExcludedByThisLayer == 0 && len(withheld) == 0` — and `reconstructAll` (`read.go:693-695`) skips non-`Computed` rows without setting `reconstructionErr`, so a batch whose positions are ALL status-refused yields `excluded_by_this_layer: 0`, no withheld engine, and `stress_coverage_is_full: TRUE` with `in_book: 0`. `measureRunBook` then short-circuits on the empty book (`p5_runbook.go:720`) and every engine falls through `if eb == nil { eb = newRunMeasure() }` (lines 570-576) to all zeros: every `before_*`, every delta and `total_debt_usd` serve `"0"`. The same all-zero row appears for any covered engine present in `v.Aggregates` with zero positions and no refusal — legal state, `read.go:403`: "Zero POSITIONS stay legal". Invariant 9 covers only the WITHHELD case, so the tornado draws 15 scenarios × 2 engines of zero-length bars while the census says coverage is full, and `total_debt_usd: "0"` is a denominator the spec's own D-013 argument makes load-bearing. FIX: an engine row with `accounts == 0` must be a named absence, not a zero row; `stress_coverage_is_full` must be false when `in_book == 0`; and a zero denominator must be disclosed as one, never divided by.

### Finding 12

**`refused_positions` counts the wrong class, and no completeness law ties it to the census.** The handler's `refusedByEngine` (`p5_runbook.go:424-430`) increments for EVERY covered-engine position with `p.input == nil`, and `reconstructAll` skips non-`Computed` rows entirely — so a batch-REFUSED row has `input == nil` and `reconstructionErr == ""`. The count is `refused_in_batch` and `excluded_by_this_layer` mixed, while `coverage()` keeps those two strictly apart as separate cells. §2.5 documents the field as only the second class ("covered-engine positions this layer could not rebuild"), and the §7 example proves it is the first: DM `refused_positions: 1` beside `excluded_by_this_layer: 0`, `refused_in_batch: 1`. Test Law 4 has no clause relating Σ `refused_positions` to the census, so the two attributions can drift with nothing catching it. FIX: split into `refused_in_batch_positions` / `unrebuildable_positions` per engine, and add a partition clause tying their sums to `coverage`.

### Finding 13

**The N-token charge has nowhere to live as specified.** `rateLimit` (`cmd/api/middleware.go:392`) is middleware keyed on the connection address that calls `s.limiter.allow(key)` — a one-token API; there is no `AllowN` on `ipLimiter`, and the middleware runs before the handler and cannot see a body it has not buffered. §2.2 puts `MaxBytesReader` and `DisallowUnknownFields` in the handler. So the charge is either (a) middleware body-buffering, which moves decode discipline out of the handler and re-opens the no-handler-reads-a-body property from the other side, or (b) a second charge inside the handler on top of the one the middleware already spent — total N+1 tokens, with a duplicated 429 + `Retry-After` path the spec never describes. Test Law 14 ("burst-40 admits two 15-scenario set-runs and refuses the third") also ignores refill at 20 rps and is timing-dependent. FIX: name the mechanism and the charge point, and make the test assert against a limiter with a frozen clock.

### Finding 14

**`maxItems: 24` bounds one request's memory, not the deployment's — the rejected semaphore was rejected on a fixable premise.** §6.2 claims the cap "bounds the memory"; it bounds one request. Verified: no `WriteTimeout` and no `ReadTimeout` on the server (`cmd/api/main.go:521-529` — `ReadHeaderTimeout` and `IdleTimeout` only), and §6.3 explicitly declines an in-flight bound. At 20 rps / burst 40 with 24 tokens charged, one IP sustains ~0.8 set-runs/sec against a 6–12 s service time: ~5–10 concurrent set-runs steady-state, each holding a reconstructed ~9.9 k-position book plus a `states` map and per-asset collateral maps for its whole life, each arrival lengthening the rest. The stated reason for rejecting the semaphore is that the web client maps 503 to `{kind: "no-batch"}` and would render "no servable batch" — that is a client-mapping bug to fix in one line, not a reason to leave concurrency unbounded. Also: the 0.25–0.45 s per-scenario term is inferred by subtracting the shared term from a single-run median, but only the BEFORE side is shared — each scenario still pays a full-book `risk.Waterfall` on the AFTER side plus a full `ApplyScenario` pass, so 24 scenarios is 24 whole-book waterfall walks.

### Finding 15

**Reusing the shared `BookCoverage` component while redefining `in_book`.** `api/openapi.yaml:2044` declares `BookCoverage` with `additionalProperties: false` and a description binding it to "the audit of what reached the derived arithmetic". §2.3 keeps the component and changes `in_book` from run-scoped to book-scoped. One typed field then denotes two different quantities depending on which endpoint produced it — the exact "two different questions that shared one field name" the spec diagnoses, relocated rather than removed; a generated client has one `BookCoverage` type with one `in_book`. `withheld_engines` likewise now appears at both set level and per result with different scopes. Additive-only is satisfied by a NEW component, which is also what makes the meaning travel with the type. FIX: `SetRunBookCoverage`, with the book-scoped meaning in the schema description, not only in the served `note`.

### Finding 16

**Payload budget is contradicted by the spec's own example, and the tornado's cross-engine axis is left unruled.** §6.4 puts a `SetRunScenarioResult` at ≈1.1–1.3 KB; the §7 `eth_minus_30` result carries two engine notes of ~590 chars each plus a result note plus ~20 scalars per engine — ~2.3–2.5 KB, so 15 results is ~30–35 KB, not the claimed 18–21 KB. The 40 KB / 350 KB figures are measured; this one is estimated from a shape that does not exist and its own illustration refutes it. Separately, §2.5 states the tornado plots three numbers per (scenario, ENGINE), and Invariant 7 forbids summing across engines — but nothing in §9 forbids drawing a 6-decimal DM bar and an 8-decimal Aave bar on one axis, where 350874918026 ($350,874.92) and 7943293 ($0.079) are incommensurable integers. FIX: state the per-engine axis rule (separate axis or normalize by that engine's own `total_debt_usd`) as a named law in §9, the same way §9.4 names the batch-cohort rule.

