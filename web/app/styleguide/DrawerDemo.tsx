"use client";

import { useState } from "react";
import { Drawer } from "@/components/kit";
import kit from "@/components/kit/kit.module.css";
import styles from "./styleguide.module.css";

/**
 * SPECIMEN drawer on the kit (plan 2026-09-16, R3 + R7): the header's "Methodology & evidence" ghost button opens
 * the kit Drawer, which is where every page's doctrine lives. Focus moves in on open, Tab cycles inside, Escape
 * closes and restores focus to the button.
 */
export function DrawerDemo() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className={`${kit.btn} ${kit.btnGhost}`}
        onClick={() => setOpen(true)}
        data-testid="sg-drawer-open"
      >
        Methodology &amp; evidence
      </button>
      <Drawer open={open} onClose={() => setOpen(false)} title="Methodology & evidence">
        <div data-testid="sg-drawer-body">
          <p style={{ marginTop: 0 }}>
            SPECIMEN CONTENT · on a real page this drawer carries the doctrine verbatim — the method paragraphs,
            the provenance, and the evidentiary chain: batch and materialization identity, input as-ofs, price
            inputs with provenance class and budget verdicts, flags and refusals, the engine-exact formula and
            comparator.
          </p>
          <dl className={styles.kv}>
            <dt>batch</dt>
            <dd>bk_specimen</dd>
            <dt>marks</dt>
            <dd>balances ✓ params ✓ sweep ✓</dd>
          </dl>
        </div>
      </Drawer>
    </>
  );
}
