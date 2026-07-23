// Package derive turns decoded chain events into position events — the
// engine-specific state-transition layer between decode and the store's
// derived tables. One Engine per lending engine; derivation ordering and
// persistence are the runner's job (plan Task 7), not the engines'.
package derive

import (
	"context"
	"math/big"

	"github.com/kaselunt/solvent/internal/decode"
	"github.com/kaselunt/solvent/internal/store"
)

// StateReader is the engines' window onto COMMITTED derived state. Production
// use passes *store.Store directly (compile-checked below); tests pass fakes.
type StateReader interface {
	// NormalizedDebt / ScaledBalance style lookups against COMMITTED state.
	// A no-row result MEANS ZERO and is trustworthy ONLY because derivation
	// always begins at genesis (migration seeds + full replay); the reader
	// must return an error (not zero) when the store is unreachable.
	BalancesFor(ctx context.Context, engine string, account []byte) (map[string]map[string]*big.Int, error)
}

// store.Store satisfies StateReader as-is — the lifecycle deliberately reuses
// the store's existing public API rather than growing a parallel one.
var _ StateReader = (*store.Store)(nil)

// Engine maps decoded logs to position events under an attempt-scoped state
// lifecycle. Process MUST be deterministic (same log + same prior state ⇒
// same events, same Seq ordering) — replay identity is what makes derived
// state rebuildable.
//
// INTERFACE AMENDED (deriver-lifecycle wave; controller-authorized unfreeze
// of the Task 5-7 freeze). The new contract, which Task 7's runner compiles
// against, is the batch lifecycle:
//
//	BeginBatch → Process* → store.ApplyDerived → CommitBatch (tx committed)
//	                                           ↘ DiscardBatch (tx failed)
//	store.RewindDerived → Reset (then the next BeginBatch re-hydrates)
//
// Engines keep TWO state layers: a promoted layer mirroring committed truth
// and a working overlay holding the current attempt's mutations. Absence of
// an account in committed state mechanically means zero (post-genesis
// invariant: derivation always starts at genesis), so first-touch hydration
// through the StateReader — never an in-memory seed map — is the sole
// warm-start path.
type Engine interface {
	Name() string
	// BeginBatch starts an attempt: working state is hydrated lazily from
	// reader on first touch of each account (committed truth), layered over
	// any promoted in-memory state. Process mutations land in the working
	// layer only.
	BeginBatch(ctx context.Context, reader StateReader) error
	Process(l store.RawLog, d decode.Event) ([]store.PositionEvent, error)
	// CommitBatch promotes the working layer after the runner's ApplyDerived
	// transaction has committed. DiscardBatch drops it (persistence failure).
	CommitBatch()
	DiscardBatch()
	// Reset drops ALL in-memory state (after RewindDerived / reorg): the next
	// BeginBatch re-hydrates from committed truth.
	Reset()
}
