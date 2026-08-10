// Truth primitives: the honest-rendering vocabulary every surface must use.
//
// These encode spec §5 (honest-UI laws) as functions, so a surface that
// renders through them cannot commit the two classic lies:
//
//   1. `found: null` rendered as "no position". The wire's three-valued
//      `found` reaches the UI only as @solvent/client's sealed
//      `LookupOutcome`, and `renderLookupOutcome` maps `unknowable` to
//      "cannot be established" — never to the definitive negative.
//   2. A NULL total rendered as 0 — "the most dangerous zero".
//      `renderNullableDecimal(null)` is an em dash, never "0".
//
// tests/unit/honest-render.spec.ts pins both laws.

import { formatUnits, type LookupOutcome } from "@solvent/client";
import { isWirePopulation } from "./wireGuard";

/** The one glyph for "this quantity is not applicable / not established". */
export const EM_DASH = "—";

/** The three lookup outcomes, rendered. `unknowable` is NEVER "no position". */
export const LOOKUP_PHRASES: Record<LookupOutcome, string> = {
  found: "position found",
  "not-found": "no position",
  unknowable: "cannot be established",
};

/**
 * Render a three-valued lookup outcome (from `@solvent/client`'s `lookup()`).
 *
 * The only state entitled to say "no position" is `not-found` — a definitive
 * negative from a complete lookup. `unknowable` (the wire's `found: null`)
 * says the answer cannot be established, which is a statement about the
 * SERVICE's coverage, not about the address.
 */
export function renderLookupOutcome(outcome: LookupOutcome): string {
  return LOOKUP_PHRASES[outcome];
}

export interface RenderDecimalOptions {
  /**
   * When set, `value` is an integer quantity at this scale and is rendered
   * through the client's exact `formatUnits` (no float ever holds it).
   * When absent, `value` is already a decimal string and passes through.
   */
  decimals?: number;
  /** Drop trailing fractional zeros (only meaningful with `decimals`). */
  trim?: boolean;
  /** Prepended to non-null values only (e.g. "$"). Null stays a bare dash. */
  prefix?: string;
}

/**
 * Render a `NullableDecimal` from the wire.
 *
 * `null` means "not applicable on this engine" / "not established" — a
 * different statement from zero, and it renders as an em dash, never "0".
 */
export function renderNullableDecimal(
  value: string | null,
  options: RenderDecimalOptions = {},
): string {
  if (value === null) return EM_DASH;
  const body =
    options.decimals === undefined
      ? value
      : formatUnits(value, options.decimals, { trim: options.trim ?? true });
  return options.prefix === undefined ? body : `${options.prefix}${body}`;
}

/**
 * Group an integer (block number, count) with thin separators: 25,641,730.
 *
 * p1b-14 (Codex round 6): a block height is a wire POPULATION (a nonnegative
 * safe integer), and this is the one chokepoint every wire block renders
 * through. A bare `toLocaleString` rendered `JSON.parse("-1e-324")` (-0, the
 * surviving fingerprint of an out-of-contract fractional token) as "-0", a
 * negative as "-25", an unsafe integer as a rounded lie. Out-of-contract
 * input renders the WORD register instead — `unreadable`, the p1b-13
 * LabTornado vocabulary for a number nobody may read — never a throw:
 * `formatBlock` renders inside the layout-level PostureRibbon, ABOVE the
 * p1b-0 route boundary, where a throw would unmount the app shell.
 */
export function formatBlock(block: number): string {
  if (!isWirePopulation(block)) return "unreadable";
  return block.toLocaleString("en-US");
}

/**
 * Render a block reference with its OPTIONAL header time.
 *
 * `block_time` is chain-asserted custody (spec §7.1) and is null until the
 * header is captured. A null block time renders as the block number alone —
 * a real fact — never an invented or interpolated timestamp.
 */
export function renderBlockTime(block: number, blockTimeIso: string | null): string {
  if (blockTimeIso === null) return `block ${formatBlock(block)}`;
  return blockTimeIso;
}

/** `0x3c19…88af` — 0x + first 4 + ellipsis + last 4. Full value stays in `title`/copy. */
export function truncateAddress(address: string): string {
  if (address.length <= 12) return address;
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

/** The contract's strict address shape — `^0x` + 40 hex digits, verbatim. */
export const ADDRESS_PATTERN = /^0[xX][0-9a-fA-F]{40}$/;

export function isAddress(value: string): boolean {
  return ADDRESS_PATTERN.test(value);
}
