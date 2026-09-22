// The Verification page-test contract (spec 2026-09-15 §5.5, §7). Mocked
// from the committed fixtures: the contract's own /v1/evidence
// example and its three documented deltas (tests/fixtures/proof.ts), and the
// Overview's meta and book mocks for the architecture steps (the positions
// mock stands so that a walk, if the page ever started one, would be counted
// rather than fail — the page asks /v1/book alone). Every headline, chip,
// step and receipt string here is produced by lib/verification-view.ts
// (unit-pinned in tests/unit/verification-view.spec.ts); the subjects' words
// are lib/evidence.ts's.
//
// Placement laws for the two cards follow the three-layer rule: a hazard is
// visible AND not a descendant of the fold AND the counted summary recounts;
// visibility is asserted, never containment (toContainText passes on text hidden
// inside a closed fold).
import { expect, test, type Page, type Route } from "@playwright/test";
import { BOOK, BOOK_ERROR_UNAVAILABLE, POSITIONS_DM_PAGE_1 } from "../fixtures/book";
import { META } from "../fixtures/meta";
import { EVIDENCE_MANIFEST, EVIDENCE_NO_BATCH, EVIDENCE_NO_RECEIPT, EVIDENCE_PROOF_FAILED } from "../fixtures/proof";

// Clipboard assertions need explicit grants in Chromium.
test.use({ permissions: ["clipboard-read", "clipboard-write"] });

// Fulfilled responses still cross an origin (3111 → 8080), so CORS applies.
const CORS = { "access-control-allow-origin": "*" };
const json = (route: Route, body: unknown, status = 200) =>
  route.fulfill({ status, headers: CORS, contentType: "application/json", body: JSON.stringify(body) });

async function mockAll(page: Page, evidence: unknown = EVIDENCE_MANIFEST) {
  await page.route("**/v1/stream**", (route) => route.abort());
  await page.route("**/v1/book", (route) => json(route, BOOK));
  await page.route("**/v1/positions*", (route) => json(route, POSITIONS_DM_PAGE_1));
  await page.route("**/v1/meta*", (route) => json(route, META));
  await page.route("**/v1/evidence*", (route) => json(route, evidence));
}

const surface = (page: Page) => page.getByTestId("verification-surface");
const verdict = (page: Page) => page.getByTestId("verification-verdict");
const headline = (page: Page) => page.getByTestId("verification-verdict-headline");
const chip = (page: Page, label: string) => page.getByTestId("verification-verdict-identity").locator(`[data-chip='${label}']`);

const REAL_KEY = EVIDENCE_MANIFEST.substrate?.materialization_key ?? "";
if (REAL_KEY.length === 0) throw new Error("fixture invariant: the example carries a key");
const dm = META.watermark_vector.find((w) => w.engine === "debt_manager");
if (dm === undefined) throw new Error("fixture invariant: meta carries the debt_manager watermark");

test("the committed example: state ok, receipt exact, the takeaway headline with only the proof's finding toned, the two-fact dek, four chips, four numbered tiles, four sentences, the receipt line", async ({
  page,
}) => {
  await mockAll(page);
  await page.goto("/proof");
  await expect(surface(page)).toHaveAttribute("data-state", "ok");
  await expect(surface(page)).toHaveAttribute("data-receipt", "exact");
  await expect(verdict(page)).toHaveAttribute("data-variant", "ok");
  await expect(verdict(page)).toContainText("Verification · this deployment");
  await expect(headline(page)).toHaveText("All 87 checked rows matched the chain exactly, in this deployment's pinned reconcile run.");
  // The tone stops where the proof's finding stops: the scope is ink, and the live batch is not in the sentence at all.
  await expect(headline(page).locator("b")).toHaveText("All 87 checked rows matched the chain exactly,");
  await expect(headline(page)).not.toContainText("batch");
  await expect(page.getByTestId("verification-verdict-dek")).toHaveText(
    "That run is a fixed, reproducible check, finished Jul 29, 02:14 UTC; its result covers that run and nothing else. Batch 1, served now, is live data; no check covers it, and it does not inherit that result.",
  );
  // Of the live batch the manifest says only that no comparator applies: "re-checked" would say it had been checked once.
  await expect(page.getByTestId("verification-verdict-dek")).not.toContainText(/re-?check/i);

  // Identity: both subjects named — the proof by its pin, never as a batch — the receipt's state and tally, the whole key behind the chip.
  await expect(chip(page, "Pinned batch")).toHaveCount(0);
  await expect(chip(page, "Proof pin")).toContainText("5f0b3e2a");
  // The exact layer under the dek's humanised finish: the whole sha and the wire's own instant.
  await expect(chip(page, "Proof pin")).toHaveAttribute(
    "title",
    `comparison sha256 ${EVIDENCE_MANIFEST.reconcile?.comparison_sha256 ?? "∅"} · finished 2026-07-29T02:14:07Z`,
  );
  await expect(chip(page, "Live batch").locator("b")).toHaveText("1");
  await expect(chip(page, "Receipt")).toContainText("exact · 87/87");
  await expect(chip(page, "Batch key")).toHaveAttribute("title", REAL_KEY);

  // The four steps — the Overview's numbers, each headed once (its number on its tile) and each with its one sentence.
  await expect(page.getByTestId("verification-kpi-index")).toContainText("01 · Index");
  await expect(page.getByTestId("verification-kpi-compute")).toContainText("02 · Compute");
  await expect(page.getByTestId("verification-kpi-verify")).toContainText("03 · Verify");
  await expect(page.getByTestId("verification-kpi-serve")).toContainText("04 · Serve");
  await expect(page.getByTestId("verification-kpi-index")).toContainText(dm.last_block.toLocaleString("en-US"));
  await expect(page.getByTestId("verification-kpi-compute")).toContainText("1");
  await expect(page.getByTestId("verification-kpi-compute")).toContainText("batch · 2 Cash accounts");
  await expect(page.getByTestId("verification-kpi-verify")).toContainText("87/87");
  await expect(page.getByTestId("verification-kpi-verify")).toContainText("checked rows exact · 0 drifted");
  await expect(page.getByTestId("verification-kpi-verify")).toHaveAttribute("data-tone", "ok");
  await expect(page.getByTestId("verification-kpi-serve")).toContainText("17");
  // The sentence carries no second heading: it is the whole of its paragraph.
  await expect(page.getByTestId("verification-step-index")).toHaveText("Latest block indexed for each engine, ahead of every batch.");
  await expect(page.getByTestId("verification-step-compute")).toHaveText(
    "Batch 1 computed at 2026-07-29T10:00:00Z; every position's health from exact integers, never floats.",
  );
  await expect(page.getByTestId("verification-step-verify")).toHaveText("Every checked row of the pinned run matched the chain exactly; none drifted.");
  await expect(page.getByTestId("verification-step-serve")).toHaveText("17 read-only endpoints, every money value a decimal string.");
  const receipt = page.getByTestId("verification-receipt");
  await expect(receipt).toHaveText("Reconcile receipt: 87 checked rows exact, 0 drifted");
  await expect(receipt).toHaveAttribute("data-tone", "ok");
  // One word for the receipt's rows: the page counts checked rows, and the wire's term waits in the drawer.
  for (const id of ["verification-verdict", "verification-architecture", "verification-subject-proof"]) await expect(page.getByTestId(id)).not.toContainText("gated");

  // Answer before evidence: the header, then the architecture, then the subjects, then the probes.
  const y = async (id: string) => (await page.getByTestId(id).boundingBox())?.y ?? Number.NaN;
  expect(await y("verification-verdict")).toBeLessThan(await y("verification-architecture"));
  expect(await y("verification-architecture")).toBeLessThan(await y("verification-subject-proof"));
  expect(await y("verification-subject-proof")).toBeLessThan(await y("verification-probes"));
});

test("the split renders as two subjects; PROOF · EXACT lives ONLY on the proof card", async ({ page }) => {
  await mockAll(page);
  await page.goto("/proof");
  const proof = page.getByTestId("verification-subject-proof");
  const live = page.getByTestId("verification-subject-live");
  await expect(proof).toBeVisible();
  await expect(live).toBeVisible();
  // The pin is the receipt's own comparison sha, shortened.
  await expect(proof.getByTestId("verification-proof-status")).toHaveText("PROOF · EXACT @ 5f0b3e2a");
  await expect(proof).toContainText("ACCEPTED · every checked row matched the chain exactly");
  // The pass's colour is on the pill and on each answer row of a run that compared rows and passed: the status, the checked tally, both welds, the registry's identity — never on the dim line that says what the welds are.
  await expect(proof.locator("[data-tone='ok']")).toHaveCount(6);
  await expect(proof.getByTestId("verification-weld-debt_manager").locator("[data-tone='ok']")).toHaveText("29/29 exact");
  // The live subject wears its own identity — never the proof's.
  await expect(live.getByTestId("verification-live-status")).toHaveText("SERVING · WATERMARKED");
  await expect(live).not.toContainText("PROOF");
  await expect(live).not.toContainText("EXACT");
});

test("the two cards share a bottom edge, and an identifier's row stacks so the whole key holds one line, left-set, beside its copy chip", async ({ page }) => {
  await mockAll(page);
  await page.goto("/proof");
  const proof = await page.getByTestId("verification-subject-proof").boundingBox();
  const live = await page.getByTestId("verification-subject-live").boundingBox();
  if (proof === null || live === null) throw new Error("expected both cards laid out");
  expect(Math.abs(proof.y + proof.height - (live.y + live.height))).toBeLessThanOrEqual(1);
  const keyRow = page.getByTestId("verification-key");
  // One line box: the 64-hex key is never broken mid-token.
  const key = keyRow.getByText(REAL_KEY, { exact: true });
  expect(await key.evaluate((el) => el.getClientRects().length)).toBe(1);
  // Stacked and left-set: the value begins under its label, not against the card's right edge.
  const label = await keyRow.locator("span").first().boundingBox();
  const value = await key.boundingBox();
  if (label === null || value === null) throw new Error("expected the key row laid out");
  expect(value.y).toBeGreaterThan(label.y);
  expect(Math.abs(value.x - label.x)).toBeLessThanOrEqual(1);
});

test("the materialization key renders with a copy affordance that copies the COMPLETE key", async ({ page }) => {
  await mockAll(page);
  await page.goto("/proof");
  const keyRow = page.getByTestId("verification-key");
  await expect(keyRow).toContainText(REAL_KEY);
  const copy = keyRow.getByRole("button", { name: "copy materialization key", exact: true });
  await copy.click();
  await expect(copy).toHaveText("✓");
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied).toBe(REAL_KEY);
});

test("a failed receipt: data-receipt failed, the warn header, the rejected pill, the drift counted and where its rows are recorded — never 'named' — the failing receipt line, no PROOF · EXACT anywhere", async ({
  page,
}) => {
  await mockAll(page, EVIDENCE_PROOF_FAILED);
  await page.goto("/proof");
  await expect(surface(page)).toHaveAttribute("data-receipt", "failed");
  await expect(verdict(page)).toHaveAttribute("data-variant", "warn");
  // Never worded as accepted, and never as "0 drift": the receipt's own tally is the finding.
  await expect(headline(page)).toHaveText("The last reconcile run did not match the chain exactly, 84 of 87 checked rows matched; 3 rows drifted.");
  await expect(headline(page).locator("b")).toHaveText("The last reconcile run did not match the chain exactly,");
  await expect(page.getByTestId("verification-verdict-dek")).toHaveText(
    "No exactness is claimed for this deployment until a run passes. Batch 1, served now, is live data; no check covers it.",
  );
  await expect(chip(page, "Receipt")).toContainText("failed · 84/87");
  await expect(chip(page, "Receipt")).toHaveClass(/chipCrit/);
  await expect(page.getByTestId("verification-proof-status")).toHaveText("RECEIPT REJECTED");
  await expect(page.getByTestId("verification-subject-proof")).toContainText('receipt verdict "fail"');
  // The drift is real in the weld data, and it renders.
  await expect(page.getByTestId("verification-weld-debt_manager")).toContainText("26/29 exact");
  await expect(page.getByTestId("verification-kpi-verify")).toHaveAttribute("data-tone", "warn");
  // The manifest carries the receipt's tallies and no row: the step counts the drift and says where the rows are recorded; nothing on the page promises a name it cannot print.
  await expect(page.getByTestId("verification-step-verify")).toHaveText(
    "84 of 87 checked rows matched the chain exactly; 3 rows drifted. This manifest carries the tallies, not the rows: they are recorded in the committed drift report, roadmap/evidence/artifacts/w1-reconcile/drift-report.json.",
  );
  await expect(page.getByTestId("verification-architecture")).not.toContainText("named");
  await expect(page.getByTestId("verification-verdict")).not.toContainText("named");
  const receipt = page.getByTestId("verification-receipt");
  await expect(receipt).toHaveText('Reconcile receipt failed: receipt verdict "fail" (exit 1) — 84 of 87 checked rows exact, 3 drifted');
  await expect(receipt).toHaveAttribute("data-tone", "warn");
  // The proof badge appears NOWHERE on this page.
  await expect(page.getByText("PROOF · EXACT @")).toHaveCount(0);
  // The live subject still serves — the split holds in this direction too.
  await expect(page.getByTestId("verification-live-status")).toHaveText("SERVING · WATERMARKED");
});

test("a rejected receipt names its fault in the page's words — a short weld by its engine's name, a short checked tally as its row reads — on the card, the Receipt chip, the strip and the drawer; never 'gated', never an engine's wire id", async ({
  page,
}) => {
  const legacyShort = structuredClone(EVIDENCE_MANIFEST);
  if (legacyShort.reconcile === null) throw new Error("fixture invariant: reconcile expected");
  legacyShort.reconcile.welds = legacyShort.reconcile.welds.map((w) => (w.engine === "aave_v3_etherfi" ? { ...w, rows_exact: 13 } : w));
  legacyShort.proof_subject = { ...legacyShort.proof_subject, status: "rejected" };
  await mockAll(page, legacyShort);
  await page.goto("/proof");
  await expect(surface(page)).toHaveAttribute("data-receipt", "drift");
  const fault = "Aave v3 market (legacy) · account comparisons 13/14 exact";
  await expect(page.getByTestId("verification-subject-proof")).toContainText(`REJECTED · ${fault}`);
  await expect(chip(page, "Receipt")).toHaveAttribute("title", fault);
  await expect(page.getByTestId("verification-receipt")).toHaveText(`Reconcile receipt: 87 of 87 checked rows exact, 0 drifted — ${fault}, the proof badge refused`);
  await expect(headline(page)).toHaveText("The last reconcile run did not match the chain exactly, Aave v3 market (legacy) matched 13 of 14 account comparisons.");
  for (const id of ["verification-verdict", "verification-architecture", "verification-subject-proof"]) {
    await expect(page.getByTestId(id)).not.toContainText("gated");
    await expect(page.getByTestId(id)).not.toContainText("aave_v3_etherfi");
  }
  await page.getByRole("button", { name: "explain proof subject" }).click();
  const evidence = page.getByTestId("verification-drawer-evidence");
  await expect(evidence).toContainText(`RECEIPT REJECTED · ${fault}`);
  await expect(evidence).not.toContainText("aave_v3_etherfi weld");
  await page.keyboard.press("Escape");

  // A checked row short, nothing drifted: the status row reads the checked tally in the words of the row beneath it.
  const rowShort = structuredClone(EVIDENCE_MANIFEST);
  if (rowShort.reconcile === null) throw new Error("fixture invariant: reconcile expected");
  rowShort.reconcile.gated_exact = 86;
  rowShort.proof_subject = { ...rowShort.proof_subject, status: "rejected" };
  await page.route("**/v1/evidence*", (route) => json(route, rowShort));
  await page.goto("/proof");
  await expect(surface(page)).toHaveAttribute("data-receipt", "drift");
  await expect(page.getByTestId("verification-subject-proof")).toContainText("REJECTED · checked rows 86/87 exact · 0 drifted");
  await expect(chip(page, "Receipt")).toHaveAttribute("title", "checked rows 86/87 exact · 0 drifted");
  for (const id of ["verification-verdict", "verification-architecture", "verification-subject-proof"]) await expect(page.getByTestId(id)).not.toContainText("gated");
});

test("a receipt that gated no rows proves nothing: data-receipt empty, the refused header, never 'All 0 checked rows matched', no PROOF · EXACT anywhere", async ({
  page,
}) => {
  const empty = structuredClone(EVIDENCE_MANIFEST);
  if (empty.reconcile === null) throw new Error("fixture invariant: reconcile expected");
  Object.assign(empty.reconcile, { gated_rows: 0, gated_exact: 0, gated_drift: 0, welds: [] });
  await mockAll(page, empty);
  await page.goto("/proof");
  await expect(surface(page)).toHaveAttribute("data-state", "ok");
  await expect(surface(page)).toHaveAttribute("data-receipt", "empty");
  await expect(verdict(page)).toHaveAttribute("data-variant", "refused");
  await expect(headline(page)).toHaveText("Nothing is proven for this deployment: the pinned reconcile run compared no rows.");
  await expect(page.getByTestId("verification-verdict-dek")).toHaveText(
    "That run checked no rows, so no exactness is claimed for this deployment until a run compares rows and passes. Batch 1, served now, is live data; no check covers it.",
  );
  await expect(chip(page, "Receipt")).toContainText("empty · 0/0");
  await expect(chip(page, "Receipt")).toHaveClass(/chipRefused/);
  const verify = page.getByTestId("verification-kpi-verify");
  await expect(verify).toHaveAttribute("data-tone", "refused");
  await expect(verify).toContainText("checked rows · none compared");
  await expect(page.getByTestId("verification-step-verify")).toHaveText(
    "The pinned reconcile run checked no rows: nothing was compared, so nothing is verified against the chain.",
  );
  await expect(page.getByTestId("verification-receipt")).toHaveText("Reconcile receipt: the run checked no rows — nothing was compared, the proof badge refused");
  await expect(page.getByTestId("verification-receipt")).toHaveAttribute("data-tone", "refused");
  await expect(page.getByTestId("verification-proof-status")).toHaveText("RECEIPT COMPARED NO ROWS");
  await expect(page.getByTestId("verification-subject-proof")).toContainText("NOTHING PROVEN · the run checked no rows, so nothing was compared");
  for (const claim of ["All 0", "matched the chain", "PROOF · EXACT @", "ACCEPTED"]) await expect(page.locator("body")).not.toContainText(claim);
});

test("nothing is green under a receipt of no rows: a weld of 0/0 exact is dim on the proof card and in its drawer, and no element of either wears the ok tone", async ({
  page,
}) => {
  const empty = structuredClone(EVIDENCE_MANIFEST);
  if (empty.reconcile === null) throw new Error("fixture invariant: reconcile expected");
  Object.assign(empty.reconcile, { gated_rows: 0, gated_exact: 0, gated_drift: 0 });
  for (const weld of empty.reconcile.welds) Object.assign(weld, { rows_compared: 0, rows_exact: 0 });
  await mockAll(page, empty);
  await page.goto("/proof");
  await expect(surface(page)).toHaveAttribute("data-receipt", "empty");
  const proof = page.getByTestId("verification-subject-proof");
  await expect(proof.getByTestId("verification-proof-status")).toHaveText("RECEIPT COMPARED NO ROWS");
  for (const engine of ["debt_manager", "aave_v3_etherfi"]) {
    const weld = proof.getByTestId(`verification-weld-${engine}`);
    await expect(weld).toBeVisible();
    await expect(weld.locator("[data-tone]")).toHaveText("0/0 exact");
    await expect(weld.locator("[data-tone]")).toHaveAttribute("data-tone", "dim");
  }
  // The line beneath the welds states their counting rule, true of welds that compared nothing: no row is said to be advisory.
  await expect(proof.getByTestId("verification-welds-note")).toContainText("count every compared row, checked or advisory; they are not a breakdown of the checked rows");
  await expect(proof).not.toContainText("include advisory rows");
  // The fold's rows are in the DOM whether or not it is open, so the count covers the whole card.
  await expect(proof.locator("[data-tone='ok']")).toHaveCount(0);
  // The drawer prints the same chain under the same law.
  await page.getByRole("button", { name: "explain proof subject" }).click();
  const evidence = page.getByTestId("verification-drawer-evidence");
  await expect(evidence).toContainText("NOTHING PROVEN · the run checked no rows, so nothing was compared");
  await expect(evidence).toContainText("0/0 exact");
  await expect(evidence.locator("[data-tone='ok']")).toHaveCount(0);
  await expect(evidence.locator("[data-tone='dim']").filter({ hasText: /^0\/0 exact$/ })).toHaveCount(2);
});

test("a missing receipt is a first-class state: data-receipt none, warn, the served reason, the refused proof-pin chip", async ({ page }) => {
  await mockAll(page, EVIDENCE_NO_RECEIPT);
  await page.goto("/proof");
  await expect(surface(page)).toHaveAttribute("data-receipt", "none");
  await expect(verdict(page)).toHaveAttribute("data-variant", "warn");
  // An absence named as an absence — never a zero, never a pass.
  await expect(headline(page)).toHaveText("Nothing is proven for this deployment: no reconcile receipt is committed.");
  await expect(page.getByTestId("verification-verdict-dek")).toHaveText(
    "No committed receipt artifact is present in this deployment. Batch 1, served now, is live data; no check covers it.",
  );
  await expect(chip(page, "Proof pin")).toContainText("none");
  await expect(chip(page, "Proof pin")).toHaveClass(/chipRefused/);
  await expect(chip(page, "Receipt")).toContainText("none");
  await expect(page.getByTestId("verification-proof-status")).toHaveText("NO COMMITTED RECEIPT");
  await expect(page.getByTestId("verification-subject-proof")).toContainText("no committed receipt artifact is present in this deployment");
  await expect(page.getByTestId("verification-receipt")).toHaveText("No reconcile receipt: no committed receipt artifact is present in this deployment");
  await expect(page.getByTestId("verification-receipt")).toHaveAttribute("data-tone", "refused");
  // The wire stated the absence, so the tile and its sentence may say so — this is not an unread receipt.
  await expect(page.getByTestId("verification-kpi-verify")).toContainText("—");
  await expect(page.getByTestId("verification-kpi-verify")).toContainText("no committed receipt");
  await expect(page.getByTestId("verification-kpi-verify")).toHaveAttribute("data-tone", "refused");
  await expect(page.getByTestId("verification-step-verify")).toContainText("No reconcile receipt is committed; nothing is verified against the chain.");
  await expect(page.getByText("PROOF · EXACT @")).toHaveCount(0);
  await expect(page.getByTestId("verification-live-status")).toHaveText("SERVING · WATERMARKED");
});

test("a missing batch renders loudly, refuses the live chips and fabricates NO materialization key; the proof stands", async ({ page }) => {
  await mockAll(page, EVIDENCE_NO_BATCH);
  await page.goto("/proof");
  await expect(surface(page)).toHaveAttribute("data-receipt", "exact");
  await expect(headline(page)).toHaveText("All 87 checked rows matched the chain exactly, in the pinned reconcile run — but no batch can be served right now.");
  // The tone is the receipt's and only the finding wears it; the absent batch is said in the ink clause, the dek and two refused chips — never painted with the colour that means "the receipt is not exact".
  await expect(verdict(page)).toHaveAttribute("data-variant", "ok");
  await expect(headline(page).locator("b")).toHaveText("All 87 checked rows matched the chain exactly,");
  await expect(page.getByTestId("verification-verdict-dek")).toContainText(
    "No complete risk batch is available. This is a statement about the SERVICE, NOT a claim that the book is empty. The proof still stands for its own run; it says nothing about live data.",
  );
  await expect(chip(page, "Live batch")).toContainText("none");
  await expect(chip(page, "Live batch")).toHaveClass(/chipRefused/);
  await expect(chip(page, "Batch key")).toContainText("—");
  await expect(chip(page, "Batch key")).toHaveClass(/chipRefused/);
  await expect(page.getByTestId("verification-live-status")).toHaveText("NO SERVABLE BATCH");
  await expect(page.getByTestId("verification-subject-live")).toContainText("no complete risk batch is available");
  await expect(page.getByTestId("verification-key")).toContainText("never fabricated");
  // The example's real key must appear NOWHERE — absence is absence.
  await expect(page.getByText(REAL_KEY)).toHaveCount(0);
  await expect(page.getByTestId("verification-proof-status")).toHaveText("PROOF · EXACT @ 5f0b3e2a");
});

test("the compute step reads the census only: /proof asks /v1/book once and never walks /v1/positions — the step still names its batch and its account count", async ({
  page,
}) => {
  await mockAll(page);
  const asked = { book: 0, positions: 0 };
  page.on("request", (request) => {
    const path = new URL(request.url()).pathname;
    if (path === "/v1/book") asked.book += 1;
    if (path.startsWith("/v1/positions")) asked.positions += 1;
  });
  await page.goto("/proof");
  await expect(surface(page)).toHaveAttribute("data-state", "ok");
  await expect(page.getByTestId("verification-kpi-compute")).toContainText("1");
  await expect(page.getByTestId("verification-kpi-compute")).toContainText("batch · 2 Cash accounts");
  await expect(page.getByTestId("verification-step-compute")).toContainText(
    "Batch 1 computed at 2026-07-29T10:00:00Z; every position's health from exact integers, never floats.",
  );
  // The book has landed and printed; a walk would have asked for its first page by now.
  await page.waitForTimeout(300);
  expect(asked.book).toBe(1);
  expect(asked.positions).toBe(0);
});

test("a withheld Cash engine: the compute step prints the batch and names the census withheld, in the refused tone — never '0 Cash accounts', never neutral", async ({
  page,
}) => {
  // The contract's withheld card: refused, its refusal, null totals, and placeholder counts — 0 in the contract's own example.
  const refusal = { engine: "debt_manager", code: "FLAG_CUSTODY_UNPROVEN", detail: "collateral-flag custody is unproven for this window", note: "" };
  const withheld = {
    ...BOOK,
    refused_engines: [refusal],
    engines: BOOK.engines.map((e) =>
      e.engine === "debt_manager"
        ? { ...e, refused: true, refusal, positions: 0, computed_positions: 0, refused_positions: 0, total_debt: null, total_collateral: null }
        : e,
    ),
  };
  await mockAll(page);
  await page.route("**/v1/book", (route) => json(route, withheld));
  await page.goto("/proof");
  await expect(surface(page)).toHaveAttribute("data-state", "ok");
  const compute = page.getByTestId("verification-kpi-compute");
  await expect(compute).toContainText("1");
  await expect(compute).toContainText("batch · Cash accounts withheld");
  await expect(compute).toHaveAttribute("data-tone", "refused");
  await expect(compute).not.toContainText("0 Cash accounts");
  await expect(page.getByTestId("verification-step-compute")).toContainText(
    "Batch 1 computed at 2026-07-29T10:00:00Z; the Cash book is withheld this batch (collateral-flag custody unproven).",
  );
  await expect(page.locator("body")).not.toContainText("0 Cash accounts");
});

test("evidence unavailable: state unavailable, the refused header with the retry law, the failure said once, a retry that asks again, no subject invented, the other steps still answer", async ({
  page,
}) => {
  await page.route("**/v1/stream**", (route) => route.abort());
  await page.route("**/v1/book", (route) => json(route, BOOK));
  await page.route("**/v1/positions*", (route) => json(route, POSITIONS_DM_PAGE_1));
  await page.route("**/v1/meta*", (route) => json(route, META));
  let reachable = false;
  await page.route("**/v1/evidence*", (route) => (reachable ? json(route, EVIDENCE_MANIFEST) : route.abort()));
  await page.goto("/proof");
  await expect(surface(page)).toHaveAttribute("data-state", "unavailable");
  await expect(surface(page)).toHaveAttribute("data-receipt", "none");
  await expect(verdict(page)).toHaveAttribute("data-variant", "refused");
  await expect(headline(page)).toHaveText("The verification record could not be fetched.");
  await expect(page.getByTestId("verification-verdict-dek")).toContainText("Nothing is substituted for it: no cached proof, no assumed batch, no fabricated key.");
  await expect(chip(page, "Receipt")).toContainText("unknown");
  // Neither subject is invented while the manifest is unreachable; the probes have nothing to list.
  await expect(page.getByTestId("verification-subject-proof")).toHaveCount(0);
  await expect(page.getByTestId("verification-subject-live")).toHaveCount(0);
  await expect(page.getByTestId("verification-probes")).toHaveCount(0);
  // The architecture still prints what meta and the book answered; only Verify is unread — the dash, the word, never an absence.
  await expect(page.getByTestId("verification-kpi-index")).toContainText(dm.last_block.toLocaleString("en-US"));
  await expect(page.getByTestId("verification-kpi-compute")).toContainText("1");
  await expect(page.getByTestId("verification-kpi-verify")).toContainText("—");
  await expect(page.getByTestId("verification-kpi-verify")).toContainText("unavailable");
  await expect(page.getByTestId("verification-kpi-verify")).toHaveAttribute("data-tone", "refused");
  await expect(page.getByTestId("verification-step-verify")).toHaveText(/The receipt could not be read\.$/);
  // The failure is said once, in the header: the receipt strip stands down rather than say it again beneath the tiles.
  await expect(page.getByTestId("verification-receipt")).toHaveCount(0);
  const said = (await surface(page).innerText()).split("could not be fetched").length - 1;
  expect(said).toBe(1);
  // One thing to do next: the retry asks again, and the page answers from the new read.
  const retry = page.getByTestId("verification-retry");
  await expect(retry).toHaveText("Retry");
  reachable = true;
  await retry.click();
  await expect(surface(page)).toHaveAttribute("data-state", "ok");
  await expect(surface(page)).toHaveAttribute("data-receipt", "exact");
  await expect(page.getByTestId("verification-retry")).toHaveCount(0);
  await expect(page.getByTestId("verification-receipt")).toHaveText("Reconcile receipt: 87 checked rows exact, 0 drifted");
});

test("retry keeps focus: pressed from the keyboard, the control leaves with the failure it answered and focus lands on the page's heading — never on <body> — and the heading is no Tab stop", async ({
  page,
}) => {
  await page.route("**/v1/stream**", (route) => route.abort());
  await page.route("**/v1/book", (route) => json(route, BOOK));
  await page.route("**/v1/positions*", (route) => json(route, POSITIONS_DM_PAGE_1));
  await page.route("**/v1/meta*", (route) => json(route, META));
  let reachable = false;
  await page.route("**/v1/evidence*", (route) => (reachable ? json(route, EVIDENCE_MANIFEST) : route.abort()));
  await page.goto("/proof");
  await expect(surface(page)).toHaveAttribute("data-state", "unavailable");
  const focused = () => page.evaluate(() => document.activeElement?.tagName ?? "nothing");
  // The first read moves no focus, and the heading is not a focus target until a retry needs one.
  expect(await focused()).toBe("BODY");
  expect(await headline(page).evaluate((el) => el.hasAttribute("tabindex"))).toBe(false);

  const retry = page.getByTestId("verification-retry");
  await retry.focus();
  await expect(retry).toBeFocused();
  reachable = true;
  await page.keyboard.press("Enter");
  await expect(surface(page)).toHaveAttribute("data-state", "ok");
  await expect(retry).toHaveCount(0);
  // The control is gone; the focus it held is on the heading, which now states the finding the retry fetched.
  await expect(headline(page)).toBeFocused();
  expect(await focused()).toBe("H1");
  await expect(headline(page)).toHaveText("All 87 checked rows matched the chain exactly, in this deployment's pinned reconcile run.");
  // Focusable by script alone: Tab leaves it for the page's first control, and Shift+Tab never comes back to it.
  await expect(headline(page)).toHaveAttribute("tabindex", "-1");
  await page.keyboard.press("Tab");
  await expect(page.getByTestId("verification-drawer")).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(headline(page)).not.toBeFocused();
  expect(await focused()).not.toBe("H1");
});

test("a read in flight has not failed: while /v1/evidence, /v1/book and /v1/meta are unanswered every step is pending in its own words — 'could not be read' and 'unavailable' wait for a failure", async ({
  page,
}) => {
  let release: () => void = () => undefined;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/v1/stream**", (route) => route.abort());
  await page.route("**/v1/positions*", (route) => json(route, POSITIONS_DM_PAGE_1));
  await page.route("**/v1/book", async (route) => {
    await held;
    await json(route, BOOK);
  });
  await page.route("**/v1/meta*", async (route) => {
    await held;
    await json(route, META);
  });
  await page.route("**/v1/evidence*", async (route) => {
    await held;
    await json(route, EVIDENCE_MANIFEST);
  });
  await page.goto("/proof");
  await expect(surface(page)).toHaveAttribute("data-state", "loading");
  for (const key of ["index", "compute", "verify"]) {
    const tile = page.getByTestId(`verification-kpi-${key}`);
    await expect(tile).toHaveAttribute("aria-busy", "true");
    await expect(tile).toContainText("pending");
    await expect(tile).toHaveAttribute("data-tone", "neutral");
  }
  await expect(page.getByTestId("verification-step-compute")).toHaveText("Reading the batch…");
  await expect(page.getByTestId("verification-step-verify")).toHaveText("Reading the receipt…");
  // The receipt is pending, as its tile is: the strip is neutral and busy, drawn with the solid rule — the dashed, dimmed strip is a refusal's — and the page's receipt is not "none", the manifest's own absence.
  const strip = page.getByTestId("verification-receipt");
  await expect(strip).toHaveText("Reading the reconcile receipt…");
  await expect(strip).toHaveAttribute("data-tone", "neutral");
  await expect(strip).toHaveAttribute("aria-busy", "true");
  expect(await strip.evaluate((el) => getComputedStyle(el).borderTopStyle)).toBe("solid");
  await expect(surface(page)).toHaveAttribute("data-receipt", "pending");
  // Every identity chip waits with it: the word, and no refused chip — nothing has been withheld.
  for (const label of ["Proof pin", "Live batch", "Receipt", "Batch key"]) {
    await expect(chip(page, label)).toContainText("pending");
    await expect(chip(page, label)).not.toHaveClass(/chipRefused/);
  }
  for (const words of ["unknown", "none"]) await expect(page.getByTestId("verification-verdict-identity")).not.toContainText(words);
  // Neither subject is drawn before the manifest answers.
  await expect(page.getByTestId("verification-subject-proof")).toHaveCount(0);
  await expect(page.getByTestId("verification-subject-live")).toHaveCount(0);
  // Nothing has failed, so nothing says it has.
  for (const words of ["could not be read", "could not be fetched", "unavailable"]) await expect(surface(page)).not.toContainText(words);
  await expect(page.getByTestId("verification-retry")).toHaveCount(0);
  release();
  await expect(surface(page)).toHaveAttribute("data-state", "ok");
  await expect(surface(page).locator("[aria-busy='true']")).toHaveCount(0);
  await expect(surface(page)).toHaveAttribute("data-receipt", "exact");
  await expect(strip).toHaveAttribute("data-tone", "ok");
  await expect(page.getByTestId("verification-step-verify")).toHaveText("Every checked row of the pinned run matched the chain exactly; none drifted.");
});

test("with the whole API unreachable every step but Serve is unavailable — unread, never an absence, never a zero", async ({ page }) => {
  await page.route("**/v1/**", (route) => route.abort());
  await page.goto("/proof");
  await expect(surface(page)).toHaveAttribute("data-state", "unavailable");
  for (const key of ["index", "compute", "verify"]) {
    await expect(page.getByTestId(`verification-kpi-${key}`)).toContainText("—");
    await expect(page.getByTestId(`verification-kpi-${key}`)).toContainText("unavailable");
    await expect(page.getByTestId(`verification-kpi-${key}`)).toHaveAttribute("data-tone", "refused");
  }
  await expect(page.getByTestId("verification-kpi-serve")).toContainText("17");
  await expect(page.getByTestId("verification-step-compute")).toHaveText(/The batch could not be read\.$/);
  await expect(page.getByTestId("verification-step-verify")).toHaveText(/The receipt could not be read\.$/);
  await expect(page.locator("body")).not.toContainText("No batch is servable");
  await expect(page.locator("body")).not.toContainText("No reconcile receipt is committed");
  for (const zero of ["0 checked rows", "0 gated rows"]) await expect(page.locator("body")).not.toContainText(zero);
});

test("an absence the wire stated is worded as one: a 503 no-batch book on the Compute tile, a manifest with no receipt on the Verify tile", async ({
  page,
}) => {
  await page.route("**/v1/stream**", (route) => route.abort());
  await page.route("**/v1/book", (route) => json(route, BOOK_ERROR_UNAVAILABLE, 503));
  await page.route("**/v1/positions*", (route) => json(route, POSITIONS_DM_PAGE_1));
  await page.route("**/v1/meta*", (route) => json(route, META));
  await page.route("**/v1/evidence*", (route) => json(route, EVIDENCE_NO_RECEIPT));
  await page.goto("/proof");
  await expect(surface(page)).toHaveAttribute("data-state", "ok");
  const compute = page.getByTestId("verification-kpi-compute");
  await expect(compute).toContainText("—");
  await expect(compute).toContainText("no servable batch");
  await expect(compute).toHaveAttribute("data-tone", "refused");
  await expect(page.getByTestId("verification-step-compute")).toHaveText(/No batch is servable; nothing is computed\.$/);
  const verify = page.getByTestId("verification-kpi-verify");
  await expect(verify).toContainText("—");
  await expect(verify).toContainText("no committed receipt");
  await expect(page.getByTestId("verification-step-verify")).toHaveText(/No reconcile receipt is committed; nothing is verified against the chain\.$/);
  // The meta answered: the Index tile keeps its number beside the two absences.
  await expect(page.getByTestId("verification-kpi-index")).toContainText(dm.last_block.toLocaleString("en-US"));
});

test("the Overview's \"Architecture & verification →\" lands on the architecture section", async ({ page }) => {
  await mockAll(page);
  await page.goto("/");
  await page.getByRole("link", { name: "Architecture & verification →" }).click();
  await expect(page).toHaveURL(/#architecture$/);
  const section = page.getByTestId("verification-architecture");
  await expect(section).toHaveAttribute("id", "architecture");
  // Once the manifest has answered the page has its height and the named section is scrolled to, clear of the 56px app bar
  // (scroll-margin-top 72px). The poll measures the scroll itself: an un-scrolled page leaves the section far lower.
  await expect(surface(page)).toHaveAttribute("data-state", "ok");
  await expect.poll(() => section.evaluate((el) => el.getBoundingClientRect().top)).toBeLessThanOrEqual(120);
});

test("the drawer: the doctrine from the header; a subject's explain puts its evidence chain first — PROVEN on the proof, OPERATIONAL on the live", async ({
  page,
}) => {
  await mockAll(page);
  await page.goto("/proof");
  await page.getByTestId("verification-drawer").click();
  const body = page.getByTestId("verification-drawer-body");
  await expect(body).toContainText(
    "What this deployment is, exactly: the pinned proof of its last reconcile and the identity of the batch it serves now. Nothing here is measured on request: every field is carried by the build or persisted by a batch.",
  );
  await expect(body).toContainText("TWO SUBJECTS, NEVER ONE. The proof speaks for its pinned run; the live batch serves under its watermark vector.");
  await expect(body).toContainText(`Batch #1 · key ${REAL_KEY} · commit 748c09d1e2f3 · receipt pass · 87/87`);
  await expect(page.getByTestId("verification-drawer-evidence")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByTestId("verification-drawer")).toBeFocused();

  await page.getByRole("button", { name: "explain proof subject" }).click();
  const evidence = page.getByTestId("verification-drawer-evidence");
  await expect(evidence).toContainText("PROVEN");
  await expect(evidence).toContainText(EVIDENCE_MANIFEST.reconcile?.comparison_sha256 ?? "∅");
  await expect(evidence).toContainText("gated_exact == gated_rows");
  // The wire's term is kept once, beside its gloss in the page's word.
  await expect(evidence).toContainText("checked rows — the rows that must match for the run to pass");
  await expect(evidence).toContainText("count every compared row, checked or advisory; they are not a breakdown of the checked rows");
  await expect(body).toContainText("TWO SUBJECTS, NEVER ONE.");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);

  await page.getByRole("button", { name: "explain live subject" }).click();
  await expect(evidence).toContainText("OPERATIONAL");
  await expect(evidence).toContainText("does NOT inherit");
});

test("the raw-JSON toggle shows the wire body", async ({ page }) => {
  await mockAll(page);
  await page.goto("/proof");
  await expect(page.getByTestId("verification-raw-json")).toHaveCount(0);
  await page.getByTestId("verification-raw").click();
  const raw = page.getByTestId("verification-raw-json");
  await expect(raw).toBeVisible();
  await expect(raw).toContainText('"materialization_key"');
  await expect(raw).toContainText(REAL_KEY);
  await page.getByTestId("verification-raw").click();
  await expect(page.getByTestId("verification-raw-json")).toHaveCount(0);
});

test("the proof card's answer layer stays visible; provenance folds counted and CLOSED", async ({ page }) => {
  await mockAll(page);
  await page.goto("/proof");
  const proof = page.getByTestId("verification-subject-proof");
  // Visible with the fold closed: the checked rows and their drift, both welds by engine name, the line that says what the welds are, the registry's identity — none of them inside the fold.
  await expect(proof.getByText("87/87 exact · 0 drifted")).toBeVisible();
  await expect(proof.getByTestId("verification-weld-debt_manager")).toBeVisible();
  await expect(proof.getByTestId("verification-weld-debt_manager")).toContainText("Cash · account comparisons");
  await expect(proof.getByTestId("verification-weld-aave_v3_etherfi")).toBeVisible();
  await expect(proof.getByTestId("verification-weld-aave_v3_etherfi")).toContainText("Aave v3 market (legacy) · account comparisons");
  // The welds count every compared row whatever its gate, so they are no split of the checked tally: the card states that rule beneath them, dim.
  const note = proof.getByTestId("verification-welds-note");
  await expect(note).toBeVisible();
  await expect(note).toContainText("count every compared row, checked or advisory; they are not a breakdown of the checked rows");
  await expect(note.locator("[data-tone]")).toHaveAttribute("data-tone", "dim");
  await expect(proof.getByText("identical to service.registry_fingerprint, by construction")).toBeVisible();
  const fold = proof.getByTestId("verification-proof-forensics");
  await expect(fold.getByTestId("verification-weld-debt_manager")).toHaveCount(0);
  await expect(fold.getByTestId("verification-welds-note")).toHaveCount(0);
  await expect(fold.getByText("identical to service.registry_fingerprint, by construction")).toHaveCount(0);
  // The counted summary: 6 receipt rows + 6 identity rows + 3 feeds rows.
  await expect(fold.locator("summary")).toHaveText("15 provenance rows");
  // Forensic facts render only once the fold opens.
  await expect(proof.getByText("pro-rata-over-counted-collateral")).toBeHidden();
  await fold.locator("summary").click();
  await expect(proof.getByText("pro-rata-over-counted-collateral")).toBeVisible();
  await expect(fold.getByText("recon/feeds.json")).toBeVisible();
});

test("the live card leads with its takeaway; the key stays visible; digest + note fold counted", async ({ page }) => {
  await mockAll(page);
  await page.goto("/proof");
  const live = page.getByTestId("verification-subject-live");
  const digest = EVIDENCE_MANIFEST.substrate?.substrate_digest ?? "";
  if (digest.length === 0) throw new Error("fixture invariant: the example carries a digest");
  await expect(live.getByTestId("verification-live-takeaway")).toHaveText("serving batch 1 · stamped with the chain blocks it was read at; operational, never the proof");
  await expect(live.getByTestId("verification-key")).toBeVisible();
  const fold = live.getByTestId("verification-live-forensics");
  await expect(fold.locator("summary")).toHaveText("2 provenance rows");
  await expect(live.getByText(digest)).toBeHidden();
  await fold.locator("summary").click();
  await expect(live.getByText(digest)).toBeVisible();
});

test("hazards never fold: a predates-custody digest gap, a pub() refusal, a fingerprint MISMATCH each render OUTSIDE the fold", async ({ page }) => {
  // ONE documented delta each, on the committed example.
  const gapped = structuredClone(EVIDENCE_MANIFEST);
  if (gapped.substrate === null) throw new Error("fixture invariant: substrate expected");
  gapped.substrate.substrate_digest = "";
  await mockAll(page, gapped);
  await page.goto("/proof");
  const live = page.getByTestId("verification-subject-live");
  const gap = live.getByTestId("verification-live-digest-gap");
  await expect(gap).toBeVisible();
  await expect(gap).toContainText("predates substrate-digest custody");
  await expect(live.getByTestId("verification-live-forensics").getByTestId("verification-live-digest-gap")).toHaveCount(0);
  await expect(live.getByTestId("verification-live-forensics").locator("summary")).toHaveText("1 provenance row");

  // The artifact path replaced by a DSN-shaped string: publishable() refuses it at render, and the refusal hoists.
  const leaking = structuredClone(EVIDENCE_MANIFEST);
  if (leaking.reconcile === null) throw new Error("fixture invariant: reconcile expected");
  leaking.reconcile.artifact_path = "postgres://user@db-host:5432/solvent";
  await mockAll(page, leaking);
  await page.reload();
  const refused = page.getByTestId("verification-proof-artifact-refused");
  await expect(refused).toBeVisible();
  await expect(refused).toContainText("WITHHELD");
  const proofFold = page.getByTestId("verification-proof-forensics");
  await expect(proofFold.getByTestId("verification-proof-artifact-refused")).toHaveCount(0);
  await expect(proofFold.locator("summary")).toHaveText("14 provenance rows");
  await expect(page.getByTestId("verification-subject-proof")).not.toContainText("db-host");

  // The service fingerprint flipped: the registry identity the contract calls identical by construction breaks, visibly.
  const flipped = structuredClone(EVIDENCE_MANIFEST);
  flipped.service.registry_fingerprint = "0".repeat(64);
  await mockAll(page, flipped);
  await page.reload();
  const mismatch = page.getByTestId("verification-subject-proof").getByText("MISMATCH against service.registry_fingerprint", { exact: false });
  await expect(mismatch.first()).toBeVisible();
  await expect(page.getByTestId("verification-proof-forensics").getByText("MISMATCH against service.registry_fingerprint")).toHaveCount(0);
});

test("probe records: the kit table with the card's columns and words; the count is the section's qualifier; the empty arm is a statement", async ({
  page,
}) => {
  await mockAll(page);
  await page.goto("/proof");
  const section = page.getByTestId("verification-probes-section");
  await expect(section).toContainText("1 committed probe record · 1 manifest note");
  const table = page.getByTestId("verification-probes");
  await expect(table.locator("thead")).toContainText("Record");
  await expect(table.locator("thead")).toContainText("Note");
  await expect(table.getByText("recon/p3-probes.md")).toBeVisible();
  await expect(table).toContainText("probe records name endpoints by environment variable only — publishable by construction.");
  await expect(table.getByText("manifest note", { exact: true })).toBeVisible();
  await expect(table.locator("tbody tr")).toHaveCount(2);

  // A DSN-shaped path is refused at render and the row stays, dimmed and counted.
  const leaking = structuredClone(EVIDENCE_MANIFEST);
  leaking.probe_records = [{ path: "postgres://user@db-host:5432/solvent", note: "a DSN where a path belongs" }];
  await mockAll(page, leaking);
  await page.reload();
  await expect(table.locator("tbody tr").first()).toHaveClass(/dim/);
  await expect(table).toContainText("WITHHELD");
  await expect(table).not.toContainText("db-host");

  // The empty arm: a statement, never a hidden zero.
  const emptied = structuredClone(EVIDENCE_MANIFEST);
  emptied.probe_records = [];
  emptied.notes = [];
  await mockAll(page, emptied);
  await page.reload();
  await expect(section).toContainText("0 committed probe records");
  await expect(table).toContainText("none named by this deployment's manifest — a statement about the deployment, not an absence to hide.");
});

test("a wire that claims no_batch beside a non-null substrate is demoted everywhere — header, chips, card — and no key is rendered", async ({
  page,
}) => {
  // The contradiction state liveSubjectStatus deliberately demotes to no-batch: every batch answer on the page must agree.
  const doctored = structuredClone(EVIDENCE_MANIFEST);
  doctored.live_subject = { status: "no_batch", reason: "wire claims no_batch beside a non-null substrate" };
  await mockAll(page, doctored);
  await page.goto("/proof");
  await expect(headline(page)).toContainText("but the manifest contradicts itself about the live batch, so none is claimed.");
  await expect(page.getByTestId("verification-verdict-dek")).not.toContainText("Batch 1");
  await expect(page.getByTestId("verification-live-status")).toHaveText("NO SERVABLE BATCH");
  await expect(chip(page, "Live batch")).toContainText("none");
  await expect(chip(page, "Batch key")).toContainText("—");
  await expect(page.getByText(REAL_KEY)).toHaveCount(0);
});
