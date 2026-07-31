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
      <div className={styles.head}>
        <p className="eyebrow">3 · Scenario Lab</p>
        <h1>Scenario Lab</h1>
        <p>
          Stress, priced honestly. The committed scenario set — no arbitrary sliders — applied
          to one address or to the whole book, with every shock an exact rational, every
          projection labeled a projection, every held-flat price named, and the oracle-blind
          weETH depeg shown as what it is: health factors bit-identical while the market
          realizes a shortfall the protocol is not seeing.
        </p>
        <p className={styles.fedBy}>
          fed by <b>GET /v1/address/&#123;addr&#125;/stress</b> ·{" "}
          <b>POST /v1/scenarios/&#123;id&#125;/run-book</b>
        </p>
      </div>
      <LabClient />
    </section>
  );
}
