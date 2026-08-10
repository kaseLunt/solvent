// WAVE R7 (Codex round-15 finding 4) — THE APPBAR'S CONNECTION TEST, pinned as
// a pure function. Re-cut by p1a-4 for the canon appbar: the prize arm is a
// CHIP now, not a liveness badge.
//
// THE R7 DEFECT, still the law under test: `LIVE · WATERMARKED` was painted
// from `(batch retained && !unavailable)`. Neither half of that says anything
// about the CONNECTION. The batch is retained across a teardown deliberately —
// a reader who loses their stream must not also lose their book — so after
// `refresh()` closed the stream, a reconnect that hung or failed left a
// healthy-looking badge on screen indefinitely.
//
// Laws under test (p1a-4 shape):
//   - CONNECTED requires BOTH halves: the current connection open AND its base
//     delivered. `open` alone is a socket the server accepted and has not
//     spoken on, whose data is entirely the previous connection's.
//   - every posture has a WORD and a TONE; CONNECTED is the accent register —
//     posture, not health, never green, never a claim about the data's age.
//   - `closed` is the one crit-toned posture; connecting/reconnecting warn.
//   - a connected stream with nothing to show is STREAM NO BATCH: there are
//     no watermarks to be connected over.
//   - NO label, in any posture, contains the substring "LIVE" — the
//     retirement is structural, not stylistic.

import { expect, test } from "@playwright/test";
import type { StreamState } from "@solvent/client";
import {
  ribbonEmptyPosture,
  ribbonStreamPosture,
  STREAM_AWAITING_BASE,
  STREAM_CLOSED,
  STREAM_CONNECTED,
  STREAM_CONNECTING,
  STREAM_NO_BATCH,
  STREAM_RECONNECTING,
} from "../../lib/stream-posture";

/** Every state the client's machinery can be in (packages/client-ts/src/sse.ts). */
const EVERY_STATE: readonly StreamState[] = ["idle", "connecting", "open", "waiting", "closed"];

test.describe("ribbonStreamPosture — CONNECTED is a claim about THIS connection", () => {
  test("EXACTLY ONE (state, hasBase) pair is CONNECTED: open, with its base delivered", () => {
    const connected: string[] = [];
    for (const state of EVERY_STATE) {
      for (const hasBase of [true, false]) {
        if (ribbonStreamPosture(state, hasBase).label === STREAM_CONNECTED) {
          connected.push(`${state}/${String(hasBase)}`);
        }
      }
    }
    expect(connected).toEqual(["open/true"]);
  });

  test("OPEN IS NOT ENOUGH — a socket that has not delivered its base is AWAITING BASE", () => {
    // This is the half the R7 finding turns on. `hasBase` is reset by the
    // provider on every state change away from `open`, so a fresh connection
    // cannot borrow the previous one's snapshot as proof of its own health.
    expect(ribbonStreamPosture("open", false)).toEqual({
      label: STREAM_AWAITING_BASE,
      tone: "waiting",
    });
  });

  test("the CONNECTED chip is the accent register — posture, not health", () => {
    expect(ribbonStreamPosture("open", true)).toEqual({
      label: STREAM_CONNECTED,
      tone: "accent",
    });
  });

  test("every impaired state names itself, in its own register", () => {
    expect(ribbonStreamPosture("idle", false)).toEqual({
      label: STREAM_CONNECTING,
      tone: "warn",
    });
    expect(ribbonStreamPosture("connecting", false)).toEqual({
      label: STREAM_CONNECTING,
      tone: "warn",
    });
    expect(ribbonStreamPosture("waiting", false)).toEqual({
      label: STREAM_RECONNECTING,
      tone: "warn",
    });
    // The one CRIT tone: the reconnect policy is spent or the stream was closed
    // deliberately. Nothing further is coming, and that is a louder fact.
    expect(ribbonStreamPosture("closed", false)).toEqual({
      label: STREAM_CLOSED,
      tone: "down",
    });
  });

  test("a RETAINED base cannot resurrect a dead connection", () => {
    // The precise shape of the R7 defect: hasBase true (the last connection
    // really did deliver a snapshot) over a state that is not open. Every one
    // of these must refuse the CONNECTED claim — and none may say LIVE.
    for (const state of ["idle", "connecting", "waiting", "closed"] as const) {
      const posture = ribbonStreamPosture(state, true);
      expect(posture.label, state).not.toBe(STREAM_CONNECTED);
      expect(posture.label, state).not.toContain("LIVE");
    }
  });
});

test.describe("ribbonEmptyPosture — an appbar with nothing beside it", () => {
  test("a CONNECTED stream holding no batch says so — it is not a health claim", () => {
    // There are no watermarks. An accent chip over an empty bar would imply
    // data that does not exist. The pre-R7 code rendered AWAITING BASE here,
    // which was false: the base HAD arrived and was empty.
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
      tone: "warn",
    });
    expect(ribbonEmptyPosture("waiting", false)).toEqual({
      label: STREAM_RECONNECTING,
      tone: "warn",
    });
    expect(ribbonEmptyPosture("closed", false)).toEqual({ label: STREAM_CLOSED, tone: "down" });
  });

  test("NO posture, connected or not, ever produces a label containing LIVE", () => {
    for (const state of EVERY_STATE) {
      for (const hasBase of [true, false]) {
        expect(ribbonEmptyPosture(state, hasBase).label, `${state}/${String(hasBase)}`).not.toContain(
          "LIVE",
        );
        expect(ribbonStreamPosture(state, hasBase).label, `${state}/${String(hasBase)}`).not.toContain(
          "LIVE",
        );
      }
    }
  });
});
