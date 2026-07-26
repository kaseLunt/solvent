// Round-11 F3 / round-13 F2: the F5 seam's RUNTIME half, tested at the
// consumer side. Wave 13's structural half — an AST reachability walk over
// named calls — was retired by round 13: it resolved only DIRECT NAMED
// calls, so package-level function values, aliased imports and interface
// dispatch evaded it. The structural proof now lives with the snapshot
// package itself (cmd/reconcile/snapshotdb: TestSnapshotDBImportsAreDBOnly
// asserts the exact DB-only import allowlist — the compiler is the proof —
// and TestSnapshotDBAPISurfaceRejectsInjection closes the injection
// channel). What remains HERE is the runtime gate as this package consumes
// it:
//
//   - every pinnedReader entry point (headerHash, headerTime, callAtHash,
//     secondOpinion — multicall funnels through callAtHash) refuses,
//     check-FIRST, while snapshotdb.Gate is open
//     (TestSnapshotGateBlocksReadersWhileOpen);
//   - the gate's lifecycle reopens after exit
//     (TestSnapshotGateReopensAfterExit);
//   - and the PRODUCTION wiring — Collect entering/exiting the gate around
//     the real transaction — is proven against a real database in
//     phase1_gate_db_test.go, not by toggling.
package main

import (
	"context"
	"testing"

	"github.com/ethereum/go-ethereum/common"
	"github.com/stretchr/testify/require"

	"github.com/kaselunt/solvent/cmd/reconcile/snapshotdb"
)

// TestSnapshotGateBlocksReadersWhileOpen: with the gate open, EVERY
// pinnedReader entry point refuses with the named seam violation. The reader
// is a zero value on purpose — nil inner client, nil runner, nil limiter —
// so the test also proves the check runs FIRST: any reordering of the gate
// check behind the dial machinery panics on nil here instead of returning
// the violation.
func TestSnapshotGateBlocksReadersWhileOpen(t *testing.T) {
	snapshotdb.Gate.Enter()
	defer snapshotdb.Gate.Exit()

	r := &pinnedReader{name: "op"}
	ctx := context.Background()

	_, _, err := r.headerHash(ctx, 1)
	require.ErrorContains(t, err, "F5 seam violation", "headerHash must refuse while the snapshot is open")

	_, _, err = r.headerTime(ctx, 1)
	require.ErrorContains(t, err, "F5 seam violation", "headerTime must refuse while the snapshot is open")

	_, _, err = r.callAtHash(ctx, "probe", common.Address{}, nil, common.Hash{})
	require.ErrorContains(t, err, "F5 seam violation", "callAtHash (and multicall through it) must refuse while the snapshot is open")

	_, _, err = r.multicall(ctx, "probe", 1, common.Hash{}, []multicallCall{{}})
	require.ErrorContains(t, err, "F5 seam violation", "multicall funnels through callAtHash and must refuse too")

	note, v := r.secondOpinion(ctx, "probe", common.Address{}, nil, common.Hash{}, 0)
	require.Nil(t, v, "a refused second opinion must never carry a value")
	require.Contains(t, note, "F5 seam violation", "secondOpinion has no error path; the violation is the recorded note")
}

// TestSnapshotGateReopensAfterExit pins the gate's lifecycle: Exit reopens
// the RPC surface (Stage B and the phase-2/3 welds run AFTER the snapshot
// committed and closed, and must not inherit a stuck-closed gate).
func TestSnapshotGateReopensAfterExit(t *testing.T) {
	snapshotdb.Gate.Enter()
	snapshotdb.Gate.Exit()
	require.NoError(t, snapshotdb.Gate.Violation("headerHash"), "after exit the gate must be open again")
}
