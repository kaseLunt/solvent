import type { Metadata } from "next";
import { truncateAddress } from "@/lib/format";
import { InspectorSurface } from "./InspectorSurface";

interface RouteParams {
  params: Promise<{ addr: string }>;
}

export async function generateMetadata({ params }: RouteParams): Promise<Metadata> {
  const { addr } = await params;
  return { title: `Inspector · ${truncateAddress(addr)}` };
}

/**
 * /inspector/[addr] — one address, every number defended. The surface itself
 * is a client component: it validates the address STRICTLY before any request
 * (an invalid path segment is an inline refusal, never a lookup for a
 * different account) and renders the three-valued `found` at the page level.
 */
export default async function InspectorAddressPage({ params }: RouteParams) {
  const { addr } = await params;
  return <InspectorSurface addr={addr} />;
}
