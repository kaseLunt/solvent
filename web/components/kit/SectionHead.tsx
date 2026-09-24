import Link from "next/link";
import type { ReactNode } from "react";
import styles from "./kit.module.css";

export interface SectionHeadProps {
  title: string;
  qualifier?: string;
  /** The head's one badge, right after the title's words: the PROJECTION badge of a projected section. */
  badge?: ReactNode;
  link?: { href: string; label: string };
  testId?: string;
}

export function SectionHead({ title, qualifier, badge, link, testId }: SectionHeadProps) {
  return (
    <div className={styles.sec} data-testid={testId}>
      <h2>
        {title}
        {badge !== undefined && <span className={styles.badge}>{badge}</span>}
        {qualifier !== undefined && <small>{qualifier}</small>}
      </h2>
      {link !== undefined && <Link href={link.href}>{link.label}</Link>}
    </div>
  );
}
