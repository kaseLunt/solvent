# DRAFT - DEFECTIVE per adversarial verify; revision required before implementation

# Contract 1.7.0 — `hf_transitions`: the server-provided before→after transition matrix on the scenario run-book

**Status:** draft spec, read-only research. Nothing in this document was written to the repo.
**Scope:** `POST /v1/scenarios/{id}/run-book`, `RunBookEngine`. Additive only.
**Sources read:** `cmd/api/p5_runbook.go`, `cmd/api/handlers.go` (`histogramEdges` / `edgeWad` / `bucketIndexOf` / `histogramComparator` / `coverage`), `internal/risk/aave.go`, `internal/risk/dm.go`, `internal/risk/scenario.go` (`ApplyScenario`), `api/openapi.yaml` (§`RunBook*`, the run-book 200 example at lines 1130–1336), `cmd/api/p5_runbook_bsplit_test.go`, `cmd/api/p5_runbook_bsplit_db_test.go`, `cmd/api/p5_runbook_example_db_test.go`, `web/app/lab/LabRunBookDetail.tsx`, `web/app/lab/labRunBookLines.ts`, `packages/client-ts/src/types.ts`, `web/lib/proof-contract.gen.ts`, `web/tests/fixtures/generate*.mjs`.

---

## 1. Why the two histograms provably cannot do this

The run-book already carries `before.hf_histogram` and `after.hf_histogram` per engine, and a `movers` list capped at 20. The web layer already states, in its own code, that the flow question is unanswerable from that pair — `web/app/lab/labRunBookLines.ts`, `histogramShiftReadingLine`:

> "The only quantity derivable here is `belowOne(after) − belowOne(before)`, and that is a difference of two POPULATIONS — not a count of accounts that crossed. An account that fell below 1.00 and another that rose above it cancel exactly, and this response carries nothing that would reveal either. The honest options were: serve the gross count (the API does not), compute it here (impossible from two histograms), or DISCLOSE the limitation."

That is the exact defect this wave closes. Two marginals do not determine a joint distribution: for 8 buckets there are combinatorially many joint tables with the same two margins, and the client has no basis to pick one. `movers` does not close it either — it is capped at 20, it is ranked by *drop magnitude* (Aave) or *eligibility flip* (DM) rather than by lane change, and on Aave it structurally excludes every account whose HF **rose** and every no-debt account. A Sankey drawn from marginals + a truncated top-20 would be a picture the server never computed, which is a D-013 defect: it invites a confident wrong reading from an honest user.

**The joint distribution must come from the server**, because only the server holds both sides of the same account in the same request.

### The non-goal, stated up front

`hf_transitions` **does not** publish an eligibility verdict. On the Debt Manager the lanes are the exact rational `maxBorrowLT/borrowings` — a *disclosure*, per `histogramComparator` — and a transition into a below-1.00 lane is **not** a liquidation flip. The verdict path remains `newly_eligible_accounts` and `movers` / `movers_total`. The server must not serve a "crossed into eligible" count derived from lanes; a client that knows the comparator may derive a region count and must label it as the comparator's own vocabulary (as `LabRunBookDetail.tsx` already does with its crit-tint asymmetry).

---

## 2. Wire shape

New field on `RunBookEngine` (per engine, **not** per aggregate — the matrix spans both sides and is not a property of either one):

```
RunBookEngine.hf_transitions: RunBookTransitions   (required, additive)
```

### 2.1 The lane vocabulary — one bucket law, extended by exactly two lanes

Lanes are the ordered vocabulary both margins are stated in. There are `len(histogramEdges) + 2 = 10` of them:

| index | kind | meaning |
|---|---|---|
| 0…7 | `bucket` | the SAME eight buckets `hf_histogram.buckets` serves, in the same order, with the same `label` / `lower_wad` / `upper_wad`, placed by the same `bucketIndexOf` |
| 8 | `infinite` | accounts with NO DEBT — the health factor is undefined-because-unbounded, never a large number and never a bucket. This is `hf_histogram.infinite_count`'s population. |
| 9 | `refused` | rows carrying no comparator on that side, **including** the rows this layer could not rebuild at all. This is `hf_histogram.refused_count`'s population. |

The lane count is `N+2`, not `N`, precisely so the row/column margins can equal the *whole* histogram rather than only its bucket array. A matrix over 8 lanes would silently drop the infinite and refused populations, which is the failure mode this surface exists to make unconstructible.

```yaml
    RunBookTransitionLane:
      type: object
      additionalProperties: false
      required: [index, kind, label, lower_wad, upper_wad]
      description: |
        One lane of the transition matrix (ADDED 1.7.0). Lanes 0..N-1 ARE the
        buckets `hf_histogram` serves — same order, same labels, same edges,
        placed by the same law — and the two lanes after them are the two
        tallies that sit BESIDE those buckets on every histogram this surface
        serves. There is no lane a histogram does not have and no histogram
        tally without a lane.
      properties:
        index: { type: integer, description: This lane's position, and the value `rows[].from` / `cells[].to` reference. }
        kind:
          type: string
          enum: [bucket, infinite, refused]
        label:
          type: string
          description: |
            For a `bucket` lane this is byte-identical to the corresponding
            `hf_histogram.buckets[].label`. For the two others it names the
            population in the histogram's own vocabulary.
        lower_wad: { $ref: "#/components/schemas/NullableDecimal" }
        upper_wad:
          allOf: [{ $ref: "#/components/schemas/NullableDecimal" }]
          description: Null on the open-ended top bucket AND on both non-bucket lanes, which have no edges at all — an unbounded health factor is not a large number.

    RunBookTransitionCell:
      type: object
      additionalProperties: false
      required: [to, accounts, debt_before_usd, debt_after_usd, unmeasured_accounts]
      description: |
        One occupied cell (ADDED 1.7.0): the accounts whose BEFORE lane is this
        row's `from` and whose AFTER lane is `to`. A cell is emitted only when
        it holds at least one account.
      properties:
        to: { type: integer, description: The AFTER lane's `index`. }
        accounts:
          type: integer
          minimum: 1
          description: Accounts in this cell. An empty cell is ABSENT, never a row of zeros.
        debt_before_usd:
          allOf: [{ $ref: "#/components/schemas/NullableDecimal" }]
          description: |
            The exact sum of BEFORE-side debt over the accounts in this cell
            that the run MEASURED, at this engine's `usd_decimals`, in this
            engine's own unit — never summed with another engine's. NULL, never
            "0", when the run measured none of them (see
            `unmeasured_accounts`): a debt nobody computed and a debt of zero
            are different facts.
        debt_after_usd:
          allOf: [{ $ref: "#/components/schemas/NullableDecimal" }]
          description: |
            The same sum on the AFTER side. It is a SEPARATE figure because the
            shock moves debt: Aave's `total_debt_base` is priced
            (`MulDivCeil(live_debt, price, den)`), so a `stable_usd` scenario
            changes it. One debt number per cell could conserve on at most one
            margin.
        unmeasured_accounts:
          type: integer
          description: |
            How many of this cell's accounts the run never measured — the rows
            this layer could not rebuild, which carry no numbers at all and are
            also in `coverage.excluded`. They are COUNTED here and their money
            is NOT invented. The two debt figures describe `accounts` minus this
            number and nothing else.

    RunBookTransitionRow:
      type: object
      additionalProperties: false
      required: [from, from_accounts, cells]
      description: One BEFORE lane's outflow (ADDED 1.7.0). Every lane gets a row, including empty ones, so the shape is stable.
      properties:
        from: { type: integer }
        from_accounts:
          type: integer
          description: |
            This lane's whole BEFORE population. It EQUALS the corresponding
            tally on `before.hf_histogram` — `buckets[from].count` for a bucket
            lane, `infinite_count` for the infinite lane, `refused_count` for
            the refused lane — and it equals the sum of this row's `cells[].accounts`.
        cells:
          type: array
          description: The occupied cells of this row, ascending by `to`. Empty when this lane held no account before the shock.
          items: { $ref: "#/components/schemas/RunBookTransitionCell" }

    RunBookTransitions:
      type: object
      additionalProperties: false
      required:
        [comparator, wad_scale, lanes, rows, to_accounts, accounts,
         held_accounts, moved_accounts, unmeasured_accounts, note]
      description: |
        The BEFORE-to-AFTER account flow for one engine (ADDED 1.7.0): a joint
        distribution over the SAME lanes the two `hf_histogram`s beside it are
        stated in.

        THE TWO HISTOGRAMS CANNOT PRODUCE THIS. Two marginals do not determine a
        joint: an account that fell below 1.00 and another that rose above it
        cancel exactly in a marginal difference, and no client-side arithmetic
        can separate them. `movers` cannot either — it is capped, and it is
        ranked by drop magnitude or by an eligibility flip rather than by lane
        change. So the joint is computed HERE, in the one place that holds both
        sides of the same account.

        The lanes ARE the histogram's tallies, so the margins of this matrix are
        the two histograms exactly (see `rows[].from_accounts` and
        `to_accounts`). Nothing is bucketed twice and no second edge table
        exists.
      properties:
        comparator:
          type: string
          enum: [hf_wad, hf_num/hf_den]
          description: The SAME per-engine vocabulary `RunBookHistogram` names, repeated so this matrix is readable without the histograms in scope. On the Debt Manager the lanes are the exact rational maxBorrowLT/borrowings — a DISCLOSURE. A move into a below-1.00 lane is NOT an eligibility flip; take eligibility from `newly_eligible_accounts` and `movers`.
        wad_scale: { $ref: "#/components/schemas/Decimal" }
        lanes:
          type: array
          items: { $ref: "#/components/schemas/RunBookTransitionLane" }
        rows:
          type: array
          description: One row per lane, in lane order, always. A lane with no BEFORE population still gets a row with `from_accounts` 0 and no cells.
          items: { $ref: "#/components/schemas/RunBookTransitionRow" }
        to_accounts:
          type: array
          description: |
            Each lane's whole AFTER population, in lane order. It EQUALS the
            corresponding tally on `after.hf_histogram`, and it equals the
            column sums of `rows[].cells`. It is served densely so that the
            sparse cells lose nothing: an absent cell is a KNOWABLE zero, and
            these totals are what make that knowable.
          items: { type: integer }
        accounts:
          type: integer
          description: |
            Every row of this engine's book that this run touched — the grand
            total of the matrix. It is `before.accounts` plus the rows this
            layer could not rebuild (`unmeasured_accounts`), and it is also
            `after.accounts` plus the same number. Nothing is in two cells and
            nothing is in none.
        held_accounts:
          type: integer
          description: Accounts whose lane did not change — the diagonal. `held_accounts + moved_accounts == accounts`.
        moved_accounts:
          type: integer
          description: |
            Accounts whose lane DID change — the off-diagonal, and the GROSS
            count the two histograms structurally could not give. It counts any
            lane change, including into or out of the no-debt and no-comparator
            lanes.
        unmeasured_accounts:
          type: integer
          description: |
            The rows this layer could not rebuild, on this engine. They sit in
            exactly one cell — refused-to-refused — because a shock does not make
            a row rebuildable, and they carry NO money on either side.
        note: { type: string }
```

### 2.2 Where refused rows sit — named, never dropped

Two distinct populations reach lane 9, and the wire distinguishes them without splitting the lane (splitting would break the 1:1 margin law against `refused_count`):

1. **Measured, no comparator on that side.** `bucketIndexOf` returned −1 for a position that *was* computed (Aave `hf_wad == nil` while not infinite; DM `hf_den <= 0`). Its money **is** inside `total_debt_usd`, so it contributes to the cell's debt sums exactly.
2. **Unrebuildable.** `p.input == nil` on a covered engine — `refusedByEngine` in `handleRunBook`. It reached no arithmetic, is in `coverage.excluded`, and is folded onto **both** sides' `refused` counts today (`eb.refused += n; ea.refused += n`). It therefore lands on the **diagonal cell [9][9]** and only there. It contributes to `accounts` and to `unmeasured_accounts`, and to **neither** debt sum.

A cell holding only unrebuildable rows carries `debt_before_usd: null`, `debt_after_usd: null`, `unmeasured_accounts == accounts`. A mixed cell carries the exact partial sum plus the counter that says how many accounts it does not describe. **`"0"` is never served for an unmeasured population.**

The **infinite** lane (8) is the opposite case and must not be confused with it: a no-debt account's debt is *knowably* zero, so its cells carry `"0"`, not null. It is the *health factor* that is unbounded, not the debt.

### 2.3 Sparse cells, dense everything else

- `lanes`: dense, always 10.
- `rows`: dense, always 10, in lane order.
- `to_accounts`: dense, always 10.
- `cells`: **sparse** — only cells with `accounts >= 1`, ascending by `to`.

An absent cell is a knowable zero, and it is admissible here *only* because both margins and the full lane vocabulary are on the wire beside it. This is the one absence-as-zero on this surface, and the note must say so. Rationale is in §6: dense cells would grow the body by ~163%, sparse by ~22% on the contract example.

---

## 3. Endpoint behavior

No route change, no parameter change, no status-code change. `POST /v1/scenarios/{id}/run-book` continues to 400 on a malformed id, 404 on an uncommitted id, 503 with no servable batch, and to **write nothing** (`TestAPIIssuesNoWritingSQL` continues to hold — nothing in this wave adds a SQL literal).

Every engine row that exists today gains exactly one field. Cases:

| case | behavior |
|---|---|
| withheld engine | unchanged — no `engines[]` row at all, named in `excluded_engines`. There is no `refused`/`refusal` pair on `hf_transitions` for the same reason `RunBookHistogram` has none. |
| engine not covered by the scenario | unchanged — absent from `engines[]`, named in `notes`. |
| engine with zero reconstructable positions | `hf_transitions` is served with the full lane vocabulary, all margins 0, all rows empty. Same shape law the histogram already follows. |
| market-realization scenario (`hfs_unchanged`) | after == before by construction, so the matrix is **exactly diagonal**. That is a second, independently computed witness of the same claim — keep it. |
| rate PROJECTION scenario | `afterInputs = beforeInputs`, so the matrix is exactly diagonal. Serve it: "this scenario moved no account between lanes" is a true and useful statement, and suppressing the field would make its absence ambiguous. |

---

## 4. Implementation shape (Go)

### 4.1 The shared lane law

In `cmd/api/handlers.go`, immediately beside `bucketIndexOf`. Note `histogramEdges` is a package-level `var` slice, so these must be `var`, not `const` (`len()` of a slice is not a constant expression):

```go
// The two lanes that sit BESIDE the buckets on every histogram this service
// serves, given indices so a matrix can state its margins over the whole
// histogram rather than over its bucket array alone.
var (
	laneInfinite = len(histogramEdges)     // accounts with NO DEBT
	laneRefused  = len(histogramEdges) + 1 // rows carrying no comparator
	laneCount    = len(histogramEdges) + 2
)

// laneIndexOf is bucketIndexOf's total extension: every account state lands in
// exactly one lane, and the two non-bucket lanes are the histogram's own two
// non-bucket tallies. There is no second edge table and no second comparator.
func laneIndexOf(engine string, st *runAccountState) int {
	if st.infinite {
		return laneInfinite
	}
	if i := bucketIndexOf(engine, st.hfWad, st.hfNum, st.hfDen); i >= 0 {
		return i
	}
	return laneRefused
}
```

### 4.2 The tally and the lane record are produced by one statement each

`runMeasure.bucket` is rewritten so the histogram tally and the lane record cannot diverge — a matrix that disagreed with its histogram would require this one function to write two different numbers:

```go
type runLaneEntry struct {
	account   common.Address
	lane      int
	debtUSD   *big.Int // nil ONLY on an unmeasured row
	unmeasured bool
}

// runMeasure gains exactly one field.
//   lanes []runLaneEntry  // ORDERED, one entry per position, in walk order

func (m *runMeasure) bucket(engine string, st *runAccountState) {
	lane := laneIndexOf(engine, st)
	switch lane {
	case laneInfinite:
		m.infinite++
	case laneRefused:
		m.refused++
	default:
		m.buckets[lane]++
	}
	m.lanes = append(m.lanes, runLaneEntry{account: st.account, lane: lane, debtUSD: st.debtUSD})
}
```

`runAccountState` gains `account common.Address` (already available as `h.Account` at both call sites in `measureRunBook`).

### 4.3 The unrebuildable rows

`refusedByEngine map[string]int` becomes `map[string][]common.Address` (the handler loop already holds the `positionRow`). The existing fold keeps its exact semantics and gains the paired lane entries:

```go
for _, acct := range refusedByEngine[engine] {
	eb.refused++
	ea.refused++
	eb.lanes = append(eb.lanes, runLaneEntry{account: acct, lane: laneRefused, unmeasured: true})
	ea.lanes = append(ea.lanes, runLaneEntry{account: acct, lane: laneRefused, unmeasured: true})
}
```

### 4.4 The zip — pairing by POSITION, with an account guard

`beforeInputs` and `afterInputs` are index-aligned by construction (`afterInputs` is built 1:1 from `run` in the same order, or *is* `beforeInputs` on a projection), and `ApplyScenario` never reorders or drops. Pairing by index rather than by account map is what makes marginal agreement hold **by construction** even if a book ever carried two positions for one account. The account equality check is the guard against a future refactor that filters one side:

```go
func runBookTransitions(engine string, before, after *runMeasure, dec uint8) (wireRunBookTransitions, error) {
	if len(before.lanes) != len(after.lanes) {
		return wireRunBookTransitions{}, fmt.Errorf(
			"%s: %d before-lane records against %d after-lane records — the two sides "+
				"measured different books and a matrix over them would have margins "+
				"neither histogram supports", engine, len(before.lanes), len(after.lanes))
	}
	// ... zip, requiring b.account == a.account at each index, accumulating
	// counts and the two debt sums into cell[b.lane][a.lane] ...
}
```

A refusal here is a **defect in this layer**, not a property of the data — so it is a 500 with a named reason, exactly like the existing `"applying scenario ... refused a verified position"` path. It never degrades to a matrix with wrong margins.

### 4.5 The note the server composes

The example-is-a-served-body law (`TestRunBookExampleIsAServedBody`) means every sentence in the contract example must be a sentence the server composes. Required claims, in one server-owned string:

1. Rows are the BEFORE lane, columns the AFTER lane, over the positions in this run on THIS engine.
2. Lanes 0…N−1 are the SAME buckets, on the SAME comparator and edges, that the two `hf_histogram`s beside it serve; the next lane is accounts with NO DEBT (unbounded, never a bucket); the last is rows carrying no comparator, including rows this layer could not rebuild.
3. The row margins ARE the before histogram and the column margins ARE the after histogram — a weld, not a hope.
4. A cell absent from `cells` holds ZERO accounts; the dense margins are what make that omission complete.
5. `unmeasured_accounts` names accounts whose money the run never measured; the two debt figures are exact sums over the rest, and are null — never "0" — when the rest is empty.
6. Debt is in THIS engine's own unit at its own decimals and is never summed with another engine's.
7. On the Debt Manager these lanes are a DISCLOSURE, not the liquidation verdict.

---

## 5. Worked example — consistent with the committed run-book example

The contract's declared 200 example is `weeth_market_depeg_oracles_held` (`api/openapi.yaml:1130–1336`), realized by `newRunBookExampleFixture` in `cmd/api/p5_runbook_example_db_test.go`. Its committed numbers, which the matrix must reproduce:

- **aave_v3_etherfi**, `usd_decimals` 8: `accounts` 1, `total_debt_usd` `"600000000000"`, buckets all 0 except `"1.05 – 1.10"` (index 3) = 1, `infinite_count` 0, `refused_count` 1. `after` is a YAML anchor alias of `before` — oracles held, so the two sides are identical by construction.
- **debt_manager**, `usd_decimals` 6: `accounts` 1, `total_debt_usd` `"4620000000"`, `"< 0.90"` (index 0) = 1, `infinite_count` 0, `refused_count` 1. `after` aliases `before`.
- The batch carries 4 positions, 2 refused (`fxAaveRefused`, `fxDMRefused`) — one per engine, and each is an **unrebuildable** row folded onto both sides.

So the example's matrix is purely diagonal with one measured cell and one unmeasured cell per engine:

```yaml
                    hf_transitions:
                      comparator: "hf_wad"
                      wad_scale: "1000000000000000000"
                      lanes:
                        - { index: 0, kind: "bucket", label: "< 0.90",      lower_wad: null,                  upper_wad: "900000000000000000" }
                        - { index: 1, kind: "bucket", label: "0.90 – 1.00", lower_wad: "900000000000000000",  upper_wad: "1000000000000000000" }
                        - { index: 2, kind: "bucket", label: "1.00 – 1.05", lower_wad: "1000000000000000000", upper_wad: "1050000000000000000" }
                        - { index: 3, kind: "bucket", label: "1.05 – 1.10", lower_wad: "1050000000000000000", upper_wad: "1100000000000000000" }
                        - { index: 4, kind: "bucket", label: "1.10 – 1.25", lower_wad: "1100000000000000000", upper_wad: "1250000000000000000" }
                        - { index: 5, kind: "bucket", label: "1.25 – 1.50", lower_wad: "1250000000000000000", upper_wad: "1500000000000000000" }
                        - { index: 6, kind: "bucket", label: "1.50 – 2.00", lower_wad: "1500000000000000000", upper_wad: "2000000000000000000" }
                        - { index: 7, kind: "bucket", label: ">= 2.00",     lower_wad: "2000000000000000000", upper_wad: null }
                        - { index: 8, kind: "infinite", label: "no debt (unbounded)", lower_wad: null, upper_wad: null }
                        - { index: 9, kind: "refused",  label: "no comparator",       lower_wad: null, upper_wad: null }
                      rows:
                        - { from: 0, from_accounts: 0, cells: [] }
                        - { from: 1, from_accounts: 0, cells: [] }
                        - { from: 2, from_accounts: 0, cells: [] }
                        - from: 3
                          from_accounts: 1
                          cells:
                            - to: 3
                              accounts: 1
                              debt_before_usd: "600000000000"
                              debt_after_usd: "600000000000"
                              unmeasured_accounts: 0
                        - { from: 4, from_accounts: 0, cells: [] }
                        - { from: 5, from_accounts: 0, cells: [] }
                        - { from: 6, from_accounts: 0, cells: [] }
                        - { from: 7, from_accounts: 0, cells: [] }
                        - { from: 8, from_accounts: 0, cells: [] }
                        - from: 9
                          from_accounts: 1
                          cells:
                            - to: 9
                              accounts: 1
                              # The row this layer could not rebuild. It carries NO
                              # numbers on either side, so its debt is UNKNOWABLE —
                              # null, never "0".
                              debt_before_usd: null
                              debt_after_usd: null
                              unmeasured_accounts: 1
                      to_accounts: [0, 0, 0, 1, 0, 0, 0, 0, 0, 1]
                      accounts: 2
                      held_accounts: 2
                      moved_accounts: 0
                      unmeasured_accounts: 1
                      note: "<the server-composed sentence, §4.5>"
```

Debt Manager, same structure with its own lane and unit: `rows[0].from_accounts` 1 with `cells: [{to: 0, accounts: 1, debt_before_usd: "4620000000", debt_after_usd: "4620000000", unmeasured_accounts: 0}]`, `rows[9]` the same unmeasured diagonal cell, `to_accounts: [1,0,0,0,0,0,0,0,0,1]`, `accounts` 2, `held_accounts` 2, `moved_accounts` 0, `unmeasured_accounts` 1, `comparator: "hf_num/hf_den"`.

**Every reconciliation the example must satisfy, checkable by eye:**

| law | Aave | DM |
|---|---|---|
| `rows[].from_accounts` == before histogram tallies | `[0,0,0,1,0,0,0,0]` + inf 0 + ref 1 ✓ | `[1,0,0,0,0,0,0,0]` + inf 0 + ref 1 ✓ |
| `to_accounts` == after histogram tallies | identical (oracles held) ✓ | identical ✓ |
| Σ all cells' `accounts` == `accounts` | 1 + 1 = 2 ✓ | 1 + 1 = 2 ✓ |
| `accounts` == `before.accounts` + `unmeasured_accounts` | 1 + 1 = 2 ✓ | 1 + 1 = 2 ✓ |
| `accounts` == the batch's positions on this engine | 2 ✓ (`coverage.batch_positions` 4, two engines) | 2 ✓ |
| Σ `debt_before_usd` == `before.total_debt_usd` | `"600000000000"` ✓ | `"4620000000"` ✓ |
| Σ `debt_after_usd` == `after.total_debt_usd` | `"600000000000"` ✓ | `"4620000000"` ✓ |
| `held + moved == accounts` | 2 + 0 = 2 ✓ | 2 + 0 = 2 ✓ |

> **The example is CAPTURED, not composed.** `TestRunBookExampleIsAServedBody` re-runs the seeded book through the real handler and asserts byte equality against the contract. The block above is a *prediction* from the example's own committed numbers; the capture is the authority, and any divergence is a defect in this spec, not in the test.

### 5.1 Second worked example — the off-diagonal case (`eth_minus_10`, `newP5Fixture`)

From `cmd/api/p5_runbook_bsplit_db_test.go`: the Aave account is at HF 1.08 before (`"1.05 – 1.10"`, lane 3) and 0.972 after (`"0.90 – 1.00"`, lane 1); the DM account is `< 0.90` on both sides; each engine carries one refused batch row.

**aave_v3_etherfi**

| from \ to | 1 (`0.90 – 1.00`) | 9 (`refused`) | `from_accounts` |
|---|---|---|---|
| 3 (`1.05 – 1.10`) | **1** | — | 1 |
| 9 (`refused`) | — | **1** (unmeasured) | 1 |
| `to_accounts` | 1 | 1 | **accounts 2** |

`held_accounts` 1, `moved_accounts` 1, `unmeasured_accounts` 1. `eth_minus_10` shocks `eth_usd`; the Aave debt leg is USDC held flat, so `debt_before_usd == debt_after_usd` on the occupied cell. Under `stable_depeg_098_unsnapped` the same cell would carry two **different** debt strings — which is the concrete case that makes one debt figure per cell insufficient.

**debt_manager**: `rows[0]` → `{to: 0, accounts: 1}` (3200/4200 = 0.762 before, 2880/4200 = 0.686 after — both `< 0.90`), plus the unmeasured diagonal. `held_accounts` 2, `moved_accounts` 0. The finding the existing test already pins — "the DM distribution does NOT move" — becomes explicit as `moved_accounts: 0` rather than an inference from two identical histograms.

---

## 6. Size and cost

**Bounded by the lane count, not by the book.** `laneCount` is 10 today (8 edges + 2). Cells per engine ≤ 100 whether the book holds 4 positions or 400,000. Engines per response ≤ the scenario's `engines[]`, which is at most 2 in every committed scenario.

Measured baseline: `web/tests/fixtures/run-book.weeth_market_depeg_oracles_held.json` is **20,862 bytes** for the two-engine contract example.

| shape | bytes added per engine | body total | delta |
|---|---|---|---|
| contract example (2 occupied cells/engine) | ~2.35 KB (lanes ~1.05 KB, 10 row stubs ~0.30 KB, cells ~0.30 KB, `to_accounts` ~0.05 KB, note ~0.65 KB) | ~25.6 KB | **+22%** |
| realistic shocked book (10–25 occupied cells/engine) | ~3.5–5.8 KB | ~29–33 KB | +40…+58% |
| dense cells, all 100 occupied (rejected) | ~17.0 KB (100 × ~150 B) | ~54 KB | +163% |

Per-cell byte estimate: `{"to":9,"accounts":123456,"debt_before_usd":"<21 digits>","debt_after_usd":"<21 digits>","unmeasured_accounts":0}` ≈ 139 B; 150 B used above. Per-lane ≈ 85–115 B (no per-lane `note` — the top-level note carries the vocabulary's semantics, saving ~1.5 KB/engine).

**Compute.** Two extra slice appends per position (one per side) inside walks that already compute everything they need; one O(P) zip per engine; one O(occupied cells) emit. No second walk of the book, no second `risk.Waterfall` evaluation, no additional database read. The handler today already performs two full `measureRunBook` walks and two whole-book `risk.Waterfall` evaluations at the identity grid point; this addition is well under 1% of that.

**Memory.** Two `[]runLaneEntry` slices of P entries each, ~40 B/entry (20 B address + int + `*big.Int` + bool, padded). At P = 10,000 positions that is ~800 KB transient per request. The existing `states map[common.Address]*runAccountState` already allocates one entry per account per side, each holding several `*big.Int`, so the lane slices are strictly cheaper than what the handler already allocates and are freed with the same request.

**Latency.** Dominated entirely by the two existing whole-book `Waterfall` evaluations. The zip is a single linear pass with no sort (rows emit in lane order, cells in ascending `to` order, both by index — deterministic without sorting).

---

## 7. Test laws

### 7.1 The headline — marginal agreement, enforced in Go

`TestRunBookTransitionsAgreeWithBothMarginals` (`cmd/api/p5_runbook_transition_test.go`). Over the SAME `wire()` outputs the response carries — not a re-derivation — for both engines:

```
for i in 0..laneCount-1:
    Σ_j cell[i][j].accounts == rows[i].from_accounts == beforeTally(i)
for j in 0..laneCount-1:
    Σ_i cell[i][j].accounts == to_accounts[j]      == afterTally(j)
where tally(k) = histogram.buckets[k].count for k < N
               = histogram.infinite_count       for k == laneInfinite
               = histogram.refused_count        for k == laneRefused
```

**Mutations this kills:** bucketing the matrix on its own edge table; dropping refused rows from the joint while the histogram counts them; building the matrix from the account-keyed `states` maps when a count and a state disagree; folding the unrebuildable rows into one side only.

### 7.2 The rest of the Go unit laws (`cmd/api/p5_runbook_transition_test.go`, no DB)

| test | claim | mutation killed |
|---|---|---|
| `TestRunBookTransitionLanesAreTheHistogramsOwnBuckets` | `lanes[0..N-1]` byte-identical (`label`, `lower_wad`, `upper_wad`) to the served `hf_histogram.buckets`, in order; `lanes[N].kind == "infinite"`; `lanes[N+1].kind == "refused"`; `len(lanes) == len(histogramEdges)+2` | a second edge table; an edge that moves in one place only |
| `TestRunBookTransitionCountsPartitionTheRun` | Σ all cells == `accounts` == `before.accounts + unmeasured` == `after.accounts + unmeasured`; `held + moved == accounts`; every cell `accounts >= 1`; `to` unique within a row and ascending | a row in two cells or in none; an emitted zero cell |
| `TestRunBookTransitionNeverRendersAnUnmeasurableDebtAsZero` | a cell with `unmeasured_accounts == accounts` carries `null` on both debts; a MIXED cell carries the exact partial sum **and** the counter | serving `"0"` for a population nobody measured |
| `TestRunBookTransitionInfiniteLaneDebtIsAKnowableZero` | the infinite lane's cells carry `"0"`, not null | collapsing knowable-zero and unknowable into one representation |
| `TestRunBookTransitionDebtSumsAreTheAggregateTotals` | Σ `debt_before_usd` (big.Int over decimal strings) == `before.total_debt_usd`; Σ `debt_after_usd` == `after.total_debt_usd` | a float anywhere; a cell debt taken from the wrong side |
| **`TestRunBookTransitionSeparatesOffsettingMoves`** | build one account falling lane 3→1 and another rising lane 1→3: the marginal difference is **zero** while `moved_accounts == 2` and both off-diagonal cells are present | **this is the wave's reason for existing** — any "matrix" reconstructed from the two histograms fails it |
| `TestRunBookTransitionRefusesAMisPairedZip` | unequal lane-slice lengths, or an account mismatch at an index, produce an error (500 with a named reason), never a matrix with wrong margins | a future refactor that filters one side and serves a plausible-looking wrong joint |
| `TestRunBookTransitionIsDeterministic` | repeated builds over the same measures are byte-identical | map-iteration order leaking to the wire |

### 7.3 DB-backed (`cmd/api/p5_runbook_transition_db_test.go`)

`TestRunBookServesTheTransitionMatrix`, `newP5Fixture` + `eth_minus_10`, through the real handler and the real contract validator (`f.postJSON(..., runBookContractPath, 200)`): the Aave crossing appears at `rows[3].cells[to=1].accounts == 1`; the unrebuildable row sits at `[9][9]` with two nulls and `unmeasured_accounts: 1`; both margins equal the two served histograms field for field; `moved_accounts == 1` on Aave and `0` on DM.

### 7.4 Laws that extend for free

- **`TestRunBookExampleIsAServedBody`** — no change needed; the contract example must be **re-captured** (run the fixture through the handler, transplant the response). Hand-writing `hf_transitions` into the yaml fails this test.
- **`TestRunBookHistogramCountsWhatItCannotBucket`** — keep as is; it now also guards the lane record, since `bucket()` writes both.
- **`TestAPIIssuesNoWritingSQL`** — continues to hold; this wave adds no SQL literal.
- **`packages/client-ts/test/example-clock.test.ts`** — the four serve-time fields are untouched; the example's clock coherence is unaffected.

### 7.5 Client and web laws

| where | law |
|---|---|
| `packages/client-ts/test/drift.test.ts` | regenerating from `api/openapi.yaml` must reproduce `src/generated/schema.ts` byte for byte — run `npm run gen` and commit |
| `packages/client-ts/test/fixtures.test.ts` | asserts `contract.version === CONTRACT_VERSION`; bump `CONTRACT_VERSION` to `"1.7.0"` in `src/types.ts` |
| `packages/client-ts/src/types.ts` (new) | `TRANSITION_LANE_KIND_SET = { bucket: true, infinite: true, refused: true } as const satisfies Record<TransitionLaneKind, true>` — the `EVENT_AMOUNT_UNITS` pattern, total both ways, so a lane kind added or removed by the contract breaks the compile |
| `web/tests/unit/proof-contract-fidelity.spec.ts` | re-extracts from the yaml and fails on drift — regenerate `web/lib/proof-contract.gen.ts` |
| new `web/tests/unit/lab-transition.spec.ts` | the client-side derivation module re-checks marginal agreement **against the served histograms** and refuses to render a matrix whose margins disagree — the `matrixCells.ts` precedent ("nothing is classified before it is validated"), applied to a body that could arrive from an older or a broken deployment |
| new `web/tests/e2e/runbook-transition.spec.ts` | sibling of `runbook-bsplit.spec.ts`, driven from the regenerated fixture family |

---

## 8. AlgorithmRevision impact — nothing persisted changes. Confirmed.

`riskfeed.AlgorithmRevision` (currently **6**, `internal/riskfeed/assemble.go:126`) versions "the laws in this file and everything they derive" — the riskd pass, its persisted rows, and the batch identity vector that carries `rev=%d;`. This wave touches **none** of it:

- The matrix is computed at **serve time** in `cmd/api` from already-persisted rows plus the pure library. `handleRunBook` still writes nothing.
- No column is added, changed or reinterpreted. No migration; `schema_version` stays at its current value.
- `bucketIndexOf`, `histogramEdges`, `edgeWad` and `histogramComparator` are **unchanged** — `laneIndexOf` is a total extension that calls `bucketIndexOf` and adds no edge and no comparator.
- No scenario definition changes, so `scenario_config_version` is unchanged.
- The substrate digest, the registry fingerprint and the materialization key are all inputs to the *pass*, not to this handler.

**Conclusion: `AlgorithmRevision` stays 6.** `cmd/riskd/legacy_revision_live_test.go`'s pin (`must be 6 AND actually serialized`) is unaffected. If a future wave ever moves an *edge* in `histogramEdges`, that is a different question and would move both histograms and this matrix together — which is exactly the property the shared-law design buys.

---

## 9. Client-ts and web weld impact (checklist)

**`packages/client-ts/`**
1. `npm run gen` → regenerate `src/generated/schema.ts`; commit (enforced by `drift.test.ts`).
2. `src/types.ts`: add `RunBookTransitions`, `RunBookTransitionLane`, `RunBookTransitionRow`, `RunBookTransitionCell` aliases to the "Book-wide scenario run" section; add the `TRANSITION_LANE_KINDS` closed enum + `satisfies Record<>` weld; bump `CONTRACT_VERSION` to `"1.7.0"`.
3. No new client **method** — `runBookScenario` does not exist on `SolventClient` yet (`web/lib/runbook.ts` is the documented stand-in).
4. `test/readme-sync.test.ts` / `SEALED_FIELD_NAMES`: **no addition needed** — the new nullables are `NullableDecimal`, not nullable booleans. But note the analogous falsiness hazard for consumers: `Number(cell.debt_before_usd)` coerces `null` to `0`. The client-side refinement (or the docs) should state that a null cell debt means UNMEASURED and must never be coerced.
5. `test/fixtures.test.ts`: no fixture change — the committed client fixtures cover address/book/stress/observatory/meta and carry **no** run-book body.

**`web/`**
6. `web/lib/proof-contract.gen.ts` is GENERATED by `tests/fixtures/generate-proof.mjs`; regenerate rather than hand-edit. Three things move: `CONTRACT_META.version` → `"1.7.0"`, the run-book operation `description` (the new ADDED-1.7.0 paragraph), and its `example` (now carrying `hf_transitions`).
7. **Regenerate the run-book fixture family.** `web/tests/fixtures/generate.mjs` extracts the contract's 200 example verbatim into `run-book.weeth_market_depeg_oracles_held.json`, and `generate-lab-book.mjs` derives the rest from it. That is **14 files / ~253 KB** today: `run-book.{collateral-collision,collateral-collision.swap,contradictory,eth_minus_30,eth_minus_30.batch2,ethfi_minus_50.v2,named-twice,names-nobody,names-nobody.batch2,partial-hole,weeth-withheld,weeth.batch2,weeth.v2,weeth_market_depeg_oracles_held}.json`.
8. `web/lib/runbook.ts` needs **no change**: `RunBookEngine` is `components["schemas"]["RunBookEngine"]` and `LabRunBookEngine` overrides only `projection`, so `hf_transitions` flows through untouched.
9. New component. **Do not name it `LabMatrix`** — `web/app/lab/LabMatrix.tsx` is the scenario × engine matrix (Wave W-SD-A) and the collision would be a real one. Use `LabRunBookTransition.tsx` with a pure decision layer in `labTransition.ts` (the `matrixCells.ts` split). Structural requirements only (another wave owns the copy strings): it consumes `engine.hf_transitions`; ribbon/cell weight is **accounts**, with debt as the annotation; a null cell debt renders in the refusal register — the `styles.unpricedTag` named-absence pattern `LabRunBookDetail.tsx` already uses — never `$0`; one count scale within one engine's matrix; no cross-engine aggregate anywhere; the wire's `note` renders verbatim; the DM comparator gets no crit tint, matching the existing `eligibleTint = comparator === "hf_wad"` asymmetry.
10. `web/app/lab/labRunBookLines.ts`: `histogramShiftReadingLine`'s NET disclosure must be **retired, not reworded** — its central claim ("compute it here (impossible from two histograms)") becomes false the moment this ships, and a stale impossibility caveat beside a served gross count is itself a D-013 defect. The derivation changes from `belowOne(after) − belowOne(before)` (a difference of populations) to `Σ cells where to ∈ below-one lanes and from ∉ below-one lanes` (a gross crossing count), with the DM comparator still labeled a disclosure.
11. Backward compatibility note: a 1.6.0-generated *validator* with `additionalProperties: false` will reject a 1.7.0 body. That is inherent to this contract's style and was equally true at 1.6.0; readers that merely index fields are unaffected. Worth one line in the release note.


---

## Invariants claimed

1. LANE VOCABULARY: len(hf_transitions.lanes) == len(histogramEdges) + 2 == len(rows) == len(to_accounts); lanes[i].index == i for all i; lanes[0..N-1].kind == "bucket" and equal the served hf_histogram.buckets[i] in label, lower_wad and upper_wad byte for byte; lanes[N].kind == "infinite"; lanes[N+1].kind == "refused".
2. ROW MARGIN (the headline law): for every lane i, sum over rows[i].cells of accounts == rows[i].from_accounts == beforeTally(i), where beforeTally(k) is before.hf_histogram.buckets[k].count for k < N, before.hf_histogram.infinite_count for k == N, and before.hf_histogram.refused_count for k == N+1.
3. COLUMN MARGIN: for every lane j, sum over all rows of the accounts in the cell with to == j equals to_accounts[j] == afterTally(j), with afterTally defined against after.hf_histogram by the same three-way rule.
4. GRAND TOTAL PARTITION: sum over every cell of accounts == accounts == before.accounts + unmeasured_accounts == after.accounts + unmeasured_accounts. No position is in two cells and none is in zero cells.
5. DIAGONAL PARTITION: held_accounts + moved_accounts == accounts, where held_accounts is the sum over cells with from == to and moved_accounts the sum over cells with from != to.
6. SPARSITY IS TOTAL: every emitted cell has accounts >= 1; within a row the `to` values are strictly ascending and unique; a lane pair absent from `cells` holds exactly zero accounts (a knowable zero, made complete by the dense lanes/rows/to_accounts arrays).
7. UNMEASURED ROWS LIVE ON ONE CELL: sum over all cells of unmeasured_accounts == hf_transitions.unmeasured_accounts == the count of rows this layer could not rebuild on this engine (`refusedByEngine[engine]`), and every one of them sits in the cell (laneRefused, laneRefused). No other cell has unmeasured_accounts > 0.
8. UNKNOWABLE NEVER ZERO: a cell with unmeasured_accounts == accounts carries debt_before_usd == null AND debt_after_usd == null. A cell with unmeasured_accounts < accounts carries non-null exact decimal strings on both. The string "0" is never served for a population the run did not measure.
9. KNOWABLE ZERO IS SERVED AS ZERO: cells on the infinite lane carry debt_before_usd == "0" and debt_after_usd == "0", never null — a no-debt account's debt is knowably zero; it is the health factor that is unbounded.
10. DEBT RECONCILES PER SIDE: sum over all cells of debt_before_usd (as big.Int over the decimal strings, nulls skipped) == before.total_debt_usd exactly; sum of debt_after_usd == after.total_debt_usd exactly. Both are in this engine's own usd_decimals and are never added to another engine's.
11. ONE BUCKET LAW: every lane assignment routes through laneIndexOf, which calls bucketIndexOf; the histogram tally and the lane record are written by the single `runMeasure.bucket` call, so no code path can increment one without appending the other.
12. PAIRING IS POSITIONAL AND GUARDED: len(before.lanes) == len(after.lanes), and before.lanes[k].account == after.lanes[k].account for every k. A violation is a 500 with a named reason, never a served matrix.
13. COMPARATOR AGREEMENT: hf_transitions.comparator == before.hf_histogram.comparator == after.hf_histogram.comparator, and hf_transitions.wad_scale == risk.WadUnit().String() == both histograms' wad_scale.
14. DETERMINISM: two runs of the same batch and scenario serve byte-identical hf_transitions — rows in lane order, cells ascending by `to`, no map iteration reaching the wire.
15. BOUNDEDNESS: emitted cells per engine <= (len(histogramEdges) + 2)^2 == 100, independent of the number of positions in the book.
16. NOTHING PERSISTED CHANGES: riskfeed.AlgorithmRevision stays 6, the store schema_version is unchanged, scenario_config_version is unchanged, and TestAPIIssuesNoWritingSQL still passes over cmd/api.

## Open questions

- ONE DEBT FIGURE OR TWO PER CELL? RECOMMENDATION: two (debt_before_usd and debt_after_usd). A single figure cannot conserve on both margins because the shock moves debt: Aave's total_debt_base is priced (MulDivCeil(live_debt, price, den) in internal/risk/aave.go:182), so stable_depeg_098_unsnapped changes it between sides while DM borrowings (a persisted USD figure) do not. With one figure, either the row sums or the column sums would fail to reconcile with the aggregate totals, and the reader would have no way to know which. Cost is ~80 bytes per occupied cell. If forced to one, pick debt_after_usd (the state the destination lane describes) and say so loudly in the note — but I do not recommend it.
- SPARSE OR DENSE CELLS? RECOMMENDATION: sparse cells, dense lanes/rows/to_accounts. Dense cells cost ~17 KB per engine (+163% on the 20,862-byte contract-example body); sparse costs ~0.3-3.5 KB (+22% on the example). Absence is honest here only because both margins and the full lane vocabulary are served densely beside it, and the note must say so explicitly. If the integrator prefers the repo's stable-shape instinct all the way down, dense cells are defensible but should be measured against the fixture-family size first.
- SHOULD held_accounts AND moved_accounts BE SERVED, OR LEFT DERIVABLE? RECOMMENDATION: serve them. They are the numbers the reading line needs, moved_accounts is the specific quantity the current web disclosure says is impossible, and `held + moved == accounts` is a cheap machine-checkable partition. This is checked redundancy, the same category as repeating wad_scale on each histogram.
- PER-CELL COLLATERAL AS WELL AS DEBT? RECOMMENDATION: no. It would roughly double the cell payload for a quantity the flow view does not need, and collateral_by_asset already decomposes each side. Revisit only if a collateral-weighted Sankey is actually requested.
- PER-CELL ACCOUNT IDENTITIES? RECOMMENDATION: no. The list is unbounded in the book size, and `movers` is already the bounded identity surface with its cap disclosed. A cell that named its accounts would be a second, differently-ranked, uncapped movers list. If drill-down is wanted later, add a separate bounded endpoint rather than inflating this one.
- FIELD NAME: hf_transitions vs transitions vs hf_transition_matrix. RECOMMENDATION: hf_transitions — it parallels hf_histogram (the register's existing hf_ prefix for anything stated on the health-factor comparator) and it reads correctly on both engines, where the DM's lanes are a disclosure rather than a health factor per se.
- LABELS FOR THE TWO NON-BUCKET LANES. These are new server-owned strings that will appear in the captured contract example and, verbatim, in the UI. RECOMMENDATION: "no debt (unbounded)" for the infinite lane and "no comparator" for the refused lane — both echo the histogram's own note vocabulary. Confirm with whoever owns the copy register before capture, because changing them later means re-capturing the contract example and regenerating 14 web fixtures.
- SHOULD A PROJECTION OR MARKET-REALIZATION SCENARIO CARRY A MATRIX AT ALL? Both are exactly diagonal by construction (afterInputs == beforeInputs, or oracle marks held). RECOMMENDATION: serve it. A diagonal matrix is a true and independently computed statement ("this scenario moved no account between lanes") that corroborates hfs_unchanged from a second direction, and making the field conditional would turn its absence into an ambiguous signal.
- RETIRE OR REWORD histogramShiftReadingLine's NET DISCLOSURE? RECOMMENDATION: retire the impossibility clause outright. Its claim ("compute it here (impossible from two histograms)") becomes false when this ships, and a stale impossibility caveat printed beside a served gross count is itself the D-013 defect class. Note this crosses into the concurrent copy-rewrite wave's territory — the DERIVATION change (net difference of populations -> gross off-diagonal sum) is structural and belongs to this wave; the sentence belongs to theirs, and the two must land together or the page will contradict itself.
- MATRIX ON RunBookEngine OR DUPLICATED PER AGGREGATE? RECOMMENDATION: RunBookEngine. It is a joint over both sides and is a property of neither one; putting it on RunBookAggregate would either duplicate it or force one side to carry a field the other cannot.
- SHOULD THE MIS-PAIRED-ZIP GUARD 500 OR DEGRADE? RECOMMENDATION: 500 with a named reason, matching the existing "applying scenario ... refused a verified position" path. Inputs here are reconstruction-verified and the two sides are index-aligned by construction, so a mismatch is a defect in the serve layer, not a property of the data — and a matrix with wrong margins is exactly the artifact this wave exists to make unconstructible.
- CLIENT-SIDE MARGIN VALIDATION IN web/: should the Lab refuse to render a matrix whose margins disagree with the served histograms? RECOMMENDATION: yes, following the matrixCells.ts precedent ("nothing is classified before it is validated", the CONTRADICTORY BOOK state). The body can arrive from an older or a broken deployment, and rendering a Sankey whose ribbons do not sum to the bars printed beside them is a wrong answer to an honest user.

## Cost notes

SIZE — bounded by lanes, not by the book. laneCount = len(histogramEdges) + 2 = 8 + 2 = 10 (histogramEdges is the 8-entry table at cmd/api/handlers.go:392-404). Cells per engine are therefore <= 100 whether the book holds 4 positions or 400,000, and committed scenarios name at most 2 engines (internal/risk/scenarios/eth_minus_10.json: ["aave_v3_etherfi","debt_manager"]).

MEASURED BASELINE: web/tests/fixtures/run-book.weeth_market_depeg_oracles_held.json is 20,862 bytes — the contract's own 200 example, two engines, extracted verbatim by generate.mjs. The full run-book fixture family is 14 files / 253,028 bytes.

PER-ELEMENT BYTES: one cell {"to":9,"accounts":123456,"debt_before_usd":"<21 digits>","debt_after_usd":"<21 digits>","unmeasured_accounts":0} ~= 139 B (150 B used for headroom; 21 digits covers Aave 8-decimal USD over an entire book). One lane ~= 85 B (non-bucket, both wads null) to 115 B (bucket with both edges); no per-lane note, which saves ~1.5 KB/engine. One empty row stub {"from":4,"from_accounts":0,"cells":[]} ~= 30 B. to_accounts ~= 50 B. Top-level note ~= 650 B.

PER-ENGINE ADDITION: lanes ~1.05 KB + 10 row stubs ~0.30 KB + to_accounts ~0.05 KB + note ~0.65 KB = ~2.05 KB fixed, plus 150 B per occupied cell.
  - contract example (2 occupied cells/engine): ~2.35 KB/engine -> body ~25.6 KB, +22%.
  - realistic shocked book (10-25 occupied cells/engine): ~3.5-5.8 KB/engine -> body ~29-33 KB, +40% to +58%.
  - dense worst case, all 100 cells occupied: 100 x 150 B + 2.05 KB = ~17.0 KB/engine -> body ~54 KB, +163%. This number is the entire argument for sparse cells.

COMPUTE: two extra slice appends per position (one per side) inside walks that already compute the health factor, the bucket index and the debt; one O(P) zip per engine where P is that engine's position count; one O(occupied cells) emit with no sort (rows emit in lane order by index, cells ascending by `to` by index). Zero additional database reads and zero additional risk.Waterfall evaluations. For comparison, handleRunBook today already runs two full measureRunBook walks over the book plus two whole-book risk.Waterfall evaluations at the identity grid point (cmd/api/p5_runbook.go:449, 492, 723) — this addition is well under 1% of that work.

MEMORY: two []runLaneEntry slices of P entries each, ~40 B/entry (common.Address 20 B + int + *big.Int + bool, padded). At P = 10,000 positions that is ~800 KB transient per request, freed with the request. The existing states map[common.Address]*runAccountState already allocates one entry per account per side, each holding up to four *big.Int, so the lane slices are strictly cheaper than what the handler already allocates. A zero-extra-memory variant exists (store `lane int` on runAccountState and zip over sorted accounts) but it gives up marginal agreement BY CONSTRUCTION — it becomes contingent on the risk_positions PRIMARY KEY (batch_id, engine, account) holding, and on len(states) equalling the per-position tallies. Not recommended at this cost.

LATENCY: dominated entirely by the two existing whole-book Waterfall evaluations. The matrix adds one linear pass and a bounded emit; it is not measurable against them.

NO PERSISTED COST: nothing is written, no column is added, no migration runs, riskfeed.AlgorithmRevision stays 6 (internal/riskfeed/assemble.go:126), and TestAPIIssuesNoWritingSQL continues to hold over cmd/api.

---

## ADVERSARIAL VERIFY: DEFECTIVE (9 findings)

### Finding 1

**[D-013, confirmed on the contract's own example] `held_accounts` counts rows nobody measured as "did not change", and `moved_accounts: 0` claims a measurement nobody made.** `held_accounts` is the diagonal, and by the spec's own §2.2 every unrebuildable row lands on cell (9,9) because `handleRunBook` folds it onto BOTH sides (`cmd/api/p5_runbook.go:581-584`: `eb.refused += n; ea.refused += n`). Wrong number: in the contract's declared 200 example the Aave row would serve `accounts: 2, held_accounts: 2` where exactly ONE account was ever computed; on an all-refused engine (`before[engine] == nil` → `newRunMeasure()`, every row in `refusedByEngine`) it serves `held_accounts: N, moved_accounts: 0`, which an honest user reads as "this scenario moved nobody on this engine" over a book where nothing was measured. The repo already ledgered and refused exactly this: `web/app/lab/labRunBookLines.ts:36-41` defines `measuredCount` as buckets + infinite_count, deliberately EXCLUDING `refused_count`, and lines 91-97 return "This scenario measured no account on this engine, so there is no shift to read" with the comment "'0 accounts moved' would claim a measurement nobody made." The spec regresses a named guard. Fix: compute `held_accounts`/`moved_accounts` over the MEASURED population only and make the partition `held + moved + unmeasured == accounts`, or drop both scalars and let the matrix speak.

### Finding 2

**[Confirmed false citation, ships as a served pointer to an empty array] `unmeasured_accounts` is NOT "rows this layer could not rebuild" and is NOT in `coverage.excluded`.** Invariant 7, §2.2 and §4.5 note claim 5 all assert that identity. `handleRunBook` counts `p.input == nil` (`cmd/api/p5_runbook.go:425-431`), but `reconstructAll` never even attempts a row whose `Status != store.RiskPositionComputed` (`cmd/api/read.go:692-707`), so `p.input == nil` = {rows riskd itself REFUSED} ∪ {reconstruction failures}. `coverage()` puts only `p.reconstructionErr != ""` rows into `excluded` (`cmd/api/handlers.go:700-713`); riskd-refused rows go to `refused_in_batch`. The example's two refused rows are `fxAaveRefused` / `fxDMRefused`, both `Status: store.RiskPositionRefused` (`cmd/api/fixture_test.go:254` and `:426`), so the committed body carries `excluded_by_this_layer: 0`, `excluded: []`, `stress_coverage_is_full: true` (`api/openapi.yaml:1325-1331`). Wrong reading: the contract example would ship `unmeasured_accounts: 1` on each engine with a server-composed note directing the user to an empty `coverage.excluded` in the same body, and would relabel an UPSTREAM riskd refusal (missing price witness, never-swept collateral) as a serving-layer reconstruction failure — a refusal named as the wrong thing. §7.3's `TestRunBookServesTheTransitionMatrix` enshrines the same wrong claim. Fix: name the population "rows that reached no arithmetic", point at `coverage.refused_in_batch` AND `coverage.excluded`, and either split lane 9's count by the two reasons or state that it spans both.

### Finding 3

**[Confirmed unreachable branch — a test that cannot fail, and a lane label describing a population that never exists] `runMeasure.refused` is structurally always 0 in this path, so §2.2's "two distinct populations reach lane 9" is fiction.** Population 1 is claimed to be "Aave `hf_wad == nil` while not infinite; DM `hf_den <= 0`". Neither is constructible: `aave.go:239-247` sets `HealthFactorWad` exactly when it sets `IsInfinite = false`, and `math.go:275-278` returns `ok=false` only for `totalDebtBase <= 0`, so Aave's `st.hfWad` is nil iff `st.infinite`, which `bucket()` tests first (`p5_runbook.go:266-269`). DM sets `st.hfNum/hfDen` only `if !h.IsInfinite` (`p5_runbook.go:707-709`) and `dm.go:171` makes `!IsInfinite ⇔ borrowings > 0`, so `hf_den <= 0` cannot occur. `bucketIndexOf` therefore never returns −1 from this walk. Consequences: `refused_count` is 100% the `refusedByEngine` fold; the "MIXED cell" the design is built around is unreachable, so `TestRunBookTransitionNeverRendersAnUnmeasurableDebtAsZero`'s mixed branch is a guard that cannot fail; and lane 9's contract label "no comparator" and the note's "rows carrying no comparator, INCLUDING rows this layer could not rebuild" invert the truth — it is only ever rows nothing was computed for. Fix: label lane 9 "not measured", state that cell (9,9) always has `unmeasured_accounts == accounts`, and delete the mixed-cell machinery or prove a reachable case first.

### Finding 4

**[D-013] `moved_accounts` is a bucket-edge-crossing count sold as "the GROSS count the two histograms structurally could not give", and it contradicts the two movement counts beside it.** On an existing committed fixture — `seedMixedDirectionBatch` + `eth_minus_30`, `cmd/api/p5_runbook_bsplit_db_test.go:252-330` — A goes 1.20→0.84 (lane 4→0), B 1.08→0.756 (3→0), C 0.74375→1.0625 (0→3). The engine row would serve `moved_accounts: 3` immediately beside `movers_total: 2` and `newly_eligible_accounts: 1`, under a description using the exact phrase the repo reserves for crossings of the 1.00 edge (of which there are 2 down, 1 up). The converse is worse: a book where every health factor drops 20% without leaving its bucket serves `moved_accounts: 0` beside `movers_total: N`. `moved_accounts` is a function of the arbitrary `histogramEdges` table (`cmd/api/handlers.go:392-404`), not of the scenario, and §4.5's seven required note claims disambiguate neither hazard. Fix: rename to `lane_changed_accounts` and require the note to state (a) a move inside one bucket is not counted, (b) this is not `movers_total` and not a crossing count of any particular edge.

### Finding 5

**[Invariant 9 contradicts invariant 10; and `moved_accounts`'s stated scope is unreachable] The infinite-lane debt rule is stated over all lane-8 cells but is only sound on the diagonal.** "Cells on the infinite lane carry debt_before_usd == '0' and debt_after_usd == '0', never null" applied to a cell (from = bucket i, to = 8) would serve "0" for accounts whose BEFORE debt is positive by construction, and would break invariant 10 (Σ debt_before_usd == before.total_debt_usd) by exactly that amount. It is unreachable today, but the spec never proves it and the proof cuts against the spec elsewhere: `ApplyScenario` shocks PRICES only (`internal/risk/scenario.go:677-751`) and copies DM debt verbatim (`cp.DebtUSD = copyBig(in.DM.DebtUSD)`, line 779), while Aave debt is `MulDivCeil(LiveDebt, price, den) >= 1` for any positive leg and a non-positive price is refused (`indexPrices`, `aave.go:299`). So lane 8 and lane 9 are both FIXED sets across the shock — which directly refutes `moved_accounts`'s served description, "It counts any lane change, including into or out of the no-debt and no-comparator lanes": no account can enter or leave either lane under any of the 15 committed scenarios. Fix: scope invariant 9 to cell (8,8), derive every cell's debt from its own side rather than from its lane, and delete the "into or out of" clause from the schema description.

### Finding 6

**[False claim in a server-composed contract sentence] §3's "the matrix is exactly diagonal … a second, independently computed witness of the same claim" for `hfs_unchanged` is not a witness of anything.** `hfs_unchanged` comes from `risk.ExecutionShortfall(beforeInputs, sc.MarketRealizationsFor())` (`cmd/api/p5_runbook.go:501-508`), which compares health factors under the MARKET-REALIZATION axis; the matrix's diagonality comes from `ApplyScenario` over `weeth_market_depeg_oracles_held`'s empty shock set (`internal/risk/scenarios/weeth_market_depeg_oracles_held.json` has `shocks: []`). Different input, and strictly weaker: because the matrix buckets, it stays diagonal for ANY health-factor movement that does not cross an edge. Wrong reading: a user told the diagonal witnesses `hfs_unchanged` concludes the two sides' health factors are bit-identical, which the matrix cannot establish. Fix: delete the witness claim; keep only "this scenario moved no account between lanes".

### Finding 7

**[Claim about the data contradicted by another served surface] "The row this layer could not rebuild … carries NO numbers on either side" is false, and it is repeated in §2.2, the §5 example comment and §4.5 note claim 5.** `fxDMRefused` carries `Borrowings: bi("1500000000")` (`cmd/api/fixture_test.go:431`) and `wirePosition` serves `Borrowings: bigStr(p.Borrowings)` unconditionally (`cmd/api/handlers.go:965`), so `/v1/positions` and `/v1/address/{addr}` publish 1,500.000000 USD of debt for the very row the run-book would describe as carrying no numbers. The null is correct; the justification served beside it is not, and a user reconciling the two surfaces finds a contradiction. Fix: say the RUN measured nothing for the row, not that the row holds nothing.

### Finding 8

**[Completeness law with a hole] §5's reconciliation row "`accounts` == the batch's positions on this engine" is not a law the code supports, and a third engine would silently drop rows.** `coverage.batch_positions` is `len(v.Positions)` over the WHOLE batch (`cmd/api/handlers.go:692`), including engines the scenario does not cover and withheld engines; `hf_transitions.accounts` is `m.accounts + refusedByEngine[engine]` restricted to covered, non-withheld engines. It coincides only because the example's batch happens to be 2+2 across exactly the two covered engines. Separately, `measureRunBook`'s switch has arms for `risk.AaveEngine` and `risk.DMEngine` only (`cmd/api/p5_runbook.go:654-718`), with no default: a position on any third engine that the scenario covers enters `run` and `beforeInputs` — and therefore `coverage.in_book` — but produces no `accounts++`, no `bucket()` call and no lane entry, so it is in zero cells while the margins still "partition exactly". Fix: state the reconciliation against `before.accounts + unmeasured_accounts` only, and make the lane walk refuse (500) rather than skip an engine it has no arm for.

### Finding 9

**[Naming defect on eight served fields, conceded by the spec itself] every `*_accounts` field counts POSITIONS, not accounts.** `m.accounts++` fires once per position (`cmd/api/p5_runbook.go:661` and `:698`), while `m.states` is keyed by `common.Address` and collapses duplicates — and §4.4 explicitly justifies positional pairing "even if a book ever carried two positions for one account", so the spec has already conceded the case exists. In that case `accounts`, `from_accounts`, `to_accounts`, `held_accounts`, `moved_accounts` and `unmeasured_accounts` all double-count that account, and `held_accounts + moved_accounts == accounts` remains true while none of the six numbers means what its name says. `before.accounts` inherits this, but `held_accounts`/`moved_accounts` are NEW account-level claims. Fix: either name them `*_positions`/`*_rows`, or state in the note that the unit is a position row on this engine, matching the vocabulary `coverage.batch_positions` already uses.

