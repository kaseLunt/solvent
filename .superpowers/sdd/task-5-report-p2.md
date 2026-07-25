# Task 5 report (Phase 2): Debt Manager normalized-debt deriver with migration genesis

Implementer: fable (parallel with Task 6 / aave deriver; disjoint files, pathspec commits).
Scope: `internal/derive/debtmanager.go`, `internal/derive/debtmanager_test.go`,
`internal/derive/rpc_fixtures_test.go` (build-tagged RPC tooling), `internal/derive/testdata/**`,
plus the sanctioned ONE additive method in `internal/chain` (`Failover.TxCalldata`).
Normative source: `recon/derivation-notes.md` ("Debt Manager event semantics", "Debt identity
validation", "Migration finding", caveats 1-2). Frozen interfaces untouched: `derive.Engine`
(engine.go), decode layer (Codex-approved @ d8c462b), store layer (@ 1ea4bad).

## STEP 0 (mandatory): 80-tx migration sweep — PASSED

Tool: `internal/derive/rpc_fixtures_test.go` `TestStep0MigrationSweep` (build tag `rpcfixtures`,
excluded from normal builds; run against live OP RPC 2026-07-23). Method: eth_getLogs for topic0
`0x3f1c4431cbe26a58837755d2461e40a6561ee3edd0e31ca91edb845637acda8b` on the Debt Manager
`0x0078C5a459132e279056B2371fE8A8eC973A9553`, blocks 149,985,513-149,986,254; each log's tx
fetched by hash; full calldata through the hardened `decode.DecodeMigrationCalldata`.

Assertions, all held:
- exactly **80 logs**, in **80 distinct txs** (no double-log tx — seeds can never double-count);
- **every selector handled**: `0xdcfdeb60` commitAndExecute (11 txs), `0xcfc32570` execute302 (69 txs); zero decode failures;
- **per-log `Count` == len(decoded seeds)** for all 80;
- **Σ seeds = 7,337** exactly (recon "Migration finding").

Bonus finding pinned: the golden liquidation-vector Safe `0xac5f3ce9…5fcc` is seeded in tx
`0x03f41623…bb86f` (block 149,985,787) with normalized **30,578,521** — byte-agreeing with the
Task 4 decode fixture provenance.

Per-tx table (block / tx / selector / log Count / decoded seeds / batch Σ normalized):

| # | block | tx | selector | Count | seeds | Σ normalized (batch) |
|---|-------|----|----------|-------|-------|----------------------|
| 0 | 149985513 | 0xf57febcab9e40b18b13fe6e24dc0c846935eed5423b41443dfd287aae582f454 | 0xcfc32570 | 1 | 1 | 870004 |
| 1 | 149985764 | 0x63504486c1edc7c8abc2446db9a83e5140872fd16eb3304279900f45b6e30a49 | 0xdcfdeb60 | 50 | 50 | 881688640110 |
| 2 | 149985787 | 0x03f41623acdf48db4f51b1f0dcf87a0e89c0d66e42b8e23cd0b4f04fc99bb86f | 0xdcfdeb60 | 50 | 50 | 662035975266 |
| 3 | 149985806 | 0x092a90945ca72cc6abc21900c4176e9bc59ff9ff23c78efb23d58aa3bc1d9c9e | 0xdcfdeb60 | 50 | 50 | 650430348823 |
| 4 | 149985825 | 0x598ff6f9ce4ee96dc72c9bd5aedcec01c95a69bd4254c527b94f62a7d5fb2358 | 0xdcfdeb60 | 50 | 50 | 992768599538 |
| 5 | 149985841 | 0xb2890778ed3d201d49c2e70b030ccc6f1a9b38575b6d76289e1f692e8b909b74 | 0xdcfdeb60 | 50 | 50 | 819017302823 |
| 6 | 149985861 | 0x5b5b0390e59eaab997ec75abe27b734e73dafe9eb8c1ec21b9e5c5dfd136f325 | 0xdcfdeb60 | 50 | 50 | 287170741879 |
| 7 | 149985876 | 0xaa9e785af030923bf0cce2659d93dc49465e4c3bf3ff45477e33fd82706e059b | 0xdcfdeb60 | 50 | 50 | 405843385052 |
| 8 | 149985876 | 0x7add0328c7b281f98a98cbe2983c2dabdbde24a0522154b8833dedb4f505937d | 0xdcfdeb60 | 50 | 50 | 214820429099 |
| 9 | 149985887 | 0x324276a2b809eaa4c4574d12007c0aede788c1617bc07c0323fc10159b7a1dfd | 0xdcfdeb60 | 50 | 50 | 327681464941 |
| 10 | 149985888 | 0xd57bccb2f00a8d72ae20ff5734c09ec2eb31fc3463c70b1965d420accc9f4732 | 0xdcfdeb60 | 50 | 50 | 241970554673 |
| 11 | 149985905 | 0xd9dc8ba2d4b23007bb119c4af3ffb34b5a00d04da9a2c1a497ddf991604022ed | 0xdcfdeb60 | 50 | 50 | 127576936501 |
| 12 | 149985932 | 0xf4161701592e404746c02f734521be69c045022f210a6726a95f93458703fb36 | 0xcfc32570 | 100 | 100 | 674931062489 |
| 13 | 149986063 | 0x47e5744a4379b40620c47b34b99346095614b132292ebff0fa1a866c2fb36902 | 0xcfc32570 | 100 | 100 | 1210934810967 |
| 14 | 149986065 | 0xdd1e0c2fe08bcfed3b949de3fe3d10b493e4c6488d81ceb794615cd5861a4592 | 0xcfc32570 | 100 | 100 | 278492359356 |
| 15 | 149986068 | 0xef00f7e4ca9ffda920e2b86eb84acd013e4c880c193392016a7abe0bcec84f18 | 0xcfc32570 | 100 | 100 | 523246090186 |
| 16 | 149986070 | 0x93afcfd2cfda883ddf7b05bfd26702473403646f003979170e5263a0b2832439 | 0xcfc32570 | 100 | 100 | 211627050677 |
| 17 | 149986077 | 0xb5f4e71419ea1e0762fedb9a8fa442dc94dc7de2e134720c0b407e33e3a21f4c | 0xcfc32570 | 100 | 100 | 229964647972 |
| 18 | 149986081 | 0x130c0330216129bb763044547947ae0fa7b6b9f5a06eb09a4e1f3750da02629c | 0xcfc32570 | 100 | 100 | 325363373820 |
| 19 | 149986081 | 0x6b3441d96d7dbddf9c12c9f200c136ed735b2cee5c12fb4f0eb2debf931c781f | 0xcfc32570 | 100 | 100 | 194285838797 |
| 20 | 149986085 | 0xc891c4d69faa99e641c6b4145deeb5aeb44fd07ff6247bd5c7c4598ba4094e73 | 0xcfc32570 | 100 | 100 | 453469717160 |
| 21 | 149986087 | 0xb119a862663b2eeaa619728fbbbab1ce90727ca9df31f6b3b32e95faaf087b8c | 0xcfc32570 | 100 | 100 | 167462988457 |
| 22 | 149986090 | 0xa244cac37bd4deaa009604e539dd0cecb617b6ce621849a88d1f63df8f85b1e6 | 0xcfc32570 | 100 | 100 | 240105026840 |
| 23 | 149986093 | 0x819954f5486903aeba43262f53b3abf6e152b62847b217fd956677804cd161be | 0xcfc32570 | 100 | 100 | 154383722623 |
| 24 | 149986095 | 0x95008bcaa0ce7f267902a5a4e79dd19117d00be29e0de8e89aeb7c541e903a87 | 0xcfc32570 | 100 | 100 | 150600086873 |
| 25 | 149986098 | 0xe5396979ea71a566cb8dd5ec7b08ac411693f9934d5cca5ecc556eca034d39d5 | 0xcfc32570 | 100 | 100 | 149917173409 |
| 26 | 149986101 | 0x3e2e882c40311659b1842ad63644ce89e84ae4e567a604359b7974e528268dd6 | 0xcfc32570 | 100 | 100 | 1506064628012 |
| 27 | 149986102 | 0xd06bf465e7c7573e72f47eac4ae4a681604f5b2e5724ed3be06b7be182356ce0 | 0xcfc32570 | 100 | 100 | 333564763485 |
| 28 | 149986104 | 0xba11b19bdafe9a0cac33c415393e3591161626ba7485990c25668c14b085268d | 0xcfc32570 | 100 | 100 | 425043499001 |
| 29 | 149986107 | 0x135e2e7a71bf36c2a1c32a888a9bd7d58a86aca7c0085bc858f0d9112c695fd6 | 0xcfc32570 | 100 | 100 | 373021454872 |
| 30 | 149986112 | 0xbf6595fdc4ec7b2411280fbc6bab510fa6eed4f23aa5c1fba1f66cc6041e9f26 | 0xcfc32570 | 100 | 100 | 454696443155 |
| 31 | 149986116 | 0x193106f32d848769e9c67d6889ef30b55b81af79d68bbe258523e8d60b2b285e | 0xcfc32570 | 100 | 100 | 260027413971 |
| 32 | 149986116 | 0xc9d8d265d8f9ab8a1e1d54791c69d90ddf28feb7feef5f434cea25a8f2d8cf6d | 0xcfc32570 | 100 | 100 | 235002396153 |
| 33 | 149986119 | 0x586a40805a5d1afea23d3132c69fdb0bc43429de49c6d35b509bb2b38a865745 | 0xcfc32570 | 100 | 100 | 195047861563 |
| 34 | 149986122 | 0xa38096496f0f0b94ffc5a3d9363662c2ab252ad45ed755afa23e919d1a081f1d | 0xcfc32570 | 100 | 100 | 199714756488 |
| 35 | 149986126 | 0x26d19edddb56394084d93bdda43707a9ac3f15afb2810540f1f619250cc3838e | 0xcfc32570 | 100 | 100 | 194742653960 |
| 36 | 149986128 | 0xafbdb8146510642ca32a8d5717d918d653abe3bef34db3f40ab93094d57ebbc3 | 0xcfc32570 | 100 | 100 | 112116293952 |
| 37 | 149986129 | 0x2425ce5f7869a1fc18ec462f878c0aa296e9609ce874b764bca2cfe51724ba8d | 0xcfc32570 | 100 | 100 | 251281801219 |
| 38 | 149986134 | 0x279f1ad2b00dc583a2f1c59baf12d223c9bbb13f56dd7156905b67d0c588fe1c | 0xcfc32570 | 100 | 100 | 67140967241 |
| 39 | 149986135 | 0xfc7bc0ad30b0e1f21047a7e1e9bd075deb3d162faec6a1c6e3a1a8821f3f00b3 | 0xcfc32570 | 100 | 100 | 203366442956 |
| 40 | 149986142 | 0xef4fc31f0dfce822087e92b46a1d1eb745c10fe43cd458ebfacf8f22da5e4de6 | 0xcfc32570 | 100 | 100 | 197191807812 |
| 41 | 149986144 | 0x28db7028d8e52379e8d463ccda55786251ee4607bb723a8db0a672fd023d311c | 0xcfc32570 | 100 | 100 | 210888750290 |
| 42 | 149986146 | 0xf9875c51264251a18b44efff0dd204b2ade89a50f4cb37fbf481f30316177a8f | 0xcfc32570 | 100 | 100 | 79635912506 |
| 43 | 149986148 | 0xdaa326521d3414d1a3dd01312a9586c3cc2cada2e9881864ec7758fc84533af0 | 0xcfc32570 | 100 | 100 | 125701751859 |
| 44 | 149986152 | 0xb21e7dd682ca3cc44f91642d8fd0bd633ef38ce44d2225abf7295ad6aa8bc6c2 | 0xcfc32570 | 100 | 100 | 483274890179 |
| 45 | 149986154 | 0x7af7a89326b6503e972dbc549f260fb613ad2253a37842806dfa9db5f11b4572 | 0xcfc32570 | 100 | 100 | 236273322815 |
| 46 | 149986156 | 0x8f2d82fab8b3f0a0349d6c837380ae58954f39772e231b8dc5af8d970075accc | 0xcfc32570 | 100 | 100 | 237102739224 |
| 47 | 149986158 | 0x905904db41f9fc45b0de87d73f2c6344f9b1ce5af0de86fde93f2b81ecec634b | 0xcfc32570 | 100 | 100 | 96591027112 |
| 48 | 149986162 | 0x48683ae3842799c65e5cdae662636b774a69c338acaad454d4064708a4a763f4 | 0xcfc32570 | 100 | 100 | 171013430729 |
| 49 | 149986164 | 0xe929878c219bc3358116da618de4312cc6422302d4353864853f71d56062cf99 | 0xcfc32570 | 100 | 100 | 309380842179 |
| 50 | 149986167 | 0x5beea42b3a366851e1a2e0aa792e10e6ab6f59d6ff05716fe2ea4f6aafb4b312 | 0xcfc32570 | 100 | 100 | 184511076343 |
| 51 | 149986173 | 0x34b67551c8673142babe8f6cf85c4b71f8550e3b8dbb549be78cbea396ea92d8 | 0xcfc32570 | 100 | 100 | 83567919227 |
| 52 | 149986173 | 0x67c98cbf75f0932cc3d0a2342eb6af468bbd07a050b8bd3c03360c5d4b37603a | 0xcfc32570 | 100 | 100 | 163388374073 |
| 53 | 149986177 | 0x0453f1395ad72ea7612ed17dabf5afc5626c6ed6566f293ad0437d69f425070a | 0xcfc32570 | 100 | 100 | 64946905381 |
| 54 | 149986180 | 0x4df263950afa3bf5f5b775f41a554068e95a32b71e48b18cc0c2f0785418fa56 | 0xcfc32570 | 100 | 100 | 60456990754 |
| 55 | 149986182 | 0x2617b31f42e8d263b12a9b3073902650963873ad8d4d447792dbcbf0b6bf16b7 | 0xcfc32570 | 100 | 100 | 112892864437 |
| 56 | 149986185 | 0xba0852b819980240648b29f6022a07400ecdc160f9a6e6d799041ae077abce8c | 0xcfc32570 | 100 | 100 | 49576789158 |
| 57 | 149986188 | 0x90f09fff429a0de40f113f9820235b6002357aff3ff1138c894b5b3b1207d638 | 0xcfc32570 | 100 | 100 | 152153576889 |
| 58 | 149986191 | 0x50d1e908b82a5cdf9451a961d7401d2f71f753bd1e05bf1340238fa4345f88b7 | 0xcfc32570 | 100 | 100 | 149473470242 |
| 59 | 149986196 | 0x1fa33d77e9be446219df052bc72d02bb78824461efae893817a4ccc4c382434a | 0xcfc32570 | 100 | 100 | 106395808921 |
| 60 | 149986197 | 0xe54581c8c17510ebf2667139d5d7c3926b73bd8033b4a5f954dca45d3bd65e69 | 0xcfc32570 | 100 | 100 | 152238694015 |
| 61 | 149986200 | 0x62fe528cfb088698686dd31357025e8b7951c4a394a82c2d0de31a036d447d28 | 0xcfc32570 | 100 | 100 | 336547237910 |
| 62 | 149986203 | 0x32aa50381c0d3c6c6b2c26dec83e4aa577aa8f7cb22209d1b174970aae445572 | 0xcfc32570 | 100 | 100 | 82754221786 |
| 63 | 149986203 | 0xcfb1c0aba7c7b4b336f79be7d53d3472e34ebc9f460d6cdf26d15b578a9ac5ad | 0xcfc32570 | 100 | 100 | 106617365353 |
| 64 | 149986209 | 0x2595470472000941bf60bb51fca1b4355b429d6a14fdf2a6ce8b456bd0df1cd4 | 0xcfc32570 | 100 | 100 | 142062367602 |
| 65 | 149986215 | 0x2255046b91ac48e277750391dab0750278cf0bf0e4baed8607c1b9cf1473f936 | 0xcfc32570 | 100 | 100 | 91485360906 |
| 66 | 149986215 | 0x0d5b11595f2ca68728c5acf46ec219c107e3a30f9fc40790bdeebc9de0a892e3 | 0xcfc32570 | 100 | 100 | 133027735489 |
| 67 | 149986215 | 0xaf9b10877da9f3b5409a02d56d9b492bc7079f968260118bb8431b26c4637d32 | 0xcfc32570 | 100 | 100 | 125276666746 |
| 68 | 149986219 | 0x4dfec57bb631be8dca2007a645ecfb3b3c8654859a109e3dfa2b93b5d2013c66 | 0xcfc32570 | 100 | 100 | 118879710106 |
| 69 | 149986223 | 0x795ecb67c0679009bc11b712e1d83621625b2575a8c088db008d26656f8615f0 | 0xcfc32570 | 100 | 100 | 49480352035 |
| 70 | 149986224 | 0x4eadffe06ccfb36827be89e5ae319b4429922d6eaf6222072c67bdd9327ca167 | 0xcfc32570 | 100 | 100 | 44238816581 |
| 71 | 149986233 | 0xe45a3fdbd4832afa8602e5e8299776a7f938cbd32f051af62ccc261b37d38810 | 0xcfc32570 | 100 | 100 | 21572819263 |
| 72 | 149986233 | 0x1b174995c21ba4ece37a50d716d9025120bad641dce52787dc90ce58ba03f36c | 0xcfc32570 | 100 | 100 | 13438406711 |
| 73 | 149986236 | 0xcdfd63fc41f18ab917c6710f25478af733b1bac5a2667191eceb7261d767049c | 0xcfc32570 | 100 | 100 | 24633325428 |
| 74 | 149986244 | 0x6ef2cb6f5d4441062c3700fa276c1c06b22c1b240eac6be2b47597457c463137 | 0xcfc32570 | 100 | 100 | 18342259773 |
| 75 | 149986244 | 0xff17c1e69b11720abaf3d8bf0108c47d67bcdb1b65d7e0e74387183e4ac7cc78 | 0xcfc32570 | 100 | 100 | 21418844008 |
| 76 | 149986245 | 0xe407ad559cf3860e967d429330659f03f9ddc49af297682aff22f31c84b01aa5 | 0xcfc32570 | 100 | 100 | 25170724787 |
| 77 | 149986246 | 0xed139334c2da7fb31706ea97426084fec423d37e315e8a56e2e48756d1f8cfbc | 0xcfc32570 | 100 | 100 | 19958043581 |
| 78 | 149986251 | 0x16dc2bceaaac6071976a4c46256bb224561204e2ee19699296c12489f09e7b0f | 0xcfc32570 | 100 | 100 | 11409014418 |
| 79 | 149986254 | 0x9d325d8195c23a5d6d34b8d2da7eeb1f400662a046bc7f88acab6c223c5340e2 | 0xcfc32570 | 86 | 86 | 9469932287 |

Totals: 80 logs / 80 txs; Count==seeds on every row; **Σ seeds = 7,337**. (Row Σs are batch
normalized-amount sums, logged for auditability; the task's assertion is on seed counts.)

## Design (per brief + recon, deviations: none)

- `derive.DebtManager` implements the FROZEN `derive.Engine` (compile-checked). `Name()` = `debt_manager`.
- **Borrowed** → `net += ceil(usd·1e18/idx)` (DebtManagerCore.sol:469, Rounding.Ceil); `usd = amount`
  for USDC only (stable-snap, recon caveat 1); ANY other borrow token errors loudly with the
  brief's prescribed message ("non-stable borrow token %s requires oracle-priced derivation - not
  yet supported").
- **Repaid** → `net −= floor(usd·1e18/idx)` (:507, Floor); `UsdAmount` is already USD 6-dec, no
  token gating (unit asymmetry with Borrowed honored).
- **Liquidated** → seq 0 debt event `net −= floor(debtAmountLiquidated·1e18/idx)` (:578, Floor);
  seq 1..N record-only `liquidation_collateral` events per tuple element (collateral is
  snapshot-owned, recon caveat 4 — no balance fold); **residue rule**: the SECOND Liquidated of
  the same tx for the same (user, debt token) leaving 0 < normalized ≤ 1 wei emits an extra
  `residue_zeroed` event (seq N+1) with delta = −remaining, modeling the contract's silent zeroing
  (DebtManagerCore.sol:549-553; recon caveat 2). Cross-tx pairs deliberately do NOT trigger it.
- **Index join**: `DMInterestIndexUpdated` updates a per-token (value, block) snapshot and emits
  NO position event (the runner persists `SaveRateIndex` from the same decoded event; an index
  move has no per-account balance effect). Mutating events REQUIRE a same-block snapshot — the
  one-index-update-per-mutating-block invariant — else loud error (both "never seen" and
  "stale block" variants).
- **Migration genesis**: `MigrationBorrowerPositionsSet` → ONE chain read
  (`DMChainReads.TxCalldata`, the interface's only method) → `decode.DecodeMigrationCalldata` →
  one `migration_genesis` debt event PER SEED, seq 0..N-1 in calldata order, delta =
  `NormalizedAmount` directly (already normalized, NO index division). Log `Count` must equal
  len(seeds) or the whole log errors (no partial genesis). uint16 seq is safe: the decoder bounds
  seeds at 65,536.
- **Record-only**: Supplied (account = credited user; payer in payload), WithdrawBorrowToken,
  BorrowApySet, BorrowTokenConfigSet, CollateralTokenAdded/Removed/ConfigSet — Side "", nil
  Delta; token-level config events carry `[]byte{}` account (position_events.account is NOT NULL).
- **State**: per-account running normalized cache; constructor
  `NewDebtManager(chain DMChainReads, priorNormalized map[acct]map[token]*big.Int)` deep-copies a
  warm-start seed map (documented: the runner resuming from a derive cursor seeds from its
  persisted event-sourced "debt" balances, i.e. store.BalancesFor output re-keyed). Decrements
  that would drive the cache negative are refused loudly (contract uint256 can't go negative ⇒
  divergence/missing-genesis evidence, never silent garbage).
- **Chain addition (sanctioned)**: `chain.Failover.TxCalldata(ctx, txHash)` via
  `TransactionByHash`; `rpcClient` interface + test fake extended; one focused failover test.
  Additive only — no existing signature/behavior changed.

## TDD evidence

1. RED: full unit-test suite written first; `go vet` at that point:
   `internal\derive\debtmanager_test.go:50:34: undefined: DebtManager` (deriver did not exist).
2. GREEN: implementation landed; all unit tests passed on the first post-implementation run
   (18 top-level unit tests, table subtests included — see verification section).
3. Golden fixtures were fetched AND verified against recon's table by an independent local
   replay inside the generator BEFORE being committed (generator refuses to write on mismatch:
   "DO NOT COMMIT" assertions).

## Golden fixtures (committed testdata, provenance embedded per file)

- `dm_golden_borrower_0303a641.json` / `_0b7043c8.json` / `_05e3a665.json`: complete real event
  histories (Borrowed/Repaid topic-filtered, Liquidated topic2) over OP blocks
  149,521,228-154,021,227 + the same-block InterestIndexUpdated(USDC) log for every mutating
  block (exactly-one-per-block invariant re-confirmed at fetch time for every block).
- `dm_golden_liq_ac5f3ce9.json`: the migrated Safe's genesis (migration log + full real batch
  calldata for the fake DMChainReads) + post-migration history through liq block 151,731,530.
- All fetched via eth_getLogs/eth_getTransactionByHash (drpc/mainnet.optimism.io), 2026-07-23,
  in 10,000-block chunks (public range caps).

## Golden test results (bit-exact) — ALL PASS

Replay path is the full production path: committed raw log bytes -> `decode.NewRegistry().Decode`
-> `DebtManager.Process` in (block, logIndex) order; nets are the sum of emitted debt-side deltas
(the exact fold `store.ApplyDerived` performs into `position_balances`).

| vector | assertion | expected | result |
|---|---|---|---|
| 0x0303a641…383d | net normalized after full replay | 963,813 | **PASS, exact** |
| 0x0303a641…383d | floor(net×1042402553573226850/1e18) | 1,004,681 | **PASS, exact** |
| 0x0b7043c8…7f85 | net normalized | 3,985,789,485 | **PASS, exact** |
| 0x0b7043c8…7f85 | derived @ PIN | 4,154,797,137 | **PASS, exact** |
| 0x05e3a665…d33f | net normalized | 7,153,773 | **PASS, exact** |
| 0x05e3a665…d33f | derived @ PIN | 7,457,111 | **PASS, exact** |
| 0xac5f3ce9…5fcc | migration_genesis delta (from real batch calldata) | +30,578,521 | **PASS, exact** |
| 0xac5f3ce9…5fcc | event beforeDebtAmount == floor(seed×idx/1e18) | 31,690,519 | **PASS, exact** |
| 0xac5f3ce9…5fcc | Liquidated @151,731,530 delta (idx 1036365345262130760) | −15,289,260 (see erratum) | **PASS, exact** |
| 0xac5f3ce9…5fcc | floor(net×idx/1e18) after liq | 15,845,260 | **PASS, exact** |

Event-count locks asserted (43/12, 38/7, 41/13 borrow/repay per borrower; 0 borrows + 1 genesis
for the migrated Safe), so a silently truncated fixture can never pass. Fixture cross-checks:
per-borrower IIU-block counts are 55 + 45 + 54 = **154 distinct mutating blocks — exactly recon's
"all 154 required blocks"**, each carrying exactly one IIU(USDC) (asserted at fetch).

### RECON ERRATUM (found and proven during this task)

Recon's liquidation spot check says "floor(15845260·1e18/idx) = **15,289,230** removed". That
figure is a digit typo for **15,289,260**. Proof (exact big.Int arithmetic, reproduced in
`debtmanager_test.go` comment):

- floor(15,845,260 × 1e18 / 1,036,365,345,262,130,760) = **15,289,260** (not …230);
- recon's own beforeDebtAmount 31,690,519 = floor(seed 30,578,521 × idx / 1e18) ✓ (validates the
  genesis seed against the contract's own view);
- recon's own view-after 15,845,260 = floor((30,578,521 − **15,289,260**) × idx / 1e18) ✓, while
  the claimed −15,289,230 would give 15,845,291, contradicting the recon vector itself.

Every OTHER figure in the recon vector validates bit-exactly against the real on-chain bytes.
The golden test asserts the arithmetically-consistent value and documents the erratum in place.
The Safe's full history through the liq block is: genesis seed → single Liquidated (50% pass) —
zero Borrowed/Repaid events, confirmed by the full-range scan.

## Verification (final gate runs, all on commit 298c43e)

- `gofmt -l internal/derive/ internal/chain/` → empty.
- `go vet ./internal/derive/ ./internal/chain/` → clean (also clean with `-tags rpcfixtures`).
- `go test ./internal/derive/ ./internal/chain/ -v` → **ALL PASS pristine**: 21 DM-side test
  functions (19 unit + 2 golden; 33 named tests counting subtests) + 8 chain tests (1 new:
  `TestTxCalldataReturnsInputWithFailover`) + the parallel Task 6 agent's Aave tests, all green
  in the same run.
- `go test ./...` → green across the repo (store/ingest skip without TEST_DATABASE_URL as
  designed; config/decode/ingest cached-green).
- Commit: **298c43e** `feat: debt-manager normalized-debt deriver with migration genesis`
  (explicit-pathspec commit, 9 files, 5,829 insertions; control-plane doctor + scope-gate OK;
  parallel agent's aave files untouched — its commit 7549e8a landed first and was preserved).

## Fixture tooling (committed, build-tagged out of normal builds)

`internal/derive/rpc_fixtures_test.go` (build tag `rpcfixtures`) carries both the step-0 sweep
and the golden-fixture generator. The generator survived public-RPC hostility via: per-chunk
disk cache (reruns resume, key = range + topic hash; default cache under os.TempDir), rotation
across drpc + mainnet.optimism.io per attempt, and adaptive range bisection when a provider
refuses/times out a span (drpc free plan 408s server-side on log-dense 10k scans). Fixtures are
verified against recon's table by an independent local replay INSIDE the generator before any
file is written ("DO NOT COMMIT" assertions).

## Concerns / notes for reviewers

- **Recon erratum** (above): the brief inherited recon's "removed 15,289,230" typo; the deriver
  asserts the arithmetically-consistent 15,289,260. If reviewers disagree, the counter-proof
  must explain how recon's own beforeDebt/view-after figures hold with …230 (they cannot).

- `processMigration` uses `context.Background()` for the one chain read: the frozen
  `Engine.Process` signature carries no context. Bounded per-attempt by chain.Failover's
  attemptTimeout; documented at the call site.
- InterestIndexUpdated emits NO position event by design (rate_indexes owns that stream via the
  runner's SaveRateIndex on the same decoded event). If the reviewers want an audit row per IIU,
  it is a 5-line change — flagged, not silently decided: the brief's record-only list names
  Supplied/WithdrawBorrowToken/config only.
- The residue rule is implemented exactly as briefed (second Liquidated in same tx, remaining
  ≤ 1 wei); a single-pass liquidation leaving 1 wei does NOT zero (matches
  _liquidateUser's control flow, which only reaches the zero-check after its pass loop — recon
  caveat 2 wording "after the second liquidation pass").
- Deriver is stateful and single-threaded by contract (D-004 single writer); documented on the
  struct.
