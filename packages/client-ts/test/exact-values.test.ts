// Test category (2): FIXTURE-BASED EXACT-VALUE TESTS.
//
// Every assertion here quotes a value from `PINNED`, and every `PINNED` value is
// quoted from `cmd/api`'s Go suite. Client and server pin THE SAME NUMBERS: one
// set of arithmetic, checked from both ends.
//
// The values travel through the real client — real URL construction, real status
// handling, real `JSON.parse` — over the committed fixture BYTES. What is being
// tested is that the client hands a caller the server's digits unaltered, which
// is the one job a risk client cannot get approximately right.

import { describe, expect, it } from "vitest";

import {
  AbsentQuantityError,
  SolventClient,
  aaveEligibleFromWad,
  compareRatio,
  parseDecimal,
  parseNullableDecimal,
  positionEligible,
  requireDecimal,
} from "../src/index.js";
import type { Position, Scenario, ScenarioResult } from "../src/index.js";
import { FIXTURE_FILES, fixtureBytes, PINNED } from "./fixtures/index.js";
import { mockFetch } from "./helpers/mock-fetch.js";

const BASE = "http://localhost:8080";

function clientFor(routes: Record<string, string>) {
  const table = Object.fromEntries(
    Object.entries(routes).map(([path, file]) => [path, { body: fixtureBytes(file) }]),
  );
  const mock = mockFetch(table);
  return { client: new SolventClient({ baseUrl: BASE, fetch: mock.fetch }), mock };
}

const byKey = <T, K extends keyof T>(list: readonly T[], key: K, want: T[K]): T => {
  const found = list.find((e) => e[key] === want);
  if (found === undefined) throw new Error(`no element with ${String(key)} == ${String(want)}`);
  return found;
};

const countFor = (list: readonly { key: string; count: number }[], key: string): number =>
  byKey(list, "key", key).count;

// ===========================================================================
// /v1/book
// ===========================================================================

describe("/v1/book serves the seeded book's exact values", () => {
  const { client } = clientFor({ "/v1/book": FIXTURE_FILES.book });

  it("carries the batch envelope: four positions, two refused, one flagged", async () => {
    const book = await client.book();
    expect(book.batch.position_count).toBe(PINNED.batch.positionCount);
    expect(book.batch.refused_count).toBe(PINNED.batch.refusedCount);
    expect(book.batch.flagged_count).toBe(PINNED.batch.flaggedCount);
    expect(book.batch.status).toBe(PINNED.batch.status);
    expect(book.batch.watermarks).toHaveLength(PINNED.batch.watermarkCount);
    // The fixture's cursors sit exactly on the batch's stamps and no epoch is
    // recorded, so no supersession leg may fire.
    expect(book.batch.supersession.superseded).toBe(PINNED.batch.superseded);
    expect(book.batch.supersession.legs).toEqual([]);
  });

  it("keeps the two engines separate, each in its own scale, never summed", async () => {
    const book = await client.book();
    expect(book.engines).toHaveLength(2);

    const aave = byKey(book.engines, "engine", PINNED.engines.aave);
    expect(aave.value_decimals).toBe(PINNED.aave.valueDecimals);
    expect(aave.total_collateral).toBe(PINNED.aave.collateralBase);
    expect(aave.total_debt).toBe(PINNED.aave.debtBase);
    expect(aave.positions).toBe(2);
    expect(aave.computed_positions).toBe(1);
    expect(aave.refused_positions).toBe(1);
    expect(aave.flagged_positions).toBe(1);
    expect(aave.liquidatable_positions).toBe(0);
    // The refusal is NAMED and COUNTED — the book is served with it.
    expect(countFor(aave.refusals, PINNED.aave.refusedRefusalCode)).toBe(1);
    expect(countFor(aave.flags, PINNED.aave.flag)).toBe(1);

    const dm = byKey(book.engines, "engine", PINNED.engines.dm);
    expect(dm.value_decimals).toBe(PINNED.dm.valueDecimals);
    expect(dm.total_collateral).toBe(PINNED.dm.collateralUSD);
    expect(dm.total_debt).toBe(PINNED.dm.borrowings);
    expect(dm.liquidatable_positions).toBe(1);
    expect(countFor(dm.refusals, PINNED.dm.refusedRefusalCode)).toBe(1);
  });

  it("buckets the histogram on each engine's OWN comparator", async () => {
    const book = await client.book();
    expect(book.hf_histogram.wad_scale).toBe(PINNED.waterfall.wadScale);

    const aave = byKey(book.hf_histogram.engines, "engine", PINNED.engines.aave);
    expect(aave.comparator).toBe(PINNED.aave.histogramComparator);
    // HF 1.08 must land in [1.05, 1.10).
    expect(byKey(aave.buckets, "label", PINNED.aave.histogramBucket).count).toBe(1);
    expect(byKey(aave.buckets, "label", "< 0.90").count).toBe(0);
    expect(aave.refused_count).toBe(1);

    const dm = byKey(book.hf_histogram.engines, "engine", PINNED.engines.dm);
    expect(dm.comparator).toBe(PINNED.dm.histogramComparator);
    // 3200/4200 = 0.7619… must land below 0.90 — and the client can check that
    // WITHOUT forming a float, which is the point of compareRatio.
    expect(byKey(dm.buckets, "label", PINNED.dm.histogramBucket).count).toBe(1);
    expect(compareRatio(parseDecimal(PINNED.dm.hfNum), parseDecimal(PINNED.dm.hfDen), 90n, 100n)).toBe(-1);
  });

  it("serves the waterfall's unshocked point and the −10% crossing exactly", async () => {
    const book = await client.book();
    const wf = book.waterfall;
    if (wf === null) throw new Error("the fixture carries a waterfall");

    expect(wf.scenario_id).toBe(PINNED.waterfall.scenarioId);
    expect(wf.scenario_version).toBe(PINNED.waterfall.scenarioVersion);
    expect(wf.axis).toBe(PINNED.waterfall.axis);
    expect(wf.grid_scale).toBe(PINNED.waterfall.wadScale);
    expect(wf.monotonicity.ok).toBe(true);
    expect(wf.points).toHaveLength(PINNED.waterfall.pointCount);

    // Point 0 — the UNSHOCKED book. Aave is healthy at 1.08; the Debt Manager is
    // already liquidatable AND insolvent, which is the standing bad debt.
    const p0 = wf.points[0];
    if (p0 === undefined) throw new Error("point 0");
    expect(p0.factor).toBe(PINNED.waterfall.unshockedFactor);
    const p0aave = byKey(p0.engines, "engine", PINNED.engines.aave);
    expect(p0aave.cumulative_eligible_accounts).toBe(0);
    expect(p0aave.cumulative_debt_eligible_usd).toBe("0");
    expect(p0aave.cumulative_bad_debt_usd).toBe("0");
    const p0dm = byKey(p0.engines, "engine", PINNED.engines.dm);
    expect(p0dm.usd_decimals).toBe(PINNED.dm.valueDecimals);
    expect(p0dm.newly_eligible_accounts).toBe(1);
    expect(p0dm.cumulative_eligible_accounts).toBe(1);
    expect(p0dm.cumulative_debt_eligible_usd).toBe(PINNED.dm.borrowings);
    expect(p0dm.cumulative_collateral_at_risk_usd).toBe(PINNED.dm.atRiskAtPar);
    expect(p0dm.insolvent_if_liquidated_accounts).toBe(1);
    expect(p0dm.cumulative_bad_debt_usd).toBe(PINNED.dm.badDebtAtPar);

    // Point 1 — ETH −10%. Aave crosses here: 8000 x 0.9 x 0.81 / 6000 = 0.972.
    const p1 = wf.points[1];
    if (p1 === undefined) throw new Error("point 1");
    expect(p1.factor).toBe(PINNED.waterfall.minus10Factor);
    const p1aave = byKey(p1.engines, "engine", PINNED.engines.aave);
    expect(p1aave.usd_decimals).toBe(PINNED.aave.valueDecimals);
    expect(p1aave.newly_eligible_accounts).toBe(1);
    expect(p1aave.cumulative_debt_eligible_usd).toBe(PINNED.waterfall.aaveDebtAt90);
    expect(p1aave.cumulative_collateral_at_risk_usd).toBe(PINNED.waterfall.aaveAtRiskAt90);
    // The Aave position's collateral net of the 5% bonus still covers its debt.
    expect(p1aave.insolvent_if_liquidated_accounts).toBe(0);
    const p1dm = byKey(p1.engines, "engine", PINNED.engines.dm);
    // The Debt Manager crossed at point 0 and must not be counted again.
    expect(p1dm.newly_eligible_accounts).toBe(0);
    expect(p1dm.cumulative_collateral_at_risk_usd).toBe(PINNED.waterfall.dmAtRiskAt90);
    expect(p1dm.cumulative_bad_debt_usd).toBe(PINNED.waterfall.dmBadDebtAt90);
  });

  it("names the leg the propagation matrix does not cover rather than silently holding it", async () => {
    const book = await client.book();
    const held = book.waterfall?.held_flat ?? [];
    expect(held.length).toBeGreaterThan(0);
    expect(byKey(held, "asset", PINNED.assets.usdcEth).value).toBe(PINNED.aave.usdcPrice);
  });

  it("serves the standing bad-debt line and an honest zero on the other engine", async () => {
    const book = await client.book();
    expect(book.bad_debt).toHaveLength(2);
    const dm = byKey(book.bad_debt, "engine", PINNED.engines.dm);
    expect(dm.current_bad_debt_usd).toBe(PINNED.dm.badDebtAtPar);
    expect(dm.insolvent_positions).toBe(1);
    expect(byKey(book.bad_debt, "engine", PINNED.engines.aave).current_bad_debt_usd).toBe("0");
  });

  it("accounts for every position that reached the derived arithmetic", async () => {
    const book = await client.book();
    expect(book.coverage.batch_positions).toBe(PINNED.coverage.batchPositions);
    expect(book.coverage.in_book).toBe(PINNED.coverage.inBook);
    expect(book.coverage.refused_in_batch).toBe(PINNED.coverage.refusedInBatch);
    expect(book.coverage.excluded_by_this_layer).toBe(PINNED.coverage.excludedByThisLayer);
    expect(book.coverage.excluded).toEqual([]);
    expect(book.coverage.stress_coverage_is_full).toBe(true);
  });

  // The DERIVED grid points (2..5) are not server-pinned, so they are checked
  // against the contract's own invariants instead of against a number.
  it("holds the contract's series invariants across every grid point", async () => {
    const book = await client.book();
    const points = book.waterfall?.points ?? [];
    for (const engine of [PINNED.engines.aave, PINNED.engines.dm]) {
      let previousDebt = -1n;
      let previousEligible = -1;
      for (const point of points) {
        const e = byKey(point.engines, "engine", engine);
        const debt = parseDecimal(e.cumulative_debt_eligible_usd);
        // The standing invariant on the debt-eligible series: non-decreasing
        // down the grid. A violation would be SURFACED by `monotonicity`.
        expect(debt).toBeGreaterThanOrEqual(previousDebt);
        expect(e.cumulative_eligible_accounts).toBeGreaterThanOrEqual(previousEligible);
        previousDebt = debt;
        previousEligible = e.cumulative_eligible_accounts;
      }
    }
    // Grid factors strictly descend.
    const factors = points.map((p) => parseDecimal(p.factor));
    for (let i = 1; i < factors.length; i += 1) {
      expect(factors[i] as bigint).toBeLessThan(factors[i - 1] as bigint);
    }
  });
});

// ===========================================================================
// A WITHHELD ENGINE — the most dangerous zero on this surface.
//
// No number here is server-pinned (see the fixture provenance record: the review
// train that added this surface has no committed Go expectations yet). What IS
// asserted is the rule the surface exists for, and the client's part in it: a
// refused engine's totals are NULL, and nothing in this package turns that null
// into a zero.
// ===========================================================================

describe("a refused engine is never readable as a healthy one", () => {
  const { client } = clientFor({ "/v1/book": FIXTURE_FILES.bookEngineRefused });

  it("names the withheld engine at every level, so a partial reader cannot miss it", async () => {
    const book = await client.book();
    // Top of the document.
    expect(book.refused_engines).toHaveLength(1);
    expect(book.refused_engines[0]?.engine).toBe(PINNED.engines.aave);
    expect(book.refused_engines[0]?.code).toBe("FLAG_CUSTODY_UNPROVEN");
    // The batch envelope.
    expect(book.batch.refused_engines).toEqual([PINNED.engines.aave]);
    // The per-engine row.
    const aave = byKey(book.engines, "engine", PINNED.engines.aave);
    expect(aave.refused).toBe(true);
    expect(aave.refusal?.code).toBe("FLAG_CUSTODY_UNPROVEN");
    // The histogram, the waterfall and the bad-debt line.
    expect(byKey(book.hf_histogram.engines, "engine", PINNED.engines.aave).refused).toBe(true);
    expect(book.waterfall?.excluded_engines).toHaveLength(1);
    expect(byKey(book.bad_debt, "engine", PINNED.engines.aave).refused).toBe(true);
  });

  it("serves NULL totals, never '0' — a refusal is the ABSENCE of a number", async () => {
    const book = await client.book();
    const aave = byKey(book.engines, "engine", PINNED.engines.aave);
    expect(aave.total_collateral).toBeNull();
    expect(aave.total_debt).toBeNull();
    const bad = byKey(book.bad_debt, "engine", PINNED.engines.aave);
    expect(bad.current_bad_debt_usd).toBeNull();
    expect(bad.eligible_debt_usd).toBeNull();
    expect(bad.collateral_at_risk_usd).toBeNull();
    expect(bad.insolvent_positions).toBeNull();
    // The raw bytes carry no "0" in those slots either.
    expect(fixtureBytes(FIXTURE_FILES.bookEngineRefused)).toContain('"total_collateral": null');
  });

  it("the client's own helpers REFUSE to read that null as zero", async () => {
    const book = await client.book();
    const aave = byKey(book.engines, "engine", PINNED.engines.aave);
    // The nullable parser preserves the absence...
    expect(parseNullableDecimal(aave.total_collateral)).toBeNull();
    // ...and the strict one throws rather than substituting 0n.
    expect(() => requireDecimal(aave.total_collateral, "total_collateral")).toThrow(AbsentQuantityError);
  });

  it("keeps the OTHER engine serving normally — a refusal is per engine", async () => {
    const book = await client.book();
    const dm = byKey(book.engines, "engine", PINNED.engines.dm);
    expect(dm.refused).toBe(false);
    expect(dm.refusal).toBeNull();
    expect(dm.total_collateral).toBe(PINNED.dm.collateralUSD);
    expect(byKey(book.bad_debt, "engine", PINNED.engines.dm).current_bad_debt_usd).toBe(PINNED.dm.badDebtAtPar);
  });

  it("does not let a zero refused_count imply a whole book", async () => {
    const book = await client.book();
    const aave = byKey(book.engines, "engine", PINNED.engines.aave);
    // Position counts are all zero because the rewind deleted the rows...
    expect(aave.positions).toBe(0);
    expect(aave.refused_positions).toBe(0);
    // ...and `refused` is what stops that from reading as "nothing at risk".
    expect(aave.refused).toBe(true);
  });
});

// ===========================================================================
// /v1/address
// ===========================================================================

describe("/v1/address serves one address's exact position", () => {
  const path = `/v1/address/${PINNED.accounts.aave}`;
  const { client, mock } = clientFor({ [path]: FIXTURE_FILES.addressAave });

  it("requests the address verbatim and returns its single position", async () => {
    const body = await client.address(PINNED.accounts.aave);
    expect(mock.calls).toEqual([`${BASE}${path}`]);
    expect(body.found).toBe(true);
    expect(body.address).toBe(PINNED.accounts.aave);
    expect(body.positions).toHaveLength(1);
  });

  it("serves the health factor's three legs unaltered", async () => {
    const p = (await client.address(PINNED.accounts.aave)).positions[0] as Position;
    expect(p.engine).toBe(PINNED.engines.aave);
    expect(p.status).toBe("computed");
    expect(p.health_factor?.wad).toBe(PINNED.aave.hfWad);
    expect(p.health_factor?.num).toBe(PINNED.aave.hfNum);
    expect(p.health_factor?.den).toBe(PINNED.aave.hfDen);
    expect(p.total_collateral_base).toBe(PINNED.aave.collateralBase);
    expect(p.total_debt_base).toBe(PINNED.aave.debtBase);
    expect(p.weighted_lt_sum).toBe(PINNED.aave.weightedLTSum);
    expect(p.avg_lt_bps).toBe(PINNED.aave.avgLTBps);
    expect(p.flags).toEqual([PINNED.aave.flag]);
    // Healthy at 1.08, and one 10% ETH step from eligible.
    expect(aaveEligibleFromWad(p.health_factor?.wad ?? null)).toBe(false);
    expect(positionEligible(p)).toBe(false);
  });

  it("carries the batch's durable as-ofs, never a request-time clock", async () => {
    const p = (await client.address(PINNED.accounts.aave)).positions[0] as Position;
    expect(p.as_of.balances_block).toBe(PINNED.blocks.aave);
    expect(p.as_of.params_block).toBe(PINNED.blocks.aaveParam);
    expect(p.as_of.stale_price_inputs).toBe(true);
  });

  it("gives each leg its OWN rate-index as-of block", async () => {
    const p = (await client.address(PINNED.accounts.aave)).positions[0] as Position;
    expect(p.legs).toHaveLength(2);
    const weeth = byKey(p.legs, "asset", PINNED.assets.weethEth);
    expect(weeth.live_collateral).toBe(PINNED.aave.weethAmount);
    expect(weeth.collateral_base).toBe(PINNED.aave.collateralBase);
    expect(weeth.liq_threshold).toBe(PINNED.aave.ltBps);
    expect(weeth.liq_bonus).toBe(PINNED.aave.bonusBps);
    expect(weeth.collateral_index_block).toBe(PINNED.blocks.aave);
    expect(weeth.used_as_collateral).toBe(true);
    const usdc = byKey(p.legs, "asset", PINNED.assets.usdcEth);
    expect(usdc.live_debt).toBe(PINNED.aave.usdcDebt);
    expect(usdc.debt_base).toBe(PINNED.aave.debtBase);
    expect(usdc.used_as_collateral).toBe(false);
  });

  it("discloses every price input the batch PERSISTED, with its own verdict", async () => {
    const p = (await client.address(PINNED.accounts.aave)).positions[0] as Position;
    expect(p.price_inputs).toHaveLength(2);
    const weeth = byKey(p.price_inputs, "asset", PINNED.assets.weethEth);
    expect(weeth.value).toBe(PINNED.aave.weethPrice);
    expect(weeth.decimals).toBe(8);
    expect(weeth.block_number).toBe(PINNED.blocks.aavePrice);
    expect(weeth.provenance).toBe("adapter-output");
    expect(weeth.verdict).toBe("stale");
    expect(weeth.age_seconds).toBe(PINNED.ages.aaveWeETH);
    expect(weeth.budget_seconds).toBe(PINNED.ages.priceBudget);
    expect(weeth.fresh).toBe(false);
    const usdc = byKey(p.price_inputs, "asset", PINNED.assets.usdcEth);
    expect(usdc.value).toBe(PINNED.aave.usdcPrice);
    expect(usdc.fresh).toBe(true);
    expect(usdc.age_seconds).toBe(PINNED.ages.aaveUSDC);
  });

  it("does NOT carry the price that landed after the batch", async () => {
    // LAST-GOOD KEEPS ITS ORIGINAL DISCLOSURE: a newer, wildly different poll for
    // the same witness landed in `prices` after this batch, and /v1/meta reports
    // it. The address surface must serve the batch's own value.
    const raw = fixtureBytes(FIXTURE_FILES.addressAave);
    expect(raw).not.toContain(PINNED.meta.livePriceAfterBatch);
  });

  it("solves the factor-level liquidation price and rounds it conservatively", async () => {
    const p = (await client.address(PINNED.accounts.aave)).positions[0] as Position;
    const lp = p.liquidation_price;
    if (lp === null) throw new Error("the computed Aave position carries a solve");
    expect(lp.in_factor).toBe(true);
    expect(lp.never_liquidatable).toBe(false);
    expect(lp.already_breached).toBe(false);
    expect(lp.boundary_is_healthy).toBe(true);
    expect(lp.prices).toHaveLength(1);
    const price = lp.prices[0];
    expect(price?.asset).toBe(PINNED.assets.weethEth);
    expect(price?.current_price).toBe(PINNED.aave.weethPrice);
    expect(price?.price_floor).toBe(PINNED.aave.priceFloor);
    expect(price?.lowest_healthy_price).toBe(PINNED.aave.lowestHealthyPrice);
    expect(lp.factor_assets).toEqual([PINNED.assets.weethEth]);
    // s* checked by CROSS-MULTIPLICATION so a reduced form passes: it must equal
    // 6e15 / 6.48e15 exactly.
    expect(
      compareRatio(
        parseDecimal(lp.scale_factor_num as string),
        parseDecimal(lp.scale_factor_den as string),
        parseDecimal(PINNED.aave.hfDen),
        parseDecimal(PINNED.aave.weightedLTSum),
      ),
    ).toBe(0);
  });

  it("leaks no other account's rows — per-address isolation", async () => {
    const raw = fixtureBytes(FIXTURE_FILES.addressAave);
    for (const other of [PINNED.accounts.aaveRefused, PINNED.accounts.dm, PINNED.accounts.dmRefused]) {
      expect(raw).not.toContain(other);
    }
    // The Optimism weETH address belongs to the other engine's position.
    expect(raw).not.toContain(PINNED.assets.weethOp);
  });
});

describe("/v1/address serves refusals WITH their reasons", () => {
  it("serves the G1 refusal naming the asset, and no health factor", async () => {
    const path = `/v1/address/${PINNED.accounts.aaveRefused}`;
    const { client } = clientFor({ [path]: FIXTURE_FILES.addressAaveRefused });
    const p = (await client.address(PINNED.accounts.aaveRefused)).positions[0] as Position;
    expect(p.status).toBe("refused");
    expect(p.refusal?.code).toBe(PINNED.aave.refusedRefusalCode);
    expect(p.refusal?.asset).toBe(PINNED.assets.weethEth);
    expect(p.refusal?.note).toContain("never silently dropped");
    // A refused position must not carry a health factor or a solve.
    expect(p.health_factor).toBeNull();
    expect(p.liquidation_price).toBeNull();
    // It still discloses the input that refused it.
    expect(p.price_inputs[0]?.verdict).toBe("missing");
    expect(p.price_inputs[0]?.value).toBeNull();
    // And the client withholds a verdict rather than inventing one.
    expect(positionEligible(p)).toBeNull();
  });

  it("serves the never-swept refusal without a liquidatable verdict", async () => {
    const path = `/v1/address/${PINNED.accounts.dmRefused}`;
    const { client } = clientFor({ [path]: FIXTURE_FILES.addressDMRefused });
    const p = (await client.address(PINNED.accounts.dmRefused)).positions[0] as Position;
    expect(p.refusal?.code).toBe(PINNED.dm.refusedRefusalCode);
    expect(p.refusal?.note).toContain("UNKNOWN size");
    // HF near zero over unknown collateral is a false alarm, so no verdict at all.
    expect(p.liquidatable).toBeNull();
    expect(positionEligible(p)).toBeNull();
    expect(p.borrowings).toBe(PINNED.dm.refusedBorrowings);
  });
});

describe("/v1/address answers found:false with the batch that answered it", () => {
  it("is an ANSWER, not a 404", async () => {
    const path = `/v1/address/${PINNED.accounts.unknown}`;
    const { client } = clientFor({ [path]: FIXTURE_FILES.addressNotFound });
    const body = await client.address(PINNED.accounts.unknown);
    expect(body.found).toBe(false);
    expect(body.positions).toEqual([]);
    // It still says WHICH batch answered.
    expect(body.batch.position_count).toBe(PINNED.batch.positionCount);
  });
});

describe("the Debt Manager position uses its own comparator", () => {
  it("publishes a strict boolean and no health-factor wad", async () => {
    const path = `/v1/address/${PINNED.accounts.dm}`;
    const { client } = clientFor({ [path]: FIXTURE_FILES.addressDM });
    const p = (await client.address(PINNED.accounts.dm)).positions[0] as Position;
    expect(p.value_decimals).toBe(PINNED.dm.valueDecimals);
    expect(p.health_factor?.wad).toBeNull();
    expect(p.health_factor?.num).toBe(PINNED.dm.hfNum);
    expect(p.health_factor?.den).toBe(PINNED.dm.hfDen);
    expect(p.liquidatable).toBe(PINNED.dm.liquidatable);
    expect(p.collateral_value_usd).toBe(PINNED.dm.collateralUSD);
    expect(p.max_borrow_lt).toBe(PINNED.dm.maxBorrowLT);
    expect(p.borrowings).toBe(PINNED.dm.borrowings);
    // Eligibility comes from the boolean, never from the disclosure ratio.
    expect(positionEligible(p)).toBe(true);
    const leg = p.legs[0];
    expect(leg?.amount).toBe(PINNED.dm.weethAmount);
    expect(leg?.value_usd).toBe(PINNED.dm.collateralUSD);
    expect(leg?.max_borrow_contribution).toBe(PINNED.dm.maxBorrowLT);
    expect(leg?.liq_threshold).toBe(PINNED.dm.liqThreshold);
    expect(leg?.liq_bonus).toBe(PINNED.dm.liqBonus);
    // Collateral is sweep-dominated: its as-of is the sweep block, not the price.
    expect(p.as_of.sweep_block).toBe(PINNED.blocks.dmSweep);
  });
});

// ===========================================================================
// /v1/address/{addr}/stress
// ===========================================================================

const scenarioById = (scenarios: readonly Scenario[], id: string): Scenario => byKey(scenarios, "id", id);

describe("/v1/address/{addr}/stress serves the recomputable values", () => {
  it("ETH −30%: 4000 x 70/100 propagates to a 0.756 health factor", async () => {
    const path = `/v1/address/${PINNED.accounts.aave}/stress`;
    const { client } = clientFor({ [path]: FIXTURE_FILES.stressAave });
    const body = await client.addressStress(PINNED.accounts.aave);
    expect(body.scenario_config_version).toBe(PINNED.stress.configVersion);

    const scenario = scenarioById(body.scenarios, PINNED.stress.ethMinus30Id);
    expect(scenario.version).toBe(PINNED.waterfall.scenarioVersion);
    const r = scenario.results[0] as ScenarioResult;
    expect(r.applicable).toBe(true);
    expect(r.before?.health_factor_wad).toBe(PINNED.aave.hfWad);
    expect(r.before?.eligible).toBe(false);
    expect(r.after?.health_factor_wad).toBe(PINNED.aave.shockedHFWad);
    expect(r.after?.collateral_usd).toBe(PINNED.aave.shockedCollateral);
    expect(r.after?.debt_usd).toBe(PINNED.aave.debtBase);
    expect(r.after?.eligible).toBe(true);

    const shock = byKey(r.applied_shocks, "asset", PINNED.assets.weethEth);
    expect(shock.before).toBe(PINNED.aave.weethPrice);
    expect(shock.after).toBe(PINNED.aave.shockedWeethPrice);
    expect(shock.cap_bound).toBe(false);
    expect(shock.snapped).toBe(false);
    // The USDC leg has no propagation row on this axis and is NAMED held flat.
    expect(byKey(r.held_flat, "asset", PINNED.assets.usdcEth).value).toBe(PINNED.aave.usdcPrice);
  });

  it("a market depeg with oracles held moves the health factor by not one wei", async () => {
    const path = `/v1/address/${PINNED.accounts.aave}/stress`;
    const { client } = clientFor({ [path]: FIXTURE_FILES.stressAave });
    const body = await client.addressStress(PINNED.accounts.aave);
    const r = scenarioById(body.scenarios, PINNED.stress.depegId).results[0] as ScenarioResult;
    expect(r.applicable).toBe(true);
    expect(r.after?.health_factor_wad).toBe(PINNED.aave.hfWad);
    expect(r.before?.health_factor_wad).toBe(r.after?.health_factor_wad);
    expect(r.market_realization?.hfs_unchanged).toBe(true);
    expect(r.market_realization?.seizure_model).toBe(PINNED.meta.seizureModel);
    expect(r.applied_shocks).toEqual([]);
  });

  it("says WHY a scenario does not cover an engine rather than omitting the result", async () => {
    const path = `/v1/address/${PINNED.accounts.aave}/stress`;
    const { client } = clientFor({ [path]: FIXTURE_FILES.stressAave });
    const body = await client.addressStress(PINNED.accounts.aave);
    const r = scenarioById(body.scenarios, PINNED.stress.rateId).results[0] as ScenarioResult;
    expect(r.applicable).toBe(false);
    expect(r.reason).toContain(PINNED.stress.rateNotApplicableReason);
    expect(r.before).toBeNull();
    expect(r.after).toBeNull();
  });

  it("labels the rate axis a delta-only PROJECTION starting from the batch's own debt", async () => {
    const path = `/v1/address/${PINNED.accounts.dm}/stress`;
    const { client } = clientFor({ [path]: FIXTURE_FILES.stressDM });
    const body = await client.addressStress(PINNED.accounts.dm);
    const r = scenarioById(body.scenarios, PINNED.stress.rateId).results[0] as ScenarioResult;
    expect(r.applicable).toBe(true);
    const projection = r.projection;
    if (projection === null) throw new Error("the DM rate scenario carries a projection");
    expect(projection.label).toBe(PINNED.stress.projectionLabel);
    expect(projection.basis).toBe(PINNED.stress.projectionBasis);
    expect(projection.prices_held_flat).toBe(true);
    expect(projection.note).toContain("DELTA-ONLY");
    expect(projection.note).toContain("No time-to-liquidatable");
    expect(projection.horizons.length).toBeGreaterThan(0);
    for (const h of projection.horizons) {
      // The projection must start from the batch's own debt.
      expect(h.debt_usd).toBe(PINNED.dm.borrowings);
      // Its own arithmetic must be internally exact (DERIVED, not server-pinned).
      expect(parseDecimal(h.projected_usd) - parseDecimal(h.debt_usd)).toBe(
        parseDecimal(h.additional_interest_usd),
      );
      expect(parseDecimal(h.additional_interest_usd)).toBeGreaterThan(0n);
    }
  });

  it("makes the in-band stable scenario a true no-op on a weETH-only position", async () => {
    const path = `/v1/address/${PINNED.accounts.dm}/stress`;
    const { client } = clientFor({ [path]: FIXTURE_FILES.stressDM });
    const body = await client.addressStress(PINNED.accounts.dm);
    const r = scenarioById(body.scenarios, PINNED.stress.inBandId).results[0] as ScenarioResult;
    expect(r.before?.collateral_usd).toBe(r.after?.collateral_usd);
    expect(r.after?.collateral_usd).toBe(PINNED.dm.collateralUSD);
  });
});

// ===========================================================================
// /v1/observatory
// ===========================================================================

describe("/v1/observatory serves the series and each index's OWN as-of", () => {
  const { client, mock } = clientFor({
    "/v1/observatory": FIXTURE_FILES.observatory,
    "/v1/observatory?limit=5": FIXTURE_FILES.observatory,
  });

  it("carries the per-engine aggregates for the seeded batch", async () => {
    const body = await client.observatory();
    expect(body.series).toHaveLength(1);
    const engines = body.series[0]?.engines ?? [];
    expect(byKey(engines, "engine", PINNED.engines.aave).total_collateral).toBe(PINNED.aave.collateralBase);
    expect(byKey(engines, "engine", PINNED.engines.aave).total_debt).toBe(PINNED.aave.debtBase);
    expect(byKey(engines, "engine", PINNED.engines.dm).total_collateral).toBe(PINNED.dm.collateralUSD);
    expect(byKey(engines, "engine", PINNED.engines.dm).liquidatable_positions).toBe(1);
  });

  it("discloses the rate index's own block, not the balances cursor", async () => {
    const body = await client.observatory();
    expect(body.rate_indexes).toHaveLength(1);
    const index = body.rate_indexes[0];
    expect(index?.value).toBe(PINNED.meta.rateIndexValue);
    expect(index?.as_of_block).toBe(PINNED.blocks.rateIndex);
    expect(index?.kind).toBe("liquidity_index");
    expect(index?.note).toContain("trail the derive cursor");
    // Borrowing the cursor's freshness is the banned one-block stamping.
    expect(index?.as_of_block).not.toBe(PINNED.blocks.aave);
  });

  it("passes a valid limit through and refuses an invalid one before the request", async () => {
    await client.observatory({ limit: 5 });
    expect(mock.calls.at(-1)).toBe(`${BASE}/v1/observatory?limit=5`);
    const before = mock.calls.length;
    for (const limit of [0, -1, 501, 1.5]) {
      await expect(client.observatory({ limit })).rejects.toThrow(/limit must be an integer/);
    }
    expect(mock.calls.length).toBe(before);
  });
});

// ===========================================================================
// /v1/meta
// ===========================================================================

describe("/v1/meta serves the full posture", () => {
  const { client } = clientFor({ "/v1/meta": FIXTURE_FILES.meta });

  it("publishes the service identity, including the seizure model", async () => {
    const meta = await client.meta();
    expect(meta.service.name).toBe(PINNED.meta.serviceName);
    expect(meta.service.scenario_config_version).toBe(PINNED.meta.scenarioConfigVersion);
    expect(meta.service.seizure_model).toBe(PINNED.meta.seizureModel);
    expect(meta.service.algorithm_revision).toBe(PINNED.meta.algorithmRevision);
  });

  it("carries the watermark vector with derivation-coverage provenance", async () => {
    const meta = await client.meta();
    expect(meta.watermark_vector).toHaveLength(PINNED.batch.watermarkCount);
    const aave = byKey(meta.watermark_vector, "engine", PINNED.engines.aave);
    expect(aave.last_block).toBe(PINNED.blocks.aave);
    expect(aave.covered_from_block).toBe(PINNED.blocks.aaveCoveredFrom);
    expect(aave.consumed_by_risk).toBe(true);
  });

  it("publishes all three supersession leg names with a clean posture", async () => {
    const meta = await client.meta();
    expect(meta.reorg_posture.superseded).toBe(false);
    expect([...meta.reorg_posture.leg_names].sort()).toEqual([...PINNED.meta.legNames].sort());
  });

  it("reports the LIVE price state, including a retained quarantine", async () => {
    const meta = await client.meta();
    const weeth = byKey(meta.prices, "asset", PINNED.assets.weethEth);
    // This is /v1/meta's job — and it is why the address surface must serve the
    // batch's own value instead.
    expect(weeth.value).toBe(PINNED.meta.livePriceAfterBatch);
    expect(weeth.valid).toBe(true);
    // A neutralized row is RETAINED, never deleted, and stays visible after a
    // newer valid poll lands above it.
    expect(weeth.quarantined_rows).toBe(PINNED.meta.quarantinedRows);
    expect(weeth.highest_quarantined_block).toBe(PINNED.meta.highestQuarantinedBlock);
    expect(weeth.is_valuation_witness).toBe(true);
    expect(weeth.provenance).toBe("adapter-output");
    expect(weeth.symbol).toBe("weETH");
  });

  it("counts the neutralized backlog and the sweep three-state census", async () => {
    const meta = await client.meta();
    expect(byKey(meta.neutralized_prices, "owner_engine", "prices:poll:1").rows).toBe(PINNED.meta.neutralizedRows);
    const sweep = byKey(meta.sweeps, "engine", PINNED.engines.dm);
    expect(sweep.rows).toBe(PINNED.dm.sweep.rows);
    expect(sweep.never_swept).toBe(PINNED.dm.sweep.neverSwept);
    expect(sweep.failed_since_success).toBe(PINNED.dm.sweep.failedSinceSuccess);
    expect(sweep.success).toBe(PINNED.dm.sweep.success);
    expect(meta.sweep_never_refusals_in_batch).toBe(PINNED.meta.sweepNeverRefusalsInBatch);
  });

  it("grades heartbeat provenance honestly: one verified, one not", async () => {
    const meta = await client.meta();
    expect(meta.heartbeat_provenance).toHaveLength(2);
    const verified = byKey(meta.heartbeat_provenance, "proxy", PINNED.meta.heartbeat.verifiedProxy);
    expect(verified.provenance_grade).toBe("verified");
    expect(verified.heartbeat_seconds).toBe(PINNED.meta.heartbeat.verifiedSeconds);
    expect(verified.grace_seconds).toBe(PINNED.meta.heartbeat.verifiedGrace);
    const unverified = byKey(meta.heartbeat_provenance, "proxy", PINNED.meta.heartbeat.unverifiedProxy);
    expect(unverified.provenance_grade).toBe("published-not-verified");
    expect(unverified.basis).toContain("NOT independently confirmed");
  });

  it("publishes the deployment's constants, with the ceiling at twice the budget", async () => {
    const meta = await client.meta();
    const c = meta.constants;
    expect(c.confirmation_blocks).toBe(PINNED.meta.constants.confirmationBlocks);
    expect(c.price_poll_seconds).toBe(PINNED.meta.constants.pricePollSeconds);
    expect(c.dm_sweep_worst_case_seconds).toBe(PINNED.meta.constants.dmSweepWorstCaseSeconds);
    expect(c.price_budget_seconds).toBe(PINNED.meta.constants.priceBudgetSeconds);
    expect(c.price_ceiling_seconds).toBe(2 * PINNED.meta.constants.priceBudgetSeconds);
    expect(c.dm_sweep_interval_seconds + c.dm_sweep_pass_seconds).toBe(c.dm_sweep_worst_case_seconds);
    expect(meta.disclosures.length).toBeGreaterThanOrEqual(PINNED.meta.minDisclosures);
  });

  it("answers 200 with a null batch when nothing is servable, and says why", async () => {
    const { client: c } = clientFor({ "/v1/meta": FIXTURE_FILES.metaNoBatch });
    const meta = await c.meta();
    expect(meta.batch).toBeNull();
    expect(meta.batch_unavailable_reason).toContain("no complete risk batch");
    // A status surface that goes dark exactly when something is wrong is not a
    // status surface: the watermark vector is still there.
    expect(meta.watermark_vector).toHaveLength(PINNED.batch.watermarkCount);
  });
});
