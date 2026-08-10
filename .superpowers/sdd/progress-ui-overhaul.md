# UI Overhaul program ledger

Program spec: docs/specs/2026-08-09-ui-overhaul-program-design.md

## Phase 0 — trust fixes

### p0-1 address-bound stress results (LabClient)
- New pins: tests/unit/address-binding.spec.ts (6), p0-fixes.spec.ts p0-1 (2 e2e).
- Retired pins: none.
- Mutants: comparison-deletion in addressBinding — killed at lab-stale-result
  visibility (e2e) and at the stale-arm equality (unit), each in isolation.
