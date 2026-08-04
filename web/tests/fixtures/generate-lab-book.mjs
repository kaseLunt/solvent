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
//       — is `served_at - computed_at`, and the sweep's own age is measured from
//       the compute stamp. `served_at` is the one leaf this file leaves free, and
//       a free clock beside a stated age is two disclosures that can drift.
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
//     A FINDING RECORDED HERE RATHER THAN FIXED (Wave W-BS-D). These two carry
//     the contract's run-book 200 example verbatim, and that example serves
//     `applied_shocks: []` AND `held_flat: []` while itemizing priced weETH on
//     two chains. Its scenario, `weeth_market_depeg_oracles_held`, has
//     `propagation: []` and no `projection` in the committed registry — so
//     production runs `ApplyScenario`, holds every one of those price inputs
//     flat, and NAMES them. The example's empty `held_flat` is a disclosure the
//     server could not produce. It is a defect in `api/openapi.yaml`, not in
//     this file, and item 2's discipline forbids rewriting the contract's bytes
//     to satisfy a law — so the guard's completeness law (11) takes an
//     ENUMERATED exemption for exactly those two keys. Wave W-BS-E FROZE them
//     as literals: the example's priced holdings are fingerprinted and asserted
//     equal to what round 30 reviewed, so the exemption cannot widen when the
//     example moves, and it is refused outright once the example DISCLOSES what
//     it forgives — which is what makes the banked contract repair
//     self-enforcing. The eth_minus_30 body, whose disclosures this generator
//     composes itself, takes none.
//
//     ONE DEFECT IN THIS PAIR WAS THIS FILE'S OWN, AND WAVE W-BS-H REPAIRED IT.
//     The `.swap` body restates the counted balance at 3 weETH — 1200000000000
//     against the same 600000000000 of debt — and carried the example's
//     `1.10 – 1.25` census unchanged. At the committed 8100 bps that account sits
//     at 1200/600 x 0.81 = 1.62, the `1.50 – 2.00` bucket; even the example's OWN
//     implied 8250-9375 bps would put 3 weETH at 1.65 or above. No threshold
//     reconciles them, so the census was falsifiable with NO reference to the
//     recorded example defect — which is what tells the two apart. The COLLISION
//     body carries the example's own money (2 weETH, 800000000000) and its census
//     is the example's book, still carried, still recorded. The `.swap` body
//     carries money THIS GENERATOR restated, and a census describing a book it
//     does not serve. The carry is conditional now — a carry records a defect in
//     the EXAMPLE'S OWN BOOK, and a body that restates the book is not that book
//     — so the swap side takes the derived placement and its four histogram bytes
//     were regenerated to match. Mutant AT moves them back.
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
//       ordered. They are SUPERSESSION inputs, and the point is a body identical
//       in everything but the batch it was measured at. `batch.id` and
//       `computed_at` are ANCHORED on the three bodies the completeness law
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
// AND THAT IS THE WHOLE LIST. After this wave, the ways to change what an honest
// user sees without failing generation are exactly (i) and (ii). There is no
// third: the completeness law leaves no leaf unclaimed on a guarded body, and
// every register entry resolves to arithmetic over frozen inputs, to a frozen
// pin over a committed source, or to a written-down reason.
//
// YAML parsing uses the client package's own pinned `yaml` devDependency
// (installed by `scripts/ensure-client.mjs`) — no new web dependency.

import { createHash } from "node:crypto";
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
 *   3. IT COLLIDES WITH NOTHING. The example's Debt Manager side already carries
 *      0xCd5f… (the mainnet weETH address) and the matrix does not describe that
 *      address ON CHAIN 10 — the DM's weETH is 0x5A7f… there — so the example's
 *      own entry is HELD FLAT by the matrix, exactly as its own bytes hold it.
 *      No entry has to claim two price paths and no (asset, disclosure) key
 *      repeats.
 *
 * The symbol is READ from the propagation row, not invented: the registry names
 * this one, so serving it is disclosure rather than fabrication.
 */
const DM_FLIP_ASSET = "0x4200000000000000000000000000000000000006";
const DM_FLIP_ASSET_DECIMALS = 18;
const DM_FLIP_AMOUNT = 2_500_000_000_000_000_000n; // 2.5 tokens at 18 decimals
const DM_FLIP_PRICE_BEFORE = 1_000_000_000n; // $1,000.000000 in the DM's 6-dec USD

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

// THE COLLISION CHECK. The invented balance may not land on an asset the
// example's Debt Manager side already carries: one asset at one price moves by
// one factor, so a second entry for it would be two rows claiming one identity —
// and folding the balance in would make the merged entry claim a price path the
// example's own bytes contradict.
for (const side of ["before", "after"]) {
  for (const entry of runBookExample.engines.find((e) => e.engine === "debt_manager")[side]
    .collateral_by_asset) {
    if (entry.asset.toLowerCase() === DM_FLIP_ASSET.toLowerCase()) {
      fail(
        `the example's debt_manager ${side} side already carries ${DM_FLIP_ASSET}; ` +
          `the invented balance would collide with it`,
      );
    }
  }
}

const TOKEN_UNIT = 10n ** BigInt(DM_FLIP_ASSET_DECIMALS);

/** floor(amount × price / 10^decimals) — the Debt Manager's own valuation. */
const dmValue = (amount, price) => (amount * price) / TOKEN_UNIT;

const DM_FLIP_PRICE_AFTER = (DM_FLIP_PRICE_BEFORE * FACTOR_NUM) / FACTOR_DEN;
const DM_FLIP_VALUE_BEFORE = dmValue(DM_FLIP_AMOUNT, DM_FLIP_PRICE_BEFORE);
const DM_FLIP_VALUE_AFTER = dmValue(DM_FLIP_AMOUNT, DM_FLIP_PRICE_AFTER);

// floor(value × LT / HUNDRED_PERCENT), per token then summed — one token here.
const DM_FLIP_MAXBORROW_BEFORE = (DM_FLIP_VALUE_BEFORE * DM_LT_NUM) / DM_LT_DEN;
const DM_FLIP_MAXBORROW_AFTER = (DM_FLIP_VALUE_AFTER * DM_LT_NUM) / DM_LT_DEN;

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

// The waterfall's own two measures, over the ONE eligible-after account.
// internal/risk/waterfall.go:96-103.
const DM_FLIP_AT_RISK_AFTER = (() => {
  const seizable = (DM_DELTA * DM_BONUS_NUM) / DM_BONUS_DEN;
  return seizable < DM_FLIP_VALUE_AFTER ? seizable : DM_FLIP_VALUE_AFTER;
})();
const DM_FLIP_BAD_DEBT_AFTER = (() => {
  const recoverable = (DM_FLIP_VALUE_AFTER * DM_BONUS_DEN) / DM_BONUS_NUM;
  return DM_DELTA > recoverable ? DM_DELTA - recoverable : 0n;
})();

/** Clone a histogram, adding `delta` to the count of one labelled bucket. */
const withBucket = (histogram, label, delta) => {
  const buckets = histogram.buckets.map((bucket) =>
    bucket.label === label ? { ...bucket, count: bucket.count + delta } : bucket,
  );
  if (buckets.every((bucket, index) => bucket.count === histogram.buckets[index].count)) {
    console.error(`generate-lab-book.mjs: no bucket labelled ${label} in the run-book example`);
    process.exit(1);
  }
  return { ...histogram, buckets };
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
 * buckets + infinite + refused — the SERVER'S OWN account invariant (Wave
 * W-BS-H, residual class E).
 *
 * `p5_runbook.go:418-430, 578-583` adds a covered engine's unrebuildable
 * positions to `refused_count` on BOTH sides, and `handlers.go:700-714` counts
 * them in `accounts` all the same: a position this layer could not rebuild is
 * still a position the run measured over. The old reading was `buckets +
 * infinite`, which is correct only while `refused_count` is zero — and it is
 * zero on every body this file writes, which is exactly why the arithmetic was
 * never questioned. A law that happens to be true is not a law; the moment a
 * fixture carries a refusal, `buckets + infinite` would have quietly demanded
 * that `accounts` UNDERCOUNT the run by the refused rows.
 */
const census = (histogram) =>
  histogram.buckets.reduce((sum, bucket) => sum + bucket.count, 0) +
  histogram.infinite_count +
  histogram.refused_count;

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
  if (census(side.hf_histogram) !== side.accounts) {
    const histogram = side.hf_histogram;
    const placed = histogram.buckets.reduce((sum, bucket) => sum + bucket.count, 0);
    fail(
      `${name} histogram census ${String(census(histogram))} ` +
        `!= accounts ${String(side.accounts)} — ${String(placed)} placed in buckets + ` +
        `${String(histogram.infinite_count)} unbounded + ${String(histogram.refused_count)} ` +
        `refused IS the set of accounts this side measured`,
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
//                 RECORDED, NOT FIXED: `runMeasure.wire` (p5_runbook.go:298-311)
//                 composes `histogramComparator`'s note PLUS an eligible-edge
//                 clause and an `infinite_count`/`refused_count` paragraph, so
//                 the LIVE server's sentence is strictly longer than the one
//                 `api/openapi.yaml`'s example carries. Two committed artifacts
//                 disagree and the example's bytes are what every body here
//                 rides on; item 2's discipline forbids rewriting them to
//                 satisfy a law. So the EXAMPLE's sentence is what is frozen,
//                 and the divergence joins the `held_flat: []` defect and the
//                 aave histogram defect in this file's contract-defect ledger.
const FROZEN_ENGINE_SERIALIZATION = {
  aave_v3_etherfi: {
    usd_decimals: 8,
    comparator: "hf_wad",
    note:
      "buckets are the pool's own health-factor WAD. This is ONE SIDE of the shock, in the SAME " +
      "buckets /v1/book's histogram serves.",
  },
  debt_manager: {
    usd_decimals: 6,
    comparator: "hf_num/hf_den",
    note:
      "the Debt Manager has no health-factor wad: these buckets are the EXACT rational " +
      "maxBorrowLT/borrowings, a disclosure only — take eligibility from `liquidatable`.",
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
      refused_count: 0,
      counts: [0, 0, 0, 0, 1, 0, 0, 0],
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
      refused_count: 0,
      counts: [0, 0, 0, 0, 1, 0, 0, 0],
    },
  },
  debt_manager: {
    before: {
      accounts: 1,
      eligible_accounts: 1,
      total_collateral_usd: "4000000000",
      total_debt_usd: "4620000000",
      eligible_debt_usd: "4200000000",
      collateral_at_risk_usd: "4000000000",
      bad_debt_usd: "239603961",
      infinite_count: 0,
      refused_count: 0,
      counts: [0, 1, 0, 0, 0, 0, 0, 0],
    },
    after: {
      accounts: 1,
      eligible_accounts: 1,
      total_collateral_usd: "4000000000",
      total_debt_usd: "4620000000",
      eligible_debt_usd: "4200000000",
      collateral_at_risk_usd: "4000000000",
      bad_debt_usd: "239603961",
      infinite_count: 0,
      refused_count: 0,
      counts: [0, 1, 0, 0, 0, 0, 0, 0],
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
 * A side's `refused_count` is NOT `refused_in_batch`. `refused_in_batch` counts
 * rows the BATCH refused, which carry no numbers and never reach the run at all
 * (handlers.go:700-703). `refused_count` counts positions on a COVERED engine
 * that THIS LAYER could not rebuild (p5_runbook.go:418-430) — the same rows
 * `coverage.excluded` names one by one and `excluded_by_this_layer` totals — and
 * `p5_runbook.go:578-583` adds them to BOTH sides. So the histogram's refusal
 * count and the coverage census are one census read twice, and the derivation
 * composes the first FROM the second rather than restating it.
 */
const FROZEN_EXAMPLE_EXCLUDED_ENGINES = [];

/** The engines the example WITHHOLDS — frozen as the empty list it is. */
const FROZEN_EXAMPLE_WITHHELD_ENGINES = [];

/** One engine's `refused_count`: the layer's own refusals for it, plus injected. */
const derivedRefusedCount = (engineName, injected) =>
  FROZEN_EXAMPLE_EXCLUDED_ENGINES.filter((name) => name === engineName).length + injected;

/** The frozen bucket SHAPE, in the form `derivedHistogram` reads. */
const FROZEN_HISTOGRAM_SHAPE = {
  wad_scale: FROZEN_WAD_SCALE,
  buckets: FROZEN_HISTOGRAM_EDGES.map(([label, lower_wad, upper_wad]) => ({
    label,
    lower_wad,
    upper_wad,
  })),
};

/** One engine/side's frozen CARRIED census, in the form `derivedHistogram` reads. */
const frozenCarried = (engineName, side) => {
  const frozen = FROZEN_EXAMPLE_BASELINE[engineName][side];
  return {
    infinite_count: frozen.infinite_count,
    buckets: FROZEN_HISTOGRAM_EDGES.map(([label], index) => ({ label, count: frozen.counts[index] })),
  };
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
  ["batch.watermarks[0].engine", "aave_v3_etherfi"],
  ["batch.watermarks[0].chain_id", 1],
  ["batch.watermarks[0].last_block", 25635618],
  ["batch.watermarks[0].acked_epoch", 0],
  ["batch.watermarks[0].max_epoch_at_compute", 0],
  // The aave engine runs no sweep, and NULL is the disclosure that says so.
  ["batch.watermarks[0].sweep", null],
  ["batch.watermarks[1].engine", "debt_manager"],
  ["batch.watermarks[1].chain_id", 10],
  ["batch.watermarks[1].last_block", 154796552],
  ["batch.watermarks[1].acked_epoch", 0],
  ["batch.watermarks[1].max_epoch_at_compute", 0],
  ["batch.watermarks[1].sweep.rows", 3],
  ["batch.watermarks[1].sweep.failed", 1],
  ["batch.watermarks[1].sweep.success_sum", "309593004"],
  ["batch.watermarks[1].sweep.max_updated_at", "2026-07-29T09:40:00Z"],
  ["batch.watermarks[1].sweep.generation", 4],
  ["batch.watermarks[1].sweep.generation_open", false],
  ["batch.supersession.superseded", false],
  ["batch.supersession.legs[]", EMPTY_ARRAY],
  ["batch.supersession.note", text("1e2f0c3377fe6271", "a superseded batch is still served: the flag")],
  ["scenario_config_version", "v1"],
  ["label", "weETH market depeg to 0.95 (oracles held)"],
  ["description", text("48897232abf08d4b", "weETH trades 5 percent below its redemption ")],
  ["path_assumption", text("a33afc9e81f1fd0d", "oracle marks held exactly; market value is a")],
  ["out_of_model[0]", text("4b9449973c74d69c", "liquidator liquidity, gas costs, execution l")],
  ["out_of_model[1]", text("79a5a7ac35d4e29f", "seizure is modeled PRO-RATA over a position'")],
  // `excluded_engines[]` is NOT frozen here: law 15 derives it from the withheld
  // roster the derivation composes, so freezing it too would be two registers
  // claiming one leaf — which the completeness law refuses in its own right.
  ["coverage.note", text("90fd6b96c7c44a86", "every position the batch carries reached the")],
  ["notes[0]", text("a11aaae34adb7eeb", "aggregates are per engine in each engine's O")],
  ["engines[0].note", text("0440e01766848af7", "oracle marks held: before and after aggregat")],
  ["engines[0].movers_note", text("e6f51a236a09295d", "RANKED BY HEALTH-FACTOR DROP: before minus a")],
  ["engines[0].projection", null],
  ["engines[0].market_realization.hfs_unchanged", true],
  ["engines[0].market_realization.execution_shortfall_usd", "40000000000"],
  ["engines[0].market_realization.bad_debt_at_liquidation_usd", "0"],
  ["engines[0].market_realization.usd_decimals", 8],
  ["engines[0].market_realization.seizure_model", "pro-rata-over-counted-collateral"],
  ["engines[0].market_realization.note", text("5483193594ac1b43", "market value is NOT an oracle mark: this sce")],
  ["engines[1].note", text("20511f4ce03c0789", "delta-only: zero deltas here are THE FINDING")],
  ["engines[1].movers_note", text("7c127dc90477c0f0", "RANKED BY THE DEBT THAT BECAME ELIGIBLE: onl")],
  ["engines[1].projection", null],
  ["engines[1].market_realization.hfs_unchanged", true],
  ["engines[1].market_realization.execution_shortfall_usd", "200000000"],
  ["engines[1].market_realization.bad_debt_at_liquidation_usd", "0"],
  ["engines[1].market_realization.usd_decimals", 6],
  ["engines[1].market_realization.seizure_model", "pro-rata-over-counted-collateral"],
  ["engines[1].market_realization.note", "same axis, this engine's own 6-decimal USD."],
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
 * A CARRIED CENSUS IS A RECORDED DEFECT, NEVER A DEFAULT (Wave W-BS-G).
 *
 * The collision pair used to hand `derivedHistogram` the example's census as
 * BOTH the shape and the starting counts, for BOTH engines, with no placements
 * at all — a blanket carry. That is a second pen writing down whatever the first
 * one wrote: the only census it can refuse is one that disagrees with the
 * example, and the example is exactly what the body copied.
 *
 * The carry is now narrowed to a LEDGER, one entry per engine, and every entry
 * has to prove it is still owed:
 *
 *   `baselinePlacements`  the rationals this derivation composes for the
 *                         accounts the carried census is supposed to describe,
 *                         from the frozen collateral, threshold and debt.
 *   `addedPlacements`     accounts this generator INJECTS on top of the carried
 *                         baseline, placed by the server's own test as always.
 *
 * If the derivation's own placement AGREES with the carried census, the carry
 * forgives nothing — it is dead licence that would quietly swallow the next
 * discrepancy — so generation STOPS and demands its deletion. That is what makes
 * the recorded contract repair self-enforcing: repair the example's histogram
 * and this file refuses to keep carrying it, exactly as `exampleUndisclosedInputs`
 * refuses to keep forgiving a disclosure the example finally makes.
 */
const carriedCensus = (what, shape, carried, baselinePlacements, addedPlacements, meta) => {
  const alone = derivedHistogram(shape, null, baselinePlacements, meta);
  const agrees =
    alone.infinite_count === carried.infinite_count &&
    alone.buckets.every((bucket) => {
      const entry = carried.buckets.find((other) => other.label === bucket.label);
      return entry !== undefined && entry.count === bucket.count;
    });
  if (agrees) {
    fail(
      `${what}: THE RECORDED HISTOGRAM DEFECT IS REPAIRED — this derivation now places the ` +
        `carried book EXACTLY where the carried census draws it, so the carry forgives nothing ` +
        `and is a licence nothing owes: DELETE the carry and let the derived placement stand`,
    );
  }
  const derivedLabels = alone.buckets
    .filter((bucket) => bucket.count > 0)
    .map((bucket) => `${bucket.label}×${String(bucket.count)}`)
    .join(", ");
  const carriedLabels = carried.buckets
    .filter((bucket) => bucket.count > 0)
    .map((bucket) => `${bucket.label}×${String(bucket.count)}`)
    .join(", ");
  console.log(
    `carried ${what}\n        this derivation places [${derivedLabels || "nothing"}]; the ` +
      `committed census draws [${carriedLabels || "nothing"}] — recorded defect, still owed`,
  );
  return derivedHistogram(shape, carried, addedPlacements, meta);
};

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
      // engine THIS LAYER could not rebuild, added to both sides — the same rows
      // `coverage.excluded` names — so it is composed from the refusal census
      // rather than restated. A count with no excluded row behind it invents
      // positions the run never saw.
      if (gotHistogram.refused_count !== wantHistogram.refused_count) {
        fail(
          `${label} ${side} publishes an hf_histogram refused_count of ` +
            `${JSON.stringify(gotHistogram.refused_count)}, but the derivation composes ` +
            `${String(wantHistogram.refused_count)} from the run's own refusal census — a refused ` +
            `position is a row of coverage.excluded, and this side counts rows nobody excluded`,
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
 *      TWO EXEMPTIONS, both ENUMERATED by the caller, neither a blanket:
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
 *        `undisclosedInputs` — A RECORDED DEFECT, not a licence. The contract's
 *        OWN run-book 200 example serves `applied_shocks: []` and
 *        `held_flat: []` while itemizing priced weETH on two chains under
 *        `weeth_market_depeg_oracles_held`, whose committed propagation matrix
 *        is EMPTY and which carries no `projection` — so `ApplyScenario` runs,
 *        holds every one of those inputs flat, and production's own body would
 *        SAY SO. The example's disclosure is incomplete. This generator has no
 *        standing to rewrite the contract, so the two bodies that carry it
 *        verbatim (the collision pair, item 12) declare exactly those keys — as
 *        FROZEN LITERALS asserted equal to the example's own derivation, for
 *        the reason the write site sets out. The eth_minus_30 body composes its
 *        own disclosures, declares NOTHING, and owes this law in full.
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
  { unitemizedInputs = new Set(), undisclosedInputs = new Set(), holdings } = {},
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
  // LAW 11's SECOND EXEMPTION, at the point of use. `undisclosedInputs` forgives
  // a disclosure the body DOES NOT MAKE. A key the body discloses is one the
  // exemption no longer covers, and a licence outliving the defect it records is
  // how the next hole gets forgiven without anybody reading it.
  const disclosedHere = new Set(
    [...response.applied_shocks, ...response.held_flat].map((entry) =>
      responseKey(entry.chain_id, entry.asset),
    ),
  );
  for (const key of undisclosedInputs) {
    if (disclosedHere.has(key)) {
      fail(
        `${name} declares ${key} an UNDISCLOSED price input while DISCLOSING it — the exemption ` +
          `records a defect this body no longer has, so it forgives nothing and hides the next one`,
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
          if (!undisclosedInputs.has(key)) {
            fail(
              `${label} counts a PRICED ${before.asset} that the committed matrix does not ` +
                `describe, so ApplyScenario would have RECORDED IT ON HeldFlat — but ${name} ` +
                `discloses no held_flat entry for ${key}`,
            );
          }
          continue;
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
  ["batch.watermarks[].sweep.age_seconds", "law 14: computed_at minus the sweep's own max_updated_at"],

  ["engines[].engine", "checkDerivation: the engine set is the derivation's, in order"],
  ["engines[].usd_decimals", "checkDerivation: the serializer's own frozen constant"],
  ["engines[].market_realization", "law 16: NULL exactly when the committed scenario carries no market-realization axis"],
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
  ["engines[].projection", { by: "response", why: "the contract example's own NULL — this file composes no projection" }],
  ["engines[].market_realization.hfs_unchanged", { by: "response", why: "the contract example's own realization axis" }],
  ["engines[].market_realization.execution_shortfall_usd", { by: "response", why: "the contract example's own shortfall" }],
  ["engines[].market_realization.bad_debt_at_liquidation_usd", { by: "response", why: "the contract example's own figure" }],
  ["engines[].market_realization.usd_decimals", { by: "response", why: "the unit that shortfall is READ at" }],
  ["engines[].market_realization.seizure_model", { by: "response", why: "the contract example's own seizure model" }],
  ["engines[].market_realization.note", { by: "response", why: "the contract example's own realization sentence" }],

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
      "batch.age_seconds answer to it.",
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
  // LAW 14: THE BATCH'S OWN CLOCK IS COHERENT (Wave W-BS-H). `served_at` is the
  // one leaf this file leaves free, and a free clock beside a stated age is two
  // disclosures that can drift: `batch.age_seconds` is how STALE a reader is
  // told the numbers are, and it is `served_at - computed_at`. The sweep's own
  // age is measured from the COMPUTE stamp instead, because a sweep's staleness
  // is a property of the batch and not of when somebody asked for it. Both
  // identities hold to the second in the contract's own example, which is the
  // provenance for reading them as the server's arithmetic rather than as
  // decoration.
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
    const sweepAge = seconds(watermark.sweep.max_updated_at, response.batch.computed_at);
    if (watermark.sweep.age_seconds !== sweepAge) {
      fail(
        `${name} publishes a ${watermark.engine} sweep age of ` +
          `${String(watermark.sweep.age_seconds)} seconds over rows last updated at ` +
          `${watermark.sweep.max_updated_at} for a batch computed at ${response.batch.computed_at}, ` +
          `which is ${String(sweepAge)} — a sweep's staleness is measured from the COMPUTE stamp`,
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

/** A ONE-ACCOUNT histogram, rebuilt so the census sits where the rational lands. */
const histogramForOneRational = (histogram, num, den) => {
  if (census(histogram) !== 1 || histogram.infinite_count !== 0) {
    fail("the example's aave histogram does not census exactly one finite account");
  }
  const label = bucketLabelForRational(histogram, num, den);
  return {
    ...histogram,
    buckets: histogram.buckets.map((bucket) => ({
      ...bucket,
      count: bucket.label === label ? 1 : 0,
    })),
  };
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

const ethAaveEngine = {
  ...aaveExample,
  before: aaveBefore,
  after: aaveAfter,
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
const dmHeldEntries = dmExample.before.collateral_by_asset.filter(
  (entry) => entry.value_usd !== null && !propagation.has(responseKey(DM_CHAIN, entry.asset)),
);
// The held-flat DEBT MANAGER row is load-bearing twice over: it is the entry
// guard law 11 proves completeness against, and mutants E and H are built by
// deleting and corrupting it. If the example ever stops carrying a priced
// holding the matrix does not describe, those two mutants would be testing
// nothing and must be re-derived rather than quietly passing.
if (dmHeldEntries.length === 0) {
  fail(
    "the run-book example's debt_manager side counts no priced holding the eth_minus_30 matrix " +
      "leaves undeclared, so this body has no held-flat input and law 11 has nothing to prove",
  );
}

const APPLIED_SHOCKS = [
  ...aaveResult.applied_shocks,
  {
    asset: DM_FLIP_ASSET,
    chain_id: DM_CHAIN,
    source: DM_PRICE_SOURCE,
    factor_num: FACTOR_NUM.toString(),
    factor_den: FACTOR_DEN.toString(),
    before: DM_FLIP_PRICE_BEFORE.toString(),
    after: DM_FLIP_PRICE_AFTER.toString(),
    snapped: false,
    base_snapped: false,
    cap_bound: false,
  },
].sort((a, b) =>
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
  // The invented account is a REAL ROW of the batch, so the batch counts it.
  batch: {
    ...runBookExample.batch,
    position_count: runBookExample.batch.position_count + 1,
  },
  coverage: {
    ...runBookExample.coverage,
    batch_positions: runBookExample.coverage.batch_positions + 1,
    in_book: runBookExample.coverage.in_book + 1,
  },
  engines: runBookExample.engines.map((engine) => {
    if (engine.engine === AAVE_ENGINE) {
      return ethAaveEngine;
    }
    if (engine.engine !== "debt_manager") {
      fail(`the run-book example carries an engine this generator does not derive: ${engine.engine}`);
    }
    // The second account must EXIST on both sides before it can flip on one,
    // and it brings its own debt and its own collateral with it.
    const before = {
      ...engine.before,
      accounts: engine.before.accounts + 1,
      total_debt_usd: (BigInt(engine.before.total_debt_usd) + DM_DELTA).toString(),
      total_collateral_usd: (
        BigInt(engine.before.total_collateral_usd) + DM_FLIP_VALUE_BEFORE
      ).toString(),
      collateral_by_asset: byAsset([
        ...engine.before.collateral_by_asset,
        flipCollateralEntry(DM_FLIP_VALUE_BEFORE),
      ]),
      hf_histogram: withBucket(
        engine.before.hf_histogram,
        bucketLabelForRational(engine.before.hf_histogram, DM_FLIP_MAXBORROW_BEFORE, DM_DELTA),
        1,
      ),
    };
    const after = {
      ...engine.after,
      accounts: engine.after.accounts + 1,
      eligible_accounts: engine.after.eligible_accounts + 1,
      eligible_debt_usd: (BigInt(engine.after.eligible_debt_usd) + DM_DELTA).toString(),
      total_debt_usd: (BigInt(engine.after.total_debt_usd) + DM_DELTA).toString(),
      total_collateral_usd: (
        BigInt(engine.after.total_collateral_usd) + DM_FLIP_VALUE_AFTER
      ).toString(),
      collateral_at_risk_usd: (
        BigInt(engine.after.collateral_at_risk_usd) + DM_FLIP_AT_RISK_AFTER
      ).toString(),
      bad_debt_usd: (BigInt(engine.after.bad_debt_usd) + DM_FLIP_BAD_DEBT_AFTER).toString(),
      collateral_by_asset: byAsset([
        ...engine.after.collateral_by_asset,
        flipCollateralEntry(DM_FLIP_VALUE_AFTER),
      ]),
      // The flip IS the account crossing the 1.00 edge — the same event
      // `newly_eligible_accounts` counts, drawn where a reader can see it.
      hf_histogram: withBucket(
        engine.after.hf_histogram,
        bucketLabelForRational(engine.after.hf_histogram, DM_FLIP_MAXBORROW_AFTER, DM_DELTA),
        1,
      ),
    };
    return {
      ...engine,
      before,
      after,
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
 *   debt_manager  the example's own rows PLUS `flipCollateralEntry`, at the
 *                 amount, decimals, symbol and note the invented account is
 *                 constructed with. Its `value_usd` differs per side, which is
 *                 the one thing an anchor does not pin.
 */
const ETH_HOLDINGS = holdingAnchor([
  [AAVE_ENGINE, aaveExample.before.collateral_by_asset],
  [
    "debt_manager",
    [...dmExample.before.collateral_by_asset, flipCollateralEntry(DM_FLIP_VALUE_BEFORE)],
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
  const FROZEN_AAVE_UNPRICED_ASSET = "0x0000000000000000000000000000000000000BAD";
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
  // The Debt Manager's committed weETH configuration: threshold 80/100 and an
  // ADDITIVE 1e18 bonus over HUNDRED_PERCENT = 100e18, i.e. 101/100.
  const FROZEN_DM_LT_NUM = 80n;
  const FROZEN_DM_LT_DEN = 100n;
  const FROZEN_DM_BONUS_NUM = 101n;
  const FROZEN_DM_BONUS_DEN = 100n;
  // PROVENANCE: the example's own debt_manager row and batch watermark.
  const FROZEN_DM_WEETH_ASSET = "0xCd5fE23C85820F7B72D0926FC9b05b43E359b7ee";
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

  const dmItems = derivedItemization(matrix, FROZEN_DM_CHAIN, [
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

  /**
   * One side of the Debt Manager book: the FROZEN BASELINE plus the injected
   * account, whose eligibility is the engine's own STRICT test —
   * `borrowings > maxBorrowLT`, with equality healthy (dm.go:165-166).
   */
  const dmSideDerived = (side) => {
    const baseline = FROZEN_EXAMPLE_BASELINE.debt_manager[side];
    // The baseline's own collateral has to be what the frozen weETH price values
    // its frozen amount at, or the baseline and the price disagree about the
    // same book.
    const baselineCollateral = dmItems[side].values.get(`${FROZEN_DM_WEETH_ASSET}::counted`);
    frozenLiteral(
      `debt_manager BASELINE collateral on the ${side} side`,
      baselineCollateral,
      BigInt(baseline.total_collateral_usd),
    );
    const injected = dmItems[side].values.get(dmFlipKey);
    const maxBorrowLT = (injected * FROZEN_DM_LT_NUM) / FROZEN_DM_LT_DEN;
    const eligible = FROZEN_DM_FLIP_DEBT > maxBorrowLT;
    return {
      values: dmItems[side].values,
      eligible,
      maxBorrowLT,
      // The FROZEN BASELINE's own census, plus the injected account placed by
      // the exact rational maxBorrowLT/borrowings the engine measures it by —
      // the same rational its mover row publishes, so the two cannot disagree
      // about where the account sits and neither can invent a bucket.
      //
      // THE BASELINE HALF IS A RECORDED CARRY, and `carriedCensus` re-proves
      // every run that it is still owed: this derivation places the example's
      // own Debt Manager account by its own frozen collateral, threshold and
      // borrowings, and the census the example draws has to DISAGREE with that
      // placement or the carry is deleted. Full derivation at
      // `RECORDED_DM_BASELINE_RATIONAL` below.
      histogram: carriedCensus(
        `the contract example's debt_manager census (${side} side)`,
        FROZEN_HISTOGRAM_SHAPE,
        frozenCarried("debt_manager", side),
        [recordedDMBaselineRational(side)],
        [[maxBorrowLT, FROZEN_DM_FLIP_DEBT]],
        frozenHistogramMeta("debt_manager", INJECTED_REFUSALS),
      ),
      aggregate: {
        accounts: String(baseline.accounts + 1),
        eligible_accounts: String(baseline.eligible_accounts + (eligible ? 1 : 0)),
        total_collateral_usd: dmItems[side].counted.toString(),
        total_debt_usd: (BigInt(baseline.total_debt_usd) + FROZEN_DM_FLIP_DEBT).toString(),
        eligible_debt_usd: (
          BigInt(baseline.eligible_debt_usd) + (eligible ? FROZEN_DM_FLIP_DEBT : 0n)
        ).toString(),
        collateral_at_risk_usd: (
          BigInt(baseline.collateral_at_risk_usd) +
          (eligible
            ? derivedAtRisk(injected, FROZEN_DM_FLIP_DEBT, FROZEN_DM_BONUS_NUM, FROZEN_DM_BONUS_DEN)
            : 0n)
        ).toString(),
        bad_debt_usd: (
          BigInt(baseline.bad_debt_usd) +
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
  // ONE injected account, so the run's census moves by exactly one row.
  const INJECTED_ACCOUNTS = 1;
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
  // would be a second register claiming one leaf. Only its CHILDREN are
  // anchored, and this body drops them — see FROZEN_ETH_ENVELOPE_DROPPED.
  // Sorted by `${asset}|${chain_id}|${source}`, the server's own disclosure order.
  ["applied_shocks[0].source", "priceproviderv2"],
  ["applied_shocks[0].snapped", false],
  ["applied_shocks[0].base_snapped", false],
  ["applied_shocks[0].cap_bound", false],
  ["applied_shocks[1].source", "aaveoracle:0x43b64f28a678944e0655404b0b98e443851cc34f"],
  ["applied_shocks[1].snapped", false],
  ["applied_shocks[1].base_snapped", false],
  ["applied_shocks[1].cap_bound", false],
  ["held_flat[0].source", "aaveoracle:0x43b64f28a678944e0655404b0b98e443851cc34f"],
  ["held_flat[1].source", "priceproviderv2"],
]);

/**
 * The example's envelope leaves this body does NOT carry.
 *
 * `market_realization` goes from an OBJECT to NULL, so its six leaves stop
 * existing and their pins would otherwise sit on fields that are gone — which
 * the completeness law refuses in its own right ("a body may not drop an
 * envelope field its own source carries"). Dropping them here is the statement
 * that their absence is INTENDED, and law 16 is what proves the intention is
 * the committed scenario's rather than this file's.
 */
const FROZEN_ETH_ENVELOPE_DROPPED = [
  "engines[0].market_realization.hfs_unchanged",
  "engines[0].market_realization.execution_shortfall_usd",
  "engines[0].market_realization.bad_debt_at_liquidation_usd",
  "engines[0].market_realization.usd_decimals",
  "engines[0].market_realization.seizure_model",
  "engines[0].market_realization.note",
  "engines[1].market_realization.hfs_unchanged",
  "engines[1].market_realization.execution_shortfall_usd",
  "engines[1].market_realization.bad_debt_at_liquidation_usd",
  "engines[1].market_realization.usd_decimals",
  "engines[1].market_realization.seizure_model",
  "engines[1].market_realization.note",
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
    mutant.held_flat = [];
    // The W-BS-B revision declared THIS anchor — its own invented row is what it
    // injected — so the mutant is judged against it and refused for law 1, the
    // law it exists to reproduce, rather than for having the wrong provenance.
    const inventedRow = { ...flipCollateralEntry(DM_FLIP_VALUE_BEFORE), asset: INVENTED_ASSET };
    delete inventedRow.symbol;
    return {
      holdings: holdingAnchor([
        [AAVE_ENGINE, aaveExample.before.collateral_by_asset],
        ["debt_manager", [...dmExample.before.collateral_by_asset, inventedRow]],
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

// AA. REFUSALS INVENTED. `refused_count` is positions on a covered engine THIS
// LAYER could not rebuild — the same rows `coverage.excluded` names one by one.
// Raising it to 7 tells a reader that seven positions carried no comparator and
// were held out of the distribution, on a run whose coverage census excludes
// nobody. The claim is a refusal disclosure with no refusal behind it.
refuses(
  "AA: refusals invented — seven positions counted out of a distribution nothing excluded",
  "histogram census 8 != accounts 1 — 1 placed in buckets + 0 unbounded + 7 refused",
  (mutant) => {
    for (const engine of mutant.engines) {
      for (const side of ["before", "after"]) {
        engine[side].hf_histogram.refused_count = 7;
      }
    }
  },
);

// AA MOVED LAWS IN WAVE W-BS-H, and the move is the class-E finding. Until this
// wave `checkSide` read a side's census as `buckets + infinite`, which is right
// only while `refused_count` is zero — and it is zero on every body this file
// writes, so the arithmetic was never questioned. `refused_count` counts
// positions on a COVERED engine this layer could not rebuild, and
// `handlers.go:700-714` counts those in `accounts` all the same: a position the
// run could not rebuild is still a position the run measured over. So the
// invariant is `buckets + infinite + refused === accounts`, and AA — which
// invents seven refusals and moves nothing else — is now refused by the
// ARITHMETIC rather than by the derivation. The old law would have passed it and
// then quietly demanded that `accounts` undercount the run by seven.
//
// The derivation's own `refused_count` law keeps its witness at AQ, below: with
// the census tightened, no BODY edit can reach that law without breaking the
// arithmetic first, so it is probed against a doctored DERIVATION instead.

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
 * THE CENSUS FOLLOWS THE MONEY (Wave W-BS-H, the sanctioned class-C repair).
 *
 * The `.swap` body exists to restate the counted balance, and until this wave it
 * restated the balance and carried the example's DISTRIBUTION unchanged: 3 weETH
 * — 1200000000000 against the same 600000000000 of debt — drawn in `1.10 – 1.25`.
 * That is falsifiable with NO reference to the recorded example defect, and the
 * arithmetic is one line: at the committed 8100 bps the account sits at
 * 1200/600 x 0.81 = 1.62, which is the `1.50 – 2.00` bucket. Even under the
 * example's OWN implied threshold — the 8250-9375 bps its `1.10 – 1.25` on 2
 * weETH would require — 3 weETH lands at 1.65 or above. No threshold anywhere
 * reconciles 3 weETH of that collateral with that bucket.
 *
 * THE DEFECT WAS THIS TRANSFORM'S, NOT THE EXAMPLE'S, and the difference is what
 * licenses the repair. The example itemizes 2 weETH at 800000000000 and draws
 * `1.10 – 1.25`; the collision body carries that money untouched, so its census
 * is the example's own book and its disagreement with /v1/params is the recorded
 * contract defect this file has no standing to fix. The `.swap` body carries
 * money THIS GENERATOR restated and a census it did not — a census describing a
 * book the body does not serve. So the rule is the money's:
 *
 *   a carry records a defect in the EXAMPLE'S OWN BOOK. A body that restates the
 *   book is not that book, and takes the derivation's placement instead.
 *
 * `collisionDerivation` reaches the same rule from its own frozen inputs, in its
 * own arithmetic, and the two must agree.
 */
const collidingHistogram = (aggregate, countedValue) => {
  const carried = BigInt(aggregate.total_collateral_usd);
  const restated = BigInt(countedValue);
  if (restated === carried) {
    return aggregate.hf_histogram;
  }
  // Aave's own health-factor rational, never divided out:
  // sum(collateral x liq_threshold) / (debt x 10000).
  return histogramForOneRational(
    aggregate.hf_histogram,
    restated * AAVE_LT_BPS,
    BigInt(aggregate.total_debt_usd) * BPS,
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
  return {
    response: {
      ...runBookExample,
      engines: runBookExample.engines.map((engine) =>
        engine.engine === "aave_v3_etherfi"
          ? { ...engine, before: side(engine.before), after: side(engine.after) }
          : engine,
      ),
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
 * A RECORDED DEFECT IN THE CONTRACT'S OWN EXAMPLE (guard law 11's second
 * exemption), FROZEN here rather than derived (Codex round 30, HIGH).
 *
 * These two bodies are the run-book 200 example plus one NOT-COUNTED row, and
 * that example serves `applied_shocks: []` AND `held_flat: []` while itemizing
 * priced weETH on two chains. Its scenario is `weeth_market_depeg_oracles_held`,
 * whose committed registry entry carries `propagation: []` and no `projection`
 * — so `cmd/api/p5_runbook.go:462-486` runs `ApplyScenario` over every position,
 * `scenario.go:679-686` records EVERY price input on `HeldFlat` because the
 * matrix describes none of them, and the served body would name all of them.
 * The example's `held_flat: []` is a disclosure production could not produce.
 *
 * The finding is real and it is NOT this generator's to fix: item 2's whole
 * discipline is that the contract's example rides in verbatim and a law the
 * example violates may not be used to rewrite bytes this file has no standing
 * over.
 *
 * WHY IT IS FROZEN AND NOT DERIVED. The first cut RECOMPUTED this set from the
 * example every run, and an exemption recomputed from a mutable source grows
 * with it: add a priced holding to `api/openapi.yaml`'s example and it is
 * exempted before anybody notices there is something new to exempt. So the two
 * defective keys are written below as LITERALS, and the example's own priced
 * holdings are FINGERPRINTED — key, amount, value, decimals, symbol, on BOTH
 * sides of BOTH engines — and asserted equal to what round 30 reviewed. Any
 * added, removed or changed priced holding fails generation until a person has
 * looked at it.
 *
 * THIS MAKES THE BANKED CONTRACT REPAIR SELF-ENFORCING. When `api/openapi.yaml`
 * is fixed — the example given the `held_flat` its own scenario would produce —
 * generation FAILS HERE, because the fingerprint moves and the exemption is no
 * longer owed. That failure is the signal to DELETE this whole block and the
 * `undisclosedInputs` parameter with it, not to re-freeze it.
 */
const EXAMPLE_UNDISCLOSED_KEYS = [
  // The two priced weETH inputs the example itemizes and never discloses:
  // responseKey(1, "0xCd5fE23C85820F7B72D0926FC9b05b43E359b7ee") on the aave
  // engine and responseKey(10, ...) on the Debt Manager's.
  "1|0xcd5fe23c85820f7b72d0926fc9b05b43e359b7ee",
  "10|0xcd5fe23c85820f7b72d0926fc9b05b43e359b7ee",
];

/** Exactly the priced holdings round 30 reviewed this exemption against. */
const EXAMPLE_PRICED_HOLDINGS = [
  "aave_v3_etherfi|before|1|0xcd5fe23c85820f7b72d0926fc9b05b43e359b7ee|2000000000000000000|800000000000|18|weETH",
  "aave_v3_etherfi|after|1|0xcd5fe23c85820f7b72d0926fc9b05b43e359b7ee|2000000000000000000|800000000000|18|weETH",
  "debt_manager|before|10|0xcd5fe23c85820f7b72d0926fc9b05b43e359b7ee|1000000000000000000|4000000000|18|weETH",
  "debt_manager|after|10|0xcd5fe23c85820f7b72d0926fc9b05b43e359b7ee|1000000000000000000|4000000000|18|weETH",
];

/**
 * The frozen exemption, re-proved against the example it was reviewed over.
 * Written as a function of the example so its own failure can be WATCHED
 * (mutant R) rather than only asserted.
 */
const exampleUndisclosedInputs = (example) => {
  const chains = new Map(
    example.batch.watermarks.map((watermark) => [watermark.engine, watermark.chain_id]),
  );
  const fingerprint = [];
  const keys = new Set();
  for (const engine of example.engines) {
    for (const side of ["before", "after"]) {
      for (const entry of engine[side].collateral_by_asset) {
        if (entry.value_usd === null) {
          continue;
        }
        const key = responseKey(chains.get(engine.engine), entry.asset);
        keys.add(key);
        fingerprint.push(
          [
            engine.engine,
            side,
            key,
            entry.amount,
            entry.value_usd,
            String(entry.decimals),
            entry.symbol ?? "—",
          ].join("|"),
        );
      }
    }
  }
  for (const row of fingerprint) {
    if (!EXAMPLE_PRICED_HOLDINGS.includes(row)) {
      fail(
        `the contract's run-book 200 example carries a PRICED holding this recorded exemption was ` +
          `never reviewed against:\n        ${row}\n        The exemption covers a defect somebody ` +
          `read; it may not widen because the example moved. Re-review it, or delete it if the ` +
          `example now discloses its own held prices.`,
      );
    }
  }
  for (const row of EXAMPLE_PRICED_HOLDINGS) {
    if (!fingerprint.includes(row)) {
      fail(
        `the contract's run-book 200 example NO LONGER carries the priced holding this recorded ` +
          `exemption was frozen against:\n        ${row}\n        If the example was repaired, ` +
          `DELETE this exemption rather than re-freezing it.`,
      );
    }
  }
  if (fingerprint.length !== EXAMPLE_PRICED_HOLDINGS.length) {
    fail(
      `the contract's run-book 200 example itemizes ${String(fingerprint.length)} priced holdings ` +
        `but this exemption was frozen over ${String(EXAMPLE_PRICED_HOLDINGS.length)}`,
    );
  }
  // The KEY set is asserted in its own right, so the two disclosures this
  // exemption forgives stay exactly two.
  for (const key of keys) {
    if (!EXAMPLE_UNDISCLOSED_KEYS.includes(key)) {
      fail(`the example's undisclosed price inputs now include ${key}, which is not frozen above`);
    }
  }
  for (const key of EXAMPLE_UNDISCLOSED_KEYS) {
    if (!keys.has(key)) {
      fail(`the frozen undisclosed input ${key} is no longer a priced holding of the example`);
    }
  }
  // THE EXEMPTION MUST STILL BE OWED. It forgives a disclosure the example does
  // not make; the moment the example MAKES it, the exemption is dead licence
  // that would quietly forgive the next hole instead. THIS is the assertion
  // that makes the banked contract repair self-enforcing — when
  // `api/openapi.yaml`'s example is given the `held_flat` its own scenario
  // would produce, generation stops here until this block is DELETED.
  const disclosedByExample = new Set(
    [...example.applied_shocks, ...example.held_flat].map((entry) =>
      responseKey(entry.chain_id, entry.asset),
    ),
  );
  for (const key of EXAMPLE_UNDISCLOSED_KEYS) {
    if (disclosedByExample.has(key)) {
      fail(
        `the contract's run-book 200 example now DISCLOSES ${key}, so the recorded defect this ` +
          `exemption forgives is REPAIRED — delete EXAMPLE_UNDISCLOSED_KEYS, ` +
          `EXAMPLE_PRICED_HOLDINGS and the \`undisclosedInputs\` parameter with it, rather than ` +
          `keeping a licence nothing owes`,
      );
    }
  }
  return new Set(EXAMPLE_UNDISCLOSED_KEYS);
};

const EXAMPLE_UNDISCLOSED_INPUTS = exampleUndisclosedInputs(runBookExample);

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
  const FROZEN_WEETH_ASSET = "0xCd5fE23C85820F7B72D0926FC9b05b43E359b7ee";
  const FROZEN_AAVE_WEETH_PRICE = 400_000_000_000n;
  const FROZEN_DM_WEETH_PRICE = 4_000_000_000n;
  const FROZEN_UNPRICED_ASSET = "0x0000000000000000000000000000000000000BAD";
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
    (BigInt(rowOf(exampleAave, FROZEN_WEETH_ASSET).value_usd) * 10n ** 18n) /
      BigInt(rowOf(exampleAave, FROZEN_WEETH_ASSET).amount),
  );
  frozenLiteral(
    "the collision pair's debt_manager weETH SOURCE-SIDE price",
    FROZEN_DM_WEETH_PRICE,
    (BigInt(rowOf(exampleDM, FROZEN_WEETH_ASSET).value_usd) * 10n ** 18n) /
      BigInt(rowOf(exampleDM, FROZEN_WEETH_ASSET).amount),
  );
  frozenLiteral(
    "the collision pair's unpriced amount",
    FROZEN_UNPRICED_AMOUNT,
    BigInt(rowOf(exampleAave, FROZEN_UNPRICED_ASSET).amount),
  );
  frozenLiteral(
    "the collision pair's debt_manager weETH amount",
    FROZEN_DM_WEETH_AMOUNT,
    BigInt(rowOf(exampleDM, FROZEN_WEETH_ASSET).amount),
  );

  const aaveItems = derivedItemization(matrix, chains.get("aave_v3_etherfi"), [
    {
      asset: FROZEN_WEETH_ASSET,
      decimals: 18,
      amount: BigInt(countedAmount),
      price: FROZEN_AAVE_WEETH_PRICE,
      disclosure: "counted",
    },
    // The colliding row: the SAME asset, NOT COUNTED. No price witness enters
    // the aggregate for it, by the engine's own rule, so it values at null.
    {
      asset: FROZEN_WEETH_ASSET,
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
  ]);
  const dmItems = derivedItemization(matrix, chains.get("debt_manager"), [
    {
      asset: FROZEN_WEETH_ASSET,
      decimals: 18,
      amount: FROZEN_DM_WEETH_AMOUNT,
      price: FROZEN_DM_WEETH_PRICE,
      disclosure: "counted",
    },
  ]);

  /**
   * The example's own aggregate for this engine, with the derived collateral.
   *
   * THE HISTOGRAM IS THE FROZEN EXAMPLE'S OWN CENSUS, PLACED BY NOBODY — and
   * that is a RECORDED LIMIT, not an oversight. Wave W-BS-F's second pass set
   * out to place these accounts by their derived health factor the way the
   * eth_minus_30 body's are placed, and the derivation DISAGREED WITH THE
   * COMMITTED BYTES:
   *
   *   The example's aave side carries ONE account at 800000000000 of collateral
   *   against 600000000000 of debt and draws it in the `1.10 – 1.25` bucket,
   *   which needs a liquidation threshold between 8250 and 9375 bps. The
   *   contract's OWN /v1/params example gives that same (engine, chain, asset)
   *   a `liq_threshold` of 8100 bps, which puts the account at 1.08 — the
   *   `1.05 – 1.10` bucket. And `stress-aave.json`, measuring THE SAME
   *   collateral against THE SAME debt, publishes `health_factor_wad`
   *   1080000000000000000 and the rational 6480000000000000/6000000000000000,
   *   agreeing with /v1/params to the digit.
   *
   * Two committed contract artifacts disagree and the EXAMPLE'S HISTOGRAM is the
   * one standing alone — the same family as the `held_flat: []` defect recorded
   * at `EXAMPLE_UNDISCLOSED_KEYS`, and equally not this generator's to fix.
   * (The eth_minus_30 body already reads `1.05 – 1.10` because it re-measures
   * its aave engine from the stress excerpt rather than carrying the example's.)
   *
   * So the census here is CARRIED instead — but a carry is now a LEDGER ENTRY
   * and not a default (Wave W-BS-G). `carriedCensus` states the placement THIS
   * derivation composes for the account each carried census describes, refuses
   * to keep carrying the moment the two agree, and prints the disagreement it is
   * standing on. Two entries are owed, one per engine, and the second is the one
   * the narrowing was NOT expected to need — the full derivation of both, and
   * why the Debt Manager side cannot take a derived placement either, is under
   * THE RECORDED HISTOGRAM CARRIES above.
   *
   * A THIRD THING THIS CARRY HID — REPAIRED IN WAVE W-BS-H, and the repair is
   * the reason the carry is now conditional. The `.swap` body restates the
   * counted balance at 3 weETH (1200000000000 against the same 600000000000 of
   * debt) and used to carry the example's `1.10 – 1.25` census unchanged. That
   * census was falsifiable WITHOUT reference to the recorded example defect: at
   * the committed 8100 bps the account sits at 1.62, and even the example's own
   * implied 8250-9375 bps would put 3 weETH at 1.65 or above. No threshold
   * reconciles them.
   *
   * A CARRY RECORDS A DEFECT IN THE EXAMPLE'S OWN BOOK, so it is owed only where
   * the body serves the example's own money. `restatesTheBook` is that test, in
   * the derivation's own hand: a side whose derived counted collateral differs
   * from the frozen baseline is not the book the carried census describes, and
   * takes the DERIVED placement. The collision body (2 weETH, 800000000000 — the
   * example's own) still carries, and its ledger entry still prints. The `.swap`
   * body (3 weETH, 1200000000000 — this generator's) is placed at `1.50 – 2.00`,
   * where the arithmetic puts it, and its fixture bytes were regenerated to
   * match. `withCollidingCollateral` reaches the same rule from the other side.
   */
  const restatesTheBook = (engineName, items, side) =>
    items[side].counted !== BigInt(FROZEN_EXAMPLE_BASELINE[engineName][side].total_collateral_usd);

  const sideFrom = (engineName, items, side, baselinePlacement) => {
    const baseline = FROZEN_EXAMPLE_BASELINE[engineName][side];
    const meta = frozenHistogramMeta(engineName, INJECTED_REFUSALS);
    return {
      values: items[side].values,
      histogram: restatesTheBook(engineName, items, side)
        ? // THE DERIVATION IS THE AUTHORITY. This body does not serve the book
          // the carried census describes, so the census has no standing over it.
          derivedHistogram(FROZEN_HISTOGRAM_SHAPE, null, [baselinePlacement], meta)
        : carriedCensus(
            `${what} ${engineName} census (${side} side)`,
            FROZEN_HISTOGRAM_SHAPE,
            frozenCarried(engineName, side),
            [baselinePlacement],
            [],
            meta,
          ),
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

const COLLISION_DECLARED = {
  undisclosedInputs: EXAMPLE_UNDISCLOSED_INPUTS,
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
  undisclosedInputs: EXAMPLE_UNDISCLOSED_INPUTS,
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
  `counts 0 accounts in hf_histogram bucket "1.10 – 1.25", but the derivation places 1 there`,
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

// R. THE EXAMPLE GROWN A PRICED HOLDING. The recorded exemption used to be
// RECOMPUTED from the example, so a new priced holding in `api/openapi.yaml`
// arrived pre-forgiven: law 11 would never ask the collision bodies to disclose
// it, and nothing anywhere would say the exemption had widened.
const GROWN_HOLDING_ROW = `debt_manager|before|${responseKey(DM_CHAIN, INVENTED_ASSET)}|1|1|18|GROWN`;

refusesGeneration(
  "R: the contract example grown a priced holding — the recorded exemption widened silently",
  GROWN_HOLDING_ROW,
  () => {
    const grown = JSON.parse(JSON.stringify(runBookExample));
    grown.engines
      .find((engine) => engine.engine === "debt_manager")
      .before.collateral_by_asset.push({
        asset: INVENTED_ASSET,
        symbol: "GROWN",
        decimals: 18,
        amount: "1",
        value_usd: "1",
        unpriced: false,
        note: countedNote,
      });
    exampleUndisclosedInputs(grown);
  },
);

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

/** The frozen census of one engine/side with its ONE account moved between buckets. */
const censusMoved = (engineName, side, fromLabel, toLabel) => {
  const carried = frozenCarried(engineName, side);
  return {
    infinite_count: carried.infinite_count,
    buckets: carried.buckets.map((bucket) =>
      bucket.label === fromLabel
        ? { ...bucket, count: bucket.count - 1 }
        : bucket.label === toLabel
          ? { ...bucket, count: bucket.count + 1 }
          : bucket,
    ),
  };
};

// AE. THE RECORDED AAVE DEFECT REPAIRED. When `api/openapi.yaml`'s example draws
// its one aave account where its OWN /v1/params threshold puts it — 8100 bps on
// 800000000000 against 600000000000 is 1.08, in `1.05 – 1.10` — the carry stops
// forgiving anything and becomes a licence that would swallow the next
// discrepancy silently. Generation stops and demands its deletion. This is the
// second of the two teeth: `freezeExampleBaseline` catches the bytes moving
// (mutant AD), and this catches the carry outliving the defect it records.
refusesGeneration(
  "AE: the recorded aave histogram defect repaired — the carry becomes a licence nothing owes",
  "probe: the example's aave census repaired to its own params: THE RECORDED HISTOGRAM DEFECT IS " +
    "REPAIRED",
  () =>
    carriedCensus(
      "probe: the example's aave census repaired to its own params",
      FROZEN_HISTOGRAM_SHAPE,
      censusMoved("aave_v3_etherfi", "before", "1.10 – 1.25", "1.05 – 1.10"),
      [
        recordedAaveRational(
          BigInt(FROZEN_EXAMPLE_BASELINE.aave_v3_etherfi.before.total_collateral_usd),
          BigInt(FROZEN_EXAMPLE_BASELINE.aave_v3_etherfi.before.total_debt_usd),
        ),
      ],
      [],
      frozenHistogramMeta("aave_v3_etherfi", 0),
    ),
);

// AF. THE SECOND RECORDED DEFECT, THE SAME WAY. The Debt Manager's carried
// census is owed for its own reason — 3200000000/4620000000 is 0.6926, which is
// `< 0.90`, not the `0.90 – 1.00` the example draws — and it is held by the same
// tooth. Two recorded defects, two probes: neither exemption can outlive the
// thing it forgives.
refusesGeneration(
  "AF: the recorded Debt Manager histogram defect repaired — the second carry deleted too",
  "probe: the example's debt_manager census repaired to its own threshold: THE RECORDED HISTOGRAM " +
    "DEFECT IS REPAIRED",
  () =>
    carriedCensus(
      "probe: the example's debt_manager census repaired to its own threshold",
      FROZEN_HISTOGRAM_SHAPE,
      censusMoved("debt_manager", "before", "0.90 – 1.00", "< 0.90"),
      [recordedDMBaselineRational("before")],
      [],
      frozenHistogramMeta("debt_manager", 0),
    ),
);

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

// AS. THE DERIVATION'S OWN REFUSAL COUNT, WATCHED WHERE IT STILL CAN BE. With the
// census tightened (AA), no BODY edit can reach `checkDerivation`'s
// `refused_count` law without breaking the arithmetic first — the two laws now
// pin one field and the cheaper one fires. So the law is probed against a
// doctored DERIVATION instead: one that expects a refusal the honest body does
// not carry. A law that can no longer be reached from the outside is still a law
// that has to work.
refusesGeneration(
  "AS: the derivation expects a refusal the body does not carry — the second reading, still watched",
  "publishes an hf_histogram refused_count of 0, but the derivation composes 1",
  () =>
    checkDerivation("probe", ethRunBook, {
      ...ETH_DERIVATION,
      engines: ETH_DERIVATION.engines.map((engine) => ({
        ...engine,
        before: {
          ...engine.before,
          histogram: { ...engine.before.histogram, refused_count: 1 },
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
