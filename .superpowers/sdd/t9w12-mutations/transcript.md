# mutation transcript

- spec: `mutations.json`
- repo: `C:\Users\kasel\source\repos\etherfi\Solvent`
- **tested SHA: `d6cb441cf4e665f132cd8b5b96c3a7f6ab16fbaa`**  (test(ingest): wave-12 mutation spec (7 mutants, the consult's M1-M7 schedule, committed before the loop))
- started (UTC): 2026-07-26T22:16:02+00:00
- applier: `mutate.py`, exactly-one-occurrence assertion in `apply_edit`

## M1 — delete the deferred routing advance (the seam's non-landing arm becomes a no-op)

**Property under attack:** Every non-landing Step outcome advances the stream's caller-scoped start past the serving endpoint (the round-2 law: landing is the only outcome that keeps the starting point). Deleting the deferred advance recreates the incident wedge: the same offender is re-resolved forever with a healthy peer idle.

```diff
--- internal/ingest/walker.go:297
-			w.routeNextStepPastNonLanding(servedBy)
+			_ = servedBy // M1: deferred advance deleted
```
APPLIED at internal/ingest/walker.go:297 (1 occurrence, asserted)

`go test ./internal/ingest/ -count=1 -run TestContentFaultAdvancesRoutingAndLandsOnHealthyPeer|TestSilentDiscardSplitAdvancesRoutingAndLandsOnHealthyPeer|TestRetentionKeepsLandingEndpointAndRecoveryIsReprobedWithinOneRotation`

Killed by:
  - `TestContentFaultAdvancesRoutingAndLandsOnHealthyPeer`
  - `TestRetentionKeepsLandingEndpointAndRecoveryIsReprobedWithinOneRotation`
  - `TestSilentDiscardSplitAdvancesRoutingAndLandsOnHealthyPeer`

**Result: KILLED**

## M2 — exempt the tip-changed discard arm from the seam (outcome forced to caught-up before the discard return)

**Property under attack:** The tip-changed discard arm is a NON-LANDING outcome: it advances routing exactly like an error (the W2M5 reversal transposed - wave 2's poller exempted the ambiguous-mismatch arm and round 2 refuted the exemption). Exempting it re-creates the stable-split starvation: the stream discards on the same endpoint forever.

```diff
--- internal/ingest/walker.go:392
-		slog.Warn("tip changed mid-fetch, discarding window",
+		outcome = stepCaughtUp // M2: discard arm exempted from the seam
+		slog.Warn("tip changed mid-fetch, discarding window",
```
APPLIED at internal/ingest/walker.go:392 (1 occurrence, asserted)

`go test ./internal/ingest/ -count=1 -run TestSilentDiscardSplitAdvancesRoutingAndLandsOnHealthyPeer`

Killed by:
  - `TestSilentDiscardSplitAdvancesRoutingAndLandsOnHealthyPeer`

**Result: KILLED**

## M3 — stepWalkers treats a discard round as non-erring (discard reaches bo.success())

**Property under attack:** A discarded window consumes a backoff unit at the daemon: the failure streak grows and step_error is published (F2; round-3 pacing/visibility law). Counting a discard into bo.success() restores the pre-wave silent wedge - backoff reset every round, nothing on the health surface.

*the SEARCH is single-line (CRLF-safe, verified unique in main.go: the price/runner passes phrase their error retention differently); the REPLACE side carries explicit \r\n because main.go is CRLF and the inserted lines should match the file's own endings. `discard` is the errors.As target already in scope at this line.*

```diff
--- cmd/indexer/main.go:689
-roundErred, lastErr = true, err
+if discard == nil { // M3: discards no longer erred
+							roundErred, lastErr = true, err
+						}
```
APPLIED at cmd/indexer/main.go:689 (1 occurrence, asserted)

`go test ./cmd/indexer/ -count=1 -run TestStepWalkersDiscardRoundsGrowTheFailureStreak|TestStepWalkersMixedDiscardErrorPostureNeverResetsPacingOrVisibility`

Killed by:
  - `TestStepWalkersDiscardRoundsGrowTheFailureStreak`
  - `TestStepWalkersMixedDiscardErrorPostureNeverResetsPacingOrVisibility`

**Result: KILLED**

## M4 — drop token equality (coherent() accepts every serving endpoint)

**Property under attack:** Token equality is required on EVERY pinned read after the serving-endpoint resolution: window pieces served by another endpoint are a coherence discard and never reach SaveBatch. Dropping the gate silently re-joins two chain views into one window - the incident-night assembly, with no content arm able to see it.

```diff
--- internal/ingest/walker.go:198
-	if tok.Index == servedBy.Index {
+	if true { // M4: token-equality dropped
```
APPLIED at internal/ingest/walker.go:198 (1 occurrence, asserted)

`go test ./internal/ingest/ -count=1 -run TestCrossEndpointWindowPiecesAreDiscardedNotSaved`

Killed by:
  - `TestCrossEndpointWindowPiecesAreDiscardedNotSaved`

**Result: KILLED**

## M5 — the advance defers to the shared hint instead of the caller-scoped next index

**Property under attack:** The non-landing advance is CALLER-SCOPED, never the shared hint: a walker that routes its advance through ActiveEndpoint() is a shared-hint implementation, and a sibling's legitimate landing on the offender re-pins it there within one round (the Task 7 gate counter-schedule, transposed as R3). The consult's M5 ('write the shared hint on non-landing') is realized in its compilable form: the walker HAS no hint-write surface - structurally, by interface - so the shared-hint implementation under attack is the read-through.

```diff
--- internal/ingest/walker.go:234
-	w.startPref = next
+	w.startPref = w.chain.ActiveEndpoint() // M5: the advance defers to the shared hint
```
APPLIED at internal/ingest/walker.go:234 (1 occurrence, asserted)

`go test ./internal/ingest/ -count=1 -run TestSiblingLandingOnOffenderDoesNotDragThisStreamBack`

Killed by:
  - `TestSiblingLandingOnOffenderDoesNotDragThisStreamBack`

**Result: KILLED**

## M6 — reset startPref to the shared hint on landing

**Property under attack:** RETENTION, NOT RESET: landing sets startPref to the endpoint that landed and never resets it to follow the shared hint - resetting recreates the A-bounce (hint re-pinned at the offender drags the stream back every other Step; the poller needed d1e7d54's bounded lease to escape exactly this).

```diff
--- internal/ingest/walker.go:293
-			w.startPref = servedBy.Index
+			w.startPref = -1 // M6: retention dropped - landing resets to follow the shared hint
```
APPLIED at internal/ingest/walker.go:293 (1 occurrence, asserted)

`go test ./internal/ingest/ -count=1 -run TestRetentionKeepsLandingEndpointAndRecoveryIsReprobedWithinOneRotation`

Killed by:
  - `TestRetentionKeepsLandingEndpointAndRecoveryIsReprobedWithinOneRotation`

**Result: KILLED**

## M7 — remove the tip-log validation arm

**Property under attack:** The tip-log-vs-anchored-tip validation arm is LOAD-BEARING CUSTODY, not just a rotation trigger: with the window pinned to one endpoint it is a same-witness contradiction, and removing it saves a window whose tip log sits on a fork the cursor anchor never described (R1's custody assertion: the validation, not just the routing).

```diff
--- internal/ingest/walker.go:456
-		if l.BlockNumber == to && l.BlockHash != tipBefore {
+		if false { // M7: tip-log-vs-anchored-tip arm removed
```
APPLIED at internal/ingest/walker.go:456 (1 occurrence, asserted)

`go test ./internal/ingest/ -count=1 -run TestContentFaultAdvancesRoutingAndLandsOnHealthyPeer`

Killed by:
  - `TestContentFaultAdvancesRoutingAndLandsOnHealthyPeer`

**Result: KILLED**

## restore verification

`git status --porcelain` over the 2 mutated file(s) is EMPTY: every file is byte-identical to `d6cb441`. Restores came from in-memory copies taken before each edit; `git checkout` is never used.

## summary

| # | result | property | killed by |
|---|---|---|---|
| M1 | **KILLED** | Every non-landing Step outcome advances the stream's caller-scoped start past the serving endpoint (the round-2 law: landing is the only outcome that keeps the starting point). Deleting the deferred advance recreates the incident wedge: the same offender is re-resolved forever with a healthy peer idle. | `TestContentFaultAdvancesRoutingAndLandsOnHealthyPeer`<br>`TestRetentionKeepsLandingEndpointAndRecoveryIsReprobedWithinOneRotation`<br>`TestSilentDiscardSplitAdvancesRoutingAndLandsOnHealthyPeer` |
| M2 | **KILLED** | The tip-changed discard arm is a NON-LANDING outcome: it advances routing exactly like an error (the W2M5 reversal transposed - wave 2's poller exempted the ambiguous-mismatch arm and round 2 refuted the exemption). Exempting it re-creates the stable-split starvation: the stream discards on the same endpoint forever. | `TestSilentDiscardSplitAdvancesRoutingAndLandsOnHealthyPeer` |
| M3 | **KILLED** | A discarded window consumes a backoff unit at the daemon: the failure streak grows and step_error is published (F2; round-3 pacing/visibility law). Counting a discard into bo.success() restores the pre-wave silent wedge - backoff reset every round, nothing on the health surface. | `TestStepWalkersDiscardRoundsGrowTheFailureStreak`<br>`TestStepWalkersMixedDiscardErrorPostureNeverResetsPacingOrVisibility` |
| M4 | **KILLED** | Token equality is required on EVERY pinned read after the serving-endpoint resolution: window pieces served by another endpoint are a coherence discard and never reach SaveBatch. Dropping the gate silently re-joins two chain views into one window - the incident-night assembly, with no content arm able to see it. | `TestCrossEndpointWindowPiecesAreDiscardedNotSaved` |
| M5 | **KILLED** | The non-landing advance is CALLER-SCOPED, never the shared hint: a walker that routes its advance through ActiveEndpoint() is a shared-hint implementation, and a sibling's legitimate landing on the offender re-pins it there within one round (the Task 7 gate counter-schedule, transposed as R3). The consult's M5 ('write the shared hint on non-landing') is realized in its compilable form: the walker HAS no hint-write surface - structurally, by interface - so the shared-hint implementation under attack is the read-through. | `TestSiblingLandingOnOffenderDoesNotDragThisStreamBack` |
| M6 | **KILLED** | RETENTION, NOT RESET: landing sets startPref to the endpoint that landed and never resets it to follow the shared hint - resetting recreates the A-bounce (hint re-pinned at the offender drags the stream back every other Step; the poller needed d1e7d54's bounded lease to escape exactly this). | `TestRetentionKeepsLandingEndpointAndRecoveryIsReprobedWithinOneRotation` |
| M7 | **KILLED** | The tip-log-vs-anchored-tip validation arm is LOAD-BEARING CUSTODY, not just a rotation trigger: with the window pinned to one endpoint it is a same-witness contradiction, and removing it saves a window whose tip log sits on a fork the cursor anchor never described (R1's custody assertion: the validation, not just the routing). | `TestContentFaultAdvancesRoutingAndLandsOnHealthyPeer` |

7 mutants, 7 killed, 0 survived.
