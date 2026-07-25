# Codex adversarial review — Task 8 wave 6 (round 6)

- **Target:** `ed2f26e` (code; review worktree pinned at `9f43a9e`, report-only delta), diffed against `cb00f09`
- **Verdict:** `needs-attention` — **NO-SHIP**, but **one finding**
- **Job:** `review-ms06uswe-q9doja` (6m53s). No wedge — dispatch correctly backgrounded.
- Go execution blocked by temp-directory ACLs; inspection-only. Controller measured 487 top-level / 565 incl. subtests / 0 FAIL / 0 SKIP.

**Finding trend: 11 → 8 → 5 → 4 → 3 → 1.**

> NO-SHIP. The poller's deletion route is structurally removed and the rebuilt harness matches Failover semantics, but minority-fork neutralization can still make canonical history permanently unreadable. Snapshot/readiness scope was not damaged.

## CONFIRMED RESOLVED

- **D-010 clause 1 is enforced structurally** — the poller's deletion route is removed, not guarded.
- **The rebuilt harness matches real `Failover` semantics** — not an idealisation.
- **The wave-7 split did no damage** — snapshot/readiness scope intact.

## The single finding (verbatim)

### [high] Minority-fork neutralization is not reliably recoverable — `internal/prices/poller.go:1182-1195`
A repair pass may intentionally trust one coherent endpoint even when it is on a minority fork. The code claims the resulting wrong marking is recoverable when a canonical observation later lands at the same height, but the poller only reads `latest`; once the canonical head has advanced, it never observes those past heights again. The store confirms that a fresh same-identity observation is the only implemented un-neutralize path, while neutralization also deletes the affected anchors. Consequently, a self-consistent minority-fork pass can leave canonical polled rows permanently `valid=false` and excluded from usable-price reads. Newer polls can clear acute health signals while the historical gap remains, contradicting D-010's recovery premise.
**Recommendation:** Before approval, either require complete cross-endpoint agreement before marking or implement a real recovery path that retains block-hash provenance and can revalidate/unmark past rows. Add a regression where a minority endpoint marks block H, the canonical head advances beyond H, and H must become usable again without another poll executing at H.

## Codex's next steps (verbatim)

- Implement and mutation-test recovery for past neutralized heights, or strengthen marking to require endpoint agreement.
- Re-run build, vet, full tests, race tests, and live-Postgres verification before returning to Codex under D-006.

## Controller adjudication

**ACCEPTED.** It invalidates a premise in an accepted decision the controller authored, so the
governance record was corrected first: **D-010 is superseded by D-011** (`27b2968`).

D-010 argued deletion is unrecoverable → remove it; marking is recoverable → prefer it. The second
half was asserted, not verified. The un-neutralize path (`insertPrice` supersede arm) only fires when a
fresh same-identity observation lands at that height — which for a *past* height never happens,
because the poller reads only `latest`. And neutralization deletes the anchors, destroying the
provenance any revalidation would need. **A permanent loss wearing a recoverable disguise:** the rows
survive; their usability does not.

Codex offers two remedies (agreement, or real revalidation). Under the owner's standing "gold
standard, no shortcuts" directive, D-011 requires **both**, plus the two enabling conditions:

- **clause 5** — neutralization must not delete anchors (provenance is what makes recovery possible);
- **clause 6** — recovery must work for past heights *without* a new poll there, with Codex's exact
  regression required;
- **clause 7** — marking requires cross-endpoint agreement; disagreement retains data unmarked;
- **clause 8** — a cleared acute signal must not hide a historical gap.

Notable: D-010 said "never delete polled price **rows**" and the implementation honoured that
literally while still deleting **anchors**. The letter was kept and the intent — retain enough to
recover — was not. Clause 5 closes that gap.

Also worth recording: this is the *first* round where the finding count reached 1, and the remaining
finding is not a coding defect but a false premise in a governing decision. The review is now
operating on the design rather than the implementation.
