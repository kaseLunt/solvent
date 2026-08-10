// Phase 0 fix 1: the result-identity binding for the Lab's single-address mode.
// A settled stress result belongs to the address it was dispatched for
// (phase.addr, captured at submit). The input box is NOT part of the result's
// identity — so the moment they disagree, the render must stop presenting the
// result as an answer for what is in the box (cross-page brief §5).
import type { StressLookup } from "@solvent/client";
import { identityLine, stressResultIdentity } from "@/lib/resultIdentity";

export type StressPhase =
  | { status: "idle" }
  | { status: "loading"; addr: string }
  | { status: "done"; addr: string; result: StressLookup }
  /**
   * p1b-9 (Codex round, finding 1): the settled body's own `address` field
   * contradicts the dispatch — a mislabeled response (cache/proxy/server
   * fault). The result is NOT admitted: no `result` is carried, so no arm can
   * read the body's numbers, and the render is the contract-refusal line.
   *
   * p1b-10 (finding 1 completion): a NESTED `scenarios[].results[].account`
   * contradicting the dispatch takes the same arm, with `path` naming the
   * offending field (`scenarios[2].results[0].account`) and `echoed` carrying
   * that nested account. `path` absent = the top-level `address` contradicted.
   */
  | { status: "mismatch"; addr: string; echoed: string; path?: string }
  | { status: "error"; addr: string; message: string };

export type AddressBinding =
  | { kind: "none" }
  | { kind: "current"; addr: string }
  | { kind: "stale"; addr: string };

export function addressBinding(input: string, phase: StressPhase): AddressBinding {
  // A mismatch refusal binds to the address it was DISPATCHED for exactly the
  // way results and errors do: editing the box away from it interposes the
  // stale barrier, so a refusal about a previous run never stands beside a
  // new input as if it answered for it.
  if (phase.status !== "done" && phase.status !== "error" && phase.status !== "mismatch") {
    return { kind: "none" };
  }
  return input === phase.addr
    ? { kind: "current", addr: phase.addr }
    : { kind: "stale", addr: phase.addr };
}

export function staleBarrierLine(addr: string): string {
  return `RESULTS FOR PREVIOUS INPUT · ${addr} · the box above no longer matches these results — run committed set to answer for the new address`;
}

/**
 * p1b-9 (finding 1): the mislabeled-response refusal, in the house
 * identity-refusal register (the matrix's DEFINITION CHANGED/contradiction
 * tone): BOTH addresses named verbatim, nothing claimed for either, the way
 * forward stated. Rendered under `lab-address-mismatch` in the done-rendering
 * slot — the body's numbers are never read.
 *
 * p1b-10 (finding 1 completion): with a `path`, the contradiction is a
 * NESTED result's `account` — the sentence names the exact wire field
 * (`scenarios[2].results[0].account`) so the reader knows WHERE the body
 * contradicted itself, in the same register, still claiming nothing.
 */
export function addressMismatchLine(dispatched: string, echoed: string, path?: string): string {
  const claim =
    path === undefined
      ? `the response says it answers for ${echoed}`
      : `the response's ${path} says its result answers for ${echoed}`;
  return (
    `ADDRESS MISMATCH · refusing to render: the run was dispatched for ${dispatched} ` +
    `and ${claim}. One of them is mislabeled, so ` +
    `nothing is claimed for either address — run committed set to answer again`
  );
}

/**
 * p1b-5: the p0-1 `boundResultLine` (`results for {addr}`), grown into the
 * full §5 identity — address, batch, config version, answered engines —
 * composed from the SETTLED result (phase.addr + the refined response), never
 * from the input box. Pure; pinned in address-binding.spec.ts and rendered
 * under the `lab-result-address` testid (name unchanged, text grown).
 */
export function settledIdentityLine(addr: string, result: StressLookup): string {
  return identityLine(stressResultIdentity(addr, result.response));
}
