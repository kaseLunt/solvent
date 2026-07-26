# Task 9 — wave 11 report: round-10 structural fixes (the safe path is the only path)

Brief: `task-9-wave11-brief.md` (BINDING — five structural fixes), adjudicating
`task-9-codex-round10.md` (all five findings ACCEPTED; class: correctness that depended on
operator discipline becomes structural). Base: start commit `3ee6cfc` (the brief commit).
Branch `main`, serial tree; controller docs commits interleaved mid-wave (disclosed below).

| commit | contents |
| --- | --- |
| `d76afd6` | THE IMPLEMENTATION: F1–F5 across `cmd/reconcile/**` (10 files + 3 new test files), `internal/store/reconcile.go` + reconcile/guard test files, all 8 destructive store test helpers, `Makefile` (test-acceptance) |
| `d2bf6d1` | mutation spec `.superpowers/sdd/t9w11-mutations/mutations.json` (5 mutants, one per finding), committed BEFORE the loop |
| `fc6a040` | (controller, mid-wave) oracle-sentinel B3 consult — docs-only, disclosed; the mutation loop's tested SHA (code bytes identical to `d2bf6d1`) |
| `6ca5ac3` | `t9w11-mutations/transcript.md`, **5/5 KILLED** |
| `ec6da60` | Makefile refinement: `test-acceptance` clears `SOLVENT_RPC_*` (the proven zero-skip posture keeps them unset) — FINAL code state |
| (this report's commit) | `task-9-wave11-report-p2.md` |

Scope: `git diff --name-only 3ee6cfc..ec6da60` = `cmd/reconcile/**` (13 files),
`internal/store/reconcile.go` + store TEST files (12 files: the reconcile tests, the new
shared guard + identity tests, and the 8 destructive-helper preambles), `Makefile`,
`.superpowers/sdd/t9w11-mutations/**`. Nothing else touched; the scope gate accepted every
commit.

## Verification summary (convention: top-level `^--- PASS` / FAIL / SKIP)

- **Baseline @ `3ee6cfc`: 726 / 0 / 0, `go test ./... -count=1 -v` exit 0** — posture: gate
  ON (`SOLVENT_LIVE_RPC_TESTS=1`), `TEST_DATABASE_URL` → `solvent_test`,
  `SOLVENT_RECON_DATABASE_URL` → the LIVE `solvent` database (read-only evidence tests),
  `SOLVENT_DATABASE_URL` exported, `SOLVENT_RPC_*` NOT exported. Identical to wave-10's
  final. Zero `--- SKIP` strings at any level.
- **Final @ `ec6da60`: 739 / 0 / 0, exit 0, run through the NEW `make test-acceptance`
  target** — same posture PLUS `SOLVENT_ACCEPTANCE=1` (set by the target). The target's own
  skip gate reported **“acceptance mode: exit=0 skips=0”** and printed “acceptance suite
  green: zero skips” — the acceptance-mode skip count is EXPLICITLY ZERO, measured by the
  gate that now refuses >0.
- **PASS-list diff, both directions: 0 removed, exactly 13 added** — all 13 are this wave's
  tests (6 in cmd/reconcile, 7 in internal/store; enumerated per fix below). No pre-existing
  test changed name or vanished.
- **-race in `golang:1.24` via host.docker.internal** (brief scope: reconcile+store) against
  the fresh scratch DB `solvent_t9w11race`, with `SOLVENT_DATABASE_URL` pointed at the live
  DB through host.docker.internal so the F1 guard's identity resolution ran for real inside
  the container: **both packages ok, exit 0, zero DATA RACE, zero skips.**
- **Build/vet**: `go build ./...` and `go vet ./...` clean. **Committed-blob gofmt**: all 25
  touched `.go` blobs at HEAD extracted via `git cat-file` to temp files — `gofmt -l` CLEAN.
  (Working-tree `gofmt -l .` remains CRLF-noisy repo-wide as always; the blob check is the
  bar.)
- **Mutation matrix: 5/5 KILLED** through the committed applier
  (`wave16-mutations/mutate.py`), spec committed before the loop (`d2bf6d1`), tested SHA
  `fc6a040` (code-identical to the spec commit), in-memory restores verified byte-identical,
  `git status` over all 4 mutated files EMPTY after the loop.
- **Live Phase-0 smokes** (re-run because the tripwire's identity type changed): negative —
  `TEST_DATABASE_URL` = live DSN → **exit 2**, brief-verbatim message, now naming the tuple:
  “both resolve to cluster 7665718114346942498 database "solvent" (oid 1229081)”; positive —
  `TEST_DATABASE_URL` → `solvent_test`, `-engine debt_manager -preflight-only` → **exit 0
  “preflight OK”** (distinct databases on one cluster pass; OP pinned probe served).

## The five fixes — each cited to test + mutation

### F1 [high] — the destructive boundary enforces the split (`Makefile` + shared guard)

**Built.** `internal/store/destructive_guard_test.go`: `destructiveTestDSN(t)` is now THE
gate — every destructive helper in package store (testStore, testDeriveStore,
testInvariantStore, both direct helpers in store_test.go, all four migrate-upgrade tests,
prices_binding) obtains its DSN from it instead of `os.Getenv`, so a new helper copying an
old preamble cannot skip the guard. The guard: (1) unset `TEST_DATABASE_URL` = SKIP in dev
mode, **FATAL under `SOLVENT_ACCEPTANCE=1`** (`destructiveEnvDecision`, a pure function);
(2) refuses a database literally named `solvent` (belt and braces, hoisted from the old
invariants-only check to every helper); (3) resolves BOTH test and live
(`SOLVENT_DATABASE_URL`) identities via the F4 mechanism (`store.VerifyDestructiveSplit`)
and **fails CLOSED on equality or on either identity being unresolvable** — including an
unset/unreachable live DSN — with the runbook message verbatim. The verdict is cached per
(testDSN, liveDSN) per process so the live DB sees two read-only SELECTs per test binary,
not hundreds. `make test-acceptance` (new target) sets `SOLVENT_ACCEPTANCE=1`, runs the
verbose suite, **counts `--- SKIP` at any depth and fails on >0**; both Makefile test
targets carry comments naming their mode, and dev-mode results are labeled never-evidence.
`VerifyDestructiveSplit` lives in `internal/store/reconcile.go` (production, in scope) —
justification: the guard genuinely requires a helper callable from test files, and the
split decision belongs beside the identity mechanism it consumes.

**Tests.** `TestDestructiveEnvDecision` (mode table),
`TestDestructiveGuardRefusesSameDatabase` (same-DSN → “physical split required”; empty and
unreachable live DSN → fail closed), `TestVerifyDestructiveSplitFailsClosedWithoutADatabase`
(no-DB unresolvable arms). **Mutation W11M1 guard-bypassed** (`VerifyDestructiveSplit`
returns nil) — **KILLED** by both guard tests.

### F2 [high] — taints reach the verdict (`cmd/reconcile/main.go`)

**Built.** The structural arm of the brief's either/or: `computeResult(gatedFailures,
toleranceDMWei, taints)` — **the verdict function takes the taint set**, and any taint
forces `result: tainted`, exit 1, structurally non-pass even with every gated row exact.
Precedence: fail-with-tolerance > fail > tainted > pass (all non-pass exit 1).
`acceptanceTaints` now covers the round-10 bypass set: `-collateral-replay ≤ 0` (deep
replay disabled), `-max-head-lag ≤ 0` (staleness gate disabled), `-pin-op`/`-pin-eth`
overrides — plus the pre-existing small-sample/golden-pin/fixture-pin/engine/tolerance
taints. `-accounts` replay files are VALIDATED post-sampling
(`validateReplaySelection`): required sample size (min(floor, population)), per-stratum
coverage at min(quota, stratum population) — the same take-all degradation selectSample
applies, so a legitimately degraded replay still validates — and all four forced DM
anchors; violations are appended to the SAME taint slice computeResult consumes.
`stampAcceptance` writes that one slice into the artifact, so the run metadata and the
verdict can never tell different stories.

**Tests.** `TestTaintedRunCannotPass` (taints + zero failures → tainted/exit 1; precedence;
clean pass preserved), `TestAcceptanceTaints` extended with the four new bypass flags,
`TestValidateReplaySelection` (valid replay → no taints; missing anchor/stratum/size →
named violations; population-bounded degradation). **Mutation W11M2
taint-dropped-from-verdict** (computeResult ignores taints) — **KILLED** by
`TestTaintedRunCannotPass`.

### F3 [high] — the weld universe is authoritative (`cmd/reconcile/phase2.go` + dm/aave)

**Built.** Read-presence is a first-class per-token fact (`chainRead{Total, OK, Note}`).
DM: `buildDMWeldReads` converts the borrowTokenConfig multicall leg into a read entry for
EVERY weld-universe token — Success=false and undecodable (ABI-skew) results become
OK=false facts instead of `continue`-dropped entries — and `weldDMAggregate(inputs,
universe, reads)` iterates the EXPLICIT union **getBorrowTokens(@pin) ∪ derived** (∪ both
fact sets defensively): an unread or never-attempted universe token is a **GATED
`weld-unread` row** (ChainTotal `"(unread)"`, ReadError naming why, exit 1 via the existing
gated-failure accounting) — never a silently absent row, and never conflated with a REAL
zero read (which stays a numeric comparison). Aave: the universe is now the Pool's own
**getReservesList(@pin) ∪ derived** (∪ fixture reserves); token resolution
(getReserveVariableDebtToken / getReserveAToken, both new-to-the-weld resolutions running
IN-BAND through the multicall's Success flags) failing for a universe reserve = weld-unread
row (gated on the debt side, advisory on the collateral side per the amendment's gating);
an unresolved FIXTURE debt reserve still aborts loudly (exit 3) because the golden legs
cannot run without it; unsuccessful/undecodable scaledTotalSupply weld legs = weld-unread
rows while the per-account legs keep their loud abort. Two new pinned lens ABIs
(`getReservesList()` 0xd1946dbc, `getReserveAToken(address)` 0xcff027d9) join the
selector-pinning test.

**Tests.** `TestWeldDMAggregateUnreadTokenIsGatedRow` (reverted-read universe token → gated
weld-unread; no-read-recorded token → weld-unread; real zero → exact),
`TestBuildDMWeldReads` (every token gets an entry; reverted/undecodable → OK=false),
`TestWeldDMAggregateZeroBoundAndUnion` + `TestWeldAaveAggregate` adapted (zero bound and
union preserved; Aave unread row asserted; real-zero vs unread distinguished).
**Mutation W11M3 unread-token-vanishes** (weldDMAggregate reverts to derived ∪
successfully-read) — **KILLED** by `TestWeldDMAggregateUnreadTokenIsGatedRow`.

### F4 [medium] — DSN identity, not DSN strings (`internal/store/reconcile.go`)

**Built.** `DBIdentity{SystemIdentifier, DatabaseOID, DatabaseName}` — PostgreSQL
`pg_control_system().system_identifier` + `pg_database.oid` + `current_database()`;
`SameDatabase` is equality on THAT tuple, so IPv4/IPv6/socket/proxy respellings of one
database collide and the old `database@inet_server_addr:port` fail-open is structurally
gone. `DatabaseIdentity` errors on any unresolvable/incomplete tuple (fail closed);
`ResolveDSNIdentity` connects with `default_transaction_read_only=on` (the probe itself
cannot write). Consumers: the reconcile Phase-0 tripwire (`checkDSNSplit`/`dsnCollision`,
message now naming the tuple — live-verified, exit 2 above) and F1's shared guard.

**Tests.** `TestDatabaseIdentityTupleAndAliasEquivalence` — alias-equivalence: **3 alias
spellings resolved on this machine (localhost → ::1, 127.0.0.1, and a query-param
respelling) and all collided**, plus a direct catalog cross-check (the tuple's fields equal
`pg_control_system()` / `pg_database` queried directly — a transport-derived identity can
never match). `TestDatabaseIdentityDistinguishesDatabasesOnOneCluster` — distinct-DB pass:
`solvent_test` vs `postgres` on one cluster differ as identities while sharing the
system_identifier, and `VerifyDestructiveSplit` accepts exactly that shape.
`TestDatabaseIdentityFailsClosedOnDeadConnection` + the no-DB unresolvable arms — fail
closed. `TestDSNTripwireDetectsSameDatabase` updated to tuple semantics (same tuple
collides; same cluster/different DB does not; same name+OID on a different CLUSTER does
not). **Mutation W11M4 string-identity-revert** (SystemIdentifier ←
inet_server_addr:port, the pre-fix worldview) — **KILLED** by
`TestDatabaseIdentityTupleAndAliasEquivalence` (both the catalog cross-check and the
IPv4-vs-IPv6 alias fork fire).

### F5 [medium] — no network under the snapshot (`cmd/reconcile/phase1.go`)

**Built.** Phase 1 is now two strictly ordered stages. **Stage A `collectSnapshot`**: ONE
connection, ONE RR RO transaction, EVERY DB read of the run, then **COMMIT AND CLOSE**
before returning — and the function's signature carries **no chain reader**. **Stage B**
(runPhase1 tail): pin header hash/time RPC against the FIXED pins the snapshot chose, seed
resolution, and the md5(seed||account) population ordering **in Go**
(`orderPopulation`, byte-identical semantics to the old SQL `ORDER BY stratum, live DESC,
md5(seed||account)` — PostgreSQL's md5() hex text IS the Go digest hex), then quota
selection and sample-filtering of the snapshot's population-wide reads. Because the sample
is only known post-commit, the account-scoped reads now cover the candidate set
(population ∪ forced anchors ∪ -include ∪ -accounts, all parsed BEFORE the snapshot opens)
inside the snapshot: as-of sums, internal checks, residue/stable-snap presence, batched
balances (`store.ReconBalancesForAccounts`, one query, per-account conflict semantics
preserved), and prefetched replay documents
(`store.CollateralHistoryDocsAtLastSuccess`). `store.SampleDMBorrowers` is seed-free
(classification only, deterministic seed-free retrieval order). Rewind/fork protection
around the fixed pin is UNCHANGED: pins still come from the in-snapshot derive cursors,
the weld DB side is still read inside the snapshot, the welds still run right after Phase 1
and re-run in Phase 3 on a fresh connection, and the Phase-3 acked_epoch re-check is
untouched.

**The structural argument (per the brief: “a structural seam making the ordering
unrepresentable”).** The hazard — an RPC call while the snapshot transaction is open — is
no longer expressible as a code change short of a signature change: (1) inside
`collectSnapshot` there is NO value of any chain-reading type in scope (`chainReader`,
`*pinnedReader`, `*chain.Failover` are absent from its parameters and body), so no
statement placeable inside the transaction can dial; (2) the only value crossing the seam,
`snapshotData`, is plain data — and `TestSnapshotDataCarriesNoConnections` enforces that
mechanically with a reflection walk over the full reachable type graph, refusing any
`jackc/pgx` type, any `internal/chain` type, any local reader type, any non-empty
interface, and any chan/func; (3) Stage A commits AND closes its connection before
returning, so even the degenerate “hold an idle connection while Stage B retries RPC”
shape is gone. Reintroducing the round-10 defect therefore requires EITHER changing
`collectSnapshot`'s signature to accept a reader (review-visible structural event) OR
adding a connection-typed field to `snapshotData` (killed by the seam test). The
point-mutation form of network-under-snapshot is **not representable**; the representable
half is attacked by **mutation W11M5 seam-smuggle** (a `pgx.Tx` field added to
`snapshotData`) — **KILLED** by `TestSnapshotDataCarriesNoConnections`.
`TestOrderPopulationSeedOrderingSemantics` pins the relocated ordering (stratum-major,
live-first, explicit-md5 tie-break, purity in (set, seed), seed sensitivity);
`TestSampleDMBorrowersStrataPrecedenceAndDeterminism` keeps pinning the SQL classification
precedence and its now-seed-free determinism; `TestReconBalancesForSourceConflict` and
`TestCollateralHistoryDocsAtLastSuccess` pin the batched readers' exact semantics
(conflicted account: message returned, rows withheld, clean neighbors unaffected; replay
doc only at exactly last_success_block, collateral side only, success sweeps only).

## Mutation matrix (committed applier; spec `d2bf6d1`, tested SHA `fc6a040`, transcript `6ca5ac3`)

| id | finding | mutant | killed by |
|---|---|---|---|
| W11M1 | F1 | VerifyDestructiveSplit returns nil (guard bypassed) | TestDestructiveGuardRefusesSameDatabase, TestVerifyDestructiveSplitFailsClosedWithoutADatabase |
| W11M2 | F2 | computeResult ignores the taint set | TestTaintedRunCannotPass |
| W11M3 | F3 | weld universe reverts to derived ∪ readable | TestWeldDMAggregateUnreadTokenIsGatedRow |
| W11M4 | F4 | identity's cluster leg reverts to inet_server_addr:port | TestDatabaseIdentityTupleAndAliasEquivalence |
| W11M5 | F5 (representable half) | snapshotData grows a pgx.Tx field | TestSnapshotDataCarriesNoConnections |

5/5 KILLED; exactly-one-occurrence asserted per edit; in-memory restores verified
byte-identical; `git status` clean after the loop. Loop env: `TEST_DATABASE_URL` →
`solvent_test`, `SOLVENT_DATABASE_URL` → live (the guard resolves both identities for
real), `SOLVENT_LIVE_RPC_TESTS`/`SOLVENT_ACCEPTANCE` unset. **Disclosed incident:** the
first loop invocation crashed after W11M2 — the applier's console `print` hit Windows
cp1252 on “∪” in W11M3's description (`UnicodeEncodeError`), NOT an applier-logic failure;
restores were verified clean (`git status` empty over all four files) and the full loop was
re-run under `PYTHONIOENCODING=utf-8`. The committed applier was not modified.

## New tests this wave (the 13 PASS-list additions)

cmd/reconcile: `TestTaintedRunCannotPass`, `TestWeldDMAggregateUnreadTokenIsGatedRow`,
`TestBuildDMWeldReads`, `TestOrderPopulationSeedOrderingSemantics`,
`TestValidateReplaySelection`, `TestSnapshotDataCarriesNoConnections`.
internal/store: `TestDestructiveEnvDecision`, `TestDestructiveGuardRefusesSameDatabase`,
`TestVerifyDestructiveSplitFailsClosedWithoutADatabase`,
`TestDatabaseIdentityTupleAndAliasEquivalence`,
`TestDatabaseIdentityDistinguishesDatabasesOnOneCluster`,
`TestDatabaseIdentityFailsClosedOnDeadConnection`, `TestCollateralHistoryDocsAtLastSuccess`.

## Deviations & residuals (each with reason)

1. **`store.SampleDMBorrowers` lost its seed parameter** (API change inside the wave's
   scope): the seed ordering moved to Go per Codex's own F5 prescription (“apply the
   hash-derived ordering in Go”); the SQL keeps the classification and a seed-free
   deterministic retrieval order, and the composite reproducibility contract (same pin +
   same seed ⇒ identical sample) is preserved and tested on both sides.
2. **`ReconBalancesFor` / `CollateralHistoryDoc` replaced by batched twins**
   (`ReconBalancesForAccounts`, `CollateralHistoryDocsAtLastSuccess`): the per-sample reads
   must all live inside the snapshot while the sample is chosen after commit, so the reads
   became candidate-set-wide; keeping the single-account functions would have left dead
   production code with divergence risk. Per-account semantics (conflict message text,
   rows-withheld, exact-block doc) preserved and tested.
3. **Tainted runs now exit 1 where they previously exited 0** (e.g. a clean
   `-engine debt_manager` debug run): this is the POINT of F2 — a bypassed required check
   can no longer be suite-green — but it is a CLI behavior change operators will notice;
   the artifact carries `acceptance_taints` naming every reason, and `result: tainted` is
   distinct from `fail` so triage stays honest.
4. **Two destructive TEST_DATABASE_URL consumers exist OUTSIDE internal/store** —
   `cmd/indexer/health_live_test.go` (Migrate+truncate path) and
   `internal/prices/poller_live_test.go` (schema-isolated) — both out of this wave's
   binding scope (`internal/store` test helpers only). They remain on the old
   skip-when-unset preamble WITHOUT the identity guard; named here as the residual for the
   controller/Codex. The acceptance-mode skip gate DOES cover them (their skips would fail
   `make test-acceptance`), so the vacuous-green half of F1 is closed suite-wide; the
   truncate-the-live-DB half is closed only for internal/store this wave.
5. **`make test` (dev mode) with a populated `.env` fails `TestLoadFailsWhenRPCEnvMissing`**
   — pre-existing: the Makefile's global `-include .env` + `export` injects
   `SOLVENT_RPC_OP` into test processes and that test requires it unset. `test-acceptance`
   clears the RPC vars explicitly (commit `ec6da60`, comment in the Makefile);
   the dev target was left as-is (historical behavior, out of the brief's demands).
6. **Aave collateral weld-unread rows are advisory** (Gated=false), matching the
   collateral weld's amendment-mandated first-run gating; the debt side's unread rows are
   gated. If the controller wants unread-ness itself to gate on BOTH sides regardless of
   the weld's numeric gating, that is a one-line change — flagged rather than silently
   chosen.
7. **`getReserveAToken` (0xcff027d9) is selector-pinned but not live-verified against the
   deployed Pool** (no ETH archive run in this wave's scope; the deployed instance is
   v3.3-line per recon/derivation-notes.md, same lens family as the already-live-verified
   `getReserveVariableDebtToken`). Failure mode if absent on-chain is fail-VISIBLE by
   construction: the resolution runs in-band, so it would surface as weld-unread rows
   (collateral) — never a silent pass.
8. **Controller docs commits interleaved mid-wave** (`fc6a040` oracle-sentinel B3, and the
   wave-10-era pattern repeated): docs-only, verified by `git show --stat`; the mutation
   transcript's tested SHA is therefore `fc6a040`, code-identical to the spec commit
   `d2bf6d1` for every mutated file.
9. **First mutation-loop invocation crashed on console encoding** — disclosed above,
   restores verified, re-run clean; no applier modification.

## Unverified (stated plainly)

- The full Phase 1→4 pipeline still has not run end-to-end against the live database —
  that remains the controller's evidence run by design. The restructured Phase 1 is
  verified by the seam test, the unit tests over the relocated ordering/selection, the
  store-level batched-reader tests, and the live Phase-0 smokes; the first live evidence
  run will be the first live exercise of Stage A/Stage B in sequence.
- The Aave universe path (getReservesList + getReserveAToken at a live pin) awaits the
  evidence run, as does the first live weld-unread-free pass over the real reserve list.
- Alias-equivalence's IPv4-vs-IPv6 arm is machine-dependent by nature; on this machine all
  three alias spellings resolved and the W11M4 kill exercised the fork for real (transcript
  records the kill). The catalog cross-check arm is machine-independent and kills the same
  mutant everywhere.

## Environment safety accounting

The backfill daemon and `solvent-db-1` were never stopped or restarted (container “Up 45+
hours” throughout). Live-DB access this wave was read-only and enumerated: the F1 guard's
cached identity SELECTs (two per test process), the two tripwire smokes' identity SELECTs,
and the evidence scans in the two suite runs and the race run (read-only session enforced).
One early baseline attempt mangled `TEST_DATABASE_URL` via shell substitution — it resolved
to a NONEXISTENT HOST (`host=solvent_test`), every DB test failed on connect, nothing was
touched, and the live DB's row counts were verified intact before proceeding; the corrected
posture produced the clean 726/0/0 baseline. Live RPC: one `mainnet.optimism.io` regression
dial per suite run (pre-existing gate-ON test), plus the positive preflight smoke's ~6 OP
calls and the negative smoke's zero RPC (tripwire fires before dialing). Destructive test
traffic ran against `solvent_test` and the fresh `solvent_t9w11race` only.
