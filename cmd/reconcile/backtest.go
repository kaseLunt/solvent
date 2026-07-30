// The realized-liquidation backtest over the FROZEN 31-case frame.
//
// The plan's original clause ("liquidatable==true at execution") is a
// TAUTOLOGY: DebtManagerCore.sol:526 already reverts otherwise, so the chain
// guarantees it and the gate could never fail. risk-quant R2 replaced it with
// four per-case obligations, each of which can actually fail:
//
//  1. DEBT WELD, bit-exact: our normalized replay folded to the pre-liquidation
//     (block, logIndex) must reproduce the event's OWN beforeDebtAmount. This
//     is the only obligation that tests the derived fold, and the two-pass pair
//     is its hardest case — the second event's beforeDebtAmount IS the first
//     pass's after-state, which only a strict total order reproduces.
//  2. ELIGIBILITY DIRECTION, our boolean, under chain-truth R1's three-state
//     intra-block law: true-at-parent / flipped-in-block-with-custodied-witness
//     / UNEXPLAINED (gated fail). Marginal cases are listed INDIVIDUALLY with
//     |debt − maxBorrowLT| printed; never absorbed.
//  3. SEIZURE RECONSTRUCTION, exact per deployed branch. Partial branch:
//     amount == the Safe's balance and bonus == totalCollateral −
//     floor(totalCollateral·HP/(HP+b)). Final branch: amount − bonus ==
//     floor(u·10^dec/P) and bonus == floor(cAFD·b/HP)
//     (DebtManagerCore.sol:613-658 with the conversion at
//     DebtManagerStorageContract.sol:517-521).
//  4. RESIDUE WELD, ≤1 normalized wei, ONLY on fully-liquidated accounts,
//     citing the silent zeroing at DebtManagerCore.sol:549-553.
//
// PIN LAW: every read is EIP-1898 at the case's STORED raw_logs.block_hash, or
// at the PARENT hash that block's own state asserts via
// Multicall3.getBlockHash — never a number→hash resolution (chain-truth R1).
package main

import (
	"context"
	"encoding/hex"
	"fmt"
	"math/big"
	"reflect"
	"sort"
	"strings"

	"github.com/ethereum/go-ethereum/common"

	"github.com/kaselunt/solvent/cmd/reconcile/snapshotdb"
)

// backtestBackstop is risk-quant R2's hard floor when archive reads fail: >=25
// evaluated, with EVERY skipped case named by its RPC failure class. It is a
// BACKSTOP, not a target — the frame is 31 and a case whose pin is unserveable
// is a preflightExit, so a run that reaches this backstop has already reported
// each loss individually.
const backtestBackstop = 25

// hundredPercentDM is the Debt Manager's HUNDRED_PERCENT (100e18) — the
// liquidation-bonus denominator.
var hundredPercentDM = hundredE18

func backtestFrame_() *gateFrame {
	return newGateFrame(gateBacktest,
		derived(srcBTDeltaFold,
			"OUR normalized replay at the pre-liquidation point — obligation 1's tested value, and the ONLY thing in this gate that tests the derived fold"),
		derived(srcBTBeforeDebt,
			"obligation 1's EXPECTED value: the event's own beforeDebtAmount. It was CONSUMED UNDECLARED before Codex round 1 — the most load-bearing number in the gate, absent from its own frame"),
		derived(srcBTLiquidated,
			"obligation 3's repay BUDGET: the USD the contract actually liquidated. Carried across the ordered elements so the seizure reconstruction is anchored to it rather than inverted from the elements themselves"),
		derived(srcBTNextPass,
			"obligation 4's expected value for a FIRST pass: the chain's own statement of the between-passes state. Block-end borrowingOf is wrong there, because the second pass moves the debt again before the block closes"),
		derived(srcBTIndex,
			"the index our fold used. Obligation 1 multiplies OUR normalized balance by it and compares against the event's own beforeDebtAmount"),
		derived(srcBTSeizures,
			"the seizure elements as OUR decoder read them off the wire — obligation 3's tested values"),
		derived(srcBTResidue,
			"whether the deriver MODELLED DebtManagerCore.sol:549-553's silent zeroing for this case: when it did, the residue tolerance must not also be spent"),
		derived(srcBTStoredHash,
			"custody's stored pin, compared byte-for-byte with the COMMITTED frame's block_hash"),
		derived(srcBTWitnesses,
			"the ONLY witnesses permitted to explain an eligibility flip (chain-truth R1's three-state law); anything else is UNEXPLAINED"),
		pinned("Multicall3.getBlockHash(N-1)@pinHash(N)",
			"the parent hash as block N's OWN state asserts it (the BLOCKHASH opcode executed inside the pinned call) — the honest N-1 pin, never a number->hash resolution"),
		pinned("DebtManager.collateralOf(user)@parentHash(N-1)",
			"the CashLens-netted collateral at the parent frame. Obligation 2's collateral input is a PINNED READ: our sweep holds current state only, so there is no derived historical collateral to test here, and claiming one would be a false declaration"),
		pinned("DebtManager.convertCollateralTokenToUsd(token, 10^dec)@parentHash(N-1) and @pinHash(N)",
			"the engine-exact price at BOTH frames: the parent frame decides eligibility, and a price that differs between them makes the case MARGINAL (risk-quant R2 detector b)"),
		pinned("DebtManager.collateralTokenConfig(token)@parentHash(N-1)",
			"the thresholds and the liquidation bonus the deployed seizure branch used"),
		pinned("ERC20.balanceOf(user, token)@parentHash(N-1)",
			"the Safe balance the PARTIAL branch's `amount == totalCollateral` is judged against"),
		pinned("ERC20.decimals(token)@pinHash(P_op)",
			"the 10^dec conversion denominator (immutable, so the run pin is the cheapest honest place to read it)"),
		pinned("DebtManager.borrowingOf(user, borrowToken)@pinHash(N)",
			"the post-liquidation residue: obligation 4's chain side, read at the liquidation block itself"),
		committed("the frozen 31-case frame (recon/p3-probes.md), digest 0x740ac240…f0fbf3",
			"tx hashes, log indexes, stored block hashes, accounts, fan-out counts and selection reasons — the FLOOR is the frame itself"),
		committed("backtest frame seed "+backtestFrameSeed,
			"recorded for reproducibility; never consumed as a seed here, because the draw already happened and is not re-run"),
	)
}

// --- typed source accessors (Codex round 1, finding 2) ----------------------
//
// THE DEFECT THESE REPLACE: the ledger recorded consumption only when a caller
// remembered to call use(), so it could not enforce its own claims. Two
// violations existed in this very file and shipped green — `beforeDebtAmount` was
// consumed WITHOUT being declared (obligation 1's expected value, the single most
// load-bearing number in the gate), and the pinned `decimals` source was DECLARED
// but never consumed.
//
// backtestView makes consumption INSEPARABLE from recording: the fields are
// unexported, so the only way to obtain a value is the accessor, and the accessor
// records. A future read cannot forget, because there is nothing to forget — the
// getter is the read.
type backtestView struct {
	row snapshotdb.T6BacktestRow
	f   *gateFrame
}

const (
	srcBTDeltaFold  = "position_events(engine=debt_manager, side=debt).delta folded to (block, log_index, seq) < the case's own key"
	srcBTBeforeDebt = "position_events(event_type=liquidation).payload.before_debt_usd (the event's OWN beforeDebtAmount)"
	srcBTLiquidated = "position_events(event_type=liquidation).payload.usd (the event's OWN liquidatedAmt)"
	srcBTIndex      = "position_events(event_type=liquidation).payload.index (the same-block interest index the deriver folded with)"
	srcBTSeizures   = "position_events(event_type=liquidation_collateral).payload.{amount,bonus} (record-only fan-out)"
	srcBTResidue    = "position_events(event_type=residue_zeroed).payload.residue"
	srcBTStoredHash = "raw_logs.block_hash for the case's own (tx, log_index)"
	srcBTWitnesses  = "raw_logs same-block rows with a LOWER log_index"
	srcBTNextPass   = "position_events(event_type=liquidation).payload.before_debt_usd of the NEXT pass (same tx, account, debt token)"
)

func newBacktestView(row snapshotdb.T6BacktestRow, f *gateFrame) *backtestView {
	return &backtestView{row: row, f: f}
}

// beforeDebtUSD is obligation 1's EXPECTED value — the chain's own statement.
func (v *backtestView) beforeDebtUSD() *big.Int { v.f.use(srcBTBeforeDebt); return v.row.BeforeDebtUSD }

// liquidatedUSD is obligation 3's budget: the USD the contract actually
// liquidated, which the seizure reconstruction must account for element by
// element.
func (v *backtestView) liquidatedUSD() *big.Int { v.f.use(srcBTLiquidated); return v.row.LiquidatedUSD }

func (v *backtestView) normalizedBefore() *big.Int {
	v.f.use(srcBTDeltaFold)
	return v.row.NormalizedBefore
}

func (v *backtestView) normalizedAfter() *big.Int {
	v.f.use(srcBTDeltaFold)
	return v.row.NormalizedAfter
}

// normalizedAtParent is the SAME Σ-delta fold cut at the PARENT boundary —
// the debt state the causation replay starts from (Codex round 4, M). It is
// recorded under srcBTDeltaFold because it IS that source: the identical
// fold discipline with a different upper bound, not a new input.
func (v *backtestView) normalizedAtParent() *big.Int {
	v.f.use(srcBTDeltaFold)
	return v.row.NormalizedAtParent
}

func (v *backtestView) indexAtBlock() *big.Int { v.f.use(srcBTIndex); return v.row.IndexAtBlock }

func (v *backtestView) seizures() []snapshotdb.T6Seizure {
	v.f.use(srcBTSeizures)
	return v.row.Seizures
}

func (v *backtestView) residue() (bool, string) {
	v.f.use(srcBTResidue)
	return v.row.ResidueZeroed, v.row.ResidueText
}

func (v *backtestView) storedBlockHash() string {
	v.f.use(srcBTStoredHash)
	return v.row.StoredBlockHash
}

func (v *backtestView) sameBlockEarlier() []string {
	v.f.use(srcBTWitnesses)
	return v.row.SameBlockEarlier
}

// sameBlockWitnesses is the STRUCTURED witness list the causation replay consumes.
func (v *backtestView) sameBlockWitnesses() []snapshotdb.T6Witness {
	v.f.use(srcBTWitnesses)
	return v.row.SameBlockWitnesses
}

func (v *backtestView) priorPassLogIndex() *uint32 { return v.row.PriorPassLogIndex }

// nextPass is obligation 4's expected value for a FIRST pass. It is an ACCESSOR
// (Codex round 2, finding H1) because residueWeld previously copied v.row and read
// these fields directly: the frame declared the source, nothing consumed it, and
// the deferred validator therefore added a gated failure on every run — a
// deterministic false failure created by the round-1 fix itself.
//
// present is false when there is no following pass, and in that case NOTHING is
// recorded: a conditional source must not be marked consumed on cases that do not
// have it, or the ledger would stop being able to tell the two situations apart.
func (v *backtestView) nextPass() (logIndex uint32, beforeDebt *big.Int, beforeText string, present bool) {
	if v.row.NextPassLogIndex == nil {
		return 0, nil, "", false
	}
	v.f.use(srcBTNextPass)
	return *v.row.NextPassLogIndex, v.row.NextPassBeforeDebtUSD, v.row.NextPassBeforeText, true
}

// hasNextPass reports whether a following pass exists WITHOUT recording a
// consumption: the residue weld needs the shape question answered before it
// decides which expected value applies.
func (v *backtestView) hasNextPass() bool { return v.row.NextPassLogIndex != nil }

// residueModelled / normalizedAfterText are the remaining row fields the residue
// weld needs, behind accessors for the same reason.
func (v *backtestView) normalizedAfterText() string { return v.row.NormalizedAfter.String() }

// backtestCaseResult is one case's four-obligation outcome.
type backtestCaseResult struct {
	Key       string   `json:"case"`
	Bucket    string   `json:"bucket"`
	Block     uint64   `json:"block_number"`
	LogIndex  uint32   `json:"log_index"`
	Account   string   `json:"account"`
	Selection string   `json:"selection"`
	Evaluated bool     `json:"evaluated"`
	SkipClass string   `json:"skip_class,omitempty"`
	Notes     []string `json:"notes,omitempty"`
	// EligibilityState is the three-state outcome.
	EligibilityState string `json:"eligibility_state,omitempty"`
	MarginUSD6       string `json:"margin_usd6,omitempty"`
	PriceDeltaNote   string `json:"price_delta_note,omitempty"`
	Fanout           int    `json:"collateral_elements"`
}

// runBacktest evaluates the frame.
func runBacktest(ctx context.Context, c *p3Ctx, decimals map[common.Address]uint8) ([]p3Row, []backtestCaseResult, error) {
	f := c.frames.add(backtestFrame_())
	var rows []p3Row
	var results []backtestCaseResult
	f.use("the frozen 31-case frame (recon/p3-probes.md), digest 0x740ac240…f0fbf3")
	f.use("backtest frame seed " + backtestFrameSeed)

	evaluated := 0
	for _, fc := range backtestFrame {
		key := strings.TrimPrefix(strings.ToLower(fc.TxHash), "0x") + fmt.Sprintf(":%d", fc.LogIndex)
		res := backtestCaseResult{
			Key: key, Bucket: fc.Bucket, Block: fc.Block, LogIndex: fc.LogIndex,
			Account: fc.Account, Selection: fc.Selection, Fanout: fc.CollateralElements,
		}
		db, ok := c.t6.Backtest[key]
		if !ok || !db.Present {
			rows = append(rows, p3Row{
				Gate: gateBacktest, Subject: key, Leg: "frame-case-present",
				Expected: "one derived liquidation row at the case's own (tx, log_index)",
				Actual:   "absent from derived state",
				Verdict:  verdictDrift, Gated: true, Class: "frame-case-missing",
				Note: "the FRAME IS FROZEN: a case that cannot be evaluated is reported individually, never dropped, and never replaced by a substitute (that would make every recorded verdict a claim about a different sample)",
			})
			res.SkipClass = "frame-case-missing"
			results = append(results, res)
			continue
		}
		// The committed pin must still BE custody's pin, read through the typed
		// accessor so the consumption is recorded by construction.
		storedHash := newBacktestView(db, f).storedBlockHash()
		if !strings.EqualFold(storedHash, fc.BlockHash) {
			rows = append(rows, driftRow(gateBacktest, key, "committed-pin == custody-pin",
				storedHash, fc.BlockHash, "frame-pin-drift",
				"the frame's committed block_hash no longer equals the hash raw_logs stores for this case. The committed frame is an INPUT; an input that no longer matches custody is a gated failure rather than a silent re-pin (chain-truth R1)"))
			res.SkipClass = "frame-pin-drift"
			results = append(results, res)
			continue
		}
		if db.Block != fc.Block {
			rows = append(rows, driftRow(gateBacktest, key, "committed-block == custody-block",
				fmt.Sprintf("%d", db.Block), fmt.Sprintf("%d", fc.Block), "frame-block-drift",
				"the frame's committed block number disagrees with raw_logs"))
			res.SkipClass = "frame-block-drift"
			results = append(results, res)
			continue
		}
		if db.AccountHex != strings.TrimPrefix(strings.ToLower(fc.Account), "0x") {
			rows = append(rows, driftRow(gateBacktest, key, "committed-account == derived-account",
				"0x"+db.AccountHex, strings.ToLower(fc.Account), "frame-account-drift",
				"the frame's committed account disagrees with the derived event's account"))
		}
		if len(db.Seizures) != fc.CollateralElements {
			rows = append(rows, driftRow(gateBacktest, key, "committed-fanout == derived-fanout",
				fmt.Sprintf("%d", len(db.Seizures)), fmt.Sprintf("%d", fc.CollateralElements), "frame-fanout-drift",
				"the frame's committed userCollateralLiquidated length disagrees with the derived fan-out; the freeze cross-checked this two independent ways 763/763, so a disagreement here is new"))
		}

		caseRows, caseRes, err := runBacktestCase(ctx, c, f, fc, db, decimals, res)
		if err != nil {
			return rows, results, err
		}
		rows = append(rows, caseRows...)
		if caseRes.Evaluated {
			evaluated++
		}
		results = append(results, caseRes)
	}

	rows = append(rows, cohortFloorRow(gateBacktest, "frozen-frame-cases-evaluated",
		evaluated, backtestFrameSize, backtestBackstop,
		fmt.Sprintf("the FRAME is the floor (risk-quant R2): N=%d by construction, digest %s, seed %q. Hard backstop %d with every skipped case named by its failure class above",
			backtestFrameSize, backtestFrameDigest, backtestFrameSeed, backtestBackstop)))

	// COMPOSITION BY IDENTITY, not by count (risk-quant R2): the named cases
	// must be present, and their absence is a gated failure of the FRAME rather
	// than a coverage number.
	rows = append(rows, frameCompositionRows()...)
	return rows, results, nil
}

// frameCompositionRows asserts the frame's identity constraints: the
// 153,399,414 singleton, each bucket's max-fanout case, and the two-pass pair.
func frameCompositionRows() []p3Row {
	var rows []p3Row
	sawSingleton := false
	maxFanoutBuckets := map[string]bool{}
	twoPass := 0
	for _, fc := range backtestFrame {
		if strings.Contains(fc.Selection, "singleton") && fc.Block == 153399414 {
			sawSingleton = true
		}
		if strings.Contains(fc.Selection, "max-fanout") {
			maxFanoutBuckets[fc.Bucket] = true
		}
		if strings.Contains(fc.Selection, "two-pass") {
			twoPass++
		}
	}
	add := func(subject string, ok bool, expected, actual, note string) {
		row := p3Row{Gate: gateBacktest, Subject: "composition:" + subject, Leg: "identity",
			Expected: expected, Actual: actual, Gated: true, Note: note}
		if ok {
			row.Verdict = verdictExact
		} else {
			row.Verdict = verdictCohortFloor
			row.Class = "frame-composition-miss"
		}
		rows = append(rows, row)
	}
	add("singleton@153,399,414", sawSingleton, "present", fmt.Sprintf("%v", sawSingleton),
		"the sole member of the last 500k bucket, force-included by identity so the era's final liquidation is always evaluated")
	add("max-fanout per full bucket B0-B5", len(maxFanoutBuckets) >= 6,
		"6 buckets", fmt.Sprintf("%d buckets", len(maxFanoutBuckets)),
		"each full bucket's max-collateral-fan-out event — the hardest multi-collateral seizure math. DISCLOSED WEAKNESS carried from the freeze: in B1 and B2 EVERY event has fan-out 15, so this force-include degenerates into an extra seeded pick there; stated so nobody reads it as a selective strengthening")
	add("two-pass pair (both members)", twoPass == 2, "2 member events", fmt.Sprintf("%d", twoPass),
		"the 50%-then-remainder path: the second event's beforeDebtAmount IS the first pass's after-state, so obligation 1's fold ordering must reproduce it. 292 of 471 (tx, account) groups are two-pass on this population, so the pattern is DOMINANT rather than a rare tail — the force-include guarantees at least one COMPLETE pair")
	return rows
}

// runBacktestCase evaluates one case's four obligations.
func runBacktestCase(ctx context.Context, c *p3Ctx, f *gateFrame, fc backtestCase,
	db snapshotdb.T6BacktestRow, decimals map[common.Address]uint8, res backtestCaseResult) ([]p3Row, backtestCaseResult, error) {
	var rows []p3Row
	pinHash := common.HexToHash(fc.BlockHash)
	account := common.HexToAddress(fc.Account)
	debtToken := common.HexToAddress(db.DebtAssetHex)
	key := res.Key

	// Every derived value below is obtained through the TYPED ACCESSORS, so
	// consumption and ledger-recording are the same operation (round-1 finding 2).
	v := newBacktestView(db, f)

	// ---- OBLIGATION 1: derived-debt weld, bit-exact ------------------------
	// floor(N_before × index / 1e18) == the event's OWN beforeDebtAmount.
	ourBefore := mulDivFloor(v.normalizedBefore(), v.indexAtBlock())
	obl1 := compareExact(gateBacktest, key, "obligation1: beforeDebtAmount(bit-exact)",
		v.beforeDebtUSD(), ourBefore, "derived-fold")
	obl1.Evidence = map[string]string{
		"normalized_before":   db.NormalizedBefore.String(),
		"index_at_block":      db.IndexAtBlock.String(),
		"bridge":              "floor(normalized x index / 1e18) — DebtManagerStorageContract.sol:517-521 _getActualBorrowAmount",
		"prior_pass_logindex": priorPassText(db.PriorPassLogIndex),
	}
	if db.PriorPassLogIndex != nil {
		obl1.Note = "SECOND PASS of a two-pass tx: this beforeDebtAmount IS the first pass's after-state, so an exact result here proves the fold's ordering over (block, log_index, seq), not merely its arithmetic. " + obl1.Note
	}
	rows = append(rows, obl1)

	// ---- the N-1 pin, derived FROM the pin ---------------------------------
	parentData, err := multicall3GetBlockHashABI.Pack("getBlockHash", new(big.Int).SetUint64(fc.Block-1))
	if err != nil {
		return rows, res, err
	}
	parentRet, _, err := c.opR.callAtHash(ctx, fmt.Sprintf("p3:backtest:parentHash(%d)", fc.Block), multicall3Address, parentData, pinHash)
	if err != nil {
		cls := replayFailureClass(err)
		rows = append(rows, unreadRow(gateBacktest, key, "parent-pin(Multicall3.getBlockHash)",
			fmt.Sprintf("the case's own stored pin could not serve the parent-hash read (%s): %v", cls, err)))
		res.SkipClass = cls
		res.Notes = append(res.Notes, "a state-pruned verdict at a backtest pin is preflightExit semantics (chain-truth R1) — reported, never a shrunk N")
		return rows, res, nil
	}
	parentHash, err := unpackBytes32Strict(multicall3GetBlockHashABI, "getBlockHash", parentRet)
	if err != nil {
		rows = append(rows, unreadRow(gateBacktest, key, "parent-pin(Multicall3.getBlockHash)", err.Error()))
		res.SkipClass = "parent-hash-undecodable"
		return rows, res, nil
	}
	if parentHash == (common.Hash{}) {
		rows = append(rows, unreadRow(gateBacktest, key, "parent-pin(Multicall3.getBlockHash)",
			"BLOCKHASH answered zero for the parent, which means the pinned block's own state does not assert it — the N-1 frame cannot be pinned honestly, and resolving N-1 by NUMBER is banned (chain-truth R1)"))
		res.SkipClass = "parent-hash-zero"
		return rows, res, nil
	}
	f.use("Multicall3.getBlockHash(N-1)@pinHash(N)")

	// ---- parent-frame reads ------------------------------------------------
	parent, err := readParentFrame(ctx, c, f, account, debtToken, db, decimals, fc.Block-1, parentHash)
	if err != nil {
		return rows, res, err
	}
	if parent.st.unread != "" {
		rows = append(rows, unreadRow(gateBacktest, key, "parent-frame state", parent.st.unread))
		res.SkipClass = "parent-frame-unread"
		return rows, res, nil
	}
	// ---- execution-frame reads --------------------------------------------
	// The exec frame needs prices for the PARENT's collateral tokens too, not just
	// the seized ones: obligation 2's intra-block recomputation values the parent's
	// whole collateral basket at execution-frame prices, and a token whose price is
	// unread there cannot be silently held flat.
	f.use("ERC20.decimals(token)@pinHash(P_op)") // the 10^dec denominator every conversion below divides by
	execWant := make([]common.Address, 0, len(parent.st.collateral))
	for _, leg := range parent.st.collateral {
		execWant = append(execWant, leg.token)
	}
	exec, err := readExecFrame(ctx, c, f, account, debtToken, db, decimals, fc.Block, pinHash, execWant...)
	if err != nil {
		return rows, res, err
	}

	// ---- OBLIGATION 2: our eligibility boolean, three-state law -----------
	// The whole composition — parent predicate, causation replay, block-end
	// recomputation, classification — lives in obligation2Eligibility so the
	// EXACT production path is drivable by tests from fixtures/DB rows
	// (Codex round 5: isolated classifier calls with hand-fed booleans let
	// composition defects hide).
	o2 := obligation2Eligibility(key, v, parent, exec, c.dmProxy, account, debtToken, ourBefore, decimals, f)
	res.MarginUSD6 = o2.marginUSD6
	res.PriceDeltaNote = o2.priceNote
	res.EligibilityState = o2.eligState
	rows = append(rows, o2.row)

	// ---- OBLIGATION 3: seizure reconstruction, exact per branch ------------
	rows = append(rows, reconstructSeizures(key, v, parent, decimals, f)...)

	// ---- OBLIGATION 4: residue weld ---------------------------------------
	// EXEC, not parent (round-1 finding 6): borrowingOf is read on the execution
	// frame, so passing `parent` left chainDebt nil on EVERY case and gated all 31
	// weld-unread — a deterministic false failure that hid the obligation entirely.
	rows = append(rows, residueWeld(key, v, exec, f)...)

	res.Evaluated = true
	return rows, res, nil
}

// obl2Outcome carries obligation 2's composed verdict back into the case result.
type obl2Outcome struct {
	row        p3Row
	eligState  string
	marginUSD6 string
	priceNote  string
}

// obligation2Eligibility is obligation 2's PRODUCTION COMPOSITION: the parent
// eligibility predicate, the same-block causation replay, the block-end
// recomputation, and the three-state classification, composed exactly as
// runBacktestCase consumes them. It exists as a single function so the real
// composition is testable end-to-end from fixtures/DB rows — the round-5
// lesson is that hand-fed classifier booleans let composition defects hide.
//
// maxBorrowLT is computed by the SAME deployed loop shape in both frames —
// per-token floor, then sum (DebtManagerCore.sol:139-165) — so the ONLY
// difference between them is the engine-exact price. That is what makes the
// intra-block recomputation a causation test rather than a label.
func obligation2Eligibility(key string, v *backtestView, parent parentFrame, exec execFrame,
	dmProxy, account, debtToken common.Address, eventDebt *big.Int,
	decimals map[common.Address]uint8, f *gateFrame) obl2Outcome {
	var out obl2Outcome
	ourMaxBorrow, parentPriced := maxBorrowAtFrame(parent.st.collateral, parent.st.prices, parent.st.configs, decimals)

	priceMoved, moveNote := priceFrameDelta(parent, exec)
	out.priceNote = moveNote
	witnesses := v.sameBlockEarlier()
	// THE CAUSATION REPLAY'S STARTING STATE (Codex round 4, M): the PARENT
	// block's own position — the parent-boundary fold, the parent basket, the
	// parent prices and thresholds. The replay applies the block's decoded
	// pre-liquidation writes to THIS state in log order; the event-time debt
	// (eventDebt) is deliberately NOT the start, because it already contains
	// those writes' effects.
	cause := replaySameBlockCauses(v.sameBlockWitnesses(), dmProxy, account, debtToken, replayParentState{
		NormalizedAtParent: v.normalizedAtParent(),
		IndexAtBlock:       v.indexAtBlock(),
		Collateral:         parent.st.collateral,
		Prices:             parent.st.prices,
		Configs:            parent.st.configs,
		Decimals:           decimals,
	})

	// ONE SOURCE OF PARENT TRUTH (Codex round 5, H1): the parent predicate IS
	// the replay's own initial eligibility — the parent fold at the
	// event-sourced parent index against the parent frame's maxBorrowLT. The
	// event-time fold (eventDebt) already reflects the block's earlier debt
	// writes and the liquidation-time index, so a predicate computed from it
	// recorded an index-caused in-block crossing as true-at-parent EXACT and
	// lost the required marginal disclosure.
	ourEligible := cause.InitialEligible
	parentDebt := cause.ParentDebtUSD
	parentIndexText := "unreconstructed (replay refused its inputs)"
	if cause.ParentIndex != nil {
		parentIndexText = cause.ParentIndex.String()
	}
	if parentDebt == nil {
		// The replay refused its parent-state inputs, so there is no parent
		// truth to print; the event-time fold stands in FOR DISPLAY ONLY.
		// Classification is forced UNEXPLAINED by the completeness flag below.
		parentDebt = eventDebt
	}
	margin := new(big.Int).Sub(parentDebt, ourMaxBorrow)
	margin.Abs(margin)
	out.marginUSD6 = margin.String()

	// THE CAUSATION TEST (round-1 finding 7). The old code labelled a case
	// "flipped-with-witness" whenever ANY earlier log existed or ANY price
	// differed — it never checked that the witness actually flipped the boolean,
	// so an unrelated log in a busy block excused a genuine false negative. Now
	// the boolean is RECOMPUTED in the execution frame, and the flip must be
	// REPRODUCED: eligible-at-exec is required, not inferred.
	execMaxBorrow, execPriced := maxBorrowAtFrame(parent.st.collateral, exec.st.prices, parent.st.configs, decimals)
	execEligible := eventDebt.Cmp(execMaxBorrow) > 0
	allPriced := parentPriced && execPriced

	oblRow := p3Row{
		Gate: gateBacktest, Subject: key, Leg: "obligation2: OUR eligibility at N-1",
		Expected: "true (the contract executed the liquidation, so it was eligible in the execution frame)",
		Actual:   fmt.Sprintf("%v (parent-boundary debt %s vs maxBorrowLT %s)", ourEligible, parentDebt, ourMaxBorrow),
		Gated:    true,
		Evidence: map[string]string{
			"margin_usd6":                      margin.String(),
			"our_max_borrow_lt_at_parent":      ourMaxBorrow.String(),
			"our_max_borrow_lt_at_exec":        execMaxBorrow.String(),
			"our_debt_usd6":                    eventDebt.String(),
			"our_debt_usd6_at_parent":          parentDebt.String(),
			"parent_boundary_index":            parentIndexText,
			"recomputed_eligible_at_exec":      fmt.Sprintf("%v", execEligible),
			"price_frame_delta":                moveNote,
			"every_leg_priced_both_frames":     fmt.Sprintf("%v", allPriced),
			"same_block_earlier_logs":          fmt.Sprintf("%d", len(witnesses)),
			"same_block_witness_detail":        strings.Join(witnesses, "; "),
			"same_block_replay_applied":        fmt.Sprintf("%d", cause.Applied),
			"same_block_replay_complete":       fmt.Sprintf("%v", cause.Complete()),
			"same_block_replay_reversals":      fmt.Sprintf("%d", cause.Reversals),
			"eligible_at_liquidation_boundary": fmt.Sprintf("%v", cause.BoundaryEligible),
		},
	}
	if len(cause.Notes) > 0 {
		// Replay refusals and unmodelled writes are DISCLOSED as evidence AND
		// consumed as law: cause.Complete() feeds the classifier, so any
		// refusal forces UNEXPLAINED (round 5, M — evidence-only Notes proved
		// insufficient exactly as the declared rule warned).
		oblRow.Evidence["same_block_replay_notes"] = strings.Join(cause.Notes, "; ")
	}
	switch classifyIntraBlock(ourEligible, execEligible, allPriced, cause.Proven, cause.Complete()) {
	case eligTrueAtParent:
		out.eligState = "true-at-parent"
		oblRow.Verdict = verdictExact
		oblRow.Note = "TRUE-AT-PARENT: exact pass. Our boolean, over the replay's own parent-boundary debt (the parent fold at the event-sourced parent index) and the parent frame's pinned collateral/prices/thresholds, agrees with the chain's decision"
	case eligUnpriced:
		// A leg we could not price in BOTH frames makes the recomputation
		// impossible, and "cannot verify" is never advisory (round-11 F2).
		out.eligState = "unpriced-leg"
		oblRow.Verdict = verdictWeldUnread
		oblRow.Class = "intra-block-recompute-unpriced"
		oblRow.Note = "false at the parent frame, and at least one collateral leg could not be priced in BOTH frames — so the intra-block flip can be neither reproduced nor refuted. Gated as unread rather than excused: an unpriceable leg is exactly how a false negative would hide behind a 'witness'"
	case eligFlippedWithWitness:
		out.eligState = "flipped-in-block-with-custodied-witness"
		oblRow.Verdict = verdictMarginal
		oblRow.Class = verdictMarginal
		oblRow.Note = fmt.Sprintf("FLIPPED-IN-BLOCK, CAUSATION REPLAYED FROM PRE-LIQUIDATION STATE: false at the parent boundary (maxBorrowLT %s), and a CUSTODIED earlier log's DECODED write, applied to the parent state in log order, itself produces the false→true transition AND holds to the liquidation boundary — %s. The recomputation at execution-frame prices corroborates it (maxBorrowLT %s) but is not the proof, because it reads post-block state. Disclosed as marginal with the margin printed, never absorbed",
			ourMaxBorrow, strings.Join(cause.Causes, "; "), execMaxBorrow)
		f.cite(tolIntraBlockMarginality)
	default:
		out.eligState = verdictUnexplained
		oblRow.Verdict = verdictUnexplained
		oblRow.Class = verdictUnexplained
		if !cause.Complete() {
			oblRow.Note = fmt.Sprintf("UNEXPLAINED: the causation replay is INCOMPLETE — %d refusal note(s), disclosed under same_block_replay_notes. A witness the model cannot FULLY apply applies NOTHING and certifies nothing, so the case resolves UNEXPLAINED regardless of any proven cause or block-end recomputation (Codex round 5, M: the declared unreplayable→UNEXPLAINED rule, now structural). maxBorrowLT %s -> %s at execution-frame prices; earlier same-block logs %d (%d unrelated, %d applied); price moved between frames: %v",
				len(cause.Notes), ourMaxBorrow, execMaxBorrow, len(witnesses), cause.Unrelated, cause.Applied, priceMoved)
		} else {
			oblRow.Note = fmt.Sprintf("UNEXPLAINED: false at the parent boundary with NO replayed pre-liquidation cause SURVIVING to the liquidation boundary (%d true→false reversal(s) cleared any earlier crossing — a reversed crossing cannot be what the liquidation executed against, Codex round 5 H2). maxBorrowLT %s -> %s at execution-frame prices; earlier same-block logs %d (of which %d touch neither this account nor a token it holds, and %d decoded writes were applied to the replayed parent state WITHOUT producing a surviving flip); price moved between frames: %v. A post-block price difference is NOT proof of a pre-liquidation flip, an unrelated log is not a witness, and CONTACT without a replayed transition is not causation (a repayment, a routine index tick, an LT-neutral config write) — the gated third state of chain-truth R1's law: a false negative the block's own custody does not explain",
				cause.Reversals, ourMaxBorrow, execMaxBorrow, len(witnesses), cause.Unrelated, cause.Applied, priceMoved)
		}
	}
	out.row = oblRow
	return out
}

// maxBorrowAtFrame runs the deployed getMaxBorrowAmount loop over one frame's
// prices: floor per token, THEN sum (DebtManagerCore.sol:139-165). It returns
// allPriced=false when any leg lacks a price or a threshold, so a caller can
// refuse rather than value a leg at zero — silently dropping a leg would
// UNDERSTATE maxBorrowLT and manufacture eligibility.
func maxBorrowAtFrame(collateral []struct {
	token  common.Address
	amount *big.Int
}, prices map[common.Address]*big.Int, configs map[common.Address]collateralTokenConfigResult,
	decimals map[common.Address]uint8) (*big.Int, bool) {
	total := new(big.Int)
	allPriced := true
	for _, leg := range collateral {
		p := prices[leg.token]
		dec, okDec := decimals[leg.token]
		cfg, okCfg := configs[leg.token]
		if p == nil || !okDec || !okCfg || cfg.LiquidationThreshold == nil {
			allPriced = false
			continue
		}
		usd := new(big.Int).Mul(leg.amount, p)
		usd.Quo(usd, pow10Big(dec))
		contrib := new(big.Int).Mul(usd, cfg.LiquidationThreshold)
		contrib.Quo(contrib, hundredPercentDM)
		total.Add(total, contrib)
	}
	return total, allPriced
}

// parentFrame and execFrame are DISTINCT TYPES over the same reads.
//
// THE DEFECT THIS CLOSES (Codex round 2, finding M6 — and the round-1 finding 6 it
// re-armed): the two frames were both *frameState, so passing the wrong one was a
// plain argument mistake that shipped once and that a name-based AST pin could not
// reliably catch (`exec := parent` would have satisfied it). With separate types,
// `residueWeld(key, v, parent, f)` and `exec := parent` are both COMPILE ERRORS.
// The bug is unrepresentable rather than tested for.
//
// The constructors are separate too (readParentFrame / readExecFrame), so a frame
// cannot acquire the wrong type by assignment either.
type parentFrame struct{ st *frameState }

type execFrame struct{ st *frameState }

// frameState is one block frame's pinned reads.
type frameState struct {
	block      uint64
	hash       common.Hash
	collateral []struct {
		token  common.Address
		amount *big.Int
	}
	prices     map[common.Address]*big.Int
	configs    map[common.Address]collateralTokenConfigResult
	balances   map[common.Address]*big.Int
	chainDebt  *big.Int
	unread     string
	pricesOnly bool
}

// readParentFrame reads the PRE-LIQUIDATION frame: the collateral basket,
// per-token thresholds, Safe balances and engine-exact prices the deployed seizure
// branch used. Typed distinctly from the execution frame (see parentFrame).
func readParentFrame(ctx context.Context, c *p3Ctx, f *gateFrame, account, debtToken common.Address,
	db snapshotdb.T6BacktestRow, decimals map[common.Address]uint8, block uint64, hash common.Hash) (parentFrame, error) {
	st, err := readBacktestFrameState(ctx, c, f, account, debtToken, db, decimals, block, hash, true)
	return parentFrame{st: st}, err
}

// readExecFrame reads the EXECUTION-BLOCK frame: the post-liquidation residue leg
// (borrowingOf) plus the prices the caller asks for. It is the ONLY frame that
// reads borrowingOf, which is why obligation 4 must receive this type.
func readExecFrame(ctx context.Context, c *p3Ctx, f *gateFrame, account, debtToken common.Address,
	db snapshotdb.T6BacktestRow, decimals map[common.Address]uint8, block uint64, hash common.Hash,
	alsoPrice ...common.Address) (execFrame, error) {
	st, err := readBacktestFrameState(ctx, c, f, account, debtToken, db, decimals, block, hash, false, alsoPrice...)
	return execFrame{st: st}, err
}

// readBacktestFrameState reads one frame's state at a hash-bound pin. When
// `full` is false only the prices (and, at the execution frame, the residue
// read) are fetched — the execution frame exists for the marginality detector
// and obligation 4, not for a second eligibility evaluation.
func readBacktestFrameState(ctx context.Context, c *p3Ctx, f *gateFrame, account, debtToken common.Address,
	db snapshotdb.T6BacktestRow, decimals map[common.Address]uint8, block uint64, hash common.Hash, full bool,
	alsoPrice ...common.Address) (*frameState, error) {
	st := &frameState{
		block: block, hash: hash, pricesOnly: !full,
		prices:   map[common.Address]*big.Int{},
		configs:  map[common.Address]collateralTokenConfigResult{},
		balances: map[common.Address]*big.Int{},
	}
	// Tokens of interest: the seized elements (obligation 3), whatever
	// collateralOf reports in the full frame (obligation 2), plus any token the
	// caller needs priced here — the execution frame must price the PARENT's whole
	// collateral basket so obligation 2's intra-block recomputation can run.
	seized := map[common.Address]bool{}
	for _, a := range alsoPrice {
		seized[a] = true
	}
	for _, s := range db.Seizures {
		seized[common.HexToAddress(s.AssetHex)] = true
	}

	var calls []multicallCall
	type tag struct {
		kind string
		tok  common.Address
	}
	var tags []tag
	if full {
		d, err := dmCollateralOfABI.Pack("collateralOf", account)
		if err != nil {
			return nil, err
		}
		calls, tags = append(calls, multicallCall{Target: c.dmProxy, CallData: d}), append(tags, tag{kind: "collateralOf"})
	} else {
		d, err := dmBorrowingOfOneABI.Pack("borrowingOf", account, debtToken)
		if err != nil {
			return nil, err
		}
		calls, tags = append(calls, multicallCall{Target: c.dmProxy, CallData: d}), append(tags, tag{kind: "borrowingOf"})
	}
	for _, tok := range sortedAddrs(seized) {
		dec, ok := decimals[tok]
		if !ok {
			continue
		}
		d, err := dmConvertCollateralToUsdABI.Pack("convertCollateralTokenToUsd", tok, pow10Big(dec))
		if err != nil {
			return nil, err
		}
		calls, tags = append(calls, multicallCall{Target: c.dmProxy, CallData: d}), append(tags, tag{"price", tok})
		if !full {
			continue
		}
		if d, err = dmCollateralTokenConfigABI.Pack("collateralTokenConfig", tok); err != nil {
			return nil, err
		}
		calls, tags = append(calls, multicallCall{Target: c.dmProxy, CallData: d}), append(tags, tag{"config", tok})
		if d, err = erc20BalanceOfABI.Pack("balanceOf", account); err != nil {
			return nil, err
		}
		calls, tags = append(calls, multicallCall{Target: tok, CallData: d}), append(tags, tag{"balanceOf", tok})
	}
	res, _, err := c.opR.multicall(ctx, fmt.Sprintf("p3:backtest:frame@%d", block), block, hash, calls)
	if err != nil {
		st.unread = fmt.Sprintf("frame read at %d (%s) failed: %v", block, replayFailureClass(err), err)
		return st, nil
	}
	for i, tg := range tags {
		if !res[i].Success {
			continue
		}
		switch tg.kind {
		case "collateralOf":
			list, _, err := unpackTokenAmountList(dmCollateralOfABI, "collateralOf", res[i].ReturnData)
			if err != nil {
				st.unread = "collateralOf undecodable at the frame pin: " + err.Error()
				return st, nil
			}
			for _, l := range list {
				st.collateral = append(st.collateral, struct {
					token  common.Address
					amount *big.Int
				}{l.Token, l.Amount})
			}
			f.use("DebtManager.collateralOf(user)@parentHash(N-1)")
		case "borrowingOf":
			v, err := unpackUint256Strict(dmBorrowingOfOneABI, "borrowingOf", res[i].ReturnData)
			if err == nil {
				st.chainDebt = v
				f.use("DebtManager.borrowingOf(user, borrowToken)@pinHash(N)")
			}
		case "price":
			if v, err := unpackUint256Strict(dmConvertCollateralToUsdABI, "convertCollateralTokenToUsd", res[i].ReturnData); err == nil {
				st.prices[tg.tok] = v
				f.use("DebtManager.convertCollateralTokenToUsd(token, 10^dec)@parentHash(N-1) and @pinHash(N)")
			}
		case "config":
			if cfg, err := unpackCollateralTokenConfig(res[i].ReturnData); err == nil {
				st.configs[tg.tok] = cfg
				f.use("DebtManager.collateralTokenConfig(token)@parentHash(N-1)")
			}
		case "balanceOf":
			if v, err := unpackUint256Strict(erc20BalanceOfABI, "balanceOf", res[i].ReturnData); err == nil {
				st.balances[tg.tok] = v
				f.use("ERC20.balanceOf(user, token)@parentHash(N-1)")
			}
		}
	}
	if full {
		// The parent frame needs collateral AND the per-token price/config for
		// each seized token; a missing price is what makes the frame unread.
		for _, tok := range sortedAddrs(seized) {
			if st.prices[tok] == nil {
				st.unread = "the engine-exact price for seized token " + tok.Hex() + " did not read at the parent frame"
				return st, nil
			}
		}
	}
	return st, nil
}

// priceFrameDelta reports whether any seized token's engine-exact price differs
// between the parent and execution frames — risk-quant R2's detector (b).
func priceFrameDelta(parent parentFrame, exec execFrame) (bool, string) {
	moved := false
	var notes []string
	for _, tok := range sortedAddrs(addrSetFromPrices(parent.st.prices)) {
		p, e := parent.st.prices[tok], exec.st.prices[tok]
		if p == nil || e == nil {
			notes = append(notes, tok.Hex()+": one frame's price is unread")
			continue
		}
		if p.Cmp(e) != 0 {
			moved = true
			notes = append(notes, fmt.Sprintf("%s: parent %s -> exec %s", tok.Hex(), p, e))
		}
	}
	if len(notes) == 0 {
		return false, "every seized token's engine-exact price is IDENTICAL at N-1 and N"
	}
	return moved, strings.Join(notes, "; ")
}

func addrSetFromPrices(m map[common.Address]*big.Int) map[common.Address]bool {
	out := map[common.Address]bool{}
	for a := range m {
		out[a] = true
	}
	return out
}

// preparedSeizure is one fan-out element with the pinned parent-frame inputs the
// deployed branch used. Package-level so the branch classifier can be tested with
// Codex's boundary integers directly.
type preparedSeizure struct {
	s     snapshotdb.T6Seizure
	tok   common.Address
	cfg   collateralTokenConfigResult
	bal   *big.Int
	price *big.Int
	dec   uint8
}

// deployedTakesPartial is the contract's own branch predicate, exported for tests:
// totalCollateral - maxBonus < collateralAmountForDebt selects PARTIAL, and the
// comparison is STRICT, so equality selects FINAL (DebtManagerCore.sol:625-638).
func deployedTakesPartial(e preparedSeizure, u *big.Int) bool {
	cAFD := new(big.Int).Mul(u, pow10Big(e.dec))
	cAFD.Quo(cAFD, e.price)
	net := new(big.Int).Mul(e.bal, hundredPercentDM)
	net.Quo(net, new(big.Int).Add(hundredPercentDM, e.cfg.LiquidationBonus))
	maxBonus := new(big.Int).Sub(e.bal, net)
	return new(big.Int).Sub(e.bal, maxBonus).Cmp(cAFD) < 0
}

// reconstructSeizures recomputes every userCollateralLiquidated element under
// the deployed branch it must have taken, WITH THE REPAY BUDGET CARRIED ACROSS
// THE ORDERED ELEMENTS.
//
// The deployed loop (DebtManagerCore.sol:613-658), per element, with u the
// residual repayDebtUsdAmt:
//
//	cAFD = floor(u x 10^dec / P)                         (convertUsdToCollateralToken)
//	net  = floor(totalCollateral x HP / (HP+b))
//	maxBonus = totalCollateral - net
//	if totalCollateral - maxBonus < cAFD:                 PARTIAL
//	    amount = totalCollateral ; bonus = maxBonus
//	    u -= floor((totalCollateral - bonus) x P / 10^dec) (convertCollateralTokenToUsd)
//	else:                                                 FINAL
//	    bonus = floor(cAFD x b / HP) ; amount = cAFD + bonus ; loop BREAKS
//
// and liquidatedAmt = debtAmountToLiquidateInUsd - remainingDebt.
//
// THE DEFECT THIS REPLACES (Codex round 1, finding 5). The previous version
// INVERTED cAFD from the observed amount-minus-bonus and then re-derived the
// bonus from that same inverted value. That is internally consistent for any
// PROPORTIONALLY wrong pair - scale amount and bonus together and the check still
// passes - and it never consumed LiquidatedUSD at all, so the elements were never
// tied to the debt the contract actually liquidated.
//
// Now the budget is the anchor. Two determinate shapes:
//
//   - the last element took the FINAL branch => remainingDebt == 0 =>
//     u0 == liquidatedAmt EXACTLY. The walk reproduces every element from u0
//     forward, welding the branch PREDICATE and the exact conversion at each step,
//     and derives the final element from the CARRIED u rather than from its own
//     recorded amount.
//   - every element took the PARTIAL branch (the preference array ran out) =>
//     liquidatedAmt == sum of floor((amount-bonus) x P / 10^dec), one exact
//     equation over all elements that a proportionally-wrong pair cannot satisfy.
func reconstructSeizures(key string, v *backtestView, parent parentFrame,
	decimals map[common.Address]uint8, f *gateFrame) []p3Row {
	var rows []p3Row
	seizures := v.seizures()
	liquidated := v.liquidatedUSD()

	var elems []preparedSeizure
	for _, s := range seizures {
		tok := common.HexToAddress(s.AssetHex)
		subject := fmt.Sprintf("%s element %d %s", key, s.Seq, tok.Hex())
		cfg, okCfg := parent.st.configs[tok]
		bal, okBal := parent.st.balances[tok]
		price := parent.st.prices[tok]
		dec, okDec := decimals[tok]
		if !okCfg || !okBal || price == nil || !okDec || cfg.LiquidationBonus == nil {
			rows = append(rows, unreadRow(gateBacktest, subject, "obligation3: seizure inputs",
				"one or more of {collateralTokenConfig, balanceOf, engine-exact price, decimals} did not read at the parent frame"))
			continue
		}
		elems = append(elems, preparedSeizure{s: s, tok: tok, cfg: cfg, bal: bal, price: price, dec: dec})
	}
	if len(elems) != len(seizures) {
		// An unread input means the budget walk cannot be closed. The unread rows
		// above already gate; continuing would compare against a hole.
		return rows
	}
	if len(elems) == 0 {
		return rows
	}
	if liquidated == nil {
		// Without the budget there is nothing to anchor the walk to, and inverting
		// it from the elements is exactly the circularity round 1 rejected.
		return append(rows, unreadRow(gateBacktest, key, "obligation3: repay budget",
			"the event's own liquidatedAmt did not decode, so the seizure reconstruction has no budget to carry across the elements"))
	}

	partialOf := func(e preparedSeizure) (amount, bonus, credited *big.Int) {
		net := new(big.Int).Mul(e.bal, hundredPercentDM)
		net.Quo(net, new(big.Int).Add(hundredPercentDM, e.cfg.LiquidationBonus))
		bonus = new(big.Int).Sub(e.bal, net)
		amount = new(big.Int).Set(e.bal)
		credited = new(big.Int).Sub(amount, bonus)
		credited.Mul(credited, e.price)
		credited.Quo(credited, pow10Big(e.dec))
		return amount, bonus, credited
	}
	finalOf := func(e preparedSeizure, u *big.Int) (amount, bonus, cAFD *big.Int) {
		cAFD = new(big.Int).Mul(u, pow10Big(e.dec))
		cAFD.Quo(cAFD, e.price)
		bonus = new(big.Int).Mul(cAFD, e.cfg.LiquidationBonus)
		bonus.Quo(bonus, hundredPercentDM)
		amount = new(big.Int).Add(cAFD, bonus)
		return amount, bonus, cAFD
	}
	// The branch predicate, on the contract's own terms.

	// THE SHAPE IS DECIDED BY ARITHMETIC HYPOTHESES, NEVER BY THE EMITTED AMOUNT
	// (Codex round 2, finding M5).
	//
	// The previous discriminator read `last amount == parent balance` as ALL-PARTIAL.
	// That equality ALSO occurs on the FINAL boundary — Codex's vector: HP=100,
	// bonus=10, balance=110, cAFD=100 gives net=100, maxBonus=10,
	// balance-maxBonus=100, and the deployed predicate `net < cAFD` is FALSE at
	// equality, so the branch is FINAL while amount = 100+10 = 110 = the balance.
	//
	// Working the shape out honestly means facing something the first fix missed:
	// liquidatedAmt does NOT determine u0 in the all-partial case (there
	// liquidatedAmt = u0 - remainingDebt with remainingDebt > 0), so a predicate walk
	// seeded with u = liquidatedAmt is not the contract's walk either. What IS
	// checkable is each shape as a HYPOTHESIS over observed values:
	//
	//   ALL-PARTIAL      every element satisfies the partial identity pair AND
	//                    liquidatedAmt == sum of credited USD;
	//   FINAL-TERMINATED the predicate-driven walk from u0 = liquidatedAmt reaches
	//                    FINAL at the last element with every identity exact and the
	//                    budget spent to zero.
	//
	// Exactly one holding resolves the shape. BOTH holding is the true boundary: the
	// two readings then agree on every element identity, so the row is exact and the
	// ambiguity is DISCLOSED rather than silently resolved. Neither holding gates.
	allPartial, allPartialRows, allPartialWhy := tryAllPartial(key, elems, liquidated, partialOf)
	finalTerm, finalRows, finalWhy := tryFinalTerminated(key, elems, liquidated, partialOf, finalOf, f)

	switch {
	case allPartial && !finalTerm:
		return append(rows, allPartialRows...)
	case finalTerm && !allPartial:
		return append(rows, finalRows...)
	case allPartial && finalTerm:
		// The boundary. Both hypotheses reproduce every element exactly, so the
		// element rows are the same either way; emit them once and name the
		// ambiguity as evidence so nobody reads a resolved branch label that the
		// observation does not support.
		rows = append(rows, allPartialRows...)
		rows = append(rows, p3Row{
			Gate: gateBacktest, Subject: key, Leg: "obligation3: branch shape is observationally AMBIGUOUS",
			Expected: "exactly one of {ALL-PARTIAL, FINAL-TERMINATED} consistent with the emitted elements",
			Actual:   "BOTH are consistent (the FINAL boundary: totalCollateral - maxBonus == collateralAmountForDebt)",
			Verdict:  verdictEvidence, Gated: false,
			Note: "at this boundary the deployed predicate's strict `<` selects FINAL while the emitted amount also equals the Safe balance, so the two readings produce identical numbers. Every element identity is exact under BOTH, which is why this is disclosed rather than gated — but the branch LABEL is not determined by the observation, and the round-1 code silently asserted the wrong one (Codex round 2, finding M5)",
		})
		return rows
	default:
		rows = append(rows, driftRow(gateBacktest, key, "obligation3: branch shape",
			"the emitted elements follow from ONE of the deployed shapes at the liquidatedAmt budget",
			"neither shape reproduces them", "seizure-shape-inconsistent",
			"ALL-PARTIAL rejected because: "+allPartialWhy+" | FINAL-TERMINATED rejected because: "+finalWhy+
				". Because the budget is anchored to liquidatedAmt, a proportionally-wrong pair lands here rather than passing"))
		// The per-element diagnostics from the closer hypothesis are still useful.
		rows = append(rows, finalRows...)
		return rows
	}
}

// tryAllPartial tests the ALL-PARTIAL hypothesis: every element took the partial
// branch and liquidatedAmt is the sum of the credited USD. It returns the rows the
// hypothesis would emit, so the caller can publish them once the shape is resolved.
func tryAllPartial(key string, elems []preparedSeizure, liquidated *big.Int,
	partialOf func(preparedSeizure) (*big.Int, *big.Int, *big.Int)) (bool, []p3Row, string) {
	var rows []p3Row
	sum := new(big.Int)
	ok := true
	why := ""
	for _, e := range elems {
		wantAmount, wantBonus, _ := partialOf(e)
		credited := new(big.Int).Sub(e.s.Amount, e.s.Bonus)
		credited.Mul(credited, e.price)
		credited.Quo(credited, pow10Big(e.dec))
		sum.Add(sum, credited)
		subject := fmt.Sprintf("%s element %d %s", key, e.s.Seq, e.tok.Hex())
		if e.s.Amount.Sign() == 0 && e.s.Bonus.Sign() == 0 {
			row := compareExact(gateBacktest, subject, "obligation3: partial branch, amount == Safe balance",
				e.bal, e.s.Amount, "seizure-partial-zero")
			row.Note = "PARTIAL branch with totalCollateral == 0: the contract seizes the whole (empty) balance, so the falsifiable content is that the Safe REALLY held none of this token at the parent frame. " + row.Note
			rows = append(rows, row)
			if e.bal.Sign() != 0 {
				ok, why = false, fmt.Sprintf("element %d emitted a zero amount over a NONZERO Safe balance %s", e.s.Seq, e.bal)
			}
			continue
		}
		amountRow := compareExact(gateBacktest, subject, "obligation3: partial branch amount == totalCollateral",
			wantAmount, e.s.Amount, "seizure-partial-amount")
		bonusRow := compareExact(gateBacktest, subject, "obligation3: partial branch bonus == totalCollateral - floor(totalCollateral*HP/(HP+b))",
			wantBonus, e.s.Bonus, "seizure-partial-bonus")
		rows = append(rows, amountRow, bonusRow)
		if amountRow.Verdict != verdictExact || bonusRow.Verdict != verdictExact {
			ok, why = false, fmt.Sprintf("element %d does not satisfy the partial identity pair", e.s.Seq)
		}
	}
	budget := compareExact(gateBacktest, key, "obligation3: liquidatedAmt == sum of credited USD over ALL elements",
		liquidated, sum, "seizure-budget-all-partial")
	budget.Evidence = map[string]string{
		"shape":        "ALL-PARTIAL (the collateral-preference array was exhausted before the debt was covered)",
		"elements":     fmt.Sprintf("%d", len(elems)),
		"credited_sum": sum.String(),
		"law":          "liquidatedAmt = debtAmountToLiquidateInUsd - remainingDebt, and every element credited floor((amount-bonus)*P/10^dec), so the sum IS the liquidated USD (DebtManagerCore.sol:613-658)",
	}
	rows = append(rows, budget)
	if budget.Verdict != verdictExact {
		ok, why = false, fmt.Sprintf("liquidatedAmt %s != the credited sum %s", liquidated, sum)
	}
	return ok, rows, why
}

// tryFinalTerminated tests the FINAL-TERMINATED hypothesis: remainingDebt == 0, so
// u0 == liquidatedAmt exactly, and the predicate-driven walk reaches FINAL at the
// last element with every identity exact and the budget spent.
func tryFinalTerminated(key string, elems []preparedSeizure, liquidated *big.Int,
	partialOf func(preparedSeizure) (*big.Int, *big.Int, *big.Int),
	finalOf func(preparedSeizure, *big.Int) (*big.Int, *big.Int, *big.Int),
	f *gateFrame) (bool, []p3Row, string) {
	var rows []p3Row
	ok, why := true, ""
	// u0 == 0 makes this hypothesis IMPOSSIBLE, by the contract rather than by any
	// emitted value: _liquidate reverts when debtAmountToLiquidateInUsd == 0
	// (DebtManagerCore.sol:567), so a FINAL-terminated walk cannot start from a zero
	// budget. Refusing it here is what keeps the zero-amount population falsifiable —
	// with u = 0 the final branch reproduces a zero element for ANY Safe balance, so
	// admitting it would turn this population'''s dominant shape into a vacuous pass.
	if liquidated.Sign() == 0 {
		return false, nil, "liquidatedAmt is 0, so remainingDebt > 0 and u0 != liquidatedAmt: _liquidate reverts on a zero requested debt (DebtManagerCore.sol:567), so the loop covered nothing and every element took PARTIAL over an empty balance"
	}
	u := new(big.Int).Set(liquidated)
	sawFinal := false
	for i, e := range elems {
		subject := fmt.Sprintf("%s element %d %s", key, e.s.Seq, e.tok.Hex())
		isLast := i == len(elems)-1
		wantPartial := deployedTakesPartial(e, u)
		observedPartial := observedBranchIsPartial(e, u, partialOf, finalOf)

		predicateRow := p3Row{
			Gate: gateBacktest, Subject: subject, Leg: "obligation3: branch predicate at the carried repay budget",
			Expected: branchName(wantPartial), Actual: branchName(observedPartial), Gated: true,
			Evidence: map[string]string{
				"carried_repay_usd": u.String(),
				"total_collateral":  e.bal.String(),
				"engine_price":      e.price.String(),
				"law":               "totalCollateral - maxBonus < collateralAmountForDebt selects PARTIAL, STRICTLY, so equality selects FINAL (DebtManagerCore.sol:625-638)",
			},
		}
		if wantPartial == observedPartial {
			predicateRow.Verdict = verdictExact
		} else {
			predicateRow.Verdict = verdictDrift
			predicateRow.Class = "seizure-branch-predicate"
			predicateRow.Note = "the branch the deployed predicate selects at the CARRIED repay budget is not the branch this element exhibits. Because the budget is anchored to liquidatedAmt, this catches the proportionally-wrong pair the inverted-cAFD check could not"
			ok, why = false, fmt.Sprintf("element %d: predicate says %s, element exhibits %s", e.s.Seq, branchName(wantPartial), branchName(observedPartial))
		}
		rows = append(rows, predicateRow)

		if wantPartial {
			wantAmount, wantBonus, credited := partialOf(e)
			aRow := compareExact(gateBacktest, subject, "obligation3: partial branch amount == totalCollateral",
				wantAmount, e.s.Amount, "seizure-partial-amount")
			bRow := compareExact(gateBacktest, subject, "obligation3: partial branch bonus == totalCollateral - floor(totalCollateral*HP/(HP+b))",
				wantBonus, e.s.Bonus, "seizure-partial-bonus")
			rows = append(rows, aRow, bRow)
			if aRow.Verdict != verdictExact || bRow.Verdict != verdictExact {
				ok, why = false, fmt.Sprintf("element %d does not satisfy the partial identity pair", e.s.Seq)
			}
			u = new(big.Int).Sub(u, credited)
			if u.Sign() < 0 {
				u = new(big.Int)
			}
			continue
		}

		// FINAL branch, derived from the CARRIED budget, never from the observed
		// amount. This is what makes a proportionally-wrong pair fail.
		sawFinal = true
		wantAmount, wantBonus, cAFD := finalOf(e, u)
		amountRow := compareExact(gateBacktest, subject, "obligation3: final branch amount == floor(u*10^dec/P) + floor(cAFD*b/HP)",
			wantAmount, e.s.Amount, "seizure-final-amount")
		perWei := new(big.Int).Add(e.price, pow10Big(e.dec))
		perWei.Sub(perWei, big.NewInt(1))
		perWei.Quo(perWei, pow10Big(e.dec))
		amountRow.Evidence = map[string]string{
			"branch":                 "FINAL (amount = collateralAmountForDebt + bonus)",
			"carried_repay_usd":      u.String(),
			"collateral_for_debt":    cAFD.String(),
			"liquidation_bonus":      e.cfg.LiquidationBonus.String(),
			"engine_price_at_parent": e.price.String(),
			"round_trip_slack":       "the credited USD round trip floor(floor(u*10^dec/P)*P/10^dec) sits in [u - ceil(P/10^dec), u], a deficit of at most ONE WEI of the collateral token; ceil(P/10^dec) here = " + perWei.String() + " USD-6 units. The TOKEN-UNIT comparisons in these rows are EXACT; the slack exists only on the USD re-derivation leg",
			"tolerance":              tolSeizureTokenWei.String(),
		}
		f.cite(tolSeizureTokenWei)
		bonusRow := compareExact(gateBacktest, subject, "obligation3: final branch bonus == floor(cAFD*b/HP)",
			wantBonus, e.s.Bonus, "seizure-final-bonus")
		rows = append(rows, amountRow, bonusRow)
		if amountRow.Verdict != verdictExact || bonusRow.Verdict != verdictExact {
			ok, why = false, fmt.Sprintf("element %d does not satisfy the final identity pair at the carried budget", e.s.Seq)
		}
		if !isLast {
			rows = append(rows, driftRow(gateBacktest, subject, "obligation3: final branch terminates the fan-out",
				fmt.Sprintf("the FINAL branch is element %d of %d", i+1, len(elems)),
				"more elements follow", "seizure-final-not-last",
				"the deployed loop assembly-trims the array and BREAKS on the final branch (DebtManagerCore.sol:645-652), so an element after it cannot exist"))
			ok, why = false, "the FINAL branch is not the last element"
		}
		u = new(big.Int)
		break
	}
	if !sawFinal {
		ok, why = false, "the predicate never selected FINAL, so remainingDebt > 0 and u0 != liquidatedAmt"
	}
	spent := compareExact(gateBacktest, key, "obligation3: carried repay budget fully spent",
		new(big.Int), u, "seizure-budget-residual")
	spent.Evidence = map[string]string{
		"shape": "FINAL-TERMINATED (remainingDebt == 0, so u0 == liquidatedAmt exactly)",
		"u0":    liquidated.String(),
		"law":   "liquidatedAmt = debtAmountToLiquidateInUsd - remainingDebt (DebtManagerCore.sol:576-578)",
	}
	rows = append(rows, spent)
	if spent.Verdict != verdictExact {
		ok, why = false, "the budget was not spent to zero"
	}
	return ok, rows, why
}

// observedBranchIsPartial reads the branch an element EXHIBITS from the identities
// it satisfies, at the carried repay budget.
//
// At the FINAL boundary `amount == totalCollateral` is true for BOTH branches, so
// the balance equality alone cannot classify. The identities can: the PARTIAL pair
// is (amount == totalCollateral, bonus == totalCollateral - net) and the FINAL pair
// is (amount == cAFD + floor(cAFD*b/HP), bonus == floor(cAFD*b/HP)) with cAFD
// derived from the carried u. When BOTH hold — exactly Codex's boundary vector —
// the element is reported as FINAL, matching the deployed predicate's strict `<`,
// so the verdict row agrees with the contract instead of contradicting it.
func observedBranchIsPartial(e preparedSeizure, u *big.Int,
	partialOf func(preparedSeizure) (*big.Int, *big.Int, *big.Int),
	finalOf func(preparedSeizure, *big.Int) (*big.Int, *big.Int, *big.Int)) bool {
	pAmount, pBonus, _ := partialOf(e)
	fAmount, fBonus, _ := finalOf(e, u)
	partialHolds := e.s.Amount.Cmp(pAmount) == 0 && e.s.Bonus.Cmp(pBonus) == 0
	finalHolds := e.s.Amount.Cmp(fAmount) == 0 && e.s.Bonus.Cmp(fBonus) == 0
	if finalHolds {
		// The boundary: FINAL is what the deployed predicate selects at equality.
		return false
	}
	return partialHolds
}

// branchName renders the deployed branch selector for a verdict row.
func branchName(partial bool) string {
	if partial {
		return "PARTIAL"
	}
	return "FINAL"
}

// residueWeld is obligation 4: the post-liquidation residue, <=1 normalized wei
// and ONLY for fully-liquidated accounts.
//
// TWO DEFECTS THIS REPLACES (Codex round 1, finding 6):
//
//  1. THE FRAME WAS WRONG. runBacktestCase passed the PARENT frame, but
//     borrowingOf is only read on the EXECUTION frame, so parent.chainDebt was
//     nil on every case and ALL 31 gated weld-unread. The obligation existed in
//     name only and could never pass - a deterministic false failure that also
//     hid whatever the obligation would have found.
//  2. THE EXPECTED VALUE WAS WRONG FOR FIRST PASSES. A first pass's after-state
//     cannot be welded against block-end borrowingOf, because the SECOND pass
//     moves the debt again before the block closes: the comparison would always
//     show our after-state as too high by the second pass's liquidation. The
//     chain's own statement of the state BETWEEN the passes is the next event's
//     beforeDebtAmount, and that is what a first pass is welded against.
//     Block-end borrowingOf is reserved for the FINAL pass, where it is the
//     honest expected value.
func residueWeld(key string, v *backtestView, exec execFrame, f *gateFrame) []p3Row {
	ourAfter := mulDivFloor(v.normalizedAfter(), v.indexAtBlock())
	residueModelled, residueText := v.residue()

	// FIRST PASS of a two-pass tx: the expected value is the NEXT pass's own
	// beforeDebtAmount, which is the chain's statement of the state between them.
	if v.hasNextPass() {
		nextIdx, nextBefore, nextText, _ := v.nextPass()
		if nextBefore == nil {
			return []p3Row{unreadRow(gateBacktest, key, "obligation4: residue weld (first pass)",
				fmt.Sprintf("a following Liquidated exists at log_index %d but its beforeDebtAmount did not decode, so the between-passes state has no expected value", nextIdx))}
		}
		row := compareExact(gateBacktest, key, "obligation4: after-state == the NEXT pass's beforeDebtAmount",
			nextBefore, ourAfter, "residue-first-pass-chain")
		row.Evidence = map[string]string{
			"normalized_after":      v.normalizedAfterText(),
			"next_pass_log_index":   fmt.Sprintf("%d", nextIdx),
			"next_pass_before_debt": nextText,
			"frame":                 "FIRST PASS: block-end borrowingOf is NOT the expected value here, because the second pass moves the debt again before the block closes",
		}
		if row.Verdict == verdictExact {
			row.Note = "EXACT: our replayed after-state equals the chain's own statement of the between-passes state. This is the 50%-then-remainder path welded at its hinge - the hardest accounting in the frame"
		}
		return []p3Row{row}
	}

	// FINAL (or only) pass: block-end borrowingOf is the honest expected value.
	if exec.st.chainDebt == nil {
		return []p3Row{unreadRow(gateBacktest, key, "obligation4: residue weld",
			"borrowingOf(user, borrowToken) did not read at the liquidation block")}
	}
	// "Fully liquidated" is judged on the CHAIN side, deliberately: the whole
	// mechanism the tolerance cites is that the contract set a remaining
	// normalized amount of 1 to ZERO without emitting anything, so the chain
	// reads closed while our fold still carries the wei. Judging it on OUR side
	// would make the tolerance unreachable exactly in the case it exists for.
	fullyLiquidated := exec.st.chainDebt.Sign() == 0
	row := p3Row{
		Gate: gateBacktest, Subject: key, Leg: "obligation4: residue weld",
		Expected: exec.st.chainDebt.String(), Actual: ourAfter.String(), Gated: true,
		Evidence: map[string]string{
			"normalized_after": v.normalizedAfterText(),
			"residue_modelled": fmt.Sprintf("%v", residueModelled),
			"residue_amount":   residueText,
			"fully_liquidated": fmt.Sprintf("%v", fullyLiquidated),
			"frame":            "FINAL (or only) pass: block-end borrowingOf IS the honest expected value",
		},
	}
	diff := new(big.Int).Sub(ourAfter, exec.st.chainDebt)
	switch {
	case diff.Sign() == 0:
		row.Verdict = verdictExact
		row.Note = "EXACT with no tolerance spent. Our replayed after-state equals borrowingOf at the liquidation block"
	case fullyLiquidated && !residueModelled && diff.Sign() > 0 && diff.Cmp(big.NewInt(1)) <= 0:
		// THE single legitimate standing tolerance in Task 6.
		row.Verdict = verdictExact
		row.Class = "residue-1-wei-tolerance-spent"
		row.Note = "the ONE legitimate standing tolerance: <=1 normalized wei on a FULLY-LIQUIDATED account, derived-high direction only, citing the silent zeroing at DebtManagerCore.sol:549-553 (the contract sets a remaining normalized amount of exactly 1 to zero without emitting anything). The deriver did NOT model it for this case, so the tolerance is spent here rather than absorbed silently"
		row.Evidence["tolerance"] = tolResidueWei.String()
		f.cite(tolResidueWei)
	case residueModelled && diff.Sign() != 0:
		row.Verdict = verdictDrift
		row.Class = "residue-modelled-yet-drifting"
		row.Note = "the deriver ALREADY modelled the 1-wei zeroing for this case (a residue_zeroed event exists), so the residue tolerance is not available: the remaining difference is something else"
	default:
		row.Verdict = verdictDrift
		row.Class = "residue-drift"
		row.Note = fmt.Sprintf("difference %s. The residue tolerance applies ONLY to fully-liquidated accounts, only in the derived-high direction, and only up to 1 normalized wei; this row is outside all three conditions, so it is drift", diff)
	}
	return []p3Row{row}
}

func priorPassText(v *uint32) string {
	if v == nil {
		return "(none — first or only pass)"
	}
	return fmt.Sprintf("%d", *v)
}

// dmWitnessABI is the hand-authored event surface the same-block causation replay
// matches topic0s against, transcribed from internal/decode/abis/DebtManagerCore.json
// (the committed forge artifact) with the tuple components verbatim.
//
// WHY IT IS AN ABI AND NOT A LIST OF CONSTANTS (Codex round 3, finding H). The
// previous version hard-coded five topic0 hashes computed from signatures I had
// written out by hand, and one of them was WRONG: the deployed event is
// `InterestIndexUpdated(address indexed borrowToken, uint256 oldIndex, uint256
// newIndex)` — THREE arguments — and the constant came from a two-argument signature
// that does not exist. Its hash therefore matched nothing, so every genuine
// interest-index witness fell through as `unrelated` and a case whose only custodied
// cause was an index move would be classified UNEXPLAINED and fail an honest run.
//
// Deriving the IDs from an abi.ABI removes the hash transcription; the SIGNATURE
// transcription that remains is pinned in tests against BOTH the real decoder
// fixtures in internal/decode/testdata and the committed ABI file itself, neither of
// which comes from a signature I wrote. That is the lesson of the finding: a witness
// predicate needs fixture-backed regressions, not another hand-written signature.
//
// These are also the ONLY writes this run can prove happened before the liquidation
// log, because the Debt Manager proxy is the only DM-side address in the walker
// stream set. PriceProviderV2 is NOT walked, so a price push is NOT a custodied
// witness — which is precisely why a post-block price difference can never be proof
// of a pre-liquidation flip (Codex round 2, finding H2).
var dmWitnessABI = mustParseABI(`[
	{"type":"event","name":"Liquidated","inputs":[
		{"name":"liquidator","type":"address","indexed":true},
		{"name":"user","type":"address","indexed":true},
		{"name":"debtTokenToLiquidate","type":"address","indexed":true},
		{"name":"userCollateralLiquidated","type":"tuple[]","indexed":false,"components":[
			{"name":"token","type":"address"},
			{"name":"amount","type":"uint256"},
			{"name":"liquidationBonus","type":"uint256"}]},
		{"name":"beforeDebtAmount","type":"uint256","indexed":false},
		{"name":"debtAmountLiquidated","type":"uint256","indexed":false}]},
	{"type":"event","name":"InterestIndexUpdated","inputs":[
		{"name":"borrowToken","type":"address","indexed":true},
		{"name":"oldIndex","type":"uint256","indexed":false},
		{"name":"newIndex","type":"uint256","indexed":false}]},
	{"type":"event","name":"CollateralTokenConfigSet","inputs":[
		{"name":"collateralToken","type":"address","indexed":true},
		{"name":"oldConfig","type":"tuple","indexed":false,"components":[
			{"name":"ltv","type":"uint80"},
			{"name":"liquidationThreshold","type":"uint80"},
			{"name":"liquidationBonus","type":"uint96"}]},
		{"name":"newConfig","type":"tuple","indexed":false,"components":[
			{"name":"ltv","type":"uint80"},
			{"name":"liquidationThreshold","type":"uint80"},
			{"name":"liquidationBonus","type":"uint96"}]}]},
	{"type":"event","name":"Borrowed","inputs":[
		{"name":"user","type":"address","indexed":true},
		{"name":"token","type":"address","indexed":true},
		{"name":"amount","type":"uint256","indexed":false}]},
	{"type":"event","name":"Repaid","inputs":[
		{"name":"user","type":"address","indexed":true},
		{"name":"payer","type":"address","indexed":true},
		{"name":"token","type":"address","indexed":true},
		{"name":"amount","type":"uint256","indexed":false}]}
]`)

// dmWitnessTopic0 is the lowercase hex topic0 of one witness event, taken from the
// ABI object rather than written down.
func dmWitnessTopic0(event string) string {
	ev, ok := dmWitnessABI.Events[event]
	if !ok {
		// Unreachable via the named helpers below; a typo there is a nil-ID match
		// against nothing, so it is made loud instead.
		panic("reconcile: dmWitnessABI has no event " + event)
	}
	return hex.EncodeToString(ev.ID.Bytes())
}

// The five witness topic0s, derived once at init.
var (
	topicDMLiquidated           = dmWitnessTopic0("Liquidated")
	topicDMInterestIndexUpdated = dmWitnessTopic0("InterestIndexUpdated")
	topicDMCollateralConfigSet  = dmWitnessTopic0("CollateralTokenConfigSet")
	topicDMBorrowed             = dmWitnessTopic0("Borrowed")
	topicDMRepaid               = dmWitnessTopic0("Repaid")
)

// collateralLeg is an ALIAS for the anonymous per-leg struct frameState and
// maxBorrowAtFrame already share, so the replay can copy and mutate a basket
// without re-deriving the gate's eligibility math.
type collateralLeg = struct {
	token  common.Address
	amount *big.Int
}

// replayParentState is the PARENT-BLOCK state the causation replay starts
// from (Codex round 4, M). Every field is an input the gate already reads —
// nothing here is a new source: the fold comes from the same Σ-delta
// discipline as obligation 1, and the basket/prices/configs are the parent
// frame's pinned reads.
type replayParentState struct {
	// NormalizedAtParent is the account's normalized debt in the CASE'S debt
	// token at the parent boundary — Σ deltas strictly below block N. It
	// deliberately excludes the block's own earlier events: the replay applies
	// those itself, in log order, from their decoded payloads.
	NormalizedAtParent *big.Int
	// IndexAtBlock is the case's own liquidation-time index snapshot. It is the
	// replay's FALLBACK starting index only: when the block carries an earlier
	// InterestIndexUpdated for the debt token, that event's decoded oldIndex IS
	// the parent-boundary index (the chain's own statement of the value carried
	// into the block) and supersedes this.
	IndexAtBlock *big.Int
	// Collateral / Prices / Configs are the parent frame's pinned reads.
	// Prices stay FIXED for the whole replay: a DM price move is not a DM log
	// (PriceProviderV2 is outside the walked witness surface), so no witness
	// event can move them — which is exactly why a post-liquidation price
	// difference must never become a proven cause.
	Collateral []collateralLeg
	Prices     map[common.Address]*big.Int
	Configs    map[common.Address]collateralTokenConfigResult
	// Decimals is the pinned ERC20.decimals map (10^dec denominators).
	Decimals map[common.Address]uint8
}

// causeReplay is the outcome of replaying the ordered same-block earlier witnesses
// against THIS account's parent-state position.
type causeReplay struct {
	// Proven is true IFF the replay ITSELF produced a false→true eligibility
	// transition at some pre-liquidation point: starting from parent state,
	// applying the decoded witness writes strictly in log-index order, the
	// account's boolean (debt > maxBorrowLT) crossed from ineligible to
	// eligible. Contact is not causation (Codex round 4, M): a Repaid lowers
	// debt and can never produce the flip; an LT-neutral or LT-raising config
	// write cannot either; an index update qualifies only when the decoded move
	// actually crosses the threshold. None of that is special-cased — the
	// arithmetic decides.
	//
	// Round 5 (H2): the crossing must also HOLD to the liquidation boundary.
	// A later true→false write clears Proven (and the cause), because a
	// reversed crossing cannot be what the liquidation executed against.
	Proven bool
	// Causes are the witnesses whose replayed write produced the flip, in log
	// order, for the artifact.
	Causes []string
	// Applied counts decoded witnesses that concern this account's boolean and
	// were applied to the replayed state (whether or not they flipped it).
	Applied int
	// Unrelated counts earlier logs that touch neither this account nor a token it
	// holds — the ones the round-1 classifier accepted as "a witness".
	Unrelated int
	// Notes records honesty caveats: undecodable payloads, refused replays,
	// writes the single-debt-token model cannot replay. A noted event never
	// contributes to Proven — the gate fails UNEXPLAINED rather than excuses.
	Notes []string
	// InitialEligible is the account's eligibility AT THE PARENT BOUNDARY as
	// the replay itself reconstructs it (Codex round 5, H1): the parent fold
	// at the reconstructed parent index against the parent frame's
	// maxBorrowLT. It is the production classifier's parent predicate — the
	// same value the replay starts from, by construction, never a second
	// computation.
	InitialEligible bool
	// ParentDebtUSD / ParentIndex are the reconstructed parent-boundary debt
	// (floor bridge) and index behind InitialEligible, for the artifact. Nil
	// when the replay refused its inputs.
	ParentDebtUSD *big.Int
	ParentIndex   *big.Int
	// BoundaryEligible is the replayed eligibility AFTER the last applied
	// pre-liquidation write — the state the liquidation actually executed
	// against (Codex round 5, H2). Proven implies BoundaryEligible by
	// construction: a true→false transition clears the earlier cause.
	BoundaryEligible bool
	// Reversals counts true→false transitions during the replay; each one
	// invalidates (clears) any earlier proven cause.
	Reversals int
}

// Complete reports whether the replay FULLY modelled every witness it did not
// classify as unrelated (Codex round 5, M): no refusals, no undecodable
// payloads, no cross-token or unmodellable writes, no clamps. The classifier
// CONSUMES this — any relevant refusal forces UNEXPLAINED regardless of
// Proven/execEligible. Notes stay as evidence, but the law lives here.
func (r causeReplay) Complete() bool { return len(r.Notes) == 0 }

// replaySameBlockCauses REPLAYS the ordered earlier witnesses from the parent
// state and decides whether one of them actually flipped this account's
// eligibility.
//
// THE LINEAGE OF DEFECTS THIS CLOSES:
//   - Round 2 (H2): the classifier accepted `execEligible && (priceMoved ||
//     witnesses > 0)` — both terms post-hoc — so any log or price delta
//     excused a false negative. Fixed by requiring a custodied
//     pre-liquidation write.
//   - Round 4 (M): "witness replay proves contact, not the eligibility
//     transition." A Repaid set Proven even though a repayment LOWERS debt
//     and cannot cause the flip; InterestIndexUpdated and
//     CollateralTokenConfigSet were accepted without decoding their values.
//     An honest block with a repayment (or a routine index tick, or an
//     LT-neutral config write) before the liquidation and a price update
//     after it therefore produced a false marginal-disclosed pass.
//
// THE LAW NOW: start from the PARENT-BLOCK state (the parent-boundary debt
// fold, the parent basket/prices/thresholds), apply each custodied witness's
// DECODED write strictly in log-index order, and recompute the gate's own
// boolean after each application with the SAME proven functions obligation 2
// uses (mulDivFloor + maxBorrowAtFrame). Proven is true IFF that replay
// itself crosses false→true at some pre-liquidation point. Post-liquidation
// state (including block-end prices) never participates: the witness set is
// bounded above by the liquidation's own log_index at collection time, and
// prices are not writable by any DM log. Directionality is a CONSEQUENCE of
// applying the write — nothing here special-cases an event class.
func replaySameBlockCauses(witnesses []snapshotdb.T6Witness, dmProxy common.Address,
	account, debtToken common.Address, start replayParentState) causeReplay {
	out := causeReplay{}
	acct := hexLower(account.Hex())
	debt := hexLower(debtToken.Hex())
	proxy := hexLower(dmProxy.Hex())

	// A replay without its parent state cannot apply anything, and what cannot
	// be applied cannot prove — refuse loudly rather than guess.
	if start.NormalizedAtParent == nil || start.IndexAtBlock == nil || start.IndexAtBlock.Sign() <= 0 {
		out.Notes = append(out.Notes, "replay refused: parent-state inputs incomplete (normalized fold or index); no witness can be proven a cause")
		return out
	}

	// STRICT LOG-INDEX ORDER. The collector already orders its rows; sorting
	// here makes the law structural rather than an upstream courtesy
	// (mutation spec m2b in p3_backtest_replay_test.go).
	ordered := make([]snapshotdb.T6Witness, len(witnesses))
	copy(ordered, witnesses)
	sort.SliceStable(ordered, func(i, j int) bool { return ordered[i].LogIndex < ordered[j].LogIndex })

	// Copy every piece of state a witness write may touch. Prices are NOT
	// copied because no DM log writes a price — see replayParentState.
	normalized := new(big.Int).Set(start.NormalizedAtParent)
	index := new(big.Int).Set(start.IndexAtBlock)
	collateral := make([]collateralLeg, len(start.Collateral))
	held := map[common.Address]bool{}
	for i, leg := range start.Collateral {
		collateral[i] = collateralLeg{token: leg.token, amount: new(big.Int).Set(leg.amount)}
		held[leg.token] = true
	}
	configs := make(map[common.Address]collateralTokenConfigResult, len(start.Configs))
	for k, cfg := range start.Configs {
		configs[k] = cfg
	}

	// THE PARENT-BOUNDARY INDEX. IndexAtBlock is the liquidation-time
	// snapshot. When the block carries an EARLIER InterestIndexUpdated for the
	// debt token, that event's own decoded oldIndex is the chain's statement
	// of the value carried INTO the block — the true parent value the replay
	// must start from, or an index-caused flip could never be attributed to
	// its event. Without one, the index did not move before the liquidation
	// and the snapshot IS the parent value.
	for _, w := range ordered {
		if !strings.EqualFold(w.Address, proxy) || w.Topic0 != topicDMInterestIndexUpdated || !strings.EqualFold(w.Topic1Addr, debt) {
			continue
		}
		if oldIdx, _, err := decodeWitnessIndexUpdate(w); err == nil && oldIdx.Sign() > 0 {
			index.Set(oldIdx)
		}
		break
	}

	// The gate's own eligibility law over the REPLAYED state: the §3.3 debt
	// bridge (mulDivFloor) against the deployed maxBorrowLT loop shape
	// (maxBorrowAtFrame) — the same proven functions obligation 2 uses, never
	// re-derived arithmetic.
	eligibleNow := func() bool {
		maxBorrow, _ := maxBorrowAtFrame(collateral, start.Prices, configs, start.Decimals)
		return mulDivFloor(normalized, index).Cmp(maxBorrow) > 0
	}
	prev := eligibleNow()
	// ONE SOURCE OF PARENT TRUTH (Codex round 5, H1): the replay's own
	// reconstruction of the parent boundary — the parent fold at the
	// event-sourced parent index — is exposed as the production classifier's
	// parent predicate. One function returns both the starting state and the
	// initial eligibility, so the predicate and the replay can never diverge:
	// the event-time fold (ourBefore) already contains the block's earlier
	// writes and the liquidation-time index, which is exactly how an
	// index-caused crossing masqueraded as true-at-parent.
	out.InitialEligible = prev
	out.ParentDebtUSD = mulDivFloor(normalized, index)
	out.ParentIndex = new(big.Int).Set(index)
	applied := func(w snapshotdb.T6Witness, what string) {
		out.Applied++
		cur := eligibleNow()
		if !prev && cur {
			// THE ONLY WAY TO PROVE (Codex round 4, M): the replay itself
			// crossed from ineligible to eligible at this pre-liquidation
			// write. Directionality is a consequence — a repayment or an
			// LT-raising write simply never lands here.
			out.Proven = true
			out.Causes = append(out.Causes, fmt.Sprintf("log_index %d %s — the replayed parent state crosses from ineligible to ELIGIBLE at this write", w.LogIndex, what))
		}
		if prev && !cur {
			// ELIGIBILITY MUST HOLD TO THE BOUNDARY (Codex round 5, H2): a
			// true→false transition INVALIDATES any earlier crossing. Proven
			// used to latch, so an index-then-repaid block retained its stale
			// log-2 cause while the actual liquidation-time crossing was an
			// unproven price move. The cause is cleared, never carried; a
			// later genuine re-crossing records a fresh one.
			out.Proven = false
			out.Causes = nil
			out.Reversals++
		}
		prev = cur
	}
	note := func(w snapshotdb.T6Witness, format string, a ...any) {
		out.Notes = append(out.Notes, fmt.Sprintf("log_index %d: %s", w.LogIndex, fmt.Sprintf(format, a...)))
	}
	clampDebt := func(w snapshotdb.T6Witness) {
		if normalized.Sign() < 0 {
			note(w, "replayed normalized debt went below zero (decoded write exceeds the folded parent debt); clamped to 0")
			normalized.SetInt64(0)
		}
	}

	for _, w := range ordered {
		if !strings.EqualFold(w.Address, proxy) {
			// A log from an address outside the walked DM surface is not a
			// custodied witness for this account's state at all — including a
			// price push: PriceProviderV2 is outside the walker stream set,
			// which is exactly why a price difference can never be a proven
			// cause here.
			out.Unrelated++
			continue
		}
		switch w.Topic0 {
		case topicDMLiquidated:
			// Liquidated(liquidator, user, borrowToken, ...): an EARLIER
			// seizure for the same account. Its decoded payload moves BOTH
			// sides of the boolean: each seized element leaves the basket
			// (element amounts INCLUDE the liquidation bonus —
			// DebtManagerCore.sol:613-658, cross-checked by the captured
			// fixture: 15,845,260 repaid + 158,452 bonus = 16,003,712 seized)
			// and the repaid USD leaves the debt. The bonus premium is what
			// lets an earlier pass flip the next one.
			if !strings.EqualFold(w.Topic2Addr, acct) {
				out.Unrelated++
				continue
			}
			seized, liqUSD, err := decodeWitnessLiquidated(w)
			if err != nil {
				note(w, "Liquidated for THIS account did not decode (%v) — cannot be applied, so it can prove nothing", err)
				continue
			}
			// ALL-OR-NOTHING (Codex round 5, M): a liquidation the model
			// cannot FULLY replay applies NOTHING. Removing the seized
			// collateral while refusing an unmodellable debt leg is how a
			// partial replay manufactured a crossing — debt held flat against
			// a shrunken basket. The refusal is noted (tainting Complete) and
			// the replayed state is untouched.
			if !strings.EqualFold(w.Topic3Addr, debt) {
				note(w, "earlier seizure repays a DIFFERENT borrow token (0x%s); the single-debt-token model cannot replay its debt leg, so NOTHING of this liquidation is applied — a partially replayed basket removal would manufacture a crossing", w.Topic3Addr)
				continue
			}
			unmatched := ""
			for _, s := range seized {
				if s.Amount.Sign() == 0 {
					continue
				}
				inBasket := false
				for i := range collateral {
					if collateral[i].token == s.Token {
						inBasket = true
						break
					}
				}
				if !inBasket {
					unmatched = s.Token.Hex()
					break
				}
			}
			if unmatched != "" {
				note(w, "seized token %s is not in the parent basket — the basket model disagrees with the chain, so NOTHING of this liquidation is applied", unmatched)
				continue
			}
			normalized.Sub(normalized, usdToNormalizedFloor(liqUSD, index))
			clampDebt(w)
			for _, s := range seized {
				if s.Amount.Sign() == 0 {
					continue
				}
				for i := range collateral {
					if collateral[i].token == s.Token {
						collateral[i].amount.Sub(collateral[i].amount, s.Amount)
						if collateral[i].amount.Sign() < 0 {
							collateral[i].amount.SetInt64(0)
						}
						break
					}
				}
			}
			applied(w, fmt.Sprintf("Liquidated for THIS account (earlier pass: %s USD of debt repaid, %d elements seized, bonus included in the amounts)", liqUSD, len(seized)))
		case topicDMBorrowed:
			// Borrowed(user indexed, token indexed, amount): the DEBTOR is
			// topic1 and topic2 is the TOKEN; amount is token-native.
			if !strings.EqualFold(w.Topic1Addr, acct) {
				out.Unrelated++
				continue
			}
			if !strings.EqualFold(w.Topic2Addr, debt) {
				// A borrow of a DIFFERENT token raises the TOTAL the deployed
				// `liquidatable` sums, but this frame's debt model tracks only
				// the case's debt token — the flip cannot be REPLAYED, so it
				// cannot be proven. The case stays UNEXPLAINED with the reason
				// disclosed; excusing it on contact was the round-4 hole.
				note(w, "Borrowed a DIFFERENT token (0x%s) by this account: raises its total borrowings but is not replayable under the single-debt-token model — never a proven cause", w.Topic2Addr)
				continue
			}
			amount, err := decodeWitnessAmount("Borrowed", w)
			if err != nil {
				note(w, "Borrowed by THIS account did not decode (%v) — cannot be applied, so it can prove nothing", err)
				continue
			}
			usd, err := borrowTokenUSD(amount, debtToken, start.Decimals)
			if err != nil {
				note(w, "Borrowed by THIS account cannot be valued: %v", err)
				continue
			}
			// The deployed borrow normalization CEILS (DebtManagerCore.sol:472;
			// mirrored by the deriver's mulDivCeil in internal/derive).
			normalized.Add(normalized, usdToNormalizedCeil(usd, index))
			applied(w, fmt.Sprintf("Borrowed %s of the debt token by THIS account (%s USD at the replayed index)", amount, usd))
		case topicDMRepaid:
			// Repaid(user indexed, payer indexed, token indexed, amount): the
			// INDEBTED party is topic1; a payer-only match is unrelated contact
			// (round 3, M — _repayWithBorrowToken never touches the payer).
			if !strings.EqualFold(w.Topic1Addr, acct) {
				out.Unrelated++
				continue
			}
			if !strings.EqualFold(w.Topic3Addr, debt) {
				note(w, "Repaid a DIFFERENT borrow token (0x%s) for this account: lowers a leg the model does not track — no replayable effect", w.Topic3Addr)
				continue
			}
			usd, err := decodeWitnessAmount("Repaid", w)
			if err != nil {
				note(w, "Repaid FOR THIS account did not decode (%v) — cannot be applied, so it can prove nothing", err)
				continue
			}
			// Repaid.amount is ALREADY USD-6 (recon "Debt Manager event
			// semantics"); the deployed repay normalization FLOORS
			// (DebtManagerCore.sol:599; the deriver's mulDivFloor).
			normalized.Sub(normalized, usdToNormalizedFloor(usd, index))
			clampDebt(w)
			applied(w, fmt.Sprintf("Repaid %s USD FOR THIS account (payer 0x%s) — debt falls; a repayment can never produce the flip", usd, w.Topic2Addr))
		case topicDMInterestIndexUpdated:
			if !strings.EqualFold(w.Topic1Addr, debt) {
				out.Unrelated++
				continue
			}
			_, newIdx, err := decodeWitnessIndexUpdate(w)
			if err != nil {
				note(w, "InterestIndexUpdated for the debt token did not decode (%v) — cannot be applied, so it can prove nothing", err)
				continue
			}
			index.Set(newIdx)
			applied(w, fmt.Sprintf("InterestIndexUpdated for the debt token (index → %s)", newIdx))
		case topicDMCollateralConfigSet:
			tok := common.HexToAddress(w.Topic1Addr)
			if !held[tok] {
				out.Unrelated++
				continue
			}
			newCfg, err := decodeWitnessCollateralConfig(w)
			if err != nil {
				note(w, "CollateralTokenConfigSet for a HELD token did not decode (%v) — cannot be applied, so it can prove nothing", err)
				continue
			}
			configs[tok] = newCfg
			applied(w, fmt.Sprintf("CollateralTokenConfigSet for HELD token 0x%s (liquidationThreshold → %s)", w.Topic1Addr, newCfg.LiquidationThreshold))
		default:
			out.Unrelated++
		}
	}
	// H2's boundary state: the eligibility the liquidation actually executed
	// against, after the LAST applied pre-liquidation write.
	out.BoundaryEligible = prev
	return out
}

// --- witness payload decoding (Codex round 4, M) ----------------------------
//
// Every decoder below goes through dmWitnessABI — the object
// p3_witness_abi_test.go pins field-by-field against the COMMITTED forge
// artifact (internal/decode/abis/DebtManagerCore.json) and whose topic0s are
// pinned against the CAPTURED chain logs (internal/decode/testdata). No word
// offset here is hand-transcribed.

// dmWitnessNonIndexed hex-decodes a witness's data payload and unpacks the
// event's non-indexed inputs.
func dmWitnessNonIndexed(event string, w snapshotdb.T6Witness) ([]interface{}, error) {
	raw := strings.TrimPrefix(strings.TrimSpace(w.Data), "0x")
	if raw == "" {
		return nil, fmt.Errorf("no data payload captured")
	}
	data, err := hex.DecodeString(raw)
	if err != nil {
		return nil, fmt.Errorf("data payload is not hex: %w", err)
	}
	args := dmWitnessABI.Events[event].Inputs.NonIndexed()
	vals, err := args.Unpack(data)
	if err != nil {
		return nil, fmt.Errorf("unpack %s: %w", event, err)
	}
	if len(vals) != len(args) {
		return nil, fmt.Errorf("unpack %s: got %d values, want %d", event, len(vals), len(args))
	}
	return vals, nil
}

// decodeWitnessIndexUpdate decodes InterestIndexUpdated's (oldIndex, newIndex).
func decodeWitnessIndexUpdate(w snapshotdb.T6Witness) (oldIndex, newIndex *big.Int, err error) {
	vals, err := dmWitnessNonIndexed("InterestIndexUpdated", w)
	if err != nil {
		return nil, nil, err
	}
	oldIndex, ok1 := vals[0].(*big.Int)
	newIndex, ok2 := vals[1].(*big.Int)
	if !ok1 || !ok2 || oldIndex == nil || newIndex == nil {
		return nil, nil, fmt.Errorf("InterestIndexUpdated payload is not two uint256 words")
	}
	if newIndex.Sign() <= 0 {
		return nil, nil, fmt.Errorf("InterestIndexUpdated carries non-positive newIndex %s", newIndex)
	}
	return new(big.Int).Set(oldIndex), new(big.Int).Set(newIndex), nil
}

// decodeWitnessAmount decodes the single-uint256 payload of Borrowed/Repaid.
func decodeWitnessAmount(event string, w snapshotdb.T6Witness) (*big.Int, error) {
	vals, err := dmWitnessNonIndexed(event, w)
	if err != nil {
		return nil, err
	}
	v, ok := vals[0].(*big.Int)
	if !ok || v == nil {
		return nil, fmt.Errorf("%s payload is not a uint256 amount", event)
	}
	return new(big.Int).Set(v), nil
}

// decodeWitnessCollateralConfig decodes CollateralTokenConfigSet's NEW config
// tuple (ltv, liquidationThreshold, liquidationBonus — 1e18-scaled
// percentages, go-ethereum widens uint80/uint96 to *big.Int).
func decodeWitnessCollateralConfig(w snapshotdb.T6Witness) (cfg collateralTokenConfigResult, err error) {
	defer func() {
		if rec := recover(); rec != nil {
			cfg, err = collateralTokenConfigResult{}, fmt.Errorf("decode CollateralTokenConfigSet: recovered panic: %v", rec)
		}
	}()
	vals, err := dmWitnessNonIndexed("CollateralTokenConfigSet", w)
	if err != nil {
		return collateralTokenConfigResult{}, err
	}
	el := reflect.ValueOf(vals[1]) // vals[0] is oldConfig; the WRITE is newConfig
	if el.Kind() != reflect.Struct || el.NumField() != 3 {
		return collateralTokenConfigResult{}, fmt.Errorf("newConfig is %T, not the 3-field tuple", vals[1])
	}
	cfg.LTV, _ = el.Field(0).Interface().(*big.Int)
	cfg.LiquidationThreshold, _ = el.Field(1).Interface().(*big.Int)
	cfg.LiquidationBonus, _ = el.Field(2).Interface().(*big.Int)
	if cfg.LiquidationThreshold == nil {
		return collateralTokenConfigResult{}, fmt.Errorf("newConfig carries no liquidationThreshold")
	}
	return cfg, nil
}

// decodeWitnessLiquidated decodes Liquidated's payload: the seized elements
// (token, amount — amount INCLUDES the liquidation bonus) and the USD of debt
// repaid (debtAmountLiquidated).
func decodeWitnessLiquidated(w snapshotdb.T6Witness) (seized []tokenAmount, debtLiquidatedUSD *big.Int, err error) {
	defer func() {
		if rec := recover(); rec != nil {
			seized, debtLiquidatedUSD, err = nil, nil, fmt.Errorf("decode Liquidated: recovered panic: %v", rec)
		}
	}()
	vals, err := dmWitnessNonIndexed("Liquidated", w)
	if err != nil {
		return nil, nil, err
	}
	list := reflect.ValueOf(vals[0])
	if list.Kind() != reflect.Slice {
		return nil, nil, fmt.Errorf("userCollateralLiquidated is %T, not a slice", vals[0])
	}
	for i := 0; i < list.Len(); i++ {
		el := list.Index(i)
		tok, ok := el.Field(0).Interface().(common.Address)
		if !ok {
			return nil, nil, fmt.Errorf("seizure element %d token is not an address", i)
		}
		amt, ok := el.Field(1).Interface().(*big.Int)
		if !ok || amt == nil {
			return nil, nil, fmt.Errorf("seizure element %d carries no amount", i)
		}
		seized = append(seized, tokenAmount{Token: tok, Amount: new(big.Int).Set(amt)})
	}
	liq, ok := vals[2].(*big.Int)
	if !ok || liq == nil {
		return nil, nil, fmt.Errorf("debtAmountLiquidated is %T, not *big.Int", vals[2])
	}
	return seized, new(big.Int).Set(liq), nil
}

// --- the deployed USD↔normalized laws the replay applies --------------------

// usdToNormalizedFloor mirrors the deployed repay/liquidation normalization:
// floor(usd × 1e18 / index) (DebtManagerCore.sol:599 repay, :579-580
// liquidation; the deriver's mulDivFloor in internal/derive/debtmanager.go).
func usdToNormalizedFloor(usd, index *big.Int) *big.Int {
	out := new(big.Int).Mul(usd, wad)
	return out.Quo(out, index)
}

// usdToNormalizedCeil mirrors the deployed borrow normalization:
// ceil(usd × 1e18 / index), exact divisions not bumped
// (DebtManagerCore.sol:472; the deriver's mulDivCeil).
func usdToNormalizedCeil(usd, index *big.Int) *big.Int {
	q, r := new(big.Int).QuoRem(new(big.Int).Mul(usd, wad), index, new(big.Int))
	if r.Sign() != 0 {
		q.Add(q, big.NewInt(1))
	}
	return q
}

// borrowTokenUSD values a Borrowed token-native amount in USD-6 under the
// deployed stable-snap pricing: a 6-dec stable's amount IS the USD-6 figure;
// an 18-dec stable floors away 1e12 (usd = amount×price/10^decimals with the
// contract's own flooring division, DebtManagerCore.sol:378; mirrored by the
// deriver's borrowUsd). An unknown-decimals token cannot be valued — the
// caller records the refusal and the event proves nothing.
func borrowTokenUSD(amount *big.Int, token common.Address, decimals map[common.Address]uint8) (*big.Int, error) {
	dec, ok := decimals[token]
	if !ok {
		return nil, fmt.Errorf("no pinned decimals for borrow token %s", token.Hex())
	}
	switch dec {
	case 6:
		return new(big.Int).Set(amount), nil
	case 18:
		return new(big.Int).Quo(amount, new(big.Int).Exp(big.NewInt(10), big.NewInt(12), nil)), nil
	default:
		return nil, fmt.Errorf("borrow token %s has unhandled decimals %d", token.Hex(), dec)
	}
}

// The three-state intra-block outcomes (chain-truth R1), plus the unpriced
// refusal. Named constants so the CLASSIFIER is a pure, unit-testable decision:
// the round-1 defect was that this decision never checked causation, and a
// decision buried in an inline switch can only be tested through a chain.
const (
	eligTrueAtParent       = "true-at-parent"
	eligUnpriced           = "unpriced-leg"
	eligFlippedWithWitness = "flipped-with-custodied-witness"
	eligUnexplainedOutcome = "unexplained"
)

// classifyIntraBlock decides one case's eligibility state.
//
// THE DEFECT THIS REPLACES (Codex round 1, finding 7): the old switch labelled a
// case flipped-in-block-with-custodied-witness whenever ANY earlier same-block
// log existed or ANY price differed between frames. It never recomputed the
// boolean, so an unrelated log in a busy block excused a genuine false negative —
// and on this population a busy block is the norm. CAUSATION is now required:
// execEligible must actually be true, i.e. the SAME deployed loop must produce
// eligibility at execution-frame prices. A witness that does not flip the boolean
// explains nothing.
//
// ROUND 5 (H1, M): parentEligible is the REPLAY's own parent-boundary
// reconstruction (causeReplay.InitialEligible), never a second computation from
// the event-time fold; replayComplete is causeReplay.Complete(), and an
// incomplete replay resolves UNEXPLAINED before anything else is consulted.
func classifyIntraBlock(parentEligible, execEligible, allPriced, causeProven, replayComplete bool) string {
	switch {
	case !replayComplete:
		// THE STRUCTURAL COMPLETENESS LAW (Codex round 5, M): a replay that
		// could not fully model the block's custodied writes proves nothing
		// and certifies nothing — an unreplayable or refused write resolves
		// UNEXPLAINED regardless of every other input, including a proven
		// cause (the unmodelled write moves the real account's boolean too)
		// and including the parent predicate (whose reconstruction rests on
		// the same replay). Notes remain the evidence; this arm is the law
		// they previously only narrated.
		return eligUnexplainedOutcome
	case parentEligible:
		return eligTrueAtParent
	case !allPriced:
		return eligUnpriced
	case causeProven && execEligible:
		// A custodied PRE-liquidation write moved an input to this account's boolean,
		// AND the recomputation corroborates the flip. Both are required: the cause is
		// the proof, the recomputation is only corroboration (it reads post-block
		// state), and neither alone earns a marginal pass. Proven itself now embeds
		// round-5 H2: the crossing must have HELD to the liquidation boundary — a
		// reversed crossing was cleared inside the replay.
		return eligFlippedWithWitness
	default:
		// Includes the round-1 false-marginal shape: a post-block price difference or
		// an unrelated same-block log with NO proven cause. That is UNEXPLAINED.
		return eligUnexplainedOutcome
	}
}
