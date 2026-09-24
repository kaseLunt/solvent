// One name per scenario, built from its definition.
//
// A single factor shock on an axis this product names is named by that axis and the factor's OWN exact percent
// ("ETH −30%", "ETHFI −50%"), through lib/factor — so a changed definition cannot keep a stale name, and a factor
// whose expansion does not terminate is marked "≈", never rounded. Anything else takes its display name, or the
// wire's label verbatim. A name is display only: the wire's label, id and version remain the scenario's record.
import type { components } from "@solvent/client";
import { formatFactor } from "./factor";
import { isWirePopulation, isWireSignedCount } from "./wireGuard";

type Schemas = components["schemas"];

/** The fields a name and a gist are built from — a listed definition and a per-address scenario both carry them. */
export type NamedScenario = Pick<Schemas["ScenarioDefinition"], "id" | "label" | "description" | "shocks">;

/**
 * The contract's shock axes, by the word a reader knows them by. The asset axis is named per asset; the stable axis
 * and the borrow rate are not named here — a scenario on them takes its display name or its label.
 */
export const AXIS_WORD: Readonly<Record<string, string>> = {
  eth_usd: "ETH",
  weeth_eth_rate: "weETH redemption rate",
};

/**
 * The assets an `asset_usd` shock is named by, keyed by the lower-cased axis-instance address. The BTC key is mainnet
 * WBTC, used only as the BTC/USD axis instance that liquidBTC, eBTC and WBTC-on-OP respond to.
 */
export const ASSET_WORD: Readonly<Record<string, string>> = {
  "0xe0080d2f853ecddbd81a643dc10da075df26fd3f": "ETHFI",
  "0x2260fac5e5542a773aa44fbcfedf7c193bc2c599": "BTC",
};

/** Display names for committed scenarios whose shocks cannot name them. */
export const SCENARIO_NAMES: Readonly<Record<string, string>> = {
  weeth_market_depeg_oracles_held: "weETH depeg to 0.95, oracles held",
  dm_rate_horizon_plus_200bps: "Cash borrow APY +200 bps",
};

/** One line under a name, at most 70 characters, for the scenarios the library leads with. */
export const SCENARIO_GISTS: Readonly<Record<string, string>> = {
  eth_minus_30: "All ETH-linked collateral, instantaneous mark",
  weeth_market_depeg_oracles_held: "Market price 5% under redemption; oracles unchanged",
  dm_rate_horizon_plus_200bps: "Closed-form horizon projection; prices held flat",
  ethfi_minus_50: "Own-ecosystem token shock; sETHFI moves with it",
};

/**
 * The word a shock's axis is known by, or null when this product does not name it. It reads any axis the wire names
 * with its asset — a definition's shock, or the stress grid's `axis` and `axis_asset`.
 */
export function shockWord(shock: { readonly axis: string; readonly asset?: string | null }): string | null {
  if (shock.axis === "asset_usd") return shock.asset == null ? null : ASSET_WORD[shock.asset.toLowerCase()] ?? null;
  return AXIS_WORD[shock.axis] ?? null;
}

/** "ETH −30%" for a single named factor shock; else the display name; else the wire's label verbatim. */
export function scenarioName(def: NamedScenario): string {
  const [shock, ...rest] = def.shocks;
  if (shock !== undefined && rest.length === 0) {
    const word = shockWord(shock);
    // The factor passes the wire's integer guards before any arithmetic: a refused factor names nothing.
    if (word !== null && isWireSignedCount(shock.factor_num) && isWirePopulation(shock.factor_den) && shock.factor_den > 0) {
      return `${word} ${formatFactor(shock.factor_num, shock.factor_den).percent}`;
    }
  }
  return SCENARIO_NAMES[def.id] ?? def.label;
}

/** The scenario's one line: its listed gist, else the first sentence of its own description. */
export function scenarioGist(def: NamedScenario): string {
  const listed = SCENARIO_GISTS[def.id];
  if (listed !== undefined) return listed;
  // A sentence ends at a full stop followed by a space or the end — the point inside "0.95" is not one.
  const end = /\.(?=\s|$)/.exec(def.description);
  return end === null ? def.description : def.description.slice(0, end.index + 1);
}
