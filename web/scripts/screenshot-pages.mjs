// Side-by-side gate helper (spec 2026-09-15 §9.3): screenshots the Overview
// and the Book against the demo dataset so the owner can compare the build
// with the approved mockups before a page lands.
//
// Usage (from web/, with a production server on :3111):
//   node scripts/screenshot-pages.mjs <outDir> [overview|book ...]
import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const [outArg, ...pageArgs] = process.argv.slice(2);
const out = outArg ?? "screenshots";
mkdirSync(out, { recursive: true });
const PAGES = { overview: "/", book: "/book" };
const wanted = pageArgs.length === 0 ? Object.keys(PAGES) : pageArgs;

const fx = (name) => import(pathToFileURL(path.resolve("tests/fixtures", name)).href);
const demo = await fx("demo/index.ts");
const proof = await fx("proof.ts");
const CORS = { "access-control-allow-origin": "*" };
const json = (route, body) =>
  route.fulfill({ status: 200, headers: CORS, contentType: "application/json", body: JSON.stringify(body) });

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
    await page.route("**/v1/evidence*", (r) => json(r, proof.EVIDENCE_MANIFEST));
    await page.route("**/v1/positions*", (r) =>
      json(
        r,
        new URL(r.request().url()).searchParams.get("cursor") === null
          ? demo.DEMO_POSITIONS_DM_PAGE_1
          : demo.DEMO_POSITIONS_DM_PAGE_2,
      ),
    );
    await page.goto(`http://localhost:3111${url}`, { waitUntil: "networkidle" });
    await page.waitForTimeout(600);
    await page.screenshot({ path: path.join(out, `${name}-${theme}-fold.png`) });
    await page.screenshot({ path: path.join(out, `${name}-${theme}-full.png`), fullPage: true });
    await page.close();
  }
  await ctx.close();
}
await browser.close();
console.log(`wrote ${String(wanted.length * 4)} screenshots to ${out}`);
