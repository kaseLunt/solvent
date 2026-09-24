"use client";

import { useState } from "react";
import { Drawer } from "@/components/kit";
import kit from "@/components/kit/kit.module.css";
import { HISTORY_COPY } from "@/lib/history-view";

/**
 * The header's drawer button and the drawer it opens. The doctrine is the view model's, paragraph by paragraph,
 * verbatim, in the drawer's own prose rhythm: the intro, the chart's method notes, the source, the stride's sentence,
 * then whatever the wire's own notes said. A paragraph is keyed by its place: the wire may repeat a note, and a
 * repeated note is still a paragraph.
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
        {HISTORY_COPY.drawer}
      </button>
      <Drawer open={open} onClose={() => setOpen(false)} title={HISTORY_COPY.drawer}>
        <div data-testid="history-drawer-body">
          {doctrine.map((paragraph, index) => (
            <p key={index}>{paragraph}</p>
          ))}
        </div>
      </Drawer>
    </>
  );
}
