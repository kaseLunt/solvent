package riskfeed

import (
	"math/big"
	"testing"
	"time"

	"github.com/stretchr/testify/require"

	"github.com/kaselunt/solvent/internal/risk"
	"github.com/kaselunt/solvent/internal/store"
)

const fixtureOracleSource = "aaveoracle:0x43b64f28a678944e0655404b0b98e443851cc34f"

func TestProvenanceClassMapping(t *testing.T) {
	for _, tc := range []struct{ source, want string }{
		{"priceproviderv2", risk.ProvenanceEngineExact},
		{fixtureOracleSource, risk.ProvenanceAdapterOutput},
		{"chainlink:0x7d4e742018fb52e48b08be73d041c18b21de6fb5", risk.ProvenanceUncappedFeed},
		{"ratio:getrate:0xcd5fe23c85820f7b72d0926fc9b05b43e359b7ee", risk.ProvenanceRatioReference},
	} {
		got, err := ProvenanceClass(tc.source)
		require.NoError(t, err, tc.source)
		require.Equal(t, tc.want, got, tc.source)
	}

	_, err := ProvenanceClass("someone-invented-a-source")
	require.ErrorIs(t, err, ErrUnknownProvenance)
}

// TestValuationClassesExcludeTheUncappedFeed is the Aave custody law in one
// assertion: the raw aggregator stream is NEVER a valuation input, because it
// equals the adapter's output only while no cap binds — and caps bind exactly in
// the scenarios a liquidation engine cares about.
func TestValuationClassesExcludeTheUncappedFeed(t *testing.T) {
	require.True(t, IsValuationClass(risk.ProvenanceAdapterOutput))
	require.True(t, IsValuationClass(risk.ProvenanceEngineExact))
	require.False(t, IsValuationClass(risk.ProvenanceUncappedFeed))
	require.False(t, IsValuationClass(risk.ProvenanceRatioReference))
}

func priceKey(source string) store.RiskPriceKey {
	return store.RiskPriceKey{ChainID: 1, Asset: weETH.Bytes(), Source: source}
}

func usableRow(value string, asOf time.Time) *store.RiskPriceRow {
	return &store.RiskPriceRow{
		ChainID: 1, Asset: weETH.Bytes(), Source: fixtureOracleSource,
		Value: bi(value), Decimals: 8, BlockNumber: 25_635_618,
		ObservedAt:    asOf.Add(90 * time.Second), // insertion LAGS the chain time
		HasSourceAsOf: true, SourceAsOf: asOf,
	}
}

var budget = PriceBudget{Seconds: 180}

func TestPriceBudgetCeilingIsTwiceTheBudget(t *testing.T) {
	require.EqualValues(t, 360, budget.Ceiling())
}

func TestJudgeFreshInput(t *testing.T) {
	now := time.Date(2026, 7, 29, 12, 0, 0, 0, time.UTC)
	j, err := JudgePriceInput(weETH, priceKey(fixtureOracleSource),
		usableRow("300000000000", now.Add(-30*time.Second)), budget, now, nil, 2000, false)
	require.NoError(t, err)
	require.True(t, j.Usable)
	require.Empty(t, j.Gate)
	require.Empty(t, j.Flags())
	require.Equal(t, VerdictFresh, j.Snapshot.Verdict)
	require.True(t, j.Input.Fresh)
	require.Equal(t, risk.ProvenanceAdapterOutput, j.Input.Provenance)
	require.EqualValues(t, 30, *j.Snapshot.AgeSeconds)
	require.EqualValues(t, 180, j.Snapshot.BudgetSeconds, "the verdict is disclosed WITH the budget it was judged against")
}

// TestJudgeStaleWithinCeilingComputesAndFlags — G4.
func TestJudgeStaleWithinCeilingComputesAndFlags(t *testing.T) {
	now := time.Date(2026, 7, 29, 12, 0, 0, 0, time.UTC)
	j, err := JudgePriceInput(weETH, priceKey(fixtureOracleSource),
		usableRow("300000000000", now.Add(-240*time.Second)), budget, now, nil, 2000, false)
	require.NoError(t, err)
	require.True(t, j.Usable, "G4 computes; it does not refuse")
	require.Equal(t, GateStaleWithinCeiling, j.Gate)
	require.Equal(t, []string{FlagStalePrice}, j.Flags())
	require.Equal(t, VerdictStale, j.Snapshot.Verdict)
	require.False(t, j.Input.Fresh, "Fresh=false is what propagates StalePriceInputs through internal/risk")
}

// TestJudgeOverCeilingRefuses — G1's over-ceiling arm.
func TestJudgeOverCeilingRefuses(t *testing.T) {
	now := time.Date(2026, 7, 29, 12, 0, 0, 0, time.UTC)
	j, err := JudgePriceInput(weETH, priceKey(fixtureOracleSource),
		usableRow("300000000000", now.Add(-361*time.Second)), budget, now, nil, 2000, false)
	require.NoError(t, err)
	require.False(t, j.Usable)
	require.Equal(t, GateMissingInput, j.Gate)
	require.Equal(t, VerdictOverCeiling, j.Snapshot.Verdict)
	require.NotNil(t, j.Snapshot.Value, "an over-ceiling refusal still discloses WHAT it refused and how old it was")
	require.EqualValues(t, 361, *j.Snapshot.AgeSeconds)

	// Exactly at the ceiling is still usable — the bound is `>`.
	j, err = JudgePriceInput(weETH, priceKey(fixtureOracleSource),
		usableRow("300000000000", now.Add(-360*time.Second)), budget, now, nil, 2000, false)
	require.NoError(t, err)
	require.True(t, j.Usable)
}

// TestJudgeMissingRowRecordsTheAsset — "never silently drop an unpriced asset".
func TestJudgeMissingRowRecordsTheAsset(t *testing.T) {
	now := time.Now().UTC()
	j, err := JudgePriceInput(weETH, priceKey(fixtureOracleSource), nil, budget, now, nil, 2000, false)
	require.NoError(t, err)
	require.False(t, j.Usable)
	require.Equal(t, GateMissingInput, j.Gate)
	require.Equal(t, VerdictMissing, j.Snapshot.Verdict)
	require.Equal(t, weETH.Bytes(), j.Snapshot.Asset, "the asset is still named on the row")
	require.Nil(t, j.Snapshot.Value)
	require.Equal(t, risk.ProvenanceAdapterOutput, j.Snapshot.Provenance)
}

// TestJudgeNullSourceAsOfIsRefused pins the durable-truthful-as-of law: a row
// with no chain-asserted as-of is a MISSING INPUT, and `observed_at` — database
// insertion time — is never substituted for it.
func TestJudgeNullSourceAsOfIsRefused(t *testing.T) {
	now := time.Date(2026, 7, 29, 12, 0, 0, 0, time.UTC)
	row := usableRow("300000000000", now.Add(-30*time.Second))
	row.HasSourceAsOf = false
	row.SourceAsOf = time.Time{}
	row.ObservedAt = now // an insertion time that would look perfectly fresh

	j, err := JudgePriceInput(weETH, priceKey(fixtureOracleSource), row, budget, now, nil, 2000, false)
	require.NoError(t, err)
	require.False(t, j.Usable, "a NULL source_as_of falls into G1; observed_at is NOT a fallback")
	require.Equal(t, GateMissingInput, j.Gate)
	require.Equal(t, VerdictNoAsOf, j.Snapshot.Verdict)
	require.Nil(t, j.Snapshot.SourceAsOf)
	require.Nil(t, j.Snapshot.AgeSeconds, "no as-of means no age; a computed age here would be fabricated")
}

// TestJudgeUsesSourceAsOfNotObservedAt is the delayed-insertion regression: the
// row's chain time is old, its insertion time is now. Judging on insertion time
// would call an ancient number fresh.
func TestJudgeUsesSourceAsOfNotObservedAt(t *testing.T) {
	now := time.Date(2026, 7, 29, 12, 0, 0, 0, time.UTC)
	row := usableRow("300000000000", now.Add(-2*time.Hour))
	row.ObservedAt = now

	j, err := JudgePriceInput(weETH, priceKey(fixtureOracleSource), row, budget, now, nil, 2000, false)
	require.NoError(t, err)
	require.False(t, j.Usable)
	require.Equal(t, VerdictOverCeiling, j.Snapshot.Verdict)
	require.EqualValues(t, 7200, *j.Snapshot.AgeSeconds)
}

// TestJudgeReorgUnackedRefusesBeforeFreshness — G2 outranks any freshness
// judgement made over a row that may describe a deleted block.
func TestJudgeReorgUnackedRefusesBeforeFreshness(t *testing.T) {
	now := time.Date(2026, 7, 29, 12, 0, 0, 0, time.UTC)
	j, err := JudgePriceInput(weETH, priceKey(fixtureOracleSource),
		usableRow("300000000000", now), budget, now, nil, 2000, true)
	require.NoError(t, err)
	require.False(t, j.Usable)
	require.Equal(t, GatePriceReorg, j.Gate)
	require.Equal(t, VerdictReorgUnacked, j.Snapshot.Verdict)
}

// TestJudgeLargeStepFlagsButNeverRefuses — G5. The polled price IS the engine's
// charging price; refusing on value would be refusing to report the truth.
func TestJudgeLargeStepFlagsButNeverRefuses(t *testing.T) {
	now := time.Date(2026, 7, 29, 12, 0, 0, 0, time.UTC)
	prev := bi("300000000000")

	// −25%: beyond the 20% policy bound.
	j, err := JudgePriceInput(weETH, priceKey(fixtureOracleSource),
		usableRow("225000000000", now), budget, now, prev, 2000, false)
	require.NoError(t, err)
	require.True(t, j.Usable, "G5 NEVER refuses on value")
	require.Equal(t, GateLargeStep, j.Gate)
	require.Equal(t, []string{FlagLargeStep}, j.Flags())
	require.Equal(t, VerdictFresh, j.Snapshot.Verdict, "the row itself is fresh; the flag is about the MOVE")

	// −10%: within the bound.
	j, err = JudgePriceInput(weETH, priceKey(fixtureOracleSource),
		usableRow("270000000000", now), budget, now, prev, 2000, false)
	require.NoError(t, err)
	require.Empty(t, j.Flags())

	// Exactly 20% is not "beyond" — the bound is `>`.
	j, err = JudgePriceInput(weETH, priceKey(fixtureOracleSource),
		usableRow("240000000000", now), budget, now, prev, 2000, false)
	require.NoError(t, err)
	require.Empty(t, j.Flags())

	// StepBps 0 disables the flag entirely.
	j, err = JudgePriceInput(weETH, priceKey(fixtureOracleSource),
		usableRow("1", now), budget, now, prev, 0, false)
	require.NoError(t, err)
	require.Empty(t, j.Flags())
}

// TestJudgeStaleAndLargeStepCarryBothFlags — the two are independent facts and
// neither may swallow the other.
func TestJudgeStaleAndLargeStepCarryBothFlags(t *testing.T) {
	now := time.Date(2026, 7, 29, 12, 0, 0, 0, time.UTC)
	j, err := JudgePriceInput(weETH, priceKey(fixtureOracleSource),
		usableRow("225000000000", now.Add(-240*time.Second)), budget, now, bi("300000000000"), 2000, false)
	require.NoError(t, err)
	require.True(t, j.Usable)
	require.ElementsMatch(t, []string{FlagStalePrice, FlagLargeStep}, j.Flags())
}

func TestJudgeDoesNotAliasTheStoreRow(t *testing.T) {
	now := time.Date(2026, 7, 29, 12, 0, 0, 0, time.UTC)
	row := usableRow("300000000000", now)
	j, err := JudgePriceInput(weETH, priceKey(fixtureOracleSource), row, budget, now, nil, 2000, false)
	require.NoError(t, err)
	row.Value.SetInt64(1)
	require.Equal(t, "300000000000", j.Input.Value.String())
	require.Equal(t, "300000000000", j.Snapshot.Value.String())
}

func TestJudgeRefusesUnknownSource(t *testing.T) {
	now := time.Now().UTC()
	_, err := JudgePriceInput(weETH, priceKey("mystery-oracle"), nil, budget, now, nil, 2000, false)
	require.ErrorIs(t, err, ErrUnknownProvenance)
}

var _ = big.NewInt
