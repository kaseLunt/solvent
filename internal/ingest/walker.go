package ingest

import (
	"bytes"
	"context"
	"fmt"
	"log/slog"

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
}

func NewWalker(ch Chain, st Store, cfg WalkerConfig) *Walker {
	return &Walker{chain: ch, store: st, cfg: cfg}
}

// Step performs one bounded unit of work: a reorg check + at most one
// getLogs window. Returns advanced=false when caught up to the safe head.
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
		chainHash, err := w.chain.HeaderHash(ctx, cur.Block)
		if err != nil {
			return false, fmt.Errorf("reorg check header %d: %w", cur.Block, err)
		}
		if !bytes.Equal(chainHash.Bytes(), cur.Hash) {
			target := w.cfg.StartBlock
			if back := cur.Block - min(cur.Block, 2*w.cfg.Confirmations); back > target {
				target = back
			}
			targetHash, err := w.chain.HeaderHash(ctx, target)
			if err != nil {
				return false, fmt.Errorf("rewind header %d: %w", target, err)
			}
			slog.Warn("reorg detected, rewinding",
				"stream", w.cfg.Stream, "from", cur.Block, "to", target)
			if err := w.store.Rewind(ctx, w.cfg.Stream, w.cfg.ChainID, target, targetHash.Bytes()); err != nil {
				return false, fmt.Errorf("rewind: %w", err)
			}
			return true, nil // rewound; next Step re-ingests
		}
		next = cur.Block + 1
	}

	if next > safe {
		return false, nil
	}
	to := next + w.cfg.Window - 1
	if to > safe {
		to = safe
	}

	logs, err := w.chain.Logs(ctx, next, to, w.cfg.Addresses)
	if err != nil {
		return false, fmt.Errorf("logs [%d,%d]: %w", next, to, err)
	}
	tipHash, err := w.chain.HeaderHash(ctx, to)
	if err != nil {
		return false, fmt.Errorf("tip header %d: %w", to, err)
	}

	raw := make([]store.RawLog, len(logs))
	for i, l := range logs {
		topics := make([][]byte, len(l.Topics))
		for j, t := range l.Topics {
			topics[j] = t.Bytes()
		}
		raw[i] = store.RawLog{
			ChainID:     w.cfg.ChainID,
			BlockNumber: l.BlockNumber,
			BlockHash:   l.BlockHash.Bytes(),
			TxHash:      l.TxHash.Bytes(),
			LogIndex:    uint32(l.Index),
			Address:     l.Address.Bytes(),
			Topics:      topics,
			Data:        l.Data,
		}
	}
	if err := w.store.SaveBatch(ctx, w.cfg.Stream, w.cfg.ChainID, raw, to, tipHash.Bytes()); err != nil {
		return false, fmt.Errorf("save batch: %w", err)
	}
	return true, nil
}
