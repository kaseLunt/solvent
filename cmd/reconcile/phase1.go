// Phase 1 — the REPEATABLE READ READ ONLY snapshot (brief §0). Every DB
// read of the run happens inside ONE transaction on ONE connection, through
// the store package's Querier-taking functions, so the drift report's DB
// side is a single atomic database state. The only RPC inside the phase is
// the pin-hash header read the default seed requires (seed = hex of the OP
// pin's block hash — argumentless runs stay reproducible). COMMIT closes
// the snapshot BEFORE any comparison RPC (vacuum-friendliness).
package main

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"math/big"
	"os"
	"sort"
	"strings"
	"time"

	"github.com/ethereum/go-ethereum/common"
	"github.com/jackc/pgx/v5"

	"github.com/kaselunt/solvent/internal/config"
	"github.com/kaselunt/solvent/internal/store"
)

// weldDBData is one chain's fork-weld DB side, read in the snapshot and
// compared against live headers after commit AND again in Phase 3.
type weldDBData struct {
	ChainID      int64
	Pin          uint64
	HighestBlock uint64
	HighestHash  []byte
	HighestFound bool
	// CursorHashesAtP: ingest cursors (of this chain's reconciled engine)
	// whose last_block == P — the L0-10 anchor when raw_logs sit far below
	// P for a quiet address set.
	CursorHashesAtP map[string][]byte
}

type idxObs struct {
	Value *big.Int
	Block uint64
}

type phase1Data struct {
	pins      map[string]uint64      // engine → P
	pinHashes map[string]common.Hash // chain → pin hash
	pinTimes  map[string]uint64      // chain → pin header time
	chainFor  map[string]string      // engine → chain name
	seed      string
	configSHA string
	deriveLag map[string]any

	baseline      rewindBaseline
	deriveCursors []store.DeriveCursorState
	ingestCursors []store.IngestCursorState

	counts       *store.ReconRowCounts
	population   []store.DMBorrowerRow
	strataCounts map[string]int
	sel          sampleSelection

	dmAsOf       []store.AsOfSum // sampled accounts @ P_op
	dmAllNet     []store.AssetNetSum
	aaveDebtNet  []store.AssetNetSum
	aaveCollNet  []store.AssetNetSum
	aaveAsOfHead []store.AsOfSum // golden + top accounts @ P_eth

	internalDM   []store.InternalMismatch
	internalAave []store.InternalMismatch

	golden  goldenDBSide
	topAave []store.TopDebtAccount

	freshRows        []store.AccountFreshness
	sweepGen         store.SweepGenerationState
	freshBound       time.Duration
	freshBoundInputs map[string]string

	balances        map[string][]store.BalanceRow
	sourceConflicts []string
	replays         []replayTarget

	dmIdxBase map[string]idxObs
	dmAPY     map[string]*store.APYObservation

	residue    map[string]map[string]bool
	stableSnap map[string]int64

	weldDB     map[string]weldDBData
	invariants *invariantsSection
}

type replayTarget struct {
	AccountHex string
	Block      uint64
	Doc        map[string]string
}

// invariantDetailCap bounds how many violation rows land verbatim in the
// artifact (the count is always exact; the detail is a diagnosis aid).
const invariantDetailCap = 100

func runPhase1(ctx context.Context, o *options, cfg *config.Config, roDSN string, vec goldenVectors, wantDM, wantAave bool, opReader, ethReader *pinnedReader) (*phase1Data, error) {
	p := &phase1Data{
		pins:         map[string]uint64{},
		pinHashes:    map[string]common.Hash{},
		pinTimes:     map[string]uint64{},
		chainFor:     map[string]string{},
		balances:     map[string][]store.BalanceRow{},
		dmIdxBase:    map[string]idxObs{},
		dmAPY:        map[string]*store.APYObservation{},
		weldDB:       map[string]weldDBData{},
		strataCounts: map[string]int{},
	}
	for _, s := range cfg.Streams {
		if s.Engine == dmEngine || s.Engine == aaveEngine {
			p.chainFor[s.Engine] = s.Chain
		}
	}
	if raw, err := os.ReadFile(o.configPath); err == nil {
		sum := sha256.Sum256(raw)
		p.configSHA = hex.EncodeToString(sum[:])
	}

	conn, err := pgx.Connect(ctx, roDSN)
	if err != nil {
		return nil, fmt.Errorf("connect (snapshot): %w", err)
	}
	defer conn.Close(ctx)
	tx, err := conn.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
	if err != nil {
		return nil, fmt.Errorf("begin RR RO snapshot: %w", err)
	}
	defer tx.Rollback(ctx)

	// --- pins (§3.1): P = derive cursor read INSIDE the snapshot ----------
	p.deriveCursors, err = store.DeriveCursorStates(ctx, tx)
	if err != nil {
		return nil, err
	}
	cursorByEngine := map[string]store.DeriveCursorState{}
	for _, c := range p.deriveCursors {
		cursorByEngine[c.Engine] = c
	}
	resolvePin := func(engine string, override uint64) (uint64, error) {
		c, ok := cursorByEngine[engine]
		if !ok {
			return 0, abort(exitPrecondition, "aborted: precondition", "no derive cursor for %s", engine)
		}
		if override == 0 {
			return c.LastBlock, nil
		}
		if override > c.LastBlock {
			return 0, abort(exitPrecondition, "aborted: precondition",
				"-pin override %d for %s is ABOVE the derive cursor %d — balances = Σ deltas holds only at or below the cursor, and W1's disproof clause is exactly what a beyond-cursor pin would satisfy vacuously (exit 2)",
				override, engine, c.LastBlock)
		}
		return override, nil
	}
	if wantDM {
		pin, err := resolvePin(dmEngine, o.pinOP)
		if err != nil {
			return nil, err
		}
		p.pins[dmEngine] = pin
	}
	if wantAave {
		pin, err := resolvePin(aaveEngine, o.pinETH)
		if err != nil {
			return nil, err
		}
		p.pins[aaveEngine] = pin
	}

	// Pin hashes (the one RPC inside the phase — the seed default needs the
	// OP pin hash before the sampling query can run).
	readers := map[string]*pinnedReader{}
	if opReader != nil {
		readers["op"] = opReader
	}
	if ethReader != nil {
		readers["eth"] = ethReader
	}
	for engine, pin := range p.pins {
		chainName := p.chainFor[engine]
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

	// --- sampling (§2) ------------------------------------------------------
	if wantDM {
		p.population, err = store.SampleDMBorrowers(ctx, tx, p.pins[dmEngine], p.seed)
		if err != nil {
			return nil, err
		}
		for _, r := range p.population {
			p.strataCounts[r.Stratum]++
		}
		var includes []string
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
			p.sel, err = fileSample(o.accountsFile, p.population)
			if err != nil {
				return nil, err
			}
		} else {
			p.sel = selectSample(p.population, o.sample, forcedDMAnchors, includes)
		}
	}

	sampleAccounts := make([][]byte, 0, len(p.sel.Accounts))
	sampleSet := map[string]bool{}
	for _, a := range p.sel.Accounts {
		b, err := hex.DecodeString(a.Row.AccountHex)
		if err != nil {
			return nil, fmt.Errorf("sample account %q: %w", a.Row.AccountHex, err)
		}
		sampleAccounts = append(sampleAccounts, b)
		sampleSet[a.Row.AccountHex] = true
	}

	// --- as-of sums, aggregates, internal checks ---------------------------
	if wantDM {
		pinOP := p.pins[dmEngine]
		p.dmAsOf, err = store.AsOfEventSums(ctx, tx, dmEngine, sampleAccounts, pinOP)
		if err != nil {
			return nil, err
		}
		p.dmAllNet, err = store.AssetNetSums(ctx, tx, dmEngine, "debt", pinOP)
		if err != nil {
			return nil, err
		}
		p.internalDM, err = store.EventBalanceInternalCheck(ctx, tx, dmEngine, sampleAccounts, pinOP)
		if err != nil {
			return nil, err
		}
		p.residue, err = store.ResidueZeroedAssets(ctx, tx, sampleAccounts, pinOP)
		if err != nil {
			return nil, err
		}
		p.stableSnap, err = store.StableSnapBorrowPresence(ctx, tx, sampleAccounts, pinOP)
		if err != nil {
			return nil, err
		}
		// Index-check DB side (§3.6): latest persisted borrow_index and the
		// payload-sourced APY per DB-known borrow token.
		for _, s := range p.dmAllNet {
			assetHex := hex.EncodeToString(s.Asset)
			idx, block, found, err := store.LatestRateIndexAt(ctx, tx, dmEngine, s.Asset, pinOP, "borrow_index")
			if err != nil {
				return nil, err
			}
			if found {
				p.dmIdxBase[assetHex] = idxObs{Value: idx, Block: block}
			}
			apy, err := store.LatestAPYObservation(ctx, tx, s.Asset, pinOP)
			if err != nil {
				return nil, err
			}
			if apy != nil {
				p.dmAPY[assetHex] = apy
			}
		}
		// Freshness registry + per-account balances (source-exclusivity
		// probe runs on the SNAPSHOT state, brief §7).
		p.freshRows, err = store.SnapshotFreshnessRows(ctx, tx, dmEngine)
		if err != nil {
			return nil, err
		}
		p.sweepGen, err = store.SweepGenerationRow(ctx, tx, dmEngine)
		if err != nil {
			return nil, err
		}
		for _, a := range p.sel.Accounts {
			b, _ := hex.DecodeString(a.Row.AccountHex)
			rows, err := store.ReconBalancesFor(ctx, tx, dmEngine, b)
			if err != nil {
				if strings.Contains(err.Error(), "both event- and snapshot-sourced rows") {
					p.sourceConflicts = append(p.sourceConflicts, err.Error())
					continue
				}
				return nil, err
			}
			p.balances[a.Row.AccountHex] = rows
		}
		// Deep-replay targets: first N sampled accounts (sample order —
		// deterministic) with a successful sweep and a history document at
		// exactly last_success_block.
		if o.collateralReplay > 0 {
			freshByAccount := map[string]store.AccountFreshness{}
			for _, f := range p.freshRows {
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
				b, _ := hex.DecodeString(a.Row.AccountHex)
				doc, found, err := store.CollateralHistoryDoc(ctx, tx, dmEngine, b, f.LastSuccessBlock)
				if err != nil {
					return nil, err
				}
				if !found {
					continue
				}
				p.replays = append(p.replays, replayTarget{AccountHex: a.Row.AccountHex, Block: f.LastSuccessBlock, Doc: doc})
			}
		}
	}
	if wantAave {
		pinETH := p.pins[aaveEngine]
		p.aaveDebtNet, err = store.AssetNetSums(ctx, tx, aaveEngine, "debt", pinETH)
		if err != nil {
			return nil, err
		}
		p.aaveCollNet, err = store.AssetNetSums(ctx, tx, aaveEngine, "collateral", pinETH)
		if err != nil {
			return nil, err
		}
		p.golden, err = collectGoldenDBSide(ctx, tx, vec)
		if err != nil {
			return nil, err
		}
		p.topAave, err = store.TopAaveDebtAccounts(ctx, tx, pinETH, 10)
		if err != nil {
			return nil, err
		}
		aaveAccounts := [][]byte{}
		seen := map[string]bool{}
		for _, b := range vec.Borrowers {
			addr := common.HexToAddress(b.Address).Bytes()
			aaveAccounts = append(aaveAccounts, addr)
			seen[hex.EncodeToString(addr)] = true
		}
		for _, t := range p.topAave {
			if !seen[hex.EncodeToString(t.Account)] {
				seen[hex.EncodeToString(t.Account)] = true
				aaveAccounts = append(aaveAccounts, t.Account)
			}
		}
		p.aaveAsOfHead, err = store.AsOfEventSums(ctx, tx, aaveEngine, aaveAccounts, pinETH)
		if err != nil {
			return nil, err
		}
		p.internalAave, err = store.EventBalanceInternalCheck(ctx, tx, aaveEngine, aaveAccounts, pinETH)
		if err != nil {
			return nil, err
		}
	}

	// Freshness bound (§7 / F7: labeled policy).
	snapshotInterval := time.Hour
	if v := os.Getenv("SOLVENT_SNAPSHOT_INTERVAL"); v != "" {
		if d, err := time.ParseDuration(v); err == nil && d > 0 {
			snapshotInterval = d
		}
	}
	if o.snapshotMaxAge == "auto" || o.snapshotMaxAge == "" {
		p.freshBound, p.freshBoundInputs = freshnessBound(snapshotInterval, p.sweepGen.LastPassSeconds)
	} else {
		d, err := time.ParseDuration(o.snapshotMaxAge)
		if err != nil {
			return nil, abort(exitUsage, "aborted: usage", "-snapshot-max-age: %v", err)
		}
		p.freshBound = d
		p.freshBoundInputs = map[string]string{"resolved_bound": d.String(), "label": "policy (explicit flag)"}
	}

	// --- counts + invariant scans (§6, all inside the snapshot) -----------
	p.counts, err = store.CountReconRows(ctx, tx)
	if err != nil {
		return nil, err
	}
	p.invariants, err = runInvariantScans(ctx, tx, p.counts)
	if err != nil {
		return nil, err
	}

	// --- weld DB side + rewind baseline ------------------------------------
	p.ingestCursors, err = store.IngestCursorStates(ctx, tx)
	if err != nil {
		return nil, err
	}
	maxEpochs, err := store.MaxReorgEpochs(ctx, tx)
	if err != nil {
		return nil, err
	}
	p.baseline = baselineFromCursors(p.deriveCursors, maxEpochs)
	engineOfChain := map[string]string{}
	for e, c := range p.chainFor {
		engineOfChain[c] = e
	}
	for engine, pin := range p.pins {
		chainName := p.chainFor[engine]
		chainID := int64(cfg.Chains[chainName].ChainID)
		block, hash, found, err := store.ReconHighestLogAtOrBelow(ctx, tx, chainID, pin)
		if err != nil {
			return nil, err
		}
		w := weldDBData{ChainID: chainID, Pin: pin, HighestBlock: block, HighestHash: hash, HighestFound: found, CursorHashesAtP: map[string][]byte{}}
		for _, ic := range p.ingestCursors {
			if ic.ChainID == chainID && ic.LastBlock == pin && streamBelongsToEngine(cfg, ic.Stream, engine) {
				w.CursorHashesAtP[ic.Stream] = ic.LastBlockHash
			}
		}
		p.weldDB[chainName] = w
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("commit snapshot (read-only): %w", err)
	}
	return p, nil
}

func streamBelongsToEngine(cfg *config.Config, streamName, engine string) bool {
	for _, s := range cfg.Streams {
		if s.Name == streamName {
			return s.Engine == engine
		}
	}
	return false
}

// runInvariantScans executes every scan through the SAME store functions the
// evidence tests call, embedding counts + capped detail.
func runInvariantScans(ctx context.Context, q store.Querier, counts *store.ReconRowCounts) (*invariantsSection, error) {
	sec := &invariantsSection{
		NullAssetDeltaRows: counts.NullAssetDeltaBearingRows,
		SidelessDeltaRows:  counts.SidelessDeltaBearingRows,
		Note:               "scan 2's ev predicate is deliberately WIDER than the fold predicate (delta IS NOT NULL only); the side-less and NULL-asset sub-assertions name any divergence taxonomy-violation (risk-quant F3). aave_liquidation_call rows may carry delta = 0 (non-nil) — harmless for sums; 'has a delta row' ≠ 'moved a balance'. The full-history IIU recurrence sweep is ADVISORY-DEFERRED: rate_indexes carries no header times, so the sweep needs per-block header reads (hundreds of RPC calls) — deferred with reason, report §deferred.",
	}
	s1, err := store.InvariantDistinctHashViolations(ctx, q)
	if err != nil {
		return nil, err
	}
	sec.Scan1DistinctHash = scanResult{Rows: len(s1), Gated: true, Detail: capDetail(s1)}
	s2, err := store.InvariantEventSumMismatches(ctx, q)
	if err != nil {
		return nil, err
	}
	sec.Scan2EventSums = scanResult{Rows: len(s2), Gated: true, Detail: capDetail(s2)}
	s3, err := store.InvariantBorrowIndexRegressions(ctx, q)
	if err != nil {
		return nil, err
	}
	sec.Scan3BorrowIndex = scanResult{Rows: len(s3), Gated: true, Detail: capDetail(s3)}
	s4, err := store.InvariantEventLogOrphans(ctx, q)
	if err != nil {
		return nil, err
	}
	sec.Scan4EventLogOrphan = scanResult{Rows: len(s4), Gated: true, Detail: capDetail(s4)}
	s5, err := store.InvariantIIUCoverageGaps(ctx, q)
	if err != nil {
		return nil, err
	}
	sec.Scan5IIUCoverage = scanResult{Rows: len(s5), Gated: true, Detail: capDetail(s5)}
	adv, err := store.InvariantAaveIndexRegressions(ctx, q)
	if err != nil {
		return nil, err
	}
	sec.AdvisoryAaveIndex = scanResult{Rows: len(adv), Gated: false, Detail: capDetail(adv)}
	// The sub-assertions are GATED zero-counts too.
	return sec, nil
}

func capDetail[T any](rows []T) any {
	if len(rows) == 0 {
		return nil
	}
	if len(rows) > invariantDetailCap {
		return rows[:invariantDetailCap]
	}
	return rows
}

// runWeld compares the snapshot's weld anchors with LIVE headers: the
// greatest raw_logs block ≤ P must still carry its stored hash, and any
// engine ingest cursor sitting exactly at P must match the live header at P
// (L0-10). Returns "ok" or a description of the divergence.
func (p *phase1Data) runWeld(ctx context.Context, r *pinnedReader, chainName string) (string, error) {
	w, ok := p.weldDB[chainName]
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
		for engine, pin := range p.pins {
			if p.chainFor[engine] == c {
				block = pin
			}
		}
		pins = append(pins, pinInfo{Chain: c, Block: block, Hash: p.pinHashes[c].Hex(), HeaderTime: p.pinTimes[c]})
	}
	return pins
}

func (p *phase1Data) cursorInfo() *cursorInfo {
	ci := &cursorInfo{MaxReorgEpochsInfo: map[string]int64{}}
	for _, c := range p.deriveCursors {
		ci.Derive = append(ci.Derive, map[string]any{
			"engine": c.Engine, "chain_id": c.ChainID, "last_block": c.LastBlock, "acked_epoch": c.AckedEpoch,
		})
	}
	for _, c := range p.ingestCursors {
		ci.Ingest = append(ci.Ingest, map[string]any{
			"stream": c.Stream, "chain_id": c.ChainID, "last_block": c.LastBlock,
			"last_block_hash": hex.EncodeToString(c.LastBlockHash),
		})
	}
	for chainID, epoch := range p.baseline.MaxEpoch {
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
		"population_strata": p.strataCounts,
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
		"aave_v3_etherfi":  toRows(p.internalAave),
		"source_conflicts": p.sourceConflicts,
		"note":             "inside the snapshot cursor == P by construction, so event-source balances must equal the as-of sums exactly; a row here localizes an indexer bug at the certified accounts (class internal_inconsistency, gated)",
	}
}

func (p *phase1Data) internalFailures() int {
	return len(p.internalDM) + len(p.internalAave) + len(p.sourceConflicts)
}

// invariantGatedRows counts gated scan violations (advisory scan excluded)
// plus the named sub-assertions.
func (p *phase1Data) invariantGatedRows() int {
	n := p.invariants.Scan1DistinctHash.Rows +
		p.invariants.Scan2EventSums.Rows +
		p.invariants.Scan3BorrowIndex.Rows +
		p.invariants.Scan4EventLogOrphan.Rows +
		p.invariants.Scan5IIUCoverage.Rows
	n += int(p.invariants.NullAssetDeltaRows)
	n += int(p.invariants.SidelessDeltaRows)
	return n
}
