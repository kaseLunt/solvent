// The Cash walk's law, as one pure step per page — the hook fetches and lands,
// and every judgement about a page is made here, where it can be pinned.
//
// The laws this module keeps:
//   - a page is never dereferenced before it is judged: whatever the fetch
//     resolved with goes through `readCashPage`, inside a catch, so a body that
//     cannot be read ends the walk BY NAME and never as a throw that leaves the
//     walk looking alive;
//   - an account is one identity across the whole walk, whatever the case its
//     address is spelled in: a page that delivers an account the walk already
//     read is a named fault — which account, which pages. The repeated row is
//     not landed and not counted, the walk does not complete on it, and no
//     figure over a walk that repeated an account is called a lower bound;
//   - a terminal page completes the walk only when the distinct rows delivered
//     equal the census the wire advertised.
import { censusFaultWords, duplicateFaultWords, type WalkStopKind } from "./book-headline";
import { readCashPage, type CashPageExpectation, type CashPageReading, type CashRow } from "./cash-rows";

/** What the walk has landed so far: the census it is held to, the rows delivered, and every account read, by the page that delivered it. */
export interface WalkTally {
  /** The census the first page advertised; every later page must advertise the same. */
  readonly advertised: number | null;
  readonly delivered: number;
  /** Pages landed so far — the next page is this plus one. */
  readonly pages: number;
  /** Lower-cased account → the 1-based page that first delivered it. */
  readonly accounts: ReadonlyMap<string, number>;
}

export const WALK_START: WalkTally = { advertised: null, delivered: 0, pages: 0, accounts: new Map() };

export type WalkStep =
  /** The page answers for another batch: the caller reloads the book once for this id. */
  | { readonly kind: "moved"; readonly batchId: number }
  /** The positions endpoint withheld the engine's whole book. */
  | { readonly kind: "refused"; readonly code: string | null; readonly detail: string | null }
  /** The walk ends here, by name. `rows` are the rows this page may still land — never a repeated account. */
  | { readonly kind: "stopped"; readonly rows: readonly CashRow[]; readonly fault: string; readonly stop: WalkStopKind }
  /** The page landed. `next` is its cursor — null exactly when the walk is `complete`. */
  | { readonly kind: "landed"; readonly rows: readonly CashRow[]; readonly complete: boolean; readonly next: string | null; readonly tally: WalkTally };

/**
 * Judge one fetched page against the book it is walked for and the walk so
 * far. Never throws: whatever `page` is, the answer is one of the four steps.
 */
export function walkStep(page: unknown, expect: CashPageExpectation, tally: WalkTally): WalkStep {
  let reading: CashPageReading;
  try {
    reading = readCashPage(page, expect);
  } catch (cause: unknown) {
    reading = { kind: "malformed", fault: `the page could not be decoded: ${cause instanceof Error ? cause.message : String(cause)}` };
  }
  if (reading.kind === "other-batch") return { kind: "moved", batchId: reading.batchId };
  if (reading.kind === "refused") return { kind: "refused", code: reading.code, detail: reading.detail };
  // A page that could not be read is not known to be the last one: the walk stopped before it read its end.
  if (reading.kind === "malformed") return { kind: "stopped", rows: [], fault: reading.fault, stop: "before-end" };

  const pageNumber = tally.pages + 1;
  const accounts = new Map(tally.accounts);
  const distinct: CashRow[] = [];
  let repeated: { account: string; first: number } | null = null;
  let others = 0;
  for (const row of reading.rows) {
    const identity = row.account.toLowerCase();
    const first = accounts.get(identity);
    if (first === undefined) {
      accounts.set(identity, pageNumber);
      distinct.push(row);
    } else if (repeated === null) {
      repeated = { account: row.account, first };
    } else {
      others += 1;
    }
  }
  if (repeated !== null) {
    return { kind: "stopped", rows: distinct, fault: duplicateFaultWords(repeated.account, repeated.first, pageNumber, others), stop: "duplicate" };
  }
  if (tally.advertised !== null && reading.total !== tally.advertised) {
    return {
      kind: "stopped",
      rows: reading.rows,
      fault: `the census changed mid-walk: ${String(tally.advertised)} rows advertised, then ${String(reading.total)}`,
      stop: reading.last ? "at-end" : "before-end",
    };
  }
  const delivered = tally.delivered + reading.rows.length;
  // Past the census on any page; short of it only once the last page has landed.
  const over = delivered > reading.total;
  if (over || (reading.last && delivered !== reading.total)) {
    return { kind: "stopped", rows: reading.rows, fault: censusFaultWords(delivered, reading.total), stop: over ? "over" : "at-end" };
  }
  return {
    kind: "landed",
    rows: reading.rows,
    complete: reading.last,
    next: reading.next,
    tally: { advertised: reading.total, delivered, pages: pageNumber, accounts },
  };
}
