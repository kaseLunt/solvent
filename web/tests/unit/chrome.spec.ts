// The app chrome's words (web/lib/chrome.ts): the header's nav and quiet controls, the live pill's title, the drawer's
// close control, the kit's own fixed labels, the degradation banner and the route boundary. Components render these
// verbatim; the pins here hold the words, their case and the arrow grammar in one place.
import { expect, test } from "@playwright/test";
import {
  ADDRESS_FIELD,
  BAND_BARS_LABEL,
  BRAND,
  DRAWER_CLOSE,
  DRAWER_CLOSE_KEY,
  DRAWER_FALLBACK_LABEL,
  GITHUB_LABEL,
  GITHUB_URL,
  LIBRARY,
  NAV_LABEL,
  NAV_TABS,
  ROUTE_REFUSAL,
  TABLE_FALLBACK_LABEL,
  bannerDegraded,
  bannerReconnecting,
  bannerUnavailable,
  libraryCompareLabel,
  livePillTitle,
  themeLabel,
} from "../../lib/chrome";

const startsCapital = (text: string) => /^[A-Z0-9…]/.test(text);

test("the nav names the eight pages by their page names; the routes are unchanged", () => {
  expect(NAV_TABS.map((tab) => tab.label)).toEqual(["Overview", "Book", "Inspector", "Scenarios", "History", "Activity", "Verification", "API"]);
  expect(NAV_TABS.map((tab) => tab.href)).toEqual(["/", "/book", "/inspector", "/lab", "/observatory", "/feed", "/proof", "/developers"]);
  // The accessible name the e2e walks select the nav by, and the brand link's name.
  expect(NAV_LABEL.toLowerCase()).toBe("app surfaces");
  expect(BRAND.linkLabel).toBe("Solvent · go to the overview");
  expect(BRAND.name).toBe("Solvent");
  expect(BRAND.tag).toBe("ether.fi Cash risk");
});

test("the header's two quiet controls name what they do: the source link, and the theme's state and its next step", () => {
  expect(GITHUB_LABEL).toBe("Source on GitHub");
  expect(GITHUB_URL).toBe("https://github.com/kaseLunt/solvent");
  expect(themeLabel("system")).toBe("Theme: follows the system. Switch to light.");
  expect(themeLabel("light")).toBe("Theme: light. Switch to dark.");
  expect(themeLabel("dark")).toBe("Theme: dark. Switch to follow the system.");
  // Every label starts with the word the e2e selects the control by — and no control is shouted in capitals.
  for (const choice of ["system", "light", "dark"] as const) {
    expect(themeLabel(choice)).toMatch(/^Theme: /);
    expect(themeLabel(choice)).not.toMatch(/THEME/);
  }
});

test("the live pill's title carries the connection's sentence, then the batch and the age the pill may fold away on a phone", () => {
  expect(livePillTitle({ word: "Live", batch: "batch 18,251", age: "42s ago" })).toBe("Live updates are on. Batch 18,251 · 42s ago.");
  expect(livePillTitle({ word: "Reconnecting", batch: "batch 7", age: "age unknown" })).toBe(
    "Live updates are reconnecting. The figures on this page stay as served for their batch. Batch 7 · age unknown.",
  );
  expect(livePillTitle({ word: "Not connected", batch: null, age: null })).toBe(
    "Live updates are off. The figures on this page stay as served for their batch.",
  );
  // A batch without an age, and an age without a batch, each keep the clause they have — nothing is invented.
  expect(livePillTitle({ word: "Live", batch: "batch 7", age: null })).toBe("Live updates are on. Batch 7.");
  expect(livePillTitle({ word: "Live", batch: null, age: "age unknown" })).toBe("Live updates are on. Age unknown.");
});

test("the drawer's close control is a word and its key, in the kit's register — never a glyph pair in capitals", () => {
  expect(DRAWER_CLOSE).toBe("Close");
  expect(DRAWER_CLOSE_KEY).toBe("Esc");
  expect(DRAWER_FALLBACK_LABEL).toBe("Detail drawer");
  expect(`${DRAWER_CLOSE} ${DRAWER_CLOSE_KEY}`).not.toMatch(/ESC|✕/);
});

test("every fixed line the kit prints starts with a capital, and no label that is not a link wears an arrow", () => {
  const lines = [
    TABLE_FALLBACK_LABEL,
    BAND_BARS_LABEL,
    ADDRESS_FIELD.hint,
    ADDRESS_FIELD.inputLabel,
    ADDRESS_FIELD.inspect,
    LIBRARY.title,
    LIBRARY.modeLabel,
    LIBRARY.modes.book,
    LIBRARY.modes.address,
    libraryCompareLabel("ETH −30%"),
    ROUTE_REFUSAL.head,
    ROUTE_REFUSAL.body,
    ROUTE_REFUSAL.evidence,
    ROUTE_REFUSAL.reset,
    ROUTE_REFUSAL.digest("abc"),
  ];
  for (const line of lines) {
    expect(startsCapital(line), line).toBe(true);
    expect(line, line).not.toMatch(/[→↓]/);
  }
  // The modes keep the words the Scenarios walks pin.
  expect(LIBRARY.modes).toEqual({ book: "Whole book", address: "One address" });
  expect(ADDRESS_FIELD.hint).toBe("Any 0x address");
});

test("the degradation banner: a state word, then what still stands — sentence case, figures grouped, engines by name", () => {
  expect(bannerUnavailable({ reason: "no batch has completed", staleSinceSeconds: 5400, lastGoodBatchId: 18250 })).toEqual({
    word: "Unavailable",
    parts: [
      { text: "No servable batch · no batch has completed" },
      { text: " · held data is " },
      { text: "1 h 30 min", strong: true },
      { text: " stale" },
      { text: " · last good batch " },
      { text: "18,250", strong: true },
    ],
  });
  expect(bannerUnavailable({ reason: null, staleSinceSeconds: null, lastGoodBatchId: null })).toEqual({
    word: "Unavailable",
    parts: [{ text: "No servable batch" }],
  });
  expect(
    bannerDegraded({
      superseded: true,
      legs: ["prices"],
      withheld: [{ engine: "debt_manager", code: "sweep_failed" }],
    }),
  ).toEqual({
    word: "Degraded",
    parts: [
      { text: "Batch " },
      { text: "superseded", strong: true },
      { text: " (prices)" },
      { text: " · withheld: " },
      { text: "Cash", strong: true },
      { text: " (sweep_failed)" },
    ],
  });
  // Two engines withheld are listed side by side, Cash first whatever order the wire gave — never summed.
  expect(bannerDegraded({ superseded: false, legs: [], withheld: [{ engine: "aave_v3_etherfi", code: "x" }, { engine: "debt_manager", code: "y" }] }).parts).toEqual([
    { text: "Withheld: " },
    { text: "Cash", strong: true },
    { text: " (y)" },
    { text: ", " },
    { text: "Aave v3 market (legacy)", strong: true },
    { text: " (x)" },
  ]);
  expect(bannerReconnecting()).toEqual({
    word: "Reconnecting",
    parts: [{ text: "Stream lost. Showing the last delivered batch until the reconnect snapshot lands." }],
  });
});
