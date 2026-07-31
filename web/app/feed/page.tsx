import type { Metadata } from "next";
import { SurfacePlaceholder } from "@/components/SurfacePlaceholder";

export const metadata: Metadata = { title: "Feed" };

export default function FeedPage() {
  return (
    <SurfacePlaceholder
      eyebrow="5 · Feed"
      name="Feed"
      description={
        <>
          Durable chain actions + live posture: borrows, repays, liquidations from reorg-aware
          custody (never invented events), each with tx hash, block, and real header time — a
          null <span className="mono">block_time</span> renders the block number, never an
          invented timestamp. Live batch ticks via SSE show CURRENT posture only; posture history
          arrives with P4&apos;s durable outbox.
        </>
      }
      fedBy={
        <>
          <b>GET /v1/events</b> (cursor-paginated) · <b>GET /v1/stream</b> (SSE, live posture)
        </>
      }
      wave="W5"
    />
  );
}
