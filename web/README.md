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
| `app/layout.tsx` | Root shell: pre-paint theme init, `PostureProvider`, `AppHeader`, `DegradationBanner`. |
| `app/{book,inspector,lab,observatory,feed,developers}` | The six routes (W0: honest placeholders naming their feeds and landing wave). |
| `app/styleguide` | Dev-only component showcase (SPECIMEN-labeled). Visible under `next dev`; compiled into a production build only when `NEXT_PUBLIC_SHOW_STYLEGUIDE=1` at build time (CI sets it). |
| `components/` | Base components (see the styleguide for all of them live). |
| `lib/api.ts` | `SolventClient` provider; base URL from `NEXT_PUBLIC_SOLVENT_API_URL` (default `http://localhost:8080`). |
| `lib/posture.tsx` | Global SSE posture context over the client's `SolventStream` (base-frame deadline + reconnect laws live in the client; this only projects state). Feeds the Ribbon + degradation banner. |
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

## Honest-UI ground rules for surface waves (W1–W6)

1. Render lookups only via `lookup()` outcomes + `renderLookupOutcome` —
   `found: null` is NEVER "no position".
2. Render every `NullableDecimal` via `renderNullableDecimal` — null is an em
   dash, never 0.
3. Severity: crit ONLY from the engine's sealed verdict (`SeverityHF`); the
   warn band is presentation-only.
4. Refusals are first-class UI: `RefusedTag` with the NAMED reason, rows kept
   visible, counts kept in aggregates.
5. Freshness: per-input as-ofs (`MarksStamp`, Ribbon watermark vector) — never
   one global timestamp, never DB insert time.
6. Live posture ≠ posture history: the posture context is current-connection
   truth only.
7. Projections wear `ProjectionBadge`; null `block_time` renders the block
   number (`renderBlockTime`), never an invented time.
