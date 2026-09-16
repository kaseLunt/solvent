import Link from "next/link";
import type { ReactNode } from "react";
import styles from "./kit.module.css";

export type ChartCardLink = { href: string; label: string } | { onClick: () => void; label: string };

export interface ChartCardProps {
  title: string;
  /** The finding line under the title — states what the chart shows, in words. */
  finding?: ReactNode;
  /** A navigation link, or an in-page action (opens a drawer) rendered as a button. */
  link?: ChartCardLink;
  children: ReactNode;
  testId?: string;
}

export function ChartCard({ title, finding, link, children, testId }: ChartCardProps) {
  return (
    <section className={styles.card} data-testid={testId} aria-label={title}>
      <div className={styles.cardT}>
        <h3>{title}</h3>
        {link !== undefined &&
          ("href" in link ? (
            <Link href={link.href}>{link.label}</Link>
          ) : (
            <button type="button" onClick={link.onClick}>
              {link.label}
            </button>
          ))}
      </div>
      {finding !== undefined && <div className={styles.cardF}>{finding}</div>}
      {children}
    </section>
  );
}
