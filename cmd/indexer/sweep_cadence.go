// Sweep-cadence persistence: the startup instance binding (mandatory and fatal)
// plus the per-round retry that keeps the configured interval stamped on the
// current sweep generation's durable row.
package main

import (
	"context"
	"fmt"
	"log/slog"
	"time"
)

// sweepIntervalWriter is the narrow store surface persistSweepInterval needs
// (*store.Store satisfies it; tests pass a fake).
type sweepIntervalWriter interface {
	RecordSweepConfiguredInterval(ctx context.Context, engine string, interval time.Duration) (bool, error)
}

// persistSweepInterval writes the CONFIGURED sweep cadence onto the engine's
// durable sweep_generations row, stamped with the row's current generation
// (round-14 F4 migration 00009; round-16 M4 migration 00010). Since round-19
// H1 this is the PER-ROUND RETRY HALF of the cadence contract — it runs
// beside the snapshot pass every round: the write is a single-row UPDATE
// guarded by IS DISTINCT FROM on BOTH the seconds and the generation stamp,
// so it is a no-op row-match whenever the current generation is already
// stamped and re-fires within one round of any generation bump. (The
// PRE-LOOP half is requireStartupSweepCadence, MANDATORY AND FATAL — see
// there for why instance binding lives at startup.)
//
// A PER-ROUND failure is TOLERATED — never allowed to gate sweeps: startup
// already guaranteed the readable value belongs to THIS instance (round-19
// H1), so the only window a failure here can leave open is after a
// generation bump, where migration 00010's mask makes the cadence UNREADABLE
// and reconcile fails CLOSED on its absence (the round-16 M4 taint — an
// unlanded write can only make reconcile stricter, never looser; the next
// round retries by construction). But it is NO LONGER SILENT (round-16 M4):
// a failure joins the round's health composition under its own condition
// key, so a persistently-failing cadence write is visible on the health
// surface for exactly as many rounds as it keeps failing (see
// conditionCadenceUnpersisted for why the health surface, not the sweep
// evidence, is the honest channel). rc is the LIVE round composition,
// always: the pre-loop call this function used to serve with a nil rc moved
// to requireStartupSweepCadence, which returns its failure instead of
// surfacing it — so the nil tolerance is gone with its caller.
func persistSweepInterval(ctx context.Context, w sweepIntervalWriter, engine string, interval time.Duration, rc roundConditions) {
	if _, err := w.RecordSweepConfiguredInterval(ctx, engine, interval); err != nil {
		slog.Warn("could not persist the configured sweep cadence; reconcile TAINTS acceptance runs until a later round lands it (round-16 M4, fail-closed)",
			"engine", engine, "interval", interval, "err", err)
		rc.set(snapshotName, conditionCadenceUnpersisted,
			fmt.Sprintf("configured sweep cadence (%s) could not be stamped onto the current generation: %v — reconcile taints acceptance runs until this write lands; retrying next round", interval, err))
	}
}

// requireStartupSweepCadence is the round-19 H1 INSTANCE BINDING: the
// pre-loop cadence overwrite is MANDATORY AND FATAL — a daemon that cannot
// stamp its OWN configured cadence onto the engine's durable sweep row
// REFUSES TO RUN. This is mechanism (b) of the round-19 brief, chosen over
// mechanism (a) (a durable daemon-start epoch joining the stamp) because
// the epoch write would itself have to be fatal-on-failure to bind the
// instance — a failed epoch write leaves the PREVIOUS instance's epoch
// current, and with it the previous cadence, recreating the exact gap — so
// (a) reduces to (b) plus a migration and a second column that can drift.
//
// WHY FATALITY AT STARTUP CLOSES THE ROUND-19 SCENARIO. Restart does not
// roll current_generation, so a previous instance's stamp (generation ==
// current) survives into the new process looking daemon-verified; Codex's
// scenario was a 2h stamp, a restarted 30m daemon whose startup and
// per-round writes all fail, and reconcile still receiving 2h as verified
// (permitting 260m where the running daemon permits 80m). With the startup
// write fatal, the readable cadence provably belongs to the LAST
// SUCCESSFULLY STARTED instance at every instant:
//
//   - this daemon RUNS → its startup UPDATE landed (or matched nothing
//     because the row already carried ITS OWN values) → the readable value
//     is its configured interval, immutable for the process lifetime
//     (config.Load runs once, before the loop);
//   - this daemon CANNOT WRITE → it never enters the loop → no running
//     instance exists whose rule could diverge from the stamp; the stamp
//     still names the configuration of the last instance that actually ran
//     and produced the sweep evidence being judged.
//
// MID-RUN GENERATION ROLLOVER WITH A FAILED ROW-WRITE STILL FAILS CLOSED:
// the bump retires the stamp (configured_interval_generation keeps naming
// the old generation) and migration 00010's CASE mask makes the cadence
// UNREADABLE for the new generation until the per-round retry lands —
// reconcile taints on the NULL (round-16 M4), never reads the stale value.
// Demonstrated by TestSweepCadenceUnreadableFromPriorGeneration and
// TestCadenceBindsToRunningInstanceNotGeneration (internal/store) plus
// TestUnverifiedCadenceTaintsAcceptance (cmd/reconcile).
//
// ERROR IS THE ONLY FATAL MODE. A (false, nil) return — zero rows matched —
// is a healthy start in both of its cases: (1) no sweep_generations row
// exists yet (OpenSweepGeneration owns row creation, and with no row there
// is no readable cadence for reconcile to mis-trust — absence taints, fail
// closed), or (2) the row already carries exactly this instance's interval
// stamped on the current generation (the IS DISTINCT FROM guard matched
// nothing to change). Both post-states satisfy the binding invariant: any
// READABLE cadence equals THIS instance's configured interval.
//
// No new availability dependency: the daemon cannot run without the
// database this one-row UPDATE goes to.
func requireStartupSweepCadence(ctx context.Context, w sweepIntervalWriter, engine string, interval time.Duration) error {
	if _, err := w.RecordSweepConfiguredInterval(ctx, engine, interval); err != nil {
		return fmt.Errorf("refusing to start: the configured sweep cadence (%s) could not be stamped onto engine %q's durable sweep row: %w — restart does not roll current_generation, so a PRIOR instance's stamp would remain readable as daemon-verified while this instance enforces a different rule (round-19 H1); the daemon does not run until the readable cadence belongs to the running instance", interval, engine, err)
	}
	return nil
}
