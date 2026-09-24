"use client";

import { useRef, type ReactNode } from "react";
import styles from "./kit.module.css";
import { useEdgeFade } from "./useEdgeFade";

export interface ScrollRegionProps {
  /** The region's accessible name: the exhibit it scrolls. */
  label: string;
  children: ReactNode;
}

/**
 * A wide exhibit (a table, a heatmap) scrolls inside this region and never widens the page. While it overflows, the
 * region is a named region and a Tab stop (arrow keys scroll it), the first column holds still, and the far edge fades
 * where columns remain; while it fits, it is plain layout.
 */
export function ScrollRegion({ label, children }: ScrollRegionProps) {
  const ref = useRef<HTMLDivElement>(null);
  useEdgeFade(ref, { region: label });
  return (
    <div ref={ref} className={styles.tblScroll}>
      {children}
    </div>
  );
}
