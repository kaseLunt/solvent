"use client";

import Link from "next/link";
import { Drawer } from "@/components/Drawer";
import type { AddressReading } from "@/lib/address-lookup";
import { blockTimeTitle, formatBlock } from "@/lib/format";
import { isComputedCash, sourceDisplay, symbolFor } from "@/lib/inspector-position";
import { drawerEmptyText, drawerSweepBlock, HISTORY_GAP_METHOD, INSPECTOR_DRAWER_TITLE, type InspectorView } from "@/lib/inspector-view";
import { plainCause } from "@/lib/refusal-phrasebook";
import { wireExact, wirePrice } from "./money";

/** Inputs · Calculation · Provenance — the formula with this account's numbers substituted, every input's source and age, the exact wire values. */
export function InspectorDrawer({ open, onClose, view, reading }: { open: boolean; onClose: () => void; view: InspectorView; reading: AddressReading }) {
  const p = view.cashWire;
  const cash = view.cash;
  const exact = (v: string | null, decimals: number): string => wireExact(v, decimals);
  // The formula lines print every term in the exact register so the equations balance at the cents: humanUsdFull drops
  // the cents above $1,000, and a formula that does not add up explains nothing. No scale, no figure.
  const exactMoney = (v: bigint | null): string => (v === null || view.decimals === null ? "—" : wireExact(v.toString(), view.decimals));
  const batch = reading.lookup.phase === "ready" ? reading.lookup.value.response.batch : null;
  const servedAt = reading.lookup.phase === "ready" ? reading.lookup.value.response.served_at : null;
  return (
    <Drawer open={open} onClose={onClose} title={INSPECTOR_DRAWER_TITLE}>
      <div data-testid="inspector-drawer-body">
        {p === null || cash === null ? (
          <p data-testid="inspector-drawer-empty">{drawerEmptyText(view)}</p>
        ) : (
          <>
            <h3>Calculation</h3>
            <p>
              Borrow cap = Σ (collateral value × LTV) = {view.table?.legs.map((l) => `${exactMoney(l.value)} × ${l.ltv ?? "—"}`).join(" + ")} ={" "}
              <b>{exactMoney(cash.cap)}</b> (USD, exact)
            </p>
            <p>
              Room = cap − debt = {exactMoney(cash.cap)} − {exactMoney(cash.debt)} = <b>{exactMoney(cash.room)}</b> ({cash.roomPercent ?? "—"} of cap)
            </p>
            {isComputedCash(cash) ? (
              <p>
                Verdict: debt {cash.debt > cash.cap ? ">" : "≤"} cap → <b>{cash.verdict}</b> (the engine’s strict boolean, <code>debt &gt; maxBorrowLT</code>; equality is
                healthy)
              </p>
            ) : (
              <p>
                Verdict: none served — the engine served no verdict for this row (<code>debt &gt; maxBorrowLT</code> is the rule it would apply).
              </p>
            )}
            {cash.refusal !== null && (
              <p>
                Refused: {plainCause(cash.refusal.code, cash.refusal.detail ?? undefined)} · <code>{cash.refusal.code}</code>
              </p>
            )}
            <h3>Inputs</h3>
            <ul>
              {p.price_inputs.map((i) => (
                <li key={i.asset}>
                  {symbolFor(p, i.asset)} · {sourceDisplay(i.source)} (<code>{i.source}</code>) · {i.provenance} ·{" "}
                  {wirePrice(i.value, i.decimals)} ·{" "}
                  {i.age_seconds === null ? "age unknown" : `${String(i.age_seconds)}s`} · {i.verdict}
                  {i.block_number === null ? "" : ` · block ${formatBlock(i.block_number)}`}
                </li>
              ))}
            </ul>
            <p>
              As of: balances block {formatBlock(p.as_of.balances_block)} · params block {formatBlock(p.as_of.params_block)} · sweep block{" "}
              {drawerSweepBlock(p)}
            </p>
            <h3>Provenance</h3>
            <p>{HISTORY_GAP_METHOD}</p>
            {batch !== null && (
              <p>
                Batch <code>{String(batch.id)}</code> computed <code>{batch.computed_at}</code> by <code>{batch.producer}</code>; served <code>{servedAt ?? ""}</code>.
              </p>
            )}
            {reading.params.phase === "ready" ? (
              reading.params.value.length === 0 ? (
                <p>No Cash parameter changes on record.</p>
              ) : (
                <ul>
                  {reading.params.value.map((change) => (
                    <li key={`${change.tx_hash}:${String(change.effective_log_index)}`}>
                      {change.fields.map((f) => `${f.name} ${f.value ?? "—"}${f.prior === null ? "" : ` (was ${f.prior})`} ${f.unit}`).join("; ")} · effective{" "}
                      {blockTimeTitle(change.effective_block, change.block_time)} · <code>{change.source_event}</code>
                    </li>
                  ))}
                </ul>
              )
            ) : (
              <p>{reading.params.phase === "error" ? `Parameter timeline unavailable: ${reading.params.message}` : "Loading the parameter timeline…"}</p>
            )}
            <h3>Exact wire values</h3>
            <p>
              <code>borrowings</code> {exact(p.borrowings, p.value_decimals)} · <code>max_borrow_lt</code> {exact(p.max_borrow_lt, p.value_decimals)} ·{" "}
              <code>collateral_value_usd</code> {exact(p.collateral_value_usd, p.value_decimals)}
            </p>
            <ul>
              {p.legs.map((l) => (
                <li key={l.asset}>
                  <code>{l.symbol ?? l.asset}</code> amount {exact(l.amount, l.decimals)} · value_usd {exact(l.value_usd, p.value_decimals)} · max_borrow_contribution{" "}
                  {exact(l.max_borrow_contribution, p.value_decimals)}
                </li>
              ))}
            </ul>
          </>
        )}
        <p>
          Exact evidence and the reconcile receipt: <Link href="/proof">Verification</Link>. Every endpoint this page reads: <Link href="/developers">API</Link>.
        </p>
      </div>
    </Drawer>
  );
}
