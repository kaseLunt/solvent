package main

// The REST handlers: /v1/book, /v1/address/{addr}, /v1/address/{addr}/stress and
// /v1/observatory.
//
// # The daemon serves the book even when parts of it refuse
//
// A refused position appears WITH its named reason and is counted in every
// aggregate's refusal count. A whole-engine refusal (FLAG_CUSTODY_UNPROVEN
// pre-replay, say) serves as refused rows for that engine while the other engine
// serves normally. There is NEVER a silent hole: every position the batch carries
// is on the wire, and every position this layer could not reconstruct is on the
// wire too, as a refusal naming API_RECONSTRUCTION_MISMATCH.

import (
	"errors"
	"math/big"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/ethereum/go-ethereum/common"

	"github.com/kaselunt/solvent/internal/risk"
	"github.com/kaselunt/solvent/internal/riskfeed"
	"github.com/kaselunt/solvent/internal/store"
)

func errorsIsNoBatch(err error) bool { return errors.Is(err, errNoBatch) }

// serveReadError maps a read failure onto a status.
func serveReadError(w http.ResponseWriter, err error) {
	if errorsIsNoBatch(err) {
		retry := int64(5)
		writeError(w, http.StatusServiceUnavailable, codeUnavailable,
			"no complete risk batch is available yet: the materializer has not produced a servable batch. "+
				"This is a statement about this service, NOT a claim that the book is empty.", &retry)
		return
	}
	writeError(w, http.StatusInternalServerError, codeInternal, err.Error(), nil)
}

// ---------------------------------------------------------------------------
// Shared wire shapes.
// ---------------------------------------------------------------------------

type wireCount struct {
	Key   string `json:"key"`
	Count int    `json:"count"`
}

type wireAggregate struct {
	Engine        string `json:"engine"`
	ValueDecimals uint8  `json:"value_decimals"`

	Positions             int `json:"positions"`
	ComputedPositions     int `json:"computed_positions"`
	RefusedPositions      int `json:"refused_positions"`
	FlaggedPositions      int `json:"flagged_positions"`
	LiquidatablePositions int `json:"liquidatable_positions"`

	TotalCollateral string `json:"total_collateral"`
	TotalDebt       string `json:"total_debt"`

	// Refusals and Flags break the counts down by named reason. A refusal count
	// with no vocabulary behind it is not a disclosure.
	Refusals []wireCount `json:"refusals"`
	Flags    []wireCount `json:"flags"`
	// UnitNote states the scale, because the two engines are never summed and a
	// reader must not do it either.
	UnitNote string `json:"unit_note"`
}

type wireHistogramBucket struct {
	Label    string  `json:"label"`
	LowerWad *string `json:"lower_wad"`
	UpperWad *string `json:"upper_wad"`
	Count    int     `json:"count"`
}

type wireEngineHistogram struct {
	Engine        string                `json:"engine"`
	Comparator    string                `json:"comparator"`
	Buckets       []wireHistogramBucket `json:"buckets"`
	InfiniteCount int                   `json:"infinite_count"`
	RefusedCount  int                   `json:"refused_count"`
	Note          string                `json:"note"`
}

type wireHistogram struct {
	WadScale string                `json:"wad_scale"`
	Engines  []wireEngineHistogram `json:"engines"`
}

type wireHeldFlat struct {
	Asset   string `json:"asset"`
	ChainID uint64 `json:"chain_id"`
	Source  string `json:"source"`
	Value   string `json:"value"`
}

type wireWaterfallEngine struct {
	Engine                        string `json:"engine"`
	UsdDecimals                   uint8  `json:"usd_decimals"`
	NewlyEligibleAccounts         int    `json:"newly_eligible_accounts"`
	CumulativeEligibleAccounts    int    `json:"cumulative_eligible_accounts"`
	CumulativeDebtEligibleUSD     string `json:"cumulative_debt_eligible_usd"`
	CumulativeCollateralAtRiskUSD string `json:"cumulative_collateral_at_risk_usd"`
	InsolventIfLiquidatedAccounts int    `json:"insolvent_if_liquidated_accounts"`
	CumulativeBadDebtUSD          string `json:"cumulative_bad_debt_usd"`
}

type wireWaterfallPoint struct {
	Index   int                   `json:"index"`
	Factor  string                `json:"factor"`
	Engines []wireWaterfallEngine `json:"engines"`
}

type wireMonotonicity struct {
	OK     bool   `json:"ok"`
	Engine string `json:"engine,omitempty"`
	Index  *int   `json:"index,omitempty"`
	Factor string `json:"factor,omitempty"`
	Detail string `json:"detail,omitempty"`
}

type wireWaterfall struct {
	ScenarioID      string               `json:"scenario_id"`
	ScenarioVersion string               `json:"scenario_version"`
	Axis            string               `json:"axis"`
	AxisAsset       string               `json:"axis_asset,omitempty"`
	GridScale       string               `json:"grid_scale"`
	Points          []wireWaterfallPoint `json:"points"`
	HeldFlat        []wireHeldFlat       `json:"held_flat"`
	EligibilityNote string               `json:"eligibility_note"`
	Monotonicity    wireMonotonicity     `json:"monotonicity"`
	AtRiskNote      string               `json:"at_risk_note"`
}

type wireBadDebt struct {
	Engine              string `json:"engine"`
	UsdDecimals         uint8  `json:"usd_decimals"`
	CurrentBadDebtUSD   string `json:"current_bad_debt_usd"`
	InsolventPositions  int    `json:"insolvent_positions"`
	EligiblePositions   int    `json:"eligible_positions"`
	EligibleDebtUSD     string `json:"eligible_debt_usd"`
	CollateralAtRiskUSD string `json:"collateral_at_risk_usd"`
}

// wireExcluded names a position that is IN the batch but not in the book this
// layer could reconstruct. It exists so an exclusion can never be silent.
type wireExcluded struct {
	Engine  string `json:"engine"`
	Account string `json:"account"`
	Code    string `json:"code"`
	Reason  string `json:"reason"`
}

type wireBookCoverage struct {
	BatchPositions       int            `json:"batch_positions"`
	InBook               int            `json:"in_book"`
	RefusedInBatch       int            `json:"refused_in_batch"`
	ExcludedByThisLayer  int            `json:"excluded_by_this_layer"`
	Excluded             []wireExcluded `json:"excluded"`
	StressCoverageIsFull bool           `json:"stress_coverage_is_full"`
	Note                 string         `json:"note"`
}

type bookResponse struct {
	ServedAt  time.Time        `json:"served_at"`
	Batch     wireBatch        `json:"batch"`
	Engines   []wireAggregate  `json:"engines"`
	Histogram wireHistogram    `json:"hf_histogram"`
	Waterfall *wireWaterfall   `json:"waterfall"`
	BadDebt   []wireBadDebt    `json:"bad_debt"`
	Coverage  wireBookCoverage `json:"coverage"`
	Notes     []string         `json:"notes"`
}

// ---------------------------------------------------------------------------
// /v1/book
// ---------------------------------------------------------------------------

func (s *server) handleBook(w http.ResponseWriter, r *http.Request) {
	v, err := s.readBatch(r.Context(), nil)
	if err != nil {
		serveReadError(w, err)
		return
	}

	out := bookResponse{
		ServedAt: v.Now,
		Batch:    batchEnvelope(v),
		Engines:  s.aggregates(v),
		Notes: []string{
			"Aave base values are 8-decimal and Debt Manager USD is 6-decimal: the two engines are reported separately and are NEVER summed.",
			"Refused positions are counted in `refused_positions` and broken down by code in `refusals`. The book is served with its refusals, never without the positions that produced them.",
		},
	}
	out.Histogram = s.histogram(v)

	b := book(v.Positions)
	series, wferr := risk.Waterfall(b, s.cfg.WaterfallGrid, s.waterfallScenario)
	wf := wireWaterfallFrom(series, wferr)
	out.Waterfall = &wf
	out.BadDebt = badDebtLine(series)
	out.Coverage = coverage(v.Positions, len(b))

	writeJSON(w, out)
}

// aggregates renders the batch's persisted per-engine rollups, adding the
// refusal-code and flag breakdowns computed from the batch's own position rows.
func (s *server) aggregates(v *batchView) []wireAggregate {
	refusals := map[string]map[string]int{}
	flags := map[string]map[string]int{}
	bump := func(m map[string]map[string]int, engine, key string) {
		if key == "" {
			return
		}
		inner, ok := m[engine]
		if !ok {
			inner = map[string]int{}
			m[engine] = inner
		}
		inner[key]++
	}
	for _, p := range v.Positions {
		if p.Status == store.RiskPositionRefused {
			bump(refusals, p.Engine, p.RefusalCode)
		}
		if p.reconstructionErr != "" {
			bump(refusals, p.Engine, refusalReconstruction)
		}
		for _, f := range p.Flags {
			bump(flags, p.Engine, f)
		}
	}

	out := make([]wireAggregate, 0, len(v.Aggregates))
	for _, a := range v.Aggregates {
		out = append(out, wireAggregate{
			Engine:                a.Engine,
			ValueDecimals:         a.ValueDecimals,
			Positions:             a.Positions,
			ComputedPositions:     a.ComputedPositions,
			RefusedPositions:      a.RefusedPositions,
			FlaggedPositions:      a.FlaggedPositions,
			LiquidatablePositions: a.LiquidatablePositions,
			TotalCollateral:       orZeroString(a.TotalCollateral),
			TotalDebt:             orZeroString(a.TotalDebt),
			Refusals:              counts(refusals[a.Engine]),
			Flags:                 counts(flags[a.Engine]),
			UnitNote: "values are integers at " + strconv.Itoa(int(a.ValueDecimals)) +
				" decimals in this engine's own unit (Aave: the pool's base currency; Debt Manager: USD)",
		})
	}
	return out
}

func counts(m map[string]int) []wireCount {
	out := make([]wireCount, 0, len(m))
	for k, n := range m {
		out = append(out, wireCount{Key: k, Count: n})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Key < out[j].Key })
	return out
}

// histogramEdges are the bucket boundaries, WAD-scaled, in ascending order.
//
// The 1.0 edge is the one that matters and it is exact: Aave liquidates strictly
// BELOW a health factor of 1e18, so the `[1.00, 1.05)` bucket is healthy and the
// `< 1.00` bucket is the eligible set.
var histogramEdges = []struct {
	label string
	upper int64 // hundredths of a wad; 0 means open-ended
}{
	{"< 0.90", 90},
	{"0.90 – 1.00", 100},
	{"1.00 – 1.05", 105},
	{"1.05 – 1.10", 110},
	{"1.10 – 1.25", 125},
	{"1.25 – 1.50", 150},
	{"1.50 – 2.00", 200},
	{">= 2.00", 0},
}

func edgeWad(hundredths int64) *big.Int {
	w := new(big.Int).Mul(risk.WadUnit(), big.NewInt(hundredths))
	return w.Div(w, big.NewInt(100))
}

// histogram buckets each engine's positions by health factor.
//
// # The comparator differs per engine, and that is not sloppiness
//
// Aave's own liquidation test is `healthFactor < 1e18` on the WAD the pool
// computes, so the Aave histogram buckets on the persisted `hf_wad` — the chain's
// comparator, never a re-derived float (that is the rev-3 consumer warning).
//
// The Debt Manager has no health-factor wad at all: its test is the strict
// boolean `debt > maxBorrowLT`, and `hf_num/hf_den` is a DISCLOSURE of the ratio
// maxBorrowLT/borrowings. So the DM histogram buckets on that exact rational and
// says so, and its eligible count comes from `liquidatable`, not from a bucket.
func (s *server) histogram(v *batchView) wireHistogram {
	type acc struct {
		buckets    []int
		infinite   int
		refused    int
		comparator string
		note       string
	}
	byEngine := map[string]*acc{}
	engineOf := func(engine string) *acc {
		a, ok := byEngine[engine]
		if !ok {
			a = &acc{buckets: make([]int, len(histogramEdges))}
			switch engine {
			case risk.AaveEngine:
				a.comparator = "hf_wad"
				a.note = "buckets are the pool's own health-factor WAD. Aave liquidates STRICTLY BELOW 1e18, so `< 1.00` is the eligible set and exactly 1.00 is healthy."
			default:
				a.comparator = "hf_num/hf_den"
				a.note = "the Debt Manager has no health-factor wad: its liquidation test is the strict boolean `debt > maxBorrowLT`. " +
					"These buckets are the EXACT rational maxBorrowLT/borrowings, a disclosure only — take eligibility from `liquidatable_positions`."
			}
			byEngine[engine] = a
		}
		return a
	}
	// Every engine present in the batch gets a row, so a histogram never silently
	// omits an engine whose positions all refused.
	for _, a := range v.Aggregates {
		engineOf(a.Engine)
	}

	for _, p := range v.Positions {
		a := engineOf(p.Engine)
		if p.Status != store.RiskPositionComputed {
			a.refused++
			continue
		}
		if p.HFInfinite {
			a.infinite++
			continue
		}
		idx := bucketIndex(p)
		if idx < 0 {
			// No health factor on a computed position: counted as refused for
			// histogram purposes rather than silently vanishing.
			a.refused++
			continue
		}
		a.buckets[idx]++
	}

	out := wireHistogram{WadScale: risk.WadUnit().String(), Engines: []wireEngineHistogram{}}
	names := make([]string, 0, len(byEngine))
	for n := range byEngine {
		names = append(names, n)
	}
	sort.Strings(names)
	for _, n := range names {
		a := byEngine[n]
		eh := wireEngineHistogram{
			Engine:        n,
			Comparator:    a.comparator,
			InfiniteCount: a.infinite,
			RefusedCount:  a.refused,
			Note:          a.note,
			Buckets:       make([]wireHistogramBucket, 0, len(histogramEdges)),
		}
		var lower *string
		for i, e := range histogramEdges {
			b := wireHistogramBucket{Label: e.label, Count: a.buckets[i], LowerWad: lower}
			if e.upper != 0 {
				u := edgeWad(e.upper).String()
				b.UpperWad = &u
				lower = &u
			} else {
				b.UpperWad = nil
			}
			eh.Buckets = append(eh.Buckets, b)
		}
		out.Engines = append(out.Engines, eh)
	}
	return out
}

// bucketIndex places one computed position, or −1 when it carries no health
// factor at all.
func bucketIndex(p *positionRow) int {
	wad := risk.WadUnit()
	switch p.Engine {
	case risk.AaveEngine:
		if p.HFWad == nil {
			return -1
		}
		for i, e := range histogramEdges {
			if e.upper == 0 {
				return i
			}
			if p.HFWad.Cmp(edgeWad(e.upper)) < 0 {
				return i
			}
		}
		return len(histogramEdges) - 1
	default:
		if p.HFNum == nil || p.HFDen == nil || p.HFDen.Sign() <= 0 {
			return -1
		}
		ratio := risk.Rational{Num: p.HFNum, Den: p.HFDen}
		for i, e := range histogramEdges {
			if e.upper == 0 {
				return i
			}
			// CmpScaled compares the exact rational against edge/scale without
			// ever forming a float.
			if ratio.CmpScaled(edgeWad(e.upper), wad) < 0 {
				return i
			}
		}
		return len(histogramEdges) - 1
	}
}

func wireWaterfallFrom(series risk.WaterfallSeries, err error) wireWaterfall {
	out := wireWaterfall{
		ScenarioID:      series.ScenarioID,
		ScenarioVersion: series.ScenarioVersion,
		Axis:            string(series.Axis.Axis),
		AxisAsset:       series.Axis.Asset,
		GridScale:       orZeroString(series.GridScale),
		EligibilityNote: series.EligibilityNote,
		Points:          []wireWaterfallPoint{},
		HeldFlat:        []wireHeldFlat{},
		Monotonicity:    wireMonotonicity{OK: true},
		AtRiskNote: "cumulative_collateral_at_risk_usd carries NO monotonicity invariant: it is measured AT each grid point, " +
			"so it legitimately falls once already-crossed accounts are worth less. Do not render it as a monotone accumulation.",
	}
	for _, pt := range series.Points {
		wp := wireWaterfallPoint{Index: pt.Index, Factor: orZeroString(pt.Factor), Engines: []wireWaterfallEngine{}}
		for _, e := range pt.Engines {
			wp.Engines = append(wp.Engines, wireWaterfallEngine{
				Engine:                        e.Engine,
				UsdDecimals:                   e.UsdDecimals,
				NewlyEligibleAccounts:         e.NewlyEligibleAccounts,
				CumulativeEligibleAccounts:    e.CumulativeEligibleAccounts,
				CumulativeDebtEligibleUSD:     orZeroString(e.CumulativeDebtEligibleUSD),
				CumulativeCollateralAtRiskUSD: orZeroString(e.CumulativeCollateralAtRiskUSD),
				InsolventIfLiquidatedAccounts: e.InsolventIfLiquidatedAccounts,
				CumulativeBadDebtUSD:          orZeroString(e.CumulativeBadDebtUSD),
			})
		}
		out.Points = append(out.Points, wp)
	}
	for _, h := range series.HeldFlat {
		out.HeldFlat = append(out.HeldFlat, wireHeldFlat{
			Asset:   h.Asset.Hex(),
			ChainID: h.ChainID,
			Source:  h.Source,
			Value:   orZeroString(h.Value),
		})
	}
	// A NON-MONOTONE SERIES IS SURFACED, NEVER SMOOTHED (design spec §6). The
	// points computed so far are served alongside the violation, with the
	// offending grid point named.
	var nm *risk.NonMonotoneError
	switch {
	case err == nil:
	case errors.As(err, &nm):
		idx := nm.Index
		out.Monotonicity = wireMonotonicity{
			OK:     false,
			Engine: nm.Engine,
			Index:  &idx,
			Factor: orZeroString(nm.Factor),
			Detail: sanitize(nm.Error()),
		}
	default:
		out.Monotonicity = wireMonotonicity{OK: false, Detail: sanitize(err.Error())}
	}
	return out
}

// badDebtLine is the standing bad-debt census: the waterfall's UNSHOCKED point.
//
// It is the grid's factor-1.0 point when the grid opens there (the default grid
// does, deliberately). A grid configured without it gets an empty line rather
// than the first shocked point relabelled as "current".
func badDebtLine(series risk.WaterfallSeries) []wireBadDebt {
	out := []wireBadDebt{}
	wad := risk.WaterfallGridScale()
	for _, pt := range series.Points {
		if pt.Factor == nil || pt.Factor.Cmp(wad) != 0 {
			continue
		}
		for _, e := range pt.Engines {
			out = append(out, wireBadDebt{
				Engine:              e.Engine,
				UsdDecimals:         e.UsdDecimals,
				CurrentBadDebtUSD:   orZeroString(e.CumulativeBadDebtUSD),
				InsolventPositions:  e.InsolventIfLiquidatedAccounts,
				EligiblePositions:   e.CumulativeEligibleAccounts,
				EligibleDebtUSD:     orZeroString(e.CumulativeDebtEligibleUSD),
				CollateralAtRiskUSD: orZeroString(e.CumulativeCollateralAtRiskUSD),
			})
		}
		break
	}
	return out
}

func coverage(positions []*positionRow, inBook int) wireBookCoverage {
	out := wireBookCoverage{
		BatchPositions: len(positions),
		InBook:         inBook,
		Excluded:       []wireExcluded{},
		Note: "every position the batch carries is on the wire. `excluded` lists positions this layer could not rebuild into the pure library's input form — " +
			"they are absent from the stress and waterfall arithmetic and are named here rather than dropped.",
	}
	for _, p := range positions {
		if p.Status == store.RiskPositionRefused {
			out.RefusedInBatch++
		}
		if p.reconstructionErr != "" {
			out.ExcludedByThisLayer++
			out.Excluded = append(out.Excluded, wireExcluded{
				Engine:  p.Engine,
				Account: common.BytesToAddress(p.Account).Hex(),
				Code:    refusalReconstruction,
				Reason:  sanitize(p.reconstructionErr),
			})
		}
	}
	out.StressCoverageIsFull = out.ExcludedByThisLayer == 0
	return out
}

// ---------------------------------------------------------------------------
// /v1/address/{addr}
// ---------------------------------------------------------------------------

type wireRefusal struct {
	Code   string `json:"code"`
	Detail string `json:"detail"`
	Asset  string `json:"asset,omitempty"`
	Note   string `json:"note"`
}

type wireHealthFactor struct {
	Wad      *string `json:"wad"`
	Num      *string `json:"num"`
	Den      *string `json:"den"`
	Infinite bool    `json:"infinite"`
	Note     string  `json:"note"`
}

type wireLeg struct {
	Asset                 string  `json:"asset"`
	Symbol                string  `json:"symbol,omitempty"`
	Decimals              int16   `json:"decimals"`
	LiveDebt              *string `json:"live_debt"`
	LiveCollateral        *string `json:"live_collateral"`
	DebtBase              *string `json:"debt_base"`
	CollateralBase        *string `json:"collateral_base"`
	WeightedLT            *string `json:"weighted_lt"`
	UsedAsCollateral      *bool   `json:"used_as_collateral"`
	DebtIndexBlock        *uint64 `json:"debt_index_block"`
	CollateralIndexBlock  *uint64 `json:"collateral_index_block"`
	Amount                *string `json:"amount"`
	ValueUSD              *string `json:"value_usd"`
	MaxBorrowContribution *string `json:"max_borrow_contribution"`
	LiqThreshold          *string `json:"liq_threshold"`
	LiqBonus              *string `json:"liq_bonus"`
}

type wirePriceInput struct {
	Asset         string     `json:"asset"`
	ChainID       int64      `json:"chain_id"`
	Source        string     `json:"source"`
	Provenance    string     `json:"provenance"`
	Value         *string    `json:"value"`
	Decimals      *int16     `json:"decimals"`
	BlockNumber   *int64     `json:"block_number"`
	SourceAsOf    *time.Time `json:"source_as_of"`
	BudgetSeconds int64      `json:"budget_seconds"`
	Verdict       string     `json:"verdict"`
	AgeSeconds    *int64     `json:"age_seconds"`
	Fresh         bool       `json:"fresh"`
	Note          string     `json:"note"`
}

type wireAsOf struct {
	BalancesBlock    uint64     `json:"balances_block"`
	ParamsBlock      uint64     `json:"params_block"`
	SweepBlock       uint64     `json:"sweep_block"`
	OldestPriceInput *time.Time `json:"oldest_price_input"`
	StalePriceInputs bool       `json:"stale_price_inputs"`
	Note             string     `json:"note"`
}

type wireFactorPrice struct {
	Asset              string  `json:"asset"`
	CurrentPrice       string  `json:"current_price"`
	PriceDecimals      uint8   `json:"price_decimals"`
	PriceFloor         *string `json:"price_floor"`
	LowestHealthyPrice *string `json:"lowest_healthy_price"`
}

type wireLiquidationPrice struct {
	InFactor          bool              `json:"in_factor"`
	NeverLiquidatable bool              `json:"never_liquidatable"`
	Reason            string            `json:"reason,omitempty"`
	ScaleFactorNum    *string           `json:"scale_factor_num"`
	ScaleFactorDen    *string           `json:"scale_factor_den"`
	AlreadyBreached   bool              `json:"already_breached"`
	Prices            []wireFactorPrice `json:"prices"`
	FactorAssets      []string          `json:"factor_assets"`
	HeldAssets        []string          `json:"held_assets"`
	BoundaryIsHealthy bool              `json:"boundary_is_healthy"`
	PerTokenFloor     bool              `json:"per_token_floor_omitted"`
	Diagnostic        bool              `json:"diagnostic"`
	Axis              string            `json:"axis"`
	Note              string            `json:"note"`
}

type wirePosition struct {
	Engine        string `json:"engine"`
	Account       string `json:"account"`
	Status        string `json:"status"`
	ValueDecimals int16  `json:"value_decimals"`

	Refusal *wireRefusal `json:"refusal"`
	Flags   []string     `json:"flags"`

	HealthFactor *wireHealthFactor `json:"health_factor"`
	Liquidatable *bool             `json:"liquidatable"`

	TotalCollateralBase *string `json:"total_collateral_base"`
	TotalDebtBase       *string `json:"total_debt_base"`
	WeightedLTSum       *string `json:"weighted_lt_sum"`
	AvgLTBps            *string `json:"avg_lt_bps"`

	CollateralValueUSD *string `json:"collateral_value_usd"`
	MaxBorrowLT        *string `json:"max_borrow_lt"`
	Borrowings         *string `json:"borrowings"`

	Legs             []wireLeg             `json:"legs"`
	PriceInputs      []wirePriceInput      `json:"price_inputs"`
	AsOf             wireAsOf              `json:"as_of"`
	LiquidationPrice *wireLiquidationPrice `json:"liquidation_price"`
}

type addressResponse struct {
	ServedAt  time.Time      `json:"served_at"`
	Batch     wireBatch      `json:"batch"`
	Address   string         `json:"address"`
	Positions []wirePosition `json:"positions"`
	// Found is false when the address carries no position in this batch. It is an
	// explicit field rather than a 404: "this address has no position in the
	// newest batch" is an ANSWER, and it comes with the batch that answered it.
	Found bool     `json:"found"`
	Notes []string `json:"notes"`
}

// parseAddress accepts a 0x-prefixed 20-byte hex address, case-insensitively.
//
// It is STRICT: `common.HexToAddress` silently truncates or zero-pads anything,
// so a typo would resolve to a different (probably empty) account and the answer
// would be a confident "no position" for an address the caller never asked about.
func parseAddress(raw string) (common.Address, error) {
	s := strings.TrimSpace(raw)
	if !strings.HasPrefix(s, "0x") && !strings.HasPrefix(s, "0X") {
		return common.Address{}, errors.New("address must be 0x-prefixed")
	}
	if len(s) != 42 {
		return common.Address{}, errors.New("address must be exactly 20 bytes (42 characters including the 0x prefix)")
	}
	for _, c := range s[2:] {
		if !strings.ContainsRune("0123456789abcdefABCDEF", c) {
			return common.Address{}, errors.New("address contains a non-hexadecimal character")
		}
	}
	return common.HexToAddress(s), nil
}

func (s *server) handleAddress(w http.ResponseWriter, r *http.Request) {
	addr, err := parseAddress(r.PathValue("addr"))
	if err != nil {
		writeError(w, http.StatusBadRequest, codeBadRequest, "invalid address: "+err.Error(), nil)
		return
	}
	v, err := s.readBatch(r.Context(), addr.Bytes())
	if err != nil {
		serveReadError(w, err)
		return
	}

	out := addressResponse{
		ServedAt:  v.Now,
		Batch:     batchEnvelope(v),
		Address:   addr.Hex(),
		Positions: []wirePosition{},
		Found:     len(v.Positions) > 0,
		Notes: []string{
			"Every price disclosure below is the SNAPSHOT the batch persisted — value, decimals, block, as-of, source, provenance, budget and verdict. Nothing here is re-read or re-judged at request time (design spec §7).",
			"`source_as_of` is the chain-asserted as-of (a poll anchor's block timestamp or an AnswerUpdated updatedAt). Database insert time is NEVER substituted for it.",
			"Debt Manager collateral comes from a sweep with a worst case of " + strconv.Itoa(dmSweepIntervalSeconds+dmSweepPassSeconds) + " seconds; its prices are 60-second samples. Read `sweep_block` for the collateral as-of, never the price age.",
			"The two engines are never blended: Aave publishes a continuous health factor, the Debt Manager a strict liquidatable boolean.",
		},
	}
	for _, p := range v.Positions {
		out.Positions = append(out.Positions, s.wirePosition(v, p))
	}
	writeJSON(w, out)
}

func (s *server) wirePosition(v *batchView, p *positionRow) wirePosition {
	out := wirePosition{
		Engine:              p.Engine,
		Account:             common.BytesToAddress(p.Account).Hex(),
		Status:              p.Status,
		ValueDecimals:       p.ValueDecimals,
		Flags:               sanitizeAll(orEmpty(p.Flags)),
		TotalCollateralBase: bigStr(p.TotalCollateralBase),
		TotalDebtBase:       bigStr(p.TotalDebtBase),
		WeightedLTSum:       bigStr(p.WeightedLTSum),
		AvgLTBps:            bigStr(p.AvgLTBps),
		CollateralValueUSD:  bigStr(p.CollateralValueUSD),
		MaxBorrowLT:         bigStr(p.MaxBorrowLT),
		Borrowings:          bigStr(p.Borrowings),
		Liquidatable:        p.Liquidatable,
		Legs:                []wireLeg{},
		PriceInputs:         []wirePriceInput{},
		AsOf: wireAsOf{
			BalancesBlock:    p.BalancesBlock,
			ParamsBlock:      p.ParamsBlock,
			SweepBlock:       p.SweepBlock,
			OldestPriceInput: p.OldestPriceInput,
			StalePriceInputs: p.StalePriceInputs,
			Note: "each leg additionally carries its OWN rate-index as-of block: `rate_indexes` updates only on ReserveDataUpdated and can trail the balances cursor, " +
				"so one balances watermark over an old index would hide the debt leg's true shelf life (design spec §5, Codex round 1 [H5]).",
		},
	}

	switch {
	case p.Status == store.RiskPositionRefused:
		out.Refusal = &wireRefusal{
			Code:   p.RefusalCode,
			Detail: sanitize(p.RefusalDetail),
			Note:   refusalNote(p.RefusalCode),
		}
		if len(p.RefusalAsset) > 0 {
			out.Refusal.Asset = common.BytesToAddress(p.RefusalAsset).Hex()
		}
	case p.reconstructionErr != "":
		// This layer could not rebuild the position. It is served as a refusal
		// naming this service, NOT as a computed row and NOT omitted.
		out.Status = store.RiskPositionRefused
		out.Refusal = &wireRefusal{
			Code:   refusalReconstruction,
			Detail: sanitize(p.reconstructionErr),
			Note: "the batch computed this position; THIS SERVICE could not rebuild it from the batch's persisted rows and reproduce the same verdict. " +
				"The persisted numbers above are still the batch's own; the derived surfaces (stress, waterfall, liquidation price) are withheld for this position.",
		}
	}

	if p.HFInfinite || p.HFWad != nil || p.HFNum != nil {
		hf := &wireHealthFactor{
			Wad:      bigStr(p.HFWad),
			Num:      bigStr(p.HFNum),
			Den:      bigStr(p.HFDen),
			Infinite: p.HFInfinite,
		}
		if p.Engine == risk.AaveEngine {
			hf.Note = "`wad` is the pool's own health factor, a half-up composite over the exact weighted sum. Compare against 1e18 on the WAD; do not re-derive a float from num/den to decide eligibility."
		} else {
			hf.Note = "the Debt Manager has no on-chain health factor: `num/den` is the exact ratio maxBorrowLT/borrowings, a disclosure. The liquidation test is the strict boolean `liquidatable`."
		}
		out.HealthFactor = hf
	}

	for _, l := range p.Legs {
		asset := common.BytesToAddress(l.Asset)
		wl := wireLeg{
			Asset:                 asset.Hex(),
			Decimals:              l.Decimals,
			LiveDebt:              bigStr(l.LiveDebt),
			LiveCollateral:        bigStr(l.LiveCollateral),
			DebtBase:              bigStr(l.DebtBase),
			CollateralBase:        bigStr(l.CollateralBase),
			WeightedLT:            bigStr(l.WeightedLT),
			UsedAsCollateral:      l.UsedAsCollateral,
			DebtIndexBlock:        l.DebtIndexBlock,
			CollateralIndexBlock:  l.CollateralIndexBlock,
			Amount:                bigStr(l.Amount),
			ValueUSD:              bigStr(l.ValueUSD),
			MaxBorrowContribution: bigStr(l.MaxBorrowContribution),
			LiqThreshold:          bigStr(l.LiqThreshold),
			LiqBonus:              bigStr(l.LiqBonus),
		}
		if spec, ok := s.registry.Spec(p.Engine, asset); ok {
			wl.Symbol = spec.Symbol
		}
		out.Legs = append(out.Legs, wl)
	}

	for _, pr := range p.Prices {
		wp := wirePriceInput{
			Asset:         common.BytesToAddress(pr.Asset).Hex(),
			ChainID:       pr.ChainID,
			Source:        sanitize(pr.Source),
			Provenance:    pr.Provenance,
			Value:         bigStr(pr.Value),
			Decimals:      pr.Decimals,
			BlockNumber:   pr.BlockNumber,
			SourceAsOf:    pr.SourceAsOf,
			BudgetSeconds: pr.BudgetSeconds,
			Verdict:       pr.Verdict,
			AgeSeconds:    pr.AgeSeconds,
			Fresh:         pr.Verdict == riskfeed.VerdictFresh,
			Note:          verdictNote(pr.Verdict),
		}
		out.PriceInputs = append(out.PriceInputs, wp)
	}

	if p.input != nil {
		out.LiquidationPrice = s.liquidationPrice(*p.input)
	}
	_ = v
	return out
}

// refusalNote explains a refusal code on the wire, so a client never has to own
// the vocabulary.
func refusalNote(code string) string {
	switch code {
	case riskfeed.GateMissingInput:
		return "G1: no usable price input for the named asset — absent, carrying no chain-asserted as-of, or older than the ceiling (2x the budget). An unpriced asset is REFUSED, never silently dropped."
	case riskfeed.GatePriceReorg:
		return "G2: the price-owning engine on this asset's chain has not acknowledged every reorg epoch, so its rows may describe deleted blocks."
	case riskfeed.GateStoreUnreadable:
		return "G3: the substrate could not be read coherently for this position."
	case riskfeed.GateSweepNever:
		return "SWEEP_NEVER: this account has never had a successful collateral sweep, so its collateral is of UNKNOWN size — not zero. Serving a health factor near zero over it would be a false liquidation alarm."
	case riskfeed.GateEngine:
		return "ENGINE: internal/risk refused the input; the detail names the asset and the reason verbatim."
	case riskfeed.GateFlagCustodyUnproven:
		return "FLAG_CUSTODY_UNPROVEN: the Aave engine's derived state cannot be shown to have been walked from its start block under a decode registry that includes the collateral-flag events, so reading flag ABSENCE as chain truth is not licensed. This refusal is WHOLE-ENGINE by design; the other engine serves normally."
	case refusalReconstruction:
		return "API_RECONSTRUCTION_MISMATCH: this service could not rebuild the position from the batch's persisted rows and reproduce the batch's own verdict. Derived surfaces are withheld for it."
	default:
		return "refused: see `detail`."
	}
}

func verdictNote(verdict string) string {
	switch verdict {
	case riskfeed.VerdictFresh:
		return "within this input's own budget at compute time."
	case riskfeed.VerdictStale:
		return "older than its budget but within the ceiling: COMPUTED AND FLAGGED (G4), and the flag propagates into every aggregate containing it."
	case riskfeed.VerdictOverCeiling:
		return "older than the ceiling (2x the budget): REFUSED (G1) rather than served."
	case riskfeed.VerdictMissing:
		return "no usable row at all: REFUSED (G1). The asset is named on the position that refused because of it."
	case riskfeed.VerdictNoAsOf:
		return "the row carries no chain-asserted as-of. Database insert time is never substituted, so there is no age to judge and the input is REFUSED (G1)."
	case riskfeed.VerdictReorgUnacked:
		return "the price-owning engine has an unacknowledged reorg epoch on this chain: REFUSED (G2)."
	default:
		return ""
	}
}

// liquidationPrice runs the factor-level closed-form solve over the waterfall
// axis's factor membership.
//
// The FACTOR is the scenario's propagation matrix, not a guess: an ETH shock
// moves every ETH-composed asset jointly, and solving one asset at a time while
// holding its siblings is the ceteris-paribus DIAGNOSTIC that design spec §6
// demotes. The library flags that case itself (`Disclosures.Diagnostic`).
func (s *server) liquidationPrice(pos risk.PositionInput) *wireLiquidationPrice {
	if len(s.waterfallScenario.Shocks) != 1 {
		return nil
	}
	sh := s.waterfallScenario.Shocks[0]
	axis := risk.AxisRef{Axis: sh.Axis, Asset: sh.Asset}
	var factor []common.Address
	for _, r := range s.waterfallScenario.Propagation {
		for _, a := range r.RespondsTo {
			if a.Axis == axis.Axis && strings.EqualFold(a.Asset, axis.Asset) {
				factor = append(factor, common.HexToAddress(r.Asset))
				break
			}
		}
	}
	lp, _, err := risk.ComputeLiquidationPrice(pos, factor)
	if err != nil {
		return &wireLiquidationPrice{
			Axis:   axis.String(),
			Reason: sanitize(err.Error()),
			Note:   "the solve refused this position; see `reason`.",
		}
	}
	out := &wireLiquidationPrice{
		InFactor:          lp.InFactor,
		NeverLiquidatable: lp.NeverLiquidatable,
		Reason:            sanitize(lp.Reason),
		AlreadyBreached:   lp.AlreadyBreached,
		Prices:            []wireFactorPrice{},
		FactorAssets:      hexes(lp.Disclosures.FactorAssets),
		HeldAssets:        hexes(lp.Disclosures.HeldAssets),
		BoundaryIsHealthy: lp.Disclosures.BoundaryIsHealthy,
		PerTokenFloor:     lp.Disclosures.PerTokenFloorOmitted,
		Diagnostic:        lp.Disclosures.Diagnostic,
		Axis:              axis.String(),
		Note: "at exactly this price the position is HEALTHY on both engines — liquidation begins strictly below it. " +
			"`lowest_healthy_price` is ceil(P*) and is the conservative number to render; never render 'liquidates at' this price.",
	}
	if lp.ScaleFactor.Valid() && !lp.ScaleFactor.Infinite {
		out.ScaleFactorNum = bigStr(lp.ScaleFactor.Num)
		out.ScaleFactorDen = bigStr(lp.ScaleFactor.Den)
	}
	for _, fp := range lp.Prices {
		out.Prices = append(out.Prices, wireFactorPrice{
			Asset:              fp.Asset.Hex(),
			CurrentPrice:       orZeroString(fp.CurrentPrice),
			PriceDecimals:      fp.PriceDecimals,
			PriceFloor:         bigStr(fp.PriceFloor),
			LowestHealthyPrice: bigStr(fp.LowestHealthyPrice),
		})
	}
	return out
}

func hexes(in []common.Address) []string {
	out := make([]string, 0, len(in))
	for _, a := range in {
		out = append(out, a.Hex())
	}
	return out
}

// ---------------------------------------------------------------------------
// /v1/address/{addr}/stress
// ---------------------------------------------------------------------------

type wireAppliedShock struct {
	Asset       string `json:"asset"`
	ChainID     uint64 `json:"chain_id"`
	Source      string `json:"source"`
	FactorNum   string `json:"factor_num"`
	FactorDen   string `json:"factor_den"`
	Before      string `json:"before"`
	After       string `json:"after"`
	Snapped     bool   `json:"snapped"`
	BaseSnapped bool   `json:"base_snapped"`
	CapBound    bool   `json:"cap_bound"`
}

type wireStressState struct {
	HealthFactorWad *string `json:"health_factor_wad"`
	HealthFactorNum *string `json:"health_factor_num"`
	HealthFactorDen *string `json:"health_factor_den"`
	Infinite        bool    `json:"infinite"`
	Liquidatable    *bool   `json:"liquidatable"`
	Eligible        bool    `json:"eligible"`
	CollateralUSD   *string `json:"collateral_usd"`
	DebtUSD         *string `json:"debt_usd"`
	MaxBorrowLT     *string `json:"max_borrow_lt"`
}

type wireShortfall struct {
	HFsUnchanged            bool   `json:"hfs_unchanged"`
	ExecutionShortfallUSD   string `json:"execution_shortfall_usd"`
	BadDebtAtLiquidationUSD string `json:"bad_debt_at_liquidation_usd"`
	UsdDecimals             uint8  `json:"usd_decimals"`
	SeizureModel            string `json:"seizure_model"`
	Note                    string `json:"note"`
}

type wireProjectionHorizon struct {
	HorizonSeconds        int64  `json:"horizon_seconds"`
	DebtUSD               string `json:"debt_usd"`
	ProjectedUSD          string `json:"projected_usd"`
	AdditionalInterestUSD string `json:"additional_interest_usd"`
	BecomesLiquidatable   *bool  `json:"becomes_liquidatable"`
}

type wireProjection struct {
	Label          string                  `json:"label"`
	Basis          string                  `json:"basis"`
	AnnualDeltaBps int64                   `json:"annual_delta_bps"`
	APYObservedAt  uint64                  `json:"apy_observed_at_block"`
	PricesHeldFlat bool                    `json:"prices_held_flat"`
	Horizons       []wireProjectionHorizon `json:"horizons"`
	Note           string                  `json:"note"`
}

type wireScenarioResult struct {
	Engine     string `json:"engine"`
	Account    string `json:"account"`
	Applicable bool   `json:"applicable"`
	// Reason is why a result is absent: the scenario does not cover this engine,
	// the position refused in the batch, or this layer could not rebuild it.
	Reason string `json:"reason,omitempty"`

	Before *wireStressState `json:"before"`
	After  *wireStressState `json:"after"`

	AppliedShocks []wireAppliedShock `json:"applied_shocks"`
	HeldFlat      []wireHeldFlat     `json:"held_flat"`

	Shortfall  *wireShortfall  `json:"market_realization"`
	Projection *wireProjection `json:"projection"`
}

type wireScenario struct {
	ID             string               `json:"id"`
	Version        string               `json:"version"`
	Label          string               `json:"label"`
	Description    string               `json:"description"`
	PathAssumption string               `json:"path_assumption"`
	Engines        []string             `json:"engines"`
	Shocks         []wireShock          `json:"shocks"`
	OutOfModel     []string             `json:"out_of_model"`
	Results        []wireScenarioResult `json:"results"`
}

type wireShock struct {
	Axis      string `json:"axis"`
	Asset     string `json:"asset,omitempty"`
	FactorNum int64  `json:"factor_num"`
	FactorDen int64  `json:"factor_den"`
}

type stressResponse struct {
	ServedAt              time.Time      `json:"served_at"`
	Batch                 wireBatch      `json:"batch"`
	Address               string         `json:"address"`
	ScenarioConfigVersion string         `json:"scenario_config_version"`
	Found                 bool           `json:"found"`
	Scenarios             []wireScenario `json:"scenarios"`
	Notes                 []string       `json:"notes"`
}

func (s *server) handleStress(w http.ResponseWriter, r *http.Request) {
	addr, err := parseAddress(r.PathValue("addr"))
	if err != nil {
		writeError(w, http.StatusBadRequest, codeBadRequest, "invalid address: "+err.Error(), nil)
		return
	}
	v, err := s.readBatch(r.Context(), addr.Bytes())
	if err != nil {
		serveReadError(w, err)
		return
	}

	out := stressResponse{
		ServedAt:              v.Now,
		Batch:                 batchEnvelope(v),
		Address:               addr.Hex(),
		ScenarioConfigVersion: s.scenarioConfigVersion(),
		Found:                 len(v.Positions) > 0,
		Scenarios:             []wireScenario{},
		Notes: []string{
			"Every scenario is a shock to PRIMITIVE AXES propagated through each engine's ACTUAL pricing transforms — the Debt Manager's stable snap band, composed-asset bases. Stored rows are never linearly scaled and derived USD feeds are never shocked independently.",
			"`held_flat` names every price input no propagation row described. An empty list is the claim that the matrix covered this position; a non-empty one is the disclosure that it did not.",
			"Cap-adapter ceilings are NOT carried on a persisted price snapshot, so an UPWARD shock cannot be cap-bound here. Every committed scenario is a down-shock, a rate axis or a market-realization axis, so no served number depends on a cap that was not checked.",
			"A market depeg with oracles held is NOT a health-factor event by oracle construction. Its result asserts the health factors are bit-identical and reports the execution shortfall and bad-debt-at-liquidation instead.",
			"Scenario results are computed from THIS BATCH's persisted rows, so they describe the same materialization as /v1/book and /v1/address — not a fresher read.",
		},
	}

	for _, sc := range s.scenarios {
		ws := wireScenario{
			ID:             sc.ID,
			Version:        sc.Version,
			Label:          sc.Label,
			Description:    sc.Description,
			PathAssumption: sc.PathAssumption,
			Engines:        orEmpty(sc.Engines),
			OutOfModel:     orEmpty(sc.OutOfModel),
			Shocks:         []wireShock{},
			Results:        []wireScenarioResult{},
		}
		for _, sh := range sc.Shocks {
			ws.Shocks = append(ws.Shocks, wireShock{
				Axis: string(sh.Axis), Asset: sh.Asset,
				FactorNum: sh.FactorNum, FactorDen: sh.FactorDen,
			})
		}
		for _, p := range v.Positions {
			ws.Results = append(ws.Results, s.stressOne(sc, p))
		}
		out.Scenarios = append(out.Scenarios, ws)
	}
	writeJSON(w, out)
}

// stressOne evaluates one scenario against one position.
func (s *server) stressOne(sc risk.Scenario, p *positionRow) wireScenarioResult {
	res := wireScenarioResult{
		Engine:        p.Engine,
		Account:       common.BytesToAddress(p.Account).Hex(),
		AppliedShocks: []wireAppliedShock{},
		HeldFlat:      []wireHeldFlat{},
	}
	if !covers(sc.Engines, p.Engine) {
		res.Reason = "scenario " + sc.ID + " is not defined for engine " + p.Engine
		return res
	}
	switch {
	case p.Status == store.RiskPositionRefused:
		res.Reason = "the batch REFUSED this position (" + p.RefusalCode + "): " + sanitize(p.RefusalDetail) +
			" — a stress number over an input the engine refused would be a number nobody computed."
		return res
	case p.input == nil:
		res.Reason = refusalReconstruction + ": " + sanitize(p.reconstructionErr)
		return res
	}
	res.Applicable = true
	res.Before = stateFromPersisted(p)

	// The rate axis is a PROJECTION over time, not a spot mark.
	if sc.Projection != nil {
		res.Projection = s.project(sc, p)
		if res.Projection == nil {
			res.Applicable = false
			res.Reason = "this scenario's projection is not servable for this engine"
		}
		return res
	}

	shocked, err := risk.ApplyScenario(*p.input, sc)
	if err != nil {
		res.Applicable = false
		res.Reason = "applying scenario " + sc.ID + " refused this position: " + sanitize(err.Error())
		return res
	}
	if shocked.Scenario != nil {
		for _, a := range shocked.Scenario.Applied {
			res.AppliedShocks = append(res.AppliedShocks, wireAppliedShock{
				Asset: a.Asset.Hex(), ChainID: a.ChainID, Source: sanitize(a.Source),
				FactorNum: orZeroString(a.FactorNum), FactorDen: orZeroString(a.FactorDen),
				Before: orZeroString(a.Before), After: orZeroString(a.After),
				Snapped: a.Snapped, BaseSnapped: a.BaseSnapped, CapBound: a.CapBound,
			})
		}
		for _, h := range shocked.Scenario.HeldFlat {
			res.HeldFlat = append(res.HeldFlat, wireHeldFlat{
				Asset: h.Asset.Hex(), ChainID: h.ChainID, Source: sanitize(h.Source), Value: orZeroString(h.Value),
			})
		}
	}

	after, err := stateFromRecompute(shocked)
	if err != nil {
		res.Applicable = false
		res.Reason = "recomputing the shocked position refused: " + sanitize(err.Error())
		return res
	}
	res.After = after

	// The market-realization axis: oracles held, so the health factors must be
	// bit-identical and the output is a shortfall, never a health-factor move.
	if len(sc.MarketRealizations) > 0 {
		sf, err := risk.ExecutionShortfall([]risk.PositionInput{*p.input}, sc.MarketRealizationsFor())
		if err != nil {
			res.Reason = "execution shortfall refused: " + sanitize(err.Error())
			return res
		}
		e := sf.PerEngine[p.Engine]
		res.Shortfall = &wireShortfall{
			HFsUnchanged:            sf.HFsUnchanged,
			ExecutionShortfallUSD:   orZeroString(sf.ExecutionShortfallUSD),
			BadDebtAtLiquidationUSD: orZeroString(sf.BadDebtAtLiquidationUSD),
			UsdDecimals:             e.UsdDecimals,
			SeizureModel:            sf.SeizureModel,
			Note: "market value is NOT an oracle mark: neither protocol reads a secondary-market price, so this scenario moves NO health factor (`hfs_unchanged` asserts it). " +
				"The numbers are the gap the protocol is not seeing — liquidation-execution shortfall and bad-debt-at-liquidation under the disclosed seizure model.",
		}
	}
	return res
}

// project serves the Debt Manager's rate-horizon axis.
//
// # DELTA-ONLY, and why that is the honest form here
//
// `ProjectDMDebt` needs the borrow APY the debt is accruing at. A risk batch does
// not carry one: the admin-set APY is not among the persisted inputs, and this
// binary may not read the chain to get it. Two dishonest options were available —
// fabricate a base APY, or omit the scenario silently. Neither is taken.
//
// What IS computed is the +200bps DELTA's own contribution: the additional
// interest the rate change adds over each horizon, which is exactly
// `ProjectDMDebt` with the delta as the rate. It is labeled `delta-only` and no
// time-to-liquidatable is published from it, because omitting the base accrual
// makes debt grow SLOWER than it really will, so any time derived from this path
// would be optimistic — and an optimistic time-to-liquidation is the one number a
// risk surface must never guess at.
func (s *server) project(sc risk.Scenario, p *positionRow) *wireProjection {
	if p.Engine != risk.DMEngine || p.input == nil || p.input.DM == nil || sc.Projection == nil {
		return nil
	}
	delta, ok := new(big.Int).SetString(sc.Projection.APYDeltaPerSecond100e18, 10)
	if !ok {
		return nil
	}
	out := &wireProjection{
		Label:          "PROJECTION",
		Basis:          "delta-only",
		AnnualDeltaBps: sc.Projection.AnnualDeltaBps,
		APYObservedAt:  p.BalancesBlock,
		PricesHeldFlat: true,
		Horizons:       []wireProjectionHorizon{},
		Note: "DELTA-ONLY: this is the additional interest the +" + strconv.FormatInt(sc.Projection.AnnualDeltaBps, 10) +
			"bps adds, NOT the total debt path. A risk batch carries no borrow-APY observation and this service makes no chain calls, so the base accrual is absent. " +
			"No time-to-liquidatable is published from this path: without the base rate the debt grows slower than it will, which would make any such time optimistic. " +
			sanitize(sc.Projection.Note),
	}
	for _, horizon := range sc.Projection.HorizonsSeconds {
		pr, err := risk.ProjectDMDebt(*p.input.DM, delta, p.BalancesBlock, horizon)
		if err != nil {
			continue
		}
		h := wireProjectionHorizon{
			HorizonSeconds:        horizon,
			DebtUSD:               orZeroString(pr.DebtUSD),
			ProjectedUSD:          orZeroString(pr.ProjectedUSD),
			AdditionalInterestUSD: orZeroString(pr.InterestUSD),
		}
		if p.MaxBorrowLT != nil && pr.ProjectedUSD != nil {
			// STRICT, like the engine: `debt > maxBorrowLT`.
			b := pr.ProjectedUSD.Cmp(p.MaxBorrowLT) > 0
			h.BecomesLiquidatable = &b
		}
		out.Horizons = append(out.Horizons, h)
	}
	return out
}

// stateFromPersisted is the BEFORE state: the batch's own published numbers,
// read off the row rather than recomputed. It has to be the row — a recomputed
// "before" that differed from the published one would be a second answer.
func stateFromPersisted(p *positionRow) *wireStressState {
	out := &wireStressState{
		HealthFactorWad: bigStr(p.HFWad),
		HealthFactorNum: bigStr(p.HFNum),
		HealthFactorDen: bigStr(p.HFDen),
		Infinite:        p.HFInfinite,
		Liquidatable:    p.Liquidatable,
	}
	switch p.Engine {
	case risk.AaveEngine:
		out.CollateralUSD = bigStr(p.TotalCollateralBase)
		out.DebtUSD = bigStr(p.TotalDebtBase)
		out.Eligible = p.HFWad != nil && !p.HFInfinite && p.HFWad.Cmp(risk.WadUnit()) < 0
	default:
		out.CollateralUSD = bigStr(p.CollateralValueUSD)
		out.DebtUSD = bigStr(p.Borrowings)
		out.MaxBorrowLT = bigStr(p.MaxBorrowLT)
		out.Eligible = p.Liquidatable != nil && *p.Liquidatable
	}
	return out
}

// stateFromRecompute is the AFTER state, from the pure library over the shocked
// input.
func stateFromRecompute(pos risk.PositionInput) (*wireStressState, error) {
	switch pos.Engine {
	case risk.AaveEngine:
		h, err := risk.ComputeAaveHealth(*pos.Aave)
		if err != nil {
			return nil, err
		}
		out := &wireStressState{
			HealthFactorWad: bigStr(h.HealthFactorWad),
			Infinite:        h.IsInfinite,
			CollateralUSD:   bigStr(h.TotalCollateralBase),
			DebtUSD:         bigStr(h.TotalDebtBase),
			Eligible:        !h.IsInfinite && h.HealthFactorWad != nil && h.HealthFactorWad.Cmp(risk.WadUnit()) < 0,
		}
		if h.HealthFactor.Valid() && !h.HealthFactor.Infinite {
			out.HealthFactorNum = bigStr(h.HealthFactor.Num)
			out.HealthFactorDen = bigStr(h.HealthFactor.Den)
		}
		return out, nil
	default:
		h, err := risk.ComputeDMHealth(*pos.DM)
		if err != nil {
			return nil, err
		}
		liq := h.Liquidatable
		out := &wireStressState{
			Infinite:      h.IsInfinite,
			Liquidatable:  &liq,
			Eligible:      h.Liquidatable,
			CollateralUSD: bigStr(h.CollateralValueUSD),
			DebtUSD:       bigStr(h.Borrowings),
			MaxBorrowLT:   bigStr(h.MaxBorrowLT),
		}
		if h.HealthFactor.Valid() && !h.HealthFactor.Infinite {
			out.HealthFactorNum = bigStr(h.HealthFactor.Num)
			out.HealthFactorDen = bigStr(h.HealthFactor.Den)
		}
		return out, nil
	}
}

func covers(engines []string, engine string) bool {
	for _, e := range engines {
		if e == engine {
			return true
		}
	}
	return false
}

// ---------------------------------------------------------------------------
// /v1/observatory
// ---------------------------------------------------------------------------

type wireObservatoryPoint struct {
	BatchID    int64           `json:"batch_id"`
	ComputedAt time.Time       `json:"computed_at"`
	AgeSeconds int64           `json:"age_seconds"`
	Engines    []wireAggregate `json:"engines"`
}

type wireRateIndex struct {
	Engine string `json:"engine"`
	Asset  string `json:"asset"`
	Symbol string `json:"symbol,omitempty"`
	Kind   string `json:"kind"`
	Value  string `json:"value"`
	// AsOfBlock is the index's OWN as-of. It can trail the derive cursor badly.
	AsOfBlock uint64 `json:"as_of_block"`
	Note      string `json:"note"`
}

type observatoryResponse struct {
	ServedAt    time.Time              `json:"served_at"`
	Limit       int                    `json:"limit"`
	Series      []wireObservatoryPoint `json:"series"`
	RateIndexes []wireRateIndex        `json:"rate_indexes"`
	Notes       []string               `json:"notes"`
}

func (s *server) handleObservatory(w http.ResponseWriter, r *http.Request) {
	limit := s.cfg.ObservatoryLimit
	if raw := r.URL.Query().Get("limit"); raw != "" {
		n, err := strconv.Atoi(raw)
		if err != nil || n <= 0 || n > maxObservatoryLimit {
			writeError(w, http.StatusBadRequest, codeBadRequest,
				"limit must be an integer in 1.."+strconv.Itoa(maxObservatoryLimit), nil)
			return
		}
		limit = n
	}

	now, series, indexes, err := s.readObservatory(r.Context(), limit)
	if err != nil {
		writeError(w, http.StatusInternalServerError, codeInternal, err.Error(), nil)
		return
	}

	out := observatoryResponse{
		ServedAt:    now,
		Limit:       limit,
		Series:      []wireObservatoryPoint{},
		RateIndexes: []wireRateIndex{},
		Notes: []string{
			"The series is the newest servable batches, newest first. Torn batches are excluded by the same completeness discipline the serving path applies, so the series never dips and recovers for a reason that is not on the chain.",
			"Per-engine totals are in each engine's own unit and are never summed across engines.",
			"A batch is a MATERIALIZER PASS, not a block: the cadence is riskd's, and the interval between two points is not a block interval.",
		},
	}
	for _, pt := range series {
		p := wireObservatoryPoint{
			BatchID:    pt.BatchID,
			ComputedAt: pt.ComputedAt,
			AgeSeconds: ageSeconds(now, pt.ComputedAt),
			Engines:    []wireAggregate{},
		}
		for _, a := range pt.Aggregates {
			p.Engines = append(p.Engines, wireAggregate{
				Engine:                a.Engine,
				ValueDecimals:         a.ValueDecimals,
				Positions:             a.Positions,
				ComputedPositions:     a.ComputedPositions,
				RefusedPositions:      a.RefusedPositions,
				FlaggedPositions:      a.FlaggedPositions,
				LiquidatablePositions: a.LiquidatablePositions,
				TotalCollateral:       orZeroString(a.TotalCollateral),
				TotalDebt:             orZeroString(a.TotalDebt),
				Refusals:              []wireCount{},
				Flags:                 []wireCount{},
				UnitNote: "values are integers at " + strconv.Itoa(int(a.ValueDecimals)) +
					" decimals in this engine's own unit",
			})
		}
		out.Series = append(out.Series, p)
	}
	for _, ix := range indexes {
		asset := common.BytesToAddress(ix.Asset)
		ri := wireRateIndex{
			Engine:    ix.Engine,
			Asset:     asset.Hex(),
			Kind:      ix.Kind,
			Value:     orZeroString(ix.Value),
			AsOfBlock: ix.Block,
			Note:      "as-of-last-ReserveDataUpdated: this index can trail the derive cursor. `as_of_block` is its OWN as-of and is the only honest freshness statement about it.",
		}
		if spec, ok := s.registry.Spec(ix.Engine, asset); ok {
			ri.Symbol = spec.Symbol
		}
		out.RateIndexes = append(out.RateIndexes, ri)
	}
	writeJSON(w, out)
}

// ---------------------------------------------------------------------------
// Small helpers.
// ---------------------------------------------------------------------------

// bigStr renders an optionally-absent integer as a decimal STRING, or null.
//
// Never a JSON number: a 78-digit integer does not survive an IEEE-754 double,
// and a risk number that silently loses its low digits in a browser is a wrong
// number with a plausible shape.
func bigStr(v *big.Int) *string {
	if v == nil {
		return nil
	}
	s := v.String()
	return &s
}

// orEmpty makes a nil slice serialize as `[]` rather than `null`. An absent list
// and an empty list are the same statement here, and `[]` is the one a client can
// iterate without a nil check.
func orEmpty(in []string) []string {
	if in == nil {
		return []string{}
	}
	return in
}
