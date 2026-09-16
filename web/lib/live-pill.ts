// web/lib/live-pill.ts
import { humanAge } from "./freshness";
import type { FreshnessTier } from "./freshnessTiers";

export interface LivePillInput {
  readonly streamState: "idle" | "connecting" | "open" | "waiting" | "closed";
  readonly hasBase: boolean;
  readonly batchId: number | null;
  readonly ageSeconds: number | null;
  readonly tier: FreshnessTier | null;
}

export interface LivePillWords {
  readonly word: "Live" | "Reconnecting" | "Not connected";
  readonly tone: "ok" | "warn" | "dim";
  readonly batch: string | null;
  readonly age: string | null;
  readonly ageTone: "ok" | "warn" | "crit" | "dim";
}

const TIER_TONE: Record<FreshnessTier, "ok" | "warn" | "crit"> = { fresh: "ok", aging: "warn", stale: "crit", critical: "crit" };

export function livePillWords(input: LivePillInput): LivePillWords {
  const connected = input.streamState === "open" && input.hasBase;
  const reconnecting = input.streamState === "connecting" || input.streamState === "waiting" || (input.streamState === "open" && !input.hasBase);
  const word = connected ? "Live" : reconnecting ? "Reconnecting" : "Not connected";
  const tone = connected ? "ok" : reconnecting ? "warn" : "dim";
  const batch = input.batchId === null ? null : `batch ${input.batchId.toLocaleString("en-US")}`;
  const age = input.ageSeconds === null ? null : `${humanAge(input.ageSeconds)} ago`;
  const ageTone = input.ageSeconds === null || input.tier === null ? "dim" : TIER_TONE[input.tier];
  return { word, tone, batch, age, ageTone };
}
