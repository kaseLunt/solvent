// The one-address workspace. It is the Inspector's reading — its stress rows,
// its decimals, its Cash position as today — arranged under the selected
// scenario. No second stress reader exists; the Inspector's laws hold here.
import { cannotSayTitle, computableSide, horizonLabel, roomWords, rowVerdict, sideRoomWords, type StressRow, type StressSide } from "./address-stress";
import { truncateAddress } from "./format";
import { headroomBand } from "./headroom";
import { humanUsdFull } from "./human-price";
import type { CashStatus } from "./inspector-position";
import { stressBatchNote, type InspectorView } from "./inspector-view";
import { refused, sentence, type LabHeadline } from "./lab-headline";
import type { LibraryOutcome } from "./lab-library";
import { groupInt } from "./prose";
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
  /** The stress response's own batch; when it differs from the position's the comparison is refused and both are named. */
  readonly stressBatchId: number | null;
  /**
   * The "Stress for batch" chip's value, from the Inspector's own batch note: present exactly when the stress result's
   * batch is readable and is not the position's. After a resume repair — which refreshes the position and replays no
   * stress — it says the stress is from the previous lookup, in the note's words.
   */
  readonly stressBatchChip: string | null;
  readonly decimals: number | null;
  readonly cause: string | null;
}

const REFUSED_TILE: AddressTile = { value: "—", tone: "refused" };
const NOT_COMPUTED: AddressTile = { value: "Not computed", tone: "refused" };

function empty(state: AddressWorkspaceState, address: string, headline: LabHeadline, cause: string | null = null): AddressWorkspace {
  return { state, address, rows: [], selected: null, headline, tiles: null, batchId: null, stressBatchId: null, stressBatchChip: null, decimals: null, cause };
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
 * The after side's status word in the Inspector's register: the verdict
 * governs; a non-liquidatable side is "Near cap" inside the near bands and
 * "Healthy" outside them; an unknowable verdict, or figures that cannot be
 * read, is "Not computed" — never a verdict word on an unknown.
 */
function afterStatus(side: StressSide | null): AddressTile {
  const figures = computableSide(side);
  if (side === null || figures === null) return NOT_COMPUTED;
  if (side.verdict === "liquidatable") return { value: "Liquidatable", tone: "crit" };
  const band = headroomBand(figures.cap, figures.debt);
  return band !== null && NEAR_BANDS.has(band) ? { value: "Near cap", tone: "warn" } : { value: "Healthy", tone: "ok" };
}

/** Negative room is worded "over cap by" a positive figure in the crit tone: a minus sign on a dollar figure never prints as room. */
function roomTile(room: bigint, decimals: number, tone: TileTone): AddressTile {
  return { value: roomWords(room, decimals), tone: room < 0n ? "crit" : tone };
}

/**
 * The selected row's sentence. Not applicable is the engine's own reason. A
 * side the tiles refuse — missing, unreadable figures or an unknowable verdict — yields
 * no verdict word in any row kind, whatever the wire's booleans or horizons
 * say of it: that gate is asked before a projection reads its horizons or a
 * spot shock reads the reader's flip.
 */
function rowHeadline(short: string, row: StressRow, decimals: number): LabHeadline {
  const verdict = rowVerdict(row);
  if (verdict.kind === "not-applicable") return refused(`${row.label} does not apply to ${short}.`, sentence(verdict.reason));
  // A projection has no shock: its refusal speaks of the projection and its projected figures; a spot row of its shock.
  const projected = row.projection !== null;
  const today = sideRoomWords(row.before, decimals);
  const cannot = `Cannot say whether ${short} becomes liquidatable under ${row.label}.`;
  // The comparison dek sets the two sides beside each other; the projection dek lists each horizon's interest.
  const compared = `Room today ${today}; ${projected ? "under the projection" : "after the shock"}, ${sideRoomWords(row.after, decimals)}.`;
  const interest = (row.projection ?? []).map(
    (h) => `${horizonLabel(h.seconds)}: ${h.extraInterest === null || h.extraInterest < 0n ? "not computed" : `+${humanUsdFull(h.extraInterest, decimals)}`} interest`,
  );
  const horizonsDek = `Room today ${today}; ${interest.join("; ")}.`;
  switch (verdict.kind) {
    case "cannot-say":
      switch (verdict.cause) {
        case "not-a-position":
          return refused(cannot, `${compared} The ${projected ? "projected" : "shocked"} figures are not a position.`);
        case "withheld":
          return refused(cannot, `${compared} One side of the comparison is withheld or unknowable.`);
        case "no-horizon":
          return refused(cannot, `Room today ${today}. The projection carries no horizon.`);
        case "horizon-unknowable":
          return refused(cannot, `${horizonsDek} ${sentence(cannotSayTitle(verdict))}`);
      }
      break;
    case "liquidatable":
      if (verdict.within !== null) return { emphasis: `${short} becomes liquidatable within ${horizonLabel(verdict.within.seconds)} under ${row.label}.`, rest: "", tone: "warn", dek: horizonsDek };
      if (verdict.already) return { emphasis: `${short} is liquidatable today and stays so under ${row.label}.`, rest: "", tone: "crit", dek: compared };
      return { emphasis: `${short} becomes liquidatable under ${row.label}.`, rest: "", tone: "crit", dek: compared };
    case "inside":
      if (verdict.through !== null) return { emphasis: `${short} stays inside its cap through ${horizonLabel(verdict.through.seconds)} under ${row.label}.`, rest: "", tone: "ok", dek: horizonsDek };
      return { emphasis: `${short} stays inside its cap under ${row.label}.`, rest: "", tone: "ok", dek: compared };
  }
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
  const stressBatchId = view.stressBatchId;
  if (stress.kind === "no-position") {
    return empty("no-position", address, refused(`No Cash position for ${short} in batch ${batchId === null ? "?" : String(batchId)}.`, "The lookup is complete: there is nothing to stress."));
  }
  if (stress.kind === "withheld") {
    return empty("withheld", address, refused(`Cannot say — the Cash book is withheld for ${short}.`, `${sentence(stress.cause)} A withheld book is not a computed book.`), stress.cause);
  }
  const rows = stress.rows;
  const selected = rows.find((r) => r.id === selectedId) ?? rows[0] ?? null;
  const decimals = view.decimals !== null && isWireScale(view.decimals) ? view.decimals : null;
  const crossBatch = batchId !== null && stressBatchId !== null && stressBatchId !== batchId;
  // The Inspector's note is the one author of the stress batch's words: the chip and, after a repair, the dek are its own.
  const note = crossBatch ? stressBatchNote(view) : null;
  const stressBatchChip = note?.chipValue ?? null;
  const bare = (headline: LabHeadline): AddressWorkspace => ({ state: "rows", address, rows, selected, headline, tiles: null, batchId, stressBatchId, stressBatchChip, decimals, cause: null });
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
  // A position and a stress result from different batches are not compared: the rows are the stress result's own, at
  // its batch; the tiles would set two batches side by side, so they are refused and both batches are named. The
  // lookup's own answers (withheld, no position, an unreadable scale) come first — there is nothing to compare there.
  if (batchId !== null && stressBatchId !== null && stressBatchId !== batchId) {
    // A repaired lookup beside the stress it kept is disclosed in the Inspector's sentence — never a second copy of it.
    const dek =
      note !== null && view.stressFromPreviousLookup
        ? note.disclosure
        : "The scenarios below are the stress result's own. A position and a stress result from different batches are not compared.";
    return bare(refused(`Cannot say — the stress result is for batch ${groupInt(stressBatchId)}; the position above is batch ${groupInt(batchId)}.`, dek));
  }
  const money = (v: bigint | null): AddressTile => (v === null || v < 0n ? REFUSED_TILE : { value: humanUsdFull(v, decimals), tone: "neutral" });
  const before = view.cash;
  // The before tiles are refused exactly where the Inspector refuses its own: a refused or unknowable position keeps
  // its status word and prints no figure — a persisted debt beside "Not computed" would read as a computed one.
  const refusedBefore = view.refusedTiles;
  const roomToneBefore: TileTone = before.status === "liquidatable" ? "crit" : before.status === "near" ? "warn" : "neutral";
  const side = selected.after;
  // An uncomputable after side refuses its figures as the Inspector refuses an unknowable position's: a debt beside
  // "Not computed" would read as a computed one.
  const after = computableSide(side);
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
  return { state: "rows", address, rows, selected, headline: rowHeadline(short, selected, decimals), tiles, batchId, stressBatchId, stressBatchChip, decimals, cause: null };
}

/**
 * The library row's word in one-address mode: the wire's own verdict fields for
 * that address, in the words the table beside it uses. A scenario the address
 * was not stressed under is "not on this address"; an inapplicable row carries
 * the engine's reason; an unknowable verdict is a cannot-say, never a "No".
 */
export function rowOutcome(row: StressRow | undefined): LibraryOutcome {
  if (row === undefined) return { key: "not-covered", text: "Not on this address", tone: "dim" };
  const verdict = rowVerdict(row);
  switch (verdict.kind) {
    case "not-applicable":
      return { key: "not-covered", text: `Not applicable: ${verdict.reason}`, tone: "dim" };
    case "cannot-say":
      return { key: "withheld", text: "Cannot say", tone: "refused" };
    case "liquidatable":
      if (verdict.within !== null) return { key: "result", text: `Becomes liquidatable within ${horizonLabel(verdict.within.seconds)}`, tone: "warn" };
      return { key: "result", text: verdict.already ? "Liquidatable today and after" : "Becomes liquidatable", tone: "crit" };
    case "inside":
      return { key: "result", text: verdict.through === null ? "Stays inside its cap" : `Stays inside its cap through ${horizonLabel(verdict.through.seconds)}`, tone: "ok" };
  }
}
