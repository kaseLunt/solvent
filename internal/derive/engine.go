// Package derive turns decoded chain events into position events — the
// engine-specific state-transition layer between decode and the store's
// derived tables. One Engine per lending engine; derivation ordering and
// persistence are the runner's job (plan Task 7), not the engines'.
package derive

import (
	"github.com/kaselunt/solvent/internal/decode"
	"github.com/kaselunt/solvent/internal/store"
)

// Engine maps one decoded log to zero or more position events. Process MUST
// be deterministic (same log + same prior state ⇒ same events, same Seq
// ordering) — replay identity is what makes derived state rebuildable.
// FROZEN INTERFACE (plan Tasks 5-7 compile against it): do not extend.
type Engine interface {
	Name() string
	Process(l store.RawLog, d decode.Event) ([]store.PositionEvent, error)
}
