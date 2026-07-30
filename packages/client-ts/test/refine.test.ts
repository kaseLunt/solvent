// Round-3 review fix (H1): the VERDICT CLASS is sealed, not just `found`.
//
// Round 2 sealed the three-valued `found` behind the `outcome` union. Round 3
// observed that the SAME CLASS — a nullable boolean whose `null` means THE
// VERDICT IS WITHHELD — survived on every other exported surface:
//
//   Position.liquidatable                 boolean | null   (null: withheld, or Aave)
//   StressState.liquidatable              boolean | null   (null: Aave)
//   ProjectionHorizon.becomes_liquidatable boolean | null
//   Leg.used_as_collateral                boolean | null   (null: engine publishes none)
//   positionEligible()                    -> boolean | null
//   aaveEligibleFromWad()                 -> boolean | null
//
// Under any of them, `if (!verdict) renderSafe()` compiles and labels a
// withheld liquidation verdict definitively safe. This suite pins the fix the
// same way the round-2 suite pinned `found`:
//
//   - the field-mapping law is TOTAL (null -> "unknowable", never a definitive
//     token),
//   - the PRIMARY paths (`address()` / `addressStress()`) serve REFINED shapes
//     whose raw nullable-boolean fields are ABSENT at the type level AND at
//     runtime,
//   - the reviewer's exact trap lines no longer compile (@ts-expect-error
//     directives are PERMANENT enforcement: if a raw field or a
//     nullable-boolean helper ever returns, the directive goes unused and
//     `npm run typecheck` fails),
//   - the unrefined wire values remain ONLY on `addressRaw()` /
//     `addressStressRaw()`.

import { describe, expect, it } from "vitest";

import {
  ContractInvariantError,
  SolventClient,
  aaveVerdictFromWad,
  collateralUse,
  liquidationVerdict,
  lookup,
  positionVerdict,
  refineLeg,
  refinePosition,
  refineProjectionHorizon,
  refineScenario,
  refineStressState,
} from "../src/index.js";
import type {
  LookupBearing,
  Position,
  RefinedLeg,
  RefinedPosition,
  RefinedProjectionHorizon,
  RefinedScenarioResult,
  RefinedStressState,
  StressLookup,
} from "../src/index.js";
import { FIXTURE_FILES, fixtureBytes, PINNED } from "./fixtures/index.js";
import * as fixtures from "./fixtures/index.js";
import { mockFetch } from "./helpers/mock-fetch.js";

const BASE = "http://localhost:8080";

function clientFor(path: string, file: string) {
  const mock = mockFetch({ [path]: { body: fixtureBytes(file) } });
  return new SolventClient({ baseUrl: BASE, fetch: mock.fetch });
}

/** The one Aave position of `address-aave.json`, as the wire carries it. */
const rawAavePosition = fixtures.addressAave.positions[0] as Position;
/** The one Debt Manager position of `address-dm.json`. */
const rawDMPosition = fixtures.addressDM.positions[0] as Position;

const scenarioOf = (result: StressLookup, id: string) => {
  const scenario = result.response.scenarios.find((s) => s.id === id);
  if (scenario === undefined) throw new Error(`no scenario ${id}`);
  return scenario;
};

// ---------------------------------------------------------------------------
// The field-mapping law: one total function, null -> "unknowable".
// ---------------------------------------------------------------------------

describe("the verdict mapping is TOTAL over the contract's domain", () => {
  it("maps each of the three wire values to exactly one token", () => {
    expect(liquidationVerdict(true)).toBe("liquidatable");
    expect(liquidationVerdict(false)).toBe("not-liquidatable");
    expect(liquidationVerdict(null)).toBe("unknowable");
    expect(collateralUse(true)).toBe("counted");
    expect(collateralUse(false)).toBe("not-counted");
    expect(collateralUse(null)).toBe("unknowable");
  });

  it("refuses a contract-impossible value rather than guessing", () => {
    // NOT a lazy default: every value the contract admits is mapped above.
    // Only a value outside `boolean | null` — which the contract forbids —
    // refuses.
    expect(() => liquidationVerdict("yes" as unknown as boolean)).toThrow(ContractInvariantError);
    expect(() => collateralUse(1 as unknown as boolean)).toThrow(ContractInvariantError);
  });

  it("a WITHHELD verdict refines to 'unknowable', NEVER to a definitive token", () => {
    // The conflation round 3 flagged, asserted dead at the mapping itself: the
    // Aave position's wire `liquidatable` is null (the engine publishes a
    // health factor, not a strict boolean) and the refused DM position's is
    // null because the service withheld a verdict. Neither may read "safe".
    expect(liquidationVerdict(null)).not.toBe("not-liquidatable");
    expect(refinePosition(rawAavePosition).liquidation_verdict).toBe("unknowable");
    const refusedDM = fixtures.addressDMRefused.positions[0] as Position;
    expect(refinePosition(refusedDM).liquidation_verdict).toBe("unknowable");
    expect(refinePosition(refusedDM).liquidation_verdict).not.toBe("not-liquidatable");
  });
});

// ---------------------------------------------------------------------------
// The refined shapes: sealed field present, raw field ABSENT (type + runtime).
// ---------------------------------------------------------------------------

describe("each refined type seals its raw field separately", () => {
  it("RefinedPosition: `liquidatable` is gone; `liquidation_verdict` is sealed", () => {
    const p: RefinedPosition = refinePosition(rawDMPosition);
    expect(p.liquidation_verdict).toBe("liquidatable");
    // @ts-expect-error — the raw nullable-boolean `liquidatable` does not
    // exist on the refined position: `if (!position.liquidatable)` cannot
    // compile against the primary surface.
    expect(p.liquidatable).toBeUndefined();
    expect(Object.hasOwn(p, "liquidatable")).toBe(false);
    expect(Object.hasOwn(p, "liquidation_verdict")).toBe(true);
  });

  it("RefinedStressState: `liquidatable` is gone; `eligible` survives untouched", () => {
    const scenario = fixtures.stressDM.scenarios.find((s) => s.id === PINNED.stress.inBandId);
    const before = scenario?.results[0]?.before;
    if (before === undefined || before === null) throw new Error("fixture carries a before state");
    const s: RefinedStressState = refineStressState(before);
    expect(s.liquidation_verdict).toBe("liquidatable");
    // @ts-expect-error — no raw `liquidatable` on the refined stress state.
    expect(s.liquidatable).toBeUndefined();
    expect(Object.hasOwn(s, "liquidatable")).toBe(false);
    // `eligible` is a TOTAL boolean on the wire — false genuinely means "not
    // eligible" — so it is not in the class and passes through unrefined.
    expect(s.eligible).toBe(true);
  });

  it("RefinedProjectionHorizon: `becomes_liquidatable` is gone", () => {
    const scenario = fixtures.stressDM.scenarios.find((s) => s.id === PINNED.stress.rateId);
    const horizon = scenario?.results[0]?.projection?.horizons[0];
    if (horizon === undefined) throw new Error("fixture carries a projection horizon");
    const h: RefinedProjectionHorizon = refineProjectionHorizon(horizon);
    expect(h.liquidation_verdict).toBe("liquidatable");
    // @ts-expect-error — no raw `becomes_liquidatable` on the refined horizon.
    expect(h.becomes_liquidatable).toBeUndefined();
    expect(Object.hasOwn(h, "becomes_liquidatable")).toBe(false);
  });

  it("RefinedLeg: `used_as_collateral` is gone; `collateral_use` is sealed", () => {
    const weeth = rawAavePosition.legs.find((l) => l.asset === PINNED.assets.weethEth);
    if (weeth === undefined) throw new Error("fixture carries the weETH leg");
    const l: RefinedLeg = refineLeg(weeth);
    expect(l.collateral_use).toBe("counted");
    // @ts-expect-error — no raw `used_as_collateral` on the refined leg.
    expect(l.used_as_collateral).toBeUndefined();
    expect(Object.hasOwn(l, "used_as_collateral")).toBe(false);
    // The Debt Manager publishes NO collateral-usage statement: null, not false.
    const dmLeg = rawDMPosition.legs[0];
    if (dmLeg === undefined) throw new Error("fixture carries a DM leg");
    expect(refineLeg(dmLeg).collateral_use).toBe("unknowable");
  });

  it("refinement changes NOTHING else: every non-verdict field survives byte-identical", () => {
    const refined = refinePosition(rawAavePosition);
    const { liquidatable, legs, ...rawRest } = rawAavePosition;
    const { liquidation_verdict, legs: refinedLegs, ...refinedRest } = refined;
    expect(liquidation_verdict).toBe(liquidationVerdict(liquidatable));
    expect(refinedRest).toEqual(rawRest);
    expect(refinedLegs).toHaveLength(legs.length);
    for (const [i, leg] of legs.entries()) {
      const { used_as_collateral, ...rawLeg } = leg;
      const refinedLeg = refinedLegs[i];
      if (refinedLeg === undefined) throw new Error("leg count mismatch");
      const { collateral_use, ...restLeg } = refinedLeg;
      expect(collateral_use).toBe(collateralUse(used_as_collateral));
      expect(restLeg).toEqual(rawLeg);
    }
  });
});

// ---------------------------------------------------------------------------
// The PRIMARY paths serve the refined shapes.
// ---------------------------------------------------------------------------

describe("the PRIMARY address path serves REFINED positions (round-3 H1)", () => {
  it("address(): the DM strict boolean arrives as a sealed verdict", async () => {
    const path = `/v1/address/${PINNED.accounts.dm}`;
    const result = await clientFor(path, FIXTURE_FILES.addressDM).address(PINNED.accounts.dm);
    const p = result.response.positions[0];
    if (p === undefined) throw new Error("fixture carries one position");
    expect(p.liquidation_verdict).toBe("liquidatable");
    // @ts-expect-error — the primary path exposes no raw `liquidatable`:
    // this is the direct surface round 3 showed the helper fix alone could
    // not close.
    expect(p.liquidatable).toBeUndefined();
    expect(Object.hasOwn(p, "liquidatable")).toBe(false);
  });

  it("address(): the withheld Aave verdict arrives as 'unknowable', legs sealed too", async () => {
    const path = `/v1/address/${PINNED.accounts.aave}`;
    const result = await clientFor(path, FIXTURE_FILES.addressAave).address(PINNED.accounts.aave);
    const p = result.response.positions[0];
    if (p === undefined) throw new Error("fixture carries one position");
    expect(p.liquidation_verdict).toBe("unknowable");
    const weeth = p.legs.find((l) => l.asset === PINNED.assets.weethEth);
    const usdc = p.legs.find((l) => l.asset === PINNED.assets.usdcEth);
    expect(weeth?.collateral_use).toBe("counted");
    expect(usdc?.collateral_use).toBe("not-counted");
    if (weeth === undefined) throw new Error("fixture carries the weETH leg");
    // @ts-expect-error — no raw `used_as_collateral` through the primary path.
    expect(weeth.used_as_collateral).toBeUndefined();
    expect(Object.hasOwn(weeth, "used_as_collateral")).toBe(false);
    // The wave-2 seal holds beside the new one.
    expect(Object.hasOwn(result.response, "found")).toBe(false);
  });

  it("no refined position or leg carries a raw verdict key at RUNTIME, on any fixture", async () => {
    for (const [account, file] of [
      [PINNED.accounts.aave, FIXTURE_FILES.addressAave],
      [PINNED.accounts.aaveRefused, FIXTURE_FILES.addressAaveRefused],
      [PINNED.accounts.dm, FIXTURE_FILES.addressDM],
      [PINNED.accounts.dmRefused, FIXTURE_FILES.addressDMRefused],
      [PINNED.accounts.aave, FIXTURE_FILES.addressPartial],
    ] as const) {
      const result = await clientFor(`/v1/address/${account}`, file).address(account);
      for (const p of result.response.positions) {
        expect(Object.hasOwn(p, "liquidatable")).toBe(false);
        expect(Object.hasOwn(p, "liquidation_verdict")).toBe(true);
        for (const leg of p.legs) {
          expect(Object.hasOwn(leg, "used_as_collateral")).toBe(false);
          expect(Object.hasOwn(leg, "collateral_use")).toBe(true);
        }
      }
    }
  });
});

describe("the PRIMARY stress path serves REFINED states and horizons (round-3 H1)", () => {
  const stressPath = `/v1/address/${PINNED.accounts.dm}/stress`;

  it("addressStress(): states and horizons carry sealed verdicts", async () => {
    const result = await clientFor(stressPath, FIXTURE_FILES.stressDM).addressStress(PINNED.accounts.dm);
    const r = scenarioOf(result, PINNED.stress.rateId).results[0];
    if (r === undefined) throw new Error("fixture carries a result");
    const before = r.before;
    if (before === null) throw new Error("fixture carries a before state");
    expect(before.liquidation_verdict).toBe("liquidatable");
    // @ts-expect-error — no raw `liquidatable` on the primary stress path.
    expect(before.liquidatable).toBeUndefined();
    expect(Object.hasOwn(before, "liquidatable")).toBe(false);
    const horizon = r.projection?.horizons[0];
    if (horizon === undefined) throw new Error("fixture carries a horizon");
    expect(horizon.liquidation_verdict).toBe("liquidatable");
    expect(Object.hasOwn(horizon, "becomes_liquidatable")).toBe(false);
  });

  it("an Aave stress state is 'unknowable' on the strict boolean while `eligible` still answers", async () => {
    const path = `/v1/address/${PINNED.accounts.aave}/stress`;
    const result = await clientFor(path, FIXTURE_FILES.stressAave).addressStress(PINNED.accounts.aave);
    const r: RefinedScenarioResult | undefined = scenarioOf(result, PINNED.stress.ethMinus30Id).results[0];
    if (r === undefined) throw new Error("fixture carries a result");
    // Aave publishes no strict boolean, so the FIELD's verdict is unknowable...
    expect(r.before?.liquidation_verdict).toBe("unknowable");
    expect(r.after?.liquidation_verdict).toBe("unknowable");
    // ...and the total `eligible` — each engine's own comparator, computed
    // server-side — still carries the definitive answer, untouched.
    expect(r.before?.eligible).toBe(false);
    expect(r.after?.eligible).toBe(true);
  });

  it("no refined stress state or horizon carries a raw verdict key at RUNTIME", async () => {
    for (const [account, file] of [
      [PINNED.accounts.aave, FIXTURE_FILES.stressAave],
      [PINNED.accounts.dm, FIXTURE_FILES.stressDM],
    ] as const) {
      const result = await clientFor(`/v1/address/${account}/stress`, file).addressStress(account);
      for (const scenario of result.response.scenarios) {
        for (const r of scenario.results) {
          for (const state of [r.before, r.after]) {
            if (state === null) continue;
            expect(Object.hasOwn(state, "liquidatable")).toBe(false);
            expect(Object.hasOwn(state, "liquidation_verdict")).toBe(true);
          }
          for (const horizon of r.projection?.horizons ?? []) {
            expect(Object.hasOwn(horizon, "becomes_liquidatable")).toBe(false);
            expect(Object.hasOwn(horizon, "liquidation_verdict")).toBe(true);
          }
        }
      }
    }
  });

  it("a body with neither positions nor scenarios passes through lookup() unrefined", () => {
    const bearing: LookupBearing = {
      found: true,
      lookup_complete: true,
      withheld_engines: [],
      lookup_complete_note: "n",
    };
    const result = lookup(bearing);
    expect(result.outcome).toBe("found");
    expect(result.response).toEqual({
      lookup_complete: true,
      withheld_engines: [],
      lookup_complete_note: "n",
    });
  });
});

// ---------------------------------------------------------------------------
// The reviewer's exact traps, closed at the type level.
// ---------------------------------------------------------------------------

describe("the round-3 trap lines no longer compile (PERMANENT)", () => {
  it("`if (!positionEligible(position))` names NOTHING in this package any more", () => {
    // The reviewer's exact consumer line. The nullable-boolean helper is
    // REMOVED, not renamed-but-kept: no helper under any name returns
    // `boolean | null` for a liquidation verdict, so the falsiness read has
    // nothing to call. (The lambda is never invoked; the pin is the compile
    // error the directive consumes.)
    const reviewerTrap = (position: Position): string => {
      // @ts-expect-error — `positionEligible` is gone. Its successor
      // `positionVerdict` returns a sealed non-empty string-literal union,
      // on which `!` is dead code by construction.
      if (!positionEligible(position)) return "safe";
      return "at risk";
    };
    expect(reviewerTrap).toBeInstanceOf(Function);
  });

  it("`if (!horizon.becomes_liquidatable)` does not compile on a PRIMARY-path horizon", async () => {
    const result = await clientFor(`/v1/address/${PINNED.accounts.dm}/stress`, FIXTURE_FILES.stressDM)
      .addressStress(PINNED.accounts.dm);
    const horizon = scenarioOf(result, PINNED.stress.rateId).results[0]?.projection?.horizons[0];
    if (horizon === undefined) throw new Error("fixture carries a horizon");
    let rendered = "";
    // @ts-expect-error — the reviewer's exact line: were the field present,
    // the runtime WOULD take this branch (asserted below, via the absent
    // property reading `undefined`) — on a horizon whose verdict is
    // `liquidatable`. That false "safe" is why the field cannot exist.
    if (!horizon.becomes_liquidatable) rendered = "never becomes liquidatable";
    expect(rendered).toBe("never becomes liquidatable"); // the branch a compiling `!` takes
    expect(horizon.liquidation_verdict).toBe("liquidatable"); // on the OPPOSITE truth
  });

  it("no helper returns a nullable boolean under any name", () => {
    // PERMANENT m-pins: if either helper regrows `boolean | null`, the
    // directive on its line goes unused and `npm run typecheck` fails.
    // @ts-expect-error — aaveVerdictFromWad returns the sealed verdict union,
    // which is NOT assignable to the old `boolean | null` shape.
    const relapseAave: boolean | null = aaveVerdictFromWad(PINNED.aave.hfWad);
    // @ts-expect-error — positionVerdict likewise.
    const relapsePosition: boolean | null = positionVerdict(rawDMPosition);
    // @ts-expect-error — and a sealed verdict cannot even be COMPARED with a
    // boolean: the types have no overlap.
    const comparedWithFalse = positionVerdict(rawDMPosition) === false;
    expect([relapseAave, relapsePosition, comparedWithFalse]).toHaveLength(3);
  });
});

// ---------------------------------------------------------------------------
// The successors: same comparators, sealed vocabulary.
// ---------------------------------------------------------------------------

describe("positionVerdict() uses each engine's OWN comparator", () => {
  it("agrees between the RAW wire position and its refined image, on every fixture", () => {
    for (const body of [
      fixtures.addressAave,
      fixtures.addressAaveRefused,
      fixtures.addressDM,
      fixtures.addressDMRefused,
      fixtures.addressPartial,
    ]) {
      for (const raw of body.positions) {
        expect(positionVerdict(refinePosition(raw as Position))).toBe(positionVerdict(raw as Position));
      }
    }
  });

  it("answers the four seeded cases with the sealed tokens", () => {
    expect(positionVerdict(rawAavePosition)).toBe("not-liquidatable"); // HF 1.08, healthy
    expect(positionVerdict(rawDMPosition)).toBe("liquidatable"); // the strict boolean
    expect(positionVerdict(fixtures.addressAaveRefused.positions[0] as Position)).toBe("unknowable");
    expect(positionVerdict(fixtures.addressDMRefused.positions[0] as Position)).toBe("unknowable");
  });
});

// ---------------------------------------------------------------------------
// The raw surface keeps the wire truth, exactly as served.
// ---------------------------------------------------------------------------

describe("unrefined wire values remain ONLY on the accessors named raw", () => {
  it("addressRaw() still carries the nullable booleans, unrewritten", async () => {
    const path = `/v1/address/${PINNED.accounts.dm}`;
    const body = await clientFor(path, FIXTURE_FILES.addressDM).addressRaw(PINNED.accounts.dm);
    const p = body.positions[0];
    if (p === undefined) throw new Error("fixture carries one position");
    expect(p.liquidatable).toBe(PINNED.dm.liquidatable);
    expect(Object.hasOwn(p, "liquidatable")).toBe(true);
    expect(Object.hasOwn(p, "liquidation_verdict")).toBe(false);
    expect(p.legs[0]?.used_as_collateral).toBeNull();
    // The raw bytes say so too — nothing in the client rewrote them.
    expect(fixtureBytes(FIXTURE_FILES.addressDM)).toContain('"liquidatable": true');
    expect(fixtureBytes(FIXTURE_FILES.addressDM)).toContain('"used_as_collateral": null');
  });

  it("addressStressRaw() still carries `liquidatable` and `becomes_liquidatable`", async () => {
    const path = `/v1/address/${PINNED.accounts.dm}/stress`;
    const body = await clientFor(path, FIXTURE_FILES.stressDM).addressStressRaw(PINNED.accounts.dm);
    const r = body.scenarios.find((s) => s.id === PINNED.stress.rateId)?.results[0];
    expect(r?.before?.liquidatable).toBe(true);
    expect(r?.projection?.horizons[0]?.becomes_liquidatable).toBe(true);
    const state = r?.before;
    if (state === undefined || state === null) throw new Error("fixture carries a before state");
    expect(Object.hasOwn(state, "liquidatable")).toBe(true);
    expect(Object.hasOwn(state, "liquidation_verdict")).toBe(false);
  });

  it("refineScenario() is the SAME law a consumer can apply to a raw body", () => {
    // A consumer holding a raw stress body (forensics, persistence) can refine
    // it after the fact and land on exactly the primary path's shape.
    const scenario = fixtures.stressDM.scenarios.find((s) => s.id === PINNED.stress.rateId);
    if (scenario === undefined) throw new Error("fixture carries the rate scenario");
    const refined = refineScenario(scenario);
    expect(refined.results[0]?.projection?.horizons[0]?.liquidation_verdict).toBe("liquidatable");
    expect(Object.hasOwn(refined.results[0] ?? {}, "before")).toBe(true);
  });
});
