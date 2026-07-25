# Task 4 report (Phase 2): `internal/decode` — typed event decoding for every ingest stream

Commit: `4d2f4ba` — `feat: typed event decoding for all ingest streams`
(pathspec: `-- internal/decode config/contracts.json`, 38 files changed, 9752 insertions)

## Status

COMPLETE. All 45 tests pass (`go test ./internal/decode/ -v`; corrected from this report's original,
incorrect "40" claim -- see "Fix wave" below), `go test ./internal/config/ -v` passes
(12/12, including `TestProductionContractsJSONParses` against the 8-stream-larger
`config/contracts.json`), full `go test ./...` is green, `gofmt -l internal/decode/` is empty,
`go vet ./...` is clean.

## What was built

- `internal/decode/events.go` — `Event` interface + 21 concrete decoded-event types covering
  every field the brief specified verbatim, plus `MigrationSeed` (calldata-derived) and
  `ATokenBalanceTransfer` (a documented beyond-brief addition — see "Deviations" below).
- `internal/decode/decode.go` — `Registry`/`NewRegistry()`/`Decode(engine, store.RawLog) (Event, bool, error)`;
  embedded ABIs (`//go:embed`) for `DebtManagerCore`, `DebtManagerAdmin`, `AaveV3Pool`, `AToken`,
  `ChainlinkAggregator`; a hand-authored `MigrationBorrowerPositionsSet` ABI entry; two hand-authored
  outer-calldata ABIs (`commitAndExecute`, `execute302`) for `DecodeMigrationCalldata`. Decode contract
  implemented exactly as specified: unknown engine or unallowlisted topic0 → `(nil, false, nil)`;
  known topic0 + malformed data → `(nil, false, err)`; a top-level `recover()` converts any reflection
  panic into an error so a single bad log can never crash a caller.
- `internal/decode/abis/*.json` + `README.md` — embedded ABI copies with provenance (recon re-exports
  for the three recon-sourced ABIs; fetched-and-documented for `AToken.json`/`ChainlinkAggregator.json`).
- `internal/decode/decode_test.go` — registry-contract tests (skip vs. error semantics, ABI
  cross-check between `DebtManagerCore`/`DebtManagerAdmin`, migration-seed 65536 bound at exactly
  the boundary and one over, malformed-selector/short-input/malformed-args paths, panic-recovery).
- `internal/decode/fixtures_test.go` + `internal/decode/testdata/*.json` (27 files) — table-driven,
  fixture-loaded assertions for every event type plus the two migration-calldata transactions.
- `config/contracts.json` — 8 new streams: 4 `eth:atoken-<sym>` (engine `aave_v3_etherfi`) + 4
  `eth:feed-<sym>` (engine `chainlink_feed`).

## Discovery step: aToken addresses (4/4, all code-verified)

| Symbol | aToken address | `symbol()` | `name()` |
|---|---|---|---|
| weETH | `0xbe1F842e7e0afd2c2322aae5d34bA899544b29db` | aEthEtherFiweETH | Aave Ethereum EtherFi weETH |
| USDC | `0x7380c583cDe4409eFF5DD3320D93a45D96B80E2e` | aEthEtherFiUSDC | Aave Ethereum EtherFi USDC |
| PYUSD | `0xdF7f48892244C6106EA784609f7de10AB36F9c7e` | aEthEtherFiPYUSD | Aave Ethereum EtherFi PYUSD |
| FRAX | `0x6914ECCf50837dC61b43ee478a9BD9B439648956` | aEthEtherFiFRAX | Aave Ethereum EtherFi FRAX |

Discovered via `cast call <POOL> "getReserveData(address)(...)" <reserve>` per Debt Manager /
Aave asset registry in recon; all four `cast code`-verified non-empty. All four `eth:atoken-<sym>`
streams use `startBlock 20625519` (the market deployment block, per brief simplification — no
aToken logs predate the pool). Feed streams use `recon/feeds.json`'s per-aggregator `startBlock`.

## Migration calldata: an important correction to recon's prose

Recon's "Migration finding" describes the payload loosely as `(address,uint256)[]`. Byte-level
analysis of two real migration transactions (one full 50-seed batch, one single-seed batch, on two
*different* LayerZero delivery paths — `commitAndExecute` selector `0xdcfdeb60` and `execute302`
selector `0xcfc32570`) shows the nested LZ `message` is actually `abi.encode(address[] borrowers,
uint256[] amounts)` — two independently-length-prefixed parallel arrays, not an interleaved tuple
array. This was verified by hand (byte offsets reconstructed and cross-checked against Blockscout's
decoded_input) and is now implemented and tested against both real transactions, including a
cross-check that borrower `0xac5f3ce9…5fcc` (recon's example of event-invisible debt genesis)
decodes to normalized amount `30578521`, consistent with recon's later `borrowingOf` reading.

## Fixture provenance (27 files, ≥2 real per event type except where noted)

| Event | Real | Synthetic | Notes |
|---|---|---|---|
| DMBorrowed | 2 | 0 | |
| DMRepaid | 2 | 0 | |
| DMSupplied | 1 | 1 | Real flow found only once after sweeping ~450k OP blocks; synthetic fills the pair |
| DMWithdrawBorrowToken | 0 | 2 | Never emitted on-chain to date (exhaustive full-history sweep) |
| DMLiquidated | 2 | 0 | Entry 1 is the recon-cited golden liquidation vector (beforeDebtUsd 31,690,519 / debtAmountLiquidated 15,845,260 match exactly) |
| DMInterestIndexUpdated | 2 | 0 | |
| DMBorrowApySet | 1 | 1 | Only 1 real occurrence found across full history |
| DMBorrowTokenConfigSet | 2 | 0 | |
| DMCollateralTokenAdded | 2 | 0 | |
| DMCollateralTokenRemoved | 0 | 2 | Never emitted on-chain to date |
| DMCollateralTokenConfigSet | 2 | 0 | |
| DMMigrationBorrowerPositionsSet | 2 | 0 | Blocks 149,985,513 (count=1) and 149,985,787 (count=50) |
| AaveBorrow | 2 | 0 | Includes recon's golden borrower `0x70daaac4…e5fe` |
| AaveRepay | 2 | 0 | |
| AaveSupply | 2 | 0 | Includes golden borrower |
| AaveWithdraw | 2 | 0 | |
| AaveLiquidationCall | 2 | 0 | Entry 1 is a real bad-debt liquidation (same tx as DeficitCreated fixture 1) |
| AaveReserveDataUpdated | 2 | 0 | |
| AaveDeficitCreated | 2 | 0 | |
| ATokenTransfer | 2 | 0 | |
| ATokenMint | 2 | 0 | |
| ATokenBurn | 2 | 0 | |
| ATokenBalanceTransfer | 2 | 0 | Beyond-brief addition (see below) |
| ChainlinkAnswerUpdated | 2 | 0 | |
| Migration calldata (commitAndExecute) | 1 | 0 | 50 seeds, hand-verified first/last/target-borrower |
| Migration calldata (execute302) | 1 | 0 | 1 seed |

All real fixtures were fetched via `eth_getLogs`/Blockscout, then **re-verified byte-for-byte
against a raw `eth_getTransactionReceipt`** before being committed, so none depend on Blockscout's
own decoding. Every fixture file carries a `provenance` field (block, tx, fetch method, and for
hand-verified fields, the exact expected values).

## TDD evidence

```
go test ./internal/decode/ -v   → 45/45 PASS (corrected from this report's original, incorrect
                                    "40/40" claim -- see "Fix wave" below)
go test ./internal/config/ -v   → 12/12 PASS (incl. TestProductionContractsJSONParses)
go test ./...                   → ok (chain, config, decode, ingest, store)
gofmt -l internal/decode/       → (empty)
go vet ./...                    → (clean)
```

## Deviations from the literal brief (both additive, documented)

1. **`ATokenBalanceTransfer`** was added even though Task 4's Event roster names only
   `ATokenTransfer/Mint/Burn`. The full plan (`docs/plans/2026-07-22-solvent-phase2-positions-prices.md`,
   Task 6) explicitly requires `Transfer/BalanceTransfer` for the Aave deriver's scaled-balance
   model, so it was included with real fixtures rather than left for Task 6 to discover missing.
2. **`DMBorrowTokenAdded`/`DMBorrowTokenRemoved`** were deliberately *not* implemented, even
   though real `BorrowTokenAdded` logs were found during fixture-hunting — the brief's roster lists
   only `CollateralTokenAdded/Removed` and `BorrowTokenConfigSet` on the borrow side, and no
   downstream task text calls for the Added/Removed pair, so scope was kept to the letter of the
   roster (unregistered topic0s simply skip, which is contractually correct).

## Concerns / carry-overs for Task 5/6

- `DMWithdrawBorrowToken` and `DMCollateralTokenRemoved` have zero real on-chain occurrences to
  date (confirmed via an exhaustive multi-hundred-thousand-block sweep) — synthetic fixtures are
  the only evidence until real usage appears; Task 9's reconciliation should flag if this changes.
- `DecodeMigrationCalldata` supports exactly the two calldata shapes observed (`commitAndExecute`,
  `execute302`); if any of the other ~78 migration txs use a third LayerZero delivery method, Task 5
  will get a clear "unrecognized selector" error rather than silent misparse — worth a quick spot
  check across all 80 txs before Task 5's genesis replay depends on it.

## Fix wave

A consolidated post-review fix wave was applied to `internal/decode` (commit follows this report's
last revision). Four fixes, all scoped to `internal/decode/**`:

1. **Strict fail-closed migration-calldata parser.** `unpackAddressUint256Arrays` (decode.go) no
   longer trusts go-ethereum's generic `abi.Arguments.Unpack` for the `(address[] borrowers,
   uint256[] amounts)` LZ message payload — these bytes seed the majority of migrated borrowers'
   debt genesis, so a permissive decoder was a real risk. It's now a manual, allocation-safe parser
   that: validates both head words are canonical offsets (64 and 64+32+32*lenA); reads both array
   lengths and bounds-checks them against `maxMigrationSeeds` (65536) *before* any `make()`;
   requires the tails to exactly and non-overlappingly consume the payload (no trailing bytes);
   requires every address word's upper 12 bytes to be zero (no dirty padding); and finishes with a
   canonicality backstop that re-encodes the parsed arrays via the `abi` package and byte-compares
   against the original payload. Five distinct error texts: `"non-canonical offset"`,
   `"trailing bytes"`, `"dirty address padding"`, `"array length mismatch"`, `"fan-out exceeds"`.
   `DecodeMigrationCalldata`'s exported signature and the `"migration calldata: ..."` /
   `"unrecognized selector"` / `"too short"` error-prefix contracts are unchanged. Six new synthetic
   adversarial tests added (`decode_test.go`): trailing garbage, dirty address padding, mismatched
   array lengths, an oversized (2^40) length word that must error *before* allocation (a 96-byte
   input, no explicit timeout needed — the point is that it can't hang), an offset pointing into the
   head instead of past it, and a canonical-round-trip control. Both real migration-calldata
   fixtures (`migration_calldata_commit_and_execute.json`, 50 seeds;
   `migration_calldata_execute302.json`, 1 seed) still decode byte-identically under the new parser.

2. **aToken event doc-comment fold contract** (events.go). `ATokenTransfer`, `ATokenMint`,
   `ATokenBurn`, and `ATokenBalanceTransfer` now each carry an explicit contract comment for Task 6's
   Aave deriver: Transfer is RECORD-ONLY (always an overlapping view of a same-tx Mint/Burn/
   BalanceTransfer — never fold); Mint/Burn's `Value` is NOT the action principal (it includes/nets
   `BalanceIncrease`; `Value==BalanceIncrease` means pure interest, zero principal; scaled deltas
   must come from the deployed implementation's source); BalanceTransfer's `Value` is already scaled
   and must be applied exactly once per peer transfer. No decoding behavior changed.

3. **Address-blind (engine, topic0) keying safety comment** (decode.go, on `Registry.Decode`).
   Documents why dispatching purely on `(engine, topic0)` — never consulting `l.Address` — is safe
   today: every stream in `config/contracts.json` pins a single contract address, so e.g. the
   `aave_v3_etherfi` engine's shared aToken topic table can only ever see an ERC20 Transfer
   originating from one of the four pinned aToken addresses. Flags that any future multi-address or
   wildcard/discovery stream must revisit this assumption. No behavioral change.

4. **This report correction.** The original Status and TDD-evidence sections both claimed
   `40`/`40/40` passing tests; the actual `internal/decode` suite at the time this report was written
   was **45/45** (verified via `go test ./internal/decode/ -v | grep -c -- "--- PASS"`), not 40 — both
   occurrences are now corrected above. After this fix wave's six new adversarial tests, the suite is
   **51/51**.

### Test evidence (fix wave)

```
go test ./internal/decode/ -v | grep -c -- "--- PASS"   → 51   (was 45 before this fix wave;
                                                              this report originally, incorrectly,
                                                              said 40)
gofmt -l internal/decode/                                → (empty)
go vet ./internal/decode/                                → (clean)
go test ./internal/decode/ -v                            → 51/51 PASS, including all pre-existing
                                                              fixture tests byte-identical and both
                                                              real migration-calldata fixtures
go test ./...                                             → ok (chain, config, decode, ingest, store)
```

## Fix wave 2 (outer layer)

A second, narrower fix wave applied to `internal/decode` in response to the Codex approval pass
(session `019f8da7-829e-7173-8f31-dfbd70c81132`), two findings, both scoped to `internal/decode/**`:

1. **Outer-layer full-consumption canonicality backstop [medium].** The inner migration-message
   parser (`unpackAddressUint256Arrays`) was already strict/fail-closed, but the OUTER calldata layer
   -- `commitAndExecute`/`execute302` argument unpacking, `extractCommitAndExecuteMessage` /
   `extractExecute302Message` in decode.go -- still called go-ethereum's generic
   `abi.Arguments.Unpack` directly and trusted it. Concrete repro from the review: appending one
   32-byte word to either real fixture's `input` decoded successfully before this fix. New helper
   `unpackOuterCanonical(args abi.Arguments, data []byte, label string) ([]interface{}, error)`
   (decode.go) unpacks, then re-`Pack`s the unpacked values with the same `abi.Arguments` spec and
   byte-compares the result against `data` (the original calldata minus the 4-byte selector, already
   what both extract functions receive). Any mismatch -- trailing bytes, dirty upper-12-byte address
   padding, non-canonical offsets, or aliased dynamic-field tails -- surfaces as a re-encode
   difference and errors `"<label>: non-canonical outer calldata"` (label is `"commitAndExecute"` or
   `"execute302"`), text kept deliberately distinct from every inner-parser error string. Both
   `extractCommitAndExecuteMessage` and `extractExecute302Message` now route through this helper;
   `DecodeMigrationCalldata`'s exported signature and its own error-prefix contract
   (`"migration calldata: ..."` / `"unrecognized selector"` / `"too short"`) are unchanged.

   Four new tests (`decode_test.go`), all mutating the two REAL migration-calldata fixtures (not
   synthetic): `TestDecodeMigrationCalldataCommitAndExecuteTrailingWordErrors` and
   `TestDecodeMigrationCalldataExecute302TrailingWordErrors` append one garbage 32-byte word after
   complete calldata; `TestDecodeMigrationCalldataCommitAndExecuteDirtyOuterAddressPaddingErrors` and
   `TestDecodeMigrationCalldataExecute302DirtyOuterAddressPaddingErrors` flip the high byte of an
   outer address word's zero-padding region (`_receiveLib`'s word at input offset 4 for
   commitAndExecute -- always its first, static-address argument; `_executionParams.receiver`'s word
   at input offset 36 for execute302 -- always immediately after the sole dynamic-tuple argument's
   canonical offset-32 head word). All four assert the new `"non-canonical outer calldata"` text. The
   regression pin -- both unmodified real fixtures still decode byte-identical seeds -- is carried by
   the pre-existing `TestDecodeMigrationCalldataCommitAndExecute` / `TestDecodeMigrationCalldataExecute302`
   (fixtures_test.go), which continue to pass unchanged under the new backstop.

2. **Corrected the false Burn doc-comment equality claim [low]** (events.go). The prior
   `ATokenBurn` comment claimed `Value==BalanceIncrease` means pure interest / zero principal --
   wrong. Per Aave's `ScaledBalanceTokenBase`, `Burn.Value = actionAmount - BalanceIncrease`, so
   `Value==BalanceIncrease` actually implies `actionAmount == 2*BalanceIncrease`, not zero. The
   zero-principal reading is true only for `Mint` (`Mint.Value = actionAmount + BalanceIncrease`, so
   `Value==BalanceIncrease` there does mean `actionAmount == 0`). Rewrote the `ATokenBurn` doc with
   the correct subtraction formula and an explicit note that the zero-principal reading does not
   transfer from Mint; confirmed and clarified the `ATokenMint` doc's own (already-correct) addition
   formula in passing. No behavioral/decoding change -- doc-only.

### Test evidence (fix wave 2)

```
gofmt -l internal/decode/                              → (empty)
go vet ./internal/decode/                               → (clean)
go vet ./...                                            → (clean)
go test ./internal/decode/ -v | grep -c -- "--- PASS"   → 55   (was 51 before this fix wave)
go test ./internal/decode/ -v                           → 55/55 PASS, all pre-existing tests
                                                             byte-identical including both real
                                                             migration-calldata fixtures
go test ./...                                           → ok (chain, config, decode, ingest, store)
```

Report path: `C:\Users\kasel\source\repos\etherfi\Solvent\.superpowers\sdd\task-4-report-p2.md`
