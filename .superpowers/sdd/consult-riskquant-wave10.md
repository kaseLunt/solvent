# Risk-quant consult — Task 9 wave-10 reconcile design (pre-Codex, D-006)

Consulted: `.superpowers/sdd/task-9-wave10-brief.md` (§2 sampling, §3 comparison semantics,
§3.5 tolerance policy, §3.6 index integrity, §6 invariant scans, §7 freshness), ruled inside
`recon/derivation-notes.md` (NORMATIVE), W1 Acceptance + disproof clause, D-012,
migrations 00001–00008. Every brief citation re-verified against the working tree:
`internal/derive/debtmanager.go` (ceil/floor mulDiv, same-block IIU join, residue model at
second-pass ∧ remaining ∈ (0,1], stable-snap posture with per-event `price_source` stamp),
`internal/derive/aave.go` (dual-regime rounding, deficit-first enforcement, inversion checks),
`internal/derive/runner.go:606-610` (borrow_apy deliberately uncollected),
`internal/store/derive.go:291/:546-551/:641-646` (fold predicate, no-HAVING rebuild,
acked_epoch bump), and the contract clone
`recon/cash-v3/src/debt-manager/DebtManagerCore.sol` / `DebtManagerStorageContract.sol`.

Date: 2026-07-26. Verdict at end.

---

## 1. Tolerance policy — ruling per epsilon

### 1.1 Debt Manager (net event-sum vs `borrowingOf` at pinned P) — zero tolerance is a THEOREM. Upheld.

Provenance chain: `position_events.delta` (normalized 1e18-scale; +ceil(usd·1e18/idx) per
`DebtManagerCore.sol:469` Rounding.Ceil, −floor per `:507`/`:578` Rounding.Floor, idx = same-block
`InterestIndexUpdated.newIndex` enforced by `debtmanager.go` `sameBlockIndex`) → Σ deltas ≤ P →
bridge floor(Σ·getCurrentIndex(token)@P / 1e18) (`DebtManagerStorageContract.sol:520-522`) →
`borrowingOf(user)`@pinHash(P). Every operation is integer arithmetic with contract-cited
rounding direction; interest accrual between the last event and P is performed by the
contract's own view at P, not replicated. Empirical anchor: bit-exact ×3 borrowers at PIN
154,021,227 (recon "Debt identity validation").

Supporting lemmas, both verified:
- **Injectivity:** for I ≥ 1e18 and integers n₂ > n₁ ≥ 0:
  floor(n₂I/1e18) − floor(n₁I/1e18) ≥ floor((n₂−n₁)I/1e18) ≥ floor(I/1e18) ≥ 1.
  So USD-level equality ⟺ normalized equality; the bridge cannot alias two normalized states.
- **Set bridge:** n > 0 ⟺ floor(nI/1e18) > 0 for I ≥ 1e18 — the zero-trim set-equality in §3.3
  is sound. Precondition I ≥ 1e18 holds structurally (initial index = PRECISION = 1e18,
  `DebtManagerAdmin.sol:179`; accrual is additive non-negative, `DebtManagerStorageContract.sol:565-566`)
  and is guarded by Scan 3.

The single sanctioned contract deviation — silent 1-wei residue zeroing,
`DebtManagerCore.sol:550-553` — is MODELED as a `residue_zeroed` event
(`debtmanager.go` processLiquidated: second same-tx pass ∧ remaining ∈ (0,1], matching the
contract's `== 1` condition after the two-pass flow), so no epsilon is owed. The
`-tolerance-dm-wei` structural forcing (`fail-with-tolerance`, cannot produce a pass receipt)
is the anti-carpet mechanism done right. **No tolerance-as-carpet found on this side** —
with one flag-scoped exception, F2 below.

### 1.2 Aave (scaled balances × index) — zero tolerance is a THEOREM. Upheld.

Scaled-vs-`scaledBalanceOf` is integer equality against the same storage semantics — no
arithmetic, no rounding argument exists for any epsilon. The live-value identity
(rayMulHalfUp(scaled, `getReserveNormalizedVariableDebt`@P) vs `balanceOf`@P) replicates the
contract's own half-up WadRayMath on identical inputs — deterministic, zero bound. The deriver
is stronger than the derivation-notes summary: dual-regime rounding (half-up pre-23,088,584;
TokenMath floor/ceil after), deficit-first liquidation pairing, and loud-failure scaled
inversion (`rayMulFloor(s′,i) == N` verified or error) mean drift cannot silently accumulate —
it either reconciles bit-exact or the deriver already refused.

### 1.3 §3.6 index-integrity — zero tolerance is a THEOREM, conditional on APY pairing; the condition is sound. Upheld.

Contract formula confirmed at `DebtManagerStorageContract.sol:559-567`: one
`mulDiv(idx_b, apy·dt, HUNDRED_PERCENT)` with default (floor) rounding, added to the snapshot.
`dt` legs: `lastUpdateTimestamp` is set to block.timestamp of the IIU block (`:546`), which IS
the header time of b — so `HeaderTime(P) − HeaderTime(b)` is exact. Pairing condition: any
`setBorrowApy` reindexes first (`DebtManagerAdmin.sol:196` per recon notes), so the latest IIU
block b ≥ the latest APY change; latest-APY-≤P is the rate in force since b. One floor
division, operation count one — bit-exact assertion is correct. Exceeding it means:
rate_indexes decode error, APY-payload pairing error, or an upgrade changed accrual — the
separate `index_integrity` verdict class keeps this from contaminating balance-drift triage.
Correct.

### 1.4 Freshness bounds (§7) — POLICY, not theorems, and mostly labeled as such. See F7.

---

## 2. As-of-H reconstruction vs contract accrual timing — mechanism census

| # | Mechanism by which derived-at-P and chain-at-P could differ | Design's handling | Classified correctly? |
|---|---|---|---|
| 1 | Interest accrued between last event and P | Eliminated by construction: bridge consumes `getCurrentIndex`/`getReserveNormalizedVariableDebt` at the same pin — the contract does its own accrual | Yes — never appears as drift |
| 2 | Oracle/price timing (RedStone pull, PriceProviderV2 samples; D-012 sample semantics) | Gated comparisons are entirely in balance space (normalized / scaled); no polled sample is consumed by any gated row — D-012-compliant. The one price-bearing leg is Borrowed emit-time conversion under the stable snap | Yes structurally; the stable-snap depeg residue is a latent UNNAMED class — F6 |
| 3 | Index staleness | None exists at the pin by construction; §3.6 checks the recurrence exactly | Yes |
| 4 | Silent 1-wei residue zeroing (`DebtManagerCore.sol:550-553`) | Modeled as `residue_zeroed`; reclassification flag exists | Mechanism yes; the flag's bound is two-sided and wrong-plane — F2 |
| 5 | Migration genesis set-vs-add + total seeding semantics (replaced implementation) | 7,337 row-count gate; distinct-count gap = adjudication finding | Yes; the aggregate weld (F1) turns this from "unproven" into "measured" |
| 6 | Eventless collateral movement / supplier shares (recon caveats 3–4) | Excluded from event reconcile; freshness-gated with policy bounds; non-gating spot read | Yes — honest, correct per constitution |
| 7 | Pin-boundary semantics (events AT P vs post-block state) | Σ ≤ P inclusive vs eth_call at P (post-state) — consistent | Yes |
| 8 | Mid-run reorg / epoch prune | Fresh-connection `acked_epoch` + `last_block ≥ P` re-check; welds before and after RPC | Yes — prune-immune, correctly rejects `MAX(reorg_epochs.epoch)` |
| 9 | Aave regime boundary (23,088,584) | Deriver-side tx/log-order-aware; both golden pins are regime-B | Adequate; regime-A history has zero gated accounts — F4 |

No mechanism is laundered through exact arithmetic. The two residues are F2 and F6.

---

## 3. Findings

### F1 — BLOCKING — Phantom-debt census gap: never-derived borrowers are structurally unselectable and no aggregate completeness weld exists

**Quantity:** completeness of the derived borrower set against chain truth at P.

**Provenance chain:** sampling CTE (§2) reads `position_events` (engine='debt_manager',
side='debt') → rows exist only for decoded logs in `raw_logs` → logs exist only if the
eth_getLogs walker received them. The zero-net phantom probes cover accounts the DB derived to
zero; they cannot cover accounts the DB never derived at all. Three creation mechanisms for
chain-debt with no `position_events` row: (i) a server-side getLogs omission (exactly the
R-001 trust boundary); (ii) a missing migration batch — covered by the ==7,337 gate because
recon's count was fetched independently; (iii) a debt-mutating emission path of a past
implementation outside the topic0 allowlist (the proxy upgraded at least twice in its first
day; `MigrationBorrowerPositionsSet` itself was discovered only by binary-searching state).
Classes (i) and (iii) are uncovered by every check in the brief.

**Account-level failure scenario:** Safe S borrows 500k USDC at block B; the getLogs chunk
containing B silently omits the log. S never enters `position_events`; no stratum can select
S; every gated row passes; `result:pass` lands in the W1 receipt; the risk surface carries
500k of debt that does not exist in it. This is the anti-canon item verbatim — checking only
accounts you derived — and W1's disproof clause is satisfied vacuously precisely where it
matters most.

**Prescription (cheap, exact, both engines, same pinned reads):**
- **DM, normalized space (no bridge, no floor):** per borrow token t:
  `Σ over ALL accounts of derived net normalized (Σ delta ≤ P grouped by asset)` ==
  `borrowTokenConfig(t).totalNormalizedBorrowingAmount` @ pinHash(P_op)
  (public view `DebtManagerCore.sol:38`). **Bound: ZERO. Derivation:** every contract mutation
  moves the total and the per-user map by the same integer — borrow +normalizedAmount
  (`DebtManagerCore.sol:472-473`), repay −normalizedAmount (`:599`), liquidation
  −normalizedLiquidatedAmount (`:579-580`), residue −1 (`:551-552`). Chain-side
  total ≡ Σ per-user exactly, so derived-Σ == chain-total closes the census: a phantom
  borrower makes derived-Σ < total by their normalized debt. Cost: 8 eth_calls.
  **Named caveat:** the migration-era implementation's total seeding is not in the clone; a
  nonzero weld delta is class `aggregate-mismatch`, exit 1, adjudication of migration
  set-vs-add/total-lockstep semantics — never absorbed, never tolerated.
- **Aave debt, scaled space:** per reserve r: Σ derived scaled debt ==
  `VariableDebtToken(r).scaledTotalSupply()` @ pinHash(P_eth). **Bound ZERO:** mint/burn move
  user scaled and total by the same rayDiv result; BalanceTransfer conserves; the
  DeficitCreated burn is included. 3–4 eth_calls.
- **Aave collateral:** same vs aToken `scaledTotalSupply()`, advisory on the first run
  (treasury-accrual account must be present in the derived Σ; the deriver folds Mint for any
  account, so exactness is expected), promoted to gated after one clean run.
- **Mutation target:** a weld computed over sampled accounts instead of ALL accounts must be
  killed by a named test.

**Residual tail, stated:** compensating errors across accounts inside one token sum to zero in
the weld; per-account sampling is the instrument for those. The two probes jointly bound the
failure space; neither alone does.

### F2 — SHOULD — `--allow-residue-tolerance` bound is two-sided and wrong-plane; replace the epsilon with the exact residue hypothesis test

The mechanism (`DebtManagerCore.sol:550-553`) produces exactly one deviation shape in a
deriver that missed it: derived normalized = chain + 1 — **derived-high only, magnitude
exactly 1**. The brief's "|Δ| ≤ 1 wei normalized" (a) admits a −1 drift (a different bug —
e.g. a floor/ceil inversion on repay) under the residue label, and (b) is evaluated against a
USD-plane comparison where +1 normalized wei surfaces as a USD delta of floor(I/1e18) OR
floor(I/1e18)+1 — i.e. **1 or 2 USD-wei** at I ≈ 1.042e18 — so a literal |Δ|≤1 in USD space
both misses the 2-wei residue case and passes the wrong-direction case.

**Prescription (zero epsilon anywhere):** classify `residue-shaped` iff (i) account is
fully-liquidated, (ii) no `residue_zeroed` event exists for (account, token), and (iii)
`floor((n_d − 1) × I / 1e18) == token.amount` bit-exactly — the hypothesis "the contract
zeroed one normalized wei the deriver kept," tested through the same bridge. Direction is
structurally derived-high-only; injectivity (§1.1) makes the test unambiguous; no tunable
value exists.

### F3 — SHOULD — Scan 2's event-side predicate diverges from the fold predicate

Fold (live `derive.go:291`, rebuild `:546-550`): `side <> '' AND delta IS NOT NULL`. Scan 2 ev
CTE: `delta IS NOT NULL` only. No current event type carries (delta ≠ NULL, side = '') — DM
record-only rows are Delta nil; `aave_liquidation_call` zero-delta rows carry side='debt' —
so the scan is clean today. But a future delta-bearing side-less event would be silently
dropped by the fold and surface in Scan 2 as an ev-orphan under side='' — a real defect under
a confusing label, invitingly "fixable" by narrowing the scan. **Prescription:** keep the wide
predicate deliberately; add a named sub-assertion `COUNT(*) WHERE delta IS NOT NULL AND
side=''` == 0 (sibling of the asset-NULL assertion) with a comment naming the fold predicate
it mirrors, so a divergence is classified taxonomy-violation, not join-noise.

### F4 — SHOULD — Aave gated census is two accounts; liquidation/deficit/regime-A paths have zero gated coverage

Gated Aave rows = 2 golden borrowers; top-10 by |scaled debt| is advisory. No gated account
exercises `LiquidationCall`, `DeficitCreated`, regime-A rounding, or `BalanceTransfer` folds.
Scaled-vs-`scaledBalanceOf` is integer equality — there is no rounding argument available
against gating it, and "first empirical validation" is a reason to expect failure, not to
soften the check: W1's disproof clause does not carve out an engine. **Prescription:** gate
the top-10; add Aave strata (≥2 accounts with `aave_liquidation_call` history, ≥1 with deficit
history or named-empty, ≥3 zero-net-scaled phantom probes asserting `scaledBalanceOf == 0`,
≥2 with regime-A-era events), take-all-and-report degradation as in §2. ~15–25 extra eth_calls
at the same pin. W1's letter is met without this; the risk-desk census is not.

### F5 — SHOULD — Named miss-classes per invariant scan, plus two cheap referential scans

- **Scan 1 (distinct-hash-per-height) misses:** (a) a consistent wrong fork — one wrong hash
  per height conflicts with nothing; only the weld at the single greatest raw_logs block ≤ P
  touches live-chain truth; (b) absence — a missing block/log has no hash to conflict;
  (c) derived rows orphaned from raw rows.
- **Scan 2 misses:** (a) both-sides-identically-wrong — it proves fold materialization, never
  chain truth (its truth companions are the per-account gates and F1's welds); (b) a decode
  path that wrote NULL delta where a balance move belonged — excluded from both sides by
  predicate.
- **Scan 3 (borrow_index monotone) misses:** (a) magnitude errors — a ×10 mis-scale stays
  monotone; (b) missing IIU rows — monotonicity over survivors passes; (equal values are
  legitimate at apy=0 and correctly allowed).

**Prescriptions (SQL-only, same snapshot):**
1. Referential scan `position_events → raw_logs` on (chain_id, tx_hash, log_index): zero
   orphans. Verifies the epoch machinery's outcome as a standing fact instead of trusting it.
2. Same-block-IIU coverage: every block hosting a DM debt-mutating event (borrow / repay /
   liquidation) has a `rate_indexes(kind='borrow_index')` row at that exact block — the
   deriver's own one-IIU-per-mutating-block invariant (`debtmanager.go` sameBlockIndex)
   persisted as a DB fact.
3. Advisory full-history recurrence: consecutive IIU pairs satisfy
   `idx₂ == idx₁ + floor(idx₁·apy·(t₂−t₁)/100e18)` with the payload-sourced APY in force —
   §3.6's single-interval theorem swept across history; advisory because APY pairing across
   the pre-migration implementation boundary is unpinned.

### F6 — NOTE — Stable-snap depeg drift deserves a taxonomy name and a census line

`borrowUsd` prices USDC/USDT/frxUSD borrows under the 1e6 snap; every borrow stamps
`price_source: stable_snap_1e6`; the deriver documents the adjudicated posture (sampled
evidence, stated detection limits). An out-of-band borrow surfaces in reconcile as drift —
currently landing in `unclassified`. Add `stable-snap-suspect` to the classification taxonomy
(diagnosis hypothesis, not a tolerance) and record `COUNT(*) GROUP BY payload->>'price_source'`
for borrow events in the artifact, with the detection limit stated verbatim from the deriver's
doc. Task 9's reconcile IS the sampled evidence that posture promised — the artifact should
say so.

### F7 — NOTE — Freshness `auto` bound is policy; label it

`max(2×SOLVENT_SNAPSHOT_INTERVAL, 2×last_pass_seconds)` is an operator margin, not derived
from any contract mechanic. The design records both inputs; require the resolved bound to be
labeled `policy` in the artifact, in the same spirit as recon's grace-seconds honesty note.
Gating unchanged.

### F8 — NOTE — Collateral-only Safes are outside both the sampling universe and the freshness registry

Registry = distinct debt-side accounts. A Safe holding collateral with zero debt has no
liquidation exposure, so the exclusion is defensible — but state it in the artifact
("collateral-only accounts are out of census by design; they enter on their first debt
event") so the reviewer does not discover it as a surprise.

---

## 4. What survives review unchallenged (for the D-006 reviewer's economy)

Pin choice via derive cursor inside the RR snapshot (atomicity argument holds); dual-pin
golden rows A/B/C; the 7,337 row-count (not distinct-count) gate; the Querier contract;
zero-trim set equality with the proven bridge lemmas; `-tolerance-dm-wei` structural
fail-with-tolerance; second-opinion honesty (never counted as corroboration); prune-immune
rewind detection; the D-012 posture (no polled sample in any gated comparison); the falsifiability
test mode (seed-violation-inside-tx). These are correct as designed.

---

## VERDICT

**NUMBERS DO NOT HOLD.**

**Blocking list:**
1. **F1** — aggregate completeness welds absent: sampling from `position_events` can never
   select a never-derived borrower, and no check compares Σ derived against
   `borrowTokenConfig(t).totalNormalizedBorrowingAmount` (DM, normalized space, zero bound —
   lockstep proven at `DebtManagerCore.sol:472-473/:551-552/:579-580/:599`) or against
   `scaledTotalSupply()` (Aave debt, scaled space, zero bound). Until the welds are in the
   gated set, the phantom-debt half of the evidence is missing and a pass receipt certifies
   only the accounts the pipeline already believed in.

F2–F5 are SHOULD (fix in this wave or carry as named findings into the Codex round with
reasons); F6–F8 are notes for the artifact. With F1 amended as prescribed, the tolerance
policy is theorem-clean end to end and I expect the design to earn **NUMBERS HOLD** on
re-consult without further structural change.

— Solvent risk quant, 2026-07-26
