package risk

// The stress engine (design spec §6; risk-quant R3, oracle-sentinel R3/R4).
//
// # Shocks live on primitive axes only
//
// A scenario may move ETH/USD, the weETH/ETH redemption rate, a stable's USD
// price, an idiosyncratic asset's USD price, or the borrow APY. It may NOT
// move a derived USD feed directly. "weETH −20%, ETH flat" is an implicit 20%
// slashing claim wearing a market-crash costume; "weETH −20% AND ETH −20%"
// double-counts through the ratio.
//
// # Propagation runs through the protocols' ACTUAL transforms
//
// Each asset declares which primitive axes its price is composed from — weETH
// = redemption rate × ETH/USD, liquidETH = lens rate × ETH/USD, and so on —
// and the shocked value is the product of those axes' factors applied to the
// stored price. Then the engine's own transforms run:
//
//   - DM stable snap: PriceProviderV2 pins an in-band stable to EXACTLY 1e6.
//     Shocking the stored row linearly is wrong in both directions.
//   - Aave price caps: adapters bind UPWARD only, so every v1 down-shock
//     leaves them slack. That is checked here, not assumed.
//
// # Assets with no propagation entry are HELD FLAT, and said so
//
// An asset the matrix does not describe keeps its pre-shock price. That is
// the only safe default, and it is also oracle-sentinel R4's named failure
// mode ("the waterfall silently holds a chunk of TVL at pre-shock prices") —
// so ApplyScenario records every held-flat asset on the result rather than
// letting the omission be invisible.

import (
	"embed"
	"encoding/json"
	"errors"
	"fmt"
	"math/big"
	"sort"
	"strings"

	"github.com/ethereum/go-ethereum/common"
)

//go:embed scenarios/*.json
var scenarioFS embed.FS

// scenarioDir is the embedded directory holding the committed v1 set.
const scenarioDir = "scenarios"

// Axis is a primitive stress axis. Nothing else may be shocked.
type Axis string

const (
	// AxisETHUSD is the ETH/USD market price.
	AxisETHUSD Axis = "eth_usd"
	// AxisWeETHRate is the weETH/eETH redemption rate — the exchange rate
	// BOTH engines actually mark weETH against. This, not a secondary-market
	// weETH price, is the axis that moves health factors.
	AxisWeETHRate Axis = "weeth_eth_rate"
	// AxisStableUSD is one stablecoin's USD price. Per-asset.
	AxisStableUSD Axis = "stable_usd"
	// AxisAssetUSD is an idiosyncratic asset's USD price, for assets whose
	// price is not mechanically derived from ETH — ETHFI and the BTC leg.
	//
	// ADDITION to the four axes oracle-sentinel R4 enumerates: design spec §6
	// REQUIRES the ETHFI −50% and liquidBTC/eBTC −20% scenarios, and neither
	// is expressible on ETH/USD, the weETH rate, a stable, or the borrow APY.
	AxisAssetUSD Axis = "asset_usd"
	// AxisBorrowAPY is the Debt Manager borrow APY. It moves debt over a
	// horizon, never a spot price, and is consumed by ProjectDMDebt rather
	// than by ApplyScenario.
	AxisBorrowAPY Axis = "borrow_apy"
)

// perAssetAxes are the axes that REQUIRE an asset key; the others forbid one.
var perAssetAxes = map[Axis]bool{
	AxisStableUSD: true,
	AxisAssetUSD:  true,
}

var knownAxes = map[Axis]bool{
	AxisETHUSD:    true,
	AxisWeETHRate: true,
	AxisStableUSD: true,
	AxisAssetUSD:  true,
	AxisBorrowAPY: true,
}

// ErrScenarioInvalid is returned by the loader for any schema or coherence
// violation. Scenario definitions are committed config that public numbers
// are computed from; a malformed one is refused, never repaired.
var ErrScenarioInvalid = errors.New("risk: invalid scenario definition")

// ErrScenarioNotFound is returned by LoadScenario for an unknown id.
var ErrScenarioNotFound = errors.New("risk: scenario not found")

// AxisRef names an axis instance: the axis plus, for per-asset axes, the
// asset it applies to.
type AxisRef struct {
	Axis  Axis   `json:"axis"`
	Asset string `json:"asset,omitempty"`
}

func (a AxisRef) key() string {
	return string(a.Axis) + "|" + strings.ToLower(a.Asset)
}

func (a AxisRef) String() string { return a.key() }

// Shock moves one axis by an EXACT rational factor. −20% is 80/100, not 0.8:
// this package has no floats and a scenario file may not smuggle one in.
type Shock struct {
	Axis      Axis   `json:"axis"`
	Asset     string `json:"asset,omitempty"`
	FactorNum int64  `json:"factor_num"`
	FactorDen int64  `json:"factor_den"`
}

func (s Shock) ref() AxisRef { return AxisRef{Axis: s.Axis, Asset: s.Asset} }

// AssetResponse is one row of the propagation matrix: which primitive axes an
// asset's USD price is composed from, and which engine transform applies.
type AssetResponse struct {
	Asset      string    `json:"asset"`
	ChainID    uint64    `json:"chain_id"`
	Symbol     string    `json:"symbol,omitempty"`
	RespondsTo []AxisRef `json:"responds_to"`
	// StableSnap marks an `isStableToken` config: PriceProviderV2 snaps this
	// token's OWN output to exactly 1e6 inside the open band. Only meaningful
	// for DM prices, which are 6-decimal.
	StableSnap bool `json:"stable_snap,omitempty"`
	// BaseStableSnap marks a token that is NOT itself a stable but whose
	// price is COMPOSED over a stable base — `rate × price(baseAsset)` with
	// baseAsset an `isStableToken` config.
	//
	// PriceProviderV2.price() snaps the BASE before multiplying
	// (PriceProviderV2.sol:268-271):
	//
	//	if (baseConfig.isStableToken) {
	//	    basePrice = _getStablePrice(basePrice, basePriceDecimals);
	//	    basePriceDecimals = decimals();
	//	}
	//
	// so a shock to the base's USD axis reaches this token only through the
	// snap: its effective factor is snap(1e6 × f) / 1e6. An in-band base
	// shock therefore holds this token EXACTLY, and modeling it as a linear
	// ×f is wrong on every in-band scenario.
	//
	// Mutually exclusive with StableSnap, matching the chain: a config with a
	// baseAsset may not also be isStableToken (PriceProviderV2.sol:354,
	// StableTokenCannotHaveBaseAsset).
	BaseStableSnap bool   `json:"base_stable_snap,omitempty"`
	Note           string `json:"note,omitempty"`
}

// MarketRealizationSpec is the market-value axis carried as scenario data. It
// is NOT a price shock and ApplyScenario ignores it: it feeds
// ExecutionShortfall, where oracles are held and health factors must come out
// bit-identical.
type MarketRealizationSpec struct {
	Asset               string `json:"asset"`
	ChainID             uint64 `json:"chain_id"`
	Symbol              string `json:"symbol,omitempty"`
	MarketOverOracleWad string `json:"market_over_oracle_wad"`
	Note                string `json:"note,omitempty"`
}

// ProjectionSpec is the rate-horizon scenario's data.
//
// APYDeltaPerSecond100e18 is the DEPLOYED unit: borrowApy is a per-second
// value with denominator HUNDRED_PERCENT. AnnualDeltaBps is the human-facing
// figure, and the loader CHECKS one against the other so a typo in either
// field is a load failure rather than a wrong published projection.
type ProjectionSpec struct {
	AnnualDeltaBps          int64   `json:"annual_delta_bps"`
	APYDeltaPerSecond100e18 string  `json:"apy_delta_per_second_100e18"`
	HorizonsSeconds         []int64 `json:"horizons_seconds"`
	Note                    string  `json:"note,omitempty"`
}

// Scenario is one committed stress definition.
type Scenario struct {
	ID             string `json:"id"`
	Version        string `json:"version"`
	Label          string `json:"label"`
	Description    string `json:"description"`
	PathAssumption string `json:"path_assumption"`
	// Engines the scenario is defined for; informational, checked non-empty.
	Engines            []string                `json:"engines"`
	Shocks             []Shock                 `json:"shocks"`
	Propagation        []AssetResponse         `json:"propagation"`
	MarketRealizations []MarketRealizationSpec `json:"market_realizations,omitempty"`
	Projection         *ProjectionSpec         `json:"projection,omitempty"`
	OutOfModel         []string                `json:"out_of_model"`
}

// ---------------------------------------------------------------------------
// Loading.
// ---------------------------------------------------------------------------

// LoadScenarios parses and validates every committed scenario. The set is
// compiled into the binary, so a published number can always be recomputed
// from the exact definition that produced it.
func LoadScenarios() ([]Scenario, error) {
	entries, err := scenarioFS.ReadDir(scenarioDir)
	if err != nil {
		return nil, err
	}
	names := make([]string, 0, len(entries))
	for _, e := range entries {
		if e.IsDir() || !strings.HasSuffix(e.Name(), ".json") {
			continue
		}
		names = append(names, e.Name())
	}
	sort.Strings(names)

	return assembleScenarios(names, func(n string) ([]byte, error) {
		return scenarioFS.ReadFile(scenarioDir + "/" + n)
	})
}

// assembleScenarios parses a named set through `read` and enforces the
// set-level rules: every file must parse, ids must be unique, and the set must
// not be empty.
//
// It takes `read` as a parameter for one reason: driven from the embedded FS
// these three failures cannot occur, so without a seam they would be
// unexecuted code claiming to guard a set that public numbers are computed
// from. TestAssembleScenariosSetLevelRules exercises them.
func assembleScenarios(names []string, read func(string) ([]byte, error)) ([]Scenario, error) {
	out := make([]Scenario, 0, len(names))
	seen := make(map[string]string, len(names))
	for _, n := range names {
		b, err := read(n)
		if err != nil {
			return nil, fmt.Errorf("%s: %w", n, err)
		}
		sc, err := ParseScenario(b)
		if err != nil {
			return nil, fmt.Errorf("%s: %w", n, err)
		}
		if prev, dup := seen[sc.ID]; dup {
			return nil, fmt.Errorf("%w: id %q declared by both %s and %s", ErrScenarioInvalid, sc.ID, prev, n)
		}
		seen[sc.ID] = n
		out = append(out, sc)
	}
	if len(out) == 0 {
		return nil, fmt.Errorf("%w: no scenario definitions are embedded", ErrScenarioInvalid)
	}
	return out, nil
}

// LoadScenario returns the committed scenario with the given id.
func LoadScenario(id string) (Scenario, error) {
	all, err := LoadScenarios()
	if err != nil {
		return Scenario{}, err
	}
	for _, s := range all {
		if s.ID == id {
			return s, nil
		}
	}
	return Scenario{}, fmt.Errorf("%w: %q", ErrScenarioNotFound, id)
}

// ScenarioFilenames lists the embedded definition files, sorted.
func ScenarioFilenames() ([]string, error) {
	entries, err := scenarioFS.ReadDir(scenarioDir)
	if err != nil {
		return nil, err
	}
	out := make([]string, 0, len(entries))
	for _, e := range entries {
		if !e.IsDir() && strings.HasSuffix(e.Name(), ".json") {
			out = append(out, e.Name())
		}
	}
	sort.Strings(out)
	return out, nil
}

// ParseScenario decodes one definition STRICTLY — unknown fields are a
// failure, not a shrug — and validates it.
func ParseScenario(b []byte) (Scenario, error) {
	dec := json.NewDecoder(strings.NewReader(string(b)))
	dec.DisallowUnknownFields()
	var sc Scenario
	if err := dec.Decode(&sc); err != nil {
		return Scenario{}, fmt.Errorf("%w: %v", ErrScenarioInvalid, err)
	}
	if err := dec.Decode(new(json.RawMessage)); err == nil {
		return Scenario{}, fmt.Errorf("%w: trailing content after the scenario object", ErrScenarioInvalid)
	}
	if err := sc.Validate(); err != nil {
		return Scenario{}, err
	}
	return sc, nil
}

// Validate enforces the scenario schema and its coherence rules.
func (s Scenario) Validate() error {
	bad := func(format string, a ...any) error {
		return fmt.Errorf("%w: %s", ErrScenarioInvalid, fmt.Sprintf(format, a...))
	}
	if strings.TrimSpace(s.ID) == "" {
		return bad("id is empty")
	}
	if strings.TrimSpace(s.Version) == "" {
		return bad("%s: version is empty", s.ID)
	}
	if strings.TrimSpace(s.Label) == "" {
		return bad("%s: label is empty", s.ID)
	}
	if strings.TrimSpace(s.Description) == "" {
		return bad("%s: description is empty", s.ID)
	}
	if strings.TrimSpace(s.PathAssumption) == "" {
		return bad("%s: path_assumption is empty — every scenario states its path", s.ID)
	}
	if len(s.Engines) == 0 {
		return bad("%s: engines is empty", s.ID)
	}
	for _, e := range s.Engines {
		if e != AaveEngine && e != DMEngine {
			return bad("%s: unknown engine %q", s.ID, e)
		}
	}
	if len(s.OutOfModel) == 0 {
		return bad("%s: out_of_model is empty — a scenario with nothing outside its model is not honest", s.ID)
	}
	if len(s.Shocks) == 0 && len(s.MarketRealizations) == 0 && s.Projection == nil {
		return bad("%s: scenario moves nothing (no shocks, no market realizations, no projection)", s.ID)
	}

	// Propagation matrix.
	seenAsset := make(map[string]bool, len(s.Propagation))
	provided := make(map[string]bool)
	for i, r := range s.Propagation {
		if !common.IsHexAddress(r.Asset) {
			return bad("%s: propagation[%d]: %q is not a hex address", s.ID, i, r.Asset)
		}
		if r.ChainID == 0 {
			return bad("%s: propagation[%d] (%s): chain_id is zero", s.ID, i, r.Asset)
		}
		k := fmt.Sprintf("%d|%s", r.ChainID, strings.ToLower(r.Asset))
		if seenAsset[k] {
			return bad("%s: propagation declares %s on chain %d twice", s.ID, r.Asset, r.ChainID)
		}
		seenAsset[k] = true
		if len(r.RespondsTo) == 0 {
			return bad("%s: propagation[%d] (%s): responds_to is empty", s.ID, i, r.Asset)
		}
		if r.StableSnap && r.BaseStableSnap {
			return bad("%s: propagation[%d] (%s): stable_snap and base_stable_snap are mutually exclusive — on chain a config with a baseAsset may not be isStableToken (PriceProviderV2 StableTokenCannotHaveBaseAsset)", s.ID, i, r.Asset)
		}
		if r.BaseStableSnap {
			// The base snap is a transform of ONE stable base's price. A row
			// responding to several axes has no unambiguous base factor to
			// snap, so the schema refuses it rather than guessing.
			if len(r.RespondsTo) != 1 || r.RespondsTo[0].Axis != AxisStableUSD {
				return bad("%s: propagation[%d] (%s): base_stable_snap requires exactly one responds_to entry on the %s axis (the stable base)", s.ID, i, r.Asset, AxisStableUSD)
			}
		}
		for j, a := range r.RespondsTo {
			if err := validateAxisRef(s.ID, fmt.Sprintf("propagation[%d].responds_to[%d]", i, j), a); err != nil {
				return err
			}
			provided[a.key()] = true
		}
	}

	// Shocks.
	seenShock := make(map[string]bool, len(s.Shocks))
	for i, sh := range s.Shocks {
		ref := sh.ref()
		if err := validateAxisRef(s.ID, fmt.Sprintf("shocks[%d]", i), ref); err != nil {
			return err
		}
		if seenShock[ref.key()] {
			return bad("%s: shocks[%d]: axis %s shocked twice", s.ID, i, ref)
		}
		seenShock[ref.key()] = true
		if sh.FactorDen <= 0 {
			return bad("%s: shocks[%d]: factor_den must be positive", s.ID, i)
		}
		if sh.FactorNum < 0 {
			return bad("%s: shocks[%d]: factor_num must not be negative", s.ID, i)
		}
		// AxisBorrowAPY is consumed by ProjectDMDebt, not by price
		// propagation, so it is exempt from the referenced-by-matrix rule.
		if sh.Axis == AxisBorrowAPY {
			continue
		}
		if !provided[ref.key()] {
			return bad("%s: shocks[%d]: axis %s is shocked but no propagation row responds to it — the shock would be a silent no-op", s.ID, i, ref)
		}
	}

	// Market realizations.
	seenReal := make(map[string]bool, len(s.MarketRealizations))
	for i, m := range s.MarketRealizations {
		if !common.IsHexAddress(m.Asset) {
			return bad("%s: market_realizations[%d]: %q is not a hex address", s.ID, i, m.Asset)
		}
		if m.ChainID == 0 {
			return bad("%s: market_realizations[%d] (%s): chain_id is zero", s.ID, i, m.Asset)
		}
		k := fmt.Sprintf("%d|%s", m.ChainID, strings.ToLower(m.Asset))
		if seenReal[k] {
			return bad("%s: market_realizations declares %s on chain %d twice", s.ID, m.Asset, m.ChainID)
		}
		seenReal[k] = true
		v, ok := new(big.Int).SetString(m.MarketOverOracleWad, 10)
		if !ok || v.Sign() <= 0 {
			return bad("%s: market_realizations[%d] (%s): market_over_oracle_wad %q is not a positive integer", s.ID, i, m.Asset, m.MarketOverOracleWad)
		}
	}

	// Projection.
	if p := s.Projection; p != nil {
		if p.AnnualDeltaBps <= 0 {
			return bad("%s: projection.annual_delta_bps must be positive", s.ID)
		}
		if len(p.HorizonsSeconds) == 0 {
			return bad("%s: projection.horizons_seconds is empty", s.ID)
		}
		for i, h := range p.HorizonsSeconds {
			if h <= 0 {
				return bad("%s: projection.horizons_seconds[%d] must be positive", s.ID, i)
			}
		}
		got, ok := new(big.Int).SetString(p.APYDeltaPerSecond100e18, 10)
		if !ok || got.Sign() <= 0 {
			return bad("%s: projection.apy_delta_per_second_100e18 %q is not a positive integer", s.ID, p.APYDeltaPerSecond100e18)
		}
		// annual_delta_bps → HUNDRED_PERCENT-scaled annual: bps × 1e16
		// (200 bps = 2% = 2e18), then per second.
		annual := new(big.Int).Mul(big.NewInt(p.AnnualDeltaBps), new(big.Int).Exp(big.NewInt(10), big.NewInt(16), nil))
		want := APYPerSecondFromAnnual(annual)
		if got.Cmp(want) != 0 {
			return bad("%s: projection.apy_delta_per_second_100e18 is %s but %d bps over a 365-day year is %s",
				s.ID, got, p.AnnualDeltaBps, want)
		}
	}
	return nil
}

func validateAxisRef(id, where string, a AxisRef) error {
	if !knownAxes[a.Axis] {
		return fmt.Errorf("%w: %s: %s: unknown axis %q", ErrScenarioInvalid, id, where, a.Axis)
	}
	if perAssetAxes[a.Axis] {
		if !common.IsHexAddress(a.Asset) {
			return fmt.Errorf("%w: %s: %s: axis %s requires a hex asset, got %q", ErrScenarioInvalid, id, where, a.Axis, a.Asset)
		}
		return nil
	}
	if a.Asset != "" {
		return fmt.Errorf("%w: %s: %s: axis %s is global and must not carry an asset (%q)", ErrScenarioInvalid, id, where, a.Axis, a.Asset)
	}
	return nil
}

// MarketRealizationsFor materializes the scenario's market-value axis as
// typed values.
func (s Scenario) MarketRealizationsFor() []MarketRealization {
	out := make([]MarketRealization, 0, len(s.MarketRealizations))
	for _, m := range s.MarketRealizations {
		v, _ := new(big.Int).SetString(m.MarketOverOracleWad, 10)
		out = append(out, MarketRealization{
			Asset:            common.HexToAddress(m.Asset),
			ChainID:          m.ChainID,
			MarketOverOracle: v,
		})
	}
	return out
}

// WithSingleShockFactor returns a copy of the scenario whose ONE shock has the
// given factor. It refuses a scenario that does not have exactly one shock —
// which is what makes the waterfall's monotonicity invariant meaningful (a
// multi-factor grid has no such guarantee).
func (s Scenario) WithSingleShockFactor(num, den *big.Int) (Scenario, error) {
	if len(s.Shocks) != 1 {
		return Scenario{}, fmt.Errorf("%w: %s declares %d shocks, want exactly 1", ErrScenarioInvalid, s.ID, len(s.Shocks))
	}
	if num == nil || den == nil || den.Sign() <= 0 || num.Sign() < 0 {
		return Scenario{}, fmt.Errorf("%w: %s: bad grid factor", ErrScenarioInvalid, s.ID)
	}
	if !num.IsInt64() || !den.IsInt64() {
		return Scenario{}, fmt.Errorf("%w: %s: grid factor does not fit the scenario schema's int64 fields", ErrScenarioInvalid, s.ID)
	}
	out := s
	out.Shocks = []Shock{{
		Axis:      s.Shocks[0].Axis,
		Asset:     s.Shocks[0].Asset,
		FactorNum: num.Int64(),
		FactorDen: den.Int64(),
	}}
	return out, nil
}

// ---------------------------------------------------------------------------
// Application.
// ---------------------------------------------------------------------------

// AppliedShock records what happened to one price input.
//
// FactorNum/FactorDen are the RAW product of the shocked axes this asset
// responds to — what the scenario declared. Before/After are the realized
// move, which differs from the raw factor whenever a transform fired: read
// Snapped (this token's own output snapped), BaseSnapped (its stable BASE
// snapped, so an in-band shock did not reach it at all), or CapBound.
type AppliedShock struct {
	Asset     common.Address
	ChainID   uint64
	Source    string
	FactorNum *big.Int
	FactorDen *big.Int
	Before    *big.Int
	After     *big.Int
	Snapped   bool
	// BaseSnapped: the token's stable BASE snapped back to par inside the
	// composition, so the declared factor did not reach this price.
	BaseSnapped bool
	CapBound    bool
}

// HeldFlatInput records a price the scenario did not describe.
type HeldFlatInput struct {
	Asset   common.Address
	ChainID uint64
	Source  string
	Value   *big.Int
}

// ScenarioApplication is ApplyScenario's disclosure: exactly what moved,
// exactly what did not, and why.
type ScenarioApplication struct {
	ScenarioID      string
	ScenarioVersion string
	Applied         []AppliedShock
	HeldFlat        []HeldFlatInput
}

// ApplyScenario returns a copy of the position with its price inputs shocked
// through the scenario's propagation matrix and the engines' own transforms.
// The input is never mutated: the price slice and every *big.Int in it are
// fresh. The reserve/collateral/param slices are SHARED with the input because
// no shock touches them and a grid walk over a book of ~10k accounts would
// otherwise copy them at every point; nothing in this package writes through
// them.
//
// The scenario's market_realizations and projection legs are NOT applied here:
// a market realization is not an oracle mark (feeding it into a price would be
// an HF shock wearing a depeg label — the one forbidden implementation), and a
// rate projection moves debt over a horizon, not a spot price. Route those to
// ExecutionShortfall and ProjectDMDebt.
func ApplyScenario(in PositionInput, sc Scenario) (PositionInput, error) {
	if err := in.Validate(); err != nil {
		return PositionInput{}, err
	}
	if err := sc.Validate(); err != nil {
		return PositionInput{}, err
	}

	factors := make(map[string][2]*big.Int, len(sc.Shocks))
	for _, sh := range sc.Shocks {
		if sh.Axis == AxisBorrowAPY {
			continue
		}
		factors[sh.ref().key()] = [2]*big.Int{big.NewInt(sh.FactorNum), big.NewInt(sh.FactorDen)}
	}
	responses := make(map[string]AssetResponse, len(sc.Propagation))
	for _, r := range sc.Propagation {
		responses[responseKey(r.ChainID, common.HexToAddress(r.Asset))] = r
	}

	app := &ScenarioApplication{ScenarioID: sc.ID, ScenarioVersion: sc.Version}

	shock := func(engine string, prices []PriceInput) ([]PriceInput, error) {
		out := make([]PriceInput, len(prices))
		for i, p := range prices {
			cp := p
			cp.Value = orZero(p.Value)
			if p.CapValue != nil {
				cp.CapValue = new(big.Int).Set(p.CapValue)
			}
			r, ok := responses[responseKey(p.ChainID, p.Asset)]
			if !ok {
				app.HeldFlat = append(app.HeldFlat, HeldFlatInput{
					Asset: p.Asset, ChainID: p.ChainID, Source: p.Source, Value: orZero(p.Value),
				})
				out[i] = cp
				continue
			}

			num := big.NewInt(1)
			den := big.NewInt(1)
			for _, a := range r.RespondsTo {
				f, shocked := factors[a.key()]
				if !shocked {
					continue
				}
				num.Mul(num, f[0])
				den.Mul(den, f[1])
			}

			before := orZero(p.Value)
			var after *big.Int
			snapped, baseSnapped := false, false

			switch {
			case r.BaseStableSnap:
				// price = rate × snap(base). The rate is held, so the shock
				// reaches this token only through the base's snap: the
				// effective factor is snap(1e6 × f) / 1e6.
				if p.Decimals != 6 {
					return nil, assetErr("apply scenario", engine, p.Asset, ErrMixedPriceDecimals,
						fmt.Sprintf("base_stable_snap needs a 6-decimal price, got %d", p.Decimals))
				}
				base, bs := ApplyDMStableSnap(MulDivFloor(stablePrice, num, den))
				baseSnapped = bs
				after = MulDivFloor(before, base, stablePrice)
			case r.StableSnap:
				if p.Decimals != 6 {
					return nil, assetErr("apply scenario", engine, p.Asset, ErrMixedPriceDecimals,
						fmt.Sprintf("stable_snap needs a 6-decimal price, got %d", p.Decimals))
				}
				after, snapped = ApplyDMStableSnap(MulDivFloor(before, num, den))
			default:
				after = MulDivFloor(before, num, den)
			}

			capBound := false
			if cp.CapValue != nil {
				after, capBound = ApplyPriceCap(after, cp.CapValue)
			}

			cp.Value = after
			out[i] = cp
			app.Applied = append(app.Applied, AppliedShock{
				Asset: p.Asset, ChainID: p.ChainID, Source: p.Source,
				FactorNum: num, FactorDen: den,
				Before: before, After: new(big.Int).Set(after),
				Snapped: snapped, BaseSnapped: baseSnapped, CapBound: capBound,
			})
		}
		return out, nil
	}

	out := in
	out.Scenario = app
	switch in.Engine {
	case AaveEngine:
		cp := *in.Aave
		ps, err := shock(AaveEngine, in.Aave.Prices)
		if err != nil {
			return PositionInput{}, err
		}
		cp.Prices = ps
		out.Aave = &cp
	case DMEngine:
		cp := *in.DM
		ps, err := shock(DMEngine, in.DM.Prices)
		if err != nil {
			return PositionInput{}, err
		}
		cp.Prices = ps
		out.DM = &cp
	}
	return out, nil
}

func responseKey(chainID uint64, a common.Address) string {
	return fmt.Sprintf("%d|%s", chainID, strings.ToLower(a.Hex()))
}
