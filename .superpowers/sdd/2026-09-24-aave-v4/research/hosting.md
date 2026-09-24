# Solvent hosting brief: the cheapest reliable 24/7 setup (Postgres, indexer, riskd, API with SSE, Next.js web, plus the Aave V4 engine)

## Bottom line

1. **Recommended: everything on one Hetzner CX33 VPS.** It has 4 vCPU, 8 GB RAM and 80 GB NVMe, and costs €8.49 plus €0.50 for IPv4, so €8.99/mo (about $10.59). Put a free Cloudflare named Tunnel in front and buy a domain through Cloudflare Registrar for $10.44/yr. Total is about **$11.50/mo**. The cheapest version that still works is the CX23 (2 vCPU, 4 GB, 40 GB) at **€5.99/mo including IPv4, about $7.09**. On the CX23 the risk-batch retention has to be cut to 500 or fewer, and the 40 GB disk fills in roughly 8 to 12 months.
2. **Cheapest possible: Oracle Always Free Ampere A1, $0 plus the domain.** Oracle quietly cut this tier to 2 OCPU and 12 GB on 2026-06-15, but that is still enough. The risk is Oracle's policy, not the machine: they changed the tier without notice, A1 capacity often isn't available, and accounts can be locked.
3. **Free Postgres tiers and platform-as-a-service hosts are ruled out by Solvent's own design:**
   - The database is gigabytes, not megabytes. Neon, Supabase and Aiven free tiers cap at 0.5 to 1 GB.
   - riskd inserts about 50,000 rows **one at a time** per batch, so the database has to sit on the same machine as riskd.
   - The API's SSE needs a process that never sleeps.
   - riskd keeps about one CPU core busy all the time, which makes CPU-metered hosts (Railway, Fly) cost $30 to $45 or more per month.
4. **RPC is the biggest cost risk, not the server.** This is a model from the code, not a measurement. The indexer's inner loop runs continuously because OP produces a block every 2 seconds, and each of the 10 Ethereum walkers makes 2 or more RPC calls per round. That comes to about **0.9 to 2 million calls/day, about 80% of them to Ethereum.** dRPC's free plan works out to about 350,000 requests/day. Paid dRPC for this volume would be about **$135 to $290/mo**. Pacing the Ethereum walkers (a code change) gets under the free tier. I measured 0 logs/day from the legacy Aave market, so those walkers are almost pure polling.
5. **Three deployment problems in the repo as it is today (read-only findings):**
   - `docker-compose.yml` publishes port 5432 with the password `solvent/solvent`. On a VPS that would be exposed publicly.
   - There are no Dockerfiles and no `deploy/` directory.
   - The API's rate limiter keys on the connection's address. Behind any proxy or tunnel, every visitor shares one 20 req/s bucket (burst 40).

---

## A. What Solvent actually needs (measured from the repo)

### A1. Processes

| Process | Long-lived? | Work pattern | CPU / RAM (RAM is an estimate) | Evidence |
|---|---|---|---|---|
| Postgres 16 | yes | Absorbs about 46 GB/day of inserts and deletes from riskd, plus WAL | Shares about 1 core with riskd; 0.5–1 GB RAM | docker-compose.yml |
| indexer | yes | 11 log streams (1 OP, 10 ETH), window 2000, 5 confirmations; `SOLVENT_POLL_INTERVAL=5s`, but the inner loop repeats while any stream advanced; hourly collateral sweep (100 Safes per multicall); 1-minute price poll over 28 assets (20 OP, 8 ETH) | Mostly waiting on RPC; 50–150 MB | config/contracts.json; cmd/indexer/main.go:63 (`stepsPerRound=5`), :1507-1632 (loop), :744 ("hot inner loop with no ticker between rounds"); internal/snapshot/snapshot.go:132; recon/feeds.json |
| riskd | yes | Polls every 2s. Recomputes the whole book each time the watermark moves, which in practice is back-to-back | **Measured about 29 s per batch**: 18,244 batches between 2026-08-02 16:43 and 2026-08-08 20:22 (solvent-riskd.log). About 1 core continuously busy with Postgres; 200–500 MB | cmd/riskd/main.go:64-66 |
| api | yes, required by SSE | REST plus `/v1/stream`: no Read/WriteTimeout, 15s heartbeat, 5s poll per stream, one shared LISTEN connection; at most 2 in-flight book set-runs | 100–400 MB | cmd/api/main.go:87-89, :192, :645-647; sse.go:43-50; p5_runbook_set.go:94 |
| web (Next 16.2.12) | only for one route | Today's build (`.next/BUILD_ID` 2026-09-24 06:26) prerenders 12 routes; `/inspector/[addr]` is the only dynamic one. All data is fetched in the browser from `NEXT_PUBLIC_SOLVENT_API_URL`, which is inlined at build time. No API routes or middleware | 150–300 MB for `next start` on :3111 | web/.next/prerender-manifest.json; web/lib/api.ts:15; web/package.json |

**Sizing:** at least 4 GB RAM and 2 vCPU; 8 GB is comfortable. Avoid burstable or CPU-credit instances, because riskd never idles. Run `next build` in CI rather than on a 4 GB box.

**The API needs these repo files at runtime:**
- `config/contracts.json`
- `recon/feeds.json`
- `recon/p3-probes.md`
- `roadmap/evidence/artifacts/w1-reconcile/drift-report.json` (cmd/api/p5_evidence.go:40)

Copy those files into the image. Don't copy the whole `recon/` directory (633 MB). The API also refuses to start unless the goose schema version matches, so deploy in this order: indexer (which runs the migrations), then riskd, then the API.

### A2. Database size is set by riskd retention

- Each batch writes one `risk_positions` row per account, plus `risk_position_legs` and `risk_price_inputs` rows (migration 00013). Rows are inserted one statement at a time (internal/store/risk.go:1281-1334).
- Old batches are pruned inside the same transaction to the newest N, default 5000 (risk.go:1416-1419).
- Today a batch holds **9,848–10,010 positions** (riskd log). A fixture breaks one batch down as 8,552 legacy Aave and 1,412 Debt Manager positions (web/tests/fixtures/demo/book.demo.json).
- I estimated row sizes from the column types at about 335 B per position, 305 B per leg and 315 B per price input, including primary keys and indexes. That assumes about 2 legs and 2 price inputs per position.
- That gives **about 15.7 MB per batch** (roughly 12–22 MB if there are 1.5–3 legs per position).

| `SOLVENT_RISK_RETENTION` | Today (~10k positions) | + V4 at Debt Manager size (+1.4k) | + V4 at full-book size (+10k) |
|---|---|---|---|
| 5000 (default; reached in about 40 h) | **~78 GB** | ~89 GB | ~157 GB |
| 1000 | ~16 GB | ~18 GB | ~31 GB |
| 500 (covers the API's maximum `limit=500` for history and observatory, main.go:92-100) | ~8 GB | ~9 GB | ~16 GB |

- At the default cadence that is about 2,970 batches/day, or about 46 GB/day of inserts and the same volume of deletes, with WAL on the same order.
- Setting `SOLVENT_RISK_POLL_INTERVAL=60s` roughly halves the write load and CPU. Check that it stays within the 3-minute price budget.
- The local Docker disk image `docker_data.vhdx` is 136.5 GB. That is consistent with the default retention having filled up, but it is only an upper bound because the file never shrinks.

**Durable tables grow without limit** (by design: D-010/D-012 keep price history, and there is no pruning of snapshots or `raw_logs`):
- **Debt Manager logs:** 1,157 over the last 44,000 OP blocks (about 24 h, ending near 157.34M), which includes a 447-log migration burst. The same span before the migration had 6,187 logs (ending at block 155,100,000). I counted these with eth_getLogs.
- **Legacy Aave on Ethereum:** 0 logs from the pool, the weETH aToken or the USDC aToken across 7,200 blocks ending at 26,049,000. As a check, the same endpoint returned 26 pool logs near the genesis block 20,714,100, so the market is simply quiet.
- **prices:** at most 28 assets × 1,440 polls/day ≈ 40k rows/day.
- **snapshots:** each hourly sweep writes one collateral row per account in the debt registry (store/derive.go:1529-1540, :1794).
- **Growth estimate:** about 30–60 MB/day, or **1–2 GB/month** including a V4 stream with 5–15k events/day.
- **Current base size:** unknown, because Docker was off and I couldn't query it. Once it's up, run:
  `SELECT relname, pg_size_pretty(pg_total_relation_size(relid)) FROM pg_statio_user_tables ORDER BY 2 DESC;`

### A3. RPC volume compared with free tiers

**Endpoints** (second-level domains only):
- `SOLVENT_RPC_OP`: OP's public endpoint (optimism), no key. Measured latency 0.23–0.40 s.
- `SOLVENT_RPC_ETH`: a failover list of drpc (0.048–0.065 s), infura (0.20–0.25 s) and publicnode (0.095–0.36 s).
- Reconcile only: alchemy (ETH); optimism and drpc (OP).

**Call pattern per walker step** (internal/ingest/walker.go, Step starting at line 567):
- When idle: 2 calls (`eth_blockNumber`, plus a reorg-check `eth_getBlockByNumber`).
- When advancing: 6 calls (adds two tip-hash reads, `eth_getLogs`, and a cursor recheck).
- The round repeats as long as anything advanced, and OP advances every 2 s, so the loop is effectively always running.

**Model** at the latencies above:
- A round takes about 4 s and makes about 43 calls, which is **about 0.93M calls/day (OP ~170k, ETH ~750k)**.
- From a data center with lower latency, rounds are faster and the count rises to about 2M/day.
- Small additions: the price poller (~3–4 calls/min per chain, about 10k/day), the sweep (≤1.5k/day), and block-header fetches (≤ one per event block).
- The V4 engine adds one OP stream, about +20–25% on OP calls.

| Provider | Free limit (verified) | Compared with Solvent |
|---|---|---|
| dRPC (ETH primary) | 210M CU per 30 days, flat 20 CU per call, so **about 10.5M calls, or ~350k/day**; about 2,100 CU/s. Paid: **$6 per 1M requests** | ETH alone uses up the monthly allowance in about 7–14 days. Measured: the free key rejects `eth_getLogs` more than ~1,000 blocks behind the head ("Can't route your request…", code 12) and on ranges of 500–2,000 blocks ("ranges over 10000 blocks are not supported on free plan", code 35). It works at 128 blocks or fewer behind the head. |
| Infura (ETH #2) | 3M credits/day, 500 credits/s; `eth_blockNumber` costs 80 credits, so about 37k calls/day | The indexer log already shows 194 "429 Too Many Requests" errors |
| publicnode (ETH #3) | Keyless; limits not published | Served single-address ranges up to 1,800 blocks; blocked a 10-address request ("Request blocked") |
| optimism public (OP) | "Rate limited", no SLA (docs.optimism.io) | ~170k+/day with no failover configured |
| Alchemy (recon) | 30M CU/month, 300 CU/s; paid $0.525 per 1M CU | Too small for the indexer |

**Ways to bring RPC under the free tiers** (all are code or config changes, so the owner decides):
1. Poll the Ethereum walkers on a slow cadence, e.g. 60 s. That gives about 100k/day.
2. Share one head read per chain per round.
3. Merge the 5 `aave_v3_etherfi` streams, which all start at the same block.
4. Pace the hot loop, e.g. one round per 5 s tick. OP would then make about 140k calls/day.

Together these land at about **200–250k calls/day, within dRPC's free tier**. Also add a dRPC OP key as a second OP endpoint.

**Seeding the database:** restore a `pg_dump` of the local database (excluding `risk_*` data) instead of backfilling from chain, since the free providers limit log ranges.

### A4. SSE and how the web reaches the API

- **SSE needs a persistent process.** That rules out Vercel Functions or Workers for the API and anything that scales to zero.
- **Cloudflare:** the default proxy read timeout is 125 s. SSE sends a snapshot as soon as a client connects and a heartbeat every 15 s, so that is fine. **Quick tunnels (trycloudflare) do not support SSE**, so "HTTPS with no domain" through Cloudflare isn't an option. Named tunnels need a domain on Cloudflare.
- **CORS is already open (`*`)**, including the `Cache-Control` preflight (cmd/api/middleware.go:129-154). Both same-origin and cross-origin deployments work. Note this conflicts with the design spec §8, which says "CORS pinned to site origin".
- **Rate limiter:** it keys on `r.RemoteAddr` (middleware.go:405-451). Behind a tunnel or Caddy, every visitor lands in one 20 req/s (burst 40) bucket. Either raise `SOLVENT_API_RATE_LIMIT`/`_BURST` and rate-limit at the edge, or trust `CF-Connecting-IP` only when the request comes from the tunnel (a code change).

---

## B. 2026 prices and limits

| Option | Price / limits | Fit |
|---|---|---|
| **Hetzner Cloud** (Germany/Finland; new prices since 2026-06-15) | CX23 2/4/40: €5.49 ($6.49) · CAX11 (Arm) 2/4/40: €5.99 ($6.99) · **CX33 4/8/80: €8.49 ($9.99)** · CAX21 4/8/80: €10.49 · IPv4 €0.50 ($0.60) extra · 20 TB traffic | **Best value.** Backups cost +20% (secondary source). The cost-optimized plans page said "currently unavailable" when I fetched it on 2026-09-24, so check stock. |
| **Oracle Always Free A1** | 1,500 OCPU-hours and 9,000 GB-hours per month, i.e. **2 OCPU and 12 GB** (was 4/24 until 2026-06-15); 200 GB block storage; 10 TB egress. Idle instances are reclaimed if CPU p95, network and memory are all under 20% for 7 days | Fits easily and riskd keeps it well above the idle threshold. The risks are capacity and policy. |
| DigitalOcean | $6 (1 GB/25 GB), $12 (2 GB/50 GB), $24 (2 vCPU/4 GB/80 GB); backups +20–30% | 2–4× Hetzner's price |
| Linode / Vultr (secondary sources) | Linode 1 GB $5, 2 GB $12, 4 GB $24; Vultr 1 GB $5, 2 vCPU/4 GB about $20 | 2–3× Hetzner's price |
| Fly.io | shared-1x: 1 GB $5.89, 2 GB $11.07; shared-2x 4 GB $22.13; volumes $0.15/GB-mo; IPv4 $2; no free compute allowance | Full stack about $30+/mo, and shared-CPU quotas are a poor match for riskd |
| Railway | $5 Hobby (includes $5 usage); about $20 per vCPU-month, $10 per GB-month, volumes $0.15/GB | About $38+/mo because riskd uses a core continuously |
| Render | Free web services sleep after 15 min; free Postgres is 1 GB and expires after 30 days; background workers aren't free | Not suitable |
| Koyeb / Northflank | Koyeb's free Postgres is 1 GB and 5 h; Northflank's free sandbox allows 2 services and 1 database (always on). Solvent needs 4 services | Not suitable |
| Neon / Supabase / Aiven (free) | 0.5 GB with forced scale-to-zero and 100 CU-h / 500 MB, paused after a week / 1 GB, powered off when idle | Not suitable (size, latency and sleeping) |
| Vercel Hobby | Free; 100 GB transfer, 1M function invocations, 4 h active CPU; **"non-commercial personal use only"** (no payments, ads or paid client work; donations are allowed) | Fine for the web half of a personal portfolio |
| Cloudflare | Workers free: 100k requests/day, 10 ms CPU. Tunnel: free, needs a Cloudflare zone. R2: 10 GB-month free, free egress | Tunnel plus R2 are the free glue |
| Tailscale Funnel | Free on every plan; `*.ts.net` HTTPS; ports 443/8443/10000; unspecified bandwidth limits | Fallback if you want no domain |
| Domain | Cloudflare Registrar .com **$10.44/yr**, rising to about $11.15 on 2026-11-01 (registry increase; secondary source) | About $0.90/mo |

---

## C. Recommended setups

### Setup 1 (recommended): Hetzner CX33, everything in one compose file, Cloudflare Tunnel

- **Cost:** €8.99/mo (about $10.59) plus about $0.87/mo for the domain, so **about $11.50/mo**. With Hetzner backups add about €1.70.
- **Cheaper floor:** CX23 at €5.99 (about $7.09), with retention set to 500.

**What runs where.** One Docker Compose stack on the VPS:
- `postgres:16` with no published port and a volume
- indexer, riskd and api, each connecting to Postgres with its own database role
- web (`next start`, port 3111)
- `cloudflared`

**HTTPS and SSE.** The Cloudflare named tunnel handles TLS at the edge, so no ports need to be open (manage SSH through Tailscale or a firewall rule).
- Ingress rules: `https://<domain>/v1/*` goes to `api:8080`, everything else goes to `web:3111`. The site is therefore **same-origin**; build with `NEXT_PUBLIC_SOLVENT_API_URL=https://<domain>`.
- SSE passes straight through thanks to the 15 s heartbeat.
- Caddy is an alternative if you open ports 80/443; it streams `text/event-stream` responses.

**Backups.**
- Nightly `pg_dump -Fc --exclude-table-data='risk_*'` sent to R2 (10 GB free), keeping 7.
- riskd rebuilds the risk tables from derived state, so they don't need backing up.
- Optionally add Hetzner's whole-disk backups.
- Don't use WAL archiving: WAL volume is tens of GB/day.

**Steps.**
1. Buy the domain on Cloudflare.
2. Create the CX33 (EU region). Keep IPv4, because GitHub and ghcr have no IPv6.
3. Build the Go and web images in GitHub Actions and push them to ghcr.
4. Write a production compose file:
   - drop the 5432 publish
   - give `solvent_riskd` login and add a SELECT-only API role
   - set `SOLVENT_RISK_RETENTION=500`–`1000` and `SOLVENT_RISK_POLL_INTERVAL=30s`–`60s`
   - keep secrets in a mode-600 `.env` file
5. Restore a dump from the local database.
6. Bring up the indexer, then riskd, then the API, then the web app.
7. Create the tunnel and its routes.
8. Raise the API rate limit and add an edge rate limit.
9. Point a free uptime monitor at `/` and `/v1/…`.

**Risks:**
- The 40 GB disk on a CX23.
- Hetzner raised prices twice in 2026, although existing servers are exempt from the June change.
- RPC quotas (section A3).

### Setup 2 (cheapest possible): Oracle Always Free A1, same stack

- **Cost:** about $0.87/mo (domain only).
- **Layout:** 2 OCPU, 12 GB, up to 200 GB, arm64 images. Tunnel, same-origin routing and backups are the same as Setup 1. 200 GB would even allow retention of 5000 today.
- **Risks:**
  - A1 capacity is often unavailable.
  - The June 2026 cut came with no announcement, and over-limit instances were terminated after 2026-08-18.
  - Accounts can be locked.
- **Mitigation:** upgrade the account to pay-as-you-go (Always Free resources stay free), and keep off-box dumps plus a one-command redeploy script so you can move to Hetzner in under an hour.

### Setup 3 (split): Vercel Hobby for the web, backend on Setup 1 or 2

- **Cost:** the same as the backend option chosen.
- **Web:** Vercel with Root Directory `web` and "include files outside root"; `web/vercel.json` already has the install and build commands.
- **API:** `api.<domain>` through the tunnel. Cross-origin works because CORS is `*`.
- **Pros:** the UI shell stays up from a CDN even when the VPS is down, and you get preview deploys per PR, as design spec §8 intended.
- **Cons:** two origins, and the Hobby plan's non-commercial terms. A personal portfolio fits them as long as it carries no ads or payments.

**The cheapest option that is actually reliable enough for a recruiter to click at any time is Setup 1 on a Hetzner CX23, about $8/mo in total.** I would spend the extra €3 on the CX33 for disk and RAM headroom. Setup 2 costs nothing but carries platform risk you don't control. Whichever you pick, reduce the indexer's RPC polling before launch: otherwise paid RPC (about $135–290/mo modeled) will cost more than hosting.

---

## Verified vs unverified

**Verified (from repo files, logs, RPC calls or fetched documentation):**
- Stream layout, cadences and defaults (file and line numbers cited above).
- The ~29 s batch cadence and 9,848–10,010 positions per batch (solvent-riskd.log).
- Retention and prune logic, and the one-row-at-a-time inserts.
- Open CORS and the limiter keyed on RemoteAddr.
- Web route types in today's build.
- The compose file publishes port 5432; there are no Dockerfiles and no `deploy/` directory.
- Provider domains and measured latencies.
- OP head block 157,337,214 (0x960c67e).
- The Debt Manager and legacy Aave log counts.
- dRPC free-key `getLogs` refusals.
- The Infura 429s and dRPC free-plan 408s in solvent-indexer.log.
- Every price or limit that appears in Section B with a primary source.

**Unverified or assumed:**
- Per-row byte sizes and the ~2 legs and ~2 price inputs per position (taken from demo fixtures). The 15.7 MB/batch figure has about ±30% error.
- The size of the base database.
- The V4 book size and event rate.
- The RPC calls/day figure: it is a latency model from the code, not a count. Check the dRPC dashboard after 24 hours.
- Process RAM figures.
- WAL volume.
- Vultr and Linode prices, Hetzner's backup percentage, and the .com price after November (secondary sources).
- Whether pay-as-you-go Oracle accounts keep 4 OCPU / 24 GB (reports conflict).
- SSE working through named tunnels and Caddy: standard behavior, but I didn't test it.

## Sources

- Hetzner price adjustment: https://docs.hetzner.com/general/infrastructure-and-availability/price-adjustment/
- Hetzner IPv4 pricing: https://docs.hetzner.com/general/infrastructure-and-availability/ipv4-pricing/
- Northflank on Hetzner 2026 increases: https://northflank.com/blog/hetzner-cloud-server-price-increases
- Hetzner 2026 price changes and the Ltd tier: https://webhosting.today/2026/05/29/hetzner-has-now-raised-prices-three-times-in-2026-this-one-is-different/
- Hetzner cost-optimized plans: https://www.hetzner.com/cloud/cost-optimized/
- Hetzner backups (secondary source): https://www.bitdoze.com/hetzner-cloud-cost-optimized-plans/
- Oracle Always Free resources: https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm
- InfoQ on the Oracle cut: https://www.infoq.com/news/2026/07/oracle-cloud-free-tier-limits/
- DigitalOcean droplet pricing: https://www.digitalocean.com/pricing/droplets
- Linode/Vultr comparison (secondary source): https://cloudprice.app/compare/vultr-vs-linode
- Fly.io pricing: https://docs.fly.io/about/pricing/
- Railway pricing: https://railway.com/pricing
- Render free tier: https://render.com/docs/free
- Koyeb pricing: https://www.koyeb.com/pricing
- Northflank pricing: https://northflank.com/pricing
- Neon pricing: https://neon.com/pricing
- Supabase pricing: https://supabase.com/pricing
- Aiven free Postgres: https://aiven.io/free-postgresql-database
- Vercel fair use guidelines: https://vercel.com/docs/limits/fair-use-guidelines
- Cloudflare quick tunnels: https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/trycloudflare/
- Cloudflare named tunnels: https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/get-started/create-remote-tunnel/
- Cloudflare 524 timeout: https://developers.cloudflare.com/support/troubleshooting/http-status-codes/cloudflare-5xx-errors/error-524/
- Cloudflare Workers limits: https://developers.cloudflare.com/workers/platform/limits/
- Cloudflare R2 pricing: https://developers.cloudflare.com/r2/pricing/
- Tailscale Funnel: https://tailscale.com/kb/1223/funnel
- Cloudflare Registrar pricing (secondary source): https://startupowl.com/reviews/cloudflare-registrar
- dRPC free plan: https://blog.drpc.org/upcoming-changes-to-drpcs-free-plan-effective-june-1-2025/
- dRPC flat pricing: https://blog.drpc.org/announcing-flat-pricing-simple-transparent-fair/
- Infura pricing: https://docs.infura.io/get-started/pricing/
- Alchemy pricing plans: https://www.alchemy.com/docs/reference/pricing-plans
- OP public endpoints: https://docs.optimism.io/superchain/networks

**Repo evidence:** everything is under `C:\Users\kasel\source\repos\etherfi\Solvent\`:
- `config\contracts.json`
- `docker-compose.yml`
- `web\vercel.json`
- `web\.next\prerender-manifest.json`
- `cmd\indexer\main.go`
- `cmd\riskd\main.go`
- `cmd\api\main.go`
- `cmd\api\sse.go`
- `cmd\api\middleware.go`
- `internal\ingest\walker.go`
- `internal\store\risk.go`
- `internal\store\migrations\00013_risk_tables.sql`
- `solvent-riskd.log`
- `solvent-indexer.log`
- `docs\specs\2026-07-30-solvent-phase5-web-design.md` (§8, §12)