// The mockup's near-cap account, on the wire: cap $5,012.50, debt $4,822, two
// collateral legs (weETH 2.1 @ $4,000 × 50 %, ETHFI 3,250 @ $1.25 × 20 %).
// Built from the contract fixture's Debt Manager position so every field the
// Inspector does not override is a real example value.
import { lookup, type RefinedPosition } from "@solvent/client";
import { ADDRESS_FOUND } from "../../fixtures/inspector";

const found = lookup(ADDRESS_FOUND);
if (found.outcome !== "found") throw new Error("fixture must be found");
const dm = found.response.positions.find((p) => p.engine === "debt_manager");
const aave = found.response.positions.find((p) => p.engine === "aave_v3_etherfi");
if (dm === undefined || aave === undefined) throw new Error("fixture must carry both engines");
export const DM: RefinedPosition = dm;
export const AAVE: RefinedPosition = aave;

export const WEETH = "0x5A7fACB970D094B6C7FF1df0eA68D99E6e73CBFF";
export const ETHFI = "0xe0080d2F853ecDdbd81A643dC10DA075Df26fD3f";

export function near(overrides: Partial<RefinedPosition> = {}): RefinedPosition {
  const leg = DM.legs[0];
  if (leg === undefined) throw new Error("fixture leg");
  const price = DM.price_inputs[0];
  if (price === undefined) throw new Error("fixture price");
  return {
    ...DM,
    liquidation_verdict: "not-liquidatable",
    borrowings: "4822000000",
    max_borrow_lt: "5012500000",
    collateral_value_usd: "12462500000",
    legs: [
      { ...leg, asset: WEETH, symbol: "weETH", decimals: 18, amount: "2100000000000000000", value_usd: "8400000000", max_borrow_contribution: "4200000000", collateral_use: "counted" },
      { ...leg, asset: ETHFI, symbol: "ETHFI", decimals: 18, amount: "3250000000000000000000", value_usd: "4062500000", max_borrow_contribution: "812500000", collateral_use: "counted" },
    ],
    price_inputs: [
      { ...price, asset: WEETH, value: "4000000000", decimals: 6, age_seconds: 35, budget_seconds: 180, verdict: "fresh", fresh: true },
      { ...price, asset: ETHFI, value: "1250000", decimals: 6, age_seconds: 35, budget_seconds: 180, verdict: "fresh", fresh: true },
    ],
    liquidation_price: {
      in_factor: true,
      never_liquidatable: false,
      scale_factor_num: "4009500000",
      scale_factor_den: "4200000000",
      already_breached: false,
      prices: [{ asset: WEETH, current_price: "4000000000", price_decimals: 6, price_floor: "3818571428", lowest_healthy_price: "3818571429" }],
      factor_assets: [WEETH],
      held_assets: [WEETH, ETHFI],
      boundary_is_healthy: true,
      per_token_floor_omitted: false,
      diagnostic: false,
      axis: "eth_usd",
      note: "",
    },
    ...overrides,
  };
}
