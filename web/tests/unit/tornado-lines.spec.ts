// The TORNADO's composition layer (Wave W-TN) — `web/app/lab/tornadoLines.ts`.
//
// Laws under test:
//   - the §9.2 deep link: `?scenario=` and `?scenarios=` together run NOTHING
//     and say so; ids the listing does not publish are filtered BEFORE
//     dispatch and NAMED with the asked/published counts; there is no
//     `?scenarios=*`; more published ids than the cap dispatches nothing and
//     truncates nothing;
//   - the §9.6 header: one composed line per response — the freshness clause,
//     bars drawn against scenarios requested, the no-reach count SEPARATE from
//     the declared-no-move count, engines named absent rather than drawn, and
//     the filtered deep-link ids when non-empty;
//   - the §9.3 bodyless settlement: each arm names ITSELF (busy is never
//     rate-limit and never no-batch), and the mapping into `RunBookOutcome`
//     for a row with nothing held loses no arm's sentence;
//   - the bar geometry: rendered CSS px only (LAW-3); sorted by |ratio|
//     descending; sign picks the side; a nonzero never vanishes (1.5px floor)
//     and a TRUE zero draws no ink at all.

import { expect, test } from "@playwright/test";

import type {
  RunBookSetResponse,
  SetRunEngineSummary,
  SetRunOutcome,
  SetRunScenarioResult,
} from "../../lib/runbookSet";
import {
  batchHeaderLine,
  resolveBatchCohort,
  MATRIX_NO_RUN_LINE,
  MATRIX_SET_RUN_ONLY_LINE,
} from "../../app/lab/matrixCells";
import {
  barLength,
  heldCauseSentence,
  setContradiction,
  tornadoCellState,
} from "../../app/lab/tornadoCells";
import {
  deepLinkDecision,
  pinnedElsewhereSentence,
  setFailureAsRunBookOutcome,
  setRunFailureReason,
  tornadoBarGeometry,
  tornadoChargeHint,
  tornadoDefinitionChangedSentence,
  tornadoFloorSentence,
  tornadoHeaderLine,
  TORNADO_METHOD,
} from "../../app/lab/tornadoLines";

const LISTED = ["eth_minus_30", "ethfi_minus_50", "dm_rate_horizon_plus_200bps"];

// ---------------------------------------------------------------------------
// §9.2 — the deep link
// ---------------------------------------------------------------------------

test.describe("the deep-link decision", () => {
  test("no params is none; only ?scenario= defers to the existing single path", () => {
    expect(deepLinkDecision(null, null, LISTED)).toEqual({ kind: "none" });
    expect(deepLinkDecision("eth_minus_30", null, LISTED)).toEqual({ kind: "single" });
  });

  test("both params together run NOTHING and no precedence is guessed", () => {
    const decision = deepLinkDecision("eth_minus_30", "ethfi_minus_50", LISTED);
    expect(decision.kind).toBe("conflict");
    if (decision.kind !== "conflict") return;
    expect(decision.notice).toContain("both ?scenario= and ?scenarios=");
    expect(decision.notice).toContain("NOTHING was run");
    expect(decision.notice).toContain("no precedence is guessed");
  });

  test("a clean member list dispatches every id, in the link's own order, with no notice", () => {
    const decision = deepLinkDecision(null, "ethfi_minus_50,eth_minus_30", LISTED);
    expect(decision).toEqual({
      kind: "set",
      askedIds: ["ethfi_minus_50", "eth_minus_30"],
      runIds: ["ethfi_minus_50", "eth_minus_30"],
      filteredIds: [],
      overCap: false,
      notice: null,
    });
  });

  test("ids the listing does not publish are filtered BEFORE dispatch and NAMED with the counts", () => {
    const decision = deepLinkDecision(
      null,
      "eth_minus_30,stable_depeg_0995_in_band,nope_id",
      LISTED,
    );
    expect(decision.kind).toBe("set");
    if (decision.kind !== "set") return;
    expect(decision.runIds).toEqual(["eth_minus_30"]);
    expect(decision.filteredIds).toEqual(["stable_depeg_0995_in_band", "nope_id"]);
    expect(decision.notice).toContain("You asked for 3 scenario(s)");
    expect(decision.notice).toContain("this deployment publishes 1 of them");
    expect(decision.notice).toContain("stable_depeg_0995_in_band and nope_id");
    expect(decision.notice).toContain("Only the 1 published one(s) were dispatched");
  });

  test("a link of only unknown ids dispatches nothing, and says so", () => {
    const decision = deepLinkDecision(null, "ghost_one,ghost_two", LISTED);
    expect(decision.kind).toBe("set");
    if (decision.kind !== "set") return;
    expect(decision.runIds).toEqual([]);
    expect(decision.notice).toContain("Nothing was dispatched");
  });

  test("there is no ?scenarios=*: the wildcard is filtered and refused in its own words", () => {
    const decision = deepLinkDecision(null, "*,eth_minus_30", LISTED);
    expect(decision.kind).toBe("set");
    if (decision.kind !== "set") return;
    expect(decision.runIds).toEqual(["eth_minus_30"]);
    expect(decision.filteredIds).toContain("*");
    expect(decision.notice).toContain("A * is never expanded");
    expect(decision.notice).toContain("no implicit all");
  });

  test("duplicates and blanks in the param collapse; a set is a set", () => {
    const decision = deepLinkDecision(
      null,
      "eth_minus_30,,eth_minus_30, ethfi_minus_50 ",
      LISTED,
    );
    expect(decision.kind).toBe("set");
    if (decision.kind !== "set") return;
    expect(decision.askedIds).toEqual(["eth_minus_30", "ethfi_minus_50"]);
    expect(decision.runIds).toEqual(["eth_minus_30", "ethfi_minus_50"]);
  });

  test("over the contract's cap: NOTHING dispatches and nothing is silently truncated", () => {
    const many = Array.from({ length: 25 }, (_, i) => `sc_${String(i)}`);
    const decision = deepLinkDecision(null, many.join(","), many);
    expect(decision.kind).toBe("set");
    if (decision.kind !== "set") return;
    expect(decision.overCap).toBe(true);
    expect(decision.notice).toContain("caps one set-run at 24");
    expect(decision.notice).toContain("nothing was silently truncated");
  });
});

// ---------------------------------------------------------------------------
// §9.6 — the composed header
// ---------------------------------------------------------------------------

const headerResponse = (
  freshness: RunBookSetResponse["evaluation"]["freshness"],
  newest: number | null,
): RunBookSetResponse =>
  ({
    batch: { id: 7 },
    evaluation: { freshness, newest_servable_batch_id: newest },
    requested_scenario_ids: ["a_one", "b_two", "c_three"],
    results: [
      {
        scenario_id: "a_one",
        shock_reach: { reach: "every_mark_moved" },
        withheld_engines: [],
        unmeasurable_engines: [],
      },
      {
        scenario_id: "b_two",
        shock_reach: { reach: "no_mark_moved" },
        withheld_engines: ["aave_v3_etherfi"],
        unmeasurable_engines: [],
      },
      {
        scenario_id: "c_three",
        shock_reach: { reach: "all_shocks_declared_at_identity" },
        withheld_engines: [],
        unmeasurable_engines: [{ engine: "debt_manager" }],
      },
    ],
  }) as unknown as RunBookSetResponse;

test.describe("the composed header (§9.6)", () => {
  test("still_newest: the whole line, exactly", () => {
    expect(
      tornadoHeaderLine({
        response: headerResponse("still_newest", 7),
        drawnScenarioIds: ["a_one"],
        filteredDeepLinkIds: [],
      }),
    ).toBe(
      "batch 7 · bars drawn for 1 of 3 requested scenario(s) · shock did not reach: 1 · " +
        "declared no move: 1 · engines named absent rather than drawn: 2",
    );
  });

  test("the no-reach count and the declared-no-move count are SEPARATE clauses, always", () => {
    const line = tornadoHeaderLine({
      response: headerResponse("still_newest", 7),
      drawnScenarioIds: [],
      filteredDeepLinkIds: [],
    });
    expect(line).toContain("shock did not reach: 1");
    expect(line).toContain("declared no move: 1");
  });

  test("superseded carries the newer batch id and the set re-run clause", () => {
    const line = tornadoHeaderLine({
      response: headerResponse("superseded", 8),
      drawnScenarioIds: ["a_one"],
      filteredDeepLinkIds: [],
    });
    expect(line).toContain("batch 8 has since materialized");
    expect(line).toContain("re-run the set");
  });

  test("newest_is_older names the older batch and the word OLDER, never a materialization", () => {
    const line = tornadoHeaderLine({
      response: headerResponse("newest_is_older", 6),
      drawnScenarioIds: [],
      filteredDeepLinkIds: [],
    });
    expect(line).toContain("now 6");
    expect(line).toContain("OLDER");
    expect(line).not.toContain("materialized");
  });

  test("none_servable says a re-run would be refused", () => {
    expect(
      tornadoHeaderLine({
        response: headerResponse("none_servable", null),
        drawnScenarioIds: [],
        filteredDeepLinkIds: [],
      }),
    ).toContain("a re-run would be refused");
  });

  test("filtered deep-link ids ride the header when non-empty, and only then", () => {
    const clean = tornadoHeaderLine({
      response: headerResponse("still_newest", 7),
      drawnScenarioIds: [],
      filteredDeepLinkIds: [],
    });
    expect(clean).not.toContain("filtered from the deep link");
    const filtered = tornadoHeaderLine({
      response: headerResponse("still_newest", 7),
      drawnScenarioIds: [],
      filteredDeepLinkIds: ["ghost_one", "ghost_two"],
    });
    expect(filtered).toContain(
      "filtered from the deep link, not published here: ghost_one, ghost_two",
    );
  });
});

// ---------------------------------------------------------------------------
// §9.3 — the bodyless settlement's register
// ---------------------------------------------------------------------------

test.describe("the bodyless-settlement register names its own arm", () => {
  const busy: SetRunOutcome = { kind: "busy", message: "m", maxInFlight: 2, inFlight: 2 };

  test("busy is BUSY: capacity, not the book, not a rate, no retry instant", () => {
    const reason = setRunFailureReason(busy);
    expect(reason).toContain("SERVICE BUSY (503 set_run_busy)");
    expect(reason).toContain("at most 2 set-run(s) at once and 2 are running");
    expect(reason).toContain("nothing about the book");
    expect(reason).toContain("no retry time exists to offer");
    expect(reason).not.toContain("rate");
    expect(reason).not.toContain("no servable batch");
  });

  test("each arm names itself", () => {
    expect(
      setRunFailureReason({ kind: "no-batch", message: "no complete batch", retryAfterSeconds: 5 }),
    ).toContain("NO SERVABLE BATCH (503 unavailable)");
    expect(
      setRunFailureReason({ kind: "rate-limited", message: "costs 1 token per scenario", retryAfterSeconds: 2 }),
    ).toContain("RATE LIMITED (429): costs 1 token per scenario");
    expect(setRunFailureReason({ kind: "unreachable", message: "ECONNREFUSED" })).toContain(
      "UNREACHABLE",
    );
    expect(setRunFailureReason({ kind: "not-served" })).toContain("NOT SERVED");
    expect(
      setRunFailureReason({ kind: "refused", status: 502, code: "", message: "bad gateway" }),
    ).toContain("REFUSED (502)");
  });

  test("the RunBookOutcome mapping keeps every arm's sentence for a row with nothing held", () => {
    expect(setFailureAsRunBookOutcome({ kind: "not-served" })).toEqual({ kind: "not-served" });
    expect(
      setFailureAsRunBookOutcome({ kind: "no-batch", message: "m", retryAfterSeconds: 3 }),
    ).toEqual({ kind: "no-batch", message: "m", retryAfterSeconds: 3 });
    expect(setFailureAsRunBookOutcome({ kind: "unreachable", message: "m" })).toEqual({
      kind: "unreachable",
      message: "m",
    });

    // The two arms `RunBookOutcome` cannot carry verbatim ride `failed` WITH
    // the arm-naming sentence — `RunBookOutcome`'s own rate-limited arm is the
    // one that discards messages, and the busy arm exists to keep its own.
    const busyMapped = setFailureAsRunBookOutcome(busy);
    expect(busyMapped.kind).toBe("failed");
    if (busyMapped.kind !== "failed") return;
    expect(busyMapped.status).toBe(503);
    expect(busyMapped.message).toContain("SERVICE BUSY (503 set_run_busy)");

    const rateMapped = setFailureAsRunBookOutcome({
      kind: "rate-limited",
      message: "a set-run costs one token per scenario. This request asked for 15.",
      retryAfterSeconds: 2,
    });
    expect(rateMapped.kind).toBe("failed");
    if (rateMapped.kind !== "failed") return;
    expect(rateMapped.status).toBe(429);
    expect(rateMapped.message).toContain("one token per scenario");
  });
});

// ---------------------------------------------------------------------------
// Bar geometry (LAW-3: rendered CSS px, and nothing but px)
// ---------------------------------------------------------------------------

test.describe("the bar geometry", () => {
  test("bars sort by |ratio| descending, whatever the request order", () => {
    const geometry = tornadoBarGeometry(
      [
        { scenarioId: "small", ratio: -0.25 },
        { scenarioId: "big", ratio: 0.5 },
      ],
      400,
    );
    expect(geometry.bars.map((bar) => bar.scenarioId)).toEqual(["big", "small"]);
    expect(geometry.maxAbsRatio).toBe(0.5);
  });

  test("lengths are proportional on the panel's own scale, and the longest spans the half-width", () => {
    const geometry = tornadoBarGeometry(
      [
        { scenarioId: "big", ratio: 0.5 },
        { scenarioId: "small", ratio: -0.25 },
      ],
      400,
    );
    const [big, small] = geometry.bars;
    expect(big?.width).toBe(192); // axis 200, half-span 192
    expect(small?.width).toBe(96); // exactly half of big — ratio ordering is length ordering
  });

  test("sign picks the side: negative extends LEFT of the axis, positive RIGHT", () => {
    const geometry = tornadoBarGeometry(
      [
        { scenarioId: "up", ratio: 0.5 },
        { scenarioId: "down", ratio: -0.5 },
      ],
      400,
    );
    const up = geometry.bars.find((bar) => bar.scenarioId === "up");
    const down = geometry.bars.find((bar) => bar.scenarioId === "down");
    expect(up?.negative).toBe(false);
    expect(up?.x).toBe(200);
    expect(down?.negative).toBe(true);
    expect(down?.x).toBe(8); // 200 - 192
  });

  test("a nonzero never vanishes and a TRUE zero draws no ink", () => {
    const geometry = tornadoBarGeometry(
      [
        { scenarioId: "huge", ratio: 1 },
        { scenarioId: "tiny", ratio: 0.000001 },
        { scenarioId: "zero", ratio: 0 },
      ],
      400,
    );
    expect(geometry.bars.find((bar) => bar.scenarioId === "tiny")?.width).toBe(1.5);
    expect(geometry.bars.find((bar) => bar.scenarioId === "zero")?.width).toBe(0);
  });

  test("an all-zero panel draws nothing and divides nothing", () => {
    const geometry = tornadoBarGeometry([{ scenarioId: "zero", ratio: 0 }], 400);
    expect(geometry.maxAbsRatio).toBe(0);
    expect(geometry.bars[0]?.width).toBe(0);
  });

  test("ties keep request order (a stable sort, pinned rather than assumed)", () => {
    const geometry = tornadoBarGeometry(
      [
        { scenarioId: "first", ratio: 0.3 },
        { scenarioId: "second", ratio: -0.3 },
      ],
      400,
    );
    expect(geometry.bars.map((bar) => bar.scenarioId)).toEqual(["first", "second"]);
  });
});

// ---------------------------------------------------------------------------
// The remaining composed sentences
// ---------------------------------------------------------------------------

test.describe("the cohort and definition sentences, and the fixed copy", () => {
  test("a row pinned elsewhere names both batches and the SET re-run affordance", () => {
    const sentence = pinnedElsewhereSentence("eth_minus_30", 9, 7);
    expect(sentence).toContain("eth_minus_30 is not drawn");
    expect(sentence).toContain("batch #9");
    expect(sentence).toContain("batch #7");
    expect(sentence).toContain("never drawn shorter or greyer");
    expect(sentence).toContain("Re-run the SET");
  });

  test("the tornado's definition-changed sentence names the fields and the refresh remedy", () => {
    const sentence = tornadoDefinitionChangedSentence(["scenario_version"]);
    expect(sentence).toContain("DEFINITION CHANGED");
    expect(sentence).toContain("scenario_version disagree");
    expect(sentence).toContain("Refresh the listing");
  });

  test("the method line states the axis law's client half", () => {
    expect(TORNADO_METHOD).toContain("eligible_debt_delta_usd over total_debt_usd_before");
    expect(TORNADO_METHOD).toContain("never printed");
    expect(TORNADO_METHOD).toContain("One axis per engine");
    expect(TORNADO_METHOD).toContain("no cross-engine total");
  });

  test("the charge hint names the per-scenario token cost at the affordance", () => {
    const hint = tornadoChargeHint(3);
    expect(hint).toContain("charges one rate-limit token per scenario");
    expect(hint).toContain("running 3 charges 3 token(s)");
    expect(hint).toContain("writes nothing");
  });
});

// ---------------------------------------------------------------------------
// W-TN-B (Codex round 57). The laws below each name the mutant they kill.
// ---------------------------------------------------------------------------

/** A minimal membership-only body for the set-level gate. */
const gateBody = (ids: readonly string[]): RunBookSetResponse =>
  ({
    requested_scenario_ids: [...ids],
    results: ids.map((id) => ({ scenario_id: id })),
    evaluation: { scenarios_evaluated: ids.length },
  }) as unknown as RunBookSetResponse;

test.describe("r57 item 1 — the set gate is bound to the DISPATCHED ids", () => {
  test("set-equal in any order passes; the body's own list alone is never enough", () => {
    expect(setContradiction(gateBody(["a_one", "b_two"]), ["b_two", "a_one"])).toBeNull();
  });

  test("the 4-vs-3 mismatch REFUSES, naming the id nobody's body accounts for", () => {
    // KILLS: the r57-1 defect — a gate that trusts requested_scenario_ids and
    // never reads what was actually POSTed. A body answering 3 of 4 dispatched
    // ids was previously coherent by its own account and rendered.
    const faults = setContradiction(
      gateBody(["a_one", "b_two", "c_three"]),
      ["a_one", "b_two", "c_three", "d_four"],
    );
    expect(faults).not.toBeNull();
    expect(faults?.faults.join(" ")).toContain(
      "d_four was dispatched and is not named in requested_scenario_ids",
    );
  });

  test("the inverse mismatch refuses too: a body claiming ids nobody posted", () => {
    const faults = setContradiction(gateBody(["a_one", "b_two"]), ["a_one"]);
    expect(faults?.faults.join(" ")).toContain(
      "b_two is named in requested_scenario_ids and was not dispatched",
    );
  });
});

// A compact result builder for the cell-state laws.
const cellEngine = (over: Partial<SetRunEngineSummary> = {}): SetRunEngineSummary =>
  ({
    engine: "debt_manager",
    usd_decimals: 6,
    movement_rule: "eligibility_flipped_false_to_true",
    accounts: 1,
    infinite_accounts: 0,
    movement_excluded_accounts: 0,
    flipped_to_eligible: 0,
    hf_dropped_accounts: null,
    eligible_debt_delta_usd: "0",
    total_debt_usd_before: "4200000000",
    market_realization: null,
    projection: null,
    ...over,
  }) as SetRunEngineSummary;

const cellResult = (over: Partial<SetRunScenarioResult> = {}): SetRunScenarioResult =>
  ({
    scenario_id: "eth_minus_30",
    scenario_version: "v1",
    label: "eth -30",
    path_assumption: "instantaneous mark at the shocked level",
    shocks: [],
    shock_reach: {
      declared_shocks: 1,
      declared_shocks_at_identity: 0,
      reach: "every_mark_moved",
      applied_shocks: [{}],
      marks_moved: 1,
      marks_held_by_declared_factor: 0,
      marks_held_by_transform: 0,
      marks_held_by_arithmetic: 0,
      marks_snapped: 0,
      marks_base_snapped: 0,
      marks_cap_bound: 0,
      held_flat_marks: 0,
      held_flat_assets: [],
      note: "",
    },
    covered_engines: ["debt_manager"],
    withheld_engines: [],
    unmeasurable_engines: [],
    engines: [cellEngine()],
    positions_answered: 1,
    positions_withheld: 0,
    note: "",
    ...over,
  }) as unknown as SetRunScenarioResult;

const LISTED_IDENTITY = { scenarioId: "eth_minus_30", version: "v1", configVersion: "v1" };

test.describe("r57 item 2 — the coverage join, both halves", () => {
  test("same-version rows with covered_engines ≠ listing engines are COVERAGE SKEW, naming both sets", () => {
    // KILLS: the r57-2 defect — tornadoCells checked the version and never the
    // engine set, so a definition re-cut without a version bump rendered bars
    // against the wrong coverage.
    const cell = tornadoCellState(
      cellResult({ covered_engines: ["debt_manager"] }),
      "v1",
      LISTED_IDENTITY,
      ["aave_v3_etherfi", "debt_manager"],
    );
    expect(cell.state).toBe("coverage-skew");
    if (cell.state !== "coverage-skew") return;
    expect(cell.sentence).toContain("claims coverage of debt_manager");
    expect(cell.sentence).toContain("covers aave_v3_etherfi and debt_manager");
    expect(cell.sentence).toContain("without its version moving");
    expect(cell.sentence).toContain("refused whole");
  });

  test("a matching coverage under a matching identity still renders bars", () => {
    const cell = tornadoCellState(cellResult(), "v1", LISTED_IDENTITY, ["debt_manager"]);
    expect(cell.state).toBe("bars");
  });

  test("a result whose scenario has NO listing row at all REFUSES as unlisted — never renders", () => {
    // KILLS: the old `listed === undefined` skip, which rendered full bars for
    // a result no committed definition identifies.
    const cell = tornadoCellState(cellResult(), "v1", undefined, undefined);
    expect(cell.state).toBe("unlisted-result");
    if (cell.state !== "unlisted-result") return;
    expect(cell.sentence).toContain("not published by the committed listing");
    expect(cell.sentence).toContain("no bar, no ledger row, no header count");
  });
});

test.describe("r57 item 4 — refused results leave the header's counts and gain their own clause", () => {
  test("a refused result contributes to NO reach or absence count, and the clause names the classes", () => {
    // KILLS: the header counting raw response.results — a refused no-reach row
    // used to ride the "shock did not reach" count while its numbers were
    // refused everywhere else.
    const line = tornadoHeaderLine({
      response: headerResponse("still_newest", 7),
      drawnScenarioIds: ["a_one"],
      filteredDeepLinkIds: [],
      refusals: [
        { scenarioId: "b_two", why: "definition changed" },
        { scenarioId: "c_three", why: "coverage skew" },
      ],
    });
    // b_two is the body's only no-reach row and c_three its only declared-hold
    // row; refused, they count NOWHERE but the refusal clause.
    expect(line).toContain("shock did not reach: 0");
    expect(line).toContain("declared no move: 0");
    expect(line).toContain("engines named absent rather than drawn: 0");
    expect(line).toContain(
      "results refused, not read: 2 (coverage skew: 1, definition changed: 1)",
    );
  });

  test("no refusals, no clause — the header never carries a standing zero", () => {
    expect(
      tornadoHeaderLine({
        response: headerResponse("still_newest", 7),
        drawnScenarioIds: [],
        filteredDeepLinkIds: [],
        refusals: [],
      }),
    ).not.toContain("results refused");
  });
});

test.describe("r57 item 5 — a sentence never points at a block the page does not render", () => {
  test("the projection arm points at the ledger row when the block exists, and names the absence when not", () => {
    const withBlock = tornadoCellState(
      cellResult({
        shock_reach: {
          ...cellResult().shock_reach,
          reach: "projection_no_spot_pass",
        },
        engines: [cellEngine({ projection: {} as SetRunEngineSummary["projection"] })],
      }),
      "v1",
      LISTED_IDENTITY,
      ["debt_manager"],
    );
    expect(withBlock.state).toBe("projection-no-spot-pass");
    if (withBlock.state !== "projection-no-spot-pass") return;
    expect(withBlock.sentence).toContain("projection row in the ledger below is the answer");

    const without = tornadoCellState(
      cellResult({
        shock_reach: { ...cellResult().shock_reach, reach: "projection_no_spot_pass" },
      }),
      "v1",
      LISTED_IDENTITY,
      ["debt_manager"],
    );
    if (without.state !== "projection-no-spot-pass") throw new Error(without.state);
    expect(without.sentence).not.toContain("ledger below is the answer");
    expect(without.sentence).toContain("contract defect, never a zero");
  });

  test("the no-shock-declared arm does the same for market realization", () => {
    const withBlock = tornadoCellState(
      cellResult({
        shock_reach: { ...cellResult().shock_reach, reach: "no_shocks_declared" },
        engines: [
          cellEngine({ market_realization: {} as SetRunEngineSummary["market_realization"] }),
        ],
      }),
      "v1",
      LISTED_IDENTITY,
      ["debt_manager"],
    );
    if (withBlock.state !== "no-shock-declared") throw new Error(withBlock.state);
    expect(withBlock.sentence).toContain("market-realization row in the ledger below");

    const without = tornadoCellState(
      cellResult({
        shock_reach: { ...cellResult().shock_reach, reach: "no_shocks_declared" },
      }),
      "v1",
      LISTED_IDENTITY,
      ["debt_manager"],
    );
    if (without.state !== "no-shock-declared") throw new Error(without.state);
    expect(without.sentence).not.toContain("ledger below");
    expect(without.sentence).toContain("contract defect, never a zero");
  });
});

test.describe("r57 item 6 — the ratio survives 10^400-class Decimals, both ways", () => {
  const huge = `1${"0".repeat(400)}`;

  test("a tiny delta over a huge book is NONZERO and finite: never a measured zero", () => {
    // KILLS: `Number("1") / Number(10^400)` → 1/Infinity → 0, which classified
    // a real nonzero delta as a measured zero.
    const bar = barLength(cellEngine({ eligible_debt_delta_usd: "1", total_debt_usd_before: huge }));
    expect(bar.drawn).toBe(true);
    if (!bar.drawn) return;
    expect(Number.isFinite(bar.ratio)).toBe(true);
    expect(bar.ratio).toBeGreaterThan(0);
    // And the sign survives the same path.
    const negative = barLength(
      cellEngine({ eligible_debt_delta_usd: "-1", total_debt_usd_before: huge }),
    );
    if (!negative.drawn) return;
    expect(negative.ratio).toBeLessThan(0);
  });

  test("huge over huge is the exact quotient, never NaN", () => {
    // KILLS: Number(huge)/Number(huge) → Infinity/Infinity → NaN geometry.
    const bar = barLength(
      cellEngine({ eligible_debt_delta_usd: huge, total_debt_usd_before: `2${"0".repeat(400)}` }),
    );
    if (!bar.drawn) return;
    expect(bar.ratio).toBe(0.5);
  });

  test("huge over small is finite (clamped), and a TRUE zero stays exactly zero", () => {
    const bar = barLength(cellEngine({ eligible_debt_delta_usd: huge, total_debt_usd_before: "1" }));
    if (!bar.drawn) return;
    expect(Number.isFinite(bar.ratio)).toBe(true);
    expect(bar.ratio).toBeGreaterThan(0);

    const zero = barLength(
      cellEngine({ eligible_debt_delta_usd: "0", total_debt_usd_before: huge }),
    );
    if (!zero.drawn) return;
    expect(zero.ratio).toBe(0);
  });

  test("the geometry over those ratios carries no NaN and no vanished nonzero", () => {
    const tiny = barLength(cellEngine({ eligible_debt_delta_usd: "1", total_debt_usd_before: huge }));
    const whole = barLength(
      cellEngine({ eligible_debt_delta_usd: huge, total_debt_usd_before: huge }),
    );
    if (!tiny.drawn || !whole.drawn) return;
    const geometry = tornadoBarGeometry(
      [
        { scenarioId: "tiny", ratio: tiny.ratio },
        { scenarioId: "whole", ratio: whole.ratio },
      ],
      400,
    );
    for (const bar of geometry.bars) {
      expect(Number.isFinite(bar.width)).toBe(true);
      expect(Number.isFinite(bar.x)).toBe(true);
      expect(bar.width).toBeGreaterThan(0);
    }
  });
});

test.describe("r57 item 7 — the tornado's own 1.5px floor is flagged and disclosed", () => {
  test("1e-6 and 1e-12 ratios are both floored AND flagged; the anchor is neither", () => {
    // KILLS: a geometry that floors the width silently — the flag and count
    // are what the disclosure sentence and data-floored rects are pinned to.
    const geometry = tornadoBarGeometry(
      [
        { scenarioId: "anchor", ratio: 1 },
        { scenarioId: "micro", ratio: 0.000001 },
        { scenarioId: "pico", ratio: 1e-12 },
      ],
      400,
    );
    const of = (id: string) => geometry.bars.find((bar) => bar.scenarioId === id);
    expect(of("micro")?.width).toBe(1.5);
    expect(of("micro")?.floored).toBe(true);
    expect(of("pico")?.width).toBe(1.5);
    expect(of("pico")?.floored).toBe(true);
    expect(of("anchor")?.floored).toBe(false);
    expect(geometry.flooredCount).toBe(2);
  });

  test("a TRUE zero is not floored — no ink is not lifted ink", () => {
    const geometry = tornadoBarGeometry(
      [
        { scenarioId: "anchor", ratio: 1 },
        { scenarioId: "zero", ratio: 0 },
      ],
      400,
    );
    const zero = geometry.bars.find((bar) => bar.scenarioId === "zero");
    expect(zero?.width).toBe(0);
    expect(zero?.floored).toBe(false);
    expect(geometry.flooredCount).toBe(0);
  });

  test("the disclosure sentence is computed, singular at one, and ABSENT at zero", () => {
    expect(tornadoFloorSentence(0)).toBeNull();
    expect(tornadoFloorSentence(1)).toBe(
      "1 bar is shorter than the 1.5px visibility floor and renders at it, off that scale; " +
        "its exact figures are in the table.",
    );
    expect(tornadoFloorSentence(2)).toBe(
      "2 bars are shorter than the 1.5px visibility floor and render at it, off that scale; " +
        "their exact figures are in the table.",
    );
  });
});

test.describe("r57 item 8 — the drawn count counts RECTS; measured zero gets its own clause", () => {
  test("the clause is appended right after the drawn clause, only when nonzero", () => {
    const line = tornadoHeaderLine({
      response: headerResponse("still_newest", 7),
      drawnScenarioIds: ["a_one"],
      filteredDeepLinkIds: [],
      measuredZeroScenarioIds: ["b_two"],
    });
    expect(line).toContain(
      "bars drawn for 1 of 3 requested scenario(s) · measured zero: 1 · shock did not reach",
    );
    const clean = tornadoHeaderLine({
      response: headerResponse("still_newest", 7),
      drawnScenarioIds: ["a_one"],
      filteredDeepLinkIds: [],
      measuredZeroScenarioIds: [],
    });
    expect(clean).not.toContain("measured zero");
  });
});

test.describe("r57 item 12b — the cause figures come from the cause counts, never a reach total", () => {
  test("the asymmetric split prints exactly its three cause figures", () => {
    // KILLS: a renderer sourcing the cause sentence from len(applied_shocks)
    // (7), marks_moved (1... distinct), the flag census (2/1/1, sum 4) or
    // declared_shocks: every confound differs from every cause figure printed.
    const split = cellResult({
      shock_reach: {
        ...cellResult().shock_reach,
        reach: "some_marks_held",
        applied_shocks: [{}, {}, {}, {}, {}, {}, {}],
        marks_moved: 1,
        marks_held_by_transform: 3,
        marks_held_by_declared_factor: 2,
        marks_held_by_arithmetic: 1,
        marks_snapped: 2,
        marks_base_snapped: 1,
        marks_cap_bound: 1,
      },
    } as unknown as Partial<SetRunScenarioResult>);
    expect(heldCauseSentence(split)).toBe(
      "Of the held marks: 3 pinned by the stable snap, a snapped base or a bound cap, " +
        "2 held at the factor this scenario declared for them, " +
        "1 unchanged by exact-integer arithmetic.",
    );
    expect(heldCauseSentence(split)).not.toContain("7");
    expect(heldCauseSentence(split)).not.toContain("4");
    expect(heldCauseSentence(split)).not.toMatch(/\d+ of \d+ snapped/);
  });
});

test.describe("r57 item 3c — the matrix empty state stops lying once a set has run", () => {
  test("hasSetRun swaps ONLY the no-run arm, and the sentence points at the tornado surface", () => {
    // KILLS: the header claiming "no run has been issued yet" over a session
    // whose first action was a set run that settled 200.
    const cold = resolveBatchCohort(new Map());
    expect(batchHeaderLine(cold, null, false)).toBe(MATRIX_NO_RUN_LINE);
    expect(batchHeaderLine(cold, null, true)).toBe(MATRIX_SET_RUN_ONLY_LINE);
    expect(MATRIX_SET_RUN_ONLY_LINE).toContain("no single-scenario run has been issued yet");
    expect(MATRIX_SET_RUN_ONLY_LINE).toContain("A set run HAS been issued this session");
    expect(MATRIX_SET_RUN_ONLY_LINE).toContain("tornado surface below");
    expect(MATRIX_SET_RUN_ONLY_LINE).toContain("speak only for single-scenario runs");
    // The swap never leaks into a session that DID issue a single run: with an
    // anchor on the table, the flag changes nothing.
    expect(batchHeaderLine(cold, 1, true)).toBe(
      `${MATRIX_SET_RUN_ONLY_LINE} The loss frontier above reads batch #1.`,
    );
  });
});
