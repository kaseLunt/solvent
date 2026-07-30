# Solvent Phase 3 — Execution Ledger (W2: risk engine + API)

Append-only. Every wave, review round, decision, and transition lands here. Cold-start order:
this file → `docs/plans/2026-07-28-solvent-phase3-risk-engine-api.md` →
`docs/specs/2026-07-28-solvent-phase3-risk-engine-api-design.md` →
`.superpowers/sdd/p3-consults/*.md` → `recon/derivation-notes.md` (NORMATIVE) → D-006/D-012/D-013.

## Standing calibration

- **D-013 binds every review brief** (honest-use correctness, demo-grade; adjudication line
  quoted verbatim in each Codex dispatch). Ratified at P2 (ledger 2e61277), re-affirmed by the
  owner at P3 entry 2026-07-28, promoted to a durable decision in this entry train.
- Serial writer; D-006 Codex approval gate on complex surfaces; per-wave mutation discipline
  carries over from P2 unchanged.
- P3 finish line: built + proven, not deployed (owner decision 2026-07-28).

## Entries

- P3 ENTRY (2026-07-28): Design consults dispatched to the three standing personas (risk-quant,
  oracle-sentinel, chain-truth; fable). Verdicts: risk-quant "numbers do not hold as proposed"
  (3 blockers), oracle-sentinel "provenance breaks as drafted" (BL-1..6), chain-truth "custody
  holds" (conditional, 6 items) — ALL blockers adopted into the spec before any code; rulings
  archived verbatim in `.superpowers/sdd/p3-consults/`. Cross-consult resolution of record:
  params are LEDGER data (chain-truth) — PoolConfigurator stream chosen over pinned-poll
  sampling; risk-quant's poll fallback subsumed into the reconcile weld. Owner approvals this
  session: architecture = riskd + api daemons over pure internal/risk; spec approved ("looks
  good"); Codex pass placed at plan stage (owner asked; controller recommended plan-stage over
  spec-stage — spec already carried three domain-adversarial passes). Plan authored
  (`docs/plans/2026-07-28-solvent-phase3-risk-engine-api.md`, repo-native format, staged like
  P2), self-review fixed three defects (undefined PositionInput, missing ProjectDMDebt, missing
  riskd PG role). Codex plan review dispatched pre-Task-0. W2 object + this ledger drafted for
  the entry train. PENDING: Codex findings → fix inline → entry train (D-013 + spec + plan +
  consults + probes doc + W2 + claim + W1 archive + ROADMAP/STATUS) as ONE coherent snapshot
  under owner ack.
- CODEX PLAN REVIEW ROUND 1 (session 019fab99-baf0-7630-89bd-5e8b8600ad3c): needs-attention,
  7H/1M — ALL EIGHT ADOPTED under D-013 (every finding an honest-use wrong-answer or
  gate-mechanics class; zero hostile-actor findings — the D-013 brief calibration held).
  [H1] entry train violates scope_gate's bootstrap-metadata-only law (VERIFIED
  scope_gate.py:1006) → Task 0 split into roadmap-only commit A + artifacts commit B.
  [H2] W1 "archive" semantics — PARTIALLY REFUTED: `archived` IS a legal work status
  (doctor.py:54) and archived work skips ALL achieved-state re-validation; CONFIRMED half:
  active work's depends_on must be achieved (doctor.py:721) → W1 achieved→archived in commit
  A, W2 depends_on: [] with prose lineage. [H3] configurator stream unrunnable as written →
  dedicated `aave_param` engine wired end-to-end (config enum, decode, indexer, health) +
  atomic RewindParams before epoch ack + harness param-replacement proof. [H4] riskd had no
  durable adapter-output price source (uncapped feed rows would misvalue exactly at cap-bind)
  → ETH poller extended to poll AaveOracle.getAssetPrice per reserve, anchored, provenance
  class `adapter-output`; riskd Aave valuation consumes only that class; reconcile weld added.
  [H5] missing rate-index watermark → per-asset IndexBlock/IndexTime on AaveReserve + DM APY
  observation block, stamped + disclosed; stale-interval test. [H6] price-row identity doesn't
  freeze the input (in-place neutralization/supersession) → batches snapshot FULL numeric
  inputs + disclosures; post-batch mutation regression. [H7] acceptance vacuity → reconcile
  cohort floors (Aave≥20, DM≥25, probes≥10/class, backtest≥25, welds all-reserves) + seeded
  exact-value API suite. [M8] market-depeg had no implementing surface → MarketRealization
  axis + ShortfallResult + pinned HFs-unchanged-AND-shortfall>0 test. Plan+spec+W2 amended in
  place; round 2 re-review dispatched.
- CODEX PLAN REVIEW ROUND 2 (session 019fabb5-d287-7ba1-91ed-9c65bff9bafd; fresh dispatch —
  the companion CLI exposes no resume for review jobs, verified against handleReviewCommand):
  needs-attention; 6/8 round-1 fixes VERIFIED (H1, H4, H5, H6, H7, M8); H2 re-refuted
  correctly, H3 incomplete, +2 new H, +1 new M — ALL FIVE ADOPTED under D-013.
  [H2] archived W1 does NOT protect its receipt: doctor visits every evidence object and
  validate_evidence_receipt unconditionally recomputes current-snapshot fingerprints (VERIFIED
  doctor.py:331-352) → commit A gains a doctor archived-evidence policy (referenced work
  archived/superseded ⇒ skip current-drift comparisons, keep tested-commit-internal checks) +
  selftest both-directions case; the Task 0 files list no longer edits the receipt and no
  longer claims W1 stays achieved. [H3] RewindParams(ctx, chainID, height, epoch) was NOT
  RewindDerived's contract — stacked honest reorgs orphan rows under a green cursor →
  full-contract signature RewindParams(ctx, engine, chainID, toBlock) with deepest-unacked
  target + MAX-epoch ack in one tx + stacked-epoch regression. [NEW-H] W2 invalidated_by
  omitted ALL implementation surfaces (stale-green evidence post-achievement) → expanded to
  internal/{store,risk,derive,prices,decode}/**, cmd/{riskd,api,reconcile}/**, api/**,
  packages/client-ts/**. [NEW-H] adapter-output rows had no durable truthful as-of
  (observed_at/anchor timestamps are DB insert time; PriceObservation carries no chain time)
  → additive prices.source_as_of (poll: pinned anchor-block header timestamp; feed:
  AnswerUpdated.updatedAt); NULL refused for as-of purposes; delayed-insertion test. [NEW-M]
  p3-consults/ was GITIGNORED (the `*` + `!*.md` descendant trap) → .gitignore re-inclusion
  landed + verified check-ignore clean; archives added to W2 deliverables; ls-files gate on
  commit B. Round 3 dispatched.
- OWNER AUTHORIZATION (2026-07-28 19:49, verbatim: "Good work, once this approves let's keep
  things moving"): entry-train execution incl. the commit-A owner ack is delegated,
  CONDITIONAL on the plan review reaching SHIP. Recorded as the delegation basis for the
  CONTROL_PLANE_OWNER_REVIEWED commit, same shape as the P2 stamp-train delegation.
- CODEX PLAN REVIEW ROUND 3 (session 019fabc3-df5e-77e1-809a-8c259c34f1af): needs-attention;
  3/5 round-2 fixes VERIFIED (invalidation scopes, source_as_of incl. all three tests,
  gitignore re-inclusion); H2 correctly held NOT-FIXED (plan prose is not an applied fix) and
  H3 held PARTIALLY (regression geometry non-discriminating — a deepest-target call passes a
  broken implementation). BOTH FIXED AND APPLIED: doctor.py archived-evidence policy
  IMPLEMENTED (validate_evidence_receipt gains historical=...; tested-commit-internal checks
  retained — recorded==tested contract/inputs, ancestry, schema, commands — current-snapshot
  drift comparisons skipped when the referenced work is archived/superseded; evidence-object
  branch passes historical from the referenced work's status) + selftest
  test_archived_evidence_policy with BOTH directions green in the full suite (0 failing:
  evidence:achieved-input-mutation-still-errors, evidence:archived-work-receipt-is-historical);
  commit-A enumeration now names both tool files; RewindParams regression re-specified with
  the discriminating derive_test.go:618-642 geometry (unacked targets 50/80, rows 60/90, call
  with SHALLOW 80, assert row-60 deletion + cursor 50 + acked==MAX). Round 4 dispatched.
- CODEX PLAN REVIEW ROUND 4 — SHIP (session 019fabd2-90a2-7e32-bc4d-b870956a66ad, verdict
  approve, "No material findings"): H2 VERIFIED-FIXED with the reviewer independently
  confirming (a) tested-commit-internal checks preserved, (b) historical derived from the
  referenced work's status with the exact {archived, superseded} set, (c) all other
  validate_evidence_receipt callers retain full checks, (d) both selftest directions present
  and registered; H3 VERIFIED-FIXED (geometry mirrors derive_test.go:618-657 and
  distinguishes deepest-unacked lowering). PLAN REVIEW PROGRAM CLOSED: 4 rounds,
  7H/1M → 5 → 2 → 0, every finding adopted, zero hostile-actor findings across all rounds
  (D-013 brief calibration held end-to-end).
- P3 ENTRY TRAIN LANDED (2026-07-28 20:10 local): commit A ff7eccf (roadmap-only bootstrap,
  scope-gate "claim bootstrap, 8 paths", CONTROL_PLANE_OWNER_REVIEWED under the recorded
  conditional delegation — condition met at SHIP): D-013 accepted, W2 active, integrator
  claim opened (claim.py open claude-integrator W2 --integrator --owner-reviewed), W1
  achieved→archived with archival note (receipt untouched), ROADMAP dual-row projection,
  STATUS active_task W2, doctor+selftest archived-evidence policy. Commit B 1edf6dd (under
  claim): plan, spec, three consult archives (ls-files gate passed), this ledger, gitignore
  re-inclusion. doctor OK 0 errors after each commit; pushed 99bc309..1edf6dd; CI watcher
  running. TASK 1 DISPATCHED: three parallel read-only probe agents (A: DB censuses —
  collateral weights/backtest frame/eMode+topic0 inventory; B: pinned vector hunts —
  floor-law pair, percentMul boundary, eMode reads; C: configurator topic0 sweep + provider
  posture). Integrator writes recon/p3-probes.md from their reports; agents commit nothing.
- CI GREEN on the entry train (run 30418816205, 1m55s, completed success).
- TASK 1 COMPLETE (2026-07-28/29): all six probes landed; recon/p3-probes.md committed
  (NORMATIVE for Tasks 2–6) and added to W2 deliverables; spec + plan amended in the same
  commit. HEADLINES: (1) **P-2 FALSIFIED THE DRAFTED HF MODEL** — wadDiv(percentMul(C,LT),D)
  matches ZERO of 12 borrowers under any rounding convention (one chain value strictly
  between the all-floor/all-half-up composites); the deployed law is a SINGLE FUSED FLOOR
  DIVISION floor(C·LT·1e18/(10000·D)), 12/12 exact with six last-digit discriminators —
  spec §5.1 #7 corrected pre-code (acceptance-run-#1 class catch moved to probe time);
  uniform-LT caveat disclosed, synthetic mixed-LT vector obligated. (2) P-1: collateral law
  = PURE FLOOR, 15/15, vectors F-A/F-B hard-code-ready. (3) eMode settled 0 both witnesses.
  (4) Book: $100.72M collateral 99.97% DM, DM debt $22.22M single-reserve, BTC leg IN at
  4.11%, THREE sub-1.0-HF dust positions (0.496/0.726/0.843) — bad-debt line has day-one
  members. (5) Backtest: exactly 763 events, SINGLE implementation era (both day-1 upgrades
  precede first liquidation), zero liquidations in ~33 days, frame fixed N=31. (6)
  Configurator 0x8438F4D2…E65d: 20 topic0s, ZERO unknowns, dual-channel byte-verified;
  CollateralConfigurationChanged emitted exactly ONCE ever (weETH 7800/8100/10600) — the
  pinned weld is the load-bearing param guard, history is nearly static; caps slashed to 1
  at 22,124,166 (2025-03-25) = deliberate market WIND-DOWN (explains the dust book;
  Observatory narrative). (7) A1 CRITICAL decode trap: ReserveInitialized has canonical
  topic0 but a 3-word body (no stableDebtToken) — canonical ABI decode misaligns; Task 2
  decodes deployment-verified shapes. (8) Pool impl timeline: 8 generations; 23,088,584
  regime boundary independently confirmed as a Pool impl upgrade. (9) Provider posture:
  Alchemy free 10-block cap + SHARED KEY starves the daemon (A3, observed) → Task 2 backfill
  dRPC-primary 10k windows, Alchemy targeted fallback only. Free extra: all sampled DB
  scaled balances matched chain exactly at the pin (mini-reconcile PASS). Probe-agent
  self-correction recorded (early "dRPC lied" was the agent's own hex bug — retracted; no
  provider dishonesty observed). NEXT: Task 2+3 wave briefs (param + adapter-price custody;
  pipeline-replay harness) — chain-truth pre-dispatch sharpening per its standing charter,
  then Opus implementation waves under D-006 with D-013 quoted.
- CI GREEN on Task 1 (run 30420460474, 1m55s).
- CHAIN-TRUTH TASK 2+3 PRE-DISPATCH CONSULT LANDED (archived VERBATIM-CONDENSED at
  .superpowers/sdd/p3-consults/chain-truth-task2-brief.md — NORMATIVE for the wave briefs,
  6-item blocking list gates wave acceptance). Headlines: ParamRunner is a NEW thin runner
  (NOT derive.Engine) copying exactly four Runner rules, refuse-loud on unknown topic0 lives
  in the runner not the Registry; ApplyParamEvents mirrors the FULL two-arm gate block
  (derive.go:198-230/263-273/306-335); RewindParams = fourth consumer of rewindTarget
  (derive.go:351-382), modeled on RewindPrices' lean shape, RewindDerived untouched;
  adapter-output polling EXTENDS the existing ETH poller (feeds.json registry entries +
  address-qualified pollViews "getAssetPrice(address)"), source_as_of costs ZERO extra RPC
  (head.Time already in hand at poller.go:928); source_as_of backfill for feed rows is
  RECOMMENDED provenance completion via a FeedDeriver Go-decoder healing pass (never SQL
  byte-slicing; D-012 governs poll rows, not feed rows); harness is THREE legs (the
  one-range sketch REFUTED — first liquidation 313k blocks after the only config event;
  genesis invariant forbids mid-history welds): genesis-cluster leg fork ~20,714,020 walking
  20,713,910→20,714,007 w/ committed-fixture second witness, liquidation custody-only leg
  21,469,973–21,469,982, synthetic post-fork reorg leg via anvil_reorg (probed working on
  v1.7.1, positional params; pre-fork getLogs PROXIES to upstream caps; needs new
  ANVIL_FORK_RPC_ETH on the Alchemy key — the sanctioned targeted carve-out); walker has NO
  adaptive halving (probe-pack phrase corrected) → stream window 2000 on the existing daemon
  endpoint posture. Plan Task 2/3 amended to match. Consult also live-probed anvil and
  recorded one self-correction (its own hex bug, retracted — probe-pack tradition holds).
- SESSION PAUSE (2026-07-28 ~21:15 local): usage limit until 22:40 — owner directed no
  further agent spawns. CLEAN HANDOFF STATE: HEAD pushed + CI green through Task 1; consult
  archive + plan corrections committed in this entry's commit. NEXT ACTION ON RESUME:
  dispatch Wave 2a (param custody core: config enum, configurator decode w/ A1 strict
  3-word reader, ParamRunner, ApplyParamEvents/RewindParams + migrations, indexer wiring) to
  an OPUS implementation agent — brief = plan Task 2 + the consult's blocking list + D-013
  adjudication line quoted; then Wave 2b (adapter-output poller + source_as_of + healing
  pass), then Task 3 harness legs, Codex per wave to SHIP.
- WAVE 2a LANDED (2026-07-28 ~23:30, Opus serena-coder implementation agent): param custody
  core complete and suite-green (1063 PASS / 0 FAIL / 1 pre-existing SKIP; build+vet clean;
  gofmt verified on CRLF-stripped content). Delivered: aave_param engine end-to-end (config
  enum + eth:aave-param stream window-2000, configurator strict decode of all 20 topic0s
  with REAL-bytes fixtures independently re-verified Blockscout+Alchemy 110/110, migration
  00011 param_history + ApplyParamEvents full two-arm gate + ParamsAsOf/(block,logIndex)
  ordering + RewindParams as rewindTarget's fourth consumer, ParamRunner with the four
  Runner rules + refuse-loud unknown-topic0 + deriveWorker wiring). Discriminating tests
  all present incl. the stacked-epoch 50/80 shallow-call regression + replaced-not-appended
  proof + canonical-4-word-body REJECTION. **WAVE REFUTED PROBE A1's FIELD ORDER with four
  witnesses** (wire topics: 3 not 2; symbol() reads "stableDebtEthEtherFiweETH" on word 0;
  verified genesis ABI declares asset+aToken indexed; Pool state getters match): body =
  (stableDebtToken, variableDebtToken, strategy), aToken lives in topics[2] — implementing
  the brief verbatim would have corrupted the aToken registry column. Strict-reader
  mechanism unchanged; probes A1 + consult R6.2 + plan CORRECTED with annotations this
  commit. Ten deviations reported, ALL justified and accepted by the integrator (notable:
  uniform strict hand-readers for all 20 bodies; ParamsAsOf returns the ordered ledger
  prefix with the per-field fold deferred to internal/risk; ingestFrontier body lifted to
  package-level ingestFrontierOf with Runner delegating — behavior byte-identical;
  stable_debt_token decoded but not columned). Integrator verification: build EXIT=0
  independently confirmed (stale gopls DuplicateDecl diagnostics disregarded — compiler
  clean), git status matches the manifest exactly, rewindTarget consumption confirmed at
  params.go:476. OWED: store package under -race (no C toolchain on this box — cgo requires
  gcc; CI does not run -race either) — carried as an open verification item for the Codex
  round / a toolchain session. NEXT: commit wave + doc corrections, dispatch Codex round on
  the wave diff, then live backfill (operator step: daemon restart; ~2.5k windows,
  aave_param consumer will honestly report behind-frontier during it), then Wave 2b.
- WAVE 2b DISPATCHED (2026-07-28 23:47, Opus serena-coder, parallel with 2a's Codex round —
  disjoint files): adapter-output polling (feeds.json aaveoracle entries, address-qualified
  pollViews getAssetPrice(address), same-round Multicall3 + anchor), migration 00012
  prices.source_as_of, zero-extra-RPC head.Time threading, feed-derive updatedAt stamping,
  FeedDeriver Go-decoder healing pass (idempotent, NULL-only, last-in-block-wins). Owner
  signed off for the night ("keep moving in parallel as appropriate... God speed") —
  autonomous night loop: adjudicate/fix/iterate each wave to SHIP, commit serially, daemon
  restart + backfill after Task 2 ships.
- CODEX WAVE-2a ROUND 1 (session 019fac95-27cb-79a1-ac5f-fecb7a0eb340, ~12m30s):
  needs-attention, ONE medium, DOC-ONLY — the custody code passed every reviewed invariant
  verbatim ("gate, rewind, runner, decode, wiring, and migration invariants"). Finding:
  recon/p3-probes.md A3 still carried the stale "10k windows + adaptive halving" sentence
  (I corrected A1 but missed A3) — an operator following the NORMATIVE doc could wedge the
  backfill. ADJUDICATED FIX-NOW under D-013 (honest-operator wrong-path class). Fixed to
  the authoritative posture (fixed window 2000, no halving, walker.go:791-793 cited,
  Alchemy manual-targeted only); returning for the doc-only D-006 re-review. Reviewer
  worktree note: detached-pin worktree cleaned at git level; OS directory lock leaves an
  inert scratchpad dir (kwt-class leftover, harmless).
- WAVE 2a SHIP (closing review session 019faca5-19f9-7f40-85b7-c51088eaec94, verdict
  approve, zero material findings): doc-only range af99384..63e09da verified; "all
  previously approved Wave 2a custody invariants untouched." WAVE 2a CLOSED under D-006 —
  two rounds (1 medium doc-only, fixed same session). DAEMON RESTART DELIBERATELY HELD
  until Wave 2b commits: one restart from a fully-committed tree applies 00011+00012 +
  starts the configurator backfill together (building the daemon from a tree carrying 2b's
  in-progress edits would run unreviewed code live). Inert locked worktree dirs for morning
  cleanup: C:\wtclose\w2a, scratchpad\wave2a-review (git-level clean; OS handles held).
- WAVE 2b LANDED (2026-07-29 00:35, Opus serena-coder): adapter-output + source_as_of
  complete and suite-green (854 PASS / 0 FAIL / 1 pre-existing SKIP; integrator
  INDEPENDENTLY re-ran vet + prices/store/config suites — all ok incl. the 106s live-db
  store pass; stale-gopls phantom compile errors disregarded a second time, compiler
  clean). Delivered: four aaveoracle feeds.json poll entries + pollViews
  "getAssetPrice(address)" (selector 0xb3596f07 keccak-pinned) with address-qualified
  source; head.Time threaded pin-site → pollRound → every observation (ZERO new RPC);
  migration 00012 prices.source_as_of + partial NULL index; feed-derive stamps updatedAt;
  FeedDeriver decoder-replay healing pass (NULL-only, feed-owned-only, last-in-block-wins
  proven against a discriminating fixture where last-in-block ≠ largest-timestamp,
  idempotent-with-zero-reads on rerun, once-per-process through Step, failure propagates).
  Five deviations ALL justified and accepted (notable: config/feeds.go uniqueness key
  relaxed to (chainID,asset,kind,contract,method) — the brief was UNLOADABLE as written,
  all four reserves already exist as chainlink_stream entries; three-gate collision
  argument + pinned test. Malformed header time → NULL-as-of, never a discarded round.
  Heal errors → step_error.). Authority-vs-reality catches: internal/prices package doc +
  FeedRatio doc rewritten (asserted adapter-output out of scope — now false);
  ExpectedSchemaVersion is derived, only the test constant bumps. Integrator follow-up:
  derivation-notes oracle-wiring gains the dated P3 STATUS addendum (proactive fix of the
  stale-normative-doc class Codex flagged on 2a). -race still owed (toolchain gap).
- ENDPOINT UPGRADE SESSION (2026-07-29 morning, owner-executed signups, integrator-wired):
  publicnode personal token → SOLVENT_RPC_ETH (token recognized; archive NOT included in
  free tier — proven by direct test; value = rate-lifted near-head lane). NEW Alchemy key →
  ANVIL_FORK_RPC_ETH (proven serving deep archive at the genesis cluster; free tier getLogs
  hard-capped at 10 blocks on ANY key — probed on both). INFURA free key → SOLVENT_RPC_ETH
  position 2 (proven serving 2000-block deep-archive getLogs — THE backfill fix). Daemon
  bounced twice; **measured backfill rate after Infura: +64,000 blocks in 3 min ≈ 1.28M
  blocks/hour (~85× speedup)** — harness milestone ~30min, full backfill ~4h.
- WAVE 4 LANDED (2026-07-29 10:13, Opus serena-coder — the money code): internal/risk
  complete, 3,065 src + 4,084 test lines, 103 tests + 89 subtests, **99.1% coverage with
  all 8 uncovered blocks enumerated-and-justified** (structurally unreachable); build/vet/
  gofmt/suite clean, INTEGRATOR INDEPENDENTLY VERIFIED (coverage 99.1% reproduced). FIVE
  CONTRADICTIONS found against authority (reported, not improvised): (1) BLOCKING-CLASS —
  the DM stable snap band is OPEN (PriceProvider.sol:307-310 source read: strict
  inequalities, band (990000,1010000) exclusive) so the spec's "0.99 no-op" was false at
  exactly its named point — implemented source law, THREE stable scenarios incl. the
  boundary discriminator, both edges pinned; spec §6 + risk-quant consult + derivation-notes
  CORRECTED this commit. (2) plan interface block uncompilable (type/func name collisions)
  → Compute* prefixes. (3) the wave brief's ray values were MY approximations — file won
  (as instructed), laws unchanged, recorded so they don't propagate. (4) store.ParamRow ≠
  plan sketch; internal/risk defines its own + engine/chain tags — **store→risk ParamRow
  adapter is UNWRITTEN, owed to Task 5**. (5) ProjectDMDebt closed form diverges from the
  chain's two-floor path (unreachable from the plan's signature) — divergence PINNED with
  integers at exactly 1 USD-6-dec unit; result labeled PROJECTION, never gated exact.
  FOURTEEN deviations, all justified, ALL ACCEPTED (headlines: D3 engine-tagged ParamRow
  refusals block a silent 1e16× threshold error; D11 LowestHealthyPrice — floor(P*) is
  already a liquidating price, off-by-one in the dangerous direction, pinned; D13 the
  marketRealizationPass seam proves HFsUnchanged isn't hardcoded; D8 engines never blended
  in aggregates — per-engine rows with declared scales, flat sums nil for mixed books; D14
  refuse-don't-pick posture incl. provenance-class refusals per spec §7). Open items owed
  forward: ParamRow adapter (Task 5); Aave LiqBonus deriver-population confirmation; pro-
  rata seizure model disclosed (conservative variant on request); lens baseAsset composition
  inferred not read (Task 6 probe candidate); waterfall grid WAD-scaled; -race still owed.
  NEXT: commit → FABLE ADVERSARIAL RE-DERIVATION (independent recomputation, per the
  standing money-code protocol) → Codex round.
- FABLE RE-DERIVATION VERDICT (risk-quant, ~19min): **NUMBERS DO NOT HOLD — two blocking
  arithmetic defects that 103 passing tests could not see**, found by source reads + LIVE
  tokenConfig probes the wave skipped. (1) liquidUSD (27.1% of book) is rate × snap(USDC):
  the stable snap applies to the BASE inside PriceProviderV2's composition (:268-271; live
  read: baseAsset=USDC, isStableToken false on the composite, true on the base) — the
  in-band control scenario moved an asset the chain provably holds flat, breaking its own
  declared zero-change invariant. (2) the bad-debt/recoverable leg used the MIN bonus
  multiplier — maximizing recoverable, UNDERSTATING insolvency ≤~3% on mixed-bonus books —
  under a docstring claiming conservatism; correct law is the chain's per-token form
  Σ floor(vᵢ·100e18/(100e18+bᵢ)) (DebtManagerCore.sol:625). Also: three mutation-survivable
  laws named with exact discriminators (component-4 floor vs half-up both engines; Aave
  HF==1e18 eligibility strictness; the mixed-bonus insolvency vector); D10/D11/D8/pro-rata
  ACCEPTED (D11 verified at the boundary integers both engines); inferred lens composition
  REJECTED as standing state → tokenConfig probe PROMOTED TO REQUIRED in plan Task 6 (this
  commit); the wave's snap-band correction CONFIRMED against both deployed sources ("my
  R3(d) was false at exactly its named point"). Every other law reproduced EXACTLY under
  independent recomputation with integers shown, incl. the full waterfall bad-debt column
  and both liquidation-price boundary directions. THE MODEL-SPLIT PROTOCOL VALIDATED: Opus
  transcribed every pinned law perfectly; both failures lived in the UNPINNED corners where
  only re-derivation looks. Fix wave 4b dispatched to the original wave agent (both
  blockers + three should-fixes + cosmetics); Codex round follows the fix.
- WAVE 4b LANDED (2026-07-29 10:54): both blockers fixed with the wave INDEPENDENTLY
  RE-VERIFYING the ruling's arithmetic before implementing (PriceProviderV2.sol:260-277
  quoted — the base IS snapped inside composition, and :354 proves composite≠stable, so the
  old note was exactly half-right). Blocker 1: base_stable_snap transform (three-way switch,
  never multiplies raw factor; loader guards mirror chain invariants incl. the XOR at :354);
  liquidUSD rows corrected in all three stable JSONs; regression fixture holds liquidUSD +
  USDC side-by-side with BIT-IDENTITY asserted on the in-band control. Blocker 2: per-token
  bonus law (recoverableDebt = Σ floor(vᵢ·denᵢ/numᵢ) chain-shaped; both collapse helpers
  DELETED); mixed-bonus vector pins the $28.56 understatement on a $2k position; reduction
  proof shows single-bonus positions byte-identical (no prior number moved). DISAGREEMENT-
  BY-GOING-FURTHER accepted: min-bonus removed from at-risk too (one law on one page;
  collapse direction not obviously safe for cascade figures; direction-split docstring +
  preference-order disclosure). Should-fixes: exactly-half AND super-half valuation vectors
  BOTH engines; HF==1e18 strictness pinned both call sites (D+1 eligible). Cosmetics incl.
  SeizureModel on the wire (hyphenated token — Task 7 OpenAPI enum note). 113 tests / 99
  subtests, coverage 99.1% held, integrator re-verified (build/vet/test/gofmt clean).
  SHARPENED OPEN ITEM: the 1.00× bonus fallback is now load-bearing on recovery — Task 5's
  ParamRow adapter MUST carry LiqBonus through or Aave bad-debt silently uses par (deriver
  populates it per Wave 2a; the adapter is the remaining link). base_stable_snap applied to
  liquidUSD only — the REQUIRED Task 6 tokenConfig sweep closes the class by enumeration.
  NEXT: commit → risk-quant re-read for the verdict flip → Codex round on the full Task 4
  range.
- RISK-QUANT RE-READ: **NUMBERS HOLD, blocking list EMPTY** (verdict flipped at 0d204fa).
  The re-read verified the reduction proof on ITS OWN integers (single-leg algebraic
  cancellation confirmed; mixed-bonus pins reproduced to the digit), ruled the wave's
  go-further at-risk unification "arithmetically right" (the collapse understated the
  seized-slice on mixed books — wrong direction for a cascade input), and verified the
  base-snap transform arithmetic bit-for-bit (in-band identity by construction; boundary
  1156320 / unsnapped 1144640 match the chain composition). Three NON-BLOCKING doc notes
  (micro-wave 4c dispatched): (1) "reduces EXACTLY" qualified — per-leg exact, multi-leg
  single-bonus ≤(n−1) ULP low in the safe direction (counterexample: two legs v=d=
  1000000001 @2% → 1020000000 vs 1020000001); (2) base-snap arm presumes snapped-par
  stored base (true for the instrument's life; the depegged-era form is
  snap(base_now·f)/base_now); (3) the joint base+rate shock is the known guard refusal
  requiring a factor-composition schema extension — refuse-loud until then, BY DESIGN.
  After 4c: Codex round on the full Task 4 range (a5d82a9^..HEAD).
- **TASK 4 CLOSED — SHIP** (2026-07-29 12:06, closing session 019faf40-9500-7e83-aa31-
  be0e9fa11467, verdict approve, no material findings). Full program: Wave 4 (Opus build,
  99.1%, five authority contradictions surfaced) → risk-quant fable re-derivation (2
  arithmetic blockers: liquidUSD base-snap, per-token bonus law → 4b fixed → re-read
  NUMBERS HOLD, blocking list empty) → 4c verdict-note docs → Codex round 1 (2H/4M:
  *big.Int aliasing incl. one beyond the finding, non-price-axis waterfall false-safe,
  watermark threading with the masking test, presence-aware loader, go/types float gate
  proven by injection, stale plan line) → 4d fixed → Codex round 2 (1M: partial-watermark
  acceptance) → 4e engine-aware requireWatermarks → **closing APPROVE**. Final state:
  internal/risk at 8a56e16, 99.2% coverage, 135 top-level tests, arithmetic
  triple-witnessed. Commits: a5d82a9 / 0d204fa / 618279d / e20dfda / 8a56e16 (+ lease
  renewal 49eed1b-adjacent). Owed forward (named): store→risk ParamRow adapter with
  LiqBonus passthrough (Task 5), tokenConfig REQUIRED sweep (Task 6), -race on a
  CGO-capable runner (W2 acceptance), OpenAPI SeizureModel enum token (Task 7). Inert
  locked worktree dirs accumulating for bulk cleanup: C:\wtclose\{w2a,w2b,w4,w4d,w4e},
  scratchpad\wave2a-review.
- BACKFILL: cursor 24.05M at 11:45 (+1.97M/h on the Infura lane) — completion imminent;
  harness milestone LONG passed; custody of both Task 3 leg regions verified against the
  probe record (46 cluster logs = getBlockReceipts count; 3+3 Pool logs at the
  LiquidationCall pair). NEXT: Task 3 (harness) + Task 5 (riskd) waves dispatched in
  parallel on Opus — disjoint trees (internal/pipelinereplay+Makefile vs cmd/riskd+store).
- SCOPE GAP CAUGHT BY THE GATE (2026-07-29 00:40): recon/feeds.json is NOT in W2
  allowed_paths (W1 had it; W2 authoring missed the price-registry mirror) — pre-commit
  correctly BLOCKED the 2b commit. Fix: W2 allowed_paths += recon/feeds.json (durable
  contract change under the standing owner delegation), claim.py rescope, commit under
  ack. NEXT: commit 2b, Codex round, ONE daemon restart (00011+00012 + configurator
  backfill + healing pass — watch stamped/unstamped and behind-frontier honesty).
- WAVE 2b SHIP (round 1, session 019facd3-ae7c-7c53-a529-2188d9ae7b93, verdict approve,
  ZERO material findings): "chain-time as-of threading, healing identity/scoping/
  idempotency, shared poll-round anchoring, registry collision gates, migration, and read
  surfaces satisfy the binding requirements"; 49eed1b verified metadata-only. TASK 2 CLOSED
  under D-006: Wave 2a two rounds (1 doc-only medium), Wave 2b one round clean.
- DAEMON RESTARTED (2026-07-29 00:57, build-next-then-swap, old PID 46964 killed, binary
  swapped, prev kept as solvent-indexer-prev.exe): goose v10→12 (00011+00012 applied);
  eth:aave-param stream live (start 20,625,519, window 2000, confirmations 5); backfill
  opened and immediately exhibited the PREDICTED A2 posture (dRPC non-landing → publicnode
  archive-wall 403 → loud 29s backoff, self-healing). **HEALING PASS COMPLETE ON FIRST
  STEP: 51,954/51,954 pre-00012 feed rows stamped (0 unstamped, candidates=51,954, ~22s),
  strict-decoder replay, no value columns touched.** First adapter-output rows landing:
  4 aaveoracle: rows/round with source_as_of populated. /readyz honestly FALSE while
  aave_param walks the year of history (frontier-lag recoverable class — designed
  disclosure, not a fault); /healthz live. Backfill monitor armed (15-min cursor polls,
  stall alarms, completion event unblocks Task 3 pin freeze). NEXT (on backfill
  completion): freeze Task 3 pins from raw_logs, dispatch the harness wave (Opus); Task 4
  (internal/risk money code) HELD for the morning fable-vs-opus conversation with the
  owner per the standing model-split note.
- **BACKFILL COMPLETE** (2026-07-29 12:45, monitor event): eth:aave-param cursor
  25,640,662 — past head target 25.6M. Full param custody genesis-cluster (20,713,917)
  → head; ParamsAsOf authoritative at any block. Task 3 pin freeze UNBLOCKED — relayed
  to the in-flight harness wave agent (finalize pins against the live DB ledger, expected
  params from the (block,logIndex)-ordered prefix, NOT chain re-reads). Infura lane did
  the 5M-block year in ~half a day vs the projected weeks on dRPC. Monitor bfrhep6he
  retired (stream ended on completion). State at this event: HEAD=origin/main=925790e;
  Wave 3 (pipelinereplay) mid-probe on the liquidation range; Wave 5 (riskd) writing
  store risk surfaces (untracked trees: internal/pipelinereplay/, internal/riskfeed/,
  cmd/riskd/, migration 00013, store/risk.go — both agents editing MAIN tree on disjoint
  paths per dispatch). NEXT: wave reports → per-wave verify/commit/Codex to SHIP.
- OUTAGE INTERLUDE (12:50–14:58): upstream API 500s/529s killed both wave agents
  repeatedly mid-response; owner called the pause ("status says its down, pause if we
  have another issue"). Both agents parked with work intact on disk, resumed from
  transcripts on owner "continue" — ZERO work lost across 4 terminations. Daemon
  unaffected (PID 32100). **/readyz FLIPPED TRUE on its own** post-backfill
  ({"ready":true,"live":true}) — the frontier-lag disclosure resolved exactly as
  designed, no intervention.
- **WAVE 3 (harness) LANDED — 4c638da** (2026-07-29 15:12). internal/pipelinereplay
  (harness_test.go 690 + pipeline_replay_test.go 1043, TEST-ONLY package — no non-test
  files, nothing can import it), Makefile test-pipeline-replay target, .env.example
  ANVIL_FORK_RPC_ETH block. Three legs on hash-pinned anvil forks (20,714,020 /
  21,469,984): leg 1 raw_logs == fork getLogs == 22 fixture byte-identities + runtime
  genesis proof + 9 scaled + 8 rayMulHalfUp welds (FRAX non-trivial 1e18→1.00000006e18)
  + 4 param welds + 4 registry welds; leg 2 two-door custody (getLogs+receipts), 14/14
  gated decode, 2 LiquidationCall parser differentials, derive_cursors asserted empty;
  leg 3 full reorg choreography (ACL on-chain, anvil_reorg(3), gate refused→both engines
  acked→allowed, 1 row 0 orphans old-LTV). INTEGRATOR RE-VERIFIED: opted-in 3/3 PASS
  17.96s in MY hands, non-opted 3 SKIPs + sanitizer PASS, vet/gofmt clean (gopls
  "undefined: weETH" diagnostics were stale AGAIN — compiler-truth rule holds). Wave
  deviations ACCEPTED (5, all disclosed w/ justification): no-mining all legs;
  confirmations=2 on non-advancing fork; leg-3 spacer blocks after NEW PROBED FINDING
  (forked anvil cannot anvil_reorg to its own fork base — v1.7.1 depth-5-of-5 → -32001;
  encoded as runtime guard); param weld widened 2→4 reserves (census was fixture-sample
  count, chain has 4 — initializedInRange guard keeps R5 scope); contracts.json read
  directly (production registry, not transcription). CONTRADICTION HANDLED RIGHT: my
  unblock note said derive-expected-from-DB-ledger; wave kept brief R5 (chain as
  expected side — else one witness through two doors) and ran the live-ledger agreement
  OUT-OF-BAND instead: **92/92 logs in the leg-1 range, replay custody == live ledger
  across two providers AND two window sizes (10 vs 2000)** — strongest number in the
  report. Declined promoting it in-harness (would couple opt-in harness to
  SOLVENT_DATABASE_URL). Ops note: TEST_DATABASE_URL not in .env — export inline for
  opted-in runs (harness FAILS loud when opted-in without it, by design; verified).
  NEXT: Codex round on 4c638da = the joint Task 2+3 closure gate.
- CODEX ROUND 1 ON HARNESS (session 019faff2-9678-7871-8746-24b7a9307996, ~9min,
  worktree C:\wtclose\t3 pinned at 4c638da, sibling wave's untracked files confirmed
  NOT leaked): **needs-attention, 1 HIGH** — riskGate has no required-engine set
  (refuses only when NO cursors exist, then judges whichever cursors are returned), so
  honest startup with a position cursor but no aave_param cursor ALLOWS with params
  unavailable; leg 3's refusal assertion is a boolean the Aave cursor alone satisfies,
  and it drains both runners before checking Allow — a gate ignoring aave_param
  entirely would PASS the closure harness. Adjudication: FIX-WORTHY (honest-use false
  green — the exact D-013 class). Fix wave dispatched to the original harness agent:
  required (engine,chain) set in riskGate refusing every missing cursor BY NAME;
  leg-3 ordering assertions (refusal set == exactly both engines → ack Aave first →
  still refuses naming aave_param ALONE → param rewind+rederive → only then Allow);
  explicit no-cursor-row startup refusal. **CROSS-POLLINATION (binding on Task 5):
  the REAL gate in cmd/riskd must satisfy the same law — required-engine set, refuse
  by name, never allow on partial cursor presence. Goes in Wave 5's verification and
  its Codex brief.** Codex sandbox couldn't run Go (temp-dir denial) — integrator's
  opted-in runs remain the execution evidence; re-run owed after the fix lands.
  Worktree t3 joins the inert locked-dir cleanup list.
- HARNESS FIX WAVE LANDED — cce2cf1 (2026-07-29 15:37). Wave confirmed the finding
  ("my leg 3 did mask it"). riskGate rewritten: required (engine,chain) set, blocks on
  MISSING / WRONG-CHAIN / LAGGING with Blocking[] naming every one; no-cursors =
  degenerate case; empty requirement set = hard error ("a gate that can only say yes
  isn't a gate"). Wrong-chain clause is one step past the finding (disclosed +
  justified: ParamHead distinguishes no-custody from other-chain custody). Leg 3 →
  SEVEN exact-set verdicts; step 2 ({aave_param} MISSING alone) constructs its window
  with a NotContains guard that fails loud if the window disappears; step 6 (position
  acked alone → {aave_param} LAGGING) is the one-at-a-time discriminator. MUTATION
  PROOF 4/4 KILLED at exactly the designed steps — incl. mutant D (wrong aggregate
  "has ANY engine acked", survives 1-5, dies only at step 6). Integrator re-verified:
  opted-in 3/3 PASS 18.3s (legs 1-2 byte-counts unchanged), non-opted 3 SKIPs +
  sanitizer PASS, vet/gofmt clean. .env.example NOT staged (its pending diff is now
  the sibling wave's SOLVENT_RISKD_DATABASE_URL block). Wave's Task-5 note, now
  standing: the requirement set belongs in the REAL watermark reader itself, not just
  in what tests it. NEXT: Codex round 2 on delta 79f19c4..cce2cf1 — approve closes
  Tasks 2+3 jointly.
- **TASKS 2+3 CLOSED — SHIP** (Codex round 2, session 019fb007-f18d-7ef3-92f5-
  dd969dfbff33, ~4min, worktree t3r2 @ cce2cf1): "commit cce2cf1 closes the round-1
  HIGH. The required-engine gate is strictly per engine/chain; the constructed
  missing-param and lagging-param windows are fail-loud; exact blocking comparisons
  are sorted, order-independent, and do not mask duplicates. The four claimed mutants
  are discriminated by the seven verdict sequence. APPROVED: this clears the joint
  Tasks 2+3 closure gate. No material findings." Harness program: 1 round + 1 fix
  wave + 1 clean round. t3r2 joins the inert locked-dir list.
- **WAVE 5 (riskd) LANDED — 2cd01d4** (2026-07-29 15:55, 24 files, +7297). cmd/riskd
  (pass loop, schema-13 refusal smoke vs live v12, purity via go list -deps link-graph)
  + internal/riskfeed SEPARATE package (fold/gate have Task 6/7 consumers) + store
  risk.go/migration 00013. FOUR OWED OBLIGATIONS all addressed: (1) FoldParams
  per-field last-non-nil, LiqBonus proven to storage (10600 read back from
  risk_position_legs) w/ masking fixture asserting its own non-vacuity; (2)
  engine-aware Marks (Aave Balances+Params, DM +per-account last_success_block),
  cold-start refusal names the missing stamp; (3) three-state sweep law exact
  (refused/refused/computed+flagged-at-last-success); (4) adapter-output-only Aave
  STRUCTURAL (uncapped rows never enter the key set; welded to committed feeds.json).
  Deviations accepted: deferred FKs (orphan aborts at COMMIT — proven); DMParamsAsOf
  new public (DM params not in param_history; synthesized from custodied
  position_events, zero RPC, chain-truth R3); CollateralTokenRemoved DROPS row
  (delisted → refuse, not stale-threshold false safety); pg_notify in-tx (delivers at
  commit iff batch landed); risk_scenarios/risk_waterfall UNPOPULATED by design (owed
  w/ ProjectDMDebt Marks leg); NOLOGIN role, exception-guarded GRANTs. DISCLOSED
  LIMITATION (new, honest): aave_collateral_flag_unwitnessed on every Aave position —
  isUsingAsCollateral has no indexed witness, error direction false safety, closable
  via ReserveUsedAsCollateralEnabled/Disabled already in raw_logs (deriver work,
  candidate micro-task). WAVE FINDINGS: (1) .env lacked TEST_DATABASE_URL → local
  full-suite greens were partially VACUOUS (live-DB tests silently skipping) — FIXED:
  var added to .env (gitignored) + documented in .env.example; (2) -race still owed
  (no CGO); (3) parallel-package DB collision found+fixed with package-exclusive
  solvent_test_riskd (single-package green cannot detect this class). INTEGRATOR
  RE-VERIFIED: build/vet exit 0, FULL suite exit 0 with both DSNs (16/16 ok — my
  earlier TEST-only-DSN run correctly failed CLOSED on the destructive-split guard,
  the guard working as designed). OWED: promote harness riskGate → riskfeed.GateEpochs
  import (plan's Task-5 promotion; one-line per the wave; do with/after the riskd
  Codex round). NEXT: Codex round on 74e0309..2cd01d4.
- CODEX ROUND 1 ON RISKD (session 019fb014-3039-7bf2-883a-fbf4368eee9a, ~11.5min,
  worktree t5 @ 2cd01d4): **needs-attention — 3 HIGH + 2 MEDIUM, ALL adjudicated
  fix-worthy** (every one is wrong-answer-in-honest-use). (H1) GateEpochs REGRESSES
  THE BINDING LAW — missing cursor appends to Missing but OK stays true, no ChainID
  binding (wrong-chain cursor judged against the wrong chain's epochs → compute on an
  unproven param head). The cross-pollination worry materialized in the REAL gate;
  vindicates recording it as binding. (H2) sweep mutations invisible to the polling
  vector (derive cursors + reorg epochs only) → SWEEP_NEVER refusal survives first
  success; unflagged result survives post-success failure, until an unrelated cursor
  moves. (H3) conflicted accounts VANISH (riskBalances deletes the account's rows,
  Assemble enumerates only Balances) — false-safe "no position" instead of the
  promised G3 refusal. (M4) ambiguous commit + retry rebaselines previousPrices →
  G5 large-step flag erased on the duplicate batch. (M5) NewestCompleteBatch accepts
  position-count + any-one-stamp — a torn/partial restore serves HF without input
  evidence; the guard doesn't guard its own premise. FIX WAVE dispatched to the wave
  agent with all five + Codex's demanded test shapes (missing/wrong-chain gate
  mutants; sweep transitions with all derive cursors held fixed; conflict e2e to
  refusal row; commit-indeterminacy G5 retention; per-relation completeness
  negatives). AUTHORIZED: edit migration 00013 IN PLACE (never applied to a durable
  DB — live is v12, test DBs recreated per run); harness promotion stays a separate
  micro-wave AFTER the gate fix. t5 joins the locked-dir list.
- RISKD FIX WAVE LANDED — 6cb5c71 (2026-07-29 16:55, 16 files +2255/−318). All five
  findings fixed with per-fix revert-discrimination proof. (1) GateEpochs →
  []RequiredCursor{Engine,ChainID}, (verdict,error); missing_cursor / chain_mismatch /
  unacked_epoch all named refusals, Missing list DELETED (no reported-but-passing
  state); wrong-chain fixture acked-on-its-own-chain so a chain-blind gate all-clears
  exactly the must-refuse input. (2) sweep state in the vector as durable 4-part key
  (rows, failed, SUM(last_success_block), MAX(updated_at)) + generation/open, stamped;
  SUM-not-MAX (lagging account behind higher peer — pinned); live tests hold ALL
  cursors/epochs fixed (asserted) while sweep transitions force batches; Aave gets NO
  sweep stamp BY DESIGN (no-sweeper ≠ swept-nothing); errVectorDrift caught the
  poll/snapshot set mismatch in development — assertion earning its keep. (3)
  BalanceConflicts carries engine+account; Assemble seeds from UNION → conflicted
  account = counted G3 refusal row. (4) idempotency_key UNIQUE per prepared pass,
  reconciled on BOTH interruption paths (commit error AND 23505 insert collision —
  wave initially handled only commit; ITS OWN TEST caught the gap); G5 retention
  pinned. (5) completeness = declared cardinalities + required_engines[] +
  aggregates-cover-positions + composite FKs; 7 negatives (6 kill pre-fix predicate,
  position-count one already held). BEHAVIOR CHANGE accepted: riskd refuses to
  publish until EVERY claimed engine has proven custody — 7 fixtures gained real
  cursors, gate NOT loosened. Integrator: build/vet 0, full suite 16/16 both DSNs;
  23 files of whitespace-only gofmt/CRLF churn REVERTED pre-commit (diff -w proven
  empty; keeps the Codex delta surgical). NEXT (parallel): Codex round 2 on
  a0e37e5..6cb5c71; promotion micro-wave (harness riskGate → riskfeed.GateEpochs,
  signature (cursors, maxEpochs, []RequiredCursor) → (verdict, error)).
- PROMOTION LANDED — 8ae5774 (2026-07-29 17:04, 2 files +107/−140 net-negative). The
  harness holds NO gate implementation of its own (riskGate/requiredCursor/gateVerdict
  deleted, grep-verified). GateEpochs exercised through riskd's REAL call path — both
  inputs read inside one store.BeginRiskSnapshot per the production contract, not
  hand-fed structs. The two independently-derived laws mapped with NO contradiction
  (wrong-chain/chain_mismatch convergent, not copied); seven verdicts unchanged, now
  also pinning WHICH refusal class fired (missing_cursor 1-2 / ALLOW 3,4,7 /
  unacked_epoch 5-6); step-3 empty-epochs semantics verified identical (map-miss zero
  == COALESCE). Added TestGateEpochsRefusesAnEmptyRequirementSet (pure unit — the
  clause stopping a mis-computed requirement list from rubber-stamping was otherwise
  untouched by harness calls). Mutation retargeted to what stays harness-owned: drop
  aave_param from the requirement set → dies at step 1 naming it. Integrator:
  opted-in 3/3 PASS 18.7s (legs 1-2 unchanged), non-opted 3 SKIPs + 2 unit PASS,
  build/vet/gofmt clean. From here the closure harness and riskd share ONE gate law —
  the round-1 defect class cannot silently recur in either. NEXT: riskd Codex round 2
  verdict → Task 5 close (promotion delta offered for coverage if Codex flags it).
- CODEX ROUND 2 ON RISKD (session 019fb050-44f5-7ff1-a06a-bd0084795f29, ~11min,
  worktree t5r2 @ 6cb5c71): **needs-attention — 2 MEDIUM residuals; gate, sweep-
  trigger, and conflict fixes ACCEPTED as sound.** (M1) idempotency key is
  attempt-scoped — discarded when WriteRiskBatch errors, so commit-lands-then-
  reconciliation-ALSO-fails → next tick mints a NEW random key, rebaselines on the
  committed post-move price, writes an unflagged duplicate (round-1 M4 harm survives
  outside the happy reconciliation path); same harm from a second honest instance.
  (M2) completeness proves a watermark ROW per required engine but sweep columns are
  all nullable and no sweep-applicability set is persisted — a restored DM stamp with
  only cursor fields passes, reader leaves Watermark.Sweep nil, swept engine becomes
  indistinguishable from no-sweeper, stale DM risk served as current. Both
  adjudicated FIX-WORTHY (crash/restart/restore are honest ops). FIX WAVE 2
  dispatched: (1) DETERMINISTIC materialization identity (full vector + sweep state
  + policy/config + payload identity — not random), any honest process derives the
  same key and adopts-after-identity-verify or declines; (2) pg_advisory_lock
  single-writer at startup (structural exclusion, not disclaimer); (3) Codex's
  commit-lands/reconcile-fails/G5-survives e2e; (4) sweep applicability persisted
  structurally (required set or NOT NULL flag) + CHECK all-or-nothing sweep column
  group + completeness negatives incl. partial-null, with Aave no-sweeper positive
  control preserved. t5r2 → locked-dir list. Task 5 stays OPEN pending round 3.
