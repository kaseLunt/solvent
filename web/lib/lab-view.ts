// One view model for the Scenarios page. The surface reads it and prints it;
// the pins read it and check it; nothing below it decides a state twice. Each
// engine of a result is read once, by id, in `lab-engine` — the same reading
// the library's row prints in one word — and a refusal of any kind is its own
// state here with its own sentence.
import type { ReceivedAt } from "./freshness";
import { engineName } from "./inspector-headline";
import { CASH, LEGACY } from "./inspector-position";
import type { LoadPhase } from "./inspector-view";
import { compareRows, type CompareView } from "./lab-compare";
import { readEngine, type EngineReading } from "./lab-engine";
import {
  contradictoryHeadline,
  definitionChangedHeadline,
  EMPTY_LISTING,
  failureHeadline,
  LISTING_LOADING,
  listingUnavailableHeadline,
  notCoveredHeadline,
  notRunHeadline,
  resultHeadline,
  runningHeadline,
  withheldHeadline,
  type LabHeadline,
} from "./lab-headline";
import {
  definitionSkew,
  libraryRows,
  type LibraryRow,
  type RunRecord,
  type ScenarioDefinition,
  type ScenariosResponse,
} from "./lab-library";
import type { LabReading } from "./lab-reading";
import { groupInt, joinAnd } from "./prose";
import type { ResultIdentity } from "./resultIdentity";
import type { LabRunBook } from "./runbook";

export { readEngine } from "./lab-engine";
export type { EngineReading, EngineResult } from "./lab-engine";

/** A chip on the identity strip; structurally the kit's IdentityChip, kept out of the component layer. */
export interface LabChip {
  readonly label: string;
  readonly value: string;
  readonly tone?: "neutral" | "ok" | "warn" | "crit" | "refused";
  readonly title?: string;
}

export type BookState =
  | "listing-loading"
  | "listing-unavailable"
  | "not-run"
  | "running"
  | "result"
  | "not-covered"
  | "withheld"
  | "contradictory"
  | "definition-changed"
  | "not-served"
  | "no-batch"
  | "rate-limited"
  | "busy"
  | "unreachable"
  | "failed";
export type Banner = "stale-input" | "superseded" | null;

export interface BookWorkspace {
  readonly state: BookState;
  readonly banner: Banner;
  readonly kicker: string;
  readonly headline: LabHeadline;
  readonly chips: LabChip[];
  readonly identity: ResultIdentity | null;
  /** The clocks at which this tab settled the result; the "Computed" age anchors the wire's batch age here. */
  readonly receivedAt: ReceivedAt | null;
  readonly definition: ScenarioDefinition | null;
  readonly run: LabRunBook | null;
  readonly cash: EngineReading | null;
  readonly legacy: EngineReading | null;
  readonly skew: readonly string[];
}
export type CompareState =
  | { readonly kind: "idle" }
  | { readonly kind: "running"; readonly ids: readonly string[] }
  | {
      readonly kind: "ok";
      readonly cash: CompareView;
      readonly legacy: CompareView;
    }
  | { readonly kind: "failed"; readonly headline: LabHeadline };

export interface LabUi {
  readonly selectedId: string | null;
  readonly checked: ReadonlySet<string>;
}
export interface LabView {
  readonly listingLoad: LoadPhase;
  readonly library: LibraryRow[];
  readonly selectedId: string | null;
  readonly checked: readonly string[];
  readonly configVersion: string | null;
  readonly book: BookWorkspace;
  readonly compare: CompareState;
}

/** A book with no result: whatever chips the caller has are the only chips it carries. */
const emptyBook = (
  state: BookState,
  headline: LabHeadline,
  definition: ScenarioDefinition | null = null,
  chips: LabChip[] = [],
): BookWorkspace => ({
  state,
  banner: null,
  kicker:
    definition === null
      ? "Scenarios · Cash book"
      : `${definition.label} · Cash book`,
  headline,
  chips,
  identity: null,
  receivedAt: null,
  definition,
  run: null,
  cash: null,
  legacy: null,
  skew: [],
});

/** The chips of a book that has no result: the definition's own identity and the listing's config version. */
function definitionChips(
  def: ScenarioDefinition,
  configVersion: string,
): LabChip[] {
  return [
    {
      label: "Scenario",
      value: `${def.id} · ${def.version}`,
      title: def.label,
    },
    { label: "Config", value: configVersion },
  ];
}

function enginesChip(run: LabRunBook, cash: EngineReading): LabChip {
  const served = run.engines.map((e) => engineName(e.engine));
  const withheld = run.excluded_engines.map(
    (e) => `${engineName(e.engine)} withheld`,
  );
  const parts = [...(served.length > 0 ? [joinAnd(served)] : []), ...withheld];
  return {
    label: "Engines",
    value: parts.join(" · "),
    tone: withheld.length > 0 || cash.kind === "withheld" ? "warn" : undefined,
  };
}

function resultBook(
  def: ScenarioDefinition,
  configVersion: string,
  run: LabRunBook,
  receivedAt: ReceivedAt,
): BookWorkspace {
  const skew = definitionSkew(def, configVersion, run);
  const superseded = run.batch.supersession.superseded;
  const kicker = `${def.label} · Cash book`;
  // The answered engines, distinct and in wire order; a withheld engine is a refusal, never an answer.
  const identity: ResultIdentity = {
    scope: "book",
    batchId: run.batch.id,
    configVersion: run.scenario_config_version,
    engines: [...new Set(run.engines.map((e) => e.engine))],
    servedAt: run.served_at,
  };
  const cash = readEngine(run, CASH, def);
  const legacy = def.engines.includes(LEGACY)
    ? readEngine(run, LEGACY, def)
    : null;
  const chips: LabChip[] = [
    superseded
      ? {
          label: "Result for batch",
          value: `${groupInt(run.batch.id)} · superseded`,
          tone: "warn",
          title: "a newer complete batch exists; run again for it",
        }
      : { label: "Result for batch", value: groupInt(run.batch.id) },
    {
      label: "Scenario",
      value: `${run.scenario_id} · ${run.scenario_version}`,
      title: run.label,
    },
    enginesChip(run, cash),
    {
      label: "Config",
      value: run.scenario_config_version,
      tone: skew.includes("config version") ? "warn" : undefined,
    },
  ];
  const base = {
    kicker,
    chips,
    identity,
    receivedAt,
    definition: def,
    run,
    cash,
    legacy,
    skew,
  };
  // Precedence: a version skew is its own state before any reading is consulted; on a
  // result, a superseded batch outranks a stale input as the banner, and a banner sits
  // on the result state rather than replacing it.
  if (skew.includes("version"))
    return {
      ...base,
      state: "definition-changed",
      banner: null,
      headline: definitionChangedHeadline(def.label, skew),
      cash: null,
      legacy: null,
    };
  const banner: Banner = superseded
    ? "superseded"
    : skew.length > 0
      ? "stale-input"
      : null;
  switch (cash.kind) {
    case "withheld":
      return {
        ...base,
        state: "withheld",
        banner,
        headline: withheldHeadline(def.label, cash.cause),
      };
    case "not-covered":
      return {
        ...base,
        state: "not-covered",
        banner,
        headline: notCoveredHeadline(def.label, def.engines, legacy !== null),
      };
    case "contradictory":
      return {
        ...base,
        state: "contradictory",
        banner,
        headline: contradictoryHeadline(def.label, cash.reasons),
      };
    case "unreadable":
      return {
        ...base,
        state: "contradictory",
        banner,
        headline: contradictoryHeadline(
          def.label,
          cash.fields.map((f) => `${f} is outside the wire contract`),
        ),
      };
    case "result": {
      const r = cash.result;
      const headline = resultHeadline({
        label: def.label,
        decimals: r.decimals,
        newly: r.newly,
        beforeEligible: r.beforeEligible,
        afterEligible: r.afterEligible,
        deltaEligibleDebt: r.deltaEligibleDebt,
        deltaBadDebt: r.deltaBadDebt,
        heat: r.heat,
        heatReason: null,
      });
      return { ...base, state: "result", banner, headline };
    }
  }
}

function bookOf(
  listing: ScenariosResponse,
  def: ScenarioDefinition,
  record: RunRecord | undefined,
): BookWorkspace {
  if (record === undefined) {
    return emptyBook(
      "not-run",
      notRunHeadline({
        label: def.label,
        description: def.description,
        path_assumption: def.path_assumption,
        shocks: def.shocks.length,
      }),
      def,
      definitionChips(def, listing.scenario_config_version),
    );
  }
  if (record.phase === "running")
    return emptyBook(
      "running",
      runningHeadline(def.label),
      def,
      definitionChips(def, listing.scenario_config_version),
    );
  const o = record.outcome;
  if (o.kind === "ok")
    return resultBook(def, listing.scenario_config_version, o.response, {
      wallMs: record.at,
      monotonicMs: record.atMonotonicMs,
    });
  const chips = definitionChips(def, listing.scenario_config_version);
  switch (o.kind) {
    case "not-served":
      return emptyBook(
        "not-served",
        failureHeadline("not-served", {}),
        def,
        chips,
      );
    case "no-batch":
      return emptyBook(
        "no-batch",
        failureHeadline("no-batch", {
          message: o.message,
          retryAfterSeconds: o.retryAfterSeconds,
        }),
        def,
        chips,
      );
    case "rate-limited":
      return emptyBook(
        "rate-limited",
        failureHeadline("rate-limited", {
          retryAfterSeconds: o.retryAfterSeconds,
        }),
        def,
        chips,
      );
    case "unreachable":
      return emptyBook(
        "unreachable",
        failureHeadline("unreachable", { message: o.message }),
        def,
        chips,
      );
    case "failed":
      return emptyBook(
        "failed",
        failureHeadline("failed", { status: o.status, message: o.message }),
        def,
        chips,
      );
  }
}

function compareOf(reading: LabReading): CompareState {
  const set = reading.set;
  if (set === null) return { kind: "idle" };
  if (set.phase === "running") return { kind: "running", ids: set.ids };
  const o = set.outcome;
  switch (o.kind) {
    case "ok":
      return {
        kind: "ok",
        cash: compareRows(o.response, CASH),
        legacy: compareRows(o.response, LEGACY),
      };
    case "busy":
      return {
        kind: "failed",
        headline: failureHeadline("busy", {
          message: o.message,
          inFlight: o.inFlight,
          maxInFlight: o.maxInFlight,
        }),
      };
    case "not-served":
      return { kind: "failed", headline: failureHeadline("not-served", {}) };
    case "no-batch":
      return {
        kind: "failed",
        headline: failureHeadline("no-batch", {
          message: o.message,
          retryAfterSeconds: o.retryAfterSeconds,
        }),
      };
    case "rate-limited":
      return {
        kind: "failed",
        headline: failureHeadline("rate-limited", {
          retryAfterSeconds: o.retryAfterSeconds,
        }),
      };
    case "refused":
      // An envelope-less refusal carries no code; its message stands alone rather than behind an empty one.
      return {
        kind: "failed",
        headline: failureHeadline("failed", {
          status: o.status,
          message: o.code === "" ? o.message : `${o.code}: ${o.message}`,
        }),
      };
    case "unreachable":
      return {
        kind: "failed",
        headline: failureHeadline("unreachable", { message: o.message }),
      };
    case "refused-locally":
      return {
        kind: "failed",
        headline: failureHeadline("refused-locally", { message: o.message }),
      };
  }
}

const loadPhase = (p: LabReading["listing"]): LoadPhase =>
  p.phase === "error"
    ? { phase: "error", message: p.message }
    : p.phase === "loading"
      ? { phase: "loading" }
      : { phase: "ready" };

export function deriveLabView(reading: LabReading, ui: LabUi): LabView {
  const listingLoad = loadPhase(reading.listing);
  const compare = compareOf(reading);
  if (reading.listing.phase === "loading") {
    return {
      listingLoad,
      library: [],
      selectedId: null,
      checked: [...ui.checked],
      configVersion: null,
      book: emptyBook("listing-loading", LISTING_LOADING),
      compare,
    };
  }
  if (reading.listing.phase === "error") {
    return {
      listingLoad,
      library: [],
      selectedId: null,
      checked: [...ui.checked],
      configVersion: null,
      book: emptyBook(
        "listing-unavailable",
        listingUnavailableHeadline(reading.listing.message),
      ),
      compare,
    };
  }
  const listing = reading.listing.value;
  const def =
    listing.scenarios.find((s) => s.id === ui.selectedId) ??
    listing.scenarios[0] ??
    null;
  const selectedId = def?.id ?? null;
  const library = libraryRows(listing, reading.runs, selectedId, ui.checked);
  const checked = listing.scenarios
    .map((s) => s.id)
    .filter((id) => ui.checked.has(id));
  if (def === null) {
    return {
      listingLoad,
      library,
      selectedId,
      checked,
      configVersion: listing.scenario_config_version,
      book: emptyBook("not-run", EMPTY_LISTING),
      compare,
    };
  }
  return {
    listingLoad,
    library,
    selectedId,
    checked,
    configVersion: listing.scenario_config_version,
    book: bookOf(listing, def, reading.runs.get(def.id)),
    compare,
  };
}
