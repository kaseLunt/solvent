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
