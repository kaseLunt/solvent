"use client";

import { useState } from "react";
import { Drawer } from "@/components/Drawer";
import kit from "@/components/kit/kit.module.css";
import styles from "./api.module.css";

/**
 * The header's drawer button and the drawer it opens — the page's one client island. The doctrine is the view
 * model's, paragraph by paragraph, verbatim: the intro, the base-URL note, the provenance. The page around it
 * stays a server component.
 */
export function ApiDrawer({ doctrine }: { doctrine: readonly string[] }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className={`${kit.btn} ${kit.btnGhost}`} onClick={() => setOpen(true)} data-testid="api-drawer">
        Methodology &amp; evidence
      </button>
      <Drawer open={open} onClose={() => setOpen(false)} title="Methodology & evidence">
        <div className={styles.method} data-testid="api-drawer-body">
          {doctrine.map((paragraph) => (
            <p key={paragraph}>{paragraph}</p>
          ))}
        </div>
      </Drawer>
    </>
  );
}
