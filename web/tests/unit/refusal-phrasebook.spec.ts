// web/tests/unit/refusal-phrasebook.spec.ts
import { expect, test } from "@playwright/test";
import { plainCause } from "../../lib/refusal-phrasebook";

test("known codes lead with a plain cause; unknown codes fall back to the detail, then the code", () => {
  expect(plainCause("SWEEP_NEVER")).toBe("collateral sweep never ran");
  expect(plainCause("FLAG_CUSTODY_UNPROVEN")).toBe("collateral-flag custody unproven");
  expect(plainCause("G1", "gate G1: no fresh price for weETH")).toBe("gate G1: no fresh price for weETH");
  expect(plainCause("G1")).toBe("refused (G1)");
  expect(plainCause("SWEEP_NEVER", "ignored — the phrasebook wins for known codes")).toBe("collateral sweep never ran");
});
