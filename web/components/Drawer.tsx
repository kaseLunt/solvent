"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import styles from "./drawer.module.css";

export interface DrawerProps {
  open: boolean;
  onClose: () => void;
  /** Mono uppercase heading, e.g. "EXPLAIN · HEALTH FACTOR". */
  title: ReactNode;
  children: ReactNode;
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), details > summary:first-of-type, [tabindex]:not([tabindex="-1"])';

/**
 * The panel's Tab stops, in DOM order. A stop is what the browser itself would stop on: a control the selector
 * names AND the page renders — a closed fold's controls match the selector and are no stop. The cycle below is
 * decided against this list, so a list that disagreed with the browser would send Tab to the wrong place.
 */
function stopsOf(panel: HTMLElement): HTMLElement[] {
  return Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((stop) =>
    typeof stop.checkVisibility === "function" ? stop.checkVisibility() : stop.getClientRects().length > 0,
  );
}

/**
 * The explain-this-number slide-over (spec §3.6): every important number
 * opens its evidentiary chain here. Keyboard-accessible: focus moves in on
 * open, Escape closes, Tab and Shift+Tab cycle inside from the first key —
 * focus never reaches the page behind a modal — and focus restores on close.
 * Motion is disabled under prefers-reduced-motion (CSS).
 *
 * While open, BODY SCROLL IS LOCKED (`overflow: hidden` on `document.body`
 * for the open lifetime; the prior inline value is restored on close AND on
 * unmount-while-open) — the page behind a modal drawer must not scroll.
 *
 * Entry animates via mount-then-open: the panel mounts in its closed pose and
 * the `.open` class lands on the next frame, so the CSS transitions have a
 * start state to run from (an element mounted already-open has none). Exit is
 * deliberately immediate — the drawer unmounts on close.
 */
export function Drawer({ open, onClose, title, children }: DrawerProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const restoreRef = useRef<HTMLElement | null>(null);
  // Mount-then-open: false on mount, true one frame later, so the
  // opacity/transform transitions in drawer.module.css have a start state.
  const [entered, setEntered] = useState(false);

  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => {
      setEntered(true);
    });
    return () => {
      // Reset in cleanup so the NEXT open animates from the closed pose again.
      cancelAnimationFrame(frame);
      setEntered(false);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    restoreRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    panelRef.current?.focus();
    return () => {
      restoreRef.current?.focus();
    };
  }, [open]);

  // Body scroll lock for the open lifetime. The cleanup restores the PRIOR
  // inline value (usually ""), so a close and an unmount-while-open both put
  // the document back exactly as found.
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const panel = panelRef.current;
      if (panel === null) return;
      const stops = stopsOf(panel);
      const first = stops[0];
      const last = stops[stops.length - 1];
      // A modal never gives its focus to the page behind it: with no stop to move to, Tab moves nothing.
      if (first === undefined || last === undefined) {
        event.preventDefault();
        return;
      }
      // Where focus stands in the cycle. -1 is OUTSIDE it: the panel itself — where focus rests when the drawer
      // opens, and where a click on the panel's text puts it — or anything else that is not a stop. From outside
      // the cycle the browser's own next / previous stop may be on the page behind, so the cycle is entered here:
      // Shift+Tab at its last stop, Tab at its first. Between two stops the browser's own order stands.
      const active = document.activeElement;
      const at = active instanceof HTMLElement ? stops.indexOf(active) : -1;
      const leavesTheCycle = event.shiftKey ? at <= 0 : at === -1 || at === stops.length - 1;
      if (!leavesTheCycle) return;
      event.preventDefault();
      (event.shiftKey ? last : first).focus();
    },
    [onClose],
  );

  if (!open) return null;

  const openClass = entered ? ` ${styles.open}` : "";
  return (
    <>
      <div className={`${styles.backdrop}${openClass}`} onClick={onClose} aria-hidden />
      <div
        ref={panelRef}
        className={`${styles.panel}${openClass}`}
        role="dialog"
        aria-modal="true"
        aria-label={typeof title === "string" ? title : "detail drawer"}
        tabIndex={-1}
        onKeyDown={onKeyDown}
      >
        <div className={styles.head}>
          <h4 className={styles.title}>{title}</h4>
          <button type="button" className={styles.close} onClick={onClose} aria-label="close drawer">
            ESC ✕
          </button>
        </div>
        <div className={styles.body}>{children}</div>
      </div>
    </>
  );
}
