package decode

import (
	"math/big"

	"github.com/ethereum/go-ethereum/common"
)

// Event is the common interface satisfied by every typed, decoded log payload
// in this package. Concrete types below carry exact fields per
// recon/derivation-notes.md "Debt Manager event semantics" and "Aave
// derivation model" -- field meanings, indexing and units come from there,
// not from guessing at names.
type Event interface {
	Name() string
}

// ---------------------------------------------------------------------------
// Debt Manager (OP, engine "debt_manager") events.
// ---------------------------------------------------------------------------

// DMBorrowed corresponds to Borrowed(address indexed user, address indexed
// token, uint256 amount). Amount is TOKEN-NATIVE decimals (NOT USD) -- see
// recon "Debt Manager event semantics" row "Borrowed".
type DMBorrowed struct {
	User, Token common.Address
	Amount      *big.Int
}

func (DMBorrowed) Name() string { return "DMBorrowed" }

// DMRepaid corresponds to Repaid(address indexed user, address indexed
// payer, address indexed token, uint256 amount). UsdAmount is USD 6-decimals
// (asymmetric with DMBorrowed's token-native units, per recon).
type DMRepaid struct {
	User, Payer, Token common.Address
	UsdAmount          *big.Int
}

func (DMRepaid) Name() string { return "DMRepaid" }

// DMSupplied corresponds to Supplied(address indexed sender, address indexed
// user, address indexed token, uint256 amount). Sender pays; user is
// credited with supplier shares -- they differ when supplying on behalf of
// another account (recon caveat (d)).
type DMSupplied struct {
	Sender, User, Token common.Address
	Amount              *big.Int
}

func (DMSupplied) Name() string { return "DMSupplied" }

// DMWithdrawBorrowToken corresponds to WithdrawBorrowToken(address indexed
// withdrawer, address indexed borrowToken, uint256 amount).
type DMWithdrawBorrowToken struct {
	Withdrawer, BorrowToken common.Address
	Amount                  *big.Int
}

func (DMWithdrawBorrowToken) Name() string { return "DMWithdrawBorrowToken" }

// LiquidationTokenData is one element of DMLiquidated's collateral tuple
// array: Amount is the TOTAL collateral token units sent to the liquidator
// INCLUDING the bonus; Bonus is the bonus portion of Amount (recon caveat (c)).
type LiquidationTokenData struct {
	Token         common.Address
	Amount, Bonus *big.Int
}

// DMLiquidated corresponds to Liquidated(address indexed liquidator, address
// indexed user, address indexed debtTokenToLiquidate, (address,uint256,uint256)[]
// userCollateralLiquidated, uint256 beforeDebtAmount, uint256 debtAmountLiquidated).
// BeforeDebtUsd/DebtLiquidatedUsd are USD 6-decimals. May be emitted up to
// twice per liquidate() call (recon).
type DMLiquidated struct {
	Liquidator, User, DebtToken      common.Address
	Collateral                       []LiquidationTokenData
	BeforeDebtUsd, DebtLiquidatedUsd *big.Int
}

func (DMLiquidated) Name() string { return "DMLiquidated" }

// DMInterestIndexUpdated corresponds to InterestIndexUpdated(address indexed
// borrowToken, uint256 oldIndex, uint256 newIndex). Index is a 1e18
// fixed-point scale (recon).
type DMInterestIndexUpdated struct {
	Token              common.Address
	OldIndex, NewIndex *big.Int
}

func (DMInterestIndexUpdated) Name() string { return "DMInterestIndexUpdated" }

// DMBorrowApySet corresponds to BorrowApySet(address indexed token, uint256
// oldApy, uint256 newApy).
type DMBorrowApySet struct {
	Token          common.Address
	OldApy, NewApy *big.Int
}

func (DMBorrowApySet) Name() string { return "DMBorrowApySet" }

// BorrowTokenConfig is DebtManagerStorageContract.BorrowTokenConfig: the
// non-indexed tuple payload of BorrowTokenConfigSet.
type BorrowTokenConfig struct {
	InterestIndexSnapshot          *big.Int
	TotalNormalizedBorrowingAmount *big.Int
	TotalSharesOfBorrowTokens      *big.Int
	LastUpdateTimestamp            uint64
	BorrowApy                      uint64
	MinShares                      *big.Int
}

// DMBorrowTokenConfigSet corresponds to BorrowTokenConfigSet(address indexed
// token, BorrowTokenConfig config).
type DMBorrowTokenConfigSet struct {
	Token  common.Address
	Config BorrowTokenConfig
}

func (DMBorrowTokenConfigSet) Name() string { return "DMBorrowTokenConfigSet" }

// DMCollateralTokenAdded corresponds to CollateralTokenAdded(address token)
// (non-indexed).
type DMCollateralTokenAdded struct {
	Token common.Address
}

func (DMCollateralTokenAdded) Name() string { return "DMCollateralTokenAdded" }

// DMCollateralTokenRemoved corresponds to CollateralTokenRemoved(address token)
// (non-indexed).
type DMCollateralTokenRemoved struct {
	Token common.Address
}

func (DMCollateralTokenRemoved) Name() string { return "DMCollateralTokenRemoved" }

// CollateralTokenConfig is DebtManagerStorageContract.CollateralTokenConfig.
// LTV/LiquidationThreshold/LiquidationBonus are 1e18-scaled percentages
// (uint80/uint80/uint96 in the ABI, all wide enough that go-ethereum unpacks
// them as *big.Int).
type CollateralTokenConfig struct {
	LTV, LiquidationThreshold, LiquidationBonus *big.Int
}

// DMCollateralTokenConfigSet corresponds to CollateralTokenConfigSet(address
// indexed collateralToken, CollateralTokenConfig oldConfig, CollateralTokenConfig newConfig).
type DMCollateralTokenConfigSet struct {
	CollateralToken      common.Address
	OldConfig, NewConfig CollateralTokenConfig
}

func (DMCollateralTokenConfigSet) Name() string { return "DMCollateralTokenConfigSet" }

// DMMigrationBorrowerPositionsSet corresponds to
// MigrationBorrowerPositionsSet(address indexed token, uint256 count) --
// topic0 0x3f1c4431cbe26a58837755d2461e40a6561ee3edd0e31ca91edb845637acda8b,
// emitted by a since-replaced Debt Manager implementation (not present in the
// current recon/cash-v3 ABI dumps; the minimal ABI entry is hand-constructed
// in decode.go and validated against real migration transactions -- see
// testdata/dm_migration_borrower_positions_set.json and
// testdata/migration_calldata_*.json). The per-borrower payload is NOT in
// this log; it lives in the triggering tx's calldata, decoded separately by
// DecodeMigrationCalldata (recon "Migration finding").
type DMMigrationBorrowerPositionsSet struct {
	Token common.Address
	Count *big.Int
}

func (DMMigrationBorrowerPositionsSet) Name() string { return "DMMigrationBorrowerPositionsSet" }

// MigrationSeed is one (borrower, normalizedAmount) pair recovered from a
// migration transaction's commitAndExecute/execute302 calldata by
// DecodeMigrationCalldata. NormalizedAmount is already in the Debt Manager's
// normalized (1e18-index-relative) units -- no index division needed when
// seeding position_events (recon "Migration finding"; plan.md Task 5).
type MigrationSeed struct {
	Borrower         common.Address
	NormalizedAmount *big.Int
}

// ---------------------------------------------------------------------------
// Aave v3 ether.fi-market Pool (ETH, engine "aave_v3_etherfi") events.
// ---------------------------------------------------------------------------

// AaveBorrow corresponds to Borrow(address indexed reserve, address user,
// address indexed onBehalfOf, uint256 amount, DataTypes.InterestRateMode
// interestRateMode, uint256 borrowRate, uint16 indexed referralCode).
// OnBehalfOf is the account whose scaled debt increases (recon "Aave
// derivation model"); User is the caller (may differ under delegation).
type AaveBorrow struct {
	Reserve, User, OnBehalfOf common.Address
	Amount                    *big.Int
	InterestRateMode          uint8
	BorrowRate                *big.Int
}

func (AaveBorrow) Name() string { return "AaveBorrow" }

// AaveRepay corresponds to Repay(address indexed reserve, address indexed
// user, address indexed repayer, uint256 amount, bool useATokens).
type AaveRepay struct {
	Reserve, User, Repayer common.Address
	Amount                 *big.Int
	UseATokens             bool
}

func (AaveRepay) Name() string { return "AaveRepay" }

// AaveSupply corresponds to Supply(address indexed reserve, address user,
// address indexed onBehalfOf, uint256 amount, uint16 indexed referralCode).
type AaveSupply struct {
	Reserve, User, OnBehalfOf common.Address
	Amount                    *big.Int
}

func (AaveSupply) Name() string { return "AaveSupply" }

// AaveWithdraw corresponds to Withdraw(address indexed reserve, address
// indexed user, address indexed to, uint256 amount).
type AaveWithdraw struct {
	Reserve, User, To common.Address
	Amount            *big.Int
}

func (AaveWithdraw) Name() string { return "AaveWithdraw" }

// AaveLiquidationCall corresponds to LiquidationCall(address indexed
// collateralAsset, address indexed debtAsset, address indexed user, uint256
// debtToCover, uint256 liquidatedCollateralAmount, address liquidator, bool
// receiveAToken). Debt side = DebtToCover (recon "Aave derivation model").
type AaveLiquidationCall struct {
	CollateralAsset, DebtAsset, User, Liquidator common.Address
	DebtToCover, LiquidatedCollateralAmount      *big.Int
	ReceiveAToken                                bool
}

func (AaveLiquidationCall) Name() string { return "AaveLiquidationCall" }

// AaveReserveDataUpdated corresponds to ReserveDataUpdated(address indexed
// reserve, uint256 liquidityRate, uint256 stableBorrowRate, uint256
// variableBorrowRate, uint256 liquidityIndex, uint256 variableBorrowIndex).
// StableBorrowRate is intentionally omitted: this v3.3-line deployment has no
// stable-rate borrowing (recon "Aave derivation model").
type AaveReserveDataUpdated struct {
	Reserve                                                                common.Address
	LiquidityRate, VariableBorrowRate, LiquidityIndex, VariableBorrowIndex *big.Int
}

func (AaveReserveDataUpdated) Name() string { return "AaveReserveDataUpdated" }

// AaveDeficitCreated corresponds to DeficitCreated(address indexed user,
// address indexed debtAsset, uint256 amountCreated) -- a bad-debt burn (recon
// "Aave derivation model").
type AaveDeficitCreated struct {
	User, DebtAsset common.Address
	AmountCreated   *big.Int
}

func (AaveDeficitCreated) Name() string { return "AaveDeficitCreated" }

// ---------------------------------------------------------------------------
// aToken (ETH, engine "aave_v3_etherfi") events -- collateral-side scaled
// balance streams, since Pool logs alone are debt-exact but not
// collateral-exact (recon "Aave derivation model").
// ---------------------------------------------------------------------------

// ATokenTransfer corresponds to the standard ERC20 Transfer(address indexed
// from, address indexed to, uint256 value).
//
// RECORD-ONLY: nominal units, always an overlapping view of a Mint/Burn/
// BalanceTransfer in the same tx; never fold.
type ATokenTransfer struct {
	From, To common.Address
	Value    *big.Int
}

func (ATokenTransfer) Name() string { return "ATokenTransfer" }

// ATokenMint corresponds to Mint(address caller, address indexed onBehalfOf,
// uint256 value, uint256 balanceIncrease, uint256 index) -- Index is the
// liquidity index (ray) at mint time.
//
// Value is NOT the action principal, and a Mint event does NOT imply a mint
// action. Per Aave's ScaledBalanceTokenBase there are three emission paths:
//   - _mintScaled (direct supply/deposit): Value = actionAmount + BalanceIncrease;
//     here Value==BalanceIncrease means actionAmount == 0 (pure interest
//     capitalization, zero principal minted).
//   - _burnScaled (withdrawal where accrued interest EXCEEDS the burn action):
//     a Mint is emitted with Value = BalanceIncrease - actionAmount — the
//     plus-formula does NOT apply on this path.
//   - transfers: interest-only Mints may be emitted for either party's accrual.
// BalanceIncrease is interest accrued since the account's last index
// checkpoint in every path. Scaled deltas must be derived from the deployed
// implementation's source, branching on the originating action, never from
// Value alone (see plan Task 6).
type ATokenMint struct {
	Caller, OnBehalfOf            common.Address
	Value, BalanceIncrease, Index *big.Int
}

func (ATokenMint) Name() string { return "ATokenMint" }

// ATokenBurn corresponds to Burn(address indexed from, address indexed
// target, uint256 value, uint256 balanceIncrease, uint256 index).
//
// Value is NOT the action principal: per Aave's ScaledBalanceTokenBase, Value
// = actionAmount - BalanceIncrease (BalanceIncrease is interest accrued since
// the account's last index checkpoint, netted against the burned amount, not
// added to it as in Mint); scaled deltas must be derived from the deployed
// implementation's source (see plan Task 6). Value==BalanceIncrease therefore
// means actionAmount == 2*BalanceIncrease -- NOT zero principal (that reading
// only holds for Mint, where the sign is reversed).
type ATokenBurn struct {
	From, Target                  common.Address
	Value, BalanceIncrease, Index *big.Int
}

func (ATokenBurn) Name() string { return "ATokenBurn" }

// ATokenBalanceTransfer corresponds to BalanceTransfer(address indexed from,
// address indexed to, uint256 value, uint256 index) -- a plain aToken
// transfer moving SCALED balance between accounts without mint/burn. Not in
// Task 4's minimum event roster, but required by the Phase 2 plan's Task 6
// Aave-deriver semantics ("Transfer/BalanceTransfer -> scaled moves between
// accounts"); added here as a documented beyond-brief addition (see task
// report).
//
// Value is ALREADY SCALED; apply exactly once per peer transfer.
type ATokenBalanceTransfer struct {
	From, To     common.Address
	Value, Index *big.Int
}

func (ATokenBalanceTransfer) Name() string { return "ATokenBalanceTransfer" }

// ---------------------------------------------------------------------------
// Chainlink raw aggregator (ETH, engine "chainlink_feed") event.
// ---------------------------------------------------------------------------

// ChainlinkAnswerUpdated corresponds to AnswerUpdated(int256 indexed current,
// uint256 indexed roundId, uint256 updatedAt).
type ChainlinkAnswerUpdated struct {
	Current, RoundId *big.Int
	UpdatedAt        uint64
}

func (ChainlinkAnswerUpdated) Name() string { return "ChainlinkAnswerUpdated" }
