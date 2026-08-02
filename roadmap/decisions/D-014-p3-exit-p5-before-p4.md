---
id: D-014
type: decision
title: "P3 exits on the r10 receipt; P5 executes before P4 (owner-directed); P4 follows the P5 deploy"
status: accepted
approved_by: "Kase Lunt (P5-before-P4 directed in-session 2026-07-30 19:11, ledger, ratified in the owner's own words: \"i am much more interested in getting phase 5 done than 4. can we do the ui first\"; watch descoped from the MVP in the same exchange — the watch page arrives WITH P4, designed against its real backend; design reference ratified 2026-07-29: \"that UI looks really beautiful. i want the real UI to look very similar\")"
date: 2026-08-01
updated: 2026-08-01
---

# D-014 — P3 exits on the r10 receipt; P5 before P4

Promotes two in-session owner directions from ledger state
(`.superpowers/sdd/progress-phase3.md`, entries of 2026-07-30 19:11 and 20:14–20:28) to a
durable decision, and records the P3-exit/P5-entry transition they govern. The ledger entry
itself named this file: "Formal decision file (D-014) + ROADMAP re-sequencing belong to the
P3-exit/P5-entry paperwork."

## What this records

1. **P3 exit.** P3's entry work object W2 closed on the r10 acceptance receipt
   (`roadmap/evidence/receipts/E-w2-acceptance.md`: reconcile pass, 0 gated failures,
   comparison sha256 `a34d7a53af58a117c74333f156864de73f13927f6d41f2c8d4b6485c287978e0`,
   pins eth 25,664,030 / op 155,018,419 hash-welded before+after, tested_commit `5b45498`,
   artifacts committed at `0c5f317`; Codex review train rounds 1–9, every finding
   fixed-and-verified or accepted-and-disclosed). W2 is archived at P5 entry — the
   mechanical W1-precedent handling, attainment record intact.
2. **P5 before P4.** The owner directed the resequencing explicitly in-session (quote in
   `approved_by`); execution in fact ran ahead under W2's owner-approved scope expansion
   (`51f9a84` +`web/**` +`deploy/**`, claim rescope gen-12), so at this transition the six
   surfaces and the UX train are already built (through `0b75eed`, contract 1.3.0). W3
   (`roadmap/work/W3-phase5-public-web.md`) carries the remainder: public deploy on a small
   VPS + purchased domain (owner actions pending), scoped DB roles, npm publish of
   `@solvent/client`, README landing + demo.
3. **P4 remains next, after the P5 deploy.** Watch was descoped from the MVP; the fourth
   tab shipped as the Feed (durable chain actions + LIVE-only posture) per the
   owner-approved reframe both product consultants converged on. Alert delivery and the
   watch page are P4, built against P4's real backend (zero throwaway work). The P4-entry
   train re-scopes the P4 phase row when it opens.

## Consequences

- ROADMAP resequenced at this transition: P3 → Done, P5 → In progress (the MVP line), P4
  stays Planned and queues behind the P5 deploy.
- STATUS `active_task` moves W2 → W3; `writer_mode: serial` unchanged; the integrator
  rescopes the claim after this train lands.
- The named P5 proposals stay proposals pending owner/integrator adjudication: E-2 risk-map
  endpoint; HeldFlat enrichment (decimals+symbol); dust-echo params.
- This decision changes SEQUENCING only. It does not weaken D-006's gate, D-013's
  adjudication bar, or the evidence/receipt discipline; W2's archived record is not
  re-opened by it.
