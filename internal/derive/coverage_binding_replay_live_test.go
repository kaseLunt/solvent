package derive

// THE WALKED-SURFACE BINDING, end to end on a real store.
//
// Round 5 [high]: the persisted coverage claim carried only FromBlock and
// DecoderRevision, so it could not express WHICH CONTRACTS were walked. The failure
// needed no bug and no typo — just an honest config change:
//
//	the engine cursor is at head H; an operator adds an Aave aToken stream at the
//	audited genesis; the walker backfills the new address to H, but the RUNNER sees
//	cursor >= frontier and performs no historical walk, resuming at H+1. The old
//	covered_from_block=genesis survives every later window under an unchanged decoder
//	revision, validateAaveGenesis accepts the config, the coverage gate passes — and
//	riskd publishes a book missing the new stream's entire history.
//
// These tests drive the real runner through exactly that sequence.

import (
	"context"
	"testing"

	"github.com/ethereum/go-ethereum/common"
	"github.com/stretchr/testify/require"

	"github.com/kaselunt/solvent/internal/decode"
	"github.com/kaselunt/solvent/internal/store"
)

// cfSurface builds the binding for a set of (address, startBlock) pairs on chain 1.
func cfSurface(pairs ...store.CoverageStream) string {
	return store.CoverageBindingOf(1, pairs)
}

// cfRequirement is the gate a reader applies: audited genesis, current flag revision,
// and the surface the LIVE configuration implies.
func cfRequirement(binding string) store.CoverageRequirement {
	return store.CoverageRequirement{
		GenesisBlock:       cfStartBlock,
		MinDecoderRevision: decode.RevisionAaveCollateralFlags,
		Binding:            binding,
	}
}

// TestAddingAStreamInvalidatesInheritedCoverageUntilReplay is Codex's demanded
// regression.
//
// MUTANT THIS KILLS: drop Binding from DerivationCoverage (or from
// CoverageClaim.Satisfies). The post-config-change assertion then finds coverage
// PROVEN over a surface whose new address was never walked historically.
func TestAddingAStreamInvalidatesInheritedCoverageUntilReplay(t *testing.T) {
	s := cfLiveStore(t)
	ctx := context.Background()
	cfIngestFixture(t, s, cfThroughHead)

	// ---- (a) The engine is fully derived over the ORIGINAL one-stream surface.
	cfDeriveToHead(t, s)
	original := cfSurface(store.CoverageStream{Address: cfPool.Bytes(), StartBlock: cfStartBlock})
	require.True(t, cfCursor(t, s).CoverageClaim().Satisfies(cfRequirement(original)),
		"the CONTROL: coverage is proven for the surface actually walked")

	// ---- (b) THE CONFIG CHANGE. A new aToken stream is added at the audited
	// genesis. Nothing about the cursor, the block or the decoder revision moves.
	newAToken := common.HexToAddress("0xbe1F842e7e0afd2c2322aae5d34bA899544b29db")
	widened := cfSurface(
		store.CoverageStream{Address: cfPool.Bytes(), StartBlock: cfStartBlock},
		store.CoverageStream{Address: newAToken.Bytes(), StartBlock: cfStartBlock},
	)
	require.NotEqual(t, original, widened, "the premise: an added stream changes the binding")

	c := cfCursor(t, s)
	require.NotNil(t, c.CoveredFromBlock)
	require.EqualValues(t, cfStartBlock, *c.CoveredFromBlock,
		"the inherited claim still says 'from genesis' — this is the trap")
	require.EqualValues(t, decode.RegistryRevision, c.DecoderRevision,
		"and the decoder revision is unchanged, so neither older leg can notice")
	require.False(t, c.CoverageClaim().Satisfies(cfRequirement(widened)),
		"ONLY the binding notices: inherited coverage cannot vouch for an address it never walked")

	// ---- (c) Resuming derivation does NOT heal it. This is the heart of the
	// finding: the runner is at head, so it walks no history for the new address, and
	// a window stamped under the new binding RESTARTS coverage at that window's own
	// `from` rather than inheriting genesis.
	spec := cfRunnerSpec()
	spec.CoverageBinding = widened
	r, err := NewRunner(s, decode.NewRegistry(), NewAaveEngine(), spec, nil)
	require.NoError(t, err)
	for i := 0; i < 5; i++ {
		advanced, err := r.Step(ctx)
		require.NoError(t, err)
		if !advanced {
			break
		}
	}
	require.False(t, cfCursor(t, s).CoverageClaim().Satisfies(cfRequirement(widened)),
		"resuming at head cannot establish coverage for history it skipped")

	// ---- (d) ONLY a rewind-and-rederive establishes the new binding.
	require.NoError(t, s.RewindDerived(ctx, AaveEngineName, 1, cfStartBlock-1))
	after := cfCursor(t, s)
	require.Nil(t, after.CoveredFromBlock, "the rewind cleared the stale claim...")
	require.Empty(t, after.CoverageBinding, "...binding included")

	for i := 0; i < 20; i++ {
		advanced, err := r.Step(ctx)
		require.NoError(t, err)
		if !advanced {
			break
		}
	}
	final := cfCursor(t, s)
	require.Equal(t, widened, final.CoverageBinding,
		"the replay stamps the NEW surface, as a side effect of walking it")
	require.True(t, final.CoverageClaim().Satisfies(cfRequirement(widened)),
		"and only now is the widened surface proven")

	// And the OLD requirement no longer passes: coverage is a claim about one
	// surface, not a claim that accumulates.
	require.False(t, final.CoverageClaim().Satisfies(cfRequirement(original)),
		"a claim over the widened surface is not a claim over the narrower one")
}

// TestCoherentGenesisUpdateStillRequiresReplay is the second demanded variant: the
// constant, the fixture and the config all move together, so every startup check
// passes — and the DATABASE is still stale.
//
// It is the one an operator is most likely to hit, because nothing looks wrong.
func TestCoherentGenesisUpdateStillRequiresReplay(t *testing.T) {
	s := cfLiveStore(t)
	ctx := context.Background()
	cfIngestFixture(t, s, cfThroughHead)
	cfDeriveToHead(t, s)

	// Derived over the original surface at the original genesis.
	original := cfSurface(store.CoverageStream{Address: cfPool.Bytes(), StartBlock: cfStartBlock})
	require.True(t, cfCursor(t, s).CoverageClaim().Satisfies(cfRequirement(original)))

	// THE COHERENT UPDATE: the audited genesis moves EARLIER and the config follows.
	// A startup validator comparing config against the (updated) constant is happy.
	earlierGenesis := uint64(cfStartBlock - 1000)
	updated := cfSurface(store.CoverageStream{Address: cfPool.Bytes(), StartBlock: earlierGenesis})
	require.NotEqual(t, original, updated,
		"re-basing a stream changes the binding even though the address set did not")

	req := store.CoverageRequirement{
		GenesisBlock:       earlierGenesis,
		MinDecoderRevision: decode.RevisionAaveCollateralFlags,
		Binding:            updated,
	}
	c := cfCursor(t, s)
	require.False(t, c.CoverageClaim().Satisfies(req),
		"inherited coverage predates the new bar AND was walked under the old binding — refuse")

	// The binding is not merely redundant with the block here: even if the block leg
	// somehow passed, the surface leg alone refuses.
	require.False(t, c.CoverageClaim().Satisfies(store.CoverageRequirement{
		GenesisBlock:       cfStartBlock, // the OLD, satisfiable bar
		MinDecoderRevision: decode.RevisionAaveCollateralFlags,
		Binding:            updated,
	}), "the surface leg refuses independently of the block leg")

	// Replay under the new configuration establishes it.
	spec := cfRunnerSpec()
	spec.StartBlock = earlierGenesis
	spec.CoverageFromBlock = earlierGenesis
	spec.CoverageBinding = updated
	require.NoError(t, s.RewindDerived(ctx, AaveEngineName, 1, earlierGenesis-1))
	r, err := NewRunner(s, decode.NewRegistry(), NewAaveEngine(), spec, nil)
	require.NoError(t, err)
	for i := 0; i < 40; i++ {
		advanced, err := r.Step(ctx)
		require.NoError(t, err)
		if !advanced {
			break
		}
	}
	require.True(t, cfCursor(t, s).CoverageClaim().Satisfies(req),
		"after the replay the new genesis AND the new binding are both established")
}

// TestCoverageBindingIsOrderAndDuplicationInsensitive: two honest spellings of one
// configuration must agree, or a config reformat would demand a needless replay.
func TestCoverageBindingIsOrderAndDuplicationInsensitive(t *testing.T) {
	a := store.CoverageStream{Address: cfPool.Bytes(), StartBlock: cfStartBlock}
	b := store.CoverageStream{Address: cfWeETH.Bytes(), StartBlock: cfStartBlock}

	require.Equal(t, cfSurface(a, b), cfSurface(b, a), "order must not matter")
	require.Equal(t, cfSurface(a, b), cfSurface(a, b, a), "a repeated pair must not matter")
	require.NotEqual(t, cfSurface(a, b), cfSurface(a), "but a MISSING stream must")
	require.NotEqual(t, cfSurface(a), store.CoverageBindingOf(10, []store.CoverageStream{a}),
		"and the chain is part of the surface")
	require.Empty(t, store.CoverageBindingOf(1, nil),
		"no streams is no claim, not a claim about nothing")
}
