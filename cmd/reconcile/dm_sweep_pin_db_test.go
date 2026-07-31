package main

// THE DB-LEVEL SWEEP-PIN REGRESSION — the one that kills a revert of the SQL.
//
// dm_sweep_pin_test.go pins the CLASSIFIER over both shapes, which is necessary
// but not sufficient: the classifier reads T6SweepState.AtOrBelowPin, and the
// defect lived in the QUERY that fills it. Reverting `AND last_success_block <=
// $pin` in collectSweepBlocks would leave every pure test green while
// reintroducing all 199 false alerts.
//
// So this test seeds a scratch database with EXACTLY the mid-generation shape the
// probe measured — a borrower whose collateral legs and whose only successful
// sweep both sit ABOVE the derive cursor the run pins at — and drives the REAL
// collector through the REAL snapshot. It asserts the three facts that, together,
// leave the defect nowhere to hide:
//
//	1. the account's collateral legs are INVISIBLE at the pin (the leg filter),
//	2. its watermark at the pin is ZERO (the fix; == last_success_block if reverted),
//	3. the gate therefore EXCLUDES it instead of calling it liquidatable.
//
// Assertion 2 is the discriminating one: it fails loudly the moment the pin
// filter comes off.

import (
	"context"
	"encoding/hex"
	"math/big"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/stretchr/testify/require"

	"github.com/kaselunt/solvent/cmd/reconcile/snapshotdb"
	"github.com/kaselunt/solvent/internal/config"
)

// The mid-generation geometry, named so the arithmetic is readable.
const (
	sweepPinCursor  = 154_892_958 // the derive cursor => the run pin
	sweepHeadBlock  = 154_892_965 // where the sweeper's multicall actually executed
	sweepDebtBlock  = 154_890_000 // the borrower's last debt event, below the pin
	sweepOldSuccess = 154_880_000 // a below-pin success, for the control account
)

func TestSweepWatermarkIsPinFilteredAgainstTheLiveCollector(t *testing.T) {
	baseDSN := gateTestBaseDSN(t)
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
	defer cancel()
	dsn := ensureDerivedDB(t, ctx, baseDSN, "_reconsweeppin")

	conn, err := pgx.Connect(ctx, dsn)
	require.NoError(t, err)
	defer conn.Close(ctx)

	// A clean slate for the tables this test seeds. The derived scratch DB is
	// this test family's own (see ensureDerivedDB's comment on suffixes).
	for _, tbl := range []string{"position_balances", "position_events", "snapshot_sweeps", "derive_cursors", "raw_logs", "prices", "param_history"} {
		_, err = conn.Exec(ctx, "TRUNCATE "+tbl)
		require.NoError(t, err, "truncate %s", tbl)
	}

	// The DM derive cursor IS the pin (main.go's pins-are-derive-cursors law).
	_, err = conn.Exec(ctx,
		`INSERT INTO derive_cursors (engine, chain_id, last_block, acked_epoch) VALUES ($1, 10, $2, 0)`,
		snapshotdb.DMEngine, int64(sweepPinCursor))
	require.NoError(t, err)

	victim := mustAddrBytes(t, "9fd6c4daf4e021e34bf6cbf6b451ae000d046747") // the probe's own subject
	control := mustAddrBytes(t, "44b034c0e409959b4e37214c7ba59b58a986bd7c")
	usdc := mustAddrBytes(t, "0b2c639c533813f4aa9d7837caf62653d097ff85")
	liquidUSD := mustAddrBytes(t, "08c6f91e2b681faf5e17227f2a44c307b3c1364c")

	// Both accounts carry debt from an event BELOW the pin (debt legs are
	// event-derived, so they are always at or below the derive cursor).
	for _, acct := range [][]byte{victim, control} {
		_, err = conn.Exec(ctx,
			`INSERT INTO position_balances (engine, account, asset, side, source, amount, updated_block)
			 VALUES ($1, $2, $3, 'debt', 'event', 38585550, $4)`,
			snapshotdb.DMEngine, acct, usdc, int64(sweepDebtBlock))
		require.NoError(t, err)
	}

	// THE VICTIM: swept at chain HEAD, above the pin. ApplySweepBatch replaced its
	// legs wholesale, so every leg carries the head block.
	_, err = conn.Exec(ctx,
		`INSERT INTO position_balances (engine, account, asset, side, source, amount, updated_block)
		 VALUES ($1, $2, $3, 'collateral', 'snapshot', 59000000, $4)`,
		snapshotdb.DMEngine, victim, liquidUSD, int64(sweepHeadBlock))
	require.NoError(t, err)
	_, err = conn.Exec(ctx,
		`INSERT INTO snapshot_sweeps (engine, account, last_attempt_block, last_success_block, status)
		 VALUES ($1, $2, $3, $3, 'success')`,
		snapshotdb.DMEngine, victim, int64(sweepHeadBlock))
	require.NoError(t, err)

	// THE CONTROL: swept BELOW the pin, and genuinely holds no collateral. It must
	// stay evaluable — this is the real zero-collateral population that carries the
	// dust debt, and a fix that refused it too would trade one wrong answer for
	// another.
	_, err = conn.Exec(ctx,
		`INSERT INTO snapshot_sweeps (engine, account, last_attempt_block, last_success_block, status)
		 VALUES ($1, $2, $3, $3, 'success')`,
		snapshotdb.DMEngine, control, int64(sweepOldSuccess))
	require.NoError(t, err)

	// Drive the REAL collector through the REAL snapshot.
	cfg := &config.Config{
		Chains:  map[string]config.Chain{"op": {ChainID: 10}, "eth": {ChainID: 1}},
		Streams: []config.Stream{{Name: "op:debt-manager", Chain: "op", Engine: snapshotdb.DMEngine}},
	}
	roDSN, err := readOnlyDSN(dsn)
	require.NoError(t, err)
	snap, err := snapshotdb.Collect(ctx, snapshotdb.Params{
		Task6:                 true,
		AdapterRowsPerReserve: adapterRowsPerReserve,
	}, cfg, roDSN, snapshotdb.GoldenSpec{}, true /*wantDM*/, false /*wantAave*/, nil)
	require.NoError(t, err, "the Task-6 collector must run over the seeded snapshot")
	require.NotNil(t, snap.Task6)
	require.Equal(t, uint64(sweepPinCursor), snap.Pins[snapshotdb.DMEngine], "the pin is the derive cursor")

	victimHex, controlHex := hex.EncodeToString(victim), hex.EncodeToString(control)

	// (1) The LEG FILTER already hides the above-pin collateral.
	for _, l := range snap.Task6.DMCollLegs {
		require.NotEqual(t, victimHex, l.AccountHex,
			"a collateral leg stamped ABOVE the pin must be invisible to the pinned read; if this fires, the leg filter regressed and the two clocks agree for the wrong reason")
	}

	// (2) THE DISCRIMINATING ASSERTION: the watermark must be pinned too.
	vs := snap.Task6.DMSweepByAccount[victimHex]
	require.Equal(t, uint64(sweepHeadBlock), vs.Newest, "the newest success is recorded for disclosure")
	require.Zero(t, vs.AtOrBelowPin,
		"THE FIX: a sweep ABOVE the pin must not become a watermark. Reverting `AND last_success_block <= $pin` in collectSweepBlocks makes this %d and reintroduces the 199 false liquidation alerts — requireWatermarks would pass, ComputeDMHealth would sum nothing, and Liquidatable would come out TRUE over collateral the pin cannot see",
		sweepHeadBlock)
	require.Zero(t, vs.LegsAtOrBelowPin,
		"and the exclusion is structurally justified: nothing visible was discarded")

	// (3) The control keeps its watermark, so the fix is not a blanket refusal.
	cs := snap.Task6.DMSweepByAccount[controlHex]
	require.Equal(t, uint64(sweepOldSuccess), cs.AtOrBelowPin,
		"a sweep at or below the pin MUST still certify: the real zero-collateral population stays evaluable and liquidatable")

	// (4) The gate's own classification and exclusion, end to end.
	c := &p3Ctx{pinOP: snap.Pins[snapshotdb.DMEngine], o: &options{}}
	require.Equal(t, sweepAbovePin, classifyDMSweep(vs, c.pinOP))
	require.Equal(t, sweepEvaluable, classifyDMSweep(cs, c.pinOP))

	rows, excluded := classifySweepTestimony(c, nil, snap.Task6, map[string]*big.Int{
		victimHex:  big.NewInt(40310720),
		controlHex: big.NewInt(1),
	}, nil)
	require.True(t, excluded[victimHex],
		"the victim must be EXCLUDED and refused, never scored as liquidatable over discarded collateral. The chain called this account HEALTHY with $59.22 of threshold-weighted collateral")
	require.False(t, excluded[controlHex])
	require.Equal(t, 0, tallyP3(rows),
		"an above-pin exclusion is DISCLOSED, not gated: it is a duty-cycle property of pinning below the sweeper's head, and gating it would fail acceptance ~34%% of the time for a reason no fix can remove")

	t.Logf("victim  %s: newest=%d atOrBelowPin=%d legsVisible=%d -> %s",
		victimHex, vs.Newest, vs.AtOrBelowPin, vs.LegsAtOrBelowPin, classifyDMSweep(vs, c.pinOP))
	t.Logf("control %s: newest=%d atOrBelowPin=%d legsVisible=%d -> %s",
		controlHex, cs.Newest, cs.AtOrBelowPin, cs.LegsAtOrBelowPin, classifyDMSweep(cs, c.pinOP))
}

func mustAddrBytes(t *testing.T, h string) []byte {
	t.Helper()
	b, err := hex.DecodeString(h)
	require.NoError(t, err)
	require.Len(t, b, 20)
	return b
}
