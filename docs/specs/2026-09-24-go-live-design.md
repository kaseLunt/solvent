# Go live: the cheapest honest hosting, and everything the public site says (design)

- **Date:** 2026-09-24. Revision 4 folds in Codex rounds 1 and 2 (session `01a0d532-302b-7e50-91c1-07f966750e4b`) and
  a stand-in round 3 (V4 spec §13): the RPC recount and V4 lane, cross-process headroom, the role matrix, fail-closed
  rollback, and scoped README wording. Earlier folds:
  - H6/N5: pacing arithmetic, and a global plus per-domain limiter charged per physical request;
  - H7/N3: SSE admission, and a live-state-safe refresh collapse;
  - M15: an image-pinned rollback;
  - M17: split acceptance;
  - the Cloudflare Worker trust assumption is now stated.
- **Owner direction:**
  - "we should be using live data obviously"
  - "ok yes we need to update everything, go ahead with the v4 engine. figure out the cheapest way for me to host
    everything"
  - "I'll go with your recommendations" (2026-09-24), which covers the recommendations below.
- **Path:** architectural. The stack moves from a laptop to a public server; the change touches the deploy surface,
  indexer pacing, the API edge and the public copy.
- **Companion spec:** `docs/specs/2026-09-24-cash-on-aave-v4-design.md`, the Aave V4 engine this launch serves.
- **Evidence base:** `.superpowers/sdd/2026-09-24-aave-v4/research/hosting.md`, a sourced price-and-limits survey
  dated 2026-09-24, and its repo measurements, cited by path:line.

## 1. Problem

The product runs only on the owner's laptop:
- the web on :3111;
- the API on :8080;
- Postgres in Docker.

A recruiter cannot open it.

The public copy also says things that are no longer true:
- The hero ends "— right now" (`web/lib/overview-copy.ts:14`), and the Book's kicker reads "Cash book · right now"
  (`cash-view.ts:708`), but no stack is running anywhere a visitor can reach.
- "Cash" means the Debt Manager, which has been draining since the Aave V4 cutover. The companion spec covers that
  change.
- Web copy uses "LTV" 13 times and "borrow cap" 25 times, some of them for rules that are not loan-to-value or caps.
- The README and the roadmap still describe V4 as "not yet executed" (`roadmap/STATUS.md`).

The repo also cannot be deployed as it stands (hosting brief §A):
- `docker-compose.yml` publishes 5432 with password `solvent`.
- There are no Dockerfiles and no `deploy/`.
- The API's rate limiter keys on the connection address, so behind any proxy every visitor shares one 20 req/s bucket
  (`cmd/api/middleware.go:405-451`).
- riskd keeps 5,000 batches by default, about 78 GB (`cmd/riskd/main.go:66`).
- The indexer's inner loop never rests. The model puts it at 0.9–2M RPC calls a day, which would cost $135–290/month on
  paid RPC.

## 2. Hosting decision

**One Hetzner CX33** (4 vCPU, 8 GB RAM, 80 GB NVMe, EU region): €8.49 + €0.50 IPv4 = €8.99/month.
- It runs one Docker Compose stack: Postgres 16, indexer, riskd, api, web and `cloudflared`.
- A **Cloudflare named Tunnel** gives TLS with no open inbound ports.
- The **domain** is bought through Cloudflare Registrar, about $10.44/year.
- **Total ≈ $11.50/month.**

| Rejected | Why |
|---|---|
| Hetzner CX23 (€5.99, 40 GB disk) | It works with retention 500, but the disk fills in about 8–12 months. The €3 buys headroom. Kept as the documented fallback. |
| Oracle Always Free A1 ($0) | It fits, but Oracle cut the tier without notice on 2026-06-15, capacity is scarce, and accounts get locked. The link is too important to rest on that. |
| Vercel for the web + VPS for the API | Free, and preview deploys are nice, but it adds a second origin and non-commercial terms, and nothing becomes cheaper. Same-origin behind one tunnel is simpler. |
| Railway / Fly / Render / free Postgres tiers | riskd keeps about one core busy, the database is gigabytes, and SSE needs a process that never sleeps. That is $30–45+/month, or it simply doesn't fit. |

**Routing:**
- `https://<domain>/v1/*` → `api:8080`;
- everything else → `web:3111`.

The web is built with `NEXT_PUBLIC_SOLVENT_API_URL=https://<domain>`, so the site is same-origin.

**SSE:** the tunnel passes it through. Cloudflare's 125 s proxy timeout is covered by the API's 15 s heartbeat. Quick
tunnels (`trycloudflare`) do not support SSE, which is why a domain is required.

**Owner actions** (nothing else needs the owner):
1. Create the Hetzner account and the CX33.
2. Buy the domain on Cloudflare.
3. Create the tunnel and put its token in the box's `.env`.
4. Create an R2 bucket for backups.
5. Optionally, get a free dRPC key for a second OP endpoint.

## 3. Sequencing

1. **Part A (infra) now, under W3.** W3 is the active work item, and deploy, scoped roles and pacing are its
   acceptance items. The box comes up with the current engines, **unannounced**: no link goes in the README or anywhere
   public.
2. **The V4 engine** (companion spec, work item W4) is built locally and deployed onto the running box. Its backfill and
   RPC budget are measured there, on the real provider limits.
3. **Part B (launch) after W4**, under W3: README, copy, the stranger walk. Then the link is shared.

The box goes up before V4 because V4's per-generation reads and backfill have to be measured against the production
providers, not against the laptop's.

## 4. Part A: infrastructure

### A1. RPC pacing (indexer)

The target is **≤ 250k calls/day across all providers with V4 running**, which fits dRPC's free plan (about 350k/day) and
the public OP endpoint. The budget is **enforced**, not assumed.

**How much one walker costs.** Each round a walker makes about **6 reads** per step: the head read, plus 5 window
reads (`walker.go:696, 730, 800, 808, 816, 839`; `stepMaxPinnedReads = 6`, `walker.go:265`). A landing then triggers a
**second step** in the same round. The first draft's 4-second OP rounds would have cost about 454k/day for four OP
walkers alone (Codex H6); the panel's recount of revision 3 came to about 196–232k (R3-C4). The revised plan:

- **Per-chain minimum round interval.** A round starts no sooner than `SOLVENT_ROUND_INTERVAL_OP` (default **12 s**,
  6 OP blocks) or `_ETH` (default **120 s**) after the previous one. This replaces the unpaced hot inner loop
  (`cmd/indexer/main.go:744`, `:1596-1598`).
  - The legacy Aave v3 market is dormant: 0 logs across 7,200 blocks (hosting brief §A2).
  - Prices keep their own 1-minute poller, so the 3-minute price budget is unaffected.
  - Reorg safety doesn't depend on cadence: the verified-ancestor rewind (D-003) is depth-independent.
- **A caught-up signal ends a walker's round.** When a landed window reached `safe`, `Step` reports that it has caught
  up, and the round loop stops stepping that walker (set `lastCursor = to` so `HeadLag` stays fresh). The next round's
  step still reorg-checks before it fetches, so reorg safety waits at most one interval. This removes the second step.
- **No shared head read.** It would conflict with each stream's own endpoint resolution and probing
  (`walker.go:568-592`) and with the witness logic. The caught-up signal saves more.
- **Fewer OP walkers.** The V4 engine uses **one** multi-address, topic-filtered stream (V4 spec §5.1), so OP runs two
  walkers: the Debt Manager and V4.
- **The steady-state model:**

  | Source | Calculation | Calls/day |
  |---|---|---|
  | OP walkers | 7,200 rounds × 2 walkers × 6 | ≈ 86k |
  | ETH walkers | 720 rounds × 10 × 6 | ≈ 43k |
  | Block-time custody (headers for V4 and Debt Manager event blocks) | | ≈ 6k |
  | Price poller | | ≈ 10k |
  | Debt Manager sweep | | ≈ 3k |
  | **Non-V4 subtotal** | | **≈ 148k** |
  | V4 sweeper, its own lane (V4 spec §5.3) | ≤ 1.0 req/s | ≤ 86k |
  | **Total** | | **≤ 234k** |

  With **current engines only** (Part A: the Debt Manager walker, the ETH walkers, prices and the sweep), the model is
  about **100k**.

- **An enforced ceiling** (Codex H6/N5). Two layers of token bucket sit **inside `internal/chain`**:
  - a **global** bucket (`SOLVENT_RPC_RATE_GLOBAL`, default 2.9 req/s ≈ 250k/day, burst 20). It is the stated
    across-all-providers ceiling **for the indexer process**. From it the **V4 lane** (1.0 req/s, burst 300; V4 spec
    §5.3) is carved, leaving every other caller 1.9 req/s ≈ 164k/day, above the ≈ 148k non-V4 model;
  - a **per-provider-domain** bucket (`SOLVENT_RPC_RATE_<DOMAIN>`), sized to **80% of that provider's free tier**. The
    remaining 20% is reserved for the other processes that share the same keys (reconcile, `backfill-blocktimes`, anvil
    fork replays), because the limiter is per process (panel R3-C6). Reconcile runs are kept **outside** the 24 h
    acceptance window, or their calls are counted and reported separately.

  How they are charged:
  - **Per physical request.** A permit is taken inside the failover's endpoint loop, **before** the attempt's timeout
    and latency clock start (`chain.go:885-895`). Each endpoint tried costs one permit.
  - **Wait is not latency.** Waiting for a permit is never charged as endpoint latency, so it cannot trigger rotation or
    the walker's slow-step handling (`walker.go:267-304`). Wait time is recorded separately.
  - **Admission is concurrency-safe,** one limiter per process.

  Behavior when the buckets run dry:
  - Walkers and the price poller wait; their cadence stretches.
  - The V4 sweeper takes a **lease** from its own lane at open, or defers the tick. An admitted generation that misses
    its 90 s budget is abandoned whole (V4 spec §5.3).
  - No call is dropped.
  - Reconcile keeps its own runner.
- **Call accounting.** Each provider domain logs a daily call counter (second-level domain only; never a URL or key).
- **Not done:** merging the ten Ethereum streams. It changes stream identity, and custody would have to be re-proven
  for a saving the cadence already delivers.

### A2. riskd cadence and retention

These are set in the production `.env`, not code defaults:
- `SOLVENT_RISK_POLL_INTERVAL=30s`: a batch still recomputes only when a watermark moves.
- `SOLVENT_RISK_RETENTION=750`: that is ≥ 500, the API's largest history/observatory `limit` (`cmd/api/main.go:92-100`).
  With V4 at about 5k accounts, that comes to roughly 20 GB.

Durable tables (prices, raw logs, snapshots) grow about 1–2 GB/month. The 80 GB disk therefore lasts well past a year,
with a disk-usage alert at 70%.

### A3. Images

- **One Go image:** multi-stage build of `indexer`, `riskd` and `api` from one module. The runtime stage is small
  (distroless or alpine) and runs as non-root. The API's runtime files are copied in (hosting brief §A1):
  - `config/contracts.json`
  - `recon/feeds.json`
  - `recon/p3-probes.md`
  - the committed drift-report artifact

  Never the 633 MB `recon/`.
- **One web image:** `next build` with the API URL as a build arg, served by `next start`.
- Images are built **on the box** (`docker compose build`). This avoids any change to `.github/workflows`, a protected
  surface, and a registry.

### A4. Production compose (`deploy/compose.prod.yml`)

- **Postgres:** no published port; a generated password in the mode-600 `.env`; a named volume.
- **Separate database roles, from one declared matrix** (panel R3-3).
  - **Today's gap.** The only grants live in migration 00013, over a fixed table list (`00013:536-563`). Tables created
    since then have no grant: `block_headers`, `observatory_points`, and V4's new tables. Roles do not travel in a
    `pg_dump`, and grant blocks inside goose migrations never run again after a restore.
  - **The matrix.** One role×table privilege matrix is declared in Go (e.g. `store.RoleGrants`), covering:
    - `solvent_riskd`;
    - `solvent_api` (SELECT only);
    - the login users that are members of those roles.
  - **Applying it.** An idempotent **`roles` step** applies the matrix after every migration **and** after every
    restore. It is a one-shot compose service that runs before riskd and the API start.
  - **Keeping it complete.** A database test walks `pg_tables` against the matrix, so a new table without a declared
    grant fails CI.
  - **Who uses what.** The indexer owns the schema and runs migrations. riskd runs as `SOLVENT_RISKD_DATABASE_URL`,
    which closes W3 Acceptance 4's riskd WARN. The API runs as the SELECT-only `SOLVENT_API_DATABASE_URL`.
- **Start order:** indexer (migrations) → `roles` → riskd → api → web, gated by health checks. The API's schema-version guard
  already refuses to start early.
- **Operations:** `restart: unless-stopped`, log rotation (`json-file`, capped size), memory limits per service.

### A5. The edge

- **Rate limiter.** The API trusts `CF-Connecting-IP` **only** when the TCP peer is the `cloudflared` container on the
  compose network. Any other peer keeps its RemoteAddr, so a spoofed header from outside does nothing. There is a test
  for both directions.
  - **Trust assumption, stated in the runbook:** the zone runs no Cloudflare Workers. A same-zone Worker can rewrite
    forwarding headers.
- **Edge limit.** A Cloudflare rate-limit rule (the free tier allows one) backs this up.
- **SSE admission.** Request rate limits charge a stream once, but each connection then holds a subscription, timers and
  a full-batch refresh per poll (`sse.go:376-413, 486-487`, `read.go:294-320`). So:
  - concurrent streams are capped **globally** (`SOLVENT_API_SSE_MAX`, default 256) and **per client**
    (`SOLVENT_API_SSE_MAX_PER_CLIENT`, default 4). Over the cap, the answer is `429` + `Retry-After`;
  - **refresh work is collapsed without hiding live state** (Codex N3). The **immutable** batch children (rows,
    aggregates) are cached by batch id. The **live metadata** is refreshed once per poll interval by **one shared
    reader** for all subscribers:
    - database time;
    - derive cursors;
    - reorg epochs;
    - sweep and generation state;
    - read health.

    Its **transitions** (superseded, stale, database unreachable) fan out to every stream, so an unchanged batch id
    never masks a supersession or an outage (`read.go:342-345, 377-385`; `sse.go:475-487`);
  - a load test holds 256 streams on the CX33 and records CPU and database load.
- **CORS** is pinned to the site origin, as the P5 spec §8 intended. It is `*` today (`cmd/api/middleware.go:129-154`).

### A6. Seeding

- Restore a `pg_dump -Fc` of the laptop database, **excluding `risk_*` data**; riskd rebuilds those tables.
- The indexer then resumes from its stored cursors under the new pacing.
- This avoids a from-genesis backfill that the free providers' `eth_getLogs` range limits would throttle.

### A7. Backups and operations

- **Backups:** a nightly `pg_dump -Fc --exclude-table-data='risk_*'` to R2 (10 GB free), keeping 7.
- **Restore drill:** documented in the runbook, and run once before launch.
- **Box hardening:**
  - SSH is key-only;
  - `ufw` denies all inbound except SSH;
  - unattended security upgrades are on.
- **Monitoring:** a free uptime monitor watches `/` and one `/v1` endpoint.
- **Deploy.** `deploy/compose.prod.yml` has **no `build:` keys**. It declares `image: solvent-go:${IMAGE_TAG:?}` and
  `solvent-web:${IMAGE_TAG:?}`. The deploy script builds each image separately with
  `--label org.opencontainers.image.revision=<sha>`, then runs `up --no-build --pull never` (panel R3-4).
- **Rollback.** The API and riskd require the schema version to match exactly (`cmd/api/main.go:692-704`,
  `cmd/riskd/main.go:739-750`), so checking out an older tag cannot roll back a migration.
  - Images are **tagged by commit** (`solvent-go:<sha>`, `solvent-web:<sha>`). The last two deploys' images are
    protected: the runbook's prune script keeps them, and `docker image prune -a` is forbidden.
  - Every deploy that carries a migration first takes a **pre-deploy dump**.
  - Rollback is:
    1. Stop the whole stack, so the new indexer cannot migrate the restored database forward.
    2. Restore that dump.
    3. Check that `docker image inspect solvent-go:<prev>` exists and that its revision label equals `<prev>`. Then
       `up --no-build --pull never` with `IMAGE_TAG=<prev>` and the **previous deploy's saved copy** of the compose
       file. This is the previous deploy's **own images**, and it fails closed if they are gone (Codex M15, panel
       R3-4).
    4. riskd rebuilds `risk_*`.
  - The rollback drill runs once before launch, against a real migration.
- **`deploy/README.md`** is the runbook (W3 deliverable).

## 5. Part B: "update everything" (after W4 is live on the box)

### B1. README

The README leads with:
1. the live link;
2. one sentence;
3. the three engines.

The rest is ordered by chain evidence:
- The V4 engine's **per-generation check**, quoted as a **stamped instance** of the sentence the API renders (V4 spec
  §5.8), with block and date. For example: "At OP block P (date), our integer replica matched `getUserAccountData` on
  all 7 fields for N of M borrowers, with refused and unread accounts counted; share ring complete."
  - It never says "every account" or "every generation" (panel R3-7).
  - The sealed and abandoned generation counts over a stated window go beside it.
- Each engine's reconcile receipt, with its own figures and its own scope.

Every number carries its source. The "exact" claim is split honestly in a table of what is exact against the chain,
what is modelled (stress scenarios, projections) and what is sampled (polled prices, D-012). The P5 spec §8 landing
items remain: architecture diagram, screenshots and the 90-second demo path.

### B2. Copy truth pass

- **"Right now" and "live"** render only while the stream is connected **and** the served batch is inside its
  freshness budget. They are a condition, not a constant; otherwise the page says how old its batch is.
- **Rule words.** Each engine's rule gets its own word:
  - "liquidation threshold" for Aave v3;
  - "collateral factor (one factor for borrowing and liquidation)" for V4;
  - the Debt Manager's own term for its cap rule.

  The 13 "LTV" and 25 "borrow cap" sites are each re-ruled against that engine's code. None is replaced blindly.
- **Stale governance lines.** The stale blocker text is corrected: `roadmap/STATUS.md` "AIP not yet executed" (it
  executed at OP block 154,924,987). This is an owner-reviewed STATUS edit.

### B3. Presentation decisions (the owner's; recommendations given)

1. **How it was built.** A short README section in the owner's own voice, naming AI-assisted development and the review
   gates (Codex approvals, reconcile receipts). I draft the factual scaffold; the owner writes the voice.
   **Recommended:** disclose. Web3 hiring reads GitHub closely, and an honest process story is a strength.
2. **Process artifacts** (`.superpowers/`, most of `roadmap/`). **Recommended:** keep them on `main`, behind a
   "Repository map" section that labels them as the project's engineering ledger. Moving them to an archive branch is
   the alternative if the owner prefers a cleaner tree.

### B4. Launch

1. The P5 spec §11 stranger walk passes on the public URL.
2. An **unattended week** passes with no manual intervention (P5 §11 criterion).
3. Then the link goes into the README and is shared.

## 6. Out of scope

- CI-built images and registries (they touch protected `.github/workflows`; revisit only with the owner's ack).
- Multi-region hosting and high availability.
- Paid RPC.
- Alerts (P4).
- Merging the Aave v3 streams.
- Vercel preview deploys.

## 7. Cost (monthly)

| Item | Cost |
|---|---|
| Hetzner CX33 + IPv4 | €8.99 (≈ $10.59) |
| Domain (Cloudflare, $10.44/yr) | ≈ $0.90 |
| Cloudflare Tunnel, rate-limit rule, R2 (≤ 10 GB) | $0 |
| RPC: dRPC free + public OP + publicnode/infura fallbacks, after A1 pacing | $0 |
| **Total** | **≈ $11.50** |

## 8. Risks

| Risk | Mitigation |
|---|---|
| RPC free tiers change or throttle | Daily call counters (A1); a second OP endpoint. The modelled steady state (≈ 170k) is about half the free cap, and the per-provider token bucket enforces the ceiling. |
| Hetzner stock or price change | CX23 fallback documented; a new server is restored from R2 dumps in under an hour. |
| Disk growth | Retention 750; 70% alert; durable growth is measured monthly in the runbook. |
| The public OP endpoint has no SLA | Failover list plus the optional dRPC OP key. Any outage is an honest stale-batch state on the site, never a zero. |

## 9. Verification

- **Part A (under W3, before V4):**
  - `deploy/compose.prod.yml` comes up clean on a fresh VM (the runbook is followed verbatim);
  - the restore and rollback drills pass. The restore re-applies the role matrix, and the rollback fails closed when
    the previous images are missing;
  - the role-matrix test passes: every table in `pg_tables` has a declared grant;
  - the API rate-limit peer-trust tests pass both ways;
  - SSE admission and refresh-collapse tests pass, including a supersession or outage **under an unchanged batch id**
    that reaches every stream; the 256-stream load test is recorded;
  - the pacing and limiter tests pin:
    - the round intervals;
    - the global and per-domain ceilings;
    - **per-physical-request** charging across a failover walk;
    - that permit wait is never counted as endpoint latency;
  - the call counters show the measured 24 h total with the **current** engines, recorded in the ledger against the
    model's current-engines figure (≈ 100k; A1).
- **After V4 (under W4's live acceptance):** the 24 h counters with V4 running are ≤ 250k/day and are recorded. This is
  split out because Part A's own acceptance cannot depend on a component built after it (Codex M17).
- **Part B:**
  - W3 Acceptance 1–5 (web suites green, stranger walk on the public URL);
  - every README figure traced to an artifact or a live endpoint;
  - a Codex review of the deploy and edge changes (D-006: the rate-limiter trust boundary is security-relevant).
