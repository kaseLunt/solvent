// The 1.2.0 routes (contract-corrections wave): positions / events / params /
// addressHistory / prices / runBookScenario / evidence / observatorySeries /
// batch.
//
// Same discipline as the rest of the suite: the client's REAL code path runs
// against committed-shape bodies (typed with `satisfies` against the generated
// contract types — type-level conformance for the new schemas rides along);
// only the socket is mocked. The laws under test:
//
//   - positions() serves REFINED rows: `liquidatable` is absent (type AND
//     runtime) and the sealed `liquidation_verdict` union replaces it; the
//     raw wire body stays behind positionsRaw().
//   - a 409 is a typed BatchSupersededError NAMING BOTH batch ids — restart
//     material, not a generic HTTP failure.
//   - the cross-engine since_block impossibility is refused LOCALLY (never
//     sent): a property of chains, not a server error.
//   - addressHistory() is a discriminated LOOKUP under the same sealed
//     outcome union and invariant enforcement as address().
//   - runBookScenario POSTs, and refuses a malformed id locally.

import { describe, expect, it } from "vitest";

import {
  BatchSupersededError,
  MalformedResponseError,
  SolventClient,
  SolventUsageError,
  type BatchResponse,
  type EventsResponse,
  type PositionsResponse,
} from "../src/index.js";
import { mockFetch } from "./helpers/mock-fetch.js";

const BASE = "http://localhost:8080";

function clientWith(routes: Parameters<typeof mockFetch>[0]) {
  const mock = mockFetch(routes);
  return { client: new SolventClient({ baseUrl: BASE, fetch: mock.fetch }), mock };
}

// ---------------------------------------------------------------------------
// Minimal contract-valid bodies, `satisfies`-checked against the generated
// types so a contract drift breaks THIS FILE at typecheck.
// ---------------------------------------------------------------------------

const batchEnvelope = {
  id: 7,
  computed_at: "2026-07-29T10:00:00Z",
  age_seconds: 5,
  producer: "riskd",
  status: "complete" as const,
  position_count: 1,
  refused_count: 0,
  refused_engines: [],
  flagged_count: 0,
  // Non-empty since 1.2.2: the contract requires the vector (minItems 1) —
  // the sweep-disclosure law licenses liquidatable counts through it.
  watermarks: [
    {
      engine: "debt_manager",
      chain_id: 10,
      last_block: 154796552,
      acked_epoch: 0,
      max_epoch_at_compute: 0,
      sweep: null,
    },
  ],
  supersession: { superseded: false, legs: [], note: "n" },
};

const positionsBody = {
  served_at: "2026-07-29T10:00:05Z",
  batch: batchEnvelope,
  engine: "debt_manager",
  sort: "liq_distance",
  limit: 50,
  refused: false,
  refusal: null,
  total_positions: 1,
  positions: [
    {
      engine: "debt_manager",
      account: "0xccCc000000000000000000000000000000000003",
      status: "computed",
      value_decimals: 6,
      refusal: null,
      flags: [],
      health_factor: null,
      liquidatable: true,
      total_collateral: "4000000000",
      total_debt: "4620000000",
      liq_distance: {
        kind: "breached",
        scale_factor_num: null,
        scale_factor_den: null,
        factor_asset: null,
        reason: null,
      },
      balances_block: 154796552,
      params_block: 154790000,
      sweep_block: 154796000,
    },
  ],
  next_cursor: null,
  notes: [],
} satisfies PositionsResponse;

const eventsBody = {
  served_at: "2026-07-29T10:00:05Z",
  filter: { engine: "debt_manager", account: null, types: [], since_block: 154000000 },
  limit: 50,
  events: [
    {
      chain_id: 10,
      engine: "debt_manager",
      block_number: 154796490,
      block_time: null,
      tx_hash: "0x51f0b3e2a4c1d99e21b7a30e12cf5a2b9a4a7c1de00b53219a6f2f41c86a7702",
      log_index: 7,
      seq: 0,
      type: "borrow",
      raw_type: "borrow",
      account: "0xccCc000000000000000000000000000000000003",
      asset: "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85",
      amount: "1199403000",
      amount_unit: "dm_normalized_debt",
      amount_decimals: null,
      liquidation: null,
    },
  ],
  next_cursor: null,
  notes: [],
} satisfies EventsResponse;

const batchBody = {
  served_at: "2026-07-29T10:00:05Z",
  batch_id: 7,
  servability: "superseded_retained",
  servability_note: "retained and complete; a newer servable batch exists.",
  computed_at: "2026-07-29T10:00:00Z",
  producer: "riskd",
  status: "complete",
  position_count: 1,
  refused_count: 0,
  flagged_count: 0,
  materialization_key: "m-key",
  substrate_digest: "",
  aggregates: [
    {
      engine: "debt_manager",
      value_decimals: 6,
      positions: 1,
      computed_positions: 1,
      refused_positions: 0,
      flagged_positions: 0,
      liquidatable_positions: 1,
      // 1.2.2: the sweep-cut behind the liquidatable count, named on the row.
      sweep: {
        rows: 3,
        failed: 1,
        success_sum: "309593004",
        max_updated_at: "2026-07-29T09:40:00Z",
        age_seconds: 1200,
        generation: 4,
        generation_open: false,
      },
      total_collateral: "4000000000",
      total_debt: "4620000000",
      refusal: null,
    },
  ],
  notes: [],
} satisfies BatchResponse;

const supersededBody = JSON.stringify({
  error: {
    code: "batch_superseded",
    message: "the cursor was minted against batch 7, which is no longer the newest servable batch; restart pagination from page one",
    cursor_batch_id: 7,
    current_batch_id: 8,
  },
});

// ---------------------------------------------------------------------------
// positions(): the sealed verdict law, and the 409 restart.
// ---------------------------------------------------------------------------

describe("positions() — refined rows, batch-stable pagination", () => {
  it("serves the sealed liquidation_verdict and REMOVES the raw nullable boolean at runtime", async () => {
    const { client } = clientWith({
      "/v1/positions": { body: JSON.stringify(positionsBody) },
    });
    const page = await client.positions({ engine: "debt_manager" });
    const row = page.positions[0]!;
    expect(row.liquidation_verdict).toBe("liquidatable");
    // The raw field is ABSENT, not merely retyped: neither falsiness nor
    // Object.hasOwn can resurrect the nullable-boolean trap.
    expect(Object.hasOwn(row, "liquidatable")).toBe(false);
    // Everything else is the wire's own statement, untouched.
    expect(row.total_debt).toBe("4620000000");
    expect(row.liq_distance.kind).toBe("breached");
  });

  it("positionsRaw() preserves the wire body verbatim — the surface whose name declares the hazard", async () => {
    const { client } = clientWith({
      "/v1/positions": { body: JSON.stringify(positionsBody) },
    });
    const page = await client.positionsRaw({ engine: "debt_manager" });
    expect(page.positions[0]!.liquidatable).toBe(true);
  });

  it("answers a 409 with BatchSupersededError NAMING BOTH batch ids", async () => {
    const { client } = clientWith({
      "/v1/positions": { status: 409, body: supersededBody },
    });
    try {
      await client.positions({ engine: "debt_manager", cursor: "stale-cursor" });
      throw new Error("unreachable");
    } catch (error) {
      expect(error).toBeInstanceOf(BatchSupersededError);
      const e = error as BatchSupersededError;
      expect(e.cursorBatchId).toBe(7);
      expect(e.currentBatchId).toBe(8);
      expect(e.code).toBe("batch_superseded");
    }
  });

  it("a 409 body that is not the batch_superseded envelope is a MalformedResponseError", async () => {
    const { client } = clientWith({
      "/v1/positions": { status: 409, body: JSON.stringify({ error: { code: "conflict", message: "??" } }) },
    });
    await expect(client.positions({ engine: "debt_manager" })).rejects.toBeInstanceOf(MalformedResponseError);
  });

  it("refuses an unknown engine LOCALLY — never sent", async () => {
    const { client, mock } = clientWith({});
    await expect(
      client.positions({ engine: "compound" as never }),
    ).rejects.toBeInstanceOf(SolventUsageError);
    expect(mock.calls).toHaveLength(0);
  });

  it("serializes dir and min_value (1.3.0) onto the query, and the limit bound is 1000", async () => {
    const { client, mock } = clientWith({
      "/v1/positions": { body: JSON.stringify(positionsBody) },
    });
    await client.positions({
      engine: "debt_manager",
      sort: "debt",
      dir: "asc",
      minValue: "1000000",
      limit: 1000,
    });
    const url = new URL(mock.calls[0]!);
    expect(url.searchParams.get("dir")).toBe("asc");
    expect(url.searchParams.get("min_value")).toBe("1000000");
    expect(url.searchParams.get("limit")).toBe("1000");
  });

  it("refuses limit 1001 and a malformed minValue LOCALLY — never sent", async () => {
    const { client, mock } = clientWith({});
    await expect(
      client.positions({ engine: "debt_manager", limit: 1001 }),
    ).rejects.toBeInstanceOf(SolventUsageError);
    // The contract's ^[0-9]+$ pattern: no fractions, no signs, no exponents —
    // min_value is a decimal integer in the engine's own value unit.
    for (const bad of ["1.5", "-3", "+3", "1e9", ""]) {
      await expect(
        client.positions({ engine: "debt_manager", minValue: bad }),
      ).rejects.toBeInstanceOf(SolventUsageError);
    }
    expect(mock.calls).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// events(): the two-mode law's client half.
// ---------------------------------------------------------------------------

describe("events() — the cross-engine since_block impossibility", () => {
  it("refuses sinceBlock without engine LOCALLY: a property of chains, never a request", async () => {
    const { client, mock } = clientWith({});
    try {
      await client.events({ sinceBlock: 154000000 });
      throw new Error("unreachable");
    } catch (error) {
      expect(error).toBeInstanceOf(SolventUsageError);
      expect((error as SolventUsageError).message).toContain("incomparable");
    }
    expect(mock.calls).toHaveLength(0);
  });

  it("sends an engine-scoped since_block, and serves the wire body verbatim (amount_unit included)", async () => {
    const { client, mock } = clientWith({
      "/v1/events": { body: JSON.stringify(eventsBody) },
    });
    const page = await client.events({ engine: "debt_manager", sinceBlock: 154000000, limit: 50 });
    expect(mock.calls[0]).toContain("engine=debt_manager");
    expect(mock.calls[0]).toContain("since_block=154000000");
    expect(page.events[0]!.amount_unit).toBe("dm_normalized_debt");
    expect(page.events[0]!.amount_decimals).toBeNull();
  });

  it("joins the display-type filter with commas, per the contract's form/explode:false", async () => {
    const { client, mock } = clientWith({
      "/v1/events": { body: JSON.stringify(eventsBody) },
    });
    await client.events({ types: ["borrow", "repay"] });
    expect(decodeURIComponent(mock.calls[0]!)).toContain("types=borrow,repay");
  });
});

// ---------------------------------------------------------------------------
// runBookScenario(): POST, and the local id refusal.
// ---------------------------------------------------------------------------

describe("runBookScenario()", () => {
  it("POSTs to the run-book route", async () => {
    let method: string | undefined;
    const client = new SolventClient({
      baseUrl: BASE,
      fetch: (_url, init) => {
        method = init?.method;
        return Promise.resolve({
          ok: false,
          status: 404,
          headers: { get: () => null },
          text: () =>
            Promise.resolve(JSON.stringify({ error: { code: "not_found", message: "unknown scenario" } })),
        });
      },
    });
    await expect(client.runBookScenario("weeth_market_depeg_oracles_held")).rejects.toMatchObject({
      status: 404,
    });
    expect(method).toBe("POST");
  });

  it("refuses an id outside the contract's pattern LOCALLY — never sent", async () => {
    const { client, mock } = clientWith({});
    await expect(client.runBookScenario("NOT A SCENARIO ID")).rejects.toBeInstanceOf(SolventUsageError);
    await expect(client.runBookScenario("../../etc/passwd")).rejects.toBeInstanceOf(SolventUsageError);
    expect(mock.calls).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// addressHistory(): the same lookup law as address().
// ---------------------------------------------------------------------------

describe("addressHistory() — a discriminated lookup", () => {
  const historyBody = {
    served_at: "2026-07-29T10:00:05Z",
    batch: batchEnvelope,
    address: "0xccCc000000000000000000000000000000000003",
    limit: 30,
    engines: [],
    found: null,
    lookup_complete: false,
    withheld_engines: [
      { engine: "aave_v3_etherfi", code: "FLAG_CUSTODY_UNPROVEN", detail: "d", note: "n" },
    ],
    lookup_complete_note: "n",
    notes: [],
  };

  it("seals the three-valued found into the outcome union — null is unknowable, never no-position", async () => {
    const { client } = clientWith({
      [`/v1/address/${historyBody.address}/history`]: { body: JSON.stringify(historyBody) },
    });
    const result = await client.addressHistory(historyBody.address);
    expect(result.outcome).toBe("unknowable");
    expect(Object.hasOwn(result.response, "found")).toBe(false);
  });

  it("enforces the contract invariants (found=null with a complete lookup is refused)", async () => {
    const contradictory = { ...historyBody, lookup_complete: true, withheld_engines: [] };
    const { client } = clientWith({
      [`/v1/address/${historyBody.address}/history`]: { body: JSON.stringify(contradictory) },
    });
    await expect(client.addressHistory(historyBody.address)).rejects.toMatchObject({
      name: "ContractInvariantError",
    });
  });

  it("refuses a malformed address LOCALLY — never a request for a different account", async () => {
    const { client, mock } = clientWith({});
    await expect(client.addressHistory("0x1234")).rejects.toBeInstanceOf(SolventUsageError);
    expect(mock.calls).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// batch() / observatorySeries() / prices() / evidence() — parameter law.
// ---------------------------------------------------------------------------

describe("the remaining 1.2.0 routes", () => {
  it("batch() fetches the permalink and refuses a non-positive id locally", async () => {
    const { client, mock } = clientWith({
      "/v1/batches/7": { body: JSON.stringify(batchBody) },
    });
    const body = await client.batch(7);
    expect(body.servability).toBe("superseded_retained");
    expect(body.materialization_key).toBe("m-key");
    await expect(client.batch(0)).rejects.toBeInstanceOf(SolventUsageError);
    await expect(client.batch(1.5)).rejects.toBeInstanceOf(SolventUsageError);
    expect(mock.calls).toHaveLength(1);
  });

  it("observatorySeries() refuses a sub-bucket step locally (nothing is ever averaged)", async () => {
    const { client, mock } = clientWith({});
    await expect(
      client.observatorySeries({ engine: "debt_manager", step: 60 }),
    ).rejects.toBeInstanceOf(SolventUsageError);
    expect(mock.calls).toHaveLength(0);
  });

  it("prices() validates the asset address locally and encodes the block bounds", async () => {
    const asset = "0xCd5fE23C85820F7B72D0926FC9b05b43E359b7ee";
    const pricesBody = {
      served_at: "2026-07-29T10:00:05Z",
      asset,
      source: null,
      from_block: 25635500,
      to_block: null,
      step: null,
      chains: [1, 10],
      series: [],
      notes: [],
    };
    const { client, mock } = clientWith({
      [`/v1/prices/${asset}`]: { body: JSON.stringify(pricesBody) },
    });
    const body = await client.prices(asset, { fromBlock: 25635500 });
    expect(mock.calls[0]).toContain("from_block=25635500");
    // The chain identity travels with the answer: an empty series still says
    // exactly where custody was looked for.
    expect(body.chains).toEqual([1, 10]);
    await expect(client.prices("not-an-address")).rejects.toBeInstanceOf(SolventUsageError);
  });

  it("evidence() serves the manifest with the two-subject split on the wire", async () => {
    const evidenceBody = {
      proof_subject: { status: "unavailable", detail: "no committed receipt", pin: null },
      live_subject: { status: "no_batch", reason: "no complete risk batch is servable" },
    };
    const { client } = clientWith({
      "/v1/evidence": { body: JSON.stringify(evidenceBody) },
    });
    const body = await client.evidence();
    expect(body.proof_subject.status).toBe("unavailable");
    expect(body.live_subject.status).toBe("no_batch");
  });
});
