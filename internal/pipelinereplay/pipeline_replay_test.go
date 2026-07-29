// P3 Task 3 — the PIPELINE-REPLAY harness, three legs.
//
// Where internal/forkreplay (Task 10) welds ALREADY-DERIVED live-database
// state to a fork, this harness drives the pipeline itself: real
// ingest.Walker → real decode.Registry → real derive.Runner / derive.
// ParamRunner → real *store.Store, from an empty derived database, against a
// local anvil fork of ETH mainnet — then welds each layer's output to chain
// truth read back through that same fork.
//
// THE THREE LEGS (chain-truth brief R5, NORMATIVE; the plan's earlier
// "one pinned range containing config + borrow + liquidation" sketch was
// REFUTED by chain geometry and amended):
//
//	leg 1  genesis cluster, LOAD-BEARING. Fork 20,714,020. Walk
//	       20,713,910→20,714,018 over the PoolConfigurator, the Pool and the
//	       four aTokens. Custody, decode, positions and params are all
//	       welded. Genesis-valid: 20,713,917 IS this market's first activity.
//
//	leg 2  liquidation, CUSTODY-ONLY. Fork 21,469,984. Walk one window,
//	       21,469,973→21,469,982, holding two LiquidationCalls. Raw bytes +
//	       strict decode only — NO position weld, for the reason spelled out
//	       at TestPipelineReplayLiquidationCustody.
//
//	leg 3  reorg, SYNTHETIC POST-FORK. Pre-fork history cannot reorg, so the
//	       subject is manufactured on the fork: a real governance call, a
//	       real anvil_reorg, a real walker rewind, a real durable epoch, and
//	       the load-bearing proof that the reorged-away parameter row is
//	       REPLACED, not orphaned.
//
// Run: `make test-pipeline-replay` (see the Makefile target for the env).
package pipelinereplay

import (
	"context"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"math/big"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"testing"

	"github.com/ethereum/go-ethereum/accounts/abi"
	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/core/types"
	"github.com/jackc/pgx/v5"
	"github.com/stretchr/testify/require"

	"github.com/kaselunt/solvent/internal/chain"
	"github.com/kaselunt/solvent/internal/decode"
	"github.com/kaselunt/solvent/internal/derive"
	"github.com/kaselunt/solvent/internal/ingest"
	"github.com/kaselunt/solvent/internal/store"
)

// ---------------------------------------------------------------------------
// FROZEN PINS
//
// Every hash below is the PROVIDER-REPORTED eth_getBlockByNumber().hash,
// fetched 2026-07-29 through ANVIL_FORK_RPC_ETH (the dedicated ETH mainnet
// ARCHIVE key — Alchemy, archive-complete, 10-block eth_getLogs cap; brief
// R5/A3). They are re-asserted against the fork at startup, so a fork of the
// wrong chain or an upstream serving a different history fails before a
// single log is walked.
//
// The block SUBJECTS behind these pins were custody-verified in live raw_logs
// after Task 2's backfill landed (brief R5: "freeze exact pins only AFTER
// Task 2's live backfill lands"): 46 PoolConfigurator logs at 20,713,917, and
// the LiquidationCall pair at 21,469,973 / 21,469,981.
// ---------------------------------------------------------------------------

const (
	// leg1PinBlock sits 13 blocks past the genesis cluster's last event
	// (20,714,007) and inside the verified quiet zone (20,714,007,
	// 20,714,100] — so the fork's STATE is exactly the state as-of the last
	// subject, which is what makes the view-call weld at the pin legitimate.
	// The harness proves that quiet zone at runtime rather than trusting it
	// (see the gap check in leg 1).
	leg1PinBlock = uint64(20_714_020)
	leg1PinHash  = "0x02c014e3f1b3b496084b0a767b7765d96412bee1c342f3abc97cc43d69ccd036"
	leg1Start    = uint64(20_713_910)

	// leg2PinBlock is chosen so that safeHead == 21,469,982 exactly, making
	// the subject range 21,469,973→21,469,982 a SINGLE 10-block window — the
	// upstream's whole getLogs budget for this leg is one call per stream.
	leg2PinBlock = uint64(21_469_984)
	leg2PinHash  = "0x2ac1e4835b1a936fb17122aa90656297afc07c860f206283cb18daafc37e0680"
	leg2Start    = uint64(21_469_973)
)

// Stream names, taken from config/contracts.json by NAME (the addresses
// themselves are read from that registry, never transcribed here).
const (
	streamParam  = "eth:aave-param"
	streamPool   = "eth:aave-etherfi"
	streamWeETH  = "eth:atoken-weeth"
	streamUSDC   = "eth:atoken-usdc"
	streamPYUSD  = "eth:atoken-pyusd"
	streamFRAX   = "eth:atoken-frax"
	streamsCount = 6
)

// positionStreams are the streams the aave_v3_etherfi engine derives from.
var positionStreams = []string{streamPool, streamWeETH, streamUSDC, streamPYUSD, streamFRAX}

// Pinned selectors. Every one is re-derived from the parsed ABI's own
// signature by findMethod (which also recomputes keccak), so these constants
// cannot silently disagree with what is actually called.
const (
	selAddressesProvider     = "0542975c" // ADDRESSES_PROVIDER()
	selGetACLManager         = "707cd716" // getACLManager()
	selGetACLAdmin           = "0e67178c" // getACLAdmin()
	selGetPoolConfigurator   = "631adfca" // getPoolConfigurator()
	selIsPoolAdmin           = "7be53ca1" // isPoolAdmin(address)
	selIsRiskAdmin           = "674b5e4d" // isRiskAdmin(address)
	selGetConfiguration      = "c44b11f7" // getConfiguration(address)
	selGetReserveData        = "35ea6a75" // getReserveData(address)
	selGetReservesList       = "d1946dbc" // getReservesList()
	selGetReserveNormIncome  = "d15e0053" // getReserveNormalizedIncome(address)
	selScaledBalanceOf       = "1da24f3e" // scaledBalanceOf(address)
	selBalanceOf             = "70a08231" // balanceOf(address)
	selConfigureAsCollateral = "7c4e560b" // configureReserveAsCollateral(address,uint256,uint256,uint256)
)

// getReserveData's ReserveDataLegacy tuple field indices (ABI order, pinned
// against internal/decode/abis/AaveV3Pool.json).
const (
	rdIdxAToken            = 8
	rdIdxVariableDebtToken = 10
	rdIdxStrategy          = 11
)

// Hand-authored ABI fragments for the two surfaces the repo carries no
// artifact for, plus the PoolConfigurator WRITE method (the committed
// PoolConfigurator.json is an events-only ABI with zero functions). Every
// method taken from these is selector-pinned above.
const (
	addressesProviderFragment = `[
		{"type":"function","name":"getACLManager","inputs":[],"outputs":[{"type":"address"}],"stateMutability":"view"},
		{"type":"function","name":"getACLAdmin","inputs":[],"outputs":[{"type":"address"}],"stateMutability":"view"},
		{"type":"function","name":"getPoolConfigurator","inputs":[],"outputs":[{"type":"address"}],"stateMutability":"view"}
	]`
	aclManagerFragment = `[
		{"type":"function","name":"isPoolAdmin","inputs":[{"type":"address"}],"outputs":[{"type":"bool"}],"stateMutability":"view"},
		{"type":"function","name":"isRiskAdmin","inputs":[{"type":"address"}],"outputs":[{"type":"bool"}],"stateMutability":"view"}
	]`
	configuratorWriteFragment = `[
		{"type":"function","name":"configureReserveAsCollateral","inputs":[
			{"type":"address"},{"type":"uint256"},{"type":"uint256"},{"type":"uint256"}],
		 "outputs":[],"stateMutability":"nonpayable"}
	]`
)

// ---------------------------------------------------------------------------
// Frozen censuses
//
// Every count below was OBSERVED on the verified run at these pins and is now
// GATED, not merely logged. A silently-shrunken comparison surface — a
// decoder that stops matching, a derivation that stops writing rows, a
// getLogs that starts returning fewer logs — has to fail by name; a harness
// whose assertion count can drift to zero and still pass is theatre.
// ---------------------------------------------------------------------------

const (
	// leg1ExpectedLogs: 46 PoolConfigurator + 46 Pool/aToken logs across
	// 20,713,910→20,714,018.
	leg1ExpectedLogs = 92

	// leg1ExpectedFixtureMatches: entries in
	// internal/decode/testdata/configurator_inventory.json that fall inside
	// leg 1's range — all REAL (non-synthetic), all at 20,713,917. That
	// inventory is a per-topic0 DECODE fixture, so it samples 22 of the
	// block's 46 logs rather than mirroring them; 22 independently-captured
	// byte identities is what it can witness, and 22 is what is demanded.
	leg1ExpectedFixtureMatches = 22

	// leg1ExpectedCollateralConfigRows: the single, never-re-tuned weETH
	// CollateralConfigurationChanged (probe: count 1 in the ENTIRE
	// 20,625,519→25,635,725 configurator history).
	leg1ExpectedCollateralConfigRows = 1

	// leg1ExpectedReserveInitRows: all FOUR reserves (weETH, USDC, PYUSD,
	// FRAX) are initialized in the same block, 20,713,917 — verified on
	// chain, and consistent with the probe's whole-history count of 4. This
	// is what earns the leg its param weld on every reserve: each one's
	// ReserveInitialized is inside the walk, so each one's parameter history
	// is complete here.
	leg1ExpectedReserveInitRows = 4

	// leg1ExpectedScaledAsserts / leg1ExpectedProjectionAsserts: the exact
	// size of the position comparison surface — 9 derived (account, reserve,
	// side) balances, of which 8 are collateral and therefore also carry an
	// index projection. GATED, not logged: a derivation regression that
	// stops writing rows would otherwise shrink this harness's evidence to
	// nothing while still reporting PASS, which is the failure mode a census
	// exists to prevent.
	leg1ExpectedScaledAsserts     = 9
	leg1ExpectedProjectionAsserts = 8

	// leg2ExpectedLogs / leg2ExpectedLiquidations: the one-window subject.
	leg2ExpectedLogs         = 14
	leg2ExpectedLiquidations = 2

	// leg2ExpectedDecoded / leg2ExpectedSkipped: the decode SPLIT, gated
	// rather than reported. The Registry's contract for an unknown topic0 is
	// a silent (nil,false,nil), so a decoder that quietly stops recognising
	// an event would otherwise turn into a rising "skipped" count that no
	// assertion ever reads. At these pins every one of the 14 logs decodes.
	leg2ExpectedDecoded = 14
	leg2ExpectedSkipped = 0

	// reorgSpacerBlocks are empty blocks mined between the fork base and leg
	// 3's subject, so anvil_reorg never has to re-mine from the fork base
	// itself. See the probed constraint at its use site.
	reorgSpacerBlocks = uint64(4)
)

// ===========================================================================
// LEG 1 — genesis cluster (LOAD-BEARING)
// ===========================================================================

// TestPipelineReplayGenesisCluster drives the whole pipeline over the ether.fi
// Aave market's genesis cluster and welds every layer to the fork.
//
// WHY THIS RANGE IS GENESIS-VALID. The Aave engine's state model is
// "absence means zero, because derivation always starts at genesis"
// (internal/derive/engine.go's Engine contract, and the warm-start refusal it
// implies). Starting a walk at 20,713,910 would be a mid-history start — and
// therefore a corrupt derived weld — for any market with earlier activity.
// This market has none: 20,713,917 is its reserve-initialization block and
// its first Pool/aToken activity, so a walk beginning seven blocks earlier
// starts at a genuinely empty state. The harness does not merely assert this
// in prose: it walks the eight blocks before the cluster and requires them to
// be empty.
//
// DISCLOSED SCOPE LIMIT (brief R5). The PoolConfigurator's own history begins
// at 20,625,519, ~88k blocks before this range, and walking that at window 10
// would be ~8.8k proxied upstream requests — refused. This leg therefore
// welds ONLY IN-RANGE PARAMETERS and claims no full-registry equality.
//
// Where it DOES assert derived-params == chain-params it earns the right from
// inside the leg rather than by assumption: a reserve is welded only if its
// ReserveInitialized event was observed IN RANGE, because a reserve cannot
// carry collateral configuration before it exists, so an in-range
// initialization means the reserve's entire parameter history is in range. At
// these pins that admits all four reserves — they are initialized in the same
// block, 20,713,917. The guard is not decoration: it is the thing standing
// between this leg and the full-registry equality claim it disclaims, and any
// reserve added to this market later, above the walk, would fall out of the
// weld and be REPORTED instead of silently compared against derived silence.
func TestPipelineReplayGenesisCluster(t *testing.T) {
	anvilBin, forkRPC := optIn(t)
	// ---- From here on, EVERY problem is a FAILURE, never a skip. ----------
	ctx := context.Background()

	fork := startAnvilFork(t, anvilBin, forkRPC, leg1PinBlock, common.HexToHash(leg1PinHash))
	safeHead := leg1PinBlock - forkConfirmations

	dsn := freshDerivedDB(t, ctx, replayBaseDSN(t), "_p3replay1")
	st := openReplayStore(t, ctx, dsn)

	reg := loadContractStreams(t)
	streams := pickStreams(t, reg, []string{streamParam, streamPool, streamWeETH, streamUSDC, streamPYUSD, streamFRAX}, leg1Start)
	require.Len(t, streams, streamsCount)
	allAddrs := addressesOf(streams)
	configurator := onlyAddress(t, reg, streamParam)
	pool := onlyAddress(t, reg, streamPool)

	// ---- 1. Ingest: the real walkers, one per production stream. ----------
	ch := dialFork(t, ctx, fork)
	walkers := buildWalkers(t, ch, st, streams)
	registry := decode.NewRegistry()

	aaveSpec := derive.RunnerSpec{
		Engine: derive.AaveEngineName, Chain: "eth", ChainID: ethChainID,
		Streams:   positionStreams,
		Addresses: rawAddresses(addressesOf(pickStreams(t, reg, positionStreams, leg1Start))),
		// The engine's genesis for THIS replay. See the genesis-validity note
		// in the doc comment: the range's first eight blocks are proven empty
		// at runtime, so "absence means zero" holds from here.
		StartBlock: leg1Start, Window: forkWindow,
	}
	aaveRunner, err := derive.NewRunner(st, registry, derive.NewAaveEngine(), aaveSpec, nil)
	require.NoError(t, err, "build the aave_v3_etherfi runner")

	paramSpec := derive.RunnerSpec{
		Engine: derive.ParamEngineName, Chain: "eth", ChainID: ethChainID,
		Streams: []string{streamParam}, Addresses: [][]byte{configurator.Bytes()},
		StartBlock: leg1Start, Window: forkWindow,
	}
	paramRunner, err := derive.NewParamRunner(st, registry, paramSpec)
	require.NoError(t, err, "build the aave_param runner")

	runPipeline(t, ctx, walkers, []namedStepper{
		{derive.AaveEngineName, aaveRunner}, {derive.ParamEngineName, paramRunner},
	})

	// ---- 2. Custody weld: raw_logs bytes == fork getLogs bytes. -----------
	// The store side is what the WALKER persisted; the fork side is a direct
	// eth_getLogs the walker never touched. Two doors onto the same bytes.
	stored, err := st.RawLogsInRange(ctx, ethChainID, rawAddresses(allAddrs), leg1Start, safeHead)
	require.NoError(t, err, "read back raw_logs over the leg-1 range")
	direct := forkLogsOverRange(t, fork, leg1Start, safeHead, allAddrs)
	assertLogSetsIdentical(t, stored, direct, "leg 1 custody")
	require.Equalf(t, leg1ExpectedLogs, len(stored),
		"leg-1 custody census: walked %d logs, the frozen pin demands exactly %d — the subject range changed shape", len(stored), leg1ExpectedLogs)

	// The genesis-validity proof: nothing at all before the cluster block.
	preCluster := 0
	for _, l := range stored {
		if l.BlockNumber < 20_713_917 {
			preCluster++
		}
	}
	require.Zerof(t, preCluster,
		"genesis-validity check FAILED: %d engine logs exist in [%d, 20713917) — this market's activity does not start at the cluster, so 'absence means zero' does NOT hold from this start block and the derived weld below would be a mid-history weld",
		preCluster, leg1Start)

	// And nothing between the derive cursor and the pin, which is what makes
	// state read AT THE PIN comparable to state derived THROUGH safeHead.
	gap := fork.getLogs(safeHead+1, leg1PinBlock, allAddrs)
	require.Emptyf(t, gap,
		"%d engine log(s) exist in (%d, %d] — derived state through the cursor is NOT the state at the fork pin, so every view-call weld below would be off by those events",
		len(gap), safeHead, leg1PinBlock)

	// ---- 3. INDEPENDENT SECOND WITNESS: the committed fixture bytes. ------
	// Without this, the leg is one witness (the chain) through two doors.
	// internal/decode/testdata/configurator_inventory.json was captured in
	// Task 2 from Alchemy AND Blockscout independently (byte-identical across
	// all 110 logs of the address), months of provenance ago and by a
	// different mechanism than this fork. Its rows are the third party.
	fixtureMatches := assertConfiguratorFixture(t, registry, stored, leg1Start, safeHead)
	require.Equalf(t, leg1ExpectedFixtureMatches, fixtureMatches,
		"fixture-witness census: matched %d committed configurator fixture rows in range, the frozen pin demands exactly %d", fixtureMatches, leg1ExpectedFixtureMatches)

	// ---- 4. Derived positions vs fork view calls. -------------------------
	poolABI := loadArtifactABI(t, "AaveV3Pool.json")
	atokenABI := loadArtifactABI(t, "AToken.json")
	mGetReserveData := findMethod(t, poolABI, "getReserveData", 1, selGetReserveData)
	mGetConfiguration := findMethod(t, poolABI, "getConfiguration", 1, selGetConfiguration)
	mGetReservesList := findMethod(t, poolABI, "getReservesList", 0, selGetReservesList)
	mGetNormIncome := findMethod(t, poolABI, "getReserveNormalizedIncome", 1, selGetReserveNormIncome)
	mScaledBalanceOf := findMethod(t, atokenABI, "scaledBalanceOf", 1, selScaledBalanceOf)
	mBalanceOf := findMethod(t, atokenABI, "balanceOf", 1, selBalanceOf)

	type reserveTokens struct{ aToken, vToken, strategy common.Address }
	tokenCache := map[common.Address]reserveTokens{}
	tokensFor := func(reserve common.Address) reserveTokens {
		if v, ok := tokenCache[reserve]; ok {
			return v
		}
		ret := fork.ethCall(pool, packCall(t, mGetReserveData, reserve), leg1PinBlock)
		v := reserveTokens{
			aToken:   unpackStructField(t, mGetReserveData, ret, rdIdxAToken).(common.Address),
			vToken:   unpackStructField(t, mGetReserveData, ret, rdIdxVariableDebtToken).(common.Address),
			strategy: unpackStructField(t, mGetReserveData, ret, rdIdxStrategy).(common.Address),
		}
		tokenCache[reserve] = v
		return v
	}
	incomeCache := map[common.Address]*big.Int{}
	incomeFor := func(reserve common.Address) *big.Int {
		if v, ok := incomeCache[reserve]; ok {
			return v
		}
		v := unpackUint256(t, mGetNormIncome, fork.ethCall(pool, packCall(t, mGetNormIncome, reserve), leg1PinBlock))
		incomeCache[reserve] = v
		return v
	}

	balances := readPositionBalances(t, ctx, dsn, derive.AaveEngineName)
	require.NotEmpty(t, balances,
		"the aave_v3_etherfi engine derived ZERO position balances over the genesis cluster — an empty comparison surface makes every weld below vacuous")

	var scaledAsserts, projectionAsserts int
	for _, b := range balances {
		toks := tokensFor(b.Asset)
		var token common.Address
		switch b.Side {
		case "collateral":
			token = toks.aToken
		case "debt":
			token = toks.vToken
		default:
			t.Fatalf("derived balance for account %s reserve %s carries unknown side %q", b.Account.Hex(), b.Asset.Hex(), b.Side)
		}
		require.NotEqualf(t, common.Address{}, token,
			"reserve %s reports a zero %s-token address on the fork — getReserveData is not describing an initialized reserve", b.Asset.Hex(), b.Side)

		// THE weld: the engine's derived SCALED balance is exactly what the
		// deployed token reports. Scaled, not live — no rounding law is
		// involved, so this equality is exact by construction or it is wrong.
		onChain := unpackUint256(t, mScaledBalanceOf, fork.ethCall(token, packCall(t, mScaledBalanceOf, b.Account), leg1PinBlock))
		require.Zerof(t, b.Amount.Cmp(onChain),
			"account %s reserve %s side %s: derived scaled balance %s != %s.scaledBalanceOf %s at pin %d",
			b.Account.Hex(), b.Asset.Hex(), b.Side, b.Amount, token.Hex(), onChain, leg1PinBlock)
		scaledAsserts++

		if b.Side != "collateral" {
			continue
		}
		// And the derived scaled balance projected through the reserve's own
		// normalized income equals the aToken's live balance. Regime A =
		// half-up rayMul (see rayMulHalfUp's contract).
		live := unpackUint256(t, mBalanceOf, fork.ethCall(token, packCall(t, mBalanceOf, b.Account), leg1PinBlock))
		want := rayMulHalfUp(b.Amount, incomeFor(b.Asset))
		require.Zerof(t, want.Cmp(live),
			"account %s reserve %s: rayMulHalfUp(derived scaled %s, normalizedIncome %s) = %s != aToken.balanceOf %s at pin %d",
			b.Account.Hex(), b.Asset.Hex(), b.Amount, incomeFor(b.Asset), want, live, leg1PinBlock)
		projectionAsserts++
		t.Logf("position weld: account %s reserve %s %s scaled=%s live=%s", b.Account.Hex(), b.Asset.Hex(), b.Side, b.Amount, live)
	}
	require.Equalf(t, leg1ExpectedScaledAsserts, scaledAsserts,
		"scaled-balance census: executed %d equalities, the frozen pin demands exactly %d — the position comparison surface changed shape", scaledAsserts, leg1ExpectedScaledAsserts)
	require.Equalf(t, leg1ExpectedProjectionAsserts, projectionAsserts,
		"index-projection census: executed %d equalities, the frozen pin demands exactly %d", projectionAsserts, leg1ExpectedProjectionAsserts)

	// ---- 5. Derived params vs getConfiguration on the fork. ---------------
	paramRows, err := st.ParamsAsOf(ctx, derive.ParamEngineName, ethChainID, safeHead)
	require.NoError(t, err, "read param_history as of the derive cursor")
	require.NotEmpty(t, paramRows, "the aave_param runner derived ZERO param rows over the genesis cluster")

	initializedInRange := map[common.Address]bool{}
	latestCollateralCfg := map[common.Address]store.ParamRow{}
	var collateralCfgRows, reserveInitRows int
	for _, r := range paramRows {
		asset := common.BytesToAddress(r.Asset)
		switch r.SourceEvent {
		case "AaveCfgReserveInitialized":
			initializedInRange[asset] = true
			reserveInitRows++
			// The registry columns are welded to the chain's own reserve
			// record: a deriver that mis-assigns the 96-byte body (the A1
			// stableDebtToken/aToken trap) fails right here.
			toks := tokensFor(asset)
			sameBytes(t, toks.aToken.Bytes(), r.AToken,
				fmt.Sprintf("ReserveInitialized row for %s: derived aToken vs chain aTokenAddress %s", asset.Hex(), toks.aToken.Hex()))
			sameBytes(t, toks.vToken.Bytes(), r.VariableDebtToken,
				fmt.Sprintf("ReserveInitialized row for %s: derived variableDebtToken vs chain variableDebtTokenAddress %s", asset.Hex(), toks.vToken.Hex()))
			sameBytes(t, toks.strategy.Bytes(), r.Strategy,
				fmt.Sprintf("ReserveInitialized row for %s: derived strategy vs chain interestRateStrategyAddress %s", asset.Hex(), toks.strategy.Hex()))
		case "AaveCfgCollateralConfigurationChanged":
			collateralCfgRows++
			latestCollateralCfg[asset] = r // ParamsAsOf orders by (block, logIndex)
		}
	}
	require.Equalf(t, leg1ExpectedReserveInitRows, reserveInitRows,
		"ReserveInitialized census: derived %d rows in range, the frozen pin demands %d", reserveInitRows, leg1ExpectedReserveInitRows)
	require.Equalf(t, leg1ExpectedCollateralConfigRows, collateralCfgRows,
		"CollateralConfigurationChanged census: derived %d rows in range, the frozen pin demands %d (the single, never-re-tuned weETH row)", collateralCfgRows, leg1ExpectedCollateralConfigRows)

	// The weETH row's own values, pinned literally: this is THE parameter
	// triple a health factor is computed from, and the number a demo shows.
	weETHRow, ok := latestCollateralCfg[weETHReserve(t, initializedInRange, latestCollateralCfg)]
	require.True(t, ok, "no CollateralConfigurationChanged row was derived for the collateral reserve")
	require.Equal(t, "7800", weETHRow.LTV.String(), "derived weETH LTV")
	require.Equal(t, "8100", weETHRow.LiqThreshold.String(), "derived weETH liquidation threshold")
	require.Equal(t, "10600", weETHRow.LiqBonus.String(), "derived weETH liquidation bonus")

	reservesRet := fork.ethCall(pool, packCall(t, mGetReservesList), leg1PinBlock)
	reserves, ok := unpackOne(t, mGetReservesList, reservesRet).([]common.Address)
	require.True(t, ok, "getReservesList did not return an address slice")
	require.NotEmpty(t, reserves, "the Pool reports no reserves at the pin")

	var paramWelds, paramDisclosed int
	for _, reserve := range reserves {
		chainCfg := decodeReserveConfig(unpackReserveConfigData(t, mGetConfiguration,
			fork.ethCall(pool, packCall(t, mGetConfiguration, reserve), leg1PinBlock)))
		if !initializedInRange[reserve] {
			// DISCLOSED, not asserted: this reserve predates the walk, so the
			// leg holds no custody of whatever configured it. Comparing
			// derived absence to the chain's values here would be exactly the
			// full-registry equality claim R5 forbids.
			t.Logf("param scope limit: reserve %s was initialized BEFORE %d — chain reports LTV=%s LT=%s bonus=%s, NOT welded (this leg holds no pre-range configurator custody)",
				reserve.Hex(), leg1Start, chainCfg.LTV, chainCfg.LiqThreshold, chainCfg.LiqBonus)
			paramDisclosed++
			continue
		}
		// Earned in-leg: the reserve's ReserveInitialized is inside the walk,
		// and a reserve cannot be configured as collateral before it exists,
		// so the derived history for it IS complete.
		want := reserveConfig{LTV: new(big.Int), LiqThreshold: new(big.Int), LiqBonus: new(big.Int)}
		if r, ok := latestCollateralCfg[reserve]; ok {
			want = reserveConfig{LTV: r.LTV, LiqThreshold: r.LiqThreshold, LiqBonus: r.LiqBonus}
		}
		require.Zerof(t, want.LTV.Cmp(chainCfg.LTV),
			"reserve %s: derived LTV %s != getConfiguration LTV %s at pin %d", reserve.Hex(), want.LTV, chainCfg.LTV, leg1PinBlock)
		require.Zerof(t, want.LiqThreshold.Cmp(chainCfg.LiqThreshold),
			"reserve %s: derived liquidation threshold %s != chain %s at pin %d", reserve.Hex(), want.LiqThreshold, chainCfg.LiqThreshold, leg1PinBlock)
		require.Zerof(t, want.LiqBonus.Cmp(chainCfg.LiqBonus),
			"reserve %s: derived liquidation bonus %s != chain %s at pin %d", reserve.Hex(), want.LiqBonus, chainCfg.LiqBonus, leg1PinBlock)
		paramWelds++
	}
	require.Equalf(t, leg1ExpectedReserveInitRows, paramWelds,
		"param weld census: welded %d reserves, expected %d (the reserves initialized in range)", paramWelds, leg1ExpectedReserveInitRows)

	t.Logf("leg 1 PASS at pin %d (%s): %d logs custodied (walker==fork getLogs), %d committed-fixture byte identities, %d scaled-balance equalities, %d index-projection equalities, %d reserves param-welded (%d disclosed out of scope), %d ReserveInitialized registry welds",
		leg1PinBlock, leg1PinHash, len(stored), fixtureMatches, scaledAsserts, projectionAsserts, paramWelds, paramDisclosed, reserveInitRows)
}

// weETHReserve returns the one reserve that carries a
// CollateralConfigurationChanged row AND was initialized in range — resolved
// from derived state rather than transcribed, so a wrong asset assignment in
// the decoder cannot be papered over by a hardcoded address here.
func weETHReserve(t *testing.T, initialized map[common.Address]bool, cfgs map[common.Address]store.ParamRow) common.Address {
	t.Helper()
	var found []common.Address
	for a := range cfgs {
		if initialized[a] {
			found = append(found, a)
		}
	}
	require.Lenf(t, found, 1, "expected exactly one in-range collateral-configured reserve, found %d", len(found))
	return found[0]
}

// ===========================================================================
// LEG 2 — liquidation (CUSTODY-ONLY, disclosed)
// ===========================================================================

// TestPipelineReplayLiquidationCustody walks the one window holding the
// 21,469,973 / 21,469,981 LiquidationCall pair and asserts RAW BYTES + STRICT
// DECODE ONLY.
//
// THERE IS DELIBERATELY NO POSITION WELD HERE, AND THE FIX IS NOT TO ADD ONE.
// The Aave engine's state model is "absence of an account means zero, because
// derivation always starts at genesis" (internal/derive/engine.go's Engine
// contract; internal/derive/aave.go's hydration path refuses a committed
// balance it cannot explain). Standing the engine up at 21,469,973 would
// declare every borrower's pre-existing scaled balance to be zero and then
// subtract a liquidation from it — deriving negative or absurd positions and
// calling them custody. The honest options are (a) ingest the full 844k-block
// prefix from genesis, which is not a fork-harness workload, or (b) assert
// only what this range can prove. This leg takes (b). A future wave that
// "fixes" this leg by starting the Aave engine mid-history has produced
// exactly the corruption the warm-start refusal exists to prevent.
//
// What it does prove, and it is not nothing: the ingest layer's custody of a
// liquidation window is byte-exact against TWO independent fork doors
// (eth_getLogs and eth_getTransactionReceipt), and the decode layer reads
// those bytes into the same values a second, independent minimal reader
// extracts from the raw words.
func TestPipelineReplayLiquidationCustody(t *testing.T) {
	anvilBin, forkRPC := optIn(t)
	ctx := context.Background()

	fork := startAnvilFork(t, anvilBin, forkRPC, leg2PinBlock, common.HexToHash(leg2PinHash))
	safeHead := leg2PinBlock - forkConfirmations
	require.Equalf(t, leg2Start+forkWindow-1, safeHead,
		"leg 2 is specified as a SINGLE %d-block window; pin %d with %d confirmations gives safeHead %d, which is not %d",
		forkWindow, leg2PinBlock, forkConfirmations, safeHead, leg2Start+forkWindow-1)

	dsn := freshDerivedDB(t, ctx, replayBaseDSN(t), "_p3replay2")
	st := openReplayStore(t, ctx, dsn)

	reg := loadContractStreams(t)
	streams := pickStreams(t, reg, positionStreams, leg2Start)
	allAddrs := addressesOf(streams)

	ch := dialFork(t, ctx, fork)
	walkers := buildWalkers(t, ch, st, streams)
	for _, w := range walkers {
		drain(t, ctx, w.s, "walker "+w.name)
	}

	// ---- Custody weld #1: walker bytes == direct fork getLogs bytes. ------
	stored, err := st.RawLogsInRange(ctx, ethChainID, rawAddresses(allAddrs), leg2Start, safeHead)
	require.NoError(t, err, "read back raw_logs over the leg-2 range")
	direct := fork.getLogs(leg2Start, safeHead, allAddrs)
	assertLogSetsIdentical(t, stored, direct, "leg 2 custody")
	require.Equalf(t, leg2ExpectedLogs, len(stored),
		"leg-2 custody census: walked %d logs, the frozen pin demands exactly %d", len(stored), leg2ExpectedLogs)

	// ---- Custody weld #2: a DIFFERENT RPC door — the receipts. ------------
	// eth_getLogs answers a filter; eth_getTransactionReceipt answers a
	// transaction. Leg 1's third witness is the committed fixture; this range
	// has no committed fixture (the decode testdata pins different, later
	// liquidations), so the receipt door stands in as the second witness.
	byTx := map[common.Hash][]store.RawLog{}
	for _, l := range stored {
		h := common.BytesToHash(l.TxHash)
		byTx[h] = append(byTx[h], l)
	}
	receiptChecks := 0
	for tx, rows := range byTx {
		receiptLogs := fork.receiptLogs(tx)
		byIndex := map[uint32]types.Log{}
		for _, rl := range receiptLogs {
			byIndex[uint32(rl.Index)] = rl
		}
		for _, row := range rows {
			rl, ok := byIndex[row.LogIndex]
			require.Truef(t, ok, "log %x/%d is in raw_logs but absent from its own transaction receipt on the fork", row.TxHash, row.LogIndex)
			assertRawLogMatchesChainLog(t, row, rl, "leg 2 receipt witness")
			receiptChecks++
		}
	}
	require.Equalf(t, leg2ExpectedLogs, receiptChecks,
		"receipt-witness census: cross-checked %d logs, expected %d", receiptChecks, leg2ExpectedLogs)

	// ---- Strict decode, no derivation. -----------------------------------
	registry := decode.NewRegistry()
	var liquidations, decoded, skipped int
	for _, l := range stored {
		ev, ok, err := registry.Decode(derive.AaveEngineName, l)
		require.NoErrorf(t, err, "decode %x/%d (topic0 %x)", l.TxHash, l.LogIndex, l.Topics[0])
		if !ok {
			// The Registry's documented contract for an unknown topic0 is a
			// silent (nil,false,nil) — correct for a position engine, where an
			// ERC20 Approval beside a Transfer is routine noise. Counted, not
			// tolerated silently: the census below gates the split.
			skipped++
			continue
		}
		decoded++
		lc, isLiq := ev.(decode.AaveLiquidationCall)
		if !isLiq {
			continue
		}
		liquidations++
		// PARSER DIFFERENTIAL: the production decoder's output versus a
		// minimal independent reader over the same raw words. Two decoders
		// agreeing is evidence; one decoder agreeing with itself is not.
		assertLiquidationCallFields(t, l, lc)
	}
	require.Equalf(t, leg2ExpectedLiquidations, liquidations,
		"liquidation census: decoded %d LiquidationCall events in range, the frozen pin demands %d (21,469,973 and 21,469,981)", liquidations, leg2ExpectedLiquidations)
	require.Equalf(t, leg2ExpectedDecoded, decoded,
		"decode census: %d of %d logs decoded, the frozen pin demands %d", decoded, len(stored), leg2ExpectedDecoded)
	require.Equalf(t, leg2ExpectedSkipped, skipped,
		"decode census: %d logs were SILENTLY SKIPPED as unknown topic0, the frozen pin demands %d — the decoder stopped recognising something it used to read", skipped, leg2ExpectedSkipped)

	blocks := map[uint64]int{}
	for _, l := range stored {
		blocks[l.BlockNumber]++
	}
	require.Equalf(t, map[uint64]int{21_469_973: 7, 21_469_981: 7}, blocks,
		"leg-2 block distribution changed shape: %v", blocks)

	// Derivation was never run for this leg; prove it, so a future edit that
	// quietly wires a runner in here trips instead of silently producing a
	// mid-history weld.
	cursors := readDeriveCursors(t, ctx, dsn)
	require.Emptyf(t, cursors,
		"leg 2 is CUSTODY-ONLY but derive cursors exist (%v) — a derived weld was started mid-history, which the Aave engine's genesis invariant forbids", cursors)

	t.Logf("leg 2 PASS at pin %d (%s): %d logs custodied across two independent fork doors (getLogs + receipts), %d decoded / %d skipped-unknown, %d LiquidationCall parser-differential welds, ZERO derived positions (by design)",
		leg2PinBlock, leg2PinHash, len(stored), decoded, skipped, liquidations)
}

// assertLiquidationCallFields re-reads a LiquidationCall's fields straight
// out of the raw topics and data words and requires the production decoder to
// agree. Layout: LiquidationCall(address indexed collateralAsset, address
// indexed debtAsset, address indexed user, uint256 debtToCover, uint256
// liquidatedCollateralAmount, address liquidator, bool receiveAToken).
func assertLiquidationCallFields(t *testing.T, l store.RawLog, got decode.AaveLiquidationCall) {
	t.Helper()
	require.Lenf(t, l.Topics, 4, "LiquidationCall %x/%d has %d topics, want 4", l.TxHash, l.LogIndex, len(l.Topics))
	require.Lenf(t, l.Data, 128, "LiquidationCall %x/%d body is %d bytes, want 4 words", l.TxHash, l.LogIndex, len(l.Data))
	word := func(i int) []byte { return l.Data[i*32 : (i+1)*32] }
	addrFromWord := func(w []byte) common.Address {
		require.Truef(t, allZero(w[:12]), "address word has dirty high-order padding: %x", w)
		return common.BytesToAddress(w[12:])
	}
	require.Equal(t, common.BytesToAddress(l.Topics[1]), got.CollateralAsset, "collateralAsset")
	require.Equal(t, common.BytesToAddress(l.Topics[2]), got.DebtAsset, "debtAsset")
	require.Equal(t, common.BytesToAddress(l.Topics[3]), got.User, "user")
	require.Zerof(t, new(big.Int).SetBytes(word(0)).Cmp(got.DebtToCover), "debtToCover: independent reader %s, decoder %s", new(big.Int).SetBytes(word(0)), got.DebtToCover)
	require.Zerof(t, new(big.Int).SetBytes(word(1)).Cmp(got.LiquidatedCollateralAmount), "liquidatedCollateralAmount: independent reader %s, decoder %s", new(big.Int).SetBytes(word(1)), got.LiquidatedCollateralAmount)
	require.Equal(t, addrFromWord(word(2)), got.Liquidator, "liquidator")
	last := word(3)
	require.Truef(t, allZero(last[:31]) && (last[31] == 0 || last[31] == 1), "receiveAToken word is not a clean bool: %x", last)
	require.Equal(t, last[31] == 1, got.ReceiveAToken, "receiveAToken")
}

func allZero(b []byte) bool {
	for _, x := range b {
		if x != 0 {
			return false
		}
	}
	return true
}

// ===========================================================================
// LEG 3 — reorg (SYNTHETIC, POST-FORK)
// ===========================================================================

// TestPipelineReplayReorgReplacesParams manufactures a governance parameter
// change on the fork, reorgs it away, re-executes it with different values,
// and proves the whole reorg-custody chain end to end:
//
//	resolve the risk admin ON CHAIN → impersonate → configureReserveAsCollateral
//	→ mine → walk + derive the param row → anvil_reorg → re-execute with a
//	different tuple → walker observes same-height/different-hash → Rewind →
//	durable reorg epoch → the gate consumer REFUSES → RewindDerived +
//	RewindParams acknowledge → the gate consumer ALLOWS → recompute shows the
//	NEW tuple with NO SURVIVING OLD ROW.
//
// That last clause — REPLACED, NOT ORPHANED — is the load-bearing assertion
// (Codex round 1 [H3]). A ledger that appends the re-mined value while
// leaving the reorged-away one behind still "contains the right answer", and
// every as-of read below the new row's height silently returns the wrong one.
//
// WHY SYNTHETIC. Pre-fork history cannot be reorged: anvil proxies it. So the
// subject has to be built above the fork block. Everything about it is real
// except that it happened on a private chain: a real PoolConfigurator call by
// a real ACL-authorized admin, emitting the real event topic the production
// decoder already knows.
//
// THE ADMIN IS RESOLVED, NEVER HARDCODED: Pool.ADDRESSES_PROVIDER() →
// getACLManager() / getACLAdmin() → isPoolAdmin/isRiskAdmin. A hardcoded
// governance address would silently rot into an impersonation of the wrong
// account the moment governance moved, and the call would revert for a reason
// the harness would report as "reorg leg broken".
//
// EVERY WALKED BLOCK IS POST-FORK. The streams start at pin+1, so no
// eth_getLogs range ever straddles the fork boundary — a straddling range is
// proxied and fails whole on this upstream (brief R5), which would look like
// an ingest bug and is really a harness bug.
func TestPipelineReplayReorgReplacesParams(t *testing.T) {
	anvilBin, forkRPC := optIn(t)
	ctx := context.Background()

	fork := startAnvilFork(t, anvilBin, forkRPC, leg1PinBlock, common.HexToHash(leg1PinHash))
	start := leg1PinBlock + 1

	dsn := freshDerivedDB(t, ctx, replayBaseDSN(t), "_p3replay3")
	st := openReplayStore(t, ctx, dsn)

	reg := loadContractStreams(t)
	// Two streams, two engines. The position stream carries no post-fork logs
	// at all; it is here so that a SECOND derive cursor must also acknowledge
	// the epoch — the gate's refusal is only meaningful when more than one
	// consumer can lag it, and RewindDerived (the position path) is exercised
	// alongside RewindParams (the param path).
	streams := pickStreams(t, reg, []string{streamParam, streamPool}, start)
	configurator := onlyAddress(t, reg, streamParam)
	pool := onlyAddress(t, reg, streamPool)

	ch := dialFork(t, ctx, fork)
	walkers := buildWalkers(t, ch, st, streams)
	registry := decode.NewRegistry()

	aaveRunner, err := derive.NewRunner(st, registry, derive.NewAaveEngine(), derive.RunnerSpec{
		Engine: derive.AaveEngineName, Chain: "eth", ChainID: ethChainID,
		Streams: []string{streamPool}, Addresses: [][]byte{pool.Bytes()},
		StartBlock: start, Window: forkWindow,
	}, nil)
	require.NoError(t, err, "build the aave_v3_etherfi runner")
	paramRunner, err := derive.NewParamRunner(st, registry, derive.RunnerSpec{
		Engine: derive.ParamEngineName, Chain: "eth", ChainID: ethChainID,
		Streams: []string{streamParam}, Addresses: [][]byte{configurator.Bytes()},
		StartBlock: start, Window: forkWindow,
	})
	require.NoError(t, err, "build the aave_param runner")
	runners := []namedStepper{{derive.AaveEngineName, aaveRunner}, {derive.ParamEngineName, paramRunner}}

	// ---- 1. Resolve the risk admin ON the fork. ---------------------------
	poolABI := loadArtifactABI(t, "AaveV3Pool.json")
	provABI := minimalABI(t, addressesProviderFragment)
	aclABI := minimalABI(t, aclManagerFragment)
	cfgABI := minimalABI(t, configuratorWriteFragment)

	mAddressesProvider := findMethod(t, poolABI, "ADDRESSES_PROVIDER", 0, selAddressesProvider)
	mGetACLManager := findMethod(t, provABI, "getACLManager", 0, selGetACLManager)
	mGetACLAdmin := findMethod(t, provABI, "getACLAdmin", 0, selGetACLAdmin)
	mGetPoolConfigurator := findMethod(t, provABI, "getPoolConfigurator", 0, selGetPoolConfigurator)
	mIsPoolAdmin := findMethod(t, aclABI, "isPoolAdmin", 1, selIsPoolAdmin)
	mIsRiskAdmin := findMethod(t, aclABI, "isRiskAdmin", 1, selIsRiskAdmin)
	mGetConfiguration := findMethod(t, poolABI, "getConfiguration", 1, selGetConfiguration)
	mConfigure := findMethod(t, cfgABI, "configureReserveAsCollateral", 4, selConfigureAsCollateral)

	at := fork.head()
	provider := unpackAddress(t, mAddressesProvider, fork.ethCall(pool, packCall(t, mAddressesProvider), at))
	require.NotEqual(t, common.Address{}, provider, "the Pool reports no addresses provider")
	aclManager := unpackAddress(t, mGetACLManager, fork.ethCall(provider, packCall(t, mGetACLManager), at))
	aclAdmin := unpackAddress(t, mGetACLAdmin, fork.ethCall(provider, packCall(t, mGetACLAdmin), at))
	onChainConfigurator := unpackAddress(t, mGetPoolConfigurator, fork.ethCall(provider, packCall(t, mGetPoolConfigurator), at))
	require.Equalf(t, configurator, onChainConfigurator,
		"config/contracts.json's aave-param stream targets %s but the on-chain addresses provider resolves the PoolConfigurator to %s — the registry and the chain disagree",
		configurator.Hex(), onChainConfigurator.Hex())

	isPoolAdmin := unpackBool(t, mIsPoolAdmin, fork.ethCall(aclManager, packCall(t, mIsPoolAdmin, aclAdmin), at))
	isRiskAdmin := unpackBool(t, mIsRiskAdmin, fork.ethCall(aclManager, packCall(t, mIsRiskAdmin, aclAdmin), at))
	require.Truef(t, isPoolAdmin || isRiskAdmin,
		"the resolved ACL admin %s holds NEITHER POOL_ADMIN nor RISK_ADMIN on ACLManager %s — the harness refuses to guess a different sender, because guessing is how a hardcoded governance address rots in silently",
		aclAdmin.Hex(), aclManager.Hex())
	t.Logf("risk admin resolved on-chain: provider %s → ACLManager %s → admin %s (poolAdmin=%v riskAdmin=%v)",
		provider.Hex(), aclManager.Hex(), aclAdmin.Hex(), isPoolAdmin, isRiskAdmin)

	// The subject reserve is whichever one the CHAIN reports as
	// collateral-enabled at the pin (a nonzero liquidation threshold),
	// resolved rather than transcribed — so the leg cannot quietly go on
	// reconfiguring an address that stopped being this market's collateral.
	// It is weETH in fact; nothing here depends on that being written down.
	var collateralReserve common.Address
	mGetReservesList := findMethod(t, poolABI, "getReservesList", 0, selGetReservesList)
	reserves, ok := unpackOne(t, mGetReservesList, fork.ethCall(pool, packCall(t, mGetReservesList), at)).([]common.Address)
	require.True(t, ok, "getReservesList did not return an address slice")
	for _, r := range reserves {
		cfg := decodeReserveConfig(unpackReserveConfigData(t, mGetConfiguration, fork.ethCall(pool, packCall(t, mGetConfiguration, r), at)))
		if cfg.LiqThreshold.Sign() > 0 {
			require.Equalf(t, common.Address{}, collateralReserve,
				"more than one collateral-enabled reserve at the pin; the leg's subject is ambiguous")
			collateralReserve = r
		}
	}
	require.NotEqualf(t, common.Address{}, collateralReserve,
		"no collateral-enabled reserve at pin %d — nothing to reconfigure", leg1PinBlock)

	fork.impersonate(aclAdmin)
	fork.setBalance(aclAdmin, new(big.Int).Exp(big.NewInt(10), big.NewInt(20), nil)) // 100 ETH

	// SPACER BLOCKS, and the reason is a probed anvil constraint rather than
	// taste. anvil_reorg(depth) re-mines from the block at head-depth, and on
	// a FORKED instance it cannot re-mine from the fork base itself: probed
	// live on anvil v1.7.1 (commit 4072e48) at this very pin, depth 3 against
	// 5 locally-mined blocks succeeds while depth 5 against 5 fails with
	// -32001 "Resource not found". Mining a few empty blocks before the
	// subject keeps the reorg strictly inside anvil's own history. The guard
	// below turns the constraint into an assertion so a future depth change
	// fails by name instead of as an opaque RPC error.
	fork.mine(reorgSpacerBlocks)

	// ---- 2. Emit the FIRST parameter tuple and derive it. -----------------
	const (
		ltv1, lt1, bonus1 = 7700, 8000, 10500
		ltv2, lt2, bonus2 = 7600, 7900, 10400
	)
	emit1 := emitCollateralConfig(t, fork, registry, aclAdmin, configurator, mConfigure, collateralReserve, ltv1, lt1, bonus1)
	fork.mine(forkConfirmations)
	runPipeline(t, ctx, walkers, runners)

	head1 := fork.head()
	rows, err := st.ParamsAsOf(ctx, derive.ParamEngineName, ethChainID, head1)
	require.NoError(t, err)
	require.Lenf(t, rows, 1, "expected exactly one derived param row after the first governance call, got %d", len(rows))
	require.Equal(t, "AaveCfgCollateralConfigurationChanged", rows[0].SourceEvent)
	require.Equal(t, collateralReserve.Bytes(), rows[0].Asset)
	requireTuple(t, rows[0], ltv1, lt1, bonus1, "first (pre-reorg) tuple")
	require.Equalf(t, emit1, rows[0].EffectiveBlock, "the derived row is effective at block %d, the event was emitted at %d", rows[0].EffectiveBlock, emit1)

	// The gate is OPEN here: no epoch has ever been recorded.
	requireGate(t, ctx, dsn, true, "before any reorg")
	require.Zerof(t, countReorgEpochs(t, ctx, dsn), "a reorg epoch exists before any reorg happened")

	// ---- 3. Reorg the parameter change away. ------------------------------
	hashBefore := fork.hashAt(emit1)
	cursorBefore := readIngestCursor(t, ctx, dsn, streamParam)
	// depth must exceed head-emit so the emitting block itself is rolled back
	// (brief R5); because the walker's cursor sits at or above emit1, the same
	// depth necessarily invalidates the cursor's own block too.
	depth := head1 - emit1 + 1
	require.Lessf(t, depth, head1-leg1PinBlock,
		"anvil_reorg depth %d would reach the fork base at %d: a forked anvil cannot re-mine from its own fork block (probed: -32001 \"Resource not found\"). Mine more spacer blocks before the subject.",
		depth, leg1PinBlock)
	fork.reorg(depth)

	require.Equalf(t, head1, fork.head(),
		"anvil_reorg(%d) changed the head from %d to %d — this leg needs the SAME-HEIGHT/different-hash shape the walker rewinds on", depth, head1, fork.head())
	hashAfter := fork.hashAt(emit1)
	require.NotEqualf(t, hashBefore, hashAfter,
		"anvil_reorg(%d) left block %d with the same hash %s — nothing was reorged, so the rest of this leg would assert nothing", depth, emit1, hashBefore.Hex())
	require.NotEqualf(t, cursorBefore.hash, fork.hashAt(cursorBefore.block).Bytes(),
		"the walker's own cursor block %d survived the reorg unchanged — the walker would see no mismatch and never rewind", cursorBefore.block)
	t.Logf("anvil_reorg(depth=%d): block %d hash %s → %s, head preserved at %d; walker cursor was %d",
		depth, emit1, hashBefore.Hex(), hashAfter.Hex(), head1, cursorBefore.block)

	// ---- 4. Re-execute with a DIFFERENT tuple. ----------------------------
	fork.impersonate(aclAdmin) // re-arm: the reorg rewound the account's nonce
	fork.setBalance(aclAdmin, new(big.Int).Exp(big.NewInt(10), big.NewInt(20), nil))
	emit2 := emitCollateralConfig(t, fork, registry, aclAdmin, configurator, mConfigure, collateralReserve, ltv2, lt2, bonus2)
	fork.mine(forkConfirmations)

	// ---- 5. The walker observes the fork and rewinds. ---------------------
	for _, w := range walkers {
		drain(t, ctx, w.s, "walker "+w.name)
	}
	epochs := countReorgEpochs(t, ctx, dsn)
	require.GreaterOrEqualf(t, epochs, 1,
		"the walker completed its drain without recording a durable reorg epoch — the same-height/different-hash fork was not detected")

	// ---- 6. THE GATE REFUSES while the epoch is unacknowledged. -----------
	// Thin stand-in for Task 5's watermark reader, same predicate, same two
	// store surfaces (see riskGate).
	requireGate(t, ctx, dsn, false, "after the rewind, before any engine acknowledges the epoch")

	// ---- 7. The derivers acknowledge (RewindDerived + RewindParams). ------
	for _, r := range runners {
		drain(t, ctx, r.s, "runner "+r.name)
	}
	requireGate(t, ctx, dsn, true, "after both engines acknowledged the epoch")

	// ---- 8. Recompute and prove REPLACED, NOT ORPHANED. -------------------
	runPipeline(t, ctx, walkers, runners)
	head2 := fork.head()
	rows, err = st.ParamsAsOf(ctx, derive.ParamEngineName, ethChainID, head2)
	require.NoError(t, err)
	require.Lenf(t, rows, 1,
		"param_history holds %d rows after the reorg — the reorged-away tuple was ORPHANED alongside the re-mined one, and every as-of read below the new row's height would return the wrong parameters", len(rows))
	requireTuple(t, rows[0], ltv2, lt2, bonus2, "post-reorg (re-mined) tuple")
	require.Equalf(t, emit2, rows[0].EffectiveBlock, "the re-derived row is effective at %d, the re-executed event was emitted at %d", rows[0].EffectiveBlock, emit2)

	// Belt and braces, straight at the table: NO row anywhere carries the
	// reorged-away tuple, at any height, under any engine.
	orphans := countParamRowsWithLTV(t, ctx, dsn, ltv1)
	require.Zerof(t, orphans,
		"%d param_history row(s) still carry the reorged-away LTV %d — REPLACED-NOT-ORPHANED is violated", orphans, ltv1)

	// And the derived tuple is the chain's tuple, read back through the fork.
	chainCfg := decodeReserveConfig(unpackReserveConfigData(t, mGetConfiguration,
		fork.ethCall(pool, packCall(t, mGetConfiguration, collateralReserve), head2)))
	require.Equal(t, chainCfg.LTV.String(), rows[0].LTV.String(), "derived LTV vs getConfiguration on the re-mined chain")
	require.Equal(t, chainCfg.LiqThreshold.String(), rows[0].LiqThreshold.String(), "derived liquidation threshold vs getConfiguration on the re-mined chain")
	require.Equal(t, chainCfg.LiqBonus.String(), rows[0].LiqBonus.String(), "derived liquidation bonus vs getConfiguration on the re-mined chain")

	t.Logf("leg 3 PASS: admin %s resolved on-chain, tuple %d/%d/%d emitted at %d, anvil_reorg(depth=%d) same-height/different-hash, %d durable epoch(s), gate refused then allowed, tuple %d/%d/%d re-derived at %d, %d orphan rows",
		aclAdmin.Hex(), ltv1, lt1, bonus1, emit1, depth, epochs, ltv2, lt2, bonus2, emit2, orphans)
}

// emitCollateralConfig sends configureReserveAsCollateral from the resolved
// admin, mines it, and returns the block carrying its
// CollateralConfigurationChanged log.
//
// It requires EXACTLY ONE such log at the configurator, decoded by the
// PRODUCTION registry (never by a transcribed topic0) and carrying exactly
// the tuple that was asked for. If the governance call ever starts emitting a
// different event shape, this fails here — at the point where the leg's
// subject is created — instead of downstream where it would read as a
// derivation bug.
func emitCollateralConfig(t *testing.T, fork *anvilFork, registry *decode.Registry, from, configurator common.Address, m abi.Method, reserve common.Address, ltv, lt, bonus int64) uint64 {
	t.Helper()
	data := packCall(t, m, reserve, big.NewInt(ltv), big.NewInt(lt), big.NewInt(bonus))
	tx := fork.sendTx(from, configurator, data)
	fork.mine(1)
	blockNumber, logs := fork.minedReceipt(tx)

	emitted := 0
	for _, l := range logs {
		if l.Address != configurator {
			continue
		}
		ev, known, err := registry.Decode(derive.ParamEngineName, rawFromChainLog(l))
		require.NoErrorf(t, err, "decode the synthetic configurator log at %d/%d", l.BlockNumber, l.Index)
		if !known || ev.Name() != "AaveCfgCollateralConfigurationChanged" {
			continue
		}
		got, ok := ev.(decode.AaveCfgCollateralConfigurationChanged)
		require.Truef(t, ok, "decoded event is %T, not AaveCfgCollateralConfigurationChanged", ev)
		require.Equal(t, reserve, got.Asset, "the emitted event names a different reserve")
		require.Equal(t, fmt.Sprint(ltv), got.LTV.String(), "the emitted event carries a different LTV")
		require.Equal(t, fmt.Sprint(lt), got.LiquidationThreshold.String(), "the emitted event carries a different liquidation threshold")
		require.Equal(t, fmt.Sprint(bonus), got.LiquidationBonus.String(), "the emitted event carries a different liquidation bonus")
		emitted++
	}
	require.Equalf(t, 1, emitted,
		"configureReserveAsCollateral(%s, %d, %d, %d) emitted %d CollateralConfigurationChanged logs at %s, want exactly 1 — the leg's subject is ambiguous",
		reserve.Hex(), ltv, lt, bonus, emitted, configurator.Hex())
	t.Logf("synthetic governance call mined at block %d: %s → LTV %d / LT %d / bonus %d", blockNumber, reserve.Hex(), ltv, lt, bonus)
	return blockNumber
}

// rawFromChainLog converts a chain log into the store's raw shape so the
// PRODUCTION decoder can be pointed at it directly.
func rawFromChainLog(l types.Log) store.RawLog {
	topics := make([][]byte, len(l.Topics))
	for i, tp := range l.Topics {
		topics[i] = tp.Bytes()
	}
	return store.RawLog{
		ChainID: ethChainID, BlockNumber: l.BlockNumber, BlockHash: l.BlockHash.Bytes(),
		TxHash: l.TxHash.Bytes(), LogIndex: uint32(l.Index), Address: l.Address.Bytes(),
		Topics: topics, Data: l.Data,
	}
}

// requireTuple asserts a param row's three risk numbers.
func requireTuple(t *testing.T, r store.ParamRow, ltv, lt, bonus int64, what string) {
	t.Helper()
	require.NotNilf(t, r.LTV, "%s: row carries no LTV", what)
	require.Equalf(t, fmt.Sprint(ltv), r.LTV.String(), "%s: LTV", what)
	require.Equalf(t, fmt.Sprint(lt), r.LiqThreshold.String(), "%s: liquidation threshold", what)
	require.Equalf(t, fmt.Sprint(bonus), r.LiqBonus.String(), "%s: liquidation bonus", what)
}

// requireGate runs the thin consumer and asserts its verdict, quoting the
// refusal reason on failure so a wrong verdict is diagnosable.
func requireGate(t *testing.T, ctx context.Context, dsn string, wantAllowed bool, when string) {
	t.Helper()
	conn, err := pgx.Connect(ctx, dsn)
	require.NoError(t, err, "connect for the gate read")
	defer conn.Close(ctx)
	v, err := riskGate(ctx, conn)
	require.NoError(t, err, "gate read")
	require.Equalf(t, wantAllowed, v.Allowed,
		"gate verdict %s: allowed=%v, want %v (reason: %s)", when, v.Allowed, wantAllowed, v.Reason)
	t.Logf("gate %s: allowed=%v %s", when, v.Allowed, v.Reason)
}

// ===========================================================================
// Shared pipeline plumbing
// ===========================================================================

type namedStepper struct {
	name string
	s    stepper
}

// dialFork wires the production chain client at the fork and verifies the
// chain id — a fork of the wrong chain fails before it can be walked.
func dialFork(t *testing.T, ctx context.Context, fork *anvilFork) *chain.Failover {
	t.Helper()
	ch, err := chain.Dial(ctx, []string{fork.endpoint})
	require.NoError(t, err, "dial the fork through the production chain client")
	require.NoErrorf(t, ch.VerifyChainID(ctx, ethChainID), "the fork does not report chain id %d", ethChainID)
	return ch
}

// buildWalkers constructs one production ingest.Walker per stream.
func buildWalkers(t *testing.T, ch ingest.Chain, st ingest.Store, streams []streamCfg) []namedStepper {
	t.Helper()
	out := make([]namedStepper, 0, len(streams))
	for _, s := range streams {
		out = append(out, namedStepper{s.Name, ingest.NewWalker(ch, st, ingest.WalkerConfig{
			Stream: s.Name, ChainID: ethChainID, Addresses: s.Addresses,
			StartBlock: s.StartBlock, Window: s.Window, Confirmations: s.Confirmations,
		})})
	}
	return out
}

// runPipeline drains ingest, then derivation, then re-drains both and
// REQUIRES the second pass to be a no-op. The re-drain is the convergence
// proof: a pipeline that keeps finding work after it claimed to be caught up
// is not settled, and every assertion taken against it is a snapshot of a
// moving target.
func runPipeline(t *testing.T, ctx context.Context, walkers, runners []namedStepper) {
	t.Helper()
	for _, w := range walkers {
		drain(t, ctx, w.s, "walker "+w.name)
	}
	for _, r := range runners {
		drain(t, ctx, r.s, "runner "+r.name)
	}
	for _, w := range walkers {
		require.Zerof(t, drain(t, ctx, w.s, "walker "+w.name+" (convergence)"),
			"walker %s still had work after the pipeline claimed to be caught up", w.name)
	}
	for _, r := range runners {
		require.Zerof(t, drain(t, ctx, r.s, "runner "+r.name+" (convergence)"),
			"runner %s still had work after the pipeline claimed to be caught up", r.name)
	}
}

// onlyAddress returns the single address a stream declares, refusing a
// registry that has grown a second one under a name this harness treats as a
// singleton.
func onlyAddress(t *testing.T, reg map[string]streamCfg, name string) common.Address {
	t.Helper()
	s, ok := reg[name]
	require.Truef(t, ok, "config/contracts.json declares no stream %q", name)
	require.Lenf(t, s.Addresses, 1, "stream %q declares %d addresses; this harness treats it as a singleton", name, len(s.Addresses))
	return s.Addresses[0]
}

// forkLogsOverRange reads the range through the fork in window-sized chunks —
// the upstream's 10-block eth_getLogs cap applies to this direct read exactly
// as it applies to the walker's.
func forkLogsOverRange(t *testing.T, fork *anvilFork, from, to uint64, addrs []common.Address) []types.Log {
	t.Helper()
	var out []types.Log
	for lo := from; lo <= to; lo += forkWindow {
		hi := lo + forkWindow - 1
		if hi > to {
			hi = to
		}
		out = append(out, fork.getLogs(lo, hi, addrs)...)
	}
	return out
}

// assertLogSetsIdentical proves the walker's persisted bytes and the fork's
// directly-read bytes are the same logs with the same contents — set equality
// by (block, logIndex) FIRST (so a missing or extra log fails as itself), then
// field-by-field byte equality.
func assertLogSetsIdentical(t *testing.T, stored []store.RawLog, direct []types.Log, what string) {
	t.Helper()
	key := func(b uint64, i uint32) string { return fmt.Sprintf("%d/%d", b, i) }
	storedBy := map[string]store.RawLog{}
	var storedKeys []string
	for _, l := range stored {
		k := key(l.BlockNumber, l.LogIndex)
		_, dup := storedBy[k]
		require.Falsef(t, dup, "%s: raw_logs holds two rows at %s", what, k)
		storedBy[k] = l
		storedKeys = append(storedKeys, k)
	}
	directBy := map[string]types.Log{}
	var directKeys []string
	for _, l := range direct {
		k := key(l.BlockNumber, uint32(l.Index))
		_, dup := directBy[k]
		require.Falsef(t, dup, "%s: the fork returned two logs at %s", what, k)
		directBy[k] = l
		directKeys = append(directKeys, k)
	}
	sort.Strings(storedKeys)
	sort.Strings(directKeys)
	require.Equalf(t, directKeys, storedKeys,
		"%s: the set of (block/logIndex) the walker persisted differs from what the fork serves directly", what)
	require.NotEmptyf(t, storedKeys, "%s: both sides are EMPTY — an empty comparison is not a custody proof", what)
	for _, k := range storedKeys {
		assertRawLogMatchesChainLog(t, storedBy[k], directBy[k], what)
	}
}

// assertRawLogMatchesChainLog is the byte-level identity: address, every
// topic, the data body, the transaction hash and the block hash.
func assertRawLogMatchesChainLog(t *testing.T, row store.RawLog, l types.Log, what string) {
	t.Helper()
	at := fmt.Sprintf("%s log %d/%d", what, l.BlockNumber, l.Index)
	require.Equalf(t, l.BlockNumber, row.BlockNumber, "%s: block number", at)
	sameBytes(t, l.Address.Bytes(), row.Address, at+": address")
	sameBytes(t, l.BlockHash.Bytes(), row.BlockHash, at+": block hash")
	sameBytes(t, l.TxHash.Bytes(), row.TxHash, at+": transaction hash")
	require.Equalf(t, len(l.Topics), len(row.Topics), "%s: topic count", at)
	for i := range l.Topics {
		sameBytes(t, l.Topics[i].Bytes(), row.Topics[i], fmt.Sprintf("%s: topic %d", at, i))
	}
	sameBytes(t, l.Data, row.Data, at+": data body")
}

// sameBytes compares two byte strings by their hex rendering. Comparing the
// slices directly would make a nil and an empty slice unequal — an artifact
// of Go, not of the chain — and would report a mismatch as two unreadable
// byte dumps.
func sameBytes(t *testing.T, want, got []byte, what string) {
	t.Helper()
	require.Equalf(t, hex.EncodeToString(want), hex.EncodeToString(got), "%s", what)
}

// ---------------------------------------------------------------------------
// The committed-fixture witness
// ---------------------------------------------------------------------------

// cfgFixture is one entry of internal/decode/testdata/configurator_inventory.json.
type cfgFixture struct {
	Provenance  string            `json:"provenance"`
	Synthetic   bool              `json:"synthetic"`
	Event       string            `json:"event"`
	ChainID     uint64            `json:"chainId"`
	BlockNumber uint64            `json:"blockNumber"`
	BlockHash   string            `json:"blockHash"`
	TxHash      string            `json:"txHash"`
	LogIndex    uint32            `json:"logIndex"`
	Address     string            `json:"address"`
	Topics      []string          `json:"topics"`
	Data        string            `json:"data"`
	Want        map[string]string `json:"want"`
}

// assertConfiguratorFixture is leg 1's INDEPENDENT SECOND WITNESS. For every
// REAL committed fixture row that falls inside the walked range it requires
// (a) a raw_logs row at the same (block, logIndex), (b) byte identity of
// address/topics/data/txHash/blockHash, and (c) that the production decoder
// names the same event the fixture names. Synthetic fixture rows are skipped
// by name: they were authored, not observed, and cannot witness custody.
func assertConfiguratorFixture(t *testing.T, registry *decode.Registry, stored []store.RawLog, from, to uint64) int {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join("..", "..", "internal", "decode", "testdata", "configurator_inventory.json"))
	require.NoError(t, err, "read internal/decode/testdata/configurator_inventory.json")
	var fixtures []cfgFixture
	require.NoError(t, json.Unmarshal(raw, &fixtures), "parse the configurator inventory fixture")
	require.NotEmpty(t, fixtures, "the configurator inventory fixture is empty")

	byKey := map[string]store.RawLog{}
	for _, l := range stored {
		byKey[fmt.Sprintf("%d/%d", l.BlockNumber, l.LogIndex)] = l
	}

	matched := 0
	for _, f := range fixtures {
		if f.BlockNumber < from || f.BlockNumber > to {
			continue
		}
		if f.Synthetic {
			t.Logf("fixture witness: skipping SYNTHETIC entry %s at %d/%d — an authored row cannot witness custody", f.Event, f.BlockNumber, f.LogIndex)
			continue
		}
		require.Equalf(t, ethChainID, f.ChainID, "fixture %s at %d/%d is not an ETH mainnet row", f.Event, f.BlockNumber, f.LogIndex)
		k := fmt.Sprintf("%d/%d", f.BlockNumber, f.LogIndex)
		row, ok := byKey[k]
		require.Truef(t, ok,
			"committed fixture %s pins a log at %s that the walker never persisted — the pipeline's custody of the genesis cluster is INCOMPLETE against an independently-captured witness", f.Event, k)
		sameBytes(t, mustHex(t, f.Address), row.Address, fmt.Sprintf("fixture %s at %s: address", f.Event, k))
		sameBytes(t, mustHex(t, f.BlockHash), row.BlockHash, fmt.Sprintf("fixture %s at %s: block hash", f.Event, k))
		sameBytes(t, mustHex(t, f.TxHash), row.TxHash, fmt.Sprintf("fixture %s at %s: transaction hash", f.Event, k))
		require.Equalf(t, len(f.Topics), len(row.Topics), "fixture %s at %s: topic count", f.Event, k)
		for i := range f.Topics {
			sameBytes(t, mustHex(t, f.Topics[i]), row.Topics[i], fmt.Sprintf("fixture %s at %s: topic %d", f.Event, k, i))
		}
		sameBytes(t, mustHex(t, f.Data), row.Data, fmt.Sprintf("fixture %s at %s: data body", f.Event, k))

		// The decode layer joins the weld: same bytes AND same event identity.
		ev, known, err := registry.Decode(derive.ParamEngineName, row)
		require.NoErrorf(t, err, "decode fixture-matched log at %s", k)
		require.Truef(t, known,
			"the aave_param registry does not recognise topic0 %x at %s, which the committed inventory names %s — the closed topic0 inventory has drifted", row.Topics[0], k, f.Event)
		require.Equalf(t, f.Event, ev.Name(), "decoded event name at %s", k)
		matched++
	}
	return matched
}

func mustHex(t *testing.T, s string) []byte {
	t.Helper()
	b, err := hex.DecodeString(strings.TrimPrefix(strings.ToLower(s), "0x"))
	require.NoErrorf(t, err, "fixture value %q is not hex", s)
	return b
}

// ---------------------------------------------------------------------------
// Direct reads of derived state
//
// These go straight at the derived scratch database's tables. *store.Store
// exposes no "every position balance" reader (BalancesFor is per-account and
// SnapshotAccounts is debt-side only), and inventing one for a test would be
// production surface added for a harness. The harness owns this database
// outright, so reading it directly is honest; every WRITE above went through
// the production store.
// ---------------------------------------------------------------------------

type derivedBalance struct {
	Account, Asset common.Address
	Side           string
	Amount         *big.Int
}

func readPositionBalances(t *testing.T, ctx context.Context, dsn, engine string) []derivedBalance {
	t.Helper()
	conn, err := pgx.Connect(ctx, dsn)
	require.NoError(t, err, "connect to read position_balances")
	defer conn.Close(ctx)
	rows, err := conn.Query(ctx,
		`SELECT account, asset, side, amount::text, source FROM position_balances
		 WHERE engine = $1 ORDER BY account, asset, side`, engine)
	require.NoError(t, err, "query position_balances")
	defer rows.Close()
	var out []derivedBalance
	for rows.Next() {
		var account, asset []byte
		var side, amount, source string
		require.NoError(t, rows.Scan(&account, &asset, &side, &amount, &source))
		require.Equalf(t, "event", source,
			"position_balances row for %x carries source %q — this harness never runs the snapshotter, so only event-sourced rows may exist", account, source)
		v, ok := new(big.Int).SetString(amount, 10)
		require.Truef(t, ok, "amount %q is not an integer", amount)
		out = append(out, derivedBalance{
			Account: common.BytesToAddress(account), Asset: common.BytesToAddress(asset),
			Side: side, Amount: v,
		})
	}
	require.NoError(t, rows.Err())
	return out
}

func readDeriveCursors(t *testing.T, ctx context.Context, dsn string) []string {
	t.Helper()
	conn, err := pgx.Connect(ctx, dsn)
	require.NoError(t, err, "connect to read derive_cursors")
	defer conn.Close(ctx)
	rows, err := conn.Query(ctx, `SELECT engine FROM derive_cursors ORDER BY engine`)
	require.NoError(t, err, "query derive_cursors")
	defer rows.Close()
	var out []string
	for rows.Next() {
		var e string
		require.NoError(t, rows.Scan(&e))
		out = append(out, e)
	}
	require.NoError(t, rows.Err())
	return out
}

type cursorPos struct {
	block uint64
	hash  []byte
}

func readIngestCursor(t *testing.T, ctx context.Context, dsn, stream string) cursorPos {
	t.Helper()
	conn, err := pgx.Connect(ctx, dsn)
	require.NoError(t, err, "connect to read ingest_cursors")
	defer conn.Close(ctx)
	var c cursorPos
	require.NoErrorf(t, conn.QueryRow(ctx,
		`SELECT last_block, last_block_hash FROM ingest_cursors WHERE stream = $1`, stream).Scan(&c.block, &c.hash),
		"read the ingest cursor for %q", stream)
	return c
}

func countReorgEpochs(t *testing.T, ctx context.Context, dsn string) int {
	t.Helper()
	conn, err := pgx.Connect(ctx, dsn)
	require.NoError(t, err, "connect to count reorg_epochs")
	defer conn.Close(ctx)
	var n int
	require.NoError(t, conn.QueryRow(ctx, `SELECT count(*) FROM reorg_epochs`).Scan(&n))
	return n
}

func countParamRowsWithLTV(t *testing.T, ctx context.Context, dsn string, ltv int64) int {
	t.Helper()
	conn, err := pgx.Connect(ctx, dsn)
	require.NoError(t, err, "connect to count param_history")
	defer conn.Close(ctx)
	var n int
	require.NoError(t, conn.QueryRow(ctx, `SELECT count(*) FROM param_history WHERE ltv = $1`, ltv).Scan(&n))
	return n
}
