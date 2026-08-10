// p1b-5 (cross-page brief §5, result identity): the ONE module that names what
// an async result IS. §5 binds every async result to scope / address / batch /
// config-version / engines / computed-at, with the identity VISIBLE on the
// rendered face (the ratified canon's result-identity line, p1-foundation
// canon §05). The matrix and the tornado already carry this per-cell; the
// Lab's address mode bound only the address (p0-1) — this module is the shared
// composition its line and its age receipt now read, and the seam every later
// surface composes the same identity through.
//
// TWO LAWS:
//   1. The identity is EXTRACTED, never invented. Every field comes verbatim
//      from the settled response — plus the addr captured at dispatch, which
//      is p0-1's binding law (the input box is NOT part of the identity).
//   2. `servedAt` is an identity + receipt source, NEVER a duration source.
//      The age originates in the wire's `age_seconds`, anchored at receipt
//      (lib/freshness.ts law 1); `resultReceipt` is the only place the two
//      meet, and it meets them exactly the way freshness.ts's Wave R5 law
//      demands: `served_at` + batch id, so a fresher response always
//      re-anchors and a re-render never does.
//
// Pinned by tests/unit/result-identity.spec.ts; the render consequences by
// tests/e2e/p1b-fixes.spec.ts (p1b-5).

import { receiptIdentity, type AgeReceipt } from "./freshness";

/** The §5 identity of one async result, as the surfaces bind it. */
export interface ResultIdentity {
  scope: "book" | "address" | "set";
  /** The dispatched address — present exactly when `scope` is "address". */
  address?: string;
  batchId: number;
  configVersion: string;
  /**
   * ANSWERED engines (distinct, wire order). Withheld engines are the
   * lookup's own refusal list and are rendered separately by the surface —
   * an identity line must not launder a refusal into an answer.
   */
  engines: readonly string[];
  /** Identity + receipt source, never a duration source (law 2). */
  servedAt: string;
}

/**
 * The visible identity line, in the canon's composition order: subject ·
 * batch · config version · answered engines. `computed_at` and the age are
 * deliberately NOT here — the batch envelope (LabBatchStamp) states
 * `computed_at` verbatim, and the age is an ANCHORED number with its own
 * line and its own unknown register, never a frozen clause inside a string.
 */
export function identityLine(id: ResultIdentity): string {
  const subject =
    id.scope === "address"
      ? // An address identity without its address is a caller error; render a
        // visible refusal rather than an invented subject (never throw on a
        // render path).
        (id.address ?? "(address unstated)")
      : id.scope === "book"
        ? "the book"
        : "the committed set";
  const engines = id.engines.length > 0 ? id.engines.join(", ") : "none answered";
  return `results for ${subject} · batch #${String(id.batchId)} · config ${id.configVersion} · engines ${engines}`;
}

/**
 * The stress-response fields the extractor reads — structural, so BOTH the
 * refined response (`StressLookup["response"]`, what LabClient actually
 * holds) and a fixture-shaped body assign to it without a cast.
 */
export interface StressIdentitySource {
  readonly served_at: string;
  readonly batch: { readonly id: number };
  /**
   * p1b-9 (Codex round, finding 1): the response's OWN address — the account
   * the service says this body answers for (`StressResponse.address`,
   * generated schema). The dispatch address alone is not an identity: a
   * mislabeled body (cache fault, proxy fault, server bug) carries another
   * account's numbers under this request's URL, and only this field can
   * contradict it.
   */
  readonly address: string;
  readonly scenario_config_version: string;
  readonly scenarios: readonly {
    readonly results: readonly { readonly engine: string }[];
  }[];
}

/**
 * THE ADDRESS WELD (p1b-9, finding 1): does the settled body answer for the
 * account the run was dispatched for? Compared case-insensitively — the
 * contract's Address is 0x-hex and deployments differ in checksum casing, so
 * a byte comparison would refuse honest bodies — and consulted BEFORE the
 * result is admitted as a phase: a mismatch renders the contract-refusal arm
 * (both addresses named, nothing claimed), never "results for A" over B's
 * numbers.
 */
export function stressAddressMatchesDispatch(
  addr: string,
  response: StressIdentitySource,
): boolean {
  return response.address.toLowerCase() === addr.toLowerCase();
}

/** The §5 identity of one settled address-stress result. */
export function stressResultIdentity(addr: string, response: StressIdentitySource): ResultIdentity {
  // ANSWERED engines: the DISTINCT engines present in the RESULTS, in wire
  // order. Never the scenario definitions' `engines` lists (a definition
  // names what the scenario models, not who answered for THIS address), and
  // never a hardcoded engine vocabulary. Withheld engines live on the
  // lookup's own refusal list, rendered separately.
  const engines: string[] = [];
  for (const scenario of response.scenarios) {
    for (const result of scenario.results) {
      if (!engines.includes(result.engine)) engines.push(result.engine);
    }
  }
  return {
    scope: "address",
    address: addr,
    batchId: response.batch.id,
    configVersion: response.scenario_config_version,
    engines,
    servedAt: response.served_at,
  };
}

/**
 * The age receipt for this identity: the wire's own `age_seconds` pinned to
 * the receipt identity `served_at#batchId` (freshness.ts `receiptIdentity`,
 * Wave R5's law). Composed HERE so every surface rendering this identity
 * anchors on the SAME receipt — a constant or borrowed receipt would never
 * re-anchor on a fresher response, which is exactly the defect the unit pin
 * on this function exists to kill (p1b-5-M2).
 */
export function resultReceipt(id: ResultIdentity, ageSeconds: number): AgeReceipt {
  return { ageSeconds, receiptId: receiptIdentity(id.servedAt, id.batchId) };
}
