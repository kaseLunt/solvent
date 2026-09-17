// web/tests/e2e/api.spec.ts
// The API page-test contract (spec 2026-09-15 §7; plan 2026-09-16 R8). The page
// is a static render of the committed contract, so no route is mocked: the
// stream is aborted so the shell's pill states its own truth, and nothing else
// is touched. Every count here is the generated extract's
// (lib/proof-contract.gen.ts), which tests/unit/proof-contract-fidelity.spec.ts
// welds to api/openapi.yaml; every sentence is lib/api-view.ts's.
//
// What this pins: the verdict header and its four chips; the three tiles;
// every operation rendered, in the TOC and as a card, none dropped; curl and
// sample fidelity against the page's own base URL; the copy affordance copies
// the verbatim command; params carry their required flags and the SSE route
// invents no sample; the error envelope is one table with every response and
// its byte-faithful body beneath; the quickstart is the real client API; the
// page links to Verification; the response codes sit above the sample fold;
// the doctrine lives in the drawer, verbatim; answer before evidence.
import { expect, test, type Page } from "@playwright/test";
import { deriveApiView } from "../../lib/api-view";
import { CONTRACT_META, ERROR_RESPONSES, OPERATIONS } from "../../lib/proof-contract.gen";
import { EVIDENCE_MANIFEST } from "../fixtures/proof";

test.use({ permissions: ["clipboard-read", "clipboard-write"] });

async function open(page: Page): Promise<void> {
  await page.route("**/v1/stream*", (route) => route.abort());
  await page.goto("/developers");
}

/** The API origin the page states its samples target — read from the page, never assumed. */
async function statedBaseUrl(page: Page): Promise<string> {
  const value = (await page.getByTestId("api-base-url-value").textContent()) ?? "";
  expect(value.startsWith("http")).toBe(true);
  return value;
}

const chip = (page: Page, label: string) => page.getByTestId("api-verdict").locator(`[data-chip="${label}"]`);

test("the verdict header: the contract named in the kicker, the operation count as the headline and the H1, the dek's one clause, four chips, tone ok", async ({ page }) => {
  await open(page);
  const baseUrl = await statedBaseUrl(page);
  const view = deriveApiView(baseUrl);
  await expect(page.getByTestId("api-surface")).toBeVisible();
  await expect(page.getByTestId("api-verdict")).toHaveAttribute("data-variant", "ok");
  await expect(page.getByTestId("api-verdict")).toContainText(`API · ${CONTRACT_META.title} v${CONTRACT_META.version}`);
  await expect(page.getByTestId("api-verdict-headline")).toHaveText(`${String(OPERATIONS.length)} read-only operations, every money value a decimal string.`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(view.headline.emphasis);
  await expect(page.getByTestId("api-verdict-dek")).toHaveText("If a handler disagrees with this page, that is a failure, not documentation lag.");
  await expect(chip(page, "Contract")).toContainText(`${CONTRACT_META.title} · v${CONTRACT_META.version}`);
  await expect(chip(page, "Operations")).toContainText(String(OPERATIONS.length));
  await expect(chip(page, "Base URL")).toContainText(baseUrl);
  await expect(chip(page, "Source")).toContainText(CONTRACT_META.sourcePath);
});

test("three tiles: operations, error responses, contract version — the extract's own figures", async ({ page }) => {
  await open(page);
  await expect(page.getByTestId("api-kpi-operations")).toContainText(String(OPERATIONS.length));
  await expect(page.getByTestId("api-kpi-errors")).toContainText(String(ERROR_RESPONSES.length));
  await expect(page.getByTestId("api-kpi-version")).toContainText(CONTRACT_META.version);
});

test("every contract operation renders — in the TOC and as a card; none added, none dropped", async ({ page }) => {
  await open(page);
  for (const op of OPERATIONS) {
    await expect(page.getByTestId(`api-endpoint-${op.operationId}`)).toBeVisible();
    await expect(page.getByTestId("api-toc").locator(`a[href="#${op.operationId}"]`)).toHaveText(`${op.method} ${op.path}`);
  }
  await expect(page.locator('[data-testid^="api-endpoint-"]')).toHaveCount(OPERATIONS.length);
  await expect(page.getByTestId("api-toc").locator("a")).toHaveCount(OPERATIONS.length);
});

test("curl-sample fidelity: the evidence curl and the quickstart target the stated base URL; the 200 sample equals the fixture", async ({ page }) => {
  await open(page);
  const baseUrl = await statedBaseUrl(page);

  const curl = (await page.getByTestId("api-curl-getEvidence").textContent()) ?? "";
  expect(curl).toBe(`curl -s "${baseUrl}/v1/evidence"`);
  await expect(page.getByTestId("api-quickstart")).toContainText(`new SolventClient({ baseUrl: "${baseUrl}" })`);

  // The rendered 200 sample is byte-faithful to the openapi-derived fixture.
  const sampleText = (await page.getByTestId("api-sample-getEvidence").textContent()) ?? "";
  expect(JSON.parse(sampleText)).toEqual(EVIDENCE_MANIFEST);
});

test("the curl copy affordance copies the verbatim command", async ({ page }) => {
  await open(page);
  const curl = (await page.getByTestId("api-curl-getEvidence").textContent()) ?? "";
  await page.getByRole("button", { name: "copy curl for GET /v1/evidence" }).click();
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied).toBe(curl);
});

test("params render with required flags; the SSE route invents no JSON sample", async ({ page }) => {
  await open(page);
  const positions = page.getByTestId("api-endpoint-getPositions");
  await expect(positions).toContainText("engine");
  await expect(positions).toContainText("required");
  await expect(positions).toContainText("never blended");

  const stream = page.getByTestId("api-endpoint-getStream");
  await expect(stream).toContainText("text/event-stream · no JSON sample");
  await expect(stream.locator('[data-testid="api-sample-getStream"]')).toHaveCount(0);
});

test("the error envelope is one table: every contract response a row with its status, and each body byte-faithful beneath", async ({ page }) => {
  await open(page);
  await expect(page.getByTestId("api-errors")).toBeVisible();
  for (const error of ERROR_RESPONSES) {
    const row = page.getByTestId(`api-error-${error.name}`);
    await expect(row).toBeVisible();
    await expect(row).toContainText(String(error.status));
    await expect(row).toContainText(error.name);
  }
  await expect(page.getByTestId("api-errors").locator("tbody tr")).toHaveCount(ERROR_RESPONSES.length);

  const superseded = page.getByTestId("api-error-BatchSuperseded");
  await expect(superseded).toContainText("409");
  const sample = page.getByTestId("api-error-sample-BatchSuperseded");
  await sample.locator("summary").click();
  const body = (await sample.locator("pre").textContent()) ?? "";
  const expected = ERROR_RESPONSES.find((error) => error.name === "BatchSuperseded")?.body;
  expect(JSON.parse(body)).toEqual(expected);
});

test("the TypeScript quickstart is present and real — the actual client API, no gloss", async ({ page }) => {
  await open(page);
  const quickstart = page.getByTestId("api-quickstart");
  await expect(quickstart).toContainText("new SolventClient({ baseUrl:");
  await expect(quickstart).toContainText('case "unknowable"');
});

test("the page links to Verification, where this deployment's evidence manifest renders", async ({ page }) => {
  await open(page);
  await page.route("**/v1/**", (route) => route.abort());
  // Scoped to the surface: the shell's nav carries a Verification link of its own.
  await page.getByTestId("api-surface").getByRole("link", { name: /Verification/ }).click();
  await expect(page).toHaveURL(/\/proof$/);
});

test("the response-code chips sit ABOVE the sample fold — the error vocabulary never trails the happy path", async ({ page }) => {
  await open(page);
  const card = page.getByTestId("api-endpoint-getBook");
  const chips = card.getByTestId("api-responses-getBook");
  await expect(chips).toBeVisible();
  // The non-2xx vocabulary is rendered in the chips, visible with the sample fold CLOSED.
  await expect(chips).toContainText("503");

  const chipsBox = await chips.boundingBox();
  const sampleBox = await card.locator("summary").first().boundingBox();
  if (chipsBox === null || sampleBox === null) throw new Error("expected laid-out chips and sample summary");
  expect(chipsBox.y + chipsBox.height).toBeLessThanOrEqual(sampleBox.y + 1);
});

test("the doctrine lives in the drawer, verbatim: the intro, the base-URL note, the provenance; Escape closes it and the button regains focus", async ({ page }) => {
  await open(page);
  const baseUrl = await statedBaseUrl(page);
  const view = deriveApiView(baseUrl);
  // The intro's opening is doctrine, not page copy; only its closing clause (the dek) stays in the header.
  await expect(page.locator("main")).not.toContainText("rendered from its own examples");
  await expect(page.getByTestId("api-drawer-body")).toHaveCount(0);

  await page.getByTestId("api-drawer").click();
  const body = page.getByTestId("api-drawer-body");
  await expect(body.locator("p")).toHaveText([...view.doctrine]);
  await expect(body).toContainText(
    "The committed API contract, rendered from its own examples: read-only JSON, no auth, every money value a decimal string. If a handler disagrees with this page, that is a failure, not documentation lag.",
  );
  await expect(body).toContainText(`Base URL ${baseUrl}: the origin this deployment is built against (NEXT_PUBLIC_SOLVENT_API_URL).`);
  await expect(body).toContainText("tests/unit/proof-contract-fidelity.spec.ts re-extracts from api/openapi.yaml on every run");

  await page.keyboard.press("Escape");
  await expect(page.getByTestId("api-drawer-body")).toHaveCount(0);
  await expect(page.getByTestId("api-drawer")).toBeFocused();
});

test("answer before evidence: header above tiles above the base URL above the TOC above the quickstart above the endpoints above the errors", async ({ page }) => {
  await open(page);
  const y = async (id: string) => (await page.getByTestId(id).boundingBox())?.y ?? Number.NaN;
  expect(await y("api-verdict")).toBeLessThan(await y("api-kpi-operations"));
  expect(await y("api-kpi-operations")).toBeLessThan(await y("api-base-url"));
  expect(await y("api-base-url")).toBeLessThan(await y("api-toc"));
  expect(await y("api-toc")).toBeLessThan(await y("api-quickstart"));
  expect(await y("api-quickstart")).toBeLessThan(await y("api-endpoint-getBook"));
  expect(await y("api-endpoint-getBook")).toBeLessThan(await y("api-errors"));
});
