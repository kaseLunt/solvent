// The one-address workspace. It is the Inspector's reading — its stress rows,
// its decimals, its Cash position as today — arranged under the selected
// scenario. No second stress reader exists; the Inspector's laws hold here.
import { cannotSayTitle, computableSide, horizonLabel, roomWords, rowVerdict, sideRoomWords, stressVerdictWords, type ScaleAbsence, type StressRow, type StressSide, type StressVerdictWords } from "./address-stress";
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
/** One row of the scenarios table as it prints: the stress row, and its verdict cell — the Inspector's words for the Inspector's judgement of that row. */
export interface AddressTableRow {
  readonly row: StressRow;
  readonly verdict: StressVerdictWords;
}
export interface AddressWorkspace {
  readonly state: AddressWorkspaceState;
  readonly address: string;
  readonly rows: readonly StressRow[];
  /**
   * Every row with its verdict cell, in the rows' order. The table prints these and words nothing of its own, so one
   * row can never be worded two ways on two pages: the words are the Inspector's word function over the Inspector's judge.
   */
  readonly table: readonly AddressTableRow[];
  readonly selected: StressRow | null;
  /**
   * The disclosure when the scenario the reader or the link NAMED is not one this address was stressed under: the
   * subject falls back to the first row the address carries, and the page says so — which scenario was not evaluated,
   * and which is shown in its place. The URL follows the subject shown, so the fallback is never silent. Null when the
   * named scenario is the subject, or none was named.
   */
  readonly fallback: string | null;
  readonly headline: LabHeadline;
  readonly tiles: AddressTiles | null;
  readonly batchId: number | null;
  /** The stress response's own batch, null when it names none readably; unless it is the position's, the comparison is refused and what is known of both is named. */
  readonly stressBatchId: number | null;
  /**
   * The "Stress for batch" chip's value, from the Inspector's own batch note: present exactly when the stress result's
   * batch is not known to be the position's — another batch, or no readable batch at all, which the chip says in the
   * note's words. After a resume repair — which refreshes the position and replays no stress — it says the stress is
   * from the previous lookup, in the note's words.
   */
  readonly stressBatchChip: string | null;
  /** The scenarios section's qualifier: what the rows were applied to, and at which batch when that is not the position's. */
  readonly qualifier: string;
  readonly decimals: number | null;
  /** Why there is no scale to print at, when there is none: the table says the true cause, never "unreadable scale" for a lookup that holds no Cash position. */
  readonly scaleAbsence: ScaleAbsence | null;
  readonly cause: string | null;
}

const REFUSED_TILE: AddressTile = { value: "—", tone: "refused" };
const NOT_COMPUTED: AddressTile = { value: "Not computed", tone: "refused" };
const PROJECTIONS_NOT_READINGS = "shocked figures are projections, not readings";
const QUALIFIER = `applied to this account · ${PROJECTIONS_NOT_READINGS}`;

function empty(state: AddressWorkspaceState, address: string, headline: LabHeadline, cause: string | null = null): AddressWorkspace {
  return { state, address, rows: [], table: [], selected: null, fallback: null, headline, tiles: null, batchId: null, stressBatchId: null, stressBatchChip: null, qualifier: QUALIFIER, decimals: null, scaleAbsence: "no-lookup", cause };
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

/**
 * A stress response that reports no position. The negative is the STRESS response's own — a request of its own, which
 * may answer another batch than the lookup did — so it is named with ITS batch and never the lookup's: "no position
 * in batch N" beside a position the page loaded for batch N is a sentence neither response said. Where the lookup
 * itself holds no Cash position the two agree and the negative stands as the finding. Where the lookup holds one, or
 * withholds the book, the two answers are not one fact: what is known of both batches is disclosed first, and the
 * stress response's negative is said after it, as that response's answer about its own batch.
 */
function noPosition(address: string, short: string, view: InspectorView): AddressWorkspace {
  const batchId = view.batchId;
  const stressBatchId = view.stressBatchId;
  const sameBatch = batchId !== null && stressBatchId !== null && stressBatchId === batchId;
  const stressAt = stressBatchId === null ? "a batch it does not name readably" : `batch ${groupInt(stressBatchId)}`;
  const state = (headline: LabHeadline): AddressWorkspace => empty("no-position", address, headline);
  // Where the lookup does not itself say "no Cash position", the strip names both batches, the stress batch in the Inspector's words.
  const disclosed = (headline: LabHeadline): AddressWorkspace => ({ ...state(headline), batchId, stressBatchId, stressBatchChip: sameBatch ? null : (stressBatchNote(view)?.chipValue ?? null) });
  // A withheld Cash book is asked first of all, as it is beside rows: the lookup's answer there is cannot-say, never "no position".
  if (view.state === "cannot-compute") {
    return disclosed(refused(`Cannot say — the Cash book is withheld for ${short}.`, `The stress response reports no position in ${stressAt} while the lookup's Cash book is withheld — the two answers disagree.`));
  }
  // The lookup's own negative — nothing found, or a legacy position alone — agrees with the stress response's.
  if (view.cash === null) {
    if (sameBatch) return state(refused(`No Cash position for ${short} in ${stressAt}.`, "The lookup is complete: there is nothing to stress."));
    const lookupAt = batchId === null ? "names no readable batch" : `is batch ${groupInt(batchId)}`;
    return state(
      refused(
        `No Cash position for ${short} in ${stressBatchId === null ? "a batch the stress response does not name readably" : stressAt}.`,
        `That is the stress response's own answer, for its own batch; the lookup above ${lookupAt} and holds no Cash position either.`,
      ),
    );
  }
  if (sameBatch) {
    return disclosed(
      refused(
        `Cannot say — the lookup holds a Cash position for ${short} in ${stressAt}, and the stress response reports none in the same batch.`,
        "The two answers disagree about one batch. Nothing is stressed; the position above is the lookup's own.",
      ),
    );
  }
  const stressBatchWords = stressBatchId === null ? "the stress result names no readable batch" : `the stress result is for ${stressAt}`;
  const positionBatchWords = batchId === null ? "the position above names no readable batch" : `the position above is batch ${groupInt(batchId)}`;
  const reports = `reports no position for ${short} in ${stressAt}${stressBatchId === null ? "" : " — its own batch, not the position's"}.`;
  const law = batchId !== null && stressBatchId !== null ? "A position and a stress result from different batches are not compared." : "A stress result and a position are compared only when both name the same batch.";
  const dek = view.stressFromPreviousLookup
    ? `The stress response was read for the previous lookup, and the position above was refreshed since. It ${reports} ${law}`
    : `The stress response ${reports} ${law}`;
  return disclosed(refused(`Cannot say — ${stressBatchWords}; ${positionBatchWords}.`, dek));
}

/** The scenario the reader or the link named, where one was: its label, as the listing prints it, for the fallback's disclosure. */
export interface NamedScenario {
  readonly id: string;
  readonly label: string;
}

export function addressWorkspace(input: { address: string; view: InspectorView | null; selectedId: string | null; named?: NamedScenario | null }): AddressWorkspace {
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
  if (stress.kind === "no-position") return noPosition(address, short, view);
  if (stress.kind === "withheld") {
    return empty("withheld", address, refused(`Cannot say — the Cash book is withheld for ${short}.`, `${sentence(stress.cause)} A withheld book is not a computed book.`), stress.cause);
  }
  const rows = stress.rows;
  const table: AddressTableRow[] = rows.map((row) => ({ row, verdict: stressVerdictWords(rowVerdict(row)) }));
  const selected = rows.find((r) => r.id === selectedId) ?? rows[0] ?? null;
  // A named scenario the address does not carry is never shown as if it were evaluated: the subject is the first row
  // the address does carry, and the fallback is said in so many words — what was not evaluated, what is shown instead.
  const named = input.named ?? null;
  const fallback =
    named !== null && selected !== null && selected.id !== named.id
      ? `${named.label} was not evaluated for ${short}: the stress response carries no result for it. ${selected.label} is shown instead — the first scenario this address carries.`
      : null;
  const decimals = view.decimals !== null && isWireScale(view.decimals) ? view.decimals : null;
  // A stress result is the position's only when both name the same readable batch. Another batch, or a stress body
  // that names no readable batch at all, is not compared — an unreadable batch is never read as the position's.
  const sameBatch = batchId !== null && stressBatchId !== null && stressBatchId === batchId;
  // The Inspector's note is the one author of the stress batch's words: the chip and, after a repair, the dek are its
  // own. It is null exactly where the two batches agree.
  const note = sameBatch ? null : stressBatchNote(view);
  const stressBatchChip = note?.chipValue ?? null;
  const stressBatchWords = stressBatchId === null ? "the stress result names no readable batch" : `the stress result is for batch ${groupInt(stressBatchId)}`;
  const positionBatchWords = batchId === null ? "the position above names no readable batch" : `the position above is batch ${groupInt(batchId)}`;
  const qualifier = sameBatch
    ? QUALIFIER
    : `applied to this account at ${stressBatchId === null ? "a batch the stress result does not name readably" : `batch ${groupInt(stressBatchId)}`} · ${positionBatchWords} · ${PROJECTIONS_NOT_READINGS}`;
  // A scale the view handed over but the guard refused is the one case that IS an unreadable scale.
  const scaleAbsence: ScaleAbsence | null = decimals !== null ? null : (view.scaleAbsence ?? "unreadable");
  const bare = (headline: LabHeadline): AddressWorkspace => ({ state: "rows", address, rows, table, selected, fallback, headline, tiles: null, batchId, stressBatchId, stressBatchChip, qualifier, decimals, scaleAbsence, cause: null });
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
  // A position and a stress result are compared only when both name the same batch: the rows are the stress
  // result's own, at its batch; the tiles would set two batches side by side — or a batch beside one nobody can name
  // — so they are refused and what is known of both is named. The lookup's own answers (withheld, no position, an
  // unreadable scale) come first — there is nothing to compare there.
  if (!sameBatch) {
    // A repaired lookup beside the stress it kept is disclosed in the Inspector's sentence — never a second copy of it.
    const dek =
      note !== null && view.stressFromPreviousLookup
        ? note.disclosure
        : batchId !== null && stressBatchId !== null
          ? "The scenarios below are the stress result's own. A position and a stress result from different batches are not compared."
          : "The scenarios below are the stress result's own. A stress result and a position are compared only when both name the same batch.";
    return bare(refused(`Cannot say — ${stressBatchWords}; ${positionBatchWords}.`, dek));
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
  return { state: "rows", address, rows, table, selected, fallback, headline: rowHeadline(short, selected, decimals), tiles, batchId, stressBatchId, stressBatchChip, qualifier, decimals, scaleAbsence, cause: null };
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
