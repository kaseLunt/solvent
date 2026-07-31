# Same-pin refutation transcript — accept-r4 (Wave H evidence standard)

The corrected gates, fed the UNCHANGED accept-r4 inputs at the SAME pin
hashes, classify every previously-failing row. Adjudicated standard
(progress-phase3.md, DISSECTION VERDICT / RISK-QUANT RULING / CHAIN-TRUTH
RULING on accept-r4): a fresh-pin pass alone proves nothing; the refutation is
judged against the run's own artifact.

- Pins: OP 154938071 hash
  `0xaf91dd4ba1975fc3b93e411586ce267892406ed8cb7152c5cefe1c368696c6bc`;
  ETH 25650676 hash
  `0x8197fee7a752a5e22d20c3d05e57ec510779753ff949f29343f46860d969d147`.
- Artifact: the accept-r4 `drift-report.json` (comparison sha256
  `38a57b3eb111af13ff57b9d67d27c5c89f7ef3666deb2840058f6d960a88778d`),
  secured to session scratch before the acceptance worktree was removed.
- Mechanism: `cmd/reconcile/acceptr4_refutation_live_test.go` — a committed,
  re-runnable opt-in live test (`SOLVENT_ACCEPT_R4_REFUTE=1`,
  `SOLVENT_ACCEPT_R4_ARTIFACT=<path to drift-report.json>`, RPC via
  `SOLVENT_RECON_RPC_OP` / `SOLVENT_RECON_RPC_ETH`, DB via the repo config's
  strictly-read-only DSN, SELECT-only). It parses the artifact's own rows for
  its targets, so the refutation cannot drift from what the run reported.
- Executed 2026-07-31 against the live database (SELECT-only) and the recon
  RPC endpoints; both tests PASS. Verbatim outcomes below.

## Part B — aave_hf zero-debt census: 24/24 REFUTED

`TestAcceptR4SamePinRefutationZeroDebtCensus` (PASS, 7.49s):

```
targets: 24 zero-debt census rows
reserves at the accept-r4 pin: 4
collateral-flag ledger rows at the pin: 94
one-law non-members: 24/24; chain zero-collateral confirmed: 24/24; scaledBalanceOf welds bit-exact: 96/96
flag provenance: never-enabled (no fold row) 22, explicit flag row(s) in custody 2
```

Per-class outcome:

| class | count | meaning |
|---|---|---|
| one-law non-member | **24/24** | every account the flag-blind census asserted is a NON-member under the adjudicated one law (scaled balance > 0 AND derived flag ON AND flag-gated value projection > 0) — the derived census now agrees with the chain's |
| chain zero-collateral re-confirmed | **24/24** | `getUserAccountData.totalCollateralBase == 0` at the same pin hash — the only-derived direction stands |
| scaledBalanceOf@pinHash weld | **96/96 bit-exact** (24 accounts x 4 reserves, zero tolerance) | the flag-off masking residual is CLOSED per account: every raw scaled balance the flag gate removes from the census is proven correct against the chain at the pin — aggregate-only evidence converted to per-account proof |
| flag provenance | 22 never-enabled, 2 explicit custodied flag rows | matches the dissection's exemplar classes (never-enabled: no auto-enable on this market; explicit: the aave_collateral_disabled event in custody at block 22,551,863) |

Accounts that did NOT refute: **none**.

## Part A — dm_boolean_weld getMaxBorrowAmount: the 233

INPUT-RECOVERY NOTE (stated, not hidden): by refutation time the resumed
sweeper had re-swept ALL 233 accounts above the pin, and ApplySweepBatch
replaces position_balances legs wholesale — the LIVE rows are not the
accept-r4 inputs. The inputs survive in the `snapshots` HISTORY table
(ApplySweepBatch writes each account's collateral document there atomically
with the balances, keyed by block; only reorg rewinds delete). The newest
`side='collateral'` document at `block_number <= P_op` IS accept-r4's vector
and its block IS S(account). Every account's recovered vector is FIRST proven
to be the accept-r4 input by reproducing the artifact's own `actual_derived`
bit-exactly at the pin (same inputs -> the same number), before any own-clock
weld is credited.

`TestAcceptR4SamePinRefutationDMMaxBorrow` (PASS, 104.12s):

```
targets: 233 dm maxBorrow drift rows
accept-r4 vectors recovered from snapshots HISTORY: 233/233 (live watermark re-swept above the pin: 233 — the live legs are gone, the history rows are not; missing history: 0)
same-input proof: 233/233 reproducible vectors reproduce the artifact's actual_derived bit-exactly at the pin
distinct sweep blocks S: 72 (S is deep-finalized; each group shares one hash resolution and one multicall)
own-clock welds over the reproducible set: bit-exact 233, custody-drift 0, unread 0; sweep age (blocks) min 124 max 2499
```

Per-class outcome:

| class | count | meaning |
|---|---|---|
| input recovery | **233/233** | every accept-r4 collateral vector recovered from the snapshots history table (0 missing), despite all 233 live watermarks having moved above the pin |
| same-input proof | **233/233 bit-exact** | pin recompute over the recovered vector (pin prices via `convertCollateralTokenToUsd@pinHash`, param ledger <= P_op, `internal/risk.ComputeDMHealth` — the ONE law, internal/risk/dm.go:102-134 / DebtManagerCore.sol:139-165) reproduces the artifact's `actual_derived` exactly — these ARE the unchanged accept-r4 inputs |
| own-clock weld @hash(S(account)) | **233/233 bit-exact** -> **sample-gap(disclosed)** | recompute over the SAME vector with prices@S and the param ledger re-cut at <= S equals `getMaxBorrowAmount(user,false)@blockHash(S)` for every account, across 72 distinct sweep blocks, ages 124–2499 blocks below the pin — the corrected three-state law classifies all 233 as sample-gap, report-only |
| snapshot-custody-drift | **0** | the arm that would FLIP the adjudicated verdict stayed empty — the dissection's 5/5 own-clock byte-identity generalizes to the full 233 |
| own-clock unread | **0** | every discrimination read answered at its hash-bound S |

Accounts that did NOT refute: **none** (233/233 + 24/24 = 257/257 previously-
failing rows classify correctly under the corrected gates at the same pins;
the remaining 26 of accept-r4's 283 were the 3 input_frame_law rows — closed
structurally by fixes 3/4/5, the stale declarations now consumed and the
undeclared source now declared-and-derived — plus the 16 tokenconfig model
findings (Wave S's scenario matrices + this wave's loader consuming them) and
the 6 backtest rows (1 closed by the third shape; 5 fail-closed
intra-block-recompute-unpriced rows deliberately LEFT fail-closed — the
historical-price custody extension is not this wave's arm).

## RPC cost (names only, per the brief)

Part A: 72 headerHash resolutions + batched multicalls at 72 distinct S
hashes plus 2 pin-clock batches (~460 inner calls total) through
`SOLVENT_RECON_RPC_OP` at the canonical 1.5 rps — 104s wall. Part B: one
reserve-state batch + one 120-call subject batch through
`SOLVENT_RECON_RPC_ETH` — 7.5s wall. No rate-limit backoff was triggered.

