// web/tests/e2e/api.spec.ts
// The API page-test contract (spec 2026-09-15 §7). The page
// is a static render of the committed contract, so no route is mocked: the
// stream is aborted so the shell's pill states its own truth, and nothing else
// is touched. Every count here is the generated extract's
// (lib/proof-contract.gen.ts), which tests/unit/proof-contract-fidelity.spec.ts
// welds to api/openapi.yaml; every sentence is lib/api-view.ts's.
//
// What this pins: the verdict header in ink and its three identity chips; the
// three tiles, each with a sub counted from the extract; the base URL stated
// once; every operation rendered, in the endpoint index and as a card, none
// dropped, the index a column of plain anchors walked by Tab in order; curl
// and sample fidelity against the page's own base URL; the copy affordance
// copies the verbatim command; params carry their required flags and the SSE
// route invents no sample; the contract's prose set as paragraphs at the
// reading measure, its words unchanged and its bold and code markers rendered
// as formatting; the error envelope is one table with
// every response and its byte-faithful body beneath; the quickstart is the
// real client API; the page links to Verification; the response codes sit
// above the sample fold; the doctrine lives in the drawer, verbatim; answer
// before evidence.
import { expect, test, type Page } from "@playwright/test";
import { contractParagraphs, deriveApiView, inlineParts, type InlinePart } from "../../lib/api-view";
import { CONTRACT_META, ERROR_RESPONSES, OPERATIONS } from "../../lib/proof-contract.gen";
import { EVIDENCE_MANIFEST } from "../fixtures/proof";

test.use({ permissions: ["clipboard-read", "clipboard-write"] });

async function open(page: Page): Promise<void> {
  await page.route("**/v1/stream*", (route) => route.abort());
  await page.goto("/developers");
}

const chip = (page: Page, label: string) => page.getByTestId("api-verdict").locator(`[data-chip="${label}"]`);

/** The API origin the page states its samples target — read from the one place the page states it, never assumed. */
async function statedBaseUrl(page: Page): Promise<string> {
  const value = (await chip(page, "Base URL").locator("b").textContent()) ?? "";
  expect(value.startsWith("http")).toBe(true);
  return value;
}

test("the verdict header: the contract's version in the kicker, the endpoint count as the headline and the H1 in ink, the fact dek, three identity chips", async ({ page }) => {
  await open(page);
  const baseUrl = await statedBaseUrl(page);
  const view = deriveApiView(baseUrl);
  await expect(page.getByTestId("api-surface")).toBeVisible();
  // A statement of record wears ink: green is a health verdict, and this page has none.
  await expect(page.getByTestId("api-verdict")).toHaveAttribute("data-variant", "neutral");
  await expect(page.getByTestId("api-verdict")).toContainText(`API · contract v${CONTRACT_META.version}`);
  await expect(page.getByTestId("api-verdict-headline")).toHaveText(`${String(OPERATIONS.length)} read-only endpoints, every money value an exact decimal string.`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(`${view.headline.emphasis} ${view.headline.rest}`);
  await expect(page.getByTestId("api-verdict-dek")).toHaveText(view.headline.dek);
  await expect(page.getByTestId("api-verdict-dek")).toHaveText(
    "No key or sign-in; requests are rate-limited per client. Every sample below is the contract's own example (api/openapi.yaml, v1.8.0) or a committed client fixture, cited beside each. A CI test re-reads both and fails if this page's extract has drifted from either; the fixtures are checked against the contract by the client package's own tests.",
  );
  await expect(page.getByTestId("api-verdict-identity").locator("[data-chip]")).toHaveCount(3);
  await expect(chip(page, "Contract")).toContainText(`${CONTRACT_META.title} · v${CONTRACT_META.version}`);
  await expect(chip(page, "Base URL")).toContainText(baseUrl);
  await expect(chip(page, "Source")).toContainText(CONTRACT_META.sourcePath);
  // A count is a measure: its tile owns it, and no chip repeats it.
  await expect(chip(page, "Operations")).toHaveCount(0);
  await expect(chip(page, "Endpoints")).toHaveCount(0);
});

test("the base URL is stated once: the header's mono chip carries it in full, the quickstart carries it copyably, and no second strip repeats it", async ({ page }) => {
  await open(page);
  const baseUrl = await statedBaseUrl(page);
  await expect(page.getByTestId("api-base-url")).toHaveCount(0);
  await expect(page.locator("[data-chip='Base URL']")).toHaveCount(1);
  const family = await chip(page, "Base URL").locator("b").evaluate((el) => getComputedStyle(el).fontFamily);
  expect(family.toLowerCase()).toContain("mono");
  await expect(page.getByTestId("api-quickstart")).toContainText(`baseUrl: "${baseUrl}"`);
});

test("three tiles: endpoints, error responses, contract version — the extract's own figures, each with a sub counted from the extract", async ({ page }) => {
  await open(page);
  const view = deriveApiView(await statedBaseUrl(page));
  const endpoints = page.getByTestId("api-kpi-operations");
  await expect(endpoints).toContainText("Endpoints");
  await expect(endpoints).toContainText(String(OPERATIONS.length));
  await expect(endpoints).toContainText(view.tiles.operations.sub);
  await expect(endpoints).toContainText("15 GET · 2 POST");
  const errors = page.getByTestId("api-kpi-errors");
  await expect(errors).toContainText(String(ERROR_RESPONSES.length));
  await expect(errors).toContainText(view.tiles.errors.sub);
  await expect(errors).toContainText("400 · 404 · 409 · 429 · 500 · 503");
  await expect(page.getByTestId("api-kpi-version")).toContainText(CONTRACT_META.version);
  await expect(page.getByTestId("api-kpi-version")).toContainText(CONTRACT_META.sourcePath);
});

test("every contract operation renders — in the endpoint index and as a card; none added, none dropped", async ({ page }) => {
  await open(page);
  for (const op of OPERATIONS) {
    await expect(page.getByTestId(`api-endpoint-${op.operationId}`)).toBeVisible();
    await expect(page.getByTestId("api-toc").locator(`a[href="#${op.operationId}"]`)).toHaveText(`${op.method} ${op.path}`);
  }
  await expect(page.locator('[data-testid^="api-endpoint-"]')).toHaveCount(OPERATIONS.length);
  await expect(page.getByTestId("api-toc").locator("a")).toHaveCount(OPERATIONS.length);
});

test("the endpoint index is aligned rows of plain anchors: the method in its own coloured column, no button form, and Tab walks every row in the contract's order", async ({ page }) => {
  await open(page);
  const anchors = page.getByTestId("api-toc").locator("a");
  // An anchor wears no button form: one tab away that form is a pressable filter.
  for (const anchor of await anchors.all()) {
    expect(await anchor.getAttribute("class")).not.toMatch(/btn/i);
    expect(await anchor.evaluate((el) => getComputedStyle(el).borderTopWidth)).toBe("0px");
  }
  // The method sits in a column of its own: within one index column every path starts at one x.
  const first = anchors.nth(0);
  const second = anchors.nth(1);
  await expect(first.locator("span")).toHaveText(["GET", "/v1/book"]);
  const x = async (row: typeof first, n: number) => (await row.locator("span").nth(n).boundingBox())?.x ?? Number.NaN;
  expect(await x(first, 0)).toBe(await x(second, 0));
  expect(await x(first, 1)).toBe(await x(second, 1));
  // The method carries the card's verb colour: a POST is not a GET.
  const post = page.getByTestId("api-toc").locator('a[href="#runBookScenario"] span').first();
  await expect(post).toHaveText("POST");
  const colour = (el: Element) => getComputedStyle(el).color;
  expect(await post.evaluate(colour)).not.toBe(await first.locator("span").first().evaluate(colour));
  // Keyboard: every row is a stop, in the contract's order — DOM order is reading order, down each column.
  await first.focus();
  for (let i = 0; i < OPERATIONS.length; i += 1) {
    await expect(anchors.nth(i)).toBeFocused();
    await page.keyboard.press("Tab");
  }
  // And a row still lands on its card.
  await anchors.nth(0).click();
  await expect(page).toHaveURL(/#getBook$/);
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

test("the contract's prose is set as paragraphs at the reading measure: the yaml's hard wraps are gone, the words are not — its bold and code markers render as formatting", async ({ page }) => {
  await open(page);
  const op = OPERATIONS.find((o) => o.operationId === "getEvents");
  if (op === undefined) throw new Error("contract invariant: getEvents exists");
  // What a reader sees of each paragraph: the contract's words, in order, the markers rendered rather than printed.
  const plain = (parts: readonly InlinePart[]): string => parts.map((part) => (part.kind === "strong" ? plain(inlineParts(part.text)) : part.text)).join("");
  const expected = contractParagraphs(op.description).map((paragraph) => plain(inlineParts(paragraph)));
  expect(expected.length).toBeGreaterThan(1);
  const prose = page.getByTestId("api-description-getEvents");
  await expect(prose.locator("p")).toHaveText([...expected]);
  // Every backtick pair is a code element, and no marker survives as a character.
  const codes = contractParagraphs(op.description)
    .flatMap((paragraph) => inlineParts(paragraph))
    .filter((part) => part.kind === "code")
    .map((part) => part.text);
  expect(codes.length).toBeGreaterThan(0);
  await expect(prose.locator("code")).toHaveText(codes);
  await expect(prose).not.toContainText("`");
  // The two bold spans the contract carries: getPositions' superseded cursor, its error code inside it as code; getScenarios' envelope.
  const positions = page.getByTestId("api-description-getPositions");
  await expect(positions.locator("strong")).toHaveText("409 batch_superseded");
  await expect(positions.locator("strong code")).toHaveText("batch_superseded");
  await expect(positions).not.toContainText("**");
  await expect(page.getByTestId("api-description-getScenarios").locator("strong")).toHaveText("no batch envelope");
  // A hard wrap is no longer preserved, and the column is the prose measure, not the card's width.
  expect(await prose.locator("p").first().evaluate((el) => getComputedStyle(el).whiteSpace)).toBe("normal");
  expect((await prose.boundingBox())?.width ?? Number.NaN).toBeLessThanOrEqual(720);
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
  // The intro is doctrine, not page copy — its opening and its slogan alike; the header states the facts that make the slogan true.
  await expect(page.locator("main")).not.toContainText("rendered from its own examples");
  await expect(page.locator("main")).not.toContainText("documentation lag");
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

test("answer before evidence: header above tiles above the endpoint index above the quickstart above the endpoints above the errors", async ({ page }) => {
  await open(page);
  const y = async (id: string) => (await page.getByTestId(id).boundingBox())?.y ?? Number.NaN;
  expect(await y("api-verdict")).toBeLessThan(await y("api-kpi-operations"));
  expect(await y("api-kpi-operations")).toBeLessThan(await y("api-toc"));
  expect(await y("api-toc")).toBeLessThan(await y("api-quickstart"));
  expect(await y("api-quickstart")).toBeLessThan(await y("api-endpoint-getBook"));
  expect(await y("api-endpoint-getBook")).toBeLessThan(await y("api-errors"));
});
