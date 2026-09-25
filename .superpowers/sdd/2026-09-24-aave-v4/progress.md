# V4 engine + go-live: progress ledger

## 2026-09-24 — owner rulings of record
- Specs approved: "specs look good" (2026-09-24 18:22 USMST) — `docs/specs/2026-09-24-cash-on-aave-v4-design.md`
  (revision 4, rulings R1–R7) and `docs/specs/2026-09-24-go-live-design.md` (revision 4), committed at `fe07ac3`.
- **Codex gate waived for this work by the owner:** "we don't need to wait for codex. just move on with your own
  reviews." Codex (D-006) was unavailable (usage limit until 2026-09-27 15:38). Review for this work is the integrator's
  own adversarial panels (independent lens reviewers + skeptic verification), per task and at phase close. This
  direction is to be recorded as an accepted Decision (D-016) in the owner-reviewed W3→W4 governance transition; the
  roadmap/decisions path is outside W3's scope, so it is captured here until then.
- Owner actions requested (walkthrough given in session): Hetzner CX33 + IPv4, Cloudflare domain, named tunnel token +
  two public hostnames (`^/v1/` → api:8080, then → web:3111), R2 bucket + scoped token, optional dRPC OP key. Secrets go
  to `C:\Users\kasel\.solvent\prod.env` (outside the repo), copied to the box without printing.
- A dedicated deploy key was generated at `~/.ssh/solvent_hetzner` (ed25519, no passphrase; public half given to the
  owner for Hetzner).

## 2026-09-24 — box and domain
- Hetzner **CX33, Helsinki** (cost-optimized x86; CX33 was out of stock in Nuremberg, so the first box, a CPX12
  1 vCPU/2 GB created by default, was deleted). Ubuntu 26.04.1, 4 vCPU / 7.6 GiB / 75 GB, IPv4 `2.29.50.224`, SSH key
  `~/.ssh/solvent_hetzner` verified. $10.59/mo incl. IPv4.
- Domain **solventrisk.com** (Cloudflare Registrar). Tunnel routes: `^/v1/` → `api:8080`, then → `web:3111`.
- Plan drafting workflow `wf_cb403e1e-ca2` (7 task drafters + 2 reviewers) running.

## Next
- Plan: go-live Part A (W3) → execute → box up unannounced → governance transition W3→W4 (D-015, D-016) → V4 plan.
