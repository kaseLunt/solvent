package riskfeed

// Price-source mechanism names, mirrored from `internal/prices`.
//
// # Why these are mirrored rather than imported
//
// `internal/prices` is the WRITER of these strings, and importing it would be
// the obvious way to keep one home for them. It also transitively pulls
// `internal/chain` — an RPC client — into the link graph of every binary that
// imports this package, including `cmd/riskd`, whose defining law is that it
// makes ZERO RPC calls (chain-truth R6.3).
//
// Linking dead code is not the same as calling it, so importing would not have
// broken the law. But it would have made the law UNPROVABLE: the strongest
// available statement of "this daemon cannot talk to a chain" is a test over its
// transitive dependencies, and that test can only pass if no chain client is
// reachable at all. TestRiskdLinksNoChainClient in cmd/riskd is that test, and
// these fifteen lines are what buy it.
//
// The duplication is NOT left to drift. TestSourceNamesMatchTheWriterExactly
// imports `internal/prices` (harmless in a test binary) and asserts these
// functions agree with the writer's, character for character, for the live
// oracle addresses. If the writer ever re-spells a source string, that test
// fails — which is the same protection an import would have given, moved from
// the compiler to the suite.

import (
	"encoding/hex"

	"github.com/ethereum/go-ethereum/common"
)

// sourcePriceProviderV2 mirrors prices.SourcePriceProviderV2: the engine-exact
// Debt Manager poll. It is a FLAT name because the OP poll set reads exactly one
// oracle contract.
const sourcePriceProviderV2 = "priceproviderv2"

// aaveOracleSource mirrors prices.AaveOracleSource: an ADAPTER-OUTPUT poll of
// AaveOracle.getAssetPrice, address-qualified.
//
// Lowercase, not EIP-55 checksummed, so the string is a deterministic function
// of the address BYTES — a checksum-cased variant would silently split one
// oracle's history into two sources.
func aaveOracleSource(contract common.Address) string {
	return "aaveoracle:0x" + hex.EncodeToString(contract.Bytes())
}
