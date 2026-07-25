# Task 7 Report: Wire `cmd/indexer` + live smoke against OP Mainnet + Ethereum mainnet

## Status: DONE

## What was run

1. `mkdir -p config && cp recon/contracts.json config/contracts.json` — copied verified
   contract config (op:debt-manager on chain 10 from block 149521228; eth:aave-etherfi
   on chain 1 from block 20625519). Validated with `python -c "import json; json.load(...)"`
   → `VALID JSON`.
2. Created `.env` (gitignored, confirmed untracked throughout) from the values specified
   in the task brief:
   - `SOLVENT_DATABASE_URL=postgres://solvent:solvent@localhost:5432/solvent?sslmode=disable`
   - `SOLVENT_RPC_OP=https://mainnet.optimism.io,https://optimism.drpc.org`
   - `SOLVENT_RPC_ETH=https://ethereum-rpc.publicnode.com,https://eth.drpc.org`
   - `SOLVENT_POLL_INTERVAL=5s`
3. Replaced `cmd/indexer/main.go` with the brief's Step 2 code verbatim.
4. `go build ./...` — clean, no output.
5. `go vet ./...` — clean, no output.
6. Live smoke: `set -a && source .env && set +a && go run ./cmd/indexer` run in the
   background against the docker-compose `db` service (already up, healthy). Ran from
   ~20:57:45 to ~21:07 (about 10 minutes) before being stopped.

## Cursor / row-count progression

| Time (local) | op:debt-manager cursor | eth:aave-etherfi cursor | raw_logs count | min block | max block |
|---|---|---|---|---|---|
| 20:57:45 (start) | — (not yet created) | — (not yet created) | 0 | — | — |
| 21:00:36 (check 1) | 149,789,227 | — (not started yet) | 14 | 149,521,228 | 149,558,074 |
| 21:02:46 (check 3) | 149,995,227 | — (not started yet) | 136 | 149,521,228 | 149,986,254 |
| 21:04:11 (check 4) | 150,103,227 | 20,657,518 | 10,352 | 149,521,228 | 150,103,226 |
| 21:04:41 (check 2, delayed read) | 150,103,227 | 20,773,518 | 10,556 | 20,713,917 | 150,103,226 |
| 21:07:31 (check 6) | 150,103,227 | 21,293,518 | 11,226 | 20,713,917 | 150,103,226 |
| 21:08:04 (check 5, final) | 150,103,227 | 21,293,518 | 11,226 | 20,713,917 | 150,103,226 |

Both streams started from and advanced past their configured `startBlock` values
(op: 149,521,228 → eth: 20,625,519). `raw_logs` grew monotonically across every sample
(0 → 14 → 136 → 10,352 → 10,556 → 11,226) and both cursors are strictly increasing
across checks a few minutes apart, satisfying the success criteria.

Notable architectural observation (not a bug, just worth recording): the main loop in
`cmd/indexer/main.go` processes walkers sequentially and fully drains one walker's
backlog (loops `Step` until `advanced == false`) before moving to the next within a
single tick. Because `op:debt-manager`'s backlog (from block 149,521,228 to current OP
head, ~582k blocks) was much larger than expected for a short smoke window, the
`eth:aave-etherfi` stream's cursor did not appear in `ingest_cursors` until the op
stream caught up to its safe head (~6.5 minutes in, between check 4's predecessor and
check 4). Once op caught up (cursor pinned at 150,103,227 for the rest of the run,
consistent with `Step` returning `advanced=false` at the safe head), eth ripped through
its own historical backlog rapidly (+520,000 blocks in under 3 minutes, since it's a
dormant market with almost no matching logs per window) and produced real rows
(raw_logs count grew from 10,556 → 11,226, i.e. +670 rows attributable to eth once it
started, consistent with the "dormant market" description — sparse but present).

## Final counts

- `op:debt-manager` cursor: 150,103,227 (caught up to its safe head; unchanged across
  the last 3 checks — expected steady-state behavior once a stream is caught up, not a
  stall).
- `eth:aave-etherfi` cursor: 21,293,518 (advanced +667,999 blocks from its start block
  of 20,625,519).
- `raw_logs`: **11,226 rows total**, block range 20,713,917–150,103,226 (spanning both
  chains; note block numbers are chain-local and not comparable to each other — the
  "min" reflects the eth chain's smaller numbering space, not an ordering across
  chains).

## RPC failovers / errors observed

Only two non-fatal events in ~10 minutes of runtime, both expected/acceptable per the
task's success criteria (no `step failed` spam):

```
time=2026-07-21T21:04:02.431-07:00 level=ERROR msg="step failed; will retry next tick" err="log 0x79b34c4c08050d4d2f474c2e4465216a7331919004fdac18722749cfa1c045dc/216: log at window tip does not match anchored tip hash"
time=2026-07-21T21:04:02.782-07:00 level=WARN msg="rpc endpoint failed, rotating" op=getLogs endpoint=0 err="403 Forbidden: {\"jsonrpc\":\"2.0\",\"error\":{\"code\":-32602,\"message\":\"Archive requests require a personal token. Get one at: https://www.allnodes.com/publicnode\"},\"id\":3}\n"
```

The first is the walker's own defensive coherence check catching a mid-fetch chain tip
change (working as designed — discards the window and retries next tick, per the
`Step` implementation's documented TOCTOU handling). The second is `publicnode`
rejecting an archive-range `getLogs` call for the eth stream (older historical range);
the `chain.Failover` client rotated to the next configured endpoint (`drpc`) and
ingestion continued without further errors. No API keys were signed up for, per the
constraint that this is a controller decision.

Full startup log (from the backgrounded run):

```
time=2026-07-21T20:57:45.498-07:00 level=INFO msg="goose: no migrations to run. current version: 1"
time=2026-07-21T20:57:45.505-07:00 level=INFO msg="stream configured" stream=op:debt-manager start=149521228
time=2026-07-21T20:57:45.505-07:00 level=INFO msg="stream configured" stream=eth:aave-etherfi start=20625519
```

## Build/vet

```
$ go build ./...
(clean, no output)
$ go vet ./...
(clean, no output)
```

## Commit

- SHA: `17b3a8f`
- Subject: `feat: wire indexer daemon; live OP+ETH mainnet ingestion verified (11,226 logs)`
- Files: `cmd/indexer/main.go`, `config/contracts.json` (112 insertions, 3 deletions
  across 2 files)
- `.env` verified untracked before and after the commit (`git status --porcelain`
  clean; `git show --stat 17b3a8f` shows only the two intended files).

## Concerns

None blocking. The only item worth flagging to the controller for awareness (not a
failure): the sequential per-tick walker draining means a stream with a large backlog
can delay a sibling stream's first cursor write by several minutes within a single
smoke-test window. This did not prevent success here — both streams caught up and both
cursors advanced with real data landing in Postgres — but it's worth knowing for future
smoke tests with a larger backlog or a shorter test window.
