import type { Metadata } from "next";
import { OverviewSurface } from "./overview/OverviewSurface";

export const metadata: Metadata = { title: "Overview" };

/** The front door (spec 2026-09-15 §5.1). */
export default function RootPage() {
  return <OverviewSurface />;
}
