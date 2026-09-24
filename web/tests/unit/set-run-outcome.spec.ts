// The SET-RUN's client register (Wave W-BP at contract 1.7.0).
//
// Laws under test:
//   - DISPATCH IS CODE-FIRST, STATUS-SECOND. The route answers 503 for two
//     different facts, and branching on the status alone renders the busy
//     refusal as "no batch", which is a flatly false statement about the book;
//   - the BUSY arm is its own outcome, distinct from `no-batch` and from
//     `rate-limited`, and it carries the deployment's bound and gauge;
//   - no `Retry-After` is read or invented for the busy arm — nothing computes
//     when a semaphore slot frees;
//   - the shape rules are enforced LOCALLY, before a request is spent;
//   - each refusal's sentence on the Scenarios page (lib/lab-headline.ts's
//     failure arms) states what the client established and claims no gauge it
//     was not given.
//
// The old tornado's cell decisions (the set-level membership gate, the bar
// lengths, the cause sentences) retired with that surface (2026-09-16, Plan 3):
// a set result's rows are read by lib/lab-compare.ts, pinned in
// tests/unit/lab-compare.spec.ts.

import { expect, test } from "@playwright/test";

import { failureHeadline } from "../../lib/lab-headline";
import {
  classifySetRunRefusal,
  runBookSet,
  MAX_SET_RUN_SCENARIOS,
  type SetRunOutcome,
} from "../../lib/runbookSet";

const headers = (map: Record<string, string> = {}) => ({
  get: (name: string) => map[name.toLowerCase()] ?? null,
});

const BUSY_BODY = JSON.stringify({
  error: {
    code: "set_run_busy",
    message:
      "this deployment evaluates at most 2 set-runs concurrently and 2 are running. The request was refused " +
      "immediately rather than queued, so no connection is held waiting. Nothing here computes when a slot frees, " +
      "so no Retry-After is offered rather than one invented. This is a statement about the evaluator's capacity " +
      "and about nothing in the book: the batch is fine.",
    max_in_flight: 2,
    in_flight: 2,
  },
});

const NO_BATCH_BODY = JSON.stringify({
  error: { code: "unavailable", message: "no complete risk batch is available", retry_after_seconds: 5 },
});

test.describe("the set-run's refusal register dispatches on the CODE", () => {
  test("503 set_run_busy is the BUSY arm, never no-batch and never rate-limited", () => {
    const outcome = classifySetRunRefusal(503, headers(), BUSY_BODY);
    expect(outcome.kind).toBe("busy");
    if (outcome.kind !== "busy") return;
    expect(outcome.maxInFlight).toBe(2);
    expect(outcome.inFlight).toBe(2);
    expect(outcome.message).toContain("about nothing in the book");
  });

  test("503 unavailable is the NO-BATCH arm, on the same status", () => {
    const outcome = classifySetRunRefusal(503, headers({ "retry-after": "5" }), NO_BATCH_BODY);
    expect(outcome.kind).toBe("no-batch");
    if (outcome.kind !== "no-batch") return;
    expect(outcome.retryAfterSeconds).toBe(5);
  });

  test("the two 503s are distinguishable ONLY by the code — the status cannot tell them apart", () => {
    const busy = classifySetRunRefusal(503, headers(), BUSY_BODY);
    const noBatch = classifySetRunRefusal(503, headers(), NO_BATCH_BODY);
    expect(busy.kind).not.toBe(noBatch.kind);
  });

  test("p1b-13: unreadable busy gauges are carried as NULL — capacity unknown, never a fabricated zero", () => {
    // p1b-12 taught `positiveInt` to refuse -0 (the fingerprint of a
    // fractional token: `-1e-324` rounds to NEGATIVE ZERO during JSON.parse),
    // but BOTH call sites then substituted `?? 0` — so a malformed busy
    // envelope rendered `max_in_flight 0 · in_flight 0`, a capacity claim
    // production never makes (busy implies max > 0). The null arm now RIDES
    // to the outcome: unreadable is stated as unknown, never as zero.
    const outcome = classifySetRunRefusal(
      503,
      headers(),
      '{"error":{"code":"set_run_busy","max_in_flight":-1e-324,"in_flight":-1e-324}}',
    );
    expect(outcome.kind).toBe("busy");
    if (outcome.kind !== "busy") return;
    expect(outcome.maxInFlight).toBeNull();
    expect(outcome.inFlight).toBeNull();
    // The busy sentence states capacity UNKNOWN and claims no zero — the
    // "0 of 0"-shaped claim ("at most 0 … and 0 are running") is pinned out.
    const sentence = failureHeadline("busy", {
      message: outcome.message,
      inFlight: outcome.inFlight,
      maxInFlight: outcome.maxInFlight,
    });
    expect(sentence.emphasis).toBe("The evaluator is busy.");
    // A busy slot is a read that did not complete, never the refused register.
    expect(sentence.tone).toBe("absent");
    expect(sentence.dek).toContain("The service did not state its capacity.");
    expect(sentence.dek).not.toMatch(/\b0 of 0\b/);
    expect(sentence.dek).not.toMatch(/\b0 are running/);
    // ABSENT gauges are the same unknown, not a different zero.
    const absent = classifySetRunRefusal(503, headers(), '{"error":{"code":"set_run_busy","message":"m"}}');
    expect(absent.kind).toBe("busy");
    if (absent.kind !== "busy") return;
    expect(absent.maxInFlight).toBeNull();
    expect(absent.inFlight).toBeNull();
    // Ordinary zero gauges stay legal (`.toBe` is Object.is — the sign bit
    // would show): a served 0 is the wire's own claim, and the wire's claim
    // is kept.
    const zeroes = classifySetRunRefusal(
      503,
      headers(),
      '{"error":{"code":"set_run_busy","max_in_flight":0,"in_flight":0}}',
    );
    expect(zeroes.kind).toBe("busy");
    if (zeroes.kind !== "busy") return;
    expect(zeroes.maxInFlight).toBe(0);
    expect(zeroes.inFlight).toBe(0);
  });

  test("the BUSY arm reads no Retry-After, even if a proxy invents one", () => {
    const outcome = classifySetRunRefusal(503, headers({ "retry-after": "30" }), BUSY_BODY);
    expect(outcome.kind).toBe("busy");
    expect(JSON.stringify(outcome)).not.toContain("retryAfter");
  });

  test("429 keeps its message — the arm this module exists NOT to inherit", () => {
    const outcome = classifySetRunRefusal(
      429,
      headers({ "retry-after": "2" }),
      JSON.stringify({
        error: {
          code: "rate_limited",
          message: "rate limit exceeded: ... and a set-run costs 1 token per scenario. This request asked for 15.",
        },
      }),
    );
    expect(outcome.kind).toBe("rate-limited");
    if (outcome.kind !== "rate-limited") return;
    expect(outcome.message).toContain("one token per scenario".replace("one", "1"));
    expect(outcome.retryAfterSeconds).toBe(2);
  });

  test("404 with the envelope keeps every unknown id it named; without one it is `not-served`", () => {
    const named = classifySetRunRefusal(
      404,
      headers(),
      JSON.stringify({ error: { code: "not_found", message: 'no committed scenario "eth_minus_99"' } }),
    );
    expect(named.kind).toBe("refused");
    if (named.kind === "refused") expect(named.message).toContain("eth_minus_99");

    expect(classifySetRunRefusal(404, headers(), "<html>not found</html>").kind).toBe("not-served");
  });

  test("a body that is not the envelope is `refused`, and says so rather than guessing", () => {
    const outcome = classifySetRunRefusal(502, headers(), "<html>bad gateway</html>");
    expect(outcome.kind).toBe("refused");
    if (outcome.kind === "refused") expect(outcome.message).toContain("without the contract's error envelope");
  });
});

test.describe("the shape rules are enforced locally, before a request is spent", () => {
  const neverCalled: typeof fetch = () => {
    throw new Error("a request was sent for a body the contract already refuses");
  };

  // Codex r59-A — a local refusal RESOLVES to its own arm, it never rejects.
  // The concrete failure the old throw produced: a listing that publishes an
  // id the wire pattern refuses (the server accepts any nonblank committed
  // id, e.g. "ETH_down") made runSet's un-handled rejection strand the
  // in-flight guard at true, permanently disabling set dispatch while the
  // page claimed a run was still in flight.
  const refusedLocally = async (ids: readonly string[]): Promise<string> => {
    const outcome = await runBookSet("http://x", ids, { fetchImpl: neverCalled });
    expect(outcome.kind).toBe("refused-locally");
    return outcome.kind === "refused-locally" ? outcome.message : "";
  };

  test("an empty set resolves refused-locally, and says there is no implicit all", async () => {
    expect(await refusedLocally([])).toMatch(/no implicit/);
  });

  test("over the cap resolves refused-locally", async () => {
    const ids = Array.from({ length: MAX_SET_RUN_SCENARIOS + 1 }, (_, i) => `id_${String(i)}`);
    expect(await refusedLocally(ids)).toMatch(/cap of 24/);
  });

  test("a malformed id and a repeat both resolve refused-locally — NEVER a rejection", async () => {
    expect(await refusedLocally(["ETH_down"])).toMatch(/committed-scenario id/);
    expect(await refusedLocally(["eth_minus_10", "eth_minus_10"])).toMatch(/appears twice/);
  });

  test("refused-locally carries its own register sentence, naming that nothing was sent", () => {
    const sentence = failureHeadline("refused-locally", {
      message: '"ETH_down" is not a committed-scenario id (expected ^[a-z0-9_]{1,64}$), so nothing was sent',
    });
    expect(sentence.emphasis).toBe("Nothing was sent.");
    expect(sentence.tone).toBe("refused");
    expect(sentence.dek).toContain("ETH_down");
    expect(sentence.dek).toContain("nothing was sent");
  });

  test("an unreachable service is its own arm, never a failure about the book", async () => {
    const outcome: SetRunOutcome = await runBookSet("http://x", ["eth_minus_10"], {
      fetchImpl: () => Promise.reject(new Error("connect ECONNREFUSED")),
    });
    expect(outcome.kind).toBe("unreachable");
  });

  test("the POST carries the ids in REQUEST order", async () => {
    let sent = "";
    await runBookSet("http://x", ["b_two", "a_one"], {
      fetchImpl: (_url, init) => {
        sent = String((init as RequestInit).body);
        return Promise.resolve(new Response("{}", { status: 200 }));
      },
    });
    expect(sent).toBe('{"scenario_ids":["b_two","a_one"]}');
  });
});
