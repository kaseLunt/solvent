import type { Metadata } from "next";
import { BookSurface } from "./BookSurface";

export const metadata: Metadata = { title: "Book" };

/**
 * The Book route (W1). All data arrives client-side through @solvent/client
 * (and lib/positions for the C1 /v1/positions seam) — nothing is fetched at
 * build time, so a static shell never bakes in a stale batch.
 */
export default function BookPage() {
  return <BookSurface />;
}
