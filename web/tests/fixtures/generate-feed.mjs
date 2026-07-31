// Feed-surface (W5) fixture generation + THE PROVENANCE RECORD. Regenerate:
//
//   node tests/fixtures/generate-feed.mjs        (from web/)
//
// Sibling waves each own their generator (this one writes ONLY feed-*
// files). Every fixture is GENERATED from committed contract artifacts —
// never hand-shaped wire data (plan, fixture rule). Sources:
//
//  1. VERBATIM extract of `api/openapi.yaml`'s GET /v1/events 200 example:
//       feed-cross-page-1.json — one timed aave liquidation (with the full
//       LiquidationDetail) + one UNTIMED dm borrow + a non-null next_cursor.
//
//  2. COMPOSED pages — the example's envelope around rows DERIVED from the
//     example's own rows by documented mechanical deltas (blocks/times
//     shifted, types re-labeled within the contract's closed display enum,
//     tx hashes and addresses reused from the committed examples — no
//     invented identifiers):
//       feed-cross-page-2.json   — the untimed TAIL continues: every row
//         untimed, ordered by the chain-aware tiebreak (chain_id DESC ⇒ the
//         OP row before the ETH row), next_cursor null. AMENDMENT-1 law: a
//         cross-engine walk that has entered the tail never goes back.
//       feed-cross-timed.json    — three TIMED rows whose header times are
//         strictly DESC while their block heights are NOT monotone
//         (25,635,601 → 154,796,490 → 25,635,500): the proof fixture that
//         cross-engine order is TIME, never height.
//       feed-engine-aave-page-1.json — engine-scoped (one chain): height
//         DESC, one timed + one untimed row (no tail concept in this mode —
//         a null time is a per-row block-number fallback).
//       feed-engine-aave-since.json  — the same walk under since_block
//         25,635,600 (the /v1/params example's aave effective_block): only
//         the row at/above the bound remains, and the filter echo says so.
//       feed-liquidations.json   — types=["liquidation"] echo; the example's
//         aave liquidation VERBATIM + a composed DM liquidation whose
//         realized_bonus_bps is null (the never-estimated rendering case)
//         with a two-leg seized[] (the DM seizure fan-out folded in).
//       feed-empty.json          — a well-formed filter that matches nothing:
//         events [], next_cursor null. An empty page is a real answer.
//
//  3. feed-units.json — the unit-tag cases (AMENDMENT 1 item B; on the wire
//     since contract 1.2.0). The closed set (none / dm_normalized_debt /
//     aave_scaled / opaque) is the contract's `EventAmountUnit` —
//     `internal/store/p5_events.go`'s vocabulary verbatim — and each row's
//     tag follows that file's classification maps for its raw_type
//     (aave_borrow → aave_scaled; borrow → dm_normalized_debt;
//     collateral flag → none). The `opaque` row deliberately carries
//     amount_decimals to pin that the UI refuses to APPLY them under an
//     opaque unit.
//
//  4. Error envelopes (`ErrorBody` shape, additionalProperties false):
//       feed-error-bad-cursor.json — code bad_request; the message is the
//         store's OWN cursor-mode refusal text from
//         internal/store/p5_events.go (decodeEventsCursor), verbatim.
//       feed-error-internal.json   — code internal; a sanitized-style
//         message per the contract's InternalError description.
//     (429 reuses the committed error-rate-limited.json — a byte-identical
//     client fixture owned by the lab wave's generator.)
//
//  5. feed-posture-snapshot.json — a StreamPayload for the SSE snapshot
//     event: `batch` is the /v1/positions example's batch envelope VERBATIM;
//     the scalar fields satisfy the schema's required list.
//
// YAML parsing uses the client package's own pinned `yaml` devDependency
// (installed by `scripts/ensure-client.mjs`) — no new web dependency.

import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..", "..");
const contractPath = path.join(repoRoot, "api", "openapi.yaml");

const emit = (name, value) => {
  writeFileSync(path.join(here, name), `${JSON.stringify(value, null, 2)}\n`, "utf8");
  console.log(`wrote   ${name}`);
};
const clone = (value) => JSON.parse(JSON.stringify(value));

let YAML;
try {
  const requireFromClient = createRequire(
    path.join(repoRoot, "packages", "client-ts", "package.json"),
  );
  YAML = requireFromClient("yaml");
} catch {
  console.error(
    "generate-feed.mjs: cannot resolve `yaml` from packages/client-ts/node_modules.\n" +
      "Run `node scripts/ensure-client.mjs` (or any web build) first.",
  );
  process.exit(1);
}

const contract = YAML.parse(readFileSync(contractPath, "utf8"));

// --- the C2 weld: `amount_unit` is ON the contract (landed with 1.2.0).
// The inverted watch: this generator now FAILS if the field ever leaves the
// contract, because every emitted row carries it.
const chainEventProps = contract?.components?.schemas?.ChainEvent?.properties ?? {};
if (!("amount_unit" in chainEventProps)) {
  console.error(
    "generate-feed.mjs: api/openapi.yaml's ChainEvent no longer carries `amount_unit` —\n" +
      "the 1.2.0 unit vocabulary these fixtures encode has left the contract. Revisit.",
  );
  process.exit(1);
}

// --- 1: the verbatim /v1/events example ------------------------------------

const eventsExample =
  contract?.paths?.["/v1/events"]?.get?.responses?.["200"]?.content?.["application/json"]
    ?.example;
if (eventsExample === undefined) {
  console.error("generate-feed.mjs: api/openapi.yaml carries no 200 example for GET /v1/events");
  process.exit(1);
}
emit("feed-cross-page-1.json", eventsExample);

const [AAVE_LIQ, DM_BORROW] = eventsExample.events;
if (AAVE_LIQ?.type !== "liquidation" || DM_BORROW?.type !== "borrow") {
  console.error("generate-feed.mjs: the /v1/events example changed shape — revisit this generator");
  process.exit(1);
}

// The /v1/params example supplies the OTHER committed tx hashes + the aave
// effective_block used as the since_block bound.
const paramsExample =
  contract?.paths?.["/v1/params"]?.get?.responses?.["200"]?.content?.["application/json"]
    ?.example;
if (paramsExample === undefined) {
  console.error("generate-feed.mjs: api/openapi.yaml carries no 200 example for GET /v1/params");
  process.exit(1);
}
const [PARAMS_AAVE, PARAMS_DM] = paramsExample.params;

// --- a light weld: every emitted row satisfies the contract's OWN row shape
//     (required list + closed property set — `amount_unit` is required since
//     1.2.0, so the weld enforces it on every composed row). Composition can
//     therefore not drift. --------------------------------------------------

const rowRequired = contract?.components?.schemas?.ChainEvent?.required ?? [];
const rowKnownKeys = new Set(Object.keys(chainEventProps));
function checkRows(name, body) {
  for (const row of body.events) {
    for (const key of rowRequired) {
      if (!(key in row)) {
        console.error(`generate-feed.mjs: ${name}: a row is missing required "${key}"`);
        process.exit(1);
      }
    }
    for (const key of Object.keys(row)) {
      if (!rowKnownKeys.has(key)) {
        console.error(`generate-feed.mjs: ${name}: a row carries unknown key "${key}"`);
        process.exit(1);
      }
    }
  }
  return body;
}
checkRows("feed-cross-page-1.json", eventsExample);

const envelope = (overrides) => ({
  served_at: eventsExample.served_at,
  filter: { engine: null, account: null, types: [], since_block: null },
  limit: eventsExample.limit,
  events: [],
  next_cursor: null,
  notes: [],
  ...overrides,
});

// --- 2a: the untimed tail continues (cross page 2) -------------------------
// Deltas from DM_BORROW: repay at a LOWER height, tx from the params DM row.
// Deltas from AAVE_LIQ: a record-only aave supply, untimed, tx from the
// params aave row, asset/symbol from the liquidation's seized weETH leg.
const WEETH = AAVE_LIQ.liquidation.seized[0];

const dmRepayUntimed = {
  ...clone(DM_BORROW),
  block_number: DM_BORROW.block_number - 90, // 154,796,400
  tx_hash: PARAMS_DM.tx_hash,
  log_index: 3,
  type: "repay",
  raw_type: "repay",
  amount: "-600000000",
};

const aaveSupplyUntimed = {
  ...clone(AAVE_LIQ),
  block_number: AAVE_LIQ.block_number - 21, // 25,635,580
  block_time: null,
  tx_hash: PARAMS_AAVE.tx_hash,
  log_index: 5,
  type: "supply",
  raw_type: "aave_supply",
  asset: WEETH.asset,
  symbol: WEETH.symbol,
  amount: null, // record-only (the store maps aave_supply's delta unit to `none`)
  amount_unit: "none", // the classification map's tag for aave_supply, verbatim
  amount_decimals: null,
  liquidation: null,
};

emit(
  "feed-cross-page-2.json",
  checkRows(
    "feed-cross-page-2.json",
    envelope({
      // Tail tiebreak (chain_id, height, …) DESC ⇒ chain 10 before chain 1.
      events: [dmRepayUntimed, aaveSupplyUntimed],
    }),
  ),
);

// --- 2b: timed cross-engine order is TIME, never height --------------------
const aaveBorrowTimed = {
  ...clone(aaveSupplyUntimed),
  block_number: AAVE_LIQ.block_number, // 25,635,601
  block_time: AAVE_LIQ.block_time, // 09:57:11Z — newest
  log_index: 2,
  type: "borrow",
  raw_type: "aave_borrow",
  amount: "1500000000000000000",
  amount_unit: "aave_scaled", // aaveEventDisplay["aave_borrow"].DeltaUnit, verbatim
  amount_decimals: null, // an accounting-unit delta asserts no display scale
};
const dmBorrowTimed = {
  ...clone(DM_BORROW),
  block_time: "2026-07-29T09:56:40Z", // between the two aave rows
};
const aaveRepayTimed = {
  ...clone(aaveBorrowTimed),
  block_number: AAVE_LIQ.block_number - 101, // 25,635,500
  block_time: "2026-07-29T09:55:02Z", // oldest
  log_index: 9,
  type: "repay",
  raw_type: "aave_repay",
  amount: "-500000000000000000",
};

emit(
  "feed-cross-timed.json",
  checkRows(
    "feed-cross-timed.json",
    envelope({
      limit: 3,
      // Heights 25,635,601 → 154,796,490 → 25,635,500 are NOT monotone;
      // header times ARE strictly DESC. Time is the order.
      events: [aaveBorrowTimed, dmBorrowTimed, aaveRepayTimed],
    }),
  ),
);

// --- 2c: engine-scoped pages (height order; null time is not a tail) -------
emit(
  "feed-engine-aave-page-1.json",
  checkRows(
    "feed-engine-aave-page-1.json",
    envelope({
      filter: { engine: "aave_v3_etherfi", account: null, types: [], since_block: null },
      events: [clone(AAVE_LIQ), aaveSupplyUntimed],
    }),
  ),
);

emit(
  "feed-engine-aave-since.json",
  checkRows(
    "feed-engine-aave-since.json",
    envelope({
      filter: {
        engine: "aave_v3_etherfi",
        account: null,
        types: [],
        since_block: PARAMS_AAVE.effective_block, // 25,635,600
      },
      events: [clone(AAVE_LIQ)], // 25,635,601 ≥ the bound; 25,635,580 is not
    }),
  ),
);

// --- 2d: the liquidations ledger -------------------------------------------
const dmLiquidation = {
  ...clone(DM_BORROW),
  block_number: DM_BORROW.block_number - 490, // 154,796,000
  block_time: "2026-07-29T09:50:00Z",
  tx_hash: PARAMS_DM.tx_hash,
  log_index: 11,
  type: "liquidation",
  raw_type: "liquidation",
  amount: "-1000000000",
  liquidation: {
    liquidator: AAVE_LIQ.liquidation.liquidator,
    debt_asset: null, // DM debt is USD-valued, not one asset — null, not guessed
    debt_repaid: "1000000000",
    debt_decimals: 6,
    // The DM event's own payload facts (1.2.0): pre-liquidation USD-6 figure
    // and the 1e18-scaled interest index at the event.
    before_debt_usd: "2000000000",
    interest_index: "1040000000000000000",
    deficit_paired: null, // the DM has no deficit-pairing concept — withheld, never "false"
    seized: [
      // Per-element realized bonus, verbatim in the CONTRACT's own 100e18
      // denomination — never converted to bps.
      { asset: WEETH.asset, symbol: WEETH.symbol, amount: "250000000000000000", decimals: 18, bonus: "5000000000000000000" },
      { asset: DM_BORROW.asset, symbol: DM_BORROW.symbol, amount: "120000000", decimals: 6, bonus: "5000000000000000000" },
    ],
    realized_bonus_bps: null, // 100e18-denominated on seized[].bonus — never a silent unit conversion
    configured_bonus_bps: "500",
    note: "extracted from the event's own structured payload; a bonus the payload cannot establish in bps is null, never estimated — each seizure's own realized bonus serves verbatim in the contract's 100e18 denomination.",
  },
};

emit(
  "feed-liquidations.json",
  checkRows(
    "feed-liquidations.json",
    envelope({
      filter: { engine: null, account: null, types: ["liquidation"], since_block: null },
      events: [clone(AAVE_LIQ), dmLiquidation],
    }),
  ),
);

// --- 2e: a well-formed filter that matches nothing -------------------------
emit(
  "feed-empty.json",
  envelope({
    filter: { engine: null, account: null, types: ["deficit_created"], since_block: null },
    limit: 50,
  }),
);

// --- 3: the unit-tag cases (the contract's EventAmountUnit vocabulary,
//     internal/store/p5_events.go's classification verbatim) ----------------
const unitAaveScaled = {
  ...clone(aaveBorrowTimed),
  amount_unit: "aave_scaled", // aaveEventDisplay["aave_borrow"].DeltaUnit
};
const unitDmNormalized = {
  ...clone(dmBorrowTimed),
  block_time: "2026-07-29T09:56:20Z",
  amount_unit: "dm_normalized_debt", // dmEventDisplay["borrow"].DeltaUnit
};
const unitNone = {
  ...clone(AAVE_LIQ),
  block_number: AAVE_LIQ.block_number - 151, // 25,635,450
  block_time: "2026-07-29T09:54:00Z",
  log_index: 1,
  type: "collateral_enabled",
  raw_type: "aave_collateral_enabled", // internal/store/collateralflags.go's constant, verbatim
  asset: WEETH.asset,
  symbol: WEETH.symbol,
  amount: null, // `none` promises record-only
  amount_decimals: null,
  liquidation: null,
  amount_unit: "none",
};
const unitOpaque = {
  ...clone(aaveBorrowTimed),
  block_number: AAVE_LIQ.block_number - 201, // 25,635,400
  block_time: "2026-07-29T09:53:00Z",
  log_index: 4,
  type: "withdraw",
  raw_type: "aave_withdraw",
  amount: "123456789",
  amount_decimals: 6, // present ON PURPOSE: the UI must refuse to apply them
  amount_unit: "opaque",
};

emit(
  "feed-units.json",
  checkRows(
    "feed-units.json",
    envelope({
      limit: 4,
      events: [unitAaveScaled, unitDmNormalized, unitNone, unitOpaque],
    }),
  ),
);

// --- 4: error envelopes ------------------------------------------------------
emit("feed-error-bad-cursor.json", {
  error: {
    code: "bad_request",
    message:
      // internal/store/p5_events.go decodeEventsCursor, verbatim (scoped→cross).
      "events page: cursor was minted for a engine-scoped page but this request is cross-engine-mode — engine-scoped and cross-engine pages rank by different keys and their cursors are not interchangeable",
  },
});

emit("feed-error-internal.json", {
  error: {
    code: "internal",
    message: "the service failed to build the response",
  },
});

// --- 5: the SSE snapshot payload --------------------------------------------
const positionsExample =
  contract?.paths?.["/v1/positions"]?.get?.responses?.["200"]?.content?.["application/json"]
    ?.example;
if (positionsExample?.batch === undefined) {
  console.error("generate-feed.mjs: api/openapi.yaml carries no batch in the /v1/positions example");
  process.exit(1);
}
emit("feed-posture-snapshot.json", {
  served_at: positionsExample.served_at,
  batch: positionsExample.batch, // verbatim
  listener_connected: true,
  poll_interval_seconds: 15,
  note: "snapshot-on-connect: the base frame every connection receives before any tick.",
});
