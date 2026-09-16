import type { Metadata } from "next";
import { Suspense } from "react";
import { LabSurface } from "./LabSurface";

export const metadata: Metadata = { title: "Scenarios" };

/** Scenarios (spec §5.4): what changes under a named shock? `useSearchParams` needs a Suspense boundary to keep the route static. */
export default function LabPage() {
  return (
    <Suspense fallback={null}>
      <LabSurface />
    </Suspense>
  );
}
