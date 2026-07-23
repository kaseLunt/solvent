// Package derive turns decoded chain events into position events — the
// engine-specific state-transition layer between decode and the store's
// derived tables. One Engine per lending engine; derivation ordering and
// persistence are the runner's job (plan Task 7), not the engines'.
//
// TERMINOLOGY: "the runner" throughout this package refers to Task 7's
// PLANNED runner, which does not exist yet (internal/derive/runner.go is
// unwritten). Every reference to what "the runner" does, persists, provides,
// or uses is prospective contract language — obligations the runner must
// satisfy when built — not a claim that such wiring exists today.
package derive

import (
	"context"
	"math/big"

	"github.com/kaselunt/solvent/internal/decode"
	"github.com/kaselunt/solvent/internal/store"
)

// StateReader is the engines' window onto COMMITTED derived state. Production
// use will pass *store.Store directly (interface satisfaction is
// compile-checked below today); tests pass fakes.
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
// of the Task 5-7 freeze). The new contract, which Task 7's planned runner
// must compile against once it exists, is the batch lifecycle:
//
//	BeginBatch → Process* → store.ApplyDerived → CommitBatch (nil error)
//	                     ↘ DiscardBatch (Process error mid-batch:
//	                       ApplyDerived was provably never called)
//	store.ApplyDerived error (ANY) → Reset (commit indeterminacy, below)
//	store.RewindDerived → Reset (then the next BeginBatch re-hydrates)
//
// COMMIT INDETERMINACY RULE: ApplyDerived returns its transaction Commit's
// error verbatim, and Postgres can COMMIT while the acknowledgment is lost
// to a connection failure — an ApplyDerived error therefore does NOT mean
// the batch failed to persist; the runner cannot know. The rule is: any
// ApplyDerived error → Engine.Reset(), NEVER DiscardBatch. Reset drops all
// layers and the next BeginBatch re-hydrates from committed truth, which is
// correct whether or not the tx landed; DiscardBatch would keep the
// pre-batch promoted layer (and hydration marks) while committed truth —
// and the derive cursor — may have advanced, silently desyncing engine
// memory from the store. DiscardBatch is reserved for failures the runner
// KNOWS never reached ApplyDerived (a Process error mid-batch), where
// committed truth provably did not move. Pinned by
// TestIndeterminateCommitResetRehydratesExact and
// TestIndeterminateCommitDiscardDesyncs (live store).
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
	// returned nil. DiscardBatch drops it — ONLY for failures that provably
	// never reached ApplyDerived (a Process error mid-batch); an ApplyDerived
	// ERROR must be answered with Reset, never DiscardBatch (commit
	// indeterminacy — see the lifecycle above).
	CommitBatch()
	DiscardBatch()
	// Reset drops ALL in-memory state (after RewindDerived / reorg): the next
	// BeginBatch re-hydrates from committed truth.
	Reset()
}
