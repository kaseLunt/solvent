"use client";

// The LIVE contrast lab (p1a-6). Every ratio on this grid is MEASURED from
// the swatch's own resolved styles at render time — parse getComputedStyle,
// composite translucent grounds, compute the WCAG ratio (lib/contrast.ts).
// Nothing is printed from the canon's tables, so a palette drift dies here
// before a page ever wears it. The grid re-measures when the theme changes
// (data-theme override or the OS media query), so both palettes are gated.
//
// THE KNOWN-BAD PROBE: --ink-3 on --chip-bg — the §04 amendment ledger's own
// never-on-chip law (4.29 light · 4.05 dark, both < 4.5). It renders WITH its
// failing measured ratio, marked as deliberate: a computation stubbed to a
// constant cannot print those two numbers, which is what makes the seventeen
// passing figures above it worth believing.

import { useCallback, useEffect, useRef, useState } from "react";
import {
  AA_NORMAL_TEXT,
  compositeOver,
  contrastRatio,
  formatRatio,
  parseCssColor,
} from "@/lib/contrast";
import styles from "./styleguide.module.css";
import inspectorStyles from "../inspector/inspector.module.css";

interface ContrastPair {
  /** Stable id — doubles as the swatch's data-pair attribute. */
  id: string;
  /** Foreground token name (no leading --). */
  fg: string;
  /** Ground token name (no leading --). */
  bg: string;
  /** Why this pair is audited (the canon's worst-ground reasoning). */
  note: string;
}

/** The §04 audited text pairs: every text token on its worst ground(s). */
const AUDITED: readonly ContrastPair[] = [
  { id: "ink-on-panel", fg: "ink", bg: "panel", note: "Primary ink on the card ground" },
  { id: "ink-on-panel-2", fg: "ink", bg: "panel-2", note: "Primary ink on the inset ground" },
  { id: "ink-2-on-panel", fg: "ink-2", bg: "panel", note: "Secondary ink on the card ground" },
  { id: "ink-2-on-panel-2", fg: "ink-2", bg: "panel-2", note: "Secondary ink on the inset ground" },
  { id: "ink-3-on-panel", fg: "ink-3", bg: "panel", note: "Dark's worst ink-3 ground (§04 REV)" },
  { id: "ink-3-on-panel-2", fg: "ink-3", bg: "panel-2", note: "Light's worst ink-3 ground (§04 REV)" },
  { id: "accent-text-on-panel-2", fg: "accent-text", bg: "panel-2", note: "Text grade on panel-2" },
  { id: "accent-text-on-chip-bg", fg: "accent-text", bg: "chip-bg", note: "Text grade on the chip ground" },
  { id: "ok-text-on-panel-2", fg: "ok-text", bg: "panel-2", note: "Text grade on panel-2" },
  { id: "ok-text-on-chip-bg", fg: "ok-text", bg: "chip-bg", note: "Text grade on the chip ground" },
  { id: "warn-text-on-panel-2", fg: "warn-text", bg: "panel-2", note: "Light amber was the worst §04 offender" },
  { id: "warn-text-on-chip-bg", fg: "warn-text", bg: "chip-bg", note: "Text grade on the chip ground" },
  { id: "crit-text-on-panel-2", fg: "crit-text", bg: "panel-2", note: "Text grade on panel-2" },
  { id: "crit-text-on-chip-bg", fg: "crit-text", bg: "chip-bg", note: "The §04 ledger's tightest pass" },
  { id: "term-ink-on-term-bg", fg: "term-ink", bg: "term-bg", note: "Terminal body — constant across themes" },
  { id: "term-dim-on-term-bg", fg: "term-dim", bg: "term-bg", note: "Terminal comments are text too (§04 REV)" },
  { id: "accent-ink-on-accent", fg: "accent-ink", bg: "accent", note: "Solid-accent controls" },
] as const;

/** The deliberate failure — the proof the measurement is live. */
const PROBE: ContrastPair = {
  id: "ink-3-on-chip-bg",
  fg: "ink-3",
  bg: "chip-bg",
  note:
    "Known-bad probe — ink-3 never sits on chip or tinted grounds (§04 demotion). " +
    "This pair fails by design; its failing measured ratio is the proof the computation is live.",
};

const ALL_PAIRS: readonly ContrastPair[] = [...AUDITED, PROBE];

// p1a-9 (F5): ONE representative REAL-CONSUMER specimen rides the gate. The
// token pairs above prove the PALETTE; this proves a consumer CLASS — the
// inspector's verdict chip (inspector.module.css .verdict/.verdictWarn, the
// price-freshness state chip), mounted with its real stylesheet on its real
// --panel ground and measured live. A consumer that keeps (or regresses to)
// the fill-grade token for its TEXT dies here: light --warn on --panel is
// ~3.2, under the 4.5 gate this ratio is asserted against.
const CONSUMER_SPECIMEN_ID = "consumer-inspector-verdict-warn";

export function ContrastSpecimens() {
  const samples = useRef(new Map<string, HTMLSpanElement>());
  const [ratios, setRatios] = useState<Record<string, string>>({});

  const measure = useCallback(() => {
    // The page ground, for compositing any translucent swatch ground first
    // (§14 discipline). body's background is the opaque --bg.
    const pageGround = parseCssColor(getComputedStyle(document.body).backgroundColor);
    const base =
      pageGround === null || pageGround.a < 1
        ? { r: 255, g: 255, b: 255 }
        : { r: pageGround.r, g: pageGround.g, b: pageGround.b };

    const next: Record<string, string> = {};
    for (const pair of ALL_PAIRS) {
      const node = samples.current.get(pair.id);
      if (node === undefined) continue;
      const computed = getComputedStyle(node);
      const fg = parseCssColor(computed.color);
      const bg = parseCssColor(computed.backgroundColor);
      if (fg === null || bg === null) continue;
      const ground = compositeOver(bg, base);
      next[pair.id] = formatRatio(contrastRatio(compositeOver(fg, ground), ground));
    }

    // The consumer specimen: its ink comes from the REAL class; its ground is
    // its parent's (the chip itself is transparent — outline-first).
    const consumer = samples.current.get(CONSUMER_SPECIMEN_ID);
    if (consumer !== null && consumer !== undefined && consumer.parentElement !== null) {
      const fg = parseCssColor(getComputedStyle(consumer).color);
      const ownBg = parseCssColor(getComputedStyle(consumer).backgroundColor);
      const parentBg = parseCssColor(getComputedStyle(consumer.parentElement).backgroundColor);
      if (fg !== null && ownBg !== null && parentBg !== null) {
        const ground = compositeOver(ownBg, compositeOver(parentBg, base));
        next[CONSUMER_SPECIMEN_ID] = formatRatio(
          contrastRatio(compositeOver(fg, ground), ground),
        );
      }
    }
    setRatios(next);
  }, []);

  useEffect(() => {
    // First measurement on the next frame (styles are resolved; and the
    // react-hooks lint forbids a synchronous set-state inside the effect).
    const frame = requestAnimationFrame(measure);
    // Re-measure on the explicit override AND the OS scheme — the same two
    // levers the tokens.css theme law answers to.
    const observer = new MutationObserver(measure);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    media.addEventListener("change", measure);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      media.removeEventListener("change", measure);
    };
  }, [measure]);

  const renderPair = (pair: ContrastPair, probe: boolean) => {
    const ratio = ratios[pair.id];
    const failing = ratio !== undefined && Number.parseFloat(ratio) < AA_NORMAL_TEXT;
    return (
      <div
        key={pair.id}
        className={probe ? `${styles.contrastCard} ${styles.contrastProbe}` : styles.contrastCard}
        data-testid={probe ? "contrast-probe-bad" : "contrast-pair"}
        data-pair={pair.id}
        data-ratio={ratio}
      >
        <span
          ref={(node) => {
            if (node === null) samples.current.delete(pair.id);
            else samples.current.set(pair.id, node);
          }}
          className={styles.contrastSample}
          style={{ color: `var(--${pair.fg})`, background: `var(--${pair.bg})` }}
        >
          Aa 4.51
        </span>
        <span className={styles.contrastName}>
          --{pair.fg} on --{pair.bg}
        </span>
        <span
          className={
            failing ? `${styles.contrastRatio} ${styles.contrastFail}` : styles.contrastRatio
          }
        >
          {ratio === undefined ? "Measuring…" : `${ratio} ${failing ? "✗ < 4.5" : "✓ ≥ 4.5"}`}
        </span>
        <span className={styles.contrastNote}>{pair.note}</span>
      </div>
    );
  };

  const consumerRatio = ratios[CONSUMER_SPECIMEN_ID];
  const consumerFailing =
    consumerRatio !== undefined && Number.parseFloat(consumerRatio) < AA_NORMAL_TEXT;

  return (
    <div className={styles.contrastGrid}>
      {AUDITED.map((pair) => renderPair(pair, false))}
      {renderPair(PROBE, true)}
      <div
        className={styles.contrastCard}
        data-testid="contrast-consumer"
        data-pair={CONSUMER_SPECIMEN_ID}
        data-ratio={consumerRatio}
        style={{ background: "var(--panel)" }}
      >
        <span
          ref={(node) => {
            if (node === null) samples.current.delete(CONSUMER_SPECIMEN_ID);
            else samples.current.set(CONSUMER_SPECIMEN_ID, node);
          }}
          className={`${inspectorStyles.verdict} ${inspectorStyles.verdictWarn}`}
        >
          diagnostic
        </span>
        <span className={styles.contrastName}>
          Real consumer — the Inspector&apos;s .verdict.verdictWarn on --panel
        </span>
        <span
          className={
            consumerFailing
              ? `${styles.contrastRatio} ${styles.contrastFail}`
              : styles.contrastRatio
          }
        >
          {consumerRatio === undefined
            ? "Measuring…"
            : `${consumerRatio} ${consumerFailing ? "✗ < 4.5" : "✓ ≥ 4.5"}`}
        </span>
        <span className={styles.contrastNote}>
          A live consumer class, not a token pair: text on this chip must reference the -text
          grade, and a regression to the fill token dies at this measured ratio.
        </span>
      </div>
    </div>
  );
}
