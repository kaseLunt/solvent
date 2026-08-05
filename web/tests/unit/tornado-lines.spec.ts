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

import type { RunBookSetResponse, SetRunOutcome } from "../../lib/runbookSet";
import {
  deepLinkDecision,
  pinnedElsewhereSentence,
  setFailureAsRunBookOutcome,
  setRunFailureReason,
  tornadoBarGeometry,
  tornadoChargeHint,
  tornadoDefinitionChangedSentence,
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
