package riskfeed

// The cross-check that makes riskfeed/sources.go's mirroring safe.
//
// Importing `internal/prices` here is harmless: a test binary is not a daemon,
// and nothing in it dials a provider. What it buys is the guarantee an import in
// the non-test source would have given — that these strings are the WRITER's
// strings — without dragging a chain client into cmd/riskd's link graph.
//
// If `internal/prices` ever re-spells a source name (a checksum-cased address, a
// different prefix, a version suffix), this test fails and the mirror is caught
// before a risk read starts looking for rows under a name nobody writes.

import (
	"testing"

	"github.com/ethereum/go-ethereum/common"
	"github.com/stretchr/testify/require"

	"github.com/kaselunt/solvent/internal/prices"
)

func TestSourceNamesMatchTheWriterExactly(t *testing.T) {
	require.Equal(t, prices.SourcePriceProviderV2, sourcePriceProviderV2,
		"the Debt Manager's engine-exact poll source name has drifted from its writer")

	// The live AaveOracle, plus shapes that would expose a casing or padding bug.
	for _, addr := range []common.Address{
		common.HexToAddress("0x43b64f28A678944E0655404B0B98E443851cC34F"),
		common.HexToAddress("0x0000000000000000000000000000000000000000"),
		common.HexToAddress("0xffffffffffffffffffffffffffffffffffffffff"),
		common.HexToAddress("0x00000000000000000000000000000000000000FF"),
	} {
		require.Equal(t, prices.AaveOracleSource(addr), aaveOracleSource(addr),
			"the adapter-output source name has drifted from its writer for %s", addr.Hex())
	}
}

// TestMirroredSourcesClassifyAsTheValuationClasses closes the loop: the mirrored
// names must land in the classes the two surfaces are allowed to consume, or the
// registry would build keys nothing may value from.
func TestMirroredSourcesClassifyAsTheValuationClasses(t *testing.T) {
	class, err := ProvenanceClass(sourcePriceProviderV2)
	require.NoError(t, err)
	require.Equal(t, "engine-exact", class)
	require.True(t, IsValuationClass(class))

	class, err = ProvenanceClass(aaveOracleSource(common.HexToAddress("0x43b64f28A678944E0655404B0B98E443851cC34F")))
	require.NoError(t, err)
	require.Equal(t, "adapter-output", class)
	require.True(t, IsValuationClass(class))
}
