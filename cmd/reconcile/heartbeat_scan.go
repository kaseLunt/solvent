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
		pinned("header time @pinHash(custody-domain boundary block = min(ingest cursor, P_eth))",
			"the CHAIN-TIME endpoint the head interval is measured to. A header advances with the chain even when every feed has stopped, which the feed population's own newest write does not — so a chain-wide oracle outage cannot receive a provenance upgrade (Codex round 2, finding H3)"),
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
	Stream          string `json:"stream"`
	Symbol          string `json:"symbol"`
	Aggregator      string `json:"aggregator"`
	Proxy           string `json:"proxy"`
	Heartbeat       int64  `json:"heartbeat_seconds"`
	Grace           int64  `json:"grace_seconds"`
	DomainFromBlock uint64 `json:"domain_from_block"`
	DomainToBlock   uint64 `json:"domain_to_block"`
	DomainCitation  string `json:"domain_citation"`
	Updates         int    `json:"updates_in_domain"`
	RawLogs         int64  `json:"raw_answerupdated_logs"`
	RawBlocks       int64  `json:"raw_answerupdated_distinct_blocks"`
	MissingAsOf     int64  `json:"rows_missing_source_as_of"`
	MaxGapSeconds   int64  `json:"max_gap_seconds"`
	P99GapSeconds   int64  `json:"p99_gap_seconds"`
	MaxGapDetail    string `json:"max_gap_detail,omitempty"`
	// HeadGapSeconds is the CHAIN-TIME interval from the newest custodied round to
	// the custody domain's chain-time endpoint. -1 means unmeasurable. It is NEVER
	// the process wall clock (Codex round 1, finding 8).
	HeadGapSeconds     int64 `json:"head_gap_seconds_chain_time"`
	HeadGapIsChainTime bool  `json:"head_gap_is_chain_time"`
	// JudgedMaxGapSeconds is max(between-round gaps, head interval) — the value the
	// budget ladder judges, so a STALLED feed can no longer receive a provenance
	// upgrade just because it has no further round to close its final interval.
	JudgedMaxGapSeconds int64 `json:"judged_max_gap_seconds"`
	JudgedMaxIsHead     bool  `json:"judged_max_is_head_interval"`
	// DomainBoundaryBlock / DomainBoundaryTime are the hash-bound header the head
	// interval is measured to (Codex round 2, finding H3).
	DomainBoundaryBlock uint64   `json:"domain_boundary_block"`
	DomainBoundaryTime  int64    `json:"domain_boundary_header_time"`
	PhaseChecked        bool     `json:"phase_change_checked"`
	PhaseAggregator     string   `json:"proxy_aggregator_at_pin,omitempty"`
	Verdict             string   `json:"verdict"`
	ProvenanceGrade     string   `json:"provenance_grade"`
	BudgetSeconds       int64    `json:"budget_seconds_after_scan"`
	TopGaps             []string `json:"top_gaps"`
}

// runHeartbeatScan executes B3.
func runHeartbeatScan(ctx context.Context, c *p3Ctx, now time.Time) ([]p3Row, []heartbeatVerdict, error) {
	f := c.frames.add(heartbeatFrame())
	var rows []p3Row
	var verdicts []heartbeatVerdict
	f.use("recon/feeds.json heartbeatSeconds, graceSeconds, startBlock, proxy per stream")
	f.use("header time @pinHash(custody-domain boundary block = min(ingest cursor, P_eth))")

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
		// THE HEAD INTERVAL, in CHAIN time (Codex round 1, finding 8).
		//
		// THREE DEFECTS THIS REPLACES. (a) The head gap was measured against the
		// process WALL CLOCK, which is not chain testimony and makes the number
		// unreproducible. (b) It only ever gated the phase check, never the budget —
		// so a feed that STOPPED PUBLISHING could still receive a provenance
		// UPGRADE, because the upgrade looked only at gaps BETWEEN rounds and a
		// stalled feed has no further round to close the interval. (c) The residual
		// interval at the head was excluded from the judged maximum entirely.
		//
		// The honest measure is chain-to-chain: from the newest custodied round's
		// own source_as_of to the DOMAIN ENDPOINT's header time — the chain's
		// statement of how far custody reaches. That interval is a real lower bound
		// on the feed's current silence, so it joins the judged maximum.
		last := scan.Rounds[len(scan.Rounds)-1]
		if last.HasAsOf {
			// The endpoint is the HEADER TIMESTAMP at the domain's upper boundary,
			// read at a hash-bound pin. A header time advances with the chain whether
			// or not any feed publishes, so a chain-wide outage cannot hide behind a
			// stalled feed population (Codex round 2, finding H3).
			boundaryTime, boundaryErr := c.domainBoundaryTime(ctx, scan.DomainBoundaryBlock)
			if boundaryErr != nil {
				rows = append(rows, unreadRow(gateHeartbeat, v.Aggregator, "domain-boundary header time",
					fmt.Sprintf("the header at the custody boundary block %d did not read, so the head interval cannot be measured in chain time: %v", scan.DomainBoundaryBlock, boundaryErr)))
			}
			v.DomainBoundaryBlock = scan.DomainBoundaryBlock
			v.DomainBoundaryTime = int64(boundaryTime)
			v.HeadGapSeconds, v.HeadGapIsChainTime = headInterval(last.SourceAsOf.Unix(), boundaryTime)
			if !v.HeadGapIsChainTime {
				// No boundary header time: the head interval is UNMEASURABLE in chain
				// time, and substituting the wall clock would fabricate chain testimony.
				// Recorded as such; the feed cannot be upgraded on a head interval
				// nobody measured.
				_ = boundaryErr
			}
		}
		// The JUDGED maximum includes the head interval: a stalled feed's silence is
		// exactly the thing a freshness budget claims cannot happen.
		v.JudgedMaxGapSeconds, v.JudgedMaxIsHead = judgedMaxGap(v.MaxGapSeconds, v.HeadGapSeconds, v.HeadGapIsChainTime)

		// An OPEN-ENDED gap at the scan head ALWAYS consults the phase check: a
		// permanently quiet walked aggregator is indistinguishable from a re-pointed
		// proxy without it (chain-truth R4.2), and that is precisely the case where
		// guessing wrong is worst.
		headOpenEnded := !v.HeadGapIsChainTime ||
			(scan.Heartbeat > 0 && v.HeadGapSeconds > scan.Heartbeat)
		needPhaseCheck := v.JudgedMaxGapSeconds > 2*scan.Heartbeat || headOpenEnded
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
		case !v.HeadGapIsChainTime:
			// The head interval could not be measured in chain time, so the feed's
			// CURRENT silence is unknown. "Cannot verify" is never advisory.
			v.Verdict = verdictUnscannable
			v.ProvenanceGrade = "published-not-verified (the head interval is unmeasurable in chain time: no domain-endpoint header)"
			v.BudgetSeconds = scan.Heartbeat + scan.Grace
			rows = append(rows, p3Row{
				Gate: gateHeartbeat, Subject: v.Aggregator, Leg: "head interval",
				Expected: "a chain-time interval from the newest round to the custody-domain endpoint",
				Actual:   "unmeasurable (no header time for the domain endpoint)",
				Verdict:  verdictUnscannable, Gated: true, Class: verdictUnscannable,
				Note: "the head interval is what catches a feed that STOPPED, and measuring it against the process wall clock would fabricate chain testimony (Codex round 1, finding 8). Unmeasurable therefore gates rather than defaulting to an upgrade",
			})
		case v.JudgedMaxGapSeconds <= scan.Heartbeat:
			v.Verdict = verdictProvenanceUpgrade
			v.ProvenanceGrade = fmt.Sprintf("empirical-historical (%d updates, judged max gap %ds incl. the %ds chain-time head interval, domain [%d,%d]) — NEVER 'verified': a complete ledger's max gap is exact HISTORY and cannot certify the future",
				v.Updates, v.JudgedMaxGapSeconds, v.HeadGapSeconds, v.DomainFromBlock, v.DomainToBlock)
			v.BudgetSeconds = scan.Heartbeat + scan.Grace
			rows = append(rows, p3Row{
				Gate: gateHeartbeat, Subject: v.Aggregator, Leg: "heartbeat budget",
				Expected: fmt.Sprintf("judged max gap (incl. the head interval) <= published heartbeat %ds", scan.Heartbeat),
				Actual:   fmt.Sprintf("%ds", v.JudgedMaxGapSeconds),
				Verdict:  verdictProvenanceUpgrade, Gated: true, Note: v.ProvenanceGrade,
			})
		case v.JudgedMaxGapSeconds <= scan.Heartbeat+scan.Grace:
			v.Verdict = verdictQualifier
			v.ProvenanceGrade = fmt.Sprintf("empirical-historical WITH QUALIFIER (%d updates, judged max gap %ds — incl. the %ds chain-time head interval — exceeds the published heartbeat %ds but sits within the declared operator grace %ds, domain [%d,%d])",
				v.Updates, v.JudgedMaxGapSeconds, v.HeadGapSeconds, scan.Heartbeat, scan.Grace, v.DomainFromBlock, v.DomainToBlock)
			v.BudgetSeconds = scan.Heartbeat + scan.Grace
			rows = append(rows, p3Row{
				Gate: gateHeartbeat, Subject: v.Aggregator, Leg: "heartbeat budget",
				Expected: fmt.Sprintf("judged max gap (incl. the head interval) <= published heartbeat %ds", scan.Heartbeat),
				Actual:   fmt.Sprintf("%ds (within heartbeat+grace %ds)", v.JudgedMaxGapSeconds, scan.Heartbeat+scan.Grace),
				Verdict:  verdictQualifier, Gated: true, Note: v.ProvenanceGrade,
				Evidence: map[string]string{"max_gap_detail": v.MaxGapDetail},
			})
		default:
			v.Verdict = verdictBudgetFalsified
			v.BudgetSeconds = v.JudgedMaxGapSeconds
			headNote := ""
			if v.JudgedMaxIsHead {
				headNote = " The refuting interval is the OPEN-ENDED HEAD interval: the feed has not published since its newest custodied round, which is a stall rather than a historical gap."
			}
			v.ProvenanceGrade = fmt.Sprintf("DOWNGRADED — published-and-REFUTED: the published %ds heartbeat is falsified by an observed %ds interval over the custody domain [%d,%d]; the served freshness budget must carry the OBSERVED bound %ds, because keeping the friendlier published number is the silent-cap anti-canon.%s",
				scan.Heartbeat, v.JudgedMaxGapSeconds, v.DomainFromBlock, v.DomainToBlock, v.JudgedMaxGapSeconds, headNote)
			rows = append(rows, p3Row{
				Gate: gateHeartbeat, Subject: v.Aggregator, Leg: "heartbeat budget",
				Expected: fmt.Sprintf("judged max gap (incl. the head interval) <= heartbeat+grace = %ds (the published budget)", scan.Heartbeat+scan.Grace),
				Actual:   fmt.Sprintf("%ds", v.JudgedMaxGapSeconds),
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

// chainHeaderTime is a unix timestamp that CAME FROM A BLOCK HEADER at a hash-bound
// pin, and nothing else.
//
// THE DEFECT THIS CLOSES (Codex round 2, finding H3): the head interval was measured
// to the newest source_as_of across the Chainlink feed population. When every feed
// stops together that maximum stops too, so the head interval stays zero and a
// chain-wide oracle outage could still be handed a provenance upgrade. A distinct
// type makes the substitution a COMPILE error: only domainBoundaryTime produces one,
// and it only produces one from headerTime.
type chainHeaderTime int64

// domainBoundaryTime reads the header timestamp at a domain boundary block through
// the pinned reader, memoised per run (several feeds share a boundary).
func (c *p3Ctx) domainBoundaryTime(ctx context.Context, block uint64) (chainHeaderTime, error) {
	if block == 0 {
		return 0, fmt.Errorf("no custody-domain boundary block was recorded")
	}
	if c.boundaryTimes == nil {
		c.boundaryTimes = map[uint64]chainHeaderTime{}
	}
	if t, ok := c.boundaryTimes[block]; ok {
		return t, nil
	}
	t, _, err := c.ethR.headerTime(ctx, block)
	if err != nil {
		return 0, err
	}
	c.boundaryTimes[block] = chainHeaderTime(t)
	return chainHeaderTime(t), nil
}

// headInterval is the head measurement, as a pure function of the two chain facts
// it is allowed to see: the newest custodied round own as-of, and the HEADER time at
// the custody boundary. chainTime is false when the boundary header is unavailable,
// and the caller then gates rather than substituting anything.
func headInterval(lastRoundAsOf int64, boundary chainHeaderTime) (seconds int64, chainTime bool) {
	if boundary <= 0 {
		return -1, false
	}
	s := int64(boundary) - lastRoundAsOf
	if s < 0 {
		s = 0
	}
	return s, true
}

// judgedMaxGap folds the head interval into the maximum the budget ladder judges. A
// stalled feed has no further round to close its final interval, so excluding the
// head is what let an outage pass (Codex round 1, finding 8).
func judgedMaxGap(maxBetweenRounds, head int64, headIsChainTime bool) (int64, bool) {
	if headIsChainTime && head > maxBetweenRounds {
		return head, true
	}
	return maxBetweenRounds, false
}
