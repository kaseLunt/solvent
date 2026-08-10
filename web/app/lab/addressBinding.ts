// Phase 0 fix 1: the result-identity binding for the Lab's single-address mode.
// A settled stress result belongs to the address it was dispatched for
// (phase.addr, captured at submit). The input box is NOT part of the result's
// identity — so the moment they disagree, the render must stop presenting the
// result as an answer for what is in the box (cross-page brief §5).
import type { StressLookup } from "@solvent/client";

export type StressPhase =
  | { status: "idle" }
  | { status: "loading"; addr: string }
  | { status: "done"; addr: string; result: StressLookup }
  | { status: "error"; addr: string; message: string };

export type AddressBinding =
  | { kind: "none" }
  | { kind: "current"; addr: string }
  | { kind: "stale"; addr: string };

export function addressBinding(input: string, phase: StressPhase): AddressBinding {
  if (phase.status !== "done" && phase.status !== "error") return { kind: "none" };
  return input === phase.addr
    ? { kind: "current", addr: phase.addr }
    : { kind: "stale", addr: phase.addr };
}

export function staleBarrierLine(addr: string): string {
  return `RESULTS FOR PREVIOUS INPUT · ${addr} · the box above no longer matches these results — run committed set to answer for the new address`;
}

export function boundResultLine(addr: string): string {
  return `results for ${addr}`;
}
