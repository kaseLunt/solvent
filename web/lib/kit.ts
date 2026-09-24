// The component kit's composition law — PURE: enforcement lives here, where
// unit specs can pin it, and the thin components in web/components render
// these models verbatim. Canon: build-contract §4 (the page answer never
// stands without its identity), §5–§6 (the chip family's nine dimensions),
// §7 (exact-layer affordance), §8 (states).
import type { Band } from "../components/kit/BandBars";
import type { IdentityChip } from "../components/kit/IdentityChips";
import type { Tone as KpiTone } from "../components/kit/KpiTile";
import type { LibraryOutcomeTone } from "../components/kit/ScenarioLibrary";
import type { StatusPillProps } from "../components/kit/StatusPill";
import type { StepTone } from "../components/kit/StepStrip";
import type { TrustCheckItem } from "../components/kit/TrustChecklist";
import type { VerdictHeaderProps } from "../components/kit/VerdictHeader";
import type { LivePillWords } from "./live-pill";

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

/* ---------------- the tone grammar ---------------- */

/** The rows of the one tone grammar. Every kit vocabulary below names these rows in its own words. */
export type GrammarTone = "neutral" | "ok" | "live" | "warn" | "crit" | "refused";

/**
 * THE TONE GRAMMAR — one meaning per colour, product-wide. A vocabulary may name a row in its own words or leave a row
 * out; it never gives a colour a second meaning. Text wears the row's ink (the -text grade clears 4.5:1 on its worst
 * ground); a border or a fill keeps the fill grade.
 *
 * Page vocabularies outside the kit map onto the same rows: the Activity feed's tag tones (a key record is neutral,
 * set semibold), Verification's card tones (default is neutral, dim is a caption), and the evidence rows' tones.
 */
export const TONE_GRAMMAR: Readonly<Record<GrammarTone, { readonly ink: string; readonly means: string }>> = {
  neutral: { ink: "--ink", means: "A record, a fact or an operational state: fresh data, a completed lookup, a served batch." },
  ok: { ink: "--ok-text", means: "A health verdict, or a proof or check that passed — nothing else." },
  live: { ink: "--accent-text", means: "Connection or serving posture: the stream, the live batch. Never health." },
  warn: {
    ink: "--warn-text",
    means: "A verdict short of crit (near cap, a drifted receipt), a projection, an aging age or a result superseded by a newer one, or a stream that is reconnecting.",
  },
  crit: { ink: "--crit-text", means: "A liquidatable or failed verdict, or a stale or critical age." },
  refused: { ink: "--ink-2", means: "No answer to show — refused, unavailable, not run, not served, pending or unreadable; STATE_REGISTERS says which." },
};

/**
 * Each kit vocabulary, mapped onto the grammar. The types stay each component's own; these maps are exhaustive over
 * them, so a tone added to a component without a row here fails the type gate.
 */
export const TONE_VOCABULARIES = {
  kpiTile: { neutral: "neutral", crit: "crit", warn: "warn", ok: "ok", refused: "refused" } satisfies Record<KpiTone, GrammarTone>,
  identityChip: { neutral: "neutral", ok: "ok", warn: "warn", crit: "crit", refused: "refused" } satisfies Record<
    NonNullable<IdentityChip["tone"]>,
    GrammarTone
  >,
  /** The header's `refused` and `absent` share the absent register: a headline that states there is no answer, the whole line ink-2. */
  verdictHeader: { crit: "crit", warn: "warn", ok: "ok", neutral: "neutral", refused: "refused", absent: "refused" } satisfies Record<
    VerdictHeaderProps["tone"],
    GrammarTone
  >,
  /** `projection` is warn, dashed and never filled: a projected figure is flagged, not judged. */
  statusPill: { crit: "crit", warn: "warn", ok: "ok", refused: "refused", live: "live", projection: "warn" } satisfies Record<
    StatusPillProps["tone"],
    GrammarTone
  >,
  /** The status-chip family: `accent` is live posture, `crit-fill` is crit's one escalation fill, `quiet` is ink, `unknown` is dashed. */
  statusChip: {
    ok: "ok",
    accent: "live",
    warn: "warn",
    crit: "crit",
    "crit-fill": "crit",
    quiet: "neutral",
    unknown: "refused",
  } satisfies Record<ChipTone, GrammarTone>,
  /** `dim` claims nothing: not connected is ink at rest, never a tier's colour. */
  livePill: { live: "live", warn: "warn", dim: "neutral" } satisfies Record<LivePillWords["tone"], GrammarTone>,
  livePillAge: { neutral: "neutral", warn: "warn", crit: "crit", dim: "neutral" } satisfies Record<LivePillWords["ageTone"], GrammarTone>,
  /** A tick is a check that passed; a check still in flight is no answer yet, never a failure. */
  trustCheck: { ok: "ok", warn: "warn", refused: "refused", dim: "neutral", pending: "refused" } satisfies Record<
    TrustCheckItem["state"],
    GrammarTone
  >,
  stepStrip: { neutral: "neutral", ok: "ok", warn: "warn", crit: "crit", refused: "refused" } satisfies Record<StepTone, GrammarTone>,
  bandBars: { neutral: "neutral", crit: "crit", warn: "warn", dim: "neutral" } satisfies Record<NonNullable<Band["tone"]>, GrammarTone>,
  libraryOutcome: { crit: "crit", warn: "warn", ok: "ok", refused: "refused", dim: "neutral" } satisfies Record<LibraryOutcomeTone, GrammarTone>,
} as const;

/* ---------------- the state registers ---------------- */

/** Which absence a tile, a card, a strip or a step is showing when it has no figure. */
export type StateRegister = "refused" | "unavailable" | "not-run" | "not-served" | "pending" | "unreadable";

export interface StateRegisterSpec {
  /** The word printed where the figure would be — never a dash, which reads as "nothing here". */
  readonly word: string;
  /** Dashed is the refused and unreadable form; every other absence is drawn solid. */
  readonly frame: "dashed" | "solid";
  /** The refused register sits on the refused ground; the rest on the panel. */
  readonly ground: "refused" | "panel";
  /** A read in flight is aria-busy. */
  readonly busy: boolean;
}

/**
 * THE STATE REGISTERS. `refused` — the engine or the service declined to answer. `unavailable` — the fetch failed:
 * never the refused register, because a failed request is not a refusal. `not-run` — served, never run. `not-served`
 * — this deployment does not serve it. `pending` — the read is in flight: never "failed", never "unavailable".
 * `unreadable` — the answer came, and the page could not read it.
 */
export const STATE_REGISTERS: Readonly<Record<StateRegister, StateRegisterSpec>> = {
  refused: { word: "Refused", frame: "dashed", ground: "refused", busy: false },
  unavailable: { word: "Unavailable", frame: "solid", ground: "panel", busy: false },
  "not-run": { word: "Not run", frame: "solid", ground: "panel", busy: false },
  "not-served": { word: "Not served", frame: "solid", ground: "panel", busy: false },
  pending: { word: "…", frame: "solid", ground: "panel", busy: true },
  unreadable: { word: "Unreadable", frame: "dashed", ground: "panel", busy: false },
};

/** The word a state prints: the lib's own word where it has one (e.g. "No verdict" for the engine-refused population), else the register's. */
export function stateWordOf(state: StateRegister, word?: string): string {
  return word !== undefined && word.trim() !== "" ? word : STATE_REGISTERS[state].word;
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
   * "state" = the state word, in sentence case (Refused / Withheld) ·
   * "cause" = the plain-language cause (phrasebook sentence) ·
   * "wire" = the wire code — mono, always last, never leading.
   */
  register: "state" | "cause" | "wire";
}

export function refusedChipSegments(
  cause: string,
  wire?: string,
  word: string = STATE_REGISTERS.refused.word,
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

/* ---------------- heatmap ---------------- */

/** The heatmap corner names its two axes in words: an arrow on this page means a link, and the corner is none. */
export function heatCornerLabel(rowsLabel: string, colsLabel: string): string {
  return `Rows: ${rowsLabel} · columns: ${colsLabel}`;
}
