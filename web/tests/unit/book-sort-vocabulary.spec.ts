// Per-engine sort vocabulary, the deep-link normalizer, and the page-fetch
// failure taxonomy (design ruling, W-UX-B parts 9–11; sort vocabulary
// extended by W-HR-A and amended by W-HR-B / contract 1.5.0).
//
// Laws under test:
//   - SORTS_BY_ENGINE (the WIRE vocabulary, contract-verbatim): the DM never
//     OFFERS hf; aave keeps the full contract enum. 1.5.0 added `headroom` to
//     BOTH engines and DEPRECATED `liq_distance` without removing it.
//   - BOOK_SORTS (the UI's column vocabulary): headroom / debt / status, each
//     resolving to the wire key of the SAME NAME on both engines — the column
//     asks for the number it prints.
//   - POSITIONS_SORT_DIRECTIONS names each wire sort's canonical direction;
//     BOOK_SORT_DIRECTIONS does the same for the columns.
//   - normalizeBookQuery: unknown values fall to defaults; `hf` aliases onto
//     the column that IS its ordering; `liq_distance` is HONORED verbatim
//     (Wave R7 — on the DM it is a DIFFERENT ordering from the ratio, so
//     re-ranking it would serve a bookmark's owner a different book); and the
//     doomed pair (debt_manager, hf) is acknowledged — before any request
//     could fire.
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
  bookSortFooterLabel,
  bookSortWireKey,
  BOOK_SORTS,
  BOOK_SORTS_BY_ENGINE,
  BOOK_SORT_DIRECTIONS,
  classifyPositionsFailure,
  DEFAULT_BOOK_ENGINE,
  DEFAULT_BOOK_SORT,
  engineOffersBookSort,
  isHonoredLegacySort,
  LIQ_DISTANCE_READER_WORDS,
  normalizeBookQuery,
  POSITIONS_SORTS,
  POSITIONS_SORT_DIRECTIONS,
  SORT_HF_REMAP_ACK,
  SORT_LIQ_DISTANCE_HONORED,
  SORTS_BY_ENGINE,
} from "../../lib/positions";

// The API's own 400 sentence for the doomed pair — the message the register
// must carry VERBATIM (cmd/api/p5_positions.go).
// W-HR-B: the hint clause gained `headroom`, which 1.5.0 defines for the DM.
const DM_HF_400 =
  'sort "hf" is not defined for engine "debt_manager": the Debt Manager publishes a strict ' +
  "liquidatable boolean, not a health factor, and this service does not invent an ordering " +
  "for it. Use headroom, liq_distance, debt or status.";

const URL_UNDER_TEST = "http://api.test/v1/positions?engine=debt_manager&sort=hf";

test.describe("SORTS_BY_ENGINE — the per-engine sort vocabulary", () => {
  test("the DM never offers hf; aave keeps the full contract enum; BOTH gain headroom", () => {
    expect(SORTS_BY_ENGINE.aave_v3_etherfi).toEqual([
      "headroom",
      "liq_distance",
      "debt",
      "hf",
      "status",
    ]);
    expect(SORTS_BY_ENGINE.debt_manager).toEqual(["headroom", "liq_distance", "debt", "status"]);
    expect(SORTS_BY_ENGINE.debt_manager).not.toContain("hf");
    // `headroom` is NOT in hf's class: the DM's own (max_borrow_lt,
    // borrowings) pair defines the ratio, so nothing is invented by ranking it.
    expect(SORTS_BY_ENGINE.debt_manager).toContain("headroom");
  });

  test("the flat export survives for compatibility, verbatim from the contract", () => {
    expect(POSITIONS_SORTS).toEqual(["headroom", "liq_distance", "debt", "hf", "status"]);
    // THE ALIAS LAW: 1.5.0 deprecated `liq_distance`; it did NOT remove it.
    // A vocabulary that dropped it would break every pre-1.5.0 link.
    expect(POSITIONS_SORTS).toContain("liq_distance");
  });

  test("every sort names its one canonical direction", () => {
    expect(POSITIONS_SORT_DIRECTIONS).toEqual({
      headroom: "asc",
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

  test("EVERY column asks for the wire key of its own name, on BOTH engines", () => {
    // W-HR-B / contract 1.5.0. The Headroom column no longer borrows another
    // key: the service orders by the exact ratio the column prints. The DM's
    // old borrow (`liq_distance`) ranked ABSOLUTE dollar room and produced 130
    // adjacent inversions against the printed percent in the first 1000 live
    // rows — the defect this identity closes.
    for (const engine of ["aave_v3_etherfi", "debt_manager"] as const) {
      for (const sort of BOOK_SORTS) {
        expect(bookSortWireKey(engine, sort), `${engine}/${sort}`).toBe(sort);
      }
    }
    expect(bookSortWireKey("debt_manager", "headroom")).toBe("headroom");
    expect(bookSortWireKey("aave_v3_etherfi", "headroom")).toBe("headroom");
    // The old borrows are NOT what the column asks for any more.
    expect(bookSortWireKey("debt_manager", "headroom")).not.toBe("liq_distance");
    expect(bookSortWireKey("aave_v3_etherfi", "headroom")).not.toBe("hf");
  });

  test("the doomed (debt_manager, hf) request can no longer be COMPOSED at all", () => {
    for (const sort of BOOK_SORTS) {
      expect(bookSortWireKey("debt_manager", sort)).not.toBe("hf");
    }
  });

  test("every Book column resolves to a key its engine actually DEFINES", () => {
    // The composition guard: a column may only ask for a key the per-engine
    // wire vocabulary lists, or the UI is building a request the API refuses.
    for (const engine of ["aave_v3_etherfi", "debt_manager"] as const) {
      for (const sort of BOOK_SORTS_BY_ENGINE[engine]) {
        expect(SORTS_BY_ENGINE[engine], `${engine}/${sort}`).toContain(
          bookSortWireKey(engine, sort),
        );
      }
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

  test("`hf` ALIASES onto the Headroom column — the ranking survives, the token is rewritten", () => {
    // A bookmarked ?sort=hf asked for "rank by how close to the boundary".
    // That ranking IS the Headroom column, EXACTLY: headroom is 1 − 1/HF,
    // strictly increasing in the health factor, so hf-asc and headroom-asc are
    // one total order. Nothing about the sequence changes, so the param can be
    // rewritten to the token the table is using without misleading anyone.
    expect(normalizeBookQuery("aave_v3_etherfi", "hf", null)).toEqual({
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
    // W-HR-B: the acknowledgment must name the ranking the table ACTUALLY
    // applies. Since 1.5.0 that is the wire's own `headroom` key, not
    // `liq_distance` — so the copy below moved with it.
    expect(bookSortWireKey(normalized.engine, normalized.sort)).toBe("headroom");
  });

  test("a `headroom` deep link is a FIRST-CLASS param — accepted verbatim, nothing rewritten", () => {
    for (const engine of ["aave_v3_etherfi", "debt_manager"] as const) {
      expect(normalizeBookQuery(engine, "headroom", null)).toEqual({
        engine,
        sort: "headroom",
        reversed: false,
        hfRemapped: false,
        rewritten: false,
      });
    }
  });

  test("a `liq_distance` deep link is HONORED VERBATIM — both engines, nothing rewritten", () => {
    // WAVE R7 (round-15 finding 1). This USED to alias onto the Headroom
    // column, and on `debt_manager` that was a DIFFERENT ORDERING: the key
    // ranks the ABSOLUTE room (max_borrow_lt − borrowings) while headroom ranks
    // the RATIO, so an honest reader's bookmark was served a different account
    // sequence with no acknowledgment anywhere on the page. The service serves
    // the deprecated key with its ordering unchanged precisely so links keep
    // their meaning; the web must not defeat that.
    for (const engine of ["aave_v3_etherfi", "debt_manager"] as const) {
      expect(normalizeBookQuery(engine, "liq_distance", null), engine).toEqual({
        engine,
        sort: "liq_distance",
        reversed: false,
        hfRemapped: false,
        // NOT rewritten: the URL keeps saying what the table is doing, which is
        // only true while the table is doing what the URL says.
        rewritten: false,
      });
    }
  });

  test("BOTH DIRECTIONS of an honored `liq_distance` link survive", () => {
    for (const engine of ["aave_v3_etherfi", "debt_manager"] as const) {
      // Canonical (asc, nearest the boundary first) is the DEFAULT direction,
      // and defaults are omitted from the URL — so a present `dir=asc` is
      // dropped while the ORDERING it named is exactly what is applied.
      expect(normalizeBookQuery(engine, "liq_distance", "asc"), `${engine} asc`).toEqual({
        engine,
        sort: "liq_distance",
        reversed: false,
        hfRemapped: false,
        rewritten: true,
      });
      // The reverse is the two-state cycle's other half and rides through
      // untouched: the sort SURVIVED verbatim, so the dir beside it is not
      // orphaned.
      expect(normalizeBookQuery(engine, "liq_distance", "desc"), `${engine} desc`).toEqual({
        engine,
        sort: "liq_distance",
        reversed: true,
        hfRemapped: false,
        rewritten: false,
      });
    }
  });

  test("the honored key is NAMED in reader words, and the vocabulary can resolve it", () => {
    // The register must not be a bare wire token: `liq_distance` printed beside
    // a Headroom column is exactly the confusion this wave removes.
    expect(isHonoredLegacySort("liq_distance")).toBe(true);
    expect(isHonoredLegacySort("headroom")).toBe(false);
    expect(LIQ_DISTANCE_READER_WORDS).toBe("absolute room to the boundary");
    expect(SORT_LIQ_DISTANCE_HONORED).toContain(LIQ_DISTANCE_READER_WORDS);
    expect(SORT_LIQ_DISTANCE_HONORED).toContain("deprecated");
    // It says the order is NOT the printed ratio — which is why no header
    // carries an indicator while it is in force.
    expect(SORT_LIQ_DISTANCE_HONORED).toContain("NOT the Headroom");
    // The footer names the applied ranking, quantity included.
    expect(bookSortFooterLabel("liq_distance")).toBe(
      "liq_distance (absolute room to the boundary)",
    );
    expect(bookSortFooterLabel("headroom")).toBe("headroom");
    // It resolves to itself on the wire — the request asks for the ordering the
    // link asked for, on either engine.
    for (const engine of ["aave_v3_etherfi", "debt_manager"] as const) {
      expect(bookSortWireKey(engine, "liq_distance")).toBe("liq_distance");
      expect(SORTS_BY_ENGINE[engine]).toContain("liq_distance");
      // An ENGINE toggle never strands it: 1.5.0 defines the key on both books,
      // so switching engines cannot silently re-rank the reader.
      expect(engineOffersBookSort(engine, "liq_distance")).toBe(true);
    }
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

  test("the acknowledgment copy names the ranking the table ACTUALLY applies", () => {
    // W-UX-B's reason clause, verbatim; the destination corrected by W-HR-B
    // because 1.5.0 moved it. A remap acknowledgment that names a key the
    // table is not using is worse than none.
    expect(SORT_HF_REMAP_ACK).toBe(
      'sort "hf" is not defined for debt_manager — reset to headroom. The Debt Manager ' +
        "publishes a strict liquidatable boolean, not a health factor.",
    );
    expect(SORT_HF_REMAP_ACK).toContain(
      bookSortWireKey("debt_manager", normalizeBookQuery("debt_manager", "hf", null).sort),
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
