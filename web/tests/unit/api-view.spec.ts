// The API page's one view model: header, chips, tiles, error rows and doctrine,
// derived once from the generated contract extract (lib/proof-contract.gen.ts).
// Every figure here is the extract's own count or version — the page cannot say
// what the contract does not. The one deployment-specific value is the base URL.
import { expect, test } from "@playwright/test";
import { deriveApiView } from "../../lib/api-view";
import { CONTRACT_META, ERROR_RESPONSES, OPERATIONS } from "../../lib/proof-contract.gen";

const BASE = "http://x";

test("tiles: the operation count, the error-response count and the contract version — the extract's own", () => {
  const v = deriveApiView(BASE);
  expect(v.tiles).toEqual({
    operations: String(OPERATIONS.length),
    errors: String(ERROR_RESPONSES.length),
    version: CONTRACT_META.version,
  });
});

test("header: the kicker names the contract and its version; the headline counts the operations; the dek is the one clause; tone ok", () => {
  const v = deriveApiView(BASE);
  expect(v.kicker).toBe(`API · ${CONTRACT_META.title} v${CONTRACT_META.version}`);
  expect(v.headline).toEqual({
    emphasis: `${String(OPERATIONS.length)} read-only operations, every money value a decimal string.`,
    rest: "",
    tone: "ok",
    dek: "If a handler disagrees with this page, that is a failure, not documentation lag.",
  });
});

test("chips: Contract · Operations · Base URL · Source, in that order; the base URL as given; the source path the extract's", () => {
  const v = deriveApiView(BASE);
  const value = (label: string): string | undefined => v.chips.find((c) => c.label === label)?.value;
  expect(v.chips.map((c) => c.label)).toEqual(["Contract", "Operations", "Base URL", "Source"]);
  expect(value("Contract")).toBe(`${CONTRACT_META.title} · v${CONTRACT_META.version}`);
  expect(value("Operations")).toBe(String(OPERATIONS.length));
  expect(value("Base URL")).toBe(BASE);
  expect(value("Source")).toBe(CONTRACT_META.sourcePath);
  // A different origin is a different chip: the URL is never normalised or invented here.
  expect(deriveApiView("https://api.example.test").chips.find((c) => c.label === "Base URL")?.value).toBe("https://api.example.test");
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
  // The dek is the intro's closing clause, so the header never states what the drawer does not.
  expect(v.doctrine[0]?.endsWith(v.headline.dek)).toBe(true);
});
