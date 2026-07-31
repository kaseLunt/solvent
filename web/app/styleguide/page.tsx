import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { StatCard } from "@/components/StatCard";
import { SeverityHF } from "@/components/SeverityHF";
import { EngineChip } from "@/components/EngineChip";
import { AddressMono } from "@/components/AddressMono";
import { MarksStamp } from "@/components/MarksStamp";
import { RefusedTag } from "@/components/RefusedTag";
import { ProjectionBadge } from "@/components/ProjectionBadge";
import { Stampline, StampItem } from "@/components/Stampline";
import { Ribbon } from "@/components/Ribbon";
import { DataTable, type Column } from "@/components/DataTable";
import { Sparkline } from "@/components/charts/Sparkline";
import { Scatter } from "@/components/charts/Scatter";
import { WaterfallSteps } from "@/components/charts/WaterfallSteps";
import { renderLookupOutcome, renderNullableDecimal, renderBlockTime, EM_DASH } from "@/lib/format";
import { DrawerDemo } from "./DrawerDemo";
import { PaginationDemo } from "./PaginationDemo";
import styles from "./styleguide.module.css";

export const metadata: Metadata = { title: "Styleguide" };

const PALETTE = [
  "bg",
  "panel",
  "panel-2",
  "ink",
  "ink-2",
  "ink-3",
  "line",
  "accent",
  "ok",
  "warn",
  "crit",
  "chip-bg",
  "term-bg",
] as const;

interface SpecimenRow {
  engine: string;
  account: string;
  collateral: string | null;
  debt: string | null;
  verdict: "liquidatable" | "not-liquidatable" | "unknowable";
  hf: string | null;
  ratio: number | null;
  infinite: boolean;
  refusedReason: string | null;
  marks: ReadonlyArray<{ letter: string; block: number | null }>;
}

/** Static SPECIMEN rows — the mockup's own example values, labeled as such. */
const SPECIMEN_ROWS: readonly SpecimenRow[] = [
  {
    engine: "aave_v3",
    account: "0x3c19000000000000000000000000000000008af0",
    collateral: "$4,182,003.11",
    debt: "$2,201,554.87",
    verdict: "not-liquidatable",
    hf: "1.539",
    ratio: 1.539,
    infinite: false,
    refusedReason: null,
    marks: [
      { letter: "B", block: 25641730 },
      { letter: "P", block: 25641730 },
    ],
  },
  {
    engine: "aave_v3",
    account: "0x71aa00000000000000000000000000000004e200",
    collateral: "$1,904,112.60",
    debt: "$1,478,220.02",
    verdict: "not-liquidatable",
    hf: "1.043",
    ratio: 1.043,
    infinite: false,
    refusedReason: null,
    marks: [
      { letter: "B", block: 25641730 },
      { letter: "P", block: 25641730 },
    ],
  },
  {
    engine: "debt_manager",
    account: "0x9a04000000000000000000000000000000e6c200",
    collateral: "$14.02",
    debt: "$14.55",
    verdict: "liquidatable",
    hf: "0.963",
    ratio: 0.963,
    infinite: false,
    refusedReason: null,
    marks: [
      { letter: "B", block: 25641712 },
      { letter: "P", block: 25641712 },
      { letter: "S", block: 25641712 },
    ],
  },
  {
    engine: "debt_manager",
    account: "0x8f24000000000000000000000000000000c11d00",
    collateral: null,
    debt: null,
    verdict: "unknowable",
    hf: null,
    ratio: null,
    infinite: false,
    refusedReason: "sweep_failed_no_success",
    marks: [
      { letter: "B", block: 25641730 },
      { letter: "P", block: 25641730 },
      { letter: "S", block: null },
    ],
  },
  {
    engine: "aave_v3",
    account: "0x2c64000000000000000000000000000000064900",
    collateral: "$8.38",
    debt: "$0.00",
    verdict: "not-liquidatable",
    hf: null,
    ratio: null,
    infinite: true,
    refusedReason: null,
    marks: [
      { letter: "B", block: 25641730 },
      { letter: "P", block: 25641730 },
    ],
  },
];

const SPECIMEN_COLUMNS: ReadonlyArray<Column<SpecimenRow>> = [
  { id: "engine", header: "Engine", cell: (row) => <EngineChip engine={row.engine} /> },
  {
    id: "account",
    header: "Account",
    cell: (row) => <AddressMono address={row.account} copy={false} />,
  },
  {
    id: "collateral",
    header: "Collateral",
    align: "right",
    cell: (row) => row.collateral ?? EM_DASH,
  },
  { id: "debt", header: "Debt", align: "right", cell: (row) => row.debt ?? EM_DASH },
  {
    id: "hf",
    header: "Health factor",
    align: "right",
    cell: (row) =>
      row.refusedReason !== null ? (
        <RefusedTag reason={row.refusedReason} />
      ) : (
        <SeverityHF
          verdict={row.verdict}
          display={row.hf}
          ratio={row.ratio}
          infinite={row.infinite}
        />
      ),
  },
  { id: "marks", header: "Marks", cell: (row) => <MarksStamp marks={row.marks} /> },
];

/**
 * The component showcase. Dev-only: visible under `next dev` always, and in a
 * production build only when NEXT_PUBLIC_SHOW_STYLEGUIDE=1 was set at build
 * time (CI sets it so the smoke e2e can walk the specimens).
 */
export default function StyleguidePage() {
  const enabled =
    process.env.NODE_ENV !== "production" || process.env.NEXT_PUBLIC_SHOW_STYLEGUIDE === "1";
  if (!enabled) notFound();

  return (
    <>
      <div className={styles.banner} data-testid="specimen-banner">
        <span className={styles.bannerTag}>SPECIMEN</span>
        <span>
          Every value on this page is a static example (the mockup&apos;s own numbers) — nothing
          here is live data. This route is dev-only.
        </span>
      </div>

      <p className="eyebrow">Solvent · design system</p>
      <h1 style={{ marginTop: 0 }}>Styleguide</h1>

      <section className={styles.section} data-testid="sg-tokens">
        <h2>tokens · palette</h2>
        <div className={styles.swatches}>
          {PALETTE.map((name) => (
            <div key={name} className={styles.swatch}>
              <div className={styles.swatchColor} style={{ background: `var(--${name})` }} />
              <div className={styles.swatchName}>--{name}</div>
            </div>
          ))}
        </div>
        <p className={styles.note}>
          light + dark via prefers-color-scheme; data-theme override wins both directions (toggle
          in the header).
        </p>
      </section>

      <section className={styles.section} data-testid="sg-statcard">
        <h2>StatCard</h2>
        <div className={styles.statrow}>
          <StatCard label="Collateral (counted)" value="$23.41M" sub="adapter-output prices only" />
          <StatCard label="Debt" value="$9.10M" sub="rayMulCeil, chain-exact" />
          <StatCard
            label="Liquidatable"
            value={
              <>
                <span className="crit-t">3</span> / 70
              </>
            }
            sub="all dust · $31 total"
          />
          <StatCard label="Refused" value="3" sub="named reasons, counted" />
        </div>
      </section>

      <section className={styles.section} data-testid="sg-severity">
        <h2>SeverityHF — crit only from the engine&apos;s verdict</h2>
        <div className={styles.row}>
          <SeverityHF verdict="not-liquidatable" display="1.539" ratio={1.539} />
          <SeverityHF verdict="not-liquidatable" display="1.043" ratio={1.043} />
          <SeverityHF verdict="liquidatable" display="0.963" ratio={0.963} />
          <SeverityHF verdict="not-liquidatable" display={null} infinite />
          <SeverityHF verdict="unknowable" display={null} />
        </div>
        <p className={styles.note}>
          ok · warn (presentation band &lt; 1.1) · crit (engine comparator verdict) · ∞ (no debt)
          · {EM_DASH} (unknowable — never a green light)
        </p>
      </section>

      <section className={styles.section} data-testid="sg-chips">
        <h2>EngineChip · AddressMono · RefusedTag · ProjectionBadge</h2>
        <div className={styles.row}>
          <EngineChip engine="aave_v3_etherfi" />
          <EngineChip engine="debt_manager" />
          <AddressMono address="0x71aa00000000000000000000000000000004e200" href="/inspector" />
          <RefusedTag reason="sweep_failed_no_success" />
          <ProjectionBadge />
        </div>
      </section>

      <section className={styles.section} data-testid="sg-marks">
        <h2>MarksStamp — B·P·S @block grammar</h2>
        <div className={styles.row}>
          <MarksStamp
            marks={[
              { letter: "B", block: 25641712 },
              { letter: "P", block: 25641712 },
              { letter: "S", block: 25641712 },
            ]}
          />
          <MarksStamp
            marks={[
              { letter: "B", block: 25641730 },
              { letter: "P", block: 25641730 },
              { letter: "S", block: null },
            ]}
          />
        </div>
      </section>

      <section className={styles.section} data-testid="sg-stampline">
        <h2>Stampline</h2>
        <Stampline>
          <StampItem label="batch" value="bk_019fb0a2" />
          <StampItem label="marks" value="balances ✓ params ✓ sweep ✓" tone="ok" />
          <StampItem label="gate" value="2/2 engines allowed" tone="ok" />
          <StampItem label="key" value="m9a41c…" note="(deterministic)" />
        </Stampline>
      </section>

      <section className={styles.section} data-testid="sg-ribbon">
        <h2>Ribbon — two modes, watermark VECTOR, never one fake block</h2>
        <div className={styles.row}>
          <Ribbon
            mode="live"
            asOfs={[
              { label: "aave_v3", value: "@25,641,730" },
              { label: "debt_manager", value: "@25,641,712" },
              { label: "debt_manager sweep", value: "age 41s", tone: "dim" },
            ]}
          />
        </div>
        <div className={styles.row}>
          <Ribbon
            mode="live"
            superseded
            asOfs={[{ label: "aave_v3", value: "@25,641,730" }]}
          />
        </div>
        <div className={styles.row}>
          <Ribbon mode="proof" pin="bk_019fb0a2" detail="reconcile 12/12 exact" />
        </div>
      </section>

      <section className={styles.section} data-testid="sg-table">
        <h2>DataTable — sticky mono header, severity rows, refusals visible</h2>
        <DataTable
          columns={SPECIMEN_COLUMNS}
          rows={SPECIMEN_ROWS}
          rowKey={(row) => row.account}
          rowTone={(row) =>
            row.refusedReason !== null ? "refused" : row.verdict === "liquidatable" ? "crit" : "default"
          }
          ariaLabel="specimen position table"
          empty="specimen rows missing (bug in the styleguide)"
        />
      </section>

      <section className={styles.section} data-testid="sg-pagination">
        <h2>DataTable + useCursorPages (cursor pagination)</h2>
        <PaginationDemo />
      </section>

      <section className={styles.section} data-testid="sg-charts">
        <h2>SVG primitives — Sparkline · Scatter · WaterfallSteps</h2>
        <div className={styles.row}>
          <div className={styles.chartFrame}>
            <Sparkline
              label="specimen HF history with a gap"
              values={[1.51, 1.49, 1.44, 1.41, null, 1.19, 1.11, 1.05, 1.043]}
              width={220}
              height={44}
            />
            <p className={styles.note}>gap = unestablished point; the line never interpolates across it</p>
          </div>
        </div>
        <div className={styles.row}>
          <div className={styles.chartFrame}>
            <Scatter
              label="specimen risk map"
              xLabel="debt (usd, log10)"
              yLabel="liq. distance %"
              formatX={(v) => `1e${String(v)}`}
              formatY={(v) => `${String(v)}%`}
              points={[
                { id: "a", x: 6.3, y: -34.9, severity: "ok", title: "0x3c19…88af" },
                { id: "b", x: 6.1, y: -4.1, severity: "warn", title: "0x71aa…04e2" },
                { id: "c", x: 5.5, y: -29.9, severity: "ok", title: "0xb2f1…7d30" },
                { id: "d", x: 1.2, y: 0, severity: "crit", title: "0x9a04…e6c2 — liquidatable" },
                { id: "e", x: 0.9, y: -12.2, severity: "none", title: "0x2c64…0649 — no debt" },
              ]}
            />
          </div>
        </div>
        <div className={styles.row}>
          <div className={styles.chartFrame}>
            <WaterfallSteps
              label="specimen liquidation waterfall"
              steps={[
                { label: "1 · dust cohort", value: 28.11, display: "$28.11", kind: "flow" },
                { label: "2 · weETH seized", value: 2904332, display: "$2,904,332.10", kind: "flow" },
                { label: "2 · debt cleared", value: 2739936, display: "$2,739,935.95", kind: "cleared" },
                { label: "3 · liquidBTC seized", value: 962110, display: "$962,110.44", kind: "flow" },
                { label: "3 · residual bad debt", value: 262447, display: "$262,447.25", kind: "residual" },
              ]}
            />
            <p className={styles.note}>a nonzero residual can never render at zero pixels</p>
          </div>
        </div>
      </section>

      <section className={styles.section} data-testid="sg-drawer">
        <h2>Drawer — explain this number</h2>
        <DrawerDemo />
      </section>

      <section className={styles.section} data-testid="sg-truth">
        <h2>truth primitives — the honest-rendering laws</h2>
        <Stampline>
          <StampItem label="found:null →" value={renderLookupOutcome("unknowable")} tone="warn" />
          <StampItem label="found:false →" value={renderLookupOutcome("not-found")} />
          <StampItem label="null total →" value={renderNullableDecimal(null)} tone="dim" />
          <StampItem
            label="null block_time →"
            value={renderBlockTime(25641730, null)}
            note="(never an invented time)"
          />
        </Stampline>
      </section>
    </>
  );
}
