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
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * The explain-this-number slide-over (spec §3.6): every important number
 * opens its evidentiary chain here. Keyboard-accessible: focus moves in on
 * open, Escape closes, Tab cycles inside, focus restores on close. Motion is
 * disabled under prefers-reduced-motion (CSS).
 *
 * While open, BODY SCROLL IS LOCKED (`overflow: hidden` on `document.body`
 * for the open lifetime; the prior inline value is restored on close AND on
 * unmount-while-open) — the page behind a modal drawer must not scroll.
 *
 * Entry animates via mount-then-open: the panel mounts in its closed pose and
 * the `.open` class lands on the next frame, so the CSS transitions actually
 * run (they were dead code when the element mounted already-open). Exit is
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
      const focusable = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (first === undefined || last === undefined) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
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
