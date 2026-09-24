"use client";

import Link from "next/link";
import { Drawer } from "@/components/Drawer";
import { METHODOLOGY_LABEL, NO_VERDICT_METHOD } from "@/lib/book-copy";
import { asSentence } from "@/lib/book-headline";
import type { BookResponse } from "@/lib/cash-book";
import { CASH_ENGINE_MISSING, NO_BATCH_LOADED, NO_REFUSALS, withheldBookSentence, type WholeRefusal } from "@/lib/cash-refusal";
import { MATERIAL_LINE_USD, SMALL_LINE_USD } from "@/lib/materiality";
import { plainCause } from "@/lib/refusal-phrasebook";
import { readWirePopulation } from "@/lib/wireGuard";

export interface BookMethodologyProps {
  open: boolean;
  onClose: () => void;
  book: BookResponse | null;
  /**
   * The engine withheld whole, as the VIEW decided it — by the book's head, its card, or the positions endpoint. The
   * drawer never re-derives it from the book alone: it would miss the third source, and read an empty list as "None".
   */
  withheld: WholeRefusal | null;
}

/**
 * The one place the doctrine lives (spec §3.1): comparators, the materiality line, refusals and what a row with no
 * verdict means, identity, evidence links. The drawer's own body sets the prose rhythm; this adds none.
 */
export function BookMethodology({ open, onClose, book, withheld }: BookMethodologyProps) {
  const cash = book?.engines.find((e) => e.engine === "debt_manager") ?? null;
  return (
    <Drawer open={open} onClose={onClose} title={METHODOLOGY_LABEL}>
      <div data-testid="book-methodology-body">
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
        <p>{NO_VERDICT_METHOD}</p>
        {book === null ? (
          <p>{NO_BATCH_LOADED}</p>
        ) : cash === null ? (
          <p>{asSentence(CASH_ENGINE_MISSING, "")}</p>
        ) : withheld !== null ? (
          // A withheld engine's card itemises nothing it can be held to: its refusal list is never read as "None".
          <p>{withheldBookSentence(withheld)}</p>
        ) : cash.refusals.length === 0 ? (
          <p>{NO_REFUSALS}</p>
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
          <p>{NO_BATCH_LOADED}</p>
        ) : (
          <p>
            Batch <code>{String(book.batch.id)}</code> computed <code>{book.batch.computed_at}</code> by{" "}
            <code>{book.batch.producer}</code>; served <code>{book.served_at}</code>. Coverage:{" "}
            {String(readWirePopulation(book.coverage.in_book, "coverage.in_book"))} of{" "}
            {String(readWirePopulation(book.coverage.batch_positions, "coverage.batch_positions"))} positions on the wire,{" "}
            {String(readWirePopulation(book.coverage.refused_in_batch, "coverage.refused_in_batch"))} refused,{" "}
            {String(readWirePopulation(book.coverage.excluded_by_this_layer, "coverage.excluded_by_this_layer"))} excluded
            from the stress arithmetic.
          </p>
        )}
        {book !== null && book.coverage.excluded.length > 0 && (
          <ul data-testid="book-methodology-excluded">
            {book.coverage.excluded.map((e) => (
              <li key={`${e.engine}:${e.account}`}>
                <code>{e.account}</code> ({e.engine}) — {plainCause(e.code, e.reason)} · <code>{e.code}</code>
              </li>
            ))}
          </ul>
        )}
        <p>
          Exact evidence and the reconcile receipt: <Link href="/proof">Verification</Link>. Every endpoint this
          page reads: <Link href="/developers">API</Link>.
        </p>
      </div>
    </Drawer>
  );
}
