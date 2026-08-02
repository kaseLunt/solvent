package main

// WAVE-H9 SCOPED LIVE RE-ADJUDICATION — the backtest gate ALONE, against the
// retained 31-case frozen frame, through the PRODUCTION path end to end.
//
// The r9 acceptance run gated 5 backtest cases intra-block-recompute-unpriced.
// Wave H9 diagnosed that class as a harness defect (the parent frame priced
// only the seizure fan-out, so every PARTIAL liquidation with an unseized leg
// was structurally ungateable) and fixed it: the parent frame now values the
// whole collateral universe at N-1, and the decimals gap for pin-time-absent
// tokens is closed at the parent pin. This test re-runs the gate so the 5
// cases' NEW verdicts come from the GATE ITSELF — never from a hand recompute:
//
//   1. Phase-1 derived side: snapshotdb.Collect — the EXPORTED production
//      collector, RepeatableRead + ReadOnly, SELECT-only, the F5 gate closed
//      around the open snapshot exactly as a real run closes it. Only the
//      DM side is collected (wantDM=true, wantAave=false) with the frozen
//      frame's committed keys.
//   2. The run pin is the derive cursor INSIDE the snapshot — the same P_op
//      law production uses (never an operator's number). Its hash is
//      resolved live; the case frames themselves are pinned at each case's
//      OWN committed raw_logs hash, exactly as in every acceptance run (the
//      per-case pins ARE the r9 pins — they are committed in the frame).
//   3. The gate: runBacktest — the run-head decode-authority check, the
//      per-case frame reads, the causation replay, the continuity sweeps,
//      the three-state classification. No scoped entry existed before this
//      test; this IS the gate function the phase driver calls, fed the same
//      inputs, minus the unrelated gates.
//
// The test asserts only harness integrity (the collection succeeds, the gate
// runs, all 31 committed cases report). The VERDICTS are logged verbatim —
// the gate decides, and a case landing in a mismatch class is a real finding
// to report, not a test failure to engineer away.
//
// Opt-in: SOLVENT_H9_READJ=1, SOLVENT_RECON_RPC_OP (or SOLVENT_RPC_OP), and
// the repo config's database (STRICTLY read-only DSN, exactly as reconcile
// derives it). Budget: one Phase-1 DM collection plus ~20 archive reads per
// case (frame multicalls, three-surface code reads, one block trace, three
// blockHash-pinned getLogs sweeps), all hash-anchored.

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/require"

	"github.com/kaselunt/solvent/cmd/reconcile/snapshotdb"
	"github.com/kaselunt/solvent/internal/config"
)

// h9OpURLs parses the OP endpoint list the same way the production dial does.
func h9OpURLs(t *testing.T) []string {
	t.Helper()
	raw := strings.TrimSpace(os.Getenv("SOLVENT_RECON_RPC_OP"))
	if raw == "" {
		raw = strings.TrimSpace(os.Getenv("SOLVENT_RPC_OP"))
	}
	require.NotEmpty(t, raw, "SOLVENT_RECON_RPC_OP (or SOLVENT_RPC_OP) must be set once SOLVENT_H9_READJ is on")
	var urls []string
	for _, u := range strings.Split(raw, ",") {
		if u = strings.TrimSpace(u); u != "" {
			urls = append(urls, u)
		}
	}
	return urls
}

func TestWaveH9ScopedBacktestReAdjudication(t *testing.T) {
	if os.Getenv("SOLVENT_H9_READJ") == "" {
		t.Skip("SOLVENT_H9_READJ unset: the scoped backtest re-adjudication is opt-in (live DB SELECT-only + deep-archive RPC at the frame's committed pins)")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Minute)
	defer cancel()

	// --- Phase 1: the derived side, through the production collector --------
	cfg, err := config.Load(filepath.Join("..", "..", canonicalConfigPath))
	require.NoError(t, err)
	roDSN, err := readOnlyDSN(cfg.DatabaseURL)
	require.NoError(t, err, "the derived side is read STRICTLY read-only, exactly as reconcile reads it")

	keys := make([]string, 0, len(backtestFrame))
	for _, fc := range backtestFrame {
		keys = append(keys, strings.TrimPrefix(strings.ToLower(fc.TxHash), "0x")+fmt.Sprintf(":%d", fc.LogIndex))
	}
	data, err := snapshotdb.Collect(ctx, snapshotdb.Params{Task6: true, BacktestKeys: keys},
		cfg, roDSN, snapshotdb.GoldenSpec{}, true, false, nil)
	require.NoError(t, err, "Phase-1 DM collection (RR+RO snapshot, SELECT-only)")
	require.NotNil(t, data.Task6)
	t.Logf("phase-1 collected: %d/%d frame cases present in derived state; P_op (derive cursor) = %d",
		len(data.Task6.Backtest), len(keys), data.Pins[snapshotdb.DMEngine])

	// --- the read surfaces, dialed exactly as main.go dials them ------------
	r := liveReader(t, "op", "SOLVENT_RECON_RPC_OP", "SOLVENT_RPC_OP")
	urls := h9OpURLs(t)
	logsR, err := dialPinnedLogs(ctx, "op", urls, newRPCRunner(1.5, 5, &rpcCallLog{}))
	require.NoError(t, err, "the L2 continuity sweeps are part of the gate — a run without them proves the refusal path, not the fix")
	evR, err := dialPinnedEvidence(ctx, "op", urls, newRPCRunner(1.5, 5, &rpcCallLog{}))
	require.NoError(t, err, "the R12 evidence surface is MANDATORY per case")

	pin := data.Pins[snapshotdb.DMEngine]
	hashOP, _, err := r.headerHash(ctx, pin)
	require.NoError(t, err)
	t.Logf("run pin %d hash %s (pin-time decimals/universe read here; every case frame is pinned at its OWN committed raw_logs hash)", pin, hashOP.Hex())

	c := &p3Ctx{
		o: &options{}, t6: data.Task6, opR: r, logsR: logsR, codeR: evR, traceR: evR,
		pinOP: pin, hashOP: hashOP, dmProxy: liveDMProxy,
		frames: &frameSet{}, now: time.Now().UTC(),
	}

	// The pin-time decimals map, via the SAME production readers the phase
	// driver uses. A frame token missing from it (delisted before the run
	// pin) exercises the wave-H9 historical decimals closure per case.
	universe, borrow, uRows, err := readDMTokenUniverse(ctx, c)
	require.NoError(t, err)
	require.Empty(t, uRows, "the token universe must read clean at the run pin")
	decimals, _, _, _, err := readDMTokenState(ctx, c, universe, borrow)
	require.NoError(t, err)
	t.Logf("pin-time universe: %d tokens, %d with decimals", len(universe), len(decimals))

	// --- THE GATE, alone -----------------------------------------------------
	rows, results, err := runBacktest(ctx, c, decimals)
	require.NoError(t, err, "the gate itself must complete (an abort here is a run-head epoch or RPC-environment failure — report it verbatim)")
	require.Len(t, results, len(backtestFrame), "the FRAME is the floor: every committed case reports, none dropped")

	// --- the receipt, verbatim ----------------------------------------------
	type oblRow struct {
		verdict, class, basketComplete, everyLeg, margin string
	}
	obl := map[string]oblRow{}
	for _, row := range rows {
		if row.Leg != "obligation2: OUR eligibility at N-1" {
			continue
		}
		obl[row.Subject] = oblRow{
			verdict:        row.Verdict,
			class:          row.Class,
			basketComplete: row.Evidence["parent_basket_complete"],
			everyLeg:       row.Evidence["every_leg_priced_both_frames"],
			margin:         row.Evidence["margin_usd6"],
		}
	}
	// THE RECEIPT IS ASSERTED, NOT LOGGED (Codex round 8, HIGH — the vacuous
	// green): a green exit from this test MUST establish the full 31/31
	// exact claim. Every frozen case: evaluated (never skipped), eligible at
	// the parent boundary, obligation-2 verdict EXACT with no class, and the
	// basket complete in BOTH frames. The logs stay for the receipt; any
	// deviation FAILS the test.
	states := map[string]int{}
	for _, res := range results {
		state := res.EligibilityState
		if !res.Evaluated {
			state = "SKIPPED:" + res.SkipClass
		}
		states[state]++
		o := obl[res.Key]
		t.Logf("case %s… fanout=%d | state=%s | o2 verdict=%q class=%q | margin_usd6=%s | parent_basket_complete=%s every_leg_priced_both_frames=%s",
			res.Key[:16], res.Fanout, state, o.verdict, o.class, o.margin, o.basketComplete, o.everyLeg)
		require.Truef(t, res.Evaluated, "case %s was SKIPPED:%s — a skipped case cannot support the 31/31 exact receipt", res.Key, res.SkipClass)
		require.Equalf(t, "true-at-parent", res.EligibilityState, "case %s eligibility state %q — the receipt claims true-at-parent on every case", res.Key, res.EligibilityState)
		require.Containsf(t, obl, res.Key, "case %s has no obligation-2 row — the eligibility weld never ran", res.Key)
		require.Equalf(t, verdictExact, o.verdict, "case %s obligation-2 verdict %q (class %q) — the receipt claims EXACT on every case", res.Key, o.verdict, o.class)
		require.Emptyf(t, o.class, "case %s carries failure class %q — an exact verdict carries none", res.Key, o.class)
		require.Equalf(t, "true", o.basketComplete, "case %s parent_basket_complete=%q — an incomplete basket is the r9 defect itself", res.Key, o.basketComplete)
		require.Equalf(t, "true", o.everyLeg, "case %s every_leg_priced_both_frames=%q — the exec frame must value the SAME complete basket", res.Key, o.everyLeg)
	}
	var summary []string
	for s, n := range states {
		summary = append(summary, fmt.Sprintf("%s=%d", s, n))
	}
	sort.Strings(summary)
	t.Logf("RE-ADJUDICATION SUMMARY (%d cases): %s", len(results), strings.Join(summary, ", "))
	t.Logf("r9 context: 5 cases were gated intra-block-recompute-unpriced (expected margins from the wave-H9 diagnosis: 63350000 / 2670000 / 308110000 / 550000 / 1400 USD-6) — the classes above are the GATE'S new verdicts on the same frame")
}
