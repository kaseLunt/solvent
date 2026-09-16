/**
 * Stylelint — the 12px floor is STRUCTURAL (foundation canon §03 + §14.2;
 * build-contract §1; p1a-2, tightened by p1a-9).
 *
 * Every `font-size` declaration in web CSS must be EXACTLY a reference to one
 * of the declared type tokens — `var(--t-<name>)` for the closed fourteen, or
 * `var(--fs-<name>)` for the declared legacy aliases. No token below 12px
 * exists, so a sub-12px label is impossible, not merely forbidden — the gate
 * makes the floor structural at lint time, not reviewable at taste time.
 *
 * p1a-9 TIGHTENING (the Codex finding): the p1a-2 pattern was head-anchored
 * (`^var\(--(t|fs)-`), so `var(--t-typo, 1px)` — an UNDECLARED token with a
 * literal fallback that is what actually renders — passed the gate. The
 * pattern now (a) enumerates the EXACT declared token names (tokens.css is
 * the source of truth; a new token means a one-line addition here, which is
 * the point — the gate must know the vocabulary it guards), (b) anchors BOTH
 * ends, and (c) admits NO fallback argument: a fallback is a second value the
 * floor never audited, and every declared token always resolves, so a
 * fallback can only ever be a smuggling path. All 339 existing declarations
 * are bare token references; nothing relied on fallbacks.
 *
 * RELAXATION (recorded per the brief, mirrored in the ledger §p1a-2): the
 * legacy `var(--fs-*)` aliases stay lawful until Phase 3 retires them.
 * Every `--fs-*` resolves onto a `--t-*` token (tokens.css), so the floor
 * holds THROUGH the alias; Phase 3 drops the `fs-` branch and deletes the
 * alias block.
 *
 * Rule semantics (verified against the stylelint docs for
 * `declaration-property-value-allowed-list`): a `/regex/` value is matched
 * against the ENTIRE declaration value, so with both anchors any deviation —
 * literal px/rem/em, `inherit`, `calc(...)` wrappers, fallback arguments
 * (`var(--t-ui, 14px)`), and undeclared names (`var(--t-typo)`,
 * `var(--fs2-...)`) — all error. The `font` shorthand is held to `inherit`
 * so a literal size cannot smuggle in through the shorthand.
 *
 * File scope is the lint:css script's globs: app/ + components/ CSS —
 * every stylesheet the app serves (node_modules and .next never lint).
 */

// The product-register --type-* scale (spec 2026-09-15 §3.4), the closed --t-* set, and the declared --fs-* aliases,
// verbatim. Longer names precede their prefixes (mono-lg before mono) so the
// alternation cannot half-match; the trailing `\)$` admits nothing after the
// name — no comma, no fallback, no second token.
const TYPE_TOKEN_PATTERN =
  /^var\(--(?:type-(?:hero|h1|kpi|h2|card|dek|body|label|small|floor|mono-sm|mono)|t-(?:display|chapter|section|fighead|body|ui|meta|floor|mono-lg|mono-sm|mono-floor|mono|stat-lg|stat)|fs-(?:h1|h2|lede|body|note|table|mono-sm|mono|caption|label|badge|stat|hf))\)$/;

const config = {
  rules: {
    "declaration-property-value-allowed-list": [
      {
        "font-size": [TYPE_TOKEN_PATTERN],
        font: ["inherit"],
      },
      {
        message: (property, value) =>
          `"${property}: ${value}" — font-size must be exactly one declared type token: ` +
          `var(--type-*) (legacy var(--t-*) and var(--fs-*) lawful until their pages are rebuilt), no fallback argument. ` +
          `The 12px floor is structural (canon §03; tokens.css is the vocabulary).`,
      },
    ],
  },
};

export default config;
