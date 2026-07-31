import type { Metadata } from "next";
import { FeedSurface } from "./FeedSurface";

export const metadata: Metadata = { title: "Feed" };

/**
 * The Feed route (W5). All data arrives client-side — history through
 * lib/feed-data (the /v1/events seam under the AMENDMENT-1 ordering and
 * unit laws), live posture through the global SSE provider — so a static
 * shell never bakes in a stale page.
 */
export default function FeedPage() {
  return <FeedSurface />;
}
