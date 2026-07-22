# Solvent

![ci](https://github.com/kaseLunt/solvent/actions/workflows/ci.yml/badge.svg)

Real-time solvency companion for ether.fi Cash borrowers. Work in progress.

Reorg-safe indexer → PostgreSQL event log → (coming) risk engine, public API, alerts, web.
Positions are derived state: everything is rebuildable from `raw_logs`. Reorg recovery uses
verified-ancestor rewind — on a cursor-hash mismatch the walker probes stored block hashes
against the live chain and rewinds to the first provably canonical block, so forks of any
depth are handled, not just shallow ones.

## Dev

    cp .env.example .env
    make db-up
    make test
