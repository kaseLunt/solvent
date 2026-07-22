package ingest

import (
	"bytes"
	"context"
	"fmt"
	"log/slog"
	"math"
	"reflect"

	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/core/types"

	"github.com/kaselunt/solvent/internal/store"
)

type Chain interface {
	BlockNumber(ctx context.Context) (uint64, error)
	HeaderHash(ctx context.Context, n uint64) (common.Hash, error)
	Logs(ctx context.Context, from, to uint64, addrs []common.Address) ([]types.Log, error)
}

type Store interface {
	Cursor(ctx context.Context, stream string) (*store.CursorPos, error)
	SaveBatch(ctx context.Context, stream string, chainID uint64, logs []store.RawLog, tipBlock uint64, tipHash []byte) error
	Rewind(ctx context.Context, stream string, chainID uint64, toBlock uint64, hashAtBlock []byte) error
	HighestLogAtOrBelow(ctx context.Context, chainID, height uint64) (block uint64, blockHash []byte, found bool, err error)
}

type WalkerConfig struct {
	Stream        string
	ChainID       uint64
	Addresses     []common.Address
	StartBlock    uint64
	Window        uint64
	Confirmations uint64
}

type Walker struct {
	chain Chain
	store Store
	cfg   WalkerConfig
	// addrSet mirrors cfg.Addresses for O(1) log-address membership checks.
	// It is never empty: wildcard streams (empty address set) are unsupported
	// and rejected by config validation, so an empty set here would silently
	// fail every batch on the address check.
	addrSet map[common.Address]struct{}
}

func NewWalker(ch Chain, st Store, cfg WalkerConfig) *Walker {
	set := make(map[common.Address]struct{}, len(cfg.Addresses))
	for _, a := range cfg.Addresses {
		set[a] = struct{}{}
	}
	return &Walker{chain: ch, store: st, cfg: cfg, addrSet: set}
}

// Step performs one bounded unit of work: a reorg check + at most one
// getLogs window. Returns advanced=false when caught up to the safe head.
//
// Residual TOCTOU: a fork landing between the pre-save cursor recheck and
// SaveBatch can still persist stale rows, but it is caught by the NEXT
// Step's cursor check + verified-ancestor rewind. Trust assumptions:
// per-Step endpoint affinity comes from the failover client's sticky-active
// routing (documented, not enforced here), and a successful-but-incomplete
// getLogs response is trusted — inherent to the RPC model. Deferred
// hardening: per-block header verification of every returned log,
// receipt-membership proofs, and a distinct-hash-per-height store invariant
// check are deliberate deferrals to the derivation layer's health checks;
// the provider is trusted to return internally consistent responses beyond
// the batch-coherence checks enforced here.
func (w *Walker) Step(ctx context.Context) (bool, error) {
	head, err := w.chain.BlockNumber(ctx)
	if err != nil {
		return false, fmt.Errorf("head: %w", err)
	}
	if head < w.cfg.Confirmations {
		return false, nil
	}
	safe := head - w.cfg.Confirmations

	cur, err := w.store.Cursor(ctx, w.cfg.Stream)
	if err != nil {
		return false, fmt.Errorf("cursor: %w", err)
	}

	var next uint64 // first block of the next window
	if cur == nil {
		next = w.cfg.StartBlock
	} else {
		// Reorg check must run before the caught-up return: a mismatched
		// cursor needs rewinding even when there is nothing new to ingest.
		chainHash, err := w.chain.HeaderHash(ctx, cur.Block)
		if err != nil {
			return false, fmt.Errorf("reorg check header %d: %w", cur.Block, err)
		}
		if !bytes.Equal(chainHash.Bytes(), cur.Hash) {
			return w.rewindToVerifiedAncestor(ctx, cur)
		}
		// Caught-up check BEFORE computing next: a cursor at MaxUint64 would
		// wrap next to 0 and silently restart the walk from genesis.
		if cur.Block >= safe {
			return false, nil
		}
		next = cur.Block + 1
	}

	if next > safe {
		return false, nil
	}
	// Overflow-safe window cap: compare distances instead of computing
	// next+Window-1 first (safe >= next holds after the return above;
	// Window >= 1 is enforced by config validation).
	to := safe
	if delta := safe - next; delta > w.cfg.Window-1 {
		to = next + w.cfg.Window - 1
	}

	// Coherent-window fetch: pin the tip hash on both sides of getLogs so a
	// mid-fetch reorg cannot anchor the cursor to a hash the logs never
	// belonged to.
	tipBefore, err := w.chain.HeaderHash(ctx, to)
	if err != nil {
		return false, fmt.Errorf("tip header %d: %w", to, err)
	}
	logs, err := w.chain.Logs(ctx, next, to, w.cfg.Addresses)
	if err != nil {
		return false, fmt.Errorf("logs [%d,%d]: %w", next, to, err)
	}
	tipAfter, err := w.chain.HeaderHash(ctx, to)
	if err != nil {
		return false, fmt.Errorf("tip header recheck %d: %w", to, err)
	}
	if tipAfter != tipBefore {
		slog.Warn("tip changed mid-fetch, discarding window",
			"stream", w.cfg.Stream, "block", to,
			"before", tipBefore, "after", tipAfter)
		return false, nil // chain moved mid-fetch; next tick retries
	}
	if cur != nil {
		// Re-check the cursor ancestor: a reorg below the window during the
		// fetch would splice this batch onto a dead fork.
		recheck, err := w.chain.HeaderHash(ctx, cur.Block)
		if err != nil {
			return false, fmt.Errorf("cursor recheck header %d: %w", cur.Block, err)
		}
		if !bytes.Equal(recheck.Bytes(), cur.Hash) {
			slog.Warn("cursor hash changed mid-step, discarding window",
				"stream", w.cfg.Stream, "block", cur.Block)
			return false, nil // reorg mid-Step; next Step's check rewinds
		}
	}

	// Validate every log before conversion: any violation aborts the whole
	// batch — nothing is saved. Byte-identical duplicates are the one
	// exception: they are coalesced, not fatal.
	type logKey struct {
		tx    common.Hash
		index uint
	}
	hashAt := map[uint64][]byte{}                 // fork consistency: one hash per height
	seen := make(map[logKey]types.Log, len(logs)) // duplicate identity: (TxHash, Index)
	deduped := logs[:0:0]
	for _, l := range logs {
		if l.Removed {
			return false, fmt.Errorf("log %s/%d: provider returned removed log", l.TxHash, l.Index)
		}
		if l.BlockNumber < next || l.BlockNumber > to {
			return false, fmt.Errorf("log %s/%d: block %d outside requested window [%d,%d]",
				l.TxHash, l.Index, l.BlockNumber, next, to)
		}
		if _, ok := w.addrSet[l.Address]; !ok {
			return false, fmt.Errorf("log %s/%d: address %s not in the configured address set",
				l.TxHash, l.Index, l.Address)
		}
		// Store column is INT: reject before the uint32 narrowing below.
		if l.Index > math.MaxInt32 {
			return false, fmt.Errorf("log %s/%d: log index exceeds int32 range", l.TxHash, l.Index)
		}
		// Fork consistency: every log in the batch at the same height must
		// carry the same block hash.
		if prev, ok := hashAt[l.BlockNumber]; ok {
			if !bytes.Equal(prev, l.BlockHash.Bytes()) {
				return false, fmt.Errorf("mixed block hashes at height %d — fork-inconsistent getLogs response", l.BlockNumber)
			}
		} else {
			hashAt[l.BlockNumber] = l.BlockHash.Bytes()
		}
		// Logs at the window tip must sit on the fork the cursor is being
		// anchored to.
		if l.BlockNumber == to && l.BlockHash != tipBefore {
			return false, fmt.Errorf("log %s/%d: log at window tip does not match anchored tip hash", l.TxHash, l.Index)
		}
		// Duplicate identity keyed (TxHash, Index): byte-identical copies are
		// coalesced; any field diverging is a protocol violation.
		k := logKey{tx: l.TxHash, index: l.Index}
		if prev, ok := seen[k]; ok {
			if reflect.DeepEqual(prev, l) {
				continue // coalesce byte-identical duplicate
			}
			return false, fmt.Errorf("conflicting duplicate log %x/%d", l.TxHash, l.Index)
		}
		seen[k] = l
		deduped = append(deduped, l)
	}
	logs = deduped

	raw := make([]store.RawLog, len(logs))
	for i, l := range logs {
		topics := make([][]byte, len(l.Topics))
		for j, t := range l.Topics {
			topics[j] = t.Bytes()
		}
		data := make([]byte, len(l.Data))
		copy(data, l.Data)
		raw[i] = store.RawLog{
			ChainID:     w.cfg.ChainID,
			BlockNumber: l.BlockNumber,
			BlockHash:   l.BlockHash.Bytes(),
			TxHash:      l.TxHash.Bytes(),
			LogIndex:    uint32(l.Index),
			Address:     l.Address.Bytes(),
			Topics:      topics,
			Data:        data,
		}
	}
	// Anchor the cursor to tipBefore (== tipAfter): the hash observed on
	// both sides of the fetch, so cursor and logs describe the same fork.
	if err := w.store.SaveBatch(ctx, w.cfg.Stream, w.cfg.ChainID, raw, to, tipBefore.Bytes()); err != nil {
		return false, fmt.Errorf("save batch: %w", err)
	}
	return true, nil
}

// rewindToVerifiedAncestor walks stored logs downward from the mismatched
// cursor until one's block hash matches the live chain. Forks are suffixes:
// a single stored log whose hash matches the live header proves every stored
// row at or below it is canonical, so rewinding there is safe at any fork
// depth — unlike a fixed-distance rewind, which silently blesses stale rows
// below its target when the fork is deeper.
func (w *Walker) rewindToVerifiedAncestor(ctx context.Context, cur *store.CursorPos) (bool, error) {
	var (
		target     uint64
		targetHash []byte
		verified   bool
	)
	// fullRewalk targets StartBlock-1 (or 0 in the degenerate StartBlock==0
	// case) so the next Step re-ingests the stream's entire range.
	fullRewalk := func() error {
		at := uint64(0)
		if w.cfg.StartBlock > 0 {
			at = w.cfg.StartBlock - 1
		}
		h, err := w.chain.HeaderHash(ctx, at)
		if err != nil {
			return fmt.Errorf("rewind header %d: %w", at, err)
		}
		target, targetHash, verified = at, h.Bytes(), false
		return nil
	}

	if cur.Block == 0 {
		if err := fullRewalk(); err != nil {
			return false, err
		}
	} else {
		probe := cur.Block - 1 // fork point is at or below cur.Block
		for {
			b, storedHash, found, err := w.store.HighestLogAtOrBelow(ctx, w.cfg.ChainID, probe)
			if err != nil {
				return false, fmt.Errorf("highest log at or below %d: %w", probe, err)
			}
			if !found {
				// Nothing stored below the probe — nothing to verify against.
				if err := fullRewalk(); err != nil {
					return false, err
				}
				break
			}
			liveHash, err := w.chain.HeaderHash(ctx, b)
			if err != nil {
				return false, fmt.Errorf("rewind header %d: %w", b, err)
			}
			if bytes.Equal(liveHash.Bytes(), storedHash) {
				// PROVEN canonical: stored == live. Anchor to the stored
				// hash — it is the hash the surviving rows were saved under.
				// A verified match is accepted even below this stream's
				// StartBlock: a hash match is a chain-canonical proof, and
				// clamping the target up to an unverified height would anchor
				// sibling cursors to unverified (possibly post-fork) hashes.
				// The cost of a deep verified target is a bounded sibling
				// re-walk, not corruption.
				target, targetHash, verified = b, storedHash, true
				break
			}
			if b == 0 || b <= w.cfg.StartBlock {
				// Fork extends past everything verifiable in this range.
				if err := fullRewalk(); err != nil {
					return false, err
				}
				break
			}
			probe = b - 1
		}
	}

	if err := w.store.Rewind(ctx, w.cfg.Stream, w.cfg.ChainID, target, targetHash); err != nil {
		return false, fmt.Errorf("rewind: %w", err)
	}
	slog.Warn("reorg detected, rewound to verified ancestor",
		"stream", w.cfg.Stream, "from", cur.Block, "to", target, "verified", verified)
	return true, nil // rewound; next Step re-ingests
}
