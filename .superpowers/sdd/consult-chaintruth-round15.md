# chain-truth consult — Codex round-15 vs the wave-14 bounded retention lease (input to wave-17 brief)

- **Subject:** the five round-15 findings (`task-9-codex-round15.md`) against the wave-14
  probe machinery (`internal/ingest/walker.go`, target `b9c5c33`; line refs verified
  current at HEAD), plus the controller's provisional total-ordering direction.
- **Constitution read:** progress-phase2.md (full, incl. :80 round-2 law verbatim, :100
  round-12 adjudication, :106 wave-14 recovery), task-9-wave14-report-p2.md,
  task-9-codex-round12.md, consult-chaintruth-walker-rotation.md (the annex — F3/F4 and
  the Q3 discard rules), walker.go, walker_fake_test.go, walker_latency_test.go,
  cmd/indexer/main.go:640-718, walker_latency_scheduling_test.go, chain.go:24,
  snapshot.go:159, poller.go:200.
- **Verdict, one line:** CUSTODY HOLDS across all five finding-classes (no wrong bytes
  persist; these are availability, scheduling and adjudication-evidence defects). The
  controller's provisional total ordering is CORRECT for the landed and caught-up probe
  postures and WRONG for the failure posture, and its finite-bound claim is FALSE for
  n≥3 without one addition (probe-target cycling). One new blocking constraint the round
  missed: probe Steps currently carry rewind authority. Full lists at the end.

---

## Q1 — The probe-outcome total ordering

### The corrected ordering (binding)

The provisional direction folds five postures into one REJECT arm. Three of them belong
there; the failure posture must NOT, and the seam law itself says why. The law's
antecedent is verbatim at ledger :80: *"once a serving endpoint is resolved, EVERY
non-landing outcome advances the caller-scoped exploration start."* The ordering that
survives adversarial scheduling:

| probe Step posture | ruling | mechanism |
|---|---|---|
| LANDED, witness ≠ incumbent, strictly faster (per-witness measure, Q3) | **ADOPT** | shipped (`walker.go:368-377`); adopted lease starts at 1 if over budget |
| LANDED, witness ≠ incumbent, no faster / tie | **REJECT + re-arm in full** | shipped (`walker.go:379-383`); startPref never moved, so return is a routing no-op |
| LANDED, witness == incumbent (fall-through: probed neighbour down/hung, walk wrapped) | **REJECT + re-arm in full** — CHANGED from "lease stays spent" (`walker.go:388-390`) | this is finding 2's per-Step timeout-tax fix: the liveness owed a recovering neighbour is paid once per spent lease, at the NEXT expiry, not every Step |
| CAUGHT-UP (probed witness answered head; no window attempted) | **REJECT + re-arm in full** — CHANGED from "leave lease untouched" (`walker.go:497-502`) | finding 1's fix: the armed state lives exactly ONE Step; next Step starts at the incumbent |
| NON-LANDING with a resolved witness (error/discard served by anyone) | **NOT special-cased — the wave-12 seam arm stands verbatim** (`walker.go:503-511`): advance past the Step's serving endpoint, lease dissolves | see the refutation below; in n=2 this IS return-to-incumbent (probe+1 ≡ incumbent), so the outcomes coincide exactly where the provisional direction is right |
| TOTAL resolution failure (no endpoint answered the head read) | **joins the seam as a witness-less arm** (closing finding 2's bypass at `walker.go:466-471`): startPref UNCHANGED, lease state PRESERVED (count, baseline, armed flag) | the law's antecedent is unsatisfied — no serving endpoint was resolved — so keeping the start is not an exception to the law, it is outside it; the current bypass is behaviorally identical for this posture but structurally lawless, and any future arm added to the handler misses these Steps |

**Why reject-on-FAILURE is refuted (blocking against the provisional direction as
written).** Schedule: n=3, incumbent A slow-landing, neighbour B content-broken (answers
the head, discards every window — the S1/S2 class from the annex), C fast. Under
"failure → return to incumbent + re-arm": every spent lease probes B (target is always
startPref+1), B fails, the stream returns to A, re-arms, and C — the fast healthy peer —
is NEVER visited. The round-12 pin recreated one level up, permanent, with the fix
installed. Under the seam arm kept as-is: probe B → discard → seam advances startPref to
C → next Step starts at C as an ORDINARY Step (lease dissolved) → C lands fast → retention
C. Escape at Step L+2. The seam law is not just compatible with the fix; it is the fix.

**The n≥3 shield — a starvation schedule BOTH rounds missed (new, binding).** The
rejection arms (no-faster and caught-up) return to the incumbent without advancing
anything, and the probe target is a pure function of startPref. So any neighbour at
startPref+1 that always produces a REJECTED-but-non-failing probe shields every endpoint
behind it forever:

- A lands 174s, B lands 175s (no faster → rejected every lease), C lands 5s: C never
  probed, pin at A forever — the round-12 shape at n=3;
- A slow, B frozen-caught-up (finding 1's B), C fast: every probe captured by B's
  caught-up answer, rejected, C never probed.

With today's production posture (2 endpoints per chain) these schedules are
unreachable, but the wave-14 report states the escape bound as a general property and
wave 17 re-states it; a bound that is false at n=3 cannot ship as stated. **Prescription:
a per-walker probe-target cursor** — on every probe REJECTION (no-faster, tie,
caught-up, fall-through) the next spent lease probes `incumbent + 1 + offset`, offset
cycling 1..n−1; reset offset on adoption and on any seam non-landing advance. One int,
single-writer, seam untouched, startPref untouched, hint untouched. At n=2 the offset
cycle is {1} and every existing trace is byte-identical, so the shipped regressions
(`walker_latency_test.go:99,149`) stay green unmodified.

**Why the witness-less arm PRESERVES rather than resets the lease.** Reset was the
tempting reading ("consecutive premise broken") and it is wrong: a slow incumbent plus a
flapping network (total-failure blip every < L landings) would reset the count forever —
probe suppression with NO compensating routing move, the fail-forever shape this repo
keeps paying for. A witness-less failure is evidence about nobody; the landings on
either side of it are still consecutive landings on the incumbent. Preserving the count
keeps the pin-escape property under flapping; the stale-baseline cost (adjudicating a
post-outage probe against a pre-outage baseline) is one possibly-wrong adoption per
lease and self-corrects at the adopted endpoint's own lease. Redefine the field doc
accordingly (`walker.go:126-135`: "witness-less total failures interrupt nothing").

### The finite bounds, stated (both pathological schedules + the new one)

Let L = MaxConsecutiveSlowLandings (3), R = stepMaxPinnedReads (6), T = attempt timeout (30s).

- **Round-12 schedule** (A just-below-timeout, B fast, n=2): unchanged — escape at Step
  L+1 after pathology onset, wall ≤ (L+1)·R·T = 12 min, pinned by
  `TestSlowSuccessfulEndpointIsEscapedWithinTheStatedBound`.
- **Round-15 finding-2 schedule** (A lands 6×29s, B hangs to T, n=2 — no faster peer
  EXISTS): there is no escape target, so the correct property is bounded probe TAX, not
  escape. Post-fix cycle = L slow landings + 1 fall-through probe per lease; extra cost
  ≤ 1·T per (L+1) Steps (B's hung resolution attempt, paid once), amortized ≤ T/(L+1) =
  7.5s/Step ≈ 4.3% over the 174s pathological baseline, zero landings sacrificed.
  Pre-fix: +T EVERY Step and Codex's ~17-minute round. Worst single stepWalkers round
  post-fix carries at most 2 probe Steps ⇒ probe tax ≤ 2T = 60s/round on top of the
  fleet's genuine slowness. If a fast C also exists (n≥3, B hung): the resolution walk
  skips hung B into C within the FIRST probe Step; per-witness measurement (Q3) adopts C
  — escape at Step L+1 still.
- **The shield schedules (n≥3)**: with target cycling, every neighbour is measured once
  within n−1 spent leases, so escape ≤ (n−1)(L+1) Steps, wall ≤ (n−1)(L+1)·R·T (n=3:
  24 min once, versus infinite without cycling). This is the general bound wave 17
  should state; the n=2 instance reduces to the shipped 12-min bound.
- **A-bounce family**: reject+re-arm is periodic with period L+1, every Step lands,
  startPref never moves, hint untouched — trace `[0,0,0,1]*`, already pinned by
  `TestSlowerProbeReturnsToTheIncumbentAndReArmsTheLease`. No schedule found where
  reject-and-re-arm bounces: a rejection consumes exactly one Step per lease and that
  Step either lands (fall-through / no-faster) or is a caught-up; the only
  non-landing probes flow through the seam, which is the anti-bounce machinery already
  reviewed. The incumbent "buying 3 more slow landings between probes" happens only when
  every measured alternative was no better — in which case there is nothing to escape
  to, and the honest behavior is to stay put and keep paying one bounded probe per lease
  (the annex regression's own fixture-realism note, verbatim).

## Q2 — Frozen neighbour vs genuine caught-up; the F4 contour

**No leak found under the corrected ordering.** Genuinely-caught-up stream with a spent
lease: the probe fires at the next Step regardless of posture, gets rejected once
(caught-up carries zero landing-latency bits — the only thing the lease adjudicates),
re-arms, and every subsequent caught-up Step runs quiet on the incumbent. One probe per
spent lease, no hammering, no staleness (the stream IS at head; if the probed witness is
frozen BELOW head, the misreport lasts exactly one Step — the incumbent's next head read
corrects it). "B says caught up is non-evidence" is not a leak; it is the jurisdiction
boundary: the lease judges landing latency, and refusing to keep an armed pointer alive
on a zero-evidence answer is precisely what bounds the armed state to one Step. It also
retires wave-14's disclosed residual ("caught-up leaves an armed probe armed",
task-9-wave14-report-p2.md unverified list) — the long-caught-up-phase-reads-start-at-
the-probe-target behavior no longer exists beyond one Step.

**Daemon interaction, disclosed not fixed (out of wave-17 scope):** a caught-up probe
Step returns (false,nil) and `stepWalkers` breaks the walker's round at
`main.go:693-694`. Under the COMPOUND pathology (slow incumbent AND frozen neighbour,
simultaneously), each round delivers ~3 landings instead of 5 — throughput ×0.6,
bounded, honest, self-healing when either pathology clears. The alternative
(re-resolving from the incumbent inside the same Step) would break the one-witness-per-
Step contract and the stepMaxPinnedReads round shape; refused. Flag the ×0.6 figure in
the brief; any daemon-side treatment belongs to a later cmd/indexer wave.

**F4's contour is UNCHANGED and wave 17 must say so.** F4 is the frozen INCUMBENT (or
single endpoint): no landings ⇒ the lease never arms ⇒ the probe machinery never runs.
Finding 1 was a frozen NEIGHBOUR capturing the probe — a surface wave 14 itself built,
now closed. Two non-claims to write into the wave-17 report: (a) the fix is not F4
coverage; F4's rider (caught-up while durable freshness is red ≥K rounds counts as
non-landing) still needs its own ratified clause per the annex's F3/F4 discipline.
(b) The serendipitous partial mitigation — an incumbent that freezes while the lease
happens to be armed gets escaped by the probe — is luck, not coverage; do not cite it.

## Q3 — Per-witness measurement: the ruling

**The adjudicated quantity is Σ over the Step's reads of the SERVING attempt's own
elapsed time, measured by the chain walk around exactly that attempt.** Not the Step
wall, not the call wall. Grounds:

- Coherence makes this well-defined: in a LANDED Step every successful read was served
  by servedBy (`coherent`, walker.go:291-300), so the sum is one witness's cost by
  construction — a cross-witness sum cannot exist for an adjudicated Step. The only
  contaminated call is the resolution read (foreign failed attempts before servedBy),
  and per-attempt measurement excises exactly that.
- It kills both halves of finding 3: C is adopted on its 6s of own work while B's 30s
  hang sits outside the measure (no inherited rejection), and an adopted C's lease
  starts CLEAN when its own cost is under budget (no inherited slow landing — assert
  `slowLandings==0` post-adoption; the count-resets-but-evidence-inherited defect dies).
- It kills finding 4 STRUCTURALLY (see Q4): store time, store reads (`store.Cursor`,
  `HighestLogAtOrBelow`) and validation CPU can never enter the measure — not because a
  stopwatch was paused in the right place, but because only RPC attempts are summable.
  Future reads added to Step inherit the exclusion for free; measure-and-subtract would
  re-create the one-arm-gate shape (every store call site must remember to subtract).

**Mechanism (chain layer is open this wave):** additive timed variants of the three
walker-facing methods — `BlockNumberFrom`/`HeaderHashFrom`/`LogsFrom` gain siblings
returning `(value, EndpointToken, servedElapsed time.Duration, error)` where
servedElapsed is the serving attempt's wall time as measured inside doFrom around that
attempt alone. Additive-methods is the repo's standing pattern (BlockNumberFrom/LogsFrom
were themselves added this way, annex Q2.1); prices/reconcile/snapshot call sites are
untouched (HeaderHashFrom has consumers outside wave-17 scope — a signature change is
forbidden). REJECTED alternatives, for the record: (a) stuffing elapsed into
EndpointToken — additive and literal-safe (all construction sites are keyed; verified by
grep), but population is forgettable at ten producer sites, a silent-cap shape; the
timed signature makes population compiler-forced at exactly the three sites that need
it. (b) Walker-side exclusion of the resolution read (5-read symmetric yardstick, zero
chain change) — ships a permanent blind spot (an endpoint slow only on eth_blockNumber
is never measured) and makes the budget's claim ("the Step spent more than one attempt's
worth") quietly false for one read of six. The chain is open; take the honest mechanism.

**Fixture-realism requirements (the fake must be able to fail):**

- The fake's timed variants must derive servedElapsed from the SAME scripted `readCost`
  that drives `advanceClock` (`walker_fake_test.go:94,256-262`), so a schedule can make
  whole-Step wall and per-witness sum DIVERGE — that divergence is what makes the
  "adjudicate on wall" mutant killable. A fake that returns wall/readCount would be a
  fixture that cannot fail.
- A hung-to-timeout endpoint is expressible today (`down` + `readCost=T` — spend charges
  before the down check); the regression for finding 3 needs it. A fast-failing down
  endpoint is `down` + `readCost=0`. Both are real provider postures; script both.
- One HERMETIC chain-layer test (real Dial, the wave-7/8 raw-JSON layer style) proving
  servedElapsed is attempt-scoped in PRODUCTION code: primary delays ~200ms then fails,
  secondary answers fast; assert token's servedElapsed ≪ 200ms while the call wall
  ≥ 200ms. Without this, per-witness timing is proven at the fake layer only — a
  fixture-that-cannot-fail at the exact boundary the finding is about. I refuse to
  certify Q3 without it.

**Baseline semantics:** slowBaseline becomes the incumbent's most recent over-budget
Σ-attempts; probe compares its own Σ-attempts. Same units both sides. The fall-through
landing (probing, servedBy==incumbent) now measures the incumbent CLEANLY (B's hang
excluded) — and still re-arms in full rather than re-entering ordinary accounting: if
its clean over-budget measure kept the lease spent, the next Step would probe again and
finding 2's per-Step tax returns through the side door. Uniform rule: every rejected
probe re-arms in full.

## Q4 — Store-time exclusion: subsumed, plus the boundary ruling

**Ruled: the Σ-serving-attempts measure (Q3) IS the store-time fix.** Stop-the-clock-
before-SaveBatch is rejected (still counts store.Cursor, the rewind path's
HighestLogAtOrBelow, and validation CPU; and it is one more place to forget).
Measure-and-subtract is rejected (bookkeeping that every future store call must
remember — write-side validated, read-side trusted, the one-arm shape). Three
fast-RPC/slow-Postgres Steps can no longer spend the lease, and store jitter can no
longer transfer retention to a slower endpoint.

**The walker/daemon boundary:** slow-store visibility is a real need and it is NOT
endpoint adjudication. Wave 17 may additively expose the observation at the walker
(e.g. a `LastStepTimings()`-style observer in the HeadLag/ObservedHead pattern,
walker.go:158-184 — fresh per-Step, single-writer, daemon-read) but MUST NOT wire any
cmd/indexer consumer (wave 16 owns it, running). Flag the daemon-side store-latency
condition for the closing round or a later wave; do not smuggle it. Even the observer is
optional — if wave 17 ships without it, the brief carries the flag and nothing else.

**Claim hygiene (the report's bound):** with adjudication in Σ-attempt units, restate
the lease's bounds in those units. The lease bounds RPC occupancy; SaveBatch occupancy
is outside its jurisdiction and belongs to the store-health signal — the wave-14
report's "wall includes store by design" rationale is superseded and its wall-clock
upper bound must be re-scoped where it is restated. Also scope the blind-spot-ceiling
sentence (`walker.go:230-246`) to WINDOW Steps: a rewind landing's header walk is
unbounded by stepMaxPinnedReads, its Σ can legitimately exceed R·T, and that evidence is
real (a slow rewind is a slow witness) — the ceiling is a window-Step property, not a
Step property.

## Q5 — Constant drift: the minimal set

- **`chainAttemptTimeout` (walker.go:215 vs chain.go:24): close it by COMPILE-TIME
  IDENTITY, not by restate-and-assert.** Chain exports the constant (one line:
  `const AttemptTimeout = defaultAttemptTimeout`, doc stating it exists for
  cross-package derivation binding); ingest's mirror becomes
  `const chainAttemptTimeout = chain.AttemptTimeout`. No test needed — drift is
  unrepresentable, which is stronger than "now-mechanical equality". This is the
  load-bearing mirror: if chain dropped to 5s while ingest held 30s, the new blind spot
  (reads at 4.9s, Step Σ ≈ 29s) sits under ingest's stale budget and the lease goes
  blind again — Codex's scenario is exact. The wave-14 report promised this export for
  the next chain-open wave; this is one. W14M3's relation mutant stays (it guards the
  derivation, not the mirror).
- **The lease-length chain (walker.go:261 → poller.go:200 → snapshot.go:159): NOT
  forced; internal/prices and internal/snapshot stay untouched.** No correctness
  invariant couples the three numbers — the load-bearing inequality is
  `MaxConsecutiveSlowLandings+1 ≤ stepsPerRound`, already mechanically guarded at
  walker_latency_scheduling_test.go:87. The coupling claim is PROVENANCE prose ("no new
  magic number"), and the honest fix is prose: reword walker.go:249-261 to an
  adoption-time citation ("adopts the lease length ratified at d1e7d54, =3 at adoption;
  policy siblings, not a shared constant; divergence changes no invariant here").
  Mechanically binding three unexported constants across packages from inside wave-17
  scope is impossible without exports there, and an AST/reflection workaround would be
  the round-13 lesson ignored (evadable static theater). If the controller ever wants a
  single ratified home, that is a small future wave touching all three packages — worth
  a line in the brief's flag list, nothing more. Forcing it now would assert an equality
  that is not load-bearing to feel rigorous — recomputation theater's cousin.
- **`stepMaxPinnedReads` (walker.go:225), note-level:** it can drift from Step's real
  shape with no mechanical guard. Cheap closure while the file is open: a regression
  that scripts one maximal window Step and asserts the fake's total ask count
  (blockStarts + headerAsks + logsAsks for that Step) == stepMaxPinnedReads.

## Q6 — What the findings missed (fresh-eyes)

1. **[blocking, wave 17] Probe Steps carry rewind authority** (walker.go:452-464 probe
   start → :539-551 reorg arm → :547 `rewindToVerifiedAncestor`, all pinned to
   servedBy). Scenario: lease spent, probe starts at neighbour B; B sits on a stale or
   minority view below the cursor (annex S3 — same height, two truths, below ETH
   finality at conf=5); B's cursor-header mismatch authorizes a DESTRUCTIVE rewind on
   B's word alone, deletes rows, cascades reorg epochs — and the rewind counts as a
   LANDING (:549), fast, so `recordLanding`'s probe arm can ADOPT B on the strength of
   the churn it caused, after which the stream re-ingests B's fork until the next
   contradiction. Raw custody holds (annex F3's "churn not corruption" — everything is
   replayable), but wave 14 silently WIDENED F3's exposure: before the lease, the single
   rewind witness was at least the stream's own converged landing endpoint; the probe
   hands the same destructive authority to an unvetted neighbour once per spent lease.
   Prescription (walker-only, in scope): **a probe Step refuses the rewind arm** — a
   cursor-hash mismatch while probing is a DISCARD (non-landing; the seam advances past
   the probe witness; lease dissolves). If the reorg is real, the incumbent's next Step
   sees it and rewinds with retained-witness authority; cost = one Step of delay on a
   genuine reorg that lands inside a probe Step. This does NOT implement F3
   (corroboration stays its own future ratified clause, annex F3 verbatim); it declines
   to extend rewind authority to witnesses the stream has zero landing evidence for.
2. **[binding, folded into Q1] The n≥3 probe-shield starvation** — detailed under Q1;
   without target cycling the wave's stated finite bound is false for n≥3.
3. **[note] Probe Steps write the readiness observation from the probed witness**
   (walker.go:527: lastHead/headSeen recorded from servedBy=B before the caught-up
   return). A frozen-low B makes HeadLag report SMALLER lag (healthier) and
   ObservedHead hands consumers a stale head — post-fix bounded to one Step per spent
   lease; pre-fix (finding 1) it was every Step, meaning HeadLag was GREEN-masking the
   very stall whose detection finding 1 attributes to durable freshness. Disclose in the
   brief; acceptable residual at one Step.
4. **[note] n=1 armed-lease leg still has no dedicated regression** (wave-14 disclosed).
   While the file is open: one cheap test — single endpoint, lease spends, no probe, no
   pretend rotation, slowLandings grows past L without re-firing the ==L WARN
   (walker.go:403). Two lines of guard, currently inspection-only.
5. **Confirmed clean, for the record:** probing with slowBaseline==0 is unreachable
   (arming requires an over-budget landing which sets the baseline; every reset clears
   both); the adoption arm's strict `<` at :368 is deterministic on ties; existing
   caught-up pins (walker_test.go:118,131) are non-probing and stay green under the new
   probe-scoped caught-up rule.

---

## Findings register

| ID | Severity | Finding | Prescription (normative citation) |
|---|---|---|---|
| R15-1 | blocking | Frozen-neighbour probe capture: armed state unbounded across caught-up Steps (walker.go:497-502) | caught-up probe → reject + re-arm in full; armed state lives one Step (d1e7d54 bounded-lease pattern: the lease bounds ARMING; this bounds the ARMED state) |
| R15-2a | blocking | Fall-through probe retried every Step (walker.go:385-402): per-Step timeout tax, ~17 min/round | fall-through → reject + re-arm in full; liveness paid once per spent lease |
| R15-2b | blocking | Total resolution failure bypasses the seam (walker.go:466-471) | witness-less arm INSIDE the deferred handler: startPref unchanged (law antecedent unsatisfied, ledger :80 verbatim), lease PRESERVED (reset would let a flapping network suppress probes forever) |
| R15-2c | blocking | Provisional direction's reject-on-FAILURE starves the fleet at n≥3 (broken middle neighbour shields the fast peer) | non-landing probes stay with the wave-12 seam arm — advance past the probe witness, lease dissolves ("landing is the only outcome that keeps the starting point", round-2 closed law) |
| R15-3 | blocking | Whole-walk wall inherits foreign timeouts into adjudication (walker.go:465-466,493) | Σ serving-attempt elapsed per witness via additive timed From variants; hermetic chain test mandatory (fixture-realism law: the fake must be able to fail) |
| R15-4 | blocking (subsumed by R15-3) | Store time in endpoint adjudication (walker.go:493,707) | structural exclusion via Σ-attempts; store-latency signal = daemon-owned, FLAGGED not wired (wave-16 boundary) |
| R15-5a | should (binding this wave — chain is open) | chainAttemptTimeout mirror can drift (walker.go:215 vs chain.go:24) | export + compile-time alias; drift unrepresentable |
| R15-5b | note | lease-length "shared policy" claim not mechanical (walker.go:261, poller.go:200, snapshot.go:159) | prose fix in ingest only; prices/snapshot NOT forced, do not touch |
| R15-6 | blocking (new) | Probe Steps carry rewind authority (walker.go:452-464 + :539-551) | probe Steps refuse the rewind arm; discard instead; F3 remains its own future decision |
| R15-7 | binding (new) | n≥3 probe-shield: rejected-but-non-failing neighbour starves peers behind it; stated finite bound false for n≥3 | probe-target cursor cycling 1..n−1 across spent leases; bound (n−1)(L+1) Steps stated; n=2 traces byte-identical |
| R15-8 | note | Probe Step stamps lastHead/ObservedHead from probed witness (walker.go:527) | disclose; bounded to one Step post-fix |
| R15-9 | note | stepMaxPinnedReads unguarded; ceiling prose over-broad for rewind Steps | ask-count regression; scope the ceiling sentence to window Steps |

## Binding constraints for the wave-17 brief

1. Probe adjudication covers LANDED and CAUGHT-UP postures only; every rejected probe
   (no-faster, tie, caught-up, fall-through-to-incumbent) re-arms the lease IN FULL and
   is a routing no-op (startPref never moved). Non-landing probes flow through the
   wave-12 seam arm unchanged. No probe outcome is handled outside the deferred handler.
2. Total resolution failure joins the seam as a witness-less arm: startPref unchanged,
   lease state preserved, documented against ledger :80's antecedent. No return between
   serving-endpoint resolution and the deferred handler.
3. Probe-target cycling (R15-7): offset 1..n−1 advanced on every rejection, reset on
   adoption and on seam non-landing advance. The escape bound is stated as
   ≤ (n−1)(L+1) Steps and the n=2 reduction to the shipped bound is stated.
4. Probe Steps carry no rewind authority (R15-6): cursor-mismatch while probing is a
   discard. The wave does NOT implement F3 and says so.
5. Adjudication currency is Σ serving-attempt elapsed (Q3): additive timed From variants
   in chain; walker sums per landed Step; baseline in the same units; fall-through
   landings measured cleanly but still re-arm in full. Store/validation time excluded by
   construction; no cmd/indexer wiring; daemon store-latency signal FLAGGED for the
   closing round.
6. chain exports the attempt timeout; ingest binds by compile-time alias. Lease-length
   prose reworded to adoption-time citation; internal/prices and internal/snapshot are
   NOT touched (ruled not forced).
7. The shared hint is neither consulted nor written by any of the above (existing
   assertions on `ch.active` extend to every new regression).
8. F4 non-claim stated in the report verbatim: the wave closes the frozen-NEIGHBOUR
   capture only; frozen-incumbent detection remains F4, open, its own future clause.
9. Wall-clock claims re-scoped: the lease bounds RPC occupancy in adjudicated units;
   the compound-pathology daemon throughput (×0.6 under slow-incumbent + frozen-
   neighbour, from the (false,nil) round break at main.go:693-694) is disclosed, not
   fixed, in wave 17.

## Regressions and mutants required (per evasion/failure shape)

| # | schedule (fixture-real) | binding assertion | mutant that must die |
|---|---|---|---|
| R-A | finding 1 verbatim: A slow-landing with windows, B frozen head with safe==cursor | trace `[0,0,0,1,0,0,0,1…]`; cursor advances every non-probe Step; hint untouched | caught-up-while-probing keeps lease untouched (revert) → trace `[0,0,0,1,1,1…]`, cursor frozen |
| R-B | finding 2 verbatim: A 6×(T−1s) landings, B `down`+readCost=T (hang-to-timeout) | trace `[0,0,0,1,0,0,0,1]`; all Steps land; wall of Steps 5–7 excludes B's T (clock arithmetic) | fall-through keeps lease spent (revert) → probe every Step |
| R-C | seam closure: lease at 2 slow landings, one all-endpoints-down Step, recovery | count PRESERVED across the blip (probe fires after ONE more slow landing); startPref never moved during the blip; armed lease survives a blip and probes on recovery | (i) witness-less arm resets lease → probe suppressed under flapping; (ii) restore the early-return bypass → future-arm test fails |
| R-D | finding 3 verbatim: n=3, A baseline ≈31s Σ, B hang T, C 1s/read | C ADOPTED (witness-sum 6s < baseline) AND C's lease clean (`slowLandings==0`) | adjudicate on whole-Step wall → C rejected (36s>31s); inverse leg (40s baseline): wall-mutant seeds slowLandings=1 |
| R-E | fast RPC + slow store: fakeStore gains a SaveBatch clock cost | lease never arms across 3 Steps | re-include store time → lease arms, probe fires |
| R-F | R15-6: lease spent; B's view diverges at cur.Block | store.Rewind NEVER called on the probe Step; discard; next Step at incumbent; incumbent rewinds only if IT sees the mismatch | allow rewind on probe → Rewind called with B's target |
| R-G | R15-7: n=3, A slow, B always-rejected (frozen or 175s), C fast | C probed at the SECOND spent lease and adopted; bound (n−1)(L+1) asserted on the trace | offset never advances → C never probed |
| R-H | chain hermetic (real Dial): slow-failing primary ~200ms, fast secondary | servedElapsed ≪ 200ms, call wall ≥ 200ms — attempt-scoped in production code | (structural: absence of this test is the evasion) |
| R-I | n=1 armed lease (wave-14 disclosed gap) | no probe, retention stands, no pretend rotation | — (guard test; note-level) |
| R-J | ask-count: one maximal window Step | total asks == stepMaxPinnedReads | — (drift guard; note-level) |

Existing pins that must remain byte-green: both wave-14 latency regressions, the R3/R5
family, walker_test.go:118/131 caught-up pins, walker_latency_scheduling_test.go both
tests. Wave-12/14 mutation specs remain valid only at their recorded SHAs (patterns
moved again this wave) — restate, do not re-run blind.

## What I refuse to certify

- Any wave-17 report sentence claiming F4 coverage, full or partial.
- Real-latency behavior of the lease/probe beyond the fake layer (wave-14's disclosure
  carries forward; no live slow-endpoint injection exists).
- Per-witness timing without the hermetic chain-layer test (R-H) — fake-only proof at
  that boundary is a fixture that cannot fail.
- Any mechanical-equality claim about the lease-length chain (ingest→prices→snapshot):
  not achievable inside wave-17 scope, not load-bearing, prose-only by ruling.
- The provisional total ordering AS WRITTEN (reject-on-failure included): refuted by the
  n≥3 broken-middle schedule; certify only the corrected ordering above.
- Any finite-escape-bound statement not carrying the (n−1) factor (or an explicit n=2
  scope guard) once the probe machinery ships to configs with more than two endpoints.

## Verdict per finding-class

| class | verdict | note |
|---|---|---|
| Finding 1 (frozen-neighbour capture) | **CUSTODY HOLDS** — availability defect; nothing wrong persisted; fix binding (constraint 1) |
| Finding 2 (per-Step retry + seam bypass) | **CUSTODY HOLDS** — scheduling defect + structural law violation; fix binding (constraints 1–2), corrected for the failure posture (constraint 1/R15-2c) |
| Finding 3 (per-witness measurement) | **CUSTODY HOLDS** — adjudication-evidence integrity; binding via Σ-attempts (constraint 5) |
| Finding 4 (store time) | **CUSTODY HOLDS** — subsumed by constraint 5; daemon signal flagged, not smuggled |
| Finding 5 (constant drift) | **CUSTODY HOLDS** — timeout mirror closed by compile-time identity this wave; lease chain prose-only, prices/snapshot not forced |
| New: R15-6 probe rewind authority | **CUSTODY HOLDS** (churn, not corruption — annex F3's grading) but BLOCKING for wave 17: destructive authority must not extend to unvetted witnesses |
| New: R15-7 n≥3 shield | BLOCKING for the wave's bound claims; binding constraint 3 |

**Overall: CUSTODY HOLDS. Blocking list for wave 17: R15-1, R15-2a, R15-2b, R15-2c
(direction correction), R15-3 (+R-H), R15-4 (as constraint 5), R15-6, R15-7; R15-5a
binding because the chain is open. Nothing here reopens raw-log custody; every defect
lives in routing evidence and scheduling, and the fail-closed validation canon is
untouched by all prescriptions.**
