// The evidence-descriptor laws (lib/evidence.ts), pinned:
//   - comparators are ENGINE-EXACT and an unknown engine is a refusal, not a guess;
//   - every position descriptor is marked OPERATIONAL (LIVE · WATERMARKED) —
//     never "proven": reconcile welds belong to /v1/evidence;
//   - the materialization key is stated as NOT SERVED here, never invented;
//   - a stale price input surfaces with a non-default tone in the chain.

import { expect, test } from "@playwright/test";
import { refinePosition } from "@solvent/client";
import { comparatorFor, hfEvidence, totalEvidence } from "../../lib/evidence";
import { ADDRESS_FOUND } from "../fixtures/inspector";

const batch = ADDRESS_FOUND.batch;
const aaveWire = ADDRESS_FOUND.positions[0];
if (aaveWire === undefined) throw new Error("fixture invariant: aave position expected");
const aave = refinePosition(aaveWire);

test("comparators are engine-exact; an unknown engine refuses rather than guesses", () => {
  expect(comparatorFor("aave_v3_etherfi")).toContain("hf_wad < 1e18");
  expect(comparatorFor("aave_v3_etherfi")).toContain("equality is healthy");
  expect(comparatorFor("debt_manager")).toContain("debt > maxBorrowLT");
  expect(comparatorFor("some_future_engine")).toContain("refusing to guess");
});

test("a position descriptor is OPERATIONAL and never claims the proof marker", () => {
  const descriptor = hfEvidence(aave, batch, "1.08");
  expect(descriptor.marker).toBe("operational");
  expect(descriptor.markerNote).toContain("LIVE · WATERMARKED");
  expect(descriptor.markerNote).toContain("/v1/evidence");
});

test("the materialization key is stated as not-served — never invented", () => {
  const descriptor = hfEvidence(aave, batch, "1.08");
  const batchSection = descriptor.sections.find((s) => s.title === "BATCH · MATERIALIZATION");
  const keyRow = batchSection?.rows.find((row) => row.label === "materialization key");
  expect(keyRow?.value).toContain("not served on this surface");
  expect(keyRow?.value).toContain("/v1/evidence");
});

test("a stale price input travels through the chain with a visible (non-default) tone", () => {
  const descriptor = totalEvidence(aave, batch, "collateral", "8000");
  const priceSection = descriptor.sections.find((s) => s.title.startsWith("PRICE INPUTS"));
  const staleRow = priceSection?.rows.find((row) => row.value.includes("stale"));
  expect(staleRow).toBeDefined();
  expect(staleRow?.tone).toBe("warn");
});

test("the descriptor quotes the wire's own numbers for the HF law", () => {
  const descriptor = hfEvidence(aave, batch, "1.08");
  const focus = descriptor.sections[0];
  expect(focus?.title).toBe("THIS NUMBER");
  const values = focus?.rows.map((row) => row.value) ?? [];
  expect(values).toContain("1080000000000000000");
  expect(values).toContain("6480000000000000");
  expect(values).toContain("6000000000000000");
});
