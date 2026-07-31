// Observatory-surface (W4) fixture generation + THE PROVENANCE RECORD.
// Regenerate:
//
//   node tests/fixtures/generate-observatory.mjs        (from web/)
//
// Sibling waves each own their generator (this one writes ONLY observatory-*
// files). Every fixture is GENERATED from committed contract artifacts —
// never hand-shaped wire data (plan, fixture rule). The sanctioned sources:
//
//  1. VERBATIM extract of `api/openapi.yaml`'s own inline example:
//       GET /v1/observatory/series 200 example -> observatory-series-dm.json
//     (engine debt_manager, usd_decimals 6; two hourly buckets — 08:00
//     captured with exact totals + one rate index, 09:00 WITHHELD with
//     refusal_code FLAG_CUSTODY_UNPROVEN and NULL totals. This is the
//     contract's own statement of the withheld-bucket law.)
//
//  2. ONE DERIVED series: observatory-series-aave.json — the same example
//     MECHANICALLY re-registered for the other engine, with every delta
//     documented here:
//       - engine echoed to "aave_v3_etherfi"; usd_decimals 8 (the aave
//         engine's own usd scale, matching the contract-validated book
//         fixture where aave totals carry value_decimals 8);
//       - four CAPTURED buckets 06:00/07:00/08:00/10:00 on the example's own
//         day — 09:00 is deliberately ABSENT: the rollup wrote no row for
//         that hour because no complete batch existed in it (AMENDMENT 1
//         item D). The absence is the fixture's point — the axis must render
//         a named gap there, never an interpolated line;
//       - totals derived from the example's captured totals by exact integer
//         arithmetic only: ×100 rescales 6dp→8dp (same USD magnitude), then
//         per-bucket multipliers [2, 3, 3, 2] (documented drama-free shape;
//         values differ from the DM fixture so engine-switch tests can tell
//         the engines apart by content);
//       - last_block: mainnet-register heights 25_635_000 + i·300, in the
//         neighbourhood of the contract's own mainnet example block 25635601
//         (GET /v1/events example) — the aave engine lives on chain 1, so
//         OP-register heights would be a lie;
//       - accounts [5,5,6,6], refused_positions [0,0,1,0],
//         liquidatable_positions [0,1,1,0] — small ints in the register of
//         the spec's scale facts (aave: low-count/large-ticket);
//       - the rate row echoes the example's row VERBATIM except: engine
//         echoed, as_of_block = last_block - 10 (the contract's own law that
//         an index's as-of can trail the bucket);
//       - envelope: from = the series' own first bucket, to/step_seconds
//         null, served_at + notes echoed verbatim (the note is the
//         contract's general withheld-bucket law, kept as served).
//
//  3. observatory-degraded.json — the contract's ErrorBody envelope for the
//     rollup's honest degraded mode. Shape: components/schemas/ErrorBody;
//     `code: "unavailable"` VALIDATED against the schema's own enum at
//     generation time; message = the store's typed refusal text VERBATIM
//     (internal/store/p5_observatory_series.go, ErrObservatoryUnavailable) —
//     the statement a deployment whose database predates migration 00016
//     serves. B3 may sanitize the message; the UI keys on `code` only.
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

let YAML;
try {
  const requireFromClient = createRequire(
    path.join(repoRoot, "packages", "client-ts", "package.json"),
  );
  YAML = requireFromClient("yaml");
} catch {
  console.error(
    "generate-observatory.mjs: cannot resolve `yaml` from packages/client-ts/node_modules.\n" +
      "Run `node scripts/ensure-client.mjs` (or any web build) first.",
  );
  process.exit(1);
}

const contract = YAML.parse(readFileSync(contractPath, "utf8"));

// --- 1: the verbatim contract example (debt_manager) -----------------------

const example =
  contract?.paths?.["/v1/observatory/series"]?.get?.responses?.["200"]?.content?.[
    "application/json"
  ]?.example;
if (example === undefined) {
  console.error(
    "generate-observatory.mjs: api/openapi.yaml carries no 200 example for GET /v1/observatory/series",
  );
  process.exit(1);
}
if (example.engine !== "debt_manager") {
  console.error("generate-observatory.mjs: the contract example is no longer debt_manager");
  process.exit(1);
}
const withheld = example.points.find((point) => point.refused === true);
if (withheld === undefined || withheld.refusal_code === null) {
  console.error(
    "generate-observatory.mjs: the contract example lost its withheld bucket — the refused-state fixtures depend on it",
  );
  process.exit(1);
}
emit("observatory-series-dm.json", example);

// --- 2: the derived aave series (documented deltas only) -------------------

const captured = example.points.find((point) => point.refused === false);
if (captured === undefined) {
  console.error("generate-observatory.mjs: the contract example lost its captured bucket");
  process.exit(1);
}

const day = captured.bucket_start.slice(0, 10); // the example's own day
const to8 = (v) => (BigInt(v) * 100n).toString(); // 6dp -> 8dp, same USD magnitude
const mul = (v, k) => (BigInt(v) * BigInt(k)).toString();

const HOURS = ["06", "07", "08", "10"]; // 09:00 deliberately ABSENT
const MULTIPLIERS = [2, 3, 3, 2];
const ACCOUNTS = [5, 5, 6, 6];
const REFUSED_ROWS = [0, 0, 1, 0];
const LIQUIDATABLE = [0, 1, 1, 0];

const exampleRate = captured.rates[0];
if (exampleRate === undefined) {
  console.error("generate-observatory.mjs: the contract example lost its rate index row");
  process.exit(1);
}

const aavePoints = HOURS.map((hour, i) => {
  const lastBlock = 25_635_000 + i * 300;
  return {
    bucket_start: `${day}T${hour}:00:00Z`,
    last_block: lastBlock,
    refused: false,
    refusal_code: null,
    accounts: ACCOUNTS[i],
    refused_positions: REFUSED_ROWS[i],
    liquidatable_positions: LIQUIDATABLE[i],
    debt_usd: mul(to8(captured.debt_usd), MULTIPLIERS[i]),
    collateral_usd: mul(to8(captured.collateral_usd), MULTIPLIERS[i]),
    rates: [
      {
        ...exampleRate,
        engine: "aave_v3_etherfi",
        as_of_block: lastBlock - 10,
      },
    ],
  };
});

emit("observatory-series-aave.json", {
  served_at: example.served_at,
  engine: "aave_v3_etherfi",
  usd_decimals: 8,
  from: aavePoints[0].bucket_start,
  to: null,
  step_seconds: null,
  points: aavePoints,
  notes: example.notes,
});

// --- 3: the degraded envelope (ErrorBody, code validated) ------------------

const errorCodes =
  contract?.components?.schemas?.ErrorBody?.properties?.error?.properties?.code?.enum;
if (!Array.isArray(errorCodes) || !errorCodes.includes("unavailable")) {
  console.error(
    "generate-observatory.mjs: ErrorBody's code enum no longer carries `unavailable` — the degraded fixture would be off-contract",
  );
  process.exit(1);
}

// VERBATIM: internal/store/p5_observatory_series.go, ErrObservatoryUnavailable.
const STORE_REFUSAL =
  "observatory series: observatory_points does not exist on this database — the rollup (Task B2, migration 00016) has not been applied";

emit("observatory-degraded.json", {
  error: {
    code: "unavailable",
    message: STORE_REFUSAL,
  },
});

console.log("done.");
