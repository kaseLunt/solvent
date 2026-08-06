// W-TN / W-TN-B — the TORNADO surface: one batch snapshot × N committed
// scenarios as per-engine diverging impact bars, against mock routes whose
// bodies are GENERATED fixtures (tests/fixtures/generate-run-book-set.mjs
// documents the provenance: the contract's own run-book-set 200 and 503
// examples extracted verbatim from api/openapi.yaml, plus documented variants
// and the extended listing derived from the committed scenario definition
// files). Nothing here is hand-shaped; the inline mutants below are documented
// single-purpose mutations of those generated bodies, in the W-SK-B style.
//
// What this file pins (r57 items named where they land):
//   - the dispatch names EXPLICIT ids, and the rendered set is BOUND to them
//     (r57 item 1): a body whose requested_scenario_ids is not set-equal to
//     the dispatched ids refuses WHOLE, naming the ids;
//   - one bar per drawable scenario × engine, |ratio| ordering correct, signs
//     diverging on the REAL axis geometry (r57 item 12a), and NO numbers
//     inside the VISUAL — every exact string is in the LEDGER (LAW-5);
//   - DECLARED HOLD and SHOCK DID NOT REACH render with their OWN sentences
//     and no bar rect, and the forbidden "K of K snapped" sentence is absent;
//   - the PARTLY REACHED cause split prints the three marks_held_by_* figures
//     and never a reach total (r57 item 12b, the de-confounded fixture);
//   - the projection and market-realization blocks render as their OWN ledger
//     rows and the cell sentences point at rows that exist (r57 item 5), and
//     the out_of_model clause rides every admitted ledger row;
//   - a REFUSED result (definition changed here) contributes no ledger row and
//     no header count, and the header carries the refusal clause (r57 item 4);
//   - NO DENOMINATOR is a visible state, not empty space, and divides nothing;
//   - the tornado's own 1.5px floor is flagged per rect and disclosed by a
//     computed per-panel sentence (r57 item 7);
//   - "bars drawn" counts scenarios that rendered at least one RECT, and the
//     measured-zero clause counts the all-zero-reached rest (r57 item 8);
//   - the K-of-M movement grammar, incl. the excluded-population clause;
//   - the composed §9.6 header, for still_newest and for the superseded arm;
//   - the ?scenarios= deep link auto-runs against the listing in hand,
//     filtered ids are NAMED, ?scenario=&?scenarios= together run NOTHING,
//     and ?scenarios=* is refused by name;
//   - the deep-link notice and header clause describe the DISPATCH from the
//     run's own stored record, surviving a listing refresh that publishes a
//     filtered id (r57 item 11), and both speak in dispatch-time PAST tense
//     (r58 item 6) so the survival never reads as a false present-tense
//     statement;
//   - while a set run is in flight the run affordance is disabled WITH its
//     reason and a second dispatch (UI or a direct second auto-run) is
//     refused at the source: exactly one POST reaches the sink (r58 item 2);
//   - the committed cause fixture's three figures are pairwise distinct from
//     each other and from every non-cause figure, asserted over the bytes
//     themselves (r58 item 7);
//   - a 200 set settle restores every matrix row's prior phase EXACTLY: true
//     idle for rows that held nothing, original stamps and rerunFailed records
//     for rows that held evidence, and a set-aware empty-state sentence where
//     "no run has been issued yet" would now be a lie (r57 item 3);
//   - a bodyless 503 busy settlement fails all N rows at once: a row holding
//     a result keeps it at its own pin with the busy arm named beside it, and
//     a row holding nothing reads UNANSWERED with the same arm named;
//   - §9.5: a row re-run singly onto a newer batch leaves the chart into its
//     own named state, and the header's drawn count moves with it.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test, type Page, type Route } from "@playwright/test";

const API = "http://localhost:8080";

function fixture(name: string): string {
  return readFileSync(fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url)), "utf8");
}

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "content-type, accept",
};

function json(route: Route, body: string, status = 200) {
  return route.fulfill({ status, contentType: "application/json", headers: CORS, body });
}

/**
 * The two COLD routes book mode reads on arrival. Neither is a run. The
 * listing defaults to the committed base listing; the tests that dispatch the
 * contract example's own three ids serve the EXTENDED listing instead
 * (run-book-set.scenarios.json), because r57 items 1 and 2 bind the rendered
 * set to the dispatched ids and the dispatched ids to the listing.
 */
async function mockCold(page: Page, listing: () => string = () => fixture("scenarios.json")) {
  await page.route("**/v1/stream**", (route) => route.abort());
  await page.route(`${API}/v1/scenarios`, (route) => json(route, listing()));
  await page.route(`${API}/v1/book`, (route) => json(route, fixture("book.json")));
}

/**
 * Mock the set-run POST. The request carries `Content-Type: application/json`,
 * so the browser preflights it; the OPTIONS leg is answered here too. Captured
 * bodies are pushed into `sink` so a test can pin EXACTLY what was named.
 */
async function mockSetRun(
  page: Page,
  body: () => { status: number; body: string },
  sink: string[],
) {
  await page.route(`${API}/v1/scenarios/run-book-set`, (route) => {
    if (route.request().method() === "OPTIONS") {
      return route.fulfill({ status: 204, headers: CORS, body: "" });
    }
    sink.push(route.request().postData() ?? "");
    const answer = body();
    return json(route, answer.body, answer.status);
  });
}

const SET_200 = () => ({ status: 200, body: fixture("run-book-set.json") });
const SET_VARIANT = () => ({ status: 200, body: fixture("run-book-set.no-denominator.json") });
const SET_SUPERSEDED = () => ({ status: 200, body: fixture("run-book-set.superseded.json") });
const SET_BUSY = () => ({ status: 503, body: fixture("run-book-set.busy.json") });

/** The contract example's own ids, in the EXTENDED listing's pick order. */
const EXAMPLE_IDS = ["eth_minus_30", "stable_depeg_0995_in_band", "dm_composition_census"];

/** The extended variant's four ids, in the base listing's own order. */
const VARIANT_IDS = [
  "eth_minus_30",
  "weeth_market_depeg_oracles_held",
  "dm_rate_horizon_plus_200bps",
  "ethfi_minus_50",
];
const VARIANT_LINK = `/lab?scenarios=${VARIANT_IDS.join(",")}`;

// The contract example's own header arithmetic: 3 requested, one drawable
// (eth_minus_30), one snap control (no_mark_moved), one identity census
// (all_shocks_declared_at_identity), no absent engines, nothing refused.
const EXAMPLE_HEADER =
  "batch 1 · bars drawn for 1 of 3 requested scenario(s) · shock did not reach: 1 · " +
  "declared no move: 1 · engines named absent rather than drawn: 0";

// The extended variant's header arithmetic: 4 requested, two rect-drawing
// scenarios (eth_minus_30, ethfi_minus_50), the no-shock and projection rows
// draw nothing and are neither no-reach nor declared-no-move.
const VARIANT_HEADER =
  "batch 1 · bars drawn for 2 of 4 requested scenario(s) · shock did not reach: 0 · " +
  "declared no move: 0 · engines named absent rather than drawn: 0";

/** Check the named tornado picks, in the order given. */
async function pick(page: Page, ids: readonly string[]) {
  for (const id of ids) {
    await page.locator(`[data-testid="tornado-pick"][data-scenario-id="${id}"]`).check();
  }
}

// ---------------------------------------------------------------------------
// Documented inline mutants (the W-SK-B style: one mutation, one law each).
// ---------------------------------------------------------------------------

interface SetBodyShape {
  results: {
    scenario_id: string;
    scenario_version: string;
    engines: { engine: string; eligible_debt_delta_usd: string }[];
  }[];
}

/** r57 item 4's vehicle: one result's version bumped, identity now disagreeing. */
function withResultVersionBumped(raw: string, scenarioId: string): string {
  const body = JSON.parse(raw) as SetBodyShape;
  const result = body.results.find((candidate) => candidate.scenario_id === scenarioId);
  if (result === undefined) throw new Error(`the fixture answers no ${scenarioId}`);
  result.scenario_version = "v2";
  return JSON.stringify(body);
}

/** One engine row's delta replaced; everything else byte-identical. */
function withDelta(raw: string, scenarioId: string, engine: string, delta: string): string {
  const body = JSON.parse(raw) as SetBodyShape;
  const result = body.results.find((candidate) => candidate.scenario_id === scenarioId);
  const row = result?.engines.find((candidate) => candidate.engine === engine);
  if (row === undefined) throw new Error(`the fixture has no ${scenarioId}/${engine} row`);
  row.eligible_debt_delta_usd = delta;
  return JSON.stringify(body);
}

interface ListingShape {
  scenarios: Record<string, unknown>[];
}

/** The base listing plus a ghost_b definition — r57 item 11's refresh target. */
function listingWithGhost(raw: string): string {
  const body = JSON.parse(raw) as ListingShape;
  body.scenarios.push({
    id: "ghost_b",
    version: "v1",
    label: "ghost b",
    description: "published only after the refresh, to tempt a live recompute",
    path_assumption: "instantaneous mark at the shocked level",
    engines: ["debt_manager"],
    shocks: [],
    out_of_model: [],
  });
  return JSON.stringify(body);
}

// ---------------------------------------------------------------------------
// The happy path, bound to the dispatch (r57 items 1, 2, 5, 12b)
// ---------------------------------------------------------------------------

test("the happy path posts exactly the fixture's own ids; the three reach classes render apart", async ({
  page,
}) => {
  const posts: string[] = [];
  await mockCold(page, () => fixture("run-book-set.scenarios.json"));
  await mockSetRun(page, SET_200, posts);

  await page.goto("/lab");
  await expect(page.getByTestId("lab-tornado")).toBeVisible();

  // r57 item 1 — the picks ARE the body's own three ids: dispatched and
  // requested must be set-equal for anything to render at all.
  await pick(page, EXAMPLE_IDS);
  await expect(page.getByTestId("tornado-charge-hint")).toContainText(
    "running 3 charges 3 token(s)",
  );
  await page.getByTestId("tornado-run").click();

  await expect(page.getByTestId("tornado-header")).toHaveText(EXAMPLE_HEADER);
  expect(posts).toEqual([JSON.stringify({ scenario_ids: EXAMPLE_IDS })]);
  expect(posts[0]).not.toContain("*");

  // SHOCK DID NOT REACH: its own sentence, composed from the three
  // `marks_held_by_*` causes — never the flag census, and never "K of K
  // snapped", which is false on this very fixture (3 snapped + 1 base_snapped).
  const noReach = page.locator(
    '[data-testid="tornado-state"][data-state="shock-did-not-reach"]',
  );
  await expect(noReach).toHaveCount(1);
  await expect(noReach).toContainText("SHOCK DID NOT REACH");
  await expect(noReach).toContainText("came back at the value it started at");
  await expect(noReach).toContainText("4 pinned by the stable snap, a snapped base or a bound cap");
  await expect(noReach).not.toContainText(/\d+ of \d+ snapped/);

  // DECLARED HOLD: its OWN sentence — the definition asked for the hold, and
  // the swallowed-move wording never appears under it.
  const hold = page.locator('[data-testid="tornado-state"][data-state="declared-hold"]');
  await expect(hold).toHaveCount(1);
  await expect(hold).toContainText("DECLARED HOLD");
  await expect(hold).toContainText("BY DECISION rather than by accident");
  await expect(hold).toContainText("no move is asserted");
  await expect(hold).not.toContainText("came back at the value it started at");

  // Neither structurally-zero class draws a bar rect, anywhere, at any length.
  await expect(
    page.locator('[data-testid="tornado-bar"][data-scenario-id="stable_depeg_0995_in_band"]'),
  ).toHaveCount(0);
  await expect(
    page.locator('[data-testid="tornado-bar"][data-scenario-id="dm_composition_census"]'),
  ).toHaveCount(0);

  // The drawable scenario: one panel per engine, never one axis across. The
  // aave panel draws its bar; the dm panel's delta is a TRUE measured zero, so
  // it draws NO ink and says it was measured.
  const aavePanel = page.getByTestId("tornado-panel-aave_v3_etherfi");
  await expect(aavePanel.getByTestId("tornado-panel-unit")).toContainText("usd_decimals 8");
  const aaveBar = aavePanel.locator('[data-testid="tornado-bar"]');
  await expect(aaveBar).toHaveCount(1);
  await expect(aaveBar).toHaveAttribute("data-scenario-id", "eth_minus_30");
  await expect(aaveBar).toHaveAttribute("data-negative", "false");

  const dmPanel = page.getByTestId("tornado-panel-debt_manager");
  await expect(dmPanel.getByTestId("tornado-panel-unit")).toContainText("usd_decimals 6");
  await expect(dmPanel.locator('[data-testid="tornado-bar"]')).toHaveCount(0);
  await expect(dmPanel.getByTestId("tornado-zero-bar")).toContainText("measured zero");

  // LEDGER (LAW-5): the exact strings, unrounded, for every scenario × engine
  // row — including the K-of-M movement grammar, and (r57 item 5) the
  // out_of_model clause on every row whose committed definition carries one.
  const aaveRow = page.locator(
    '[data-testid="tornado-ledger-row"][data-scenario-id="eth_minus_30"][data-engine="aave_v3_etherfi"]',
  );
  await expect(aaveRow).toContainText("+$6,000");
  await expect(aaveRow).toContainText("$6,000");
  await expect(aaveRow).toContainText("1 of 1 health factors strictly dropped.");
  await expect(aaveRow).toContainText("every_mark_moved");
  await expect(aaveRow).toContainText("read with 6 committed out-of-model exclusion(s)");

  const controlRow = page.locator(
    '[data-testid="tornado-ledger-row"][data-scenario-id="stable_depeg_0995_in_band"][data-engine="debt_manager"]',
  );
  await expect(controlRow).toContainText("$0");
  await expect(controlRow).toContainText("0 of 1 accounts flipped into eligibility.");
  await expect(controlRow).toContainText("no_mark_moved");
  await expect(controlRow).toContainText(
    "4 pinned by the stable snap, a snapped base or a bound cap",
  );
  await expect(controlRow).toContainText("read with 11 committed out-of-model exclusion(s)");

  // Nothing was refused and nothing measured zero as a whole scenario, so
  // neither clause renders — no standing zeros in this header.
  await expect(page.getByTestId("tornado-header")).not.toContainText("results refused");
  await expect(page.getByTestId("tornado-header")).not.toContainText("measured zero");

  await expect(page.getByTestId("tornado-method")).toContainText("One axis per engine");
});

test("r57 item 1 — the 4-vs-3 dispatch/body mismatch REFUSES the whole set, naming the id", async ({
  page,
}) => {
  // KILLS: the gate that trusted the body's own requested_scenario_ids. The
  // old happy path posted FOUR ids while the body declared THREE, and the
  // surface rendered anyway — blessing exactly this defect.
  const posts: string[] = [];
  await mockCold(page, () => fixture("run-book-set.scenarios.json"));
  await mockSetRun(page, SET_200, posts);

  await page.goto("/lab");
  await pick(page, [...EXAMPLE_IDS, "ethfi_minus_50"]);
  await page.getByTestId("tornado-run").click();

  const refusal = page.getByTestId("tornado-contradictory-set");
  await expect(refusal).toBeVisible();
  await expect(refusal).toContainText(
    "ethfi_minus_50 was dispatched and is not named in requested_scenario_ids",
  );
  await expect(refusal).toContainText("answers a set this page never dispatched");
  // No cell, no ledger row, no header contribution — the WHOLE body refuses.
  await expect(page.getByTestId("tornado-header")).toHaveCount(0);
  await expect(page.locator('[data-testid="tornado-bar"]')).toHaveCount(0);
  await expect(page.locator('[data-testid="tornado-ledger-row"]')).toHaveCount(0);
  expect(posts).toHaveLength(1);
  expect(posts[0]).toBe(
    JSON.stringify({ scenario_ids: [...EXAMPLE_IDS.slice(0, 1), "ethfi_minus_50", ...EXAMPLE_IDS.slice(1)] }),
  );
});

test("select-all still posts every listed id EXPLICITLY, and a superset dispatch refuses whole", async ({
  page,
}) => {
  // The explicit-ids law survives the repaired happy path: select-all is a
  // client convenience over the listing in hand, the body names all six ids
  // and no wildcard — and because the 200 example answers only three, the
  // r57 item 1 gate refuses the render rather than trusting the body.
  const posts: string[] = [];
  await mockCold(page, () => fixture("run-book-set.scenarios.json"));
  await mockSetRun(page, SET_200, posts);

  await page.goto("/lab");
  await page.getByTestId("tornado-select-all").click();
  await expect(page.getByTestId("tornado-charge-hint")).toContainText(
    "running 6 charges 6 token(s)",
  );
  await page.getByTestId("tornado-run").click();

  expect(posts).toEqual([
    JSON.stringify({
      scenario_ids: [
        "eth_minus_30",
        "weeth_market_depeg_oracles_held",
        "dm_rate_horizon_plus_200bps",
        "ethfi_minus_50",
        "stable_depeg_0995_in_band",
        "dm_composition_census",
      ],
    }),
  ]);
  expect(posts[0]).not.toContain("*");
  const refusal = page.getByTestId("tornado-contradictory-set");
  await expect(refusal).toBeVisible();
  await expect(refusal).toContainText(
    "ethfi_minus_50 was dispatched and is not named in requested_scenario_ids",
  );
});

// ---------------------------------------------------------------------------
// The deep link (§9.2)
// ---------------------------------------------------------------------------

test("?scenarios= rides the listing arrival: one POST, only published ids, filtered ids NAMED", async ({
  page,
}) => {
  const posts: string[] = [];
  await mockCold(page, () => fixture("run-book-set.scenarios.json"));
  await mockSetRun(page, SET_200, posts);

  await page.goto(`/lab?scenarios=${EXAMPLE_IDS.join(",")},nope_id`);

  await expect(page.getByTestId("tornado-header")).toBeVisible();
  expect(posts).toEqual([JSON.stringify({ scenario_ids: EXAMPLE_IDS })]);

  // R58 item 6 — this is the SETTLED surface: the notice it renders is the
  // run's stored dispatch record, in dispatch-time past tense.
  const notice = page.getByTestId("tornado-deeplink-notice");
  await expect(notice).toContainText("You asked for 4 scenario(s).");
  await expect(notice).toContainText(
    "This deployment did not publish these ids when the set was dispatched: nope_id.",
  );
  await expect(notice).toContainText("Only the 3 published one(s) were dispatched.");
  await expect(notice).not.toContainText("this deployment publishes");

  // §9.6 — the filtered ids ride the composed header too, in the same tense.
  await expect(page.getByTestId("tornado-header")).toContainText(
    "filtered from the deep link, not published AT DISPATCH: nope_id",
  );
});

test("?scenario= AND ?scenarios= together run NOTHING and render the named notice", async ({
  page,
}) => {
  const posts: string[] = [];
  let singleRuns = 0;
  await mockCold(page);
  await mockSetRun(page, SET_200, posts);
  await page.route(`${API}/v1/scenarios/*/run-book`, (route) => {
    singleRuns += 1;
    return route.abort();
  });

  await page.goto("/lab?scenario=eth_minus_30&scenarios=ethfi_minus_50");

  const notice = page.getByTestId("tornado-deeplink-notice");
  await expect(notice).toContainText("both ?scenario= and ?scenarios=");
  await expect(notice).toContainText("NOTHING was run");
  await expect(notice).toContainText("no precedence is guessed");
  expect(posts).toEqual([]);
  expect(singleRuns).toBe(0);
});

test("?scenarios=* is refused by name and dispatches nothing", async ({ page }) => {
  const posts: string[] = [];
  await mockCold(page);
  await mockSetRun(page, SET_200, posts);

  await page.goto("/lab?scenarios=*");

  const notice = page.getByTestId("tornado-deeplink-notice");
  await expect(notice).toContainText("A * is never expanded");
  await expect(notice).toContainText("Nothing was dispatched");
  expect(posts).toEqual([]);
});

// ---------------------------------------------------------------------------
// The extended variant (r57 items 5, 12a, 12b, plus the W-TN geometry laws)
// ---------------------------------------------------------------------------

test("ordering, sign, the REAL axis side, NO DENOMINATOR, the cause split and the block rows", async ({
  page,
}) => {
  const posts: string[] = [];
  await mockCold(page);
  await mockSetRun(page, SET_VARIANT, posts);

  await page.goto(VARIANT_LINK);
  await expect(page.getByTestId("tornado-header")).toHaveText(VARIANT_HEADER);

  // THE DM PANEL: two bars, sorted by |ratio| DESC (0.5 above 0.25) — the
  // REVERSE of request order, so a renderer that kept request order fails —
  // with the negative bar on the left of the axis.
  const dmPanel = page.getByTestId("tornado-panel-debt_manager");
  const dmBars = dmPanel.locator('[data-testid="tornado-bar"]');
  await expect(dmBars).toHaveCount(2);
  await expect(dmBars.nth(0)).toHaveAttribute("data-scenario-id", "ethfi_minus_50");
  await expect(dmBars.nth(0)).toHaveAttribute("data-negative", "false");
  await expect(dmBars.nth(1)).toHaveAttribute("data-scenario-id", "eth_minus_30");
  await expect(dmBars.nth(1)).toHaveAttribute("data-negative", "true");
  const widthOf = async (i: number) =>
    Number.parseFloat((await dmBars.nth(i).getAttribute("width")) ?? "0");
  expect(await widthOf(0)).toBeGreaterThan(await widthOf(1));
  // 0.5 against 0.25 on one panel scale: exactly twice as long.
  expect(await widthOf(0)).toBeCloseTo((await widthOf(1)) * 2, 5);

  // r57 item 12a — THE REAL AXIS-SIDE LAW. data-negative is an attribute a
  // mirrored renderer could still stamp correctly; the INK is what must sit on
  // the correct side of the axis line. A negative rect ends AT or LEFT of the
  // axis; a positive rect starts AT or RIGHT of it.
  const axisX = Number(await dmPanel.locator("line").getAttribute("x1"));
  expect(Number.isFinite(axisX)).toBe(true);
  const rectEdges = async (i: number) => {
    const x = Number(await dmBars.nth(i).getAttribute("x"));
    const width = Number(await dmBars.nth(i).getAttribute("width"));
    return { left: x, right: x + width };
  };
  const positive = await rectEdges(0); // ethfi_minus_50, +0.5
  const negative = await rectEdges(1); // eth_minus_30, -0.25
  expect(positive.left).toBeGreaterThanOrEqual(axisX - 0.01);
  expect(negative.right).toBeLessThanOrEqual(axisX + 0.01);
  expect(negative.left).toBeLessThan(axisX);

  // THE AAVE PANEL: an answered engine whose before-side debt is "0" is the
  // NO DENOMINATOR state — visibly a state, never a bar and never a division.
  const noDenominator = page.getByTestId("tornado-no-denominator");
  await expect(noDenominator).toHaveCount(1);
  await expect(noDenominator).toContainText("NO DENOMINATOR");
  await expect(noDenominator).toContainText("no debt on the before side");
  await expect(
    page
      .getByTestId("tornado-panel-aave_v3_etherfi")
      .locator('[data-testid="tornado-bar"]'),
  ).toHaveCount(0);

  // r57 item 12b / r58 item 7 / r60-C — THE DE-CONFOUNDED CAUSE SPLIT. ethfi
  // is PARTLY REACHED and its three cause figures (7/4/5) are pairwise
  // distinct AND equal NO other figure on the result wire: applied length is
  // 17, marks_moved is 1, declared_shocks is 1, the flag census is 3/3/3
  // (pair sums 6/6/6, total 9), and — the counts r60-C added — the result's
  // positions_answered and its engine row's accounts are both 2. A renderer
  // sourcing any cause from any of those goes red here.
  const partly = page.locator(
    '[data-testid="tornado-state"][data-state="partly-reached"]',
  );
  await expect(partly).toHaveCount(1);
  await expect(partly).toContainText("PARTLY REACHED");
  await expect(partly).toContainText("1 of 17 marks");
  await expect(partly).toContainText("7 pinned by the stable snap, a snapped base or a bound cap");
  await expect(partly).toContainText("4 held at the factor this scenario declared for them");
  await expect(partly).toContainText("5 unchanged by exact-integer arithmetic");
  await expect(partly).not.toContainText(/\d+ of \d+ snapped/);

  // r57 item 5 — the structurally-zero arms point at blocks that EXIST. The
  // no-shock scenario names the market-realization row; the projection names
  // the projection row; both rows are in the ledger with exact strings.
  const noShock = page.locator(
    '[data-testid="tornado-state"][data-state="no-shock-declared"]',
  );
  await expect(noShock).toHaveCount(1);
  await expect(noShock).toContainText("market-realization row in the ledger below");
  const projectionState = page.locator(
    '[data-testid="tornado-state"][data-state="projection-no-spot-pass"]',
  );
  await expect(projectionState).toHaveCount(1);
  await expect(projectionState).toContainText("projection row in the ledger below is the answer");

  await expect(
    page.locator('[data-testid="tornado-ledger-block"][data-block="market-realization"]'),
  ).toHaveCount(2);
  const weethAaveBlock = page.locator(
    '[data-testid="tornado-ledger-block"][data-block="market-realization"][data-engine="aave_v3_etherfi"]',
  );
  await expect(weethAaveBlock).toContainText("market_realization");
  await expect(weethAaveBlock).toContainText("hfs unchanged: true");
  await expect(weethAaveBlock).toContainText("execution shortfall $840");
  await expect(weethAaveBlock).toContainText("bad debt at liquidation $231");
  await expect(weethAaveBlock).toContainText("pro-rata-over-counted-collateral");
  const weethDmBlock = page.locator(
    '[data-testid="tornado-ledger-block"][data-block="market-realization"][data-engine="debt_manager"]',
  );
  await expect(weethDmBlock).toContainText("execution shortfall $3,100");
  await expect(weethDmBlock).toContainText("bad debt at liquidation $1,250");
  // r58 item 3 — the block rows carry the out_of_model clause too, same
  // grammar, from the same committed-listing join: for these scenarios the
  // block IS the answer, and the answer may not shed the committed exclusions
  // the numeric rows disclose.
  await expect(weethAaveBlock).toContainText("read with 6 committed out-of-model exclusion(s)");
  await expect(weethDmBlock).toContainText("read with 6 committed out-of-model exclusion(s)");

  const projectionBlock = page.locator(
    '[data-testid="tornado-ledger-block"][data-block="projection"]',
  );
  await expect(projectionBlock).toHaveCount(1);
  await expect(projectionBlock).toContainText("projection · delta-only · +200 bps annual");
  await expect(projectionBlock).toContainText("prices held flat: true");
  await expect(projectionBlock).toContainText(
    "horizon 86400s: debt $4,200, projected $4,200.230136, additional interest $0.230136, becomes liquidatable: false",
  );
  // A null becomes_liquidatable is NOT STATED — a different fact from false.
  await expect(projectionBlock).toContainText(
    "horizon 2592000s: debt $4,200, projected $4,206.904109, additional interest $6.904109, becomes liquidatable: not stated",
  );
  // r58 item 3 — the projection block row carries the clause too.
  await expect(projectionBlock).toContainText(
    "read with 7 committed out-of-model exclusion(s)",
  );

  // The movement grammar, both halves: the plain K of M, and the
  // excluded-population clause on the debt-free aave account.
  const aaveLedger = page.locator(
    '[data-testid="tornado-ledger-row"][data-scenario-id="eth_minus_30"][data-engine="aave_v3_etherfi"]',
  );
  await expect(aaveLedger).toContainText("0 of 0 health factors strictly dropped.");
  await expect(aaveLedger).toContainText(
    "1 of the 1 measured accounts could not be tested for movement at all",
  );
  const dmLedger = page.locator(
    '[data-testid="tornado-ledger-row"][data-scenario-id="eth_minus_30"][data-engine="debt_manager"]',
  );
  await expect(dmLedger).toContainText("0 of 2 accounts flipped into eligibility.");
  await expect(dmLedger).toContainText("−$1,050");
  const ethfiLedger = page.locator(
    '[data-testid="tornado-ledger-row"][data-scenario-id="ethfi_minus_50"][data-engine="debt_manager"]',
  );
  await expect(ethfiLedger).toContainText("1 of 2 accounts flipped into eligibility.");
  await expect(ethfiLedger).toContainText("+$2,100");
  await expect(ethfiLedger).toContainText("read with 8 committed out-of-model exclusion(s)");

  // Zero-disclosure halves (r57 items 7 and 8): nothing here sits on the
  // floor and no scenario measured zero as a whole, so neither disclosure
  // renders and every rect states data-floored="false".
  await expect(page.getByTestId("tornado-floor-note")).toHaveCount(0);
  await expect(
    page.locator('[data-testid="tornado-bar"][data-floored="true"]'),
  ).toHaveCount(0);
  await expect(page.getByTestId("tornado-header")).not.toContainText("measured zero");

  // The left-clip guard, same law the waterfall ticks carry: every row label
  // renders WHOLE. The gutter is sized from a probe that must measure the
  // label class's own letter-spacing; an under-measured gutter renders
  // "eth_minus_60" as ":th_minus_60" and this bbox check is what fails on it.
  const labelBoxes = await page
    .getByTestId("tornado-panel-debt_manager")
    .locator('text[data-testid="tornado-bar-label"]')
    .evaluateAll((nodes) =>
      nodes.map((node) => {
        const text = node as unknown as SVGTextElement;
        return { label: text.textContent ?? "", x: text.getBBox().x };
      }),
    );
  expect(labelBoxes.length).toBeGreaterThan(0);
  for (const box of labelBoxes) {
    expect(box.x, `row label clips left: ${box.label}`).toBeGreaterThanOrEqual(0);
  }
});

test("r58 item 7 / r60-C — the committed fixture's cause figures are impersonated by NO other figure on the result", () => {
  // KILLS: a fixture edit that re-confounds a cause figure with ANY integer
  // count or array length on the result wire shape without going through the
  // generator's own refusal. The r58 escape was declared-factor ==
  // marks_snapped at 2 and arithmetic == marks_moved at 1; the r60 escape was
  // arithmetic == positions_answered == engines[0].accounts, all at 2 —
  // counts the r58/r59 enumerations omitted because they stopped at the
  // reach. This law reads the committed bytes the suite actually serves and
  // enumerates the FULL shape: SetRunShockReach (rev2 §2.5),
  // SetRunScenarioResult's own counts (rev2 §2.4) and every
  // SetRunEngineSummary integer (rev2 §2.6), each entry NAMED so a collision
  // failure names its source. A NEW INTEGER OR ARRAY FIELD ON ANY OF THE
  // THREE SCHEMAS (api/openapi.yaml) MUST BE REGISTERED HERE and in the
  // generator's refusal (generate-run-book-set.mjs, nonCauseFiguresOf) in the
  // same diff.
  const body = JSON.parse(fixture("run-book-set.no-denominator.json")) as {
    results: {
      scenario_id: string;
      shocks: unknown[];
      shock_reach: {
        applied_shocks: unknown[];
        declared_shocks: number;
        declared_shocks_at_identity: number;
        held_flat_marks: number;
        held_flat_assets: unknown[];
        marks_moved: number;
        marks_held_by_declared_factor: number;
        marks_held_by_transform: number;
        marks_held_by_arithmetic: number;
        marks_snapped: number;
        marks_base_snapped: number;
        marks_cap_bound: number;
      };
      covered_engines: unknown[];
      withheld_engines: unknown[];
      unmeasurable_engines: {
        counts: { positions_in_batch: number; refused_in_batch: number; unrebuildable: number };
      }[];
      engines: {
        usd_decimals: number;
        accounts: number;
        infinite_accounts: number;
        movement_excluded_accounts: number;
        refused_in_batch_positions: number;
        unrebuildable_positions: number;
        before_eligible_accounts: number;
        after_eligible_accounts: number;
        eligible_accounts_delta: number;
        flipped_to_eligible: number | null;
        hf_dropped_accounts: number | null;
        market_realization: { usd_decimals: number } | null;
        projection: {
          annual_delta_bps: number;
          apy_observed_at_block: number;
          horizons: { horizon_seconds: number }[];
        } | null;
      }[];
      positions_answered: number;
      positions_withheld: number;
    }[];
  };
  const result = body.results.find((candidate) => candidate.scenario_id === "ethfi_minus_50");
  if (result === undefined) throw new Error("the fixture lost its ethfi_minus_50 result");
  const reach = result.shock_reach;
  const causes: [string, number][] = [
    ["marks_held_by_transform", reach.marks_held_by_transform],
    ["marks_held_by_declared_factor", reach.marks_held_by_declared_factor],
    ["marks_held_by_arithmetic", reach.marks_held_by_arithmetic],
  ];
  // Pairwise distinct from EACH OTHER ...
  expect(new Set(causes.map(([, value]) => value)).size).toBe(3);
  // ... and from EVERY non-cause figure a renderer could source instead.
  const nonCauses: [string, number][] = [
    // SetRunShockReach (rev2 §2.5) — the reach's totals, census and sums.
    ["marks_snapped", reach.marks_snapped],
    ["marks_base_snapped", reach.marks_base_snapped],
    ["marks_cap_bound", reach.marks_cap_bound],
    ["marks_moved", reach.marks_moved],
    ["applied_shocks.length", reach.applied_shocks.length],
    ["declared_shocks", reach.declared_shocks],
    ["declared_shocks_at_identity", reach.declared_shocks_at_identity],
    ["held_flat_marks", reach.held_flat_marks],
    ["held_flat_assets.length", reach.held_flat_assets.length],
    ["marks_snapped+marks_base_snapped", reach.marks_snapped + reach.marks_base_snapped],
    ["marks_snapped+marks_cap_bound", reach.marks_snapped + reach.marks_cap_bound],
    ["marks_base_snapped+marks_cap_bound", reach.marks_base_snapped + reach.marks_cap_bound],
    ["flag_sum", reach.marks_snapped + reach.marks_base_snapped + reach.marks_cap_bound],
    // SetRunScenarioResult (rev2 §2.4) — r60-C: the result's own counts and
    // array lengths, the figures the r58/r59 enumerations omitted.
    ["shocks.length", result.shocks.length],
    ["covered_engines.length", result.covered_engines.length],
    ["withheld_engines.length", result.withheld_engines.length],
    ["unmeasurable_engines.length", result.unmeasurable_engines.length],
    ["engines.length", result.engines.length],
    ["positions_answered", result.positions_answered],
    ["positions_withheld", result.positions_withheld],
  ];
  result.unmeasurable_engines.forEach((absence, i) => {
    nonCauses.push(
      [`unmeasurable_engines[${i}].counts.positions_in_batch`, absence.counts.positions_in_batch],
      [`unmeasurable_engines[${i}].counts.refused_in_batch`, absence.counts.refused_in_batch],
      [`unmeasurable_engines[${i}].counts.unrebuildable`, absence.counts.unrebuildable],
    );
  });
  result.engines.forEach((row, i) => {
    // Every §2.6 integer. A null (hf_dropped_accounts on the DM,
    // flipped_to_eligible on Aave) is an ABSENT figure, never a zero, and
    // registers nothing.
    const register = (name: string, value: number | null | undefined) => {
      if (value !== null && value !== undefined) nonCauses.push([`engines[${i}].${name}`, value]);
    };
    register("usd_decimals", row.usd_decimals);
    register("accounts", row.accounts);
    register("infinite_accounts", row.infinite_accounts);
    register("movement_excluded_accounts", row.movement_excluded_accounts);
    register("refused_in_batch_positions", row.refused_in_batch_positions);
    register("unrebuildable_positions", row.unrebuildable_positions);
    register("before_eligible_accounts", row.before_eligible_accounts);
    register("after_eligible_accounts", row.after_eligible_accounts);
    register("eligible_accounts_delta", row.eligible_accounts_delta);
    register("flipped_to_eligible", row.flipped_to_eligible);
    register("hf_dropped_accounts", row.hf_dropped_accounts);
    if (row.market_realization !== null) {
      register("market_realization.usd_decimals", row.market_realization.usd_decimals);
    }
    if (row.projection !== null) {
      register("projection.annual_delta_bps", row.projection.annual_delta_bps);
      register("projection.apy_observed_at_block", row.projection.apy_observed_at_block);
      register("projection.horizons.length", row.projection.horizons.length);
      row.projection.horizons.forEach((horizonRow, j) => {
        register(`projection.horizons[${j}].horizon_seconds`, horizonRow.horizon_seconds);
      });
    }
  });
  for (const [causeName, causeValue] of causes) {
    for (const [nonCauseName, nonCauseValue] of nonCauses) {
      expect(
        nonCauseValue,
        `${causeName} (${String(causeValue)}) is impersonated by ${nonCauseName}`,
      ).not.toBe(causeValue);
    }
  }
  // The figures the rendering laws above pin are exactly these.
  expect(causes.map(([, value]) => value)).toEqual([7, 4, 5]);
});

test("r57 item 7 — a floored bar is flagged on the rect and disclosed by the computed sentence", async ({
  page,
}) => {
  // Documented mutant: eth_minus_30's DM delta shrunk from -1050000000 to
  // -1050 (ratio -2.5e-7 against ethfi's 0.5 anchor). The one linear scale
  // would draw 9.6e-5 px of ink; the bar renders AT the 1.5px floor instead,
  // flagged, and the panel's method-line sentence states the count the
  // picture actually shows — computed, matching the data-floored rects.
  const posts: string[] = [];
  await mockCold(page);
  await mockSetRun(
    page,
    () => ({
      status: 200,
      body: withDelta(
        fixture("run-book-set.no-denominator.json"),
        "eth_minus_30",
        "debt_manager",
        "-1050",
      ),
    }),
    posts,
  );

  await page.goto(VARIANT_LINK);
  await expect(page.getByTestId("tornado-header")).toBeVisible();

  const dmPanel = page.getByTestId("tornado-panel-debt_manager");
  const floored = dmPanel.locator('[data-testid="tornado-bar"][data-floored="true"]');
  await expect(floored).toHaveCount(1);
  await expect(floored).toHaveAttribute("data-scenario-id", "eth_minus_30");
  await expect(floored).toHaveAttribute("data-negative", "true");
  const flooredWidth = Number(await floored.getAttribute("width"));
  expect(Math.abs(flooredWidth - 1.5)).toBeLessThanOrEqual(0.01);
  // The anchor keeps the scale and stays unflagged: the floor lifts the small
  // bar, it never rescales the panel.
  await expect(
    dmPanel.locator(
      '[data-testid="tornado-bar"][data-scenario-id="ethfi_minus_50"]',
    ),
  ).toHaveAttribute("data-floored", "false");

  // THE SENTENCE COUNT IS THE FLAGGED COUNT, exactly, with singular grammar.
  const note = dmPanel.getByTestId("tornado-floor-note");
  await expect(note).toHaveCount(1);
  const sentence = (await note.textContent()) ?? "";
  const match = /^(\d+) bars? (?:is|are) shorter than the 1\.5px visibility floor and renders? at it, off that scale; (?:its|their) exact figures are in the table\.$/.exec(
    sentence,
  );
  expect(match, `no computed floor sentence in: ${sentence}`).not.toBeNull();
  const stated = Number(match?.[1]);
  const flagged = await page
    .locator('[data-testid="tornado-bar"][data-floored="true"]')
    .count();
  expect(stated).toBe(flagged);
  expect(flagged).toBe(1);
  expect(sentence).toBe(
    "1 bar is shorter than the 1.5px visibility floor and renders at it, off that scale; " +
      "its exact figures are in the table.",
  );
  // One panel floored one bar; the other panels disclose nothing.
  await expect(page.getByTestId("tornado-floor-note")).toHaveCount(1);
});

test("r57 item 8 — an all-zero-reached scenario draws zero rects, leaves the drawn count, and is counted measured zero", async ({
  page,
}) => {
  // Documented mutant: ethfi_minus_50's one answerable engine measures a delta
  // of exactly "0". A true zero under a reached shock is a real finding — but
  // it renders NO rect, so the drawn count may not claim a bar for it.
  const posts: string[] = [];
  await mockCold(page);
  await mockSetRun(
    page,
    () => ({
      status: 200,
      body: withDelta(
        fixture("run-book-set.no-denominator.json"),
        "ethfi_minus_50",
        "debt_manager",
        "0",
      ),
    }),
    posts,
  );

  await page.goto(VARIANT_LINK);
  const header = page.getByTestId("tornado-header");
  await expect(header).toBeVisible();
  // KILLS: a drawn count that counts measured-zero markers as bars — it would
  // read "2 of 4" here with no second rect on the page.
  await expect(header).toContainText(
    "bars drawn for 1 of 4 requested scenario(s) · measured zero: 1 · shock did not reach: 0",
  );

  await expect(
    page.locator('[data-testid="tornado-bar"][data-scenario-id="ethfi_minus_50"]'),
  ).toHaveCount(0);
  await expect(
    page.locator('[data-testid="tornado-zero-bar"][data-scenario-id="ethfi_minus_50"]'),
  ).toContainText("measured zero");
  // The one real rect on the page is eth_minus_30's.
  await expect(page.locator('[data-testid="tornado-bar"]')).toHaveCount(1);
  await expect(page.locator('[data-testid="tornado-bar"]').first()).toHaveAttribute(
    "data-scenario-id",
    "eth_minus_30",
  );
});

test("r57 item 4 — a refused result contributes NOTHING: no ledger row, no reach count, its own clause", async ({
  page,
}) => {
  // Documented mutant: the snap control's scenario_version bumped to v2, so
  // its identity disagrees with the listing and the result refuses as
  // DEFINITION CHANGED. Its no_mark_moved arm must vanish from the no-reach
  // count, its rows from the ledger, and the header must carry the refusal
  // clause instead.
  const posts: string[] = [];
  await mockCold(page, () => fixture("run-book-set.scenarios.json"));
  await mockSetRun(
    page,
    () => ({
      status: 200,
      body: withResultVersionBumped(fixture("run-book-set.json"), "stable_depeg_0995_in_band"),
    }),
    posts,
  );

  await page.goto("/lab");
  await pick(page, EXAMPLE_IDS);
  await page.getByTestId("tornado-run").click();

  const header = page.getByTestId("tornado-header");
  await expect(header).toBeVisible();
  // KILLS: the header counting raw results — it would still read "shock did
  // not reach: 1" for a row whose numbers are refused everywhere else.
  await expect(header).toContainText("shock did not reach: 0");
  await expect(header).toContainText("declared no move: 1");
  await expect(header).toContainText("results refused, not read: 1 (definition changed: 1)");

  // The refusal state renders; the numbers do not.
  const refused = page.locator(
    '[data-testid="tornado-state"][data-scenario-id="stable_depeg_0995_in_band"]',
  );
  await expect(refused).toHaveAttribute("data-state", "definition-changed");
  await expect(refused).toContainText("DEFINITION CHANGED");
  await expect(
    page.locator('[data-testid="tornado-ledger-row"][data-scenario-id="stable_depeg_0995_in_band"]'),
  ).toHaveCount(0);
  await expect(page.getByTestId("tornado-ledger")).not.toContainText(
    "4 pinned by the stable snap",
  );
});

// ---------------------------------------------------------------------------
// r58 item 2 — no second dispatch while a set is in flight
// ---------------------------------------------------------------------------

test("r58 item 2 — a dispatch during an in-flight set is refused: ONE POST, a visible reason, re-enabled on settle", async ({
  page,
}) => {
  // KILLS: the unguarded overlap — set B captured set A's lossy running phases
  // as its priors, and B's 200 settle restored bare outcomes under A's stamp,
  // dropping rerunFailed records. With the guard removed, the pushState
  // auto-run below dispatches a second POST while the first is still in
  // flight, and the sink counts 2.
  const posts: string[] = [];
  let scenarioReads = 0;
  let releaseSettle: () => void = () => undefined;
  const settleGate = new Promise<void>((resolve) => {
    releaseSettle = resolve;
  });
  await mockCold(page, () => {
    scenarioReads += 1;
    return fixture("scenarios.json");
  });
  await page.route(`${API}/v1/scenarios/run-book-set`, async (route) => {
    if (route.request().method() === "OPTIONS") {
      return route.fulfill({ status: 204, headers: CORS, body: "" });
    }
    posts.push(route.request().postData() ?? "");
    // The mock settles SLOWLY, on this test's own signal: the in-flight window
    // is held open for as long as the second-dispatch attempts need.
    await settleGate;
    return json(route, fixture("run-book-set.no-denominator.json"));
  });

  await page.goto(VARIANT_LINK);
  await expect(page.getByTestId("tornado-running")).toBeVisible();
  await expect.poll(() => posts.length).toBe(1);

  // The UI attempt: the affordance is DISABLED, with its reason in the open —
  // never a silently dead button.
  await expect(page.getByTestId("tornado-run")).toBeDisabled();
  const reason = page.getByTestId("tornado-run-disabled-reason");
  await expect(reason).toContainText("a set run is in flight");
  await expect(reason).toContainText("its settlement writes these rows");
  await expect(reason).toContainText("a second dispatch would race it");

  // The direct attempt: a client-side URL change re-fires the ?scenarios=
  // auto-run against the listing WHILE the first set is still in flight.
  await page.evaluate(() => {
    window.history.pushState(null, "", "/lab?scenarios=eth_minus_30");
  });
  // The effect provably ran — it re-read the listing — and still nothing
  // second reached the sink: the guard refuses the dispatch at the source.
  await expect
    .poll(() => scenarioReads, { message: "the deep-link effect re-fires on the new URL" })
    .toBeGreaterThanOrEqual(2);
  expect(posts).toHaveLength(1);

  // The settlement releases the guard: the reason clears and the affordance
  // re-enables.
  releaseSettle();
  await expect(page.getByTestId("tornado-header")).toBeVisible();
  await expect(page.getByTestId("tornado-run-disabled-reason")).toHaveCount(0);
  await page.locator('[data-testid="tornado-pick"][data-scenario-id="eth_minus_30"]').check();
  await expect(page.getByTestId("tornado-run")).toBeEnabled();
  expect(posts).toHaveLength(1);
});

test("r59-A — a listing id the wire pattern refuses settles as REFUSED LOCALLY and never strands the guard", async ({
  page,
}) => {
  // KILLS: the stranded in-flight ref. The server accepts any nonblank
  // committed id, so a listing can honestly publish "ETH_down"; the client
  // pattern refuses to SEND it. Before this law, that refusal was a promise
  // REJECTION with no handler: the page said a run was in flight forever and
  // the set surface was permanently disabled. Now runBookSet resolves the
  // refused-locally arm, the surface names it, priors restore, and a second
  // dispatch works.
  const posts: string[] = [];
  await mockCold(page, () => {
    const listing = JSON.parse(fixture("run-book-set.scenarios.json")) as {
      scenarios: { id: string; label: string }[];
    };
    const donor = listing.scenarios[0];
    if (donor === undefined) throw new Error("listing fixture lost its scenarios");
    listing.scenarios.push({ ...donor, id: "ETH_down", label: "ETH down (uppercase id)" });
    return JSON.stringify(listing);
  });
  await mockSetRun(page, SET_200, posts);

  await page.goto("/lab");
  await expect(page.getByTestId("lab-tornado")).toBeVisible();
  await pick(page, ["ETH_down"]);
  await page.getByTestId("tornado-run").click();

  // The refusal is a SETTLEMENT with its own register sentence — nothing left
  // the page, and the sentence says so.
  const failure = page.getByTestId("tornado-set-failure");
  await expect(failure).toContainText("REFUSED LOCALLY, NOTHING SENT");
  await expect(failure).toContainText('"ETH_down" is not a committed-scenario id');
  await expect(failure).toContainText("No request left this page");
  expect(posts).toHaveLength(0);

  // The guard released and the surface is alive: a valid pick dispatches.
  await expect(page.getByTestId("tornado-run-disabled-reason")).toHaveCount(0);
  await page.locator('[data-testid="tornado-pick"][data-scenario-id="ETH_down"]').uncheck();
  await pick(page, EXAMPLE_IDS);
  await expect(page.getByTestId("tornado-run")).toBeEnabled();
  await page.getByTestId("tornado-run").click();
  await expect(page.getByTestId("tornado-header")).toHaveText(EXAMPLE_HEADER);
  expect(posts).toHaveLength(1);
});

// ---------------------------------------------------------------------------
// Freshness and settlement registers
// ---------------------------------------------------------------------------

test("the superseded arm: the header names the newer batch and the SET re-run affordance is live", async ({
  page,
}) => {
  const posts: string[] = [];
  await mockCold(page, () => fixture("run-book-set.scenarios.json"));
  await mockSetRun(page, SET_SUPERSEDED, posts);

  await page.goto(`/lab?scenarios=${EXAMPLE_IDS.join(",")}`);

  const header = page.getByTestId("tornado-header");
  await expect(header).toContainText("batch 2 has since materialized");
  await expect(header).toContainText("re-run the set to move onto it");
  await expect(page.getByTestId("tornado-rerun-set")).toBeEnabled();

  // And re-running the set re-POSTs the SAME explicit ids.
  await page.getByTestId("tornado-rerun-set").click();
  await expect
    .poll(() => posts.length, { message: "the set re-run affordance dispatches" })
    .toBe(2);
  expect(posts[1]).toBe(posts[0]);
});

test("a bodyless 503 busy settlement fails all N rows at once, each naming the BUSY arm", async ({
  page,
}) => {
  const posts: string[] = [];
  await mockCold(page);
  await mockSetRun(page, SET_BUSY, posts);
  await page.route(`${API}/v1/scenarios/eth_minus_30/run-book`, (route) =>
    json(route, fixture("run-book.eth_minus_30.json")),
  );

  await page.goto("/lab");

  // First, a single run gives eth_minus_30 a held result at its own pin.
  await page.locator('[data-testid="matrix-run"][data-scenario-id="eth_minus_30"]').click();
  await expect(
    page
      .locator('[data-testid="matrix-row"][data-scenario-id="eth_minus_30"]')
      .locator('[data-cell-state="result"]')
      .first(),
  ).toBeVisible();

  // Then the set-run over TWO rows settles bodyless: 503 set_run_busy.
  await page.locator('[data-testid="tornado-pick"][data-scenario-id="eth_minus_30"]').check();
  await page.locator('[data-testid="tornado-pick"][data-scenario-id="ethfi_minus_50"]').check();
  await page.getByTestId("tornado-run").click();

  // The set level names the arm: capacity, not the book, not a rate.
  const busy = page.getByTestId("tornado-busy");
  await expect(busy).toContainText("SERVICE BUSY (503 set_run_busy)");
  await expect(busy).toContainText("max_in_flight 2 · in_flight 2");
  await expect(busy).toContainText("about nothing in the book");
  await expect(busy).toContainText("All 2 row(s) of this set settled without a body");

  // The row that HELD a result keeps it, at its own pin, with the settlement
  // named beside it (R8 + R16): the cells still show the measurement.
  const ethRow = page.locator('[data-testid="matrix-row"][data-scenario-id="eth_minus_30"]');
  await expect(ethRow.locator('[data-cell-state="result"]').first()).toBeVisible();
  const ethBanner = page.locator(
    '[data-testid="matrix-rerun-failed"][data-scenario-id="eth_minus_30"]',
  );
  await expect(ethBanner).toContainText("SERVICE BUSY (503 set_run_busy)");
  await expect(ethBanner).toContainText("The cells still show what this row already measured");

  // The row that held NOTHING reads UNANSWERED — never a zero — with the SAME
  // arm named, so one settlement gets one account on every row it touched.
  const ethfiCell = page
    .locator('[data-testid="matrix-row"][data-scenario-id="ethfi_minus_50"]')
    .locator('[data-cell-state="unanswered"]')
    .first();
  await expect(ethfiCell).toBeVisible();
  await expect(ethfiCell).toContainText("SERVICE BUSY (503 set_run_busy)");

  expect(posts).toHaveLength(1);
});

test("§9.5: a row re-run singly onto a NEWER batch leaves the chart into its own named state", async ({
  page,
}) => {
  const posts: string[] = [];
  await mockCold(page);
  await mockSetRun(page, SET_VARIANT, posts);
  // The committed batch-2 variant of the same scenario: the single re-run
  // lands on a newer batch than the set's batch 1.
  await page.route(`${API}/v1/scenarios/eth_minus_30/run-book`, (route) =>
    json(route, fixture("run-book.eth_minus_30.batch2.json")),
  );

  await page.goto(VARIANT_LINK);
  await expect(page.getByTestId("tornado-header")).toContainText(
    "bars drawn for 2 of 4 requested scenario(s)",
  );

  await page.locator('[data-testid="matrix-run"][data-scenario-id="eth_minus_30"]').click();

  // The row leaves the chart into its own named state, with its own batch id
  // and the SET re-run affordance — never drawn shorter or greyer beside the
  // others — and the header's drawn count moves with it.
  const pulled = page.locator(
    '[data-testid="tornado-state"][data-state="pinned-elsewhere"]',
  );
  await expect(pulled).toHaveCount(1);
  await expect(pulled).toContainText("eth_minus_30 is not drawn");
  await expect(pulled).toContainText("batch #2");
  await expect(pulled).toContainText("Re-run the SET");
  await expect(
    page.locator('[data-testid="tornado-bar"][data-scenario-id="eth_minus_30"]'),
  ).toHaveCount(0);
  await expect(
    page.locator('[data-testid="tornado-bar"][data-scenario-id="ethfi_minus_50"]'),
  ).toHaveCount(1);
  await expect(page.getByTestId("tornado-header")).toContainText(
    "bars drawn for 1 of 4 requested scenario(s)",
  );
});

// ---------------------------------------------------------------------------
// r57 item 3 — a 200 set settle restores the matrix EXACTLY
// ---------------------------------------------------------------------------

test("r57 item 3 — a first-action set run leaves TRUE idle rows and the set-aware empty state", async ({
  page,
}) => {
  // KILLS: the matrix header claiming "no run has been issued yet" over a
  // session whose first action was a set run that settled 200.
  const posts: string[] = [];
  await mockCold(page);
  await mockSetRun(page, SET_VARIANT, posts);

  await page.goto(VARIANT_LINK);
  await expect(page.getByTestId("tornado-header")).toBeVisible();

  const batchLine = page.getByTestId("matrix-batch-line");
  await expect(batchLine).toContainText("no single-scenario run has been issued yet");
  await expect(batchLine).toContainText("A set run HAS been issued this session");
  await expect(batchLine).toContainText("tornado surface below");
  await expect(batchLine).toContainText("speak only for single-scenario runs");
  await expect(batchLine).not.toContainText("no run has been issued yet,");

  // And NO stamped rows: every covered cell is TRUE idle ("not run"), nothing
  // reads UNANSWERED, RUNNING or DEFINITION CHANGED off a set that settled ok.
  for (const state of ["unanswered", "running", "definition-changed", "result", "superseded"]) {
    await expect(
      page.locator(`[data-testid="matrix-cell"][data-cell-state="${state}"]`),
    ).toHaveCount(0);
  }
  expect(await page.locator('[data-testid="matrix-cell"][data-cell-state="not-run"]').count()).toBeGreaterThan(0);
});

test("r57 item 3 — a 200 set settle never drops a row's rerunFailed record or its result", async ({
  page,
}) => {
  // KILLS: the old settle path, which rebuilt held rows as bare
  // `{outcome: held, attempt: set}` — erasing the disclosed failure record
  // and restamping the evidence with the set's attempt.
  const posts: string[] = [];
  await mockCold(page);
  await mockSetRun(page, SET_VARIANT, posts);
  let ethRuns = 0;
  await page.route(`${API}/v1/scenarios/eth_minus_30/run-book`, (route) => {
    ethRuns += 1;
    return ethRuns === 1 ? json(route, fixture("run-book.eth_minus_30.json")) : route.abort();
  });

  await page.goto("/lab");

  // A single run answers, then a re-run fails bodyless: R8 keeps the result
  // and disclosed the failure beside it.
  const ethRow = page.locator('[data-testid="matrix-row"][data-scenario-id="eth_minus_30"]');
  await page.locator('[data-testid="matrix-run"][data-scenario-id="eth_minus_30"]').click();
  await expect(ethRow.locator('[data-cell-state="result"]').first()).toBeVisible();
  await page.locator('[data-testid="matrix-run"][data-scenario-id="eth_minus_30"]').click();
  const banner = page.locator(
    '[data-testid="matrix-rerun-failed"][data-scenario-id="eth_minus_30"]',
  );
  await expect(banner).toBeVisible();
  await expect(banner).toContainText("The cells still show what this row already measured");

  // The set settles 200. The row's phase comes back EXACTLY: result cells AND
  // the failure record, not a restamped copy without it.
  await pick(page, VARIANT_IDS);
  await page.getByTestId("tornado-run").click();
  await expect(page.getByTestId("tornado-header")).toBeVisible();

  await expect(ethRow.locator('[data-cell-state="result"]').first()).toBeVisible();
  await expect(banner).toBeVisible();
  await expect(banner).toContainText("The cells still show what this row already measured");
});

test("r57 item 3 — an older non-ok single-run phase survives a newer 200 set with its ORIGINAL stamp", async ({
  page,
}) => {
  // The discriminating sequence: weeth fails bodyless under the v1 listing
  // (stamp v1), the listing moves to v2 for that row (scenarios.relisted.json),
  // so its cells read DEFINITION CHANGED in the ASKED-under register. A 200
  // set then covers weeth. KILLS: the old settle path restamped the held
  // failure with the SET's (v2) attempt — the skew vanished and the cells
  // flipped to UNANSWERED, rewriting which definition the failure belonged to.
  const posts: string[] = [];
  let listing = "scenarios.json";
  await mockCold(page, () => fixture(listing));
  await mockSetRun(page, SET_VARIANT, posts);
  await page.route(`${API}/v1/scenarios/*/run-book`, (route) => {
    const url = route.request().url();
    if (url.includes("/ethfi_minus_50/")) {
      return json(route, fixture("run-book.ethfi_minus_50.v2.json"));
    }
    if (url.includes("/weeth_market_depeg_oracles_held/")) {
      return json(route, fixture("error-not-found.json"), 404);
    }
    throw new Error(`no run-book body mocked for ${url}`);
  });

  await page.goto("/lab");
  const batchLine = page.getByTestId("matrix-batch-line");
  const weethRow = page.locator(
    '[data-testid="matrix-row"][data-scenario-id="weeth_market_depeg_oracles_held"]',
  );

  // 1. weeth's v1 run fails bodyless: UNANSWERED, stamped v1.
  await page
    .locator('[data-testid="matrix-run"][data-scenario-id="weeth_market_depeg_oracles_held"]')
    .click();
  await expect(weethRow.locator('[data-cell-state="unanswered"]').first()).toBeVisible();

  // 2. The refresh affordance, earned honestly on the OTHER row (the r14
  //    vehicle): ethfi's answer is v2 against the v1 listing.
  await page.locator('[data-testid="matrix-run"][data-scenario-id="ethfi_minus_50"]').click();
  const refresh = page.locator(
    '[data-testid="matrix-row"][data-scenario-id="ethfi_minus_50"] [data-testid="matrix-refresh-listing"]',
  );
  await expect(refresh).toBeVisible();

  // 3. The deployment re-lists weeth at v2. The stored v1 failure now reads
  //    ASKED-under: definition changed, re-run is the remedy.
  listing = "scenarios.relisted.json";
  await refresh.click();
  await expect(weethRow.locator('[data-cell-state="definition-changed"]').first()).toBeVisible();
  await expect(batchLine).toContainText("1 run(s) were ASKED under a committed definition");

  // 4. The set covers weeth and settles 200.
  await pick(page, VARIANT_IDS);
  await page.getByTestId("tornado-run").click();
  await expect(page.getByTestId("tornado-header")).toBeVisible();

  // THE LAW: the weeth row still holds its ORIGINAL v1-stamped failure. Its
  // cells still read DEFINITION CHANGED in the ASKED-under register, and the
  // header still counts it there — never as a current-attempt UNANSWERED.
  await expect(weethRow.locator('[data-cell-state="definition-changed"]').first()).toBeVisible();
  await expect(weethRow.locator('[data-cell-state="unanswered"]')).toHaveCount(0);
  await expect(batchLine).toContainText("1 run(s) were ASKED under a committed definition");
  await expect(batchLine).not.toContainText("ended without a served result");

  // Bonus, r57 item 4 on the tornado surface: the variant's weeth result is v1
  // against the relisted v2 listing, so it refuses as DEFINITION CHANGED and
  // contributes nothing — no ledger rows, its own clause in the header.
  await expect(page.getByTestId("tornado-header")).toContainText(
    "results refused, not read: 1 (definition changed: 1)",
  );
  await expect(
    page.locator(
      '[data-testid="tornado-ledger-row"][data-scenario-id="weeth_market_depeg_oracles_held"]',
    ),
  ).toHaveCount(0);
});

// ---------------------------------------------------------------------------
// r57 item 11 — the dispatch record survives the listing
// ---------------------------------------------------------------------------

test("r57 item 11 / r58 item 6 — a settled run keeps saying B was filtered AT DISPATCH after a refresh that publishes B", async ({
  page,
}) => {
  // KILLS (r57 11): the notice and header clause recomputed from the LIVE
  // listing — a refresh that starts publishing ghost_b would silently
  // un-filter a request that already ran without it.
  // KILLS (r58 6): the stored record carrying the live PRESENT-tense sentence
  // — after the refresh publishes ghost_b, "this deployment publishes N of
  // them ... Not published here: ghost_b" became a false statement about the
  // listing on screen. The settled surface speaks in dispatch-time past tense.
  const posts: string[] = [];
  let ghostPublished = false;
  await mockCold(page, () =>
    ghostPublished ? listingWithGhost(fixture("scenarios.json")) : fixture("scenarios.json"),
  );
  await mockSetRun(page, SET_VARIANT, posts);
  await page.route(`${API}/v1/scenarios/ethfi_minus_50/run-book`, (route) =>
    json(route, fixture("run-book.ethfi_minus_50.v2.json")),
  );

  await page.goto(`${VARIANT_LINK},ghost_b`);
  const header = page.getByTestId("tornado-header");
  await expect(header).toBeVisible();
  expect(posts).toEqual([JSON.stringify({ scenario_ids: VARIANT_IDS })]);
  await expect(header).toContainText(
    "filtered from the deep link, not published AT DISPATCH: ghost_b",
  );
  const notice = page.getByTestId("tornado-deeplink-notice");
  await expect(notice).toContainText(
    "This deployment did not publish these ids when the set was dispatched: ghost_b.",
  );
  await expect(notice).not.toContainText("this deployment publishes");

  // Earn the refresh affordance (a definition-changed row via the v2 single
  // run), then refresh onto a listing that DOES publish ghost_b.
  await page.locator('[data-testid="matrix-run"][data-scenario-id="ethfi_minus_50"]').click();
  const refresh = page.locator(
    '[data-testid="matrix-row"][data-scenario-id="ethfi_minus_50"] [data-testid="matrix-refresh-listing"]',
  );
  await expect(refresh).toBeVisible();
  ghostPublished = true;
  await refresh.click();
  // The refresh landed: the listing now shows the ghost row.
  await expect(
    page.locator('[data-testid="matrix-row"][data-scenario-id="ghost_b"]'),
  ).toBeVisible();

  // THE LAW: the settled run's notice and header clause describe the DISPATCH,
  // from the run's own stored record — ghost_b stays named as filtered, because
  // the request that ran really did omit it — and (r58 item 6) they say so in
  // dispatch-time past tense, so the survival is a true sentence beside a
  // listing that now publishes ghost_b.
  await expect(header).toContainText(
    "filtered from the deep link, not published AT DISPATCH: ghost_b",
  );
  const settledNotice = page.getByTestId("tornado-deeplink-notice");
  await expect(settledNotice).toContainText(
    "This deployment did not publish these ids when the set was dispatched: ghost_b.",
  );
  await expect(settledNotice).not.toContainText("this deployment publishes");
  await expect(settledNotice).not.toContainText("Not published here");
  expect(posts).toHaveLength(1);
});
