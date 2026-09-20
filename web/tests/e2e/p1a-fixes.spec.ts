// Track A / p1a-1 — the RENDERED side of the foundation token contract.
//
// tests/unit/tokens-contract.spec.ts pins the stylesheet SOURCE; these pins
// prove the built app actually serves it: the §02 width steps reach the live
// `main.shell` box, and the §04 palette amendments resolve through the full
// light-first + media + data-theme cascade in both themes.
//
// p1a-4 adds the CANON APPBAR describe (build-contract §10) at the bottom of
// this file: each truth its own chip, tier styling computed from the ratified
// bounds, raw watermark heights demoted into the Data status popover, and
// LIVE · WATERMARKED retired header-wide.

import { createServer, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { expect, test } from "@playwright/test";
import type { Page, Route } from "@playwright/test";
import { FEED_CROSS_PAGE_1, FEED_POSTURE_SNAPSHOT } from "../fixtures/feed";

async function openShell(page: Page, viewport: { width: number; height: number }): Promise<void> {
  await page.setViewportSize(viewport);
  await page.goto("/book");
  await expect(page.locator("main.shell")).toBeVisible();
}

function shellWidth(page: Page): Promise<number> {
  return page.evaluate(() => {
    const shell = document.querySelector("main.shell");
    if (shell === null) throw new Error("main.shell missing");
    return shell.getBoundingClientRect().width;
  });
}

/** The computed max-width a `.breakout` probe resolves at the current viewport. */
function breakoutMaxWidth(page: Page): Promise<string> {
  return page.evaluate(() => {
    const probe = document.createElement("div");
    probe.className = "breakout";
    document.body.appendChild(probe);
    const value = getComputedStyle(probe).maxWidth;
    probe.remove();
    return value;
  });
}

// ---------------------------------------------------------------------------
// §02 — the width contract, rendered
// ---------------------------------------------------------------------------

test("p1a-1: at 1920×1080 the shell renders the 1520 step", async ({ page }) => {
  await openShell(page, { width: 1920, height: 1080 });
  const width = await shellWidth(page);
  expect(Math.abs(width - 1520), `main.shell rendered ${String(width)}px, wanted 1520±1`)
    .toBeLessThanOrEqual(1);
  // The breakout steps WITH the shell at this width.
  expect(await breakoutMaxWidth(page)).toBe("1520px");
});

test("p1a-1: at 1440×900 the shell holds 1280 while the breakout steps ahead to 1340", async ({
  page,
}) => {
  await openShell(page, { width: 1440, height: 900 });
  const width = await shellWidth(page);
  expect(Math.abs(width - 1280), `main.shell rendered ${String(width)}px, wanted 1280±1`)
    .toBeLessThanOrEqual(1);
  // 1440 is the breakout-only step: analytical exhibits get 1340, prose does not move.
  expect(await breakoutMaxWidth(page)).toBe("1340px");
});

// ---------------------------------------------------------------------------
// §04 — the palette amendments, resolved through the theme cascade
// ---------------------------------------------------------------------------

/** Resolve custom properties on a live probe under an explicit data-theme. */
async function resolveTokens(
  page: Page,
  theme: "light" | "dark",
  tokens: readonly string[],
): Promise<Record<string, string>> {
  return page.evaluate(
    ({ value, list }) => {
      document.documentElement.setAttribute("data-theme", value);
      const probe = document.createElement("span");
      document.body.appendChild(probe);
      const resolved: Record<string, string> = {};
      for (const token of list) {
        probe.style.color = `var(${token})`;
        resolved[token] = getComputedStyle(probe).color;
      }
      probe.remove();
      return resolved;
    },
    { value: theme, list: tokens as string[] },
  );
}

test("p1a-1: --ink-3 resolves to the §04 amended rgb in both themes", async ({ page }) => {
  await openShell(page, { width: 1280, height: 900 });
  // dark #71868e (was #5f7178, 3.39 on panel) · light #637075 (was #8a979c, 2.65 on panel-2)
  const dark = await resolveTokens(page, "dark", ["--ink-3"]);
  expect(dark["--ink-3"], "dark ink-3").toBe("rgb(113, 134, 142)");
  const light = await resolveTokens(page, "light", ["--ink-3"]);
  expect(light["--ink-3"], "light ink-3").toBe("rgb(99, 112, 117)");
});

test("p1a-1: the text grade resolves in both themes — split hexes in light, fill values in dark", async ({
  page,
}) => {
  await openShell(page, { width: 1280, height: 900 });
  const TEXT_GRADE = ["--accent-text", "--ok-text", "--warn-text", "--crit-text"] as const;

  const light = await resolveTokens(page, "light", TEXT_GRADE);
  expect(light["--accent-text"]).toBe("rgb(42, 115, 128)"); // #2a7380
  expect(light["--ok-text"]).toBe("rgb(39, 120, 77)"); // #27784d
  expect(light["--warn-text"]).toBe("rgb(139, 98, 25)"); // #8b6219
  expect(light["--crit-text"]).toBe("rgb(186, 65, 54)"); // #ba4136

  const dark = await resolveTokens(page, "dark", [...TEXT_GRADE, "--accent", "--ok", "--warn", "--crit"]);
  // Dark text grade = fill grade, token by token.
  expect(dark["--accent-text"]).toBe(dark["--accent"]);
  expect(dark["--ok-text"]).toBe(dark["--ok"]);
  expect(dark["--warn-text"]).toBe(dark["--warn"]);
  expect(dark["--crit-text"]).toBe(dark["--crit"]);
  expect(dark["--accent-text"]).toBe("rgb(90, 179, 196)"); // #5ab3c4
});

// ===========================================================================
// p1a-4 — THE CANON APPBAR pins were retired with the old header on
// 2026-09-15 (Plan 1 Task 14, ledgered). The helpers below survive because
// the p1a-6 styleguide pins and the p1a-9 F3 feed pins still use them.
// ===========================================================================

const APPBAR_CORS = { "access-control-allow-origin": "*" };

function appbarJson(route: Route, body: unknown): Promise<void> {
  return route.fulfill({
    status: 200,
    headers: APPBAR_CORS,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
}

/** Resolve one token to its computed color/background on a live probe. */
async function resolveAppbarToken(
  page: Page,
  token: string,
  channel: "color" | "background" = "color",
): Promise<string> {
  return page.evaluate(
    ({ name, kind }) => {
      const probe = document.createElement("span");
      document.body.appendChild(probe);
      if (kind === "background") probe.style.backgroundColor = `var(${name})`;
      else probe.style.color = `var(${name})`;
      const computed = getComputedStyle(probe);
      const value = kind === "background" ? computed.backgroundColor : computed.color;
      probe.remove();
      return value;
    },
    { name: token, kind: channel },
  );
}

/** The chip's rendered register: ink, border, border style, fill. */
function readChipRegister(chip: ReturnType<Page["getByTestId"]>) {
  return chip.evaluate((el) => {
    const cs = getComputedStyle(el);
    return {
      color: cs.color,
      border: cs.borderTopColor,
      borderStyle: cs.borderTopStyle,
      bg: cs.backgroundColor,
    };
  });
}

// ===========================================================================
// p1a-6 — THE STYLEGUIDE IS THE LIVING CANON (build-contract §2, §4–§9, §11).
//
// The /styleguide route is the component kit's first mount and the canon's
// self-verifying specimen page: swatch contrast is MEASURED live from
// resolved styles (never printed from a table), the §6 nine dimensions mount
// with their exact copy, one specimen chart carries the §11 interaction
// register, and — since the pre-kit components retired (plan 2026-09-16, R7) —
// the kit's own primitives are the specimens: VerdictHeader in its four tones,
// KpiTile, StatusPill, IdentityChips, KitTable with its dim refused row and
// its small & dust toggle, and the Drawer.
//
// STANDING SKIP: like shell.spec's walk, these pins run only when the route
// was compiled in (NEXT_PUBLIC_SHOW_STYLEGUIDE=1 at build time — CI sets it;
// a local build without it 404s and the whole describe skips, never fails).
// ===========================================================================

test.describe("p1a-6 · the styleguide is the living canon", () => {
  test.beforeEach(async ({ page }) => {
    const response = await page.goto("/styleguide");
    test.skip(
      response !== null && response.status() === 404,
      "styleguide not compiled into this bundle (NEXT_PUBLIC_SHOW_STYLEGUIDE unset)",
    );
  });

  test("every text swatch's LIVE ratio clears 4.5 in both themes — and the known-bad probe fails by design", async ({
    page,
  }) => {
    // The audited §04 pair list: 17 text-on-worst-ground swatches.
    const pairs = page.locator('[data-testid="contrast-pair"]');
    await expect(pairs).toHaveCount(17);

    // The probe is the liveness proof: --ink-3 on --chip-bg — the canon's own
    // never-on-chip law, DEMONSTRATED with its failing measured ratio. The
    // exact per-theme values (4.29 light · 4.05 dark) can only come from a
    // real computation over the real resolved palette; a computation stubbed
    // to a constant dies at this attribute.
    const probe = page.getByTestId("contrast-probe-bad");
    await expect(probe).toContainText("KNOWN-BAD");

    for (const theme of ["light", "dark"] as const) {
      await page.evaluate((value) => {
        document.documentElement.setAttribute("data-theme", value);
      }, theme);
      await expect(probe).toHaveAttribute("data-ratio", theme === "light" ? "4.29" : "4.05");

      const measured = await pairs.evaluateAll((nodes) =>
        nodes.map((node) => ({
          pair: node.getAttribute("data-pair"),
          ratio: node.getAttribute("data-ratio"),
        })),
      );
      expect(measured).toHaveLength(17);
      for (const { pair, ratio } of measured) {
        expect(ratio, `${String(pair)} has no measured ratio (${theme})`).not.toBeNull();
        expect(
          Number.parseFloat(ratio ?? "0"),
          `${String(pair)} measured ${String(ratio)} in ${theme}`,
        ).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  test("the four VerdictHeader tones render their identity strips — and an empty chip list renders the refusal chip", async ({
    page,
  }) => {
    // RE-EXPRESSED from "the five banner variants render their identity strips" when VerdictBanner retired (plan
    // 2026-09-16, R7). The law is the same one — the answer never stands without its identity — on the kit's header.
    for (const tone of ["crit", "warn", "ok", "refused"] as const) {
      const header = page.getByTestId(`sg-verdict-${tone}`);
      await expect(header).toBeVisible();
      await expect(header).toHaveAttribute("data-variant", tone);
      const strip = header.locator('[data-slot="identity"]');
      await expect(strip).toHaveCount(1);
      await expect(strip).toContainText(/\S/);

      // The emphasis carries the verdict color in the -text grade; a refused answer wears ink, never a tier's color.
      const emphasis = page.getByTestId(`sg-verdict-${tone}-headline`).locator("b");
      const color = await emphasis.evaluate((el) => getComputedStyle(el).color);
      expect(color, `${tone} emphasis`).toBe(
        await resolveAppbarToken(page, tone === "refused" ? "--ink-2" : `--${tone}-text`),
      );
    }

    // The refused header names its cause on a dashed chip; the wire code rides in the title, never as the label.
    const cause = page.getByTestId("sg-verdict-refused").locator('[data-chip="Refused"]');
    await expect(cause).toHaveText("Refused sweep failed twice");
    await expect(cause).toHaveAttribute("title", "sweep_failed_no_success");
    expect((await readChipRegister(cause)).borderStyle).toBe("dashed");

    // The law's own specimen: a header composed with an EMPTY chip list renders the kit's dashed refusal chip —
    // the strip is still there, and it names the omission.
    const law = page.getByTestId("sg-verdict-identity-law");
    const strip = law.locator('[data-slot="identity"]');
    await expect(strip.locator("[data-chip]")).toHaveCount(1);
    const missing = strip.locator('[data-chip="Identity"]');
    await expect(missing).toHaveText("Identity missing");
    expect((await readChipRegister(missing)).borderStyle).toBe("dashed");
  });

  test("the freshness tier row renders all five states, each in its tier's register", async ({ page }) => {
    // FRESH: measured ink, quiet border, NO tier word, no green.
    const fresh = page.getByTestId("sg-tier-fresh");
    await expect(fresh).toHaveText("SNAPSHOT 48s");
    const freshRegister = await readChipRegister(fresh);
    expect(freshRegister.color).toBe(await resolveAppbarToken(page, "--ink-2"));
    expect(freshRegister.border).toBe(await resolveAppbarToken(page, "--line"));

    // AGING: amber text + border.
    const aging = page.getByTestId("sg-tier-aging");
    await expect(aging).toHaveText("SNAPSHOT 5m · AGING");
    expect((await readChipRegister(aging)).color).toBe(
      await resolveAppbarToken(page, "--warn-text"),
    );

    // STALE: coral text, NO fill — outline only.
    const stale = page.getByTestId("sg-tier-stale");
    await expect(stale).toHaveText("SNAPSHOT 22m · STALE");
    const staleRegister = await readChipRegister(stale);
    expect(staleRegister.color).toBe(await resolveAppbarToken(page, "--crit-text"));
    expect(staleRegister.bg).toBe("rgba(0, 0, 0, 0)");

    // CRITICAL: coral WITH fill — the one escalation fill.
    const critical = page.getByTestId("sg-tier-critical");
    await expect(critical).toHaveText("SNAPSHOT 18h 12m · CRITICAL");
    const criticalRegister = await readChipRegister(critical);
    expect(criticalRegister.color).toBe(await resolveAppbarToken(page, "--crit-text"));
    expect(criticalRegister.bg).toBe(await resolveAppbarToken(page, "--crit-bg", "background"));

    // AGE UNKNOWN: not a tier — dashed, never any tier's color.
    const unknown = page.getByTestId("sg-tier-unknown");
    await expect(unknown).toHaveText("AGE UNKNOWN — NO BATCH METADATA");
    const unknownRegister = await readChipRegister(unknown);
    expect(unknownRegister.borderStyle).toBe("dashed");
    expect(unknownRegister.color).toBe(await resolveAppbarToken(page, "--ink-2"));
  });

  test("the nine dimensions and three compositions mount — each chip keeps its own register", async ({
    page,
  }) => {
    for (let dimension = 1; dimension <= 9; dimension += 1) {
      await expect(page.getByTestId(`sg-dim-${String(dimension)}`)).toBeVisible();
    }

    // Rendered chip colors (task-5 carry-in): the registers resolve on the
    // page, not just in the stylesheet. Green is rationed — HEALTHY wears it.
    const healthy = page.getByTestId("sg-dim-6").getByText("HEALTHY · HF 1.539");
    expect((await readChipRegister(healthy)).color).toBe(
      await resolveAppbarToken(page, "--ok-text"),
    );
    // The unknown register is dashed — UNANSWERED is not a small refusal.
    const unanswered = page.getByTestId("sg-dim-5").getByText(/UNANSWERED/);
    expect((await readChipRegister(unanswered)).borderStyle).toBe("dashed");

    // Composition 1 — the brief's named specimen: LIQUIDATABLE · DUST ·
    // COMPUTED · SNAPSHOT 18h (fixed §6 order: verdict · materiality ·
    // knowledge · freshness). Both crit-fill chips carry the ONE escalation
    // fill, resolved.
    const composition = page.getByTestId("sg-comp-1");
    const liquidatable = composition.getByText("LIQUIDATABLE · HF 0.4971");
    await expect(liquidatable).toBeVisible();
    expect((await readChipRegister(liquidatable)).bg).toBe(
      await resolveAppbarToken(page, "--crit-bg", "background"),
    );
    await expect(composition.getByText("DUST · <$0.01")).toBeVisible();
    await expect(composition.getByText("COMPUTED", { exact: true })).toBeVisible();
    await expect(composition.getByText("SNAPSHOT 18h 12m · CRITICAL")).toBeVisible();

    await expect(page.getByTestId("sg-comp-2")).toBeVisible();
    await expect(page.getByTestId("sg-comp-3")).toBeVisible();
  });

  test("the exact affordance carries its cue — and the forbidden arm is bare", async ({ page }) => {
    // Featured specimen (§7): title serves layer 2, tabindex enters the tab
    // order, role+aria speak the Enter-copy grammar (task-5 carry-in pins).
    const featured = page.getByTestId("sg-exact-featured").locator("[title]");
    await expect(featured).toHaveAttribute("title", "$2,835,019.429399");
    await expect(featured).toHaveAttribute("tabindex", "0");
    await expect(featured).toHaveAttribute("role", "button");
    await expect(featured).toHaveAttribute(
      "aria-label",
      "$2.84M — exact: $2,835,019.429399. Press Enter to copy the exact value.",
    );
    // The visible cue: the ⧉ copy glyph rides the ::after pseudo-element.
    const glyph = await featured.evaluate((node) =>
      getComputedStyle(node, "::after").getPropertyValue("content"),
    );
    expect(glyph).toContain("⧉");

    // FORBIDDEN arm: human === exact renders PLAIN — no title, no tab stop,
    // no glyph. A false scent is a lie.
    const forbidden = page.getByTestId("sg-exact-forbidden");
    await expect(forbidden).toContainText("$14.55");
    await expect(forbidden.locator("[title]")).toHaveCount(0);
    await expect(forbidden.locator("[tabindex]")).toHaveCount(0);
  });

  test("the six states mount with their honest copy — and refused table cells say the word", async ({
    page,
  }) => {
    for (const state of [
      "loading",
      "empty",
      "invalid",
      "refused",
      "unavailable",
      "superseded",
    ] as const) {
      await expect(page.getByTestId(`sg-state-${state}`)).toBeVisible();
    }
    await expect(page.getByTestId("sg-state-refused")).toContainText(
      "REFUSED · sweep failed twice · sweep_failed_no_success",
    );
    await expect(page.getByTestId("sg-state-unavailable")).toContainText("30 BATCHES NOT RETAINED");
    await expect(page.getByTestId("sg-state-invalid")).toContainText("0x80b3f19e2a6cZZZZ");
    await expect(page.getByTestId("sg-state-superseded")).toContainText(
      "A late response never overwrites a newer request context.",
    );

    // §9: the refused row's cells print the word in amber — collateral, debt and health factor — never an em
    // dash that reads as an empty zero.
    await expect(page.getByTestId("sg-table").getByText("refused", { exact: true })).toHaveCount(3);
  });

  test("the kit table: the refused row stays rendered and dimmed, and the small & dust rows fold behind a toggle that names them", async ({
    page,
  }) => {
    const table = page.getByTestId("sg-table-kit");
    const refused = page.getByTestId("sg-table-row-refused");
    await expect(refused).toBeVisible();

    // Dimmed, never dropped: the row's cells take --ink-3; the refused word keeps its amber inside them.
    const cell = refused.locator("td").nth(2);
    expect(await cell.evaluate((el) => getComputedStyle(el).color)).toBe(
      await resolveAppbarToken(page, "--ink-3"),
    );
    const word = cell.getByText("refused", { exact: true });
    expect(await word.evaluate((el) => getComputedStyle(el).color)).toBe(
      await resolveAppbarToken(page, "--warn-text"),
    );

    // The status column: the plain cause is the label, the wire code rides in the title.
    const pill = refused.locator('[data-tone="refused"]');
    await expect(pill).toHaveText("Not computed");
    await expect(pill).toHaveAttribute("title", "sweep_failed_no_success");

    // Folded by default — and the toggle names what it hides: the count and the sum.
    const toggle = page.getByTestId("sg-table-toggle");
    await expect(toggle).toHaveAttribute("role", "switch");
    await expect(toggle).toHaveAttribute("aria-checked", "false");
    await expect(toggle).toHaveText("Show 2 small & dust positions ($14.55)");
    await expect(table.locator("tbody tr")).toHaveCount(3);
    await expect(page.getByTestId("sg-table-row-dust-liquidatable")).toHaveCount(0);

    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-checked", "true");
    await expect(table.locator("tbody tr")).toHaveCount(5);
    await expect(page.getByTestId("sg-table-row-dust-liquidatable")).toBeVisible();
    // The refused row never folds, in either position.
    await expect(refused).toBeVisible();
  });

  test("the kit specimens: KpiTile's tones with the dashed refusal and the pending tile, StatusPill's vocabulary, IdentityChips' tones", async ({
    page,
  }) => {
    // KpiTile — every tone declares itself, and the value wears its tone's -text grade.
    for (const tone of ["neutral", "crit", "warn", "ok", "refused"] as const) {
      await expect(page.getByTestId(`sg-kpi-${tone}`)).toHaveAttribute("data-tone", tone);
    }
    const critValue = page.getByTestId("sg-kpi-crit").getByText("3 / 70", { exact: true });
    expect(await critValue.evaluate((el) => getComputedStyle(el).color)).toBe(
      await resolveAppbarToken(page, "--crit-text"),
    );
    // A refused tile is dashed and prints the gap word in ink — never a tier's color, never a zero.
    const refusedTile = page.getByTestId("sg-kpi-refused");
    expect((await readChipRegister(refusedTile)).borderStyle).toBe("dashed");
    const gapWord = refusedTile.getByText("withheld", { exact: true });
    expect(await gapWord.evaluate((el) => getComputedStyle(el).color)).toBe(
      await resolveAppbarToken(page, "--ink-2"),
    );
    // A pending tile prints … and is aria-busy; the value it was handed is not shown as an answer.
    const pending = page.getByTestId("sg-kpi-pending");
    await expect(pending).toHaveAttribute("aria-busy", "true");
    await expect(pending).toContainText("…");
    await expect(pending).not.toContainText("9,964");

    // StatusPill — the five-word vocabulary; the wire code is the refused pill's title; projection is dashed, unfilled.
    const pills = page.getByTestId("sg-pills");
    for (const [tone, label] of [
      ["crit", "Liquidatable"],
      ["warn", "Near cap"],
      ["ok", "Healthy"],
      ["refused", "Not computed"],
      ["projection", "Projection · ETH −20% v3"],
    ] as const) {
      await expect(pills.locator(`[data-tone="${tone}"]`)).toHaveText(label);
    }
    await expect(pills.locator('[data-tone="refused"]')).toHaveAttribute("title", "sweep_failed_no_success");
    const projection = await readChipRegister(pills.locator('[data-tone="projection"]'));
    expect(projection.borderStyle).toBe("dashed");
    expect(projection.bg).toBe("rgba(0, 0, 0, 0)");

    // IdentityChips — one truth per chip; the value carries the tone; the refused chip is dashed.
    await expect(page.getByTestId("sg-identity-strip").locator("[data-chip]")).toHaveCount(4);
    const tones = page.getByTestId("sg-identity-tones");
    for (const [chip, token] of [
      ["Reconcile", "--ok-text"],
      ["Coverage", "--warn-text"],
      ["Snapshot", "--crit-text"],
    ] as const) {
      const value = tones.locator(`[data-chip="${chip}"] b`);
      expect(await value.evaluate((el) => getComputedStyle(el).color), chip).toBe(
        await resolveAppbarToken(page, token),
      );
    }
    expect((await readChipRegister(tones.locator('[data-chip="Refused"]'))).borderStyle).toBe("dashed");
  });

  test("the type scale renders the closed set — all fourteen tokens", async ({ page }) => {
    await expect(page.locator('[data-testid="type-token"]')).toHaveCount(14);
  });

  test("the interaction register: tab enters, arrows traverse, Home/End jump, Enter opens evidence, Esc leaves", async ({
    page,
  }) => {
    const chart = page.getByTestId("sg-ir-chart");
    // ARIA wiring (§11): aria-details → the tabular twin, aria-describedby →
    // METHOD; both targets exist in the DOM.
    await expect(chart).toHaveAttribute("aria-details", "sg-ir-ledger");
    await expect(chart).toHaveAttribute("aria-describedby", "sg-ir-method");
    await expect(page.locator("#sg-ir-ledger")).toBeVisible();
    await expect(page.locator("#sg-ir-method")).toBeVisible();

    // TAB ENTERS THE CHART — one tab stop, from the visible Exact data
    // control that precedes it.
    await page.getByTestId("sg-ir-exact-data").focus();
    await page.keyboard.press("Tab");
    await expect(chart).toBeFocused();
    await expect(chart).toHaveAttribute("data-focus-index", "0");
    const ring = page.getByTestId("sg-ir-ring");
    await expect(ring).toBeVisible();
    const ringStart = Number(await ring.getAttribute("cx"));

    // ARROWRIGHT MOVES THE RING (the mutation-kill pin: a chart whose keydown
    // handler is removed dies exactly here).
    await page.keyboard.press("ArrowRight");
    await expect(chart).toHaveAttribute("data-focus-index", "1");
    const ringNext = Number(await ring.getAttribute("cx"));
    expect(ringNext).toBeGreaterThan(ringStart);
    await expect(page.getByTestId("sg-ir-readout")).toContainText("−10%");

    // Traverse to the canon readout specimen (mark 3, −30%): the persistent
    // readout carries the exact strings — value · Δ · identity.
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight");
    await expect(chart).toHaveAttribute("data-focus-index", "3");
    await expect(page.getByTestId("sg-ir-readout")).toHaveText(
      "−30% · eligible $1,213,020.108619 · Δ +$1,204,551.870341 · batch #18251",
    );

    // Home/End jump to first/last.
    await page.keyboard.press("End");
    await expect(chart).toHaveAttribute("data-focus-index", "5");
    await page.keyboard.press("Home");
    await expect(chart).toHaveAttribute("data-focus-index", "0");

    // Enter opens the mark's evidence: focus moves to its ledger row.
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("sg-ir-ledger-row-0")).toBeFocused();

    // ONE tab stop: from the chart, Tab leaves the chart entirely (marks are
    // never individual stops).
    await chart.focus();
    await page.keyboard.press("Tab");
    expect(
      await page.evaluate(() => {
        const svg = document.querySelector('[data-testid="sg-ir-chart"]');
        return (
          svg !== null && document.activeElement !== null && !svg.contains(document.activeElement)
        );
      }),
    ).toBe(true);

    // Esc exits — and the readout PERSISTS (hover is never the only path,
    // and leaving does not erase the reading).
    await chart.focus();
    await page.keyboard.press("Escape");
    await expect(chart).not.toBeFocused();
    await expect(page.getByTestId("sg-ir-readout")).toContainText("batch #18251");
  });

  test("p1a-9 F5: the contrast gate carries a REAL consumer specimen — the inspector verdict chip clears 4.5 live in both themes", async ({
    page,
  }) => {
    // The token pairs prove the PALETTE; this proves a consumer CLASS: the
    // inspector's .verdict.verdictWarn chip mounted with its real stylesheet
    // on its real --panel ground, measured live. A consumer whose TEXT keeps
    // (or regresses to) the fill-grade token dies here — light --warn on
    // --panel is ~3.2.
    const specimen = page.getByTestId("contrast-consumer");
    await expect(specimen).toBeVisible();
    for (const theme of ["light", "dark"] as const) {
      await page.evaluate((value) => {
        document.documentElement.setAttribute("data-theme", value);
      }, theme);
      await expect
        .poll(async () => Number.parseFloat((await specimen.getAttribute("data-ratio")) ?? "0"), {
          message: `consumer specimen ratio in ${theme}`,
        })
        .toBeGreaterThanOrEqual(4.5);
    }
  });
});

// ===========================================================================
// p1a-9 — THE CODEX ROUND. Of its seven findings, the rendered pins that
// remain here are F3 (the feed live strip threads hasBase and no socket is
// ever green). F1, F2 and F4 pinned the retired appbar chips (coverage,
// snapshot tier, NO SERVABLE BATCH beside the stream chip); those pins were
// retired with the old header on 2026-09-15 (Plan 1 Task 14, ledgered in
// .superpowers/sdd/progress-ui-overhaul.md). The tier→tone law survives in
// tests/unit/live-pill.spec.ts; the honest pill in tests/e2e/shell.spec.ts.
// ===========================================================================

/** A held-open SSE server: writes `body` and keeps the connection alive, so
 * `streamState` is genuinely "open" (route.fulfill would end the body — a
 * hang-up — and spend the test on the reconnect backoff). */
async function withHeldOpenStream(
  page: Page,
  body: string,
  run: () => Promise<void>,
): Promise<void> {
  const live = new Set<ServerResponse>();
  const server: Server = createServer((_request, response) => {
    live.add(response);
    response.on("close", () => live.delete(response));
    response.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-store",
      ...APPBAR_CORS,
    });
    response.write(body);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  try {
    await page.route("**/v1/stream**", (route) =>
      route.continue({ url: `http://127.0.0.1:${String(port)}/v1/stream` }),
    );
    await run();
  } finally {
    for (const response of live) response.destroy();
    await new Promise<void>((resolve) => {
      server.close(() => {
        resolve();
      });
    });
  }
}

test.describe("p1a-9 · the codex round", () => {

  // ---- F3: the feed live strip — hasBase threaded, no green ----------------

  test("F3: a proven feed connection is ACCENT 'streaming' — the ok token is not on this strip", async ({
    page,
  }) => {
    await page.route("**/v1/events*", (route) => appbarJson(route, FEED_CROSS_PAGE_1));
    await withHeldOpenStream(
      page,
      `event: snapshot\ndata: ${JSON.stringify(FEED_POSTURE_SNAPSHOT)}\n\n`,
      async () => {
        await page.goto("/feed");
        const chip = page.getByTestId("activity-live-state");
        await expect(chip).toHaveText("streaming");
        const color = await chip.evaluate((el) => getComputedStyle(el).color);
        // ACCENT — connection is posture, not health (the appbar's own law,
        // now held by the strip that used to contradict it one viewport down).
        expect(color).toBe(await resolveAppbarToken(page, "--accent-text"));
        expect(color).not.toBe(await resolveAppbarToken(page, "--ok"));
        expect(color).not.toBe(await resolveAppbarToken(page, "--ok-text"));
      },
    );
  });

  test("F3: open WITHOUT a base frame is 'awaiting base' — unknown register, nothing pretended", async ({
    page,
  }) => {
    await page.route("**/v1/events*", (route) => appbarJson(route, FEED_CROSS_PAGE_1));
    // The server accepts the connection and says NOTHING but a heartbeat
    // comment: streamState is "open", hasBase is false.
    await withHeldOpenStream(page, ": heartbeat 1753783205\n\n", async () => {
      await page.goto("/feed");
      const chip = page.getByTestId("activity-live-state");
      // THE MUTATION KILL: a strip that ignores hasBase renders "streaming"
      // over this connection and dies here.
      await expect(chip).toHaveText("awaiting base");
      const color = await chip.evaluate((el) => getComputedStyle(el).color);
      expect(color).toBe(await resolveAppbarToken(page, "--ink-2"));
      // And the batch line pretends nothing: no base means no batch strip.
      await expect(page.getByTestId("activity-live-none")).toContainText("nothing is pretended");
    });
  });
});
