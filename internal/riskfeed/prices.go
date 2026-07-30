package riskfeed

// Price custody at the risk boundary (design spec §7).
//
// Two jobs live here, and keeping them together is deliberate:
//
//  1. CLASSIFICATION — turn a `prices.source` string into a provenance class,
//     so the Aave valuation can be restricted to the classes that describe the
//     price the pool actually charges against.
//  2. DEGRADATION — judge one input against ITS OWN budget and produce the
//     G1-G5 verdict, together with the full snapshot that verdict was made
//     from. A verdict without the inputs it judged is not disclosable.

import (
	"errors"
	"fmt"
	"math/big"
	"strings"
	"time"

	"github.com/ethereum/go-ethereum/common"

	"github.com/kaselunt/solvent/internal/risk"
	"github.com/kaselunt/solvent/internal/store"
)

// Degradation gate codes (design spec §7).
//
// G1-G3 REFUSE, position-scoped: the position is written as a refused row
// naming the asset, and the previous batch's number stands until the next pass.
// G4-G5 COMPUTE AND FLAG: the number is served with the flag attached, and the
// flag propagates into every aggregate containing it.
const (
	// GateMissingInput — no usable price row, or a row with no chain-asserted
	// as-of, or one older than the ceiling. All three are the same fact from
	// the valuation's point of view: there is no input it may use.
	GateMissingInput = "G1"
	// GatePriceReorg — the price-owning engine on this asset's chain has not
	// acknowledged every reorg epoch, so its rows may describe deleted blocks.
	GatePriceReorg = "G2"
	// GateStoreUnreadable — the substrate could not be read for this position
	// (a source-exclusivity conflict, an unparseable row).
	GateStoreUnreadable = "G3"
	// GateStaleWithinCeiling — older than its budget, younger than the
	// ceiling. Computed, flagged, propagated.
	GateStaleWithinCeiling = "G4"
	// GateLargeStep — moved further in one interval than policy allows.
	// NEVER a refusal on value: the polled price IS the engine's charging
	// price, and refusing to report it would be refusing to report the truth.
	GateLargeStep = "G5"
)

// Verdict strings persisted on every price-input snapshot.
const (
	VerdictFresh        = "fresh"
	VerdictStale        = "stale"
	VerdictOverCeiling  = "over-ceiling"
	VerdictMissing      = "missing"
	VerdictNoAsOf       = "no-as-of"
	VerdictReorgUnacked = "reorg-unacked"
)

// Flags attached to a computed position. They are strings on the wire because
// they are disclosures, not enum internals.
const (
	FlagStalePrice = "stale_price"
	FlagLargeStep  = "large_price_step"
	FlagSweepStale = "collateral_sweep_stale"
	// FlagCollateralFlagUnwitnessed marks every Aave position, and says so
	// loudly: see AssembleAave.
	FlagCollateralFlagUnwitnessed = "aave_collateral_flag_unwitnessed"
)

// ErrUnknownProvenance refuses a source string this repo has never written. A
// default class would be a guess about which price a number is, and the whole
// point of the classes is that guessing is what goes wrong when a cap binds.
var ErrUnknownProvenance = errors.New("riskfeed: unrecognized price source — cannot classify its provenance")

// ProvenanceClass maps a `prices.source` mechanism string to its provenance
// class (design spec §7, oracle-sentinel R1 item 5).
//
// The mapping is the whole custody argument in four lines:
//
//   - "priceproviderv2"  → ENGINE-EXACT. It is literally the function
//     DebtManagerCore calls at borrow/repay/liquidation time.
//   - "aaveoracle:<addr>" → ADAPTER-OUTPUT. AaveOracle.getAssetPrice is the
//     price the Aave pool charges against, with every price cap already
//     applied.
//   - "chainlink:<agg>"  → UNCAPPED-FEED. The raw aggregator behind the cap
//     adapter. It equals the adapter's output only while no cap binds, and
//     caps bind precisely in the depeg and exploit scenarios a liquidation
//     engine cares most about.
//   - "ratio:<m>:<addr>" → RATIO-REFERENCE. An exchange ratio, not a price.
//
// The last two are OBSERVATORY surfaces and are never valuation inputs.
func ProvenanceClass(source string) (string, error) {
	switch {
	case source == "priceproviderv2":
		return risk.ProvenanceEngineExact, nil
	case strings.HasPrefix(source, "aaveoracle:"):
		return risk.ProvenanceAdapterOutput, nil
	case strings.HasPrefix(source, "chainlink:"):
		return risk.ProvenanceUncappedFeed, nil
	case strings.HasPrefix(source, "ratio:"):
		return risk.ProvenanceRatioReference, nil
	default:
		return "", fmt.Errorf("%w: %q", ErrUnknownProvenance, source)
	}
}

// IsValuationClass reports whether a class may be used to VALUE a position at
// all. Both surfaces restrict further — the Debt Manager admits only
// engine-exact — and `internal/risk` enforces the per-surface set; this is the
// coarse filter that keeps an observatory row out of the valuation query in the
// first place.
func IsValuationClass(class string) bool {
	return class == risk.ProvenanceEngineExact || class == risk.ProvenanceAdapterOutput
}

// PriceBudget is one input's own freshness policy.
//
// Budget is the age past which the number is STALE; the ceiling is 2×Budget
// (design spec §7: "R = 2 × T_f"), past which the input is REFUSED as missing.
//
// # Where these numbers come from, stated so nobody has to guess
//
// Every input riskd VALUES with is a POLL row — AaveOracle.getAssetPrice for
// Aave, PriceProviderV2.price for the Debt Manager. A poll oracle has no
// publication heartbeat to be stale against (config.FeedOracle.StalenessThreshold
// returns zero for them); its failure mode is a reverting or frozen view call,
// and the honest bound is THIS INDEXER'S OWN poll cadence plus margin.
//
// That has a consequence worth stating plainly: riskd's valuation budgets are
// repo POLICY derived from a cadence we control, NOT published feed heartbeats.
// The B3 escalation trigger ("the moment P3 wires heartbeat-derived bounds into
// risk reads, an unverified heartbeat becomes BLOCKING", chain-truth R4.4)
// therefore does not fire on this path — no published-not-verified heartbeat
// gates any number riskd computes. It still fires on `cmd/api`'s stream-row
// staleness verdicts, which do judge against published heartbeats.
type PriceBudget struct {
	Seconds int64
}

// Ceiling is the refusal bound: twice the budget.
func (b PriceBudget) Ceiling() int64 { return 2 * b.Seconds }

// PriceFreshnessPhase classifies a price row's age into the buckets that CHANGE A
// VERDICT: no-as-of, over-ceiling, stale, fresh.
//
// It is exported and shared because two callers must agree exactly. JudgePriceInput
// uses it to produce the served verdict; ComputeMaterializationIdentity uses it so
// the identity moves when the verdict would. If they ever disagreed, a pass whose
// prices had crossed the staleness threshold would derive the identity of the
// batch computed BEFORE the crossing, adopt it, and leave a "fresh" disclosure
// standing over an input that is no longer fresh — suppressing a stale flag or a
// G1 refusal it had just computed.
//
// The PHASE is what enters the identity, never the raw clock: two reads seconds
// apart inside the same phase are the same materialization, and the moment either
// threshold is crossed they stop being one.
func PriceFreshnessPhase(row store.RiskPriceRow, budget PriceBudget, now time.Time) string {
	if !row.HasSourceAsOf {
		return VerdictNoAsOf
	}
	age := int64(now.Sub(row.SourceAsOf.UTC()) / time.Second)
	switch {
	case age > budget.Ceiling():
		return VerdictOverCeiling
	case age > budget.Seconds:
		return VerdictStale
	default:
		return VerdictFresh
	}
}

// PriceJudgement is one input, judged, with everything the disclosure needs.
//
// Input is the risk.PriceInput to hand the math (zero-valued when Usable is
// false); Snapshot is the row to persist. They are produced TOGETHER because
// serving a disclosure re-derived from anything other than what the computation
// consumed is the TOCTOU lie design spec §7 forbids.
type PriceJudgement struct {
	Asset    common.Address
	Usable   bool
	Gate     string // "" when usable and fresh
	Flag     string // set for G4/G5; empty otherwise
	Input    risk.PriceInput
	Snapshot store.RiskPriceInputWrite

	// Phase is the freshness phase this judgement was made under, and
	// PhaseRelevant reports whether freshness was CONSULTED at all.
	//
	// The distinction is the gate ordering. G2 (an unacknowledged price reorg)
	// returns before any freshness reasoning happens, so no phase influenced the
	// output and none may enter the materialization identity — otherwise a
	// boundary crossing on a row that was never freshness-judged would mint a new
	// key for an output-identical batch, which is how a large-step warning gets
	// overwritten by an unflagged recomputation.
	Phase         string
	PhaseRelevant bool
	// AsOf is the chain-asserted as-of the phase was measured from, carried so a
	// scheduler can compute WHEN this input next crosses a boundary. Zero when
	// the row carried no as-of.
	AsOf time.Time
}

// ConsultedPrice is one price witness the assembler ACTUALLY CONSULTED — the
// single record of "this witness influenced the output", whether it did so by
// being fresh, by being stale, by being absent, or by being refused at G2.
//
// # THE SINGLE SOURCE OF TRUTH FOR THE OUTPUT-RELEVANT PRICE SET
//
// `snapshotSpec` FETCHES every witness the registry declares. `Assemble` CONSULTS
// only the ones the current positions actually need, and stops early on a refusal.
// Those are different sets, and the materialization identity must be built from the
// second one — a registered asset with no position affects no persisted position,
// disclosure or aggregate, so letting it move the key means a restart declines to
// adopt, recomputes against an already-published price, and writes a clean batch
// over a large-step warning.
//
// This type is that set. `ComputeMaterializationIdentity` takes it and applies TWO
// PROJECTIONS of it — the freshness-phase section and the price half of the
// substrate digest — so the two cannot drift apart the way they did when one was
// scoped to judged witnesses and the other still hashed every fetched row.
// Anything that needs "which prices were output-relevant" reads this and nothing
// else.
type ConsultedPrice struct {
	ChainID uint64
	Asset   []byte
	Source  string
	// Present reports whether a usable row existed for the key. ABSENCE IS
	// OUTPUT-RELEVANT — it is what produces a G1 refusal — so a consulted witness
	// with no row still belongs in the digest, recorded as absent.
	Present bool
	// Value/Decimals/BlockNumber are the row's value-bearing fields as consulted,
	// so the digest is built from what the assembler actually saw. Zero when
	// !Present.
	Value       *big.Int
	Decimals    int32
	BlockNumber uint64
	// Phase is the freshness phase, and PhaseRelevant reports whether freshness was
	// CONSULTED at all. A G2 return and an absent row consult no phase; the witness
	// is still consulted, so it enters the digest but contributes no phase.
	Phase         string
	PhaseRelevant bool
	AsOf          time.Time
	HasAsOf       bool
}

// JudgePriceInput evaluates one candidate price against its budget at the
// database clock `now`.
//
// `row` is nil when the store had no usable row for the key at all. `prev` is
// the value the PREVIOUS batch disclosed for the same key, or nil on the first
// pass — the G5 step comparison is against what we last told somebody, which is
// the only baseline that makes "this moved a lot since you last looked" a true
// statement.
//
// # The NULL as-of refusal
//
// A row whose `source_as_of` is NULL carries no chain-asserted as-of, and
// `observed_at` is DATABASE INSERTION TIME — for a backfilled row it can be
// years after the price was true. Substituting it would rate an ancient number
// as seconds old. So a NULL as-of is G1, exactly as design spec §7 requires,
// and the snapshot records verdict "no-as-of" so the refusal names its reason
// rather than looking like an absent row.
func JudgePriceInput(
	asset common.Address,
	key store.RiskPriceKey,
	row *store.RiskPriceRow,
	budget PriceBudget,
	now time.Time,
	prev *big.Int,
	stepBps int64,
	reorgUnacked bool,
) (PriceJudgement, error) {
	class, err := ProvenanceClass(key.Source)
	if err != nil {
		return PriceJudgement{}, err
	}

	j := PriceJudgement{Asset: asset}
	j.Snapshot = store.RiskPriceInputWrite{
		Asset:         asset.Bytes(),
		ChainID:       key.ChainID,
		Source:        key.Source,
		Provenance:    class,
		BudgetSeconds: budget.Seconds,
	}

	// G2 first: an unacknowledged reorg epoch on the price engine's chain means
	// the row may describe a block the raw rewind already deleted. That is a
	// custody failure, and it outranks any freshness judgement made over it.
	if reorgUnacked {
		// FRESHNESS WAS NEVER CONSULTED on this path, so no phase influenced the
		// output and none may enter the identity. PhaseRelevant stays false.
		j.Gate, j.Snapshot.Verdict = GatePriceReorg, VerdictReorgUnacked
		return j, nil
	}

	if row == nil {
		// An absent row has no phase to cross. Its absence is already carried by
		// the substrate digest, so nothing is lost by leaving PhaseRelevant false.
		j.Gate, j.Snapshot.Verdict = GateMissingInput, VerdictMissing
		return j, nil
	}

	// Everything below describes a row that EXISTS, so the snapshot carries its
	// full disclosure whether or not the row turns out to be usable — an
	// over-ceiling input must still show the operator what it refused and how
	// old it was.
	dec := int16(row.Decimals)
	block := row.BlockNumber
	j.Snapshot.Value = new(big.Int).Set(row.Value)
	j.Snapshot.Decimals = &dec
	j.Snapshot.BlockNumber = &block

	// ONE CLASSIFICATION, shared with the materialization identity. If these two
	// ever diverged, a pass whose prices had crossed a threshold would derive the
	// identity of the batch computed before the crossing, adopt it, and leave a
	// "fresh" disclosure standing over the stale flag or G1 refusal it had just
	// computed.
	phase := PriceFreshnessPhase(*row, budget, now)
	// From here on freshness HAS been consulted, so the phase is output-relevant
	// and belongs in the materialization identity.
	j.Phase, j.PhaseRelevant = phase, true
	if row.HasSourceAsOf {
		j.AsOf = row.SourceAsOf.UTC()
	}

	if phase == VerdictNoAsOf {
		j.Gate, j.Snapshot.Verdict = GateMissingInput, VerdictNoAsOf
		return j, nil
	}
	asOf := row.SourceAsOf.UTC()
	j.Snapshot.SourceAsOf = &asOf

	age := int64(now.Sub(asOf) / time.Second)
	j.Snapshot.AgeSeconds = &age

	if phase == VerdictOverCeiling {
		j.Gate, j.Snapshot.Verdict = GateMissingInput, VerdictOverCeiling
		return j, nil
	}

	fresh := phase == VerdictFresh
	j.Snapshot.Verdict = VerdictFresh
	if !fresh {
		// G4: computed and flagged. The flag propagates to every aggregate
		// containing the position (oracle-sentinel R2/G4).
		j.Gate, j.Flag, j.Snapshot.Verdict = GateStaleWithinCeiling, FlagStalePrice, VerdictStale
	}

	// G5: a large single-step move. NEVER a refusal — the polled price IS the
	// engine's charging price, so refusing on value would be refusing to report
	// what the protocol is actually using. It is disclosed AS POLICY, with the
	// bound that produced it.
	if prev != nil && prev.Sign() > 0 && stepBps > 0 {
		delta := new(big.Int).Sub(row.Value, prev)
		delta.Abs(delta)
		delta.Mul(delta, big.NewInt(10000))
		bound := new(big.Int).Mul(prev, big.NewInt(stepBps))
		if delta.Cmp(bound) > 0 {
			// A stale flag already set is not overwritten: both facts are true
			// and the caller collects flags, not one flag.
			if j.Flag == "" {
				j.Gate, j.Flag = GateLargeStep, FlagLargeStep
			} else {
				j.Flag = j.Flag + "," + FlagLargeStep
			}
		}
	}

	j.Usable = true
	j.Input = risk.PriceInput{
		ChainID:       key.ChainID,
		Asset:         asset,
		Source:        key.Source,
		Block:         row.BlockNumber,
		AsOf:          asOf,
		Value:         new(big.Int).Set(row.Value),
		Decimals:      uint8(row.Decimals),
		BudgetSeconds: budget.Seconds,
		Provenance:    class,
		Fresh:         fresh,
	}
	return j, nil
}

// Flags splits a judgement's comma-joined flag field. Empty in, empty out.
func (j PriceJudgement) Flags() []string {
	if j.Flag == "" {
		return nil
	}
	return strings.Split(j.Flag, ",")
}
