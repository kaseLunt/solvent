// THE RIBBON'S STREAM-POSTURE VOCABULARY (Wave R7, Codex round-15 finding 4).
//
// THE DEFECT THIS FIXES: `PostureRibbon` painted `LIVE · WATERMARKED` from
// `(batch retained && !unavailable)` alone. Neither half of that test says
// anything about the CONNECTION. A batch is retained across a teardown — it
// must be, because throwing the reader's data away is not honesty — so after
// `refresh()` closed the stream, a reconnect that hung or failed left LIVE
// painted over a dead connection for as long as the tab stayed open. The
// repair R6 added for a blind resume is itself a teardown, which means the very
// path that exists to restore truth was the one most likely to leave a false
// LIVE on screen.
//
// LIVE IS A CLAIM ABOUT THE CURRENT CONNECTION, and it needs both halves of the
// evidence the provider already carries:
//
//   · `streamState === "open"` — this connection is up RIGHT NOW. Anything
//     else ("idle", "connecting", "waiting", "closed") is a connection that is
//     not carrying data.
//   · `hasBase` — and it has delivered its base frame. The client resets this
//     on every state change away from `open` (lib/posture.tsx), so an accepted
//     socket that has not yet said anything cannot borrow the previous
//     connection's snapshot as proof of its own liveness.
//
// The words below are NOT new. They are the vocabulary the ribbon already used
// on its no-batch path, lifted out unchanged so that the SAME sentence serves
// both cases: a stream with nothing to show, and a stream that is down while
// the reader still holds the last batch it delivered. Reusing them is the whole
// point — a second register for "not live but has data" would be a third thing
// for a reader to learn about a state they already know how to read.

import type { StreamState } from "@solvent/client";

/** How the ribbon's badge is toned when it is NOT claiming liveness. */
export type RibbonPostureTone = "waiting" | "down";

/**
 * What the ribbon's badge says about the stream. A discriminated union rather
 * than a label plus a boolean, so `LIVE · WATERMARKED` is UNREPRESENTABLE
 * without an explicit `live: true` — the component can no longer paint it as a
 * side effect of having data.
 */
export type RibbonStreamPosture =
  | { readonly live: true }
  | { readonly live: false; readonly label: string; readonly tone: RibbonPostureTone };

/** The badge text a non-live posture carries — one constant per state. */
export const STREAM_CONNECTING = "STREAM · CONNECTING";
export const STREAM_RECONNECTING = "STREAM · RECONNECTING";
export const STREAM_CLOSED = "STREAM · CLOSED";
export const STREAM_AWAITING_BASE = "STREAM · AWAITING BASE";

/**
 * The badge for a connection that is up, has said its piece, and had no batch
 * to hand over. Distinct from `STREAM_AWAITING_BASE`, which the old code
 * rendered here and which was not true: the base HAD arrived. It is also
 * distinct from the `NO SERVABLE BATCH` badge, which is the SERVICE's own
 * statement about its staleness — this one is only the absence of a payload.
 */
export const STREAM_NO_BATCH = "STREAM · NO BATCH";

/**
 * The posture of the CURRENT connection — the one question `LIVE` answers.
 *
 * Total over `StreamState`, so a state the client adds later cannot fall
 * through into a liveness claim by default.
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
        ? { live: true }
        : { live: false, label: STREAM_AWAITING_BASE, tone: "waiting" };
    case "idle":
    case "connecting":
      return { live: false, label: STREAM_CONNECTING, tone: "waiting" };
    case "waiting":
      return { live: false, label: STREAM_RECONNECTING, tone: "waiting" };
    case "closed":
      // The one CRIT-toned posture: the client's reconnect policy is spent, or
      // the stream was closed deliberately. Nothing further is coming.
      return { live: false, label: STREAM_CLOSED, tone: "down" };
  }
}

/** The badge when the ribbon has NO batch and NO unavailability statement. */
export interface RibbonEmptyPosture {
  readonly label: string;
  readonly tone: RibbonPostureTone;
}

/**
 * The badge for a ribbon with nothing to render beside it.
 *
 * A LIVE connection with no batch is not `LIVE · WATERMARKED`: there are no
 * watermarks, and a green chip over an empty ribbon is a liveness claim about
 * data that does not exist. It says what it is — connected, and holding
 * nothing.
 */
export function ribbonEmptyPosture(
  streamState: StreamState,
  hasBase: boolean,
): RibbonEmptyPosture {
  const posture = ribbonStreamPosture(streamState, hasBase);
  if (!posture.live) return { label: posture.label, tone: posture.tone };
  return { label: STREAM_NO_BATCH, tone: "waiting" };
}
