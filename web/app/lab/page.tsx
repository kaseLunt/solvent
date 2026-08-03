import type { Metadata } from "next";
import { LabClient } from "./LabClient";
import styles from "./lab.module.css";

export const metadata: Metadata = { title: "Scenario Lab" };

/**
 * W3 — Scenario Lab (spec §3.3): stress, priced honestly.
 *
 * W-SD-A: the WHOLE BOOK is the default and arrives alive with zero runs — the
 * committed listing served cold, the loss frontier drawn from `/v1/book`'s
 * waterfall, and the scenario × engine matrix whose cells distinguish a
 * scenario that never modelled an engine from an engine that refused. Address
 * mode is the secondary register.
 */
export default function LabPage() {
  return (
    <section>
      {/* Wave R1 items 6 + 10: no numbered eyebrow; the adjudicated intro; the
          endpoint provenance demoted to the page bottom. */}
      <div className={styles.head}>
        <h1>Scenario Lab</h1>
        <p>
          What would break this book: the committed stress scenarios — fixed, versioned shocks,
          no sliders — run against the whole book, or against one address. Every shocked number
          is labeled a projection; the flagship weETH depeg shows a real loss the
          protocol&apos;s own oracles never see.
        </p>
      </div>
      <LabClient />
      <p className={styles.fedByFoot}>
        fed by <b>GET /v1/scenarios</b> · <b>GET /v1/book</b> ·{" "}
        <b>POST /v1/scenarios/&#123;id&#125;/run-book</b> ·{" "}
        <b>GET /v1/address/&#123;addr&#125;/stress</b>
      </p>
    </section>
  );
}
