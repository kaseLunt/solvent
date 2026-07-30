package store

// DERIVATION-COVERAGE PROVENANCE: what code derived the state, and from where.
//
// The derive cursor answers "how far has this engine derived". It cannot answer
// "was the walk that produced this state able to decode the events I am about to
// interpret the ABSENCE of" — and that second question became load-bearing the
// moment a derived law started reading absence as chain truth.
//
// `internal/riskfeed`'s collateral law reads "no ReserveUsedAsCollateral* event
// for this (reserve, user)" as the chain fact "never enabled as collateral". That
// is exact under genesis-complete flag custody, and WRONG — in the false-alarm
// direction — without it: a database derived by a binary that predates the flag
// events' registration carries a cursor at head and an EMPTY flag ledger, because
// the decode registry's contract for an unknown topic0 is a SILENT skip. Reading
// that emptiness as truth publishes zero counted collateral, and health factor
// zero, for borrowers who are perfectly healthy.
//
// This file is the durable evidence that separates the two states. It is not a
// runbook note, not an operator attestation, and not a config flag: it is written
// by the walk itself, so it cannot be set while the thing it claims is false.

// DerivationCoverage is what one derivation window ASSERTS about its own
// provenance. It is persisted onto derive_cursors by ApplyDerivedWindow
// (migration 00014).
//
// # Set by the WALK, never by an operator
//
// The runner supplies the window's own `from` and the decode revision the binary
// is actually running — neither is configurable. A rewind-and-rederive from
// StartBlock−1 therefore re-establishes coverage as a SIDE EFFECT of completing,
// which is the only kind of marker whose presence is evidence rather than a
// promise. There is no code path that stamps coverage without walking the range
// it names.
type DerivationCoverage struct {
	// FromBlock is the first block of THIS window. ApplyDerivedWindow's merge rule
	// turns a sequence of windows into one contiguous covered range.
	FromBlock uint64
	// DecoderRevision is internal/decode.RegistryRevision for the running binary.
	//
	// Zero means "this caller declines to assert coverage" — the honest default
	// for a fixture, a tool, or an upgrade path, and it reads downstream as
	// UNPROVEN. Fail-closed is the only safe direction here: a caller that does
	// not know what it walked must not be able to vouch for it.
	DecoderRevision int32
}

// Asserts reports whether this coverage carries a usable claim at all.
func (c DerivationCoverage) Asserts() bool { return c.DecoderRevision > 0 }

// CoverageProvenBack reports whether cursor state proves the current derived
// state was walked from at or below `genesisBlock` under a decode registry at or
// above `minDecoderRevision`.
//
// It lives here, beside the type, so every consumer of the precondition asks the
// same question the same way. Both legs are required and both fail CLOSED:
//
//   - an unknown covered-from (nil) is not "from genesis", it is "unknown";
//   - a revision below the requirement means the walk could not decode the events
//     whose absence the caller is about to read as truth;
//   - a genesisBlock of 0 is refused rather than trivially satisfied, because an
//     unconfigured genesis would otherwise make every engine look proven.
func CoverageProvenBack(coveredFrom *uint64, decoderRevision int32, genesisBlock uint64, minDecoderRevision int32) bool {
	if genesisBlock == 0 || minDecoderRevision <= 0 {
		return false
	}
	if coveredFrom == nil || decoderRevision < minDecoderRevision {
		return false
	}
	return *coveredFrom <= genesisBlock
}
