package riskfeed

// The MATERIALIZATION IDENTITY: what a batch is, expressed so that any honest
// process computing the same thing derives the same name for it.
//
// # Why deterministic, and not per-attempt
//
// A per-attempt key only survives the one failure it was written for: a commit
// whose acknowledgement was lost AND whose reconciliation lookup then succeeded.
// It does nothing for the histories that actually happen — the reconciliation
// lookup failing on the same network event, a restart before reconciling, or a
// second instance starting after the first committed. In each of those the next
// pass re-reads the committed POST-MOVE price as its baseline, mints a fresh key,
// and writes an unflagged duplicate. The large-step warning an operator was
// supposed to see disappears, which is the whole harm the key existed to prevent.
//
// Making the key a function of WHAT IS BEING MATERIALIZED removes the failure
// mode instead of catching it. Two computations of the same materialization
// collide by construction, so the second adopts the first rather than competing
// with it, and the re-baselining hole closes as a consequence.
//
// # What the identity covers, and one thing it deliberately does not
//
// COVERED — everything that determines the substrate a pass reads:
//
//   - the CONSUMED watermark vector: per engine (chain, last_block, acked_epoch)
//     and the per-chain max epoch, for the engines this pass actually reads. It
//     must be the FILTERED set: the live indexer maintains cursors riskd never
//     values from (`prices:chainlink_feed:1` among them), and letting one of those
//     into the identity means an unrelated cursor advancing gives a restart a NEW
//     key — so its post-move-baselined, unflagged computation writes a newer batch
//     and erases the warning. The filtered set has ONE source of truth, the
//     daemon's own watermark vector;
//   - the sweep aggregate per swept engine — because `ApplySweepBatch` moves
//     Debt Manager collateral WITHOUT moving any cursor;
//   - the policy that shapes the judgement: price budget, step bound, the
//     engine bindings, the required stamp set;
//   - a SUBSTRATE DIGEST over the rows actually read — with its PRICE half and
//     its COLLATERAL-FLAG half restricted to the CONSULTED witnesses, for the
//     same reason the phases are;
//   - the COLLATERAL-FLAG witnesses each position's legs were built from. They
//     are a distinct input family with a distinct hazard: the flag ledger can
//     gain its entire history through a rewind-and-rederive that returns the
//     cursor to the block it started at, so the watermark vector cannot see the
//     change at all (see the collateral_flags digest section);
//   - a FRESHNESS PHASE per CONSULTED price — fresh / stale / over-ceiling /
//     no-as-of. The raw clock stays out (see below), but the phase cannot: it is
//     what `Assemble` classifies each price by, so crossing a budget or ceiling
//     changes a verdict from "fresh" to a stale flag or a G1 refusal. Without the
//     phase, a poller that stopped while the daemon restarted would compute the
//     refusal and then adopt the pre-crossing batch, leaving its "fresh"
//     disclosure standing and suppressing the refusal it had just derived;
//   - the ALGORITHM REVISION and the REGISTRY FINGERPRINT — see IdentityPolicy.
//
// The substrate digest is not redundant with the vector, and the reason is
// D-012: a price row can be NEUTRALIZED IN PLACE without any cursor moving. Two
// passes at identical cursors can therefore read genuinely different prices, and
// they must not share an identity — that is a new materialization and deserves
// its own batch.
//
// NOT COVERED — the raw snapshot clock, which is why the phase above is a PHASE
// and not a timestamp: two reads seconds apart inside one phase are the same
// materialization, and a clock in the key would make every recomputation a new one.
//
// NOT COVERED — the previous batch's disclosed prices (the G5 step baseline).
// This is the subtle part and it is deliberate. The baseline is not substrate; it
// is a function of what we last PUBLISHED. Including it would give the fresh
// computation of a pass and the post-restart recomputation of that same pass two
// different identities — which is precisely the duplicate the identity exists to
// prevent. So the flag content may differ between an original and an adopted
// batch, and the ORIGINAL is the one that stands: it was computed against the
// baseline that actually preceded it.

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"math/big"
	"sort"
	"strings"
	"time"

	"github.com/kaselunt/solvent/internal/store"
)

// MaterializationIdentity names one materialization: a canonical, human-readable
// Vector string, a SubstrateDigest over the rows read, and the Key that any
// process computing this same materialization will derive.
type MaterializationIdentity struct {
	Key             string
	Vector          string
	SubstrateDigest string
}

// IdentityPolicy is the configuration half of the identity — the knobs that
// change a verdict without changing an input.
//
// They belong in the identity because a batch computed under a 3-minute price
// budget is NOT the same materialization as one computed under a 30-second
// budget, even from byte-identical substrate: the freshness verdicts, and
// therefore the refusals, differ. A key that ignored policy would let a
// re-configured daemon adopt a batch computed under rules it no longer applies.
type IdentityPolicy struct {
	BudgetSeconds   int64
	StepBps         int64
	AaveEngine      EngineBinding
	DMEngine        EngineBinding
	RequiredEngines []string
	SweptEngines    []string
	// Producer identifies the deployment role. It is NOT a version — production
	// hard-codes it — so it must never be relied on to separate builds. That is
	// AlgorithmRevision's job.
	Producer string
	// AlgorithmRevision is riskfeed.AlgorithmRevision, the version of the laws that
	// produced the numbers. An upgraded binary with changed math MUST derive a
	// different identity, or it adopts the old code's batch and the corrected
	// arithmetic never reaches a served number.
	AlgorithmRevision int
	// RegistryFingerprint is Registry.Fingerprint(): the canonical identity of the
	// valuation configuration. It catches the changes that move a NUMBER without
	// moving any input row — a corrected token `decimals` being the sharp one,
	// since Assemble divides by 10^decimals while every hashed price row stays
	// byte-identical.
	RegistryFingerprint string
}

// ComputeMaterializationIdentity derives the identity of one pass.
//
// It is a PURE function of its arguments — no clock, no randomness, no process
// state — because that is exactly the property the fix depends on. Anything
// non-deterministic in here silently reopens the duplicate-batch hole.
//
// # WHERE "OUTPUT-RELEVANT PRICE SET" LIVES: the `consulted` argument, and only there
//
// This function builds TWO sections from prices, and they must never be scoped
// differently again:
//
//   - the FRESHNESS section, projecting the PhaseRelevant subset of `consulted`;
//   - the PRICE half of the SUBSTRATE DIGEST, projecting all of `consulted`.
//
// Both read the SAME slice — `riskfeed.ConsultedPrice`, reported by `Assemble`, which
// is the one place that knows which witnesses a batch actually depended on. Neither
// section may read `inputs.Prices`, which is the FETCHED set and strictly larger.
//
// That split is exactly how the last two findings happened: the phases were scoped to
// the consulted set while the digest still hashed every fetched row, so an unrelated
// registered asset could mint a new key — by crossing a freshness boundary in one
// round, and by being repaired in place in the next. Two projections of one reported
// set cannot drift apart; two independently-scoped derivations did, twice.
//
// `inputs` is still passed because the NON-price sections of the digest (balances,
// indexes, sweeps, params, conflicts) are read from it. If a future section needs
// prices, it takes `consulted`.
// `consultedFlags` is the collateral-flag half of the same discipline: the flag
// witnesses `Assemble` actually read, reported by Assemble rather than re-derived
// here, and hashed into the substrate digest. It is a SEPARATE ARGUMENT rather
// than a field read off `inputs` for exactly the reason the price scoping law
// exists — `inputs.CollateralFlags` is the FETCHED fold (every witnessed pair
// below the cursor, most of them for accounts with no position today) and hashing
// it would let a pair nobody values mint a new key.
func ComputeMaterializationIdentity(
	cursors []store.DeriveCursorState,
	maxEpochs map[int64]int64,
	sweeps []store.RiskSweepWatermark,
	inputs store.RiskInputs,
	consulted []ConsultedPrice,
	consultedFlags []ConsultedCollateralFlag,
	policy IdentityPolicy,
) MaterializationIdentity {
	var b strings.Builder

	b.WriteString("v1\n")

	// --- policy -----------------------------------------------------------
	b.WriteString("policy:")
	fmt.Fprintf(&b, "rev=%d;budget=%d;step=%d;producer=%s;registry=%s;",
		policy.AlgorithmRevision, policy.BudgetSeconds, policy.StepBps,
		policy.Producer, policy.RegistryFingerprint)
	for _, e := range []EngineBinding{policy.AaveEngine, policy.DMEngine} {
		fmt.Fprintf(&b, "bind=%s/%d/%s/%s;", e.Engine, e.ChainID, e.ParamEngine, e.PriceEngine)
	}
	fmt.Fprintf(&b, "required=%s;", strings.Join(sortedCopy(policy.RequiredEngines), ","))
	fmt.Fprintf(&b, "swept=%s\n", strings.Join(sortedCopy(policy.SweptEngines), ","))

	// --- watermark vector -------------------------------------------------
	ordered := make([]store.DeriveCursorState, len(cursors))
	copy(ordered, cursors)
	sort.Slice(ordered, func(i, j int) bool { return ordered[i].Engine < ordered[j].Engine })
	b.WriteString("cursors:")
	for _, c := range ordered {
		fmt.Fprintf(&b, "%s@%d/%d/ack%d;", c.Engine, c.ChainID, c.LastBlock, c.AckedEpoch)
	}
	b.WriteByte('\n')

	chains := make([]int64, 0, len(maxEpochs))
	for chain := range maxEpochs {
		chains = append(chains, chain)
	}
	sort.Slice(chains, func(i, j int) bool { return chains[i] < chains[j] })
	b.WriteString("epochs:")
	for _, chain := range chains {
		fmt.Fprintf(&b, "%d=%d;", chain, maxEpochs[chain])
	}
	b.WriteByte('\n')

	// --- sweep aggregate --------------------------------------------------
	sweepOrdered := make([]store.RiskSweepWatermark, len(sweeps))
	copy(sweepOrdered, sweeps)
	sort.Slice(sweepOrdered, func(i, j int) bool { return sweepOrdered[i].Engine < sweepOrdered[j].Engine })
	b.WriteString("sweep:")
	for _, s := range sweepOrdered {
		sum := "0"
		if s.SuccessSum != nil {
			sum = s.SuccessSum.String()
		}
		at := "none"
		if s.HasUpdatedAt {
			// UTC, nanosecond-stable: a timezone-dependent rendering would make
			// the key depend on the reader's locale.
			at = s.MaxUpdatedAt.UTC().Format("2006-01-02T15:04:05.000000000Z")
		}
		fmt.Fprintf(&b, "%s=rows%d/failed%d/sum%s/at%s/gen%d/open%t;",
			s.Engine, s.Rows, s.Failed, sum, at, s.Generation, s.GenerationOpen)
	}
	b.WriteByte('\n')

	// FRESHNESS PHASES — OVER THE JUDGED SET ONLY.
	//
	// These are the witnesses `Assemble` actually consulted freshness for, reported
	// by Assemble itself rather than re-derived here. Classifying every FETCHED row
	// instead was a real hole: `snapshotSpec` asks for every witness the registry
	// declares, so a registered asset with NO position — affecting no persisted
	// position, disclosure or aggregate — could cross a boundary and mint a new key
	// for an output-identical batch. A restart would then decline to adopt, compute
	// against the post-move baseline, and write an unflagged newer batch over a
	// large-step warning.
	phases := make([]string, 0, len(consulted))
	for _, p := range consulted {
		if !p.PhaseRelevant {
			continue // G2 or absent: no phase was consulted, so none may bind
		}
		phases = append(phases, fmt.Sprintf("%d/%x/%s=%s",
			p.ChainID, p.Asset, p.Source, p.Phase))
	}
	sort.Strings(phases)
	b.WriteString("freshness:")
	for _, p := range phases {
		b.WriteString(p)
		b.WriteByte(';')
	}
	b.WriteByte('\n')

	vector := b.String()
	digest := substrateDigest(inputs, consulted, consultedFlags)

	sum := sha256.Sum256([]byte(vector + "substrate:" + digest))
	return MaterializationIdentity{
		Key:             hex.EncodeToString(sum[:]),
		Vector:          vector,
		SubstrateDigest: digest,
	}
}

// substrateDigest hashes the rows a pass actually read, in a canonical order.
//
// It is what distinguishes two passes at identical cursors that nonetheless read
// different data — the D-012 in-place price neutralization being the case that
// matters. Without it, such a pass would adopt the earlier batch and the
// corrected prices would never be published.
func substrateDigest(in store.RiskInputs, consulted []ConsultedPrice, consultedFlags []ConsultedCollateralFlag) string {
	h := sha256.New()

	balances := make([]string, 0, len(in.Balances))
	for _, r := range in.Balances {
		balances = append(balances, fmt.Sprintf("%s/%x/%x/%s/%s=%s@%d",
			r.Engine, r.Account, r.Asset, r.Side, r.Source, amountOf(r.Amount), r.UpdatedBlock))
	}
	writeSorted(h, "balances", balances)

	conflicts := make([]string, 0, len(in.BalanceConflicts))
	for _, c := range in.BalanceConflicts {
		conflicts = append(conflicts, fmt.Sprintf("%s/%x", c.Engine, c.Account))
	}
	writeSorted(h, "conflicts", conflicts)

	indexes := make([]string, 0, len(in.Indexes))
	for _, r := range in.Indexes {
		indexes = append(indexes, fmt.Sprintf("%s/%x/%s=%s@%d",
			r.Engine, r.Asset, r.Kind, amountOf(r.Value), r.Block))
	}
	writeSorted(h, "indexes", indexes)

	sweeps := make([]string, 0, len(in.Sweeps))
	for _, r := range in.Sweeps {
		sweeps = append(sweeps, fmt.Sprintf("%s/%x=%s/%d/%d/gen%d/att%d",
			r.Engine, r.Account, r.Status, r.LastAttemptBlock, r.LastSuccessBlock, r.Generation, r.Attempts))
	}
	writeSorted(h, "sweeps", sweeps)

	params := make([]string, 0, len(in.AaveParams)+len(in.DMParams))
	for _, group := range [][]store.ParamRow{in.AaveParams, in.DMParams} {
		for _, p := range group {
			params = append(params, fmt.Sprintf("%s/%d/%x=%s/%s/%s@%d/%d",
				p.Engine, p.ChainID, p.Asset,
				amountOf(p.LTV), amountOf(p.LiqThreshold), amountOf(p.LiqBonus),
				p.EffectiveBlock, p.EffectiveLogIndex))
		}
	}
	writeSorted(h, "params", params)

	// COLLATERAL FLAGS — OVER THE CONSULTED SET ONLY, same law as prices below.
	//
	// This is the section that makes the owner-gated flag backfill safe. That
	// maintenance operation rewinds the Aave derive cursor, re-derives the range,
	// and ends with the cursor back at the SAME block — so `cursors`, `epochs`,
	// `sweep` and every price line are byte-identical across it, and without this
	// section the post-backfill pass would derive the pre-backfill key, adopt that
	// batch, and publish the assume-true collateral it was run to correct.
	//
	// ABSENCE IS NOT RECORDED, and that is a deliberate asymmetry with prices. An
	// absent price row causes a G1 REFUSAL, so it is substrate. An absent flag row
	// yields `false` from the no-history LAW — a constant of the algorithm, whose
	// changes are AlgorithmRevision's job. Recording absences would write digest
	// lines with no witness behind them, keyed on nothing but which accounts hold
	// which assets, which the `balances` section already covers.
	flags := make([]string, 0, len(consultedFlags))
	for _, f := range consultedFlags {
		flags = append(flags, fmt.Sprintf("%s/%d/%x/%x=%t@%d/%d",
			f.Engine, f.ChainID, f.Reserve, f.User, f.Enabled, f.Block, f.LogIndex))
	}
	writeSorted(h, "collateral_flags", flags)

	// PRICES — OVER THE CONSULTED SET ONLY, and this is the second projection of
	// the same ConsultedPrice slice the phase section above reads.
	//
	// Hashing every FETCHED row instead was the last door on the scoping law. An
	// honest D-012 repair can neutralize or supersede an UNRELATED registered
	// asset in place, moving no cursor: the restart then never consults that asset,
	// recomputes the used price against its already-published value (so no G5
	// flag), and yet the unused row's changed digest mints a new key — writing a
	// clean batch over the flagged one. Restricting the digest to what was
	// consulted closes it.
	//
	// ABSENCE IS RECORDED, not skipped: a consulted witness with no usable row is
	// what produces a G1 refusal, so its absence must be able to change the
	// identity exactly as a value change would.
	prices := make([]string, 0, len(consulted))
	for _, p := range consulted {
		if !p.Present {
			prices = append(prices, fmt.Sprintf("%d/%x/%s=absent", p.ChainID, p.Asset, p.Source))
			continue
		}
		asOf := "none"
		if p.HasAsOf {
			asOf = p.AsOf.UTC().Format("2006-01-02T15:04:05.000000000Z")
		}
		prices = append(prices, fmt.Sprintf("%d/%x/%s=%s/%d@%d/%s",
			p.ChainID, p.Asset, p.Source, amountOf(p.Value), p.Decimals, p.BlockNumber, asOf))
	}
	writeSorted(h, "prices", prices)

	return hex.EncodeToString(h.Sum(nil))
}

func writeSorted(h interface{ Write([]byte) (int, error) }, label string, lines []string) {
	sort.Strings(lines)
	_, _ = h.Write([]byte(label + "\n"))
	for _, l := range lines {
		_, _ = h.Write([]byte(l))
		_, _ = h.Write([]byte{'\n'})
	}
}

// amountOf renders a nullable integer. The parameter is a CONCRETE *big.Int, not
// an interface: a nil *big.Int stored in an interface is not == nil, so an
// interface-typed version of this function would render "0" for absent values and
// silently make an absent parameter identical to a zero one.
func amountOf(v *big.Int) string {
	if v == nil {
		return "nil"
	}
	return v.String()
}

func sortedCopy(in []string) []string {
	out := append([]string(nil), in...)
	sort.Strings(out)
	return out
}

// NextFreshnessDeadline reports the earliest instant at which one of the JUDGED
// prices crosses a freshness boundary, and whether such an instant exists.
//
// # Why the scheduler needs this
//
// The recompute trigger watches cursors, epochs and sweep state. None of those
// move when a price simply AGES. So in an honest outage — ingestion stops while
// prices are fresh — nothing wakes the daemon as inputs cross 180s and then 360s,
// and the newest batch keeps its persisted "fresh" verdict indefinitely instead of
// gaining a G4 flag and then refusing at G1. Arming the poll loop at this deadline
// is what makes the transition happen without anything else changing.
//
// The boundaries are the SAME ones PriceFreshnessPhase uses, derived from each
// input's own as-of: `asOf + budget` (fresh→stale) and `asOf + ceiling`
// (stale→over-ceiling). A row already past both has no further crossing and
// contributes nothing. A row with no as-of is permanently in the no-as-of phase and
// likewise never crosses.
//
// The returned deadline is strictly AFTER now, so an armed pass cannot re-fire on
// the same boundary forever.
func NextFreshnessDeadline(consulted []ConsultedPrice, budget PriceBudget, now time.Time) (time.Time, bool) {
	var best time.Time
	for _, p := range consulted {
		if !p.PhaseRelevant || !p.HasAsOf {
			continue // no as-of, no crossing
		}
		for _, bound := range []int64{budget.Seconds, budget.Ceiling()} {
			// +1s because the phase test is strictly `age > bound`: the crossing
			// happens at the first instant past the bound, not at it.
			at := p.AsOf.Add(time.Duration(bound+1) * time.Second)
			if !at.After(now) {
				continue
			}
			if best.IsZero() || at.Before(best) {
				best = at
			}
		}
	}
	return best, !best.IsZero()
}
