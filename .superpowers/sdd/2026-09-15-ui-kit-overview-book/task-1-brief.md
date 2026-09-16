### Task 1: Type tokens and the stylelint vocabulary

**Files:**
- Modify: `web/app/tokens.css` (after the `--t-stat` line, inside the light `:root` block)
- Modify: `web/stylelint.config.mjs:47-48` (`TYPE_TOKEN_PATTERN`)

**Interfaces:**
- Produces: CSS custom properties `--type-hero 44px`, `--type-h1 30px`, `--type-kpi 26px`, `--type-h2 17px`, `--type-card 15px`, `--type-dek 16px`, `--type-body 14px`, `--type-label 13px`, `--type-small 12.5px`, `--type-floor 12px`, `--type-mono 13px`, `--type-mono-sm 12.5px`, and weights `--w-semibold 600`, `--w-medium 500`. Every later CSS module uses only these.

- [ ] **Step 1: Add the tokens**

In `web/app/tokens.css`, directly after `--t-stat: 21px; /* KPI value */`, insert:

```css
  /* ---- product-register type scale (spec 2026-09-15 §3.4) ----
   * Replaces --t-* for new code; --t-*/--fs-* stay lawful only until the
   * pages that use them are rebuilt. Floor is 12px; nothing below exists. */
  --type-hero: 44px; /* Overview H1 only */
  --type-h1: 30px; /* page verdict headline */
  --type-kpi: 26px; /* KPI tile value */
  --type-h2: 17px; /* section head */
  --type-card: 15px; /* card title */
  --type-dek: 16px; /* verdict dek */
  --type-body: 14px; /* table cells, card text, nav */
  --type-label: 13px; /* tile labels, table headers */
  --type-small: 12.5px; /* chips, sub-labels */
  --type-floor: 12px; /* axis ticks, pills — ABSOLUTE floor */
  --type-mono: 13px; /* addresses, exact values */
  --type-mono-sm: 12.5px; /* small exact values */
  --w-semibold: 600;
  --w-medium: 500;
```

- [ ] **Step 2: Teach the gate the new names**

In `web/stylelint.config.mjs`, replace the `TYPE_TOKEN_PATTERN` constant with:

```js
const TYPE_TOKEN_PATTERN =
  /^var\(--(?:type-(?:hero|h1|kpi|h2|card|dek|body|label|small|floor|mono-sm|mono)|t-(?:display|chapter|section|fighead|body|ui|meta|floor|mono-lg|mono-sm|mono-floor|mono|stat-lg|stat)|fs-(?:h1|h2|lede|body|note|table|mono-sm|mono|caption|label|badge|stat|hf))\)$/;
```

- [ ] **Step 3: Prove the gate still bites**

Create `web/components/kit/_probe.module.css` containing `.x { font-size: var(--type-nope); }`.
Run: `npm run lint:css`
Expected: FAIL naming `_probe.module.css` and `--type-nope`. Delete the probe file.

- [ ] **Step 4: Verify clean**

Run: `npm run lint:css && npm run typecheck`
Expected: both exit 0.

- [ ] **Step 5: Commit**

```bash
cd /c/Users/kasel/source/repos/etherfi/Solvent
git add web/app/tokens.css web/stylelint.config.mjs
python roadmap/tools/scope_gate.py
git commit -m "feat(web): product-register type tokens - the --type-* scale joins the stylelint vocabulary"
```

---

