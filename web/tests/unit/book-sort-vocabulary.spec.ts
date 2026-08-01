// Per-engine sort vocabulary, the deep-link normalizer, and the page-fetch
// failure taxonomy (design ruling, W-UX-B parts 9–11).
//
// Laws under test:
//   - SORTS_BY_ENGINE: the DM never OFFERS hf; aave keeps the full contract
//     enum; the flat POSITIONS_SORTS export survives for compatibility.
//   - POSITIONS_SORT_DIRECTIONS names each sort's one canonical direction.
//   - normalizePositionsQuery: unknown enum values fall to defaults; the
//     doomed pair (debt_manager, hf) remaps to the contract default
//     liq_distance and SAYS SO — before any request could fire.
//   - classifyPositionsFailure: a 4xx (except 429) is a REFUSAL — retrying
//     the identical request cannot succeed; 429/503 refuse naming the
//     server's own retry instruction; network/500/malformed keep the
//     retryable transport register (the one case a retry button is honest).

import { expect, test } from "@playwright/test";
import {
  BadRequestError,
  InternalError,
  MalformedResponseError,
  NotFoundError,
  RateLimitedError,
  SolventNetworkError,
  UnavailableError,
} from "@solvent/client";
import {
  classifyPositionsFailure,
  normalizePositionsQuery,
  POSITIONS_SORTS,
  POSITIONS_SORT_DIRECTIONS,
  SORT_HF_REMAP_ACK,
  SORTS_BY_ENGINE,
} from "../../lib/positions";

// The API's own 400 sentence for the doomed pair — the message the register
// must carry VERBATIM (cmd/api/p5_positions.go).
const DM_HF_400 =
  'sort "hf" is not defined for engine "debt_manager": the Debt Manager publishes a strict ' +
  "liquidatable boolean, not a health factor, and this service does not invent an ordering " +
  "for it. Use liq_distance, debt or status.";

const URL_UNDER_TEST = "http://api.test/v1/positions?engine=debt_manager&sort=hf";

test.describe("SORTS_BY_ENGINE — the per-engine sort vocabulary", () => {
  test("the DM never offers hf; aave keeps the full contract enum", () => {
    expect(SORTS_BY_ENGINE.aave_v3_etherfi).toEqual(["liq_distance", "debt", "hf", "status"]);
    expect(SORTS_BY_ENGINE.debt_manager).toEqual(["liq_distance", "debt", "status"]);
    expect(SORTS_BY_ENGINE.debt_manager).not.toContain("hf");
  });

  test("the flat export survives for compatibility, verbatim from the contract", () => {
    expect(POSITIONS_SORTS).toEqual(["liq_distance", "debt", "hf", "status"]);
  });

  test("every sort names its one canonical direction", () => {
    expect(POSITIONS_SORT_DIRECTIONS).toEqual({
      liq_distance: "asc",
      debt: "desc",
      hf: "asc",
      status: "refused-first",
    });
  });
});

test.describe("normalizePositionsQuery — ONE normalizer before the first fetch", () => {
  test("absent params are the defaults — nothing rewritten", () => {
    expect(normalizePositionsQuery(null, null)).toEqual({
      engine: "aave_v3_etherfi",
      sort: "liq_distance",
      hfRemapped: false,
      rewritten: false,
    });
  });

  test("valid pairs pass through untouched", () => {
    expect(normalizePositionsQuery("debt_manager", "debt")).toEqual({
      engine: "debt_manager",
      sort: "debt",
      hfRemapped: false,
      rewritten: false,
    });
    expect(normalizePositionsQuery("aave_v3_etherfi", "hf")).toEqual({
      engine: "aave_v3_etherfi",
      sort: "hf",
      hfRemapped: false,
      rewritten: false,
    });
  });

  test("the doomed pair remaps to the contract default and says so", () => {
    expect(normalizePositionsQuery("debt_manager", "hf")).toEqual({
      engine: "debt_manager",
      sort: "liq_distance",
      hfRemapped: true,
      rewritten: true,
    });
  });

  test("unknown enum values fall to defaults and are rewritten", () => {
    expect(normalizePositionsQuery("bogus_engine", "bogus_sort")).toEqual({
      engine: "aave_v3_etherfi",
      sort: "liq_distance",
      hfRemapped: false,
      rewritten: true,
    });
    // An unknown engine defaults to aave, for which hf IS defined — kept.
    expect(normalizePositionsQuery("bogus_engine", "hf")).toEqual({
      engine: "aave_v3_etherfi",
      sort: "hf",
      hfRemapped: false,
      rewritten: true,
    });
  });

  test("the acknowledgment copy is the ruling's, verbatim", () => {
    expect(SORT_HF_REMAP_ACK).toBe(
      'sort "hf" is not defined for debt_manager — reset to liq_distance. The Debt Manager ' +
        "publishes a strict liquidatable boolean, not a health factor.",
    );
  });
});

test.describe("classifyPositionsFailure — the error taxonomy branch", () => {
  test("a 400 is a refusal: envelope code + the API's sentence verbatim", () => {
    const failure = classifyPositionsFailure(
      new BadRequestError({
        url: URL_UNDER_TEST,
        status: 400,
        code: "bad_request",
        message: DM_HF_400,
        retryAfterSeconds: null,
        body: { error: { code: "bad_request", message: DM_HF_400 } },
      }),
    );
    expect(failure).toEqual({
      register: "refusal",
      code: "bad_request",
      message: DM_HF_400,
    });
  });

  test("any other 4xx (except 429) is a refusal too", () => {
    const failure = classifyPositionsFailure(
      new NotFoundError({
        url: "http://api.test/v1/nope",
        status: 404,
        code: "not_found",
        message: "no such route",
        retryAfterSeconds: null,
        body: { error: { code: "not_found", message: "no such route" } },
      }),
    );
    expect(failure).toEqual({ register: "refusal", code: "not_found", message: "no such route" });
  });

  test("429 refuses naming the server's own retry instruction", () => {
    const message = "rate limit exceeded: this surface admits 20 requests per second";
    const failure = classifyPositionsFailure(
      new RateLimitedError({
        url: URL_UNDER_TEST,
        status: 429,
        code: "rate_limited",
        message,
        retryAfterSeconds: 3,
        body: { error: { code: "rate_limited", message, retry_after_seconds: 3 } },
      }),
    );
    expect(failure).toEqual({
      register: "refusal-retry-after",
      code: "rate_limited",
      message,
      retryAfterSeconds: 3,
    });
  });

  test("503 refuses naming the server's own retry instruction", () => {
    const message = "no complete risk batch is available.";
    const failure = classifyPositionsFailure(
      new UnavailableError({
        url: URL_UNDER_TEST,
        status: 503,
        code: "unavailable",
        message,
        retryAfterSeconds: 5,
        body: { error: { code: "unavailable", message, retry_after_seconds: 5 } },
      }),
    );
    expect(failure).toEqual({
      register: "refusal-retry-after",
      code: "unavailable",
      message,
      retryAfterSeconds: 5,
    });
  });

  test("network, 500, and malformed responses keep the retryable transport register", () => {
    const network = classifyPositionsFailure(
      new SolventNetworkError(URL_UNDER_TEST, "connection refused", { timedOut: false }),
    );
    expect(network.register).toBe("transport");

    const internal = classifyPositionsFailure(
      new InternalError({
        url: URL_UNDER_TEST,
        status: 500,
        code: "internal",
        message: "the service failed to build the response",
        retryAfterSeconds: null,
        body: { error: { code: "internal", message: "the service failed to build the response" } },
      }),
    );
    expect(internal.register).toBe("transport");

    const malformed = classifyPositionsFailure(
      new MalformedResponseError(URL_UNDER_TEST, 502, "<html>bad gateway</html>", "not the envelope"),
    );
    expect(malformed.register).toBe("transport");

    const unknown = classifyPositionsFailure(new Error("something unforeseen"));
    expect(unknown.register).toBe("transport");
  });
});
