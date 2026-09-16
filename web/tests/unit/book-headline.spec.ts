import { expect, test } from "@playwright/test";
import { bookHeadline, bookHeadlineRefused } from "../../lib/book-headline";

const usd6 = (n: number): bigint => BigInt(Math.round(n * 1_000_000));

test("material: money first, the emphasized phrase carries the verdict", () => {
  const h = bookHeadline({
    decimals: 6,
    material: { sum: usd6(6840), count: 2 },
    belowLine: { sum: usd6(112), count: 47 },
    nearCap: { sum: usd6(312_400), count: 27 },
    notComputed: 6,
  });
  expect(h.variant).toBe("material");
  expect(h.tone).toBe("crit");
  expect(h.emphasis).toBe("$6,840 of Cash debt is liquidatable right now,");
  expect(h.rest).toBe(" across 2 accounts.");
  expect(h.dek).toBe(
    "47 more positions are technically liquidatable but total $112 — below the $100 line and not headlined. " +
      "27 accounts are within 10% of their borrow cap, carrying $312K. " +
      "6 positions could not be computed this batch and are counted, not hidden.",
  );
});

test("material, singular everywhere", () => {
  const h = bookHeadline({
    decimals: 6,
    material: { sum: usd6(4200), count: 1 },
    belowLine: { sum: 0n, count: 0 },
    nearCap: { sum: 0n, count: 0 },
    notComputed: 1,
  });
  expect(h.emphasis).toBe("$4,200 of Cash debt is liquidatable right now,");
  expect(h.rest).toBe(" across 1 account.");
  expect(h.dek).toBe(
    "No account is within 10% of its borrow cap. 1 position could not be computed this batch and is counted, not hidden.",
  );
});

test("quiet: nothing material — the dek leads with the below-line count", () => {
  const h = bookHeadline({
    decimals: 8,
    material: { sum: 0n, count: 0 },
    belowLine: { sum: 46n, count: 46 },
    nearCap: { sum: 0n, count: 0 },
    notComputed: 0,
  });
  expect(h.variant).toBe("quiet");
  expect(h.tone).toBe("ok");
  expect(h.emphasis).toBe("Nothing material is liquidatable on the Cash book right now.");
  expect(h.rest).toBe("");
  expect(h.dek).toBe(
    "46 more positions are technically liquidatable but total <$0.01 — below the $100 line and not headlined. No account is within 10% of its borrow cap.",
  );
});

test("quiet with nothing liquidatable at all", () => {
  const h = bookHeadline({
    decimals: 6,
    material: { sum: 0n, count: 0 },
    belowLine: { sum: 0n, count: 0 },
    nearCap: { sum: usd6(11_200), count: 3 },
    notComputed: 0,
  });
  expect(h.dek).toBe("No position is liquidatable. 3 accounts are within 10% of their borrow cap, carrying $11K.");
});

test("refused: the whole engine withheld", () => {
  const h = bookHeadlineRefused("collateral-flag custody is unproven for this window");
  expect(h.variant).toBe("refused");
  expect(h.tone).toBe("refused");
  expect(h.emphasis).toBe("The Cash book could not be computed this batch.");
  expect(h.rest).toBe("");
  expect(h.dek).toBe("Collateral-flag custody is unproven for this window.");
});
