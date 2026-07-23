<!-- BEGIN control-plane session protocol (injected by the control-plane skill) -->

## Project Context (control plane)

This project uses a repository-native control plane. Read `roadmap/VISION.md` first, then
`roadmap/SYSTEM.md`. Durable project authority lives in the repository, not in chat or agent
memory.

## Session Protocol

### On Session Start

Read, in order: `roadmap/STATUS.md` (current task and blockers), `roadmap/ROADMAP.md` (active
phase), `roadmap/SYSTEM.md` (governance model), and the active work item under `roadmap/work/`.

### During Work

Capture material that outlives the current task before continuing:

- future feature or tangent -> `roadmap/ideas/`
- reusable knowledge or finding -> `roadmap/insights/`
- proposed or accepted direction -> `roadmap/decisions/`
- blocker or plan-threatening risk -> `roadmap/STATUS.md` or `roadmap/risks/`

Capture does not imply promotion. Project-owned rules determine who may accept decisions,
change priorities, or edit protected governance files.

### On Session End

Check for uncaptured ideas, insights, decisions, risks, blockers, and resumability details.
Update status only for real transitions. Do not create narrative session dumps.

## Repository Rules

Preserve existing project policy. Work only inside the active task's declared scope, run its
real verification commands, and report local hooks, CI checks, and protected merge gates
accurately. Default to one repository writer unless the project has explicitly activated and
verified a concurrent-writer contract.

<!-- END control-plane session protocol -->

<!-- project-owned section below; the managed block above is installer-owned -->

## Project Review Policy (owner-ratified)

- **Codex is the standing senior reviewer** — see `roadmap/decisions/D-005-codex-senior-reviewer.md`
  for the binding cadence: adversarial pass on every correctness-critical component, whole-branch
  review at phase close, verification of fix waves. Dispatch via the `codex-reviewer` agent type.
- Standard per-task reviews still run for everything; Codex is additive, not a replacement.
