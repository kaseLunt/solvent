import type { Metadata } from "next";
import { AddressEntry } from "./AddressEntry";

export const metadata: Metadata = { title: "Inspector" };

/**
 * The Inspector landing (spec §3.2): strict address entry. The surface for a
 * looked-up address lives at /inspector/[addr], where `found` is three-valued
 * and rendered three ways — `found: null` is never "no position".
 */
export default function InspectorPage() {
  return (
    <section>
      <div>
        <p className="eyebrow">2 · Inspector</p>
        <h1>Inspector</h1>
        <p>
          One position, every number defended: legs with per-leg as-ofs, price inputs with
          provenance class and freshness verdicts, the engine-exact law written out with this
          position&apos;s numbers, the factor-level liquidation price, HF history across retained
          batches, and the account&apos;s own chain actions. Every number opens its evidentiary
          chain.
        </p>
        <p className="mono dim">
          fed by <b>GET /v1/address/&#123;addr&#125;</b> ·{" "}
          <b>GET /v1/address/&#123;addr&#125;/history</b> · <b>GET /v1/events</b>{" "}
          (account-filtered) · <b>GET /v1/params</b> (provenance)
        </p>
      </div>
      <AddressEntry />
    </section>
  );
}
