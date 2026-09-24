# Codex re-verification — your six findings on the design-coherence change

Repo: `C:\Users\kasel\source\repos\etherfi\Solvent` · app in `web/`. READ-ONLY: review and report; change no file, run
no build, start or stop no server, do not touch git state.

## The range

`960f164..35d322a` on `main` (the fixes after your round; your findings are in
`.superpowers/sdd/2026-09-24-design-coherence/codex-findings.md`, your brief in `codex-brief.md` beside it). Read by path:
`git diff 960f164..35d322a --stat`, then `git diff 960f164..35d322a -- <path>` and `git show 35d322a:<path>`.

## Your findings and what was done (say CLOSED / NOT CLOSED for each, with `file:line` evidence)

1. **Mixed-engine digit axis** — the Activity Amount column is right-aligned only when the view is scoped to one engine
   (`columnsFor(alignAmounts)`; the kit gained an explicit left-align class); e2e checks the computed alignment both ways.
2. **"No accounts" over accounts with no cap** — reserved for an empty book; a whole book with a null median is
   "Not measurable" / "No account has a borrow cap to measure room against" in the unavailable (solid) register.
3. **The all-zero compare headline** — "No ranked spot scenario in this set makes more … liquidatable." whenever a member
   was excluded; the unqualified sentence only when every member was ranked; the dek keeps each exclusion's reason.
4. **A book read in flight labelled unavailable** — the Live batch chip is pending while its own read is in flight,
   unavailable only after it fails.
5. **The Overview overwriting a missing receipt's register** — a step with no figure keeps the shared step's state, word
   and tone (refused / "No committed receipt" on both pages).
6. **"Did not reach the service"** — a status-less rejection says the page could not get a response; ALSO (beyond your
   finding, the same law): a new shared classifier `web/lib/fetch-failure.ts` — a 2xx `MalformedResponseError` is the
   unreadable register ("The service answered, but the page could not read the answer…"), a non-2xx one is a failed
   request with its HTTP status — used by Activity, History and Verification; and Verification's Live batch chip reads
   "no servable batch" in the refused register when the book's 503 says so (the Compute step's word), instead of
   "unavailable".

## Output

Per finding 1–6: CLOSED / NOT CLOSED with evidence. Then any NEW finding in this range under the same laws as your
round's brief: severity (CRITICAL = a law broken on a reachable state, a false public statement, a crash; HIGH = a wrong
figure or word under a plausible state; MEDIUM = unguarded but unreachable today; LOW = the rest), `file:line` at
`35d322a`, how to reach it, what shows, the smallest fix. No style notes. At most 15 new findings. End with a verdict:
APPROVED (the six closed, no new CRITICAL/HIGH) or NOT APPROVED.
