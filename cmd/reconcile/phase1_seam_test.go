// Round-10 F5 seam, DATA half: snapshotData — the ONLY value that crosses
// the Stage A/Stage B seam — must be plain data. No connection,
// transaction, pool, or chain-reader can leak out of Stage A for later
// code to hold across RPC (Stage A commits AND closes before returning).
// This test enforces that half mechanically: a reflection walk over
// snapshotData's full reachable type graph asserting that no pgx / pgxpool
// type and no chain-reading type is embedded anywhere. A mutant that
// smuggles the transaction or a reader out through a new field dies here.
//
// SCOPE (round-11 F3): this test inspects DATA, not BEHAVIOR. Wave 11
// overclaimed it — together with collectSnapshot's reader-free signature —
// as making network-under-snapshot unrepresentable; round 11 disproved
// that (a package-level helper or environment-dialed client needs no new
// field and no signature change), and the claim is retracted in the
// wave-13 report. The BEHAVIOR halves live in phase1_f5_seam_test.go: the
// snapshotGate runtime sentinel and the AST reachability walk.
package main

import (
	"reflect"
	"strings"
	"testing"
)

// forbiddenTypePathFragments are package-path / type-name fragments that
// must never appear inside snapshotData: database connection machinery and
// chain-reading machinery.
var forbiddenTypePathFragments = []string{
	"jackc/pgx",              // pgx.Conn, pgx.Tx, pgxpool.Pool, ...
	"solvent/internal/chain", // chain.Failover and friends
}

var forbiddenLocalTypes = map[string]bool{
	"pinnedReader": true,
	"chainReader":  true,
	"rpcRunner":    true,
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
				t.Fatalf("snapshotData reaches %s.%s at %s — the F5 seam forbids connection/chain types in the snapshot result", pkg, typ.Name(), path)
			}
		}
		if forbiddenLocalTypes[typ.Name()] && strings.HasSuffix(pkg, "cmd/reconcile") {
			t.Fatalf("snapshotData reaches %s at %s — no RPC surface may cross the Stage A/Stage B seam", typ.Name(), path)
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
		// transaction. snapshotData must not carry interfaces at all,
		// except the empty-interface leaves inside artifact-bound
		// map[string]any documents (deriveLag-style rendered strings).
		if typ.NumMethod() > 0 {
			t.Fatalf("snapshotData carries a non-empty interface at %s — a connection or reader could hide behind it", path)
		}
	case reflect.Chan, reflect.Func, reflect.UnsafePointer:
		t.Fatalf("snapshotData carries a %s at %s — plain data only crosses the F5 seam", typ.Kind(), path)
	}
}

func TestSnapshotDataCarriesNoConnections(t *testing.T) {
	walkType(t, reflect.TypeOf(snapshotData{}), "snapshotData", map[reflect.Type]bool{})
}
