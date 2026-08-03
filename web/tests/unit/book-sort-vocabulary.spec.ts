// Per-engine sort vocabulary, the deep-link normalizer, and the page-fetch
// failure taxonomy (design ruling, W-UX-B parts 9–11; sort vocabulary
// extended by W-HR-A).
//
// Laws under test:
//   - SORTS_BY_ENGINE (the WIRE vocabulary, contract-verbatim): the DM never
//     OFFERS hf; aave keeps the full contract enum. Untouched by W-HR-A —
//     this wave does not amend the contract.
//   - BOOK_SORTS (the UI's column vocabulary): headroom / debt / status, and
//     `headroom` resolves per engine onto an EXISTING wire key.
//   - POSITIONS_SORT_DIRECTIONS names each wire sort's canonical direction;
//     BOOK_SORT_DIRECTIONS does the same for the columns.
//   - normalizeBookQuery: unknown values fall to defaults; the legacy wire
//     sorts alias onto their column; the doomed pair (debt_manager, hf) is
//     acknowledged — before any request could fire.
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
  bookSortWireKey,
  BOOK_SORTS,
  BOOK_SORTS_BY_ENGINE,
  BOOK_SORT_DIRECTIONS,
  classifyPositionsFailure,
  DEFAULT_BOOK_ENGINE,
  DEFAULT_BOOK_SORT,
  normalizeBookQuery,
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

test.describe("BOOK_SORTS — the UI column vocabulary (W-HR-A)", () => {
  test("the columns are headroom / debt / status, and BOTH engines rank by all three", () => {
    expect(BOOK_SORTS).toEqual(["headroom", "debt", "status"]);
    expect(BOOK_SORTS_BY_ENGINE.aave_v3_etherfi).toEqual(["headroom", "debt", "status"]);
    expect(BOOK_SORTS_BY_ENGINE.debt_manager).toEqual(["headroom", "debt", "status"]);
  });

  test("headroom is asc (least headroom first); the other directions are unchanged", () => {
    expect(BOOK_SORT_DIRECTIONS).toEqual({
      headroom: "asc",
      debt: "desc",
      status: "refused-first",
    });
  });

  test("headroom resolves onto each engine's OWN existing wire key", () => {
    // Aave: hf. headroom = 1 − 1/HF is strictly increasing in HF, so hf-asc
    // IS headroom-asc, exactly.
    expect(bookSortWireKey("aave_v3_etherfi", "headroom")).toBe("hf");
    // DM: the server's USD-headroom key. KNOWN INTERIM LIMIT — that key ranks
    // by absolute USD headroom while the column prints a ratio, so DM order
    // is not strictly monotonic in the displayed percent until 1.5.0.
    expect(bookSortWireKey("debt_manager", "headroom")).toBe("liq_distance");
    // Every other column is its own wire key on both engines.
    expect(bookSortWireKey("aave_v3_etherfi", "debt")).toBe("debt");
    expect(bookSortWireKey("debt_manager", "debt")).toBe("debt");
    expect(bookSortWireKey("debt_manager", "status")).toBe("status");
  });

  test("the doomed (debt_manager, hf) request can no longer be COMPOSED at all", () => {
    for (const sort of BOOK_SORTS) {
      expect(bookSortWireKey("debt_manager", sort)).not.toBe("hf");
    }
  });
});

test.describe("normalizeBookQuery — ONE normalizer before the first fetch", () => {
  test("absent params are the defaults — debt_manager + headroom, nothing rewritten", () => {
    expect(DEFAULT_BOOK_ENGINE).toBe("debt_manager");
    expect(DEFAULT_BOOK_SORT).toBe("headroom");
    expect(normalizeBookQuery(null, null, null)).toEqual({
      engine: "debt_manager",
      sort: "headroom",
      reversed: false,
      hfRemapped: false,
      rewritten: false,
    });
  });

  test("valid pairs pass through untouched", () => {
    expect(normalizeBookQuery("debt_manager", "debt", null)).toEqual({
      engine: "debt_manager",
      sort: "debt",
      reversed: false,
      hfRemapped: false,
      rewritten: false,
    });
    expect(normalizeBookQuery("aave_v3_etherfi", "headroom", null)).toEqual({
      engine: "aave_v3_etherfi",
      sort: "headroom",
      reversed: false,
      hfRemapped: false,
      rewritten: false,
    });
  });

  test("the legacy wire sorts ALIAS onto the Headroom column — the ranking survives, the token is rewritten", () => {
    // A bookmarked ?sort=hf asked for "rank by how close to the boundary".
    // That ranking is the Headroom column; the param is rewritten, never
    // silently honored under a name the table no longer uses.
    expect(normalizeBookQuery("aave_v3_etherfi", "hf", null)).toEqual({
      engine: "aave_v3_etherfi",
      sort: "headroom",
      reversed: false,
      hfRemapped: false,
      rewritten: true,
    });
    expect(normalizeBookQuery("aave_v3_etherfi", "liq_distance", null)).toEqual({
      engine: "aave_v3_etherfi",
      sort: "headroom",
      reversed: false,
      hfRemapped: false,
      rewritten: true,
    });
  });

  test("the doomed pair is still acknowledged, and its request is never composed", () => {
    const normalized = normalizeBookQuery("debt_manager", "hf", null);
    expect(normalized).toEqual({
      engine: "debt_manager",
      sort: "headroom",
      reversed: false,
      hfRemapped: true,
      rewritten: true,
    });
    // The acknowledgment's sentence remains literally true: headroom on the
    // DM IS the wire's liq_distance key.
    expect(bookSortWireKey(normalized.engine, normalized.sort)).toBe("liq_distance");
  });

  test("unknown values fall to defaults and are rewritten", () => {
    expect(normalizeBookQuery("bogus_engine", "bogus_sort", null)).toEqual({
      engine: "debt_manager",
      sort: "headroom",
      reversed: false,
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
