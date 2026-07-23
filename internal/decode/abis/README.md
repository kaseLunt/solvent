# Embedded ABIs — provenance

All files are `{"abi": [...]}` (trimmed forge/Blockscout artifacts — bytecode,
sourceMap, methodIdentifiers etc. stripped; only the ABI array is kept).
`internal/decode/decode.go` parses each via the shared `abiWrapper` struct
(`json:"abi"`), so any sibling keys — including `_provenance` where present —
are ignored at runtime and exist purely for this documentation.

| File | Source | Notes |
|---|---|---|
| `DebtManagerCore.json` | Re-export of `recon/abis/DebtManagerCore.json` (Phase 2 Task 0 recon, `recon/cash-v3` clone), abi array only. | Full Debt Manager event set (21 events) — matches `DebtManagerAdmin.json` exactly (`TestDebtManagerCoreAndAdminEventsMatch` pins this). |
| `DebtManagerAdmin.json` | Re-export of `recon/abis/DebtManagerAdmin.json`. | Sourced per the task brief alongside Core; identical event set, used for the cross-check test rather than as the primary parse target. |
| `AaveV3Pool.json` | Re-export of `recon/abis/AaveV3Pool.json` (already `{"abi": [...]}` in recon). | Aave v3.3-line Pool: `DeficitCreated`, `PositionManagerApproved`, no stable-rate borrowing. |
| `AToken.json` | Fetched 2026-07-22 from Blockscout (`eth.blockscout.com`) API v2 `smart-contracts` endpoint for the shared AToken implementation `0xdc7B6B0Acf2FB6927526E2C501De41eaeae8702A` ("ATokenInstance"), resolved from the proxy at `aEthEtherFiUSDC` (`0x7380c583cDe4409eFF5DD3320D93a45D96B80E2e`) via its `implementations` field. | Same implementation behind all four ether.fi-market aTokens (weETH/USDC/PYUSD/FRAX), discovered via `Pool.getReserveData(reserve).aTokenAddress` and code-verified. See the `_provenance` field in the file itself. |
| `ChainlinkAggregator.json` | Fetched 2026-07-22 from Blockscout for the raw USDC/USD aggregator `0xc9E1a09622afdB659913fefE800fEaE5DBbFe9d7` (an `AccessControlledOCR2Aggregator`), trimmed to `AnswerUpdated`/`NewRound` + a few read functions. | `AnswerUpdated(int256 indexed current, uint256 indexed roundId, uint256 updatedAt)`, topic0 `0x0559884fd3a460db3073b7fc896cc77986f16e378210ded43186175bf646fc5f` (matches `cast sig-event`), is the event signature shared by all four ether.fi-market feed aggregators in `recon/feeds.json`. |

Two additional ABIs are hand-constructed in `decode.go` (not files here, since
they are not verified/published contracts in the usual sense but observed
calldata shapes) and validated against real on-chain transactions in
`testdata/migration_calldata_*.json`:

- `MigrationBorrowerPositionsSet(address indexed token, uint256 count)` —
  emitted by a since-replaced Debt Manager implementation; topic0 confirmed
  via `cast sig-event` and against real logs.
- `commitAndExecute(...)` / `execute302(...)` — the two LayerZero delivery
  paths observed among the 80 migration transactions; selectors confirmed
  via `cast sig` against real calldata.
