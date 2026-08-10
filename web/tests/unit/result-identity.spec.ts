// p1b-5 (cross-page brief §5, result identity): every async result is bound to
// scope / address / batch / config-version / answered-engines / served-at, and
// the identity is VISIBLE — the line is composed from the settled response,
// never from the input box and never from a hardcoded vocabulary. Pure-function
// pins; p1b-fixes.spec.ts p1b-5 holds the render consequences, and the receipt
// pin here is the anchor law's unit half (a constant receipt never re-anchors).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { lookup, type StressResponse } from "@solvent/client";
import { receiptIdentity } from "../../lib/freshness";
import {
  identityLine,
  resultReceipt,
  stressResultIdentity,
  type ResultIdentity,
} from "../../lib/resultIdentity";

const STRESS_200 = JSON.parse(
  readFileSync(fileURLToPath(new URL("../fixtures/stress-aave.json", import.meta.url)), "utf8"),
) as StressResponse;

/** A fully-populated address identity, field values chosen to be distinct. */
const ADDRESS_ID: ResultIdentity = {
  scope: "address",
  address: "0xAAaA000000000000000000000000000000000001",
  batchId: 18251,
  configVersion: "v3",
  engines: ["aave_v3_etherfi", "debt_manager"],
  servedAt: "2026-08-01T19:23:59Z",
};

test("identityLine composes every field, in canon order, address verbatim", () => {
  // The exact composition — subject · batch · config · engines. A mutant that
  // drops ANY clause (the batch clause is p1b-5-M1) dies at this equality.
  expect(identityLine(ADDRESS_ID)).toBe(
    "results for 0xAAaA000000000000000000000000000000000001 · batch #18251 · config v3 · engines aave_v3_etherfi, debt_manager",
  );
});

test("book scope omits the address entirely", () => {
  const line = identityLine({ ...ADDRESS_ID, scope: "book", address: undefined });
  expect(line).toBe("results for the book · batch #18251 · config v3 · engines aave_v3_etherfi, debt_manager");
  expect(line).not.toContain("0x");
});

test("set scope names the committed set", () => {
  expect(identityLine({ ...ADDRESS_ID, scope: "set", address: undefined })).toContain(
    "results for the committed set · batch #18251",
  );
});

test("an empty answered-engines list is stated, never silent", () => {
  // The unknowable arm's identity: every relevant engine withheld, no results.
  // The clause still renders — silence in the engines slot would read as "all".
  expect(identityLine({ ...ADDRESS_ID, engines: [] })).toContain("engines none answered");
});

test("stressResultIdentity extracts the sextuple from the refined response", () => {
  // Through the REAL client path: lookup() seals `found` and refines the body —
  // exactly what LabClient holds in phase.result.response.
  const result = lookup(STRESS_200);
  expect(result.outcome).toBe("found");
  expect(stressResultIdentity(STRESS_200.address, result.response)).toEqual({
    scope: "address",
    address: "0xAAaA000000000000000000000000000000000001",
    batchId: 1,
    configVersion: "v1",
    // ANSWERED engines: the DISTINCT engines present in the RESULTS. The
    // fixture's scenario DEFINITIONS name debt_manager too — a definition names
    // what a scenario models, not who answered for THIS address — and only
    // aave answers here, so debt_manager must NOT leak in.
    engines: ["aave_v3_etherfi"],
    servedAt: "2026-07-29T10:00:00Z",
  });
});

test("answered engines are distinct, in first-answer wire order", () => {
  const identity = stressResultIdentity("0x1111111111111111111111111111111111111111", {
    served_at: "2026-07-29T11:00:00Z",
    batch: { id: 2 },
    scenario_config_version: "v1",
    scenarios: [
      { results: [{ engine: "debt_manager" }, { engine: "aave_v3_etherfi" }] },
      { results: [{ engine: "aave_v3_etherfi" }] },
    ],
  });
  expect(identity.engines).toEqual(["debt_manager", "aave_v3_etherfi"]);
});

test("resultReceipt composes the age receipt from served_at + batch id (p1b-5-M2 pin)", () => {
  const receipt = resultReceipt(ADDRESS_ID, 42);
  // The wire age passes through VERBATIM — the receipt never invents an age.
  expect(receipt.ageSeconds).toBe(42);
  // The receipt identity is freshness.ts's own composition (Wave R5's law):
  // served_at + batch id, so a fresher response ALWAYS re-anchors.
  expect(receipt.receiptId).toBe("2026-08-01T19:23:59Z#18251");
  expect(receipt.receiptId).toBe(receiptIdentity(ADDRESS_ID.servedAt, ADDRESS_ID.batchId));
  // Two different responses never share a receipt — a constant-receipt mutant
  // (the never-re-anchors defect) dies at this inequality.
  const other = resultReceipt({ ...ADDRESS_ID, servedAt: "2026-08-02T00:00:00Z", batchId: 18252 }, 42);
  expect(other.receiptId).not.toBe(receipt.receiptId);
});
