# Codex adversarial review — task 10 round 22 (fork replay test, wave 1)

- **Target:** diff `38b1b46..7f8c42e`, scope `internal/forkreplay/**` + `Makefile` +
  `.env.example` (SDD docs excluded). Detached worktree pinned at `7f8c42e`.
- **Verdict as returned:** `needs-attention` — 1 high, 2 medium.
- **Confirmed sound (the round's own words):** "Opt-in failures, pin-hash comparison,
  selector pinning, and Makefile/env wiring are sound." Neither known-unverified item
  (wrong-hash/pair-guard arms not live-exercised; no -race) independently blocking.
- **Session:** `019fa5f9-6467-7e63-af79-d5548ec50a0e`; job `review-ms3vm0kb-cxsx8v`.

## Findings (verbatim)

### [high] All token comparisons can be vacuous — `fork_replay_test.go:223-278`
The borrower loop permits an empty token union. In that case the token loop executes
zero assertions, the two nil token sets compare equal, and zero can equal the chain
total; tokenAsserts is only logged. This is reachable when SampleDMBorrowers marks
accounts Live using nonzero debt deltas whose asset is empty, because lines 181-184
discard those rows. If those accounts have no chain debt, three borrowers can produce
a PASS with zero token equalities.
**Recommendation:** Require nonempty derived and chain token sets for every selected
Live borrower, cross-check each sampled row's Net against the retained per-asset sums,
and assert a fixed-pin minimum or exact tokenAsserts count.

### [medium] The database under test selects which borrowers are tested — `fork_replay_test.go:155-167`
The fixed-pin sample is whichever Live rows the derived database currently exposes,
sorted and truncated to three. If migration_genesis derivation is missing or an
expected borrower disappears, selection silently shifts to other correct borrowers and
can still pass. Nothing asserts the three fixed-pin account identities or that the
claimed migrated/genesis stratum remains represented.
**Recommendation:** For the default immutable block/hash, pin the expected three
account addresses and their strata. If pin overrides remain supported, require an
explicit expected borrower/stratum fixture with the override.

### [medium] Anvil failure output can expose the fork RPC credential — `fork_replay_test.go:342-379`
The credential-bearing fork URL is passed to Anvil, whose stdout/stderr is captured
and then emitted verbatim on early exit or startup timeout. Anvil's standard fork
banner prints its exact Endpoint, and provider errors may also contain it, so an
honest failure can copy an RPC API key into console, CI, or retained test logs.
**Recommendation:** Run Anvil quietly and sanitize captured output before logging by
replacing the exact fork URL and redacting URL userinfo/query credentials. Add a
regression test using a secret-bearing synthetic URL/output.

## Adjudication (honest-use calibration)

ALL THREE ACCEPTED — each bites an honest operator: (1) is the vacuous-green class
outright; (2) lets a genesis-derivation regression silently swap test subjects while
staying green (vacuous-green shade); (3) an HONEST failure copies an API key into
console/CI/retained logs. Fix pass (wave 1b) dispatched to the wave agent with the
recommendations as the work order: nonempty-set + gating exact tokenAsserts + Net
cross-check; default-pin account/strata constants pinned, override refused without an
explicit expected fixture; sanitize-before-log with userinfo/query redaction + a
secret-bearing synthetic regression. Returns for the D-006 closing review.

## Closing review

- **Target:** `b313772..f74ef23`, `fork_replay_test.go` only. Worktree pinned at `f74ef23`.
- **Verdict: SHIP (approve) — no material findings.** Session
  `019fa60e-7d2c-7ae2-8aae-ebac9fbf8f0d`; job `review-ms3wfnci-jlsimm`.
- Reviewer confirmations: F1 guarantees nonempty DB and chain token sets per borrower,
  cross-checks retained sums against Net, and gates the default fixture at exactly
  three token comparisons; F2 pins all three default accounts and strata and fails
  every partial override; F3 sanitizes all identified fork-output sinks with an
  env-free regression using independent literal expectations. No new material
  vacuous-green, panic, or process-hygiene path; the two disclosed unexercised failure
  arms accepted for this demo-grade opt-in test.
- **TASK 10 TEST HALF CLOSED at f74ef23** (waves 1 + 1b, rounds 22 + closing).
