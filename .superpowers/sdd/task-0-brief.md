### Task 0: Derivation-semantics & oracle recon

**Files:**
- Create: `recon/derivation-notes.md`
- Create: `recon/feeds.json`

**Interfaces:**
- Consumes: `recon/cash-v3/` clone (exists, gitignored), `recon/abis/*.json`, live RPCs, existing `raw_logs` rows in the local db.
- Produces: `recon/derivation-notes.md` — the semantics contract Tasks 4–6 are authored from; `recon/feeds.json` matching the schema in Step 5 (consumed by Task 8 and by the Task 3 config extension).

- [ ] **Step 1: Pin Debt Manager event parameter semantics from source**

```bash
cd /c/Users/kasel/source/repos/etherfi/Solvent
grep -n "event Borrowed\|event Repaid\|event Supplied\|event Liquidated\|event WithdrawBorrowToken\|event UserInterestAdded\|event InterestIndexUpdated\|event TotalBorrowingUpdated" -r recon/cash-v3/src/ --include="*.sol" -A 2
```
For each of the eight signatures, record in `derivation-notes.md`: parameter names in order, which are indexed, units (underlying token decimals vs shares), and the state transition it implies (who's the account, which side moves, sign of delta). Read the emitting function bodies (`grep -n "emit Borrowed" -r recon/cash-v3/src/ -B 20` etc.) — do not guess from names. Explicitly answer: (a) does `Repaid` amount include interest? (b) is `UserInterestAdded` the ONLY debt-growth path between borrow events, i.e. does `Σ Borrowed − Σ Repaid + Σ UserInterestAdded = borrowingOf()` hold exactly? (c) what does `Liquidated`'s tuple array `(address,uint256,uint256)[]` contain per element? (d) does `Supplied`'s first/second address distinguish payer vs credited account?

- [ ] **Step 2: Validate the debt identity empirically against live state**

Pick 3 borrower addresses from recent `Borrowed` logs (query local db: `SELECT DISTINCT substring(topics[2] from 13) FROM raw_logs WHERE chain_id=10 AND topics[1]='\x3fc499aeb0bb1cb58b6de8b02b3f86f4e7394e9690bef0110e32ced8a5631045' ORDER BY 1 LIMIT 3` — adjust topic index after Step 1 pins indexing). For each, at current head: `cast call 0x0078C5a459132e279056B2371fE8A8eC973A9553 "borrowingOf(address)((address,uint256)[])" <ADDR> --rpc-url https://mainnet.optimism.io` and same for `collateralOf`. Record outputs. Then hand-sum that borrower's decoded events from `raw_logs` (a throwaway script or SQL is fine — show it in the notes) and record match/mismatch per Step 1(b). **A mismatch is a finding, not a failure — document the gap and the missing event/mechanism.** Note: `raw_logs` currently covers OP from 149,521,228 to the Phase 1 cursor (~150.1M); if the chosen borrower's history predates coverage or the backfill gap matters, either resume the indexer to close the gap first (Task 9 does this anyway) or pick borrowers whose entire event history falls inside covered blocks (verify with a MIN(block_number) query per borrower).

- [ ] **Step 3: Enumerate both engines' asset sets**

```bash
CAST="$HOME/.foundry/bin/cast.exe"
$CAST call 0x0078C5a459132e279056B2371fE8A8eC973A9553 "getCollateralTokens()(address[])" --rpc-url https://mainnet.optimism.io
$CAST call 0x0078C5a459132e279056B2371fE8A8eC973A9553 "getBorrowTokens()(address[])" --rpc-url https://mainnet.optimism.io
$CAST call 0x0AA97c284e98396202b6A04024F5E2c65026F3c0 "getReservesList()(address[])" --rpc-url https://ethereum-rpc.publicnode.com
```
(If the Debt Manager selectors differ, find them: `jq -r '.abi[] | select(.type=="function") | .name' recon/abis/DebtManagerCore.json | grep -i token`.) For every address: symbol + decimals via `cast call <TOKEN> "symbol()(string)"` / `"decimals()(uint8)"`. Record full addresses (no ellipses) in both notes and `feeds.json`.

- [ ] **Step 4: Discover price-oracle wiring per asset**

Debt Manager side: find the price provider — `jq -r '.abi[] | select(.type=="function") | .name' recon/abis/DebtManagerCore.json | grep -iE "price|oracle"`, then read the deployments file (`cat recon/cash-v3/deployments/mainnet/10/deployments.json | grep -iE "price|oracle"`) and call it per collateral token to confirm it returns a price (record units/decimals). Determine mechanism: RedStone pull (no logs → poll-only) vs push feed (has `AnswerUpdated`-style logs → historical stream possible). Aave side: per reserve, `$CAST call 0x43b64f28A678944E0655404B0B98E443851cC34F "getSourceOfAsset(address)(address)" <ASSET> --rpc-url https://ethereum-rpc.publicnode.com`; for each source, check `cast code` non-empty and whether it's a Chainlink aggregator (`$CAST call <SOURCE> "description()(string)"` succeeds) — if yes, record the underlying aggregator (`"aggregator()(address)"`) whose `AnswerUpdated(int256,uint256,uint256)` logs (topic0 `0x0559884fd3a460db3073b7fc896cc77986f16e378210ded43186175bf646fc5f`) become walker streams; record each feed's `decimals()`.

- [ ] **Step 5: Write `recon/feeds.json`** (exact schema — Task 8 and config extension consume it)

```json
{
  "assets": [
    {
      "chain": "op",
      "engine": "debt_manager",
      "address": "0xFULL_ADDRESS",
      "symbol": "weETH",
      "decimals": 18,
      "roles": ["collateral"],
      "oracle": {
        "kind": "poll",
        "contract": "0xPRICE_PROVIDER",
        "method": "price(address)",
        "priceDecimals": 8
      }
    },
    {
      "chain": "eth",
      "engine": "aave_v3_etherfi",
      "address": "0xFULL_ADDRESS",
      "symbol": "USDC",
      "decimals": 6,
      "roles": ["collateral", "debt"],
      "oracle": {
        "kind": "chainlink_stream",
        "contract": "0xAGGREGATOR",
        "startBlock": 0,
        "priceDecimals": 8
      }
    }
  ]
}
```
Every entry fully populated from Steps 3–4 (`kind` ∈ `poll` | `chainlink_stream`; `startBlock` = aggregator deployment block for stream kinds, found via first `AnswerUpdated` log or explorer creation tx). No placeholder values may survive.

- [ ] **Step 6: Write `recon/derivation-notes.md` and commit**

Structure: `## Debt Manager event semantics` (table: event → params/indexing → state transition → units) · `## Debt identity validation` (3 borrowers, event-sum vs view call, verdict) · `## Aave derivation model` (scaled-balance + index approach given ReserveDataUpdated; expected precision) · `## Asset registry` · `## Oracle wiring` (mechanism per side, poll vs stream) · `## Contradictions with plan scope` (empty if none). Commit:
```bash
git add recon/derivation-notes.md recon/feeds.json
git commit -m "docs: Phase 2 recon — event semantics, asset registry, oracle wiring"
```
**GATE:** controller reviews the notes and authors Tasks 4–10 steps. Stop for the user only if `## Contradictions with plan scope` is non-empty.

---

