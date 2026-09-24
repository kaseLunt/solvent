"use client";

import { useEffect, type RefObject } from "react";

export interface EdgeFadeOptions {
  /**
   * A scroll region that holds no control of its own (a table, a heatmap) is a named region with a Tab stop while it
   * overflows, so a keyboard can reach and scroll it; one that fits is plain layout, since a landmark or a stop that
   * does nothing is noise. The name is the exhibit's.
   */
  readonly region?: string;
}

/**
 * Marks a horizontally scrolling element with where its hidden content lies: `data-fade` is "none", "start", "end" or
 * "both", and `data-overflow` says whether it overflows at all. The stylesheet draws the cue from these; nothing is
 * rendered through React state, so a scroll never re-renders the strip.
 */
export function useEdgeFade(ref: RefObject<HTMLElement | null>, options: EdgeFadeOptions = {}): void {
  const region = options.region ?? null;
  useEffect(() => {
    const element = ref.current;
    if (element === null) return;
    const update = (): void => {
      const max = element.scrollWidth - element.clientWidth;
      const overflow = max > 1;
      const before = overflow && element.scrollLeft > 1;
      const after = overflow && element.scrollLeft < max - 1;
      element.dataset.overflow = overflow ? "true" : "false";
      element.dataset.fade = before && after ? "both" : before ? "start" : after ? "end" : "none";
      if (region === null) return;
      if (overflow) {
        element.tabIndex = 0;
        element.setAttribute("role", "region");
        element.setAttribute("aria-label", region);
      } else {
        element.removeAttribute("tabindex");
        element.removeAttribute("role");
        element.removeAttribute("aria-label");
      }
    };
    update();
    element.addEventListener("scroll", update, { passive: true });
    const observer = new ResizeObserver(update);
    observer.observe(element);
    for (const child of Array.from(element.children)) observer.observe(child);
    return () => {
      element.removeEventListener("scroll", update);
      observer.disconnect();
    };
  }, [ref, region]);
}
