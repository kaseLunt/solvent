// W6 Proof Center e2e — against the production build, with the API mocked
// from openapi-example-derived fixtures (tests/fixtures/proof.ts).
//
// What this pins:
//   - the proof/live SPLIT renders as TWO visibly distinct subjects, and the
//     PROOF · EXACT badge appears ONLY inside the proof subject;
//   - the materialization key W1's stampline em-dashes toward is served HERE,
//     with a copy affordance that copies the COMPLETE key;
//   - a non-accepted receipt renders LOUDLY (rejected chip + named detail),
//     and the PROOF · EXACT badge appears NOWHERE on that page;
//   - a missing receipt and a missing batch are first-class states with their
//     served reasons — and a missing batch fabricates NO key;
//   - evidence unavailable (fetch fails) is its own honest state;
//   - the drawer opens on both subjects: PROVEN on the accepted proof,
//     OPERATIONAL (non-inheritance stated) on the live subject;
//   - the raw-JSON toggle shows the wire body.

import { expect, test, type Page } from "@playwright/test";
import {
  EVIDENCE_MANIFEST,
  EVIDENCE_NO_BATCH,
  EVIDENCE_NO_RECEIPT,
  EVIDENCE_PROOF_FAILED,
} from "../fixtures/proof";

// Clipboard assertions need explicit grants in Chromium.
test.use({ permissions: ["clipboard-read", "clipboard-write"] });

// Fulfilled responses still cross an origin (3611 → 8080), so CORS applies.
const CORS = { "access-control-allow-origin": "*" };

async function mockApi(page: Page, evidence: unknown) {
  await page.route("**/v1/stream*", (route) => route.abort());
  await page.route("**/v1/evidence*", (route) =>
    route.fulfill({ json: evidence as Record<string, unknown>, headers: CORS }),
  );
}

const REAL_KEY = EVIDENCE_MANIFEST.substrate?.materialization_key ?? "";
if (REAL_KEY.length === 0) throw new Error("fixture invariant: the example carries a key");

test("the split renders as two subjects; PROOF · EXACT lives ONLY on the proof card", async ({
  page,
}) => {
  await mockApi(page, EVIDENCE_MANIFEST);
  await page.goto("/proof");

  const proof = page.getByTestId("proof-subject");
  const live = page.getByTestId("live-subject");
  await expect(proof).toBeVisible();
  await expect(live).toBeVisible();

  // The pin is the receipt's own comparison sha, shortened.
  await expect(proof).toContainText("PROOF · EXACT @ 5f0b3e2a");
  await expect(proof.getByTestId("proof-status")).toContainText("ACCEPTED");

  // The live subject wears its own identity — never the proof's.
  await expect(live).toContainText("SERVING · WATERMARKED");
  await expect(live).not.toContainText("PROOF");
  await expect(live).not.toContainText("EXACT");

  // The non-inheritance statement binds the two.
  const split = page.getByTestId("subject-split");
  await expect(split).toBeVisible();
  await expect(split).toContainText("TWO SUBJECTS, NEVER ONE");
});

test("the materialization key renders with a copy affordance that copies the COMPLETE key", async ({
  page,
}) => {
  await mockApi(page, EVIDENCE_MANIFEST);
  await page.goto("/proof");

  const keyRow = page.getByTestId("materialization-key");
  await expect(keyRow).toContainText(REAL_KEY);

  await keyRow.getByRole("button", { name: "copy materialization key", exact: true }).click();
  await expect(keyRow.getByRole("button", { name: "copy materialization key", exact: true })).toHaveText("✓");
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied).toBe(REAL_KEY);
});

test("a failed receipt is LOUD: rejected chip, named drift, and no PROOF · EXACT anywhere", async ({
  page,
}) => {
  await mockApi(page, EVIDENCE_PROOF_FAILED);
  await page.goto("/proof");

  await expect(page.getByTestId("proof-status")).toContainText("RECEIPT REJECTED");
  await expect(page.getByTestId("proof-subject")).toContainText('receipt verdict "fail"');
  // The drift is real in the weld data, and it renders.
  await expect(page.getByTestId("weld-debt_manager")).toContainText("26/29 exact");
  // The proof badge appears NOWHERE on this page.
  await expect(page.getByText("PROOF · EXACT @")).toHaveCount(0);
  // The live subject still serves — the split holds in this direction too.
  await expect(page.getByTestId("live-status")).toContainText("SERVING");
});

test("a missing receipt is a first-class state with its served reason", async ({ page }) => {
  await mockApi(page, EVIDENCE_NO_RECEIPT);
  await page.goto("/proof");

  await expect(page.getByTestId("proof-status")).toContainText("NO COMMITTED RECEIPT");
  await expect(page.getByTestId("proof-subject")).toContainText(
    "no committed receipt artifact is present in this deployment",
  );
  await expect(page.getByText("PROOF · EXACT @")).toHaveCount(0);
  await expect(page.getByTestId("live-status")).toContainText("SERVING");
});

test("a missing batch renders loudly and fabricates NO materialization key", async ({ page }) => {
  await mockApi(page, EVIDENCE_NO_BATCH);
  await page.goto("/proof");

  await expect(page.getByTestId("live-status")).toContainText("NO SERVABLE BATCH");
  await expect(page.getByTestId("live-subject")).toContainText(
    "no complete risk batch is available",
  );
  await expect(page.getByTestId("materialization-key")).toContainText("never fabricated");
  // The example's real key must appear NOWHERE — absence is absence.
  await expect(page.getByText(REAL_KEY)).toHaveCount(0);
  // The proof subject is untouched by the live outage — the split, other way.
  await expect(page.getByTestId("proof-subject")).toContainText("PROOF · EXACT @ 5f0b3e2a");
});

test("evidence unavailable: the fetch failing is its own honest state", async ({ page }) => {
  await page.route("**/v1/stream*", (route) => route.abort());
  await page.route("**/v1/evidence*", (route) => route.abort());
  await page.goto("/proof");

  const alert = page.getByTestId("proof-unavailable");
  await expect(alert).toBeVisible();
  await expect(alert).toContainText("EVIDENCE UNAVAILABLE");
  await expect(page.getByTestId("proof-subject")).toHaveCount(0);
  await expect(page.getByTestId("live-subject")).toHaveCount(0);
});

test("the drawer: PROVEN on the accepted proof subject, OPERATIONAL non-inheritance on the live", async ({
  page,
}) => {
  await mockApi(page, EVIDENCE_MANIFEST);
  await page.goto("/proof");

  await page.getByRole("button", { name: "explain proof subject" }).click();
  const drawer = page.getByTestId("evidence-drawer");
  await expect(drawer).toContainText("PROVEN");
  await expect(drawer).toContainText(EVIDENCE_MANIFEST.reconcile?.comparison_sha256 ?? "∅");
  await expect(drawer).toContainText("gated_exact == gated_rows");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);

  await page.getByRole("button", { name: "explain live subject" }).click();
  await expect(drawer).toContainText("OPERATIONAL");
  await expect(drawer).toContainText("does NOT inherit");
});

test("the raw-JSON toggle shows the wire body", async ({ page }) => {
  await mockApi(page, EVIDENCE_MANIFEST);
  await page.goto("/proof");

  await expect(page.getByTestId("raw-json")).toHaveCount(0);
  await page.getByTestId("raw-json-toggle").click();
  const raw = page.getByTestId("raw-json");
  await expect(raw).toBeVisible();
  await expect(raw).toContainText('"materialization_key"');
  await expect(raw).toContainText(REAL_KEY);
});
