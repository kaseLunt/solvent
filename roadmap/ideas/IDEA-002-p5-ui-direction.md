---
id: IDEA-002
type: idea
title: "P5 UI visual direction: the 2026-07-29 concept mockup is the reference"
status: candidate
date: 2026-07-29
informs: [H0]
updated: 2026-07-29
---

# IDEA-002 — P5 UI visual direction

Captured from an owner directive in-session (2026-07-29, mid-P3): after reviewing the
concept mockup of the four P5 surfaces, the owner said **"that UI looks really
beautiful. i want the real UI to look very similar."**

The reference artifact is committed at `docs/specs/2026-07-29-p5-ui-concept.html`
(self-contained HTML, both themes, renders in any browser). When P5 (Web + launch)
opens, its design work starts FROM this mockup, not from scratch.

What the mockup pins down (the parts the owner reacted to):

1. **Four surfaces as tabs of one app** — Book, Inspector, Observatory, Watch —
   matching the ROADMAP P5 line ("book, inspector, Observatory, watch").
2. **Instrument aesthetic**: quiet neutrals with a restrained teal accent, monospace
   for every number and identifier, tabular numerals, severity encoded as color +
   form (dot/stripe/pill), dense but legible tables, both light and dark themes.
3. **Honesty as a UI principle**: refused rows stay VISIBLE in the book with their
   named reason (never dropped); marks/watermark stamps shown on every surface;
   provenance lines under every number in the Inspector; PROJECTION labels on
   projected values; refusals counted in the aggregates row.
4. **The Inspector shows its work**: the HF derivation written out with the actual
   fused-floor law, param provenance with (block, logIndex), price anchors with
   source_as_of.
5. **Watch = the SSE stream with a face**: typed event feed (HF CROSS / PARAM /
   REFUSAL / ORACLE / BATCH), each row carrying its block reference.

Not scheduled until P5. When P5 opens: promote this to the P5 design-doc seed and
run it through the standard design consult + owner approval flow.
