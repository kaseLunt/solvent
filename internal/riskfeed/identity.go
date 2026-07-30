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
//   - the watermark vector: per engine (chain, last_block, acked_epoch) and the
//     per-chain max epoch at compute time;
//   - the sweep aggregate per swept engine — because `ApplySweepBatch` moves
//     Debt Manager collateral WITHOUT moving any cursor;
//   - the policy that shapes the judgement: price budget, step bound, the
//     engine bindings, the required stamp set;
//   - a SUBSTRATE DIGEST over the rows actually read.
//
// The substrate digest is not redundant with the vector, and the reason is
// D-012: a price row can be NEUTRALIZED IN PLACE without any cursor moving. Two
// passes at identical cursors can therefore read genuinely different prices, and
// they must not share an identity — that is a new materialization and deserves
// its own batch.
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
	// Producer identifies the build. A different producer is a different set of
	// laws, so it must not adopt another build's batch.
	Producer string
}

// ComputeMaterializationIdentity derives the identity of one pass.
//
// It is a PURE function of its arguments — no clock, no randomness, no process
// state — because that is exactly the property the fix depends on. Anything
// non-deterministic in here silently reopens the duplicate-batch hole.
func ComputeMaterializationIdentity(
	cursors []store.DeriveCursorState,
	maxEpochs map[int64]int64,
	sweeps []store.RiskSweepWatermark,
	inputs store.RiskInputs,
	policy IdentityPolicy,
) MaterializationIdentity {
	var b strings.Builder

	b.WriteString("v1\n")

	// --- policy -----------------------------------------------------------
	b.WriteString("policy:")
	fmt.Fprintf(&b, "budget=%d;step=%d;producer=%s;", policy.BudgetSeconds, policy.StepBps, policy.Producer)
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

	vector := b.String()
	digest := substrateDigest(inputs)

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
func substrateDigest(in store.RiskInputs) string {
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

	// Prices carry their VALUE and their as-of, so an in-place neutralization
	// that swaps which row is usable changes this digest.
	prices := make([]string, 0, len(in.Prices))
	for _, p := range in.Prices {
		asOf := "none"
		if p.HasSourceAsOf {
			asOf = p.SourceAsOf.UTC().Format("2006-01-02T15:04:05.000000000Z")
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
