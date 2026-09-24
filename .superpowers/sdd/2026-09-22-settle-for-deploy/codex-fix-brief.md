# Codex re-verification — Plan 5 fix wave (your six findings at 80ffb17)

Repo: `C:\Users\kasel\source\repos\etherfi\Solvent` · app in `web/`. READ-ONLY: review and report; change no file, run
no build, start or stop no server, do not touch git state.

## The range

`80ffb17..28b1553` on `main` (the fix wave after your round; one lease commit precedes it). Read it by path:
`git diff 80ffb17..28b1553 --stat` for the list, then `git diff 80ffb17..28b1553 -- <path>` and
`git show 28b1553:<path>`. Skip PNGs. Read `web/tests/fixtures/demo/generate-demo-lab.mjs`'s diff.

## Your findings and what was done (verify each; say CLOSED / NOT CLOSED with the reason)

1. **README approval scope** (README "What is verified"). Rewritten: each row names its approval of record (commit +
   date + ledger) and whether the component changed since, with each later change placed in a closing round or
   listed "no closing approval recorded"; the sentence "only approved components are cited here" is gone. Check every
   claim row against the ledgers (`.superpowers/sdd/**`) and `git log <approved>..28b1553 -- <paths>`; D-006
   clause 5 (`roadmap/decisions/D-006-codex-approval-gate.md`).
2. **Node floor.** README now says "Node.js 22 (22.18 or later) or 24 and later"; check against the locked engines in
   `web/package-lock.json` and `packages/client-ts/package-lock.json` and the screenshot script's type stripping.
   (`package.json` `engines` still read ">=20": deliberately NOT changed in this wave — say if you judge that a
   false public statement.)
3. **"nothing was compared" under the empty arm.** Every public string under `receiptCheckedNothing` (renamed from
   `receiptComparedNothing`) now says the run checked no rows / nothing is proven; the Inspector's trust item follows.
   Walk your state: an accepted manifest with gated 0/0/0 and a legacy weld carrying advisory comparisons.
4. **Copy composed outside the lib.** FIXED IN PART: `web/app/book/BookLegacy.tsx` now prints the legacy view model's
   complete words (`web/lib/cash-view.ts`). **OVERRULED IN PART (D-006 clause 6)**: `web/app/overview/copy.ts` stays
   where it is — a copy-only module (no JSX, no component), so the law's point, that components compose nothing,
   holds; moving it changes no pixel and no sentence; it joins a planned copy sweep that also moves the components'
   remaining composed copy into `web/lib`. Say whether you accept the overrule, and why if not.
5. **Unguarded liquidation repaid figure.** One exported function in `web/lib/feed-view.ts` now decides the repaid
   figure for Activity and the Inspector: null → "—"; not a wire decimal → "unreadable"; no licensed scale → raw digits
   with the raw tag and no currency/token unit; scaled → exact grouped decimals with "USD" (Cash) or the row's symbol.
   The bonus bps fields are now guarded too.
6. **`typeLabel` prototype lookup.** Own-property lookup.

## Also in the wave (review for the same laws; report only real findings)

The Inspector trust card's SWEEP_NEVER words and its receipt item's nouns ("Cash account comparisons", "checked rows");
the sweep item leading with this account's own state; Verification's "reconcile-welded" and dotted field name
removed, "advisory" glossed from `cmd/reconcile/main.go`; Activity's raw marker in the Amount cell, the liquidation
note rendered through `inlineParts` (moved to `web/lib/inline-parts.ts`); the Book's not-computed sentence and the
refused rows' Debt cell (unserved vs unreadable); History's legend; Scenarios' movers caption (the web now sorts
movers by the service's key), the lane tile's gloss ("risk bucket"), the Compare hint; the demo movers now the 20
largest by debt, as the service selects.

## The laws (a violation on a REACHABLE state is a finding; say how to reach it)

1. A refused / withheld / absent / unloaded / unreadable value never renders as zero, "No", "none" or absence; a fetch
   failure is never a refusal; a read in flight is never failed.
2. Cash (`debt_manager`) and the legacy market (`aave_v3_etherfi`) are never summed, compared in one figure or put on
   one axis.
3. Wire values pass their guards before arithmetic, `BigInt(...)`, scaling or print; a unit word is true of its figure.
4. Every public sentence is TRUE of the system (code, `api/openapi.yaml`, Go source).
5. Copy lives in `web/lib`; components compose nothing.

## Already known — do NOT report

Everything under "Already known" in your round's brief (`.superpowers/sdd/2026-09-22-settle-for-deploy/codex-brief.md`); the carried minors in the ledger entry for this wave
(`progress.md`, "Carried minors"); Plan B (every page's reader classifies its envelope; the kit's pending headline;
one "nothing computed" predicate; the remaining copy composed in components).

## Output

Per finding 1–6: CLOSED / NOT CLOSED with `file:line` evidence; for #4 your verdict on the overrule. Then any NEW
finding: severity (CRITICAL = a law broken on a reachable state, a false public statement, a crash; HIGH = a wrong
figure or word under a plausible state; MEDIUM = unguarded but unreachable today; LOW = the rest), `file:line` at
28b1553, how to reach it, what shows, the smallest fix. No style notes. At most 15 new findings. End with a verdict:
APPROVED (the six closed or overruled with your acceptance, no new CRITICAL/HIGH) or NOT APPROVED.
