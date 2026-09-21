// One view model for the API page. The surface reads it and prints it; the
// pins read it and check it; nothing below it decides a sentence twice. Every
// figure is the generated contract extract's own (lib/proof-contract.gen.ts,
// drift-gated against api/openapi.yaml by tests/unit/proof-contract-fidelity.spec.ts):
// the page cannot say what the contract does not, and a tile's sub is counted
// from the same extract the page renders — never typed beside it. The one
// deployment-specific value is the API origin the samples target, passed in by
// the caller and stated once, on its chip.
import type { LabHeadline } from "./lab-headline";
import type { LabChip } from "./lab-view";
import { groupInt } from "./prose";
import { CONTRACT_META, ERROR_RESPONSES, OPERATIONS } from "./proof-contract.gen";

/** A tile as the page prints it: its label, its figure, and the sub that says what the figure is made of. */
export interface ApiTile {
  readonly label: string;
  readonly value: string;
  readonly sub: string;
}

/** One row of the endpoint index: the anchor's target, the method in its own column, the path beside it. */
export interface ApiIndexRow {
  readonly id: string;
  readonly method: string;
  readonly path: string;
}

export interface ApiView {
  /** "API · contract v{version}" — the page's name first, then the contract it renders. */
  readonly kicker: string;
  readonly headline: LabHeadline;
  /** Contract · Base URL · Source — identity only; a count is a measure and lives on its tile. */
  readonly chips: LabChip[];
  readonly tiles: { readonly operations: ApiTile; readonly errors: ApiTile; readonly version: ApiTile };
  /** The endpoint index, one row per contract operation, in the contract's order. */
  readonly index: readonly ApiIndexRow[];
  /** The Endpoints section's qualifier: where the cards' words come from. */
  readonly endpointsQualifier: string;
  /** The error envelope, one row per contract response, in the contract's order. */
  readonly errors: readonly { key: string; cells: { status: string; name: string; description: string } }[];
  /** The intro, the base-URL note and the provenance paragraph, verbatim — the drawer's doctrine. */
  readonly doctrine: readonly string[];
}

/** The page's intro, verbatim — drawer doctrine; its closing clause is the law the header's dek states as facts. */
export const API_INTRO =
  "The committed API contract, rendered from its own examples: read-only JSON, no auth, every money value a decimal string. If a handler disagrees with this page, that is a failure, not documentation lag.";

/** Where every sample on the page comes from, and what fails when the page and the contract disagree. */
export const API_PROVENANCE =
  "Samples are extracted from the committed contract by tests/fixtures/generate-proof.mjs; tests/unit/proof-contract-fidelity.spec.ts re-extracts from api/openapi.yaml on every run and fails on any drift between this page's source module and the contract.";

/** The base URL's note: which origin, and where it is set. The URL itself precedes it so the drawer stands alone. */
const BASE_URL_NOTE = "the origin this deployment is built against (NEXT_PUBLIC_SOLVENT_API_URL)";

/** Distinct values in first-seen order — the contract's own order, never a sorted one. */
function distinct<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}

/** The verb census: how many operations each method carries, in the contract's order — "15 GET · 2 POST". */
export function verbCensus(): string {
  return distinct(OPERATIONS.map((op) => op.method))
    .map((method) => `${groupInt(OPERATIONS.filter((op) => op.method === method).length)} ${method}`)
    .join(" · ");
}

/** The statuses the error envelope answers with, in the contract's order — "400 · 404 · 409 · 429 · 500 · 503". */
export function errorStatuses(): string {
  return distinct(ERROR_RESPONSES.map((error) => String(error.status))).join(" · ");
}

/**
 * The header's dek, each sentence licensed by what it can point at. The
 * service authenticates nobody and its contract declares no security scheme;
 * it does bound request rates, so "no key" is never left to read as "no
 * limit" — the clause prints exactly when the contract carries a 429. A
 * sample is the contract's own example or, where the contract has none, a
 * committed client fixture — the clause prints only while some sample cites
 * one, and each sample names its source beside it. The last sentence says
 * two things and keeps them apart, because only one of them is gated by CI.
 * The fidelity test (tests/unit/proof-contract-fidelity.spec.ts, run by the
 * CI job) re-reads the contract and the cited fixtures' bytes and fails on
 * any drift in the extract this page renders — it does not judge a fixture
 * against the contract. That judgement is the client package's own test
 * (packages/client-ts/test/fixtures.test.ts validates every fixture file
 * against api/openapi.yaml), which no CI step runs: the dek names it as the
 * client package's, and never as the CI test.
 */
export function apiDek(): string {
  const limited = ERROR_RESPONSES.some((error) => error.status === 429);
  const cited = [...OPERATIONS.map((op) => op.exampleSource), ...ERROR_RESPONSES.map((error) => error.source)];
  const fixtures = cited.some((source) => source !== null && !source.startsWith(CONTRACT_META.sourcePath));
  const contract = `the contract's own example (${CONTRACT_META.sourcePath}, v${CONTRACT_META.version})`;
  return [
    limited ? "No key or sign-in; requests are rate-limited per client." : "No key or sign-in.",
    fixtures ? `Every sample below is ${contract} or a committed client fixture, cited beside each.` : `Every sample below is ${contract}.`,
    fixtures
      ? "A CI test re-reads both and fails if this page's extract has drifted from either; the fixtures are checked against the contract by the client package's own tests."
      : "A CI test re-reads the contract and fails if this page's extract has drifted.",
  ].join(" ");
}

/**
 * The contract's prose as paragraphs. A blank line ends a paragraph; a list
 * item opens one of its own, its marker kept; a single newline is the YAML's
 * hard wrap and reads as a space. Not a word is added, dropped or reordered.
 */
export function contractParagraphs(text: string): readonly string[] {
  const blocks: string[][] = [];
  let open: string[] | null = null;
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (line === "") {
      open = null;
      continue;
    }
    if (open === null || /^[*-] /.test(line)) {
      open = [];
      blocks.push(open);
    }
    open.push(line);
  }
  return blocks.map((lines) => lines.join(" "));
}

export function deriveApiView(baseUrl: string): ApiView {
  return {
    kicker: `API · contract v${CONTRACT_META.version}`,
    // Static content is a statement of record, not a verdict: it wears ink. A refusal here would be a build that shipped no contract.
    headline: {
      emphasis: `${groupInt(OPERATIONS.length)} read-only endpoints,`,
      rest: "every money value an exact decimal string.",
      tone: "neutral",
      dek: apiDek(),
    },
    chips: [
      { label: "Contract", value: `${CONTRACT_META.title} · v${CONTRACT_META.version}` },
      { label: "Base URL", value: baseUrl, title: BASE_URL_NOTE },
      { label: "Source", value: CONTRACT_META.sourcePath },
    ],
    tiles: {
      operations: { label: "Endpoints", value: groupInt(OPERATIONS.length), sub: verbCensus() },
      errors: { label: "Error responses", value: groupInt(ERROR_RESPONSES.length), sub: errorStatuses() },
      version: { label: "Contract version", value: CONTRACT_META.version, sub: CONTRACT_META.sourcePath },
    },
    index: OPERATIONS.map((op) => ({ id: op.operationId, method: op.method, path: op.path })),
    endpointsQualifier: `${CONTRACT_META.sourcePath}, verbatim`,
    errors: ERROR_RESPONSES.map((e) => ({
      key: e.name,
      cells: { status: String(e.status), name: e.name, description: e.description },
    })),
    doctrine: [API_INTRO, `Base URL ${baseUrl}: ${BASE_URL_NOTE}.`, API_PROVENANCE],
  };
}
