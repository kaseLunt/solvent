// The ENVIRONMENT surface joins the taint domain (round-13 F1).
//
// Round 11 closed the taint generator over the FLAG surface; round 13 showed
// the law's true domain is "every input that can weaken a required bound",
// and env vars are inputs: SOLVENT_SNAPSHOT_INTERVAL=1000000h made the auto
// freshness bound ~228 years, so snapshots last refreshed years ago
// classified fresh and a pass receipt could launder stale data. This file is
// the flag-surface treatment applied to the env surface:
//
//   - reconEnvSurface is the CLOSED classification table: every env var the
//     reconcile binary consumes — directly (os.Getenv in cmd/reconcile or
//     snapshotdb) or through config.Load — is either capable of tainting
//     (Taint != nil) or justified verdict-free/delegated. TestEnvSurfaceClosed
//     scans the package sources (and internal/config, internal/chain,
//     internal/store) for os.Getenv/os.LookupEnv and FAILS on any variable
//     missing from this table, so the surface cannot silently grow an
//     unexamined input; it also proves the "unconsumed by reconcile" claims
//     structurally (no reference to cfg.PollInterval / cfg.PriceInterval /
//     cfg.HealthAddr in this binary's sources).
//
//   - the SOLVENT_SNAPSHOT_INTERVAL acceptance cap: the interval's canonical
//     value is ONE HOUR — the daemon's default cadence (internal/config
//     defaults SnapshotInterval to time.Hour when the variable is unset; the
//     plan and Task 7 fixed "default 1h"). The cap is that same hour, not a
//     new constant, and the DERIVATION is the daemon's own widening rule:
//     collateralStaleBound(interval, lastPass) widens through the MEASURED
//     pass duration — durable in sweep_generations.last_pass_seconds
//     (migration 00008), written only by the daemon, read by reconcile
//     INSIDE the RR snapshot — never through the configured interval, which
//     is an operator assertion. Reconcile's env copy of that assertion is
//     UNVERIFIABLE here (reconcile cannot observe the daemon's environment,
//     and the schema persists no configured interval), so in acceptance it
//     may contribute at most its canonical default: a tighter-or-equal value
//     can only strengthen the bound (fail-closed, same asymmetry as
//     -max-head-lag), while any LOOSER value is the round-11 loose-positive
//     class and taints. Legitimate wide bounds on big registries still
//     happen — through the durable, daemon-written last_pass channel, which
//     no reconcile-side env var can inflate.
//
// No silent clamp: an over-cap interval still widens the RECORDED bound
// (bound_inputs tells the whole story), but the same value taints the run,
// and computeResult makes any taint structurally non-pass (round-10 F2).
package main

import (
	"fmt"
	"os"
	"time"
)

// canonicalSnapshotInterval is the acceptance cap on the env-asserted sweep
// cadence: the daemon's default (internal/config: SnapshotInterval defaults
// to time.Hour). See the file header for why the cap is the default itself.
const canonicalSnapshotInterval = time.Hour

// snapshotIntervalTaint judges one SOLVENT_SNAPSHOT_INTERVAL value. Empty is
// canonical (the default applies). Unparseable/nonpositive taints as belt —
// config.Load refuses those with exit 2 before any verdict exists (braces).
// Over-cap positive values are the loose-positive class.
func snapshotIntervalTaint(v string) string {
	if v == "" {
		return ""
	}
	d, err := time.ParseDuration(v)
	if err != nil || d <= 0 {
		return fmt.Sprintf("SOLVENT_SNAPSHOT_INTERVAL=%q is not a positive duration (config.Load also refuses it, exit 2) — a bound input that cannot be interpreted cannot back an acceptance receipt", v)
	}
	if d > canonicalSnapshotInterval {
		return fmt.Sprintf("SOLVENT_SNAPSHOT_INTERVAL=%s exceeds the canonical daemon cadence %s: the env copy of the interval is an UNVERIFIABLE operator assertion, and a looser value widens the auto freshness bound (2×interval arm) exactly like a loose -snapshot-max-age — the legitimate widening channel is the durable sweep_generations.last_pass_seconds the daemon itself writes (round-13 F1)", v, canonicalSnapshotInterval)
	}
	return ""
}

// resolveSnapshotInterval is the ONE reader of SOLVENT_SNAPSHOT_INTERVAL in
// this binary: the freshness bound (runPhase1) and the taint generator judge
// the SAME resolution, so the bound and the verdict cannot drift apart. It
// returns the interval to feed freshnessBound plus a provenance string for
// bound_inputs. No clamp: an over-cap value is returned as-is (and taints).
func resolveSnapshotInterval() (time.Duration, string) {
	v := os.Getenv("SOLVENT_SNAPSHOT_INTERVAL")
	if v == "" {
		return canonicalSnapshotInterval, "default (SOLVENT_SNAPSHOT_INTERVAL unset)"
	}
	d, err := time.ParseDuration(v)
	if err != nil || d <= 0 {
		// config.Load refuses these with exit 2 in the real binary before
		// Phase 1 runs; the canonical default keeps this function total.
		return canonicalSnapshotInterval, fmt.Sprintf("SOLVENT_SNAPSHOT_INTERVAL=%q invalid — canonical default used (run is tainted; config.Load refuses it with exit 2)", v)
	}
	return d, "SOLVENT_SNAPSHOT_INTERVAL"
}

// envClass is the classification of one env var in the closed table.
type envClass string

const (
	// envTaints: the value can weaken a required acceptance bound; Taint
	// decides.
	envTaints envClass = "taints"
	// envVerdictFree: read by this binary, structurally unable to reach the
	// verdict (justification required).
	envVerdictFree envClass = "verdict-free"
	// envDelegated: consumed inside config.Load on this binary's behalf —
	// refused loudly or unconsumed by reconcile (justification required).
	envDelegated envClass = "delegated"
)

// envSpec is one row of the closed env-surface table.
type envSpec struct {
	Name  string
	Class envClass
	Why   string
	// Taint judges the CURRENT value; empty string = no taint. Only rows
	// with Class == envTaints carry one.
	Taint func(v string) string
}

// reconEnvSurface is the CLOSED env-surface table (round-13 F1) — the env
// twin of round-11's flag table. TestEnvSurfaceClosed enforces bidirectional
// closure: every os.Getenv in the binary's first-party source closure
// appears here, and every row here corresponds to a real read.
var reconEnvSurface = []envSpec{
	{
		Name:  "SOLVENT_SNAPSHOT_INTERVAL",
		Class: envTaints,
		Why:   "the 2×interval arm of the auto freshness bound; env-asserted cadence is unverifiable from reconcile, so anything looser than the canonical 1h daemon default taints (the durable last_pass_seconds column is the legitimate widening channel)",
		Taint: snapshotIntervalTaint,
	},
	{
		Name:  "SOLVENT_RECON_RPC_OP",
		Class: envVerdictFree,
		Why:   "endpoint provenance, not a bound: recorded in run.rpc_source; every read is chain-id-verified and hash-pinned, failures classify into loud aborts, and a lying endpoint is the standing RPC-class threat model (second opinions, weld re-runs) — no value here can loosen a DB-derived bound or convert a failure into a pass",
	},
	{
		Name:  "SOLVENT_RECON_RPC_ETH",
		Class: envVerdictFree,
		Why:   "same as SOLVENT_RECON_RPC_OP (the archive-capable ETH override)",
	},
	{
		Name:  "TEST_DATABASE_URL",
		Class: envVerdictFree,
		Why:   "consumed ONLY by the §1.2 DSN-split tripwire, which can only ABORT (exit 2, fail-closed on unverifiable): set-and-colliding kills the run, unset skips a check that protects the DESTRUCTIVE TEST SUITE's target, not this run's verdict — reconcile's own session is forced default_transaction_read_only=on regardless",
	},
	{
		Name:  "SOLVENT_DATABASE_URL",
		Class: envDelegated,
		Why:   "SUBJECT-defining, not bound-weakening: it names the database the claim is about; required (config.Load refuses unset), recorded as run.db_name, schema-gated to the exact embedded version, and read through a session forced read-only — a different database is a different claim subject, visible in the receipt, not a weakened check on the same subject",
	},
	{
		Name:  "SOLVENT_RPC_OP",
		Class: envDelegated,
		Why:   "endpoint provenance fallback when SOLVENT_RECON_RPC_OP is unset (recorded as '(fallback)' in run.rpc_source); required by config.Load; same verdict-free argument as the RECON endpoints; the rpcEnv key names come from config/contracts.json, whose path is itself taint-guarded (-config)",
	},
	{
		Name:  "SOLVENT_RPC_ETH",
		Class: envDelegated,
		Why:   "same as SOLVENT_RPC_OP (ETH fallback)",
	},
	{
		Name:  "SOLVENT_POLL_INTERVAL",
		Class: envDelegated,
		Why:   "parsed by config.Load (daemon ingest cadence), UNCONSUMED by reconcile — no reconcile source references cfg.PollInterval (enforced by TestEnvSurfaceClosed); malformed values abort config.Load with exit 2",
	},
	{
		Name:  "SOLVENT_PRICE_INTERVAL",
		Class: envDelegated,
		Why:   "parsed positive-only by config.Load (daemon price-poll cadence), UNCONSUMED by reconcile — no reconcile source references cfg.PriceInterval (enforced by TestEnvSurfaceClosed); malformed/nonpositive aborts with exit 2",
	},
	{
		Name:  "SOLVENT_FEED_STALENESS",
		Class: envDelegated,
		Why:   "RETIRED and refused: config.Load errors (exit 2) when it is set at all — it cannot influence any bound because a run carrying it never reaches Phase 1",
	},
	{
		Name:  "SOLVENT_HEALTH_ADDR",
		Class: envDelegated,
		Why:   "parsed by config.Load (daemon health bind address), UNCONSUMED by reconcile — no reconcile source references cfg.HealthAddr (enforced by TestEnvSurfaceClosed); reconcile serves no health endpoint",
	},
}

// envAcceptanceTaints sweeps the env rows that can taint. Called from
// acceptanceTaints so the flag and env surfaces flow into computeResult as
// ONE taint set (round-10 F2: a taint is a verdict input, not metadata).
func envAcceptanceTaints() []string {
	var taints []string
	for _, spec := range reconEnvSurface {
		if spec.Taint == nil {
			continue
		}
		if msg := spec.Taint(os.Getenv(spec.Name)); msg != "" {
			taints = append(taints, msg)
		}
	}
	return taints
}
