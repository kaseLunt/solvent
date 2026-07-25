// Package prices ingests ORACLE PRICES into the store's `prices` table along
// the two mechanisms the recon pass established (recon/derivation-notes.md,
// "Oracle wiring" — NORMATIVE for this task), driven by the per-asset registry
// in recon/feeds.json.
//
// # OP / Debt Manager — POLL-ONLY AND ENGINE-EXACT
//
// Poller reads PriceProviderV2.price(token) at
// 0x44dd2372FE7B97C4B4D6a7d4DeCf72466485BAcB — USD with 6 decimals per WHOLE
// token — for every registry `poll` asset each SOLVENT_PRICE_INTERVAL. This is
// not a convenience shortcut: it is the EXACT function DebtManagerCore calls at
// borrow, repay and liquidation time (DebtManagerCore.sol:378, 501), so the
// polled number is the number the engine charges against. There is no
// AnswerUpdated stream that reproduces it, and three separate reasons make
// substituting one wrong:
//
//   - isStableToken configs SNAP to exactly 1e6 inside a ±1% band
//     (PriceProvider.sol:303-310), so the underlying Chainlink stream and the
//     engine price genuinely differ. What the contract returns is RECORDED
//     VERBATIM — never re-derived, never "corrected" back toward the stream.
//   - the accountant-lens assets (liquidETH/liquidBTC/liquidUSD/eBTC/eUSD/
//     sETHFI) are pure view rates that emit NO logs at all.
//   - the custom-feed assets (EURC/WHYPE/ETHFI/beHYPE) are push-updated stores
//     with no Chainlink interface.
//
// # ETH / Aave — CHAINLINK STREAMS BEHIND CAP ADAPTERS
//
// FeedDeriver reads AnswerUpdated logs (topic0
// 0x0559884fd3a460db3073b7fc896cc77986f16e378210ded43186175bf646fc5f, 8
// decimals) back out of raw_logs — the walker already ingests the four raw
// aggregators as `chainlink_feed` streams, so this path is a READER over
// committed raw logs, not a new walker — and records one row per update under
// source "chainlink:<aggregator-address>".
//
// KNOWN LIMITATION, STATED PLAINLY: this stream reproduces the UNCAPPED FEED,
// not the price Aave actually uses. AaveOracle.getSourceOfAsset returns
// price-CAP ADAPTERS: the stable adapters return min(feed, priceCap) and the
// weETH adapter is getRate() x ETH/USD with a GROWTH-CAPPED rate. The rows this
// package writes therefore equal the adapter output only while no cap binds —
// which is the normal case, since caps bind in depeg and exploit scenarios,
// exactly the scenarios a liquidation engine cares most about. Nothing here
// claims stream == adapter price; a cap-aware read is out of scope for Task 8.
//
// weETH gets BOTH rows and NO composition: the ETH/USD stream row (from the
// aggregator behind the adapter) and a POLLED getRate() ratio row under source
// "ratio:getrate:<contract>". The P3 risk engine composes them; composing at
// ingest time would bake one particular pairing of two independently-timed
// observations into storage and lose the ability to re-time it.
//
// PHASE CHANGES: a Chainlink PROXY re-points aggregator() on a phase change, so
// the raw aggregator recorded in the registry covers the CURRENT PHASE ONLY —
// after a phase change the configured stream simply stops producing updates.
// FeedDeriver answers that with the honest operator signal and nothing more:
// a WARN, a FAILED health check, and a re-resolution of the proxy's
// aggregator() whose result is logged. Config repair stays MANUAL. There is NO
// auto-repointing; that is a deliberate, declared deferral, not an omission.
//
// # REORG POSTURE — BOTH WRITERS SIT ON THE EPOCH GATE
//
// Every price row is stamped with the block it describes, so a reorg that
// replaces that block leaves the row describing a chain that no longer exists.
// Both writers therefore own a PSEUDO-ENGINE derive cursor (DeriveCursor is
// keyed by engine string, and these keys are colon-namespaced so they can never
// collide with a config engine name) and go through store.ApplyPrices /
// store.RewindPrices, which are the epoch-gated, source-scoped counterparts of
// ApplyDerivedWithRates / RewindDerived. A rewind deletes the writer's rows
// above the effective target INSIDE the same transaction as the epoch ack, so a
// crash can never leave the ack recorded while orphaned price rows survive.
//
// Consequence to know about (review flag M4): store.PruneAckedReorgEpochs
// deletes an epoch only once EVERY derive cursor on its chain has acked it, so
// the price cursors now gate pruning too. A price writer that stops running
// permanently holds its chain's epochs forever — the same bounded, visible cost
// the derive engines already carry, and the reason the cursors are per-chain
// rather than global.
//
// ONE HONEST COST of routing the poller through that mechanism: it cannot
// re-derive what a rewind deleted (it only ever reads `latest`; see
// store/prices.go's ASYMMETRY note), and the rewind target is the WALKER's
// verified ancestor, which can sit well below the actual fork point when raw
// logs are sparse — degenerately, a stream's StartBlock-1. A deep rewind
// therefore discards polled price history for heights that were in all
// likelihood canonical, and the worst case discards all of it. The distance is
// WARNed (see Poller.rewind), and the next round re-establishes a price at the
// new head within one cadence interval. The alternative — acking the epoch while
// keeping the rows — would leave this table asserting engine-exact prices at
// heights the chain may have replaced, which for a liquidation-facing store is
// the worse failure.
//
// # NOT SAFE FOR CONCURRENT USE
//
// Poller.Step and FeedDeriver.Step are driven from the daemon's single loop
// under the single-writer contract (D-004), like every other worker in this
// codebase.
package prices

import (
	"context"
	"encoding/hex"
	"fmt"
	"math/big"
	"reflect"
	"strings"
	"time"

	"github.com/ethereum/go-ethereum/accounts/abi"
	"github.com/ethereum/go-ethereum/common"

	"github.com/kaselunt/solvent/internal/chain"
	"github.com/kaselunt/solvent/internal/config"
	"github.com/kaselunt/solvent/internal/store"
)

// ---------------------------------------------------------------------------
// Pseudo-engine cursor keys.
// ---------------------------------------------------------------------------

// Cursor keys are COLON-NAMESPACED and CHAIN-ID-QUALIFIED:
//
//   - the colon guarantees they can never collide with a config.KnownEngines
//     value (engine names carry no colons), so a price cursor and a derive
//     engine's cursor are structurally distinct rows in derive_cursors — the
//     accepted resolution of review flag M4;
//   - the chain id (not the config chain KEY) qualifies them because a derive
//     cursor is chain-bound to ONE chain and the poller spans two (the
//     PriceProviderV2 assets on OP and the weETH getRate() ratio on ETH),
//     while chain ids are immutable facts and config keys are renameable.
const (
	cursorPrefixPoll = "prices:poll:"
	cursorPrefixFeed = "prices:chainlink_feed:"
)

// PollCursorEngine is the pseudo-engine key the poller's cursor lives under for
// chainID.
func PollCursorEngine(chainID uint64) string {
	return fmt.Sprintf("%s%d", cursorPrefixPoll, chainID)
}

// FeedCursorEngine is the pseudo-engine key the Chainlink feed deriver's cursor
// lives under for chainID.
func FeedCursorEngine(chainID uint64) string {
	return fmt.Sprintf("%s%d", cursorPrefixFeed, chainID)
}

// ---------------------------------------------------------------------------
// prices.source naming.
// ---------------------------------------------------------------------------

// SourcePriceProviderV2 is the mechanism name for the engine-exact Debt Manager
// poll (recon "Oracle wiring": source = priceproviderv2, price_decimals = 6).
const SourcePriceProviderV2 = "priceproviderv2"

// ChainlinkSource is the mechanism name for one raw aggregator's AnswerUpdated
// stream: "chainlink:<aggregator>", lowercase 0x-prefixed hex. Lowercase, not
// EIP-55 checksummed, so the string is a deterministic function of the address
// bytes — a checksum-cased variant would silently split one aggregator's
// history into two sources.
func ChainlinkSource(aggregator common.Address) string {
	return "chainlink:0x" + hex.EncodeToString(aggregator.Bytes())
}

// RatioSource is the mechanism name for a polled exchange-ratio view:
// "ratio:<method>:<contract>" with the method lowercased and stripped of its
// argument list ("getRate()" -> "getrate"). The METHOD is part of the name
// because a contract may expose more than one ratio view, and a source string
// has to identify the reading uniquely on its own.
func RatioSource(method string, contract common.Address) string {
	return fmt.Sprintf("ratio:%s:0x%s", normalizeMethodName(method), hex.EncodeToString(contract.Bytes()))
}

// normalizeMethodName reduces a solidity signature to a lowercase bare name.
func normalizeMethodName(signature string) string {
	name := signature
	if i := strings.IndexByte(name, '('); i >= 0 {
		name = name[:i]
	}
	return strings.ToLower(name)
}

// ---------------------------------------------------------------------------
// Supported oracle views.
// ---------------------------------------------------------------------------

// priceProviderABI carries PriceProviderV2.price(address) -> uint256 (USD,
// 6-dec per whole token). Selector 0xaea91078, pinned by TestSelectors.
var priceProviderABI = mustParseABI(`[{
	"type": "function",
	"name": "price",
	"stateMutability": "view",
	"inputs": [{"name": "token", "type": "address"}],
	"outputs": [{"name": "", "type": "uint256"}]
}]`)

// rateProviderABI carries getRate() -> uint256, the argument-free exchange-rate
// view Aave's weETH adapter uses as its RATIO_PROVIDER. Selector 0x679aefce,
// which recon independently recorded as the accountant-lens calldata
// ("calldata 0x679aefce = getRate()"); pinned by TestSelectors.
var rateProviderABI = mustParseABI(`[{
	"type": "function",
	"name": "getRate",
	"stateMutability": "view",
	"inputs": [],
	"outputs": [{"name": "", "type": "uint256"}]
}]`)

// chainlinkProxyABI carries aggregator() -> address, re-resolved on a stale
// stream to surface a phase change. Selector 0x245a7bfc, pinned by
// TestSelectors.
var chainlinkProxyABI = mustParseABI(`[{
	"type": "function",
	"name": "aggregator",
	"stateMutability": "view",
	"inputs": [],
	"outputs": [{"name": "", "type": "address"}]
}]`)

// pollView is one SUPPORTED oracle view. The map below is a CLOSED
// capability set: a registry entry naming a method that is not here is refused
// at construction time, never skipped at runtime — a silently-skipped asset is
// a silently-missing price.
//
// Each view owns its own unpacker, so adding a view with a different return
// shape is a local change rather than a shared assumption.
type pollView struct {
	// pack builds the calldata. asset is the token being priced; argument-free
	// views ignore it.
	pack func(asset common.Address) ([]byte, error)
	// unpack decodes the view's return into the integer recorded as the price.
	unpack func(ret []byte) (*big.Int, error)
	// source names the mechanism the resulting rows carry, given the contract
	// that was read.
	source func(contract common.Address) string
}

var pollViews = map[string]pollView{
	"price(address)": {
		pack: func(asset common.Address) ([]byte, error) {
			return priceProviderABI.Pack("price", asset)
		},
		unpack: func(ret []byte) (*big.Int, error) {
			return unpackUint256("price", priceProviderABI, ret)
		},
		// The recon-mandated flat literal, deliberately NOT address-qualified.
		// buildPollTargets enforces that every row under it comes from ONE
		// contract, so the un-qualified name can never conflate two oracles.
		source: func(common.Address) string { return SourcePriceProviderV2 },
	},
	"getRate()": {
		pack: func(common.Address) ([]byte, error) {
			return rateProviderABI.Pack("getRate")
		},
		unpack: func(ret []byte) (*big.Int, error) {
			return unpackUint256("getRate", rateProviderABI, ret)
		},
		source: func(contract common.Address) string { return RatioSource("getRate()", contract) },
	},
}

func mustParseABI(jsonArray string) abi.ABI {
	parsed, err := abi.JSON(strings.NewReader(jsonArray))
	if err != nil {
		panic(fmt.Sprintf("prices: build abi: %v", err))
	}
	return parsed
}

// unpackUint256 decodes a single-uint256 view return. Any panic from malformed
// provider bytes is converted into an error.
func unpackUint256(name string, abiDef abi.ABI, ret []byte) (v *big.Int, err error) {
	defer func() {
		if rec := recover(); rec != nil {
			v, err = nil, fmt.Errorf("unpack %s: recovered panic: %v", name, rec)
		}
	}()
	vals, err := abiDef.Unpack(name, ret)
	if err != nil {
		return nil, fmt.Errorf("unpack %s: %w", name, err)
	}
	if len(vals) != 1 {
		return nil, fmt.Errorf("unpack %s: expected 1 value, got %d", name, len(vals))
	}
	out, ok := vals[0].(*big.Int)
	if !ok || out == nil {
		return nil, fmt.Errorf("unpack %s: value is %T, not a *big.Int", name, vals[0])
	}
	return out, nil
}

// unpackAddress decodes a single-address view return (aggregator()).
func unpackAddress(name string, abiDef abi.ABI, ret []byte) (a common.Address, err error) {
	defer func() {
		if rec := recover(); rec != nil {
			a, err = common.Address{}, fmt.Errorf("unpack %s: recovered panic: %v", name, rec)
		}
	}()
	vals, err := abiDef.Unpack(name, ret)
	if err != nil {
		return common.Address{}, fmt.Errorf("unpack %s: %w", name, err)
	}
	if len(vals) != 1 {
		return common.Address{}, fmt.Errorf("unpack %s: expected 1 value, got %d", name, len(vals))
	}
	out, ok := vals[0].(common.Address)
	if !ok {
		return common.Address{}, fmt.Errorf("unpack %s: value is %T, not an address", name, vals[0])
	}
	return out, nil
}

// ---------------------------------------------------------------------------
// multicall3.
// ---------------------------------------------------------------------------

// Multicall3Address is the canonical multicall3 deployment — the same address
// on OP as on Ethereum mainnet.
var Multicall3Address = common.HexToAddress("0xcA11bde05977b3631167028862bE2a173976CA11")

// multicall3ABI carries tryBlockAndAggregate, chosen for the same reason the
// collateral snapshotter chose it: it returns the EXECUTION BLOCK NUMBER
// atomically with the results, so every price row is stamped with the block it
// was actually read at rather than a separately-fetched head that may have
// moved. Selector 0x399542e9, pinned by TestSelectors.
//
// DELIBERATE DUPLICATION (disclosed): internal/snapshot carries its own copy of
// this ABI, its call tuple and its unpacker. Extracting a shared multicall
// package would mean editing the freshly-reviewed snapshotter and its response
// builders, which is outside a price task's blast radius; the copy here is
// independently selector-pinned and panic-hardened. Extraction is a recommended
// follow-up, not a silent divergence.
var multicall3ABI = mustParseABI(`[{
	"type": "function",
	"name": "tryBlockAndAggregate",
	"stateMutability": "payable",
	"inputs": [
		{"name": "requireSuccess", "type": "bool"},
		{"name": "calls", "type": "tuple[]", "components": [
			{"name": "target", "type": "address"},
			{"name": "callData", "type": "bytes"}
		]}
	],
	"outputs": [
		{"name": "blockNumber", "type": "uint256"},
		{"name": "blockHash", "type": "bytes32"},
		{"name": "returnData", "type": "tuple[]", "components": [
			{"name": "success", "type": "bool"},
			{"name": "returnData", "type": "bytes"}
		]}
	]
}]`)

// multicall3Call is the (target, callData) tuple tryBlockAndAggregate takes.
type multicall3Call struct {
	Target   common.Address
	CallData []byte
}

type multicallResult struct {
	success    bool
	returnData []byte
}

// unpackMulticallResult decodes a tryBlockAndAggregate return: the execution
// block number and one (success, returnData) pair per submitted call. Any panic
// from malformed provider bytes is converted into an error.
func unpackMulticallResult(out []byte, wantCalls int) (block uint64, results []multicallResult, err error) {
	defer func() {
		if rec := recover(); rec != nil {
			block, results, err = 0, nil, fmt.Errorf("unpack multicall result: recovered panic: %v", rec)
		}
	}()
	vals, err := multicall3ABI.Unpack("tryBlockAndAggregate", out)
	if err != nil {
		return 0, nil, fmt.Errorf("unpack multicall result: %w", err)
	}
	if len(vals) != 3 {
		return 0, nil, fmt.Errorf("unpack multicall result: expected 3 values, got %d", len(vals))
	}
	blockNum, ok := vals[0].(*big.Int)
	if !ok || !blockNum.IsUint64() {
		return 0, nil, fmt.Errorf("unpack multicall result: block number %v is not a uint64", vals[0])
	}
	raw := reflect.ValueOf(vals[2])
	if raw.Kind() != reflect.Slice {
		return 0, nil, fmt.Errorf("unpack multicall result: returnData is %T, not a slice", vals[2])
	}
	if raw.Len() != wantCalls {
		return 0, nil, fmt.Errorf("unpack multicall result: %d results for %d calls", raw.Len(), wantCalls)
	}
	results = make([]multicallResult, raw.Len())
	for i := 0; i < raw.Len(); i++ {
		el := raw.Index(i)
		results[i] = multicallResult{
			success:    el.Field(0).Interface().(bool),
			returnData: el.Field(1).Interface().([]byte),
		}
	}
	return blockNum.Uint64(), results, nil
}

// ---------------------------------------------------------------------------
// Store and chain surfaces.
// ---------------------------------------------------------------------------

// PriceStore is the store surface both price writers drive (*store.Store
// satisfies it; tests pass fakes). Every method is one of Task 8's additive
// store entries or an existing Task 7 read — no existing signature moved.
type PriceStore interface {
	DeriveCursor(ctx context.Context, engine string) (block uint64, found bool, err error)
	HasUnackedReorg(ctx context.Context, engine string, chainID uint64) (bool, error)
	ApplyPrices(ctx context.Context, engine string, chainID uint64, obs []store.PriceObservation, throughBlock uint64) error
	RewindPrices(ctx context.Context, engine string, chainID uint64, toBlock uint64, sources []string) error
}

var _ PriceStore = (*store.Store)(nil)

// PollChain is the poller's chain surface (*chain.Failover satisfies it).
//
// CallFrom/EndpointCount back the SEMANTIC-staleness routing the collateral
// snapshotter established: an RPC endpoint frozen on old chain state answers
// eth_call successfully, so the failover client's own error-driven rotation
// never sees a problem — the poller has to route around it itself, with a
// CALLER-SCOPED preference that leaves the shared routing hint (which other
// callers' successes legitimately re-pin) alone.
type PollChain interface {
	CallWithToken(ctx context.Context, to common.Address, data []byte) ([]byte, chain.EndpointToken, error)
	CallFrom(ctx context.Context, startIndex int, to common.Address, data []byte) ([]byte, chain.EndpointToken, error)
	EndpointCount() int
}

var _ PollChain = (*chain.Failover)(nil)

// FeedChain is the feed deriver's chain surface (*chain.Failover satisfies it):
// a head probe, to tell "caught up to live head" apart from "still in
// backfill" before judging a stream stale, and a plain call for re-resolving a
// proxy's aggregator().
type FeedChain interface {
	BlockNumber(ctx context.Context) (uint64, error)
	Call(ctx context.Context, to common.Address, data []byte) ([]byte, error)
}

var _ FeedChain = (*chain.Failover)(nil)

// ---------------------------------------------------------------------------
// Batch de-duplication.
// ---------------------------------------------------------------------------

// priceSet accumulates one batch's observations keyed (asset, source, block)
// with LAST-WINS semantics and insertion-ordered output — the same shape (and
// the same reason) as the derivation runner's rateSet. store.ApplyPrices ABORTS
// a batch on a divergent replay of one key, so two legitimate observations for
// one key must collapse to the final value here rather than wedge the write:
// two AnswerUpdated rounds inside ONE block are rare but permitted by the
// aggregator, and it is the LAST one that the block ends at.
//
// Both writers push through this, not just the log-derived one: a poller that
// grows a second view on one asset would otherwise reintroduce the same wedge.
type priceSet struct {
	order []string
	byKey map[string]store.PriceObservation
}

func newPriceSet() *priceSet {
	return &priceSet{byKey: map[string]store.PriceObservation{}}
}

func (ps *priceSet) add(o store.PriceObservation) {
	key := fmt.Sprintf("%x/%s/%d", o.Asset, o.Source, o.BlockNumber)
	if _, ok := ps.byKey[key]; !ok {
		ps.order = append(ps.order, key)
	}
	// Defensive copies: the caller's slice/big.Int must not alias a value that
	// is about to be persisted. A nil price is passed through UNCHANGED rather
	// than copied (which would panic) or coerced to zero (which would fabricate
	// a price) — store.ApplyPrices refuses it with a named error, which is the
	// fail-loud path this layer wants.
	asset := make([]byte, len(o.Asset))
	copy(asset, o.Asset)
	o.Asset = asset
	if o.Price != nil {
		o.Price = new(big.Int).Set(o.Price)
	}
	ps.byKey[key] = o
}

// observations returns the deduped batch in insertion order.
func (ps *priceSet) observations() []store.PriceObservation {
	out := make([]store.PriceObservation, 0, len(ps.order))
	for _, key := range ps.order {
		out = append(out, ps.byKey[key])
	}
	return out
}

// ---------------------------------------------------------------------------
// Shared registry helpers.
// ---------------------------------------------------------------------------

// pollTarget is one resolved poll obligation: read `view` on `contract` for
// `asset`, record the result under `source` at `decimals`.
type pollTarget struct {
	Symbol   string
	Asset    common.Address
	Contract common.Address
	Method   string
	Source   string
	Decimals int32
	view     pollView
}

// buildPollTargets resolves chainID's poll obligations out of the registry: one
// target per `poll` asset (the primary oracle read) plus one per asset
// declaring a secondary `ratio` view. Registry order is preserved so a
// multicall's call order — and therefore the log/row order — is deterministic.
//
// An unsupported method is a CONSTRUCTION-TIME refusal: the registry declares
// what must be priced, and a method this build cannot pack would otherwise
// become an asset that silently has no prices.
func buildPollTargets(feeds *config.Feeds, chainID uint64) ([]pollTarget, error) {
	var out []pollTarget
	seen := map[string]string{}
	sourceContract := map[string]common.Address{}
	add := func(t pollTarget) error {
		view, ok := pollViews[t.Method]
		if !ok {
			return fmt.Errorf("registry asset %s (chain %d): oracle method %q is not supported by this build",
				t.Symbol, chainID, t.Method)
		}
		t.view = view
		t.Source = view.source(t.Contract)
		// A source name must identify ONE contract. SourcePriceProviderV2 is a
		// flat literal carrying no address, so two PriceProvider deployments
		// would otherwise write indistinguishable rows under it — the rows
		// would not collide on the PK (each asset appears once), they would just
		// silently claim a provenance they do not have.
		if prev, ok := sourceContract[t.Source]; ok && prev != t.Contract {
			return fmt.Errorf("registry asset %s (chain %d): source %q is already bound to contract %s, refusing to also serve it from %s",
				t.Symbol, chainID, t.Source, prev, t.Contract)
		}
		sourceContract[t.Source] = t.Contract
		// (asset, source) must be unique: two targets sharing it would write the
		// same prices PK twice per round, and a divergent pair would abort the
		// whole batch.
		key := fmt.Sprintf("%x/%s", t.Asset, t.Source)
		if prev, dup := seen[key]; dup {
			return fmt.Errorf("registry asset %s (chain %d): source %q already bound to %s",
				t.Symbol, chainID, t.Source, prev)
		}
		seen[key] = t.Symbol
		out = append(out, t)
		return nil
	}
	for _, a := range feeds.Assets {
		if a.ChainID != chainID {
			continue
		}
		if a.Oracle.Kind == config.FeedKindPoll {
			if err := add(pollTarget{
				Symbol: a.Symbol, Asset: a.Address, Contract: a.Oracle.Contract,
				Method: a.Oracle.Method, Decimals: a.Oracle.PriceDecimals,
			}); err != nil {
				return nil, err
			}
		}
		if a.Ratio != nil {
			if err := add(pollTarget{
				Symbol: a.Symbol, Asset: a.Address, Contract: a.Ratio.Contract,
				Method: a.Ratio.Method, Decimals: a.Ratio.Decimals,
			}); err != nil {
				return nil, err
			}
		}
	}
	return out, nil
}

// sourcesOf returns the distinct source strings a target set owns, in first
// appearance order — the ownership scope handed to store.RewindPrices so a
// rewind touches only this writer's rows.
func sourcesOf(targets []pollTarget) []string {
	seen := map[string]bool{}
	var out []string
	for _, t := range targets {
		if seen[t.Source] {
			continue
		}
		seen[t.Source] = true
		out = append(out, t.Source)
	}
	return out
}

// ---------------------------------------------------------------------------
// Shared clock plumbing.
// ---------------------------------------------------------------------------

// clock is the injectable time source both workers use, so cadence, staleness
// and probe intervals are all testable without sleeping.
type clock func() time.Time
