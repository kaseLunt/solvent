"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { AddressField } from "@/components/kit";
import kit from "@/components/kit/kit.module.css";
import { truncateAddress } from "@/lib/format";
import { ADDRESS_HINT, INSPECTOR_LANDING } from "@/lib/inspector-view";
import { rememberLookup, useRecentLookups } from "@/lib/recent-lookups";
import styles from "./inspector.module.css";

/** /inspector — the question, the field, and the reader's own recent lookups (browser-local). */
export function InspectorLanding() {
  const router = useRouter();
  const recents = useRecentLookups();
  return (
    <div className={styles.landing} data-testid="inspector-landing">
      <p className={kit.kick}>{INSPECTOR_LANDING.kicker}</p>
      <h1 className={kit.h1}>{INSPECTOR_LANDING.title}</h1>
      <p className={kit.dek}>{INSPECTOR_LANDING.dek}</p>
      <div className={styles.toolbar}>
        <AddressField
          testId="inspector-address"
          hint={ADDRESS_HINT}
          onInspect={(address) => {
            rememberLookup(address);
            router.push(`/inspector/${address}`);
          }}
        />
      </div>
      {recents.length > 0 && (
        <>
          <p className={styles.note}>{INSPECTOR_LANDING.recent}</p>
          <ul className={styles.recent} data-testid="inspector-recent">
            {recents.map((address) => (
              <li key={address}>
                <Link href={`/inspector/${address}`} className={kit.addr} title={address}>
                  {truncateAddress(address)}
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
