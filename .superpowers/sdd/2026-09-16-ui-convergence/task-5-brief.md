### Task 5: `verification-view`, the Verification page and its "Architecture & verification" section

**Files:**
- Create: `web/lib/verification-view.ts`, `web/tests/unit/verification-view.spec.ts`, `web/app/proof/VerificationSurface.tsx`, `VerificationArchitecture.tsx`, `VerificationSubjects.tsx`, `VerificationDrawer.tsx`, `verification.module.css`, `web/tests/e2e/verification.spec.ts`
- Modify: `web/app/proof/page.tsx` (title "Verification"), `web/app/overview/Pipeline.tsx` (its four-step law extracted to `lib/verification-view.ts` and re-consumed — the Overview keeps rendering it), `web/app/proof/CopyChip.tsx` (kit classes)
- Delete: `web/app/proof/ProofSurface.tsx`, `proof.module.css`, `web/components/EvidenceDrawer.tsx`, `evidence.module.css`, `web/tests/e2e/proof.spec.ts` (after re-expression)

**Interfaces:**
- Consumes: `fetchEvidence`, `ProofFetchError`, `EvidenceDescriptor`, `proofTakeaway` (`lib/proof-data.ts`); the `Pipeline` step derivations (read `app/overview/Pipeline.tsx`: `indexValue`, `verifyValue`, `PUBLIC_ENDPOINTS`, `UNAVAILABLE`) — move their computation into `lib/verification-view.ts` as `pipelineSteps(meta, evidence, book, cashAccounts)` and make `Pipeline.tsx` render from it; `useMetaConstants` / the Overview's meta and book readers for the live numbers; kit `VerdictHeader`, `KpiTile`, `KitTable`, `SectionHead`, `StatusPill`, `Drawer`, `ExactValue`.
- Produces:

```ts
// web/lib/verification-view.ts
export type ReceiptState = "exact" | "drift" | "failed" | "none";
export interface PipelineStep { readonly key: "index" | "compute" | "verify" | "serve"; readonly label: string; readonly value: string; readonly sub: string; readonly tone: "neutral" | "ok" | "warn" | "refused"; readonly sentence: string }
export function pipelineSteps(meta: MetaResponse | null, evidence: EvidenceResponse | null, book: BookResponse | null, cashAccounts: number | null): readonly PipelineStep[]; // the Overview's four numbers, unchanged in law
export interface VerificationView {
  readonly state: "loading" | "unavailable" | "ok"; readonly receipt: ReceiptState;
  readonly kicker: "Verification · this deployment"; readonly headline: LabHeadline; readonly chips: LabChip[];
  readonly steps: readonly PipelineStep[]; readonly receiptLine: string;   // "Reconcile receipt: N gated rows exact, M drift" | the failing/absent words
  readonly probes: readonly { key: string; dim: boolean; cells: Record<string, string> }[]; readonly doctrine: readonly string[];
}
export function deriveVerificationView(input: { state: { phase: "loading" } | { phase: "error"; message: string; retryAfterSeconds: number | null } | { phase: "ok"; manifest: EvidenceResponse }; meta: MetaResponse | null; book: BookResponse | null; cashAccounts: number | null }): VerificationView;
```

  Rules: headline `proofTakeaway(manifest)` (ok), tone `warn` when the receipt is `drift`/`failed`/`none`, `refused` when unavailable ("Evidence unavailable: {message}" + the retry words); dek "Two subjects, never one: the pinned proof and the live batch."; chips Pinned batch · Live batch · Receipt (exact/drift/failed/none with tone) · Key (the manifest's key id, `mono`); `steps` from `pipelineSteps` with each step's one sentence (Index: "Chain heights indexed per engine, ahead of every batch."; Compute: "Batch {id} computed at {cadence}; every position's health from the wire's own integers."; Verify: "{N} gated rows reconciled exact against the chain; {M} drift named."; Serve: "{N} read-only endpoints, every money value a decimal string."); probes rows from `ProbeRecordsCard`'s data (read it — keep its columns and words); doctrine = today's intro, the "two subjects" strip, the stampline's words, verbatim.

- [ ] **Step 1: Unit pins** with `EVIDENCE_MANIFEST`, `DEMO_META`, `DEMO_BOOK`: state ok; receipt `exact` (read the manifest); the Verify step's value equals what the Overview's `Pipeline` prints today for the same inputs (pin `pipelineSteps` against the exact strings the Overview e2e pins already assert — read `tests/e2e/overview.spec.ts` for them); `EVIDENCE_PROOF_FAILED` → receipt `failed`, tone warn; error → unavailable, refused, the retry words; headline equals `proofTakeaway(manifest)`. Run → fails.
- [ ] **Step 2: Implement `verification-view.ts`; refactor `Pipeline.tsx` to render `pipelineSteps(...)` (the Overview's pins must stay green — `overview.spec.ts`).**
- [ ] **Step 3: The page.** `VerificationSurface`: the evidence fetch as today, plus the meta and book readers the Overview uses (import the same hooks); `VerdictHeader` (`verification-verdict`, drawer button); `VerificationArchitecture` (`SectionHead` "Architecture & verification" with the anchor id `architecture` so the Overview's link `/proof#architecture` lands on it — update the Overview's href; four `KpiTile`s `verification-kpi-{key}` then a four-column grid of the step sentences `verification-step-{key}`, then `verification-receipt` line with the receipt tone); `VerificationSubjects` = the two subject cards (`ProofSubjectCard`, `LiveSubjectCard` content moved into two kit-styled cards, ids `verification-subject-proof/live`, their "explain" affordances opening the drawer with the descriptor content the old `EvidenceDrawer` rendered — move that rendering into `VerificationDrawer` as a second drawer section); `KitTable` for the probes (`verification-probes`); the raw JSON toggle (`verification-raw`/`verification-raw-json`); root `verification-surface` with `data-state`/`data-receipt`. Delete the old files.
- [ ] **Step 4: Contract e2e** (`verification.spec.ts`; routes `**/v1/evidence*` → the manifest fixtures, `**/v1/meta*`, `**/v1/book`, `**/v1/positions*` as the Overview's mocks): ok with receipt exact and the four steps' values; the failing proof → `data-receipt="failed"`, warn tone, the receipt line's words; unavailable → refused; the Overview's "Architecture & verification →" link lands on `#architecture`; the drawer opens with the doctrine and a subject's explanation; the raw JSON toggle. Re-express `proof.spec.ts`'s 17 pins and the Verification pins in p1a/p1b/r1 (grep `proof`); delete `proof.spec.ts`.
- [ ] **Step 5: Gates** (+ `tests/e2e/overview.spec.ts`). **Step 6: Commit** (lib+pins incl. `Pipeline.tsx`; page+contract).

