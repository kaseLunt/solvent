// THE APPBAR'S STREAM-CHIP VOCABULARY (Wave R7, re-cut by Phase 1 Track A
// p1a-4 to the canon appbar contract, build-contract §10 / §05 dimension 1).
//
// THE HISTORY THIS CARRIES: R7 made liveness a claim about the CURRENT
// connection — `streamState === "open"` AND `hasBase` — because a batch is
// retained across a teardown on purpose, and painting `LIVE · WATERMARKED`
// from `(batch retained && !unavailable)` left a green chip standing over a
// dead socket. That law is unchanged here; only the REWARD for satisfying it
// changed.
//
// p1a-4 RETIRES THE PRIZE ARM. There is no `live: true` any more: a healthy
// connection is `STREAM CONNECTED` — an accent-toned chip like any other
// posture, never green, never one word about the data's freshness. "A
// connected stream and an 18-hour snapshot are both true — both always show,
// separately" (canon §05); the snapshot's own chip carries the age and its
// SLA tier, and neither statement may launder the other.
//
//   · CONNECTED      — open, base delivered. Accent: posture, not health.
//   · CONNECTING     — no connection is carrying data yet (idle / connecting).
//   · RECONNECTING   — the client is on its backoff. Both warn-toned: the
//                      transport is impaired and says so.
//   · CLOSED         — the reconnect policy is spent, or the stream was closed
//                      deliberately. The one crit-toned posture.
//   · AWAITING BASE  — open, but this connection has said nothing: its data is
//                      entirely the PREVIOUS connection's. Unknown register
//                      (dashed): not impaired, not proven either.
//   · NO BATCH       — connected, base delivered, and the base held nothing.
//                      Unknown register too: an absence, not a fault.
//
// The words are the ribbon's existing vocabulary minus the middot — the canon
// chip is sans uppercase with NO interior punctuation (`STREAM CONNECTED`).
// The constants keep their exported names so every identity pin in
// tests/unit/stream-posture.spec.ts survives by import, and none of the
// labels contains the substring "LIVE" (the three retirement guards).

import type { StreamState } from "@solvent/client";
import { isWirePopulation } from "./wireGuard";

/**
 * How the stream chip is toned. Maps onto the canon chip registers in
 * components/Ribbon.tsx: `accent` → c-accent, `warn` → c-warn, `waiting` →
 * c-unknown (dashed), `down` → c-crit.
 */
export type RibbonPostureTone = "accent" | "warn" | "waiting" | "down";

/**
 * What the stream chip says. One shape for every posture — `LIVE` is not a
 * representable value of this type, and CONNECTED is just another label with
 * another tone: the component cannot paint a liveness claim as a side effect
 * of having data.
 */
export interface RibbonStreamPosture {
  readonly label: string;
  readonly tone: RibbonPostureTone;
}

/** The chip text per posture — one constant per state (identity-pinned). */
export const STREAM_CONNECTED = "STREAM CONNECTED";
export const STREAM_CONNECTING = "STREAM CONNECTING";
export const STREAM_RECONNECTING = "STREAM RECONNECTING";
export const STREAM_CLOSED = "STREAM CLOSED";
export const STREAM_AWAITING_BASE = "STREAM AWAITING BASE";

/**
 * The chip for a connection that is up, has said its piece, and had no batch
 * to hand over. Distinct from `STREAM_AWAITING_BASE` (the base has NOT
 * arrived) and from the `NO SERVABLE BATCH` chip, which is the SERVICE's own
 * statement about its staleness — this one is only the absence of a payload.
 */
export const STREAM_NO_BATCH = "STREAM NO BATCH";

/**
 * The posture of the CURRENT connection — the question the old `LIVE` badge
 * pretended to answer and the CONNECTED chip actually does.
 *
 * Total over `StreamState`, so a state the client adds later cannot fall
 * through into a connected claim by default.
 */
export function ribbonStreamPosture(
  streamState: StreamState,
  hasBase: boolean,
): RibbonStreamPosture {
  switch (streamState) {
    case "open":
      // OPEN IS NOT ENOUGH. A socket the server accepted and has not spoken on
      // is a connection whose data is entirely the PREVIOUS connection's.
      return hasBase
        ? { label: STREAM_CONNECTED, tone: "accent" }
        : { label: STREAM_AWAITING_BASE, tone: "waiting" };
    case "idle":
    case "connecting":
      return { label: STREAM_CONNECTING, tone: "warn" };
    case "waiting":
      return { label: STREAM_RECONNECTING, tone: "warn" };
    case "closed":
      // The one CRIT-toned posture: the client's reconnect policy is spent, or
      // the stream was closed deliberately. Nothing further is coming.
      return { label: STREAM_CLOSED, tone: "down" };
  }
}

/**
 * The chip for an appbar with nothing to render beside it.
 *
 * A CONNECTED stream holding no batch says exactly that — `STREAM NO BATCH`,
 * in the unknown register. An accent chip alone would imply data that does
 * not exist; the old code's `AWAITING BASE` here was false (the base HAD
 * arrived, and was empty).
 */
export function ribbonEmptyPosture(
  streamState: StreamState,
  hasBase: boolean,
): RibbonStreamPosture {
  const posture = ribbonStreamPosture(streamState, hasBase);
  if (posture.label !== STREAM_CONNECTED) return posture;
  return { label: STREAM_NO_BATCH, tone: "waiting" };
}

/**
 * The Data-status popover's SWEEP entry (p1b-15, Codex round 7): one reading
 * — value and tone — derived together, pure, so the appbar cannot compose a
 * readable-looking line over fields it never validated.
 *
 * THE DEFECT THIS KILLS: PostureRibbon derived the tone as
 * `stamp.sweep.failed > 0` with no wire guard in front. `-0 > 0` is false,
 * so a failure-tally token `-1e-324` (which parses to NEGATIVE ZERO — the
 * p1b-11 class) selected the DIM, non-degraded arm while the sweep age
 * beside it stayed readable: a tally nobody could read looked like a
 * healthy sweep. The p1b-14 audit recorded this read as guarded — it
 * guarded only the AGE — and the row is struck-and-corrected this wave.
 *
 * The arms:
 *   - `failed` outside the wire population contract → the word register
 *     (`failed unreadable`, the p1b-13/14 vocabulary) in the WARN tone: an
 *     unreadable degradation tally is itself a degraded statement, and the
 *     dim arm is unreachable over it. Never a throw — this renders in the
 *     layout-level appbar, ABOVE the p1b-0 route boundary.
 *   - `failed` legal → the age reading alone, warn when failures > 0, dim
 *     otherwise (unchanged law).
 *   - the AGE keeps its p1b-14 guard: null → "age —", out-of-contract →
 *     "age unreadable", legal → "age Ns".
 */
export interface RibbonSweepReading {
  /** The entry's text, e.g. "age 41s" or "age 41s · failed unreadable". */
  readonly value: string;
  /** Maps onto the popover's as-of tones (components/Ribbon.tsx). */
  readonly tone: "warn" | "dim";
}

export function ribbonSweepReading(sweep: {
  readonly age_seconds: number | null;
  readonly failed: number;
}): RibbonSweepReading {
  const age =
    sweep.age_seconds === null
      ? "age —"
      : isWirePopulation(sweep.age_seconds)
        ? `age ${String(sweep.age_seconds)}s`
        : "age unreadable";
  if (!isWirePopulation(sweep.failed)) {
    return { value: `${age} · failed unreadable`, tone: "warn" };
  }
  return { value: age, tone: sweep.failed > 0 ? "warn" : "dim" };
}
