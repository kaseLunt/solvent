// The one-address workspace is the Inspector's own reading: its stress rows,
// its decimals, its Cash position as "today". Every state has a sentence; the
// before/after tiles print the Inspector's registers.
import { expect, test } from "@playwright/test";
import { lookup } from "@solvent/client";
import type { AddressReading } from "../../lib/address-lookup";
import { TIER_FALLBACK } from "../../lib/freshnessTiers";
import { deriveInspectorView } from "../../lib/inspector-view";
import { addressWorkspace } from "../../lib/lab-address";
import { DEMO_ADDRESS_NEAR, DEMO_ADDRESS_REFUSED, DEMO_NEAR_ADDR, DEMO_REFUSED_ADDR, DEMO_STRESS_NEAR } from "../fixtures/demo";
import { ADDRESS_NOT_FOUND, ADDRESS_UNKNOWABLE, NOT_FOUND_ADDR, UNKNOWABLE_ADDR } from "../fixtures/inspector";

function reading(overrides: Partial<AddressReading>): AddressReading {
  return {
    address: DEMO_NEAR_ADDR,
    valid: true,
    lookup: { phase: "loading" },
    history: { phase: "loading" },
    stress: { phase: "loading" },
    params: { phase: "loading" },
    evidence: null,
    age: { seconds: null, unresolved: false, refreshFailed: false },
    reload: () => {},
    ...overrides,
  };
}
const view = (overrides: Partial<AddressReading>) => deriveInspectorView(reading(overrides), TIER_FALLBACK);
type StressBody = typeof DEMO_STRESS_NEAR;
type StressResult = StressBody["scenarios"][number]["results"][number];
const nearWith = (stress: StressBody) => view({ lookup: { phase: "ready", value: lookup(DEMO_ADDRESS_NEAR) }, stress: { phase: "ready", value: lookup(stress) } });
const near = () => nearWith(DEMO_STRESS_NEAR);
/** The demo stress body with one scenario's results rewritten. */
function withResult(id: string, edit: (r: StressResult) => StressResult): StressBody {
  return { ...DEMO_STRESS_NEAR, scenarios: DEMO_STRESS_NEAR.scenarios.map((s) => (s.id === id ? { ...s, results: s.results.map(edit) } : s)) };
}
/** The projection row with one horizon's wire verdict replaced; null is the wire's "no verdict for the horizon". */
const projected = (index: number, becomes: boolean | null): StressBody =>
  withResult("dm_rate_horizon_plus_200bps", (r) =>
    !r.projection ? r : { ...r, projection: { ...r.projection, horizons: r.projection.horizons.map((h, i) => (i === index ? { ...h, becomes_liquidatable: becomes } : h)) } },
  );
const PROJECTION_LABEL = "Debt Manager borrow APY +200bps (PROJECTION)";
const PROJECTION_DEK = "Room today $190.50; 30d: +$7.92 interest; 90d: +$23.77 interest.";
const REFUSED = { value: "—", tone: "refused" };
const NOT_COMPUTED = { value: "Not computed", tone: "refused" };

test("idle and invalid: no address is a prompt, a bad address is a refusal; nothing is looked up", () => {
  const idle = addressWorkspace({ address: "", view: null, selectedId: null });
  expect(idle.state).toBe("idle");
  expect(idle.headline).toEqual({ emphasis: "Stress one address.", rest: "", tone: "refused", dek: "Enter an address; the committed scenarios are applied to its Cash position." });
  expect(idle.rows).toEqual([]);
  expect(idle.tiles).toBeNull();
  const invalid = addressWorkspace({ address: "0xnope", view: view({ address: "0xnope", valid: false }), selectedId: null });
  expect(invalid.state).toBe("invalid");
  expect(invalid.headline.emphasis).toBe("Not an address.");
  expect(invalid.headline.dek).toBe("An address is 0x followed by exactly 40 hex characters. Nothing was looked up.");
});

test("loading and unavailable follow the lookup, then the stress lookup", () => {
  const l = addressWorkspace({ address: DEMO_NEAR_ADDR, view: view({}), selectedId: null });
  expect(l.state).toBe("loading");
  expect(l.headline.emphasis).toBe("Looking up 0x7a3f…c21e…");
  const stressLoading = addressWorkspace({ address: DEMO_NEAR_ADDR, view: view({ lookup: { phase: "ready", value: lookup(DEMO_ADDRESS_NEAR) } }), selectedId: null });
  expect(stressLoading.state).toBe("loading");
  expect(stressLoading.headline.emphasis).toBe("Running the committed scenarios for 0x7a3f…c21e…");
  const u = addressWorkspace({ address: DEMO_NEAR_ADDR, view: view({ lookup: { phase: "error", message: "rate limited (429), retry after 30s" } }), selectedId: null });
  expect(u.state).toBe("unavailable");
  expect(u.headline.emphasis).toBe("The lookup for 0x7a3f…c21e could not be completed.");
  expect(u.headline.dek).toBe("Rate limited (429), retry after 30s. Nothing about this address is known from a failed lookup.");
  const su = addressWorkspace({ address: DEMO_NEAR_ADDR, view: view({ lookup: { phase: "ready", value: lookup(DEMO_ADDRESS_NEAR) }, stress: { phase: "error", message: "rate limited (429), retry after 30s" } }), selectedId: null });
  expect(su.state).toBe("unavailable");
  expect(su.headline.emphasis).toBe("The scenarios for 0x7a3f…c21e could not be run.");
});

test("no position and withheld are the stress reading's own words", () => {
  const none = addressWorkspace({
    address: NOT_FOUND_ADDR,
    view: view({ address: NOT_FOUND_ADDR, lookup: { phase: "ready", value: lookup(ADDRESS_NOT_FOUND) }, stress: { phase: "ready", value: lookup({ ...DEMO_STRESS_NEAR, address: NOT_FOUND_ADDR, found: false, scenarios: [] }) } }),
    selectedId: null,
  });
  expect(none.state).toBe("no-position");
  expect(none.headline.emphasis).toBe(`No Cash position for ${NOT_FOUND_ADDR.slice(0, 6)}…${NOT_FOUND_ADDR.slice(-4)} in batch 1.`);
  expect(none.headline.tone).toBe("refused");
  const withheld = addressWorkspace({
    address: DEMO_NEAR_ADDR,
    view: view({
      lookup: { phase: "ready", value: lookup(DEMO_ADDRESS_NEAR) },
      stress: { phase: "ready", value: lookup({ ...DEMO_STRESS_NEAR, found: null, lookup_complete: false, scenarios: [], withheld_engines: [{ engine: "debt_manager", code: "FLAG_CUSTODY_UNPROVEN", detail: "", note: "" }] }) },
    }),
    selectedId: null,
  });
  expect(withheld.state).toBe("withheld");
  expect(withheld.headline.emphasis).toBe("Cannot say — the Cash book is withheld for 0x7a3f…c21e.");
  expect(withheld.cause).not.toBeNull();
});

test("rows: the demo near account under its three scenarios, the selection, the before/after tiles in the Inspector's registers", () => {
  const w = addressWorkspace({ address: DEMO_NEAR_ADDR, view: near(), selectedId: "eth_minus_30" });
  expect(w.state).toBe("rows");
  expect(w.rows.map((r) => r.id)).toEqual(DEMO_STRESS_NEAR.scenarios.map((s) => s.id));
  expect(w.selected?.id).toBe("eth_minus_30");
  expect(w.batchId).toBe(18251);
  expect(w.decimals).toBe(6);
  expect(w.headline.emphasis).toBe("0x7a3f…c21e becomes liquidatable under ETH -30 percent.");
  expect(w.headline.tone).toBe("crit");
  expect(w.headline.dek).toBe("Room today $190.50; after the shock, over cap by $1,069.");
  const t = w.tiles!;
  expect(t.debtBefore).toEqual({ value: "$4,822", tone: "neutral" });
  expect(t.capBefore).toEqual({ value: "$5,012", tone: "neutral" });
  expect(t.roomBefore).toEqual({ value: "$190.50", tone: "warn" });
  expect(t.statusBefore).toEqual({ value: "Near cap", tone: "warn" });
  expect(t.debtAfter.value).toBe("$4,822");
  expect(t.capAfter.value).toBe("$3,752");
  expect(t.roomAfter.value).toMatch(/^over cap by \$/);
  expect(t.roomAfter.tone).toBe("crit");
  expect(t.statusAfter).toEqual({ value: "Liquidatable", tone: "crit" });
  // A selection the address does not carry falls back to the first row; a null selection too.
  expect(addressWorkspace({ address: DEMO_NEAR_ADDR, view: near(), selectedId: "ghost" }).selected?.id).toBe("eth_minus_30");
  expect(addressWorkspace({ address: DEMO_NEAR_ADDR, view: near(), selectedId: null }).selected?.id).toBe("eth_minus_30");
  // The projection row is judged by its horizons, not by its after (the spot): no horizon flips, so the account holds through the longest.
  const proj = addressWorkspace({ address: DEMO_NEAR_ADDR, view: near(), selectedId: "dm_rate_horizon_plus_200bps" });
  expect(proj.selected?.projection).not.toBeNull();
  expect(proj.headline).toEqual({ emphasis: `0x7a3f…c21e stays inside its cap through 90d under ${PROJECTION_LABEL}.`, rest: "", tone: "ok", dek: PROJECTION_DEK });
  // Its after is the spot, which the Inspector reads as near cap: the after status follows the band, and the room beside it carries the same tone.
  expect(proj.tiles?.statusAfter).toEqual({ value: "Near cap", tone: "warn" });
  expect(proj.tiles?.roomAfter).toEqual({ value: "$190.50", tone: "warn" });
});

test("a projection's horizons decide: a liquidatable horizon is named in the warn tone, an unknowable one is a refusal naming it", () => {
  const within = addressWorkspace({ address: DEMO_NEAR_ADDR, view: nearWith(projected(1, true)), selectedId: "dm_rate_horizon_plus_200bps" });
  expect(within.headline).toEqual({ emphasis: `0x7a3f…c21e becomes liquidatable within 90d under ${PROJECTION_LABEL}.`, rest: "", tone: "warn", dek: PROJECTION_DEK });
  const unknown = addressWorkspace({ address: DEMO_NEAR_ADDR, view: nearWith(projected(0, null)), selectedId: "dm_rate_horizon_plus_200bps" });
  expect(unknown.headline).toEqual({
    emphasis: `Cannot say whether 0x7a3f…c21e becomes liquidatable under ${PROJECTION_LABEL}.`,
    rest: "",
    tone: "refused",
    dek: `${PROJECTION_DEK} The 30d horizon carries no verdict.`,
  });
});

test("a refused Cash position prints no before figure; a negative wire figure prints nothing on its side", () => {
  const r = addressWorkspace({
    address: DEMO_REFUSED_ADDR,
    view: view({ address: DEMO_REFUSED_ADDR, lookup: { phase: "ready", value: lookup(DEMO_ADDRESS_REFUSED) }, stress: { phase: "ready", value: lookup(DEMO_STRESS_NEAR) } }),
    selectedId: null,
  });
  expect(r.state).toBe("rows");
  const t = r.tiles;
  if (t === null) throw new Error("a refused position beside rows still has tiles");
  expect(t.debtBefore).toEqual(REFUSED);
  expect(t.capBefore).toEqual(REFUSED);
  expect(t.roomBefore).toEqual(REFUSED);
  expect(t.statusBefore).toEqual(NOT_COMPUTED);
  for (const tile of Object.values(t)) expect(tile.value).not.toContain("$");
  expect(r.headline).toEqual({ emphasis: "ETH -30 percent does not apply to 0x4444…4404.", rest: "", tone: "refused", dek: "Not evaluated for this account." });
  const negative = addressWorkspace({
    address: DEMO_NEAR_ADDR,
    view: nearWith(withResult("eth_minus_30", (x) => (!x.after ? x : { ...x, after: { ...x.after, debt_usd: "-4822000000" } }))),
    selectedId: "eth_minus_30",
  });
  expect(negative.tiles?.debtBefore).toEqual({ value: "$4,822", tone: "neutral" });
  expect(negative.tiles?.debtAfter).toEqual(REFUSED);
  expect(negative.tiles?.capAfter).toEqual(REFUSED);
  expect(negative.tiles?.roomAfter).toEqual(REFUSED);
  expect(negative.tiles?.statusAfter).toEqual(NOT_COMPUTED);
  // The reader's flip still reads true from the wire's booleans; the headline refuses it, as the tiles do, because the figures are not a position.
  expect(negative.headline).toEqual({
    emphasis: "Cannot say whether 0x7a3f…c21e becomes liquidatable under ETH -30 percent.",
    rest: "",
    tone: "refused",
    dek: "Room today $190.50; after the shock, not computed. The shocked figures are not a position.",
  });
});

test("an unknowable after verdict refuses its figures beside Not computed, and the headline is a cannot-say", () => {
  const u = addressWorkspace({
    address: DEMO_NEAR_ADDR,
    view: nearWith(withResult("eth_minus_30", (x) => (!x.after ? x : { ...x, after: { ...x.after, liquidatable: null } }))),
    selectedId: "eth_minus_30",
  });
  expect(u.selected?.after?.verdict).toBe("unknowable");
  expect(u.tiles?.debtBefore).toEqual({ value: "$4,822", tone: "neutral" });
  expect(u.tiles?.debtAfter).toEqual(REFUSED);
  expect(u.tiles?.capAfter).toEqual(REFUSED);
  expect(u.tiles?.roomAfter).toEqual(REFUSED);
  expect(u.tiles?.statusAfter).toEqual(NOT_COMPUTED);
  // The dek uses the tiles' own word for the unknowable side: no room figure prints beside a refused register.
  expect(u.headline).toEqual({
    emphasis: "Cannot say whether 0x7a3f…c21e becomes liquidatable under ETH -30 percent.",
    rest: "",
    tone: "refused",
    dek: "Room today $190.50; after the shock, not computed. One side of the comparison is withheld or unknowable.",
  });
  expect(u.headline.dek).toContain("not computed");
  expect(u.headline.dek).not.toContain("over cap by");
});

test("a projection over an uncomputable spot yields no verdict word: the horizons are not consulted", () => {
  const spot = (patch: Partial<NonNullable<StressResult["after"]>>) =>
    nearWith(withResult("dm_rate_horizon_plus_200bps", (x) => (!x.after ? x : { ...x, after: { ...x.after, ...patch } })));
  const negative = addressWorkspace({ address: DEMO_NEAR_ADDR, view: spot({ debt_usd: "-4822000000" }), selectedId: "dm_rate_horizon_plus_200bps" });
  expect(negative.selected?.projection).not.toBeNull();
  expect(negative.headline).toEqual({
    emphasis: `Cannot say whether 0x7a3f…c21e becomes liquidatable under ${PROJECTION_LABEL}.`,
    rest: "",
    tone: "refused",
    dek: "Room today $190.50; after the shock, not computed. The shocked figures are not a position.",
  });
  expect(negative.tiles?.statusAfter).toEqual(NOT_COMPUTED);
  expect(negative.tiles?.roomAfter).toEqual(REFUSED);
  // The same gate for an unknowable spot verdict, in its own words.
  const unknown = addressWorkspace({ address: DEMO_NEAR_ADDR, view: spot({ liquidatable: null }), selectedId: "dm_rate_horizon_plus_200bps" });
  expect(unknown.headline).toEqual({
    emphasis: `Cannot say whether 0x7a3f…c21e becomes liquidatable under ${PROJECTION_LABEL}.`,
    rest: "",
    tone: "refused",
    dek: "Room today $190.50; after the shock, not computed. One side of the comparison is withheld or unknowable.",
  });
  expect(unknown.tiles?.statusAfter).toEqual(NOT_COMPUTED);
});

test("rows beside a withheld Cash book are a cannot-say, never a negative", () => {
  const readdressed = {
    ...DEMO_STRESS_NEAR,
    address: UNKNOWABLE_ADDR,
    scenarios: DEMO_STRESS_NEAR.scenarios.map((s) => ({ ...s, results: s.results.map((r) => ({ ...r, account: UNKNOWABLE_ADDR })) })),
  };
  const w = addressWorkspace({
    address: UNKNOWABLE_ADDR,
    view: view({ address: UNKNOWABLE_ADDR, lookup: { phase: "ready", value: lookup(ADDRESS_UNKNOWABLE) }, stress: { phase: "ready", value: lookup(readdressed) } }),
    selectedId: "eth_minus_30",
  });
  expect(w.state).toBe("rows");
  expect(w.rows).toHaveLength(3);
  expect(w.selected?.applicable).toBe(true);
  expect(w.tiles).toBeNull();
  expect(w.headline).toEqual({
    emphasis: `Cannot say — the Cash book is withheld for ${UNKNOWABLE_ADDR.slice(0, 6)}…${UNKNOWABLE_ADDR.slice(-4)}.`,
    rest: "",
    tone: "refused",
    dek: "The stress response carries scenarios while the lookup's Cash book is withheld — the two answers disagree.",
  });
  expect(`${w.headline.emphasis} ${w.headline.dek}`).not.toContain("No Cash position");
});

test("rows beside no readable position: an unreadable scale and a missing Cash position each say so, never the scenarios' sentence", () => {
  const unreadable = { ...DEMO_ADDRESS_NEAR, positions: DEMO_ADDRESS_NEAR.positions.map((p) => ({ ...p, value_decimals: 1.5 })) };
  const scale = addressWorkspace({
    address: DEMO_NEAR_ADDR,
    view: view({ lookup: { phase: "ready", value: lookup(unreadable) }, stress: { phase: "ready", value: lookup(DEMO_STRESS_NEAR) } }),
    selectedId: "eth_minus_30",
  });
  expect(scale.state).toBe("rows");
  expect(scale.selected?.id).toBe("eth_minus_30");
  expect(scale.tiles).toBeNull();
  expect(scale.decimals).toBeNull();
  expect(scale.headline).toEqual({ emphasis: "The Cash position's scale could not be read.", rest: "", tone: "refused", dek: "No figure prints at an unreadable scale." });
  const short = `${NOT_FOUND_ADDR.slice(0, 6)}…${NOT_FOUND_ADDR.slice(-4)}`;
  const missing = addressWorkspace({
    address: NOT_FOUND_ADDR,
    view: view({ address: NOT_FOUND_ADDR, lookup: { phase: "ready", value: lookup(ADDRESS_NOT_FOUND) }, stress: { phase: "ready", value: lookup({ ...DEMO_STRESS_NEAR, address: NOT_FOUND_ADDR }) } }),
    selectedId: null,
  });
  expect(missing.state).toBe("rows");
  expect(missing.tiles).toBeNull();
  expect(missing.headline).toEqual({
    emphasis: `No Cash position for ${short} to stress.`,
    rest: "",
    tone: "refused",
    dek: "The stress response carries scenarios, but the lookup found no Cash position — the two answers disagree.",
  });
});
