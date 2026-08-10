// Track A / p1a-1 — the RENDERED side of the foundation token contract.
//
// tests/unit/tokens-contract.spec.ts pins the stylesheet SOURCE; these pins
// prove the built app actually serves it: the §02 width steps reach the live
// `main.shell` box, and the §04 palette amendments resolve through the full
// light-first + media + data-theme cascade in both themes.

import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

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
