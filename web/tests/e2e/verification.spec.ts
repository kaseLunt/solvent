// The Verification page-test contract (spec 2026-09-15 §5.5, §7; plan R1–R5,
// R8). Mocked from the committed fixtures: the contract's own /v1/evidence
// example and its three documented deltas (tests/fixtures/proof.ts), and the
// Overview's meta, book and positions mocks for the architecture steps. Every
// headline, chip, step and receipt string here is produced by
// lib/verification-view.ts (unit-pinned in tests/unit/verification-view.spec.ts);
// the subjects' words are lib/evidence.ts's.
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

test("the committed example: state ok, receipt exact, the takeaway headline, the split dek, four chips, four tiles, four sentences, the receipt line", async ({
  page,
}) => {
  await mockAll(page);
  await page.goto("/proof");
  await expect(surface(page)).toHaveAttribute("data-state", "ok");
  await expect(surface(page)).toHaveAttribute("data-receipt", "exact");
  await expect(verdict(page)).toHaveAttribute("data-variant", "ok");
  await expect(verdict(page)).toContainText("Verification · this deployment");
  await expect(headline(page)).toHaveText("receipt ACCEPTED at pin 5f0b3e2a; serving batch #1 under its watermark vector.");
  await expect(page.getByTestId("verification-verdict-dek")).toHaveText("Two subjects, never one: the pinned proof and the live batch.");

  // Identity: both subjects named, the receipt's state and tally, the whole key behind the chip.
  await expect(chip(page, "Pinned batch")).toContainText("pin 5f0b3e2a");
  await expect(chip(page, "Live batch")).toContainText("#1");
  await expect(chip(page, "Receipt")).toContainText("exact · 87/87");
  await expect(chip(page, "Key")).toHaveAttribute("title", REAL_KEY);

  // The four steps — the Overview's numbers, each with its one sentence.
  await expect(page.getByTestId("verification-kpi-index")).toContainText(dm.last_block.toLocaleString("en-US"));
  await expect(page.getByTestId("verification-kpi-compute")).toContainText("1");
  await expect(page.getByTestId("verification-kpi-compute")).toContainText("batch · 2 Cash accounts");
  await expect(page.getByTestId("verification-kpi-verify")).toContainText("87/87");
  await expect(page.getByTestId("verification-kpi-verify")).toHaveAttribute("data-tone", "ok");
  await expect(page.getByTestId("verification-kpi-serve")).toContainText("17");
  await expect(page.getByTestId("verification-step-index")).toContainText("Chain heights indexed per engine, ahead of every batch.");
  await expect(page.getByTestId("verification-step-compute")).toContainText(
    "Batch 1 computed at 2026-07-29T10:00:00Z; every position's health from the wire's own integers.",
  );
  await expect(page.getByTestId("verification-step-verify")).toContainText("87 gated rows reconciled exact against the chain; 0 drift named.");
  await expect(page.getByTestId("verification-step-serve")).toContainText("17 read-only endpoints, every money value a decimal string.");
  const receipt = page.getByTestId("verification-receipt");
  await expect(receipt).toHaveText("Reconcile receipt: 87 gated rows exact, 0 drift");
  await expect(receipt).toHaveAttribute("data-tone", "ok");

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
  await expect(proof).toContainText("ACCEPTED · every gated row welded exact");
  // The live subject wears its own identity — never the proof's.
  await expect(live.getByTestId("verification-live-status")).toHaveText("SERVING · WATERMARKED");
  await expect(live).not.toContainText("PROOF");
  await expect(live).not.toContainText("EXACT");
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

test("a failed receipt: data-receipt failed, the warn header, the rejected pill, the named drift, the failing receipt line, no PROOF · EXACT anywhere", async ({
  page,
}) => {
  await mockAll(page, EVIDENCE_PROOF_FAILED);
  await page.goto("/proof");
  await expect(surface(page)).toHaveAttribute("data-receipt", "failed");
  await expect(verdict(page)).toHaveAttribute("data-variant", "warn");
  await expect(headline(page)).toContainText("RECEIPT REJECTED — the proof badge is refused");
  await expect(chip(page, "Receipt")).toContainText("failed · 84/87");
  await expect(chip(page, "Receipt")).toHaveClass(/chipCrit/);
  await expect(page.getByTestId("verification-proof-status")).toHaveText("RECEIPT REJECTED");
  await expect(page.getByTestId("verification-subject-proof")).toContainText('receipt verdict "fail"');
  // The drift is real in the weld data, and it renders.
  await expect(page.getByTestId("verification-weld-debt_manager")).toContainText("26/29 exact");
  await expect(page.getByTestId("verification-kpi-verify")).toHaveAttribute("data-tone", "warn");
  const receipt = page.getByTestId("verification-receipt");
  await expect(receipt).toHaveText('Reconcile receipt failed: receipt verdict "fail" (exit 1) — 84 of 87 gated rows exact, 3 drift');
  await expect(receipt).toHaveAttribute("data-tone", "warn");
  // The proof badge appears NOWHERE on this page.
  await expect(page.getByText("PROOF · EXACT @")).toHaveCount(0);
  // The live subject still serves — the split holds in this direction too.
  await expect(page.getByTestId("verification-live-status")).toHaveText("SERVING · WATERMARKED");
});

test("a missing receipt is a first-class state: data-receipt none, warn, the served reason, the refused pinned-batch chip", async ({ page }) => {
  await mockAll(page, EVIDENCE_NO_RECEIPT);
  await page.goto("/proof");
  await expect(surface(page)).toHaveAttribute("data-receipt", "none");
  await expect(verdict(page)).toHaveAttribute("data-variant", "warn");
  await expect(headline(page)).toContainText("NO COMMITTED RECEIPT — nothing is proven");
  await expect(chip(page, "Pinned batch")).toContainText("none");
  await expect(chip(page, "Pinned batch")).toHaveClass(/chipRefused/);
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
  await expect(headline(page)).toContainText("receipt ACCEPTED at pin 5f0b3e2a; NO SERVABLE BATCH.");
  // A sentence that ends in NO SERVABLE BATCH is not green.
  await expect(verdict(page)).toHaveAttribute("data-variant", "warn");
  await expect(chip(page, "Live batch")).toContainText("none");
  await expect(chip(page, "Live batch")).toHaveClass(/chipRefused/);
  await expect(chip(page, "Key")).toContainText("—");
  await expect(chip(page, "Key")).toHaveClass(/chipRefused/);
  await expect(page.getByTestId("verification-live-status")).toHaveText("NO SERVABLE BATCH");
  await expect(page.getByTestId("verification-subject-live")).toContainText("no complete risk batch is available");
  await expect(page.getByTestId("verification-key")).toContainText("never fabricated");
  // The example's real key must appear NOWHERE — absence is absence.
  await expect(page.getByText(REAL_KEY)).toHaveCount(0);
  await expect(page.getByTestId("verification-proof-status")).toHaveText("PROOF · EXACT @ 5f0b3e2a");
});

test("evidence unavailable: state unavailable, the refused header with the retry law, no subject invented, the other steps still answer", async ({
  page,
}) => {
  await page.route("**/v1/stream**", (route) => route.abort());
  await page.route("**/v1/book", (route) => json(route, BOOK));
  await page.route("**/v1/positions*", (route) => json(route, POSITIONS_DM_PAGE_1));
  await page.route("**/v1/meta*", (route) => json(route, META));
  await page.route("**/v1/evidence*", (route) => route.abort());
  await page.goto("/proof");
  await expect(surface(page)).toHaveAttribute("data-state", "unavailable");
  await expect(surface(page)).toHaveAttribute("data-receipt", "none");
  await expect(verdict(page)).toHaveAttribute("data-variant", "refused");
  await expect(headline(page)).toContainText(/^Evidence unavailable: /);
  await expect(page.getByTestId("verification-verdict-dek")).toContainText("nothing is substituted for it: no cached proof, no assumed batch, no fabricated key.");
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
  await expect(page.getByTestId("verification-receipt")).toContainText("the evidence manifest could not be fetched");
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
  await expect(page.locator("body")).not.toContainText("0 gated rows");
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
  // Once the manifest has answered the page has its height and the named section is scrolled to; the assertion retries until it is.
  await expect(surface(page)).toHaveAttribute("data-state", "ok");
  await expect(section).toBeInViewport();
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
  // Visible with the fold closed: gated rows + drift, both welds, the fingerprint weld — none of them inside the fold.
  await expect(proof.getByText("87/87 exact · drift 0")).toBeVisible();
  await expect(proof.getByTestId("verification-weld-debt_manager")).toBeVisible();
  await expect(proof.getByTestId("verification-weld-aave_v3_etherfi")).toBeVisible();
  await expect(proof.getByText("identical to service fingerprint, by construction")).toBeVisible();
  const fold = proof.getByTestId("verification-proof-forensics");
  await expect(fold.getByTestId("verification-weld-debt_manager")).toHaveCount(0);
  await expect(fold.getByText("identical to service fingerprint, by construction")).toHaveCount(0);
  // The counted summary: 6 receipt rows + 6 identity rows + 3 feeds rows.
  await expect(fold.locator("summary")).toHaveText("15 provenance row(s)");
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
  await expect(live.getByTestId("verification-live-takeaway")).toHaveText("serving batch #1 · watermarked, operational — never the proof");
  await expect(live.getByTestId("verification-key")).toBeVisible();
  const fold = live.getByTestId("verification-live-forensics");
  await expect(fold.locator("summary")).toHaveText("2 provenance row(s)");
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
  await expect(live.getByTestId("verification-live-forensics").locator("summary")).toHaveText("1 provenance row(s)");

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
  await expect(proofFold.locator("summary")).toHaveText("14 provenance row(s)");
  await expect(page.getByTestId("verification-subject-proof")).not.toContainText("db-host");

  // The service fingerprint flipped: the weld the contract calls identical-by-construction breaks, visibly.
  const flipped = structuredClone(EVIDENCE_MANIFEST);
  flipped.service.registry_fingerprint = "0".repeat(64);
  await mockAll(page, flipped);
  await page.reload();
  const mismatch = page.getByTestId("verification-subject-proof").getByText("MISMATCH against service fingerprint", { exact: false });
  await expect(mismatch.first()).toBeVisible();
  await expect(page.getByTestId("verification-proof-forensics").getByText("MISMATCH against service fingerprint")).toHaveCount(0);
});

test("probe records: the kit table with the card's columns and words; the count is the section's qualifier; the empty arm is a statement", async ({
  page,
}) => {
  await mockAll(page);
  await page.goto("/proof");
  const section = page.getByTestId("verification-probes-section");
  await expect(section).toContainText("1 committed probe record(s) · 1 manifest note(s)");
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
  await expect(section).toContainText("0 committed probe record(s)");
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
  await expect(headline(page)).toContainText("NO SERVABLE BATCH");
  await expect(page.getByTestId("verification-live-status")).toHaveText("NO SERVABLE BATCH");
  await expect(chip(page, "Live batch")).toContainText("none");
  await expect(chip(page, "Key")).toContainText("—");
  await expect(page.getByText(REAL_KEY)).toHaveCount(0);
});
