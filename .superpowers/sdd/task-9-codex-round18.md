# Codex adversarial review — task 9 wave 18 (round 18, ingest CLOSING round)

- **Target:** detached `7e58317` (reused the prior attempt's correctly-pinned `C:/wt18`,
  verified clean; interval `7e58317..e3a14aa` verified docs-only so the pin stands
  against origin's advance), range `0a4f21c..7e58317` restricted to
  `internal/ingest/**` (verified: exactly walker.go + walker_probe_discipline_test.go).
- **Verdict:** **APPROVE — SHIP, ZERO MATERIAL FINDINGS.**
- **Job:** `review-ms2urk96-e4thos`; Codex session `019fa249-0fdf-7590-9e46-3b6109fbf604`;
  broker PID 5656 verified by `--cwd` and killed; `C:/wt18` pruned. A stale wedged job
  (`review-ms2t0mbr-j8at9w`, pid dead) from the pre-teardown dispatch attempt was found
  in the same state dir and left untouched — the corpse corroborates the handoff record.

## Verdict (verbatim)

> SHIP — zero material findings. The unconditional probing guard dominates the sole
> rewind call path for every candidate count and outcome. The regression pins the
> complete round-17 fall-through scenario and deferred non-probe rewind. W18M1 and its
> transcript are consistent, while prior invariant tests are unchanged except for the
> additive regression. Local rerun was blocked only because the read-only sandbox
> denied Go's temporary build directory.

Reviewer trace note: it held `needs-attention` while independently tracing the Step
state machine, the regression's assertions, the mutation evidence, and n≥3 behavior,
and converged on `approve` after reconciling the transcript against actual test
behavior — an earned zero, not a rubber stamp.

## THE INGEST REOPEN IS CLOSED

Waves 12 → 14 → 17 → 18; rounds 12 → 15 → 17 → 18; trend 1H → 2H2M1L → 1M(-from-the-
disclosure-list) → **0**. The arc: per-endpoint fake + startPref seam + discard-streak
composition (12), bounded retention lease (14), probe outcome discipline + Σ-attempts
per-witness measurement + target cycling + rewind-authority refusal per the
chain-truth consult (17), and the unqualified probe-never-rewinds guard (18). Standing
non-claims carried, all recorded: F4 frozen-incumbent, F3 rewind corroboration (its
own future decision), the daemon-side caught-up-probe round-end pathology, the
store-latency observer.

With round 4 (poller anchor stack) and round 9 (chain hash law) previously closed,
**every ingest-side surface of Task 9 is now senior-approved.** Sole remaining review
surface: reconcile (wave 19 in flight → its closing round).
