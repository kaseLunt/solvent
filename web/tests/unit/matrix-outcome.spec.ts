// Phase 0 fix 2: a settled matrix cell must surface EVERY nonzero outcome
// dimension of its engine result — Δ eligible debt alone is an incomplete
// account when bad debt or execution shortfall moved (cross-page brief,
// immediate trust fixes item 4).
import { expect, test } from "@playwright/test";
import { CELL_QUIET_LINE, cellPrimaryOutcome } from "../../app/lab/matrixCells";
import type { LabRunBookEngine } from "../../lib/runbook";

// Minimal engine skeleton: only the fields cellPrimaryOutcome reads.
// usd_decimals 2 keeps expectations legible.
function engine(over: Partial<LabRunBookEngine>): LabRunBookEngine {
  return {
    engine: "aave_v3_etherfi",
    usd_decimals: 2,
    eligible_debt_delta_usd: "0",
    bad_debt_delta_usd: "0",
    newly_eligible_accounts: 0,
    market_realization: null,
    ...over,
  } as LabRunBookEngine;
}

test("all-zero engine is quiet", () => {
  expect(cellPrimaryOutcome(engine({}))).toEqual({ kind: "quiet" });
  expect(CELL_QUIET_LINE).toBe("no effective movement");
});

test("nonzero bad debt surfaces even when eligible debt is zero", () => {
  const out = cellPrimaryOutcome(engine({ bad_debt_delta_usd: "15900" }));
  expect(out.kind).toBe("movement");
  expect((out as { parts: string[] }).parts.join(" · ")).toContain("Δ bad debt");
});

test("execution shortfall surfaces even when every delta is zero", () => {
  const out = cellPrimaryOutcome(
    engine({
      market_realization: {
        hfs_unchanged: true,
        execution_shortfall_usd: "3864",
        bad_debt_at_liquidation_usd: "0",
        usd_decimals: 2,
        seizure_model: "pro-rata-over-counted-collateral",
        note: "",
      },
    }),
  );
  expect(out.kind).toBe("movement");
  expect((out as { parts: string[] }).parts.join(" · ")).toContain("execution shortfall");
});

test("negative deltas count as movement (DELTA-ONLY can be negative)", () => {
  const out = cellPrimaryOutcome(engine({ eligible_debt_delta_usd: "-5" }));
  expect(out.kind).toBe("movement");
});

// ---------------------------------------------------------------------------
// p0-8 finding 2 — the wire Decimal contract (api/openapi.yaml `Decimal`:
// `^-?[0-9]+$`, a signed integer string) is the ONLY shape these fields may
// carry. Run-book bodies are JSON-cast without runtime validation, so a
// malformed or version-skewed delta CAN reach this function — and the old
// zero test (`/^-?0*\.?0*$/`) swallowed "", "-", ".", "00.00" as zeros,
// rendering an unknowable as a quiet "no effective movement". A value outside
// the contract is MALFORMED: named, never quiet and never movement.
// ---------------------------------------------------------------------------

for (const bad of ["", "-", ".", "0.0", "1e5", " 0", "0 "]) {
  test(`a delta of ${JSON.stringify(bad)} is MALFORMED with its field named — never quiet`, () => {
    expect(cellPrimaryOutcome(engine({ bad_debt_delta_usd: bad }))).toEqual({
      kind: "malformed",
      fields: ["bad_debt_delta_usd"],
    });
  });
}

test("a malformed execution shortfall is named by its wire path", () => {
  const out = cellPrimaryOutcome(
    engine({
      market_realization: {
        hfs_unchanged: true,
        execution_shortfall_usd: ".",
        bad_debt_at_liquidation_usd: "0",
        usd_decimals: 2,
        seizure_model: "pro-rata-over-counted-collateral",
        note: "",
      },
    }),
  );
  expect(out).toEqual({
    kind: "malformed",
    fields: ["market_realization.execution_shortfall_usd"],
  });
});

test("a non-integer newly_eligible_accounts is MALFORMED, not rendered as a count", () => {
  expect(cellPrimaryOutcome(engine({ newly_eligible_accounts: 1.5 }))).toEqual({
    kind: "malformed",
    fields: ["newly_eligible_accounts"],
  });
});

test("every malformed field is named, in read order", () => {
  expect(
    cellPrimaryOutcome(engine({ eligible_debt_delta_usd: "", bad_debt_delta_usd: "-" })),
  ).toEqual({
    kind: "malformed",
    fields: ["eligible_debt_delta_usd", "bad_debt_delta_usd"],
  });
});

test("contract-legal zeros are still quiet: -0 and 000", () => {
  expect(
    cellPrimaryOutcome(engine({ eligible_debt_delta_usd: "-0", bad_debt_delta_usd: "000" })),
  ).toEqual({ kind: "quiet" });
});

test("parts order is fixed: newly eligible, Δ eligible debt, Δ bad debt, shortfall", () => {
  const out = cellPrimaryOutcome(
    engine({
      newly_eligible_accounts: 2,
      eligible_debt_delta_usd: "100",
      bad_debt_delta_usd: "200",
      market_realization: {
        hfs_unchanged: false,
        execution_shortfall_usd: "300",
        bad_debt_at_liquidation_usd: "0",
        usd_decimals: 2,
        seizure_model: "pro-rata-over-counted-collateral",
        note: "",
      },
    }),
  ) as { kind: "movement"; parts: string[] };
  expect(out.parts).toHaveLength(4);
  expect(out.parts[0]).toContain("newly eligible");
  expect(out.parts[1]).toContain("Δ eligible debt");
  expect(out.parts[2]).toContain("Δ bad debt");
  expect(out.parts[3]).toContain("execution shortfall");
});
