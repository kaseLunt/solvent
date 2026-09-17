import type { Metadata } from "next";
import { HistorySurface } from "./HistorySurface";

export const metadata: Metadata = { title: "History" };

/**
 * History: how each engine's book has moved, hour by hour, in a record that outlives batch retention. All data
 * arrives client-side through lib/observatory-data (the documented seam over GET /v1/observatory/series) — nothing
 * is fetched at build time, so a static shell never bakes in a stale rollup.
 */
export default function HistoryPage() {
  return <HistorySurface />;
}
