package main

// POST /v1/scenarios/{id}/run-book — one COMMITTED scenario evaluated against
// the WHOLE book of the newest servable batch, reduced to per-engine
// aggregates.
//
// POST because the evaluation is computed on request over the whole book; it
// WRITES NOTHING (TestAPIIssuesNoWritingSQL still holds over this package).
// The scenario id must name a committed scenario: anything else is a 404,
// never a silently empty run.
//
// # The arithmetic is the reviewed arithmetic
//
// Eligibility, collateral-at-risk and bad-debt measures are NOT re-implemented
// here: both sides of the shock are measured by `risk.Waterfall` evaluated at
// the single unshocked grid point (factor 1.0 — the identity shock), which is
// byte-for-byte the same measure the public /v1/book waterfall serves at its
// first point. The BEFORE side measures the reconstructed book as persisted;
// the AFTER side measures the book with the scenario's shocks applied through
// `risk.ApplyScenario` — each engine's ACTUAL pricing transforms, the stable
// snap band included. Deltas are labeled DELTA-ONLY: after minus before, the
// scenario's own contribution over the positions in the run.
//
// # Absences are named
//
// Engines whose whole book is withheld are in `excluded_engines` and appear
// nowhere else. Positions this layer could not rebuild are in
// `coverage.excluded`. Engines the scenario does not cover are named in
// `notes`. An absence with no name is exactly the silent hole this surface
// must not have.

import (
	"fmt"
	"math/big"
	"net/http"
	"regexp"
	"sort"
	"strconv"
	"time"

	"github.com/ethereum/go-ethereum/common"
	"github.com/kaselunt/solvent/internal/risk"
)

// runPos is one position in the run: its persisted row and its verified
// reconstructed input.
type runPos struct {
	row   *positionRow
	input risk.PositionInput
}

type wireRunBookAggregate struct {
	Accounts            int    `json:"accounts"`
	EligibleAccounts    int    `json:"eligible_accounts"`
	TotalCollateralUSD  string `json:"total_collateral_usd"`
	TotalDebtUSD        string `json:"total_debt_usd"`
	EligibleDebtUSD     string `json:"eligible_debt_usd"`
	CollateralAtRiskUSD string `json:"collateral_at_risk_usd"`
	BadDebtUSD          string `json:"bad_debt_usd"`
	// HFHistogram is THIS side of the shock's health-factor distribution, on
	// this engine's own comparator and in the SAME buckets /v1/book serves
	// (bucketIndexOf is the single law). The after-side's is over the SHOCKED
	// states — that is the whole point of carrying one per side.
	HFHistogram wireRunBookHistogram `json:"hf_histogram"`
	// CollateralByAsset itemizes the collateral behind TotalCollateralUSD. It is
	// per aggregate, never summed across engines, and it differs between the two
	// sides under an asset shock.
	CollateralByAsset []wireRunBookCollateralAsset `json:"collateral_by_asset"`
}

// wireRunBookHistogram is one engine's one-side distribution. It is the
// EngineHistogram shape minus the engine-withholding fields: a withheld engine
// contributes no run-book row at all (it is in `excluded_engines`), so a
// refused/refusal pair here could only ever be false/null and would read as a
// promise this surface does not make.
type wireRunBookHistogram struct {
	Comparator string `json:"comparator"`
	// WadScale is repeated here rather than assumed: these buckets are read
	// without /v1/book's envelope in scope.
	WadScale string                `json:"wad_scale"`
	Buckets  []wireHistogramBucket `json:"buckets"`
	// InfiniteCount is accounts with NO DEBT: the health factor is
	// undefined-because-unbounded, never a large number and never a bucket.
	InfiniteCount int `json:"infinite_count"`
	// RefusedCount is positions on this engine that carry no comparator on this
	// side — counted here so an aggregate histogram can never be read as a
	// complete census while rows are silently missing from it.
	RefusedCount int    `json:"refused_count"`
	Note         string `json:"note"`
}

// wireRunBookCollateralAsset is one asset's contribution to ONE side's counted
// collateral, in the same register as the address surface's `Leg`: `amount` is
// the balance in base units, `value_usd` is the value the ENGINE COUNTED, and
// the two are not the same claim.
type wireRunBookCollateralAsset struct {
	Asset string `json:"asset"`
	// Symbol is served only when the custodied registry holds one — never
	// invented, exactly as every other symbol-bearing surface here.
	Symbol   string `json:"symbol,omitempty"`
	Decimals uint8  `json:"decimals"`
	Amount   string `json:"amount"`
	// ValueUSD is the summed value this engine COUNTED for the asset, at the
	// engine's usd_decimals. NULL — never "0" — when the engine counted no
	// value for it on this side: a balance whose worth is unknowable and a
	// balance worth nothing are different facts.
	ValueUSD *string `json:"value_usd"`
	// Unpriced is true when at least one holding of this asset carried NO price
	// witness, so `amount` includes tokens whose USD value is UNKNOWABLE and is
	// therefore NOT inside total_collateral_usd.
	Unpriced bool   `json:"unpriced"`
	Note     string `json:"note"`
}

// wireRunBookMover is one account this scenario MOVED, with the evidence in the
// engine's OWN vocabulary. Every per-engine field is present on every mover and
// NULL on the engine that does not speak it — an absent number is never a zero.
type wireRunBookMover struct {
	Account string `json:"account"`
	Engine  string `json:"engine"`

	// Aave: the pool's own health-factor WADs, and the DROP that ranks this row.
	HFBeforeWad *string `json:"hf_before_wad"`
	HFAfterWad  *string `json:"hf_after_wad"`
	HFDropWad   *string `json:"hf_drop_wad"`

	// Debt Manager: the exact rational maxBorrowLT/borrowings on each side —
	// the same disclosure its histogram buckets on. There is no wad to report.
	HFBeforeNum *string `json:"hf_before_num"`
	HFBeforeDen *string `json:"hf_before_den"`
	HFAfterNum  *string `json:"hf_after_num"`
	HFAfterDen  *string `json:"hf_after_den"`

	// BecameEligible is the Debt Manager's eligibility FLIP (false -> true) that
	// makes this row a mover; DebtUSD is the debt that became eligible, at the
	// engine's usd_decimals.
	BecameEligible *bool   `json:"became_eligible"`
	DebtUSD        *string `json:"debt_usd"`
}

// The lane `kind` vocabulary. It is closed: lanes 0..N-1 ARE the histogram's
// buckets, and the only two others are the two tallies that sit beside those
// buckets on every histogram this service serves.
const (
	laneKindBucket     = "bucket"
	laneKindInfinite   = "infinite"
	laneKindUnmeasured = "unmeasured"
)

// wireRunBookTransitionLane is one lane of the transition matrix. Lanes 0..N-1
// are the SAME buckets `hf_histogram` serves — same order, same labels, same
// edges, placed by the same law — and the two after them are `infinite_count`'s
// and `refused_count`'s populations. There is no lane a histogram does not have
// and no histogram tally without a lane.
type wireRunBookTransitionLane struct {
	Index int    `json:"index"`
	Kind  string `json:"kind"`
	Label string `json:"label"`
	// LowerWad/UpperWad are null on the open-ended top bucket AND on both
	// non-bucket lanes, which have no edges at all: an unbounded health factor is
	// not a large number, and a row nobody measured has no health factor to bound.
	LowerWad *string `json:"lower_wad"`
	UpperWad *string `json:"upper_wad"`
}

// wireRunBookTransitionCell is one OCCUPIED cell: the position rows whose BEFORE
// lane is the enclosing outflow's `from` and whose AFTER lane is `to`. A cell is
// emitted only when it holds at least one row.
type wireRunBookTransitionCell struct {
	To int `json:"to"`
	// Rows is a COUNT of position rows, like every other field on this surface
	// whose name ends in `rows`. An empty cell is ABSENT, never a row of zeros.
	Rows int `json:"rows"`
	// DebtBeforeUSD is the exact sum of BEFORE-side debt over the rows in this
	// cell THAT THIS RUN MEASURED, at this engine's usd_decimals, never summed
	// with another engine's. NULL — never "0" — when this run measured none of
	// this cell's rows: a debt nobody computed and a debt of zero are different
	// facts. A no-debt row contributes an exact "0", because that zero IS
	// knowable.
	DebtBeforeUSD *string `json:"debt_before_usd"`
	// DebtAfterUSD is the same sum on the AFTER side, derived the same way and
	// SEPARATELY, because Aave's debt is a PRICED sum: a shock that moves the
	// price of an asset a row BORROWS moves it. One figure per cell could
	// conserve on at most one margin.
	DebtAfterUSD *string `json:"debt_after_usd"`
}

// wireRunBookTransitionOutflow is one BEFORE lane's outflow: where that lane's
// rows went. Every lane gets an entry, including empty ones, so the shape is
// stable; this lane's whole BEFORE population is `from_rows[from]` and is not
// repeated here.
type wireRunBookTransitionOutflow struct {
	From  int                         `json:"from"`
	Cells []wireRunBookTransitionCell `json:"cells"`
}

// wireRunBookTransitions is the BEFORE-to-AFTER flow of one engine's POSITION
// ROWS: a joint distribution over the SAME lanes the two hf_histograms beside it
// are stated in.
//
// THE TWO HISTOGRAMS CANNOT PRODUCE THIS. Two marginals do not determine a
// joint: a row that fell below 1.00 and another that rose above it cancel
// exactly in a marginal difference, and no client-side arithmetic separates
// them. `movers` cannot either — it is capped, and it is ranked by drop
// magnitude or by an eligibility flip rather than by lane change. So the joint
// is computed HERE, in the one place that holds both sides of the same row.
//
// EVERY FIELD WHOSE NAME ENDS IN `rows` IS A COUNT of position rows on this
// engine, or an array of such counts, in the same unit `coverage.batch_positions`
// uses — never a count of distinct addresses. Arrays of OBJECTS are named for
// their elements: `lanes`, `outflows`, `cells`.
type wireRunBookTransitions struct {
	Comparator string                         `json:"comparator"`
	WadScale   string                         `json:"wad_scale"`
	Lanes      []wireRunBookTransitionLane    `json:"lanes"`
	Outflows   []wireRunBookTransitionOutflow `json:"outflows"`
	// FromRows is THE ROW MARGIN: each lane's whole BEFORE population, in lane
	// order. It EQUALS the corresponding tally on before.hf_histogram and equals
	// the sum of outflows[i].cells[].rows.
	FromRows []int `json:"from_rows"`
	// ToRows is THE COLUMN MARGIN, stated the same way against after.hf_histogram.
	// Both margins are served densely so the sparse cells lose nothing: an absent
	// cell is a KNOWABLE zero, and these dense margins are what make it knowable.
	ToRows []int `json:"to_rows"`
	// TotalRows is every position row of THIS ENGINE this run touched. It is a
	// PER-ENGINE total and it reconciles against nothing else: not
	// coverage.batch_positions, and summing it across engines does not produce
	// coverage.in_book.
	TotalRows int `json:"total_rows"`
	// MeasuredRows is the rows this run measured on both sides. It equals
	// before.accounts and after.accounts, and it is the denominator every
	// movement statement on this surface is made against.
	MeasuredRows int `json:"measured_rows"`
	// UnmeasuredRows is the rows of this engine that reached NO arithmetic in
	// this run. They sit in exactly one cell (lane N+1 to lane N+1).
	UnmeasuredRows int `json:"unmeasured_rows"`
	// UnmeasuredRefusedInBatchRows is the part of UnmeasuredRows that RISKD
	// refused. Every one is inside coverage.refused_in_batch and is served per
	// row by /v1/positions and /v1/address/{addr}. They are NOT in
	// coverage.excluded.
	UnmeasuredRefusedInBatchRows int `json:"unmeasured_refused_in_batch_rows"`
	// UnmeasuredExcludedByThisLayerRows is the part riskd COMPUTED and THIS
	// SERVICE could not rebuild or verify. Every one is listed in
	// coverage.excluded and counted in coverage.excluded_by_this_layer.
	UnmeasuredExcludedByThisLayerRows int `json:"unmeasured_excluded_by_this_layer_rows"`
	// HeldRows is MEASURED rows whose lane did not change. NULL — never 0 — when
	// MeasuredRows is 0, because "0 rows held" over a book this run never
	// measured would claim a measurement nobody made.
	HeldRows *int `json:"held_rows"`
	// LaneChangedRows is MEASURED rows whose LANE changed: the gross count the
	// two histograms structurally could not give. NULL under the same condition.
	LaneChangedRows *int   `json:"lane_changed_rows"`
	Note            string `json:"note"`
}

type wireRunBookEngine struct {
	Engine      string               `json:"engine"`
	UsdDecimals uint8                `json:"usd_decimals"`
	Before      wireRunBookAggregate `json:"before"`
	After       wireRunBookAggregate `json:"after"`
	// HFTransitions is the joint distribution the two histograms above cannot
	// produce: which BEFORE lane each position row left and which AFTER lane it
	// arrived in. Its margins ARE those two histograms, lane for lane.
	HFTransitions         wireRunBookTransitions `json:"hf_transitions"`
	NewlyEligibleAccounts int                    `json:"newly_eligible_accounts"`
	EligibleDebtDeltaUSD  string                 `json:"eligible_debt_delta_usd"`
	BadDebtDeltaUSD       string                 `json:"bad_debt_delta_usd"`
	// Movers is at most runBookMoversCap rows of the accounts this scenario
	// moved, ranked by the engine's own rule. MoversTotal is the FULL count —
	// the slice is a window onto it, never the whole of it, and MoversNote names
	// both the rule and the truncation.
	Movers      []wireRunBookMover `json:"movers"`
	MoversTotal int                `json:"movers_total"`
	MoversNote  string             `json:"movers_note"`
	Shortfall   *wireShortfall     `json:"market_realization"`
	Projection  *wireProjection    `json:"projection"`
	Note        string             `json:"note"`
}

type runBookResponse struct {
	ServedAt              time.Time           `json:"served_at"`
	Batch                 wireBatch           `json:"batch"`
	ScenarioConfigVersion string              `json:"scenario_config_version"`
	ScenarioID            string              `json:"scenario_id"`
	ScenarioVersion       string              `json:"scenario_version"`
	Label                 string              `json:"label"`
	Description           string              `json:"description"`
	PathAssumption        string              `json:"path_assumption"`
	Shocks                []wireShock         `json:"shocks"`
	OutOfModel            []string            `json:"out_of_model"`
	AppliedShocks         []wireAppliedShock  `json:"applied_shocks"`
	HeldFlat              []wireHeldFlat      `json:"held_flat"`
	Engines               []wireRunBookEngine `json:"engines"`
	ExcludedEngines       []wireEngineRefusal `json:"excluded_engines"`
	Coverage              wireBookCoverage    `json:"coverage"`
	Notes                 []string            `json:"notes"`
}

var runBookIDPattern = regexp.MustCompile(`^[a-z0-9_]{1,64}$`)

// runMeasure is one side of the shock for one engine: the Waterfall measure at
// the identity grid point plus the totals summed alongside it.
type runMeasure struct {
	accounts         int
	eligibleAccounts int
	totalCollateral  *big.Int
	totalDebt        *big.Int
	eligibleDebt     *big.Int
	collateralAtRisk *big.Int
	badDebt          *big.Int

	// Everything below is DERIVED IN THE SAME WALK that sums the totals above.
	// measureRunBook already computes each position's health to sum collateral
	// and debt; the histogram bucket, the per-asset collateral and the
	// per-account state fall out of that one computation. Nothing here re-walks
	// the book and nothing here re-reads the database.
	buckets    []int
	infinite   int
	refused    int
	collateral map[runCollateralKey]*runCollateral
	states     map[common.Address]*runAccountState

	// lanes is ORDERED, one entry per POSITION ROW, in walk order. It is what
	// makes the transition matrix a joint distribution rather than a guess: the
	// two sides' slices are index-aligned by construction (measureRunBook walks
	// its argument in slice order and ApplyScenario neither reorders nor drops),
	// so pairing by index needs no map and marginal agreement holds BY
	// CONSTRUCTION rather than by assertion.
	//
	// It carries BOTH populations: the measured entries appended by `place`
	// beside the tally it writes, and the unmeasured entries the handler folds
	// onto both sides. `accounts` and `states` see only the first of those.
	lanes []runLaneEntry
}

// runLaneEntry is ONE position row's placement on ONE side of the shock.
type runLaneEntry struct {
	account common.Address
	lane    int
	// debtUSD is nil ONLY on an unmeasured row — the row this run computed no
	// debt for. That nil is what makes cell (N+1, N+1)'s two debts null rather
	// than "0", and it is never a stand-in for a zero this run actually computed.
	debtUSD *big.Int
}

// runBookMoversCap bounds the `movers` array. It is a CONSTANT and it is named
// in every movers_note this surface serves: a cap the consumer cannot see is a
// silent cap, and `movers_total` is what says how much was left out.
const runBookMoversCap = 20

// The collateral disclosure vocabulary. A holding is either COUNTED (its value
// is inside total_collateral_usd) or it is not — and when it is not, this says
// which of the two very different reasons applies.
const (
	// runCollateralCounted: the engine counted this value. value_usd is exact.
	runCollateralCounted = "counted"
	// runCollateralUnpriced: the account holds the token and NO price witness
	// describes it, so its USD value is UNKNOWABLE. value_usd is null, never 0.
	runCollateralUnpriced = "unpriced"
	// runCollateralNotCounted: priced, but the engine counts none of it toward
	// collateral (Aave `usedAsCollateral = false`). value_usd is null because
	// the reviewed arithmetic assigned it none — inventing one here would put a
	// number on the wire that no engine computed.
	runCollateralNotCounted = "not_counted_as_collateral"
)

// runCollateralKey groups by asset AND disclosure, so one entry never mixes a
// counted balance with an unknowable one under a single value.
type runCollateralKey struct {
	asset      common.Address
	disclosure string
}

type runCollateral struct {
	asset      common.Address
	decimals   uint8
	disclosure string
	amount     *big.Int
	valueUSD   *big.Int
}

// runAccountState is ONE account's comparator state on ONE side of the shock.
// The movers join is over these: no position is measured twice to build it.
type runAccountState struct {
	// account is the row this state was computed for. It is `h.Account` at both
	// call sites, and it travels with the state so `place` can append the lane
	// record in the SAME statement that writes the histogram tally.
	account      common.Address
	hfWad        *big.Int // Aave; nil when infinite
	hfNum, hfDen *big.Int // Debt Manager; the exact rational
	infinite     bool
	eligible     bool
	debtUSD      *big.Int
}

func newRunMeasure() *runMeasure {
	return &runMeasure{
		totalCollateral: new(big.Int), totalDebt: new(big.Int),
		eligibleDebt: new(big.Int), collateralAtRisk: new(big.Int), badDebt: new(big.Int),
		buckets:    make([]int, len(histogramEdges)),
		collateral: map[runCollateralKey]*runCollateral{},
		states:     map[common.Address]*runAccountState{},
	}
}

// place assigns one position row its LANE and writes the histogram tally in the
// SAME statement, through bucketIndexOf — the same law, not a second copy of it.
// The tally and the lane record come from one call, so no code path can
// increment one without appending the other, and a matrix that disagreed with
// its own histogram would require this function to write two different numbers.
//
// The −1 arm no longer folds into `m.refused`. It is UNREACHABLE by
// construction, and folding an impossible state into the unmeasured lane would
// give that lane two meanings: a MEASURED row's debt would sit behind a null and
// the per-side debt reconciliation would break.
func (m *runMeasure) place(engine string, st *runAccountState) error {
	lane := laneInfinite
	if !st.infinite {
		idx := bucketIndexOf(engine, st.hfWad, st.hfNum, st.hfDen)
		if idx < 0 {
			// UNREACHABLE by construction: ComputeAaveHealth sets
			// HealthFactorWad exactly when it clears IsInfinite, and
			// ComputeDMHealth sets the rational exactly when borrowings > 0 —
			// TestMeasuredStatesAlwaysCarryAComparator stands on both. If this
			// ever fires, the engine has grown a measured state with no
			// comparator and it needs its OWN lane and its OWN histogram tally.
			return fmt.Errorf("%s: account %s was measured but carries no comparator, "+
				"so it belongs in no bucket and in no existing lane; the histogram and the "+
				"transition matrix both need a new tally before this row can be served",
				engine, st.account.Hex())
		}
		lane = idx
	}
	switch lane {
	case laneInfinite:
		m.infinite++
	default:
		m.buckets[lane]++
	}
	m.lanes = append(m.lanes, runLaneEntry{account: st.account, lane: lane, debtUSD: st.debtUSD})
	return nil
}

// addCollateral folds one holding into this side's per-asset breakdown, keyed by
// asset AND disclosure so a counted balance and an unknowable one never share an
// entry.
func (m *runMeasure) addCollateral(asset common.Address, decimals uint8, disclosure string, amount, valueUSD *big.Int) {
	if amount == nil || amount.Sign() <= 0 {
		return
	}
	k := runCollateralKey{asset: asset, disclosure: disclosure}
	c, ok := m.collateral[k]
	if !ok {
		c = &runCollateral{asset: asset, decimals: decimals, disclosure: disclosure,
			amount: new(big.Int), valueUSD: new(big.Int)}
		m.collateral[k] = c
	}
	c.amount.Add(c.amount, amount)
	if disclosure == runCollateralCounted {
		c.valueUSD.Add(c.valueUSD, orZeroBigInt(valueUSD))
	}
}

func (m *runMeasure) wire(engine string, s *server) wireRunBookAggregate {
	comparator, histNote := histogramComparator(engine)
	hist := wireRunBookHistogram{
		Comparator:    comparator,
		WadScale:      risk.WadUnit().String(),
		Buckets:       make([]wireHistogramBucket, 0, len(histogramEdges)),
		InfiniteCount: m.infinite,
		RefusedCount:  m.refused,
		// The `refused_count` clause states what that tally ACTUALLY holds. It
		// used to read "positions carrying no comparator", which is false twice
		// over: no MEASURED row on either engine can lack a comparator (`place`
		// refuses one outright), and the rows this count does hold are the ones
		// this run measured on NEITHER side — predominantly riskd's own
		// refusals, which live in `coverage.refused_in_batch` and NOT in
		// `coverage.excluded`. `hf_transitions` states the same population as
		// its last lane and splits it by cause.
		Note: histNote + " This is ONE SIDE of the shock over the positions in the run, " +
			"in the SAME buckets /v1/book's histogram serves; the after-side is bucketed on the SHOCKED states. " +
			"`infinite_count` is accounts with no debt and `refused_count` is the positions this run measured on NEITHER side — " +
			"both are counted here rather than dropped, so the buckets plus these two account for the whole run. " +
			"`hf_transitions` states that same population as its last lane and splits it by cause.",
	}
	// The edges are walked in the SAME order and built by the SAME edgeWad as
	// /v1/book's, so an edge that moves moves in both places at once.
	var lower *string
	for i, e := range histogramEdges {
		b := wireHistogramBucket{Label: e.label, Count: m.buckets[i], LowerWad: lower}
		if e.upper != 0 {
			u := edgeWad(e.upper).String()
			b.UpperWad = &u
			lower = &u
		} else {
			b.UpperWad = nil
		}
		hist.Buckets = append(hist.Buckets, b)
	}

	keys := make([]runCollateralKey, 0, len(m.collateral))
	for k := range m.collateral {
		keys = append(keys, k)
	}
	// Deterministic: by asset, then by disclosure. Two runs over the same batch
	// serve byte-identical arrays.
	sort.Slice(keys, func(i, j int) bool {
		if keys[i].asset != keys[j].asset {
			return keys[i].asset.Hex() < keys[j].asset.Hex()
		}
		return keys[i].disclosure < keys[j].disclosure
	})
	byAsset := make([]wireRunBookCollateralAsset, 0, len(keys))
	for _, k := range keys {
		c := m.collateral[k]
		w := wireRunBookCollateralAsset{
			Asset:    c.asset.Hex(),
			Decimals: c.decimals,
			Amount:   c.amount.String(),
			Unpriced: c.disclosure == runCollateralUnpriced,
		}
		// The symbol is decoration over an address that is already exact. A
		// registry that holds no entry — or is absent entirely — leaves it off
		// rather than inventing one.
		if s.registry != nil {
			if spec, ok := s.registry.Spec(engine, c.asset); ok {
				w.Symbol = spec.Symbol
			}
		}
		switch c.disclosure {
		case runCollateralCounted:
			v := c.valueUSD.String()
			w.ValueUSD = &v
			w.Note = "COUNTED: this value is inside `total_collateral_usd` on this side. The counted entries sum to it EXACTLY."
		case runCollateralUnpriced:
			// value_usd stays nil. A balance whose price nothing describes is
			// not a balance worth zero, and that is the whole reason this field
			// is nullable.
			w.Note = "UNPRICED: the account holds this token and NO price witness describes it on this side, so its USD value is UNKNOWABLE — not zero. " +
				"`amount` is exact; none of this holding is inside `total_collateral_usd`."
		default:
			w.Note = "NOT COUNTED AS COLLATERAL: the engine counts none of this holding toward collateral (Aave `usedAsCollateral = false`), so the reviewed arithmetic assigned it no value and none is invented here. " +
				"`amount` is exact; none of this holding is inside `total_collateral_usd`."
		}
		byAsset = append(byAsset, w)
	}

	return wireRunBookAggregate{
		Accounts:            m.accounts,
		EligibleAccounts:    m.eligibleAccounts,
		TotalCollateralUSD:  m.totalCollateral.String(),
		TotalDebtUSD:        m.totalDebt.String(),
		EligibleDebtUSD:     m.eligibleDebt.String(),
		CollateralAtRiskUSD: m.collateralAtRisk.String(),
		BadDebtUSD:          m.badDebt.String(),
		HFHistogram:         hist,
		CollateralByAsset:   byAsset,
	}
}

func (s *server) handleRunBook(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if !runBookIDPattern.MatchString(id) {
		writeError(w, http.StatusBadRequest, codeBadRequest,
			"scenario id must match ^[a-z0-9_]{1,64}$", nil)
		return
	}
	sc, ok := s.byID[id]
	if !ok {
		writeError(w, http.StatusNotFound, codeNotFound,
			"no committed scenario "+strconv.Quote(id)+": this endpoint evaluates the COMMITTED scenario set only (the same set /v1/address/{addr}/stress serves), never arbitrary user scenarios", nil)
		return
	}

	v, err := s.readBatch(r.Context(), nil)
	if err != nil {
		serveReadError(w, err)
		return
	}
	refused := engineRefusals(v)
	withheld := map[string]bool{}
	for _, ref := range refused {
		withheld[ref.Engine] = true
	}

	// The run: every reconstructable position on an engine the scenario
	// covers. Refused batch rows never reach any arithmetic (they carry no
	// numbers to shock); positions this layer could not rebuild are named in
	// coverage.excluded.
	var run []runPos
	var notCovered []string
	seenEngine := map[string]bool{}
	// unmeasuredByEngine records the positions on a COVERED engine that reached
	// NO arithmetic in this run. They carry no numbers to shock — but they are
	// real rows of the book, and the per-side histograms must count them rather
	// than let a distribution read as a complete census while they are silently
	// missing from it.
	//
	// The record is per engine and it SPLITS BY CAUSE, because the two causes
	// land on two DIFFERENT coverage surfaces (§ classifyUnmeasured) and a
	// per-engine count that named the wrong one would point a reader at a
	// surface that does not hold its rows. It is the ONLY carrier of that split:
	// the lane records below are cause-blind by design.
	unmeasuredByEngine := map[string]*runUnmeasured{}
	unmeasuredFor := func(engine string) *runUnmeasured {
		u := unmeasuredByEngine[engine]
		if u == nil {
			u = &runUnmeasured{}
			unmeasuredByEngine[engine] = u
		}
		return u
	}
	for _, p := range v.Positions {
		if p.input == nil {
			if covers(sc.Engines, p.Engine) {
				acct := common.BytesToAddress(p.Account)
				cause, err := classifyUnmeasured(p.Engine, acct, p.Status, p.reconstructionErr)
				if err != nil {
					// THE HANDLER'S OWN REFUSAL FORM: write and return. There is
					// no error to return from here.
					writeError(w, http.StatusInternalServerError, codeInternal, err.Error(), nil)
					return
				}
				u := unmeasuredFor(p.Engine)
				u.accounts = append(u.accounts, acct)
				if cause == unmeasuredRefusedInBatch {
					u.refusedInBatch++
				} else {
					u.excludedByThisLayer++
				}
			}
			// The ordinary skip for a row that reached no arithmetic. The refusal
			// above has already left the handler, so this is reached only on the
			// two live causes and on a row whose engine this scenario does not
			// cover.
			continue
		}
		if !covers(sc.Engines, p.Engine) {
			if !seenEngine[p.Engine] {
				seenEngine[p.Engine] = true
				notCovered = append(notCovered, p.Engine)
			}
			continue
		}
		run = append(run, runPos{row: p, input: *p.input})
	}
	sort.Strings(notCovered)

	// BEFORE: measure the book as persisted (the identity-shock Waterfall
	// point — the same measure /v1/book's unshocked grid point serves).
	beforeInputs := make([]risk.PositionInput, 0, len(run))
	for _, rp := range run {
		beforeInputs = append(beforeInputs, rp.input)
	}
	before, err := s.measureRunBook(beforeInputs)
	if err != nil {
		writeError(w, http.StatusInternalServerError, codeInternal, "measuring the unshocked book refused: "+err.Error(), nil)
		return
	}

	// AFTER: the scenario applied through each engine's actual pricing
	// transforms. A rate scenario is a PROJECTION — it moves no spot state, so
	// its after side IS the before side and its information lives in
	// `projection`.
	afterInputs := make([]risk.PositionInput, 0, len(run))
	appliedSet := map[string]wireAppliedShock{}
	heldFlatSet := map[string]wireHeldFlat{}
	if sc.Projection == nil {
		for _, rp := range run {
			shocked, err := risk.ApplyScenario(rp.input, sc)
			if err != nil {
				// Inputs here are reconstruction-VERIFIED; a refusal is a defect
				// in this layer, not a property of the data.
				writeError(w, http.StatusInternalServerError, codeInternal,
					"applying scenario "+sc.ID+" refused a verified position: "+err.Error(), nil)
				return
			}
			if shocked.Scenario != nil {
				for _, a := range shocked.Scenario.Applied {
					ws := wireAppliedShock{
						Asset: a.Asset.Hex(), ChainID: a.ChainID, Source: sanitize(a.Source),
						FactorNum: orZeroString(a.FactorNum), FactorDen: orZeroString(a.FactorDen),
						Before: orZeroString(a.Before), After: orZeroString(a.After),
						Snapped: a.Snapped, BaseSnapped: a.BaseSnapped, CapBound: a.CapBound,
					}
					appliedSet[appliedShockKey(ws)] = ws
				}
				for _, h := range shocked.Scenario.HeldFlat {
					wh := wireHeldFlat{Asset: h.Asset.Hex(), ChainID: h.ChainID, Source: sanitize(h.Source), Value: orZeroString(h.Value)}
					heldFlatSet[heldFlatKey(wh)] = wh
				}
			}
			afterInputs = append(afterInputs, shocked)
		}
	} else {
		afterInputs = beforeInputs
	}
	after, err := s.measureRunBook(afterInputs)
	if err != nil {
		writeError(w, http.StatusInternalServerError, codeInternal, "measuring the shocked book refused: "+err.Error(), nil)
		return
	}

	// The market-realization axis, book-wide: oracles held, health factors
	// bit-identical (asserted by the library, not by this comment).
	var shortfall *risk.ShortfallResult
	if len(sc.MarketRealizations) > 0 {
		sf, err := risk.ExecutionShortfall(beforeInputs, sc.MarketRealizationsFor())
		if err != nil {
			writeError(w, http.StatusInternalServerError, codeInternal, "execution shortfall refused: "+err.Error(), nil)
			return
		}
		shortfall = &sf
	}

	out := runBookResponse{
		ServedAt:              v.Now,
		Batch:                 batchEnvelope(v),
		ScenarioConfigVersion: s.scenarioConfigVersion(),
		ScenarioID:            sc.ID,
		ScenarioVersion:       sc.Version,
		Label:                 sc.Label,
		Description:           sc.Description,
		PathAssumption:        sc.PathAssumption,
		Shocks:                []wireShock{},
		OutOfModel:            orEmpty(sc.OutOfModel),
		AppliedShocks:         []wireAppliedShock{},
		HeldFlat:              []wireHeldFlat{},
		Engines:               []wireRunBookEngine{},
		ExcludedEngines:       refused,
		Coverage:              coverage(v.Positions, len(beforeInputs), refused),
		Notes: []string{
			"aggregates are per engine in each engine's OWN unit and decimals; they are never summed across engines.",
			"deltas are DELTA-ONLY: after minus before, the scenario's own contribution over the positions in the run.",
			"eligibility, collateral-at-risk and bad-debt measures are the SAME arithmetic as /v1/book's unshocked waterfall point, evaluated on each side of the shock.",
		},
	}
	for _, sh := range sc.Shocks {
		out.Shocks = append(out.Shocks, wireShock{
			Axis: string(sh.Axis), Asset: sh.Asset, FactorNum: sh.FactorNum, FactorDen: sh.FactorDen,
		})
	}
	for _, k := range sortedKeys(appliedSet) {
		out.AppliedShocks = append(out.AppliedShocks, appliedSet[k])
	}
	for _, k := range sortedKeys(heldFlatSet) {
		out.HeldFlat = append(out.HeldFlat, heldFlatSet[k])
	}
	if len(notCovered) > 0 {
		note := "engines not covered by this scenario contribute no rows to this run and are absent from `engines`: "
		for i, e := range notCovered {
			if i > 0 {
				note += ", "
			}
			note += e
		}
		out.Notes = append(out.Notes, note+". Their absence is by scenario definition, not withholding — withheld engines are in `excluded_engines`.")
	}

	// One row per engine the scenario covers, withheld engines excluded (they
	// are named in excluded_engines and appear nowhere else).
	usdDecimals := map[string]uint8{}
	for _, a := range v.Aggregates {
		usdDecimals[a.Engine] = a.ValueDecimals
	}
	engines := append([]string(nil), sc.Engines...)
	sort.Strings(engines)
	for _, engine := range engines {
		if withheld[engine] {
			continue
		}
		dec, ok := usdDecimals[engine]
		if !ok {
			dec = uint8(engineValueDecimals[engine])
		}
		eb, ea := before[engine], after[engine]
		if eb == nil {
			eb = newRunMeasure()
		}
		if ea == nil {
			ea = newRunMeasure()
		}
		// The unmeasured rows are refused on BOTH sides: the shock does not make
		// a position rebuildable, and a histogram that counted them on one side
		// only would move rows between the two distributions for a reason that
		// has nothing to do with the scenario. The paired lane entries are what
		// put them in the matrix's (N+1, N+1) cell, and their nil `debtUSD` is
		// what makes that cell's two debts null rather than "0".
		if u := unmeasuredByEngine[engine]; u != nil {
			for _, acct := range u.accounts {
				eb.refused++
				ea.refused++
				eb.lanes = append(eb.lanes, runLaneEntry{account: acct, lane: laneUnmeasured})
				ea.lanes = append(ea.lanes, runLaneEntry{account: acct, lane: laneUnmeasured})
			}
		}
		transitions, err := runBookTransitions(engine, eb, ea, dec, unmeasuredByEngine[engine])
		if err != nil {
			// A defect in this layer or a violation of a database constraint,
			// never a property of the data. It never degrades to a matrix with
			// wrong margins.
			writeError(w, http.StatusInternalServerError, codeInternal, err.Error(), nil)
			return
		}
		movers, moversTotal := runBookMovers(engine, eb, ea)
		we := wireRunBookEngine{
			Engine:                engine,
			UsdDecimals:           dec,
			Before:                eb.wire(engine, s),
			After:                 ea.wire(engine, s),
			HFTransitions:         transitions,
			NewlyEligibleAccounts: ea.eligibleAccounts - eb.eligibleAccounts,
			EligibleDebtDeltaUSD:  new(big.Int).Sub(ea.eligibleDebt, eb.eligibleDebt).String(),
			BadDebtDeltaUSD:       new(big.Int).Sub(ea.badDebt, eb.badDebt).String(),
			Movers:                movers,
			MoversTotal:           moversTotal,
			MoversNote:            runBookMoversNote(engine, len(movers), moversTotal, dec),
			Note: "delta-only: after minus before over the positions in the run, in this engine's own " +
				strconv.Itoa(int(dec)) + "-decimal unit.",
		}
		if shortfall != nil {
			es, ok := shortfall.PerEngine[engine]
			if !ok {
				es = risk.EngineShortfall{Engine: engine, UsdDecimals: dec,
					ExecutionShortfallUSD: new(big.Int), BadDebtAtLiquidationUSD: new(big.Int)}
			}
			we.Shortfall = &wireShortfall{
				HFsUnchanged:            shortfall.HFsUnchanged,
				ExecutionShortfallUSD:   orZeroString(es.ExecutionShortfallUSD),
				BadDebtAtLiquidationUSD: orZeroString(es.BadDebtAtLiquidationUSD),
				UsdDecimals:             es.UsdDecimals,
				SeizureModel:            shortfall.SeizureModel,
				Note:                    "market value is NOT an oracle mark: this scenario moves NO health factor (`hfs_unchanged` asserts it, computed not promised). The output is the gap the protocol is not seeing, under the disclosed seizure model.",
			}
			we.Note = "oracle marks held: before and after aggregates are identical by construction; the shortfall axis is where this scenario's information lives."
		}
		if sc.Projection != nil && engine == risk.DMEngine {
			proj, err := s.runBookProjection(sc, v, run, engine)
			if err != nil {
				writeError(w, http.StatusInternalServerError, codeInternal, err.Error(), nil)
				return
			}
			we.Projection = proj
			we.Note = "rate axis: a PROJECTION over time on the delta-only basis, never a spot shock — before and after spot aggregates are identical by construction."
		}
		out.Engines = append(out.Engines, we)
	}
	writeJSON(w, out)
}

// measureRunBook evaluates the run's positions at the IDENTITY grid point of
// the standing waterfall scenario — factor 1.0 applies every price times 1/1,
// so the measure is of the book exactly as handed in, through the same
// reviewed eligibility/seizure/bad-debt arithmetic /v1/book serves.
func (s *server) measureRunBook(book []risk.PositionInput) (map[string]*runMeasure, error) {
	out := map[string]*runMeasure{}
	measureOf := func(engine string) *runMeasure {
		m, ok := out[engine]
		if !ok {
			m = newRunMeasure()
			out[engine] = m
		}
		return m
	}
	// Totals and account counts, summed from each position's own recompute —
	// the same pure functions the reconstruction verification welds against
	// the persisted rows.
	//
	// THE HISTOGRAM, THE PER-ASSET COLLATERAL AND THE PER-ACCOUNT MOVER STATE
	// ARE DERIVED HERE, off the health this loop already computes. They cost one
	// map write each and no second evaluation of anything: a second walk would
	// be a second chance for the two to disagree about what this side of the
	// shock contains.
	for _, pos := range book {
		switch pos.Engine {
		case risk.AaveEngine:
			h, err := risk.ComputeAaveHealth(*pos.Aave)
			if err != nil {
				return nil, err
			}
			m := measureOf(risk.AaveEngine)
			m.accounts++
			m.totalCollateral.Add(m.totalCollateral, orZeroBigInt(h.TotalCollateralBase))
			m.totalDebt.Add(m.totalDebt, orZeroBigInt(h.TotalDebtBase))

			st := &runAccountState{
				account:  h.Account,
				hfWad:    h.HealthFactorWad,
				infinite: h.IsInfinite,
				eligible: h.Liquidatable(),
				debtUSD:  orZeroBigInt(h.TotalDebtBase),
			}
			m.states[h.Account] = st
			if err := m.place(risk.AaveEngine, st); err != nil {
				return nil, err
			}

			for _, rv := range h.Reserves {
				if rv.LiveCollateral == nil || rv.LiveCollateral.Sign() <= 0 {
					continue
				}
				switch {
				// LiquidationThresholdBps is set by ComputeAaveHealth exactly
				// when the reserve COUNTS as collateral, so it is the engine's
				// own discriminator rather than a re-derivation of one.
				case rv.LiquidationThresholdBps != nil:
					m.addCollateral(rv.Asset, rv.Decimals, runCollateralCounted, rv.LiveCollateral, rv.CollateralBase)
				case rv.Price.Value == nil:
					// Held, collateral disabled, and NOTHING prices it. The
					// balance is exact and its worth is unknowable.
					m.addCollateral(rv.Asset, rv.Decimals, runCollateralUnpriced, rv.LiveCollateral, nil)
				default:
					m.addCollateral(rv.Asset, rv.Decimals, runCollateralNotCounted, rv.LiveCollateral, nil)
				}
			}
		case risk.DMEngine:
			h, err := risk.ComputeDMHealth(*pos.DM)
			if err != nil {
				return nil, err
			}
			m := measureOf(risk.DMEngine)
			m.accounts++
			m.totalCollateral.Add(m.totalCollateral, orZeroBigInt(h.CollateralValueUSD))
			m.totalDebt.Add(m.totalDebt, orZeroBigInt(h.Borrowings))

			st := &runAccountState{
				account:  h.Account,
				infinite: h.IsInfinite,
				eligible: h.Liquidatable,
				debtUSD:  orZeroBigInt(h.Borrowings),
			}
			if !h.IsInfinite {
				st.hfNum, st.hfDen = h.HealthFactor.Num, h.HealthFactor.Den
			}
			m.states[h.Account] = st
			if err := m.place(risk.DMEngine, st); err != nil {
				return nil, err
			}

			for _, cv := range h.Collateral {
				// ComputeDMHealth REFUSES a nonzero leg it cannot price, so a
				// leg that reached here with a balance is priced and counted.
				m.addCollateral(cv.Asset, cv.Decimals, runCollateralCounted, cv.Amount, cv.ValueUSD)
			}
		default:
			// THE ENGINE ARM THAT DOES NOT EXIST. Without this, a third engine's
			// position entered `run`, `beforeInputs` and therefore
			// `coverage.in_book` while producing no account count, no tally and
			// no lane entry: it would be in ZERO cells while every margin still
			// "partitioned exactly". It is unconstructible with today's committed
			// scenarios, and a named 500 is what forces the conversation instead
			// of hiding the omission.
			return nil, fmt.Errorf("run-book measure has no arm for engine %q: the scenario covers it "+
				"and its rows are in the run, but nothing here counts them, so every distribution "+
				"this response serves would silently omit them", pos.Engine)
		}
	}
	if len(book) == 0 {
		return out, nil
	}
	series, err := risk.Waterfall(book, []*big.Int{risk.WaterfallGridScale()}, s.waterfallScenario)
	if err != nil {
		return nil, err
	}
	if len(series.Points) != 1 {
		return nil, fmt.Errorf("identity-point waterfall returned %d points, want exactly 1", len(series.Points))
	}
	for _, e := range series.Points[0].Engines {
		m := measureOf(e.Engine)
		m.eligibleAccounts = e.CumulativeEligibleAccounts
		m.eligibleDebt = orZeroBigInt(e.CumulativeDebtEligibleUSD)
		m.collateralAtRisk = orZeroBigInt(e.CumulativeCollateralAtRiskUSD)
		m.badDebt = orZeroBigInt(e.CumulativeBadDebtUSD)
	}
	return out, nil
}

// runBookMovers joins the two sides' per-account states into the accounts this
// scenario MOVED, ranked by the engine's own definition of movement.
//
// # The ranking rule is the engine's, not a shared one
//
// Aave has a continuous comparator, so the movement that matters is the HEALTH
// FACTOR DROP: before minus after, in the pool's own wad space, largest first.
// The Debt Manager has no health-factor wad and no continuous comparator — its
// liquidation test is the strict boolean `debt > maxBorrowLT` — so the movement
// that matters is the ELIGIBILITY FLIP, and the accounts that flipped are ranked
// by the DEBT that became eligible, largest first. Ranking DM rows by a ratio
// delta would rank on the disclosure rather than on the verdict.
//
// Returns the capped slice and the FULL count. The two are different numbers and
// the caller publishes both.
func runBookMovers(engine string, before, after *runMeasure) ([]wireRunBookMover, int) {
	type ranked struct {
		mover wireRunBookMover
		key   *big.Int
	}
	var all []ranked

	// Deterministic iteration: the join walks the BEFORE side's accounts in
	// sorted order, so equal ranking keys resolve the same way on every run.
	accounts := make([]common.Address, 0, len(before.states))
	for a := range before.states {
		accounts = append(accounts, a)
	}
	sort.Slice(accounts, func(i, j int) bool { return accounts[i].Hex() < accounts[j].Hex() })

	for _, acct := range accounts {
		b := before.states[acct]
		a, ok := after.states[acct]
		if !ok {
			// The before-side account has no after-side state at all, on EITHER
			// engine. It is untestable rather than unmoved, which is why
			// runBookMovementExcluded counts it.
			continue
		}
		switch engine {
		case risk.AaveEngine:
			// A drop needs a health factor on BOTH sides. A zero-debt account
			// has none — it is unbounded, not large — so it cannot have dropped
			// and is not a mover. That exclusion is named in the movers_note.
			if !runBookMoverTestable(engine, b, a) {
				continue
			}
			drop := new(big.Int).Sub(b.hfWad, a.hfWad)
			if drop.Sign() <= 0 {
				continue
			}
			bw, aw, dw := b.hfWad.String(), a.hfWad.String(), drop.String()
			all = append(all, ranked{key: drop, mover: wireRunBookMover{
				Account: acct.Hex(), Engine: engine,
				HFBeforeWad: &bw, HFAfterWad: &aw, HFDropWad: &dw,
			}})
		case risk.DMEngine:
			// The flip, strictly false -> true. An account already eligible
			// before the shock did not become eligible under it.
			if b.eligible || !a.eligible {
				continue
			}
			debt := orZeroBigInt(a.debtUSD)
			flipped := true
			ds := debt.String()
			mv := wireRunBookMover{
				Account: acct.Hex(), Engine: engine,
				BecameEligible: &flipped, DebtUSD: &ds,
			}
			// The exact rational on each side, when the side has one. An
			// infinite side carries nulls rather than a stand-in.
			if b.hfNum != nil && b.hfDen != nil {
				bn, bd := b.hfNum.String(), b.hfDen.String()
				mv.HFBeforeNum, mv.HFBeforeDen = &bn, &bd
			}
			if a.hfNum != nil && a.hfDen != nil {
				an, ad := a.hfNum.String(), a.hfDen.String()
				mv.HFAfterNum, mv.HFAfterDen = &an, &ad
			}
			all = append(all, ranked{key: debt, mover: mv})
		}
	}

	// Largest key first; ties keep the account order established above, so the
	// ranking is total and stable.
	sort.SliceStable(all, func(i, j int) bool { return all[i].key.Cmp(all[j].key) > 0 })

	total := len(all)
	if len(all) > runBookMoversCap {
		all = all[:runBookMoversCap]
	}
	out := make([]wireRunBookMover, 0, len(all))
	for _, r := range all {
		out = append(out, r.mover)
	}
	return out, total
}

// runBookMoverTestable reports whether runBookMovers can TEST this account for
// movement at all on this engine.
//
// It is ONE predicate with two readers — the movers join above, and
// runBookMovementExcluded below, which counts the population it turns away.
// Two copies of it would be two definitions of the movement count's
// denominator, and the whole point of publishing that denominator is that it
// answers to the same rule the numerator does.
//
// `a == nil` is the before-side account with NO after-side state, which both
// engines skip. The Aave arm is the health-factor guard: a drop needs a finite
// health factor on BOTH sides, and a debt-free account has none on either.
func runBookMoverTestable(engine string, b, a *runAccountState) bool {
	if b == nil || a == nil {
		return false
	}
	if engine == risk.AaveEngine {
		return !(b.infinite || a.infinite || b.hfWad == nil || a.hfWad == nil)
	}
	return true
}

// runBookMovementExcluded is the movement count's EXCLUDED POPULATION: the
// accounts this run measured on the before side that runBookMovers could not
// test for movement at all.
//
// The movement count's denominator is `accounts - movement_excluded_accounts`
// and it is never `accounts`. On an Aave book of residual dust, "0 movers" out
// of 46 accounts reads as "no health factor dropped" when the truth can be
// "44 of the 46 carry no health factor to drop", and the difference between
// those two sentences is this number.
func runBookMovementExcluded(engine string, before, after *runMeasure) int {
	n := 0
	for acct, b := range before.states {
		if !runBookMoverTestable(engine, b, after.states[acct]) {
			n++
		}
	}
	return n
}

// runBookAaveExclusionClause is the sentence that names the Aave movement
// count's excluded population. It is a CONSTANT because two surfaces serve it —
// `movers_note` on the single-scenario route and the per-engine `note` on the
// set-run — and a paraphrase on either would be a second definition of the same
// exclusion. `TestSetRunMovementCountPublishesItsDenominator` checks the
// set-run's note by substring against this exact value.
const runBookAaveExclusionClause = "An account with no debt has an unbounded health factor on either side, " +
	"so it has no drop to rank and is not counted here — it is not a quiet zero."

// runBookDMExclusionClause is the Debt Manager's parallel sentence. The DM rule
// has no health-factor guard, so the only accounts it cannot test are
// before-side rows with no after-side state at all — a population that is
// normally empty and is published rather than assumed empty.
const runBookDMExclusionClause = "The eligibility flip is testable for every account this run measured on both sides, " +
	"so the only accounts excluded from it are before-side rows carrying no after-side state at all — it is not a quiet zero."

// runBookMoversNote names the ranking rule AND the truncation, in the engine's
// own vocabulary. `shown` and `total` are both in the sentence because a capped
// list whose cap is invisible is a silent cap.
func runBookMoversNote(engine string, shown, total int, dec uint8) string {
	var rule string
	switch engine {
	case risk.AaveEngine:
		rule = "RANKED BY HEALTH-FACTOR DROP: before minus after, in the pool's own WAD, largest drop first. " +
			"Only accounts whose health factor STRICTLY DROPPED are movers. " + runBookAaveExclusionClause
	default:
		rule = "RANKED BY THE DEBT THAT BECAME ELIGIBLE: only accounts whose Debt Manager eligibility FLIPPED false -> true under this scenario are movers, " +
			"ranked by their debt in this engine's " + strconv.Itoa(int(dec)) + "-decimal USD, largest first. " +
			"The Debt Manager has no health-factor wad, so `hf_before_num/den` and `hf_after_num/den` are the EXACT rational maxBorrowLT/borrowings, a disclosure only. " +
			"`movers_total` counts flips to eligible ONLY, so it is not `newly_eligible_accounts`, which is a NET count and also subtracts any flip back to healthy."
	}
	trunc := "`movers` carries all " + strconv.Itoa(total) + " of them."
	if total > shown {
		trunc = "`movers` is TRUNCATED to the top " + strconv.Itoa(runBookMoversCap) + " of " + strconv.Itoa(total) +
			"; `movers_total` is the full count and the other " + strconv.Itoa(total-shown) + " are not on this page."
	}
	return rule + " " + trunc
}

// runBookProjection aggregates the DM rate projection book-wide: each
// horizon's figures are the SUM of the per-position closed-form projections —
// the same delta-only basis as the address-level surface, never a spot shock.
func (s *server) runBookProjection(sc risk.Scenario, v *batchView, run []runPos, engine string) (*wireProjection, error) {
	delta, ok := new(big.Int).SetString(sc.Projection.APYDeltaPerSecond100e18, 10)
	if !ok {
		return nil, fmt.Errorf("committed projection delta %q is not an integer", sc.Projection.APYDeltaPerSecond100e18)
	}
	// The engine's stamped balances watermark: the observation height every DM
	// position in this batch shares.
	var observedAt uint64
	for _, m := range v.Batch.Watermarks {
		if m.Engine == engine {
			observedAt = m.LastBlock
		}
	}
	out := &wireProjection{
		Label:          "PROJECTION",
		Basis:          "delta-only",
		AnnualDeltaBps: sc.Projection.AnnualDeltaBps,
		APYObservedAt:  observedAt,
		PricesHeldFlat: true,
		Horizons:       []wireProjectionHorizon{},
		Note: "DELTA-ONLY, book-wide: each horizon sums the additional interest the +" +
			strconv.FormatInt(sc.Projection.AnnualDeltaBps, 10) + "bps adds per position. A risk batch carries no borrow-APY observation and this service makes no chain calls, so the base accrual is absent; no time-to-liquidatable and no per-book liquidation count is published from this path — without the base rate any such figure would be optimistic. " +
			sanitize(sc.Projection.Note),
	}
	for _, horizon := range sc.Projection.HorizonsSeconds {
		debt, projected, interest := new(big.Int), new(big.Int), new(big.Int)
		any := false
		for _, rp := range run {
			if rp.row.Engine != engine || rp.input.DM == nil {
				continue
			}
			pr, err := risk.ProjectDMDebt(*rp.input.DM, delta, rp.row.BalancesBlock, horizon)
			if err != nil {
				continue
			}
			any = true
			debt.Add(debt, orZeroBigInt(pr.DebtUSD))
			projected.Add(projected, orZeroBigInt(pr.ProjectedUSD))
			interest.Add(interest, orZeroBigInt(pr.InterestUSD))
		}
		if !any && len(run) > 0 {
			continue
		}
		out.Horizons = append(out.Horizons, wireProjectionHorizon{
			HorizonSeconds:        horizon,
			DebtUSD:               debt.String(),
			ProjectedUSD:          projected.String(),
			AdditionalInterestUSD: interest.String(),
			// A single boolean cannot honestly summarize per-position
			// liquidatability over a book, and the delta-only basis would make
			// any such claim optimistic — so it is null here, never guessed.
			BecomesLiquidatable: nil,
		})
	}
	return out, nil
}

// heldFlatKey is the dedup identity of ONE held-flat row: the mark, where it
// lives, who sourced it and what it was held at. The set-run's
// `shock_reach.held_flat_marks` is `len` of a set keyed by this function and the
// single route's `held_flat` array is deduplicated by it too, so Test Law 2's
// `held_flat_marks == len(held_flat)` mapping is an identity rather than a
// coincidence.
func heldFlatKey(w wireHeldFlat) string {
	return w.Asset + "|" + strconv.FormatUint(w.ChainID, 10) + "|" + w.Source + "|" + w.Value
}

func appliedShockKey(w wireAppliedShock) string {
	return w.Asset + "|" + strconv.FormatUint(w.ChainID, 10) + "|" + w.Source + "|" +
		w.FactorNum + "/" + w.FactorDen + "|" + w.Before + ">" + w.After + "|" +
		strconv.FormatBool(w.Snapped) + strconv.FormatBool(w.BaseSnapped) + strconv.FormatBool(w.CapBound)
}

func sortedKeys[V any](m map[string]V) []string {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	return keys
}
