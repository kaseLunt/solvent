"use client";

// The ROOT route boundary (p1b-0): one boundary above all surfaces — every
// surface is one client component under layout.tsx, so per-route boundaries
// add nothing. error.tsx replaces only the segment BELOW layout.tsx: the
// header/nav stay mounted, and the refusal is scoped to the view that
// earned it.
import { RouteRefusal } from "../components/RouteRefusal";

export default function RouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <RouteRefusal error={error} reset={reset} />;
}
