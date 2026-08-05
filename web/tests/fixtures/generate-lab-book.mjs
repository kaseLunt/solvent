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
//     from that definition.
//     `market_realization` is set to null on every engine because the contract
//     says it is "present when the scenario carries a market-realization axis"
//     and eth_minus_30 does not carry one.
//
//     WAVE W-BS-C. Re-identifying an envelope is not free: the moment a body
//     says it answers eth_minus_30, THE PROPAGATION MATRIX BINDS IT. That matrix
//     lives in `internal/risk/scenarios/eth_minus_30.json` — the Go registry
//     `risk.LoadScenarios` reads and `risk.ApplyScenario` evaluates — and the
//     wire never publishes it, so this generator reads the registry file
//     directly. Its rule is absolute in both directions: an asset NO propagation
//     row describes is HELD FLAT (scenario.go:679-686), and an asset one DOES
//     describe moves by the product of the shocked axes it responds to. Two
//     halves of this file used to violate it:
//
//       - THE INVENTED ACCOUNT held an invented address and was shocked 70/100.
//         Production would have held that address flat, leaving the account at
//         $2,500 of collateral, $2,000 of maxBorrowLT and healthy — so the
//         mover, the flip and every aggregate under them described an event
//         that could not occur. It now holds WETH-on-Optimism, the matrix's
//         SECOND declared row, at the factor the matrix composes for it.
//       - THE AAVE ENGINE carried the oracles-held example's own rows, in which
//         both sides are bit-identical by construction, while `applied_shocks`
//         was flattened in from `stress-aave.json`'s per-address results. A
//         disclosure from a different book, over an aggregate that never moved.
//         The aave engine is now RE-MEASURED from `stress-aave.json`'s own
//         contract-validated eth_minus_30 result — same batch, same account,
//         same money — with `liq_threshold` / `liq_bonus` read from the
//         contract's OWN /v1/params example and the threshold PROVEN against the
//         result's published health-factor rationals before the bonus is used.
//
//     `applied_shocks` and `held_flat` are composed from THIS body's own price
//     inputs, the way `p5_runbook.go` composes them, so every disclosed shock
//     has an aggregate behind it and every held price is named.
//
//     ONE DOCUMENTED DERIVED DELTA on the Debt Manager side, kept internally
//     CONSISTENT so the delta is real in the data and not merely asserted: an
//     INVENTED WHOLE ACCOUNT is added to the debt_manager book on BOTH sides,
//     carrying its own debt and its own collateral, healthy before the shock and
//     eligible after it. Every aggregate it touches moves with it — `accounts`,
//     `total_debt_usd`, `total_collateral_usd` and its itemization,
//     `eligible_accounts`, `eligible_debt_usd`, `collateral_at_risk_usd`, the
//     histogram census — and `coverage.in_book` / `batch.position_count` count
//     it as the batch row it is. `newly_eligible_accounts` /
//     `eligible_debt_delta_usd` / `bad_debt_delta_usd` are recomputed from
//     before/after rather than stated independently, and `checkResponse` refuses
//     the write unless every cross-field law the web renders — AND every
//     propagation law above — holds over the WHOLE body.
//
//     WAVE W-BS-D. Those propagation laws were all RATIOS, and a body can be
//     falsified without disturbing a single one. Four mutations proved it, each
//     passing the whole guard: a holding DELETED from one side (entries present
//     on only one side were skipped outright), an amount and its value DOUBLED
//     TOGETHER so the implied price never moves while the book gains collateral,
//     a HELD DISCLOSURE DELETED (only the disclosures present were validated, so
//     completeness was never proven), and a mover's rational SCALED ON BOTH
//     HALVES so its quotient still matches the disclosed factor while its
//     denominator contradicts the borrowings the same row publishes.
//     `ApplyScenario` clones the balances and the debt and rewrites ONLY prices,
//     so the guard now carries the CONSERVATION and COMPLETENESS laws (8-12)
//     beside the movement laws (1-7): identical holdings across the sides,
//     bit-identical amounts, disclosed prices that reproduce the itemization's
//     absolute numbers, an exhaustive `held_flat` with nothing floating free in
//     it, and a conserved denominator. The guard's own sensitivity is proven on
//     mutants at the write site, and each must be refused FOR ITS OWN NAMED
//     REASON — the expected sentence is asserted, so a mutant that trips an
//     unrelated law fails the generation rather than passing as evidence.
//
//     WAVE W-BS-E. Codex round 30 broke the conservation half four more times,
//     and the four are one lesson: THE GUARD WAS VALIDATING DERIVED PROPERTIES
//     OF ITS OWN OUTPUT. Each law asked whether the body was consistent —
//     side against side, ratio against ratio, non-null against non-null — and
//     each round produced a body with the right properties and the wrong
//     content. A two-sided amount swap between two rows that share an asset
//     satisfies every side-to-side comparison. A nulled `debt_usd` satisfies a
//     law that only reads `debt_usd` when it is there. An exemption DERIVED
//     from "absent from the counted itemization" admits an unpriced collateral
//     row. An exemption RECOMPUTED from a mutable example grows with it.
//
//     The remedy is ANCHORING, applied to all four. Every immutable fact of a
//     generated body is pinned to its SOURCE — the contract example's untouched
//     bytes plus the rows this generator explicitly injects — and both sides
//     must match THE ANCHOR rather than each other (law 9); each mover must
//     match the SHAPE its engine's serializer produces rather than merely
//     agreeing where it is non-null (law 12); and both of law 11's exemptions
//     are frozen literals, asserted equal to their derivation and refused at
//     the point of use if the body itemizes or discloses what they forgive.
//     EIGHTEEN mutants hold it, and a register at the end of the file proves
//     each one's expected sentence belongs to its law ALONE.
//
//     WAVE W-BS-F. Codex round 31 broke it four more times, and four rounds of
//     property-law whack-a-mole ARE the finding: A BODY CANNOT BE MADE HONEST BY
//     LAWS THAT READ IT. Anchoring pinned every byte a scenario does not write —
//     and `value_usd` is the byte a scenario DOES write, so the one number this
//     whole surface exists to publish was still certified by nothing but its own
//     disclosures. Round 31 slid a priced input onto the WRONG SIDE of the shock
//     (571428571430 -> 400000000001, the AFTER price being the honest BEFORE
//     one), recomputed the values and the totals to match, and every ratio law,
//     valuation law and anchor law read green. It deleted the WHOLE aave engine
//     with its coverage adjusted, and the anchor's exhaustiveness check — which
//     lived INSIDE the loop over `response.engines` — had no iteration left to
//     fire in. It replaced a mover's account with an unrelated valid address and
//     served the same mover twice, because every mover law read the row's
//     NUMBERS and none read WHO. And it raised `movers_total` to 2 on an engine
//     that measured ONE account, because the only count law bounded the total
//     from below.
//
//     THE REMEDY IS A SECOND PEN. This file now carries two independent writers
//     over one body. GENERATION composes it, as before. THE DERIVATION reads
//     ONLY frozen inputs — the contract example's untouched bytes and the
//     committed stress excerpt RE-READ OFF DISK, the Go registry's propagation
//     matrix, the contract's own /v1/params, plus a FROZEN LITERAL for every
//     quantity this generator injects (account, asset, amount, SOURCE-SIDE
//     price, borrowings), each re-proved against the provenance written beside
//     it — and re-derives, through its own arithmetic, what the evaluator would
//     have served: each side's per-row `value_usd`, the engine set, the account
//     and eligible censuses, the money totals, the waterfall's two measures, the
//     coverage census and the EXACT set of accounts that move. The body must
//     equal it. The property laws all stay — they are what gives each earlier
//     mutant its own named sentence — and the derivation runs LAST, so not one
//     of the eighteen changes hands.
//
//     A SECOND PASS closed the two places a body RESTATES a measurement the
//     derivation already owns: the hf_histogram's census, which `checkSide`
//     bounded only in total and below the 1.00 edge, and the aave mover's
//     health-factor triple, which answered only to the body's own disclosed
//     factor. Both are now composed from the same frozen liquidation threshold
//     that decides eligibility. TWENTY-FOUR mutants hold the file.
//
//     ONE THING THE SECOND PASS COULD NOT DERIVE, recorded rather than forced:
//     the contract example's aave histogram draws its one account (800000000000
//     of collateral against 600000000000 of debt) in `1.10 – 1.25`, which needs
//     a liquidation threshold of 8250-9375 bps, while the contract's OWN
//     /v1/params example gives that reserve 8100 bps and `stress-aave.json`
//     measures the same money at a health factor of 1.08. Two committed
//     artifacts disagree and the example's histogram stands alone. The collision
//     pair's census is therefore pinned to the example's own bytes — which
//     closes the hole for those bodies without this file asserting a health
//     factor the example contradicts. Full derivation at the write site.
//
//     WAVE W-BS-G. Codex round 32 ruled the guard had NOT reached its floor and
//     broke it three more ways. The three are one lesson: A SECOND PEN IS ONLY
//     A SECOND PEN WHERE IT ACTUALLY WRITES.
//
//       FOUR FIELDS IT NEVER WROTE AT ALL. `usd_decimals`, the histogram's
//       `comparator`, its `refused_count` and its `note` arrived on every body
//       by object spread and were read by NOTHING afterwards. The Debt Manager's
//       6 decimals moved to 18 — which renders $6,500.00 as $0.0000000065 — both
//       comparators claimed `hf_wad`, `refused_count` invented seven excluded
//       positions, and the rendered note was rewritten. All four accepted. They
//       are now composed: the two engine constants from the serializer's own
//       (`engineValueDecimals`, `histogramComparator`), the refusal count FROM
//       the coverage census it is a second reading of, and the note frozen from
//       the example's bytes with the server's divergent sentence recorded.
//
//       ONE FIELD SET IT NEVER WROTE FOR THIS ENGINE. `moverFields` was a
//       per-ENGINE object and the Debt Manager's derivation supplied none, so the
//       exact-field loop iterated an EMPTY OBJECT — and the previous wave had
//       DISCLOSED that gap while asserting laws 7 and 12 covered it. Round 32
//       falsified the DM mover's rational inside both laws (both numerators
//       scaled 39/40: same disclosed factor, same conserved denominator, same
//       two buckets) and it passed. A DISCLOSED OMISSION BACKED BY AN UNTESTED
//       BELIEF IS A VACUOUS GREEN WAITING TO BE CONSTRUCTED. All six DM fields
//       are derived now, the map is keyed by ACCOUNT, and a derived mover with
//       no derived fields is itself a refusal — watched by its own mutant.
//
//       ONE AUTHORITY FILE BEHIND BOTH PENS. `FROZEN_RUNBOOK_EXAMPLE` re-read
//       the same file generation reads, so one edit moved both hands: +100000000
//       on both baseline debt totals passed. Every carried figure is a LITERAL
//       now — aggregates, census, bucket edges, coverage — re-proved against the
//       file every run, exactly as `EXAMPLE_PRICED_HOLDINGS` already was.
//
//     AND THE BLANKET CARRY IS NARROWED. The collision pair used to hand the
//     example's census to the derivation as both shape and counts, for both
//     engines, with no placement at all. Each carry is now a LEDGER ENTRY that
//     states the placement this derivation composes and is DELETED the moment
//     the two agree. Repairing the example's aave histogram therefore forces the
//     carry out, the same way repairing its `held_flat` forces the disclosure
//     exemption out.
//
//     THE NARROWING FOUND A SECOND DEFECT WHERE IT EXPECTED NONE, and that is
//     recorded rather than papered over: the Debt Manager side was expected to
//     take a derived placement, and it cannot. The example draws its one DM
//     account in `0.90 – 1.00` while its own frozen collateral (4000000000) at
//     the committed 80/100 threshold gives maxBorrowLT 3200000000 against
//     borrowings of 4620000000 — the exact rational 0.6926, which is `< 0.90`.
//     No threshold reconciles them. So there are TWO recorded histogram defects
//     in one example, each with its own still-owed proof and its own probe.
//
//     AND ONE MORE, FOUND BY AUDITING THIS WAVE'S OWN WORK: deriving each side's
//     `refused_count` closed ONE reading of the refusal census and left the other
//     three free — a body could list an excluded position while totalling none,
//     withhold an engine it also serves, and claim full coverage over both. The
//     roster, the total, the per-side count and `stress_coverage_is_full` are one
//     census read four ways, and all four answer to it now.
//     THIRTY-SIX mutants hold the file.
//
//     WAVE W-BS-H. Wave W-BS-G ended by ENUMERATING what was left: seventeen
//     edit paths in five classes. Reading that list is the finding. Every one of
//     the seven waves before it worked the same way — a round broke a field, the
//     field got a law — and the residue is therefore always the fields nobody
//     reached for. `usd_decimals` was free for six waves. The histogram's `note`
//     was free for six waves. Every byte of `batch` — the id a reader joins on,
//     the `status` a reader trusts to mean finished, the watermarks a reader
//     reads staleness off — was free for all seven, because no round happened to
//     touch them. A guard assembled field by field covers exactly the fields
//     somebody thought of, and its coverage cannot be stated without re-deriving
//     it by hand.
//
//     SO THE QUESTION IS INVERTED. `checkResponse` now walks the body's ENTIRE
//     key tree — recursively, arrays included, empty arrays included — and every
//     leaf must be in exactly one of three registers: DERIVED (the derivation
//     composes it and compares it), ANCHORED (a frozen literal or a frozen
//     sentence, re-proved against its committed source), or ENUMERATED-UNPINNED
//     (free, by a decision written down, with a one-line reason a reviewer can
//     reject). A leaf in NO register fails generation naming its own path; a leaf
//     in TWO fails as well, because a field claimed by two registers is a field
//     whose coverage nobody can state. The registers ARE the guard's coverage,
//     and they can no longer drift from what the guard does, because the body
//     itself is what walks them.
//
//     THE ENVELOPE JOINED THE FILE'S SOURCES. Filling the ANCHORED register
//     meant freezing what had only ever ridden in on a spread: the batch and its
//     watermarks and its supersession, the coverage sentence, the response
//     notes, the out-of-model caveats, every engine's `note`, `movers_note`,
//     `projection` and `market_realization`, and every non-ratio byte of the
//     disclosures (`source`, `snapped`, `base_snapped`, `cap_bound`). Prose is
//     frozen as a truncated SHA-256 plus its opening clause — `frozenLiteral`'s
//     discipline at paragraph length — because a paragraph pasted in as a
//     literal is a paragraph nobody re-reads, and because `FROZEN_RUNBOOK_EXAMPLE`
//     re-reads the file GENERATION reads, so anything carried rather than pinned
//     is one pen held twice.
//
//     AND FOUR SELF-CONTRADICTIONS WERE PINNED, each a body agreeing with itself
//     about a number while disagreeing with itself about what the number means:
//
//       LAW 13. `shocks[]` — the scenario definition the page SHOWS — was pinned
//       by nothing. Every propagation law reads the COMMITTED registry, so a body
//       could publish `shocks: []` ("nothing was shocked") while disclosing a
//       70/100 move on every price and moving every aggregate by it, and all
//       twelve laws read green. The disclosed definition is now asserted equal to
//       the committed one, AND each applied factor is re-composed from the body's
//       OWN disclosed axes.
//       LAW 14. `batch.age_seconds` — how stale a reader is TOLD the numbers are
//       — is `served_at - computed_at`, and the sweep's own age is `served_at`
//       minus the sweep's own stamp: ONE database instant read twice, because
//       that is what production does. `served_at` is the one leaf this file
//       leaves free, and a free clock beside a stated age is two disclosures
//       that can drift. (Wave W-EX-B corrected the sweep half, which measured
//       from `computed_at` and so derived the very 1200 the contract example
//       wrongly published; mutant AO2 is the regression.)
//       LAW 15. `excluded_engines[]` and `coverage.withheld_engines[]` are one
//       roster read twice — the `run-book.contradictory` shape — and only the
//       second was composed.
//       LAW 16. `market_realization` belongs to the SCENARIO ("present when the
//       scenario carries a market-realization axis"), so its presence answers to
//       the committed registry rather than to the body announcing it.
//       LAW 17. The engine's exponent is stated twice — as `usd_decimals`, which
//       every number is READ at, and as a numeral inside a sentence a reader
//       believes. Anchoring the sentence proves it is the one its source carries;
//       it cannot prove it is TRUE OF THIS BODY. Re-freeze a wrong sentence and
//       both pins pass while the page says to read $6,500.00 at 18 decimals.
//
//     THE CENSUS GAINED ITS THIRD TERM. `checkSide` read a side's account census
//     as `buckets + infinite`, which is right only while `refused_count` is zero
//     — and it is zero on every body here, which is exactly why it was never
//     questioned. A position this layer could not rebuild is still a position the
//     run measured over (`handlers.go:700-714`), so the invariant is
//     `buckets + infinite + refused === accounts`. A law that happens to be true
//     is not a law.
//
//     FORTY-SIX mutants hold the file.
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
// 12. run-book.collateral-collision.json + .swap.json — WAVE W-BS-B,
//     FINDING 4: THE COLLIDING COLLATERAL ROWS. The run-book example with ONE
//     entry added to the aave engine's `collateral_by_asset` on both sides —
//     the same weETH it already counts, carried a second time under the
//     NOT-COUNTED disclosure, which is the pair the LIVE book already serves.
//     The `.swap` file is the same body with different balances, so a rerun
//     that reconciled the two rows by guessing shows a wrong number rather than
//     a silent identity error. Full derivation at the write site.
//
//     THE FINDINGS THIS PAIR RECORDED ARE ALL DISCHARGED (Wave W-EX-A). These
//     two carry the contract's run-book 200 example verbatim, and that example
//     used to be PROSE ABOUT a body: it served `applied_shocks: []` AND
//     `held_flat: []` while itemizing priced weETH on two chains, under a
//     scenario whose committed `propagation: []` means production holds every
//     price input flat and NAMES it; it drew its aave account in `1.10 – 1.25`
//     where the contract's own /v1/params threshold puts it at 1.08; it drew its
//     Debt Manager account in `0.90 – 1.00` where its own collateral and
//     threshold put it at 0.6926; it carried notes matching no sentence the
//     server composes; and it published $400 of execution shortfall on an engine
//     with zero eligible accounts. Every one was a defect in `api/openapi.yaml`
//     rather than in this file, so each was RECORDED — an enumerated law-11
//     exemption, two histogram carries, two frozen note divergences — with teeth
//     that would fire the moment the contract was repaired.
//
//     `cmd/api/p5_runbook_example_db_test.go` repaired it, and not one instance
//     at a time: the example is now CAPTURED from the real handler over a seeded
//     book, and `TestRunBookExampleIsAServedBody` asserts forever that the yaml's
//     example IS a served body modulo four clock-produced fields. Every tooth
//     fired on the first run afterwards and every licence was deleted rather than
//     re-frozen. What is left in this file is derivation, not carry.
//
//     ONE DEFECT IN THIS PAIR WAS THIS FILE'S OWN, AND WAVE W-BS-H REPAIRED IT.
//     The `.swap` body restates the counted balance at 3 weETH — 1200000000000
//     against the same 600000000000 of debt — and carried the example's
//     `1.10 – 1.25` census unchanged. At the committed 8100 bps that account sits
//     at 1200/600 x 0.81 = 1.62, the `1.50 – 2.00` bucket. Both sides of the pair
//     take the derived placement now; mutant AT moves the swap side back.
//
// ===========================================================================
// THE GUARD'S CLAIMED COVERAGE, AND ITS KNOWN LIMITS (WAVE W-BS-H)
// ===========================================================================
//
// This is the one place a reviewer reads what the guard claims and where it
// stops. Nothing below is an aspiration: each limit is a thing that is TRUE of
// this file right now, and each is here because it cannot be closed rather than
// because closing it was deferred.
//
// WHAT IS GUARDED. Three bodies go through `checkResponse` — the eth_minus_30
// run-book and the collision pair — and for those three, every leaf of the
// response is in exactly one register, enforced by the completeness law over the
// body's own key tree. Not "every leaf somebody listed": every leaf the body
// HAS. A field added to any of them, by any hand, fails generation until it is
// registered.
//
// LIMIT (i) — THE IRREDUCIBLE TWO-PLACE EDIT. An ANCHORED value is a frozen
// literal or digest in this file, re-proved every run against a committed source
// somewhere else: `api/openapi.yaml`'s example (via the run-book fixture),
// `internal/risk/scenarios/*.json`, `stress-aave.json`, the /v1/params example.
// Change one and generation stops naming the field. Change BOTH — the literal
// here and the provenance it is proved against, in agreement — and the guard is
// silent, because at that point the two independent readings genuinely agree and
// there is nothing left in the repository to disagree with them. That is not a
// hole to be plugged; it is what "frozen against a source" MEANS. What the
// arrangement buys is that the edit cannot be accidental, cannot be one-sided,
// and cannot be quiet: it touches two files and leaves both in the diff.
//
//   The same floor holds for a DERIVED value, one step further out. The
//   derivation is arithmetic over frozen inputs, so moving a derived number
//   means moving an input — which is limit (i) again, plus the arithmetic
//   agreeing. And a leaf in ENUMERATED-UNPINNED is free by construction; the
//   register is deliberately tiny for that reason, and removing an entry without
//   pinning its field makes the completeness law fail on that field (mutant AL),
//   so the register cannot be used as a place to put things to stop checking
//   them.
//
// LIMIT (ii) — THE DELIBERATELY UNGUARDED FIXTURES. Most files this generator
// writes are MALFORMED ON PURPOSE. They exist to reproduce a defect the product
// must survive, and a guard that refused them would be refusing the evidence.
// They are named here so that "unguarded" is a decision on the record rather
// than a gap somebody might mistake for coverage:
//
//   run-book.weeth.batch2 / .eth_minus_30.batch2 / .names-nobody.batch2 (item 3)
//       one field moved — the batch id, with `computed_at` advanced to stay
//       ordered and `age_seconds` DERIVED from the pair rather than carried over
//       from the source body. They are SUPERSESSION inputs, and the point is a
//       body identical in everything but the batch it was measured at. `batch.id`
//       and `computed_at` are ANCHORED on the three bodies the completeness law
//       walks; these variants are a separate transform it never sees.
//   run-book.weeth-withheld (item 4)        an engine withheld, fail-closed.
//   run-book.names-nobody (item 5)          both engine arrays emptied under a
//                                           healthy-looking envelope.
//   run-book.contradictory (item 6)         one engine served AND withheld — the
//                                           exact shape law 15 makes impossible
//                                           in a GENERATED body.
//   run-book.named-twice (item 7)           two results offered for one cell.
//   scenarios.v2 + run-book.ethfi_minus_50.v2 (item 8)
//                                           both individually valid; the defect
//                                           is the JOIN between them.
//   scenarios.removed (item 9)              a committed scenario delisted.
//   scenarios.relisted + run-book.weeth.v2 (item 10)
//                                           the same scenario republished re-cut.
//   run-book.partial-hole (item 11)         a row dropped with no refusal
//                                           recorded beside it.
//
//   Each is a documented transform of bytes that ARE checked — the contract
//   example, or item 1's mechanically-derived listing — so none is hand-shaped
//   wire data. What is unguarded is the transform's OUTPUT, deliberately,
//   because the output's whole purpose is to be a body the product should refuse
//   to render honestly.
//
//   AND THE ONE THING THAT IS GUARDED ON ALL OF THEM (Wave W-EX-C): THE CLOCK.
//   Every body `write` emits — the three `checkResponse` bodies and all of the
//   deliberately-malformed ones alike — is walked for stated ages, and any age
//   its own stamps do not support stops generation (`clock-law.mjs`, and the
//   block above `write`). This is a real narrowing of limit (ii), not a hole in
//   it, and the boundary is worth stating precisely:
//
//     WHY IT IS SAFE TO GUARD THESE BODIES. Their deliberate wrongness lives in
//     ENGINE ARRAYS, coverage claims and identity stamps — the shapes the
//     product must refuse to render honestly. Not one of them is a clock. A law
//     that reads only `served_at`, the stamps an age is measured from, and the
//     ages beside them therefore has nothing to disagree with, and running the
//     FULL `checkResponse` over them would refuse their purpose outright.
//
//     WHY IT WAS WORTH DOING. The three `.batch2` bodies carried
//     `age_seconds: 5` beside a `computed_at` 25 seconds AFTER their own
//     `served_at` — an age no response can state, since production floors a
//     negative one at zero. Codex round 36 confirmed those bytes are NOT
//     rendered (the lab matrix reads batch IDENTITY, never the batch age), so
//     nothing was displaying them wrongly. They were fixed anyway: a byte no
//     surface reads today is a byte nobody checks tomorrow, and the law that
//     makes it unconstructible costs one walk.
//
//     WHERE THE BOUNDARY IS. The clock law must not grow. The moment it takes
//     an opinion about money, counts or coverage it starts refusing the very
//     fixtures whose purpose is to be refused BY THE PRODUCT, and limit (ii)
//     stops being a decision on the record and becomes a fight with the guard.
//
// LIMIT (iii) — THE REGISTER ASSIGNMENT ITSELF (WAVE W-BS-I, and the amendment
// wave W-BS-H's own claim needed). W-BS-H closed with "the ways to change what an
// honest user sees without failing generation are exactly (i) and (ii). There is
// no third." That was FALSE, and Codex round 33 found the third by walking into
// it: `market_realization.execution_shortfall_usd` sat in the ANCHORED register,
// with a real committed provenance, re-proved against the contract example every
// run — and served $400 of CRITICAL execution shortfall on a body whose own
// `eligible_accounts` is 0. Neither (i) nor (ii) was involved. Nothing was edited
// in two places and no fixture was deliberately malformed. The number was simply
// FILED IN THE WRONG REGISTER, and an anchor's whole promise — "this value
// answers to a source" — is worth nothing when the value is arithmetic over a
// book the source does not describe. The pin kept agreeing; the book had moved.
//
//   THE TEST, now stated so the judgement can be reviewed rather than assumed:
//   a leaf may be ANCHORED only if its value is INDEPENDENT OF THE BODY'S OWN
//   BOOK. If any transform this file performs — restating a balance, injecting a
//   row, re-identifying a scenario — could change what production would serve for
//   it, then it is DERIVED, and filing it as ANCHORED buys a pin on the wrong
//   number. Money and counts are almost never envelope. Sentences, identity
//   stamps, provider tokens and the batch's own provenance almost always are.
//
// This limit cannot be closed by a law in this file, because it is a limit on the
// HUMAN JUDGEMENT the registers encode: no walk over a body can tell that a leaf's
// register is the wrong one, only that it has one. What Wave W-BS-I does instead
// is state the test above, apply it to every entry in the ANCHORED register, and
// leave the reasons in the register beside each survivor.
//
// AND THAT IS THE WHOLE LIST. The ways to change what an honest user sees without
// failing generation are (i), (ii) and (iii). The completeness law leaves no leaf
// unclaimed on a guarded body, and every register entry resolves to arithmetic
// over frozen inputs, to a frozen pin over a committed source, or to a
// written-down reason — but WHICH of those three a leaf gets is a decision, and
// (iii) is the honest name for the decision being wrong.
//
// YAML parsing uses the client package's own pinned `yaml` devDependency
// (installed by `scripts/ensure-client.mjs`) — no new web dependency.

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { ageSeconds, checkClocks } from "./clock-law.mjs";

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

// --- THE CLOCK LAW, AND EXACTLY HOW FAR IT REACHES -------------------------
//
// Most files this generator writes are MALFORMED ON PURPOSE (LIMIT (ii), far
// above): they reproduce defects the product must survive, and `checkResponse`
// — the full derivation-and-completeness guard — is deliberately NOT run over
// them, because a guard that refused them would be refusing the evidence.
//
// A CLOCK law is a different size of thing, and it can run over all of them.
// The deliberate wrongness in these bodies lives in ENGINE ARRAYS, coverage
// claims and identity stamps; not one of them is a clock. So every body this
// file writes is walked for stated ages, and only for stated ages: `served_at`,
// the stamps an age can be measured from, and the ages beside them. Nothing
// else is inspected, and nothing else may be added here — the moment this law
// grows an opinion about money or coverage it starts refusing the fixtures
// whose whole purpose is to be refused by the product.
//
// WHY IT WAS NEEDED (Codex round 36, the banked item). The three `.batch2`
// bodies below carried `batch.age_seconds: 5` beside a `computed_at` 25 seconds
// AFTER their own `served_at`. Production floors a negative age at zero
// (`cmd/api/meta.go:255-261`), so 0 is the only value that response could
// carry, and 5 was a fixture inventing a freshness no server can state. Round
// 36 confirmed those bytes are not RENDERED — the lab matrix reads batch
// IDENTITY, never the batch age — which is exactly why the law is worth having
// rather than worth arguing about: a byte nobody reads today is a byte nobody
// checks tomorrow, and it costs one walk to make it impossible.
const clockTrios = {};
const write = (name, body) => {
  const clocks = checkClocks(body);
  if (clocks.failures.length > 0) {
    fail(
      `${name} states an age its own stamps do not support:\n  ${clocks.failures.join("\n  ")}`,
    );
  }
  clockTrios[name] = clocks.checked;
  writeFileSync(path.join(here, name), `${JSON.stringify(body, null, 2)}\n`);
  console.log(`wrote   ${name}`);
};

// Every clock trio this generator emits, counted. A law that quietly stopped
// matching would pass exactly as silently as the wrong byte it replaced, so the
// total is pinned: 2 per run-book body (the batch's own age over `computed_at`,
// and the debt_manager sweep's over `max_updated_at`) across the thirteen
// bodies that carry a batch envelope, and 0 for the four scenario listings,
// which carry `served_at` and no age at all.
const CLOCK_TRIOS_TOTAL = 26;
const checkClockCensus = () => {
  const total = Object.values(clockTrios).reduce((sum, n) => sum + n, 0);
  if (total !== CLOCK_TRIOS_TOTAL) {
    fail(
      `the clock law found ${total} stamp/age trios across ${Object.keys(clockTrios).length} ` +
        `written files; ${CLOCK_TRIOS_TOTAL} are pinned. A law that stops matching passes as ` +
        `silently as the wrong byte it exists to catch, so the count is part of the law.\n  ` +
        JSON.stringify(clockTrios),
    );
  }
};

const fail = (message) => {
  console.error(`generate-lab-book.mjs: ${message}`);
  process.exit(1);
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
  fail("stress-aave.json carries no eth_minus_30 definition");
}

// --- THE PROPAGATION MATRIX: THE COMMITTED TRUTH -------------------------
//
// `GET /v1/scenarios` does NOT publish `propagation` — `ScenarioDefinition`
// carries id/version/label/description/path_assumption/engines/shocks/
// out_of_model and nothing else (verified against the live listing at :8080,
// and against `api/openapi.yaml`'s own schema). The propagation matrix — WHICH
// asset on WHICH chain responds to WHICH axis — lives in exactly one committed
// place: the Go scenario registry, `internal/risk/scenarios/eth_minus_30.json`,
// loaded by `risk.LoadScenarios` (internal/risk/scenario.go:262-320) and
// consumed by `risk.ApplyScenario` (internal/risk/scenario.go:654-789).
//
// THAT FILE IS THE SOURCE READ HERE, because it is the source PRODUCTION reads.
// `ApplyScenario` looks each price input up by `responseKey(chainID, asset)`
// (scenario.go:792-794) and, for an input NO propagation row describes, HOLDS
// THE PRICE FLAT and records it on `ScenarioApplication.HeldFlat`
// (scenario.go:679-686). An asset the matrix does not name CANNOT move, and an
// asset it does name CANNOT stay still. A fixture that shocks an unmapped asset
// is not a fixture of this system.
const scenarioRegistry = path.join(repoRoot, "internal", "risk", "scenarios");
const committedScenario = (id) => {
  try {
    return JSON.parse(readFileSync(path.join(scenarioRegistry, `${id}.json`), "utf8"));
  } catch {
    return fail(`the committed scenario registry holds no ${id}.json`);
  }
};
const ethCommitted = committedScenario("eth_minus_30");

// The registry file and the wire definition must be the SAME scenario, or the
// matrix read here describes something the response does not claim to be.
if (ethCommitted.id !== ethDefinition.id || ethCommitted.version !== ethDefinition.version) {
  fail(
    `the committed registry carries ${ethCommitted.id}@${ethCommitted.version} but the wire ` +
      `definition is ${ethDefinition.id}@${ethDefinition.version}`,
  );
}
if (JSON.stringify(ethCommitted.shocks) !== JSON.stringify(ethDefinition.shocks)) {
  fail("the committed registry's shocks[] and the wire definition's shocks[] differ");
}

/** ApplyScenario's OWN axis key — `axis|lowercased asset` (scenario.go:105-107). */
const axisKey = (ref) => `${ref.axis}|${(ref.asset ?? "").toLowerCase()}`;

/** ApplyScenario's OWN response key — `chain|lowercased address` (scenario.go:792-794). */
const responseKey = (chainId, asset) => `${String(chainId)}|${asset.toLowerCase()}`;

/**
 * One committed scenario's propagation truth, keyed the way the evaluator keys
 * it, plus the factor it composes for any row.
 *
 * `composedFactor` is `ApplyScenario`'s own composition (scenario.go:692-700):
 * the PRODUCT of the shocked axes a row responds to. An axis the scenario does
 * not shock contributes nothing — which is how weETH, declared against BOTH
 * `eth_usd` and `weeth_eth_rate`, moves by the eth_usd factor alone here.
 *
 * The snap paths are refused rather than reimplemented: a `stable_snap` or
 * `base_stable_snap` row does not move by a plain rational and this generator
 * has no standing to model the band. Neither scenario used here declares one.
 */
const matrixFor = (committed) => {
  const shockFactors = new Map(
    committed.shocks
      .filter((shock) => shock.axis !== "borrow_apy") // ApplyScenario skips it
      .map((shock) => [axisKey(shock), [BigInt(shock.factor_num), BigInt(shock.factor_den)]]),
  );
  const rows = new Map(
    committed.propagation.map((row) => [responseKey(row.chain_id, row.asset), row]),
  );
  const composedFactor = (row) => {
    if (row.stable_snap === true || row.base_stable_snap === true) {
      fail(`propagation row ${row.asset} carries a snap flag this generator does not model`);
    }
    let num = 1n;
    let den = 1n;
    for (const ref of row.responds_to) {
      const factor = shockFactors.get(axisKey(ref));
      if (factor === undefined) {
        continue;
      }
      num *= factor[0];
      den *= factor[1];
    }
    return [num, den];
  };
  return { rows, composedFactor };
};

const ethMatrix = matrixFor(ethCommitted);
const propagation = ethMatrix.rows;
const composedFactor = ethMatrix.composedFactor;

/** Each engine's chain, read from the response's OWN batch watermarks. */
const engineChain = new Map(
  runBookExample.batch.watermarks.map((watermark) => [watermark.engine, watermark.chain_id]),
);

/** The derived delta, in the Debt Manager's own 6-decimal USD. */
const DM_DELTA = 1_500_000_000n;

/**
 * How many accounts this generator injects into the Debt Manager's book: the
 * one that FLIPS, and the one that carries the held-flat holding law 11 is
 * proved against (see `DM_HELD_ACCOUNT` for why they cannot be one account).
 */
const DM_INJECTED_ACCOUNTS = 2;

// --- CONTRACT 1.6.0: the three additive fields, DERIVED not stated ---------
//
// `hf_histogram`, `collateral_by_asset` (on each aggregate) and
// `movers`/`movers_total`/`movers_note` (on each engine) ride the run-book
// example VERBATIM into every file this generator spreads from, exactly as
// every other field does. Only ONE file derives anything: the eth_minus_30
// delta below, which invents a newly-eligible Debt Manager account.
//
// # THE ACCOUNT IS A WHOLE ACCOUNT, not a number added to one field
//
// An earlier revision of this block added DM_DELTA to `eligible_debt_usd` and
// stopped there. The result was a body that could not exist: 5,700,000,000 of
// eligible debt inside 4,620,000,000 of total debt, two accounts both eligible
// against one account's worth of debt, and three accounts across the two
// engines under a `coverage.in_book` of 2. Every one of those is a cross-field
// law the web renders, and `checkSide` greened all of it because it checked
// only three of them.
//
// So the invented account is constructed as an ACCOUNT and every aggregate it
// touches moves with it, mechanically:
//
//   accounts        1 -> 2 on BOTH sides. A price shock does not create an
//                   account; the second one must exist before it can flip.
//   total_debt_usd  += its borrowings, on BOTH sides. The Debt Manager's debt
//                   leg is USD-NORMALIZED and no scenario re-prices it (see
//                   `stable_depeg_0995_in_band`'s own out_of_model note), so
//                   the same figure rides both sides.
//   total_collateral_usd / collateral_by_asset
//                   += its holding, valued at its OWN price on each side. The
//                   entries still sum to the total EXACTLY, which is the
//                   contract's own law for that itemization.
//   eligible_*      the account is healthy before and eligible after, so it
//                   contributes to the AFTER side only — and `eligible_debt_usd`
//                   moves by exactly DM_DELTA, which is what keeps
//                   `eligible_debt_delta_usd` at its pinned "1500000000".
//   collateral_at_risk_usd / bad_debt_usd
//                   the waterfall's OWN formulas, applied to the after side:
//                   at risk is Σ min(collateral, debt × (1+bonus)) and bad debt
//                   is Σ max(0, debt − collateral/(1+bonus)) over the eligible
//                   (internal/risk/waterfall.go:96-103). Those two formulas
//                   reproduce the example's own 4,000,000,000 and 239,603,961
//                   from its own inputs, which is why they are trustworthy here.
//   hf_histogram    census == that side's `accounts`, and the count strictly
//                   below the 1.00 edge == that side's `eligible_accounts`. The
//                   BUCKET IS DERIVED from the same exact rational the mover row
//                   publishes, so the two can never tell different stories.
//   movers          exactly one row, the account that flipped, carrying that
//                   rational on each side and `debt_usd` equal to DM_DELTA.
//   coverage        `in_book` is the count of positions that reached the run —
//                   Σ of each engine's `accounts` — so it moves too, and
//                   `batch_positions` / `batch.position_count` with it.
//
// # What is NOT recomputed, and why
//
// The example's OWN rows are left byte-identical. This file's provenance (item
// 2 above) is a RE-IDENTIFICATION of the contract's example, not a re-run of
// the scenario against it: the example was measured under an oracles-held
// scenario, so its two sides are identical by construction, and recomputing
// them here would be this generator inventing a book rather than deriving one.
// The invented account is therefore the only row that responds to the shock —
// and it responds by the scenario's OWN committed factor, read from the
// definition's `shocks[]` rather than typed in.

/** A fixture account for the one derived Debt Manager flip. */
const DM_FLIP_ACCOUNT = "0x00000000000000000000000000000000000d0002";

/**
 * The collateral that account holds: WETH on Optimism — an asset the
 * eth_minus_30 propagation matrix DECLARES for the Debt Manager's own chain.
 *
 * # WHY THIS ASSET AND NOT AN INVENTED ONE
 *
 * The account used to hold an invented address. Production would have held that
 * address FLAT — `ApplyScenario` shocks nothing it cannot find in the matrix —
 * so the fixture's 70/100 move was a price no evaluator could have produced,
 * and the account would really have stayed at $2,500 of collateral, $2,000 of
 * maxBorrowLT and healthy. The mover row, the histogram flip and every
 * aggregate downstream of it described an event that could not happen.
 *
 * WETH-on-OP is `internal/risk/scenarios/eth_minus_30.json`'s second
 * propagation row: chain 10, `responds_to: [eth_usd]`, note "Chainlink ETH/USD
 * push proxy behind PriceProviderV2" — the Debt Manager's OWN price provider.
 * Three properties make it the right pick:
 *
 *   1. It responds to EXACTLY the scenario's one declared axis, so its factor is
 *      the scenario's own 70/100 with no composition and nothing to reconcile.
 *   2. It carries neither snap flag, so it moves by that plain rational.
 *   3. IT COLLIDES WITH NOTHING. The example's Debt Manager side carries weETH
 *      on chain 10 (0x5A7f…) and nothing else, so no entry has to claim two
 *      price paths and no (asset, disclosure) key repeats.
 *
 * The symbol is READ from the propagation row, not invented: the registry names
 * this one, so serving it is disclosure rather than fabrication.
 *
 * # WAVE W-EX-A: WHY THE ACCOUNT GREW A SECOND HOLDING
 *
 * Until the contract example was repaired, its Debt Manager side carried the
 * MAINNET weETH address (0xCd5f…) on chain 10 — an address the eth_minus_30
 * matrix does not describe there. That accident was load-bearing: it was the one
 * priced, itemized, undeclared holding in this whole body, so it was what proved
 * guard law 11 (held flat is exhaustive) and what mutants B, E and H mutate. The
 * repaired example carries the DM's REAL weETH, 0x5A7f…, which the matrix DOES
 * declare — so it moves, and the body lost its held-flat witness entirely.
 *
 * The guard below refuses that state rather than letting three mutants pass
 * against nothing, and the re-derivation is a SECOND holding on the same
 * injected account: USDC on Optimism, the Debt Manager's own borrow token, which
 * the live book genuinely holds as collateral (the merged-leg shape
 * `cmd/api/fixture_test.go:fxDMMergedPosition` reproduces) and which
 * eth_minus_30's matrix does not name, because a dollar stable is not ETH-linked.
 * Production therefore holds it flat and records it on `HeldFlat`, and the body
 * says so with an itemized row behind it.
 */
const DM_FLIP_ASSET = "0x4200000000000000000000000000000000000006";
const DM_FLIP_ASSET_DECIMALS = 18;
const DM_FLIP_AMOUNT = 2_500_000_000_000_000_000n; // 2.5 tokens at 18 decimals
const DM_FLIP_PRICE_BEFORE = 1_000_000_000n; // $1,000.000000 in the DM's 6-dec USD

/**
 * THE SECOND INJECTED ACCOUNT, and why it is a second account rather than a
 * second holding on the first.
 *
 * Its holding is USDC on Optimism — the Debt Manager's own borrow token, which
 * the live book genuinely holds as collateral and which no eth_minus_30
 * propagation row names, so both sides value it identically and production
 * records it on `HeldFlat`. That is the law-11 witness this body needs.
 *
 * It could not ride on the FLIPPING account. Guard law 7 requires a mover's own
 * rationals to imply a factor the body DISCLOSES for that engine, and an account
 * holding one shocked asset beside one held asset moves by a BLEND of 70/100 and
 * 1/1 that no `applied_shocks` entry states. Rather than weaken a law to fit a
 * fixture, the held balance gets its own account — healthy on BOTH sides, so it
 * is no mover and law 7 never speaks about it.
 *
 * Its debt is small enough that it stays healthy under the engine's own STRICT
 * test on both sides, which is asserted below rather than assumed.
 */
const DM_HELD_ACCOUNT = "0x00000000000000000000000000000000000d0004";
const DM_HELD_ASSET = "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85";
const DM_HELD_SYMBOL = "USDC";
const DM_HELD_DECIMALS = 6;
const DM_HELD_AMOUNT = 100_000_000n; // 100 USDC at 6 decimals
const DM_HELD_PRICE = 1_000_000n; // $1.000000 in the DM's 6-dec USD
const DM_HELD_DEBT = 50_000_000n; // $50.000000 borrowed against $100 of USDC

const DM_CHAIN = engineChain.get("debt_manager");
if (DM_CHAIN === undefined) {
  fail("the run-book example's batch names no debt_manager watermark, so its chain is unknown");
}

/** THE DECLARATION, asserted against the committed matrix rather than assumed. */
const dmFlipRow = propagation.get(responseKey(DM_CHAIN, DM_FLIP_ASSET));
if (dmFlipRow === undefined) {
  fail(
    `the eth_minus_30 propagation matrix does not declare ${DM_FLIP_ASSET} on chain ` +
      `${String(DM_CHAIN)}, so production would hold it FLAT and the flip could not happen`,
  );
}
if (typeof dmFlipRow.symbol !== "string" || dmFlipRow.symbol.length === 0) {
  fail(`the propagation row for ${DM_FLIP_ASSET} names no symbol, and none is invented`);
}
const DM_FLIP_SYMBOL = dmFlipRow.symbol;

// The Debt Manager's committed weETH configuration, the same pair the seeded
// API fixture welds against: threshold 80e18/100e18 and an ADDITIVE 1e18 bonus
// over HUNDRED_PERCENT = 100e18, i.e. +1%.
const DM_LT_NUM = 80n;
const DM_LT_DEN = 100n;
const DM_BONUS_NUM = 101n;
const DM_BONUS_DEN = 100n;

/**
 * THE ASSET'S OWN FACTOR, composed the way the evaluator composes it — read
 * from the matrix, never typed in, and never read off the scenario's `shocks[]`
 * directly. An asset's factor is a PRODUCT over the axes it responds to, and
 * only an asset responding to exactly one shocked axis has the axis's own
 * factor. Deriving it per asset is what makes that distinction survive.
 */
const [FACTOR_NUM, FACTOR_DEN] = composedFactor(dmFlipRow);
if (FACTOR_NUM === 1n && FACTOR_DEN === 1n) {
  fail(`${DM_FLIP_SYMBOL} responds to no axis this scenario shocks, so nothing would move`);
}

// THE HELD HOLDING REALLY IS UNDECLARED, asserted against the committed matrix
// rather than assumed. If eth_minus_30 ever grows a row for it, production would
// SHOCK it and this body's held-flat disclosure would be the thing law 11 exists
// to catch.
if (propagation.has(responseKey(DM_CHAIN, DM_HELD_ASSET))) {
  fail(
    `the eth_minus_30 propagation matrix now DECLARES ${DM_HELD_ASSET} on chain ` +
      `${String(DM_CHAIN)}, so production would shock it and this body's held-flat witness is gone`,
  );
}

// THE COLLISION CHECK. Neither injected balance may land on an asset the
// example's Debt Manager side already carries, or on the other one: one asset at
// one price moves by one factor, so a second entry for it would be two rows
// claiming one identity — and folding the balance in would make the merged entry
// claim a price path the example's own bytes contradict.
if (DM_FLIP_ASSET.toLowerCase() === DM_HELD_ASSET.toLowerCase()) {
  fail("the injected account's two holdings are the same asset");
}
for (const side of ["before", "after"]) {
  for (const entry of runBookExample.engines.find((e) => e.engine === "debt_manager")[side]
    .collateral_by_asset) {
    for (const injected of [DM_FLIP_ASSET, DM_HELD_ASSET]) {
      if (entry.asset.toLowerCase() === injected.toLowerCase()) {
        fail(
          `the example's debt_manager ${side} side already carries ${injected}; ` +
            `the invented balance would collide with it`,
        );
      }
    }
  }
}

const TOKEN_UNIT = 10n ** BigInt(DM_FLIP_ASSET_DECIMALS);

/** floor(amount × price / 10^decimals) — the Debt Manager's own valuation. */
const dmValueAt = (amount, price, decimals) => (amount * price) / 10n ** BigInt(decimals);
const dmValue = (amount, price) => (amount * price) / TOKEN_UNIT;

const DM_FLIP_PRICE_AFTER = (DM_FLIP_PRICE_BEFORE * FACTOR_NUM) / FACTOR_DEN;
const DM_FLIP_VALUE_BEFORE = dmValue(DM_FLIP_AMOUNT, DM_FLIP_PRICE_BEFORE);
const DM_FLIP_VALUE_AFTER = dmValue(DM_FLIP_AMOUNT, DM_FLIP_PRICE_AFTER);

/** The held holding's value — the SAME on both sides, because nothing moves it. */
const DM_HELD_VALUE = dmValueAt(DM_HELD_AMOUNT, DM_HELD_PRICE, DM_HELD_DECIMALS);

// floor(value × LT / HUNDRED_PERCENT), PER TOKEN and then summed — which is
// production's own shape (`max_borrow_contribution` is a per-leg column), and
// not the same number as flooring the account's total.
const dmMaxBorrow = (...values) =>
  values.reduce((sum, value) => sum + (value * DM_LT_NUM) / DM_LT_DEN, 0n);
const DM_FLIP_MAXBORROW_BEFORE = dmMaxBorrow(DM_FLIP_VALUE_BEFORE);
const DM_FLIP_MAXBORROW_AFTER = dmMaxBorrow(DM_FLIP_VALUE_AFTER);

/** The held account's own ceiling — identical on both sides, like its collateral. */
const DM_HELD_MAXBORROW = dmMaxBorrow(DM_HELD_VALUE);
if (DM_HELD_DEBT > DM_HELD_MAXBORROW) {
  fail(
    `the held-flat account is eligible (${String(DM_HELD_DEBT)} > ${String(DM_HELD_MAXBORROW)}), ` +
      `so it would be a mover on a body whose only disclosed factor is the shocked one`,
  );
}

// THE FLIP IS ASSERTED FROM THE ARITHMETIC, not assumed. The Debt Manager's
// test is STRICT — borrowings > maxBorrowLT — and equality is healthy.
if (DM_DELTA > DM_FLIP_MAXBORROW_BEFORE) {
  console.error(
    `generate-lab-book.mjs: the invented account is already eligible BEFORE the shock ` +
      `(${String(DM_DELTA)} > ${String(DM_FLIP_MAXBORROW_BEFORE)}), so nothing flips`,
  );
  process.exit(1);
}
if (DM_DELTA <= DM_FLIP_MAXBORROW_AFTER) {
  console.error(
    `generate-lab-book.mjs: the invented account is still healthy AFTER the shock ` +
      `(${String(DM_DELTA)} <= ${String(DM_FLIP_MAXBORROW_AFTER)}), so nothing flips`,
  );
  process.exit(1);
}

// The waterfall's own two measures, over ONE eligible account's whole
// collateral. internal/risk/waterfall.go:96-103.
const dmAtRisk = (collateral, debt) => {
  const seizable = (debt * DM_BONUS_NUM) / DM_BONUS_DEN;
  return seizable < collateral ? seizable : collateral;
};
const dmBadDebt = (collateral, debt) => {
  const recoverable = (collateral * DM_BONUS_DEN) / DM_BONUS_NUM;
  return debt > recoverable ? debt - recoverable : 0n;
};

/**
 * The bucket an EXACT RATIONAL num/den falls in, tested the way the server
 * tests it: lower_wad × den <= num × wad_scale < upper_wad × den, with no
 * division and therefore no rounding. Deriving the label rather than typing it
 * is what makes the histogram and the mover row incapable of disagreeing.
 */
const bucketLabelForRational = (histogram, num, den) => {
  const scale = BigInt(histogram.wad_scale);
  for (const bucket of histogram.buckets) {
    const aboveLower = bucket.lower_wad === null || BigInt(bucket.lower_wad) * den <= num * scale;
    const belowUpper = bucket.upper_wad === null || num * scale < BigInt(bucket.upper_wad) * den;
    if (aboveLower && belowUpper) {
      return bucket.label;
    }
  }
  console.error(
    `generate-lab-book.mjs: no bucket holds the rational ${String(num)}/${String(den)}`,
  );
  return process.exit(1);
};

/** The count of accounts strictly below the 1.00 edge — the eligible region. */
const belowOne = (histogram) =>
  histogram.buckets.reduce(
    (sum, bucket) =>
      bucket.upper_wad !== null && BigInt(bucket.upper_wad) <= BigInt(histogram.wad_scale)
        ? sum + bucket.count
        : sum,
    0,
  );

/**
 * THE TWO CENSUSES, AND WHY THEY ARE TWO (Wave W-EX-A corrects Wave W-BS-H).
 *
 * `measured` is buckets + infinite: the accounts this side actually MEASURED,
 * and it is what `accounts` counts. The WIDER census — that plus
 * `refused_count` — is every row of the engine the batch carries, measured or
 * not; the two differ by exactly the rows that reached the run without numbers.
 * Only the first has an independent witness on the wire, so only the first is a
 * law here; the wider one is named in the failure message so a reader can see
 * which set is which.
 *
 * W-BS-H moved `census` to `buckets + infinite + refused` and kept comparing it
 * against `accounts`, on the reading that "a position this layer could not
 * rebuild is still a position the run measured over". Production says otherwise
 * and always did: `measureRunBook` (p5_runbook.go:657-661, 694-698) increments
 * `accounts` ONLY inside the loop over the RUN — the rebuildable positions — and
 * `p5_runbook.go:581-583` adds `refusedByEngine[engine]` to `refused` AFTERWARDS,
 * on a measure that has already finished counting accounts. So a refused row is
 * in `refused_count` and NOT in `accounts`, and the contract's own histogram
 * sentence says the same thing in words: the buckets plus these two "account for
 * the whole run", which is a larger set than the one `accounts` counts.
 *
 * Neither reading could be falsified while every body here served
 * `refused_count: 0`. The repaired contract example serves 1 on both engines —
 * its book carries one batch-refused row per engine — and the disagreement
 * surfaced immediately. This is a DERIVATION ERROR corrected against production,
 * not a defect in the example: `TestRunBookServesTheDistributionShiftAndTheMovers`
 * (cmd/api) has pinned `buckets + infinite + refused == every Aave position in
 * the batch` over a 1-computed-1-refused book since Wave W-BS-A, and `accounts`
 * reads 1 there.
 */
const measured = (histogram) =>
  histogram.buckets.reduce((sum, bucket) => sum + bucket.count, 0) + histogram.infinite_count;

// --- THE HOLDING ANCHOR (Wave W-BS-E) --------------------------------------
//
// Codex round 30 landed one lesson four times: a guard that validates DERIVED
// PROPERTIES of a body is satisfied by a body with the right properties and the
// wrong content. Laws 8 and 9 compared the two SIDES TO EACH OTHER, so a
// TWO-SIDED edit — swapping the amounts of the collision fixture's two rows, on
// both sides — kept every correspondence intact while the book served balances
// nobody put there. And the fields no law read at all (`unpriced`, `note`)
// could be edited on ONE side with nothing anywhere to say so.
//
// The remedy is ANCHORING. Every immutable fact of a generated body is pinned
// to its SOURCE — the contract example's untouched bytes plus the rows this
// generator explicitly injects — and BOTH sides must equal THE ANCHOR. Not each
// other, not a ratio, not merely non-null: the anchor.
//
// `value_usd` is the one field an anchor does not pin, because it is the one
// field `ApplyScenario` WRITES (scenario.go:677-745). It moves, and laws 1-4
// and 10 bind exactly how far.

/** The server's own itemization identity: one asset, one disclosure, one row. */
const disclosureOf = (entry) =>
  entry.value_usd !== null ? "counted" : entry.unpriced ? "unpriced" : "not-counted";

/** An anchor row's key: whose book, which asset, which disclosure. */
const anchorKey = (engineName, entry) => `${engineName}|${entry.asset}::${disclosureOf(entry)}`;

/**
 * THE PER-ENGINE MOVER VOCABULARY, as `wireRunBookMover` declares it
 * (p5_runbook.go:117-139): every mover carries every field, and the engine that
 * does not SPEAK a field publishes it as NULL rather than omitting it. Which
 * makes the shape an anchor — see law 12.
 */
const MOVER_VOCABULARY = {
  aave_v3_etherfi: ["hf_before_wad", "hf_after_wad", "hf_drop_wad"],
  debt_manager: [
    "hf_before_num",
    "hf_before_den",
    "hf_after_num",
    "hf_after_den",
    "became_eligible",
    "debt_usd",
  ],
};

/** How a field reads in a refusal: absent and null are different failures. */
const shown = (value) => (value === undefined ? "ABSENT" : JSON.stringify(value));

/**
 * THE IMMUTABLE HALF OF A HOLDING — everything `ApplyScenario` CLONES rather
 * than writes (scenario.go:677-745, 762-777). `symbol` and `note` normalize to
 * null when absent, so an anchor pins their ABSENCE as firmly as their value.
 */
const anchorOf = (entry) => ({
  amount: entry.amount,
  decimals: entry.decimals,
  symbol: entry.symbol ?? null,
  unpriced: entry.unpriced,
  note: entry.note ?? null,
});

/**
 * Build one response's anchor from `[engine, entries]` declarations.
 *
 * The caller passes SOURCE rows — the contract example's own arrays and the
 * entries this generator constructs — and never rows read back off the body
 * being checked, which would only ever prove that the body equals itself.
 */
const holdingAnchor = (declarations) => {
  const anchor = new Map();
  for (const [engineName, entries] of declarations) {
    for (const entry of entries) {
      const key = anchorKey(engineName, entry);
      if (anchor.has(key)) {
        fail(`the declared holding anchor names ${key} TWICE, so it pins nothing`);
      }
      anchor.set(key, anchorOf(entry));
    }
  }
  return anchor;
};

/**
 * Fail the generation rather than write a self-contradicting side.
 *
 * Every law here is one the web RENDERS, and every one of them is checked
 * against the untouched contract example first — a law the example itself
 * violates would refuse honest bytes this generator has no standing to rewrite.
 */
const checkSide = (name, side) => {
  if (measured(side.hf_histogram) !== side.accounts) {
    const histogram = side.hf_histogram;
    const placed = histogram.buckets.reduce((sum, bucket) => sum + bucket.count, 0);
    fail(
      `${name} histogram measures ${String(measured(histogram))} ` +
        `!= accounts ${String(side.accounts)} — ${String(placed)} placed in buckets + ` +
        `${String(histogram.infinite_count)} unbounded IS the set of accounts this side ` +
        `measured; the ${String(histogram.refused_count)} refused are rows the run could not ` +
        `measure and are counted OUTSIDE accounts`,
    );
  }
  if (belowOne(side.hf_histogram) !== side.eligible_accounts) {
    fail(
      `${name} sub-1.00 count ${String(belowOne(side.hf_histogram))} ` +
        `!= eligible_accounts ${String(side.eligible_accounts)}`,
    );
  }
  // AN ELIGIBLE ACCOUNT IS AN ACCOUNT. The eligible set is a subset of the
  // measured set, so its count can never exceed it.
  if (side.eligible_accounts > side.accounts) {
    fail(
      `${name} eligible_accounts ${String(side.eligible_accounts)} ` +
        `> accounts ${String(side.accounts)} — the eligible set is a SUBSET`,
    );
  }
  // ELIGIBLE DEBT IS A SUBSET OF THE DEBT. `eligible_debt_usd` sums the
  // borrowings of the eligible accounts; `total_debt_usd` sums every account's.
  // A book claiming more eligible debt than debt is claiming money it does not
  // carry — the exact shape this wave exists to make impossible.
  if (BigInt(side.eligible_debt_usd) > BigInt(side.total_debt_usd)) {
    fail(
      `${name} eligible_debt_usd ${side.eligible_debt_usd} ` +
        `> total_debt_usd ${side.total_debt_usd} — impossible money`,
    );
  }
  // BAD DEBT IS THE UNRECOVERABLE PART OF THE ELIGIBLE DEBT, so it is bounded
  // by it. (Verified against the example: 239,603,961 of 4,200,000,000.)
  if (BigInt(side.bad_debt_usd) > BigInt(side.eligible_debt_usd)) {
    fail(
      `${name} bad_debt_usd ${side.bad_debt_usd} ` +
        `> eligible_debt_usd ${side.eligible_debt_usd} — bad debt is a PART of the eligible debt`,
    );
  }
  // COLLATERAL AT RISK IS COLLATERAL. It is Σ min(collateral, debt × (1+bonus))
  // over the eligible accounts, so the min alone bounds it by the whole book's
  // counted collateral.
  if (BigInt(side.collateral_at_risk_usd) > BigInt(side.total_collateral_usd)) {
    fail(
      `${name} collateral_at_risk_usd ${side.collateral_at_risk_usd} ` +
        `> total_collateral_usd ${side.total_collateral_usd}`,
    );
  }
  const counted = side.collateral_by_asset
    .filter((entry) => entry.value_usd !== null)
    .reduce((sum, entry) => sum + BigInt(entry.value_usd), 0n);
  if (counted !== BigInt(side.total_collateral_usd)) {
    fail(
      `${name} collateral_by_asset sums ${String(counted)} ` +
        `!= total_collateral_usd ${side.total_collateral_usd}`,
    );
  }
  // ONE ASSET, ONE DISCLOSURE, ONE ENTRY. The server itemizes by asset AND
  // disclosure, so a repeated (asset, disclosure) pair is two rows claiming one
  // identity — the collision the detail view's React key now encodes.
  const seen = new Set();
  for (const entry of side.collateral_by_asset) {
    const key = `${entry.asset}::${disclosureOf(entry)}`;
    if (seen.has(key)) {
      fail(`${name} carries TWO collateral entries for ${key}`);
    }
    seen.add(key);
  }
};

// ===========================================================================
// THE DERIVATION: THE SECOND PEN (WAVE W-BS-F)
// ===========================================================================
//
// Codex round 31 broke the guard four more times, and four rounds of
// property-law repair have now proved the endpoint: EVERY LAW ABOVE READS THE
// BODY. Each one asks whether the body agrees with itself — with its own
// anchor, its own disclosures, its own ratios, its own shape — and a body that
// writes its own disclosures can always be made to agree with itself. Round 31,
// in four sentences:
//
//   * THE SOURCE-SIDE PRICE WAS SELF-CERTIFIED. Law 10 proves a disclosed price
//     values the itemization the body serves; law 4 proves the pair moves by the
//     matrix's factor. A probe that slid BOTH prices and BOTH values onto the
//     wrong side of the shock — 571428571430 -> 400000000001, where the AFTER
//     price is the honest BEFORE one — satisfied every one of them, because
//     nothing in this file ever said what the price WAS.
//   * EXHAUSTIVENESS LIVED INSIDE THE LOOP. The anchor's "a body may not drop a
//     row its own source carries" ran per engine, inside
//     `for (const engine of response.engines)`. Delete the WHOLE aave engine and
//     the loop never runs for it, so its anchored rows are never missed.
//   * THE MOVER ACCOUNTS WERE UNANCHORED. A mover's shape, its rationals, its
//     factor and its bucket were all checked. WHO it was was not: replace the
//     Debt Manager mover's account with any valid address, or serve the same
//     mover twice, and the guard was silent.
//   * `movers_total` WAS BOUNDED FROM ONE END ONLY. `movers.length <=
//     movers_total` admits `movers_total: 2` on an engine that measured ONE
//     account.
//
// THE REMEDY IS A SECOND PEN. This file now carries two independent writers over
// one body:
//
//   GENERATION composes the body from the contract example plus the rows this
//   generator injects, exactly as it always has.
//
//   THE DERIVATION re-reads the FROZEN sources — the contract example's
//   untouched bytes OFF DISK, the committed stress excerpt OFF DISK, the Go
//   registry's propagation matrix, the contract's own /v1/params — plus a FROZEN
//   LITERAL for every quantity this generator injects (account, asset, amount,
//   SOURCE-SIDE price, debt), each asserted against its provenance — and
//   RE-DERIVES what `risk.ApplyScenario` and `cmd/api/p5_runbook.go` would have
//   served: each side's per-row `value_usd`, the engine set, the account and
//   eligible-account censuses, the money totals, the waterfall's two measures,
//   the coverage census and the EXACT set of accounts that move. The body must
//   equal it.
//
// The derivation reads NOTHING off the body it judges. That is the whole
// difference. A property law can be satisfied by a wrong body with the right
// shape; a derivation cannot, because the only edit that moves what it expects
// is an edit to the frozen literals themselves — in the open, with their
// provenance beside them.
//
// THE PROPERTY LAWS STAY. They are what gives each of the eighteen earlier
// mutants its own named sentence, and they generalize to shapes this derivation
// does not model. The derivation runs LAST, after every one of them, so no
// earlier mutant's refusal changes hands.

/** The contract's own run-book 200 example, re-read for THE GUARD alone. */
const FROZEN_RUNBOOK_EXAMPLE = read("run-book.weeth_market_depeg_oracles_held.json");

/** The contract-validated stress excerpt, re-read for THE GUARD alone. */
const FROZEN_STRESS_EXCERPT = read("stress-aave.json");

/**
 * A frozen literal, re-proved against the committed source it was read off.
 *
 * A literal that is never re-proved is a transcription nobody checks; a source
 * read straight into the derivation is a source a mutation can move. Freezing
 * AND asserting is the only arrangement where a moved source stops generation
 * and a mistyped literal cannot survive one run.
 */
const frozenLiteral = (what, literal, sourced) => {
  if (literal !== sourced) {
    fail(
      `THE FROZEN ${what} is ${String(literal)}, but the committed source it was frozen from now ` +
        `reads ${String(sourced)} — a frozen input is re-proved against its provenance every run, ` +
        `so this is the SOURCE moving and not a typo here: re-review the derivation before ` +
        `re-freezing it`,
    );
  }
  return literal;
};

/**
 * A frozen SENTENCE, re-proved the same way (Wave W-BS-H).
 *
 * The envelope this generator carries from the contract example is mostly PROSE
 * — disclosure notes, out-of-model caveats, the supersession sentence — and a
 * paragraph pasted into this file as a literal is a paragraph nobody re-reads.
 * So a sentence is frozen as a TRUNCATED SHA-256 plus the opening clause: the
 * excerpt tells a reviewer which sentence is meant, and the digest is what
 * actually holds, byte for byte, including the bytes the excerpt does not show.
 *
 * This is `frozenLiteral`'s discipline at prose length, and it exists for the
 * same reason: `FROZEN_RUNBOOK_EXAMPLE` re-reads the file GENERATION reads, so
 * a value carried across rather than pinned is ONE PEN HELD TWICE (Wave W-BS-G,
 * finding 3).
 */
const frozenText = (what, digest, excerpt, sourced) => {
  if (typeof sourced !== "string") {
    fail(
      `THE FROZEN ${what} was frozen as the sentence beginning ${JSON.stringify(excerpt)}, but the ` +
        `committed source now carries ${JSON.stringify(sourced)}, which is not a sentence at all`,
    );
  }
  const got = createHash("sha256").update(sourced, "utf8").digest("hex").slice(0, 16);
  if (got !== digest) {
    fail(
      `THE FROZEN ${what} digests ${digest} over the sentence beginning\n        ` +
        `${JSON.stringify(excerpt)}\n        but the committed source it was frozen from now ` +
        `digests ${got} over\n        ${JSON.stringify(sourced.slice(0, 120))}\n        — a frozen ` +
        `sentence is re-proved against its provenance every run, so this is the SOURCE moving: ` +
        `read the new wording before re-freezing it`,
    );
  }
  if (!sourced.startsWith(excerpt)) {
    fail(
      `THE FROZEN ${what} digests correctly but does not begin ${JSON.stringify(excerpt)} — the ` +
        `excerpt is what a reviewer reads instead of the digest, so it may not drift from the bytes`,
    );
  }
  return sourced;
};

/** The frozen form of a sentence: a truncated digest plus its opening clause. */
const text = (digest, excerpt) => ({ digest, excerpt });

/** An empty array is a leaf in its own right — the claim that NOTHING is there. */
const EMPTY_ARRAY = Symbol("an empty array");

// --- THE SERIALIZER'S OWN CONSTANTS, FROZEN (Wave W-BS-G, finding 1) --------
//
// Codex round 32 found FOUR fields on every generated body that NEITHER pen
// wrote. `usd_decimals`, the histogram's `comparator`, its `refused_count` and
// its `note` all arrived by object spread — `...engine`, `...aaveExample[side]`,
// `...histogram` — and were read by nothing afterwards, so all four were free
// text. The round's own probes, every one accepted:
//
//   * the Debt Manager's `usd_decimals` moved 6 -> 18, which renders $6,500.00
//     of eligible debt as $0.0000000065 on a page whose whole job is money;
//   * BOTH comparators moved to `hf_wad`, which tells a reader the Debt Manager
//     publishes a pool health factor it does not have and that its buckets mean
//     something they do not;
//   * `refused_count` moved to 7, inventing seven positions the run never saw
//     while `coverage` counted none of them;
//   * the note — the sentence the page RENDERS beside the distribution — was
//     rewritten outright.
//
// Each is frozen here with its provenance, and each is COMPARED EXACTLY by the
// derivation:
//
//   usd_decimals  `cmd/api/p5_common.go:81-84` — `engineValueDecimals`, the
//                 serializer's own constant (aave 8, debt_manager 6). The
//                 contract example publishes the same pair, and the freeze below
//                 asserts it.
//   comparator    `cmd/api/handlers.go:415-423` — `histogramComparator`, which
//                 names WHICH quantity the buckets are computed on. The example
//                 publishes the same pair, and the freeze asserts that too.
//   note          THE CONTRACT EXAMPLE'S OWN SENTENCE, frozen from its bytes.
//
//                 THE DIVERGENCE IS DISCHARGED (Wave W-EX-A). It used to be a
//                 ledger entry: `runMeasure.wire` (p5_runbook.go:298-311)
//                 composes `histogramComparator`'s note PLUS an eligible-edge
//                 clause and an `infinite_count`/`refused_count` paragraph, and
//                 the example carried a shorter sentence nobody's server writes,
//                 so two committed artifacts disagreed and this file had no
//                 standing to rewrite either. The example is now CAPTURED from
//                 the running handler (`TestRunBookExampleIsAServedBody`), so
//                 the sentence frozen below IS the sentence the server composes
//                 — one artifact, read twice, agreeing.
const FROZEN_ENGINE_SERIALIZATION = {
  aave_v3_etherfi: {
    usd_decimals: 8,
    comparator: "hf_wad",
    note:
      "buckets are the pool's own health-factor WAD. Aave liquidates STRICTLY BELOW 1e18, so " +
      "`< 1.00` is the eligible set and exactly 1.00 is healthy. This is ONE SIDE of the shock " +
      "over the positions in the run, in the SAME buckets /v1/book's histogram serves; the " +
      "after-side is bucketed on the SHOCKED states. `infinite_count` is accounts with no debt " +
      "and `refused_count` is the positions this run measured on NEITHER side — both are counted " +
      "here rather than dropped, so the buckets plus these two account for the whole run. " +
      "`hf_transitions` states that same population as its last lane and splits it by cause.",
  },
  debt_manager: {
    usd_decimals: 6,
    comparator: "hf_num/hf_den",
    note:
      "the Debt Manager has no health-factor wad: its liquidation test is the strict boolean " +
      "`debt > maxBorrowLT`. These buckets are the EXACT rational maxBorrowLT/borrowings, a " +
      "disclosure only — take eligibility from `liquidatable_positions`. This is ONE SIDE of " +
      "the shock over the positions in the run, in the SAME buckets /v1/book's histogram " +
      "serves; the after-side is bucketed on the SHOCKED states. `infinite_count` is accounts " +
      "with no debt and `refused_count` is the positions this run measured on NEITHER side — " +
      "both are counted here rather than dropped, so the buckets plus these two account for the " +
      "whole run. `hf_transitions` states that same population as its last lane and splits it by cause.",
  },
};

// --- THE EXAMPLE'S OWN BASELINE, FROZEN AS LITERALS (finding 3) -------------
//
// THE TWO PENS SHARED AN AUTHORITY FILE. `FROZEN_RUNBOOK_EXAMPLE` re-reads
// `run-book.weeth_market_depeg_oracles_held.json` — the same file GENERATION
// reads as `runBookExample` — so every figure the derivation "carried" from it
// moved when the file moved. Codex round 32 added +100000000 to BOTH baseline
// debt totals in that one file and generation stayed green, because the body's
// total and the derivation's expected total were the same number read twice.
// Re-reading a mutable file is not a second pen. It is one pen held twice.
//
// So every carried figure is a LITERAL below, with the example's bytes as of
// this wave as its provenance, and `freezeExampleBaseline` re-proves each one
// against the freshly-parsed example EVERY RUN — the same arrangement
// `EXAMPLE_PRICED_HOLDINGS` already uses for law 11's exemption. A source that
// moves stops generation, names the field that moved, and waits for a person.
/** The wad the buckets are scaled in (`risk.WadUnit()`), frozen. */
const FROZEN_WAD_SCALE = "1000000000000000000";

/**
 * THE BUCKET SHAPE, FROZEN: label, lower edge, upper edge, in wire order.
 *
 * `histogramEdges` is walked in ONE order by /v1/book and by the run-book alike
 * (p5_runbook.go:312-325), so an edge that moves moves in both places at once —
 * and a shape re-read off the same example both pens read is a shape ONE edit
 * moves twice. `null` is an open end: no lower bound on the first bucket, no
 * upper bound on the last.
 */
const FROZEN_HISTOGRAM_EDGES = [
  ["< 0.90", null, "900000000000000000"],
  ["0.90 – 1.00", "900000000000000000", "1000000000000000000"],
  ["1.00 – 1.05", "1000000000000000000", "1050000000000000000"],
  ["1.05 – 1.10", "1050000000000000000", "1100000000000000000"],
  ["1.10 – 1.25", "1100000000000000000", "1250000000000000000"],
  ["1.25 – 1.50", "1250000000000000000", "1500000000000000000"],
  ["1.50 – 2.00", "1500000000000000000", "2000000000000000000"],
  [">= 2.00", "2000000000000000000", null],
];

/**
 * Every aggregate this file CARRIES from the contract's run-book 200 example,
 * as literals. `counts` is the census in `FROZEN_HISTOGRAM_EDGES` order.
 *
 * The aave rows are carried only by the COLLISION pair; the eth_minus_30 body
 * re-measures its aave engine from the committed stress excerpt and carries
 * nothing. The debt_manager rows are carried by both, for the reason recorded at
 * the write site: the example publishes ONE account carrying 4,620,000,000 of
 * debt of which 4,200,000,000 is eligible, which no single-account model
 * reproduces, so this generator has no standing to re-measure it.
 */
const FROZEN_EXAMPLE_BASELINE = {
  aave_v3_etherfi: {
    before: {
      accounts: 1,
      eligible_accounts: 0,
      total_collateral_usd: "800000000000",
      total_debt_usd: "600000000000",
      eligible_debt_usd: "0",
      collateral_at_risk_usd: "0",
      bad_debt_usd: "0",
      infinite_count: 0,
      refused_count: 1,
      counts: [0, 0, 0, 1, 0, 0, 0, 0],
    },
    after: {
      accounts: 1,
      eligible_accounts: 0,
      total_collateral_usd: "800000000000",
      total_debt_usd: "600000000000",
      eligible_debt_usd: "0",
      collateral_at_risk_usd: "0",
      bad_debt_usd: "0",
      infinite_count: 0,
      refused_count: 1,
      counts: [0, 0, 0, 1, 0, 0, 0, 0],
    },
  },
  debt_manager: {
    before: {
      accounts: 1,
      eligible_accounts: 1,
      total_collateral_usd: "4000000000",
      total_debt_usd: "4620000000",
      eligible_debt_usd: "4620000000",
      collateral_at_risk_usd: "4000000000",
      bad_debt_usd: "659603961",
      infinite_count: 0,
      refused_count: 1,
      counts: [1, 0, 0, 0, 0, 0, 0, 0],
    },
    after: {
      accounts: 1,
      eligible_accounts: 1,
      total_collateral_usd: "4000000000",
      total_debt_usd: "4620000000",
      eligible_debt_usd: "4620000000",
      collateral_at_risk_usd: "4000000000",
      bad_debt_usd: "659603961",
      infinite_count: 0,
      refused_count: 1,
      counts: [1, 0, 0, 0, 0, 0, 0, 0],
    },
  },
};

/** The example's own coverage census, frozen. */
const FROZEN_EXAMPLE_COVERAGE = {
  batch_positions: 4,
  in_book: 2,
  refused_in_batch: 2,
  excluded_by_this_layer: 0,
};

/** The scenario the example answers, frozen — never read off the body it judges. */
const FROZEN_EXAMPLE_SCENARIO_ID = "weeth_market_depeg_oracles_held";
const FROZEN_EXAMPLE_SCENARIO_VERSION = "v1";

/** Each engine's chain, from the example's own batch watermarks, frozen. */
const FROZEN_EXAMPLE_CHAINS = { aave_v3_etherfi: 1, debt_manager: 10 };

/**
 * THE ENGINES NAMED BY `coverage.excluded` — frozen as the empty list it is.
 *
 * A side's `refused_count` is EVERY row of the engine that reached the run
 * WITHOUT numbers, and there are TWO ways to be one. `p5_runbook.go:426-431`
 * counts `p.input == nil` on a covered engine, which is the union of:
 *
 *   * rows the BATCH refused (`handlers.go:701-703` totals them as
 *     `refused_in_batch`), and
 *   * rows THIS LAYER could not rebuild (`handlers.go:704-712` names them one by
 *     one in `coverage.excluded` and totals them as `excluded_by_this_layer`).
 *
 * `p5_runbook.go:584-588` then adds that union to BOTH sides. Wave W-EX-A
 * corrected this derivation, which had modelled only the second: the example's
 * book carries one batch-refused row per engine and no layer refusals at all, so
 * a `refused_count` composed from `coverage.excluded` alone read 0 where the
 * server serves 1. The census below is the batch-refusal split, and it is
 * re-proved against `coverage.refused_in_batch` — the example publishes the
 * TOTAL, so the split is a frozen literal that has to sum to it.
 */
const FROZEN_EXAMPLE_EXCLUDED_ENGINES = [];

/** The engines the example WITHHOLDS — frozen as the empty list it is. */
const FROZEN_EXAMPLE_WITHHELD_ENGINES = [];

/**
 * The BATCH's own refusals, split per engine. Its sum is welded to the example's
 * `coverage.refused_in_batch` by `freezeExampleBaseline`, so a split that stops
 * describing the published total stops generation.
 */
const FROZEN_EXAMPLE_REFUSED_IN_BATCH = { aave_v3_etherfi: 1, debt_manager: 1 };

/**
 * One engine's `refused_count`: the batch's refusals for it, plus the layer's,
 * plus whatever this generator injects on top.
 */
const derivedRefusedCount = (engineName, injected) =>
  (FROZEN_EXAMPLE_REFUSED_IN_BATCH[engineName] ?? 0) +
  FROZEN_EXAMPLE_EXCLUDED_ENGINES.filter((name) => name === engineName).length +
  injected;

/** The frozen bucket SHAPE, in the form `derivedHistogram` reads. */
const FROZEN_HISTOGRAM_SHAPE = {
  wad_scale: FROZEN_WAD_SCALE,
  buckets: FROZEN_HISTOGRAM_EDGES.map(([label, lower_wad, upper_wad]) => ({
    label,
    lower_wad,
    upper_wad,
  })),
};

/** The histogram metadata the SERIALIZER owns, composed for one engine. */
const frozenHistogramMeta = (engineName, injectedRefusals) => ({
  comparator: FROZEN_ENGINE_SERIALIZATION[engineName].comparator,
  note: FROZEN_ENGINE_SERIALIZATION[engineName].note,
  refused_count: derivedRefusedCount(engineName, injectedRefusals),
});

/**
 * Re-prove every frozen literal above against the example READ OFF DISK.
 *
 * Written as a function of the example so its own failure can be WATCHED
 * (mutant AD probes the authority file itself) rather than only asserted.
 */
const freezeExampleBaseline = (example) => {
  frozenLiteral(
    "the example's engine set",
    Object.keys(FROZEN_EXAMPLE_BASELINE).join(" "),
    example.engines.map((engine) => engine.engine).join(" "),
  );
  frozenLiteral("the example's scenario id", FROZEN_EXAMPLE_SCENARIO_ID, example.scenario_id);
  frozenLiteral(
    "the example's scenario version",
    FROZEN_EXAMPLE_SCENARIO_VERSION,
    example.scenario_version,
  );
  for (const [field, value] of Object.entries(FROZEN_EXAMPLE_COVERAGE)) {
    frozenLiteral(`example coverage.${field}`, value, example.coverage[field]);
  }
  for (const [engineName, chainId] of Object.entries(FROZEN_EXAMPLE_CHAINS)) {
    frozenLiteral(
      `example batch watermark chain for ${engineName}`,
      chainId,
      example.batch.watermarks.find((watermark) => watermark.engine === engineName)?.chain_id,
    );
  }
  frozenLiteral(
    "example coverage.excluded (the engines this layer refused)",
    FROZEN_EXAMPLE_EXCLUDED_ENGINES.join(" ") || "(none)",
    example.coverage.excluded.map((entry) => entry.engine).join(" ") || "(none)",
  );
  frozenLiteral(
    "example coverage.withheld_engines",
    FROZEN_EXAMPLE_WITHHELD_ENGINES.join(" ") || "(none)",
    example.coverage.withheld_engines.map((entry) => entry.engine).join(" ") || "(none)",
  );
  // THE BATCH-REFUSAL SPLIT IS WELDED TO THE PUBLISHED TOTAL. The example states
  // `refused_in_batch` and no per-engine breakdown, so the split above is a
  // literal — and a literal that stopped summing to the total would silently
  // move a refusal from one engine's histogram to the other's.
  frozenLiteral(
    "the frozen per-engine batch-refusal split, summed against coverage.refused_in_batch",
    Object.values(FROZEN_EXAMPLE_REFUSED_IN_BATCH).reduce((sum, n) => sum + n, 0),
    example.coverage.refused_in_batch,
  );
  for (const [engineName, frozen] of Object.entries(FROZEN_EXAMPLE_BASELINE)) {
    const engine = example.engines.find((entry) => entry.engine === engineName);
    if (engine === undefined) {
      fail(`the contract's run-book 200 example no longer carries a ${engineName} engine`);
    }
    const serialization = FROZEN_ENGINE_SERIALIZATION[engineName];
    frozenLiteral(
      `example ${engineName} usd_decimals`,
      serialization.usd_decimals,
      engine.usd_decimals,
    );
    for (const side of ["before", "after"]) {
      const got = engine[side];
      const want = frozen[side];
      for (const field of [
        "accounts",
        "eligible_accounts",
        "total_collateral_usd",
        "total_debt_usd",
        "eligible_debt_usd",
        "collateral_at_risk_usd",
        "bad_debt_usd",
      ]) {
        frozenLiteral(`example ${engineName} ${side} ${field}`, want[field], got[field]);
      }
      const histogram = got.hf_histogram;
      frozenLiteral(
        `example ${engineName} ${side} hf_histogram.comparator`,
        serialization.comparator,
        histogram.comparator,
      );
      frozenLiteral(
        `example ${engineName} ${side} hf_histogram.note`,
        serialization.note,
        histogram.note,
      );
      frozenLiteral(
        `example ${engineName} ${side} hf_histogram.wad_scale`,
        FROZEN_WAD_SCALE,
        histogram.wad_scale,
      );
      frozenLiteral(
        `example ${engineName} ${side} hf_histogram.infinite_count`,
        want.infinite_count,
        histogram.infinite_count,
      );
      frozenLiteral(
        `example ${engineName} ${side} hf_histogram.refused_count`,
        want.refused_count,
        histogram.refused_count,
      );
      // THE SAME REFUSALS READ TWICE. The frozen count and the coverage census
      // are welded, so a refusal that appears in one and not the other stops
      // generation instead of leaving the two disclosures to disagree on screen.
      frozenLiteral(
        `example ${engineName} ${side} refused_count against its own coverage census`,
        want.refused_count,
        derivedRefusedCount(engineName, 0),
      );
      frozenLiteral(
        `example ${engineName} ${side} hf_histogram bucket count`,
        FROZEN_HISTOGRAM_EDGES.length,
        histogram.buckets.length,
      );
      for (const [index, [label, lower, upper]] of FROZEN_HISTOGRAM_EDGES.entries()) {
        const bucket = histogram.buckets[index];
        frozenLiteral(`example ${side} hf_histogram bucket ${String(index)} label`, label, bucket.label);
        frozenLiteral(
          `example ${side} hf_histogram bucket ${label} lower_wad`,
          lower,
          bucket.lower_wad,
        );
        frozenLiteral(
          `example ${side} hf_histogram bucket ${label} upper_wad`,
          upper,
          bucket.upper_wad,
        );
        frozenLiteral(
          `example ${engineName} ${side} hf_histogram bucket ${label} count`,
          want.counts[index],
          bucket.count,
        );
      }
    }
  }
  return FROZEN_EXAMPLE_BASELINE;
};

freezeExampleBaseline(FROZEN_RUNBOOK_EXAMPLE);

// ===========================================================================
// THE LEAF WALK (WAVE W-BS-H)
// ===========================================================================
//
// Every law in this file so far was written by somebody who went LOOKING for a
// field. That is the shape of all five residual classes Wave W-BS-G enumerated:
// a field is free not because anybody decided it should be, but because nobody
// thought to name it. `usd_decimals` was free for six waves. So was the
// histogram's `note`. So was every byte of `batch`.
//
// The remedy is to stop asking "is this field covered?" one field at a time and
// ask the WHOLE TREE at once. `responseLeaves` walks a body to its leaves —
// through objects, through arrays, to the scalars a reader actually sees — and
// the completeness law below requires every one of them to be in exactly one
// named registry. A leaf in none of them FAILS GENERATION naming its own path.

/**
 * Every leaf of `value` as `[concrete path, leaf value]`, in tree order.
 *
 * An EMPTY ARRAY is a leaf: `held_flat: []` is not the absence of a claim, it
 * is the claim that nothing was held, and a walk that skipped it would leave
 * the emptiest disclosure in the file unpinned.
 */
const responseLeaves = (value, prefix = "", out = []) => {
  if (value === null || typeof value !== "object") {
    out.push([prefix, value]);
    return out;
  }
  if (Array.isArray(value)) {
    if (value.length === 0) {
      out.push([`${prefix}[]`, EMPTY_ARRAY]);
      return out;
    }
    value.forEach((entry, index) => responseLeaves(entry, `${prefix}[${index}]`, out));
    return out;
  }
  for (const key of Object.keys(value)) {
    responseLeaves(value[key], prefix === "" ? key : `${prefix}.${key}`, out);
  }
  return out;
};

/** A concrete leaf path with every array index collapsed: the REGISTRY key. */
const leafPattern = (path) => path.replace(/\[\d+\]/g, "[]");

/** How a leaf reads in a refusal — the sentinel included. */
const leafShown = (value) =>
  value === EMPTY_ARRAY ? "[] (an empty array)" : JSON.stringify(value);

// --- THE EXAMPLE'S OWN ENVELOPE, FROZEN (Wave W-BS-H) ----------------------
//
// `FROZEN_EXAMPLE_BASELINE` froze the example's ARITHMETIC. Its ENVELOPE — the
// batch, the watermarks, the supersession, the coverage sentence, the response
// notes, every engine's `note`, `movers_note`, `projection` and
// `market_realization` — rode in by object spread and was read by nothing. That
// is class A of Wave W-BS-G's enumeration, and it is where a wrong user-visible
// byte was cheapest to produce: a reader is TOLD what the numbers mean by these
// strings, and a batch a reader trusts to be complete is `batch.status`.
//
// Each is frozen below with the example's own bytes as its provenance, and
// `freezeExampleEnvelope` re-proves every one against the freshly-parsed example
// EVERY RUN. It also runs the leaf walk over the example's anchored subtree and
// refuses any anchored leaf this table does NOT name — so the freeze is itself
// complete, and a field the contract example grows cannot arrive unfrozen.
const FROZEN_EXAMPLE_ENVELOPE = new Map([
  ["batch.id", 1],
  ["batch.computed_at", "2026-07-29T10:00:00Z"],
  ["batch.producer", "riskd"],
  ["batch.status", "complete"],
  ["batch.refused_count", 2],
  ["batch.refused_engines[]", EMPTY_ARRAY],
  ["batch.flagged_count", 1],
  ["batch.watermarks[0].engine", "aave_param"],
  ["batch.watermarks[0].chain_id", 1],
  ["batch.watermarks[0].last_block", 25635600],
  ["batch.watermarks[0].acked_epoch", 0],
  ["batch.watermarks[0].max_epoch_at_compute", 0],
  // The engines that run no sweep, and NULL is the disclosure that says so.
  ["batch.watermarks[0].sweep", null],
  ["batch.watermarks[1].engine", "aave_v3_etherfi"],
  ["batch.watermarks[1].chain_id", 1],
  ["batch.watermarks[1].last_block", 25635618],
  ["batch.watermarks[1].acked_epoch", 0],
  ["batch.watermarks[1].max_epoch_at_compute", 0],
  ["batch.watermarks[1].sweep", null],
  ["batch.watermarks[2].engine", "debt_manager"],
  ["batch.watermarks[2].chain_id", 10],
  ["batch.watermarks[2].last_block", 154796552],
  ["batch.watermarks[2].acked_epoch", 0],
  ["batch.watermarks[2].max_epoch_at_compute", 0],
  ["batch.watermarks[2].sweep.rows", 3],
  ["batch.watermarks[2].sweep.failed", 1],
  ["batch.watermarks[2].sweep.success_sum", "309593004"],
  ["batch.watermarks[2].sweep.max_updated_at", "2026-07-29T09:40:00Z"],
  ["batch.watermarks[2].sweep.generation", 4],
  ["batch.watermarks[2].sweep.generation_open", false],
  ["batch.watermarks[3].engine", "prices:poll:1"],
  ["batch.watermarks[3].chain_id", 1],
  ["batch.watermarks[3].last_block", 25635610],
  ["batch.watermarks[3].acked_epoch", 0],
  ["batch.watermarks[3].max_epoch_at_compute", 0],
  ["batch.watermarks[3].sweep", null],
  ["batch.watermarks[4].engine", "prices:poll:10"],
  ["batch.watermarks[4].chain_id", 10],
  ["batch.watermarks[4].last_block", 154796540],
  ["batch.watermarks[4].acked_epoch", 0],
  ["batch.watermarks[4].max_epoch_at_compute", 0],
  ["batch.watermarks[4].sweep", null],
  ["batch.supersession.superseded", false],
  ["batch.supersession.legs[]", EMPTY_ARRAY],
  ["batch.supersession.note", text("b53a04a36de24e4a", "a superseded batch is still served: the flag")],
  ["scenario_config_version", "v1"],
  ["label", "weETH market depeg to 0.95 (oracles held)"],
  ["description", text("aff652caebc34e63", "weETH trades 5 percent below its redemption ")],
  ["path_assumption", text("a33afc9e81f1fd0d", "oracle marks held exactly; market value is a")],
  ["out_of_model[0]", text("9ca6adc0cc1b008e", "oracle lag and heartbeat behaviour during th")],
  ["out_of_model[1]", text("093d256536e771f7", "deviation-trigger discreteness (a feed moves")],
  ["out_of_model[2]", text("4b9449973c74d69c", "liquidator liquidity, gas costs, execution l")],
  ["out_of_model[3]", text("39e2edaa4bb9fb8f", "market correlations not mechanically implied")],
  ["out_of_model[4]", text("db68886bf0d25c81", "intra-sample price wicks: prices are 60-seco")],
  ["out_of_model[5]", text("2c595ee809a728f7", "seizure is modeled PRO-RATA over a position'")],
  ["out_of_model[6]", text("e0669cd5b4647ecc", "market depth: the 0.95 ratio is a flat hairc")],
  ["out_of_model[7]", text("ec0f2aac7bce4f39", "the possibility that a sustained market depe")],
  // WHICH ORACLE HELD EACH MARK. `held_flat` used to be the empty array the
  // ledger recorded as impossible; the repaired example names all three price
  // inputs the book consulted, so there are three sources to pin.
  ["held_flat[0].source", "priceproviderv2"],
  ["held_flat[1].source", text("1ee82a7f1a70f58f", "aaveoracle:0x43b64f28a678944e0655404b0b98e44")],
  ["held_flat[2].source", text("1ee82a7f1a70f58f", "aaveoracle:0x43b64f28a678944e0655404b0b98e44")],
  ["engines[0].movers_note", text("6d8893181d06269d", "RANKED BY HEALTH-FACTOR DROP: before minus a")],
  ["engines[0].market_realization.seizure_model", "pro-rata-over-counted-collateral"],
  ["engines[0].market_realization.note", text("0aebc29e3b500eea", "market value is NOT an oracle mark: this sce")],
  ["engines[0].note", text("f9095d07cfdf6602", "oracle marks held: before and after aggregat")],
  ["engines[1].movers_note", text("df38e79ac9c51cfc", "RANKED BY THE DEBT THAT BECAME ELIGIBLE: onl")],
  ["engines[1].market_realization.seizure_model", "pro-rata-over-counted-collateral"],
  // THE TWO ENGINES CARRY THE SAME SENTENCE, because `p5_runbook.go:612` writes
  // ONE for every engine. The example used to carry two different ones and
  // neither was production's; the divergence is discharged, not recorded.
  ["engines[1].market_realization.note", text("0aebc29e3b500eea", "market value is NOT an oracle mark: this sce")],
  ["engines[1].note", text("f9095d07cfdf6602", "oracle marks held: before and after aggregat")],
  // `excluded_engines[]` is NOT frozen here: law 15 derives it from the withheld
  // roster the derivation composes, so freezing it too would be two registers
  // claiming one leaf — which the completeness law refuses in its own right.
  //
  // `projection` and the realization block's four computed leaves are not here
  // either — Wave W-BS-I moved them to DERIVED. The one this list used to carry
  // is worth naming: `engines[0].market_realization.execution_shortfall_usd` was
  // pinned to "40000000000", $400 of CRITICAL execution shortfall on an engine
  // whose own `eligible_accounts` is 0. The repaired example serves "0" there,
  // because an empty sum IS zero.
  ["coverage.note", text("694dd7a5f727678d", "every position the batch carries is on the w")],
  ["notes[0]", text("a11aaae34adb7eeb", "aggregates are per engine in each engine's O")],
  ["notes[1]", text("fcf5d2e83d46ee83", "deltas are DELTA-ONLY: after minus before, t")],
  ["notes[2]", text("b5f66ac34f04064e", "eligibility, collateral-at-risk and bad-debt")],
]);

/** Assert one frozen envelope entry — literal, sentence or empty array. */
const freezeEnvelopeLeaf = (what, frozen, sourced) => {
  if (frozen !== null && typeof frozen === "object" && !Array.isArray(frozen) && "digest" in frozen) {
    return frozenText(what, frozen.digest, frozen.excerpt, sourced);
  }
  if (frozen === EMPTY_ARRAY || sourced === EMPTY_ARRAY) {
    if (frozen !== sourced) {
      fail(
        `THE FROZEN ${what} is ${leafShown(frozen)}, but the committed source it was frozen from ` +
          `now reads ${leafShown(sourced)} — an empty array is a CLAIM that nothing is there, and ` +
          `it is frozen as firmly as any value`,
      );
    }
    return sourced;
  }
  return frozenLiteral(what, frozen, sourced);
};

/**
 * Re-prove the frozen envelope against the example READ OFF DISK, in BOTH
 * directions — and refuse an anchored leaf the table does not name.
 *
 * Written as a function of the example so its own failure can be WATCHED rather
 * than only asserted (mutant AK).
 */
const freezeExampleEnvelope = (example) => {
  const seen = new Set();
  for (const [path, value] of responseLeaves(example)) {
    // The holding anchor (law 9) owns the itemization's bytes; this freeze owns
    // the ENVELOPE, which is everything a reader is shown that no holding, no
    // aggregate and no disclosure arithmetic accounts for.
    if (RESPONSE_ANCHORED_LEAVES.get(leafPattern(path))?.by !== "response") {
      continue;
    }
    if (!FROZEN_EXAMPLE_ENVELOPE.has(path)) {
      fail(
        `the contract's run-book 200 example carries an ANCHORED envelope leaf this file has never ` +
          `frozen:\n        ${path} = ${leafShown(value)}\n        Every byte a reader is shown ` +
          `answers to a source. Freeze it above with its provenance, or move it to the ` +
          `ENUMERATED-UNPINNED register with a reason a reviewer can reject.`,
      );
    }
    seen.add(path);
    freezeEnvelopeLeaf(`example ${path}`, FROZEN_EXAMPLE_ENVELOPE.get(path), value);
  }
  for (const path of FROZEN_EXAMPLE_ENVELOPE.keys()) {
    if (!seen.has(path)) {
      fail(
        `the frozen envelope pins ${path}, which the contract's run-book 200 example NO LONGER ` +
          `carries — a pin on an absent field forgives the field's absence, so re-review it rather ` +
          `than leaving it here`,
      );
    }
  }
  return FROZEN_EXAMPLE_ENVELOPE;
};

/** floor(amount × price / 10^decimals) — every engine's own valuation. */
const derivedValue = (amount, price, decimals) => (amount * price) / 10n ** BigInt(decimals);

/**
 * The waterfall's own two measures over ONE account (internal/risk/waterfall.go
 * :96-103), written HERE in the derivation's own hand rather than borrowed from
 * the generation half above. Two pens means two arithmetics: a shared helper
 * would make one mistake produce one agreeing pair of numbers.
 */
const derivedAtRisk = (collateral, debt, bonusNum, bonusDen) => {
  const seizable = (debt * bonusNum) / bonusDen;
  return seizable < collateral ? seizable : collateral;
};
const derivedBadDebt = (collateral, debt, bonusNum, bonusDen) => {
  const recoverable = (collateral * bonusDen) / bonusNum;
  return debt > recoverable ? debt - recoverable : 0n;
};

// --- THE REALIZATION AXIS'S MONEY, DERIVED (WAVE W-BS-I) --------------------
//
// `market_realization.execution_shortfall_usd` was in the ANCHORED register as
// "the contract example's own shortfall" — an envelope byte carried in from the
// example. It is nothing of the kind. It is an AGGREGATE OVER THE BOOK, and
// `internal/risk/shortfall.go:97-104` sums it over LIQUIDATABLE POSITIONS ONLY.
// Both collision bodies served the example's `40000000000` on an aave engine
// whose own `eligible_accounts` is 0: $400 of CRITICAL execution shortfall over a
// book with no liquidatable account, on a body the completeness law walks and
// every law read green (Codex round 33, HIGH). The register named the leaf and
// filed it wrong, and a frozen pin kept agreeing with a source that describes a
// DIFFERENT BOOK.
//
// THE ARITHMETIC, in the derivation's own hand (`internal/risk/shortfall.go`
// :49-127 and :166-267, assembled by `cmd/api/p5_runbook.go:500-613`):
//
//   ratios      keyed responseKey(chain, asset) from the COMMITTED scenario's
//               `market_realizations`. A key the axis does NOT name realizes at
//               PAR — the fallback shortfall.go:240-243 spells, not an omission.
//   legs        the position's COUNTED collateral, each at its oracle value.
//   realizable  Sum floor(value x r / WAD), floored PER LEG.
//   seizable    the debt the liquidation bonus lets a liquidator seize.
//   shortfall   max(0, seizable - floor(seizable x Sum(value x r) / (WAD x Sum value)))
//   bad debt    max(0, borrowings - realizable)
//
// and BOTH aggregates are summed over the LIQUIDATABLE positions of the BEFORE
// side alone: production runs the whole computation on `beforeInputs`.
//
// WHAT THIS DERIVATION CAN AND CANNOT COMPOSE, stated rather than papered over.
// `seizable` needs each engine's liquidation bonus, and no frozen source in this
// file carries the Debt Manager's. So the shortfall term is composed through the
// two CLOSED FORMS that are exact identities of the arithmetic above, and the
// derivation REFUSES rather than guesses outside them:
//
//   no liquidatable position    the sum is EMPTY. Zero eligible accounts, zero
//                               aggregate realization shortfall — the invariant
//                               round 33's finding violated, and it holds
//                               whatever the ratios are.
//   every counted leg at PAR    Sum(value x r) is exactly WAD x Sum value, so the
//                               fused floor returns `seizable` unchanged and the
//                               gap is zero FOR ANY seizable. No bonus needed.
//
// The bad-debt term needs no bonus at all — only the borrowings and the realized
// collateral — so it is composed whenever the engine carries ONE account, which
// is the condition under which an engine aggregate IS the single position's
// figure. An aggregate over more than one cannot be decomposed into the
// per-position sum production performs, and the derivation says so and stops.

/** The realization wad's unit — `risk.WadUnit()`, the ratio 1.00 exactly. */
const DERIVED_REALIZATION_PAR = 1_000_000_000_000_000_000n;

/** The committed axis keyed the way production keys it (shortfall.go:50-62). */
const derivedRealizationRatios = (what, axis) => {
  const ratios = new Map();
  for (const row of axis) {
    const key = responseKey(row.chain_id, row.asset);
    const wad = BigInt(row.market_over_oracle_wad);
    if (wad <= 0n) {
      fail(
        `${what}: the committed realization axis gives ${key} a market_over_oracle_wad of ` +
          `${String(wad)}, which shortfall.go:52-55 refuses as non-positive`,
      );
    }
    if (ratios.has(key)) {
      fail(
        `${what}: the committed realization axis names ${key} TWICE, which shortfall.go:57-60 ` +
          `refuses as a duplicate market realization`,
      );
    }
    ratios.set(key, wad);
  }
  return ratios;
};

/**
 * One engine's `market_realization`, composed from the frozen sources — the
 * VALUES and the sentence each one answers to, so a refusal names the reason and
 * not only the number.
 */
const derivedMarketRealization = (
  what,
  { axis, chainId, legs, borrowings, accounts, eligibleAccounts, usdDecimals, bonus },
) => {
  const ratios = derivedRealizationRatios(what, axis);
  let realizable = 0n;
  let marked = 0n;
  let atPar = true;
  for (const leg of legs) {
    const ratio = ratios.get(responseKey(chainId, leg.asset)) ?? DERIVED_REALIZATION_PAR;
    if (ratio !== DERIVED_REALIZATION_PAR) {
      atPar = false;
    }
    marked += leg.value;
    realizable += (leg.value * ratio) / DERIVED_REALIZATION_PAR;
  }

  const shared = { hfs_unchanged: true, usd_decimals: usdDecimals };
  const sharedWhy = {
    hfs_unchanged:
      "the market-realization pass COPIES the position and writes no price input " +
      "(internal/risk/shortfall.go:145-158), so both health computations read identical inputs and " +
      "production's own bit-for-bit comparison comes out true; a body serving false claims that " +
      "guard FIRED",
    usd_decimals:
      "the shortfall is READ at this engine's own frozen serializer constant, the same one " +
      "engines[].usd_decimals carries (cmd/api/p5_runbook.go:602-610)",
  };

  if (eligibleAccounts === 0) {
    return {
      values: { ...shared, execution_shortfall_usd: "0", bad_debt_at_liquidation_usd: "0" },
      why: {
        ...sharedWhy,
        execution_shortfall_usd:
          "the aggregate is summed over LIQUIDATABLE positions ONLY " +
          "(internal/risk/shortfall.go:97-104) and this engine's BEFORE side carries 0 eligible " +
          "accounts, so the sum is EMPTY: zero eligible accounts, zero aggregate realization shortfall",
        bad_debt_at_liquidation_usd:
          "the same empty sum: no position on this engine's BEFORE side is liquidatable, so none " +
          "contributes bad debt at liquidation",
      },
    };
  }
  if (accounts !== 1 || eligibleAccounts !== 1) {
    fail(
      `${what}: the derivation cannot compose a realization aggregate over ${String(accounts)} ` +
        `accounts of which ${String(eligibleAccounts)} are eligible — production sums it PER ` +
        `POSITION over the liquidatable ones (internal/risk/shortfall.go:97-104), and an engine ` +
        `aggregate over more than one account does not decompose into that sum`,
    );
  }
  if (atPar) {
    // THE PAR CLOSED FORM, kept because it needs NO bonus at all: Sum(value x r)
    // is exactly WAD x Sum value, so the fused floor returns `seizable`
    // unchanged whatever `seizable` is, and the gap closes for any bonus.
    return {
      values: {
        ...shared,
        execution_shortfall_usd: "0",
        bad_debt_at_liquidation_usd: (
          borrowings > realizable ? borrowings - realizable : 0n
        ).toString(),
      },
      why: {
        ...sharedWhy,
        execution_shortfall_usd:
          `every counted leg realizes at PAR — the committed axis names no key this engine ` +
          `itemizes — so Sum(value x r) is exactly WAD x ${String(marked)} and the fused floor ` +
          `returns seizable unchanged: the gap is zero for ANY seizable`,
        bad_debt_at_liquidation_usd:
          `the ONE liquidatable account's frozen borrowings ${String(borrowings)} less what its ` +
          `counted collateral realizes at the committed ratios, ${String(realizable)}`,
      },
    };
  }
  // THE DISCOUNTED FORM (Wave W-EX-A). It needs the SEIZABLE term, and therefore
  // the engine's liquidation bonus — which this derivation refused to guess
  // until the repaired contract example made the case reachable: its Debt
  // Manager holds the DM's real weETH on chain 10, and the committed
  // market-realization axis DISCOUNTS exactly that key to 0.95.
  //
  // The bonus is not typed in here. `ENGINE_SEIZURE_BONUS` reads each engine's
  // from the same committed sources this file already derives thresholds with,
  // and the caller passes the pair, so a bonus that moved would move in one place.
  if (bonus === undefined) {
    fail(
      `${what}: this engine has a liquidatable position AND a counted leg the committed axis ` +
        `DISCOUNTS, so the shortfall needs the SEIZABLE term — and the caller declared no ` +
        `liquidation bonus for it. Declare the bonus with its provenance; do not let a figure ` +
        `ride in from a body`,
    );
  }
  const [bonusNum, bonusDen] = bonus;
  // `seizableValue` (internal/risk/dm.go:385-401): per leg, the debt's share of
  // that leg times the bonus, capped at the leg's own value, then summed.
  let seizable = 0n;
  if (marked > 0n) {
    for (const leg of legs) {
      const share = (borrowings * leg.value * bonusNum) / (marked * bonusDen);
      seizable += share < leg.value ? share : leg.value;
    }
  }
  // ONE fused floor: seizable x Sum(value·r) / (WAD x Sum value).
  let weighted = 0n;
  for (const leg of legs) {
    weighted += leg.value * (ratios.get(responseKey(chainId, leg.asset)) ?? DERIVED_REALIZATION_PAR);
  }
  const seizableMarket = marked > 0n ? (seizable * weighted) / (DERIVED_REALIZATION_PAR * marked) : 0n;
  return {
    values: {
      ...shared,
      execution_shortfall_usd: (
        seizable > seizableMarket ? seizable - seizableMarket : 0n
      ).toString(),
      bad_debt_at_liquidation_usd: (
        borrowings > realizable ? borrowings - realizable : 0n
      ).toString(),
    },
    why: {
      ...sharedWhy,
      execution_shortfall_usd:
        `the ONE liquidatable account's seizable value at the oracle mark, ${String(seizable)} — ` +
        `its borrowings ${String(borrowings)} at the committed ${String(bonusNum)}/` +
        `${String(bonusDen)} bonus, capped per leg at that leg's own value — less what the same ` +
        `seizure realizes at the committed market ratios, ${String(seizableMarket)}`,
      bad_debt_at_liquidation_usd:
        `the ONE liquidatable account's frozen borrowings ${String(borrowings)} less what its ` +
        `counted collateral realizes at the committed ratios, ${String(realizable)}`,
    },
  };
};

/**
 * The bucket an EXACT RATIONAL lands in, in the derivation's own hand: the
 * server's own cross-multiplied test, `lower × den <= num × scale < upper × den`,
 * with no division and therefore no rounding anywhere to launder a placement.
 */
const derivedBucket = (shape, num, den) => {
  const scale = BigInt(shape.wad_scale);
  for (const bucket of shape.buckets) {
    const aboveLower = bucket.lower_wad === null || BigInt(bucket.lower_wad) * den <= num * scale;
    const belowUpper = bucket.upper_wad === null || num * scale < BigInt(bucket.upper_wad) * den;
    if (aboveLower && belowUpper) {
      return bucket.label;
    }
  }
  return fail(`the derivation places the rational ${String(num)}/${String(den)} in NO bucket`);
};

/**
 * A DERIVED HISTOGRAM (Wave W-BS-F, second pass).
 *
 * `checkSide` already pins a histogram's total to `accounts` and its sub-1.00
 * region to `eligible_accounts`, and the mover laws pin whichever buckets a
 * mover's own rational names. That leaves a body free to move a count BETWEEN
 * TWO BUCKETS ABOVE THE 1.00 EDGE whenever no mover names either — which the
 * collision pair, one account and no movers, is exactly the shape of. So the
 * census is drawn here too.
 *
 *   `shape`       bucket LABELS, EDGES and the wad scale — structure no scenario
 *                 rewrites — taken from the frozen contract example.
 *   `carried`     the frozen histogram whose counts this side starts from, or
 *                 null for a side this derivation re-measures from scratch.
 *   `placements`  one EXACT rational per account the derivation models, each
 *                 dropped where the server's own test drops it.
 *   `meta`        the three fields the SERIALIZER owns rather than measures —
 *                 `comparator`, `refused_count`, `note` — composed by
 *                 `frozenHistogramMeta` from the engine's frozen constants and
 *                 the refusal census (Wave W-BS-G, finding 1).
 */
const derivedHistogram = (shape, carried, placements, meta) => {
  const counts = new Map(
    shape.buckets.map((bucket) => {
      if (carried === null) {
        return [bucket.label, 0];
      }
      const start = carried.buckets.find((entry) => entry.label === bucket.label);
      if (start === undefined) {
        fail(`the carried histogram has no bucket labelled ${bucket.label}`);
      }
      return [bucket.label, start.count];
    }),
  );
  for (const [num, den] of placements) {
    const label = derivedBucket(shape, num, den);
    counts.set(label, counts.get(label) + 1);
  }
  return {
    comparator: meta.comparator,
    wad_scale: String(shape.wad_scale),
    infinite_count: carried === null ? 0 : carried.infinite_count,
    refused_count: meta.refused_count,
    note: meta.note,
    buckets: shape.buckets.map((bucket) => ({
      label: bucket.label,
      lower_wad: bucket.lower_wad,
      upper_wad: bucket.upper_wad,
      count: counts.get(bucket.label),
    })),
  };
};

/**
 * THE CARRY IS GONE (Wave W-EX-A), and this note is its receipt.
 *
 * `carriedCensus` used to live here. It let a derivation START from the contract
 * example's own histogram census instead of composing one, for a recorded
 * reason: the example drew its aave account in `1.10 - 1.25` where the
 * contract's own /v1/params threshold (8100 bps on 800000000000 against
 * 600000000000 = 1.08) puts it in `1.05 - 1.10`, and drew its Debt Manager
 * account in `0.90 - 1.00` where 3200000000/4620000000 = 0.6926 puts it in
 * `< 0.90`. Two committed artifacts disagreed and this file had no standing to
 * rewrite either.
 *
 * The carry was built with teeth: it re-proved every run that the derivation and
 * the carried census still DISAGREED, and stopped generation demanding its own
 * deletion the moment they agreed. Wave W-EX-A repaired the example by CAPTURING
 * it from the running handler, both placements came out where this derivation
 * puts them, and both entries fired on the first run afterwards. Mutants AE and
 * AF went with them: each existed to watch one carry discharge, and a probe of a
 * licence nobody holds proves nothing.
 *
 * Every histogram this file derives is now placed entirely by the exact
 * rationals the accounts' own arithmetic produces.
 */

/**
 * ONE FROZEN PRICED INPUT, valued on BOTH SIDES through the committed matrix.
 *
 * THE SOURCE SIDE IS `before`. `ApplyScenario` is given the batch's own prices,
 * clones the position, and REWRITES the prices (scenario.go:677-745) — so the
 * before side carries the price the evaluator was given and the after side
 * carries `floor(price × factor)`, in that order and never the reverse. That
 * direction is what round 31's wrong-side probe inverted, and it is the reason
 * an absolute source-side price has to be frozen rather than read back out of
 * whichever side the body happens to publish.
 *
 * `price: null` is a row with NO price witness — unpriced, or not counted as
 * collateral. There is nothing for a scenario to move and nothing to value.
 */
const derivedRow = (matrix, chainId, row) => {
  const declared = matrix.rows.get(responseKey(chainId, row.asset));
  const [num, den] = declared === undefined ? [1n, 1n] : matrix.composedFactor(declared);
  const before = row.price === null ? null : derivedValue(row.amount, row.price, row.decimals);
  const after =
    row.price === null ? null : derivedValue(row.amount, (row.price * num) / den, row.decimals);
  return { key: `${row.asset}::${row.disclosure}`, before, after };
};

/**
 * The derived itemization of one engine, both sides at once: a Map from the
 * server's own `asset::disclosure` row key to that side's derived `value_usd`,
 * plus the counted sum the aggregate has to publish as `total_collateral_usd`.
 */
const derivedItemization = (matrix, chainId, rows) => {
  const derived = rows.map((row) => derivedRow(matrix, chainId, row));
  const sideOf = (side) => {
    const values = new Map();
    let counted = 0n;
    for (const row of derived) {
      if (values.has(row.key)) {
        fail(`the derivation composes ${row.key} TWICE, so it expects two rows for one identity`);
      }
      values.set(row.key, row[side]);
      if (row[side] !== null) {
        counted += row[side];
      }
    }
    return { values, counted };
  };
  return { before: sideOf("before"), after: sideOf("after") };
};

/**
 * THE BODY AGAINST THE DERIVATION.
 *
 * Every comparison below is `what the frozen sources say` vs `what the body
 * serves`, and the derivation's half was composed before the body was read. A
 * mismatch is therefore never a disagreement between two readings of the same
 * bytes: it is the body claiming something the sources do not support.
 */
const checkDerivation = (name, response, derivation) => {
  if (derivation === undefined) {
    fail(
      `${name} is checked with NO derivation — a body whose expected values are never composed ` +
        `from the frozen sources is a body vouching for itself, which is the whole class of ` +
        `defect wave W-BS-F exists to close`,
    );
  }
  // THE BODY IS ANSWERING THE SCENARIO THE DERIVATION MODELLED. Everything below
  // is composed through ONE committed propagation matrix; a body that says it
  // answers a different scenario is being measured against the wrong physics.
  if (
    response.scenario_id !== derivation.scenario_id ||
    response.scenario_version !== derivation.scenario_version
  ) {
    fail(
      `${name} says it answers ${response.scenario_id}@${response.scenario_version}, but the ` +
        `derivation composed its expected values under ` +
        `${derivation.scenario_id}@${derivation.scenario_version}`,
    );
  }
  // THE ENGINE SET IS THE DERIVATION'S, IN ORDER. This is round 31's second
  // finding read from the front: a body may not answer for fewer engines than
  // the run covers, and a per-engine loop can never say so about an engine that
  // is not in it.
  const served = response.engines.map((engine) => engine.engine);
  const expected = derivation.engines.map((engine) => engine.engine);
  if (served.join(" ") !== expected.join(" ")) {
    fail(
      `${name} serves engines [${served.join(", ")}] but the derivation, composed from the frozen ` +
        `sources alone, expects [${expected.join(", ")}] — an engine is not a row a body may drop`,
    );
  }

  for (const [index, want] of derivation.engines.entries()) {
    const engine = response.engines[index];
    const label = `${name} ${engine.engine}`;

    // THE ENGINE'S OWN USD SCALE (Wave W-BS-G, finding 1). Every money figure
    // this engine publishes is read at this exponent, so it is not decoration:
    // moving the Debt Manager's 6 to 18 leaves every total, every delta and
    // every law in this file untouched and renders $6,500.00 as $0.0000000065.
    // It is the serializer's own constant, so the derivation composes it.
    if (String(engine.usd_decimals) !== want.usd_decimals) {
      fail(
        `${label} publishes usd_decimals ${JSON.stringify(engine.usd_decimals)}, but the ` +
          `derivation composes ${want.usd_decimals} from the serializer's own frozen constant — ` +
          `an engine's USD scale is what every number it serves is READ at, not a label`,
      );
    }

    // THE REALIZATION AXIS'S MONEY (Wave W-BS-I, Codex round 33 HIGH). Composed
    // from the frozen holdings, the frozen borrowings and the COMMITTED
    // realization ratios — never carried from the example, which is how a
    // CRITICAL execution shortfall came to ride on a book with no liquidatable
    // account. WHETHER the block is present belongs to law 16 and the committed
    // scenario's own axis; what is inside it belongs here.
    if (!("market_realization" in want)) {
      fail(
        `${label}'s derivation composes no market_realization at all — the axis's money is DERIVED, ` +
          `and a body whose shortfall nothing composes is a body publishing somebody else's book`,
      );
    }
    if (want.market_realization !== null) {
      const realization = engine.market_realization;
      if (realization === null || realization === undefined) {
        fail(
          `${label} serves market_realization ${shown(realization)}, but the derivation composes ` +
            `this engine's own realization figures from the committed axis — the shortfall is not a ` +
            `field a body may drop`,
        );
      }
      for (const [field, value] of Object.entries(want.market_realization.values)) {
        if (String(realization[field]) !== String(value)) {
          fail(
            `${label} publishes market_realization.${field} ${shown(realization[field])}, but the ` +
              `derivation composes ${shown(value)} — ${want.market_realization.why[field]}`,
          );
        }
      }
    }

    for (const side of ["before", "after"]) {
      const got = engine[side];
      const wantSide = want[side];

      // THE PER-ROW VALUE. `value_usd` is the one field the holding anchor
      // cannot pin, because it is the one field `ApplyScenario` writes — so it
      // is pinned HERE instead, by re-valuing the frozen amount at the frozen
      // SOURCE-SIDE price carried through the committed matrix's own factor.
      const rows = new Map(
        got.collateral_by_asset.map((entry) => [`${entry.asset}::${disclosureOf(entry)}`, entry]),
      );
      for (const [key, value] of wantSide.values) {
        const entry = rows.get(key);
        if (entry === undefined) {
          fail(
            `${label} ${side} serves NO row for ${key}, which the derivation composes from the ` +
              `frozen sources`,
          );
        }
        const stated = entry.value_usd === null ? null : BigInt(entry.value_usd);
        if (stated !== value) {
          fail(
            `${label} ${side} serves value_usd ${JSON.stringify(entry.value_usd)} for ${key}, but ` +
              `the derivation values its ${entry.amount} at the FROZEN source-side price through ` +
              `the committed matrix and gets ${value === null ? "null" : value.toString()}`,
          );
        }
      }
      for (const key of rows.keys()) {
        if (!wantSide.values.has(key)) {
          fail(
            `${label} ${side} serves ${key}, which the derivation composes no row for — every row ` +
              `of a generated body comes from a frozen source or from a frozen injected literal`,
          );
        }
      }

      // THE AGGREGATE. Each field is composed from the frozen sources through
      // this guard's own arithmetic — the census, the eligibility test, the
      // money and the waterfall's two measures — never read off the body.
      for (const [field, value] of Object.entries(wantSide.aggregate)) {
        if (String(got[field]) !== value) {
          fail(
            `${label} ${side} publishes ${field} ${JSON.stringify(got[field])}, but the derivation ` +
              `composes ${value} from the frozen sources`,
          );
        }
      }

      // THE CENSUS, DRAWN. Every account this derivation models is placed in the
      // bucket the server's own test places it in, and every other bucket is
      // held at the frozen count it carried — so there is no bucket left that a
      // body can move a count into without saying so.
      const gotHistogram = got.hf_histogram;
      const wantHistogram = wantSide.histogram;
      // WHAT THE BUCKETS ARE COMPUTED ON (Wave W-BS-G, finding 1). The
      // comparator is the difference between "these are the pool's own health
      // factors" and "these are a rational the Debt Manager discloses and does
      // not liquidate on". Both bodies carried it by spread and no law read it,
      // so both engines could claim `hf_wad` at once.
      if (String(gotHistogram.comparator) !== wantHistogram.comparator) {
        fail(
          `${label} ${side} publishes an hf_histogram comparator of ` +
            `${JSON.stringify(gotHistogram.comparator)}, but the derivation composes ` +
            `${JSON.stringify(wantHistogram.comparator)} from this engine's own serializer — a ` +
            `comparator names WHICH quantity the buckets measure, and no engine may borrow another's`,
        );
      }
      // THE REFUSALS THIS SIDE COUNTS. `refused_count` is positions on a covered
      // engine that reached the run WITHOUT numbers — the rows the BATCH refused
      // plus the rows THIS LAYER could not rebuild — added to both sides. It is
      // composed from that two-part census rather than restated. A count with no
      // refused row behind it invents positions the run never saw.
      if (gotHistogram.refused_count !== wantHistogram.refused_count) {
        fail(
          `${label} ${side} publishes an hf_histogram refused_count of ` +
            `${JSON.stringify(gotHistogram.refused_count)}, but the derivation composes ` +
            `${String(wantHistogram.refused_count)} from the run's own refusal census — a refused ` +
            `position is a row the batch refused or a row coverage.excluded names, and this side ` +
            `counts rows from neither`,
        );
      }
      // THE SENTENCE THE PAGE RENDERS. It is the disclosure a reader is given
      // for the distribution beside it, and it was pinned by nothing.
      if (gotHistogram.note !== wantHistogram.note) {
        fail(
          `${label} ${side} publishes the hf_histogram note ` +
            `${JSON.stringify(gotHistogram.note)}, but the derivation composes the frozen sentence ` +
            `${JSON.stringify(wantHistogram.note)} — the note is what a reader is TOLD the buckets ` +
            `mean, so it answers to a source like every other disclosure`,
        );
      }
      if (String(gotHistogram.wad_scale) !== wantHistogram.wad_scale) {
        fail(
          `${label} ${side} publishes an hf_histogram at wad_scale ` +
            `${JSON.stringify(gotHistogram.wad_scale)}, but the derivation's frozen shape reads ` +
            `${wantHistogram.wad_scale}`,
        );
      }
      if (gotHistogram.buckets.length !== wantHistogram.buckets.length) {
        fail(
          `${label} ${side} publishes ${String(gotHistogram.buckets.length)} hf_histogram buckets, ` +
            `but the derivation's frozen shape carries ${String(wantHistogram.buckets.length)}`,
        );
      }
      for (const [index, wantBucket] of wantHistogram.buckets.entries()) {
        const bucket = gotHistogram.buckets[index];
        if (
          bucket.label !== wantBucket.label ||
          String(bucket.lower_wad) !== String(wantBucket.lower_wad) ||
          String(bucket.upper_wad) !== String(wantBucket.upper_wad)
        ) {
          fail(
            `${label} ${side} hf_histogram bucket ${String(index)} is ` +
              `${JSON.stringify(bucket.label)} [${JSON.stringify(bucket.lower_wad)}, ` +
              `${JSON.stringify(bucket.upper_wad)}), but the derivation's frozen shape carries ` +
              `${JSON.stringify(wantBucket.label)} [${JSON.stringify(wantBucket.lower_wad)}, ` +
              `${JSON.stringify(wantBucket.upper_wad)})`,
          );
        }
        if (bucket.count !== wantBucket.count) {
          fail(
            `${label} ${side} counts ${String(bucket.count)} accounts in hf_histogram bucket ` +
              `${JSON.stringify(bucket.label)}, but the derivation places ` +
              `${String(wantBucket.count)} there`,
          );
        }
      }
      if (gotHistogram.infinite_count !== wantHistogram.infinite_count) {
        fail(
          `${label} ${side} publishes infinite_count ${JSON.stringify(gotHistogram.infinite_count)}, ` +
            `but the derivation composes ${String(wantHistogram.infinite_count)}`,
        );
      }
    }

    // THE MOVERS ARE THE ACCOUNTS THAT MOVED. Round 31's third finding: the
    // shape, the rationals, the factor and the bucket were all anchored and the
    // IDENTITY was not, so any valid address served — and the same one served
    // twice. The set is derived: exactly the accounts whose frozen inputs flip
    // or drop under the derivation, each named ONCE.
    const accounts = engine.movers.map((mover) => mover.account);
    const unique = new Set(accounts);
    if (unique.size !== accounts.length) {
      fail(
        `${label} ranks the same mover account TWICE (${accounts.join(", ")}) — a mover IS an ` +
          `account, and an account moves once under one scenario`,
      );
    }
    for (const account of accounts) {
      if (!want.movers.has(account)) {
        fail(
          `${label} ranks a mover for ${account}, which the derivation does not name — the ` +
            `accounts that move under this scenario are composed from the frozen sources, and ` +
            `this is not one of them`,
        );
      }
    }
    for (const account of want.movers) {
      if (!unique.has(account)) {
        fail(
          `${label} ranks NO mover for ${account}, which the derivation's own arithmetic says ` +
            `moves under this scenario — a mover a body drops is evidence it withheld`,
        );
      }
    }
    if (String(engine.movers_total) !== String(want.movers_total)) {
      fail(
        `${label} publishes movers_total ${JSON.stringify(engine.movers_total)}, but the ` +
          `derivation composes ${String(want.movers_total)} moving accounts from the frozen sources`,
      );
    }

    // THE MOVER'S OWN NUMBERS ARE THE DERIVATION'S TOO. A mover row publishes
    // the same measurement its aggregate does, a second time and in the engine's
    // own unit — and until now that second copy answered only to the body's own
    // disclosed factor (law 7) and to the committed excerpt it was transcribed
    // from. The derivation computes those numbers ITSELF, from the FROZEN
    // liquidation threshold and the FROZEN source-side price, and the row is
    // held to them exactly: the same threshold that decides eligibility decides
    // the wad and decides the rational.
    //
    // EVERY DERIVED MOVER CARRIES DERIVED FIELDS (Wave W-BS-G, finding 2). The
    // first cut of this loop iterated `want.moverFields ?? {}` — a per-ENGINE
    // object — and the Debt Manager's derivation supplied none, so the loop ran
    // over an empty object and the DM mover's rationals were pinned by nothing
    // but law 7's quotient. The prior wave DISCLOSED that omission and asserted
    // laws 7 and 12 covered it; Codex round 32 falsified the rationals inside
    // both laws and the disclosure with them. A disclosed omission backed by an
    // untested belief is a vacuous green waiting to be constructed, so the
    // absence of derived fields for a derived mover is now itself a refusal.
    const moverFields = want.moverFields;
    if (!(moverFields instanceof Map)) {
      fail(
        `${label} is checked against a derivation whose mover fields are not a per-ACCOUNT map — ` +
          `a mover's numbers belong to the account that moved, and a per-engine object cannot say ` +
          `which account it describes`,
      );
    }
    for (const account of want.movers) {
      if (!moverFields.has(account)) {
        fail(
          `${label} is checked against a derivation that names ${account} a mover and composes NO ` +
            `field for it — an unwatched mover row is a number this file never derived, which is ` +
            `exactly the empty loop Codex round 32 walked through`,
        );
      }
    }
    for (const mover of engine.movers) {
      for (const [field, value] of Object.entries(moverFields.get(mover.account) ?? {})) {
        if (String(mover[field]) !== value) {
          fail(
            `${label} mover ${mover.account} publishes ${field} ${JSON.stringify(mover[field])}, ` +
              `but the derivation composes ${value} from the frozen liquidation threshold and the ` +
              `frozen source-side price`,
          );
        }
      }
    }
  }

  // THE COVERAGE CENSUS. `batch_positions` and `in_book` are the run's own count
  // of rows, and this generator changes them only by the accounts it injects —
  // so both are composed as `the example's own count + what was injected`.
  for (const [field, value] of Object.entries(derivation.coverage)) {
    if (String(response.coverage[field]) !== value) {
      fail(
        `${name} coverage.${field} is ${JSON.stringify(response.coverage[field])}, but the ` +
          `derivation composes ${value} from the frozen example plus the rows this generator ` +
          `injects`,
      );
    }
  }
  if (String(response.batch.position_count) !== derivation.coverage.batch_positions) {
    fail(
      `${name} batch.position_count is ${JSON.stringify(response.batch.position_count)}, but the ` +
        `derivation composes ${derivation.coverage.batch_positions}`,
    );
  }

  // THE REFUSAL ROSTER IS THE CENSUS, NAMED (Wave W-BS-G). A side's
  // `refused_count`, `coverage.excluded_by_this_layer` and `coverage.excluded[]`
  // are ONE set of rows read three ways (handlers.go:700-714, p5_runbook.go
  // :418-430, 578-583), and `stress_coverage_is_full` is the contract's own
  // conjunction over the last two plus the withheld engines. Deriving
  // `refused_count` alone would have left the roster free: a body could LIST an
  // excluded position while TOTALLING none and every histogram would still read
  // zero refusals, which is two different runs disclosed on one page.
  const excludedEngines = response.coverage.excluded.map((entry) => entry.engine);
  if (excludedEngines.join(" ") !== derivation.excluded.join(" ")) {
    fail(
      `${name} coverage.excluded names [${excludedEngines.join(", ")}], but the derivation composes ` +
        `[${derivation.excluded.join(", ")}] from the frozen refusal census — the same rows each ` +
        `side counts as refused_count, so a roster and a count cannot disagree`,
    );
  }
  if (String(response.coverage.excluded.length) !== derivation.coverage.excluded_by_this_layer) {
    fail(
      `${name} coverage lists ${String(response.coverage.excluded.length)} excluded positions under ` +
        `an excluded_by_this_layer of ${derivation.coverage.excluded_by_this_layer} — the total IS ` +
        `the length of the roster beside it`,
    );
  }
  const withheldEngines = response.coverage.withheld_engines.map((entry) => entry.engine);
  if (withheldEngines.join(" ") !== derivation.withheld.join(" ")) {
    fail(
      `${name} coverage.withheld_engines names [${withheldEngines.join(", ")}], but the derivation ` +
        `composes [${derivation.withheld.join(", ")}] — a withheld engine is one whose whole book ` +
        `is refused, and this response serves every engine the derivation covers`,
    );
  }
  // The contract's own fail-closed rule, recomputed rather than trusted.
  const coverageIsFull =
    response.coverage.excluded.length === 0 && response.coverage.withheld_engines.length === 0;
  if (response.coverage.stress_coverage_is_full !== coverageIsFull) {
    fail(
      `${name} publishes stress_coverage_is_full ` +
        `${JSON.stringify(response.coverage.stress_coverage_is_full)}, but its own roster makes it ` +
        `${String(coverageIsFull)} — the claim is the conjunction "nothing excluded AND nothing ` +
        `withheld", never an independent assertion`,
    );
  }
};

/**
 * The laws that live ABOVE one side: the response's own account census against
 * the coverage it publishes, and each engine's deltas against its two sides.
 *
 * `coverage.in_book` is the count of positions that reached the run
 * (cmd/api/p5_runbook.go: `coverage(v.Positions, len(beforeInputs), refused)`),
 * and every one of those positions is counted exactly once by its engine's
 * `accounts`. So the two are the SAME number read two ways, and a book whose
 * engines name more accounts than the run admits is describing a different book
 * from the one its coverage describes.
 */
/**
 * THE PROPAGATION GUARD (Wave W-BS-C).
 *
 * `checkSide` and the census laws above check that a body agrees WITH ITSELF.
 * They cannot see the defect this guard exists for, because that defect is a
 * body that is internally perfect and externally impossible: every price it
 * moves has to be a price `risk.ApplyScenario` would have moved, by the factor
 * the committed propagation matrix composes, and every price it holds still has
 * to be one the matrix does not describe.
 *
 * The prices are never divided out. A holding's implied price is the exact
 * rational `value_usd / amount`, so "did the price move" is
 * `Vb × Aa ≠ Va × Ab` and "did it move by n/d" is `Va × Ab × d = Vb × Aa × n` —
 * cross-multiplied, with no floor anywhere to launder a discrepancy.
 *
 * THE LAWS, over every engine's itemization and every mover it publishes:
 *
 *   1. CHANGED ⇒ DISCLOSED. A price implied changed between the two sides must
 *      carry an `applied_shocks` entry. This is the law the invented account
 *      broke: it moved 70/100 and disclosed nothing.
 *   2. ABSENT ⇒ UNCHANGED. An asset with no `applied_shocks` entry must be
 *      bit-identical across the sides. Held flat is a claim, and the aggregates
 *      have to keep it.
 *   3. DISCLOSED ⇒ MOVED. An `applied_shocks` entry whose asset did not move is
 *      a shock with nothing behind it. This is the law the grafted aave row
 *      broke: the disclosure named a 70/100 move on an aggregate that never
 *      changed.
 *   4. THE FACTOR IS THE MATRIX'S. A disclosed factor must equal the factor
 *      `composedFactor` derives for that (chain, asset) from the committed
 *      propagation matrix, AND the itemization must have moved by exactly it.
 *      A shock on an asset the matrix does not name is refused outright.
 *   5. DECLARED ⇒ SHOCKED. An asset the matrix DOES name cannot sit still while
 *      the scenario shocks the axis it responds to. This is the other half of
 *      the same impossibility, and it is what forces the aave engine to be
 *      re-measured rather than carried over.
 *   6. HELD FLAT IS TRUE. Every `held_flat` entry names a price input NO
 *      propagation row described (`api/openapi.yaml`'s own words for the field),
 *      and its asset is unchanged wherever the body carries it.
 *   7. THE MOVERS AGREE. A mover's own numbers imply a factor too — the aave
 *      wads and the Debt Manager's maxBorrowLT rationals both scale with the
 *      collateral that moved — and it must be a factor the body disclosed. A
 *      mover row is also placed in a bucket its side actually populated.
 *
 * WAVE W-BS-D. Laws 1-7 are all RATIOS. Every one of them asks whether a price
 * MOVED and by how much, and a mutation that preserves every ratio is invisible
 * to all seven — four such mutations were exercised against clones of the body
 * below and all four passed. Movement is only half of what `ApplyScenario` does;
 * the other half is what it REFUSES to do. It clones the balances and the debt
 * and rewrites ONLY prices (scenario.go:677-745, 762-777), so the laws of
 * CONSERVATION and COMPLETENESS join the laws of movement:
 *
 *   8. THE HOLDINGS ARE THE SAME HOLDINGS. The (asset, disclosure) key set of
 *      `collateral_by_asset` is IDENTICAL across the two sides. A shock cannot
 *      create a holding, destroy one, or RECLASSIFY one from counted to
 *      unpriced. The old guard skipped any entry present on one side only, so
 *      deleting a holding was a free move. If a real reclassification case is
 *      ever found, it must be introduced DELIBERATELY, with its own law and its
 *      own provenance — never allowed through this silence again.
 *   9. THE HOLDINGS ARE ANCHORED (rebuilt in Wave W-BS-E). `amount`,
 *      `decimals`, `symbol`, `unpriced` and `note` are pinned to the caller's
 *      declared ANCHOR — the contract example's untouched bytes plus the rows
 *      this generator explicitly injects — and BOTH sides must equal it. Only
 *      `value_usd` moves, by exactly the disclosed factor (laws 4 and 10).
 *
 *      The first cut of this law compared the two SIDES TO EACH OTHER, and
 *      Codex round 30 showed what that misses. Swapping the amounts of the
 *      collision fixture's two rows ON BOTH SIDES leaves every corresponding
 *      pair identical: the counted row and the not-counted row simply trade
 *      balances, the sums still balance, and the book serves holdings nobody
 *      put there. `unpriced` and `note` were read by no law at all, so a
 *      ONE-SIDED edit to either was free. An anchor answers all three, because
 *      it is not derived from the body it judges.
 *  10. THE DISCLOSED PRICE IS THE ITEMIZATION'S OWN. A disclosure is not only a
 *      ratio. `value_usd = floor(amount × price / 10^decimals)` is the engine's
 *      own valuation, so an `applied_shocks` before/after pair and a `held_flat`
 *      value have to reproduce the itemization's ABSOLUTE numbers on both sides,
 *      not merely a matching quotient.
 *  11. HELD FLAT IS EXHAUSTIVE, AND NOTHING FLOATS FREE. Law 6 bounds what
 *      `held_flat` may CLAIM; this is its completeness half. `ApplyScenario`
 *      records EVERY price input the matrix does not describe on `HeldFlat`
 *      (scenario.go:679-686), so every PRICED holding this body itemizes whose
 *      key the matrix does not name MUST appear in `held_flat` — deleting a held
 *      disclosure is not a smaller truth, it is a different book. In the other
 *      direction, a `held_flat` entry no itemization witnesses is a name with
 *      nothing behind it.
 *
 *      ONE EXEMPTION, ENUMERATED by the caller and never a blanket. There used
 *      to be two; Wave W-EX-A discharged the second and deleted it.
 *
 *        `unitemizedInputs` — an Aave position's price inputs cover its BORROWED
 *        reserves as well as its collateral, and `collateral_by_asset` itemizes
 *        only collateral, so the debt leg's held price has no itemized witness
 *        BY CONSTRUCTION. The Debt Manager needs no such exemption: its debt
 *        leg is USD-NORMALIZED and copied verbatim (`cp.DebtUSD =
 *        copyBig(in.DM.DebtUSD)`), carries no `PriceInput` at all, and is bound
 *        instead by law 12.
 *
 *        WAVE W-BS-E. That exemption used to be DERIVED — "the committed
 *        result's inputs this body's counted itemization does not carry" — and
 *        Codex round 30 walked straight through the derivation: hold the
 *        fixture's UNPRICED collateral flat and it qualifies, because an
 *        unpriced row is not counted and the chain does carry some debt. A
 *        COLLATERAL row was thereby licensed as a DEBT LEG. So the exemption is
 *        now ANCHORED at both ends: the declared keys are frozen literals
 *        asserted equal to the derivation (at the write site), and this guard
 *        refuses any declared key the response ITEMIZES — at any disclosure,
 *        priced or not. A holding is not a borrowing.
 *
 *        `undisclosedInputs` IS GONE (Wave W-EX-A). It forgave a disclosure the
 *        contract's OWN run-book 200 example did not make: `applied_shocks: []`
 *        and `held_flat: []` while itemizing priced weETH on two chains under
 *        `weeth_market_depeg_oracles_held`, whose committed propagation matrix
 *        is EMPTY — so `ApplyScenario` held every one of those inputs flat and
 *        production's own body named them all. The example is CAPTURED from the
 *        running handler now and discloses all three prices its book consulted,
 *        so the licence was owed by nothing and was deleted rather than
 *        re-frozen. EVERY body this file writes owes law 11 in full.
 *  12. THE MOVER IS THE SHAPE ITS ENGINE SPEAKS, AND ITS BORROWINGS ARE
 *      CONSERVED.
 *
 *      `wireRunBookMover` (p5_runbook.go:117-139) carries EVERY per-engine
 *      field on EVERY mover and NULLS the ones the engine does not speak —
 *      "an absent number is never a zero". The first cut of this law read
 *      `debt_usd` only when it was non-null, and Codex round 30 deleted it:
 *      null the DM mover's debt evidence (then every DM-specific field) and the
 *      guard stayed green over a mover that discloses nothing. Non-null
 *      equality is a DERIVED property; the SHAPE is the anchor. So each mover
 *      is checked whole, against the engine whose vocabulary it is in:
 *
 *        aave_v3_etherfi (p5_runbook.go:783-799) — three wads, present, with
 *        `hf_drop_wad` the STRICT drop that ranked the row; every Debt Manager
 *        field NULL.
 *
 *        debt_manager (p5_runbook.go:800-818) — both rationals present,
 *        `became_eligible` STRICTLY true (the serializer writes no other
 *        value), `debt_usd` present and EQUAL to `hf_after_den`; every aave wad
 *        NULL.
 *
 *      The DM rationals are not optional here even though the serializer writes
 *      them "when the side has one": a DM mover is an account whose after side
 *      is ELIGIBLE, eligibility is `borrowings > maxBorrowLT` STRICTLY
 *      (dm.go:165-166), so borrowings > 0 and the after side is finite
 *      (dm.go:171-178) — and `ApplyScenario` copies the debt leg verbatim, so
 *      the before side carries the same positive borrowings and is finite too.
 *
 *      THE BORROWINGS THEMSELVES: the rational is maxBorrowLT / borrowings
 *      (dm.go:164-176) and `p5_runbook.go:799-814` publishes that same
 *      after-side figure a second time as `debt_usd`. No scenario re-prices a
 *      USD-normalized debt leg, so the DENOMINATOR is bit-identical across the
 *      sides AND equal to `debt_usd`, and the whole move belongs to the
 *      numerator. Scaling both halves keeps the quotient law 7 tests and
 *      falsifies the borrowings.
 */
const checkPropagation = (
  name,
  response,
  { unitemizedInputs = new Set(), holdings } = {},
) => {
  // THE ANCHOR IS REQUIRED. A body checked without one is a body whose
  // immutable fields are pinned to nothing, which is the state this wave
  // exists to end — so the absence is a refusal, never a silent skip.
  if (!(holdings instanceof Map) || holdings.size === 0) {
    fail(`${name} is checked with NO declared holding anchor, so its balances are pinned to nothing`);
  }
  // THE MATRIX IS THE RESPONSE'S OWN. A body is measured against the scenario it
  // says it answers, read from the committed registry by that id — never against
  // whichever matrix this generator happens to have open.
  const committed = committedScenario(response.scenario_id);
  const { rows: propagation, composedFactor } = matrixFor(committed);
  const chains = new Map(
    response.batch.watermarks.map((watermark) => [watermark.engine, watermark.chain_id]),
  );

  // LAW 13: THE DISCLOSED DEFINITION IS THE ONE THAT WAS APPLIED (Wave W-BS-H,
  // residual A.7).
  //
  // `shocks[]` is the scenario definition this body PUBLISHES — the axes and
  // factors a reader is shown as the thing that was done to the book. Every
  // other propagation law reads the COMMITTED registry instead, and law 4 binds
  // `applied_shocks` to the matrix that registry composes. So the one artefact
  // a reader actually sees was pinned by nothing: a body could publish
  // `shocks: []` — "nothing was shocked" — while disclosing a 70/100 move on
  // every price and moving every aggregate by it, and the whole guard read
  // green. The disclosed definition and the applied physics are the same
  // scenario or the page is describing a run that did not happen.
  const disclosedShocks = JSON.stringify(
    response.shocks.map((shock) => [shock.axis, String(shock.factor_num), String(shock.factor_den)]),
  );
  const committedShocks = JSON.stringify(
    committed.shocks.map((shock) => [shock.axis, String(shock.factor_num), String(shock.factor_den)]),
  );
  if (disclosedShocks !== committedShocks) {
    fail(
      `${name} discloses shocks ${disclosedShocks} but the committed ${response.scenario_id} ` +
        `registry entry — the one ApplyScenario reads and every law here composes from — carries ` +
        `${committedShocks}: the definition a reader is SHOWN is the definition that was APPLIED`,
    );
  }
  // AND THE APPLIED FACTORS COMPOSE FROM IT. Law 4 already binds each factor to
  // the matrix; this binds it to the body's OWN disclosed axes, so the two
  // halves of the disclosure cannot be true separately and false together.
  const disclosedFactor = matrixFor({
    shocks: response.shocks,
    propagation: committed.propagation,
  }).composedFactor;
  for (const entry of response.applied_shocks) {
    const row = propagation.get(responseKey(entry.chain_id, entry.asset));
    if (row === undefined) {
      continue; // law 4's own refusal, below, names it
    }
    const [num, den] = disclosedFactor(row);
    if (BigInt(entry.factor_num) * den !== BigInt(entry.factor_den) * num) {
      fail(
        `${name} applies ${entry.factor_num}/${entry.factor_den} to ${entry.asset}, but composing ` +
          `THIS BODY'S OWN disclosed shocks[] over that asset's propagation row gives ` +
          `${String(num)}/${String(den)} — an applied shock is the disclosed definition evaluated, ` +
          `never a factor beside it`,
      );
    }
  }

  const applied = new Map();
  for (const entry of response.applied_shocks) {
    const key = responseKey(entry.chain_id, entry.asset);
    if (applied.has(key)) {
      fail(`${name} discloses TWO applied shocks for ${key}`);
    }
    applied.set(key, entry);
    // LAW 4, first half: the matrix has to name it, and the factor has to be
    // the one the matrix composes for it.
    const row = propagation.get(key);
    if (row === undefined) {
      fail(
        `${name} applies a shock to ${key}, which the committed eth_minus_30 propagation matrix ` +
          `does not name — ApplyScenario would have HELD IT FLAT`,
      );
    }
    const [num, den] = composedFactor(row);
    if (BigInt(entry.factor_num) * den !== BigInt(entry.factor_den) * num) {
      fail(
        `${name} discloses factor ${entry.factor_num}/${entry.factor_den} for ${key} but the ` +
          `matrix composes ${String(num)}/${String(den)} from the scenario's own shocks[]`,
      );
    }
    // The disclosed price pair has to move by the disclosed factor too.
    if (BigInt(entry.after) * BigInt(entry.factor_den) !== BigInt(entry.before) * BigInt(entry.factor_num)) {
      fail(
        `${name} discloses ${entry.before} -> ${entry.after} for ${key}, which is not ` +
          `${entry.factor_num}/${entry.factor_den}`,
      );
    }
  }

  const heldFlat = new Map();
  for (const entry of response.held_flat) {
    const key = responseKey(entry.chain_id, entry.asset);
    if (heldFlat.has(key)) {
      fail(`${name} discloses TWO held-flat entries for ${key}`);
    }
    if (applied.has(key)) {
      fail(`${name} names ${key} as BOTH shocked and held flat`);
    }
    heldFlat.set(key, entry);
    // LAW 6. `held_flat` is not "did not move" — it is "no propagation row
    // described it". Naming a declared asset there is a false disclosure.
    if (propagation.has(key)) {
      fail(
        `${name} holds ${key} flat, but the committed matrix DOES describe it — ` +
          `held_flat names only inputs no propagation row covers`,
      );
    }
  }

  /** Every applied shock needs an aggregate that witnesses it (law 3). */
  const witnessed = new Set();
  /** Every PRICED holding the body itemizes, keyed the evaluator's way (law 11). */
  const itemized = new Set();

  /** The engine's OWN valuation of a holding at a price — floor, never rounded. */
  const valueAt = (amount, price, decimals) => (amount * price) / 10n ** BigInt(decimals);

  // LAW 11's FIRST EXEMPTION, ANCHORED (Wave W-BS-E). A declared un-itemized
  // input is a BORROWED reserve's price — a leg this wire has no column for. A
  // key the response ITEMIZES is a holding, at whatever disclosure, and a
  // holding is not a borrowing: exempting one would let the completeness law be
  // satisfied by the very row it exists to make the body witness. Built here,
  // over EVERY entry rather than the priced ones, because the round-30 probe
  // was precisely an UNPRICED collateral row wearing the debt leg's exemption.
  const carried = new Map();
  for (const engine of response.engines) {
    const engineChainId = chains.get(engine.engine);
    if (engineChainId === undefined) {
      continue; // reported with its own sentence in the engine loop below
    }
    for (const side of ["before", "after"]) {
      for (const entry of engine[side].collateral_by_asset) {
        carried.set(
          responseKey(engineChainId, entry.asset),
          `${engine.engine} itemizes it as ${disclosureOf(entry)} collateral`,
        );
      }
    }
  }
  for (const key of unitemizedInputs) {
    const where = carried.get(key);
    if (where !== undefined) {
      fail(
        `${name} declares ${key} an UN-ITEMIZED debt-leg price input, but ${where} — the debt leg ` +
          `is the set of reserves a position BORROWS, and a holding is not a borrowing`,
      );
    }
  }
  /**
   * How many ENGINE ITERATIONS served each anchored row (law 9's exhaustiveness
   * half, hoisted OUT of the loop in Wave W-BS-F).
   *
   * Round 31's second finding: the "a body may not drop a row its own source
   * carries" check lived INSIDE `for (const engine of response.engines)`, so
   * deleting the whole aave engine deleted the only iteration that could ever
   * have missed its rows. An exhaustiveness law inside the loop it is
   * exhaustive over cannot see an absent loop body. This map is filled in the
   * loop and READ AFTER IT, where the anchor's own engines are compared against
   * the response's own engines and every anchored key must have been visited
   * EXACTLY ONCE — zero being a dropped engine or a dropped row, and two being
   * one engine serialized twice.
   */
  const visitedAnchor = new Map();

  for (const engine of response.engines) {
    const label = `${name} ${engine.engine}`;
    const chain = chains.get(engine.engine);
    if (chain === undefined) {
      fail(`${label} has no batch watermark, so its chain — and its propagation keys — are unknown`);
    }

    const afterByKey = new Map(
      engine.after.collateral_by_asset.map((entry) => [
        `${entry.asset}::${disclosureOf(entry)}`,
        entry,
      ]),
    );

    // LAW 8. THE HOLDINGS ARE THE SAME HOLDINGS. Checked BEFORE anything reads a
    // number off a pair, because a pair that does not exist is how the old guard
    // was made to skip an entry entirely.
    const beforeKeys = new Set(
      engine.before.collateral_by_asset.map((entry) => `${entry.asset}::${disclosureOf(entry)}`),
    );
    for (const [side, own, other] of [
      ["AFTER", afterByKey.keys(), beforeKeys],
      ["BEFORE", beforeKeys, new Set(afterByKey.keys())],
    ]) {
      for (const key of own) {
        if (!other.has(key)) {
          fail(
            `${label} carries ${key} on the ${side} side ONLY — ApplyScenario CLONES the balances ` +
              `and rewrites only prices, so a shock can neither create a holding, destroy one, ` +
              `nor reclassify one`,
          );
        }
      }
    }

    // LAW 9. THE HOLDINGS ARE ANCHORED. Each side is measured against the
    // caller's declared anchor — source bytes plus injected rows — rather than
    // against the other side, because a TWO-SIDED edit satisfies any
    // side-to-side comparison while serving balances nobody put there, and
    // `unpriced`/`note` were pinned by nothing at all.
    const served = new Set();
    for (const side of ["before", "after"]) {
      for (const entry of engine[side].collateral_by_asset) {
        const key = anchorKey(engine.engine, entry);
        served.add(key);
        const anchored = holdings.get(key);
        if (anchored === undefined) {
          fail(
            `${label} ${side} carries ${key}, which the declared holding ANCHOR does not name — ` +
              `every row of a generated body comes from the contract example's own bytes or from ` +
              `a row this generator injects, and this one comes from neither`,
          );
        }
        for (const [field, want] of Object.entries(anchored)) {
          const got = entry[field] ?? null;
          if (got !== want) {
            fail(
              `${label} ${side} serves ${field} ${JSON.stringify(got)} for ${key}, but the ` +
                `declared ANCHOR pins ${JSON.stringify(want)} — a scenario moves PRICES and ` +
                `nothing else, so every other byte of a holding must arrive as its source has it`,
            );
          }
        }
      }
    }
    // Recorded for the WHOLE-BOOK exhaustiveness check after this loop. An
    // engine iteration that ran is an engine iteration that can be held to the
    // anchor; the point of counting is the iterations that never ran at all.
    for (const key of served) {
      visitedAnchor.set(key, (visitedAnchor.get(key) ?? 0) + 1);
    }
    // The anchor is EXHAUSTIVE for this engine. A row it names that the body
    // does not serve is a holding the generator injected and the body lost.
    for (const key of holdings.keys()) {
      if (key.startsWith(`${engine.engine}|`) && !served.has(key)) {
        fail(
          `${label} serves NO entry for ${key}, which the declared holding ANCHOR names — a body ` +
            `may not drop a row its own source carries`,
        );
      }
    }

    for (const before of engine.before.collateral_by_asset) {
      const after = afterByKey.get(`${before.asset}::${disclosureOf(before)}`);
      // An UNPRICED or NOT-COUNTED holding carries no `PriceInput`, so there is
      // nothing for a scenario to move and nothing for it to hold flat.
      if (before.value_usd === null) {
        continue;
      }
      if (!Number.isInteger(before.decimals) || before.decimals < 0) {
        fail(
          `${label} counts ${before.asset} at ${JSON.stringify(before.decimals)} decimals, so its ` +
            `price cannot be read off its value`,
        );
      }
      const key = responseKey(chain, before.asset);
      itemized.add(key);
      const [Vb, Ab] = [BigInt(before.value_usd), BigInt(before.amount)];
      const [Va, Aa] = [BigInt(after.value_usd), BigInt(after.amount)];
      const moved = Vb * Aa !== Va * Ab;
      const shock = applied.get(key);

      if (shock === undefined) {
        // LAWS 1 and 2 — the same law read from both ends.
        if (moved) {
          fail(
            `${label} moves the price implied by ${before.asset} ` +
              `(${before.value_usd}/${before.amount} -> ${after.value_usd}/${after.amount}) ` +
              `with NO applied_shocks entry for ${key}`,
          );
        }
        // LAW 5. The matrix names it, the scenario shocks the axis it responds
        // to, and the aggregate did not move: production could not serve this.
        if (propagation.has(key)) {
          const [num, den] = composedFactor(propagation.get(key));
          if (num !== den) {
            fail(
              `${label} holds ${before.asset} FLAT, but the committed matrix declares it on chain ` +
                `${String(chain)} at ${String(num)}/${String(den)} — a declared asset cannot sit still`,
            );
          }
          continue;
        }
        // LAW 11, first half: HELD FLAT IS EXHAUSTIVE. An undeclared PRICED
        // input is one `ApplyScenario` recorded on `HeldFlat`. A body that holds
        // it and does not say so has published an incomplete disclosure.
        const held = heldFlat.get(key);
        if (held === undefined) {
          fail(
            `${label} counts a PRICED ${before.asset} that the committed matrix does not ` +
              `describe, so ApplyScenario would have RECORDED IT ON HeldFlat — but ${name} ` +
              `discloses no held_flat entry for ${key}`,
          );
        }
        // LAW 10, for a held price: the disclosed value is this itemization's
        // own price, on BOTH sides, absolutely and not merely in ratio.
        for (const [sideName, value, amount] of [
          ["before", Vb, Ab],
          ["after", Va, Aa],
        ]) {
          const derived = valueAt(amount, BigInt(held.value), before.decimals);
          if (derived !== value) {
            fail(
              `${label} holds ${before.asset} flat at ${held.value}, which values its ` +
                `${amount.toString()} at ${derived.toString()} — but the ${sideName} side counts ` +
                `${value.toString()}`,
            );
          }
        }
        continue;
      }

      // LAW 3.
      if (!moved) {
        fail(
          `${label} discloses an applied shock for ${before.asset} but its implied price is ` +
            `UNCHANGED across the two sides (${before.value_usd}/${before.amount})`,
        );
      }
      // LAW 4, second half: the itemization moved by exactly the disclosed factor.
      if (Va * Ab * BigInt(shock.factor_den) !== Vb * Aa * BigInt(shock.factor_num)) {
        fail(
          `${label} moves ${before.asset} from ${before.value_usd}/${before.amount} to ` +
            `${after.value_usd}/${after.amount}, which is not the disclosed ` +
            `${shock.factor_num}/${shock.factor_den}`,
        );
      }
      // LAW 10. The disclosed price pair is an ABSOLUTE claim about this
      // holding, not just a quotient: each side's `value_usd` is the engine's
      // own floor(amount × price / 10^decimals) at the price the body published.
      for (const [sideName, price, amount, value] of [
        ["before", BigInt(shock.before), Ab, Vb],
        ["after", BigInt(shock.after), Aa, Va],
      ]) {
        const derived = valueAt(amount, price, before.decimals);
        if (derived !== value) {
          fail(
            `${label} discloses a ${sideName} price of ${price.toString()} for ${before.asset}, ` +
              `which values its ${amount.toString()} at ${derived.toString()} — but the ` +
              `${sideName} side counts ${value.toString()}`,
          );
        }
      }
      witnessed.add(key);
    }

    // LAW 7. A mover's own numbers scale with the collateral that moved, so the
    // factor they imply has to be one this body disclosed for this engine.
    const factorsHere = response.applied_shocks
      .filter((entry) => entry.chain_id === chain)
      .map((entry) => [BigInt(entry.factor_num), BigInt(entry.factor_den)]);
    const disclosesFactor = (num, den) =>
      factorsHere.some(([fn, fd]) => num * fd === den * fn);

    // LAW 12, first half: THE MOVER IS THE SHAPE ITS ENGINE SPEAKS. Asserted
    // WHOLE and BEFORE any number is read off the row, because the round-30
    // defect was a guard that only ever looked at fields that were still there.
    const speaks = MOVER_VOCABULARY[engine.engine];
    if (speaks === undefined) {
      fail(`${label} publishes movers in a vocabulary this guard does not know`);
    }
    const silent = Object.entries(MOVER_VOCABULARY)
      .filter(([engineName]) => engineName !== engine.engine)
      .flatMap(([, fields]) => fields);

    for (const mover of engine.movers) {
      if (mover.engine !== engine.engine) {
        fail(
          `${label} mover ${mover.account} says its engine is ${shown(mover.engine)} — a mover is ` +
            `serialized inside the engine that ranked it and can belong to no other`,
        );
      }
      for (const field of speaks) {
        if (mover[field] === null || mover[field] === undefined) {
          fail(
            `${label} mover ${mover.account} publishes ${field} ${shown(mover[field])}, but ` +
              `${engine.engine} SPEAKS that field on every mover it ranks — a nulled field is not ` +
              `a smaller disclosure, it is the evidence deleted`,
          );
        }
      }
      for (const field of silent) {
        if (!(field in mover) || mover[field] !== null) {
          fail(
            `${label} mover ${mover.account} publishes ${field} ${shown(mover[field])}, but ` +
              `${engine.engine} does not SPEAK that field — the serializer carries it NULL, and a ` +
              `number in another engine's vocabulary is a number this engine never measured`,
          );
        }
      }

      if (engine.engine === "debt_manager") {
        // The serializer writes this flag ONLY on the strict false -> true flip
        // that made the account a mover (p5_runbook.go:794-806).
        if (mover.became_eligible !== true) {
          fail(
            `${label} mover ${mover.account} publishes became_eligible ${shown(mover.became_eligible)} — ` +
              `a Debt Manager mover IS the strict false -> true flip, so no other value can rank one`,
          );
        }
        // LAW 12, second half: THE BORROWINGS ARE CONSERVED. The denominator IS
        // the borrowings (dm.go:164-176), the debt leg is USD-normalized and
        // `ApplyScenario` copies it verbatim, and `p5_runbook.go:799-814`
        // publishes that same after-side figure again as `debt_usd`. Scaling
        // both halves of the rational leaves law 7's quotient intact and
        // falsifies the borrowings, so the denominator is pinned twice.
        if (mover.hf_before_den !== mover.hf_after_den) {
          fail(
            `${label} mover ${mover.account} moves its BORROWINGS ${mover.hf_before_den} -> ` +
              `${mover.hf_after_den} across the two sides — the Debt Manager's debt leg is ` +
              `USD-NORMALIZED and no scenario re-prices it, so the denominator cannot move`,
          );
        }
        if (mover.debt_usd !== mover.hf_after_den) {
          fail(
            `${label} mover ${mover.account} publishes debt_usd ${mover.debt_usd} while its ` +
              `after-side rational denominates in ${mover.hf_after_den} — both are the SAME ` +
              `borrowings read twice, so they cannot disagree`,
          );
        }
        // maxBorrowLT / borrowings. The debt leg is USD-normalized and no
        // scenario re-prices it, so the whole move is the collateral's.
        const [nb, db] = [BigInt(mover.hf_before_num), BigInt(mover.hf_before_den)];
        const [na, da] = [BigInt(mover.hf_after_num), BigInt(mover.hf_after_den)];
        if (nb * da !== na * db && !disclosesFactor(na * db, nb * da)) {
          fail(
            `${label} mover ${mover.account} moves ${String(nb)}/${String(db)} -> ` +
              `${String(na)}/${String(da)}, a factor no applied_shocks entry on chain ` +
              `${String(chain)} discloses`,
          );
        }
        continue;
      }

      const [wb, wa] = [BigInt(mover.hf_before_wad), BigInt(mover.hf_after_wad)];
      // The drop is what RANKED the row, and Aave ranks a STRICT drop only
      // (p5_runbook.go:783-799) — so it is recomputed, never taken on trust.
      if (BigInt(mover.hf_drop_wad) !== wb - wa) {
        fail(
          `${label} mover ${mover.account} publishes hf_drop_wad ${mover.hf_drop_wad}, but its own ` +
            `wads fall ${String(wb)} -> ${String(wa)}, a drop of ${String(wb - wa)}`,
        );
      }
      if (wb <= wa) {
        fail(
          `${label} mover ${mover.account} does not STRICTLY drop (${String(wb)} -> ${String(wa)}), ` +
            `so the engine's own rule ranks no mover for it`,
        );
      }
      if (!disclosesFactor(wa, wb)) {
        fail(
          `${label} mover ${mover.account} moves ${String(wb)} -> ${String(wa)} in wad, a factor ` +
            `no applied_shocks entry on chain ${String(chain)} discloses`,
        );
      }
      for (const [side, wad] of [
        ["before", wb],
        ["after", wa],
      ]) {
        const histogram = engine[side].hf_histogram;
        const bucket = bucketLabelForRational(histogram, wad, BigInt(histogram.wad_scale));
        if (histogram.buckets.find((entry) => entry.label === bucket).count === 0) {
          fail(`${label} mover ${mover.account} sits in an EMPTY ${side}-bucket ${bucket}`);
        }
      }
    }
  }

  // LAW 9, BOOK-WIDE (Wave W-BS-F). THE ANCHOR IS EXHAUSTIVE OVER THE WHOLE
  // RESPONSE, not over the engines the response happens to carry.
  //
  // Round 31 deleted the ENTIRE aave engine — coverage adjusted, disclosures
  // trimmed, every remaining law green — and the per-engine exhaustiveness check
  // above never fired, because it only ever runs for an engine that is there.
  // The anchor names whose book each row belongs to, so the anchor's engine set
  // is a claim about the response's engine set and is asserted as one.
  const anchorEngines = new Set(
    [...holdings.keys()].map((key) => key.slice(0, key.indexOf("|"))),
  );
  const servedEngines = new Set(response.engines.map((engine) => engine.engine));
  for (const engineName of anchorEngines) {
    if (!servedEngines.has(engineName)) {
      fail(
        `${name} declares holding-ANCHOR rows under ${engineName}, an engine this response does ` +
          `NOT serve — an engine is not a row a body may drop, and a per-engine law cannot speak ` +
          `about an engine that is absent`,
      );
    }
  }
  for (const engineName of servedEngines) {
    if (!anchorEngines.has(engineName)) {
      fail(
        `${name} serves an engine ${engineName} the declared holding ANCHOR names no row for, so ` +
          `its whole itemization is pinned to nothing`,
      );
    }
  }
  for (const key of holdings.keys()) {
    const times = visitedAnchor.get(key) ?? 0;
    if (times !== 1) {
      fail(
        `${name} serves the anchored row ${key} in ${String(times)} engine objects — every row the ` +
          `declared ANCHOR names is served by EXACTLY ONE engine, so zero is a row (or an engine) ` +
          `the body dropped and two is one engine serialized twice`,
      );
    }
  }

  // LAW 3, book-wide: a disclosed shock with no aggregate behind it anywhere.
  for (const [key] of applied) {
    if (!witnessed.has(key)) {
      fail(
        `${name} discloses an applied shock for ${key} that NO engine's itemization moved by — ` +
          `the disclosure describes a book this response does not serve`,
      );
    }
  }

  // LAW 11, second half: NOTHING FLOATS FREE. A held price the body cannot
  // witness is a name with nothing behind it. The only price inputs this wire
  // does not itemize are an engine's BORROWED reserves, and those are declared
  // by the caller from the committed result they came from — never inferred.
  for (const [key, entry] of heldFlat) {
    if (itemized.has(key)) {
      continue;
    }
    if (!unitemizedInputs.has(key)) {
      fail(
        `${name} holds ${key} flat, but NO engine in this response counts that asset and it is ` +
          `not a declared un-itemized price input — a held disclosure with nothing behind it`,
      );
    }
    // A declared exemption is a DEBT LEG's price, so an engine on that chain has
    // to actually carry debt on both sides for the borrowing to exist at all.
    const carriesDebt = response.engines.some(
      (engine) =>
        chains.get(engine.engine) === entry.chain_id &&
        BigInt(engine.before.total_debt_usd) > 0n &&
        BigInt(engine.after.total_debt_usd) > 0n,
    );
    if (!carriesDebt) {
      fail(
        `${name} holds ${key} flat as a DEBT-LEG price, but no engine on chain ` +
          `${String(entry.chain_id)} carries debt on both sides, so nothing borrows it`,
      );
    }
  }
};

// ===========================================================================
// THE COMPLETENESS LAW (WAVE W-BS-H): A FIELD CANNOT BE FREE BECAUSE NOBODY
// THOUGHT TO NAME IT
// ===========================================================================
//
// Seven waves of this file were written the same way: Codex broke a field, the
// field got a law. `usd_decimals` was free until round 32 moved the Debt
// Manager's 6 to 18. The histogram's `note` was free until round 32 rewrote it.
// Every byte of `batch` — the id a reader joins on, the `status` a reader trusts
// to mean complete, the watermarks a reader reads staleness off — was free
// through all seven, because no round happened to reach for them.
//
// That is not a sequence of oversights. It is the METHOD failing: a guard
// assembled field by field covers exactly the fields somebody thought of, and
// its coverage is therefore unknowable without re-deriving it by hand. Wave
// W-BS-G's residual enumeration is what that unknowability looks like written
// down — seventeen edit paths, five classes, and no way to be sure the list was
// itself complete.
//
// SO THE QUESTION IS INVERTED. `responseLeaves` walks the WHOLE body to its
// leaves, and every leaf must be in EXACTLY ONE of three registers:
//
//   DERIVED              the derivation composes it and compares it, or a law
//                        above computes it from quantities that are themselves
//                        derived. The number answers to arithmetic.
//   ANCHORED             a frozen literal or a frozen sentence, re-proved
//                        against its committed source every run — either the
//                        response anchor declared beside the body, or the
//                        holding anchor of law 9.
//   ENUMERATED-UNPINNED  free, by a decision somebody wrote down, with a
//                        one-line reason a reviewer can reject.
//
// A leaf in none of them FAILS GENERATION, naming its own path. A leaf in two
// fails as well: a field claimed by two registers is a field whose coverage
// nobody can state. The registers are the guard's coverage, written in one
// place, and they can no longer drift from what the guard actually does —
// because the body itself is what walks them.

/** Both sides of an engine carry the same aggregate shape. */
const bothSides = (suffix) => [`engines[].before.${suffix}`, `engines[].after.${suffix}`];

/**
 * REGISTER 1 — DERIVED. The clause that composes the value and compares it.
 */
const RESPONSE_DERIVED_LEAVES = new Map([
  ["scenario_id", "checkDerivation: the body answers the scenario the derivation modelled"],
  ["scenario_version", "checkDerivation: the same, on the version"],

  // THE DISCLOSED SCENARIO DEFINITION (law 13, Wave W-BS-H, residual A.7).
  ["shocks[]", "law 13: the disclosed definition is the committed registry's, empty included"],
  ["shocks[].axis", "law 13: every disclosed axis is one the committed registry shocks"],
  ["shocks[].factor_num", "law 13: the disclosed factor is the committed one"],
  ["shocks[].factor_den", "law 13: the disclosed factor is the committed one"],

  ["applied_shocks[]", "laws 1/3/5: exactly the priced inputs the committed matrix moves"],
  ["applied_shocks[].asset", "laws 3/4: keyed to the matrix, witnessed by an itemization that moved"],
  ["applied_shocks[].chain_id", "laws 3/4: the same key's other half"],
  ["applied_shocks[].factor_num", "laws 4 and 13: the factor the matrix composes from shocks[]"],
  ["applied_shocks[].factor_den", "laws 4 and 13: the factor the matrix composes from shocks[]"],
  ["applied_shocks[].before", "law 10: it values the itemized amount at the itemized before value"],
  ["applied_shocks[].after", "law 10 + law 4: the same, after the disclosed factor"],

  ["held_flat[]", "law 11: held flat is exhaustive, and nothing floats free in it"],
  ["held_flat[].asset", "laws 6/11: an input NO propagation row describes, witnessed by an itemization"],
  ["held_flat[].chain_id", "laws 6/11: the same key's other half"],
  ["held_flat[].value", "law 10: it values the itemized amount at BOTH sides' itemized value"],

  ["coverage.batch_positions", "checkDerivation: the example's own census plus what this file injects"],
  ["coverage.in_book", "checkDerivation: the same"],
  ["coverage.refused_in_batch", "checkDerivation: the same"],
  ["coverage.excluded_by_this_layer", "checkDerivation: the length of the roster beside it"],
  ["coverage.excluded[]", "checkDerivation: the frozen refusal roster, empty included"],
  ["coverage.withheld_engines[]", "checkDerivation: the frozen withheld roster, empty included"],
  ["coverage.stress_coverage_is_full", "checkDerivation: the contract's fail-closed conjunction, recomputed"],
  ["excluded_engines[]", "law 15: the top-level roster IS coverage.withheld_engines, read twice"],

  ["batch.position_count", "checkDerivation: welded to coverage.batch_positions"],
  ["batch.age_seconds", "law 14: served_at minus computed_at, the batch's own clock"],
  ["batch.watermarks[].sweep.age_seconds", "law 14: served_at minus the sweep's own max_updated_at — the SAME instant, because production measures both from one database clock"],

  ["engines[].engine", "checkDerivation: the engine set is the derivation's, in order"],
  ["engines[].usd_decimals", "checkDerivation: the serializer's own frozen constant"],
  ["engines[].market_realization", "law 16: NULL exactly when the committed scenario carries no market-realization axis"],
  ["engines[].projection", "law 18: NULL unless the committed scenario carries a projection axis AND this is the Debt Manager"],

  // THE REALIZATION AXIS'S MONEY (Wave W-BS-I). These four were ANCHORED to the
  // contract example's own bytes until Codex round 33 found what that means on a
  // TRANSFORMED body: the example's shortfall is arithmetic over the EXAMPLE's
  // book, and a body that restates the book and keeps the figure publishes a
  // critical shortfall over a book with nothing liquidatable. `seizure_model` and
  // `note` stay ANCHORED: they are the disclosure sentences, not the money.
  ["engines[].market_realization.hfs_unchanged", "checkDerivation: the realization pass writes no price input, so production's own comparison is true"],
  ["engines[].market_realization.execution_shortfall_usd", "checkDerivation: the aggregate over LIQUIDATABLE positions ONLY, from the frozen book and the committed ratios"],
  ["engines[].market_realization.bad_debt_at_liquidation_usd", "checkDerivation: the same aggregate — the frozen borrowings less what the counted collateral realizes"],
  ["engines[].market_realization.usd_decimals", "checkDerivation: the unit the shortfall is READ at — this engine's own serializer constant"],
  ["engines[].movers_total", "checkDerivation: the count of accounts the derivation's arithmetic moves"],
  ["engines[].newly_eligible_accounts", "checkResponse: after minus before, over derived sides"],
  ["engines[].eligible_debt_delta_usd", "checkResponse: after minus before, over derived sides"],
  ["engines[].bad_debt_delta_usd", "checkResponse: after minus before, over derived sides"],

  ["engines[].movers[]", "checkDerivation: the mover SET is derived, so an empty one is derived too"],
  ["engines[].movers[].account", "checkDerivation: exactly the accounts the derivation's arithmetic moves"],
  ["engines[].movers[].engine", "law 12: a mover is serialized inside the engine that ranked it"],
  ["engines[].movers[].hf_before_wad", "checkDerivation moverFields, or law 12's NULL for a silent engine"],
  ["engines[].movers[].hf_after_wad", "checkDerivation moverFields, or law 12's NULL for a silent engine"],
  ["engines[].movers[].hf_drop_wad", "checkDerivation moverFields, or law 12's NULL for a silent engine"],
  ["engines[].movers[].hf_before_num", "checkDerivation moverFields, or law 12's NULL for a silent engine"],
  ["engines[].movers[].hf_before_den", "checkDerivation moverFields, or law 12's NULL for a silent engine"],
  ["engines[].movers[].hf_after_num", "checkDerivation moverFields, or law 12's NULL for a silent engine"],
  ["engines[].movers[].hf_after_den", "checkDerivation moverFields, or law 12's NULL for a silent engine"],
  ["engines[].movers[].became_eligible", "checkDerivation moverFields, or law 12's NULL for a silent engine"],
  ["engines[].movers[].debt_usd", "checkDerivation moverFields, or law 12's NULL for a silent engine"],

  ...bothSides("accounts").map((path) => [path, "checkDerivation: the side's derived census"]),
  ...bothSides("eligible_accounts").map((path) => [path, "checkDerivation: the derived eligibility test"]),
  ...bothSides("total_collateral_usd").map((path) => [path, "checkDerivation: the derived itemization's counted sum"]),
  ...bothSides("total_debt_usd").map((path) => [path, "checkDerivation: the frozen borrowings"]),
  ...bothSides("eligible_debt_usd").map((path) => [path, "checkDerivation: the derived eligible borrowings"]),
  ...bothSides("collateral_at_risk_usd").map((path) => [path, "checkDerivation: the waterfall's own measure"]),
  ...bothSides("bad_debt_usd").map((path) => [path, "checkDerivation: the waterfall's own measure"]),
  ...bothSides("collateral_by_asset[].value_usd").map((path) => [
    path,
    "checkDerivation: the frozen amount re-valued at the frozen SOURCE-SIDE price through the matrix",
  ]),
  ...bothSides("hf_histogram.comparator").map((path) => [path, "checkDerivation: the engine's own frozen comparator"]),
  ...bothSides("hf_histogram.wad_scale").map((path) => [path, "checkDerivation: the frozen bucket shape"]),
  ...bothSides("hf_histogram.infinite_count").map((path) => [path, "checkDerivation: the derived census"]),
  ...bothSides("hf_histogram.refused_count").map((path) => [path, "checkDerivation: composed FROM the refusal census"]),
  ...bothSides("hf_histogram.note").map((path) => [path, "checkDerivation: the frozen sentence the page renders"]),
  ...bothSides("hf_histogram.buckets[].label").map((path) => [path, "checkDerivation: the frozen bucket shape"]),
  ...bothSides("hf_histogram.buckets[].lower_wad").map((path) => [path, "checkDerivation: the frozen bucket shape"]),
  ...bothSides("hf_histogram.buckets[].upper_wad").map((path) => [path, "checkDerivation: the frozen bucket shape"]),
  ...bothSides("hf_histogram.buckets[].count").map((path) => [
    path,
    "checkDerivation: every modelled account dropped where the server's own test drops it",
  ]),

  // CONTRACT 1.7.0 — the transition matrix. Every leaf is derived from the same
  // per-row model the two histograms are, and `checkTransitions` re-proves the
  // whole subtree against those histograms on EVERY body, carried or derived.
  ["engines[].hf_transitions.comparator", "checkTransitions: the engine's own comparator, read off the histogram beside it"],
  ["engines[].hf_transitions.wad_scale", "checkTransitions: the histogram's own scale, read twice"],
  ["engines[].hf_transitions.lanes[].index", "checkTransitions: positional — lane i IS index i"],
  ["engines[].hf_transitions.lanes[].kind", "checkTransitions: the closed vocabulary, bucket lanes first"],
  ["engines[].hf_transitions.lanes[].label", "checkTransitions: byte-identical to the histogram's own bucket label"],
  ["engines[].hf_transitions.lanes[].lower_wad", "checkTransitions: the histogram's own edge"],
  ["engines[].hf_transitions.lanes[].upper_wad", "checkTransitions: the histogram's own edge"],
  ["engines[].hf_transitions.outflows[].from", "checkTransitions: positional — outflow i IS lane i"],
  ["engines[].hf_transitions.outflows[].cells[]", "checkTransitions: SPARSE — an absent cell is a knowable zero the dense margins make complete"],
  ["engines[].hf_transitions.outflows[].cells[].to", "checkTransitions: unique and ascending within an outflow"],
  ["engines[].hf_transitions.outflows[].cells[].rows", "checkTransitions: at least 1, and the cells sum to both margins"],
  ["engines[].hf_transitions.outflows[].cells[].debt_before_usd", "checkTransitions: the per-side sum, null exactly on the unmeasured cell"],
  ["engines[].hf_transitions.outflows[].cells[].debt_after_usd", "checkTransitions: the same, on the after side"],
  ["engines[].hf_transitions.from_rows[]", "checkTransitions: IS the before histogram, lane for lane"],
  ["engines[].hf_transitions.to_rows[]", "checkTransitions: IS the after histogram, lane for lane"],
  ["engines[].hf_transitions.total_rows", "checkTransitions: measured plus unmeasured, and the sum of every cell"],
  ["engines[].hf_transitions.measured_rows", "checkTransitions: IS before.accounts and after.accounts"],
  ["engines[].hf_transitions.unmeasured_rows", "checkTransitions: IS the histogram's refused_count"],
  ["engines[].hf_transitions.unmeasured_refused_in_batch_rows", "checkTransitions: the part coverage.refused_in_batch holds"],
  ["engines[].hf_transitions.unmeasured_excluded_by_this_layer_rows", "checkTransitions: the part coverage.excluded[] holds, counted from that array"],
  ["engines[].hf_transitions.held_rows", "checkTransitions: the diagonal over lanes 0..N, NULL when nothing was measured"],
  ["engines[].hf_transitions.lane_changed_rows", "checkTransitions: the off-diagonal, NULL under the same condition"],
  ["engines[].hf_transitions.note", "checkTransitions: the server's own sentence, carried with its engine"],
]);

/**
 * REGISTER 2 — ANCHORED. `by` names WHICH anchor holds it.
 *
 *   "response"  the response anchor declared beside the body — a frozen literal
 *               or a frozen sentence, re-proved against its committed source.
 *   "holding"   law 9's holding anchor, which pins every byte of a holding a
 *               scenario does not write.
 */
const RESPONSE_ANCHORED_LEAVES = new Map([
  ["label", { by: "response", why: "the committed definition's own label" }],
  ["description", { by: "response", why: "the committed definition's own description" }],
  ["path_assumption", { by: "response", why: "the committed definition's own path assumption" }],
  ["out_of_model[]", { by: "response", why: "the committed definition's own caveats, in order" }],
  ["notes[]", { by: "response", why: "the contract example's own response-level disclosure" }],
  ["scenario_config_version", { by: "response", why: "the contract example's own set token" }],
  ["coverage.note", { by: "response", why: "the contract example's own coverage sentence" }],

  ["batch.id", { by: "response", why: "the contract example's own batch identity" }],
  ["batch.computed_at", { by: "response", why: "the contract example's own compute stamp" }],
  ["batch.producer", { by: "response", why: "the contract example's own producer" }],
  ["batch.status", { by: "response", why: "the contract example's own status — what a reader trusts to mean complete" }],
  ["batch.refused_count", { by: "response", why: "the contract example's own batch refusal count" }],
  ["batch.flagged_count", { by: "response", why: "the contract example's own flagged count" }],
  ["batch.refused_engines[]", { by: "response", why: "the contract example's own roster, empty included" }],
  ["batch.supersession.superseded", { by: "response", why: "the contract example's own supersession flag" }],
  ["batch.supersession.legs[]", { by: "response", why: "the contract example's own legs, empty included" }],
  ["batch.supersession.note", { by: "response", why: "the contract example's own supersession sentence" }],
  ["batch.watermarks[].engine", { by: "response", why: "the contract example's own watermark" }],
  ["batch.watermarks[].chain_id", { by: "response", why: "the chain every propagation key in this body is read on" }],
  ["batch.watermarks[].last_block", { by: "response", why: "the contract example's own watermark" }],
  ["batch.watermarks[].acked_epoch", { by: "response", why: "the contract example's own watermark" }],
  ["batch.watermarks[].max_epoch_at_compute", { by: "response", why: "the contract example's own watermark" }],
  ["batch.watermarks[].sweep", { by: "response", why: "NULL is the disclosure that this engine runs no sweep" }],
  ["batch.watermarks[].sweep.rows", { by: "response", why: "the contract example's own sweep" }],
  ["batch.watermarks[].sweep.failed", { by: "response", why: "the contract example's own sweep" }],
  ["batch.watermarks[].sweep.success_sum", { by: "response", why: "the contract example's own sweep" }],
  ["batch.watermarks[].sweep.max_updated_at", { by: "response", why: "the contract example's own sweep" }],
  ["batch.watermarks[].sweep.generation", { by: "response", why: "the contract example's own sweep" }],
  ["batch.watermarks[].sweep.generation_open", { by: "response", why: "the contract example's own sweep" }],

  ["engines[].note", { by: "response", why: "the sentence the page renders beside the deltas" }],
  ["engines[].movers_note", { by: "response", why: "the sentence that says whether the ranking is COMPLETE" }],
  // WHAT IS LEFT OF THE REALIZATION BLOCK AFTER WAVE W-BS-I, and why each is
  // genuinely envelope rather than arithmetic somebody has not got to yet:
  //
  //   seizure_model  the disclosed MODELLING ASSUMPTION, not a measurement — it
  //                  names which of several defensible seizure models the number
  //                  beside it was computed under. Its provenance is the Go
  //                  constant `risk.SeizureModelProRata` (internal/risk
  //                  /shortfall.go:45), which the example's byte reproduces
  //                  verbatim; a generator cannot compose a Go constant, so the
  //                  strongest available statement is a frozen pin on the string.
  //   note           the disclosure SENTENCE a reader is told the numbers mean.
  //                  DISCHARGED IN WAVE W-EX-A: `p5_runbook.go:612` writes ONE
  //                  sentence for EVERY engine, and the example used to carry
  //                  two different ones — a longer aave sentence and a short
  //                  debt_manager sentence production would never emit. The
  //                  example is CAPTURED from the running handler now, so both
  //                  engines carry the sentence the server composes and the two
  //                  committed artifacts agree.
  ["engines[].market_realization.seizure_model", { by: "response", why: "the disclosed seizure model — `risk.SeizureModelProRata`, a Go constant no generator composes" }],
  ["engines[].market_realization.note", { by: "response", why: "the realization sentence the serving layer composes, one for every engine, frozen from the example's captured bytes" }],

  ["applied_shocks[].source", { by: "response", why: "WHICH oracle moved — a frozen literal of this body's own inputs" }],
  ["applied_shocks[].snapped", { by: "response", why: "a stable-band snap this generator does not model, frozen false" }],
  ["applied_shocks[].base_snapped", { by: "response", why: "the same, on the base leg" }],
  ["applied_shocks[].cap_bound", { by: "response", why: "whether an Aave price cap BOUND — frozen false, and checked" }],
  ["held_flat[].source", { by: "response", why: "WHICH oracle held — a frozen literal of this body's own inputs" }],

  ...bothSides("collateral_by_asset[].asset").map((path) => [path, { by: "holding", why: "law 9" }]),
  ...bothSides("collateral_by_asset[].amount").map((path) => [path, { by: "holding", why: "law 9" }]),
  ...bothSides("collateral_by_asset[].decimals").map((path) => [path, { by: "holding", why: "law 9" }]),
  ...bothSides("collateral_by_asset[].symbol").map((path) => [path, { by: "holding", why: "law 9" }]),
  ...bothSides("collateral_by_asset[].unpriced").map((path) => [path, { by: "holding", why: "law 9" }]),
  ...bothSides("collateral_by_asset[].note").map((path) => [path, { by: "holding", why: "law 9" }]),
]);

/**
 * REGISTER 3 — ENUMERATED-UNPINNED. Free, by a decision written down, each with
 * a one-line reason a reviewer can REJECT.
 *
 * This register is the honest residue, and it is meant to stay a list a person
 * can read in one breath. An entry here is not a gap that was missed; it is a
 * gap somebody argued for. Deleting an entry without pinning the field makes
 * the completeness law fail on that field — which is mutant AL.
 */
const RESPONSE_UNPINNED_LEAVES = new Map([
  [
    "served_at",
    "stamped by the SERVING layer at the instant the response leaves, not computed from the batch " +
      "— no law in a fixture generator can pin a clock, and pinning it to the example's would " +
      "assert a value that says nothing about the run. Its COHERENCE is still held: law 14 makes " +
      "BOTH stated ages answer to it — batch.age_seconds and every sweep's age_seconds, which is " +
      "the same database instant production measures them from.",
  ],
]);

// THE FROZEN ENVELOPE, RE-PROVED — now that the anchored register exists to say
// which leaves it has to cover. Every body below anchors to what this returns.
freezeExampleEnvelope(FROZEN_RUNBOOK_EXAMPLE);

/**
 * One served leaf against its declared anchor.
 *
 * `freezeEnvelopeLeaf` reads the other direction — a frozen pin against the
 * committed SOURCE it was taken from, where a mismatch means the source moved.
 * Here the pin is settled and the BODY is what is being judged, so the sentence
 * says so: this is a generated response diverging from the bytes it was composed
 * to carry, which is a different failure and gets different words.
 */
const checkAnchoredLeaf = (name, path, frozen, served) => {
  const digested =
    frozen !== null && typeof frozen === "object" && !Array.isArray(frozen) && "digest" in frozen;
  const ok = digested
    ? typeof served === "string" &&
      createHash("sha256").update(served, "utf8").digest("hex").slice(0, 16) === frozen.digest
    : frozen === served;
  if (ok) {
    return;
  }
  const want = digested
    ? `the frozen sentence beginning ${JSON.stringify(frozen.excerpt)}`
    : leafShown(frozen);
  fail(
    `${name} serves ${path} = ${leafShown(served)}, but its declared response ANCHOR pins ${want} ` +
      `— the envelope is every byte a reader is SHOWN that no holding, no aggregate and no ` +
      `disclosure arithmetic accounts for, and it answers to a source like everything else`,
  );
};

/**
 * THE COMPLETENESS LAW ITSELF.
 *
 * `anchor` is the response anchor declared beside the body: concrete leaf path
 * to frozen literal / frozen sentence / empty-array sentinel. The registers are
 * parameters so the law's OWN failure can be watched (mutant AL) rather than
 * only asserted.
 */
const checkCompleteness = (
  name,
  response,
  anchor,
  registers = {
    derived: RESPONSE_DERIVED_LEAVES,
    anchored: RESPONSE_ANCHORED_LEAVES,
    unpinned: RESPONSE_UNPINNED_LEAVES,
  },
) => {
  if (!(anchor instanceof Map) || anchor.size === 0) {
    fail(
      `${name} is checked with NO declared response anchor, so every envelope byte a reader is ` +
        `SHOWN — the batch, the notes, the disclosure sentences — is pinned to nothing`,
    );
  }
  const consumed = new Set();
  for (const [path, value] of responseLeaves(response)) {
    const pattern = leafPattern(path);
    const registered = [
      registers.derived.has(pattern) ? "DERIVED" : null,
      registers.anchored.has(pattern) ? "ANCHORED" : null,
      registers.unpinned.has(pattern) ? "ENUMERATED-UNPINNED" : null,
    ].filter((entry) => entry !== null);
    if (registered.length === 0) {
      fail(
        `${name} serves ${path} = ${leafShown(value)}, which is in NO register — a field cannot be ` +
          `free because nobody thought to name it. Put it in DERIVED (compose it and compare it), ` +
          `in ANCHORED (freeze it against its committed source), or in ENUMERATED-UNPINNED with a ` +
          `one-line reason a reviewer can reject.`,
      );
    }
    if (registered.length > 1) {
      fail(
        `${name} serves ${path}, which ${registered.join(" AND ")} both claim — a leaf claimed by ` +
          `two registers is a leaf whose coverage nobody can state; exactly one register owns it`,
      );
    }
    if (registered[0] !== "ANCHORED" || registers.anchored.get(pattern).by !== "response") {
      continue;
    }
    if (!anchor.has(path)) {
      fail(
        `${name} serves the response-ANCHORED leaf ${path} = ${leafShown(value)}, which the ` +
          `declared anchor does not name — an anchored field with no anchor entry is anchored to ` +
          `nothing`,
      );
    }
    consumed.add(path);
    checkAnchoredLeaf(name, path, anchor.get(path), value);
  }
  for (const path of anchor.keys()) {
    if (!consumed.has(path)) {
      fail(
        `${name} serves NO leaf at ${path}, which the declared response ANCHOR pins — a body may ` +
          `not drop an envelope field its own source carries, and a walk over what is THERE can ` +
          `never see what is not`,
      );
    }
  }
};

/**
 * CONTRACT 1.7.0 — the transition matrix re-proved against the two histograms
 * it sits between, on EVERY body this file writes: derived ones and carried
 * ones alike.
 *
 * The margins ARE those histograms, so this is not a spot check on the numbers
 * one function happened to compose — it is the law that makes a carried matrix
 * beside a transformed book a generation failure rather than a fixture that
 * renders a Sankey whose ribbons do not sum to the bars printed next to them.
 */
const checkTransitions = (label, engine, coverage) => {
  const t = engine.hf_transitions;
  if (t === undefined || t === null) {
    fail(`${label} serves no hf_transitions — contract 1.7.0 requires one per engine`);
  }
  const laneCount = t.lanes.length;
  const buckets = engine.before.hf_histogram.buckets;
  if (laneCount !== buckets.length + 2) {
    fail(
      `${label} serves ${String(laneCount)} lanes over ${String(buckets.length)} buckets — the ` +
        `vocabulary is the buckets PLUS the two tallies that sit beside them, and nothing else`,
    );
  }
  // THE LANES ARE THE HISTOGRAM'S OWN BUCKETS, byte for byte.
  for (const [index, bucket] of buckets.entries()) {
    const lane = t.lanes[index];
    for (const [field, want, got] of [
      ["index", index, lane.index],
      ["kind", "bucket", lane.kind],
      ["label", bucket.label, lane.label],
      ["lower_wad", bucket.lower_wad, lane.lower_wad],
      ["upper_wad", bucket.upper_wad, lane.upper_wad],
    ]) {
      if (String(want) !== String(got)) {
        fail(
          `${label} lane ${String(index)} ${field} is ${leafShown(got)} but the histogram bucket ` +
            `beside it says ${leafShown(want)} — the lanes ARE the buckets, not a second edge table`,
        );
      }
    }
  }
  const infiniteLane = buckets.length;
  const unmeasuredLane = buckets.length + 1;
  if (t.lanes[infiniteLane].kind !== "infinite" || t.lanes[unmeasuredLane].kind !== "unmeasured") {
    fail(`${label} does not end its lane vocabulary in the infinite and unmeasured tallies`);
  }

  // THE MARGINS ARE THE TWO HISTOGRAMS, and both are the cells' own sums.
  const tallies = (histogram) => [
    ...histogram.buckets.map((bucket) => bucket.count),
    histogram.infinite_count,
    histogram.refused_count,
  ];
  const fromRows = Array.from({ length: laneCount }, () => 0);
  const toRows = Array.from({ length: laneCount }, () => 0);
  let total = 0;
  let held = 0;
  let changed = 0;
  let debtBefore = 0n;
  let debtAfter = 0n;
  if (t.outflows.length !== laneCount) {
    fail(`${label} serves ${String(t.outflows.length)} outflows over ${String(laneCount)} lanes — outflows are DENSE`);
  }
  for (const [from, outflow] of t.outflows.entries()) {
    if (outflow.from !== from) {
      fail(`${label} outflow ${String(from)} says from = ${String(outflow.from)} — the array is positional`);
    }
    let previous = -1;
    for (const cell of outflow.cells) {
      if (cell.rows < 1) {
        fail(`${label} cell (${String(from)},${String(cell.to)}) holds ${String(cell.rows)} rows — an empty cell is ABSENT`);
      }
      if (cell.to <= previous) {
        fail(`${label} outflow ${String(from)} does not ascend strictly by \`to\``);
      }
      previous = cell.to;
      fromRows[from] += cell.rows;
      toRows[cell.to] += cell.rows;
      total += cell.rows;
      const unmeasuredCell = from === unmeasuredLane && cell.to === unmeasuredLane;
      if (unmeasuredCell !== (cell.debt_before_usd === null)) {
        fail(
          `${label} cell (${String(from)},${String(cell.to)}) serves debt_before_usd ` +
            `${leafShown(cell.debt_before_usd)} — a null is the UNKNOWABLE this run measured ` +
            `nothing for, and it belongs to the unmeasured cell and to no other`,
        );
      }
      if (unmeasuredCell !== (cell.debt_after_usd === null)) {
        fail(`${label} cell (${String(from)},${String(cell.to)}) disagrees with itself about which side is knowable`);
      }
      if (!unmeasuredCell) {
        debtBefore += BigInt(cell.debt_before_usd);
        debtAfter += BigInt(cell.debt_after_usd);
      }
      if (from === unmeasuredLane) {
        continue;
      }
      if (from === cell.to) {
        held += cell.rows;
      } else {
        changed += cell.rows;
      }
    }
  }
  for (const [side, margin, sums] of [
    ["from_rows", t.from_rows, fromRows],
    ["to_rows", t.to_rows, toRows],
  ]) {
    const histogram = side === "from_rows" ? engine.before.hf_histogram : engine.after.hf_histogram;
    const want = tallies(histogram);
    for (let lane = 0; lane < laneCount; lane += 1) {
      if (margin[lane] !== sums[lane]) {
        fail(
          `${label} ${side}[${String(lane)}] is ${String(margin[lane])} but its cells sum to ` +
            `${String(sums[lane])} — a margin is the cells' own sum or it is a second story`,
        );
      }
      if (margin[lane] !== want[lane]) {
        fail(
          `${label} ${side}[${String(lane)}] is ${String(margin[lane])} but the histogram beside ` +
            `it tallies ${String(want[lane])} — the margins ARE the two histograms, lane for lane`,
        );
      }
    }
  }
  const checks = [
    ["total_rows against the cells", t.total_rows, total],
    ["measured_rows against before.accounts", t.measured_rows, engine.before.accounts],
    ["measured_rows against after.accounts", t.measured_rows, engine.after.accounts],
    ["unmeasured_rows against refused_count", t.unmeasured_rows, engine.before.hf_histogram.refused_count],
    ["total_rows against measured + unmeasured", t.total_rows, t.measured_rows + t.unmeasured_rows],
    [
      "the cause split against the population it splits",
      t.unmeasured_rows,
      t.unmeasured_refused_in_batch_rows + t.unmeasured_excluded_by_this_layer_rows,
    ],
    [
      "unmeasured_excluded_by_this_layer_rows against coverage.excluded[]",
      t.unmeasured_excluded_by_this_layer_rows,
      coverage.excluded.filter((entry) => entry.engine === engine.engine).length,
    ],
  ];
  for (const [what, stated, derived] of checks) {
    if (stated !== derived) {
      fail(`${label} hf_transitions: ${what} — states ${String(stated)}, derives ${String(derived)}`);
    }
  }
  // NULL, NEVER ZERO, over a book this run never measured.
  if (t.measured_rows === 0) {
    if (t.held_rows !== null || t.lane_changed_rows !== null) {
      fail(
        `${label} measured no row yet states held_rows ${leafShown(t.held_rows)} and ` +
          `lane_changed_rows ${leafShown(t.lane_changed_rows)} — a zero there claims a ` +
          `measurement nobody made`,
      );
    }
  } else {
    if (t.held_rows !== held || t.lane_changed_rows !== changed) {
      fail(
        `${label} states held/changed ${String(t.held_rows)}/${String(t.lane_changed_rows)} but ` +
          `its own cells give ${String(held)}/${String(changed)}`,
      );
    }
    if (t.held_rows + t.lane_changed_rows + t.unmeasured_rows !== t.total_rows) {
      fail(`${label} movement partition does not cover the matrix`);
    }
  }
  // DEBT RECONCILES PER SIDE, against the engine's own served totals.
  for (const [side, sum] of [
    ["before", debtBefore],
    ["after", debtAfter],
  ]) {
    if (sum !== BigInt(engine[side].total_debt_usd)) {
      fail(
        `${label} ${side}-side cell debts sum to ${String(sum)} but the engine serves ` +
          `total_debt_usd ${engine[side].total_debt_usd} — the cells decompose that total exactly`,
      );
    }
  }
  if (t.comparator !== engine.before.hf_histogram.comparator) {
    fail(`${label} hf_transitions.comparator disagrees with the histogram beside it`);
  }
  if (t.wad_scale !== engine.before.hf_histogram.wad_scale) {
    fail(`${label} hf_transitions.wad_scale disagrees with the histogram beside it`);
  }
};

const checkResponse = (name, response, declared) => {
  checkPropagation(name, response, declared);
  for (const side of ["before", "after"]) {
    const accounts = response.engines.reduce((sum, engine) => sum + engine[side].accounts, 0);
    if (accounts !== response.coverage.in_book) {
      fail(
        `${name} ${side}-side accounts across engines ${String(accounts)} ` +
          `!= coverage.in_book ${String(response.coverage.in_book)}`,
      );
    }
  }
  // Every position the batch carries is in the run, refused in the batch, or
  // excluded by this layer. (This scenario covers BOTH engines, so no position
  // is absent for want of coverage.)
  const accountedFor =
    response.coverage.in_book +
    response.coverage.refused_in_batch +
    response.coverage.excluded_by_this_layer;
  if (accountedFor !== response.coverage.batch_positions) {
    fail(
      `${name} coverage accounts for ${String(accountedFor)} positions ` +
        `but batch_positions is ${String(response.coverage.batch_positions)}`,
    );
  }
  if (response.batch.position_count !== response.coverage.batch_positions) {
    fail(
      `${name} batch.position_count ${String(response.batch.position_count)} ` +
        `!= coverage.batch_positions ${String(response.coverage.batch_positions)}`,
    );
  }
  if (response.batch.refused_count !== response.coverage.refused_in_batch) {
    fail(
      `${name} batch.refused_count ${String(response.batch.refused_count)} ` +
        `!= coverage.refused_in_batch ${String(response.coverage.refused_in_batch)}`,
    );
  }
  for (const engine of response.engines) {
    const label = `${name} ${engine.engine}`;
    checkSide(`${label} before`, engine.before);
    checkSide(`${label} after`, engine.after);
    // THE DELTAS ARE AFTER MINUS BEFORE. The matrix cell renders
    // `eligible_debt_delta_usd` as the run's own answer, so a delta that did
    // not come from the two sides beside it is a number with no witness.
    const deltas = [
      ["newly_eligible_accounts", engine.newly_eligible_accounts,
        engine.after.eligible_accounts - engine.before.eligible_accounts],
      ["eligible_debt_delta_usd", BigInt(engine.eligible_debt_delta_usd),
        BigInt(engine.after.eligible_debt_usd) - BigInt(engine.before.eligible_debt_usd)],
      ["bad_debt_delta_usd", BigInt(engine.bad_debt_delta_usd),
        BigInt(engine.after.bad_debt_usd) - BigInt(engine.before.bad_debt_usd)],
    ];
    for (const [field, stated, derived] of deltas) {
      if (stated !== derived) {
        fail(`${label} ${field} states ${String(stated)} but after-minus-before is ${String(derived)}`);
      }
    }
    // The disclosure sentence derives "top S of T" from these two; a slice
    // longer than the total it is a window onto is not a window.
    if (engine.movers.length > engine.movers_total) {
      fail(
        `${label} serves ${String(engine.movers.length)} movers ` +
          `under a movers_total of ${String(engine.movers_total)}`,
      );
    }
    // A MOVER IS AN ACCOUNT (Wave W-BS-F, round 31's fourth finding). The law
    // above bounds `movers_total` from BELOW only, so `movers_total: 2` on an
    // engine that measured ONE account read green — a total larger than the set
    // it counts over, which is the census claiming accounts the run never saw.
    for (const side of ["before", "after"]) {
      if (engine.movers_total > engine[side].accounts) {
        fail(
          `${label} publishes movers_total ${String(engine.movers_total)} but its ${side} side ` +
            `measures ${String(engine[side].accounts)} accounts — a mover IS an account, so the ` +
            `ranked set can never be larger than the set it ranks`,
        );
      }
    }
    // THE NOTE IS A DISCLOSURE, AND IT SAYS WHETHER THE LIST IS COMPLETE.
    // `p5_runbook.go:842-856` writes "`movers` carries all N of them." when the
    // slice is the WHOLE ranking and a truncation sentence when it is not — so a
    // note claiming completeness is a claim `movers.length` has to keep.
    const carriesAll = /`movers` carries all (\d+) of them/.exec(engine.movers_note ?? "");
    if (carriesAll !== null) {
      const claimed = Number(carriesAll[1]);
      if (claimed !== engine.movers_total || engine.movers.length !== engine.movers_total) {
        fail(
          `${label} says its note carries all ${String(claimed)} movers while publishing ` +
            `movers_total ${String(engine.movers_total)} over ${String(engine.movers.length)} ` +
            `served rows — a note that claims the COMPLETE ranking is a claim the array has to keep`,
        );
      }
    }
    // A DEBT MANAGER MOVER AND THE HISTOGRAM MUST TELL ONE STORY: the rational
    // the row publishes has to land where the flip says it landed.
    for (const mover of engine.movers) {
      if (mover.became_eligible !== true) {
        continue;
      }
      const before = bucketLabelForRational(
        engine.before.hf_histogram, BigInt(mover.hf_before_num), BigInt(mover.hf_before_den),
      );
      const after = bucketLabelForRational(
        engine.after.hf_histogram, BigInt(mover.hf_after_num), BigInt(mover.hf_after_den),
      );
      if (engine.before.hf_histogram.buckets.find((b) => b.label === before).count === 0) {
        fail(`${label} mover ${mover.account} sits in an EMPTY before-bucket ${before}`);
      }
      if (engine.after.hf_histogram.buckets.find((b) => b.label === after).count === 0) {
        fail(`${label} mover ${mover.account} sits in an EMPTY after-bucket ${after}`);
      }
    }
  }
  // THE SECOND PEN. Every property law above has had its say and given its own
  // named refusal; what remains is the question no property of a body can
  // answer — whether the numbers are THE RIGHT NUMBERS. The derivation was
  // composed from the frozen sources before this body was read.
  checkDerivation(name, response, declared?.derivation);

  // CONTRACT 1.7.0 — THE MATRIX AGAINST THE TWO HISTOGRAMS IT SITS BETWEEN.
  // It runs AFTER the second pen for the same reason every reading below does:
  // it compares one disclosure against ANOTHER disclosure, so wherever the
  // derivation composes either side the derivation is the stronger statement
  // and owns the refusal. What is left here is the case the derivation cannot
  // see — a matrix whose margins do not sum to the bars printed beside them.
  for (const engine of response.engines) {
    checkTransitions(`${name} ${engine.engine}`, engine, response.coverage);
  }

  // ===== THE READINGS THE DERIVATION CANNOT MAKE (Wave W-BS-H) ==============
  //
  // These four run AFTER the second pen, and the order is the point. Each of
  // them compares one disclosure against ANOTHER disclosure — a stated age
  // against the two stamps beside it, a roster against the roster it duplicates,
  // a realization against the scenario's own axis, a sentence against the scale
  // it names. Where the derivation composes either side, the derivation is the
  // stronger statement and owns the refusal; these own only what is left: the
  // case where every composed value is RIGHT and the body still contradicts
  // itself about what those values mean.

  // LAW 17, LAST: THE NOTE MAY NOT CONTRADICT THE SCALE IT NAMES (Wave W-BS-H,
  // residual A.1).
  //
  // `engines[].note` is ANCHORED to a frozen sentence and `usd_decimals` is
  // DERIVED from the serializer's own constant — so both halves of this fact are
  // already pinned, separately, and that is precisely the gap. An anchor proves
  // a sentence is the one its source carries; it cannot prove the sentence is
  // TRUE OF THIS BODY. The serving layer writes the engine's own exponent INTO
  // the words ("in this engine's own 6-decimal unit"), so a body states its
  // scale twice: once as the exponent every number is READ at, and once as a
  // numeral in a sentence a reader believes. Re-freeze the wrong sentence — the
  // ordinary way this drifts, when a later wave edits `engineNote` and updates
  // the digest without reading the words — and both pins are satisfied while the
  // page tells a reader to read $6,500.00 at an exponent the numbers are not in.
  //
  // It runs AFTER the derivation deliberately. A body whose SCALE is wrong is
  // the derivation's refusal, not this one's; this law owns only the case where
  // the scale is right and the sentence beside it disagrees.
  // LAW 14: THE BATCH'S OWN CLOCK IS COHERENT (Wave W-BS-H; CORRECTED Wave
  // W-EX-B). `served_at` is the one leaf this file leaves free, and a free clock
  // beside a stated age is two disclosures that can drift: `batch.age_seconds`
  // is how STALE a reader is told the numbers are, and it is
  // `served_at - computed_at`.
  //
  // THE SWEEP'S AGE ANSWERS TO THE SAME CLOCK, and this law used to say
  // otherwise. It measured the sweep from the COMPUTE stamp — "a sweep's
  // staleness is a property of the batch and not of when somebody asked for
  // it" — which is a defensible sentence about a quantity PRODUCTION DOES NOT
  // SERVE. `cmd/api/meta.go:156-177` writes the sweep's age as DB-now minus the
  // stamp, from the very same `v.Now` that stamps `served_at`, and the
  // contract's own `SweepStamp` prose says so in words: "the database clock at
  // SERVE time minus the stamp — the stamp itself is immutable capture-time
  // evidence".
  //
  // The old reading's stated provenance was that "both identities hold to the
  // second in the contract's own example" — and they did, because the example
  // published a 1200-second sweep age over a stamp 1205 seconds before its own
  // `served_at`. The wrong law and the wrong example each vouched for the
  // other, which is exactly the shape a law is supposed to make impossible. The
  // example now carries 1205 and this law is measured from `served_at`, so the
  // two artifacts agree on the arithmetic the server actually performs.
  const seconds = (from, to) => (Date.parse(to) - Date.parse(from)) / 1000;
  const servedAge = seconds(response.batch.computed_at, response.served_at);
  if (response.batch.age_seconds !== servedAge) {
    fail(
      `${name} publishes batch.age_seconds ${String(response.batch.age_seconds)}, but it was ` +
        `computed at ${response.batch.computed_at} and served at ${response.served_at}, which is ` +
        `${String(servedAge)} seconds — the stated age of a batch is how stale a reader is told ` +
        `the numbers are, so it answers to the two stamps beside it`,
    );
  }
  for (const watermark of response.batch.watermarks) {
    if (watermark.sweep === null) {
      continue;
    }
    const sweepAge = seconds(watermark.sweep.max_updated_at, response.served_at);
    if (watermark.sweep.age_seconds !== sweepAge) {
      fail(
        `${name} publishes a ${watermark.engine} sweep age of ` +
          `${String(watermark.sweep.age_seconds)} seconds over rows last updated at ` +
          `${watermark.sweep.max_updated_at} for a body served at ${response.served_at}, ` +
          `which is ${String(sweepAge)} — a sweep's age is the SERVE-time database clock minus its ` +
          `own stamp (cmd/api/meta.go:156-177), the same instant batch.age_seconds answers to`,
      );
    }
  }
  // LAW 15: ONE WITHHELD ROSTER, READ TWICE. `excluded_engines[]` at the top
  // level and `coverage.withheld_engines[]` are the same set of refused engine
  // books (item 4's own rule: the withheld engine gets the refusal in BOTH), and
  // `checkDerivation` composes only the second. A body that names an engine in
  // one and not the other is the `run-book.contradictory` shape — served and
  // withheld at once — which is a DELIBERATE fixture there and must never be a
  // silent possibility in a generated body.
  const excludedNames = response.excluded_engines.map((entry) => entry.engine).join(" ");
  const withheldNames = response.coverage.withheld_engines.map((entry) => entry.engine).join(" ");
  if (excludedNames !== withheldNames) {
    fail(
      `${name} names [${excludedNames}] in excluded_engines but [${withheldNames}] in ` +
        `coverage.withheld_engines — a withheld engine's refusal is recorded in BOTH, so the two ` +
        `rosters are one census read twice and cannot disagree`,
    );
  }
  // LAW 16: THE REALIZATION AXIS IS THE SCENARIO'S, NOT THE BODY'S. The contract
  // says `market_realization` is "present when the scenario carries a
  // market-realization axis", and the committed registry is where that axis
  // lives — so whether the field is NULL is decided by the scenario this body
  // answers, never announced by the body. `eth_minus_30` carries no
  // `market_realizations`; `weeth_market_depeg_oracles_held` carries two.
  const realizations = committedScenario(response.scenario_id).market_realizations ?? [];
  for (const engine of response.engines) {
    const carries = engine.market_realization !== null && engine.market_realization !== undefined;
    if (carries !== realizations.length > 0) {
      fail(
        `${name} ${engine.engine} serves market_realization ` +
          `${carries ? "an object" : shown(engine.market_realization)}, but the committed ` +
          `${response.scenario_id} registry entry carries ${String(realizations.length)} ` +
          `market-realization rows — the axis belongs to the SCENARIO, so a body may neither ` +
          `invent a realization the scenario has no axis for nor withhold one it does`,
      );
    }
  }
  // LAW 18: THE PROJECTION AXIS IS THE SCENARIO'S TOO — AND THE DEBT MANAGER'S
  // ALONE (Wave W-BS-I, the round-33 audit). `cmd/api/p5_runbook.go:616-624`
  // composes `projection` when — and only when — the committed scenario carries a
  // `projection` axis AND the engine is the Debt Manager; every other engine
  // publishes NULL. This leaf was ANCHORED as "the contract example's own NULL",
  // which is round 33's misclassification in its other form: a value the
  // COMMITTED SCENARIO decides, pinned to a carried literal instead. The pin held
  // the field on the bodies whose example happened to carry null and said nothing
  // about WHOSE null it was, so an aave engine could grow a rate horizon.
  const projectionAxis = committedScenario(response.scenario_id).projection;
  const projects = projectionAxis !== null && projectionAxis !== undefined;
  for (const engine of response.engines) {
    const owed = projects && engine.engine === "debt_manager";
    const carries = engine.projection !== null && engine.projection !== undefined;
    if (carries !== owed) {
      fail(
        `${name} ${engine.engine} serves projection ` +
          `${carries ? "an object" : shown(engine.projection)}, but the committed ` +
          `${response.scenario_id} registry entry carries ${projects ? "a" : "no"} projection axis ` +
          `and this engine is ${engine.engine === "debt_manager" ? "" : "NOT "}the Debt Manager — a ` +
          `rate projection is composed for the SCENARIO's own rate axis and for the one engine that ` +
          `HAS a rate, never carried because the example's null looked right`,
      );
    }
  }
  for (const engine of response.engines) {
    for (const [field, sentence] of [
      ["note", engine.note],
      ["movers_note", engine.movers_note],
    ]) {
      const claimed = /\b(\d+)-decimal\b/.exec(sentence ?? "");
      if (claimed !== null && Number(claimed[1]) !== engine.usd_decimals) {
        fail(
          `${name} ${engine.engine} publishes usd_decimals ${String(engine.usd_decimals)} while its ` +
            `own ${field} calls the unit ${claimed[1]}-decimal — the sentence is what a reader is ` +
            `TOLD the numbers are in, so a body cannot state its scale twice and disagree with itself`,
        );
      }
    }
  }

  // THE WHOLE TREE, LAST OF ALL. Every law in this file was written by somebody
  // who went LOOKING for a field, and each one above has now had its say. This
  // one asks the BODY which fields it has, and refuses any leaf no register
  // claims — so it is a last resort by construction: it fires exactly where no
  // named law reached, which is the only place a wrong byte can still be born.
  checkCompleteness(name, response, declared?.anchor);
};

/** The example's own COUNTED sentence, reused rather than paraphrased. */
const countedNote = runBookExample.engines
  .flatMap((engine) => engine.before.collateral_by_asset)
  .find((entry) => entry.value_usd !== null)?.note;
if (countedNote === undefined) {
  console.error("generate-lab-book.mjs: the run-book example carries no counted collateral entry");
  process.exit(1);
}

/**
 * The invented account's holding, valued at its own price on one side. The
 * symbol is the propagation row's own, so the entry names the asset the matrix
 * names rather than serving an address with no identity.
 */
const flipCollateralEntry = (valueUSD) => ({
  asset: DM_FLIP_ASSET,
  symbol: DM_FLIP_SYMBOL,
  decimals: DM_FLIP_ASSET_DECIMALS,
  amount: DM_FLIP_AMOUNT.toString(),
  value_usd: valueUSD.toString(),
  unpriced: false,
  note: countedNote,
});

/**
 * The injected account's OTHER holding — the one no propagation row describes,
 * so it is worth the same on both sides and production records it on `HeldFlat`.
 * Its symbol is the token's own, not a propagation row's: the matrix says
 * nothing about it, which is the whole point.
 */
const heldCollateralEntry = () => ({
  asset: DM_HELD_ASSET,
  symbol: DM_HELD_SYMBOL,
  decimals: DM_HELD_DECIMALS,
  amount: DM_HELD_AMOUNT.toString(),
  value_usd: DM_HELD_VALUE.toString(),
  unpriced: false,
  note: countedNote,
});

/** Both injected holdings on one side, in the order the caller will sort them. */
const injectedCollateralEntries = (flipValueUSD) => [
  flipCollateralEntry(flipValueUSD),
  heldCollateralEntry(),
];

/**
 * The server's own ordering: by `asset.Hex()`, then by disclosure — the exact
 * comparator at `cmd/api/p5_runbook.go:332-337`, whose stated purpose is that
 * "two runs over the same batch serve byte-identical arrays".
 *
 * APPLYING IT REORDERS THE CONTRACT EXAMPLE'S OWN AAVE ENTRIES, and that is
 * recorded rather than quietly done. The example lists weETH (0xCd5f…) before
 * the unpriced 0x0000…0BAD; production sorts by address, and "0x0000…" sorts
 * before "0xCd5f…", so the live server emits them the other way round. The
 * example's order is one this endpoint cannot produce. Once the aave rows are
 * re-measured they are re-serialized the way the endpoint serializes them, in
 * the same breath and for the same reason — a fixture may only claim what the
 * production evaluator could serve, and that includes the order it serves in.
 */
const byAsset = (entries) =>
  [...entries].sort((a, b) => (a.asset < b.asset ? -1 : a.asset > b.asset ? 1 : 0));

// --- THE AAVE ENGINE, RE-MEASURED FROM THE SAME COMMITTED eth_minus_30 RUN --
//
// The example's aave rows were measured under `weeth_market_depeg_oracles_held`
// — `shocks: []`, `propagation: []` — so its two sides are bit-identical BY
// CONSTRUCTION. Re-identifying that envelope to eth_minus_30 and leaving those
// rows alone produced a body no evaluator could serve: the account holds weETH
// on mainnet, eth_minus_30's matrix DECLARES weETH-on-mainnet against `eth_usd`
// (internal/risk/scenarios/eth_minus_30.json, fifth propagation row), and a
// declared asset cannot hold still. The old file went further and grafted that
// shock into `applied_shocks` while the aggregate it names never moved — a
// disclosure with nothing behind it.
//
// The fix is not to delete the claim. It is to serve the measurement the
// contract already commits for exactly this account under exactly this
// scenario: `stress-aave.json`'s own eth_minus_30 result. That row is
// contract-validated, it was measured AT THE SAME BATCH as the run-book example
// (asserted below), and its before side carries THE SAME MONEY as the example's
// aave aggregate — one account, $8,000 of collateral, $6,000 of debt, healthy.
// It is the same book, and it already knows what eth_minus_30 does to it.
//
// Everything the aave engine publishes is derived from that result plus ONE
// committed parameter pair, and nothing is typed in:
//
//   both sides' money, eligibility, HF wads and HF rationals
//                     `stress-aave.json` → scenarios[eth_minus_30].results[0]
//   the price move + the held-flat debt leg
//                     the SAME result's own `applied_shocks` / `held_flat`
//   liq_threshold + liq_bonus
//                     `api/openapi.yaml`'s OWN /v1/params 200 example, for the
//                     same (engine, chain_id, asset) triple
//
// The threshold is not taken on trust: the result publishes its health factor
// as an EXACT rational, and that rational is Σ(collateral × liq_threshold) over
// (debt × 10000). Reproducing both sides' published num/den from the contract's
// committed 8100 is an algebraic proof that the params example and the stress
// excerpt describe ONE reserve — which is what licenses reading the bonus from
// the same row.

const AAVE_ENGINE = "aave_v3_etherfi";
const AAVE_CHAIN = engineChain.get(AAVE_ENGINE);
if (AAVE_CHAIN === undefined) {
  fail(`the run-book example's batch names no ${AAVE_ENGINE} watermark, so its chain is unknown`);
}

const aaveResults = ethDefinition.results.filter((result) => result.engine === AAVE_ENGINE);
if (aaveResults.length !== 1) {
  fail(
    `stress-aave.json's eth_minus_30 carries ${String(aaveResults.length)} ${AAVE_ENGINE} results; ` +
      `the aave engine is re-measured from exactly one`,
  );
}
const aaveResult = aaveResults[0];
if (aaveResult.applicable !== true) {
  fail("the committed eth_minus_30 aave result is not applicable, so it measures nothing");
}

// SAME BATCH. Two measurements of one book at two batches are two books.
for (const field of ["id", "computed_at", "position_count"]) {
  if (JSON.stringify(stressAave.batch[field]) !== JSON.stringify(runBookExample.batch[field])) {
    fail(
      `the stress excerpt's batch.${field} is ${JSON.stringify(stressAave.batch[field])} but the ` +
        `run-book example's is ${JSON.stringify(runBookExample.batch[field])} — different runs`,
    );
  }
}

const aaveExample = runBookExample.engines.find((engine) => engine.engine === AAVE_ENGINE);
if (aaveExample === undefined) {
  fail(`the run-book example carries no ${AAVE_ENGINE} engine`);
}

// SAME BOOK. One account, and the before side's money agrees to the digit.
if (aaveExample.before.accounts !== 1) {
  fail(
    `the example's aave side measures ${String(aaveExample.before.accounts)} accounts; the ` +
      `committed result describes ONE, so the re-measurement would not cover the book`,
  );
}
if (
  BigInt(aaveExample.before.total_collateral_usd) !== BigInt(aaveResult.before.collateral_usd) ||
  BigInt(aaveExample.before.total_debt_usd) !== BigInt(aaveResult.before.debt_usd) ||
  aaveExample.before.eligible_accounts !== (aaveResult.before.eligible === true ? 1 : 0)
) {
  fail(
    "the example's aave before side and the committed eth_minus_30 result describe different " +
      "books, so the result may not re-measure it",
  );
}

/** The committed Aave reserve parameters, from the contract's OWN /v1/params example. */
const paramsExample =
  contract.paths["/v1/params"].get.responses["200"].content["application/json"].example;
const aaveReserveParams = paramsExample.params.find(
  (row) =>
    row.engine === AAVE_ENGINE &&
    row.chain_id === AAVE_CHAIN &&
    typeof row.asset === "string" &&
    row.asset.toLowerCase() ===
      aaveResult.applied_shocks.find((shock) => shock.chain_id === AAVE_CHAIN)?.asset.toLowerCase(),
);
if (aaveReserveParams === undefined) {
  fail("the contract's /v1/params example carries no row for the shocked aave reserve");
}
const paramField = (name) => {
  const field = aaveReserveParams.fields.find((entry) => entry.name === name);
  if (field === undefined || field.value === null) {
    fail(`the committed aave reserve params carry no ${name}`);
  }
  if (field.unit !== "bps") {
    fail(`the committed aave ${name} is in ${String(field.unit)}, not bps`);
  }
  return BigInt(field.value);
};
const AAVE_LT_BPS = paramField("liq_threshold");
const AAVE_BONUS_BPS = paramField("liq_bonus");
const BPS = 10_000n;

// THE ALGEBRAIC WELD. `health_factor_num` is Σ(collateral × liq_threshold) and
// `health_factor_den` is debt × 10000, so the contract's committed threshold has
// to reproduce BOTH published rationals exactly. If it does not, the params
// example and the stress excerpt are describing different reserves and nothing
// below may borrow the bonus from the params row.
for (const side of ["before", "after"]) {
  const measured = aaveResult[side];
  const num = BigInt(measured.collateral_usd) * AAVE_LT_BPS;
  const den = BigInt(measured.debt_usd) * BPS;
  if (num !== BigInt(measured.health_factor_num) || den !== BigInt(measured.health_factor_den)) {
    fail(
      `the committed liq_threshold ${String(AAVE_LT_BPS)} does not reproduce the aave result's ` +
        `${side} rational: derived ${String(num)}/${String(den)} but the result publishes ` +
        `${measured.health_factor_num}/${measured.health_factor_den}`,
    );
  }
}

/** The waterfall's own two measures over ONE eligible account (waterfall.go:96-103). */
const atRiskFor = (collateral, debt) => {
  const seizable = (debt * AAVE_BONUS_BPS) / BPS;
  return seizable < collateral ? seizable : collateral;
};
const badDebtFor = (collateral, debt) => {
  const recoverable = (collateral * BPS) / AAVE_BONUS_BPS;
  return debt > recoverable ? debt - recoverable : 0n;
};

/** Shock one side's itemization by each asset's OWN matrix factor. */
const shockedCollateral = (entries, chainId) =>
  entries.map((entry) => {
    // An UNPRICED holding has no price witness at all, so there is nothing for a
    // scenario to move: `ApplyScenario` only ever walks `PriceInput`s.
    if (entry.value_usd === null) {
      return entry;
    }
    const row = propagation.get(responseKey(chainId, entry.asset));
    if (row === undefined) {
      return entry; // undeclared — HELD FLAT, which is production's own default
    }
    const [num, den] = composedFactor(row);
    return { ...entry, value_usd: ((BigInt(entry.value_usd) * num) / den).toString() };
  });

/**
 * A histogram rebuilt from scratch: the example's SHAPE and metadata, and a
 * census placed entirely by the exact rationals the caller derived. Nothing is
 * carried — a bucket count is where an account's own arithmetic puts it.
 */
const histogramForRationals = (histogram, rationals) => {
  const counts = new Map(histogram.buckets.map((bucket) => [bucket.label, 0]));
  for (const [num, den] of rationals) {
    const label = bucketLabelForRational(histogram, num, den);
    counts.set(label, counts.get(label) + 1);
  }
  return {
    ...histogram,
    infinite_count: 0,
    buckets: histogram.buckets.map((bucket) => ({
      ...bucket,
      count: counts.get(bucket.label),
    })),
  };
};

/**
 * CONTRACT 1.7.0 — the transition matrix, DERIVED from the same per-row model
 * the two histograms beside it are derived from.
 *
 * The matrix is a JOINT distribution and its two margins ARE those histograms,
 * so it cannot ride a transformed body verbatim: a fixture whose Debt Manager
 * gains an account would carry a matrix over a book two rows smaller than the
 * bars printed beside it. It is built here from the SAME [num, den] rationals
 * `histogramForRationals` places, paired per row, exactly as the server pairs
 * the two sides of one position row.
 *
 *   rows        one entry per MEASURED position row:
 *               { before: [num, den], after: [num, den], debtBefore, debtAfter }
 *   unmeasured  the rows this run measured on NEITHER side, split by cause —
 *               the same population `hf_histogram.refused_count` carries.
 *
 * `lanes`, `comparator`, `wad_scale` and `note` are the example's own, carried:
 * the lane vocabulary IS the histogram's bucket table (which this file already
 * freezes edge by edge) and the note is the server's own sentence, which varies
 * only with the engine's decimals and with a book nobody measured — neither of
 * which any body here changes.
 */
/**
 * The unmeasured population's CAUSE SPLIT for ONE engine, READ OFF THE COVERAGE
 * BLOCK rather than assumed.
 *
 * The two causes land on two different coverage surfaces and the contract's own
 * counts point at them by name, so the split has to be derived from the surface
 * that actually holds the rows: `coverage.excluded[]` is per row and carries an
 * `engine`, and everything else in that population is riskd's own refusal,
 * counted book-wide by `coverage.refused_in_batch`.
 */
const unmeasuredSplitFor = (coverage, engineName, refusedCount) => {
  const excludedByThisLayer = coverage.excluded.filter(
    (entry) => entry.engine === engineName,
  ).length;
  if (excludedByThisLayer > refusedCount) {
    fail(
      `${engineName} lists ${String(excludedByThisLayer)} rows in coverage.excluded but its ` +
        `histogram counts only ${String(refusedCount)} unmeasured — a cause split cannot exceed ` +
        `the population it splits`,
    );
  }
  return { refusedInBatch: refusedCount - excludedByThisLayer, excludedByThisLayer };
};

const transitionsFor = (template, histogram, rows, unmeasured) => {
  const laneCount = template.lanes.length;
  const unmeasuredLane = template.lanes.findIndex((lane) => lane.kind === "unmeasured");
  if (unmeasuredLane !== laneCount - 1) {
    fail("the transition lane vocabulary does not end in the `unmeasured` lane");
  }
  const laneOf = (num, den) => {
    const label = bucketLabelForRational(histogram, num, den);
    const index = template.lanes.findIndex(
      (lane) => lane.kind === "bucket" && lane.label === label,
    );
    if (index < 0) {
      fail(`the transition lane vocabulary has no bucket lane labelled ${JSON.stringify(label)}`);
    }
    return index;
  };

  const cells = new Map();
  const bump = (from, to, debtBefore, debtAfter) => {
    const key = `${String(from)}|${String(to)}`;
    const cell = cells.get(key) ?? { from, to, rows: 0, debtBefore: null, debtAfter: null };
    cell.rows += 1;
    if (debtBefore !== null) {
      cell.debtBefore = (cell.debtBefore ?? 0n) + debtBefore;
    }
    if (debtAfter !== null) {
      cell.debtAfter = (cell.debtAfter ?? 0n) + debtAfter;
    }
    cells.set(key, cell);
  };
  for (const row of rows) {
    bump(
      laneOf(row.before[0], row.before[1]),
      laneOf(row.after[0], row.after[1]),
      row.debtBefore,
      row.debtAfter,
    );
  }
  const unmeasuredRows = unmeasured.refusedInBatch + unmeasured.excludedByThisLayer;
  for (let i = 0; i < unmeasuredRows; i += 1) {
    // NULL debts on both sides: this run computed nothing for these rows, and a
    // "0" would claim a measurement nobody made.
    bump(unmeasuredLane, unmeasuredLane, null, null);
  }

  const fromRows = Array.from({ length: laneCount }, () => 0);
  const toRows = Array.from({ length: laneCount }, () => 0);
  let held = 0;
  let changed = 0;
  for (const cell of cells.values()) {
    fromRows[cell.from] += cell.rows;
    toRows[cell.to] += cell.rows;
    if (cell.from === unmeasuredLane) {
      continue;
    }
    if (cell.from === cell.to) {
      held += cell.rows;
    } else {
      changed += cell.rows;
    }
  }
  const measuredRows = rows.length;
  return {
    ...template,
    from_rows: fromRows,
    to_rows: toRows,
    outflows: Array.from({ length: laneCount }, (_, from) => ({
      from,
      cells: [...cells.values()]
        .filter((cell) => cell.from === from)
        .sort((a, b) => a.to - b.to)
        .map((cell) => ({
          to: cell.to,
          rows: cell.rows,
          debt_before_usd: cell.debtBefore === null ? null : cell.debtBefore.toString(),
          debt_after_usd: cell.debtAfter === null ? null : cell.debtAfter.toString(),
        })),
    })),
    total_rows: measuredRows + unmeasuredRows,
    measured_rows: measuredRows,
    unmeasured_rows: unmeasuredRows,
    unmeasured_refused_in_batch_rows: unmeasured.refusedInBatch,
    unmeasured_excluded_by_this_layer_rows: unmeasured.excludedByThisLayer,
    // NULL, never 0, over a book this run never measured.
    held_rows: measuredRows === 0 ? null : held,
    lane_changed_rows: measuredRows === 0 ? null : changed,
  };
};

/** A ONE-ACCOUNT histogram, rebuilt so the census sits where the rational lands. */
const histogramForOneRational = (histogram, num, den) => {
  if (measured(histogram) !== 1 || histogram.infinite_count !== 0) {
    fail("the example's aave histogram does not measure exactly one finite account");
  }
  return histogramForRationals(histogram, [[num, den]]);
};

/** One measured side of the aave engine, entirely derived from the committed result. */
const aaveSide = (sideName) => {
  const measured = aaveResult[sideName];
  const eligible = measured.eligible === true;
  const collateral = BigInt(measured.collateral_usd);
  const debt = BigInt(measured.debt_usd);
  const entries =
    sideName === "before"
      ? aaveExample.before.collateral_by_asset
      : shockedCollateral(aaveExample.after.collateral_by_asset, AAVE_CHAIN);
  const counted = entries
    .filter((entry) => entry.value_usd !== null)
    .reduce((sum, entry) => sum + BigInt(entry.value_usd), 0n);
  if (counted !== collateral) {
    fail(
      `the aave ${sideName} itemization sums to ${String(counted)} but the committed result ` +
        `measures ${String(collateral)} of collateral`,
    );
  }
  return {
    ...aaveExample[sideName],
    accounts: 1,
    eligible_accounts: eligible ? 1 : 0,
    total_collateral_usd: collateral.toString(),
    total_debt_usd: debt.toString(),
    eligible_debt_usd: (eligible ? debt : 0n).toString(),
    collateral_at_risk_usd: (eligible ? atRiskFor(collateral, debt) : 0n).toString(),
    bad_debt_usd: (eligible ? badDebtFor(collateral, debt) : 0n).toString(),
    collateral_by_asset: byAsset(entries),
    hf_histogram: histogramForOneRational(
      aaveExample[sideName].hf_histogram,
      BigInt(measured.health_factor_num),
      BigInt(measured.health_factor_den),
    ),
  };
};

/**
 * The engine `note` and `movers_note` the SERVING LAYER would write for this
 * scenario, reproduced from its own templates rather than carried over.
 *
 * The example's aave notes say "oracle marks held ... the shortfall axis is
 * where this scenario's information lives" — a sentence `p5_runbook.go:614`
 * writes ONLY when a market-realization axis exists. eth_minus_30 has none, this
 * file already sets `market_realization: null`, and a note pointing at an axis
 * the body says is absent is one more thing the response cannot mean.
 */
const engineNote = (usdDecimals) =>
  "delta-only: after minus before over the positions in the run, in this engine's own " +
  `${String(usdDecimals)}-decimal unit.`;

/** p5_runbook.go:842-856, the aave rule plus its truncation sentence. */
const aaveMoversNote = (total) =>
  "RANKED BY HEALTH-FACTOR DROP: before minus after, in the pool's own WAD, largest drop first. " +
  "Only accounts whose health factor STRICTLY DROPPED are movers. An account with no debt has an " +
  "unbounded health factor on either side, so it has no drop to rank and is not counted here — it " +
  `is not a quiet zero. \`movers\` carries all ${String(total)} of them.`;

const aaveBefore = aaveSide("before");
const aaveAfter = aaveSide("after");

// THE MOVER IS ASSERTED FROM THE WADS, not assumed. Aave ranks by STRICT drop,
// so a side that did not fall is not a mover and this fixture would be claiming
// one that the engine's own rule excludes.
const AAVE_HF_BEFORE = BigInt(aaveResult.before.health_factor_wad);
const AAVE_HF_AFTER = BigInt(aaveResult.after.health_factor_wad);
if (AAVE_HF_AFTER >= AAVE_HF_BEFORE) {
  fail(
    `the committed aave result's health factor did not strictly drop ` +
      `(${String(AAVE_HF_BEFORE)} -> ${String(AAVE_HF_AFTER)}), so it ranks no mover`,
  );
}

// This body's OWN coverage, hoisted above the engines so each engine's
// unmeasured CAUSE SPLIT is read off the coverage block a reader will actually
// see rather than off the example's.
const ETH_COVERAGE = {
  ...runBookExample.coverage,
  batch_positions: runBookExample.coverage.batch_positions + DM_INJECTED_ACCOUNTS,
  in_book: runBookExample.coverage.in_book + DM_INJECTED_ACCOUNTS,
};

const ethAaveEngine = {
  ...aaveExample,
  before: aaveBefore,
  after: aaveAfter,
  // CONTRACT 1.7.0. One measured row, paired across the shock from the SAME
  // committed rationals the two histograms above are placed by, plus the
  // unmeasured tail the example's own refusal census carries.
  hf_transitions: transitionsFor(
    aaveExample.hf_transitions,
    aaveBefore.hf_histogram,
    [
      {
        before: [
          BigInt(aaveResult.before.health_factor_num),
          BigInt(aaveResult.before.health_factor_den),
        ],
        after: [
          BigInt(aaveResult.after.health_factor_num),
          BigInt(aaveResult.after.health_factor_den),
        ],
        debtBefore: BigInt(aaveResult.before.debt_usd),
        debtAfter: BigInt(aaveResult.after.debt_usd),
      },
    ],
    unmeasuredSplitFor(ETH_COVERAGE, AAVE_ENGINE, aaveBefore.hf_histogram.refused_count),
  ),
  newly_eligible_accounts: aaveAfter.eligible_accounts - aaveBefore.eligible_accounts,
  eligible_debt_delta_usd: (
    BigInt(aaveAfter.eligible_debt_usd) - BigInt(aaveBefore.eligible_debt_usd)
  ).toString(),
  bad_debt_delta_usd: (
    BigInt(aaveAfter.bad_debt_usd) - BigInt(aaveBefore.bad_debt_usd)
  ).toString(),
  // Aave speaks WADS and nothing else: the rational columns and the Debt
  // Manager's eligibility flip are NULL here, never a stand-in zero
  // (p5_runbook.go:115-138, 777-792).
  movers: [
    {
      account: aaveResult.account,
      engine: AAVE_ENGINE,
      hf_before_wad: AAVE_HF_BEFORE.toString(),
      hf_after_wad: AAVE_HF_AFTER.toString(),
      hf_drop_wad: (AAVE_HF_BEFORE - AAVE_HF_AFTER).toString(),
      hf_before_num: null,
      hf_before_den: null,
      hf_after_num: null,
      hf_after_den: null,
      became_eligible: null,
      debt_usd: null,
    },
  ],
  movers_total: 1,
  movers_note: aaveMoversNote(1),
  market_realization: null,
  note: engineNote(8),
};

// --- THE DISCLOSURES: THIS BODY'S OWN PRICE INPUTS, NOT ANOTHER BOOK'S ------
//
// `applied_shocks` and `held_flat` are the DEDUPED UNION over the positions that
// reached the run, sorted by the server's own key (p5_runbook.go:460-484,
// 537-542). They are not free text and they are not transferable: every entry
// has to be a price THIS response's own aggregates moved (or held).
//
// The old file built `applied_shocks` by flattening `stress-aave.json`'s
// per-address results straight onto the body. That is a different book's
// disclosure, and it showed: the one entry it carried named an aave price whose
// aggregate never budged, while the Debt Manager's own moved price appeared
// nowhere and `held_flat` was empty on a response where a whole holding was
// being held flat.
//
// Each entry below is welded to the row that witnesses it:
//
//   aave weETH   APPLIED — verbatim from the committed result whose aggregates
//                this response now serves.
//   aave USDC    HELD FLAT — verbatim from the same result. The debt leg's
//                price: the matrix does not name USDC, so it does not move.
//   DM WETH      APPLIED — the invented account's holding, at the price the
//                itemization values it at on each side.
//   DM weETH     HELD FLAT — the example's own entry. `responseKey(10, 0xCd5f…)`
//                is not in the matrix, so production holds it, and the example's
//                bytes hold it. The disclosure finally says so.

/** The DM price source key, named verbatim by the contract (api/openapi.yaml:910). */
const DM_PRICE_SOURCE = "priceproviderv2";

/** The DM's own price for a holding: value × 10^decimals / amount, exact here. */
const dmPriceOf = (entry) =>
  (BigInt(entry.value_usd) * 10n ** BigInt(entry.decimals)) / BigInt(entry.amount);

const dmExample = runBookExample.engines.find((engine) => engine.engine === "debt_manager");

/**
 * The Debt Manager's HELD-FLAT itemized inputs on this body: every priced
 * holding — the example's own and this file's injected ones — that the
 * eth_minus_30 matrix leaves undeclared.
 *
 * It is load-bearing twice over: it is the entry guard law 11 proves
 * completeness against, and mutants B, E and H are built by moving, deleting and
 * corrupting it. If the body ever stops carrying a priced holding the matrix does
 * not describe, those three mutants would be testing nothing — so generation
 * stops and demands they be re-derived rather than quietly passing.
 */
const dmHeldEntries = [...dmExample.before.collateral_by_asset, ...injectedCollateralEntries(DM_FLIP_VALUE_BEFORE)].filter(
  (entry) => entry.value_usd !== null && !propagation.has(responseKey(DM_CHAIN, entry.asset)),
);
if (dmHeldEntries.length === 0) {
  fail(
    "this body's debt_manager side counts no priced holding the eth_minus_30 matrix " +
      "leaves undeclared, so it has no held-flat input and law 11 has nothing to prove",
  );
}

/**
 * Every DECLARED Debt Manager holding on this body, disclosed as the shock the
 * matrix composes for it. Derived per holding rather than written once, because
 * Wave W-EX-A's repair added a second one: the example's own weETH is 0x5A7f…
 * now, the address eth_minus_30 DECLARES on chain 10, so it moves and the body
 * has to say so — the accident that used to hold it flat is gone.
 */
const dmAppliedEntries = [
  ...dmExample.before.collateral_by_asset,
  ...injectedCollateralEntries(DM_FLIP_VALUE_BEFORE),
]
  .filter((entry) => entry.value_usd !== null && propagation.has(responseKey(DM_CHAIN, entry.asset)))
  .map((entry) => {
    const [num, den] = composedFactor(propagation.get(responseKey(DM_CHAIN, entry.asset)));
    const before = dmPriceOf(entry);
    return {
      asset: entry.asset,
      chain_id: DM_CHAIN,
      source: DM_PRICE_SOURCE,
      factor_num: num.toString(),
      factor_den: den.toString(),
      before: before.toString(),
      after: ((before * num) / den).toString(),
      snapped: false,
      base_snapped: false,
      cap_bound: false,
    };
  });

const APPLIED_SHOCKS = [...aaveResult.applied_shocks, ...dmAppliedEntries].sort((a, b) =>
  `${a.asset}|${String(a.chain_id)}|${a.source}`.localeCompare(
    `${b.asset}|${String(b.chain_id)}|${b.source}`,
  ),
);

const HELD_FLAT = [
  ...aaveResult.held_flat,
  ...dmHeldEntries.map((entry) => ({
    asset: entry.asset,
    chain_id: DM_CHAIN,
    source: DM_PRICE_SOURCE,
    value: dmPriceOf(entry).toString(),
  })),
].sort((a, b) =>
  `${a.asset}|${String(a.chain_id)}|${a.source}`.localeCompare(
    `${b.asset}|${String(b.chain_id)}|${b.source}`,
  ),
);

/**
 * THE BORROWED RESERVES, NAMED AND FROZEN (Codex round 30, HIGH).
 *
 * `ApplyScenario` walks a position's `PriceInput` list, and an Aave position
 * carries prices for its BORROWED reserves as well as its collateral. The
 * response itemizes only collateral, so the debt leg's held price has no
 * itemized witness and never could. That is production's shape, not a defect —
 * and guard law 11's first exemption is exactly that hole, no wider.
 *
 * IT USED TO BE DERIVED, AND THE DERIVATION WAS THE DEFECT. The rule was "the
 * committed result's price inputs that this body's COUNTED itemization does not
 * carry", and a probe walked straight through it: hold the aave book's UNPRICED
 * 0x…0BAD collateral flat and it qualifies — an unpriced row is not counted, and
 * the chain does carry debt, which was the only other test. A COLLATERAL row
 * wore the debt leg's exemption and the guard said nothing.
 *
 * So the key is FROZEN as a literal and the derivation is asserted EQUAL to it.
 * The derivation itself is tightened to "not itemized AT ALL", so the two
 * disagree the moment a collateral key tries to enter; and `checkPropagation`
 * refuses any declared key the response itemizes, at any disclosure, which
 * catches the same shape a third time at the point of use.
 *
 * THE DERIVATION, shown rather than trusted: `stress-aave.json`'s eth_minus_30
 * aave result is ONE position holding weETH (0xCd5f…, mainnet) against $6,000 of
 * debt. Its own disclosures name two price inputs — weETH APPLIED at 70/100, and
 * USDC HELD FLAT at $1.00 — and the itemization carries weETH (counted) and
 * 0x…0BAD (unpriced) and nothing else. USDC is therefore the borrowed reserve,
 * and it is the only key this exemption may ever hold for this body.
 *
 * The Debt Manager contributes nothing: its debt leg is USD-normalized, carries
 * no `PriceInput` at all, and is bound by law 12 instead.
 */
const AAVE_BORROWED_RESERVE_KEYS = new Set([
  // responseKey(1, "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48") — USDC on
  // mainnet, the reserve the committed result's one position BORROWS.
  "1|0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
]);

const UNITEMIZED_INPUTS = (() => {
  // EVERY itemized key, at EVERY disclosure — not just the counted ones.
  const itemizedHere = new Set(
    [aaveBefore, aaveAfter]
      .flatMap((side) => side.collateral_by_asset)
      .map((entry) => responseKey(AAVE_CHAIN, entry.asset)),
  );
  const derived = new Set(
    [...aaveResult.applied_shocks, ...aaveResult.held_flat]
      .map((entry) => responseKey(entry.chain_id, entry.asset))
      .filter((key) => !itemizedHere.has(key)),
  );
  // EQUALITY, both directions. A key the committed result grows into this hole
  // is not admitted by arriving; it is admitted by a person deciding it is a
  // borrowed reserve and writing it above.
  for (const key of derived) {
    if (!AAVE_BORROWED_RESERVE_KEYS.has(key)) {
      fail(
        `the committed aave result now carries an un-itemized price input for ${key}, which is ` +
          `NOT one of the frozen borrowed reserves — an exemption may not grow by derivation: ` +
          `name it above with its provenance, or explain why the body should itemize it`,
      );
    }
  }
  for (const key of AAVE_BORROWED_RESERVE_KEYS) {
    if (!derived.has(key)) {
      fail(
        `the frozen borrowed reserve ${key} is no longer an un-itemized price input of the ` +
          `committed aave result — the exemption now covers a hole that is not there`,
      );
    }
  }
  return new Set(AAVE_BORROWED_RESERVE_KEYS);
})();

const ethRunBook = {
  ...runBookExample,
  scenario_id: ethDefinition.id,
  scenario_version: ethDefinition.version,
  label: ethDefinition.label,
  description: ethDefinition.description,
  path_assumption: ethDefinition.path_assumption,
  shocks: ethDefinition.shocks,
  out_of_model: ethDefinition.out_of_model,
  applied_shocks: APPLIED_SHOCKS,
  held_flat: HELD_FLAT,
  // The invented accounts are REAL ROWS of the batch, so the batch counts them.
  batch: {
    ...runBookExample.batch,
    position_count: runBookExample.batch.position_count + DM_INJECTED_ACCOUNTS,
  },
  coverage: ETH_COVERAGE,
  engines: runBookExample.engines.map((engine) => {
    if (engine.engine === AAVE_ENGINE) {
      return ethAaveEngine;
    }
    if (engine.engine !== "debt_manager") {
      fail(`the run-book example carries an engine this generator does not derive: ${engine.engine}`);
    }
    // THE BASELINE ACCOUNT MOVES NOW (Wave W-EX-A). The repaired contract
    // example carries the Debt Manager's REAL weETH — 0x5A7f… on chain 10 —
    // which eth_minus_30's matrix DECLARES, so a body that re-identified the
    // example's rows and left them alone would hold a declared asset still.
    // Law 5 refuses that, and production could not serve it. So the baseline
    // account is re-valued through the matrix exactly as the aave side is, and
    // every aggregate it feeds is recomputed from that value.
    //
    // The BEFORE side must come out at the example's own published figures —
    // the matrix leaves a before side alone — and that is asserted below rather
    // than assumed, which is what makes the re-measurement a derivation of the
    // example rather than a replacement for it.
    const baselineDebt = BigInt(engine.before.total_debt_usd);
    const baselineEntries = {
      before: engine.before.collateral_by_asset,
      after: shockedCollateral(engine.before.collateral_by_asset, DM_CHAIN),
    };
    const dmSide = (sideName) => {
      const baselineRows = baselineEntries[sideName];
      const baselineValues = baselineRows
        .filter((entry) => entry.value_usd !== null)
        .map((entry) => BigInt(entry.value_usd));
      const baselineCollateral = baselineValues.reduce((sum, value) => sum + value, 0n);
      const baselineMaxBorrow = dmMaxBorrow(...baselineValues);
      const baselineEligible = baselineDebt > baselineMaxBorrow;

      const flipValue = sideName === "before" ? DM_FLIP_VALUE_BEFORE : DM_FLIP_VALUE_AFTER;
      const flipMaxBorrow =
        sideName === "before" ? DM_FLIP_MAXBORROW_BEFORE : DM_FLIP_MAXBORROW_AFTER;
      const flipEligible = DM_DELTA > flipMaxBorrow;
      // The held account is healthy on both sides, asserted at its declaration.
      const heldEligible = DM_HELD_DEBT > DM_HELD_MAXBORROW;

      const eligibleDebt =
        (baselineEligible ? baselineDebt : 0n) + (flipEligible ? DM_DELTA : 0n);
      const atRisk =
        (baselineEligible ? dmAtRisk(baselineCollateral, baselineDebt) : 0n) +
        (flipEligible ? dmAtRisk(flipValue, DM_DELTA) : 0n);
      const badDebt =
        (baselineEligible ? dmBadDebt(baselineCollateral, baselineDebt) : 0n) +
        (flipEligible ? dmBadDebt(flipValue, DM_DELTA) : 0n);

      return {
        baselineOnly: {
          total_collateral_usd: baselineCollateral.toString(),
          eligible_accounts: baselineEligible ? 1 : 0,
          eligible_debt_usd: (baselineEligible ? baselineDebt : 0n).toString(),
          collateral_at_risk_usd: (
            baselineEligible ? dmAtRisk(baselineCollateral, baselineDebt) : 0n
          ).toString(),
          bad_debt_usd: (
            baselineEligible ? dmBadDebt(baselineCollateral, baselineDebt) : 0n
          ).toString(),
        },
        side: {
          ...engine[sideName],
          accounts: engine[sideName].accounts + DM_INJECTED_ACCOUNTS,
          eligible_accounts:
            (baselineEligible ? 1 : 0) + (flipEligible ? 1 : 0) + (heldEligible ? 1 : 0),
          total_debt_usd: (baselineDebt + DM_DELTA + DM_HELD_DEBT).toString(),
          total_collateral_usd: (baselineCollateral + flipValue + DM_HELD_VALUE).toString(),
          eligible_debt_usd: eligibleDebt.toString(),
          collateral_at_risk_usd: atRisk.toString(),
          bad_debt_usd: badDebt.toString(),
          collateral_by_asset: byAsset([
            ...baselineRows,
            ...injectedCollateralEntries(flipValue),
          ]),
          // ALL THREE accounts are placed from their own EXACT rationals, so
          // nothing is carried: the flip IS the injected account crossing the
          // 1.00 edge — the same event `newly_eligible_accounts` counts — and
          // the other two are wherever their own collateral puts them.
          hf_histogram: histogramForRationals(engine[sideName].hf_histogram, [
            [baselineMaxBorrow, baselineDebt],
            [flipMaxBorrow, DM_DELTA],
            [DM_HELD_MAXBORROW, DM_HELD_DEBT],
          ]),
        },
        // THE SAME THREE ACCOUNTS, IN A FIXED ORDER, so the transition matrix
        // can pair the two sides ROW BY ROW — the pairing the server does, and
        // the only way a joint distribution is derived rather than guessed.
        // Their debts are USD-NORMALIZED on this engine and no scenario
        // re-prices them, so each row's two debt figures are equal here by
        // construction rather than by coincidence.
        rows: [
          { rational: [baselineMaxBorrow, baselineDebt], debt: baselineDebt },
          { rational: [flipMaxBorrow, DM_DELTA], debt: DM_DELTA },
          { rational: [DM_HELD_MAXBORROW, DM_HELD_DEBT], debt: DM_HELD_DEBT },
        ],
      };
    };
    const beforeSide = dmSide("before");
    const afterSide = dmSide("after");
    // THE BEFORE SIDE IS THE EXAMPLE'S OWN, RE-DERIVED. A matrix moves the after
    // side only, so re-measuring the baseline account on the before side has to
    // reproduce exactly what the contract example publishes for it — which is
    // what makes this a derivation OF the example rather than a replacement for
    // it. Any disagreement means the matrix, the threshold or the bonus this
    // file derives with is not the one the example was measured under.
    for (const [field, want] of Object.entries(beforeSide.baselineOnly)) {
      const published = engine.before[field];
      if (String(want) !== String(published)) {
        fail(
          `re-measuring the example's debt_manager account on the BEFORE side gives ` +
            `${field} = ${String(want)}, but the contract example publishes ${String(published)} ` +
            `— a matrix moves the after side only, so the two must agree to the digit`,
        );
      }
    }
    const before = beforeSide.side;
    const after = afterSide.side;
    return {
      ...engine,
      before,
      after,
      // CONTRACT 1.7.0, paired row by row over the SAME three rationals the two
      // histograms above are placed by. A matrix carried verbatim from the
      // example would describe a book two rows smaller than the bars beside it.
      hf_transitions: transitionsFor(
        engine.hf_transitions,
        before.hf_histogram,
        beforeSide.rows.map((row, index) => ({
          before: row.rational,
          after: afterSide.rows[index].rational,
          debtBefore: row.debt,
          debtAfter: afterSide.rows[index].debt,
        })),
        unmeasuredSplitFor(ETH_COVERAGE, engine.engine, before.hf_histogram.refused_count),
      ),
      market_realization: null,
      // Recomputed FROM before/after, never stated independently.
      newly_eligible_accounts: after.eligible_accounts - before.eligible_accounts,
      eligible_debt_delta_usd: (
        BigInt(after.eligible_debt_usd) - BigInt(before.eligible_debt_usd)
      ).toString(),
      bad_debt_delta_usd: (
        BigInt(after.bad_debt_usd) - BigInt(before.bad_debt_usd)
      ).toString(),
      // The one account that flipped, with the EXACT rational on each side —
      // the same two rationals the histogram placement above is derived from —
      // and the debt that became eligible equal to the delta that created it.
      movers: [
        {
          account: DM_FLIP_ACCOUNT,
          engine: engine.engine,
          hf_before_wad: null,
          hf_after_wad: null,
          hf_drop_wad: null,
          hf_before_num: DM_FLIP_MAXBORROW_BEFORE.toString(),
          hf_before_den: DM_DELTA.toString(),
          hf_after_num: DM_FLIP_MAXBORROW_AFTER.toString(),
          hf_after_den: DM_DELTA.toString(),
          became_eligible: true,
          debt_usd: DM_DELTA.toString(),
        },
      ],
      movers_total: 1,
      movers_note:
        "RANKED BY THE DEBT THAT BECAME ELIGIBLE: only accounts whose Debt Manager eligibility " +
        "FLIPPED false -> true under this scenario are movers, ranked by their debt in this " +
        "engine's 6-decimal USD, largest first. The Debt Manager has no health-factor wad, so " +
        "`hf_before_num/den` and `hf_after_num/den` are the EXACT rational maxBorrowLT/borrowings, " +
        "a disclosure only. `movers_total` counts flips to eligible ONLY, so it is not " +
        "`newly_eligible_accounts`, which is a NET count and also subtracts any flip back to " +
        "healthy. `movers` carries all 1 of them.",
      note: engineNote(6),
    };
  }),
};

/**
 * THIS BODY'S HOLDING ANCHOR (guard law 9), declared from its SOURCES.
 *
 * Two sources and no third: the contract example's own arrays, untouched, and
 * the ONE row this generator injects. Both engines' `before` and `after` are
 * measured against it, so no edit to the produced body can define what the
 * produced body is allowed to say.
 *
 *   aave          the example's own rows, verbatim. The re-measurement above
 *                 rewrites `value_usd` and touches nothing else, and the
 *                 example's two sides are identical by construction — which
 *                 this anchor now ASSERTS rather than assumes, since the after
 *                 side is measured against the before side's bytes.
 *   debt_manager  the example's own rows PLUS the injected account's TWO
 *                 holdings, at the amount, decimals, symbol and note they are
 *                 constructed with. Their `value_usd` differs per side, which is
 *                 the one thing an anchor does not pin.
 */
const ETH_HOLDINGS = holdingAnchor([
  [AAVE_ENGINE, aaveExample.before.collateral_by_asset],
  [
    "debt_manager",
    [...dmExample.before.collateral_by_asset, ...injectedCollateralEntries(DM_FLIP_VALUE_BEFORE)],
  ],
]);

// --- THE RECORDED HISTOGRAM CARRIES (Wave W-BS-G, Codex's next-steps item) --
//
// A CENSUS THIS FILE CARRIES IS A DEFECT SOMEBODY READ, NAMED HERE. Until this
// wave the collision pair simply handed the example's census to the derivation
// as both the shape AND the starting counts, for BOTH engines, with no placement
// at all — a blanket carry, which is a second pen copying the first one's page.
// `carriedCensus` narrows it: every carry now states the placement THIS
// derivation composes for the account the carried census describes, and refuses
// to keep carrying once the two agree.
//
// TWO ENTRIES ARE OWED, and the second one disproves the premise this narrowing
// was requested under. The request was to keep the carry for the recorded AAVE
// exception ONLY and let the Debt Manager side take the derived placement. The
// arithmetic says the Debt Manager cannot:
//
//   AAVE. The example draws its one account — 800000000000 of collateral
//   against 600000000000 of debt — in `1.10 – 1.25`, which needs a liquidation
//   threshold of 8250-9375 bps. The contract's OWN /v1/params example gives that
//   reserve 8100 bps, which places it at 1.08, in `1.05 – 1.10`, and
//   `stress-aave.json` measures the same money at `health_factor_wad`
//   1080000000000000000 and agrees to the digit. This is the defect already
//   recorded at the collision write site, unchanged.
//
//   DEBT MANAGER. The example draws its one account in `0.90 – 1.00`. Its own
//   frozen collateral is 4000000000, the Debt Manager's committed weETH
//   threshold is 80/100, so maxBorrowLT is 3200000000; its borrowings are
//   4620000000. The comparator is the exact rational maxBorrowLT/borrowings =
//   3200000000/4620000000 = 0.6926, which is `< 0.90`. There is NO threshold
//   that reconciles the two: reaching `0.90 – 1.00` on 4000000000 of collateral
//   would need a threshold above 103%. And the aggregate is unmodellable in the
//   other direction too — it publishes ONE account carrying 4620000000 of debt
//   of which 4200000000 is eligible, and one account's debt is eligible whole or
//   not at all. This is a SECOND histogram defect in the same example, and the
//   Debt Manager side of the collision pair therefore cannot take a derived
//   placement without this file asserting a bucket the contract contradicts —
//   the same reason the aave side does not.
//
// Both are recorded, both are re-proved still-owed every run, and repairing
// EITHER forces its carry to be deleted. The teeth are two, and they bite in
// order: move the example's bytes and `freezeExampleBaseline` stops generation
// naming the field that moved (mutant AD); re-freeze the census to the repaired
// value and `carriedCensus` stops generation demanding the carry's deletion
// (mutants AE and AF). A person has to look at both.

/** The two thresholds the ledger derives with, re-proved against their sources. */
const RECORDED_AAVE_LT_BPS = frozenLiteral(
  "the recorded ledger's aave liq_threshold (bps)",
  8_100n,
  AAVE_LT_BPS,
);
const RECORDED_DM_LT_NUM = frozenLiteral(
  "the recorded ledger's debt_manager threshold numerator",
  80n,
  DM_LT_NUM,
);
const RECORDED_DM_LT_DEN = frozenLiteral(
  "the recorded ledger's debt_manager threshold denominator",
  100n,
  DM_LT_DEN,
);

/**
 * Aave's own health-factor rational for a book of `collateral` against `debt`:
 * Σ(collateral × liq_threshold) / (debt × 10000), never divided out.
 */
const recordedAaveRational = (collateral, debt) => [
  collateral * RECORDED_AAVE_LT_BPS,
  debt * BPS,
];

/**
 * The Debt Manager's own comparator for the example's baseline account, on one
 * side: maxBorrowLT / borrowings, from the FROZEN baseline alone.
 */
const recordedDMBaselineRational = (side) => {
  const baseline = FROZEN_EXAMPLE_BASELINE.debt_manager[side];
  return [
    (BigInt(baseline.total_collateral_usd) * RECORDED_DM_LT_NUM) / RECORDED_DM_LT_DEN,
    BigInt(baseline.total_debt_usd),
  ];
};

// --- THIS BODY'S DERIVATION (Wave W-BS-F): THE SECOND PEN ------------------
//
// Everything below is composed WITHOUT READING `ethRunBook`. The inputs are the
// frozen sources — `FROZEN_STRESS_EXCERPT` and `FROZEN_RUNBOOK_EXAMPLE` off
// disk, the Go registry's committed propagation matrix, the contract's own
// /v1/params — plus a frozen literal for every quantity this generator INJECTS,
// each re-proved against the provenance named beside it. The result is what
// `risk.ApplyScenario` and `cmd/api/p5_runbook.go` would have served for this
// batch under this scenario, and the body has to equal it.
//
// THE SOURCE SIDE IS `before` AND THE SHOCK RUNS FORWARD. That is the sentence
// round 31's probe falsified — it slid a whole priced input onto the wrong side
// of the shock, kept every ratio and every valuation identity intact, and
// passed. A frozen absolute price is the only thing that can say which side is
// which, so every priced input has one here.

/** The scenario this derivation composes under — frozen, never read off a body. */
const FROZEN_ETH_SCENARIO_ID = "eth_minus_30";
const FROZEN_ETH_SCENARIO_VERSION = "v1";

/** basis points, in the derivation's own hand. */
const DERIVED_BPS = 10_000n;
/** the pool's own WAD, in the derivation's own hand. */
const DERIVED_WAD = 1_000_000_000_000_000_000n;

const ETH_DERIVATION = (() => {
  // THE MATRIX IS FETCHED BY THE FROZEN ID, never by an id read off a body — a
  // response that renames itself would otherwise be measured against whatever
  // physics its own bytes asked for. The version is re-proved against the same
  // committed registry entry, so the derivation and the scenario it models can
  // never drift apart silently.
  const committed = committedScenario(FROZEN_ETH_SCENARIO_ID);
  frozenLiteral("eth_minus_30 registry version", FROZEN_ETH_SCENARIO_VERSION, committed.version);
  const matrix = matrixFor(committed);

  // THIS GENERATOR INJECTS ONE ACCOUNT AND IT IS REBUILDABLE. It carries a
  // balance, a price and a debt, so it reaches the run and no side counts it as
  // a refusal — which is why every `refused_count` below is the example's own
  // census plus zero, and why raising one names positions nobody excluded.
  const INJECTED_REFUSALS = 0;

  const frozenStressScenario = FROZEN_STRESS_EXCERPT.scenarios.find(
    (scenario) => scenario.id === FROZEN_ETH_SCENARIO_ID,
  );
  const frozenAaveResult = frozenStressScenario?.results.find(
    (result) => result.engine === AAVE_ENGINE,
  );
  const frozenExampleAave = FROZEN_RUNBOOK_EXAMPLE.engines.find(
    (engine) => engine.engine === AAVE_ENGINE,
  );
  const frozenExampleDM = FROZEN_RUNBOOK_EXAMPLE.engines.find(
    (engine) => engine.engine === "debt_manager",
  );
  if (
    frozenAaveResult === undefined ||
    frozenExampleAave === undefined ||
    frozenExampleDM === undefined
  ) {
    fail("the derivation cannot find its own frozen sources on disk");
  }
  const exampleEntry = (engine, asset) =>
    engine.before.collateral_by_asset.find(
      (entry) => entry.asset.toLowerCase() === asset.toLowerCase(),
    ) ?? fail(`the frozen contract example carries no ${asset} row for ${engine.engine}`);

  // ===== THE AAVE BOOK: ONE ACCOUNT, RE-MEASURED FROM THE COMMITTED EXCERPT ==

  // PROVENANCE: `stress-aave.json` -> scenarios[eth_minus_30].results[0].account
  // — the one position the committed eth_minus_30 measurement describes.
  const FROZEN_AAVE_ACCOUNT = "0xAAaA000000000000000000000000000000000001";
  // PROVENANCE: the same result's `applied_shocks[0]` names the reserve, and
  // that reserve is the row the contract example's aave side itemizes.
  const FROZEN_AAVE_WEETH_ASSET = "0xCd5fE23C85820F7B72D0926FC9b05b43E359b7ee";
  const FROZEN_AAVE_WEETH_AMOUNT = 2_000_000_000_000_000_000n; // 2 weETH at 18 decimals
  const FROZEN_AAVE_WEETH_DECIMALS = 18;
  // THE SOURCE-SIDE ABSOLUTE PRICE. PROVENANCE, twice over: the committed
  // result discloses `applied_shocks[0].before = "400000000000"` — $4,000.00000000
  // in the engine's own 8-decimal USD — and the contract example's own
  // itemization reads the same price from the other end,
  // 800000000000 × 10^18 / 2000000000000000000.
  const FROZEN_AAVE_WEETH_PRICE = 400_000_000_000n;
  // PROVENANCE: the example's second aave row. NO price witness describes it, so
  // it is UNKNOWABLE on both sides and enters no sum.
  const FROZEN_AAVE_UNPRICED_ASSET = "0x0000000000000000000000000000000000000Bad";
  const FROZEN_AAVE_UNPRICED_AMOUNT = 5_000_000_000_000_000_000n;
  const FROZEN_AAVE_UNPRICED_DECIMALS = 18;
  // PROVENANCE: the committed result's own `before.debt_usd`. The debt leg is
  // USDC, the matrix does not name it, so `ApplyScenario` holds it flat and the
  // same figure stands on both sides — which the derivation asserts below
  // rather than assumes.
  const FROZEN_AAVE_DEBT = 600_000_000_000n;
  // PROVENANCE: `api/openapi.yaml`'s own /v1/params 200 example for this
  // (engine, chain, asset), already welded algebraically to the committed
  // result's published health-factor rationals at the read site above.
  const FROZEN_AAVE_LT_BPS = 8_100n;
  const FROZEN_AAVE_BONUS_BPS = 10_500n;
  // PROVENANCE: the contract example's own batch watermark for this engine.
  const FROZEN_AAVE_CHAIN = 1;

  const aaveCountedExample = exampleEntry(frozenExampleAave, FROZEN_AAVE_WEETH_ASSET);
  const aaveUnpricedExample = exampleEntry(frozenExampleAave, FROZEN_AAVE_UNPRICED_ASSET);
  frozenLiteral("aave account", FROZEN_AAVE_ACCOUNT, frozenAaveResult.account);
  frozenLiteral("aave chain id", FROZEN_AAVE_CHAIN, AAVE_CHAIN);
  frozenLiteral("aave weETH amount", FROZEN_AAVE_WEETH_AMOUNT, BigInt(aaveCountedExample.amount));
  frozenLiteral("aave weETH decimals", FROZEN_AAVE_WEETH_DECIMALS, aaveCountedExample.decimals);
  frozenLiteral(
    "aave weETH SOURCE-SIDE price",
    FROZEN_AAVE_WEETH_PRICE,
    BigInt(frozenAaveResult.applied_shocks[0].before),
  );
  frozenLiteral(
    "aave weETH SOURCE-SIDE price, read off the example's own itemization",
    FROZEN_AAVE_WEETH_PRICE,
    (BigInt(aaveCountedExample.value_usd) * 10n ** BigInt(FROZEN_AAVE_WEETH_DECIMALS)) /
      FROZEN_AAVE_WEETH_AMOUNT,
  );
  frozenLiteral(
    "aave unpriced amount",
    FROZEN_AAVE_UNPRICED_AMOUNT,
    BigInt(aaveUnpricedExample.amount),
  );
  frozenLiteral("aave unpriced decimals", FROZEN_AAVE_UNPRICED_DECIMALS, aaveUnpricedExample.decimals);
  frozenLiteral("aave debt", FROZEN_AAVE_DEBT, BigInt(frozenAaveResult.before.debt_usd));
  frozenLiteral("aave liq_threshold (bps)", FROZEN_AAVE_LT_BPS, AAVE_LT_BPS);
  frozenLiteral("aave liq_bonus (bps)", FROZEN_AAVE_BONUS_BPS, AAVE_BONUS_BPS);
  // THE DEBT LEG IS HELD FLAT, so the same borrowings stand on both sides. The
  // committed result says so itself, and the derivation reads it rather than
  // assuming a debt cannot move.
  frozenLiteral(
    "aave debt on the AFTER side",
    FROZEN_AAVE_DEBT,
    BigInt(frozenAaveResult.after.debt_usd),
  );

  const aaveItems = derivedItemization(matrix, FROZEN_AAVE_CHAIN, [
    {
      asset: FROZEN_AAVE_UNPRICED_ASSET,
      decimals: FROZEN_AAVE_UNPRICED_DECIMALS,
      amount: FROZEN_AAVE_UNPRICED_AMOUNT,
      price: null,
      disclosure: "unpriced",
    },
    {
      asset: FROZEN_AAVE_WEETH_ASSET,
      decimals: FROZEN_AAVE_WEETH_DECIMALS,
      amount: FROZEN_AAVE_WEETH_AMOUNT,
      price: FROZEN_AAVE_WEETH_PRICE,
      disclosure: "counted",
    },
  ]);

  /**
   * One side of the aave book, composed from the frozen inputs alone.
   *
   * ELIGIBILITY is Aave's own test read without dividing: the health factor is
   * Σ(collateral × liq_threshold) / (debt × 10000) and a position is eligible
   * when that is BELOW ONE, i.e. `collateral × lt < debt × 10000`.
   */
  const aaveSideDerived = (side) => {
    const collateral = aaveItems[side].counted;
    const eligible = collateral * FROZEN_AAVE_LT_BPS < FROZEN_AAVE_DEBT * DERIVED_BPS;
    // The health factor as the server publishes it: an EXACT rational
    // Σ(collateral × liq_threshold) / (debt × 10000), and the same wad the
    // mover row carries. Both come off the one frozen threshold, so a body
    // cannot hold the eligibility test to it and the disclosure to something
    // else. The histogram places THE RATIONAL, never the floored wad, so no
    // rounding can push the one account across a bucket edge.
    const hfNum = collateral * FROZEN_AAVE_LT_BPS;
    const hfDen = FROZEN_AAVE_DEBT * DERIVED_BPS;
    return {
      values: aaveItems[side].values,
      hfWad: (hfNum * DERIVED_WAD) / hfDen,
      // ONE account, re-measured from scratch — so the FROZEN bucket shape
      // supplies the structure and NOTHING carries over into the counts.
      histogram: derivedHistogram(
        FROZEN_HISTOGRAM_SHAPE,
        null,
        [[hfNum, hfDen]],
        frozenHistogramMeta(AAVE_ENGINE, INJECTED_REFUSALS),
      ),
      aggregate: {
        accounts: "1",
        eligible_accounts: eligible ? "1" : "0",
        total_collateral_usd: collateral.toString(),
        total_debt_usd: FROZEN_AAVE_DEBT.toString(),
        eligible_debt_usd: (eligible ? FROZEN_AAVE_DEBT : 0n).toString(),
        collateral_at_risk_usd: (eligible
          ? derivedAtRisk(collateral, FROZEN_AAVE_DEBT, FROZEN_AAVE_BONUS_BPS, DERIVED_BPS)
          : 0n
        ).toString(),
        bad_debt_usd: (eligible
          ? derivedBadDebt(collateral, FROZEN_AAVE_DEBT, FROZEN_AAVE_BONUS_BPS, DERIVED_BPS)
          : 0n
        ).toString(),
      },
    };
  };
  const aaveBeforeDerived = aaveSideDerived("before");
  const aaveAfterDerived = aaveSideDerived("after");
  // Aave ranks a STRICT health-factor drop and nothing else (p5_runbook.go
  // :783-799), so the mover set is derived from the two derived wads.
  const aaveMovers =
    aaveAfterDerived.hfWad < aaveBeforeDerived.hfWad ? [FROZEN_AAVE_ACCOUNT] : [];

  // ===== THE DEBT MANAGER: THE EXAMPLE'S OWN BOOK PLUS ONE INJECTED ACCOUNT ==
  //
  // The example's debt_manager aggregate is NOT re-modelled from an account
  // ledger, and deliberately so: it publishes one account carrying 4,620,000,000
  // of debt of which 4,200,000,000 is eligible, which no single-account model
  // reproduces. Those are the contract's own bytes and this generator has no
  // standing to re-measure them — so they are carried as a FROZEN BASELINE,
  // read off disk, and the injected account's contribution is derived beside it.

  // PROVENANCE: this generator's own injected account, declared at DM_FLIP_*
  // above and re-proved against those declarations below.
  const FROZEN_DM_FLIP_ACCOUNT = "0x00000000000000000000000000000000000d0002";
  const FROZEN_DM_FLIP_ASSET = "0x4200000000000000000000000000000000000006";
  const FROZEN_DM_FLIP_AMOUNT = 2_500_000_000_000_000_000n; // 2.5 WETH at 18 decimals
  const FROZEN_DM_FLIP_DECIMALS = 18;
  // THE SOURCE-SIDE ABSOLUTE PRICE of the injected holding: $1,000.000000 in the
  // Debt Manager's own 6-decimal USD.
  const FROZEN_DM_FLIP_PRICE = 1_000_000_000n;
  // The borrowings the injected account carries, on BOTH sides — the DM's debt
  // leg is USD-normalized and no scenario re-prices it.
  const FROZEN_DM_FLIP_DEBT = 1_500_000_000n;
  // PROVENANCE: the injected account's HELD-FLAT holding, USDC on Optimism.
  const FROZEN_DM_HELD_ASSET = "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85";
  const FROZEN_DM_HELD_AMOUNT = 100_000_000n; // 100 USDC at 6 decimals
  const FROZEN_DM_HELD_DECIMALS = 6;
  const FROZEN_DM_HELD_PRICE = 1_000_000n; // $1.000000, the DM's 6-dec USD
  const FROZEN_DM_HELD_DEBT = 50_000_000n; // $50.000000, healthy on both sides
  const FROZEN_DM_HELD_ACCOUNT = "0x00000000000000000000000000000000000d0004";
  /** Two accounts injected: the one that flips, and the held-flat one. */
  const FROZEN_INJECTED_ACCOUNTS = 2;
  // The Debt Manager's committed weETH configuration: threshold 80/100 and an
  // ADDITIVE 1e18 bonus over HUNDRED_PERCENT = 100e18, i.e. 101/100.
  const FROZEN_DM_LT_NUM = 80n;
  const FROZEN_DM_LT_DEN = 100n;
  const FROZEN_DM_BONUS_NUM = 101n;
  const FROZEN_DM_BONUS_DEN = 100n;
  // PROVENANCE: the example's own debt_manager row and batch watermark. The
  // address is the DEBT MANAGER's weETH on Optimism — Wave W-EX-A's repair; the
  // example used to carry the MAINNET weETH address on chain 10, an identity no
  // served body could have.
  const FROZEN_DM_WEETH_ASSET = "0x5A7fACB970D094B6C7FF1df0eA68D99E6e73CBFF";
  const FROZEN_DM_WEETH_AMOUNT = 1_000_000_000_000_000_000n;
  const FROZEN_DM_WEETH_DECIMALS = 18;
  const FROZEN_DM_WEETH_PRICE = 4_000_000_000n;
  const FROZEN_DM_CHAIN = 10;

  const dmWeethExample = exampleEntry(frozenExampleDM, FROZEN_DM_WEETH_ASSET);
  frozenLiteral("debt_manager chain id", FROZEN_DM_CHAIN, DM_CHAIN);
  frozenLiteral("debt_manager weETH amount", FROZEN_DM_WEETH_AMOUNT, BigInt(dmWeethExample.amount));
  frozenLiteral("debt_manager weETH decimals", FROZEN_DM_WEETH_DECIMALS, dmWeethExample.decimals);
  frozenLiteral(
    "debt_manager weETH SOURCE-SIDE price",
    FROZEN_DM_WEETH_PRICE,
    (BigInt(dmWeethExample.value_usd) * 10n ** BigInt(FROZEN_DM_WEETH_DECIMALS)) /
      FROZEN_DM_WEETH_AMOUNT,
  );
  frozenLiteral("injected account", FROZEN_DM_FLIP_ACCOUNT, DM_FLIP_ACCOUNT);
  frozenLiteral("injected asset", FROZEN_DM_FLIP_ASSET, DM_FLIP_ASSET);
  frozenLiteral("injected amount", FROZEN_DM_FLIP_AMOUNT, DM_FLIP_AMOUNT);
  frozenLiteral("injected decimals", FROZEN_DM_FLIP_DECIMALS, DM_FLIP_ASSET_DECIMALS);
  frozenLiteral("injected SOURCE-SIDE price", FROZEN_DM_FLIP_PRICE, DM_FLIP_PRICE_BEFORE);
  frozenLiteral("injected borrowings", FROZEN_DM_FLIP_DEBT, DM_DELTA);
  frozenLiteral("injected held asset", FROZEN_DM_HELD_ASSET, DM_HELD_ASSET);
  frozenLiteral("injected held amount", FROZEN_DM_HELD_AMOUNT, DM_HELD_AMOUNT);
  frozenLiteral("injected held decimals", FROZEN_DM_HELD_DECIMALS, DM_HELD_DECIMALS);
  frozenLiteral("injected held SOURCE-SIDE price", FROZEN_DM_HELD_PRICE, DM_HELD_PRICE);
  frozenLiteral("injected held borrowings", FROZEN_DM_HELD_DEBT, DM_HELD_DEBT);
  frozenLiteral("injected held account", FROZEN_DM_HELD_ACCOUNT, DM_HELD_ACCOUNT);
  frozenLiteral("injected account count", FROZEN_INJECTED_ACCOUNTS, DM_INJECTED_ACCOUNTS);

  const dmItems = derivedItemization(matrix, FROZEN_DM_CHAIN, [
    {
      asset: FROZEN_DM_HELD_ASSET,
      decimals: FROZEN_DM_HELD_DECIMALS,
      amount: FROZEN_DM_HELD_AMOUNT,
      price: FROZEN_DM_HELD_PRICE,
      disclosure: "counted",
    },
    {
      asset: FROZEN_DM_FLIP_ASSET,
      decimals: FROZEN_DM_FLIP_DECIMALS,
      amount: FROZEN_DM_FLIP_AMOUNT,
      price: FROZEN_DM_FLIP_PRICE,
      disclosure: "counted",
    },
    {
      asset: FROZEN_DM_WEETH_ASSET,
      decimals: FROZEN_DM_WEETH_DECIMALS,
      amount: FROZEN_DM_WEETH_AMOUNT,
      price: FROZEN_DM_WEETH_PRICE,
      disclosure: "counted",
    },
  ]);
  const dmFlipKey = `${FROZEN_DM_FLIP_ASSET}::counted`;
  const dmHeldKey = `${FROZEN_DM_HELD_ASSET}::counted`;
  const dmBaselineKey = `${FROZEN_DM_WEETH_ASSET}::counted`;

  /** floor(value × LT / HUNDRED_PERCENT) PER TOKEN, then summed — dm.go's shape. */
  const derivedMaxBorrow = (...values) =>
    values.reduce((sum, value) => sum + (value * FROZEN_DM_LT_NUM) / FROZEN_DM_LT_DEN, 0n);

  /**
   * One side of the Debt Manager book: the example's OWN account plus the
   * injected one, each measured through the matrix, and each judged by the
   * engine's own STRICT test — `borrowings > maxBorrowLT`, equality healthy
   * (dm.go:165-166).
   *
   * WAVE W-EX-A: the baseline account is no longer taken from the frozen
   * aggregate totals. Its weETH is 0x5A7f…, which eth_minus_30's matrix
   * DECLARES, so its collateral MOVES — and a derivation that read the example's
   * held-flat total would be measuring the wrong scenario. The frozen baseline
   * still supplies the account's BORROWINGS (a figure no scenario re-prices) and
   * still re-proves the BEFORE side, where the matrix changes nothing.
   */
  const dmSideDerived = (side) => {
    const baseline = FROZEN_EXAMPLE_BASELINE.debt_manager[side];
    const baselineDebt = BigInt(baseline.total_debt_usd);
    const baselineCollateral = dmItems[side].values.get(dmBaselineKey);
    if (side === "before") {
      // The before side is the example's own measurement, so the two must agree.
      frozenLiteral(
        "debt_manager BASELINE collateral on the before side",
        baselineCollateral,
        BigInt(baseline.total_collateral_usd),
      );
    }
    const baselineMaxBorrow = derivedMaxBorrow(baselineCollateral);
    const baselineEligible = baselineDebt > baselineMaxBorrow;

    const injected = dmItems[side].values.get(dmFlipKey);
    const maxBorrowLT = derivedMaxBorrow(injected);
    const eligible = FROZEN_DM_FLIP_DEBT > maxBorrowLT;
    // The held-flat account: its collateral never moves, so neither does its
    // ceiling, and it is healthy on both sides by construction.
    const heldCollateral = dmItems[side].values.get(dmHeldKey);
    const heldMaxBorrow = derivedMaxBorrow(heldCollateral);
    const heldEligible = FROZEN_DM_HELD_DEBT > heldMaxBorrow;
    return {
      values: dmItems[side].values,
      eligible,
      maxBorrowLT,
      baselineEligible,
      baselineMaxBorrow,
      baselineDebt,
      baselineCollateral,
      // BOTH ACCOUNTS PLACED FROM THEIR OWN EXACT RATIONALS, and nothing
      // carried. The carry that used to sit here was a recorded contract defect:
      // the example drew its Debt Manager account in `0.90 – 1.00` while its own
      // collateral, the committed 80/100 threshold and its own borrowings put it
      // at 3200000000/4620000000 = 0.6926, which is `< 0.90`. Wave W-EX-A
      // repaired the example by CAPTURING it from the running handler, the two
      // agree, and `carriedCensus` demanded the carry's deletion on the first
      // run afterwards — exactly the self-enforcement it was built for.
      histogram: derivedHistogram(
        FROZEN_HISTOGRAM_SHAPE,
        null,
        [
          [baselineMaxBorrow, baselineDebt],
          [maxBorrowLT, FROZEN_DM_FLIP_DEBT],
          [heldMaxBorrow, FROZEN_DM_HELD_DEBT],
        ],
        frozenHistogramMeta("debt_manager", INJECTED_REFUSALS),
      ),
      aggregate: {
        accounts: String(baseline.accounts + FROZEN_INJECTED_ACCOUNTS),
        eligible_accounts: String(
          (baselineEligible ? 1 : 0) + (eligible ? 1 : 0) + (heldEligible ? 1 : 0),
        ),
        total_collateral_usd: dmItems[side].counted.toString(),
        total_debt_usd: (baselineDebt + FROZEN_DM_FLIP_DEBT + FROZEN_DM_HELD_DEBT).toString(),
        eligible_debt_usd: (
          (baselineEligible ? baselineDebt : 0n) + (eligible ? FROZEN_DM_FLIP_DEBT : 0n)
        ).toString(),
        collateral_at_risk_usd: (
          (baselineEligible
            ? derivedAtRisk(
                baselineCollateral,
                baselineDebt,
                FROZEN_DM_BONUS_NUM,
                FROZEN_DM_BONUS_DEN,
              )
            : 0n) +
          (eligible
            ? derivedAtRisk(injected, FROZEN_DM_FLIP_DEBT, FROZEN_DM_BONUS_NUM, FROZEN_DM_BONUS_DEN)
            : 0n)
        ).toString(),
        bad_debt_usd: (
          (baselineEligible
            ? derivedBadDebt(
                baselineCollateral,
                baselineDebt,
                FROZEN_DM_BONUS_NUM,
                FROZEN_DM_BONUS_DEN,
              )
            : 0n) +
          (eligible
            ? derivedBadDebt(injected, FROZEN_DM_FLIP_DEBT, FROZEN_DM_BONUS_NUM, FROZEN_DM_BONUS_DEN)
            : 0n)
        ).toString()
      },
    };
  };
  const dmBeforeDerived = dmSideDerived("before");
  const dmAfterDerived = dmSideDerived("after");
  // The Debt Manager ranks the STRICT false -> true flip and nothing else
  // (p5_runbook.go:794-806), so the mover set is derived from the two derived
  // eligibilities rather than announced.
  const dmMovers =
    !dmBeforeDerived.eligible && dmAfterDerived.eligible ? [FROZEN_DM_FLIP_ACCOUNT] : [];

  // ===== THE RESPONSE =======================================================
  //
  // TWO injected accounts, so the run's census moves by exactly two rows.
  const INJECTED_ACCOUNTS = FROZEN_INJECTED_ACCOUNTS;
  const exampleCoverage = FROZEN_EXAMPLE_COVERAGE;

  return {
    scenario_id: FROZEN_ETH_SCENARIO_ID,
    scenario_version: FROZEN_ETH_SCENARIO_VERSION,
    coverage: {
      batch_positions: String(exampleCoverage.batch_positions + INJECTED_ACCOUNTS),
      in_book: String(exampleCoverage.in_book + INJECTED_ACCOUNTS),
      refused_in_batch: String(exampleCoverage.refused_in_batch),
      excluded_by_this_layer: String(exampleCoverage.excluded_by_this_layer),
    },
    // The injected account is rebuildable and its engine is covered, so this
    // body excludes and withholds exactly what the example did: nobody.
    excluded: [...FROZEN_EXAMPLE_EXCLUDED_ENGINES],
    withheld: [...FROZEN_EXAMPLE_WITHHELD_ENGINES],
    engines: [
      {
        engine: AAVE_ENGINE,
        usd_decimals: String(FROZEN_ENGINE_SERIALIZATION[AAVE_ENGINE].usd_decimals),
        // eth_minus_30 carries NO market-realization axis, so there is no money
        // for this block to hold and the derivation composes its absence. Law 16
        // proves the NULLity against the committed registry independently.
        market_realization: null,
        before: aaveBeforeDerived,
        after: aaveAfterDerived,
        movers: new Set(aaveMovers),
        movers_total: aaveMovers.length,
        // THE HEALTH-FACTOR TRIPLE, DERIVED, KEYED BY THE ACCOUNT IT DESCRIBES.
        // `hf_drop_wad` is what RANKED the row, and Aave ranks a strict drop
        // only — so the drop is composed as the difference of the two derived
        // wads rather than read back off the pair the row publishes.
        moverFields: new Map(
          aaveMovers.map((account) => [
            account,
            {
              hf_before_wad: aaveBeforeDerived.hfWad.toString(),
              hf_after_wad: aaveAfterDerived.hfWad.toString(),
              hf_drop_wad: (aaveBeforeDerived.hfWad - aaveAfterDerived.hfWad).toString(),
            },
          ]),
        ),
      },
      {
        engine: "debt_manager",
        usd_decimals: String(FROZEN_ENGINE_SERIALIZATION.debt_manager.usd_decimals),
        market_realization: null,
        before: dmBeforeDerived,
        after: dmAfterDerived,
        movers: new Set(dmMovers),
        movers_total: dmMovers.length,
        // THE DEBT MANAGER'S OWN SIX, DERIVED (Wave W-BS-G, finding 2).
        //
        // This engine supplied NO mover fields at all until now. The prior wave
        // disclosed the gap and asserted laws 7 and 12 covered it; Codex round
        // 32 falsified the rationals INSIDE both laws — scale both numerators by
        // 39/40 and the quotient still matches the disclosed 70/100, the
        // denominator is still the conserved borrowings, `debt_usd` still equals
        // it, `became_eligible` is still true, and BOTH buckets are unchanged —
        // and it passed, because the exact-field loop iterated an empty object.
        //
        // The six are now composed the way the engine composes them:
        // `hf_*_num` is maxBorrowLT on that side — the FROZEN source-side price
        // carried through the committed matrix, valued, then taken at the FROZEN
        // 80/100 threshold — and BOTH denominators are the FROZEN borrowings,
        // which no scenario re-prices and which `debt_usd` republishes.
        // `became_eligible` is the strict false -> true flip the derivation
        // reached on its own, never the body's claim.
        moverFields: new Map(
          dmMovers.map((account) => [
            account,
            {
              hf_before_num: dmBeforeDerived.maxBorrowLT.toString(),
              hf_before_den: FROZEN_DM_FLIP_DEBT.toString(),
              hf_after_num: dmAfterDerived.maxBorrowLT.toString(),
              hf_after_den: FROZEN_DM_FLIP_DEBT.toString(),
              became_eligible: String(!dmBeforeDerived.eligible && dmAfterDerived.eligible),
              debt_usd: FROZEN_DM_FLIP_DEBT.toString(),
            },
          ]),
        ),
      },
    ],
  };
})();

// --- THIS BODY'S RESPONSE ANCHOR (Wave W-BS-H) -----------------------------
//
// The completeness law requires every response-ANCHORED leaf to carry a frozen
// expectation. Most of this body's envelope is the contract example's, already
// frozen at `FROZEN_EXAMPLE_ENVELOPE` — the batch, the watermarks, the
// supersession, the coverage sentence, the response notes, the set token. What
// moves is what item 2 RE-IDENTIFIES and what this generator COMPOSES, and each
// of those is frozen below in its own right rather than read back off the body:
// an anchor taken from `engineNote(8)` would be the generating pen holding the
// checking pen's hand, which is Wave W-BS-G's finding 3 in miniature.
//
//   label / description / path_assumption / out_of_model[]
//       the eth_minus_30 definition, re-identified from the committed listing.
//       Cross-proved against `internal/risk/scenarios/eth_minus_30.json` below —
//       a SECOND committed file, not the one generation reads.
//   engines[].note / engines[].movers_note
//       composed by this generator from the serving layer's own templates.
//       Frozen as digests, so a template edit stops generation rather than
//       silently republishing new words under an old review.
//   engines[].market_realization
//       NULL on both engines: eth_minus_30 carries no market-realization axis.
//       Law 16 proves that against the committed registry independently.
//   applied_shocks[].source / .snapped / .base_snapped / .cap_bound
//   held_flat[].source
//       WHICH oracle moved or held, and whether a band or a cap bound. Not one
//       of them is a ratio, so not one is visible to laws 1-10: `cap_bound`
//       false is this body's claim that no Aave price cap BOUND on the way down.
const FROZEN_ETH_ENVELOPE = new Map([
  ["label", "ETH -30 percent"],
  ["description", text("c1951004bd976332", "Factor shock on ETH/USD. Every ETH-linked co")],
  ["path_assumption", text("b781952ef4e14337", "instantaneous mark at the shocked level; sin")],
  ["out_of_model[0]", text("9ca6adc0cc1b008e", "oracle lag and heartbeat behaviour during th")],
  ["out_of_model[1]", text("093d256536e771f7", "deviation-trigger discreteness (a feed moves")],
  ["out_of_model[2]", text("4b9449973c74d69c", "liquidator liquidity, gas costs, execution l")],
  ["out_of_model[3]", text("39e2edaa4bb9fb8f", "market correlations not mechanically implied")],
  ["out_of_model[4]", text("db68886bf0d25c81", "intra-sample price wicks: prices are 60-seco")],
  ["out_of_model[5]", text("5cbc2fdf2cf309eb", "Aave price caps are checked, not assumed: a ")],
  ["engines[0].note", text("2b975fdec80b1422", "delta-only: after minus before over the posi")],
  ["engines[0].movers_note", text("042fe202262632e4", "RANKED BY HEALTH-FACTOR DROP: before minus a")],
  ["engines[1].note", text("6b36d91662d0d07a", "delta-only: after minus before over the posi")],
  ["engines[1].movers_note", text("b6cf9a08427c2b70", "RANKED BY THE DEBT THAT BECAME ELIGIBLE: onl")],
  // `market_realization` itself is NOT pinned here: law 16 derives its NULLity
  // from the committed registry's own market-realization axis, so an anchor row
  // would be a second register claiming one leaf. The same now holds for
  // `projection`, which law 18 derives the same way. Of the realization block's
  // CHILDREN only the two disclosure sentences are still anchored, and this body
  // drops those — see FROZEN_ETH_ENVELOPE_DROPPED.
  // Sorted by `${asset}|${chain_id}|${source}`, the server's own disclosure
  // order. THREE applied shocks after Wave W-EX-A, not two: the repaired
  // contract example carries the Debt Manager's REAL weETH (0x5A7f… on chain
  // 10), which eth_minus_30's matrix declares — so the example's own holding
  // moves here and the body discloses it. The two held prices are the two USDCs,
  // one per chain, neither of which the matrix names.
  ["applied_shocks[0].source", "priceproviderv2"],
  ["applied_shocks[0].snapped", false],
  ["applied_shocks[0].base_snapped", false],
  ["applied_shocks[0].cap_bound", false],
  ["applied_shocks[1].source", "priceproviderv2"],
  ["applied_shocks[1].snapped", false],
  ["applied_shocks[1].base_snapped", false],
  ["applied_shocks[1].cap_bound", false],
  ["applied_shocks[2].source", "aaveoracle:0x43b64f28a678944e0655404b0b98e443851cc34f"],
  ["applied_shocks[2].snapped", false],
  ["applied_shocks[2].base_snapped", false],
  ["applied_shocks[2].cap_bound", false],
  ["held_flat[0].source", "priceproviderv2"],
  ["held_flat[1].source", "aaveoracle:0x43b64f28a678944e0655404b0b98e443851cc34f"],
]);

/**
 * The example's envelope leaves this body does NOT carry.
 *
 * `market_realization` goes from an OBJECT to NULL, so its leaves stop existing
 * and their pins would otherwise sit on fields that are gone — which the
 * completeness law refuses in its own right ("a body may not drop an envelope
 * field its own source carries"). Dropping them here is the statement that their
 * absence is INTENDED, and law 16 is what proves the intention is the committed
 * scenario's rather than this file's.
 *
 * The list is TWO PER ENGINE after Wave W-BS-I, not six: the block's four
 * computed leaves are DERIVED now and were never anchored to begin with, so
 * dropping them would be dropping nothing — which `responseAnchor` refuses.
 * Only the two disclosure sentences are still anchored, and only they are here.
 */
const FROZEN_ETH_ENVELOPE_DROPPED = [
  "engines[0].market_realization.seizure_model",
  "engines[0].market_realization.note",
  "engines[1].market_realization.seizure_model",
  "engines[1].market_realization.note",
  // The two caveats eth_minus_30 does NOT carry. `GET /v1/scenarios` publishes
  // each definition's own `out_of_model`, and the committed listing's
  // eth_minus_30 entry has six where the repaired run-book example's
  // weeth_market_depeg entry has eight. A pin on a caveat this body's own
  // definition never states would be a pin nobody reads.
  "out_of_model[6]",
  "out_of_model[7]",
  // The repaired example holds THREE prices flat (its scenario's propagation
  // matrix names nothing at all); this body holds TWO, because eth_minus_30
  // declares — and therefore moves — both weETHs. The third pin has no leaf
  // here, and a pin on an absent field forgives the field's absence.
  "held_flat[2].source",
];

/**
 * Build one body's response anchor: the frozen example's envelope, with the
 * leaves this body re-identifies DROPPED and REPLACED.
 *
 * Both directions are asserted. A drop that drops nothing, or an override that
 * overrides nothing the example carried and is not a leaf the example lacks,
 * would be a pin nobody reads — so the arithmetic of the overlay is checked
 * rather than assumed.
 */
const responseAnchor = (what, dropped, overrides) => {
  const anchor = new Map(FROZEN_EXAMPLE_ENVELOPE);
  for (const path of dropped) {
    if (!anchor.delete(path)) {
      fail(
        `${what} drops the anchored leaf ${path}, which the frozen example envelope does not ` +
          `carry — a drop that drops nothing is a line nobody reads`,
      );
    }
  }
  for (const [path, value] of overrides) {
    anchor.set(path, value);
  }
  return anchor;
};

// THE RE-IDENTIFIED HALF, CROSS-PROVED AGAINST A SECOND COMMITTED FILE. Item 2
// takes label / description / path_assumption / out_of_model from the wire
// definition in `stress-aave.json`; the digests above are re-proved here against
// the GO REGISTRY's own entry, which `risk.LoadScenarios` reads and which this
// generator never composes a body from. Two committed files, one expectation.
//
// `out_of_model` is a SUBSET there — the wire listing carries six of the
// registry's eight — so it is proved by MEMBERSHIP rather than by equality,
// which is the strongest true statement about it: a re-identified body may drop
// a committed caveat, but it may never invent one.
{
  for (const [path, field] of [
    ["label", "label"],
    ["description", "description"],
    ["path_assumption", "path_assumption"],
  ]) {
    freezeEnvelopeLeaf(
      `eth_minus_30 ${field}, against the committed Go registry`,
      FROZEN_ETH_ENVELOPE.get(path),
      ethCommitted[field],
    );
  }
  const registryCaveats = new Set(ethCommitted.out_of_model);
  for (const [path, frozen] of FROZEN_ETH_ENVELOPE) {
    if (!path.startsWith("out_of_model[")) {
      continue;
    }
    const carried = [...registryCaveats].find(
      (caveat) =>
        createHash("sha256").update(caveat, "utf8").digest("hex").slice(0, 16) === frozen.digest,
    );
    if (carried === undefined) {
      fail(
        `the frozen ${path} — the caveat beginning ${JSON.stringify(frozen.excerpt)} — is NOT one ` +
          `the committed eth_minus_30 registry entry carries: a re-identified body may drop a ` +
          `committed out-of-model caveat, but it may never invent one`,
      );
    }
  }
}

const ETH_DECLARED = {
  unitemizedInputs: UNITEMIZED_INPUTS,
  holdings: ETH_HOLDINGS,
  anchor: responseAnchor("run-book.eth_minus_30", FROZEN_ETH_ENVELOPE_DROPPED, FROZEN_ETH_ENVELOPE),
  derivation: ETH_DERIVATION,
};

// THE WHOLE BODY, checked — both engines, both sides, the response-level census
// and every engine's deltas. Checking only the side that was edited is how the
// impossible book got written in the first place.
checkResponse("run-book.eth_minus_30", ethRunBook, ETH_DECLARED);

// --- THE GUARD'S OWN SENSITIVITY: it has to fail on the bodies it exists for -
//
// A guard that cannot fail is not a guard, and a guard that refuses for the
// WRONG reason is a guard that has not read the body. Every mutant below is
// built from the body just written, so none can drift away from what the guard
// actually sees, and each must be refused FOR ITS OWN NAMED REASON — the
// expected sentence is asserted, never merely "something failed":
//
//   A  THE W-BS-B SHAPE. The invented account's holding put back on an address
//      the propagation matrix does not name, with the old grafted disclosure.
//      That is the W-BS-C finding, reproduced exactly.
//   B  AN UNDECLARED SHOCK. The example's own held-flat weETH moved by the
//      scenario's factor and disclosed as if the matrix covered it.
//
// C-F are the four W-BS-D mutations, each of which passed laws 1-7 intact:
//
//   C  A HOLDING DELETED FROM ONE SIDE. The aave UNPRICED row dropped from the
//      after side — deliberately the unpriced one, because it carries no money
//      and therefore NO other law in this file could ever see it go.
//   D  BALANCE CREATED FROM NOTHING. The after-side WETH amount and value
//      doubled together, so the implied price never moves and every ratio law
//      is satisfied while the book gains 1,750,000,000 of collateral.
//   E  A HELD DISCLOSURE DELETED. The chain-10 held_flat entry removed, leaving
//      a priced input the matrix does not describe with nothing said about it.
//   F  BORROWINGS FALSIFIED. The mover's rational scaled on both halves, so the
//      quotient still matches the disclosed factor while the denominator claims
//      borrowings that contradict the row's own `debt_usd`.
//
// G-I prove the laws this wave ADDED alongside those four. A law with no mutant
// is a law nobody has watched fail:
//
//   G  A FREE-FLOATING HELD NAME. A held price for an address no engine counts,
//      which is the completeness law read backwards.
//   H  A HELD PRICE THAT CONTRADICTS ITS OWN ITEMIZATION. The held value doubled
//      while the holding it prices is left alone.
//   I  A DISCLOSED PRICE PAIR SCALED. Both halves of the applied shock's
//      before/after doubled, so the RATIO every ratio-law tests is untouched
//      while neither price values the holding the body serves.
//
// J-R are Codex round 30, and they are ONE finding told five ways: the guard was
// validating DERIVED PROPERTIES of a body, and each round produced a body with
// the right properties and the wrong content. Rebuilt on ANCHORS, each has a
// refusal of its own:
//
//   J  THE MOVER'S DEBT EVIDENCE NULLED. Law 12 compared `debt_usd` to the
//      rational's denominator only when `debt_usd` was NON-NULL, so deleting it
//      was free. K is the same move made total.
//   L  THE SAME DELETION IN THE OTHER VOCABULARY — the aave mover's wads — and
//      M its mirror, a Debt Manager field on an engine that does not speak one.
//   N  A COLLATERAL KEY WEARING THE DEBT LEG'S EXEMPTION. The probe that walked
//      through the old derived `unitemizedInputs`.
//
// O-R are built from the COLLISION fixtures rather than this body, because the
// rows they falsify are the colliding pair, and they live beside those files at
// the end of this generator:
//
//   O  A TWO-SIDED AMOUNT SWAP between the two rows that share an asset.
//   P  A ONE-SIDED UNPRICED FLAG FLIP, and Q a ONE-SIDED NOTE EDIT — two fields
//      that no law read at all before the anchor.
//   R  THE EXAMPLE GROWN A PRICED HOLDING, which used to widen the recorded
//      contract-example exemption silently.
//
// S-V are Codex round 31, and they are ONE finding told four ways: ANCHORING A
// BODY'S IMMUTABLE BYTES DOES NOT ANCHOR THE NUMBERS IT MOVES, OR THE SET IT
// MOVES THEM OVER. Each of the four passed EVERY law A-R held. They are refused
// by the DERIVATION — the second pen, which composes what the evaluator would
// have served from the frozen sources alone — or by an exhaustiveness law
// hoisted out of the loop that hid it:
//
//   S  THE WRONG SIDE OF THE SHOCK. A priced input's whole disclosure slid up by
//      100/70, values and totals recomputed, so the AFTER price is the honest
//      BEFORE one. Every ratio, every valuation identity and every anchor is
//      intact; the input simply sits one shock too high. Only a FROZEN
//      SOURCE-SIDE ABSOLUTE PRICE can say so.
//   T  THE WHOLE AAVE ENGINE DELETED, coverage adjusted and disclosures trimmed.
//      The anchor's "a body may not drop a row its own source carries" ran
//      INSIDE `for (const engine of response.engines)` and so could not run at
//      all. It is now asserted over the whole response, after the loop.
//   U  THE MOVER IS SOMEBODY ELSE. A valid unrelated address on the Debt
//      Manager's mover row: right shape, right rationals, right factor, right
//      bucket, wrong account. The mover SETS are derived per engine now.
//   V  ONE ACCOUNT, TWO MOVERS. `movers_total: 2` on the one-account aave
//      engine, its single mover served twice — which `movers.length <=
//      movers_total` admits exactly.
//
// W-X close the two residuals the W-BS-F review named, and they are the same
// lesson reaching the two places a body restates a measurement:
//
//   W  THE HISTOGRAM'S FREE BUCKET. `checkSide` pins a census TOTAL and its
//      sub-1.00 REGION; the mover laws pin whichever buckets a mover names. On
//      a side with one account above the edge and NO mover — the collision
//      pair — that leaves the bucket itself free. The census is now drawn by
//      the derivation, account by account.
//   X  A MOVER'S WAD FALSIFIED. The health-factor triple restated so that the
//      recomputed drop, the strict-drop rule, the disclosed factor and both
//      bucket placements all still agree. The aave triple is now composed from
//      the same frozen threshold that decides eligibility.
//
// Y-AG are Codex round 32, and they are ONE lesson told three ways: A SECOND PEN
// IS ONLY A SECOND PEN WHERE IT ACTUALLY WRITES. Every one of them passed the
// twenty-four above untouched.
//
//   Y  THE ENGINE'S USD SCALE MOVED, 6 -> 18, so $6,500.00 renders as
//      $0.0000000065 with every total, delta, ratio and anchor intact.
//   Z  THE COMPARATOR BORROWED. The Debt Manager's buckets relabelled `hf_wad`,
//      telling a reader they are pool health factors it liquidates on.
//   AA REFUSALS INVENTED. `refused_count: 7` on a run whose coverage census
//      excludes nobody — a refusal disclosure with no refusal behind it.
//   AB THE NOTE FALSIFIED. The rendered sentence inverted into the exact rule it
//      exists to forbid ("read eligibility straight off the census").
//   AC THE DM MOVER'S RATIONAL FALSIFIED, banked as Codex demonstrated it: both
//      numerators scaled 39/40, so the disclosed factor, the conserved
//      denominator, `debt_usd`, `became_eligible` and BOTH bucket placements are
//      all still exactly right. It walked through an empty field loop.
//   AG THE EMPTY LOOP ITSELF, watched as its own failure: a derivation that
//      names a mover and composes no field for it is refused at the point of
//      use, so the arrangement that let AC through cannot return.
//   AD THE AUTHORITY FILE MOVED — on disk, +100000000 on both baseline debt
//      totals, restored and md5-verified. One file used to move both pens.
//   AE THE RECORDED AAVE HISTOGRAM DEFECT REPAIRED, and AF THE DEBT MANAGER'S:
//      each carried census is deleted the moment this derivation's own placement
//      agrees with it, so neither exemption can outlive the defect it records.
//
// AH-AJ came out of auditing THIS wave's own work rather than a Codex round, and
// they are the same shape as the finding that produced them: deriving one
// reading of the refusal census left the other three free.
//
//   AH AN EXCLUDED POSITION NOBODY COUNTED — a roster row under a zero total,
//      with every histogram still reading zero refusals.
//   AI FULL COVERAGE DENIED with nothing behind it: the contract's own
//      conjunction stated independently instead of concluded.
//   AJ AN ENGINE WITHHELD AND SERVED AT ONCE, on a body this guard vouches for.

/** Every mutant this run exercised, for the uniqueness cross-check at the end. */
const MUTANTS = [];

/** Run `attempt` with the guard's own exit trapped; return its refusal, or null. */
const refusalFrom = (attempt) => {
  const realFail = console.error;
  let refused = null;
  console.error = (message) => {
    refused ??= message;
  };
  const realExit = process.exit;
  process.exit = () => {
    throw new Error("__guard_refused__");
  };
  try {
    attempt();
  } catch (error) {
    if (error.message !== "__guard_refused__") {
      throw error;
    }
  } finally {
    console.error = realFail;
    process.exit = realExit;
  }
  return refused;
};

const recordRefusal = (what, expected, refused) => {
  if (refused === null) {
    fail(`THE GUARD IS BLIND: it accepted ${what}`);
  }
  // THE REASON IS THE POINT. A mutant refused by an unrelated law proves the
  // law it was built for nothing at all.
  if (!refused.includes(expected)) {
    fail(
      `THE GUARD REFUSED ${what} FOR THE WRONG REASON: expected a refusal naming\n        ` +
        `"${expected}"\n        but it said\n        ` +
        `"${refused.replace(/^generate-lab-book\.mjs: /, "")}"`,
    );
  }
  MUTANTS.push({ what, expected, refused });
  console.log(`refused ${what}\n        ${refused.replace(/^generate-lab-book\.mjs: /, "")}`);
};

/**
 * A BODY MUTANT: a clone of a written body, edited, and pushed back through the
 * whole guard under the declaration its honest original was checked with.
 *
 * `mutate` MAY RETURN declaration overrides. A mutant that reproduces a body an
 * earlier revision of this generator actually produced must be judged against
 * the ANCHOR that revision declared — otherwise it is refused for having the
 * wrong provenance rather than for the law it was built to break, and it proves
 * that law nothing. Mutant A is the one such case.
 */
const refuses = (what, expected, mutate, subject = { response: ethRunBook, declared: ETH_DECLARED }) => {
  const mutant = JSON.parse(JSON.stringify(subject.response));
  const overrides = mutate(mutant) ?? {};
  const declared = { ...subject.declared, ...overrides };
  recordRefusal(what, expected, refusalFrom(() => checkResponse("mutant", mutant, declared)));
};

/**
 * A GENERATION MUTANT: a DERIVATION refused before any body exists. The frozen
 * exemptions are asserted at generation time, so the only way to watch them
 * fail is to run the derivation over a mutated source.
 */
const refusesGeneration = (what, expected, attempt) => {
  recordRefusal(what, expected, refusalFrom(attempt));
};

/** The address the W-BS-B body carried: one no propagation row describes. */
const INVENTED_ASSET = "0x00000000000000000000000000000000000d0003";

refuses(
  "A: the W-BS-B shape — an undeclared asset shocked, the aave graft restored",
  `with NO applied_shocks entry for ${responseKey(DM_CHAIN, INVENTED_ASSET)}`,
  (mutant) => {
    for (const engine of mutant.engines) {
      for (const side of ["before", "after"]) {
        for (const entry of engine[side].collateral_by_asset) {
          if (entry.asset === DM_FLIP_ASSET) {
            entry.asset = INVENTED_ASSET;
            delete entry.symbol;
          }
        }
      }
    }
    mutant.applied_shocks = aaveResult.applied_shocks;
    // The W-BS-B shape dropped every held disclosure. This mutant keeps the ONE
    // that is not its point — the injected held-flat holding Wave W-EX-A added —
    // so the refusal it earns is law 1's, for an asset it moved and did not
    // disclose, rather than law 11's for a disclosure it also happened to
    // delete. A mutant refused for the wrong reason proves nothing.
    mutant.held_flat = mutant.held_flat.filter(
      (entry) => responseKey(entry.chain_id, entry.asset) === responseKey(DM_CHAIN, DM_HELD_ASSET),
    );
    // The W-BS-B revision declared THIS anchor — its own invented row is what it
    // injected — so the mutant is judged against it and refused for law 1, the
    // law it exists to reproduce, rather than for having the wrong provenance.
    const inventedRow = { ...flipCollateralEntry(DM_FLIP_VALUE_BEFORE), asset: INVENTED_ASSET };
    delete inventedRow.symbol;
    return {
      holdings: holdingAnchor([
        [AAVE_ENGINE, aaveExample.before.collateral_by_asset],
        [
          "debt_manager",
          [...dmExample.before.collateral_by_asset, inventedRow, heldCollateralEntry()],
        ],
      ]),
    };
  },
);

refuses(
  "B: an undeclared shock — the example's held-flat weETH moved and disclosed",
  "which the committed eth_minus_30 propagation matrix does not name",
  (mutant) => {
    const held = mutant.held_flat.find((entry) => entry.chain_id === DM_CHAIN);
    for (const engine of mutant.engines) {
      if (engine.engine !== "debt_manager") {
        continue;
      }
      for (const entry of engine.after.collateral_by_asset) {
        if (entry.asset.toLowerCase() === held.asset.toLowerCase()) {
          entry.value_usd = ((BigInt(entry.value_usd) * FACTOR_NUM) / FACTOR_DEN).toString();
        }
      }
    }
    mutant.held_flat = mutant.held_flat.filter((entry) => entry !== held);
    mutant.applied_shocks = [
      ...mutant.applied_shocks,
      {
        asset: held.asset,
        chain_id: held.chain_id,
        source: held.source,
        factor_num: FACTOR_NUM.toString(),
        factor_den: FACTOR_DEN.toString(),
        before: held.value,
        after: ((BigInt(held.value) * FACTOR_NUM) / FACTOR_DEN).toString(),
        snapped: false,
        base_snapped: false,
        cap_bound: false,
      },
    ];
  },
);

// C. A HOLDING DELETED FROM ONE SIDE (law 8). The aave engine's UNPRICED row is
// dropped from the after side and NOTHING else is touched: an unpriced holding
// sits outside `total_collateral_usd` and outside the histogram census, so every
// other law in this file — every sum, every delta, every ratio — still balances
// to the digit. The old guard skipped an entry it could not pair, which is
// exactly what made the deletion free.
refuses(
  "C: a holding deleted from one side — the aave unpriced row dropped from `after`",
  "on the BEFORE side ONLY",
  (mutant) => {
    const aave = mutant.engines.find((engine) => engine.engine === AAVE_ENGINE);
    const dropped = aave.after.collateral_by_asset.find((entry) => entry.value_usd === null);
    if (dropped === undefined) {
      fail("the aave after side carries no unpriced row for mutant C to delete");
    }
    aave.after.collateral_by_asset = aave.after.collateral_by_asset.filter(
      (entry) => entry !== dropped,
    );
  },
);

// D. BALANCE CREATED FROM NOTHING (law 9). The after-side WETH amount AND value
// are doubled together, so the implied price is UNCHANGED at 700000000 and law
// 4's cross-multiplication is satisfied exactly — while the engine's collateral
// and its itemization gain 1,750,000,000 that no shock could have produced. The
// total is moved with it so the body stays internally consistent, which is what
// made this mutation invisible: nothing is out of balance, the balance is wrong.
refuses(
  "D: balance created from nothing — the after-side WETH amount and value doubled together",
  `serves amount "${String(DM_FLIP_AMOUNT * 2n)}" for debt_manager|${DM_FLIP_ASSET}::counted`,
  (mutant) => {
    const dm = mutant.engines.find((engine) => engine.engine === "debt_manager");
    const entry = dm.after.collateral_by_asset.find((row) => row.asset === DM_FLIP_ASSET);
    const gained = BigInt(entry.value_usd);
    entry.amount = (BigInt(entry.amount) * 2n).toString();
    entry.value_usd = (gained * 2n).toString();
    dm.after.total_collateral_usd = (BigInt(dm.after.total_collateral_usd) + gained).toString();
  },
);

// E. A HELD DISCLOSURE DELETED (law 11). The chain-10 held_flat entry removed
// and nothing else: the Debt Manager still counts a priced weETH the committed
// matrix does not describe, so production would have recorded it on `HeldFlat`
// and said so. Completeness was never proven, so the deletion cost nothing.
refuses(
  "E: a held disclosure deleted — the chain-10 held_flat entry removed",
  `discloses no held_flat entry for ${responseKey(DM_CHAIN, dmHeldEntries[0].asset)}`,
  (mutant) => {
    mutant.held_flat = mutant.held_flat.filter((entry) => entry.chain_id !== DM_CHAIN);
  },
);

// F. BORROWINGS FALSIFIED (law 12). The mover's after-side rational is scaled on
// BOTH halves, so its quotient is still the disclosed 70/100 and law 7 sees a
// mover that agrees with the body — while the denominator now claims borrowings
// twice the ones the same row publishes as `debt_usd`, and the histogram places
// it in the same bucket because the bucket test is on the ratio too.
refuses(
  "F: borrowings falsified — the mover's rational scaled on both halves",
  `moves its BORROWINGS ${String(DM_DELTA)} -> ${String(DM_DELTA * 2n)}`,
  (mutant) => {
    const dm = mutant.engines.find((engine) => engine.engine === "debt_manager");
    const mover = dm.movers.find((row) => row.hf_after_num !== null);
    mover.hf_after_num = (BigInt(mover.hf_after_num) * 2n).toString();
    mover.hf_after_den = (BigInt(mover.hf_after_den) * 2n).toString();
  },
);

// G. A FREE-FLOATING HELD NAME (law 11, the converse). A held price for an
// address no engine in this response counts. `held_flat` is a claim about THIS
// book's price inputs, so a name the book cannot witness is a disclosure about
// somebody else's — the same defect as the grafted `applied_shocks` in mutant A,
// on the other array.
refuses(
  "G: a free-floating held name — a price held for an asset no engine counts",
  `holds ${responseKey(DM_CHAIN, INVENTED_ASSET)} flat, but NO engine in this response counts`,
  (mutant) => {
    mutant.held_flat = [
      ...mutant.held_flat,
      {
        asset: INVENTED_ASSET,
        chain_id: DM_CHAIN,
        source: DM_PRICE_SOURCE,
        value: DM_FLIP_PRICE_BEFORE.toString(),
      },
    ];
  },
);

// H. A HELD PRICE THAT CONTRADICTS ITS OWN ITEMIZATION (law 10, held half). The
// held value is doubled and the holding it prices is left alone, so the body now
// publishes a price under which its own itemization would count twice what it
// counts. Every law that only asks "did it move" is satisfied: it did not move,
// on either side, by the wrong price both times.
refuses(
  "H: a held price that contradicts its own itemization — the held value doubled",
  `flat at ${String(BigInt(HELD_FLAT.find((entry) => entry.chain_id === DM_CHAIN).value) * 2n)}`,
  (mutant) => {
    const held = mutant.held_flat.find((entry) => entry.chain_id === DM_CHAIN);
    held.value = (BigInt(held.value) * 2n).toString();
  },
);

// I. A DISCLOSED PRICE PAIR SCALED (law 10, applied half). Both halves of the
// applied shock's before/after are doubled. The FACTOR they imply is unchanged,
// so law 4's first half passes; the itemization is untouched, so law 4's second
// half passes; and the disclosure now names two prices under which the holding
// this body serves is worth double what the body says it is worth.
refuses(
  "I: a disclosed price pair scaled — the ratio kept, the valuation broken",
  `discloses a before price of ${String(DM_FLIP_PRICE_BEFORE * 2n)} for ${DM_FLIP_ASSET}`,
  (mutant) => {
    const shock = mutant.applied_shocks.find((entry) => entry.asset === DM_FLIP_ASSET);
    shock.before = (BigInt(shock.before) * 2n).toString();
    shock.after = (BigInt(shock.after) * 2n).toString();
  },
);

// --- THE ROUND-30 FOUR, on this body (law 12's shape and law 11's exemption) -
//
// J-M are one finding read four ways: law 12 checked `debt_usd` only when it was
// NON-NULL, so the evidence could simply be deleted. The shape is now the
// anchor, and each engine's vocabulary is asserted in BOTH directions — the
// fields it speaks are present, the fields it does not are null — so each of
// these four names a different byte of the same law.

refuses(
  "J: the mover's debt evidence nulled — the DM mover's `debt_usd` deleted",
  "publishes debt_usd null, but debt_manager SPEAKS that field",
  (mutant) => {
    const dm = mutant.engines.find((engine) => engine.engine === "debt_manager");
    dm.movers.find((row) => row.became_eligible === true).debt_usd = null;
  },
);

// K. THE WHOLE DISCLOSURE DELETED. Nulling `debt_usd` alone leaves a rational
// behind; nulling EVERY Debt Manager field leaves a mover row that says an
// account moved and publishes not one number about it. Under a guard that reads
// a field only when it is there, that is the safest mutation in the file.
refuses(
  "K: every DM-specific field nulled — a mover that discloses nothing at all",
  "publishes hf_before_num null, but debt_manager SPEAKS that field",
  (mutant) => {
    const dm = mutant.engines.find((engine) => engine.engine === "debt_manager");
    const mover = dm.movers.find((row) => row.became_eligible === true);
    for (const field of MOVER_VOCABULARY.debt_manager) {
      mover[field] = null;
    }
  },
);

// L. THE MIRROR, on the engine that speaks wads. Aave's evidence is its three
// health-factor wads and nothing else, so nulling them is the same deletion in
// the other vocabulary.
refuses(
  "L: the aave mover's wads nulled — the drop that ranked the row deleted",
  "publishes hf_before_wad null, but aave_v3_etherfi SPEAKS that field",
  (mutant) => {
    const aave = mutant.engines.find((engine) => engine.engine === AAVE_ENGINE);
    for (const field of MOVER_VOCABULARY.aave_v3_etherfi) {
      aave.movers[0][field] = null;
    }
  },
);

// M. THE OTHER DIRECTION. A field the engine does not speak is not a bonus
// disclosure — it is a number this engine never measured, in a vocabulary it
// does not have. Aave has no eligibility flip and no `debt_usd` (p5_runbook.go
// :783-799 sets neither), so a value there describes somebody else's book.
refuses(
  "M: an aave mover in the Debt Manager's vocabulary — `debt_usd` on a wad engine",
  `publishes debt_usd "${String(DM_DELTA)}", but aave_v3_etherfi does not SPEAK that field`,
  (mutant) => {
    const aave = mutant.engines.find((engine) => engine.engine === AAVE_ENGINE);
    aave.movers[0].debt_usd = DM_DELTA.toString();
  },
);

/** The aave book's UNPRICED collateral — the row the round-30 probe exempted. */
const AAVE_UNPRICED = aaveExample.before.collateral_by_asset.find(
  (entry) => entry.value_usd === null,
);
if (AAVE_UNPRICED === undefined) {
  fail("the example's aave side carries no unpriced row, so mutant N has nothing to mis-exempt");
}

// N. A COLLATERAL KEY WEARING THE DEBT LEG'S EXEMPTION (law 11, first
// exemption). This is the round-30 probe itself: hold the aave book's UNPRICED
// 0x…0BAD collateral flat and declare it an un-itemized price input. Under the
// old derived exemption it qualified — an unpriced row is not COUNTED, and the
// only other test was whether the chain carried any debt at all, which it does.
refuses(
  "N: a collateral key exempted as a debt leg — the aave unpriced row held flat and declared",
  `declares ${responseKey(AAVE_CHAIN, AAVE_UNPRICED.asset)} an UN-ITEMIZED debt-leg price input`,
  (mutant) => {
    mutant.held_flat = [
      ...mutant.held_flat,
      {
        asset: AAVE_UNPRICED.asset,
        chain_id: AAVE_CHAIN,
        source: aaveResult.held_flat[0].source,
        value: "1",
      },
    ];
    return {
      unitemizedInputs: new Set([
        ...UNITEMIZED_INPUTS,
        responseKey(AAVE_CHAIN, AAVE_UNPRICED.asset),
      ]),
    };
  },
);

// --- THE ROUND-31 FOUR: what only a second pen can refuse ------------------
//
// S-V are Codex round 31, and each of the four passed EVERY property law above.
// They are the evidence for the ruling this wave implements: a guard that reads
// the body can be satisfied by a body that reads correctly and says the wrong
// thing. Each is refused here by the DERIVATION or by an exhaustiveness law
// hoisted out of the loop that hid it — never by a ratio, a shape or a sum.

// S. THE WRONG SIDE OF THE SHOCK (round 31, finding 1). The injected WETH's
// disclosed price pair is slid UP by 100/70 — 1000000000 -> 1428571440 on the
// before side, 1000000008 on the after — so the AFTER price is (to eight
// significant figures) the honest BEFORE one and the whole input sits one shock
// too high. Both itemized values and the two totals are recomputed to match, so:
// law 4 sees the disclosed 70/100 (1428571440 × 70 = 1000000008 × 100); law 4's
// second half sees the itemization move by exactly it; law 10 sees each price
// value its own side's amount to the digit; law 9 sees untouched amounts; every
// sum balances and every delta still subtracts. The mover row is left alone, so
// laws 7 and 12 and the histogram all agree with each other about an account
// whose collateral the body now states at half again what it holds.
//
// NOTHING IN A PROPERTY LAW CAN SEE THIS. `value_usd / amount` is a ratio and
// this mutation preserves the ratio's relationship to the disclosure; the only
// question it fails is "what WAS the price", which only a frozen absolute
// source-side price can answer.
const WRONG_SIDE_PRICE_BEFORE = 1_428_571_440n;
const WRONG_SIDE_PRICE_AFTER = 1_000_000_008n;

refuses(
  "S: the wrong side of the shock — the injected price pair slid up, every ratio kept",
  `serves value_usd "${String(
    (DM_FLIP_AMOUNT * WRONG_SIDE_PRICE_BEFORE) / 10n ** BigInt(DM_FLIP_ASSET_DECIMALS),
  )}" for ${DM_FLIP_ASSET}::counted, but the derivation values its ${String(DM_FLIP_AMOUNT)} at ` +
    `the FROZEN source-side price`,
  (mutant) => {
    const unit = 10n ** BigInt(DM_FLIP_ASSET_DECIMALS);
    const before = (DM_FLIP_AMOUNT * WRONG_SIDE_PRICE_BEFORE) / unit;
    const after = (DM_FLIP_AMOUNT * WRONG_SIDE_PRICE_AFTER) / unit;
    const shock = mutant.applied_shocks.find((entry) => entry.asset === DM_FLIP_ASSET);
    shock.before = WRONG_SIDE_PRICE_BEFORE.toString();
    shock.after = WRONG_SIDE_PRICE_AFTER.toString();
    const dm = mutant.engines.find((engine) => engine.engine === "debt_manager");
    for (const [side, value, wasValue] of [
      ["before", before, DM_FLIP_VALUE_BEFORE],
      ["after", after, DM_FLIP_VALUE_AFTER],
    ]) {
      const entry = dm[side].collateral_by_asset.find((row) => row.asset === DM_FLIP_ASSET);
      entry.value_usd = value.toString();
      dm[side].total_collateral_usd = (
        BigInt(dm[side].total_collateral_usd) - wasValue + value
      ).toString();
    }
  },
);

// T. THE WHOLE AAVE ENGINE DELETED (round 31, finding 2). The engine is dropped
// from `engines[]`, its two disclosures go with it, and `coverage` is adjusted
// down exactly as a deployment serving one engine would adjust it — so the
// census laws, the coverage laws and law 3's book-wide witness check are all
// satisfied. The holding ANCHOR still names the aave rows, and under the old
// guard NOTHING looked: the exhaustiveness check that would have missed them
// lived inside `for (const engine of response.engines)`, and there was no
// longer an iteration for it to run in.
refuses(
  "T: the whole aave engine deleted — coverage adjusted, the anchor's rows unmissed",
  `declares holding-ANCHOR rows under ${AAVE_ENGINE}, an engine this response does NOT serve`,
  (mutant) => {
    mutant.engines = mutant.engines.filter((engine) => engine.engine !== AAVE_ENGINE);
    mutant.applied_shocks = mutant.applied_shocks.filter((entry) => entry.chain_id !== AAVE_CHAIN);
    mutant.held_flat = mutant.held_flat.filter((entry) => entry.chain_id !== AAVE_CHAIN);
    mutant.coverage = {
      ...mutant.coverage,
      in_book: mutant.coverage.in_book - 1,
      batch_positions: mutant.coverage.batch_positions - 1,
    };
    mutant.batch = { ...mutant.batch, position_count: mutant.batch.position_count - 1 };
  },
);

/** An address that is valid, unrelated, and belongs to no account in this book. */
const UNRELATED_ACCOUNT = "0x00000000000000000000000000000000000d0009";

// U. THE MOVER IS SOMEBODY ELSE (round 31, finding 3). The Debt Manager mover's
// `account` is replaced with an unrelated valid address and NOTHING else moves.
// Its shape is still the engine's vocabulary (law 12), its denominator is still
// the borrowings it publishes as `debt_usd` (law 12's second half), its quotient
// is still the disclosed factor (law 7), and it still lands in a populated
// bucket on both sides — because every one of those laws reads the row's
// NUMBERS. WHO the row is about was pinned by nothing at all, so the book named
// an account that holds no position in it.
refuses(
  "U: the mover is somebody else — the DM mover's account replaced with an unrelated address",
  `ranks a mover for ${UNRELATED_ACCOUNT}, which the derivation does not name`,
  (mutant) => {
    const dm = mutant.engines.find((engine) => engine.engine === "debt_manager");
    dm.movers.find((mover) => mover.became_eligible === true).account = UNRELATED_ACCOUNT;
  },
);

// V. ONE ACCOUNT, TWO MOVERS (round 31, finding 4). The aave engine measures ONE
// account; here it publishes `movers_total: 2` and serves its single mover
// twice, byte-identical. Every per-mover law passes — each copy is a valid
// mover of this engine, with the right shape, the right drop and the right
// bucket — and the ONLY count law was `movers.length <= movers_total`, which
// this satisfies exactly. A total larger than the account census it ranks over
// is the disclosure sentence ("top S of T") claiming accounts the run never saw.
refuses(
  "V: one account, two movers — movers_total raised past the engine's own census",
  "publishes movers_total 2 but its before side measures 1 accounts",
  (mutant) => {
    const aave = mutant.engines.find((engine) => engine.engine === AAVE_ENGINE);
    aave.movers = [aave.movers[0], { ...aave.movers[0] }];
    aave.movers_total = 2;
  },
);

// X. A MOVER'S WAD FALSIFIED. The aave mover's health-factor triple is restated
// at 1.09 -> 0.763 — chosen so that EVERY law that reads it still agrees:
// `hf_drop_wad` is recomputed and still the exact difference (law 12), the drop
// is still STRICT, the quotient is still the disclosed 70/100 (law 7), and both
// wads still land in the buckets their own sides populate (1.09 in `1.05 – 1.10`
// and 0.763 in `< 0.90`), so neither mover-bucket law fires. The row's numbers
// are internally perfect and are not this book's measurement: only the frozen
// liquidation threshold and the frozen source-side price can say what the health
// factor WAS, and the derivation now holds the row to them.
const FALSIFIED_HF_BEFORE_WAD = 1_090_000_000_000_000_000n;
const FALSIFIED_HF_AFTER_WAD = 763_000_000_000_000_000n;

refuses(
  "X: a mover's wad falsified — the health-factor triple restated inside its own buckets",
  `publishes hf_before_wad "${String(FALSIFIED_HF_BEFORE_WAD)}", but the derivation composes`,
  (mutant) => {
    const mover = mutant.engines.find((engine) => engine.engine === AAVE_ENGINE).movers[0];
    mover.hf_before_wad = FALSIFIED_HF_BEFORE_WAD.toString();
    mover.hf_after_wad = FALSIFIED_HF_AFTER_WAD.toString();
    mover.hf_drop_wad = (FALSIFIED_HF_BEFORE_WAD - FALSIFIED_HF_AFTER_WAD).toString();
  },
);

// --- WAVE W-BS-G: THE FOUR FIELDS NO PEN WROTE, AND THE EMPTY LOOP ---------
//
// Y-AB are Codex round 32's first finding, one mutant per field. All four
// arrived on every generated body by object spread and were read by NOTHING
// afterwards, so all four were free text on a page that publishes money.

// Y. THE ENGINE'S USD SCALE MOVED. `usd_decimals` is the exponent every figure
// this engine serves is READ at, and moving the Debt Manager's 6 to 18 leaves
// every total, every delta, every ratio and every anchor untouched while the
// page renders $6,500.00 of eligible debt as $0.0000000065. A reader is not
// shown a wrong number; they are shown the right digits at the wrong scale,
// which is worse, because nothing looks broken.
refuses(
  "Y: the engine's USD scale moved — the Debt Manager's 6 decimals restated as 18",
  "publishes usd_decimals 18, but the derivation composes 6",
  (mutant) => {
    mutant.engines.find((engine) => engine.engine === "debt_manager").usd_decimals = 18;
  },
);

// Z. THE COMPARATOR BORROWED. The Debt Manager has NO health-factor wad — its
// test is the strict boolean `debt > maxBorrowLT` and its buckets are a
// disclosure of the rational maxBorrowLT/borrowings (handlers.go:415-423). Claim
// `hf_wad` for it and every count, every edge and every total stays exactly
// where it was while the reader is told the buckets are pool health factors they
// may liquidate on.
refuses(
  "Z: the comparator borrowed — the Debt Manager's buckets relabelled as pool health-factor WADs",
  'publishes an hf_histogram comparator of "hf_wad", but the derivation composes "hf_num/hf_den"',
  (mutant) => {
    for (const side of ["before", "after"]) {
      mutant.engines.find((engine) => engine.engine === "debt_manager")[side].hf_histogram
        .comparator = "hf_wad";
    }
  },
);

// AA. REFUSALS INVENTED. `refused_count` is every position on a covered engine
// that reached the run without numbers — the rows the batch refused plus the
// rows this layer could not rebuild. Raising it to 7 tells a reader that seven
// positions carried no comparator and were held out of the distribution, on a
// run whose census refuses two and excludes nobody. The claim is a refusal
// disclosure with no refusal behind it.
refuses(
  "AA: refusals invented — seven positions counted out of a distribution nothing excluded",
  "publishes an hf_histogram refused_count of 7, but the derivation composes 1",
  (mutant) => {
    for (const engine of mutant.engines) {
      for (const side of ["before", "after"]) {
        engine[side].hf_histogram.refused_count = 7;
      }
    }
  },
);

// AA MOVED LAWS TWICE, and the second move is Wave W-EX-A's correction.
//
// W-BS-H read a side's census as `buckets + infinite + refused` and compared it
// against `accounts`, on the reading that a position this layer could not
// rebuild is still a position the run measured over — which put AA under the
// ARITHMETIC rather than under the derivation. Production disagrees:
// `measureRunBook` counts `accounts` only over the RUN, and
// `p5_runbook.go:581-583` adds the refusals afterwards. Neither reading was
// falsifiable while every body here served `refused_count: 0`; the repaired
// contract example serves 1, and the disagreement surfaced on the first run.
//
// So the arithmetic law is `buckets + infinite === accounts` (`measured`), the
// wider census is `+ refused` and equals the whole run, and AA is back under the
// derivation's own `refused_count` law where it began. AZ, below, is the witness
// for the corrected arithmetic: it moves a BUCKET, which is what `accounts`
// actually counts.

// AB. THE NOTE FALSIFIED. The note is the sentence the page RENDERS beside the
// distribution — it is what a reader is TOLD the buckets mean. The rewrite below
// keeps every count and every edge and inverts the disclosure: it tells the
// reader to take Debt Manager eligibility off the buckets, which is exactly what
// the real sentence exists to forbid ("a disclosure only — take eligibility from
// `liquidatable`").
const FALSIFIED_HISTOGRAM_NOTE =
  "the Debt Manager buckets ARE health factors: anything below 1.00 is liquidatable, so read " +
  "eligibility straight off the census.";

refuses(
  "AB: the note falsified — the Debt Manager's disclosure inverted into a liquidation rule",
  `publishes the hf_histogram note ${JSON.stringify(FALSIFIED_HISTOGRAM_NOTE)}`,
  (mutant) => {
    for (const side of ["before", "after"]) {
      mutant.engines.find((engine) => engine.engine === "debt_manager")[side].hf_histogram.note =
        FALSIFIED_HISTOGRAM_NOTE;
    }
  },
);

// AC. THE DEBT MANAGER MOVER'S RATIONAL FALSIFIED — Codex round 32's second
// finding, banked exactly as it was demonstrated. Both numerators are scaled by
// 39/40 and nothing else is touched, which is chosen so that EVERY law that
// reads the row still agrees:
//
//   * the quotient still moves by the disclosed 70/100 (law 7): 1365/1950 = 0.7;
//   * the denominator is still bit-identical across the sides and still equals
//     `debt_usd` (law 12's conservation half);
//   * `became_eligible` is still true and the shape is still whole (law 12);
//   * both placements are unchanged — 1.3 is still in `1.25 – 1.50` and 0.91 is
//     still in `0.90 – 1.00` — so neither mover-bucket law fires.
//
// It passed the whole guard, because `moverFields` was a per-ENGINE object and
// the Debt Manager's derivation supplied none: the exact-field loop iterated an
// EMPTY OBJECT. The prior wave disclosed that omission and asserted laws 7 and
// 12 covered it. They did not. The fields are derived and account-keyed now, and
// a derived mover with no derived fields is itself a refusal.
const FALSIFIED_DM_BEFORE_NUM = (DM_FLIP_MAXBORROW_BEFORE * 39n) / 40n;
const FALSIFIED_DM_AFTER_NUM = (DM_FLIP_MAXBORROW_AFTER * 39n) / 40n;

refuses(
  "AC: the DM mover's rational falsified — both numerators scaled, same factor, same buckets",
  `publishes hf_before_num "${String(FALSIFIED_DM_BEFORE_NUM)}", but the derivation composes ` +
    `${String(DM_FLIP_MAXBORROW_BEFORE)}`,
  (mutant) => {
    const mover = mutant.engines.find((engine) => engine.engine === "debt_manager").movers[0];
    mover.hf_before_num = FALSIFIED_DM_BEFORE_NUM.toString();
    mover.hf_after_num = FALSIFIED_DM_AFTER_NUM.toString();
  },
);

// AG. THE EMPTY LOOP, WATCHED AS ITSELF. AC proves the falsified rational is
// caught now; this proves the ARRANGEMENT that let it through cannot come back.
// A derivation that names an account a mover and composes no field for it is
// refused at the point of use — so the next engine, or the next wave, cannot
// quietly reintroduce a mover row that no second pen ever wrote, and no future
// disclosure can stand in for a field the derivation does not actually compose.
refusesGeneration(
  "AG: a derived mover with no derived fields — the vacuous green refused as itself",
  `names ${aaveResult.account} a mover and composes NO field for it`,
  () =>
    checkDerivation("probe", ethRunBook, {
      ...ETH_DERIVATION,
      engines: ETH_DERIVATION.engines.map((engine) => ({ ...engine, moverFields: new Map() })),
    }),
);

// AH-AJ. THE REFUSAL ROSTER, WATCHED. Deriving each side's `refused_count`
// closed one reading of the census and left the other three free, which an audit
// of this wave's own work found before Codex could: a body could LIST an
// excluded position while TOTALLING none, WITHHOLD an engine it also serves, and
// claim full coverage over both. All three are the same census disclosed four
// ways, so all three answer to it now.

// AH. AN EXCLUDED POSITION NOBODY COUNTED. The roster grows a row while
// `excluded_by_this_layer` stays 0 and every histogram still reads 0 refusals —
// a refused position on the page and a complete census under it.
refuses(
  "AH: an excluded position nobody counted — the roster grown under a zero total",
  "coverage.excluded names [debt_manager], but the derivation composes []",
  (mutant) => {
    mutant.coverage.excluded = [
      {
        engine: "debt_manager",
        account: DM_FLIP_ACCOUNT,
        code: "FLAG_RECONSTRUCTION",
        reason: "could not rebuild",
      },
    ];
  },
);

// AI. FULL COVERAGE DENIED WITH NOTHING BEHIND IT. `stress_coverage_is_full` is
// the contract's own conjunction — "false if any position could not be rebuilt
// OR any engine is withheld" (handlers.go:714) — so it is a CONCLUSION, and a
// body that states it independently can say either thing about the same run.
refuses(
  "AI: full coverage denied — the fail-closed claim stated instead of concluded",
  "publishes stress_coverage_is_full false, but its own roster makes it true",
  (mutant) => {
    mutant.coverage.stress_coverage_is_full = false;
  },
);

// AJ. AN ENGINE WITHHELD AND SERVED AT ONCE. `withheld_engines` names engines
// whose whole book is refused and therefore absent from `engines[]` — the R12
// contradiction fixture exists precisely because the contract permits the shape.
// A body this guard vouches for may not have it.
refuses(
  "AJ: an engine withheld and served at once — a refusal recorded against a row on the wire",
  "coverage.withheld_engines names [debt_manager], but the derivation composes []",
  (mutant) => {
    mutant.coverage.withheld_engines = [
      { engine: "debt_manager", code: "FLAG_CUSTODY_UNPROVEN", reason: "custody unproven" },
    ];
    mutant.coverage.stress_coverage_is_full = false;
  },
);

// --- THE `.batch2` TRANSFORM ------------------------------------------------
//
// One field moved: the batch id, with `computed_at` advanced to keep the two
// batches ordered. The bodies are SUPERSESSION inputs and their whole point is
// to be identical in everything but the batch they were measured at, so the
// transform is deliberately minimal.
//
// `age_seconds` is DERIVED, never written. It used to travel unchanged from the
// source body — 5 seconds — beside a `computed_at` 25 seconds AFTER the body's
// own `served_at`, which is a freshness no response can state: production
// measures the age as `served_at − computed_at` FLOORED AT ZERO
// (`cmd/api/meta.go:255-261`), so the only servable value here is 0. Deriving
// it means the age answers to the two stamps rather than to whatever the source
// body happened to carry, and moving `computed_at` again cannot desynchronize
// them.
const BATCH2_COMPUTED_AT = "2026-07-29T10:00:30Z";
const atNextBatch = (body) => ({
  ...body,
  batch: {
    ...body.batch,
    id: body.batch.id + 1,
    computed_at: BATCH2_COMPUTED_AT,
    age_seconds: Number(ageSeconds(BATCH2_COMPUTED_AT, body.served_at)),
  },
});

write("run-book.eth_minus_30.json", ethRunBook);
write("run-book.eth_minus_30.batch2.json", atNextBatch(ethRunBook));
write("run-book.weeth.batch2.json", atNextBatch(runBookExample));

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
write("run-book.names-nobody.batch2.json", atNextBatch(namesNobody));

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

// --- 12: THE COLLIDING COLLATERAL ROWS (Wave W-BS-B, finding 4) ------------
//
// The run-book example with ONE entry ADDED to the aave engine's
// `collateral_by_asset`, on both sides: the SAME weETH asset it already counts,
// carried a second time under the NOT-COUNTED disclosure. Nothing else moves —
// a not-counted holding is outside `total_collateral_usd` by construction, so
// the counted entries still sum to it exactly.
//
// This is not a hypothetical shape. `cmd/api/p5_runbook.go` keys the
// itemization by asset AND disclosure (`runCollateralKey`), and the LIVE book
// already serves weETH twice for an Aave aggregate: COUNTED for the accounts
// that enabled it as collateral and NOT COUNTED for the accounts that did not.
// The contract's own `unpriced` description says the same thing in the other
// direction ("An entry may appear twice for one asset").
//
// It is the fixture the OLD React key could not tell apart. COUNTED and
// NOT-COUNTED share `unpriced: false`, so `asset + unpriced` gave both rows one
// key, and a rerun then reconciled two rows that claimed one identity. The
// `.swap` file is the second serve of that rerun: the same two colliding rows
// with DIFFERENT balances and a different counted value, so a row that survived
// stale, doubled or dropped shows up as a wrong number on the page rather than
// as a silent identity error.
//
// The NOT-COUNTED note is `runCollateralNotCounted`'s own sentence from
// cmd/api/p5_runbook.go, verbatim — the wire's words, not a paraphrase.

const NOT_COUNTED_NOTE =
  "NOT COUNTED AS COLLATERAL: the engine counts none of this holding toward collateral " +
  "(Aave `usedAsCollateral = false`), so the reviewed arithmetic assigned it no value and none " +
  "is invented here. `amount` is exact; none of this holding is inside `total_collateral_usd`.";

/**
 * The example's aave engine with its counted weETH entry restated at
 * `countedAmount`/`countedValue` and shadowed by a NOT-COUNTED row for the SAME
 * asset at `notCountedAmount`. `total_collateral_usd` follows the counted value,
 * because the counted entries sum to it EXACTLY and that law does not bend.
 *
 * IT RETURNS ITS OWN ANCHOR (Wave W-BS-E). The two injected rows are written
 * ONCE and used twice — to build the body, and to pin it — and they are built
 * from the example's untouched counted entry plus the literal balances this call
 * declares. An anchor read back off the produced body would only ever prove that
 * the body equals itself, which is the whole class of defect round 30 found.
 */
/**
 * THE CENSUS FOLLOWS THE MONEY (Wave W-BS-H, unconditional since Wave W-EX-A).
 *
 * The `.swap` body exists to restate the counted balance, and it used to restate
 * the balance and carry the example's DISTRIBUTION unchanged: 3 weETH —
 * 1200000000000 against the same 600000000000 of debt — drawn in `1.10 – 1.25`.
 * At the committed 8100 bps that account sits at 1200/600 x 0.81 = 1.62, which
 * is the `1.50 – 2.00` bucket, and no threshold anywhere reconciles 3 weETH of
 * that collateral with the bucket the example drew.
 *
 * W-BS-H made the placement CONDITIONAL: a body that restates the book takes the
 * derived placement, and a body serving the example's own money kept carrying
 * the example's census, because that census disagreed with /v1/params and the
 * disagreement was a contract defect this file had no standing to fix. Wave
 * W-EX-A fixed it at the source — the example is CAPTURED from the running
 * handler now and draws its one aave account at 1.08, in `1.05 – 1.10`, where
 * this arithmetic puts it — so the condition became dead weight: both branches
 * produce the same bytes. The placement is unconditional now, and there is one
 * rule instead of two.
 */
const collidingHistogram = (aggregate, countedValue) =>
  // Aave's own health-factor rational, never divided out:
  // sum(collateral x liq_threshold) / (debt x 10000).
  histogramForOneRational(
    aggregate.hf_histogram,
    BigInt(countedValue) * AAVE_LT_BPS,
    BigInt(aggregate.total_debt_usd) * BPS,
  );

/**
 * THE REALIZATION AXIS THE SERVING LAYER WOULD WRITE FOR THIS BODY.
 *
 * `withCollidingCollateral` carried the contract example's `market_realization`
 * through by object spread, so both collision fixtures served
 * `execution_shortfall_usd: "40000000000"` — $400 of CRITICAL execution
 * shortfall, rendered `crit` by `LabRealization` — on an aave engine whose own
 * `eligible_accounts` is 0 (Codex round 33, HIGH). The shortfall is not an
 * envelope byte. `cmd/api/p5_runbook.go:500-613` computes it from the BEFORE
 * side's book through `risk.ExecutionShortfall`, which aggregates LIQUIDATABLE
 * positions only, and a body that restates the book owes a restated figure.
 *
 * So it is composed here, in the GENERATING pen, from this body's own before
 * side and the committed scenario's own axis. `collisionDerivation` reaches the
 * same figures from the frozen literals by its own arithmetic, and
 * `checkDerivation` is what makes the two agree.
 *
 * `seizure_model` and `note` are carried, not composed: they are the disclosure
 * sentences, they stay ANCHORED, and the register says why.
 */
/**
 * Each engine's LIQUIDATION BONUS, as the exact rational `seizableValue`
 * multiplies the debt by (internal/risk/dm.go:385-401).
 *
 * Aave's is the committed param ledger's own `liq_bonus` over basis points; the
 * Debt Manager's is its committed ADDITIVE 1e18 over HUNDRED_PERCENT = 100e18,
 * i.e. 101/100. Both are read from the constants this file already derives with,
 * never typed in a second time.
 */
const ENGINE_SEIZURE_BONUS = {
  aave_v3_etherfi: () => [AAVE_BONUS_BPS, BPS],
  debt_manager: () => [DM_BONUS_NUM, DM_BONUS_DEN],
};

const runMarketRealization = (engine, chainId, axis) => {
  const carried = engine.market_realization;
  if (carried === null || carried === undefined) {
    return carried ?? null;
  }
  const par = 10n ** 18n;
  const discounts = new Map(
    axis.map((row) => [responseKey(row.chain_id, row.asset), BigInt(row.market_over_oracle_wad)]),
  );
  // Wire order, unchanged: the contract's own field order for the block.
  const compose = (shortfall, badDebt) => ({
    hfs_unchanged: true,
    execution_shortfall_usd: shortfall,
    bad_debt_at_liquidation_usd: badDebt,
    usd_decimals: engine.usd_decimals,
    seizure_model: carried.seizure_model,
    note: carried.note,
  });
  // The BEFORE side is the book production measures this axis over.
  const side = engine.before;
  if (side.eligible_accounts === 0) {
    // Nothing here is liquidatable, so the per-position sum production performs
    // is EMPTY and both aggregates are zero. This is the whole finding.
    return compose("0", "0");
  }
  if (side.accounts !== 1) {
    fail(
      "the collision transform cannot state a realization aggregate for a liquidatable engine " +
        "whose side carries more than one account: production sums the axis PER POSITION, and an " +
        "aggregate over several cannot be decomposed into the positions it came from",
    );
  }
  const bonusOf = ENGINE_SEIZURE_BONUS[engine.engine];
  if (bonusOf === undefined) {
    fail(`no liquidation bonus is derivable for ${engine.engine}, so its seizable term is unknown`);
  }
  const [bonusNum, bonusDen] = bonusOf();
  // A row with no `value_usd` is outside the aggregate entirely: the engine
  // counted no collateral for it, so a liquidator realizes nothing from it.
  const legs = side.collateral_by_asset
    .filter((row) => row.value_usd !== null)
    .map((row) => ({
      value: BigInt(row.value_usd),
      ratio: discounts.get(responseKey(chainId, row.asset)) ?? par,
    }));
  const total = legs.reduce((sum, leg) => sum + leg.value, 0n);
  const owed = BigInt(side.total_debt_usd);

  // `seizableValue` — PER LEG, each capped at the leg's own value, summed.
  let seizable = 0n;
  if (total > 0n) {
    for (const leg of legs) {
      const share = (owed * leg.value * bonusNum) / (total * bonusDen);
      seizable += share < leg.value ? share : leg.value;
    }
  }
  // Σ(valueᵢ × rᵢ), exact, and the ONE fused floor production performs:
  // seizable × Σ(value·r) / (WAD × Σ value).
  const weighted = legs.reduce((sum, leg) => sum + leg.value * leg.ratio, 0n);
  const seizableMarket = total > 0n ? (seizable * weighted) / (par * total) : 0n;
  // `realizable` floors PER LEG, which is not the same as flooring the sum.
  const realized = legs.reduce((sum, leg) => sum + (leg.value * leg.ratio) / par, 0n);

  return compose(
    (seizable > seizableMarket ? seizable - seizableMarket : 0n).toString(),
    (owed > realized ? owed - realized : 0n).toString(),
  );
};

const withCollidingCollateral = (countedAmount, countedValue, notCountedAmount) => {
  const exampleAave = runBookExample.engines.find((engine) => engine.engine === "aave_v3_etherfi");
  const exampleCounted = exampleAave.before.collateral_by_asset.find(
    (entry) => entry.value_usd !== null,
  );
  if (exampleCounted === undefined) {
    fail("the example's aave side carries no counted collateral entry");
  }
  // Aave's own health-factor rational at the restated collateral — the SAME
  // pair `collidingHistogram` places the census by, kept here so the transition
  // matrix is placed by it too rather than carried from a book this body no
  // longer serves.
  const collidingRational = (aggregate) => [
    BigInt(countedValue) * AAVE_LT_BPS,
    BigInt(aggregate.total_debt_usd) * BPS,
  ];
  const side = (aggregate) => {
    const counted = aggregate.collateral_by_asset.find((entry) => entry.value_usd !== null);
    if (counted === undefined) {
      fail("the aave side carries no counted collateral entry");
    }
    const rest = aggregate.collateral_by_asset.filter((entry) => entry !== counted);
    return {
      ...aggregate,
      total_collateral_usd: countedValue,
      // THE CENSUS FOLLOWS THE MONEY. Unchanged for a body serving the example's
      // own collateral; re-placed by this engine's own arithmetic for a body
      // that restates it.
      hf_histogram: collidingHistogram(aggregate, countedValue),
      collateral_by_asset: [
        { ...counted, amount: countedAmount, value_usd: countedValue },
        // Same asset, same `unpriced: false`, a DIFFERENT disclosure — the
        // pair the row key must keep apart.
        {
          ...counted,
          amount: notCountedAmount,
          value_usd: null,
          unpriced: false,
          note: NOT_COUNTED_NOTE,
        },
        ...rest,
      ],
    };
  };
  // The axis and each engine's chain come from THIS body's own sources — the
  // scenario it answers and the batch watermarks it publishes — so the
  // generating pen never reaches for the derivation's frozen constants.
  const axis = committedScenario(runBookExample.scenario_id).market_realizations ?? [];
  const chainOf = new Map(
    runBookExample.batch.watermarks.map((watermark) => [watermark.engine, watermark.chain_id]),
  );
  return {
    response: {
      ...runBookExample,
      engines: runBookExample.engines.map((engine) => {
        let rebuilt = engine;
        if (engine.engine === "aave_v3_etherfi") {
          const before = side(engine.before);
          const after = side(engine.after);
          rebuilt = {
            ...engine,
            before,
            after,
            // The census moved, so the JOINT moves with it: one measured row,
            // placed on each side by the same rational the histogram beside it
            // is placed by, plus the example's own unmeasured tail.
            hf_transitions: transitionsFor(
              engine.hf_transitions,
              before.hf_histogram,
              [
                {
                  before: collidingRational(engine.before),
                  after: collidingRational(engine.after),
                  debtBefore: BigInt(before.total_debt_usd),
                  debtAfter: BigInt(after.total_debt_usd),
                },
              ],
              unmeasuredSplitFor(
                runBookExample.coverage,
                engine.engine,
                before.hf_histogram.refused_count,
              ),
            ),
          };
        }
        // The realization block is composed AFTER the book is restated, over the
        // book this body actually serves.
        return {
          ...rebuilt,
          market_realization: runMarketRealization(rebuilt, chainOf.get(rebuilt.engine), axis),
        };
      }),
    },
    holdings: holdingAnchor([
      [
        "aave_v3_etherfi",
        [
          { ...exampleCounted, amount: countedAmount, value_usd: countedValue },
          {
            ...exampleCounted,
            amount: notCountedAmount,
            value_usd: null,
            unpriced: false,
            note: NOT_COUNTED_NOTE,
          },
          ...exampleAave.before.collateral_by_asset.filter((entry) => entry !== exampleCounted),
        ],
      ],
      [
        "debt_manager",
        runBookExample.engines.find((engine) => engine.engine === "debt_manager").before
          .collateral_by_asset,
      ],
    ]),
  };
};

const COLLISION_COUNTED_AMOUNT = "2000000000000000000";
const COLLISION_NOT_COUNTED_AMOUNT = "5000000000000000000";
// The rerun's second serve: DIFFERENT balances at the SAME weETH price, which
// is what makes a row that survived stale, doubled or dropped read as a wrong
// number on the page. The derivation re-values both amounts at that one frozen
// price and so proves the pair really is one price twice, not two.
const COLLISION_SWAP_COUNTED_AMOUNT = "3000000000000000000";
const COLLISION_SWAP_NOT_COUNTED_AMOUNT = "7000000000000000000";

const collision = withCollidingCollateral(
  COLLISION_COUNTED_AMOUNT,
  "800000000000",
  COLLISION_NOT_COUNTED_AMOUNT,
);
const collisionSwap = withCollidingCollateral(
  COLLISION_SWAP_COUNTED_AMOUNT,
  "1200000000000",
  COLLISION_SWAP_NOT_COUNTED_AMOUNT,
);

/**
 * LAW 11's SECOND EXEMPTION IS GONE (Wave W-EX-A), and this note is what is left
 * of it.
 *
 * `EXAMPLE_UNDISCLOSED_KEYS`, `EXAMPLE_PRICED_HOLDINGS`, `exampleUndisclosedInputs`
 * and the `undisclosedInputs` parameter used to live here. They forgave a
 * DISCLOSURE THE CONTRACT'S OWN EXAMPLE DID NOT MAKE: it served
 * `applied_shocks: []` AND `held_flat: []` while itemizing priced weETH on two
 * chains under `weeth_market_depeg_oracles_held`, whose committed registry entry
 * carries `propagation: []` - so `scenario.go:679-686` records EVERY price input
 * on `HeldFlat` and the served body names all of them. The example's empty
 * `held_flat` was a body production could not serve, and this generator had no
 * standing to rewrite the contract, so the two bodies that carried the example
 * verbatim declared exactly those keys as frozen literals.
 *
 * The exemption was built to be SELF-ENFORCING: it re-proved every run that it
 * was still owed, and fingerprinted the example's priced holdings so the licence
 * could not widen. Wave W-EX-A repaired the example - CAPTURED it from the
 * running handler instead of composing it - and on the first run afterwards both
 * teeth bit: the fingerprint moved (the Debt Manager's weETH is 0x5A7f... on
 * chain 10 now, not the mainnet address) and the example DISCLOSED both keys. A
 * licence nothing owes forgives the next hole instead of the one it recorded, so
 * the whole block was deleted rather than re-frozen, exactly as its own failure
 * message demanded. Mutant R went with it: it probed a widening that can no
 * longer happen, because there is no exemption left to widen.
 *
 * Law 11 is now owed IN FULL by every body this file writes.
 */

/**
 * THE COLLISION PAIR'S DERIVATION (Wave W-BS-F), composed from the frozen
 * sources and the two literal balances the caller declares.
 *
 * These bodies answer `weeth_market_depeg_oracles_held`, whose committed
 * registry entry carries `shocks: []` and `propagation: []` — so every factor
 * the matrix composes is 1/1, every price is held, and the two sides are
 * IDENTICAL BY CONSTRUCTION. The derivation composes both sides through the same
 * matrix anyway rather than asserting the identity, because "nothing moves" is a
 * conclusion the registry has to reach, not a premise this file may assume.
 *
 * THE COUNTED VALUE IS NOT TAKEN FROM THE CALLER. `withCollidingCollateral` is
 * handed a counted amount, a counted value AND a not-counted amount; the
 * derivation is handed only the two AMOUNTS and re-values them at the FROZEN
 * source-side weETH price — the same 400000000000 the committed excerpt and the
 * example's own itemization both name. That the two fixtures' stated values
 * (800000000000 over 2 weETH, 1200000000000 over 3) fall out of one price is
 * the derivation's, not the generator's, and a value typed in beside a
 * mismatched amount now stops the run.
 *
 * The aave and debt_manager AGGREGATES are the contract example's own bytes,
 * read off disk. This generator re-measures nothing here — it adds one
 * NOT-COUNTED row, which is outside `total_collateral_usd` by construction.
 */
const collisionDerivation = (what, countedAmount, notCountedAmount) => {
  // THE MATRIX IS FETCHED BY THE FROZEN ID and each engine's chain is the frozen
  // one, so a renamed scenario or a moved watermark cannot pick the physics this
  // derivation is measured under.
  const matrix = matrixFor(committedScenario(FROZEN_EXAMPLE_SCENARIO_ID));
  const chains = new Map(Object.entries(FROZEN_EXAMPLE_CHAINS));
  // These bodies inject no account: they add ONE not-counted row to an engine
  // that already reached the run. Nothing new is refused, so every side's
  // `refused_count` is the example's own census plus zero.
  const INJECTED_REFUSALS = 0;
  // The same frozen source-side prices the eth_minus_30 derivation names, for
  // the same two rows of the same contract example.
  // ONE SYMBOL, TWO ADDRESSES. weETH is 0xCd5f... on mainnet (Aave's) and
  // 0x5A7f... on Optimism (the Debt Manager's). The two used to share ONE
  // literal here, because the contract example carried the mainnet address on
  // chain 10 as well - an identity no served body could have, and the accident
  // Wave W-EX-A's repair removed.
  const FROZEN_AAVE_WEETH_ASSET = "0xCd5fE23C85820F7B72D0926FC9b05b43E359b7ee";
  const FROZEN_DM_WEETH_ASSET = "0x5A7fACB970D094B6C7FF1df0eA68D99E6e73CBFF";
  const FROZEN_AAVE_WEETH_PRICE = 400_000_000_000n;
  const FROZEN_DM_WEETH_PRICE = 4_000_000_000n;
  const FROZEN_UNPRICED_ASSET = "0x0000000000000000000000000000000000000Bad";
  const FROZEN_UNPRICED_AMOUNT = 5_000_000_000_000_000_000n;
  const FROZEN_DM_WEETH_AMOUNT = 1_000_000_000_000_000_000n;

  const engineOf = (engineName) =>
    FROZEN_RUNBOOK_EXAMPLE.engines.find((engine) => engine.engine === engineName) ??
    fail(`the frozen contract example carries no ${engineName} engine`);
  const exampleAave = engineOf("aave_v3_etherfi");
  const exampleDM = engineOf("debt_manager");
  const rowOf = (engine, asset) =>
    engine.before.collateral_by_asset.find(
      (entry) => entry.asset.toLowerCase() === asset.toLowerCase(),
    ) ?? fail(`the frozen contract example carries no ${asset} row for ${engine.engine}`);

  frozenLiteral(
    "the collision pair's aave weETH SOURCE-SIDE price",
    FROZEN_AAVE_WEETH_PRICE,
    (BigInt(rowOf(exampleAave, FROZEN_AAVE_WEETH_ASSET).value_usd) * 10n ** 18n) /
      BigInt(rowOf(exampleAave, FROZEN_AAVE_WEETH_ASSET).amount),
  );
  frozenLiteral(
    "the collision pair's debt_manager weETH SOURCE-SIDE price",
    FROZEN_DM_WEETH_PRICE,
    (BigInt(rowOf(exampleDM, FROZEN_DM_WEETH_ASSET).value_usd) * 10n ** 18n) /
      BigInt(rowOf(exampleDM, FROZEN_DM_WEETH_ASSET).amount),
  );
  frozenLiteral(
    "the collision pair's unpriced amount",
    FROZEN_UNPRICED_AMOUNT,
    BigInt(rowOf(exampleAave, FROZEN_UNPRICED_ASSET).amount),
  );
  frozenLiteral(
    "the collision pair's debt_manager weETH amount",
    FROZEN_DM_WEETH_AMOUNT,
    BigInt(rowOf(exampleDM, FROZEN_DM_WEETH_ASSET).amount),
  );

  const aaveRows = [
    {
      asset: FROZEN_AAVE_WEETH_ASSET,
      decimals: 18,
      amount: BigInt(countedAmount),
      price: FROZEN_AAVE_WEETH_PRICE,
      disclosure: "counted",
    },
    // The colliding row: the SAME asset, NOT COUNTED. No price witness enters
    // the aggregate for it, by the engine's own rule, so it values at null.
    {
      asset: FROZEN_AAVE_WEETH_ASSET,
      decimals: 18,
      amount: BigInt(notCountedAmount),
      price: null,
      disclosure: "not-counted",
    },
    {
      asset: FROZEN_UNPRICED_ASSET,
      decimals: 18,
      amount: FROZEN_UNPRICED_AMOUNT,
      price: null,
      disclosure: "unpriced",
    },
  ];
  const dmRows = [
    {
      asset: FROZEN_DM_WEETH_ASSET,
      decimals: 18,
      amount: FROZEN_DM_WEETH_AMOUNT,
      price: FROZEN_DM_WEETH_PRICE,
      disclosure: "counted",
    },
  ];
  const aaveItems = derivedItemization(matrix, chains.get("aave_v3_etherfi"), aaveRows);
  const dmItems = derivedItemization(matrix, chains.get("debt_manager"), dmRows);

  // THE REALIZATION AXIS, DERIVED (Wave W-BS-I). `ExecutionShortfall` runs on
  // the BEFORE side's book (p5_runbook.go:502), so its legs are that side's
  // COUNTED collateral at the values this derivation just composed — never the
  // body's own itemization read back.
  const realizationAxis =
    committedScenario(FROZEN_EXAMPLE_SCENARIO_ID).market_realizations ?? [];
  const countedLegs = (rows, items) =>
    rows
      .filter((row) => row.disclosure === "counted")
      .map((row) => ({ asset: row.asset, value: items.before.values.get(`${row.asset}::counted`) }))
      .filter((leg) => leg.value !== null && leg.value > 0n);
  const realizationFor = (engineName, rows, items) => {
    const baseline = FROZEN_EXAMPLE_BASELINE[engineName].before;
    return derivedMarketRealization(`${what} ${engineName} market_realization`, {
      axis: realizationAxis,
      chainId: chains.get(engineName),
      legs: countedLegs(rows, items),
      borrowings: BigInt(baseline.total_debt_usd),
      accounts: baseline.accounts,
      eligibleAccounts: baseline.eligible_accounts,
      usdDecimals: FROZEN_ENGINE_SERIALIZATION[engineName].usd_decimals,
      bonus: ENGINE_SEIZURE_BONUS[engineName]?.(),
    });
  };

  /**
   * The example's own aggregate for this engine, with the derived collateral and
   * a histogram PLACED BY THIS DERIVATION.
   *
   * IT USED TO BE CARRIED, AND THE CARRY WAS A RECORDED CONTRACT DEFECT. The
   * example's aave side carries ONE account at 800000000000 of collateral
   * against 600000000000 of debt and drew it in `1.10 - 1.25`, which needs a
   * liquidation threshold between 8250 and 9375 bps - while the contract's OWN
   * /v1/params example gives that (engine, chain, asset) 8100 bps, which puts
   * the account at 1.08, in `1.05 - 1.10`, and `stress-aave.json` measures the
   * same money at `health_factor_wad` 1080000000000000000 and agrees to the
   * digit. Its Debt Manager side drew ONE account in `0.90 - 1.00` while its own
   * collateral and the committed 80/100 threshold put 3200000000/4620000000 at
   * 0.6926, which is `< 0.90`. Two committed artifacts disagreed on each engine
   * and this file had no standing to rewrite either, so both censuses were
   * carried under `carriedCensus`, which re-proved the disagreement every run.
   *
   * Wave W-EX-A repaired the example - it is CAPTURED from the running handler
   * now, not composed - and both carries discharged themselves on the first run
   * afterwards. Every side below takes the derived placement, on every body:
   * `recordedAaveRational` for the aave account, `recordedDMBaselineRational`
   * for the Debt Manager's, each from the same frozen collateral, threshold and
   * debt the aggregates beside them are built from. A body that RESTATES the
   * book (the `.swap` fixture's 3 weETH) is placed by the same arithmetic as one
   * that serves the example's own, which is what the conditional carry was
   * approximating and is now simply the rule.
   */
  const sideFrom = (engineName, items, side, baselinePlacement) => {
    const baseline = FROZEN_EXAMPLE_BASELINE[engineName][side];
    const meta = frozenHistogramMeta(engineName, INJECTED_REFUSALS);
    return {
      values: items[side].values,
      histogram: derivedHistogram(FROZEN_HISTOGRAM_SHAPE, null, [baselinePlacement], meta),
      aggregate: {
        accounts: String(baseline.accounts),
        eligible_accounts: String(baseline.eligible_accounts),
        total_collateral_usd: items[side].counted.toString(),
        total_debt_usd: baseline.total_debt_usd,
        eligible_debt_usd: baseline.eligible_debt_usd,
        collateral_at_risk_usd: baseline.collateral_at_risk_usd,
        bad_debt_usd: baseline.bad_debt_usd,
      },
    };
  };

  // The aave placement is composed over THIS body's own counted collateral, not
  // the example's, so a body that restates the balance is measured on the money
  // it actually serves.
  const aaveSideFrom = (side) =>
    sideFrom(
      "aave_v3_etherfi",
      aaveItems,
      side,
      recordedAaveRational(
        aaveItems[side].counted,
        BigInt(FROZEN_EXAMPLE_BASELINE.aave_v3_etherfi[side].total_debt_usd),
      ),
    );
  const dmSideFrom = (side) =>
    sideFrom("debt_manager", dmItems, side, recordedDMBaselineRational(side));

  return {
    scenario_id: FROZEN_EXAMPLE_SCENARIO_ID,
    scenario_version: FROZEN_EXAMPLE_SCENARIO_VERSION,
    coverage: {
      batch_positions: String(FROZEN_EXAMPLE_COVERAGE.batch_positions),
      in_book: String(FROZEN_EXAMPLE_COVERAGE.in_book),
      refused_in_batch: String(FROZEN_EXAMPLE_COVERAGE.refused_in_batch),
      excluded_by_this_layer: String(FROZEN_EXAMPLE_COVERAGE.excluded_by_this_layer),
    },
    // These bodies add a NOT-COUNTED row and nothing else, so the example's own
    // rosters stand: nobody excluded, nobody withheld.
    excluded: [...FROZEN_EXAMPLE_EXCLUDED_ENGINES],
    withheld: [...FROZEN_EXAMPLE_WITHHELD_ENGINES],
    engines: [
      {
        engine: "aave_v3_etherfi",
        usd_decimals: String(FROZEN_ENGINE_SERIALIZATION.aave_v3_etherfi.usd_decimals),
        market_realization: realizationFor("aave_v3_etherfi", aaveRows, aaveItems),
        before: aaveSideFrom("before"),
        after: aaveSideFrom("after"),
        // NOTHING MOVES under this scenario, so nothing is ranked. That is the
        // fixture's whole point and the derivation reaches it independently.
        movers: new Set(),
        movers_total: 0,
        moverFields: new Map(),
      },
      {
        engine: "debt_manager",
        usd_decimals: String(FROZEN_ENGINE_SERIALIZATION.debt_manager.usd_decimals),
        market_realization: realizationFor("debt_manager", dmRows, dmItems),
        before: dmSideFrom("before"),
        after: dmSideFrom("after"),
        movers: new Set(),
        movers_total: 0,
        moverFields: new Map(),
      },
    ],
  };
};

/**
 * THE COLLISION PAIR'S RESPONSE ANCHOR (Wave W-BS-H).
 *
 * These two bodies carry the contract example's ENVELOPE untouched — they add
 * one NOT-COUNTED collateral row and restate one balance, and nothing else — so
 * their anchor IS the frozen example envelope, with nothing dropped and nothing
 * overridden. That the overlay is empty is asserted rather than assumed: an
 * anchor built by a call that could have dropped or replaced a leaf, and did
 * neither, is a stronger statement than one written out by hand.
 */
const COLLISION_ANCHOR = responseAnchor("the collision pair", [], []);

/**
 * THE EXAMPLE'S OWN BORROWED RESERVE (law 11's FIRST exemption), frozen.
 *
 * The collision pair carries the contract example's `held_flat` untouched, and
 * the repaired example holds THREE prices flat — one per price input its book
 * consulted. Two are itemized holdings and answer to law 11 in full; the third
 * is the Aave account's USDC DEBT LEG, and this wire has no column for a
 * borrowing. That hole is production's shape, not a defect: `ApplyScenario`
 * walks a position's whole `PriceInput` list while `collateral_by_asset`
 * itemizes collateral only.
 *
 * It is FROZEN as a literal and the derivation is asserted equal to it, in both
 * directions, exactly as `AAVE_BORROWED_RESERVE_KEYS` is for the eth_minus_30
 * body — an exemption that grows by derivation is an exemption nobody reviewed.
 * The key is the same USDC-on-mainnet reserve, because it is the same account.
 */
const EXAMPLE_BORROWED_RESERVE_KEYS = new Set([
  // responseKey(1, "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48") — USDC on
  // mainnet, the reserve the example's one Aave position BORROWS.
  "1|0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
]);

{
  const chains = new Map(
    runBookExample.batch.watermarks.map((watermark) => [watermark.engine, watermark.chain_id]),
  );
  const itemized = new Set(
    runBookExample.engines.flatMap((engine) =>
      ["before", "after"].flatMap((side) =>
        engine[side].collateral_by_asset.map((entry) =>
          responseKey(chains.get(engine.engine), entry.asset),
        ),
      ),
    ),
  );
  const derived = new Set(
    [...runBookExample.applied_shocks, ...runBookExample.held_flat]
      .map((entry) => responseKey(entry.chain_id, entry.asset))
      .filter((key) => !itemized.has(key)),
  );
  for (const key of derived) {
    if (!EXAMPLE_BORROWED_RESERVE_KEYS.has(key)) {
      fail(
        `the contract's run-book 200 example now discloses an un-itemized price input for ${key}, ` +
          `which is NOT one of the frozen borrowed reserves — an exemption may not grow by ` +
          `derivation: name it above with its provenance, or explain why the body should itemize it`,
      );
    }
  }
  for (const key of EXAMPLE_BORROWED_RESERVE_KEYS) {
    if (!derived.has(key)) {
      fail(
        `the frozen borrowed reserve ${key} is no longer an un-itemized price input of the ` +
          `contract's run-book 200 example — the exemption now covers a hole that is not there`,
      );
    }
  }
}

const COLLISION_DECLARED = {
  unitemizedInputs: EXAMPLE_BORROWED_RESERVE_KEYS,
  holdings: collision.holdings,
  anchor: COLLISION_ANCHOR,
  derivation: collisionDerivation(
    "run-book.collateral-collision",
    COLLISION_COUNTED_AMOUNT,
    COLLISION_NOT_COUNTED_AMOUNT,
  ),
};

checkResponse("run-book.collateral-collision", collision.response, COLLISION_DECLARED);
const COLLISION_SWAP_DECLARED = {
  unitemizedInputs: EXAMPLE_BORROWED_RESERVE_KEYS,
  holdings: collisionSwap.holdings,
  anchor: COLLISION_ANCHOR,
  derivation: collisionDerivation(
    "run-book.collateral-collision.swap",
    COLLISION_SWAP_COUNTED_AMOUNT,
    COLLISION_SWAP_NOT_COUNTED_AMOUNT,
  ),
};

checkResponse("run-book.collateral-collision.swap", collisionSwap.response, COLLISION_SWAP_DECLARED);

// --- THE ROUND-30 MUTANTS THAT NEED THE COLLIDING PAIR ---------------------
//
// O-Q are the anchor's own sensitivity, and they can only be built here: the
// two-sided swap needs TWO rows that share an asset, and the eth_minus_30 body
// has none. R watches the frozen contract-example exemption refuse to grow.

const COLLISION_SUBJECT = { response: collision.response, declared: COLLISION_DECLARED };

/** The asset both colliding rows claim — the example's own counted weETH. */
const COLLIDING_ASSET = runBookExample.engines
  .find((engine) => engine.engine === "aave_v3_etherfi")
  .before.collateral_by_asset.find((entry) => entry.value_usd !== null).asset;

// O. A TWO-SIDED AMOUNT SWAP. The counted row and the not-counted row trade
// balances, on BOTH sides. Every side-to-side comparison is satisfied — the
// counted row still equals the counted row — the counted VALUE never moves, so
// `total_collateral_usd` still sums exactly, and the book now says the account
// counts 5 weETH toward collateral and leaves 2 out. The anchor is the only
// thing in the file that knows which balance belongs to which disclosure.
refuses(
  "O: a two-sided amount swap — the colliding rows trade balances on BOTH sides",
  `serves amount "${COLLISION_NOT_COUNTED_AMOUNT}" for aave_v3_etherfi|${COLLIDING_ASSET}::counted`,
  (mutant) => {
    for (const side of ["before", "after"]) {
      const rows = mutant.engines.find((engine) => engine.engine === "aave_v3_etherfi")[side]
        .collateral_by_asset;
      const counted = rows.find((entry) => entry.value_usd !== null);
      const notCounted = rows.find((entry) => entry.value_usd === null && entry.unpriced === false);
      [counted.amount, notCounted.amount] = [notCounted.amount, counted.amount];
    }
  },
  COLLISION_SUBJECT,
);

// P. A ONE-SIDED UNPRICED FLAG FLIP. `unpriced` does not enter the disclosure
// key while `value_usd` is non-null, so flipping it on the counted row changes
// no key, no sum and no ratio — it only changes what the row SAYS about whether
// its balance has a price witness. Before the anchor, no law read the field.
refuses(
  "P: a one-sided unpriced flag flip — the after-side counted row claims no price witness",
  `serves unpriced true for aave_v3_etherfi|${COLLIDING_ASSET}::counted`,
  (mutant) => {
    const aave = mutant.engines.find((engine) => engine.engine === "aave_v3_etherfi");
    aave.after.collateral_by_asset.find((entry) => entry.value_usd !== null).unpriced = true;
  },
  COLLISION_SUBJECT,
);

// Q. A ONE-SIDED NOTE EDIT. The note is the sentence the page RENDERS beside the
// number — `runCollateralCounted`'s own words — and it was pinned by nothing.
refuses(
  "Q: a one-sided note edit — the after-side counted row's disclosure sentence rewritten",
  `serves note "COUNTED: trust me." for aave_v3_etherfi|${COLLIDING_ASSET}::counted`,
  (mutant) => {
    const aave = mutant.engines.find((engine) => engine.engine === "aave_v3_etherfi");
    aave.after.collateral_by_asset.find((entry) => entry.value_usd !== null).note =
      "COUNTED: trust me.";
  },
  COLLISION_SUBJECT,
);

// W. THE HISTOGRAM'S FREE BUCKET. The collision pair's aave side measures ONE
// account, holds it ABOVE the 1.00 edge and ranks NO mover — so its count could
// be moved to any other above-the-edge bucket and every law in the file stayed
// green: the census still totals 1 (`checkSide`), the sub-1.00 region is still
// empty and still equals `eligible_accounts` (`checkSide`), and there is no
// mover whose own rational names a bucket to contradict, because the
// mover-bucket laws simply never run. The account is moved to `>= 2.00` here,
// which claims a health factor at least double the liquidation point. The
// derived census is the only thing in the file that knows where it really sits.
refuses(
  "W: the histogram's free bucket — the collision aave account redrawn above 2.00",
  `counts 0 accounts in hf_histogram bucket "1.05 – 1.10", but the derivation places 1 there`,
  (mutant) => {
    for (const side of ["before", "after"]) {
      const histogram = mutant.engines.find((engine) => engine.engine === "aave_v3_etherfi")[side]
        .hf_histogram;
      const from = histogram.buckets.find((bucket) => bucket.count > 0);
      const to = histogram.buckets.find((bucket) => bucket.upper_wad === null);
      to.count += from.count;
      from.count = 0;
    }
  },
  COLLISION_SUBJECT,
);

// R IS DELETED (Wave W-EX-A), WITH THE EXEMPTION IT WATCHED.
//
// It probed a recorded exemption WIDENING: the licence for the contract
// example's undisclosed held prices used to be recomputed from the example, so a
// new priced holding in `api/openapi.yaml` arrived pre-forgiven. The licence is
// gone — the repaired example discloses every price it holds — and a mutant that
// widens an exemption that does not exist proves nothing. It is named here
// rather than silently removed, because a deleted probe is a law nobody is
// watching any more and that is worth reading.

// --- WAVE W-BS-G: THE AUTHORITY FILE, AND THE CARRY THAT OUTLIVES ITS DEFECT -

// AD. THE SOURCE ITSELF MOVED. This is round 32's third finding reproduced
// against the real file rather than a clone: `FROZEN_RUNBOOK_EXAMPLE` used to
// re-read the same bytes GENERATION reads, so ONE edit to
// `run-book.weeth_market_depeg_oracles_held.json` moved both pens at once — a
// +100000000 on both baseline debt totals sailed through, because the body's
// total and the derivation's expected total were the same number read twice.
//
// The probe writes the moved bytes to disk, runs the freeze, restores the
// original bytes in a `finally`, and then RE-VERIFIES the md5 — a probe that
// leaves a committed artifact edited would be a worse defect than the one it
// tests.
const AUTHORITY_FILE = "run-book.weeth_market_depeg_oracles_held.json";
const authorityPath = path.join(here, AUTHORITY_FILE);
const authorityBytes = readFileSync(authorityPath);
const authorityDigest = createHash("md5").update(authorityBytes).digest("hex");

{
  const moved = JSON.parse(authorityBytes.toString("utf8"));
  for (const engine of moved.engines) {
    for (const side of ["before", "after"]) {
      engine[side].total_debt_usd = (BigInt(engine[side].total_debt_usd) + 100_000_000n).toString();
    }
  }
  let refused = null;
  try {
    writeFileSync(authorityPath, `${JSON.stringify(moved, null, 2)}\n`);
    refused = refusalFrom(() => freezeExampleBaseline(read(AUTHORITY_FILE)));
  } finally {
    writeFileSync(authorityPath, authorityBytes);
  }
  const restored = createHash("md5").update(readFileSync(authorityPath)).digest("hex");
  if (restored !== authorityDigest) {
    fail(
      `the authority-file probe did not restore ${AUTHORITY_FILE}: md5 is now ${restored} but the ` +
        `committed bytes digest ${authorityDigest} — restore it from git before doing anything else`,
    );
  }
  recordRefusal(
    "AD: the authority file moved — +100000000 on both baseline debt totals, on disk",
    "example aave_v3_etherfi before total_debt_usd is 600000000000, but the committed source it " +
      "was frozen from now reads 600100000000",
    refused,
  );
}

// AE AND AF ARE DELETED (Wave W-EX-A), WITH THE TWO CARRIES THEY WATCHED.
//
// Each probed one recorded histogram carry DISCHARGING: AE moved the example's
// aave account from `1.10 - 1.25` to the `1.05 - 1.10` its own /v1/params
// threshold puts it in, AF moved the Debt Manager's from `0.90 - 1.00` to the
// `< 0.90` its own collateral and threshold put it in, and each asserted that
// `carriedCensus` then demanded its carry's deletion. The repair made both moves
// REAL: the captured example draws both accounts where the arithmetic does, both
// carries fired for real, and both were deleted. There is no carry left for
// either probe to discharge, and `censusMoved` - which existed only to build
// them - goes with them.

// --- WAVE W-BS-H: ONE MUTANT PER NEW LAW FAMILY ----------------------------
//
// The completeness law, its own register, the response anchor, the four new
// cross-field laws, the tightened census and the repaired bucket. Each is
// refused for a reason unique to it, which the register at the end proves.

// AK. THE DISCLOSED DEFINITION EMPTIED (law 13, residual A.7). The body keeps
// every applied shock, every moved price and every aggregate, and publishes
// `shocks: []` — "nothing was shocked" — beside them. Every propagation law read
// the COMMITTED registry, so all thirteen of them stayed green over a page whose
// own headline said the scenario did nothing.
refuses(
  "AK: the disclosed definition emptied — a 70/100 book that says it shocked nothing",
  'discloses shocks [] but the committed eth_minus_30 registry entry',
  (mutant) => {
    mutant.shocks = [];
  },
);

// AL. THE REGISTER NARROWED (the completeness law, watched as itself). Delete an
// ENUMERATED-UNPINNED entry without pinning the field and the law must fail ON
// THAT FIELD — otherwise the third register is a place to put things to make
// them stop being checked, which is the opposite of what it is for.
refusesGeneration(
  "AL: the ENUMERATED-UNPINNED register narrowed — the completeness law must fail on the freed field",
  'serves served_at = "2026-07-29T10:00:05Z", which is in NO register',
  () =>
    checkCompleteness("probe", ethRunBook, ETH_DECLARED.anchor, {
      derived: RESPONSE_DERIVED_LEAVES,
      anchored: RESPONSE_ANCHORED_LEAVES,
      unpinned: new Map(),
    }),
);

// AM. A FIELD NOBODY NAMED. This is the whole wave in one probe: a body grows a
// leaf — a plausible one, a median the page could render beside the buckets —
// and NO law in this file was written for it, because no law is ever written for
// a field that does not exist yet. Seven waves of this guard were assembled by
// adding a law each time a round broke a field; the completeness law is what
// stops the eighth from being needed.
refuses(
  "AM: a leaf in no register — the body grows a field no law was ever written for",
  'serves engines[0].before.hf_histogram.median_wad = "1080000000000000000", which is in NO register',
  (mutant) => {
    mutant.engines[0].before.hf_histogram.median_wad = "1080000000000000000";
  },
);

// AN. AN ENVELOPE BYTE MOVED (the response anchor, residual class A). `status` is
// how a reader knows the batch is finished. It rode in by object spread through
// seven waves and was read by nothing — so a body could serve every number
// correctly under a batch that says it is still running, or the reverse.
refuses(
  "AN: the batch's own status rewritten — every number correct under a batch that never finished",
  'serves batch.status = "partial", but its declared response ANCHOR pins "complete"',
  (mutant) => {
    mutant.batch.status = "partial";
  },
);

// AO. THE STATED AGE DETACHED FROM THE CLOCK (law 14). `served_at` is the one
// leaf this file leaves free, and `batch.age_seconds` is how stale a reader is
// TOLD the numbers are. A free clock beside a stated age is two disclosures that
// can drift: fifteen minutes of staleness invented over the same two stamps.
refuses(
  "AO: the stated age detached from the clock — fifteen minutes invented over the same two stamps",
  "publishes batch.age_seconds 900, but it was computed at",
  (mutant) => {
    mutant.batch.age_seconds = 900;
  },
);

// AO2. THE SWEEP'S AGE MEASURED FROM THE WRONG STAMP (law 14, the half that had
// no mutant — Wave W-EX-B). Law 14 held `batch.age_seconds` from the day it was
// written; its sweep half was watched by nothing, and it was ALSO measuring from
// the wrong instant. Codex round 35 found the pair: the contract example
// published a 1200-second sweep age over rows stamped 1205 seconds before its
// own `served_at`, and this file derived the same 1200 from `computed_at`, so
// the wrong law and the wrong example each vouched for the other.
//
// 1200 is not an arbitrary wrong number — it is EXACTLY what the old reading
// produced. A mutant that re-injects it is the regression for the whole finding:
// the number this file used to compose must now be refused by name.
refuses(
  "AO2: the sweep's age measured from the compute stamp — the exact number the old law composed",
  "sweep age of 1200 seconds over rows last updated at",
  (mutant) => {
    for (const watermark of mutant.batch.watermarks) {
      if (watermark.sweep !== null) {
        watermark.sweep.age_seconds = 1200;
      }
    }
  },
);

// AP. WITHHELD IN ONE ROSTER, SERVED IN THE OTHER (law 15). This is the
// `run-book.contradictory` shape — an engine named as refused while its numbers
// are served — reproduced inside a GENERATED body, where it must be impossible.
// `checkDerivation` composed `coverage.withheld_engines` alone, so the top-level
// roster beside it answered to nothing.
refuses(
  "AP: withheld in one roster and served in the other — the contradictory shape, generated",
  "names [debt_manager] in excluded_engines but [] in coverage.withheld_engines",
  (mutant) => {
    mutant.excluded_engines = [
      { engine: "debt_manager", code: "FLAG_CUSTODY_UNPROVEN", reason: "custody unproven" },
    ];
  },
);

// AQ. A REALIZATION AXIS THE SCENARIO DOES NOT HAVE (law 16). `market_realization`
// is the shortfall a liquidator would eat, and the contract says it is present
// "when the scenario carries a market-realization axis". eth_minus_30 carries
// none — its committed registry entry has no `market_realizations` — so this body
// publishes null on both engines. Grafting the example's realization onto it
// invents a whole second output axis for a scenario that has no such axis, and
// every law in the file read green.
refuses(
  "AQ: a realization axis grafted on — a shortfall for a scenario with no shortfall axis",
  "serves market_realization an object, but the committed eth_minus_30 registry entry carries 0",
  (mutant) => {
    mutant.engines[0].market_realization = {
      hfs_unchanged: true,
      execution_shortfall_usd: "40000000000",
      bad_debt_at_liquidation_usd: "0",
      usd_decimals: 8,
      seizure_model: "pro-rata-over-counted-collateral",
      note: "grafted",
    };
  },
);

// AR. THE SENTENCE RE-FROZEN AROUND THE WRONG NUMERAL (law 17, residual A.1).
//
// The note is ANCHORED and `usd_decimals` is DERIVED, so both halves of the
// engine's scale are pinned — separately, which is the gap. This probe is the
// way that drift actually happens: a later wave edits the note's wording, the
// digest is re-frozen to whatever the template now emits, and nobody reads the
// numeral. The anchor is therefore given the FALSIFIED sentence to pin, so it
// passes; the derivation still composes 8, so it passes; and law 17 is the only
// thing left that can notice the page is telling a reader to read the aave
// engine's 8-decimal money at 18 decimals.
const FALSIFIED_DECIMALS_NOTE = engineNote(8).replace("8-decimal", "18-decimal");

refuses(
  "AR: the note re-frozen around the wrong numeral — the scale stated twice, disagreeing",
  "publishes usd_decimals 8 while its own note calls the unit 18-decimal",
  (mutant) => {
    mutant.engines[0].note = FALSIFIED_DECIMALS_NOTE;
    return {
      anchor: new Map(ETH_DECLARED.anchor).set(
        "engines[0].note",
        text(
          createHash("sha256").update(FALSIFIED_DECIMALS_NOTE, "utf8").digest("hex").slice(0, 16),
          FALSIFIED_DECIMALS_NOTE.slice(0, 44),
        ),
      ),
    };
  },
);

// AS. THE REFUSAL COUNT READ FROM THE OTHER END. AA edits a BODY to publish
// refusals nothing refused; this doctors the DERIVATION to expect a refusal the
// honest body does not carry. The two directions are different failures of the
// same law — a body that under-reports its refused rows is as wrong as one that
// invents them — and only one of them is reachable by editing a body.
//
// Its number moved in Wave W-EX-A. It used to expect 1 against a body that
// served 0; every body this file writes now serves 1, because the repaired
// contract example's book carries one batch-refused row per engine, so the probe
// expects 2 to stay a probe at all.
refusesGeneration(
  "AS: the derivation expects a refusal the body does not carry — the second reading, still watched",
  "publishes an hf_histogram refused_count of 1, but the derivation composes 2",
  () =>
    checkDerivation("probe", ethRunBook, {
      ...ETH_DERIVATION,
      engines: ETH_DERIVATION.engines.map((engine) => ({
        ...engine,
        before: {
          ...engine.before,
          histogram: { ...engine.before.histogram, refused_count: 2 },
        },
      })),
    }),
);

// AT. THE REPAIRED BUCKET MOVED BACK (the sanctioned class-C repair, watched).
//
// The `.swap` body's aave account is drawn where its own money puts it —
// 1200000000000 of collateral against 600000000000 of debt at the committed 8100
// bps is 1.62, the `1.50 – 2.00` bucket. This puts it back in the `1.10 – 1.25`
// the fixture carried before this wave, which is the census of a book with 2
// weETH in it and not 3. The carry is CONDITIONAL now, so the derivation places
// this side itself and is the only thing in the file that knows the difference
// between the example's money and this generator's.
refuses(
  "AT: the repaired bucket moved back — the swap body redrawn on the example's collateral",
  'counts 1 accounts in hf_histogram bucket "1.10 – 1.25", but the derivation places 0 there',
  (mutant) => {
    for (const side of ["before", "after"]) {
      const histogram = mutant.engines.find((engine) => engine.engine === "aave_v3_etherfi")[side]
        .hf_histogram;
      histogram.buckets.find((bucket) => bucket.label === "1.50 – 2.00").count = 0;
      histogram.buckets.find((bucket) => bucket.label === "1.10 – 1.25").count = 1;
    }
  },
  { response: collisionSwap.response, declared: COLLISION_SWAP_DECLARED },
);

// --- WAVE W-BS-I: THE REALIZATION AXIS'S MONEY, WATCHED ---------------------
//
// One helper so the same engine is reached the same way in every probe below.
const engineOfMutant = (mutant, engineName) =>
  mutant.engines.find((engine) => engine.engine === engineName);

// AU. THE STALE CARRIED FIGURE — Codex round 33's exact shape, restored. The
// aave engine's before side counts ONE account and finds NONE of it liquidatable,
// and the body publishes $400 of execution shortfall over it, which
// `LabRealization` renders in the `crit` tone. Every law in this file read green
// for seven waves, because the number was ANCHORED to the contract example's own
// bytes and the example's book is not this body's book.
refuses(
  "AU: the stale carried shortfall — a critical shortfall over a book with nothing liquidatable",
  "zero eligible accounts, zero aggregate realization shortfall",
  (mutant) => {
    engineOfMutant(mutant, "aave_v3_etherfi").market_realization.execution_shortfall_usd =
      "40000000000";
  },
  COLLISION_SUBJECT,
);

// AV. A DERIVED FIELD FALSIFIED. The Debt Manager's ONE account IS liquidatable,
// and the committed realization axis DISCOUNTS its weETH to 0.95 — so its
// collateral realizes 3800000000 of the 4000000000 it is marked at, and the bad
// debt at liquidation is 4620000000 - 3800000000 = 820000000: a real $820 the
// protocol is not seeing. The defective contract example published 0 for it;
// this puts the 0 back, and the refusal has to name BOTH numbers.
//
// The figure moved in Wave W-EX-A, and the move is the repair. The old example
// carried the MAINNET weETH address on chain 10, which the realization axis does
// not name there, so this account realized at PAR and the derivation composed
// 620000000. The repaired example carries the Debt Manager's real weETH, the
// axis discounts it, and the served body says 820000000.
refuses(
  "AV: a derived realization field falsified — the liquidatable account's bad debt zeroed",
  'publishes market_realization.bad_debt_at_liquidation_usd "0", but the derivation composes "820000000"',
  (mutant) => {
    engineOfMutant(mutant, "debt_manager").market_realization.bad_debt_at_liquidation_usd = "0";
  },
  COLLISION_SUBJECT,
);

// AW. THE COMPUTED ASSERTION DEMOTED TO A CARRIED BYTE. `hfs_unchanged` is
// production's own bit-for-bit health comparison — computed, not promised
// (internal/risk/shortfall.go:21-28). A body serving `false` claims that guard
// FIRED: that a market realization moved an oracle. That is a statement about the
// library, and no frozen envelope byte can be the thing that decides it.
refuses(
  "AW: hfs_unchanged flipped — the body claims a market realization moved an oracle",
  "publishes market_realization.hfs_unchanged false, but the derivation composes true",
  (mutant) => {
    engineOfMutant(mutant, "aave_v3_etherfi").market_realization.hfs_unchanged = false;
  },
  COLLISION_SUBJECT,
);

// AX. THE SHORTFALL READ AT ANOTHER ENGINE'S SCALE. Debt Manager money is
// 6-decimal and aave money is 8; a realization block claiming 8 on the Debt
// Manager's row renders $620.00 of bad debt as $6.20. The engine's OWN
// `usd_decimals` is untouched, so nothing else in the body disagrees with itself
// and law 17 never sees it — the block used to be pinned only positionally, to
// whatever the example's second engine happened to carry.
refuses(
  "AX: the realization read at the other engine's scale — the Debt Manager's shortfall at 8 decimals",
  "publishes market_realization.usd_decimals 8, but the derivation composes 6",
  (mutant) => {
    engineOfMutant(mutant, "debt_manager").market_realization.usd_decimals = 8;
  },
  COLLISION_SUBJECT,
);

// AY. A PROJECTION INVENTED (law 18). `projection` was ANCHORED to "the contract
// example's own NULL", which pins the field on bodies whose example carried null
// and says nothing about WHOSE null it is. eth_minus_30 carries no projection
// axis, and the aave engine could not carry one even if it did — a rate horizon
// belongs to the Debt Manager alone. This is round 33's misclassification in its
// other form, and it is refused by the committed registry rather than by a pin.
refuses(
  "AY: a projection invented — a rate horizon on an engine with no rate, under a scenario with no rate axis",
  "serves projection an object, but the committed eth_minus_30 registry entry carries no projection axis",
  (mutant) => {
    mutant.engines[0].projection = {
      horizon_seconds: 2592000,
      debt_usd: "6000000000",
      projected_usd: "6100000000",
    };
  },
);

// AZ. THE CORRECTED CENSUS ARITHMETIC, WATCHED (Wave W-EX-A).
//
// `checkSide`'s account invariant is `buckets + infinite === accounts` — the
// accounts a side actually MEASURED — with `refused_count` counted OUTSIDE it,
// because production's `measureRunBook` increments `accounts` only over the run
// and adds the refusals afterwards. W-BS-H had it as `buckets + infinite +
// refused === accounts` and nothing could tell the two apart while every body
// here served `refused_count: 0`.
//
// This is the probe that tells them apart: it adds ONE account to a bucket and
// touches nothing else. Under the corrected law it is refused immediately —
// two accounts placed where the side says it measured one. Under W-BS-H's
// reading the same edit was refused too, so the probe alone does not separate
// them; what separates them is that this file's bodies now carry a NONZERO
// `refused_count`, and the old law would have failed on the honest body before
// any mutant reached it.
refuses(
  "AZ: a bucket grown by one — a distribution that places more accounts than the side measured",
  "histogram measures 2 != accounts 1 — 2 placed in buckets + 0 unbounded IS the set of accounts",
  (mutant) => {
    const aave = engineOfMutant(mutant, "aave_v3_etherfi");
    for (const side of ["before", "after"]) {
      aave[side].hf_histogram.buckets.find((bucket) => bucket.count > 0).count += 1;
    }
  },
  COLLISION_SUBJECT,
);

write("run-book.collateral-collision.json", collision.response);
write("run-book.collateral-collision.swap.json", collisionSwap.response);

// --- THE MUTANT REGISTER: every expected sentence belongs to ONE law --------
//
// Codex round 30 found no substring collision among the nine mutants that
// existed then, and this is what keeps it true as the set grows. A mutant's
// expected sentence proves its law only if no OTHER mutant's refusal contains
// it: two mutants trading refusals would both still read green.
for (const mutant of MUTANTS) {
  const alsoIn = MUTANTS.filter(
    (other) => other !== mutant && other.refused.includes(mutant.expected),
  );
  if (alsoIn.length > 0) {
    fail(
      `the expected sentence for ${mutant.what} is NOT unique to its law — it also appears in the ` +
        `refusal of ${alsoIn.map((other) => other.what).join("; ")}`,
    );
  }
}
console.log(
  `checked ${String(MUTANTS.length)} mutants — each refused, each for a reason unique to its law`,
);

// --- THE CLOCK CENSUS -------------------------------------------------------
//
// Last, because it counts what every `write` above found. See the block beside
// `write` for the law, and LIMIT (ii) for exactly how far it reaches.
checkClockCensus();
console.log(
  `checked ${String(CLOCK_TRIOS_TOTAL)} stamp/age trios — every stated age answers to the stamps beside it`,
);
