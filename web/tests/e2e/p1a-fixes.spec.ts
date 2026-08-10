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
import { BOOK, POSITIONS_AAVE_PAGE_1 } from "../fixtures/book";
import { FEED_POSTURE_SNAPSHOT } from "../fixtures/feed";

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
// p1a-4 — THE CANON APPBAR (build-contract §10).
//
// The header's one-badge vocabulary becomes the appbar: STREAM <state> chip ·
// SNAPSHOT <age> · <TIER> chip · BATCH #id chip · COVERAGE n/n chip · a
// "Data status →" popover holding the raw watermark as-ofs. The audited
// `LIVE · WATERMARKED` single badge is RETIRED: "a healthy transport must not
// launder a stale analysis" (canon house law 3). Tier styling is COMPUTED
// from the ratified §06 bounds (fresh ≤ 120 · aging ≤ 360 · stale ≤ 5580 ·
// critical beyond, under the /v1/meta constants or the disclosed fallback),
// never painted by hand — these pins resolve the chip's rendered colors
// against the live tokens so a chip that stops computing its tier dies here.
// ===========================================================================

const APPBAR_CORS = { "access-control-allow-origin": "*" };

/** The committed fixture snapshot at a chosen age (and optional batch edits). */
function appbarSnapshotFrame(
  ageSeconds: number,
  mutate?: (batch: NonNullable<(typeof FEED_POSTURE_SNAPSHOT)["batch"]>) => void,
): string {
  const payload = structuredClone(FEED_POSTURE_SNAPSHOT);
  if (payload.batch === null || payload.batch === undefined) {
    throw new Error("fixture shape drifted");
  }
  payload.batch.age_seconds = ageSeconds;
  mutate?.(payload.batch);
  return `event: snapshot\ndata: ${JSON.stringify(payload)}\n\n`;
}

/**
 * A stream that delivers the snapshot and ENDS the body — a server hang-up,
 * so the stream chip reads STREAM RECONNECTING while the batch, its chips and
 * the popover all render from the retained snapshot. Re-registering the same
 * pattern overrides the previous handler (Playwright routes match last-first),
 * which is how the tier test walks the ages.
 */
async function mockAppbarStream(
  page: Page,
  ageSeconds: number,
  mutate?: (batch: NonNullable<(typeof FEED_POSTURE_SNAPSHOT)["batch"]>) => void,
): Promise<void> {
  await page.route("**/v1/stream**", (route) =>
    route.fulfill({
      status: 200,
      headers: { ...APPBAR_CORS, "content-type": "text/event-stream" },
      body: appbarSnapshotFrame(ageSeconds, mutate),
    }),
  );
}

function appbarJson(route: Route, body: unknown): Promise<void> {
  return route.fulfill({
    status: 200,
    headers: APPBAR_CORS,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
}

async function mockAppbarBook(page: Page): Promise<void> {
  await page.route("**/v1/book", (route) => appbarJson(route, BOOK));
  await page.route("**/v1/positions*", (route) => appbarJson(route, POSITIONS_AAVE_PAGE_1));
}

/**
 * /v1/meta unreachable — the tier constants MUST come from the disclosed
 * built-in fallback, deterministically (a live API on the developer's machine
 * must not be able to feed this test a different trio).
 */
async function muteAppbarMeta(page: Page): Promise<void> {
  await page.route("**/v1/meta*", (route) => route.abort());
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

test.describe("p1a-4 · the canon appbar", () => {
  test("each truth is its own chip — and LIVE · WATERMARKED is retired", async ({ page }) => {
    await page.clock.install();
    await muteAppbarMeta(page);
    await mockAppbarStream(page, 42);
    await mockAppbarBook(page);
    await page.goto("/book?engine=aave_v3_etherfi");

    const header = page.getByRole("banner");
    // The connection states ITSELF (the mock hangs up after the snapshot).
    await expect(header.getByText("STREAM RECONNECTING")).toBeVisible();
    // The snapshot chip: FRESH renders measured ink with NO tier word — and
    // the p0 vocabulary ("snapshot #N · Xs old") is gone with the badge.
    const chip = header.getByTestId("ribbon-snapshot");
    await expect(chip).toHaveText("SNAPSHOT 42s");
    await expect(chip).not.toContainText("old");
    // Batch identity and coverage are their own chips, from the batch's own
    // envelope (2 stamped engines, none withheld).
    await expect(header.getByTestId("ribbon-batch")).toHaveText("BATCH #1");
    await expect(header.getByTestId("ribbon-coverage")).toHaveText("COVERAGE 2/2 ENGINES");
    // The popover affordance is part of the bar.
    await expect(header.getByTestId("ribbon-data-status")).toBeVisible();
    // THE RETIREMENT, header-wide.
    await expect(header.getByText("LIVE · WATERMARKED")).toHaveCount(0);
    // /v1/meta is unreachable here, so the chip DISCLOSES that its thresholds
    // are the built-in fallback (task-3 carry-in wording, exact).
    await expect(chip).toHaveAttribute(
      "title",
      /thresholds from built-in fallback — \/v1\/meta unavailable/,
    );
  });

  test("tier styling is computed from the ratified bounds — quiet, warn, crit outline, crit fill", async ({
    page,
  }) => {
    await page.clock.install();
    await muteAppbarMeta(page);
    await mockAppbarBook(page);
    const chip = page.getByTestId("ribbon-snapshot");

    // FRESH (42s ≤ 2×60): measured ink, quiet border, NO tier word, no green.
    await mockAppbarStream(page, 42);
    await page.goto("/book?engine=aave_v3_etherfi");
    await expect(chip).toHaveText("SNAPSHOT 42s");
    const quiet = await readChipRegister(chip);
    expect(quiet.color).toBe(await resolveAppbarToken(page, "--ink-2"));
    expect(quiet.border).toBe(await resolveAppbarToken(page, "--line"));

    // AGING (300s ≤ 360): amber text + border.
    await mockAppbarStream(page, 300);
    await page.goto("/book?engine=aave_v3_etherfi");
    await expect(chip).toHaveText("SNAPSHOT 5m · AGING");
    const aging = await readChipRegister(chip);
    expect(aging.color).toBe(await resolveAppbarToken(page, "--warn-text"));
    expect(aging.border).toBe(await resolveAppbarToken(page, "--warn"));

    // STALE (3550s ≤ 5580): coral text, NO fill — outline only.
    await mockAppbarStream(page, 3550);
    await page.goto("/book?engine=aave_v3_etherfi");
    await expect(chip).toHaveText("SNAPSHOT 59m · STALE");
    const stale = await readChipRegister(chip);
    expect(stale.color).toBe(await resolveAppbarToken(page, "--crit-text"));
    expect(stale.border).toBe(await resolveAppbarToken(page, "--crit"));
    expect(stale.bg).toBe("rgba(0, 0, 0, 0)");

    // CRITICAL (65,532s > 5580): coral WITH fill — the one escalation fill,
    // shared with critical comparators and nothing else.
    await mockAppbarStream(page, 65_532);
    await page.goto("/book?engine=aave_v3_etherfi");
    await expect(chip).toHaveText("SNAPSHOT 18h 12m · CRITICAL");
    const critical = await readChipRegister(chip);
    expect(critical.color).toBe(await resolveAppbarToken(page, "--crit-text"));
    expect(critical.bg).toBe(await resolveAppbarToken(page, "--crit-bg", "background"));
  });

  test("raw watermark heights live in the Data status popover — not in the bar", async ({
    page,
  }) => {
    await page.clock.install();
    await muteAppbarMeta(page);
    await mockAppbarStream(page, 42);
    await mockAppbarBook(page);
    await page.goto("/book?engine=aave_v3_etherfi");

    const header = page.getByRole("banner");
    await expect(header.getByTestId("ribbon-snapshot")).toBeVisible();
    // Demoted: the raw block height is NOT bar chrome any more.
    await expect(header.getByText("@25,635,618")).toBeHidden();
    // Open the popover: the full watermark VECTOR is there — per-engine
    // heights and the sweep's own as-of. Never a single fake block.
    await header.getByTestId("ribbon-data-status").click();
    await expect(header.getByText("@25,635,618")).toBeVisible();
    await expect(header.getByText("@154,796,552")).toBeVisible();
    await expect(header.getByText("debt_manager sweep")).toBeVisible();
  });

  test("partial coverage WARNS and NAMES the withheld engine", async ({ page }) => {
    // p1a-4b (review finding): every stream fixture ships refused_engines: [],
    // so the warn arm was reachable but unpinned. debt_manager IS stamped and
    // its whole book is withheld — the chip counts it and names it.
    await page.clock.install();
    await muteAppbarMeta(page);
    await mockAppbarStream(page, 42, (batch) => {
      batch.refused_engines = ["debt_manager"];
    });
    await mockAppbarBook(page);
    await page.goto("/book?engine=aave_v3_etherfi");

    const chip = page.getByRole("banner").getByTestId("ribbon-coverage");
    await expect(chip).toHaveText("COVERAGE 1/2 ENGINES · debt_manager WITHHELD");
    // The warn register, resolved — a chip that stops warning dies here.
    const register = await chip.evaluate((el) => {
      const cs = getComputedStyle(el);
      return { color: cs.color, border: cs.borderTopColor };
    });
    expect(register.color).toBe(await resolveAppbarToken(page, "--warn-text"));
    expect(register.border).toBe(await resolveAppbarToken(page, "--warn"));
  });

  test("an UNBINDABLE refusal withholds the coverage chip entirely — never an invented count", async ({
    page,
  }) => {
    // The wire names a refused engine that carries NO stamp: the arithmetic
    // has no honest denominator, so there is no chip — rather than a fraction
    // computed over a vector that does not bind the name (Track B envelope
    // gap, ledgered §p1a-4).
    await page.clock.install();
    await muteAppbarMeta(page);
    await mockAppbarStream(page, 42, (batch) => {
      batch.refused_engines = ["ghost_engine"];
    });
    await mockAppbarBook(page);
    await page.goto("/book?engine=aave_v3_etherfi");

    const header = page.getByRole("banner");
    // The rest of the appbar still renders — only the underivable chip is
    // withheld.
    await expect(header.getByTestId("ribbon-batch")).toHaveText("BATCH #1");
    await expect(header.getByTestId("ribbon-snapshot")).toHaveText("SNAPSHOT 42s");
    await expect(header.getByTestId("ribbon-coverage")).toHaveCount(0);
  });

  test("SUPERSEDED is a chip in the warn register", async ({ page }) => {
    await page.clock.install();
    await muteAppbarMeta(page);
    await mockAppbarStream(page, 42, (batch) => {
      batch.supersession.superseded = true;
    });
    await mockAppbarBook(page);
    await page.goto("/book?engine=aave_v3_etherfi");

    const chip = page.getByRole("banner").getByText("SUPERSEDED", { exact: true });
    await expect(chip).toBeVisible();
    const register = await chip.evaluate((el) => {
      const cs = getComputedStyle(el);
      return { color: cs.color, border: cs.borderTopColor };
    });
    expect(register.color).toBe(await resolveAppbarToken(page, "--warn-text"));
    expect(register.border).toBe(await resolveAppbarToken(page, "--warn"));
  });

  test("a genuinely open stream is STREAM CONNECTED — an accent chip, never green, never LIVE", async ({
    page,
  }) => {
    // A held-open SSE server (route.fulfill would end the body — a hang-up).
    let count = 0;
    const live = new Set<ServerResponse>();
    const server: Server = createServer((_request, response) => {
      count += 1;
      live.add(response);
      response.on("close", () => live.delete(response));
      response.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-store",
        ...APPBAR_CORS,
      });
      response.write(appbarSnapshotFrame(42));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as AddressInfo).port;

    try {
      await page.route("**/v1/stream**", (route) =>
        route.continue({ url: `http://127.0.0.1:${String(port)}/v1/stream` }),
      );
      await muteAppbarMeta(page);
      await mockAppbarBook(page);
      await page.goto("/book?engine=aave_v3_etherfi");

      const header = page.getByRole("banner");
      const connected = header.getByText("STREAM CONNECTED");
      await expect(connected).toBeVisible();
      // The retirement holds at the exact posture that used to paint the badge.
      await expect(header.getByText("LIVE · WATERMARKED")).toHaveCount(0);
      // Accent register — connection is posture, not health: NEVER green.
      const register = await connected.evaluate((el) => getComputedStyle(el).color);
      expect(register).toBe(await resolveAppbarToken(page, "--accent-text"));
      expect(register).not.toBe(await resolveAppbarToken(page, "--ok"));
      expect(count).toBe(1);
    } finally {
      for (const response of live) response.destroy();
      await new Promise<void>((resolve) => {
        server.close(() => {
          resolve();
        });
      });
    }
  });
});

// ===========================================================================
// p1a-6 — THE STYLEGUIDE IS THE LIVING CANON (build-contract §2, §4–§9, §11).
//
// The /styleguide route is the component kit's first mount and the canon's
// self-verifying specimen page: swatch contrast is MEASURED live from
// resolved styles (never printed from a table), the §6 nine dimensions and
// §4 five banner variants mount with their exact copy, and one specimen
// chart carries the §11 interaction register — the reference implementation
// Phase 3 copies.
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

  test("the five banner variants render their identity strips — and the structural refusal names the omission", async ({
    page,
  }) => {
    for (const variant of ["current", "refused", "superseded", "empty", "partial"] as const) {
      const banner = page.getByTestId(`sg-verdict-${variant}`);
      await expect(banner).toBeVisible();
      await expect(banner).toHaveAttribute("data-variant", variant);
      // THE RATIFIED LAW, in the DOM: the identity strip exists and is
      // non-empty on every lawful banner (task-5 carry-in pin).
      const strip = banner.locator('[data-slot="identity"]');
      await expect(strip).toHaveCount(1);
      await expect(strip).toContainText(/\S/);
    }

    // The current banner's value wears the exact affordance (§7 mandatory
    // wherever human ≠ exact): layer 2 is served via title.
    await expect(
      page.getByTestId("sg-verdict-current").locator('[title="$8,468.238278"]'),
    ).toBeVisible();

    // The law's own specimen: a banner composed WITHOUT its strip renders the
    // warn-register structural refusal — data-variant still names what was
    // asked for (task-5 carry-in: evaluated and agreed — the refusal render
    // keeps the requested variant AND wears the refusal marker).
    const refusal = page.getByTestId("sg-verdict-refusal-law");
    await expect(refusal).toHaveAttribute("data-identity-refusal", "missing-identity-strip");
    await expect(refusal).toHaveAttribute("data-variant", "current");
    await expect(refusal).toContainText("Verdict withheld");
    await expect(refusal.locator('[data-slot="identity"]')).toHaveCount(0);
  });

  test("the freshness tier row renders all five states in the appbar recipes", async ({ page }) => {
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

    // §9 reskin: the refused row's money cells print the word in amber — no
    // em dash that reads as an empty zero.
    await expect(page.getByTestId("sg-table").getByText("refused", { exact: true })).toHaveCount(2);
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
});
