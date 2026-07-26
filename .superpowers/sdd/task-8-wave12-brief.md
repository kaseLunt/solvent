### Task 8 — wave 12: round-9 fixes (PRICES unit)

Repo `C:\Users\kasel\source\repos\etherfi\Solvent`, branch `main`. Base: current HEAD at start
(`git log` first — the health wave 11 may still be committing; disjoint files).

Codex round 9 (prices): **NO-SHIP — 2 high, 2 medium.** Read
`.superpowers/sdd/task-8-codex-round9-prices.md` (verbatim + adjudication),
`task-8-wave10-report-p2.md`, `task-8-normative-addenda.md` (ADD-1/ADD-2, now ratified),
`roadmap/decisions/D-012-polled-prices-are-samples.md`. All 4 ACCEPTED.
CLOSED last round — do not re-open: F1's gate, F5/F6, the schema seam.

**CONCURRENCY RULES:** touch ONLY `internal/prices/**`, `internal/store/prices*.go`,
`.superpowers/sdd/**`. No new migration expected (`00007` exists; extend its test only if a fix
genuinely needs schema — flag loudly). Never `cmd/indexer/**`, `internal/store/derive.go`,
`internal/snapshot/**`, `roadmap/**`. Pathspec staging only. Shared-Postgres and foreign-file
caveats as before (scoped `-run`, archive-export verification if the tree is dirty, say so).

---

## P1 [high] — the binding must govern EVERY consumer (`prices.go:1129-1136`)

Wave 10 bound provenance per observation at write-time; the read side still joins anchors by
`p.block_number`. A NULL-bound legacy row at H + a later anchored round at H is reported anchored,
and repair can bless the old row via `verifyFloor` — the exact fabrication `00007` forbids.

**Do:** convert `PriceRepairExposure`, `CountUnanchoredPricesAbove`, candidate-floor handling, and
the neutralization reason to decide through `anchor_block`. NULL or missing bound anchor =
unprovable throughout the repair range, including at/below a later matching height anchor.
**Close the class, not the citations:** grep every consumer of `price_poll_anchors` /
`anchor_block` / height-join provenance and convert or explicitly justify EACH in your report.
Regressions: live-store AND poller — an unmarked NULL-bound row sharing H with a later anchor must
remain unprovable. Extend the mutation matrix to the repair/floor/adoption arms (round 9 showed
M2 covered only the WARN split).

## P2 [high] — adoption over pruned anchors recreates fabrication (`prices.go:1488-1499`)

`UnanchoredPriceBlocks` includes post-00007 rows whose genuine anchor was retention-pruned; restart
⇒ re-adopt current hash ⇒ a binding silently refers to a replacement block; prune ⇒ repeat at
cadence.

**Do — prefer deletion:** under ratified NULL-is-unprovable semantics, legacy adoption has no
remaining purpose the controller can name. Delete the adoption path (`adoptLegacyAnchors`,
`UnanchoredPriceBlocks`, `AdoptPollAnchor` if nothing else uses it) unless you identify a concrete
population that still needs it — name it if so, and then implement Codex's guards instead (never
adopt over a non-NULL binding whose anchor was pruned; never reuse an anchor identity once
observations were bound to its former hash). Either way: the restart regression with >
`pollAnchorRetention` rounds and a chain hash change before the epoch is observed.

## P3 [medium] — rewind exempts the BOUND anchor (`prices.go:1936-1943`)

Rows may be bound to an anchor at a different height (observations below `throughBlock` are legal).
**Do:** second NOT EXISTS on `p.anchor_block = a.block_number`, matching `prunePollAnchorsQuery`;
extend the live regression with an observation block below its execution/anchor block. The deleting
statement itself must preserve provenance independent of the identity guards (clause 2).

## P4 [medium] — propagate the ratified citations; fix two stale comments

Sequencing note (adjudicated in the archive): ADD-1/ADD-2 were ratified AFTER wave 10 landed — this
is propagation, not blame. **Do:** cite ADD-2 in the exposure-filtering test (delete its "no clause,
merely nominated" text); cite ADD-1 in every single-view disclosure assertion; replace the live
"D-011 CLAUSE 7" heading with D-012 clause 4; fix `poller.go:1921-1922`'s claim that the
no-checkpoint arm is ungated (F1 gated it — the comment contradicts the code beneath it). Then
re-audit the full citation table once more.

---

## Method (binding, unchanged)
Commit before mutation loops; mutations state the property and cover every ARM (write-side AND
read-side this time); no impossible store transitions; measured evidence measures the hard case;
citations to real sources only. If a gate blocks you, report it.

## Verification
Measure baseline at your start commit; state count + convention; zero FAIL/SKIP (foreign-file caveat);
build/vet/gofmt (READ output); `-race` in `golang:1.24` via `host.docker.internal`;
`TEST_DATABASE_URL='postgres://solvent:solvent@localhost:5432/solvent?sslmode=disable'`.

## Reporting
`.superpowers/sdd/task-8-wave12-report-p2.md`: per finding; the P1 consumer sweep table (every
consumer converted-or-justified); the P2 delete-vs-guard decision justified; mutation matrix incl.
the new arms; anything unverified.

Returns to Codex (prices unit) under D-006.
