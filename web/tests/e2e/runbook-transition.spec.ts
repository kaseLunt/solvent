// Wave W-TM — the run-book's transition matrix (contract 1.7.0), driven through
// the real Scenarios page against GENERATED fixtures.
//
// Sibling of `runbook-bsplit.spec.ts`. Bodies come from
// `tests/fixtures/generate-lab-book.mjs`, whose `checkTransitions` law re-proves
// every matrix against the two histograms beside it on every body it writes —
// so a fixture that contradicted itself would never reach this file.
//
// What this pins:
//   - a served run renders ONE matrix per engine, with the crossings the two
//     histograms structurally could not give;
//   - the (N+1, N+1) cell renders its two debts in the REFUSAL REGISTER —
//     "not measured", never $0.00;
//   - the wire's own `note` renders VERBATIM, and the cause split beside it
//     names which coverage field holds those rows;
//   - the Debt Manager's matrix carries NO crit tint: its lanes are the exact
//     rational, a disclosure and not a liquidation verdict;
//   - a body whose margins disagree with its own distributions is REFUSED with
//     its reasons, never drawn;
//   - none of it renders when the row holds no served book.
//
// Wave W-SK adds the flow VISUAL's laws:
//   - one ribbon per occupied cell, classed held / changed / unmeasured, the
//     class counts pinned to the fixture;
//   - the crit tint rides Aave's below-1.00 arrival and NEVER the Debt
//     Manager's, whose same region is a disclosure;
//   - a zero-count side draws no node block while its dimmed label keeps the
//     10-lane vocabulary complete;
//   - a refused matrix draws NO SVG at all;
//   - every text node inside the flow speaks the lane-label and margin-count
//     vocabulary and nothing else.
//
// Wave W-SK-B (Codex r56) adds the laws a stale bundle or a dead CSS module
// would otherwise pass:
//   - REAL GEOMETRY: every ribbon's computed stroke-width is the pure layer's
//     px (pinned as literals, not re-derived), its path spans the two node
//     columns inside the SVG box, and the kinds present differ pairwise in
//     computed stroke colour, with the crit ribbon resolving to the crit token;
//   - THE FLOOR IS DISCLOSED COMPUTED: the method line's floored count matches
//     the `data-floored="true"` ribbons exactly — zero means NO sentence;
//   - a cell with exactly one end in the unmeasured lane is REFUSED and draws
//     no SVG, even though every margin balances;
//   - on the wad engine the crit HUE rides a held diagonal below 1.00 at the
//     held mute, and the Debt Manager's identical shape takes none.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test, type Page, type Route } from "@playwright/test";

const API = "http://localhost:8080";

function fixture(name: string): string {
  return readFileSync(fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url)), "utf8");
}

const CORS = { "access-control-allow-origin": "*" };

function json(route: Route, body: string, status = 200) {
  return route.fulfill({ status, contentType: "application/json", headers: CORS, body });
}

async function mockCold(page: Page) {
  await page.route("**/v1/stream**", (route) => route.abort());
  await page.route(`${API}/v1/scenarios`, (route) => json(route, fixture("scenarios.json")));
  await page.route(`${API}/v1/book`, (route) => json(route, fixture("book.json")));
}

async function runScenario(page: Page, id: string, body: string) {
  await mockCold(page);
  await page.route(`${API}/v1/scenarios/*/run-book`, (route) => json(route, body));
  await page.goto("/lab");
  await page.locator(`[data-testid="lab-chip"][data-scenario-id="${id}"]`).click();
  await page.getByTestId("run-book-button").click();
  await expect(page.getByTestId("book-result")).toBeVisible();
}

// ---------------------------------------------------------------------------
// W-SK-B helpers: consistent inline mutations of the served body (the same
// mutations the unit spec proves `readTransitions` accepts or refuses), and a
// probe that resolves a CSS token to the same computed-colour serialization
// `getComputedStyle(...).stroke` reports.
// ---------------------------------------------------------------------------

interface TransitionSideBody {
  accounts: number;
  hf_histogram: { buckets: { count: number }[] };
}

interface TransitionEngineBody {
  engine: string;
  before: TransitionSideBody;
  after: TransitionSideBody;
  hf_transitions: {
    outflows: {
      from: number;
      cells: { to: number; rows: number; debt_before_usd: string | null; debt_after_usd: string | null }[];
    }[];
    from_rows: number[];
    to_rows: number[];
    total_rows: number;
    measured_rows: number;
    held_rows: number | null;
    lane_changed_rows: number | null;
  };
}

function engineBodyOf(body: { engines: TransitionEngineBody[] }, name: string): TransitionEngineBody {
  const found = body.engines.find((engine) => engine.engine === name);
  if (found === undefined) throw new Error(`the fixture carries no ${name} engine`);
  return found;
}

function bumpBucket(side: TransitionSideBody, bucket: number, rows: number) {
  side.accounts += rows;
  const target = side.hf_histogram.buckets[bucket];
  if (target === undefined) throw new Error("the fixture's histogram lost a bucket");
  target.count += rows;
}

/**
 * aave with 2 rows ADDED that sit in `< 0.90` before the shock and STAY there:
 * a held diagonal below 1.00, consistent on both sides so the reader accepts
 * it (the same mutation the unit spec proves reads clean). Asymmetric on
 * purpose: 2 rows against the DM's committed 1-row held diagonal.
 */
function withAaveHeldBelowOne(raw: string): string {
  const body = JSON.parse(raw) as { engines: TransitionEngineBody[] };
  const aave = engineBodyOf(body, "aave_v3_etherfi");
  bumpBucket(aave.before, 0, 2);
  bumpBucket(aave.after, 0, 2);
  const t = aave.hf_transitions;
  const outflow = t.outflows.find((o) => o.from === 0);
  if (outflow === undefined) throw new Error("the fixture carries no lane-0 outflow");
  outflow.cells.unshift({
    to: 0,
    rows: 2,
    debt_before_usd: "120000000000",
    debt_after_usd: "119000000000",
  });
  t.from_rows[0] = (t.from_rows[0] ?? 0) + 2;
  t.to_rows[0] = (t.to_rows[0] ?? 0) + 2;
  t.total_rows += 2;
  t.measured_rows += 2;
  t.held_rows = (t.held_rows ?? 0) + 2;
  return JSON.stringify(body);
}

/**
 * aave with its 3→0 fall widened from 1 row to 100, consistent on both sides.
 * The 1-row unmeasured diagonal then sits at 1/100 of the one scale — 0.22px
 * of honest ink — and must render at the floor, flagged and COUNTED.
 */
function withAaveWideFall(raw: string): string {
  const body = JSON.parse(raw) as { engines: TransitionEngineBody[] };
  const aave = engineBodyOf(body, "aave_v3_etherfi");
  bumpBucket(aave.before, 3, 99);
  bumpBucket(aave.after, 0, 99);
  const t = aave.hf_transitions;
  const cell = t.outflows.find((o) => o.from === 3)?.cells.find((c) => c.to === 0);
  if (cell === undefined) throw new Error("the fixture lost its 3→0 fall");
  cell.rows += 99;
  t.from_rows[3] = (t.from_rows[3] ?? 0) + 99;
  t.to_rows[0] = (t.to_rows[0] ?? 0) + 99;
  t.total_rows += 99;
  t.measured_rows += 99;
  t.lane_changed_rows = (t.lane_changed_rows ?? 0) + 99;
  return JSON.stringify(body);
}

/**
 * Codex r56's margin-preserving mutant: the DM's balanced diagonals (0→0 and
 * 9→9, one row each) swapped into 0→9 and 9→0. Every margin, histogram and
 * total is UNCHANGED — only the lane-kind law can catch it.
 */
function withOneEndedSwap(raw: string): string {
  const body = JSON.parse(raw) as { engines: TransitionEngineBody[] };
  const t = engineBodyOf(body, "debt_manager").hf_transitions;
  for (const outflow of t.outflows) {
    for (const cell of outflow.cells) {
      if (outflow.from === 0 && cell.to === 0) cell.to = 9;
      else if (outflow.from === 9 && cell.to === 9) cell.to = 0;
    }
  }
  return JSON.stringify(body);
}

/** Resolve a CSS colour (e.g. `var(--crit)`) to its computed serialization. */
async function resolveColor(page: Page, cssValue: string): Promise<string> {
  return page.evaluate((value) => {
    const probe = document.createElement("span");
    probe.style.color = value;
    document.body.append(probe);
    const resolved = getComputedStyle(probe).color;
    probe.remove();
    return resolved;
  }, cssValue);
}

test("a served run renders ONE transition matrix per engine, with the crossings on the page", async ({
  page,
}) => {
  await runScenario(page, "eth_minus_30", fixture("run-book.eth_minus_30.json"));

  const matrices = page.getByTestId("runbook-transition");
  await expect(matrices).toHaveCount(2);
  for (const engine of ["aave_v3_etherfi", "debt_manager"]) {
    await expect(
      page.locator(`[data-testid="runbook-transition"][data-engine="${engine}"]`),
    ).toHaveAttribute("data-state", "ok");
  }

  // The comparator travels with the matrix, so it is readable without the
  // histograms in scope — and the two engines do NOT share one.
  await expect(
    page.locator('[data-testid="runbook-transition"][data-engine="aave_v3_etherfi"]'),
  ).toContainText("comparator: hf_wad");
  await expect(
    page.locator('[data-testid="runbook-transition"][data-engine="debt_manager"]'),
  ).toContainText("comparator: hf_num/hf_den");

  // THE GROSS CROSSINGS, which no pair of marginals could produce. The Aave row
  // of this book falls from band 3 into band 0, so exactly one row enters the
  // region and none leaves it.
  const aave = page.locator('[data-testid="runbook-transition"][data-engine="aave_v3_etherfi"]');
  await expect(aave.getByTestId("runbook-transition-answer")).toContainText(
    "1 row moved INTO the below-1.00 region",
  );
  await expect(aave.getByTestId("runbook-transition-answer")).toContainText(
    "0 rows moved OUT of it",
  );
  await expect(aave.getByTestId("runbook-transition-changed")).toHaveText("1");
  await expect(aave.getByTestId("runbook-transition-held")).toHaveText("0");

  // The matrix's own occupied cells are on the page, and the crossing is one of
  // them rather than an inference from two bars.
  await expect(aave.locator('[data-testid="runbook-transition-cell"][data-from="3"][data-to="0"]')).toHaveCount(1);
});

test("the unmeasured cell renders in the REFUSAL REGISTER, never as a dollar zero", async ({
  page,
}) => {
  await runScenario(page, "eth_minus_30", fixture("run-book.eth_minus_30.json"));
  const aave = page.locator('[data-testid="runbook-transition"][data-engine="aave_v3_etherfi"]');

  const unmeasured = aave.locator('[data-testid="runbook-transition-cell"][data-unmeasured="true"]');
  await expect(unmeasured).toHaveCount(1);
  // BOTH debts are withheld, in the named-absence register.
  await expect(unmeasured.getByTestId("runbook-transition-nodebt")).toHaveCount(2);
  await expect(unmeasured).toContainText("not measured");
  // And NO dollar figure appears on that row. A "$0.00" would say this run
  // priced the row at nothing, which is a measurement nobody made.
  await expect(unmeasured).not.toContainText("$");

  // The unmeasured population is counted, not dropped — and the cause split
  // beside the note names which coverage field actually holds those rows.
  await expect(aave.getByTestId("runbook-transition-unmeasured")).toHaveText("1");
  await aave.getByTestId("runbook-transition-forensics").locator("summary").click();
  await expect(aave.getByTestId("runbook-transition-causes")).toContainText(
    "1 refused by riskd",
  );
  await expect(aave.getByTestId("runbook-transition-causes")).toContainText(
    "coverage.refused_in_batch",
  );
  await expect(aave.getByTestId("runbook-transition-causes")).toContainText(
    "0 this service could not rebuild",
  );
});

test("the wire's own note renders VERBATIM, with the disambiguations intact", async ({ page }) => {
  await runScenario(page, "eth_minus_30", fixture("run-book.eth_minus_30.json"));
  const dm = page.locator('[data-testid="runbook-transition"][data-engine="debt_manager"]');
  await dm.getByTestId("runbook-transition-forensics").locator("summary").click();

  const note = dm.getByTestId("runbook-transition-wire-note");
  await expect(note).toContainText("`from_rows` IS the before histogram");
  await expect(note).toContainText("It is NOT `movers_total`");
  await expect(note).toContainText("NOT `newly_eligible_accounts`");
  await expect(note).toContainText("not a crossing count of any particular edge");
  await expect(note).toContainText("A cell absent from `cells` holds ZERO rows");
});

test("the Debt Manager's matrix is a DISCLOSURE and carries no verdict tint", async ({ page }) => {
  await runScenario(page, "eth_minus_30", fixture("run-book.eth_minus_30.json"));

  const dm = page.locator('[data-testid="runbook-transition"][data-engine="debt_manager"]');
  await expect(dm.getByTestId("runbook-transition-method")).toContainText(
    "a DISCLOSURE and not its liquidation trigger",
  );
  await expect(dm.getByTestId("runbook-transition-method")).toContainText("Nothing here is tinted");

  // Aave's own comparator IS the pool's liquidation test, so its arrivals below
  // 1.00 are tinted — the same asymmetry the histogram pair already applies.
  const aave = page.locator('[data-testid="runbook-transition"][data-engine="aave_v3_etherfi"]');
  await expect(aave.getByTestId("runbook-transition-method")).toContainText(
    "Arrivals below 1.00 are tinted",
  );
  await expect(aave.getByTestId("runbook-transition-method")).not.toContainText(
    "Nothing here is tinted",
  );
});

test("the method line refuses the confusion the field name invites", async ({ page }) => {
  await runScenario(page, "eth_minus_30", fixture("run-book.eth_minus_30.json"));
  const aave = page.locator('[data-testid="runbook-transition"][data-engine="aave_v3_etherfi"]');
  const method = aave.getByTestId("runbook-transition-method");
  await expect(method).toContainText("POSITION ROWS of this engine in this run");
  await expect(method).toContainText("never distinct addresses");
  await expect(method).toContainText("never added to another engine");
  await expect(method).toContainText("not a crossing count of the 1.00 edge");
  await expect(method).toContainText("own USD at 8 decimals");
});

test("A CONTRADICTORY MATRIX IS NOT DRAWN, and the page says why", async ({ page }) => {
  // The body can arrive from an older deployment or a broken one. A flow whose
  // ribbons do not sum to the bars printed beside them is a wrong answer that
  // looks computed, so the page refuses it and shows the disagreement.
  const body = JSON.parse(fixture("run-book.eth_minus_30.json")) as {
    engines: { engine: string; before: { hf_histogram: { buckets: { count: number }[] } } }[];
  };
  const aave = body.engines.find((engine) => engine.engine === "aave_v3_etherfi");
  if (aave === undefined) throw new Error("the fixture carries no aave engine");
  const bucket = aave.before.hf_histogram.buckets[0];
  if (bucket === undefined) throw new Error("the fixture's histogram carries no buckets");
  bucket.count += 4;

  await runScenario(page, "eth_minus_30", JSON.stringify(body));

  const matrix = page.locator('[data-testid="runbook-transition"][data-engine="aave_v3_etherfi"]');
  await expect(matrix).toHaveAttribute("data-state", "contradictory");
  await expect(matrix.getByTestId("runbook-transition-refusal")).toContainText(
    "This matrix is NOT drawn",
  );
  await expect(matrix.getByTestId("runbook-transition-reasons")).toContainText(
    "the before distribution beside it counts",
  );
  // No cell table is drawn at all — the refusal replaces the picture rather
  // than sitting beside it.
  await expect(matrix.getByTestId("runbook-transition-cells")).toHaveCount(0);
  // And NO flow SVG either: a refused matrix never renders an empty-looking
  // flow, it renders the refusal sentence alone.
  await expect(matrix.getByTestId("runbook-transition-flow")).toHaveCount(0);

  // AND THE OTHER ENGINE IS UNAFFECTED: the refusal is per engine, and a body
  // with one broken engine still serves the one that is whole.
  await expect(
    page.locator('[data-testid="runbook-transition"][data-engine="debt_manager"]'),
  ).toHaveAttribute("data-state", "ok");
});

test("the matrix does not render when the row holds no served book", async ({ page }) => {
  await mockCold(page);
  await page.route(`${API}/v1/scenarios/*/run-book`, (route) =>
    json(route, fixture("run-book.names-nobody.json")),
  );
  await page.goto("/lab");
  await page
    .locator('[data-testid="lab-chip"][data-scenario-id="weeth_market_depeg_oracles_held"]')
    .click();
  await page.getByTestId("run-book-button").click();

  await expect(page.getByTestId("book-result")).toHaveCount(0);
  await expect(page.getByTestId("runbook-transition")).toHaveCount(0);
  await expect(page.getByTestId("runbook-transition-flow")).toHaveCount(0);
});

test("a WITHHELD engine has no matrix at all, and the served engine still has one", async ({
  page,
}) => {
  // A withheld engine contributes no `engines[]` row, so it has no matrix — and
  // `total_rows` on the engine that IS served is that engine's own book, never
  // the whole batch's.
  await runScenario(
    page,
    "weeth_market_depeg_oracles_held",
    fixture("run-book.weeth-withheld.json"),
  );

  await expect(page.getByTestId("runbook-transition")).toHaveCount(1);
  await expect(
    page.locator('[data-testid="runbook-transition"][data-engine="aave_v3_etherfi"]'),
  ).toHaveCount(0);
  const dm = page.locator('[data-testid="runbook-transition"][data-engine="debt_manager"]');
  await expect(dm).toHaveAttribute("data-state", "ok");
  await expect(dm.getByTestId("runbook-transition-unmeasured")).toHaveText("1");
  // The served engine's flow renders; the withheld engine has none to draw.
  await expect(dm.getByTestId("runbook-transition-flow")).toHaveCount(1);
});

// ---------------------------------------------------------------------------
// Wave W-SK — the flow VISUAL
// ---------------------------------------------------------------------------

test("the flow draws ONE ribbon per occupied cell, classed by movement", async ({ page }) => {
  await runScenario(page, "eth_minus_30", fixture("run-book.eth_minus_30.json"));

  // Aave: two occupied cells — the (3→0) fall and the (9,9) unmeasured
  // diagonal. Nothing else is drawn: an absent cell is absent ink.
  const aave = page.locator('[data-testid="runbook-transition"][data-engine="aave_v3_etherfi"]');
  await expect(aave.getByTestId("runbook-transition-flow")).toHaveCount(1);
  await expect(aave.locator('[data-testid="runbook-transition-ribbon"]')).toHaveCount(2);
  await expect(
    aave.locator('[data-testid="runbook-transition-ribbon"][data-kind="changed"]'),
  ).toHaveCount(1);
  await expect(
    aave.locator('[data-testid="runbook-transition-ribbon"][data-kind="held"]'),
  ).toHaveCount(0);
  await expect(
    aave.locator('[data-testid="runbook-transition-ribbon"][data-kind="unmeasured"]'),
  ).toHaveCount(1);

  // Debt Manager: four occupied cells — (0→0) and (6→6) held, (5→1) changed,
  // (9,9) unmeasured.
  const dm = page.locator('[data-testid="runbook-transition"][data-engine="debt_manager"]');
  await expect(dm.locator('[data-testid="runbook-transition-ribbon"]')).toHaveCount(4);
  await expect(
    dm.locator('[data-testid="runbook-transition-ribbon"][data-kind="changed"]'),
  ).toHaveCount(1);
  await expect(
    dm.locator('[data-testid="runbook-transition-ribbon"][data-kind="held"]'),
  ).toHaveCount(2);
  await expect(
    dm.locator('[data-testid="runbook-transition-ribbon"][data-kind="unmeasured"]'),
  ).toHaveCount(1);
  // The unmeasured diagonal sits on from === to and is still NOT classed held:
  // nothing was measured, so nothing can be said to have held.
  await expect(
    dm.locator('[data-testid="runbook-transition-ribbon"][data-from="9"][data-to="9"]'),
  ).toHaveAttribute("data-kind", "unmeasured");

  // W-SK-B: REAL GEOMETRY. The counts above stay green with strokeWidth 0, a
  // degenerate `d`, or swapped classes; the ink itself is pinned here. Every
  // cell of this fixture holds 1 row and the widest cell IS 1 row, so every
  // ribbon renders the 22px anchor exactly — a literal, not re-derived.
  for (const engineName of ["aave_v3_etherfi", "debt_manager"]) {
    const svg = page
      .locator(`[data-testid="runbook-transition"][data-engine="${engineName}"]`)
      .getByTestId("runbook-transition-flow");
    const svgWidth = Number(await svg.getAttribute("width"));
    const svgHeight = Number(await svg.getAttribute("height"));
    expect(svgWidth).toBeGreaterThan(0);
    expect(svgHeight).toBeGreaterThan(0);

    const geometry = await svg
      .locator('[data-testid="runbook-transition-ribbon"]')
      .evaluateAll((nodes) =>
        nodes.map((node) => ({
          kind: node.getAttribute("data-kind") ?? "",
          d: node.getAttribute("d") ?? "",
          stroke: getComputedStyle(node).stroke,
          strokeWidth: getComputedStyle(node).strokeWidth,
        })),
      );
    expect(geometry.length).toBeGreaterThan(0);

    for (const ribbon of geometry) {
      // (a) The COMPUTED stroke-width is the pure layer's px: positive, and
      // 22 within a tenth. A zeroed or unstyled stroke fails here.
      const px = parseFloat(ribbon.strokeWidth);
      expect(px).toBeGreaterThan(0);
      expect(Math.abs(px - 22)).toBeLessThanOrEqual(0.1);

      // (b) The path is NOT degenerate: it starts at the left node column
      // (FLOW_LABEL_W 200 + FLOW_NODE_W 8 = 208) and ends at the right one
      // (svg width − 208), left strictly before right, both ends inside the
      // SVG box. `M 0 0` or a flat scribble fails here.
      const parsed =
        /^M (-?[\d.]+) (-?[\d.]+) C (-?[\d.]+) (-?[\d.]+), (-?[\d.]+) (-?[\d.]+), (-?[\d.]+) (-?[\d.]+)$/.exec(
          ribbon.d,
        );
      expect(parsed, `degenerate ribbon path: ${ribbon.d}`).not.toBeNull();
      const numbers = (parsed ?? []).slice(1).map(Number);
      const startX = numbers[0] ?? NaN;
      const startY = numbers[1] ?? NaN;
      const endX = numbers[6] ?? NaN;
      const endY = numbers[7] ?? NaN;
      expect(startX).toBe(208);
      expect(Math.abs(endX - (svgWidth - 208))).toBeLessThanOrEqual(0.1);
      expect(startX).toBeLessThan(endX);
      for (const y of [startY, endY]) {
        expect(y).toBeGreaterThan(0);
        expect(y).toBeLessThan(svgHeight);
      }
    }

    // (c) The kinds PRESENT differ pairwise in computed stroke colour, and one
    // kind speaks with one colour: swapped or dead classes collapse two kinds
    // into one hue and fail here.
    const strokeByKind = new Map<string, string>();
    for (const ribbon of geometry) {
      expect(ribbon.stroke).not.toBe("none");
      const prior = strokeByKind.get(ribbon.kind);
      if (prior !== undefined) {
        expect(prior, `two strokes for kind ${ribbon.kind}`).toBe(ribbon.stroke);
      }
      strokeByKind.set(ribbon.kind, ribbon.stroke);
    }
    expect(new Set(strokeByKind.values()).size).toBe(strokeByKind.size);
  }
});

test("the crit tint rides Aave's below-1.00 arrival and NEVER the Debt Manager's", async ({
  page,
}) => {
  await runScenario(page, "eth_minus_30", fixture("run-book.eth_minus_30.json"));

  // Aave's comparator IS the pool's liquidation test, so its lane-changed
  // arrival below 1.00 carries the crit tint — and it is the only ribbon that
  // does.
  const aave = page.locator('[data-testid="runbook-transition"][data-engine="aave_v3_etherfi"]');
  const arrival = aave.locator(
    '[data-testid="runbook-transition-ribbon"][data-from="3"][data-to="0"]',
  );
  await expect(arrival).toHaveAttribute("data-kind", "changed");
  await expect(arrival).toHaveAttribute("data-crit", "true");
  await expect(
    aave.locator('[data-testid="runbook-transition-ribbon"][data-crit="true"]'),
  ).toHaveCount(1);

  // The Debt Manager HAS a below-1.00 arrival on this same book (5→1) and it
  // still takes no crit: its lanes are the exact rational, a disclosure and
  // not its liquidation trigger. The two engines' arrivals are asymmetric on
  // purpose (5→1 versus 3→0), so a mirror-image bug cannot pass both.
  const dm = page.locator('[data-testid="runbook-transition"][data-engine="debt_manager"]');
  const dmArrival = dm.locator(
    '[data-testid="runbook-transition-ribbon"][data-from="5"][data-to="1"]',
  );
  await expect(dmArrival).toHaveCount(1);
  await expect(dmArrival).toHaveAttribute("data-kind", "changed");
  await expect(dmArrival).toHaveAttribute("data-crit", "false");
  await expect(
    dm.locator('[data-testid="runbook-transition-ribbon"][data-crit="true"]'),
  ).toHaveCount(0);

  // W-SK-B: the attribute is not the ink. The crit ribbon's COMPUTED stroke
  // resolves to the crit token itself, and the DM's same-region arrival is a
  // DIFFERENT hue — a swapped class, a dead CSS module, or crit-on-DM all
  // fail here even while every data-* above stays green.
  const critColor = await resolveColor(page, "var(--crit)");
  expect(critColor).not.toBe("");
  expect(critColor).not.toBe("rgba(0, 0, 0, 0)");
  const arrivalStroke = await arrival.evaluate((node) => getComputedStyle(node).stroke);
  expect(arrivalStroke).toBe(critColor);
  const dmArrivalStroke = await dmArrival.evaluate((node) => getComputedStyle(node).stroke);
  expect(dmArrivalStroke).not.toBe(critColor);
});

test("a lane empty on one side draws NO node block there, and its dimmed label keeps the vocabulary", async ({
  page,
}) => {
  await runScenario(page, "eth_minus_30", fixture("run-book.eth_minus_30.json"));
  const aave = page.locator('[data-testid="runbook-transition"][data-engine="aave_v3_etherfi"]');

  // Aave's margins occupy lanes {3, 9} before and {0, 9} after: four node
  // blocks, and none anywhere else.
  await expect(aave.locator('[data-testid="runbook-transition-flow-node"]')).toHaveCount(4);
  await expect(
    aave.locator('[data-testid="runbook-transition-flow-node"][data-side="before"][data-lane="3"]'),
  ).toHaveCount(1);
  await expect(
    aave.locator('[data-testid="runbook-transition-flow-node"][data-side="before"][data-lane="0"]'),
  ).toHaveCount(0);
  await expect(
    aave.locator('[data-testid="runbook-transition-flow-node"][data-side="after"][data-lane="0"]'),
  ).toHaveCount(1);
  await expect(
    aave.locator('[data-testid="runbook-transition-flow-node"][data-side="after"][data-lane="3"]'),
  ).toHaveCount(0);

  // The vocabulary stays complete: all 10 lanes label BOTH sides, dimmed
  // exactly where that side holds no row.
  await expect(aave.locator('[data-testid="runbook-transition-flow-label"]')).toHaveCount(20);
  await expect(
    aave.locator(
      '[data-testid="runbook-transition-flow-label"][data-side="before"][data-lane="0"]',
    ),
  ).toHaveAttribute("data-empty", "true");
  await expect(
    aave.locator('[data-testid="runbook-transition-flow-label"][data-side="after"][data-lane="0"]'),
  ).toHaveAttribute("data-empty", "false");
});

test("every text node in the flow speaks the lane-label and margin vocabulary, nothing else", async ({
  page,
}) => {
  await runScenario(page, "eth_minus_30", fixture("run-book.eth_minus_30.json"));
  const body = JSON.parse(fixture("run-book.eth_minus_30.json")) as {
    engines: {
      engine: string;
      hf_transitions: {
        lanes: { label: string }[];
        from_rows: number[];
        to_rows: number[];
      };
    }[];
  };

  for (const engineBody of body.engines) {
    const t = engineBody.hf_transitions;
    const svg = page
      .locator(`[data-testid="runbook-transition"][data-engine="${engineBody.engine}"]`)
      .getByTestId("runbook-transition-flow");

    // THE SWEEP: every <text> in the SVG is a lane label with its margin
    // count. No stray words, no number that exists only as decoration.
    const texts = await svg.locator("text").allTextContents();
    expect(texts).toHaveLength(t.lanes.length * 2);
    const labels = new Set(t.lanes.map((lane) => lane.label));
    for (const text of texts) {
      const match = /^(.+) · (\d+)$/.exec(text);
      expect(match, `stray flow text: ${text}`).not.toBeNull();
      expect(labels.has(match?.[1] ?? ""), `stray flow label: ${text}`).toBe(true);
    }

    // And each label's count is the WIRE's margin integer for that side and
    // lane, so the picture reads without the table (LAW-5).
    for (const [side, margins] of [
      ["before", t.from_rows],
      ["after", t.to_rows],
    ] as const) {
      for (let lane = 0; lane < margins.length; lane += 1) {
        await expect(
          svg.locator(
            `[data-testid="runbook-transition-flow-label"][data-side="${side}"][data-lane="${String(lane)}"]`,
          ),
        ).toHaveText(`${t.lanes[lane]?.label ?? ""} · ${String(margins[lane])}`);
      }
    }
  }
});

// ---------------------------------------------------------------------------
// Wave W-SK-B — the floor disclosed, the one-ended cell refused, the held
// arrival tinted
// ---------------------------------------------------------------------------

test("zero floored ribbons render ZERO disclosure: no sentence, no flag, exactly matched", async ({
  page,
}) => {
  // On the served fixture every cell holds 1 row and the widest cell IS 1
  // row: nothing sits on the visibility floor, so the method line says
  // NOTHING about it — a standing disclaimer over zero floored ribbons would
  // be noise a reader learns to skip — and every ribbon states the fact
  // explicitly as `data-floored="false"`.
  await runScenario(page, "eth_minus_30", fixture("run-book.eth_minus_30.json"));
  for (const engineName of ["aave_v3_etherfi", "debt_manager"]) {
    const panel = page.locator(
      `[data-testid="runbook-transition"][data-engine="${engineName}"]`,
    );
    await expect(panel.getByTestId("runbook-transition-method")).not.toContainText(
      "visibility floor",
    );
    await expect(
      panel.locator('[data-testid="runbook-transition-ribbon"][data-floored="true"]'),
    ).toHaveCount(0);
    const ribbons = panel.locator('[data-testid="runbook-transition-ribbon"]');
    const count = await ribbons.count();
    expect(count).toBeGreaterThan(0);
    for (let index = 0; index < count; index += 1) {
      await expect(ribbons.nth(index)).toHaveAttribute("data-floored", "false");
    }
  }
});

test("the floored count is COMPUTED and matches the flagged ribbons exactly", async ({ page }) => {
  // Widen aave's fall to 100 rows (consistent on both sides — the unit spec
  // proves this body reads clean). The 1-row unmeasured diagonal now sits at
  // 1/100 of the one scale, renders AT the 1.5px floor, and the method line
  // must state the count the picture actually shows.
  await runScenario(
    page,
    "eth_minus_30",
    withAaveWideFall(fixture("run-book.eth_minus_30.json")),
  );
  const aave = page.locator('[data-testid="runbook-transition"][data-engine="aave_v3_etherfi"]');
  await expect(aave).toHaveAttribute("data-state", "ok");

  const method = (await aave.getByTestId("runbook-transition-method").textContent()) ?? "";
  const sentence = /(\d+) ribbons? (?:is|are) thinner than the 1\.5px visibility floor/.exec(
    method,
  );
  expect(sentence, `no computed floor sentence in: ${method}`).not.toBeNull();
  const stated = Number(sentence?.[1]);
  const flagged = await aave
    .locator('[data-testid="runbook-transition-ribbon"][data-floored="true"]')
    .count();
  expect(stated).toBe(flagged);
  expect(flagged).toBe(1);

  // The flagged ribbon IS the 1-row unmeasured diagonal, drawn at the floor;
  // the 100-row fall keeps the 22px anchor unflagged — the floor lifts the
  // small cell, it never rescales the scale.
  const floored = aave.locator('[data-testid="runbook-transition-ribbon"][data-floored="true"]');
  await expect(floored).toHaveAttribute("data-from", "9");
  await expect(floored).toHaveAttribute("data-to", "9");
  const flooredPx = parseFloat(
    await floored.evaluate((node) => getComputedStyle(node).strokeWidth),
  );
  expect(Math.abs(flooredPx - 1.5)).toBeLessThanOrEqual(0.1);
  const fall = aave.locator(
    '[data-testid="runbook-transition-ribbon"][data-from="3"][data-to="0"]',
  );
  await expect(fall).toHaveAttribute("data-floored", "false");
  const fallPx = parseFloat(await fall.evaluate((node) => getComputedStyle(node).strokeWidth));
  expect(Math.abs(fallPx - 22)).toBeLessThanOrEqual(0.1);

  // The DM's matrix is untouched: no floored ribbon, no sentence.
  const dm = page.locator('[data-testid="runbook-transition"][data-engine="debt_manager"]');
  await expect(dm.getByTestId("runbook-transition-method")).not.toContainText(
    "visibility floor",
  );
  await expect(
    dm.locator('[data-testid="runbook-transition-ribbon"][data-floored="true"]'),
  ).toHaveCount(0);
});

test("a cell with one end in the unmeasured lane is REFUSED and draws NO SVG", async ({
  page,
}) => {
  // Codex r56's margin-preserving mutant, served: the DM's balanced 0→0 and
  // 9→9 diagonals swapped into 0→9 and 9→0. Every margin still matches both
  // histograms and every total holds, so a version of this page that only
  // sums would draw a measured row dissolving into the unmeasured lane and an
  // unmeasured row materializing out of it — fabricated measured movement.
  await runScenario(
    page,
    "eth_minus_30",
    withOneEndedSwap(fixture("run-book.eth_minus_30.json")),
  );

  const dm = page.locator('[data-testid="runbook-transition"][data-engine="debt_manager"]');
  await expect(dm).toHaveAttribute("data-state", "contradictory");
  const reasons = dm.getByTestId("runbook-transition-reasons");
  await expect(reasons).toContainText("exactly one end in the unmeasured lane");
  await expect(reasons).toContainText("lane 0 (< 0.90) → lane 9 (not measured)");
  await expect(reasons).toContainText("lane 9 (not measured) → lane 0 (< 0.90)");
  await expect(reasons).toContainText("unmeasured on both sides");
  // The refusal REPLACES the picture: no flow SVG, no cell table.
  await expect(dm.getByTestId("runbook-transition-flow")).toHaveCount(0);
  await expect(dm.getByTestId("runbook-transition-cells")).toHaveCount(0);

  // And the refusal is per engine: aave's whole matrix still renders.
  await expect(
    page.locator('[data-testid="runbook-transition"][data-engine="aave_v3_etherfi"]'),
  ).toHaveAttribute("data-state", "ok");
});

test("a held diagonal below 1.00 carries the crit HUE at the held MUTE on aave, and never on the DM", async ({
  page,
}) => {
  // The W-SK-B ruling: the ledger's semantic wins. Serve aave with 2 rows
  // that sat below 0.90 and STAYED there (the unit spec proves this body
  // reads clean). Those rows are in the liquidation set, so the tint a reader
  // uses to find that set must include them — at the held mute, because
  // nothing moved.
  await runScenario(
    page,
    "eth_minus_30",
    withAaveHeldBelowOne(fixture("run-book.eth_minus_30.json")),
  );
  const aave = page.locator('[data-testid="runbook-transition"][data-engine="aave_v3_etherfi"]');
  await expect(aave).toHaveAttribute("data-state", "ok");

  const heldArrival = aave.locator(
    '[data-testid="runbook-transition-ribbon"][data-from="0"][data-to="0"]',
  );
  await expect(heldArrival).toHaveAttribute("data-kind", "held");
  await expect(heldArrival).toHaveAttribute("data-crit", "true");
  const fall = aave.locator(
    '[data-testid="runbook-transition-ribbon"][data-from="3"][data-to="0"]',
  );
  await expect(fall).toHaveAttribute("data-kind", "changed");
  await expect(fall).toHaveAttribute("data-crit", "true");
  await expect(
    aave.locator('[data-testid="runbook-transition-ribbon"][data-crit="true"]'),
  ).toHaveCount(2);

  // The HUE is crit for both arrivals; the EMPHASIS still separates them —
  // held stays muted below changed, so "already there" and "fell in" remain
  // two readable statements in one tint.
  const critColor = await resolveColor(page, "var(--crit)");
  const heldStroke = await heldArrival.evaluate((node) => getComputedStyle(node).stroke);
  const fallStroke = await fall.evaluate((node) => getComputedStyle(node).stroke);
  expect(heldStroke).toBe(critColor);
  expect(fallStroke).toBe(critColor);
  const heldOpacity = parseFloat(
    await heldArrival.evaluate((node) => getComputedStyle(node).opacity),
  );
  const fallOpacity = parseFloat(await fall.evaluate((node) => getComputedStyle(node).opacity));
  expect(heldOpacity).toBeGreaterThan(0);
  expect(heldOpacity).toBeLessThan(fallOpacity);

  // The method line says what the tint now includes, in the same breath.
  await expect(aave.getByTestId("runbook-transition-method")).toContainText(
    "including rows that were already below it before the shock",
  );

  // The Debt Manager's IDENTICAL shape — its committed held diagonal in
  // `< 0.90` — takes no crit anywhere: that region is a disclosure there.
  const dm = page.locator('[data-testid="runbook-transition"][data-engine="debt_manager"]');
  const dmHeld = dm.locator(
    '[data-testid="runbook-transition-ribbon"][data-from="0"][data-to="0"]',
  );
  await expect(dmHeld).toHaveAttribute("data-kind", "held");
  await expect(dmHeld).toHaveAttribute("data-crit", "false");
  await expect(
    dm.locator('[data-testid="runbook-transition-ribbon"][data-crit="true"]'),
  ).toHaveCount(0);
  const dmHeldStroke = await dmHeld.evaluate((node) => getComputedStyle(node).stroke);
  expect(dmHeldStroke).not.toBe(critColor);
});
