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
	"fmt"
	"math/big"
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
		derived("position_events(event_type=liquidation).payload.before_debt_usd of the NEXT pass (same tx, account, debt token)",
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

func (v *backtestView) priorPassLogIndex() *uint32 { return v.row.PriorPassLogIndex }

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
	parent, err := readBacktestFrameState(ctx, c, f, account, debtToken, db, decimals, fc.Block-1, parentHash, true)
	if err != nil {
		return rows, res, err
	}
	if parent.unread != "" {
		rows = append(rows, unreadRow(gateBacktest, key, "parent-frame state", parent.unread))
		res.SkipClass = "parent-frame-unread"
		return rows, res, nil
	}
	// ---- execution-frame reads --------------------------------------------
	// The exec frame needs prices for the PARENT's collateral tokens too, not just
	// the seized ones: obligation 2's intra-block recomputation values the parent's
	// whole collateral basket at execution-frame prices, and a token whose price is
	// unread there cannot be silently held flat.
	f.use("ERC20.decimals(token)@pinHash(P_op)") // the 10^dec denominator every conversion below divides by
	execWant := make([]common.Address, 0, len(parent.collateral))
	for _, leg := range parent.collateral {
		execWant = append(execWant, leg.token)
	}
	exec, err := readBacktestFrameState(ctx, c, f, account, debtToken, db, decimals, fc.Block, pinHash, false, execWant...)
	if err != nil {
		return rows, res, err
	}

	// ---- OBLIGATION 2: our eligibility boolean, three-state law -----------
	// maxBorrowLT is computed by the SAME deployed loop shape in both frames —
	// per-token floor, then sum (DebtManagerCore.sol:139-165) — so the ONLY
	// difference between them is the engine-exact price. That is what makes the
	// intra-block recomputation a causation test rather than a label.
	ourMaxBorrow, parentPriced := maxBorrowAtFrame(parent.collateral, parent.prices, parent.configs, decimals)
	ourDebt := ourBefore
	ourEligible := ourDebt.Cmp(ourMaxBorrow) > 0
	margin := new(big.Int).Sub(ourDebt, ourMaxBorrow)
	margin.Abs(margin)
	res.MarginUSD6 = margin.String()

	priceMoved, moveNote := priceFrameDelta(parent, exec)
	res.PriceDeltaNote = moveNote
	witnesses := v.sameBlockEarlier()

	// THE CAUSATION TEST (round-1 finding 7). The old code labelled a case
	// "flipped-with-witness" whenever ANY earlier log existed or ANY price
	// differed — it never checked that the witness actually flipped the boolean,
	// so an unrelated log in a busy block excused a genuine false negative. Now
	// the boolean is RECOMPUTED in the execution frame, and the flip must be
	// REPRODUCED: eligible-at-exec is required, not inferred.
	execMaxBorrow, execPriced := maxBorrowAtFrame(parent.collateral, exec.prices, parent.configs, decimals)
	execEligible := ourDebt.Cmp(execMaxBorrow) > 0
	allPriced := parentPriced && execPriced

	oblRow := p3Row{
		Gate: gateBacktest, Subject: key, Leg: "obligation2: OUR eligibility at N-1",
		Expected: "true (the contract executed the liquidation, so it was eligible in the execution frame)",
		Actual:   fmt.Sprintf("%v (debt %s vs maxBorrowLT %s)", ourEligible, ourDebt, ourMaxBorrow),
		Gated:    true,
		Evidence: map[string]string{
			"margin_usd6":                  margin.String(),
			"our_max_borrow_lt_at_parent":  ourMaxBorrow.String(),
			"our_max_borrow_lt_at_exec":    execMaxBorrow.String(),
			"our_debt_usd6":                ourDebt.String(),
			"recomputed_eligible_at_exec":  fmt.Sprintf("%v", execEligible),
			"price_frame_delta":            moveNote,
			"every_leg_priced_both_frames": fmt.Sprintf("%v", allPriced),
			"same_block_earlier_logs":      fmt.Sprintf("%d", len(witnesses)),
			"same_block_witness_detail":    strings.Join(witnesses, "; "),
		},
	}
	switch classifyIntraBlock(ourEligible, execEligible, allPriced, priceMoved, len(witnesses)) {
	case eligTrueAtParent:
		res.EligibilityState = "true-at-parent"
		oblRow.Verdict = verdictExact
		oblRow.Note = "TRUE-AT-PARENT: exact pass. Our boolean, over our replayed debt and the parent frame's pinned collateral/prices/thresholds, agrees with the chain's decision"
	case eligUnpriced:
		// A leg we could not price in BOTH frames makes the recomputation
		// impossible, and "cannot verify" is never advisory (round-11 F2).
		res.EligibilityState = "unpriced-leg"
		oblRow.Verdict = verdictWeldUnread
		oblRow.Class = "intra-block-recompute-unpriced"
		oblRow.Note = "false at the parent frame, and at least one collateral leg could not be priced in BOTH frames — so the intra-block flip can be neither reproduced nor refuted. Gated as unread rather than excused: an unpriceable leg is exactly how a false negative would hide behind a 'witness'"
	case eligFlippedWithWitness:
		res.EligibilityState = "flipped-in-block-with-custodied-witness"
		oblRow.Verdict = verdictMarginal
		oblRow.Class = verdictMarginal
		oblRow.Note = fmt.Sprintf("FLIPPED-IN-BLOCK, CAUSATION PROVEN: false at the parent frame (maxBorrowLT %s) and TRUE when the SAME deployed loop is recomputed at execution-frame prices (maxBorrowLT %s). The flip is REPRODUCED, not inferred from the presence of a log — this is the intra-block mechanism the Debt Manager's push-price design allows. Disclosed as marginal with the margin printed, never absorbed",
			ourMaxBorrow, execMaxBorrow)
		f.cite(tolIntraBlockMarginality)
	default:
		res.EligibilityState = verdictUnexplained
		oblRow.Verdict = verdictUnexplained
		oblRow.Class = verdictUnexplained
		oblRow.Note = fmt.Sprintf("UNEXPLAINED: false at the parent frame AND still false when recomputed at execution-frame prices (maxBorrowLT %s -> %s). Earlier same-block logs present: %d; price moved: %v. The gated third state of chain-truth R1's law — a false negative in the alert product that the block's own custodied witnesses do NOT explain",
			ourMaxBorrow, execMaxBorrow, len(witnesses), priceMoved)
	}
	rows = append(rows, oblRow)

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
func priceFrameDelta(parent, exec *frameState) (bool, string) {
	moved := false
	var notes []string
	for _, tok := range sortedAddrs(addrSetFromPrices(parent.prices)) {
		p, e := parent.prices[tok], exec.prices[tok]
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
func reconstructSeizures(key string, v *backtestView, parent *frameState,
	decimals map[common.Address]uint8, f *gateFrame) []p3Row {
	var rows []p3Row
	seizures := v.seizures()
	liquidated := v.liquidatedUSD()

	type prepared struct {
		s     snapshotdb.T6Seizure
		tok   common.Address
		cfg   collateralTokenConfigResult
		bal   *big.Int
		price *big.Int
		dec   uint8
	}
	var elems []prepared
	for _, s := range seizures {
		tok := common.HexToAddress(s.AssetHex)
		subject := fmt.Sprintf("%s element %d %s", key, s.Seq, tok.Hex())
		cfg, okCfg := parent.configs[tok]
		bal, okBal := parent.balances[tok]
		price := parent.prices[tok]
		dec, okDec := decimals[tok]
		if !okCfg || !okBal || price == nil || !okDec || cfg.LiquidationBonus == nil {
			rows = append(rows, unreadRow(gateBacktest, subject, "obligation3: seizure inputs",
				"one or more of {collateralTokenConfig, balanceOf, engine-exact price, decimals} did not read at the parent frame"))
			continue
		}
		elems = append(elems, prepared{s: s, tok: tok, cfg: cfg, bal: bal, price: price, dec: dec})
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

	partialOf := func(e prepared) (amount, bonus, credited *big.Int) {
		net := new(big.Int).Mul(e.bal, hundredPercentDM)
		net.Quo(net, new(big.Int).Add(hundredPercentDM, e.cfg.LiquidationBonus))
		bonus = new(big.Int).Sub(e.bal, net)
		amount = new(big.Int).Set(e.bal)
		credited = new(big.Int).Sub(amount, bonus)
		credited.Mul(credited, e.price)
		credited.Quo(credited, pow10Big(e.dec))
		return amount, bonus, credited
	}
	finalOf := func(e prepared, u *big.Int) (amount, bonus, cAFD *big.Int) {
		cAFD = new(big.Int).Mul(u, pow10Big(e.dec))
		cAFD.Quo(cAFD, e.price)
		bonus = new(big.Int).Mul(cAFD, e.cfg.LiquidationBonus)
		bonus.Quo(bonus, hundredPercentDM)
		amount = new(big.Int).Add(cAFD, bonus)
		return amount, bonus, cAFD
	}
	// The branch predicate, on the contract's own terms.
	takesPartial := func(e prepared, u *big.Int) bool {
		_, _, cAFD := finalOf(e, u)
		net := new(big.Int).Mul(e.bal, hundredPercentDM)
		net.Quo(net, new(big.Int).Add(hundredPercentDM, e.cfg.LiquidationBonus))
		maxBonus := new(big.Int).Sub(e.bal, net)
		return new(big.Int).Sub(e.bal, maxBonus).Cmp(cAFD) < 0
	}

	last := elems[len(elems)-1]
	lastIsPartial := last.s.Amount.Cmp(last.bal) == 0
	// liquidatedAmt == 0 means the contract covered NOTHING, which it can only do
	// by exhausting the preference array on partial branches (every named token had
	// totalCollateral == 0). Routing that shape through the FINAL walk would make it
	// vacuous: with a zero budget the final branch reproduces a zero element for ANY
	// Safe balance, and the "the Safe really held none" content — the whole
	// falsifiable claim on this population's dominant shape — would be lost.
	if liquidated.Sign() == 0 {
		lastIsPartial = true
	}

	if lastIsPartial {
		// ALL-PARTIAL shape: one exact equation over every element ties the whole
		// fan-out to liquidatedAmt.
		sum := new(big.Int)
		for _, e := range elems {
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
				continue
			}
			wantAmount, wantBonus, _ := partialOf(e)
			rows = append(rows, compareExact(gateBacktest, subject, "obligation3: partial branch amount == totalCollateral",
				wantAmount, e.s.Amount, "seizure-partial-amount"))
			rows = append(rows, compareExact(gateBacktest, subject, "obligation3: partial branch bonus == totalCollateral - floor(totalCollateral*HP/(HP+b))",
				wantBonus, e.s.Bonus, "seizure-partial-bonus"))
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
		return rows
	}

	// FINAL-TERMINATED shape: remainingDebt == 0, so u0 == liquidatedAmt exactly.
	u := new(big.Int).Set(liquidated)
	for i, e := range elems {
		subject := fmt.Sprintf("%s element %d %s", key, e.s.Seq, e.tok.Hex())
		isLast := i == len(elems)-1
		wantPartial := takesPartial(e, u)
		observedPartial := e.s.Amount.Cmp(e.bal) == 0

		predicateRow := p3Row{
			Gate: gateBacktest, Subject: subject, Leg: "obligation3: branch predicate at the carried repay budget",
			Expected: branchName(wantPartial), Actual: branchName(observedPartial), Gated: true,
			Evidence: map[string]string{
				"carried_repay_usd": u.String(),
				"total_collateral":  e.bal.String(),
				"engine_price":      e.price.String(),
				"law":               "totalCollateral - maxBonus < collateralAmountForDebt selects PARTIAL (DebtManagerCore.sol:625-638)",
			},
		}
		if wantPartial == observedPartial {
			predicateRow.Verdict = verdictExact
		} else {
			predicateRow.Verdict = verdictDrift
			predicateRow.Class = "seizure-branch-predicate"
			predicateRow.Note = "the branch the deployed predicate selects at the CARRIED repay budget is not the branch this element shows. Because the budget is anchored to liquidatedAmt, this catches the proportionally-wrong pair the old inverted-cAFD check could not"
		}
		rows = append(rows, predicateRow)

		if wantPartial {
			wantAmount, wantBonus, credited := partialOf(e)
			rows = append(rows, compareExact(gateBacktest, subject, "obligation3: partial branch amount == totalCollateral",
				wantAmount, e.s.Amount, "seizure-partial-amount"))
			rows = append(rows, compareExact(gateBacktest, subject, "obligation3: partial branch bonus == totalCollateral - floor(totalCollateral*HP/(HP+b))",
				wantBonus, e.s.Bonus, "seizure-partial-bonus"))
			u = new(big.Int).Sub(u, credited)
			if u.Sign() < 0 {
				u = new(big.Int)
			}
			continue
		}

		// FINAL branch, derived from the CARRIED budget, never from the observed
		// amount. This is what makes a proportionally-wrong pair fail.
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
		rows = append(rows, amountRow)
		rows = append(rows, compareExact(gateBacktest, subject, "obligation3: final branch bonus == floor(cAFD*b/HP)",
			wantBonus, e.s.Bonus, "seizure-final-bonus"))

		if !isLast {
			rows = append(rows, driftRow(gateBacktest, subject, "obligation3: final branch terminates the fan-out",
				fmt.Sprintf("the FINAL branch is element %d of %d", i+1, len(elems)),
				"more elements follow", "seizure-final-not-last",
				"the deployed loop assembly-trims the array and BREAKS on the final branch (DebtManagerCore.sol:645-652), so an element after it cannot exist"))
		}
		u = new(big.Int)
		break
	}
	// A FINAL-terminated fan-out spends the budget exactly.
	spent := compareExact(gateBacktest, key, "obligation3: carried repay budget fully spent",
		new(big.Int), u, "seizure-budget-residual")
	spent.Evidence = map[string]string{
		"shape": "FINAL-TERMINATED (remainingDebt == 0, so u0 == liquidatedAmt exactly)",
		"u0":    liquidated.String(),
		"law":   "liquidatedAmt = debtAmountToLiquidateInUsd - remainingDebt (DebtManagerCore.sol:576-578)",
	}
	rows = append(rows, spent)
	return rows
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
func residueWeld(key string, v *backtestView, exec *frameState, f *gateFrame) []p3Row {
	db := v.row
	ourAfter := mulDivFloor(v.normalizedAfter(), v.indexAtBlock())
	residueModelled, residueText := v.residue()

	// FIRST PASS of a two-pass tx: the expected value is the NEXT pass's own
	// beforeDebtAmount, which is the chain's statement of the state between them.
	if db.NextPassLogIndex != nil {
		if db.NextPassBeforeDebtUSD == nil {
			return []p3Row{unreadRow(gateBacktest, key, "obligation4: residue weld (first pass)",
				fmt.Sprintf("a following Liquidated exists at log_index %d but its beforeDebtAmount did not decode, so the between-passes state has no expected value", *db.NextPassLogIndex))}
		}
		row := compareExact(gateBacktest, key, "obligation4: after-state == the NEXT pass's beforeDebtAmount",
			db.NextPassBeforeDebtUSD, ourAfter, "residue-first-pass-chain")
		row.Evidence = map[string]string{
			"normalized_after":      db.NormalizedAfter.String(),
			"next_pass_log_index":   fmt.Sprintf("%d", *db.NextPassLogIndex),
			"next_pass_before_debt": db.NextPassBeforeText,
			"frame":                 "FIRST PASS: block-end borrowingOf is NOT the expected value here, because the second pass moves the debt again before the block closes",
		}
		if row.Verdict == verdictExact {
			row.Note = "EXACT: our replayed after-state equals the chain's own statement of the between-passes state. This is the 50%-then-remainder path welded at its hinge - the hardest accounting in the frame"
		}
		return []p3Row{row}
	}

	// FINAL (or only) pass: block-end borrowingOf is the honest expected value.
	if exec.chainDebt == nil {
		return []p3Row{unreadRow(gateBacktest, key, "obligation4: residue weld",
			"borrowingOf(user, borrowToken) did not read at the liquidation block")}
	}
	// "Fully liquidated" is judged on the CHAIN side, deliberately: the whole
	// mechanism the tolerance cites is that the contract set a remaining
	// normalized amount of 1 to ZERO without emitting anything, so the chain
	// reads closed while our fold still carries the wei. Judging it on OUR side
	// would make the tolerance unreachable exactly in the case it exists for.
	fullyLiquidated := exec.chainDebt.Sign() == 0
	row := p3Row{
		Gate: gateBacktest, Subject: key, Leg: "obligation4: residue weld",
		Expected: exec.chainDebt.String(), Actual: ourAfter.String(), Gated: true,
		Evidence: map[string]string{
			"normalized_after": db.NormalizedAfter.String(),
			"residue_modelled": fmt.Sprintf("%v", residueModelled),
			"residue_amount":   residueText,
			"fully_liquidated": fmt.Sprintf("%v", fullyLiquidated),
			"frame":            "FINAL (or only) pass: block-end borrowingOf IS the honest expected value",
		},
	}
	diff := new(big.Int).Sub(ourAfter, exec.chainDebt)
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
func classifyIntraBlock(ourEligible, execEligible, allPriced, priceMoved bool, witnesses int) string {
	switch {
	case ourEligible:
		return eligTrueAtParent
	case !allPriced:
		return eligUnpriced
	case execEligible && (priceMoved || witnesses > 0):
		return eligFlippedWithWitness
	default:
		return eligUnexplainedOutcome
	}
}
