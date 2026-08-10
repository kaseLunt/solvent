// The component kit's composition law (p1a-5) — PURE, per the p1a-4b lift
// pattern: enforcement lives here, where unit specs can pin it, and the thin
// components in web/components render these models verbatim. Canon:
// build-contract §4 (verdict banner grammar, RATIFIED), §5–§6 (the chip
// family's nine dimensions), §7 (exact-layer affordance), §8 (states).

import type { ReactNode } from "react";

/* ---------------- verdict banner (§4) ---------------- */

export type VerdictVariant = "current" | "refused" | "superseded" | "empty" | "partial";

export type VerdictToneClass = "vAccent" | "vWarn" | "vQuiet";

/**
 * Left-border tone per variant, per §4's CSS. Current wears the accent
 * spine; refused / superseded / partial wear the warn spine — "a banner
 * whose data is superseded, refused, or partial switches variant — it
 * never silently keeps the happy sentence"; empty is quiet, because
 * absence is a computed answer, not an alarm. (§4's CSS also defines a
 * crit spine, `.vCrit`; no phase-1 variant maps to it — it is the
 * grammar's escalation slot, not a live arm.)
 */
export const VERDICT_TONE_CLASS: Record<VerdictVariant, VerdictToneClass> = {
  current: "vAccent",
  refused: "vWarn",
  superseded: "vWarn",
  empty: "vQuiet",
  partial: "vWarn",
};

/**
 * The RATIFIED law (§4): "The banner never renders without its identity
 * strip." A missing strip is not a dev-throw — the banner renders a
 * structural refusal NAMING the omission, in the warn register.
 */
export const VERDICT_IDENTITY_REFUSAL = {
  answer: "Verdict withheld — this banner has no identity strip.",
  qualification:
    "The banner was composed without its identity strip (batch · age · coverage · current/projected · evidence), so it cannot say whose answer it is, how fresh, or who answered. The banner never renders without its identity strip.",
} as const;

/**
 * Is the identity slot EMPTY as React would render it? null, undefined,
 * booleans, empty/whitespace-only strings, and arrays holding only those
 * render nothing — and an identity strip that renders nothing is a missing
 * strip. Elements are content; so are numbers (0 is a lawful count, and a
 * zero is never absence).
 */
export function identityMissing(identity: ReactNode): boolean {
  if (identity === null || identity === undefined) return true;
  if (typeof identity === "boolean") return true;
  if (typeof identity === "string") return identity.trim() === "";
  if (Array.isArray(identity)) {
    return identity.every((entry) => identityMissing(entry as ReactNode));
  }
  return false;
}

export type VerdictBannerModel =
  | {
      kind: "refusal";
      toneClass: "vWarn";
      answer: string;
      qualification: string;
    }
  | { kind: "banner"; toneClass: VerdictToneClass };

/** The banner's one decision: refuse without the strip, else wear the variant's tone. */
export function verdictBannerModel(variant: VerdictVariant, identity: ReactNode): VerdictBannerModel {
  if (identityMissing(identity)) {
    return {
      kind: "refusal",
      toneClass: "vWarn",
      answer: VERDICT_IDENTITY_REFUSAL.answer,
      qualification: VERDICT_IDENTITY_REFUSAL.qualification,
    };
  }
  return { kind: "banner", toneClass: VERDICT_TONE_CLASS[variant] };
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
