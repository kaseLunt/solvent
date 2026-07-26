# R-001 live throughput probe — transcript

- **Config under test:** `e969fa0` (`.env` endpoints, `config/contracts.json` streams)
- **Run:** 2026-07-26T06:30:53Z → 06:35:47Z (UTC), from the local dev machine
- **Artifacts:** `probe.py` (spec + implementation), `r001-results.json` (machine record)
- **Production fidelity:** payloads replicate `internal/ingest/walker.go`'s 6-call window
  (`eth_blockNumber`, 4× `eth_getBlockByNumber(n,false)`, 1× address-only `eth_getLogs`,
  span 2000, real stream addresses, real deep-history startBlocks, windows never repeated
  across phases), timeout 30s (`chain.go` `defaultAttemptTimeout`).
- **Axes varied:** request rate (2/5/10/20 req/s, 45s open-loop phases, early-exit below 50%
  clean); payload class (production 1:4:1 mix); window span (single-shot ceiling check at
  2000/5000/10000/20000, separate from the rate phases). **Axes fixed:** concurrency cap 8
  in-flight; span 2000 during rate phases; deep-history depth; single source IP.

## Observed heads (probe start)

| chain | head | derived totals at window 2000 |
|---|---|---|
| OP | 154,724,338 | dm stream: 5,203,106 blocks → 2,602 windows → **15,612 calls** |
| ETH | 25,615,191 | 9 streams: 23,314 windows → **139,884 calls** (aave group 12,475w; feeds 10,839w) |

Total 25,916 windows / **155,496 calls** — confirms the paper estimate (~152k). ETH is 90%
of the work.

## Rate phases (clean fraction = ok/submitted; every error classified)

| endpoint | 2 rps | 5 rps | 10 rps | 20 rps | max clean sustained |
|---|---|---|---|---|---|
| mainnet.optimism.io (OP) | 1.00 | 1.00 | 0.88 (429s) | 0.34 → exit | **5 req/s** |
| optimism.drpc.org (OP, unkeyed) | 0.47 (429s) → exit | — | — | — | **0** |
| eth.drpc.org (ETH, unkeyed) | 0.89 (429s) | 0.82 (429s) | 1.00 | 0.86 (429s) | 10 req/s, **not dependable** (see anomaly) |
| ethereum-rpc.publicnode.com (ETH) | 0.83 | 0.84 | 0.83 | 0.83 | **0 for backfill** — every failure is a getLogs 403 |

Latencies where clean: p50 0.13–0.25s, p95 0.21–0.40s; getLogs p95 ≤ 0.5s everywhere it
was served at all.

## Window-span ceiling (single shots, lever-1 evidence)

| endpoint | 2000 | 5000 | 10000 | 20000 |
|---|---|---|---|---|
| mainnet.optimism.io | ok | ok | ok | `-32062 Block range is too large` |
| optimism.drpc.org | ok | ok | ok | HTTP 400 |
| eth.drpc.org | ok | ok | ok | HTTP 400 |
| ethereum-rpc.publicnode.com | 403 | 403 | 403 | 403 |

## Findings

1. **publicnode refuses `eth_getLogs` outright for these requests** — 277/277 getLogs
   attempts returned HTTP 403 (singles and under load, every span), while its headers and
   `eth_blockNumber` stayed 100% clean to 20 req/s. This is a capability refusal, not rate
   limiting. Near-head getLogs was NOT tested (backfill is deep-history; that is the axis
   that matters here). Consequence for the current config: every ETH window's getLogs would
   fail over to drpc, so the configured ETH pair degenerates to unkeyed-drpc-only plus
   rotation churn.
2. **Unkeyed drpc is not dependable.** optimism.drpc.org collapsed at 2 req/s (48/90 429).
   eth.drpc.org 429'd at 2 and 5 req/s, ran one fully clean 45s phase at 10 req/s, then
   429'd again at 20. Both endpoints share one provider budget — the probe design ran them
   sequentially with a 30s cooldown for exactly that reason, and the early eth.drpc 429s
   are consistent with residual drain from the OP endpoint's collapsed phase (30s was not
   full isolation; stated rather than hidden). In production BOTH drpc endpoints are
   configured, so OP and ETH walkers would draw on that same shared budget concurrently.
3. **mainnet.optimism.io is sufficient for the OP side as-is**: 5 req/s sustained clean →
   the whole OP backfill in ~52 minutes at window 2000. 429 onset at 10 req/s.
4. **Window lever (>2000):** every logs-serving endpoint accepts spans up to 10,000 and
   rejects 20,000. But `walker.Step` retries a failed window at the SAME span forever (no
   adaptive splitting), so a provider logs-count cap at a hot range would stall a stream
   permanently. Widening is config-only but should wait until it is actually needed, or be
   paired with adaptive splitting (a code change under the D-006 gate).
5. **Merge lever (5 identical-startBlock aave streams → 1):** cuts ETH from 139,884 to
   80,004 calls (−43%). From-scratch backfill means no cursor migration; stream naming
   still keys cursors and shows up downstream, so it needs a scoped naming check before
   adoption.

## Decision input (42/N-hours rule against OBSERVED rates)

- As configured: **infeasible on ETH** (no dependable getLogs source); OP alone fine.
- One keyed free-tier ETH endpoint at ~10 req/s equivalent: ETH ≈ **3.9h** as-is streams,
  ≈ **2.2h** with the aave merge; plus ~52 min OP in parallel on the existing endpoint.
- Paid tier: nothing in these numbers requires it for a one-shot backfill.
