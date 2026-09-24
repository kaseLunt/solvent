// Side-by-side gate helper (spec 2026-09-15 §9.3): screenshots the Overview
// and the Book against the demo dataset so the owner can compare the build
// with the approved mockups before a page lands.
//
// Usage (from web/, with a production server on :3111):
//   node scripts/screenshot-pages.mjs <outDir> [overview|book|inspector|lab|history|activity|verification|api ...]
// The honest states are pages too: historyDegraded, activityRefused, activityExhausted, verificationFailed,
// verificationUnavailable — the same routes with one answer replaced.
import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const [outArg, ...pageArgs] = process.argv.slice(2);
const out = outArg ?? "screenshots";
mkdirSync(out, { recursive: true });
const fx = (name) => import(pathToFileURL(path.resolve("tests/fixtures", name)).href);
const demo = await fx("demo/index.ts");
const proof = await fx("proof.ts");
const feed = await fx("feed.ts");
const observatory = await fx("observatory.ts");
const PAGES = { overview: "/", book: "/book", inspector: `/inspector/${demo.DEMO_NEAR_ADDR}`, lab: "/lab?scenario=eth_minus_30", labBare: "/lab", labAddress: `/lab?address=${demo.DEMO_NEAR_ADDR}`, labCompare: "/lab?scenarios=eth_minus_30,ethfi_minus_50", history: "/observatory", activity: "/feed", verification: "/proof", api: "/developers", historyDegraded: "/observatory", activityRefused: "/feed", activityExhausted: "/feed", verificationFailed: "/proof", verificationUnavailable: "/proof" };
// One answer replaced per honest state; registered after the defaults, so it wins.
const UNAVAILABLE = { error: { code: "unavailable", message: "the evidence manifest is not available" } };
const OVERRIDES = {
  historyDegraded: (page) => page.route("**/v1/observatory/series*", (r) => json(r, observatory.OBSERVATORY_DEGRADED, 503)),
  activityRefused: (page) => page.route("**/v1/events*", (r) => json(r, feed.FEED_ERROR_BAD_CURSOR, 400)),
  // Through the real flow: only the bad-debt filter answers empty (the committed empty page echoes that filter), and
  // the reader presses it (ACTIONS below) — so the capture shows the pressed control, "Filtered out" and "Clear filter".
  activityExhausted: (page) =>
    page.route("**/v1/events*", (r) =>
      new URL(r.request().url()).searchParams.get("types") === "deficit_created" ? json(r, feed.FEED_EMPTY) : r.fallback(),
    ),
  // Welded to the demo batch as the demo evidence is, so the failed receipt sits beside ONE serving batch.
  verificationFailed: (page) =>
    page.route("**/v1/evidence*", (r) =>
      json(r, { ...proof.EVIDENCE_PROOF_FAILED, substrate: { ...proof.EVIDENCE_PROOF_FAILED.substrate, batch_id: demo.DEMO_BATCH_ID } }),
    ),
  verificationUnavailable: (page) => page.route("**/v1/evidence*", (r) => json(r, UNAVAILABLE, 503)),
};
// What a reader does before the capture, for a state a page reaches only through its controls.
const ACTIONS = {
  activityExhausted: async (page) => {
    await page.getByTestId("activity-type-deficit_created").click();
    await page.locator('[data-testid="activity-surface"][data-state="exhausted"]').waitFor();
  },
};
const wanted = pageArgs.length === 0 ? Object.keys(PAGES) : pageArgs;
const CORS = { "access-control-allow-origin": "*" };
const json = (route, body, status = 200) =>
  route.fulfill({ status, headers: CORS, contentType: "application/json", body: JSON.stringify(body) });

const browser = await chromium.launch();
for (const theme of ["dark", "light"]) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: theme });
  await ctx.addInitScript((t) => {
    try {
      localStorage.setItem("solvent-theme", t);
    } catch {
      /* private mode */
    }
  }, theme);
  for (const name of wanted) {
    const url = PAGES[name];
    if (url === undefined) throw new Error(`unknown page ${name}`);
    const page = await ctx.newPage();
    await page.route("**/v1/stream**", (r) => r.abort());
    await page.route("**/v1/meta*", (r) => json(r, demo.DEMO_META));
    await page.route("**/v1/book", (r) => json(r, demo.DEMO_BOOK));
    await page.route("**/v1/evidence*", (r) => json(r, demo.DEMO_EVIDENCE));
    await page.route("**/v1/positions*", (r) =>
      json(
        r,
        new URL(r.request().url()).searchParams.get("cursor") === null
          ? demo.DEMO_POSITIONS_DM_PAGE_1
          : demo.DEMO_POSITIONS_DM_PAGE_2,
      ),
    );
    // The Inspector's routes: `*` never crosses `/`, so /history and /stress are not swallowed by the address route.
    await page.route("**/v1/params*", (r) => json(r, demo.DEMO_PARAMS_DM));
    // One endpoint, two readers: the Inspector asks for one account's actions, Activity for the cross-engine page.
    await page.route("**/v1/events*", (r) =>
      json(r, new URL(r.request().url()).searchParams.get("account") === null ? demo.DEMO_FEED_PAGE_1 : demo.DEMO_EVENTS_NEAR),
    );
    await page.route("**/v1/observatory/series*", (r) =>
      json(r, new URL(r.request().url()).searchParams.get("engine") === "debt_manager" ? demo.DEMO_OBSERVATORY_DM : demo.DEMO_OBSERVATORY_AAVE),
    );
    await page.route("**/v1/address/*/history*", (r) => json(r, demo.DEMO_HISTORY_NEAR));
    await page.route("**/v1/address/*/stress*", (r) => json(r, demo.DEMO_STRESS_NEAR));
    await page.route("**/v1/address/*", (r) => json(r, demo.DEMO_ADDRESS_NEAR));
    // The Scenarios routes: the listing, one run-book, the set run (Task 10's demo bodies).
    // The set answers the request: the demo set shaped to the POST body's ids, as the page-test contract's mock does.
    await page.route("**/v1/scenarios/run-book-set", (r) => {
      const asked = r.request().postDataJSON()?.scenario_ids ?? [];
      const results = asked.flatMap((id) => demo.DEMO_RUN_BOOK_SET.results.filter((x) => x.scenario_id === id));
      return json(r, { ...demo.DEMO_RUN_BOOK_SET, requested_scenario_ids: [...asked], results, evaluation: { ...demo.DEMO_RUN_BOOK_SET.evaluation, scenarios_evaluated: results.length } });
    });
    await page.route("**/v1/scenarios/*/run-book", (r) => json(r, demo.DEMO_RUN_BOOK_ETH));
    await page.route("**/v1/scenarios", (r) => json(r, demo.DEMO_SCENARIOS));
    await OVERRIDES[name]?.(page);
    await page.goto(`http://localhost:3111${url}`, { waitUntil: "networkidle" });
    await ACTIONS[name]?.(page);
    await page.waitForTimeout(600);
    await page.screenshot({ path: path.join(out, `${name}-${theme}-fold.png`) });
    await page.screenshot({ path: path.join(out, `${name}-${theme}-full.png`), fullPage: true });
    await page.close();
  }
  await ctx.close();
}
await browser.close();
console.log(`wrote ${String(wanted.length * 4)} screenshots to ${out}`);
