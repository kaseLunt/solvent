"use client";

import { useState } from "react";
import { Drawer } from "@/components/kit";
import kit from "@/components/kit/kit.module.css";
import styles from "./history.module.css";

/**
 * The header's drawer button and the drawer it opens (plan R3). The doctrine is the view model's, paragraph by
 * paragraph, verbatim: the intro, the chart's method notes, the source, then whatever the wire's own notes said.
 */
export function HistoryDrawer({ doctrine }: { doctrine: readonly string[] }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className={`${kit.btn} ${kit.btnGhost}`}
        onClick={() => setOpen(true)}
        data-testid="history-drawer"
      >
        Methodology &amp; evidence
      </button>
      <Drawer open={open} onClose={() => setOpen(false)} title="Methodology & evidence">
        <div className={styles.method} data-testid="history-drawer-body">
          {doctrine.map((paragraph) => (
            <p key={paragraph}>{paragraph}</p>
          ))}
        </div>
      </Drawer>
    </>
  );
}
