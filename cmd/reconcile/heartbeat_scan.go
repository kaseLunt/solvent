// The B3 heartbeat scan — REFUTE-OR-GRADE, with teeth.
//
// risk-quant R5-4 named the plan's original defect precisely: "the B3 scan has
// no failure mode ('upgrades grades or records the qualifier' — a gate that can
// only pass)". chain-truth R4 supplied the mechanism. Together:
//
//	max gap <= heartbeat                      => provenance UPGRADE
//	max gap in (heartbeat, heartbeat+grace]   => QUALIFIER
//	max gap  > heartbeat+grace                => the freshness budget is
//	                                             FALSIFIED: gated FAIL, budget
//	                                             raised to the observed bound,
//	                                             provenance DOWNGRADED
//
// Three things must be discharged before a gap may be called the feed's own
// behaviour (chain-truth R4):
//
//  1. OUR custody gap — discharged by CONSTRUCTION, and the scan CITES the
//     construction: the walker's coherent-window Step commits whole windows
//     atomically with address-only filters, so below a stream's ingest cursor
//     there are no holes for a walked address. The valid domain is exactly
//     [first AnswerUpdated >= startBlock, min(ingest cursor, pin)], stated per
//     feed; anything outside it is `unscannable`, never extrapolated.
//  2. AGGREGATOR PHASE CHANGE — the trap that MIMICS a violation. We walk RAW
//     aggregators; a Chainlink proxy re-points aggregator() on a phase change,
//     which makes our aggregator go permanently quiet while the feed lives on
//     at a new address. Any gap open-ended at the scan head, and any gap > 2x
//     the published heartbeat, consults a pinned proxy.aggregator() FIRST. A
//     mismatch is "stream requires re-resolution" — its own failure class, NOT
//     a heartbeat verdict and NOT a pass.
//  3. Only the residual is the feed's own behaviour.
//
// Gap arithmetic runs on `source_as_of` — the round's own `updatedAt`, chain
// testimony, persisted by the STRICT Go decoder — never `observed_at` (insertion
// time) and never the header time of our ingestion.
//
// ONTOLOGY, stated because it is easy to overclaim: a complete event ledger's
// max gap is exact HISTORY, so it can REFUTE a published budget. It cannot
// certify the future: the best grade this scan issues is
// `empirical-historical (N updates, max gap G, domain [a,b])`, never "verified".
package main

import (
	"context"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/ethereum/go-ethereum/common"

	"github.com/kaselunt/solvent/cmd/reconcile/snapshotdb"
)

func heartbeatFrame() *gateFrame {
	return newGateFrame(gateHeartbeat,
		derived("prices(owner_engine=prices:chainlink_feed:1, source=chainlink:<agg>).source_as_of over the custody domain",
			"the chain's own updatedAt per round, persisted by the STRICT Go decoder (migration 00012 explicitly refuses a SQL substring decoder beside it). Gap arithmetic runs on THIS, never observed_at"),
		derived("raw_logs AnswerUpdated census per aggregator over the custody domain",
			"the completeness witness the price rows are welded against: a price row per DISTINCT round block, so a missing round would shorten history and lengthen a gap"),
		derived("ingest_cursors.last_block for the aggregator's own stream",
			"the UPPER bound of the custody domain. Above the cursor there is no testimony at all, so a gap there is unscannable rather than a violation"),
		pinned("Chainlink proxy.aggregator()@pinHash(P_eth)",
			"the phase-change check, consulted FIRST for any gap open-ended at the scan head or > 2x the published heartbeat"),
		committed("recon/feeds.json heartbeatSeconds, graceSeconds, startBlock, proxy per stream",
			"the PUBLISHED budget this scan can refute, and the domain's lower bound"),
	)
}

// feedGap is one measured interval between consecutive custodied rounds.
type feedGap struct {
	FromBlock  uint64
	ToBlock    uint64
	FromAsOf   time.Time
	ToAsOf     time.Time
	GapSeconds int64
}

// heartbeatVerdict is one feed's scan result, for the artifact.
type heartbeatVerdict struct {
	Stream          string   `json:"stream"`
	Symbol          string   `json:"symbol"`
	Aggregator      string   `json:"aggregator"`
	Proxy           string   `json:"proxy"`
	Heartbeat       int64    `json:"heartbeat_seconds"`
	Grace           int64    `json:"grace_seconds"`
	DomainFromBlock uint64   `json:"domain_from_block"`
	DomainToBlock   uint64   `json:"domain_to_block"`
	DomainCitation  string   `json:"domain_citation"`
	Updates         int      `json:"updates_in_domain"`
	RawLogs         int64    `json:"raw_answerupdated_logs"`
	RawBlocks       int64    `json:"raw_answerupdated_distinct_blocks"`
	MissingAsOf     int64    `json:"rows_missing_source_as_of"`
	MaxGapSeconds   int64    `json:"max_gap_seconds"`
	P99GapSeconds   int64    `json:"p99_gap_seconds"`
	MaxGapDetail    string   `json:"max_gap_detail,omitempty"`
	HeadGapSeconds  int64    `json:"head_gap_seconds"`
	PhaseChecked    bool     `json:"phase_change_checked"`
	PhaseAggregator string   `json:"proxy_aggregator_at_pin,omitempty"`
	Verdict         string   `json:"verdict"`
	ProvenanceGrade string   `json:"provenance_grade"`
	BudgetSeconds   int64    `json:"budget_seconds_after_scan"`
	TopGaps         []string `json:"top_gaps"`
}

// runHeartbeatScan executes B3.
func runHeartbeatScan(ctx context.Context, c *p3Ctx, now time.Time) ([]p3Row, []heartbeatVerdict, error) {
	f := c.frames.add(heartbeatFrame())
	var rows []p3Row
	var verdicts []heartbeatVerdict
	f.use("recon/feeds.json heartbeatSeconds, graceSeconds, startBlock, proxy per stream")

	for _, scan := range c.t6.Feeds {
		v := heartbeatVerdict{
			Stream: scan.Stream, Symbol: scan.Symbol,
			Aggregator: "0x" + scan.AggregatorHex, Proxy: "0x" + scan.ProxyHex,
			Heartbeat: scan.Heartbeat, Grace: scan.Grace,
			RawLogs: scan.RawLogCount, RawBlocks: scan.RawDistinctBlocks,
			MissingAsOf: scan.MissingAsOf,
		}
		upper := scan.IngestCursor
		if upper == 0 || upper > c.pinETH {
			upper = c.pinETH
		}
		v.DomainFromBlock, v.DomainToBlock = scan.RawFirstBlock, upper
		v.DomainCitation = fmt.Sprintf(
			"the walker's coherent-window Step commits whole windows atomically with address-only filters, so below a walked address's ingest cursor there are NO holes by construction. Domain = [first AnswerUpdated >= configured startBlock %d, min(ingest cursor %d, pin %d)] = [%d, %d]; anything outside it is unscannable, never extrapolated (chain-truth R4.1)",
			scan.StartBlock, scan.IngestCursor, c.pinETH, v.DomainFromBlock, v.DomainToBlock)
		f.use("ingest_cursors.last_block for the aggregator's own stream")
		f.use("raw_logs AnswerUpdated census per aggregator over the custody domain")

		if scan.Stream == "(unwalked)" || scan.IngestCursor == 0 {
			v.Verdict = verdictUnscannable
			v.ProvenanceGrade = "published-not-verified (unchanged)"
			v.BudgetSeconds = scan.Heartbeat + scan.Grace
			rows = append(rows, p3Row{
				Gate: gateHeartbeat, Subject: v.Aggregator, Leg: "custody-domain",
				Verdict: verdictUnscannable, Gated: true, Class: verdictUnscannable,
				Note: "this aggregator is not covered by a walker stream with an ingest cursor, so the scan has NO custody domain to bound it. Recorded unscannable and GATED: 'cannot verify' is never advisory (round-11 F2)",
			})
			verdicts = append(verdicts, v)
			continue
		}

		// Completeness weld: one price row per DISTINCT round block. A shortfall
		// would shorten history and LENGTHEN a gap, so it must be judged before
		// the gap verdict.
		rounds := 0
		for _, r := range scan.Rounds {
			if r.HasAsOf {
				rounds++
			}
		}
		v.Updates = rounds
		f.use("prices(owner_engine=prices:chainlink_feed:1, source=chainlink:<agg>).source_as_of over the custody domain")
		completeness := compareExact(gateHeartbeat, v.Aggregator, "round completeness (price rows vs DISTINCT AnswerUpdated blocks)",
			bigFromUint(uint64(scan.RawDistinctBlocks)), bigFromUint(uint64(len(scan.Rounds))), "round-completeness")
		completeness.Note = "prices keys on (chain, asset, source, block_number), so SAME-BLOCK rounds legitimately collapse to one row — which is why the weld is against DISTINCT round BLOCKS and not against the raw log count (" +
			fmt.Sprintf("%d logs over %d distinct blocks", scan.RawLogCount, scan.RawDistinctBlocks) + "). A shortfall here would shorten history and lengthen a gap, so it is judged BEFORE the gap verdict"
		rows = append(rows, completeness)

		if scan.MissingAsOf > 0 {
			rows = append(rows, p3Row{
				Gate: gateHeartbeat, Subject: v.Aggregator, Leg: "source_as_of coverage",
				Expected: "every domain row carries a chain-asserted source_as_of",
				Actual:   fmt.Sprintf("%d row(s) NULL", scan.MissingAsOf),
				Verdict:  verdictUnscannable, Gated: true, Class: verdictUnscannable,
				Note: "NULL source_as_of means 'no chain-asserted as-of is known for this row' and must NEVER be read as 'fall back to observed_at' (migration 00012). Those rows are excluded from the gap arithmetic and the exclusion is GATED, because a scan over a domain it cannot fully measure is a scan whose max gap is a lower bound, not the exact history the refutation needs",
			})
		}

		gaps := computeFeedGaps(scan.Rounds)
		if len(gaps) == 0 {
			v.Verdict = verdictUnscannable
			v.ProvenanceGrade = "published-not-verified (unchanged)"
			v.BudgetSeconds = scan.Heartbeat + scan.Grace
			rows = append(rows, p3Row{
				Gate: gateHeartbeat, Subject: v.Aggregator, Leg: "gap-arithmetic",
				Verdict: verdictUnscannable, Gated: true, Class: verdictUnscannable,
				Note: "fewer than two custodied rounds with a chain-asserted as-of in the domain: there is no interval to measure",
			})
			verdicts = append(verdicts, v)
			continue
		}
		sorted := append([]feedGap{}, gaps...)
		sort.Slice(sorted, func(i, j int) bool { return sorted[i].GapSeconds > sorted[j].GapSeconds })
		v.MaxGapSeconds = sorted[0].GapSeconds
		v.MaxGapDetail = fmt.Sprintf("blocks %d -> %d, source_as_of %s -> %s",
			sorted[0].FromBlock, sorted[0].ToBlock,
			sorted[0].FromAsOf.Format(time.RFC3339), sorted[0].ToAsOf.Format(time.RFC3339))
		v.P99GapSeconds = percentileGap(gaps, 0.99)
		for i := 0; i < len(sorted) && i < 5; i++ {
			v.TopGaps = append(v.TopGaps, fmt.Sprintf("%ds (blocks %d->%d, %s -> %s)",
				sorted[i].GapSeconds, sorted[i].FromBlock, sorted[i].ToBlock,
				sorted[i].FromAsOf.Format(time.RFC3339), sorted[i].ToAsOf.Format(time.RFC3339)))
		}
		// The HEAD gap: now − the newest custodied round. An open-ended gap at
		// the scan head is one of the two triggers for the phase-change check.
		last := scan.Rounds[len(scan.Rounds)-1]
		if last.HasAsOf {
			v.HeadGapSeconds = int64(now.Sub(last.SourceAsOf).Seconds())
		}

		needPhaseCheck := v.MaxGapSeconds > 2*scan.Heartbeat ||
			(scan.Heartbeat > 0 && v.HeadGapSeconds > scan.Heartbeat+scan.Grace)
		phaseMismatch := false
		if needPhaseCheck && scan.ProxyHex != "" {
			v.PhaseChecked = true
			agg, note, err := readProxyAggregator(ctx, c, common.HexToAddress("0x"+scan.ProxyHex))
			if err != nil {
				return rows, verdicts, err
			}
			if note != "" {
				rows = append(rows, unreadRow(gateHeartbeat, v.Aggregator, "proxy.aggregator() phase check", note))
				// A phase check we could not perform is NOT permission to issue a
				// heartbeat verdict: the whole point is that the two explanations
				// are indistinguishable without it.
				v.Verdict = verdictUnscannable
				v.ProvenanceGrade = "published-not-verified (unchanged)"
				v.BudgetSeconds = scan.Heartbeat + scan.Grace
				verdicts = append(verdicts, v)
				continue
			}
			v.PhaseAggregator = agg.Hex()
			f.use("Chainlink proxy.aggregator()@pinHash(P_eth)")
			if !strings.EqualFold(hexLower(agg.Hex()), scan.AggregatorHex) {
				phaseMismatch = true
			}
		}

		switch {
		case phaseMismatch:
			v.Verdict = verdictReResolution
			v.ProvenanceGrade = "published-not-verified (the walked aggregator is no longer the proxy's aggregator)"
			v.BudgetSeconds = scan.Heartbeat + scan.Grace
			rows = append(rows, p3Row{
				Gate: gateHeartbeat, Subject: v.Aggregator, Leg: "phase-change check",
				Expected: "the proxy's aggregator() at the pin == the walked raw aggregator",
				Actual:   v.PhaseAggregator,
				Verdict:  verdictReResolution, Gated: true, Class: verdictReResolution,
				Note:     "STREAM REQUIRES RE-RESOLUTION — a CUSTODY-CONFIG fact, gated as its own failure class. It is NOT a heartbeat violation (our aggregator went quiet because the proxy re-pointed, and the feed lives on at a new address) and it is NOT a pass (we are walking an address that no longer serves the feed). Config repair stays MANUAL",
				Evidence: map[string]string{"max_gap_seconds": fmt.Sprintf("%d", v.MaxGapSeconds), "head_gap_seconds": fmt.Sprintf("%d", v.HeadGapSeconds)},
			})
		case v.MaxGapSeconds <= scan.Heartbeat:
			v.Verdict = verdictProvenanceUpgrade
			v.ProvenanceGrade = fmt.Sprintf("empirical-historical (%d updates, max gap %ds, domain [%d,%d]) — NEVER 'verified': a complete ledger's max gap is exact HISTORY and cannot certify the future",
				v.Updates, v.MaxGapSeconds, v.DomainFromBlock, v.DomainToBlock)
			v.BudgetSeconds = scan.Heartbeat + scan.Grace
			rows = append(rows, p3Row{
				Gate: gateHeartbeat, Subject: v.Aggregator, Leg: "heartbeat budget",
				Expected: fmt.Sprintf("max gap <= published heartbeat %ds", scan.Heartbeat),
				Actual:   fmt.Sprintf("%ds", v.MaxGapSeconds),
				Verdict:  verdictProvenanceUpgrade, Gated: true, Note: v.ProvenanceGrade,
			})
		case v.MaxGapSeconds <= scan.Heartbeat+scan.Grace:
			v.Verdict = verdictQualifier
			v.ProvenanceGrade = fmt.Sprintf("empirical-historical WITH QUALIFIER (%d updates, max gap %ds exceeds the published heartbeat %ds but sits within the declared operator grace %ds, domain [%d,%d])",
				v.Updates, v.MaxGapSeconds, scan.Heartbeat, scan.Grace, v.DomainFromBlock, v.DomainToBlock)
			v.BudgetSeconds = scan.Heartbeat + scan.Grace
			rows = append(rows, p3Row{
				Gate: gateHeartbeat, Subject: v.Aggregator, Leg: "heartbeat budget",
				Expected: fmt.Sprintf("max gap <= published heartbeat %ds", scan.Heartbeat),
				Actual:   fmt.Sprintf("%ds (within heartbeat+grace %ds)", v.MaxGapSeconds, scan.Heartbeat+scan.Grace),
				Verdict:  verdictQualifier, Gated: true, Note: v.ProvenanceGrade,
				Evidence: map[string]string{"max_gap_detail": v.MaxGapDetail},
			})
		default:
			v.Verdict = verdictBudgetFalsified
			v.BudgetSeconds = v.MaxGapSeconds
			v.ProvenanceGrade = fmt.Sprintf("DOWNGRADED — published-and-REFUTED: the published %ds heartbeat is falsified by an observed %ds gap over the custody domain [%d,%d]; the served freshness budget must carry the OBSERVED bound %ds, because keeping the friendlier published number is the silent-cap anti-canon",
				scan.Heartbeat, v.MaxGapSeconds, v.DomainFromBlock, v.DomainToBlock, v.MaxGapSeconds)
			rows = append(rows, p3Row{
				Gate: gateHeartbeat, Subject: v.Aggregator, Leg: "heartbeat budget",
				Expected: fmt.Sprintf("max gap <= heartbeat+grace = %ds (the published budget)", scan.Heartbeat+scan.Grace),
				Actual:   fmt.Sprintf("%ds", v.MaxGapSeconds),
				Verdict:  verdictBudgetFalsified, Gated: true, Class: verdictBudgetFalsified,
				Note: "BUDGET FALSIFIED — gated FAIL. The scan is a COMPLETE event ledger over its custody domain, so this max gap is exact history and it REFUTES the published heartbeat. Remediation is to raise the served budget to the observed bound and downgrade the provenance grade; it is NOT to widen the gate. " + v.ProvenanceGrade,
				Evidence: map[string]string{
					"max_gap_detail":     v.MaxGapDetail,
					"p99_gap_seconds":    fmt.Sprintf("%d", v.P99GapSeconds),
					"top_gaps":           strings.Join(v.TopGaps, " | "),
					"phase_checked":      fmt.Sprintf("%v", v.PhaseChecked),
					"proxy_aggregator":   v.PhaseAggregator,
					"custody_discharged": v.DomainCitation,
				},
			})
		}
		verdicts = append(verdicts, v)
	}
	return rows, verdicts, nil
}

// computeFeedGaps measures intervals between consecutive custodied rounds, in
// BLOCK order, over rows that carry a chain-asserted as-of. Rows without one are
// skipped (never interpolated), and a non-increasing as-of is recorded as a
// zero-length interval rather than a negative gap.
func computeFeedGaps(rounds []snapshotdb.T6FeedRound) []feedGap {
	var out []feedGap
	var prev *snapshotdb.T6FeedRound
	for i := range rounds {
		r := rounds[i]
		if !r.HasAsOf {
			continue
		}
		if prev != nil {
			d := int64(r.SourceAsOf.Sub(prev.SourceAsOf).Seconds())
			if d < 0 {
				d = 0
			}
			out = append(out, feedGap{
				FromBlock: prev.Block, ToBlock: r.Block,
				FromAsOf: prev.SourceAsOf, ToAsOf: r.SourceAsOf, GapSeconds: d,
			})
		}
		cp := r
		prev = &cp
	}
	return out
}

// percentileGap returns the p-th percentile gap by the nearest-rank
// (percentile_disc) definition — the same definition the freeze-time SQL used,
// so the two numbers are comparable.
func percentileGap(gaps []feedGap, p float64) int64 {
	if len(gaps) == 0 {
		return 0
	}
	vals := make([]int64, 0, len(gaps))
	for _, g := range gaps {
		vals = append(vals, g.GapSeconds)
	}
	sort.Slice(vals, func(i, j int) bool { return vals[i] < vals[j] })
	idx := int(p * float64(len(vals)))
	if idx >= len(vals) {
		idx = len(vals) - 1
	}
	return vals[idx]
}

// readProxyAggregator performs the pinned phase-change read.
func readProxyAggregator(ctx context.Context, c *p3Ctx, proxy common.Address) (common.Address, string, error) {
	if proxy == (common.Address{}) {
		return common.Address{}, "recon/feeds.json declares no proxy for this stream, so the phase-change check has nothing to consult", nil
	}
	d, err := chainlinkProxyAggregatorABI.Pack("aggregator")
	if err != nil {
		return common.Address{}, "", err
	}
	ret, _, err := c.ethR.callAtHash(ctx, "p3:b3:proxy.aggregator", proxy, d, c.hashETH)
	if err != nil {
		return common.Address{}, "proxy.aggregator() did not answer at the pin: " + err.Error(), nil
	}
	agg, err := unpackAddressStrict(chainlinkProxyAggregatorABI, "aggregator", ret)
	if err != nil {
		return common.Address{}, err.Error(), nil
	}
	return agg, "", nil
}
