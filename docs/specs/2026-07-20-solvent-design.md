# Solvent — Design Spec

**Date:** 2026-07-20
**Status:** Approved (design validated section-by-section in brainstorming session)
**Working name:** Solvent. Final name is decided before public deploy; the name is not
load-bearing anywhere except the npm package scope and the domain.

---

## 1. Purpose & context

A portfolio project engineered to demonstrate production-grade full-stack protocol
engineering on real mainnet data, and to signal strongly to the wider crypto industry.

**One-sentence pitch:** *70,000 people borrow against crypto collateral to spend on a Visa
card, and none of them can see how close they are to liquidation — Solvent is the missing
risk surface for ether.fi Cash.*

### Decision record (locked with user)

| Decision | Choice |
|---|---|
| Positioning signal | Full-stack product depth: real data plumbing + consumer-grade frontend |
| Deliverable | Live, publicly deployed, real mainnet data |
| Chain depth | Build on existing deployed contracts; no custom Solidity |
| Backend | Go + PostgreSQL (user is new to Go — the ramp is a deliberate, visible learning story) |
| Frontend | Next.js + TypeScript |
| Product shape | Public explorer + watch mode; zero auth, no wallet connection |
| Migration Observatory | Included as a headline module |
| Timeline | 4–6 weeks to forwardable v1 (user velocity is high; parallel agent development) |

### Research grounding (July 2026, web-verified)

- ether.fi has repositioned from restaking protocol to **crypto neobank**. Cash is the
  growth engine: ~70k+ active cards, ~$1B annualized spend, ~$25M active borrows across
  16+ collateral assets. Restaking-narrative projects are off-brand for them now.
- Their posted stack: **Go + PostgreSQL backend, TypeScript/Next.js frontend** —
  matched deliberately by this project.
- **Live now:** a July 2026 governance proposal replaces Cash's proprietary "Debt Manager"
  lending engine with a dedicated **Aave V4 whitelabel instance on OP Mainnet** ($175M at
  launch, ~$500M target by EOY). Today's engines: Debt Manager + an Aave v3 "EtherFi
  Market" (~$157M TVL).
- Cash contracts are open source (`etherfi-protocol/cash-v3`, actively pushed) on
  OP Mainnet (migrated from Scroll, April 2026).
- ether.fi has **no public REST API and no npm SDK** — integrators get contract addresses
  and one subgraph.
- Oracles ether.fi uses: RedStone (primary), Chainlink.
- Hiring culture: verification-first ("a resume is a claim; code leaves evidence");
  their postings emphasize "extremely independent, owning the entire problem."

Facts marked for Day-0 re-verification are listed in §8.

---

## 2. Product definition

Public, read-only, zero-auth web product. Four surfaces:

1. **Book overview (home).** The entire Cash lending book, live: total borrows, collateral
   mix, health-factor histogram, top positions by risk, and a **liquidation waterfall**
   ("$4.2M becomes liquidatable if ETH hits $2,900").
2. **Address inspector.** Paste any address → health factor, liquidation price per
   collateral asset, stress-scenario results, position history chart, projected interest.
   The 10-second demo.
3. **Watch / alerts.** Register email or Telegram + a health threshold for any address;
   alerter notifies on degradation. Registration exists only for alert delivery — no
   accounts, no wallets, no SIWE.
4. **Migration Observatory (headline module).** Live public record of the Debt Manager →
   Aave V4 cutover: TVL and position count per engine over time, rate comparison,
   cap utilization vs the governance-proposed $175M→$500M path, feed of migration
   transactions. **Degrades gracefully** to a "current lending engine deep-dive" if the
   migration timeline slips.

Fifth surface, engineer-facing: **public API + npm client** (§4). ether.fi ships no public
API; this project does.

---

## 3. Architecture

Monorepo, five deployable units, each with one job and one failure domain:

```
solvent/
├── services/
│   ├── indexer/    Go — chain ingestion (OP Mainnet + Ethereum mainnet)
│   ├── riskd/      Go — risk engine: health factors, stress scenarios, projections
│   ├── api/        Go — public REST + SSE, OpenAPI-documented, rate-limited
│   └── alerter/    Go — threshold watching → Telegram/email dispatch
├── web/            Next.js + TypeScript — the product UI
└── packages/
    └── client-ts/  TS client generated from the OpenAPI spec → published to npm
```

- **indexer** tails `cash-v3` contracts and the Aave EtherFi Market via `eth_getLogs`
  windows; decodes with abigen bindings generated from published ABIs; writes normalized
  events and periodic position snapshots to PostgreSQL. Also reads RedStone/Chainlink
  prices (the same oracles ether.fi uses — a deliberate, legible choice).
- **riskd** recomputes risk state on new events and price ticks; persists derived state.
- **api** is the only backend surface `web` talks to. Public, read-only, rate-limited,
  fully described by an OpenAPI spec.
- **alerter** evaluates watch registrations against riskd output; delivers via Telegram
  bot and transactional email; retries with backoff; delivery log in Postgres.
- **web** renders the four product surfaces; live updates via SSE.

**Rationale for the split:** each unit has a genuinely different failure mode (chain
reorgs, compute lag, public traffic, delivery retries). The boundaries are the
systems-design story told in interviews.

### Deployment

| Component | Where | Notes |
|---|---|---|
| Go services + Postgres | Fly.io (Railway acceptable fallback) | Docker images; Compose for local dev |
| web | Vercel | preview deploys per PR |
| RPC | Alchemy or QuickNode + one fallback provider | budget-tier; provider failover in indexer |
| Run cost | ~$50–100/mo | accepted through the interview cycle |

---

## 4. Data flow & core computation

### Ingestion

1. **Backfill:** walk historical logs from each contract's deployment block in bounded
   `eth_getLogs` windows; idempotent upserts keyed on `(tx_hash, log_index)`.
2. **Live follow:** small confirmation lag (single-digit blocks, tuned during
   implementation) + reorg detector (parent-hash continuity
   check; on mismatch, rewind cursor and re-ingest). Positions are **derived state** —
   always rebuildable from the event log.
3. **Two engines, one schema:** a `lending_engine` discriminator normalizes Debt Manager
   and Aave-instance positions into shared `positions` / `position_events` / `snapshots`
   tables. The Migration Observatory is then a query over data the indexer needs anyway.

### Risk math (the "money code")

- **Aave side:** reimplement v3/v4 health-factor math (Σ collateral × liquidation
  threshold ÷ Σ debt) from published parameters, then **validate against live values** by
  cross-checking sampled positions with on-chain `getUserAccountData()`. Golden-vector
  tests pin the math to mainnet reality.
- **Debt Manager side:** derive LTV/liquidation logic from `cash-v3` source; validate the
  same way against direct contract reads.
- **Stress engine:** deterministic shocks — ETH −10/−20/−30%, weETH/ETH depeg to 0.95,
  borrow rate +200bps — recomputed per position; protocol-wide aggregation produces the
  liquidation waterfall.
- **Traceability:** every number in the UI resolves to "computed from these on-chain
  values at block N" on hover.

---

## 5. Feature build order (= demo order)

| # | Surface | The moment it creates |
|---|---|---|
| 1 | Book overview | "This is the entire lending book behind the ether.fi card, live" |
| 2 | Address inspector | Paste any address → instant full risk picture |
| 3 | Migration Observatory | "Watch ether.fi's engine swap happening block by block" — the screenshot that gets forwarded internally |
| 4 | Watch/alerts | A Telegram message arrives during the demo: product, not dashboard |
| 5 | API + npm client | OpenAPI docs page; `npm install` — the engineer-to-engineer handshake |

**Frontend bar:** must look like ether.fi could have shipped it — their visual register
(dark, dense, financial), real loading/error/empty states, RPC-lag states as first-class
UI, decent on mobile.

---

## 6. Risks & de-risking

| Risk | Mitigation |
|---|---|
| Research facts stale/wrong (addresses, event coverage, V4 timeline) | **Day-0 recon spike, GO/NO-GO gated** (§8) before product code |
| Debt Manager proves opaque to reconstruction | Scope shifts to Aave-engine-only; product story unchanged; Observatory degrades to single-engine deep-dive |
| Migration timeline slips | Observatory's graceful-degradation mode is designed in; two-engine schema means no wasted work either way |
| Surfacing individuals' positions | All public on-chain data (as every Aave explorer does); no identity linkage; framed as risk transparency |
| Product dies during interview cycle | Uptime monitoring + status badge in README — reliability as a displayed feature |
| Go-newness shows | Idiomatic-Go review passes on every PR; commit history deliberately shows the ramp — that is the narrative |
| RPC rate limits / cost spikes | Bounded log windows, aggressive caching of immutable data, provider failover |

---

## 7. Testing & quality bar

- **riskd: ~100% coverage, golden-vector tests.** Sampled live positions cross-checked
  against on-chain `getUserAccountData()`. The math being provably right is the product's
  credibility.
- **indexer:** integration tests against an **anvil fork** of OP Mainnet, including a
  reorg-simulation test (snapshot → divergent blocks → assert correct rewind + re-derive).
- **api:** contract tests generated from the OpenAPI spec.
- **web:** Playwright smoke covering the full §9 demo path (book → inspector → stress →
  observatory → alert registration); visual polish pass.
- **CI:** GitHub Actions — lint/vet, tests, build, preview deploys. Green badge row in
  the README.

---

## 8. Day-0 recon spike (GO/NO-GO gate)

Before any product code, verify on-chain (~half a day):

1. `cash-v3` contract addresses on OP Mainnet and whether emitted events suffice to
   reconstruct borrow positions (open/adjust/repay/liquidate lifecycle).
2. Aave "EtherFi Market" (v3) pool addresses and reserve parameters; whether the V4
   whitelabel instance exists on-chain yet.
3. Debt Manager readability: can position state be derived from events + view calls?
4. RedStone/Chainlink feed addresses for all 16+ collateral assets.
5. Whether ether.fi's public subgraph adds anything the indexer shouldn't rebuild.

**GO:** both engines reconstructible → full spec as written.
**Fallback GO:** only Aave engine reconstructible → single-engine scope (§6).
**NO-GO** (neither reconstructible — considered unlikely): return to idea selection with
recon findings in hand.

---

## 9. Demo choreography & flanking moves

- **README as landing page:** architecture diagram, three screenshots, the one-sentence
  pitch, live link above the fold, badge row (CI, uptime, npm).
- **90-second demo path:** home waterfall → paste address → stress slider → Observatory →
  live Telegram alert.
- **One engineering writeup** (exactly one): "Reimplementing and proving Aave's
  health-factor math against mainnet."
- **DefiLlama adapter PR** improving tracking of the Aave EtherFi instance — a merged-PR
  contribution in the repo lineage ether.fi itself forks. ~One day, done after v1 ships.

---

## 10. Out of scope (YAGNI)

- Wallet connection / SIWE / user accounts of any kind
- Custom smart contracts
- Mobile app (responsive web only)
- weETH cross-chain peg/supply monitoring (possible later module; not v1)
- Multi-protocol generalization (Solvent is ether.fi-shaped on purpose)
- Historical backtesting beyond stored position history
- Push notifications beyond Telegram + email

---

## 11. Success criteria

1. Live at a public URL against real OP Mainnet + Ethereum mainnet data; survives an
   unattended week without intervention.
2. Any of the ~thousands of Cash borrow positions inspectable within seconds of chain head.
3. riskd health factors match on-chain `getUserAccountData()` within rounding tolerance
   on a continuously-verified sample.
4. A stranger can: browse the book, inspect an address, register a Telegram alert, and
   receive it when the threshold trips.
5. Migration Observatory shows both engines (or degrades gracefully per §6).
6. OpenAPI docs public; `client-ts` published to npm; README landing page complete.
7. The 90-second demo path runs clean, recorded as a GIF/video in the README.
