package main

// THE AUDITED-GENESIS INVARIANT.
//
// Round 4 [medium]: nothing tied the production Aave streams to the genesis the
// collateral law's completeness argument was made about. Two configurations slipped
// through, and neither is exotic — both are single-character edits:
//
//   - a typo moving ONLY the flag-bearing Pool stream later. The engine's minimum
//     start is unchanged, so derivation stamped coverage over a range whose Pool logs
//     were never ingested; a collateral-flag event in that gap reads as absent, the
//     law reads absent as "never enabled", and the health factor is wrong with
//     nothing refusing.
//   - moving EVERY start later. No inconsistency exists to detect: a new lineage is
//     established whose coverage trivially satisfies its own lowered bar.

import (
	"encoding/json"
	"os"
	"testing"

	"github.com/ethereum/go-ethereum/common"
	"github.com/stretchr/testify/require"

	"github.com/kaselunt/solvent/internal/config"
	"github.com/kaselunt/solvent/internal/risk"
	"github.com/kaselunt/solvent/internal/riskfeed"
)

func aaveStream(name string, start uint64, addr common.Address) config.Stream {
	return config.Stream{
		Name: name, Chain: "eth", Engine: risk.AaveEngine,
		Addresses: []common.Address{addr}, StartBlock: start, Window: 2000,
	}
}

func genesisCfg(streams ...config.Stream) *config.Config {
	return &config.Config{
		Chains:  map[string]config.Chain{"eth": {ChainID: 1}},
		Streams: streams,
	}
}

var (
	auditedPool = common.HexToAddress(riskfeed.AuditedAavePoolAddress)
	someAToken  = common.HexToAddress("0xbe1F842e7e0afd2c2322aae5d34bA899544b29db")
)

// auditedStreams is the FULL audited surface: the Pool plus its four aTokens, every
// one at the audited genesis. It must be the whole set, because the invariant now
// checks the walked-surface BINDING too — a two-stream fixture would be refused for
// the right reason and would make the "accepted" control unreachable.
func auditedStreams() []config.Stream {
	const g = uint64(riskfeed.AuditedAaveGenesisBlock)
	return []config.Stream{
		aaveStream("eth:aave-etherfi", g, auditedPool),
		aaveStream("eth:atoken-weeth", g, someAToken),
		aaveStream("eth:atoken-usdc", g, common.HexToAddress("0x7380c583cDe4409eFF5DD3320D93a45D96B80E2e")),
		aaveStream("eth:atoken-pyusd", g, common.HexToAddress("0xdF7f48892244C6106EA784609f7de10AB36F9c7e")),
		aaveStream("eth:atoken-frax", g, common.HexToAddress("0x6914ECCf50837dC61b43ee478a9BD9B439648956")),
	}
}

// withStream returns the audited set with one stream replaced by name.
func withStream(name string, replacement config.Stream) []config.Stream {
	out := auditedStreams()
	for i := range out {
		if out[i].Name == name {
			out[i] = replacement
			return out
		}
	}
	panic("no such stream: " + name)
}

// TestValidateAaveGenesisRefusesEveryDivergence is the discrimination table. Each row
// is a configuration a human could plausibly commit.
func TestValidateAaveGenesisRefusesEveryDivergence(t *testing.T) {
	const audited = uint64(riskfeed.AuditedAaveGenesisBlock)

	t.Run("the audited configuration is accepted", func(t *testing.T) {
		got, gotBinding, err := validateAaveGenesis(genesisCfg(auditedStreams()...), risk.AaveEngine)
		require.NoError(t, err)
		require.Equal(t, audited, got,
			"the CONTROL: without it every refusal below could be a blanket refusal")
		require.NotEmpty(t, gotBinding, "the accepted path also returns the walked-surface binding")
	})

	t.Run("ONLY the Pool stream moved later (the typo)", func(t *testing.T) {
		_, _, err := validateAaveGenesis(genesisCfg(
			withStream("eth:aave-etherfi", aaveStream("eth:aave-etherfi", audited+100_000, auditedPool))...,
		), risk.AaveEngine)
		require.Error(t, err, "the minimum is unchanged, so only an audited comparison can catch this")
		require.Contains(t, err.Error(), "eth:aave-etherfi")
		require.Contains(t, err.Error(), "never enabled",
			"the refusal must name the consequence, not just the mismatch")
	})

	t.Run("ONLY an aToken stream moved later", func(t *testing.T) {
		_, _, err := validateAaveGenesis(genesisCfg(
			withStream("eth:atoken-weeth", aaveStream("eth:atoken-weeth", audited+5, someAToken))...,
		), risk.AaveEngine)
		require.Error(t, err,
			"balances derived from a partially-ingested aToken stream are wrong too")
		require.Contains(t, err.Error(), "eth:atoken-weeth")
	})

	t.Run("EVERY start moved later (the silent new lineage)", func(t *testing.T) {
		later := auditedStreams()
		for i := range later {
			later[i].StartBlock = audited + 1
		}
		_, _, err := validateAaveGenesis(genesisCfg(later...), risk.AaveEngine)
		require.Error(t, err,
			"internally consistent and still wrong: the lineage is no longer the audited one")
	})

	t.Run("every start moved EARLIER", func(t *testing.T) {
		earlier := auditedStreams()
		for i := range earlier {
			earlier[i].StartBlock = audited - 1
		}
		_, _, err := validateAaveGenesis(genesisCfg(earlier...), risk.AaveEngine)
		require.Error(t, err,
			"walking earlier is not unsafe for completeness, but it IS a different lineage whose "+
				"coverage value differs — an unaudited change must not pass silently")
	})

	t.Run("the flag-bearing Pool is absent entirely", func(t *testing.T) {
		noPool := auditedStreams()[1:] // drop the Pool stream
		_, _, err := validateAaveGenesis(genesisCfg(noPool...), risk.AaveEngine)
		require.Error(t, err, "no Pool stream means NO flag log is ever ingested")
		require.Contains(t, err.Error(), riskfeed.AuditedAavePoolAddress)
	})

	// THE ROUND-5 FINDING, CONFIG SIDE. Every start block equals the audited constant
	// and the Pool is present, so every check that existed before this round passes.
	// Only the walked-surface BINDING notices that the set of contracts changed.
	t.Run("a stream ADDED at the audited genesis", func(t *testing.T) {
		added := append(auditedStreams(),
			aaveStream("eth:atoken-new", audited, common.HexToAddress("0x00000000000000000000000000000000000000FF")))
		_, _, err := validateAaveGenesis(genesisCfg(added...), risk.AaveEngine)
		require.Error(t, err,
			"an added stream changes WHICH CONTRACTS must be walked; start blocks alone cannot see it")
		require.Contains(t, err.Error(), "coverage binding")
		require.Contains(t, err.Error(), "rewind-and-rederive",
			"and the refusal names the remedy: inherited coverage cannot vouch for the new address")
	})

	t.Run("a stream REMOVED", func(t *testing.T) {
		_, _, err := validateAaveGenesis(genesisCfg(auditedStreams()[:4]...), risk.AaveEngine)
		require.Error(t, err, "a narrower surface is also a different surface")
		require.Contains(t, err.Error(), "coverage binding")
	})

	t.Run("a stream RE-ADDRESSED", func(t *testing.T) {
		_, _, err := validateAaveGenesis(genesisCfg(
			withStream("eth:atoken-frax",
				aaveStream("eth:atoken-frax", audited, common.HexToAddress("0x00000000000000000000000000000000000000AB")))...,
		), risk.AaveEngine)
		require.Error(t, err, "same count, same starts, different contract")
		require.Contains(t, err.Error(), "coverage binding")
	})

	t.Run("no streams at all", func(t *testing.T) {
		_, _, err := validateAaveGenesis(genesisCfg(), risk.AaveEngine)
		require.Error(t, err)
		require.Contains(t, err.Error(), "NO configured stream")
	})
}

// TestProductionAaveStreamsMatchTheAuditedGenesis couples the invariant to the REAL
// config/contracts.json, which is what makes it a production guard rather than a
// statement about a fixture.
//
// MUTANT THIS KILLS: edit any aave_v3_etherfi startBlock in config/contracts.json.
// This test fails immediately and names the stream — and an intentional correction is
// forced to update riskfeed.AuditedAaveGenesisBlock too, which is the re-examination
// of the completeness argument such a change requires.
func TestProductionAaveStreamsMatchTheAuditedGenesis(t *testing.T) {
	raw, err := os.ReadFile("../../config/contracts.json")
	require.NoError(t, err)

	var declared struct {
		Chains map[string]struct {
			ChainID uint64 `json:"chainId"`
		} `json:"chains"`
		Streams []struct {
			Name       string   `json:"name"`
			Chain      string   `json:"chain"`
			Engine     string   `json:"engine"`
			Addresses  []string `json:"addresses"`
			StartBlock uint64   `json:"startBlock"`
			Window     uint64   `json:"window"`
		} `json:"streams"`
	}
	require.NoError(t, json.Unmarshal(raw, &declared))

	cfg := &config.Config{Chains: map[string]config.Chain{}}
	for key, c := range declared.Chains {
		cfg.Chains[key] = config.Chain{ChainID: c.ChainID}
	}
	var aaveStreams int
	for _, s := range declared.Streams {
		addrs := make([]common.Address, 0, len(s.Addresses))
		for _, a := range s.Addresses {
			addrs = append(addrs, common.HexToAddress(a))
		}
		cfg.Streams = append(cfg.Streams, config.Stream{
			Name: s.Name, Chain: s.Chain, Engine: s.Engine,
			Addresses: addrs, StartBlock: s.StartBlock, Window: s.Window,
		})
		if s.Engine == risk.AaveEngine {
			aaveStreams++
		}
	}
	require.Equal(t, 5, aaveStreams,
		"the committed config declares the Pool plus four aTokens; a changed count needs a "+
			"decision about this invariant, not a silently updated number")

	got, gotBinding, err := validateAaveGenesis(cfg, risk.AaveEngine)
	require.NoError(t, err,
		"the PRODUCTION config must satisfy the audited-genesis invariant riskd enforces at startup")
	require.EqualValues(t, riskfeed.AuditedAaveGenesisBlock, got)
	require.Equal(t, riskfeed.AuditedAaveCoverageBinding, gotBinding,
		"the PRODUCTION stream set must hash to the audited surface binding")

	// And the audited premise is a real fact about this market, not a placeholder:
	// it sits BELOW the first collateral-flag event the Pool ever emitted, which is
	// the whole completeness argument.
	require.Less(t, uint64(riskfeed.AuditedAaveGenesisBlock), uint64(20_713_917),
		"the audited genesis must precede the first ReserveUsedAsCollateralEnabled (20,713,917), "+
			"or the collateral law's genesis-complete custody claim does not hold")
}
