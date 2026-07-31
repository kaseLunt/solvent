package risk

// Wave S: the scenario claim surface welded against the DEPLOYED composition
// graph, fixture-captured at the accept-r4 OP pin.
//
// The accept-r4 tokenconfig_sweep produced 16 REAL findings, adjudicated by
// three independent lanes as committed-model staleness: ~11 configured assets
// carried NO scenario claim (a stress run held their TVL flat by omission —
// oracle-sentinel R4's named failure) and 5 assets (weETH, liquidBTC, eBTC,
// sETHFI, liquidETH) claimed USD-terminal while the chain declares a base.
// The adjudicated principle: absent-claim-by-omission is the defect;
// explicit-claim-or-explicit-decision is the fix.
//
// These tests enforce that principle durably:
//
//   - every claim derives from the committed scenario files exactly the way
//     the reconcile sweep's loader derives them (the EXTENDED law, including
//     the Wave-S base_asset field), conflict-free across files;
//   - the derived claims weld against testdata/tokenconfig_accept_r4.json —
//     the sweep's own pinned evidence, independently re-verified by raw
//     eth_call at the same pin — in BOTH directions (base equality and
//     stable-flag equality per asset);
//   - NO configured asset at the pin lacks a claim, and NO claim names an
//     asset the provider does not configure;
//   - the stable_snap set derived from the claim files equals the chain's
//     isStableToken set at the pin, both directions (risk-quant R4.1) — the
//     harness wave de-hardcodes its snap set from these same files;
//   - the liquidRESERVE twins (one symbol, TWO addresses — the recorded
//     hazard) are claimed by ADDRESS with distinct axis instances.

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/ethereum/go-ethereum/common"
	"github.com/stretchr/testify/require"
)

// ---------------------------------------------------------------------------
// The pinned fixture.
// ---------------------------------------------------------------------------

// tokenConfigFixture is the committed capture of PriceProviderV2's composition
// graph at the accept-r4 OP pin. Tests read THESE bytes, never a live chain.
type tokenConfigFixture struct {
	ChainID  uint64                  `json:"chain_id"`
	Provider string                  `json:"provider"`
	PinBlock uint64                  `json:"pin_block"`
	PinHash  string                  `json:"pin_hash"`
	Tokens   []tokenConfigFixtureRow `json:"tokens"`
}

type tokenConfigFixtureRow struct {
	Token           string `json:"token"`
	Symbol          string `json:"symbol"`
	ReadOK          bool   `json:"read_ok"`
	InChainUniverse bool   `json:"in_chain_universe"`
	InRegistry      bool   `json:"in_registry"`
	IsBaseAsset     bool   `json:"is_base_asset"`
	IsStableToken   bool   `json:"is_stable_token"`
	Decimals        uint8  `json:"decimals"`
	Oracle          string `json:"oracle"`
	// BaseAsset is empty for a USD-terminal config (baseAsset = 0x0 on chain).
	BaseAsset string `json:"base_asset,omitempty"`
}

func loadTokenConfigFixture(t *testing.T) tokenConfigFixture {
	t.Helper()
	b, err := os.ReadFile(filepath.Join("testdata", "tokenconfig_accept_r4.json"))
	require.NoError(t, err)
	var f tokenConfigFixture
	require.NoError(t, json.Unmarshal(b, &f))
	require.Equal(t, uint64(10), f.ChainID)
	require.Equal(t, common.HexToAddress("0x44dd2372FE7B97C4B4D6a7d4DeCf72466485BAcB"),
		common.HexToAddress(f.Provider))
	require.Equal(t, uint64(154938071), f.PinBlock)
	require.Equal(t, "0xaf91dd4ba1975fc3b93e411586ce267892406ed8cb7152c5cefe1c368696c6bc", f.PinHash)
	require.Len(t, f.Tokens, 22, "the accept-r4 sweep enumerated exactly 22 configs")
	return f
}

// ---------------------------------------------------------------------------
// The claim law.
// ---------------------------------------------------------------------------

// scenarioAssetClaim is one asset's derived composition claim, with the
// scenario that asserted it so a failure names its source.
type scenarioAssetClaim struct {
	Base   common.Address
	Stable bool
	FromID string
}

// deriveScenarioBaseClaims implements the EXTENDED claim law over a scenario
// set — the law the reconcile sweep's loadScenarioBaseClaims consumes once the
// harness wave lands the base_asset upgrade:
//
//   - base_asset present        ⇒ the claimed base is that address
//     (Validate already forces agreement with responds_to on a
//     base_stable_snap row);
//   - else base_stable_snap     ⇒ the claimed base is the responds_to stable;
//   - else                      ⇒ USD-terminal (base = 0x0);
//   - stable_snap               ⇒ the stable flag travels with the claim.
//
// A CONFLICT between two scenarios is an error, never a shrug: two different
// claims about one asset's composition cannot both be the model's behaviour.
func deriveScenarioBaseClaims(scs []Scenario) (map[common.Address]scenarioAssetClaim, error) {
	out := map[common.Address]scenarioAssetClaim{}
	for _, sc := range scs {
		for _, r := range sc.Propagation {
			if r.ChainID != 10 {
				continue // the swept provider is the OP Debt Manager's
			}
			asset := common.HexToAddress(r.Asset)
			claim := scenarioAssetClaim{Stable: r.StableSnap, FromID: sc.ID}
			switch {
			case r.BaseAsset != "":
				claim.Base = common.HexToAddress(r.BaseAsset)
			case r.BaseStableSnap:
				claim.Base = common.HexToAddress(r.RespondsTo[0].Asset)
			}
			if prev, ok := out[asset]; ok {
				if prev.Base != claim.Base || prev.Stable != claim.Stable {
					return nil, fmt.Errorf("scenario definitions CONFLICT on %s: %s claims base %s (stable %v) and %s claims base %s (stable %v)",
						r.Asset, prev.FromID, prev.Base.Hex(), prev.Stable, claim.FromID, claim.Base.Hex(), claim.Stable)
				}
				continue
			}
			out[asset] = claim
		}
	}
	return out, nil
}

func committedClaims(t *testing.T) map[common.Address]scenarioAssetClaim {
	t.Helper()
	scs, err := LoadScenarios()
	require.NoError(t, err)
	claims, err := deriveScenarioBaseClaims(scs)
	require.NoError(t, err, "the committed set must be conflict-free")
	require.NotEmpty(t, claims)
	return claims
}

// ---------------------------------------------------------------------------
// The welds.
// ---------------------------------------------------------------------------

// TestScenarioBaseClaimsWeldAgainstThePinnedTokenConfig is the accept-r4 fix's
// core regression: for EVERY configured asset at the pin, the committed claim's
// base and stable flag equal the chain's — bit-exact, both fields, per asset.
// This is the weld whose absence let weETH/liquidBTC/eBTC/sETHFI/liquidETH
// carry USD-terminal claims against a chain that declares bases.
func TestScenarioBaseClaimsWeldAgainstThePinnedTokenConfig(t *testing.T) {
	fix := loadTokenConfigFixture(t)
	claims := committedClaims(t)

	for _, row := range fix.Tokens {
		if !row.ReadOK {
			continue
		}
		token := common.HexToAddress(row.Token)
		claim, ok := claims[token]
		require.True(t, ok,
			"%s %s is configured at the pin but carries NO scenario claim — a stress run would hold it flat by omission (oracle-sentinel R4)",
			row.Symbol, row.Token)

		wantBase := common.Address{}
		if row.BaseAsset != "" {
			wantBase = common.HexToAddress(row.BaseAsset)
		}
		require.Equal(t, wantBase, claim.Base,
			"%s %s: the scenario claim's base (from %s) must equal tokenConfig.baseAsset at pin %d %s — the base-composition equality IS the lens-composition class closure (risk-quant R4.2)",
			row.Symbol, row.Token, claim.FromID, fix.PinBlock, fix.PinHash)
		require.Equal(t, row.IsStableToken, claim.Stable,
			"%s %s: the stable flag travels with the claim, both directions (risk-quant R4.1)",
			row.Symbol, row.Token)
	}
}

// TestEveryConfiguredAssetCarriesAClaimAndNoClaimIsStale is the coverage
// regression in BOTH directions: no configured asset without a claim (the
// omission defect), and no claim about an asset the provider does not
// configure (a stale claim the engine cannot price).
func TestEveryConfiguredAssetCarriesAClaimAndNoClaimIsStale(t *testing.T) {
	fix := loadTokenConfigFixture(t)
	claims := committedClaims(t)

	configured := map[common.Address]string{}
	for _, row := range fix.Tokens {
		if row.ReadOK {
			configured[common.HexToAddress(row.Token)] = row.Symbol
		}
	}

	var missing []string
	for token, sym := range configured {
		if _, ok := claims[token]; !ok {
			missing = append(missing, sym+" "+token.Hex())
		}
	}
	require.Empty(t, missing,
		"configured at the accept-r4 pin with NO scenario claim: the adjudicated principle is explicit-claim-or-explicit-decision, never omission")

	var stale []string
	for token, claim := range claims {
		if _, ok := configured[token]; !ok {
			stale = append(stale, token.Hex()+" (claimed by "+claim.FromID+")")
		}
	}
	require.Empty(t, stale,
		"claimed by the scenario matrices but NOT configured by the provider at the pin: the scenario would apply a transform the engine cannot price")
}

// TestScenarioStableSnapSetDerivesFromClaims pins the snap set the claim files
// imply — the set the reconcile gate de-hardcodes to (chain-truth accept-r4:
// 'derive from loadScenarioBaseClaims, delete the copy') — and welds it
// against the chain's isStableToken set at the pin, both directions.
//
// eUSD and EURC are the sharp edges: stable-NAMED, NOT stable-flagged on
// chain (eUSD is a direct USD accountant lens; EURC is EUR-denominated).
// Neither may join the snap set.
func TestScenarioStableSnapSetDerivesFromClaims(t *testing.T) {
	fix := loadTokenConfigFixture(t)
	claims := committedClaims(t)

	derived := map[common.Address]bool{}
	for token, c := range claims {
		if c.Stable {
			derived[token] = true
		}
	}
	chain := map[common.Address]bool{}
	for _, row := range fix.Tokens {
		if row.ReadOK && row.IsStableToken {
			chain[common.HexToAddress(row.Token)] = true
		}
	}
	require.Equal(t, chain, derived,
		"snap-set equality, both directions: an unexpected stable is a snap the model does not apply; a missing one is a snap it invents (risk-quant R4.1)")

	// And the set is exactly the committed three — a membership flip in any
	// ONE scenario file is a cross-file conflict before it is a set change.
	require.Equal(t,
		map[common.Address]bool{dUSDC: true, dUSDT: true, dFrxUSD: true},
		derived, "the v1 snap set is {USDC, USDT, frxUSD} on OP")

	for _, banned := range []struct {
		sym  string
		addr common.Address
	}{
		{"eUSD", common.HexToAddress("0x939778D83b46B456224A33Fb59630B11DEC56663")},
		{"EURC", common.HexToAddress("0xDCB612005417Dc906fF72c87DF732e5a90D49e11")},
	} {
		c, ok := claims[banned.addr]
		require.True(t, ok, "%s must carry a claim", banned.sym)
		require.False(t, c.Stable,
			"%s is stable-NAMED but isStableToken=false at the pin: snapping it would invent a transform the engine does not apply", banned.sym)
	}
}

// TestLiquidReserveTwinsAreClaimedByAddress: two DISTINCT deployments share
// the liquidRESERVE symbol and one oracle — the recorded accept-r4 hazard.
// Claims and axis instances must be keyed by ADDRESS, never symbol.
func TestLiquidReserveTwinsAreClaimedByAddress(t *testing.T) {
	twinA := common.HexToAddress("0xE5d3854736e0D513aAE2D8D708Ad94d14Fd56A6a")
	twinB := common.HexToAddress("0xca5921DF65E2e1b0B98Ae91c0187BA80D4124898")
	require.NotEqual(t, twinA, twinB)

	fix := loadTokenConfigFixture(t)
	symbols := map[common.Address]string{}
	for _, row := range fix.Tokens {
		symbols[common.HexToAddress(row.Token)] = row.Symbol
	}
	require.Equal(t, "liquidRESERVE", symbols[twinA])
	require.Equal(t, "liquidRESERVE", symbols[twinB], "the twins share ONE symbol — which is exactly why symbol keying is forbidden")

	claims := committedClaims(t)
	for _, twin := range []common.Address{twinA, twinB} {
		c, ok := claims[twin]
		require.True(t, ok, "twin %s must carry its own claim", twin.Hex())
		require.Equal(t, common.Address{}, c.Base, "both twins are USD-terminal at the pin")
		require.False(t, c.Stable)
	}

	// Each twin responds to its OWN axis instance, keyed by its own address.
	census, err := LoadScenario("dm_composition_census")
	require.NoError(t, err)
	seen := map[common.Address]AxisRef{}
	for _, r := range census.Propagation {
		a := common.HexToAddress(r.Asset)
		if a == twinA || a == twinB {
			require.Len(t, r.RespondsTo, 1)
			seen[a] = r.RespondsTo[0]
		}
	}
	require.Len(t, seen, 2)
	require.Equal(t, AxisAssetUSD, seen[twinA].Axis)
	require.Equal(t, AxisAssetUSD, seen[twinB].Axis)
	require.Equal(t, twinA, common.HexToAddress(seen[twinA].Asset))
	require.Equal(t, twinB, common.HexToAddress(seen[twinB].Asset))
	require.NotEqual(t, seen[twinA].key(), seen[twinB].key(),
		"the twins' axis instances must be distinct — one symbol, two axes")
}

// TestDeriveScenarioBaseClaimsRefusesCrossFileConflict: two scenarios claiming
// different compositions for one asset cannot both be the model's behaviour.
// (The reconcile loader enforces the same precondition on its side; this keeps
// the claim files honest before they ever reach it.)
func TestDeriveScenarioBaseClaimsRefusesCrossFileConflict(t *testing.T) {
	mk := func(id, baseAsset string) Scenario {
		return Scenario{
			ID: id, Version: "test", Label: "L", Description: "D", PathAssumption: "P",
			Engines: []string{DMEngine},
			Shocks:  []Shock{{Axis: AxisETHUSD, FactorNum: 90, FactorDen: 100}},
			Propagation: []AssetResponse{{
				Asset: dWeETH.Hex(), ChainID: 10,
				RespondsTo: []AxisRef{{Axis: AxisETHUSD}},
				BaseAsset:  baseAsset,
			}},
			OutOfModel: []string{"synthetic"},
		}
	}
	ethSentinel := "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE"

	// Agreeing claims: fine.
	_, err := deriveScenarioBaseClaims([]Scenario{mk("a", ethSentinel), mk("b", ethSentinel)})
	require.NoError(t, err)

	// One file reverts to USD-terminal: the conflict is refused BY NAME.
	_, err = deriveScenarioBaseClaims([]Scenario{mk("a", ethSentinel), mk("b", "")})
	require.Error(t, err)
	require.Contains(t, err.Error(), "CONFLICT")
	require.Contains(t, err.Error(), "a ")
	require.Contains(t, err.Error(), "b ")
}

// TestParseScenarioBaseAssetRules covers the Wave-S schema extension's guards.
func TestParseScenarioBaseAssetRules(t *testing.T) {
	tmpl := `{"id":"x","version":"v1","label":"L","description":"D","path_assumption":"P",
      "engines":["debt_manager"],
      "shocks":[{"axis":"eth_usd","factor_num":90,"factor_den":100}],
      "propagation":[{"asset":"%s","chain_id":10,%s"responds_to":%s}],
      "out_of_model":["x"]}`
	weeth := dWeETH.Hex()
	sentinel := "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE"
	ethAxis := `[{"axis":"eth_usd"}]`

	// Valid: a non-stable base claim on a linear composition row.
	_, err := ParseScenario([]byte(fmt.Sprintf(tmpl, weeth,
		`"base_asset":"`+sentinel+`",`, ethAxis)))
	require.NoError(t, err)

	// Not a hex address.
	_, err = ParseScenario([]byte(fmt.Sprintf(tmpl, weeth,
		`"base_asset":"notanaddress",`, ethAxis)))
	require.ErrorIs(t, err, ErrScenarioInvalid)
	require.Contains(t, err.Error(), "base_asset")
	require.Contains(t, err.Error(), "not a hex address")

	// The zero address: USD-terminal has exactly one spelling — omission.
	_, err = ParseScenario([]byte(fmt.Sprintf(tmpl, weeth,
		`"base_asset":"0x0000000000000000000000000000000000000000",`, ethAxis)))
	require.ErrorIs(t, err, ErrScenarioInvalid)
	require.Contains(t, err.Error(), "OMITTING")

	// Self-composition is a cycle, not a claim.
	_, err = ParseScenario([]byte(fmt.Sprintf(tmpl, weeth,
		`"base_asset":"`+weeth+`",`, ethAxis)))
	require.ErrorIs(t, err, ErrScenarioInvalid)
	require.Contains(t, err.Error(), "names the asset itself")

	// stable_snap + base_asset mirrors the chain's own refusal.
	stableAxis := `[{"axis":"stable_usd","asset":"` + dUSDC.Hex() + `"}]`
	stableTmpl := strings.Replace(tmpl,
		`"shocks":[{"axis":"eth_usd","factor_num":90,"factor_den":100}]`,
		`"shocks":[{"axis":"stable_usd","asset":"`+dUSDC.Hex()+`","factor_num":98,"factor_den":100}]`, 1)
	_, err = ParseScenario([]byte(fmt.Sprintf(stableTmpl, dUSDC.Hex(),
		`"stable_snap":true,"base_asset":"`+sentinel+`",`, stableAxis)))
	require.ErrorIs(t, err, ErrScenarioInvalid)
	require.Contains(t, err.Error(), "StableTokenCannotHaveBaseAsset")

	// base_stable_snap with a DISAGREEING base_asset: one asset cannot
	// compose under two bases.
	_, err = ParseScenario([]byte(fmt.Sprintf(stableTmpl, dLiqUSD.Hex(),
		`"base_stable_snap":true,"base_asset":"`+dUSDT.Hex()+`",`, stableAxis)))
	require.ErrorIs(t, err, ErrScenarioInvalid)
	require.Contains(t, err.Error(), "cannot compose under two bases")

	// base_stable_snap with an AGREEING base_asset: valid (the committed
	// stable scenarios carry exactly this shape).
	_, err = ParseScenario([]byte(fmt.Sprintf(stableTmpl, dLiqUSD.Hex(),
		`"base_stable_snap":true,"base_asset":"`+dUSDC.Hex()+`",`, stableAxis)))
	require.NoError(t, err)
}

// TestApplyScenarioCompositionCensusHoldsExplicitly: the census scenario's 1/1
// factors are the explicit decision to hold — every claimed mark comes out
// bit-identical, disclosed in Applied (factor 1/1) rather than in HeldFlat,
// and health does not move.
func TestApplyScenarioCompositionCensusHoldsExplicitly(t *testing.T) {
	sc, err := LoadScenario("dm_composition_census")
	require.NoError(t, err)

	opTok := common.HexToAddress("0x4200000000000000000000000000000000000042")
	twinA := common.HexToAddress("0xE5d3854736e0D513aAE2D8D708Ad94d14Fd56A6a")
	weEUR := common.HexToAddress("0xcC476B1a49bcDf5192561e87b6Fb8ea78aa28C13")

	pos := PositionInput{
		Engine: DMEngine,
		DM: &DMInput{
			Marks:   testDMMarks,
			Account: acctA,
			DebtUSD: mustBig(t, "1000000000"),
			Collateral: []DMCollateral{
				{Asset: opTok, Amount: mustBig(t, "1000000000000000000"), Decimals: 18},
				{Asset: twinA, Amount: mustBig(t, "1000000000000000000"), Decimals: 18},
				{Asset: weEUR, Amount: mustBig(t, "1000000000000000000"), Decimals: 18},
				{Asset: dWETH, Amount: mustBig(t, "1000000000000000000"), Decimals: 18},
			},
			Params: []ParamRow{
				dmParam(opTok, "70000000000000000000", "5000000000000000000"),
				dmParam(twinA, "80000000000000000000", "2000000000000000000"),
				dmParam(weEUR, "80000000000000000000", "2000000000000000000"),
				dmParam(dWETH, "80000000000000000000", "2000000000000000000"),
			},
			Prices: []PriceInput{
				enginePrice(opTok, "1730000"),    // $1.73
				enginePrice(twinA, "1042000"),    // $1.042
				enginePrice(weEUR, "1250000"),    // $1.25
				enginePrice(dWETH, "1950000000"), // $1,950 — NOT in the census
			},
		},
	}

	before, err := ComputeDMHealth(*pos.DM)
	require.NoError(t, err)

	out, err := ApplyScenario(pos, sc)
	require.NoError(t, err)

	// The three census assets are APPLIED at exactly 1/1 — the explicit,
	// disclosed decision — and their marks are bit-identical.
	require.Len(t, out.Scenario.Applied, 3)
	for _, a := range out.Scenario.Applied {
		requireBig(t, "1", a.FactorNum, "%s", a.Asset.Hex())
		requireBig(t, "1", a.FactorDen, "%s", a.Asset.Hex())
		require.Equal(t, a.Before.String(), a.After.String(),
			"%s: the census holds every mark", a.Asset.Hex())
		require.False(t, a.Snapped)
		require.False(t, a.BaseSnapped, "no census base is a snapped stable (weEUR's EURC base is NOT isStableToken)")
	}

	// WETH is not in the census matrix: held flat BY OMISSION here — its
	// claim lives in the eth scenarios — and the disclosure says so.
	require.Len(t, out.Scenario.HeldFlat, 1)
	require.Equal(t, dWETH, out.Scenario.HeldFlat[0].Asset)

	after, err := ComputeDMHealth(*out.DM)
	require.NoError(t, err)
	require.Equal(t, before.MaxBorrowLT.String(), after.MaxBorrowLT.String(),
		"a census with 1/1 factors must not move borrowing power")
	require.Equal(t, before.CollateralValueUSD.String(), after.CollateralValueUSD.String())
}
