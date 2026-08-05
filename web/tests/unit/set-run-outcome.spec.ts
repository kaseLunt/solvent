// The SET-RUN's client register (Wave W-BP at contract 1.7.0).
//
// Laws under test:
//   - DISPATCH IS CODE-FIRST, STATUS-SECOND. The route answers 503 for two
//     different facts, and branching on the status alone renders the busy
//     refusal as "no batch", which is a flatly false statement about the book;
//   - the BUSY arm is its own outcome, distinct from `no-batch` and from
//     `rate-limited`, and it carries the deployment's bound and gauge;
//   - no `Retry-After` is read or invented for the busy arm — nothing computes
//     when a semaphore slot frees;
//   - the shape rules are enforced LOCALLY, before a request is spent;
//   - the SET-level membership gate runs before any row is classified;
//   - a reach count is NEVER printed as a cause, and "K of K snapped" is
//     unreachable: the cell composes the three `marks_held_by_*` figures;
//   - a zero denominator draws no bar and divides nothing;
//   - a movement count is never printed without its denominator.

import { expect, test } from "@playwright/test";

import {
  classifySetRunRefusal,
  runBookSet,
  MAX_SET_RUN_SCENARIOS,
  type SetRunOutcome,
} from "../../lib/runbookSet";
import {
  barLength,
  freshnessClause,
  heldCauseSentence,
  movementSentence,
  resultContradiction,
  setContradiction,
  tornadoCellState,
} from "../../app/lab/tornadoCells";
import type {
  RunBookSetResponse,
  SetRunEngineSummary,
  SetRunScenarioResult,
} from "../../lib/runbookSet";

const headers = (map: Record<string, string> = {}) => ({
  get: (name: string) => map[name.toLowerCase()] ?? null,
});

const BUSY_BODY = JSON.stringify({
  error: {
    code: "set_run_busy",
    message:
      "this deployment evaluates at most 2 set-runs concurrently and 2 are running. The request was refused " +
      "immediately rather than queued, so no connection is held waiting. Nothing here computes when a slot frees, " +
      "so no Retry-After is offered rather than one invented. This is a statement about the evaluator's capacity " +
      "and about nothing in the book: the batch is fine.",
    max_in_flight: 2,
    in_flight: 2,
  },
});

const NO_BATCH_BODY = JSON.stringify({
  error: { code: "unavailable", message: "no complete risk batch is available", retry_after_seconds: 5 },
});

test.describe("the set-run's refusal register dispatches on the CODE", () => {
  test("503 set_run_busy is the BUSY arm, never no-batch and never rate-limited", () => {
    const outcome = classifySetRunRefusal(503, headers(), BUSY_BODY);
    expect(outcome.kind).toBe("busy");
    if (outcome.kind !== "busy") return;
    expect(outcome.maxInFlight).toBe(2);
    expect(outcome.inFlight).toBe(2);
    expect(outcome.message).toContain("about nothing in the book");
  });

  test("503 unavailable is the NO-BATCH arm, on the same status", () => {
    const outcome = classifySetRunRefusal(503, headers({ "retry-after": "5" }), NO_BATCH_BODY);
    expect(outcome.kind).toBe("no-batch");
    if (outcome.kind !== "no-batch") return;
    expect(outcome.retryAfterSeconds).toBe(5);
  });

  test("the two 503s are distinguishable ONLY by the code — the status cannot tell them apart", () => {
    const busy = classifySetRunRefusal(503, headers(), BUSY_BODY);
    const noBatch = classifySetRunRefusal(503, headers(), NO_BATCH_BODY);
    expect(busy.kind).not.toBe(noBatch.kind);
  });

  test("the BUSY arm reads no Retry-After, even if a proxy invents one", () => {
    const outcome = classifySetRunRefusal(503, headers({ "retry-after": "30" }), BUSY_BODY);
    expect(outcome.kind).toBe("busy");
    expect(JSON.stringify(outcome)).not.toContain("retryAfter");
  });

  test("429 keeps its message — the arm this module exists NOT to inherit", () => {
    const outcome = classifySetRunRefusal(
      429,
      headers({ "retry-after": "2" }),
      JSON.stringify({
        error: {
          code: "rate_limited",
          message: "rate limit exceeded: ... and a set-run costs 1 token per scenario. This request asked for 15.",
        },
      }),
    );
    expect(outcome.kind).toBe("rate-limited");
    if (outcome.kind !== "rate-limited") return;
    expect(outcome.message).toContain("one token per scenario".replace("one", "1"));
    expect(outcome.retryAfterSeconds).toBe(2);
  });

  test("404 with the envelope keeps every unknown id it named; without one it is `not-served`", () => {
    const named = classifySetRunRefusal(
      404,
      headers(),
      JSON.stringify({ error: { code: "not_found", message: 'no committed scenario "eth_minus_99"' } }),
    );
    expect(named.kind).toBe("refused");
    if (named.kind === "refused") expect(named.message).toContain("eth_minus_99");

    expect(classifySetRunRefusal(404, headers(), "<html>not found</html>").kind).toBe("not-served");
  });

  test("a body that is not the envelope is `refused`, and says so rather than guessing", () => {
    const outcome = classifySetRunRefusal(502, headers(), "<html>bad gateway</html>");
    expect(outcome.kind).toBe("refused");
    if (outcome.kind === "refused") expect(outcome.message).toContain("without the contract's error envelope");
  });
});

test.describe("the shape rules are enforced locally, before a request is spent", () => {
  const neverCalled: typeof fetch = () => {
    throw new Error("a request was sent for a body the contract already refuses");
  };

  test("an empty set is refused, and the message says there is no implicit all", async () => {
    await expect(runBookSet("http://x", [], { fetchImpl: neverCalled })).rejects.toThrow(/no implicit/);
  });

  test("over the cap is refused locally", async () => {
    const ids = Array.from({ length: MAX_SET_RUN_SCENARIOS + 1 }, (_, i) => `id_${String(i)}`);
    await expect(runBookSet("http://x", ids, { fetchImpl: neverCalled })).rejects.toThrow(/cap of 24/);
  });

  test("a malformed id and a repeat are both refused locally", async () => {
    await expect(runBookSet("http://x", ["NOT AN ID"], { fetchImpl: neverCalled })).rejects.toThrow(
      /committed-scenario id/,
    );
    await expect(
      runBookSet("http://x", ["eth_minus_10", "eth_minus_10"], { fetchImpl: neverCalled }),
    ).rejects.toThrow(/a set is a set/);
  });

  test("an unreachable service is its own arm, never a failure about the book", async () => {
    const outcome: SetRunOutcome = await runBookSet("http://x", ["eth_minus_10"], {
      fetchImpl: () => Promise.reject(new Error("connect ECONNREFUSED")),
    });
    expect(outcome.kind).toBe("unreachable");
  });

  test("the POST carries the ids in REQUEST order", async () => {
    let sent = "";
    await runBookSet("http://x", ["b_two", "a_one"], {
      fetchImpl: (_url, init) => {
        sent = String((init as RequestInit).body);
        return Promise.resolve(new Response("{}", { status: 200 }));
      },
    });
    expect(sent).toBe('{"scenario_ids":["b_two","a_one"]}');
  });
});

// ---------------------------------------------------------------------------
// The cell decisions
// ---------------------------------------------------------------------------

const engine = (over: Partial<SetRunEngineSummary> = {}): SetRunEngineSummary => ({
  engine: "debt_manager",
  usd_decimals: 6,
  movement_rule: "eligibility_flipped_false_to_true",
  accounts: 4,
  infinite_accounts: 0,
  movement_excluded_accounts: 0,
  refused_in_batch_positions: 0,
  unrebuildable_positions: 0,
  before_eligible_accounts: 1,
  after_eligible_accounts: 1,
  eligible_accounts_delta: 0,
  flipped_to_eligible: 0,
  hf_dropped_accounts: null,
  before_eligible_debt_usd: "4200000000",
  eligible_debt_delta_usd: "0",
  before_bad_debt_usd: "0",
  bad_debt_delta_usd: "0",
  before_collateral_at_risk_usd: "0",
  after_collateral_at_risk_usd: "0",
  total_debt_usd_before: "4200000000",
  total_debt_usd_after: "4200000000",
  total_collateral_usd_before: "4000000000",
  total_collateral_usd_after: "4000000000",
  market_realization: null,
  projection: null,
  note: "",
  ...over,
});

const result = (over: Partial<SetRunScenarioResult> = {}): SetRunScenarioResult => ({
  scenario_id: "stable_depeg_0995_in_band",
  scenario_version: "v1",
  label: "in-band depeg",
  path_assumption: "instantaneous mark at the shocked level",
  shocks: [{ axis: "stable_usd", factor_num: 995, factor_den: 1000 }],
  shock_reach: {
    declared_shocks: 3,
    declared_shocks_at_identity: 0,
    reach: "no_mark_moved",
    applied_shocks: [],
    marks_moved: 0,
    marks_held_by_declared_factor: 0,
    marks_held_by_transform: 4,
    marks_held_by_arithmetic: 0,
    marks_snapped: 3,
    marks_base_snapped: 1,
    marks_cap_bound: 0,
    held_flat_marks: 1,
    held_flat_assets: [],
    note: "",
  },
  covered_engines: ["debt_manager"],
  withheld_engines: [],
  unmeasurable_engines: [],
  engines: [engine()],
  positions_answered: 4,
  positions_withheld: 0,
  note: "",
  ...over,
});

test.describe("the set-level gate runs first, over the whole body", () => {
  const body = (over: Partial<RunBookSetResponse>): RunBookSetResponse =>
    ({
      requested_scenario_ids: ["a_one", "b_two"],
      results: [result({ scenario_id: "a_one" }), result({ scenario_id: "b_two" })],
      evaluation: { scenarios_evaluated: 2 },
      ...over,
    }) as unknown as RunBookSetResponse;

  test("a coherent body passes", () => {
    expect(setContradiction(body({}))).toBeNull();
  });

  test("an id answered twice, an id never answered, and a disagreeing count are each named", () => {
    const twice = setContradiction(
      body({ results: [result({ scenario_id: "a_one" }), result({ scenario_id: "a_one" })] }),
    );
    expect(twice?.faults.join(" ")).toContain("more than one result");
    expect(twice?.faults.join(" ")).toContain("b_two was requested and has no result");

    const miscount = setContradiction(
      body({ evaluation: { scenarios_evaluated: 3 } as RunBookSetResponse["evaluation"] }),
    );
    expect(miscount?.faults.join(" ")).toContain("scenarios_evaluated is 3");
  });

  test("an answer nobody asked for is a fault too", () => {
    const stray = setContradiction(
      body({ results: [result({ scenario_id: "a_one" }), result({ scenario_id: "zzz" })] }),
    );
    expect(stray?.faults.join(" ")).toContain("zzz was answered and was not requested");
  });
});

test.describe("one result contradicting ITSELF refuses that result only", () => {
  test("a partition hole, a repeat, and a zero-account numeric row are each named", () => {
    expect(resultContradiction(result())).toEqual([]);
    expect(
      resultContradiction(result({ covered_engines: ["debt_manager", "aave_v3_etherfi"] })).join(" "),
    ).toContain("not a partition");
    expect(
      resultContradiction(
        result({ covered_engines: ["debt_manager"], withheld_engines: ["debt_manager"] }),
      ).join(" "),
    ).toContain("appears in 2 of the three engine arrays");
    expect(resultContradiction(result({ engines: [engine({ accounts: 0 })] })).join(" ")).toContain(
      "numeric row with zero accounts",
    );
  });
});

test.describe("the axis law's client half", () => {
  test("a shock that did not reach draws NO BAR and names the causes, never the flags", () => {
    const cell = tornadoCellState(result(), "v1", undefined);
    expect(cell.state).toBe("shock-did-not-reach");
    if (cell.state !== "shock-did-not-reach") return;
    // THE FORBIDDEN SENTENCE. "3 of 4 snapped" is false under a header claiming
    // nothing moved, and "K of K snapped" is false on both committed examples.
    expect(cell.sentence).not.toContain("snapped)");
    expect(cell.sentence).not.toMatch(/\d+ of \d+ snapped/);
    expect(cell.sentence).toContain("4 pinned by the stable snap, a snapped base or a bound cap");
  });

  test("the DECLARED HOLD gets its OWN sentence and never borrows the swallowed-move one", () => {
    const cell = tornadoCellState(
      result({
        scenario_id: "dm_composition_census",
        path_assumption: "no move is asserted",
        shock_reach: {
          ...result().shock_reach,
          reach: "all_shocks_declared_at_identity",
          declared_shocks: 8,
          declared_shocks_at_identity: 8,
          marks_held_by_transform: 0,
          marks_held_by_declared_factor: 2,
          marks_snapped: 0,
          marks_base_snapped: 0,
          applied_shocks: [{}, {}] as SetRunScenarioResult["shock_reach"]["applied_shocks"],
        },
      }),
      "v1",
      undefined,
    );
    expect(cell.state).toBe("declared-hold");
    if (cell.state !== "declared-hold") return;
    expect(cell.sentence).toContain("BY DECISION rather than by accident");
    expect(cell.sentence).toContain("no move is asserted");
    expect(cell.sentence).toContain("The matrix is not empty");
    expect(cell.sentence).not.toContain("came back at the value it started at");
    expect(cell.sentence).not.toContain("snapped");
  });

  test("a projection draws no delta bar and points at its own block", () => {
    const cell = tornadoCellState(
      result({ shock_reach: { ...result().shock_reach, reach: "projection_no_spot_pass" } }),
      "v1",
      undefined,
    );
    expect(cell.state).toBe("projection-no-spot-pass");
  });

  test("a reached scenario draws bars, and a partly-reached one draws them WITH the qualification", () => {
    const reached = tornadoCellState(
      result({ shock_reach: { ...result().shock_reach, reach: "every_mark_moved" } }),
      "v1",
      undefined,
    );
    expect(reached.state).toBe("bars");

    const partly = tornadoCellState(
      result({
        shock_reach: {
          ...result().shock_reach,
          reach: "some_marks_held",
          marks_moved: 1,
          marks_held_by_transform: 1,
          applied_shocks: [{}, {}] as SetRunScenarioResult["shock_reach"]["applied_shocks"],
        },
      }),
      "v1",
      undefined,
    );
    expect(partly.state).toBe("partly-reached");
    if (partly.state !== "partly-reached") return;
    expect(partly.sentence).toContain("1 of 2 marks");
    expect(partly.sentence).toContain("Of the held marks:");
  });

  test("a result with no answerable engine is an ABSENCE, not a zero bar", () => {
    const cell = tornadoCellState(
      result({
        covered_engines: ["debt_manager"],
        withheld_engines: ["debt_manager"],
        engines: [],
        shock_reach: { ...result().shock_reach, reach: "every_mark_moved" },
      }),
      "v1",
      undefined,
    );
    expect(cell.state).toBe("no-answerable-engine");
    if (cell.state !== "no-answerable-engine") return;
    expect(cell.sentence).toContain("an absence, never a zero");
  });

  test("a definition that moved under a stable id refuses the row rather than reconciling it", () => {
    const cell = tornadoCellState(result(), "v1", {
      scenarioId: "stable_depeg_0995_in_band",
      version: "v2",
      configVersion: "v1",
    });
    expect(cell.state).toBe("definition-changed");
  });

  test("a zero denominator draws no bar and divides nothing", () => {
    const zero = barLength(engine({ total_debt_usd_before: "0" }));
    expect(zero.drawn).toBe(false);
    if (zero.drawn) return;
    expect(zero.sentence).toContain("no debt on the before side");

    const drawn = barLength(engine({ eligible_debt_delta_usd: "2100000000" }));
    expect(drawn.drawn).toBe(true);
    if (!drawn.drawn) return;
    expect(drawn.ratio).toBeCloseTo(0.5, 12);
  });

  test("the sanctioned ratio is against the BEFORE side, so a moved after side cannot change it", () => {
    const a = barLength(engine({ eligible_debt_delta_usd: "2100000000", total_debt_usd_after: "1" }));
    const b = barLength(engine({ eligible_debt_delta_usd: "2100000000", total_debt_usd_after: "999" }));
    expect(a).toEqual(b);
  });

  test("a movement count is never printed without its denominator", () => {
    expect(
      movementSentence(
        engine({
          engine: "aave_v3_etherfi",
          usd_decimals: 8,
          movement_rule: "hf_strictly_dropped",
          accounts: 46,
          infinite_accounts: 44,
          movement_excluded_accounts: 44,
          hf_dropped_accounts: 0,
          flipped_to_eligible: null,
        }),
      ),
    ).toBe(
      "0 of 2 health factors strictly dropped. 44 of the 46 measured accounts could not be tested for movement at all " +
        "and are outside that denominator.",
    );
    expect(movementSentence(engine())).toBe("0 of 4 accounts flipped into eligibility.");
  });

  test("the held-cause sentence prints only the nonzero terms", () => {
    expect(heldCauseSentence(result())).toBe(
      "Of the held marks: 4 pinned by the stable snap, a snapped base or a bound cap.",
    );
    expect(
      heldCauseSentence(
        result({
          shock_reach: {
            ...result().shock_reach,
            marks_held_by_transform: 0,
            marks_held_by_declared_factor: 0,
            marks_held_by_arithmetic: 0,
          },
        }),
      ),
    ).toBe("No mark was held.");
  });
});

test.describe("the header states the freshness arm in force, once", () => {
  const withFreshness = (
    freshness: RunBookSetResponse["evaluation"]["freshness"],
    newest: number | null,
  ): RunBookSetResponse =>
    ({
      batch: { id: 7 },
      evaluation: { freshness, newest_servable_batch_id: newest },
    }) as unknown as RunBookSetResponse;

  test("each arm gets its own clause, and OLDER is never described as a materialization", () => {
    expect(freshnessClause(withFreshness("still_newest", 7))).toBe("batch 7");
    expect(freshnessClause(withFreshness("superseded", 8))).toContain("has since materialized");
    const older = freshnessClause(withFreshness("newest_is_older", 6));
    expect(older).toContain("OLDER");
    expect(older).not.toContain("materialized");
    expect(freshnessClause(withFreshness("none_servable", null))).toContain("a re-run would be refused");
  });
});
