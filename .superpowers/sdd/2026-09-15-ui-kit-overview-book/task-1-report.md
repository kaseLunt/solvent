# Task 1 report: Type tokens and the stylelint vocabulary

**Status:** DONE_WITH_CONCERNS
**Commit:** `0defe66` - `feat(web): product-register type tokens - the --type-* scale joins the stylelint vocabulary` (on `main`)

## What I implemented

### `web/app/tokens.css` (+17 lines, inside the light `:root` block, directly after `--t-stat: 21px; /* KPI value */`)

Added the product-register type scale and the two weight tokens, exactly the fourteen the brief lists and nothing else:

| token | value | | token | value |
|---|---|---|---|---|
| `--type-hero` | 44px | | `--type-label` | 13px |
| `--type-h1` | 30px | | `--type-small` | 12.5px |
| `--type-kpi` | 26px | | `--type-floor` | 12px |
| `--type-h2` | 17px | | `--type-mono` | 13px |
| `--type-card` | 15px | | `--type-mono-sm` | 12.5px |
| `--type-dek` | 16px | | `--w-semibold` | 600 |
| `--type-body` | 14px | | `--w-medium` | 500 |

Lowest font-size value is 12px (`--type-floor`); the 12px floor is respected. Declared once on `:root` - custom properties cascade to both theme blocks, so no dark-theme duplicate is needed (same posture as the existing `--t-*` set, which the file calls "theme-invariant"). The file's CRLF line endings were preserved.

### `web/stylelint.config.mjs` (1 line changed, line 45)

Replaced `TYPE_TOKEN_PATTERN` verbatim with the brief's regex, which adds the `type-(...)` alternation ahead of the existing `t-(...)` and `fs-(...)` branches. `mono-sm` precedes `mono` in the new branch, matching the config's stated longer-before-prefix rule. The trailing `\)$` is unchanged, so fallback arguments remain rejected. The file's LF line endings were preserved (the `LF will be replaced by CRLF` warning git prints is pre-existing repo autocrlf behaviour, which is what the brief's `-c core.safecrlf=false` is for).

## Deviation from the brief (the concern)

The brief's verbatim comment text for Step 1 contains, on its second line:

```
   * Replaces --t-* for new code; --t-*/--fs-* stay lawful only until the
```

In CSS the `*/` inside `--t-*/` terminates the comment. With the text exactly as the brief gives it, `npm run lint:css` fails on `app/tokens.css` itself:

```
app/tokens.css
  75:41  x  Unknown word --fs-*  CssSyntaxError
```

That is not only a lint failure. Once the comment closes early, a browser's declaration error-recovery consumes everything up to the next `;`, and the second `;` it finds is the one ending `--type-hero: 44px` - so `--type-hero` would never be defined at runtime. It also makes the brief's Step 4 ("both exit 0") unsatisfiable as written; Step 1 and Step 4 conflict, and Step 4 is the verification, so it has to win.

I applied the minimal fix - two spaces around the slash - which keeps the wording and intent:

```
   * Replaces --t-* for new code; --t-* / --fs-* stay lawful only until the
```

The existing file already sidesteps this hazard the same way (its `--t-*` mentions are followed by a space or a newline, never `/`). Token names, values, and the stylelint pattern are all exactly as the brief specifies; only this comment line differs. If the controller prefers different wording, it is a one-line edit.

## Gate proof (Step 3)

Created `web/components/kit/_probe.module.css` containing `.x { font-size: var(--type-nope); }` (the `kit/` directory did not exist yet; I created it for the probe only).

`npm run lint:css` output with the probe present, after the comment fix, ANSI colour escapes stripped:

```
> solvent-web@0.1.0 lint:css
> stylelint "app/**/*.css" "components/**/*.css"

components/kit/_probe.module.css
  1:17  x  "font-size: var(--type-nope)" - font-size must be exactly one declared type token: var(--t-*) (legacy var(--fs-*) lawful until Phase 3), no fallback argument. The 12px floor is structural (canon 03; tokens.css is the vocabulary).  declaration-property-value-allowed-list

x 1 problem (1 error, 0 warnings)
exit=2
```

FAIL, naming `_probe.module.css` and `--type-nope`, as the brief expects. (The first probe run, before the comment fix, showed 2 errors: this one plus the `tokens.css 75:41` CssSyntaxError quoted above - which is how the deviation was discovered.)

**Positive probe (beyond the brief):** the negative probe alone cannot distinguish a working regex from a mistyped one, since any unknown name fails. I overwrote the probe with twelve rules, one per `--type-*` name, and ran `npm run lint:css` -> exit 0, every new name accepted.

**Probe deleted:** `rm components/kit/_probe.module.css && rmdir components/kit`; `ls components/kit` -> `No such file or directory`. The `kit/` directory was removed too, so the tree is as it was before the probe.

## Clean run (Step 4)

`npm run lint:css && npm run typecheck`, run after the probe was deleted:

```
> solvent-web@0.1.0 lint:css
> stylelint "app/**/*.css" "components/**/*.css"

> solvent-web@0.1.0 pretypecheck
> node scripts/ensure-client.mjs
ensure-client: building @solvent/client...
> @solvent/client@0.1.0 build
> tsc -p tsconfig.build.json

> solvent-web@0.1.0 typecheck
> tsc --noEmit
exit=0
```

Both exit 0. The `pretypecheck` client rebuild dirtied no tracked files (checked via `git status --porcelain | grep -v '^??'` before staging: only the two target files were modified).

## Commit (Step 5)

- Staged by name: `git add web/app/tokens.css web/stylelint.config.mjs` -> `2 files changed, 18 insertions(+), 1 deletion(-)`.
- `python roadmap/tools/scope_gate.py` -> `scope-gate: OK -- integrator claude-integrator; 2 path(s)`. Claim valid; no renewal needed.
- `git -c core.safecrlf=false commit -m "feat(web): product-register type tokens - the --type-* scale joins the stylelint vocabulary"` -> `[main 0defe66]`. Pre-commit control-plane doctor: `OK -- 0 error(s), 0 warning(s), 5 info` (the info lines are pre-existing REVIEW-DUE notices, unrelated to this task).
- No attribution trailers, per repo rules.
- Tracked status after commit: empty.

## Files changed

- `C:\Users\kasel\source\repos\etherfi\Solvent\web\app\tokens.css`
- `C:\Users\kasel\source\repos\etherfi\Solvent\web\stylelint.config.mjs`

Not touched: `.superpowers/sdd/.gitignore`, any `.log`/`.exe`, any roadmap file. No branches or worktrees created.

## Self-review

- Completeness: all 14 tokens present at lines 77-90, after `--t-stat` at line 73. Verified by `grep -n -- '--type-\|--w-'` -> exactly 12 `--type-*` + 2 `--w-*` hits.
- No extra tokens, no value below 12px.
- Pattern: verbatim; `mono-sm` before `mono`; `\)$` retained.
- Staged set: exactly two files; probe and `kit/` gone; tracked tree clean post-commit.
- One deviation, documented above.

## Observations (not changed - out of scope for this brief)

1. The stylelint failure message still reads `var(--t-*) (legacy var(--fs-*) lawful until Phase 3)` and does not mention `var(--type-*)`; the config's leading comment (`// The closed --t-* set ... + the declared --fs-* aliases`) likewise predates the new scale. Both are now slightly stale. The brief scoped the change to the pattern constant only, so I left them; a later task or a small follow-up could refresh the wording.
2. The brief cites `web/stylelint.config.mjs:47-48` for `TYPE_TOKEN_PATTERN`; the constant actually sits at lines 44-45. No ambiguity - there is one such constant - but the plan's line reference is off by three.
