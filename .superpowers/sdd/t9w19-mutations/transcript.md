# mutation transcript

- spec: `mutations.json`
- repo: `C:\Users\kasel\source\repos\etherfi\Solvent`
- **tested SHA: `10761f84b281bb63e460260cc46fc0cf4d137458`**  (docs(reconcile): pin the client cert/key citation exactly (pgconn/config.go pair-required check :702-704, loading :706-755) - comment-only; the round-16 law is citation-exact or it is not a citation)
- started (UTC): 2026-07-27T16:51:55+00:00
- applier: `mutate.py`, exactly-one-occurrence assertion in `apply_edit`

## W19M1 — guard reverted to path-only semantics: empty query values no longer override (the round-16 reversal)

**Property under attack:** M1: 'pinned' is judged under PGX'S OWN precedence - a dbname/host query parameter overwrites the path EVEN WITH AN EMPTY VALUE (pgconn/config.go:487-496, settings[k]=v[0] unconditionally). Reverting the empty-value override makes the guard path-only in exactly the reviewer's dimension: postgres://solvent@db/claimed?dbname= passes again while pgx connects to the server's default database.

```diff
--- cmd/reconcile/pgxdsn.go:107
-		settings[k] = v[0]
+		if v[0] != "" { settings[k] = v[0] }
```
APPLIED at cmd/reconcile/pgxdsn.go:107 (1 occurrence, asserted)

`go test ./cmd/reconcile/ -run TestPartialDSNIsRejected|TestDSNEffectiveClaimMatchesPgxParseConfig -count=1`

Killed by:
  - `TestDSNEffectiveClaimMatchesPgxParseConfig`
  - `TestPartialDSNIsRejected`

**Result: KILLED**

## W19M2 — claimVsConnectedTaint made informational: returns empty on every input

**Property under attack:** M1: the claimed-vs-connected database comparison is VERDICT-BEARING (round-16 M1) - a mismatch in either direction returns a taint that flows into computeResult. Making the mismatch informational (always-empty judge) is the wave-16 posture the finding named: both sides recorded honestly, the disagreement free.

```diff
--- cmd/reconcile/main.go:1141
-	if claimed == connected.Database {
+	if true || claimed == connected.Database {
```
APPLIED at cmd/reconcile/main.go:1141 (1 occurrence, asserted)

`go test ./cmd/reconcile/ -run TestClaimVsConnectedMismatchTaints -count=1`

Killed by:
  - `TestClaimVsConnectedMismatchTaints`

**Result: KILLED**

## W19M3 — APPDATA reclassified inert: appdataTrustTaint returns empty regardless of DSN

**Property under attack:** M2: APPDATA is verdict-bearing whenever it can select TLS trust material for the connection (pgconn defaults_windows.go:20-44 -> config.go:685-699) - appdataTrustTaint must taint a set APPDATA unless the DSN pins sslrootcert+sslcert+sslkey or sslmode=disable. Reclassifying it inert restores the wave-16 subject-inert claim round 16 disproved.

```diff
--- cmd/reconcile/env.go:290
-	if os.Getenv("APPDATA") == "" {
+	if true || os.Getenv("APPDATA") == "" {
```
APPLIED at cmd/reconcile/env.go:290 (1 occurrence, asserted)

`go test ./cmd/reconcile/ -run TestAppdataTrustMaterialTaint -count=1`

Killed by:
  - `TestAppdataTrustMaterialTaint`

**Result: KILLED**

## W19M4 — store.Open(ctx, roDSN) inserted immediately after gate.Enter()

**Property under attack:** M3: capability closure over FIRST-PARTY packages - internal/store calls from snapshotdb are restricted to the named audited entry points; store.Open (dial+ping on an arbitrary DSN) inserted under the closed gate must trip the boundary. The reviewer's exact shape: zero new imports, no interface, no function field, no direct pgx.Connect.

```diff
--- cmd/reconcile/snapshotdb/snapshotdb.go:495
-	released := false
+	released := false; side, sideErr := store.Open(ctx, roDSN); if sideErr == nil { side.Close() }
```
APPLIED at cmd/reconcile/snapshotdb/snapshotdb.go:495 (1 occurrence, asserted)

`go test ./cmd/reconcile/snapshotdb/ -run TestSnapshotDB -count=1`

Killed by:
  - `TestSnapshotDBCapabilityBoundary`

**Result: KILLED**

## W19M5 — pgx.Connect locally aliased and dialed through the alias (non-selector call) under the closed gate

**Property under attack:** M3: non-selector calls and locally-aliased function values join the scan - `dial := pgx.Connect; dial(ctx, ...)` contains no selector call to Connect, so the wave-16 scan passed it; the round-16 formation ban must refuse the alias at its formation site (a disciplined-package function referenced outside direct call position).

```diff
--- cmd/reconcile/snapshotdb/snapshotdb.go:495
-	released := false
+	released := false; dial := pgx.Connect; c2, dErr := dial(ctx, roDSN); if dErr == nil { _ = c2.Close(ctx) }
```
APPLIED at cmd/reconcile/snapshotdb/snapshotdb.go:495 (1 occurrence, asserted)

`go test ./cmd/reconcile/snapshotdb/ -run TestSnapshotDB -count=1`

Killed by:
  - `TestSnapshotDBCapabilityBoundary`

**Result: KILLED**

## W19M6 — prior-generation read allowed: the CASE mask reverted to the bare configured_interval_seconds column

**Property under attack:** M4: a cadence stamped by a PRIOR generation is UNREADABLE BY CONSTRUCTION - SweepGenerationRow's CASE mask surfaces configured_interval_seconds only when configured_interval_generation = current_generation. Reverting the mask to the bare column allows the prior-generation read: the reviewer's stale 2h would again back 2x(2h+lastPass).

```diff
--- internal/store/reconcile.go:856
-		        CASE WHEN configured_interval_generation = current_generation THEN configured_interval_seconds END
+		        configured_interval_seconds
```
APPLIED at internal/store/reconcile.go:856 (1 occurrence, asserted)

`go test ./internal/store/ -run TestSweepCadenceUnreadableFromPriorGeneration|TestMigrateUpgradesV9AddingCadenceGenerationUnstamped|TestMigrateUpgradesV8AddingConfiguredIntervalNullEverywhere -count=1`

Killed by:
  - `TestMigrateUpgradesV8AddingConfiguredIntervalNullEverywhere`
  - `TestMigrateUpgradesV9AddingCadenceGenerationUnstamped`
  - `TestSweepCadenceUnreadableFromPriorGeneration`

**Result: KILLED**

## W19M7 — fallback restored (verdict half): the unconditional unverified-cadence taint is dropped after being appended

**Property under attack:** M4: absent/NULL cadence in acceptance IS a taint - an acceptance verdict never rests on an unverified cadence, and the recorded bound is advisory-under-taint, never clean. Popping the unconditional taint restores the fallback's verdict half: NULL is clean again and the advisory bound silently backs a pass.

```diff
--- cmd/reconcile/env.go:398
-		sweep.CurrentGeneration))
+		sweep.CurrentGeneration)); taints = taints[:len(taints)-1]
```
APPLIED at cmd/reconcile/env.go:398 (1 occurrence, asserted)

`go test ./cmd/reconcile/ -run TestUnverifiedCadenceTaintsAcceptance|TestExtremeSnapshotIntervalEnvIsNonPass -count=1`

Killed by:
  - `TestExtremeSnapshotIntervalEnvIsNonPass`
  - `TestUnverifiedCadenceTaintsAcceptance`

**Result: KILLED**

## W19M8 — fallback restored (width half): the advisory bound computed from the env value when parseable

**Property under attack:** M4: SOLVENT_SNAPSHOT_INTERVAL never feeds a bound on ANY path - the advisory bound is the canonical default shape only. Feeding the env value back into the advisory bound restores the fallback's width half: a 1000000h env claim inflates the recorded bound exactly like wave 15's max(2xenv, ...) arm.

```diff
--- cmd/reconcile/env.go:378
-	bound = 2 * (canonicalSnapshotInterval + lastPass)
+	if d, err := time.ParseDuration(envRaw); err == nil && d > 0 { bound = 2 * (d + lastPass) } else { bound = 2 * (canonicalSnapshotInterval + lastPass) }
```
APPLIED at cmd/reconcile/env.go:378 (1 occurrence, asserted)

`go test ./cmd/reconcile/ -run TestUnverifiedCadenceTaintsAcceptance|TestExtremeSnapshotIntervalEnvIsNonPass -count=1`

Killed by:
  - `TestExtremeSnapshotIntervalEnvIsNonPass`
  - `TestUnverifiedCadenceTaintsAcceptance`

**Result: KILLED**

## W19M9 — generation stamp never lands: SET configured_interval_generation = configured_interval_generation (self-assignment)

**Property under attack:** M4: the write stamps configured_interval_generation = current_generation in the SAME UPDATE as the seconds - the binding the current-generation read requires. Freezing the stamp (self-assignment) means a written cadence never becomes readable under the new generation and the idempotence guard re-fires forever: the write-side half of the generation binding.

```diff
--- internal/store/derive.go:1546
-		    configured_interval_generation = current_generation
+		    configured_interval_generation = configured_interval_generation
```
APPLIED at internal/store/derive.go:1546 (1 occurrence, asserted)

`go test ./internal/store/ -run TestSweepCadenceUnreadableFromPriorGeneration|TestMigrateUpgradesV9AddingCadenceGenerationUnstamped -count=1`

Killed by:
  - `TestMigrateUpgradesV9AddingCadenceGenerationUnstamped`
  - `TestSweepCadenceUnreadableFromPriorGeneration`

**Result: KILLED**

## restore verification

`git status --porcelain` over the 6 mutated file(s) is EMPTY: every file is byte-identical to `10761f8`. Restores came from in-memory copies taken before each edit; `git checkout` is never used.

## summary

| # | result | property | killed by |
|---|---|---|---|
| W19M1 | **KILLED** | M1: 'pinned' is judged under PGX'S OWN precedence - a dbname/host query parameter overwrites the path EVEN WITH AN EMPTY VALUE (pgconn/config.go:487-496, settings[k]=v[0] unconditionally). Reverting the empty-value override makes the guard path-only in exactly the reviewer's dimension: postgres://solvent@db/claimed?dbname= passes again while pgx connects to the server's default database. | `TestDSNEffectiveClaimMatchesPgxParseConfig`<br>`TestPartialDSNIsRejected` |
| W19M2 | **KILLED** | M1: the claimed-vs-connected database comparison is VERDICT-BEARING (round-16 M1) - a mismatch in either direction returns a taint that flows into computeResult. Making the mismatch informational (always-empty judge) is the wave-16 posture the finding named: both sides recorded honestly, the disagreement free. | `TestClaimVsConnectedMismatchTaints` |
| W19M3 | **KILLED** | M2: APPDATA is verdict-bearing whenever it can select TLS trust material for the connection (pgconn defaults_windows.go:20-44 -> config.go:685-699) - appdataTrustTaint must taint a set APPDATA unless the DSN pins sslrootcert+sslcert+sslkey or sslmode=disable. Reclassifying it inert restores the wave-16 subject-inert claim round 16 disproved. | `TestAppdataTrustMaterialTaint` |
| W19M4 | **KILLED** | M3: capability closure over FIRST-PARTY packages - internal/store calls from snapshotdb are restricted to the named audited entry points; store.Open (dial+ping on an arbitrary DSN) inserted under the closed gate must trip the boundary. The reviewer's exact shape: zero new imports, no interface, no function field, no direct pgx.Connect. | `TestSnapshotDBCapabilityBoundary` |
| W19M5 | **KILLED** | M3: non-selector calls and locally-aliased function values join the scan - `dial := pgx.Connect; dial(ctx, ...)` contains no selector call to Connect, so the wave-16 scan passed it; the round-16 formation ban must refuse the alias at its formation site (a disciplined-package function referenced outside direct call position). | `TestSnapshotDBCapabilityBoundary` |
| W19M6 | **KILLED** | M4: a cadence stamped by a PRIOR generation is UNREADABLE BY CONSTRUCTION - SweepGenerationRow's CASE mask surfaces configured_interval_seconds only when configured_interval_generation = current_generation. Reverting the mask to the bare column allows the prior-generation read: the reviewer's stale 2h would again back 2x(2h+lastPass). | `TestMigrateUpgradesV8AddingConfiguredIntervalNullEverywhere`<br>`TestMigrateUpgradesV9AddingCadenceGenerationUnstamped`<br>`TestSweepCadenceUnreadableFromPriorGeneration` |
| W19M7 | **KILLED** | M4: absent/NULL cadence in acceptance IS a taint - an acceptance verdict never rests on an unverified cadence, and the recorded bound is advisory-under-taint, never clean. Popping the unconditional taint restores the fallback's verdict half: NULL is clean again and the advisory bound silently backs a pass. | `TestExtremeSnapshotIntervalEnvIsNonPass`<br>`TestUnverifiedCadenceTaintsAcceptance` |
| W19M8 | **KILLED** | M4: SOLVENT_SNAPSHOT_INTERVAL never feeds a bound on ANY path - the advisory bound is the canonical default shape only. Feeding the env value back into the advisory bound restores the fallback's width half: a 1000000h env claim inflates the recorded bound exactly like wave 15's max(2xenv, ...) arm. | `TestExtremeSnapshotIntervalEnvIsNonPass`<br>`TestUnverifiedCadenceTaintsAcceptance` |
| W19M9 | **KILLED** | M4: the write stamps configured_interval_generation = current_generation in the SAME UPDATE as the seconds - the binding the current-generation read requires. Freezing the stamp (self-assignment) means a written cadence never becomes readable under the new generation and the idempotence guard re-fires forever: the write-side half of the generation binding. | `TestMigrateUpgradesV9AddingCadenceGenerationUnstamped`<br>`TestSweepCadenceUnreadableFromPriorGeneration` |

9 mutants, 9 killed, 0 survived.
