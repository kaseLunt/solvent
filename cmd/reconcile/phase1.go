// Phase 1 — the REPEATABLE READ READ ONLY snapshot (brief §0), restructured
// by round-10 F5 into two STRICTLY ordered stages, and by round-13 F2 into
// two PACKAGES:
//
//	Stage A (snapshotdb.Collect): ONE connection, ONE RR RO transaction,
//	EVERY DB read of the run — then COMMIT AND CLOSE. Round 11 (finding 3)
//	disproved wave 11's claim that a reader-free signature made
//	network-under-snapshot UNREPRESENTABLE; round 13 (finding 2) showed
//	wave 13's AST reachability walk was still evadable by indirection
//	(package-level function values, aliased imports, interface dispatch).
//	Stage A therefore now lives in cmd/reconcile/snapshotdb — an
//	import-restricted DB-only package where the COMPILER is the proof: no
//	chain or network surface is linkable from the code that holds the open
//	transaction (TestSnapshotDBImportsAreDBOnly), no capability can be
//	injected through its API (TestSnapshotDBAPISurfaceRejectsInjection),
//	and snapshotdb.Gate makes every pinnedReader entry point in THIS
//	package fail at run time while the transaction is open — with the
//	production wiring proven against a real database by
//	TestProductionGateActiveThroughSnapshotLifecycle. A slow or
//	retry-storming endpoint can NEVER hold the live database's xmin
//	(vacuum-friendliness while the daemon writes).
//
//	Stage B (runPhase1 tail, this file): pin header hash/time RPC against
//	the FIXED pins the snapshot chose, seed resolution (default = OP pin
//	hash), the md5(seed||account) population ordering IN GO, quota
//	selection, and filtering of the snapshot's population-wide reads down
//	to the sample. Rewind/fork protection around the fixed pin is
//	unchanged: the weld DB side was read in the snapshot, the welds
//	compare it with live headers right after Phase 1 and again in Phase 3
//	on a fresh connection.
//
// The whole run's DB side remains a single atomic database state; the seed
// default (hex of the OP pin's block hash) keeps argumentless runs
// reproducible exactly as before — the ordering just runs after commit.
package main

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"os"
	"sort"
	"strings"
	"time"

	"github.com/ethereum/go-ethereum/common"

	"github.com/kaselunt/solvent/cmd/reconcile/snapshotdb"
	"github.com/kaselunt/solvent/internal/config"
	"github.com/kaselunt/solvent/internal/store"
)

// phase1Data is the full Phase-1 result: the committed snapshot plus the
// Stage-B (post-commit) facts — pin headers, seed, selection, and the
// sample-filtered views of the snapshot's population-wide reads.
type phase1Data struct {
	snapshotdb.Data

	pinHashes map[string]common.Hash // chain → pin hash
	pinTimes  map[string]uint64      // chain → pin header time
	seed      string
	deriveLag map[string]any

	sel        sampleSelection
	dmAsOf     []store.AsOfSum          // sampled accounts @ P_op
	internalDM []store.InternalMismatch // sampled accounts

	sourceConflicts []string
	replays         []replayTarget

	freshBound       time.Duration
	freshBoundInputs map[string]string
	// cadenceTaints are the round-14 F4 DB-aware taints: env-vs-persisted
	// cadence mismatch, or a looser-than-default env claim with no persisted
	// daemon interval to verify it against. Appended to the run's ONE taint
	// set by execute after Phase 1 (they need the snapshot's SweepGen row).
	cadenceTaints []string
}

type replayTarget struct {
	AccountHex string
	Block      uint64
	Doc        map[string]string
}

// runPhase1 = Stage A (snapshotdb.Collect, all DB, no chain — structurally)
// + Stage B (all chain, no DB): pin headers, seed, Go-side seed ordering,
// selection, and the sample-filtered views.
func runPhase1(ctx context.Context, o *options, cfg *config.Config, roDSN string, vec goldenVectors, wantDM, wantAave bool, opReader, ethReader *pinnedReader, reg *registryView) (*phase1Data, error) {
	// -include / -accounts parsing first: pure flag/file facts (no DB, no
	// RPC) whose accounts must join the snapshot's candidate read set.
	var includes []string
	var fileAccounts []string
	var extras [][]byte
	if wantDM {
		if o.include != "" {
			for _, raw := range strings.Split(o.include, ",") {
				h, err := normalizeAccountHex(raw)
				if err != nil {
					return nil, abort(exitUsage, "aborted: usage", "-include: %v", err)
				}
				includes = append(includes, h)
			}
		}
		if o.accountsFile != "" {
			var err error
			fileAccounts, err = readAccountsFile(o.accountsFile)
			if err != nil {
				return nil, err
			}
		}
		seen := map[string]bool{}
		for _, h := range append(append(append([]string{}, forcedDMAnchors...), includes...), fileAccounts...) {
			if seen[h] {
				continue
			}
			seen[h] = true
			b, err := hex.DecodeString(h)
			if err != nil {
				return nil, fmt.Errorf("forced/include account %q: %w", h, err)
			}
			extras = append(extras, b)
		}
	}

	// ---- Stage A: every DB read, then commit + close ----------------------
	spec := snapshotdb.GoldenSpec{W1Pin: vec.W1PinETH, FixturePin: vec.FixturePinETH}
	for _, b := range vec.Borrowers {
		spec.Borrowers = append(spec.Borrowers, common.HexToAddress(b.Address))
	}
	// Config-sha provenance is computed HERE, outside snapshotdb, so the
	// snapshot package needs no `os` import at all (round-14 F3: an import
	// allowlist is a capability boundary only if every entry's full
	// capability set is acceptable — `os` for one file read granted
	// StartProcess too). Read-failure semantics unchanged: empty hash.
	var configSHA string
	if raw, err := os.ReadFile(o.configPath); err == nil {
		sum := sha256.Sum256(raw)
		configSHA = hex.EncodeToString(sum[:])
	}
	prm := snapshotdb.Params{
		ConfigSHA:        configSHA,
		PinOP:            o.pinOP,
		PinETH:           o.pinETH,
		CollateralReplay: o.collateralReplay,
	}
	// P3 Task 6: the gate set's DERIVED side must be read in THIS transaction
	// (snapshotdb/task6db.go explains why it cannot be read later). Everything
	// handed in is a plain value: the never-seen subjects and the frozen frame's
	// keys are COMMITTED inputs, and the feed registry arrives already parsed
	// because the snapshot package may not read files.
	if o.p3Gates && reg != nil {
		prm.Task6 = true
		prm.NeverSeenProbe = neverSeenBytes()
		prm.BacktestKeys = backtestFrameKeys()
		prm.AdapterRowsPerReserve = adapterRowsPerReserve
		prm.Feeds = reg.FeedRegistry
		// The walked Aave addresses: the Pool plus its aTokens. They bound the
		// INDEPENDENT candidate universe the census weld needs (Codex round 1,
		// finding 3), so it is read over exactly the custodied surface.
		for _, st := range cfg.Streams {
			if st.Engine == aaveEngine {
				for _, a := range st.Addresses {
					prm.AaveAddresses = append(prm.AaveAddresses, a.Bytes())
				}
			}
		}
	}
	snap, err := snapshotdb.Collect(ctx, prm, cfg, roDSN, spec, wantDM, wantAave, extras)
	if err != nil {
		if errors.Is(err, store.ErrUnackedReorgEpoch) {
			// Exit finding H1: an unacknowledged reorg epoch at snapshot time
			// is a STALE-EVIDENCE precondition — retryable (exit 3), never a
			// silent pass, never a permanent fail: the daemon's next Step
			// acks the epoch (RewindDerived) and re-derives.
			return nil, abort(exitRetryable, "aborted: unacked reorg epoch", "%v", err)
		}
		return nil, err
	}
	p := &phase1Data{Data: *snap}

	// ---- Stage B: RPC against the FIXED pins the snapshot chose -----------
	p.pinHashes = map[string]common.Hash{}
	p.pinTimes = map[string]uint64{}
	readers := map[string]*pinnedReader{}
	if opReader != nil {
		readers["op"] = opReader
	}
	if ethReader != nil {
		readers["eth"] = ethReader
	}
	for engine, pin := range p.Pins {
		chainName := p.ChainFor[engine]
		r := readers[chainName]
		if r == nil {
			continue
		}
		h, _, err := r.headerHash(ctx, pin)
		if err != nil {
			return nil, fmt.Errorf("pin hash for %s @ %d: %w", chainName, pin, err)
		}
		t, _, err := r.headerTime(ctx, pin)
		if err != nil {
			return nil, fmt.Errorf("pin header time for %s @ %d: %w", chainName, pin, err)
		}
		p.pinHashes[chainName] = h
		p.pinTimes[chainName] = t
	}
	p.deriveLag = map[string]any{}
	for chainName, t := range p.pinTimes {
		p.deriveLag[chainName] = time.Since(time.Unix(int64(t), 0)).Round(time.Second).String()
	}

	// Seed (§2): default hex of the OP pin's block hash (falls back to the
	// ETH pin hash on an aave-only run); overridable; ALWAYS echoed.
	p.seed = o.seed
	if p.seed == "" {
		if h, ok := p.pinHashes["op"]; ok {
			p.seed = h.Hex()
		} else if h, ok := p.pinHashes["eth"]; ok {
			p.seed = h.Hex()
		} else {
			return nil, abort(exitPrecondition, "aborted: precondition", "no pin hash available to derive the default seed")
		}
	}

	// ---- selection (Go-side seed ordering) + sample-filtered views --------
	if wantDM {
		if o.accountsFile != "" {
			p.sel = fileSample(fileAccounts, p.Population, o.accountsFile)
		} else {
			p.sel = selectSample(orderPopulation(p.Population, p.seed), o.sample, forcedDMAnchors, includes)
		}
		sampleSet := map[string]bool{}
		for _, a := range p.sel.Accounts {
			sampleSet[a.Row.AccountHex] = true
		}
		for _, s := range p.AllAsOfDM {
			if sampleSet[hex.EncodeToString(s.Account)] {
				p.dmAsOf = append(p.dmAsOf, s)
			}
		}
		for _, m := range p.InternalDMAll {
			if sampleSet[hex.EncodeToString(m.Account)] {
				p.internalDM = append(p.internalDM, m)
			}
		}
		// Source-exclusivity conflicts gate for SAMPLED accounts (the same
		// scope the old per-account reader had), in sample order.
		for _, a := range p.sel.Accounts {
			if msg, ok := p.SourceConflictsByAcct[a.Row.AccountHex]; ok {
				p.sourceConflicts = append(p.sourceConflicts, msg)
			}
		}
		// Deep-replay targets: first N sampled accounts (sample order —
		// deterministic) with a successful sweep and a history document at
		// exactly last_success_block.
		if o.collateralReplay > 0 {
			freshByAccount := map[string]store.AccountFreshness{}
			for _, f := range p.FreshRows {
				freshByAccount[hex.EncodeToString(f.Account)] = f
			}
			for _, a := range p.sel.Accounts {
				if len(p.replays) >= o.collateralReplay {
					break
				}
				f, ok := freshByAccount[a.Row.AccountHex]
				if !ok || f.Status != "success" || f.LastSuccessBlock == 0 {
					continue
				}
				doc, ok := p.HistoryDocs[a.Row.AccountHex]
				if !ok || doc.Block != f.LastSuccessBlock {
					continue
				}
				p.replays = append(p.replays, replayTarget{AccountHex: a.Row.AccountHex, Block: f.LastSuccessBlock, Doc: doc.Doc})
			}
		}
	}

	// Freshness bound (§7 / F7: labeled policy). Round-14 F4: the bound is
	// evaluated from the DAEMON'S PERSISTED cadence
	// (sweep_generations.configured_interval_seconds, written by the daemon
	// every round, read inside this run's snapshot) with the daemon's REAL
	// rule 2×(interval+lastPass); the env var is demoted to a cross-check
	// whose mismatch taints. Rows predating migration 00009 fall back to the
	// wave-15 1h-default bound and keep the wave-15 env cap (fail-closed,
	// never fail-forever, never silently widened). The taints are computed by
	// the SAME evaluation that computes the bound, so the two cannot drift —
	// and they are computed on EVERY path (explicit -snapshot-max-age
	// included): an env claim that contradicts the daemon's durable state is
	// a lie about the deployment whichever bound this run gates with.
	bound, inputs, taints := sweepCadenceEvaluation(p.SweepGen)
	p.cadenceTaints = taints
	if o.snapshotMaxAge == "auto" || o.snapshotMaxAge == "" {
		p.freshBound, p.freshBoundInputs = bound, inputs
	} else {
		d, err := time.ParseDuration(o.snapshotMaxAge)
		if err != nil {
			return nil, abort(exitUsage, "aborted: usage", "-snapshot-max-age: %v", err)
		}
		p.freshBound = d
		p.freshBoundInputs = map[string]string{"resolved_bound": d.String(), "label": "policy (explicit flag)"}
	}
	return p, nil
}

// runWeld compares the snapshot's weld anchors with LIVE headers: the
// greatest raw_logs block ≤ P must still carry its stored hash, and any
// engine ingest cursor sitting exactly at P must match the live header at P
// (L0-10). Returns "ok" or a description of the divergence.
func (p *phase1Data) runWeld(ctx context.Context, r *pinnedReader, chainName string) (string, error) {
	w, ok := p.WeldDB[chainName]
	if !ok {
		return "ok", nil
	}
	if w.HighestFound {
		live, _, err := r.headerHash(ctx, w.HighestBlock)
		if err != nil {
			return "", err
		}
		if !strings.EqualFold(live.Hex(), "0x"+hex.EncodeToString(w.HighestHash)) {
			return fmt.Sprintf("raw_logs hash at %d (%x) != live header %s", w.HighestBlock, w.HighestHash, live.Hex()), nil
		}
	}
	for stream, storedHash := range w.CursorHashesAtP {
		live, _, err := r.headerHash(ctx, w.Pin)
		if err != nil {
			return "", err
		}
		if !strings.EqualFold(live.Hex(), "0x"+hex.EncodeToString(storedHash)) {
			return fmt.Sprintf("ingest cursor %s at P=%d hash %x != live header %s", stream, w.Pin, storedHash, live.Hex()), nil
		}
	}
	return "ok", nil
}

// --- report assembly helpers -------------------------------------------------

func (p *phase1Data) pinSection() []pinInfo {
	var pins []pinInfo
	chains := make([]string, 0, len(p.pinHashes))
	for c := range p.pinHashes {
		chains = append(chains, c)
	}
	sort.Strings(chains)
	for _, c := range chains {
		var block uint64
		for engine, pin := range p.Pins {
			if p.ChainFor[engine] == c {
				block = pin
			}
		}
		pins = append(pins, pinInfo{Chain: c, Block: block, Hash: p.pinHashes[c].Hex(), HeaderTime: p.pinTimes[c]})
	}
	return pins
}

func (p *phase1Data) cursorInfo() *cursorInfo {
	ci := &cursorInfo{MaxReorgEpochsInfo: map[string]int64{}}
	for _, c := range p.DeriveCursors {
		ci.Derive = append(ci.Derive, map[string]any{
			"engine": c.Engine, "chain_id": c.ChainID, "last_block": c.LastBlock, "acked_epoch": c.AckedEpoch,
		})
	}
	for _, c := range p.IngestCursors {
		ci.Ingest = append(ci.Ingest, map[string]any{
			"stream": c.Stream, "chain_id": c.ChainID, "last_block": c.LastBlock,
			"last_block_hash": hex.EncodeToString(c.LastBlockHash),
		})
	}
	for chainID, epoch := range p.Baseline.MaxEpoch {
		ci.MaxReorgEpochsInfo[fmt.Sprintf("%d", chainID)] = epoch
	}
	return ci
}

func (p *phase1Data) sampleSection() map[string]any {
	accounts := make([]map[string]any, 0, len(p.sel.Accounts))
	for _, a := range p.sel.Accounts {
		accounts = append(accounts, map[string]any{
			"account": a.Row.AccountHex,
			"stratum": a.Row.Stratum,
			"live":    a.Row.Live,
			"forced":  a.Forced,
			"source":  a.Source,
		})
	}
	return map[string]any{
		"seed":              p.seed,
		"quotas":            p.sel.Quotas,
		"taken_per_stratum": p.sel.TakenPerStratum,
		"shortfalls":        p.sel.Shortfalls,
		"live_count":        p.sel.LiveCount,
		"zero_count":        p.sel.ZeroCount,
		"residue_count":     p.sel.ResidueCount,
		"population_strata": p.StrataCounts,
		"notes":             p.sel.Notes,
		"accounts":          accounts,
		"anchor_provenance": "forced DM anchors validated bit-exact at PIN 154,021,227 with net-normalized 963813 / 3985789485 / 7153773 (recon/derivation-notes.md) — provenance constants, not asserted at today's pin",
	}
}

func (p *phase1Data) internalSection() map[string]any {
	toRows := func(ms []store.InternalMismatch) []map[string]any {
		out := make([]map[string]any, 0, len(ms))
		for _, m := range ms {
			out = append(out, map[string]any{
				"account": hex.EncodeToString(m.Account), "asset": hex.EncodeToString(m.Asset),
				"side": m.Side, "event_sum": m.EventSum, "balance": m.Balance,
				"class": classInternalInconsist,
			})
		}
		return out
	}
	return map[string]any{
		"debt_manager":     toRows(p.internalDM),
		"aave_v3_etherfi":  toRows(p.InternalAave),
		"source_conflicts": p.sourceConflicts,
		"note":             "inside the snapshot cursor == P by construction, so event-source balances must equal the as-of sums exactly; a row here localizes an indexer bug at the certified accounts (class internal_inconsistency, gated)",
	}
}

func (p *phase1Data) internalFailures() int {
	return len(p.internalDM) + len(p.InternalAave) + len(p.sourceConflicts)
}

// invariantGatedRows counts gated scan violations (advisory scan excluded)
// plus the named sub-assertions.
func (p *phase1Data) invariantGatedRows() int {
	n := p.Invariants.Scan1DistinctHash.Rows +
		p.Invariants.Scan2EventSums.Rows +
		p.Invariants.Scan3BorrowIndex.Rows +
		p.Invariants.Scan4EventLogOrphan.Rows +
		p.Invariants.Scan5IIUCoverage.Rows
	n += int(p.Invariants.NullAssetDeltaRows)
	n += int(p.Invariants.SidelessDeltaRows)
	return n
}
