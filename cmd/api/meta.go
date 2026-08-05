package main

// The batch envelope every response carries, the three-leg supersession check,
// and /v1/meta.
//
// # Every age on this surface is DB-clock minus a durable stamp
//
// Design spec §10: "Lag/staleness always computed DB-clock vs durable stamps
// (never per-request RPC head — api makes zero RPC calls)". `batchView.Now` is
// `SELECT now()` read inside the same snapshot as the stamps it is subtracted
// from. This process's wall clock never appears in a served number: a container
// with a drifting clock would otherwise publish a freshness verdict that is a
// property of the container.

import (
	"context"
	"fmt"
	"math/big"
	"net/http"
	"sort"
	"strings"
	"time"

	"github.com/ethereum/go-ethereum/common"

	"github.com/kaselunt/solvent/internal/config"
	"github.com/kaselunt/solvent/internal/risk"
	"github.com/kaselunt/solvent/internal/riskfeed"
	"github.com/kaselunt/solvent/internal/store"
)

// The three supersession legs of design spec §4, named on the wire.
const (
	// legAckedEpochMoved — the engine's current acked_epoch differs from the one
	// stamped on the batch: a rewind happened and was acknowledged. This is the
	// PRUNE-IMMUNE leg: PruneAckedReorgEpochs deletes acked epochs, so
	// MAX(reorg_epochs.epoch) can return to its old value and last_block can
	// regain its old height after a re-walk — the ABA blindspot. Acks are
	// monotone, so this leg survives it (chain-truth R2).
	legAckedEpochMoved = "acked_epoch_moved"
	// legLastBlockRewound — the engine's current last_block is BELOW the stamped
	// one: a rewind is in progress.
	legLastBlockRewound = "last_block_rewound"
	// legUnackedEpoch — the chain has a recorded reorg epoch above the engine's
	// acked_epoch: derived state may describe deleted blocks.
	legUnackedEpoch = "unacked_epoch_recorded"
	// legCursorAbsent is NOT one of the spec's three legs. It is the fail-closed
	// answer to a stamped engine whose cursor no longer exists at all: the three
	// legs are comparisons, and a comparison with nothing cannot clear a batch.
	// Reported under its own name so it is never mistaken for a rewind.
	legCursorAbsent = "cursor_absent"
)

// supersessionNote is served alongside the verdict, because the flag's meaning is
// not self-evident: design spec §4 chose FLAG-AND-SERVE over refuse-at-demand-
// grade, and a reader has to know that.
const supersessionNote = "a superseded batch is still served: the flag is the contract and it heals at the next materializer pass (design spec §4). " +
	"The legs are evaluated against a LIVE read of the cursor and epoch tables inside the same snapshot as the database clock."

type wireSweepStamp struct {
	Rows           int64      `json:"rows"`
	Failed         int64      `json:"failed"`
	SuccessSum     string     `json:"success_sum"`
	MaxUpdatedAt   *time.Time `json:"max_updated_at"`
	AgeSeconds     *int64     `json:"age_seconds"`
	Generation     uint64     `json:"generation"`
	GenerationOpen bool       `json:"generation_open"`
}

type wireStamp struct {
	Engine            string          `json:"engine"`
	ChainID           int64           `json:"chain_id"`
	LastBlock         uint64          `json:"last_block"`
	AckedEpoch        int64           `json:"acked_epoch"`
	MaxEpochAtCompute int64           `json:"max_epoch_at_compute"`
	Sweep             *wireSweepStamp `json:"sweep"`
}

type wireSupersessionLeg struct {
	Leg               string  `json:"leg"`
	Engine            string  `json:"engine"`
	ChainID           int64   `json:"chain_id"`
	StampedLastBlock  uint64  `json:"stamped_last_block"`
	CurrentLastBlock  *uint64 `json:"current_last_block"`
	StampedAckedEpoch int64   `json:"stamped_acked_epoch"`
	CurrentAckedEpoch *int64  `json:"current_acked_epoch"`
	CurrentMaxEpoch   *int64  `json:"current_max_epoch"`
	Detail            string  `json:"detail"`
}

type wireSupersession struct {
	Superseded bool                  `json:"superseded"`
	Legs       []wireSupersessionLeg `json:"legs"`
	Note       string                `json:"note"`
}

type wireBatch struct {
	ID            int64     `json:"id"`
	ComputedAt    time.Time `json:"computed_at"`
	AgeSeconds    int64     `json:"age_seconds"`
	Producer      string    `json:"producer"`
	Status        string    `json:"status"`
	PositionCount int       `json:"position_count"`
	// RefusedCount counts refused POSITION ROWS, so it is ZERO when an engine is
	// withheld with no accounts behind it — the empty-and-unproven state the
	// collateral-flag replay's rewind window produces. RefusedEngines is what makes
	// that state visible on the summary itself.
	RefusedCount int `json:"refused_count"`
	// RefusedEngines names every engine whose WHOLE book is withheld on this batch.
	// It travels with the envelope, so no consumer of the envelope alone — REST or
	// SSE — can mistake a withheld engine for a healthy one.
	RefusedEngines []string         `json:"refused_engines"`
	FlaggedCount   int              `json:"flagged_count"`
	Watermarks     []wireStamp      `json:"watermarks"`
	Supersession   wireSupersession `json:"supersession"`
}

// batchEnvelope renders the batch header, its stamps and the supersession
// verdict. Every REST response and every SSE event carries it, so no served
// number can be read without the reorg posture that qualifies it.
func batchEnvelope(v *batchView) wireBatch {
	out := wireBatch{
		ID:             v.Batch.ID,
		ComputedAt:     v.Batch.ComputedAt.UTC(),
		AgeSeconds:     ageSeconds(v.Now, v.Batch.ComputedAt),
		Producer:       sanitize(v.Batch.Producer),
		Status:         v.Batch.Status,
		PositionCount:  v.Batch.PositionCount,
		RefusedCount:   v.Batch.RefusedCount,
		RefusedEngines: orEmpty(v.Batch.RefusedEngines),
		FlaggedCount:   v.Batch.FlaggedCount,
		Watermarks:     []wireStamp{},
	}
	for _, m := range v.Batch.Watermarks {
		out.Watermarks = append(out.Watermarks, wireStampFrom(v.Now, m))
	}
	out.Supersession = supersession(v)
	return out
}

// wireStampFrom renders one persisted engine stamp — cursor vector plus sweep
// stamp — for the wire. Shared by every surface that serves a watermark
// vector (the batch envelope, /v1/observatory's per-point vectors), so the
// Stamp shape cannot fork between them.
func wireStampFrom(now time.Time, m store.RiskBatchWatermark) wireStamp {
	return wireStamp{
		Engine:            m.Engine,
		ChainID:           m.ChainID,
		LastBlock:         m.LastBlock,
		AckedEpoch:        m.AckedEpoch,
		MaxEpochAtCompute: m.MaxEpochAtCompute,
		Sweep:             wireSweepFrom(now, m.Sweep),
	}
}

// wireSweepFrom renders a persisted sweep stamp, or nil for the DISCLOSED
// "this engine has no sweeper" absence. `age_seconds` is DB-now minus the
// stamp's own max_updated_at — the stamp itself is immutable evidence; only
// its age is measured at serve time.
func wireSweepFrom(now time.Time, s *store.RiskSweepWatermark) *wireSweepStamp {
	if s == nil {
		return nil
	}
	sw := &wireSweepStamp{
		Rows:           s.Rows,
		Failed:         s.Failed,
		SuccessSum:     orZeroString(s.SuccessSum),
		Generation:     s.Generation,
		GenerationOpen: s.GenerationOpen,
	}
	if s.HasUpdatedAt {
		t := s.MaxUpdatedAt.UTC()
		sw.MaxUpdatedAt = &t
		age := ageSeconds(now, t)
		sw.AgeSeconds = &age
	}
	return sw
}

// supersession runs the three legs of design spec §4 against the LIVE cursor and
// epoch state read in this request's snapshot.
//
// It is evaluated per STAMPED ENGINE, because supersession is a per-engine
// property: one chain's rewind does not invalidate the other chain's book, and a
// batch that cannot be judged for an engine must say so rather than pass.
func supersession(v *batchView) wireSupersession {
	cursors := map[string]store.DeriveCursorState{}
	for _, c := range v.Cursors {
		cursors[c.Engine] = c
	}
	out := wireSupersession{Legs: []wireSupersessionLeg{}, Note: supersessionNote}

	for _, m := range v.Batch.Watermarks {
		base := wireSupersessionLeg{
			Engine:            m.Engine,
			ChainID:           m.ChainID,
			StampedLastBlock:  m.LastBlock,
			StampedAckedEpoch: m.AckedEpoch,
		}
		cur, ok := cursors[m.Engine]
		if !ok {
			l := base
			l.Leg = legCursorAbsent
			l.Detail = "the batch stamped engine " + m.Engine + " but that cursor no longer exists: the three legs are comparisons, and a comparison with nothing cannot clear a batch"
			out.Legs = append(out.Legs, l)
			continue
		}
		curBlock, curEpoch := cur.LastBlock, cur.AckedEpoch
		base.CurrentLastBlock, base.CurrentAckedEpoch = &curBlock, &curEpoch
		if maxEpoch, has := v.MaxEpochs[cur.ChainID]; has {
			me := maxEpoch
			base.CurrentMaxEpoch = &me
		}

		// Leg 1 — acked_epoch moved. The prune-immune leg.
		if cur.AckedEpoch != m.AckedEpoch {
			l := base
			l.Leg = legAckedEpochMoved
			l.Detail = fmt.Sprintf("engine %s acknowledged epoch %d, the batch was computed at acked epoch %d — a rewind happened since",
				m.Engine, cur.AckedEpoch, m.AckedEpoch)
			out.Legs = append(out.Legs, l)
		}
		// Leg 2 — last_block below the stamp: a rewind in progress.
		if cur.LastBlock < m.LastBlock {
			l := base
			l.Leg = legLastBlockRewound
			l.Detail = fmt.Sprintf("engine %s is at block %d, below the batch's stamped %d — a rewind is in progress",
				m.Engine, cur.LastBlock, m.LastBlock)
			out.Legs = append(out.Legs, l)
		}
		// Leg 3 — a recorded epoch above the current ack.
		if maxEpoch, has := v.MaxEpochs[cur.ChainID]; has && maxEpoch > cur.AckedEpoch {
			l := base
			l.Leg = legUnackedEpoch
			l.Detail = fmt.Sprintf("chain %d has recorded reorg epoch %d, above engine %s's acked epoch %d — derived state may describe deleted blocks",
				cur.ChainID, maxEpoch, m.Engine, cur.AckedEpoch)
			out.Legs = append(out.Legs, l)
		}
	}
	sort.SliceStable(out.Legs, func(i, j int) bool {
		if out.Legs[i].Engine != out.Legs[j].Engine {
			return out.Legs[i].Engine < out.Legs[j].Engine
		}
		return out.Legs[i].Leg < out.Legs[j].Leg
	})
	out.Superseded = len(out.Legs) > 0
	return out
}

// ageSeconds is DB-now minus a durable stamp, floored at zero.
//
// The floor is deliberate: a stamp in the future is a clock or a restore
// anomaly, and publishing a NEGATIVE age would read as freshness. Zero reads as
// "as fresh as this surface can claim", which is the honest cap.
func ageSeconds(now, stamp time.Time) int64 {
	d := now.Sub(stamp)
	if d < 0 {
		return 0
	}
	return int64(d / time.Second)
}

func orZeroString(v *big.Int) string {
	if v == nil {
		return "0"
	}
	return v.String()
}

// ---------------------------------------------------------------------------
// /v1/meta
// ---------------------------------------------------------------------------

type wireCursor struct {
	Engine           string  `json:"engine"`
	ChainID          int64   `json:"chain_id"`
	LastBlock        uint64  `json:"last_block"`
	AckedEpoch       int64   `json:"acked_epoch"`
	CoveredFromBlock *uint64 `json:"covered_from_block"`
	DecoderRevision  int32   `json:"decoder_revision"`
	Consumed         bool    `json:"consumed_by_risk"`
}

type wireChainEpoch struct {
	ChainID  int64 `json:"chain_id"`
	MaxEpoch int64 `json:"max_epoch"`
}

type wirePriceState struct {
	ChainID     int64      `json:"chain_id"`
	Asset       string     `json:"asset"`
	Symbol      string     `json:"symbol"`
	Source      string     `json:"source"`
	OwnerEngine string     `json:"owner_engine"`
	Provenance  string     `json:"provenance"`
	Value       *string    `json:"value"`
	Decimals    int32      `json:"decimals"`
	BlockNumber uint64     `json:"block_number"`
	AnchorBlock *uint64    `json:"anchor_block"`
	ObservedAt  time.Time  `json:"observed_at"`
	SourceAsOf  *time.Time `json:"source_as_of"`
	// AgeSeconds is DB-now minus SOURCE_AS_OF, and is null when the row carries
	// none. `observed_at` is DB INSERT time and is NEVER substituted: serving it
	// as an as-of is fabricated freshness (design spec §7, Codex round 2 [NEW-H]).
	AgeSeconds *int64 `json:"age_seconds"`
	Valid      bool   `json:"valid"`
	// InvalidReason is the D-012 quarantine marker on the NEWEST row for this key.
	InvalidReason string `json:"invalid_reason"`
	// QuarantinedRows counts rows for this key that carry valid=false at ANY
	// height, so a quarantine stays visible after a newer valid poll lands above
	// it. D-012's whole point is that those rows are retained, never deleted.
	QuarantinedRows      int64   `json:"quarantined_rows"`
	HighestQuarantined   *uint64 `json:"highest_quarantined_block"`
	IsValuationWitness   bool    `json:"is_valuation_witness"`
	ValuationWitnessNote string  `json:"valuation_witness_note,omitempty"`
}

type wireNeutralized struct {
	OwnerEngine  string     `json:"owner_engine"`
	ChainID      int64      `json:"chain_id"`
	Rows         int64      `json:"rows"`
	Oldest       *time.Time `json:"oldest_observed_at"`
	Newest       *time.Time `json:"newest_observed_at"`
	HighestBlock uint64     `json:"highest_block"`
}

type wireSweepCounts struct {
	Engine string `json:"engine"`
	Rows   int64  `json:"rows"`
	// The three states of chain-truth R6.4, at the row level.
	NeverSwept        int64  `json:"never_swept"`
	FailedSinceSuccss int64  `json:"failed_since_success"`
	Success           int64  `json:"success"`
	Note              string `json:"note"`
}

type wireHeartbeat struct {
	ChainID          uint64 `json:"chain_id"`
	Symbol           string `json:"symbol"`
	Proxy            string `json:"proxy"`
	Aggregator       string `json:"aggregator"`
	HeartbeatSeconds int64  `json:"heartbeat_seconds"`
	GraceSeconds     int64  `json:"grace_seconds"`
	ProvenanceGrade  string `json:"provenance_grade"`
	// ObservedMaxGapSeconds and TestedBudgetSeconds are the empirical scan's own
	// numbers, published so a reader can see WHY a grade was assigned rather than
	// having to trust the label. Null when no scan has judged this feed.
	ObservedMaxGapSeconds *int64 `json:"observed_max_gap_seconds"`
	TestedBudgetSeconds   *int64 `json:"tested_budget_seconds"`
	// BudgetRefuted is the one-bit form of `provenance_grade ==
	// published-and-refuted`, so a consumer cannot miss a falsified budget by
	// failing to enumerate the grade vocabulary.
	BudgetRefuted bool   `json:"budget_refuted"`
	Basis         string `json:"basis"`
}

type wireConstants struct {
	ConfirmationBlocks int64 `json:"confirmation_blocks"`
	PricePollSeconds   int64 `json:"price_poll_seconds"`
	// The DM sweep bound of design spec §5.2: interval + pass duration. DM
	// collateral is sweep-dominated and every DM row carries this bound; a
	// 60s-fresh badge over hour-stale collateral is the banned rendering.
	DMSweepIntervalSeconds  int64   `json:"dm_sweep_interval_seconds"`
	DMSweepPassSeconds      int64   `json:"dm_sweep_pass_seconds"`
	DMSweepWorstCaseSeconds int64   `json:"dm_sweep_worst_case_seconds"`
	PriceBudgetSeconds      int64   `json:"price_budget_seconds"`
	PriceCeilingSeconds     int64   `json:"price_ceiling_seconds"`
	LargeStepBps            int64   `json:"large_price_step_bps"`
	RateLimitRPS            float64 `json:"rate_limit_requests_per_second"`
	RateLimitBurst          int     `json:"rate_limit_burst"`
	// The set-run policy, published so it is discoverable rather than folklore.
	// MaxSetRunScenarios bounds ONE request; SetRunTokenCostPerScenario is what
	// the limiter is charged per scenario (the bucket counts requests, so a
	// cost-blind charge would let one client turn the burst into 24 times as
	// many evaluations); MaxInflightSetRuns bounds the DEPLOYMENT and is the
	// SAME number `SetRunBusyBody.max_in_flight` carries, so a refused client
	// and a curious one read one figure.
	MaxSetRunScenarios         int    `json:"max_set_run_scenarios"`
	SetRunTokenCostPerScenario int    `json:"set_run_token_cost_per_scenario"`
	MaxInflightSetRuns         int    `json:"max_inflight_set_runs"`
	SSEHeartbeatSeconds        int64  `json:"sse_heartbeat_seconds"`
	Note                       string `json:"note"`
}

type wireService struct {
	Name                  string `json:"name"`
	Version               string `json:"version"`
	SchemaVersion         int64  `json:"schema_version"`
	AlgorithmRevision     int    `json:"algorithm_revision"`
	ScenarioConfigVersion string `json:"scenario_config_version"`
	RegistryFingerprint   string `json:"registry_fingerprint"`
	SeizureModel          string `json:"seizure_model"`
}

type wireMeta struct {
	ServedAt time.Time   `json:"served_at"`
	Service  wireService `json:"service"`
	Batch    *wireBatch  `json:"batch"`
	// BatchUnavailableReason is set when no complete batch exists. /v1/meta is the
	// one route that still answers 200 in that state — a status surface that goes
	// dark exactly when something is wrong is not a status surface.
	BatchUnavailableReason string `json:"batch_unavailable_reason,omitempty"`

	WatermarkVector []wireCursor     `json:"watermark_vector"`
	ReorgPosture    wireReorgPosture `json:"reorg_posture"`

	Prices             []wirePriceState  `json:"prices"`
	NeutralizedPrices  []wireNeutralized `json:"neutralized_prices"`
	Sweeps             []wireSweepCounts `json:"sweeps"`
	SweepNeverRefusals int               `json:"sweep_never_refusals_in_batch"`

	HeartbeatProvenance []wireHeartbeat `json:"heartbeat_provenance"`
	Constants           wireConstants   `json:"constants"`
	Disclosures         []string        `json:"disclosures"`
}

type wireReorgPosture struct {
	MaxEpochs  []wireChainEpoch      `json:"max_epochs"`
	Superseded bool                  `json:"superseded"`
	Legs       []wireSupersessionLeg `json:"legs"`
	LegNames   []string              `json:"leg_names"`
	Note       string                `json:"note"`
}

// standingDisclosures are served on /v1/meta verbatim. They are the contract's
// honest small print (design spec §7 single-view disclosure, §13 limitations),
// and they are on the wire rather than only in docs because a client rendering
// these numbers has to be able to render the caveats with them.
func (s *server) standingDisclosures() []string {
	return []string{
		"Prices are 60-second samples: intra-interval wicks are invisible BY CONSTRUCTION, and no surface here implies otherwise (D-012).",
		"There is exactly one price view per asset. For `priceproviderv2` inputs these numbers are exactly as manipulable as the Debt Manager itself — no more, no less; there is no second witness to disagree with.",
		"Debt Manager collateral is sweep-dominated: worst case " +
			fmt.Sprint(dmSweepIntervalSeconds+dmSweepPassSeconds) +
			" seconds behind, while its prices are 60 seconds. Never read a fresh price age as a fresh collateral age.",
		"`rate_indexes` is as-of-last-ReserveDataUpdated, so a debt leg's index can trail the balances cursor badly. Every leg carries its own index as-of block.",
		"Aave borrow-rate scenarios are excluded from the stress set (utilization-driven, residual dust book) and the Debt Manager rate axis is a labeled PROJECTION, never a spot health-factor shock.",
		"A price sample used by a batch and neutralized afterwards is invisible to the three supersession legs; the batch recomputes within one materializer cadence (design spec §4, D-012 class).",
		"Aave base values are 8-decimal and Debt Manager USD is 6-decimal. The two engines are NEVER summed into one number.",
		"Refused positions are served WITH their reason and are counted in every aggregate's refusal count. This surface never omits a position it could not compute.",
		"An ENGINE-scoped refusal withholds that engine's whole book even when it has no positions at all: its totals are served as null, never zero, and it is named in `batch.refused_engines`. A withheld engine is never representable as an empty healthy one.",
		"Three published feed heartbeats are REFUTED by empirical measurement, not merely unverified (see `heartbeat_provenance`: `budget_refuted`, with the observed maximum gap and the budget it was tested against). Their served freshness budgets must carry the OBSERVED bound; the published number is the friendlier one and using it would be a silent cap.",
		"This service makes zero RPC calls. Every age is the database clock minus a durable stamp, so nothing here is measured against a chain head observed at request time.",
	}
}

// Heartbeat provenance grades (design spec §7 BL-6). A closed vocabulary, and
// the ORDER of severity is the order they are declared in.
const (
	// heartbeatVerified — the budget's own value is independently evidenced AND an
	// empirical scan cleared it. NO FEED CURRENTLY HOLDS IT, deliberately: the
	// repo's own law is that a complete ledger's max gap is exact HISTORY and
	// cannot certify the future, so a scan never produces this grade on its own.
	heartbeatVerified = "verified"
	// heartbeatQualified — an empirical scan measured a maximum publication gap
	// that EXCEEDS the published heartbeat but sits within the declared operator
	// grace. The budget survives; the headroom does not.
	heartbeatQualified = "empirical-historical-with-qualifier"
	// heartbeatRefuted — an empirical scan measured a gap BEYOND heartbeat + grace.
	// The published budget is FALSIFIED. Reporting such a feed as merely
	// "awaiting confirmation" overstates provenance: the evidence is already in and
	// it is negative.
	heartbeatRefuted = "published-and-refuted"
	// heartbeatNotVerified — the published feed parameter, taken on trust, with no
	// scan behind it either way.
	heartbeatNotVerified = "published-not-verified"
)

// heartbeatGrades is the per-stream provenance grade, as the repo's record stands
// TODAY.
//
// These are COMMITTED FACTS OF THAT RECORD, not measurements this binary can take:
// the B3 empirical scan lives in `cmd/reconcile` and writes an ARTIFACT rather
// than a database table, so a serving path can only republish what the record
// says. What it must not do is round the record up. Three of these budgets are
// KNOWN-REFUTED — the scan measured gaps of 170,712s (FRAX), 248,460s (USDC) and
// 604,896s (PYUSD) against a tested budget of 90,000s — and grading them
// `published-not-verified` would tell an operator the evidence is outstanding when
// the evidence is in and it is negative. That is the silent-cap anti-canon with a
// friendlier label.
//
// The weETH/ETH leg carries a QUALIFIER, not a clean pass: its measured 3,732s
// maximum gap exceeds the published 3,600s heartbeat and survives only inside the
// declared 1,800s operator grace. The constructor evidence for the VALUE 3600 is a
// different claim from the scan's verdict on the BUDGET, and it is recorded in the
// basis rather than promoted into the grade.
//
// Keyed by the PROXY address, lowercased: the proxy is the stream's stable
// identity (Chainlink re-points aggregator() on phase changes).
//
// Owed forward, deliberately visible: the Task 6 acceptance run exits non-zero on
// these three refutations and lands feeds.json budget corrections under owner ack.
// When it does, the corrected budgets become the published ones and this table's
// refutations are re-derived against them. Until then this is the honest state.
var heartbeatGrades = map[string]struct {
	grade string
	// observedMaxGap is the scan's measured maximum publication interval, seconds.
	observedMaxGap int64
	// testedBudget is the budget the scan judged that gap against — heartbeat plus
	// the declared operator grace, seconds.
	testedBudget int64
	basis        string
}{
	// weETH / the ETH-USD leg behind the cap adapter.
	"0x5f4ec3df9cbd43714fe2740f5e3616155c5b8419": {
		grade: heartbeatQualified, observedMaxGap: 3732, testedBudget: 5400,
		basis: "B3 empirical scan: measured maximum publication gap 3732s EXCEEDS the published 3600s heartbeat and sits within the declared 1800s operator grace (tested budget 5400s) — a QUALIFIER, not a pass. " +
			"Separately, the VALUE 3600 is evidence-backed: deployed code was observed consuming this exact proxy with a 3600-second heartbeat (constructor evidence at 0x641169f048ee8de8b3037c9d9c840060fe03e463). " +
			"A complete ledger's max gap is exact HISTORY and cannot certify the future, so this is never graded `verified`.",
	},
	// USDC.
	"0x8fffffd4afb6115b954bd326cbe7b4ba576818f6": {
		grade: heartbeatRefuted, observedMaxGap: 248460, testedBudget: 90000,
		basis: "B3 empirical scan: the published budget is FALSIFIED — a measured 248460s publication interval against a tested budget of 90000s (86400s heartbeat + 3600s grace). " +
			"The served freshness budget must carry the OBSERVED bound; keeping the friendlier published number would be a silent cap.",
	},
	// PYUSD — weekly publication observed Apr–Jun 2024.
	"0x8f1df6d7f2db73eece86a18b4381f4707b918fb1": {
		grade: heartbeatRefuted, observedMaxGap: 604896, testedBudget: 90000,
		basis: "B3 empirical scan: the published budget is FALSIFIED — a measured 604896s (≈7 day) publication interval against a tested budget of 90000s (86400s heartbeat + 3600s grace). " +
			"The served freshness budget must carry the OBSERVED bound; keeping the friendlier published number would be a silent cap.",
	},
	// FRAX.
	"0xb9e1e3a9feff48998e45fa90847ed4d467e8bcfd": {
		grade: heartbeatRefuted, observedMaxGap: 170712, testedBudget: 90000,
		basis: "B3 empirical scan: the published budget is FALSIFIED — a measured 170712s publication interval against a tested budget of 90000s (86400s heartbeat + 3600s grace). " +
			"The served freshness budget must carry the OBSERVED bound; keeping the friendlier published number would be a silent cap.",
	},
}

const heartbeatGradeDefault = heartbeatNotVerified
const heartbeatBasisDefault = "the published Chainlink mainnet heartbeat for this feed; NOT independently confirmed from bytecode or from a consumer's constructor by this repo, and no empirical scan has judged it either way (recon/derivation-notes.md heartbeat-provenance table)"

func (s *server) handleMeta(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	out := wireMeta{
		Service: wireService{
			Name:                  "solvent-api",
			Version:               s.version,
			SchemaVersion:         s.schemaVersion,
			AlgorithmRevision:     riskfeed.AlgorithmRevision,
			ScenarioConfigVersion: s.scenarioConfigVersion(),
			RegistryFingerprint:   s.registry.Fingerprint(),
			SeizureModel:          risk.SeizureModelProRata,
		},
		Disclosures: s.standingDisclosures(),
		Constants: wireConstants{
			ConfirmationBlocks:         confirmationBlocks,
			PricePollSeconds:           pricePollSeconds,
			DMSweepIntervalSeconds:     dmSweepIntervalSeconds,
			DMSweepPassSeconds:         dmSweepPassSeconds,
			DMSweepWorstCaseSeconds:    dmSweepIntervalSeconds + dmSweepPassSeconds,
			PriceBudgetSeconds:         s.cfg.PriceBudgetSeconds,
			PriceCeilingSeconds:        2 * s.cfg.PriceBudgetSeconds,
			LargeStepBps:               s.cfg.StepBps,
			RateLimitRPS:               s.cfg.RateLimit,
			RateLimitBurst:             s.cfg.RateBurst,
			MaxSetRunScenarios:         maxSetRunScenarios,
			SetRunTokenCostPerScenario: setRunTokenCostPerScenario,
			MaxInflightSetRuns:         s.cfg.MaxInflightSetRuns,
			SSEHeartbeatSeconds:        int64(s.cfg.SSEHeartbeat / time.Second),
			Note: "every value here is a POLICY OF THIS DEPLOYMENT or a published cadence, not a measurement. " +
				"The price ceiling is 2x the budget (design spec §7, R = 2 x T_f): an input past it is REFUSED rather than served stale.",
		},
	}

	// The batch is optional on this route ONLY.
	v, err := s.readBatch(ctx, nil)
	switch {
	case err == nil:
		env := batchEnvelope(v)
		out.Batch = &env
		out.ServedAt = v.Now
		out.WatermarkVector = s.wireCursors(v)
		out.ReorgPosture = wireReorgPosture{
			MaxEpochs:  wireEpochs(v.MaxEpochs),
			Superseded: env.Supersession.Superseded,
			Legs:       env.Supersession.Legs,
			LegNames:   []string{legAckedEpochMoved, legLastBlockRewound, legUnackedEpoch},
			Note:       supersessionNote,
		}
		for _, p := range v.Positions {
			if p.RefusalCode == riskfeed.GateSweepNever {
				out.SweepNeverRefusals++
			}
		}
	case errorsIsNoBatch(err):
		out.BatchUnavailableReason = "no complete risk batch is available yet: either the materializer has not run, or every batch present fails the completeness predicate and is therefore unservable"
		now, cursors, epochs, cerr := s.readVectorOnly(ctx)
		if cerr != nil {
			writeError(w, http.StatusInternalServerError, codeInternal, cerr.Error(), nil)
			return
		}
		out.ServedAt = now
		// Explicit empty slices, never nil: the contract declares these arrays
		// required and non-nullable, and `null` where a client expects `[]` is a
		// crash in the client rather than an honest "nothing here".
		out.WatermarkVector = []wireCursor{}
		for _, c := range cursors {
			out.WatermarkVector = append(out.WatermarkVector, s.wireCursor(now, c))
		}
		out.ReorgPosture = wireReorgPosture{
			MaxEpochs: wireEpochs(epochs),
			Legs:      []wireSupersessionLeg{},
			LegNames:  []string{legAckedEpochMoved, legLastBlockRewound, legUnackedEpoch},
			Note:      "no batch to judge: the legs are comparisons against a batch's stamps, and there is no servable batch.",
		}
	default:
		writeError(w, http.StatusInternalServerError, codeInternal, err.Error(), nil)
		return
	}

	prices, err := s.readPriceState(ctx, out.ServedAt)
	if err != nil {
		writeError(w, http.StatusInternalServerError, codeInternal, err.Error(), nil)
		return
	}
	out.Prices = prices

	out.NeutralizedPrices = s.readNeutralized(ctx)

	sweeps, err := s.readSweepCounts(ctx)
	if err != nil {
		writeError(w, http.StatusInternalServerError, codeInternal, err.Error(), nil)
		return
	}
	out.Sweeps = sweeps
	out.HeartbeatProvenance = s.heartbeatProvenance()

	writeJSON(w, out)
}

func (s *server) wireCursors(v *batchView) []wireCursor {
	out := make([]wireCursor, 0, len(v.Cursors))
	for _, c := range v.Cursors {
		out = append(out, s.wireCursor(v.Now, c))
	}
	return out
}

func (s *server) wireCursor(now time.Time, c store.DeriveCursorState) wireCursor {
	consumed := false
	for _, e := range s.consumedEngines() {
		if e == c.Engine {
			consumed = true
			break
		}
	}
	return wireCursor{
		Engine:           c.Engine,
		ChainID:          c.ChainID,
		LastBlock:        c.LastBlock,
		AckedEpoch:       c.AckedEpoch,
		CoveredFromBlock: c.CoveredFromBlock,
		DecoderRevision:  c.DecoderRevision,
		Consumed:         consumed,
	}
}

func wireEpochs(m map[int64]int64) []wireChainEpoch {
	out := make([]wireChainEpoch, 0, len(m))
	for chain, epoch := range m {
		out = append(out, wireChainEpoch{ChainID: chain, MaxEpoch: epoch})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].ChainID < out[j].ChainID })
	return out
}

// readVectorOnly reads the cursor vector and the epoch maxima with the database
// clock, for the no-batch case.
func (s *server) readVectorOnly(ctx context.Context) (time.Time, []store.DeriveCursorState, map[int64]int64, error) {
	tx, err := s.store.BeginRiskSnapshot(ctx)
	if err != nil {
		return time.Time{}, nil, nil, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	var now time.Time
	if err := tx.QueryRow(ctx, `SELECT now()`).Scan(&now); err != nil {
		return time.Time{}, nil, nil, fmt.Errorf("read database clock: %w", err)
	}
	cursors, err := store.DeriveCursorStates(ctx, tx)
	if err != nil {
		return time.Time{}, nil, nil, err
	}
	epochs, err := store.MaxReorgEpochs(ctx, tx)
	if err != nil {
		return time.Time{}, nil, nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return time.Time{}, nil, nil, fmt.Errorf("commit vector snapshot: %w", err)
	}
	return now.UTC(), cursors, epochs, nil
}

// readPriceState reads the newest `prices` row per (chain, asset, source) for
// every asset in the committed feed registry, plus that key's quarantine census.
//
// SCOPE IS THE REGISTRY, deliberately: an unbounded scan of a
// forever-growing table is not a status surface, and an asset outside the
// registry cannot value anything here. The valuation witnesses are flagged as
// such, so a reader can see which rows the engines actually charge against and
// which are reference/observatory surfaces (design spec §7's uncapped-feed rule).
func (s *server) readPriceState(ctx context.Context, now time.Time) ([]wirePriceState, error) {
	type assetKey struct {
		chain uint64
		asset common.Address
	}
	symbols := map[assetKey]string{}
	var chains []int64
	var assets [][]byte
	seen := map[assetKey]bool{}
	for _, f := range s.feeds.Assets {
		k := assetKey{f.ChainID, f.Address}
		if _, ok := symbols[k]; !ok {
			symbols[k] = f.Symbol
		}
		if seen[k] {
			continue
		}
		seen[k] = true
		chains = append(chains, int64(f.ChainID))
		assets = append(assets, f.Address.Bytes())
	}
	if len(chains) == 0 {
		return []wirePriceState{}, nil
	}

	tx, err := s.store.BeginRiskSnapshot(ctx)
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	rows, err := tx.Query(ctx, `
		WITH keys AS (SELECT * FROM unnest($1::bigint[], $2::bytea[]) AS k(chain_id, asset)),
		     scoped AS (SELECT p.* FROM prices p JOIN keys k USING (chain_id, asset)),
		     newest AS (
		       SELECT DISTINCT ON (chain_id, asset, source)
		              chain_id, asset, source, owner_engine, price::text AS price, price_decimals,
		              block_number, anchor_block, observed_at, source_as_of, valid, invalid_reason
		         FROM scoped
		        ORDER BY chain_id, asset, source, block_number DESC),
		     quarantine AS (
		       SELECT chain_id, asset, source,
		              count(*) AS rows,
		              max(block_number) AS highest
		         FROM scoped WHERE NOT valid
		        GROUP BY chain_id, asset, source)
		SELECT n.chain_id, n.asset, n.source, n.owner_engine, n.price, n.price_decimals,
		       n.block_number, n.anchor_block, n.observed_at, n.source_as_of, n.valid, n.invalid_reason,
		       COALESCE(q.rows, 0), q.highest
		  FROM newest n LEFT JOIN quarantine q USING (chain_id, asset, source)
		 ORDER BY n.chain_id, n.asset, n.source`, chains, assets)
	if err != nil {
		return nil, fmt.Errorf("read price state: %w", err)
	}
	defer rows.Close()

	out := []wirePriceState{}
	for rows.Next() {
		var st wirePriceState
		var asset []byte
		var price string
		var anchor, highest *int64
		if err := rows.Scan(&st.ChainID, &asset, &st.Source, &st.OwnerEngine, &price, &st.Decimals,
			&st.BlockNumber, &anchor, &st.ObservedAt, &st.SourceAsOf, &st.Valid, &st.InvalidReason,
			&st.QuarantinedRows, &highest); err != nil {
			return nil, fmt.Errorf("scan price state: %w", err)
		}
		addr := common.BytesToAddress(asset)
		st.Asset = addr.Hex()
		st.Symbol = symbols[assetKey{uint64(st.ChainID), addr}]
		st.Value = &price
		st.ObservedAt = st.ObservedAt.UTC()
		if st.SourceAsOf != nil {
			t := st.SourceAsOf.UTC()
			st.SourceAsOf = &t
			age := ageSeconds(now, t)
			st.AgeSeconds = &age
		}
		if anchor != nil {
			b := uint64(*anchor)
			st.AnchorBlock = &b
		}
		if highest != nil {
			b := uint64(*highest)
			st.HighestQuarantined = &b
		}
		if class, err := riskfeed.ProvenanceClass(st.Source); err == nil {
			st.Provenance = class
			st.IsValuationWitness = riskfeed.IsValuationClass(class)
		}
		if !st.IsValuationWitness {
			st.ValuationWitnessNote = "reference/observatory only: this class is not permitted to value a position (design spec §7 — the uncapped feed equals the adapter's output only while no cap binds)"
		}
		out = append(out, st)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate price state: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("commit price-state snapshot: %w", err)
	}
	return out, nil
}

// readNeutralized reports the retained-but-unusable price backlog per poll-owned
// price engine (D-010 clause 4 / D-012 clause 6: the policy keeps those rows, so
// its cost has to be countable).
//
// A failure here is reported as a ZERO-ROW entry with an explicit note rather
// than failing the whole meta response: a status surface that goes dark because
// one of its counters is unavailable is worse than a status surface that says so.
func (s *server) readNeutralized(ctx context.Context) []wireNeutralized {
	out := []wireNeutralized{}
	for _, b := range []riskfeed.EngineBinding{s.cfg.Aave, s.cfg.DM} {
		if b.PriceEngine == "" {
			continue
		}
		stats, err := s.store.NeutralizedPriceStats(ctx, b.PriceEngine, b.ChainID)
		if err != nil {
			out = append(out, wireNeutralized{OwnerEngine: b.PriceEngine, ChainID: int64(b.ChainID), Rows: -1})
			continue
		}
		e := wireNeutralized{
			OwnerEngine:  b.PriceEngine,
			ChainID:      int64(b.ChainID),
			Rows:         stats.Rows,
			HighestBlock: stats.HighestBlock,
		}
		if stats.Rows > 0 {
			o, n := stats.Oldest.UTC(), stats.Newest.UTC()
			e.Oldest, e.Newest = &o, &n
		}
		out = append(out, e)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].OwnerEngine < out[j].OwnerEngine })
	return out
}

// readSweepCounts is the three-state census of chain-truth R6.4 over the rows
// `snapshot_sweeps` holds.
//
// THE SCOPE IS STATED ON THE ROW, because it has to be: an account with NO sweep
// row at all is also never-swept, and it cannot be counted from this table. Those
// accounts appear in the batch as SWEEP_NEVER refusals, which /v1/meta reports
// separately as `sweep_never_refusals_in_batch`.
func (s *server) readSweepCounts(ctx context.Context) ([]wireSweepCounts, error) {
	rows, err := s.store.Querier().Query(ctx, `
		SELECT engine,
		       count(*),
		       count(*) FILTER (WHERE last_success_block = 0),
		       count(*) FILTER (WHERE last_success_block > 0 AND status <> 'success'),
		       count(*) FILTER (WHERE last_success_block > 0 AND status = 'success')
		  FROM snapshot_sweeps GROUP BY engine ORDER BY engine`)
	if err != nil {
		return nil, fmt.Errorf("read sweep census: %w", err)
	}
	defer rows.Close()
	out := []wireSweepCounts{}
	for rows.Next() {
		var c wireSweepCounts
		if err := rows.Scan(&c.Engine, &c.Rows, &c.NeverSwept, &c.FailedSinceSuccss, &c.Success); err != nil {
			return nil, fmt.Errorf("scan sweep census: %w", err)
		}
		c.Note = "never_swept counts rows whose last_success_block is still 0 — collateral of UNKNOWN size, never zero. " +
			"Accounts with no sweep row at all are also never-swept and are NOT in this count; they appear as SWEEP_NEVER refusals on the book."
		out = append(out, c)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate sweep census: %w", err)
	}
	return out, nil
}

// heartbeatProvenance publishes each stream feed's budget together with the grade
// of the budget itself (design spec §7, BL-6).
func (s *server) heartbeatProvenance() []wireHeartbeat {
	out := []wireHeartbeat{}
	for _, f := range s.feeds.Assets {
		if f.Oracle.Kind != config.FeedKindChainlinkStream {
			continue
		}
		h := wireHeartbeat{
			ChainID:          f.ChainID,
			Symbol:           f.Symbol,
			Proxy:            f.Oracle.Proxy.Hex(),
			Aggregator:       f.Oracle.Contract.Hex(),
			HeartbeatSeconds: int64(f.Oracle.Heartbeat / time.Second),
			GraceSeconds:     int64(f.Oracle.Grace / time.Second),
			ProvenanceGrade:  heartbeatGradeDefault,
			Basis:            heartbeatBasisDefault,
		}
		if g, ok := heartbeatGrades[strings.ToLower(f.Oracle.Proxy.Hex())]; ok {
			h.ProvenanceGrade, h.Basis = g.grade, g.basis
			gap, budget := g.observedMaxGap, g.testedBudget
			h.ObservedMaxGapSeconds, h.TestedBudgetSeconds = &gap, &budget
			h.BudgetRefuted = g.grade == heartbeatRefuted
		}
		out = append(out, h)
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].ChainID != out[j].ChainID {
			return out[i].ChainID < out[j].ChainID
		}
		return out[i].Symbol < out[j].Symbol
	})
	return out
}

// scenarioConfigVersion is the committed scenario set's version, or a
// disagreement report.
//
// The set is versioned as a WHOLE on the wire because a client caching stress
// results needs one token to invalidate on. If the files ever disagree the token
// says so rather than picking one — a silently-chosen version would let a client
// believe it had a coherent set.
func (s *server) scenarioConfigVersion() string {
	seen := map[string]bool{}
	var versions []string
	for _, sc := range s.scenarios {
		if !seen[sc.Version] {
			seen[sc.Version] = true
			versions = append(versions, sc.Version)
		}
	}
	sort.Strings(versions)
	if len(versions) == 1 {
		return versions[0]
	}
	return "MIXED(" + strings.Join(versions, ",") + ")"
}
