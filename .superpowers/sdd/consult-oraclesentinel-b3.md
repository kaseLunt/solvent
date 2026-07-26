# Consult — oracle-sentinel, standing consult #1: the B3 open item

Subject: heartbeat verification for the USDC/PYUSD/FRAX Chainlink feeds (recon/derivation-notes.md,
"Per-feed staleness thresholds", open since Task 8 wave 1). Date: 2026-07-26. Constitution read in
full before ruling: D-012, ADD-1/ADD-2, derivation-notes oracle-wiring caveats, prices.go, poller.go
(anchored-round contract), feed.go, feeds.json, contracts.json, progress ledger through the P0 close.

---

## Ruling 1 — What exactly is unverified, and what the exposure is

**The fact pattern, confirmed.** The three 86400s values in `recon/feeds.json` (USDC :318,
PYUSD :335, FRAX :352) are the *published* Chainlink mainnet heartbeats from docs.chain.link —
an off-chain, mutable, Chainlink-Labs-operated publication. The weETH 3600s value is a different
evidence class entirely: a deployed third-party consumer's constructor
(`0x641169f048ee8de8b3037c9d9c840060fe03e463`) commits on-chain to that bound for that exact proxy —
a witness who bet money on the number. `recon/derivation-notes.md:312-315` records this split
honestly, per value; `TestRealFeedRegistryStalenessThresholds`
(`internal/config/feeds_test.go:358-389`) pins all four values plus the ≤26h ceiling so no registry
edit can silently loosen a bound.

**Price-flow path of the number** (this is the whole ruling's load-bearing fact):
`recon/feeds.json` → `config.LoadFeeds` (`internal/config/feeds.go:352-360`) →
`FeedOracle.Heartbeat/Grace` → `feedBinding.Staleness` (`internal/prices/feed.go:333-338`) →
`evaluateStaleness` (`feed.go:1029-1035`) → `ConditionFeedPublication` → daemon health/readyz
(`cmd/indexer/main.go:2344-2345` logs exactly this map at startup — the observed
FRAX/PYUSD/USDC 25h0m0s and weETH 1h30m0s trace to feeds.json and nowhere else).

The threshold **gates alarms only**. It never touches row validity, never gates `ApplyPrices`,
never filters `LatestUsablePrice` — which explicitly disclaims freshness
(`internal/store/prices.go:1759-1760`: "the caller must judge BlockNumber/ObservedAt against
whatever staleness bound its own use demands"). A wrong heartbeat therefore cannot corrupt a stored
price, an anchor, or a D-012 classification. It corrupts the operator's belief about whether the
witness is alive.

**Exposure by direction:**

- *Actual heartbeat shorter than assumed* (feed really operates at, say, 1h): a dead stable feed
  stays green on /readyz for up to 25h. Scenario: PYUSD depegs; the aggregator (or our ingest of
  it) halts; the newest stored AnswerUpdated remains ~$1.00; an operator trusting readiness — and
  at P3, a risk read consuming the newest row with a heartbeat-derived bound — prices PYUSD debt at
  par for up to a day while the market has moved. This is stale-round exploitation on the analytics
  side: liquidation-risk math says "healthy" for underwater positions, during exactly the depeg
  scenarios where the Aave cap adapters would also bind (and our rows are the *uncapped* stream — a
  separately disclosed divergence, `internal/prices/prices.go:35-42`; the two blind spots compound).
  For 0.25%-deviation stables that publish essentially at heartbeat cadence this is the
  LOW-probability direction — and the dangerous one.
- *Actual heartbeat longer than assumed* (say 27h): recurring false `feed_publication` reds every
  cycle, `reResolveAggregator` noise, alarm fatigue — an operator conditioned to ignore stable-feed
  reds misses the real death. This is the HIGH-probability failure mode of a docs-sourced value
  (Chainlink changes ops parameters without on-chain ceremony) and it is definitively detectable
  from our own history. Note the ≤26h fixture ceiling (`feeds_test.go:379`) means a legitimate
  change to >25h cannot be silently absorbed into the registry — correct as designed.

**Anti-canon check:** this is NOT "the-oracle-said-so." The provenance is stated per value, pinned
by a fixture, and the gap is recorded as open work. B3 is honest disclosed debt, not a violation.

## Ruling 2 — The verification path, and B3's necessary redefinition

**Correction to B3's own phrasing [should — F1]: heartbeat is not on-chain state and cannot be
"bytecode verified" on the aggregator, by construction.** These three raw aggregators are OCR-era
contracts; the heartbeat/deviation pair lives in the DON's off-chain configuration. Its only
on-chain shadow is the `ConfigSet` offchainConfig blob — opaque, undocumented protobuf, changeable
at any time with no proxy phase change. `aggregator()` lineage IS chain-verifiable; the heartbeat
is not. B3 as written is unclosable and must be redefined. The redefinition decomposes into what
can actually be proven, and by whom:

**(a) Address lineage** (on-chain, cheap, decisive): `proxy.aggregator() == configured raw
aggregator`, per proxy, recorded with the block it was read at, plus `phaseId()` /
`typeAndVersion()` as witness identity. Recon did this once; the runtime re-resolves only *after*
staleness fires (`feed.go:1057`, `1159-1186`) — there is no construction-time lineage check
[should — F2, see findings]. One recorded read per proxy closes this leg.

**(b) Consumer-encoded bound** (on-chain, the weETH evidence class): a deployed verified consumer
whose constructor commits to 86400 for these proxies (Morpho/Spark/Sky-style oracle adapters
commonly encode heartbeats). Best-effort: found ⇒ the provenance row upgrades to weETH's class;
not found ⇒ record the negative result. Not required for closure, because (c) is stronger for our
purpose.

**(c) The empirical heartbeat from our own backfilled round history — the core of the
redefinition.** The backfill lands the complete AnswerUpdated history from each feed's first round
(blocks 20,188,117 / 19,626,469 / 20,191,185 / 20,779,893). The observed inter-round distribution
is a complete operational record of what the witness actually does. Design:

1. **Round-continuity gate first.** `decode.ChainlinkAnswerUpdated` already carries `RoundId`
   (`internal/decode/decode.go:740`). Per aggregator, ordered by (block_number, log_index), RoundId
   must increase by exactly 1. Any RoundId gap is an INGEST hole, not a publication gap — exclude
   that window from gap statistics and report it separately. Without this gate the empirical check
   is unfalsifiable: our own missing data would masquerade as oracle silence, and oracle silence
   could hide behind "maybe we missed it." This is the classification discipline (D-012's spirit
   applied to evidence: classify, never conflate).
2. **Gap statistics on consecutive `UpdatedAt` deltas** (the aggregator's own transmission clock —
   the witness's claim about itself, which is what the heartbeat contract is denominated in): max,
   p95/p99, count > heartbeat, count > heartbeat+grace, per feed.
3. **Assertions:**
   - **A1** (falsifies "actually longer"): zero gaps > heartbeat+grace over the full
     continuity-clean history — equivalently, the configured threshold would have produced zero
     false publication alarms on all recorded history. One violation ⇒ the registry value is wrong
     in the alarm-fatigue direction. *Adjudication clause:* a genuine historical ops incident
     (feed pause with RoundId continuity intact, surrounding distribution still moding at ~86400)
     is an annotation, not an assumption-falsification — the scan outputs the evidence and a human
     adjudicates; it never auto-passes.
   - **A2** (bounds "actually shorter" honestly): p95 gap for the three stables ≥ ~20h — the
     signature that the operational heartbeat IS ~24h, since deviation-quiet stables publish almost
     exclusively at heartbeat. Stated plainly in the artifact: this proves what the feed DID, never
     what it is contracted to do; the contractual bound remains docs-sourced.
   - **A3** (method control): the evidence-backed weETH ETH/USD leg passes the same scan
     (max gap ≤ 3600+1800). If the evidence-backed feed fails its own empirical check, the method
     is broken, not the feed.
   - **A4** (the witness still exists): the newest stored round per feed sits within
     heartbeat+grace of the backfill head's block time. A tail-silent feed (deprecation, phase
     change we haven't noticed) escalates B3 from "verify an assumption" to "the witness is gone."
   - **A5** (anti-vacuity — F5): minimum round count per feed and span coverage ≥ ~90% of
     [startBlock, frontier]. A half-backfilled stream must not vacuous-green the pin. This house
     has shipped vacuous-green three times; the brief says it explicitly.
4. **Forward monitor, with its blind spot stated:** the live per-feed gate (`evaluateStaleness`)
   is already the standing monitor for future ops changes in the *loosening* direction — a
   Chainlink move to >25h surfaces as recurring reds and the ≤26h ceiling forces the registry edit
   through review. A move to <25h is invisible to the gate (it only makes our alarm laxer relative
   to the new reality). That residual is permanent under ANY closure short of Chainlink publishing
   config on-chain, and belongs in the provenance row as text, not papered over.

## Ruling 3 — Does B3 block W1 acceptance or P2 exit?

**No — honestly deferrable, with one scheduling caveat that pulls the closure into Task 9.**

- **Not W1-blocking.** W1's acceptance evidence is Task 9's backfill + reconcile welds
  (debt/collateral truth against pinned chain state); none of it consumes a feed heartbeat. The
  thesis's three parts — value (verbatim from the log), block-binding (raw_logs block/logIndex),
  witness identity (aggregator address + RoundId) — are intact for every feed row regardless of
  heartbeat correctness. The shelf-life part is the alarm layer, and its current value is disclosed
  as assumed, pinned, and ceiling-bounded.
- **Not P2-exit-blocking**, provided the disclosure survives into the exit review verbatim
  (`derivation-notes.md:313-326` already carries it; the exit reviewer must see "assumed, not
  verified," never "verified").
- **The caveat:** the empirical evidence lands on disk *today* with the backfill, the scan is SQL
  over raw_logs with zero RPC cost, and Task 9's deliverable family is precisely "invariant scans
  over the backfilled truth." Deferring the scan to P3 while the data sits ready would be deferral
  without a cost justification. Split it: B3's **closure artifact belongs in the Task 9 scan
  family**; B3's **residual** (contractual-vs-operational distinction; forward tightening
  blindness) defers to P3, where reader-side freshness gates get built for real — `LatestUsablePrice`
  deliberately makes no freshness claim, so P3 risk reads must apply per-asset bounds themselves
  (the Pyth school: staleness handling belongs to the reader).
- **Escalation trigger, recorded now:** the moment P3 wires heartbeat-derived bounds into risk
  reads, the heartbeat stops being an alarm parameter and becomes a risk-decision parameter, and an
  unverified value there IS blocking. Re-consult at that boundary.

## Ruling 4 — The concrete closure (smallest sound artifact, house evidence style)

One deliverable, three parts, wave-10 pattern (read-only evidence scan gated on
`SOLVENT_RECON_DATABASE_URL`, committed transcript tied to a SHA):

1. **The empirical heartbeat scan** — per-aggregator RoundId continuity + UpdatedAt gap
   distribution + assertions A1–A5 above. Output per feed: rounds, span, max gap, p95, violations
   with block ranges, continuity holes. Roughly one SQL window function and a page of Go
   assertions.
2. **The lineage record** — four `proxy.aggregator()` + `phaseId()` reads at a stated block,
   recorded in the derivation-notes provenance table.
3. **The provenance-row upgrade** (edit by the implementing wave — the section is NORMATIVE, so the
   redefinition of B3 goes through the controller's pen, not silent drift): per stable feed,
   replace "not verified by this wave" with the three-class statement — *contractual bound:
   published (docs, off-chain, mutable); operational bound: empirically pinned by scan <name> over
   N rounds [first-round → backfill-head], max gap X, continuity-verified; forward changes:
   monitored by the live gate in the loosening direction only, blind in the tightening direction
   (stated residual).* Optional: the consumer-constructor hunt (b), recorded found-or-not.

**What closure must NOT do:** auto-tighten the registry to observed p99 (a feed contractually
allowed 24h must not be alarmed at its rare-but-legitimate maximum — Maker's liveness-vs-correctness
trade, decided toward the contract); re-cite the docs page harder and call it verification; touch
the ≤26h ceiling; or write the scan so empty history passes (F5).

---

## Findings

| # | Severity | Finding | Path / cite | Prescription |
|---|---|---|---|---|
| F1 | should | B3 as phrased ("bytecode verification" of heartbeat) is unclosable by construction — no on-chain heartbeat state exists on OCR aggregators; offchainConfig is opaque and mutable | `recon/derivation-notes.md:313-315, 326` | Redefine B3 = lineage + empirical pin + stated residual (Ruling 2); normative-doc edit via the controller |
| F2 | should | No construction-time proxy→aggregator lineage check; re-resolution only fires after staleness (25h for the stables), so a phase change is a ≥25h silent-stop window with green health | `internal/prices/feed.go:290-352` (constructor), `:1057`, `:1159-1186`; deferral declared at `internal/prices/prices.go:55-61` | Lineage record in the closure artifact; optionally a startup one-shot resolve + WARN-on-mismatch (additive; manual-repair posture preserved) |
| F3 | note | Exposure asymmetry: shorter-than-assumed = up to 25h green-readiness death during depeg (compounds with the disclosed uncapped-stream divergence, `prices.go:35-42`); longer-than-assumed = self-announcing false reds. A1 kills the second; A2 bounds the first | Ruling 1 | Empirical scan A1/A2 |
| F4 | note | Threshold values are correctly quarantined from data provenance: rows, anchors, D-012 classification, and `LatestUsablePrice` are all heartbeat-independent — this is *why* B3 is deferrable | `internal/store/prices.go:1751-1789` | Re-consult when P3 makes heartbeats risk-decision parameters |
| F5 | note | Fixture-optimism guard on the closure itself: the scan must assert minimum rounds + span coverage so partial backfill cannot vacuous-green the pin | (house history: three vacuous-green incidents, ledger) | Assertion A5, named in the brief |

**Blocking list: empty.**

## Verdict

**PROVENANCE HOLDS** for the current feed staleness posture. The unverified 86400s values gate
alarms, not rows: every feed price row still carries its value, its block, and its witness
(aggregator + RoundId), independent of the heartbeat's correctness; the assumption is disclosed per
value, pinned by `TestRealFeedRegistryStalenessThresholds`, and ceiling-bounded at 26h. B3 is
honest open work, not a breach — and it does not block W1 acceptance or P2 exit.

**Recommended closure artifact:** the Task 9-family empirical heartbeat scan (RoundId-continuity
gated, assertions A1–A5) + the proxy lineage record + the provenance-row upgrade per Ruling 4 —
with B3 formally redefined away from "bytecode verification," which cannot exist for these values.
