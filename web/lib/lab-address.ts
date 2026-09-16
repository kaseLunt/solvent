// The one-address workspace. It is the Inspector's reading — its stress rows,
// its decimals, its Cash position as today — arranged under the selected
// scenario. No second stress reader exists; the Inspector's laws hold here.
import { horizonLabel, type StressHorizon, type StressRow, type StressSide } from "./address-stress";
import { truncateAddress } from "./format";
import { headroomBand } from "./headroom";
import { humanUsdFull } from "./human-price";
import type { CashStatus } from "./inspector-position";
import type { InspectorView } from "./inspector-view";
import type { LabHeadline } from "./lab-headline";
import { isWireScale } from "./wireGuard";

export type AddressWorkspaceState = "idle" | "invalid" | "loading" | "unavailable" | "no-position" | "withheld" | "rows";
export type TileTone = "crit" | "warn" | "ok" | "neutral" | "refused";
export interface AddressTile {
  readonly value: string;
  readonly tone: TileTone;
}
export interface AddressTiles {
  readonly debtBefore: AddressTile;
  readonly debtAfter: AddressTile;
  readonly capBefore: AddressTile;
  readonly capAfter: AddressTile;
  readonly roomBefore: AddressTile;
  readonly roomAfter: AddressTile;
  readonly statusBefore: AddressTile;
  readonly statusAfter: AddressTile;
}
export interface AddressWorkspace {
  readonly state: AddressWorkspaceState;
  readonly address: string;
  readonly rows: readonly StressRow[];
  readonly selected: StressRow | null;
  readonly headline: LabHeadline;
  readonly tiles: AddressTiles | null;
  readonly batchId: number | null;
  readonly decimals: number | null;
  readonly cause: string | null;
}

const refused = (emphasis: string, dek: string): LabHeadline => ({ emphasis, rest: "", tone: "refused", dek });
const REFUSED_TILE: AddressTile = { value: "—", tone: "refused" };
const NOT_COMPUTED: AddressTile = { value: "Not computed", tone: "refused" };

function sentence(text: string): string {
  const t = text.trim();
  const c = t.charAt(0).toUpperCase() + t.slice(1);
  return /[.!?]$/.test(c) ? c : `${c}.`;
}

function empty(state: AddressWorkspaceState, address: string, headline: LabHeadline, cause: string | null = null): AddressWorkspace {
  return { state, address, rows: [], selected: null, headline, tiles: null, batchId: null, decimals: null, cause };
}

const STATUS_WORD: Record<CashStatus, AddressTile> = {
  liquidatable: { value: "Liquidatable", tone: "crit" },
  near: { value: "Near cap", tone: "warn" },
  healthy: { value: "Healthy", tone: "ok" },
  refused: { value: "Not computed", tone: "refused" },
  unknowable: { value: "Not computed", tone: "refused" },
};

// The Inspector's near bands (its position reader keeps the same set): a
// breached band beside a non-liquidatable verdict says near, never healthy —
// the verdict governs the status word and the room shows the contradiction.
const NEAR_BANDS: ReadonlySet<number> = new Set([0, 1, 2, 3]);

/**
 * A side's figures are read only when its debt and cap are both present and
 * non-negative — the Inspector's rule for a position. A negative wire decimal
 * is a legal string and not a figure: nothing prints from it, the room included.
 */
function readable(side: StressSide | null): { readonly debt: bigint; readonly cap: bigint; readonly room: bigint } | null {
  if (side === null || side.debt === null || side.cap === null || side.debt < 0n || side.cap < 0n) return null;
  return { debt: side.debt, cap: side.cap, room: side.cap - side.debt };
}

/**
 * The after side's status word in the Inspector's register: the verdict
 * governs; a non-liquidatable side is "Near cap" inside the near bands and
 * "Healthy" outside them; an unknowable verdict, or figures that cannot be
 * read, is "Not computed" — never a verdict word on an unknown.
 */
function afterStatus(side: StressSide | null): AddressTile {
  const figures = readable(side);
  if (side === null || figures === null || side.verdict === "unknowable") return NOT_COMPUTED;
  if (side.verdict === "liquidatable") return { value: "Liquidatable", tone: "crit" };
  const band = headroomBand(figures.cap, figures.debt);
  return band !== null && NEAR_BANDS.has(band) ? { value: "Near cap", tone: "warn" } : { value: "Healthy", tone: "ok" };
}

/** Negative room is worded "over cap by" a positive figure in the crit tone: a minus sign on a dollar figure never prints as room. */
function roomTile(room: bigint, decimals: number, tone: TileTone): AddressTile {
  return { value: roomWords(room, decimals), tone: room < 0n ? "crit" : tone };
}

function roomWords(room: bigint, decimals: number): string {
  return room < 0n ? `over cap by ${humanUsdFull(-room, decimals)}` : humanUsdFull(room, decimals);
}

function sideRoomWords(side: StressSide | null, decimals: number): string {
  const figures = readable(side);
  return figures === null ? "not computed" : roomWords(figures.room, decimals);
}

/**
 * A projection is judged by its horizons, never by its `after` — that is the
 * spot, unchanged by construction. An unknowable horizon is a refusal that
 * names the horizon; a liquidatable one names the first horizon it happens
 * within, in the Inspector's warn tone; otherwise the account holds through
 * the longest horizon. The dek is each horizon's extra interest, delta-only;
 * a missing or negative delta is "not computed".
 */
function projectionHeadline(short: string, label: string, horizons: readonly StressHorizon[], today: string, decimals: number): LabHeadline {
  const cannot = `Cannot say whether ${short} becomes liquidatable under ${label}.`;
  const longest = horizons.reduce<StressHorizon | null>((a, h) => (a === null || h.seconds > a.seconds ? h : a), null);
  if (longest === null) return refused(cannot, `Room today ${today}. The projection carries no horizon.`);
  const interest = horizons.map(
    (h) => `${horizonLabel(h.seconds)}: ${h.extraInterest === null || h.extraInterest < 0n ? "not computed" : `+${humanUsdFull(h.extraInterest, decimals)}`} interest`,
  );
  const dek = `Room today ${today}; ${interest.join("; ")}.`;
  const unknowable = horizons.find((h) => h.verdict === "unknowable");
  if (unknowable !== undefined) return refused(cannot, `${dek} The ${horizonLabel(unknowable.seconds)} horizon carries no verdict.`);
  const within = horizons.find((h) => h.verdict === "liquidatable");
  if (within !== undefined) return { emphasis: `${short} becomes liquidatable within ${horizonLabel(within.seconds)} under ${label}.`, rest: "", tone: "warn", dek };
  return { emphasis: `${short} stays inside its cap through ${horizonLabel(longest.seconds)} under ${label}.`, rest: "", tone: "ok", dek };
}

/**
 * The selected row's sentence. Not applicable is the engine's own reason; a
 * projection reads its horizons; a spot shock reads the reader's flip. Room
 * words come only from a readable side.
 */
/**
 * The selected row's sentence. Not applicable is the engine's own reason; a
 * projection reads its horizons; a spot shock reads the reader's flip — but
 * only over sides whose figures are a position: a side the tiles refuse yields
 * no verdict word here either, whatever the wire's boolean says of it.
 */
function rowHeadline(short: string, row: StressRow, decimals: number): LabHeadline {
  if (!row.applicable) return refused(`${row.label} does not apply to ${short}.`, sentence(row.reason ?? "the engine gave no reason"));
  const today = sideRoomWords(row.before, decimals);
  if (row.projection !== null) return projectionHeadline(short, row.label, row.projection, today, decimals);
  const dek = `Room today ${today}; after the shock, ${sideRoomWords(row.after, decimals)}.`;
  const cannot = `Cannot say whether ${short} becomes liquidatable under ${row.label}.`;
  if ((row.before !== null && readable(row.before) === null) || (row.after !== null && readable(row.after) === null)) {
    return refused(cannot, `${dek} The shocked figures are not a position.`);
  }
  if (row.flips === null) return refused(cannot, `${dek} One side of the comparison is withheld or unknowable.`);
  if (row.flips) return { emphasis: `${short} becomes liquidatable under ${row.label}.`, rest: "", tone: "crit", dek };
  if (row.after?.verdict === "liquidatable") return { emphasis: `${short} is liquidatable today and stays so under ${row.label}.`, rest: "", tone: "crit", dek };
  return { emphasis: `${short} stays inside its cap under ${row.label}.`, rest: "", tone: "ok", dek };
}

export function addressWorkspace(input: { address: string; view: InspectorView | null; selectedId: string | null }): AddressWorkspace {
  const { address, view, selectedId } = input;
  if (view === null || address === "") {
    return empty("idle", address, refused("Stress one address.", "Enter an address; the committed scenarios are applied to its Cash position."));
  }
  const short = truncateAddress(address);
  if (view.state === "invalid") return empty("invalid", address, refused("Not an address.", "An address is 0x followed by exactly 40 hex characters. Nothing was looked up."));
  if (view.state === "loading") return empty("loading", address, refused(`Looking up ${short}…`, "The position first; the committed scenarios follow it."));
  if (view.state === "unavailable") {
    return empty("unavailable", address, refused(`The lookup for ${short} could not be completed.`, `${sentence(view.headline.dek.split(". ")[0] ?? view.headline.dek)} Nothing about this address is known from a failed lookup.`));
  }
  if (view.stressLoad.phase === "loading") return empty("loading", address, refused(`Running the committed scenarios for ${short}…`, "One evaluation per scenario against this batch; nothing is written."));
  if (view.stressLoad.phase === "error") return empty("unavailable", address, refused(`The scenarios for ${short} could not be run.`, `${sentence(view.stressLoad.message)} The position above is unaffected.`));
  const stress = view.stress;
  if (stress === null) return empty("loading", address, refused(`Running the committed scenarios for ${short}…`, "One evaluation per scenario against this batch; nothing is written."));
  const batchId = view.batchId;
  if (stress.kind === "no-position") {
    return empty("no-position", address, refused(`No Cash position for ${short} in batch ${batchId === null ? "?" : String(batchId)}.`, "The lookup is complete: there is nothing to stress."));
  }
  if (stress.kind === "withheld") {
    return empty("withheld", address, refused(`Cannot say — the Cash book is withheld for ${short}.`, `${sentence(stress.cause)} A withheld book is not a computed book.`), stress.cause);
  }
  const rows = stress.rows;
  const selected = rows.find((r) => r.id === selectedId) ?? rows[0] ?? null;
  const decimals = view.decimals !== null && isWireScale(view.decimals) ? view.decimals : null;
  const bare = (headline: LabHeadline): AddressWorkspace => ({ state: "rows", address, rows, selected, headline, tiles: null, batchId, decimals, cause: null });
  if (selected === null) return bare(refused(`No scenario applies to ${short}.`, "The stress response carried no scenario for this account."));
  // Rows beside no Cash position are two responses disagreeing; a position at a scale the guard refused prints no figure.
  // Neither is the scenarios' doing, so neither borrows their sentence. The position is asked before its scale: no
  // position has no scale, and the disagreement is the truer sentence. A withheld Cash book is asked first of all: the
  // lookup's answer there is cannot-say, and a withheld book is never "no position" — only a complete not-found or a
  // legacy-only lookup is.
  if (view.state === "cannot-compute") {
    return bare(refused(`Cannot say — the Cash book is withheld for ${short}.`, "The stress response carries scenarios while the lookup's Cash book is withheld — the two answers disagree."));
  }
  if (view.cash === null) return bare(refused(`No Cash position for ${short} to stress.`, "The stress response carries scenarios, but the lookup found no Cash position — the two answers disagree."));
  if (decimals === null) return bare(refused("The Cash position's scale could not be read.", "No figure prints at an unreadable scale."));
  const money = (v: bigint | null): AddressTile => (v === null || v < 0n ? REFUSED_TILE : { value: humanUsdFull(v, decimals), tone: "neutral" });
  const before = view.cash;
  // The before tiles are refused exactly where the Inspector refuses its own: a refused or unknowable position keeps
  // its status word and prints no figure — a persisted debt beside "Not computed" would read as a computed one.
  const refusedBefore = view.refusedTiles;
  const roomToneBefore: TileTone = before.status === "liquidatable" ? "crit" : before.status === "near" ? "warn" : "neutral";
  const side = selected.after;
  // An unknowable after verdict refuses its figures as the Inspector refuses an unknowable position's: a debt beside
  // "Not computed" would read as a computed one.
  const after = side !== null && side.verdict !== "unknowable" ? readable(side) : null;
  // The after room carries its status's tone as the before pair does: crit beside Liquidatable, warn beside Near cap.
  const statusAfter = afterStatus(side);
  const roomToneAfter: TileTone = statusAfter.tone === "crit" ? "crit" : statusAfter.tone === "warn" ? "warn" : "neutral";
  const tiles: AddressTiles = {
    debtBefore: refusedBefore ? REFUSED_TILE : money(before.debt),
    capBefore: refusedBefore ? REFUSED_TILE : money(before.cap),
    roomBefore: refusedBefore || before.room === null ? REFUSED_TILE : roomTile(before.room, decimals, roomToneBefore),
    statusBefore: STATUS_WORD[before.status],
    debtAfter: after === null ? REFUSED_TILE : money(after.debt),
    capAfter: after === null ? REFUSED_TILE : money(after.cap),
    roomAfter: after === null ? REFUSED_TILE : roomTile(after.room, decimals, roomToneAfter),
    statusAfter,
  };
  return { state: "rows", address, rows, selected, headline: rowHeadline(short, selected, decimals), tiles, batchId, decimals, cause: null };
}
