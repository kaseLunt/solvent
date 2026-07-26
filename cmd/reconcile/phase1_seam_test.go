// Round-10 F5 seam, DATA half: snapshotdb.Data — the ONLY value that
// crosses the Stage A/Stage B seam — must be plain data. No connection,
// transaction, pool, or chain-reader can leak out of Stage A for later code
// to hold across RPC (Stage A commits AND closes before returning). This
// test enforces that half mechanically: a reflection walk over Data's full
// reachable type graph asserting that no pgx / pgxpool type and no
// chain-reading type is embedded anywhere. A mutant that smuggles the
// transaction out through a new field dies here — and this stays
// load-bearing AFTER the round-13 F2 package split, because pgx is
// legitimately ON snapshotdb's import allowlist: the import test cannot see
// a pgx.Tx parked in a result field, this walk can.
//
// SCOPE (round-11 F3): this test inspects DATA, not BEHAVIOR. Wave 11
// overclaimed it as making network-under-snapshot unrepresentable; round 11
// disproved that, and round 13 (F2) replaced wave 13's AST walk with the
// structural proofs in cmd/reconcile/snapshotdb (import allowlist +
// injection-free API) plus the DB-proven runtime gate. The chain-reader
// half of the old local-type check is now a compile-time fact: snapshotdb
// cannot name pinnedReader/chainReader/rpcRunner at all (different package,
// unexported), so only the pgx fragment check below still needs a walker.
package main

import (
	"reflect"
	"strings"
	"testing"

	"github.com/kaselunt/solvent/cmd/reconcile/snapshotdb"
)

// forbiddenTypePathFragments are package-path / type-name fragments that
// must never appear inside snapshotdb.Data: database connection machinery
// and chain-reading machinery.
var forbiddenTypePathFragments = []string{
	"jackc/pgx",              // pgx.Conn, pgx.Tx, pgxpool.Pool, ...
	"solvent/internal/chain", // chain.Failover and friends
}

func walkType(t *testing.T, typ reflect.Type, path string, seen map[reflect.Type]bool) {
	t.Helper()
	if seen[typ] {
		return
	}
	seen[typ] = true

	if pkg := typ.PkgPath(); pkg != "" {
		for _, frag := range forbiddenTypePathFragments {
			if strings.Contains(pkg, frag) {
				t.Fatalf("snapshotdb.Data reaches %s.%s at %s — the F5 seam forbids connection/chain types in the snapshot result", pkg, typ.Name(), path)
			}
		}
	}

	switch typ.Kind() {
	case reflect.Ptr, reflect.Slice, reflect.Array:
		walkType(t, typ.Elem(), path+"/*", seen)
	case reflect.Map:
		walkType(t, typ.Key(), path+"/key", seen)
		walkType(t, typ.Elem(), path+"/value", seen)
	case reflect.Struct:
		for i := 0; i < typ.NumField(); i++ {
			f := typ.Field(i)
			walkType(t, f.Type, path+"."+f.Name, seen)
		}
	case reflect.Interface:
		// An interface field could hold ANYTHING at runtime — including a
		// transaction. Data must not carry interfaces at all, except the
		// empty-interface leaves inside artifact-bound documents
		// (ScanResult.Detail-style rendered values).
		if typ.NumMethod() > 0 {
			t.Fatalf("snapshotdb.Data carries a non-empty interface at %s — a connection or reader could hide behind it", path)
		}
	case reflect.Chan, reflect.Func, reflect.UnsafePointer:
		t.Fatalf("snapshotdb.Data carries a %s at %s — plain data only crosses the F5 seam", typ.Kind(), path)
	}
}

func TestSnapshotDataCarriesNoConnections(t *testing.T) {
	walkType(t, reflect.TypeOf(snapshotdb.Data{}), "snapshotdb.Data", map[reflect.Type]bool{})
}
