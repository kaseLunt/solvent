# chain-truth Task 2+3 pre-dispatch rulings — 2026-07-28 (post-probe, pre-wave)

Standing persona: chain-truth (fable). Advise-only. Verbatim rulings from the pre-dispatch
consult at HEAD 98333fd (repo reads + read-only live-db SELECTs + local anvil v1.7.1 probes +
one bounded fork probe). NORMATIVE for the Task 2/3 wave briefs; the blocking list at the end
gates wave acceptance alongside the plan.

## R1 — Engine identity mechanics. BINDING-RECOMMENDATION

Six touchpoints; two hide architectural traps the plan text does not name.

**R1.1 Config enum + stream validation** — `internal/config/config.go:13-17` (`KnownEngines`)
+ rejection at `config.go:183-185`. Add `"aave_param"`. Stream config: singleton address
`0x8438F4D29D895d75C86BDC25360c25eF0607E65d`, startBlock 20,625,519, **window 2000**,
confirmations matching existing ETH streams (see R6.4 for why NOT 10k). Do NOT add the
AddressesProvider address to this stream (its topic0s are outside the 20-event inventory; the
A6 MOCK_STABLE_DEBT curio lives there).

**R1.2 Decode registration keys on `(engine, topic0)`, not stream** — `internal/decode/
decode.go:194-198` (`engineTopics`) + dispatch at `decode.go:239-263`. Add a
`configuratorTopics` map + `engineTopics["aave_param"]`. Address-blind-keying safety comment
(decode.go:222-228) survives (singleton-address stream); restate it. **Trap (blocking if
missed): Registry's contract for unknown topic0 is `(nil, false, nil)` — deliberate silent
skip — and the generic Runner honors it (runner.go:360-362 `continue`).** For params, silence
is unavailable. Failure scenario: gen-7 configurator impl emits a new param event → skip →
param_history silently wrong → wrong LT in a public HF. Prescription: **refuse-loud lives in
the ParamRunner, not Registry.Decode** — on `known == false` for a log in its window, the
param runner returns an error (halting the stream loudly into backoff + step_error), never
`continue`. Registry contract untouched; the closed 20-topic0 inventory becomes an enforced
invariant.

**R1.3 The param deriver is NOT a `derive.Engine` and cannot ride `derive.Runner`.** Runner is
hardwired to `ApplyDerivedWithRates` → position_events/position_balances and RewindDerived
(runner.go:112-121, 385, 442) + batch lifecycle + snapshot FIFO params don't have. Correct
shape: a **new thin `ParamRunner`** (internal/derive/params.go) copying exactly FOUR binding
rules from Runner.Step/rewind and nothing else:
1. Proactive repair first: `HasUnackedReorg` (generic, store/derive.go:829-848, reusable
   as-is) before any derivation, mirroring runner.go:288-297;
2. Reactive backstop: `store.ErrUnackedReorgEpoch` from ApplyParamEvents → rewind, mirroring
   runner.go:392-401;
3. Resume from the cursor READ BACK, never the requested target (R15-6 class;
   runner.go:24-26, 446-452) — RewindParams may lower the target below what was asked;
4. Bootstrap ack via `RewindParams(…, StartBlock−1)` when no cursor exists on an
   epoch-carrying chain, mirroring runner.go:435-441 + the refusal at derive.go:225-230.
Reuse `ingestFrontier` verbatim (runner.go:516-531).

**R1.4 cmd/indexer wiring** — the switch at cmd/indexer/main.go:1312-1341; add
`case "aave_param":` constructing the ParamRunner (default: is a startup fatal — good).
**Health/frontier registration is free iff the ParamRunner satisfies the `deriveWorker`
interface (main.go:104-108: Name()/Step()/Health())** — then it joins `runners []*runnerState`
(stepped by stepRunners; step_error/no_progress/terminal inherited) and `consumers`
(frontierWatch{worker, streams, chainID}, main.go:1339). Do not invent a fourth worker family
(the FeedDeriver precedent at main.go:1371-1395 exists only because it isn't a deriveWorker).

**R1.5 Epoch machinery needs NO other registration.** PruneAckedReorgEpochs
(derive.go:850-866) prunes on MIN(acked_epoch) over ALL derive_cursors rows per chain — the
aave_param row joins automatically at first write; until then the bootstrap hole is closed by
derive.go:225-230's no-cursor refusal. Other engine enumerations checked: reconcile -engine
flag enum (Task 6's surface, untouched), snapshotdb constants (untouched),
store/invariants.go names only debt_manager (unaffected).

**R1.6 ApplyParamEvents must carry the FULL write-side gate block or Window A opens for
params.** Mirror derive.go:198-230 exactly: chain binding (ErrDeriveCursorChainMismatch),
unacked-epoch refusal (ErrUnackedReorgEpoch), no-cursor-on-epoch-carrying-chain refusal,
implicit first-write ack on the insert arm only (derive.go:306-315), guarded cursor upsert
refusing height regression + chain rebind (derive.go:309-335), and **divergent-replay
refusal** on (chain_id, tx_hash, log_index) (the loadPositionEvent/equalPositionEvent
pattern, derive.go:263-273): identical replay no-op, divergent bytes abort. A one-arm gate
(rewind validated, apply trusted) is the anti-canon and is blocking.

## R2 — RewindParams placement. BINDING-RECOMMENDATION

The plan's dedicated `RewindParams` stands (the decision survived four Codex rounds; recorded
that my params-as-position_events instinct was the lower-drift alternative — the decision
wins). Within it:
- **The epoch arithmetic has exactly one home: `rewindTarget` (store/derive.go:351-382, +
  chainMaxEpoch 340-349)**, extracted in P2 Task 8 so every rewind-and-ack path shares it;
  RewindDerived (derive.go:517), RewindPrices (prices.go:1946), and the neutralize path
  (prices.go:1381) consume it. **RewindParams is the fourth consumer. Copy-pasting the
  deepest-unacked SQL is a blocking finding** — two implementations of "how deep must an ack
  reach" is how a shallower ack blesses deleted blocks.
- Body, one transaction, modeled on RewindPrices (the lean rewind, prices.go:1904-…), NOT on
  RewindDerived's heavy legs: chain-binding cursor read (derive.go:499-513 shape) →
  rewindTarget → DELETE param_history above effectiveTarget → cursor reset + ack with the
  exact upsert at derive.go:641-648 (conflict arm never rebinds chain_id). **Do NOT
  parameterize RewindDerived** — position-engine-specific, senior-approved, reopening it is
  zero-benefit D-006 exposure.
- Frozen-signatures law satisfied: all new publics additive; rewindTarget reuse unexported.
- The discriminating stacked-epoch test (unacked targets 50/80, rows 60/90, SHALLOW-80 call,
  assert row-60 gone, cursor 50, acked==MAX) is the mutation-battery witness that the
  rewindTarget call is actually wired.

## R3 — Adapter-output poller extension. BINDING-RECOMMENDATION

**An ETH poll loop already exists** (cmd/indexer/main.go:1354-1370 builds one prices.Poller
per chain with poll/ratio assets; ETH qualifies via the weETH getRate ratio). **Extend the
existing ETH poller instance; no second poller, no second anchor family.**
- **Registry, not code, declares reserves**: new recon/feeds.json entries, kind "poll"
  (config/feeds.go:38,46), contract = AaveOracle 0x43b64f28…, one per reserve (weETH, USDC,
  PYUSD, FRAX), declared decimals 8 (Task 6 weld verifies). One new entry in the closed
  `pollViews` map (prices.go:367-389): `"getAssetPrice(address)"` with source
  `"aaveoracle:<contract>"` — **address-qualified** (like RatioSource, unlike the flat
  priceproviderv2 literal): ETH poll rows now come from multiple contracts and an unqualified
  name conflates witnesses.
- **Anchor mechanics fully shared**: the new calls join the same round's single Multicall3
  batch (poller.go:897-…), same EIP-1898 hash pin, same PollCursorEngine(1) cursor +
  price_poll_anchors row via ApplyPolledPrices. One round, one anchor, N sources. D-012
  structural protections inherited (poll-owned namespace, RewindPrices refusal, anchor
  retention, neutralization).
- **source_as_of costs ZERO extra RPC calls — forbid a new header fetch.** HeadFrom
  (poller.go:928) already returns chain.Head carrying the header's own timestamp
  (chain.go:1169-1173, same eth_getBlockByNumber as the reported hash) — currently
  discarded. Thread head.Time into pollRound (poller.go:818-823) → ApplyPolledPrices →
  prices.source_as_of. A wave adding a per-round header call has failed to read the round.
- **Reserve-set honesty: static config + event-derived cross-check, never a startup chain
  read.** ReserveInitialized is in the decode set, so param_history IS the reserve registry.
  Sharpen the Task 6 weld to assert SET EQUALITY: reserves named by param_history's
  ReserveInitialized rows == feeds.json aaveoracle poll set; divergence = gated FAIL.
  OPTIONAL: a zero-RPC daemon health condition doing the same comparison from durable rows.

## R4 — source_as_of backfill. BINDING-RECOMMENDATION (backfill feed rows; mechanism constrained)

**D-012 does not forbid this — it doesn't govern this side.** Its clauses bind POLL-owned
rows; feed rows are event-derived ledger data ("untouched by this decision"), re-derivable
from raw_logs. Filling a NULL disclosure column with the chain's own updatedAt,
deterministically derived from custodied raw bytes, is **provenance completion** — the exact
capability D-012 exists to preserve. What's forbidden is fabricated freshness (insert-time
re-stamping); the backfill writes chain testimony. **Permitted and recommended.** Honest
cost-benefit: riskd's gating inputs (adapter-output + DM poll rows) are stamped from round 1
and NULL history is not honest-use blocking; what NULL costs is up to ~24h of
"unmeasurable" as-of on the three 86400s feeds' public meta surface at launch — one cheap
pass removes it.
**Mechanism (binding): Go-decoder replay, never SQL byte-slicing.** A substring() migration
is a second, unreviewed decoder — parser differential vs the strict path
(decodeChainlinkAnswerUpdated, decode.go:726-743, incl. uint64-range check). Prescription:
additive store method + one-time healing pass owned by the FeedDeriver (holds raw_logs
access, the topic0, and the fold order), filling source_as_of only where NULL, only rows it
owns, replicating last-in-block-wins so a two-updates-one-block edge picks the same witness
derivation did. Idempotent; value columns untouched; poll-row history stays NULL
forward-only (per-height RPC recovery = the D-012 offline-batch-tool option, correctly not
built now).

## R5 — Harness sequencing. BINDING-RECOMMENDATION (leg structure + provider posture)

Probed this session (anvil v1.7.1 commit 4072e48):
- **anvil_reorg EXISTS**, positional params `[depth, txBlockPairs]` ([3, []] works; map form
  rejected). After depth-3 reorg the block hash changed at SAME height with head preserved —
  exactly the walker's mismatch trigger. Prefer anvil_reorg over evm_snapshot/revert
  (identical re-mine can reproduce identical hashes; anvil_reorg diverged even empty).
- **Pre-fork eth_getLogs is PROXIED to the fork upstream** (upstream refusal returned
  verbatim; boundary-straddling ranges fail whole) → harness stream window ≤ 10 when the
  upstream is the Alchemy free key.
- **.env ANVIL_FORK_RPC is the OP endpoint (Task-10's), not ETH** — Task 3 needs its own
  `ANVIL_FORK_RPC_ETH`; given A2 (dRPC archival flapping) vs tiny bounded traffic (~30
  upstream calls/leg + foundry cache), use the **Alchemy archive-complete key, window 10 —
  exactly A3's targeted-fallback carve-out** (opt-in, on-demand, never bulk). Probe hygiene:
  an early fork-getLogs "failure" was the prober's own hex bug (block beyond fork head —
  anvil refused CORRECTLY); retracted.
- Subject geometry (live-db, verified): reserve-init cluster **20,713,917 → 20,714,007** (14
  Pool logs, all four aTokens' first logs, supplies, first Borrow at 20,714,007; the single
  CollateralConfigurationChanged + A1 ReserveInitialized bodies at 20,713,917); NO engine
  logs in (20,714,007, 20,714,100] → fork ~20,714,020 gives state as-of the last subject.
  LiquidationCall: 25 events, all singleton blocks, first at 21,027,456 (313k after the
  cluster); the pair 21,469,973+21,469,981 fits one 10-block window.

**Ruling — THREE legs:**
1. **Genesis-cluster leg (load-bearing):** fork at hash-pinned ~20,714,020; streams =
   configurator + Pool + 4 aTokens, startBlock ~20,713,910, window 10; walker Step → decode
   → derive over the 91-block range. Assert: raw bytes == fork getLogs bytes **and == the
   Task-1 committed fixture bytes** (independent second witness — without it the leg is one
   witness through two doors); derived positions vs fork views (scaledBalanceOf,
   getReserveNormalizedIncome) — genesis-valid because 20,713,917 IS first activity; param
   rows vs getConfiguration on the fork. **Disclosed scope limit:** configurator events
   before 20,713,917 (from 20,625,519, impl bookkeeping) are out of range — this leg welds
   only in-range params (the weETH collateral config), never full-registry equality (window-
   10 proxy walk from 20,625,519 ≈ 8.8k requests, refused). **Freeze exact pins only AFTER
   Task 2's live backfill lands** (verified by a raw_logs query over the configurator
   address) — Task 2 backfill precedes Task 3 pin selection.
2. **Liquidation leg (custody-only, disclosed):** the Aave engine's genesis invariant
   (engine.go:66-71: absence-means-zero only from genesis; warm-start detector errors loudly)
   makes a mid-history derived weld impossible without full-prefix ingestion. Separate small
   pinned range covering 21,469,973–21,469,982 (two LiquidationCalls, one window): raw bytes
   + strict decode ONLY, no position weld, said so in comments. **Do not let the wave "fix"
   this by starting the Aave engine mid-history** — that is the corruption the warm-start
   detector refuses.
3. **Reorg leg (post-fork, synthetic):** pre-fork history cannot reorg. Resolve the ACL/risk
   admin ON the fork (read ACLManager — never hardcode), anvil_impersonateAccount +
   anvil_setBalance, configureReserveAsCollateral(weETH, ltv′, lt′, bonus′) → mine ≥
   confirmations → walk + derive the param row → anvil_reorg (depth > head − emitBlock) →
   re-execute with ltv″ → walker observes same-height/different-hash → Rewind → durable
   epoch → RewindDerived + RewindParams → thin gate-consumer refusal (DeriveCursorStates/
   MaxReorgEpochs) → post-ack recompute shows ltv″ with **no surviving ltv′ row**
   (replaced-not-orphaned). anvil --no-mining + manual anvil_mine for height control.

## R6 — Probe-driven corrections the brief must carry

1. **[blocking, plan amendment] Task 3's "one pinned range containing config + borrow +
   liquidation" is refuted by the chain** (first liquidation 313k blocks after the only
   config event; genesis invariant forbids mid-history welds). Three-leg structure explicit,
   or the wave improvises on custody geometry — how one-arm gates are born.
2. **[blocking] A1 decode registration is a topic0/body split.** The canonical
   ReserveInitialized 5-address signature hash IS the emitted topic0; a hand-authored 3-word
   ABI entry would compute a DIFFERENT ID. Register the decodeFn under the canonical event's
   ID (from the embedded ABI) while the decoder hand-reads exactly len(data)==96 — three
   words (aToken, variableDebtToken, interestRateStrategy), asset from topics[1] — with
   dirty-padding checks per the house strict-parse style (unpackAddressUint256Arrays,
   decode.go:993 precedent). abi.JSON + unpackNonIndexed on this event ships the silent
   misalignment.
3. **[should] source_as_of zero-call fact** (R3): head.Time is already in hand at
   poller.go:928/950; PollChain (prices.go:768-774) stays untouched.
4. **[blocking] The walker has NO adaptive halving** (ingest/walker.go:789-793 fixed window;
   the probe pack's phrase was intended posture, not mechanism). Assuming it: window 10000 →
   dRPC E:12/E:15 flap → failover to publicnode (archive-walled, loud) → permanent backoff
   wedge. Prescription: **window 2000** — the posture the existing ETH streams backfilled
   through on this endpoint config (SOLVENT_RPC_ETH = dRPC primary, publicnode secondary) —
   ≈2.5k getLogs one-time, jagged under A2 but loud and self-healing. Alchemy-window-10 is an
   OPERATOR playbook (reconfigure window+endpoints for a targeted range), never automatic,
   never bulk on the shared key. In-walker halving would reopen senior-approved ingest —
   refused for this scope. Standing note: the walker rotation class (content-validation
   failures never rotate) remains recorded-unfixed and applies here.
5. **[note] Prior rulings unchanged**; the probes strengthen params-as-ledger (the single
   never-retuned CollateralConfigurationChanged + cap-slash wind-down is exactly the
   governance-between-samples history sampling would erase) and early-harness placement. dRPC
   A2 volatility is now also fork-upstream relevant.

## VERDICT: CUSTODY HOLDS — conditional blocking list

1. R1.2 refuse-loud in the ParamRunner (no generic continue for aave_param).
2. R1.6 ApplyParamEvents full write-side gate block, both arms (derive.go:198-230/263-273/
   306-335 mirrored).
3. R2 RewindParams consumes rewindTarget; a second epoch-arithmetic implementation refused.
4. R5/R6.1 three-leg harness; no mid-history Aave derived weld; synthetic post-fork reorg leg
   with replaced-not-orphaned assertion.
5. R6.2 ReserveInitialized: canonical topic0 + hand-authored strict 3-word body reader.
6. R6.4 window 2000 on the existing daemon endpoint posture; no assumed halving; Alchemy
   fallback operator-manual, targeted only.

Key files for the brief: internal/derive/runner.go (the four rules), internal/store/derive.go
(gate block + rewindTarget), internal/decode/decode.go (registry + strict-parse precedents),
internal/prices/poller.go + prices.go (round/pollViews extension points), cmd/indexer/main.go
(wiring switch + deriveWorker), internal/forkreplay/fork_replay_test.go (harness pattern).
