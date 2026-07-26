# Codex adversarial review — task 9 wave 10 (round 10, reconcile harness)

- **Target:** `0b19670` vs `bf9db2a`
- **Verdict:** `needs-attention` — **NO-SHIP** (3 high, 2 medium)
- **Job:** `review-ms28cdjg-y57vdp`; session `019fa00a-70db-7493-b832-bad9ab0d96d7`
- Anti-decoy passed (findings grounded in cmd/reconcile + internal/store file:line).
  Dispatch incident disclosed and handled: a first attempt foregrounded the dispatch and
  SIGTERM-wedged its job (dead-pid state, output discarded); replacement dispatched
  correctly, polled to completion. Worktree pruned (eighth orphaned-broker, PID verified).

## Findings (verbatim)

### [high] Destructive tests can still truncate the live database—or pass by skipping — `Makefile:18-19`
The test target forwards TEST_DATABASE_URL directly without requiring or validating it. Existing helpers such as internal/store/derive_test.go immediately Migrate and TRUNCATE whatever database that variable names. If TEST_DATABASE_URL equals SOLVENT_DATABASE_URL, `make test` can erase the live backfill; the reconcile tripwire runs in a separate process and provides no protection. If TEST_DATABASE_URL is unset, those tests call t.Skip and the target can still exit successfully, producing a vacuous suite-green claim.
**Recommendation:** Add a mandatory, shared pre-test guard before any migration or truncation. Require TEST_DATABASE_URL, resolve both live and test database identities, fail closed on uncertainty or equality, and make the acceptance test command reject any DB-test skips.

### [high] Acceptance remains true when sampling and required checks are bypassed — `cmd/reconcile/main.go:142-160`
acceptanceTaints omits `-accounts`, `-collateral-replay`, `-max-head-lag`, and ordinary pin overrides. Thus `-accounts one.txt -collateral-replay 0 -max-head-lag 0` bypasses quotas and forced anchors, disables deep replay and the lag gate, yet leaves `run.acceptance=true`; if the remaining rows are exact, summary.result is `pass` with exit 0. Even recognized taints are metadata only and do not affect computeResult.
**Recommendation:** Reject acceptance-mode invocations that disable required checks, or return a non-pass `tainted` verdict. Validate replay files against the required sample size, strata and forced anchors, and pass all acceptance taints into computeResult.

### [high] A failed DM total read can disappear from the blocking F1 weld — `cmd/reconcile/phase2.go:124-135`
When an in-band borrowTokenConfig call returns Success=false, the code silently continues and omits that token from chainTotals. The weld later unions only derived assets and successfully read totals—not the getBorrowTokens universe. For a configured token with no derived rows, an ABI-skew or pinned-call revert therefore produces no weld row at all, allowing an unverifiable aggregate leg to pass. This conflates an absent chain result with zero and defeats the amendment's empty-state completeness requirement.
**Recommendation:** Treat every unsuccessful or undecodable borrowTokenConfig result as an abort or gated unread failure. Build the weld over the explicit getBorrowTokens/derived union and represent read presence separately from numeric zero.

### [medium] The DSN tripwire can fail open across aliases to the same PostgreSQL cluster — `internal/store/reconcile.go:120-128`
DatabaseIdentity includes inet_server_addr and inet_server_port, and collision detection uses exact string equality. The same cluster/database reached through IPv4 versus IPv6, a Unix socket versus TCP, or different listening interfaces can return different identities even though both DSNs target the same destructive database. The tripwire then accepts the configuration it claims to reject.
**Recommendation:** Compare a stable cluster identifier plus database identity, such as PostgreSQL system_identifier and database OID/name, and fail closed if either identity cannot be established. Add IPv4/IPv6, socket/TCP and proxy-alias tests.

### [medium] The repeatable-read snapshot is held across retrying RPC calls — `cmd/reconcile/phase1.go:178-203`
After opening the RR read-only transaction and reading cursors, Phase 1 performs headerHash and headerTime network calls for each chain before continuing its DB scans and committing. A slow or degraded endpoint can therefore hold the live database snapshot through multiple failover/retry attempts—potentially much of the 20-minute timeout—retaining xmin and delaying vacuum while the daemon writes. This violates the binding no-network-under-snapshot/vacuum-friendliness requirement.
**Recommendation:** Collect the classified DB population inside the transaction, commit and close it, then fetch pin headers and apply the hash-derived ordering in Go. Preserve rewind/fork checks around the resulting fixed pin.

## Controller adjudication

**All five ACCEPTED.** Fix wave: `task-9-wave11-brief.md`.

The unifying class: correctness that depends on OPERATOR DISCIPLINE instead of structure.
The DB split existed but the destructive boundary didn't enforce it; taints existed but
the verdict didn't consume them; the weld existed but its universe came from what
happened to be readable; the tripwire compared strings, not identities; the snapshot rule
was stated but the transaction didn't embody it. Every fix makes the safe path the ONLY
path — the same structural turn as wave 3's routing seam. Finding 3 is also the
risk-quant amendment enforced one level deeper: F1 demanded the weld; round 10 demands
the weld's UNIVERSE be authoritative (getBorrowTokens ∪ derived) with read-presence a
first-class fact, never conflated with zero.
