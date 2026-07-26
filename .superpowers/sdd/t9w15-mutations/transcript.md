# mutation transcript

- spec: `mutations.json`
- repo: `C:\Users\kasel\source\repos\etherfi\Solvent`
- **tested SHA: `2f5f55660c49fde1bd1f31d2a38cf18f0918e0f8`**  (test(reconcile): wave-15 mutation spec (6 mutants: F1 cap + one per round-13 evasion shape + gate-wiring drop), committed before the loop)
- started (UTC): 2026-07-26T23:49:09+00:00
- applier: `mutate.py`, exactly-one-occurrence assertion in `apply_edit`

## W15M1 — acceptance cap removed from snapshotIntervalTaint (the over-cap branch never fires)

**Property under attack:** F1: an env-asserted sweep cadence LOOSER than the canonical 1h daemon default must taint acceptance - the cap on SOLVENT_SNAPSHOT_INTERVAL is what stops a 1000000h interval from laundering stale snapshots through a ~228-year freshness bound.

```diff
--- cmd/reconcile/env.go:68
-	if d > canonicalSnapshotInterval {
+	if false { // W15M1: acceptance cap removed
```
APPLIED at cmd/reconcile/env.go:68 (1 occurrence, asserted)

`go test ./cmd/reconcile -run TestEnvSurfaceClosed|TestExtremeSnapshotIntervalEnvIsNonPass -count=1`

Killed by:
  - `TestEnvSurfaceClosed`
  - `TestExtremeSnapshotIntervalEnvIsNonPass`

**Result: KILLED**

## W15M2 — aliased net/http import smuggled into snapshotdb (compiles: the alias is referenced)

**Property under attack:** F2 evasion shape 'aliased import': `import web "net/http"` defeats identifier-based qualifier checks (the wave-13 walk matched the NAME http), but the import allowlist asserts PATHS - the package must refuse any non-allowlisted import path however it is spelled.

```diff
--- cmd/reconcile/snapshotdb/snapshotdb.go:56
-	"github.com/ethereum/go-ethereum/common"
-	"github.com/jackc/pgx/v5"
+	web "net/http"
+
+	"github.com/ethereum/go-ethereum/common"
+	"github.com/jackc/pgx/v5"
```
APPLIED at cmd/reconcile/snapshotdb/snapshotdb.go:56 (1 occurrence, asserted)

```diff
--- cmd/reconcile/snapshotdb/snapshotdb.go:326
-	closed := false
+	closed := false
+	_ = web.DefaultClient // W15M2: a name-matching walk sees only the qualifier "web"
```
APPLIED at cmd/reconcile/snapshotdb/snapshotdb.go:326 (1 occurrence, asserted)

`go test ./cmd/reconcile/snapshotdb -run TestSnapshotDBImportsAreDBOnly|TestSnapshotDBAPISurfaceRejectsInjection -count=1`

Killed by:
  - `TestSnapshotDBImportsAreDBOnly`

**Result: KILLED**

## W15M3 — package-level function value dialing raw TCP, invoked inside the open transaction (compiles)

**Property under attack:** F2 evasion shape 'package-level function value': `var snapshotRead = func(...){ ...network... }` called from Collect has no reader type and no named RPC call for a walk to match - but a function value cannot DIAL without an import, and a non-Gate package-level var is itself refused.

```diff
--- cmd/reconcile/snapshotdb/snapshotdb.go:52
-	"math/big"
-	"os"
+	"math/big"
+	"net"
+	"os"
```
APPLIED at cmd/reconcile/snapshotdb/snapshotdb.go:52 (1 occurrence, asserted)

```diff
--- cmd/reconcile/snapshotdb/snapshotdb.go:105
-var Gate = &Sentinel{}
+var Gate = &Sentinel{}
+
+// W15M3: the round-13 finding's exact shape.
+var snapshotRead = func(ctx context.Context) error {
+	c, err := net.Dial("tcp", "127.0.0.1:9")
+	if err == nil {
+		c.Close()
+	}
+	return err
+}
```
APPLIED at cmd/reconcile/snapshotdb/snapshotdb.go:105 (1 occurrence, asserted)

```diff
--- cmd/reconcile/snapshotdb/snapshotdb.go:353
-	Gate.Enter()
-	defer Gate.Exit()
+	Gate.Enter()
+	defer Gate.Exit()
+	_ = snapshotRead(ctx) // W15M3: network under the open snapshot, via a value no call-walk resolves
```
APPLIED at cmd/reconcile/snapshotdb/snapshotdb.go:353 (1 occurrence, asserted)

`go test ./cmd/reconcile/snapshotdb -run TestSnapshotDBImportsAreDBOnly|TestSnapshotDBAPISurfaceRejectsInjection -count=1`

Killed by:
  - `TestSnapshotDBAPISurfaceRejectsInjection`
  - `TestSnapshotDBImportsAreDBOnly`

**Result: KILLED**

## W15M4 — injected probe interface on Params, dispatched inside the open transaction (compiles, no new import)

**Property under attack:** F2 evasion shape 'interface dispatch': an interface-typed Params field lets cmd/reconcile (which CAN import chain) load a dialer into the snapshot package with zero new imports here - the API-surface test must refuse any interface type in a declared type or signature.

```diff
--- cmd/reconcile/snapshotdb/snapshotdb.go:116
-	// CollateralReplay > 0 prefetches the deep-replay history documents
-	// (the replay targets are picked from the SAMPLE after commit).
-	CollateralReplay int
-}
+	// CollateralReplay > 0 prefetches the deep-replay history documents
+	// (the replay targets are picked from the SAMPLE after commit).
+	CollateralReplay int
+	// W15M4: an injected probe - dispatch, not a named call.
+	Probe interface{ HeaderProbe(ctx context.Context) error }
+}
```
APPLIED at cmd/reconcile/snapshotdb/snapshotdb.go:116 (1 occurrence, asserted)

```diff
--- cmd/reconcile/snapshotdb/snapshotdb.go:348
-	// --- pins (§3.1): P = derive cursor read INSIDE the snapshot ----------
+	if prm.Probe != nil {
+		_ = prm.Probe.HeaderProbe(ctx) // W15M4: dispatches whatever the caller loaded in
+	}
+	// --- pins (§3.1): P = derive cursor read INSIDE the snapshot ----------
```
APPLIED at cmd/reconcile/snapshotdb/snapshotdb.go:348 (1 occurrence, asserted)

`go test ./cmd/reconcile/snapshotdb -run TestSnapshotDBImportsAreDBOnly|TestSnapshotDBAPISurfaceRejectsInjection -count=1`

Killed by:
  - `TestSnapshotDBAPISurfaceRejectsInjection`

**Result: KILLED**

## W15M5 — exported function hook called inside the open transaction (compiles, no new import)

**Property under attack:** F2 evasion shape 'exported hook' (the package-boundary spelling of the function-value shape): `var Hook func(...)` assigned by cmd/reconcile smuggles a dialer in with no import change - the only-package-level-var-is-Gate rule must refuse it.

```diff
--- cmd/reconcile/snapshotdb/snapshotdb.go:104
-var Gate = &Sentinel{}
+var Gate = &Sentinel{}
+
+// W15M5: an exported hook - the importer, not this package, brings the dialer.
+var Hook func(ctx context.Context)
```
APPLIED at cmd/reconcile/snapshotdb/snapshotdb.go:104 (1 occurrence, asserted)

```diff
--- cmd/reconcile/snapshotdb/snapshotdb.go:346
-	Gate.Enter()
-	defer Gate.Exit()
+	Gate.Enter()
+	defer Gate.Exit()
+	if Hook != nil {
+		Hook(ctx) // W15M5
+	}
```
APPLIED at cmd/reconcile/snapshotdb/snapshotdb.go:346 (1 occurrence, asserted)

`go test ./cmd/reconcile/snapshotdb -run TestSnapshotDBImportsAreDBOnly|TestSnapshotDBAPISurfaceRejectsInjection -count=1`

Killed by:
  - `TestSnapshotDBAPISurfaceRejectsInjection`

**Result: KILLED**

## W15M6 — gate wiring dropped from Collect (BeginTx no longer closes the RPC surface; compiles)

**Property under attack:** F2 binding: the PRODUCTION gate must be entered by Collect's own wiring for the transaction's lifetime - a Collect that no longer closes the RPC surface must be caught by the DB-backed lifecycle test observing (never toggling) the gate while the transaction is provably open.

*Requires TEST_DATABASE_URL (+ SOLVENT_DATABASE_URL for the split guard) in the loop environment - stated in meta.*

```diff
--- cmd/reconcile/snapshotdb/snapshotdb.go:343
-	Gate.Enter()
-	defer Gate.Exit()
+	// W15M6: gate wiring dropped - the RPC surface stays open under the snapshot
```
APPLIED at cmd/reconcile/snapshotdb/snapshotdb.go:343 (1 occurrence, asserted)

`go test ./cmd/reconcile -run TestProductionGateActiveThroughSnapshotLifecycle -count=1`

Killed by:
  - `TestProductionGateActiveThroughSnapshotLifecycle`

**Result: KILLED**

## restore verification

`git status --porcelain` over the 2 mutated file(s) is EMPTY: every file is byte-identical to `2f5f556`. Restores came from in-memory copies taken before each edit; `git checkout` is never used.

## summary

| # | result | property | killed by |
|---|---|---|---|
| W15M1 | **KILLED** | F1: an env-asserted sweep cadence LOOSER than the canonical 1h daemon default must taint acceptance - the cap on SOLVENT_SNAPSHOT_INTERVAL is what stops a 1000000h interval from laundering stale snapshots through a ~228-year freshness bound. | `TestEnvSurfaceClosed`<br>`TestExtremeSnapshotIntervalEnvIsNonPass` |
| W15M2 | **KILLED** | F2 evasion shape 'aliased import': `import web "net/http"` defeats identifier-based qualifier checks (the wave-13 walk matched the NAME http), but the import allowlist asserts PATHS - the package must refuse any non-allowlisted import path however it is spelled. | `TestSnapshotDBImportsAreDBOnly` |
| W15M3 | **KILLED** | F2 evasion shape 'package-level function value': `var snapshotRead = func(...){ ...network... }` called from Collect has no reader type and no named RPC call for a walk to match - but a function value cannot DIAL without an import, and a non-Gate package-level var is itself refused. | `TestSnapshotDBAPISurfaceRejectsInjection`<br>`TestSnapshotDBImportsAreDBOnly` |
| W15M4 | **KILLED** | F2 evasion shape 'interface dispatch': an interface-typed Params field lets cmd/reconcile (which CAN import chain) load a dialer into the snapshot package with zero new imports here - the API-surface test must refuse any interface type in a declared type or signature. | `TestSnapshotDBAPISurfaceRejectsInjection` |
| W15M5 | **KILLED** | F2 evasion shape 'exported hook' (the package-boundary spelling of the function-value shape): `var Hook func(...)` assigned by cmd/reconcile smuggles a dialer in with no import change - the only-package-level-var-is-Gate rule must refuse it. | `TestSnapshotDBAPISurfaceRejectsInjection` |
| W15M6 | **KILLED** | F2 binding: the PRODUCTION gate must be entered by Collect's own wiring for the transaction's lifetime - a Collect that no longer closes the RPC surface must be caught by the DB-backed lifecycle test observing (never toggling) the gate while the transaction is provably open. | `TestProductionGateActiveThroughSnapshotLifecycle` |

6 mutants, 6 killed, 0 survived.
