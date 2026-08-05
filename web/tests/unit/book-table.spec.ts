// W-UX-C (the Book table redesign) — dust-filter vocabulary, the exclusion
// law's client mirror, bound arithmetic, the ruling's verbatim copy, and the
// dir/dust extensions of W-UX-B's deep-link normalizer.
//
// Laws under test:
//   - the exclusion-law mirror (contract 1.3.0 `min_value`): a row hides iff
//     status=computed AND both totals non-null AND max(collateral, debt) <
//     threshold. REFUSED never dust; NULL never dust ("an unknowable is not
//     a small number"); the comparison is STRICT — a row exactly AT the step
//     stays visible.
//   - thresholds and bounds are exact bigint: step × 10^decimals, bound =
//     threshold × hidden. No float ever holds a sum.
//   - every disclosure string is a constant in app/book/dust.ts — pinned
//     verbatim so no rewording can drift in.
//   - dir/dust normalization: unknown values fall to defaults; dir has no
//     affordance under sort=status; a present-but-canonical dir is dropped
//     (defaults omitted from the URL); the doomed (debt_manager, hf) remap
//     still never composes a request the API would refuse.

import { expect, test } from "@playwright/test";
import {
  DUST_CHIP_LABELS,
  DUST_DEFAULT_STEP,
  DUST_GROUP_TITLE,
  DUST_STEPS,
  FOOTER_REFUSED_NEVER_DUST,
  REFUSED_FIRST_CHIP_TITLE,
  dustBoundInteger,
  dustDisclosureBound,
  dustDisclosureExact,
  dustMapLegend,
  dustStepAmount,
  dustStepUsdLabel,
  dustThresholdInteger,
  emptyFilteredWalk,
  footerAccountingDust,
  footerAccountingOff,
  hiddenBelowStepSegment,
  hiddenByDustStep,
  hiddenCountMismatch,
  liquidatableDisclosureTail,
  normalizeDustParam,
} from "../../app/book/dust";
import {
  canonicalWireDir,
  normalizeBookQuery,
  normalizeDirParam,
  reversedWireDir,
} from "../../lib/positions";

// ---------------------------------------------------------------------------
// The exclusion-law mirror.
// ---------------------------------------------------------------------------

test.describe("hiddenByDustStep — the contract's exclusion law, mirrored", () => {
  const threshold = dustThresholdInteger("1", 6); // $1 at 6 decimals = 1000000n

  test("refused rows are NEVER dust, whatever their totals say", () => {
    expect(hiddenByDustStep("refused", "5", "5", threshold)).toBe(false);
    expect(hiddenByDustStep("refused", null, null, threshold)).toBe(false);
    expect(hiddenByDustStep("refused", "999999", "1", threshold)).toBe(false);
  });

  test("NULL-total rows are NEVER dust — an unknowable is not a small number", () => {
    expect(hiddenByDustStep("computed", null, "5", threshold)).toBe(false);
    expect(hiddenByDustStep("computed", "5", null, threshold)).toBe(false);
    expect(hiddenByDustStep("computed", null, null, threshold)).toBe(false);
  });

  test("strict <: a row exactly AT the step stays visible", () => {
    // max(collateral, debt) === threshold → NOT hidden.
    expect(hiddenByDustStep("computed", "1000000", "5", threshold)).toBe(false);
    expect(hiddenByDustStep("computed", "5", "1000000", threshold)).toBe(false);
    // One integer unit below the step → hidden.
    expect(hiddenByDustStep("computed", "999999", "999999", threshold)).toBe(true);
  });

  test("max() governs: either total at-or-above the step keeps the row", () => {
    expect(hiddenByDustStep("computed", "999999", "999999", threshold)).toBe(true);
    expect(hiddenByDustStep("computed", "1000001", "0", threshold)).toBe(false);
    expect(hiddenByDustStep("computed", "0", "1000001", threshold)).toBe(false);
  });

  test("no threshold (dust off) hides nothing", () => {
    expect(hiddenByDustStep("computed", "0", "0", null)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Threshold and bound arithmetic — exact bigint.
// ---------------------------------------------------------------------------

test.describe("bound arithmetic — exact, bigint, never a float", () => {
  test("dustBoundInteger = threshold × hidden, exact", () => {
    expect(dustBoundInteger("1", 8, 3)).toBe(300000000n);
    expect(dustBoundInteger("100", 6, 2)).toBe(200000000n);
    expect(dustBoundInteger("1k", 6, 250)).toBe(250000000000n);
    expect(dustBoundInteger("1", 0, 7)).toBe(7n);
  });

  test("the vocabulary survives: steps, default, chip labels, prose amounts", () => {
    expect([...DUST_STEPS]).toEqual(["off", "1", "100", "1k"]);
    expect(DUST_DEFAULT_STEP).toBe("1");
    expect(DUST_CHIP_LABELS).toEqual({ off: "off", "1": "<1", "100": "<100", "1k": "<1k" });
    expect(dustStepAmount("1")).toBe("1");
    expect(dustStepAmount("100")).toBe("100");
    expect(dustStepAmount("1k")).toBe("1k");
  });
});

// ---------------------------------------------------------------------------
// The ruling's copy, pinned verbatim.
// ---------------------------------------------------------------------------

test.describe("dust copy constants — the ruling's strings, verbatim", () => {
  test("the dust group title", () => {
    expect(DUST_GROUP_TITLE).toBe(
      "hide rows where max(collateral, debt) is below the step, in the engine's own value " +
        "unit. Hidden rows stay counted here and in every aggregate above; refused and " +
        "null-valued rows are never hidden",
    );
  });

  test("the refused-first chip title", () => {
    expect(REFUSED_FIRST_CHIP_TITLE).toBe(
      "sort=status: refused rows ranked first for triage, then risk order",
    );
  });

  test("the amended footer constant", () => {
    expect(FOOTER_REFUSED_NEVER_DUST).toBe(
      "refused rows stay visible and counted; the dust step never hides them",
    );
  });

  test("footer accounting, dust active", () => {
    expect(footerAccountingDust(120, "300", "1", hiddenBelowStepSegment(45), "345", "debt ▼")).toBe(
      "120 loaded of 300 qualifying (dust <1) · 45 hidden below step · 345 on book · sort debt ▼",
    );
    // A degraded hidden count renders NOTHING in its slot — never a zero.
    expect(footerAccountingDust(0, "—", "1", "", "—", "headroom ▲")).toBe(
      "0 loaded of — qualifying (dust <1) · — on book · sort headroom ▲",
    );
  });

  test("footer accounting, dust off", () => {
    expect(footerAccountingOff(2, "2", "2", "headroom ▲")).toBe(
      "2 of 2 rows · 2 on book · sort headroom ▲",
    );
  });

  test("the batch-mismatch sentence: counts from two batches are never blended", () => {
    expect(hiddenCountMismatch(2, 1)).toBe(
      "hidden count — (aggregate from batch #2, pages from batch #1: counts from two " +
        "batches are never blended)",
    );
  });

  test("the dust disclosure span — bound form, then the exact form at exhaustion", () => {
    expect(dustDisclosureBound(45, "1", "45")).toBe(
      "hidden: 45 rows below 1 · Σ debt ≤ 45 (bound: every hidden row is below the step) · ",
    );
    expect(dustDisclosureExact(45, "1", "12.480021")).toBe(
      "hidden: 45 rows below 1 · Σ debt 12.480021 exact · ",
    );
  });

  test("the liquidatable disclosure tail", () => {
    expect(liquidatableDisclosureTail(3)).toBe(
      " liquidatable on this book · 3 among loaded rows; the rest are below the dust step " +
        "or on unloaded pages",
    );
  });

  test("the empty filtered walk: hidden, not absent", () => {
    expect(emptyFilteredWalk("1", 2, "2")).toBe(
      "no rows at or above the dust step (1) · 2 rows below it are hidden by the filter and " +
        "still counted · Σ debt ≤ 2 · set dust off to see them",
    );
  });

  // CHART SPEC v4 — the STATE slot's source-filter semantics. The old line
  // said dust was "excluded at the source" and left the reader to guess WHICH
  // rows that removes; the natural guess (any sub-dollar debt) is wrong,
  // because the contract's exclusion is a CONJUNCTION over both totals.
  //
  // W-VR defect 7: the threshold carries its UNIT ("below $1", never a bare
  // "below 1" that reads as a count), formatted by dust.ts itself.
  test("the risk-map source-filter disclosure states the conjunction, with the unit", () => {
    expect(dustMapLegend("1")).toBe(
      "Source filter: a position is excluded only when both its collateral and its debt are " +
        "below $1. A position with sub-dollar debt stays on this map when its collateral is at " +
        "or above $1.",
    );
    expect(dustMapLegend("1k")).toBe(
      "Source filter: a position is excluded only when both its collateral and its debt are " +
        "below $1k. A position with sub-dollar debt stays on this map when its collateral is at " +
        "or above $1k.",
    );
    // AC-33: the clause that makes the conjunction unmistakable.
    expect(dustMapLegend("100")).toContain(
      "only when both its collateral and its debt are below",
    );
    // The unit is dust.ts's own formatting, never retyped at a call site.
    expect(dustStepUsdLabel("1")).toBe("$1");
    expect(dustStepUsdLabel("100")).toBe("$100");
    expect(dustStepUsdLabel("1k")).toBe("$1k");
    // A bare, unitless threshold never comes back: both clauses carry the $.
    expect(dustMapLegend("100")).toContain("below $100");
    expect(dustMapLegend("100")).toContain("at or above $100");
  });
});

// ---------------------------------------------------------------------------
// The dir/dust extensions of the deep-link normalizer.
// ---------------------------------------------------------------------------

test.describe("normalizeDustParam — unknown steps fall to the default", () => {
  test("absent → the default, nothing rewritten", () => {
    expect(normalizeDustParam(null)).toEqual({ dust: "1", rewritten: false });
  });

  test("every legal step passes through", () => {
    expect(normalizeDustParam("off")).toEqual({ dust: "off", rewritten: false });
    expect(normalizeDustParam("1")).toEqual({ dust: "1", rewritten: false });
    expect(normalizeDustParam("100")).toEqual({ dust: "100", rewritten: false });
    expect(normalizeDustParam("1k")).toEqual({ dust: "1k", rewritten: false });
  });

  test("an unknown step falls to the default and is rewritten", () => {
    expect(normalizeDustParam("99")).toEqual({ dust: "1", rewritten: true });
    expect(normalizeDustParam("")).toEqual({ dust: "1", rewritten: true });
  });
});

test.describe("normalizeDirParam — the two-state direction, never a doomed request", () => {
  test("absent → canonical, nothing rewritten", () => {
    expect(normalizeDirParam(null, "debt")).toEqual({ reversed: false, rewritten: false });
  });

  test("the reverse of the canonical direction is kept", () => {
    expect(normalizeDirParam("asc", "debt")).toEqual({ reversed: true, rewritten: false });
    expect(normalizeDirParam("desc", "liq_distance")).toEqual({ reversed: true, rewritten: false });
    expect(normalizeDirParam("desc", "hf")).toEqual({ reversed: true, rewritten: false });
  });

  test("a present-but-canonical dir is dropped — defaults are omitted", () => {
    expect(normalizeDirParam("desc", "debt")).toEqual({ reversed: false, rewritten: true });
    expect(normalizeDirParam("asc", "liq_distance")).toEqual({ reversed: false, rewritten: true });
  });

  test("an unknown dir falls away, rewritten", () => {
    expect(normalizeDirParam("up", "debt")).toEqual({ reversed: false, rewritten: true });
  });

  test("dir has no affordance under sort=status (refused-first)", () => {
    expect(normalizeDirParam("asc", "status")).toEqual({ reversed: false, rewritten: true });
    expect(normalizeDirParam("desc", "status")).toEqual({ reversed: false, rewritten: true });
  });
});

test.describe("normalizeBookQuery — the composed decision, orphaned dirs dropped", () => {
  test("a legal reversal under a surviving sort is kept", () => {
    expect(normalizeBookQuery("debt_manager", "debt", "asc")).toEqual({
      engine: "debt_manager",
      sort: "debt",
      hfRemapped: false,
      rewritten: false,
      reversed: true,
    });
  });

  test("a dir with NO sort param reverses the DEFAULT sort — it says what it means", () => {
    expect(normalizeBookQuery(null, null, "desc")).toEqual({
      engine: "debt_manager",
      sort: "headroom",
      hfRemapped: false,
      rewritten: false,
      reversed: true,
    });
  });

  test("a dir under the REMAPPED (debt_manager, hf) pair is ORPHANED — dropped, never reinterpreted", () => {
    // WAVE R8 renamed this case from "aliased" to "remapped", because that is
    // now the only sort `normalizeBookQuery` moves at all — and it moves
    // because the API refuses the pair, not because the UI prefers a token.
    // On AAVE the same params are honored verbatim, direction included (see
    // book-sort-vocabulary.spec.ts): the orphan rule is meant for a sort that
    // genuinely HAD to change, and R7's alias made it fire on one that had not.
    expect(normalizeBookQuery("debt_manager", "hf", "desc")).toEqual({
      engine: "debt_manager",
      sort: "headroom",
      hfRemapped: true,
      rewritten: true,
      reversed: false,
    });
  });

  test("a dir under an unknown sort is orphaned too", () => {
    expect(normalizeBookQuery(null, "bogus_sort", "desc")).toEqual({
      engine: "debt_manager",
      sort: "headroom",
      hfRemapped: false,
      rewritten: true,
      reversed: false,
    });
  });
});

test.describe("wire directions — canonical and reversed, from the sort vocabulary", () => {
  test("canonical: liq_distance/hf/headroom asc, debt desc, status none", () => {
    expect(canonicalWireDir("liq_distance")).toBe("asc");
    expect(canonicalWireDir("hf")).toBe("asc");
    expect(canonicalWireDir("headroom")).toBe("asc");
    expect(canonicalWireDir("debt")).toBe("desc");
    expect(canonicalWireDir("status")).toBeNull();
  });

  test("reversed is the exact flip; status stays direction-free", () => {
    expect(reversedWireDir("liq_distance")).toBe("desc");
    expect(reversedWireDir("hf")).toBe("desc");
    expect(reversedWireDir("headroom")).toBe("desc");
    expect(reversedWireDir("debt")).toBe("asc");
    expect(reversedWireDir("status")).toBeNull();
  });
});
