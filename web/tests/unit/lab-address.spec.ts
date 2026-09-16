// The one-address workspace is the Inspector's own reading: its stress rows,
// its decimals, its Cash position as "today". Every state has a sentence; the
// before/after tiles print the Inspector's registers.
import { expect, test } from "@playwright/test";
import { lookup } from "@solvent/client";
import type { AddressReading } from "../../lib/address-lookup";
import { TIER_FALLBACK } from "../../lib/freshnessTiers";
import { deriveInspectorView } from "../../lib/inspector-view";
import { addressWorkspace } from "../../lib/lab-address";
import { DEMO_ADDRESS_NEAR, DEMO_NEAR_ADDR, DEMO_STRESS_NEAR } from "../fixtures/demo";
import { ADDRESS_NOT_FOUND, NOT_FOUND_ADDR } from "../fixtures/inspector";

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
const near = () => view({ lookup: { phase: "ready", value: lookup(DEMO_ADDRESS_NEAR) }, stress: { phase: "ready", value: lookup(DEMO_STRESS_NEAR) } });

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
  // The projection row: no flip within its horizons reads as staying inside the cap, in its own words.
  const proj = addressWorkspace({ address: DEMO_NEAR_ADDR, view: near(), selectedId: "dm_rate_horizon_plus_200bps" });
  expect(proj.selected?.projection).not.toBeNull();
  expect(["ok", "warn", "crit"]).toContain(proj.headline.tone);
});
