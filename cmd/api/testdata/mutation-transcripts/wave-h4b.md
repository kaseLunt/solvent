# Mutation transcript — Wave H4b (the serving-surface train)

Durable mutation evidence for the 1.2.1 contract fix (AddressHistoryPoint
gains the REQUIRED per-point sweep watermark), the wireHistoryPoint change
(`cmd/api/p5_history.go`) and THE EXHAUSTIVE liquidatable-disclosure law
(`cmd/api/contract_sweep_law_test.go`). Two behavioural mutants, each designed
BEFORE the loop (this spec section was written and hashed before any mutant
was applied; committing is outside this wave's mandate — IMPLEMENT AND TEST,
NEVER COMMIT — so the before-hash discipline substitutes for the
spec-committed-first step). Follows `p5-c2.md`.

## Tested tree

- Branch `main`, HEAD `55d6f5a`, PLUS this wave's uncommitted H4b files
  (api/openapi.yaml 1.2.1, the regenerated client, p5_history.go,
  contract_sweep_law_test.go, p5_sweepproof_db_test.go, the extended history
  suite, the web history surface). NOTE: the tree concurrently carries the
  PARALLEL wave H4a's uncommitted work in `cmd/reconcile/**` (disjoint from
  every file below).
- Fixed-file sha256 (the before-hash AND the after-restore hash for every
  mutant below):
  - `p5_history.go`
    `7e25122d918734307b74f451a1125aeb41d816ed280c1f32ca4f8c4857e2400b`
  - `contract_sweep_law_test.go`
    `efdcdd3948bd2e2c44d35e92a6568ea71ce447aee33b3818d0226f7992f78d3e`
- Kill-suite commands (live scratch DB, `.env` sourced, serialized per the
  house discipline):
  - M1: `go test ./cmd/api -run 'TestAddressHistoryServesPersistedPointsNewestFirst|TestEveryComputedDMRowServesANonzeroSweepWatermark' -p 1 -count=1`
  - M2: `go test ./cmd/api -run 'TestLiquidatableDisclosureLaw' -p 1 -count=1`

## M1 — the watermark dropped from wireHistoryPoint (spec, designed before the loop)

Spec (behavioural, cut after green): wireHistoryPoint loses its SweepBlock
field and assignment while the 1.2.1 contract still REQUIRES `sweep_block` on
every AddressHistoryPoint — the serving layer quietly reverts to the 1.2.0
wire, the exact Codex HIGH. Expected kill: the per-request contract
validation inside `getJSON` (required property missing) and/or the
strip-proof's own extraction — the brief demands an HONEST determination of
which fires, recorded below.

## M2 — the mechanical sweep narrowed to a hand-list (spec, designed before the loop)

Spec: `sweepState.walk` records a violation ONLY when the carrying schema's
name is in a hardcoded inventory of today's ten known liquidatable-carrying
schemas — the plausible "optimization" that keeps the standing-gap pin,
the Codex-finding regression AND the whole-contract sweep green (every name
they touch is in the list). The lie is precisely the future: a NEW schema
carrying a bare boolean is invisible to an inventory. Expected kill: the
injected-fixture control `TestLiquidatableDisclosureLawCatchesABareBoolean`
(`BareVerdictFixture` is in no inventory), and ONLY that control — proving
the anti-vacuity fixture is load-bearing, exactly Codex's m2 design.

---

## M1 — RESULT

Mutated-file sha256 (`p5_history.go`):
`0e3a1d2200b9bf2c627ba92e0618ae2f8181039afc4d55d81eeefb87da33f7c3`

```diff
-	SweepBlock   uint64            `json:"sweep_block"`
-	Status       string            `json:"status"`
+	// MUTANT M1: the watermark dropped — the 1.2.0 wire quietly served
+	// while the contract requires the per-point sweep clock.
+	Status       string            `json:"status"`
 ...
-			SweepBlock:    uint64(p.SweepBlock),
 			Status:        p.Status,
```

KILLED (exit 1) — BOTH tests failed, and the HONEST determination the brief
demanded: **contract validation fires in each** — every wire read goes
through `getJSON` → `validateContract` (fixture_db_test.go:559) BEFORE any
field assertion runs, so the kill line names the schema, not the extractor:

```
--- FAIL: TestAddressHistoryServesPersistedPointsNewestFirst (0.60s)
    Error at "/engines/0/points/0/sweep_block": property "sweep_block" is missing
    Error at "/engines/0/points/1/sweep_block": property "sweep_block" is missing
    Messages: response for /v1/address/{addr}/history violates api/openapi.yaml: …
--- FAIL: TestEveryComputedDMRowServesANonzeroSweepWatermark (0.44s)
    --- FAIL: TestEveryComputedDMRowServesANonzeroSweepWatermark/address_history (0.01s)
        Error at "/engines/1/points/0/sweep_block": property "sweep_block" is missing
```

The strip-proof's positions_page and address_detail subtests PASSED under
this mutant — they do not route through wireHistoryPoint, which is the
per-surface parameterization doing its job. The strip-proof's own NONZERO
assertion is the second line of defense for this mutant shape, and the FIRST
line for the sibling shape no schema can see (a ZERO served for a swept
account — 0 is the contract-legal "never swept" disclosure); that is why
both the contract law and the strip-proof exist.

Restore verified byte-identical (`7e25122d…`); kill suite green after restore
(`ok github.com/kaselunt/solvent/cmd/api 2.752s`).

## M2 — RESULT

Mutated-file sha256 (`contract_sweep_law_test.go`):
`5ec5659b390491dd128fb4ebc62d3cf4c25e2a8a778b63284f3f1b529d8b1a3c`

```diff
+// MUTANT M2: the mechanical sweep narrowed to a hand-list of today's known
+// carriers — the "optimization" that can never find a schema nobody listed.
+var knownLiquidatableCarriers = map[string]bool{
+	"Aggregate": true, "Position": true, "StressState": true,
+	"ProjectionHorizon": true, "LiquidationPrice": true,
+	"PositionSummary": true, "AddressHistoryPoint": true,
+	"DegradationEngine": true, "ObservatorySeriesPoint": true,
+	"BatchAggregate": true,
+}
 ...
-		if liquidatableFamily(propName) && !licensed {
+		if liquidatableFamily(propName) && !licensed && knownLiquidatableCarriers[name] {
```

As designed, the whole-contract sweep, the standing-gap pin and the
Codex-finding regression ALL STAYED GREEN under the mutant (every schema they
exercise is in the hand-list) — the mutant is invisible to everything except
the control. KILLED (exit 1) by the injected-fixture control alone:

```
--- PASS: TestLiquidatableDisclosureLawSweepsTheWholeContract (0.04s)
--- FAIL: TestLiquidatableDisclosureLawCatchesABareBoolean (0.05s)
    Error Trace: contract_sweep_law_test.go:426
    Error:       Expected value not to be nil.
    Messages:    the sweep did NOT flag a synthetic re-clocked schema carrying
                 a bare boolean under a batch-bearing response — the mechanical
                 walk has been narrowed to an inventory
--- PASS: TestLiquidatableDisclosureLawDerivesTheCodexFinding (0.03s)
```

Restore verified byte-identical (`efdcdd39…`); kill suite green after restore
(`ok github.com/kaselunt/solvent/cmd/api 1.643s`).

## Verdict

2/2 designed mutants KILLED, zero survivors, every restore verified
byte-identical by sha256. `go build ./...`, `go vet ./cmd/api/...` and the
full `go test ./cmd/api -p 1 -count=1` run are green after the final restore
(recorded in the wave report).
