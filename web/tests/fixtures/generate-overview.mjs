// web/tests/fixtures/generate-overview.mjs
// Overview fixture generation + PROVENANCE. Regenerate: node tests/fixtures/generate-overview.mjs (from web/)
//   meta.json <- BYTE-IDENTICAL copy of packages/client-ts/test/fixtures/meta.json
//   (contract-validated there by fixtures.test.ts against api/openapi.yaml).
import { copyFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const src = path.resolve(here, "../../../packages/client-ts/test/fixtures/meta.json");
copyFileSync(src, path.join(here, "meta.json"));
console.log("wrote tests/fixtures/meta.json (byte copy)");
