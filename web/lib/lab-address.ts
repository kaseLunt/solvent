// The one-address workspace. It is the Inspector's reading — its stress rows,
// its decimals, its Cash position as today — arranged under the selected
// scenario. No second stress reader exists; the Inspector's laws hold here.
import type { StressRow, StressSide } from "./address-stress";
import { truncateAddress } from "./format";
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

function afterStatus(side: StressSide | null): AddressTile {
  if (side === null || side.verdict === "unknowable") return { value: "Not computed", tone: "refused" };
  return side.verdict === "liquidatable" ? { value: "Liquidatable", tone: "crit" } : { value: "Healthy", tone: "ok" };
}

function roomTile(room: bigint | null, decimals: number, tone: TileTone): AddressTile {
  if (room === null) return REFUSED_TILE;
  if (room < 0n) return { value: `over cap by ${humanUsdFull(-room, decimals)}`, tone: "crit" };
  return { value: humanUsdFull(room, decimals), tone };
}

function roomWords(room: bigint | null, decimals: number): string {
  if (room === null) return "not computed";
  return room < 0n ? `over cap by ${humanUsdFull(-room, decimals)}` : humanUsdFull(room, decimals);
}

function rowHeadline(short: string, row: StressRow, decimals: number): LabHeadline {
  if (!row.applicable) return refused(`${row.label} does not apply to ${short}.`, sentence(row.reason ?? "the engine gave no reason"));
  const before = row.before === null ? "not computed" : roomWords(row.before.room, decimals);
  const after = row.after === null ? "not computed" : roomWords(row.after.room, decimals);
  const dek = `Room today ${before}; after the shock, ${after}.`;
  if (row.flips === null) return refused(`Cannot say whether ${short} becomes liquidatable under ${row.label}.`, `${dek} One side of the comparison is withheld or unknowable.`);
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
  if (selected === null || decimals === null || view.cash === null) {
    return { state: "rows", address, rows, selected, headline: refused(`No scenario applies to ${short}.`, "The stress response carried no scenario for this account."), tiles: null, batchId, decimals, cause: null };
  }
  const money = (v: bigint | null): AddressTile => (v === null ? REFUSED_TILE : { value: humanUsdFull(v, decimals), tone: "neutral" });
  const before = view.cash;
  const roomToneBefore: TileTone = before.status === "liquidatable" ? "crit" : before.status === "near" ? "warn" : "neutral";
  const after = selected.after;
  const tiles: AddressTiles = {
    debtBefore: money(before.debt),
    capBefore: money(before.cap),
    roomBefore: roomTile(before.room, decimals, roomToneBefore),
    statusBefore: STATUS_WORD[before.status],
    debtAfter: money(after?.debt ?? null),
    capAfter: money(after?.cap ?? null),
    roomAfter: after === null ? REFUSED_TILE : roomTile(after.room, decimals, after.verdict === "liquidatable" ? "crit" : "neutral"),
    statusAfter: afterStatus(after),
  };
  return { state: "rows", address, rows, selected, headline: rowHeadline(short, selected, decimals), tiles, batchId, decimals, cause: null };
}
