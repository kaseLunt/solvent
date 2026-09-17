import type { Metadata } from "next";
import { ApiSurface } from "./ApiSurface";

export const metadata: Metadata = { title: "API" };

/** API: the committed contract, rendered from its own examples. Static — nothing is fetched at build or request time. */
export default function ApiPage() {
  return <ApiSurface />;
}
