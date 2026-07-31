// Ensure the `@solvent/client` file: dependency has a built `dist/` before any
// web-side compile runs.
//
// `packages/client-ts` ships no committed `dist/` — its build artifact is
// produced by `npm run build` there — while npm installs `file:` dependencies
// as symlinks, so whatever is (or is not) in that package's `dist/` is exactly
// what `next build` / `tsc` will resolve. Running this as `predev` /
// `prebuild` / `pretypecheck` makes the coupling explicit and self-healing
// instead of a "cannot find module" surprise.
//
// Steps:
//  1. `npm ci` in packages/client-ts when its node_modules is missing
//     (the build needs the pinned typescript there).
//  2. `npm run build` there, always — it is fast, and a stale dist is a
//     subtler failure than the seconds this costs.

import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const clientDir = path.resolve(here, "..", "..", "packages", "client-ts");

if (!existsSync(path.join(clientDir, "package.json"))) {
  console.error(`ensure-client: no package at ${clientDir}`);
  process.exit(1);
}

if (!existsSync(path.join(clientDir, "node_modules"))) {
  console.log("ensure-client: installing @solvent/client dev deps (npm ci)…");
  execSync("npm ci", { cwd: clientDir, stdio: "inherit" });
}

console.log("ensure-client: building @solvent/client…");
execSync("npm run build", { cwd: clientDir, stdio: "inherit" });
