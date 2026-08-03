// Whole-book scenario-dashboard (W-SD-A) fixture generation + THE PROVENANCE
// RECORD. Regenerate with:
//
//   node tests/fixtures/generate-lab-book.mjs        (from web/)
//
// Sibling waves each own their generator. This one writes ONLY the files
// listed below; `generate.mjs` owns the address-mode lab fixtures and
// `generate-book.mjs` owns the Book surface's. Every fixture here is GENERATED
// from committed contract artifacts — never hand-shaped wire data. The
// sanctioned sources, per file:
//
//  1. scenarios.json — `GET /v1/scenarios`.
//     Envelope (`served_at`, `scenario_config_version`, `notes`) extracted
//     VERBATIM from `api/openapi.yaml`'s own 200 example. `scenarios[]` is
//     the contract's OWN stated derivation applied mechanically:
//     `ScenarioDefinition` ≡ `Omit<Scenario, "results">` — welded at compile
//     time in `packages/client-ts/test/scenarios.test.ts` — so the committed
//     definitions are taken from the contract-validated `stress-aave.json`'s
//     `scenarios[]` with the per-address `results` key DELETED, in wire order,
//     then extended with any definition the openapi example carries that the
//     excerpt does not (deduped by id, example order). Nothing is invented and
//     no field is edited.
//
//  2. run-book.eth_minus_30.json — `POST /v1/scenarios/eth_minus_30/run-book`.
//     The contract's own run-book 200 example (already extracted verbatim by
//     `generate.mjs` into run-book.weeth_market_depeg_oracles_held.json) as
//     the ENVELOPE, RE-IDENTIFIED to the eth_minus_30 committed definition:
//     `scenario_id` / `scenario_version` / `label` / `description` /
//     `path_assumption` / `shocks` / `out_of_model` copied byte-identically
//     from that definition, and `applied_shocks` composed from the SAME
//     scenario's own validated per-address applied-shock rows.
//     `market_realization` is set to null on every engine because the contract
//     says it is "present when the scenario carries a market-realization axis"
//     and eth_minus_30 does not carry one.
//     ONE DOCUMENTED DERIVED DELTA, kept internally CONSISTENT so the delta is
//     real in the data and not merely asserted: debt_manager's `after` gains
//     one eligible account and DM_DELTA of eligible debt, and
//     `newly_eligible_accounts` / `eligible_debt_delta_usd` are recomputed from
//     before/after rather than stated independently.
//
//  3. run-book.weeth.batch2.json and run-book.eth_minus_30.batch2.json — files
//     2 and the run-book example with ONE field changed: the batch id, plus its
//     `computed_at` advanced to stay ordered. These are the SUPERSESSION
//     inputs. A superseded result must differ from the current one in exactly
//     the batch it was measured at and in nothing else, which is why these
//     files edit exactly that — the weeth one drives a row out of the cohort,
//     the eth one proves a re-run brings it back.
//
//  4. run-book.weeth-withheld.json — the run-book 200 example with the aave
//     engine MOVED from `engines[]` into `excluded_engines[]`, carrying the
//     canonical FLAG_CUSTODY_UNPROVEN refusal copied byte-identically from
//     `book-engine-refused.json`. `coverage.withheld_engines` gets the same
//     refusal and `coverage.stress_coverage_is_full` becomes false, which is
//     the contract's own fail-closed rule ("false if any position could not be
//     rebuilt OR any engine is withheld"). The withheld engine is absent from
//     `engines[]` entirely — exactly as the schema says it must be.
//
//  5. run-book.names-nobody.json — the run-book 200 example with BOTH engine
//     arrays EMPTIED (`engines: []`, `excluded_engines: []`) and NOTHING ELSE
//     touched. This is the degraded 200 the contract's own schemas permit:
//     neither array carries `minItems`, and `lib/runbook.ts` does no cross-field
//     validation, so a body that names no engine at all parses and typechecks
//     exactly like a healthy one. `coverage` is deliberately left claiming
//     `stress_coverage_is_full: true` with an empty `withheld_engines` — the
//     whole point of the fixture is that the ENVELOPE still looks healthy while
//     the arrays name nobody, which is why row presentation must derive from the
//     arrays (Wave R11) and never from envelope presence.
//     run-book.names-nobody.batch2.json is that file with ONE field changed —
//     the batch id, `computed_at` advanced to stay ordered, exactly as in (3).
//     It is the ANCHOR half of the same finding: a book that displays nothing
//     must not raise the anchor or the watermark, so a NEWER batch carried by a
//     naming-nobody 200 must leave an older DISPLAYED result current rather than
//     repainting it SUPERSEDED under a cohort nothing belongs to.
//
//  6. run-book.contradictory.json — WAVE R12, FINDING 1. File (4) with ONE
//     array changed back: `engines[]` restored to the run-book example's own
//     full array, while `excluded_engines[]` KEEPS the FLAG_CUSTODY_UNPROVEN
//     refusal (4) put there. `coverage` is left exactly as (4) left it. The
//     result is the body a deployment produces when it records an engine's
//     refusal but fails to drop the served row: aave_v3_etherfi is named in
//     BOTH arrays, served and withheld at once, from one response.
//     Nothing here is invented — every byte comes from (4) or from the example
//     it derives from. The contract permits it: neither array carries
//     `uniqueItems`, there is no cross-field rule between them, and
//     `lib/runbook.ts` does no validation, so it parses and typechecks exactly
//     like a healthy body. It is the fixture that proves the OLD precedence
//     (engines[] before excluded_engines[]) rendered a numeric RESULT in the
//     matrix while the detail view rendered WITHHELD, from the same response.
//
//  7. run-book.named-twice.json — WAVE R12, FINDING 1, the other arm. The
//     run-book 200 example with its aave engine object APPENDED to `engines[]`
//     a second time, byte-identical, and nothing else touched. Two results
//     offered for one cell, with nothing in the body saying which is the
//     answer — the failure `Array.prototype.find` resolves silently by taking
//     whichever came first.
//
//  8. scenarios.v2.json + run-book.ethfi_minus_50.v2.json — WAVE R12,
//     FINDING 2: THE VERSION-SKEW PAIR. Both derive mechanically from committed
//     bytes, and BOTH ARE INDIVIDUALLY VALID — that is the whole point of the
//     finding, which is about the unguarded JOIN between them and not about
//     either response.
//
//     scenarios.v2.json is (1) with THREE fields moved, all on the same axis:
//     the set's `scenario_config_version` becomes "v2", and the ethfi_minus_50
//     definition's own `version` becomes "v2" with its `engines[]` narrowed to
//     ["aave_v3_etherfi"]. That is a committed definition being re-cut across a
//     deployment — the ordinary event the finding is about, not a malformed
//     body.
//
//     run-book.ethfi_minus_50.v2.json is the run-book example RE-IDENTIFIED to
//     that v2 definition exactly as (2) re-identifies to eth_minus_30 — id,
//     version, label, description, path_assumption, shocks, out_of_model copied
//     byte-identically from scenarios.v2.json's own entry — carrying
//     `scenario_config_version: "v2"` and, matching the v2 definition's
//     coverage, only the aave engine in `engines[]`.
//
//     THE DEFECT THIS PAIR REPRODUCES: joined by scenario id alone, this valid
//     v2 response read against the RETAINED v1 listing (which covers
//     debt_manager for this id) names none of v1's covered engines — so R11
//     classifies the row ALL-HOLE and the header says "the book named nobody"
//     while the detail view renders the real aave result the response carries.
//
//  9. scenarios.removed.json — WAVE R13, FINDING 1: THE DELISTED ROW. File (1)
//     with ONE definition FILTERED OUT — `weeth_market_depeg_oracles_held`, in
//     place, every surviving byte identical and in wire order. That is a
//     deployment dropping a committed scenario, which the contract's own note
//     already anticipates ("an id absent from this listing is a 404 there").
//
//     `scenario_config_version` IS DELIBERATELY LEFT AT v1, and that is the
//     fixture's whole point rather than an oversight. Wave R12's identity guard
//     is derived PER ROW, so moving the set token would refuse every SURVIVING
//     row as DEFINITION CHANGED and leave the table with nothing displayed —
//     hiding the defect behind a guard that never sees it. A guard keyed per row
//     cannot say anything about a row that is not there: `identity.get(id)` and
//     `coverage.get(id)` are both undefined for the dropped scenario, so
//     `definitionSkew` and `isAllHoleBook` each correctly decline to infer, and
//     the orphaned phase reaches the cohort as a DISPLAYED PIN with no rendered
//     row anywhere. Holding the token still isolates that orphan as the only
//     anomaly on the table.
//
// 10. scenarios.relisted.json + run-book.weeth.v2.json — WAVE R14, FINDING 1:
//     THE RE-LISTED ROW. (9) with the dropped definition PUT BACK, in its
//     original wire position, with ONE field moved: its own `version` becomes
//     "v2". The set's `scenario_config_version` is again LEFT at v1, for exactly
//     the reason (9) leaves it: moving it would refuse every surviving row and
//     hide the finding behind a guard that never sees it.
//
//     That is the sequence the finding is about, told in three listings the
//     deployment actually serves: v1 lists the scenario, the next deployment
//     drops it, the next republishes it RE-CUT. R13 filters the orphan out of
//     the middle listing correctly; the defect is the third step, where
//     `listedPhases` re-admits the stored phase on the strength of its id alone.
//     For a `kind: "ok"` outcome R12 catches it — the body publishes its own
//     identity — but a RUNNING phase and a NON-OK outcome publish nothing, so
//     the v1 failure renders on the v2 row as RUNNING or UNANSWERED and the
//     header counts v2 as attempted.
//
//     run-book.weeth.v2.json is what the third deployment answers for that id:
//     the run-book example with `scenario_version` moved to "v2" to match the
//     re-listed definition and NOTHING else touched — `scenario_config_version`
//     stays v1 because the set's token did not move. It is the clean re-run that
//     proves the row works normally once it is asked under the definition on
//     screen.
//
// 11. run-book.partial-hole.json — WAVE R14, FINDING 2: THE PARTIAL HOLE. File
//     (4) with its ONE edit undone: the aave engine is dropped from `engines[]`
//     exactly as (4) drops it, but `excluded_engines[]` is left EMPTY — no
//     refusal is recorded for it. `coverage` is left untouched, still claiming
//     `stress_coverage_is_full: true`, for the same reason (5) leaves it: the
//     envelope looks healthy while the arrays name only half the row.
//
//     It is the body a deployment produces when an engine's row is dropped
//     without its refusal being recorded, and the contract permits it for the
//     reasons (5) sets out. `weeth_market_depeg_oracles_held` is committed for
//     BOTH engines, so aave is named in neither array: its cell reads UNANSWERED
//     while `excluded_engines.length === 0` — which is the whole condition the
//     detail panel used to render "excluded engines: none — every engine's book
//     reached the run" on. One screen, two mutually exclusive statements.
//
// YAML parsing uses the client package's own pinned `yaml` devDependency
// (installed by `scripts/ensure-client.mjs`) — no new web dependency.

import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..", "..");
const contractPath = path.join(repoRoot, "api", "openapi.yaml");

let YAML;
try {
  const requireFromClient = createRequire(
    path.join(repoRoot, "packages", "client-ts", "package.json"),
  );
  YAML = requireFromClient("yaml");
} catch {
  console.error(
    "generate-lab-book.mjs: cannot resolve the `yaml` package from\n" +
      "packages/client-ts/node_modules. Run `node scripts/ensure-client.mjs` first.",
  );
  process.exit(1);
}

const read = (name) => JSON.parse(readFileSync(path.join(here, name), "utf8"));
const write = (name, body) => {
  writeFileSync(path.join(here, name), `${JSON.stringify(body, null, 2)}\n`);
  console.log(`wrote   ${name}`);
};

const contract = YAML.parse(readFileSync(contractPath, "utf8"));
const scenariosExample =
  contract.paths["/v1/scenarios"].get.responses["200"].content["application/json"].example;

// --- 1: the committed listing ---------------------------------------------

const stressAave = read("stress-aave.json");
const fromExcerpt = stressAave.scenarios.map((scenario) => {
  // The contract's OWN derivation: ScenarioDefinition ≡ Omit<Scenario,"results">.
  const definition = { ...scenario };
  delete definition.results;
  return definition;
});
const seen = new Set(fromExcerpt.map((definition) => definition.id));
const extra = scenariosExample.scenarios.filter((definition) => !seen.has(definition.id));

const committedListing = {
  served_at: scenariosExample.served_at,
  scenario_config_version: scenariosExample.scenario_config_version,
  scenarios: [...fromExcerpt, ...extra],
  notes: scenariosExample.notes,
};

write("scenarios.json", committedListing);

// --- 2 + 3: eth_minus_30 run-book, re-identified + one consistent delta ----

const runBookExample = read("run-book.weeth_market_depeg_oracles_held.json");
const ethDefinition = stressAave.scenarios.find((scenario) => scenario.id === "eth_minus_30");
if (ethDefinition === undefined) {
  console.error("generate-lab-book.mjs: stress-aave.json carries no eth_minus_30 definition");
  process.exit(1);
}

/** The derived delta, in the Debt Manager's own 6-decimal USD. */
const DM_DELTA = 1_500_000_000n;

const ethRunBook = {
  ...runBookExample,
  scenario_id: ethDefinition.id,
  scenario_version: ethDefinition.version,
  label: ethDefinition.label,
  description: ethDefinition.description,
  path_assumption: ethDefinition.path_assumption,
  shocks: ethDefinition.shocks,
  out_of_model: ethDefinition.out_of_model,
  applied_shocks: ethDefinition.results.flatMap((result) => result.applied_shocks),
  engines: runBookExample.engines.map((engine) => {
    if (engine.engine !== "debt_manager") {
      return { ...engine, market_realization: null };
    }
    const after = {
      ...engine.after,
      eligible_accounts: engine.after.eligible_accounts + 1,
      eligible_debt_usd: (BigInt(engine.after.eligible_debt_usd) + DM_DELTA).toString(),
    };
    return {
      ...engine,
      after,
      market_realization: null,
      // Recomputed FROM before/after, never stated independently.
      newly_eligible_accounts: after.eligible_accounts - engine.before.eligible_accounts,
      eligible_debt_delta_usd: (
        BigInt(after.eligible_debt_usd) - BigInt(engine.before.eligible_debt_usd)
      ).toString(),
      bad_debt_delta_usd: (
        BigInt(after.bad_debt_usd) - BigInt(engine.before.bad_debt_usd)
      ).toString(),
      note: "delta-only: after minus before over the positions in the run.",
    };
  }),
};

write("run-book.eth_minus_30.json", ethRunBook);
write("run-book.eth_minus_30.batch2.json", {
  ...ethRunBook,
  batch: { ...ethRunBook.batch, id: ethRunBook.batch.id + 1, computed_at: "2026-07-29T10:00:30Z" },
});
write("run-book.weeth.batch2.json", {
  ...runBookExample,
  batch: {
    ...runBookExample.batch,
    id: runBookExample.batch.id + 1,
    computed_at: "2026-07-29T10:00:30Z",
  },
});

// --- 4: the withheld-engine run -------------------------------------------

const refusal = read("book-engine-refused.json").refused_engines.find(
  (entry) => entry.engine === "aave_v3_etherfi",
);
if (refusal === undefined) {
  console.error("generate-lab-book.mjs: book-engine-refused.json carries no aave refusal");
  process.exit(1);
}

write("run-book.weeth-withheld.json", {
  ...runBookExample,
  engines: runBookExample.engines.filter((engine) => engine.engine !== refusal.engine),
  excluded_engines: [refusal],
  coverage: {
    ...runBookExample.coverage,
    withheld_engines: [refusal],
    stress_coverage_is_full: false,
  },
});

// --- 5: the 200 that names NOBODY (Wave R11) -------------------------------
//
// Both arrays emptied, everything else byte-identical to the example. A book
// that names none of a row's covered engines leaves every one of that row's
// cells UNANSWERED, so the row displays no result — while the envelope it
// arrived in still carries a batch and a full-coverage claim.

const namesNobody = {
  ...runBookExample,
  engines: [],
  excluded_engines: [],
};

write("run-book.names-nobody.json", namesNobody);
write("run-book.names-nobody.batch2.json", {
  ...namesNobody,
  batch: { ...namesNobody.batch, id: namesNobody.batch.id + 1, computed_at: "2026-07-29T10:00:30Z" },
});

// --- 6: the 200 that CONTRADICTS ITSELF (Wave R12, finding 1) --------------
//
// File (4) with `engines[]` restored to the example's full array while
// `excluded_engines[]` keeps the refusal (4) put there. aave_v3_etherfi is
// therefore named in BOTH — served and withheld at once, from one response.
// The old cell precedence read `engines[]` first and rendered its number; the
// detail view rendered the refusal. Same body, two answers, one cell.

write("run-book.contradictory.json", {
  ...runBookExample,
  engines: runBookExample.engines,
  excluded_engines: [refusal],
  coverage: {
    ...runBookExample.coverage,
    withheld_engines: [refusal],
    stress_coverage_is_full: false,
  },
});

// --- 7: the 200 that names ONE engine TWICE (Wave R12, finding 1) ----------
//
// The example with its aave engine object appended a second time, byte
// identical. Two results for one cell and nothing saying which; `find()`
// silently answers with whichever the array happens to carry first.

const aaveEngine = runBookExample.engines.find((engine) => engine.engine === "aave_v3_etherfi");
if (aaveEngine === undefined) {
  console.error("generate-lab-book.mjs: the run-book example carries no aave engine");
  process.exit(1);
}

write("run-book.named-twice.json", {
  ...runBookExample,
  engines: [...runBookExample.engines, aaveEngine],
});

// --- 8: THE VERSION-SKEW PAIR (Wave R12, finding 2) ------------------------
//
// Two INDIVIDUALLY VALID responses from two deployments of the same service.
// The defect is neither of them; it is the join between them being bound to a
// scenario id alone, so a v2 book gets read against a v1 listing's coverage.

const SKEWED_ID = "ethfi_minus_50";
const V2 = "v2";

const v2Scenarios = committedListing.scenarios.map((definition) =>
  definition.id === SKEWED_ID
    ? { ...definition, version: V2, engines: ["aave_v3_etherfi"] }
    : definition,
);
const v2Definition = v2Scenarios.find((definition) => definition.id === SKEWED_ID);
if (v2Definition === undefined) {
  console.error(`generate-lab-book.mjs: the committed listing carries no ${SKEWED_ID}`);
  process.exit(1);
}

write("scenarios.v2.json", {
  ...committedListing,
  scenario_config_version: V2,
  scenarios: v2Scenarios,
});

write("run-book.ethfi_minus_50.v2.json", {
  ...runBookExample,
  scenario_config_version: V2,
  scenario_id: v2Definition.id,
  scenario_version: v2Definition.version,
  label: v2Definition.label,
  description: v2Definition.description,
  path_assumption: v2Definition.path_assumption,
  shocks: v2Definition.shocks,
  out_of_model: v2Definition.out_of_model,
  // The v2 definition covers aave alone, so the v2 run answers for aave alone.
  engines: runBookExample.engines.filter((engine) => engine.engine === "aave_v3_etherfi"),
});

// --- 9: THE DELISTED ROW (Wave R13, finding 1) -----------------------------
//
// The committed listing with ONE definition dropped, in place, and the set's
// own token LEFT WHERE IT WAS. Not a malformed listing: a deployment that
// stopped publishing a scenario. Everything that survives is byte-identical to
// (1), so the only difference between the two files is the row that is gone —
// which is exactly the difference the finding is about.

const DELISTED_ID = "weeth_market_depeg_oracles_held";

const delistedListing = {
  ...committedListing,
  scenarios: committedListing.scenarios.filter((definition) => definition.id !== DELISTED_ID),
};
if (delistedListing.scenarios.length !== committedListing.scenarios.length - 1) {
  console.error(`generate-lab-book.mjs: the committed listing carries no ${DELISTED_ID}`);
  process.exit(1);
}

write("scenarios.removed.json", delistedListing);

// --- 10: THE RE-LISTED ROW (Wave R14, finding 1) ---------------------------
//
// The dropped definition, republished RE-CUT: back in its original wire
// position with its own `version` moved to v2, and the set's token held at v1 so
// every other row is untouched. A phase stored while the row read v1 is
// re-admitted here by scenario id alone — and a phase with no served body has
// nothing but the identity it was DISPATCHED under to say otherwise.

const relistedDefinition = committedListing.scenarios.find(
  (definition) => definition.id === DELISTED_ID,
);
if (relistedDefinition === undefined) {
  console.error(`generate-lab-book.mjs: the committed listing carries no ${DELISTED_ID}`);
  process.exit(1);
}

write("scenarios.relisted.json", {
  ...committedListing,
  scenarios: committedListing.scenarios.map((definition) =>
    definition.id === DELISTED_ID ? { ...definition, version: V2 } : definition,
  ),
});

// What the republishing deployment answers for that id: the example with its
// `scenario_version` moved to match, and nothing else. The set token did not
// move, so `scenario_config_version` does not either.
write("run-book.weeth.v2.json", {
  ...runBookExample,
  scenario_version: V2,
});

// --- 11: THE PARTIAL HOLE (Wave R14, finding 2) ----------------------------
//
// (4) without its refusal: aave dropped from `engines[]` and NOT named in
// `excluded_engines[]`. One of the row's two covered engines reached the run;
// the other is in neither array, so its cell reads UNANSWERED while
// `excluded_engines.length === 0` — the exact condition the detail panel's
// "every engine's book reached the run" line used to be gated on.

write("run-book.partial-hole.json", {
  ...runBookExample,
  engines: runBookExample.engines.filter((engine) => engine.engine !== refusal.engine),
});
