package store

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"sort"
	"strings"
)

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
	// Binding identifies WHAT WAS WALKED: a digest over the engine's chain and the
	// (address, startBlock) pairs of its streams. See CoverageBindingOf.
	//
	// FromBlock and DecoderRevision together answer "from when, by which decoder".
	// They cannot answer "over which contracts", and that gap was a live hole: an
	// operator who ADDS an Aave aToken stream at the audited genesis leaves the engine
	// cursor at head, so the runner never walks history for the new address -- it
	// resumes at H+1 -- while the inherited covered_from_block still reads "genesis"
	// under an unchanged decoder revision. Every existing gate passed, and riskd would
	// serve a book missing the new stream's entire history without refusing.
	//
	// Empty means "no claim", exactly as DecoderRevision 0 does.
	Binding string
}

// Asserts reports whether this coverage carries a usable claim at all.
//
// All three legs are required. A caller that knows the block and the decoder but not
// the stream set does not know what it walked.
func (c DerivationCoverage) Asserts() bool { return c.DecoderRevision > 0 && c.Binding != "" }

// CoverageStream is one walked (address, startBlock) pair -- the atom of a coverage
// binding. It is deliberately NOT a stream NAME: a rename is cosmetic and must not
// force a re-derivation, while an address or a start block is exactly what
// determines which logs exist in custody.
type CoverageStream struct {
	Address    []byte
	StartBlock uint64
}

// CoverageBindingOf is the deterministic identity of an engine's WALKED SURFACE: its
// chain plus the sorted, deduplicated set of (address, startBlock) pairs.
//
// It must be REPRODUCIBLE FROM CONFIG, because that is what makes it checkable. The
// deriver stamps the binding it actually walked; every reader recomputes the binding
// the live configuration implies and demands they match. A stream added, removed,
// re-addressed or re-based changes the digest, and that mismatch is what forces a
// rewind-and-rederive instead of letting inherited coverage vouch for a surface it
// never saw.
//
// Sorting and dedup make it order- and duplication-insensitive, so two honest
// spellings of the same configuration agree -- otherwise a config reformat would
// demand a needless replay.
func CoverageBindingOf(chainID uint64, streams []CoverageStream) string {
	if len(streams) == 0 {
		// No streams is not a surface; an empty binding reads as "no claim" rather
		// than as a claim about nothing.
		return ""
	}
	parts := make([]string, 0, len(streams))
	seen := make(map[string]bool, len(streams))
	for _, st := range streams {
		part := fmt.Sprintf("%x@%d", st.Address, st.StartBlock)
		if seen[part] {
			continue
		}
		seen[part] = true
		parts = append(parts, part)
	}
	sort.Strings(parts)
	sum := sha256.Sum256([]byte(fmt.Sprintf("coverage-binding/v1;chain=%d;%s",
		chainID, strings.Join(parts, ","))))
	return hex.EncodeToString(sum[:])
}

// CoverageClaim is what the database says about the current derived state.
type CoverageClaim struct {
	CoveredFromBlock *uint64
	DecoderRevision  int32
	Binding          string
}

// CoverageRequirement is what a consumer demands before it may read ABSENCE as chain
// truth.
type CoverageRequirement struct {
	// GenesisBlock is the block the walk must reach at or below.
	GenesisBlock uint64
	// MinDecoderRevision is the registry revision that must have been in force.
	MinDecoderRevision int32
	// Binding is the walked surface the LIVE configuration implies.
	Binding string
}

// Satisfies reports whether the persisted claim licenses the requirement.
//
// It lives here, beside the types, so every consumer of the precondition asks the
// same question the same way. FOUR legs, all required, all failing CLOSED:
//
//   - an unknown covered-from (nil) is not "from genesis", it is "unknown";
//   - a revision below the requirement means the walk could not decode the events
//     whose absence the caller is about to read as truth;
//   - a binding that DIFFERS means the walk covered a different set of contracts
//     than the one now configured, and inherited coverage cannot vouch for an
//     address it never read;
//   - a zero-valued requirement (genesis 0, revision <= 0, or empty binding) is
//     REFUSED rather than trivially satisfied, because an unwired requirement would
//     otherwise make every engine look proven.
func (c CoverageClaim) Satisfies(req CoverageRequirement) bool {
	if req.GenesisBlock == 0 || req.MinDecoderRevision <= 0 || req.Binding == "" {
		return false
	}
	if c.CoveredFromBlock == nil || c.DecoderRevision < req.MinDecoderRevision {
		return false
	}
	if c.Binding != req.Binding {
		return false
	}
	return *c.CoveredFromBlock <= req.GenesisBlock
}
