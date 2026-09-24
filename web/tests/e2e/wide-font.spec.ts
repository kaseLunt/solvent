// No page scrolls sideways at 390 wide under a WIDE face. The font stacks are system stacks: Windows draws Segoe UI,
// but a Linux reader (and the CI runner) has no Segoe UI and draws system-ui in DejaVu Sans, several percent wider —
// wide enough that a label or chip which fits on the developer's machine pushed three pages past the viewport. The
// face is forced here so the developer's machine measures what those readers see: Verdana on Windows (DejaVu Sans's
// metrics come from Bitstream Vera, close to Verdana's), DejaVu Sans where Verdana is absent. A page may wrap, stack or
// scroll a table inside its card; the page itself never scrolls sideways.
import { expect, test } from "@playwright/test";
import { DEMO_PAGES, mockDemo } from "./demo-pages";

const WIDE_FACE = `:root {
  --sans: Verdana, "DejaVu Sans", sans-serif !important;
  --mono: "Courier New", "Liberation Mono", "DejaVu Sans Mono", monospace !important;
}`;

for (const page of DEMO_PAGES) {
  test(`${page.name} at 390 wide under a wide face: nothing scrolls the page sideways`, async ({ page: tab }) => {
    await tab.setViewportSize({ width: 390, height: 800 });
    await mockDemo(tab);
    await tab.goto(page.path, { waitUntil: "networkidle" });
    await page.ready(tab);
    await tab.addStyleTag({ content: WIDE_FACE });
    // The new face has laid out once the next two frames have run.
    await tab.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(() => done(null)))));
    const overflow = await tab.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, `${page.name} scrolls sideways by ${String(overflow)}px under the wide face`).toBeLessThanOrEqual(0);
  });
}
