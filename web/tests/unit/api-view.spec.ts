// The API page's one view model: header, chips, tiles, the endpoint index,
// error rows and doctrine, derived once from the generated contract extract
// (lib/proof-contract.gen.ts). Every figure here is the extract's own count or
// version — the page cannot say what the contract does not, and a tile's sub
// is counted from the extract, never typed beside it. The one
// deployment-specific value is the base URL, stated once.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { apiDek, contractParagraphs, deriveApiView, errorStatuses, verbCensus } from "../../lib/api-view";
import { CONTRACT_META, ERROR_RESPONSES, OPERATIONS } from "../../lib/proof-contract.gen";

const BASE = "http://x";

test("tiles: the endpoint count, the error-response count and the contract version — the extract's own, each with a sub counted from the same extract", () => {
  const v = deriveApiView(BASE);
  expect(v.tiles).toEqual({
    operations: { label: "Endpoints", value: String(OPERATIONS.length), sub: verbCensus() },
    errors: { label: "Error responses", value: String(ERROR_RESPONSES.length), sub: errorStatuses() },
    version: { label: "Contract version", value: CONTRACT_META.version, sub: CONTRACT_META.sourcePath },
  });
  // No tile without a sub.
  for (const tile of Object.values(v.tiles)) expect(tile.sub.length).toBeGreaterThan(0);
});

test("the tile subs are computed, never typed: the verb census sums to the endpoint count in the contract's order; the status list is the error envelope's own", () => {
  // The demo literals — what today's contract computes to.
  expect(verbCensus()).toBe("15 GET · 2 POST");
  expect(errorStatuses()).toBe("400 · 404 · 409 · 429 · 500 · 503");
  // The law behind them: every operation is counted once under its own method, first-seen order.
  const census = verbCensus().split(" · ").map((part) => part.split(" "));
  expect(census.map(([, method]) => method)).toEqual([...new Set(OPERATIONS.map((op) => op.method))]);
  expect(census.reduce((sum, [count]) => sum + Number(count), 0)).toBe(OPERATIONS.length);
  for (const [count, method] of census) expect(Number(count)).toBe(OPERATIONS.filter((op) => op.method === method).length);
  expect(errorStatuses().split(" · ")).toEqual([...new Set(ERROR_RESPONSES.map((e) => String(e.status)))]);
});

test("header: the kicker names the contract's version once; the headline counts the endpoints in ink; the dek states facts", () => {
  const v = deriveApiView(BASE);
  expect(v.kicker).toBe(`API · contract v${CONTRACT_META.version}`);
  expect(v.kicker).toBe("API · contract v1.8.0");
  expect(v.headline).toEqual({
    emphasis: `${String(OPERATIONS.length)} read-only endpoints,`,
    rest: "every money value an exact decimal string.",
    // A statement of record wears ink; green is a health verdict and this page has none.
    tone: "neutral",
    dek: apiDek(),
  });
  expect(`${v.headline.emphasis} ${v.headline.rest}`).toBe("17 read-only endpoints, every money value an exact decimal string.");
  // One word product-wide: the OpenAPI noun leaves the header and the tiles.
  const printed = [
    v.kicker,
    v.headline.emphasis,
    v.headline.rest,
    v.headline.dek,
    v.endpointsQualifier,
    ...Object.values(v.tiles).flatMap((tile) => [tile.label, tile.sub]),
    ...v.chips.flatMap((chip) => [chip.label, chip.value]),
  ];
  for (const text of printed) expect(text).not.toMatch(/operations?/i);
});

test("the dek: no key or sign-in but a rate limit, where each sample comes from, and what the fidelity test does — each clause licensed by the extract", () => {
  expect(apiDek()).toBe(
    "No key or sign-in; requests are rate-limited per client. Every sample below is the contract's own example (api/openapi.yaml, v1.8.0) or a committed client fixture, cited beside each. A CI test re-reads both and fails if this page's extract has drifted from either; the fixtures are checked against the contract by the client package's own tests.",
  );
  // "No key" is never left to read as "no limit": the clause stands because the contract carries a 429.
  expect(ERROR_RESPONSES.some((e) => e.status === 429)).toBe(true);
  // "or a committed client fixture" stands because some sample cites one — and every sample cites the contract or a client fixture, nothing else.
  const cited = [...OPERATIONS.map((op) => op.exampleSource), ...ERROR_RESPONSES.map((e) => e.source)].filter((s): s is string => s !== null);
  expect(cited.some((s) => s.startsWith("packages/client-ts/test/fixtures/"))).toBe(true);
  for (const source of cited) expect(source).toMatch(/^(api\/openapi\.yaml|packages\/client-ts\/test\/fixtures\/)/);
  // The fidelity test the last sentence speaks of is the one the drawer names.
  expect(deriveApiView(BASE).doctrine[2]).toContain("tests/unit/proof-contract-fidelity.spec.ts re-extracts from api/openapi.yaml on every run");
});

test("the dek claims of CI only what CI runs: the fidelity test compares bytes, and the fixtures' validity is named as the client package's own tests' — for exactly the fixtures that test validates", () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const repoRoot = path.resolve(here, "..", "..", "..");
  const read = (...parts: string[]): string => readFileSync(path.join(repoRoot, ...parts), "utf8");
  // A fixture "validated against the contract" is a claim about packages/client-ts/test/fixtures.test.ts, which no CI step runs — so the dek never says "validated" of CI's test, and names the test's owner.
  expect(apiDek()).not.toMatch(/validated/i);
  const [, ciSentence = ""] = /(A CI test [^;.]*)[;.]/.exec(apiDek()) ?? [];
  expect(ciSentence).toBe("A CI test re-reads both and fails if this page's extract has drifted from either");
  expect(ciSentence).not.toMatch(/contract-valid|checked against|valid/i);
  expect(apiDek()).toContain("the fixtures are checked against the contract by the client package's own tests.");
  // What licenses that clause: the client test validates every file in FIXTURE_FILES against api/openapi.yaml…
  const clientTest = read("packages", "client-ts", "test", "fixtures.test.ts");
  expect(clientTest).toContain("for (const name of Object.keys(FIXTURE_FILES)");
  expect(clientTest).toContain("contract.validate(schemaFor(name), fixtureJson(FIXTURE_FILES[name]))");
  // …and every fixture this page cites is one of those files.
  const block = /export const FIXTURE_FILES = \{([\s\S]*?)\} as const;/.exec(read("packages", "client-ts", "test", "fixtures", "data.ts"))?.[1] ?? "";
  const validated = new Set([...block.matchAll(/: "([^"]+)"/g)].map((m) => m[1]));
  expect(validated.size).toBeGreaterThan(0);
  const citedFiles = [...OPERATIONS.map((op) => op.exampleSource), ...ERROR_RESPONSES.map((e) => e.source)]
    .map((source) => /^packages\/client-ts\/test\/fixtures\/([\w./-]+)/.exec(source ?? "")?.[1])
    .filter((file): file is string => file !== undefined);
  expect(citedFiles.length).toBeGreaterThan(0);
  for (const file of citedFiles) expect(validated.has(file), `${file} is cited on the page but not validated by the client package's test`).toBe(true);
});

test("chips: Contract · Base URL · Source, in that order — identity only; the base URL as given; the source path the extract's", () => {
  const v = deriveApiView(BASE);
  const value = (label: string): string | undefined => v.chips.find((c) => c.label === label)?.value;
  expect(v.chips.map((c) => c.label)).toEqual(["Contract", "Base URL", "Source"]);
  expect(value("Contract")).toBe(`${CONTRACT_META.title} · v${CONTRACT_META.version}`);
  expect(value("Base URL")).toBe(BASE);
  expect(value("Source")).toBe(CONTRACT_META.sourcePath);
  // A count is a measure: the tile owns it, and no chip repeats it.
  expect(v.chips.some((c) => c.value === String(OPERATIONS.length))).toBe(false);
  // A different origin is a different chip: the URL is never normalised or invented here.
  expect(deriveApiView("https://api.example.test").chips.find((c) => c.label === "Base URL")?.value).toBe("https://api.example.test");
});

test("the endpoint index: one row per contract operation, in the contract's order — the anchor's id, the method in its own column, the path beside it", () => {
  const v = deriveApiView(BASE);
  expect(v.index).toEqual(OPERATIONS.map((op) => ({ id: op.operationId, method: op.method, path: op.path })));
  expect(v.index).toHaveLength(OPERATIONS.length);
  expect(new Set(v.index.map((row) => row.id)).size).toBe(OPERATIONS.length);
  expect(v.index[0]).toEqual({ id: "getBook", method: "GET", path: "/v1/book" });
  expect(v.endpointsQualifier).toBe("api/openapi.yaml, verbatim");
});

test("error rows equal ERROR_RESPONSES mapped: the name as key, the status as a string, the description verbatim, none dropped", () => {
  const v = deriveApiView(BASE);
  expect(v.errors).toEqual(
    ERROR_RESPONSES.map((e) => ({ key: e.name, cells: { status: String(e.status), name: e.name, description: e.description } })),
  );
  expect(v.errors.length).toBe(ERROR_RESPONSES.length);
});

test("doctrine: the intro, the base-URL note and the provenance paragraph, verbatim, in reading order", () => {
  const v = deriveApiView(BASE);
  expect(v.doctrine).toEqual([
    "The committed API contract, rendered from its own examples: read-only JSON, no auth, every money value a decimal string. If a handler disagrees with this page, that is a failure, not documentation lag.",
    "Base URL http://x: the origin this deployment is built against (NEXT_PUBLIC_SOLVENT_API_URL).",
    "Samples are extracted from the committed contract by tests/fixtures/generate-proof.mjs; tests/unit/proof-contract-fidelity.spec.ts re-extracts from api/openapi.yaml on every run and fails on any drift between this page's source module and the contract.",
  ]);
  // The slogan is doctrine: the drawer keeps it whole, and the header states the facts that make it true instead.
  expect(v.headline.dek).not.toContain("documentation lag");
});

test("the contract's prose reflows without a word changing: blank lines end paragraphs, list items open their own, a hard wrap reads as a space", () => {
  expect(contractParagraphs("one line")).toEqual(["one line"]);
  expect(contractParagraphs("a hard\nwrapped sentence.\n\nA second\nparagraph.")).toEqual(["a hard wrapped sentence.", "A second paragraph."]);
  expect(contractParagraphs("Lead:\n  * `first` — item one,\n    continued.\n  * `second` — item two.\n\nAfter.")).toEqual([
    "Lead:",
    "* `first` — item one, continued.",
    "* `second` — item two.",
    "After.",
  ]);
  expect(contractParagraphs("")).toEqual([]);
  // The law, over every description the page prints: the words, in order, are the contract's own — nothing added, dropped or moved.
  const words = (text: string): string[] => text.split(/\s+/).filter((w) => w !== "");
  const prose = [...OPERATIONS.map((op) => op.description), ...OPERATIONS.flatMap((op) => op.parameters.map((p) => p.description))];
  expect(prose.some((text) => text.includes("\n"))).toBe(true);
  for (const text of prose) {
    const paragraphs = contractParagraphs(text);
    expect(words(paragraphs.join(" "))).toEqual(words(text));
    for (const paragraph of paragraphs) expect(paragraph).not.toContain("\n");
  }
});
