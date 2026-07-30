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
		derived("position_events(engine=debt_manager, side=debt).delta folded to (block, log_index, seq) < the case's own key",
			"OUR normalized replay at the pre-liquidation point — obligation 1's tested value, and the ONLY thing in this gate that tests the derived fold"),
		derived("position_events(event_type=liquidation).payload.index (the same-block interest index the deriver folded with)",
			"the index our fold used. Obligation 1 multiplies OUR normalized balance by it and compares against the event's own beforeDebtAmount"),
		derived("position_events(event_type=liquidation_collateral).payload.{amount,bonus} (record-only fan-out)",
			"the seizure elements as OUR decoder read them off the wire — obligation 3's tested values"),
		derived("position_events(event_type=residue_zeroed).payload.residue",
			"whether the deriver MODELLED DebtManagerCore.sol:549-553's silent zeroing for this case: when it did, the residue tolerance must not also be spent"),
		derived("raw_logs.block_hash for the case's own (tx, log_index)",
			"custody's stored pin, compared byte-for-byte with the COMMITTED frame's block_hash"),
		derived("raw_logs same-block rows with a LOWER log_index",
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
		f.use("raw_logs.block_hash for the case's own (tx, log_index)")
		// The committed pin must still BE custody's pin.
		if !strings.EqualFold(db.StoredBlockHash, fc.BlockHash) {
			rows = append(rows, driftRow(gateBacktest, key, "committed-pin == custody-pin",
				db.StoredBlockHash, fc.BlockHash, "frame-pin-drift",
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

	// ---- OBLIGATION 1: derived-debt weld, bit-exact ------------------------
	// floor(N_before × index / 1e18) == the event's OWN beforeDebtAmount.
	f.use("position_events(engine=debt_manager, side=debt).delta folded to (block, log_index, seq) < the case's own key")
	f.use("position_events(event_type=liquidation).payload.index (the same-block interest index the deriver folded with)")
	ourBefore := mulDivFloor(db.NormalizedBefore, db.IndexAtBlock)
	obl1 := compareExact(gateBacktest, key, "obligation1: beforeDebtAmount(bit-exact)",
		db.BeforeDebtUSD, ourBefore, "derived-fold")
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
	// ---- execution-frame reads (prices only, for the marginality detector) --
	exec, err := readBacktestFrameState(ctx, c, f, account, debtToken, db, decimals, fc.Block, pinHash, false)
	if err != nil {
		return rows, res, err
	}

	// ---- OBLIGATION 2: our eligibility boolean, three-state law -----------
	ourMaxBorrow := new(big.Int)
	for _, leg := range parent.collateral {
		p := parent.prices[leg.token]
		dec, okDec := decimals[leg.token]
		cfg, okCfg := parent.configs[leg.token]
		if p == nil || !okDec || !okCfg || cfg.LiquidationThreshold == nil {
			continue
		}
		usd := new(big.Int).Mul(leg.amount, p)
		usd.Quo(usd, pow10Big(dec))
		contrib := new(big.Int).Mul(usd, cfg.LiquidationThreshold)
		contrib.Quo(contrib, hundredPercentDM)
		ourMaxBorrow.Add(ourMaxBorrow, contrib)
	}
	// Our debt at the PARENT frame is the replayed pre-liquidation value: the
	// event's own beforeDebtAmount is what the contract charged, and OUR fold
	// reproduced it in obligation 1 — so using our number here keeps the
	// boolean OUR boolean.
	ourDebt := ourBefore
	ourEligible := ourDebt.Cmp(ourMaxBorrow) > 0
	margin := new(big.Int).Sub(ourDebt, ourMaxBorrow)
	margin.Abs(margin)
	res.MarginUSD6 = margin.String()

	priceMoved, moveNote := priceFrameDelta(parent, exec)
	res.PriceDeltaNote = moveNote
	sameBlockWitness := len(db.SameBlockEarlier) > 0
	f.use("raw_logs same-block rows with a LOWER log_index")

	oblRow := p3Row{
		Gate: gateBacktest, Subject: key, Leg: "obligation2: OUR eligibility at N-1",
		Expected: "true (the contract executed the liquidation, so it was eligible in the execution frame)",
		Actual:   fmt.Sprintf("%v (debt %s vs maxBorrowLT %s)", ourEligible, ourDebt, ourMaxBorrow),
		Gated:    true,
		Evidence: map[string]string{
			"margin_usd6":               margin.String(),
			"our_max_borrow_lt":         ourMaxBorrow.String(),
			"our_debt_usd6":             ourDebt.String(),
			"price_frame_delta":         moveNote,
			"same_block_earlier_logs":   fmt.Sprintf("%d", len(db.SameBlockEarlier)),
			"same_block_witness_detail": strings.Join(db.SameBlockEarlier, "; "),
		},
	}
	switch {
	case ourEligible:
		res.EligibilityState = "true-at-parent"
		oblRow.Verdict = verdictExact
		oblRow.Note = "TRUE-AT-PARENT: exact pass. Our boolean, over our replayed debt and the parent frame's pinned collateral/prices/thresholds, agrees with the chain's decision"
	case sameBlockWitness || priceMoved:
		res.EligibilityState = "flipped-in-block-with-custodied-witness"
		oblRow.Verdict = verdictMarginal
		oblRow.Class = verdictMarginal
		oblRow.Note = "FLIPPED-IN-BLOCK WITH A CUSTODIED WITNESS: false at the parent frame, and the block carries an earlier custodied log (and/or the engine-exact price differs between the parent and execution frames), which is exactly the intra-block mechanism the Debt Manager's push-price design allows. Disclosed as marginal with the margin printed — NOT absorbed into a pass and NOT counted as a failure"
		f.cite(tolIntraBlockMarginality)
		c.frames.frames[len(c.frames.frames)-1].cite(tolIntraBlockMarginality)
	default:
		res.EligibilityState = verdictUnexplained
		oblRow.Verdict = verdictUnexplained
		oblRow.Class = verdictUnexplained
		oblRow.Note = "UNEXPLAINED: false at the parent frame with NO earlier custodied log in the block and NO price move between frames. This is the gated third state of chain-truth R1's law — a false negative in the alert product with no mechanism to explain it"
	}
	rows = append(rows, oblRow)

	// ---- OBLIGATION 3: seizure reconstruction, exact per branch ------------
	f.use("position_events(event_type=liquidation_collateral).payload.{amount,bonus} (record-only fan-out)")
	seizureRows := reconstructSeizures(key, db, parent, exec, decimals, f)
	rows = append(rows, seizureRows...)

	// ---- OBLIGATION 4: residue weld ---------------------------------------
	f.use("position_events(event_type=residue_zeroed).payload.residue")
	rows = append(rows, residueWeld(key, db, parent, f)...)

	res.Evaluated = true
	return rows, res, nil
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
	db snapshotdb.T6BacktestRow, decimals map[common.Address]uint8, block uint64, hash common.Hash, full bool) (*frameState, error) {
	st := &frameState{
		block: block, hash: hash, pricesOnly: !full,
		prices:   map[common.Address]*big.Int{},
		configs:  map[common.Address]collateralTokenConfigResult{},
		balances: map[common.Address]*big.Int{},
	}
	// Tokens of interest: the seized elements (obligation 3) plus, in the full
	// frame, whatever collateralOf reports (obligation 2).
	seized := map[common.Address]bool{}
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
// the deployed branch it must have taken.
//
// The deployed loop (DebtManagerCore.sol:613-658):
//
//	collateralAmountForDebt = floor(u × 10^dec / P)              (convertUsdToCollateralToken)
//	netCollateralRepayValue = floor(totalCollateral × HP / (HP+b))
//	maxBonus                = totalCollateral − netCollateralRepayValue
//	if totalCollateral − maxBonus < collateralAmountForDebt:      PARTIAL
//	    amount = totalCollateral ; bonus = maxBonus
//	else:                                                        FINAL
//	    bonus  = floor(collateralAmountForDebt × b / HP)
//	    amount = collateralAmountForDebt + bonus
//
// Both branches are recomputed EXACTLY, tolerance zero on the token-unit
// comparison. `u` (the residual repayDebtUsdAmt at this element) is not
// observable per element from the event alone, so the recompute inverts it from
// the recorded amount and then re-derives the branch's other field — which is
// what makes the check falsifiable rather than circular: the bonus is
// reconstructed from the inverted amount and must match the recorded bonus.
func reconstructSeizures(key string, db snapshotdb.T6BacktestRow, parent, exec *frameState,
	decimals map[common.Address]uint8, f *gateFrame) []p3Row {
	var rows []p3Row
	for _, s := range db.Seizures {
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
		bonusBps := cfg.LiquidationBonus

		// ZERO-AMOUNT ELEMENT: the PARTIAL branch with totalCollateral == 0.
		// This is the dominant shape on this population (the liquidator called
		// liquidate() on an account holding none of the preference token), and it
		// is a REAL check: the Safe balance must be zero at the frame.
		if s.Amount.Sign() == 0 && s.Bonus.Sign() == 0 {
			row := compareExact(gateBacktest, subject, "obligation3: partial branch, amount == Safe balance",
				bal, s.Amount, "seizure-partial-zero")
			row.Note = "PARTIAL branch with totalCollateral == 0: the contract seizes the whole (empty) balance, so amount and bonus are both zero and the falsifiable content is that the Safe REALLY held none of this token at the parent frame. " + row.Note
			rows = append(rows, row)
			continue
		}

		// PARTIAL branch test: amount == the Safe's whole balance.
		if s.Amount.Cmp(bal) == 0 {
			net := new(big.Int).Mul(bal, hundredPercentDM)
			net.Quo(net, new(big.Int).Add(hundredPercentDM, bonusBps))
			wantBonus := new(big.Int).Sub(bal, net)
			row := compareExact(gateBacktest, subject, "obligation3: partial branch bonus == totalCollateral - floor(totalCollateral*HP/(HP+b))",
				wantBonus, s.Bonus, "seizure-partial-bonus")
			row.Evidence = map[string]string{
				"branch":            "PARTIAL (amount == the Safe's whole balance at the parent frame)",
				"total_collateral":  bal.String(),
				"liquidation_bonus": bonusBps.String(),
				"net_repay_value":   net.String(),
			}
			rows = append(rows, row)
			continue
		}

		// FINAL branch test: amount − bonus == floor(u·10^dec/P) and
		// bonus == floor((amount − bonus)·b/HP). Inverting cAFD from the
		// recorded amount and re-deriving the bonus is falsifiable: an amount
		// and a bonus that do not satisfy the branch's own algebra cannot both
		// be right.
		cAFD := new(big.Int).Sub(s.Amount, s.Bonus)
		wantBonus := new(big.Int).Mul(cAFD, bonusBps)
		wantBonus.Quo(wantBonus, hundredPercentDM)
		row := compareExact(gateBacktest, subject, "obligation3: final branch bonus == floor(cAFD*b/HP)",
			wantBonus, s.Bonus, "seizure-final-bonus")
		// The credited-USD round trip is the ONE derived slack here, and it is
		// on the USD leg only — the token-unit comparison above stays exact.
		creditedUSD := new(big.Int).Mul(cAFD, price)
		creditedUSD.Quo(creditedUSD, pow10Big(dec))
		perWei := new(big.Int).Add(price, pow10Big(dec))
		perWei.Sub(perWei, big.NewInt(1))
		perWei.Quo(perWei, pow10Big(dec)) // ceil(P / 10^dec)
		row.Evidence = map[string]string{
			"branch":                 "FINAL (amount = collateralAmountForDebt + bonus)",
			"collateral_for_debt":    cAFD.String(),
			"liquidation_bonus":      bonusBps.String(),
			"engine_price_at_parent": price.String(),
			"credited_usd":           creditedUSD.String(),
			"round_trip_slack":       "the credited USD round trip floor(floor(u*10^dec/P)*P/10^dec) sits in [u - ceil(P/10^dec), u] = a deficit of at most ONE WEI of the collateral token; ceil(P/10^dec) here = " + perWei.String() + " USD-6 units. The TOKEN-UNIT comparison in this row is EXACT; the slack exists only on the USD re-derivation leg",
			"tolerance":              tolSeizureTokenWei,
		}
		f.cite(tolSeizureTokenWei)
		rows = append(rows, row)
	}
	return rows
}

// residueWeld is obligation 4: the post-liquidation residue, ≤1 normalized wei
// and ONLY for fully-liquidated accounts.
func residueWeld(key string, db snapshotdb.T6BacktestRow, exec *frameState, f *gateFrame) []p3Row {
	if exec.chainDebt == nil {
		return []p3Row{unreadRow(gateBacktest, key, "obligation4: residue weld",
			"borrowingOf(user, borrowToken) did not read at the liquidation block")}
	}
	ourAfter := mulDivFloor(db.NormalizedAfter, db.IndexAtBlock)
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
			"residue_modelled": fmt.Sprintf("%v", db.ResidueZeroed),
			"residue_amount":   db.ResidueText,
			"fully_liquidated": fmt.Sprintf("%v", fullyLiquidated),
		},
	}
	diff := new(big.Int).Sub(ourAfter, exec.chainDebt)
	switch {
	case diff.Sign() == 0:
		row.Verdict = verdictExact
		row.Note = "EXACT with no tolerance spent. Our replayed after-state equals borrowingOf at the liquidation block"
	case fullyLiquidated && !db.ResidueZeroed && diff.Sign() > 0 && diff.Cmp(big.NewInt(1)) <= 0:
		// THE single legitimate standing tolerance in Task 6.
		row.Verdict = verdictExact
		row.Class = "residue-1-wei-tolerance-spent"
		row.Note = "the ONE legitimate standing tolerance: <=1 normalized wei on a FULLY-LIQUIDATED account, derived-high direction only, citing the silent zeroing at DebtManagerCore.sol:549-553 (the contract sets a remaining normalized amount of exactly 1 to zero without emitting anything). The deriver did NOT model it for this case, so the tolerance is spent here rather than absorbed silently"
		row.Evidence["tolerance"] = tolResidueWei
		f.cite(tolResidueWei)
	case db.ResidueZeroed && diff.Sign() != 0:
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
