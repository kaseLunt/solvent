// Aave v3 ether.fi-market deriver (engine "aave_v3_etherfi", ETH chain 1):
// variable debt folded exactly from Pool logs, collateral folded exactly from
// the four aToken streams. All fold semantics below were derived from the
// VERIFIED SOURCE of the deployed implementations (Blockscout verified-source
// API, fetched 2026-07-23), NOT from aave-v3-origin prose or any plan sketch.
//
// # Deployed-implementation provenance (EIP-1967 slot + Upgraded logs)
//
// The four aToken proxies (config/contracts.json eth:atoken-* streams) share
// one implementation at every point in history; likewise the variableDebtToken
// proxies. Upgrade history (Upgraded topic0 0xbc7cd75a..., verified on the
// weETH aToken 0xbe1F842e...29db and the USDC vToken 0x9355032d...cdB7; the
// Pool proxy upgraded in the same governance txs):
//
//	blocks 20625519..22839361  aToken 0xaffa06528bd92625de2e7a0cfa0119319265ea4b, vToken 0xbb077daffeb23b2126e7358b0b122ba6838fb881 (v3.1/3.2-line)
//	blocks 22839362..23088583  aToken 0x80b0486a9d985f3ad918c9b1b1e19d724a1c99b7, vToken 0xb7cdaec5fc1855040df499b8ebe49ca9ac1bdd4b (v3.4-line)
//	blocks 23088584..24196551  aToken 0xaa7448de2be3ebdf9b5b0fa614accd119b3898bc, vToken 0x9e44ea10b070f6c8f02ccb7657e62d3a335756fb (v3.5-line, TokenMath)
//	blocks 24196552..          aToken 0xdc7b6b0acf2fb6927526e2c501de41eaeae8702a, vToken 0x1d5e86f59069c1af086607a56d2d7df6f440a5f2 (v3.5-line, TokenMath)
//
// The two v3.5-line token implementations are BYTE-IDENTICAL in
// ScaledBalanceTokenBase.sol and TokenMath.sol (diffed during authoring), so
// there are exactly TWO fold regimes, switching at block 23088584:
//
// # Regime A (blocks < 23088584): half-up rayDiv/rayMul inside the token
//
// WadRayMath.sol (identical in both regime-A impls) rayDiv :104-112 rounds
// HALF-UP: c = (a*RAY + b/2) / b; rayMul :64-72: c = (a*b + RAY/2) / RAY.
//
// aToken ScaledBalanceTokenBase.sol (impl 0xaffa0652..., lines cited; impl
// 0x80b0486a... is line-shifted but formula-identical: :74/:85/:108/:119-126):
//   - _mintScaled :66-88: amountScaled = amount.rayDiv(index) (:72);
//     Mint.Value = amount + balanceIncrease (:83). So the scaled delta is
//     +rayDivHalfUp(Value - BalanceIncrease, index).
//   - _burnScaled :99-120: amountScaled = amount.rayDiv(index) (:100); when
//     accrued interest EXCEEDS the burn amount it emits Mint with
//     Value = balanceIncrease - amount (:111-114) -> scaled delta
//     -rayDivHalfUp(BalanceIncrease - Value, index); otherwise Burn with
//     Value = amount - balanceIncrease (:116-118) -> scaled delta
//     -rayDivHalfUp(Value + BalanceIncrease, index).
//   - _transfer :130-155: moves amount.rayDiv(index) scaled (:142); emits
//     pure-interest Mints with Value == BalanceIncrease for either party's
//     accrual (:144-152, delta 0 here since the move is carried by
//     BalanceTransfer); ERC20 Transfer logs the NOMINAL amount (:154).
//     AToken.sol :188 emits BalanceTransfer(from, to, amount.rayDiv(index),
//     index) — Value ALREADY SCALED (era-2 AToken.sol :206/:221 identical).
//
// vToken (impl 0xbb077daf... VariableDebtToken.sol mint :64-74, burn :77-84;
// impl 0xb7cdaec5... :69-79/:83-89) routes the Pool's NOMINAL amount through
// the same half-up _mintScaled/_burnScaled (SBTB :72/:100 resp. :74/:108),
// and every regime-A Pool passes the event amount verbatim: genesis Pool impl
// 0xf231d3e8... BorrowLogic.sol :127 (mint params.amount) / :221-225 (burn
// paybackAmount, = Repay.Value), LiquidationLogic.sol :323-345 (burn
// actualDebtToLiquidate = LiquidationCall.debtToCover); v3.4 Pool impl
// 0x0ad7e5c1... BorrowLogic.sol :73/:159, LiquidationLogic.sol :520-530.
//
// # Regime B (blocks >= 23088584): TokenMath floor/ceil, Pool-computed scaled
//
// TokenMath.sol (byte-identical in impls 0xaa7448de/0xdc7b6b0a and Pool impls
// 0x999c94f2/0x0f3bceb6): getATokenBalance :66-71 = rayMulFloor;
// getVTokenBalance :108-113 = rayMulCeil; getVTokenMintScaledAmount :80-85 =
// rayDivCeil; getVTokenBurnScaledAmount :94-99 = rayDivFloor. WadRayMath
// rayMulFloor :74-83, rayMulCeil :85-95, rayDivCeil :114-123, rayDivFloor
// :125-133.
//
// Debt (Pool passes the scaled amount; event amounts are NOMINAL):
//   - Borrow: BorrowLogic.sol (impl 0x999c94f2) :55 mints
//     amount.getVTokenMintScaledAmount(index) -> +rayDivCeil(amount, vbIndex).
//   - Repay: BorrowLogic.sol :181-183 burns
//     paybackAmount.getVTokenBurnScaledAmount(index) -> -rayDivFloor(amount, vbIndex).
//   - LiquidationCall: LiquidationLogic.sol :546-556 burns
//     (hasNoCollateralLeft ? borrowerReserveDebt : actualDebtToLiquidate)
//     .getVTokenBurnScaledAmount(index); the event's debtToCover =
//     actualDebtToLiquidate. Without a deficit this is
//     -rayDivFloor(debtToCover, vbIndex).
//   - DeficitCreated: LiquidationLogic.sol :560-563 — emitted (BEFORE the
//     tx-final LiquidationCall event) when hasNoCollateralLeft, after a burn
//     of borrowerReserveDebt = rayMulCeil(scaledDebt, index) (:208). Since
//     rayDivFloor(rayMulCeil(s, i), i) == s for every index i >= RAY, that
//     burn removes EXACTLY the user's whole scaled debt; same for the
//     bad-debt loop over the user's other borrowed reserves (:671-709, which
//     emits DeficitCreated with no LiquidationCall pairing). The fold
//     therefore zeroes the tracked scaled debt at DeficitCreated and treats a
//     same-tx LiquidationCall for the same (user, debtAsset) as delta 0 —
//     exact in both regimes and independent of event order and of any index.
//     (Regime A's v3.3/v3.4 deficit burn is the half-up round-trip
//     rayDivHalfUp(rayMulHalfUp(s, i), i) == s, i >= RAY — same conclusion.)
//     The regime-A deficit at block 22014623 (era Pool 0x56401d66...) and the
//     three regime-B deficits are all covered by the golden replay.
//
// Collateral (the events carry BALANCE-DERIVED nominal values; the scaled
// delta is NOT computable from the event alone — it must be inverted against
// the account's tracked scaled balance s, ScaledBalanceTokenBase.sol impl
// 0xdc7b6b0a...):
//   - _mintScaled :69-92: Mint.Value = bal(s+a, i) - bal(s, p) (:79,:87-89)
//     and BalanceIncrease = bal(s, i) - bal(s, p) (:81), where bal =
//     TokenMath.getATokenBalance = rayMulFloor and p is the account's
//     previous index checkpoint. Hence bal(s', i) = rayMulFloor(s, i) +
//     Value - BalanceIncrease, where s' = s + a — the p-dependence cancels.
//   - _burnScaled :105-134: burn branch :127-130 gives Value = bal(s, p) -
//     bal(s-a, i), so bal(s', i) = rayMulFloor(s, i) - Value -
//     BalanceIncrease; the interest-exceeds-burn branch emits Mint (:123-126)
//     and is covered by the Mint identity above (s' < s there).
//   - AToken.sol :279-311 (_transfer): pure-interest Mints with Value ==
//     BalanceIncrease (:299-307, s' = s under the same identity); ERC20
//     Transfer logs the NOMINAL amount (:309, record-only); BalanceTransfer
//     (:310) carries the SCALED amount.
//
// Given the target nominal N = bal(s', i), s' is recovered as
// ceil(N*RAY / i): the true s' satisfies s'*i in [N*RAY, (N+1)*RAY) and is
// the UNIQUE such integer whenever i >= RAY (each scaled wei moves the floor
// balance by >= 1), so the smallest integer in the interval is s' itself. The
// recovery is verified (rayMulFloor(s', i) == N) and any mismatch is a loud
// error. Validated bit-exact against archive scaledBalanceOf on the committed
// liquidation tx 0x7714dcf7...c09d during authoring.
//
// # Caveat: Pool impl 0xbe82113a... (blocks 24196552..24920566) is unverified
//
// That Pool era's source is not verified on Blockscout/Sourcify/Etherscan.
// Its fold-relevant semantics are pinned by (a) the verified Pool impls
// sandwiching it (0x999c94f2 before, 0x0f3bceb6 after) having IDENTICAL
// fold-relevant call sites, (b) its paired era-4 vToken 0x1d5e86f5... being
// verified and requiring TokenMath-scaled inputs, and (c) the golden replay
// covering the era's action events (3 repays + 1 deficit/liquidation pair)
// bit-exactly.
//
// # Index sourcing (debt folds)
//
// Every debt action needs the reserve's variableBorrowIndex as of its own tx.
// ReserveDataUpdated is emitted by updateInterestRates AFTER updateState and
// BEFORE the action event in the same tx (e.g. BorrowLogic.sol 0x999c94f2:
// mint :77 -> updateInterestRates -> emit Borrow; LiquidationLogic.sol :573
// -> emit LiquidationCall :425-434), carrying exactly the
// nextVariableBorrowIndex the action used. The deriver caches the latest
// ReserveDataUpdated per reserve and errors loudly if an action arrives with
// no cached index. (DeficitCreated is the one action emitted before its
// reserve's ReserveDataUpdated — LiquidationLogic.sol :563 vs :573 — and
// deliberately needs NO index under the zero-out fold above.)
//
// # PositionEvent conventions
//
// Sides: debt events use Side "debt", collateral events "collateral";
// balances are stored SCALED (ray-index-relative token units). Record-only
// events (Side "", Delta nil): aToken ERC20 Transfer (nominal, always an
// overlapping view of a Mint/Burn/BalanceTransfer in the same tx — NEVER
// folded), Pool Supply/Withdraw (collateral truth comes exclusively from the
// aToken streams), and ReserveDataUpdated.
//
// Seq: every event maps to a single PositionEvent with Seq 0, EXCEPT
// ATokenBalanceTransfer which fans out into two: Seq 0 = sender (-Value),
// Seq 1 = recipient (+Value).
//
// rate_indexes: each ReserveDataUpdated yields a record-only PositionEvent
// with EventType "aave_reserve_data_updated", Asset = reserve, and Payload
// keys "variable_borrow_index" and "liquidity_index" (decimal strings) —
// exactly the (asset, block, kind, value) tuples the runner persists via
// store.SaveRateIndex(engine, asset, blockNumber, kind, value).
package derive

import (
	"encoding/hex"
	"fmt"
	"math/big"

	"github.com/ethereum/go-ethereum/common"

	"github.com/kaselunt/solvent/internal/decode"
	"github.com/kaselunt/solvent/internal/store"
)

// AaveEngineName is the engine identifier shared with config/contracts.json
// and the decode registry.
const AaveEngineName = "aave_v3_etherfi"

// aaveTokenMathFromBlock is the first block of fold regime B: the governance
// tx 0xa17567fa201a78b66c43e6ab178559f8c1d5d308fe944c0bd2c39b5e585097dc at
// block 23088584 upgraded the Pool and every aToken/vToken implementation to
// the v3.5 TokenMath (floor/ceil) line in one transaction. The upgrade txs
// carry no Mint/Burn/Transfer/BalanceTransfer or Pool action logs (verified
// against the committed fixtures), so a block-level switch is exact.
const aaveTokenMathFromBlock = 23088584

// rayUnit is WadRayMath.RAY = 1e27 (WadRayMath.sol :23).
var rayUnit = new(big.Int).Exp(big.NewInt(10), big.NewInt(27), nil)

// aaveATokenReserve maps each pinned aToken stream address to its underlying
// reserve, per AaveProtocolDataProvider 0x7c8509591f9693D21280d96e149a08A3bf69Cd0c
// getReserveTokensAddresses, code-verified 2026-07-23 (recon "Asset registry"
// lists the reserves; config/contracts.json pins the aToken addresses).
var aaveATokenReserve = map[common.Address]common.Address{
	common.HexToAddress("0xbe1F842e7e0afd2c2322aae5d34bA899544b29db"): common.HexToAddress("0xCd5fE23C85820F7B72D0926FC9b05b43E359b7ee"), // aEthEtherFiweETH -> weETH
	common.HexToAddress("0x7380c583cDe4409eFF5DD3320D93a45D96B80E2e"): common.HexToAddress("0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48"), // aEthEtherFiUSDC -> USDC
	common.HexToAddress("0xdF7f48892244C6106EA784609f7de10AB36F9c7e"): common.HexToAddress("0x6c3ea9036406852006290770BEdFcAbA0e23A0e8"), // aEthEtherFiPYUSD -> PYUSD
	common.HexToAddress("0x6914ECCf50837dC61b43ee478a9BD9B439648956"): common.HexToAddress("0x853d955aCEf822Db058eb8505911ED77F175b99e"), // aEthEtherFiFRAX -> FRAX
}

// ---------------------------------------------------------------------------
// WadRayMath primitives, implemented exactly per the deployed sources.
// ---------------------------------------------------------------------------

// rayDivHalfUp is WadRayMath.rayDiv (:104-112, regime-A impls): half-up
// division, c = (a*RAY + b/2) / b.
func rayDivHalfUp(a, b *big.Int) *big.Int {
	n := new(big.Int).Mul(a, rayUnit)
	n.Add(n, new(big.Int).Rsh(b, 1))
	return n.Div(n, b)
}

// rayDivFloor is WadRayMath.rayDivFloor (:125-133): c = a*RAY / b.
func rayDivFloor(a, b *big.Int) *big.Int {
	n := new(big.Int).Mul(a, rayUnit)
	return n.Div(n, b)
}

// rayDivCeil is WadRayMath.rayDivCeil (:114-123): c = ceil(a*RAY / b).
func rayDivCeil(a, b *big.Int) *big.Int {
	n := new(big.Int).Mul(a, rayUnit)
	q, r := new(big.Int).QuoRem(n, b, new(big.Int))
	if r.Sign() != 0 {
		q.Add(q, big.NewInt(1))
	}
	return q
}

// rayMulHalfUp is WadRayMath.rayMul (:64-72, regime-A impls): half-up
// multiplication, c = (a*b + RAY/2) / RAY.
func rayMulHalfUp(a, b *big.Int) *big.Int {
	n := new(big.Int).Mul(a, b)
	n.Add(n, new(big.Int).Rsh(rayUnit, 1))
	return n.Div(n, rayUnit)
}

// rayMulFloor is WadRayMath.rayMulFloor (:74-83): c = a*b / RAY.
func rayMulFloor(a, b *big.Int) *big.Int {
	n := new(big.Int).Mul(a, b)
	return n.Div(n, rayUnit)
}

// rayMulCeil is WadRayMath.rayMulCeil (:85-95): c = ceil(a*b / RAY).
func rayMulCeil(a, b *big.Int) *big.Int {
	n := new(big.Int).Mul(a, b)
	q, r := new(big.Int).QuoRem(n, rayUnit, new(big.Int))
	if r.Sign() != 0 {
		q.Add(q, big.NewInt(1))
	}
	return q
}

// ---------------------------------------------------------------------------
// Engine.
// ---------------------------------------------------------------------------

// aaveReserveRates is the cached payload of the latest ReserveDataUpdated
// seen for a reserve.
type aaveReserveRates struct {
	variableBorrowIndex *big.Int
	liquidityIndex      *big.Int
	block               uint64
}

// AaveEngine folds decoded aave_v3_etherfi logs into scaled-balance position
// events. It is stateful (tracked scaled balances, cached reserve indexes,
// same-tx deficit pairing) and MUST be fed the engine's logs in ascending
// (block, logIndex) order from the engine's genesis (block 20625519) — the
// regime-B collateral inversion and the deficit zero-out are exact only
// against complete tracked state. Determinism: identical log sequences
// produce identical events (map iteration order is never observable).
type AaveEngine struct {
	rates      map[common.Address]*aaveReserveRates           // reserve -> latest ReserveDataUpdated
	debt       map[common.Address]map[common.Address]*big.Int // reserve -> account -> scaled variable debt
	collateral map[common.Address]map[common.Address]*big.Int // reserve -> account -> scaled aToken balance
	curTx      string                                         // lowercase hex of the tx the deficit markers belong to
	deficits   map[string]bool                                // "user|debtAsset" seen in curTx
}

// NewAaveEngine returns an empty AaveEngine positioned at engine genesis.
func NewAaveEngine() *AaveEngine {
	return &AaveEngine{
		rates:      make(map[common.Address]*aaveReserveRates),
		debt:       make(map[common.Address]map[common.Address]*big.Int),
		collateral: make(map[common.Address]map[common.Address]*big.Int),
		deficits:   make(map[string]bool),
	}
}

// Name implements Engine.
func (e *AaveEngine) Name() string { return AaveEngineName }

// tokenMathRegime reports whether block folds under regime B (v3.5 TokenMath
// floor/ceil) rather than regime A (half-up in-token rayDiv/rayMul).
func tokenMathRegime(block uint64) bool { return block >= aaveTokenMathFromBlock }

func aaveBalance(m map[common.Address]map[common.Address]*big.Int, reserve, account common.Address) *big.Int {
	if inner, ok := m[reserve]; ok {
		if v, ok := inner[account]; ok {
			return v
		}
	}
	return new(big.Int)
}

func aaveSetBalance(m map[common.Address]map[common.Address]*big.Int, reserve, account common.Address, v *big.Int) {
	inner, ok := m[reserve]
	if !ok {
		inner = make(map[common.Address]*big.Int)
		m[reserve] = inner
	}
	inner[account] = v
}

// event assembles a PositionEvent with the engine's identity fields filled.
func aaveEvent(l store.RawLog, seq uint16, eventType string, account, asset common.Address, side string, delta *big.Int, payload map[string]string) store.PositionEvent {
	return store.PositionEvent{
		ChainID:     l.ChainID,
		Engine:      AaveEngineName,
		BlockNumber: l.BlockNumber,
		TxHash:      l.TxHash,
		LogIndex:    l.LogIndex,
		Seq:         seq,
		EventType:   eventType,
		Account:     account.Bytes(),
		Asset:       asset.Bytes(),
		Side:        side,
		Delta:       delta,
		Payload:     payload,
	}
}

// requireIndex returns the cached variableBorrowIndex for reserve, erroring
// loudly when no ReserveDataUpdated has been seen — every debt action's own
// tx emits one first (see package comment), so a miss means the stream is
// incomplete or out of order.
func (e *AaveEngine) requireIndex(reserve common.Address, l store.RawLog, action string) (*big.Int, error) {
	r, ok := e.rates[reserve]
	if !ok {
		return nil, fmt.Errorf("aave: %s at block %d log %d (tx %x): no cached ReserveDataUpdated for reserve %s — action events are always preceded by their reserve's index update in the same tx; refusing to fold without it",
			action, l.BlockNumber, l.LogIndex, l.TxHash, reserve.Hex())
	}
	return r.variableBorrowIndex, nil
}

// requireRayIndex validates the liquidity/borrow index invariant i >= RAY
// that both the half-up round-trip identities and the regime-B inversion
// uniqueness proof rest on (indexes start at RAY and grow monotonically).
func requireRayIndex(i *big.Int, l store.RawLog, what string) error {
	if i == nil || i.Cmp(rayUnit) < 0 {
		return fmt.Errorf("aave: %s at block %d log %d (tx %x): index %v below RAY — violates the index >= RAY invariant every fold identity requires",
			what, l.BlockNumber, l.LogIndex, l.TxHash, i)
	}
	return nil
}

// invertScaledFromNominal recovers the account's new scaled balance s' from
// the target nominal balance N = getATokenBalance(s', i) = rayMulFloor(s', i)
// (regime B). s' = ceil(N*RAY / i) is the unique integer with that floor
// balance for i >= RAY (see package comment); the recovery is re-verified and
// a mismatch is a loud error (it means the tracked scaled state is wrong).
func invertScaledFromNominal(n, index *big.Int, l store.RawLog, what string) (*big.Int, error) {
	if n.Sign() < 0 {
		return nil, fmt.Errorf("aave: %s at block %d log %d (tx %x): inversion target nominal balance %s is negative — tracked scaled state is inconsistent with the event",
			what, l.BlockNumber, l.LogIndex, l.TxHash, n)
	}
	sPrime := rayDivCeil(n, index)
	if rayMulFloor(sPrime, index).Cmp(n) != 0 {
		return nil, fmt.Errorf("aave: %s at block %d log %d (tx %x): scaled-balance inversion failed — no integer s' has rayMulFloor(s', index) == %s (index %s); tracked scaled state is inconsistent with the event",
			what, l.BlockNumber, l.LogIndex, l.TxHash, n, index)
	}
	return sPrime, nil
}

// Process implements Engine. One decoded log in, zero or more position
// events out; see the package comment for the per-event semantics and their
// source citations.
func (e *AaveEngine) Process(l store.RawLog, d decode.Event) ([]store.PositionEvent, error) {
	// Same-tx deficit pairing: markers live only for the duration of one
	// transaction's log run (a tx's logs are contiguous in (block, logIndex)
	// order).
	if tx := hex.EncodeToString(l.TxHash); tx != e.curTx {
		e.curTx = tx
		e.deficits = make(map[string]bool)
	}

	switch ev := d.(type) {
	case decode.AaveReserveDataUpdated:
		return e.processReserveDataUpdated(l, ev)
	case decode.AaveBorrow:
		return e.processBorrow(l, ev)
	case decode.AaveRepay:
		return e.processRepay(l, ev)
	case decode.AaveLiquidationCall:
		return e.processLiquidationCall(l, ev)
	case decode.AaveDeficitCreated:
		return e.processDeficitCreated(l, ev)
	case decode.AaveSupply:
		// Record-only: collateral truth comes exclusively from the aToken
		// streams (folding Supply too would double-count the Mint).
		return []store.PositionEvent{aaveEvent(l, 0, "aave_supply", ev.OnBehalfOf, ev.Reserve, "", nil, map[string]string{
			"user":   ev.User.Hex(),
			"amount": ev.Amount.String(),
		})}, nil
	case decode.AaveWithdraw:
		// Record-only, mirror of Supply (the Burn on the aToken stream folds).
		return []store.PositionEvent{aaveEvent(l, 0, "aave_withdraw", ev.User, ev.Reserve, "", nil, map[string]string{
			"to":     ev.To.Hex(),
			"amount": ev.Amount.String(),
		})}, nil
	case decode.ATokenMint:
		return e.processATokenMint(l, ev)
	case decode.ATokenBurn:
		return e.processATokenBurn(l, ev)
	case decode.ATokenBalanceTransfer:
		return e.processATokenBalanceTransfer(l, ev)
	case decode.ATokenTransfer:
		// RECORD-ONLY, never folded: the ERC20 Transfer carries NOMINAL units
		// and is always an overlapping view of the authoritative
		// Mint/Burn/BalanceTransfer in the same tx (regime A SBTB :154,
		// regime B AToken.sol :309; committed pair proofs: tx 0x7714dcf7...
		// logs 233/234 = one burn, 236/237 = one peer transfer).
		reserve, err := e.aTokenReserve(l, "ATokenTransfer")
		if err != nil {
			return nil, err
		}
		return []store.PositionEvent{aaveEvent(l, 0, "atoken_transfer", ev.From, reserve, "", nil, map[string]string{
			"from":  ev.From.Hex(),
			"to":    ev.To.Hex(),
			"value": ev.Value.String(),
		})}, nil
	default:
		return nil, fmt.Errorf("aave: unhandled decoded event %q at block %d log %d (tx %x) — decode registry and deriver have drifted",
			d.Name(), l.BlockNumber, l.LogIndex, l.TxHash)
	}
}

func (e *AaveEngine) processReserveDataUpdated(l store.RawLog, ev decode.AaveReserveDataUpdated) ([]store.PositionEvent, error) {
	if err := requireRayIndex(ev.VariableBorrowIndex, l, "ReserveDataUpdated variableBorrowIndex"); err != nil {
		return nil, err
	}
	if err := requireRayIndex(ev.LiquidityIndex, l, "ReserveDataUpdated liquidityIndex"); err != nil {
		return nil, err
	}
	e.rates[ev.Reserve] = &aaveReserveRates{
		variableBorrowIndex: new(big.Int).Set(ev.VariableBorrowIndex),
		liquidityIndex:      new(big.Int).Set(ev.LiquidityIndex),
		block:               l.BlockNumber,
	}
	// Record-only event; Payload keys "variable_borrow_index" and
	// "liquidity_index" are the store.SaveRateIndex kind strings the runner
	// persists rate_indexes rows from (asset = Asset, block = BlockNumber).
	return []store.PositionEvent{aaveEvent(l, 0, "aave_reserve_data_updated", common.Address{}, ev.Reserve, "", nil, map[string]string{
		"variable_borrow_index": ev.VariableBorrowIndex.String(),
		"liquidity_index":       ev.LiquidityIndex.String(),
	})}, nil
}

func (e *AaveEngine) processBorrow(l store.RawLog, ev decode.AaveBorrow) ([]store.PositionEvent, error) {
	// This deployment has no stable-rate borrowing (recon "Aave derivation
	// model"); mode 2 = variable. Anything else would fold under semantics
	// this deriver has not derived — refuse loudly.
	if ev.InterestRateMode != 2 {
		return nil, fmt.Errorf("aave: Borrow at block %d log %d (tx %x): interestRateMode %d is not variable(2) — unsupported by this deployment and this deriver",
			l.BlockNumber, l.LogIndex, l.TxHash, ev.InterestRateMode)
	}
	idx, err := e.requireIndex(ev.Reserve, l, "Borrow")
	if err != nil {
		return nil, err
	}
	// Regime A: +rayDivHalfUp(amount, vbIndex) (vToken SBTB :72 via
	// VariableDebtToken.mint). Regime B: +rayDivCeil(amount, vbIndex)
	// (BorrowLogic.sol :55, TokenMath.getVTokenMintScaledAmount :80-85).
	var delta *big.Int
	if tokenMathRegime(l.BlockNumber) {
		delta = rayDivCeil(ev.Amount, idx)
	} else {
		delta = rayDivHalfUp(ev.Amount, idx)
	}
	cur := aaveBalance(e.debt, ev.Reserve, ev.OnBehalfOf)
	aaveSetBalance(e.debt, ev.Reserve, ev.OnBehalfOf, new(big.Int).Add(cur, delta))
	return []store.PositionEvent{aaveEvent(l, 0, "aave_borrow", ev.OnBehalfOf, ev.Reserve, "debt", delta, map[string]string{
		"amount":                ev.Amount.String(),
		"variable_borrow_index": idx.String(),
		"user":                  ev.User.Hex(),
	})}, nil
}

func (e *AaveEngine) processRepay(l store.RawLog, ev decode.AaveRepay) ([]store.PositionEvent, error) {
	idx, err := e.requireIndex(ev.Reserve, l, "Repay")
	if err != nil {
		return nil, err
	}
	// Regime A: -rayDivHalfUp(amount, vbIndex) (vToken SBTB :100). Regime B:
	// -rayDivFloor(amount, vbIndex) (BorrowLogic.sol :181-183,
	// TokenMath.getVTokenBurnScaledAmount :94-99).
	var burned *big.Int
	if tokenMathRegime(l.BlockNumber) {
		burned = rayDivFloor(ev.Amount, idx)
	} else {
		burned = rayDivHalfUp(ev.Amount, idx)
	}
	cur := aaveBalance(e.debt, ev.Reserve, ev.User)
	next := new(big.Int).Sub(cur, burned)
	if next.Sign() < 0 {
		return nil, fmt.Errorf("aave: Repay at block %d log %d (tx %x): burning %s scaled would take %s's %s debt (%s scaled) negative — tracked state is inconsistent",
			l.BlockNumber, l.LogIndex, l.TxHash, burned, ev.User.Hex(), ev.Reserve.Hex(), cur)
	}
	aaveSetBalance(e.debt, ev.Reserve, ev.User, next)
	return []store.PositionEvent{aaveEvent(l, 0, "aave_repay", ev.User, ev.Reserve, "debt", new(big.Int).Neg(burned), map[string]string{
		"amount":                ev.Amount.String(),
		"variable_borrow_index": idx.String(),
		"repayer":               ev.Repayer.Hex(),
		"use_atokens":           fmt.Sprintf("%t", ev.UseATokens),
	})}, nil
}

func (e *AaveEngine) processLiquidationCall(l store.RawLog, ev decode.AaveLiquidationCall) ([]store.PositionEvent, error) {
	payload := map[string]string{
		"debt_to_cover":                ev.DebtToCover.String(),
		"liquidated_collateral_amount": ev.LiquidatedCollateralAmount.String(),
		"collateral_asset":             ev.CollateralAsset.Hex(),
		"liquidator":                   ev.Liquidator.Hex(),
		"receive_atoken":               fmt.Sprintf("%t", ev.ReceiveAToken),
	}
	// Deficit pairing: a same-tx DeficitCreated for this (user, debtAsset)
	// means the contract burned the user's ENTIRE scaled debt in one op
	// (LiquidationLogic.sol :546 burnAmount = borrowerReserveDebt) and the
	// zero-out already happened at the DeficitCreated fold — this event's
	// debt movement is already fully accounted. Delta 0 keeps the event
	// recorded without double-applying.
	if e.deficits[ev.User.Hex()+"|"+ev.DebtAsset.Hex()] {
		payload["deficit_paired"] = "true"
		return []store.PositionEvent{aaveEvent(l, 0, "aave_liquidation_call", ev.User, ev.DebtAsset, "debt", big.NewInt(0), payload)}, nil
	}
	idx, err := e.requireIndex(ev.DebtAsset, l, "LiquidationCall")
	if err != nil {
		return nil, err
	}
	// Regime A: -rayDivHalfUp(debtToCover, vbIndex) (genesis Pool
	// LiquidationLogic.sol :327-334; v3.4 :520-524 — vToken SBTB half-up).
	// Regime B: -rayDivFloor(debtToCover, vbIndex) (LiquidationLogic.sol
	// :546-556). The hasNoCollateralLeft full-burn case with zero
	// outstanding debt also lands here and is exact: debtToCover then equals
	// the full nominal balance and the burn round-trips to the whole scaled
	// amount in both regimes (see package comment).
	var burned *big.Int
	if tokenMathRegime(l.BlockNumber) {
		burned = rayDivFloor(ev.DebtToCover, idx)
	} else {
		burned = rayDivHalfUp(ev.DebtToCover, idx)
	}
	cur := aaveBalance(e.debt, ev.DebtAsset, ev.User)
	next := new(big.Int).Sub(cur, burned)
	if next.Sign() < 0 {
		return nil, fmt.Errorf("aave: LiquidationCall at block %d log %d (tx %x): burning %s scaled would take %s's %s debt (%s scaled) negative — tracked state is inconsistent",
			l.BlockNumber, l.LogIndex, l.TxHash, burned, ev.User.Hex(), ev.DebtAsset.Hex(), cur)
	}
	aaveSetBalance(e.debt, ev.DebtAsset, ev.User, next)
	payload["variable_borrow_index"] = idx.String()
	return []store.PositionEvent{aaveEvent(l, 0, "aave_liquidation_call", ev.User, ev.DebtAsset, "debt", new(big.Int).Neg(burned), payload)}, nil
}

func (e *AaveEngine) processDeficitCreated(l store.RawLog, ev decode.AaveDeficitCreated) ([]store.PositionEvent, error) {
	// DeficitCreated is only emitted after the contract burned the user's
	// ENTIRE remaining scaled debt in the reserve (LiquidationLogic.sol
	// :546/:560-563 and the bad-debt loop :671-709; the full-balance burn
	// round-trips exactly in both regimes). Fold: zero out the tracked
	// scaled debt. Needs no index (deliberately — DeficitCreated precedes
	// its reserve's same-tx ReserveDataUpdated).
	cur := aaveBalance(e.debt, ev.DebtAsset, ev.User)
	if cur.Sign() <= 0 {
		return nil, fmt.Errorf("aave: DeficitCreated at block %d log %d (tx %x): user %s has no tracked %s debt to write off — tracked state is inconsistent (deficits only arise from positive debt)",
			l.BlockNumber, l.LogIndex, l.TxHash, ev.User.Hex(), ev.DebtAsset.Hex())
	}
	aaveSetBalance(e.debt, ev.DebtAsset, ev.User, new(big.Int))
	e.deficits[ev.User.Hex()+"|"+ev.DebtAsset.Hex()] = true
	return []store.PositionEvent{aaveEvent(l, 0, "aave_deficit_created", ev.User, ev.DebtAsset, "debt", new(big.Int).Neg(cur), map[string]string{
		"amount_created": ev.AmountCreated.String(),
	})}, nil
}

// aTokenReserve resolves the emitting aToken (l.Address) to its underlying
// reserve, erroring on any address outside the four pinned streams.
func (e *AaveEngine) aTokenReserve(l store.RawLog, what string) (common.Address, error) {
	reserve, ok := aaveATokenReserve[common.BytesToAddress(l.Address)]
	if !ok {
		return common.Address{}, fmt.Errorf("aave: %s at block %d log %d (tx %x): emitting address %x is not one of the four pinned aTokens",
			what, l.BlockNumber, l.LogIndex, l.TxHash, l.Address)
	}
	return reserve, nil
}

func (e *AaveEngine) processATokenMint(l store.RawLog, ev decode.ATokenMint) ([]store.PositionEvent, error) {
	reserve, err := e.aTokenReserve(l, "ATokenMint")
	if err != nil {
		return nil, err
	}
	if err := requireRayIndex(ev.Index, l, "ATokenMint"); err != nil {
		return nil, err
	}
	s := aaveBalance(e.collateral, reserve, ev.OnBehalfOf)
	var next *big.Int
	if tokenMathRegime(l.BlockNumber) {
		// Regime B inversion: bal(s', i) = rayMulFloor(s, i) + Value -
		// BalanceIncrease covers all three Mint emission paths — supply
		// (_mintScaled, SBTB :79/:87-89), withdrawal-with-interest-exceeding
		// (_burnScaled Mint branch, :115/:123-126) and transfer accrual
		// (AToken.sol :299-307, Value == BalanceIncrease => s' = s).
		n := rayMulFloor(s, ev.Index)
		n.Add(n, ev.Value)
		n.Sub(n, ev.BalanceIncrease)
		next, err = invertScaledFromNominal(n, ev.Index, l, "ATokenMint")
		if err != nil {
			return nil, err
		}
	} else {
		// Regime A: Value = amount + BalanceIncrease on the supply path
		// (SBTB :83) => +rayDivHalfUp(Value - BalanceIncrease, i) (:72);
		// Value = BalanceIncrease - amount on the burn path (:112) =>
		// -rayDivHalfUp(BalanceIncrease - Value, i) (:100); transfer-accrual
		// Mints have Value == BalanceIncrease => delta 0 (either branch).
		next = new(big.Int).Set(s)
		if ev.Value.Cmp(ev.BalanceIncrease) >= 0 {
			amount := new(big.Int).Sub(ev.Value, ev.BalanceIncrease)
			next.Add(next, rayDivHalfUp(amount, ev.Index))
		} else {
			amount := new(big.Int).Sub(ev.BalanceIncrease, ev.Value)
			next.Sub(next, rayDivHalfUp(amount, ev.Index))
		}
	}
	if next.Sign() < 0 {
		return nil, fmt.Errorf("aave: ATokenMint at block %d log %d (tx %x): fold would take %s's %s scaled balance negative (%s -> %s) — tracked state is inconsistent",
			l.BlockNumber, l.LogIndex, l.TxHash, ev.OnBehalfOf.Hex(), reserve.Hex(), s, next)
	}
	delta := new(big.Int).Sub(next, s)
	aaveSetBalance(e.collateral, reserve, ev.OnBehalfOf, next)
	return []store.PositionEvent{aaveEvent(l, 0, "atoken_mint", ev.OnBehalfOf, reserve, "collateral", delta, map[string]string{
		"value":            ev.Value.String(),
		"balance_increase": ev.BalanceIncrease.String(),
		"index":            ev.Index.String(),
		"caller":           ev.Caller.Hex(),
	})}, nil
}

func (e *AaveEngine) processATokenBurn(l store.RawLog, ev decode.ATokenBurn) ([]store.PositionEvent, error) {
	reserve, err := e.aTokenReserve(l, "ATokenBurn")
	if err != nil {
		return nil, err
	}
	if err := requireRayIndex(ev.Index, l, "ATokenBurn"); err != nil {
		return nil, err
	}
	s := aaveBalance(e.collateral, reserve, ev.From)
	var next *big.Int
	if tokenMathRegime(l.BlockNumber) {
		// Regime B inversion: Burn.Value = previousBalance - nextBalance
		// (SBTB :127-130) => bal(s', i) = rayMulFloor(s, i) - Value -
		// BalanceIncrease.
		n := rayMulFloor(s, ev.Index)
		n.Sub(n, ev.Value)
		n.Sub(n, ev.BalanceIncrease)
		next, err = invertScaledFromNominal(n, ev.Index, l, "ATokenBurn")
		if err != nil {
			return nil, err
		}
		if next.Cmp(s) > 0 {
			return nil, fmt.Errorf("aave: ATokenBurn at block %d log %d (tx %x): inversion produced a balance INCREASE (%s -> %s) — tracked state is inconsistent",
				l.BlockNumber, l.LogIndex, l.TxHash, s, next)
		}
	} else {
		// Regime A: Value = amount - BalanceIncrease (SBTB :116) => scaled
		// burn = rayDivHalfUp(Value + BalanceIncrease, i) (:100).
		amount := new(big.Int).Add(ev.Value, ev.BalanceIncrease)
		next = new(big.Int).Sub(s, rayDivHalfUp(amount, ev.Index))
	}
	if next.Sign() < 0 {
		return nil, fmt.Errorf("aave: ATokenBurn at block %d log %d (tx %x): fold would take %s's %s scaled balance negative (%s -> %s) — tracked state is inconsistent",
			l.BlockNumber, l.LogIndex, l.TxHash, ev.From.Hex(), reserve.Hex(), s, next)
	}
	delta := new(big.Int).Sub(next, s)
	aaveSetBalance(e.collateral, reserve, ev.From, next)
	return []store.PositionEvent{aaveEvent(l, 0, "atoken_burn", ev.From, reserve, "collateral", delta, map[string]string{
		"value":            ev.Value.String(),
		"balance_increase": ev.BalanceIncrease.String(),
		"index":            ev.Index.String(),
		"target":           ev.Target.Hex(),
	})}, nil
}

func (e *AaveEngine) processATokenBalanceTransfer(l store.RawLog, ev decode.ATokenBalanceTransfer) ([]store.PositionEvent, error) {
	reserve, err := e.aTokenReserve(l, "ATokenBalanceTransfer")
	if err != nil {
		return nil, err
	}
	// BalanceTransfer.Value is ALREADY SCALED in both regimes (regime A
	// AToken.sol :188 / era-2 :206/:221; regime B AToken.sol :310) — applied
	// EXACTLY ONCE per peer transfer: Seq 0 debits the sender, Seq 1 credits
	// the recipient. The paired ERC20 Transfer (nominal) is record-only.
	from := aaveBalance(e.collateral, reserve, ev.From)
	nextFrom := new(big.Int).Sub(from, ev.Value)
	if nextFrom.Sign() < 0 {
		return nil, fmt.Errorf("aave: ATokenBalanceTransfer at block %d log %d (tx %x): moving %s scaled would take %s's %s balance (%s scaled) negative — tracked state is inconsistent",
			l.BlockNumber, l.LogIndex, l.TxHash, ev.Value, ev.From.Hex(), reserve.Hex(), from)
	}
	aaveSetBalance(e.collateral, reserve, ev.From, nextFrom)
	to := aaveBalance(e.collateral, reserve, ev.To)
	aaveSetBalance(e.collateral, reserve, ev.To, new(big.Int).Add(to, ev.Value))
	payload := map[string]string{
		"value": ev.Value.String(),
		"index": ev.Index.String(),
		"from":  ev.From.Hex(),
		"to":    ev.To.Hex(),
	}
	return []store.PositionEvent{
		aaveEvent(l, 0, "atoken_balance_transfer", ev.From, reserve, "collateral", new(big.Int).Neg(ev.Value), payload),
		aaveEvent(l, 1, "atoken_balance_transfer", ev.To, reserve, "collateral", new(big.Int).Set(ev.Value), payload),
	}, nil
}
