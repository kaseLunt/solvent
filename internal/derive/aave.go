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
// there are exactly TWO fold regimes. The switch is tx/log-order-aware:
// regime B applies from block 23088584 log 542 onward — the weETH aToken's
// Upgraded log in the governance tx 0xa17567fa...97dc (bound to the committed
// fixture by a regression test). The upgrade tx carries no fold events, so
// any cut inside it is exact; pinning the cut at the Upgraded log closes the
// exactness gap for un-fixtured streams whose block-23088584 logs could
// otherwise straddle the upgrade:
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
//     exact in both regimes and independent of any index.
//     (Regime A's v3.3/v3.4 deficit burn is the half-up round-trip
//     rayDivHalfUp(rayMulHalfUp(s, i), i) == s, i >= RAY — same conclusion.)
//     The pairing is NOT order-independent: it is exact only in the DEPLOYED
//     emission order, deficit-first (:560-563 fires before the tx-final
//     LiquidationCall :425-434). The deriver ENFORCES deficit-first — a
//     same-tx LiquidationCall followed by a DeficitCreated for the same
//     (user, debtAsset) is a loud error, never a silent double-count. All
//     four historical deficits are same-tx deficit-first in the committed
//     fixture; the regime-A deficit at block 22014623 (era Pool
//     0x56401d66...) and the three regime-B deficits are all covered by the
//     golden replay.
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
// recovery is verified (rayMulFloor(s', index) == N) and any mismatch is a loud
// error. Validated bit-exact against archive scaledBalanceOf on the committed
// liquidation tx 0x7714dcf7...c09d during authoring.
//
// # Caveat: Pool impl 0xbe82113a... (blocks 24196552..24920566) is unverified
//
// That Pool era's source is not verified on Blockscout/Sourcify/Etherscan.
// The window is OUTCOME-PINNED, not source-verified: (a) the verified Pool
// impls sandwiching it (0x999c94f2 before, 0x0f3bceb6 after) have IDENTICAL
// fold-relevant call sites, (b) its paired era-4 vToken 0x1d5e86f5... is
// verified and requires TokenMath-scaled inputs, (c) the golden replay
// covers the era's action events (3 repays + 1 deficit/liquidation pair)
// bit-exactly, and (d) ARCHIVE WINDOW PINNING: vToken scaledBalanceOf
// captured immediately before/after every one of the window's action events
// (cast via eth.drpc.org archive, 2026-07-23) matches the derived tracked
// debt exactly — see TestAaveWindowPinnedArchiveScaledDebt for the eight
// pinned values (users 0xe17b347b.../0xbd0c6f59.../0x5280be3a...).
//
// What those legs pin is every OBSERVED outcome. They cannot discriminate
// the window's ROUNDING RULE: all three window repays produce identical
// results under floor and under half-up division (and the deficit pair is
// index-free), so the observed events are silent on which rule ran. The
// regime-B (floor/ceil) assumption for the window is therefore INHERITED
// from the verified v3.5 successor implementation via the sandwich — an
// assumption consistent with everything observed, not a discriminated fact.
//
// # Index sourcing (debt folds)
//
// Every debt action needs the reserve's variableBorrowIndex as of its own tx.
// ReserveDataUpdated is emitted by updateInterestRates AFTER updateState and
// BEFORE the action event in the same tx (e.g. BorrowLogic.sol 0x999c94f2:
// mint :77 -> updateInterestRates -> emit Borrow; LiquidationLogic.sol :573
// -> emit LiquidationCall :425-434), carrying exactly the
// nextVariableBorrowIndex the action used. The deriver caches each reserve's
// latest ReserveDataUpdated WITH its (block, txHash, logIndex) and REQUIRES,
// for every indexed action (Borrow/Repay/LiquidationCall, paired or not),
// that the cached update shares the action's OWN transaction hash and
// precedes it in log order — anything else (no cache, an older tx's index, a
// same-tx update sitting after the action) is a loud ErrMissingSameTxIndex,
// never a stale-index fold. Verified against the committed fixture: all 266
// action events carry a same-tx preceding update. (DeficitCreated is the one
// action emitted BEFORE its reserve's ReserveDataUpdated —
// LiquidationLogic.sol :563 vs :573, all four historical deficits confirm —
// and is deliberately EXEMPT: the zero-out fold above needs no index.)
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
// exactly the (asset, block, kind, value) tuples the runner persists
// atomically with the window via store.ApplyDerivedWithRates.
package derive

import (
	"context"
	"encoding/hex"
	"errors"
	"fmt"
	"math/big"

	"github.com/ethereum/go-ethereum/common"

	"github.com/kaselunt/solvent/internal/decode"
	"github.com/kaselunt/solvent/internal/store"
)

// AaveEngineName is the engine identifier shared with config/contracts.json
// and the decode registry.
const AaveEngineName = "aave_v3_etherfi"

// aaveTokenMathFromBlock / aaveTokenMathBoundaryLogIndex pin the start of
// fold regime B: the governance tx
// 0xa17567fa201a78b66c43e6ab178559f8c1d5d308fe944c0bd2c39b5e585097dc at block
// 23088584 upgraded the Pool and every aToken/vToken implementation to the
// v3.5 TokenMath (floor/ceil) line in one transaction. The upgrade tx carries
// no Mint/Burn/Transfer/BalanceTransfer or Pool action logs (verified against
// the committed fixtures), so any cut inside it is exact; the boundary is
// pinned tx/log-order-aware at the weETH aToken's Upgraded log — logIndex 542
// of that block — so that a block-23088584 fold event BEFORE the upgrade
// (none exist in the fixtures, but an un-fixtured stream cannot rely on that)
// would still fold under regime A. Both constants are bound to the committed
// fixture by TestAaveRegimeBoundaryBoundToFixture.
const (
	aaveTokenMathFromBlock        = 23088584
	aaveTokenMathBoundaryLogIndex = 542
)

// ErrMissingSameTxIndex: an indexed action (Borrow/Repay/LiquidationCall)
// was not preceded, within ITS OWN transaction, by its reserve's
// ReserveDataUpdated. The deployed Pools emit the reserve's index update
// before the action event in the same tx (see the package comment); folding
// with anything else would price the action with a stale index.
var ErrMissingSameTxIndex = errors.New("aave: indexed action lacks a same-transaction preceding ReserveDataUpdated")

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
// seen for a reserve, with the emitting log's identity so indexed actions
// can enforce the same-tx requirement. Entries are immutable once stored
// (updates replace the whole pointer), which is what makes the shallow
// per-batch copy of the rates map sound.
type aaveReserveRates struct {
	variableBorrowIndex *big.Int
	liquidityIndex      *big.Int
	block               uint64
	txHash              string // lowercase hex of the emitting tx
	logIndex            uint32
}

// aaveAccountState is one account's tracked scaled balances, keyed by
// reserve. It is the copy-on-write unit of the two-layer state.
type aaveAccountState struct {
	debt       map[common.Address]*big.Int // reserve -> scaled variable debt
	collateral map[common.Address]*big.Int // reserve -> scaled aToken balance
}

func newAaveAccountState() *aaveAccountState {
	return &aaveAccountState{
		debt:       make(map[common.Address]*big.Int),
		collateral: make(map[common.Address]*big.Int),
	}
}

func (s *aaveAccountState) clone() *aaveAccountState {
	c := newAaveAccountState()
	for r, v := range s.debt {
		c.debt[r] = new(big.Int).Set(v)
	}
	for r, v := range s.collateral {
		c.collateral[r] = new(big.Int).Set(v)
	}
	return c
}

// bySide selects the balance map for a PositionEvent side string.
func (s *aaveAccountState) bySide(side string) map[common.Address]*big.Int {
	if side == "debt" {
		return s.debt
	}
	return s.collateral
}

// aaveTxMarkers is the same-tx bookkeeping (deficit pairing + deficit-first
// order enforcement), batch-scoped like all other engine state.
type aaveTxMarkers struct {
	curTx    string          // lowercase hex of the tx the markers belong to
	deficits map[string]bool // "user|debtAsset" DeficitCreated seen in curTx
	liqCalls map[string]bool // "user|debtAsset" LiquidationCall folded in curTx
}

func (m aaveTxMarkers) clone() aaveTxMarkers {
	c := aaveTxMarkers{
		curTx:    m.curTx,
		deficits: make(map[string]bool, len(m.deficits)),
		liqCalls: make(map[string]bool, len(m.liqCalls)),
	}
	for k, v := range m.deficits {
		c.deficits[k] = v
	}
	for k, v := range m.liqCalls {
		c.liqCalls[k] = v
	}
	return c
}

// AaveEngine folds decoded aave_v3_etherfi logs into scaled-balance position
// events under the attempt-scoped Engine lifecycle:
//
//   - The PROMOTED layer mirrors committed truth: per-account balances are
//     hydrated lazily, on first touch inside a batch, from the batch's
//     StateReader. Absence of a committed row mechanically means zero —
//     trustworthy because derivation always starts at engine genesis (block
//     20625519), never from a partial seed. There is no in-memory seed map.
//   - The WORKING layer is a copy-on-write overlay receiving every Process
//     mutation. CommitBatch promotes it (call only after store.ApplyDerived
//     returned nil); DiscardBatch drops it, leaving promoted state exactly as
//     it was, so a retry of the same logs reproduces identical events with no
//     double-mutation — valid ONLY for pre-persistence failures (a Process
//     error); an ApplyDerived ERROR takes Reset instead, per derive.Engine's
//     commit-indeterminacy rule.
//   - Reset drops everything (after store.RewindDerived / a reorg / an
//     ambiguous ApplyDerived error); the next
//     BeginBatch re-hydrates from committed truth. The rates cache and same-tx
//     markers are NOT persisted and need no hydration: every action's own tx
//     re-emits its reserve's ReserveDataUpdated first, and same-tx log runs
//     never span a rewind point (rewinds are block-aligned).
//
// Logs MUST be fed in ascending (block, logIndex) order — the regime-B
// collateral inversion and the deficit zero-out are exact only against
// complete tracked state. Determinism: identical log sequences over identical
// committed state produce identical events (map iteration order is never
// observable). Not safe for concurrent use (single-writer contract D-004).
type AaveEngine struct {
	// Promoted layer (committed truth).
	promoted      map[common.Address]*aaveAccountState
	hydrated      map[common.Address]bool // accounts whose committed truth is loaded
	promotedRates map[common.Address]*aaveReserveRates
	promotedTx    aaveTxMarkers

	// Working layer (current attempt), valid only while inBatch.
	inBatch      bool
	batchCtx     context.Context // hydration context for the current attempt
	reader       StateReader
	working      map[common.Address]*aaveAccountState
	workingRates map[common.Address]*aaveReserveRates
	workingTx    aaveTxMarkers
}

var _ Engine = (*AaveEngine)(nil)

// NewAaveEngine returns an AaveEngine with no in-memory state: the first
// BeginBatch hydrates committed truth per touched account.
func NewAaveEngine() *AaveEngine {
	e := &AaveEngine{}
	e.Reset()
	return e
}

// Name implements Engine.
func (e *AaveEngine) Name() string { return AaveEngineName }

// BeginBatch implements Engine: starts an attempt whose mutations land in a
// working overlay, hydrated lazily from reader (committed truth) on first
// touch of each account.
func (e *AaveEngine) BeginBatch(ctx context.Context, reader StateReader) error {
	if e.inBatch {
		return fmt.Errorf("aave: BeginBatch while a batch is in progress — Commit or Discard the previous attempt first")
	}
	if ctx == nil || reader == nil {
		return fmt.Errorf("aave: BeginBatch requires a non-nil context and StateReader — committed-truth hydration is not optional")
	}
	e.batchCtx, e.reader = ctx, reader
	e.working = make(map[common.Address]*aaveAccountState)
	e.workingRates = make(map[common.Address]*aaveReserveRates, len(e.promotedRates))
	for r, v := range e.promotedRates {
		e.workingRates[r] = v // entries are immutable; shallow copy is sound
	}
	e.workingTx = e.promotedTx.clone()
	e.inBatch = true
	return nil
}

// CommitBatch implements Engine: promotes the working overlay. Call ONLY
// after the runner's ApplyDerived returned nil. No-op outside a batch.
func (e *AaveEngine) CommitBatch() {
	if !e.inBatch {
		return
	}
	for acct, st := range e.working {
		e.promoted[acct] = st
	}
	e.promotedRates = e.workingRates
	e.promotedTx = e.workingTx
	e.endBatch()
}

// DiscardBatch implements Engine: drops the working overlay (PRE-persistence
// failure — the attempt provably never reached ApplyDerived; an ApplyDerived
// error takes Reset instead, per derive.Engine's commit-indeterminacy rule);
// promoted state and hydration marks are untouched — hydrated values are
// committed truth and stay valid across a failed attempt. No-op outside a
// batch.
func (e *AaveEngine) DiscardBatch() {
	if !e.inBatch {
		return
	}
	e.endBatch()
}

func (e *AaveEngine) endBatch() {
	e.working, e.workingRates = nil, nil
	e.workingTx = aaveTxMarkers{}
	e.batchCtx, e.reader = nil, nil
	e.inBatch = false
}

// Reset implements Engine: drops ALL in-memory state (promoted, hydration
// marks, rates, tx markers, any in-flight attempt). Call after RewindDerived
// or a reorg; the next BeginBatch re-hydrates from committed truth.
func (e *AaveEngine) Reset() {
	e.promoted = make(map[common.Address]*aaveAccountState)
	e.hydrated = make(map[common.Address]bool)
	e.promotedRates = make(map[common.Address]*aaveReserveRates)
	e.promotedTx = aaveTxMarkers{}
	e.endBatch()
}

// hydrate loads the account's committed balances through the batch's reader
// into the promoted layer, once per account per engine lifetime (until
// Reset). Hydration writes are durable across DiscardBatch by design: they
// mirror committed truth, which a failed attempt does not change. Every
// promoted entry is created either here or by CommitBatch promoting a working
// entry whose account was hydrated first, so promoted entries are never
// clobbered.
func (e *AaveEngine) hydrate(account common.Address) error {
	if e.hydrated[account] {
		return nil
	}
	bals, err := e.reader.BalancesFor(e.batchCtx, AaveEngineName, account.Bytes())
	if err != nil {
		return fmt.Errorf("aave: hydrating account %s from committed state: %w", account.Hex(), err)
	}
	st := newAaveAccountState()
	for assetHex, sides := range bals {
		raw, err := hex.DecodeString(assetHex)
		if err != nil || len(raw) != common.AddressLength {
			return fmt.Errorf("aave: hydrating account %s: committed asset key %q is not an address", account.Hex(), assetHex)
		}
		reserve := common.BytesToAddress(raw)
		for side, amount := range sides {
			if amount == nil || amount.Sign() < 0 {
				return fmt.Errorf("aave: hydrating account %s: committed %s balance for reserve %s is %v — committed truth must be a non-negative integer",
					account.Hex(), side, reserve.Hex(), amount)
			}
			switch side {
			case "debt", "collateral":
				st.bySide(side)[reserve] = new(big.Int).Set(amount)
			default:
				return fmt.Errorf("aave: hydrating account %s: committed reserve %s carries unknown side %q", account.Hex(), reserve.Hex(), side)
			}
		}
	}
	e.promoted[account] = st
	e.hydrated[account] = true
	return nil
}

// stateFor returns the account's current state for reading: working overlay
// first, else the (hydrated-on-demand) promoted layer. Callers must not
// mutate the result — use mutableStateFor for writes.
func (e *AaveEngine) stateFor(account common.Address) (*aaveAccountState, error) {
	if st, ok := e.working[account]; ok {
		return st, nil
	}
	if err := e.hydrate(account); err != nil {
		return nil, err
	}
	return e.promoted[account], nil
}

// mutableStateFor copies the account's promoted state into the working
// overlay (copy-on-write) so Process mutations never touch committed truth.
func (e *AaveEngine) mutableStateFor(account common.Address) (*aaveAccountState, error) {
	if st, ok := e.working[account]; ok {
		return st, nil
	}
	if err := e.hydrate(account); err != nil {
		return nil, err
	}
	st := e.promoted[account].clone()
	e.working[account] = st
	return st, nil
}

// balanceFor returns the account's tracked scaled balance for (side,
// reserve); zero when the account has no committed or working entry for the
// reserve (absence means zero, post-genesis invariant). The result must not
// be mutated.
func (e *AaveEngine) balanceFor(side string, reserve, account common.Address) (*big.Int, error) {
	st, err := e.stateFor(account)
	if err != nil {
		return nil, err
	}
	if v, ok := st.bySide(side)[reserve]; ok {
		return v, nil
	}
	return new(big.Int), nil
}

// setBalance writes the account's (side, reserve) balance into the working
// overlay.
func (e *AaveEngine) setBalance(side string, reserve, account common.Address, v *big.Int) error {
	st, err := e.mutableStateFor(account)
	if err != nil {
		return err
	}
	st.bySide(side)[reserve] = v
	return nil
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

// tokenMathRegime reports whether (block, logIndex) folds under regime B
// (v3.5 TokenMath floor/ceil) rather than regime A (half-up in-token
// rayDiv/rayMul). The boundary is tx/log-order-aware: at the upgrade block
// itself, regime B applies only from the Upgraded log (logIndex 542) onward.
func tokenMathRegime(block uint64, logIndex uint32) bool {
	if block != aaveTokenMathFromBlock {
		return block > aaveTokenMathFromBlock
	}
	return logIndex >= aaveTokenMathBoundaryLogIndex
}

// requireIndex returns the cached variableBorrowIndex for reserve, enforcing
// the SAME-TRANSACTION requirement: the cached ReserveDataUpdated must share
// the action's own tx hash AND precede it in log order (every deployed Pool
// emits the reserve's index update before the action event in the same tx —
// see the package comment). Anything else — no cache at all, an older tx's
// index, or a same-tx update sitting after the action — wraps
// ErrMissingSameTxIndex.
func (e *AaveEngine) requireIndex(reserve common.Address, l store.RawLog, action string) (*big.Int, error) {
	r, ok := e.workingRates[reserve]
	if !ok {
		return nil, fmt.Errorf("%w: %s at block %d log %d (tx %x): no cached ReserveDataUpdated for reserve %s at all — the stream is incomplete or misordered",
			ErrMissingSameTxIndex, action, l.BlockNumber, l.LogIndex, l.TxHash, reserve.Hex())
	}
	if tx := hex.EncodeToString(l.TxHash); r.txHash != tx {
		return nil, fmt.Errorf("%w: %s at block %d log %d (tx %x): cached index for reserve %s is from tx %s (block %d log %d), not the action's own transaction — refusing to fold with a foreign index",
			ErrMissingSameTxIndex, action, l.BlockNumber, l.LogIndex, l.TxHash, reserve.Hex(), r.txHash, r.block, r.logIndex)
	}
	if r.logIndex >= l.LogIndex {
		return nil, fmt.Errorf("%w: %s at block %d log %d (tx %x): reserve %s's ReserveDataUpdated sits at log %d, AFTER the action — the stream is misordered",
			ErrMissingSameTxIndex, action, l.BlockNumber, l.LogIndex, l.TxHash, reserve.Hex(), r.logIndex)
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
// source citations. Only valid inside a batch (BeginBatch).
func (e *AaveEngine) Process(l store.RawLog, d decode.Event) ([]store.PositionEvent, error) {
	if !e.inBatch {
		return nil, fmt.Errorf("aave: Process called outside a batch — BeginBatch starts the attempt lifecycle (see derive.Engine)")
	}
	// Same-tx deficit pairing: markers live only for the duration of one
	// transaction's log run (a tx's logs are contiguous in (block, logIndex)
	// order).
	if tx := hex.EncodeToString(l.TxHash); tx != e.workingTx.curTx {
		e.workingTx = aaveTxMarkers{curTx: tx, deficits: make(map[string]bool), liqCalls: make(map[string]bool)}
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
	e.workingRates[ev.Reserve] = &aaveReserveRates{
		variableBorrowIndex: new(big.Int).Set(ev.VariableBorrowIndex),
		liquidityIndex:      new(big.Int).Set(ev.LiquidityIndex),
		block:               l.BlockNumber,
		txHash:              hex.EncodeToString(l.TxHash),
		logIndex:            l.LogIndex,
	}
	// Record-only event; Payload keys "variable_borrow_index" and
	// "liquidity_index" are the rate_indexes kind strings the runner
	// persists rows for (asset = Asset, block = BlockNumber), atomically
	// with the window via store.ApplyDerivedWithRates.
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
	if tokenMathRegime(l.BlockNumber, l.LogIndex) {
		delta = rayDivCeil(ev.Amount, idx)
	} else {
		delta = rayDivHalfUp(ev.Amount, idx)
	}
	cur, err := e.balanceFor("debt", ev.Reserve, ev.OnBehalfOf)
	if err != nil {
		return nil, err
	}
	if err := e.setBalance("debt", ev.Reserve, ev.OnBehalfOf, new(big.Int).Add(cur, delta)); err != nil {
		return nil, err
	}
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
	if tokenMathRegime(l.BlockNumber, l.LogIndex) {
		burned = rayDivFloor(ev.Amount, idx)
	} else {
		burned = rayDivHalfUp(ev.Amount, idx)
	}
	cur, err := e.balanceFor("debt", ev.Reserve, ev.User)
	if err != nil {
		return nil, err
	}
	next := new(big.Int).Sub(cur, burned)
	if next.Sign() < 0 {
		return nil, fmt.Errorf("aave: Repay at block %d log %d (tx %x): burning %s scaled would take %s's %s debt (%s scaled) negative — tracked state is inconsistent",
			l.BlockNumber, l.LogIndex, l.TxHash, burned, ev.User.Hex(), ev.Reserve.Hex(), cur)
	}
	if err := e.setBalance("debt", ev.Reserve, ev.User, next); err != nil {
		return nil, err
	}
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
	// Same-tx index requirement holds for EVERY LiquidationCall, paired or
	// not: updateInterestRates on the debt reserve (LiquidationLogic.sol
	// :573, emitting ReserveDataUpdated) always runs before the tx-final
	// LiquidationCall event (:425-434) — enforced even on the paired path,
	// where the index value itself is not consulted.
	idx, err := e.requireIndex(ev.DebtAsset, l, "LiquidationCall")
	if err != nil {
		return nil, err
	}
	pairKey := ev.User.Hex() + "|" + ev.DebtAsset.Hex()
	e.workingTx.liqCalls[pairKey] = true
	// Deficit pairing: a same-tx DeficitCreated for this (user, debtAsset)
	// means the contract burned the user's ENTIRE scaled debt in one op
	// (LiquidationLogic.sol :546 burnAmount = borrowerReserveDebt) and the
	// zero-out already happened at the DeficitCreated fold — this event's
	// debt movement is already fully accounted. Delta 0 keeps the event
	// recorded without double-applying.
	if e.workingTx.deficits[pairKey] {
		payload["deficit_paired"] = "true"
		return []store.PositionEvent{aaveEvent(l, 0, "aave_liquidation_call", ev.User, ev.DebtAsset, "debt", big.NewInt(0), payload)}, nil
	}
	// Regime A: -rayDivHalfUp(debtToCover, vbIndex) (genesis Pool
	// LiquidationLogic.sol :327-334; v3.4 :520-524 — vToken SBTB half-up).
	// Regime B: -rayDivFloor(debtToCover, vbIndex) (LiquidationLogic.sol
	// :546-556). The hasNoCollateralLeft full-burn case with zero
	// outstanding debt also lands here and is exact: debtToCover then equals
	// the full nominal balance and the burn round-trips to the whole scaled
	// amount in both regimes (see package comment).
	var burned *big.Int
	if tokenMathRegime(l.BlockNumber, l.LogIndex) {
		burned = rayDivFloor(ev.DebtToCover, idx)
	} else {
		burned = rayDivHalfUp(ev.DebtToCover, idx)
	}
	cur, err := e.balanceFor("debt", ev.DebtAsset, ev.User)
	if err != nil {
		return nil, err
	}
	next := new(big.Int).Sub(cur, burned)
	if next.Sign() < 0 {
		return nil, fmt.Errorf("aave: LiquidationCall at block %d log %d (tx %x): burning %s scaled would take %s's %s debt (%s scaled) negative — tracked state is inconsistent",
			l.BlockNumber, l.LogIndex, l.TxHash, burned, ev.User.Hex(), ev.DebtAsset.Hex(), cur)
	}
	if err := e.setBalance("debt", ev.DebtAsset, ev.User, next); err != nil {
		return nil, err
	}
	payload["variable_borrow_index"] = idx.String()
	return []store.PositionEvent{aaveEvent(l, 0, "aave_liquidation_call", ev.User, ev.DebtAsset, "debt", new(big.Int).Neg(burned), payload)}, nil
}

func (e *AaveEngine) processDeficitCreated(l store.RawLog, ev decode.AaveDeficitCreated) ([]store.PositionEvent, error) {
	// DeficitCreated is only emitted after the contract burned the user's
	// ENTIRE remaining scaled debt in the reserve (LiquidationLogic.sol
	// :546/:560-563 and the bad-debt loop :671-709; the full-balance burn
	// round-trips exactly in both regimes). Fold: zero out the tracked
	// scaled debt. Needs no index (deliberately — DeficitCreated precedes
	// its reserve's same-tx ReserveDataUpdated, so it is EXEMPT from the
	// same-tx index requirement).
	//
	// The zero-out is exact only in the DEPLOYED emission order,
	// deficit-first: a same-tx LiquidationCall that already folded for this
	// (user, debtAsset) would have burned rayDivFloor(debtToCover, i) BEFORE
	// this zero-out — a double count. That order never occurs on-chain
	// (LiquidationLogic.sol :560-563 fires before :425-434; all four
	// historical deficits confirm), so seeing it is a loud error.
	pairKey := ev.User.Hex() + "|" + ev.DebtAsset.Hex()
	if e.workingTx.liqCalls[pairKey] {
		return nil, fmt.Errorf("aave: DeficitCreated at block %d log %d (tx %x): a LiquidationCall for %s/%s already folded in this tx — deployed emission order is deficit-first (LiquidationLogic.sol :560-563 before :425-434); reversed order would double-count and is refused",
			l.BlockNumber, l.LogIndex, l.TxHash, ev.User.Hex(), ev.DebtAsset.Hex())
	}
	cur, err := e.balanceFor("debt", ev.DebtAsset, ev.User)
	if err != nil {
		return nil, err
	}
	if cur.Sign() <= 0 {
		return nil, fmt.Errorf("aave: DeficitCreated at block %d log %d (tx %x): user %s has no tracked %s debt to write off — tracked state is inconsistent (deficits only arise from positive debt)",
			l.BlockNumber, l.LogIndex, l.TxHash, ev.User.Hex(), ev.DebtAsset.Hex())
	}
	if err := e.setBalance("debt", ev.DebtAsset, ev.User, new(big.Int)); err != nil {
		return nil, err
	}
	e.workingTx.deficits[pairKey] = true
	return []store.PositionEvent{aaveEvent(l, 0, "aave_deficit_created", ev.User, ev.DebtAsset, "debt", new(big.Int).Neg(cur), map[string]string{
		"amount_created": ev.AmountCreated.String(),
	})}, nil
}

// requireAccruableState is the warm-start impossible-state detector
// (defense-in-depth under the hydration lifecycle): a Mint/Burn carrying
// BalanceIncrease > 0 against a ZERO tracked scaled balance is impossible
// on-chain — interest cannot accrue on nothing (BalanceIncrease =
// bal(s, i) - bal(s, p) = 0 whenever s = 0) — so it proves the tracked
// state is incomplete (bad hydration or a truncated stream), never a
// foldable event.
func requireAccruableState(s, balanceIncrease *big.Int, l store.RawLog, what string, account, reserve common.Address) error {
	if s.Sign() == 0 && balanceIncrease.Sign() > 0 {
		return fmt.Errorf("aave: %s at block %d log %d (tx %x): BalanceIncrease %s on a ZERO tracked scaled balance for %s/%s — interest cannot accrue on nothing; tracked state is incomplete (impossible-state detector)",
			what, l.BlockNumber, l.LogIndex, l.TxHash, balanceIncrease, account.Hex(), reserve.Hex())
	}
	return nil
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
	s, err := e.balanceFor("collateral", reserve, ev.OnBehalfOf)
	if err != nil {
		return nil, err
	}
	if err := requireAccruableState(s, ev.BalanceIncrease, l, "ATokenMint", ev.OnBehalfOf, reserve); err != nil {
		return nil, err
	}
	var next *big.Int
	if tokenMathRegime(l.BlockNumber, l.LogIndex) {
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
	if err := e.setBalance("collateral", reserve, ev.OnBehalfOf, next); err != nil {
		return nil, err
	}
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
	s, err := e.balanceFor("collateral", reserve, ev.From)
	if err != nil {
		return nil, err
	}
	if err := requireAccruableState(s, ev.BalanceIncrease, l, "ATokenBurn", ev.From, reserve); err != nil {
		return nil, err
	}
	var next *big.Int
	if tokenMathRegime(l.BlockNumber, l.LogIndex) {
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
	if err := e.setBalance("collateral", reserve, ev.From, next); err != nil {
		return nil, err
	}
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
	from, err := e.balanceFor("collateral", reserve, ev.From)
	if err != nil {
		return nil, err
	}
	nextFrom := new(big.Int).Sub(from, ev.Value)
	if nextFrom.Sign() < 0 {
		return nil, fmt.Errorf("aave: ATokenBalanceTransfer at block %d log %d (tx %x): moving %s scaled would take %s's %s balance (%s scaled) negative — tracked state is inconsistent",
			l.BlockNumber, l.LogIndex, l.TxHash, ev.Value, ev.From.Hex(), reserve.Hex(), from)
	}
	if err := e.setBalance("collateral", reserve, ev.From, nextFrom); err != nil {
		return nil, err
	}
	to, err := e.balanceFor("collateral", reserve, ev.To)
	if err != nil {
		return nil, err
	}
	if err := e.setBalance("collateral", reserve, ev.To, new(big.Int).Add(to, ev.Value)); err != nil {
		return nil, err
	}
	// Each fanned-out event gets its OWN payload map: a shared pointer would
	// let a mutation through one event alias into its sibling (and into
	// whatever the store layer later does with either).
	mkPayload := func() map[string]string {
		return map[string]string{
			"value": ev.Value.String(),
			"index": ev.Index.String(),
			"from":  ev.From.Hex(),
			"to":    ev.To.Hex(),
		}
	}
	return []store.PositionEvent{
		aaveEvent(l, 0, "atoken_balance_transfer", ev.From, reserve, "collateral", new(big.Int).Neg(ev.Value), mkPayload()),
		aaveEvent(l, 1, "atoken_balance_transfer", ev.To, reserve, "collateral", new(big.Int).Set(ev.Value), mkPayload()),
	}, nil
}
