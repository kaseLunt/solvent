# Task 2 report — demo dataset for History and Activity (R9)

Status: DONE. Commit: `ee88513` on main (parent `cb22370`).

## What was done

Created `web/tests/fixtures/demo/generate-demo-secondary.mjs` (the generator, on
`generate-demo-lab.mjs`'s discipline: a provenance header naming every figure's
source, every body walked by `checkClocks` before it is written, the trio count
per body pinned in `CLOCK_TRIOS`), and ran it to write three bodies:

- `observatory-demo-dm.json` — `ObservatorySeriesResponse` for `debt_manager`,
  166 points over 168 hourly buckets (165 captured, 1 withheld, 2 absent), 166
  clock trios.
- `observatory-demo-aave.json` — the same shape for `aave_v3_etherfi`, 0 trios
  (the engine has no sweeper; `sweep_recorded: true`, `sweep: null`).
- `events-demo-feed-page-1.json` — one cross-engine `EventsResponse` page of 50
  rows, 0 trios (no clock on a feed page).

Modified `web/tests/fixtures/demo/index.ts` (exports `DEMO_OBSERVATORY_DM`,
`DEMO_OBSERVATORY_AAVE`, `DEMO_FEED_PAGE_1`) and
`web/tests/unit/fixture-clock-law.spec.ts` (the census: `demo/observatory-demo-dm.json: 166`;
`CENSUS_TOTAL` 101 → 267 with its derivation comment; a note that the three new
bodies carry no `batch` envelope, so the batch-bearing count stays 40).

Wrote `web/tests/unit/demo-secondary-weld.spec.ts` (16 tests) first, watched it
fail for want of the fixtures (ENOENT at `index.ts:40`), then generated.

The generator is deterministic: a second run reproduced all three bodies
byte-for-byte (sha256 checked).

## Every figure's provenance rule

### The clock
- `served_at`: the demo Book's (`book.demo.json`); `meta.demo.json` must agree on
  the clock and the batch (asserted, generator fails otherwise).
- Newest bucket: the hour the Book's batch was computed in (`computed_at`
  2026-08-08T20:22:08Z → bucket 20:00:00Z). 168 buckets walk back at the native
  hourly stride; `from` = the oldest bucket (2026-08-01T21:00:00Z), `to` and
  `step_seconds` null (every native bucket served).

### The weld (newest bucket of each series = the Book's engine card)
- `debt_usd` = card `total_debt`; `collateral_usd` = card `total_collateral`;
  `accounts` = card `positions`; `refused_positions`, `liquidatable_positions`
  verbatim; `usd_decimals` = card `value_decimals`.
- `batch_id` = the Book's batch (18251); `last_block`, `acked_epoch`,
  `max_epoch_at_compute` = the Book's watermark for the engine (DM 155323444,
  Aave 25714690).
- `sweep` = the Book's watermark sweep for the engine: the DM sweep verbatim (its
  `age_seconds` 1205 is against the same `served_at`; re-derived with
  `ageSeconds` and asserted), the Aave watermark's null. The generator also
  asserts the watermark sweep and the engine card sweep are the same object.
- The weld is asserted in the generator before anything is written.

### The drift (design figures — no history exists for the demo batch)
- `debt_usd`, `collateral_usd`, `accounts`: a bounded walk in whole basis points
  around the Book's figure. offset(0) = 0; offset(h) = offset(h−1) + step, step
  drawn in [−40, +40] bps by a glibc-constant LCG on BigInt (seeded from
  sha256 of `${engine}:${metric}`, read from the state's high 15 bits — see
  "deviations" for why), reflected at ±800 bps; value(h) = floor(book ×
  (10000 + offset(h)) / 10000). So neighbours differ by at most 0.4 % of the
  Book's figure per hour, and the newest bucket lands on the Book exactly.
  Observed DM debt offset range over the week: −674 … +40 bps.
- `liquidatable_positions`: the Book's L at the newest bucket; L + ((7h + 1) mod
  3) − 1 elsewhere (L−1, L, L+1).
- `refused_positions`: the Book's on every captured bucket.

### The holes
- Hours 40 and 41 back: no point (absent buckets; the axis inserts two gaps).
- Hour 90 back (2026-08-05T02:00:00Z): withheld — `refused: true`, `refusal_code`
  = the contract example's own code read from `../observatory-series-dm.json`'s
  withheld point (`FLAG_CUSTODY_UNPROVEN`), `accounts`/`liquidatable_positions`/
  `debt_usd`/`collateral_usd` null, `refused_positions` 0, `rates: []`. The DM
  withheld point still carries its sweep stamp (as the contract example's does:
  the stamp is capture-time evidence).
- The walk advances through the holes, so neighbours across a hole differ by up to
  one step per hour skipped (the spec bounds by hours between points).

### Batches and blocks
- Bucket 1 observes the batch the Inspector demo's history
  (`history-demo-near.json`) computed last before the bucket boundary — batch
  18206 at 19:59:38Z — and that point's DM `balances_block` (155322769), so the
  two demo surfaces agree where they overlap. Buckets 2..167 step 12 batches an
  hour below it (a five-minute cadence; oldest batch 16214). Both engines observe
  the same batch per bucket (asserted in the spec).
- `last_block`: DM steps 1,800 blocks an hour (2 s blocks) below the history's
  block from bucket 1; Aave steps 300 blocks an hour (12 s blocks) below the
  Book's watermark from bucket 0 (no committed body states batch 18206's Aave
  watermark).
- DM sweep on older buckets: the Book's sweep with `max_updated_at` shifted back
  by the bucket's offset and `age_seconds` re-derived by `ageSeconds()`; `rows`,
  `failed`, `success_sum`, `generation`, `generation_open` verbatim.
- `materialization_key`: sha256 over `solvent-demo:observatory:<engine>:<batch_id>:<bucket_start>`.

### Rates
- One row per captured bucket: the contract example's rate row
  (`../observatory-series-dm.json` points[0].rates[0]) with `as_of_block` =
  `last_block − 10` (the example's own trailing law). DM asset = the /v1/events
  example's OP USDC (the contract example's DM rate row carries the mainnet
  address on an OP engine; not copied). Aave row re-registered to
  `liquidity_index` / `ray-1e27`, asset = the Book's own waterfall held-flat
  mainnet USDC mark (asserted equal to the /v1/events example's USDC), value =
  the example's 1.05 at ray scale. Older buckets unwind 5 %/year linear in hours
  (design figure).

### The feed page
- Envelope, defaulted cross-engine filter and the four notes: the contract's own
  200 example (`../feed-cross-page-1.json` IS that example). `limit` 50.
- 48 timed rows newest first: each row's offset behind `served_at` grows by a
  draw in [20, 400] s (page spans 20:21:05Z → 17:35:15Z); then the untimed tail
  of two (`block_time` null; chain_id DESC — OP row then ETH row; heights below
  every timed row of their engine; types: a DM repay and an Aave borrow).
- Heights: the Book's watermark minus elapsed seconds at the chain's cadence
  (12 s / 2 s). Chain ids are the example rows' and are asserted equal to the
  Book's watermark chain per engine.
- Display vocabulary: read from `api/openapi.yaml`'s `EventDisplayType` enum by
  regex (generator fails if unreadable); every class drawn (asserted; the
  generator refuses to pad).
- `raw_type` / `amount_unit` per engine and class: `internal/store/p5_events.go`'s
  classification maps, pinned (collateral toggle names from
  `collateralflags.go`); the two example rows are asserted to match the pinned
  map. Supply, withdraw and the toggles are record-only (unit `none`, amount
  null) — the store's own classification.
- Accounts: DM rows are the demo positions pages' own accounts (liquidation rows
  from liquidatable rows by stride 7; others from computed non-liquidatable rows
  by stride 23). Aave accounts are sha256-derived addresses (see deviations).
- `tx_hash`: sha256 over `solvent-demo:feed:<chain>:<block>:<log_index>`.
- Amounts: a nominal in dollars and cents drawn in [50.00, 25000.00] at 6
  decimals, carried in the engine's accounting unit at the series' newest index
  1.05: wire = floor(nominal × 1e18 / index) (the USD-6 view of a normalized
  amount is value × index ÷ 1e18; the scaled Aave unit is the same division).
  Repays, liquidations and write-offs negative on the debt side.
- Three liquidations:
  - Two DM rows on distinct liquidatable demo positions:
    `before_debt_usd` = the position's `total_debt`; `debt_repaid` = half of it
    (the Book's own eligibility note: "the Debt Manager closes in two passes,
    50% then remainder"); `debt_decimals` = the card's `value_decimals`; one
    seized weETH leg at the meta's chain-10 weETH witness price plus the bonus
    `../feed-liquidations.json`'s DM row states (5e18 in the 100e18
    denomination); `interest_index` = the series' index; `debt_asset`,
    `deficit_paired`, `configured_bonus_bps`, `realized_bonus_bps` null (schema:
    DM debt is USD-valued, no deficit pairing, bonus denomination is not bps);
    liquidator sha256-derived; note = the DM example's.
  - One Aave row carrying the contract example's extract verbatim (repaid
    $2,500, configured 500 bps, seized 0.65625 weETH, the example's liquidator)
    except `deficit_paired: true`: a `deficit_created` row shares its
    transaction at the next log index and serves first in DESC order; the
    write-off's amount is a design figure ($180, scaled).
- `next_cursor`: base64url over the last row's coordinates (opaque; non-null —
  more exist behind the cursor).

## The census

| body | trios | why |
|---|---|---|
| `demo/observatory-demo-dm.json` | 166 | one sweep stamp per point (165 captured + 1 withheld), each `age_seconds` over `max_updated_at` against `served_at` |
| `demo/observatory-demo-aave.json` | 0 | `sweep: null` on every point (the contract's "no sweeper") |
| `demo/events-demo-feed-page-1.json` | 0 | a feed page carries no clock |

`CENSUS_TOTAL` 101 → 267. Batch-bearing bodies unchanged at 40 (a series point
names `batch_id`, not a `batch` envelope). The weld spec also extracts the
generator's `CLOCK_TRIOS` by regex and asserts each body's `checkClocks().checked`
equals the pin, so the generator and the census cannot disagree.

## Deviations, with reasons

1. **Aave accounts are sha256-derived, not demo positions' addresses.** The brief
   says "accounts from the demo positions' addresses"; the demo has DM positions
   only (`positions-dm-demo-page-*.json`; the Inspector's four address bodies are
   DM too). Reusing DM accounts on Aave would assert a cross-chain identity no
   committed body states, so Aave accounts follow the Inspector generator's
   discipline for synthetic identifiers (deterministic sha256, well-formed, never
   real). DM rows are all demo positions (asserted in the spec).
2. **"Every amount a wire decimal for its engine's `value_decimals`" is pinned
   through the Feed's own unit law, not as a digit count.** DM amounts are
   `dm_normalized_debt`, a fixed point at the Book's `value_decimals` (6):
   `feedAmount(row, { engineValueDecimals })` places the decimal (`rawUnits`
   false; integer part = wire ÷ 10^6). Aave amounts are `aave_scaled`, whose
   scale is the token's, not the engine's 8 — `lib/feed-view.ts` (R1 item 4)
   says applying the engine's 8 "would be exactly the fabrication the ruling
   forbids" — so the spec asserts `rawUnits` true and the display verbatim.
   Asserting 8-decimal placement on Aave rows would pin a fabrication.
3. **The LCG draws from its high bits.** The first cut drew `state % n`; on a
   2^31-modulus LCG the low bits cycle short (the lowest bit strictly
   alternates), which patterned every small-n choice and made twelve seeds in a
   row miss `collateral_disabled`. The draw is now `(state >> 16) % n`, stated in
   the header. The seed is `feed` (one seed, not a hunt).
4. **DM `configured_bonus_bps` is null**, per the schema's own sentence ("the
   Debt Manager's denomination is 100e18, not bps, so its rows serve null"). The
   existing `feed-liquidations.json` DM row carries `"500"` there; I followed
   the schema, not the sibling fixture.
5. **Batch cadence across the week is 12/hour, not the Inspector history's
   30 s.** 18251 − 120 × 167 would go negative; bucket 1 is welded to the
   history's actual batch (18206) so the two demos agree where they overlap, and
   the header states the cadence change.
6. **Rates asset on DM points is OP USDC**, not the contract example's mainnet
   address (the example's DM rate row carries a mainnet address on an OP engine;
   copying it would put a chain-1 asset on chain 10).

## Verification

- `npx playwright test --project=unit tests/unit/demo-secondary-weld.spec.ts tests/unit/fixture-clock-law.spec.ts` — 108 passed.
- Whole unit project: the plain run cannot collect because a sibling's
  half-written `tests/unit/verification-view.spec.ts` imports `lib/verification-view`,
  which does not exist yet (`Cannot find module`). With every unit spec but that
  file listed explicitly: 842 passed. (Before the sibling's spec appeared, the
  plain whole-project run also passed 842.)
- `npx tsc --noEmit`: zero errors outside `verification-view.spec.ts` (11 errors
  there, the sibling's; none in my files).
- `npx eslint tests/fixtures/demo tests/unit`: clean (exit 0).
- No build, no e2e, no prettier on tests/, per the brief.

## Concerns

- The census jump (101 → 267) is dominated by one file. It is honest — every DM
  point carries a sweep stamp, as the contract example's points do — but a future
  regeneration that changes the point count moves two pins (`CLOCK_TRIOS` and
  `CENSUS`) and the total; both fail loudly, which is the point.
- The Inspector demo's `events-demo-near.json` classifies DM `supply` with
  `raw_type: "supply"` / unit `opaque` and carries a DM `collateral_enabled`; the
  store's map says `supplied` / `none` and has no DM collateral toggles. Not this
  task's file; noted for whoever owns the Inspector demo.
- `meta.demo.json`'s mainnet weETH witness is $9,999 while the chain-10 witness is
  $4,000 (and the contract example's Aave seizure implies $4,000). I used the
  example's Aave extract verbatim rather than re-deriving the seizure at $9,999.
- The two absent hours and the withheld hour sit at fixed offsets (40, 41, 90
  hours back) per the brief; if the pixel pin for the History page needs the
  holes at other positions, the constants are three lines in the generator and
  the spec.
