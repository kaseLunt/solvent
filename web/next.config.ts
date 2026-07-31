import path from "node:path";
import type { NextConfig } from "next";

// Next commands always run with cwd = web/, and this package is ESM
// ("type": "module") so __dirname is unavailable in the compiled config.
const repoRoot = path.resolve(process.cwd(), "..");

const nextConfig: NextConfig = {
  // The workspace root is the REPO root: @solvent/client is a file: symlink
  // into ../packages/client-ts, and both tracing and Turbopack need to see
  // across that boundary (this also silences multi-lockfile inference).
  outputFileTracingRoot: repoRoot,
  turbopack: {
    root: repoRoot,
  },
};

export default nextConfig;
