package decode

import (
	"encoding/json"
	"math/big"
	"os"
	"path/filepath"
	"testing"

	"github.com/ethereum/go-ethereum/common"
	"github.com/stretchr/testify/require"

	"github.com/kaselunt/solvent/internal/store"
)

// logFixture mirrors the JSON shape committed under testdata/*.json: one
// real (fetched via eth_getLogs / Blockscout, then re-verified against a raw
// eth_getTransactionReceipt) or synthetic (hand-constructed from the ABI,
// explicitly marked) log per entry, with a human-readable provenance note.
type logFixture struct {
	Provenance  string   `json:"provenance"`
	Synthetic   bool     `json:"synthetic"`
	ChainID     uint64   `json:"chainId"`
	BlockNumber uint64   `json:"blockNumber"`
	BlockHash   string   `json:"blockHash"`
	TxHash      string   `json:"txHash"`
	LogIndex    uint32   `json:"logIndex"`
	Address     string   `json:"address"`
	Topics      []string `json:"topics"`
	Data        string   `json:"data"`
}

func loadLogFixtures(t *testing.T, name string) []logFixture {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join("testdata", name))
	require.NoError(t, err, "reading testdata/%s", name)
	var fixtures []logFixture
	require.NoError(t, json.Unmarshal(raw, &fixtures), "unmarshalling testdata/%s", name)
	require.NotEmpty(t, fixtures, "testdata/%s must not be empty", name)
	return fixtures
}

func (f logFixture) rawLog() store.RawLog {
	topics := make([][]byte, len(f.Topics))
	for i, tp := range f.Topics {
		topics[i] = common.FromHex(tp)
	}
	return store.RawLog{
		ChainID:     f.ChainID,
		BlockNumber: f.BlockNumber,
		BlockHash:   common.FromHex(f.BlockHash),
		TxHash:      common.FromHex(f.TxHash),
		LogIndex:    f.LogIndex,
		Address:     common.FromHex(f.Address),
		Topics:      topics,
		Data:        common.FromHex(f.Data),
	}
}

func bi(s string) *big.Int {
	v, ok := new(big.Int).SetString(s, 10)
	if !ok {
		panic("bad big.Int literal: " + s)
	}
	return v
}

// requireRealFixtureCount asserts at least `min` non-synthetic fixtures are
// present in the loaded slice -- the fixture-provenance evidence this task
// must produce ("≥2 real logs per decoded event type").
func requireRealFixtureCount(t *testing.T, fixtures []logFixture, min int) {
	t.Helper()
	real := 0
	for _, f := range fixtures {
		if !f.Synthetic {
			real++
		}
	}
	require.GreaterOrEqualf(t, real, min, "expected >= %d real fixtures, got %d", min, real)
}

// ---------------------------------------------------------------------------
// Debt Manager fixtures.
// ---------------------------------------------------------------------------

func TestFixtureDMBorrowed(t *testing.T) {
	fixtures := loadLogFixtures(t, "dm_borrowed.json")
	requireRealFixtureCount(t, fixtures, 2)
	want := []DMBorrowed{
		{User: common.HexToAddress("0x983e36549d27ccfe30d37e615d35222f52fc104d"), Token: common.HexToAddress("0x0b2c639c533813f4aa9d7837caf62653d097ff85"), Amount: bi("11140000")},
		{User: common.HexToAddress("0x57e6d3f754c45c94418cdb11ea8433854c87ab09"), Token: common.HexToAddress("0x0b2c639c533813f4aa9d7837caf62653d097ff85"), Amount: bi("4090000")},
	}
	r := NewRegistry()
	for i, fx := range fixtures {
		ev, ok, err := r.Decode("debt_manager", fx.rawLog())
		require.NoError(t, err, fx.Provenance)
		require.True(t, ok, fx.Provenance)
		got, isType := ev.(DMBorrowed)
		require.True(t, isType)
		require.Equal(t, want[i].User, got.User, fx.Provenance)
		require.Equal(t, want[i].Token, got.Token, fx.Provenance)
		require.Equal(t, 0, want[i].Amount.Cmp(got.Amount), fx.Provenance)
	}
}

func TestFixtureDMRepaid(t *testing.T) {
	fixtures := loadLogFixtures(t, "dm_repaid.json")
	requireRealFixtureCount(t, fixtures, 2)
	want := []DMRepaid{
		{User: common.HexToAddress("0x57e6d3f754c45c94418cdb11ea8433854c87ab09"), Payer: common.HexToAddress("0x57e6d3f754c45c94418cdb11ea8433854c87ab09"), Token: common.HexToAddress("0x0b2c639c533813f4aa9d7837caf62653d097ff85"), UsdAmount: bi("2535300")},
		{User: common.HexToAddress("0x57e6d3f754c45c94418cdb11ea8433854c87ab09"), Payer: common.HexToAddress("0x39161a44588ec2327a18d4707ea5216c721ba539"), Token: common.HexToAddress("0x0b2c639c533813f4aa9d7837caf62653d097ff85"), UsdAmount: bi("81974752")},
	}
	r := NewRegistry()
	for i, fx := range fixtures {
		ev, ok, err := r.Decode("debt_manager", fx.rawLog())
		require.NoError(t, err, fx.Provenance)
		require.True(t, ok, fx.Provenance)
		got := ev.(DMRepaid)
		require.Equal(t, want[i].User, got.User, fx.Provenance)
		require.Equal(t, want[i].Payer, got.Payer, fx.Provenance)
		require.Equal(t, want[i].Token, got.Token, fx.Provenance)
		require.Equal(t, 0, want[i].UsdAmount.Cmp(got.UsdAmount), fx.Provenance)
	}
}

func TestFixtureDMSupplied(t *testing.T) {
	fixtures := loadLogFixtures(t, "dm_supplied.json")
	requireRealFixtureCount(t, fixtures, 1) // this flow is genuinely rare on-chain (see provenance)
	want := []DMSupplied{
		{Sender: common.HexToAddress("0xf40bcc0845528873784f36e5c105e62a93ff7021"), User: common.HexToAddress("0xf40bcc0845528873784f36e5c105e62a93ff7021"), Token: common.HexToAddress("0x0b2c639c533813f4aa9d7837caf62653d097ff85"), Amount: bi("300000000000")},
		{Sender: common.HexToAddress("0x1111111111111111111111111111111111111111"), User: common.HexToAddress("0x2222222222222222222222222222222222222222"), Token: common.HexToAddress("0x0b2c639c533813f4aa9d7837caf62653d097ff85"), Amount: bi("50000000")},
	}
	r := NewRegistry()
	for i, fx := range fixtures {
		ev, ok, err := r.Decode("debt_manager", fx.rawLog())
		require.NoError(t, err, fx.Provenance)
		require.True(t, ok, fx.Provenance)
		got := ev.(DMSupplied)
		require.Equal(t, want[i].Sender, got.Sender, fx.Provenance)
		require.Equal(t, want[i].User, got.User, fx.Provenance)
		require.Equal(t, want[i].Token, got.Token, fx.Provenance)
		require.Equal(t, 0, want[i].Amount.Cmp(got.Amount), fx.Provenance)
	}
}

func TestFixtureDMWithdrawBorrowToken(t *testing.T) {
	fixtures := loadLogFixtures(t, "dm_withdraw_borrow_token.json")
	for _, fx := range fixtures {
		require.True(t, fx.Synthetic, "no real WithdrawBorrowToken occurrence exists on-chain to date (see provenance)")
	}
	want := []DMWithdrawBorrowToken{
		{Withdrawer: common.HexToAddress("0x3333333333333333333333333333333333333333"), BorrowToken: common.HexToAddress("0x0b2c639c533813f4aa9d7837caf62653d097ff85"), Amount: bi("10000000")},
		{Withdrawer: common.HexToAddress("0x4444444444444444444444444444444444444444"), BorrowToken: common.HexToAddress("0x0b2c639c533813f4aa9d7837caf62653d097ff85"), Amount: bi("1")},
	}
	r := NewRegistry()
	for i, fx := range fixtures {
		ev, ok, err := r.Decode("debt_manager", fx.rawLog())
		require.NoError(t, err, fx.Provenance)
		require.True(t, ok, fx.Provenance)
		got := ev.(DMWithdrawBorrowToken)
		require.Equal(t, want[i].Withdrawer, got.Withdrawer, fx.Provenance)
		require.Equal(t, want[i].BorrowToken, got.BorrowToken, fx.Provenance)
		require.Equal(t, 0, want[i].Amount.Cmp(got.Amount), fx.Provenance)
	}
}

func TestFixtureDMLiquidated(t *testing.T) {
	fixtures := loadLogFixtures(t, "dm_liquidated.json")
	requireRealFixtureCount(t, fixtures, 2)
	r := NewRegistry()

	// entry 0: cross-validated against recon/derivation-notes.md's liquidation-path spot check.
	ev0, ok, err := r.Decode("debt_manager", fixtures[0].rawLog())
	require.NoError(t, err, fixtures[0].Provenance)
	require.True(t, ok)
	got0 := ev0.(DMLiquidated)
	require.Equal(t, common.HexToAddress("0x0c51a1690899b4482458f432a5e80c9682574205"), got0.Liquidator)
	require.Equal(t, common.HexToAddress("0xac5f3ce95f602e31b672cc38cddf7a3ea9ae5fcc"), got0.User)
	require.Equal(t, common.HexToAddress("0x0b2c639c533813f4aa9d7837caf62653d097ff85"), got0.DebtToken)
	require.Equal(t, 0, bi("31690519").Cmp(got0.BeforeDebtUsd), "recon-cross-validated beforeDebtAmount")
	require.Equal(t, 0, bi("15845260").Cmp(got0.DebtLiquidatedUsd), "recon-cross-validated debtAmountLiquidated")
	require.Len(t, got0.Collateral, 2)
	require.Equal(t, common.HexToAddress("0x4200000000000000000000000000000000000006"), got0.Collateral[0].Token)
	require.Equal(t, 0, big.NewInt(0).Cmp(got0.Collateral[0].Amount))
	require.Equal(t, common.HexToAddress("0x0b2c639c533813f4aa9d7837caf62653d097ff85"), got0.Collateral[1].Token)
	require.Equal(t, 0, bi("16003712").Cmp(got0.Collateral[1].Amount))
	require.Equal(t, 0, bi("158452").Cmp(got0.Collateral[1].Bonus))

	// entry 1: a zero-amount pass (first of two same-tx liquidate() passes).
	ev1, ok, err := r.Decode("debt_manager", fixtures[1].rawLog())
	require.NoError(t, err, fixtures[1].Provenance)
	require.True(t, ok)
	got1 := ev1.(DMLiquidated)
	require.Equal(t, common.HexToAddress("0x7d829d50aaf400b8b29b3b311f4ad70ad819dc6e"), got1.Liquidator)
	require.Equal(t, common.HexToAddress("0x4d81ce1dd1b1e10f96313e080bf7b12136ff7e76"), got1.User)
	require.Equal(t, 0, bi("1992362").Cmp(got1.BeforeDebtUsd))
	require.Equal(t, 0, big.NewInt(0).Cmp(got1.DebtLiquidatedUsd))
	require.Len(t, got1.Collateral, 15)
	for _, c := range got1.Collateral {
		require.Equal(t, 0, big.NewInt(0).Cmp(c.Amount))
		require.Equal(t, 0, big.NewInt(0).Cmp(c.Bonus))
	}
}

func TestFixtureDMInterestIndexUpdated(t *testing.T) {
	fixtures := loadLogFixtures(t, "dm_interest_index_updated.json")
	requireRealFixtureCount(t, fixtures, 2)
	want := []DMInterestIndexUpdated{
		{Token: common.HexToAddress("0x0b2c639c533813f4aa9d7837caf62653d097ff85"), OldIndex: bi("1043894364055279796"), NewIndex: bi("1043894443499295325")},
		{Token: common.HexToAddress("0x0b2c639c533813f4aa9d7837caf62653d097ff85"), OldIndex: bi("1043894443499295325"), NewIndex: bi("1043894512350780690")},
	}
	r := NewRegistry()
	for i, fx := range fixtures {
		ev, ok, err := r.Decode("debt_manager", fx.rawLog())
		require.NoError(t, err, fx.Provenance)
		require.True(t, ok, fx.Provenance)
		got := ev.(DMInterestIndexUpdated)
		require.Equal(t, want[i].Token, got.Token, fx.Provenance)
		require.Equal(t, 0, want[i].OldIndex.Cmp(got.OldIndex), fx.Provenance)
		require.Equal(t, 0, want[i].NewIndex.Cmp(got.NewIndex), fx.Provenance)
	}
	// index growth invariant across the two consecutive updates.
	require.Equal(t, 0, want[0].NewIndex.Cmp(want[1].OldIndex))
}

func TestFixtureDMBorrowApySet(t *testing.T) {
	fixtures := loadLogFixtures(t, "dm_borrow_apy_set.json")
	requireRealFixtureCount(t, fixtures, 1) // this admin-tuning event is rare (see provenance)
	want := []DMBorrowApySet{
		{Token: common.HexToAddress("0x0b2c639c533813f4aa9d7837caf62653d097ff85"), OldApy: bi("126839167935"), NewApy: bi("1")},
		{Token: common.HexToAddress("0x94b008aa00579c1307b0ef2c499ad98a8ce58e58"), OldApy: bi("50000000000"), NewApy: bi("75000000000")},
	}
	r := NewRegistry()
	for i, fx := range fixtures {
		ev, ok, err := r.Decode("debt_manager", fx.rawLog())
		require.NoError(t, err, fx.Provenance)
		require.True(t, ok, fx.Provenance)
		got := ev.(DMBorrowApySet)
		require.Equal(t, want[i].Token, got.Token, fx.Provenance)
		require.Equal(t, 0, want[i].OldApy.Cmp(got.OldApy), fx.Provenance)
		require.Equal(t, 0, want[i].NewApy.Cmp(got.NewApy), fx.Provenance)
	}
}

func TestFixtureDMBorrowTokenConfigSet(t *testing.T) {
	fixtures := loadLogFixtures(t, "dm_borrow_token_config_set.json")
	requireRealFixtureCount(t, fixtures, 2)
	want := []DMBorrowTokenConfigSet{
		{
			Token: common.HexToAddress("0xdcb612005417dc906ff72c87df732e5a90d49e11"),
			Config: BorrowTokenConfig{
				InterestIndexSnapshot:          bi("1000000000000000000"), // PRECISION, per recon
				TotalNormalizedBorrowingAmount: bi("0"),
				TotalSharesOfBorrowTokens:      bi("0"),
				LastUpdateTimestamp:            1775529303,
				BorrowApy:                      126839167935,
				MinShares:                      bi("10000000"),
			},
		},
		{
			Token: common.HexToAddress("0xe5d3854736e0d513aae2d8d708ad94d14fd56a6a"),
			Config: BorrowTokenConfig{
				InterestIndexSnapshot:          bi("1000000000000000000"),
				TotalNormalizedBorrowingAmount: bi("0"),
				TotalSharesOfBorrowTokens:      bi("0"),
				LastUpdateTimestamp:            1775529303,
				BorrowApy:                      1,
				MinShares:                      bi("340282366920938463463374607431768211455"), // max uint128
			},
		},
	}
	r := NewRegistry()
	for i, fx := range fixtures {
		ev, ok, err := r.Decode("debt_manager", fx.rawLog())
		require.NoError(t, err, fx.Provenance)
		require.True(t, ok, fx.Provenance)
		got := ev.(DMBorrowTokenConfigSet)
		require.Equal(t, want[i].Token, got.Token, fx.Provenance)
		require.Equal(t, 0, want[i].Config.InterestIndexSnapshot.Cmp(got.Config.InterestIndexSnapshot), fx.Provenance)
		require.Equal(t, 0, want[i].Config.TotalNormalizedBorrowingAmount.Cmp(got.Config.TotalNormalizedBorrowingAmount), fx.Provenance)
		require.Equal(t, 0, want[i].Config.TotalSharesOfBorrowTokens.Cmp(got.Config.TotalSharesOfBorrowTokens), fx.Provenance)
		require.Equal(t, want[i].Config.LastUpdateTimestamp, got.Config.LastUpdateTimestamp, fx.Provenance)
		require.Equal(t, want[i].Config.BorrowApy, got.Config.BorrowApy, fx.Provenance)
		require.Equal(t, 0, want[i].Config.MinShares.Cmp(got.Config.MinShares), fx.Provenance)
	}
}

func TestFixtureDMCollateralTokenAdded(t *testing.T) {
	fixtures := loadLogFixtures(t, "dm_collateral_token_added.json")
	requireRealFixtureCount(t, fixtures, 2)
	want := []common.Address{
		common.HexToAddress("0xdcb612005417dc906ff72c87df732e5a90d49e11"),
		common.HexToAddress("0xd83e3d560ba6f05094d9d8b3eb8aaea571d1864e"),
	}
	r := NewRegistry()
	for i, fx := range fixtures {
		ev, ok, err := r.Decode("debt_manager", fx.rawLog())
		require.NoError(t, err, fx.Provenance)
		require.True(t, ok, fx.Provenance)
		got := ev.(DMCollateralTokenAdded)
		require.Equal(t, want[i], got.Token, fx.Provenance)
	}
}

func TestFixtureDMCollateralTokenRemoved(t *testing.T) {
	fixtures := loadLogFixtures(t, "dm_collateral_token_removed.json")
	for _, fx := range fixtures {
		require.True(t, fx.Synthetic, "no collateral token has ever been unsupported on-chain to date (see provenance)")
	}
	want := []common.Address{
		common.HexToAddress("0x5A7fACB970D094B6C7FF1df0eA68D99E6e73CBFF"),
		common.HexToAddress("0x5f46d540b6eD704C3c8789105F30E075AA900726"),
	}
	r := NewRegistry()
	for i, fx := range fixtures {
		ev, ok, err := r.Decode("debt_manager", fx.rawLog())
		require.NoError(t, err, fx.Provenance)
		require.True(t, ok, fx.Provenance)
		got := ev.(DMCollateralTokenRemoved)
		require.Equal(t, want[i], got.Token, fx.Provenance)
	}
}

func TestFixtureDMCollateralTokenConfigSet(t *testing.T) {
	fixtures := loadLogFixtures(t, "dm_collateral_token_config_set.json")
	requireRealFixtureCount(t, fixtures, 2)
	want := []DMCollateralTokenConfigSet{
		{
			CollateralToken: common.HexToAddress("0xdcb612005417dc906ff72c87df732e5a90d49e11"),
			OldConfig:       CollateralTokenConfig{LTV: bi("0"), LiquidationThreshold: bi("0"), LiquidationBonus: bi("0")},
			NewConfig:       CollateralTokenConfig{LTV: bi("90000000000000000000"), LiquidationThreshold: bi("95000000000000000000"), LiquidationBonus: bi("1000000000000000000")},
		},
		{
			CollateralToken: common.HexToAddress("0xd83e3d560ba6f05094d9d8b3eb8aaea571d1864e"),
			OldConfig:       CollateralTokenConfig{LTV: bi("0"), LiquidationThreshold: bi("0"), LiquidationBonus: bi("0")},
			NewConfig:       CollateralTokenConfig{LTV: bi("45000000000000000000"), LiquidationThreshold: bi("65000000000000000000"), LiquidationBonus: bi("4000000000000000000")},
		},
	}
	r := NewRegistry()
	for i, fx := range fixtures {
		ev, ok, err := r.Decode("debt_manager", fx.rawLog())
		require.NoError(t, err, fx.Provenance)
		require.True(t, ok, fx.Provenance)
		got := ev.(DMCollateralTokenConfigSet)
		require.Equal(t, want[i].CollateralToken, got.CollateralToken, fx.Provenance)
		require.Equal(t, 0, want[i].OldConfig.LTV.Cmp(got.OldConfig.LTV), fx.Provenance)
		require.Equal(t, 0, want[i].OldConfig.LiquidationThreshold.Cmp(got.OldConfig.LiquidationThreshold), fx.Provenance)
		require.Equal(t, 0, want[i].OldConfig.LiquidationBonus.Cmp(got.OldConfig.LiquidationBonus), fx.Provenance)
		require.Equal(t, 0, want[i].NewConfig.LTV.Cmp(got.NewConfig.LTV), fx.Provenance)
		require.Equal(t, 0, want[i].NewConfig.LiquidationThreshold.Cmp(got.NewConfig.LiquidationThreshold), fx.Provenance)
		require.Equal(t, 0, want[i].NewConfig.LiquidationBonus.Cmp(got.NewConfig.LiquidationBonus), fx.Provenance)
	}
}

func TestFixtureDMMigrationBorrowerPositionsSet(t *testing.T) {
	fixtures := loadLogFixtures(t, "dm_migration_borrower_positions_set.json")
	requireRealFixtureCount(t, fixtures, 2)
	want := []DMMigrationBorrowerPositionsSet{
		{Token: common.HexToAddress("0x0b2c639c533813f4aa9d7837caf62653d097ff85"), Count: bi("1")},
		{Token: common.HexToAddress("0x0b2c639c533813f4aa9d7837caf62653d097ff85"), Count: bi("50")},
	}
	r := NewRegistry()
	for i, fx := range fixtures {
		ev, ok, err := r.Decode("debt_manager", fx.rawLog())
		require.NoError(t, err, fx.Provenance)
		require.True(t, ok, fx.Provenance)
		got := ev.(DMMigrationBorrowerPositionsSet)
		require.Equal(t, want[i].Token, got.Token, fx.Provenance)
		require.Equal(t, 0, want[i].Count.Cmp(got.Count), fx.Provenance)
	}
}

// ---------------------------------------------------------------------------
// Aave Pool fixtures.
// ---------------------------------------------------------------------------

func TestFixtureAaveBorrow(t *testing.T) {
	fixtures := loadLogFixtures(t, "aave_borrow.json")
	requireRealFixtureCount(t, fixtures, 2)
	want := []AaveBorrow{
		{Reserve: common.HexToAddress("0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48"), User: common.HexToAddress("0x70daaac436465a0d03e45916fa68ddee6086e5fe"), OnBehalfOf: common.HexToAddress("0x70daaac436465a0d03e45916fa68ddee6086e5fe"), Amount: bi("2000000000"), InterestRateMode: 2, BorrowRate: bi("41623208398535754237469008")},
		{Reserve: common.HexToAddress("0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48"), User: common.HexToAddress("0xd2d16b15072f16749de1af9175bec3e3d9da261f"), OnBehalfOf: common.HexToAddress("0xd2d16b15072f16749de1af9175bec3e3d9da261f"), Amount: bi("20000000000"), InterestRateMode: 2, BorrowRate: bi("47469652714324998115533003")},
	}
	r := NewRegistry()
	for i, fx := range fixtures {
		ev, ok, err := r.Decode("aave_v3_etherfi", fx.rawLog())
		require.NoError(t, err, fx.Provenance)
		require.True(t, ok, fx.Provenance)
		got := ev.(AaveBorrow)
		require.Equal(t, want[i].Reserve, got.Reserve, fx.Provenance)
		require.Equal(t, want[i].User, got.User, fx.Provenance)
		require.Equal(t, want[i].OnBehalfOf, got.OnBehalfOf, fx.Provenance)
		require.Equal(t, 0, want[i].Amount.Cmp(got.Amount), fx.Provenance)
		require.Equal(t, want[i].InterestRateMode, got.InterestRateMode, fx.Provenance)
		require.Equal(t, 0, want[i].BorrowRate.Cmp(got.BorrowRate), fx.Provenance)
	}
	require.Equal(t, "AaveBorrow", want[0].Name())
}

func TestFixtureAaveRepay(t *testing.T) {
	fixtures := loadLogFixtures(t, "aave_repay.json")
	requireRealFixtureCount(t, fixtures, 2)
	want := []AaveRepay{
		{Reserve: common.HexToAddress("0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48"), User: common.HexToAddress("0x53d17859ecbbaa9707ed738cb5a1790419aa1cdc"), Repayer: common.HexToAddress("0x53d17859ecbbaa9707ed738cb5a1790419aa1cdc"), Amount: bi("896325520"), UseATokens: false},
		{Reserve: common.HexToAddress("0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48"), User: common.HexToAddress("0xbd0c6f59ee76560b26f07d8a1187d12530359cc1"), Repayer: common.HexToAddress("0xbd0c6f59ee76560b26f07d8a1187d12530359cc1"), Amount: bi("577627834"), UseATokens: false},
	}
	r := NewRegistry()
	for i, fx := range fixtures {
		ev, ok, err := r.Decode("aave_v3_etherfi", fx.rawLog())
		require.NoError(t, err, fx.Provenance)
		require.True(t, ok, fx.Provenance)
		got := ev.(AaveRepay)
		require.Equal(t, want[i].Reserve, got.Reserve, fx.Provenance)
		require.Equal(t, want[i].User, got.User, fx.Provenance)
		require.Equal(t, want[i].Repayer, got.Repayer, fx.Provenance)
		require.Equal(t, 0, want[i].Amount.Cmp(got.Amount), fx.Provenance)
		require.Equal(t, want[i].UseATokens, got.UseATokens, fx.Provenance)
	}
}

func TestFixtureAaveSupply(t *testing.T) {
	fixtures := loadLogFixtures(t, "aave_supply.json")
	requireRealFixtureCount(t, fixtures, 2)
	want := []AaveSupply{
		{Reserve: common.HexToAddress("0xcd5fe23c85820f7b72d0926fc9b05b43e359b7ee"), User: common.HexToAddress("0x70daaac436465a0d03e45916fa68ddee6086e5fe"), OnBehalfOf: common.HexToAddress("0x70daaac436465a0d03e45916fa68ddee6086e5fe"), Amount: bi("3101165761514344712")},
		{Reserve: common.HexToAddress("0xcd5fe23c85820f7b72d0926fc9b05b43e359b7ee"), User: common.HexToAddress("0xd2d16b15072f16749de1af9175bec3e3d9da261f"), OnBehalfOf: common.HexToAddress("0xd2d16b15072f16749de1af9175bec3e3d9da261f"), Amount: bi("24990000000000000000")},
	}
	r := NewRegistry()
	for i, fx := range fixtures {
		ev, ok, err := r.Decode("aave_v3_etherfi", fx.rawLog())
		require.NoError(t, err, fx.Provenance)
		require.True(t, ok, fx.Provenance)
		got := ev.(AaveSupply)
		require.Equal(t, want[i].Reserve, got.Reserve, fx.Provenance)
		require.Equal(t, want[i].User, got.User, fx.Provenance)
		require.Equal(t, want[i].OnBehalfOf, got.OnBehalfOf, fx.Provenance)
		require.Equal(t, 0, want[i].Amount.Cmp(got.Amount), fx.Provenance)
	}
}

func TestFixtureAaveWithdraw(t *testing.T) {
	fixtures := loadLogFixtures(t, "aave_withdraw.json")
	requireRealFixtureCount(t, fixtures, 2)
	want := []AaveWithdraw{
		{Reserve: common.HexToAddress("0xcd5fe23c85820f7b72d0926fc9b05b43e359b7ee"), User: common.HexToAddress("0x53d17859ecbbaa9707ed738cb5a1790419aa1cdc"), To: common.HexToAddress("0x53d17859ecbbaa9707ed738cb5a1790419aa1cdc"), Amount: bi("1000002131081530318")},
		{Reserve: common.HexToAddress("0xcd5fe23c85820f7b72d0926fc9b05b43e359b7ee"), User: common.HexToAddress("0xbd0c6f59ee76560b26f07d8a1187d12530359cc1"), To: common.HexToAddress("0xbd0c6f59ee76560b26f07d8a1187d12530359cc1"), Amount: bi("888657443854909413")},
	}
	r := NewRegistry()
	for i, fx := range fixtures {
		ev, ok, err := r.Decode("aave_v3_etherfi", fx.rawLog())
		require.NoError(t, err, fx.Provenance)
		require.True(t, ok, fx.Provenance)
		got := ev.(AaveWithdraw)
		require.Equal(t, want[i].Reserve, got.Reserve, fx.Provenance)
		require.Equal(t, want[i].User, got.User, fx.Provenance)
		require.Equal(t, want[i].To, got.To, fx.Provenance)
		require.Equal(t, 0, want[i].Amount.Cmp(got.Amount), fx.Provenance)
	}
}

func TestFixtureAaveLiquidationCall(t *testing.T) {
	fixtures := loadLogFixtures(t, "aave_liquidation_call.json")
	requireRealFixtureCount(t, fixtures, 2)
	want := []AaveLiquidationCall{
		{
			CollateralAsset:            common.HexToAddress("0xcd5fe23c85820f7b72d0926fc9b05b43e359b7ee"),
			DebtAsset:                  common.HexToAddress("0x853d955acef822db058eb8505911ed77f175b99e"),
			User:                       common.HexToAddress("0x2ec19e982172ead28b312a07faf25105fb3747d8"),
			DebtToCover:                bi("889891961752372037"),
			LiquidatedCollateralAmount: bi("471571038756892"),
			Liquidator:                 common.HexToAddress("0x393af4efb08818079b5e25708a7e62061c3252e6"),
			ReceiveAToken:              false,
		},
		{
			CollateralAsset:            common.HexToAddress("0xcd5fe23c85820f7b72d0926fc9b05b43e359b7ee"),
			DebtAsset:                  common.HexToAddress("0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48"),
			User:                       common.HexToAddress("0xccaf0e1b0f70157d69dbe771dd2559dd70e78367"),
			DebtToCover:                bi("2395"),
			LiquidatedCollateralAmount: bi("1153895984014"),
			Liquidator:                 common.HexToAddress("0xc2e6849c73062d153ff53e1161e73b3200989510"),
			ReceiveAToken:              false,
		},
	}
	r := NewRegistry()
	for i, fx := range fixtures {
		ev, ok, err := r.Decode("aave_v3_etherfi", fx.rawLog())
		require.NoError(t, err, fx.Provenance)
		require.True(t, ok, fx.Provenance)
		got := ev.(AaveLiquidationCall)
		require.Equal(t, want[i].CollateralAsset, got.CollateralAsset, fx.Provenance)
		require.Equal(t, want[i].DebtAsset, got.DebtAsset, fx.Provenance)
		require.Equal(t, want[i].User, got.User, fx.Provenance)
		require.Equal(t, 0, want[i].DebtToCover.Cmp(got.DebtToCover), fx.Provenance)
		require.Equal(t, 0, want[i].LiquidatedCollateralAmount.Cmp(got.LiquidatedCollateralAmount), fx.Provenance)
		require.Equal(t, want[i].Liquidator, got.Liquidator, fx.Provenance)
		require.Equal(t, want[i].ReceiveAToken, got.ReceiveAToken, fx.Provenance)
	}
}

func TestFixtureAaveReserveDataUpdated(t *testing.T) {
	fixtures := loadLogFixtures(t, "aave_reserve_data_updated.json")
	requireRealFixtureCount(t, fixtures, 2)
	want := []AaveReserveDataUpdated{
		{Reserve: common.HexToAddress("0xcd5fe23c85820f7b72d0926fc9b05b43e359b7ee"), LiquidityRate: bi("0"), VariableBorrowRate: bi("0"), LiquidityIndex: bi("1000002131081530318762840784"), VariableBorrowIndex: bi("1000000000000000000000000000")},
		{Reserve: common.HexToAddress("0x853d955acef822db058eb8505911ed77f175b99e"), LiquidityRate: bi("13971379472115579063211"), VariableBorrowRate: bi("1033111501398500849621261"), LiquidityIndex: bi("1017458573716495921529380147"), VariableBorrowIndex: bi("1036192882683679231539862178")},
	}
	r := NewRegistry()
	for i, fx := range fixtures {
		ev, ok, err := r.Decode("aave_v3_etherfi", fx.rawLog())
		require.NoError(t, err, fx.Provenance)
		require.True(t, ok, fx.Provenance)
		got := ev.(AaveReserveDataUpdated)
		require.Equal(t, want[i].Reserve, got.Reserve, fx.Provenance)
		require.Equal(t, 0, want[i].LiquidityRate.Cmp(got.LiquidityRate), fx.Provenance)
		require.Equal(t, 0, want[i].VariableBorrowRate.Cmp(got.VariableBorrowRate), fx.Provenance)
		require.Equal(t, 0, want[i].LiquidityIndex.Cmp(got.LiquidityIndex), fx.Provenance)
		require.Equal(t, 0, want[i].VariableBorrowIndex.Cmp(got.VariableBorrowIndex), fx.Provenance)
	}
}

func TestFixtureAaveDeficitCreated(t *testing.T) {
	fixtures := loadLogFixtures(t, "aave_deficit_created.json")
	requireRealFixtureCount(t, fixtures, 2)
	want := []AaveDeficitCreated{
		{User: common.HexToAddress("0x2ec19e982172ead28b312a07faf25105fb3747d8"), DebtAsset: common.HexToAddress("0x853d955acef822db058eb8505911ed77f175b99e"), AmountCreated: bi("865587462856291774")},
		{User: common.HexToAddress("0xccaf0e1b0f70157d69dbe771dd2559dd70e78367"), DebtAsset: common.HexToAddress("0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48"), AmountCreated: bi("463")},
	}
	r := NewRegistry()
	for i, fx := range fixtures {
		ev, ok, err := r.Decode("aave_v3_etherfi", fx.rawLog())
		require.NoError(t, err, fx.Provenance)
		require.True(t, ok, fx.Provenance)
		got := ev.(AaveDeficitCreated)
		require.Equal(t, want[i].User, got.User, fx.Provenance)
		require.Equal(t, want[i].DebtAsset, got.DebtAsset, fx.Provenance)
		require.Equal(t, 0, want[i].AmountCreated.Cmp(got.AmountCreated), fx.Provenance)
	}
}

// ---------------------------------------------------------------------------
// aToken fixtures.
// ---------------------------------------------------------------------------

func TestFixtureATokenTransfer(t *testing.T) {
	fixtures := loadLogFixtures(t, "atoken_transfer.json")
	requireRealFixtureCount(t, fixtures, 2)
	want := []ATokenTransfer{
		{From: common.HexToAddress("0x2ec19e982172ead28b312a07faf25105fb3747d8"), To: common.HexToAddress("0x464c71f6c2f760dda6093dcb91c24c39e5d6e18c"), Value: bi("2684465116263")},
		{From: common.HexToAddress("0x2ec19e982172ead28b312a07faf25105fb3747d8"), To: common.HexToAddress("0x0000000000000000000000000000000000000000"), Value: bi("471571038756893")},
	}
	r := NewRegistry()
	for i, fx := range fixtures {
		ev, ok, err := r.Decode("aave_v3_etherfi", fx.rawLog())
		require.NoError(t, err, fx.Provenance)
		require.True(t, ok, fx.Provenance)
		got := ev.(ATokenTransfer)
		require.Equal(t, want[i].From, got.From, fx.Provenance)
		require.Equal(t, want[i].To, got.To, fx.Provenance)
		require.Equal(t, 0, want[i].Value.Cmp(got.Value), fx.Provenance)
	}
}

func TestFixtureATokenMint(t *testing.T) {
	fixtures := loadLogFixtures(t, "atoken_mint.json")
	requireRealFixtureCount(t, fixtures, 2)
	want := []ATokenMint{
		{Caller: common.HexToAddress("0xa1940ea3f615559255c59da5b16d6da1d1d60e60"), OnBehalfOf: common.HexToAddress("0xa1940ea3f615559255c59da5b16d6da1d1d60e60"), Value: bi("6393244590"), BalanceIncrease: bi("6393244590"), Index: bi("1000002131081530318762840784")},
		{Caller: common.HexToAddress("0x0aa97c284e98396202b6a04024f5e2c65026f3c0"), OnBehalfOf: common.HexToAddress("0x464c71f6c2f760dda6093dcb91c24c39e5d6e18c"), Value: bi("607559443350"), BalanceIncrease: bi("581216876355"), Index: bi("1000002131081530318762840784")},
	}
	r := NewRegistry()
	for i, fx := range fixtures {
		ev, ok, err := r.Decode("aave_v3_etherfi", fx.rawLog())
		require.NoError(t, err, fx.Provenance)
		require.True(t, ok, fx.Provenance)
		got := ev.(ATokenMint)
		require.Equal(t, want[i].Caller, got.Caller, fx.Provenance)
		require.Equal(t, want[i].OnBehalfOf, got.OnBehalfOf, fx.Provenance)
		require.Equal(t, 0, want[i].Value.Cmp(got.Value), fx.Provenance)
		require.Equal(t, 0, want[i].BalanceIncrease.Cmp(got.BalanceIncrease), fx.Provenance)
		require.Equal(t, 0, want[i].Index.Cmp(got.Index), fx.Provenance)
	}
}

func TestFixtureATokenBurn(t *testing.T) {
	fixtures := loadLogFixtures(t, "atoken_burn.json")
	requireRealFixtureCount(t, fixtures, 2)
	want := []ATokenBurn{
		{From: common.HexToAddress("0x2ec19e982172ead28b312a07faf25105fb3747d8"), Target: common.HexToAddress("0x393af4efb08818079b5e25708a7e62061c3252e6"), Value: bi("471571038756893"), BalanceIncrease: bi("0"), Index: bi("1000002131081530318762840784")},
		{From: common.HexToAddress("0xccaf0e1b0f70157d69dbe771dd2559dd70e78367"), Target: common.HexToAddress("0xc2e6849c73062d153ff53e1161e73b3200989510"), Value: bi("1153893510975"), BalanceIncrease: bi("2473039"), Index: bi("1000002131081530318762840784")},
	}
	r := NewRegistry()
	for i, fx := range fixtures {
		ev, ok, err := r.Decode("aave_v3_etherfi", fx.rawLog())
		require.NoError(t, err, fx.Provenance)
		require.True(t, ok, fx.Provenance)
		got := ev.(ATokenBurn)
		require.Equal(t, want[i].From, got.From, fx.Provenance)
		require.Equal(t, want[i].Target, got.Target, fx.Provenance)
		require.Equal(t, 0, want[i].Value.Cmp(got.Value), fx.Provenance)
		require.Equal(t, 0, want[i].BalanceIncrease.Cmp(got.BalanceIncrease), fx.Provenance)
		require.Equal(t, 0, want[i].Index.Cmp(got.Index), fx.Provenance)
	}
}

func TestFixtureATokenBalanceTransfer(t *testing.T) {
	fixtures := loadLogFixtures(t, "atoken_balance_transfer.json")
	requireRealFixtureCount(t, fixtures, 2)
	want := []ATokenBalanceTransfer{
		{From: common.HexToAddress("0x2ec19e982172ead28b312a07faf25105fb3747d8"), To: common.HexToAddress("0x464c71f6c2f760dda6093dcb91c24c39e5d6e18c"), Value: bi("2684459395462"), Index: bi("1000002131081530318762840784")},
		{From: common.HexToAddress("0xccaf0e1b0f70157d69dbe771dd2559dd70e78367"), To: common.HexToAddress("0x464c71f6c2f760dda6093dcb91c24c39e5d6e18c"), Value: bi("6568653843"), Index: bi("1000002131081530318762840784")},
	}
	r := NewRegistry()
	for i, fx := range fixtures {
		ev, ok, err := r.Decode("aave_v3_etherfi", fx.rawLog())
		require.NoError(t, err, fx.Provenance)
		require.True(t, ok, fx.Provenance)
		got := ev.(ATokenBalanceTransfer)
		require.Equal(t, want[i].From, got.From, fx.Provenance)
		require.Equal(t, want[i].To, got.To, fx.Provenance)
		require.Equal(t, 0, want[i].Value.Cmp(got.Value), fx.Provenance)
		require.Equal(t, 0, want[i].Index.Cmp(got.Index), fx.Provenance)
	}
}

// ---------------------------------------------------------------------------
// Chainlink fixture.
// ---------------------------------------------------------------------------

func TestFixtureChainlinkAnswerUpdated(t *testing.T) {
	fixtures := loadLogFixtures(t, "chainlink_answer_updated.json")
	requireRealFixtureCount(t, fixtures, 2)
	want := []ChainlinkAnswerUpdated{
		{Current: bi("99986785"), RoundId: bi("1084"), UpdatedAt: 1784707211},
		{Current: bi("99989289"), RoundId: bi("1083"), UpdatedAt: 1784703635},
	}
	r := NewRegistry()
	for i, fx := range fixtures {
		ev, ok, err := r.Decode("chainlink_feed", fx.rawLog())
		require.NoError(t, err, fx.Provenance)
		require.True(t, ok, fx.Provenance)
		got := ev.(ChainlinkAnswerUpdated)
		require.Equal(t, 0, want[i].Current.Cmp(got.Current), fx.Provenance)
		require.Equal(t, 0, want[i].RoundId.Cmp(got.RoundId), fx.Provenance)
		require.Equal(t, want[i].UpdatedAt, got.UpdatedAt, fx.Provenance)
	}
}

// ---------------------------------------------------------------------------
// Migration calldata fixtures.
// ---------------------------------------------------------------------------

type migrationCalldataFixture struct {
	Provenance         string            `json:"provenance"`
	Synthetic          bool              `json:"synthetic"`
	ChainID            uint64            `json:"chainId"`
	BlockNumber        uint64            `json:"blockNumber"`
	TxHash             string            `json:"txHash"`
	Selector           string            `json:"selector"`
	Input              string            `json:"input"`
	WantSeedCount      int               `json:"wantSeedCount"`
	WantFirstSeed      map[string]string `json:"wantFirstSeed"`
	WantLastSeed       map[string]string `json:"wantLastSeed"`
	WantSeedByBorrower map[string]string `json:"wantSeedByBorrower"`
}

func loadMigrationCalldataFixture(t *testing.T, name string) migrationCalldataFixture {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join("testdata", name))
	require.NoError(t, err)
	var fx migrationCalldataFixture
	require.NoError(t, json.Unmarshal(raw, &fx))
	return fx
}

func TestDecodeMigrationCalldataCommitAndExecute(t *testing.T) {
	fx := loadMigrationCalldataFixture(t, "migration_calldata_commit_and_execute.json")
	require.False(t, fx.Synthetic, fx.Provenance)
	seeds, err := DecodeMigrationCalldata(common.FromHex(fx.Input))
	require.NoError(t, err, fx.Provenance)
	require.Len(t, seeds, fx.WantSeedCount, fx.Provenance)

	require.Equal(t, common.HexToAddress(fx.WantFirstSeed["borrower"]), seeds[0].Borrower)
	require.Equal(t, 0, bi(fx.WantFirstSeed["normalizedAmount"]).Cmp(seeds[0].NormalizedAmount))

	last := seeds[len(seeds)-1]
	require.Equal(t, common.HexToAddress(fx.WantLastSeed["borrower"]), last.Borrower)
	require.Equal(t, 0, bi(fx.WantLastSeed["normalizedAmount"]).Cmp(last.NormalizedAmount))

	// recon "Migration finding": Safe 0xac5f3ce9...5fcc's debt genesis is this
	// exact migration batch, with zero Borrowed events in its history.
	for wantBorrower, wantAmount := range fx.WantSeedByBorrower {
		found := false
		for _, s := range seeds {
			if s.Borrower == common.HexToAddress(wantBorrower) {
				require.Equal(t, 0, bi(wantAmount).Cmp(s.NormalizedAmount), wantBorrower)
				found = true
			}
		}
		require.True(t, found, "expected borrower %s among the decoded seeds", wantBorrower)
	}
}

func TestDecodeMigrationCalldataExecute302(t *testing.T) {
	fx := loadMigrationCalldataFixture(t, "migration_calldata_execute302.json")
	require.False(t, fx.Synthetic, fx.Provenance)
	seeds, err := DecodeMigrationCalldata(common.FromHex(fx.Input))
	require.NoError(t, err, fx.Provenance)
	require.Len(t, seeds, fx.WantSeedCount, fx.Provenance)
	require.Equal(t, common.HexToAddress(fx.WantFirstSeed["borrower"]), seeds[0].Borrower)
	require.Equal(t, 0, bi(fx.WantFirstSeed["normalizedAmount"]).Cmp(seeds[0].NormalizedAmount))
}

// TestMigrationEventAndCalldataCountsAgree cross-checks the
// MigrationBorrowerPositionsSet.Count field against the independently
// decoded calldata seed count for the same two real transactions.
func TestMigrationEventAndCalldataCountsAgree(t *testing.T) {
	logFixtures := loadLogFixtures(t, "dm_migration_borrower_positions_set.json")
	r := NewRegistry()

	commit := loadMigrationCalldataFixture(t, "migration_calldata_commit_and_execute.json")
	seeds, err := DecodeMigrationCalldata(common.FromHex(commit.Input))
	require.NoError(t, err)
	var eventForCommit DMMigrationBorrowerPositionsSet
	for _, fx := range logFixtures {
		if fx.TxHash == commit.TxHash {
			ev, ok, decErr := r.Decode("debt_manager", fx.rawLog())
			require.NoError(t, decErr)
			require.True(t, ok)
			eventForCommit = ev.(DMMigrationBorrowerPositionsSet)
		}
	}
	require.Equal(t, 0, big.NewInt(int64(len(seeds))).Cmp(eventForCommit.Count))

	exec302 := loadMigrationCalldataFixture(t, "migration_calldata_execute302.json")
	seeds2, err := DecodeMigrationCalldata(common.FromHex(exec302.Input))
	require.NoError(t, err)
	var eventForExec DMMigrationBorrowerPositionsSet
	for _, fx := range logFixtures {
		if fx.TxHash == exec302.TxHash {
			ev, ok, decErr := r.Decode("debt_manager", fx.rawLog())
			require.NoError(t, decErr)
			require.True(t, ok)
			eventForExec = ev.(DMMigrationBorrowerPositionsSet)
		}
	}
	require.Equal(t, 0, big.NewInt(int64(len(seeds2))).Cmp(eventForExec.Count))
}
