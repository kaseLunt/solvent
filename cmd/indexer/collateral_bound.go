// The collateral staleness bound: how old a per-account snapshot may be before
// conditionCollateralUnusable fires — relative to the sweep cadence the
// deployment actually achieves, carried across rounds and hydrated across restarts.
package main

import (
	"context"
	"log/slog"
	"time"
)

// collateralStaleBound is how old a per-account collateral snapshot may be before
// conditionCollateralUnusable fires — a RELATIVE bound, derived from the cadence
// the deployment actually achieves rather than from a constant.
//
// WHY IT CANNOT BE A CONSTANT, and why the obvious constant is arithmetically
// wrong. The natural guess is max(2·interval, noProgressBound). It does not hold:
// SweepWorkBatch never re-selects an account that already succeeded in the CURRENT
// generation, so an account is re-read once per generation, and a generation takes
// a full pass — interval + passDuration — to come round again. On any sizable
// registry the pass duration dominates the interval, so a bound ignoring it is
// permanently exceeded under perfectly healthy operation and the gate would be red
// forever on a working system. That is the false-positive direction, and a gate
// that is always red is a gate nobody reads.
//
// WHAT THE GATE THEREFORE CERTIFIES, stated honestly (controller ruling OQ3): "this
// account's collateral is as fresh as the sweep cadence this deployment actually
// achieves permits" — not an absolute age. If the registry grows until a pass takes
// a day, the bound grows with it and the gate stops meaning "fresh enough for
// liquidation decisions" while still reading green. That residual is ACCEPTED and
// recorded here rather than patched over with an absolute ceiling: any ceiling
// would be a number nobody derived, which is exactly the borrowed-constant
// reasoning that produced the block-count bound this wave is removing. The honest
// alarm for that scenario is the pass duration itself, which is visible in the
// condition's reason text.
//
// The factor of two absorbs ordinary jitter (a slow batch, a retry, a restart
// mid-pass) so the gate does not flap on a healthy deployment, and noProgressBound
// is the floor so a deployment with a very short interval and a tiny registry still
// gets a bound wide enough to be meaningful.
func collateralStaleBound(interval, lastPass time.Duration) time.Duration {
	if b := 2 * (interval + lastPass); b > noProgressBound {
		return b
	}
	return noProgressBound
}

// collateralBoundState carries collateralStaleBound's second input across daemon
// rounds. The achieved pass duration is only knowable from a COMPLETED generation,
// and the store reports it in the very call that needs the bound as an argument, so
// the daemon judges round N with the duration it learned in round N-1.
//
// The one-round lag is immaterial: a pass duration changes over the timescale of
// whole sweeps, not of daemon rounds. Before any generation has ever completed the
// retained value is zero and the bound degrades to max(2·interval, noProgressBound)
// — the naive formula, correct only while no pass duration exists to know.
//
// IT IS NO LONGER THE ONLY COPY, and that is round 9's restart finding. This value
// used to be pure process memory over a store fact that was destroyed the moment a
// generation opened (OpenSweepGeneration NULLs completed_at), so a restart during a
// long healthy sweep threw the achieved cadence away and collapsed the bound to the
// naive formula for the REST of that generation — false-red readiness for hours or
// days on a large registry, after every restart, on a surface whose entire premise
// is that a restart neither grants nor destroys a verdict. The duration is now
// durable (migration 00008), this state is HYDRATED from it before the first verdict
// (hydrate), and observe keeps carrying it across rounds so nothing changes in the
// hot path.
type collateralBoundState struct {
	// interval is the configured sweep cadence (SOLVENT_SNAPSHOT_INTERVAL).
	interval time.Duration
	// lastPass is the most recent COMPLETED generation's duration, retained across
	// rounds so the per-round read does not have to be the only source, and
	// re-established from the store at startup by hydrate.
	lastPass time.Duration
}

// bound is the value to judge this round with.
func (c *collateralBoundState) bound() time.Duration {
	return collateralStaleBound(c.interval, c.lastPass)
}

// observe retains a newly-reported pass duration. Zero is ignored rather than
// stored: it means "no generation has completed", not "a pass took no time".
func (c *collateralBoundState) observe(d time.Duration) {
	if d > 0 {
		c.lastPass = d
	}
}

// lastPassReader is the narrow store surface hydrate needs (*store.Store satisfies
// it). It is deliberately not progressReader: hydration happens once, at startup,
// before any verdict, and it must not be able to reach the per-round counts.
type lastPassReader interface {
	SweepLastPassDuration(ctx context.Context, engine string) (time.Duration, bool, error)
}

// hydrate re-establishes the achieved pass duration from durable state, before the
// daemon issues its FIRST collateral verdict.
//
// WITHOUT IT the fix to the store is only half a fix. The bound's input is durable
// now, but the first round of a restarted process would still judge with lastPass
// zero — the naive formula — because the per-round read only feeds the NEXT round
// (that is the one-round lag the type exists to manage). One round of false-red at
// every restart is small, but it is the same defect in miniature, and a surface that
// gates liquidation-facing data should not have to be described as "wrong only
// briefly".
//
// A FAILED READ IS NOT FATAL and is not silent either. The naive bound is the
// TIGHTER of the two (a smaller bound counts more accounts stale), so falling back
// to it errs red — the fail-closed direction — and the very next round's
// SweepProgress restores the durable value through observe anyway. Refusing to boot
// over a transient query failure would trade a brief over-strict readiness answer
// for no readiness answer at all.
func (c *collateralBoundState) hydrate(ctx context.Context, r lastPassReader, engine string) {
	d, found, err := r.SweepLastPassDuration(ctx, engine)
	if err != nil {
		slog.Warn("could not hydrate the collateral staleness bound from durable sweep state; this round judges with the naive interval-only bound, which is the TIGHTER of the two (it errs red, never green), and the next round restores it",
			"engine", engine, "err", err)
		return
	}
	if !found {
		return // no completed pass on record: the naive bound is the honest one
	}
	c.observe(d)
}
