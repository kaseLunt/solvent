"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ThemeToggle } from "../ThemeToggle";
import styles from "./kit.module.css";
import { LivePill } from "./LivePill";

/** Nav labels are the page names (spec §3.2); routes are unchanged. */
const TABS = [
  { href: "/", label: "Overview" },
  { href: "/book", label: "Book" },
  { href: "/inspector", label: "Inspector" },
  { href: "/lab", label: "Scenarios" },
  { href: "/observatory", label: "History" },
  { href: "/feed", label: "Activity" },
  { href: "/proof", label: "Verification" },
  { href: "/developers", label: "API" },
] as const;

export const GITHUB_URL = "https://github.com/kaseLunt/solvent";

export function AppShell() {
  const pathname = usePathname();
  const isActive = (href: string): boolean =>
    href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
  return (
    <header className={styles.hd}>
      <Link href="/" className={styles.brand} aria-label="Solvent · go to the overview">
        <i className={styles.brandMark} aria-hidden="true" />
        Solvent<span className={styles.brandTag}>ether.fi Cash risk</span>
      </Link>
      <nav className={styles.nav} aria-label="app surfaces">
        {TABS.map((tab) => (
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
        <a href={GITHUB_URL} rel="noreferrer">
          GitHub
        </a>
        <ThemeToggle />
      </div>
    </header>
  );
}
