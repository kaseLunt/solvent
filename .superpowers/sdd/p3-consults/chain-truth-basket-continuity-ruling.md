# NORMATIVE — Chain-truth ruling: basket continuity for the marginal-disclosed class

Archived verbatim from the standing chain-truth consult (2026-07-30, feeding Task 6 wave 7).
Context: Codex round 6 H2 on cmd/reconcile/backtest.go @ 1bc660e (session
019fb3c0-b5eb-7cf1-a25a-18dd44cf309f). Status: NORMATIVE for the backtest gate's
marginal-disclosed verdict class; supersedes the literal reading of the Codex R6 H2
recommendation (Transfer custody alone is ruled UNSOUND — see Part 1 item 3).

---

## Part 1 — Premise verification (with a material widening)

**The premise is recorded, NORMATIVE, and accurate — and it is INCOMPLETE in a load-bearing way.**

1. **The authority**: `recon\derivation-notes.md:99-102` (caveat 4, NORMATIVE): "Collateral is
   **not custodied** by the Debt Manager: `collateralOf()` reads live ERC20 balances of the
   user's Safe via CashLens... No Debt Manager event tracks collateral movement
   (spend/top-up/plain transfers)." Ratified into the exit criteria at
   `derivation-notes.md:527-529`. Verified against the committed source:
   `recon\cash-v3\src\debt-manager\DebtManagerCore.sol:170-183` →
   `recon\cash-v3\src\modules\cash\CashLens.sol:555-565`.

2. **No DM deposit event exists for ANY top-up path.** The full DM event surface is
   `recon\cash-v3\src\interfaces\IDebtManager.sol:39-55`. `Supplied` is borrow-token liquidity
   (supplier side), not collateral. There is no `CollateralDeposited` or analog. The
   eventless-at-DM path is not merely reachable — **it is the only deposit path**: every honest
   top-up is a plain ERC20 transfer into the Safe. `borrow()` does NOT credit the Safe (funds go
   to the settlement dispatcher, `DebtManagerCore.sol:478-479`), so Borrowed witnesses have no
   basket side — the replay's debt-only Borrowed handler is faithful.

3. **THE WIDENING — the basket has a SECOND eventless-relative-to-custody channel that raw
   transfers cannot see.** `CashLens.sol:539-546, 555-565`: the basket leg is
   `balanceOf(safe) − pendingWithdrawalAmount`. The netting term moves with **zero token
   transfers** via CashModule withdrawal requests/cancellations (events on the
   **CashEventEmitter** singleton — `recon\cash-v3\src\modules\cash\CashEventEmitter.sol:52,60,69,78`
   — outside walked custody AND outside the Transfer layer). Worse: **every liquidation tx moves
   it itself** — `DebtManagerCore.sol:568` `preLiquidate` → `CashModuleCore.sol:228-231`
   `_cancelOldWithdrawal(safe)`, AFTER the `:526` eligibility check (netted) and BEFORE the
   `:584` Liquidated log. Consequence: **Codex's literal remedy ("Safe/token transfer custody")
   is itself unsound as stated** — a balance/Transfer-only continuity proof would pass while the
   netting term moved, and would spuriously refuse every pending-withdrawal liquidation. Any (B)
   must close both channels.

4. One more source fact the wave needs: `postLiquidate` at `:575` precedes `emit Liquidated` at
   `:584` — **the case's own seizure Transfer logs are always pre-boundary logs in the case's own
   tx.** A sweep law that doesn't attribute them refuses every case; a fixture without them is
   chain-impossible.

## Part 2 — The fork: **A-then-B**, with A as permanent law and B as its only discharge

(C) is rejected — Codex ruled disclosure insufficient, and a qualifier on an attribution claim is
the one-arm-gate shape. (A) alone does not "gut the gate": per the round-6 H1 split (parent-state
vs boundary-replay completeness), continuity gates **only crossing-based verdicts**.
True-at-parent rests entirely on pinned N-1 reads and makes no intra-block claim. (B) is
chain-honest **only in boundary-reconstruction form** — the consult's premise "we need boundary
values only, which eth_call at N-1 and N gives" is **wrong**: the liquidation boundary is
mid-block (logIndex L inside N); EIP-1898 `eth_call` serves post-state boundaries only. The
boundary basket must be reconstructed from N-1 state + ordered block-N logs; the N/N-1 pair
serves the closure check, never the boundary value.

## THE LAWS (implement verbatim)

**L1 — Continuity conjunct (the A-law, permanent).** `classifyIntraBlock` (backtest.go:1967)
gains a `basketContinuityProven bool` conjunct on the `eligFlippedWithWitness` arm only. Default
false. While false, every marginal candidate resolves UNEXPLAINED with evidence key
`basket_continuity` = `"unproven: Safe collateral moves without DM events (derivation-notes
caveat 4) and the netting term moves without transfers (CashLens.sol:544-546)"`. True-at-parent,
unpriced-leg, and UNEXPLAINED are NOT gated on it.

**L2 — The continuity proof (the B-law; the only thing that may set L1's conjunct).** Per case,
per basket token (union of parent `collateralOf` legs and seized tokens):
- (a) `collateralOf(user)@pinHash(N)` (new exec-frame read) alongside the existing
  `@parentHash(N-1)`;
- (b) Transfer sweep: `eth_getLogs` **pinned by blockHash (EIP-234) = the case's stored pin** —
  two calls (topics `[Transfer, safe]` outbound, `[Transfer, null, safe]` inbound) over the
  basket-token address list;
- (c) Netting sweep: `eth_getLogs(blockHash=pin, address=CashEventEmitter,
  topics=[[WithdrawalRequested, WithdrawalAmountUpdated, WithdrawalCancelled,
  WithdrawalProcessed], [safe]])`, signatures derived from an `abi.ABI` transcribed from the
  committed cash-v3 artifacts and pinned in tests (the round-3 hand-written-topic0 lesson).

**Closure identity, per token** (the per-case standardness-and-quiescence proof — no token
allowlist, ever): `leg@N − leg@N-1 == Σ signed Transfers − Δpending(decoded from (c))`. Any
mismatch → continuity unproven. This refuses rebasing accrual, fee-on-transfer skims, and any
non-standard balance write **per case by arithmetic**, which matters because the basket is
dominated by unaudited vault-share tokens (liquidETH 41.2%, liquidUSD 27.1%, liquidRWA 7.7% —
`recon/p3-probes.md:98`, 19 assets, fan-out to 17).

**Attribution law**: every pre-boundary (logIndex < L) movement from (b) and every pre-boundary
event from (c) must be attributed to a custodied witness's tx — the case's own seizure elements
(per-token aggregate; guaranteed pre-boundary by `:575`<`:584`), an earlier-pass Liquidated's
decoded elements, or a `WithdrawalCancelled` in the same tx as a witnessed liquidation. Any
**unattributed** pre-boundary movement or netting event, either direction → unproven. Any
**attributed-but-unmodeled** basket effect (e.g. an earlier pass's cancellation freeing netted
amounts the replay's legs exclude) → refuse per round-5 all-or-nothing, note tainting
`Complete()`; completing the model from the decoded event amounts is the sanctioned extension,
refusal is the floor.

**L3 — Corroboration must move to the boundary basket.** With continuity proven, `execEligible`
(backtest.go:531-532) must be computed over the **replayed boundary basket** (expose it from
`causeReplay`), not `parent.st.collateral` — H2's first clause verbatim. Without L2 this
recomputation is theater over an unverified basket; without it, L2 certifies a basket the
classifier never consults. Both prongs, together, or neither.

**L4 — Direction-blind admission, direction-aware disclosure.** No magnitude or direction filter
on refusal (a tolerance on an attribution claim is the silent-cap class). Disclosure narratives:
unattributed **inbound** = "non-custodied basket increase pre-boundary; a modeled crossing cannot
be certified to have held" (the H2 false-marginal direction). Unattributed **outbound** =
"non-custodied basket reduction pre-boundary; a candidate uncaptured cause — the crossing may not
be the witnessed write's." Outbound NEVER upgrades to marginal: chain-truth R1 admits only
custodied (walked raw_logs) witnesses as flip explanations; per-case archive getLogs reads
inform, they do not classify.

**L5 — Seizure-insufficiency preflight: refuse-entire-write, CONFIRMED — and the silent clamp is
a standing blocking defect.** `backtest.go:1680-1683` clamps an over-seized replayed leg to zero
with no note (`clampDebt` at :1605-1610 notes; this doesn't) — `Complete()` stays true and the
case can still classify marginal. Fix: per-token aggregate preflight before applying any part of
the Liquidated write; on insufficiency apply NOTHING, note (→ `Complete()==false` →
UNEXPLAINED). Over-seizure has **two** honest explanations in cash-v3, and the note must name
both: (a) an unseen pre-pass inbound transfer — itself the H2 unseen move, evidence never excuse;
(b) **the netting release** — parent legs are netted but seizure operates un-netted after
`_cancelOldWithdrawal`, so a pending-withdrawal Safe over-seizes vs the netted leg with no unseen
transfer at all. Under L2, sweep (c) discriminates (a) from (b).

**L6 — Read posture and probes.** All (B) reads at the case's stored pin or its
Multicall3-asserted parent — the existing pin law verbatim; every getLogs response validated as
answering the question asked: each log's `blockHash` == requested pin, `address` ∈ requested set,
topic count exactly 3 for Transfer (excludes ERC721 same-topic0 collisions), data exactly 32
bytes, strict decode. Before the wave cuts: a transcribed probe that the configured
`SOLVENT_RECON_RPC_OP` endpoints serve the **blockHash form** of eth_getLogs at frame-era depth
(foundation served range-form getLogs for the whole backfill — ledger — but the EIP-234 form is
unprobed; no getLogs helper exists in cmd/reconcile today, this is new plumbing). Observed
numbers or it didn't happen.

**L7 — Fixtures.** Default suite hermetic: captured getLogs envelopes + call words committed per
case (snapshotdb/golden-vectors pattern); capture env-gated like the live tests. Fixture-realism
law (the P0 lesson): every honest fixture must satisfy the closure identity, and every
liquidation-case fixture MUST contain the case's own pre-boundary seizure transfers — their
absence is chain-impossible given `:575`<`:584`, and a fixture without them is the
fixtures-that-cannot-fail anti-pattern. Required refusal fixtures: unattributed inbound;
unattributed outbound; closure violation (non-standard token); unattributed netting event; wrong
blockHash echo; 4-topic Transfer; over-seizure of shapes (a) and (b). Mutation floor: delete the
L1 conjunct; break the closure identity; break attribution; un-note the L5 preflight.

## Sequencing

L1 + L5 are small, verbatim-implementable, and Codex-mandated — they cut with wave 7 alongside
the uncontested H1 split regardless. L2/L3 (+L6 probe, L7 fixtures) are the designed extension;
same wave if capacity allows, else the immediately following one. Until L2 lands the gate
honestly reports every marginal candidate as UNEXPLAINED-with-disclosure; that is the correct
posture, not a regression.

---

**VERDICT: CUSTODY BREAKS** at 1bc660e for the marginal-disclosed class. Blocking: (1) L1
continuity conjunct absent — marginal verdicts currently claim an attribution no custody
supports; (2) `backtest.go:1680-1683` silent over-seizure clamp — no-silent-caps violation inside
`Complete()`'s own evidence chain; (3) any (B) implementation that proves continuity from
balances/Transfers alone — the netting channel (`CashLens.sol:544-546`,
`CashModuleCore.sol:228-231`) makes balance-only continuity unsound and would also spuriously
refuse every pending-withdrawal liquidation. Custody HOLDS for true-at-parent, unpriced-leg,
UNEXPLAINED, and obligations 1/3/4 (obligation 3 additionally self-detects most unseen moves
through its exactness welds; noted, no scope expansion mandated).

Key files: `cmd/reconcile/backtest.go` (classifier :1967-1996, replay clamp :1680-1683, exec
revaluation :531-532), `recon/derivation-notes.md` (:99-102), `recon/cash-v3/src/modules/cash/CashLens.sol`
(:539-565), `recon/cash-v3/src/debt-manager/DebtManagerCore.sol` (:526, :568-584),
`recon/cash-v3/src/modules/cash/CashModuleCore.sol` (:228-231),
`recon/cash-v3/src/modules/cash/CashEventEmitter.sol` (:52-78).
