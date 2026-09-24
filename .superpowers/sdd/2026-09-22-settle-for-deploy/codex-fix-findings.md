[codex task-muf1xdb5-m25sfj | completed | ~4.5 min] — re-verification of the Plan 5 fix wave `80ffb17..28b1553` (brief: `codex-fix-brief.md`). Verbatim.

1. **CLOSED — README approval scope.** [README.md:133](/C:/Users/kasel/source/repos/etherfi/Solvent/README.md:133) scopes claims to their recorded approvals; [README.md:149](/C:/Users/kasel/source/repos/etherfi/Solvent/README.md:149) discloses later changes and missing closing approvals. The cited commits, closing rounds and unchanged-path claims agree with the ledgers and path histories through `28b1553`.

2. **CLOSED — documented Node prerequisite.** [README.md:229](/C:/Users/kasel/source/repos/etherfi/Solvent/README.md:229) and [README.md:66](/C:/Users/kasel/source/repos/etherfi/Solvent/README.md:66) now specify versions satisfying both lockfiles and the screenshot script's direct TypeScript imports. The unchanged `>=20` at [web/package.json:8](/C:/Users/kasel/source/repos/etherfi/Solvent/web/package.json:8) remains a false compatibility declaration; the client's declaration also does not describe its development-tool requirements. These are the brief's expressly carried items, not newly reported findings.

3. **CLOSED — empty receipt wording.** [web/lib/evidence.ts:951](/C:/Users/kasel/source/repos/etherfi/Solvent/web/lib/evidence.ts:951), [web/lib/verification-view.ts:299](/C:/Users/kasel/source/repos/etherfi/Solvent/web/lib/verification-view.ts:299) and [web/lib/trust.ts:283](/C:/Users/kasel/source/repos/etherfi/Solvent/web/lib/trust.ts:283) say no rows were checked and nothing is proven. With accepted gated `0/0/0` and an exact advisory legacy comparison, the comparison remains visible without a false "nothing was compared" claim.

4. **CLOSED — legacy fix; overrule accepted.** [web/lib/cash-view.ts:443](/C:/Users/kasel/source/repos/etherfi/Solvent/web/lib/cash-view.ts:443) supplies complete tile wording, printed by [web/app/book/BookLegacy.tsx:27](/C:/Users/kasel/source/repos/etherfi/Solvent/web/app/book/BookLegacy.tsx:27). I accept the recorded D-006 clause 6 exception for [web/app/overview/copy.ts:2](/C:/Users/kasel/source/repos/etherfi/Solvent/web/app/overview/copy.ts:2): it centralizes fixed copy without component composition. This is an accepted location exception, not literal compliance with `web/lib` placement.

5. **CLOSED — liquidation figures.** [web/lib/feed-view.ts:297](/C:/Users/kasel/source/repos/etherfi/Solvent/web/lib/feed-view.ts:297) guards null, decimal validity and scale before formatting. Both surfaces use `liquidationRepaid`; raw digits receive only the raw tag, and scaled figures receive the appropriate unit. Bonus fields are guarded at [web/lib/feed-view.ts:265](/C:/Users/kasel/source/repos/etherfi/Solvent/web/lib/feed-view.ts:265).

6. **CLOSED — prototype lookup.** [web/lib/feed-view.ts:234](/C:/Users/kasel/source/repos/etherfi/Solvent/web/lib/feed-view.ts:234) checks own properties; `__proto__`, `constructor` and `toString` remain strings.

No new findings. Review of `80ffb17..28b1553` used git/file reads only; no builds, tests or server actions were performed.

APPROVED

Codex session ID: 01a0d1be-6a78-7c03-a218-dc570c5856ea
Resume in Codex: codex resume 01a0d1be-6a78-7c03-a218-dc570c5856ea
