// The warn-band disclosure obligation (design ruling, W1): every Book context
// that renders warn carries this line — at the table or legend level, not as
// per-cell noise. Derived from lib/severity's WARN_HF_RATIO so the phrase and
// the band cannot drift apart.

import { WARN_HF_RATIO } from "@/lib/severity";

export const WARN_BAND_DISCLOSURE = `presentation band < ${String(
  WARN_HF_RATIO,
)}, set for display and not by the engine`;
