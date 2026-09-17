import type { Metadata } from "next";
import { ActivitySurface } from "./ActivitySurface";

export const metadata: Metadata = { title: "Activity" };

/**
 * Activity: chain actions as recorded, beside the stream's posture now. All data arrives client-side — history
 * through lib/feed-data (the /v1/events seam under the ordering and unit laws), live posture through the global SSE
 * provider — so a static shell never bakes in a stale page.
 */
export default function ActivityPage() {
  return <ActivitySurface />;
}
