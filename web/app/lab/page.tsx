import type { Metadata } from "next";
import { SurfacePlaceholder } from "@/components/SurfacePlaceholder";

export const metadata: Metadata = { title: "Scenario Lab" };

export default function LabPage() {
  return (
    <SurfacePlaceholder
      eyebrow="3 · Scenario Lab"
      name="Scenario Lab"
      description={
        <>
          Stress, priced honestly: the committed scenario set (no arbitrary sliders), address and
          book-wide runs, and the flagship oracle-blind weETH depeg — HFs bit-identical
          (<span className="mono">hfs_unchanged</span> asserted) while execution shortfall rises.
          PROJECTION badges on projected axes; <span className="mono">held_flat</span> and{" "}
          <span className="mono">out_of_model</span> lists shown, delta-only labeling throughout.
        </>
      }
      fedBy={
        <>
          <b>GET /v1/scenarios</b> · <b>POST /v1/scenarios/&#123;id&#125;/run</b> ·{" "}
          <b>POST /v1/scenarios/&#123;id&#125;/run-book</b>
        </>
      }
      wave="W3"
    />
  );
}
