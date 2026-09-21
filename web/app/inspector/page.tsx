import type { Metadata } from "next";
import { InspectorLanding } from "./InspectorLanding";

export const metadata: Metadata = { title: "Inspector" };

/** /inspector — the question and the field (spec 2026-09-15 §5.3). */
export default function InspectorPage() {
  return <InspectorLanding />;
}
