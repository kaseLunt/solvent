import type { Metadata } from "next";
import { ObservatorySurface } from "./ObservatorySurface";

export const metadata: Metadata = { title: "Observatory" };

/**
 * The Observatory route (W4). All data arrives client-side through
 * lib/observatory-data (the documented C1 seam over GET /v1/observatory/series)
 * — nothing is fetched at build time, so a static shell never bakes in a
 * stale rollup.
 */
export default function ObservatoryPage() {
  return <ObservatorySurface />;
}
