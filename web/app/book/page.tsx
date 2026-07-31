import type { Metadata } from "next";
import { SurfacePlaceholder } from "@/components/SurfacePlaceholder";

export const metadata: Metadata = { title: "Book" };

export default function BookPage() {
  return (
    <SurfacePlaceholder
      eyebrow="1 · Book"
      name="Book"
      description={
        <>
          The whole position set, one glance: per-engine stat rows with coverage denominators,
          HF histograms on their own comparators, the liquidation waterfall, the cursor-paginated
          position table, and the risk map. Refused rows stay visible — an honest book shows what
          it refuses to price.
        </>
      }
      fedBy={
        <>
          <b>GET /v1/book</b> · <b>GET /v1/positions</b> (batch-stable cursor) · updates via{" "}
          <b>SSE event: batch</b>
        </>
      }
      wave="W1"
    />
  );
}
