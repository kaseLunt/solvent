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

	"github.com/kaselunt/solvent/internal/store"
)

// canonicalSnapshotInterval is the acceptance cap on the env-asserted sweep
// cadence: the daemon's default (internal/config: SnapshotInterval defaults
// to time.Hour). See the file header for why the cap is the default itself.
const canonicalSnapshotInterval = time.Hour

// snapshotIntervalSyntaxTaint is the PRE-DB (env-table) judge for
// SOLVENT_SNAPSHOT_INTERVAL since round-14 F4: only syntax is judged here —
// unparseable/nonpositive taints as belt (config.Load refuses those with
// exit 2 as braces). The VALUE itself is judged against the daemon's
// PERSISTED cadence inside Phase 1 (sweepCadenceEvaluation): with a
// persisted interval, mismatch taints; without one, the wave-15 1h cap
// (snapshotIntervalTaint below) still applies. A pure-env judge can no
// longer refuse a >1h value outright, because a daemon that DURABLY runs a
// 2h cadence is a healthy deployment the receipt must be able to pass —
// round 14's fail-forever finding.
func snapshotIntervalSyntaxTaint(v string) string {
	if v == "" {
		return ""
	}
	if d, err := time.ParseDuration(v); err != nil || d <= 0 {
		return fmt.Sprintf("SOLVENT_SNAPSHOT_INTERVAL=%q is not a positive duration (config.Load also refuses it, exit 2) — a bound input that cannot be interpreted cannot back an acceptance receipt", v)
	}
	return ""
}

// snapshotIntervalTaint judges one SOLVENT_SNAPSHOT_INTERVAL value under the
// FALLBACK (no persisted daemon cadence — pre-migration-00009 rows) rule:
// wave 15's law, unchanged. Empty is canonical (the default applies).
// Unparseable/nonpositive taints as belt — config.Load refuses those with
// exit 2 before any verdict exists (braces). Over-cap positive values are
// the loose-positive class.
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
	// envLinkedLibrary: read by a LINKED LIBRARY, not by first-party code —
	// round-14 F1's lesson is that the taint domain includes what the
	// libraries read. These rows are enumerated from pgx v5.5.1's ACTUAL
	// source (see pgxEnvSurface) and verified against it by
	// TestEnvSurfaceClosed at every run: a pgx upgrade that grows the env
	// surface fails the closure test until the table is re-closed over it.
	envLinkedLibrary envClass = "linked-library"
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
		Why:   "cadence input to the auto freshness bound, judged in TWO stages since round-14 F4: syntax here (unparseable/nonpositive taints pre-DB), the VALUE inside Phase 1 against the daemon-PERSISTED sweep_generations.configured_interval_seconds (sweepCadenceEvaluation) — env-vs-persisted mismatch taints, and with no persisted interval the wave-15 1h cap still applies; the bound is NEVER widened from the env claim",
		Taint: snapshotIntervalSyntaxTaint,
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

// pgxEnvSurface is the LINKED-LIBRARY env surface (round-14 F1): every
// variable pgx v5.5.1 reads at connect time, enumerated from the module's
// ACTUAL source, not from memory or libpq docs:
//
//   - pgconn/config.go:405-434 `parseEnvSettings` — the nameMap literal at
//     lines 408-425 lists all seventeen names below; the read is
//     `value := os.Getenv(envname)` at line 429, and line 430's
//     `if value != ""` is pgx's own emptiness rule (empty == absent), which
//     the presence judge mirrors exactly so a test can neutralize a variable
//     with t.Setenv(name, "").
//   - pgconn/config.go:245 `mergeSettings(defaultSettings, envSettings,
//     connStringSettings)` — connection-string settings override env, which
//     is WHY a complete DSN (explicit host+database, enforced by
//     readOnlyDSN) cannot be redirected while a partial one can.
//
// Presence taints. These are not bound inputs like SOLVENT_SNAPSHOT_INTERVAL
// — they are SUBJECT inputs: PGHOST/PGPORT/PGDATABASE/PGUSER/PGSERVICE* can
// point the connection somewhere the DSN never named, and the SSL family can
// reshape the transport trust. Reconcile cannot verify from inside the run
// that any of them was harmless, and an acceptance environment has no
// legitimate reason to carry them (the DSNs are complete by construction) —
// so present-and-nonempty is fail-closed tainted, the same blanket treatment
// as -accounts. The artifact still records the CONNECTED identity from the
// server itself, so even a tainted run's receipt says where it really
// landed.
var pgxEnvSurface = []string{
	"PGHOST", "PGPORT", "PGDATABASE", "PGUSER", "PGPASSWORD", "PGPASSFILE",
	"PGAPPNAME", "PGCONNECT_TIMEOUT", "PGSSLMODE", "PGSSLKEY", "PGSSLCERT",
	"PGSSLSNI", "PGSSLROOTCERT", "PGSSLPASSWORD", "PGTARGETSESSIONATTRS",
	"PGSERVICE", "PGSERVICEFILE",
}

// pgxPresenceTaint builds the presence judge for one pgx-read variable,
// mirroring pgx's own emptiness rule (pgconn/config.go:429-431: empty string
// == absent).
func pgxPresenceTaint(name string) func(string) string {
	return func(v string) string {
		if v == "" {
			return ""
		}
		return fmt.Sprintf("%s is set: pgx v5.5.1 reads it at connect time (pgconn/config.go parseEnvSettings, nameMap lines 408-425, read at line 429) and merges it UNDER the connection string — an ambient value can redirect or reshape the database connection behind the DSN's back, and reconcile cannot prove from inside the run that it did not (round-14 F1); acceptance environments carry no PG* variables", name)
	}
}

func init() {
	// The linked-library rows join the ONE closed table so
	// envAcceptanceTaints sweeps them through the same generator as every
	// first-party row (a separate sweep would be separately unwirable).
	// Built from pgxEnvSurface so the test comparing the table against pgx's
	// source and the taint generator can never disagree about the name list.
	for _, name := range pgxEnvSurface {
		reconEnvSurface = append(reconEnvSurface, envSpec{
			Name:  name,
			Class: envLinkedLibrary,
			Why:   "pgx v5.5.1 connect-time input (pgconn/config.go:408-429); presence taints — see pgxEnvSurface",
			Taint: pgxPresenceTaint(name),
		})
	}
	// APPDATA is pgx's ONE other env read (pgconn/defaults_windows.go:20,
	// Windows builds only): it locates the DEFAULT passfile
	// (%APPDATA%/postgresql/pgpass.conf). Classified, deliberately
	// NON-tainting: it cannot alter host/port/database/user — only supply a
	// password, and a wrong password aborts loudly rather than flipping any
	// verdict — and it is unconditionally set on every Windows session, so a
	// presence taint would refuse every Windows run while proving nothing.
	reconEnvSurface = append(reconEnvSurface, envSpec{
		Name:  "APPDATA",
		Class: envLinkedLibrary,
		Why:   "pgx v5.5.1 default-passfile location on Windows (pgconn/defaults_windows.go:20); subject-inert (cannot redirect host/port/database/user; bad credentials abort loudly), unconditionally set on Windows — presence-taint would be vacuous noise, so this row is classified but verdict-free",
	})
}

// sweepCadenceEvaluation is the ONE evaluator of the freshness bound's
// cadence inputs (round-14 F4) — bound and taints come out of the same
// judgment so they cannot drift:
//
//   - PERSISTED interval present (sweep_generations.configured_interval_
//     seconds, written by the daemon itself every round, read INSIDE this
//     run's RR snapshot): the bound is the daemon's REAL freshness rule,
//     2×(interval+lastPass) — the additive form collateralStaleBound
//     (cmd/indexer) actually enforces, which wave 15's max(2×interval,
//     2×lastPass) could not reproduce and therefore permanently failed a
//     supported 2h cadence. The daemon's noProgressBound floor is OMITTED:
//     omitting a floor only ever TIGHTENS the bound (errs red, never green).
//     The env var is demoted to a cross-check: set-and-different-from-
//     persisted taints (both directions — a mismatch means some environment
//     is lying about the deployment), and the env value NEVER feeds the
//     bound.
//   - PERSISTED interval absent (rows predating migration 00009, or a
//     daemon that has not yet written it): fall back to wave 15's law
//     unchanged — max(2×env-or-1h-default, 2×lastPass) with the 1h cap
//     tainting any looser env claim. Fail-closed (a 2h deployment stays
//     tainted until its daemon persists the cadence — one restart, not
//     forever), never silently widened.
func sweepCadenceEvaluation(sweep store.SweepGenerationState) (bound time.Duration, inputs map[string]string, taints []string) {
	envRaw := os.Getenv("SOLVENT_SNAPSHOT_INTERVAL")
	persisted := sweep.ConfiguredIntervalSeconds

	if persisted != nil && *persisted > 0 {
		interval := time.Duration(*persisted) * time.Second
		lastPass := time.Duration(0)
		lastPassStr := "(null)"
		if sweep.LastPassSeconds != nil {
			lastPass = time.Duration(*sweep.LastPassSeconds) * time.Second
			lastPassStr = fmt.Sprintf("%d", *sweep.LastPassSeconds)
		}
		bound = 2 * (interval + lastPass)
		inputs = map[string]string{
			"snapshot_interval":        interval.String(),
			"snapshot_interval_source": "sweep_generations.configured_interval_seconds (daemon-written, read in-snapshot)",
			"last_pass_seconds":        lastPassStr,
			"formula":                  "2*(interval+last_pass) — the daemon's collateralStaleBound rule, floor omitted (tighter)",
			"resolved_bound":           bound.String(),
			"label":                    "policy",
		}
		if envRaw != "" {
			if d, err := time.ParseDuration(envRaw); err != nil || d <= 0 {
				taints = append(taints, snapshotIntervalSyntaxTaint(envRaw))
			} else if d != interval {
				taints = append(taints, fmt.Sprintf(
					"SOLVENT_SNAPSHOT_INTERVAL=%s contradicts the daemon-persisted cadence %s (sweep_generations.configured_interval_seconds): the persisted value is what the audited daemon durably wrote, so a differing env claim — wider OR tighter — means some environment is lying about the deployment; the bound was computed from the PERSISTED value and is never widened by an env claim (round-14 F4)",
					envRaw, interval))
			}
		}
		return bound, inputs, taints
	}

	// Fallback: wave 15's rule, verbatim mechanics.
	interval, source := resolveSnapshotInterval()
	bound, inputs = freshnessBound(interval, sweep.LastPassSeconds)
	inputs["snapshot_interval_source"] = source
	if persisted != nil {
		// A nonpositive persisted value is nonsense no daemon writes
		// (config.Load validates the interval positive): fail closed.
		taints = append(taints, fmt.Sprintf(
			"sweep_generations.configured_interval_seconds=%d is not a positive cadence — a corrupt persisted bound input cannot back an acceptance receipt (round-14 F4)", *persisted))
	}
	inputs["fallback"] = "no daemon-persisted cadence (row predates migration 00009 or the daemon has not yet written it): wave-15 1h-default law applies"
	if msg := snapshotIntervalTaint(envRaw); msg != "" {
		taints = append(taints, msg)
	}
	return bound, inputs, taints
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
