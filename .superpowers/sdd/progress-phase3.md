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
- **TASK 6 PRE-BRIEF CONSULTS ARCHIVED** (both verbatim in p3-consults/, NORMATIVE
  for the Task 6 wave): risk-quant-task6-brief.md (60ed4bf) — VERDICT on plan Task 6
  text as acceptance: NUMBERS DO NOT HOLD, 5 blockers (infeasible ≥20 floor vs the
  chain's 12 finite-HF borrowers; self-referential param weld; tautology backtest
  clause → 4 per-case obligations incl. bit-exact beforeDebtAmount replay + frozen
  committed 31-tx frame; toothless B3 → refute-or-grade with phase-boundary split;
  missing derived-vs-pinned input-frame declaration); EXACTLY THREE tolerances
  permitted (1-wei residue on full liquidation; one-token-wei seizure round-trip;
  disclosed intra-block marginality band) — any other epsilon = tolerance-as-carpet,
  blocks. chain-truth-task6-brief.md — VERDICT: CUSTODY HOLDS conditional on 6
  blockers (population-derived census-welded floor; adapter weld at STORED anchor
  hash + backtest at STORED raw_logs.block_hash, never re-resolved live; archive-
  served-zero proof w/ nonzero control in all-zero chunks + len==0 refused by every
  new unpacker; param weld A-vs-B with feeds.json as CLAIM gated both directions
  against chain; tokenConfig sweep = pinned-read SAMPLE over chain∪registry union w/
  impl-slot record + baseAsset transitive closure; heartbeat gaps attributed only
  after custody-domain bounding + proxy aggregator() phase check). The two consults
  AGREE on the ≥20-floor blocker independently.
- **COLLATERAL-FLAG MICRO-TASK SIZED: GO + material finding** (chain-truth probe,
  read-only RR snapshot): topic0s independently re-derived and matched; census 98
  Enabled + 75 Disabled = 173 logs, 94 users, ONE reserve (weETH), all in custody
  with four agreeing completeness witnesses (coherent-window law, dual-witnessed
  census match, state-machine closure Enabled⊇Disabled users, LTV-0 source-law).
  FINDING: riskd's assume-true collateral posture is wrong for 35/58 (60%) of
  positive collateral rows — 34 stables (USDC/FRAX/PYUSD) have flag=false BY
  CONSTRUCTION (never configured as collateral, auto-enable never fired) + 1 real
  opt-out (0x2c64…0649, weETH dust). HF right BY ACCIDENT (their LT=0 zeroes the
  numerator term) but totalCollateralBase-class outputs (served collateral USD,
  avgLT, waterfall collateral-at-risk) are WRONG today. Law for the fix:
  witnessed-true / witnessed-false / no-history⇒false (conservative direction).
  Backfill mechanism BINDING: rewind-and-rederive (the leg-3-proven machinery),
  NEVER out-of-band inserts beneath a live cursor; maintenance-window choreography.
  Micro-wave surfaces: decode (2 topics, strict empty-data reader), derive/aave
  (record-only fold), store (CollateralFlagsAsOf), riskfeed/assemble (retire
  FlagCollateralFlagUnwitnessed). Sequence: before or alongside Task 6.
- CODEX ROUND 3 ON RISKD (session 019fb07c-023c-7f32-8efd-c32ba0a100f2, ~10.5min,
  t5r3 @ 1d46925): **needs-attention — 4 MEDIUM, all identity/adoption; sweep CHECK
  and vector/digest comparison confirmed SOUND.** (1) identity serializes ALL derive
  cursors, not the consumed set — an UNRELATED cursor (prices:chainlink_feed:1)
  advancing between flagged pass and restart mints a new key → unflagged duplicate →
  round-2 M1 REOPENED through the side door. (2) ReadAt excluded entirely — a
  poller-stopped restart computes stale/G1 but derives the ORIGINAL key and ADOPTS
  the batch persisted as "fresh" (the IgnoresTheClock test pinned the collision
  without output-equivalence). Fix: deterministic freshness PHASE (fresh/stale/
  over-ceiling) in the key, raw clock stays out. (3) Producer hard-coded, no
  registry fingerprint — upgraded math or a token-decimals registry fix ADOPTS the
  old-code/old-scale batch. Fix: algorithm revision constant + canonical registry
  fingerprint. (4) adoptRiskBatch verifies header only — a partial restore with
  matching header adopts, logs success, reader refuses: no complete batch exists but
  the vector reads handled. Fix: adoption passes the SAME completeness predicate as
  serving. FIX WAVE 3 dispatched with all four + Codex's demanded regressions
  (unconsumed-cursor advance; phase-crossing; revision-only + decimals-only;
  same-key partial restore). PATTERN NOTE for the record: rounds 2→3 are converging
  on the same lesson — every input the OUTPUT depends on must be in the identity,
  and everything the identity admits must be verified on adoption. Task 5 open,
  round 4 pending.
- FIX WAVE 3 LANDED — 906af58 (2026-07-29 18:34; lease renewal 31e3459 preceded it
  after the 8h expiry blocked the commit — routine mechanics). All four round-3
  findings fixed with revert-discrimination proof: (1) identity consumes
  vector.consumedCursors() — ONE source of truth, no parallel filter; live
  regression = Codex's exact chainlink-cursor sequence, identical keys + G5
  retained; counterweight proves consumed cursors still move it. (2) deterministic
  freshness phase via PriceFreshnessPhase SHARED with JudgePriceInput (served
  verdict and identity cannot disagree); boundaries pinned 180/181 + 360/361s;
  IgnoresTheClock upgraded to output-equivalence. (3) AlgorithmRevision constant
  (bump-list names internal/risk) + Registry.Fingerprint(); wiring proven against
  the PERSISTED vector. (4) adoption shares riskBatchCompleteConjuncts with the
  serving path; REPLACE-not-refuse chosen (refusal livelocks under a deterministic
  key; replace conditioned on unservable + identity-verified + in-tx delete);
  same-key partial-restore + 5 per-relation negatives. WAVE'S OWN HONESTY: mutant 3
  initially SURVIVED (function-level tests can't prove daemon wiring — fixed with
  persisted readback); the e2e freshness test proven NON-isolating (as-of shift
  moves the digest) and replaced by the byte-identical-rows elapsed-time test.
  INTEGRATOR: build/vet 0; clean-cache full suite 16/16; riskd 3x isolated + 2x
  under concurrent store load. **ONE UNREPRODUCED TRANSIENT on the record**: first
  post-wave make test FAILED in cmd/riskd (output lost to /dev/null — lesson:
  never discard first-run output), unreproduced in 7 runs incl. load; suspected
  the load-bearing 5s-sleep elapsed-time test; hardening owed if it recurs;
  disclosed to Codex round 4 for a ruling on the test's timing assumptions.
  NEXT: Codex round 4 on 789a19e..906af58 — approve closes Task 5.
- CODEX ROUND 4 ON RISKD (session 019fb0a9-7610-7723-8677-34947f4ec8e9, ~10min, t5r4
  @ 906af58): **needs-attention — 1H/1M/1L, all freshness; rounds 3 F1/F3/F4 judged
  CLOSED; AlgorithmRevision convention ACCEPTED under D-013.** (H) freshness never
  wakes a steady-state daemon — vectorChanged covers cursors/epochs/sweep only, so
  an honest ingestion outage leaves a persisted-"fresh" batch published INDEFINITELY
  (no G4/G1 transition); the elapsed-time test called runPass directly and bypassed
  the loop. (M) identity phases over-scoped to ALL fetched registry prices —
  Assemble judges only position-referenced assets (and can return at G2 before
  freshness), so an UNUSED registered asset crossing a phase + restart re-creates
  the warning-erasure through yet another door. (L) the elapsed-time test's
  2-SECOND fresh window is a real load-dependent race — **plausibly explains our
  disclosed transient** (Codex explicitly declined to dismiss it as one-off; the
  lost output prevents attribution — the discard-first-run-output lesson compounds).
  FIX WAVE 4 dispatched: freshness deadline as scheduler input (force pass at next
  output-relevant phase boundary; REAL-loop test, no manual runPass; forced pass
  materializes-not-adopts asserted); identity phases scoped to output-relevant
  judgments incl. gate ordering (adopt-with-G5-retained regression + judged-asset
  counterweight); deterministic DB-clock seam replacing the 2s window (closes the
  hardening-owed item if it lands). Round-4 pattern: the erasure class keeps
  re-entering through unscoped inputs — round 3 unconsumed CURSORS, round 4 unjudged
  PRICES; same law, narrower each time. Task 5 open, round 5 pending.
- **BACKTEST FRAME FROZEN — d2498bd** (2026-07-29 18:57; plan Task 6 pre-wave
  deliverable, dispatched parallel to the fix waves). 31 cases (22 seeded + 9
  forced) appended to recon/p3-probes.md, pure append 348/0, read-only freeze
  (writes proven refused in-session), pins = stored raw_logs.block_hash, ZERO chain
  reads. Census re-verified exact (763/471/170/9,242; histogram matches); topic0
  re-derived from ABIs; era re-confirmed closed w/ no in-era impl upgrades. Keyed-
  permutation draw (md5(seed||tx:logidx), seed solvent-p3-task6-backtest-v1) —
  reproducible from psql alone; 3x byte-identical; digest 0x740ac240…f0fbf3;
  contiguous-prefix proof against cherry-picking. FRAME FINDINGS: (1) two-pass
  liquidations DOMINANT — 292/471 groups, 76.5% of events are pair members
  (qualifies risk-quant R2's rare-tail premise; both passes of one pair
  force-included — the frame's sole shared tx); (2) 74.2% single-account
  concentration is population-faithful under the committed per-event rule
  (disclosed, not re-specified); (3) per-bucket max-fanout force-include degenerate
  in B1/B2 (all events tie at 15 — disclosed so nobody over-reads it); global-max
  17 x3 and fan-out-1 x3 both in frame. Task 6 pre-wave deliverables now ALL
  present: amended plan (cf5faed) + two normative consults + frozen frame.
- FIX WAVE 4 LANDED — b399ea2 (2026-07-29 19:20, 10 files +730/−112). (H) freshness
  is a scheduler input: Assemble reports JUDGED prices + as-ofs; NextFreshnessDeadline
  computes earliest budget/ceiling crossing; runLoop (extracted so tests drive the
  REAL loop) forces a pass on freshnessDue measured on the DB clock; forced pass
  materializes-not-adopts, asserted; counterweights LoopDoesNotSpinWithinAPhase +
  LoopStillRecomputesOnVectorMovement. (M) identity ← assembled.Judged only;
  PhaseRelevant=false on G2/absent (absence lives in the substrate digest);
  unused-asset-crossing adopts w/ G5 retained, judged-asset counterweight. (L) 5s
  sleep GONE — DB-anchored as-ofs, asserted premise, atomic clock-skew seam;
  -count=5 wave + -count=3 integrator green — **the disclosed-transient hardening
  item is CLOSED with a root-caused deterministic fix**. Wave self-caught TWO more
  lying tests: the stop/restart loop test (mandatory startup pass fakes the signal —
  mutant A survived; rewritten to ONE continuous loop w/ live clock; mutant now
  times out) and FlaggedCount==1 passing because flag_unwitnessed is never zero
  (retargeted FlagStalePrice + clean baseline). Wave restored its own CRLF churn.
  Integrator: build/vet 0, full suite 16/16 both DSNs, timing tests -count=3.
  NEXT: Codex round 5 on e926b36..b399ea2 — SHIP closes Task 5; round-5 depth asks
  probe deadline/poll interplay, refusal-state re-arming, G2-exit identity joins.
- CODEX ROUND 5 ON RISKD (session 019fb0d5-96b0-7763-a887-10eb4e3db653, ~7min, t5r5
  @ b399ea2): **needs-attention — exactly ONE medium residual; ALL FIVE depth
  questions confirmed tracing correctly** (scheduler wake-up, late firing,
  refusal-state arming, G2 recovery, deadline re-arming, clock-seam production
  isolation). Residual = the round-4 scoping law through its LAST door:
  substrateDigest still hashes every fetched price row (only the phase section was
  scoped to Judged), so an honest D-012 in-place repair of an UNUSED registered
  asset (no cursor movement) changes the digest → new key on restart → clean batch
  written instead of adopting the flagged one → G5 erased. The round-4 regression
  missed it because it varied only elapsed time (digest byte-identical). FIX WAVE 5
  dispatched (surgical): Assemble reports the attempted/consumed price witness set
  (incl. consumed absences + G2-path consultations); digest price portion restricted
  to exactly that set; live regression (neutralize unused row in place → restart →
  same key, adopt, FlagLargeStep survives) + consumed-witness counterweight; plus a
  structural single-source-of-truth requirement so phases and digest project the
  SAME reported set and cannot drift apart again. Last finding before SHIP.
- FIX WAVE 5 LANDED — 4c10793 (2026-07-29 19:50, 6 files +407/−64, surgical). ONE
  reported set, TWO projections: Assemble reports []ConsultedPrice (every consulted
  witness: presence, value fields as seen, phase; PhaseRelevant=false on G2/absent);
  freshness section projects the PhaseRelevant subset; price digest projects the
  whole slice with consulted-absence recorded AS absent (absence → G1 must move the
  key like a value change); inputs.Prices feeds NO price section (sole remaining
  mention = the comment forbidding it; ConsultedPrice doc names itself THE single
  source of truth and says why). Live regression = Codex's exact shape (unused row
  neutralized+superseded in place, unchanged vector, restart → same key, adopted,
  FlagLargeStep survives; premise PROVED); consumed-witness counterweight correctly
  SURVIVES the digest mutant (that's what makes it a counterweight). Fixture-honesty
  fix disclosed: two old tests mutated inputs.Prices without mutating the consulted
  set — impossible pipeline state; idJudgedFrom keeps fixtures coherent, assertions
  undiminished. Integrator: build/vet 0, full suite 16/16 both DSNs. NEXT: Codex
  round 6 = CLOSING review on 564020d..4c10793 (depth: ConsultedPrice completeness
  across all gate paths; G2-exit phase joins; one last unscoped-input sweep; full
  round-2-M1 harm walk end-to-end across rounds 1-5 combined). SHIP closes Task 5.
- **TASK 5 CLOSED — SHIP** (2026-07-29 20:02, closing session 019fb0f0-3222-7b53-
  8ad1-411a4936121c, verdict approve, NO material findings). Verbatim: "Assemble
  records every successfully consulted witness before any refusal or computed
  return, including phase-less G2 and absent witnesses. Both price identity
  projections now consume the same ConsultedPrice slice; identity.go no longer
  reads inputs.Prices. G2 exit changes the consumed cursor/epoch vector and
  introduces relevant phases, preventing stale pre-G2 adoption... In the original
  round-2 M1 sequence... restart derives the same key, and adoption verifies
  vector, digest, and completeness before preserving the flagged batch. No material
  honest-use failure remains." Full program: initial wave (four owed obligations) →
  round 1 (3H/2M: gate law, sweep vector, vanishing conflicts, retry rebaseline,
  hollow completeness) → fw1 → round 2 (2M: attempt-scoped key, nullable sweep
  disclosure) → fw2 (deterministic materialization identity) → round 3 (4M:
  unconsumed cursors, ReadAt, namespace, adoption) → fw3 → round 4 (1H/1M/1L:
  no steady-state wake-up, over-scoped phases, test race → root-caused our
  transient) → fw4 (freshness as scheduler input) → round 5 (1M: digest scoping) →
  fw5 (ConsultedPrice single source of truth) → **round 6 SHIP**. Six rounds, five
  fix waves, 170 top-level tests, 0 skips. Codex's non-blocking note: -race on a
  CGO-capable runner before next wave's acceptance (the standing owed item; extra
  valuable now a test drives a concurrent loop). Commits: 2cd01d4 / 6cb5c71 /
  1d46925 / 906af58 / b399ea2 / 4c10793. NEXT: Task 6 wave + collateral-flag
  micro-wave dispatch IN PARALLEL (disjoint trees: cmd/reconcile vs
  decode/derive/store/riskfeed).
- **COLLATERAL-FLAG MICRO-WAVE LANDED — 62c6196** (2026-07-29 21:05, 19 files
  +2130/−82). Decode: ABI-derived IDs (literals only in the triple-witness pin
  test); strict reader w/ 16 malformed-shape refusals + canonical-zero
  counterweight; census re-verified read-only (98/75, zero dirty). Derive:
  record-only fold, DM precedent, NO migration (event_type is unconstrained TEXT);
  constants in internal/store (riskd purity gate forbids linking derive; shared
  constant closes spelling-drift-reads-empty). Store: CollateralFlagsAsOf with
  (block, logIndex DESC) tie law + RewindDerived-following pinned. Riskfeed:
  witness law (no-history⇒FALSE, conservative); FlagCollateralFlagUnwitnessed →
  FlagCollateralOptedOut/NeverEnabled (fire only on positive-balance exclusion,
  naming the witness state); AlgorithmRevision 1→2; identity gains consultedFlags
  scoped to CONSULTED set, absence deliberately not recorded (asymmetry with
  prices argued in code: absent price = G1 substrate fact, absent flag = the law,
  owned by the revision); backfill-choreography hazard pinned (pre.Vector ==
  post.Vector, pre.Key != post.Key). **FINDING REVISING THE CONSULT'S FRAMING:
  stables' folded threshold is ABSENT (only weETH ever got CollateralConfiguration
  Changed), so assume-true would have REFUSED all 31 stable-collateral accounts on
  the first live pass (internal/risk refuses counting-reserve-no-threshold) — not
  merely overstated collateral. The witness converts refusals into computed
  positions; both directions pinned.** Live impact reproduced at 25,643,063:
  58 → 23 unchanged / 1 witnessed-disabled / 34 no-history (USDC 25, FRAX 6,
  PYUSD 3). Design doc §declared-input AMENDED (pinned read = weld partner now).
  LIVE REWIND still owner-gated: RewindDerived to 20,625,518 + runner re-steps
  (~2,509 windows, zero RPC), riskd/api supersession legs fire honestly during and
  self-heal, post-rewind pass mints a NEW key by construction (revision 2 + flags
  in digest). Integrator: build/vet clean (scoped around sibling's in-flight
  cmd/reconcile), 6 packages green both DSNs, opted-in pipelinereplay 3/3 (leg 1
  now derives the flag logs). NEXT: Codex round on 5f584e2..62c6196; Task 6 wave
  still in flight.
- CODEX ROUND ON MICRO-WAVE (session 019fb138-0479-7a00-a376-4f63709047c0, ~8min,
  worktree cf @ 62c6196): **needs-attention — 1 HIGH, and it answered depth
  question (d): THE INTERIM STATE IS UNSAFE.** no-history⇒false is chain-exact
  only under genesis-complete flag custody, but nothing enforces the precondition:
  an honest rev-2 start BEFORE the owner-gated rewind reads the empty live flag
  ledger (0 rows) and zeroes the 23 genuinely-ENABLED weETH legs → borrowers with
  debt get HF 0 → false-liquidation-looking answers, WORSE than the retired
  assume-true for exactly those legs. Codex cited the wave's own law test as
  demonstrating the shape. Adjudication: FIX-WORTHY (the law shipped without its
  precondition; sequencing-by-runbook is not enforcement). FIX WAVE dispatched:
  durable derivation-provenance marker (coverage-from-StartBlock under a
  flag-inclusive decoder registry, set NATURALLY by completed rewind-rederive —
  not operator attestation); whole-engine riskd refusal (flag_custody_unproven)
  when absent/stale; e2e regression head-cursor+empty-ledger+no-marker REFUSES
  (the HF-0 shape unwritable) + real scratch rewind-rederive counterweight; the
  law test gains its explicit precondition; marker joins the identity (present/
  absent changes refuse-vs-compute — the standing law). LESSON FOR THE PATTERN
  BOOK: a derived-input law whose exactness depends on custody completeness must
  carry a CUSTODY-COMPLETENESS WITNESS in the same commit — this class recurs for
  every future decoder addition behind a live cursor.
- **TASK 6 WAVE REPORTED** (2026-07-29 21:45; 6,334 lines + 78 tests, all
  cmd/reconcile/**; NOT YET COMMITTED — tree shared with the in-flight micro-fix
  wave). Nine gates w/ exhaustive declared input frames + a consumption LEDGER
  gating undeclared-consumed, declared-unconsumed, AND unregistered epsilons;
  exactly-three-tolerances pinned at compile AND run time; census-welded cohorts
  (12 finite-HF; component-4 sharpness witness found live: remainder
  805661632746216530); frozen frame digest re-verified. **INCIDENT (21:27:59):
  the wave ran `git checkout -- .` from repo root, reverting ALL tracked-unstaged
  files incl. the sibling micro-fix wave's in-flight edits.** Wave's own files
  recovered (diff verified vs intent); the parallel P2 session's pgxdsn work was
  safe (committed f62aee8, verified ancestor of HEAD); micro-fix wave WARNED and
  ordered a post-incident audit + full re-verification before reporting. LESSON:
  wave briefs must BAN repo-root git checkout/restore — cleanup is file-scoped.
  **make reconcile = EXIT 2 PRECONDITION (honest):** live DB v12, binary expects
  14 (00013 + in-flight 00014); reconcile never migrates → NO Task 6 acceptance
  evidence exists yet; needs daemon restart AFTER 00014 finalizes, then the real
  run. THREE LIVE FINDINGS from the wave's opt-in production-ABI smoke: **(F1)
  internal/risk component-4 DEBT-leg law WRONG — we FLOOR the base conversion,
  the deployed Pool CEILS: totalDebtBase EXACT 0/12 as written, 12/12 under
  ceiling (golden: 137231×99981000/10^6 → chain 13720493 = ceil); collateral +
  currentLiquidationThreshold EXACT 12/12; direction FALSE SAFETY, magnitude
  ~1/totalDebtBase (7.3e-11 golden → ~1.8e-4 dust). The vToken-ceil/aToken-floor
  asymmetry carries into base currency. Task 4 surface — risk-quant consult
  dispatched; then internal/risk fix + revision bump + Codex.** (F2) DM boolean
  FALSE POSITIVE: 0x9fd6c4da…0747 — sweep holds 0 collateral legs, CashLens@pin
  shows 3/$69.07 → chain healthy, we'd alert liquidatable; sweeper gap, probe
  dispatched. (F3) B3 WILL REFUTE three published heartbeat budgets (FRAX
  170,712s / USDC 248,460s / PYUSD 604,896s vs 90,000; PYUSD weekly Apr–Jun
  2024; weETH/ETH qualifier 3,732s; phase-change check DONE, all 4 proxies still
  on walked aggregators) → expect exit 1 + feeds.json meta updates under ack.
  Deviations: impl-slot read substituted w/ raw-returndata sha256 (chain.Failover
  lacks StorageAtHash — follow-up); DM full-book census opt-in (verdictFree);
  backtest obligation-2 collateral = declared pinned read (no derived historical
  collateral exists). NEXT: micro-fix lands → post-incident verify EVERYTHING →
  commit micro-fix → commit Task 6 → Codex rounds → daemon restart (13+14) →
  make reconcile = the acceptance run.
- **RISK-QUANT RULING ON F1 — CONFIRMED FROM THE DEPLOYED VERIFIED SOURCE, AND A
  SECOND LAW ERROR FOUND** (archived verbatim: p3-consults/risk-quant-component4-
  7-ruling.md, NORMATIVE). Impl resolved via EIP-1967 today (0x0F3BCeB6…244),
  PoolInstance solc 0.8.27 pulled and read — source outranks pin counts. (Q1)
  Component-4 debt leg = MulDivCeil, CONFIRMED at GenericLogic.sol:229 +
  MathUtils.sol:100-115 (pure ceiling, not half-up); collateral floor confirmed
  :242-258. (Q2) **NEW: component 7 is NOT a single fused floor** — deployed law
  is HF = floor(floor((Σ(Cᵢ·LTᵢ)·1e18 + ⌊D/2⌋)/D)/1e4), the wadDiv HALF-UP
  composite (WadRayMath.sol:53-62) on the raw weighted sum with D = ceil-summed
  debt. Differs from our fused floor iff carry fires AND q≡9999 (mod 1e4) —
  ~5e-5 incidence: **Task 1's P-1 was an undetectably-good approximation that NO
  pin count could separate; only the source read caught it.** Error direction of
  the old form: false-alarm (benign) — but it is not the contract's law.
  Discriminators constructed (trivial Σ=1/D=1e14+1 → 1 vs 0; realistic
  99215323900/13720493 → …431 vs …430 + second witness). (Q3) blast radius:
  golden E2E re-pin (price 99992646), survivors named (M-1/M-2, liqprice
  boundaries, collateral vectors — all exact-division, verified), liqprice P*
  rises ≤1 D-unit in the SAFE direction. (Q4) component-7 composite = the same
  rode-along-unproven class, ships SAME rev; availableBorrowsBase stays evidence-
  only; pre-TokenMath regime guard (pin < 23,088,584 refuse/era-flag) REQUIRED.
  VERDICT: numbers do not hold for the fix as scoped — four-item blocking list;
  expects to flip on re-read. **REV-3 FIX WAVE DISPATCHED** (internal/risk +
  derivation-notes only; AlgorithmRevision 2→3 applied by integrator at commit —
  riskfeed is mid-flight with the sibling wave). Ruling's meta-note for the
  pattern book: the EXACT-EQUALITY gate posture is what caught F1 — ±1 tolerance
  on totalDebtBase would have carpeted a real law error 12/12.
- **SWEEP-GAP PROBE REPORT (F2 root-caused — TWO defects, and F2's subject was a
  timing artifact).** The named account is NOW swept byte-exact with chain (3
  legs, $69.07, verified at its own block AND the pin); its "0 legs" was a
  LITERAL frozen during a 15m19s new-borrower blind window and welded against a
  pin ~40-55 min later — a cross-time comparison. (DEFECT 1, structural,
  FAIL-CLOSED in prod): sweep universe is debt-event-gated and generations open
  only on cadence (3600s) or rewind — a first-time borrower has debt derivable in
  ~33s but collateral unknowable until the next generation (worst case ~1h);
  production paths REFUSE via GateSweepNever, so the cost is refused coverage,
  never false alerts. Fast-lane remediation designed (due-predicate EXISTS probe
  over never-swept accounts + runner hook, ordering already optimal — 0.59s
  pickup proven). (DEFECT 2, LIVE, NOT FAIL-CLOSED, in the Task 6 gate's OWN
  UNCOMMITTED CODE): task6db.go filters collateral legs at updated_block<=pin
  but reads sweep watermarks UNFILTERED; sweeps execute at HEAD>cursor and
  ApplySweepBatch replaces legs wholesale → mid-generation (~34% duty cycle) an
  account's only legs sit above the pin, get discarded, while SweepBlock still
  certifies them → zero collateral + valid watermark + debt>0 = liquidatable
  TRUE. **199/9722 accounts (~2%) right now; 5/5 chain-verified HEALTHY incl.
  $100,120 collateral.** riskd NOT exposed (riskBalances has no block filter).
  FIX ROUTED to the Task 6 wave (its uncommitted tree): pin discipline on
  collectSweepBlocks (last_success_block<=pin → else SweepBlock=0 → honest
  refusal) + the legs-above-pin-never-with-nonzero-SweepBlock regression + the
  frozen-literal smoke methodology fix. DEFERRED (post-current-waves): sweeper
  fast lane (P2) + per-account sweep-staleness flag (P3 — 118 accounts, 1.2%,
  have debt newer than last sweep; error BIDIRECTIONAL and the false-negative
  direction is worse for an alert product; the 9,242 record-only
  liquidation_collateral events are the cheapest collateral-reduction signal,
  currently unused).
- **MICRO-FIX WAVE (flag custody) REPORTED — commit PENDING one joint
  verification** (rev-3 wave is mid-edit in internal/risk, which riskfeed
  imports; my instant-verification hit that known race — decode/derive/store
  green, build+vet green pre-race, wave's own from-scratch post-audit full suite
  exit 0 incl. opted-in pipelinereplay 3/3). POST-INCIDENT AUDIT done properly:
  17 round-1 anchors verified in HEAD and tree; 38 round-2 anchors exactly-once;
  TWO silently-compiling revert defects found+fixed (orphaned doc block fused
  onto the wrong function; a stale comment). Design as directed: migration 00014
  adds derive_cursors.covered_from_block + decoder_revision, **defaults ARE the
  mechanism** (existing rows = NULL/0 = their true provenance → live DB comes out
  UNPROVEN, refuses with no operator action; a coverage-claiming default would
  have made the migration the bug); coverage set ONLY by ApplyDerivedWindow from
  the window's own from + decode.RegistryRevision (nothing configurable);
  revision-change RESTARTS coverage at this window's from; RewindDerived clears
  it atomically (else a rewind manufactures false genesis custody).
  GateFlagCustodyUnproven refuses WHOLE-ENGINE with rows naming bar+remedy,
  placed in Assemble so no caller can bypass; genesis from config.Streams, zero
  genesis fails closed. Identity: coverage rides the cursor line of the vector
  (…/cov20625519/rev2); replay choreography pinned (pre.Key != post.Key though
  every watermark returns). Schema pins → 14 both sites. DEPLOY-RISK INVERSION
  confirmed: pre-replay state is now SAFE BY REFUSING — the binary can ship
  before the maintenance window.
- **COMMIT TRAIN LANDED** (2026-07-29 ~22:45, tree clean after): **0df42da**
  micro-fix (flag-custody provenance, 23 files) → **559828c** rev-3 (component-4
  ceil + component-7 composite, 8 files incl. integrator's AlgorithmRevision 2→3
  bump w/ revision-log entry citing the archived ruling) → **e19a94f** Task 6
  (the proof surface, 34 files +9,861 — incl. the Defect-2 sweep-testimony fix
  and the hf_gate label/header updated for rev-3). Joint verification before the
  train: build+vet ALL, full suite exit 0 both DSNs; risk+riskfeed+riskd re-run
  green after the revision bump; reconcile packages green incl. the mutation-
  verified DB regression. rev-3 wave highlights for the record: 8/8 mutants
  killed; M-C (comp7→fused) killed by EXACTLY ONE test in a 99.2%-covered suite
  (the empirical no-pin-count-could-find-it proof); debt→half-up SURVIVES the
  golden E2E and dies only on the new sub-half vectors (the ruling's separation
  claim made empirical); 20,000-Σ exhaustive sweep rediscovers exactly the
  ruling's 2 carry witnesses; regime guard both-arms pinned (block arm is
  load-bearing — Regime zero-value is RegimeB). Task-6 adjudication accepted:
  sweepAbovePin disclosed-not-gated (gating a ~34%-duty-cycle pin property =
  a floor no honest run can meet), sweepNever gated, exclusion-discards-evidence
  gated, floors over the evaluable set. NEXT: risk-quant re-read (rev-3, expects
  to flip) + Codex micro-fix round 2 IN PARALLEL; then Codex rev-3 round; then
  Codex Task 6 round 1; then daemon restart (13+14) → make reconcile.
- **RISK-QUANT RE-READ ON REV-3: NUMBERS HOLD, blocking list EMPTY** (verdict
  flipped at 559828c). All four items verified on committed code with every
  integer recomputed independently; the E2E carry vector traced through
  ComputeAaveHealth itself (inner quotient 7270621702811489680000 visible —
  proves the composite is CALLED, not a lookalike); its own earlier 20k loop
  corroborated the sweep (2 hits, offsets 11500/13527, always +1); guard
  placement accepted (nothing above it does arithmetic; input-fault-first
  precedence defensible); liqprice half-up-sliver derivation endorsed (chain
  grace strictly below ceil(P*) — conservative). ONE CONDITION on the
  acceptance-run second pin: the fresh-pin 12/12 re-run inside make reconcile
  must be a GATED cohort (totalDebtBase AND healthFactor exact or the run
  fails), not informational — ALREADY SATISFIED by the Task 6 HF gate's
  exact-gated design; noted so the acceptance review checks it. Clear for the
  rev-3 Codex round (queued behind the micro-fix round in flight). The money-
  code protocol closed its loop twice today: Opus built → fable refuted its own
  prior approximation from source → Opus rebuilt → fable re-derived and flipped.
- **TWO OWNER DECISIONS RECORDED** (2026-07-29 22:53, AskUserQuestion answers
  verbatim): (1) -race CI lane: "add it, and/or download a c compiler if you
  need" → ci.yml race job COMMITTED ccaaa0e under CONTROL_PLANE_OWNER_REVIEWED
  citing the recorded approval (FULL suite under -race with DB provisioning —
  a non-DB subset would skip exactly the concurrency worth racing: riskd's
  scheduler loop, store batch writers under the advisory lock); local gcc
  (WinLibs) installing in background → local -race run when it lands, ahead of
  CI. (2) MAINTENANCE WINDOW PRE-AUTHORIZED ("Yes, pre-authorized"): once ALL
  THREE Codex rounds ship → daemon restart (applies 00013+00014) → owner-gated
  rewind-and-rederive (zero RPC, ~2,509 windows; riskd/api refuse honestly
  during; 173 flag events land; 35 stale rows stop counting, 31 stable-
  collateral accounts become computable) → make reconcile acceptance run
  (expected honest exit 1 on the three refuted heartbeat budgets → feeds.json
  meta fixes under ack). Standing conditional delegation: condition = three
  SHIP verdicts; nothing touches live custody before that. Task 7 (cmd/api)
  wave DISPATCHED in parallel (disjoint tree; depends only on Task-5-shipped
  surfaces).
- **FIRST -RACE RUN IN REPO HISTORY (local WinLibs gcc 16.1.0): 15/16 packages
  RACE-CLEAN — one REAL race found**, exactly where predicted (the riskd
  scheduler loop): cmd/riskd/main.go:139 setSkew lazily initializes the
  *atomic.Int64 POINTER while skew() reads it from the running loop goroutine
  via pollTrigger — the atomic value was atomic, the pointer to it was not;
  fix wave 4's safety comment claimed correctness one indirection too high.
  Both loop tests fail under -race; store (advisory lock) + anvil legs clean.
  Integrator's value-field fix reverted after copylocks revealed fixtures COPY
  daemonConfig — routed to the owning wave with both fix shapes.
- CODEX ROUND 2 ON FLAG-CUSTODY (session 019fb191-921f-7f82-893c-a4dabedcd5d3,
  ~16min, cfr2 @ 0df42da): **needs-attention — 1H/1M, both in the replay window
  the fix protects; migration defaults + merge rules judged SOUND.** (H) the
  whole-engine refusal is enforced only inside the account loop — RewindDerived
  (StartBlock−1) EMPTIES the account set, the loop runs zero times, aggregate()
  emits positions=0/refused=0, WriteRiskBatch accepts → a valid-looking EMPTY
  Aave book supersedes the refusal DURING the repair window (vacuous green
  where it matters most). (M) watermarkVector.Changed ignores CoveredFromBlock/
  DecoderRevision — a coverage-only transition (endpoint heights unchanged
  across maintenance) never wakes pollTrigger, so the identity's cov/rev
  distinction never gets to run; both directions. FIX WAVE dispatched (one
  wave, all three: engine-scoped custody refusal that survives an empty account
  set — empty-and-unproven must be UNREPRESENTABLE as complete-healthy, with
  the run-riskd-mid-replay regression; coverage joins Changed with the
  endpoint-ABA coverage-flip test both directions; the skew race fixed and
  -race-verified with the new local toolchain). go.mod/go.sum churn identified
  as the Task 7 wave's dependencies (kin-openapi) — its commit, not touched.
  PATTERN: rounds keep converging on 'the refusal must be as durable as the
  thing it refuses' — first per-position, then per-batch, now per-ENGINE
  across an empty set.
- CODEX ROUND ON REV-3 (session 019fb1a6-ec65-7790-8df3-178d7113d424, ~13min,
  worktree rev3 @ 559828c): **needs-attention — arithmetic FULLY CONFIRMED
  (every carry vector + the 2/20,000 sweep independently reproduced; both
  direction claims verified; no old-law consumer survives) — the two findings
  are DOCUMENTATION-AUTHORITY skew.** (H) authoritative surfaces still mandated
  the revoked fused floor (design spec §7, probe record P-2, migration 00013
  comment, types.go, the UI concept) — money-law version skew: an honest
  engineer following repo authority would reintroduce rev-2. (M) the documented
  one-unit rev-2→rev-3 debt bound is FALSE for multi-reserve borrowers — ceil
  applies per leg and sums, so N non-exact legs → up to N units (registry has
  3 borrowable reserves). SPLIT BY TREE: integrator fixed design spec + P-2
  supersession banner (honest about what the probe could/couldn't see — the
  two-step refutation stands, the final-division rounding was invisible to pin
  evidence) + UI formula → committed 8bb043d; rev-3 wave dispatched for
  types.go/liqprice.go/derivation-notes bound (0..N) + the two-debt-reserve +2
  regression vector; assemble.go revision-log line + 00013 comment DEFERRED to
  integration (flag-custody wave mid-flight in both). OUTAGE NOTE: 529s took
  down both build waves once (~23:20); both resumed from durable state; owner
  directive recorded: 20-minute heartbeat intervals, never quit — ScheduleWakeup
  armed at 1200s.
- **FLAG-CUSTODY ROUND-3 FIX LANDED — 631d295** (2026-07-29 23:55, 11 files
  +701/−45; incl. integration comment fixes: assemble.go revision-log 0..N
  bound + 00013 HF comment → rev-3 composite). (H) engine refusals computed
  INDEPENDENTLY of the account set: aggregates carry refusal_code/detail
  (00014 in-place), NewestCompleteBatch gains RefusedEngines[] because
  refused_count counts POSITION rows and is honestly 0 mid-replay — regression
  pins BOTH signals; engine-representation chosen over refuse-the-pass (would
  withhold DM for an Aave gap); mid-replay walk regression + genuinely-empty-
  book-not-refused counterweight; fixture-honesty note (first draft's healthy
  step-0 made the pass correctly ADOPT — the fixture lied, corrected). (M)
  sameCoverage in Changed (nil≠zero; equal-values-different-pointers not a
  change); endpoint-ABA both directions. (race) value atomic.Int64 — class
  closed by construction; copylocks exposed the predicted second bug (copied
  configs SHARED ONE CLOCK across 'independent' daemons) → configWithSkew +
  field-by-field clone + reflect clone-surface-closed guard. -race: riskd
  -count=3 clean; **FULL SUITE under -race exit 0 — first fully race-verified
  state of the repo.** All 8 scratch DBs cycled for the in-place amendment.
- **REV-3 DOC-FIX LANDED — c680f78** (4 files). types.go fused-authority text
  neutralized incl. FloorScaled (found BEYOND Codex's list — the exact function
  a consumer would reach for to re-derive an HF); 0..N bound corrected both
  places with the old claim called out; structural point recorded (per-reserve
  ceil is FORCED — a mixed-decimals book has no single denominator); the
  accumulation vector: +2 two-reserve (sum-then-ceil strawman refuted in-vector
  with three ordered HFs), +3 three-reserve w/ 18-dec leg, delta-0 lower-bound
  case. Every authoritative surface Codex named now carries rev-3 (8bb043d +
  631d295 + c680f78). NEXT: Codex re-rounds on 631d295 (flag-custody round 3)
  and c680f78 (rev-3 docs) once the Task 6 round frees the reviewer; Task 7
  wave mid-build (cmd/api WIP untracked, its go.mod deps held for its commit).
- CODEX ROUND 1 ON TASK 6 (session 019fb1c8-1c5e-7433-a335-84cd2496db28, ~14min,
  t6 @ e19a94f): **needs-attention — 9 HIGH + 1 MEDIUM, the deepest verdict of
  the session.** Split: DETERMINISTIC FALSE-FAILURES (tally counts provenance-
  upgrade/qualifier/marginal-disclosed as failures — honest pass impossible;
  residueWeld receives PARENT frame but borrowingOf populates on EXEC — every
  case would gate weld-unread) and VACUOUS GREENS (Aave census derived from
  AaveLegs — the cohort compared to itself; DM mandatory population =
  ourLiquidatable, the implementation under test — my acceptance of the
  opt-in full-census deviation WITHDRAWN, Codex found the deeper defect: not
  cost, census independence; input ledger opt-in — BeforeDebtUSD already
  consumed undeclared, a fourth tolerance can skip cite; final-branch seizure
  never consumes LiquidatedUSD; intra-block classifier labels flips without
  replaying the witness; open-ended heartbeat gaps never judged — a stalled
  feed could get UPGRADED, and head-gap uses wall clock not chain time;
  tokenConfig never welds base mapping to the scenario claim — the exact
  class-closure the sweep exists for; three-anchor floor silently lowered).
  FIX WAVE dispatched with all ten + Codex's mutation classes. The false-
  failure findings are the acceptance run's friends: they prove the gate set
  as committed could NEVER have passed honestly — better found now than at
  the restart.
- CODEX ROUND 3 ON FLAG-CUSTODY (session 019fb1db-5ea4-7b21-84e3-5466fb280100,
  ~9min, cfr3 @ 631d295): **needs-attention — 1H/2M, ALL in the legacy/adoption
  seam; the refusal logic, coverage trigger, and race fix traced CLEAN.** (H)
  the changed refusal law kept AlgorithmRevision 3 → a new binary derives the
  SAME key as a legacy empty/unproven batch and ADOPTS it — migrated aggregates
  have empty refusal codes, so the original vacuous green returns through
  adoption. (M) GenesisBlock steers refuse-vs-compute but is absent from the
  identity — an honest start-block correction changes the outcome without
  changing the key, both directions. (M) 00014's '' defaults affirm legacy Aave
  aggregates HEALTHY while the same migration nulls their coverage — a
  v13→v14 upgrade serves the wrong answer until rematerialization, indefinitely
  if the pass gates. FIX WAVE dispatched (rev 3→4 + legacy-adoption regression;
  GenesisBlock into the identity + policy-mutation test both directions;
  fail-closed legacy backfill scoped to coverage-nulled engines + upgrade-path
  test). The seam lesson compounds: a law change is not landed until the
  REVISION, the IDENTITY, and the MIGRATED PAST all agree with it. Codex now
  reviewing the queued rev-3 docs range (c680f78) in parallel.
- CODEX ROUND ON REV-3 DOCS (session 019fb1e8-4f46-7381-aada-607e35c4de3b,
  ~6min, rev3doc @ c680f78): needs-attention — 1H/1M, closure NOT complete.
  **(H) caught MY integration error directly: 631d295's message claimed the
  00013 comment fix but the edit sat UNSTAGED (missed in the git-add name
  list) — lesson: verify the staged list against the message's claims before
  committing.** Plus three more present-tense remnants beyond the original
  list (plan Task-1 headline + Task-4 fused-floor-vectors clause; UI concept
  scope note :476; IDEA-002:33). ALL FIXED: ac48b6a (00013 finally committed
  + plan + UI) and ae143d7 (IDEA-002, separate roadmap commit). (M) the
  corrected bound's own notation is defective — N-as-remainder-legs means
  ΔD=N exactly (not 0..N), and the delta-0 example calls itself N=2 under a
  definition making it N=0; AND the mixed-decimal impossibility claim is
  FALSE (10^18 is a valid common denominator after scaling — per-reserve
  ceiling is GenericLogic's MANDATE, not mathematical necessity). Notation
  fix (M = all debt legs, R = remainder legs, ΔD = R ≤ M) dispatched to the
  rev-3 wave for derivation-notes + aave_test + liqprice; **assemble.go's
  revision-log wording gets the same M/R correction AT INTEGRATION (third
  deferred assemble.go item — flag-custody wave mid-edit there again).**
- **TASK 7 (cmd/api) LANDED — 328bd0f** (2026-07-30 00:42, 20 files +9,177).
  openapi.yaml the contract (additionalProperties:false, money as decimal
  STRINGS, SeizureModel enum); six endpoints verbatim; SSE with poll-is-the-
  mechanism doorbell; meta with three-leg supersession + a disclosed FOURTH
  condition cursor_absent (fail-closed); per-(asset,source) price state incl.
  valid=false quarantine. Anti-vacuity: fixture written THROUGH
  store.WriteRiskBatch (cannot fabricate unwritable states), 5 schema-valid-
  but-wrong mutations each pass-contract-AND-fail-values, validator proven
  able to reject, 9 tampered-reconstruction refusals. Purity: no chain client,
  no writing SQL (AST literal scan w/ self-test), never migrates; schema gate
  expects 14, live smoke logged the honest v12 refusal. Serve-time stress =
  identity-index reconstruction of the batch's OWN rows verified back through
  the pure function riskd ran (mismatch = API_RECONSTRUCTION_MISMATCH refused
  row — never TOCTOU re-derivation). Deviations accepted incl.: cmd/api owns
  its SQL (Querier-scoped store readers owed forward); NO time-to-liquidatable
  (would be optimistic without a borrow-APY observation); DM histogram on the
  exact rational, Aave on hf_wad (rev-3 consumer warning); kin-openapi pinned
  0.128.0 (0.145 forces go 1.25). 60 tests 0 skips; -race owed to the CI lane
  for this env. M/R notation fix landed d64c9cb (equality derived: ΔD = R;
  impossibility claim conceded — GenericLogic MANDATES per-reserve ceil, the
  arithmetic permits both shapes, hence read-from-source). Codex round on
  Task 7 dispatched. REMAINING to SHIP: flag-custody round 4 (wave mid-edit),
  Task 6 round 2 (wave mid-edit), Task 7 round 1 (running), rev-3-docs re-check
  (fold into whichever round confirms closure). Then: maintenance window.
- **TASK 6 ROUND-1 FIXES LANDED — 9751414** (2026-07-30 00:50, 20 files
  +2,068/−339). All ten: closed verdict sets w/ one tally predicate (artifact
  and exit code cannot diverge); toleranceID enum (fourth epsilon = COMPILE
  error) + typed backtestView accessors (the getter IS the read); independent
  Aave candidate universe from raw_logs user slots w/ dropped/phantom-borrower
  rows; -dm-full-census defaults TRUE, disabling TAINTS; carried-repay-budget
  seizure law (found EXTRA defect during fix: liquidatedAmt==0 must route
  ALL-PARTIAL or the dominant shape goes vacuous); residueWeld → EXEC frame +
  two-pass first-passes weld against the NEXT pass's beforeDebtAmount;
  classifyIntraBlock pure w/ REQUIRED reproduced flip; chain-time head gaps
  (cross-feed endpoint so a stopped feed can't zero itself; unmeasurable =
  GATED); scenario base claims loaded from internal/risk/scenarios/*.json
  (the files ApplyScenario consumes) exact both directions; three-anchor floor
  extracted and HARD. Mutation 5/5 behavioural; the wave DISCLOSED two weak
  first-kills (F6/F7) and hardened them (extraction; go/ast call-site pin) —
  the third straight wave to catch its own tests lying. Wave reports the
  first fully-green full-repo run of its session (17 packages incl. cmd/api).
  Integrator re-verified: build/vet/gofmt clean, both packages green. NEXT:
  Task 6 round 2 after the flag-custody wave lands (bundle review timing);
  Task 8 wave running; Codex on Task 7 round 1.
- **FLAG-CUSTODY ROUND-4 FIX LANDED — 60d44c5** (2026-07-30 00:55, 5 files;
  incl. the thrice-deferred assemble.go M/R wording, applied at last). Rev
  3→4 (the adoption hole named in the log); the legacy-adoption regression
  built HONESTLY (production-path batch rewritten to legacy shape; the
  legacy-key formula asserted to reproduce production's stored key; the
  hazard asserted LIVE before the fix acts; current-revision adoption
  counterweight). GenesisBlock in the identity w/ 4 policy mutations (and a
  fixture-honesty fix: idPolicy() left it 0 — the unset mutation would have
  been a vacuous no-op). Legacy fail-closed via BACKFILL scoped to
  aave_v3_etherfi (unservable would withhold the DM book + conflate honest
  legacy with corruption); SQL-literal-to-Go-constant pin test (a rename
  cannot silently revert legacy batches to healthy); era-appropriate raw SQL
  at the v13 baseline. Full suite + full -race suite exit 0 (wave); store
  green fresh 131.6s (integrator). **PRE-EXISTING FRAGILITY FLAGGED (not
  fixed, out of scope): internal/store scratch runs leak 3 chain-10
  reorg_epochs rows → next same-DB run fails ~34 tests on unacked epochs;
  workaround TRUNCATE reorg_epochs; MICRO-TASK OWED.** NEXT: Codex
  flag-custody round 4 (closing) queues behind the Task 7 round in flight;
  then Task 6 round 2.
- CODEX ROUND 1 ON TASK 7 (session 019fb1fb-a5ad-7a93-8bba-339d54b7078c,
  ~10.5min, t7 @ 328bd0f): **needs-attention — 1 CRITICAL + 2H + 2M; fixture
  arithmetic and the five contract-valid mutations verified correct.** (C)
  THE SESSION'S SIGNATURE CLASS AT A NEW LAYER: the API's read query predates
  the flag-custody round-3 fix — it never selects refusal_code/refusal_detail
  or RefusedEngines, so the honest maintenance path's withheld Aave engine
  serves as a clean zero-position healthy book across REST+SSE (the exact
  empty-set vacuous green riskd just closed, re-opened by a parallel-build
  seam). (H) verifyReconstruction misses bonus-dependent outputs (liq_bonus
  mutation would pass the guard yet move waterfall/market-realization; also
  AvgLTBps + exact rational omitted). (H) the const heartbeat table reports
  KNOWN-REFUTED budgets (FRAX 170712 / USDC 248460 / PYUSD 604896 vs 90000)
  as merely published-not-verified — no refuted grade exists in the enum.
  (M) SSE heartbeats continue through DB read failures with no degradation
  event — an apparently-live stream over indefinitely stale data. (M) the
  observatory duplicates a WEAKER completeness predicate than
  NewestCompleteBatch — a torn restore can serve a point the authority
  rejects (the claimed single-authority violated). FIX WAVE dispatched (all
  five + the store Querier-reader owed-forward item pulled INTO scope for
  the observatory fix). Codex now on flag-custody round 4 (closing).
  PATTERN NOTE: parallel waves that both touch one contract (writer adds a
  field; reader built before it) need a SEAM CHECK at integration — added
  to the standing integration checklist.
- CODEX ROUND 4 ON FLAG-CUSTODY (session 019fb20a-3726-70a2-bc00-270045b8eb33,
  ~8min, cfr4 @ 60d44c5): needs-attention — 1H/3M, decomposing into: (H) the
  API refusal-propagation gap = the Task 7 wave's in-flight [critical], same
  finding from the other direction — NOT double-routed. (M×2 "absent/vacuous
  regressions") = **MY SECOND STAGING ERROR: both test files EXISTED but were
  untracked, and my status filter (grep -v '^??') hid them from the git-add
  list — committed now as fac5168, verified green** (legacy-adoption
  regression with the live-hazard assertion + current-revision counterweight;
  the cross-package vocabulary weld). Standing rule added: diff the staged
  list against the report's file list BOTH WAYS before committing. (M
  genuinely new) per-stream genesis typos can mint false coverage —
  engineGenesisBlock min-collapses Aave streams while walkers honor
  per-stream starts; no startup invariant ties production streams to the
  audited genesis. (M still-open half) the DM migration control inserts
  AFTER Migrate — a WHERE-clause deletion would pass. Both routed to the
  flag-custody wave (genesis startup invariant + config-coupled fixture;
  control-before-Migrate ordering). Round 5 will be the true closing.
- CODEX ROUND 2 ON TASK 6 (session 019fb21a-687f-7132-b275-0d5e47c2fb39,
  ~13min, t6r2 @ 9751414): needs-attention — 3H/3M, seams the round-1 fixes
  themselves created plus two carried proof gaps. (H) the next-pass residue
  input bypasses its own ledger → deterministic false failure the frame test
  never exercises; (H) the causation classifier accepts POST-BLOCK prices as
  proof of pre-liquidation flips (witnesses==0 + priceMoved = false marginal);
  (H) the cross-feed head endpoint collapses when ALL feeds stall together
  (population max, not header time at the custody boundary); (M) the HUMAN
  renderer still lists passing verdicts under GATED FAILURES — the two
  acceptance artifacts contradict; (M) FINAL/ALL-PARTIAL inferred from
  amount==balance, ambiguous exactly at the boundary (HP100/b10/bal110/
  cAFD100 = FINAL with amount==balance); (M) the go/ast pin checks SPELLING
  (exec := parent evades it) — the depth request confirmed. Fix wave 2
  dispatched with all six.
- **TASK 7 ROUND-1 FIXES LANDED — 94a13c4** (2026-07-30 01:40, 13 files
  +1,812/−205). Withheld-engine unrepresentable at SEVEN points w/ the
  opposite-teeth pair (withheld test + proven-empty control); the bonus
  TAUTOLOGY closed by an independent witness (weldLegParams vs the custodied
  param ledger at the position's own params_block through the ONE FoldParams —
  weld discipline, not TOCTOU; the bonus mutant dies only on the new weld,
  which is why it had to exist); published-and-refuted grade w/ FRAX/USDC/
  PYUSD numbers + SELF-CORRECTION (weETH downgraded to qualifier — a complete
  ledger's max gap can never certify the future; 'verified' documented
  unreachable); SSE read-health latch (one unavailable + recovered snapshot;
  heartbeats = connection liveness, asserted to continue); CompleteBatchIDs
  (+42/−0) = one completeness authority, API duplicate deleted. 73 tests
  0 skips. Disclosed: one-wei live_collateral mutation invisible at this
  layer (floors away — stated in the test). NEXT: Codex Task 7 round 2 after
  the current fix-wave queue clears.
- **TASK 8 (client-ts) LANDED — d664886** (2026-07-30 01:55, 50 files +15,249;
  202/202, zero runtime deps ENFORCED BY TEST, npm ci reproducible, packed not
  published). Judgment call endorsed: tracked the LIVE contract while Task 7's
  fix wave amended it (drift gate must point at the contract; verified zero
  mirrored numbers changed; the tracked contract became HEAD at 94a13c4).
  Fixture provenance record grades MIRRORED/DERIVED/ILLUSTRATIVE/SHAPE-ONLY —
  only ~90 MIRRORED values asserted as server fact; DERIVED model-validated
  but asserted only against invariants; addresses EIP-55-computed not
  transcribed. Design finding kept: toNumber refuses on SAFE-INTEGER, not
  round-trip (1.08e18 IS a representable double yet x+1===x — first impl had
  the bug, the test demonstrates the trap). fetchEventSource because native
  EventSource cannot see comment frames by spec. yaml@2.9.0 devDep flagged
  for owner bookkeeping.
- **FLAG-CUSTODY ROUND-5 FIX LANDED — 31c08c2** (5 files). Genesis bug had two
  halves: coverage vouches from the MAX stream start (min stays the walk
  floor — chainlink_feed's 4 legitimate starts ruled out refuse-divergence;
  structural: an unchecked binary still fails the coverage gate) + the audited
  premise as CONSTANTS beside the law (AuditedAaveGenesisBlock/PoolAddress),
  validateAaveGenesis refusing startup on divergence. JUDGMENT REVERSED and
  documented in-code: 'read the bar from config' was wrong — CONFIG IS WHERE
  DRIFT HAPPENS; the bar is the constant, config is checked against it.
  7-case divergence table + production-config coupling + real-runner
  max-stamp proof. DM scoping control BEFORE Migrate; Codex's mutation run
  for real (WHERE deleted → right failure → restored). **ROOT CAUSE for the
  store flakiness (supersedes idempotency theory): CROSS-PACKAGE PARALLELISM
  on the shared scratch DB — prices writes reorg_epochs while store runs;
  -p 1 → 0 failures, default → 27. make test green was TIMING LUCK.** FIXED
  at the recipe level: -p 1 on make test (6266f63) and both CI lanes
  (49861dc, owner-reviewed); store/prices DB split stays the owed micro-task.
  NEXT: Codex queue = Task 7 round 2 (running) → flag-custody CLOSING round
  (fac5168+31c08c2) → Task 8 round 1 → Task 6 round 3 (wave mid-fix).
- **THIRD STAGING MISS, caught by the sibling's tree report — dc2b739**: the
  round-5 discrimination tests (genesis 7-case table, config coupling, the
  max-stamp runner proof) were untracked NEW files absent from 31c08c2.
  Three data points, one shape: untracked new TEST files are what the '^??'
  filter hides. The both-ways rule now has teeth in the ledger.
- **TASK 6 ROUND-2 FIXES LANDED — ba72022** (8 files +991/−213). All six:
  ledgered next-pass accessor (hasNextPass records NOTHING by design — a
  conditional source must not read consumed where it's absent; AST guard on
  direct row reads); causation from CUSTODIED pre-liquidation writes walked
  in log order (execEligible = corroboration only; disclosed consequence
  pinned: PriceProviderV2 isn't walked, so genuinely price-driven intra-block
  flips now classify UNEXPLAINED — correct under the law); head endpoint =
  header timestamp at min(cursor,pin) as a DISTINCT TYPE (substitution is a
  compile error); renderer AND p3Counts through verdictIsFailure + GATED
  SUCCESSES section; two-HYPOTHESIS branch resolution (both-holding = the
  true boundary, emitted once as ungated ambiguity — never an asserted
  undetermined label; u0==0 refused by the CONTRACT per DebtManagerCore:567);
  parentFrame/execFrame distinct types (exec := parent is a COMPILE error,
  probe transcript kept). Mutation 7/7 behavioural, three mutants RE-CUT
  because compile-error kills prove nothing about assertions. WAVE'S
  CALIBRATION NOTE, kept: two of six were its own round-1 fix INCOMPLETE
  (p3Counts half; the u0 seed), both surfaced by the sweep, not re-reading.
  NEXT: Task 6 round 3 joins the Codex queue.
- CODEX ROUND 2 ON TASK 7 (session 019fb232-a528-7421-aec3-e0d7959f05a5,
  ~11min, t7r2 @ 94a13c4): needs-attention — 1H/2M. CONFIRMED SOUND: the
  seven listed refusal points, weld-not-TOCTOU (despite rewindable ledger
  rows), SSE edges, the one-wei disclosure (not material), CompleteBatchIDs
  by-construction. The findings: the SAME withheld-engine class at two
  unswept surfaces — (H) address/stress lookups emit DEFINITIVE found:false
  when the relevant engine is withheld (the contract defines found:false as
  'no position exists'; an honest client consumes a false negative exactly
  when the service cannot know); (M) stress_coverage_is_full stays green
  over an excluded engine; (M) observatory returns-early on empty
  CompleteBatchIDs and suppresses INDEPENDENT rate-index custody. Fix wave 2
  dispatched (three-valued lookup availability + opposite-teeth tests both
  endpoints; coverage false on exclusion; rate indexes read regardless).
  Codex now on the flag-custody CLOSING round (fac5168+31c08c2+dc2b739,
  depth: max-floor overstatement, startup-path completeness, the judgment
  reversal's new seams, rewind interaction with the max bar).
- **TASK 7 ROUND-2 FIXES LANDED — da5ed0a** (5 files +239/−74). found is
  THREE-VALUED (rows≥1 → true, a positive claim withholding cannot falsify;
  0 + all available → false, genuine negative; 0 + relevant engine withheld
  → NULL — the answer cannot be established, must never render as
  'no position'); found:boolean → boolean|null is the DELIBERATE breaking
  contract change; stress_coverage_is_full = book-wide (no exclusions of
  either route); observatory rate indexes read ALWAYS (deriver custody is
  independent of the materializer). Six mutants in three OPPOSITE-TEETH
  pairs (pre-fix and over-correction each die to different tests); mutant
  A's failure message is the finding verbatim. 113 tests (was 73). client-ts
  drift gate fails BY DESIGN → regen wave dispatched to the Task 8 agent
  (incl. the nullable-found ergonomics: consumers must distinguish false
  from null).
- FLAG-CUSTODY CLOSING ROUND (session 019fb243-12ab-7111-818d-7520dfe0917a,
  ~8min, cfclose @ dc2b739, three-commit self-isolated range): needs-attention
  — **ONE high, the FIFTH face of the coverage law: the persisted claim binds
  (FromBlock, DecoderRevision) but NOT the stream/address SET that was
  walked.** Honest sequence: add a new aToken stream at the audited genesis
  (updating the intentional fixture); cursor already at H; the new stream
  backfills to H but Step never re-walks; old covered_from_block=genesis
  survives; validateAaveGenesis passes (every start == constant);
  CoverageProvenBack passes; riskd publishes a book missing the new stream's
  historical balances. Migration ordering + all startup paths (incl. -once)
  CONFIRMED correct. FIX ROUTED: deterministic coverage BINDING over
  chain+sorted streams(addresses+starts), persisted beside the stamp,
  matched against config-computed expectation; mismatch = unproven until
  rewind+replay; binding-change RESTARTS coverage mirroring the
  decoder-revision rule; stream-addition + coherent-genesis-update
  regressions. The coverage-law arc, five faces now: empty-set → sweep scope
  → identity/adoption → legacy past → STREAM-SET BINDING. Each face is the
  same theorem: a claim of completeness must name EVERYTHING it quantified
  over.
- **CLIENT REGEN LANDED — f58bc48** (23 files +1,416/−30; 227/227, drift gate
  green — its SECOND catch, the loop works). lookup() free function returning
  a three-case discriminated union with NO boolean anywhere (the nullable
  type alone protects nobody — '!found' branches identically on false and
  null, DEMONSTRATED by test before the discriminant separates it); complete
  narrowed to LITERALS on two arms (impossible combinations unrepresentable);
  ContractInvariantError refuses schema-valid-but-self-contradicting bodies —
  THE CLIENT ENFORCES THE SERVER'S LAW (a found:false over an incomplete
  lookup is refused client-side, so the round-2 fix cannot be undone
  downstream); isDefinitiveNegative() deliberately not a negation. Provenance:
  new fields SHAPE-ONLY except the three-valued semantics asserted as
  CONTRACT LAW (reasoned: prose rules a client can get catastrophically wrong
  with no number involved). Zero PINNED values moved across 328bd0f..HEAD.
  NOTE: reviewer transcript rotation — the standing Codex agent
  (a59d42847…) lost its transcript; Task 6 round 3 runs on a FRESH
  codex-reviewer with the operational pattern re-briefed. Remaining Codex
  queue: Task 6 r3 (running) → flag-custody r6 (stream-binding fix, wave
  mid-work) → Task 7 r3 (da5ed0a) → Task 8 r1 (d664886+f58bc48).
- CODEX ROUND 3 ON TASK 6 (session 019fb251-3a66-7ac0-810e-5e7025d3184d,
  ~10min, fresh reviewer, t6r3 @ ba72022): needs-attention — 1H/1M, BOTH
  ABI-level defects in H2's witness replay; H1/H3/M4/M5/M6 ALL HELD. (H)
  InterestIndexUpdated topic0 derived from a NONEXISTENT two-arg signature
  (real ABI is three-arg, fixture topic0 c6ecd996…) — genuine witnesses
  invisible → honest runs FALSELY FAIL as UNEXPLAINED. (M) Repaid indexes
  user=topic1/payer=topic2 but the branch accepts either slot — third-party
  repayment marks the PAYER as the debtor → FALSE marginal PASS. The pair
  brackets both failure directions, which is exactly why witness predicates
  need FIXTURE-BACKED regressions, not signature transcriptions. Fix wave 4
  dispatched (ABI-derived topic0s + the real dm_interest_index_updated.json
  fixture + an audit of all five witness topic0s; Borrowed/Repaid split with
  topic1-only matching + the payer-slot negative).
- **TASK 6 ROUND-3 FIXES LANDED — c421213** (3 files +376/−35). Audit: exactly
  1 of 5 topic0s wrong (the flagged one), verified against TWO anchors outside
  the wave's authorship. THE NIGHT'S MOST INSTRUCTIVE MOMENT: the wave DELETED
  its own passing test (TestDMWitnessTopicsAreCanonical hashed its OWN wrong
  signature and confirmed its own mistake) with a comment saying so — the
  fixture is the only party to a test that cannot share the author's error.
  Replacements: fixture==ABI==replay per event w/ fixture-vs-ABI cross-check;
  full argument-shape assertion (would have caught it at writing time); the
  real captured log driven to Proven. Borrowed/Repaid split with topic1
  discipline + the wave found the defect's OTHER HALF beyond the finding
  (Borrowed's token slot also accepted the account); deliberate disclosed
  call: token slot NOT narrowed to the debt token (liquidatable totals across
  all borrow tokens — narrowing would recreate the H-shape). Mutation 4/4
  incl. Hb beyond the list (tuple-component drop = shape-error coverage).
  Fixture-backed-over-transcribed is now the RULE for anything ABI-shaped in
  the gate. NEXT: Task 6 round 4 (should be closing) queues behind Task 7
  round 3 (running).
- CODEX ROUND 3 ON TASK 7 (session 019fb265-225c-78b2-afee-f09b3f777ffc,
  ~8min, fresh reviewer, t7r3 @ da5ed0a): needs-attention — 1H: 'the claimed
  regression evidence is absent from the reviewed tree' (fix code judged
  coherent). **FOURTH STAGING MISS, same class**: cmd/api/round2_db_test.go
  (9 tests, +229 — the withheld-lookup/coverage/rate-index regressions the
  six mutants were killed against) sat UNTRACKED. Committed bc0c703, verified
  green (cmd/api 122 tests). Four misses, one root cause: git-add lists built
  from modified files while NEW test files sit untracked; the both-ways rule
  is now applied MECHANICALLY (git status including ?? on the wave's trees
  before every wave commit). Task 7 round 4 (closing confirmation) dispatched
  on 1ebe6b6..bc0c703. Reviewer ops note carried forward: strip trailing '*'
  from ls glob + native Windows path for the companion script (MODULE_NOT_
  FOUND otherwise).
- **STREAM-BINDING FIX LANDED — 30768a9** (20 files +740/−107; the both-ways
  check caught 1 untracked test file — the rule works when applied).
  CoverageBindingOf = sha256(chain + sorted deduped (address,startBlock)
  pairs) — reproducible from config hence checkable; NOT names (renames are
  cosmetic); order/dup-insensitive; per-stream pairs. CoverageProvenBack
  RETIRED for CoverageClaim.Satisfies(CoverageRequirement) (two structs, no
  hand-assembled provenance, four legs fail closed incl. empty requirement).
  Merge rules: different binding RESTARTS (mirrors decoder-revision); rewind
  clears binding WITH its rows. Binding in the identity. BOTH HALVES: startup
  compares AuditedAaveCoverageBinding (computed from committed config);
  the DB gate catches stale data — composition closes the coherent-update
  variant (everything moves together, startup passes, STILL refuses: the
  data is stale). Genesis divergence table now 10 cases incl. added/removed/
  re-addressed at identical starts (invisible pre-round-5). Wave: full suite
  + -race both -p 1 exit 0; fork legs 3/3. NEXT: flag-custody round 7 —
  the TRUE closing — queues behind Task 7 round 4 (running).
- **TASK 7 CLOSED — SHIP** (round 4, session 019fb272-25d7-7313-80dc-
  265dc1e4bc2f, ~3.5min, t7r4 @ bc0c703): "APPROVE / SHIP. The committed
  tests non-vacuously cover every requested degraded-state case with valid
  opposite-teeth fixtures and OpenAPI validation. Static tracing confirms
  they kill the found-by-rowcount, coverage-reconstruction-only, and
  restored-early-return mutants. da5ed0a's implementation matches the
  assertions. No material findings." The tracing detail worth keeping: the
  withheld and proven-empty batches have IDENTICAL zero-row Aave aggregates
  distinguished only by the persisted refusal — the fixtures genuinely
  discriminate. Program: wave (60 tests) → r1 1C/2H/2M → fw1 (seven-point
  unrepresentability, bonus weld, refuted grades) → r2 1H/2M (unswept
  surfaces) → fw2 (three-valued found) → r3 1H (= staging miss #4) →
  bc0c703 → r4 SHIP. Commits: 328bd0f / 94a13c4 / da5ed0a / bc0c703 (+
  client f58bc48). **SHIP 1 of 4.** NEXT: flag-custody round 7 dispatching.
- POST-COMPACT RESUME (2026-07-30 07:20): three lanes in flight. (1) flag-custody
  wave applying the round-7 fixes (binding → sameCoverage forward+reverse, binding →
  identity cursor line, mixed-chain validateAaveGenesis) — mid-edit on cmd/riskd +
  internal/riskfeed, new coverage_binding_identity_live_test.go. (2) Task 6 round 4
  (t6r4 @ c421213, base 9da5448): reviewer's poll loop died across the compact —
  re-armed on the same job (pid alive, log growing, verified twice). (3) TASK 8
  ROUND 1 DISPATCHED on a fresh codex-reviewer: worktree C:\wtclose\t8r1 @ f58bc48,
  base 9a80667 (= d664886~1), scope packages/client-ts ONLY (range crosses the T6/T7
  trains — brief excludes them), D-013 quoted, hunt list = three-valued found
  conflation, silent Number precision loss, vacuous ContractInvariantError, drift-gate
  self-confirmation, SSE reconnect dup/drop, zero-dep enforcement, test honesty,
  contract mismatch. Maintenance window remains PRE-AUTHORIZED, fires only when T6 +
  flag-custody + T8 all reach SHIP (T7 already shipped).
- CODEX ROUND 4 ON TASK 6 (session 019fb35e-3058-7680-90c6-2a71f97bf7aa, ~11min,
  t6r4 @ c421213, base 9da5448): needs-attention — 1 MEDIUM, zero highs; the round-3
  ABI/slot fixes HELD. (M) Witness replay proves CONTACT, not the eligibility
  TRANSITION (backtest.go:1355-1387): Repaid sets Proven though repayment lowers debt
  and cannot cause the flip; InterestIndexUpdated / CollateralTokenConfigSet accepted
  without decoding or applying old/new values; caller computes both booleans from the
  same event-time debt + parent config, changing only to block-end prices — so a
  non-causal witness before the liquidation plus a price update AFTER it converts the
  exact false negative this gate exists to expose into non-failing marginal-disclosed.
  Especially reachable post-round-3: liquidation blocks ordinarily contain an earlier
  index update. Adjudicated FIX-WORTHY (false pass in honest use). FIX WAVE 5
  dispatched: directional STATEFUL replay — parent state, witness events applied in
  log-index order (pre-liquidation only), eligibility recomputed via hf_gate.go after
  each; Proven IFF the replay itself produces false→true before the liquidation;
  directionality proven by counterexample TESTS not special-cased (Repaid+price-after,
  routine-index+price-after, LT-neutral/-increase-config+price-after → UNEXPLAINED;
  positive control: sufficient index/LT-decrease → Proven); mutation spec m1 contact-
  only revert / m2 ordering dropped / m3 state-not-applied, cut-and-kill required;
  fixture-backed decode rule binding; frozen frame + closed registry untouchable
  (report, don't re-freeze). Wave runs on an ISOLATED scratch DB solvent_test_t6w5 —
  the sibling flag-custody wave holds solvent_test (two concurrent destructive
  live-db suites on one DB would race exactly like the pre--p1 cross-package runs).
- **ROUND-7 FIX LANDED — 06d0a25** (8 files +381/−26; both-ways staging check
  exact — the two cmd/reconcile modifications correctly excluded as wave-5
  property). All three findings were the SAME completion the wave performed in
  round 3 for covered_from_block/decoder_revision and failed to repeat for the
  field it added itself. (H1) binding joins sameCoverage — forward AND reverse
  flip tests pin a fingerprint of the other four provenance facts byte-identical,
  mutate only the binding, require the trigger; stub-to-true kills both. (H2)
  binding serializes UN-TRUNCATED into the identity cursor line (/cov/rev/walked
  — deliberately distinct token from the policy line's demanded surface: walked
  vs demanded are different facts the gate compares); decisive test = empty-book
  binding-only repair mints a NEW key with refusedDigest == healedDigest (nothing
  else could move it), refused batch not adopted. (H3) validateAaveGenesis
  resolves every stream's chain, requires AuditedAaveChainID (new constant) BEFORE
  hashing, compares RESOLVED ids not config keys (two keys naming one chain must
  not false-refuse); chainIDOf deleted, 0 refs; divergence table 13 cases.
  Completion rule recorded in the audited-premises comment: any field the
  refuse-vs-compute decision reads joins Satisfies + sameCoverage + identity —
  all three homes. Incidental: unprovenAaveCoverage now clears all three fields
  (two-field variant modelled an impossible row). Wave: full -p 1 AND -race -p 1
  exit 0, riskd -race -count=3, fork 3/3, live DB untouched. Integrator
  independently re-ran vet/build/tests on both trees — green. ROUND 8 (TRUE
  closing) dispatched: fcr8 @ 06d0a25, base df6e5f6, closing tasks = verify all
  three + hunt a FOURTH field missing a home + spot-check test non-vacuity.
- CODEX ROUND 1 ON TASK 8 (session 019fb36d-42b1-7351-bebb-a4a3a59b1adc, ~10min,
  t8r1 @ f58bc48, base 9a80667, static review — read-only workspace had no npm
  deps): needs-attention — 4H/1M, ALL honest-use classes, all adjudicated
  FIX-WORTHY. (H1) union arms retain raw response so found stays boolean|null —
  !found conflation COMPILES, and the primary address() bypasses discrimination
  entirely (withheld engine → honest dashboard's false "no position"). (H2)
  found:true branch skips lookup_complete⇄withheld_engines consistency —
  contradictory positive renders a floor as a total. (H3) SSE parser normalizes
  trailing \r immediately: a chunk boundary BETWEEN \r and \n forges a frame
  boundary and silently destroys the named event (arbitrary TCP chunking = honest
  condition). (H4) pre-snapshot ticks are DELIVERED into unbased state (onError
  optional = silent). (M5) failedAttempts resets on HTTP open, so 200-then-close
  loops never grow backoff and never exhaust maxAttempts. FIX WAVE 1 dispatched
  (packages/client-ts only, disjoint from both sibling trees, npm-verified):
  seal the union with literal-typed found per arm + raw behind an unsafe-named
  accessor, completeness checked before branching on all outcomes, stateful CR
  hold at chunk boundaries with per-event-type split tests, no unbased delivery
  (bounded buffer or reconnect), retry reset only on valid base frame;
  red-then-green required, mutation checks m1–m4.
- **FLAG-CUSTODY CLOSED — SHIP** (round 8, session review-ms7mqdlz-dp5fw8 job,
  ~6min, fcr8 @ 06d0a25 base df6e5f6): "approve — SHIP. All three fixes hold in
  both failure directions; binding serialization is unambiguous for honest
  values; every Aave stream is chain-validated before hashing; tests are
  non-vacuous; no fourth coverage field or adoption regression was found. No
  material findings." Reviewer's only next-step (focused test run from a
  writable env — its sandbox couldn't create Go's temp build dir) was ALREADY
  satisfied: wave ran full -p 1 + -race -p 1 + riskd -race -count=3 in the real
  repo and the integrator independently re-ran vet/build/tests before 06d0a25.
  Program: witness law → coverage provenance → five faces (account set, sweep
  scope, identity/adoption, migrated past, stream-set binding) → completion rule
  (three homes) — 8 rounds, 5 fix waves. **SHIP 2 of 4.** Remaining gates:
  Task 6 (wave 5 mid-flight), Task 8 (fix wave 1 mid-flight). Ops note: the
  reviewer self-caught a backslash-mangled worktree path landing INSIDE the
  repo pre-dispatch, removed it, and the integrator verified the main tree
  clean (only wave-5 property + untracked log). t6r4 worktree administratively
  removed; fcr8 + t8r1 remain registered for the locked-dir cleanup batch.
- **WAVE-5 FIX LANDED — 2aa714d** (5 files +1,074/−156; both-ways exact, the
  client-ts modifications correctly excluded as T8-wave property). Proven now
  means THE REPLAY CROSSED THE THRESHOLD: stateful directional replay from
  parent-block state (new NormalizedAtParent fold — Σ deltas strictly below N,
  same srcBTDeltaFold source so the frame declaration is unchanged), witnesses
  applied in log-index order (collector bounds log_index < L structurally;
  replay defensively sorts), eligibility recomputed after each write via the
  EXISTING proven functions. Parent-boundary index EVENT-SOURCED (an earlier
  tick's decoded oldIndex supersedes the liquidation-time snapshot). No class
  special-cased — Repaid floors down, Borrowed ceils up under stable-snap,
  Liquidated bonus-inclusive (fixture identity cross-checked), config swaps the
  decoded tuple; ARITHMETIC decides directionality (counterexample TESTS prove
  it, per the brief's no-blocklist rule). No price events in the witness class
  set (PriceProviderV2 outside the walked DM surface) — prices parent-frame
  throughout; block-end prices remain corroboration only. Undecodable/unknown-
  decimals/cross-token DISCLOSED in causeReplay.Notes → UNEXPLAINED, never
  proven (cross-token = named model limit; multi-token debt legs would be a
  design change, flagged not smuggled). Red-then-green real (counterexamples
  failed under the m1-shaped signature change); mutants m1/m2/m2b/m3 all
  behaviourally cut and killed (first m1 cut was a compile error, re-cut per
  spec); sha256-verified restores, no git ops. 209/0/5-opt-in on isolated
  solvent_test_t6w5. Integrator independently re-ran gofmt/vet/build/tests —
  green. Live-run consequence acknowledged: contact-only marginal-disclosed
  cases will now honestly fail UNEXPLAINED — that is the law correcting, not a
  frame change (digest untouched; acceptance-run expectations updated
  accordingly). ROUND 5 (closing) dispatched: t6r5 @ 2aa714d, base 3c59286 —
  verify apply-site crossings, parent-fold scope, oldIndex supersession choice
  among multiple ticks, rounding directions vs deployed source, Notes-path
  honesty, positive-control knife-edges computed not hardcoded.
- **T8 FIX WAVE 1 LANDED — 053b29a** (9 files +627/−108, all modified, zero new;
  both-ways exact). (H1) union arms carry found as a per-arm LITERAL second
  discriminant; response is Omit<T,'found'> AND destructure-rest built — sealed
  at compile time (@ts-expect-error-enforced permanently) and absent at runtime
  (hasOwn false); address()/addressStress() return the discriminated lookup so
  invariant enforcement is the PRIMARY path; raw bodies behind addressRaw()/
  addressStressRaw() (persistence/forensics JSDoc); exact-values suite migrated
  to raw deliberately — it asserts wire truth. Public-surface break sanctioned
  (pre-publish). (H2) completeness law BEFORE the branch on all three outcomes,
  inverse also refused with contract-text justification (withheld_engines IS
  the attribution of incompleteness). (H3) dangling-CR hold across chunks, EOF
  resolves held CR as terminator; split tests through REAL HTTP at every \r|\n
  boundary per product event type. (H4) drop-and-reconnect chosen over
  buffering (buffered pre-base delta over a later snapshot = wrong-by-
  construction; violations count failed attempts so misbehavior terminates);
  source-null guard against double-counted reconnects. (M5) reset only on a
  PARSED base frame — not open, not heartbeats. 19 red-then-green + typecheck
  reds; mutants m1–m4 killed (3/3/3/5); verify exit 0, 249/249; drift gate
  green, zero-dep intact, lock+contract untouched. Integrator independently
  re-ran verify — exit 0 (a post-wave TS2367 diagnostic was stale tsserver
  state; compiler authoritative, again). Disclosed residuals routed to round 2
  for adjudication: !found on an UNNARROWED union still compiles (language
  limit — TS cannot ban falsiness on true|false|null; docs forbid; the cited
  response.found hazard IS sealed); heartbeat comments surfaced pre-base
  (liveness, never data). ROUND 2 (closing) dispatched: t8r2 @ 053b29a, base
  865fa1c — verify seal completeness across exported surfaces, judge the
  inverse-refusal contract reading (over-refusal is ALSO a wrong answer),
  CR-hold edge cases, cross-connection ordering, exact-values migration
  weakening, mutant non-vacuity. Wave ops notes: Serena indexes Go only in
  this repo (.serena/project.yml languages omits TypeScript — one-line fix
  OWED); wave used Read/Edit per documented fallback.
- CODEX ROUND 5 ON TASK 6 (session 019fb391-c30e-7420-81f4-68729fd3e247, ~14min,
  t6r5 @ 2aa714d, base 3c59286): needs-attention — 2H/1M, ALL in the PRODUCTION
  COMPOSITION around the replay (the replay core itself HELD: parent folding,
  bounds/order, index selection, arithmetic, ABI pinning, frame digest, registry
  all verified). (H1 conf .99) parent predicate still computed from ourBefore —
  liquidation-time debt — not the parent fold: an index-caused crossing emits
  EXACT true-at-parent instead of marginal-disclosed; the tests hand-fed false
  to classifyIntraBlock so the composition was never exercised. (H2 conf .99)
  Proven LATCHES across a reversed transition: index-tick crossing → Repaid
  restores health → uncustodied price move → liquidation = stale cause + block-
  end execEligible = passing marginal-disclosed though the real cause was the
  unproven price move. (M3 conf .96) cross-token liquidation PARTIALLY applied
  (refusal noted, other-token debt leg omitted, seized collateral still removed)
  and can set Proven — Notes are evidence-only, so the declared unreplayable⇒
  UNEXPLAINED rule had no structural teeth. All three FIX-WORTHY (false-verdict
  classes in honest use). FIX WAVE 6 dispatched: ONE source of parent truth
  (replay exposes initial eligibility; classifier consumes it by construction),
  eligibility required AT the liquidation boundary (reversal invalidates the
  cause), all-or-nothing witness application with a typed completeness flag the
  CLASSIFIER consumes (any relevant refusal forces UNEXPLAINED; Notes demoted
  to evidence), and PRODUCTION-COMPOSITION regressions through the real caller
  path (the round-5 lesson: hand-fed booleans let composition defects hide);
  mutants m1 predicate-reverts / m2 latch-restored / m3 partial-apply /
  m4 flag-ignored (m3/m4 must kill DISTINCTLY).
- CODEX ROUND 2 ON TASK 8 (job review-ms7nylje-osrknx, ~8min, t8r2 @ 053b29a,
  base 865fa1c): needs-attention — 2H, BOTH the wave-1 disclosed residuals
  promoted with concrete mechanisms; everything else HELD (completeness law,
  CR hold, retry reset, reconnect ordering, m1–m4, exact-values migration not
  weakened). (H1) top-level found on every arm means an UNNARROWED
  result.found is still boolean|null — !result.found compiles and maps
  unknowable to a definitive negative; NOT a language limit: drop found from
  the union entirely, outcome is the sole discriminant (string literals cannot
  falsiness-conflate). INTEGRATOR NOTE, honest: the per-arm literal found was
  the ROUND-1 BRIEF'S OWN DESIGN — Codex completed the wave's logic where the
  brief stopped short. (H2) onHeartbeatFrame ignores baseReceived: a comment-
  only replacement connection stays open forever — watchdog refreshed,
  onHeartbeat surfacing healthy liveness, failedAttempts never counted — while
  the consumer retains connection N's stale data. FIX WAVE 2 dispatched:
  outcome-only union + permanent @ts-expect-error on result.found; pre-base
  heartbeats invisible to the consumer AND a base-frame deadline heartbeats
  cannot refresh (honest-proxy slow starts stay legal: comments never fail a
  connection instantly, they just never extend the deadline); regressions =
  comment-only exhausts maxAttempts with zero onHeartbeat + slow-but-honest
  guard; mutants m1 found-restored / m2 pre-base-surfaced / m3 deadline-
  refreshed (distinct kills). Reviewer ops: two dead-pid wedges from
  foreground dispatch (operator error, no side effects, stale job records
  disregarded); third dispatch backgrounded correctly and completed.
- **WAVE-6 FIX LANDED — 1bc660e** (4 files +564/−77, one NEW composition-test
  file; both-ways exact, client-ts files = live T8-wave-2 property). (H1)
  replaySameBlockCauses exposes InitialEligible/ParentDebtUSD/ParentIndex;
  obligation2Eligibility extracted from runBacktestCase consumes
  cause.InitialEligible — replay start and classifier predicate are ONE VALUE
  from one function; artifact Actual/margin now parent-boundary (event-time
  fold retained for exec-frame corroboration only). (H2) true→false in
  applied() clears Proven+Causes, bumps Reversals; BoundaryEligible = post-
  last-write state; Proven = crossed AND held; re-crossing records fresh
  cause; no cause-stack needed (identity consumed only in note text —
  verified). (M3) Liquidated arm refuses ENTIRELY on cross-token borrow leg or
  unseizable token; Complete() = len(Notes)==0; classifyIntraBlock's new
  replayComplete parameter returns UNEXPLAINED FIRST — before parentEligible,
  whose reconstruction rests on the same replay. Four production-composition
  regressions RED against a pure extraction (compile-stub fields — honest red
  without fake behavior) then green; m1–m4 killed with m3/m4 distinctness
  proven in-transcript (under m4 the replay-level test passes, only the
  composed verdict kills). 249/0/5; integrator independently re-ran — green
  (the parentFrame-redeclared diagnostic was stale gopls, tenth occurrence).
  New evidence keys: our_debt_usd6_at_parent, parent_boundary_index,
  same_block_replay_complete, same_block_replay_reversals,
  eligible_at_liquidation_boundary. DISCLOSED for round-6 adjudication:
  !replayComplete outranks parentEligible — a parent-eligible case with ANY
  refusal note resolves UNEXPLAINED (honest reading: tainted replay taints
  the predicate resting on it; counter-reading: over-refusal hides honest
  answers — routed to Codex). ROUND 6 dispatched: t6r6 @ 1bc660e, base
  821991e — walk InitialEligible's exclusivity, multi-reversal cycles,
  bypasses of applied(), other arms' unmodelable shapes, the widening
  adjudication, third-parent-computation hunt.
- **T8 FIX WAVE 2 LANDED — d5a62ad** (8 files +503/−58, zero new; both-ways
  exact; verify independently re-run exit 0, 263/263). (H1) top-level found
  REMOVED from every arm, type AND runtime — outcome (three non-empty string
  literals) is the sole discriminant, falsiness has nothing to grab; wire
  found survives only on raw accessors + inside the sealed response;
  enforcement is a @ts-expect-error battery: unnarrowed union, EACH arm
  separately (restoring the field on one arm makes that arm's directive
  unused → typecheck fails), unnarrowed client.address()/addressStress()
  incl. the reviewer's exact !result.found line as a compile-error pin,
  runtime hasOwn absence. Round-1's literal-found design (the BRIEF'S choice)
  completed, not reversed. (H2) onHeartbeat gated on baseReceived (pre-base
  comments still touch the transport watchdog — bytes-flow is real — but are
  never consumer-visible); NEW StreamOptions.baseFrameTimeoutMs — armed at
  connect, disarmed ONLY by the base frame, refreshed by NOTHING; expiry =
  protocol error + drop + reconnect = failed attempt under the wave-1 backoff
  law. Default heartbeatTimeoutMs when set (usable gets the same window as
  alive), else exported DEFAULT_BASE_FRAME_TIMEOUT_MS=45s, ON by default (the
  base is a NAMED event the contract owes every connection — the watchdog's
  opt-in rationale doesn't transfer); 0 disables. One pre-existing test's
  60s clock advance amended to 500ms (its base-less connection now rightly
  expires; intent unchanged — routed to round 3 to confirm). Red: 10
  typecheck + 12/12 regressions. Mutants m1/m2/m3 killed, m2/m3 distinct by
  disjoint kill sets (slow-but-honest kills only m2's class; deadline-
  exactness only m3's). Disclosed behavioral default change: base-less
  connections fail after 45s by default (documented 0 opt-out) — routed to
  round 3 for default-posture judgment (honest slow-server hazard vs owed-
  event discipline). Serena ops: running MCP server predates the config fix
  (language set fixed at startup) — TS symbolic tools error until a server
  restart; wave fell back to Read/Grep/Edit per sanction. ROUND 3 (closing)
  dispatched: t8r3 @ d5a62ad, base 6a9ba4e.
- CODEX ROUND 3 ON TASK 8 (job review-ms7p7e0v-xt7btq, ~6min, t8r3 @ d5a62ad,
  base 6a9ba4e): needs-attention — 1H; H2 (base deadline) HOLDS. The H1 CLASS
  survives beyond lookup.found: positionEligible()/aaveEligibleFromWad()
  return boolean|null (null = refused/never-swept), and the primary payloads
  export nullable verdicts through generated Position.liquidatable,
  StressState.liquidatable, ProjectionHorizon.becomes_liquidatable —
  !positionEligible(p) renderSafe() compiles and paints a withheld verdict
  definitively safe (conf .99). The round-2 fix sealed the named instance;
  the class kept three more doors. FIX WAVE 3 dispatched with a CLASS-SWEEP
  requirement: inventory EVERY exported boolean|null definitive-verdict
  field/return (seal or justify each), helpers → sealed string unions
  ('liquidatable'|'not-liquidatable'|'unknowable'-family), primary payloads
  refined via total mapping (null → 'unknowable'; raw fields ABSENT type+
  runtime, Omit + destructure-rest; wire shapes only on raw accessors;
  generated schema and contract UNTOUCHED — the drift gate pins them),
  @ts-expect-error pins on the reviewer's exact traps + per-field battery,
  mutants incl. the mapper smuggling null→'not-liquidatable'. Wave-1/2 laws
  must stay green.
- CODEX ROUND 6 ON TASK 6 (session 019fb3c0-b5eb-7cf1-a25a-18dd44cf309f,
  ~10.5min, t6r6 @ 1bc660e, base 821991e): needs-attention — 2H; the H1/H2/M3
  regressions and mutants adjudicated structurally non-vacuous, frame/registry
  unchanged. (H1) the routed WIDENING ADJUDICATED AGAINST THE WAVE: a later
  replay refusal must NOT override the independently-pinned parent fact —
  InitialEligible is established from N-1 state BEFORE witnesses apply, and
  the binding gate rule says parent-true = exact pass; cross-token refusal
  currently converts a valid true-at-parent into UNEXPLAINED = false failures
  on honest multi-token activity. Law: SPLIT parent-state completeness (parent
  fold + parent index reconstruction) from boundary-replay completeness (only
  gates crossing-based verdicts). (H2) boundary held-ness ignores EVENTLESS
  Safe collateral changes: execEligible revalues the PARENT basket; repo
  authority says collateral moves through Safe ERC20 balances with NO DM
  event; unseen top-up reverses eligibility + later price move satisfies
  execEligible on the stale basket = false marginal pass on a stale cause.
  Compounding: the Liquidated arm silently CLAMPS over-seized replay balances
  to zero without a refusal note (Complete stays true) — the no-silent-caps
  law violated inside the fix that made refusal structural. H2's remedy forks
  on a chain-reality question (taint-everything guts the marginal class —
  eventless transfers are invisible in EVERY case; archive balanceOf/Transfer-
  sweep continuity proof may be sound and proportionate): CHAIN-TRUTH CONSULT
  dispatched — premise verification (where the Safe-balance authority is
  recorded; DM-mediated vs direct top-up paths), the A/B/C fork (structural
  taint / archive-read continuity with fixture posture / disclosed qualifier),
  directional laws (top-up reverses, unseen withdrawal fabricates), seizure-
  insufficiency semantics. Wave 7 cuts AFTER the ruling; H1 split + silent-
  clamp refusal are uncontested and join it.
- **CHAIN-TRUTH RULING LANDED** (archived NORMATIVE at .superpowers/sdd/
  p3-consults/chain-truth-basket-continuity-ruling.md; ~10min consult). VERDICT:
  custody breaks at 1bc660e for the marginal-disclosed class. Premise verified
  from repo authorities (derivation-notes caveat 4, DebtManagerCore/CashLens
  committed source) AND MATERIALLY WIDENED: the basket leg is balanceOf(safe) −
  pendingWithdrawalAmount, and the NETTING TERM moves with ZERO transfers
  (CashModule withdrawal lifecycle on the CashEventEmitter singleton — outside
  walked custody AND outside the Transfer layer), including inside EVERY
  liquidation tx (preLiquidate → _cancelOldWithdrawal, after the eligibility
  check, before the Liquidated log). Codex R6's literal remedy (Transfer
  custody alone) is therefore UNSOUND — it would false-pass netting moves and
  spuriously refuse every pending-withdrawal liquidation. Fork ruled A-THEN-B:
  L1 continuity conjunct (default false; marginal → UNEXPLAINED w/ pinned
  basket_continuity disclosure; true-at-parent NOT gated — rests on pinned N-1
  reads) + L5 seizure preflight (refuse-entire-write; note names BOTH honest
  over-seizure shapes: unseen inbound vs netting release) cut NOW; L2 boundary
  reconstruction (N-1 state + ordered block-N logs — eth_call CANNOT serve the
  mid-block boundary; blockHash-pinned Transfer sweep + CashEventEmitter
  netting sweep; per-token closure identity leg@N − leg@N-1 == ΣTransfers −
  Δpending refusing non-standard tokens BY ARITHMETIC, no allowlist;
  attribution law with the case's own pre-boundary seizure transfers
  chain-guaranteed) + L3 boundary-basket execEligible + L6 EIP-234 probe + L7
  hermetic fixtures = the designed NEXT wave. Interim all-marginal-UNEXPLAINED
  posture ruled "correct, not a regression." WAVE 7 DISPATCHED: H1 split
  (parent completeness = fold + index reconstruction; later refusals cannot
  un-pin the parent fact) + L1 + L4 narrative + L5; positive controls RESTATED
  not deleted (replay internals still asserted; verdict reflects L1; each
  marked "flips back when L2 lands"); mutants m1 parent-gate-restored / m2
  conjunct-deleted / m3 clamp-restored.
- **T8 FIX WAVE 3 LANDED — e073cbe** (8 files +808/−59, refine.ts +
  refine.test.ts NEW; both-ways exact incl. the two untracked files; verify
  independently re-run exit 0, 286/286 — the decimal.ts diagnostic was stale
  tsserver, again). The CLASS sealed, not the instance: sweep-first inventory,
  11 entries dispositioned — SEALED: the three reviewer-named generated fields
  + sweep-found Leg.used_as_collateral (null on DM legs = engine publishes no
  statement) + both helpers REMOVED for verdict-union successors
  (positionVerdict/aaveVerdictFromWad); NOT-A-VERDICT justified:
  StreamPayload.recovered (marker — absence ≡ false per contract), config
  options; RAW INPUT: the wire found lookup() consumes; NOT IN CLASS: total
  booleans. refine.ts = ONE module holding both vocabularies
  (LiquidationVerdict/CollateralUse — 'counted' is the contract's own phrase),
  TOTAL mapping (null → 'unknowable' never definitive; invariant error only on
  contract-impossible values), destructure-rest mappers (raw keys absent at
  runtime), lookup() refines AFTER the completeness invariants → both primary
  methods serve refined bodies; raw only on the Raw accessors. Fields RENAMED
  (liquidation_verdict/collateral_use) because the pin battery needs runtime
  hasOwn absence. Red 17 typecheck + 24 tests; mutants m1 raw-key-kept (dual
  kill: typecheck pins + runtime), m2 mapper-smuggles-null→definitive (killed
  by the withheld-refines-to-unknowable law), m3 helper-regrows (killed by
  exactly its pin). ROUND 4 (closing) dispatched: t8r4 @ e073cbe, base
  bee4946 — reviewer re-runs the sweep independently, verifies mapping
  totality + nesting coverage, checks the SSE-payload surface for raw-field
  leakage (integrator-added: stream events were NOT touched by the wave),
  adjudicates the three disclosed items (leg sealing scope, uniform field
  name, recovered disposition).
- CODEX ROUND 4 ON TASK 8 (session 019fb3de-fad1-7481-82b4-b8e1b89f43ad,
  ~7.5min, t8r4 @ e073cbe, base bee4946): needs-attention — 1H, DOCS-ONLY BUT
  REAL. The implementation seals the class CORRECTLY; all three disclosed
  adjudications HOLD; independent strict typecheck of production sources
  passed; no SSE leak flagged. The residual: README:66-156 still TEACHES the
  removed API — promises positionEligible(): boolean|null, imports and calls
  it, claims result.response carries everything-but-found. Honest JS consumer
  reads the absent raw verdict as undefined → !undefined renders SAFE — the
  exact class, resurrected through documentation; and no doc example is
  compiled, so verify stays green (false green). Waves 1-2 updated the README
  for their own changes; wave 3 did not sweep it — the miss. FIX WAVE 4
  dispatched (small): full-README sweep to the current surface, plus COMPILED
  DOC EXAMPLES — fenced ts blocks extracted to real example files included in
  the verify typecheck, with a verbatim-sync vitest (README block ⇄ example
  file, either drifting alone fails) and a falsiness-lint assertion on
  fenced blocks; mutants m1 removed-export-in-example / m2 README-drifts-
  alone / m3 falsiness-branch-inserted; no new devDependencies.
- **WAVE-7 FIX LANDED — 6dea23a** (5 files +614/−85, one NEW wave7 test file;
  both-ways exact; integrator independently re-ran gofmt/vet/build/tests —
  green, 257/0/5). Ruling implemented VERBATIM. (H1) ParentComplete = fold
  present AND index reconstruction succeeded — undecodable/non-positive
  oldIndex BLOCKS with a note (the old silent snapshot-fallback removed);
  classifier re-signed to 7 args and REORDERED, parent arm FIRST and
  structurally unreachable by witness refusals (they only taint Complete());
  round-5's replay-incomplete-blocks-parent assertion REVERSED per R6-H1.
  (L1) marginal = causeProven && execEligible && basketContinuityProven;
  conjunct is a const false, comment names L2 as sole discharger; gated rows
  carry the ruling's verbatim basket_continuity text + a narrative separating
  the PROVEN crossing from the UNPROVEN attribution; ungated arms pinned
  undecorated; tolIntraBlockMarginality uncited while gated (zero appearances
  = honest per the tolerance-report doctrine). (L5) per-token aggregate
  preflight, strict Cmp>0 refuses the WHOLE write with the two-explanation
  note (unseen inbound / netting release); silent clamp REMOVED; equality
  applies exactly. Positive controls RESTATED (assert Proven/BoundaryEligible/
  Complete() directly + both conjunct polarities — the arm survives for L2),
  marked flips-back-when-L2-lands. L2 seam exposed: causeReplay
  .BoundaryCollateral, consumed by nothing. Mutants m1/m2/m3 killed at the
  final SHA, sha256 restores. Wave's sibling-session-committed-the-dirt claim
  checked: FALSE — no foreign commits in log; the session-start snapshot was
  stale. ROUND 7 dispatched: t6r7 @ 6dea23a, base dd5ccfd, ruling committed
  in-worktree and MANDATED reading — verify H1 arm order + tick-choice
  semantics, L1 verbatim-ness + counterfactual leak-proofness, L5
  completeness, restated-test strength for L2 inheritance, ADJUDICATE the
  interim posture's shippability (SHIP closes round-6 findings; L2/L3/L6/L7
  remain the ruling's committed obligation).
- **T8 FIX WAVE 4 LANDED — e437ae0** (9 files +594/−67: README + tsconfig M,
  sync test + six examples/readme-*.ts NEW; both-ways exact; verify
  independently re-run exit 0, 291/291). THE README IS A COMPILED SURFACE:
  every ts fence lives verbatim in an example file between markers, compiled
  by the verify typecheck against the REAL public surface (tsconfig paths
  @solvent/client → src/index.ts; build config unaffected);
  readme-sync.test.ts enforces bidirectional multiset equality + a docs
  falsiness-lint (name-based, limits honest in-header — the type seal stays
  load-bearing) with anti-vacuity controls BOTH directions. Full-file sweep:
  verdict-class section w/ total-mapping table, raw-keys-only-via-raw-
  accessors at every site, === on every discriminant, function-shaped blocks,
  refine.test.ts finally documented. Red = the finding verbatim (TS2305 on
  the stale fence) + lint catching the stale !result.complete. Mutants: m1
  typecheck-kill, m2 sync-kill both directions, m3 THE SHARP ONE — falsiness
  branch inserted identically both sides, typecheck GREEN, lint-only kill:
  proves the compiler cannot catch string falsiness and the lint is the sole
  working guard. ROUND 5 (expected FINAL — implementation adjudicated correct
  in r4) dispatched: t8r5 @ e437ae0, base b9c2a10 — README-vs-surface
  accuracy, sync normalization soundness, paths-mapping leak check, lint-
  limit adjudication.
- CODEX ROUND 7 ON TASK 6 (session 019fb3f2-1c6e-76e2-8229-777c3ef975d9,
  ~8min, t6r7 @ 6dea23a, base dd5ccfd, ruling read): needs-attention — 1H;
  L1 AND L5 HOLD. The wave-7 H1 split opened a NEW seam: ParentComplete can
  certify an UNREAD parent basket (backtest.go:779-829) — Multicall3 subcalls
  with Success=false silently skipped, full-frame validation prices only
  SEIZED tokens, so a failed collateralOf leaves an empty basket, maxBorrow
  computes 0 "fully priced", ParentComplete set from debt fold + index alone,
  and the NEW first arm returns true-at-parent BEFORE the unpriced refusal —
  an honest historical RPC subcall failure becomes a false EXACT pass. The
  composition tests construct complete in-memory frames and cannot see the
  decode layer (the round-7 lesson: inject degradation where it occurs).
  SEQUENCING CORRECTED BY THE REVIEWER: L2/L3/L6/L7 are mandatory BEFORE
  acceptance (not after) — adopted; the maintenance window's reconcile
  acceptance now waits on the L2 wave + its round. FIX WAVE 8 dispatched:
  unread on ANY degraded subcall (per-subcall law, full inventory required;
  exec-frame sharing question answered explicitly), basket valuation
  completeness joins the ParentComplete conjunction (silent-zero
  unrepresentable), arm order distinction made explicit (parent-INPUT
  refusals gate the parent arm; WITNESS refusals do not), decode-layer
  regressions (Success=false / missing config / empty-undecodable return →
  never EXACT; honest-frame guard), mutants m1 skip-restored / m2
  conjunction-dropped / m3 order-restored (distinct kills).
- CODEX ROUND 5 ON TASK 8 (session 019fb3fb-04ba-7aa3-9227-c692fa9efdc4,
  ~8min, t8r5 @ e437ae0, base b9c2a10): needs-attention — 1 MEDIUM, surgical.
  README-vs-API accuracy HELD; sync/typecheck wiring HELD. The residual: the
  falsiness lint's vocabulary (result/lookup/verdict/found/outcome) misses
  the CANONICAL field names it exists to protect — !position.liquidatable,
  !leg.used_as_collateral, !horizon.becomes_liquidatable, !leg.collateral_use
  all pass typecheck + sync + lint (nullable booleans render null definitive;
  the refined string unions collapse every token into one branch). Direct
  public field names, NOT the disclosed alias-evasion limit. FIX WAVE 5
  dispatched (small): vocabulary tied to the sealed-field inventory (const +
  cross-check assertion so a FUTURE sealed field can't be forgotten),
  per-expression anti-vacuity positives, the reviewer's synchronized mutant
  (identical insertion both sides — typecheck green, sync green, lint kills),
  expanded lint run against the actual README (violation-or-explicit-none).
  Then round 6 final.
- **T8 FIX WAVE 5 LANDED — 714c1f6** (ONE file, test/readme-sync.test.ts
  +170/−13; both-ways exact — cmd/reconcile edits = live wave-8 property;
  verify independently re-run exit 0, 292/292; the wave survived a mid-flight
  SESSION-LIMIT kill and SendMessage-resume with zero work lost). The
  vocabulary is DERIVED, not remembered: SEALED_FIELD_NAMES + HEURISTIC_
  CHAIN_NAMES → the regex, no second list; the cross-check is a TYPE-LEVEL
  law both directions (mapped sweep of every named schema for boolean|null +
  every refined shape for the exact union types, held via non-distributing
  conditional-typed constants — a forgotten future field is a COMPILE ERROR
  with a self-describing message; a stale name fails the reverse). Red
  reproduced the finding exactly (four fields genuinely uncovered;
  liquidation_verdict was already substring-caught). Mutant 0 const-name-
  removed = typecheck kill; Mutant A (reviewer-required, identical both
  sides) = LINT-ONLY kill; Mutant B original class still dies. Actual README:
  no real violation (postfix total_collateral! correctly unflagged).
  Disclosed regex limits (index-broken chains, aliasing, anonymous nesting —
  none exist today) in the honest-scope comment; AST lint = escalation path.
  ROUND 6 (expected FINAL for the T8 train) dispatched: t8r6 @ 714c1f6, base
  b3f4e2e, single-file diff — verify the mapped-type sweep's schema coverage,
  both-directions law, regex composition, mutant plausibility, no smuggled
  drift.
- **WAVE-8 FIX LANDED — 75f1962** (3 files +670/−84, wave8 test file NEW;
  both-ways exact; integrator independently re-ran — green; the wave survived
  the session-limit kill + resume with zero loss). ONE decode path builds
  both frames; the per-subcall law in the shared loop: Success=false /
  empty-where-ABI-promises / undecodable → WHOLE frame unread, subcall named
  (five-subcall inventory + response-count belt); runBacktestCase now refuses
  exec.st.unread too (disclosed: total exec multicall failure = honest
  whole-case refusal, was degrade-to-partial). ParentComplete = fold AND
  index AND basket (BasketNote prong + internal valuation recheck — a
  forgetful caller cannot smuggle an unvalued basket); neither prong touches
  witness Notes (round-6 split preserved); genuinely-empty decoded basket
  stays legitimate. parentComplete now ALSO a marginal-arm conjunct (a
  crossing proven over a degraded basket proves nothing). New keys:
  parent_basket_complete/_note. Red = the false EXACT reproduced at the
  composition layer; m1/m2/m3 killed with PROVEN distinctness. LEASE DETOUR
  mid-landing: the integrator lease expired 17:35Z mid-commit (pre-commit
  gate blocked correctly); hand-edit rejected by doctor (future timestamp,
  then invalid-rotation) — claim.py renew was the lawful path, which itself
  required pruning the 10 idle reviewer worktree REGISTRATIONS (claim tool's
  single-worktree invariant; OS dirs remain inert-locked as known). Renewed
  through 2026-07-31T01:40Z gen-12 (e77d5a4, committed ALONE per the
  claim-rotation gate), then 75f1962. OPERATIONAL RULE CHANGE: reviewer
  briefs now instruct worktree-registration removal at review end.
- CODEX ROUND 6 ON TASK 8 (session 019fb414-3a9c-7131-81db-00a75ea0bdbd,
  ~6min, t8r6 @ 714c1f6): needs-attention — 1 MEDIUM; vocabulary, regex
  mutants, two-way checks, single-file diff all HELD. The coverage law's
  TYPE EXTRACTION misses three common shapes: optional fields (boolean|null|
  undefined not matched), nested objects (never traversed — ErrorBody.error
  is ALREADY anonymous, refuting the every-shape-is-named comment), array
  element types (explicit never). Compiler-mutant-confirmed bypasses: an
  honest future contract change in any of those shapes silently escapes the
  seal. FIX WAVE 6 dispatched: recursive extraction (Required-normalized
  optionals, object recursion, T[number] recursion, bounded depth w/ margin
  assertion), corrected current-schema claim, compile-fail mutants mA/mB/mC
  per shape + re-run of all four prior kills. T6 ROUND 8 dispatched in
  parallel (t6r8 @ 75f1962, base a241db0, lease-renewal commit e77d5a4
  noted-and-excluded): decode-law walk (sixth-subcall hunt, legit-empty vs
  promised-data distinction, belt fires), conjunction bypass hunt, arm-order
  text-vs-code, the two disclosed judgment calls, regression realism.
- **TASK 6 PRE-L2 POSTURE CLOSED — SHIP** (round 8, session 019fb420-d8cf-
  7192-96b4-f1abc8b99379, ~6.5min, t6r8 @ 75f1962): "approve — SHIP. The
  round-7 false-EXACT path is closed, both disclosed judgment calls
  adjudicate cleanly, and the regression/mutant sets are non-vacuous and
  distinct. No material findings." Reviewer's static-trace caveat (read-only
  sandbox, no Go execution; "will not treat an unexecuted test as passing
  evidence" — SHIP grounded in the static non-vacuity trace) is ALREADY
  discharged: the integrator independently executed the full scoped suite in
  the real repo before committing 75f1962. Trace detail worth keeping:
  collateral tokens discovered only by collateralOf get no follow-up
  valuation calls and correctly become a GATED unpriced refusal, not a false
  pass. Rounds 1-8 program: contact→ABI→causation→composition→ruling→
  interim-posture→decode-layer. THE L2 WAVE IS NOW THE ONLY REMAINING T6
  OBLIGATION (then round 9 = acceptance-eligible SHIP). L2 WAVE DISPATCHED
  (the ruling as spec): STEP-0 L6 EIP-234 blockHash-getLogs probe (STOP-and-
  report if unserved), getLogs plumbing w/ response validation, per-case
  Transfer + CashEventEmitter netting sweeps (ABI-derived topics), closure
  identity per token, attribution law, L3 execEligible over
  BoundaryCollateral (both prongs or neither), L7 hermetic fixtures w/ the
  chain-impossible rule + capture split sanctioned (refusal-over-fabrication
  if 31 full captures disproportionate), flip-back of the L1-era restated
  controls, mutation floor m1-m4 incl. the Δpending-dropped mutant proving
  the ruling's own netting insight. RPC secrets by env-var name only;
  STOP-don't-improvise if the ruling meets unanticipated chain reality.
- **T8 WAVE 6 LANDED — 15becd9** (ONE file +114/−28; both-ways exact;
  generated schema confirmed byte-identical to HEAD post-mutants; verify
  independently re-run exit 0, 292/292). DeepNullableBooleanKeys: Required-
  normalized optionals, object+array recursion (unions distribute; anonymous
  shapes traversed), tuple-budget bound (13) FAIL-CLOSED via sentinel
  poisoning + TWO probe constants (coverage never bottomed out; margin
  re-run at 8 = today's exact deepest chain) — a ninth nesting level is a
  NAMED compile error long before coverage runs out. Red: all three shape
  mutants compiled exit 0 under the old sweep. Green: mA/mB/mC each killed
  alone by the self-describing error; all four prior kills re-run green.
  Corrected inventory comment (ErrorBody.error the one anonymous shape).
  Disclosed: optional mutant fields (required broke fixtures — noise not
  law); refined-shapes side stays flat-enumerated (flat today). ROUND 7
  (expected FINAL for T8) dispatched: t8r7 @ 15becd9, base f3e400c —
  Record/tuple/readonly evasion hunt, sentinel fail-closed verification,
  margin-count check, disclosed-item adjudication.
- **TASK 8 CLOSED — SHIP** (round 7, session 019fb431-48bd-7920-9a7e-
  2d95806d3ef1, ~8min, t8r7 @ 15becd9): "approve — SHIP. The recursive sweep
  distributes through nullable unions, normalizes optional properties under
  both exactOptionalPropertyTypes modes, handles nested objects, arrays,
  tuples, readonly shapes, and Records without a silent bypass, and preserves
  fail-closed exhaustion. Independent depth analysis confirmed the maximum
  chain is exactly 8; a ninth-level in-memory mutant failed only the margin
  probe while the 13-level sweep remained complete. mA/mB/mC and prior
  missing/stale-name mutants were killed as claimed. The optional mutants and
  flat refined-shape residual are acceptable disclosed limitations. The range
  is exactly one file with no drift. No material findings." Program: wave
  (d664886, 202 tests) → regen (f58bc48) → r1 4H/1M → fw1 053b29a (sealed
  union, law-before-branch, CR hold, drop-and-reconnect, base-frame reset) →
  r2 2H → fw2 d5a62ad (outcome-only union, base deadline) → r3 1H → fw3
  e073cbe (the CLASS sealed, refine.ts) → r4 1H docs → fw4 e437ae0 (README a
  compiled surface) → r5 1M → fw5 714c1f6 (vocabulary derived) → r6 1M → fw6
  15becd9 (recursive fail-closed sweep) → r7 SHIP. Seven rounds, six fix
  waves, 292/292, drift gate green throughout, zero runtime deps preserved.
  **SHIP 3 of 4.** Reviewer ops note: one foreground-dispatch wedge
  (orphaned job never touched, fresh backgrounded dispatch per protocol).
  REMAINING: Task 6's L2 wave (running) → round 9 → SHIP 4 of 4 →
  maintenance window + acceptance. The cmd/riskd genesis-test diagnostics
  appearing in-stream are STALE gopls (that signature landed at 06d0a25,
  suite + -race green, CI green) — eleventh occurrence, compiler remains the
  authority.
- **L2 WAVE LANDED — 639d7eb** (45 files +4,539/−56: basket_continuity.go
  ~700 lines + tests + captured suite + 31 fixture JSONs + probe record;
  both-ways exact; integrator independently re-ran — 253/0/7; survived one
  session-limit interruption earlier in the train; wave ran ~51min).
  HEADLINES: (L6) both RECON_RPC_OP endpoints serve EIP-234 blockHash-form
  getLogs at frame-era depth — blockHash==range log-by-log at both probe
  pins, recorded in recon/p3-probes.md as a committed env-gated live test.
  (L2) closure identity per token over parent ∪ seized ∪ EXEC legs (union
  WIDENED past the ruling — closes the inbound-new-token blind spot);
  Δpending signs derived from committed CashModule source; WithdrawalAmount-
  Updated has NO committed caller → underivable → refuse; attribution
  two-sided (a fixture missing its own seizure transfers is chain-impossible
  and REFUSED); netting modeled IFF the case's own final pass (earlier-pass
  cancellation = attributed-but-unmodeled → refuse — the floor, not the
  extension); T6Witness gained TxHash. (L3) execEligible over
  BoundaryCollateral iff proven, disclosed per row. (L1) discharged:
  := proof.Proven, the const seam gone; unproven text verbatim-stable.
  (L7) **31/31 captured through the PRODUCTION assembler, ALL PROVED, zero
  refusals — the ruling held against real chain data with nothing
  unimplementable.** Population facts: 22 cases are zero-amount seizures
  over empty baskets (chain emits no Transfer for zero elements — the
  two-sided law matches); real-seizure cases confirm the outbound aggregate
  law; ZERO netting events frame-wide (Δpending synthesis-exercised only —
  chain fact, disclosed, mutation-proven load-bearing). Mutants m1-m4 killed
  incl. m2's OPPOSITE-direction pair (drop Δpending → pending-liquidation
  false-refuses AND netting-moved false-passes — the ruling's netting
  insight proven in both failure directions). New keys:
  basket_continuity (proven text), basket_continuity_refusals,
  exec_eligibility_basket, over_seizure_discrimination. ROUND 9 (FINAL — on
  SHIP the P3 review program closes 4 of 4) dispatched: t6r9 @ 639d7eb, base
  21880a7 — ruling conformance law-by-law, Δpending signs vs source,
  attribution edge cases (two-pass block, per-(tx,token) granularity),
  capture honesty (production-assembled? zero-refusal credible? hermetic
  replay re-runs the PROOF?), the two sharpenings + synthesis-only Δpending
  adjudicated. CHAIN-TRUTH ACK requested in parallel (same standing
  instance) for the two refusal-widening sharpenings — Codex judges
  honest-use, chain-truth judges chain-reality.
- **CHAIN-TRUTH ACK/ADJUST LANDED** (addendum archived NORMATIVE in the
  ruling file, e2ea9db): CUSTODY HOLDS with two adjustments. (Adj 1) union
  widening ACKED in motive, ADJUSTED to the complete form — the three-way
  union still misses a supported token inbound-then-fully-outbound WITHIN
  block N (zero at both edges, invisible to parent∪seized∪exec, raises
  boundary maxBorrowLT exactly like H2's top-up — the same class one gap
  deeper); the swept list becomes the DM's SUPPORTED-COLLATERAL SET at both
  pins (getCollateralTokens@parentHash ∪ @pinHash — the provably-sufficient
  universe since only configured tokens move maxBorrowAtFrame; mid-block
  Added/Removed is DM-custodied and covered by the both-pins union). (Adj 2)
  netting modeled-iff-final-pass ACKED conditional on the invariant being
  EXPLICIT: the own-pass cancellation must NEVER enter the boundary-
  eligibility basket (eligibility judged NETTED at :526/:544 BEFORE :568's
  cancel — own-pass is post-check: attributed for closure, available to
  seizure/L5, but the crossing evaluates against the netted basket); if the
  implementation adds freed amounts to the eligibility basket, INVERT (error
  direction over-refusal, should-fix not custody-break); fixture-pin both
  arms. Record items: WithdrawalAmountUpdated refuse-on-sight right;
  opposite-direction mutation pair = the L7 floor; zero-element skipping
  chain-faithful (observed, not assumed). ADJUSTMENT WAVE dispatched
  (surgical: the two supported-set reads through the shared decode loop w/
  wave-8 law coverage pinned, minimality-check decision, in-and-out refusal
  fixture as the m1 killer, netted-boundary assertion on the own-pass arm,
  31/31 re-capture w/ STOP-on-flip). Round 9 runs in parallel on PINNED
  639d7eb — its findings and the adjustments merge at the next landing.
- CODEX ROUND 9 ON TASK 6 (session 019fb48b-4434-73f2-96be-e915636a2a2e,
  ~14min, t6r9 @ 639d7eb, base 21880a7): needs-attention — 1H, and it is
  THE SAME GAP chain-truth's adjustment 1 found independently minutes
  earlier: the Transfer sweep's address set (parent∪exec∪seized endpoints)
  omits TRANSIENT boundary tokens — a supported token in before L and out
  after L appears in no endpoint set, both getLogs calls are address-
  filtered to that union, so closure and attribution pass and Proven=true
  despite an unchecked pre-boundary basket increase; "the committed captures
  cannot disprove this because they record the same narrowed production
  queries." TWO INDEPENDENT AUTHORITIES, ONE DEFECT, ONE REMEDY (the
  supported-collateral set at both pins) — the strongest convergence signal
  the program has produced; the adjustment wave was ALREADY mid-
  implementation and received the round-9 verbatim regression shape (token
  absent from all three endpoint sets, out-leg AFTER L) plus one nuance
  relayed: netting events name tokens, so a netting event naming a token
  outside the swept set → refuse (a belt — netting only applies to
  supported collateral, so a firing belt means the supported-set premise
  broke) plus the per-case address-list-length diff in the re-capture
  report. No separate fix wave needed — the lanes merged.
- **ADJUSTMENT WAVE LANDED — 5f18f28** (37 files +715/−81: code delta in
  backtest.go + basket_continuity.go + new adjustment test file; 31 fixtures
  re-captured; both-ways exact; integrator independently re-ran — green).
  (Adj 1) getCollateralTokens in BOTH frames through the shared wave-8 loop
  (degraded read ⇒ frame UNREAD, pinned both frames — a narrower sweep from
  a failed read is unrepresentable); swept list = supported@N-1 ∪
  supported@N; old endpoint union KEPT as a MINIMALITY refusal; round-9
  verbatim regression REFUSED (token absent from all three endpoint sets,
  both exit shapes incl. post-L liquidation); m1 kill includes a WITNESSED
  behavioural false-pass under the reverted sweep (proven=true, empty
  refusals — the exact round-9 harm). Netting-token belt landed (event
  post-boundary so the belt is the only defense). (Adj 2) ALREADY CORRECT —
  the custody filter makes emitter events structurally unreachable in the
  replay; basket = netted-parent ± seizures only; CancelledPreBoundary feeds
  evidence exclusively; invariant now explicit + composition-layer pinned
  (maxBorrowLT@exec stays NETTED at 70000000, marginal verdict survives);
  m2 (netting re-applied) kills with the exact predicted regression.
  RE-CAPTURE: address lists 1-17 → 16-20 per case; ALL transfer envelopes
  byte-identical — the empirical answer to round 9's "captures cannot
  disprove" (no supported token beyond the old union touched any Safe
  in-block); 31/31 proven, refusal sets byte-stable; old captures refuse
  LOUDLY, never fall back. Parent and exec supported sets equal in all 31
  (no mid-block config change in any case block). ROUND 10 (TRUE FINAL)
  dispatched: t6r10 @ 5f18f28, base 0e06a7a — sufficiency of the supported
  universe vs the maxBorrowAtFrame config dependency, third premise-break
  hunt beyond the two belts, regression fidelity, adjustment-2 structural
  verification, capture honesty. On SHIP: 4 of 4 → maintenance window.
- CODEX ROUND 10 ON TASK 6 (session 019fb4b0-24a8-7c80-8b4a-469ee201db11,
  ~11min, t6r10 @ 5f18f28, base 0e06a7a): needs-attention — 1H, the third
  premise-break shape the brief asked it to hunt: a CollateralTokenAdded→
  Removed ROUND TRIP within the block leaves a token absent from BOTH pinned
  enumerations; if the Safe ALREADY HOLDS it (no Transfer, no netting
  event), the transient config moves maxBorrowLT mid-block — both belts
  silent, replay treats the lifecycle events as Unrelated via the default
  branch; a modeled interest crossing reversed-then-re-crossed by the
  add/remove pair falsely reports held-to-L and Proven=true. The round-9
  transfer shape itself is CLOSED. LIFECYCLE FIX WAVE dispatched (minimal
  refusal per the recommendation's floor — the same precedent as netting
  modeled-iff-final-pass): decode arms for Added/Removed (ABI-derived
  topic0s), ANY pre-boundary occurrence → replay incomplete → UNEXPLAINED
  via the existing structural path; post-boundary ignored (cannot affect the
  pre-L crossing); full DM event-surface disposition inventory required (the
  artifact that lets round 11 close the fall-through class, not the
  instance); regression = the finding's exact shape (pre-held token, absent
  both pins, add+remove pre-boundary, crossing disturbed) + event-triggered
  guard; m1 = arms reverted → witnessed false-pass. 31/31 must stay proven
  byte-stable (zero lifecycle events in the frame — parent==exec supported
  sets in all 31).
- **LIFECYCLE FIX LANDED — 16b0a5d** (3 files +308/−6; both-ways exact;
  integrator independently re-ran — green; the stray zz_capture_diff temp
  file from the adjustment wave confirmed already deleted). Added/Removed
  join dmWitnessABI from the committed artifact (non-indexed token in DATA;
  per-field pin vs the independently-parsed artifact); the arm decodes only
  to NAME the token in the refusal note, applies nothing, refuses on
  undecodable, NOT scoped to held tokens; post-boundary never reaches the
  arm (collector bound log_index < L). THE CLOSURE ARTIFACT: all 21
  committed DM events dispositioned — 5 applied / 2 refuse / 8 irrelevant
  with source-cited reasons / 3 never-emitted-in-committed-source / infra —
  the channel taxonomy is now CLOSED (balances swept, netting swept,
  configuration witnessed-or-refused). Two judgment calls DISCLOSED for
  round 11: cross-token InterestIndexUpdated stays Unrelated (round-4
  single-debt-token boundary, pre-existing — cross-token acquisition events
  already refuse); Upgraded does not refuse (engine identity governed by
  the recon implementation pins). RED = the finding's false pass verbatim;
  regression = the exact shape incl. pre-held-token nuance; event-triggered
  guard; m1 killed 1/1; 31/31 byte-stable (the green suite is ITSELF proof
  the frame carries zero lifecycle events). ROUND 11 (closing) dispatched:
  t6r11 @ 16b0a5d, base 07e8a70 — audit the inventory against sources
  (wrong-irrelevant hunt, never-emitted greps, artifact exhaustiveness),
  refusal-arm reachability incl. lifecycle-as-only-witness, the two
  judgment calls, regression fidelity, no-prior-law-regressed.
- CODEX ROUND 11 ON TASK 6 (session 019fb4e2-29e6-78f1-9e17-c9829de9b4d2,
  ~19min, t6r11 @ 16b0a5d, base 07e8a70): needs-attention — 1H/2M. THE
  INVENTORY HELD: all 21 dispositions checked out, all three never-emitted
  claims verified zero emit-sites, lifecycle refusal correct (topic0s,
  decode paths, Complete(), the SQL bound), cross-token tick accepted as the
  frozen-frame limitation. (H) event-semantics provenance NOT structurally
  closed: DebtManagerCore.setAdminImpl writes ADMIN_IMPL_POSITION with NO
  Upgraded event; the proxy fallback delegatecalls that implementation, so
  the two-Upgraded census proves only the UUPS core era — a pre-boundary
  admin swap + admin write could change event semantics with zero refusal.
  (M2) the lifecycle regression narrates tokB's harm but never instantiates
  it (no balance/price — green even if tokB couldn't affect eligibility).
  (M3) the emitted input_frames text still asserts the sufficiency premise
  the round-trip disproved. PROVENANCE FIX WAVE dispatched with the
  INTEGRATOR'S D-013 ADJUDICATION on H1's remedy: trace-scanning is
  disproportionate (debug_trace plumbing, demo-grade bar) — instead a
  TWO-PIN SLOT READ (eth_getStorageAt ADMIN_IMPL_POSITION @ both pins,
  slot derived from source with a pinning test, == a newly-audited admin
  impl constant established with the same provenance discipline as the
  core pins; wave-8 decode law applies; mismatch = frame refusal; STOP on
  any real historical epoch found). The RESIDUAL — within-block swap-and-
  revert between the two reads — is ACCEPTED-AND-DISCLOSED per D-013
  (honest governance has no swap-back motive; the choreography is
  evasion-shaped), recorded in code + evidence + carried to round 12
  explicitly. M2: instantiate the arithmetic (replay-internal/counterfactual
  assertions prove the harm is real while the verdict stays conservative).
  M3: text sync w/ STOP-if-digest-bearing guard.
- **PROVENANCE FIX LANDED — ea25975** (41 files +920/−53: admin_epoch.go +
  test NEW, 31 fixtures re-captured with admin-impl words, derivation-notes
  pin record; both-ways exact; integrator independently re-ran — green).
  (H1) ADMIN_IMPL_POSITION derived from source EVERY RUN (test extracts the
  literal AND the keccak preimage from DebtManagerStorageContract.sol:98-99
  and recomputes); auditedDMAdminImpl 0x8E87938C… established 12/12
  identical (both endpoints × head + two frame pins × accessor AND raw
  EIP-1898 getStorageAt), corroborated by committed source + CREATE3 salt;
  NO epoch boundary (head == frame era — STOP never fired); per-case
  adminImpl subcall in BOTH frames under the wave-8 law; mismatch = frame
  refusal, never a verdict; passing rows carry admin_impl_epoch. Disclosed
  deviation: production reads the CORE accessor (chainReader has no storage
  read — pre-existing implWitnessDeviation); soundness CHAIN-PROVEN by the
  capture's accessor-vs-raw cross-check at both pins × 31 + head, hermetic
  every run. D-013 residual (within-block swap→write→swap-back between the
  two reads) ACCEPTED-AND-DISCLOSED with the full adjudication text carried
  verbatim to round 12. (M2) tokB harm INSTANTIATED — exact contribution
  arithmetic via production helpers, three stages asserted, verdict stays
  conservative. (M3) four prose sites synced incl. the EMITTED artifact
  text; digest preimage checked FIRST (only tx:log_index lines — unmoved).
  Mutants mH + m2/m2-deep killed; 31/31 re-captured. Probe fact recorded:
  both endpoints serve blockHash-form eth_getStorageAt at frame-era depth.
  ROUND 12 (closing) dispatched: t6r12 @ ea25975, base 253a22a — slot-
  derivation genuineness, provenance chain, accessor-shadow analysis via
  the proxy fallback, the D-013 disclosure adjudicated AS a disclosure
  (honest-scenario hunt), M2 arithmetic recompute, M3 grep, no-regression.
  Brief carries the foreground-wedge warning prominently (two jobs wedged
  last round by tool-level foregrounding).
- CODEX ROUND 12 ON TASK 6 (session 019fb52c-0eb3-7ec2-a5a2-82e7a394744e,
  ~3min active, t6r12 @ ea25975, base 253a22a; reviewer discovered and fixed
  the gitignored-cash-v3-absent-from-worktree gap by copying src/+scripts/
  in — add to future briefs): needs-attention — 2H/1M. Two-frame wiring,
  wave-8 decoding, M2 arithmetic, fixture preservation, digest all HELD.
  (H1b) the audited ADDRESS is never bound to audited BYTECODE — CREATE3
  addresses derive from factory+salt not creation code, so honest version
  skew (v1 deployed, source checkout advances to v2, same salt) passes
  every slot/accessor check while decoding v1 events under v2 semantics.
  (H2b) THE D-013 ADJUDICATION REFUTED with a concrete honest scenario: an
  atomic install-migrate-restore governance bundle (one-off migration
  admin, invoke, restore, all in one bundle to remove the temporary
  entrypoint) is least-privilege hygiene, not evasion — both endpoint slots
  equal the audited address while the migration write falls between the
  reads; "if trace coverage cannot be established, do not classify the
  two-pin residual as adversary-only." Integrator ACCEPTS the refutation —
  the prior adjudication was wrong; the reviewer's honest scenario is real.
  (M3b) the NORMATIVE ruling file still declares "provably-sufficient
  universe" — conflicting durable authority; superseding addendum owed.
  CHAIN-TRUTH CONSULTED (standing instance) on the two remedy forks:
  fork 1 bytecode binding = compile-and-compare (heavy; no committed
  artifacts; immutable normalization its own defect surface) vs CODE-HASH
  CONSTANCY PIN (eth_getCode at head+all pins, one audited hash; decode
  semantics anchored by the captured-fixture record, not a compile bridge —
  disclosure-explicit); fork 2 migration detection for the 31 frozen
  blocks = one-time trace evidence (endpoint support unknown) vs
  CALLDATA-SCAN refuse-on-sight (setAdminImpl selector bytes as substring;
  honest governance doesn't obfuscate — byte-substring completeness across
  the ether.fi Safe/timelock stack is exactly the chain-reality question)
  vs probe-then-fallback. Wave cuts on the ruling.
- **CHAIN-TRUTH R12 RULING ARCHIVED** (ADDENDUM 2 in the ruling file,
  4cec808). FORK 1 = (B) CODE-HASH CONSTANCY, three surfaces (proxy + ERC1967
  core impl + admin impl — "pinning only the admin closes half the finding";
  Borrowed/Repaid/Liquidated/IIU semantics live in the CORE); compile-and-
  compare REJECTED as recomputation-where-the-model-is-incomplete (no
  committed source to compile — recon/cash-v3 is a gitignored working copy;
  progressive loosening until green = calibrating the instrument against its
  target); certification limits stated verbatim (bytecode constancy +
  EIP-6780 interior-of-block immutability + fixture anchoring; NO compile
  bridge claimed — source correspondence is a trust posture, not a proof).
  FORK 2 = LAW 0 regardless (foreign topic0s from the custody address +
  ERC1967 upgrade events refuse on sight — closes the CORE-upgrade path
  inside existing custody since upgradeToAndCall is NOT silent) + Step A
  trace probe (if served: frame-level selector law, D-013 residual RETIRED)
  else Step B calldata scan (substring argument ruled TRUE for the whole
  standard wrapping stack but FALSE for pre-deployed payload contracts —
  a named HONEST governance pattern; mandatory admin_continuity disclosure
  key + the D-013 classification WITHDRAWN + a fixture exercising the
  scan's limit). M3b superseding addendum applied — sufficiency claims in
  the ruling file are now conditional with their checking laws named.
  Blocking-if-omitted named: the core-impl surface and the D-013
  reclassification. R12 FIX WAVE dispatched implementing the ruling as
  spec (probes first w/ STOP points; mutation floor mA-mD incl. the
  core-impl-dropped and disclosure-dropped mutants).
- **R12 FIX LANDED — b845c72** (81 files +3,496/−94: code_epoch/admin_trace/
  dm_surface NEW, 31 continuity fixtures re-captured, 30 gzipped trace
  fixtures, 3 committed code-byte copies, probe + pin records; both-ways
  exact; integrator independently re-ran — green; wave ran ~56min incl. two
  park-resume cycles on its own background captures). FORK 1: three-surface
  code-hash constancy — blockHash-form eth_getCode probed (12 identical
  reads/surface, both endpoints), audited constants proxy e428fca7… /
  ERC1967-resolved core impl df7eab5a… (0x03923479…4a19, 18,156B) / admin
  impl 58d08134… dual-provider established and recorded; ERC1967 slot
  derivation pinned; refusal classes decode-authority-{unread,epoch,head-
  epoch} (head = preflightExit posture); hermetic re-proof from committed
  byte copies + production-path capture replay; certification-limits text
  VERBATIM as a pinned constant. FORK 2: Law 0 both arms (ERC1967 upgrade
  events refuse BEFORE the switch w/ precedence over membership; foreign
  topic0s refuse in default; 21-set welded both directions; in-surface
  non-replay pinned unchanged). **STEP A LANDED — the D-013 residual is
  RETIRED**: endpoint[0] 403s debug_ but endpoint[1] serves through the
  ordered failover; strict presence-gated callTracer decode; frame-level
  selector law (any depth, index-bound, case-tx over-refused, ABI-derived
  setAdminImpl/upgradeTo/upgradeToAndCall w/ OZ-v5 absence asserted);
  untraceable case → admin-continuity-unread, never degrades. Every
  adversary-only claim replaced with quoted-and-refuted + retirement
  (NotContains-pinned). Evidence: admin_impl_epoch revised + siblings
  decode_authority + admin_continuity. 31/31: continuity proven, scans
  CLEAN, six hashes == constants, head STOPs passed — no real epoch
  anywhere in the frame. Mutants mA/mA2/mB/mB2/mC killed (mC re-cut
  behavioural); mD correctly N/A (Step B not taken). 285 top-level/0/9
  opt-in (every skip run opted-in during the wave). ROUND 13 (closing)
  dispatched: t6r13 @ b845c72, base 78cda4d — ruling conformance law-by-
  law, trace-evidence honesty (gunzip + re-scan verification, single-
  serving-endpoint question), slot-derivation + byte-copy re-proof checks,
  mC re-cut plausibility, full prior-law regression sweep.
- CODEX ROUND 13 ON TASK 6 (session 019fb57e-305e-7421-a8a4-70a52a6dae1c,
  ~18min, t6r13 @ b845c72, base 78cda4d): needs-attention — 1H, the LAST
  known defect: the trace decoder FAILS OPEN — decodeTraceEnvelope accepts
  {} as a frame, frameTargetsAdminWrite treats missing/malformed `to` as
  non-targeting, common.FromHex silently discards hex errors → a degraded
  RPC response with an incomplete frame tree scans CLEAN instead of
  refusing (the exact false pass Step A exists to prevent). Everything
  else CONFORMED: Addendum-2 code-hash + Law-0 arms, genuine nested frame
  trees (reviewer gunzipped: 30 files/31 cases, max depth 20), hermetic
  code-byte proof load-bearing, ERC1967 derivation + all three byte
  lengths/keccaks independently matched, endpoint-order parity between
  production and capture verified, mutants plausible, mD correctly N/A,
  NO prior-law regressions. Reviewer also asked for DURABLE mutation
  evidence (transcripts committed, not report-only) — adopted as a new
  convention. TRACE-STRICTNESS WAVE dispatched: recursive frame validation
  through the case index (recognized type set from the callTracer
  definition, type-appropriate strict `to`, strict 0x hex input — decode
  error = refusal never skip), {} / malformed-to / invalid-hex regressions,
  real-fixture compatibility guard (STOP if a real capture fails strict —
  capture-quality fact, not a test to weaken), mC re-cut + new mE under
  durable transcripts (testdata/mutation-transcripts convention). D-013
  retirement stands only after this lands — the reviewer is right that a
  fail-open scanner cannot retire anything.
- **TRACE-STRICTNESS FIX LANDED — cab5b0c** (4 files +483/−36; both-ways
  exact; integrator independently re-ran — green). Strict recursive frame
  validation in the judging DFS itself, over every entry ≤ the case index,
  BEFORE the anchor (a {} case tree refuses unread, not chain-impossible).
  Type set enumerated from the go.sum-pinned geth v1.13.0 tracer with
  file:line cites; `to` law type-shaped from the tracer's own nil-ing
  behavior; input via hexutil.Decode (strict) — common.FromHex GONE from
  judgment paths. SkipClass split: admin-continuity-unread for degraded
  evidence, admin-continuity only for judged EPOCH findings (disclosed
  reclass of anchor refusals). ALL 31 real captures scan clean under the
  strict law unmodified — no capture-quality STOP. Red 13 subtests captured
  the false pass verbatim; green 533/0/9. DURABLE TRANSCRIPT CONVENTION
  BEGINS: testdata/mutation-transcripts/r13.md — mC re-cut (isolates the
  evidence check) + mE (exactly the round-13 reversal: killed by 12
  subtests while the pre-round-13 suite stays green under it — the mutant
  proves the tests are precisely its detector). ROUND 14 (closing)
  dispatched: t6r14 @ cab5b0c, base 086bf7f — tracer-shape verification
  against the cites, scan-range law, transcript self-consistency, the
  SkipClass reclass adjudication, cheap 4-file regression sweep.
- CODEX ROUND 14 ON TASK 6 (session 019fb5b2-ed39-76a0-a0b7-91683e24a47c,
  ~13min, t6r14 @ cab5b0c, base 086bf7f): needs-attention — 1H, ultra-
  narrow: the create-family `to` exemption is a hair too wide — geth nils
  `to` ONLY on failed creates (processOutput error path, which ALSO sets
  the frame's error field); the strict law didn't presence-track `error`,
  so a degraded response dropping to+error+children from a successful
  creation scans clean (and the new test blessed a shape geth cannot emit:
  to-less CREATE with no error). Type set, scan range, SkipClass split,
  fixture compatibility, mutation hashes ALL checked out. CREATE-ERROR FIX
  WAVE dispatched (one conditional + fixtures): presence-track error;
  to-less CREATE/CREATE2 valid ONLY with non-empty tracer error (geth
  call.go:70-79 cite verified against the module cache before citing);
  blessing fixture replaced with a genuine failed-create shape; no-error
  variant = refusal regression; successful-create (to present) stays
  clean; STOP if any real capture carries a to-less no-error create (would
  falsify the geth-shape claim); mE re-cut with new hash + mF (exemption
  re-widened) in the durable transcript convention. Reviewer notification
  plumbing hiccuped (final report reached the coordinator only on
  re-delivery; three stale sleep echoes after) — content unaffected.
- **CREATE-ERROR FIX LANDED — c644dc9** (3 files +275/−9; both-ways exact;
  integrator independently re-ran — green). Geth shape verified AT THE
  PINNED MODULE SOURCE before citing (processOutput nils To only on the
  error path which also sets f.Error; omitempty makes the wire spelling
  absent-or-non-empty; To unconditional at capture; every frame passes
  processOutput once) — the to-less-no-error create is chain-impossible
  for this tracer. One conditional: to==nil valid iff create-family AND
  non-empty error; the chain-impossible blessed fixture REPLACED with a
  genuine failed-create; regression (d) both legs (no error / empty-string
  error); successful-create stays clean. Durable r14.md: mE re-cut (new
  hash, r13's noted superseded, 14-subtest kill), mF re-widened (killed by
  exactly the two (d) legs and NOTHING else — sole-load-bearing-killer
  proof). Real captures independently swept: 3 create frames total, all
  with to present — no STOP. 31/31 unmodified; suite green. ROUND 15
  (closing) dispatched: t6r15 @ c644dc9, base 705e0d9 — verify the geth
  cites at the module cache, the exactly-the-tracer's-behavior question
  (can a failed create retain to?), r14.md self-consistency, 3-file sweep;
  the brief notes fifteen rounds of accumulated scrutiny and instructs
  M/L findings be judged against D-013's disclosure mechanism.
- **TASK 6 CLOSED — SHIP. THE P3 REVIEW PROGRAM IS COMPLETE: 4 OF 4**
  (round 15, session 019fb5d3-6577-7de2-867c-fdf0d0c67a4a, ~7min, t6r15 @
  c644dc9, base 705e0d9): "approve — SHIP. No material residual found. The
  narrowed absent-to exemption matches pinned geth behavior; an impossible
  failed-create with to present follows normal strict validation and is
  not falsely refused. Production-path fixtures, mutation hashes/kill
  lists, 30-envelope capture sweep, digest, and registry continuity all
  check out." Reviewer independently re-verified the geth shape claim and
  re-swept the 30 envelopes (3 create frames, all successful with to).
  Static-audit caveat (sandbox blocked go) discharged as always: the
  integrator executed the full suite before c644dc9. FIFTEEN ROUNDS:
  r1 contact/censuses → r2 composition seams → r3 ABI topic0s → r4
  causation (Proven=transition) → r5 production composition → r6
  parent/boundary split + eventless collateral → ruling → r7 interim
  posture → r8 decode-layer (pre-L2 SHIP) → L2 wave → r9 transient tokens
  (+chain-truth convergence) → r10 lifecycle round-trip → r11 admin
  provenance → R12 ruling (three-surface epoch, trace law, D-013
  withdrawal) → r13 fail-open scanner → r14 create-error arm → r15 SHIP.
  Two NORMATIVE chain-truth rulings + two addenda, 31 hermetic continuity
  captures, 30 trace envelopes, 3 code-byte pins, durable mutation
  transcripts. SCOREBOARD: Task 7 ✓ / flag-custody ✓ / Task 8 ✓ /
  Task 6 ✓. NEXT: the PRE-AUTHORIZED maintenance window executes NOW.
- **MAINTENANCE WINDOW — STEPS 1-5 EXECUTED** (2026-07-30 ~18:54-19:03,
  under the 2026-07-29 pre-authorization). (1) solvent-indexer.exe pid
  32100 stopped cleanly. (2) new binary built from the fully-shipped tree
  (21,767,680 bytes) — build-next-then-swap, prior binary kept as
  solvent-indexer-prev.exe (the 7/29 build). (3) relaunch: two failed
  attempts first (hidden-powershell lacked .env → daemon refused
  SOLVENT_DATABASE_URL-not-set, honest fail-closed; PS 5.1 *>> also wrote
  UTF-16 junk into the operator log — left in place, logs are history;
  cmd-with-bare-name didn't resolve) — landed via batch file + env-loaded
  parent, pid 68984, cmd append = raw bytes. (4) migrations 00013+00014
  applied on startup, goose at 14; healthz/readyz live (status starting →
  readiness after one full round; step discards = the known endpoint-
  pinning retries). (5) RewindDerived(aave_v3_etherfi, chain 1,
  20,625,518) committed via a transient in-module tool (cmd/rewind-t6-
  maint, deleted after) — zero-RPC re-derive running: cursor 20,645,518
  → 20,695,518 within minutes, covered_from_block = 20,625,519 (the
  audited genesis), decoder_revision 2, coverage binding stamped.
  Flag rows accumulate as the walk reaches the weETH era. Background
  monitor armed (60s cadence) until the walk catches the raw head
  (~25.65M); then step 6 (verify 173 flag rows + stamp + binding) and
  step 7 (make reconcile acceptance).
- **OWNER DECISION (2026-07-30 19:11, ratified in the owner's own words):
  P5 BEFORE P4.** "i am much more interested in getting phase 5 done than
  4. can we do the ui first" — approved; and on the watch-page coupling
  the owner selected **descope watch from MVP**: the P5 MVP ships book +
  inspector + Observatory against the shipped P3 API; the watch page
  arrives WITH P4 later, designed against its real backend (zero throwaway
  work). P4 (alerts) defers until after launch. Formal decision file
  (D-014) + ROADMAP re-sequencing belong to the P3-exit/P5-entry paperwork
  (roadmap/decisions is outside the current claim scope; the P5 work
  object needs a rescope anyway). P5 planning enters the standard cycle
  (brainstorm → spec → plan) with docs/specs/2026-07-29-p5-ui-concept.html
  + IDEA-002 as the committed design reference ("that UI looks really
  beautiful. i want the real UI to look very similar" — 2026-07-29).
- **P5 OPENED IN PARALLEL WITH THE P3 CLOSE** (2026-07-30 20:14-20:28, all owner-
  ratified in-session). Spec e3ea19f (docs/specs/2026-07-30-solvent-phase5-web-
  design.md — verifiable-risk-control positioning, six surfaces, contract
  corrections normative, Codex product-consult adopted w/ the Feed amendment
  both consultants converged on); plan d247b93 (docs/plans/2026-07-30-solvent-
  phase5-web.md — parallel DAG, contract-first, endpoint shapes pinned).
  SCALE CORRECTION recorded: Cash = 9,744 accounts (9,738 open debtors) — the
  earlier "70 positions" conflated the mockup's illustrative data + Aave-only
  censuses; live risk tables were empty until tonight's migrations. Owner
  approvals: P5-before-P4; watch→FEED (durable chain actions + LIVE-only
  posture; alerts P4); public live-data deploy; small VPS + purchased domain;
  approach A; header-time custody proper; feeds.json budgets fixed BEFORE the
  acceptance (09d496e — "a failing run to re-derive known numbers is
  ceremony"); W2 scope expanded +web/** +deploy/** under CONTROL_PLANE_OWNER_
  REVIEWED=1 citing the recorded approval (51f9a84; rescope 0ff0b67 gen-12;
  full W3 handoff still owed at E1 post-acceptance). DISPATCHED IN PARALLEL
  20:27: C1 contract wave (openapi additions + client regen), B1 store
  readers (migration 00017 reserved), B2 daemon additions (00015/00016 +
  ingest header capture + rollup + backfill-blocktimes cmd), W0 web scaffold
  (tokens from the canon, truth primitives, CI web job). solvent-design
  persona created (~/.claude/agents/solvent-design.md — canon + honest-
  rendering law + anti-canon). Re-derive at ~24.2M concurrently; acceptance
  fires on catch-up; E1 paperwork follows it.
- **RE-DERIVE COMPLETE + STEP 6 VERIFIED** (21:02): walk caught the head
  (25,650,314; ~2h05m for ~5.02M blocks, zero RPC). Flag ledger 98 enabled
  + 75 disabled = **EXACTLY 173 — the predicted count to the row**;
  covered_from_block 20,625,519 (audited genesis); revision 2; binding
  stamped; daemon readyz ready:true healthy — full self-heal post-rewind.
  STEP 7: first attempt honestly REFUSED by the schema gate (go run
  compiled the working tree which carries B1/B2's uncommitted P5 migrations
  00015-00017 → binary expects 17, live DB correctly at 14) — the
  acceptance must come from the COMMITTED P3 tree; relaunched from a pinned
  worktree (C:/wtclose/p3accept @ c966f84, .env copied, isolated scratch
  solvent_test_accept) — running.
- **P5 MID-FLIGHT CORRECTION PASS** (21:05, Codex plan review via the
  owner — adopted in full as plan AMENDMENT 1, 3c0f58e): (1) serial-writer
  model now STATED (waves never commit; one integrator claim); (2)
  cross-chain feed ordering was WRONG in C1 (block heights incomparable —
  OP would bury ETH) → B1 corrected mid-flight (single-engine by block;
  cross-engine by block_time w/ chain-aware tiebreak, timeless rows after,
  disclosed; unit-tagged amounts incl. 'opaque'); (3) block_headers reorg
  law → B2 corrected mid-flight (deletion joins the EXISTING rewind tx;
  event-bearing-reorg test; bounded missing-header retry); (4) observatory
  points from COMPLETE risk batches only (never raw derived state; absent
  bucket over fabricated bucket) → B2 corrected; (5) C2 contract-corrections
  task queued (PositionSummary, exposures + bounded risk-map, evidence
  proof/live split + status, GET /v1/batches/{id} permalinks, prices chain
  identity, v4-proposal registry artifact); (6) **the plan's
  nothing-is-money-math line was WRONG** — run-book upgraded to the FULL
  adversarial train, risk_scenarios materialization considered; (7) blast
  radius deferred unless honestly backed; (8) W7 gains the UI state-matrix
  acceptance test. Two consultants converged again; both in-flight waves
  acked the corrections in their next tool rounds.
- **W0 DESIGN PASS: SHIP, zero MUST-FIX** (solvent-design's first ruling,
  ~10min; independently re-ran the 16/16 suite AND mechanically diffed
  every token block against the canon — byte-identical confirmed). Two
  BLESSINGS: the vector-only Ribbon ("makes the fake state unrepresentable
  at the type level... blessed as the canonical replacement for the mock's
  LIVE chip") and the chart honesty floors (null-gap sparkline; the 1.5px
  residual floor so nonzero bad debt cannot vanish). WARN BAND RULED: 1.1,
  five conditions (UI-only forever; strict-below boundary; disclosure
  wherever warn renders; per-row only, never aggregates; changes route back
  through the desk). SHOULD-FIX assigned to waves: Lab promoted to primary
  tabs (W1), warn gets an outlined-square form cue (W1), drawer body-scroll
  lock (W2). TASTE noted (shell width, marks commas — keep w/ comment,
  dead transition, unused .frame). SURFACE WAVES W1 (Book) / W2 (Inspector)
  / W3 (Scenario Lab) DISPATCHED in parallel on disjoint routes (21:12) —
  design findings folded into briefs; W1's table view-models the coming
  PositionSummary; W3's book-mode renders the honest not-yet-served state
  until the run-book train closes. SIX agents concurrent (B1, B2, W1, W2,
  W3, the acceptance run) — peak session width.
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
- **COMPACT CHECKPOINT (21:36)**: B2 REPORTED COMPLETE, NOT YET LANDED — its
  tree coexists with B1's uncommitted work and the schema-version pin bump
  (17) lives in B1's files, so **B1+B2 land together** (two sequential
  commits from the jointly-verified tree) when B1 reports. B2 essentials:
  corrections applied+proven (rewind deletes headers in the SAME tx at
  store.go:377; bounded retry sweep every 8 rounds; rollup batch-sourced w/
  materialization_key + watermark vector, m4 kills the derived-state
  mutant); 4/4 mutants killed; suites ok (store 206s / indexer / backfill);
  post-ship op: SOLVENT_BACKFILL_BLOCKTIMES=1 go run ./cmd/backfill-blocktimes
  -rate 8 (~346k headers ≈12h, resumable). IN FLIGHT: B1 (store readers,
  corrected), W1 Book, W2 Inspector, W3 Lab (all mid-build), acceptance
  RETRY (attempt 1 = honest exit 3, transient OP-RPC timeout; artifacts +
  comparison sha256 0f9b2103… already written) in C:/wtclose/p3accept.
  Persona solvent-design UPGRADED (developed composite: Tufte/Bostock/FT-
  Economist/Bloomberg/Berkeley/Stripe/Linear/TradingView + chart laws +
  four-state chart review; the W0 ruling stands). Wave outputs persist at
  AppData\Local\Temp\claude\...\tasks\<id>.output: B1=a975d7387845b91cc
  B2=a49a6b9777b7d298f W1=a16444b8ae83010a1 W2=a6d276addc3b1c2b4
  W3=a28b41c4f248e207e accept=bt2ox1u0o. Pipeline on resume: land B1+B2 →
  B3 handlers wave → land W1/W2/W3 (+ design pass on their charts under
  the upgraded charter) → acceptance result → E1 paperwork (W2 receipt,
  W3-object, D-014, ROADMAP, rescope) → C2 contract wave → W4/W5/W6.
- **B1+B2 LANDED (21:52)**: B1 reported complete (8 readers; batch-pinned
  cursor w/ typed refusals; two-mode events ordering law — engine-scoped by
  height, cross-engine by block_time NULLS LAST w/ since_block REJECTED;
  unit-tagged deltas from a closed set; go/ast-welded TOTAL display
  vocabulary; validity-split price downsampling exposing NO aggregates over
  invalid runs; 4/4 mutants killed incl. one that first SURVIVED and forced
  a test hardening — recorded in p5-b1.md). Integrator verification on the
  joint tree: build+vet clean, store 191s / indexer / backfill all green
  (-p 1, solvent_test). Landed as the designed pair: `18339de` (B2 custody
  substrate, 00015/00016, rewind-tx header deletion, backfill tool) then
  `dc5c844` (B1 readers, 00017, schema welds 14→17 — pair green at head).
  Pushed. B3 handlers wave DISPATCHED against the C1 contract + landed
  readers.
- **ACCEPTANCE: three distinct transient causes, OP rotation exhausted
  (21:52)**: retry 2 = exit 3, Alchemy 429 CU/s on callAtHash mid-run
  (comparison sha256 53477969… written — the drift comparison itself never
  disagreed); retry 3 = exit 2 at PREFLIGHT, chain-id verify hit endpoint
  1's free-plan cap (verify-all-endpoints is the fork-split defense, so one
  exhausted provider refuses the whole run — correct behavior). Retry 4
  queued after a ~20-min breather with verdict-free pacing flags
  (-rps 1.0 -timeout 45m -rpc-attempts 8; the round-11 flag-surface closure
  classifies all three as taint-free). If still capped → owner decision on
  OP RPC capacity (paid tier or second key).
- **W2+W1 REPORTED GREEN (21:55)**: W2 Inspector (56/56 isolated: three-
  valued found rendering w/ "no position" NOWHERE on the unknowable page;
  engine-correct formula blocks; descriptor-fed EvidenceDrawer marked
  operational-not-proven; drawer scroll-lock ruling closed; strict address
  law both entries). W1 Book (77/77: rulings 1–3 verbatim — Lab in primary
  tabs, warn outlined-square, derived warn-band disclosure at table+legend
  level; PositionSummary-shaped rows ready for C2; materialization key
  honestly em-dashed as "served by /v1/evidence"; 409 restart visible and
  atomic). Both hold for W3 + one serial full-suite verification before
  landing. W2 found a LATENT W0 BUG driving a real browser: SolventClient
  captured globalThis.fetch UNBOUND — browsers enforce WebIDL this-coercion
  ("Illegal invocation"), undici tolerates it, so 292 Node tests never saw
  it. Integrator fixed at the capture (`2ab0f22`, global.bind(globalThis),
  default path only), regression test simulates the WebIDL rule and was
  proven RED against the unbound capture; 293/293. Wave workarounds
  (book-client/inspector-client/labClient) get deleted at W-landing time.
- **W1/W2/W3 LANDED; W4/W5/W6 DISPATCHED (22:10)**: W3 reported green (76
  passed: flagship depeg contrast keyed off DATA not scenario-id, untrimmed
  18-decimal bit-identity visible, bigint-exact rationals never silently
  rounded, sealed six-way run-book outcome union w/ honest-404 panel proven
  to need zero UI change when the endpoint ships). Integrator collapsed all
  three wave fetch-workaround seams onto the fixed shared client
  (getSolventClient; seams deleted UNLANDED) and ran the serial standard-
  config gate on the joint tree: typecheck/lint/build 0, e2e 76 passed /
  1 env-gated skip / 0 failed. Landed as three named commits + pushed (HEAD
  b3c399b); tree clean. Design pass on W1/W2 charts IN FLIGHT under the
  upgraded charter (W3's charts join in a follow-up message to the same
  director instance). W4 Observatory / W5 Feed / W6 Proof Center+Developers
  dispatched CONCURRENTLY on the clean base with per-wave isolated
  playwright configs (ports 3411/3511/3611 — the shared-.next churn lesson
  encoded), disjoint ownership partitions, and the load-bearing laws inline:
  W4 = engine separation absolute, absent-bucket-over-fabricated, V4 gates
  NOTHING; W5 = AMENDMENT-1 cross-chain ordering (untimed tail disclosed,
  since_block engine-scoped only), unit-tags never fake USD; W6 = the
  proof_subject/live_subject split renders as two subjects, sanctioned
  EvidenceDrawer lift to components/, Developers at Stripe-docs polish.
  Six concurrent: B3 handlers, design pass, W4, W5, W6, acceptance retry 4
  (delayed launch ~22:17 w/ verdict-free pacing).
- **DESIGN PASS: NOT-SHIP → 6 MUST-FIX APPLIED → SHIP (22:13)**: the
  upgraded-charter chart review ruled the W1+W2 chart set NOT-SHIP on six
  edge defects where doctrine meets pixels (the bones — geometry/display
  split, null-gap law, refusal-first states — passed): (1) the 1.5px
  waterfall floor FABRICATED ink for true zeros incl. "0.000000" slipping a
  string compare; (2) waterfall margins clipped exact money strings (SVG
  overflow hides the loss); (3) scatter warn marks were filled while their
  own legend showed outlined — a legend lying about itself; (4) the risk
  map's auto-fit y-domain could push the liquidation floor OFF the chart;
  (5) a single computed point between gaps rendered zero ink (dead M-only
  path); (6) the DM history card borrowed Aave's 1.0 "own boundary" caption
  onto a disclosure ratio — the shared-comparator implication the engine-
  separation law forbids. Integrator applied all six verbatim in the main
  tree (W4 shared-chart-file freeze messaged first): zero-aware barW +
  /[1-9]/ exact-zero gate; margins 110/155 + "×1.00 unshocked" grammar +
  counts to a new dim sub gutter line; outlined .dotWarn (transparent not
  none — hover survives); Scatter yReference forced-in-domain w/
  "0 — liquidatable"; isolated-point circles; engine-conditional reference
  legends (then hardened per-engine-keyed w/ no-claim fallback — the
  director's follow-up nit). Director RE-VERIFIED each closure incl. the
  wire id and ruled SHIP. Typecheck tree-wide + scoped lint clean; the fix
  commit rides the joint serial gate with the W4/W5/W6 landings (no .next
  churn on in-flight waves). FORWARD REGISTER → W7 (first priority): ruling
  11 CONFIRMED-warranted — /v1/address history serves points only for
  batches where the account has rows, so a closed-then-reopened position's
  absence is neither point nor withheld and the sparkline would draw a line
  across it; gap-insertion in history-series.ts. Then SHOULD-FIX 7-10
  (exact hover values on the risk map, hover on computed sparkline points,
  map states its own as-of, histogram eligible-bucket form cue) + TASTE
  12-14 (round-decade ticks, connector semantics, inline-style → classes).
- **W4/W5/W6 LANDED — ALL SIX SURFACES ON MAIN (22:40)**: joint serial gate
  over the full tree (design fixes + three new surfaces + nav decision):
  typecheck/lint/build 0, e2e 158 passed / 1 env-gated skip / 0 failed.
  Four-commit train pushed (HEAD 20c094c): design-pass MUST-FIX set → W4
  Observatory (remount-on-switch engine separation; captured/withheld/
  absent bucket axis w/ absence only BETWEEN wire rows; degraded keys on
  contract code not HTTP status) → W5 Feed (two-mode ordering w/ disclosed
  UNTIMED TAIL + ORDERING DRIFT guard; unit-tag honesty w/ $-sweep test;
  cursors never cross modes; posture never history) → W6 Proof Center +
  Developers (proof/live split as a DERIVATION LAW until C2 gives wire
  fields — accepted only on the receipt's own strict conjunction;
  clipboard-verified materialization-key CopyChip; Developers generated
  verbatim from the yaml w/ a re-extracting fidelity spec; leak
  sanitization in generator AND at render; EvidenceDrawer lifted to
  components/ w/ 9/9 post-move regression; integrator nav decision:
  /proof in SECONDARY_TABS, two-route shape pending W7 review). W5 found
  REAL CONTRACT DRIFT: committed C1 /v1/events still describes the
  PRE-amendment semantics the landed B1 store corrected — W5 built to the
  corrected law, welded its vocabulary compile-time both ways so C2's
  reconciliation breaks loudly, and refuses to render the wire's outdated
  notes[]. C2 ACCUMULATED BRIEF (dispatch after B3 lands): amount_unit on
  ChainEvent; /v1/events ordering prose + notes[]; display-vocabulary
  reconciliation; LiquidationDetail missing DM fields (DeficitPaired,
  before_debt_usd, interest_index, per-seizure bonus); batch_id/
  materialization_key/epochs on ObservatorySeriesPoint + RateIndex scale
  + range/step param; PositionSummary; GET /v1/batches/{id}; evidence
  proof/live wire split; prices chain identity; v4-proposal registry;
  optional GET /v1/scenarios. W7 REGISTER: design SHOULD-FIX 7-11 (11
  first: history gap-insertion for closed-position absence — confirmed
  against the B1 reader), TASTE 12-14, W1 stampline → /proof link,
  InspectorActivity adopts feedAmount when amount_unit lands, Oracle
  Monitor panel (AMENDMENT-1 item H, named follow-up). STILL IN FLIGHT:
  B3 handlers, acceptance retry 4 (past preflight, 23 min into the 45-min
  budget).
- **ACCEPTANCE RETRY 4: COMPLETED — HONEST FAIL, 283 GATED (overnight,
  diagnosed 08:30)**: the first-ever COMPLETED -p3-gates full-census
  acceptance run (pins eth 25650676 / op 154938071, comparison sha256
  38a57b3e…, artifacts secured to session scratch accept-r4/ before the
  worktree was removed). CORE RECONCILE IS EXACT EVERYWHERE: DM 29/29 +
  aggregate Σ exact, Aave 14/14, goldens exact, dm_param_weld 60/0,
  registry 45/0, freshness 1.000, invariants 0, and the corrected
  feeds.json heartbeat budgets PASSED their gate (with disclosed
  qualifiers). The 283 failures are all in the NEW P3 Task-6 gate set on
  its first full-census contact with live reality: dm_boolean_weld
  getMaxBorrowAmount 233/28,622 (both directions — 100 high/133 low,
  tails −99.8%…+1609%, median ≈0: NOT a uniform price lag; collateral-set/
  composition divergence is the leading hypothesis since debt custody is
  proven exact), aave_hf zero-debt census 24+1 (derived asserts holders
  chain denies), input_frame_law 3/3 (frame-ledger bookkeeping defects in
  the gates themselves: two stale declarations, one undeclared consumed
  source — harness bugs on their face), backtest 6, tokenconfig 16.
  THREE DIAGNOSIS LANES DISPATCHED in parallel: hands-on exemplar
  dissection (3 DM + 2 census exemplars, both sides reproduced from live
  DB SELECTs + callAtHash at the pins, read-only discipline), risk-quant
  frame consult (hypothesis ranking, floor-then-sum divergence suspects,
  the evidence standard for harness-bug vs custody-drift verdicts),
  chain-truth custody ruling (census population law, which surfaces the
  zero-RPC re-derive could have rebuilt differently, gate snapshot-
  isolation discipline). NO fixes until the classification lands.
- **OVERNIGHT MECHANICS**: claim lease expired 07:27 — renewed via
  claim.py through 2026-08-01T15:25Z after removing the finished p3accept
  worktree registration (single-worktree invariant; artifacts copied out
  FIRST); claim commit isolated per the rule; B3 then landed `4ff42a7`
  (integrator verification: build/vet/fmt clean, cmd/api ok 81s -p 1) and
  pushed. B3's cutover ops note recorded: liquidation rows for seized
  assets outside recon/feeds.json refuse loudly — registry coverage must
  precede I3.
- **RISK-QUANT RULING ON ACCEPT-R4 (08:42)**: verdict NUMBERS DO NOT HOLD
  for the acceptance surface — the FAIL is honest and stands; core custody
  welds hold everywhere they were read at their own clock. The decisive
  reframe: every failing gate welds a SAMPLE-CLOCK input against PIN-CLOCK
  chain state. dm_boolean_weld (B1): the collateral vector is the leg's
  ONLY non-pin-anchored input (sweep-sampled snapshot; params 60/0 exact,
  prices pinned calls, no DB price rows) — both-direction card-spend-sized
  deltas with clean LT preimages ($100.00×0.95, $13.00×0.95), and
  dm_gate.go:20-31 records the SAME clock defect found once before;
  rounding refuted by the floor-envelope theorem (smallest delta 7,799
  units vs ≤~40 envelope); AND zero failures on the liquidatable boolean
  itself (46/46) — the served verdicts survived at this pin, the
  intermediate quantity drifted. Sharpest check ordered: pin-vector
  substitution (collateralOf@pin fed to the recompute) + own-sweep-block
  custody read + affirmative gap-event census. Zero-debt census (B2): the
  chain DENIES the collateral leg (totalCollateralBase==0; only-chain 0
  proves no missed borrowers) — mechanisms: value-floor dust/collateral-
  bit-off (harness predicate mismatch, both sides true at pin) vs
  1-scaled-wei burn residue (REAL deriver bug); Σ-weld exactness has ZERO
  power here (aToken transfers change no Σ). input_frame_law (B3): the
  stale aggregator declaration is the phase-change GUARD — must be
  CONSUMED, never deleted; never-seen provenance must be nailed to protect
  the empty-set probe. tokenconfig (B4): committed scenario-model defects
  (11 held-flat assets + 5 composition-law disagreements weETH/liquidBTC/
  eBTC/sETHFI/liquidETH — the stress engine's propagation vs the
  provider's composition graph) — a real risk-surface catch; fix =
  author the matrices. backtest (B5): 5 unpriced historical legs (B6
  singleton margin only 2,053 USD-6 — priority) + 1 third-branch-shape
  case (read the tx). EVIDENCE STANDARDS pinned: harness-bug verdict needs
  same-pin reproduction + own-clock custody exoneration + law citation;
  custody-drift verdict needs own-clock divergence; REFUSED: fresh-pin
  pass alone, any epsilon over the 233 (tolerance-as-carpet), census
  repair by predicate assimilation without a recorded ruling, frame repair
  by deletion. Legit fix shapes for B1: sweep-at-pin acceptance
  choreography (stronger) or split-weld (custody at own clock + freshness
  disclosure). Frame forwarded mid-flight to the dissection wave with the
  exact discriminators.
- **CHAIN-TRUTH RULING ON ACCEPT-R4 (08:55): CUSTODY HOLDS** — converges
  with risk-quant at source level. (1) Zero-debt census 24+1 = GATE-LAW
  DEFECT proven by the run's own data: population shared by construction
  (union cohort, both directions measured), but derived predicate is raw
  scaled-balance (flag-blind, value-blind) while chain's is flag-gated
  price-projected — and NO totalCollateralBase drift row exists for any
  of the 24 (chain said 0, our compute over the SAME derived legs + pinned
  getUserConfiguration said 0): flag-off/dust accounts, zero custody
  drift; skew structurally impossible (pins resolved inside the one
  repeatable-read tx). Fix: split into a scaledBalanceOf@pin balance-
  census weld (closes the flag-off masking residual — a one-arm gate in
  miniature) + marker census under ONE law (the chain's). (2) DM 233 =
  the frame's @P_op declaration is FALSE — snapshot amounts are
  @S(account); the netting channel is un-custodied lens reads by design
  (CashEventEmitter deliberately unwalked); the maintenance rewind was
  Aave-chain-1 only, so the pause merely AGED the DM sweeps — hours-wide
  gap, 233 basket movements, boolean weld intact because all sat far from
  the boundary. Fix: correct the frame + three-state verdict (bit-exact /
  sample-gap-disclosed w/ own-clock discrimination read / snapshot-
  custody-drift-gated) — a verdict class with its own read, NOT a fourth
  tolerance. BLOCKING FIRST READ: CashLens.getUserTotalCollateral at
  blockHash(S) for the worst-tail account 0x5C99e546… — bit-equal ⇒
  custody excluded; unequal ⇒ verdict flips to CUSTODY BREAKS. (3) Frame
  findings ranked: b3 heartbeat = DANGEROUS CONFIRMED for this run (all
  four grades issued with NO proxy-binding read — needPhaseCheck never
  fires on healthy feeds, permanent-red frame violation training
  operators to wave it through; fix = UNCONDITIONAL per-stream binding
  read, do NOT add a conditional-source ledger kind); tokenconfig =
  latent drift-capable (hardcoded dmStableSnapSet restates the model in
  the gate that brags it doesn't; fix = derive from loadScenarioBaseClaims,
  delete the copy); aave never-seen = pure bookkeeping (probe provably
  ran; one-line f.use). (4) Timing law: NO snapshot-isolation gap — the
  T6 gates are structurally stronger than Task 9's fixed shape (single
  repeatable-read tx, pins resolved inside it, gates receive plain
  values). (5) The 16 tokenconfig rows STAND as real product findings:
  scenario matrices stale vs the chain universe (beHYPE, WHYPE, eUSD,
  EURC, weEUR, liquidRESERVE×2, liquidRWA, OP, WBTC, ETH-sentinel
  unclaimed; weETH/liquidBTC/eBTC/sETHFI/liquidETH compositions disagree
  with deployed). Awaiting the dissection wave's own-clock empirics to
  close the loop; fix waves stage after it reports.
- **DISSECTION VERDICT — DIAGNOSIS CLOSED, ALL LANES CONVERGE (08:58)**:
  read-only forensics (SELECT-only session, eth_call at pins/EIP-1898,
  throwaway tools in scratch). DM 233 = classification (d): cross-clock
  weld the gate should have refused. PROOF: own-clock collateralOf at each
  exemplar's sweep block BYTE-IDENTICAL to the persisted snapshot 5/5
  (sweeper custody exact — the blocking read came back bit-equal, custody
  drift EXCLUDED); pin-vector substitution reproduces
  getMaxBorrowAmount@pin BIT-EXACTLY 5/5 (recompute law exonerated
  wholesale); sweep-age regression monotone (0.0009 at <300 blocks →
  0.0415 at ≥2400); the $100.00×0.95 exemplar = plain ERC20 transfer in
  the gap (0 raw_logs — eventless motion, invisible by design); the
  collateral_spot_reads sibling instrument already labels the same motion
  "expected, report-only BY CONSTRUCTION". Boolean leg 0 failures
  anywhere, but exemplar 0018 shows a 130-block-fresh sweep straddling a
  $13 spend — margin luck, not guarantee. Census 24 = classification (c):
  both exemplars chain scaled == derived EXACT (261 dust scaled; and
  4,778,330 + 2e15) with getUserConfiguration=0x0 — one NEVER-enabled
  (USDC no auto-enable on this market), one EXPLICITLY disabled with the
  aave_collateral_disabled event IN CUSTODY at block 22,551,863. The
  derived predicate is flag-blind; the data to fix it is already
  custodied. Secondary: tokenconfig 16 = missing base-composition claims
  (weETH under eth_minus_10, liquidBTC/eBTC under btc_leg_minus_20 etc.);
  backtest = obligation3 degenerate zero-budget loop shape the model
  lacks + 5 fail-closed unpriced parent-frame legs. NOT A SINGLE WRONG DB
  ROW AT ITS OWN AS-OF. FIX PROGRAM DISPATCHED: Wave H (cmd/reconcile
  proof-surface: dm frame truth @S + own-clock weld restructure w/
  three-state verdict, census one-law + scaledBalanceOf weld, b3
  unconditional proxy-binding read, tokenconfig snap-set de-hardcode,
  f.use one-liner, obligation3 third shape, same-pin refutation
  transcript vs the accept-r4 artifacts as the evidence standard) and
  Wave S (internal/risk scenario matrices: base-composition claims for
  the 5, claims for the ~11 unclaimed assets, derived from chain
  tokenConfig w/ judgment calls flagged). Codex adversarial round on
  Wave H before any fresh acceptance (proof surface, D-013 program).
- **FIX PROGRAM LANDED — SEVEN-COMMIT TRAIN (10:25)**: joint gate green
  across the whole tree (build+vet clean; reconcile+snapshotdb+risk+api ok
  -p 1; client 310/310; web 158/0/1-skip). Pushed through a85fe16:
  9b330c7 Wave S (scenario matrices closed over the chain universe;
  base_asset schema extension; census scenario ×1/1 explicit holds; twin
  liquidRESERVE by address; 5/5 mutants) → 4ff71f0 Wave H (the six
  adjudicated proof-surface fixes; SAME-PIN REFUTATION 257/257 — all 233
  DM inputs recovered from the snapshots history table and proven the
  unchanged accept-r4 vectors, own-clock welds 233/233 bit-exact across 72
  sweep blocks w/ the custody-drift arm EMPTY; census 24/24 one-law
  non-members w/ 96/96 scaledBalanceOf welds; 4/4 mutants; committed
  re-runnable refutation test) → f57d855 W2 scope +recon/v4-proposal*
  (owner-ack: AMENDMENT 1 adoption 3c0f58e) → f70817c claim rescope gen-13
  (isolated) → 529642d C2 contract 1.2.0 + client (310 tests, nine
  methods, sealed-field law extended) → 539a268 C2 handlers (+integrator
  scenario-count pin 11→12 reconciliation for the census scenario) →
  a85fe16 C2 web (welds discharged; evidence derivation kept as a loud
  cross-check). Wave H flagged stale-status ghosts (cmd/reconcile main.go/
  pgxdsn.go) — investigated: pgxdsn.go is COMMITTED round-16/19 history,
  main.go clean; no stray actor. CODEX ADVERSARIAL ROUND DISPATCHED on
  12db60e..4ff71f0 (the proof surface; D-013 bar verbatim; attack order:
  can sample-gap absorb real drift, own-clock law fidelity, census flag
  semantics vs Aave, candidate-set bounds, refutation-test soundness,
  binding-read every-path, ob3 predicate narrowness, Wave S validation).
  On SHIP → fresh acceptance run (must pass at its new pin while the
  same-pin refutation stands) → E1 paperwork. Owed arms tracked: unpriced
  historical legs (B6 margin-2053 priority), implWitnessDeviation
  StorageAtHash follow-up, store reader gaps (batch-by-id, anchor_block),
  batch-scoped position pages, book exposures + GET /v1/scenarios,
  migration_genesis feed-visibility product call.
- **CODEX ROUND 1 ON THE PROOF SURFACE: NOT-SHIP, 3 FIX-WORTHY (10:54)**:
  scope held exact at 12db60e..4ff71f0 (reviewer disclosed a dispatch
  deviation: task-mode with explicit range instead of review-mode, because
  the worktree HEAD sat past the range end and review-mode would have
  contaminated the diff with the C2 train — correct call, disclosed per
  the wedge norm). All three findings are the same defect shape: THE
  COMMITTED PROOF IS WEAKER THAN THE DIAGNOSIS THAT JUSTIFIED IT. (1)
  dm_gate own-clock weld proves only the risk-weighted SCALAR at S — two
  wrong rows whose price×LT cancel at S classify sample-gap while their
  pin divergence is excused; the dissection byte-compared the VECTOR, the
  gate must too (collateralOf@blockHash(S) vs the persisted document,
  zero tolerance; sample-gap reachable only on vector match). (2) the
  balance-census weld selects by MEMBERSHIP FLIP — a wrong derived
  balance in a flag-OFF reserve on a borrower (or on a mixed-reserve
  zero-debt account) is never welded anywhere; selection must be per
  (account, reserve): every positive derived balance masked OFF joins the
  scaledBalanceOf weld. (3) the refutation test passes on a NONEMPTY
  SUBSET (missing history accumulated, ≥1 exact suffices, Aave lane
  nonempty-not-24) — the actual run was complete but the committed proof
  is vacuous under truncation; must require artifact identity + exactly
  233+24 unique targets + complete recovery + zero unread. Codex also
  CLEARED the highest-stakes questions: no ComputeDMHealth-vs-contract
  divergence (flooring order, decimals, thresholds, summation), no
  binding-read bypass, ob3 predicate holds. Note (not fix-worthy,
  disclosed): base_asset A→B→A cycles pass validation; harmless today
  (BaseAsset outside ApplyScenario; live sweep gates chained bases).
  WAVE H2 DISPATCHED with the three remedies + strengthened refutation
  re-run + 3 designed mutants (incl. the counterbalancing-wrong-rows
  kill). Round 2 closing review after it lands.
- **CODEX ROUND 2: NOT-SHIP ON ONE FINDING → INTEGRATOR FIX → ROUND 3
  DISPATCHED (11:55)**: round 2 verified every H2 remedy held (vector law
  total and exact, drift verdict unsoftenable downstream, pair universe
  complete, kill tests genuine) EXCEPT one remaining vacuity: the
  refutation's identity bar TRUSTED the artifact's self-reported
  comparison_sha256 string — Codex proved a synthetic 233+24 substitute
  carrying the copied digest parsed successfully. Integrator fixed inline
  (single contained finding, test-file change reusing the canonical law):
  parseAcceptR4ArtifactAgainst recomputes comparisonHash over the supplied
  bytes (a1 recomputed==embedded, a2 embedded==the record); synthetic
  fixtures sealed with their own digest so every bar stays individually
  exercised; the exact round-2 substitute construction and a stale-digest
  row mutation pinned as refusal tests; m4 mutant (bar deleted) KILLED;
  round-trip over the real artifact PROVEN (recomputed == embedded ==
  38a57b3e…); live refutation re-run PASS under the strict law (Part A
  113s 233/233 vector-identical / 0 mismatch / 0 unread; Part B 7s 24/24
  + 96/96). Landed 6f23452, pushed. Codex round 3 closing review in
  flight on f220360..6f23452. Round-2 mechanics disclosed: the reviewer
  worktree removal hit a Windows lock from job-scoped helper processes —
  killed scoped pids, orphan dir removed, registration verified clean
  (the reviewer-brief cleanup clause now covers this path explicitly).
- **CODEX ROUND 3: SHIP, ZERO FINDINGS — PROOF SURFACE CLOSED (12:09)**:
  "No material false-pass or vacuous-green path found: comparisonHash
  covers every pin/P3-row field consumed by the refutation, sealDoc
  preserves bar isolation, comparison_sha256 is outside hash scope, and
  both refusal tests genuinely kill m4." Three rounds, strictly
  converging: 3 findings → 1 → 0. The acceptance proof surface now
  carries: the vector-gated three-state DM law, the per-(account,reserve)
  balance-census weld, the recomputed-digest refutation bars, all
  mutation-killed, all landed through 6f23452.
- **POST-SHIP OP EXECUTED + FRESH ACCEPTANCE LAUNCHED (12:14)**: the
  fresh acceptance's schema gate refused honestly (live DB at 14, HEAD
  expects exactly 17 — reconcile never migrates), so the RECORDED
  post-ship op ran under the pre-authorized window: HEAD indexer built,
  daemon swapped (pid 68984 → 123768, prev binaries kept as
  solvent-indexer-prev/-prev2), migrations applied at startup — OK 00015
  (18ms) / 00016 (16ms) / 00017 (400ms), goose 17 — block-header custody
  now live. Startup log shows the familiar honest RPC-pressure walking
  (pinned-read discards + backoff, self-healing). Fresh acceptance
  relaunched from the pinned worktree C:/wtclose/p3accept2 @ 8591d0d
  (verdict-free pacing). W7 wave (design register: ruling 11 first,
  SHOULD-FIX 7-10, TASTE 12-14, stampline→/proof link + the state-matrix
  test) dispatched in parallel. On acceptance PASS → E1 paperwork.
- **W7 LANDED (12:46)**: the design register discharged + the 43-cell
  state matrix (1bd5b51, serial gate 207/0/1-skip — suite grew from 158).
  Ruling 11 landed as the HONEST-BOUNDARY version: the wire does not
  enumerate the covered batch-id set, so no-row gaps insert only for
  response-witnessed ids (points ∪ withheld ∪ vantage batch), the legend
  discloses the boundary, and the newest edge can always break (the
  stale-value-carried-forward lie dies) — CONTRACT GAP recorded for the
  API register: AddressHistoryResponse should carry the covered batch-id
  LIST (non-contiguous possible). SHOULD-FIX 7-10 + TASTE 12-14 all
  landed verbatim (exact-debt hover, finite-point hit rects, map states
  its own as-of, eligible-bucket form cue, decade ticks, FT connector
  doctrine, shared .refLine/.refLabel classes, stampline→/proof link).
  THE MATRIX EARNED ITS KEEP IMMEDIATELY: two real responsive defects
  caught and fixed (inspector .split unusable at 390px — 260px document
  overflow; MarksStamp blanket nowrap). Four judgment items sent to the
  standing design director (empty-eligible-bucket square semantics,
  decade-tick clearance, connector-through-residual reading, Marks
  wrapping) + the ObservatorySeriesChart TASTE-14 scope question. Owed:
  W6b Oracle Monitor named follow-up. Acceptance run still in flight
  (~32 min into the 45-min budget).
- **FRESH ACCEPTANCE: 283 → 16, ABORTED ON A LOCAL BLIP; ONE ADJUDICATION
  OPEN (13:00)**: the first run over the repaired gate set (pins eth
  25654850 / op 154963224, comparison 4fb7b0ac…) ran the full evidence
  pass and ABORTED only at the final rewind re-check — a LOCALHOST DNS
  lookup timeout (exit 3, honest refusal; the artifact structurally
  cannot read as a pass). THE FIXES VALIDATE LIVE: census one-law 0/1147
  failed (was 25), heartbeat unconditional binding 0/12 (was frame-red),
  tokenconfig 0/76 (Wave S's matrices consumed; was 16), dm_param 60/0,
  maxBorrow three-state law over 29,278 rows with ZERO custody-drift and
  ZERO law-divergence. The 16 residual: 13 backtest weld-unreads all
  transport-other context-deadline (the same end-of-run network hiccup —
  retry-clearing), 1 never-swept NEW borrower (honestly gated; the
  served surface refuses it too; self-heals on sweep), and 2 liquidatable
  boolean FALSE-POSITIVES (margins $15.08/$70.84) — THE PREDICTED CASE:
  the boolean welds at pin over sweep-clock collateral, so boundary-
  crossing motion in the gap gates stochastically (~0-3 per 9.5k per
  draw). The gate's own note misdiagnoses it as a strict-inequality bug;
  the maxBorrow leg proved honest motion (sample-gap w/ vector match) for
  those accounts. ADJUDICATION SENT to both standing consultants (they
  carry full context): (a) boolean gains own-clock discrimination w/
  pin-difference as a disclosed boundary-crossing-motion class (the
  product serves sweep marks with every verdict), (b) keep gating +
  rerun for a quiet draw (institutionalized dice, their own standard
  condemns it), (c) asymmetric gating of false NEGATIVES only. No gate
  change, no retry until they rule. W7 landed + the director's SHIP with
  z-order/clamp fixes (8bfc394) precede this entry.
- **CHAIN-TRUTH RULING: BOOLEAN LEG → OPTION (a) AMENDED (13:06)**: the
  doctrine line is proven-sample-motion vs unexplained-divergence, never
  quantity-vs-boolean — disclosure covers a boolean IF (1) proven faithful
  at its own clock, (2) motion proven not presumed, (3) disclosed at the
  boolean's OWN granularity (direction + margin; a freshness footnote is
  NOT enough — the counter-argument's legitimate kernel honored in the
  shape). The product serves the PAIR (verdict, sweep watermark) — the
  gate was asking the pin a question the product answers at S; gating the
  pin-clock boolean re-litigates the settled snapshot-architecture
  decision stochastically by dice. (b) REJECTED (a gate whose failure
  probability is weather is not a gate; rerun-until-quiet trains alert
  fatigue). (c) REJECTED, kernel conceded (asymmetry belongs in the
  measurement surface, not the gating predicate). THE SHAPE: liquidatable
  becomes three-state; boundary-crossing-motion (disclosed, gated=false)
  reachable ONLY through FOUR conjuncts — the maxBorrow sample-gap
  certificate; borrowingOf EXACT at pin (debt is same-clock: any
  disagreement is drift); the NEW S-clock boolean custody weld
  (ComputeDMHealth over ALL inputs at S — Stage-A pre-collects the
  per-account debt-fold-at-S inside the snapshot tx via one correlated
  aggregate — welded bit-exact against liquidatable(user)@blockHash(S));
  and boolean-granular evidence (direction-tagged class strings w/ the
  false-negative louder, the VERDICT TRIANGLE served/chain@pin/chain@S,
  both margins, sweep age, certificate ref). GUARDRAIL: gated=false is
  NOT an epsilon — margin appears in evidence only, never the predicate.
  ALSO BLOCKING: fix the weldDMCohort note text (its "two inputs weld
  exactly" precondition was FALSE for both rows — a misdiagnosis printed
  into the artifact is D-013 always-fix); standing aggregate
  cohort:boundary-crossing-motion (count by direction, margins, max
  sweep age) GATED at population level (~1% = sweeper-health, where
  weather is refuted by its own frequency). Never-swept blessed (+
  last_attempt_status empty vs failed distinction, minor). Transport
  unreads blessed retry-clearing ("cannot verify is never advisory" held
  under a local DNS outage; rotation could not have salvaged these).
  SEQUENCING: land the shape BEFORE the retry — a quiet retry would be
  the (b) dice coming up friendly. Escalation trigger recorded: S-clock
  boolean weld failing while the collateral certificate passes = the
  composition law diverging = custody drift immediately. risk-quant's
  parallel ruling pending; fix wave dispatches on convergence.
- **RISK-QUANT RULING CONVERGES; WAVE H3 DISPATCHED WITH THE UNION
  (13:10)**: risk-quant independently reached the same three-state shape
  with its own doctrine line — "a comparison is a weld only if both sides
  are the same fact at the same clock"; near the boundary the boolean is
  a step function (infinite sensitivity — no staleness bound translates
  into a boolean error bound), so the pin-clock gate measures whether a
  boundary-adjacent user moved money, not the pipeline, and A PASS UNDER
  A STOCHASTIC GATE CERTIFIES THE DRAW, NOT THE SYSTEM (vacuous green by
  the institutional route). The license to stop gating is CONDITIONAL:
  (1) the served surface structurally attaches the disclosure — evidence
  not assertion (schema/code cite + pinning test; any surface serving
  the bare boolean collapses the license into a D-013 always-fix); (2)
  staleness bounded not merely labeled (each motion row inside its
  freshness budget); (3) every flip proven mechanical PER ROW. Its added
  obligation: the Law@P PIN-VECTOR SUBSTITUTION — recompute scalar AND
  boolean over the chain's own pin vector; the flip becomes a theorem of
  two chain-attested endpoints, the motion IS vector@P − vector@S.
  DIVERGENCE RESOLVED BY UNION: chain-truth's S-clock boolean custody
  weld AND risk-quant's pin-vector substitution are both conjuncts (the
  stronger set wins). Never-swept: risk-quant CORRECTED the blessed
  shape — any-never-swept-gates is stochastic on borrower arrival; the
  lawful form is refusal-weld (consumed read, not assertion) + age guard
  derived from the sweeper's own schedule (race window → disclosed
  coverage-gap; else gated) + census denominator. Transport retry
  doctrine written down: hash-anchored reads make a same-pin retry THE
  SAME EXPERIMENT COMPLETED (cannot benefit from a quieter market —
  precisely what distinguishes it from condemned (b)); the receipt is
  ONE completed run, the aborted artifact RETAINED AND CITED as
  superseded (kept red draws are anti-reroll evidence; preserved to
  scratch accept-r5-aborted/). WAVE H3 DISPATCHED: the union law (six
  MOTION conjuncts incl. both consultants' welds), note-text fix,
  motion census + ~1% sweeper-health population gate, never-swept
  reshape, frame declarations, serving-surface disclosure proof,
  retry-pin taint determination, retroactive classification of the two
  accounts at the finalized pins (the empirical half), 5 designed
  mutants. Codex round → same-pin retry (if untainted) after it lands.
- **WAVE H3 LANDED (14:05, b73a436)**: the boolean three-state law
  implemented as the six-conjunct UNION of both rulings and verified —
  RETROACTIVE PROOF IS THE HEADLINE: both flagged accounts classify
  MOTION with full evidence via a committed hash-anchored opt-in live
  test at the accept-r5 pins. The verdict triangles came out
  true/false/false with the mixed pairing liquidatable while BOTH pure
  clocks are healthy (each account grew debt AND collateral after S) —
  exactly the three-way print the ruling ordered, and empirical proof
  the old gate was measuring user behavior. Motion ledgers reconcile
  bit-exact (single-token USDC deltas; Σ +32.09/+195.50 USD-6-weighted).
  Margin fields structurally absent from the facts struct
  (reflection-tested); m3's margin-cutoff mutant devoured the whole law
  when applied — the epsilon is impossible, not just refused. Never-swept
  reshaped (refusal-weld consumed + posture probe + schedule age guard +
  census); seven frame sources declared AND consumed every run; Stage-A
  debt-fold-at-S correlated aggregate inside the snapshot tx. PIN
  DETERMINATION: -pin-op/-pin-eth are mustTaint (TestFlagSurfaceClosed)
  — the verdict-bearing retry goes at FRESH pins under the new law; the
  same-pin doctrine is discharged evidentially by the retro test
  (non-verdict-bearing) and the aborted artifact stays cited as
  superseded. 5/5 mutants killed; suites green. Owed: cmd/api
  strip-proof pinning test (serving-surface disclosure gap — reported,
  not crossed); -race pending toolchain; Stage-A live cost watched next
  run. CODEX ROUND DISPATCHED on 6a869bc..b73a436 (attack order: can
  MOTION absorb a real defect; strict-> preservation structural;
  race-guard stickiness; population-gate arithmetic; retro-test bars;
  frame consumption every run; faithfulness sweep vs both rulings).
  On SHIP → fresh-pin acceptance retry → E1.
- **CODEX ON H3: NOT-SHIP, 4 FINDINGS; H4a+H4b DISPATCHED PARALLEL
  (14:21)**: (1) HIGH, and OUTSIDE the harness — AddressHistoryPoint
  REQUIRES liquidatable but OMITS sweep_block (wireHistoryPoint emits
  only BalancesBlock): a bare mixed-clock boolean on the history wire
  collapses the MOTION license's premise exactly as the rulings warned
  ("any surface serving the bare boolean collapses the license"). (2)
  HIGH — the never-swept race guard's fleet-min floor can FALSE-PASS a
  genuinely skipped borrower (a stale straggler success pins the floor;
  a later-arriving account skipped by completed generations classifies
  honest-race; 1 row passes the census) — the cycle-specific witness is
  required, missing evidence gates. (3) HIGH — the retro live test
  hardcodes accounts/values instead of loading the retained accept-r5
  artifact through the H2 recomputed-digest bars — a vacuous-green
  empirical claim shape. (4) MEDIUM — the S-clock param cut filters the
  COLLAPSED DMParamsAsOf(P) snapshot (latest-per-asset), which cannot
  reconstruct S across config changes between S and P → wrong rejection
  during ordinary parameter motion; the full ledger prefix must fold
  independently at S. Codex also confirmed the strict-> equality test
  holds (the both-welds-detect->= comment overstated; soften). WAVES
  DISPATCHED (disjoint zones, parallel): H4a = cmd/reconcile findings
  2/3/4 + comment fix, 3 designed mutants incl. the failed-straggler
  kill; H4b = the serving-surface train (contract 1.2.1: AddressHistory-
  Point gains the REQUIRED sweep watermark mirroring PositionSummary;
  THE EXHAUSTIVE mechanical contract test over every liquidatable-
  bearing schema; wireHistoryPoint + strip-proof test discharging the
  H3-owed gap; client regen; Inspector history hover carries the mark).
  Round 3 closing review on the pair after both land → fresh-pin retry.
- **H4a+H4b LANDED AS A PAIR; ROUND 3 CLOSING REVIEW IN FLIGHT (15:12)**:
  joint gate green everywhere (reconcile/snapshotdb/api Go suites -p 1,
  client 310/310 w/ byte-identical drift regen, web 210/1-skip). Landed
  as two commits, pushed through ae998e0. H4a: cycle-witness race law
  (fleet-min GONE from the predicate; honest-race only on a positive
  generation witness; Codex's failed-straggler scenario committed as the
  regression proving old-raced/new-gates), digest-bound retro proof (11
  refusal arms; status honestly outside the hash scope, nothing relaxed),
  full-ledger S param fold (dmFoldParamsAtS REFUSES without the raw
  ledger — the collapsed fallback IS the defect; resurrection transition
  case proven); live retro re-run PASS artifact-bound. H4b: contract
  1.2.1 (AddressHistoryPoint.sweep_block REQUIRED from store truth — the
  store already retained it, nothing fabricated), the EXHAUSTIVE
  mechanical disclosure law test (licensed-bit walk, re-clocking voids
  outer vouching, injected bare-verdict fixture proved load-bearing under
  the hand-list mutant, orphan-carrier check), strip-proof discharged,
  DM history hovers carry S-marks. Mutations 3/3 + 2/2 KILLED. PINNED
  FOR ADJUDICATION (exact set, cannot grow or vanish): three count-class
  disclosure gaps (observatory point + series, batch permalink
  liquidatable_positions) + H4a's disclosed accept-r4 collapsed param
  filter — all handed to Codex round 3 to adjudicate under the bar.
  On SHIP → the fresh-pin acceptance retry (the receipt run).
- **CODEX ROUND 4 ON THE H4 PAIR: NOT-SHIP, 3 FIX-WORTHY + 1 ACCEPTED
  (15:36)**: (1) HIGH — the cycle-witness law still leaks: a generation
  OPEN when a borrower arrives is OWED that borrower (SweepWorkBatch
  re-queries the registry per batch and completes only on an empty
  query), so MinAttemptBlock ≤ firstDebt proves opening-before-arrival,
  not completion-before-arrival — the 100/200/300 overlap scenario
  discloses a genuinely skipped borrower. Fix: gate any never-swept
  borrower overlapping a completed generation until arrival-vs-
  completion evidence exists. (2) HIGH — Codex ADJUDICATED the three
  pinned count surfaces FIX-WORTHY under the bar (ordinary public reads
  serving liquidatable-derived counts with no sweep clock — a count read
  as belonging to its displayed time while aggregating unnamed sweep
  cuts): the sweep watermark wires into ObservatoryPoint,
  ObservatorySeriesPoint, BatchResponse from store truth, and the
  exact-three exemption comes OUT of the law test. (3) MEDIUM — the law
  test itself can green through a REQUIRED-BUT-EMPTY array
  (watermarks: [] licenses via the unreachable item type) and nullable
  hops: cardinality + nullable-hop rejection + negative controls. (4)
  LOW accepted-and-disclosed — the legacy accept-r4 collapsed filter
  stands for the retained artifact (no config motion in those windows);
  replace before any reuse. H5a (reconcile: the overlap gate + the
  100/200/300 regression) and H5b (the count-surface train: store-truth
  determination, likely migration 00018 w/ sweep columns on
  observatory_points + honest NULL backfill for pruned sources, welds
  17→18, contract 1.2.2, law-test hardening) DISPATCHED PARALLEL.
  NOTE: 00018 landing means the live DB needs one more daemon-applied
  migration before the receipt run (additive, seconds, pre-authorized
  class). Round 5 on the pair after landing → THEN the fresh-pin
  acceptance receipt run.
- **H5a+H5b LANDED AS A PAIR; LIVE DB AT SCHEMA 18; LOCAL UI SERVING
  (17:03)**: joint gate green after diagnosing the 00018 backfill
  failure to post-edit 00013 drift in three derived scratch DBs
  (solvent_test_reconepoch/_recongate/_reconsweeppin re-armed; live DB
  verified clean READ-ONLY first: all 7 sweep columns present, empty
  observatory_points). Landed f12018e (H5a: completion-edge witness
  replaces the opening-edge heuristic) + c683515 (H5b: migration 00018
  sweep clocks on observatory_points w/ honest NULL backfill for pruned
  sources, welds 17→18, contract 1.2.2, law-test cardinality +
  nullable-hop hardening), pushed. Mutations 3/3 KILLED. Live DB
  daemon-migrated to goose 18. API up :8080 (honest no-batch refusals),
  web up :3111 (all six surfaces 200). riskd -once FIRST PRODUCTION
  CONTACT FAILED: duplicate risk_position_legs PK — a DM account with
  the same asset on both sides emits two USDC legs; the schema's row
  model carries both sides in ONE row and the fixtures (1-4 positions)
  never held the shape. Diagnosis+fix wave dispatched (merge preferred;
  HF/maxBorrow-unchanged must be PROVEN; riskd -once live is the wave's
  one sanctioned write; clause-4 authority to fix a second first-contact
  bug in the same layer). Owner one-pager artifact published.
- **CODEX ROUND 5 ON THE H5 PAIR: NOT-SHIP, 4 FIX-WORTHY (17:25)**:
  (1) HIGH — failed sweep attempts launder into the never-reached race
  exemption: the never-swept branch ignores the account's OWN
  attempted=true/status=failed row in the completed generation (max
  attempt 100, first debt 200 → classified coverage gap, ungated; a
  padded census leaves the failure unsampled → false-green reconcile).
  Fail closed: an attempted account WAS reached. (2) HIGH — the batch
  permalink handler reads identity/completeness/aggregates/watermarks
  in separate queries; a retention prune between stages serves a
  COMPLETE batch as aggregates:[] and the stamp loop passes vacuously
  on zero rows (wrong empty-book answer to an honest reader). One
  repeatable-read tx + reject empty/inconsistent cardinality on a
  complete batch. (3) MEDIUM — the 00018 CHECK passes UNKNOWN
  (sweep_applicable=NULL with full stamp payload satisfies no branch
  and fails none) while the reader treats the row as unrecorded and
  ignores the stamp — a vacuous guard; needs IS TRUE/IS FALSE semantics
  via a NEW migration (00018 is applied live; an in-place edit re-runs
  the 00013 scratch-drift fiasco). (4) MEDIUM — the contract law test
  analyzes allOf arms independently: batch_id in one arm + the count in
  a sibling arm keeps the outer license — merged-object analysis + a
  sibling-arm negative control. ALL FOUR FIX-WORTHY under the bar
  (1 = pass-that-should-fail, 2 = wrong data served, 3 = vacuous guard,
  4 = vacuous green). H6a (finding 1, cmd/reconcile — disjoint zone)
  DISPATCHED NOW; H6b (findings 2-4, cmd/api + internal/store) QUEUED
  behind the riskd first-contact wave, which owns those packages at
  this hour (scope-check sent: justify the refusal/coverage plumbing,
  keep the leg merge separable, no cmd/reconcile, no in-place 00018).
  Round 6 on the H6 set after landing → THEN the fresh-pin acceptance
  receipt run.
- **H6a LANDED; riskd FIRST-CONTACT PAIR LANDED; BATCH 2 LIVE; DAEMON +
  API RESTARTED; H6b DISPATCHED (17:55)**: H6a = ecd365d (integrator
  gate re-run independently: build/vet/test green; diff verified — the
  attempted-row guard sits AHEAD of every exemption path, six H5a
  conjuncts byte-untouched; the rule is deliberately UNQUALIFIED because
  snapshot_sweeps keeps only the LAST attempt so generation attribution
  is unwitnessable in both directions — round-17 unqualified-rules
  precedent; mutant killed, transcript committed). riskd first-contact
  wave: root cause (b) PROVEN LIVE — assembleDM emitted debt + collateral
  legs separately per asset and 7,503 of ~9,700 DM accounts hold USDC on
  both sides (the whole book, not an edge). Landed as the separable pair
  a04481f (riskfeed legIdx fold into the schema's one-row-both-sides
  model; HF/maxBorrow bit-identical — hand-derived totals, three
  Σ-welds, control differential; also fixes mergeDMLegs
  double-decoration; 2 mutants killed) + a214d4e (api reconstruction:
  nil-amount pure-debt legs are NOT phantom zero-collateral — pre-fix
  the API would have false-refused ALL 44 computed rows of the only
  live batch via eqBig(0,nil); new debt-side weld Σ live_debt ==
  borrowings; 1 mutant, 3 tamper subtests). Zero refusal/coverage
  plumbing added (the diagnostics adjacency was pre-existing
  flag-custody code); no store change; no migration; AlgorithmRevision
  correctly unbumped (a colliding pre-fix batch cannot exist — the
  write always failed). Integrator re-ran the gate: build ./... clean,
  riskfeed ok, cmd/api ok 109s (-p 1). LIVE: batch 2 committed (9,806
  positions, 9,762 honest G1 over-ceiling refusals — the price poller
  had been DOWN since the 17:20 migration swap; designed posture, not a
  bug). OPS: solvent-indexer.exe restarted (clean 17:20 shutdown
  confirmed in log first); API swapped to the a214d4e build (the
  running binary predated the reconstruction fix and would false-refuse
  computed rows); riskd -once re-queued after price rounds to compute
  the full book (7,503 merged-leg accounts exercise a04481f live). H6b
  DISPATCHED (findings 2-4: one repeatable-read tx + fail-closed
  cardinality rejection on the batch permalink; migration 00019 with
  IS TRUE/IS FALSE constraint semantics + welds 18→19 + live daemon
  migration owed to the integrator; allOf merged-object analysis +
  sibling-arm negative control; contract pinned at 1.2.2). Owed/noted:
  batch id 1 burned by the crashed pre-fix attempt (cosmetic);
  open-generation sweep-age ~17min observation deferred to a future
  wave; round 6 covers c683515..H6b-head as one range.
- **BATCH 3 LIVE (FULL BOOK); H6b LANDED; LIVE DB AT SCHEMA 19; ROUND 6
  DISPATCHED (18:35)**: after the daemon restart the queued riskd -once
  committed batch 3 — 9,807 positions, 0 refused, 31 flagged, the DM
  watermark carrying its full sweep stamp (generation 79 CLOSED, 9,766
  rows, 0 failed) — the a04481f merged-leg write path proven live across
  the 7,503 both-sides accounts; all six web surfaces serve real data.
  (riskd WARNed it ran under SOLVENT_DATABASE_URL, not the SELECT-only
  SOLVENT_RISKD_DATABASE_URL role — wire before VPS deploy.) H6b LANDED
  as b9cbde6 (store: 00019 two-valued CHECK — IS TRUE/IS FALSE spelling,
  00018 byte-identical on disk per the 00003 incident law, ADD
  CONSTRAINT validates existing rows deliberately, welds 18→19 in all
  four files, negative regressions prove the v18 admission AND the v19
  rejection) + d7f7624 (api: handleBatch reads ONE REPEATABLE READ
  snapshot — served_at is the tx clock, servability via
  CompleteBatchIDs in the same snapshot — and a complete batch reading
  back zero aggregates or zero stamps is REFUSED with a named 500;
  batchInterleave seam pins the prune-race regression; flattenAllOf
  merges arms before licensing with a sibling-arm negative control +
  positive mirror, oneOf/anyOf deliberately per-arm). Mutants 3/3
  KILLED; contract pinned 1.2.2 (openapi.yaml untouched). Integrator
  gate re-run independently: build/vet clean, store ok 197s, api ok
  79s (-p 1), reconcile weld by name PASS. LANDING FRICTION: the
  integrator lease expired mid-landing — the control plane blocked the
  commit correctly; renewed 24h and committed the claim ALONE (704fe73)
  after deregistering the spent p3accept2 acceptance worktree
  (single-worktree invariant; its dirty accept-r5-aborted drift
  artifacts copied to session scratchpad first). OPS: daemon + API
  rebuilt at d7f7624 and swapped; the daemon applied 00019 at boot;
  /v1/meta serves schema_version 19; batch 3 still serving. OWED
  (carried): readBatchAccounts pool-side NewestCompleteBatch
  (theoretical F2 shape-sibling, unreachable at retention 5000 —
  report-only per the wave's survey); -race over cmd/api once a gcc
  toolchain lands. CODEX ROUND 6 DISPATCHED: closing adversarial review
  over c683515..d7f7624 (H6a + the riskd first-contact pair + H6b) —
  verify all four round-5 findings closed AND fresh eyes on the new
  complex ranges. On SHIP → the fresh-pin acceptance receipt run.
- **CODEX ROUND 6: R5-F1..F4 ALL CLOSED; NOT-SHIP ON ONE FRESH HIGH —
  DEBT-ONLY DM SCALE; H7 DISPATCHED (18:58)**: Codex confirmed all four
  round-5 remedies closed (attempt bit sourced from actual snapshot-row
  presence and short-circuits every true-returning exemption; the batch
  race test truly crosses a retention delete; migration 19 preserves
  the three legal states without editing 18; no remaining allOf
  false-green path found). Review STATIC (worktree Go build cache
  unwritable — suites re-run owed to the integrator gate, which already
  ran them at landing). THE FRESH FINDING (HIGH, clears the bar as
  wrong-data-surfaced): a debt-only DM position — honest state: nonzero
  debt, successful sweep observed EMPTY collateral (ApplySweepBatch
  supports it) — gets its USD scale INFERRED from price witnesses that
  don't exist: indexPrices returns decimals=0 which OVERWRITES the
  correct USD-6 constant (assemble.go:1030), and reconstruction
  verifies the debt SUM but never the SCALE, so /v1/address and
  /v1/positions can serve $1,000 of USD-6 debt as $1 billion while the
  engine aggregate stays correct at 6. The a04481f merge made the full
  book commit, so batch 3 MAY BE SERVING THIS NOW. WAVE H7 DISPATCHED:
  quantify the live blast radius first (SELECT-only), make the DM USD
  scale a structural constant independent of price witnesses, add the
  reconstruction SCALE WELD (wrong scale → refusal, the backstop that
  would have caught this), adjudicate AlgorithmRevision 4→5 if any
  batch-3 row is affected, 2 mutants, then the sanctioned riskd -once
  → batch 4 supersedes. Round 7 closing review after landing.
- **H7 LANDED (9ee3207); BATCH 4 LIVE AT REV 5; ROUND 7 + WEB DEFECT
  WAVE DISPATCHED; P5 UX TRAIN OPENED (19:50)**: blast radius measured
  BEFORE the fix: 44 batch-3 DM rows at value_decimals 0 — each
  $0.000001 of debt served as $1 (10^6 overstatement), all flagged
  liquidatable; the engine aggregate beside them was correct at 6.
  Fix: risk.DMUsdDecimals=6 structural in ComputeDMHealth (witness set
  at any other uniform scale REFUSED — ErrWrongPriceScale), assembly +
  aggregate share the constant, stress/waterfall inherit; serve-side
  scale weld in verifyReconstruction (DM: persisted != engine
  declaration → API_RECONSTRUCTION_MISMATCH; Aave arm too — its
  witness-derived 8 stays legitimate). AlgorithmRevision 4→5 (both
  trigger clauses met; an unbumped binary would adopt batch 3 and
  republish the wrong rows). Aave does NOT share the defect (every
  computed Aave position consumes ≥1 witness by construction). Mutants
  2/2 KILLED. Integrator re-ran the full gate independently (risk/
  riskfeed/api/riskd all ok). Batch 4 live: 9,808 positions, all 9,761
  DM rows at scale 6, key 36a7cc31…; the 44 accounts verified serving
  correctly. API on :8080 swapped to the 9ee3207 build (arms the
  weld); batch 3 retained as evidence per house law. CODEX ROUND 7
  dispatched (closing on e17479e..9ee3207 + adversarial: other
  RiskPositionWrite producers, MIXED witness sets, weld coverage
  across all value_decimals surfaces, rev-transition adoption). P5 UX
  TRAIN (task #24): solvent-design delivered the 18-point Book-table
  ruling (dust filter server-side via additive min_value+dir params →
  contract 1.3.0; virtualized sentinel auto-load at PAGE_LIMIT 200;
  clickable per-engine sort headers replacing the chip row; refusal
  register for 4xx; DM HF column header "HF — disclosure"; URL-param
  persistence, localStorage rejected). Wave W-UX-B dispatched (web-only
  defect fixes: SORTS_BY_ENGINE, deep-link normalizer, refusal
  branching, DM header). Supplement ruling 16-18 requested (risk map
  full-book source, histogram/waterfall comprehension + the owner's
  three unparseable Lab captions: held-flat list, eligible-vs-realized,
  non-monotone collateral-at-risk). Contract train A HELD until the
  supplement lands so ONE 1.3.0 train carries every param.
- **CODEX ROUND 7: SHIP (e17479e..9ee3207); ACCEPTANCE RECEIPT RUN
  LAUNCHED; SUPPLEMENT RULING IN; W-UX-A DISPATCHED (20:02)**: round 7
  approve, NO material findings — static trace confirmed all DM
  position writes USD-6, mixed/wrong witness scales refuse, stress/
  waterfall consume the structural scale, both serving surfaces share
  the welded reconstruction, rev 5 bound into the materialization key.
  Below-bar note recorded: future non-8 Aave oracle configs should
  re-evaluate the aggregate's fixed scale (registry + live evidence
  are 8 today). Codex sandbox still could not write Go caches (GOTMPDIR
  redirect denied) — static only; the integrator gate had already run
  the full suites at landing. THE H-SAGA REVIEW TRAIN IS CLOSED: rounds
  1-7, every finding either fixed-and-verified or accepted-and-
  disclosed. FRESH-PIN ACCEPTANCE RECEIPT RUN LAUNCHED (babysitter
  agent, main worktree, harness picks fresh pins; -rps 1.0 -timeout
  45m -rpc-attempts 8; transient protocol: max 2 full relaunches,
  partial-run pins never reused; artifacts land unstaged for the
  integrator to commit). Design supplement 16-18 RECEIVED (risk map:
  explicit load-full-book walk + deterministic client bins + crit rows
  NEVER binned + top-12 named whales + USD log axis; DensityMap new
  primitive, Scatter untouched; histogram/waterfall: computed reading
  lines — never asserted — percent-primary shock labels, bad-debt
  gloss, dust ANNOTATION never dust-hiding on projections; held-flat:
  counted-details summary, NO client-side USD scaling — blocked on the
  HeldFlat decimals+symbol proposal; at_risk_note deregistered from
  primary as implementer prose). W-UX-A (contract train 1.3.0:
  min_value + dir + limit 1000, cursor binds all params, refused/NULL
  never excluded law in contract text, 3 mutants) DISPATCHED. Named
  proposals pending owner/integrator adjudication: E-2 risk-map
  endpoint; HeldFlat enrichment; dust-echo fields.
- **W-UX-B LANDED (e794bb0); CONTRACT TRAIN 1.3.0 LANDED (26f3f01 +
  ca12af2 weld regen); W-UX-D IN FLIGHT (20:30)**: W-UX-B (web defects,
  ruling points 9-12): SORTS_BY_ENGINE (DM never offers hf), ONE
  normalizer over URL state (the doomed engine+sort pair can never fire
  - first fetch is born normalized), engine-switch remap + dim ack
  line, error-taxonomy branching (4xx -> refusal register with the
  API sentence verbatim and NO retry; transport keeps retry), DM
  header "HF - disclosure"; 13 unit + 16 e2e green on the wave config
  (:3811, w2-w6 convention); integrator re-verified tsc + 13/13.
  W-UX-A (contract train): /v1/positions gains min_value (exclusion
  law IN THE CONTRACT TEXT: refused/NULL-total rows never excluded;
  total_positions = qualifying count while in force) + dir (absolute
  axis semantics; canonical directions documented; account tie-break
  always asc) + limit 1000; cursor binds 6 fields (resolved dir - the
  absent-dir cursor interchanges with its canonical spelling); NUMERIC-
  exact compare; client regen byte-identical 312/312; mutants 3/3;
  sweep law 7/7 untripped; deploy-boundary note: pre-train 4-field
  cursors answer the malformed-cursor 400 (documented restart
  behavior). Integrator re-ran positions+law suites and client verify
  independently, landed by name, regenerated web/lib/proof-contract
  .gen.ts against 1.3.0 (fidelity 7/7). W-UX-D (charts supplement)
  running in web/; W-UX-C (table redesign) dispatches when D lands
  (file overlap: dust.ts, BookSurface, BookRiskMap). Acceptance
  receipt run still in flight (monitor armed).
- **OVERNIGHT REBOOT RECOVERY; W-UX-C LANDED (0b75eed) — THE P5 UX
  TRAIN IS COMPLETE; ACCEPTANCE r7 IN FLIGHT (13:00 Aug 1)**: the
  machine rebooted ~22:32 killing Postgres/daemon/API/web AND
  acceptance r6 — r6 autopsy: result aborted, ZERO real drift (29/29
  custody exact, 29,294 boolean welds clean, 1,147 Aave HF welds
  clean); all 22 failures transport-starved reads from the dying
  machine + the recurring localhost-DNS flake at the rewind re-check
  (the same shape that killed r5); artifacts preserved in session
  scratchpad accept-r6-aborted/. RECOVERY: Docker+Postgres restarted,
  daemon+API rebuilt at HEAD (1.3.0/schema19/rev5), web rebuilt on
  :3111, derive-cursor 13h39m lag chewed in ~9 min, preflight GREEN,
  batch 5 committed (9,828/0/30, fresh prices). r7 LAUNCHED 12:24 with
  the ROOT-CAUSE fix: localhost→127.0.0.1 in-shell substitution (env
  only, .env untouched; direct go run because make re-includes .env),
  awake-hours-only launch policy adopted. W-UX-C LANDED as 0b75eed
  (integrator re-ran: 180 unit default, 313 wave config, typecheck
  clean): dust chips off/<1/<100/<1k default <1 → min_value bigint;
  clickable per-engine header sorting (two-state, dir; DM HF header
  stays plain disclosure); refused-first chip; URL mirror with
  orphaned-dir normalizer rule (a deep-linked dir never survives a
  sort remap — caught RED by e2e); PAGE_LIMIT 200 + sentinel auto-load
  gated on error===null + DOM windowing ~100 rows; batch-guarded
  footer ledger (hidden count never blends batches; Σ bound → exact at
  exhaustion; liquidatable line in crit whenever agg > loaded); the
  three micro-rulings (zero-member all-dust gate at call sites,
  partial axis unified on usd-log, held-flat prose pluralizes);
  micro-4 verified (DensityMap ticks already integer-decade). :3111
  restarted at 0b75eed — the owner's entire 7-request feedback batch
  is now live. Wave-flagged items for the next design pass:
  {step} rendering grammar pinned for cheap re-rule; dust-off
  fallback when /v1/book fails (louder disclosure?);
  heldFlatDetailsSummary invariance carve-out. NEXT: r7 verdict →
  receipt commit + E1 paperwork; Codex review of the UX range
  (e794bb0..0b75eed) queued behind the receipt.
- **r9 DIAGNOSED (5 = ONE HARNESS DEFECT); H8 + H9 LANDED; ROUND 8
  DISPATCHED (18:15 Aug 1)**: the r9 FAIL's 5 gated failures were all
  classification (c): readBacktestFrameState built its subcall set
  from db.Seizures only, so PARTIAL liquidations (fan-out < basket)
  left unseized collateralOf@N-1 legs unpriced -> incomplete basket ->
  gated per the H1 doctrine working AS DESIGNED over an under-fetched
  input (all 26 passers were full-sweep shapes; every dropped leg's
  price+config provably served on-chain at N-1 via the harness's own
  call shapes; seized-only sums reproduced the reported maxBorrowLT
  bit-exactly). H9 landed a45b173: parent frame prices+configs the
  whole getCollateralTokens@parentHash universe in the existing single
  multicall; exec frame values the same complete basket; decimals gap
  closed at the parent pin; read-presence doctrine untouched; negative
  control proves a complete-basket genuine mismatch still fails
  loudly; mutants 2/2. LIVE RE-ADJUDICATION at the r9 pins: 31/31
  verdict=exact true-at-parent, complete baskets everywhere — the 5
  land at the diagnosis-predicted margins (usd6 63348805/2669215/
  308105121/553571/1447); the frame has ZERO gated residue. H8 landed
  aa963eb (the study-pass finding the owner promoted): snapshot-first
  batch resolution via store.NewestCompleteBatchQ + fail-closed
  cardinality on /v1/book — SSE/meta/run-book inherit; prune-race +
  cardinality regressions; mutants 2/2 with complementary-defense kill
  modes; survey: handleAddressHistory three-instant read report-only
  owed; riskd previousPrices noted (writer holds the prune lock). Live
  API swapped to aa963eb. r9's FAIL artifacts preserved (scratchpad
  accept-r9-fail/); committed receipt bytes restored to the tree (the
  3 evidence-test failures were that drift, proven H8-independent).
  AGENT-OPS LESSON (2nd occurrence): agents parked on background
  processes stall silently — the H9 wave finished its work then died
  waiting on its live test; integrator re-ran it directly. Session-
  owned background processes only for anything verdict-bearing.
  CODEX ROUND 8 DISPATCHED: the pre-receipt closing sweep over
  e794bb0..a45b173 (H8 + H9 weighted highest; the UX/contract range's
  first adversarial pass). On SHIP -> acceptance r10 (the receipt run:
  direct go run, 127.0.0.1 substitution, -rps 1.0 -timeout 120m
  -rpc-attempts 8, awake hours, session-owned background).
- **ROUND 8 NOT-SHIP (1 vacuous green) → FIXED 1b56d77 → ROUND 9 SHIP;
  r10 THE RECEIPT RUN LAUNCHED (18:55 Aug 1)**: round 8 approved zones
  1 and 3 (H8 querier soundness, server/client dust predicate match)
  but caught the H9 live re-adjudication test greening on no-error +
  31-records while the certified verdicts were only t.Logf'd — a
  skipped/mismatching case could exit 0 (vacuous green, HIGH).
  Integrator fixed directly (small): per-case hard assertions —
  Evaluated, true-at-parent, obligation-2 row present, verdict EXACT
  with empty class, both completeness flags true. LIVE mutant-kill:
  inverted expectation FAIL 384.6s; sha256-identical restore PASS
  383.4s with assertions armed. Lease renewed en route (6a0e264,
  committed alone). ROUND 9 (fresh session; resume unavailable): SHIP
  on e794bb0..1b56d77 — join soundness verified (unique frozen-case
  key = res.Key = obligation-2 Subject, exactly one row per evaluated
  case; cardinality pinned; lowercase boolean spellings confirmed),
  "no remaining substantive false-green path found." THE PRE-RECEIPT
  REVIEW TRAIN IS CLOSED (rounds 1-9). r10 LAUNCHED with the proven
  recipe (direct go run, 127.0.0.1 substitution, -rps 1.0 -timeout
  120m -rpc-attempts 8, session-owned background, awake hours). On
  PASS: commit the receipt artifacts + E1 paperwork (W2 receipt,
  archive W2, W3-phase5 work object, D-014, ROADMAP/STATUS, claim
  rescope).
- **r10 PASSED — THE ACCEPTANCE RECEIPT LANDED (0c5f317); PHASE 3
  EXITED (E1: cf4caac + 5e6fad7); W3 OPEN (overnight Aug 1→2)**: r10
  completed clean on the proven recipe: PASS with 0 gated failures
  over 30,838 gated + 699 advisory comparisons; drift-report sha256
  a34d7a53…; pins eth 25664030 / op 155018419. Receipt artifacts
  committed 0c5f317 (drift-report.json/.txt under
  roadmap/evidence/artifacts/w1-reconcile/). E1a cf4caac: W2 closed ON
  the receipt (E-w2-acceptance.md), claim released, P3 → Done. E1b
  5e6fad7: W3 (Phase 5 public web — deploy + launch) opened, claim
  reopened gen-14, D-014 (P5 before P4) accepted, STATUS → P5/W3. The
  two-commit release/reopen precedent (30462fc/c7e5b77) held. Follow-
  up 8fffea7: the runbook evidence test's stale pre-receipt pins
  (87/21) now assert the receipt's real cardinalities (30838/699).
- **TWO NEW PERSONAS; THE SIX-AUDIT FLEET; R-TRAIN LANDED (R1 6599d6b,
  R2 e4d9b03, R3 016cc31, R4 d6ff1f0); ROUNDS 10–11 CLOSED (Aug 2)**:
  owner batch 2 (HF History reads broken-sparse; Lab BOOK mode dead-
  ends; header/column misalignment; risk map below the table; "never"
  liq-distance on real-debt accounts — tons of them; duplicate page
  headers; uneven tabs) + owner-directed persona expansion. Charters
  written to ~/.claude/agents/: solvent-user (composite risk lead /
  position holder / liquidator / cold visitor; honest-but-confusing =
  MAJOR by law) and solvent-clarity (information-communication
  director; finding-first titles, progressive disclosure, jargon
  budget; form defers to solvent-design). Six audits (user + clarity
  carriers, 3 opus archetypes, Codex cold-user + Codex code review;
  owner directive: opus/codex only, no fable) reproduced every owner
  finding and surfaced two BLOCKERs beyond them: (1) the Aave verdict
  was NEVER ASSIGNED — absent counted as zero, so /v1/book said 0
  liquidatable over a book whose own rows showed HF < 1 → R2 e4d9b03:
  assembleAave sets p.Liquidatable via the one verdict law
  (AaveHealth.Liquidatable(), strict HF < 1e18, nil-safe,
  internal/risk/types.go), aggregate() REFUSES computed rows lacking a
  verdict, AlgorithmRevision 5→6, batch 6 live at rev 6; (2) the SSE
  stream had never worked in ANY browser — the client sent
  Cache-Control on EventSource reconnects and the API's CORS preflight
  allowlist rejected it → header allowlisted server-side; the
  redundant client header dropped (sse.go already serves no-store).
  Landing R2 required W3 AMENDMENT 1 (10f84cf: allowed_paths gains
  internal/**, cmd/**, go.mod, go.sum) + claim rescope gen-15
  (5c8fc9c). R1 6599d6b (43 files, the six-audit web train): "never" →
  "no price path" tagged-union rendering with per-reason titles +
  legend; freshness lines on every surface; Activity feed scaling
  (raw base units → USD); nav renames Lab→Scenarios,
  Observatory→History, Feed→Activity (owner approved); duplicate
  eyebrow+H1 dedupe; DataTable sentinel walk-length fix (the
  IntersectionObserver load bug). Codex ROUND 10 NOT-SHIP (Aave bonus
  rendered 105% — masked by a non-wire test input; ages frozen at
  paint; legend overclaimed reachability) → R3 016cc31: bonus-as-
  premium per engine (Aave par-based 10500 → 5%; DM direct additive —
  proven from fixture_test/backtest/p5_events), live-age monotonic
  anchor + 60s tick. ROUND 11 NOT-SHIP (performance.now() pauses
  through sleep/bfcache so ages under-state; no-debt rows made the
  legend false) → R4 d6ff1f0: anchoredAgeSeconds = max(monotonic-
  derived, wall-derived, per-receipt floor); AgeAnchor carries
  receivedAtWallMs; pageshow/visibilitychange/focus reconcile
  (RESUME_COALESCE_MS=5000, seeded from the receipt); keepOnFailure on
  the resume path only; reason-neutral legend with per-cell hover
  reasons. Rounds 10 and 11 are CLOSED.
- **S1a LANDED (7dc1146 + WELD 78ee564): GET /v1/scenarios SERVED
  COLD, CONTRACT 1.4.0; TWO REDESIGN RULINGS BANKED; LIVE STACK AT
  HEAD; ROUND 12 DISPATCHED (16:30 Aug 2)**: S1a serves the committed
  scenario set with NO batch dependency (the Lab's listing no longer
  waits on a run); wireScenario = struct { wireScenarioDef; Results }
  embed IS the serializer weld; contract 1.3.0 → 1.4.0 additive,
  carrying engines[] and shocks[].axis (load-bearing for the Lab
  matrix's not-covered ≠ withheld distinction); client scenarios() +
  ExactlyEqual type weld; web proof-contract weld regenerated
  (78ee564). Two implementation-ready rulings banked on task #25: (a)
  DISTANCE/HEADROOM — one native distance per engine; headroom % =
  (threshold-value − debt)/threshold-value with truncating bigint
  helper; 7 bands (breached/0–2/2–5/5–10/10–25/25–50/>50); DM HF-
  disclosure and Engine columns struck; price-path demoted to
  hover/Inspector/Lab; sort renamed headroom with liq_distance as
  deprecated alias (next contract bump 1.5.0 — S1a took 1.4.0); new DM
  ORDER BY on USD headroom ratio; factor_symbol populated server-side;
  the partial page-scatter dies; one hoisted auto-started walk;
  WARN_HEADROOM_PCT=10. (b) SCENARIO DASHBOARD — whole-book-first Lab
  (owner: "watch the charts change under different scenarios");
  /v1/book waterfall proven byte-identical to run-book at same factors
  (batch 6) → loss frontier ships cold; labDek cliff sentence;
  LabMatrix scenario×engine grid (5 cell states, single-batch guard);
  book mode default, no auto-run on bare arrival, ?scenario= deep-link
  auto-runs; debt_manager becomes the default engine; B-splits: B1
  before/after EngineHistogram, B2 movers[] (Aave by HF drop, DM by
  debt-became-eligible), B3 collateral_by_asset. OPS: api-78ee564.exe
  live on :8080 (GET /v1/scenarios serving; rev 6 / schema 19), web
  rebuilt + restarted on :3111 at HEAD. CODEX ROUND 12 dispatched over
  016cc31..78ee564 (R4 freshness math, S1a cold-path honesty, contract
  triple-drift). NEXT: on SHIP → the two implementation waves on opus
  serena-coder agents (headroom edit-list A first — ships value alone;
  dashboard split A next); then riskd-as-a-service (the HF-History
  sparseness root cause: batches only exist from manual -once runs);
  W3 deploy checklist behind the owner's VPS + domain.
- **riskd IS A SERVICE; R5 + W-HR-A + R6 LANDED (22ab9e9, 58db6d6,
  a8a5937); ROUNDS 12–14 EACH NOT-SHIP → EACH CLOSED (19:15 Aug 2)**:
  riskd's daemon loop already existed (runLoop, 2s vector poll, 5000
  retention) — the HF-History sparseness was purely operational, batches
  only ever came from manual -once probes. riskd-aad8a36.exe now RUNS
  (first daemon batch #7: 9,848 positions, 0 refused; ~2/min cadence off
  the indexer's 60s price polls; ~42h of history at retention). ROUND 12
  NOT-SHIP (2 MED, both R4 freshness): equal-integer wire ages could not
  re-anchor a NEWER receipt (fresh batch rendered with the old
  accumulated age), and a sleep + backward wall-step killed both deltas
  so the resume reconcile never fired → R5 22ab9e9: re-anchoring keyed
  on the RECEIPT (served_at + batch id, threaded through posture and
  all three call sites); persisted-pageshow and hidden→visible are
  DEFINITIVE evidence that outranks both clocks, burst-coalesced via
  consumable away-evidence + an echo guard. W-HR-A 58db6d6 (25 files):
  the owner's "never on real debt" and "useless map" findings die
  together — HEADROOM is the book's native distance on both engines,
  one formula over the HF's own rational pair ((num−den)/num; DM:
  maxBorrowLT/borrowings, Aave: wad/1e18), floor display + exact-bigint
  7-band scale, liq-distance column replaced, Engine and DM
  HF-disclosure columns struck (price-path demoted to the cell hover,
  legends per engine), the risk map bins the FULL book by band above
  the table, page-scatter deleted, ONE hoisted auto-started walk at the
  contract-max page size, debt_manager the default engine. The
  auto-walk surfaced a FIELD DEFECT: at 200/page every walk was
  outpaced by the daemon's cadence and looped forever (550 requests/55s,
  zero maps) — WALK_LIMIT=1000 beats the cadence (~4s), and after 3
  supersessions the walk refuses OUT LOUD (outpaced state; splicing or
  drawing the partial would both lie), with a walk-again affordance
  only in that state (integrator-accepted). ROUND 13 NOT-SHIP (2 MED):
  blind wakes (definitive evidence, neither clock certifies) left the
  ribbon fresh over hours-old data (no repair path; idle heartbeat SSE
  never re-receipts) and a failed resume fetch CONSUMED the only proof
  of missing time → R6 a8a5937: the UNRESOLVED-RESUME state — the hook
  returns {seconds, unresolved, refreshFailed}; while unresolved the
  AGE is withheld (never the book), repairs are OBSERVABLE
  (Promise<boolean>) on a bounded 0/+5s/+15s schedule then disclosed as
  failed, posture.refresh() reopens the stream so the ribbon can repair
  at all, and the ONLY discharge is a new receipt. ROUND 14 NOT-SHIP on
  W-HR-A (1 HIGH + 3 MED): DM's "Headroom ↑" actually ordered by
  absolute USD room (130 live adjacent ratio inversions in the first
  1000 rows — comment-only disclosure fails the bar), exactly-50%
  banded as ">50%", the map header could pair batch N's map with an
  N+1 count, and 409 restarts kept stale walked-N progress → W-HR-B IN
  FLIGHT, the atomic 1.5.0 train: store ratio ORDER BY behind a real
  `headroom` sort key both engines (liq_distance a deprecated alias
  that keeps its OLD ordering — an alias that reorders is a lie),
  additive contract 1.4.0→1.5.0, DM factor_symbol populated
  server-side, client regen byte-identical, web adopts the true key and
  drops the interim disclosure, ≥50%/at-least-half relabel under the
  one left-closed band rule, batch-guarded map count, zeroed restarting
  state + true supersession count. Round 15 reviews 58db6d6..W-HR-B.
  AGENT-OPS (3rd/4th occurrences): codex-reviewer agents park on
  background monitors instead of polling — the synchronous-poll nudge
  is now standard; round-14's findings had to be recovered from the
  plugin's job-state JSON when the agent's final message carried only
  metadata. Web waves are SERIALIZED by law now: one working tree, one
  .next, one :3111 — R5's e2e needing a fresh build explains the 17:01
  server death (the wave stopped it deliberately; subsequent waves get
  that permission explicitly with disclose-and-leave-running terms).
- **W-HR-B LANDED (06b2bcd); ROUND 15 NOT-SHIP (2H+2M) → W-HR-C
  (69993d6) + R7 (e909d33) CLOSED IT; W-SD-A LANDED (8046c95) — BOTH
  OWNER RULINGS ARE LIVE; ROUND 16 DISPATCHED (22:00 Aug 2)**: W-HR-B,
  the atomic 1.5.0 train — store PositionSortHeadroom (DM exact-ratio
  ORDER BY; aave shares the hf fragment by identity, test-pinned),
  liq_distance DEPRECATED-BUT-SERVED with byte-unchanged ordering,
  additive contract 1.4.0→1.5.0, client regen 320/320, ≥-relabel,
  batch-paired map count, 409-zeroed progress. Live proof: the old
  key's 130 adjacent ratio inversions → 0 under headroom across all
  9,804 rows. The brief's factor_symbol clause was FALSIFIED live by
  the wave (1,484/1,484 DM distance rows already carry it — a sampling
  artifact) and PINNED with a test instead of a fabricated fix. ROUND
  15 NOT-SHIP: (1H) the WEB normalizer silently rewrote liq_distance
  links to headroom — the server kept the alias law and the web
  defeated it; (2H) headroom desc ranked refused/NULL-capacity rows
  FIRST (unknown-as-maximal) and the W-HR-B fixture LOCKED the wrong
  sequence; (3M) the unavailable ribbon's stale_since_seconds froze
  forever (no receipt, no anchor, no repair); (4M) LIVE·WATERMARKED
  painted over dead connections (streamState/hasBase ignored). W-HR-C
  69993d6 (Go, parallel with W-SD-A): unknowns-LAST both directions on
  both engines — aave desc UNSHARED from the hf fragment (hf desc has
  the same unknown-on-top shape but keeps its exact bytes; the alias
  law binds pre-1.5.0 keys), hf_infinite ruled a KNOWN 100% maximum
  that leads desc, every fixed pin proven failing against the old
  fragments, desc cursor continuity added, and the identity test made
  non-vacuous in both directions. R7 e909d33: liq_distance links are
  HONORED as sent under a standing named register (no header claims
  the honored order; one click moves to headroom; the URL mirror keeps
  the token — deleting it would be the lie in reverse); the
  unavailable frame's staleness is an anchored AGE on its own
  served_at receipt (ticks, clamps, blind-resume unknown,
  posture.refresh() repair; the two receipts mutually exclusive so the
  bounded repair spend never doubles); the Ribbon's live mode is a
  DISCRIMINATED UNION — LIVE unrepresentable without an open
  connection whose base arrived, reconnect states render over retained
  data, and 8 prior specs that asserted LIVE over hung streams were
  corrected without weakening one age/data assertion (the new r7 e2e
  runs a real Node SSE server so LIVE-only-after-base is observable);
  the openapi dir description gained the headroom exact-reverse
  carve-out W-HR-C flagged (documents landed behavior, no bump).
  W-SD-A 8046c95 (25 files): the Scenarios page arrives ALIVE with
  zero runs — computed cliff dek from /v1/book's waterfall (live:
  "Nothing new becomes liquidatable until ETH is down 20% — then 28
  accounts on debt_manager cross. By −50%, debt_manager's Σ eligible
  debt reaches $1,877,357.29 and its bad debt $28,878.79"; baseline
  census never a cliff; engine sums compared never added), LabFrontier
  per-engine panels with per-SERIES cliff lines (the book's cliff
  painted everywhere told the reader aave breaks at −20% when it
  breaks at −40%), LabMatrix committed×engines with SEVEN honest cell
  states (superseded + unanswered added beyond the ruled five, both
  honesty-forced and integrator-accepted), newest-batch cohort anchor
  (~2/min daemon supersession is the DESIGN CASE now, not the edge),
  pickDefaultScenario and the outcome-harvest deleted, ?scenario=
  deep-link auto-runs, address mode demoted to the secondary register.
  B-splits confirmed to need API waves: run-book serves no post-shock
  histogram, no movers[], no collateral_by_asset. OPS: the full stack
  serves e909d33 (api swapped thrice through the leg; web rebuilt per
  wave; riskd past batch #460). ROUND 16 dispatched over
  06b2bcd..e909d33. Tallies at HEAD: web 577 passed/1 pre-existing
  skip; client 320/320; store+api Go suites ok.
- **THE POLISH TAIL: ROUNDS 16–24 EACH NOT-SHIP → EACH CLOSED SAME
  SESSION (R8 3c37daf, R9 a5a0f90, R10 f716504, R11 99dfbd5, R12
  55668cd, R13 7a393e2 + R13b f342239, R14 d0ef33d, R15 12ce7ca, R16
  b74f334); ROUND 25 IN FLIGHT (05:45 Aug 3)**: the finding class
  narrowed every round — wrong DATA (rounds 12–15) → wrong SENTENCE
  over right data (16–19) → two right sentences CONTRADICTING when
  composed (20–24). R8: hf honored with its DIRECTION (the alias
  dropped dir — a highest-HF bookmark served least-headroom-first);
  monotonic cohort anchor (running is not an eraser); shape-C bad-debt
  clause de-vacuoused. R9: the as-of claim separated from the
  watermark floor; solvency ranges EVERY served engine — the lead-only
  blind spot was LIVE on the committed fixture (dek named aave's
  $2,190.48 while DM carried $2,219.80 unmentioned). R10: the matrix
  header rebuilt as a five-clause truth table over NAMED displayed
  sets (round 19 machine-enumerated 8,192 combos → 82 arm classes and
  found ONE false arm left). R11: a served book that names nobody is
  not a displayed result (all-hole rows: own set, no pin, no floor
  movement; hole outranks supersession). R12: nothing is classified
  before it is validated (bookRefusal: self-contradicting books
  refused whole; definitionSkew: id+version+config identity join,
  DERIVED against the current listing so a refresh heals it). R13:
  the cohort speaks only for RENDERED rows (listedPhases filter,
  never prune — a listing read must not destroy a measurement); one
  banner derivation for both surfaces. R13b (integrator-direct): a
  retained all-hole book is never called a measurement — and TWO
  process lessons: a truncated reporter tail hid a failure section
  (dot reporter + --list count now standard), and the R12 gate
  correctly refused my mispaired test fixtures. R14: attempts carry
  the identity they were ASKED under (stamped at dispatch; a v1
  failure can never resurface as a re-listed v2 row's attempt); the
  detail panel says what the banner promises (BookAllHoleView; the
  completeness line's gate was wrong in GENERAL — partial holes
  passed excluded_engines.length===0). R15: a request still out is
  never told to re-run (running/settled split on one published flag).
  R16: the settlement carries its own provenance (RerunFailure
  {reason, attempt} — banner and skew structurally unable to
  disagree; a presented retained body outranks a stale stamp, a
  refused one has nothing to outrank with); the legend speaks all
  three truths. Suite 480 → 715 tests across the tail; every wave
  sensitivity-killed its own fixes; zero honesty assertions weakened
  anywhere. AGENT-OPS: reviewer stall-nudges needed rounds 20/21/24
  (running count: 7); reviewers self-hardened — detached pinned
  worktrees from round 16 on (two empty locked leftover dirs,
  C:\swt-r19 and C:\tmp\sv-r20, cleared on reboot); one wave killed
  mid-response by an API server error and resumed in place with its
  context intact (R9). Full stack serves b74f334; riskd past batch
  #900; round 25 reviews 12ce7ca..b74f334.
- **ROUND 26: SHIP — THE REVIEW TRAIN IS CLOSED (07:06 Aug 3)**: round
  25 found the INVERSE of round 24's sequence (a v2 rerun failing
  bodyless over a retained now-skewed v1 body read as "Nothing failed
  — refresh a listing that was already current"; the root: attemptSkew
  returning null for two different truths) → R17 a7dced9 made the
  settlement disposition EXPLICIT (settlementOf: defer | attempt-skew
  | current-bodyless; a current-definition bodyless failure classifies
  through R10's own UNANSWERED register with the retained refused body
  disclosed at its own pin; every boundary an explicit arm; the
  collapse mutation reproduces the finding's header verbatim in unit
  AND browser). ROUND 26 over 4172061..a7dced9: **approve, zero
  findings** — "no substantive honest-user wrong-answer,
  silent-corruption, false-pass, or vacuous-green finding is
  supported." ROUNDS 12–26: FIFTEEN adversarial rounds, every finding
  fixed-and-verified same session, the last range clean. FINAL STATE:
  HEAD a7dced9; web 727 passed / 1 pre-existing conditional skip (728
  listed); client 320/320; store+api Go suites ok; contract 1.5.0;
  full stack live at HEAD (:8080 api-e909d33 binary — Go unchanged
  since — :3111 the R17 build; riskd daemon past batch #900,
  0 refused-engine batches, HF History dense). Both owner rulings
  SHIPPED AND REVIEW-CLEAN: headroom as the book's native distance,
  and the whole-book scenario dashboard alive on cold arrival.
  REMAINING QUEUE (new work object territory, not this train): the
  B-split API waves (post-shock histogram, movers[],
  collateral_by_asset — confirmed absent from the wire), contract
  1.6.0 for them when designed; the W3 deploy checklist behind the
  owner's VPS + domain (spec §12); npm publish @solvent/client;
  README/demo path; the deferred report-only surveys
  (handleAddressHistory three-instant read; riskd previousPrices).
- **THE B-SPLIT TRAIN: CONTRACT 1.6.0 SHIPPED AND REVIEW-CLEAN —
  ROUNDS 27–34, ROUND 34 SHIP (19:20 Aug 3)**: owner said "go ahead
  with the bsplit" and the train ran W-BS-A (24809c4, the atomic
  1.6.0 feature wave: hf_histogram on both RunBookAggregate sides
  with the bucket law EXTRACTED to one function shared with the
  serving surface; movers[] ranked by each engine's own verdict —
  aave HF-drop in wads, DM debt-that-flipped-eligible — cap 20 named,
  movers_total=flips-only pinned against the net count; and
  collateral_by_asset keyed by asset AND disclosure, the unpriced
  premise falsified live: ErrMissingPrice refuses the whole position,
  so the reachable unknowable is a live balance with collateral
  disabled and no witness, value_usd null never "0"; all derived in
  the ONE existing measure walk; run-book persists nothing; web:
  before/after pair on ONE count scale, movers table, breakdown, all
  downstream of the R11–R17 gates), then EIGHT adversarial rounds and
  seven hardening waves on its test surface: W-BS-B e2c56ce (coherent
  fixture book, net-honest copy, links that go where they claim,
  disclosure-keyed rows, the mixed-direction DB fixture whose DM
  analogue was PROVEN unconstructible from honest rows and rode as
  the control); W-BS-C 43c287e (a fixture may only claim what the
  evaluator could serve: the declared-asset construction from the
  registry's own propagation row, the Aave engine RE-MEASURED from
  committed bytes with the 8100-reproduces-both-rationals proof, the
  7-law propagation guard with mutants refused on every generation
  run); W-BS-D 0c6d06a (the guard learns CONSERVATION: only prices
  move); W-BS-E b0cbc53 (ANCHORING: a body cannot vouch for itself;
  frozen exemption sets that demand their own deletion when the
  recorded defects repair); W-BS-F 752ff9b (the guard RE-DERIVES from
  frozen sources through its own arithmetic — two pens; the frozen
  literals re-proved against their provenance every run); W-BS-G
  e817ea6 (the user-visible fields join the derivation; the empty
  mover loop that DISPROVED a disclosed fallback belief is watched;
  both pens stop sharing a file); W-BS-H 81a13a4 (THE COMPLETENESS
  LAW: every leaf DERIVED, ANCHORED, or ENUMERATED-UNPINNED-with-
  reason — the unpinned register is ONE entry, served_at; the
  sanctioned class-C bucket repair; the coverage statement names its
  limits); W-BS-I 6aec405 (round 33 falsified "no third path"
  honestly — a leaf FILED IN THE WRONG REGISTER served $400 of
  execution shortfall over zero eligible accounts; realization money
  moved to DERIVED via closed-form identities of production's own
  arithmetic, the $620 bad debt the example zeroed now served
  honestly, the full 43-entry ANCHORED audit under the stated test,
  and LIMIT (iii) — the register assignment itself — written into
  the coverage statement rather than papered over). ROUND 34: SHIP,
  zero findings — the closed forms, the chain-10 registry mismatch,
  all 38 anchored reasons, law 18, and the mutant isolation ALL HELD.
  THE GUARD'S END STATE: 51 named-reason mutants with mechanical
  uniqueness; an exact 137-pattern partition; the two-place
  literal+provenance floor; the deliberately malformed fixtures
  enumerated with reasons; register misassignment mitigated by a
  stated test and a written reason per survivor. THE CONTRACT-DEFECT
  LEDGER (all found by the derivation, none this repo's fixtures'
  fault, all self-enforcing or banked for ONE example-repair wave):
  (1) the run-book example's held_flat:[] where production names
  every input; (2) its aave histogram bucket vs the contract's own
  /v1/params LT; (3) its DM census vs its own threshold (0.6926 drawn
  as 0.90–1.00); (4) its market_realization.note matching no engine's
  serializer; (5) its $400 shortfall over zero eligible accounts.
  Tallies at HEAD 6aec405: web 759/760 (1 pre-existing conditional
  skip); client 320/320; store+api Go suites ok; contract 1.6.0
  everywhere; full stack live (api-24809c4.exe — Go unchanged since —
  :3111 at HEAD; riskd daemon past batch #1500). REMAINING in W3:
  the contract-example repair wave (five ledgered defects, exits
  armed); the deploy gate (owner: VPS + domain, spec §12); npm
  publish; the deferred report-only surveys. AGENT-OPS note for the
  record: one wave deleted a stale 171-byte untracked server log
  (web/r15-server.log) misjudging its provenance — disclosed
  immediately, no tracked file touched, no recovery possible or
  needed.
- **THE EXAMPLE-REPAIR ARC: THE CONTRACT'S OWN EXAMPLES BECOME LAW —
  ROUNDS 35–39, ROUND 39 SHIP (00:54 Aug 4)**: owner said "do the
  example repair wave" and the arc ran four waves + one amendment.
  W-EX-A 4c8b4ad: the run-book 200 example became A BODY PRODUCTION
  ACTUALLY SERVED — TestRunBookExampleIsAServedBody seeds the
  example's own book through the production writer, runs the real
  handler, and asserts the yaml equals the served body modulo four
  NAMED serve-time fields, proven failing against the old example
  first; all FIVE ledgered defects discharged plus a SIXTH found in
  repair (the DM's mainnet weETH address on chain 10 — which had been
  silently load-bearing for an earlier guard proof); two derivation
  errors in the generator corrected against production; every armed
  self-enforcing exit fired and every dead licence deleted; the
  defect ledger EMPTIED. W-EX-B 2178014: the five-second lie died
  (sweep age 1200→1205; the normalizer DERIVES ages from the body's
  own bytes and asserts temporal coherence against the served body
  AND the document; ROOT CAUSE NAMED: generator law 14 and the
  example each vouched for the other's wrong reading), the
  /v1/positions example and a hand-built client body fixed, and NEW
  example-clock.test.ts re-derives every stated age in the whole
  contract beside its own timestamps (9/9, teeth proven by path-named
  failure) — the class closed document-wide. W-EX-C 27febe1: clocks
  need PROVENANCE (the served body bracketed by the database's own
  SELECT now(); raw stamps read back from the seeded rows; the
  regressed-anchor mutant proves coherent-but-understated fails the
  bracket), CENSUS (the walker classifies before it filters — 12
  roots, 13 candidates, 8 checked, pinned; it caught its author's own
  root-list guess), and EXACTNESS (BigInt-nanosecond RFC3339
  arithmetic reproducing Go's clamp-then-truncate; the refuted naive
  parse kept in-file as evidence: 1205 vs 1204n on the sub-millisecond
  boundary); the ONE wrong byte a demo user could SEE — the feed
  snapshot's 1200 in the ribbon over SSE — was stale generator OUTPUT
  (the contract was repaired and nobody re-ran the generator), fixed
  along with inspector.ts's same defect behind the same verbatim
  claim; clock-law.mjs became the ONE arithmetic imported by both
  generators; the three .batch2 impossible ages derived to the only
  servable value under a narrow law whose scope boundary is recorded
  in three parts. W-EX-D 90fd29c + amendment 7561ebc: the clock law
  joined the path every suite run takes — fixture-clock-law.spec.ts
  imports the REAL module by file URL (surface pinned), walks every
  committed fixture with the list derived recursively from the
  directory (the amendment: round 38 caught the flat readdir; the
  recursion is now proven at three depths in a synthetic tree, and
  the nested regression fails five ways by relative path), reads the
  generators' own pins out of their source with the extraction yield
  itself pinned, and mutation-proves the module's own exports.
  ELEVEN fixtures from generators with no clock guard are now
  permanently watched. ROUND 39: SHIP, zero findings — the synthetic
  proof invokes the same collector, everything fails closed. THE ARC'S
  LESSON, in one line per wave: an example is a claim the server must
  be able to make; a law and its example must never vouch for each
  other; agreement is not provenance; and a guard that only runs when
  someone remembers to run it is not a gate. Tallies at HEAD 7561ebc:
  web 827/828 (1 pre-existing conditional skip); client 344/344 (15
  files incl the two new clock suites); cmd/api ok with the three
  standing example tests; generators idempotent (50 mutants, 26
  trios); contract 1.6.0; full stack live at HEAD (api-2178014.exe —
  Go unchanged since — :3111 current; riskd daemon healthy).
  REMAINING IN W3: ONE banked ticket (generate-book.mjs stale outputs
  — book*.json missing EngineBucket.sweep since 1.2.2, seen from both
  sides, not user-visible today); the two deferred report-only
  surveys; and THE DEPLOY GATE (owner: VPS + domain, spec §12) →
  scoped DB roles, npm publish @solvent/client, README/demo, the
  stranger walk, P5 exit review, P4 entry per D-014.

## 2026-08-04 — THE OWNER-UI TRAIN: HUMANIZED COPY, CHARTS REBUILT AS INSTRUMENTS, THE ETH LADDER COMPLETED (rounds 40–45)

Owner opened with two chart complaints and three directives: humanize all UI copy, adopt the full Codex design audit, extend the ETH scenario ladder. Landed, in order: W-COPY 998d977 (humanizer sweep, 95 files, seven disclosure laws preserved; R40 NOT-SHIP x2 fixed in b950f61 — one of the two was the sweep asserting facts about unavailable values). Chart spec v4 committed as canon 9449b38 after a three-round design/Codex convergence (compressed sub-$1 lane, count fill + debt marginals, transposed exact ledgers, seven-slot section template with the refusal fence; LAW-1 repricing note: entering debt is never a monetary derivative). W-SC-A c780b2c: committed eth_minus_40/50/60 (propagation graphs hash-identical, deep-rung out_of_model blocks), frontier re-pointed to eth_minus_60 x 7 points, closing the live gap where -50 was served under -30's disclosures; R41 NOT-SHIP x2 (override bypass; vacuous factor tests) fixed by W-SC-B 196356a (startup tail-rung equality in exact rationals, .env.example corrected, all six rungs pinned to num/den and applied output; R42 SHIP). W-CH 3a83e44 implemented spec v4 in full (+92 tests; two honest deviations incl. the spec's own impossible 3:1-at-0.30-opacity); R43 NOT-SHIP x6 (zero-vs-hole frontier claim, sub-$1 bin overlap, quantitative floors on marginals and shares, vacuous AC-54, over-scoped zero copy) fixed by W-CH-B 57b37f6; R44 NOT-SHIP x2 (1e-6 truncation cliff swallowing presence dots; AC-54 blind to same-width wrappers and 2x scale) fixed by W-CH-C a7e9009 (exact-quantity branching, named-frame scroll audit, forced .mapLedger scroller); R45 SHIP, no findings, arithmetic re-derived. Spec-phase artifacts for the adopted Codex program banked at d900de4 (two DRAFT contract specs with 9+16 adversarial findings attached; 70-surface three-layer inventory; seven-views feasibility with confirmed Sankey/tornado server gaps). Suite 828 -> 933 web tests; live: api-196356a.exe (15 scenarios), :3111 at a7e9009. Standing reds noted for triage: internal/config, internal/prices, internal/pipelinereplay (pre-existing, proven at HEAD).

## 2026-08-05 — CONTRACT 1.7.0: THE TRANSITION MATRIX AND THE BATCH-PINNED SET-RUN (rounds 46-54)

The owner-adopted Codex program's server half, spec-first end to end. Two contract specs survived three internal adversarial revision rounds (33 findings closed) then the formal Codex gate: R46 NOT-SHIP (4 findings: cause split lost before the wire, missed web changed-law, fail-open census, chain identity dropped) -> REV4 56661f1 -> R48 SHIP both. W-TM f85c564 implemented the transition matrix (hf_transitions, fail-closed unmeasured split, 22 Go laws, example captured byte-identical to prediction, generator derivation with reconciliation law); R49 NOT-SHIP x1 (fallback arithmetic across two censuses) fixed by W-TM-B bbad9a8. W-BP 2e1f679 implemented the set-run (one snapshot x N scenarios, fail-closed census, {chain_id,asset} held-flat identity, 33 Go laws); R51 NOT-SHIP x5 (More() EOF, fixed-cause sentence, parsed-not-bytes determinism, missing two-chain discriminator, null==null equivalence) fixed by W-BP-B 4bbb8ac; R53 NOT-SHIP x1 (declared-factor cause omitted in mixed compositions - a PRE-EXISTING false cause the train progressively exposed) fixed by W-BP-C 2dbff8e; R54 SHIP, seven compositions traced, no findings. In parallel the three-layer rollout landed (W-3L 88a6baa, 12 surfaces + 3 primitives) and its review train (R47 NOT-SHIP x3+vacuous gates -> W-3L-B 538fe5c compile-guarded state equality; R50 -> W-3L-C 3e6f177 answer welds; R52 found fixture symmetry made 7 welds false-green -> W-3L-D ab224da asymmetric fixtures, all mutations killed at call sites). The weld drift gate caught an integrator miss (W-BP-B example note landed without proof-weld regen) and was repaired in ab224da. Suite: web 933 -> 1043, client 344 -> 347, cmd/api +55 laws. Live: api-2dbff8e.exe serving 1.7.0 (hf_transitions + run-book-set probed on the real book), :3111 at ab224da. Remaining in the program: Sankey/tornado views, W-3L leftovers (Observatory/Inspector/Feed/Proof, Lab dek hoist), seven views, deploy gate (owner).

## 2026-08-05 — THE OWNER VISUAL TRAIN: EYES-ON REPAIR, THE SANKEY, THE TORNADO (rounds 55-61)

Opened by the owner rejecting the rendered page outright ("does this look ready to present to the world and hiring staff? I want you to fix this yourself") after nine chart waves had landed on green suites without anyone looking at the page. THE MODE CHANGE THAT DEFINES THE ARC: implementation may delegate (owner later re-allowed fable agents), but every chart and section is verified on the RENDERED PAGE at 1440 and 900 by the integrator before landing - test-green is not the bar for visual work. What eyes-on caught that no suite did: the serif plague's real root cause (the STALE PRODUCTION BUNDLE predated the --sans token, so var() fell to UA Times on every prose surface - a rebuild cured two pages at once); the risk-map ANSWER claiming the plotted sum as "the book's"; tornado row labels left-clipped because the mono probe measured without .axisLabel's 0.06em letter-spacing; and beneath that fix a latent LAW-3 break where fractional chart widths device-snap to x0.99988 and render 12px type at 11.9986px (frontier slots now CEIL to whole CSS px). Landed, in order: W-VR 8eb1f12 (all nine diagnosed defects: mono ANSWER, ONE computed sentence, nonempty cells only, callouts deleted outright, padding-corrected measured width, plain sub-dollar lane, $-unit dust copy, deduped STATE stack, single-line waterfall ticks with the all-dust fact relocated to a gated disclosure); R55 NOT-SHIP x2 (composed panel still said "the book's" beside "mapped here"; all-dust rung identity rode the truncated percent so x0.9999/x0.9998 collided) fixed by W-VR-B e34d5d9 (identity by exact wire factor, factor-led residual ticks, kind+index keys, the collision pinned). W-SK e0e8db2 filled the transition panel's VISUAL slot with the flow: one ribbon per outflow cell from transitionRibbons, one linear scale, held/changed/unmeasured registers, crit tint under the comparator asymmetry - verified against live whole-book runs where the dense DM matrix (9,881 rows, 1,051 changed) reconciled margins, ledger and the crossing ANSWER on screen; R56 NOT-SHIP x3+1 (floor equivalence interval vs the "linear" claim; one-ended-unmeasured cells drawn as movement; vacuous rendered-geometry tests; flow/ledger tint contradiction) fixed by W-SK-B 9fb23aa (computed floor disclosure, XOR-unmeasured refusal with the margin-preserving mutant, computed-style geometry laws, tint adjudicated to the ledger's read: every hf_wad below-1.00 arrival is crit, held rows keep the mute). W-TN 9a4f599 built the tornado per rev2 sect 9.2-9.6 (explicit-ids dispatch, N-phase fan-out, the axis law rendered through tornadoCells, cohort rule, composed header, run-book-set fixture family from the contract's own examples); R57 NOT-SHIP x9+3 -> W-TN-B 7c5032b (dispatch-bound set gate, COVERAGE SKEW + unlisted refusals, 200-settle restores matrix history EXACTLY with true idle and original stamps, refused results out of every count, projection/market-realization as real ledger rows, bounded bigint ratio, tornado floor disclosed, drawn counts rects, per-kind token binding, kind-keyed non-standard-index law, dispatch-time notices, real axis-side law + de-confounded causes); R58 NOT-SHIP x7 -> W-TN-C 8d3f910 (duplicate-id refusal, set-dispatch concurrency forbidden at the source, block rows carry out-of-model, per-answered-engine mandatory blocks, EXACT cross-multiplied ordering with the float demoted to width-only, past-tense dispatch notices, causes 7/4/2 with distinctness asserted over committed bytes); R59 NOT-SHIP x3 -> W-TN-D 1137732 INTEGRATOR-DIRECT (runBookSet made rejection-free via the refused-locally outcome arm - type-excluded from row outcomes, priors restore, the honestly-reachable ETH_down trigger proven end-to-end in the browser; engines:[] routed to no-answerable-engine instead of slandering a legal body; three omitted counts added to the anti-confound); R60: A and B CLOSED, C survived (positions_answered and engines[].accounts BOTH equalled the arithmetic cause at 2 - a live false-green window) -> W-TN-E 0304c5e (the law walks the FULL wire shape, 30 named figures in generator refusal AND committed-bytes law, causes reshaped 7/4/5 through three more committed chain-10 rows, a PERMANENT self-test re-installing the exact r60 escape at every generation); R61 SHIP - enumeration proven complete against the schemas, the 30 figures recomputed independently, the self-test proven non-vacuous by gutting the enumeration, zero new findings. THE ARC'S LESSON: a suite proves the numbers and the page proves the picture, and the two lie independently - the stale bundle, the clipped glyph and the sub-pixel snap were all invisible to 1,153 green tests. Tallies at HEAD 0304c5e: web 1043 -> 1152/1153 (+1 pre-existing skip); nine waves, seven Codex rounds, zero weakened assertions on the record; flake watchlist now r5-fixes:133, book-charts:880, chart-spec-v4:1477. Live: api-2dbff8e.exe (1.7.0) :8080, :3111 at 0304c5e, the Sankey and the tornado both driven against the real book on the rendered page. Remaining in the program: W-3L leftovers (Observatory/Inspector/Feed/Proof, Lab dek hoist), seven views bank, matrix-side set-run disclosure beyond the set-aware empty state, tallyAt kind-keyed tallies, the three-mirror enumeration weld, and THE DEPLOY GATE (owner: VPS + domain, spec sect 12).

## 2026-08-05/06 — THE FULL-APP AUDIT: EVERY CHART EYES-ON, TWO INSTRUMENTS REBUILT (rounds 62-64)

The owner's follow-up to the visual train: "have a look at all the charts etc throughout the app... make sure everything looks up to par." The integrator drove every surface on the rendered page at 1440 (900 where geometry mattered): Feed, Proof Center, Developers, the Inspector position card, the lab one-address register, the loss frontier on both engines, the aave book view (whose ANSWER sums cross-checked exactly against its band totals, again), and the light theme on the book and the transition flow — all at the bar. TWO pre-spec-v4 charts were not: the Observatory time-series (four panels of honest registers with NO y-scale beyond the zero floor, NO time axis and NO direct values — blank boxes under sparse capture) and the Inspector HF-across-batches sparkline (NO labels at all, a fixed 700px line inside a 1225px panel, values hover-only, flat series pinned to the top edge). W-OBS 13e452a rebuilt both as instruments: y-max and newest-value labels sourced from the SAME formatters the cards and ledgers use, UTC bucket extents and batch-id extents on the x axes, measured width via the padding-correct probe, a padded domain that can never crop the 1.0 disclosure line, and a computed sparse-window STATE line — every honesty law untouched (gaps never interpolate, withheld never renders 0, the floor stays drawn); the integrator caught and fixed three placement nits eyes-on before landing (label-through-dot, duplicated timestamp row, newest label striking the line). R62 NOT-SHIP x4 (an older row's value printing unqualified as "newest" while the card showed the withheld dash — the committed DM fixture exercised it live; hfAxisLabel rounding UP at micro-boundaries while claiming truncation; one-source e2e laws false-green against hardcoded labels; one-point/flat series double-printing labels on top of each other) -> W-OBS-B f209d58 (qualified "(last captured {hour})" / "(batch {id})" arms composed in the pure layer, outward-directed bound labels, e2e expectations computed from fixture bytes through the pure helpers with a two-finite-point + flat fixture family, one-point-one-label and a displacement rule). R63: items 1 and 3 CLOSED, 2 and 4 survived sharpened (the 1e-9 fuzz-shed could still cross a 3dp boundary INWARD for an honest bound 4e-10 past it; the <12px collision band left the [12,14) ink-overlap interval uncovered) -> W-OBS-C 2a17b63 INTEGRATOR-DIRECT: the drawn domain bounds themselves land on thousandths, outward, with a 5e-10 shed and a 1e-6 pad floor — the labels render the drawn bounds VERBATIM, so label-vs-domain containment is identity and the data sits strictly inside by pad >> shed; the collision band widened to <15px with the boundary re-pinned at exactly 15. R64 SHIP: the containment inequality worked formally (>= 9.995e-7 clearance), bound recovery exhaustively verified across all 100,001 thousandth-integers to +/-50, displaced pairs proven outside the band on either side, zero new findings. THE ARC'S LESSON: a chart that renders honest registers is not yet an instrument — an instrument states its scale, its extent and its answer, and every one of those statements needs the same one-source discipline as a ledger cell. Tallies at HEAD 2a17b63: web 1153 -> 1183/1184 (+1 pre-existing skip); three waves, three Codex rounds. Live: :3111 at 2a17b63, api-2dbff8e (1.7.0) :8080. Remaining banked: observatory panels fixed-width-430 in their grid (LAW-3 measured width scoped out); the history wire's covered-window gap (x extents label the witnessed axis); sparse threshold <=1 by judgment (labelled 2-point panels read); the r64 NOTE on 1e13-magnitude no-reference inputs (unreachable in production, which always passes reference 1).

## 2026-08-06 — THE FIX TRAIN: EVERY STANDING RED RULED, THE WIRE'S PROVENANCE MADE HONEST (rounds 65-67)

Opened by the owner's ruling: no deploy before the rest of the fixes. W-FIX-GO 2989f76 ruled all eleven standing config/prices failures STALE PINS on one root cause (09d496e's deliberate, ledgered heartbeat widening after the B3 scan refuted the published 24h bounds; heartbeatRefuted disclosed on the wire ever since) and gated the arm-totality parent that fired a false red over an all-skipped map - the first fully green no-DB sweep of the phase (18/18). The pipelinereplay reds fell to a captured root cause, not a guess: migration 00013 was edited AFTER application (1d46925, violating the repo's own 00003 incident law once) and the harness's persistent derived DBs kept the pre-edit goose history, so 00018's backfill hit a table shape no fresh series produces; the three throwaway derivatives dropped, all three fork-replay legs green in 21s. W-FIX-WEB e11eb14 (its agent died at the fable quota mid-final-verification; the integrator reviewed the whole diff and re-ran every gate) root-caused the three standing e2e flakes as unsynchronized assertions - poll-then-reassert, never masks, the exactly-two law re-proven at test end - completed the W-VR dust-unit register across the whole surface (<$1 chips, "below $1" disclosures, thresholds composed through the one formatter so no caller can retype), and made tallyAt join histogram tallies by the lane's IDENTITY (label + both wad edges) with a new refusal for unserved bucket lanes. R65 NOT-SHIP x3 caught what the train had missed: /v1/meta still graded the CORRECTED budgets as refuted - an operator was told the active 84h USDC budget is falsified by a 248,460s observation that sits BELOW it - plus a label-only-join mutant surviving its claimed proof and unknown lane kinds silently skipping the margin check. W-FIX-META e3f3de1 shipped CONTRACT 1.8.0: the empirical-historical grade, the regrade with every retired refutation preserved verbatim as history, the re-tensed disclosure, and a seeded COHERENCE LAW binding every scanned row's verdict to its own served arithmetic (refuted iff gap > tested; tested == the row's own heartbeat + grace) with the fixture registry moved to production shape; welds regenerated end to end; the live :8080 swapped and probed coherent. R66 found the one place still telling the old story - the Developers page's PUBLIC /v1/meta sample, whose committed fixtures showed weETH as `verified` (a grade no feed can hold) and USDC unjudged on the retired budget - and W-FIX-META-B c11bc0b moved the fixtures, their byte-mirrored literals and the regenerated proof weld to the active story, then BOUND the sample to the same coherence law (three client-ts fixture laws; `verified` forbidden outright; the stale pin upgraded to twice its assertions). R67 SHIP: mutation power confirmed law by law against the old rows, the old-story sweep clean, zero new findings. THE ARC'S LESSON: a stale pin and a stale sample are the same defect at different layers - the record moved and something kept vouching for where it used to be; the cure is never editing the pin alone but binding every copy of the story to the arithmetic that makes it true. Tallies at HEAD c11bc0b: Go all green everywhere for the first time (no-DB sweep 18/18, DB-backed cmd/api + store, opted-in fork-replay 3/3); client-ts 347 -> 350; web 1186 -> 1187/1188 (+1 pre-existing skip); contract 1.7.0 -> 1.8.0. Live: api-r65meta.exe :8080 (rebuilt clean post-arc), :3111 current. Remaining in the train, in order: generate-book.mjs stale outputs, the three-mirror enumeration weld, matrix-side set-run disclosure, W-3L conversions (Observatory/Inspector/Feed/Proof, Lab dek hoist), the five remaining Codex-program views - and THE DEPLOY GATE LAST, per the owner.


## 2026-08-06 — Bank arc: book-fixture fidelity, enumeration weld, matrix g1 (rounds 68-72, R72 SHIP)

Three banked tickets closed integrator-direct, then a four-round hardening of the new gate. 4776475 regenerated generate-book.mjs's stale outputs (book*.json missing EngineBucket.sweep since contract 1.2.2 — client sources and live wire both had it; six sibling generators audited drift-free) and added book-fixture-fidelity.spec.ts: the generator re-run into a scratch dir every CI run, copies-equal-sources, the 1.2.2 defect pinned by name; clock census 56->59 (the engine-row sweep is a third verified trio). 2b40b7e welded the three-mirror anti-confound enumeration into tests/fixtures/confound-law.mjs — generator refusal, committed-bytes e2e law and unit mirror all import it; yield pinned (30 figures, unique names); deleting a figure refuses generation AND fails two specs. b6989f9 cured the W-TN g1 residue: every non-cold matrix header now carries the set-run aside (isColdCohort one-source; e2e negative-then-positive; eyes-on 1440/900 live, runs #11501/#11502). Codex then peeled four real escapes off the fidelity gate, one per round: r68 count-not-identity (b50922d, nine-name MANIFEST + orphan law), r69 the regex missing bare book.json (b7db160, predicate + manifest self-coherence), r70 singleton renames discarding ownership (5d77dbb, family patterns + append-only RETIRED through the real parameterized orphansOf), r71 whole-family retirement abandoning files (b62bbf4, EVER_WRITTEN append-only historical census — ownership by exact name, forever). R72 SHIP: remaining escapes require visibly violating the append-only doctrine, below the bar. THE ARC'S LESSON: an ownership law drifts exactly like the fixtures it guards — every name-based predicate was one rename from vacuous until ownership became exact history that only grows. Process note on the record: two mutation checks silently failed to apply through shell escaping and read as false passes; both were caught and redone with verified-write mutants — a mutant that did not provably land proves nothing. Tallies at HEAD b62bbf4: web 1188 -> 1197/1198 (+1 pre-existing skip); five commits, five Codex rounds (r68-r72), zero weakened assertions. Live: :8080 api-c11bc0b (1.8.0), :3111 at b6989f9 (later commits test-only). Remaining in the train, in order: W-3L conversions (Observatory plan banked in task #30; then Inspector/Feed/Proof, Lab dek hoist, CommittedDetail), the five Codex-program views, THE DEPLOY GATE LAST, per the owner.


## 2026-08-06 — W-3L conversions I: Observatory + Inspector-A (rounds 73-76, R76 SHIP)

The three-layer restructure reached its first two NOT-DONE pages, integrator-direct, across a PC reset (stack re-raised from cold: postgres, riskd, indexer, api :8080 probed coherent, :3111 rebuilt). W-3L-OBS 6414253 converted the Observatory per inventory 355-395: computed reading lines in lib/observatory-series (observatoryTakeaway with the gap tally riding BY LAW and a refused-newest arm that never leaks the prior bucket's numbers; gridReadingLine over first/last CAPTURED buckets; pointDetailTakeaway), the as-of stated once above the grid where four identical per-chart lines had stood, notes and drawing mechanics behind counted disclosures, the stampline keepOpen split, and the bucket record split answer-visible/provenance-counted with hazard rows (unacked epochs, unrecorded sweep, unstated-scale rates) surfacing OUTSIDE the fold exactly when they bite. W-3L-INS-A 45407a0 hoisted the Inspector's outcome sentence to the head beside the address (lookupTakeaway, FLOOR qualifier riding the found arm), split FoundBlock to hazards + wire-note disclosures, gave each HF history card a movement takeaway in the entries' own display strings (the DM arm says "disclosure ratio", never HF; absence reads at movement's weight), and gave activity an honest loaded-count takeaway with the liquidation extract folding only when fully established. Codex peeled four real escapes: r73 the hazard-placement weld proving only the safe fixture (47daed0: four closed-disclosure laws - visible + not-a-descendant + counted summary - mutation-proven by forcing the reorg row inside); r74 the takeaway calling an untimed tail "newest first" (fc86291: activityTakeaway split-claim arms - THE LIVE WIRE VINDICATED THE FINDING: the eyes-on account's five actions all carry null block_time, so the old sentence claimed chronology over zero custodied times) plus found-pins that stopped discriminating (six sites re-pinned 'outcome · found'); r75 the re-pins trading arm-specificity for a visibility hole - toContainText passes on hidden DOM (f1d7405: filter+toBeVisible at all six, the two not-found sites hardened unasked). R76 SHIP with three NOTEs, none material. PROCESS LESSONS ON THE RECORD: (1) full-suite tails read with tail -N masked failures above the summary - one pin sat red from its landing and several "green" readings were false; the standard is now grep '^  [0-9]+ (failed|passed|skipped)' plus a --list count cross-check, and it caught everything since; (2) playwright's e2e webServer REUSES :3111 (reuseExistingServer=!CI), so component edits demand rebuild+swap BEFORE any e2e read - two W-3L e2e runs had validated against the stale bundle. Tallies at f1d7405: web 1197 -> 1224/1225 (+1 pre-existing skip); four commits, four Codex rounds, zero weakened assertions (every moved pin got stronger: arm + visibility together). Live: :8080 api-r65meta (1.8.0), :3111 at f1d7405. Remaining: INS-B (position/formula/proof cards - in flight), Feed, Proof page, Lab dek hoist + CommittedDetail, five views, DEPLOY LAST per the owner.


## 2026-08-06 — W-3L conversions II: Inspector-B, the dense half (rounds 77-78, R78 SHIP)

The position card, the formula block and the proof card went three-layer at e08063e, integrator-direct. positionTakeaway/positionMethodLine (lib/inspector-lines) lead each card with the verdict, the number and the comparands in the ENGINE'S OWN vocabulary — the DM's strict boolean never wears an HF, Aave never wears the DM's comparands, a refusal IS the takeaway and invents no verdict — then the comparator + unit as the method line. The ledger splits on the hazard line: a price input whose verdict is not fresh, or with no chain-asserted as-of, stays OUTSIDE the counted fold (a stale price behind a fold is exactly the D-013 wrong reading); params stay out while the timeline is unavailable; legs, fresh prices, lawful params and collateral flags fold with every ExplainButton intact. The formula became the forensic archetype — the lawful substitution behind a summary NAMING the engine's law, the REFUSED substitution always open (a refusal that appears only when a reader opens the formula is a hidden refusal). The proof card now LEADS with the LIVE-vs-PROOF disclaimer that had sat last and dim — the sentence the whole Proof Center split depends on, never collapsible — with hazard arms (∅ never swept, no watermark, N unacked) outside and safe provenance counted. Codex r77 caught two real escapes: the unknown-engine fallthrough (every non-DM engine wore Aave's HF sentence while the method line claimed nothing — version skew could relabel a foreign comparator as HF; sealed-set branches + a no-claim arm at 0a8f521) and the r73 lesson RECURRING on the new card (the proof-card e2e proved only the safe fixture; three documented single-purpose mutations now prove each hazard renders outside the closed fold with the count following, 5/5/5, the hazard-branch deletion mutant 3/3 red then restored green). R78 SHIP, one NOTE (read-only checkout could not rerun suites). OPS NOTE ON THE RECORD: restoring a component mutant requires a :3111 kill+restart — the running server serves the mutant .next from memory, and the restore rerun stayed red until the swap. Tallies at 0a8f521: web 1224 -> 1235/1236 (+1 pre-existing skip); two commits, two rounds; the stale/fresh split pinned BOTH directions. Live: :8080 api-r65meta (1.8.0), :3111 at 0a8f521. Remaining: Feed conversion (inventory 397-430), Proof page, Lab dek hoist + CommittedDetail, five views, DEPLOY LAST per the owner.


## 2026-08-06 — W-3L conversions III: the Feed (rounds 79-80, R80 SHIP)

The Feed went three-layer at 78c486d, integrator-direct, per inventory 397-437 — the lightest conversion yet because two of its five sections were ALREADY at the bar (the live strip's law line and the ordering note ARE method lines; every notice/refusal/error strip already open), and the arc respected that instead of restyling for restyling's sake. What changed: feedTakeaway (lib/feed-view) computes the head sentence over the LOADED window — count, liquidation count, and a MODE-HONEST newest claim: a block where heights are the order (engine-scoped), a custodied header time where time is (cross-engine), and NO newest claim over an all-untimed or drift-suspect window (the r74 law generalized), with hasMore blocking the totality reading; the untimed-tail divider reduced to one line carrying its two hazards (the COUNT and "a timestamp is never invented") with the chain-aware-tiebreak rationale in a counted "1 ordering note" fold; the foot's method line keeps both custody clauses visible with the full prose behind "1 method note"; and the inventory's CONCRETE DEFECT fell — liquidationEstablished now auto-opens any extract carrying an unestablished field in all-actions view (both committed liquidation fixtures carry realized_bonus_bps null, so the defect bit on real bytes), mirroring the Inspector's extract law. The ORDERING DRIFT alert got its first in-browser exercise ever via a documented doctored-fixture law, and the divider pins were written visibility-first (getByText + toBeVisible) because the r75 lesson says toContainText vouches for text hidden inside a closed fold. Mutation-verified 4/4 at landing (drift-arm disable, takeaway deletion, auto-open revert, hazard-clause relocation) — one kill was masked in the combined run by an earlier assertion and was re-proven in isolation, which is the standing rule now: a kill you did not SEE fail at its own assertion is not a kill. Codex r79 NO-SHIP x1 medium, a genuinely new escape: under ordering drift the divider printed the TAIL-SLICE length ("2 rows without custodied header time") when only one row lacked time — splitUntimedTail's slice deliberately includes smuggled timed rows to preserve wire order, and the count rode the slice; 65fb1be tallies block_time===null rows for the divider text alone, the drift law gained the visible "1 row" regression pin, and the old code was re-applied as a mutant and went red on exactly that pin. R80 SHIP: count true in every reachable tail state, no other consumer surfaces the slice length, the regression discriminating, no material findings. DISPATCH NOTE ON THE RECORD: the r79 wrapper's first two Codex dispatches silently reviewed the WRONG RANGE (a shell-quoting corruption of --base surfaced as plausible-looking reviews of the Observatory and the Lab); both were discarded and the round re-run from a detached worktree pinned at the subject commit with a prompt file — a review whose scope you did not verify against the tool's own echo is not a review. Tallies at 65fb1be: web 1235 -> 1245/1246 (+1 pre-existing skip); two commits, two rounds, zero weakened assertions. Live: :8080 api-r65meta (1.8.0), :3111 at 65fb1be. Remaining: Proof page conversion (inventory 439-479), Lab dek hoist + CommittedDetail, five views, DEPLOY LAST per the owner.


## 2026-08-06 — W-3L conversions IV: the Proof Center (rounds 81-82, R82 SHIP)

The Proof Center went three-layer at 37b2789, integrator-direct, per inventory 439-479 — the page whose ~18 equal-weight rows had buried the two statuses that matter now fits one viewport as an instrument. proofTakeaway (lib/evidence) welds BOTH subjects' statuses into the head sentence from the SAME derivations the cards render, and BY LAW both failing arms surface there (a head that says nothing while the receipt is rejected reads as a pass); the ProofSubjectCard keeps its answer layer visible — status, gated rows with drift, every per-engine weld, the fingerprint weld — over a counted "15 provenance row(s)" fold; the live card leads with its serving-batch takeaway and keeps the key visible over a 2-row fold; probe records got a count takeaway with lawful paths folded; the stampline took the shared keepOpen split. THE ARC'S OWN RULE, NEW ON THE RECORD: a pub() refusal is ITSELF a refusal — every artifact-derived string destined for a fold is publishability-checked at composition, and a refused one HOISTS OUT (artifact path, receipt note, feeds path, identity note, probe paths/notes), so no withheld value can hide behind a closed disclosure. Landed with 4/4 mutants killed each at its OWN law (the masked-kill lesson from the feed arc now standing procedure) and hazard laws in the r73 form over documented single-delta manifests (digest gap, DSN-shaped artifact path, fingerprint mismatch). Codex r81 NO-SHIP x1 HIGH — the exact defect class this codebase hunts, found in the new code's own seam: the collapsed stampline branched on RAW manifest.substrate while the head and card use liveSubjectStatus(), whose contradiction arm (wire no_batch beside a non-null substrate) deliberately demotes to no-batch — so one reachable manifest rendered NO SERVABLE BATCH at the head while the stampline pinned batch #N inline: two mutually exclusive answers on one page. The fix (1c113bf) derives ProofStampline from the same status derivation, and the regression law was written FIRST and observed red against the defective bundle before the fix went in — the defective code serving as its own mutant. R82 SHIP: all four reachable manifest states traced, no other renderer bypasses the derivation, the law confirmed discriminating against the parent commit. DISPATCH MECHANICS NOW STANDING: detached worktree pinned at the subject commit (short Temp path for MAX_PATH), prompt file, and the job record's own "Target:" echo verified against the requested base before any finding is trusted — plus the review subcommand runs synchronously, so the dispatch itself is backgrounded and the job JSON polled. Tallies at 1c113bf: web 1245 -> 1258/1259 (+1 pre-existing skip); two commits, two rounds, zero weakened assertions. Live: :8080 api-r65meta (1.8.0), :3111 at 1c113bf. Remaining: Lab dek hoist + matrix method consolidation + legend split + CommittedDetail (inventory 152-207), the Developers response-chip hoist (481-493, small), five views, DEPLOY LAST per the owner.


## 2026-08-07 — W-3L conversions V: Lab A — the dek hoist and the sentence layer's hardest arc (rounds 83-86, R86 SHIP)

The Scenario Lab's first half went three-layer at 5698e8c, integrator-direct, per inventory 152-171 + 201-206: LabClient owns the /v1/book state so the computed cliff sentence — the surface's answer — leads the page ABOVE the mode bar in BOTH modes (it had been two components down and vanished entirely in address mode), relocated whole so every caveat clause travels; the frontier refusal leads with its takeaway over the server's words; and CommittedDetail leads with committedTakeaway (scenarioLines, pure, through the shared factor formatter), keeps the defined-for clause visible as method (the NOT COVERED vs WITHHELD distinction), and folds the exact factors, path assumption and endpoint behind a counted summary. THEN CODEX EARNED ITS KEEP FOR THREE STRAIGHT ROUNDS, all on the new sentence layer, every fix wave test-first with the law observed red against the defective bundle before the fix went in. r83 x3: the takeaway called the committed rate projection's 1/1 placeholder a MOVE ("moves borrow_apy ×1" against its own +200bps label — holds now graded through formatFactor's own direction and named as explicit holds); the lifted book state could outlive the service's recovery (the pre-hoist panel re-read /v1/book on every mount and the lift silently dropped that — readBook now re-runs on book-mode re-entry AND on an address success under a stored refusal); and the refusal takeaway blamed the service for network errors that carry no HTTP response (the arms split; only a served 503 licenses the service-side verdict). r84 x2, both on the r83 fixes themselves: "moves" was STILL unearned for non-identity factors — the committed snap-band no-op declares three ×0.995 stables that PriceProviderV2 pins straight back to par, and the wire carries no transform metadata, so the verb became DECLARES with the realization clause ("committed shock factors, applied through each engine's own read path"); and the r83 sequence guard arbitrated by DISPATCH order, letting an ABORTED newer read permanently suppress a still-live older recovery — arbitration is now by ACCEPTED settlement (an aborted request never settles and therefore never claims), pinned with held Playwright routes on the exact re-entrant schedule. r85 x1: the SIBLING surface — the matrix row sub and both scenarioCoverage reasons still said "moves" off cold definitions; all three sites now declare, and the only surviving "moves" sits inside its own negation. R86 SHIP after a prompted FULL-PAGE sweep of the defect class (served-result surfaces exempted as earned — the dek's cliff sentences read a computed waterfall and keep their verbs). THE ARC'S LESSON, on the record twice over: (1) a computed sentence is a CLAIM STACK — the verb carries an epistemic weight the data must license, and "moves/declares/holds" took three rounds to get right because each fix was scoped to the surface named rather than the CLASS; the r86 dispatch asked for the class sweep explicitly, and that is now the standing shape for any finding that smells structural. (2) Lifting state up a component tree deletes lifecycle semantics silently — the remount-refetch and the abort-on-unmount were both LAWS nobody had written down, and both broke; every state lift now gets its recovery paths enumerated at design time. Tallies at 5a443da: web 1258 -> 1274/1275 (+1 pre-existing skip); four commits, four rounds (r83-r86), zero weakened assertions; the fable quota stayed exhausted, integrator-direct throughout. Live: :8080 api-r65meta (1.8.0), :3111 at 5a443da. Remaining: LAB-B (matrix header promotion, DELTA-ONLY method stated once, the legend collapse-trap split, row settlement lines — inventory 180-199), the Developers response-chip hoist (481-493, small), five views, DEPLOY LAST per the owner.


## 2026-08-07 — W-3L conversions VI: Lab B + Developers — THE THREE-LAYER PROGRAM CLOSES (round 87, R87 SHIP)

The inventory's last two items, both small and both landed integrator-direct in one round. W-3L-LAB-B (327a107) closed the Lab: a survey-first pass discovered that inventory items 180-192 were ALREADY at the bar — the original W-3L slots wave had promoted the batch header, stated the DELTA-ONLY basis once as the grid's method (cells shrunk to the net count, batch pins moved into rendered text under a documented LAW-5 ruling), and split the legend with a documented ruling AGAINST the inventory (SUPERSEDED stays open: a supersession is hazard-register content, and the rollout carves no exception for the sentence that defines it) — so only 194-199 was real work. The run column's up-to-three stacked footnote spans (the rerun-failed banner, the attempt-changed note, the definition-changed refresh affordance) now compose into ONE settlement line per row: every piece keeps its testid, its data provenance and its full sentence — all 31 pins across eight fix-spec files (r8/r12/r13/r14/r15/r16/r17/tornado) stayed green untouched — with the pieces flowing inline on interpunct joints, the cohort-membership gate on the refresh remedy preserved verbatim, and a clean row rendering no settlement line at all. W-3L-DEV (e3d3bf4) made the inventory's one named change to the reference page: the response-code chips — the non-2xx vocabulary that costs a caller correctness — hoisted ABOVE the 200-sample fold, pinned by geometry. Both landings mutation-verified (the unwrapped container and the chips-below-the-fold each killed at their own law) and eyes-on at 1440/900 (the Lab against the live wire with a doctored re-run 503: the result held at batch #14160 while the failure read as one composed sentence beside it). R87 SHIP over both commits in one round: predicates preserved exactly, the wrapper cannot render empty, chips moved without loss, both laws discriminating. OPS ON THE RECORD: the integrator claim lease expired overnight and the scope-gate BLOCKED code commits until the renewal landed as an ISOLATED roadmap-only commit (18627ff) — the expired-claim cleanup-transition rule is real and the renewal procedure is now banked. THE PROGRAM CLOSES: every surface in docs/specs/2026-08-04-three-layer-inventory.md — Book, Inspector, Scenario Lab, Observatory, Feed, Proof Center, Developers — now leads with a computed takeaway, keeps every hazard outside its folds, and counts what it hides. Six arcs, rounds 68-87 spanned the bank hardening plus the five conversion arcs; the takeaway grammar (mode-honest claims, declared-vs-realized verbs, one-source welds) and the placement law (visible + not-a-descendant + counted, visibility-asserted per r75) are the program's residue, applied now by default to anything new. Tallies at e3d3bf4: web 1275 -> 1276/1277 (+1 pre-existing skip). Live: :8080 api-r65meta (1.8.0), :3111 at e3d3bf4. Remaining in the train: the five Codex-program views (headroom exposure ladder, Pareto/concentration, incremental stress exposure, Aave mover dumbbells, DM flip ranking, bad-debt rate — feasibility banked d900de4), then THE DEPLOY GATE LAST, per the owner.
