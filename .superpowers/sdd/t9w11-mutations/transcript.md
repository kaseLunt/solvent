# mutation transcript

- spec: `mutations.json`
- repo: `C:\Users\kasel\source\repos\etherfi\Solvent`
- **tested SHA: `fc6a04067b716fcda962aa5e48c227ac39a64b94`**  (docs(sdd): oracle-sentinel B3 ruling - redefined to empirical-heartbeat scan (A1-A5); provenance holds, zero blockers)
- started (UTC): 2026-07-26T21:34:33+00:00
- applier: `mutate.py`, exactly-one-occurrence assertion in `apply_edit`

## W11M1 — guard-bypassed (round-10 F1): VerifyDestructiveSplit returns nil unconditionally — the shared destructive-test boundary stops deciding

**Property under attack:** EVERY destructive helper's split verification must refuse — fail CLOSED with the runbook message — on test/live identity equality OR on any unresolvable identity; a guard that returns nil lets `make test` truncate the live backfill the moment TEST_DATABASE_URL is mis-pointed. Killed by TestDestructiveGuardRefusesSameDatabase (same DSN both sides MUST error with 'physical split required') and TestVerifyDestructiveSplitFailsClosedWithoutADatabase (empty/unparseable DSNs MUST error).

```diff
--- internal/store/reconcile.go:187
-func VerifyDestructiveSplit(ctx context.Context, testDSN, liveDSN string) error {
-	if strings.TrimSpace(testDSN) == "" {
+func VerifyDestructiveSplit(ctx context.Context, testDSN, liveDSN string) error {
+	if true {
+		return nil // MUTANT: guard bypassed
+	}
+	if strings.TrimSpace(testDSN) == "" {
```
APPLIED at internal/store/reconcile.go:187 (1 occurrence, asserted)

`go test ./internal/store/ -run TestDestructiveGuardRefusesSameDatabase|TestVerifyDestructiveSplitFailsClosedWithoutADatabase -count=1`

Killed by:
  - `TestDestructiveGuardRefusesSameDatabase`
  - `TestVerifyDestructiveSplitFailsClosedWithoutADatabase`

**Result: KILLED**

## W11M2 — taint-dropped-from-verdict (round-10 F2): computeResult ignores the taint set — taints become metadata again

**Property under attack:** the verdict function CONSUMES the taint set: any acceptance taint (bypassed required check, pin override, invalid -accounts replay, small sample) forces result 'tainted' with exit 1 even when every gated row is exact — a tainted run structurally CANNOT return pass. Killed by TestTaintedRunCannotPass (taints present + zero gated failures must yield 'tainted'/exit 1; the mutant yields 'pass'/exit 0).

```diff
--- cmd/reconcile/main.go:467
-	if len(taints) > 0 {
-		return "tainted", exitVerdictFail
-	}
-	return "pass", exitPass
+	_ = taints // MUTANT: taints are metadata again, not a verdict input
+	return "pass", exitPass
```
APPLIED at cmd/reconcile/main.go:467 (1 occurrence, asserted)

`go test ./cmd/reconcile/ -run TestTaintedRunCannotPass -count=1`

Killed by:
  - `TestTaintedRunCannotPass`

**Result: KILLED**

## W11M3 — unread-token-vanishes (round-10 F3): weldDMAggregate's row set reverts to derived ∪ successfully-read tokens — the universe stops being authoritative

**Property under attack:** the DM weld iterates the EXPLICIT universe getBorrowTokens(@pin) ∪ derived; a universe token whose borrowTokenConfig read failed (or was never recorded) must surface as a GATED weld-unread row. Under the mutant, a configured token with no derived rows and a reverting config read produces NO row at all — the unverifiable aggregate leg passes silently, which is verbatim the round-10 F3 hole. Killed by TestWeldDMAggregateUnreadTokenIsGatedRow (expects 3 rows including two weld-unread; the mutant drops the read-failed universe token).

```diff
--- cmd/reconcile/dm.go:341
-	union := map[common.Address]bool{}
-	for _, tok := range universe {
-		union[tok] = true
-	}
-	for tok := range derived {
-		union[tok] = true
-	}
-	for tok := range reads {
-		union[tok] = true
-	}
+	union := map[common.Address]bool{}
+	for tok := range derived {
+		union[tok] = true
+	}
+	for tok := range reads {
+		if reads[tok].OK {
+			union[tok] = true
+		}
+	}
+	_ = universe // MUTANT: the weld universe is whatever happened to be readable
```
APPLIED at cmd/reconcile/dm.go:341 (1 occurrence, asserted)

`go test ./cmd/reconcile/ -run TestWeldDMAggregateUnreadTokenIsGatedRow -count=1`

Killed by:
  - `TestWeldDMAggregateUnreadTokenIsGatedRow`

**Result: KILLED**

## W11M4 — string-identity-revert (round-10 F4): DatabaseIdentity's cluster leg reverts to the connection's transport address (inet_server_addr:port) — the pre-fix worldview

**Property under attack:** database identity is the PHYSICAL tuple (pg_control system_identifier, database OID, database name): two DSN spellings of one database MUST resolve to the same identity regardless of transport (IPv4 vs IPv6 vs hostname), and the tuple's cluster leg provably comes from pg_control_system(). Killed by TestDatabaseIdentityTupleAndAliasEquivalence twice over: the direct pg_control cross-check (the mutant's addr:port never equals system_identifier) and alias equivalence (localhost→::1 vs 127.0.0.1 produce different transport addresses, so the mutant forks the identity across aliases of one database — exactly the round-10 fail-open).

```diff
--- internal/store/reconcile.go:146
-		`SELECT (SELECT system_identifier::text FROM pg_control_system()),
-		        (SELECT oid FROM pg_database WHERE datname = current_database()),
-		        current_database()`).Scan(&id.SystemIdentifier, &id.DatabaseOID, &id.DatabaseName); err != nil {
+		`SELECT COALESCE(inet_server_addr()::text, 'local') || ':' || COALESCE(inet_server_port()::text, '0'),
+		        (SELECT oid FROM pg_database WHERE datname = current_database()),
+		        current_database()`).Scan(&id.SystemIdentifier, &id.DatabaseOID, &id.DatabaseName); err != nil {
```
APPLIED at internal/store/reconcile.go:146 (1 occurrence, asserted)

`go test ./internal/store/ -run TestDatabaseIdentityTupleAndAliasEquivalence -count=1`

Killed by:
  - `TestDatabaseIdentityTupleAndAliasEquivalence`

**Result: KILLED**

## W11M5 — F5 seam smuggle (network-under-snapshot's representable half): snapshotData grows a pgx.Tx field — a connection handle crossing the Stage A/Stage B seam

**Property under attack:** the F5 guarantee is structural, in two halves: (1) collectSnapshot's signature carries no chain reader, so RPC-under-snapshot is not writable without a review-visible signature change — NOT point-representable, argued in the report; (2) snapshotData, the only value crossing the seam, is PLAIN DATA — no connection, transaction, pool, or reader can leak out of the committed-and-closed stage for later code to hold across RPC. This mutant attacks half (2). Killed by TestSnapshotDataCarriesNoConnections (the reflection walk finds the jackc/pgx type).

```diff
--- cmd/reconcile/phase1.go:112
-	weldDB     map[string]weldDBData
-	invariants *invariantsSection
-}
+	weldDB     map[string]weldDBData
+	invariants *invariantsSection
+	leakedTx   pgx.Tx // MUTANT: a connection handle crossing the F5 seam
+}
```
APPLIED at cmd/reconcile/phase1.go:112 (1 occurrence, asserted)

`go test ./cmd/reconcile/ -run TestSnapshotDataCarriesNoConnections -count=1`

Killed by:
  - `TestSnapshotDataCarriesNoConnections`

**Result: KILLED**

## restore verification

`git status --porcelain` over the 4 mutated file(s) is EMPTY: every file is byte-identical to `fc6a040`. Restores came from in-memory copies taken before each edit; `git checkout` is never used.

## summary

| # | result | property | killed by |
|---|---|---|---|
| W11M1 | **KILLED** | EVERY destructive helper's split verification must refuse — fail CLOSED with the runbook message — on test/live identity equality OR on any unresolvable identity; a guard that returns nil lets `make test` truncate the live backfill the moment TEST_DATABASE_URL is mis-pointed. Killed by TestDestructiveGuardRefusesSameDatabase (same DSN both sides MUST error with 'physical split required') and TestVerifyDestructiveSplitFailsClosedWithoutADatabase (empty/unparseable DSNs MUST error). | `TestDestructiveGuardRefusesSameDatabase`<br>`TestVerifyDestructiveSplitFailsClosedWithoutADatabase` |
| W11M2 | **KILLED** | the verdict function CONSUMES the taint set: any acceptance taint (bypassed required check, pin override, invalid -accounts replay, small sample) forces result 'tainted' with exit 1 even when every gated row is exact — a tainted run structurally CANNOT return pass. Killed by TestTaintedRunCannotPass (taints present + zero gated failures must yield 'tainted'/exit 1; the mutant yields 'pass'/exit 0). | `TestTaintedRunCannotPass` |
| W11M3 | **KILLED** | the DM weld iterates the EXPLICIT universe getBorrowTokens(@pin) ∪ derived; a universe token whose borrowTokenConfig read failed (or was never recorded) must surface as a GATED weld-unread row. Under the mutant, a configured token with no derived rows and a reverting config read produces NO row at all — the unverifiable aggregate leg passes silently, which is verbatim the round-10 F3 hole. Killed by TestWeldDMAggregateUnreadTokenIsGatedRow (expects 3 rows including two weld-unread; the mutant drops the read-failed universe token). | `TestWeldDMAggregateUnreadTokenIsGatedRow` |
| W11M4 | **KILLED** | database identity is the PHYSICAL tuple (pg_control system_identifier, database OID, database name): two DSN spellings of one database MUST resolve to the same identity regardless of transport (IPv4 vs IPv6 vs hostname), and the tuple's cluster leg provably comes from pg_control_system(). Killed by TestDatabaseIdentityTupleAndAliasEquivalence twice over: the direct pg_control cross-check (the mutant's addr:port never equals system_identifier) and alias equivalence (localhost→::1 vs 127.0.0.1 produce different transport addresses, so the mutant forks the identity across aliases of one database — exactly the round-10 fail-open). | `TestDatabaseIdentityTupleAndAliasEquivalence` |
| W11M5 | **KILLED** | the F5 guarantee is structural, in two halves: (1) collectSnapshot's signature carries no chain reader, so RPC-under-snapshot is not writable without a review-visible signature change — NOT point-representable, argued in the report; (2) snapshotData, the only value crossing the seam, is PLAIN DATA — no connection, transaction, pool, or reader can leak out of the committed-and-closed stage for later code to hold across RPC. This mutant attacks half (2). Killed by TestSnapshotDataCarriesNoConnections (the reflection walk finds the jackc/pgx type). | `TestSnapshotDataCarriesNoConnections` |

5 mutants, 5 killed, 0 survived.
