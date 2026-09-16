"use client";

// One address, every number defended (spec 2026-09-15 §5.3). The view model
// decides everything printed; this file only places it. All ten states render
// into the same frame — the toolbar, the verdict header, the tiles, the grid.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { AddressField, VerdictHeader } from "@/components/kit";
import kit from "@/components/kit/kit.module.css";
import type { ActivityScale } from "@/lib/activity-rows";
import { useAddressLookup } from "@/lib/address-lookup";
import { truncateAddress } from "@/lib/format";
import { CASH, LEGACY } from "@/lib/inspector-position";
import { deriveInspectorView } from "@/lib/inspector-view";
import { useMetaConstants } from "@/lib/meta";
import { rememberLookup } from "@/lib/recent-lookups";
import styles from "../inspector.module.css";
import { ActivityTable } from "./ActivityTable";
import { BackingTable } from "./BackingTable";
import { HistoryCard } from "./HistoryCard";
import { InspectorDrawer } from "./InspectorDrawer";
import { InspectorTiles } from "./InspectorTiles";
import { LegacyCard } from "./LegacyCard";
import { StressTable } from "./StressTable";
import { TrustCard } from "./TrustCard";

export function InspectorSurface({ addr }: { addr: string }) {
  const router = useRouter();
  const reading = useAddressLookup(addr);
  const meta = useMetaConstants();
  const view = deriveInspectorView(reading, meta.constants);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const found = reading.lookup.phase === "ready" && reading.lookup.value.outcome === "found";
  // The wire's own decimals per engine, never hardcoded: amounts in the activity table scale by them.
  const scale: ActivityScale = {
    valueDecimalsByEngine: {
      ...(view.cashWire === null ? {} : { [CASH]: view.cashWire.value_decimals }),
      ...(view.legacy === null ? {} : { [LEGACY]: view.legacy.value_decimals }),
    },
  };
  // The kicker's words wear the kit's small caps; the address inside it is an address — mono, its own case.
  const short = truncateAddress(addr);
  const kicker = view.kicker.endsWith(short) ? (
    <>
      {view.kicker.slice(0, -short.length)}
      <span className={styles.kickAddr}>{short}</span>
    </>
  ) : (
    view.kicker
  );
  return (
    <div className={styles.page} data-testid="inspector-surface" data-state={view.state} aria-busy={view.state === "loading" ? "true" : undefined}>
      <div className={styles.toolbar}>
        <AddressField
          testId="inspector-address"
          initial={reading.valid ? addr : ""}
          hint="any 0x address"
          secondary={view.cash === null ? undefined : { href: "#stress", label: "Stress this address →" }}
          onInspect={(address) => {
            rememberLookup(address);
            router.push(`/inspector/${address}`);
          }}
        />
      </div>
      <VerdictHeader
        testId="inspector-verdict"
        kicker={kicker}
        emphasis={view.headline.emphasis}
        rest={view.headline.rest}
        tone={view.headline.tone}
        dek={view.headline.dek}
        chips={view.chips}
        actions={
          found ? (
            <button type="button" className={`${kit.btn} ${kit.btnGhost}`} onClick={() => setDrawerOpen(true)} data-testid="inspector-drawer">
              Inputs · Calculation · Provenance
            </button>
          ) : undefined
        }
      />
      {view.state !== "invalid" && (
        <>
          <InspectorTiles view={view} />
          <div className={`${kit.grid} ${kit.gridRail}`}>
            <BackingTable view={view} onPrices={() => setDrawerOpen(true)} />
            <TrustCard view={view} />
          </div>
          <HistoryCard view={view} reading={reading} />
          {/* key={addr}: a fresh mount can never hold another address's rows (the surface is keyed too — a double lock). */}
          <ActivityTable key={addr} addr={addr} valid={reading.valid} scale={scale} />
          {view.legacy !== null && <LegacyCard position={view.legacy} />}
          {view.cash !== null && <StressTable reading={reading} view={view} />}
          <InspectorDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} view={view} reading={reading} />
        </>
      )}
    </div>
  );
}
