"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { AddressField } from "@/components/kit";
import kit from "@/components/kit/kit.module.css";
import { truncateAddress } from "@/lib/format";
import { rememberLookup, useRecentLookups } from "@/lib/recent-lookups";
import styles from "./inspector.module.css";

/** /inspector — the question, the field, and the reader's own recent lookups (browser-local). */
export function InspectorLanding() {
  const router = useRouter();
  const recents = useRecentLookups();
  return (
    <div className={styles.landing} data-testid="inspector-landing">
      <p className={kit.kick}>Inspector</p>
      <h1 className={kit.h1}>Is this address at risk?</h1>
      <p className={kit.dek}>
        Paste any 0x address. You get one sentence — how close it is to its borrow cap and why — with every number
        traceable to the inputs behind it. Anything the service cannot defend renders as a named refusal, never a guess.
      </p>
      <div className={styles.toolbar}>
        <AddressField
          testId="inspector-address"
          hint="any 0x address"
          onInspect={(address) => {
            rememberLookup(address);
            router.push(`/inspector/${address}`);
          }}
        />
      </div>
      {recents.length > 0 && (
        <>
          <p className={styles.note}>Recent lookups · stored in this browser only</p>
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
