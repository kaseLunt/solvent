package main

// The SERVE-TIME SCALE WELD, end to end (Codex round 6 [HIGH], wave H7).
//
// The finding: a debt-only Debt Manager position (nonzero debt, a successful
// sweep that observed EMPTY collateral) consults no price witnesses, so the
// revision-4 assembler inferred value_decimals 0 from the empty witness set
// and persisted it — 44 rows in live batch 3 — serving $0.000001 of USD-6
// debt as $1 per raw unit (10^6 overstatement). Reconstruction verified the
// debt SUM but never the SCALE, so the serving surface passed the row through.
//
// Two tests, one per direction of the weld:
//
//   - the CORRECTED shape (value_decimals 6) is served computed, and its scale
//     agrees with the engine aggregate's declared scale on /v1/book;
//   - the PRE-FIX shape (value_decimals 0) is REFUSED at serve time with
//     API_RECONSTRUCTION_MISMATCH — never served as a computed row.

import (
	"math/big"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/kaselunt/solvent/internal/risk"
	"github.com/kaselunt/solvent/internal/store"
)

// seedDebtOnlyBatch writes the fixture batch PLUS the debt-only DM position at
// the given value_decimals, through store.WriteRiskBatch — the same writer
// riskd uses, so the seeded state is one a daemon can actually produce (the
// pre-fix daemon DID produce the scale-0 shape, live).
func seedDebtOnlyBatch(t *testing.T, f *apiFixture, key string, valueDecimals int16) {
	t.Helper()
	w := fxBatchWrite(key)
	p := fxDMDebtOnlyPosition()
	p.ValueDecimals = valueDecimals
	w.Positions = append(w.Positions, toWrite(p))
	for i := range w.Aggregates {
		if w.Aggregates[i].Engine == risk.DMEngine {
			// The aggregate's scale is DECLARED (6) — exactly as riskd's
			// aggregate() hardcodes it — which is what made the live defect a
			// self-contradiction: rows at 0 summed into a rollup at 6.
			w.Aggregates[i].Positions++
			w.Aggregates[i].ComputedPositions++
			w.Aggregates[i].LiquidatablePositions++
			w.Aggregates[i].TotalDebt = new(big.Int).Add(w.Aggregates[i].TotalDebt, bi(fxDMDebtOnlyBorrowings))
		}
	}
	id, err := f.store.WriteRiskBatch(f.ctx, w)
	require.NoError(t, err)
	require.Positive(t, id)
	f.batchID = id
}

func TestAddressServesDebtOnlyDMPositionAtTheStructuralScale(t *testing.T) {
	f := newBareAPIFixture(t)
	f.seedSubstrate(t)
	seedDebtOnlyBatch(t, f, "wave-h7-debt-only-good", 6)
	f.startServer(t)

	body := f.getJSON(t, "/v1/address/"+fxAcctDMDebt.Hex(), "/v1/address/{addr}")
	positions := arr(t, body, "positions")
	require.Len(t, positions, 1)
	p := positions[0].(map[string]any)
	require.Equal(t, risk.DMEngine, str(t, p, "engine"))
	require.Equal(t, store.RiskPositionComputed, str(t, p, "status"),
		"the corrected shape reconstructs and verifies; it is served as computed")
	require.EqualValues(t, 6, num(t, p, "value_decimals"))
	require.Equal(t, fxDMDebtOnlyBorrowings, str(t, p, "borrowings"),
		"borrowings 1000000000 under value_decimals 6 is $1,000 — the honest reading")
	require.Equal(t, "0", str(t, p, "collateral_value_usd"))

	// The served row's scale must AGREE with the engine aggregate's declared
	// scale — the batch-level number the same borrowings are summed into.
	book := f.getJSON(t, "/v1/book", "/v1/book")
	dm := byKey(t, arr(t, book, "engines"), "engine", risk.DMEngine)
	require.EqualValues(t, num(t, dm, "value_decimals"), num(t, p, "value_decimals"),
		"one figure, one meaning: the position's scale and its aggregate's scale are the same declaration")
}

func TestWrongScaleDMPositionIsRefusedAtServeTimeNeverServed(t *testing.T) {
	f := newBareAPIFixture(t)
	f.seedSubstrate(t)
	// Byte-for-byte the live defect: the revision-4 assembler's persisted
	// output for a debt-only account — value_decimals 0 over USD-6 borrowings.
	seedDebtOnlyBatch(t, f, "wave-h7-debt-only-prefix", 0)
	f.startServer(t)

	body := f.getJSON(t, "/v1/address/"+fxAcctDMDebt.Hex(), "/v1/address/{addr}")
	positions := arr(t, body, "positions")
	require.Len(t, positions, 1, "the row is REFUSED, not omitted — a dropped row reads as `no risk here`")
	p := positions[0].(map[string]any)
	require.Equal(t, store.RiskPositionRefused, str(t, p, "status"),
		"a DM row whose value_decimals differs from the engine's declared USD-6 must never be served as computed")
	require.Equal(t, refusalReconstruction, str(t, p, "refusal", "code"))
}
