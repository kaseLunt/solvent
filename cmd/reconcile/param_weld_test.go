package main

import (
	"math/big"
	"testing"

	"github.com/ethereum/go-ethereum/common"
	"github.com/stretchr/testify/require"

	"github.com/kaselunt/solvent/cmd/reconcile/snapshotdb"
	"github.com/kaselunt/solvent/internal/config"
)

var (
	resWEETH = common.HexToAddress("0xCd5fE23C85820F7B72D0926FC9b05b43E359b7ee")
	resUSDC  = common.HexToAddress("0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48")
	resGHOST = common.HexToAddress("0x000000000000000000000000000000000000dead")
)

func regAsset(a common.Address, symbol string, dec uint8, roles ...string) *registryAsset {
	r := &registryAsset{Address: a, Symbol: symbol, Decimals: dec, Roles: map[string]bool{}}
	for _, x := range roles {
		r.Roles[x] = true
	}
	return r
}

// TestRegistrySetGateFailsBothDirectionsWithTheDirectionClassified is
// chain-truth R2: recon/feeds.json is the CLAIM, judged against the chain
// enumeration at the pin, and BOTH directions gate — the direction is recorded
// because remediation differs, never because one of them is tolerable.
func TestRegistrySetGateFailsBothDirectionsWithTheDirectionClassified(t *testing.T) {
	chain := map[common.Address]bool{resWEETH: true, resUSDC: true}
	registry := map[common.Address]*registryAsset{
		resWEETH: regAsset(resWEETH, "weETH", 18, "collateral"),
		resGHOST: regAsset(resGHOST, "GHOST", 18, "collateral"),
	}
	rows := registrySetGate(gateRegistry, "eth:", chain, registry, nil)

	byLeg := map[string]p3Row{}
	for _, r := range rows {
		byLeg[r.Subject] = r
	}
	// The chain has USDC and the registry does not: coverage gap (the liquidUSD
	// class) — an asset with no configured price witness.
	usdc := byLeg["eth:"+resUSDC.Hex()]
	require.Equal(t, verdictOnlyInChain, usdc.Verdict)
	require.True(t, usdc.Gated)
	require.Contains(t, usdc.Note, "NO configured price witness")
	// The registry has a ghost the chain does not configure: stale entry.
	ghost := byLeg["eth:"+resGHOST.Hex()]
	require.Equal(t, verdictOnlyInRegistry, ghost.Verdict)
	require.True(t, ghost.Gated)
	require.Contains(t, ghost.Note, "stale or mistyped")
	require.Contains(t, ghost.Note, "never disclose-and-continue")
	// The agreeing member is exact.
	require.Equal(t, verdictExact, byLeg["eth:"+resWEETH.Hex()].Verdict)

	require.Equal(t, 2, tallyP3(rows), "both directions must reach the exit code")
}

// TestRegistrySetGateEnforcesRoleLevelEquality is the leg chain-truth R2 adds
// explicitly: "a token borrow-enabled on chain but marked collateral-only in our
// registry is a missed debt-pricing witness hiding inside an address-level
// 'equal' verdict."
func TestRegistrySetGateEnforcesRoleLevelEquality(t *testing.T) {
	chain := map[common.Address]bool{resUSDC: true}
	registry := map[common.Address]*registryAsset{
		resUSDC: regAsset(resUSDC, "USDC", 6, "collateral"), // MISSING the debt role
	}
	chainRoles := map[common.Address]map[string]bool{
		resUSDC: {"collateral": true, "debt": true},
	}
	rows := registrySetGate(gateRegistry, "op:", chain, registry, chainRoles)
	var sawRoleFailure bool
	for _, r := range rows {
		if r.Leg == "roles" {
			sawRoleFailure = true
			require.Equal(t, verdictDrift, r.Verdict)
			require.Equal(t, "role-level-difference", r.Class)
			require.Equal(t, "collateral+debt", r.Expected, "the CHAIN's roles are the expected side")
			require.Equal(t, "collateral", r.Actual)
			require.Contains(t, r.Note, "missed debt-pricing witness")
		}
	}
	require.True(t, sawRoleFailure, "an address-level match must still be judged at role level")

	// Matching roles produce an exact role row rather than silence — a silent
	// pass and an asserted pass are different evidence.
	registry[resUSDC].Roles["debt"] = true
	rows = registrySetGate(gateRegistry, "op:", chain, registry, chainRoles)
	found := false
	for _, r := range rows {
		if r.Leg == "roles" {
			found = true
			require.Equal(t, verdictExact, r.Verdict)
		}
	}
	require.True(t, found)
}

// TestBuildRegistryViewMergesTheTwoAaveEntriesPerReserve: the registry carries
// each Aave reserve TWICE (a chainlink_stream entry and an aaveoracle poll
// entry). Judging them as two set members would report a difference that is an
// artifact of our own file layout, not a fact about the chain.
func TestBuildRegistryViewMergesTheTwoAaveEntriesPerReserve(t *testing.T) {
	oracle := common.HexToAddress("0x43b64f28A678944E0655404B0B98E443851cC34F")
	aggregator := common.HexToAddress("0xc9E1a09622afdB659913fefE800fEaE5DBbFe9d7")
	proxy := common.HexToAddress("0x8fFfFfd4AfB6115b954Bd326cbe7B4BA576818f6")
	provider := common.HexToAddress("0x44dd2372FE7B97C4B4D6a7d4DeCf72466485BAcB")
	feeds := &config.Feeds{Assets: []config.Feed{
		{Chain: "eth", ChainID: 1, Engine: aaveEngine, Address: resUSDC, Symbol: "USDC", Decimals: 6,
			Roles: []string{"collateral", "debt"},
			Oracle: config.FeedOracle{Kind: config.FeedKindChainlinkStream, Contract: aggregator, Proxy: proxy,
				PriceDecimals: 8, StartBlock: 20188117, Heartbeat: 86400_000_000_000, Grace: 3600_000_000_000}},
		{Chain: "eth", ChainID: 1, Engine: aaveEngine, Address: resUSDC, Symbol: "USDC", Decimals: 6,
			Roles:  []string{"collateral", "debt"},
			Oracle: config.FeedOracle{Kind: config.FeedKindPoll, Contract: oracle, Method: "getAssetPrice(address)", PriceDecimals: 8}},
		{Chain: "op", ChainID: 10, Engine: dmEngine, Address: tokA, Symbol: "liquidUSD", Decimals: 6,
			Roles:  []string{"collateral", "debt"},
			Oracle: config.FeedOracle{Kind: config.FeedKindPoll, Contract: provider, Method: "price(address)", PriceDecimals: 6}},
	}}
	streams := map[string]config.Stream{
		"eth:feed-usdc": {Name: "eth:feed-usdc", Addresses: []common.Address{aggregator}},
	}
	v, err := buildRegistryView(feeds, streams)
	require.NoError(t, err)
	require.Len(t, v.Aave, 1, "the two USDC entries are ONE reserve")
	require.Equal(t, map[string]bool{"collateral": true, "debt": true}, v.Aave[resUSDC].Roles)
	require.Equal(t, oracle, v.AaveOracle)
	require.Equal(t, provider, v.DMProvider)
	require.Len(t, v.DM, 1)

	// The feed registry Stage A consumes carries the stream NAME (which bounds
	// the custody domain) and both budget halves.
	require.Len(t, v.FeedRegistry.Feeds, 1)
	f := v.FeedRegistry.Feeds[0]
	require.Equal(t, "eth:feed-usdc", f.Stream)
	require.Equal(t, int64(86400), f.HeartbeatSeconds)
	require.Equal(t, int64(3600), f.GraceSeconds)
	require.Equal(t, uint64(20188117), f.StartBlock)
	require.Equal(t, hexLower(aggregator.Hex()), f.AggregatorHex)
	require.Equal(t, hexLower(proxy.Hex()), f.ProxyHex)
}

// TestBuildRegistryViewRefusesASelfContradictoryClaim: a registry that
// contradicts itself cannot be judged against anything, so it is a PRECONDITION
// error rather than a gate row.
func TestBuildRegistryViewRefusesASelfContradictoryClaim(t *testing.T) {
	oracle := common.HexToAddress("0x43b64f28A678944E0655404B0B98E443851cC34F")
	other := common.HexToAddress("0x0000000000000000000000000000000000000042")
	base := config.Feed{Chain: "eth", ChainID: 1, Engine: aaveEngine, Address: resUSDC, Symbol: "USDC", Decimals: 6,
		Roles:  []string{"collateral"},
		Oracle: config.FeedOracle{Kind: config.FeedKindPoll, Contract: oracle, PriceDecimals: 8}}

	// Two different AaveOracle adapters claimed.
	second := base
	second.Oracle.Contract = other
	_, err := buildRegistryView(&config.Feeds{Assets: []config.Feed{base, second}}, nil)
	require.Error(t, err)
	require.Contains(t, err.Error(), "two different AaveOracle adapters")

	// Two different decimals for one address.
	decs := base
	decs.Decimals = 18
	_, err = buildRegistryView(&config.Feeds{Assets: []config.Feed{base, decs}}, nil)
	require.Error(t, err)
	require.Contains(t, err.Error(), "self-contradictory claim")

	// An engine outside the two books this task judges.
	alien := base
	alien.Engine = "some_other_engine"
	_, err = buildRegistryView(&config.Feeds{Assets: []config.Feed{alien}}, nil)
	require.Error(t, err)

	// No adapter at all: the adapter-output weld would have nothing to judge.
	dmOnly := config.Feed{Chain: "op", ChainID: 10, Engine: dmEngine, Address: tokA, Symbol: "liquidUSD", Decimals: 6,
		Roles:  []string{"collateral"},
		Oracle: config.FeedOracle{Kind: config.FeedKindPoll, Contract: other, PriceDecimals: 6}}
	_, err = buildRegistryView(&config.Feeds{Assets: []config.Feed{dmOnly}}, nil)
	require.Error(t, err)
	require.Contains(t, err.Error(), "no AaveOracle poll entry")
}

// TestStreamNameForAggregatorFallsBackToUnwalked: an aggregator matching no
// configured stream has no ingest cursor, so the B3 scan cannot bound its custody
// domain and must record it unscannable rather than scan a domain it invented.
func TestStreamNameForAggregatorFallsBackToUnwalked(t *testing.T) {
	agg := common.HexToAddress("0xc9E1a09622afdB659913fefE800fEaE5DBbFe9d7")
	require.Equal(t, "(unwalked)", streamNameForAggregator(nil, agg))
	require.Equal(t, "eth:feed-usdc", streamNameForAggregator(map[string]config.Stream{
		"eth:feed-usdc": {Name: "eth:feed-usdc", Addresses: []common.Address{agg}},
	}, agg))
	// Deterministic when several streams could match: names are sorted first.
	require.Equal(t, "aaa", streamNameForAggregator(map[string]config.Stream{
		"zzz": {Name: "zzz", Addresses: []common.Address{agg}},
		"aaa": {Name: "aaa", Addresses: []common.Address{agg}},
	}, agg))
}

// TestSymbolAddressResolvesFromTheRegistryNotAHardcode: the liquidUSD
// force-include must come from the registry by SYMBOL, and a missing symbol must
// yield the zero address so the caller reports a cohort-floor miss rather than
// silently substituting a hardcoded address.
func TestSymbolAddressResolvesFromTheRegistryNotAHardcode(t *testing.T) {
	v := &registryView{DM: map[common.Address]*registryAsset{
		tokA: regAsset(tokA, "liquidUSD", 6, "collateral", "debt"),
		tokB: regAsset(tokB, "liquidBTC", 8, "collateral"),
	}, Aave: map[common.Address]*registryAsset{}}
	require.Equal(t, tokA, v.symbolAddress(dmEngine, "liquidUSD"))
	require.Equal(t, common.Address{}, v.symbolAddress(dmEngine, "notATokenHere"))
	require.Equal(t, common.Address{}, v.symbolAddress(aaveEngine, "liquidUSD"),
		"symbols are resolved per ENGINE: the two books' registries are separate")
}

// TestAdapterWeldFrameNamesTheOwnAnchorPin is the pin law as a declaration
// check: chain-truth R1's first read family requires the weld to re-read at the
// ROW'S OWN anchor hash, and a frame that named the run pin would be describing
// a different (and wrong) comparison.
func TestAdapterWeldFrameNamesTheOwnAnchorPin(t *testing.T) {
	f := adapterWeldFrame()
	var pinnedNames []string
	for _, s := range f.Sources {
		if s.Kind == framePinned {
			pinnedNames = append(pinnedNames, s.Name)
		}
	}
	require.Len(t, pinnedNames, 1)
	require.Contains(t, pinnedNames[0], "own anchor_block")
	require.NotContains(t, pinnedNames[0], "P_eth", "the adapter weld must NOT pin at the run pin")
}

// TestAaveParamLedgerFoldsThroughRiskfeed proves the weld consumes the SAME fold
// riskd serves from, which is what stops the weld passing against a fold nobody
// else uses (internal/riskfeed's own package doc names this Task-6 gate as the
// second consumer).
func TestAaveParamLedgerFoldsThroughRiskfeed(t *testing.T) {
	require.Equal(t, "aave_param", snapshotdb.AaveParamEngine,
		"the param ledger's engine identity is a THIRD engine, not a synonym for the position engine")
	// The declared frame must name riskfeed.FoldParams explicitly, so a future
	// hand-rolled fold inside this package is visible as a declaration change.
	f := aaveParamWeldFrame()
	found := false
	for _, s := range f.Sources {
		if s.Kind == frameDerived && contains(s.Name, "riskfeed.FoldParams") {
			found = true
		}
	}
	require.True(t, found)
}

func contains(s, sub string) bool {
	return len(s) >= len(sub) && (func() bool {
		for i := 0; i+len(sub) <= len(s); i++ {
			if s[i:i+len(sub)] == sub {
				return true
			}
		}
		return false
	})()
}

// TestHundredPercentDMIsTheDebtManagerDenominator guards the unit that a mix-up
// would scale by 1e16: Aave's ratios are basis points (1e4), the Debt Manager's
// are HUNDRED_PERCENT (100e18).
func TestHundredPercentDMIsTheDebtManagerDenominator(t *testing.T) {
	require.Equal(t, "100000000000000000000", hundredPercentDM.String())
	require.Equal(t, 0, hundredPercentDM.Cmp(new(big.Int).Mul(big.NewInt(100), wad)))
}
