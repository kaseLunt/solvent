// One view model for the API page. The surface reads it and prints it; the
// pins read it and check it; nothing below it decides a sentence twice. Every
// figure is the generated contract extract's own (lib/proof-contract.gen.ts,
// drift-gated against api/openapi.yaml by tests/unit/proof-contract-fidelity.spec.ts):
// the page cannot say what the contract does not, and the census is counted
// from the same extract the page renders — never typed beside it. The one
// deployment-specific value is the API origin the samples target, passed in by
// the caller and stated once, on its chip.
import type { LabHeadline } from "./lab-headline";
import type { LabChip } from "./lab-view";
import { groupInt } from "./prose";
import { CONTRACT_META, ERROR_RESPONSES, OPERATIONS, type ContractErrorResponse, type ContractOperation } from "./proof-contract.gen";

/** One row of the endpoint index: the anchor's target, the method in its own column, the path beside it. */
export interface ApiIndexRow {
  readonly id: string;
  readonly method: string;
  readonly path: string;
}

export interface ApiView {
  /** "API · contract v{version}" — the page's name first, then the contract it renders. */
  readonly kicker: string;
  /** The kicker in its two parts: the page's name, and the version the kicker's capitals must not recase. */
  readonly kickerParts: { readonly lead: string; readonly version: string };
  readonly headline: LabHeadline;
  /** Contract · Base URL · Source — identity only; a count is a measure and lives in the census. */
  readonly chips: LabChip[];
  /**
   * The line above the endpoint index: the verb census and the error statuses — "15 GET · 2 POST · error responses
   * 400 · 404 · …". The headline already counts the endpoints and the index lists them: tiles restating the count
   * would frame half a row of nothing.
   */
  readonly census: string;
  /** The endpoint index, one row per contract operation, in the contract's order. */
  readonly index: readonly ApiIndexRow[];
  /** The Endpoints section's qualifier: where the cards' words come from. */
  readonly endpointsQualifier: string;
  /** The error envelope, one row per contract response, in the contract's order. */
  readonly errors: readonly { key: string; cells: { status: string; name: string; description: string } }[];
  /** The intro, the base-URL note, the provenance paragraph and — while a sample cites one — the fixtures' note, verbatim: the drawer's doctrine. */
  readonly doctrine: readonly string[];
  /** The TypeScript quickstart, against the stated base URL: every call in it is a method @solvent/client has. */
  readonly quickstart: string;
}

/**
 * The TypeScript quickstart: the client's own API, against the stated origin.
 * Every call it prints is a method the client ships — the evidence manifest
 * included (`client.evidence()`) — so a reader who copies it runs it.
 */
export function quickstartSample(baseUrl: string): string {
  return `import { SolventClient } from "@solvent/client";

const client = new SolventClient({ baseUrl: "${baseUrl}" });

// Aggregates. Every money quantity is a DECIMAL STRING, exactly as the wire
// carried it — nothing here converts, rounds, or floats.
const book = await client.book();

// Three-valued lookup: the wire's found true/false/null arrives as a sealed
// outcome union — \`if (!result.found)\` does not compile, so a withheld
// answer can never read as "no position".
const result = await client.address("0xAAaA000000000000000000000000000000000001");
switch (result.outcome) {
  case "found":      /* result.response.positions */         break;
  case "not-found":  /* definitive: no position in batch */  break;
  case "unknowable": /* withheld engine — NOT "none" */      break;
}

// The deploy-bound evidence manifest: the proof subject and the live subject, split.
const evidence = await client.evidence();`;
}

/** The page's intro, verbatim — drawer doctrine; its closing clause is the law the header's dek states as facts. */
export const API_INTRO =
  "The committed API contract, rendered from its own examples: read-only JSON, no auth, every money value a decimal string. If a handler disagrees with this page, that is a failure, not documentation lag.";

/** Where every sample on the page comes from, and what fails when the page and the contract disagree. */
export const API_PROVENANCE =
  "Samples are extracted from the committed contract by tests/fixtures/generate-proof.mjs; tests/unit/proof-contract-fidelity.spec.ts re-extracts from api/openapi.yaml on every run and fails on any drift between this page's source module and the contract.";

/**
 * What checks a cited client fixture against the contract: the client package's own test
 * (packages/client-ts/test/fixtures.test.ts validates every fixture file against api/openapi.yaml), which no CI step
 * runs. The CI test only re-reads the fixtures' bytes, so the page claims of CI only that.
 */
export const API_FIXTURES_NOTE =
  "Where the contract carries no example, a sample is a committed client fixture, cited beside it; the client package's own tests check those fixtures against the contract, and no CI step runs them.";

/** A stream's card in place of a sample: a stream has no JSON body to show, so none is shown or invented. */
export const API_SSE_NOTE =
  "text/event-stream · no JSON sample exists (or is invented) for a stream. Event names: snapshot · batch · degradation · unavailable; heartbeats are SSE comment frames.";

/** The page's own words — every label the surface prints that is not the contract's. */
export const API_COPY = {
  drawer: "Methodology & evidence",
  indexLabel: "Endpoint index",
  quickstartTitle: "TypeScript",
  quickstartQualifier: "@solvent/client",
  /** A code block's bar names what the block is. */
  quickstartCode: "TypeScript",
  quickstartCopy: "Copy TypeScript quickstart",
  endpointsTitle: "Endpoints",
  verificationLink: "Verification →",
  errorsTitle: "Error envelope",
  curlCode: "curl",
  jsonCode: "JSON",
  required: "required",
  optional: "optional",
} as const;

/** The error envelope table's columns, in reading order. */
export const API_ERROR_COLUMNS: readonly { readonly key: "status" | "name" | "description"; readonly header: string }[] = [
  { key: "status", header: "Status" },
  { key: "name", header: "Response" },
  { key: "description", header: "Description" },
];

/** The exact curl invocation for an operation, against this deployment's API origin. */
export function curlFor(op: Pick<ContractOperation, "sse" | "method" | "samplePath">, baseUrl: string): string {
  if (op.sse) return `curl -sN "${baseUrl}${op.samplePath}"`;
  if (op.method === "POST") return `curl -s -X POST "${baseUrl}${op.samplePath}"`;
  return `curl -s "${baseUrl}${op.samplePath}"`;
}

/** One operation's copy actions and its sample fold, named from the contract's own method and path. */
export interface OperationCopy {
  readonly curl: string;
  readonly sampleSummary: string;
  /** The sample's provenance beside its summary; null when the operation carries no sample to cite. */
  readonly sampleSource: string | null;
  readonly sample: string;
}

export function operationCopy(op: Pick<ContractOperation, "method" | "path" | "exampleSource">): OperationCopy {
  const endpoint = `${op.method} ${op.path}`;
  return {
    curl: `Copy curl for ${endpoint}`,
    sampleSummary: "200 response",
    sampleSource: op.exampleSource === null ? null : `· ${op.exampleSource}`,
    sample: `Copy 200 sample for ${endpoint}`,
  };
}

/** One error response's body fold: its summary, the provenance beside it, and its copy action's name. */
export function errorSampleCopy(error: Pick<ContractErrorResponse, "name" | "source">): {
  readonly summary: string;
  readonly source: string;
  readonly copy: string;
} {
  return { summary: `${error.name} body`, source: `· ${error.source}`, copy: `Copy ${error.name} body` };
}

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

/** Whether some sample on the page cites a committed client fixture rather than the contract's own example. */
function citesFixtures(): boolean {
  const cited = [...OPERATIONS.map((op) => op.exampleSource), ...ERROR_RESPONSES.map((error) => error.source)];
  return cited.some((source) => source !== null && !source.startsWith(CONTRACT_META.sourcePath));
}

/**
 * The header's dek: two sentences, each licensed by what it can point at. The
 * service authenticates nobody and its contract declares no security scheme;
 * it does bound request rates, so "no key" is never left to read as "no
 * limit" — the clause prints exactly when the contract carries a 429. A
 * sample is the contract's own example or, where the contract has none, a
 * committed client fixture — the clause prints only while some sample cites
 * one. The CI test (tests/unit/proof-contract-fidelity.spec.ts) re-reads the
 * contract and the cited fixtures' bytes and fails on any drift in the extract
 * this page renders, so "fails if this page drifts from either" is exactly
 * what CI runs; whether a fixture agrees with the contract is the client
 * package's own test, which no CI step runs — the drawer says so.
 */
export function apiDek(): string {
  const limited = ERROR_RESPONSES.some((error) => error.status === 429);
  return [
    limited ? "No key or sign-in; requests are rate-limited per client." : "No key or sign-in.",
    citesFixtures()
      ? "Every sample is the contract's own example or a committed client fixture, and a CI test fails if this page drifts from either."
      : "Every sample is the contract's own example, and a CI test fails if this page drifts from it.",
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

/** A block of the contract's prose as the page sets it: a paragraph, or a run of list items. */
export type ContractBlock = { readonly kind: "p"; readonly text: string } | { readonly kind: "ul"; readonly items: readonly string[] };

const LIST_MARKER = /^[*-] /;

/**
 * The contract's prose as blocks: its paragraphs, with each run of consecutive list items set as one list. A list
 * item's marker is its bullet, so it leaves the text; every word stays, in order.
 */
export function contractBlocks(text: string): readonly ContractBlock[] {
  const blocks: ContractBlock[] = [];
  for (const paragraph of contractParagraphs(text)) {
    if (!LIST_MARKER.test(paragraph)) {
      blocks.push({ kind: "p", text: paragraph });
      continue;
    }
    const item = paragraph.replace(LIST_MARKER, "");
    const last = blocks.at(-1);
    if (last?.kind === "ul") blocks[blocks.length - 1] = { kind: "ul", items: [...last.items, item] };
    else blocks.push({ kind: "ul", items: [item] });
  }
  return blocks;
}

/** A run of contract text, or one of its bracketed version notes — "(ADDED 1.5.0)", "(AMENDMENT 1/E)". */
export interface VersionNotePart {
  readonly kind: "text" | "ver";
  readonly text: string;
}

const VERSION_NOTE = /\((?:ADDED|DEPRECATED|AMENDMENT) [^)]*\)/g;

/** Splits text at its bracketed version notes so the page can set them quieter; the parts join back to the text. */
export function versionNoteParts(text: string): readonly VersionNotePart[] {
  const parts: VersionNotePart[] = [];
  let at = 0;
  for (const match of text.matchAll(VERSION_NOTE)) {
    const start = match.index;
    if (start > at) parts.push({ kind: "text", text: text.slice(at, start) });
    parts.push({ kind: "ver", text: match[0] });
    at = start + match[0].length;
  }
  if (at < text.length) parts.push({ kind: "text", text: text.slice(at) });
  return parts;
}

export { inlineParts, type InlinePart } from "./inline-parts";

export function deriveApiView(baseUrl: string): ApiView {
  return {
    kicker: `API · contract v${CONTRACT_META.version}`,
    kickerParts: { lead: "API · contract", version: `v${CONTRACT_META.version}` },
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
    census: `${verbCensus()} · error responses ${errorStatuses()}`,
    index: OPERATIONS.map((op) => ({ id: op.operationId, method: op.method, path: op.path })),
    endpointsQualifier: `${CONTRACT_META.sourcePath}, verbatim`,
    errors: ERROR_RESPONSES.map((e) => ({
      key: e.name,
      cells: { status: String(e.status), name: e.name, description: e.description },
    })),
    doctrine: [API_INTRO, `Base URL ${baseUrl}: ${BASE_URL_NOTE}.`, API_PROVENANCE, ...(citesFixtures() ? [API_FIXTURES_NOTE] : [])],
    quickstart: quickstartSample(baseUrl),
  };
}
