---
id: INS-17a8f8b0-95c6-4676-add0-a7767f276b7a
type: insight
title: "Serena Go semantic tools require gopls installed separately"
status: candidate
informs: []
review_when: date:2026-08-07
updated: 2026-07-24
---

# INS-17a8f8b0-95c6-4676-add0-a7767f276b7a — Serena Go semantic tools require gopls installed separately

## Finding

`.serena/project.yml` declaring `go` does **not** mean Serena's symbolic tools work. They need
`gopls` on PATH, installed separately from Go itself. Without it every symbolic call fails at
project initialisation:

```text
Failed to start 1 language server(s):
go: Found a Go version but gopls is not installed.
```

From the creation of `.serena/project.yml` (2026-07-23, commit `741b19c` era) until 2026-07-24,
`gopls` was absent and `C:\Users\kasel\go\bin` did not exist at all. Every Serena call in that window
would have failed, so all of Phase 1 and Phase 2 Tasks 0–7 were navigated with grep/read/Edit
fallback. Nothing was broken by this — it just meant the semantic tooling the config advertised was
never actually available.

## Fix and its non-obvious catch

```bash
go install golang.org/x/tools/gopls@latest   # lands in $(go env GOPATH)/bin
```

**Installing it is not enough for the current session.** Serena's MCP server initialises its
language-server manager once at startup; if `gopls` appeared afterwards, every call keeps returning
the same initialisation error until the MCP server restarts. Verified: install succeeded, calls still
failed; after a session restart `get_symbols_overview` on `internal/store/derive.go` returned the
real symbol tree.

## Consequence

- Verify the capability, don't infer it from config — one `get_symbols_overview` call is the check.
  Serena's own error message says to stop and report rather than work around it, which is correct:
  silently degrading to grep is how this went unnoticed for two phases.
- The same applies to subagents. A `serena-coder` agent dispatched into a repo without `gopls`
  inherits the failure, so the tool choice its prompt argues for is unavailable.
- Generalisation worth remembering: this is RULES 12 ("attainment is derived") applied to tooling. A
  declaration of a capability is not evidence of it. The project hit the identical shape of mistake
  twice on 2026-07-24 — this, and a Phase-2 artifact path assumed to be free when a Phase-1 file
  already held it.

