# Codex round — the design-coherence change (correctness and honesty only)

Repo: `C:\Users\kasel\source\repos\etherfi\Solvent` · app in `web/` (Next.js 16, React 19, TypeScript strict,
`@solvent/client`). READ-ONLY: review and report; change no file, run no build, start or stop no server, do not touch git
state.

## The range

`5f8f6d0..960f164` on `main`. Read it with git BY PATH: `git diff 5f8f6d0..960f164 --stat -- web/lib web/app
web/components` for the file list, then `git diff 5f8f6d0..960f164 -- <path>` and `git show 960f164:<path>`. The unit
specs under `web/tests/unit` show each function's intended law. Skip PNGs and fixture JSON.

The change is a DESIGN pass (the owner: "make sure everything is presented in a coherent way"): one vocabulary for
figures (`web/lib/money.ts`, `human-utc.ts` exactUtc, `format.ts` shortHex / U+2212 display minus, `percent.ts`,
`freshness.ts` ages, `scenario-name.ts`, `prose.ts` constants), a rebuilt kit (tone grammar, state registers, ToggleGroup,
StepStrip, StateCard, LegacyFold, ScrollRegion, an `absent` headline tone beside `refused`), one chart family, and every
page adopting both. The rules it was held to are in `.superpowers/sdd/2026-09-24-design-coherence/design-amendments.md`.
It was presentation-only by design: NO backend, contract or calculation change was allowed.

## The laws (a violation on a REACHABLE state is a finding; say how to reach it)

1. A refused / withheld / absent / unloaded / unreadable value never renders as zero, "No", "none" or absence; a fetch
   failure is never a refusal (and never an "unreadable answer" unless a 2xx body failed to parse); a read in flight is
   never failed.
2. Cash (`debt_manager`) and the legacy Aave market (`aave_v3_etherfi`) are never summed, compared in one figure or put on
   one axis (including one digit-aligned column or one chart axis).
3. Wire values pass their guards before arithmetic, `BigInt(...)`, scaling or print; truncation direction never changes;
   a unit word is true of its figure; the U+2212 minus is DISPLAY only — any exact string, title carrying an exact value
   or clipboard text keeps the wire's ASCII "-".
4. Tone: green = a health verdict or a passed proof/check ONLY; live / connection = accent; a record is ink; one receipt
   state wears one tone on every page (a FAILED receipt is crit on Verification AND the Inspector's trust item; drift is
   warn).
5. Every public sentence is TRUE of the system — verify against code, `api/openapi.yaml` or Go source. In particular:
   the price-source phrase (PriceProvider v2; "RedStone" must appear nowhere), "account" for Cash (one Cash position is
   one account — `risk_positions` keyed (batch_id, engine, account)), the Scenarios tile ("Accounts changing band") and
   the lane/bucket gloss, the stress tables' room definition, the History headline's change, the Activity headline's
   counts, the compare headline's arms (ties, all-zero, refused members, projection-only), the legacy summaries' claims.
6. Copy lives in `web/lib`; components compose nothing.
7. Presentation only: flag ANY change to what is computed, fetched or decided (a calculation, a guard, a fetch, a
   classification) that is not purely how an already-decided value is shown.

## What to hunt

- Formatters (money registers, `bookMoneyPair`, `accountMoneyColumn`, `exactUtc`, `formatTenths`, `humanAge`,
  `horizonWords`, `shortHex`): an arm that prints a figure for null / unreadable / negative / zero wrongly, a precision
  that invents or drops digits, a truncation that became rounding, a minus on the clipboard.
- The state registers: any state reachable in code (not just the demo) wearing the wrong register — a fetch failure in
  the dashed refused frame, a refusal in the solid frame, pending worded as failed, a bare "—" as a state word.
- Tones: any green that is not a health verdict or a passed check; any receipt state toned differently on two pages.
- Anything the design pass silently removed that carried meaning (a warn pill, a stale marker, a refusal cause, a
  count, an exact value's reachability).
- The Inspector room chart's new domain (`roomDomain`): an over-cap (negative) room clipped, or a domain that hides the
  cap.
- Compare (`compareHeadline`, `compareOutcome`, `legacyCompareSummary`) and the held-comparison age after a failed re-run.

## Already known — do NOT report

The owner's lists from Plans 4–5 (raw units for legacy rows; the hosted API; the evidence fixture's 87 vs the committed
30,838; demo realism; every page's reader classifying its envelope (Plan B); copy still composed in a few components
that predate this change (e.g. BookMethodology prose, LabSurface's single-run Computed chip); the deferred items in
`design-plan.md` (spacing tokenization, API disclosure, Verification IA, the Activity phone layout).

## Output

For each finding: severity (CRITICAL = a law broken on a reachable state, a false public statement, a crash; HIGH = a
wrong figure or word under a plausible state; MEDIUM = unguarded but unreachable with today's wire; LOW = the rest),
`file:line` at `960f164`, the input or event order that reaches it, what the page shows, the smallest fix. No style
notes, no praise. If a law area is clean, say "clean" and what you walked. At most 25 findings. End with a verdict:
APPROVED (no CRITICAL/HIGH) or NOT APPROVED.
