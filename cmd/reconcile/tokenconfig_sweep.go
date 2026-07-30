// The REQUIRED PriceProviderV2.tokenConfig sweep (risk-quant R4, chain-truth
// R3).
//
// WHAT IT IS, SAID FIRST because the schema label is load-bearing: this is a
// SAMPLE, not ledger. PriceProviderV2 is NOT in the walker stream set, so its
// setTokenConfig-class mutations are not in custody. Every row is labeled
// input:pinned-read and stamped with (pin block, pin hash, provider address),
// and it carries NO continuity claim between runs. Calling it "the oracle
// composition" unqualified would be exactly the D-012 confusion the label
// exists to prevent — it is the composition the provider attested at ONE
// hash-pinned block.
//
// WHY IT IS REQUIRED: the defect class it closes was a COMPOSITION hidden one
// level down (liquidUSD = rate × snap(USDC)). Reading only the ~20 top-level
// configs leaves the same class open one level deeper, so the sweep follows
// baseAsset TRANSITIVELY, cycle-guarded, and records the full composition tree
// per token. The enumeration only closes the class if the enumeration actually
// closes.
package main

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"github.com/ethereum/go-ethereum/common"
)

// --- the scenario base-composition claim (Codex round 1, finding 9) ---------
//
// THE DEFECT THIS CLOSES: the sweep followed baseAsset transitively and printed
// the composition tree, but it never compared the OBSERVED mapping against the
// model's claim. risk-quant R4.2 is explicit that the base-composition EQUALITY is
// what closes the lens-composition class — the enumeration alone only proves the
// provider answered, not that our valuation composes the same way. Without the
// comparison, liquidUSD could silently stop being USDC-based and every downstream
// scenario would keep shocking the wrong axis.
//
// The expected mapping is LOADED FROM THE SCENARIO DEFINITIONS rather than
// restated here, so the weld's expected side and the model's actual behaviour
// cannot drift: internal/risk/scenarios/*.json is what ApplyScenario consumes.
//
//   - a propagation row with base_stable_snap ⇒ baseAsset MUST be the named
//     responds_to asset (liquidUSD → USDC: rate × snap(USDC), the exact defect
//     class the sweep exists for);
//   - a row with stable_snap ⇒ the token is priced in USD directly, so
//     baseAsset MUST be the ZERO address;
//   - every other DM asset the scenarios name ⇒ baseAsset MUST be ZERO
//     (USD-terminal). The expected-zero direction is asserted too, because a
//     token that quietly ACQUIRES a base is the same class in reverse.
type scenarioPropagation struct {
	Asset          string `json:"asset"`
	ChainID        uint64 `json:"chain_id"`
	Symbol         string `json:"symbol"`
	StableSnap     bool   `json:"stable_snap"`
	BaseStableSnap bool   `json:"base_stable_snap"`
	RespondsTo     []struct {
		Axis  string `json:"axis"`
		Asset string `json:"asset"`
	} `json:"responds_to"`
}

type scenarioFile struct {
	ID          string                `json:"id"`
	Propagation []scenarioPropagation `json:"propagation"`
}

// scenarioBaseClaim is one asset's expected composition, with the scenario that
// asserted it so a failure names its source.
type scenarioBaseClaim struct {
	Base        common.Address
	Stable      bool
	FromID      string
	Explanation string
}

// loadScenarioBaseClaims builds the canonical expected mapping. A CONFLICT between
// two scenarios is a precondition error, not a gate row: two different claims
// about one asset's composition cannot both be the model's behaviour.
func loadScenarioBaseClaims(dir string) (map[common.Address]scenarioBaseClaim, error) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil, fmt.Errorf("read scenario definitions at %s (the base-composition weld's EXPECTED side): %w", dir, err)
	}
	out := map[common.Address]scenarioBaseClaim{}
	for _, e := range entries {
		if e.IsDir() || !strings.HasSuffix(e.Name(), ".json") {
			continue
		}
		raw, err := os.ReadFile(filepath.Join(dir, e.Name()))
		if err != nil {
			return nil, fmt.Errorf("read scenario %s: %w", e.Name(), err)
		}
		var sf scenarioFile
		if err := json.Unmarshal(raw, &sf); err != nil {
			return nil, fmt.Errorf("parse scenario %s: %w", e.Name(), err)
		}
		for _, pr := range sf.Propagation {
			if pr.ChainID != 10 {
				continue // the provider swept here is the OP Debt Manager's
			}
			asset := common.HexToAddress(pr.Asset)
			claim := scenarioBaseClaim{FromID: sf.ID, Stable: pr.StableSnap}
			switch {
			case pr.BaseStableSnap:
				var named common.Address
				for _, r := range pr.RespondsTo {
					if r.Asset != "" {
						named = common.HexToAddress(r.Asset)
					}
				}
				if named == (common.Address{}) {
					return nil, fmt.Errorf("scenario %s: asset %s declares base_stable_snap with no responds_to asset, so the composition claim names no base", sf.ID, pr.Asset)
				}
				claim.Base = named
				claim.Explanation = "base_stable_snap: the model values this asset as rate x snap(base), so the provider must name that base"
			case pr.StableSnap:
				claim.Explanation = "stable_snap: the model snaps this asset's own price, so it must be USD-denominated (baseAsset = 0)"
			default:
				claim.Explanation = "no base claim in the scenario matrices, so the model values this asset directly in USD (baseAsset = 0)"
			}
			if prev, ok := out[asset]; ok {
				if prev.Base != claim.Base || prev.Stable != claim.Stable {
					return nil, fmt.Errorf("scenario definitions CONFLICT on %s: %s claims base %s (stable %v) and %s claims base %s (stable %v) — two different composition claims about one asset cannot both be the model's behaviour",
						pr.Asset, prev.FromID, prev.Base.Hex(), prev.Stable, claim.FromID, claim.Base.Hex(), claim.Stable)
				}
				continue
			}
			out[asset] = claim
		}
	}
	if len(out) == 0 {
		return nil, fmt.Errorf("scenario definitions at %s declare no OP propagation rows — the base-composition weld would be vacuous", dir)
	}
	return out, nil
}

// canonicalScenarioDir is where ApplyScenario's committed configs live.
const canonicalScenarioDir = "internal/risk/scenarios"

// dmStableSnapSet is the model's snap set — the assets internal/risk applies
// the stable 1e6 snap to. Stable-set equality is asserted in BOTH directions
// (risk-quant R4.1): an unexpected stable is a snap the model does not apply; a
// missing one is a snap it invents.
var dmStableSnapSet = []string{"USDC", "USDT", "frxUSD"}

// tokenConfigFrame declares the sweep's input frame. It declares NO
// derived-under-test source, and says why: frameNoDerivedJustified carries the
// reason, because a gate claiming to test derived state that does not is a false
// declaration.
func tokenConfigFrame() *gateFrame {
	return newGateFrame(gateTokenConfig,
		pinned("PriceProviderV2.tokenConfig(token)@pinHash(P_op) — FULL struct committed as evidence",
			"oracle, priceFunctionCalldata, isChainlinkType, oraclePriceDecimals, maxStaleness, dataType, isStableToken, baseAsset. A SAMPLE at one pin with no continuity claim (chain-truth R3.1)"),
		pinned("PriceProviderV2.tokenConfig(baseAsset)@pinHash(P_op), TRANSITIVELY and cycle-guarded",
			"the composition closure. Reading only top-level configs leaves the liquidUSD defect class open one level deeper (chain-truth R3.4)"),
		pinned("PriceProviderV2.isBaseAsset(token)@pinHash(P_op)",
			"whether each terminal node the chain names is actually registered as a base asset"),
		pinned("ERC20.decimals(token)@pinHash(P_op)",
			"the 10^dec valuation denominator, welded against the registry (risk-quant R4.5)"),
		pinned("DebtManager.getCollateralTokens()@pinHash(P_op) ∪ getBorrowTokens()@pinHash(P_op)",
			"the CHAIN universe that classifies a revert/zero as EXPECTED or as an anomaly (chain-truth R3.3)"),
		pinned("proxy code witness: PriceProviderV2 raw tokenConfig returndata digest @pinHash(P_op)",
			"the DISCLOSED SUBSTITUTE for chain-truth R3.2's eth_getStorageAt(EIP-1967 impl slot) read — see implWitnessDeviation"),
		committed("recon/feeds.json DM asset set, symbols, decimals, provider address",
			"the registry half of the swept union, and the stable-set / composition claims the invariants are judged against"),
		committed("internal/risk/scenarios/*.json propagation rows (stable_snap, base_stable_snap, responds_to)",
			"the MODEL's OWN claims, loaded from the files ApplyScenario consumes rather than restated here. R4.1/R4.2 make them chain-welded rather than author-asserted, and the base-composition EQUALITY is what closes the lens-composition class"),
	)
}

// implWitnessDeviation is the honest statement of the ONE chain-truth item this
// wave could not implement as specified, recorded in the artifact rather than
// quietly dropped.
const implWitnessDeviation = "DEVIATION (disclosed, not softened): chain-truth R3.2 asks for one eth_getStorageAt(provider, EIP-1967 impl slot)@pinHash recorded per run, so the artifact can distinguish 'config changed' from 'the decoder is now reading a different shape'. reconcile's chainReader surface (internal/chain.Failover) exposes headerHash / headerTime / callAtHash and NO storage read, and internal/chain is outside this wave's tree — so the read could not be added without touching another wave's path. SUBSTITUTE WITNESS, recorded here: a sha256 over the RAW tokenConfig returndata of every swept token, in token order, at the pin. It is strictly weaker (it changes when a config value changes, not only when the implementation does) but it is a real cross-run decoder-shape fingerprint, and combined with the strict unpacker's refusal to partially decode it detects the ABI-skew half of what the slot read was for. FOLLOW-UP for the integrator: add a StorageAtHash method to internal/chain.Failover and to reconcile's chainReader, then read the slot here."

// tokenConfigRow is one swept token's full evidence.
type tokenConfigRow struct {
	TokenHex      string   `json:"token"`
	Symbol        string   `json:"symbol,omitempty"`
	InChain       bool     `json:"in_chain_universe"`
	InRegistry    bool     `json:"in_registry"`
	Read          bool     `json:"read_ok"`
	ReadNote      string   `json:"read_note,omitempty"`
	Oracle        string   `json:"oracle,omitempty"`
	CalldataHex   string   `json:"price_function_calldata,omitempty"`
	IsChainlink   bool     `json:"is_chainlink_type"`
	OracleDec     uint8    `json:"oracle_price_decimals"`
	MaxStaleness  string   `json:"max_staleness,omitempty"`
	DataType      uint8    `json:"data_type"`
	IsStable      bool     `json:"is_stable_token"`
	BaseAsset     string   `json:"base_asset,omitempty"`
	IsBaseAsset   bool     `json:"is_base_asset"`
	Decimals      uint8    `json:"decimals,omitempty"`
	Composition   []string `json:"composition_tree"`
	RawReturnHash string   `json:"raw_returndata_sha256_prefix,omitempty"`
}

// runTokenConfigSweep sweeps the chain∪registry union, closes the baseAsset
// tree, and gates the invariants.
func runTokenConfigSweep(ctx context.Context, c *p3Ctx, chainUniverse []common.Address, decimals map[common.Address]uint8) ([]p3Row, []tokenConfigRow, error) {
	f := c.frames.add(tokenConfigFrame())
	var rows []p3Row
	f.use("recon/feeds.json DM asset set, symbols, decimals, provider address")
	f.use("internal/risk scenario snap set {USDC, USDT, frxUSD} and the base-composition claims")

	// The swept set is the UNION (chain-truth R3.3): sweeping only feeds.json
	// would be a silent cap, because a chain-configured token missing from our
	// registry is precisely what the sweep exists to expose.
	chainSet := map[common.Address]bool{}
	for _, t := range chainUniverse {
		chainSet[t] = true
	}
	if len(chainUniverse) > 0 {
		f.use("DebtManager.getCollateralTokens()@pinHash(P_op) ∪ getBorrowTokens()@pinHash(P_op)")
	}
	union := map[common.Address]bool{}
	for t := range chainSet {
		union[t] = true
	}
	for t := range c.reg.DM {
		union[t] = true
	}

	configs := map[common.Address]tokenConfigResult{}
	notes := map[common.Address]string{}
	rawByToken := map[common.Address][]byte{}
	// baseFlags is LOCAL, deliberately: a package-level map would make two
	// runs in one process share state, and the sweep is meant to describe ONE
	// pin.
	baseFlags := map[common.Address]bool{}

	// Sweep in WAVES so the transitive closure terminates: wave 0 is the union,
	// each later wave is the previously-unseen baseAssets. maxDepth is a hard
	// cycle guard — "chaining base assets is not supported" per the contract's
	// own doc, so depth > 2 is itself a finding.
	const maxDepth = 8
	pending := sortedAddrs(union)
	seen := map[common.Address]bool{}
	depth := 0
	for len(pending) > 0 && depth < maxDepth {
		var calls []multicallCall
		type tag struct {
			kind string
			tok  common.Address
		}
		var tags []tag
		for _, t := range pending {
			seen[t] = true
			d, err := priceProviderTokenConfigABI.Pack("tokenConfig", t)
			if err != nil {
				return nil, nil, err
			}
			calls, tags = append(calls, multicallCall{Target: c.reg.DMProvider, CallData: d}), append(tags, tag{"config", t})
			if d, err = priceProviderIsBaseAssetABI.Pack("isBaseAsset", t); err != nil {
				return nil, nil, err
			}
			calls, tags = append(calls, multicallCall{Target: c.reg.DMProvider, CallData: d}), append(tags, tag{"isBase", t})
		}
		res, _, err := c.opR.multicall(ctx, fmt.Sprintf("p3:tokenConfig[depth %d]", depth), c.pinOP, c.hashOP, calls)
		if err != nil {
			return nil, nil, dmPhaseErr(err)
		}
		isBase := map[common.Address]bool{}
		var next []common.Address
		for i, tg := range tags {
			switch tg.kind {
			case "config":
				if !res[i].Success {
					notes[tg.tok] = "tokenConfig unsuccessful (reverted) at the pin"
					continue
				}
				cfg, err := unpackTokenConfig(res[i].ReturnData)
				if err != nil {
					// ABI skew -> weld-unread, NEVER a partial decode (the
					// buildDMWeldReads pattern applied to the sweep).
					notes[tg.tok] = err.Error()
					continue
				}
				configs[tg.tok] = cfg
				rawByToken[tg.tok] = res[i].ReturnData
				if cfg.BaseAsset != (common.Address{}) && !seen[cfg.BaseAsset] {
					next = append(next, cfg.BaseAsset)
				}
			case "isBase":
				if !res[i].Success {
					continue
				}
				v, err := unpackBoolStrict(priceProviderIsBaseAssetABI, "isBaseAsset", res[i].ReturnData)
				if err != nil {
					continue
				}
				isBase[tg.tok] = v
			}
		}
		f.use("PriceProviderV2.tokenConfig(token)@pinHash(P_op) — FULL struct committed as evidence")
		f.use("PriceProviderV2.isBaseAsset(token)@pinHash(P_op)")
		if depth > 0 {
			f.use("PriceProviderV2.tokenConfig(baseAsset)@pinHash(P_op), TRANSITIVELY and cycle-guarded")
		}
		for t, v := range isBase {
			baseFlags[t] = v
		}
		pending = sortedAddrs(addrSet(next))
		depth++
	}
	if depth >= maxDepth {
		rows = append(rows, p3Row{
			Gate: gateTokenConfig, Subject: "composition-closure", Leg: "cycle-guard",
			Verdict: verdictDrift, Gated: true, Class: "closure-did-not-terminate",
			Note: fmt.Sprintf("the baseAsset closure did not terminate within %d waves. PriceProviderV2's own documentation states 'chaining base assets is not supported', so a chain this deep is a finding about the deployed configuration, not a sweep parameter to raise", maxDepth),
		})
	}

	// Decimals for every swept token (the closure may add tokens the DM
	// universe pass never read).
	var decCalls []multicallCall
	var decTokens []common.Address
	for _, t := range sortedAddrs(addrSetFromMap(seen)) {
		if _, ok := decimals[t]; ok {
			continue
		}
		d, err := erc20DecimalsABI.Pack("decimals")
		if err != nil {
			return nil, nil, err
		}
		decCalls, decTokens = append(decCalls, multicallCall{Target: t, CallData: d}), append(decTokens, t)
	}
	if len(decCalls) > 0 {
		res, _, err := c.opR.multicall(ctx, "p3:tokenConfig:decimals", c.pinOP, c.hashOP, decCalls)
		if err != nil {
			return nil, nil, dmPhaseErr(err)
		}
		for i, t := range decTokens {
			if !res[i].Success {
				continue
			}
			if v, err := unpackUint8Strict(erc20DecimalsABI, "decimals", res[i].ReturnData); err == nil {
				decimals[t] = v
			}
		}
	}
	f.use("ERC20.decimals(token)@pinHash(P_op)")

	// ---- per-token evidence rows + universe-membership classification -------
	var evidence []tokenConfigRow
	for _, t := range sortedAddrs(addrSetFromMap(seen)) {
		reg := c.reg.DM[t]
		row := tokenConfigRow{
			TokenHex:    t.Hex(),
			InChain:     chainSet[t],
			InRegistry:  reg != nil,
			IsBaseAsset: baseFlags[t],
			Decimals:    decimals[t],
		}
		if reg != nil {
			row.Symbol = reg.Symbol
		}
		cfg, ok := configs[t]
		if !ok {
			row.ReadNote = notes[t]
			if row.ReadNote == "" {
				row.ReadNote = "no tokenConfig read was recorded"
			}
			// chain-truth R3.3: classify by the CHAIN's own universe FIRST.
			if chainSet[t] {
				rows = append(rows, unreadRow(gateTokenConfig, t.Hex(), "tokenConfig",
					"the token IS in the chain's collateral/borrow universe at the pin and its config did not read: "+row.ReadNote))
			} else {
				rows = append(rows, p3Row{
					Gate: gateTokenConfig, Subject: t.Hex(), Leg: "tokenConfig(registry-only)",
					Expected: "revert-or-zero (EXPECTED: not in the chain universe at the pin)",
					Actual:   row.ReadNote, Verdict: verdictExact, Gated: true,
					Note: "a registry-only token's revert/zero is the EXPECTED outcome (chain-truth R3.3). The anomaly in this direction is a SUCCESSFUL config read, which would contradict the delisting",
				})
			}
			row.Composition = []string{"(unread)"}
			evidence = append(evidence, row)
			continue
		}
		row.Read = true
		row.Oracle = cfg.Oracle.Hex()
		row.CalldataHex = "0x" + hex.EncodeToString(cfg.PriceFunctionCalldata)
		row.IsChainlink = cfg.IsChainlinkType
		row.OracleDec = cfg.OraclePriceDecimals
		row.MaxStaleness = cfg.MaxStaleness.String()
		row.DataType = cfg.DataType
		row.IsStable = cfg.IsStableToken
		if cfg.BaseAsset != (common.Address{}) {
			row.BaseAsset = cfg.BaseAsset.Hex()
		}
		row.Composition = compositionTree(t, configs, c.reg)
		if raw := rawByToken[t]; len(raw) > 0 {
			row.RawReturnHash = rawDigestPrefix(raw)
		}

		// A zeroed struct is the FACT "unconfigured", never a config whose
		// oracle is the zero address (chain-truth R3.3).
		if cfg.Oracle == (common.Address{}) {
			if chainSet[t] {
				rows = append(rows, driftRow(gateTokenConfig, t.Hex(), "tokenConfig.oracle",
					"a configured oracle (the token is in the chain's collateral/borrow universe at the pin)",
					"0x0 — UNCONFIGURED", "unconfigured-in-universe",
					"the struct read back all-zero: that is the fact 'unconfigured', never a config whose oracle happens to be the zero address. A token the engine will price with no oracle configured is a revert waiting for a liquidation"))
			} else {
				rows = append(rows, p3Row{
					Gate: gateTokenConfig, Subject: t.Hex(), Leg: "tokenConfig(registry-only)",
					Expected: "revert-or-zero (EXPECTED: not in the chain universe)", Actual: "zeroed struct",
					Verdict: verdictExact, Gated: true,
					Note: "recorded as the fact 'unconfigured' rather than decoded as a config",
				})
			}
			evidence = append(evidence, row)
			continue
		}
		if !chainSet[t] && reg != nil {
			// The REVERSE direction R3.3 demands: a successful config read for a
			// token the chain does not configure.
			rows = append(rows, p3Row{
				Gate: gateTokenConfig, Subject: t.Hex(), Leg: "tokenConfig(registry-only)",
				Expected: "revert-or-zero (not in the chain universe at the pin)",
				Actual:   "SUCCESSFUL config read, oracle " + row.Oracle,
				Verdict:  verdictAnomaly, Gated: true, Class: verdictAnomaly,
				Note: "a configured price for a token the chain has delisted from its collateral/borrow universe. Recorded as an anomaly: it CONTRADICTS the delisting, and both directions are asserted (chain-truth R3.3)",
			})
		}

		// R4.5: decimals welded against the registry.
		if reg != nil && decimals[t] > 0 {
			rows = append(rows, compareExact(gateTokenConfig, t.Hex(), "decimals(chain vs registry)",
				bigFromUint(uint64(decimals[t])), bigFromUint(uint64(reg.Decimals)), "decimals-mismatch"))
		}
		evidence = append(evidence, row)
	}

	// ---- R4.1 stable-set equality, BOTH directions -------------------------
	chainStable := map[string]bool{}
	for t, cfg := range configs {
		if cfg.IsStableToken {
			sym := "0x" + hexLower(t.Hex())
			if reg := c.reg.DM[t]; reg != nil {
				sym = reg.Symbol
			}
			chainStable[sym] = true
		}
	}
	modelStable := map[string]bool{}
	for _, s := range dmStableSnapSet {
		modelStable[s] = true
	}
	for _, s := range unionKeys(chainStable, modelStable) {
		switch {
		case chainStable[s] && !modelStable[s]:
			rows = append(rows, p3Row{
				Gate: gateTokenConfig, Subject: "stable-set:" + s, Leg: "isStableToken",
				Expected: "isStableToken=true on chain", Actual: "NOT in the model's snap set",
				Verdict: verdictDrift, Gated: true, Class: "unexpected-stable",
				Note: "an unexpected stable is a snap the model does not apply: the engine snaps this token's price to 1e6 and our valuation does not (risk-quant R4.1)",
			})
		case modelStable[s] && !chainStable[s]:
			rows = append(rows, p3Row{
				Gate: gateTokenConfig, Subject: "stable-set:" + s, Leg: "isStableToken",
				Expected: "isStableToken=true on chain (the model applies the snap)", Actual: "false or absent on chain",
				Verdict: verdictDrift, Gated: true, Class: "missing-stable",
				Note: "a missing stable is a snap the model INVENTS: we would snap a price the engine does not (risk-quant R4.1)",
			})
		default:
			rows = append(rows, exactRow(gateTokenConfig, "stable-set:"+s, "isStableToken", "true", "true"))
		}
	}

	// ---- R4.2 base-composition EQUALITY vs the scenario claims -------------
	claims, cerr := loadScenarioBaseClaims(c.scenarioDir())
	if cerr != nil {
		rows = append(rows, p3Row{
			Gate: gateTokenConfig, Subject: "scenario-base-claims", Leg: "expected mapping",
			Expected: "a loadable, conflict-free expected asset->base mapping from the scenario definitions",
			Actual:   cerr.Error(),
			Verdict:  verdictWeldUnread, Gated: true, Class: "scenario-claims-unreadable",
			Note: "without the model's own claims there is no expected side for the base-composition weld, and printing the observed tree alone is exactly the enumeration-without-comparison the round-1 finding named",
		})
	} else {
		f.use("internal/risk/scenarios/*.json propagation rows (stable_snap, base_stable_snap, responds_to)")
		claimed := map[common.Address]bool{}
		for a := range claims {
			claimed[a] = true
		}
		observed := map[common.Address]bool{}
		for t := range configs {
			observed[t] = true
		}
		for _, t := range sortedAddrs(unionAddrSets(claimed, observed)) {
			claim, hasClaim := claims[t]
			cfg, hasCfg := configs[t]
			label := t.Hex()
			if reg := c.reg.DM[t]; reg != nil {
				label = reg.Symbol + " " + t.Hex()
			}
			switch {
			case hasClaim && !hasCfg:
				// A model claim about a token the provider does not configure. If the
				// chain universe does not carry it either, the claim is stale rather
				// than a chain disagreement — still gated, with the direction named.
				rows = append(rows, p3Row{
					Gate: gateTokenConfig, Subject: label, Leg: "base-composition(model vs chain)",
					Expected: "a readable tokenConfig for an asset the scenario matrices make claims about",
					Actual:   "no readable config at the pin",
					Verdict:  verdictOnlyInRegistry, Gated: true, Class: "scenario-claims-unconfigured-asset",
					Note: "the model shocks this asset's composition but the provider has no config for it at the pin, so the scenario would apply a transform the engine cannot price (claim from " + claim.FromID + ")",
				})
			case hasCfg && !hasClaim:
				rows = append(rows, p3Row{
					Gate: gateTokenConfig, Subject: label, Leg: "base-composition(model vs chain)",
					Expected: "a scenario propagation row for every configured DM asset",
					Actual:   "configured on chain, but NO scenario claim",
					Verdict:  verdictOnlyInChain, Gated: true, Class: "scenario-missing-claim",
					Note: "the provider prices this asset and no scenario names it, so a stress run would hold it FLAT by omission — oracle-sentinel R4's named failure ('the waterfall silently holds a chunk of TVL at pre-shock prices')",
				})
			default:
				row := compareExact(gateTokenConfig, label, "base-composition: tokenConfig.baseAsset == the scenario claim",
					addrStringer(cfg.BaseAsset), addrStringer(claim.Base), "base-composition-difference")
				row.Note = claim.Explanation + ". " + row.Note
				row.Evidence = map[string]string{
					"claim_from_scenario": claim.FromID,
					"expected_base":       baseLabel(claim.Base),
					"observed_base":       baseLabel(cfg.BaseAsset),
					"law":                 "risk-quant R4.2: the base-composition equality IS the lens-composition class closure; the enumeration alone only proves the provider answered",
				}
				rows = append(rows, row)
				// The stable flag travels with the claim, both directions.
				rows = append(rows, compareExact(gateTokenConfig, label, "base-composition: isStableToken == the scenario claim",
					boolStringer(cfg.IsStableToken), boolStringer(claim.Stable), "scenario-stable-flag-difference"))
			}
		}
	}

	// ---- R4.3 scenario-flag invariants, mechanical ------------------------
	// For every token whose config names a baseAsset, that baseAsset must
	// itself be configured; and a base-stable-snap composition requires the
	// BASE to be the stable one. Cheap, and it makes the scenario schema
	// chain-welded rather than author-asserted.
	for _, t := range sortedAddrs(addrSetFromMap(seen)) {
		cfg, ok := configs[t]
		if !ok || cfg.BaseAsset == (common.Address{}) {
			continue
		}
		baseCfg, baseOK := configs[cfg.BaseAsset]
		subject := t.Hex() + " -> base " + cfg.BaseAsset.Hex()
		if !baseOK || baseCfg.Oracle == (common.Address{}) {
			rows = append(rows, driftRow(gateTokenConfig, subject, "base-composition-closure",
				"the named baseAsset carries its own configured oracle",
				"the baseAsset has NO readable config", "dangling-base-asset",
				"a token priced in terms of a baseAsset whose own config is unreadable has no complete composition: the second leg of rate x base(price) is missing, which is the liquidUSD defect class one level down (chain-truth R3.4)"))
			continue
		}
		rows = append(rows, exactRow(gateTokenConfig, subject, "base-composition-closure",
			"baseAsset configured (oracle "+baseCfg.Oracle.Hex()+")", "closure complete"))
		if baseCfg.BaseAsset != (common.Address{}) {
			rows = append(rows, driftRow(gateTokenConfig, subject, "base-composition-depth",
				"baseAsset must itself be USD-denominated (baseAsset = address(0)) — PriceProviderV2 states chaining is not supported",
				"the baseAsset names a further baseAsset "+baseCfg.BaseAsset.Hex(), "chained-base-asset",
				"a chained base asset means the deployed configuration does something the contract's own documentation says it does not support, and our composition model assumes one level"))
		}
		if baseCfg.IsStableToken {
			rows = append(rows, exactRow(gateTokenConfig, subject, "base_stable_snap invariant",
				"tokenConfig(asset).baseAsset != 0 AND tokenConfig(baseAsset).isStableToken",
				"both hold"))
		}
	}

	// ---- the disclosed impl-witness substitute ---------------------------
	digest := sweepReturndataDigest(rawByToken)
	rows = append(rows, p3Row{
		Gate: gateTokenConfig, Subject: c.reg.DMProvider.Hex(), Leg: "which-code-answered",
		Expected: "(cross-run comparison)", Actual: digest,
		Verdict: verdictEvidence, Gated: false,
		Note: implWitnessDeviation,
		Evidence: map[string]string{
			"pin_block":        fmt.Sprintf("%d", c.pinOP),
			"pin_hash":         c.hashOP.Hex(),
			"provider_address": c.reg.DMProvider.Hex(),
			"schema_label":     "input:pinned-read SAMPLE — the provider is NOT in the walker stream set, so its setTokenConfig mutations are un-custodied and this row carries NO continuity claim between runs (chain-truth R3.1)",
		},
	})
	f.use("proxy code witness: PriceProviderV2 raw tokenConfig returndata digest @pinHash(P_op)")

	// Coverage floor: set equality against the CHAIN enumeration.
	rows = append(rows, cohortFloorRow(gateTokenConfig, "swept-tokens(chain universe coverage)",
		countSweptInChain(seen, chainSet), len(chainSet), 1,
		fmt.Sprintf("the floor is the CHAIN enumeration at the pin (chain-truth R2), never the registry's ~20: swept %d tokens in total across %d closure wave(s), of which %d are in the chain universe",
			len(seen), depth, countSweptInChain(seen, chainSet))))
	return rows, evidence, nil
}

// compositionTree renders the full composition chain for one token, terminating
// at a USD-denominated node (baseAsset == 0) or at an unreadable one.
func compositionTree(t common.Address, configs map[common.Address]tokenConfigResult, reg *registryView) []string {
	var out []string
	seen := map[common.Address]bool{}
	cur := t
	for {
		if seen[cur] {
			out = append(out, fmt.Sprintf("CYCLE at %s — the guard stopped the walk", cur.Hex()))
			return out
		}
		seen[cur] = true
		cfg, ok := configs[cur]
		label := cur.Hex()
		if reg != nil {
			if r := reg.DM[cur]; r != nil {
				label = r.Symbol + " " + cur.Hex()
			}
		}
		if !ok {
			out = append(out, label+" -> (config unread)")
			return out
		}
		desc := fmt.Sprintf("%s oracle=%s chainlinkType=%v oracleDec=%d stable=%v maxStaleness=%s dataType=%d",
			label, cfg.Oracle.Hex(), cfg.IsChainlinkType, cfg.OraclePriceDecimals, cfg.IsStableToken, cfg.MaxStaleness, cfg.DataType)
		if cfg.BaseAsset == (common.Address{}) {
			out = append(out, desc+" base=USD (terminal)")
			return out
		}
		out = append(out, desc+" base="+cfg.BaseAsset.Hex())
		cur = cfg.BaseAsset
	}
}

func addrSet(in []common.Address) map[common.Address]bool {
	out := map[common.Address]bool{}
	for _, a := range in {
		out[a] = true
	}
	return out
}

func addrSetFromMap(in map[common.Address]bool) map[common.Address]bool {
	out := map[common.Address]bool{}
	for a, v := range in {
		if v {
			out[a] = true
		}
	}
	return out
}

func unionKeys(a, b map[string]bool) []string {
	set := map[string]bool{}
	for k := range a {
		set[k] = true
	}
	for k := range b {
		set[k] = true
	}
	out := make([]string, 0, len(set))
	for k := range set {
		out = append(out, k)
	}
	sort.Strings(out)
	return out
}

func countSweptInChain(seen map[common.Address]bool, chainSet map[common.Address]bool) int {
	n := 0
	for t := range seen {
		if chainSet[t] {
			n++
		}
	}
	return n
}

// rawDigestPrefix is a short, stable fingerprint of one token's raw
// returndata — enough to compare two runs without carrying kilobytes.
func rawDigestPrefix(raw []byte) string {
	return "0x" + hex.EncodeToString(raw[:minInt(16, len(raw))]) + fmt.Sprintf("..len=%d", len(raw))
}

// sweepReturndataDigest is the run-level decoder-shape fingerprint: a hash over
// every swept token's raw returndata in token order.
func sweepReturndataDigest(raw map[common.Address][]byte) string {
	var b strings.Builder
	for _, t := range sortedAddrs(addrSetFromRaw(raw)) {
		b.WriteString(hexLower(t.Hex()))
		b.WriteString(":")
		b.WriteString(hex.EncodeToString(raw[t]))
		b.WriteString("\n")
	}
	return sha256Hex(b.String())
}

func addrSetFromRaw(raw map[common.Address][]byte) map[common.Address]bool {
	out := map[common.Address]bool{}
	for a := range raw {
		out[a] = true
	}
	return out
}

func minInt(a, b int) int {
	if a < b {
		return a
	}
	return b
}

// sha256Hex is the local digest helper (the artifact's own comparison hash uses
// the same primitive in artifact.go).
func sha256Hex(s string) string {
	sum := sha256.Sum256([]byte(s))
	return "0x" + hex.EncodeToString(sum[:])
}

// unionAddrSets is the deterministic union used by the base-composition weld.
func unionAddrSets(a, b map[common.Address]bool) map[common.Address]bool {
	out := map[common.Address]bool{}
	for k, v := range a {
		if v {
			out[k] = true
		}
	}
	for k, v := range b {
		if v {
			out[k] = true
		}
	}
	return out
}

// addrStringer / boolStringer adapt values to compareExact's fmt.Stringer side so
// the base-composition weld reads exactly like every other row.
type addrStringer common.Address

func (a addrStringer) String() string { return baseLabel(common.Address(a)) }

type boolStringer bool

func (b boolStringer) String() string {
	if b {
		return "true"
	}
	return "false"
}

// baseLabel renders the zero address as the USD terminal it means, so a reviewer
// never has to decide whether 0x0 was "unset" or "USD".
func baseLabel(a common.Address) string {
	if a == (common.Address{}) {
		return "USD(terminal, baseAsset=0x0)"
	}
	return a.Hex()
}
