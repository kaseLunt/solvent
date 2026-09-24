"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { BRAND, GITHUB_LABEL, GITHUB_URL, NAV_LABEL, NAV_TABS } from "@/lib/chrome";
import { ThemeToggle } from "../ThemeToggle";
import { GithubGlyph } from "./HeaderGlyphs";
import styles from "./kit.module.css";
import { LivePill } from "./LivePill";
import { useEdgeFade } from "./useEdgeFade";

/** How far past the nav's edge the active tab is brought: clear of the edge fade. */
const FADE_CLEARANCE = 24;

export function AppShell() {
  const pathname = usePathname();
  const navRef = useRef<HTMLElement>(null);
  useEdgeFade(navRef);
  const isActive = (href: string): boolean =>
    href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);

  // When the nav scrolls (a narrow screen), the current page's tab is brought into its view. Only the nav's own
  // scroll moves — never the window, so a deep link's anchor keeps its place — and it moves at once, never smoothly.
  useEffect(() => {
    const nav = navRef.current;
    const active = nav?.querySelector<HTMLElement>('[aria-current="page"]');
    if (nav === null || nav === undefined || active === null || active === undefined) return;
    if (nav.scrollWidth <= nav.clientWidth) return;
    const box = nav.getBoundingClientRect();
    const tab = active.getBoundingClientRect();
    if (tab.left < box.left + FADE_CLEARANCE) nav.scrollLeft -= box.left + FADE_CLEARANCE - tab.left;
    else if (tab.right > box.right - FADE_CLEARANCE) nav.scrollLeft += tab.right - (box.right - FADE_CLEARANCE);
  }, [pathname]);

  return (
    <header className={styles.hd}>
      <Link href="/" className={styles.brand} aria-label={BRAND.linkLabel}>
        <i className={styles.brandMark} aria-hidden="true" />
        {BRAND.name}
        <span className={styles.brandTag}>{BRAND.tag}</span>
      </Link>
      <nav ref={navRef} className={`${styles.nav} ${styles.edgeFade}`} aria-label={NAV_LABEL}>
        {NAV_TABS.map((tab) => (
          <Link
            key={tab.href}
            href={tab.href}
            className={isActive(tab.href) ? styles.on : undefined}
            aria-current={isActive(tab.href) ? "page" : undefined}
          >
            {tab.label}
          </Link>
        ))}
      </nav>
      <div className={styles.status}>
        <LivePill />
        <a href={GITHUB_URL} rel="noreferrer" className={styles.iconBtn} aria-label={GITHUB_LABEL} title={GITHUB_LABEL}>
          <GithubGlyph />
        </a>
        <ThemeToggle />
      </div>
    </header>
  );
}
