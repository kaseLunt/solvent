// The run-book caller's seam: a 2xx body is SEALED, totally. Whatever the
// sealing cannot refine passes through verbatim, so the classifiers name it and
// the page says which field — a service that answered 200 is never
// "unreachable", and no classifier name is dead in the running app. Only a
// transport failure is unreachable.
import { expect, test } from "@playwright/test";
import { classifyRunBookEngine, classifyRunBookEnvelope } from "../../lib/lab-classify";
import { readsAsAnswer } from "../../lib/lab-engine";
import { runBookScenario, type LabRunBookEngine, type RunBookOutcome } from "../../lib/runbook";
import { runBookSet } from "../../lib/runbookSet";
import { RUN_BOOK_ETH } from "../fixtures/lab-book";

const answering = (body: unknown, status = 200): typeof fetch => () => Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }));
const run = (body: unknown): Promise<RunBookOutcome> => runBookScenario("http://x", "eth_minus_30", { fetchImpl: answering(body) });
/** The settled body of a 200, whatever it is: the outcome is `ok`, never a rejection and never `unreachable`. */
async function settled(body: unknown): Promise<unknown> {
  const outcome = await run(body);
  expect(outcome.kind).toBe("ok");
  if (outcome.kind !== "ok") throw new Error(outcome.kind);
  return outcome.response;
}
const ENGINE = RUN_BOOK_ETH.engines[0]!;
const HORIZON = { horizon_seconds: 2_592_000, debt_usd: "1000000", projected_usd: "1002000", additional_interest_usd: "2000", becomes_liquidatable: false };
const PROJECTION = { basis: "delta-only", annual_delta_bps: 200, horizons: [HORIZON], note: "DELTA-ONLY" };
const withEngine = (engine: unknown): unknown => ({ ...RUN_BOOK_ETH, engines: [engine] });
const envelopeOf = (body: unknown): string[] => classifyRunBookEnvelope(body as never);
const engineOf = (body: unknown): string[] => classifyRunBookEngine((body as { engines: LabRunBookEngine[] }).engines[0]!).malformedFields;

test("a served body is sealed as before: every engine refined, a null projection left null, a projection's verdicts sealed", async () => {
  const plain = (await settled(RUN_BOOK_ETH)) as typeof RUN_BOOK_ETH;
  expect(envelopeOf(plain)).toEqual([]);
  expect(plain.engines.map((e) => e.engine)).toEqual(RUN_BOOK_ETH.engines.map((e) => e.engine));
  expect(plain.engines[0]?.projection).toBeNull();
  const projected = (await settled(withEngine({ ...ENGINE, projection: PROJECTION }))) as { engines: LabRunBookEngine[] };
  const horizon = projected.engines[0]?.projection?.horizons[0];
  expect(horizon?.liquidation_verdict).toBe("not-liquidatable");
  expect(horizon !== undefined && "becomes_liquidatable" in horizon).toBe(false);
  expect(engineOf(projected)).toEqual([]);
});

test("a 2xx body that is not a JSON object settles as an answer the classifier names — null, a primitive, a list", async () => {
  for (const body of [null, 7, "ok", true, [], [RUN_BOOK_ETH]]) {
    const response = await settled(body);
    expect(response).toEqual(body);
    expect(envelopeOf(response)).toEqual(["the response body is not a JSON object"]);
    expect(readsAsAnswer(response as never)).toBe(false);
  }
});

test("an `engines` that is not a list passes through verbatim, and the envelope classifier names it", async () => {
  const { engines: _engines, ...missing } = RUN_BOOK_ETH;
  void _engines;
  for (const body of [missing, { ...RUN_BOOK_ETH, engines: null }, { ...RUN_BOOK_ETH, engines: {} }, { ...RUN_BOOK_ETH, engines: "none" }, { ...RUN_BOOK_ETH, engines: 3 }]) {
    const response = await settled(body);
    expect(response).toEqual(body);
    expect(envelopeOf(response)).toEqual(["engines"]);
  }
});

test("an engine that is not an object passes through verbatim, and is named per index", async () => {
  for (const element of [null, 7, "debt_manager", []]) {
    const response = await settled({ ...RUN_BOOK_ETH, engines: [ENGINE, element] });
    expect(envelopeOf(response)).toEqual(["engines[1]"]);
    // The engine beside it is still sealed.
    expect((response as { engines: unknown[] }).engines[1]).toEqual(element);
  }
});

test("a projection the sealing cannot refine passes through verbatim, and the engine classifier names it: absent, not an object, without a list of horizons, a horizon that is not an object, a verdict that is not boolean or null", async () => {
  const { projection: _projection, ...absent } = ENGINE;
  void _projection;
  expect(engineOf(await settled(withEngine(absent)))).toEqual(["projection"]);
  expect(engineOf(await settled(withEngine({ ...ENGINE, projection: "none" })))).toEqual(["projection"]);
  expect(engineOf(await settled(withEngine({ ...ENGINE, projection: 4 })))).toEqual(["projection"]);
  expect(engineOf(await settled(withEngine({ ...ENGINE, projection: { ...PROJECTION, horizons: undefined } })))).toEqual(["projection.horizons"]);
  expect(engineOf(await settled(withEngine({ ...ENGINE, projection: { ...PROJECTION, horizons: "gone" } })))).toEqual(["projection.horizons"]);
  expect(engineOf(await settled(withEngine({ ...ENGINE, projection: { ...PROJECTION, horizons: [HORIZON, null] } })))).toEqual(["projection.horizons[1]"]);
  expect(engineOf(await settled(withEngine({ ...ENGINE, projection: { ...PROJECTION, horizons: [7] } })))).toEqual(["projection.horizons[0]"]);
  // A verdict outside the contract's three is never guessed and never thrown on: the projection stays unsealed and the horizon is named by the wire's field.
  expect(engineOf(await settled(withEngine({ ...ENGINE, projection: { ...PROJECTION, horizons: [{ ...HORIZON, becomes_liquidatable: "yes" }] } })))).toEqual(["projection.horizons[0].becomes_liquidatable"]);
  const { becomes_liquidatable: _verdict, ...noVerdict } = HORIZON;
  void _verdict;
  expect(engineOf(await settled(withEngine({ ...ENGINE, projection: { ...PROJECTION, horizons: [noVerdict] } })))).toEqual(["projection.horizons[0].becomes_liquidatable"]);
  // Null is the wire's own "no verdict for the horizon": sealed as unknowable, never malformed.
  expect(engineOf(await settled(withEngine({ ...ENGINE, projection: { ...PROJECTION, horizons: [{ ...HORIZON, becomes_liquidatable: null }] } })))).toEqual([]);
});

test("only a transport failure is unreachable; a 2xx that is not JSON is the failed answer it always was; the refusal statuses keep their arms", async () => {
  const down = await runBookScenario("http://x", "eth_minus_30", { fetchImpl: () => Promise.reject(new Error("connect ECONNREFUSED")) });
  expect(down).toEqual({ kind: "unreachable", message: "connect ECONNREFUSED" });
  const notJson = await runBookScenario("http://x", "eth_minus_30", { fetchImpl: () => Promise.resolve(new Response("<html>", { status: 200 })) });
  expect(notJson).toEqual({ kind: "failed", status: 200, message: "2xx response body is not JSON" });
  expect((await runBookScenario("http://x", "eth_minus_30", { fetchImpl: answering({}, 404) })).kind).toBe("not-served");
});

test("an id outside the committed-scenario pattern is refused locally — the same answer the set path gives for the same condition: nothing is sent, the promise resolves, and the outcome is never unreachable", async () => {
  let sent = 0;
  const counting: typeof fetch = () => {
    sent += 1;
    return Promise.resolve(new Response("{}", { status: 200 }));
  };
  for (const id of ["ETH-30", "", "eth minus 30", "../run-book", "a".repeat(65)]) {
    const outcome = await runBookScenario("http://x", id, { fetchImpl: counting });
    expect(outcome).toEqual({ kind: "refused-locally", message: `${JSON.stringify(id)} is not a committed-scenario id (expected ^[a-z0-9_]{1,64}$), so nothing was sent` });
  }
  expect(sent).toBe(0);
  // The set path's words for the same condition, to the letter.
  const viaSet = await runBookSet("http://x", ["ETH-30"], { fetchImpl: counting });
  expect(viaSet).toEqual(await runBookScenario("http://x", "ETH-30", { fetchImpl: counting }));
  expect(sent).toBe(0);
});
