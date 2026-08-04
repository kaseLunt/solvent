// W6 Developers e2e — the static contract render, against the production
// build. No API mocking is needed for the docs themselves (the page fetches
// nothing); the stream is aborted so the header ribbon states its truth.
//
// What this pins:
//   - every contract operation renders (none added, none dropped — the count
//     comes from the same generated extract the page renders);
//   - CURL-SAMPLE FIDELITY: the evidence curl targets the page's own stated
//     base URL + the real contract path, and the rendered 200 sample is
//     byte-faithful JSON equal to the openapi-example-derived fixture (which
//     tests/unit/proof-contract-fidelity.spec.ts welds to the yaml itself);
//   - the copy affordance copies the VERBATIM curl;
//   - params render with their required flags; the SSE route states that no
//     JSON sample exists rather than inventing one;
//   - error-envelope samples are byte-faithful;
//   - the page cross-links to the Proof Center.

import { expect, test, type Page } from "@playwright/test";
import { ERROR_RESPONSES, OPERATIONS } from "../../lib/proof-contract.gen";
import { EVIDENCE_MANIFEST } from "../fixtures/proof";

test.use({ permissions: ["clipboard-read", "clipboard-write"] });

async function quiet(page: Page) {
  await page.route("**/v1/stream*", (route) => route.abort());
}

test("every contract operation renders — the full explorer, none dropped", async ({ page }) => {
  await quiet(page);
  await page.goto("/developers");

  for (const op of OPERATIONS) {
    await expect(page.getByTestId(`endpoint-${op.operationId}`)).toBeVisible();
  }
  await expect(page.locator('[data-testid^="endpoint-"]')).toHaveCount(OPERATIONS.length);
});

test("curl-sample fidelity: the evidence curl targets the stated base URL and the sample equals the fixture", async ({
  page,
}) => {
  await quiet(page);
  await page.goto("/developers");

  // The page states the API origin its samples target.
  const baseUrl = (await page.getByTestId("base-url").locator("span").nth(1).textContent()) ?? "";
  expect(baseUrl.startsWith("http")).toBe(true);

  const curl = (await page.getByTestId("curl-getEvidence").textContent()) ?? "";
  expect(curl).toBe(`curl -s "${baseUrl}/v1/evidence"`);

  // The rendered 200 sample is byte-faithful to the openapi-derived fixture.
  const sampleText = (await page.getByTestId("sample-getEvidence").textContent()) ?? "";
  expect(JSON.parse(sampleText)).toEqual(EVIDENCE_MANIFEST);
});

test("the curl copy affordance copies the verbatim command", async ({ page }) => {
  await quiet(page);
  await page.goto("/developers");

  const curl = (await page.getByTestId("curl-getEvidence").textContent()) ?? "";
  await page.getByRole("button", { name: "copy curl for GET /v1/evidence" }).click();
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied).toBe(curl);
});

test("params render with required flags; the SSE route invents no JSON sample", async ({
  page,
}) => {
  await quiet(page);
  await page.goto("/developers");

  const positions = page.getByTestId("endpoint-getPositions");
  await expect(positions).toContainText("engine");
  await expect(positions).toContainText("required");
  await expect(positions).toContainText("never blended");

  const stream = page.getByTestId("endpoint-getStream");
  await expect(stream).toContainText("text/event-stream · no JSON sample");
  await expect(stream.locator('[data-testid="sample-getStream"]')).toHaveCount(0);
});

test("error-envelope samples render byte-faithful to the extract", async ({ page }) => {
  await quiet(page);
  await page.goto("/developers");

  for (const error of ERROR_RESPONSES) {
    await expect(page.getByTestId(`error-${error.name}`)).toBeVisible();
  }
  const superseded = page.getByTestId("error-BatchSuperseded");
  await expect(superseded).toContainText("409");
  const body = (await superseded.locator("pre").textContent()) ?? "";
  const expected = ERROR_RESPONSES.find((error) => error.name === "BatchSuperseded")?.body;
  expect(JSON.parse(body)).toEqual(expected);
});

test("the TypeScript quickstart is present and real — the actual client API, no gloss", async ({
  page,
}) => {
  await quiet(page);
  await page.goto("/developers");

  const quickstart = page.getByTestId("ts-quickstart");
  await expect(quickstart).toContainText('new SolventClient({ baseUrl:');
  await expect(quickstart).toContainText('case "unknowable"');
});

test("the page cross-links to the Proof Center, where the manifest renders", async ({ page }) => {
  await quiet(page);
  await page.route("**/v1/evidence*", (route) =>
    route.fulfill({
      json: EVIDENCE_MANIFEST as unknown as Record<string, unknown>,
      headers: { "access-control-allow-origin": "*" },
    }),
  );
  await page.goto("/developers");

  await page.getByRole("link", { name: "Proof Center" }).click();
  await expect(page).toHaveURL(/\/proof$/);
  await expect(page.getByTestId("proof-subject")).toBeVisible();
});
