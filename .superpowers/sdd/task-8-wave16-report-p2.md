# Task 8 — wave 16 report: Codex round-11P fixes (PRICES unit)

**Commits:** `0302352` (findings 1–3: the production text and both new regressions) →
`4d8edc7` (finding 4: the mutation applier, its spec, and the `.gitignore` rule that lets
them be tracked) → `e3fe3e8` (the fixtures' premises asserted, not just their outcomes) →
the transcript and this report.
**Base:** `4e7dbc4` — HEAD at my start, the ledger commit carrying the round-11P verdict.
The concurrent health wave landed `417e505`/`ff42a80` and its round-12 approval line
mid-wave; **all of those are markdown, zero `.go` files** (`git diff --name-only 4e7dbc4
ff42a80 -- '*.go'` is empty), so my baseline measured at `4e7dbc4` is still the baseline
for my tip.
**Returns to:** Codex, the prices CLOSING round under D-006. The health unit was **approved
at round 12H** mid-wave (`9a83816`, no material findings), so this is the last open gate on
Task 8: decode `d8c462b`, derive `3b864ac`, runner `d1e7d54` and health are closed, and
prices is the remainder.

Round 11P was `needs-attention` with **four mediums, zero behavioural — all text, test and
process**. All four are here. **Nothing in this wave changes a predicate, a decision, a
query or a transaction.** The `+2` in the test count is exactly the two new tests; no test
was deleted and no assertion was weakened.

---

## Verification

Measured from a **`git archive` export of `e3fe3e8`**, the last commit that touches a `.go`
file. The shared working tree carries the concurrent health wave's artifacts, and an export
contains committed blobs only.

| | top-level PASS | incl. subtests | FAIL | SKIP |
|---|---|---|---|---|
| Baseline `4e7dbc4` | 575 | 672 (97 sub) | 0 | 0 |
| **This wave `e3fe3e8`** | **577** | **674 (97 sub)** | **0** | **0** |

Convention (the pinned one): `go test ./... -count=1 -v`; top-level = `^--- PASS`, incl.
subtests = `^ *--- PASS`. **The baseline was measured by me** from an export of `4e7dbc4`
before touching anything — not inherited from the ledger, whose last prices figure (563/657)
predates the health wave's own tests.

`go build ./...` and `go vet ./...` clean in the export — **output read**, both silent.

**`-race` clean** for the two packages I touched — `internal/prices` **1.563s**,
`internal/store` **193.962s** — in `golang:1.24` against the live database over
`host.docker.internal`, run from the same export. Not run natively: this host has no cgo
toolchain and `go test -race` refuses outright.

**gofmt — read, and still the documented CRLF false positive.** `gofmt -l .` over the
working tree flags **10** files, including `cmd/indexer/main.go` and `internal/store/derive.go`
which this wave never touched, because `.gitattributes` + `core.autocrlf` give `.go` files
CRLF and gofmt calls a CRLF file unformatted. **Verified, not assumed:** every one of the 10
is CRLF throughout, and `gofmt -l` over LF copies of all 10 is empty — so there is no genuine
formatting defect anywhere in the tree, mine or the other wave's. The authoritative check is
the committed blob: `git show e3fe3e8:<file> | gofmt -l` is **empty for all five files I
touched**.

**Pre-commit gate:** `control-plane doctor` + `scope-gate` ran on every commit, `0 error(s),
0 warning(s)` each. Nothing bypassed, nothing force-added — including the `.gitignore` change
in `4d8edc7`, which is how the applier became trackable (see finding 4).

---

## F1 [medium] — the rejected floor was still being called the validity boundary

Wave 14 fixed this as a **composition rule** for the operator-facing text and stopped there.
The finding is that the same claim was still standing in the code's own explanation of
itself, at `poller.go:885-886` (the `floorOutcome` table footnote) and `poller.go:1106-1110`
(`verifyFloor`'s "what makes a match acceptable"). Both said everything at or below the
verified floor keeps its validity. **Wave 14's own regression falsifies that**: an offered
5000 comes back as 4999 and the row at 5000 is marked permanently.

### The rewrite

Both sites now separate the two facts that the single word "floor" had been carrying:

> A match at height H entails that H and every ancestor are unchanged on the answering
> endpoint's chain — **a fact about the CHAIN**, and the only fact verification establishes.
> What decides a row's validity is **the boundary the store RETURNS**.

and both name the two directions those numbers can separate in, because only one of them had
ever been written down:

- **DOWNWARD** — the store clamps the offer below any observation in the repair range whose
  own round left it unplaceable. A hash proof about the chain cannot place a row that never
  recorded which block it read. (Round 10P's shape.)
- **UPWARD** — the epoch's effective repair target may already sit above the offer, in which
  case the offer retained nothing extra. **This direction had no test at all**, which is
  finding 3.

### The sweep, which found a worse instance than the two cited

The class was fixed at every site, not at the citations (the lesson the ledger records from
the deriver rounds). Beyond the two named:

| site | what it said |
|---|---|
| `poller.go` `verifyFloor`, the `max(floor, target)` paragraph | stated the local maximum as if it predicted the store's answer; now says it is a LOWER BOUND and that nothing composes an operator-facing claim from it |
| `internal/prices/prices.go` package doc | "rows at or below it keep their validity — as far as the store admits the match" — half-qualified, and silent on the below-target direction |
| `internal/store/prices.go` file doc | "keeping everything at or below the first one whose hash the caller re-verified" |
| **`NeutralizeUnverifiablePrices`' own doc** | **"verifiedFloor is honoured exactly as RewindPrices honours it"** |

That last one is the one worth reading. It has been **false since the clamp landed**:
`RewindPrices` raises its target to the floor unconditionally, this call additionally clamps
it. And it sat **fourteen lines above** the paragraph that ends "THE BOUNDARY IT RETURNS IS
AUTHORITATIVE AND verifiedFloor IS NOT". The comment block contradicted itself, and the half
that was wrong is the half a reader hits first. Neither of the two cited sites would have led
anyone to it; the sweep did.

**No mutation covers F1, and it must not be reported as if one did.** It is comment text.
There is no mutation of a comment that a test can fail on. What *is* testable about the
finding is the WARN composition, and that is M1 and M10.

---

## F2 [medium] — the poller promised a reconciliation the data cannot support

Wave 14 split the **store's** classification WARN three ways and scoped hash retention to the
first — `rowsAnchored` / `rowsUnanchoredBindingPruned` / `rowsUnanchoredNeverBound`. The
poller's two WARNs kept the blanket version, *"Their provenance is retained forever (clause
2), so an offline reconciliation stays possible"*, which **contradicts that split exactly when
`rowsAnchored` is 0**.

### Why the fix is text and not a plumbing change

`NeutralizeUnverifiablePrices` returns a boundary and a total. The poller **cannot** condition
its message on the split without a signature change, and this wave is specified as zero
behavioural. So the rule applied is: *an unconditional message must be true for the worst
population it can describe.*

The generic text now claims:

- **row and value retention — unconditional.** That half of clause 2 holds for every marked
  row and is stated with no hedge.
- **recorded block hash — only where the row's own round still has an anchor**, and
  hash-based offline reconciliation for those rows *and no others*.
- **clause 2 at its actual strength**: a FORWARD guarantee that no retention bound, prune or
  rewind expires the anchor a marked row is bound to. It is not a way back to a hash that was
  never written, or that had already been swept when the marking ran. Clause 5 ratifies
  marking those rows regardless.
- and it **names the store's WARN as the only place the split is known**, rather than
  pretending to a number it does not have.

Same fix at `poller.go:1943` (the backlog WARN — the message an operator lives with for as
long as the pile lasts), and at the package docs on both sides: `internal/prices/prices.go`
(the D-012 summary, and the "differs only by carrying MORE information" sentence, which
asserted the block hash unconditionally) and `internal/store/prices.go:1296-1300`.

### The regression the finding asked for

`TestPollerNeutralizationPromisesNoOfflineRecoveryForAPrunedBinding` — a repair whose **entire**
marked population is binding-pruned, so the real store would report `rowsAnchored=0`. It
asserts both poller WARNs: the scoped sentences present, both retired blanket sentences absent
by verbatim match.

`e3fe3e8` asserts the fixture's **premise in both halves** — the binding is present *and* names
a block with no surviving anchor — because asserting only the absence would let the fixture
drift into the *never-bound* population, where the retention claim is false for a different
reason and the test would still pass. That is precisely the test-integrity failure this project
has shipped five times: the right sentence asserted about the wrong population.

---

## F3 [medium] — the one disposition arm nothing asserted

`floorDisposition` partitions four outcomes. `admitted`, `clamped` and `none-offered` each had
a test. `below-target` had none.

`TestPollerFloorBelowTheEpochsRepairTargetIsReportedAsBelowTarget` (live in the poller's own
harness, chain fake with per-endpoint views):

- Anchors at 5100 (replaced) and 4900 (still canonical); the walker rewound only to **5000**.
- Verification probes 5100 → mismatch, 4900 → match, and **offers 4900**.
- The store returns **5000**, because a floor cannot lower a boundary.
- `floorDisposition=below-target`, `validAtOrBelow=5000`, `floorOffered=4900`, and the
  justification composed from the returned boundary.

**The fixture carries a row at 4950 to make the direction concrete.** It is at or below the
returned boundary, so the store leaves it valid and readable; it is above the offered floor. A
WARN naming 4900 as the validity boundary would tell the operator that a perfectly good price
is lost. That is the mirror image of round 10P's finding — same mistake, composing the sentence
out of the number that was *asked for* rather than the one that came back — and only one
direction had a regression.

**This is not a contrived shape.** Poll rounds anchor at cadence, so anchors are sparse
relative to blocks (~30 blocks apart on chain 10 at a 60-second interval) and a walker rewind
lands *between* two anchors as a matter of course.

`e3fe3e8` adds the **pass shape** — `hashCalls` and the endpoint that answered each — so the
test cannot be satisfied by a poller that reports `below-target` while verifying nothing.

---

## F4 [medium] — the applier is now a committed, re-runnable artifact

Every wave since 5 reported a mutation matrix produced by an applier that lived only in a shell
history and in the prose of each report. A matrix is evidence **about the tests**, and evidence
nobody can inspect or re-run is an assertion.

`.superpowers/sdd/wave16-mutations/` now holds:

- **`mutate.py`** — the applier, with the exactly-one-occurrence assertion in `apply_edit`
  where a reviewer can read it.
- **`mutations.json`** — the mutation set as data, each row stating the **property** the
  behaviour should have, plus a `meta` block recording what is **not** mutation-testable here.
- **`transcript-e3fe3e8.md`** — the authoritative run: the tested SHA, the applied diff and
  reported line number for every edit, the exact test command, the tests that failed, and the
  restore verification.
- **`transcript-4d8edc7.md`** — the earlier run, kept rather than deleted. It is the same seven
  mutations against the same production code before `e3fe3e8` strengthened the two fixtures.
  Both are here because deleting a run that happened is not how this wave wants to be read.

### What the assertion is for, and why it is the load-bearing line

```python
count = data.count(needle)
if count != 1:
    raise NotApplied(...)
```

- **Zero** means the pattern never matched — wave 12's CRLF trap, where `perl -0pi` patterns
  containing `\n` silently matched nothing and every such mutation would have been recorded as
  **SURVIVED for a mutation that was never made**. A green suite vouching for coverage that was
  never exercised is worse than no matrix.
- **Two or more** means the edit is ambiguous: it mutates sites the author did not enumerate,
  and a kill could then be attributed to the wrong one.

Both refuse, and the driver will not run a test for an edit that did not apply.

The other standing rules are **enforced by the script rather than remembered**: files are read
and written as **bytes** (CRLF working tree), the run **refuses to start** if any target differs
from HEAD, restores come from **in-memory copies taken before each edit and never from `git
checkout`** (the rule violated twice, in waves 6 and 12, each time destroying a concurrent
wave's uncommitted work), and the run **aborts** if a restore is not byte-identical.

### The `.gitignore` change, disclosed because it widens what is tracked

`.superpowers/sdd/.gitignore` was `*` + `!.gitignore` + `!*.md`, so a `.py` and a `.json` were
unreachable. It gains a class rule — `!*-mutations/` plus `*.py` and `*.json` inside it — not an
entry for this directory. Transcripts are markdown and were already covered. The ~1.9MB of
`review-*.diff` exports stay ignored. **Nothing was force-added.**

---

## Mutation matrix

Run against **committed** work, at the tested SHA the transcript names, through the committed
applier. Every row states the PROPERTY, because a killed mutation only shows the tests are
load-bearing on *current* behaviour and is silent on whether that behaviour is right.

| # | mutation | property it attacks | result |
|---|---|---|---|
| M1 | the WARN reports `validAtOrBelow = floorOffered` | the validity boundary an operator reads is the one the store RETURNED | KILLED |
| M4 | the unanchored split collapses to one bucket (all never-bound) | a DANGLING binding is attributed to a pruned anchor, not to a round that never recorded one | KILLED |
| M7 | `unprovableRow` drops `a.chain_id = $1` | provenance is chain-scoped; 00005 cannot enforce it because `chain_id` is outside the anchors' key | KILLED |
| M8 | `floorDisposition`'s none-offered arm returns `admitted` | an arm that offers no floor says so | KILLED |
| **M10** | **`floorDisposition`'s below-target arm returns `admitted`** | **a floor the boundary rose ABOVE was not admitted at its own height** | **KILLED** |
| M11 | the neutralize WARN restores the blanket retention claim | hash-based reconciliation is promised only where a surviving anchor exists | KILLED |
| M12 | the backlog WARN restores the blanket retention claim | the long-lived message is scoped the same way as the one-shot one | KILLED |

**7 mutants, 7 killed, 0 survived**, and three results are worth naming individually:

- **M10 is killed by exactly one test — the new one.** Before this wave the arm had no
  assertion anywhere and this mutation would have survived. That is finding 3 measured rather
  than asserted.
- **M11 and M12 are each killed by exactly one test — the new pruned-binding one.** The
  retention text had no regression before this wave either.
- **M7 is killed only by `TestProvenanceReadsAreScopedToTheirOwnChain`**, reconfirming wave
  14's measurement through the committed applier rather than repeating it as a claim. M4 is
  killed by three store tests and, as wave 14 recorded, the never-bound test still passes under
  it — which is what shows the two populations are genuinely discriminated.

After the loop, `git status --porcelain` over the mutated files is empty: both files are
byte-identical to the tested SHA. The transcript states this and the driver would have aborted
otherwise.

---

## Anything unverified, and the disclosures

- **F1 has no mutation and cannot have one.** It is comment text. The `meta` block in
  `mutations.json` says so in the artifact itself, so a future reader of the matrix cannot
  mistake seven killed mutants for coverage of all four findings.
- **The poller still cannot report the anchored/unanchored split**, and this wave deliberately
  did not give it the ability. `NeutralizeUnverifiablePrices` returns a boundary and a total;
  plumbing the split up would be a signature change, and the round is specified as zero
  behavioural. The consequence is disclosed in the code: the poller's message is scoped to what
  is true for every population and points at the store's WARN for the counts. **If Codex wants
  the poller to name the split, that is a behavioural change and belongs in a wave that says
  so.**
- **The pruned-binding fixture is poller-level, so the split itself is not observed** — the
  fake store models rows, bindings and anchors, not the store's classification CTE. What the
  test observes is the population (binding present, anchor absent, one row marked) and the
  poller's text. The store side of the same population is already pinned live by
  `TestARetentionPrunedAnchorIsNeverRecreatedAfterARestart`.
- **`clamped` still does not distinguish a partial clamp from a floor refused outright** on the
  poller side. Unchanged from wave 14, deliberate, and the store's own three WARNs make the
  distinction where the number lives.
- **Three assertion messages in older tests still say "at or below the verified anchor"**
  (`poller_test.go:657`, `:1351`) where the fixture admits the floor in full, and both name the
  cursor equal to the floor two lines away. They are locally true. The one at `:880` said the
  floor is *what keeps a row valid*, which is the class rather than an instance, and it was
  swept in `e3fe3e8`.
- **The two transcripts differ only in the SHA and in which tests killed M1/M10/M11/M12** — the
  earlier run predates the strengthened fixtures. Neither run had a survivor.
- **`internal/store/derive.go` was not touched**, nor was anything outside the prices unit. The
  touched set is `internal/prices/{poller,prices,poller_test,prices_test}.go`,
  `internal/store/prices.go`, and `.superpowers/sdd/**`.
- **The ledger (`progress-phase2.md`) is not updated by this report.** The concurrent health
  wave has been appending to it all session; the wave line is left to the controller to avoid
  two writers on one file.
