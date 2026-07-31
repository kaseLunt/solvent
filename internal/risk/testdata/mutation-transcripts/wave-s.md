# Mutation transcript — Wave S (scenario claim/matrix authoring)

Durable mutation evidence for the Wave-S claim surface (`internal/risk/
scenarios/*.json`, the additive `base_asset` schema field in `scenario.go`,
and the pinned-fixture welds in `scenario_claims_test.go` /
`testdata/tokenconfig_accept_r4.json`). Follows the in-package durable
convention started by `internal/store/testdata/mutation-transcripts/`.

Wave S NEVER COMMITS (wave brief hard rule), so "spec before the loop" is
recorded by FILE ORDER inside this transcript: the three mutant specs below
were written to this file, in full, BEFORE any mutant was applied; the
KILLED/SURVIVED results were appended afterwards. Committing is the
integrator's.

## Tested tree

- Branch `main`, HEAD `846c241`, PLUS this wave's uncommitted files AND the
  parallel harness wave's uncommitted `cmd/reconcile` files (which do NOT
  compile mid-flight — `dm_gate.go` references a verdict constant not yet
  landed — so the kill suites are scoped to `./internal/risk`, this wave's
  zone, which builds and vets clean on its own).
- Fixed-file sha256 (before-hash AND after-restore hash for every mutant —
  every restore verified byte-identical):
  - `scenarios/eth_minus_10.json`
    `b5c7d6e7dff99fc9860a3b08928449f7090833bde6cf5bcf0768902c5664e20d`
  - `scenarios/dm_composition_census.json`
    `6470f8523a0149aa35a93e99ae2242234d4f574ffc473d86c94847658c37135e`
  - `scenarios/stable_depeg_098_unsnapped.json`
    `46428ee05047a509699b7f84d80014f731d8637d64fbc67c8ad1146e6fcae327`
  - `scenario.go` (never mutated; recorded because the claim law lives here)
    `a57b9449e483bc4723d659014f743dbdcc0bf41ba603ac00799e3a0f82b47e54`
- Kill-suite commands (no DB, no network — the welds are fixture-captured):
  - M1: `go test ./internal/risk -run 'TestScenarioBaseClaims|TestEveryConfiguredAsset|TestScenarioStableSnapSet' -count=1`
  - M2: `go test ./internal/risk -run 'TestEveryConfiguredAsset|TestScenarioBaseClaims|TestLiquidReserveTwins' -count=1`
  - M3 (both variants): `go test ./internal/risk -run 'TestScenarioStableSnapSet|TestScenarioBaseClaims' -count=1`

## Specs (written BEFORE the loop)

### M1 — a composition claim reverted to USD-terminal

Delete the line `"base_asset": "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE",`
from the OP weETH propagation row of `eth_minus_10.json` ONLY — the exact
regression the accept-r4 gate caught (the model asserting USD-terminal while
`tokenConfig(weETH).baseAsset` names the native-ETH sentinel), reintroduced in
one file while three others (eth_minus_20/30, weeth_rate_minus_5) still carry
the corrected claim.

Expected kill: `committedClaims` must refuse the CROSS-FILE CONFLICT (weETH
claimed both terminal and sentinel-based), so every claims-consuming test
fails before the weld is even reached; the weld test would also kill it
standalone (claim base != fixture base).

### M2 — a claim deleted outright

Remove BOTH the OP (`0x4200…0042`) shock AND its propagation row from
`dm_composition_census.json` — the complete deletion of the
claim-and-decision record, cut so the scenario still VALIDATES (removing only
the row would be killed trivially by the loader's silent-no-op refusal; this
sharper cut leaves a loadable set whose coverage has silently shrunk, the
exact absent-claim-by-omission defect the adjudication named).

Expected kill: `TestEveryConfiguredAssetCarriesAClaimAndNoClaimIsStale`
(OP configured at the pin, no claim) and
`TestScenarioBaseClaimsWeldAgainstThePinnedTokenConfig` (no claim row for a
fixture asset).

### M3 — snap-set membership flipped, both directions

- M3a: delete `"stable_snap": true,` from the frxUSD row of
  `stable_depeg_098_unsnapped.json` ONLY (the other two stable files still
  claim it). Expected kill: cross-file CONFLICT in `committedClaims` —
  a membership flip in ONE file is a conflict before it is a set change.
- M3b: add `"stable_snap": true,` to the eUSD row of
  `dm_composition_census.json` (single-file flip, so NO conflict — the pure
  snap-set weld must do the killing). Expected kill:
  `TestScenarioStableSnapSetDerivesFromClaims` in both of its assertions
  (derived set != chain isStableToken set at the pin; eUSD explicitly must
  not snap) and the per-asset stable-flag weld.

## Results (appended AFTER the loop)

All mutants were applied with in-memory string surgery (asserted-unique
needles), restored the same way, and every restore was verified byte-identical
against the before-hashes above. `go test ./internal/risk/... -p 1 -count=1`
was re-run green after the final restore (`ok  …internal/risk  5.719s`).

### M1 — KILLED (cross-file conflict, exactly as spec'd)

Mutated `scenarios/eth_minus_10.json` sha256:
`47853f3cb1a53646241023d7f35967243b1701e9ea2dd46fe70c49e4af31a058`

Every claims-consuming test failed at `committedClaims` — the derivation
refused the two-faced claim BY NAME before any weld ran:

```
--- FAIL: TestEveryConfiguredAssetCarriesAClaimAndNoClaimIsStale
    Error: scenario definitions CONFLICT on 0x5A7fACB970D094B6C7FF1df0eA68D99E6e73CBFF:
      eth_minus_10 claims base 0x0000000000000000000000000000000000000000 (stable false)
      and eth_minus_20 claims base 0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE (stable false)
    Messages: the committed set must be conflict-free
--- FAIL: TestScenarioStableSnapSetDerivesFromClaims  (same conflict)
```

Restore verified: sha256 back to `b5c7d6e7…64e20d`.

### M1b — the SHARPER variant, cut because M1's kill never reached the weld

The conflict kill proves cross-file consistency but not that the FIXTURE WELD
carries its own weight, so the same one-line deletion was applied to ALL FOUR
weETH rows (eth_minus_10/20/30 + weeth_rate_minus_5) — a consistent, loadable,
conflict-free set that simply claims the pre-fix composition. Only the pinned
fixture can kill this one.

Mutated-file sha256:
- `eth_minus_10.json` `47853f3c…af31a058` (same cut as M1)
- `eth_minus_20.json` `cf191f57a7523ef13de7b2c83bcdb8c2d3d6baff7d40ffa2705d529212bda55b`
- `eth_minus_30.json` `b377247268548bf354285ceb6b4a54a2ff25f14e94ac926b0741b922f2e3fd83`
- `weeth_rate_minus_5.json` `7702d2da4fbad7372bcaf7cac34149cfffa885a66db0fa34275fb00dc028195a`

KILLED (exit 1) by `TestScenarioBaseClaimsWeldAgainstThePinnedTokenConfig`,
naming the pin — the exact accept-r4 finding, now permanent:

```
--- FAIL: TestScenarioBaseClaimsWeldAgainstThePinnedTokenConfig
    - 00000000  ee ee ee ee … (expected: the native-ETH sentinel)
    + 00000000  00 00 00 00 … (actual: the reverted USD-terminal claim)
    Messages: weETH 0x5A7fACB970D094B6C7FF1df0eA68D99E6e73CBFF: the scenario
      claim's base (from eth_minus_10) must equal tokenConfig.baseAsset at pin
      154938071 0xaf91dd4ba1975fc3b93e411586ce267892406ed8cb7152c5cefe1c368696c6bc
      — the base-composition equality IS the lens-composition class closure (risk-quant R4.2)
```

Restores verified: all four back to `b5c7d6e7…`, `05a48d90…`, `229faa80…`,
`d7e32fa8…` (the pre-mutation hashes; 20/30/rate pre-hashes were captured
immediately before the cut).

### M2 — KILLED (coverage regression, both named tests)

Mutated `scenarios/dm_composition_census.json` sha256:
`3169b80795761085e63f70e8c93da6664678f1aebda811ea2f6490e8f6fd2ff5`

The set LOADED cleanly (the sharper cut removed shock AND row, so the
silent-no-op refusal could not save it) and the coverage weld did the killing:

```
--- FAIL: TestScenarioBaseClaimsWeldAgainstThePinnedTokenConfig
    Messages: OP 0x4200000000000000000000000000000000000042 is configured at
      the pin but carries NO scenario claim — a stress run would hold it flat
      by omission (oracle-sentinel R4)
--- FAIL: TestEveryConfiguredAssetCarriesAClaimAndNoClaimIsStale
    Error: Should be empty, but was [OP 0x4200000000000000000000000000000000000042]
    Messages: configured at the accept-r4 pin with NO scenario claim: the
      adjudicated principle is explicit-claim-or-explicit-decision, never omission
```

Restore verified: sha256 back to `6470f852…c37135e`.

### M3a — KILLED (single-file membership flip is a CONFLICT first)

Mutated `scenarios/stable_depeg_098_unsnapped.json` sha256:
`835d05828feaaa487c49decfcd83f044823ada8ab2d849e15bfc3d53d1de088a`

```
--- FAIL: TestScenarioStableSnapSetDerivesFromClaims
    Error: scenario definitions CONFLICT on 0x80Eede496655FB9047dd39d9f418d5483ED600df:
      stable_depeg_098_unsnapped claims base 0x0…0 (stable false)
      and stable_depeg_0995_in_band claims base 0x0…0 (stable true)
    Messages: the committed set must be conflict-free
```

Restore verified: sha256 back to `46428ee0…fcae327`.

### M3b — KILLED (the pure snap-set weld; no conflict to hide behind)

`"stable_snap": true` added to the census eUSD row (single-file flip, so the
derivation stays conflict-free). Mutated `dm_composition_census.json` sha256:
`413535a68e11ea364179a69d837e05aa0c5b99c7678966a02a8f3fb463c3f99a`

KILLED (exit 1) by `TestScenarioStableSnapSetDerivesFromClaims` — the derived
set grew to 4 while the chain's isStableToken set at the pin has 3:

```
--- FAIL: TestScenarioStableSnapSetDerivesFromClaims
    -(map[common.Address]bool) (len=3) {
    +(map[common.Address]bool) (len=4) {
    +  00000000  93 97 78 d8 3b 46 b4 56 … (eUSD 0x939778…) : true
    Messages: snap-set equality, both directions: an unexpected stable is a
      snap the model does not apply; a missing one is a snap it invents (risk-quant R4.1)
```

(the per-asset stable-flag weld in TestScenarioBaseClaimsWeldAgainstThePinned
TokenConfig kills the same mutant independently.)

Restore verified: sha256 back to `6470f852…c37135e`.
