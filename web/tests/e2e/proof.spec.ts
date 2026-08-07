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

// ---------------------------------------------------------------------------
// W-3L (inventory 439-479) — the three-layer welds. Placement laws follow
// the r73 pattern: hazard visible + NOT a descendant of the fold + the
// counted summary recounting; visibility asserted, never containment (the
// r75 lesson: toContainText passes on text hidden inside a closed fold).
// ---------------------------------------------------------------------------

test("W-3L: the head takeaway states both subjects, and EACH failing arm surfaces in it", async ({
  page,
}) => {
  await mockApi(page, EVIDENCE_MANIFEST);
  await page.goto("/proof");
  const takeaway = page.getByTestId("proof-head-takeaway");
  await expect(takeaway).toHaveText(
    "receipt ACCEPTED at pin 5f0b3e2a; serving batch #1 under its watermark vector.",
  );

  // Routes match most-recently-registered first: re-mock and reload.
  await mockApi(page, EVIDENCE_PROOF_FAILED);
  await page.reload();
  await expect(takeaway).toContainText("RECEIPT REJECTED — the proof badge is refused");

  await mockApi(page, EVIDENCE_NO_RECEIPT);
  await page.reload();
  await expect(takeaway).toContainText("NO COMMITTED RECEIPT — nothing is proven");

  await mockApi(page, EVIDENCE_NO_BATCH);
  await page.reload();
  await expect(takeaway).toContainText("NO SERVABLE BATCH");
  await expect(takeaway).toContainText("receipt ACCEPTED at pin 5f0b3e2a");
});

test("W-3L: the proof card's answer layer stays visible; provenance folds counted and CLOSED", async ({
  page,
}) => {
  await mockApi(page, EVIDENCE_MANIFEST);
  await page.goto("/proof");
  const proof = page.getByTestId("proof-subject");

  // Visible with the fold closed: gated rows + drift, both welds, the
  // fingerprint weld — and none of them descends from the fold.
  await expect(proof.getByText("87/87 exact · drift 0")).toBeVisible();
  await expect(proof.getByTestId("weld-debt_manager")).toBeVisible();
  await expect(proof.getByTestId("weld-aave_v3_etherfi")).toBeVisible();
  await expect(
    proof.getByText("identical to service fingerprint, by construction"),
  ).toBeVisible();
  const fold = proof.getByTestId("proof-subject-forensics");
  await expect(fold.getByTestId("weld-debt_manager")).toHaveCount(0);
  await expect(
    fold.getByText("identical to service fingerprint, by construction"),
  ).toHaveCount(0);

  // The counted summary: 6 receipt rows + 6 identity rows + 3 feeds rows.
  await expect(fold.locator("summary")).toHaveText("15 provenance row(s)");

  // Forensic facts render only once the fold opens.
  await expect(proof.getByText("pro-rata-over-counted-collateral")).toBeHidden();
  await fold.locator("summary").click();
  await expect(proof.getByText("pro-rata-over-counted-collateral")).toBeVisible();
  await expect(fold.getByText("recon/feeds.json")).toBeVisible();
});

test("W-3L: the live card leads with its takeaway; the key stays visible; digest + note fold counted", async ({
  page,
}) => {
  await mockApi(page, EVIDENCE_MANIFEST);
  await page.goto("/proof");
  const live = page.getByTestId("live-subject");
  const digest = EVIDENCE_MANIFEST.substrate?.substrate_digest ?? "";
  if (digest.length === 0) throw new Error("fixture invariant: the example carries a digest");

  await expect(live.getByTestId("live-takeaway")).toHaveText(
    "serving batch #1 · watermarked, operational — never the proof",
  );
  await expect(live.getByTestId("materialization-key")).toBeVisible();

  const fold = live.getByTestId("live-subject-forensics");
  await expect(fold.locator("summary")).toHaveText("2 provenance row(s)");
  await expect(live.getByText(digest)).toBeHidden();
  await fold.locator("summary").click();
  await expect(live.getByText(digest)).toBeVisible();
});

test("W-3L hazard: a predates-custody digest gap renders OUTSIDE the fold, and the count follows", async ({
  page,
}) => {
  // The committed example with ONE documented delta: the substrate digest
  // emptied — the predates-migration honest-gap arm, a hazard by law.
  const doctored = structuredClone(EVIDENCE_MANIFEST);
  if (doctored.substrate === null) throw new Error("fixture invariant: substrate expected");
  doctored.substrate.substrate_digest = "";
  await mockApi(page, doctored);
  await page.goto("/proof");

  const live = page.getByTestId("live-subject");
  const gap = live.getByTestId("live-digest-gap");
  await expect(gap).toBeVisible();
  await expect(gap).toContainText("predates substrate-digest custody");
  const fold = live.getByTestId("live-subject-forensics");
  await expect(fold.getByTestId("live-digest-gap")).toHaveCount(0);
  await expect(fold.locator("summary")).toHaveText("1 provenance row(s)");
});

test("W-3L hazard: a pub() refusal hoists OUT of the fold — a withheld value is a refusal", async ({
  page,
}) => {
  // The committed example with ONE documented delta: the artifact path
  // replaced by a DSN-shaped string, so publishable() refuses it at render.
  const doctored = structuredClone(EVIDENCE_MANIFEST);
  if (doctored.reconcile === null) throw new Error("fixture invariant: reconcile expected");
  doctored.reconcile.artifact_path = "postgres://user@db-host:5432/solvent";
  await mockApi(page, doctored);
  await page.goto("/proof");

  const refused = page.getByTestId("proof-artifact-refused");
  await expect(refused).toBeVisible();
  await expect(refused).toContainText("WITHHELD");
  const fold = page.getByTestId("proof-subject-forensics");
  await expect(fold.getByTestId("proof-artifact-refused")).toHaveCount(0);
  await expect(fold.locator("summary")).toHaveText("14 provenance row(s)");
  // The DSN itself appears NOWHERE rendered on the card.
  await expect(page.getByTestId("proof-subject")).not.toContainText("db-host");
});

test("W-3L hazard: a fingerprint MISMATCH stays visible with the fold closed", async ({
  page,
}) => {
  // ONE documented delta: the service fingerprint flipped, so the weld the
  // contract calls identical-by-construction breaks.
  const doctored = structuredClone(EVIDENCE_MANIFEST);
  doctored.service.registry_fingerprint = "0".repeat(64);
  await mockApi(page, doctored);
  await page.goto("/proof");

  const mismatch = page.getByTestId("proof-subject").getByText("MISMATCH against service fingerprint", { exact: false });
  await expect(mismatch.first()).toBeVisible();
  await expect(
    page.getByTestId("proof-subject-forensics").getByText("MISMATCH against service fingerprint"),
  ).toHaveCount(0);
});

test("W-3L: probe records — the count is the takeaway; paths fold counted; the empty arm stays visible", async ({
  page,
}) => {
  await mockApi(page, EVIDENCE_MANIFEST);
  await page.goto("/proof");

  await expect(page.getByTestId("probe-records-takeaway")).toHaveText(
    "1 committed probe record(s) · 1 manifest note(s)",
  );
  const fold = page.getByTestId("probe-records-forensics");
  await expect(fold.locator("summary")).toHaveText("1 record path(s) + 1 note(s)");
  await expect(page.getByText("recon/p3-probes.md")).toBeHidden();
  await fold.locator("summary").click();
  await expect(page.getByText("recon/p3-probes.md")).toBeVisible();

  // The empty arm: a statement, never a hidden zero.
  const emptied = structuredClone(EVIDENCE_MANIFEST);
  emptied.probe_records = [];
  await mockApi(page, emptied);
  await page.reload();
  await expect(page.getByTestId("probe-records-takeaway")).toContainText(
    "0 committed probe record(s)",
  );
  await expect(page.getByTestId("probe-records-empty")).toBeVisible();
  await expect(page.getByTestId("probe-records-empty")).toContainText(
    "none named by this deployment's manifest",
  );
});

test("r81: the stampline derives from the DEMOTED live status — never raw substrate", async ({
  page,
}) => {
  // The committed example with ONE documented delta: the wire claims
  // no_batch while substrate stays non-null — the contradiction state
  // liveSubjectStatus deliberately demotes to no-batch. Every batch answer
  // on the page must agree: NO SERVABLE BATCH, and nothing fabricated —
  // a stampline branching on raw substrate kept a batch pin inline here,
  // two mutually exclusive answers on one page.
  const doctored = structuredClone(EVIDENCE_MANIFEST);
  doctored.live_subject = {
    status: "no_batch",
    reason: "wire claims no_batch beside a non-null substrate",
  };
  await mockApi(page, doctored);
  await page.goto("/proof");

  await expect(page.getByTestId("live-status")).toContainText("NO SERVABLE BATCH");
  await expect(page.getByTestId("proof-head-takeaway")).toContainText("NO SERVABLE BATCH");

  const split = page.getByTestId("stampline-split");
  await expect(
    split.getByText("(no servable batch, and nothing fabricated)"),
  ).toBeVisible();
  await expect(split.getByText("#1", { exact: true })).toHaveCount(0);
  // The key appears NOWHERE rendered — absence is absence.
  await expect(page.getByText(REAL_KEY)).toHaveCount(0);
});

test("W-3L: the stampline splits — identity inline, ok pins counted, crit and no-batch pins never fold", async ({
  page,
}) => {
  await mockApi(page, EVIDENCE_MANIFEST);
  await page.goto("/proof");
  const split = page.getByTestId("stampline-split");
  await expect(split).toBeVisible();
  // The batch pin is identity and stays inline; the ok receipt folds.
  await expect(split.getByText("#1", { exact: true })).toBeVisible();
  await expect(split.getByText("pass · 87/87")).toBeHidden();
  await expect(split.getByTestId("stampline-evidence")).toBeVisible();

  // A crit receipt stays inline by tone.
  await mockApi(page, EVIDENCE_PROOF_FAILED);
  await page.reload();
  await expect(
    page.getByTestId("stampline-split").getByText("fail · 84/87"),
  ).toBeVisible();

  // Under a no-batch manifest the em-dash batch/key pins never fold.
  await mockApi(page, EVIDENCE_NO_BATCH);
  await page.reload();
  await expect(
    page.getByTestId("stampline-split").getByText("(no servable batch, and nothing fabricated)"),
  ).toBeVisible();
});
