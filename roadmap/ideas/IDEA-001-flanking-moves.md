---
id: IDEA-001
type: idea
title: "Launch flanking moves: engineering writeup + DefiLlama adapter PR + weETH watch module"
status: candidate
date: 2026-07-22
informs: [H0]
updated: 2026-07-22
---

# IDEA-001 — Launch flanking moves

Captured from the approved spec (§9–10); not scheduled until P5/P6.

1. **Engineering writeup** (exactly one): "Reimplementing and proving Aave's health-factor math
   against mainnet" — publish alongside the P5 launch.
2. **DefiLlama adapter PR** improving tracking of the Aave EtherFi market / Debt Manager — a
   merged-PR contribution in the repo lineage ether.fi itself forks (~1 day, after v1 ships).
   Recon note: the borrowing-market adapter lives upstream
   (`projects/etherfi-cash-collateral-management/index.js`), not in ether.fi's fork.
3. **weETH cross-chain watch module** (spec §10 explicitly deferred): supply-invariant + peg monitor
   across ~19 chains; only if post-launch momentum justifies it (P6, parked).
