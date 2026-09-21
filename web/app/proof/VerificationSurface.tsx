"use client";

import type { components } from "@solvent/client";
import { useEffect, useState } from "react";
import { KitTable, SectionHead, VerdictHeader, type KitRow } from "@/components/kit";
import kit from "@/components/kit/kit.module.css";
import { getSolventClient, solventBaseUrl } from "@/lib/api";
import type { EvidenceDescriptor } from "@/lib/evidence";
import { fetchEvidence, ProofFetchError } from "@/lib/proof-data";
import {
  BOOK_LOADING,
  bookAnswered,
  bookFailed,
  deriveVerificationView,
  PROBE_COLUMNS,
  PROBES_EMPTY,
  probesSummary,
  VERIFICATION_COPY,
  type BookReading,
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
 * is fetched through lib/proof-data; the steps' live numbers come from /v1/meta
 * and /v1/book through the derivation the Overview prints, so both pages read
 * one law. The compute step prints the book's census, so this page asks
 * /v1/book alone and never walks /v1/positions. Every word is the view
 * model's; this component prints.
 */
export function VerificationSurface() {
  const [state, setState] = useState<EvidenceState>({ phase: "loading" });
  const [meta, setMeta] = useState<MetaAsk>({ settled: false, value: null });
  const [reading, setReading] = useState<BookReading>(BOOK_LOADING);
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
      .book(controller.signal)
      .then(
        (book) => {
          if (!controller.signal.aborted) setReading(bookAnswered(book));
        },
        (cause: unknown) => {
          if (!controller.signal.aborted) setReading(bookFailed(cause));
        },
      );
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

  // A deep link lands on what it names. The browser's own hash scroll ran on the
  // loading tree, which may be shorter than the viewport; once the manifest has
  // answered and the page has its height, the named element is scrolled to.
  useEffect(() => {
    if (state.phase === "loading") return;
    const id = window.location.hash.slice(1);
    if (id === "") return;
    document.getElementById(id)?.scrollIntoView({ block: "start" });
  }, [state.phase]);

  const view = deriveVerificationView({ state, meta: meta.value, book: reading });
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
            {VERIFICATION_COPY.drawerButton}
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
              title={VERIFICATION_COPY.probesTitle}
              qualifier={probesSummary(manifest)}
              link={{ href: "/developers", label: VERIFICATION_COPY.probesLink }}
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
              {showRaw ? VERIFICATION_COPY.rawHide : VERIFICATION_COPY.rawShow}
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
