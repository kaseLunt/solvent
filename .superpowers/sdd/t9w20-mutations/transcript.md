# mutation transcript

- spec: `mutations.json`
- repo: `C:\Users\kasel\source\repos\etherfi\Solvent`
- **tested SHA: `60e05e39c2365e9cd7b9a8ebf240e20d48e49d57`**  (test(sdd): task-9 wave-20 mutation spec committed BEFORE the loop (6 mutants: startup fatality tolerated; run() wiring of the fatality removed; APPDATA predicate reverted to empty==clean; non-Windows ignore removed; the exact DialFunc-alias shape after gate.Enter(); the execute claim-vs-connected wiring removed))
- started (UTC): 2026-07-27T18:01:59+00:00
- applier: `mutate.py`, exactly-one-occurrence assertion in `apply_edit`

## W20M1 — instance binding removed: requireStartupSweepCadence tolerates the failed startup write (logs and returns nil)

**Property under attack:** H1: the pre-loop cadence stamp is MANDATORY AND FATAL (round-19 H1, mechanism b) - a daemon that cannot stamp its OWN configured cadence refuses to run, because restart does not roll current_generation and a PRIOR instance's stamp would otherwise remain readable-as-verified while this instance enforces a different rule (Codex's 2h/30m scenario). Swallowing the startup error restores the tolerated posture the finding named.

```diff
--- cmd/indexer/main.go:904
-		return fmt.Errorf("refusing to start: the configured sweep cadence (%s) could not be stamped onto engine %q's durable sweep row: %w — restart does not roll current_generation, so a PRIOR instance's stamp would remain readable as daemon-verified while this instance enforces a different rule (round-19 H1); the daemon does not run until the readable cadence belongs to the running instance", interval, engine, err)
+		slog.Warn("could not persist the configured sweep cadence at startup; tolerated", "engine", engine, "interval", interval, "err", err); return nil
```
APPLIED at cmd/indexer/main.go:904 (1 occurrence, asserted)

`go test ./cmd/indexer/ -run TestStartupCadenceStampIsMandatoryFatal -count=1`

Killed by:
  - `TestStartupCadenceStampIsMandatoryFatal`

**Result: KILLED**

## W20M2 — the run() wiring of the startup fatality removed: the call replaced by a vacuous nil-error check

**Property under attack:** H1 wiring (the round-19 L4 lesson applied to H1 preemptively): run() must actually CALL requireStartupSweepCadence and RETURN its error - a fatality helper nobody calls is the predecessor-draft bug class. Deleting the call recreates the unwired state while the fatality unit test stays green.

```diff
--- cmd/indexer/main.go:2515
-		if err := requireStartupSweepCadence(ctx, st, sweepEngine, cfg.SnapshotInterval); err != nil {
+		if err := error(nil); err != nil {
```
APPLIED at cmd/indexer/main.go:2515 (1 occurrence, asserted)

`go test ./cmd/indexer/ -run TestStartupCadenceFatalWiredIntoRun -count=1`

Killed by:
  - `TestStartupCadenceFatalWiredIntoRun`

**Result: KILLED**

## W20M3 — the APPDATA predicate reverted to empty==clean (empty APPDATA short-circuits to no-taint on Windows)

**Property under attack:** H2: on Windows, unpinned TLS trust material is unverified EVEN WHEN APPDATA IS EMPTY - pgx joins the default trust paths unguarded (defaults_windows.go:30-44), so an empty APPDATA yields the CWD-relative postgresql\root.crt a planted file satisfies. Reverting to empty==clean restores the wave-19 arm round 19 named: clearing APPDATA would again read as neutralization while the working directory supplies the trust root.

```diff
--- cmd/reconcile/env.go:331
-	if goos != "windows" {
+	if goos != "windows" || appdata == "" {
```
APPLIED at cmd/reconcile/env.go:331 (1 occurrence, asserted)

`go test ./cmd/reconcile/ -run TestAppdataTrustMaterialTaint -count=1`

Killed by:
  - `TestAppdataTrustMaterialTaint`

**Result: KILLED**

## W20M4 — the non-Windows ignore removed: the platform check short-circuited so every GOOS judges like Windows

**Property under attack:** H2: non-Windows builds of pgx NEVER read APPDATA (defaults.go, //go:build !windows - no env read), so the judge must IGNORE it off Windows. Removing the platform check makes every platform judge like Windows: an unrelated nonempty APPDATA + unpinned DSN false-taints on linux/darwin - the round-19 false-taint direction, and the direction the Linux race container exercises for real.

```diff
--- cmd/reconcile/env.go:331
-	if goos != "windows" {
+	if false && goos != "windows" {
```
APPLIED at cmd/reconcile/env.go:331 (1 occurrence, asserted)

`go test ./cmd/reconcile/ -run TestAppdataJudgeIgnoresNonWindowsPlatforms -count=1`

Killed by:
  - `TestAppdataJudgeIgnoresNonWindowsPlatforms`

**Result: KILLED**

## W20M5 — the exact round-19 DialFunc-alias shape inserted immediately after gate.Enter()

**Property under attack:** M3: function-value provenance closure - the round-19 alias generation `dial := conn.Config().DialFunc; dial(ctx, ...)` forms a capability function from a FOREIGN STRUCT FIELD (no new import, no package-level function reference, no direct func-field call) and dials under the open snapshot. It must die at the formation site (func-typed FieldVal selections banned in every position) and again at the call (foreign named function type pgconn.DialFunc not on the justification list).

```diff
--- cmd/reconcile/snapshotdb/snapshotdb.go:495
-	released := false
+	released := false; dialAlias := conn.Config().DialFunc; sideConn, sideDialErr := dialAlias(ctx, "tcp", "attacker.example:443"); if sideDialErr == nil { _ = sideConn.Close() }
```
APPLIED at cmd/reconcile/snapshotdb/snapshotdb.go:495 (1 occurrence, asserted)

`go test ./cmd/reconcile/snapshotdb/ -run TestSnapshotDB -count=1`

Killed by:
  - `TestSnapshotDBCapabilityBoundary`

**Result: KILLED**

## W20M6 — the execute wiring removed: the claimVsConnectedTaint call replaced by a vacuous empty-string guard (judge defined, never called)

**Property under attack:** L4: the claimed-vs-connected regression protects the WIRING - deleting the execute call that appends the taint recreates the predecessor draft's exact unwired state (judge defined, zero call sites) while TestClaimVsConnectedMismatchTaints and mutant W19M2 stay green. The structural call-site assertion must fail on zero call sites.

```diff
--- cmd/reconcile/main.go:855
-	if msg := claimVsConnectedTaint(claimedDB, p1.Identity); msg != "" {
+	if msg := ""; msg != "" {
```
APPLIED at cmd/reconcile/main.go:855 (1 occurrence, asserted)

`go test ./cmd/reconcile/ -run TestClaimVsConnectedTaintWiredIntoExecute -count=1`

Killed by:
  - `TestClaimVsConnectedTaintWiredIntoExecute`

**Result: KILLED**

## restore verification

`git status --porcelain` over the 4 mutated file(s) is EMPTY: every file is byte-identical to `60e05e3`. Restores came from in-memory copies taken before each edit; `git checkout` is never used.

## summary

| # | result | property | killed by |
|---|---|---|---|
| W20M1 | **KILLED** | H1: the pre-loop cadence stamp is MANDATORY AND FATAL (round-19 H1, mechanism b) - a daemon that cannot stamp its OWN configured cadence refuses to run, because restart does not roll current_generation and a PRIOR instance's stamp would otherwise remain readable-as-verified while this instance enforces a different rule (Codex's 2h/30m scenario). Swallowing the startup error restores the tolerated posture the finding named. | `TestStartupCadenceStampIsMandatoryFatal` |
| W20M2 | **KILLED** | H1 wiring (the round-19 L4 lesson applied to H1 preemptively): run() must actually CALL requireStartupSweepCadence and RETURN its error - a fatality helper nobody calls is the predecessor-draft bug class. Deleting the call recreates the unwired state while the fatality unit test stays green. | `TestStartupCadenceFatalWiredIntoRun` |
| W20M3 | **KILLED** | H2: on Windows, unpinned TLS trust material is unverified EVEN WHEN APPDATA IS EMPTY - pgx joins the default trust paths unguarded (defaults_windows.go:30-44), so an empty APPDATA yields the CWD-relative postgresql\root.crt a planted file satisfies. Reverting to empty==clean restores the wave-19 arm round 19 named: clearing APPDATA would again read as neutralization while the working directory supplies the trust root. | `TestAppdataTrustMaterialTaint` |
| W20M4 | **KILLED** | H2: non-Windows builds of pgx NEVER read APPDATA (defaults.go, //go:build !windows - no env read), so the judge must IGNORE it off Windows. Removing the platform check makes every platform judge like Windows: an unrelated nonempty APPDATA + unpinned DSN false-taints on linux/darwin - the round-19 false-taint direction, and the direction the Linux race container exercises for real. | `TestAppdataJudgeIgnoresNonWindowsPlatforms` |
| W20M5 | **KILLED** | M3: function-value provenance closure - the round-19 alias generation `dial := conn.Config().DialFunc; dial(ctx, ...)` forms a capability function from a FOREIGN STRUCT FIELD (no new import, no package-level function reference, no direct func-field call) and dials under the open snapshot. It must die at the formation site (func-typed FieldVal selections banned in every position) and again at the call (foreign named function type pgconn.DialFunc not on the justification list). | `TestSnapshotDBCapabilityBoundary` |
| W20M6 | **KILLED** | L4: the claimed-vs-connected regression protects the WIRING - deleting the execute call that appends the taint recreates the predecessor draft's exact unwired state (judge defined, zero call sites) while TestClaimVsConnectedMismatchTaints and mutant W19M2 stay green. The structural call-site assertion must fail on zero call sites. | `TestClaimVsConnectedTaintWiredIntoExecute` |

6 mutants, 6 killed, 0 survived.
