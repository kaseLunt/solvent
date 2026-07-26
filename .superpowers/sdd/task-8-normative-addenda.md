# Task 8 — controller-ratified normative addenda

Stable citation targets for implementation behaviors that are correct but were not specified by any
decision clause. Ratified by the controller under the owner's delegated judgment (2026-07-25,
"gold-standard solutions, no shortcuts"); each addendum states its rationale so a future reader can
challenge it on the merits. Tests cite these as `ADD-<n>`.

Context: Codex round 8 (F7) found tests citing normative sources that did not specify the behavior —
including six citations naming superseded D-011 clauses. The rule stands: a behavior either has a
real normative source or it is not a specified behavior. These addenda exist so that sound
implementation choices get a source instead of a fabricated citation.

## ADD-1 — Single-view marking discloses the height range

When the D-012 clause-4 one-endpoint arm authorizes a marking on a single chain view, the marking
emits a WARN naming the affected height range.

**Rationale:** clause 4 ratifies the *trade* (mark on one view rather than stall a one-endpoint
deployment); it is silent on observability. The trade is acceptable *because* it is auditable — an
operator reviewing a gap must be able to find the moment one unverified view classified those
heights. Disclosure is what keeps the ratified exception from being a silent one. (Origin: wave-8
brief R4; promoted here to a stable source.)

## ADD-2 — Exposure reads exclude marked rows

`PriceRepairExposure` (and any repair-scoping read) excludes rows already marked
`InvalidReasonUnverifiableReorg` when computing what a repair must prove.

**Rationale:** D-012 clause 3 makes marking permanent in the running system. If permanently-marked
rows still counted toward a repair's proof obligation, every epoch after the first neutralization
would demand proof about rows that can never be proven — clause 3's permanence would veto all future
repair, a fail-forever by composition (the class this project has shipped and removed three times).
Excluding marked rows is what lets permanence and continued operation coexist: the marked rows stay,
stay visible (clause 6), and stay out of every future proof obligation.

---

*Appending a new addendum requires the same controller/owner judgment; renumbering or rewriting an
existing one is prohibited (append-only, like decisions).*
