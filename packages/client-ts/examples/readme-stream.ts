// Compiled README example — the event-stream block.
//
// The code between the readme-block markers must appear VERBATIM (modulo
// trailing whitespace) as a ```ts fence in README.md; test/readme-sync.test.ts
// enforces the equality in both directions, and this file is in the typecheck,
// so the documented code cannot drift from the real public surface.
//
// Executable-shaped, never executed: the entry point is a declared function,
// nothing calls it, and no test imports this file — it is compiled only.

import { SolventClient } from "@solvent/client";
import type { StreamPayload } from "@solvent/client";

const client = new SolventClient({ baseUrl: "http://localhost:8080" });

function resetView(): void {}
function noteRecovery(): void {}
function noteHeartbeat(unixSeconds: number | null): void {
  void unixSeconds;
}
function render(payload: StreamPayload): void {
  void payload;
}
function showTransitions(transitions: readonly unknown[]): void {
  void transitions;
}
function showOutage(reason: string | undefined, staleSinceSeconds: number | undefined): void {
  void reason;
  void staleSinceSeconds;
}

// <readme-block>
import { fetchEventSource } from "@solvent/client";

function watchBook(): () => void {
  const stream = client.stream({
    eventSourceFactory: fetchEventSource(),   // see the heartbeat note below
    heartbeatTimeoutMs: 45_000,
    baseFrameTimeoutMs: 45_000,               // the default follows heartbeatTimeoutMs; see below
    reconnect: { minDelayMs: 500, maxDelayMs: 30_000, jitter: 0.5 },

    onSnapshot: (payload, e) => {
      // Sent on EVERY connection, including a reconnect, before any tick.
      if (e.isReconnect === true) resetView();  // never merge a fresh snapshot into stale state
      if (e.recovered === true) noteRecovery(); // the server's explicit stale-to-current transition
      render(payload);
    },
    onBatch: (payload) => render(payload),      // "a new batch at watermark vector V" — never "a new block"
    onDegradation: (payload) => showTransitions(payload.transitions ?? []),
    onUnavailable: (payload) => showOutage(payload.reason, payload.stale_since_seconds),
    onHeartbeat: (unix) => noteHeartbeat(unix),
    onError: (error) => console.warn(error.name, error.message),
  });

  return () => stream.close();                  // tear down when the view goes away
}
// </readme-block>

void watchBook;
