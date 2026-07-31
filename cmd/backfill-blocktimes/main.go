// Command backfill-blocktimes is the ONE-SHOT historical half of P5's
// block-time custody: it walks every event-bearing block still missing from
// block_headers, fetches each block's header via the same failover-client
// discipline the daemon uses, hash-validates it against the stored raw_logs
// pin, and upserts the header's OWN timestamp. Run ONCE against live after
// the daemon ships migration 00015 (an ordinary op, no maintenance window);
// re-running is always safe and is the documented repair for holes the
// daemon's live custody left behind.
//
// # Scope: WHICH blocks (the "position_events ∪ raw_logs?" question, decided)
//
// The cohort walked is DISTINCT position_events blocks plus DISTINCT
// param_history blocks, per engine — NOT all raw_logs blocks. The need is
// defined by what the P5 API serves block_time for: the chain-action feed
// (position_events) and the parameter timeline (param_history). Measured on
// the live DB (2026-07-30): raw_logs holds 398,894 distinct blocks,
// position_events 346,124 (every one carrying a raw-log pin), param_history 1.
// The ~53k raw_logs-only blocks are chainlink AnswerUpdated blocks — price
// rows already carry their own chain-asserted source_as_of (migration 00012),
// no surface serves a header time for them, and fetching ~53k headers nothing
// would ever read is chain load with no consumer. Blocks whose events carry
// NO raw-log pin (the Debt Manager's calldata-sourced genesis seeds) are
// excluded by construction: with no pin there is nothing to validate a
// fetched header against, and an unvalidated time must not be stored; the
// cohort report counts them as Unpinned.
//
// # Discipline
//
//   - ENV-GATED: refuses to run unless SOLVENT_BACKFILL_BLOCKTIMES=1 —
//     exactly "1" — because a tool that walks ~350k header fetches must start
//     deliberately, never as a side effect of a shell history replay.
//   - READ-ONLY against the chain; writes ONLY block_headers. It takes no
//     writer lock and needs none: the daemon's live custody and this tool
//     validate against the SAME durable pin, so concurrent upserts are either
//     identical no-ops or refused divergences (see migration 00015).
//   - RATE-LIMITED (-rate headers/sec) so a backfill cannot starve the live
//     daemon's ingestion on shared RPC endpoints.
//   - RESUMABLE FROM THE TABLE ITSELF: the walk is an anti-join against
//     block_headers, so progress needs no sidecar state — kill it, re-run it,
//     it continues where the rows say it should.
//   - THE FAILURE LAW: a failed fetch is a counted outcome and the walk
//     continues; the row stays honestly absent and the next run retries it.
//     Ambiguous pins, divergent stored rows and off-pin fetches are REFUSALS,
//     logged and counted, never silent overwrites.
//   - It does NOT run migrations: ship the daemon (which migrates) first; an
//     undefined-table error here means the ship order was inverted.
package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"io"
	"math"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/ethereum/go-ethereum/common"

	"github.com/kaselunt/solvent/internal/chain"
	"github.com/kaselunt/solvent/internal/config"
	"github.com/kaselunt/solvent/internal/derive"
	"github.com/kaselunt/solvent/internal/store"
)

const gateEnv = "SOLVENT_BACKFILL_BLOCKTIMES"

// gateOpen is the whole gate: exactly "1", nothing else.
func gateOpen(v string) bool { return v == "1" }

// backfillStore is the narrow store surface the walk needs (*store.Store
// satisfies it; tests pass a fake).
type backfillStore interface {
	EventBlocksNeedingHeaders(ctx context.Context, q store.HeaderNeedQuery) ([]store.HeaderNeed, error)
	UpsertBlockHeader(ctx context.Context, w store.BlockHeaderWrite) (store.BlockHeaderUpsert, error)
	BlockHeaderCohorts(ctx context.Context, engine string, chainID uint64, source store.EventBlockSource) (store.BlockHeaderCohorts, error)
}

// pinnedHeader / headerFetch mirror cmd/indexer/blocktimes.go — the two
// binaries share no package and this wave's tree admits no new shared home;
// if a third caller appears, hoist the discipline into internal/chain.
type pinnedHeader struct {
	hash common.Hash
	time uint64
}

type headerFetch func(ctx context.Context, chainID, block uint64) (pinnedHeader, error)

// backfillUnit is one engine's cohort: which ledger, on which chain.
type backfillUnit struct {
	engine  string
	chainID uint64
	source  store.EventBlockSource
}

// unitsFromSpecs derives the cohort set from the SAME runner specs the daemon
// wires, so the two custody surfaces cannot drift apart on scope: position
// engines walk position_events, the param engine walks param_history, the
// chainlink_feed engine is excluded (its price rows carry their own as-of),
// and an engine this tool does not recognize is skipped rather than guessed
// at — a new engine must be added here deliberately, with its ledger named.
func unitsFromSpecs(specs []derive.RunnerSpec) []backfillUnit {
	var units []backfillUnit
	for _, spec := range specs {
		switch spec.Engine {
		case "debt_manager", "aave_v3_etherfi":
			units = append(units, backfillUnit{engine: spec.Engine, chainID: spec.ChainID, source: store.EventBlocksPositionEvents})
		case derive.ParamEngineName:
			units = append(units, backfillUnit{engine: spec.Engine, chainID: spec.ChainID, source: store.EventBlocksParamHistory})
		case "chainlink_feed":
			// Excluded by scope (see the package doc).
		default:
			fmt.Fprintf(os.Stderr, "note: engine %q is not in this tool's custody scope; skipping (add it to unitsFromSpecs deliberately if its blocks owe headers)\n", spec.Engine)
		}
	}
	return units
}

// backfillOpts carries the walk's knobs. wait is the rate-limiter step,
// injected so tests need no clock.
type backfillOpts struct {
	batch int
	max   int // stop after this many WRITTEN headers (0 = unbounded): a bounded trial run
	wait  func(ctx context.Context) error
	out   io.Writer
}

// unitReport is one unit's honest census: what was written, what was refused
// and why, what failed, and whether the walk was cut short.
type unitReport struct {
	unit               backfillUnit
	before, after      store.BlockHeaderCohorts
	written            int
	refusedAmbiguous   int
	refusedDivergent   int
	refusedPinMismatch int
	fetchFailed        int
	writeRefused       int
	stoppedAtMax       bool
}

// backfillUnitRun walks one unit's cohort bottom-up with keyset pagination.
// The keyset moves past failures and refusals (they are re-listed by the
// anti-join on the NEXT run); only a store/query error or a cancelled context
// aborts the run.
func backfillUnitRun(ctx context.Context, st backfillStore, fetch headerFetch, u backfillUnit, opts backfillOpts) (unitReport, error) {
	rep := unitReport{unit: u}
	var err error
	rep.before, err = st.BlockHeaderCohorts(ctx, u.engine, u.chainID, u.source)
	if err != nil {
		return rep, fmt.Errorf("cohorts before (%s): %w", u.engine, err)
	}
	fmt.Fprintf(opts.out, "%s (chain %d, %s): %d event-bearing blocks — %d with headers, %d missing, %d mismatched, %d ambiguous, %d unpinned\n",
		u.engine, u.chainID, u.source, rep.before.EventBlocks, rep.before.WithHeader,
		rep.before.Missing, rep.before.Mismatched, rep.before.Ambiguous, rep.before.Unpinned)

	from := uint64(0)
walk:
	for {
		if ctx.Err() != nil {
			break
		}
		needs, err := st.EventBlocksNeedingHeaders(ctx, store.HeaderNeedQuery{
			Engine: u.engine, ChainID: u.chainID, Source: u.source,
			FromExclusive: from, ToInclusive: math.MaxInt64, Limit: opts.batch,
		})
		if err != nil {
			return rep, fmt.Errorf("needing-headers scan (%s from %d): %w", u.engine, from, err)
		}
		if len(needs) == 0 {
			break
		}
		for _, n := range needs {
			if ctx.Err() != nil {
				break walk
			}
			from = n.Block
			switch {
			case len(n.PinHashes) != 1:
				rep.refusedAmbiguous++
				fmt.Fprintf(opts.out, "REFUSED %s block %d: ambiguous raw-log pin (%d distinct hashes); custody waits for ingest to converge\n",
					u.engine, n.Block, len(n.PinHashes))
				continue
			case n.ExistingHash != nil:
				rep.refusedDivergent++
				fmt.Fprintf(opts.out, "REFUSED %s block %d: stored header %x diverges from the current pin %x; not overwritten (delete the row to re-custody)\n",
					u.engine, n.Block, n.ExistingHash, n.PinHashes[0])
				continue
			}
			if err := opts.wait(ctx); err != nil {
				break walk // cancelled mid-wait: an honest partial run
			}
			ph, err := fetch(ctx, u.chainID, n.Block)
			if err != nil {
				if ctx.Err() != nil {
					break walk
				}
				rep.fetchFailed++
				fmt.Fprintf(opts.out, "fetch failed %s block %d: %v (row stays absent; a re-run retries it)\n", u.engine, n.Block, err)
				continue
			}
			if ph.hash != common.BytesToHash(n.PinHashes[0]) {
				rep.refusedPinMismatch++
				fmt.Fprintf(opts.out, "REFUSED %s block %d: fetched header %s does not match the stored pin %x; nothing written\n",
					u.engine, n.Block, ph.hash.Hex(), n.PinHashes[0])
				continue
			}
			res, err := st.UpsertBlockHeader(ctx, store.BlockHeaderWrite{
				ChainID: u.chainID, Block: n.Block,
				Hash: ph.hash[:],
				// The header's OWN timestamp, bit-exact — never a clock.
				Time: int64(ph.time),
			})
			if err != nil {
				return rep, fmt.Errorf("write header (%s block %d): %w", u.engine, n.Block, err)
			}
			if !res.Stored {
				rep.writeRefused++
				fmt.Fprintf(opts.out, "REFUSED at write %s block %d: an existing row (hash %x, time %d) diverges; not overwritten\n",
					u.engine, n.Block, res.ExistingHash, res.ExistingTime)
				continue
			}
			rep.written++
			if opts.max > 0 && rep.written >= opts.max {
				rep.stoppedAtMax = true
				break walk
			}
		}
	}

	rep.after, err = st.BlockHeaderCohorts(ctx, u.engine, u.chainID, u.source)
	if err != nil {
		return rep, fmt.Errorf("cohorts after (%s): %w", u.engine, err)
	}
	state := "complete"
	if rep.stoppedAtMax {
		state = "STOPPED at -max: the walk is incomplete; re-run to continue"
	} else if ctx.Err() != nil {
		state = "INTERRUPTED: the walk is incomplete; re-run to continue"
	}
	fmt.Fprintf(opts.out, "%s done (%s): wrote %d; refused %d ambiguous, %d divergent-row, %d pin-mismatch, %d at-write; %d fetch failures\n",
		u.engine, state, rep.written, rep.refusedAmbiguous, rep.refusedDivergent, rep.refusedPinMismatch, rep.writeRefused, rep.fetchFailed)
	fmt.Fprintf(opts.out, "%s cohorts now: %d event-bearing blocks — %d with headers, %d missing, %d mismatched, %d ambiguous, %d unpinned\n",
		u.engine, rep.after.EventBlocks, rep.after.WithHeader, rep.after.Missing,
		rep.after.Mismatched, rep.after.Ambiguous, rep.after.Unpinned)
	return rep, nil
}

// rateWaiter returns a wait step enforcing headers-per-second, cancellable.
func rateWaiter(perSecond float64) func(ctx context.Context) error {
	if perSecond <= 0 {
		return func(context.Context) error { return nil }
	}
	interval := time.Duration(float64(time.Second) / perSecond)
	return func(ctx context.Context) error {
		t := time.NewTimer(interval)
		defer t.Stop()
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-t.C:
			return nil
		}
	}
}

func main() {
	configPath := flag.String("config", "config/contracts.json", "path to contracts config")
	rate := flag.Float64("rate", 8, "header fetches per second (rate limit; shared RPC endpoints also serve the live daemon)")
	batch := flag.Int("batch", 500, "blocks per needing-headers scan")
	max := flag.Int("max", 0, "stop after writing this many headers (0 = walk everything): a bounded trial run")
	flag.Parse()

	if !gateOpen(os.Getenv(gateEnv)) {
		fmt.Fprintf(os.Stderr, "REFUSING to run: %s=1 is required. This tool performs a large one-shot chain walk (hundreds of thousands of header fetches against live RPC endpoints) and must be started deliberately.\n", gateEnv)
		os.Exit(2)
	}

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	if err := run(ctx, *configPath, *rate, *batch, *max); err != nil {
		fmt.Fprintln(os.Stderr, "backfill-blocktimes:", err)
		os.Exit(1)
	}
}

func run(ctx context.Context, configPath string, rate float64, batch, max int) error {
	cfg, err := config.Load(configPath)
	if err != nil {
		return err
	}
	specs, err := derive.BuildRunnerSpecs(cfg)
	if err != nil {
		return err
	}
	units := unitsFromSpecs(specs)
	if len(units) == 0 {
		return errors.New("no custody units derived from the config; nothing to backfill")
	}

	st, err := store.Open(ctx, cfg.DatabaseURL)
	if err != nil {
		return err
	}
	defer st.Close()
	// Deliberately NO writer lock and NO migrations: the daemon owns both.
	// Probe the table so an inverted ship order fails with a plain sentence.
	for _, u := range units {
		if _, _, err := st.MaxBlockHeaderBlock(ctx, u.chainID); err != nil {
			return fmt.Errorf("block_headers is not readable (ship the daemon with migration 00015 BEFORE running the backfill): %w", err)
		}
		break
	}

	// Dial only the chains the units need, verifying chain ids exactly as the
	// daemon does.
	clients := map[uint64]*chain.Failover{}
	for name, c := range cfg.Chains {
		needed := false
		for _, u := range units {
			if u.chainID == c.ChainID {
				needed = true
			}
		}
		if !needed {
			continue
		}
		fc, err := chain.Dial(ctx, c.RPCURLs)
		if err != nil {
			return fmt.Errorf("chain %q: %w", name, err)
		}
		if err := fc.VerifyChainID(ctx, c.ChainID); err != nil {
			return fmt.Errorf("chain %q: %w", name, err)
		}
		clients[c.ChainID] = fc
	}
	fetch := func(ctx context.Context, chainID, block uint64) (pinnedHeader, error) {
		fc, ok := clients[chainID]
		if !ok {
			return pinnedHeader{}, fmt.Errorf("no rpc client configured for chain %d", chainID)
		}
		return fetchPinnedHeader(ctx, fc, block)
	}

	opts := backfillOpts{batch: batch, max: max, wait: rateWaiter(rate), out: os.Stdout}
	fmt.Printf("block-time backfill: %d unit(s), rate %.1f headers/s, batch %d\n", len(units), rate, batch)
	for _, u := range units {
		if ctx.Err() != nil {
			break
		}
		if _, err := backfillUnitRun(ctx, st, fetch, u, opts); err != nil {
			return err
		}
	}
	if ctx.Err() != nil {
		fmt.Println("interrupted; the walk is resumable — re-run to continue (progress lives in block_headers itself)")
	}
	return nil
}

// fetchPinnedHeader reads one block's (hash, time) pair such that both fields
// provably describe ONE endpoint's view of the block: hash, then time, then
// hash again, all pinned to the same endpoint index, bracketing hashes
// required identical. A copy of cmd/indexer/blocktimes.go's helper — see the
// note on backfillStore about why it is duplicated.
func fetchPinnedHeader(ctx context.Context, fc *chain.Failover, block uint64) (pinnedHeader, error) {
	h1, tok1, err := fc.HeaderHashFrom(ctx, fc.ActiveEndpoint(), block)
	if err != nil {
		return pinnedHeader{}, err
	}
	t, tok2, err := fc.HeaderTimeFrom(ctx, tok1.Index, block)
	if err != nil {
		return pinnedHeader{}, err
	}
	h2, tok3, err := fc.HeaderHashFrom(ctx, tok2.Index, block)
	if err != nil {
		return pinnedHeader{}, err
	}
	if tok2.Index != tok1.Index || tok3.Index != tok2.Index {
		return pinnedHeader{}, fmt.Errorf("header fetch for block %d straddled a failover (endpoints %d/%d/%d): the (hash, time) pair cannot be attributed to one endpoint's view",
			block, tok1.Index, tok2.Index, tok3.Index)
	}
	if h2 != h1 {
		return pinnedHeader{}, fmt.Errorf("header fetch for block %d saw the block change under it (%s then %s): a reorg is in flight, refusing the pair",
			block, h1.Hex(), h2.Hex())
	}
	return pinnedHeader{hash: h1, time: t}, nil
}
