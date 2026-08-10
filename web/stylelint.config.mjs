/**
 * Stylelint — the 12px floor is STRUCTURAL (foundation canon §03 + §14.2;
 * build-contract §1; p1a-2).
 *
 * Every `font-size` declaration in web CSS must reference the closed type
 * set: `var(--t-*)`. No `--t-*` token below 12px exists, so a sub-12px
 * label is impossible, not merely forbidden — the gate makes the floor
 * structural at lint time, not reviewable at taste time.
 *
 * RELAXATION (recorded per the brief, mirrored in the ledger §p1a-2): the
 * legacy `var(--fs-*)` aliases stay lawful until Phase 3 retires them.
 * Every `--fs-*` already resolves onto a `--t-*` token (tokens.css), so
 * the floor holds THROUGH the alias; Phase 3 tightens this pattern to
 * `--t-*` only and deletes the alias block.
 *
 * Rule semantics (verified against the stylelint docs for
 * `declaration-property-value-allowed-list`): a `/regex/` value is matched
 * against the ENTIRE declaration value, so the `^` anchor rejects any
 * value that does not BEGIN with a token reference — literal px/rem/em,
 * `inherit`, `calc(...)` wrappers, and token typos like `var(--fs2-...)`
 * all error. `var(--t-ui, 14px)`-style fallbacks stay legal (the anchor
 * only binds the head). The `font` shorthand is held to `inherit` so a
 * literal size cannot smuggle in through the shorthand.
 *
 * File scope is the lint:css script's globs: app/ + components/ CSS —
 * every stylesheet the app serves (node_modules and .next never lint).
 */
const config = {
  rules: {
    "declaration-property-value-allowed-list": [
      {
        "font-size": [/^var\(--(t|fs)-/],
        font: ["inherit"],
      },
      {
        message: (property, value) =>
          `"${property}: ${value}" — font-size must reference a type token: var(--t-*) ` +
          `(legacy var(--fs-*) lawful until Phase 3). The 12px floor is structural (canon §03).`,
      },
    ],
  },
};

export default config;
