# mutation transcript

- spec: `mutations.json`
- repo: `C:\Users\kasel\source\repos\etherfi\Solvent`
- **tested SHA: `a3fba235e788048e07ca3bdbe4049c6773305d0c`**  (test(reconcile): wave-13 mutation spec (3 mutants, one per round-11 finding, committed before the loop))
- started (UTC): 2026-07-26T22:42:18+00:00
- applier: `mutate.py`, exactly-one-occurrence assertion in `apply_edit`

## W13M1 — generator-drop (round-11 F1): the -snapshot-max-age branch is removed from acceptanceTaints — the freshness bound becomes an acceptance-clean override again

**Property under attack:** the taint GENERATOR is closed over every bound-weakening flag: any explicit -snapshot-max-age replaces the §7 policy bound with an operator constant and MUST taint, so the round-11 invocation `-snapshot-max-age 2562047h -max-head-lag 2562047h` is structurally non-pass. Killed by TestFlagSurfaceClosed (the snapshot-max-age mustTaint case parses real argv through parseFlags → acceptanceTaints → computeResult) and TestLooseBoundsInvocationIsNonPass (the binding invocation verbatim).

```diff
--- cmd/reconcile/main.go:216
-	if o.snapshotMaxAge != canonicalSnapshotMaxAge && o.snapshotMaxAge != "" {
-		taints = append(taints, fmt.Sprintf("-snapshot-max-age %s replaces the §7 policy bound (auto = derived from the daemon's own cadence) with an operator constant — a loose value makes the freshness gate vacuous for any realistic stale state", o.snapshotMaxAge))
-	}
+	_ = o.snapshotMaxAge // MUTANT: -snapshot-max-age dropped from the taint generator
```
APPLIED at cmd/reconcile/main.go:216 (1 occurrence, asserted)

`go test ./cmd/reconcile/ -run TestFlagSurfaceClosed|TestLooseBoundsInvocationIsNonPass -count=1`

Killed by:
  - `TestFlagSurfaceClosed`
  - `TestLooseBoundsInvocationIsNonPass`

**Result: KILLED**

## W13M2 — unread-ungated (round-11 F2): weld-unread rows fall back to the side's numeric-mismatch policy — an unreadable collateral leg becomes advisory again

**Property under attack:** ability-to-check is never advisory: a weld-unread row (reverted getReserveAToken, unreadable scaledTotalSupply, or a never-attempted universe leg) is GATED on BOTH Aave weld sides regardless of the gated parameter, which carries the numeric-mismatch policy only. Under the mutant, a reverting collateral resolution flows through aaveWeldGatedFailures as zero and the run can pass with an unverifiable collateral universe — verbatim the round-11 finding 2 hole. Killed by TestCollateralUnreadIsGatedEvenWhenNumericIsAdvisory (asserts Gated on both unread shapes, 2 gated failures through the REAL accounting, and the non-pass verdict).

```diff
--- cmd/reconcile/aave.go:159
-		if row.Verdict == verdictWeldUnread {
-			row.Gated = true
-		}
+		_ = verdictWeldUnread // MUTANT: unread rows fall back to the side's numeric policy
```
APPLIED at cmd/reconcile/aave.go:159 (1 occurrence, asserted)

`go test ./cmd/reconcile/ -run TestCollateralUnreadIsGatedEvenWhenNumericIsAdvisory -count=1`

Killed by:
  - `TestCollateralUnreadIsGatedEvenWhenNumericIsAdvisory`

**Result: KILLED**

## W13M3 — header-under-BeginTx (round-11 F3, the MANDATED mutation): an actual headerHash RPC call is reintroduced inside collectSnapshot while the repeatable-read transaction is open — with the *pinnedReader parameter and call-site change it needs to compile

**Property under attack:** no network call is reachable from collectSnapshot while the snapshot transaction is open. Wave 11 claimed this mutant was unrepresentable; it is representable (three mechanical edits, compiles clean — verified before this spec was committed) and must be KILLED by TestCollectSnapshotReachesNoChainSurface, which refuses both the smuggled pinnedReader type in the signature and the headerHash call in the body by AST reachability — without executing a single query. (The runtime sentinel would ALSO refuse this call on any live run: snapshotGate is open at the injected call site, so the mutant's own execution path returns the F5 seam violation.)

```diff
--- cmd/reconcile/phase1.go:198
-func collectSnapshot(ctx context.Context, o *options, cfg *config.Config, roDSN string, vec goldenVectors, wantDM, wantAave bool, extraAccounts [][]byte) (*snapshotData, error) {
+func collectSnapshot(ctx context.Context, o *options, cfg *config.Config, roDSN string, vec goldenVectors, wantDM, wantAave bool, extraAccounts [][]byte, r *pinnedReader) (*snapshotData, error) {
```
APPLIED at cmd/reconcile/phase1.go:198 (1 occurrence, asserted)

```diff
--- cmd/reconcile/phase1.go:239
-	snapshotGate.enter()
-	defer snapshotGate.exit()
+	snapshotGate.enter()
+	defer snapshotGate.exit()
+	if r != nil { // MUTANT: an actual header read under BeginTx — the round-10 F5 regression
+		if _, _, err := r.headerHash(ctx, 1); err != nil {
+			return nil, err
+		}
+	}
```
APPLIED at cmd/reconcile/phase1.go:239 (1 occurrence, asserted)

```diff
--- cmd/reconcile/phase1.go:515
-	snap, err := collectSnapshot(ctx, o, cfg, roDSN, vec, wantDM, wantAave, extras)
+	snap, err := collectSnapshot(ctx, o, cfg, roDSN, vec, wantDM, wantAave, extras, opReader)
```
APPLIED at cmd/reconcile/phase1.go:515 (1 occurrence, asserted)

`go test ./cmd/reconcile/ -run TestCollectSnapshotReachesNoChainSurface -count=1`

Killed by:
  - `TestCollectSnapshotReachesNoChainSurface`

**Result: KILLED**

## restore verification

`git status --porcelain` over the 3 mutated file(s) is EMPTY: every file is byte-identical to `a3fba23`. Restores came from in-memory copies taken before each edit; `git checkout` is never used.

## summary

| # | result | property | killed by |
|---|---|---|---|
| W13M1 | **KILLED** | the taint GENERATOR is closed over every bound-weakening flag: any explicit -snapshot-max-age replaces the §7 policy bound with an operator constant and MUST taint, so the round-11 invocation `-snapshot-max-age 2562047h -max-head-lag 2562047h` is structurally non-pass. Killed by TestFlagSurfaceClosed (the snapshot-max-age mustTaint case parses real argv through parseFlags → acceptanceTaints → computeResult) and TestLooseBoundsInvocationIsNonPass (the binding invocation verbatim). | `TestFlagSurfaceClosed`<br>`TestLooseBoundsInvocationIsNonPass` |
| W13M2 | **KILLED** | ability-to-check is never advisory: a weld-unread row (reverted getReserveAToken, unreadable scaledTotalSupply, or a never-attempted universe leg) is GATED on BOTH Aave weld sides regardless of the gated parameter, which carries the numeric-mismatch policy only. Under the mutant, a reverting collateral resolution flows through aaveWeldGatedFailures as zero and the run can pass with an unverifiable collateral universe — verbatim the round-11 finding 2 hole. Killed by TestCollateralUnreadIsGatedEvenWhenNumericIsAdvisory (asserts Gated on both unread shapes, 2 gated failures through the REAL accounting, and the non-pass verdict). | `TestCollateralUnreadIsGatedEvenWhenNumericIsAdvisory` |
| W13M3 | **KILLED** | no network call is reachable from collectSnapshot while the snapshot transaction is open. Wave 11 claimed this mutant was unrepresentable; it is representable (three mechanical edits, compiles clean — verified before this spec was committed) and must be KILLED by TestCollectSnapshotReachesNoChainSurface, which refuses both the smuggled pinnedReader type in the signature and the headerHash call in the body by AST reachability — without executing a single query. (The runtime sentinel would ALSO refuse this call on any live run: snapshotGate is open at the injected call site, so the mutant's own execution path returns the F5 seam violation.) | `TestCollectSnapshotReachesNoChainSurface` |

3 mutants, 3 killed, 0 survived.
