// The one-address workspace is the Inspector's own reading: its stress rows,
// its decimals, its Cash position as "today". Every state has a sentence; the
// before/after tiles print the Inspector's registers.
import { expect, test } from "@playwright/test";
import { lookup, type components } from "@solvent/client";
import type { AddressReading } from "../../lib/address-lookup";
import { rowVerdict, sideRoomWords, stressVerdictWords, type StressRow } from "../../lib/address-stress";
import { TIER_FALLBACK } from "../../lib/freshnessTiers";
import { deriveInspectorView, stressBatchNote } from "../../lib/inspector-view";
import * as labAddress from "../../lib/lab-address";
import { addressWorkspace, rowOutcome } from "../../lib/lab-address";
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
    evidencePhase: "pending",
    age: { seconds: null, unresolved: false, refreshFailed: false },
    reload: () => {},
    lookupRepaired: false,
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
type Position = components["schemas"]["Position"];
/** A demo lookup with its Cash row rewritten; every other row is served as it was. */
const cashRowEdited = (body: typeof DEMO_ADDRESS_NEAR, edit: (p: Position) => Position): typeof DEMO_ADDRESS_NEAR => ({
  ...body,
  positions: body.positions.map((p) => (p.engine === "debt_manager" ? edit(p) : p)),
});
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
  // The negative is the stress response's, so the batch it names is that response's own (18,251) — never the lookup's (1).
  expect(none.headline.emphasis).toBe(`No Cash position for ${NOT_FOUND_ADDR.slice(0, 6)}…${NOT_FOUND_ADDR.slice(-4)} in batch 18,251.`);
  expect(none.headline.dek).toBe("That is the stress response's own answer, for its own batch; the lookup above is batch 1 and holds no Cash position either.");
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

test("a refused or verdictless Cash row that still carries a debt prints no before figure: the status decides, never the debt's presence", () => {
  // A refused row may keep a persisted debt on the wire (a failed sweep does); the before tiles refuse it all the same.
  const refusedWithDebt = cashRowEdited(DEMO_ADDRESS_REFUSED, (p) => ({
    ...p,
    refusal: { code: "SWEEP_FAILED", detail: "the sweep failed", note: "" },
    total_debt_base: "4100000000",
    borrowings: "4100000000",
  }));
  const refusedView = view({ address: DEMO_REFUSED_ADDR, lookup: { phase: "ready", value: lookup(refusedWithDebt) }, stress: { phase: "ready", value: lookup(DEMO_STRESS_NEAR) } });
  expect(refusedView.refusedTiles).toBe(true);
  expect(refusedView.cash?.debt).toBe(4_100_000_000n);
  const r = addressWorkspace({ address: DEMO_REFUSED_ADDR, view: refusedView, selectedId: null });
  expect(r.state).toBe("rows");
  if (r.tiles === null) throw new Error("a refused position beside rows still has tiles");
  expect(r.tiles.debtBefore).toEqual(REFUSED);
  expect(r.tiles.capBefore).toEqual(REFUSED);
  expect(r.tiles.roomBefore).toEqual(REFUSED);
  expect(r.tiles.statusBefore).toEqual(NOT_COMPUTED);
  for (const tile of Object.values(r.tiles)) expect(tile.value).not.toContain("$");
  // A computed row with no verdict carries a readable debt and cap; beside "Not computed" neither prints.
  const verdictless = cashRowEdited(DEMO_ADDRESS_NEAR, (p) => ({ ...p, liquidatable: null }));
  const verdictlessView = view({ lookup: { phase: "ready", value: lookup(verdictless) }, stress: { phase: "ready", value: lookup(DEMO_STRESS_NEAR) } });
  expect(verdictlessView.refusedTiles).toBe(true);
  expect(verdictlessView.cash?.debt).not.toBeNull();
  expect(verdictlessView.cash?.cap).not.toBeNull();
  const u = addressWorkspace({ address: DEMO_NEAR_ADDR, view: verdictlessView, selectedId: "eth_minus_30" });
  expect(u.state).toBe("rows");
  if (u.tiles === null) throw new Error("a verdictless position beside rows still has tiles");
  expect(u.tiles.debtBefore).toEqual(REFUSED);
  expect(u.tiles.capBefore).toEqual(REFUSED);
  expect(u.tiles.roomBefore).toEqual(REFUSED);
  expect(u.tiles.statusBefore).toEqual(NOT_COMPUTED);
  for (const tile of [u.tiles.debtBefore, u.tiles.capBefore, u.tiles.roomBefore, u.tiles.statusBefore]) expect(tile.value).not.toContain("$");
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
    dek: "Room today $190.50; under the projection, not computed. The projected figures are not a position.",
  });
  expect(negative.tiles?.statusAfter).toEqual(NOT_COMPUTED);
  expect(negative.tiles?.roomAfter).toEqual(REFUSED);
  // The same gate for an unknowable spot verdict, in its own words — and in projection words, never shock words.
  const unknown = addressWorkspace({ address: DEMO_NEAR_ADDR, view: spot({ liquidatable: null }), selectedId: "dm_rate_horizon_plus_200bps" });
  expect(unknown.headline).toEqual({
    emphasis: `Cannot say whether 0x7a3f…c21e becomes liquidatable under ${PROJECTION_LABEL}.`,
    rest: "",
    tone: "refused",
    dek: "Room today $190.50; under the projection, not computed. One side of the comparison is withheld or unknowable.",
  });
  expect(`${negative.headline.dek} ${unknown.headline.dek}`).not.toMatch(/shock/);
  expect(unknown.tiles?.statusAfter).toEqual(NOT_COMPUTED);
});

test("a projection beside a missing side yields no verdict word: a side the tiles refuse refuses the headline, missing as much as unreadable or unknowable", () => {
  const noAfter = addressWorkspace({
    address: DEMO_NEAR_ADDR,
    view: nearWith(withResult("dm_rate_horizon_plus_200bps", (x) => ({ ...x, after: null }))),
    selectedId: "dm_rate_horizon_plus_200bps",
  });
  expect(noAfter.selected?.projection).not.toBeNull();
  expect(noAfter.selected?.after).toBeNull();
  // The horizons are not consulted: the projected side is absent, and the dek says so in the tiles' own word.
  expect(noAfter.headline).toEqual({
    emphasis: `Cannot say whether 0x7a3f…c21e becomes liquidatable under ${PROJECTION_LABEL}.`,
    rest: "",
    tone: "refused",
    dek: "Room today $190.50; under the projection, not computed. One side of the comparison is withheld or unknowable.",
  });
  expect(noAfter.tiles?.statusAfter).toEqual(NOT_COMPUTED);
  expect(noAfter.tiles?.roomAfter).toEqual(REFUSED);
  // A missing before side is the same refusal: the law reads both sides, as the spot path does.
  const noBefore = addressWorkspace({
    address: DEMO_NEAR_ADDR,
    view: nearWith(withResult("dm_rate_horizon_plus_200bps", (x) => ({ ...x, before: null }))),
    selectedId: "dm_rate_horizon_plus_200bps",
  });
  expect(noBefore.selected?.before).toBeNull();
  expect(noBefore.headline).toEqual({
    emphasis: `Cannot say whether 0x7a3f…c21e becomes liquidatable under ${PROJECTION_LABEL}.`,
    rest: "",
    tone: "refused",
    dek: "Room today not computed; under the projection, $190.50. One side of the comparison is withheld or unknowable.",
  });
  expect(`${noAfter.headline.dek} ${noBefore.headline.dek}`).not.toMatch(/shock/);
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

test("rowOutcome: the library word is the row's own verdict — the same judgement the headline speaks from", () => {
  const near = (body: StressBody) => addressWorkspace({ address: DEMO_NEAR_ADDR, view: nearWith(body), selectedId: "eth_minus_30" }).rows;
  const rows = near(DEMO_STRESS_NEAR);
  const eth = rows.find((r) => r.id === "eth_minus_30")!;
  const dm = rows.find((r) => r.id === "dm_rate_horizon_plus_200bps")!;
  expect(eth.flips).toBe(true);
  expect(rowOutcome(eth)).toEqual({ key: "result", text: "Becomes liquidatable", tone: "crit" });
  // A projection speaks through its horizons: inside through the longest, or liquidatable within the first that flips.
  expect(rowOutcome(dm)).toEqual({ key: "result", text: "Stays inside its cap through 90d", tone: "ok" });
  const flipsAt30d = near(projected(0, true)).find((r) => r.id === "dm_rate_horizon_plus_200bps");
  expect(rowOutcome(flipsAt30d)).toEqual({ key: "result", text: "Becomes liquidatable within 30d", tone: "warn" });
  // A side the tiles refuse yields no verdict word, whatever the wire's booleans say.
  const unreadable = near(withResult("eth_minus_30", (x) => (!x.after ? x : { ...x, after: { ...x.after, debt_usd: "-4822000000" } }))).find((r) => r.id === "eth_minus_30")!;
  expect(unreadable.flips).toBe(true);
  expect(rowOutcome(unreadable)).toEqual({ key: "withheld", text: "Cannot say", tone: "refused" });
  // A spot row that does not flip: inside when it is not liquidatable today, "today and after" when it already is.
  expect(rowOutcome({ ...eth, flips: false, after: eth.before })).toEqual({ key: "result", text: "Stays inside its cap", tone: "ok" });
  expect(rowOutcome({ ...eth, flips: false })).toEqual({ key: "result", text: "Liquidatable today and after", tone: "crit" });
  expect(rowOutcome({ ...eth, applicable: false, reason: "no Cash position" })).toEqual({ key: "not-covered", text: "Not applicable: no Cash position", tone: "dim" });
  expect(rowOutcome({ ...eth, applicable: false, reason: null })).toEqual({ key: "not-covered", text: "Not applicable: the engine gave no reason", tone: "dim" });
  expect(rowOutcome(undefined)).toEqual({ key: "not-covered", text: "Not on this address", tone: "dim" });
});

test("the table's cells are the lib's own words — the one verdict word function the Inspector's table prints from, over the row verdict the headline speaks from, and the tiles' room register", () => {
  const cellWords = (row: StressRow) => stressVerdictWords(rowVerdict(row));
  const near = (body: StressBody) => addressWorkspace({ address: DEMO_NEAR_ADDR, view: nearWith(body), selectedId: "eth_minus_30" }).rows;
  const rows = near(DEMO_STRESS_NEAR);
  const eth = rows.find((r) => r.id === "eth_minus_30")!;
  const dm = rows.find((r) => r.id === "dm_rate_horizon_plus_200bps")!;
  expect(cellWords(eth)).toEqual({ text: "Yes", tone: "crit", title: null });
  // A projection answers in its horizons' terms on both pages: it holds "Not within" its longest horizon — never a bare "No".
  expect(cellWords(dm)).toEqual({ text: "Not within 90d", tone: null, title: "a projection speaks only through its longest horizon" });
  // A projection whose horizon flips names the horizon, in the projection's warn tone — never a "No" read off its unchanged spot side, never a bare "Yes".
  const within = near(projected(1, true)).find((r) => r.id === "dm_rate_horizon_plus_200bps")!;
  expect(within.flips).toBe(false);
  expect(cellWords(within)).toEqual({ text: "Within 90d", tone: "warn", title: null });
  expect(cellWords(near(projected(0, null)).find((r) => r.id === "dm_rate_horizon_plus_200bps")!)).toEqual({ text: "Cannot say", tone: "refused", title: "the 30d horizon carries no verdict" });
  // A side that is not a position: no verdict word, whatever the wire's booleans say.
  const negative = near(withResult("eth_minus_30", (x) => (!x.after ? x : { ...x, after: { ...x.after, debt_usd: "-4822000000" } }))).find((r) => r.id === "eth_minus_30")!;
  expect(negative.flips).toBe(true);
  expect(cellWords(negative)).toEqual({ text: "Cannot say", tone: "refused", title: "the shocked figures are not a position" });
  expect(cellWords({ ...eth, after: null })).toEqual({ text: "Cannot say", tone: "refused", title: "one side of the comparison is withheld or unknowable" });
  expect(cellWords({ ...eth, flips: false })).toEqual({ text: "Already liquidatable", tone: "crit", title: "liquidatable before the shock and after it" });
  expect(cellWords({ ...eth, flips: false, after: eth.before })).toEqual({ text: "No", tone: null, title: null });
  expect(cellWords({ ...eth, applicable: false, reason: "no Cash position" })).toEqual({ text: "no Cash position", tone: null, title: null });
  expect(cellWords({ ...eth, applicable: false, reason: null })).toEqual({ text: "the engine gave no reason", tone: null, title: null });
  // The room cells: the tiles' words — a negative room "over cap by", a refused side "not computed", an unreadable scale its word; never a minus on a dollar figure.
  expect(sideRoomWords(eth.before, 6)).toBe("$190.50");
  expect(sideRoomWords(eth.after, 6)).toBe("over cap by $1,069");
  expect(sideRoomWords(negative.after, 6)).toBe("not computed");
  expect(sideRoomWords(null, 6)).toBe("not computed");
  expect(sideRoomWords({ ...eth.after!, verdict: "unknowable" }, 6)).toBe("not computed");
  expect(sideRoomWords(eth.after, null)).toBe("unreadable scale");
  expect(sideRoomWords(eth.after, 6)).not.toContain("−");
});

test("a repaired lookup beside the stress it kept: the workspace's stress-batch chip and its dek say 'from the previous lookup' in the Inspector note's own words; a fresh pair says nothing of it", () => {
  const moved = { ...DEMO_ADDRESS_NEAR, batch: { ...DEMO_ADDRESS_NEAR.batch, id: DEMO_ADDRESS_NEAR.batch.id + 1 } };
  const at = (lookupRepaired: boolean, address: typeof DEMO_ADDRESS_NEAR = moved) => {
    const v = view({ lookup: { phase: "ready", value: lookup(address) }, stress: { phase: "ready", value: lookup(DEMO_STRESS_NEAR) }, lookupRepaired });
    return { v, w: addressWorkspace({ address: DEMO_NEAR_ADDR, view: v, selectedId: "eth_minus_30" }) };
  };
  // The repair moved the position one batch on and replayed no stress.
  const kept = at(true);
  expect(kept.w.state).toBe("rows");
  expect(kept.w.tiles).toBeNull();
  expect(kept.w.headline.emphasis).toBe("Cannot say — the stress result is for batch 18,251; the position above is batch 18,252.");
  expect(kept.w.stressBatchChip).toBe("18,251 · stress from the previous lookup");
  // One sentence, one author: the dek is the Inspector's disclosure, and the chip is its row label's batch.
  const note = stressBatchNote(kept.v);
  if (note === null) throw new Error("the Inspector discloses this skew");
  expect(kept.w.headline.dek).toBe(note.disclosure);
  expect(kept.w.headline.dek).toContain("Stress from the previous lookup, for batch 18,251; the position above was refreshed since and is batch 18,252.");
  expect(note.rowLabel).toBe(`batch ${note.chipValue}`);
  expect(kept.w.stressBatchChip).toBe(note.chipValue);
  // The same skew with no repair behind it: two requests answering two batches — the chip is the batch alone.
  const plain = at(false);
  expect(plain.w.stressBatchChip).toBe("18,251");
  expect(plain.w.headline.dek).toBe("The scenarios below are the stress result's own. A position and a stress result from different batches are not compared.");
  expect(plain.w.headline.dek).not.toContain("previous lookup");
  // A fresh pair, and a repair that landed the same batch: one batch, no second chip, the tiles compare.
  for (const same of [at(false, DEMO_ADDRESS_NEAR), at(true, DEMO_ADDRESS_NEAR)]) {
    expect(same.w.stressBatchChip).toBeNull();
    expect(same.w.tiles).not.toBeNull();
    expect(same.w.headline.dek).not.toContain("previous lookup");
  }
});

test("a stress result for another batch than the position is not compared: both batches named, the tiles refused, the rows kept", () => {
  const other = { ...DEMO_STRESS_NEAR, batch: { ...DEMO_STRESS_NEAR.batch, id: DEMO_STRESS_NEAR.batch.id + 1 } };
  const w = addressWorkspace({ address: DEMO_NEAR_ADDR, view: nearWith(other), selectedId: "eth_minus_30" });
  expect(w.state).toBe("rows");
  expect(w.batchId).toBe(DEMO_STRESS_NEAR.batch.id);
  expect(w.stressBatchId).toBe(DEMO_STRESS_NEAR.batch.id + 1);
  expect(w.tiles).toBeNull();
  expect(w.rows.length).toBeGreaterThan(0);
  expect(w.headline.tone).toBe("refused");
  expect(w.headline.emphasis).toBe(`Cannot say — the stress result is for batch ${(DEMO_STRESS_NEAR.batch.id + 1).toLocaleString("en-US")}; the position above is batch ${DEMO_STRESS_NEAR.batch.id.toLocaleString("en-US")}.`);
  // The same batch on both sides compares as before.
  const same = addressWorkspace({ address: DEMO_NEAR_ADDR, view: nearWith(DEMO_STRESS_NEAR), selectedId: "eth_minus_30" });
  expect(same.stressBatchId).toBe(same.batchId);
  expect(same.tiles).not.toBeNull();
});

test("one row, one header, one set of words on both pages: the verdict words the one-address view model hands its table are the Inspector's own function over the Inspector's own judge, row for row", () => {
  // The shared fixture: the demo account's rate projection, as served (it holds through 90d) and with its 90d horizon flipping.
  const spaceOf = (body: StressBody) => addressWorkspace({ address: DEMO_NEAR_ADDR, view: nearWith(body), selectedId: "eth_minus_30" });
  const rowsOf = (body: StressBody) => spaceOf(body).rows;
  const holding = rowsOf(DEMO_STRESS_NEAR).find((r) => r.id === "dm_rate_horizon_plus_200bps")!;
  const flipping = rowsOf(projected(1, true)).find((r) => r.id === "dm_rate_horizon_plus_200bps")!;
  expect(stressVerdictWords(rowVerdict(holding))).toEqual({ text: "Not within 90d", tone: null, title: "a projection speaks only through its longest horizon" });
  expect(stressVerdictWords(rowVerdict(flipping))).toEqual({ text: "Within 90d", tone: "warn", title: null });
  // A projection never answers a bare "Yes" or "No" on either page: those are a spot shock's words.
  for (const row of [holding, flipping]) expect(["Yes", "No"]).not.toContain(stressVerdictWords(rowVerdict(row)).text);
  // At runtime, for every shared demo row — the served body and the flipping one, a spot shock that flips, one that
  // holds, a withheld side, an inapplicable row: the words the view model hands the one-address table are what the
  // Inspector's word function says of the Inspector's judge. The table prints them and words nothing of its own.
  const shared = [DEMO_STRESS_NEAR, projected(1, true), projected(0, null), withResult("eth_minus_30", (r) => ({ ...r, after: null })), withResult("ethfi_minus_50", (r) => ({ ...r, applicable: false, reason: "no ETHFI collateral" }))];
  let judged = 0;
  for (const body of shared) {
    const space = spaceOf(body);
    expect(space.rows.length).toBeGreaterThan(0);
    expect(space.table.map((t) => t.row)).toEqual(space.rows);
    for (const { row, verdict } of space.table) {
      expect(verdict).toEqual(stressVerdictWords(rowVerdict(row)));
      judged += 1;
    }
  }
  expect(judged).toBeGreaterThanOrEqual(shared.length * 3);
  // No second word function stands beside the Inspector's in the lab's own module.
  expect(Object.keys(labAddress).filter((name) => /verdictword/i.test(name))).toEqual([]);
});

test("a stress result that names no readable batch is not compared: the chip says so in the Inspector note's own words, the tiles are refused, the rows kept — never read as the position's batch", () => {
  const unreadable = { ...DEMO_STRESS_NEAR, batch: { ...DEMO_STRESS_NEAR.batch, id: -1 } };
  const v = nearWith(unreadable);
  expect(v.stressBatchId).toBeNull();
  const w = addressWorkspace({ address: DEMO_NEAR_ADDR, view: v, selectedId: "eth_minus_30" });
  expect(w.state).toBe("rows");
  expect(w.rows.length).toBeGreaterThan(0);
  expect(w.stressBatchId).toBeNull();
  // The chip is the Inspector note's: one author for the stress batch's words on both pages.
  const note = stressBatchNote(v);
  if (note === null) throw new Error("the Inspector discloses a stress body with no readable batch");
  expect(w.stressBatchChip).toBe("not readable");
  expect(w.stressBatchChip).toBe(note.chipValue);
  // Not compared: no tile, a refusal that names what is and is not known, and no batch number invented for the stress.
  expect(w.tiles).toBeNull();
  expect(w.headline.tone).toBe("refused");
  expect(w.headline.emphasis).toBe("Cannot say — the stress result names no readable batch; the position above is batch 18,251.");
  expect(w.headline.dek).toBe("The scenarios below are the stress result's own. A stress result and a position are compared only when both name the same batch.");
  expect(w.qualifier).toBe("applied to this account at a batch the stress result does not name readably · the position above is batch 18,251 · shocked figures are projections, not readings");
  // After a resume repair the dek is the Inspector's disclosure, as it is for two readable batches.
  const kept = deriveInspectorView(reading({ lookup: { phase: "ready", value: lookup(DEMO_ADDRESS_NEAR) }, stress: { phase: "ready", value: lookup(unreadable) }, lookupRepaired: true }), TIER_FALLBACK);
  const k = addressWorkspace({ address: DEMO_NEAR_ADDR, view: kept, selectedId: "eth_minus_30" });
  expect(k.tiles).toBeNull();
  expect(k.stressBatchChip).toBe("not readable · stress from the previous lookup");
  expect(k.headline.dek).toBe(stressBatchNote(kept)?.disclosure);
  // The section's qualifier is the lib's in every arm: one batch, two batches.
  expect(addressWorkspace({ address: DEMO_NEAR_ADDR, view: near(), selectedId: "eth_minus_30" }).qualifier).toBe("applied to this account · shocked figures are projections, not readings");
  const other = { ...DEMO_STRESS_NEAR, batch: { ...DEMO_STRESS_NEAR.batch, id: DEMO_STRESS_NEAR.batch.id + 1 } };
  expect(addressWorkspace({ address: DEMO_NEAR_ADDR, view: nearWith(other), selectedId: "eth_minus_30" }).qualifier).toBe("applied to this account at batch 18,252 · the position above is batch 18,251 · shocked figures are projections, not readings");
});

test("where there is no scale to print at, the workspace carries the TRUE cause and the cells say it — 'unreadable scale' only for a scale that was read and refused", () => {
  // A scale the guard refuses: the one case that is an unreadable scale.
  const badScale = addressWorkspace({ address: DEMO_NEAR_ADDR, view: { ...near(), decimals: 1.5 }, selectedId: null });
  expect(badScale.decimals).toBeNull();
  expect(badScale.scaleAbsence).toBe("unreadable");
  // A view that states why it has no scale: the workspace carries that cause, and the cells say it — never the scale's word.
  const noPosition = addressWorkspace({ address: DEMO_NEAR_ADDR, view: { ...near(), decimals: null, scaleAbsence: "no-position" }, selectedId: null });
  expect(noPosition.state).toBe("rows");
  expect(noPosition.decimals).toBeNull();
  expect(noPosition.scaleAbsence).toBe("no-position");
  const spot = noPosition.rows.find((r) => r.projection === null)!;
  expect(sideRoomWords(spot.before, noPosition.decimals, noPosition.scaleAbsence)).toBe("no Cash position in the lookup");
  expect(sideRoomWords(spot.before, badScale.decimals, badScale.scaleAbsence)).toBe("unreadable scale");
  // A readable scale carries no absence.
  expect(addressWorkspace({ address: DEMO_NEAR_ADDR, view: near(), selectedId: null }).scaleAbsence).toBeNull();
});

test("a stress response that reports no position is the STRESS response's negative: it names its own batch, never the lookup's, and where the lookup holds a Cash position — or withholds the book — the disagreement is disclosed first and the negative said after it, never as a fact about the position on the page", () => {
  const short = "0x7a3f…c21e";
  const negative = (batchId: unknown) => lookup({ ...DEMO_STRESS_NEAR, batch: { ...DEMO_STRESS_NEAR.batch, id: batchId as number }, found: false, scenarios: [] });
  const over = (stress: ReturnType<typeof negative>, overrides: Partial<AddressReading> = {}) =>
    addressWorkspace({ address: DEMO_NEAR_ADDR, view: view({ lookup: { phase: "ready", value: lookup(DEMO_ADDRESS_NEAR) }, stress: { phase: "ready", value: stress }, ...overrides }), selectedId: null });
  // The lookup found Cash in batch 18,251; the stress response, fetched on its own, answers for batch 18,252.
  const other = over(negative(18252));
  expect(other.state).toBe("no-position");
  expect(other.headline).toEqual({
    emphasis: "Cannot say — the stress result is for batch 18,252; the position above is batch 18,251.",
    rest: "",
    tone: "refused",
    dek: `The stress response reports no position for ${short} in batch 18,252 — its own batch, not the position's. A position and a stress result from different batches are not compared.`,
  });
  expect(`${other.headline.emphasis} ${other.headline.dek}`).not.toContain("No Cash position");
  expect(other.headline.dek).not.toContain("in batch 18,251");
  // Both batches are on the strip, the stress batch in the Inspector's words.
  expect([other.batchId, other.stressBatchId, other.stressBatchChip]).toEqual([18251, 18252, "18,252"]);
  // The same ordering after a resume repair, which refreshes the position alone and replays no stress.
  const kept = over(negative(18252), { lookupRepaired: true });
  expect(kept.headline.emphasis).toBe("Cannot say — the stress result is for batch 18,252; the position above is batch 18,251.");
  expect(kept.headline.dek).toBe(
    `The stress response was read for the previous lookup, and the position above was refreshed since. It reports no position for ${short} in batch 18,252 — its own batch, not the position's. A position and a stress result from different batches are not compared.`,
  );
  expect(kept.stressBatchChip).toBe("18,252 · stress from the previous lookup");
  // A stress batch the guard refuses names no batch: the negative is never quoted for the position's.
  const unnamed = over(negative("18251"));
  expect(unnamed.headline.emphasis).toBe("Cannot say — the stress result names no readable batch; the position above is batch 18,251.");
  expect(unnamed.headline.dek).toBe(`The stress response reports no position for ${short} in a batch it does not name readably. A stress result and a position are compared only when both name the same batch.`);
  expect(unnamed.stressBatchChip).toBe("not readable");
  // One batch, two answers: the disagreement is the sentence, and neither answer is printed as the fact.
  const same = over(negative(18251));
  expect(same.headline).toEqual({
    emphasis: `Cannot say — the lookup holds a Cash position for ${short} in batch 18,251, and the stress response reports none in the same batch.`,
    rest: "",
    tone: "refused",
    dek: "The two answers disagree about one batch. Nothing is stressed; the position above is the lookup's own.",
  });
  // A withheld Cash book is never "no position", whatever the stress response says.
  const withheldLookup = addressWorkspace({ address: UNKNOWABLE_ADDR, view: view({ address: UNKNOWABLE_ADDR, lookup: { phase: "ready", value: lookup(ADDRESS_UNKNOWABLE) }, stress: { phase: "ready", value: negative(1) } }), selectedId: null });
  expect(withheldLookup.headline.emphasis).toContain("Cannot say — the Cash book is withheld for ");
  expect(withheldLookup.headline.dek).toBe("The stress response reports no position in batch 1 while the lookup's Cash book is withheld — the two answers disagree.");

  // Where the lookup itself holds no Cash position the two agree, and the negative still names the stress response's batch.
  const none = (batchId: unknown) =>
    addressWorkspace({
      address: NOT_FOUND_ADDR,
      view: view({ address: NOT_FOUND_ADDR, lookup: { phase: "ready", value: lookup(ADDRESS_NOT_FOUND) }, stress: { phase: "ready", value: lookup({ ...DEMO_STRESS_NEAR, address: NOT_FOUND_ADDR, batch: { ...DEMO_STRESS_NEAR.batch, id: batchId as number }, found: false, scenarios: [] }) } }),
      selectedId: null,
    });
  expect(none(1).headline).toEqual({ emphasis: "No Cash position for 0xBBbB…0002 in batch 1.", rest: "", tone: "refused", dek: "The lookup is complete: there is nothing to stress." });
  expect([none(1).batchId, none(1).stressBatchChip]).toEqual([null, null]);
  expect(none(2).headline).toEqual({
    emphasis: "No Cash position for 0xBBbB…0002 in batch 2.",
    rest: "",
    tone: "refused",
    dek: "That is the stress response's own answer, for its own batch; the lookup above is batch 1 and holds no Cash position either.",
  });
  expect(none("x").headline.emphasis).toBe("No Cash position for 0xBBbB…0002 in a batch the stress response does not name readably.");
});

test("a named scenario the address was not stressed under is never the silent subject: the workspace shows the first row the address carries and SAYS so — what was not evaluated, what is shown instead; a named scenario that is the subject, or no name at all, discloses nothing", () => {
  const depeg = { id: "weeth_market_depeg_oracles_held", label: "weETH market depeg to 0.95 (oracles held)" };
  // The listing names it; the address's stress response does not carry it.
  const carried = near().stress;
  if (carried?.kind !== "rows") throw new Error("the demo address carries stress rows");
  expect(carried.rows.map((r) => r.id)).not.toContain(depeg.id);
  const w = addressWorkspace({ address: DEMO_NEAR_ADDR, view: near(), selectedId: depeg.id, named: depeg });
  expect(w.state).toBe("rows");
  expect(w.selected?.id).toBe("eth_minus_30");
  expect(w.fallback).toBe("weETH market depeg to 0.95 (oracles held) was not evaluated for 0x7a3f…c21e: the stress response carries no result for it. ETH -30 percent is shown instead — the first scenario this address carries.");
  // The headline is the shown subject's, as before: the disclosure stands beside it, never in its place.
  expect(w.headline.emphasis).toBe("0x7a3f…c21e becomes liquidatable under ETH -30 percent.");
  // A named scenario the address carries is the subject; no name is no disclosure, whatever the listing's default is.
  expect(addressWorkspace({ address: DEMO_NEAR_ADDR, view: near(), selectedId: "ethfi_minus_50", named: { id: "ethfi_minus_50", label: "ETHFI -50 percent" } }).fallback).toBeNull();
  expect(addressWorkspace({ address: DEMO_NEAR_ADDR, view: near(), selectedId: depeg.id }).fallback).toBeNull();
  expect(addressWorkspace({ address: DEMO_NEAR_ADDR, view: near(), selectedId: depeg.id, named: null }).fallback).toBeNull();
  // The disclosure stands under every rows headline — a refused comparison does not swallow it — and nowhere a subject is not shown.
  const otherBatch = addressWorkspace({ address: DEMO_NEAR_ADDR, view: nearWith({ ...DEMO_STRESS_NEAR, batch: { ...DEMO_STRESS_NEAR.batch, id: 18252 } }), selectedId: depeg.id, named: depeg });
  expect(otherBatch.tiles).toBeNull();
  expect(otherBatch.fallback).toBe(w.fallback);
  expect(addressWorkspace({ address: DEMO_NEAR_ADDR, view: view({}), selectedId: depeg.id, named: depeg }).fallback).toBeNull();
});
