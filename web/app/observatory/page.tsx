import type { Metadata } from "next";
import { SurfacePlaceholder } from "@/components/SurfacePlaceholder";

export const metadata: Metadata = { title: "Observatory" };

export default function ObservatoryPage() {
  return (
    <SurfacePlaceholder
      eyebrow="4 · Observatory"
      name="Observatory"
      description={
        <>
          Migration change-control, not a stress lab: durable per-engine series, the parameter
          timeline with tx-level provenance and blast-radius annotation, and the V4 readiness
          panel — which reports the proposal, never a simulation of contracts that do not exist
          yet. Degrades honestly to a single-engine deep-dive.
        </>
      }
      fedBy={
        <>
          <b>GET /v1/observatory/series</b> · <b>GET /v1/params</b> · <b>GET /v1/observatory</b>
        </>
      }
      wave="W4"
    />
  );
}
