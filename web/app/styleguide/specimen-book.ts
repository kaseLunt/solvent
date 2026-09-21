// The styleguide's one Cash book specimen. The table prints these rows; the crit
// header's sentence, the fold toggle's label and the drawer's exact row are all
// derived from them HERE, through the functions the Book itself calls — so one
// number in three places holds by construction, and a specimen can never quote
// a figure its own table does not carry. A plain module, not a client one: the
// page (a server component) and the two client specimens read the same values.
//
// Relative imports, so the unit project can load this module and pin it.
import { formatUnits } from "@solvent/client";
import { groupDecimalString } from "../../lib/book-format";
import { bookHeadline, type Headline } from "../../lib/book-headline";
import { notComputedCause, type CashRow } from "../../lib/cash-rows";
import { humanUsd } from "../../lib/human-usd";
import { materialityTier, partitionByMateriality } from "../../lib/materiality";
import { plainCause } from "../../lib/refusal-phrasebook";
import { groupInt } from "../../lib/prose";

/** The Cash engine's value scale. */
export const SPECIMEN_DECIMALS = 6;

/**
 * The specimens' one refusal, in the product's register: a REAL wire code —
 * one the phrasebook can read — and the plain cause the phrasebook gives it.
 * The canon never teaches a code the product cannot print.
 */
export const SPECIMEN_REFUSAL_CODE = "SWEEP_FAILED";
export const SPECIMEN_REFUSAL_CAUSE = plainCause(SPECIMEN_REFUSAL_CODE);

/** A row the engine sized: its room and its debt are integers, by type — there is no null here to coalesce into a zero. */
export interface SizedSpecimenRow {
  readonly kind: "sized";
  readonly account: string;
  readonly status: "liquidatable" | "near";
  /** cap − debt at the engine's scale; negative when liquidatable. */
  readonly room: bigint;
  /** A near-cap row states its room as a share of the cap. */
  readonly roomPercent: string | null;
  readonly debt: bigint;
}

/** A row the engine refused, as the product holds one: the Book's own row type, every figure null, the refusal named. */
export interface RefusedSpecimenRow {
  readonly kind: "refused";
  readonly row: CashRow;
}

export type SpecimenRow = SizedSpecimenRow | RefusedSpecimenRow;

const SIZED: readonly SizedSpecimenRow[] = [
  { kind: "sized", account: "0x3c19000000000000000000000000000000008af0", status: "liquidatable", room: -310_402_118n, roomPercent: null, debt: 4_200_118_139n },
  { kind: "sized", account: "0x9a04000000000000000000000000000000e6c200", status: "liquidatable", room: -96_400_000n, roomPercent: null, debt: 2_640_120_139n },
  { kind: "sized", account: "0x71aa00000000000000000000000000000004e200", status: "near", room: 6_077_020_000n, roomPercent: "4.1%", debt: 142_142_980_000n },
  { kind: "sized", account: "0x5d7e0000000000000000000000000000001b3a00", status: "liquidatable", room: -2_750_000n, roomPercent: null, debt: 61_200_000n },
  { kind: "sized", account: "0x2c64000000000000000000000000000000064900", status: "liquidatable", room: -530_000n, roomPercent: null, debt: 14_550_000n },
];

const REFUSED: RefusedSpecimenRow = {
  kind: "refused",
  row: {
    account: "0x8f24000000000000000000000000000000c11d00",
    decimals: SPECIMEN_DECIMALS,
    debt: null,
    collateral: null,
    cap: null,
    room: null,
    roomPercent: null,
    roomTenths: null,
    band: null,
    verdict: "unknowable",
    refusal: { code: SPECIMEN_REFUSAL_CODE, detail: null },
    computed: false,
  },
};

/** The refused pill's title, in the words the Book's table gives it — plain cause, then wire code; the join has one owner, the Book's. */
export const SPECIMEN_REFUSAL_TITLE = notComputedCause(REFUSED.row);

const liquidatable = SIZED.filter((row) => row.status === "liquidatable");
const near = SIZED.filter((row) => row.status === "near");
const partition = partitionByMateriality(liquidatable, SPECIMEN_DECIMALS);

/** A row's test id is its tier and its place within it — a row's name can never disagree with the line it falls under. */
function idsByTier(rows: readonly SizedSpecimenRow[]): ReadonlyMap<SizedSpecimenRow, string> {
  const seen = new Map<string, number>();
  const ids = new Map<SizedSpecimenRow, string>();
  for (const row of rows) {
    const tier = row.status === "near" ? "near" : materialityTier(row.debt, SPECIMEN_DECIMALS);
    const place = (seen.get(tier) ?? 0) + 1;
    seen.set(tier, place);
    ids.set(row, `${tier}-${String(place)}`);
  }
  return ids;
}

const IDS = idsByTier(SIZED);

/** The test id of a specimen row: `material-1`, `near-1`, `small-2`, `refused`. */
export function specimenRowId(row: SpecimenRow): string {
  return row.kind === "refused" ? "refused" : (IDS.get(row) ?? "unnamed");
}

/** The rows as the Book orders them: material liquidatable, then near cap, then the refused row — never dropped. */
export const SPECIMEN_BASE_ROWS: readonly SpecimenRow[] = [...partition.material, ...near, REFUSED];
/** The liquidatable rows under the materiality line: folded behind the toggle, counted and summed in its label. */
export const SPECIMEN_BELOW_LINE_ROWS: readonly SizedSpecimenRow[] = [...partition.small, ...partition.dust];
export const SPECIMEN_ROW_COUNT = SPECIMEN_BASE_ROWS.length + SPECIMEN_BELOW_LINE_ROWS.length;

/** The fold toggle's label: one engine's count and one engine's sum, both the rows' own. */
export const SPECIMEN_TOGGLE_LABEL = `Show ${String(partition.counts.belowLine)} small & dust positions (${humanUsd(partition.sums.belowLine, SPECIMEN_DECIMALS)})`;

/** The book the six rows are a specimen of: its position census, of which the refused row is the one not computed. */
const SPECIMEN_POSITIONS = 552;
const NOT_COMPUTED = 1;

/** The crit header's identity strip, in the Book's own chip grammar. */
export const SPECIMEN_BATCH = groupInt(18_251);
export const SPECIMEN_COVERAGE = `${groupInt(SPECIMEN_POSITIONS - NOT_COMPUTED)} / ${groupInt(SPECIMEN_POSITIONS)} computed`;

const sumOf = (rows: readonly SizedSpecimenRow[]) => ({ sum: rows.reduce((total, row) => total + row.debt, 0n), count: rows.length });

// The headline's input names how a stopped walk ended; this walk completed, so there is nothing to name.
const complete = { complete: true, stopped: null, stopKind: null } as const;

/** The crit header: the Book's own headline over the specimen rows — every figure in it is the table's. */
const critInput = {
  decimals: SPECIMEN_DECIMALS,
  material: { sum: partition.sums.material, count: partition.counts.material },
  belowLine: { sum: partition.sums.belowLine, count: partition.counts.belowLine },
  nearCap: sumOf(near),
  notComputed: NOT_COMPUTED,
  computed: SPECIMEN_POSITIONS - NOT_COMPUTED,
  ...complete,
};
export const SPECIMEN_CRIT_HEADLINE: Headline = bookHeadline(critInput);

/** The ok header: the Book's own HEALTH verdict — a complete walk that found nothing liquidatable. Green says health and nothing else. */
const healthyInput = {
  decimals: SPECIMEN_DECIMALS,
  material: { sum: 0n, count: 0 },
  belowLine: { sum: 0n, count: 0 },
  nearCap: { sum: 0n, count: 0 },
  notComputed: 0,
  computed: SPECIMEN_POSITIONS,
  ...complete,
};
export const SPECIMEN_OK_HEADLINE: Headline = bookHeadline(healthyInput);
export const SPECIMEN_OK_COVERAGE = `${groupInt(SPECIMEN_POSITIONS)} / ${groupInt(SPECIMEN_POSITIONS)} computed`;

/** The drawer's exact row: the crit header's human figure, and the exact wire value it truncates — grouped, at full scale. */
export const SPECIMEN_EXACT = {
  human: humanUsd(partition.sums.material, SPECIMEN_DECIMALS),
  exact: groupDecimalString(formatUnits(partition.sums.material.toString(), SPECIMEN_DECIMALS, { trim: false })),
} as const;
