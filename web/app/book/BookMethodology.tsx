"use client";

import Link from "next/link";
import { Drawer } from "@/components/Drawer";
import type { BookResponse } from "@/lib/cash-book";
import { MATERIAL_LINE_USD, SMALL_LINE_USD } from "@/lib/materiality";
import { plainCause } from "@/lib/refusal-phrasebook";
import styles from "./book.module.css";

export interface BookMethodologyProps {
  open: boolean;
  onClose: () => void;
  book: BookResponse | null;
}

/** The one place the doctrine lives (spec §3.1): comparators, the materiality line, refusals, identity, evidence links. */
export function BookMethodology({ open, onClose, book }: BookMethodologyProps) {
  const cash = book?.engines.find((e) => e.engine === "debt_manager") ?? null;
  return (
    <Drawer open={open} onClose={onClose} title="Methodology & evidence">
      <div className={styles.method} data-testid="book-methodology-body">
        <h3>Engines</h3>
        <p>
          <b>Cash</b> is the Debt Manager engine (<code>debt_manager</code>, OP Mainnet). An account is liquidatable
          when its borrowings exceed its borrow cap — the strict rule <code>debt &gt; maxBorrowLT</code>. Room is{" "}
          <code>cap − debt</code>. Values are USD at {String(cash?.value_decimals ?? 6)} decimals.
        </p>
        <p>
          The <b>Aave v3 market (legacy)</b> is <code>aave_v3_etherfi</code> on Ethereum, judged by its own health
          factor. The two books are never added together.
        </p>
        <h3>Materiality</h3>
        <p>
          Headlines and default views read at <b>${MATERIAL_LINE_USD.toString()}</b> of liquidatable debt per
          account. Small is ${SMALL_LINE_USD.toString()}–${MATERIAL_LINE_USD.toString()}; dust is under $
          {SMALL_LINE_USD.toString()}. Every count and sum exists in full; the line only decides what leads.
          Sub-cent values print as <code>&lt;$0.01</code>.
        </p>
        <h3>Refusals on this batch</h3>
        {cash === null ? (
          <p>No Cash engine on this batch.</p>
        ) : cash.refusals.length === 0 ? (
          <p>None.</p>
        ) : (
          <ul>
            {cash.refusals.map((r) => (
              <li key={r.key}>
                {plainCause(r.key)} — <code>{r.key}</code> × {String(r.count)}
              </li>
            ))}
          </ul>
        )}
        <h3>Identity</h3>
        {book === null ? (
          <p>No batch loaded.</p>
        ) : (
          <p>
            Batch <code>{String(book.batch.id)}</code> computed <code>{book.batch.computed_at}</code> by{" "}
            <code>{book.batch.producer}</code>; served <code>{book.served_at}</code>. Coverage:{" "}
            {String(book.coverage.in_book)} of {String(book.coverage.batch_positions)} positions on the wire,{" "}
            {String(book.coverage.refused_in_batch)} refused.
          </p>
        )}
        <p>
          Exact evidence and the reconcile receipt: <Link href="/proof">Verification</Link>. Every endpoint this
          page reads: <Link href="/developers">API</Link>.
        </p>
      </div>
    </Drawer>
  );
}
