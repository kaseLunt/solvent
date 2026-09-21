# Solvent web (P5)

The public, verifiable risk-control surface. Next.js (App Router, TypeScript
strict) consuming **`@solvent/client` as the ONLY data path** — no route
fetches the API directly, no route parses wire JSON.

Governing documents:

- plan: `docs/plans/2026-07-30-solvent-phase5-web.md`
- spec: `docs/specs/2026-07-30-solvent-phase5-web-design.md` (the honest-UI laws, §5)
- visual canon: `docs/specs/2026-07-29-p5-ui-concept.html` (tokens extracted into
  `app/tokens.css`)

## Layout

| Path | What |
| --- | --- |
| `app/tokens.css` | Design tokens, extracted verbatim from the mockup: palette, mono/sans stacks, type scale, spacing, radii. Light + dark via `prefers-color-scheme`, with a `data-theme` override that wins in both directions. |
| `app/globals.css` | Baseline + tiny utilities (`.mono`, `.dim`, `.okt`, `.crit-t`, `.eyebrow`). |
| `app/layout.tsx` | Root shell: pre-paint theme init, `PostureProvider`, `MetaConstantsProvider`, the kit's `AppShell` (nav + live pill), `DegradationBanner`. |
| `app/page.tsx` + `app/overview` | `/` — Overview, the front door. |
| `app/{book,inspector,lab,observatory,feed,proof,developers}` | The seven pages behind it, by nav label: Book, Inspector, Scenarios (`/lab`), History (`/observatory`), Activity (`/feed`), Verification (`/proof`), API (`/developers`). Each page's sentences come from one view model in `lib/` (`cash-view`, `inspector-view`, `lab-view`, `history-view`, `activity-view`, `verification-view`, `api-view`); its components print and compose nothing. |
| `app/styleguide` | Dev-only component showcase (SPECIMEN-labeled). Visible under `next dev`; compiled into a production build only when `NEXT_PUBLIC_SHOW_STYLEGUIDE=1` at build time (CI sets it). |
| `components/` | The kit (`components/kit`: `VerdictHeader`, `IdentityChips`, `KpiTile`, `StatusPill`, `KitTable`, `Drawer`) and the shared components beside it (see the styleguide for them live). |
| `lib/api.ts` | `SolventClient` provider; base URL from `NEXT_PUBLIC_SOLVENT_API_URL` (default `http://localhost:8080`). |
| `lib/posture.tsx` | Global SSE posture context over the client's `SolventStream` (base-frame deadline + reconnect laws live in the client; this only projects state). Feeds the header's live pill + degradation banner. |
| `lib/format.ts` / `lib/severity.ts` | The truth primitives: three-valued found rendering, null-never-zero decimals, block-time honesty, the crit-only-from-verdict severity law. Pinned by `tests/unit/honest-render.spec.ts`. |
| `lib/pagination.ts` | `useCursorPages` — batch-stable cursor pagination with `reset()` for 409 `BATCH_SUPERSEDED` restarts. |

## The `@solvent/client` coupling

`@solvent/client` is a `file:../packages/client-ts` dependency (npm installs it
as a symlink) and ships **no committed `dist/`**. `scripts/ensure-client.mjs`
runs as `predev` / `prebuild` / `pretypecheck`: it `npm ci`s the client package
when its `node_modules` is missing and always rebuilds its `dist/`. A clean
checkout therefore needs no manual step — `npm ci && npm run build` just works.

## Commands

```sh
npm ci             # install (web)
npm run dev        # dev server (builds the client first)
npm run build      # production build (builds the client first)
npm run typecheck  # tsc --noEmit, strict (builds the client first)
npm run lint       # eslint (next core-web-vitals + typescript, flat config)
npm run start      # serve the production build on port 3111
npm run test:e2e   # playwright: unit project (honest-render laws) + e2e smoke
```

Playwright starts `npm run start` itself (port **3111**, so a running
`next dev` on 3000 never collides). Build before testing. First time:
`npx playwright install chromium`.

To include the styleguide in a production bundle (CI does this):

```sh
NEXT_PUBLIC_SHOW_STYLEGUIDE=1 npm run build
```

## Environment

| Var | Meaning | Default |
| --- | --- | --- |
| `NEXT_PUBLIC_SOLVENT_API_URL` | API origin (`cmd/api`) | `http://localhost:8080` |
| `NEXT_PUBLIC_SHOW_STYLEGUIDE` | `1` compiles `/styleguide` into production builds | unset |

Both are inlined at **build** time (Next `NEXT_PUBLIC_` semantics).

## Vercel

`vercel.json` overrides install (`npm ci --prefix ../packages/client-ts &&
npm ci`) and build. Project settings: **Root Directory = `web`** with
"Include source files outside of the Root Directory" enabled (the `file:`
dependency lives one level up).

## Honest-UI ground rules

1. Render lookups only via `lookup()` outcomes + `renderLookupOutcome` —
   `found: null` is NEVER "no position".
2. Render every `NullableDecimal` via `renderNullableDecimal` — null is an em
   dash, never 0.
3. Severity: crit ONLY from the engine's sealed verdict (`StatusPill
   tone="crit"`); the warn band is presentation-only.
4. Refusals are first-class UI: `StatusPill tone="refused"` with the NAMED
   reason, rows kept visible (the dim `KitTable` row, its figures "—"), counts
   kept in aggregates (the dashed refused `KpiTile`).
5. Freshness: per-input as-ofs (`IdentityChips`' Batch · Snapshot, the
   drawer's as-of line) — never one global timestamp, never DB insert time.
6. Live posture ≠ posture history: the posture context is current-connection
   truth only.
7. Projections wear `StatusPill tone="projection"`; null `block_time` renders
   the block number (`renderBlockTime`), never an invented time.
8. A record is ink; only a verdict wears tone. `VerdictHeader tone="neutral"`
   is a statement of record (History, Activity, the API) and wears `--ink`;
   `ok` green is a HEALTH verdict — nothing is liquidatable, the receipt is
   exact — and never means "the data answered"; `refused` is every
   non-answer. A record's holes ride a warn chip, never the H1.
9. Three states of one read are never folded: in flight is pending, in its own
   words; "could not be read" is said only after a read has failed; an absence
   is worded as one only when the wire itself stated it.
