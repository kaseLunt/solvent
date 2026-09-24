// The app chrome's words: the header (brand, nav, the two quiet controls, the live pill's title), the evidence
// drawer's close control, the kit's own fixed labels (a table region, the band bars, the address field, the scenario
// library), the degradation banner and the route boundary. The components render these verbatim and compose none.
import { humanAge } from "./freshness";
import type { LivePillWords } from "./live-pill";
import { engineList, groupInt } from "./prose";

/* ---------------- header ---------------- */

export const BRAND = {
  name: "Solvent",
  tag: "ether.fi Cash risk",
  linkLabel: "Solvent · go to the overview",
} as const;

/** Nav labels are the page names; the routes are the app's own and do not change with them. */
export const NAV_TABS = [
  { href: "/", label: "Overview" },
  { href: "/book", label: "Book" },
  { href: "/inspector", label: "Inspector" },
  { href: "/lab", label: "Scenarios" },
  { href: "/observatory", label: "History" },
  { href: "/feed", label: "Activity" },
  { href: "/proof", label: "Verification" },
  { href: "/developers", label: "API" },
] as const;

export const NAV_LABEL = "App surfaces";

export const GITHUB_URL = "https://github.com/kaseLunt/solvent";
export const GITHUB_LABEL = "Source on GitHub";

export type ThemeChoice = "system" | "light" | "dark";

/** The theme control's name: the theme in force, then what one press does — the control cycles system → light → dark. */
export function themeLabel(choice: ThemeChoice): string {
  if (choice === "system") return "Theme: follows the system. Switch to light.";
  if (choice === "light") return "Theme: light. Switch to dark.";
  return "Theme: dark. Switch to follow the system.";
}

const LIVE_SENTENCE: Record<LivePillWords["word"], string> = {
  Live: "Live updates are on.",
  Reconnecting: "Live updates are reconnecting. The figures on this page stay as served for their batch.",
  "Not connected": "Live updates are off. The figures on this page stay as served for their batch.",
};

const capitalized = (text: string): string => `${text.charAt(0).toUpperCase()}${text.slice(1)}`;

/**
 * The live pill's title: the connection's sentence, then the batch and the age in the pill's own words. On a phone
 * the pill prints its word alone, so the title is where its other two truths stay stated.
 */
export function livePillTitle(words: Pick<LivePillWords, "word" | "batch" | "age">): string {
  const sentence = LIVE_SENTENCE[words.word];
  const tail = [words.batch, words.age].filter((part): part is string => part !== null);
  return tail.length === 0 ? sentence : `${sentence} ${capitalized(tail.join(" · "))}.`;
}

/* ---------------- the evidence drawer ---------------- */

export const DRAWER_CLOSE = "Close";
export const DRAWER_CLOSE_KEY = "Esc";
/** The dialog's name when its title is not a plain string. */
export const DRAWER_FALLBACK_LABEL = "Detail drawer";

/* ---------------- the kit's fixed labels ---------------- */

/** A scrolling table region's name when its caller gives none. */
export const TABLE_FALLBACK_LABEL = "Table";
/** An empty table's one row when its caller states no word of its own. */
export const TABLE_EMPTY_FALLBACK = "Nothing to show.";
export const BAND_BARS_LABEL = "Distribution by band";

export const ADDRESS_FIELD = {
  hint: "Any 0x address",
  placeholder: "0x…",
  inputLabel: "Address to inspect",
  inspect: "Inspect",
} as const;

export const LIBRARY = {
  title: "Scenarios",
  modeLabel: "Mode",
  modes: { book: "Whole book", address: "One address" },
} as const;

/** A library row's tick, named for the comparison it adds the scenario to. */
export function libraryCompareLabel(scenarioName: string): string {
  return `Compare ${scenarioName}`;
}

/* ---------------- the degradation banner ---------------- */

/** A banner line: plain text, and the figures and names the eye should find in it set strong. */
export interface BannerPart {
  readonly text: string;
  readonly strong?: true;
}

export interface BannerWords {
  readonly word: "Unavailable" | "Degraded" | "Reconnecting";
  readonly parts: readonly BannerPart[];
}

const strong = (text: string): BannerPart => ({ text, strong: true });

/** The service holds no batch it can serve: its reason verbatim, how old the held data is, and the last good batch. */
export function bannerUnavailable(input: {
  readonly reason: string | null;
  readonly staleSinceSeconds: number | null;
  readonly lastGoodBatchId: number | null;
}): BannerWords {
  const parts: BannerPart[] = [{ text: input.reason !== null && input.reason.length > 0 ? `No servable batch · ${input.reason}` : "No servable batch" }];
  if (input.staleSinceSeconds !== null) parts.push({ text: " · held data is " }, strong(humanAge(input.staleSinceSeconds)), { text: " stale" });
  if (input.lastGoodBatchId !== null) parts.push({ text: " · last good batch " }, strong(groupInt(input.lastGoodBatchId)));
  return { word: "Unavailable", parts };
}

const ENGINE_ORDER: readonly string[] = ["debt_manager", "aave_v3_etherfi"];
const engineRank = (engine: string): number => {
  const at = ENGINE_ORDER.indexOf(engine);
  return at === -1 ? ENGINE_ORDER.length : at;
};

/** The current batch is superseded, or an engine's figures are withheld: each named, Cash first, with the wire's code. */
export function bannerDegraded(input: {
  readonly superseded: boolean;
  readonly legs: readonly string[];
  readonly withheld: readonly { readonly engine: string; readonly code: string }[];
}): BannerWords {
  const parts: BannerPart[] = [];
  if (input.superseded) {
    parts.push({ text: "Batch " }, strong("superseded"));
    if (input.legs.length > 0) parts.push({ text: ` (${input.legs.join(", ")})` });
  }
  if (input.withheld.length > 0) {
    parts.push({ text: input.superseded ? " · withheld: " : "Withheld: " });
    const ordered = [...input.withheld].sort((a, b) => engineRank(a.engine) - engineRank(b.engine));
    ordered.forEach((refusal, index) => {
      if (index > 0) parts.push({ text: ", " });
      parts.push(strong(engineList([refusal.engine])), { text: ` (${refusal.code})` });
    });
  }
  return { word: "Degraded", parts };
}

export function bannerReconnecting(): BannerWords {
  return { word: "Reconnecting", parts: [{ text: "Stream lost. Showing the last delivered batch until the reconnect snapshot lands." }] };
}

/* ---------------- the route boundary ---------------- */

/** A view whose render threw: the unreadable register — nothing is claimed, and the error's own words stay one click away. */
export const ROUTE_REFUSAL = {
  head: "This view could not read its data.",
  body: "A value in the served data could not be read, and an unreadable value is never rendered as a number. Nothing is claimed for this view.",
  evidence: "The error, verbatim",
  digest: (digest: string): string => `Digest: ${digest}`,
  reset: "Try again",
} as const;
