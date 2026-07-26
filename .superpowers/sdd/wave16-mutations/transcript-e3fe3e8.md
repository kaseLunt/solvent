# mutation transcript

- spec: `mutations.json`
- repo: `C:\Users\kasel\source\repos\etherfi\Solvent`
- **tested SHA: `e3fe3e8626c0f71e190fc2007c8247f663c85a4e`**  (test(prices): assert the fixtures' premises, not just their outcomes)
- started (UTC): 2026-07-26T04:58:41+00:00
- applier: `mutate.py`, exactly-one-occurrence assertion in `apply_edit`

## M1 — the neutralization WARN reports the OFFERED floor as the validity boundary

**Property under attack:** the validity boundary an operator reads is the boundary the store RETURNED, never the floor the pass asked for

*Wave 14's M1, re-run. It is the direct guard on Codex round 10P's finding and on the new below-target arm, which differs from the clamp only in the DIRECTION the two numbers separate.*

```diff
--- internal/prices/poller.go:1808
-"boundary", boundary, "validAtOrBelow", boundary,
+"boundary", boundary, "validAtOrBelow", floorOffered,
```
APPLIED at internal/prices/poller.go:1808 (1 occurrence, asserted)

`go test ./internal/prices/ -count=1`

Killed by:
  - `TestPollerFloorBelowTheEpochsRepairTargetIsReportedAsBelowTarget`
  - `TestPollerFloorDoesNotBlessANullBoundRowSharingAHeightWithALaterAnchor`
  - `TestPollerRepairNeutralizesWhenEveryAnchorIsProvenOrphaned`

**Result: KILLED**

## M4 — the unanchored split collapses into one bucket — every marked row reported as never-bound

**Property under attack:** a row whose binding DANGLES (its round recorded a hash, retention removed it) is reported separately from a row that never recorded one; only the first points an operator at a backup or WAL archive

*Wave 14's M4, re-run. Wave 14 recorded that the never-bound test still passes under it, which is what shows the two populations are genuinely discriminated rather than jointly asserted.*

```diff
--- internal/store/prices.go:1503
-SELECT marked.anchor_block IS NULL AS unbound,
+SELECT TRUE AS unbound,
```
APPLIED at internal/store/prices.go:1503 (1 occurrence, asserted)

```diff
--- internal/store/prices.go:1510
-SELECT count(*) FILTER (WHERE vouched),
+SELECT 0::bigint,
```
APPLIED at internal/store/prices.go:1510 (1 occurrence, asserted)

`go test ./internal/store/ -count=1`

Killed by:
  - `TestARetentionPrunedAnchorIsNeverRecreatedAfterARestart`
  - `TestNeutralizationReportsAnchoredAndUnanchoredMarkingsDistinctly`
  - `TestNeutralizationSplitsAnchoredFromUnanchoredByTheRowsOwnBinding`

**Result: KILLED**

## M7 — unprovableRow drops its chain scoping (a.chain_id = $1)

**Property under attack:** provenance is chain-scoped: another chain's anchor at the same block number vouches for nothing, and 00005 cannot enforce it because chain_id is outside price_poll_anchors' key

*Wave 14's M7, re-run. Wave 14 measured that the ONLY store test failing under it is TestProvenanceReadsAreScopedToTheirOwnChain, which is the whole justification for that fixture existing.*

```diff
--- internal/store/prices.go:1094
-WHERE a.engine = $2 AND a.chain_id = $1 AND a.block_number = p.anchor_block)
+WHERE a.engine = $2 AND a.block_number = p.anchor_block)
```
APPLIED at internal/store/prices.go:1094 (1 occurrence, asserted)

`go test ./internal/store/ -count=1`

Killed by:
  - `TestProvenanceReadsAreScopedToTheirOwnChain`

**Result: KILLED**

## M8 — floorDisposition's none-offered arm reports "admitted"

**Property under attack:** a repair that offered no floor at all says so — the value floorProvenOrphaned, floorNothingAtRisk and the bootstrap all produce, i.e. the one most repairs actually log

*Wave 14's M8, re-run. It initially SURVIVED there; 82dc7ec closed the gap it found.*

```diff
--- internal/prices/poller.go:1870
-return "none-offered", fmt.Sprintf(
+return "admitted", fmt.Sprintf(
```
APPLIED at internal/prices/poller.go:1870 (1 occurrence, asserted)

`go test ./internal/prices/ -count=1`

Killed by:
  - `TestPollerRepairNeutralizesWhenEveryAnchorIsProvenOrphaned`

**Result: KILLED**

## M10 — floorDisposition's below-target arm reports "admitted"

**Property under attack:** a floor the returned boundary rose ABOVE was not admitted at its own height, and saying it was would report canonical readable history as lost

*Round 11P's [medium] #3 asks for exactly this mutation against exactly the new test. Before this wave the arm had no assertion anywhere and the mutation would have survived.*

```diff
--- internal/prices/poller.go:1876
-return "below-target", fmt.Sprintf(
+return "admitted", fmt.Sprintf(
```
APPLIED at internal/prices/poller.go:1876 (1 occurrence, asserted)

`go test ./internal/prices/ -count=1`

Killed by:
  - `TestPollerFloorBelowTheEpochsRepairTargetIsReportedAsBelowTarget`

**Result: KILLED**

## M11 — the neutralization WARN goes back to the blanket retention claim

**Property under attack:** hash-based offline reconciliation is promised only for rows a surviving anchor still vouches for; row-and-value retention is the only unconditional half of D-012 clause 2

*This wave's own text. The retired sentence is restored verbatim, which is the state round 11P's [medium] #2 found.*

```diff
--- internal/prices/poller.go:1806
-THE ROWS AND THEIR VALUES ARE RETAINED FOREVER (clause 2); the recorded BLOCK HASH survives only where the marked row's own round still has an anchor, so hash-based OFFLINE RECONCILIATION IS POSSIBLE FOR THOSE ROWS AND NO OTHERS — clause 2 stops a prune or rewind from expiring such an anchor from now on and cannot bring back one that was already gone. This message does not know the split; the store's own classification WARN counts it (rowsAnchored / rowsUnanchoredBindingPruned / rowsUnanchoredNeverBound)
+Their provenance is retained forever (clause 2), so an offline reconciliation stays possible
```
APPLIED at internal/prices/poller.go:1806 (1 occurrence, asserted)

`go test ./internal/prices/ -count=1`

Killed by:
  - `TestPollerNeutralizationPromisesNoOfflineRecoveryForAPrunedBinding`

**Result: KILLED**

## M12 — the neutralized-backlog WARN goes back to the blanket retention claim

**Property under attack:** the message an operator lives with for as long as the backlog lasts is scoped the same way as the one emitted once at marking time

*The second home of the same sentence. Round 11P named both sites; a fix at one of them only is the citation-drift failure this project has recorded twice.*

```diff
--- internal/prices/poller.go:1981
-The rows and their values are retained forever (clause 2); the recorded block hash survives only where a row's own round still has an anchor, so an offline reconciliation could settle THOSE rows and no others, and none is built.
+Their provenance is retained forever (clause 2), so an offline reconciliation could still settle the anchored ones; none is built.
```
APPLIED at internal/prices/poller.go:1981 (1 occurrence, asserted)

`go test ./internal/prices/ -count=1`

Killed by:
  - `TestPollerNeutralizationPromisesNoOfflineRecoveryForAPrunedBinding`

**Result: KILLED**

## restore verification

`git status --porcelain` over the 2 mutated file(s) is EMPTY: every file is byte-identical to `e3fe3e8`. Restores came from in-memory copies taken before each edit; `git checkout` is never used.

## summary

| # | result | property | killed by |
|---|---|---|---|
| M1 | **KILLED** | the validity boundary an operator reads is the boundary the store RETURNED, never the floor the pass asked for | `TestPollerFloorBelowTheEpochsRepairTargetIsReportedAsBelowTarget`<br>`TestPollerFloorDoesNotBlessANullBoundRowSharingAHeightWithALaterAnchor`<br>`TestPollerRepairNeutralizesWhenEveryAnchorIsProvenOrphaned` |
| M4 | **KILLED** | a row whose binding DANGLES (its round recorded a hash, retention removed it) is reported separately from a row that never recorded one; only the first points an operator at a backup or WAL archive | `TestARetentionPrunedAnchorIsNeverRecreatedAfterARestart`<br>`TestNeutralizationReportsAnchoredAndUnanchoredMarkingsDistinctly`<br>`TestNeutralizationSplitsAnchoredFromUnanchoredByTheRowsOwnBinding` |
| M7 | **KILLED** | provenance is chain-scoped: another chain's anchor at the same block number vouches for nothing, and 00005 cannot enforce it because chain_id is outside price_poll_anchors' key | `TestProvenanceReadsAreScopedToTheirOwnChain` |
| M8 | **KILLED** | a repair that offered no floor at all says so — the value floorProvenOrphaned, floorNothingAtRisk and the bootstrap all produce, i.e. the one most repairs actually log | `TestPollerRepairNeutralizesWhenEveryAnchorIsProvenOrphaned` |
| M10 | **KILLED** | a floor the returned boundary rose ABOVE was not admitted at its own height, and saying it was would report canonical readable history as lost | `TestPollerFloorBelowTheEpochsRepairTargetIsReportedAsBelowTarget` |
| M11 | **KILLED** | hash-based offline reconciliation is promised only for rows a surviving anchor still vouches for; row-and-value retention is the only unconditional half of D-012 clause 2 | `TestPollerNeutralizationPromisesNoOfflineRecoveryForAPrunedBinding` |
| M12 | **KILLED** | the message an operator lives with for as long as the backlog lasts is scoped the same way as the one emitted once at marking time | `TestPollerNeutralizationPromisesNoOfflineRecoveryForAPrunedBinding` |

7 mutants, 7 killed, 0 survived.
