import type { Metadata } from "next";
import { VerificationSurface } from "./VerificationSurface";

export const metadata: Metadata = { title: "Verification" };

/**
 * Verification (spec §5.5): what this deployment is, exactly — the pinned proof
 * and the live batch. Every figure arrives client-side (lib/proof-data for the
 * manifest; the Overview's meta and book readers for the architecture steps),
 * so a static shell never bakes in a stale manifest.
 */
export default function ProofPage() {
  return <VerificationSurface />;
}
