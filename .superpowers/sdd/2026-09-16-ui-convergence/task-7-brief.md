### Task 7: Retire the pre-kit components; the styleguide shows the kit (R7)

**Files:**
- Delete: `web/components/{StatCard,Stampline,Ribbon,EngineChip,RefusedTag,AddressMono,StatusChip,VerdictBanner,DataTable,MarksStamp,ProjectionBadge,SeverityHF}.tsx`, `web/components/{ribbon,verdict,table,chip}.module.css` (each only if no import remains — `find_referencing_symbols` on every export first)
- Modify: `web/app/styleguide/page.tsx`, `TableSpecimen.tsx`, `PaginationDemo.tsx`, `DrawerDemo.tsx` (kit specimens: VerdictHeader ×4 tones, KpiTile ×5 incl. refused-dashed and pending, StatusPill vocabulary, IdentityChips, KitTable with a dim refused row and a small/dust toggle, Drawer), `web/tests/e2e/p1a-fixes.spec.ts` (the styleguide pins re-expressed against the kit specimens; the contrast-swatch pin `p1a-6` must stay green — the swatches are tokens, not components), `web/tests/e2e/shell.spec.ts` if it names a retired component
- Test: the whole e2e project

- [ ] **Step 1:** `find_referencing_symbols` on each component's export; the only remaining consumers must be the styleguide. **Step 2:** rewrite the styleguide's sections to kit specimens (keep the section order and the page's self-measuring contrast block untouched). **Step 3:** delete the components and CSS; `npx tsc --noEmit`; `npx eslint .`; `npm run lint:css`; build; `npx playwright test --project=e2e`. **Step 4:** commit by pathspec: `git commit -m "refactor(web): the pre-kit components retired - StatCard, Stampline, Ribbon, EngineChip, RefusedTag, AddressMono, StatusChip, VerdictBanner, DataTable, MarksStamp, ProjectionBadge, SeverityHF; the styleguide shows the kit" -- <paths>`.

