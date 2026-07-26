// Phase 2 — RPC comparisons (brief §0), sequential OP then ETH against one
// shared token bucket. Every value compared here was either read in the
// Phase-1 snapshot (DB side) or is read now under the SAME pin hash (chain
// side); nothing re-reads the database.
package main

import (
	"context"
	"encoding/hex"
	"errors"
	"fmt"
	"math/big"
	"sort"
	"time"

	"github.com/ethereum/go-ethereum/common"

	"github.com/kaselunt/solvent/internal/store"
)

// runDMPhase executes §3.3 (per-account rows), the F1 weld, §3.6 (index
// integrity), and §7 (freshness spot reads + deep replay) against OP.
func runDMPhase(ctx context.Context, o *options, p1 *phase1Data, r *pinnedReader, dmProxy common.Address, rep *driftReport, gatedFailures *int) error {
	pinOP := p1.pins[dmEngine]
	pinHash := p1.pinHashes["op"]

	// ---- Round 1: getBorrowTokens + borrowingOf(account) ------------------
	tokensData, err := dmGetBorrowTokensABI.Pack("getBorrowTokens")
	if err != nil {
		return err
	}
	calls := []multicallCall{{Target: dmProxy, CallData: tokensData}}
	for _, a := range p1.sel.Accounts {
		data, err := dmBorrowingOfAllABI.Pack("borrowingOf", common.HexToAddress(a.Row.AccountHex))
		if err != nil {
			return err
		}
		calls = append(calls, multicallCall{Target: dmProxy, CallData: data})
	}
	round1, round1Endpoints, err := r.multicall(ctx, "dm:borrowingOf", pinOP, pinHash, calls)
	if err != nil {
		return dmPhaseErr(err)
	}
	if !round1[0].Success {
		return abort(exitRetryable, "aborted: rpc", "getBorrowTokens reverted at the pin")
	}
	borrowTokens, err := unpackAddressList(dmGetBorrowTokensABI, "getBorrowTokens", round1[0].ReturnData)
	if err != nil {
		return err
	}
	type accountChain struct {
		tokens []tokenAmount
		total  *big.Int
		ok     bool
		note   string
	}
	chainByAccount := map[string]accountChain{}
	for i, a := range p1.sel.Accounts {
		res := round1[i+1]
		if !res.Success {
			chainByAccount[a.Row.AccountHex] = accountChain{note: "borrowingOf reverted at the pin"}
			continue
		}
		list, total, err := unpackTokenAmountList(dmBorrowingOfAllABI, "borrowingOf", res.ReturnData)
		if err != nil {
			chainByAccount[a.Row.AccountHex] = accountChain{note: err.Error()}
			continue
		}
		chainByAccount[a.Row.AccountHex] = accountChain{tokens: list, total: total, ok: true}
	}

	// ---- Token universe + Round 2: getCurrentIndex + borrowTokenConfig ----
	// weldTokens is the AUTHORITATIVE weld universe (round-10 F3): the
	// EXPLICIT union getBorrowTokens(@pin) ∪ derived assets. Per-account
	// response tokens join `universe` (index reads) but not the weld
	// universe — the weld's census is the contract's own configured list
	// plus everything the DB derived, independent of what happened to be
	// readable this run.
	universe := map[common.Address]bool{}
	weldTokens := map[common.Address]bool{}
	for _, t := range borrowTokens {
		universe[t] = true
		weldTokens[t] = true
	}
	for _, s := range p1.dmAllNet {
		tok := common.BytesToAddress(s.Asset)
		universe[tok] = true
		weldTokens[tok] = true
	}
	for _, ac := range chainByAccount {
		for _, t := range ac.tokens {
			universe[t.Token] = true
		}
	}
	universeList := sortedAddrs(universe)
	weldList := sortedAddrs(weldTokens)

	calls = calls[:0]
	for _, t := range universeList {
		data, err := dmGetCurrentIndexABI.Pack("getCurrentIndex", t)
		if err != nil {
			return err
		}
		calls = append(calls, multicallCall{Target: dmProxy, CallData: data})
	}
	for _, t := range weldList {
		data, err := dmBorrowTokenConfigABI.Pack("borrowTokenConfig", t)
		if err != nil {
			return err
		}
		calls = append(calls, multicallCall{Target: dmProxy, CallData: data})
	}
	round2, _, err := r.multicall(ctx, "dm:indexes+config", pinOP, pinHash, calls)
	if err != nil {
		return dmPhaseErr(err)
	}
	indexes := map[common.Address]*big.Int{}
	for i, t := range universeList {
		if !round2[i].Success {
			// getCurrentIndex reverts for a token that was never configured
			// as a borrow token — leave absent; compareDMRow surfaces it.
			continue
		}
		v, err := unpackUint256(dmGetCurrentIndexABI, "getCurrentIndex", round2[i].ReturnData)
		if err != nil {
			return err
		}
		indexes[t] = v
	}
	// Read-presence facts for EVERY weld-universe token (round-10 F3): an
	// unsuccessful or undecodable borrowTokenConfig read is an OK=false
	// fact, never a skipped entry — so weldDMAggregate turns it into a
	// GATED weld-unread row instead of letting the token vanish.
	chainReads := buildDMWeldReads(weldList, round2, len(universeList))

	// ---- F1 aggregate weld (BLOCKING amendment): ALL accounts, over the
	// AUTHORITATIVE universe getBorrowTokens(@pin) ∪ derived (weldList) ----
	weldInputs := computeDMWeldInputs(p1)
	rep.DMWeld = weldDMAggregate(weldInputs, weldList, chainReads)
	for _, w := range rep.DMWeld {
		if w.Verdict != verdictExact {
			*gatedFailures++
		}
	}

	// ---- Per-account rows (§3.3) ------------------------------------------
	derivedByAccount := map[string]map[common.Address]*big.Int{}
	hadEvents := map[string]bool{}
	for _, s := range p1.dmAsOf {
		if s.Side != "debt" || len(s.Asset) == 0 {
			continue
		}
		acct := hex.EncodeToString(s.Account)
		if derivedByAccount[acct] == nil {
			derivedByAccount[acct] = map[common.Address]*big.Int{}
		}
		derivedByAccount[acct][common.BytesToAddress(s.Asset)] = s.Total
		hadEvents[acct] = true
	}
	for _, a := range p1.sel.Accounts {
		acct := a.Row.AccountHex
		ac := chainByAccount[acct]
		row := compareDMRow(acct, derivedByAccount[acct], ac.tokens, ac.total, indexes)
		row.Stratum = a.Row.Stratum
		row.Forced = a.Forced
		row.Source = a.Source
		row.Live = a.Row.Live
		row.Endpoints = round1Endpoints
		if !ac.ok {
			row.Verdict = verdictDrift
			row.SecondOpinion = "first opinion unusable: " + ac.note
		}
		if row.Verdict != verdictExact {
			*gatedFailures++
			classifyRowLegs(&row, a.Row, p1, indexes)
			// Second opinion (§3.5): re-read the account's WORST leg from a
			// different endpoint; recorded, never corroborative.
			if len(row.Tokens) > 0 && ac.ok {
				tok := common.HexToAddress(row.Tokens[0].TokenHex)
				for _, t := range row.Tokens {
					if t.Verdict != verdictExact {
						tok = common.HexToAddress(t.TokenHex)
						break
					}
				}
				data, perr := dmBorrowingOfOneABI.Pack("borrowingOf", common.HexToAddress(acct), tok)
				if perr == nil {
					served := 0
					if len(round1Endpoints) > 0 {
						served = round1Endpoints[0]
					}
					opinion, _ := r.secondOpinion(ctx, "dm:secondOpinion", dmProxy, data, pinHash, served)
					row.SecondOpinion = opinion
				}
			}
		}
		rep.DMRows = append(rep.DMRows, row)
	}

	// ---- §3.6 index integrity (separate verdict class) ---------------------
	sampledDebtTokens := map[string]bool{}
	for _, s := range p1.dmAsOf {
		if s.Side == "debt" && len(s.Asset) > 0 && s.Total.Sign() != 0 {
			sampledDebtTokens[hex.EncodeToString(s.Asset)] = true
		}
	}
	headerTimeCache := map[uint64]uint64{}
	pinTime := p1.pinTimes["op"]
	for _, t := range universeList {
		tokenHex := hex.EncodeToString(t.Bytes())
		var idxBase *big.Int
		var baseBlock uint64
		if obs, ok := p1.dmIdxBase[tokenHex]; ok {
			idxBase = obs.Value
			baseBlock = obs.Block
		}
		apy := p1.dmAPY[tokenHex]
		var dt uint64
		if idxBase != nil && apy != nil {
			bt, ok := headerTimeCache[baseBlock]
			if !ok {
				v, _, err := r.headerTime(ctx, baseBlock)
				if err != nil {
					return dmPhaseErr(err)
				}
				headerTimeCache[baseBlock] = v
				bt = v
			}
			if pinTime >= bt {
				dt = pinTime - bt
			}
		}
		row := evaluateIndexCheck(t.Hex(), idxBase, baseBlock, apy, dt, indexes[t], sampledDebtTokens[tokenHex])
		if row.Gated && row.Verdict != verdictExact {
			*gatedFailures++
		}
		rep.DMIndexCheck = append(rep.DMIndexCheck, row)
	}

	// ---- §7: freshness, spot reads, zero-collateral, deep replay ----------
	sampleSet := map[string]bool{}
	for _, a := range p1.sel.Accounts {
		sampleSet[a.Row.AccountHex] = true
	}
	fresh := evaluateFreshness(p1.freshRows, sampleSet, p1.freshBound, p1.freshBoundInputs, time.Now())
	freshByAccount := map[string]store.AccountFreshness{}
	for _, f := range p1.freshRows {
		freshByAccount[hex.EncodeToString(f.Account)] = f
	}
	for _, a := range p1.sel.Accounts {
		var snapRows []store.BalanceRow
		for _, b := range p1.balances[a.Row.AccountHex] {
			if b.Source == "snapshot" && b.Side == "collateral" {
				snapRows = append(snapRows, b)
			}
		}
		f := freshByAccount[a.Row.AccountHex]
		if ok, detail := zeroCollateralConditional(snapRows, f.LastSuccessBlock); !ok {
			fresh.GateFailures++
			fresh.Notes = append(fresh.Notes, fmt.Sprintf("zero-collateral conditional FAILED for %s: %s", a.Row.AccountHex, detail))
		}
	}
	rep.Freshness = &fresh

	// Spot reads (non-gating, §7): collateralOf(account)@pinHash(P_op).
	calls = calls[:0]
	for _, a := range p1.sel.Accounts {
		data, err := dmCollateralOfABI.Pack("collateralOf", common.HexToAddress(a.Row.AccountHex))
		if err != nil {
			return err
		}
		calls = append(calls, multicallCall{Target: dmProxy, CallData: data})
	}
	round3, _, err := r.multicall(ctx, "dm:collateralOf", pinOP, pinHash, calls)
	if err != nil {
		return dmPhaseErr(err)
	}
	for i, a := range p1.sel.Accounts {
		if !round3[i].Success {
			rep.SpotReads = append(rep.SpotReads, spotReadRow{
				AccountHex: a.Row.AccountHex, PinBlock: pinOP, Match: false,
				Diffs: []string{"collateralOf reverted at the pin"}, Note: spotReadNote,
			})
			continue
		}
		list, _, err := unpackTokenAmountList(dmCollateralOfABI, "collateralOf", round3[i].ReturnData)
		if err != nil {
			return err
		}
		f := freshByAccount[a.Row.AccountHex]
		rep.SpotReads = append(rep.SpotReads,
			buildSpotReadRow(a.Row.AccountHex, p1.balances[a.Row.AccountHex], foldCollateralOf(list), f.LastSuccessBlock, pinOP))
	}

	// Deep collateral replay (§7): gates ONLY when served.
	for _, t := range p1.replays {
		row := collateralReplayRow{AccountHex: t.AccountHex, Block: t.Block}
		h, _, err := r.headerHash(ctx, t.Block)
		if err != nil {
			row.Served, row.Gated, row.Verdict = false, false, "not-served"
			row.Class, row.DepthNote = replayFailureClass(err), replayDepth(pinOP, t.Block)
			rep.CollateralReplay = append(rep.CollateralReplay, row)
			continue
		}
		data, err := dmCollateralOfABI.Pack("collateralOf", common.HexToAddress(t.AccountHex))
		if err != nil {
			return err
		}
		ret, tok, err := r.callAtHash(ctx, fmt.Sprintf("dm:replay(%s@%d)", t.AccountHex, t.Block), dmProxy, data, h)
		if err != nil {
			row.Served, row.Gated, row.Verdict = false, false, "not-served"
			row.Class, row.DepthNote = replayFailureClass(err), replayDepth(pinOP, t.Block)
			rep.CollateralReplay = append(rep.CollateralReplay, row)
			continue
		}
		list, _, err := unpackTokenAmountList(dmCollateralOfABI, "collateralOf", ret)
		if err != nil {
			return err
		}
		row.Served, row.Gated = true, true
		row.Endpoints = []int{tok.Index}
		verdict, diffs := compareCollateralReplay(t.Doc, foldCollateralOf(list))
		row.Verdict, row.Diffs = verdict, diffs
		if verdict != verdictExact {
			// A SERVED-and-mismatched replay IS gated: it replays the
			// sweeper's own read at the sweeper's own block.
			*gatedFailures++
		}
		rep.CollateralReplay = append(rep.CollateralReplay, row)
	}
	return nil
}

// computeDMWeldInputs assembles the F1 weld's derived side: the ALL-ACCOUNTS
// census (p1.dmAllNet — store.AssetNetSums has no account filter) plus the
// sampled subset's totals as a coverage diagnostic. Substituting the sample
// aggregation for the census is the exact blindness F1 blocks; the named
// kill is TestComputeDMWeldInputsCoversAllAccounts.
func computeDMWeldInputs(p1 *phase1Data) dmWeldInputs {
	return dmWeldInputs{
		All:          p1.dmAllNet,
		SampleTotals: assetNetSumsFromSample(p1.dmAsOf),
	}
}

// classifyRowLegs stamps a diagnosis class on every drifted token leg.
func classifyRowLegs(row *dmRowResult, sample store.DMBorrowerRow, p1 *phase1Data, indexes map[common.Address]*big.Int) {
	for i := range row.Tokens {
		leg := &row.Tokens[i]
		if leg.Verdict == verdictExact {
			continue
		}
		tokenHex := hexLower(leg.TokenHex)
		nDerived, _ := new(big.Int).SetString(leg.DerivedNet, 10)
		chainAmt, _ := new(big.Int).SetString(leg.ChainUSD, 10)
		var dbIdx *big.Int
		if obs, ok := p1.dmIdxBase[tokenHex]; ok {
			dbIdx = obs.Value
		}
		hasResidue := p1.residue[row.AccountHex][tokenHex]
		leg.Classification = classifyDMMismatch(
			sample.FullyLiquidated, hasResidue,
			nDerived, indexes[common.HexToAddress(leg.TokenHex)], chainAmt, dbIdx,
			true, p1.stableSnap[row.AccountHex])
		if nDerived == nil || nDerived.Sign() == 0 {
			// The classifier's missing-genesis arm needs "no derived events"
			// — re-evaluate with that fact when the DB side is empty.
			leg.Classification = classifyDMMismatch(
				sample.FullyLiquidated, hasResidue,
				nDerived, indexes[common.HexToAddress(leg.TokenHex)], chainAmt, dbIdx,
				false, p1.stableSnap[row.AccountHex])
		}
	}
}

func hexLower(addrHex string) string {
	return hex.EncodeToString(common.HexToAddress(addrHex).Bytes())
}

func replayFailureClass(err error) string {
	var pf *pinnedFailure
	if errors.As(err, &pf) {
		return pf.Class
	}
	return classTransport
}

func replayDepth(pin, block uint64) string {
	return fmt.Sprintf("replay block %d is %d blocks below the pin %d — beyond non-archive horizons this degrades to report-only (L1-5), never exit 1/2 by itself", block, pin-block, pin)
}

func dmPhaseErr(err error) error {
	if errors.Is(err, errChunkDivergence) {
		return abort(exitRetryable, "aborted: chunk divergence", "%v", err)
	}
	var pf *pinnedFailure
	if errors.As(err, &pf) {
		switch pf.Class {
		case classStatePruned:
			return abort(exitRetryable, "aborted: state-pruned", "fresh-pin state became unservable mid-run: %v", err)
		case classCapability:
			return abort(exitPrecondition, "aborted: capability", "%v", err)
		}
		return abort(exitRetryable, "aborted: rpc", "%v", err)
	}
	return err
}

func sortedAddrs(set map[common.Address]bool) []common.Address {
	out := make([]common.Address, 0, len(set))
	for a := range set {
		out = append(out, a)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Hex() < out[j].Hex() })
	return out
}

// runAavePhase executes §3.4 (golden borrowers gated + top-10 labeled
// supplementary), §4 (golden rows A/B/C), and the F1 Aave welds against ETH.
func runAavePhase(ctx context.Context, o *options, p1 *phase1Data, r *pinnedReader, aavePool common.Address, atokens map[string]common.Address, vec goldenVectors, rep *driftReport, gatedFailures *int) error {
	pinETH := p1.pins[aaveEngine]
	pinHash := p1.pinHashes["eth"]

	// ---- Golden rows A/B/C (§4) --------------------------------------------
	goldenRows, err := runGoldenChainSide(ctx, r, vec, p1.golden, aavePool, atokens)
	rep.Golden = goldenRows
	if err != nil {
		return aavePhaseErr(err)
	}
	for _, g := range goldenRows {
		if g.Verdict != verdictExact {
			*gatedFailures++
		}
	}
	for _, rowName := range []string{"A", "B"} {
		for _, g := range goldenRows {
			if g.Row == rowName && g.PinHash != "" {
				rep.Pins = append(rep.Pins, pinInfo{Chain: "eth:golden-" + rowName, Block: g.Pin, Hash: g.PinHash})
				break
			}
		}
	}

	// ---- Authoritative reserve universe (round-10 F3) ---------------------
	// The weld universe is the Pool's OWN getReservesList(@pin) ∪ derived
	// assets (∪ the fixture reserves, a subset on a healthy config): a
	// reserve the DB never derived still gets a weld row, and an unreadable
	// leg surfaces as a weld-unread row instead of vanishing.
	rlData, err := poolReservesListABI.Pack("getReservesList")
	if err != nil {
		return err
	}
	rlRet, _, err := r.callAtHash(ctx, "aave:getReservesList", aavePool, rlData, pinHash)
	if err != nil {
		return aavePhaseErr(err)
	}
	reservesList, err := unpackAddressList(poolReservesListABI, "getReservesList", rlRet)
	if err != nil {
		return err
	}
	universeDebtSet := map[common.Address]bool{}
	universeCollSet := map[common.Address]bool{}
	for _, reserve := range reservesList {
		universeDebtSet[reserve] = true
		universeCollSet[reserve] = true
	}
	for _, s := range p1.aaveDebtNet {
		universeDebtSet[common.BytesToAddress(s.Asset)] = true
	}
	for _, s := range p1.aaveCollNet {
		universeCollSet[common.BytesToAddress(s.Asset)] = true
	}
	var fixtureDebtReserves []common.Address
	aTokenByReserve := map[common.Address]common.Address{}
	for _, res := range vec.Reserves {
		underlying := common.HexToAddress(res.Underlying)
		if at, ok := atokens[hexLower(res.Underlying)]; ok {
			aTokenByReserve[underlying] = at
			universeCollSet[underlying] = true
		}
		if res.Role == "debt" {
			fixtureDebtReserves = append(fixtureDebtReserves, underlying)
			universeDebtSet[underlying] = true
		}
	}
	universeDebt := sortedAddrs(universeDebtSet)
	universeColl := sortedAddrs(universeCollSet)

	// ---- Resolve debt tokens / aTokens at the pin -------------------------
	// Resolution runs IN-BAND (multicall Success flags) so read-presence is
	// a per-reserve fact: a reverting or undecodable resolution becomes a
	// weld-unread row — except a FIXTURE debt reserve, whose golden legs
	// cannot run without it (loud abort, exit 3, as before).
	type resolveTag struct {
		kind    string // "debt" | "coll"
		reserve common.Address
	}
	var resolveCalls []multicallCall
	var resolveTags []resolveTag
	for _, reserve := range universeDebt {
		data, err := poolReserveDebtTokenABI.Pack("getReserveVariableDebtToken", reserve)
		if err != nil {
			return err
		}
		resolveCalls = append(resolveCalls, multicallCall{Target: aavePool, CallData: data})
		resolveTags = append(resolveTags, resolveTag{kind: "debt", reserve: reserve})
	}
	for _, reserve := range universeColl {
		if _, ok := aTokenByReserve[reserve]; ok {
			continue // already resolved from the config streams (fixtures)
		}
		data, err := poolReserveATokenABI.Pack("getReserveAToken", reserve)
		if err != nil {
			return err
		}
		resolveCalls = append(resolveCalls, multicallCall{Target: aavePool, CallData: data})
		resolveTags = append(resolveTags, resolveTag{kind: "coll", reserve: reserve})
	}
	debtTokenByReserve := map[common.Address]common.Address{}
	unresolvedDebt := map[common.Address]string{}
	unresolvedColl := map[common.Address]string{}
	if len(resolveCalls) > 0 {
		resolveResults, _, err := r.multicall(ctx, "aave:resolveTokens", pinETH, pinHash, resolveCalls)
		if err != nil {
			return aavePhaseErr(err)
		}
		for i, tag := range resolveTags {
			method, lens := "getReserveVariableDebtToken", poolReserveDebtTokenABI
			if tag.kind == "coll" {
				method, lens = "getReserveAToken", poolReserveATokenABI
			}
			note := ""
			var token common.Address
			if !resolveResults[i].Success {
				note = method + " unsuccessful (reverted) at the pin"
			} else if dt, uerr := unpackAddress(lens, method, resolveResults[i].ReturnData); uerr != nil {
				note = method + " undecodable at the pin (ABI skew): " + uerr.Error()
			} else if dt == (common.Address{}) {
				note = method + " resolved to the zero address at the pin"
			} else {
				token = dt
			}
			switch {
			case note != "" && tag.kind == "debt":
				unresolvedDebt[tag.reserve] = note
			case note != "":
				unresolvedColl[tag.reserve] = note
			case tag.kind == "debt":
				debtTokenByReserve[tag.reserve] = token
			default:
				aTokenByReserve[tag.reserve] = token
			}
		}
	}
	for _, reserve := range fixtureDebtReserves {
		if _, ok := debtTokenByReserve[reserve]; !ok {
			return abort(exitRetryable, "aborted: rpc",
				"fixture debt reserve %s unresolved at the pin (%s) — the golden legs cannot run", reserve.Hex(), unresolvedDebt[reserve])
		}
	}

	// ---- One multicall round: golden-at-head + top-10 + welds -------------
	type callTag struct {
		kind    string // "scaled" | "balanceOf" | "normalized" | "weldDebt" | "weldColl"
		account string
		reserve common.Address
		token   common.Address
		side    string
		gated   bool
		supp    bool
	}
	var calls []multicallCall
	var tags []callTag
	addCall := func(tag callTag, target common.Address, data []byte) {
		calls = append(calls, multicallCall{Target: target, CallData: data})
		tags = append(tags, tag)
	}
	packScaled := func(user common.Address) []byte {
		d, _ := aaveScaledBalanceOfABI.Pack("scaledBalanceOf", user)
		return d
	}
	for _, b := range vec.Borrowers {
		user := common.HexToAddress(b.Address)
		acct := hexLower(b.Address)
		debtReserve := common.HexToAddress(b.DebtReserve)
		collReserve := common.HexToAddress(b.CollateralReserve)
		if dt, ok := debtTokenByReserve[debtReserve]; ok {
			addCall(callTag{kind: "scaled", account: acct, reserve: debtReserve, token: dt, side: "debt", gated: true}, dt, packScaled(user))
			bd, _ := erc20BalanceOfABI.Pack("balanceOf", user)
			addCall(callTag{kind: "balanceOf", account: acct, reserve: debtReserve, token: dt, side: "debt", gated: true}, dt, bd)
		}
		if at, ok := aTokenByReserve[collReserve]; ok {
			addCall(callTag{kind: "scaled", account: acct, reserve: collReserve, token: at, side: "collateral", gated: true}, at, packScaled(user))
		}
	}
	for _, reserve := range fixtureDebtReserves {
		// normalized debt feeds the golden borrowers' §3.4(b) live-value
		// identity only, so the fixture debt reserves (all resolved —
		// asserted above) are exactly its scope.
		nd, _ := poolNormalizedDebtABI.Pack("getReserveNormalizedVariableDebt", reserve)
		addCall(callTag{kind: "normalized", reserve: reserve}, aavePool, nd)
	}
	// Top-10 supplementary (labeled, non-gating — F4 carried as a named
	// note: gated Aave census breadth is the golden borrowers).
	for _, t := range p1.topAave {
		reserve := common.BytesToAddress(t.Asset)
		dt, ok := debtTokenByReserve[reserve]
		if !ok {
			continue
		}
		addCall(callTag{kind: "scaled", account: hex.EncodeToString(t.Account), reserve: reserve, token: dt, side: "debt", supp: true}, dt, packScaled(common.BytesToAddress(t.Account)))
	}
	sts, _ := aaveScaledTotalSupplyABI.Pack("scaledTotalSupply")
	for reserve, dt := range debtTokenByReserve {
		addCall(callTag{kind: "weldDebt", reserve: reserve, token: dt}, dt, sts)
	}
	for reserve, at := range aTokenByReserve {
		addCall(callTag{kind: "weldColl", reserve: reserve, token: at}, at, sts)
	}

	results, endpoints, err := r.multicall(ctx, "aave:head", pinETH, pinHash, calls)
	if err != nil {
		return aavePhaseErr(err)
	}

	scaledResults := map[string]*big.Int{} // account/reserveHex/side
	balanceOfResults := map[string]*big.Int{}
	normalized := map[common.Address]*big.Int{}
	// Weld legs carry READ-PRESENCE facts (round-10 F3): an unsuccessful or
	// undecodable scaledTotalSupply becomes an OK=false fact feeding a gated
	// weld-unread row — never an abort-hidden or silently absent leg. The
	// per-account legs (scaled/balanceOf/normalized) keep the loud abort.
	weldDebtReads := map[common.Address]chainRead{}
	weldCollReads := map[common.Address]chainRead{}
	suppTags := []callTag{}
	for i, tag := range tags {
		if !results[i].Success {
			switch tag.kind {
			case "weldDebt":
				weldDebtReads[tag.reserve] = chainRead{Note: "scaledTotalSupply unsuccessful (reverted) at the pin"}
				continue
			case "weldColl":
				weldCollReads[tag.reserve] = chainRead{Note: "scaledTotalSupply unsuccessful (reverted) at the pin"}
				continue
			}
			return abort(exitRetryable, "aborted: rpc", "aave head call %d (%s) reverted at the pin", i, tag.kind)
		}
		switch tag.kind {
		case "scaled":
			v, err := unpackUint256(aaveScaledBalanceOfABI, "scaledBalanceOf", results[i].ReturnData)
			if err != nil {
				return err
			}
			scaledResults[tag.account+"/"+hexLower(tag.reserve.Hex())+"/"+tag.side] = v
			if tag.supp {
				suppTags = append(suppTags, tag)
			}
		case "balanceOf":
			v, err := unpackUint256(erc20BalanceOfABI, "balanceOf", results[i].ReturnData)
			if err != nil {
				return err
			}
			balanceOfResults[tag.account+"/"+hexLower(tag.reserve.Hex())] = v
		case "normalized":
			v, err := unpackUint256(poolNormalizedDebtABI, "getReserveNormalizedVariableDebt", results[i].ReturnData)
			if err != nil {
				return err
			}
			normalized[tag.reserve] = v
		case "weldDebt":
			v, err := unpackUint256(aaveScaledTotalSupplyABI, "scaledTotalSupply", results[i].ReturnData)
			if err != nil {
				weldDebtReads[tag.reserve] = chainRead{Note: "scaledTotalSupply undecodable at the pin (ABI skew): " + err.Error()}
				continue
			}
			weldDebtReads[tag.reserve] = chainRead{Total: v, OK: true}
		case "weldColl":
			v, err := unpackUint256(aaveScaledTotalSupplyABI, "scaledTotalSupply", results[i].ReturnData)
			if err != nil {
				weldCollReads[tag.reserve] = chainRead{Note: "scaledTotalSupply undecodable at the pin (ABI skew): " + err.Error()}
				continue
			}
			weldCollReads[tag.reserve] = chainRead{Total: v, OK: true}
		}
	}
	// Unresolved universe reserves are unread weld legs too — resolution
	// failure and read failure are the same first-class fact.
	for reserve, note := range unresolvedDebt {
		weldDebtReads[reserve] = chainRead{Note: note}
	}
	for reserve, note := range unresolvedColl {
		weldCollReads[reserve] = chainRead{Note: note}
	}

	headAsOf := goldenAsOfMap(p1.aaveAsOfHead)
	// Golden borrowers at fresh P_eth (gated — "both vectors also run at
	// fresh P: derivation holds at head, not only historically").
	for _, b := range vec.Borrowers {
		acct := hexLower(b.Address)
		for _, leg := range []struct {
			side    string
			reserve string
		}{{"debt", b.DebtReserve}, {"collateral", b.CollateralReserve}} {
			resHex := hexLower(leg.reserve)
			derived := goldenLookup(headAsOf, acct, resHex, leg.side)
			chainV := scaledResults[acct+"/"+resHex+"/"+leg.side]
			reserve := common.HexToAddress(leg.reserve)
			row := aaveRowResult{
				AccountHex: acct,
				ReserveHex: reserve.Hex(),
				Side:       leg.side,
				Derived:    derived.String(),
				Gated:      true,
				Endpoints:  endpoints,
			}
			if chainV == nil {
				row.Verdict = verdictDrift
				row.Chain = "(unread)"
			} else {
				row.Chain = chainV.String()
				row.Verdict = compareScaled(derived, chainV)
			}
			if leg.side == "debt" {
				if dt, ok := debtTokenByReserve[reserve]; ok {
					row.TokenHex = dt.Hex()
				}
				if n, ok := normalized[reserve]; ok {
					if bal, ok := balanceOfResults[acct+"/"+resHex]; ok {
						computed, verdict := liveValueIdentity(derived, n, bal)
						row.LiveDerived, row.LiveChain, row.LiveVerdict = computed, bal.String(), verdict
						if verdict != verdictExact {
							row.Verdict = verdictDrift
						}
					}
				}
			} else if at, ok := aTokenByReserve[reserve]; ok {
				row.TokenHex = at.Hex()
			}
			if row.Verdict != verdictExact {
				*gatedFailures++
			}
			rep.AaveRows = append(rep.AaveRows, row)
		}
	}
	// Top-10 supplementary rows (labeled, never gated).
	for _, tag := range suppTags {
		derived := goldenLookup(headAsOf, tag.account, hexLower(tag.reserve.Hex()), "debt")
		chainV := scaledResults[tag.account+"/"+hexLower(tag.reserve.Hex())+"/debt"]
		row := aaveRowResult{
			AccountHex: tag.account,
			ReserveHex: tag.reserve.Hex(),
			Side:       "debt",
			TokenHex:   tag.token.Hex(),
			Derived:    derived.String(),
			Chain:      chainV.String(),
			Verdict:    compareScaled(derived, chainV),
			Gated:      false,
			Supplement: true,
			Endpoints:  endpoints,
		}
		rep.AaveRows = append(rep.AaveRows, row)
	}

	// ---- F1 Aave welds over the AUTHORITATIVE universe (round-10 F3) -------
	rep.AaveWeld = append(
		weldAaveAggregate("debt", true, derivedScaledByReserve(p1.aaveDebtNet), weldDebtReads, debtTokenByReserve, universeDebt),
		weldAaveAggregate("collateral", false, derivedScaledByReserve(p1.aaveCollNet), weldCollReads, aTokenByReserve, universeColl)...)
	for _, w := range rep.AaveWeld {
		if w.Gated && w.Verdict != verdictExact {
			*gatedFailures++
		}
	}
	_ = o
	return nil
}

func aavePhaseErr(err error) error {
	var a *runAbort
	if errors.As(err, &a) {
		return a
	}
	if errors.Is(err, errChunkDivergence) {
		return abort(exitRetryable, "aborted: chunk divergence", "%v", err)
	}
	var pf *pinnedFailure
	if errors.As(err, &pf) {
		switch pf.Class {
		case classStatePruned:
			return abort(exitPrecondition, "aborted: state-pruned",
				"golden/head pinned state unservable (%v) — the W1 golden row needs an archive-capable SOLVENT_RECON_RPC_ETH endpoint; never skipped, never fixture-substituted", err)
		case classCapability:
			return abort(exitPrecondition, "aborted: capability", "%v", err)
		}
		return abort(exitRetryable, "aborted: rpc", "%v", err)
	}
	return err
}
