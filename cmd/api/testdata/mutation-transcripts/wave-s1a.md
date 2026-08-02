# Mutation transcript — wave S1a (contract 1.4.0: GET /v1/scenarios)

Durable mutation evidence for the committed-scenario listing. ONE designed
mutant, cut BEFORE the loop, aimed at the single failure this wave's weld
exists to forbid: a SECOND serializer for one committed definition. The whole
point of the route is that the listing and the stress response's `scenarios`
array are the same bytes minus `results`; the moment they are produced by two
pieces of code, that claim becomes a promise instead of a property. Follows
`wave-wuxa.md`.

## Tested tree

- Branch `main`, HEAD `016cc31`, PLUS this wave's uncommitted S1a files
  (`api/openapi.yaml` 1.4.0, `cmd/api/scenarios.go`, the `wireScenarioDef`
  split in `cmd/api/handlers.go`, the route in `cmd/api/main.go`, the route
  census in `cmd/api/middleware.go`, `cmd/api/scenarios_test.go`,
  `cmd/api/scenarios_db_test.go`, the regenerated `packages/client-ts`).
  NOTE: the only other things in the tree are untracked `*.log` files from
  earlier acceptance runs, disjoint from every file below. `web/**` is
  untouched by this wave.
- Fixed-file sha256 (the before-hash AND the after-restore hash — the restore
  was verified byte-identical):
  - `cmd/api/scenarios.go`
    `6fb4d6f086a2e0c5c6f8dd857a9ead09fc53bee953faa85be75532ea49b93bae`
- Kill-suite command (live scratch DB, `TEST_DATABASE_URL` → `solvent_test`,
  env sourced from `.env`, serialized per the house discipline):
  - M1: `go test ./cmd/api/ -count=1 -run 'TestScenarioListingWeldsToTheStressScenarioArray|TestScenarioListingReusesTheStressSerializerByConstruction'`

## The designed mutant (spec cut BEFORE the loop)

### M1 — the listing serializer, hand-forked from the stress one

Spec: `handleScenarios` stops serving `wireScenarioDef` / `scenarioDefinition`
and serves its own `listingScenario` type built by its own
`listingDefinition` — a copy-paste fork with the same field names and the same
JSON tags, whose shock loop drops `Asset: sh.Asset`. That is the omission a
real fork makes: `asset` is `omitempty` and only three of the twelve committed
scenarios carry it (`btc_leg_minus_20`, `ethfi_minus_50`,
`weeth_market_depeg_oracles_held`), so nine entries stay byte-identical and
the response still validates against the contract — `asset` is an optional
property. The lie is precise and expensive: an `asset_usd` scenario listed
with a targetless shock reads as "shocks the whole asset_usd axis" when the
committed definition shocks exactly one asset key, so a Lab grouping the loss
frontier by axis instance would put the BTC leg and the ETHFI leg in one
bucket.

Kill expected from BOTH arms of the weld, and the two arms are expected to
fail for DIFFERENT reasons — the wire arm on values, the construction arm on
type identity:

- `TestScenarioListingWeldsToTheStressScenarioArray` (live DB): the listing
  entry is no longer the stress entry minus `results`.
- `TestScenarioListingReusesTheStressSerializerByConstruction` (pure): the
  listing response's element type is no longer the type the stress element
  embeds.

Explicitly NOT expected to kill (and this is the honest scope of each test,
not a gap):

- `TestScenariosServesTheCommittedSetWithNoBatchAtAll` — the cold-start law.
  A forked serializer still answers 200 cold with twelve entries, and it
  should: that test owns servability, not agreement.
- `TestScenariosContractExampleIsByteFaithful` /
  `TestContractScenarioDefinitionIsTheStressScenarioMinusResults` — the
  example and the contract-schema welds exercise `scenarioDefinition` and the
  YAML directly, which the mutant leaves untouched.

---

## M1 — RESULT

Mutated-file sha256:
`40259f4f8f44c0fee6af05484167632913df1d2fee75ba2a6cbb9a2ac39d7725`

```diff
+// MUTANT M1 (wave S1a): the listing serializer, hand-forked from the stress
+// one. Same field names, same tags — and the shock loop drops `asset`.
+type listingScenario struct {
+	ID             string      `json:"id"`
+	Version        string      `json:"version"`
+	Label          string      `json:"label"`
+	Description    string      `json:"description"`
+	PathAssumption string      `json:"path_assumption"`
+	Engines        []string    `json:"engines"`
+	Shocks         []wireShock `json:"shocks"`
+	OutOfModel     []string    `json:"out_of_model"`
+}
+
+func listingDefinition(sc risk.Scenario) listingScenario {
+	out := listingScenario{ /* … same field-by-field copy … */ }
+	for _, sh := range sc.Shocks {
+		out.Shocks = append(out.Shocks, wireShock{
+			Axis:      string(sh.Axis),
+			FactorNum: sh.FactorNum,
+			FactorDen: sh.FactorDen,
+		})
+	}
+	return out
+}
+
 type scenariosResponse struct {
 	ServedAt              time.Time         `json:"served_at"`
 	ScenarioConfigVersion string            `json:"scenario_config_version"`
-	Scenarios             []wireScenarioDef `json:"scenarios"`
+	Scenarios             []listingScenario `json:"scenarios"`
 	Notes                 []string          `json:"notes"`
 }
@@ handleScenarios
-		Scenarios: []wireScenarioDef{},
+		Scenarios: []listingScenario{},
 	}
 	for _, sc := range s.scenarios {
-		out.Scenarios = append(out.Scenarios, scenarioDefinition(sc))
+		out.Scenarios = append(out.Scenarios, listingDefinition(sc))
 	}
```

KILLED (exit 1), both arms:

```
--- FAIL: TestScenarioListingWeldsToTheStressScenarioArray (0.30s)
    Error Trace: scenarios_db_test.go:147
    Error:       Not equal:
      Diff:
      --- Expected
      +++ Actual
      @@ -19,4 +19,3 @@
        (string) (len=6) "shocks": ([]interface {}) (len=1) {
      -  (map[string]interface {}) (len=4) {
      -   (string) (len=5) "asset": (string) (len=42) "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599",
      +  (map[string]interface {}) (len=3) {
          (string) (len=4) "axis": (string) (len=9) "asset_usd",
    Messages: scenario "btc_leg_minus_20": the listing entry must BE the stress
              entry minus `results`, field for field — two serializers for one
              committed definition is a drift waiting to happen

--- FAIL: TestScenarioListingReusesTheStressSerializerByConstruction (0.00s)
    Error Trace: scenarios_test.go:47
    Error:       Not equal:
                 expected: &reflect.rtype{… Hash:0xb86ef0c4 …}   ([]wireScenarioDef)
                 actual  : &reflect.rtype{… Hash:0x70c12e81 …}   ([]listingScenario)
    Messages: the listing must serve the SAME type the stress element embeds
```

The wire arm names the first scenario whose definition the fork corrupted
(`btc_leg_minus_20`, the alphabetically first of the three asset-targeted
scenarios); the construction arm fails on type identity alone, without a
database, before any value is compared — which is the property that makes the
fork impossible to land quietly.

Restore verified byte-identical
(`6fb4d6f086a2e0c5c6f8dd857a9ead09fc53bee953faa85be75532ea49b93bae`), and the
two kill-suite tests are green again on the restored tree.

## Verdict

1/1 designed mutant KILLED by two independent arms (wire values, and type
identity), zero survivors, restore verified byte-identical by sha256.
`go build ./...` green after the restore; the full serialized
`go test -p 1 ./cmd/api/... -count=1` run and the client's `npm run verify`
are recorded in the wave report.
