// Package risk is Solvent's pure risk-math library: health factors,
// liquidation prices, stress propagation, and the liquidation waterfall.
//
// # Purity
//
// This package performs ZERO I/O. It imports no database, network, or
// filesystem package; its only non-stdlib dependency is go-ethereum's
// `common` for the address type. Scenario definitions are compiled in with
// `embed`, which is a build-time inclusion, not a read. TestPackageIsIOFree
// enforces the import allowlist; TestNoFloatInNonTestSources enforces that
// no float type or float literal exists anywhere in the computation paths.
// Every number here is *big.Int or an exact *big.Rat-free Rational.
//
// # Two surfaces, never blended (design spec §5)
//
//   - Aave: a continuous health factor, base currency 8-dec, LT in basis
//     points (denominator 1e4).
//   - Debt Manager: a strict-inequality liquidatable boolean, USD 6-dec, LT
//     with denominator HUNDRED_PERCENT = 100e18.
//
// The two denominators differ by 1e16 and nothing in a stored param row says
// which convention it uses except which engine wrote it. This package
// therefore refuses a param row whose Engine tag does not match the surface
// consuming it — see ParamRow.Engine. Storage never normalizes; conversion is
// explicit at each computation site.
//
// # Rounding is the product
//
// Every rounding direction below is probe-proven against the deployed
// contracts at a hash-bound pin and is pinned in the test suite by hard-coded
// on-chain integers. Expectations are NEVER computed from the helper under
// test. See recon/p3-probes.md (P-1, P-2) and recon/derivation-notes.md.
package risk

import (
	"errors"
	"fmt"
	"math/big"
	"time"

	"github.com/ethereum/go-ethereum/common"
)

// ---------------------------------------------------------------------------
// Engine identities.
// ---------------------------------------------------------------------------

// Engine identity strings, matching the deriver engines that produce the rows
// this package consumes (internal/derive: AaveEngineName, dmEngineName,
// ParamEngineName). They are the ONLY evidence of which fixed-point
// convention a ParamRow carries.
const (
	// AaveEngine is the Aave v3 ether.fi-market position engine (ETH).
	AaveEngine = "aave_v3_etherfi"
	// AaveParamEngine is the PoolConfigurator param deriver (ETH). Param rows
	// written under this engine use Aave basis points, denominator 1e4.
	AaveParamEngine = "aave_param"
	// DMEngine is the ether.fi Debt Manager position engine (OP). Param rows
	// written under this engine use HUNDRED_PERCENT, denominator 100e18.
	DMEngine = "debt_manager"
)

// ---------------------------------------------------------------------------
// Provenance classes (design spec §7; oracle-sentinel R1 item 5).
// ---------------------------------------------------------------------------

// Price provenance classes. The Aave valuation path consumes ONLY
// adapter-output/engine-exact rows: the P2 feed stream is deliberately
// UNCAPPED, so valuing Aave collateral from it goes wrong exactly when a cap
// binds (design spec §7, Codex round 1 [H4]).
const (
	ProvenanceEngineExact    = "engine-exact"
	ProvenanceAdapterOutput  = "adapter-output"
	ProvenanceUncappedFeed   = "uncapped-feed"
	ProvenanceRatioReference = "ratio-reference"
)

// ---------------------------------------------------------------------------
// Rounding regimes (recon/derivation-notes.md:206-217; internal/derive/aave.go).
// ---------------------------------------------------------------------------

// Regime selects the Aave scaled-to-live projection convention. The zero
// value is RegimeB, the CURRENT deployment, so a caller that never thinks
// about regimes gets today's chain.
type Regime uint8

const (
	// RegimeB is the v3.5 TokenMath directional line: aToken balance
	// rayMulFloor, vToken balance rayMulCeil. Active from block 23,088,584
	// log 542 onward. Probe-proven 15/15 at ETH pin 25,635,618 (P-1).
	RegimeB Regime = iota
	// RegimeA is the pre-23,088,584 WadRayMath line, where BOTH the aToken
	// and vToken scaled-to-live projections are half-up rayMul. Historical
	// pins only.
	RegimeA
)

// AaveTokenMathFromBlock is the first block of RegimeB. The cut is
// tx/log-order-aware at log index 542 of that block (the weETH aToken
// Upgraded log); this package takes only the block, because it is handed
// end-of-block state. Independently corroborated by the configurator sweep:
// 23,088,584 is exactly a Pool implementation upgrade (recon/p3-probes.md).
const AaveTokenMathFromBlock uint64 = 23088584

// RegimeAtBlock reports the projection regime in force at end-of-block b.
func RegimeAtBlock(b uint64) Regime {
	if b < AaveTokenMathFromBlock {
		return RegimeA
	}
	return RegimeB
}

func (r Regime) String() string {
	if r == RegimeA {
		return "A"
	}
	return "B"
}

// ---------------------------------------------------------------------------
// Errors.
// ---------------------------------------------------------------------------

var (
	// ErrMissingPrice: a position holds a nonzero balance of an asset with no
	// usable price input. NEVER silently dropped — dropping collateral
	// understates health (false alarm), dropping debt overstates it (false
	// safety). oracle-sentinel R2/G1.
	ErrMissingPrice = errors.New("risk: no usable price input for asset")
	// ErrMissingParam: a position holds collateral in an asset with no param
	// row. A missing liquidation threshold is a wrong health factor, never a
	// zero one.
	ErrMissingParam = errors.New("risk: no param row for asset")
	// ErrDuplicatePriceInput: two price inputs for one asset. The caller must
	// resolve which witness it used; this package never picks silently.
	ErrDuplicatePriceInput = errors.New("risk: duplicate price input for asset")
	// ErrDuplicateParamRow: two param rows for one asset. The caller hands
	// the folded effective view (store.ParamsAsOf), never a ledger prefix.
	ErrDuplicateParamRow = errors.New("risk: duplicate param row for asset")
	// ErrParamEngineMismatch: a param row tagged with another engine. The two
	// engines' liquidation-threshold denominators differ by 1e16 and the
	// engine tag is the only evidence of which one a row carries.
	ErrParamEngineMismatch = errors.New("risk: param row engine does not match the consuming surface")
	// ErrProvenanceNotAllowed: a price input whose provenance class this
	// surface may not consume (design spec §7).
	ErrProvenanceNotAllowed = errors.New("risk: price provenance class not permitted on this surface")
	// ErrMixedPriceDecimals: price inputs on one surface disagree on decimals.
	// Summing an 8-dec base value with an 18-dec one is silent corruption.
	ErrMixedPriceDecimals = errors.New("risk: price inputs disagree on decimals")
	// ErrNonPositivePrice: a price value at or below zero. The store already
	// quarantines these (migration 00005 CHECK); this is the second wall.
	ErrNonPositivePrice = errors.New("risk: price value is not positive")
	// ErrNegativeAmount: a negative balance, debt, or param.
	ErrNegativeAmount = errors.New("risk: negative amount")
	// ErrMissingIndex: a nonzero scaled balance with an absent or non-positive
	// rate index. Projecting with a zero index would silently zero a position.
	ErrMissingIndex = errors.New("risk: missing or non-positive rate index for a nonzero scaled balance")
	// ErrEModeUnsupported: a nonzero eMode category. The probe settled
	// category 0 for every borrower on both witnesses (recon/p3-probes.md);
	// eMode category params are configurator-emitted and not yet in the param
	// table, so a nonzero category is refused rather than computed with the
	// wrong thresholds.
	ErrEModeUnsupported = errors.New("risk: nonzero eMode category is not supported (no category param rows)")
	// ErrEngineMismatch: a PositionInput whose Engine tag disagrees with which
	// engine payload is populated.
	ErrEngineMismatch = errors.New("risk: position engine tag does not match its payload")
	// ErrNoDebt: an operation that is undefined without debt.
	ErrNoDebt = errors.New("risk: position carries no debt")
	// ErrMissingWatermark: an input missing a watermark the surface consuming
	// it actually depends on. Every served number carries its as-ofs (design
	// spec §5: "never an epsilon, always watermarks"), and a row that
	// serialized with block 0 would claim to be as-of genesis. Refusing is the
	// same posture as refusing an unpriced asset: this package does not pick a
	// watermark, and it does not serve a number without one.
	//
	// The requirement is ENGINE-AWARE, because the legs differ. The Aave
	// surface needs balances and params. The Debt Manager surface additionally
	// needs the collateral SWEEP block: DM collateral is sweep-dominated (~1h
	// worst case) while prices are 60s, so a never-swept or failed-sweep
	// account carrying SweepBlock 0 would otherwise serve a liquidatable
	// verdict over collateral of unknown freshness — the 0xe957…bf20 posture
	// the design forbids. The error NAMES the missing field.
	ErrMissingWatermark = errors.New("risk: input is missing a required watermark")
	// ErrWatermarkMismatch: a PositionInput whose Marks disagree with the
	// engine input's Marks. The engine input is authoritative; a disagreement
	// means the caller built the two from different reads.
	ErrWatermarkMismatch = errors.New("risk: position marks disagree with the engine input's marks")
)

// AssetError binds a sentinel to the asset that triggered it, so a refusal
// names the thing it refused about.
type AssetError struct {
	Op      string
	Engine  string
	Asset   common.Address
	Detail  string
	Wrapped error
}

func (e *AssetError) Error() string {
	s := fmt.Sprintf("risk: %s: engine %s asset %s: %v", e.Op, e.Engine, e.Asset.Hex(), e.Wrapped)
	if e.Detail != "" {
		s += " (" + e.Detail + ")"
	}
	return s
}

// Unwrap exposes the sentinel to errors.Is.
func (e *AssetError) Unwrap() error { return e.Wrapped }

func assetErr(op, engine string, asset common.Address, sentinel error, detail string) error {
	return &AssetError{Op: op, Engine: engine, Asset: asset, Wrapped: sentinel, Detail: detail}
}

// watermarkCheck is one required as-of, carrying the field name that goes into
// the refusal so an operator is told WHICH stamp is missing rather than that
// something is.
type watermarkCheck struct {
	name  string
	value uint64
}

// requireWatermarks refuses the first missing as-of, naming it. Each caller
// passes only the stamps ITS OWN computation depends on — demanding a sweep
// block from the Aave surface, which has no sweep, would refuse every honest
// input.
func requireWatermarks(op, engine string, account common.Address, checks ...watermarkCheck) error {
	for _, c := range checks {
		if c.value == 0 {
			return assetErr(op, engine, account, ErrMissingWatermark, c.name+" is zero")
		}
	}
	return nil
}

// ---------------------------------------------------------------------------
// Rational — exact ratios, never a float.
// ---------------------------------------------------------------------------

// Rational is an exact non-negative ratio Num/Den, or the marked "infinite"
// value used for a health factor with zero debt.
//
// Infinite is a TYPED MARKER, not a big number. A health factor over zero
// debt is undefined-because-unbounded; substituting math.MaxUint256 (which is
// what the Aave contract returns on the wire) would let a comparison against
// a threshold silently succeed. Callers must branch on Infinite.
type Rational struct {
	Num *big.Int
	Den *big.Int
	// Infinite marks an unbounded quantity. Num and Den are nil when set.
	Infinite bool
}

// InfiniteRational is the zero-debt health factor.
func InfiniteRational() Rational { return Rational{Infinite: true} }

// NewRational returns num/den with den > 0 required.
func NewRational(num, den *big.Int) (Rational, error) {
	if num == nil || den == nil {
		return Rational{}, errors.New("risk: nil rational component")
	}
	if den.Sign() <= 0 {
		return Rational{}, errors.New("risk: rational denominator must be positive")
	}
	return Rational{Num: new(big.Int).Set(num), Den: new(big.Int).Set(den)}, nil
}

// Valid reports whether this rational carries a value at all. The ZERO VALUE
// is deliberately invalid — a field documented as "set only when X" reads back
// as invalid when X did not hold, rather than as a plausible zero. Callers
// that may receive a conditional rational (LiquidationPrice.ScaleFactor is the
// one in this package) must check the condition, or this.
func (r Rational) Valid() bool {
	return r.Infinite || (r.Num != nil && r.Den != nil && r.Den.Sign() > 0)
}

// IsZero reports a finite zero.
func (r Rational) IsZero() bool {
	return !r.Infinite && r.Num != nil && r.Num.Sign() == 0
}

// Cmp orders two rationals. Infinite is greater than every finite value and
// equal to itself.
//
// Both operands must be Valid; comparing an unset rational has no meaning and
// this method will not invent one.
func (r Rational) Cmp(o Rational) int {
	switch {
	case r.Infinite && o.Infinite:
		return 0
	case r.Infinite:
		return 1
	case o.Infinite:
		return -1
	}
	l := new(big.Int).Mul(r.Num, o.Den)
	rr := new(big.Int).Mul(o.Num, r.Den)
	return l.Cmp(rr)
}

// CmpScaled compares the rational against v/scale, exactly. Used to test a
// health factor against 1.0 without materializing a rounded value: pass
// v = scale.
func (r Rational) CmpScaled(v, scale *big.Int) int {
	if r.Infinite {
		return 1
	}
	l := new(big.Int).Mul(r.Num, scale)
	rr := new(big.Int).Mul(v, r.Den)
	return l.Cmp(rr)
}

// FloorScaled returns floor(Num × scale / Den), the single fused floor
// division. ok is false when the rational is infinite OR invalid — a renderer
// asking for a display value from a quantity that has none gets nothing, never
// a zero that looks like a number.
func (r Rational) FloorScaled(scale *big.Int) (v *big.Int, ok bool) {
	if r.Infinite || !r.Valid() {
		return nil, false
	}
	n := new(big.Int).Mul(r.Num, scale)
	return n.Div(n, r.Den), true
}

func (r Rational) String() string {
	if r.Infinite {
		return "+Inf"
	}
	if r.Num == nil || r.Den == nil {
		return "<nil>"
	}
	return r.Num.String() + "/" + r.Den.String()
}

// ---------------------------------------------------------------------------
// Inputs.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Deep copies — results never alias a caller's storage.
// ---------------------------------------------------------------------------
//
// EVERY *big.Int that crosses this package's boundary is copied, in both
// directions. A result row holding the caller's pointer is a live wire: an
// honest caller rescaling a returned price in place would silently mutate the
// input and corrupt the NEXT computation over it. The rule is uniform so no
// site has to be reasoned about individually.

// copyBig returns a fresh copy of v, preserving nil (unlike orZero, which
// turns nil into a zero — the distinction between "absent" and "zero" is
// load-bearing on optional fields such as CapValue).
func copyBig(v *big.Int) *big.Int {
	if v == nil {
		return nil
	}
	return new(big.Int).Set(v)
}

func (p PriceInput) clone() PriceInput {
	out := p
	out.Value = copyBig(p.Value)
	out.CapValue = copyBig(p.CapValue)
	return out
}

func (p ParamRow) clone() ParamRow {
	out := p
	out.LTV = copyBig(p.LTV)
	out.LiqThreshold = copyBig(p.LiqThreshold)
	out.LiqBonus = copyBig(p.LiqBonus)
	return out
}

func (r AaveReserve) clone() AaveReserve {
	out := r
	out.ScaledDebt = copyBig(r.ScaledDebt)
	out.ScaledCollateral = copyBig(r.ScaledCollateral)
	out.DebtIndex = copyBig(r.DebtIndex)
	out.CollateralIndex = copyBig(r.CollateralIndex)
	return out
}

func (c DMCollateral) clone() DMCollateral {
	out := c
	out.Amount = copyBig(c.Amount)
	return out
}

func clonePrices(in []PriceInput) []PriceInput {
	if in == nil {
		return nil
	}
	out := make([]PriceInput, len(in))
	for i, p := range in {
		out[i] = p.clone()
	}
	return out
}

func cloneParams(in []ParamRow) []ParamRow {
	if in == nil {
		return nil
	}
	out := make([]ParamRow, len(in))
	for i, p := range in {
		out[i] = p.clone()
	}
	return out
}

// Watermarks are the per-row as-ofs every served number carries. Per-asset
// rate-index as-ofs live on AaveReserve (IndexBlock/IndexTime) because
// rate_indexes updates only on ReserveDataUpdated and can trail the derive
// cursor badly — a current balances watermark over an old index hides the
// debt leg's true shelf life (Codex round 1 [H5]).
type Watermarks struct {
	BalancesBlock uint64
	ParamsBlock   uint64
	SweepBlock    uint64
}

// PriceInput is one price witness, carried with its full disclosure. AsOf is
// the TRUTHFUL chain time (poll anchor block header timestamp, or the feed
// round's updatedAt) — never the DB insertion time, which is
// backfill-contaminated (design spec §7, Codex round 2 [NEW-H]).
type PriceInput struct {
	ChainID       uint64
	Asset         common.Address
	Source        string
	Block         uint64
	AsOf          time.Time
	Value         *big.Int
	Decimals      uint8
	BudgetSeconds int64
	Provenance    string
	Fresh         bool

	// CapValue is the upper bound an Aave price-cap adapter enforces on this
	// asset, in the same units as Value; nil when uncapped or unknown.
	//
	// ADDITION to the plan's sketch, required by design spec §6: "caps bind
	// upward". Every v1 scenario is a down-shock so caps stay slack, but a
	// stress engine that cannot express a cap at all cannot ever check that
	// assumption — and validation that only passes in calm weather is
	// oracle-sentinel R6-1's named embarrassment.
	CapValue *big.Int
}

// ParamRow is one asset's effective risk parameters as of a watermark.
//
// DENOMINATORS ARE RAW, exactly as emitted, and Engine is the only evidence
// of which convention this row uses: AaveParamEngine ⇒ basis points (1e4);
// DMEngine ⇒ HUNDRED_PERCENT (100e18). Engine and ChainID are ADDITIONS to
// the plan's sketch; without the tag a row routed to the wrong surface is a
// silent 1e16× error in a liquidation threshold.
//
// LiqBonus conventions ALSO differ and are NOT interchangeable:
//   - Aave: a multiplier in bps, 10600 meaning 1.06× (seized = debt × bps/1e4).
//   - Debt Manager: an ADDITIVE bonus over HUNDRED_PERCENT, 1e18 meaning +1%
//     (seized = debt × (100e18 + bonus)/100e18). Source:
//     DebtManagerCore.sol _getCollateralTokensForDebtAmount.
//
// Use LiquidationBonusMultiplier rather than dividing by hand.
type ParamRow struct {
	Engine  string
	ChainID uint64
	Asset   common.Address

	LTV          *big.Int
	LiqThreshold *big.Int
	LiqBonus     *big.Int

	EffectiveBlock    uint64
	EffectiveLogIndex uint
	Source            string
}

// AaveReserve is one reserve leg of an Aave position.
//
// Decimals is an ADDITION to the plan's sketch and is load-bearing: the
// per-reserve base value is balance × price / 10^decimals (design spec §5.1
// component 4). Without the token's own decimals that division cannot be
// performed at all.
//
// IndexBlock/IndexTime are the rate_indexes as-of, stamped per row and
// surfaced in the result's disclosure.
type AaveReserve struct {
	Asset            common.Address
	Decimals         uint8
	ScaledDebt       *big.Int
	ScaledCollateral *big.Int
	DebtIndex        *big.Int
	CollateralIndex  *big.Int
	IndexBlock       uint64
	IndexTime        time.Time
	UsedAsCollateral bool
}

// AaveInput is one account's Aave position with all pinned inputs.
//
// Regime is an ADDITION to the plan's sketch: the scaled-to-live projection
// law changed at block 23,088,584 and a historical recompute under the wrong
// regime is a wrong number, not a rounding difference. The zero value is
// RegimeB (current).
type AaveInput struct {
	Account  common.Address
	Reserves []AaveReserve
	Params   []ParamRow
	EMode    uint8
	Prices   []PriceInput
	Regime   Regime
	// Marks are this input's as-ofs and are AUTHORITATIVE: ComputeAaveHealth
	// copies them onto the result, and refuses an input missing BalancesBlock
	// or ParamsBlock (ErrMissingWatermark, naming the field). SweepBlock is
	// NOT required here — the Aave engine has no collateral sweep.
	// PositionInput.Marks is a mirror, checked for agreement rather than
	// trusted.
	Marks Watermarks
}

// DMCollateral is one collateral leg of a Debt Manager position, as returned
// by CashLens.getUserTotalCollateral (which nets pending withdrawals — raw
// Safe ERC20 balance reads drift; risk-quant R2 leg 2).
type DMCollateral struct {
	Asset    common.Address
	Amount   *big.Int
	Decimals uint8
}

// DMInput is one Safe's Debt Manager position. DebtUSD is total live debt in
// USD 6-dec (borrowingOf), already index-replayed by the caller.
type DMInput struct {
	Account    common.Address
	DebtUSD    *big.Int
	Collateral []DMCollateral
	Params     []ParamRow
	Prices     []PriceInput
	// Marks are this input's as-ofs and are AUTHORITATIVE — see
	// AaveInput.Marks. ComputeDMHealth requires BalancesBlock, ParamsBlock AND
	// SweepBlock: DM collateral is sweep-dominated (~1h worst case) while
	// prices are 60s, so a row without the sweep block would let a 60s-fresh
	// badge sit over hour-stale collateral. ProjectDMDebt requires only
	// BalancesBlock plus a nonzero APY observation block — it projects DEBT
	// and touches no collateral.
	Marks Watermarks
}

// PositionInput is the engine-tagged union consumed by the liquidation-price,
// scenario, and waterfall surfaces.
//
// Scenario is an ADDITION: ApplyScenario records what it actually did —
// including which assets it HELD FLAT for want of a propagation entry. An
// asset silently held at its pre-shock price is oracle-sentinel R4's named
// failure ("the waterfall silently holds a chunk of TVL at pre-shock
// prices"), and the only defense is to say so on the output.
type PositionInput struct {
	Engine   string
	Aave     *AaveInput
	DM       *DMInput
	Marks    Watermarks
	Scenario *ScenarioApplication
}

// Validate checks the engine tag against the populated payload.
func (p PositionInput) Validate() error {
	var engineMarks Watermarks
	switch p.Engine {
	case AaveEngine:
		if p.Aave == nil || p.DM != nil {
			return fmt.Errorf("%w: engine %q with Aave=%v DM=%v", ErrEngineMismatch, p.Engine, p.Aave != nil, p.DM != nil)
		}
		engineMarks = p.Aave.Marks
	case DMEngine:
		if p.DM == nil || p.Aave != nil {
			return fmt.Errorf("%w: engine %q with Aave=%v DM=%v", ErrEngineMismatch, p.Engine, p.Aave != nil, p.DM != nil)
		}
		engineMarks = p.DM.Marks
	default:
		return fmt.Errorf("%w: unknown engine %q", ErrEngineMismatch, p.Engine)
	}
	// The engine input owns the marks; this mirror may be left empty, but a
	// mirror that DISAGREES means the caller built the two from different
	// reads, and one of the two numbers it will publish is wrong.
	if p.Marks != (Watermarks{}) && p.Marks != engineMarks {
		return fmt.Errorf("%w: position %+v vs engine input %+v", ErrWatermarkMismatch, p.Marks, engineMarks)
	}
	return nil
}

// ---------------------------------------------------------------------------
// Outputs.
// ---------------------------------------------------------------------------

// AaveReserveValue is one reserve's contribution, with the exact price
// witness consumed.
type AaveReserveValue struct {
	Asset          common.Address
	Decimals       uint8
	LiveDebt       *big.Int // token units, rayMulCeil(scaled, debtIndex)
	LiveCollateral *big.Int // token units, rayMulFloor(scaled, collateralIndex)
	DebtBase       *big.Int // base currency, floor(liveDebt × price / 10^dec)
	CollateralBase *big.Int // base currency; zero when !UsedAsCollateral

	LiquidationThresholdBps *big.Int // nil when the reserve holds no collateral
	LiquidationBonusBps     *big.Int
	WeightedLT              *big.Int // CollateralBase × LT_bps

	IndexBlock uint64
	IndexTime  time.Time
	Price      PriceInput
}

// AaveHealth is the Aave engine's seven-component result (design spec §5.1).
type AaveHealth struct {
	Account      common.Address
	Regime       Regime
	BaseDecimals uint8

	Reserves []AaveReserveValue

	TotalCollateralBase *big.Int
	TotalDebtBase       *big.Int
	// WeightedLTSum is Σ(CollateralBaseᵢ × LT_bpsᵢ), the EXACT weighted sum
	// the fused health-factor division consumes. It is not divided down.
	WeightedLTSum *big.Int
	// AvgLiquidationThresholdBps is component 6:
	// floor(WeightedLTSum / TotalCollateralBase). nil when there is no
	// collateral. It is a DISCLOSURE, not an input to the health factor —
	// the deployed law fuses over WeightedLTSum directly (P-2).
	AvgLiquidationThresholdBps *big.Int

	// HealthFactorWad is the chain-identical value: a SINGLE FUSED FLOOR
	// DIVISION, floor(WeightedLTSum × 1e18 / (10000 × TotalDebtBase)).
	// nil when IsInfinite.
	HealthFactorWad *big.Int
	// HealthFactor is the same quantity un-rounded, for downstream exact
	// arithmetic (liquidation price, waterfall crossings).
	HealthFactor Rational
	// IsInfinite marks zero debt: the health factor is
	// undefined-because-unbounded. Never a fake big number.
	IsInfinite bool

	// StalePriceInputs is true when ANY consumed price input had Fresh=false.
	// The flag propagates to every aggregate containing this row
	// (oracle-sentinel R2/G4).
	StalePriceInputs bool
	// OldestPriceInput is the min AsOf over consumed inputs, labeled as such
	// (oracle-sentinel R1: a single summary timestamp is permitted only in
	// this form). Zero when no price was consumed.
	OldestPriceInput time.Time

	Marks Watermarks
}

// DMCollateralValue is one Debt Manager collateral leg's contribution.
type DMCollateralValue struct {
	Asset    common.Address
	Decimals uint8
	Amount   *big.Int
	// ValueUSD is floor(Amount × price / 10^decimals), USD 6-dec —
	// DebtManagerCore.convertCollateralTokenToUsd.
	ValueUSD *big.Int
	// LiquidationThreshold and LiquidationBonus carry the HUNDRED_PERCENT
	// (100e18) denominator, raw as emitted.
	LiquidationThreshold *big.Int
	LiquidationBonus     *big.Int
	// MaxBorrowContribution is mulDiv(ValueUSD, LT, 100e18, Floor). The floor
	// is applied PER TOKEN and then summed, exactly as the deployed loop does
	// (DebtManagerCore.getMaxBorrowAmount) — sum-then-floor is a different
	// number.
	MaxBorrowContribution *big.Int
	Price                 PriceInput
}

// DMHealth is the Debt Manager engine's result. There is no continuous health
// factor on-chain; Liquidatable is the ground-truth boolean and HealthFactor
// is Solvent's own exact ratio, labeled as such.
type DMHealth struct {
	Account     common.Address
	UsdDecimals uint8

	Collateral []DMCollateralValue

	CollateralValueUSD *big.Int // Σ ValueUSD, = getCollateralValueInUsd
	MaxBorrowLT        *big.Int // Σ MaxBorrowContribution, = getMaxBorrowAmount(user,false)
	Borrowings         *big.Int // borrowingOf(user), USD 6-dec

	// Liquidatable is STRICT: Borrowings > MaxBorrowLT. Equality is healthy
	// (DebtManagerCore.liquidatable).
	Liquidatable bool
	// HealthFactor is MaxBorrowLT / Borrowings as an exact rational, never a
	// float. Infinite when Borrowings is zero.
	HealthFactor Rational
	IsInfinite   bool

	StalePriceInputs bool
	OldestPriceInput time.Time
	Marks            Watermarks
}

// DMProjection is ProjectDMDebt's result.
//
// The plan sketched a bare *big.Int return; that cannot carry the APY
// observation block, which the design REQUIRES be stamped into the result's
// disclosure (plan Task 4, design spec §5). A stamp that lives only in a doc
// comment is not a stamp.
type DMProjection struct {
	Account        common.Address
	DebtUSD        *big.Int // debt₀, USD 6-dec
	ProjectedUSD   *big.Int // debt(t), USD 6-dec
	InterestUSD    *big.Int // ProjectedUSD − DebtUSD
	APYPerSecond   *big.Int // borrowApy, denominator 100e18, per SECOND
	APYObservedAt  uint64   // the block the APY was observed at
	HorizonSeconds int64
	Label          string // always "PROJECTION"
	PricesHeldFlat bool   // always true: this axis moves debt only
	Marks          Watermarks
}

// MarketRealization is the market-value axis: what a liquidator can actually
// realize per unit of ORACLE mark, as a WAD ratio (0.95e18 = 95 cents on the
// oracle dollar).
//
// This type is deliberately SEPARATE from PriceInput. Market value is not an
// oracle mark; neither protocol reads a secondary-market weETH price, so a
// market depeg moves no health factor. Folding this ratio into a PriceInput
// would be an HF shock wearing a depeg label — the one forbidden
// implementation (Codex round 1 [M8], oracle-sentinel R3).
type MarketRealization struct {
	Asset   common.Address
	ChainID uint64
	// MarketOverOracle is WAD-scaled: 950000000000000000 = 0.95.
	MarketOverOracle *big.Int
}

// ShortfallResult is the market-depeg output: oracles held, health factors
// identical, realized-value gap quantified.
type ShortfallResult struct {
	// HFsUnchanged is computed, not asserted: ExecutionShortfall evaluates
	// every position's health twice and compares the wad values bit-for-bit.
	HFsUnchanged bool
	// ExecutionShortfallUSD is Σ over liquidatable positions of
	// (oracle value of seizable collateral − market value of the same), in
	// each engine's own USD scale — see PerEngine for the un-blended split.
	ExecutionShortfallUSD *big.Int
	// BadDebtAtLiquidationUSD is Σ over liquidatable positions of
	// max(0, debt − realizable collateral value at market).
	BadDebtAtLiquidationUSD *big.Int

	// PerEngine keeps the two engines' numbers un-blended (design spec §5.2:
	// "engines are never blended into one number"). The two aggregates above
	// are provided only because the plan's ShortfallResult declares them;
	// they are valid ONLY when the book is single-engine, which
	// SingleEngineScale records.
	PerEngine map[string]EngineShortfall
	// SingleEngineScale names the engine whose USD scale the two flat
	// aggregates are expressed in, or "" when the book spans both engines —
	// in which case the flat aggregates are nil and the caller must read
	// PerEngine.
	SingleEngineScale string

	// SeizureModel stamps the seizure assumption ON THE WIRE
	// (SeizureModelProRata). A shortfall number is only interpretable next to
	// the model that produced it, and a modeling assumption that lives only in
	// a package comment does not survive the trip to JSON.
	SeizureModel string

	Positions []PositionShortfall
}

// EngineShortfall is one engine's shortfall totals in its own USD scale.
type EngineShortfall struct {
	Engine                  string
	UsdDecimals             uint8
	ExecutionShortfallUSD   *big.Int
	BadDebtAtLiquidationUSD *big.Int
	LiquidatablePositions   int
	InsolventPositions      int
}

// PositionShortfall is one account's contribution.
type PositionShortfall struct {
	Engine                  string
	Account                 common.Address
	Liquidatable            bool
	CollateralOracleUSD     *big.Int
	SeizableOracleUSD       *big.Int
	SeizableMarketUSD       *big.Int
	ExecutionShortfallUSD   *big.Int
	DebtUSD                 *big.Int
	RealizableCollateralUSD *big.Int
	BadDebtUSD              *big.Int
}
