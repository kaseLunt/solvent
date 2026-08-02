import type { Metadata } from "next";
import { LabClient } from "./LabClient";
import styles from "./lab.module.css";

export const metadata: Metadata = { title: "Scenario Lab" };

/**
 * W3 — Scenario Lab (spec §3.3): stress, priced honestly.
 *
 * The committed scenario set rendered deliberately (from the wire, never a
 * hardcoded list), address-level runs today, book-wide runs the moment the
 * deployment serves them, and the flagship oracle-blind weETH depeg as a
 * two-panel contrast: HFs bit-identical on the left, execution shortfall on
 * the right. Projections are projections; refusals and held-flat lists render
 * as first-class UI.
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
          no sliders — run against one address or the whole book. Every shocked number is labeled
          a projection; the flagship weETH depeg shows a real loss the protocol&apos;s own oracles
          never see.
        </p>
      </div>
      <LabClient />
      <p className={styles.fedByFoot}>
        fed by <b>GET /v1/address/&#123;addr&#125;/stress</b> ·{" "}
        <b>POST /v1/scenarios/&#123;id&#125;/run-book</b>
      </p>
    </section>
  );
}
