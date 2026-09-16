/** The front door's fixed copy (spec 2026-09-15 §5.1; mockup front-door.html, option A). */
export const HERO_KICKER = "A live risk surface for ether.fi Cash";
export const HERO_H1_LEAD = "70,000 people borrow against crypto to spend on a Visa card.";
export const HERO_H1_TAIL = " This is how close each of them is to liquidation — right now.";
export const HERO_DEK_LEAD =
  "Solvent indexes the Cash lending book straight from chain, recomputes every account's distance to liquidation each batch, and shows its work: ";
export const HERO_DEK_STRONG = "every number opens its evidence";
export const HERO_DEK_TAIL =
  ", and anything it can't defend renders as a named refusal — never a guess, never a zero.";
export const FOOTER_STACK = "Built with Go · PostgreSQL · Next.js · TypeScript · OP Mainnet + Ethereum · RedStone";
export const FOOTER_NOTE = "a portfolio project, not affiliated with ether.fi";

/** Mirror of the API page's route list; the pipeline card prints this list's length. */
export const PUBLIC_ENDPOINTS = [
  "GET /v1/book",
  "GET /v1/positions",
  "GET /v1/address/{addr}",
  "GET /v1/address/{addr}/stress",
  "GET /v1/address/{addr}/history",
  "GET /v1/observatory",
  "GET /v1/observatory/series",
  "GET /v1/events",
  "GET /v1/params",
  "GET /v1/prices/{asset}",
  "GET /v1/scenarios",
  "POST /v1/scenarios/{id}/run-book",
  "POST /v1/scenarios/run-book-set",
  "GET /v1/evidence",
  "GET /v1/batches/{id}",
  "GET /v1/stream",
  "GET /v1/meta",
] as const;
