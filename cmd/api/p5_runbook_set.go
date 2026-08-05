package main

// POST /v1/scenarios/run-book-set — N COMMITTED scenarios evaluated against ONE
// resolved batch, contract 1.7.0.
//
// # Why this exists rather than a batch pin on the per-scenario route
//
// The expensive term is the batch read plus the reconstruction, and it is
// scenario-INVARIANT: `/v1/meta`, which performs the same `readBatch` +
// `reconstructAll` and then only cheap queries, costs about as much as a whole
// run-book. N sequential run-books pay that term N times for no additional
// information, and — measured — a serial sweep of the committed set straddles a
// batch boundary about half the time, which is exactly the condition the web's
// cohort machinery exists to REFUSE. Refusing a comparison is not the same as
// being able to answer it.
//
// So the batch is resolved ONCE, inside ONE `BeginRiskSnapshot`, and every
// scenario is measured against it. The cross-scenario sentence is true by the
// SHAPE of the response — one batch, one census, one envelope, N results —
// rather than assembled client-side out of N independently resolved bodies.
//
// # The before side is shared, and that is sound rather than convenient
//
// `risk.Waterfall` accumulates strictly through `engineOf(m.engine, ...)` and
// `measureRunBook`'s walk is strictly per position, keyed by `pos.Engine`. An
// engine's outputs therefore never depend on another engine's rows, so ONE
// before measure over the union of the requested scenarios' covered engines can
// be sliced per engine per scenario. `TestSetRunEqualsNSingleRunsAtTheSameBatch`
// and `TestSetRunBeforeSideIsScenarioInvariant` are what pin that claim; the
// structural argument is why it is expected to hold.
//
// # Union-scoped before, scenario-scoped after
//
// `measureRunBook` and `risk.Waterfall` both return on the FIRST bad position,
// and any such refusal is a 500 for the whole set. Measuring the WHOLE book
// would therefore let a defective position on an engine NO requested scenario
// covers refuse a set-run that N single runs would each have served. The shared
// measure is scoped to `⋃ sc.Engines` minus withheld engines, and each after
// measure is scoped to its own scenario's covered, non-withheld engines.
//
// # It writes nothing
//
// `TestAPIIssuesNoWritingSQL` sweeps this package and covers this file with no
// change. POST is a statement about request semantics — the evaluation is
// computed on demand over the whole book — never about mutation.

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math/big"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/ethereum/go-ethereum/common"

	"github.com/kaselunt/solvent/internal/risk"
	"github.com/kaselunt/solvent/internal/store"
)

// setRunPath is the ONE path this route answers on, spelled once.
//
// Three segments, so it cannot collide with `POST /v1/scenarios/{id}/run-book`
// (four) or `GET /v1/scenarios` (two). `/v1/scenarios/set/run-book` was
// considered and REJECTED: it would satisfy the existing `isRunBookPath`, but
// `set` matches `^[a-z0-9_]{1,64}$` and is therefore a legal committed-scenario
// id. Reserving a word out of the id space is a trap that fires the day someone
// commits a scenario called `set`.
const setRunPath = "/v1/scenarios/run-book-set"

const (
	// maxSetRunScenarios bounds ONE request: its worst-case latency and its
	// memory. It sits above today's committed 15 with headroom and below
	// defaultRateBurst 40, which the startup check enforces so no legal request
	// is permanently unservable.
	maxSetRunScenarios = 24
	// setRunTokenCostPerScenario is the limiter charge per scenario. The
	// existing limiter counts REQUESTS, so a cost-blind bucket would let one
	// client turn burst-40 into 960 scenario evaluations.
	setRunTokenCostPerScenario = 1
	// setRunMaxBodyBytes bounds the request body. 24 ids of 64 characters plus
	// JSON overhead is under 2 KiB.
	setRunMaxBodyBytes = 8 << 10
	// defaultMaxInflightSetRuns bounds the DEPLOYMENT. The server sets no
	// WriteTimeout and no ReadTimeout (deliberately, so SSE is not severed), so
	// nothing else bounds how many multi-second reconstructed books are resident
	// at once. Overridable by SOLVENT_API_MAX_INFLIGHT_SET_RUNS and published on
	// /v1/meta's constants: policy discoverable rather than folklore.
	defaultMaxInflightSetRuns = 2
)

// setRunBurstInvariant is the CONFIG check, applied at startup and failing
// fast.
//
// `rate.Limiter.ReserveN` returns `!res.OK()` when n exceeds the burst, so an
// operator who lowers `SOLVENT_API_RATE_BURST` below the per-request cap makes a
// LEGAL request permanently unservable — and the 429 it gets carries no
// meaningful retry instant, because that bucket never refills enough to admit
// it. That is a configuration error, and it is said at boot rather than
// discovered in production.
func setRunBurstInvariant(rateBurst int) error {
	need := maxSetRunScenarios * setRunTokenCostPerScenario
	if rateBurst >= need {
		return nil
	}
	return fmt.Errorf(
		"api: rate burst %d is below the set-run cap: POST %s admits up to %d scenarios and charges %d token per "+
			"scenario, so a full request costs %d tokens and this bucket could never admit one. Raise "+
			"SOLVENT_API_RATE_BURST to at least %d",
		rateBurst, setRunPath, maxSetRunScenarios, setRunTokenCostPerScenario, need, need)
}

// codeSetRunBusy is a NEW refusal code on its OWN body type, which is exactly
// the `BatchSupersededBody` precedent and its stated reason. `ErrorBody`'s code
// enum is UNTOUCHED.
//
// A client told only "503" cannot distinguish an overloaded evaluator from an
// empty book, and a client told "429" is told it exceeded a rate it did not
// exceed — `web/lib/runbook.ts` discards the envelope message on that arm, so
// the distinguishing prose would never be read. The distinguishability has to be
// STRUCTURAL, in the body, or it does not exist.
const codeSetRunBusy = "set_run_busy"

// The four freshness arms. The derivation compares two ORDERED ids, and an id
// compared against another has FOUR outcomes, not three: null, equal, greater
// and LESS.
const (
	freshnessStillNewest   = "still_newest"
	freshnessSuperseded    = "superseded"
	freshnessNewestIsOlder = "newest_is_older"
	freshnessNoneServable  = "none_servable"
)

// The engine-absence vocabulary: WHY a covered, non-withheld engine carries
// nothing measurable. Each is a NAMED absence and none of them draws a row of
// zeros.
const (
	absenceNoPositions    = "no_positions_in_batch"
	absenceAllRefused     = "all_positions_refused_in_batch"
	absenceAllUnrebuild   = "all_positions_unrebuildable"
	absenceMixedNoMeasure = "mixed_no_measurable_positions"
)

// The movement-rule discriminator, served as an ENUM rather than left to prose
// so a renderer picks its sentence from the wire instead of parsing a note.
// `runBookMovers` genuinely counts two different things, and one field named
// `flipped_to_eligible` cannot carry both.
const (
	movementHFStrictlyDropped = "hf_strictly_dropped"
	movementEligibilityFlip   = "eligibility_flipped_false_to_true"
)

// ---------------------------------------------------------------------------
// Wire shapes
// ---------------------------------------------------------------------------

type setRunRequest struct {
	ScenarioIDs []string `json:"scenario_ids"`
}

// wireSetRunHeldFlatAsset is ONE mark the propagation matrix never described,
// by the identity the matrix lookup itself is keyed on. Sealed: an identity that
// admits extra properties is not one. It carries no `source` and no `value` —
// those are the single-scenario route's job and it remains where a reader goes
// for them.
type wireSetRunHeldFlatAsset struct {
	ChainID uint64 `json:"chain_id"`
	Asset   string `json:"asset"`
}

type wireSetRunShockReach struct {
	DeclaredShocks           int    `json:"declared_shocks"`
	DeclaredShocksAtIdentity int    `json:"declared_shocks_at_identity"`
	Reach                    string `json:"reach"`

	AppliedShocks []wireAppliedShock `json:"applied_shocks"`
	MarksMoved    int                `json:"marks_moved"`

	MarksHeldByDeclaredFactor int `json:"marks_held_by_declared_factor"`
	MarksHeldByTransform      int `json:"marks_held_by_transform"`
	MarksHeldByArithmetic     int `json:"marks_held_by_arithmetic"`

	MarksSnapped     int `json:"marks_snapped"`
	MarksBaseSnapped int `json:"marks_base_snapped"`
	MarksCapBound    int `json:"marks_cap_bound"`

	HeldFlatMarks  int                       `json:"held_flat_marks"`
	HeldFlatAssets []wireSetRunHeldFlatAsset `json:"held_flat_assets"`
	Note           string                    `json:"note"`
}

// AppliedRows is `len(applied_shocks)`, named because it is the denominator of
// the cause partition and reads badly as a `len()` inside a sentence.
func (r wireSetRunShockReach) AppliedRows() int { return len(r.AppliedShocks) }

type wireSetRunEngineSummary struct {
	Engine       string `json:"engine"`
	UsdDecimals  uint8  `json:"usd_decimals"`
	MovementRule string `json:"movement_rule"`

	Accounts                 int `json:"accounts"`
	InfiniteAccounts         int `json:"infinite_accounts"`
	MovementExcludedAccounts int `json:"movement_excluded_accounts"`
	RefusedInBatchPositions  int `json:"refused_in_batch_positions"`
	UnrebuildablePositions   int `json:"unrebuildable_positions"`

	BeforeEligibleAccounts int  `json:"before_eligible_accounts"`
	AfterEligibleAccounts  int  `json:"after_eligible_accounts"`
	EligibleAccountsDelta  int  `json:"eligible_accounts_delta"`
	FlippedToEligible      *int `json:"flipped_to_eligible"`
	HFDroppedAccounts      *int `json:"hf_dropped_accounts"`

	BeforeEligibleDebtUSD string `json:"before_eligible_debt_usd"`
	EligibleDebtDeltaUSD  string `json:"eligible_debt_delta_usd"`
	BeforeBadDebtUSD      string `json:"before_bad_debt_usd"`
	BadDebtDeltaUSD       string `json:"bad_debt_delta_usd"`

	BeforeCollateralAtRiskUSD string `json:"before_collateral_at_risk_usd"`
	AfterCollateralAtRiskUSD  string `json:"after_collateral_at_risk_usd"`

	TotalDebtUSDBefore       string `json:"total_debt_usd_before"`
	TotalDebtUSDAfter        string `json:"total_debt_usd_after"`
	TotalCollateralUSDBefore string `json:"total_collateral_usd_before"`
	TotalCollateralUSDAfter  string `json:"total_collateral_usd_after"`

	Shortfall  *wireShortfall  `json:"market_realization"`
	Projection *wireProjection `json:"projection"`
	Note       string          `json:"note"`
}

type wireSetRunAbsenceCounts struct {
	PositionsInBatch int `json:"positions_in_batch"`
	RefusedInBatch   int `json:"refused_in_batch"`
	Unrebuildable    int `json:"unrebuildable"`
}

type wireSetRunEngineAbsence struct {
	Engine string                  `json:"engine"`
	Reason string                  `json:"reason"`
	Counts wireSetRunAbsenceCounts `json:"counts"`
	Note   string                  `json:"note"`
}

type wireSetRunScenarioResult struct {
	ScenarioID      string      `json:"scenario_id"`
	ScenarioVersion string      `json:"scenario_version"`
	Label           string      `json:"label"`
	PathAssumption  string      `json:"path_assumption"`
	Shocks          []wireShock `json:"shocks"`

	ShockReach wireSetRunShockReach `json:"shock_reach"`

	CoveredEngines      []string                  `json:"covered_engines"`
	WithheldEngines     []string                  `json:"withheld_engines"`
	UnmeasurableEngines []wireSetRunEngineAbsence `json:"unmeasurable_engines"`
	Engines             []wireSetRunEngineSummary `json:"engines"`

	PositionsAnswered int    `json:"positions_answered"`
	PositionsWithheld int    `json:"positions_withheld"`
	Note              string `json:"note"`
}

type wireSetRunEngineCensus struct {
	Engine           string `json:"engine"`
	PositionsInBatch int    `json:"positions_in_batch"`
	Measurable       int    `json:"measurable"`
	RefusedInBatch   int    `json:"refused_in_batch"`
	Unrebuildable    int    `json:"unrebuildable"`
	Withheld         bool   `json:"withheld"`
}

// wireSetRunCoverage is a NEW component rather than the shared `BookCoverage`,
// and the reason is not fastidiousness. `BookCoverage` is sealed and its
// description binds `in_book` to "what reached the derived arithmetic", which on
// the single-scenario route is RUN-scoped — it is `len(beforeInputs)` and
// therefore differs per scenario. This census is BOOK-scoped. Reusing the
// component would give one generated type two meanings depending on which
// endpoint produced it, which is the defect this surface is trying to remove
// rather than relocate.
type wireSetRunCoverage struct {
	BatchPositions      int            `json:"batch_positions"`
	InBook              int            `json:"in_book"`
	RefusedInBatch      int            `json:"refused_in_batch"`
	ExcludedByThisLayer int            `json:"excluded_by_this_layer"`
	Excluded            []wireExcluded `json:"excluded"`
	// BookIsMeasurable deliberately does NOT reuse the name
	// `stress_coverage_is_full`, whose computation does not consider
	// `in_book == 0` and would read GREEN over an unmeasurable book.
	BookIsMeasurable bool                     `json:"book_is_measurable"`
	Engines          []wireSetRunEngineCensus `json:"engines"`
	Note             string                   `json:"note"`
}

// wireSetRunEvaluation carries NO `batch_id`, and that is a correction rather
// than an omission: the contract's own re-clock vocabulary is exactly
// {batch_id, computed_at, bucket_start}, so a block REQUIRING `batch_id` IS a
// re-clock by that law. `batch.id` is one field away on the same object.
type wireSetRunEvaluation struct {
	ResolvedAt            time.Time `json:"resolved_at"`
	ProbedAt              time.Time `json:"probed_at"`
	ScenariosEvaluated    int       `json:"scenarios_evaluated"`
	Freshness             string    `json:"freshness"`
	NewestServableBatchID *int64    `json:"newest_servable_batch_id"`
	Note                  string    `json:"note"`
}

type runBookSetResponse struct {
	ServedAt              time.Time                  `json:"served_at"`
	Batch                 wireBatch                  `json:"batch"`
	Evaluation            wireSetRunEvaluation       `json:"evaluation"`
	ScenarioConfigVersion string                     `json:"scenario_config_version"`
	RequestedScenarioIDs  []string                   `json:"requested_scenario_ids"`
	Results               []wireSetRunScenarioResult `json:"results"`
	ExcludedEngines       []wireEngineRefusal        `json:"excluded_engines"`
	Coverage              wireSetRunCoverage         `json:"coverage"`
	Notes                 []string                   `json:"notes"`
}

type setRunBusyDetail struct {
	Code        string `json:"code"`
	Message     string `json:"message"`
	MaxInFlight int    `json:"max_in_flight"`
	InFlight    int    `json:"in_flight"`
}

type setRunBusyBody struct {
	Error setRunBusyDetail `json:"error"`
}

// ---------------------------------------------------------------------------
// The in-flight bound
// ---------------------------------------------------------------------------

// setRunGate is a NON-BLOCKING counting semaphore. A request that cannot acquire
// is refused IMMEDIATELY rather than queued, so no connection is held waiting
// and worst-case latency stays the single-request bound.
type setRunGate struct {
	mu       sync.Mutex
	inFlight int
	max      int
}

func newSetRunGate(max int) *setRunGate { return &setRunGate{max: max} }

// acquire takes a slot if one is free. It returns the gauge as it stood at the
// refusal, which is what the busy body publishes.
func (g *setRunGate) acquire() (ok bool, inFlight, max int) {
	g.mu.Lock()
	defer g.mu.Unlock()
	if g.inFlight >= g.max {
		return false, g.inFlight, g.max
	}
	g.inFlight++
	return true, g.inFlight, g.max
}

func (g *setRunGate) release() {
	g.mu.Lock()
	defer g.mu.Unlock()
	if g.inFlight > 0 {
		g.inFlight--
	}
}

// gauge reports the live count (tests, and nothing else).
func (g *setRunGate) gauge() int {
	g.mu.Lock()
	defer g.mu.Unlock()
	return g.inFlight
}

// ---------------------------------------------------------------------------
// Request decoding and validation — ALL of it before any compute
// ---------------------------------------------------------------------------

// decodeSetRunRequest reads the body under an 8 KiB bound with
// DisallowUnknownFields, and writes its own 400 on every failure.
//
// The strictness is new discipline in this package — no handler here read a
// request body before — and it is not fussiness. A client that sends
// `{"scenarios": [...]}` must be told the FIELD NAME is wrong, not handed a 400
// about an empty set: that second 400 reads as "you asked for nothing", which is
// a different and false statement about what the client did.
func decodeSetRunRequest(w http.ResponseWriter, r *http.Request) (setRunRequest, bool) {
	var req setRunRequest
	r.Body = http.MaxBytesReader(w, r.Body, setRunMaxBodyBytes)
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()

	if err := dec.Decode(&req); err != nil {
		var tooLarge *http.MaxBytesError
		switch {
		case errors.As(err, &tooLarge):
			writeError(w, http.StatusBadRequest, codeBadRequest,
				"the request body exceeds "+strconv.Itoa(setRunMaxBodyBytes)+" bytes: this endpoint takes a JSON object carrying "+
					"`scenario_ids`, at most "+strconv.Itoa(maxSetRunScenarios)+" committed ids, which is under 2 KiB", nil)
		case errors.Is(err, io.EOF):
			writeError(w, http.StatusBadRequest, codeBadRequest,
				"the request body is absent: POST "+setRunPath+" requires a JSON object carrying `scenario_ids`, "+
					"the committed ids to evaluate against ONE batch. There is no implicit \"all\"", nil)
		case strings.Contains(err.Error(), "unknown field"):
			writeError(w, http.StatusBadRequest, codeBadRequest,
				"the request body carries a field this endpoint does not accept ("+err.Error()+"): the ONLY field is "+
					"`scenario_ids`. This is refused by name rather than served as an empty set, because a 400 about an "+
					"empty set would say you asked for nothing when you asked for something under the wrong name", nil)
		default:
			writeError(w, http.StatusBadRequest, codeBadRequest,
				"the request body is not a JSON object carrying `scenario_ids`: "+err.Error(), nil)
		}
		return req, false
	}
	// THE BODY MUST END. Anything after the object is a body this endpoint did
	// not read whole, and reading half a request is how a client's second thought
	// gets silently dropped.
	//
	// The check is a second Decode that must reach io.EOF, and `dec.More()` is
	// NOT that check. `More` answers "is there another ELEMENT in the array or
	// object I am streaming", so it returns FALSE at a next byte of `}` or `]`:
	// `{"scenario_ids":["eth_minus_10"]}}` walked past it and was served a 200
	// over a body whose tail nobody read. EOF is the only tail this endpoint
	// accepts, and the decoder skips trailing whitespace on its way there, so a
	// body ending in a newline still passes.
	var trailing json.RawMessage
	if err := dec.Decode(&trailing); !errors.Is(err, io.EOF) {
		writeError(w, http.StatusBadRequest, codeBadRequest,
			"the request body does not end after its one JSON object: this endpoint reads exactly one object carrying "+
				"`scenario_ids`, and anything following it — a second object, a stray `}` or `]`, any other token — means "+
				"the body was not read whole. Trailing whitespace is fine; trailing bytes are not", nil)
		return req, false
	}
	return req, true
}

// validateSetRunIDs applies the SHAPE rules, in order, and writes its own 400.
// Every offending id is named — a refusal that names one of three offenders
// makes the client discover the other two by resubmitting.
func validateSetRunIDs(w http.ResponseWriter, ids []string) bool {
	if len(ids) == 0 {
		writeError(w, http.StatusBadRequest, codeBadRequest,
			"`scenario_ids` is missing or empty: there is no implicit \"all\" on this endpoint. A request whose meaning "+
				"changes when the committed set grows is a request the client cannot reason about, and a link built on it "+
				"would silently mean something different tomorrow. Name the ids you want, from GET /v1/scenarios", nil)
		return false
	}
	if len(ids) > maxSetRunScenarios {
		writeError(w, http.StatusBadRequest, codeBadRequest,
			"`scenario_ids` carries "+strconv.Itoa(len(ids))+" ids and this endpoint evaluates at most "+
				strconv.Itoa(maxSetRunScenarios)+" in one request: the bound is what makes this request's worst-case "+
				"latency and memory statable. Split the set", nil)
		return false
	}
	var malformed []string
	for _, id := range ids {
		if !runBookIDPattern.MatchString(id) {
			malformed = append(malformed, strconv.Quote(sanitize(id)))
		}
	}
	if len(malformed) > 0 {
		writeError(w, http.StatusBadRequest, codeBadRequest,
			"scenario id must match ^[a-z0-9_]{1,64}$; these do not: "+strings.Join(malformed, ", "), nil)
		return false
	}
	seen := map[string]int{}
	for _, id := range ids {
		seen[id]++
	}
	var repeats []string
	for _, id := range ids {
		if seen[id] > 1 {
			seen[id] = 0
			repeats = append(repeats, strconv.Quote(id))
		}
	}
	if len(repeats) > 0 {
		writeError(w, http.StatusBadRequest, codeBadRequest,
			"`scenario_ids` repeats "+strings.Join(repeats, ", ")+": a set is a set. A repeat doubles the cost of the "+
				"request and breaks the membership law that `results[].scenario_id` and `requested_scenario_ids` are the "+
				"same multiset, which is the one line a client can check to know nothing was hidden", nil)
		return false
	}
	return true
}

// ---------------------------------------------------------------------------
// The census — POSITIVE classification, and a refusal for anything else
// ---------------------------------------------------------------------------

type setRunEngineCensusRow struct {
	engine           string
	positionsInBatch int
	measurable       int
	refusedInBatch   int
	unrebuildable    int
	withheld         bool
}

type setRunCensus struct {
	batchPositions      int
	inBook              int
	refusedInBatch      int
	excludedByThisLayer int
	excluded            []wireExcluded
	byEngine            map[string]*setRunEngineCensusRow
}

// setRunCensusOf classifies EVERY position row of the batch POSITIVELY into
// exactly three classes, and REFUSES THE WHOLE REQUEST on anything else.
//
// # The exactness claim has to be earned, not asserted
//
// `batch_positions == in_book + refused_in_batch + excluded_by_this_layer` is
// only true if every row lands in exactly one cell, and nothing beneath the Go
// constant enforces the status vocabulary: the column is bare `TEXT NOT NULL`
// with the vocabulary in a COMMENT, `WriteRiskBatch` binds `p.Status`
// unvalidated, and `reconstructAll` skips a non-computed row WITHOUT setting
// `reconstructionErr`. So a row persisted with a third token would be counted by
// `batch_positions` (which is `len(positions)`) and by NONE of the other three —
// and the served body would then claim a green census while having dropped a
// row. That is the silent-hole class this whole surface exists to refuse,
// arrived at through an equality a document asserted instead of enforcing.
//
// Each arm is therefore the POSITIVE predicate of the counter it feeds, never
// the negation of another — the same shape, and the same reason, as
// `classifyUnmeasured`. The two must stay in step.
//
// Hardening the WRITE path (a CHECK constraint on the column, or validation in
// `WriteRiskBatch`) is worth doing and would make this refusal arm PROVABLY
// dead. It is a follow-on and not a precondition: a census whose correctness
// depends on a constraint in another layer is a census that is correct by
// assumption.
func setRunCensusOf(v *batchView, withheld map[string]bool) (*setRunCensus, error) {
	c := &setRunCensus{
		batchPositions: len(v.Positions),
		excluded:       []wireExcluded{},
		byEngine:       map[string]*setRunEngineCensusRow{},
	}
	rowFor := func(engine string) *setRunEngineCensusRow {
		row := c.byEngine[engine]
		if row == nil {
			row = &setRunEngineCensusRow{engine: engine, withheld: withheld[engine]}
			c.byEngine[engine] = row
		}
		return row
	}
	// A WITHHELD engine may carry zero positions (the collateral-flag replay
	// produces exactly that shape), so its census row is created from the
	// AGGREGATE vector too. An engine named nowhere is an engine a reader cannot
	// ask about.
	for _, a := range v.Aggregates {
		rowFor(a.Engine)
	}
	for _, p := range v.Positions {
		row := rowFor(p.Engine)
		row.positionsInBatch++
		switch {
		case p.Status == store.RiskPositionComputed && p.reconstructionErr == "" && p.input != nil:
			c.inBook++
			row.measurable++
		case p.Status == store.RiskPositionRefused && p.reconstructionErr == "" && p.input == nil:
			c.refusedInBatch++
			row.refusedInBatch++
		case p.Status == store.RiskPositionComputed && p.reconstructionErr != "" && p.input == nil:
			c.excludedByThisLayer++
			row.unrebuildable++
			c.excluded = append(c.excluded, wireExcluded{
				Engine:  p.Engine,
				Account: common.BytesToAddress(p.Account).Hex(),
				Code:    refusalReconstruction,
				Reason:  sanitize(p.reconstructionErr),
			})
		default:
			rebuilt := "no reconstructed input"
			if p.input != nil {
				rebuilt = "a reconstructed input"
			}
			return nil, fmt.Errorf("run-book-set: %s account %s carries status %q with reconstruction error %q and %s; "+
				"NO CELL of this census can hold it. `batch_positions` counts it, while `in_book`, `refused_in_batch` and "+
				"`excluded_by_this_layer` each test a POSITIVE predicate it fails, so `batch_positions == in_book + "+
				"refused_in_batch + excluded_by_this_layer` would be FALSE on a served 200 and the response would drop a "+
				"row while publishing a census saying nothing was dropped. The whole request is refused rather than served "+
				"beside a census that does not describe this book",
				p.Engine, common.BytesToAddress(p.Account).Hex(), sanitize(p.Status), sanitize(p.reconstructionErr), rebuilt)
		}
	}
	return c, nil
}

// wire renders the census, engines sorted by name.
func (c *setRunCensus) wire() wireSetRunCoverage {
	out := wireSetRunCoverage{
		BatchPositions:      c.batchPositions,
		InBook:              c.inBook,
		RefusedInBatch:      c.refusedInBatch,
		ExcludedByThisLayer: c.excludedByThisLayer,
		Excluded:            c.excluded,
		Engines:             []wireSetRunEngineCensus{},
		Note: "THIS CENSUS IS BOOK-SCOPED, not run-scoped: `in_book` is every position THIS LAYER rebuilt over the WHOLE batch, " +
			"whatever any scenario's model reaches — which is why it is a different component from /v1/book's `coverage`, whose " +
			"`in_book` counts one run. Every position row is classified by the POSITIVE predicate of the counter it feeds, into " +
			"exactly one of three classes, so `batch_positions == in_book + refused_in_batch + excluded_by_this_layer` EXACTLY; a " +
			"row matching none of them refuses the whole request with a named 500 rather than being served under an equality it " +
			"breaks. `refused_in_batch` is riskd's own refusals, served per row by /v1/positions and /v1/address/{addr}; " +
			"`excluded_by_this_layer` is rows this service could not rebuild or verify, listed in `excluded`. Neither is ever " +
			"reconciled against a run-book histogram's `refused_count`, which counts a WIDER population (both of these plus " +
			"rebuilt rows carrying no comparator) under a label naming only the third.",
	}
	names := make([]string, 0, len(c.byEngine))
	for e := range c.byEngine {
		names = append(names, e)
	}
	sort.Strings(names)
	withheldAny := false
	for _, e := range names {
		row := c.byEngine[e]
		withheldAny = withheldAny || row.withheld
		out.Engines = append(out.Engines, wireSetRunEngineCensus{
			Engine:           row.engine,
			PositionsInBatch: row.positionsInBatch,
			Measurable:       row.measurable,
			RefusedInBatch:   row.refusedInBatch,
			Unrebuildable:    row.unrebuildable,
			Withheld:         row.withheld,
		})
	}
	// `in_book == 0` is a real and legal state (a batch whose positions are all
	// refused), and `stress_coverage_is_full` would read GREEN over it. This
	// predicate accounts for it, which is the whole reason it does not reuse
	// that name.
	out.BookIsMeasurable = out.InBook > 0 && out.ExcludedByThisLayer == 0 && !withheldAny
	return out
}

func (c *setRunCensus) row(engine string) setRunEngineCensusRow {
	if r := c.byEngine[engine]; r != nil {
		return *r
	}
	return setRunEngineCensusRow{engine: engine}
}

// ---------------------------------------------------------------------------
// Freshness
// ---------------------------------------------------------------------------

// setRunFreshness derives the arm from the probed id by a TOTAL four-way
// comparison. There is no `otherwise` arm, and the trailing return is a refusal
// rather than a fourth-and-a-half case: an `otherwise` is how "Batch M has since
// materialized" gets served about a batch OLDER than the measurement.
func setRunFreshness(newest *int64, measured int64) (string, error) {
	switch {
	case newest == nil:
		return freshnessNoneServable, nil
	case *newest == measured:
		return freshnessStillNewest, nil
	case *newest > measured:
		return freshnessSuperseded, nil
	case *newest < measured:
		return freshnessNewestIsOlder, nil
	}
	return "", fmt.Errorf("freshness: batch %d compared against a newest-servable id that is neither absent, "+
		"equal, greater nor less; the comparison of two ordered integers has no fifth outcome, so this is a defect "+
		"in this layer rather than a state of the database", measured)
}

// setRunFreshnessNote is the arm's OWN sentence. Each arm gets exactly one, and
// the `newest_is_older` sentence never claims a materialization.
func setRunFreshnessNote(arm string, measured int64, newest *int64) string {
	m := strconv.FormatInt(measured, 10)
	n := ""
	if newest != nil {
		n = strconv.FormatInt(*newest, 10)
	}
	switch arm {
	case freshnessStillNewest:
		return "Batch " + m + " was STILL the newest complete servable batch at `probed_at`. That is what was true when this " +
			"response was built, never a promise about the reader's present."
	case freshnessSuperseded:
		return "Every scenario here was evaluated against batch " + m + ", resolved once at `resolved_at`, so the comparison " +
			"across scenarios is exact and cross-scenario reading is sound. Batch " + n + " has SINCE MATERIALIZED: these " +
			"numbers describe batch " + m + " and not the current head of the book."
	case freshnessNewestIsOlder:
		return "Every scenario here was evaluated against batch " + m + ", resolved once at `resolved_at`, when " + m +
			" satisfied the completeness predicate. At `probed_at` the newest batch satisfying that predicate was " + n +
			", which is OLDER than " + m + ": batch " + m + " no longer satisfies it. These numbers are a real measurement " +
			"of batch " + m + " taken while it was servable, and a re-run now would answer on batch " + n + ", an OLDER book."
	case freshnessNoneServable:
		return "At `probed_at` NO batch satisfied the completeness predicate, batch " + m + " included. These numbers are a " +
			"real measurement of batch " + m + ", taken when it WAS servable. Nothing newer has replaced it: there is " +
			"currently nothing to replace it with, and a re-run now would answer 503."
	}
	return ""
}

// ---------------------------------------------------------------------------
// The handler
// ---------------------------------------------------------------------------

func (s *server) handleRunBookSet(w http.ResponseWriter, r *http.Request) {
	// 1. DECODE, 2. SHAPE, 3. MEMBERSHIP — all before any compute, any slot and
	// any per-scenario token. A malformed or unknown-id request can therefore
	// neither hold a slot nor cost N tokens.
	req, ok := decodeSetRunRequest(w, r)
	if !ok {
		return
	}
	if !validateSetRunIDs(w, req.ScenarioIDs) {
		return
	}
	var unknown []string
	scenarios := make([]risk.Scenario, 0, len(req.ScenarioIDs))
	for _, id := range req.ScenarioIDs {
		sc, found := s.byID[id]
		if !found {
			unknown = append(unknown, strconv.Quote(id))
			continue
		}
		scenarios = append(scenarios, sc)
	}
	if len(unknown) > 0 {
		writeError(w, http.StatusNotFound, codeNotFound,
			"no committed scenario "+strings.Join(unknown, ", ")+": this endpoint evaluates the COMMITTED scenario set only "+
				"(the same set GET /v1/scenarios publishes and /v1/address/{addr}/stress serves), never arbitrary user scenarios. "+
				"The WHOLE set is refused rather than partly served: a comparison missing a member it was asked for is not the "+
				"comparison that was asked for, and serving the rest under a shared envelope would leave the absence unnamed.", nil)
		return
	}

	// 4. THE REMAINING TOKEN CHARGE. The middleware already charged 1 for this
	// request, as it does for every request; the handler charges the rest, so
	// the total is exactly one token per scenario. A refused charge has already
	// spent the middleware's token, which is honest: the request really did cost
	// a decode and a membership check.
	if extra := len(req.ScenarioIDs)*setRunTokenCostPerScenario - 1; extra > 0 {
		if allowed, wait := s.limiter.allowN(clientKey(r), extra); !allowed {
			s.writeRateLimited(w, wait, ", and a set-run costs "+strconv.Itoa(setRunTokenCostPerScenario)+
				" token per scenario. This request asked for "+strconv.Itoa(len(req.ScenarioIDs))+".")
			return
		}
	}

	// 5. ACQUIRE, THEN READ. The order matters for exactly one reason:
	// `errNoBatch` is raised INSIDE `readBatchAccounts`, so the 503 for "no
	// complete servable batch" is raised while the slot is HELD. That is the
	// leak path, and the `defer` established here is what closes it — on the
	// 200, on the 500, on that 503, and on a panic.
	acquired, inFlight, maxInFlight := s.setRuns.acquire()
	if !acquired {
		s.writeSetRunBusy(w, inFlight, maxInFlight)
		return
	}
	defer s.setRuns.release()

	// TEST SEAM (nil in production): fired while the slot is held and before the
	// batch read, so a test can hold one request inside the arithmetic while a
	// second observes the refusal, and can panic to exercise the release.
	if s.setRunInterleave != nil {
		if p := s.setRunInterleave.Load(); p != nil && *p != nil {
			(*p)()
		}
	}

	// 6. ONE RESOLUTION: one BeginRiskSnapshot, one SELECT now(), one batch, all
	// child rows. Nothing tears, and every scenario below measures the same
	// positions of the same batch at the same instant.
	v, err := s.readBatch(r.Context(), nil)
	if err != nil {
		serveReadError(w, err)
		return
	}
	refusals := engineRefusals(v)
	withheld := map[string]bool{}
	for _, ref := range refusals {
		withheld[ref.Engine] = true
	}

	// 7. THE CENSUS, FAIL-CLOSED, BEFORE ANY ARITHMETIC. A row it cannot
	// classify refuses the whole request: this is a property of the BOOK rather
	// than of the arithmetic, which is why the blast-radius invariant is scoped
	// to arithmetic 500s.
	census, err := setRunCensusOf(v, withheld)
	if err != nil {
		writeError(w, http.StatusInternalServerError, codeInternal, err.Error(), nil)
		return
	}

	// 8. ONE BEFORE MEASURE, UNION-SCOPED.
	union := map[string]bool{}
	for _, sc := range scenarios {
		for _, e := range sc.Engines {
			if !withheld[e] {
				union[e] = true
			}
		}
	}
	unionBook := make([]risk.PositionInput, 0, census.inBook)
	unionRows := make([]runPos, 0, census.inBook)
	for _, p := range v.Positions {
		if p.input == nil || !union[p.Engine] {
			continue
		}
		unionRows = append(unionRows, runPos{row: p, input: *p.input})
		unionBook = append(unionBook, *p.input)
	}
	before, err := s.measureRunBook(unionBook)
	if err != nil {
		writeError(w, http.StatusInternalServerError, codeInternal,
			"measuring the unshocked book refused: "+err.Error(), nil)
		return
	}

	usdDecimals := map[string]uint8{}
	for _, a := range v.Aggregates {
		usdDecimals[a.Engine] = a.ValueDecimals
	}

	// 9. PER SCENARIO, IN REQUEST ORDER, OVER THAT SCENARIO'S OWN BOOK.
	results := make([]wireSetRunScenarioResult, 0, len(scenarios))
	for _, sc := range scenarios {
		res, err := s.setRunResult(sc, v, unionRows, before, census, withheld, usdDecimals)
		if err != nil {
			writeError(w, http.StatusInternalServerError, codeInternal, err.Error(), nil)
			return
		}
		results = append(results, res)
	}

	// 10. ONE FRESHNESS PROBE, ONE STATEMENT, AFTER the arithmetic.
	newest, probedAt, err := s.store.NewestServableBatchAt(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, codeInternal,
			"the freshness probe refused: "+err.Error(), nil)
		return
	}
	arm, err := setRunFreshness(newest, v.Batch.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, codeInternal, err.Error(), nil)
		return
	}

	out := runBookSetResponse{
		ServedAt: v.Now,
		Batch:    batchEnvelope(v),
		Evaluation: wireSetRunEvaluation{
			ResolvedAt:            v.Now,
			ProbedAt:              probedAt,
			ScenariosEvaluated:    len(results),
			Freshness:             arm,
			NewestServableBatchID: newest,
			Note:                  setRunFreshnessNote(arm, v.Batch.ID, newest),
		},
		ScenarioConfigVersion: s.scenarioConfigVersion(),
		RequestedScenarioIDs:  append([]string(nil), req.ScenarioIDs...),
		Results:               results,
		ExcludedEngines:       refusals,
		Coverage:              census.wire(),
		Notes:                 setRunEnvelopeNotes(),
	}
	writeJSON(w, out)
}

// setRunEnvelopeNotes is the invariant prose that is identical on every row,
// stated ONCE. Repeating a per-engine paragraph on every engine of every result
// is about 17 KB of identical text in a fifteen-scenario response, and it is
// also how a reader learns to stop reading notes.
func setRunEnvelopeNotes() []string {
	return []string{
		"ONE BATCH: every result here was measured against the single `batch` above, resolved once inside one database " +
			"snapshot before any arithmetic ran. Cross-scenario comparison is therefore exact by the SHAPE of this response " +
			"rather than by a client-side check over N independently resolved bodies.",
		"aggregates are per engine in each engine's OWN unit and decimals; they are never summed, averaged or plotted on one " +
			"axis across engines. `usd_decimals` on each engine row is that engine's scale.",
		"deltas are DELTA-ONLY: after minus before, the scenario's own contribution over that scenario's own covered, " +
			"non-withheld book. The sanctioned denominator is `total_debt_usd_before`; the after side is a different book " +
			"and a ratio against it answers a question this surface does not ask.",
		"`out_of_model` is deliberately NOT carried here: it is published verbatim and versioned on GET /v1/scenarios, which " +
			"a client necessarily already has (that is where these ids came from), and `scenario_id` + `scenario_version` + " +
			"`scenario_config_version` make the join exact. READING A SHOCKED NUMBER WITHOUT IT IS READING IT WRONG.",
		"`coverage` is a census of the whole BATCH, not of any one run: it is a different component from /v1/book's " +
			"`coverage` for exactly that reason. `shock_reach` on each result says whether the declared shock reached a mark " +
			"at all and, when it did not, WHICH cause held it — a zero delta on this surface always carries a published cause.",
	}
}

// writeSetRunBusy refuses the concurrency overflow with 503, its OWN code and
// its own body — and NO `Retry-After`.
//
// 429 was considered and rejected: `web/lib/runbook.ts` discards the envelope
// message on that arm, so a client that has sent one request in ten minutes
// would be told, in the only words it reads, that it exceeded a rate it did not
// exceed. And the `Retry-After` a token bucket computes (`res.DelayFrom(now)`,
// the instant THAT BUCKET refills) means nothing for a semaphore: the holder may
// have twelve more seconds of arithmetic left and this goroutine does not know
// it. So no retry instant is offered rather than one invented — the same
// discipline as `newest_servable_batch_id` being null rather than 0.
func (s *server) writeSetRunBusy(w http.ResponseWriter, inFlight, maxInFlight int) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(http.StatusServiceUnavailable)
	_ = json.NewEncoder(w).Encode(setRunBusyBody{Error: setRunBusyDetail{
		Code: codeSetRunBusy,
		Message: sanitize("this deployment evaluates at most " + strconv.Itoa(maxInFlight) + " set-runs concurrently and " +
			strconv.Itoa(inFlight) + " are running. The request was refused immediately rather than queued, so no connection " +
			"is held waiting. Nothing here computes when a slot frees, so no Retry-After is offered rather than one invented. " +
			"This is a statement about the evaluator's capacity and about nothing in the book: the batch is fine."),
		MaxInFlight: maxInFlight,
		InFlight:    inFlight,
	}})
}

// ---------------------------------------------------------------------------
// One scenario's result
// ---------------------------------------------------------------------------

func (s *server) setRunResult(
	sc risk.Scenario,
	v *batchView,
	unionRows []runPos,
	before map[string]*runMeasure,
	census *setRunCensus,
	withheld map[string]bool,
	usdDecimals map[string]uint8,
) (wireSetRunScenarioResult, error) {
	covered := append([]string(nil), sc.Engines...)
	sort.Strings(covered)

	scoped := map[string]bool{}
	withheldNames := []string{}
	for _, e := range covered {
		if withheld[e] {
			withheldNames = append(withheldNames, e)
			continue
		}
		scoped[e] = true
	}

	// THIS SCENARIO'S OWN BOOK: the union filtered to the engines this scenario
	// covers and the batch did not withhold. Everything below is scoped to it,
	// including the after-side `risk.Waterfall` inside `measureRunBook`.
	run := make([]runPos, 0, len(unionRows))
	beforeInputs := make([]risk.PositionInput, 0, len(unionRows))
	for _, rp := range unionRows {
		if !scoped[rp.row.Engine] {
			continue
		}
		run = append(run, rp)
		beforeInputs = append(beforeInputs, rp.input)
	}

	afterInputs := make([]risk.PositionInput, 0, len(run))
	appliedSet := map[string]wireAppliedShock{}
	heldFlatSet := map[string]wireHeldFlat{}
	if sc.Projection == nil {
		for _, rp := range run {
			shocked, err := risk.ApplyScenario(rp.input, sc)
			if err != nil {
				// Inputs here are reconstruction-VERIFIED; a refusal is a defect
				// in this layer, not a property of the data.
				return wireSetRunScenarioResult{}, fmt.Errorf("applying scenario %s refused a verified position: %w", sc.ID, err)
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
		// A PROJECTION moves no spot state: the after side IS the before side,
		// and no ApplyScenario pass runs at all.
		afterInputs = beforeInputs
	}
	after, err := s.measureRunBook(afterInputs)
	if err != nil {
		return wireSetRunScenarioResult{}, fmt.Errorf("measuring the shocked book for scenario %s refused: %w", sc.ID, err)
	}

	var shortfall *risk.ShortfallResult
	if len(sc.MarketRealizations) > 0 {
		sf, err := risk.ExecutionShortfall(beforeInputs, sc.MarketRealizationsFor())
		if err != nil {
			return wireSetRunScenarioResult{}, fmt.Errorf("execution shortfall for scenario %s refused: %w", sc.ID, err)
		}
		shortfall = &sf
	}

	res := wireSetRunScenarioResult{
		ScenarioID:          sc.ID,
		ScenarioVersion:     sc.Version,
		Label:               sanitize(sc.Label),
		PathAssumption:      sanitize(sc.PathAssumption),
		Shocks:              []wireShock{},
		CoveredEngines:      covered,
		WithheldEngines:     withheldNames,
		UnmeasurableEngines: []wireSetRunEngineAbsence{},
		Engines:             []wireSetRunEngineSummary{},
	}
	if res.WithheldEngines == nil {
		res.WithheldEngines = []string{}
	}
	for _, sh := range sc.Shocks {
		res.Shocks = append(res.Shocks, wireShock{
			Axis: string(sh.Axis), Asset: sh.Asset, FactorNum: sh.FactorNum, FactorDen: sh.FactorDen,
		})
	}

	reach, err := setRunShockReach(sc, appliedSet, heldFlatSet)
	if err != nil {
		return wireSetRunScenarioResult{}, err
	}
	res.ShockReach = reach

	notCovered := map[string]bool{}
	for engine, row := range census.byEngine {
		if row.positionsInBatch > 0 && !covers(sc.Engines, engine) {
			notCovered[engine] = true
		}
	}

	for _, engine := range covered {
		if withheld[engine] {
			res.PositionsWithheld += census.row(engine).measurable
			continue
		}
		eb, ea := before[engine], after[engine]
		row := census.row(engine)
		if eb == nil || eb.accounts == 0 {
			// A NAMED ABSENCE, never a numeric row. An engine with nothing
			// measurable would otherwise fall through to `newRunMeasure()` and
			// draw every `before_*`, every delta and the DENOMINATOR at "0",
			// under a census claiming full coverage.
			res.UnmeasurableEngines = append(res.UnmeasurableEngines, setRunAbsence(engine, row))
			continue
		}
		if ea == nil {
			return wireSetRunScenarioResult{}, fmt.Errorf("run-book-set: scenario %s measured %d %s accounts on the before "+
				"side and none on the after side; the two sides describe different books and every delta over them would be "+
				"a difference of two different measurements", sc.ID, eb.accounts, engine)
		}
		dec, ok := usdDecimals[engine]
		if !ok {
			dec = uint8(engineValueDecimals[engine])
		}
		summary, err := s.setRunEngineSummary(sc, v, run, engine, dec, eb, ea, row, shortfall)
		if err != nil {
			return wireSetRunScenarioResult{}, err
		}
		res.PositionsAnswered += summary.Accounts
		res.Engines = append(res.Engines, summary)
	}

	res.Note = setRunResultNote(sc, res, notCovered)
	return res, nil
}

// setRunAbsence names a covered, non-withheld engine that carries nothing
// measurable, WITH the counts behind the reason.
func setRunAbsence(engine string, row setRunEngineCensusRow) wireSetRunEngineAbsence {
	reason := absenceMixedNoMeasure
	switch {
	case row.positionsInBatch == 0:
		reason = absenceNoPositions
	case row.refusedInBatch == row.positionsInBatch:
		reason = absenceAllRefused
	case row.unrebuildable == row.positionsInBatch:
		reason = absenceAllUnrebuild
	}
	notes := map[string]string{
		absenceNoPositions: "this engine carries NO position row in this batch at all, so there is nothing on it to measure. " +
			"It draws no bar and serves no denominator: an engine with zero measurable accounts is a named absence, never a row of zeros.",
		absenceAllRefused: "every position this engine carries in this batch was REFUSED by riskd, so none of them reached any " +
			"arithmetic here. Their persisted rows and refusal codes are served by /v1/positions and /v1/address/{addr}. " +
			"This engine draws no bar and serves no denominator.",
		absenceAllUnrebuild: "every position this engine carries in this batch is one THIS LAYER could not rebuild or verify; " +
			"each is listed by account in `coverage.excluded`. This engine draws no bar and serves no denominator.",
		absenceMixedNoMeasure: "this engine carries positions in this batch and NONE of them reached the arithmetic — some " +
			"refused by riskd, some unrebuildable by this layer, in the counts beside this. It draws no bar and serves no denominator.",
	}
	return wireSetRunEngineAbsence{
		Engine: engine,
		Reason: reason,
		Counts: wireSetRunAbsenceCounts{
			PositionsInBatch: row.positionsInBatch,
			RefusedInBatch:   row.refusedInBatch,
			Unrebuildable:    row.unrebuildable,
		},
		Note: notes[reason],
	}
}

// setRunShockReach reduces this scenario's own applied and held-flat sets to the
// reach component, with both censuses and the arm.
func setRunShockReach(sc risk.Scenario, appliedSet map[string]wireAppliedShock, heldFlatSet map[string]wireHeldFlat) (wireSetRunShockReach, error) {
	out := wireSetRunShockReach{
		DeclaredShocks: len(sc.Shocks),
		AppliedShocks:  []wireAppliedShock{},
		HeldFlatMarks:  len(heldFlatSet),
		HeldFlatAssets: setRunHeldFlatAssets(heldFlatSet),
	}
	for _, sh := range sc.Shocks {
		if sh.FactorNum == sh.FactorDen {
			out.DeclaredShocksAtIdentity++
		}
	}
	for _, k := range sortedKeys(appliedSet) {
		a := appliedSet[k]
		out.AppliedShocks = append(out.AppliedShocks, a)
		if a.Snapped {
			out.MarksSnapped++
		}
		if a.BaseSnapped {
			out.MarksBaseSnapped++
		}
		if a.CapBound {
			out.MarksCapBound++
		}
		if a.Before != a.After {
			out.MarksMoved++
			continue
		}
		switch setRunHeldCause(a) {
		case heldByDeclaredFactor:
			out.MarksHeldByDeclaredFactor++
		case heldByTransform:
			out.MarksHeldByTransform++
		default:
			out.MarksHeldByArithmetic++
		}
	}
	// THE PARTITION IS CHECKED, not asserted about. `marks_moved` plus the three
	// cause counts must be exactly `len(applied_shocks)`, and a body whose own
	// arithmetic does not close is not served.
	if sum := out.MarksMoved + out.MarksHeldByDeclaredFactor + out.MarksHeldByTransform + out.MarksHeldByArithmetic; sum != out.AppliedRows() {
		return wireSetRunShockReach{}, fmt.Errorf("shock reach for scenario %s: %d moved plus %d held by the declared factor "+
			"plus %d held by a transform plus %d held by arithmetic is %d, against %d applied rows; those four counts are a "+
			"PARTITION of the applied set and a response whose cause attribution does not close is a response that attributes "+
			"a cause to nothing", sc.ID, out.MarksMoved, out.MarksHeldByDeclaredFactor, out.MarksHeldByTransform,
			out.MarksHeldByArithmetic, sum, out.AppliedRows())
	}
	arm, err := setRunShockReachArm(setRunReachFacts{
		HasProjection:            sc.Projection != nil,
		DeclaredShocks:           len(sc.Shocks),
		DeclaredShocksAtIdentity: out.DeclaredShocksAtIdentity,
		AppliedRows:              out.AppliedRows(),
		MarksMoved:               out.MarksMoved,
	})
	if err != nil {
		return wireSetRunShockReach{}, err
	}
	out.Reach = arm
	out.Note = setRunShockReachNote(arm, sc, out)
	return out, nil
}

// setRunEngineSummary reduces ONE (scenario, engine) to the summary.
func (s *server) setRunEngineSummary(
	sc risk.Scenario,
	v *batchView,
	run []runPos,
	engine string,
	dec uint8,
	eb, ea *runMeasure,
	row setRunEngineCensusRow,
	shortfall *risk.ShortfallResult,
) (wireSetRunEngineSummary, error) {
	_, moversTotal := runBookMovers(engine, eb, ea)
	excluded := runBookMovementExcluded(engine, eb, ea)

	out := wireSetRunEngineSummary{
		Engine:      engine,
		UsdDecimals: dec,

		Accounts:                 eb.accounts,
		InfiniteAccounts:         eb.infinite,
		MovementExcludedAccounts: excluded,
		RefusedInBatchPositions:  row.refusedInBatch,
		UnrebuildablePositions:   row.unrebuildable,

		BeforeEligibleAccounts: eb.eligibleAccounts,
		AfterEligibleAccounts:  ea.eligibleAccounts,
		EligibleAccountsDelta:  ea.eligibleAccounts - eb.eligibleAccounts,

		BeforeEligibleDebtUSD: orZeroString(eb.eligibleDebt),
		EligibleDebtDeltaUSD:  new(big.Int).Sub(orZeroBigInt(ea.eligibleDebt), orZeroBigInt(eb.eligibleDebt)).String(),
		BeforeBadDebtUSD:      orZeroString(eb.badDebt),
		BadDebtDeltaUSD:       new(big.Int).Sub(orZeroBigInt(ea.badDebt), orZeroBigInt(eb.badDebt)).String(),

		BeforeCollateralAtRiskUSD: orZeroString(eb.collateralAtRisk),
		AfterCollateralAtRiskUSD:  orZeroString(ea.collateralAtRisk),

		TotalDebtUSDBefore:       orZeroString(eb.totalDebt),
		TotalDebtUSDAfter:        orZeroString(ea.totalDebt),
		TotalCollateralUSDBefore: orZeroString(eb.totalCollateral),
		TotalCollateralUSDAfter:  orZeroString(ea.totalCollateral),
	}

	// EXACTLY ONE of the two movement counts is non-null on every row, selected
	// by the engine's own rule. `runBookMovers` counts eligibility flips on the
	// Debt Manager and STRICT health-factor drops on Aave, with no eligibility
	// test in the Aave branch at all — so a single field named
	// `flipped_to_eligible` filled from `movers_total` would publish a count of
	// health-factor drops under a label asserting that accounts entered
	// liquidation eligibility.
	total := moversTotal
	switch engine {
	case risk.AaveEngine:
		out.MovementRule = movementHFStrictlyDropped
		out.HFDroppedAccounts = &total
	default:
		out.MovementRule = movementEligibilityFlip
		out.FlippedToEligible = &total
	}

	if shortfall != nil {
		es, ok := shortfall.PerEngine[engine]
		if !ok {
			es = risk.EngineShortfall{Engine: engine, UsdDecimals: dec,
				ExecutionShortfallUSD: new(big.Int), BadDebtAtLiquidationUSD: new(big.Int)}
		}
		out.Shortfall = &wireShortfall{
			HFsUnchanged:            shortfall.HFsUnchanged,
			ExecutionShortfallUSD:   orZeroString(es.ExecutionShortfallUSD),
			BadDebtAtLiquidationUSD: orZeroString(es.BadDebtAtLiquidationUSD),
			UsdDecimals:             es.UsdDecimals,
			SeizureModel:            shortfall.SeizureModel,
			Note: "market value is NOT an oracle mark: this scenario moves NO health factor (`hfs_unchanged` asserts it, computed not promised). " +
				"The output is the gap the protocol is not seeing, under the disclosed seizure model.",
		}
	}
	if sc.Projection != nil && engine == risk.DMEngine {
		proj, err := s.runBookProjection(sc, v, run, engine)
		if err != nil {
			return wireSetRunEngineSummary{}, err
		}
		out.Projection = proj
	}
	out.Note = setRunEngineNote(engine, dec, out)
	return out, nil
}

// setRunEngineNote carries ONLY engine-specific clauses, and there are exactly
// five: this engine's decimals; its movement rule; the EXCLUDED POPULATION of
// that movement count, in the vocabulary the single route's `movers_note`
// already uses; the sanctioned denominator; and the collateral-at-risk warning.
// The prose that is identical on every row lives once, on the envelope.
func setRunEngineNote(engine string, dec uint8, e wireSetRunEngineSummary) string {
	d := strconv.Itoa(int(dec))
	denom := strconv.Itoa(e.Accounts - e.MovementExcludedAccounts)

	var rule, exclusion string
	if engine == risk.AaveEngine {
		rule = "`movement_rule` is hf_strictly_dropped: `hf_dropped_accounts` counts accounts whose HEALTH FACTOR STRICTLY " +
			"DROPPED under this scenario, and it is NOT a count of accounts that became eligible for liquidation. " +
			"`flipped_to_eligible` is null here because this engine does not speak it."
		exclusion = runBookAaveExclusionClause
	} else {
		rule = "`movement_rule` is eligibility_flipped_false_to_true: `flipped_to_eligible` counts eligibility flips FALSE " +
			"to TRUE only, so it is not `eligible_accounts_delta`, which is a NET and also subtracts any flip back to " +
			"healthy — five accounts flipping in and five flipping out is a net of 0 and is not \"nothing happened\". " +
			"`hf_dropped_accounts` is null here because the Debt Manager has no health-factor wad."
		exclusion = runBookDMExclusionClause
	}

	return "UNIT: every money figure on this row is an exact integer in THIS engine's own " + d + "-decimal USD and is never " +
		"summed, averaged or plotted on one axis with another engine's. " +
		rule + " " +
		"THE MOVEMENT COUNT'S DENOMINATOR IS `accounts` MINUS `movement_excluded_accounts` (" + strconv.Itoa(e.Accounts) +
		" minus " + strconv.Itoa(e.MovementExcludedAccounts) + " = " + denom + "), never `accounts`: " + exclusion + " " +
		"THE SANCTIONED DENOMINATOR is `total_debt_usd_before`. The share a reader may legitimately compute is " +
		"`eligible_debt_delta_usd` over `total_debt_usd_before` — this scenario's contribution as a fraction of the book as it " +
		"stands. Aave debt is PRICED and moves under a price shock, so `total_debt_usd_after` is a DIFFERENT book and a ratio " +
		"against it answers a different question. " +
		"COLLATERAL AT RISK is served as TWO SIDES and never as a delta: it carries no monotonicity invariant and legitimately " +
		"FALLS when already-crossed accounts are worth less, so a difference on that axis is not a ranking key and is not offered as one."
}

// setRunResultNote states what is true of this scenario's answer as a whole.
func setRunResultNote(sc risk.Scenario, res wireSetRunScenarioResult, notCovered map[string]bool) string {
	note := "IDENTITY: this result is scenario " + sc.ID + " at version " + sc.Version + ", under the envelope's " +
		"`scenario_config_version`. Join those three against GET /v1/scenarios for this scenario's `out_of_model`, which is " +
		"NOT carried here and without which a shocked number is being read wrong."

	if len(notCovered) > 0 {
		names := make([]string, 0, len(notCovered))
		for e := range notCovered {
			names = append(names, e)
		}
		sort.Strings(names)
		note += " NOT COVERED: " + strings.Join(names, ", ") + " carry rows in this batch and this scenario's committed " +
			"definition does not cover them, so they are absent from `covered_engines` entirely. That absence is by DEFINITION, " +
			"never withholding."
	}
	if len(res.WithheldEngines) > 0 {
		note += " WITHHELD ON THIS BATCH: " + strings.Join(res.WithheldEngines, ", ") + ". Those engines are covered by this " +
			"scenario and their whole book is refused on this batch, so they contribute NO row and NO zero here; the code and " +
			"detail for each are in the shared `excluded_engines`. Their reconstructable positions are counted in " +
			"`positions_withheld` and in no number on any engine row. `shock_reach.applied_shocks` is scoped to the same " +
			"non-withheld book, so it may be a strict SUBSET of what POST /v1/scenarios/{id}/run-book serves for this " +
			"scenario at this batch, which admits a withheld engine's positions into its pass."
	}
	if len(res.UnmeasurableEngines) > 0 {
		names := make([]string, 0, len(res.UnmeasurableEngines))
		for _, a := range res.UnmeasurableEngines {
			names = append(names, a.Engine)
		}
		note += " NOTHING MEASURABLE: " + strings.Join(names, ", ") + " are covered and not withheld and carry no measurable " +
			"position, so each is named in `unmeasurable_engines` with its reason and counts rather than drawn as a row of zeros."
	}
	if len(res.Engines) == 0 {
		note += " NO ANSWERABLE ENGINE: every engine this scenario covers is withheld or carries nothing measurable, so " +
			"`engines` is empty. This scenario WAS evaluated and it counts in `evaluation.scenarios_evaluated`; it draws no " +
			"bar, and that is an absence rather than a zero."
	}
	note += " SHOCK REACH: " + res.ShockReach.Note
	return note
}
