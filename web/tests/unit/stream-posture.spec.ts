// WAVE R7 (Codex round-15 finding 4) — THE RIBBON'S LIVENESS TEST, pinned as a
// pure function.
//
// THE DEFECT: `LIVE · WATERMARKED` was painted from `(batch retained &&
// !unavailable)`. Neither half of that says anything about the CONNECTION. The
// batch is retained across a teardown deliberately — a reader who loses their
// stream must not also lose their book — so after `refresh()` closed the
// stream, a reconnect that hung or failed left LIVE on screen indefinitely.
// Worse, `refresh()` is R6's repair for a blind resume, which means the very
// path that exists to restore truth was the likeliest producer of a false LIVE.
//
// Laws under test:
//   - LIVE requires BOTH halves: the current connection open AND its base
//     delivered. `open` alone is a socket the server accepted and has not
//     spoken on, whose data is entirely the previous connection's.
//   - every non-live state has a WORD, and the words are the ones the ribbon
//     already used on its no-batch path — reused, not invented.
//   - `closed` is the one crit-toned posture; everything else waits.
//   - a live connection with nothing to show is NOT `LIVE · WATERMARKED`:
//     there are no watermarks to be live over.

import { expect, test } from "@playwright/test";
import type { StreamState } from "@solvent/client";
import {
  ribbonEmptyPosture,
  ribbonStreamPosture,
  STREAM_AWAITING_BASE,
  STREAM_CLOSED,
  STREAM_CONNECTING,
  STREAM_NO_BATCH,
  STREAM_RECONNECTING,
} from "../../lib/stream-posture";

/** Every state the client's machinery can be in (packages/client-ts/src/sse.ts). */
const EVERY_STATE: readonly StreamState[] = ["idle", "connecting", "open", "waiting", "closed"];

test.describe("ribbonStreamPosture — LIVE is a claim about THIS connection", () => {
  test("EXACTLY ONE (state, hasBase) pair is live: open, with its base delivered", () => {
    const live: string[] = [];
    for (const state of EVERY_STATE) {
      for (const hasBase of [true, false]) {
        if (ribbonStreamPosture(state, hasBase).live) live.push(`${state}/${String(hasBase)}`);
      }
    }
    expect(live).toEqual(["open/true"]);
  });

  test("OPEN IS NOT ENOUGH — a socket that has not delivered its base is AWAITING BASE", () => {
    // This is the half the finding turns on. `hasBase` is reset by the provider
    // on every state change away from `open`, so a fresh connection cannot
    // borrow the previous one's snapshot as proof of its own liveness.
    expect(ribbonStreamPosture("open", false)).toEqual({
      live: false,
      label: STREAM_AWAITING_BASE,
      tone: "waiting",
    });
  });

  test("every non-live state names itself, in the ribbon's own existing vocabulary", () => {
    expect(ribbonStreamPosture("idle", false)).toEqual({
      live: false,
      label: STREAM_CONNECTING,
      tone: "waiting",
    });
    expect(ribbonStreamPosture("connecting", false)).toEqual({
      live: false,
      label: STREAM_CONNECTING,
      tone: "waiting",
    });
    expect(ribbonStreamPosture("waiting", false)).toEqual({
      live: false,
      label: STREAM_RECONNECTING,
      tone: "waiting",
    });
    // The one CRIT tone: the reconnect policy is spent or the stream was closed
    // deliberately. Nothing further is coming, and that is a louder fact.
    expect(ribbonStreamPosture("closed", false)).toEqual({
      live: false,
      label: STREAM_CLOSED,
      tone: "down",
    });
  });

  test("a RETAINED base cannot resurrect a dead connection", () => {
    // The precise shape of the defect: hasBase true (the last connection really
    // did deliver a snapshot) over a state that is not open. Every one of these
    // must refuse to claim liveness.
    for (const state of ["idle", "connecting", "waiting", "closed"] as const) {
      const posture = ribbonStreamPosture(state, true);
      expect(posture.live, state).toBe(false);
      expect(posture.live ? "" : posture.label, state).not.toContain("LIVE");
    }
  });
});

test.describe("ribbonEmptyPosture — a ribbon with nothing beside it", () => {
  test("a LIVE connection holding no batch says so — it is not LIVE · WATERMARKED", () => {
    // There are no watermarks. A green chip over an empty ribbon would be a
    // liveness claim about data that does not exist. The old code rendered
    // AWAITING BASE here, which was false: the base HAD arrived and was empty.
    expect(ribbonEmptyPosture("open", true)).toEqual({ label: STREAM_NO_BATCH, tone: "waiting" });
    expect(STREAM_NO_BATCH).not.toContain("LIVE");
  });

  test("every other state falls through to the connection's own word", () => {
    expect(ribbonEmptyPosture("open", false)).toEqual({
      label: STREAM_AWAITING_BASE,
      tone: "waiting",
    });
    expect(ribbonEmptyPosture("connecting", false)).toEqual({
      label: STREAM_CONNECTING,
      tone: "waiting",
    });
    expect(ribbonEmptyPosture("waiting", false)).toEqual({
      label: STREAM_RECONNECTING,
      tone: "waiting",
    });
    expect(ribbonEmptyPosture("closed", false)).toEqual({ label: STREAM_CLOSED, tone: "down" });
  });

  test("NO posture, live or not, ever produces a label containing LIVE", () => {
    for (const state of EVERY_STATE) {
      for (const hasBase of [true, false]) {
        expect(ribbonEmptyPosture(state, hasBase).label, `${state}/${String(hasBase)}`).not.toContain(
          "LIVE",
        );
      }
    }
  });
});
