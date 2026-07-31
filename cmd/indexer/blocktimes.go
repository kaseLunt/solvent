package main

// BLOCK-TIME CUSTODY (P5 Task B2): the per-round pass that fetches and stores
// the header timestamps of event-bearing blocks, into migration 00015's
// block_headers table.
//
// # Why it exists
//
// This schema deliberately holds no wall-clock times for chain state
// (raw_logs records no header timestamp), so the only honest way to render
// "when did this liquidation happen" is to ask the chain for the block's own
// header. This pass does that for the blocks the P5 API serves block_time
// for: position_events blocks (the chain-action feed) and param_history
// blocks (the parameter timeline). Chainlink feed blocks are deliberately NOT
// custodied — price rows already carry their own chain-asserted source_as_of
// (migration 00012), so their headers would be chain load nothing serves.
//
// # The seam
//
// The pass runs once per daemon round, AFTER the worker passes have stepped:
// walkers land raw logs and derivation turns them into events in the same
// round, so custody sees each round's freshly derived blocks immediately. The
// frontier it walks to is each engine's own DERIVE cursor — derived rows
// exist only at blocks at or below it — and the pins it validates against are
// the block hashes the walkers committed into raw_logs. Its work is bounded
// (headerCustodyCapPerRound fetches per round) and it deliberately does NOT
// count as round progress: a custody backlog must not hold the hot loop open
// against the chain.
//
// # The failure law
//
// A header fetch failure NEVER blocks or fails the ingest round. The row is
// simply ABSENT — downstream renders block-number-only — and the pass carries
// on with the next block; the watermark advances PAST the failure, so a
// permanently failing block cannot wedge custody into an unbounded retry
// loop. Transient holes are then closed by the MISSING-HEADER RETRY SWEEP
// (every headerRetryEveryNRounds rounds, a rotating, bounded re-attempt over
// the still-missing blocks below the watermark — see retrySweep), and the
// historical mass plus anything the sweep has not reached is the one-shot
// cmd/backfill-blocktimes' cohort, re-runnable at any time as an ordinary op.
//
// NOTHING HERE PUBLISHES A HEALTH CONDITION, deliberately: every recoverable
// condition on the health surface fails /readyz, and readiness failing over a
// missing NICETY (a human-readable time) would invert the failure law. The
// carry-over note is a log line instead.
//
// # The pin discipline
//
// A header is stored only when its OWN hash matches the stored raw_logs pin
// for that block. A mismatch — an ambiguous pin, a fetched hash off-pin, or
// an existing block_headers row that diverges from the current pin — is a
// REFUSAL-TO-WRITE plus a loud log, never a silent overwrite (the migration
// documents the operator repair path for the divergent-row case).

import (
	"bytes"
	"context"
	"fmt"
	"log/slog"

	"github.com/ethereum/go-ethereum/common"

	"github.com/kaselunt/solvent/internal/chain"
	"github.com/kaselunt/solvent/internal/store"
)

// headerCustodyCapPerRound bounds how many header fetches one round may
// spend. Steady state at the chain tip is a handful of event-bearing blocks
// per round, so the cap only bites during catch-up bursts, where the
// remainder carries over at cap-per-round; the BULK path for history is the
// one-shot cmd/backfill-blocktimes, never the hot loop.
const headerCustodyCapPerRound = 32

// headerRetryEveryNRounds / headerRetryBudget pace the MISSING-HEADER RETRY
// SWEEP: every Nth round the custodian re-attempts a small batch of blocks
// BELOW its watermark that are still missing headers, cycling through the
// missing set with a rotating keyset. It exists because the live pass
// deliberately advances past a failed fetch (a permanently failing block must
// not wedge the watermark), which would otherwise leave a TRANSIENT failure's
// hole standing until someone re-ran the backfill tool. The sweep obeys the
// same failure law as the live pass — bounded, never blocks ingest, absence
// on failure — and at 8 fetches every 8 rounds it nibbles rather than chases:
// the historical mass (pre-custody blocks) remains the backfill's cohort.
const (
	headerRetryEveryNRounds = 8
	headerRetryBudget       = 8
)

// custodyUnit is one engine's custody obligation: which event ledger to walk
// (position events or the param ledger), on which chain.
type custodyUnit struct {
	engine  string
	chainID uint64
	source  store.EventBlockSource
}

// headerCustodyStore is the narrow store surface the pass needs
// (*store.Store satisfies it; tests pass a fake).
type headerCustodyStore interface {
	DeriveCursorProgress(ctx context.Context) ([]store.CursorProgress, error)
	MaxBlockHeaderBlock(ctx context.Context, chainID uint64) (uint64, bool, error)
	EventBlocksNeedingHeaders(ctx context.Context, q store.HeaderNeedQuery) ([]store.HeaderNeed, error)
	UpsertBlockHeader(ctx context.Context, w store.BlockHeaderWrite) (store.BlockHeaderUpsert, error)
}

// pinnedHeader is one fetched header reduced to what custody stores: its own
// hash (validated against the pin by the caller) and its own timestamp.
type pinnedHeader struct {
	hash common.Hash
	time uint64
}

// headerFetch fetches one block's header via the failover discipline.
type headerFetch func(ctx context.Context, chainID, block uint64) (pinnedHeader, error)

// headerCustodian carries the pass's only cross-round state: the per-engine
// watermark (highest block already EXAMINED, successfully or not). The
// watermark is in-memory on purpose — durable resume state would be a new
// table this wave does not own — and a restart re-derives its starting point
// from the table itself (MaxBlockHeaderBlock), so at worst a restart
// re-examines an already-satisfied range, which the store's anti-join makes
// cheap, or leaves a mid-burst backlog to the backfill tool, which is that
// tool's cohort by design.
type headerCustodian struct {
	st          headerCustodyStore
	fetch       headerFetch
	units       []custodyUnit
	capPerRound int
	watermark   map[string]uint64

	// round counts completed passes; every retryEvery-th round runs the
	// missing-header retry sweep with retryBudget fetches. retryFrom is the
	// sweep's rotating keyset per engine (it cycles through the missing set
	// below the watermark, wrapping at the top, so one permanently-failing
	// block cannot monopolize the sweep).
	round       uint64
	retryEvery  uint64
	retryBudget int
	retryFrom   map[string]uint64
}

func newHeaderCustodian(st headerCustodyStore, fetch headerFetch, units []custodyUnit) *headerCustodian {
	return &headerCustodian{
		st: st, fetch: fetch, units: units,
		capPerRound: headerCustodyCapPerRound,
		watermark:   map[string]uint64{},
		retryEvery:  headerRetryEveryNRounds,
		retryBudget: headerRetryBudget,
		retryFrom:   map[string]uint64{},
	}
}

// custodyOutcome is what examining one block produced.
type custodyOutcome int

const (
	custodyWritten custodyOutcome = iota
	custodyRefused
	custodyFailed
	custodyCancelled
)

// custodyBlock examines ONE block under the full pin discipline: ambiguous
// pins and divergent stored rows refuse without a fetch; an off-pin fetched
// header refuses without a write; a fetch or write failure leaves the row
// absent. Shared verbatim between the live pass and the retry sweep so the
// two cannot drift apart on the law.
func (c *headerCustodian) custodyBlock(ctx context.Context, u custodyUnit, n store.HeaderNeed) custodyOutcome {
	switch {
	case len(n.PinHashes) != 1:
		slog.Error("block-time custody REFUSED: the block's raw-log pin is AMBIGUOUS (streams landed it under different hashes); no fetched header can be validated until ingest converges",
			"engine", u.engine, "chain", u.chainID, "block", n.Block, "pins", len(n.PinHashes))
		return custodyRefused
	case n.ExistingHash != nil:
		slog.Error("block-time custody REFUSED: a stored header diverges from the current raw-log pin; refusing to overwrite custody evidence — an honest reorg deletes the row inside store.Rewind, so a standing divergence is a restored/hand-written row: delete it to re-custody under the current pin",
			"engine", u.engine, "chain", u.chainID, "block", n.Block,
			"storedHash", fmt.Sprintf("%x", n.ExistingHash), "pin", fmt.Sprintf("%x", n.PinHashes[0]))
		return custodyRefused
	}
	ph, err := c.fetch(ctx, u.chainID, n.Block)
	if err != nil {
		if ctx.Err() != nil {
			return custodyCancelled
		}
		slog.Warn("block-time custody: header fetch failed; the row stays ABSENT (downstream renders block-number-only; the periodic retry sweep and cmd/backfill-blocktimes close holes)",
			"engine", u.engine, "chain", u.chainID, "block", n.Block, "err", err)
		return custodyFailed
	}
	if !bytes.Equal(ph.hash[:], n.PinHashes[0]) {
		slog.Error("block-time custody REFUSED: the fetched header's hash does not match the stored raw-log pin (an endpoint on a different fork, or a reorg in flight); nothing is written",
			"engine", u.engine, "chain", u.chainID, "block", n.Block,
			"fetched", ph.hash.Hex(), "pin", fmt.Sprintf("%x", n.PinHashes[0]))
		return custodyRefused
	}
	res, err := c.st.UpsertBlockHeader(ctx, store.BlockHeaderWrite{
		ChainID: u.chainID, Block: n.Block,
		Hash: ph.hash[:],
		// THE HEADER'S OWN TIMESTAMP, forwarded bit-exact. No clock of this
		// process may ever stand in for it (the m1 law).
		Time: int64(ph.time),
	})
	if err != nil {
		if ctx.Err() != nil {
			return custodyCancelled
		}
		slog.Warn("block-time custody: header write failed; the row stays absent for now",
			"engine", u.engine, "chain", u.chainID, "block", n.Block, "err", err)
		return custodyFailed
	}
	if !res.Stored {
		slog.Error("block-time custody REFUSED at write: an existing row diverges from the pin-validated header; not overwritten",
			"engine", u.engine, "chain", u.chainID, "block", n.Block,
			"existingHash", fmt.Sprintf("%x", res.ExistingHash), "existingTime", res.ExistingTime)
		return custodyRefused
	}
	return custodyWritten
}

// pass runs one bounded custody round. It returns nothing and fails nothing:
// every failure inside is a log line plus an absent row (the failure law
// above). Context cancellation stops it quietly mid-way — examined state is
// per-block, so a partial pass leaves nothing torn.
func (c *headerCustodian) pass(ctx context.Context) {
	if len(c.units) == 0 || ctx.Err() != nil {
		return
	}
	rows, err := c.st.DeriveCursorProgress(ctx)
	if err != nil {
		if ctx.Err() == nil {
			slog.Warn("block-time custody: could not read the derive frontier; skipping this round (rows stay absent, which is the honest state)", "err", err)
		}
		return
	}
	cursor := make(map[string]uint64, len(rows))
	for _, p := range rows {
		cursor[p.Name] = p.Block
	}

	budget := c.capPerRound
	attempted, written, refused, failed := 0, 0, 0, 0
	carryOver := false
	for _, u := range c.units {
		if ctx.Err() != nil {
			return
		}
		cur, started := cursor[u.engine]
		if !started {
			continue // nothing derived yet: no custody owed
		}
		wm, seen := c.watermark[u.engine]
		if !seen {
			// Startup: resume from the chain's highest custodied block when it
			// trails the cursor — the tail the previous process had not reached
			// is re-offered (already-satisfied blocks fall out of the
			// anti-join). With no custody at all, start AT the cursor: history
			// is the one-shot backfill's job, not the hot loop's.
			wm = cur
			if maxbh, found, err := c.st.MaxBlockHeaderBlock(ctx, u.chainID); err != nil {
				if ctx.Err() != nil {
					return
				}
				slog.Warn("block-time custody: could not read the resume point; starting at the current cursor (anything below stays the backfill's cohort)",
					"engine", u.engine, "chain", u.chainID, "err", err)
			} else if found && maxbh < wm {
				wm = maxbh
			}
			c.watermark[u.engine] = wm
		}
		if cur < wm {
			// Rewind clamp: a rewound cursor pulls custody back so the
			// re-walked range is re-examined under its new pins.
			wm = cur
			c.watermark[u.engine] = wm
		}
		if cur == wm || budget <= 0 {
			if cur > wm {
				carryOver = true
			}
			continue
		}
		needs, err := c.st.EventBlocksNeedingHeaders(ctx, store.HeaderNeedQuery{
			Engine: u.engine, ChainID: u.chainID, Source: u.source,
			FromExclusive: wm, ToInclusive: cur, Limit: budget + 1,
		})
		if err != nil {
			if ctx.Err() != nil {
				return
			}
			slog.Warn("block-time custody: needing-headers scan failed; skipping this engine for the round",
				"engine", u.engine, "err", err)
			continue
		}
		truncated := len(needs) > budget
		if truncated {
			needs = needs[:budget]
			carryOver = true
		}
		for _, n := range needs {
			if ctx.Err() != nil {
				return
			}
			attempted++
			budget--
			// EVERY EXAMINED BLOCK ADVANCES THE WATERMARK, refusals and
			// failures included: absence is honest, the retry sweep and the
			// backfill tool are the named repairs, and a block that could
			// never succeed must not wedge custody into an unbounded retry
			// loop.
			if n.Block > c.watermark[u.engine] {
				c.watermark[u.engine] = n.Block
			}
			switch c.custodyBlock(ctx, u, n) {
			case custodyWritten:
				written++
			case custodyRefused:
				refused++
			case custodyFailed:
				failed++
			case custodyCancelled:
				return
			}
		}
		if !truncated {
			// The whole (wm, cursor] range was examined; everything not
			// returned by the scan is custody-complete.
			c.watermark[u.engine] = cur
		}
	}

	// The MISSING-HEADER RETRY SWEEP (every retryEvery-th round): transient
	// fetch failures below the watermark must not stand until an operator
	// re-runs the backfill. Same failure law, own small budget.
	c.round++
	retryAttempted, retryWritten := 0, 0
	if c.retryEvery > 0 && c.round%c.retryEvery == 0 {
		retryAttempted, retryWritten = c.retrySweep(ctx)
	}

	if attempted > 0 || retryAttempted > 0 || carryOver {
		// The carry-over NOTE lives here rather than on the health surface:
		// every recoverable health condition fails /readyz, and readiness
		// failing over an unfinished nicety would invert the failure law.
		slog.Info("block-time custody round",
			"attempted", attempted, "written", written, "refused", refused, "failed", failed,
			"retryAttempted", retryAttempted, "retryWritten", retryWritten,
			"carryOver", carryOver)
	}
}

// retrySweep re-attempts a bounded batch of blocks BELOW each engine's
// watermark that still lack headers — the holes the live pass advanced past.
// A rotating keyset (retryFrom) cycles through the missing set and wraps at
// the watermark, so a permanently failing or refused block delays its
// neighbours by at most one sweep slot instead of monopolizing the budget
// forever. Returns (attempted, written); every failure is a log line and an
// absent row, exactly as in the live pass.
func (c *headerCustodian) retrySweep(ctx context.Context) (attempted, written int) {
	budget := c.retryBudget
	for _, u := range c.units {
		if ctx.Err() != nil || budget <= 0 {
			return
		}
		wm := c.watermark[u.engine]
		if wm == 0 {
			continue // no custodied range yet: nothing below the watermark to retry
		}
		from := c.retryFrom[u.engine]
		if from >= wm {
			from = 0 // wrap: a new cycle over whatever is still missing
		}
		needs, err := c.st.EventBlocksNeedingHeaders(ctx, store.HeaderNeedQuery{
			Engine: u.engine, ChainID: u.chainID, Source: u.source,
			FromExclusive: from, ToInclusive: wm, Limit: budget,
		})
		if err != nil {
			if ctx.Err() != nil {
				return
			}
			slog.Warn("block-time custody retry sweep: scan failed; skipping this engine for the sweep", "engine", u.engine, "err", err)
			continue
		}
		if len(needs) == 0 {
			c.retryFrom[u.engine] = 0 // nothing missing above `from`: next sweep starts a fresh cycle
			continue
		}
		for _, n := range needs {
			if ctx.Err() != nil {
				return
			}
			attempted++
			budget--
			c.retryFrom[u.engine] = n.Block
			if c.custodyBlock(ctx, u, n) == custodyWritten {
				written++
			}
		}
	}
	return
}

// fetchPinnedHeader reads one block's (hash, time) pair through the failover
// client such that both fields provably describe ONE endpoint's view of the
// block: hash, then time, then hash again, all pinned to the same endpoint
// index, with the bracketing hashes required identical. Failover exposes no
// single call returning a full numbered header, and two independent calls
// could straddle a failover onto a different fork — the bracket closes that.
// The caller still validates the returned hash against the raw_logs pin; this
// helper only guarantees internal consistency of the pair.
//
// (cmd/backfill-blocktimes carries a copy of this discipline: the two
// binaries share no package, and this wave's tree rules do not admit a new
// shared home for it. If a third caller appears, hoist it into
// internal/chain.)
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
