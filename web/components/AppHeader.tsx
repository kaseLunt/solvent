"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { PostureRibbon } from "./PostureRibbon";
import { ThemeToggle } from "./ThemeToggle";
import styles from "./header.module.css";

/** The four primary surfaces (spec §3) in tab order. */
const PRIMARY_TABS = [
  { href: "/book", label: "Book" },
  { href: "/inspector", label: "Inspector" },
  { href: "/observatory", label: "Observatory" },
  { href: "/feed", label: "Feed" },
] as const;

/** Lab and Developers ride the same nav bar as secondary destinations. */
const SECONDARY_TABS = [
  { href: "/lab", label: "Lab" },
  { href: "/developers", label: "Developers" },
] as const;

/**
 * The real product header. The mockup's window chrome (titlebar + appnav)
 * translated honestly: no fake browser dots, no fake address bar — a brand
 * block, the four-tab appnav with the mockup's accent-underline active state,
 * and the integrity Ribbon slot fed by live stream posture.
 */
export function AppHeader() {
  const pathname = usePathname();
  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`);

  return (
    <header className={styles.header}>
      <div className={styles.topRow}>
        <Link href="/book" className={styles.brand} aria-label="Solvent — go to the Book">
          <span className={styles.wordmark}>
            SOLVENT<span>·</span>
          </span>
          <span className={styles.tagline}>ether.fi risk observatory</span>
        </Link>
        <div className={styles.ribbonSlot}>
          <PostureRibbon />
          <ThemeToggle />
        </div>
      </div>
      <nav className={styles.navRow} aria-label="app surfaces">
        {PRIMARY_TABS.map((tab) => (
          <Link
            key={tab.href}
            href={tab.href}
            className={isActive(tab.href) ? `${styles.tab} ${styles.on}` : styles.tab}
            aria-current={isActive(tab.href) ? "page" : undefined}
          >
            {tab.label}
          </Link>
        ))}
        <div className={styles.secondary}>
          {SECONDARY_TABS.map((tab) => (
            <Link
              key={tab.href}
              href={tab.href}
              className={isActive(tab.href) ? `${styles.tab} ${styles.on}` : styles.tab}
              aria-current={isActive(tab.href) ? "page" : undefined}
            >
              {tab.label}
            </Link>
          ))}
        </div>
      </nav>
    </header>
  );
}
