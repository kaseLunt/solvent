"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { truncateAddress } from "@/lib/format";
import styles from "./primitives.module.css";

export interface AddressMonoProps {
  /** The full 0x…40-hex address. Rendered truncated; copied whole. */
  address: string;
  /** Link target (e.g. the Inspector route). Optional. */
  href?: string;
  /** Hide the copy button (dense table contexts). */
  copy?: boolean;
}

/**
 * `0x3c19…88af` with the full address in `title` and a copy control that
 * copies the COMPLETE address — the truncation is presentation, never data.
 */
export function AddressMono({ address, href, copy = true }: AddressMonoProps) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current);
    },
    [],
  );

  const onCopy = useCallback(() => {
    void navigator.clipboard?.writeText(address).then(() => {
      setCopied(true);
      if (timer.current !== null) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 1200);
    });
  }, [address]);

  const short = truncateAddress(address);
  const body = href ? (
    <Link href={href} className={styles.addressLink} title={address}>
      {short}
    </Link>
  ) : (
    <span title={address}>{short}</span>
  );

  return (
    <span className={styles.address}>
      {body}
      {copy && (
        <button
          type="button"
          className={`${styles.copyButton} ${copied ? styles.copied : ""}`}
          onClick={onCopy}
          aria-label={`copy address ${address}`}
        >
          {copied ? "✓" : "⧉"}
        </button>
      )}
    </span>
  );
}
