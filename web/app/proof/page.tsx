import type { Metadata } from "next";
import { ProofSurface } from "./ProofSurface";

export const metadata: Metadata = { title: "Proof Center" };

/**
 * The Proof Center route (W6). All data arrives client-side through
 * lib/proof-data (the documented /v1/evidence seam) — nothing is fetched at
 * build time, so a static shell never bakes in a stale manifest.
 */
export default function ProofPage() {
  return <ProofSurface />;
}
