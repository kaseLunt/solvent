// web/lib/live-pill.ts
import { humanAge } from "./freshness";
import type { FreshnessTier } from "./freshnessTiers";

export interface LivePillInput {
  readonly streamState: "idle" | "connecting" | "open" | "waiting" | "closed";
  readonly hasBase: boolean;
  readonly batchId: number | null;
  readonly ageSeconds: number | null;
  /** A batch is held but its age cannot be stated (a blind resume): the pill says so rather than dropping the age. */
  readonly ageUnresolved: boolean;
  readonly tier: FreshnessTier | null;
}

/** The pill's words and their tones, in the kit's tone grammar (lib/kit.ts TONE_GRAMMAR). */
export interface LivePillWords {
  readonly word: "Live" | "Reconnecting" | "Not connected";
  /** The connection's register: live is posture (accent), never health; reconnecting warns; not connected claims nothing. */
  readonly tone: "live" | "warn" | "dim";
  readonly batch: string | null;
  readonly age: string | null;
  /** A fresh age is a record (ink); an aging age warns and a stale or critical one is crit — the age tier's own verdict. */
  readonly ageTone: "neutral" | "warn" | "crit" | "dim";
}

const TIER_TONE: Record<FreshnessTier, "neutral" | "warn" | "crit"> = { fresh: "neutral", aging: "warn", stale: "crit", critical: "crit" };

export function livePillWords(input: LivePillInput): LivePillWords {
  const connected = input.streamState === "open" && input.hasBase;
  const reconnecting = input.streamState === "connecting" || input.streamState === "waiting" || (input.streamState === "open" && !input.hasBase);
  const word = connected ? "Live" : reconnecting ? "Reconnecting" : "Not connected";
  const tone = connected ? "live" : reconnecting ? "warn" : "dim";
  const batch = input.batchId === null ? null : `batch ${input.batchId.toLocaleString("en-US")}`;
  // An unresolved age is a statement, not an omission: the batch stands, its age does not.
  const age = input.ageUnresolved ? "age unknown" : input.ageSeconds === null ? null : `${humanAge(input.ageSeconds)} ago`;
  const ageTone = input.ageUnresolved || input.ageSeconds === null || input.tier === null ? "dim" : TIER_TONE[input.tier];
  return { word, tone, batch, age, ageTone };
}
