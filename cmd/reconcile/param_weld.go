// The param weld (A vs B), the registry-consistency gate (C vs B), and the
// adapter-output weld.
//
// chain-truth R2's three-party separation is the whole design:
//
//	A — custody chain:      param_history (ETH), dm config events (OP)
//	B — chain testimony:    getConfiguration / collateralTokenConfig @pinHash
//	C — our committed claim: recon/feeds.json
//
// A vs B is the WELD, and under R5 the CHAIN (B) is the expected side: logs and
// state are two independent doors to the same chain, which is exactly what
// makes it a weld rather than a self-check. Divergence refuses to serve params,
// loud, never preferring either witness.
//
// C is NOT a witness. Treating our own registry as the expected truth against
// which the chain is judged would be the-RPC-said-so inverted — the-config-said-
// so — so feeds.json is judged AGAINST B, both directions, with the direction
// classified because remediation differs. The precedent is db_name_claimed vs
// server-reported identity (main.go:1177-1192): claimed subject vs audited
// subject, verdict-bearing in EITHER direction.
//
// The adapter-output weld is the OTHER read family chain-truth R1 names: each
// sampled poll row is re-read at ITS OWN STORED ANCHOR HASH. Re-reading at the
// run's pin would manufacture drift out of honest price movement and would
// judge one witness (the oracle) across two different states.
package main

import (
	"context"
	"fmt"
	"math/big"

	"github.com/ethereum/go-ethereum/common"

	"github.com/kaselunt/solvent/cmd/reconcile/snapshotdb"
	"github.com/kaselunt/solvent/internal/riskfeed"
)

// adapterRowsPerReserve is risk-quant R3's strengthening of the plan's ">=1 row
// per ETH reserve": >=3 rows per reserve across DISTINCT anchors, each exact at
// its own anchor.
const adapterRowsPerReserve = 3

func aaveParamWeldFrame() *gateFrame {
	return newGateFrame(gateAaveParamWeld,
		derived("param_history(engine=aave_param, chain=1) ledger prefix <= P_eth, folded by riskfeed.FoldParams",
			"A: the event-derived param set from PoolConfigurator custody — the TESTED side"),
		derived("param_history ReserveInitialized membership <= P_eth",
			"A's reserve SET: which reserves our custody believes exist"),
		pinned("Pool.getConfiguration(asset)@pinHash(P_eth) bit-decoded (LTV 0-15, LT 16-31, bonus 32-47)",
			"B: independent chain testimony, and the EXPECTED side of the weld (chain-truth R5)"),
		pinned("Pool.getReservesList()@pinHash(P_eth)",
			"B's reserve SET — the chain enumeration every coverage floor counts against, never our registry"),
	)
}

func dmParamWeldFrame() *gateFrame {
	return newGateFrame(gateDMParamWeld,
		derived("position_events(event_type=collateral_token_config_set) ledger prefix <= P_op, folded by riskfeed.FoldParams",
			"A: the event-derived DM param set (HUNDRED_PERCENT-denominated) — the TESTED side"),
		pinned("DebtManager.collateralTokenConfig(token)@pinHash(P_op)",
			"B: the struct the engine's own getMaxBorrowAmount reads. One wrong threshold is a wrong boolean for the token's whole cohort (risk-quant R4.4)"),
		pinned("DebtManager.getCollateralTokens()@pinHash(P_op) ∪ getBorrowTokens()@pinHash(P_op)",
			"B's token SET — the chain enumeration the coverage floor counts against"),
	)
}

func registryGateFrame() *gateFrame {
	return newGateFrame(gateRegistry,
		pinned("Pool.getReservesList()@pinHash(P_eth)",
			"B for the ETH side: the chain's reserve list at the pin"),
		pinned("DebtManager.getCollateralTokens()@pinHash(P_op) ∪ getBorrowTokens()@pinHash(P_op)",
			"B for the OP side, INCLUDING the role split (collateral vs borrow) the role-level equality leg needs"),
		pinned("PriceProviderV2.price(token)@pinHash(P_op) vs DebtManager.convertCollateralTokenToUsd(token,10^dec)@pinHash(P_op)",
			"the provider-identity weld: it proves the address recon/feeds.json CLAIMS is the provider the Debt Manager actually charges against at the pin, rather than assuming it"),
		committed("recon/feeds.json asset set, roles, decimals, oracle addresses",
			"C: the CLAIM. Judged against B in BOTH directions with the direction classified; never a witness"),
	)
}

func adapterWeldFrame() *gateFrame {
	return newGateFrame(gateAaveAdapterWeld,
		derived("prices(owner_engine=prices:poll:1, source=aaveoracle:*).price with its own anchor_block",
			"the stored adapter-output sample — the TESTED side. This is the row riskd values Aave collateral from, so it is the row that must be true"),
		derived("price_poll_anchors.block_hash for the row's own anchor_block",
			"the row's OWN pin. chain-truth R1: the weld re-reads at THIS hash, never at the run pin"),
		pinned("AaveOracle.getAssetPrice(asset)@pinHash(row's own anchor_block)",
			"the chain side, EIP-1898 at the stored anchor hash — the expected side"),
	)
}

// runAaveParamWeld welds A against B on the ETH side and asserts set equality
// against the chain enumeration.
func runAaveParamWeld(ctx context.Context, c *p3Ctx) ([]p3Row, error) {
	f := c.frames.add(aaveParamWeldFrame())
	var rows []p3Row

	rlData, err := poolReservesListABI.Pack("getReservesList")
	if err != nil {
		return nil, err
	}
	rlRet, _, err := c.ethR.callAtHash(ctx, "p3:paramweld:getReservesList", c.aavePool, rlData, c.hashETH)
	if err != nil {
		return nil, aavePhaseErr(err)
	}
	f.use("Pool.getReservesList()@pinHash(P_eth)")
	chainReserves, err := unpackAddressListStrict(poolReservesListABI, "getReservesList", rlRet)
	if err != nil {
		return nil, err
	}
	chainSet := map[common.Address]bool{}
	for _, r := range chainReserves {
		chainSet[r] = true
	}

	// A's reserve set: every reserve our param ledger has ever initialised.
	derivedSet := map[common.Address]bool{}
	for _, p := range c.t6.AaveParams {
		derivedSet[common.BytesToAddress(p.Asset)] = true
	}
	f.use("param_history ReserveInitialized membership <= P_eth")

	// SET EQUALITY, both directions, chain expected. A governance-added reserve
	// must fail this gate even when our file and our DB agree with each other
	// (risk-quant R5-2).
	all := map[common.Address]bool{}
	for a := range chainSet {
		all[a] = true
	}
	for a := range derivedSet {
		all[a] = true
	}
	for _, a := range sortedAddrs(all) {
		switch {
		case chainSet[a] && !derivedSet[a]:
			rows = append(rows, p3Row{
				Gate: gateAaveParamWeld, Subject: a.Hex(), Leg: "reserve-set(A vs B)",
				Verdict: verdictOnlyInChain, Gated: true, Class: verdictOnlyInChain,
				Note: "getReservesList names a reserve our param custody has no ReserveInitialized row for: the configurator stream missed it, or its topic0 was ruled non-param. Params cannot be served for this reserve",
			})
		case derivedSet[a] && !chainSet[a]:
			rows = append(rows, p3Row{
				Gate: gateAaveParamWeld, Subject: a.Hex(), Leg: "reserve-set(A vs B)",
				Verdict: verdictOnlyInRegistry, Gated: true, Class: "only-in-custody",
				Note: "our param custody carries a reserve the Pool does not list at the pin (a dropped reserve, or a mis-decoded asset field). Recorded in the only-in-derived direction",
			})
		default:
			rows = append(rows, exactRow(gateAaveParamWeld, a.Hex(), "reserve-set(A vs B)", "listed", "initialised"))
		}
	}

	// Per-member field equality: A's fold vs B's bit-decode.
	folded, err := riskfeed.FoldParams(snapshotdb.AaveParamEngine, 1, c.t6.AaveParams)
	if err != nil {
		return rows, fmt.Errorf("fold aave param ledger: %w", err)
	}
	f.use("param_history(engine=aave_param, chain=1) ledger prefix <= P_eth, folded by riskfeed.FoldParams")
	byAsset, err := riskfeed.ParamsByAsset(folded)
	if err != nil {
		return rows, fmt.Errorf("index aave params: %w", err)
	}

	var calls []multicallCall
	for _, r := range chainReserves {
		d, err := poolGetConfigurationABI.Pack("getConfiguration", r)
		if err != nil {
			return rows, err
		}
		calls = append(calls, multicallCall{Target: c.aavePool, CallData: d})
	}
	res, _, err := c.ethR.multicall(ctx, "p3:paramweld:getConfiguration", c.pinETH, c.hashETH, calls)
	if err != nil {
		return rows, aavePhaseErr(err)
	}
	for i, r := range chainReserves {
		subject := r.Hex()
		if !res[i].Success {
			rows = append(rows, unreadRow(gateAaveParamWeld, subject, "getConfiguration", "reverted at the pin"))
			continue
		}
		packed, err := unpackPackedUint256Struct(poolGetConfigurationABI, "getConfiguration", res[i].ReturnData)
		if err != nil {
			rows = append(rows, unreadRow(gateAaveParamWeld, subject, "getConfiguration", err.Error()))
			continue
		}
		cfg := decodeAaveReserveConfig(packed)
		f.use("Pool.getConfiguration(asset)@pinHash(P_eth) bit-decoded (LTV 0-15, LT 16-31, bonus 32-47)")
		ours, ok := byAsset[r]
		if !ok {
			rows = append(rows, driftRow(gateAaveParamWeld, subject, "params(A vs B)",
				fmt.Sprintf("ltv=%s lt=%s bonus=%s", cfg.LTVBps, cfg.LiquidationThresholdBps, cfg.LiquidationBonusBps),
				"(no folded param row)", "missing-derived-params",
				"the chain configures this reserve and our fold produced no effective param row for it. Serving a health factor for it would use a threshold we do not have"))
			continue
		}
		for _, leg := range []struct {
			name  string
			chain *big.Int
			ours  *big.Int
		}{
			{"ltv(bps)", cfg.LTVBps, ours.LTV},
			{"liquidationThreshold(bps)", cfg.LiquidationThresholdBps, ours.LiqThreshold},
			{"liquidationBonus(bps)", cfg.LiquidationBonusBps, ours.LiqBonus},
		} {
			if leg.ours == nil {
				// The chain's zero and "our ledger never spoke to this field" are
				// different facts. A zero on BOTH sides is agreement; a nonzero
				// chain value against a nil fold is a missing param.
				if leg.chain.Sign() == 0 {
					rows = append(rows, exactRow(gateAaveParamWeld, subject, leg.name, "0", "0 (no event spoke to this field; the reserve was never given a nonzero value)"))
					continue
				}
				rows = append(rows, driftRow(gateAaveParamWeld, subject, leg.name, leg.chain.String(), "(nil: no event spoke to this field)",
					"missing-derived-field",
					"the chain carries a nonzero value and our per-field fold has none: nil means 'no event spoke to this field', never zero, so this is a custody gap rather than a value disagreement"))
				continue
			}
			rows = append(rows, compareExact(gateAaveParamWeld, subject, leg.name, leg.chain, leg.ours, "param-field"))
		}
	}
	return rows, nil
}

// runDMParamWeld welds A against B on the OP side.
func runDMParamWeld(ctx context.Context, c *p3Ctx, universe []common.Address) ([]p3Row, error) {
	f := c.frames.add(dmParamWeldFrame())
	var rows []p3Row
	if len(universe) == 0 {
		rows = append(rows, unreadRow(gateDMParamWeld, c.dmProxy.Hex(), "token-universe",
			"the chain token enumeration did not read at the pin, so the weld has no universe to cover"))
		return rows, nil
	}
	f.use("DebtManager.getCollateralTokens()@pinHash(P_op) ∪ getBorrowTokens()@pinHash(P_op)")

	folded, err := riskfeed.FoldParams(dmEngine, 10, c.t6.DMParams)
	if err != nil {
		return rows, fmt.Errorf("fold dm param ledger: %w", err)
	}
	f.use("position_events(event_type=collateral_token_config_set) ledger prefix <= P_op, folded by riskfeed.FoldParams")
	byAsset, err := riskfeed.ParamsByAsset(folded)
	if err != nil {
		return rows, fmt.Errorf("index dm params: %w", err)
	}

	var calls []multicallCall
	for _, t := range universe {
		d, err := dmCollateralTokenConfigABI.Pack("collateralTokenConfig", t)
		if err != nil {
			return rows, err
		}
		calls = append(calls, multicallCall{Target: c.dmProxy, CallData: d})
	}
	res, _, err := c.opR.multicall(ctx, "p3:dm:collateralTokenConfig", c.pinOP, c.hashOP, calls)
	if err != nil {
		return rows, dmPhaseErr(err)
	}
	for i, t := range universe {
		subject := t.Hex()
		if !res[i].Success {
			rows = append(rows, unreadRow(gateDMParamWeld, subject, "collateralTokenConfig", "reverted at the pin"))
			continue
		}
		cfg, err := unpackCollateralTokenConfig(res[i].ReturnData)
		if err != nil {
			rows = append(rows, unreadRow(gateDMParamWeld, subject, "collateralTokenConfig", err.Error()))
			continue
		}
		f.use("DebtManager.collateralTokenConfig(token)@pinHash(P_op)")
		ours, ok := byAsset[t]
		if !ok {
			// A borrow-ONLY token legitimately has an all-zero collateral config
			// and no collateral_token_config_set event. Zero on both sides is
			// agreement; a nonzero chain config with no derived row is a gap.
			if cfg.LTV.Sign() == 0 && cfg.LiquidationThreshold.Sign() == 0 && cfg.LiquidationBonus.Sign() == 0 {
				rows = append(rows, exactRow(gateDMParamWeld, subject, "collateralTokenConfig(A vs B)",
					"all zero (not configured as collateral)", "no collateral_token_config_set event"))
				continue
			}
			rows = append(rows, driftRow(gateDMParamWeld, subject, "collateralTokenConfig(A vs B)",
				fmt.Sprintf("ltv=%s lt=%s bonus=%s", cfg.LTV, cfg.LiquidationThreshold, cfg.LiquidationBonus),
				"(no derived config row)", "missing-derived-params",
				"the chain carries a nonzero collateral config and our DM event custody has none: getMaxBorrowAmount would use a threshold we do not hold, which is a wrong boolean for every account holding this token"))
			continue
		}
		for _, leg := range []struct {
			name  string
			chain *big.Int
			ours  *big.Int
		}{
			{"ltv(100e18)", cfg.LTV, ours.LTV},
			{"liquidationThreshold(100e18)", cfg.LiquidationThreshold, ours.LiqThreshold},
			{"liquidationBonus(100e18)", cfg.LiquidationBonus, ours.LiqBonus},
		} {
			if leg.ours == nil {
				rows = append(rows, driftRow(gateDMParamWeld, subject, leg.name, leg.chain.String(),
					"(nil: no event spoke to this field)", "missing-derived-field",
					"nil means 'no event spoke to this field', never zero"))
				continue
			}
			rows = append(rows, compareExact(gateDMParamWeld, subject, leg.name, leg.chain, leg.ours, "param-field"))
		}
	}
	return rows, nil
}

// runRegistryGate judges recon/feeds.json (C) against the chain enumerations
// (B), both directions, role-level included, plus the provider-identity weld.
func runRegistryGate(ctx context.Context, c *p3Ctx, dmUniverse, dmBorrow []common.Address, dmDecimals map[common.Address]uint8, dmPrices map[common.Address]*big.Int) ([]p3Row, error) {
	f := c.frames.add(registryGateFrame())
	var rows []p3Row
	f.use("recon/feeds.json asset set, roles, decimals, oracle addresses")

	// --- ETH side -----------------------------------------------------------
	rlData, err := poolReservesListABI.Pack("getReservesList")
	if err != nil {
		return nil, err
	}
	rlRet, _, err := c.ethR.callAtHash(ctx, "p3:registry:getReservesList", c.aavePool, rlData, c.hashETH)
	if err != nil {
		return nil, aavePhaseErr(err)
	}
	f.use("Pool.getReservesList()@pinHash(P_eth)")
	chainReserves, err := unpackAddressListStrict(poolReservesListABI, "getReservesList", rlRet)
	if err != nil {
		return nil, err
	}
	ethSet := map[common.Address]bool{}
	for _, r := range chainReserves {
		ethSet[r] = true
	}
	rows = append(rows, registrySetGate(gateRegistry, "eth:", ethSet, c.reg.Aave, nil)...)

	// --- OP side, WITH role-level equality ----------------------------------
	if len(dmUniverse) > 0 {
		f.use("DebtManager.getCollateralTokens()@pinHash(P_op) ∪ getBorrowTokens()@pinHash(P_op)")
		opSet := map[common.Address]bool{}
		for _, t := range dmUniverse {
			opSet[t] = true
		}
		borrowSet := map[common.Address]bool{}
		for _, t := range dmBorrow {
			borrowSet[t] = true
		}
		chainRoles := map[common.Address]map[string]bool{}
		for _, t := range dmUniverse {
			roles := map[string]bool{}
			// A token in the union that is not in the borrow list is
			// collateral-only ON CHAIN; one in both carries both roles.
			if borrowSet[t] {
				roles["debt"] = true
			}
			if dmPrices[t] != nil || !borrowSet[t] {
				// convertCollateralTokenToUsd only answers for a collateral
				// token (it reverts otherwise), so a successful price read is
				// the chain's own statement that the token is collateral.
				roles["collateral"] = true
			}
			chainRoles[t] = roles
		}
		rows = append(rows, registrySetGate(gateRegistry, "op:", opSet, c.reg.DM, chainRoles)...)
	} else {
		rows = append(rows, unreadRow(gateRegistry, "op:token-universe", "set-membership",
			"the chain token enumeration did not read at the pin, so the registry has nothing to be judged against — and judging it against itself is exactly what this gate refuses"))
	}

	// --- provider identity: the CLAIM welded, not assumed -------------------
	if len(dmUniverse) > 0 {
		var probe common.Address
		for _, t := range dmUniverse {
			if dmPrices[t] != nil && dmDecimals[t] > 0 {
				probe = t
				break
			}
		}
		if probe == (common.Address{}) {
			rows = append(rows, unreadRow(gateRegistry, c.reg.DMProvider.Hex(), "provider-identity",
				"no collateral token had both a decoded decimals and a decoded engine-exact price, so the provider-identity weld has no probe subject"))
		} else {
			d, err := priceProviderPriceABI.Pack("price", probe)
			if err != nil {
				return rows, err
			}
			ret, _, err := c.opR.callAtHash(ctx, "p3:registry:providerPrice", c.reg.DMProvider, d, c.hashOP)
			if err != nil {
				rows = append(rows, unreadRow(gateRegistry, c.reg.DMProvider.Hex(), "provider-identity",
					"the claimed provider address did not answer price() at the pin: "+err.Error()))
			} else if v, uerr := unpackUint256Strict(priceProviderPriceABI, "price", ret); uerr != nil {
				rows = append(rows, unreadRow(gateRegistry, c.reg.DMProvider.Hex(), "provider-identity", uerr.Error()))
			} else {
				f.use("PriceProviderV2.price(token)@pinHash(P_op) vs DebtManager.convertCollateralTokenToUsd(token,10^dec)@pinHash(P_op)")
				rows = append(rows, compareExact(gateRegistry,
					c.reg.DMProvider.Hex()+" via "+probe.Hex(), "provider-identity(claimed vs engine-charged)",
					dmPrices[probe], v, "provider-address-claim"))
			}
		}
	}
	return rows, nil
}

// runAdapterOutputWeld re-reads each sampled adapter-output row at ITS OWN
// stored anchor hash.
func runAdapterOutputWeld(ctx context.Context, c *p3Ctx) ([]p3Row, error) {
	f := c.frames.add(adapterWeldFrame())
	var rows []p3Row
	perAsset := map[string]int{}
	exactPerAsset := map[string]int{}
	f.use("prices(owner_engine=prices:poll:1, source=aaveoracle:*).price with its own anchor_block")

	for _, r := range c.t6.AdapterRows {
		asset := common.HexToAddress(r.AssetHex)
		subject := fmt.Sprintf("%s@anchor %d", asset.Hex(), r.AnchorBlock)
		perAsset[r.AssetHex]++
		if !r.HasAnchor {
			// chain-truth R1: an unserveable/unknown anchor hash is a loud
			// weld-unread. NEVER re-pin to a number — that would judge one
			// witness across two different states.
			rows = append(rows, unreadRow(gateAaveAdapterWeld, subject, "anchor-hash",
				"no price_poll_anchors row carries a block_hash for this row's own anchor_block, and re-pinning to the anchor NUMBER is banned (chain-truth R1): the pin must be the hash custody witnessed"))
			continue
		}
		f.use("price_poll_anchors.block_hash for the row's own anchor_block")
		d, err := aaveOracleGetAssetPriceABI.Pack("getAssetPrice", asset)
		if err != nil {
			return rows, err
		}
		ret, _, err := c.ethR.callAtHash(ctx,
			fmt.Sprintf("p3:adapter:getAssetPrice(%s@%d)", asset.Hex(), r.AnchorBlock),
			c.reg.AaveOracle, d, common.HexToHash(r.AnchorHash))
		if err != nil {
			rows = append(rows, unreadRow(gateAaveAdapterWeld, subject, "getAssetPrice@own-anchor-hash",
				"the stored anchor hash is unserveable: "+err.Error()))
			continue
		}
		chainPrice, err := unpackUint256Strict(aaveOracleGetAssetPriceABI, "getAssetPrice", ret)
		if err != nil {
			rows = append(rows, unreadRow(gateAaveAdapterWeld, subject, "getAssetPrice@own-anchor-hash", err.Error()))
			continue
		}
		f.use("AaveOracle.getAssetPrice(asset)@pinHash(row's own anchor_block)")
		row := compareExact(gateAaveAdapterWeld, subject, "adapter-output price", chainPrice, r.Price, "adapter-sample-drift")
		row.Evidence = map[string]string{
			"row_block":      fmt.Sprintf("%d", r.Block),
			"anchor_block":   fmt.Sprintf("%d", r.AnchorBlock),
			"anchor_hash":    r.AnchorHash,
			"price_decimals": fmt.Sprintf("%d", r.Decimals),
			"valid":          fmt.Sprintf("%v", r.Valid),
			"source_as_of":   r.SourceAsOf,
			"pin_law":        "EIP-1898 at the ROW'S OWN anchor hash, never the run pin (chain-truth R1)",
		}
		if row.Verdict == verdictExact {
			exactPerAsset[r.AssetHex]++
		}
		rows = append(rows, row)
	}

	// Coverage floor: >=3 distinct anchors per reserve, counted against the
	// ANCHOR POPULATION at the pin (a floor above the population would be a
	// custody hazard, chain-truth R5.1).
	assets := make([]string, 0, len(c.reg.Aave))
	for a := range c.reg.Aave {
		if c.reg.Aave[a].OracleKind == "poll" {
			assets = append(assets, hexLower(a.Hex()))
		}
	}
	for _, a := range sortedStrings(assets) {
		pop := int(c.t6.AdapterAnchorTotals[a])
		rows = append(rows, adapterAnchorFloorRow(a, perAsset[a], pop, exactPerAsset[a]))
	}
	return rows, nil
}

func sortedStrings(in []string) []string {
	out := append([]string{}, in...)
	for i := 1; i < len(out); i++ {
		for j := i; j > 0 && out[j] < out[j-1]; j-- {
			out[j], out[j-1] = out[j-1], out[j]
		}
	}
	return out
}

// adapterAnchorFloorRow decides ONE reserve's adapter-anchor floor.
//
// THE FLOOR STAYS THREE (Codex round 1, finding 10). It used to be lowered to the
// DB's own anchor population whenever that was smaller — the
// floor-follows-the-evidence shape, in which a reserve with a single anchor
// silently satisfied a "three distinct anchors" requirement. risk-quant R3 raised
// the plan's >=1 to >=3 deliberately, so insufficient history is a GATED floor
// miss whose remediation is to accumulate anchors, never to reduce the bar.
//
// It is a named function so the DECISION is unit-testable on its own: the
// round-1 defect lived at the call site, and a floor computed inline can only be
// tested through the whole gate.
func adapterAnchorFloorRow(assetHex string, got, anchorPopulation, exactSoFar int) p3Row {
	row := cohortFloorRow(gateAaveAdapterWeld, "adapter-rows:0x"+assetHex,
		got, adapterRowsPerReserve, adapterRowsPerReserve,
		fmt.Sprintf("risk-quant R3 strengthens the plan's >=1 row per reserve to >=%d rows across DISTINCT anchors, each exact at its own anchor. Distinct-anchor population at the pin: %d; exact so far: %d",
			adapterRowsPerReserve, anchorPopulation, exactSoFar))
	if anchorPopulation < adapterRowsPerReserve {
		row.Evidence = map[string]string{
			"distinct_anchor_population": fmt.Sprintf("%d", anchorPopulation),
			"required":                   fmt.Sprintf("%d", adapterRowsPerReserve),
			"why_not_lowered":            "lowering the requirement to the observed population would make the floor follow the evidence it exists to test: a reserve with one anchor would then satisfy a three-anchor rule",
			"remediation":                "let the adapter poller accumulate more anchors at or below the pin, or re-pin above them — never reduce the floor",
		}
	}
	return row
}
