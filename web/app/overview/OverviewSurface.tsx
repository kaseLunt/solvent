"use client";

import type { components } from "@solvent/client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { AddressField, IdentityChips, SectionHead, StatusPill } from "@/components/kit";
import kit from "@/components/kit/kit.module.css";
import { getSolventClient, solventBaseUrl } from "@/lib/api";
import type { Headline } from "@/lib/book-headline";
import { PROJECTION_BADGE } from "@/lib/book-copy";
import { useCashBook } from "@/lib/cash-book";
import { cashBookKicker, deriveCashView } from "@/lib/cash-view";
import { useMetaConstants } from "@/lib/meta";
import {
  CTA,
  ENTRIES,
  FOOTER,
  HERO_DEK_LEAD,
  HERO_DEK_STRONG,
  HERO_DEK_TAIL,
  HERO_H1_LEAD,
  HERO_H1_TAIL,
  HERO_KICKER,
  HOW_IT_WORKS,
  inspectorEntry,
} from "@/lib/overview-copy";
import { fetchEvidence } from "@/lib/proof-data";
import styles from "./overview.module.css";
import { Pipeline } from "./Pipeline";

type Schemas = components["schemas"];

/** The verdict phrase's colour, from the headline's own tone: a headline with no answer is ink-2, the whole line. */
const VERDICT_EM: Record<Headline["tone"], string | undefined> = {
  crit: kit.emCrit,
  ok: kit.emOk,
  refused: kit.emRefused,
  absent: kit.emRefused,
};

/** The front door (spec 2026-09-15 §5.1): the story, the live Cash verdict, three entries, the pipeline. */
export function OverviewSurface() {
  const reading = useCashBook();
  const metaConstants = useMetaConstants();
  const router = useRouter();
  const [meta, setMeta] = useState<Schemas["MetaResponse"] | null>(null);
  const [evidence, setEvidence] = useState<Schemas["EvidenceResponse"] | null>(null);
  // A null answer is two states — not yet answered, and failed: the pipeline words them differently, so each read says when it has settled.
  const [settled, setSettled] = useState({ meta: false, evidence: false });

  useEffect(() => {
    const controller = new AbortController();
    getSolventClient()
      .meta(controller.signal)
      .then(setMeta, () => setMeta(null))
      .finally(() => {
        if (!controller.signal.aborted) setSettled((s) => ({ ...s, meta: true }));
      });
    fetchEvidence(solventBaseUrl(), controller.signal)
      .then(setEvidence, () => setEvidence(null))
      .finally(() => {
        if (!controller.signal.aborted) setSettled((s) => ({ ...s, evidence: true }));
      });
    return () => {
      controller.abort();
    };
  }, []);

  const view = deriveCashView(reading, metaConstants.constants);
  const { headline } = view;
  const noAnswer = headline.tone === "refused" || headline.tone === "absent";
  const inspector = inspectorEntry(view.summary);

  return (
    <div className={styles.hero} data-testid="overview-hero">
      <p className={kit.kick}>{HERO_KICKER}</p>
      <h1 className={styles.h1}>
        {HERO_H1_LEAD}
        <span>{HERO_H1_TAIL}</span>
      </h1>
      <p className={styles.dek}>
        {HERO_DEK_LEAD}
        <b>{HERO_DEK_STRONG}</b>
        {HERO_DEK_TAIL}
      </p>
      <div className={styles.cta}>
        <Link href="/book" className={`${kit.btn} ${kit.btnPrimary}`}>
          {CTA.book}
        </Link>
        <AddressField
          onInspect={(address) => router.push(`/inspector/${address}`)}
          hint={CTA.addressHint}
          placeholder={CTA.addressPlaceholder}
          hintVisible={false}
          inspectTone="ghost"
          testId="overview-address"
        />
        <Link href="/lab" className={`${kit.btn} ${kit.btnGhost}`}>
          {CTA.scenarios}
        </Link>
      </div>

      <section
        className={styles.live}
        data-testid="overview-live"
        data-variant={reading.phase === "loading" ? "loading" : headline.variant}
        aria-live="polite"
        aria-busy={view.walking ? "true" : undefined}
      >
        <div>
          <p className={`${kit.kick} ${styles.liveKick}`}>
            <span className={`${kit.dot} ${view.loaded && !view.refusedTiles ? kit.dotLive : ""}`} aria-hidden="true" />
            {cashBookKicker(view)}
          </p>
          <p
            className={noAnswer ? `${styles.liveH} ${styles.liveHAbsent}` : styles.liveH}
            data-testid="overview-live-headline"
            data-register={noAnswer ? "absent" : undefined}
          >
            <b className={VERDICT_EM[headline.tone]}>{headline.emphasis}</b>
            {headline.rest}
          </p>
          {view.liveLine !== null && (
            <p className={styles.liveS} data-testid="overview-live-line">
              {view.liveLine}
            </p>
          )}
          <IdentityChips chips={view.liveChips} testId="overview-live-identity" />
        </div>
        <div className={styles.liveStats}>
          {view.liveStats.map((stat) => (
            <div key={stat.id} data-testid={`overview-live-${stat.id}`} data-state={stat.absent ? "absent" : undefined}>
              <div className={styles.liveStatL}>{stat.label}</div>
              <div className={stat.absent ? `${styles.liveStatV} ${styles.liveStatAbsent}` : styles.liveStatV}>{stat.text}</div>
            </div>
          ))}
        </div>
      </section>

      <div className={styles.entries}>
        <Link href="/book" className={styles.entry} data-testid="overview-entry-book">
          <div className={styles.entryQ}>{ENTRIES.book.question}</div>
          <div className={styles.entryN}>{ENTRIES.book.name}</div>
          <div className={styles.entryD}>{ENTRIES.book.description}</div>
          <div className={styles.entryS}>{view.bookEntryLine}</div>
        </Link>
        <Link href={inspector.href} className={styles.entry} data-testid="overview-entry-inspector">
          <div className={styles.entryQ}>{ENTRIES.inspector.question}</div>
          <div className={styles.entryN}>{ENTRIES.inspector.name}</div>
          <div className={styles.entryD}>{ENTRIES.inspector.description}</div>
          <div className={styles.entryS}>{inspector.line}</div>
        </Link>
        <Link href="/lab" className={styles.entry} data-testid="overview-entry-scenarios">
          <div className={styles.entryQ}>{ENTRIES.scenarios.question}</div>
          <div className={styles.entryN}>{ENTRIES.scenarios.name}</div>
          <div className={styles.entryD}>{ENTRIES.scenarios.description}</div>
          <div className={styles.entryS}>
            {view.previewProjected && (
              <span className={styles.entryBadge}>
                <StatusPill tone="projection">{PROJECTION_BADGE}</StatusPill>
              </span>
            )}
            {view.previewLine}
          </div>
        </Link>
      </div>

      <div className={styles.how}>
        <SectionHead title={HOW_IT_WORKS.title} link={HOW_IT_WORKS.link} testId="overview-how" />
        <Pipeline meta={meta} evidence={evidence} reading={reading} inFlight={{ meta: !settled.meta, evidence: !settled.evidence }} />
      </div>
      <div className={styles.foot}>
        <span>{FOOTER.stack}</span>
        <span>
          {FOOTER.source}
          <b>{FOOTER.repo}</b>
          {FOOTER.note}
        </span>
      </div>
    </div>
  );
}
