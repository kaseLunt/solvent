### Task 6: `api-view` and the API page

**Files:**
- Create: `web/lib/api-view.ts`, `web/tests/unit/api-view.spec.ts`, `web/app/developers/ApiSurface.tsx`, `ApiDrawer.tsx`, `api.module.css`, `web/tests/e2e/api.spec.ts`
- Modify: `web/app/developers/page.tsx` (title "API"; renders `ApiSurface` — the page stays a server component; the drawer button is a small client island), `EndpointCard.tsx`, `CodeBlock.tsx` (kit classes; ids `api-endpoint-{operationId}`, `api-quickstart`)
- Delete: `web/app/developers/developers.module.css`, `web/tests/e2e/developers.spec.ts` (after re-expression)

**Interfaces:**
- Consumes: `CONTRACT_META`, `ERROR_RESPONSES`, `OPERATIONS` (`lib/proof-contract.gen.ts`); `solventBaseUrl`; kit `VerdictHeader`, `KpiTile`, `KitTable`, `SectionHead`, `Drawer`.
- Produces:

```ts
// web/lib/api-view.ts
export interface ApiView {
  readonly kicker: string;            // "API · {title} v{version}"
  readonly headline: LabHeadline;     // emphasis "{N} read-only operations, every money value a decimal string."; dek "If a handler disagrees with this page, that is a failure, not documentation lag."; tone ok
  readonly chips: LabChip[];          // Contract (title · version) · Operations (N) · Base URL (mono) · Source (sourcePath)
  readonly tiles: { operations: string; errors: string; version: string };
  readonly errors: readonly { key: string; cells: { status: string; name: string; description: string } }[];
  readonly doctrine: readonly string[]; // the intro, the base-URL note, the provenance paragraph, verbatim
}
export function deriveApiView(baseUrl: string): ApiView;
```

- [ ] **Step 1: Unit pins**: `deriveApiView("http://x")` → tiles.operations = `String(OPERATIONS.length)`, errors = `String(ERROR_RESPONSES.length)`, version = `CONTRACT_META.version`; chips carry the base URL; the error rows equal `ERROR_RESPONSES` mapped. Run → fails.
- [ ] **Step 2: Implement.** **Step 3: The page**: `VerdictHeader` (`api-verdict`), three tiles, `api-base-url`, the TOC as kit ghost anchors (`api-toc`), `SectionHead` "TypeScript · @solvent/client" + `CodeBlock` (`api-quickstart`), `SectionHead` "Endpoints · N operations, {sourcePath} verbatim" + the `EndpointCard`s, `SectionHead` "Error envelope" + `KitTable` (`api-errors`, rows `api-error-{name}`) with each row's body sample in a `details` beneath the table (keep `CodeBlock` + copy), `ApiDrawer` (client island) with the doctrine. Root `api-surface`.
- [ ] **Step 4: Contract e2e** (`api.spec.ts`, no routes needed): every contract operation renders (`api-endpoint-{id}` count = `OPERATIONS.length` — the old developers.spec:28 law), the quickstart carries the base URL, the error table has `ERROR_RESPONSES.length` rows, the drawer. Re-express `developers.spec.ts`'s 8 pins; delete it.
- [ ] **Step 5: Gates.** **Step 6: Commit** (lib+pins; page+contract).

