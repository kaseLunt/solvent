"use client";

import type { components } from "@solvent/client";
import { useEffect, useState } from "react";
import { KitTable, SectionHead, VerdictHeader, type KitRow } from "@/components/kit";
import kit from "@/components/kit/kit.module.css";
import { getSolventClient, solventBaseUrl } from "@/lib/api";
import { useCashBook } from "@/lib/cash-book";
import { deriveCashView } from "@/lib/cash-view";
import type { EvidenceDescriptor } from "@/lib/evidence";
import { useMetaConstants } from "@/lib/meta";
import { fetchEvidence, ProofFetchError } from "@/lib/proof-data";
import {
  deriveVerificationView,
  PROBE_COLUMNS,
  PROBES_EMPTY,
  probesSummary,
  type EvidenceState,
} from "@/lib/verification-view";
import styles from "./verification.module.css";
import { VerificationArchitecture } from "./VerificationArchitecture";
import { VerificationDrawer } from "./VerificationDrawer";
import { VerificationSubjects } from "./VerificationSubjects";

type Schemas = components["schemas"];

/** The one /v1/meta ask the Overview also makes: its answer or null, and whether it has settled — a tile is pending, never refused, until it has. */
interface MetaAsk {
  readonly settled: boolean;
  readonly value: Schemas["MetaResponse"] | null;
}

/** What the drawer shows: the doctrine alone (the header's button), or a subject's evidence chain above it (a card's explain). */
interface DrawerState {
  readonly open: boolean;
  readonly descriptor: EvidenceDescriptor | null;
}

const CLOSED: DrawerState = { open: false, descriptor: null };

/**
 * Verification: the verdict header, the architecture strip the Overview shares,
 * the two subjects, the committed probe records, the raw wire body. The manifest
 * is fetched through lib/proof-data; the steps' live numbers come from the meta
 * and book readers the Overview uses, so both pages print one derivation.
 */
export function VerificationSurface() {
  const [state, setState] = useState<EvidenceState>({ phase: "loading" });
  const [meta, setMeta] = useState<MetaAsk>({ settled: false, value: null });
  const reading = useCashBook();
  const metaConstants = useMetaConstants();
  const [drawer, setDrawer] = useState<DrawerState>(CLOSED);
  const [showRaw, setShowRaw] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    fetchEvidence(solventBaseUrl(), controller.signal)
      .then((manifest) => {
        setState({ phase: "ok", manifest });
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return;
        if (cause instanceof ProofFetchError) {
          setState({ phase: "error", message: cause.message, retryAfterSeconds: cause.retryAfterSeconds });
          return;
        }
        setState({
          phase: "error",
          message: cause instanceof Error ? cause.message : String(cause),
          retryAfterSeconds: null,
        });
      });
    getSolventClient()
      .meta(controller.signal)
      .then(
        (value) => {
          if (!controller.signal.aborted) setMeta({ settled: true, value });
        },
        () => {
          if (!controller.signal.aborted) setMeta({ settled: true, value: null });
        },
      );
    return () => {
      controller.abort();
    };
  }, []);

  const cash = deriveCashView(reading, metaConstants.constants);
  const view = deriveVerificationView({ state, meta: meta.value, book: reading.book, cashAccounts: cash.positions });
  const manifest = state.phase === "ok" ? state.manifest : null;
  const probeRows: KitRow[] = view.probes.map((row, index) => ({
    key: row.key,
    dim: row.dim,
    testId: `verification-probe-${String(index)}`,
    cells: {
      path: <span className={styles.mono}>{row.cells.path}</span>,
      note: <span className={styles.wrap}>{row.cells.note}</span>,
    },
  }));

  return (
    <div
      className={styles.page}
      data-testid="verification-surface"
      data-state={view.state}
      data-receipt={view.receipt}
      aria-busy={view.state === "loading" ? "true" : undefined}
    >
      <VerdictHeader
        testId="verification-verdict"
        kicker={view.kicker}
        emphasis={view.headline.emphasis}
        rest={view.headline.rest}
        tone={view.headline.tone}
        dek={view.headline.dek}
        chips={view.chips}
        actions={
          <button
            type="button"
            className={`${kit.btn} ${kit.btnGhost}`}
            onClick={() => setDrawer({ open: true, descriptor: null })}
            data-testid="verification-drawer"
          >
            Methodology &amp; evidence
          </button>
        }
      />
      <VerificationArchitecture
        steps={view.steps}
        receipt={view.receipt}
        receiptLine={view.receiptLine}
        pending={{ index: !meta.settled, compute: reading.phase === "loading", verify: state.phase === "loading" }}
      />
      {manifest !== null && (
        <>
          <VerificationSubjects manifest={manifest} onExplain={(descriptor) => setDrawer({ open: true, descriptor })} />
          <section data-testid="verification-probes-section">
            <SectionHead
              title="Committed probe records"
              qualifier={probesSummary(manifest)}
              link={{ href: "/developers", label: "the contract and its samples → API" }}
            />
            <KitTable testId="verification-probes" columns={[...PROBE_COLUMNS]} rows={probeRows} emptyText={PROBES_EMPTY} />
          </section>
          <div>
            <button
              type="button"
              className={`${kit.btn} ${kit.btnGhost}`}
              onClick={() => setShowRaw((current) => !current)}
              aria-pressed={showRaw}
              data-testid="verification-raw"
            >
              {showRaw ? "Hide raw JSON" : "Raw JSON"}
            </button>
          </div>
          {showRaw && (
            <pre className={styles.raw} data-testid="verification-raw-json">
              {JSON.stringify(manifest, null, 2)}
            </pre>
          )}
        </>
      )}
      <VerificationDrawer
        open={drawer.open}
        onClose={() => setDrawer(CLOSED)}
        doctrine={view.doctrine}
        descriptor={drawer.descriptor}
      />
    </div>
  );
}
