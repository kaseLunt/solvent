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
