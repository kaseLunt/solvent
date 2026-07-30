package derive

// THE COVERAGE FLOOR: min to walk from, MAX to vouch for.
//
// Round 4 [medium]: `BuildRunnerSpecs` collapses an engine's streams to their MINIMUM
// StartBlock, and the runner stamped derivation coverage from the window it began at
// — i.e. from that minimum. But the ingest walkers honour each stream's OWN start, so
// a stream configured later has no logs below its own start. Coverage from the
// minimum therefore VOUCHES FOR A RANGE THAT WAS NEVER FULLY INGESTED, and the one
// consumer of that vouching reads a missing collateral-flag event as "never enabled".
//
// The fix is not to forbid divergent starts — that would break an honest
// configuration (see the chainlink control below) — but to claim the honest floor.

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/ethereum/go-ethereum/common"
	"github.com/stretchr/testify/require"

	"github.com/kaselunt/solvent/internal/config"
	"github.com/kaselunt/solvent/internal/decode"
	"github.com/kaselunt/solvent/internal/store"
)

func covStream(name, engine string, start uint64, addr byte) config.Stream {
	return config.Stream{
		Name: name, Chain: "eth", Engine: engine,
		Addresses:  []common.Address{{addr}},
		StartBlock: start, Window: 100,
	}
}

func covConfig(streams ...config.Stream) *config.Config {
	return &config.Config{
		Chains:  map[string]config.Chain{"eth": {ChainID: 1}},
		Streams: streams,
	}
}

func specFor(t *testing.T, cfg *config.Config, engine string) RunnerSpec {
	t.Helper()
	specs, err := BuildRunnerSpecs(cfg)
	require.NoError(t, err)
	for _, s := range specs {
		if s.Engine == engine {
			return s
		}
	}
	t.Fatalf("no spec for engine %q", engine)
	return RunnerSpec{}
}

// TestBuildRunnerSpecsSeparatesTheWalkFloorFromTheCoverageFloor is the unit half.
//
// MUTANT THIS KILLS: set CoverageFromBlock from the minimum (or drop it and let the
// runner claim `from`). The divergent case below then claims 1000 — a range whose
// later stream contributed nothing.
func TestBuildRunnerSpecsSeparatesTheWalkFloorFromTheCoverageFloor(t *testing.T) {
	t.Run("uniform starts: the two floors coincide", func(t *testing.T) {
		spec := specFor(t, covConfig(
			covStream("pool", "aave_v3_etherfi", 1000, 0xA1),
			covStream("atoken", "aave_v3_etherfi", 1000, 0xA2),
		), "aave_v3_etherfi")
		require.EqualValues(t, 1000, spec.StartBlock)
		require.EqualValues(t, 1000, spec.CoverageFromBlock,
			"the production shape: nothing changes for a correctly configured engine")
	})

	t.Run("divergent starts: walk from the MIN, vouch for the MAX", func(t *testing.T) {
		spec := specFor(t, covConfig(
			// The typo: the flag-bearing stream starts late, the other at genesis.
			covStream("pool", "aave_v3_etherfi", 5000, 0xA1),
			covStream("atoken", "aave_v3_etherfi", 1000, 0xA2),
		), "aave_v3_etherfi")
		require.EqualValues(t, 1000, spec.StartBlock,
			"derivation must still BEGIN at the earliest stream, or its events are never read")
		require.EqualValues(t, 5000, spec.CoverageFromBlock,
			"but the joint ledger is only complete from the LATEST stream's start")
	})

	// THE LEGITIMACY CONTROL, and the reason a blanket refusal was rejected.
	//
	// `chainlink_feed` walks four aggregators deployed at four different times. Their
	// starts differ honestly, and no derived law there reads absence as truth. A
	// guard that refused divergence would break this configuration; claiming the
	// honest floor leaves it working while still making the dangerous case fail
	// closed downstream.
	t.Run("divergent starts are ACCEPTED, not refused (the chainlink shape)", func(t *testing.T) {
		specs, err := BuildRunnerSpecs(covConfig(
			covStream("feed-a", "chainlink_feed", 19_626_469, 0xF1),
			covStream("feed-b", "chainlink_feed", 20_188_117, 0xF2),
			covStream("feed-c", "chainlink_feed", 20_191_185, 0xF3),
			covStream("feed-d", "chainlink_feed", 20_779_893, 0xF4),
		))
		require.NoError(t, err,
			"an engine whose streams legitimately begin at different blocks must still build")
		require.Len(t, specs, 1)
		require.EqualValues(t, 19_626_469, specs[0].StartBlock)
		require.EqualValues(t, 20_779_893, specs[0].CoverageFromBlock)
	})
}

// TestProductionSpecsCoverageFloorsAreHonest reads the REAL config, so the invariant
// is about what ships. It also documents the one engine whose floors differ.
func TestProductionSpecsCoverageFloorsAreHonest(t *testing.T) {
	cfg := loadProductionConfigForSpecs(t)
	specs, err := BuildRunnerSpecs(cfg)
	require.NoError(t, err)
	require.NotEmpty(t, specs)

	for _, s := range specs {
		require.GreaterOrEqual(t, s.CoverageFromBlock, s.StartBlock,
			"engine %s: a coverage claim may never reach BELOW the walk floor", s.Engine)
		if s.Engine == AaveEngineName {
			require.Equal(t, s.StartBlock, s.CoverageFromBlock,
				"the Aave engine's streams must agree, or its coverage claim cannot reach the audited "+
					"genesis and riskfeed will refuse the whole book")
		}
	}
}

// TestRunnerStampsCoverageFromTheMaxNotTheMin is the end-to-end kill, on a real store.
//
// It drives the REAL runner over a spec whose streams disagree — the typo — and
// requires the persisted stamp to be the LATER block. Under the old behaviour the
// stamp was the window's own `from` (the minimum), which is precisely the false
// coverage: riskfeed's gate would then judge it sufficient for an audited genesis it
// never actually covered.
func TestRunnerStampsCoverageFromTheMaxNotTheMin(t *testing.T) {
	s := cfLiveStore(t)
	ctx := context.Background()
	cfIngestFixture(t, s, cfThroughHead)

	spec := cfRunnerSpec()
	// The engine walks from the earliest stream, but one of its streams begins
	// 100 blocks later, so the joint ledger is only complete from there.
	spec.CoverageFromBlock = spec.StartBlock + 100

	r, err := NewRunner(s, decode.NewRegistry(), NewAaveEngine(), spec, nil)
	require.NoError(t, err)
	for i := 0; i < 20; i++ {
		advanced, err := r.Step(ctx)
		require.NoError(t, err)
		if !advanced {
			break
		}
	}

	c := cfCursor(t, s)
	require.NotNil(t, c.CoveredFromBlock)
	require.EqualValues(t, spec.StartBlock+100, *c.CoveredFromBlock,
		"the stamp must be the LATER stream's start — the block from which the feed is really complete")

	// AND THE CONSEQUENCE: that stamp no longer satisfies a gate asking for coverage
	// back to the engine's start. The misconfiguration fails CLOSED instead of
	// serving a book over logs that were never ingested.
	require.False(t, store.CoverageProvenBack(c.CoveredFromBlock, c.DecoderRevision,
		cfStartBlock, decode.RevisionAaveCollateralFlags),
		"false coverage is exactly what this prevents")

	// The counterweight: a correctly configured engine (floors equal) DOES satisfy it,
	// so the refusal above is attributable to the divergence and not to the gate
	// rejecting everything.
	s2 := cfLiveStore(t)
	cfIngestFixture(t, s2, cfThroughHead)
	cfDeriveToHead(t, s2)
	require.True(t, cfCoverageProven(t, s2))
}

// loadProductionConfigForSpecs builds a Config from the committed contracts.json
// without going through config.Load, which also validates the RPC environment (the
// acceptance suite deliberately runs with SOLVENT_RPC_* unset).
func loadProductionConfigForSpecs(t *testing.T) *config.Config {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join("..", "..", "config", "contracts.json"))
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
	for _, s := range declared.Streams {
		addrs := make([]common.Address, 0, len(s.Addresses))
		for _, a := range s.Addresses {
			addrs = append(addrs, common.HexToAddress(a))
		}
		cfg.Streams = append(cfg.Streams, config.Stream{
			Name: s.Name, Chain: s.Chain, Engine: s.Engine,
			Addresses: addrs, StartBlock: s.StartBlock, Window: s.Window,
		})
	}
	require.NotEmpty(t, cfg.Streams)
	return cfg
}
