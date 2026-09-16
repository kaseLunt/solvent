// web/tests/fixtures/meta.ts
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { components } from "@solvent/client";

type Schemas = components["schemas"];
const here = path.dirname(fileURLToPath(import.meta.url));

/** /v1/meta — the contract-validated client fixture, byte-copied by generate-overview.mjs. */
export const META: Schemas["MetaResponse"] = JSON.parse(readFileSync(path.join(here, "meta.json"), "utf8")) as Schemas["MetaResponse"];
