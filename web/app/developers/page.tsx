import type { Metadata } from "next";
import { SurfacePlaceholder } from "@/components/SurfacePlaceholder";

export const metadata: Metadata = { title: "Developers" };

export default function DevelopersPage() {
  return (
    <SurfacePlaceholder
      eyebrow="6 · Proof Center / Developers"
      name="Developers"
      description={
        <>
          The proof center: OpenAPI explorer over the committed contract, copyable curl and
          TypeScript examples, raw JSON beside every rendered view, the deploy-bound{" "}
          <span className="mono">/v1/evidence</span> manifest (service commit, schema and registry
          versions, substrate digest), reconciliation cohorts, and committed probe records —
          published by env-var name only.
        </>
      }
      fedBy={
        <>
          <b>GET /v1/evidence</b> · <b>api/openapi.yaml</b> (static render) · committed artifacts
          at build time
        </>
      }
      wave="W6"
    />
  );
}
