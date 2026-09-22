"use client";

import { Drawer } from "@/components/Drawer";
import { ASSUMPTIONS_LEFT_OUT, ASSUMPTIONS_TITLE, type EngineResult } from "@/lib/lab-view";
import { groupInt } from "@/lib/prose";
import type { LabRunBook } from "@/lib/runbook";
import { isWireDecimal } from "@/lib/wireGuard";
import styles from "./lab.module.css";
import { wireExact } from "./money";

type AppliedShock = LabRunBook["applied_shocks"][number];
const flags = (s: AppliedShock): string =>
  [s.snapped ? "snapped" : null, s.base_snapped ? "base snapped" : null, s.cap_bound ? "cap bound" : null].filter((f): f is string => f !== null).join(" · ");
const exact = (v: string): string => (isWireDecimal(v) ? v : `unreadable (${JSON.stringify(v)})`);

/** Path assumption, applied shocks, held-flat inputs, what the model leaves out, config, wire notes verbatim, the exact wire values: every figure the page rounds can be opened to the value the wire sent. */
export function AssumptionsDrawer({ open, onClose, run, cash }: { open: boolean; onClose: () => void; run: LabRunBook | null; cash: EngineResult | null }) {
  return (
    <Drawer open={open} onClose={onClose} title={ASSUMPTIONS_TITLE}>
      <div className={styles.method} data-testid="lab-drawer-body">
        {run === null ? (
          <p>No result is open.</p>
        ) : (
          <>
            <h3>Path assumption</h3>
            <p>{run.path_assumption}</p>
            <h3>Applied shocks</h3>
            {run.applied_shocks.length === 0 ? (
              <p>No mark moved: this scenario carries no price shock.</p>
            ) : (
              <ul>
                {run.applied_shocks.map((s) => (
                  <li key={`${s.asset}-${String(s.chain_id)}`}>
                    <code>{s.asset}</code> (chain {String(s.chain_id)}, {s.source}): <code>{exact(s.before)}</code> → <code>{exact(s.after)}</code> × {exact(s.factor_num)}/{exact(s.factor_den)}
                    {flags(s) === "" ? "" : ` · ${flags(s)}`}
                  </li>
                ))}
              </ul>
            )}
            <h3>Held flat</h3>
            {run.held_flat.length === 0 ? (
              <p>Nothing held flat.</p>
            ) : (
              <ul>
                {run.held_flat.map((h) => (
                  <li key={`${h.asset}-${String(h.chain_id)}`}>
                    <code>{h.asset}</code> (chain {String(h.chain_id)}, {h.source}) at <code>{exact(h.value)}</code>
                  </li>
                ))}
              </ul>
            )}
            <h3>{ASSUMPTIONS_LEFT_OUT}</h3>
            <ul>
              {run.out_of_model.map((o) => (
                <li key={o}>{o}</li>
              ))}
            </ul>
            <h3>Identity</h3>
            <p>
              Scenario <code>{run.scenario_id}</code> · {run.scenario_version} · config {run.scenario_config_version} · batch {groupInt(run.batch.id)} · served {run.served_at}
            </p>
            {cash !== null && (
              <>
                <h3>Exact wire values · Cash</h3>
                <p>
                  newly eligible <code>{String(cash.newly)}</code> · eligible debt <code>{wireExact(cash.eligibleDebtBefore, cash.decimals)}</code> → <code>{wireExact(cash.eligibleDebtAfter, cash.decimals)}</code> (Δ{" "}
                  <code>{wireExact(cash.deltaEligibleDebt, cash.decimals)}</code>) · bad debt <code>{wireExact(cash.badDebtBefore, cash.decimals)}</code> → <code>{wireExact(cash.badDebtAfter, cash.decimals)}</code> (Δ{" "}
                  <code>{wireExact(cash.deltaBadDebt, cash.decimals)}</code>) · lane changed <code>{cash.laneChanged === null ? "null" : String(cash.laneChanged)}</code> of <code>{String(cash.measured)}</code> measured
                </p>
                <h3>The wire on its lanes</h3>
                <p data-testid="lab-drawer-transitions-note">{cash.transitionsNote}</p>
                <p>{cash.note}</p>
              </>
            )}
            <h3>Wire notes</h3>
            <ul>
              {run.notes.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          </>
        )}
      </div>
    </Drawer>
  );
}
