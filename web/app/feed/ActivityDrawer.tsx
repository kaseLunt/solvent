"use client";

import { useState } from "react";
import { Drawer } from "@/components/kit";
import kit from "@/components/kit/kit.module.css";
import styles from "./activity.module.css";

/**
 * The header's drawer button and the drawer it opens. The doctrine is the view model's, paragraph by paragraph,
 * verbatim: the intro, the list's name, the method line, the forensics note, the tail note. The dek keeps the one
 * clause the law requires visible; everything else about method lives here.
 */
export function ActivityDrawer({ doctrine }: { doctrine: readonly string[] }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className={`${kit.btn} ${kit.btnGhost}`} onClick={() => setOpen(true)} data-testid="activity-drawer">
        Methodology &amp; evidence
      </button>
      <Drawer open={open} onClose={() => setOpen(false)} title="Methodology & evidence">
        <div className={styles.method} data-testid="activity-drawer-body">
          {doctrine.map((paragraph) => (
            <p key={paragraph}>{paragraph}</p>
          ))}
        </div>
      </Drawer>
    </>
  );
}
