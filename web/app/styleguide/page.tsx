import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ChipTone } from "@/lib/kit";
import type { FreshnessTier } from "@/lib/freshnessTiers";
import { humanAge } from "@/lib/freshness";
import { renderLookupOutcome, renderNullableDecimal, renderBlockTime, shortHex } from "@/lib/format";
import { deriveApiView } from "@/lib/api-view";
import { rowStandingLabel } from "@/lib/cash-rows";
import { livePillWords } from "@/lib/live-pill";
import { engineList, LEGACY_FOLD_TITLE, PIPELINE_STEPS } from "@/lib/prose";
import { GITHUB_LABEL } from "@/lib/chrome";
import {
  ChartCard,
  IdentityChips,
  KpiTile,
  LegacyFold,
  LivePillView,
  SectionHead,
  StateCard,
  StatusPill,
  StepStrip,
  VerdictHeader,
} from "@/components/kit";
import { GithubGlyph } from "@/components/kit/HeaderGlyphs";
import kit from "@/components/kit/kit.module.css";
import { ThemeToggle } from "@/components/ThemeToggle";
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
import { ToggleGroupDemo } from "./ToggleGroupDemo";
import {
  SPECIMEN_BASE_ROWS,
  SPECIMEN_BATCH,
  SPECIMEN_COVERAGE,
  SPECIMEN_CRIT_HEADLINE,
  SPECIMEN_OK_COVERAGE,
  SPECIMEN_OK_HEADLINE,
  SPECIMEN_REFUSAL_CAUSE,
  SPECIMEN_REFUSAL_CODE,
  SPECIMEN_REFUSAL_TITLE,
} from "./specimen-book";
import styles from "./styleguide.module.css";

export const metadata: Metadata = { title: "Styleguide" };

// ---------------------------------------------------------------------------
// THE LIVING CANON. The page is structured by the build contract's own
// section order (§2 palette · §1 type · §4 the page answer · §5 freshness ·
// §6 dimensions · §7 exact · §8 states · §9 table + pagination + drawer ·
// §10 identity · §11 charts + interaction register), followed by the kit's
// parts: tiles, pills, the live pill, controls, strips, steps, the legacy
// fold and the head badge. Every section shows the kit the product composes,
// and the canon follows the product: a specimen's words are a page's own
// words — built by the function that page calls wherever one exists — and a
// refusal is spelled with a wire code the phrasebook can read. Every value
// is a static SPECIMEN.
// ---------------------------------------------------------------------------

/** The neutral header's specimen: a page whose headline is a statement of record — the API's own, from its own view model. */
const RECORD = deriveApiView("https://api.specimen.example");

/** The Book specimen's refused row: its pill says what the Book's own table says. */
const REFUSED_ROW = SPECIMEN_BASE_ROWS.flatMap((row) => (row.kind === "refused" ? [row.row] : []))[0];

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

/** The one type scale — exactly these twelve tokens exist, none below 12px. */
const TYPE_SCALE: ReadonlyArray<{ token: string; px: string; role: string; mono: boolean }> = [
  { token: "--type-hero", px: "44px", role: "The Overview's headline only (32px on a phone)", mono: false },
  { token: "--type-h1", px: "30px", role: "A page's verdict headline (24px on a phone)", mono: false },
  { token: "--type-kpi", px: "26px", role: "A KPI tile's figure (22px on a phone)", mono: false },
  { token: "--type-h2", px: "17px", role: "A section head; a tile's state word", mono: false },
  { token: "--type-dek", px: "16px", role: "The verdict dek", mono: false },
  { token: "--type-card", px: "15px", role: "A card, fold, drawer or state-card title", mono: false },
  { token: "--type-body", px: "14px", role: "Table cells, card text, nav, drawer prose", mono: false },
  { token: "--type-label", px: "13px", role: "Tile labels, step descriptions, controls", mono: false },
  { token: "--type-small", px: "12.5px", role: "Chips, sub-labels, table headers, notes", mono: false },
  { token: "--type-floor", px: "12px", role: "Axis ticks, pills — the absolute floor", mono: false },
  { token: "--type-mono", px: "13px", role: "Addresses, exact values", mono: true },
  { token: "--type-mono-sm", px: "12.5px", role: "Small exact values, wire codes", mono: true },
];

/**
 * §6 tier → chip register. Fresh wears no colour, aging is amber, stale is coral outline, critical is the one
 * escalation fill; the header's live pill obeys the same law (tests/unit/live-pill.spec.ts).
 */
const TIER_TONE: Record<FreshnessTier, ChipTone> = {
  fresh: "quiet",
  aging: "warn",
  stale: "crit",
  critical: "crit-fill",
};

/** The live pill's words, from the pill's own lib: connected and fresh, connected and aging, reconnecting, off. */
const LIVE = {
  connected: livePillWords({ streamState: "open", hasBase: true, batchId: 18_251, ageSeconds: 42, ageUnresolved: false, tier: "fresh" }),
  aging: livePillWords({ streamState: "open", hasBase: true, batchId: 18_251, ageSeconds: 300, ageUnresolved: false, tier: "aging" }),
  reconnecting: livePillWords({ streamState: "waiting", hasBase: true, batchId: 18_251, ageSeconds: 42, ageUnresolved: false, tier: "fresh" }),
  off: livePillWords({ streamState: "closed", hasBase: false, batchId: null, ageSeconds: null, ageUnresolved: false, tier: null }),
} as const;

/** The one engine a withheld-coverage specimen names, in the label form the chips use. */
const CASH_LABEL = engineList(["debt_manager"]);

/** A snapshot chip in the words a page's own Snapshot chip prints: the batch's age and the SLA tier of that age, stated together. */
function TierChip({
  seconds,
  tier,
  testId,
}: {
  seconds: number;
  tier: FreshnessTier;
  testId: string;
}) {
  return (
    <StatusChip
      tone={TIER_TONE[tier]}
      testId={testId}
      title={`Specimen — the ${tier} tier of batch ${SPECIMEN_BATCH}'s age`}
    >
      Snapshot <ChipVal>{humanAge(seconds)}</ChipVal> · {tier}
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
        <span className={styles.bannerTag}>Specimen</span>
        <span>
          Every value on this page is a static example (the mockup&apos;s own numbers), and
          none of it is live data. This route is dev-only.
        </span>
      </div>

      <header className={styles.title}>
        <p className={kit.kick}>Solvent · design system</p>
        <h1 className={kit.h1}>Styleguide</h1>
        <p className={styles.dek}>
          The living canon: the ratified foundation, mounted. Contrast is measured live from the rendered swatches; the
          kit&apos;s header, identity chips, tiles, pills, live pill, controls, strips, steps, folds, table and drawer
          are the primitives every page composes, and each wears the one tone grammar and the one set of state
          registers (lib/kit.ts).
        </p>
      </header>

      {/* ---- §2 palette + the live contrast lab -------------------------- */}
      <section className={styles.section} data-testid="sg-tokens">
        <h2>Tokens · palette and live contrast — the page measures itself</h2>
        <div className={styles.swatches}>
          {PALETTE.map((name) => (
            <div key={name} className={styles.swatch}>
              <div className={styles.swatchColor} style={{ background: `var(--${name})` }} />
              <div className={styles.swatchName}>--{name}</div>
            </div>
          ))}
        </div>
        <p className={styles.note}>
          Light and dark via prefers-color-scheme; the data-theme override wins in both directions (the theme control
          in the header). Below: every §04 text pair on its worst ground, measured from resolved styles at render time,
          and one known-bad probe whose failing ratio proves the computation is live.
        </p>
        <ContrastSpecimens />
      </section>

      {/* ---- §1 the one type scale ---------------------------------------- */}
      <section className={styles.section} data-testid="sg-type">
        <h2>Type · the one scale, --type-* — no token below 12px exists</h2>
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
          Weights: 600 for a finding, a title or emphasis (b and strong are one weight everywhere), 500 for a pressed
          control or a state word, 400 for body. Capitals appear only in the kicker and the PROJECTION badge, set by
          CSS; every line is written in sentence case. Numerals in data contexts are tabular. The retired --t-* and
          --fs-* names resolve onto this scale by role. Breakpoints: 640 (phone), 900 (grids stack), 1180 (two-row
          header), 1280 (brand tag hides).
        </p>
      </section>

      {/* ---- §4 the page answer ------------------------------------------ */}
      <section className={styles.section} data-testid="sg-verdict">
        <h2>VerdictHeader · kicker, sentence, dek, identity — five tones and the absent register</h2>
        <div className={styles.bannerStack}>
          {/* crit — a verdict: the Book's own headline over the table specimen's rows, every figure the table's. */}
          <VerdictHeader
            testId="sg-verdict-crit"
            tone={SPECIMEN_CRIT_HEADLINE.tone}
            kicker="Cash book · right now"
            emphasis={SPECIMEN_CRIT_HEADLINE.emphasis}
            rest={SPECIMEN_CRIT_HEADLINE.rest}
            dek={SPECIMEN_CRIT_HEADLINE.dek}
            chips={[
              { label: "Batch", value: SPECIMEN_BATCH },
              { label: "Snapshot", value: "48s · fresh" },
              { label: "Coverage", value: SPECIMEN_COVERAGE },
              { label: "Current, not projected", value: "" },
            ]}
          />
          {/* warn — a verdict that fell short: a receipt that drifted. Only the finding wears the tone; the scope beside
              it is ink, and the live batch is named in the dek alone. A FAILED receipt is crit, never warn. */}
          <VerdictHeader
            testId="sg-verdict-warn"
            tone="warn"
            kicker="Verification · this deployment"
            emphasis="The last reconcile run drifted from the chain,"
            rest="84 of 87 checked rows matched; 3 rows drifted."
            dek="No exactness is claimed for this deployment until a run matches. Batch 18,251, served now, is live data; no check covers it."
            chips={[
              { label: "Proof pin", value: "5f0b3e2a" },
              { label: "Live batch", value: SPECIMEN_BATCH },
              { label: "Receipt", value: "drift · 84/87", tone: "warn" },
              { label: "Batch key", value: shortHex("9a4a7c1d3e8b52f0a61c9d47e2b3f5a2b9") },
            ]}
          />
          {/* ok — green is a HEALTH verdict and nothing else: the Book's own words when a complete walk finds no
              position liquidatable. A record that merely answered never wears it. */}
          <VerdictHeader
            testId="sg-verdict-ok"
            tone={SPECIMEN_OK_HEADLINE.tone}
            kicker="Cash book · right now"
            emphasis={SPECIMEN_OK_HEADLINE.emphasis}
            rest={SPECIMEN_OK_HEADLINE.rest}
            dek={SPECIMEN_OK_HEADLINE.dek}
            chips={[
              { label: "Batch", value: SPECIMEN_BATCH },
              { label: "Snapshot", value: "48s · fresh" },
              { label: "Coverage", value: SPECIMEN_OK_COVERAGE },
              { label: "Current, not projected", value: "" },
            ]}
          />
          {/* neutral — a statement of record is INK: the API page's own header, from its own view model. History,
              Activity and the API state what is on record; none of them is a verdict, so none wears a colour. */}
          <VerdictHeader
            testId="sg-verdict-neutral"
            tone={RECORD.headline.tone}
            kicker={RECORD.kicker}
            emphasis={RECORD.headline.emphasis}
            rest={RECORD.headline.rest}
            dek={RECORD.headline.dek}
            chips={RECORD.chips}
          />
          {/* refused — the absent register: a headline that states there is no answer is ink-2, the WHOLE line, with
              a dashed chip; never a tier's colour, never half-dimmed. */}
          <VerdictHeader
            testId="sg-verdict-refused"
            tone="refused"
            kicker="Inspector · 0x80b3…6e1d"
            emphasis="Verdict unavailable"
            rest="— the engine won't guess."
            dek="The Debt Manager's collateral sweep failed at this batch, so it refuses to value this account rather than serve an unproven number. Chain activity is retained below."
            chips={[
              { label: "Batch", value: SPECIMEN_BATCH },
              { label: "Snapshot", value: "48s · fresh" },
              {
                label: "Refused",
                value: SPECIMEN_REFUSAL_CAUSE,
                tone: "refused",
                title: SPECIMEN_REFUSAL_CODE,
              },
            ]}
            actions={
              <a href="#sg-drawer-section" className={`${kit.btn} ${kit.btnGhost}`}>
                The drawer specimen ↓
              </a>
            }
          />
          {/* THE LAW, demonstrated: a header composed with an EMPTY chip list
              renders the dashed refusal chip that names the omission — the
              answer never stands without its identity. The sentence is a
              record, so it is ink. */}
          <VerdictHeader
            testId="sg-verdict-identity-law"
            tone="neutral"
            kicker="Specimen · the identity law"
            emphasis="This header was composed with an empty chip list on purpose."
            dek="The strip below is the kit's own refusal, not a chip this page passed."
            chips={[]}
          />
        </div>
        <p className={styles.note}>
          A record is ink; only a verdict wears tone. Crit and warn are verdicts that went wrong or fell short; ok is a
          health verdict — nothing is liquidatable, the receipt is exact — and never means &quot;the data
          answered&quot;; neutral is a statement of record, including an empty one; refused is the absent register:
          a headline that says there is no answer (unavailable, refused, not run, not served) is ink-2 from its first
          word to its last. The header never renders without identity. The page&apos;s actions take their own column
          to the right of the chips (under them on a phone) and never wrap beneath a chip.
        </p>
      </section>

      {/* ---- §5 freshness tiers ------------------------------------------ */}
      <section className={styles.section} data-testid="sg-freshness">
        <h2>Freshness tiers · the snapshot chip, all five states</h2>
        <div className={styles.row}>
          <TierChip seconds={48} tier="fresh" testId="sg-tier-fresh" />
          <TierChip seconds={300} tier="aging" testId="sg-tier-aging" />
          <TierChip seconds={1320} tier="stale" testId="sg-tier-stale" />
          <TierChip seconds={65_532} tier="critical" testId="sg-tier-critical" />
          <StatusChip
            tone="unknown"
            dot
            testId="sg-tier-unknown"
            title="Not a tier — an unknown age never reads as fresh, and never as zero seconds"
          >
            Age unknown — no batch metadata
          </StatusChip>
        </div>
        <p className={styles.note}>
          Fresh ≤ 120s (2× poll) · aging ≤ 360s (price ceiling) · stale ≤ 5,580s (DM sweep worst case) · critical
          beyond — thresholds runtime-derived from /v1/meta constants. The tier word and the age render together on
          every chip, so severity survives grayscale; fresh names its tier and wears no colour, never green — it is a
          record. An unknown age is not a tier: it is dashed, and never reads as fresh or as zero seconds. The one
          escalation fill is shared by exactly two things: critical comparators and critical age.
        </p>
      </section>

      {/* ---- §6 the nine dimensions -------------------------------------- */}
      <section className={styles.section} data-testid="sg-dimensions">
        <h2>Status vocabulary · nine dimensions — no dimension may recolor another</h2>
        <p className={styles.note}>
          The status-chip family below is the earlier header vocabulary, kept as the reference for the nine dimensions;
          pages compose IdentityChips and StatusPill. All three wear the one tone grammar: live is the accent, a
          verdict wears its tier, an operational state is plain, and an absence is ink-2 — dashed when refused or
          unknown, never a tier&apos;s colour.
        </p>

        <div className={styles.dimRow} data-testid="sg-dim-1">
          <p className={styles.dimLabel}>
            1 · Connection — posture, never health: live is the accent, reconnecting is amber, off is plain
          </p>
          <div className={styles.row}>
            <StatusChip tone="accent" dot>
              Stream connected
            </StatusChip>
            <StatusChip tone="warn" dot>
              Reconnecting · <ChipVal>3rd attempt</ChipVal>
            </StatusChip>
            <StatusChip tone="quiet" dot>
              Disconnected <ChipVal>02:41</ChipVal>
            </StatusChip>
          </div>
        </div>

        <div className={styles.dimRow} data-testid="sg-dim-2">
          <p className={styles.dimLabel}>2 · Snapshot age — the tier row above; the two ends here</p>
          <div className={styles.row}>
            <TierChip seconds={48} tier="fresh" testId="sg-dim-2-fresh" />
            <TierChip seconds={65_532} tier="critical" testId="sg-dim-2-critical" />
          </div>
        </div>

        <div className={styles.dimRow} data-testid="sg-dim-3">
          <p className={styles.dimLabel}>3 · Coverage — counts reconcile visibly, no silent shrinkage</p>
          <div className={styles.row}>
            <StatusChip tone="quiet">
              Coverage <ChipVal>2/2</ChipVal> engines
            </StatusChip>
            <StatusChip tone="warn">
              Coverage <ChipVal>1/2</ChipVal> · {CASH_LABEL} withheld
            </StatusChip>
            <StatusChip tone="quiet">
              <ChipVal>9,958 / 9,964</ChipVal> computed · <ChipVal>6</ChipVal> refused
            </StatusChip>
          </div>
        </div>

        <div className={styles.dimRow} data-testid="sg-dim-4">
          <p className={styles.dimLabel}>
            4 · Run state — completion is not health: a run is plain, a superseded result is amber like an aging age
          </p>
          <div className={styles.row}>
            <StatusChip tone="quiet">Idle</StatusChip>
            <StatusChip tone="quiet">
              Running <ChipVal>2 scenarios…</ChipVal>
            </StatusChip>
            <StatusChip tone="quiet">
              Complete <ChipVal>04:11:07Z</ChipVal>
            </StatusChip>
            <StatusChip tone="quiet">
              Partial <ChipVal>3/5</ChipVal>
            </StatusChip>
            <StatusChip tone="warn">Superseded — results for previous input</StatusChip>
            <StatusChip tone="quiet">Run failed · retry</StatusChip>
          </div>
        </div>

        <div className={styles.dimRow} data-testid="sg-dim-5">
          <p className={styles.dimLabel}>
            5 · Knowledge state — four visible, counted objects; never a dash that reads as zero
          </p>
          <div className={styles.row}>
            <StatusChip tone="quiet">Computed</StatusChip>
            <RefusedChip cause={SPECIMEN_REFUSAL_CAUSE} code={SPECIMEN_REFUSAL_CODE} />
            <RefusedChip word="Withheld" cause="missing observation" />
            <StatusChip tone="unknown">
              Unanswered · <ChipVal>not asked of this engine</ChipVal>
            </StatusChip>
          </div>
        </div>

        <div className={styles.dimRow} data-testid="sg-dim-6">
          <p className={styles.dimLabel}>
            6 · Risk verdict — green is rationed to the comfortable verdict alone; no verdict wears no tier
          </p>
          <div className={styles.row}>
            <StatusChip tone="ok">
              Healthy · <ChipVal>HF 1.539</ChipVal>
            </StatusChip>
            <StatusChip tone="warn">
              Near threshold · <ChipVal>0.8% of cap</ChipVal>
            </StatusChip>
            <StatusChip tone="crit-fill">
              Liquidatable · <ChipVal>HF 0.4971</ChipVal>
            </StatusChip>
            <StatusChip tone="unknown" testId="sg-dim-6-unavailable">
              Verdict unavailable
            </StatusChip>
          </div>
        </div>

        <div className={styles.dimRow} data-testid="sg-dim-7">
          <p className={styles.dimLabel}>7 · Current vs projected — the dashed badge names its scenario and config version</p>
          <div className={styles.row}>
            <StatusChip tone="quiet">
              Current · <ChipVal>batch {SPECIMEN_BATCH}</ChipVal>
            </StatusChip>
            <StatusPill tone="projection">Projection · ETH −20% v3</StatusPill>
          </div>
        </div>

        <div className={styles.dimRow} data-testid="sg-dim-8">
          <p className={styles.dimLabel}>8 · Economic materiality — a label, not a verdict modifier; it never hides a row</p>
          <div className={styles.row}>
            <StatusChip tone="quiet">
              <ChipVal>$8.5K</ChipVal> eligible
            </StatusChip>
            <StatusChip tone="quiet">
              Dust · <ChipVal>{"<$0.01"}</ChipVal>
            </StatusChip>
            <StatusChip tone="quiet">
              Dust · <ChipVal>$0.33</ChipVal>
            </StatusChip>
          </div>
        </div>

        <div className={styles.dimRow} data-testid="sg-dim-9">
          <p className={styles.dimLabel}>9 · Evidence availability — a claim without proof says so</p>
          <div className={styles.row}>
            <StatusChip tone="quiet">
              Evidence · <ChipVal>6 rows</ChipVal>
            </StatusChip>
            <StatusChip tone="quiet">
              Evidence · <ChipVal>3 pins</ChipVal>
            </StatusChip>
            <StatusChip tone="unknown">Evidence unavailable — claim stands unverified</StatusChip>
          </div>
        </div>

        <h3 className={styles.subhead}>Compositions · fixed order: verdict, materiality, knowledge, freshness, (projection), (evidence)</h3>

        <div className={styles.dimRow} data-testid="sg-comp-1">
          <div className={styles.row}>
            <StatusChip tone="crit-fill">
              Liquidatable · <ChipVal>HF 0.4971</ChipVal>
            </StatusChip>
            <StatusChip tone="quiet">
              Dust · <ChipVal>{"<$0.01"}</ChipVal>
            </StatusChip>
            <StatusChip tone="quiet">Computed</StatusChip>
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
              Healthy · <ChipVal>HF 1.539</ChipVal>
            </StatusChip>
            <StatusChip tone="quiet">
              <ChipVal>$8.5K</ChipVal> eligible
            </StatusChip>
            <StatusChip tone="quiet">Computed</StatusChip>
            <TierChip seconds={48} tier="fresh" testId="sg-comp-2-snapshot" />
            <StatusPill tone="projection">Projection · ETH −20% v3</StatusPill>
          </div>
          <p className={styles.compRead}>
            A comfortable projected verdict — the projection rides as a dashed badge naming its
            scenario and config version; it never wears a fill.
          </p>
        </div>

        <div className={styles.dimRow} data-testid="sg-comp-3">
          <div className={styles.row}>
            <StatusChip tone="unknown">Verdict unavailable</StatusChip>
            <RefusedChip cause={SPECIMEN_REFUSAL_CAUSE} code={SPECIMEN_REFUSAL_CODE} />
            <TierChip seconds={300} tier="aging" testId="sg-comp-3-snapshot" />
            <StatusChip tone="unknown">Evidence unavailable — claim stands unverified</StatusChip>
          </div>
          <p className={styles.compRead}>
            A refusal composes like any answer: visible and counted, plain cause first, wire code
            secondary, dashed in ink-2 and never a tier&apos;s colour — the sentence never collapses into one badge.
          </p>
        </div>
      </section>

      {/* ---- §7 the exact-layer affordance ------------------------------- */}
      <section className={styles.section} data-testid="sg-exact">
        <h2>ExactValue · dotted underline and ⧉ — an exact string is underneath</h2>
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

      {/* ---- §8 the state registers --------------------------------------- */}
      <section className={styles.section} data-testid="sg-states">
        <h2>States · one register per absence — the unknowable never looks like zero</h2>
        <div className={styles.stateGrid}>
          <StateCard
            testId="sg-statecard-refused"
            state="refused"
            title="No verdict for this account"
            cause="The engine refused to value this account: its collateral sweep failed at this batch."
            serviceSaid={{ label: "What the service said", text: `${SPECIMEN_REFUSAL_CODE}: ${SPECIMEN_REFUSAL_CAUSE}` }}
          />
          <StateCard
            testId="sg-statecard-unavailable"
            state="unavailable"
            title="No hourly history to show"
            cause="The service did not answer the history request (HTTP 503), so there is nothing to chart."
            action={<Link href="/book">Open the Book →</Link>}
          />
          <StateCard testId="sg-statecard-not-run" state="not-run" title="Not run yet" cause="This scenario is served, and nobody has run it at this batch." />
          <StateCard testId="sg-statecard-not-served" state="not-served" title="Not served here" cause="This deployment does not serve this scenario." />
          <StateCard testId="sg-statecard-pending" state="pending" title="Reading the history…" cause="The request is in flight; nothing has failed." />
          <StateCard
            testId="sg-statecard-unreadable"
            state="unreadable"
            title="This answer could not be read"
            cause="A value in the served data could not be read, so nothing is claimed from it."
          />
        </div>
        <p className={styles.note}>
          Refused (the engine or the service declined) and unreadable (the page could not read the answer) are dashed;
          unavailable (the fetch failed), not run, not served and pending are solid. A fetch failure is never drawn as a
          refusal, and a read in flight is never called failed. A tile, a strip or a step with no figure prints its
          state&apos;s word — never a dash.
        </p>

        <h3 className={styles.subhead}>The earlier state family · kept as reference; pages compose StateCard</h3>
        <div className={styles.stateGrid}>
          <section className={styles.stateCard} data-testid="sg-state-loading">
            <p className={styles.stateKicker}>Loading — the skeleton reserves the exact final geometry</p>
            <Skeleton width="220px" height="21px" />
            <Skeleton width="150px" height="14px" />
            <Skeleton width="180px" height="14px" />
            <p className={styles.note}>
              Shimmer runs only under prefers-reduced-motion: no-preference; a spinner never
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
        <h2>KitTable · a refused row is dimmed, never dropped; small and dust rows fold behind the toggle</h2>
        <TableSpecimen />
        <p className={styles.note}>
          A table wider than its card scrolls inside its own region, never the page: the first column holds still,
          the far edge fades where columns remain, and the region takes a Tab stop so a keyboard can scroll it.
        </p>
      </section>

      <section className={styles.section} data-testid="sg-pagination">
        <h2>KitTable and useCursorPages · cursor pagination</h2>
        <PaginationDemo />
      </section>

      <section className={styles.section} data-testid="sg-drawer" id="sg-drawer-section">
        <h2>Drawer · methodology and evidence — the doctrine lives here, one click from the answer</h2>
        <DrawerDemo />
      </section>

      {/* ---- §10 identity: each truth its own chip ----------------------- */}
      <section className={styles.section} data-testid="sg-identity">
        <h2>IdentityChips · each truth its own chip — the strip under every headline</h2>
        <IdentityChips
          testId="sg-identity-strip"
          chips={[
            { label: "Batch", value: SPECIMEN_BATCH },
            { label: "Snapshot", value: "48s", title: `Specimen — snapshot freshness of batch ${SPECIMEN_BATCH}` },
            { label: "Coverage", value: "2/2 engines" },
            { label: "Evidence", value: "3 pins" },
          ]}
        />
        <IdentityChips
          testId="sg-identity-tones"
          chips={[
            { label: "Reconcile", value: "12/12 exact", tone: "ok" },
            { label: "Coverage", value: `1/2 · ${CASH_LABEL} withheld`, tone: "warn" },
            { label: "Snapshot", value: "18 h 12 min · critical", tone: "crit" },
            {
              label: "Refused",
              value: SPECIMEN_REFUSAL_CAUSE,
              tone: "refused",
              title: SPECIMEN_REFUSAL_CODE,
            },
          ]}
        />
        <IdentityChips
          testId="sg-identity-actions"
          chips={[
            { label: "Batch", value: SPECIMEN_BATCH },
            { label: "Current, not projected", value: "" },
          ]}
          trailing={
            <a href="#sg-drawer-section" className={`${kit.btn} ${kit.btnGhost}`}>
              The drawer specimen ↓
            </a>
          }
        />
        <p className={styles.note}>
          A label and its value, one truth per chip; the value carries the tone in the -text grade and the border keeps
          the chroma. A label-only chip (&quot;Current, not projected&quot;) prints its words alone, with no empty bold.
          The refused chip is dashed and wears no tier&apos;s color; its wire code rides in the title, never as the
          label. Actions take their own column on the right.
        </p>
      </section>

      {/* ---- §11 chart conventions + the interaction register ------------ */}
      <section className={styles.section} data-testid="sg-charts">
        <h2>SVG primitives · Sparkline, Scatter, WaterfallSteps</h2>
        <div className={styles.row}>
          <div className={styles.chartFrame}>
            <Sparkline
              label="Specimen HF history with a gap"
              values={[1.51, 1.49, 1.44, 1.41, null, 1.19, 1.11, 1.05, 1.043]}
              width={220}
              height={44}
            />
            <p className={styles.note}>A gap is an unestablished point; the line never interpolates across it.</p>
          </div>
        </div>
        <div className={styles.row}>
          <div className={styles.chartFrame}>
            <Scatter
              label="Specimen risk map"
              xLabel="Debt (USD, log10)"
              yLabel="Liq. distance %"
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
              label="Specimen liquidation waterfall"
              steps={[
                { label: "1 · Dust cohort", value: 28.11, display: "$28.11", kind: "flow" },
                { label: "2 · weETH seized", value: 2904332, display: "$2,904,332.10", kind: "flow" },
                { label: "2 · Debt cleared", value: 2739936, display: "$2,739,935.95", kind: "cleared" },
                { label: "3 · liquidBTC seized", value: 962110, display: "$962,110.44", kind: "flow" },
                { label: "3 · Residual bad debt", value: 262447, display: "$262,447.25", kind: "residual" },
              ]}
            />
            <p className={styles.note}>A nonzero residual can never render at zero pixels.</p>
          </div>
        </div>
      </section>

      <section className={styles.section} data-testid="sg-interaction">
        <h2>Chart interaction register · the §11 reference implementation</h2>
        <InteractionRegisterDemo />
      </section>

      {/* ---- the kit's parts ---------------------------------------------- */}
      <p className={`${kit.kick} ${styles.groupNote}`}>The kit — the primitives every page composes</p>

      <section className={styles.section} data-testid="sg-kpi">
        <h2>KpiTile · the five tones, a refused figure, and a tile for every state register</h2>
        <div className={kit.kpis}>
          <KpiTile
            testId="sg-kpi-neutral"
            label="Collateral (counted)"
            value="$23.41M"
            sub="Adapter-output prices only"
          />
          <KpiTile
            testId="sg-kpi-crit"
            tone="crit"
            label="Liquidatable"
            value="3 / 70"
            sub="All dust · $31 total"
          />
          <KpiTile testId="sg-kpi-warn" tone="warn" label="Near cap" value="7" sub="Within 10% of the line" />
          <KpiTile testId="sg-kpi-ok" tone="ok" label="Reconcile" value="12/12 exact" sub="The receipt matches" />
          <KpiTile
            testId="sg-kpi-refused"
            tone="refused"
            label="No verdict"
            value="6"
            sub="Collateral never read"
          />
          <KpiTile
            testId="sg-kpi-pending"
            pending
            label="Accounts walked"
            value="9,964"
            sub="The walk is in progress"
          />
        </div>
        <div className={kit.kpis}>
          <KpiTile testId="sg-kpi-state-refused" state="refused" label="Liquidations" value="" sub="This page was refused" />
          <KpiTile testId="sg-kpi-state-unavailable" state="unavailable" label="Proof pin" value="" sub="The service did not answer" />
          <KpiTile testId="sg-kpi-state-not-run" state="not-run" label="Newly liquidatable" value="" sub="Run the scenario to see it" />
          <KpiTile testId="sg-kpi-state-not-served" state="not-served" label="Bad debt" value="" sub="Not on this deployment" />
          <KpiTile testId="sg-kpi-state-unreadable" state="unreadable" label="Debt" value="" sub="The answer could not be read" />
          <KpiTile testId="sg-kpi-state-word" state="refused" stateWord="No verdict" label="Engine" value="" sub="The lib's own word" />
        </div>
        <p className={styles.note}>
          A refused tile that carries a real count keeps its number, dashed, in ink-2. A tile with no figure prints its
          state&apos;s word at the size of a section head, on the figure&apos;s line, so the row keeps one height —
          never a dash, never 0; a pending tile prints … and is aria-busy until the read answers.
        </p>
      </section>

      <section className={styles.section} data-testid="sg-pills">
        <h2>StatusPill · crit, warn, ok, refused, live, projection</h2>
        <div className={styles.row}>
          <StatusPill tone="crit">Liquidatable</StatusPill>
          <StatusPill tone="warn">Near cap</StatusPill>
          <StatusPill tone="ok">Healthy</StatusPill>
          {REFUSED_ROW !== undefined && (
            <StatusPill tone="refused" title={SPECIMEN_REFUSAL_TITLE}>
              {rowStandingLabel(REFUSED_ROW)}
            </StatusPill>
          )}
          <StatusPill tone="live">Serving</StatusPill>
          <StatusPill tone="projection">Projection · ETH −20% v3</StatusPill>
        </div>
        <p className={styles.note}>
          Crit only from the engine&apos;s comparator verdict · warn is the presentation band · green is rationed to
          the comfortable verdict · refused wears no tier&apos;s color, its label is the state and its title the plain
          cause then the wire code, as the Book&apos;s table prints it · live is posture (a stream, a served batch),
          accent and never green · projection is dashed and never filled.
        </p>
      </section>

      <section className={styles.section} data-testid="sg-live">
        <h2>Live pill · connection is posture, never health</h2>
        <div className={styles.row}>
          <LivePillView testId="sg-live-connected" words={LIVE.connected} />
          <LivePillView testId="sg-live-aging" words={LIVE.aging} />
          <LivePillView testId="sg-live-reconnecting" words={LIVE.reconnecting} />
          <LivePillView testId="sg-live-off" words={LIVE.off} />
        </div>
        <p className={styles.note}>
          The phone form of an aging pill: the batch folds away, the age stays on the line.{" "}
          <LivePillView testId="sg-live-phone-aging" words={LIVE.aging} compact />
        </p>
        <div className={styles.phoneFrame} data-testid="sg-live-phone">
          <div className={styles.phoneRow}>
            <span className={kit.brand}>
              <i className={kit.brandMark} aria-hidden="true" />
              Solvent
            </span>
            <span className={kit.status}>
              <LivePillView testId="sg-live-phone-pill" words={LIVE.connected} compact />
              <a href="#sg-live" className={kit.iconBtn} aria-label={GITHUB_LABEL} title={GITHUB_LABEL}>
                <GithubGlyph />
              </a>
              <ThemeToggle />
            </span>
          </div>
        </div>
        <p className={styles.note}>
          The dot is the accent while the stream is live, amber while it reconnects, and plain when it is off; a fresh
          age is ink, and only an aging (amber) or stale (coral) age wears a tier. On a phone the pill keeps its dot and
          its word, and the batch and the age move into its title (the frame above is a 390px header row).
        </p>
      </section>

      <section className={styles.section} data-testid="sg-controls">
        <h2>ToggleGroup · a filter is a joined bar under its label, never an identity chip</h2>
        <div className={styles.specimenStack}>
          <ToggleGroupDemo />
        </div>
        <p className={styles.note}>
          One shape for every filter; each group keeps its own selection rule (one engine, or any set of types). The
          group is one Tab stop — the arrow keys move between options, Home and End jump to the ends — and a bar wider
          than its row scrolls, its edge fading on the side where options remain.
        </p>
      </section>

      <section className={styles.section} data-testid="sg-strips">
        <h2>Strips · one line of state</h2>
        <div className={styles.specimenStack}>
          <div className={kit.strip} data-testid="sg-strip">
            <b>Loaded 50</b> More actions are available below.
          </div>
          <div className={`${kit.strip} ${kit.stripWarn}`} data-testid="sg-strip-warn">
            <b>Reconcile drifted</b> 84 of 87 checked rows matched; 3 drifted.
          </div>
          <div className={`${kit.strip} ${kit.stripRefused}`} data-testid="sg-strip-refused">
            <b>Page refused</b> The service would not return this page of the list.
          </div>
        </div>
      </section>

      <section className={styles.section} data-testid="sg-steps">
        <h2>StepStrip · the pipeline&apos;s four steps, one strip</h2>
        <StepStrip
          testId="sg-steps-strip"
          label="The pipeline"
          steps={[
            {
              key: "index",
              ordinal: PIPELINE_STEPS.index.ordinal,
              name: PIPELINE_STEPS.index.name,
              description: "Chain events, indexed with reorg safety.",
              figure: (
                <>
                  Latest block <b>25,641,730</b>
                </>
              ),
            },
            {
              key: "compute",
              ordinal: PIPELINE_STEPS.compute.ordinal,
              name: PIPELINE_STEPS.compute.name,
              description: "Every account's health from exact integers, never floats.",
              figure: (
                <>
                  Batch <b>18,251</b>
                </>
              ),
            },
            {
              key: "verify",
              ordinal: PIPELINE_STEPS.verify.ordinal,
              name: PIPELINE_STEPS.verify.name,
              description: "A reconcile run checks the book against the chain.",
              state: "unavailable",
            },
            {
              key: "serve",
              ordinal: PIPELINE_STEPS.serve.ordinal,
              name: PIPELINE_STEPS.serve.name,
              description: "Every batch served with its evidence.",
              tone: "ok",
              figure: (
                <>
                  <b>12/12</b> checks passed
                </>
              ),
            },
          ]}
        />
        <p className={styles.note}>
          The names and ordinals are the lib&apos;s (one pipeline vocabulary). A step with no figure prints its
          state&apos;s word, never a dash; a tone colours the bold figure alone.
        </p>
      </section>

      <section className={styles.section} data-testid="sg-fold">
        <h2>LegacyFold · the legacy market, after all Cash content, with its own figures</h2>
        <LegacyFold testId="sg-fold-legacy" title={LEGACY_FOLD_TITLE} summary="Its own figures, never summed with Cash's.">
          <div className={kit.kpis4}>
            <KpiTile label="Debt" value="$18.2M" sub="Aave v3 market (legacy) only" />
            <KpiTile label="Liquidatable positions" value="2" sub="Of 551 computed" />
          </div>
        </LegacyFold>
      </section>

      <section className={styles.section} data-testid="sg-heads">
        <h2>Heads · the one badge slot, and a kicker token that keeps its case</h2>
        <SectionHead
          testId="sg-head-badge"
          title="Stress this address"
          badge={<StatusPill tone="projection">PROJECTION</StatusPill>}
          qualifier="Under each committed scenario"
        />
        <ChartCard title="Stress preview" badge={<StatusPill tone="projection">PROJECTION</StatusPill>} testId="sg-card-badge">
          <p className={styles.note}>Every shocked figure in this card is a projection.</p>
        </ChartCard>
        <p className={kit.kick} data-testid="sg-kick-case">
          Scenarios · <span className={kit.kickCase}>weETH</span> depeg
        </p>
      </section>

      <section className={styles.section} data-testid="sg-truth">
        <h2>Truth primitives · the honest-rendering laws</h2>
        <dl className={styles.kv}>
          <dt>found: null</dt>
          <dd className={styles.kvDim}>{renderLookupOutcome("unknowable")}</dd>
          <dt>found: false</dt>
          <dd>{renderLookupOutcome("not-found")}</dd>
          <dt>A null total</dt>
          <dd className={styles.kvDim}>{renderNullableDecimal(null)}</dd>
          <dt>A null block_time</dt>
          <dd>
            {renderBlockTime(25641730, null)} <span className={kit.sub}>(never an invented time)</span>
          </dd>
        </dl>
      </section>
    </>
  );
}
