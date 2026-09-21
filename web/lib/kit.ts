// The component kit's composition law — PURE: enforcement lives here, where
// unit specs can pin it, and the thin components in web/components render
// these models verbatim. Canon: build-contract §4 (the page answer never
// stands without its identity), §5–§6 (the chip family's nine dimensions),
// §7 (exact-layer affordance), §8 (states).
import type { IdentityChip } from "../components/kit/IdentityChips";

/* ---------------- the page answer's identity (§4) ---------------- */

/**
 * The chip the header's strip prints when it was handed no identity: dashed,
 * in the refused register, NAMING the omission. A missing identity is not a
 * dev-throw and not a blank strip — the header says, on the page, that it
 * cannot say whose answer this is.
 */
export const IDENTITY_MISSING_CHIP: IdentityChip = { label: "Identity", value: "missing", tone: "refused" };

/** A chip is present when its label or its value survives trimming; a chip of blanks names nothing. */
function chipPresent(chip: IdentityChip): boolean {
  return chip.label.trim() !== "" || chip.value.trim() !== "";
}

/**
 * THE LAW (§4): the page answer never renders without its identity. The
 * kit's `VerdictHeader` hands its chips through here before it renders its
 * strip. A list with no present chip — empty, or every chip blank — is a
 * missing identity, and is answered with the one refusal chip. Absence is
 * decided on the chips' own text, which is data: there is no element here to
 * smuggle an empty strip past the law. A list with at least one present chip
 * comes back AS IT WAS HANDED — the same array, nothing dropped, nothing
 * re-ordered: the law refuses absence, it does not edit identity.
 */
export function headerIdentity(chips: IdentityChip[]): IdentityChip[] {
  return chips.some(chipPresent) ? chips : [IDENTITY_MISSING_CHIP];
}

/* ---------------- chip family (§5–§6) ---------------- */

export type ChipTone = "ok" | "accent" | "warn" | "crit" | "crit-fill" | "quiet" | "unknown";

export type ChipToneClass =
  | "cOk"
  | "cAccent"
  | "cWarn"
  | "cCrit"
  | "cCritFill"
  | "cQuiet"
  | "cUnknown";

/**
 * Tone → §6 class recipe. Outline-first: exactly one tone carries a fill —
 * crit-fill, the top escalation register, shared by exactly two things
 * (critical comparators and critical age). Green is rationed: `ok` means
 * comfortably healthy only — fresh data, completed lookups, and
 * near-threshold positions never render green.
 */
export const CHIP_TONE_CLASS: Record<ChipTone, ChipToneClass> = {
  ok: "cOk",
  accent: "cAccent",
  warn: "cWarn",
  crit: "cCrit",
  "crit-fill": "cCritFill",
  quiet: "cQuiet",
  unknown: "cUnknown",
};

/* refused chip (§5 D5): "Refusal chips lead with the plain cause; the wire
 * code rides secondary" — and the §8 anti-state panel forbids "a wire
 * refusal code as the leading chip text". The segment ORDER below is the
 * render order; the component maps it verbatim. */

export interface ChipSegment {
  text: string;
  /**
   * "state" = the uppercase state word (REFUSED / WITHHELD) ·
   * "cause" = the plain-language cause (phrasebook sentence) ·
   * "wire" = the wire code — mono, always last, never leading.
   */
  register: "state" | "cause" | "wire";
}

export function refusedChipSegments(
  cause: string,
  wire?: string,
  word = "REFUSED",
): readonly ChipSegment[] {
  const segments: ChipSegment[] = [
    { text: word, register: "state" },
    { text: cause, register: "cause" },
  ];
  if (wire !== undefined) segments.push({ text: wire, register: "wire" });
  return segments;
}

/* ---------------- exact-layer affordance (§7) ---------------- */

/**
 * The cue is the contract: MANDATORY wherever human ≠ exact (KPIs, chart
 * annotations, table money at display precision, banner values);
 * FORBIDDEN on values that are already exact — a false scent is a lie.
 */
export function exactValueMode(human: string, exact: string): "affordance" | "plain" {
  return human === exact ? "plain" : "affordance";
}

/** The §7 featured-specimen aria grammar, composed from the two layers. */
export function exactAriaLabel(human: string, exact: string): string {
  return `${human} — exact: ${exact}. Press Enter to copy the exact value.`;
}
