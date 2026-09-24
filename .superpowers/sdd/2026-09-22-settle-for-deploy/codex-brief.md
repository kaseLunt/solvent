# Codex round — Plan 5 (settle for deploy), correctness and honesty only

Repo: `C:\Users\kasel\source\repos\etherfi\Solvent` · app in `web/` (Next.js 16, React 19, TypeScript strict,
`@solvent/client`). READ-ONLY: review and report; change no file, run no build, start or stop no server, do not touch
git state.

## The range

`3f9836d..80ffb17` on `main`. Read it with git BY PATH:
`git diff 3f9836d..80ffb17 --stat -- web/lib web/app web/components README.md` for the file list, then
`git diff 3f9836d..80ffb17 -- <path>` and `git show 80ffb17:<path>`. The unit specs under `web/tests/unit` show each
function's intended law. Skip PNGs and fixture JSON (but read `web/tests/fixtures/demo/generate-demo*.mjs` diffs).

The plan changed WORDS and PRESENTATION over data the pages already hold: the Overview hero; the Book's liquidatable
tile ("49 in all"), the $100-line sentence, a near-cap fold, the legacy fold's line, a "nothing computed" register for
the charts; Verification's vocabulary ("checked rows", account comparisons "not a breakdown of the checked rows");
the API page's inline bold / code renderer; Scenarios' movers caption per the contract's movers definitions and the
kit's disabled button register; Activity reading `/v1/book` for `value_decimals` to scale Cash amounts, liquidation
units, record-only cells, plain type words, the applied-filter chip; History's "Hour record"; the Inspector trust
card's sweep item and its receipt item (now judged by Verification's own `receiptState`); the SWEEP_NEVER phrase
"collateral never read"; the root README.

## The laws (a violation on a REACHABLE state is a finding; say how to reach it)

1. A refused / withheld / absent / unloaded / unreadable value never renders as zero, "No", "none" or absence; a fetch
   failure is never a refusal; a read in flight is never failed.
2. Cash (`debt_manager`) and the legacy Aave market (`aave_v3_etherfi`) are never summed, compared in one figure or put
   on one axis.
3. Wire values pass their guards before arithmetic, `BigInt(...)`, scaling or print. A scale (`value_decimals`) used to
   place a decimal point must be the engine's own and guarded; a Cash amount must never be scaled by the legacy
   engine's decimals or vice versa; a unit word must be true of the figure beside it.
4. Every public sentence is TRUE of the system — verify against code, `api/openapi.yaml` or Go source: e.g. "49 in all"
   only over a book read whole; "account comparisons … are not a breakdown of the checked rows" (read
   `cmd/api/p5_evidence.go`); the movers definitions and the cap ("the service returns at most N" — find N in Go);
   "collateral never read" for both SWEEP_NEVER cases (`internal/riskfeed/assemble.go`); the README's claims (each
   "proven" claim must have a recorded Codex approval — D-006 clause 5 — and the run instructions must work on a fresh
   clone).
5. Copy lives in `web/lib`; components compose nothing.

## What to hunt

- The Activity `/v1/book` read: a race between the book and the stream; a book that is withheld / unreadable / missing
  an engine; `value_decimals` absent or malformed; the page printing a scaled figure with a raw-units tag or a raw
  figure without it; the Inspector's activity card doing the same.
- `inlineParts`: nesting, unbalanced markers, adjacency, an empty strong/code part, any word lost or duplicated.
- The Book's "nothing computed" and "49 in all" registers across running / stopped / over / duplicate / unreadable /
  whole walks — any state that claims a total or a zero it cannot back.
- The trust card now importing `receiptState`: any receipt arm where the Inspector is greener than Verification.
- The near-cap fold: rows duplicated or dropped between the shown and hidden slices; a hidden Σ that disagrees with the
  rows it hides.

## Already known — do NOT report

The owner's list from Plans 4–5: raw units for legacy (`aave_scaled`) rows; the hosted API; the evidence fixture's 87
vs the committed artifact's 30,838; the demo dataset's realism (sub-dollar Cash liquidations, "<$0.01" legacy eligible
debt, the 3-row sweep stamp, 1,412 vs ~9,700); every page's reader classifying its envelope (Plan B); the kit's pending
headline variant (Plan B); the Cash zero-movers caption's unscoped negative and the never-mounted legacy movers caption;
the median room in the unreadable register.

## Output

For each finding: severity (CRITICAL = a law broken on a reachable state, a false public statement, a crash; HIGH =
a wrong figure or word under a plausible state; MEDIUM = unguarded but unreachable with today's wire; LOW = the rest),
`file:line` at `80ffb17`, the input or event order that reaches it, what the page shows, the smallest fix. No style
notes, no praise. If a law area is clean, say "clean" and what you walked. At most 25 findings.
