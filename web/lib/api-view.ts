// One view model for the API page. The surface reads it and prints it; the
// pins read it and check it; nothing below it decides a sentence twice. Every
// figure is the generated contract extract's own (lib/proof-contract.gen.ts,
// drift-gated against api/openapi.yaml by tests/unit/proof-contract-fidelity.spec.ts):
// the page cannot say what the contract does not. The one deployment-specific
// value is the API origin the samples target, passed in by the caller.
import type { LabHeadline } from "./lab-headline";
import type { LabChip } from "./lab-view";
import { CONTRACT_META, ERROR_RESPONSES, OPERATIONS } from "./proof-contract.gen";

export interface ApiView {
  /** "API · {title} v{version}" — the page's name first, then the contract it renders. */
  readonly kicker: string;
  readonly headline: LabHeadline;
  /** Contract · Operations · Base URL · Source. */
  readonly chips: LabChip[];
  readonly tiles: { operations: string; errors: string; version: string };
  /** The error envelope, one row per contract response, in the contract's order. */
  readonly errors: readonly { key: string; cells: { status: string; name: string; description: string } }[];
  /** The intro, the base-URL note and the provenance paragraph, verbatim — the drawer's doctrine. */
  readonly doctrine: readonly string[];
}

/** The one clause the header keeps visible: the law this page exists to state. The rest of the intro is doctrine. */
export const API_DEK = "If a handler disagrees with this page, that is a failure, not documentation lag.";

/** The adjudicated intro (the R1 clarity ruling), verbatim; its closing clause is the dek. */
export const API_INTRO = `The committed API contract, rendered from its own examples: read-only JSON, no auth, every money value a decimal string. ${API_DEK}`;

/** Where every sample on the page comes from, and what fails when the page and the contract disagree. */
export const API_PROVENANCE =
  "Samples are extracted from the committed contract by tests/fixtures/generate-proof.mjs; tests/unit/proof-contract-fidelity.spec.ts re-extracts from api/openapi.yaml on every run and fails on any drift between this page's source module and the contract.";

/** The base URL's note: which origin, and where it is set. The URL itself precedes it so the drawer stands alone. */
const BASE_URL_NOTE = "the origin this deployment is built against (NEXT_PUBLIC_SOLVENT_API_URL)";

export function deriveApiView(baseUrl: string): ApiView {
  const operations = String(OPERATIONS.length);
  return {
    kicker: `API · ${CONTRACT_META.title} v${CONTRACT_META.version}`,
    // Static content always answers, so the tone is `ok`; a refusal here would be a build that shipped no contract.
    headline: {
      emphasis: `${operations} read-only operations, every money value a decimal string.`,
      rest: "",
      tone: "ok",
      dek: API_DEK,
    },
    chips: [
      { label: "Contract", value: `${CONTRACT_META.title} · v${CONTRACT_META.version}` },
      { label: "Operations", value: operations },
      { label: "Base URL", value: baseUrl, title: BASE_URL_NOTE },
      { label: "Source", value: CONTRACT_META.sourcePath },
    ],
    tiles: { operations, errors: String(ERROR_RESPONSES.length), version: CONTRACT_META.version },
    errors: ERROR_RESPONSES.map((e) => ({
      key: e.name,
      cells: { status: String(e.status), name: e.name, description: e.description },
    })),
    doctrine: [API_INTRO, `Base URL ${baseUrl}: ${BASE_URL_NOTE}.`, API_PROVENANCE],
  };
}
