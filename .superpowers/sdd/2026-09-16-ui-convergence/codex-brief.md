# Codex round — Plan 4 (UI convergence), correctness and honesty only

Repo: `C:\Users\kasel\source\repos\etherfi\Solvent` · app in `web/` (Next.js 16 App Router, React 19, TypeScript
strict, CSS modules on tokens, `@solvent/client`). READ-ONLY: review and report; change no file, run no build, start
or stop no server, do not touch git state.

## The range

`a941a39..0f18a1b` on `main`. Source only — `web/lib`, `web/app`, `web/components` (110 files, +7.8k / −2.6k).
Read it with git BY PATH, never as one diff:
`git diff a941a39..0f18a1b --diff-filter=AMR --stat -- web/lib web/app web/components` for the file list, then
`git diff a941a39..0f18a1b -- <path>` and `git show 0f18a1b:<path>` per file. The unit specs under `web/tests/unit`
show each function's intended law. Skip fixture JSON, PNGs, `web/tests/e2e`, and deleted files.

Weight your time: FIRST the view models that compose what a public page SAYS and the readers that classify what the
wire SENT — `web/lib/{history-view,observatory-series,activity-view,feed-view,verification-view,evidence,api-view,
cash-view,cash-summary,cash-refusal,cash-rows,book-headline,trust,inspector-view,address-stress,address-lookup,
lab-classify,lab-engine,lab-reading,lab-view,lab-compare,lab-address,lab-headline,runbook,human-utc,instant-split}.ts`
— THEN the components that render them (`web/app/{observatory,feed,proof,developers,overview,book,inspector,lab}/**`,
`web/components/Drawer.tsx`, `web/components/kit/**`, `web/components/charts/ObservatorySeriesChart.tsx`).

## The laws (a violation on a REACHABLE state is a finding; say how to reach it)

1. A refused / withheld / absent / unloaded / unreadable value never renders as zero, "No", "none", "nothing" or an
   absence. A FETCH FAILURE is never worded as an engine refusal ("not computed"); a read IN FLIGHT is never worded
   as failed or unavailable.
2. Cash (`debt_manager`) and the legacy Aave market (`aave_v3_etherfi`) are never summed, never compared in one
   figure, never put on one axis.
3. Every wire value passes its guard (`isWireDecimal`, `isWirePopulation`, `isWireSignedCount`, `isWireScale`,
   `readWirePopulation`, `wireBigInt`) BEFORE arithmetic, `BigInt(...)`, `.length` / `.slice` / `.map` / `.trim`, or
   becoming a React child. A 2xx body of ANY shape (null, a primitive, an array, a missing / null / wrong-typed member
   at any depth the UI dereferences) ends in a NAMED state — never a throw at render, never a rejected promise
   mislabelled "unreachable".
4. A computed result is never silently replaced: a failed or malformed re-run leaves the held result standing under a
   banner that names the batch it stands for; a malformed body never enters the hold.
5. A page claims only what the system backs. A sentence never claims more than the loaded rows license (Activity:
   "loaded", "more exist"); a "checked claim" is computed from the rows, not typed; a pinned, dated reconcile run is
   never worded as a present-tense fact about the live batch or one account; a projection is always labelled.
6. Time: an instant printed for a human comes from the wire string's own UTC fields (`humanUtc`) — never
   `Date.now()`, the local zone or `toLocaleString`; a malformed instant is returned verbatim.
7. Copy lives in `web/lib`; components compose no sentence.

## What to hunt

- Arithmetic: bigint subtraction / scaling / percentage / band sums — mixed scales, a null or withheld operand treated
  as zero, a negative printed with an ASCII hyphen or as "−$" where the page's law is "over cap by $X", truncation
  that makes two different values print identically inside one comparison.
- State machines: `lab-reading.ts` (the hold: `withRunning` / `withSettled` / the set path), `address-lookup.ts`
  (resume repair, `lookupRepaired`), the Book's walk (`cash-book.tsx` / `cash-summary.ts`: mid-walk lower bounds,
  over-delivery, a terminal short page) — an ordering of events that shows a wrong or stale figure without saying so.
- Classifiers vs renderers: for each member a component prints or dereferences, is it judged first? (The lab was
  walked member by member in this branch; the Book, Inspector, History, Activity and Verification paths less so.)
- `Drawer.tsx` focus handling: a key path that lets focus leave an open modal, or fails to restore it.
- URL state in `app/lab/LabSurface.tsx`: a link that names a different subject from the screen, or a deep link that
  runs something it says it will not.
- Dead branches that look like safety: a guard whose failure arm can never execute because an earlier call throws.

## Already known — do NOT report these

Owner's list / carried forward by ruling: raw-unit amounts on Activity and the Inspector's activity; the hero's
"70,000 people" vs the strip's accounts; the `localhost` API base URL; the zero-based y-domain on History's chart; a
COUNT outside the contract still throws on History (four pins state it as the law; only money figures became named
holes); "0 drift named" in the accepted receipt's step sentence; a rejected receipt's headline is warn while its chip
is crit; the header action wrapping under long chip rows; no kit-wide `:disabled` button style; duplicate `plural`
helpers and `retry` / `retryWords`; `MoversTable.tsx` wording its verdict cell in the component; `/proof` has no
resume repair; the API's degraded message naming a migration number (the SERVICE's words).

## Output

For each finding: severity (CRITICAL = a law broken on a reachable state, a crash path, or a false public statement;
HIGH = a wrong figure or state under a plausible event ordering or body shape; MEDIUM = an unguarded read that
today's fixtures cannot reach; LOW = the rest), `file:line` at `0f18a1b`, the concrete input or event order that
reaches it, what the page then shows, and the smallest fix. No style notes, no refactoring advice, no praise. If a
law area is clean, say "clean" and what you walked. Cap the report at the 25 findings that matter most.
