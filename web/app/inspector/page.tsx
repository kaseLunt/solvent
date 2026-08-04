import type { Metadata } from "next";
import { AddressEntry } from "./AddressEntry";
import styles from "./inspector.module.css";

export const metadata: Metadata = { title: "Inspector" };

/**
 * The Inspector landing (spec §3.2): strict address entry. The surface for a
 * looked-up address lives at /inspector/[addr], where `found` is three-valued
 * and rendered three ways — `found: null` is never "no position".
 *
 * Wave R1 items 6 + 10: the numbered eyebrow is gone, the intro is the
 * adjudicated copy (what the reader can DO here, not what the page contains),
 * and the "fed by GET /v1/…" provenance line is demoted below the fold — an
 * endpoint list is not an opening sentence.
 */
export default function InspectorPage() {
  return (
    <section>
      <div>
        <h1>Inspector</h1>
        <p>
          Look up one address: its current position, the price inputs behind it, its distance to
          liquidation, and its history across batches. Anything the service cannot defend renders
          as a named refusal, never a guess.
        </p>
      </div>
      <AddressEntry />
      <p className={styles.fedByFoot}>
        fed by <b>GET /v1/address/&#123;addr&#125;</b> ·{" "}
        <b>GET /v1/address/&#123;addr&#125;/history</b> · <b>GET /v1/events</b>{" "}
        (account-filtered) · <b>GET /v1/params</b> (provenance)
      </p>
    </section>
  );
}
