"use client";

import { useState } from "react";
import { Drawer } from "@/components/kit";
import kit from "@/components/kit/kit.module.css";

/**
 * The header's drawer button and the drawer it opens — the page's one client island. The doctrine is the view
 * model's, paragraph by paragraph, verbatim, in the drawer's own prose rhythm. A paragraph is keyed by its place,
 * never by its text: two paragraphs may say the same words. The page around it stays a server component and hands
 * the island its words, so the contract extract the view model reads never ships to the browser.
 */
export function ApiDrawer({ label, doctrine }: { label: string; doctrine: readonly string[] }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className={`${kit.btn} ${kit.btnGhost}`} onClick={() => setOpen(true)} data-testid="api-drawer">
        {label}
      </button>
      <Drawer open={open} onClose={() => setOpen(false)} title={label}>
        <div data-testid="api-drawer-body">
          {doctrine.map((paragraph, index) => (
            <p key={String(index)}>{paragraph}</p>
          ))}
        </div>
      </Drawer>
    </>
  );
}
