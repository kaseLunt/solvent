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

---

# ADDENDUM (2026-07-30) — ACK/ADJUST on the L2 wave's two sharpenings

Archived verbatim from the standing chain-truth instance, responding to the L2 implementation
(639d7eb). NORMATIVE, same authority as the ruling above.

**1. UNION WIDENING — ACK the motive, ADJUST to the complete form.**
The widening is strictly refusal-widening and closes a real gap (a token appearing only at N was
invisible to a parent∪seized sweep — genuine unseen-inbound through the address list itself). But
the three-way union is still not closed: a **supported collateral token inbound pre-boundary and
fully outbound post-boundary within block N** is zero-balance at both edges, appears in none of
{parent legs, exec legs, seized}, and raises boundary maxBorrowLT exactly like H2's top-up — the
same class, one gap deeper. The complete form is cheap: the swept address list = the DM's
**supported-collateral set at both pins** (`getCollateralTokens()@parentHash(N-1) ∪ @pinHash(N)` —
both already in the ABI surface; a mid-block `CollateralTokenAdded/Removed` is DM-custodied and
witness-visible, `IDebtManager.sol:44-45`). Same two getLogs calls, longer address array, one
extra pinned read per frame. Take it. Only tokens with configs move `maxBorrowAtFrame`, so the
supported set is the provably-sufficient universe — no unsupported-token sweep needed. If the
wave keeps the union anyway, the in-and-out residual must be a **named disclosure in the verdict
evidence**, not silence — but adjust rather than disclose; the fix costs less than the caveat.

**2. NETTING MODELED-IFF-FINAL-PASS — ACK, conditional on one invariant being explicit.**
The refusal split is correct and within my floor (earlier-pass cancellation =
attributed-but-unmodeled → refuse; the sanctioned extension was permission, never obligation —
declining it pending a cross-pass netting state-machine design is honest). The condition: state
and pin the invariant your own `:526`-then-`:568` justification implies — **the case's own-pass
cancellation must NEVER enter the boundary-eligibility basket.** The contract judged eligibility
NETTED (the `:526`/`:544` check precedes `preLiquidate`'s `_cancelOldWithdrawal`), so the own-pass
cancellation is post-check: it is attributed for closure and available to the seizure/L5
accounting (seizure operates un-netted), but the boundary crossing is evaluated against the
netted basket. If "models the basket effect" currently means adding the freed amounts to the
pre-boundary eligibility basket, **invert it** — that would model the one cancellation that must
not affect the check while refusing the one that must (the earlier pass's cancellation DID un-net
the basket before the case's `:544` check — which is precisely why refusing it is right until
modeled). Error direction if wrong is over-refusal, not false pass, so this is a should-fix
sharpening, not a custody break — but pin it: the synthesized pending-liquidation fixture should
assert the boundary basket stays netted on the own-pass arm, alongside the existing refuse
assertion on the earlier-pass arm.

**Record items:** (a) refuse-on-sight for `WithdrawalAmountUpdated` is right; (b) the
opposite-direction mutation pair is exactly the L7 floor; (c) skipping zero-amount elements is
chain-faithful (observed, not assumed) and the zero-arm's falsifiable content stays with
`tryAllPartial`'s balance check.

**Verdict on the sharpenings: CUSTODY HOLDS** with adjustment 1 (supported-set sweep, or named
residual as the disclosed fallback) and the invariant in adjustment 2 made explicit and
fixture-pinned. Neither is a re-open of the L2 design; both are address-list/semantics
completions inside it.

---

# ADDENDUM 2 (2026-07-30) — RULING on Codex R12 admin-epoch forks

Archived verbatim from the standing chain-truth instance (responding to Codex round 12, session
019fb52c-0eb3-7ec2-a5a2-82e7a394744e, @ ea25975). NORMATIVE.

Source facts confirmed before ruling: `DebtManagerCore.sol:715-718` — `setAdminImpl` is
`onlyRoleRegistryOwner`, a bare `sstore`, **no event**; the slot constant lives at
`DebtManagerStorageContract.sol:99`; the only in-code writer of `ADMIN_IMPL_POSITION` is that
setter (the :703/:748 sites are reads). The lifecycle events `CollateralTokenAdded/Removed`
(`IDebtManager.sol:44-45`) ARE proxy-emitted and therefore in walked custody.

## FORK 1: (B) CODE-HASH CONSTANCY PIN — with three sharpenings. (A) rejected.

**Why not (A):** We do not custody the deployment build pipeline — compiler version, optimizer
runs, via-ir, remappings, and the CBOR metadata trailer are all inputs we would have to guess,
and `recon/cash-v3/` is a **gitignored working copy**: there is no committed source to compile,
so (A) as specified is unimplementable without first changing the repo's source-custody posture.
Worse, a compile-compare that must be progressively loosened (metadata stripping, immutable
zeroing) until it goes green is calibrating the instrument against its target — the banned side
of the recomputation line. Sanctioned as **offline evidence only**; it never enters the gate loop.

**The (B) law:**
1. `eth_getCode` (EIP-1898 blockHash form — **probe it first**, transcribed, both
   `SOLVENT_RECON_RPC_OP` endpoints at frame depth) at `parentHash(N-1)` and `pinHash(N)` for all
   31 cases plus the run's head pin; keccak the returned bytes locally (permitted recomputation —
   raw bytes→keccak is a complete model); all hashes must equal ONE audited constant per surface.
   Case mismatch → case refusal; head mismatch → preflightExit posture.
2. **Three surfaces, not one:** (i) the proxy itself, (ii) the ERC1967 core implementation (impl
   slot read at both pins by the same two-pin discipline), (iii) the admin impl.
   Borrowed/Repaid/Liquidated/IIU semantics live in the core — pinning only the admin closes half
   the finding.
3. Establishment of each constant is a **dual-provider read**; frame reads thereafter may be
   single-provider (they compare against the dual-established constant). Non-empty code required —
   empty getCode is a refusal, never a zero-hash.

**What the pinned hash certifies (disclosure text, use verbatim):** "The pinned code hash
certifies that the bytecode at the audited address is byte-identical at every frame boundary read
and at establishment, and that the replay's decode semantics were empirically anchored against
logs emitted by this exact bytecode (the captured fixtures come from these very blocks).
Interior-of-block constancy follows from EIP-6780 (active on OP since Ecotone, 2024-03, before
frame start 150,057,202): code deployed in a prior block cannot change mid-block. It does NOT
certify that any Solidity source text corresponds to this bytecode — no compile bridge exists;
source correspondence rests on fixture anchoring plus human source review, and is a trust
posture, not a proof."

## FORK 2: (C) — sequenced, plus one zero-cost law regardless.

**Law 0 (regardless, zero new reads):** the witness loop refuses on sight — pre-boundary, note →
Complete()==false → UNEXPLAINED — any proxy log whose topic0 is (i) ERC1967
Upgraded/AdminChanged/BeaconUpgraded, or (ii) not in the committed IDebtManager event surface at
all (a foreign topic0 from the custody address is the signature of foreign semantics). Topic0s in
the committed surface but outside the 5-event replay model keep their existing adjudicated
treatment. This closes the writer-set-mutation path (core upgrade) entirely inside existing
custody, because setAdminImpl is silent but upgradeToAndCall is not.

**Step A (probe, then traces if served):** probe `debug_traceBlockByHash` + callTracer at frame
depth on both endpoints, transcribed. If served: one-time capture, hermetic fixtures. Law: refuse
the case if any call frame, at any depth, in any tx with transactionIndex < the case's (plus the
case's own tx at any position — intra-tx frame-vs-logIndex ordering unresolvable from callTracer,
over-refuse), targets the DM proxy with input prefixed by the **ABI-derived** setAdminImpl(address)
selector (IDebtManager.sol:440, never hand-written), or by upgradeTo/upgradeToAndCall selectors.
With traces, the D-013 residual is **retired**, not reclassified.

**Step B (fallback if traces unserved):** eth_getBlockByHash(pin, fullTx=true) per case (hash echo
validated); scan the raw input of every tx with index ≤ the case's for the ABI-derived selector as
a contiguous byte substring; any occurrence → refuse, narrative naming tx hash and byte offset and
stating occurrence ≠ proof of execution (over-refusal-safe).

**Ruling on the substring argument: TRUE but not universal — the gap must be disclosed, not argued
away.** The claim holds for direct calls and every verbatim-wrapping encoding in the standard
stack — Safe execTransaction, MultiSend/MultiSendCallOnly, OZ TimelockController execute/
executeBatch, and arbitrary nestings. It is **false** for the pre-deployed payload/executor
pattern: a migration contract deployed in an earlier block and invoked in the case block carries
the selector in its **code**, not in any scanned calldata — a named, honest, widely-practiced
governance pattern (Aave-style payload execution), not evasion-shaped. Therefore under Step B:
(i) the marginal class survives only with a mandatory evidence key (`admin_continuity: "two-pin +
calldata-scan clean; pre-deployed-payload migration residual undetectable at this read tier"`);
(ii) the prior D-013 residual text ("evasion-shaped choreography only") is **superseded — the
residual is not adversary-only**, per H2b exactly; (iii) a fixture must exist that exercises the
limit: a payload-contract invocation the scan does NOT catch, asserting the disclosure IS emitted
— the fixtures-that-cannot-fail law applied to a disclosure.

## M3b — SUPERSEDING ADDENDUM (this text governs over the archived ruling above)

**SUPERSEDING ADDENDUM (Codex R12, M3b).** The sentence above declaring the two-pin
supported-collateral set "the provably-sufficient universe" is SUPERSEDED. The lifecycle
round-trip disproved unqualified sufficiency: a token supported only mid-block
(CollateralTokenAdded pre-boundary, removed before block end, or the mirror shape) is absent from
getCollateralTokens() at both endpoint pins yet participates in the boundary maxBorrowLT — the
same endpoint-pair blindness this ruling identified for balances applies to the supported set
itself. The corrected claim: the two-pin supported set is sufficient **conditional on the absence
of any pre-boundary collateral-lifecycle witness**, and the condition is checked in custody — any
pre-boundary CollateralTokenAdded/CollateralTokenRemoved log from the proxy (IDebtManager.sol:
44-45, walked surface) is a mandatory refusal: note → Complete()==false → UNEXPLAINED, never
modeled. Additionally binding from the R12 rulings: (1) decode authority rests on the CODE-HASH
CONSTANCY PIN — proxy, ERC1967 core impl, and admin impl code hashes pinned at both pins of every
case and at head, dual-provider-established, with the certification limited to bytecode constancy
plus empirical fixture anchoring (no compile bridge is claimed); (2) the silent setAdminImpl write
(bare sstore, DebtManagerCore.sol:715-718, no event) is detected by trace-frame evidence where
debug_traceBlockByHash is served, else by the calldata-selector scan with the pre-deployed-payload
residual DISCLOSED and the D-013 "evasion-shaped only" classification withdrawn — the residual has
an honest governance shape and is never classified adversary-only; (3) any proxy log bearing a
topic0 outside the committed IDebtManager event surface, or any ERC1967 upgrade event, refuses on
sight pre-boundary. Sufficiency claims in this file are henceforth conditional claims with their
checking law named; where this addendum conflicts with the archived text above, the addendum
governs.

**Verdict: CUSTODY HOLDS** on the shipped two-pin/wave-8 work, **conditional** on: Fork 1 = (B)
three-surface hash pin with the getCode-form probe and the non-claim disclosure; Fork 2 = Law 0 +
trace-else-scan with the D-013 reclassification and the disclosure-limit fixture; M3b addendum
applied. Blocking if omitted: the core-impl surface in Fork 1 (admin-only pinning leaves the
Liquidated/IIU decode authority unbound — the identical version-skew scenario one slot over), and
the D-013 reclassification under the Step-B fallback (a residual with an honest shape presented as
adversary-only is the-RPC-said-so applied to our own prose).
