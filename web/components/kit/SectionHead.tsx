import Link from "next/link";
import styles from "./kit.module.css";

export interface SectionHeadProps {
  title: string;
  qualifier?: string;
  link?: { href: string; label: string };
  testId?: string;
}

export function SectionHead({ title, qualifier, link, testId }: SectionHeadProps) {
  return (
    <div className={styles.sec} data-testid={testId}>
      <h2>
        {title}
        {qualifier !== undefined && <small>{qualifier}</small>}
      </h2>
      {link !== undefined && <Link href={link.href}>{link.label}</Link>}
    </div>
  );
}
