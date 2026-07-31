"use client";

import { useState } from "react";
import { Drawer } from "@/components/Drawer";
import { Stampline, StampItem } from "@/components/Stampline";
import buttonStyles from "@/components/table.module.css";

/** SPECIMEN drawer trigger for the styleguide. */
export function DrawerDemo() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className={buttonStyles.loadMore} onClick={() => setOpen(true)}>
        OPEN EXPLAIN-THIS-NUMBER DRAWER
      </button>
      <Drawer open={open} onClose={() => setOpen(false)} title="EXPLAIN · SPECIMEN NUMBER">
        <p style={{ marginTop: 0 }}>
          SPECIMEN CONTENT — in a real surface this drawer carries the evidentiary chain: batch +
          materialization identity, input as-ofs, price inputs with provenance class and budget
          verdicts, flags/refusals, the engine-exact formula and comparator.
        </p>
        <Stampline>
          <StampItem label="batch" value="bk_specimen" />
          <StampItem label="marks" value="balances ✓ params ✓ sweep ✓" tone="ok" />
        </Stampline>
      </Drawer>
    </>
  );
}
