import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { ChipTone } from "@/lib/kit";
import type { FreshnessTier } from "@/lib/freshnessTiers";
import { snapshotChipParts } from "@/lib/freshness";
import { renderLookupOutcome, renderNullableDecimal, renderBlockTime } from "@/lib/format";
import { IdentityChips, KpiTile, StatusPill, VerdictHeader } from "@/components/kit";
import kit from "@/components/kit/kit.module.css";
import { ExactValue } from "@/components/ExactValue";
import { StatusChip, ChipVal, RefusedChip } from "@/components/StatusChip";
import { Skeleton } from "@/components/states/Skeleton";
import { EmptyDefinitive } from "@/components/states/EmptyDefinitive";
import { InvalidInput } from "@/components/states/InvalidInput";
import { RefusedCard } from "@/components/states/RefusedCard";
import { UnavailableCard } from "@/components/states/UnavailableCard";
import { SupersededCard } from "@/components/states/SupersededCard";
import { Sparkline } from "@/components/charts/Sparkline";
import { Scatter } from "@/components/charts/Scatter";
import { WaterfallSteps } from "@/components/charts/WaterfallSteps";
import { ContrastSpecimens } from "./ContrastSpecimens";
import { InteractionRegisterDemo } from "./InteractionRegisterDemo";
import { TableSpecimen } from "./TableSpecimen";
import { DrawerDemo } from "./DrawerDemo";
import { PaginationDemo } from "./PaginationDemo";
import styles from "./styleguide.module.css";

export const metadata: Metadata = { title: "Styleguide" };

// ---------------------------------------------------------------------------
// p1a-6 — THE LIVING CANON. The page is structured by the build contract's
// own section order (§2 palette · §1 type · §4 the page answer · §5 freshness ·
// §6 dimensions · §7 exact · §8 states · §9 table + pagination + drawer ·
// §10 identity · §11 charts + interaction register), followed by the kit's
// tiles and pills. The pre-kit components retired with the convergence (plan
// 2026-09-16, R7); every section that showed one shows its kit successor.
// Every value is a static SPECIMEN.
// ---------------------------------------------------------------------------

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

/** The closed §1 type set — exactly these fourteen tokens exist. */
const TYPE_SCALE: ReadonlyArray<{ token: string; px: string; role: string; mono: boolean }> = [
  { token: "--t-display", px: "32px", role: "page H1 — the page's one finding", mono: false },
  { token: "--t-chapter", px: "24px", role: "chapter title (H2)", mono: false },
  { token: "--t-section", px: "18px", role: "section head (H3) / dek", mono: false },
  { token: "--t-fighead", px: "17px", role: "chart finding-headline", mono: false },
  { token: "--t-body", px: "16px", role: "reading prose", mono: false },
  { token: "--t-ui", px: "14px", role: "metadata, table body, captions with content", mono: false },
  { token: "--t-meta", px: "13px", role: "dense metadata floor", mono: false },
  {
    token: "--t-floor",
    px: "12px",
    role: "labels, chips, axis ticks, chart text — ABSOLUTE floor",
    mono: false,
  },
  { token: "--t-mono-lg", px: "14px", role: "exact values, featured", mono: true },
  { token: "--t-mono", px: "13px", role: "addresses, table numerals, formulas", mono: true },
  { token: "--t-mono-sm", px: "12.5px", role: "terminal body, ledgers, identity lines", mono: true },
  { token: "--t-mono-floor", px: "12px", role: "smallest mono — chips' embedded values", mono: true },
  { token: "--t-stat-lg", px: "28px", role: "engine-panel / KPI hero value", mono: false },
  { token: "--t-stat", px: "21px", role: "KPI value", mono: false },
];

/**
 * §6 tier → chip register. Fresh is quiet, aging is amber, stale is coral outline, critical is the one escalation
 * fill; the header's live pill obeys the same law (tests/unit/live-pill.spec.ts).
 */
const TIER_TONE: Record<FreshnessTier, ChipTone> = {
  fresh: "quiet",
  aging: "warn",
  stale: "crit",
  critical: "crit-fill",
};

/** A snapshot chip: the batch's age and the SLA tier of that age, stated together. */
function TierChip({
  seconds,
  tier,
  testId,
}: {
  seconds: number;
  tier: FreshnessTier;
  testId: string;
}) {
  const parts = snapshotChipParts(18251, seconds, tier);
  return (
    <StatusChip
      tone={TIER_TONE[tier]}
      testId={testId}
      title={`specimen — the ${tier.toUpperCase()} tier of batch #18251's age`}
    >
      {parts.label} <ChipVal>{parts.age}</ChipVal>
      {parts.tierWord !== null && <> · {parts.tierWord}</>}
    </StatusChip>
  );
}

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
          Every value on this page is a static example (the mockup&apos;s own numbers), and
          none of it is live data. This route is dev-only.
        </span>
      </div>

      <p className="eyebrow">Solvent · design system</p>
      <h1 style={{ marginTop: 0 }}>Styleguide</h1>
      <p className={styles.dek}>
        The living canon: the ratified foundation, mounted. Contrast is measured live from the
        rendered swatches; the nine status dimensions and the chart interaction register are the
        reference implementations; the kit&apos;s header, identity chips, tiles, pills, table and
        drawer are the primitives every page composes.
      </p>

      {/* ---- §2 palette + the live contrast lab -------------------------- */}
      <section className={styles.section} data-testid="sg-tokens">
        <h2>tokens · palette · live contrast — the page measures itself</h2>
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
          in the header). Below: every §04 text pair on its worst ground, MEASURED from resolved
          styles at render time — plus one known-bad probe whose failing ratio proves the
          computation is live.
        </p>
        <ContrastSpecimens />
      </section>

      {/* ---- §1 the closed type set -------------------------------------- */}
      <section className={styles.section} data-testid="sg-type">
        <h2>type scale · the closed --t-* set — no token below 12px exists</h2>
        {TYPE_SCALE.map((entry) => (
          <div key={entry.token} className={styles.typeRow} data-testid="type-token">
            <span className={styles.typeName}>
              {entry.token} · {entry.px}
            </span>
            <span
              style={{
                fontSize: `var(${entry.token})`,
                fontFamily: entry.mono ? "var(--mono)" : "var(--sans)",
              }}
            >
              {entry.mono ? "$2,835,019.429399" : "At risk now: $8.5K of eligible debt"}
            </span>
            <span className={styles.typeRole}>{entry.role}</span>
          </div>
        ))}
        <p className={styles.note}>
          weights: findings 650–700 · table emphasis 600 · body 400 · uppercase+tracking only in
          the sans status vocabulary at ≥12px · numerals in data contexts are always tabular.
        </p>
      </section>

      {/* ---- §4 the page answer ------------------------------------------ */}
      <section className={styles.section} data-testid="sg-verdict">
        <h2>VerdictHeader · kicker · the computed sentence · dek · identity — four tones</h2>
        <div className={styles.bannerStack}>
          <VerdictHeader
            testId="sg-verdict-crit"
            tone="crit"
            kicker="Cash book · right now"
            emphasis="$6,840 of Cash debt is liquidatable right now,"
            rest="across 2 accounts."
            dek="2 more positions are technically liquidatable but total $75.75 — below the $100 line and not headlined. 1 account is within 10% of its borrow cap, carrying $142K. 1 position could not be computed this batch and is counted, not hidden."
            chips={[
              { label: "Batch", value: "18,251" },
              { label: "Snapshot", value: "48s · fresh", tone: "ok" },
              { label: "Coverage", value: "551 / 552 computed" },
              { label: "Current", value: "not projected" },
            ]}
          />
          <VerdictHeader
            testId="sg-verdict-warn"
            tone="warn"
            kicker="Verification · this deployment"
            emphasis="The proof receipt is absent."
            dek="Two subjects, never one: the pinned proof and the live batch."
            chips={[
              { label: "Pinned proof", value: "bk_019fb0a2" },
              { label: "Live batch", value: "#18251" },
              { label: "Receipt", value: "absent", tone: "warn" },
            ]}
          />
          <VerdictHeader
            testId="sg-verdict-ok"
            tone="ok"
            kicker="History · Cash"
            emphasis="Debt held near $9.10M across the last 7 days."
            dek="One engine per view; a missing hour is a hole, never a zero."
            chips={[
              { label: "Engine", value: "debt_manager" },
              { label: "Window", value: "7d · hourly" },
              { label: "Holes", value: "2 absent · 1 withheld", tone: "warn" },
            ]}
          />
          <VerdictHeader
            testId="sg-verdict-refused"
            tone="refused"
            kicker="Inspector · 0x80b3…6e1d"
            emphasis="Verdict unavailable — the engine won't guess."
            dek="The Debt Manager sweep failed twice at this batch, so it refuses to value this account rather than serve an unproven number. Chain activity is retained below."
            chips={[
              { label: "Batch", value: "#18251" },
              { label: "Snapshot", value: "48s" },
              {
                label: "Refused",
                value: "sweep failed twice",
                tone: "refused",
                title: "sweep_failed_no_success",
              },
            ]}
          />
          {/* THE LAW, demonstrated: a header composed with an EMPTY chip list
              renders the dashed refusal chip that names the omission — the
              answer never stands without its identity. */}
          <VerdictHeader
            testId="sg-verdict-identity-law"
            tone="ok"
            kicker="specimen · the identity law"
            emphasis="This header was composed with an empty chip list on purpose."
            dek="The strip below is the kit's own refusal, not a chip this page passed."
            chips={[]}
          />
        </div>
        <p className={styles.note}>
          the emphasis carries the verdict color in the -text grade; a refused answer wears ink, never
          a tier&apos;s color. The header never renders without identity — an empty chip list renders
          the dashed refusal chip. The page&apos;s drawer button rides the strip&apos;s trailing slot.
          A header whose data is superseded, refused or partial changes tone and sentence — it never
          keeps the happy sentence; partial coverage shows as the warn Coverage chip, superseded as
          the state card.
        </p>
      </section>

      {/* ---- §5 freshness tiers ------------------------------------------ */}
      <section className={styles.section} data-testid="sg-freshness">
        <h2>freshness tiers · the SNAPSHOT chip — all five states</h2>
        <div className={styles.row}>
          <TierChip seconds={48} tier="fresh" testId="sg-tier-fresh" />
          <TierChip seconds={300} tier="aging" testId="sg-tier-aging" />
          <TierChip seconds={1320} tier="stale" testId="sg-tier-stale" />
          <TierChip seconds={65_532} tier="critical" testId="sg-tier-critical" />
          <StatusChip
            tone="unknown"
            dot
            testId="sg-tier-unknown"
            title="not a tier — unknown age must never read as fresh, and never as zero seconds"
          >
            AGE UNKNOWN — NO BATCH METADATA
          </StatusChip>
        </div>
        <p className={styles.note}>
          fresh ≤ 120s (2× poll) · aging ≤ 360s (price ceiling) · stale ≤ 5,580s (DM sweep worst
          case) · critical beyond — thresholds runtime-derived from /v1/meta constants. The tier
          word and the age render together on every chip, so severity survives grayscale; FRESH
          has no tier word and no green. The one escalation FILL is shared by exactly two things:
          critical comparators and critical age.
        </p>
      </section>

      {/* ---- §6 the nine dimensions -------------------------------------- */}
      <section className={styles.section} data-testid="sg-dimensions">
        <h2>status vocabulary · nine dimensions — no dimension may recolor another</h2>

        <div className={styles.dimRow} data-testid="sg-dim-1">
          <p className={styles.dimLabel}>1 · connection — transport posture, never health, never green</p>
          <div className={styles.row}>
            <StatusChip tone="accent" dot>
              STREAM CONNECTED
            </StatusChip>
            <StatusChip tone="warn" dot>
              RECONNECTING · <ChipVal>3rd attempt</ChipVal>
            </StatusChip>
            <StatusChip tone="crit" dot>
              DISCONNECTED <ChipVal>02:41</ChipVal>
            </StatusChip>
          </div>
        </div>

        <div className={styles.dimRow} data-testid="sg-dim-2">
          <p className={styles.dimLabel}>2 · snapshot age — the SLA tier row above; the two ends here</p>
          <div className={styles.row}>
            <TierChip seconds={48} tier="fresh" testId="sg-dim-2-fresh" />
            <TierChip seconds={65_532} tier="critical" testId="sg-dim-2-critical" />
          </div>
        </div>

        <div className={styles.dimRow} data-testid="sg-dim-3">
          <p className={styles.dimLabel}>3 · coverage — counts reconcile visibly, no silent shrinkage</p>
          <div className={styles.row}>
            <StatusChip tone="quiet">
              COVERAGE <ChipVal>2/2</ChipVal> ENGINES
            </StatusChip>
            <StatusChip tone="warn">
              COVERAGE <ChipVal>1/2</ChipVal> · DM WITHHELD
            </StatusChip>
            <StatusChip tone="quiet">
              <ChipVal>9,958 / 9,964</ChipVal> COMPUTED · <ChipVal>6</ChipVal> REFUSED
            </StatusChip>
          </div>
        </div>

        <div className={styles.dimRow} data-testid="sg-dim-4">
          <p className={styles.dimLabel}>4 · run state — completion is not health</p>
          <div className={styles.row}>
            <StatusChip tone="quiet">IDLE</StatusChip>
            <StatusChip tone="accent">
              RUNNING <ChipVal>2 scenarios…</ChipVal>
            </StatusChip>
            <StatusChip tone="quiet">
              COMPLETE <ChipVal>04:11:07Z</ChipVal>
            </StatusChip>
            <StatusChip tone="warn">
              PARTIAL <ChipVal>3/5</ChipVal>
            </StatusChip>
            <StatusChip tone="warn">SUPERSEDED — RESULTS FOR PREVIOUS INPUT</StatusChip>
            <StatusChip tone="crit">RUN FAILED · RETRY</StatusChip>
          </div>
        </div>

        <div className={styles.dimRow} data-testid="sg-dim-5">
          <p className={styles.dimLabel}>
            5 · knowledge state — four visible, counted objects; never a dash that reads as zero
          </p>
          <div className={styles.row}>
            <StatusChip tone="quiet">COMPUTED</StatusChip>
            <RefusedChip cause="sweep failed twice" code="sweep_failed_no_success" />
            <RefusedChip word="WITHHELD" cause="missing observation" />
            <StatusChip tone="unknown">
              UNANSWERED · <ChipVal>not asked of this engine</ChipVal>
            </StatusChip>
          </div>
        </div>

        <div className={styles.dimRow} data-testid="sg-dim-6">
          <p className={styles.dimLabel}>
            6 · risk verdict — green is rationed to the comfortable verdict alone
          </p>
          <div className={styles.row}>
            <StatusChip tone="ok">
              HEALTHY · <ChipVal>HF 1.539</ChipVal>
            </StatusChip>
            <StatusChip tone="warn">
              NEAR THRESHOLD · <ChipVal>0.8% of cap</ChipVal>
            </StatusChip>
            <StatusChip tone="crit-fill">
              LIQUIDATABLE · <ChipVal>HF 0.4971</ChipVal>
            </StatusChip>
            <StatusChip tone="warn">VERDICT UNAVAILABLE</StatusChip>
          </div>
        </div>

        <div className={styles.dimRow} data-testid="sg-dim-7">
          <p className={styles.dimLabel}>
            7 · current vs projected — the dashed badge names its scenario and config version
          </p>
          <div className={styles.row}>
            <StatusChip tone="quiet">
              CURRENT · <ChipVal>batch #18251</ChipVal>
            </StatusChip>
            <StatusPill tone="projection">Projection · ETH −20% v3</StatusPill>
          </div>
        </div>

        <div className={styles.dimRow} data-testid="sg-dim-8">
          <p className={styles.dimLabel}>
            8 · economic materiality — a label, not a verdict modifier; it never hides a row
          </p>
          <div className={styles.row}>
            <StatusChip tone="quiet">
              <ChipVal>$8.5K</ChipVal> ELIGIBLE
            </StatusChip>
            <StatusChip tone="quiet">
              DUST · <ChipVal>{"<$0.01"}</ChipVal>
            </StatusChip>
            <StatusChip tone="quiet">
              DUST · <ChipVal>$0.33</ChipVal>
            </StatusChip>
          </div>
        </div>

        <div className={styles.dimRow} data-testid="sg-dim-9">
          <p className={styles.dimLabel}>9 · evidence availability — a claim without proof says so</p>
          <div className={styles.row}>
            <StatusChip tone="accent">
              EVIDENCE · <ChipVal>6 rows</ChipVal>
            </StatusChip>
            <StatusChip tone="quiet">
              EVIDENCE · <ChipVal>3 pins</ChipVal>
            </StatusChip>
            <StatusChip tone="unknown">EVIDENCE UNAVAILABLE — CLAIM STANDS UNVERIFIED</StatusChip>
          </div>
        </div>

        <h3 className={styles.subhead}>compositions · fixed order: verdict · materiality · knowledge · freshness · (projection) · (evidence)</h3>

        <div className={styles.dimRow} data-testid="sg-comp-1">
          <div className={styles.row}>
            <StatusChip tone="crit-fill">
              LIQUIDATABLE · <ChipVal>HF 0.4971</ChipVal>
            </StatusChip>
            <StatusChip tone="quiet">
              DUST · <ChipVal>{"<$0.01"}</ChipVal>
            </StatusChip>
            <StatusChip tone="quiet">COMPUTED</StatusChip>
            <TierChip seconds={65_532} tier="critical" testId="sg-comp-1-snapshot" />
          </div>
          <p className={styles.compRead}>
            A liquidatable dust position, computed, on a critically old snapshot — each chip keeps
            its own dimension&apos;s color, and the two escalation fills state two different facts.
          </p>
        </div>

        <div className={styles.dimRow} data-testid="sg-comp-2">
          <div className={styles.row}>
            <StatusChip tone="ok">
              HEALTHY · <ChipVal>HF 1.539</ChipVal>
            </StatusChip>
            <StatusChip tone="quiet">
              <ChipVal>$8.5K</ChipVal> ELIGIBLE
            </StatusChip>
            <StatusChip tone="quiet">COMPUTED</StatusChip>
            <StatusChip tone="quiet">
              SNAPSHOT <ChipVal>48s</ChipVal>
            </StatusChip>
            <StatusPill tone="projection">Projection · ETH −20% v3</StatusPill>
          </div>
          <p className={styles.compRead}>
            A comfortable projected verdict — the projection rides as a dashed badge naming its
            scenario and config version; it never wears a fill.
          </p>
        </div>

        <div className={styles.dimRow} data-testid="sg-comp-3">
          <div className={styles.row}>
            <StatusChip tone="warn">VERDICT UNAVAILABLE</StatusChip>
            <RefusedChip cause="sweep failed twice" code="sweep_failed_no_success" />
            <TierChip seconds={300} tier="aging" testId="sg-comp-3-snapshot" />
            <StatusChip tone="unknown">EVIDENCE UNAVAILABLE — CLAIM STANDS UNVERIFIED</StatusChip>
          </div>
          <p className={styles.compRead}>
            A refusal composes like any answer: visible and counted, plain cause first, wire code
            secondary — the sentence never collapses into one badge.
          </p>
        </div>
      </section>

      {/* ---- §7 the exact-layer affordance ------------------------------- */}
      <section className={styles.section} data-testid="sg-exact">
        <h2>ExactValue · dotted underline + ⧉ — an exact string is underneath</h2>
        <p className={styles.exactDemo}>
          Featured KPI:{" "}
          <span data-testid="sg-exact-featured">
            <ExactValue human="$2.84M" exact="$2,835,019.429399" />
          </span>{" "}
          — hover or focus shows the exact string (title/aria); Enter copies it. Mandatory
          wherever human ≠ exact: KPIs, chart annotations, table money at display precision,
          banner values.
        </p>
        <p className={styles.exactDemo}>
          Forbidden arm (already exact):{" "}
          <span data-testid="sg-exact-forbidden">
            <ExactValue human="$14.55" exact="$14.55" />
          </span>{" "}
          — renders plain: no cue, no title, no tab stop. A false scent is a lie.
        </p>
      </section>

      {/* ---- §8 the six designed states ---------------------------------- */}
      <section className={styles.section} data-testid="sg-states">
        <h2>states · six designed states — the unknowable never looks like zero</h2>
        <div className={styles.stateGrid}>
          <section className={styles.stateCard} data-testid="sg-state-loading">
            <p className={styles.stateKicker}>loading — the skeleton reserves the exact final geometry</p>
            <Skeleton width="220px" height="21px" />
            <Skeleton width="150px" height="14px" />
            <Skeleton width="180px" height="14px" />
            <p className={styles.note}>
              shimmer runs only under prefers-reduced-motion: no-preference; a spinner never
              replaces a previously valid result.
            </p>
          </section>
          <EmptyDefinitive testId="sg-state-empty" />
          <InvalidInput testId="sg-state-invalid" />
          <RefusedCard testId="sg-state-refused" />
          <UnavailableCard testId="sg-state-unavailable" />
          <SupersededCard testId="sg-state-superseded" />
        </div>
      </section>

      {/* ---- §9 table pattern + pagination + drawer ---------------------- */}
      <section className={styles.section} data-testid="sg-table">
        <h2>KitTable · a refused row is dimmed, never dropped; small &amp; dust fold behind the toggle</h2>
        <TableSpecimen />
      </section>

      <section className={styles.section} data-testid="sg-pagination">
        <h2>KitTable + useCursorPages · cursor pagination</h2>
        <PaginationDemo />
      </section>

      <section className={styles.section} data-testid="sg-drawer">
        <h2>Drawer · methodology &amp; evidence — the doctrine lives here, one click from the answer</h2>
        <DrawerDemo />
      </section>

      {/* ---- §10 identity: each truth its own chip ----------------------- */}
      <section className={styles.section} data-testid="sg-identity">
        <h2>IdentityChips · each truth its own chip — the strip under every H1</h2>
        <IdentityChips
          testId="sg-identity-strip"
          chips={[
            { label: "Batch", value: "#18251" },
            { label: "Snapshot", value: "48s", title: "specimen — snapshot freshness of batch #18251" },
            { label: "Coverage", value: "2/2 engines" },
            { label: "Evidence", value: "3 pins" },
          ]}
          trailing={<span className={kit.sub}>trailing slot — the page&apos;s drawer button rides here</span>}
        />
        <IdentityChips
          testId="sg-identity-tones"
          chips={[
            { label: "Reconcile", value: "12/12 exact", tone: "ok" },
            { label: "Coverage", value: "1/2 · DM withheld", tone: "warn" },
            { label: "Snapshot", value: "18h 12m · critical", tone: "crit" },
            {
              label: "Refused",
              value: "sweep failed twice",
              tone: "refused",
              title: "sweep_failed_no_success",
            },
          ]}
        />
        <p className={styles.note}>
          a label and its value, one truth per chip; the value carries the tone in the -text grade and
          the border keeps the chroma. The refused chip is dashed and wears no tier&apos;s color; its
          wire code rides in the title, never as the label.
        </p>
      </section>

      {/* ---- §11 chart conventions + the interaction register ------------ */}
      <section className={styles.section} data-testid="sg-charts">
        <h2>SVG primitives · Sparkline · Scatter · WaterfallSteps</h2>
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
                { id: "d", x: 1.2, y: 0, severity: "crit", title: "0x9a04…e6c2 · liquidatable" },
                { id: "e", x: 0.9, y: -12.2, severity: "none", title: "0x2c64…0649 · no debt" },
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

      <section className={styles.section} data-testid="sg-interaction">
        <h2>chart interaction register · the §11 reference implementation</h2>
        <InteractionRegisterDemo />
      </section>

      {/* ---- the kit's tiles and pills ----------------------------------- */}
      <p className={styles.groupNote}>
        the kit — the primitives every page composes; the pre-kit set retired with the convergence
      </p>

      <section className={styles.section} data-testid="sg-kpi">
        <h2>KpiTile · neutral · crit · warn · ok · refused (dashed) · pending</h2>
        <div className={kit.kpis}>
          <KpiTile
            testId="sg-kpi-neutral"
            label="Collateral (counted)"
            value="$23.41M"
            sub="adapter-output prices only"
          />
          <KpiTile
            testId="sg-kpi-crit"
            tone="crit"
            label="Liquidatable"
            value="3 / 70"
            sub="all dust · $31 total"
          />
          <KpiTile testId="sg-kpi-warn" tone="warn" label="Near cap" value="7" sub="within 10% of the line" />
          <KpiTile testId="sg-kpi-ok" tone="ok" label="Reconcile" value="12/12 exact" sub="the receipt matches" />
          <KpiTile
            testId="sg-kpi-refused"
            tone="refused"
            label="Debt · newest hour"
            value="withheld"
            sub="missing observation — never a zero"
          />
          <KpiTile
            testId="sg-kpi-pending"
            pending
            label="Accounts walked"
            value="9,964"
            sub="the walk is in progress"
          />
        </div>
        <p className={styles.note}>
          a refused tile is dashed and prints the gap word in ink — never a tier&apos;s color, never 0;
          a pending tile prints … and is aria-busy until the walk answers.
        </p>
      </section>

      <section className={styles.section} data-testid="sg-pills">
        <h2>StatusPill · the status vocabulary — crit · warn · ok · refused · projection</h2>
        <div className={styles.row}>
          <StatusPill tone="crit">Liquidatable</StatusPill>
          <StatusPill tone="warn">Near cap</StatusPill>
          <StatusPill tone="ok">Healthy</StatusPill>
          <StatusPill tone="refused" title="sweep_failed_no_success">
            Not computed
          </StatusPill>
          <StatusPill tone="projection">Projection · ETH −20% v3</StatusPill>
        </div>
        <p className={styles.note}>
          crit only from the engine&apos;s comparator verdict · warn is the presentation band · green is
          rationed to the comfortable verdict · refused wears no tier&apos;s color, its plain cause is the
          label and its wire code the title · projection is dashed and never filled.
        </p>
      </section>

      <section className={styles.section} data-testid="sg-truth">
        <h2>truth primitives · the honest-rendering laws</h2>
        <dl className={styles.kv}>
          <dt>found:null →</dt>
          <dd className={styles.kvWarn}>{renderLookupOutcome("unknowable")}</dd>
          <dt>found:false →</dt>
          <dd>{renderLookupOutcome("not-found")}</dd>
          <dt>null total →</dt>
          <dd className={styles.kvDim}>{renderNullableDecimal(null)}</dd>
          <dt>null block_time →</dt>
          <dd>
            {renderBlockTime(25641730, null)} <span className={kit.sub}>(never an invented time)</span>
          </dd>
        </dl>
      </section>
    </>
  );
}
