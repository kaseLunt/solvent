package riskfeed

// The ENGINE-REFUSAL VOCABULARY, closed — and pinned against the migration that
// spells one of its codes as a SQL literal.
//
// Migration 00014 backfills pre-existing Aave rollups with 'FLAG_CUSTODY_UNPROVEN'
// so a legacy batch cannot read as affirmed-healthy. That literal cannot import a Go
// constant, so the coupling is real and silent: renaming the constant here would
// leave the migration writing a code no consumer recognizes, and a legacy batch would
// quietly become healthy again.
//
// This test is the seam's guard. It also enumerates which ENGINES the migration's
// scoping decision covers, so a second absence-reading engine cannot be added without
// a decision about the backfill.

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/kaselunt/solvent/internal/risk"
)

// engineRefusalCodes is every code Assemble can put on a RiskEngineAggregate.
//
// Engine refusals are deliberately a SMALL closed set: they withhold a whole book,
// so each one has to be justified. Per-position gate codes (G1-G5, SWEEP_NEVER,
// ENGINE, STORE_UNREADABLE) are NOT in this set — they refuse one row.
var engineRefusalCodes = map[string]string{
	GateFlagCustodyUnproven: "the engine's derived ledger cannot be shown to have been walked from " +
		"its start block under a decode registry that recognizes the events whose ABSENCE a law reads as truth",
}

// absenceReadingEngines are the engines whose laws read a missing row as a chain
// fact, and therefore the engines whose legacy rollups migration 00014 must refuse.
//
// The Debt Manager is deliberately ABSENT: a missing param row there already refuses
// per position (ErrMissingParam on a counting collateral token), so its legacy
// rollups are not unproven and blanket-refusing them would withhold a correct book.
var absenceReadingEngines = []string{risk.AaveEngine}

func TestEngineRefusalVocabularyIsClosed(t *testing.T) {
	for code, why := range engineRefusalCodes {
		require.NotEmpty(t, code)
		require.NotEmpty(t, why, "engine refusal %q carries no justification", code)
	}
	// The set is exactly one today. Growing it is allowed — adding a member without
	// a justification, or without revisiting migration 00014's backfill scope, is not.
	require.Len(t, engineRefusalCodes, 1,
		"a new ENGINE-scoped refusal withholds a whole book: justify it here, and decide "+
			"whether migration 00014's legacy backfill must cover it too")
	require.Contains(t, engineRefusalCodes, GateFlagCustodyUnproven)
}

// TestMigration00014BackfillMatchesTheGoVocabulary reads the migration and requires
// its literals to agree with this package's constants.
//
// MUTANT THIS KILLS: rename GateFlagCustodyUnproven's VALUE without editing the
// migration. Every other test still passes — and every legacy Aave batch silently
// reverts to reading healthy, because the backfilled code no longer matches anything
// a consumer checks for.
func TestMigration00014BackfillMatchesTheGoVocabulary(t *testing.T) {
	path := filepath.Join("..", "store", "migrations", "00014_derive_coverage.sql")
	raw, err := os.ReadFile(path)
	require.NoError(t, err, "reading %s", path)
	sql := string(raw)

	require.Contains(t, sql, "refusal_code   = '"+GateFlagCustodyUnproven+"'",
		"migration 00014's legacy backfill must write the SAME code riskfeed emits (%s)", GateFlagCustodyUnproven)

	for _, engine := range absenceReadingEngines {
		require.Contains(t, sql, "WHERE engine = '"+engine+"'",
			"engine %s reads absence as truth, so its legacy rollups must be backfilled as refused", engine)
	}
	require.NotContains(t, sql, "'"+risk.DMEngine+"'",
		"the Debt Manager must NOT be in the backfill: its legacy rollups are not unproven, "+
			"and refusing them would withhold a correct book")

	// The backfill must be an UPDATE scoped by engine, not a blanket one — a
	// predicate-free UPDATE would refuse every engine's history.
	require.Contains(t, sql, "UPDATE risk_batch_aggregates")
	idx := strings.Index(sql, "UPDATE risk_batch_aggregates")
	require.Contains(t, sql[idx:], "WHERE engine =",
		"the legacy backfill must carry an engine predicate")
}
