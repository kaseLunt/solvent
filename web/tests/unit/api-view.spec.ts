// The API page's one view model: header, chips, the census, the endpoint index,
// error rows and doctrine, derived once from the generated contract extract
// (lib/proof-contract.gen.ts). Every figure here is the extract's own count or
// version — the page cannot say what the contract does not, and the census
// is counted from the extract, never typed beside it. The one
// deployment-specific value is the base URL, stated once.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { SolventClient } from "@solvent/client";
import {
  API_COPY,
  API_ERROR_COLUMNS,
  API_FIXTURES_NOTE,
  apiDek,
  contractBlocks,
  contractParagraphs,
  curlFor,
  deriveApiView,
  errorSampleCopy,
  errorStatuses,
  inlineParts,
  operationCopy,
  quickstartSample,
  verbCensus,
  versionNoteParts,
  type InlinePart,
} from "../../lib/api-view";
import { CONTRACT_META, ERROR_RESPONSES, OPERATIONS } from "../../lib/proof-contract.gen";

const BASE = "http://x";

test("no tiles: the census line above the index says what the index holds — the verb census and the error statuses, counted from the extract; the version is the kicker's and the chip's", () => {
  const v = deriveApiView(BASE);
  expect(v).not.toHaveProperty("tiles");
  expect(v.census).toBe(`${verbCensus()} · error responses ${errorStatuses()}`);
  expect(v.census).toBe("15 GET · 2 POST · error responses 400 · 404 · 409 · 429 · 500 · 503");
  expect(v.census).not.toContain(CONTRACT_META.version);
});

test("the census is computed, never typed: the verb census sums to the endpoint count in the contract's order; the status list is the error envelope's own", () => {
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
  // The version is set apart so the kicker's capitals never recase it; the parts are the kicker, whole.
  expect(v.kickerParts).toEqual({ lead: "API · contract", version: "v1.8.0" });
  expect(`${v.kickerParts.lead} ${v.kickerParts.version}`).toBe(v.kicker);
  expect(v.headline).toEqual({
    emphasis: `${String(OPERATIONS.length)} read-only endpoints,`,
    rest: "every money value an exact decimal string.",
    // A statement of record wears ink; green is a health verdict and this page has none.
    tone: "neutral",
    dek: apiDek(),
  });
  expect(`${v.headline.emphasis} ${v.headline.rest}`).toBe("17 read-only endpoints, every money value an exact decimal string.");
  // One word product-wide: the OpenAPI noun leaves the header and the census.
  const printed = [
    v.kicker,
    v.headline.emphasis,
    v.headline.rest,
    v.headline.dek,
    v.endpointsQualifier,
    v.census,
    ...v.chips.flatMap((chip) => [chip.label, chip.value]),
  ];
  for (const text of printed) expect(text).not.toMatch(/operations?/i);
});

test("the dek: two sentences — no key or sign-in but a rate limit; where each sample comes from and what the fidelity test does — each clause licensed by the extract", () => {
  expect(apiDek()).toBe(
    "No key or sign-in; requests are rate-limited per client. Every sample is the contract's own example or a committed client fixture, and a CI test fails if this page drifts from either.",
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
  const [, ciSentence = ""] = /(a CI test [^;.]*)[;.]/.exec(apiDek()) ?? [];
  expect(ciSentence).toBe("a CI test fails if this page drifts from either");
  expect(ciSentence).not.toMatch(/contract-valid|checked against|valid/i);
  // Whether a fixture agrees with the contract is the drawer's clause, and it names the test's owner and that CI does not run it.
  expect(apiDek()).not.toMatch(/client package/);
  expect(deriveApiView(BASE).doctrine).toContain(API_FIXTURES_NOTE);
  expect(API_FIXTURES_NOTE).toContain("the client package's own tests check those fixtures against the contract, and no CI step runs them.");
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

test("the page's own words live in the lib, each standalone line in sentence case: the drawer, the index's name, the section titles and qualifier, the code bars, the link to Verification, the parameter words, the error table's heads", () => {
  expect(API_COPY).toEqual({
    drawer: "Methodology & evidence",
    indexLabel: "Endpoint index",
    quickstartTitle: "TypeScript",
    quickstartQualifier: "@solvent/client",
    quickstartCode: "TypeScript",
    quickstartCopy: "Copy TypeScript quickstart",
    endpointsTitle: "Endpoints",
    verificationLink: "Verification →",
    errorsTitle: "Error envelope",
    curlCode: "curl",
    jsonCode: "JSON",
    required: "required",
    optional: "optional",
  });
  // Another page is "→", after the words.
  expect(API_COPY.verificationLink).toMatch(/^\S.* →$/);
  expect(API_ERROR_COLUMNS).toEqual([
    { key: "status", header: "Status" },
    { key: "name", header: "Response" },
    { key: "description", header: "Description" },
  ]);
});

test("every copy action and sample fold is named from the contract's own method, path and response name — never typed beside them", () => {
  const evidence = OPERATIONS.find((op) => op.method === "GET" && op.path === "/v1/evidence");
  if (evidence === undefined) throw new Error("fixture invariant: GET /v1/evidence is in the contract");
  expect(operationCopy(evidence)).toEqual({
    curl: "Copy curl for GET /v1/evidence",
    sampleSummary: "200 response",
    sampleSource: `· ${String(evidence.exampleSource)}`,
    sample: "Copy 200 sample for GET /v1/evidence",
  });
  // A stream's operation carries no sample, so it cites no source.
  for (const op of OPERATIONS) {
    const copy = operationCopy(op);
    expect(copy.curl).toBe(`Copy curl for ${op.method} ${op.path}`);
    expect(copy.sampleSource).toBe(op.exampleSource === null ? null : `· ${op.exampleSource}`);
  }
  for (const error of ERROR_RESPONSES) {
    expect(errorSampleCopy(error)).toEqual({ summary: `${error.name} body`, source: `· ${error.source}`, copy: `Copy ${error.name} body` });
  }
});

test("each endpoint's curl is the exact invocation against the stated origin: a stream keeps its connection open unbuffered, a POST names its verb, a GET is plain", () => {
  for (const op of OPERATIONS) {
    const curl = curlFor(op, BASE);
    expect(curl).toBe(
      op.sse ? `curl -sN "${BASE}${op.samplePath}"` : op.method === "POST" ? `curl -s -X POST "${BASE}${op.samplePath}"` : `curl -s "${BASE}${op.samplePath}"`,
    );
  }
  expect(OPERATIONS.some((op) => op.sse)).toBe(true);
  expect(OPERATIONS.some((op) => op.method === "POST")).toBe(true);
});

test("doctrine: the intro, the base-URL note, the provenance paragraph and the fixtures' note, verbatim, in reading order", () => {
  const v = deriveApiView(BASE);
  expect(v.doctrine).toEqual([
    "The committed API contract, rendered from its own examples: read-only JSON, no auth, every money value a decimal string. If a handler disagrees with this page, that is a failure, not documentation lag.",
    "Base URL http://x: the origin this deployment is built against (NEXT_PUBLIC_SOLVENT_API_URL).",
    "Samples are extracted from the committed contract by tests/fixtures/generate-proof.mjs; tests/unit/proof-contract-fidelity.spec.ts re-extracts from api/openapi.yaml on every run and fails on any drift between this page's source module and the contract.",
    "Where the contract carries no example, a sample is a committed client fixture, cited beside it; the client package's own tests check those fixtures against the contract, and no CI step runs them.",
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

test("a run of list items is one list: each item's marker is its bullet and leaves the text, and not a word changes", () => {
  expect(contractBlocks("Lead:\n  * `first` — item one,\n    continued.\n  * `second` — item two.\n\nAfter.")).toEqual([
    { kind: "p", text: "Lead:" },
    { kind: "ul", items: ["`first` — item one, continued.", "`second` — item two."] },
    { kind: "p", text: "After." },
  ]);
  // Two runs parted by a paragraph are two lists; a dash is a marker too.
  expect(contractBlocks("- a\n\nmid\n\n- b")).toEqual([
    { kind: "ul", items: ["a"] },
    { kind: "p", text: "mid" },
    { kind: "ul", items: ["b"] },
  ]);
  expect(contractBlocks("")).toEqual([]);
  // The positions sort's list: five keys, each item its own words, and the one list that description carries.
  const positions = OPERATIONS.find((op) => op.operationId === "getPositions");
  const sort = positions?.parameters.find((param) => param.name === "sort");
  if (sort === undefined) throw new Error("contract invariant: getPositions takes a sort");
  const lists = contractBlocks(sort.description).filter((block) => block.kind === "ul");
  expect(lists).toHaveLength(1);
  const [list] = lists;
  if (list?.kind !== "ul") throw new Error("expected the sort list");
  expect(list.items.map((item) => /^`(\w+)`/.exec(item)?.[1])).toEqual(["headroom", "liq_distance", "debt", "hf", "status"]);
  // Over every description the page prints: the blocks' words, markers aside, are the contract's own, in order.
  const words = (text: string): string[] => text.split(/\s+/).filter((w) => w !== "" && w !== "*" && w !== "-");
  const prose = [...OPERATIONS.map((op) => op.description), ...OPERATIONS.flatMap((op) => op.parameters.map((p) => p.description))];
  for (const text of prose) {
    const blocks = contractBlocks(text).flatMap((block) => (block.kind === "p" ? [block.text] : block.items));
    expect(words(blocks.join(" "))).toEqual(words(text));
  }
});

test("a bracketed version note is set apart, never reworded: the parts join back to the text, and only the contract's own notes are marked", () => {
  expect(versionNoteParts("`headroom` (ADDED 1.5.0) — the SHARE")).toEqual([
    { kind: "text", text: "`headroom` " },
    { kind: "ver", text: "(ADDED 1.5.0)" },
    { kind: "text", text: " — the SHARE" },
  ]);
  expect(versionNoteParts("(DEPRECATED 1.5.0, STILL SERVED, ORDERING UNCHANGED) — distance")).toEqual([
    { kind: "ver", text: "(DEPRECATED 1.5.0, STILL SERVED, ORDERING UNCHANGED)" },
    { kind: "text", text: " — distance" },
  ]);
  // A parenthesis that is no version note stays text: "(account)", "(G4)".
  expect(versionNoteParts("Ties break on (account) and (G4).")).toEqual([{ kind: "text", text: "Ties break on (account) and (G4)." }]);
  expect(versionNoteParts("")).toEqual([]);
  const prose = [...OPERATIONS.map((op) => op.description), ...OPERATIONS.flatMap((op) => op.parameters.map((p) => p.description))];
  const notes: string[] = [];
  for (const text of prose) {
    for (const paragraph of contractParagraphs(text)) {
      const parts = versionNoteParts(paragraph);
      expect(parts.map((part) => part.text).join("")).toBe(paragraph);
      notes.push(...parts.filter((part) => part.kind === "ver").map((part) => part.text));
    }
  }
  expect(notes.sort()).toEqual(["(ADDED 1.5.0)", "(AMENDMENT 1)", "(AMENDMENT 1/E)", "(DEPRECATED 1.5.0, STILL SERVED, ORDERING UNCHANGED)"]);
});

/** What a reader sees of a paragraph once its parts render: a strong part's own code spans read again, every marker gone. */
const plainOf = (parts: readonly InlinePart[]): string => parts.map((part) => (part.kind === "strong" ? plainOf(inlineParts(part.text)) : part.text)).join("");

test("the contract's two markers become strong and code; its words stay verbatim; an unbalanced marker stays literal", () => {
  expect(inlineParts("A **409 `batch_superseded`** restarts the walk.")).toEqual([
    { kind: "text", text: "A " },
    { kind: "strong", text: "409 `batch_superseded`" },
    { kind: "text", text: " restarts the walk." },
  ]);
  // A strong part keeps its code spans raw; read again, they are code.
  expect(inlineParts("409 `batch_superseded`")).toEqual([
    { kind: "text", text: "409 " },
    { kind: "code", text: "batch_superseded" },
  ]);
  expect(inlineParts("see `limit` and **THE EXCLUSION LAW**")).toEqual([
    { kind: "text", text: "see " },
    { kind: "code", text: "limit" },
    { kind: "text", text: " and " },
    { kind: "strong", text: "THE EXCLUSION LAW" },
  ]);
  // A marker with no partner is the contract's character, printed as it came.
  expect(inlineParts("a lone ** marker and a lone ` tick")).toEqual([{ kind: "text", text: "a lone ** marker and a lone ` tick" }]);
  expect(inlineParts("`x` and a ` alone")).toEqual([
    { kind: "code", text: "x" },
    { kind: "text", text: " and a ` alone" },
  ]);
  // A code span binds first: a star inside one is literal; a pair that encloses nothing marks nothing.
  expect(inlineParts("`a**b` then **c**")).toEqual([
    { kind: "code", text: "a**b" },
    { kind: "text", text: " then " },
    { kind: "strong", text: "c" },
  ]);
  expect(inlineParts("an empty **** or `` stays")).toEqual([{ kind: "text", text: "an empty **** or `` stays" }]);
  // The list marker the paragraphs keep is one star, never a strong marker.
  expect(inlineParts("* `first` — item one")).toEqual([
    { kind: "text", text: "* " },
    { kind: "code", text: "first" },
    { kind: "text", text: " — item one" },
  ]);
  expect(inlineParts("")).toEqual([]);
});

test("over every description the page prints, no word is lost or added: the parts' plain text is the paragraph with its balanced markers removed", () => {
  const prose = [...OPERATIONS.map((op) => op.description), ...OPERATIONS.flatMap((op) => op.parameters.map((p) => p.description))];
  const counted = { strong: 0, code: 0 };
  for (const text of prose) {
    for (const paragraph of contractParagraphs(text)) {
      // Every marker in the contract's prose has its partner, so removing them all is the independent reading of the words.
      expect((paragraph.match(/\*\*/g) ?? []).length % 2, paragraph).toBe(0);
      expect((paragraph.match(/`/g) ?? []).length % 2, paragraph).toBe(0);
      const parts = inlineParts(paragraph);
      expect(plainOf(parts)).toBe(paragraph.replaceAll("**", "").replaceAll("`", ""));
      for (const part of parts) {
        expect(part.text.length).toBeGreaterThan(0);
        if (part.kind === "strong") counted.strong += 1;
        if (part.kind === "code") counted.code += 1;
        if (part.kind === "strong") counted.code += inlineParts(part.text).filter((inner) => inner.kind === "code").length;
      }
    }
  }
  // The census is not vacuous: the contract carries both markers.
  expect(counted.strong).toBeGreaterThan(0);
  expect(counted.code).toBeGreaterThan(0);
  // The demo arm: getPositions' superseded cursor is bold, its error code inside it is code.
  const positions = OPERATIONS.find((op) => op.operationId === "getPositions");
  if (positions === undefined) throw new Error("contract invariant: getPositions exists");
  const bold = contractParagraphs(positions.description).flatMap((p) => inlineParts(p)).filter((part) => part.kind === "strong");
  expect(bold).toEqual([{ kind: "strong", text: "409 `batch_superseded`" }]);
});

test("a code span binds first inside a bold part too: the bold closes at the first bold marker outside its own code spans", () => {
  expect(inlineParts("**see `a**b`** after")).toEqual([
    { kind: "strong", text: "see `a**b`" },
    { kind: "text", text: " after" },
  ]);
  // Read again, the strong part's span is code, its stars literal.
  expect(inlineParts("see `a**b`")).toEqual([
    { kind: "text", text: "see " },
    { kind: "code", text: "a**b" },
  ]);
  // A bold marker whose only partner sits inside a code span has none: it stays the contract's character, and the span is code.
  expect(inlineParts("**a `b** c`")).toEqual([
    { kind: "text", text: "**a " },
    { kind: "code", text: "b** c" },
  ]);
});

test("the quickstart calls only what the client ships: every client.<method>() it prints is a method of SolventClient, the evidence manifest's included", () => {
  const sample = deriveApiView(BASE).quickstart;
  expect(sample).toBe(quickstartSample(BASE));
  expect(sample).toContain(`new SolventClient({ baseUrl: "${BASE}" })`);
  const calls = [...sample.matchAll(/\bclient\.(\w+)\(/g)].map((match) => match[1] ?? "");
  expect(calls).toEqual(["book", "address", "evidence"]);
  const prototype = SolventClient.prototype as unknown as Record<string, unknown>;
  for (const method of calls) expect(typeof prototype[method], method).toBe("function");
  // No call goes around the client, and nothing says the client lacks one.
  expect(sample).toContain("const evidence = await client.evidence();");
  expect(sample).not.toMatch(/fetch\(|no client method/);
});
