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
//   - the cadence law (round-14 F4, corrected by round-16 M4): the freshness
//     bound is evaluated from the cadence the DAEMON durably stamped onto
//     the CURRENT sweep generation (sweep_generations.configured_interval_
//     seconds, generation-bound by migration 00010 — a prior generation's
//     value is unreadable by construction), with the daemon's real additive
//     rule 2×(interval+lastPass). SOLVENT_SNAPSHOT_INTERVAL NEVER feeds a
//     bound: with a persisted cadence it is a cross-check whose mismatch
//     taints in both directions; without one there is nothing to check it
//     against and the run taints ANYWAY, because an acceptance verdict never
//     rests on an unverified cadence. The wave-15 fallback
//     (max(2×env-or-1h-default, 2×lastPass)) DIED in round 16: it could be
//     WIDER than the daemon's real bound (30m daemon, 10m pass → real 80m
//     vs fallback 2h), and a fallback that can widen is a bypass, not a
//     fallback. See sweepCadenceEvaluation.
//
// No silent clamp anywhere: whatever bound is recorded, bound_inputs tells
// the whole story (including when it is ADVISORY under a taint), and
// computeResult makes any taint structurally non-pass (round-10 F2).
package main

import (
	"fmt"
	"os"
	"strings"
	"time"

	"github.com/kaselunt/solvent/internal/store"
)

// canonicalSnapshotInterval is the daemon's DEFAULT sweep cadence
// (internal/config: SnapshotInterval defaults to time.Hour). Since round-16
// M4 it feeds exactly one thing: the ADVISORY bound recorded when no
// daemon-verified cadence exists for the current sweep generation — a run
// that is tainted regardless, so this constant can no longer widen or
// narrow any verdict.
const canonicalSnapshotInterval = time.Hour

// snapshotIntervalSyntaxTaint is the PRE-DB (env-table) judge for
// SOLVENT_SNAPSHOT_INTERVAL: only syntax is judged here — unparseable or
// nonpositive taints as belt (config.Load refuses those with exit 2 as
// braces). The VALUE is judged inside Phase 1 (sweepCadenceEvaluation)
// against the cadence the daemon stamped onto the CURRENT sweep generation:
// mismatch taints in both directions, and with no generation-bound cadence
// the run taints unconditionally (round-16 M4). The env value never feeds a
// bound on any path.
func snapshotIntervalSyntaxTaint(v string) string {
	if v == "" {
		return ""
	}
	if d, err := time.ParseDuration(v); err != nil || d <= 0 {
		return fmt.Sprintf("SOLVENT_SNAPSHOT_INTERVAL=%q is not a positive duration (config.Load also refuses it, exit 2) — a bound input that cannot be interpreted cannot back an acceptance receipt", v)
	}
	return ""
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
		Why:   "cadence CROSS-CHECK, never a bound input (round-14 F4, round-16 M4): syntax judged here (unparseable/nonpositive taints pre-DB); the VALUE judged inside Phase 1 against the cadence the daemon stamped onto the CURRENT sweep generation (sweepCadenceEvaluation) — mismatch taints in both directions, and with no generation-bound cadence the run taints unconditionally (an acceptance verdict never rests on an unverified cadence); no bound is ever computed from this variable",
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
	// Windows builds only). Wave 16 classified it verdict-free as "it only
	// locates the default passfile"; round-16 M2 corrected that: the SAME
	// APPDATA-derived directory also supplies the DEFAULT client certificate,
	// private key, AND root CA (defaults_windows.go:32-39 set sslcert/sslkey,
	// :41-44 set sslrootcert, each whenever the file exists), and pgx loads
	// that root CA into TLS verification (config.go:685-699) — so on Windows
	// a redirected APPDATA can plant the trust root that authorizes an
	// impersonating server. That is verdict-bearing whenever the trust
	// material can actually reach the connection, which is a property of the
	// (APPDATA, DSN) PAIR — a value-only Taint func cannot judge it, so the
	// judge is the DSN-aware appdataTrustTaint below, wired in execute right
	// after the DSN is accepted. This row stays Taint-nil so the value-only
	// sweep does not double-judge; a blanket presence taint here would refuse
	// every Windows run (APPDATA is unconditionally set) while proving
	// nothing about runs whose DSN pins its trust material.
	//
	// The non-Windows sibling (pgconn/defaults.go, //go:build !windows) was
	// swept for the same class of input: it reads NO environment variable —
	// its default trust-material paths derive from user.Current().HomeDir
	// (defaults.go:21-38), an os/user lookup outside the linked module's env
	// surface. The module-wide closure test (env_test.go pgxModuleEnvReads)
	// keeps both facts enforced: APPDATA and the 17 PG* names are the ONLY
	// env reads in pgx v5.5.1's non-test sources.
	reconEnvSurface = append(reconEnvSurface, envSpec{
		Name:  "APPDATA",
		Class: envLinkedLibrary,
		Why:   "pgx v5.5.1 Windows platform defaults (pgconn/defaults_windows.go:20): locates the default passfile AND the default TLS client cert/key/root CA (:30-44). Verdict-bearing whenever it can select trust material for the connection (round-16 M2) — judged DSN-aware by appdataTrustTaint (this table's value-only sweep cannot see the DSN), which taints unless the connection string itself pins sslrootcert+sslcert+sslkey or pins sslmode=disable (config.go:629-631 — TLS never negotiated). Presence with a trust-pinned DSN stays verdict-free: APPDATA is unconditionally set on Windows, and with every trust input pinned by the DSN, mergeSettings (config.go:245) makes the APPDATA-derived defaults unreachable",
	})
}

// appdataTrustTaint is the DSN-aware judge for the APPDATA row (round-16
// M2): APPDATA taints exactly when it can select TLS trust material for THIS
// connection. The predicate, justified against pgx v5.5.1's own loading
// logic (see also trustMaterialPinned in pgxdsn.go, which implements the
// DSN half):
//
//   - APPDATA absent-or-empty (pgx's own emptiness convention for env,
//     config.go:429-431; and filepath.Join("", ...) still yields paths, but
//     a cleared APPDATA is the test-neutralization channel exactly like the
//     PG* rows): nothing to judge, no taint. On non-Windows this is the
//     normal state and the platform-defaults file reads no env at all
//     (pgconn/defaults.go — home-dir derived, no os.Getenv).
//   - DSN pins sslmode=disable in its CONNECTION STRING: configTLS returns
//     a nil TLS config immediately (config.go:629-631) — no trust material
//     is ever consulted, APPDATA cannot matter.
//   - DSN pins sslrootcert AND sslcert AND sslkey in its connection string:
//     mergeSettings (config.go:245) makes connection-string settings beat
//     the APPDATA-derived defaults for every trust-material input configTLS
//     consumes — the root CA loaded into RootCAs/ClientCAs (:685-699, used
//     by verify-ca's VerifyPeerCertificate closure :645-678 and
//     verify-full's standard verification :679-680, and silently UPGRADING
//     sslmode=require to verify-ca semantics :638-643) and the client
//     cert/key pair presented under every TLS mode (:702-754).
//   - anything else: an APPDATA-planted root.crt or client pair can reach
//     the connection's trust decisions → taint. FAIL CLOSED: an unpinned
//     verify-full DSN taints even though the impersonation also needs the
//     file to exist — reconcile cannot prove from inside the run that it
//     did not.
func appdataTrustTaint(dsn string) string {
	if os.Getenv("APPDATA") == "" {
		return ""
	}
	if trustMaterialPinned(dsn) {
		return ""
	}
	return fmt.Sprintf("APPDATA is set and the DSN does not pin the connection's TLS trust material: pgx v5.5.1's Windows defaults derive the client certificate, private key AND root CA from %%APPDATA%%\\postgresql (pgconn/defaults_windows.go:30-44), and an ambient root CA is loaded into TLS verification (pgconn/config.go:685-699) — a redirected APPDATA can authorize an impersonating database that self-reports the expected identity (round-16 M2); pin sslrootcert+sslcert+sslkey in the DSN, or sslmode=disable, or clear APPDATA (dsn shape: %s)", redactDSNForTaint(dsn))
}

// redactDSNForTaint reduces a DSN to its scheme for taint messages: taints
// land in artifacts, and a DSN can carry credentials.
func redactDSNForTaint(dsn string) string {
	if i := strings.Index(dsn, "://"); i > 0 {
		return dsn[:i] + "://(redacted)"
	}
	return "(redacted)"
}

// sweepCadenceEvaluation is the ONE evaluator of the freshness bound's
// cadence inputs (round-14 F4, corrected by round-16 M4) — bound and taints
// come out of the same judgment so they cannot drift:
//
//   - GENERATION-BOUND cadence present (sweep_generations.configured_
//     interval_seconds, stamped by the daemon onto the CURRENT sweep
//     generation every round — migration 00010 makes a prior generation's
//     value unreadable by construction, see store.SweepGenerationRow — and
//     read INSIDE this run's RR snapshot): the bound is the daemon's REAL
//     freshness rule, 2×(interval+lastPass) — the additive form
//     collateralStaleBound (cmd/indexer) actually enforces. The daemon's
//     noProgressBound floor is OMITTED: omitting a floor only ever TIGHTENS
//     the bound (errs red, never green). The env var is a cross-check:
//     set-and-different taints (both directions — a mismatch means some
//     environment is lying about the deployment), and the env value NEVER
//     feeds the bound.
//   - NO generation-bound cadence (NULL, a pre-migration row, a value a
//     prior generation stamped, or no row at all): TAINT, unconditionally.
//     An acceptance verdict never rests on an unverified cadence. The
//     wave-15/16 fallback bound max(2×env-or-1h-default, 2×lastPass) DIED
//     here in round 16: a 30m daemon with a 10m pass enforces an 80m bound
//     while the fallback granted 2h — a fallback that can WIDEN past the
//     daemon's real rule is a bypass, not a fallback. NOT fail-forever (the
//     round-14 distinction, preserved): the daemon stamps its cadence onto
//     the current generation every round, so one daemon round after a
//     restart or a generation open the value exists and the taint clears
//     itself. The bound returned on this arm is ADVISORY ONLY — the
//     daemon's rule shape with the canonical default standing in for the
//     unverified interval, so the artifact's freshness section stays
//     readable — labeled as such in bound_inputs; the unconditional taint
//     means no width of it can back a pass (computeResult, round-10 F2).
func sweepCadenceEvaluation(sweep store.SweepGenerationState) (bound time.Duration, inputs map[string]string, taints []string) {
	envRaw := os.Getenv("SOLVENT_SNAPSHOT_INTERVAL")
	persisted := sweep.ConfiguredIntervalSeconds

	lastPass := time.Duration(0)
	lastPassStr := "(null)"
	if sweep.LastPassSeconds != nil {
		lastPass = time.Duration(*sweep.LastPassSeconds) * time.Second
		lastPassStr = fmt.Sprintf("%d", *sweep.LastPassSeconds)
	}

	if persisted != nil && *persisted > 0 {
		interval := time.Duration(*persisted) * time.Second
		bound = 2 * (interval + lastPass)
		inputs = map[string]string{
			"snapshot_interval":        interval.String(),
			"snapshot_interval_source": "sweep_generations.configured_interval_seconds (daemon-written, generation-bound, read in-snapshot)",
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
					"SOLVENT_SNAPSHOT_INTERVAL=%s contradicts the daemon-persisted cadence %s (sweep_generations.configured_interval_seconds, current generation): the persisted value is what the audited daemon durably wrote, so a differing env claim — wider OR tighter — means some environment is lying about the deployment; the bound was computed from the PERSISTED value and is never widened by an env claim (round-14 F4)",
					envRaw, interval))
			}
		}
		return bound, inputs, taints
	}

	// Round-16 M4: no daemon-verified cadence for the CURRENT generation.
	// The recorded bound is the daemon's rule SHAPE with the canonical
	// default standing in — ADVISORY, for artifact readability only; the
	// unconditional taint below is what carries the verdict, and the env
	// variable feeds nothing on this arm either.
	bound = 2 * (canonicalSnapshotInterval + lastPass)
	inputs = map[string]string{
		"snapshot_interval":        canonicalSnapshotInterval.String(),
		"snapshot_interval_source": "canonical default (ADVISORY — no daemon-verified cadence for the current sweep generation; SOLVENT_SNAPSHOT_INTERVAL never feeds a bound)",
		"last_pass_seconds":        lastPassStr,
		"formula":                  "2*(default+last_pass) — the daemon's rule shape with an UNVERIFIED interval input",
		"resolved_bound":           bound.String(),
		"label":                    "advisory (tainted: unverified cadence — round-16 M4)",
		"advisory":                 "no cadence is stamped on the current sweep generation (NULL, pre-migration row, or a prior generation's value — unreadable by construction since migration 00010); the run is tainted and this bound cannot back a pass",
	}
	if persisted != nil {
		// A nonpositive persisted value is nonsense no daemon writes
		// (RecordSweepConfiguredInterval refuses it; config.Load validates
		// the interval positive): its own taint, on top of the
		// unverified-cadence taint below.
		taints = append(taints, fmt.Sprintf(
			"sweep_generations.configured_interval_seconds=%d is not a positive cadence — a corrupt persisted bound input cannot back an acceptance receipt (round-14 F4)", *persisted))
	}
	taints = append(taints, fmt.Sprintf(
		"no daemon-verified sweep cadence for the CURRENT sweep generation (generation %d): sweep_generations.configured_interval_seconds is unset for this generation — an acceptance verdict never rests on an unverified cadence, and the wave-15 default-derived fallback bound died in round 16 because it could be WIDER than the daemon's real rule; the recorded bound is ADVISORY only. NOT fail-forever: the daemon stamps its cadence onto the current generation every round, so one daemon round after a restart or generation open this taint clears itself (round-16 M4)",
		sweep.CurrentGeneration))
	if msg := snapshotIntervalSyntaxTaint(envRaw); msg != "" {
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
