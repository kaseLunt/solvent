"use client";

import type { components } from "@solvent/client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { IdentityChips } from "@/components/kit";
import kit from "@/components/kit/kit.module.css";
import { getSolventClient, solventBaseUrl } from "@/lib/api";
import { useCashBook } from "@/lib/cash-book";
import { deriveCashView, moneyText } from "@/lib/cash-view";
import { isAddress } from "@/lib/format";
import { humanUsd } from "@/lib/human-usd";
import { useMetaConstants } from "@/lib/meta";
import { fetchEvidence } from "@/lib/proof-data";
import {
  FOOTER_NOTE,
  FOOTER_STACK,
  HERO_DEK_LEAD,
  HERO_DEK_STRONG,
  HERO_DEK_TAIL,
  HERO_H1_LEAD,
  HERO_H1_TAIL,
  HERO_KICKER,
} from "./copy";
import styles from "./overview.module.css";
import { Pipeline } from "./Pipeline";

type Schemas = components["schemas"];

const EM_CLASS = { crit: kit.emCrit, warn: kit.emWarn, ok: kit.emOk, refused: kit.emRefused } as const;
const shortAddress = (a: string): string => `${a.slice(0, 6)}…${a.slice(-4)}`;

/** The front door (spec 2026-09-15 §5.1): the story, the live Cash verdict, three entries, the pipeline. */
export function OverviewSurface() {
  const reading = useCashBook();
  const metaConstants = useMetaConstants();
  const router = useRouter();
  const [meta, setMeta] = useState<Schemas["MetaResponse"] | null>(null);
  const [evidence, setEvidence] = useState<Schemas["EvidenceResponse"] | null>(null);
  // A null answer is two states — not yet answered, and failed: the pipeline words them differently, so each read says when it has settled.
  const [settled, setSettled] = useState({ meta: false, evidence: false });
  const [addressDraft, setAddressDraft] = useState("");
  const [addressRefused, setAddressRefused] = useState(false);

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
  const { summary, decimals, headline } = view;
  const showLoading = reading.phase === "loading";
  const nearest = summary?.liquidatable.material[0] ?? summary?.nearCapRows[0] ?? null;
  const nearestLine =
    nearest === null || nearest.room === null
      ? "Try any 0x address"
      : `Try ${shortAddress(nearest.account)} — ${nearest.room < 0n ? "liquidatable now" : `${humanUsd(nearest.room, decimals)} from its cap`}`;

  const inspect = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const trimmed = addressDraft.trim();
    if (!isAddress(trimmed)) {
      setAddressRefused(true);
      return;
    }
    router.push(`/inspector/${trimmed}`);
  };

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
      <form className={styles.cta} onSubmit={inspect}>
        <Link href="/book" className={`${kit.btn} ${kit.btnPrimary}`}>
          Open the book
        </Link>
        <input
          className={styles.ctaInput}
          value={addressDraft}
          onChange={(e) => {
            setAddressDraft(e.target.value);
            setAddressRefused(false);
          }}
          placeholder="Inspect an address · 0x…"
          aria-label="address to inspect"
          aria-invalid={addressRefused ? "true" : undefined}
          data-testid="overview-address"
        />
        <Link href="/lab" className={`${kit.btn} ${kit.btnGhost}`}>
          Run a stress scenario
        </Link>
        {addressRefused && (
          <span className={kit.sub} role="alert" data-testid="overview-address-refused">
            An address is 0x followed by 40 hex characters — nothing else is looked up.
          </span>
        )}
      </form>

      <section
        className={styles.live}
        data-testid="overview-live"
        data-variant={showLoading ? "loading" : headline.variant}
        aria-live="polite"
        aria-busy={view.walking ? "true" : undefined}
      >
        <div>
          <p className={styles.liveKick}>
            <span className={`${kit.dot} ${view.loaded && !view.refusedTiles ? kit.dotOk : ""}`} aria-hidden="true" />
            Cash book · right now{view.walking ? " · walking" : ""}
          </p>
          <p className={styles.liveH} data-testid="overview-live-headline">
            {showLoading ? (
              "Loading the Cash book…"
            ) : (
              <>
                <b className={EM_CLASS[headline.tone]}>{headline.emphasis}</b>
                {headline.rest}
              </>
            )}
          </p>
          {!showLoading && <p className={styles.liveS}>{headline.dek}</p>}
          <IdentityChips chips={view.chips} testId="overview-live-identity" />
        </div>
        <div className={styles.liveStats}>
          <div>
            <div className={styles.liveStatL}>Cash debt outstanding</div>
            <div className={styles.liveStatV}>{moneyText(view.debt)}</div>
          </div>
          <div>
            <div className={styles.liveStatL}>Collateral</div>
            <div className={styles.liveStatV}>{moneyText(view.collateral)}</div>
          </div>
          <div data-testid="overview-live-accounts">
            <div className={styles.liveStatL}>Accounts</div>
            <div className={styles.liveStatV}>{view.positions === null ? "—" : view.positions.toLocaleString("en-US")}</div>
          </div>
        </div>
      </section>

      <div className={styles.entries}>
        <Link href="/book" className={styles.entry} data-testid="overview-entry-book">
          <div className={styles.entryQ}>What is at risk now?</div>
          <div className={styles.entryN}>Book →</div>
          <div className={styles.entryD}>
            The whole Cash lending book: what&apos;s liquidatable, what&apos;s close, what backs it, and where the bad
            debt sits.
          </div>
          <div className={styles.entryS}>{view.bookEntryLine}</div>
        </Link>
        <Link
          href={nearest === null ? "/inspector" : `/inspector/${nearest.account}`}
          className={styles.entry}
          data-testid="overview-entry-inspector"
        >
          <div className={styles.entryQ}>Is this address at risk?</div>
          <div className={styles.entryN}>Inspector →</div>
          <div className={styles.entryD}>
            One account: its distance to liquidation, the prices that decide it, and the exact calculation with its
            numbers substituted.
          </div>
          <div className={styles.entryS}>{nearestLine}</div>
        </Link>
        <Link href="/lab" className={styles.entry} data-testid="overview-entry-scenarios">
          <div className={styles.entryQ}>What if ETH falls 30%?</div>
          <div className={styles.entryN}>Scenarios →</div>
          <div className={styles.entryD}>
            Committed, versioned shocks run against the live book. Every shocked number is labeled a projection.
          </div>
          <div className={styles.entryS}>{view.previewLine}</div>
        </Link>
      </div>

      <div className={styles.sec}>
        <h2>How it works</h2>
        <Link href="/proof#architecture">Architecture &amp; verification →</Link>
      </div>
      <Pipeline meta={meta} evidence={evidence} reading={reading} inFlight={{ meta: !settled.meta, evidence: !settled.evidence }} />
      <div className={styles.foot}>
        <span>{FOOTER_STACK}</span>
        <span>
          Open source · <b>github.com/kaseLunt/solvent</b> · {FOOTER_NOTE}
        </span>
      </div>
    </div>
  );
}
