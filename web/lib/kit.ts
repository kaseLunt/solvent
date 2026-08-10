// The component kit's composition law (p1a-5) — PURE, per the p1a-4b lift
// pattern: enforcement lives here, where unit specs can pin it, and the thin
// components in web/components render these models verbatim. Canon:
// build-contract §4 (verdict banner grammar, RATIFIED), §5–§6 (the chip
// family's nine dimensions), §7 (exact-layer affordance), §8 (states).

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

/* ---------------------------------------------------------------------------
 * THE TYPED IDENTITY MODEL (p1a-9 — the Codex finding: the ReactNode
 * identity was bypassable by render-empty ELEMENTS: `identityMissing`
 * inspected the unrendered node tree, so an empty fragment — an element,
 * therefore "content" — sailed past the law and mounted a banner with a
 * blank strip. The p1a-6 DOM pin caught the styleguide's strips, but the law
 * itself stayed evadable at every future call site.)
 *
 * So the ReactNode identity RETIRES. The banner now takes a TYPED model of
 * the §4 strip — batch · age · coverage · current/projected · evidence, the
 * ratified contents, one optional clause per field — and renders the strip
 * ITSELF from the chip family. There is no node to smuggle: absence is a
 * missing/blank model, presence is at least one clause with text, and the
 * distinction is decidable data, not a rendering prophecy.
 * ------------------------------------------------------------------------- */

/**
 * One §4 strip clause: sans narration (`text`), an optional EMBEDDED VALUE in
 * the mono register (§5 law — ages, counts, ids, wire codes are mono, never
 * uppercase), an optional sans suffix after the value ("… ENGINES", "… · DM
 * WITHHELD"), and the §6 chip tone it wears (quiet when unstated).
 */
export interface VerdictIdentityClause {
  readonly text?: string;
  readonly value?: string;
  readonly suffix?: string;
  readonly tone?: ChipTone;
}

/** The §4 identity strip, field for field. Every clause optional — but a
 * model with NO present clause is a missing strip (the refusal law). */
export interface VerdictIdentityModel {
  readonly batch?: VerdictIdentityClause;
  readonly age?: VerdictIdentityClause;
  readonly coverage?: VerdictIdentityClause;
  readonly currentOrProjected?: VerdictIdentityClause;
  readonly evidence?: VerdictIdentityClause;
}

/** The §4 render order — the canon names the fields in exactly this order. */
export const VERDICT_IDENTITY_ORDER = [
  "batch",
  "age",
  "coverage",
  "currentOrProjected",
  "evidence",
] as const;

export type VerdictIdentitySlot = (typeof VERDICT_IDENTITY_ORDER)[number];

/** A clause is present when ANY of its text parts survives trimming. */
function clausePresent(clause: VerdictIdentityClause | undefined): clause is VerdictIdentityClause {
  if (clause === undefined) return false;
  return [clause.text, clause.value, clause.suffix].some(
    (part) => part !== undefined && part.trim() !== "",
  );
}

/**
 * Is the identity strip MISSING? No model, or a model whose every clause is
 * absent or blank. This is the whole test — there is no render-empty shape
 * left to inspect, which is the point of the typed model.
 */
export function verdictIdentityMissing(
  identity: VerdictIdentityModel | null | undefined,
): boolean {
  if (identity === null || identity === undefined) return true;
  return !VERDICT_IDENTITY_ORDER.some((slot) => clausePresent(identity[slot]));
}

/** One strip chip, ready to render verbatim: slot, resolved tone, parts. */
export interface VerdictIdentityChip {
  readonly slot: VerdictIdentitySlot;
  readonly text: string | null;
  readonly value: string | null;
  readonly suffix: string | null;
  readonly tone: ChipTone;
}

/** The present clauses, in §4 order, tones defaulted to quiet. */
export function verdictIdentityChips(
  identity: VerdictIdentityModel,
): readonly VerdictIdentityChip[] {
  const chips: VerdictIdentityChip[] = [];
  for (const slot of VERDICT_IDENTITY_ORDER) {
    const clause = identity[slot];
    if (!clausePresent(clause)) continue;
    chips.push({
      slot,
      text: clause.text !== undefined && clause.text.trim() !== "" ? clause.text : null,
      value: clause.value !== undefined && clause.value.trim() !== "" ? clause.value : null,
      suffix: clause.suffix !== undefined && clause.suffix.trim() !== "" ? clause.suffix : null,
      tone: clause.tone ?? "quiet",
    });
  }
  return chips;
}

export type VerdictBannerModel =
  | {
      kind: "refusal";
      toneClass: "vWarn";
      answer: string;
      qualification: string;
    }
  | { kind: "banner"; toneClass: VerdictToneClass; identity: readonly VerdictIdentityChip[] };

/** The banner's one decision: refuse without the strip, else wear the
 * variant's tone and carry the strip's chips in §4 order. */
export function verdictBannerModel(
  variant: VerdictVariant,
  identity: VerdictIdentityModel | null | undefined,
): VerdictBannerModel {
  if (verdictIdentityMissing(identity)) {
    return {
      kind: "refusal",
      toneClass: "vWarn",
      answer: VERDICT_IDENTITY_REFUSAL.answer,
      qualification: VERDICT_IDENTITY_REFUSAL.qualification,
    };
  }
  return {
    kind: "banner",
    toneClass: VERDICT_TONE_CLASS[variant],
    identity: verdictIdentityChips(identity ?? {}),
  };
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
