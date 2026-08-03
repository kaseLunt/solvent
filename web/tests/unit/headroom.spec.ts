// W-HR-A — the HEADROOM metric's pins.
//
// Laws under test:
//   - ONE FORMULA, BOTH ENGINES: headroom = (num − den) / num over the health
//     factor's own pair. Aave feeds it (wad, 1e18); the Debt Manager feeds it
//     (max_borrow_lt, borrowings). Both are checked against the committed
//     fixtures' real numbers.
//   - TRUNCATION, NEVER ROUNDING UP: 1.99% displays "1.9%". A headroom that
//     rounds up is a claim of safety the arithmetic did not make.
//   - BAND EDGES ARE EXACT BIGINT: 1.999…% is in [0,2) and exactly 2% is in
//     [2,5) — decided by cross-multiplication, never by a float compared
//     against 2.0.
//   - BREACHED is the wire's own predicate (debt > threshold ⟺ den > num),
//     and its percent points the same way it always did (floor keeps a breach
//     from ever displaying as shallower than it is).
//   - THE DEGENERATE PAIRS: 0/0 is not a band, not a zero, and not "safe".

import { expect, test } from "@playwright/test";
import {
  headroomBand,
  headroomBandLabel,
  headroomBelowWarn,
  headroomBreached,
  headroomPercent,
  headroomTenths,
  HEADROOM_BANDS,
  HEADROOM_BAND_EDGES,
  HEADROOM_BREACHED_BAND,
  WARN_HEADROOM_PCT,
} from "../../lib/headroom";

const WAD = 10n ** 18n;

test.describe("the formula, per engine, on the committed fixture numbers", () => {
  test("aave_v3_etherfi: (hf − 1e18) / hf over the wad", () => {
    // positions-aave-page-1.json: health_factor.wad = 1.08e18.
    // (1.08 − 1) / 1.08 = 0.0740740… → 7.4% floored.
    expect(headroomPercent(1080000000000000000n, WAD)).toBe("7.4%");
    expect(headroomBand(1080000000000000000n, WAD)).toBe(3); // 5–10%
    expect(headroomBandLabel(3)).toBe("5–10%");
  });

  test("debt_manager: (max_borrow_lt − borrowings) / max_borrow_lt", () => {
    // positions-dm-page-1.json: num = 3,200 usd6, den = 4,200 usd6.
    // (3200 − 4200) / 3200 = −0.3125 → −31.3% floored (never −31.2%).
    expect(headroomPercent(3200000000n, 4200000000n)).toBe("−31.3%");
    expect(headroomBreached(3200000000n, 4200000000n)).toBe(true);
    expect(headroomBand(3200000000n, 4200000000n)).toBe(HEADROOM_BREACHED_BAND);
  });

  test("the two engines agree when the ratio agrees — one arithmetic, not two", () => {
    // HF 0.8 expressed as an Aave wad and as a DM rational must produce the
    // identical headroom: the metric is a function of the RATIO alone.
    expect(headroomPercent(800000000000000000n, WAD)).toBe(headroomPercent(8n, 10n));
    expect(headroomBand(800000000000000000n, WAD)).toBe(headroomBand(8n, 10n));
  });

  test("an account at HF 1.02 — the case that read 'never' before — is not safe", () => {
    // (1.02 − 1) / 1.02 = 1.9607…% — inside the tightest live band, and
    // inside the warn edge. The old column called this row `no price path`.
    expect(headroomPercent(1020000000000000000n, WAD)).toBe("1.9%");
    expect(headroomBand(1020000000000000000n, WAD)).toBe(1); // 0–2%
    expect(headroomBelowWarn(1020000000000000000n, WAD)).toBe(true);
  });
});

test.describe("truncation — 1.99% must never display as 2%", () => {
  test("an exact 1.99% floors to 1.9% and stays in the 0–2 band", () => {
    // 199 / 10000 = 1.99% exactly.
    expect(headroomTenths(10000n, 9801n)).toBe(19n);
    expect(headroomPercent(10000n, 9801n)).toBe("1.9%");
    expect(headroomBand(10000n, 9801n)).toBe(1);
  });

  test("1.9999999999999999% — a float would round it to 2 — still floors to 1.9%", () => {
    const num = WAD;
    const den = WAD - 19_999_999_999_999_999n;
    expect(headroomPercent(num, den)).toBe("1.9%");
    expect(headroomBand(num, den)).toBe(1);
  });

  test("9.99% floors to 9.9% and stays strictly inside the warn edge", () => {
    // 999 / 10000 = 9.99%.
    expect(headroomPercent(10000n, 9001n)).toBe("9.9%");
    expect(headroomBelowWarn(10000n, 9001n)).toBe(true);
    expect(headroomBand(10000n, 9001n)).toBe(3); // 5–10%
  });

  test("a whole percent drops the fraction digit entirely", () => {
    expect(headroomPercent(100n, 90n)).toBe("10%");
    expect(headroomPercent(100n, 100n)).toBe("0%");
  });

  test("floor also governs the NEGATIVE side — a breach never displays as shallower", () => {
    // (32 − 42) / 32 = −31.25% → −31.3%, never the flattering −31.2%.
    expect(headroomTenths(3200000000n, 4200000000n)).toBe(-313n);
    expect(headroomPercent(3200000000n, 4200000000n)).toBe("−31.3%");
  });
});

test.describe("band edges — decided in exact bigint, never at a float boundary", () => {
  test("every edge: exactly-at goes UP, one integer unit below stays down", () => {
    // For each edge e, build the exact pair (10000, 10000 − 100e) — headroom
    // exactly e% — and the pair one unit tighter.
    const bandForEdge: Record<number, number> = { 2: 2, 5: 3, 10: 4, 25: 5, 50: 6 };
    for (const edge of HEADROOM_BAND_EDGES) {
      const num = 10000n;
      const atEdge = num - BigInt(edge) * 100n;
      expect(headroomBand(num, atEdge)).toBe(bandForEdge[edge]);
      // One integer unit MORE debt is strictly below the edge.
      expect(headroomBand(num, atEdge + 1n)).toBe((bandForEdge[edge] ?? 0) - 1);
    }
  });

  test("1.999…% vs 2% — the pair the whole exactness law exists for", () => {
    expect(headroomBand(10000n, 9801n)).toBe(1); // 1.99% → 0–2
    expect(headroomBand(100n, 98n)).toBe(2); // exactly 2% → 2–5
  });

  test("the seven bands, in order, with their reader-words labels", () => {
    expect(HEADROOM_BANDS.map((band) => band.label)).toEqual([
      "breached",
      "0–2%",
      "2–5%",
      "5–10%",
      "10–25%",
      "25–50%",
      ">50%",
    ]);
    // Every band carries a MEANING — a range is not an explanation.
    for (const band of HEADROOM_BANDS) expect(band.meaning.length).toBeGreaterThan(20);
  });

  test("the warn edge is 10 and the predicate is exact at it", () => {
    expect(WARN_HEADROOM_PCT).toBe(10);
    // Exactly 10% is NOT below the warn edge; one unit tighter is.
    expect(headroomBelowWarn(10000n, 9000n)).toBe(false);
    expect(headroomBelowWarn(10000n, 9001n)).toBe(true);
  });
});

test.describe("breached, and the degenerate pairs", () => {
  test("breached is den > num — the engines' own predicate, in integers", () => {
    expect(headroomBreached(100n, 101n)).toBe(true);
    expect(headroomBreached(100n, 100n)).toBe(false); // exactly at the boundary
    expect(headroomBreached(100n, 99n)).toBe(false);
    // HF 0.9999999999999999 on the wad is breached — never rounded onto the
    // safe side.
    expect(headroomBreached(WAD - 1n, WAD)).toBe(true);
    expect(headroomBand(WAD - 1n, WAD)).toBe(HEADROOM_BREACHED_BAND);
  });

  test("no debt (den 0) is full headroom — 100%, the top band", () => {
    expect(headroomPercent(100n, 0n)).toBe("100%");
    expect(headroomBand(100n, 0n)).toBe(6);
  });

  test("0/0 is not a band, not a zero, and not safe", () => {
    expect(headroomBand(0n, 0n)).toBeNull();
    expect(headroomPercent(0n, 0n)).toBeNull();
    expect(headroomTenths(0n, 0n)).toBeNull();
    expect(headroomBelowWarn(0n, 0n)).toBe(false);
  });

  test("no threshold but real debt is BREACHED, with no percent to print", () => {
    // maxBorrowLT 0 against live borrowings: debt exceeds the threshold, so
    // the breach predicate holds; the ratio has no denominator to divide by,
    // so the percent is withheld rather than invented.
    expect(headroomBreached(0n, 5n)).toBe(true);
    expect(headroomBand(0n, 5n)).toBe(HEADROOM_BREACHED_BAND);
    expect(headroomPercent(0n, 5n)).toBeNull();
  });

  test("a negative leg is never coerced into a band", () => {
    expect(headroomBand(-1n, 5n)).toBeNull();
    expect(headroomPercent(5n, -1n)).toBeNull();
  });
});
