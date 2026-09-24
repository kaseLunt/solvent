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
import { SPECIMEN_BASE_ROWS } from "../../app/styleguide/specimen-book";
import { rowStandingLabel } from "../../lib/cash-rows";
import { BRAND, GITHUB_LABEL, livePillTitle } from "../../lib/chrome";
import { livePillWords } from "../../lib/live-pill";

/** The styleguide's refused row, and the word the Book's own table gives its pill. */
const REFUSED_SPECIMEN = SPECIMEN_BASE_ROWS.flatMap((row) => (row.kind === "refused" ? [row.row] : []))[0];
const REFUSED_LABEL = REFUSED_SPECIMEN === undefined ? "missing specimen row" : rowStandingLabel(REFUSED_SPECIMEN);

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
// KpiTile, StatusPill, IdentityChips, a one-engine KitTable with its dim
// refused row and its small & dust toggle, and the Drawer with the exact
// value beside its human figure.
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
    await expect(probe).toContainText("Known-bad probe");

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

  test("the five VerdictHeader tones render their identity strips: a record is ink, only a verdict wears tone, green is a health verdict — and an empty chip list renders the refusal chip", async ({
    page,
  }) => {
    // RE-EXPRESSED from "the five banner variants render their identity strips" when VerdictBanner retired (plan
    // 2026-09-16, R7). The law is the same one — the answer never stands without its identity — on the kit's header.
    // Each tone's emphasis is read against the LIVE token, in the page's own theme: a verdict wears its -text grade,
    // a statement of record wears --ink and no colour at all, a non-answer wears --ink-2.
    const EMPHASIS_TOKEN = { crit: "--crit-text", warn: "--warn-text", ok: "--ok-text", neutral: "--ink", refused: "--ink-2" } as const;
    for (const tone of ["crit", "warn", "ok", "neutral", "refused"] as const) {
      const header = page.getByTestId(`sg-verdict-${tone}`);
      await expect(header).toBeVisible();
      await expect(header).toHaveAttribute("data-variant", tone);
      const strip = header.locator('[data-slot="identity"]');
      await expect(strip).toHaveCount(1);
      await expect(strip).toContainText(/\S/);

      const emphasis = page.getByTestId(`sg-verdict-${tone}-headline`).locator("b");
      const color = await emphasis.evaluate((el) => getComputedStyle(el).color);
      expect(color, `${tone} emphasis`).toBe(await resolveAppbarToken(page, EMPHASIS_TOKEN[tone]));
    }
    // The absent register: a headline that states there is no answer is ink-2 from its first word to its last — the
    // rest beside the emphasis too, never half-dimmed.
    const absent = page.getByTestId("sg-verdict-refused-headline");
    await expect(absent).toHaveAttribute("data-register", "absent");
    expect(await absent.evaluate((el) => getComputedStyle(el).color)).toBe(await resolveAppbarToken(page, "--ink-2"));
    await expect(page.getByTestId("sg-verdict-crit-headline")).not.toHaveAttribute("data-register", /.+/);

    // Ink is not a verdict's colour: the record's emphasis differs from every tone that is one, in this theme.
    const ink = await resolveAppbarToken(page, "--ink");
    for (const verdict of ["--crit-text", "--warn-text", "--ok-text"] as const) expect(await resolveAppbarToken(page, verdict)).not.toBe(ink);

    // Green says health and nothing else: the ok specimen is the Book's own verdict that nothing is liquidatable —
    // never a record that merely answered, and never a sentence about holes painted in the colour of health.
    const healthy = page.getByTestId("sg-verdict-ok");
    await expect(page.getByTestId("sg-verdict-ok-headline")).toHaveText("Nothing material is liquidatable on the Cash book right now.");
    await expect(healthy).not.toContainText(/absent|withheld|hole/i);
    // The record specimen is a page's own header — the API's — and its whole H1 is ink: the rest beside the emphasis too.
    const record = page.getByTestId("sg-verdict-neutral-headline");
    await expect(record).toContainText("read-only endpoints,");
    expect(await record.evaluate((el) => getComputedStyle(el).color)).toBe(ink);

    // The refused header names its cause on a dashed chip — the phrasebook's plain cause for a REAL wire code, which
    // rides in the title, never as the label.
    const cause = page.getByTestId("sg-verdict-refused").locator('[data-chip="Refused"]');
    await expect(cause).toHaveText("Refused collateral sweep failed");
    await expect(cause).toHaveAttribute("title", "SWEEP_FAILED");
    expect((await readChipRegister(cause)).borderStyle).toBe("dashed");
    // One refusal, one spelling: the mockup's lowercase code — which the phrasebook cannot read — is nowhere on the canon page.
    await expect(page.locator("body")).not.toContainText("sweep_failed_no_success");
    await expect(page.locator('[title*="sweep_failed_no_success"]')).toHaveCount(0);

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
    // FRESH: measured ink, quiet border, its tier named in the page's own words, no green.
    const fresh = page.getByTestId("sg-tier-fresh");
    await expect(fresh).toHaveText("Snapshot 48s · fresh");
    const freshRegister = await readChipRegister(fresh);
    expect(freshRegister.color).toBe(await resolveAppbarToken(page, "--ink-2"));
    expect(freshRegister.border).toBe(await resolveAppbarToken(page, "--line"));

    // AGING: amber text + border.
    const aging = page.getByTestId("sg-tier-aging");
    await expect(aging).toHaveText("Snapshot 5 min · aging");
    expect((await readChipRegister(aging)).color).toBe(
      await resolveAppbarToken(page, "--warn-text"),
    );

    // STALE: coral text, NO fill — outline only.
    const stale = page.getByTestId("sg-tier-stale");
    await expect(stale).toHaveText("Snapshot 22 min · stale");
    const staleRegister = await readChipRegister(stale);
    expect(staleRegister.color).toBe(await resolveAppbarToken(page, "--crit-text"));
    expect(staleRegister.bg).toBe("rgba(0, 0, 0, 0)");

    // CRITICAL: coral WITH fill — the one escalation fill.
    const critical = page.getByTestId("sg-tier-critical");
    await expect(critical).toHaveText("Snapshot 18 h 12 min · critical");
    const criticalRegister = await readChipRegister(critical);
    expect(criticalRegister.color).toBe(await resolveAppbarToken(page, "--crit-text"));
    expect(criticalRegister.bg).toBe(await resolveAppbarToken(page, "--crit-bg", "background"));

    // Age unknown: not a tier — dashed, never any tier's color.
    const unknown = page.getByTestId("sg-tier-unknown");
    await expect(unknown).toHaveText("Age unknown — no batch metadata");
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
    // page, not just in the stylesheet. Green is rationed — Healthy wears it.
    const healthy = page.getByTestId("sg-dim-6").getByText("Healthy · HF 1.539");
    expect((await readChipRegister(healthy)).color).toBe(
      await resolveAppbarToken(page, "--ok-text"),
    );
    // The unknown register is dashed — Unanswered is not a small refusal.
    const unanswered = page.getByTestId("sg-dim-5").getByText(/Unanswered/);
    expect((await readChipRegister(unanswered)).borderStyle).toBe("dashed");
    // No verdict is an absence, not a tier: dashed, in ink-2, never amber.
    const unavailable = await readChipRegister(page.getByTestId("sg-dim-6-unavailable"));
    expect(unavailable.borderStyle).toBe("dashed");
    expect(unavailable.color).toBe(await resolveAppbarToken(page, "--ink-2"));
    // Sentence case: the chips' state words are written as they read, never in capitals (an acronym such as HTTP is not a word).
    for (const id of ["sg-freshness", "sg-dimensions", "sg-states"]) {
      const words = await page.getByTestId(id).evaluate((el) => el.textContent ?? "");
      expect(words, id).not.toMatch(/\b(?!HTTP\b)[A-Z]{4,}\b/);
    }

    // Composition 1 — the brief's named specimen: Liquidatable · Dust ·
    // Computed · Snapshot 18h (fixed §6 order: verdict · materiality ·
    // knowledge · freshness). Both crit-fill chips carry the ONE escalation
    // fill, resolved.
    const composition = page.getByTestId("sg-comp-1");
    const liquidatable = composition.getByText("Liquidatable · HF 0.4971");
    await expect(liquidatable).toBeVisible();
    expect((await readChipRegister(liquidatable)).bg).toBe(
      await resolveAppbarToken(page, "--crit-bg", "background"),
    );
    await expect(composition.getByText("Dust · <$0.01")).toBeVisible();
    await expect(composition.getByText("Computed", { exact: true })).toBeVisible();
    await expect(composition.getByText("Snapshot 18 h 12 min · critical")).toBeVisible();

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

  test("the six states mount with their honest copy — and a refused row prints an em dash under the pill that names it, never 0 and never $0", async ({
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
      "Refused · collateral sweep failed · SWEEP_FAILED",
    );
    await expect(page.getByTestId("sg-state-unavailable")).toContainText("30 batches not retained");
    await expect(page.getByTestId("sg-state-invalid")).toContainText("0x80b3f19e2a6cZZZZ");
    await expect(page.getByTestId("sg-state-superseded")).toContainText(
      "A late response never overwrites a newer request context.",
    );

    // The specimen follows the Book's table: a refused row's figures — room and debt — each print an em dash, and
    // the row's pill names the refusal. No cell of that row is ever a zero: an unknowable figure is not a small one.
    const refusedRow = page.getByTestId("sg-table-row-refused");
    const refusedCells = refusedRow.locator("td");
    await expect(refusedCells).toHaveCount(4);
    await expect(refusedCells.filter({ hasText: /^—$/ })).toHaveCount(2);
    for (const text of await refusedCells.allInnerTexts()) {
      expect(text.trim(), "a refused row never prints a zero").not.toMatch(/^\$?0(\.0+)?$/);
    }
    await expect(refusedRow.locator('[data-tone="refused"]')).toHaveText(REFUSED_LABEL);
  });

  test("the state registers: a refusal and an unreadable answer are dashed, every other absence solid — a failed fetch is never drawn as a refusal, and a step with no figure says its state", async ({
    page,
  }) => {
    const FRAME = {
      refused: "dashed",
      unavailable: "solid",
      "not-run": "solid",
      "not-served": "solid",
      pending: "solid",
      unreadable: "dashed",
    } as const;
    for (const [state, frame] of Object.entries(FRAME)) {
      const card = page.getByTestId(`sg-statecard-${state}`);
      await expect(card).toHaveAttribute("data-state", state);
      expect((await readChipRegister(card)).borderStyle, state).toBe(frame);
    }
    await expect(page.getByTestId("sg-statecard-pending")).toHaveAttribute("aria-busy", "true");
    await expect(page.getByTestId("sg-statecard-unavailable")).not.toHaveAttribute("aria-busy", /.+/);
    // The service's own words sit behind a disclosure, verbatim — relocated, never removed.
    const said = page.getByTestId("sg-statecard-refused").locator("details");
    await expect(said.locator("summary")).toHaveText("What the service said");
    await expect(said.locator("pre")).toHaveText("SWEEP_FAILED: collateral sweep failed");
    // A step with no figure prints its state's word, never a dash; the other steps keep their figures.
    await expect(page.getByTestId("sg-steps-strip-verify")).toHaveAttribute("data-state", "unavailable");
    await expect(page.getByTestId("sg-steps-strip-verify")).toContainText("Unavailable");
    await expect(page.getByTestId("sg-steps-strip")).not.toContainText("—");
    await expect(page.getByTestId("sg-steps-strip-index")).toContainText("01");
    await expect(page.getByTestId("sg-steps-strip-index")).toContainText("Index");
  });

  test("the toggle group: one Tab stop, arrows move, Home and End jump, Space presses — a single-choice group keeps one pressed, a multi-choice group any set", async ({
    page,
  }) => {
    const engine = page.getByTestId("sg-tg-engine");
    await expect(engine).toHaveAttribute("role", "group");
    await expect(engine.locator("span").first()).toHaveText("Engine");
    await expect(engine.getByRole("button")).toHaveCount(3);
    const all = page.getByTestId("sg-tg-engine-all");
    const cash = page.getByTestId("sg-tg-engine-debt_manager");
    const legacy = page.getByTestId("sg-tg-engine-aave_v3_etherfi");
    await expect(all).toHaveAttribute("aria-pressed", "true");
    // One stop: the pressed option carries it, the others are reached by arrow.
    await expect(all).toHaveAttribute("tabindex", "0");
    await expect(cash).toHaveAttribute("tabindex", "-1");
    await all.focus();
    await page.keyboard.press("ArrowRight");
    await expect(cash).toBeFocused();
    await page.keyboard.press("Space");
    await expect(cash).toHaveAttribute("aria-pressed", "true");
    await expect(all).toHaveAttribute("aria-pressed", "false");
    await page.keyboard.press("End");
    await expect(legacy).toBeFocused();
    await page.keyboard.press("Home");
    await expect(all).toBeFocused();
    // Tab leaves the group, onto the next group's one stop — its first option, since none is pressed.
    await page.keyboard.press("Tab");
    const borrow = page.getByTestId("sg-tg-type-borrow");
    await expect(borrow).toBeFocused();
    await page.keyboard.press("Space");
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("Space");
    await expect(borrow).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("sg-tg-type-liquidation")).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("sg-tg-type-repay")).toHaveAttribute("aria-pressed", "false");
    // The wire's own word rides in the title, the page's word is the label.
    await expect(page.getByTestId("sg-tg-type-deficit_created")).toHaveText("Bad debt realized");
    await expect(page.getByTestId("sg-tg-type-deficit_created")).toHaveAttribute("title", "deficit_created");
  });

  test("the live pill specimens: live is the accent and never green, a fresh age is ink and an aging age amber; the phone form keeps the word and folds the rest into the title", async ({
    page,
  }) => {
    const connected = page.getByTestId("sg-live-connected");
    await expect(connected).toHaveText("Live · batch 18,251 · 42s ago");
    const dot = connected.locator("span").first();
    const dotColour = await dot.evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(dotColour).toBe(await resolveAppbarToken(page, "--accent", "background"));
    expect(dotColour).not.toBe(await resolveAppbarToken(page, "--ok", "background"));
    const freshAge = page.getByTestId("sg-live-connected-more").locator("span").last();
    expect(await freshAge.evaluate((el) => getComputedStyle(el).color)).toBe(await resolveAppbarToken(page, "--ink"));
    const agingAge = page.getByTestId("sg-live-aging-more").locator("span").last();
    expect(await agingAge.evaluate((el) => getComputedStyle(el).color)).toBe(await resolveAppbarToken(page, "--warn-text"));
    expect(await page.getByTestId("sg-live-reconnecting").locator("span").first().evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(
      await resolveAppbarToken(page, "--warn", "background"),
    );
    // The phone form: the word and its dot on the line; the batch and the age in the accessibility tree and the title.
    const words = livePillWords({ streamState: "open", hasBase: true, batchId: 18_251, ageSeconds: 42, ageUnresolved: false, tier: "fresh" });
    const phone = page.getByTestId("sg-live-phone-pill");
    await expect(phone).toHaveAttribute("title", livePillTitle(words));
    await expect(phone).toHaveAttribute("title", "Live updates are on. Batch 18,251 · 42s ago.");
    const folded = page.getByTestId("sg-live-phone-pill-more");
    await expect(folded).toContainText("batch 18,251");
    expect((await folded.boundingBox())?.width ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual(1);
    // An aging or stale age is a warning, never folded away: the phone form keeps it on the line and folds the batch.
    const agingMore = page.getByTestId("sg-live-phone-aging-more");
    expect((await agingMore.locator("span").last().boundingBox())?.width ?? 0).toBeGreaterThan(20);
    expect((await agingMore.locator("span").first().boundingBox())?.width ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual(1);
    // The 390px header row holds the brand, the pill and both controls, without scrolling.
    const row = page.getByTestId("sg-live-phone");
    expect(await row.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(0);
  });

  test("the kit table: the refused row stays rendered and dimmed, and one engine's small & dust rows fold behind a toggle that names them", async ({
    page,
  }) => {
    const table = page.getByTestId("sg-table-kit");
    const refused = page.getByTestId("sg-table-row-refused");
    await expect(refused).toBeVisible();

    // One engine, as the Book's table is: no Engine column, so no count or sum here can cross engines.
    await expect(table.locator("thead th")).toHaveText(["Account", "Room", "Debt", "Status"]);

    // Dimmed, never dropped: the dash is a bare text node, so the glyph itself takes the dim row's --ink-3.
    const dash = refused.locator("td").nth(1);
    await expect(dash).toHaveText("—");
    expect(await dash.evaluate((el) => el.childElementCount)).toBe(0);
    expect(await dash.evaluate((el) => getComputedStyle(el).color)).toBe(
      await resolveAppbarToken(page, "--ink-3"),
    );

    // The status column names the refusal: the label is the state, the title the plain cause then the wire code.
    const pill = refused.locator('[data-tone="refused"]');
    await expect(pill).toHaveText(REFUSED_LABEL);
    await expect(pill).toHaveAttribute("title", "collateral sweep failed · SWEEP_FAILED");

    // Folded by default — and the toggle names what it hides: the count and the summed debt of ONE engine's
    // below-the-line rows ($61.20 + $14.55).
    const toggle = page.getByTestId("sg-table-toggle");
    await expect(toggle).toHaveAttribute("role", "switch");
    await expect(toggle).toHaveAttribute("aria-checked", "false");
    await expect(toggle).toHaveText("Show 2 accounts under $100 ($75.75)");
    await expect(table.locator("tbody tr")).toHaveCount(4);
    await expect(page.getByTestId("sg-table-row-small-2")).toHaveCount(0);

    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-checked", "true");
    await expect(table.locator("tbody tr")).toHaveCount(6);
    await expect(page.getByTestId("sg-table-row-small-1")).toContainText("$61.20");
    // A row is named for the materiality tier it falls under: both folded rows are over $1, so both are "small". With
    // the fold open, the $14.55 row IS in the table under that name, and no row of the same table is named "dust".
    await expect(table.getByTestId("sg-table-row-small-2")).toContainText("$14.55");
    await expect(table.getByTestId("sg-table-row-dust")).toHaveCount(0);
    // The refused row never folds, in either position.
    await expect(refused).toBeVisible();
  });

  test("the drawer is the exact value's home: the human figure with its exact wire value beside it", async ({
    page,
  }) => {
    await page.getByTestId("sg-drawer-open").click();
    const exact = page.getByRole("dialog").getByTestId("sg-drawer-exact");
    await expect(exact).toContainText("$6,840");
    await expect(exact.locator("code")).toHaveText("6,840.238278");
    // One number in three places: the drawer's human figure is the crit header's, and both are the table's rows' sum.
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("sg-verdict-crit-headline").locator("b")).toHaveText("$6,840 of Cash debt is liquidatable right now,");
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
    // A refused tile that carries a real count keeps its number: dashed, the figure in ink-2 — never a tier's color.
    const refusedTile = page.getByTestId("sg-kpi-refused");
    expect((await readChipRegister(refusedTile)).borderStyle).toBe("dashed");
    const count = refusedTile.getByText("6", { exact: true });
    expect(await count.evaluate((el) => getComputedStyle(el).color)).toBe(
      await resolveAppbarToken(page, "--ink-2"),
    );
    // A tile with no figure prints its state's word in its register's frame — never a dash, never a zero — and
    // stands as tall as a figure tile: the word sits on the figure's line.
    const figureLine = await page.getByTestId("sg-kpi-neutral").locator("div").nth(1).boundingBox();
    for (const [state, word, frame] of [
      ["refused", "Refused", "dashed"],
      ["unavailable", "Unavailable", "solid"],
      ["not-run", "Not run", "solid"],
      ["not-served", "Not served", "solid"],
      ["unreadable", "Unreadable", "dashed"],
    ] as const) {
      const tile = page.getByTestId(`sg-kpi-state-${state}`);
      await expect(tile).toHaveAttribute("data-state", state);
      await expect(tile.locator("div").nth(1)).toHaveText(word);
      await expect(tile).not.toContainText("—");
      expect((await readChipRegister(tile)).borderStyle, state).toBe(frame);
      expect(await tile.locator("div").nth(1).evaluate((el) => getComputedStyle(el).color), state).toBe(
        await resolveAppbarToken(page, "--ink-2"),
      );
      const stateLine = await tile.locator("div").nth(1).boundingBox();
      expect(Math.abs((stateLine?.height ?? 0) - (figureLine?.height ?? Number.NaN)), state).toBeLessThanOrEqual(1);
    }
    // The lib's own word wins over the register's where it has one.
    await expect(page.getByTestId("sg-kpi-state-word").locator("div").nth(1)).toHaveText("No verdict");
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
      ["refused", REFUSED_LABEL],
      ["live", "Serving"],
      ["projection", "Projection · ETH −20% v3"],
    ] as const) {
      await expect(pills.locator(`[data-tone="${tone}"]`)).toHaveText(label);
    }
    // Live is posture: the accent, never green.
    expect(await pills.locator('[data-tone="live"]').evaluate((el) => getComputedStyle(el).color)).toBe(
      await resolveAppbarToken(page, "--accent-text"),
    );
    await expect(pills.locator('[data-tone="refused"]')).toHaveAttribute("title", "collateral sweep failed · SWEEP_FAILED");
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
    // A label-only chip prints its words alone — no empty bold — and the actions take their own column, never
    // wrapping under a chip.
    const actions = page.getByTestId("sg-identity-actions");
    const labelOnly = actions.locator('[data-chip="Current, not projected"]');
    await expect(labelOnly).toHaveText("Current, not projected");
    await expect(labelOnly.locator("b")).toHaveCount(0);
    const chipBox = await labelOnly.boundingBox();
    const actionBox = await actions.getByRole("link").boundingBox();
    expect((actionBox?.x ?? 0) > (chipBox?.x ?? 0) + (chipBox?.width ?? 0)).toBe(true);
  });

  test("the type section documents the one scale the pages use — all twelve --type-* tokens", async ({ page }) => {
    const tokens = page.locator('[data-testid="type-token"]');
    await expect(tokens).toHaveCount(12);
    for (const text of await tokens.allInnerTexts()) expect(text).toMatch(/^--type-/);
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

  test("F3: a proven feed connection is ACCENT 'Streaming' — the ok token is not on this strip", async ({
    page,
  }) => {
    await page.route("**/v1/events*", (route) => appbarJson(route, FEED_CROSS_PAGE_1));
    await withHeldOpenStream(
      page,
      `event: snapshot\ndata: ${JSON.stringify(FEED_POSTURE_SNAPSHOT)}\n\n`,
      async () => {
        await page.goto("/feed");
        const chip = page.getByTestId("activity-live-state");
        await expect(chip).toHaveText("Streaming");
        const color = await chip.evaluate((el) => getComputedStyle(el).color);
        // ACCENT — connection is posture, not health (the appbar's own law,
        // now held by the strip that used to contradict it one viewport down).
        expect(color).toBe(await resolveAppbarToken(page, "--accent-text"));
        expect(color).not.toBe(await resolveAppbarToken(page, "--ok"));
        expect(color).not.toBe(await resolveAppbarToken(page, "--ok-text"));
      },
    );
  });

  test("F3: open WITHOUT a base frame is 'Awaiting first batch' — unknown register, nothing pretended", async ({
    page,
  }) => {
    await page.route("**/v1/events*", (route) => appbarJson(route, FEED_CROSS_PAGE_1));
    // The server accepts the connection and says NOTHING but a heartbeat
    // comment: streamState is "open", hasBase is false.
    await withHeldOpenStream(page, ": heartbeat 1753783205\n\n", async () => {
      await page.goto("/feed");
      const chip = page.getByTestId("activity-live-state");
      // THE MUTATION KILL: a strip that ignores hasBase renders "Streaming"
      // over this connection and dies here.
      await expect(chip).toHaveText("Awaiting first batch");
      const color = await chip.evaluate((el) => getComputedStyle(el).color);
      expect(color).toBe(await resolveAppbarToken(page, "--ink-2"));
      // And the batch line pretends nothing: no base means no batch strip.
      await expect(page.getByTestId("activity-live-none")).toContainText("nothing live is shown");
    });
  });
});

// ===========================================================================
// The header: one frame with the content, two quiet controls, and a live pill
// that is posture (the accent, never green) and fits a phone when connected.
// The connected pill needs a held-open stream, so these run on the API page,
// which is static: the header is the only thing under test.
// ===========================================================================

/** The same wide face the wide-font spec forces: Verdana on Windows, DejaVu Sans where Verdana is absent. */
const WIDE_FACE = `:root {
  --sans: Verdana, "DejaVu Sans", sans-serif !important;
  --mono: "Courier New", "Liberation Mono", "DejaVu Sans Mono", monospace !important;
}`;

const CONNECTED = `event: snapshot\ndata: ${JSON.stringify(FEED_POSTURE_SNAPSHOT)}\n\n`;

test.describe("the header · one frame, quiet controls, a live pill that is posture", () => {
  test("at 1440 a connected pill says Live, its batch and its age: the dot is the accent, the fresh age is ink — and the brand stands on the content's edge", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await withHeldOpenStream(page, CONNECTED, async () => {
      await page.goto("/developers");
      const header = page.getByRole("banner");
      const pill = header.getByTestId("live-pill");
      await expect(pill).toHaveAttribute("data-word", "Live");
      await expect(pill).toHaveAttribute("data-tone", "live");
      const more = header.getByTestId("live-pill-more");
      await expect(more).toContainText("batch 1");
      await expect(more).toContainText("ago");
      expect((await more.boundingBox())?.width ?? 0).toBeGreaterThan(40);
      const dotColour = await pill.locator("span").first().evaluate((el) => getComputedStyle(el).backgroundColor);
      expect(dotColour).toBe(await resolveAppbarToken(page, "--accent", "background"));
      expect(dotColour).not.toBe(await resolveAppbarToken(page, "--ok", "background"));
      expect(await more.locator("span").last().evaluate((el) => getComputedStyle(el).color)).toBe(await resolveAppbarToken(page, "--ink"));
      await expect(pill).toHaveAttribute("title", /^Live updates are on\. Batch 1 · .+ ago\.$/);
      // One frame: the header's brand starts on the content's left edge, the headline's.
      const brand = await header.getByRole("link", { name: BRAND.linkLabel }).boundingBox();
      const headline = await page.locator("main h1").first().boundingBox();
      expect(Math.abs((brand?.x ?? 0) - (headline?.x ?? Number.NaN))).toBeLessThanOrEqual(1);
    });
  });

  test("at 390 under a wide face a connected header holds brand, pill and both controls on one row — the pill folds its batch and age into its title — the current tab is in view, and nothing scrolls sideways", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 800 });
    await withHeldOpenStream(page, CONNECTED, async () => {
      await page.goto("/developers");
      const header = page.getByRole("banner");
      const pill = header.getByTestId("live-pill");
      await expect(pill).toHaveAttribute("data-word", "Live");
      // The nav is a strip of its own under the first row, scrolled so the current page's tab is in view.
      const nav = header.getByRole("navigation");
      const navBox = await nav.boundingBox();
      const current = await nav.locator('[aria-current="page"]').boundingBox();
      if (navBox === null || current === null) throw new Error("the nav or its current tab has no box");
      expect(current.x).toBeGreaterThanOrEqual(navBox.x - 1);
      expect(current.x + current.width).toBeLessThanOrEqual(navBox.x + navBox.width + 1);

      await page.addStyleTag({ content: WIDE_FACE });
      await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(() => done(null)))));
      // The batch and the age leave the line and stay in the accessibility tree and the title.
      const more = header.getByTestId("live-pill-more");
      await expect(more).toContainText("batch 1");
      expect((await more.boundingBox())?.width ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual(1);
      await expect(pill).toHaveAttribute("title", /Batch 1 · .+ ago\.$/);
      // One row: brand, pill, source link and theme control share a centre line, inside the 16px gutter.
      const row = [
        header.getByRole("link", { name: BRAND.linkLabel }),
        pill,
        header.getByRole("link", { name: GITHUB_LABEL }),
        header.getByRole("button", { name: /^Theme: / }),
      ];
      const boxes = await Promise.all(row.map((item) => item.boundingBox()));
      const centres = boxes.map((box) => (box === null ? Number.NaN : box.y + box.height / 2));
      for (const centre of centres) expect(Math.abs(centre - (centres[0] ?? Number.NaN))).toBeLessThanOrEqual(2);
      const last = boxes[boxes.length - 1];
      expect((last?.x ?? 0) + (last?.width ?? Number.POSITIVE_INFINITY)).toBeLessThanOrEqual(390 - 16 + 1);
      expect((await nav.boundingBox())?.y ?? 0).toBeGreaterThan((boxes[0]?.y ?? 0) + (boxes[0]?.height ?? 0) - 1);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, `the page scrolls sideways by ${String(overflow)}px`).toBeLessThanOrEqual(0);
    });
  });

  test("at 1024 the header takes two rows — brand and status, then the nav strip — and the page never scrolls sideways", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1024, height: 800 });
    await page.route("**/v1/**", (route) => route.abort());
    await page.goto("/developers");
    const header = page.getByRole("banner");
    const brand = await header.getByRole("link", { name: BRAND.linkLabel }).boundingBox();
    const nav = await header.getByRole("navigation").boundingBox();
    expect((nav?.y ?? 0)).toBeGreaterThan((brand?.y ?? 0) + (brand?.height ?? 0) - 1);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
