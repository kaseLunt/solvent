import type { Metadata } from "next";
import { SurfacePlaceholder } from "@/components/SurfacePlaceholder";

export const metadata: Metadata = { title: "Inspector" };

export default function InspectorPage() {
  return (
    <SurfacePlaceholder
      eyebrow="2 · Inspector"
      name="Inspector"
      description={
        <>
          One position, every number defended: legs with per-leg as-ofs, price inputs with
          provenance class and freshness verdicts, the HF formula written out with its computed
          composite, the factor-level liquidation price, HF history, and the account&apos;s own
          event stream. Entry is any pasted address — found is three-valued and rendered three
          ways; <span className="mono">found: null</span> is never &quot;no position&quot;.
        </>
      }
      fedBy={
        <>
          <b>GET /v1/address/&#123;addr&#125;</b> · <b>GET /v1/address/&#123;addr&#125;/history</b>{" "}
          · <b>GET /v1/events</b> (account-filtered)
        </>
      }
      wave="W2 (adds /inspector/[addr])"
    />
  );
}
