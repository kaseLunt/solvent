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
}

type wireRunBookEngine struct {
	Engine                string               `json:"engine"`
	UsdDecimals           uint8                `json:"usd_decimals"`
	Before                wireRunBookAggregate `json:"before"`
	After                 wireRunBookAggregate `json:"after"`
	NewlyEligibleAccounts int                  `json:"newly_eligible_accounts"`
	EligibleDebtDeltaUSD  string               `json:"eligible_debt_delta_usd"`
	BadDebtDeltaUSD       string               `json:"bad_debt_delta_usd"`
	Shortfall             *wireShortfall       `json:"market_realization"`
	Projection            *wireProjection      `json:"projection"`
	Note                  string               `json:"note"`
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
}

func newRunMeasure() *runMeasure {
	return &runMeasure{
		totalCollateral: new(big.Int), totalDebt: new(big.Int),
		eligibleDebt: new(big.Int), collateralAtRisk: new(big.Int), badDebt: new(big.Int),
	}
}

func (m *runMeasure) wire() wireRunBookAggregate {
	return wireRunBookAggregate{
		Accounts:            m.accounts,
		EligibleAccounts:    m.eligibleAccounts,
		TotalCollateralUSD:  m.totalCollateral.String(),
		TotalDebtUSD:        m.totalDebt.String(),
		EligibleDebtUSD:     m.eligibleDebt.String(),
		CollateralAtRiskUSD: m.collateralAtRisk.String(),
		BadDebtUSD:          m.badDebt.String(),
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
	for _, p := range v.Positions {
		if p.input == nil {
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
					heldFlatSet[wh.Asset+"|"+strconv.FormatUint(wh.ChainID, 10)+"|"+wh.Source+"|"+wh.Value] = wh
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
		we := wireRunBookEngine{
			Engine:                engine,
			UsdDecimals:           dec,
			Before:                eb.wire(),
			After:                 ea.wire(),
			NewlyEligibleAccounts: ea.eligibleAccounts - eb.eligibleAccounts,
			EligibleDebtDeltaUSD:  new(big.Int).Sub(ea.eligibleDebt, eb.eligibleDebt).String(),
			BadDebtDeltaUSD:       new(big.Int).Sub(ea.badDebt, eb.badDebt).String(),
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
		case risk.DMEngine:
			h, err := risk.ComputeDMHealth(*pos.DM)
			if err != nil {
				return nil, err
			}
			m := measureOf(risk.DMEngine)
			m.accounts++
			m.totalCollateral.Add(m.totalCollateral, orZeroBigInt(h.CollateralValueUSD))
			m.totalDebt.Add(m.totalDebt, orZeroBigInt(h.Borrowings))
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
