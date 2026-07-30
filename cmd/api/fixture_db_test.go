package main

// The live-database harness for cmd/api, plus the OpenAPI contract validator.
//
// # Package-exclusive scratch database
//
// `go test ./...` runs PACKAGES IN PARALLEL, and this fixture TRUNCATES
// derive_cursors, prices, snapshot_sweeps and the risk tables — the same tables
// `internal/store` and `cmd/riskd` are truncating and asserting on at the same
// moment. Sharing one database makes all three suites flaky in a way that looks
// like a product bug. Per-package isolation is the house pattern
// (`cmd/reconcile`'s ensureDerivedDB, `cmd/riskd`'s riskdTestDSN); this is that
// pattern, with the suffix `_api`.
//
// The guard posture is unchanged: DEV MODE skips when TEST_DATABASE_URL is unset,
// ACCEPTANCE MODE makes that FATAL (a skipped live-db suite can never produce
// suite-green evidence, round-10 F1), and a base DSN pointing at the live
// `solvent` database is refused outright.

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/ethereum/go-ethereum/common"
	"github.com/getkin/kin-openapi/openapi3"
	"github.com/jackc/pgx/v5"
	"github.com/stretchr/testify/require"

	"github.com/kaselunt/solvent/internal/config"
	"github.com/kaselunt/solvent/internal/risk"
	"github.com/kaselunt/solvent/internal/riskfeed"
	"github.com/kaselunt/solvent/internal/store"
)

func apiTestDSN(t *testing.T) string {
	t.Helper()
	base := os.Getenv("TEST_DATABASE_URL")
	if base == "" {
		if os.Getenv("SOLVENT_ACCEPTANCE") == "1" {
			t.Fatal("acceptance mode (SOLVENT_ACCEPTANCE=1): TEST_DATABASE_URL is REQUIRED — a skipped live-db suite can never produce suite-green evidence")
		}
		t.Skip("TEST_DATABASE_URL not set; run `make db-up` and export it (dev-mode skip)")
	}
	u, err := url.Parse(base)
	require.NoError(t, err)
	if u.Path == "/solvent" {
		t.Fatalf("TEST_DATABASE_URL points at the LIVE database %q — these tests TRUNCATE; point it at solvent_test", u.Path)
	}
	baseName := strings.TrimPrefix(u.Path, "/")
	require.NotEmpty(t, baseName)
	name := baseName + "_api"
	require.NotEqual(t, "solvent", name)

	ctx := context.Background()
	admin, err := pgx.Connect(ctx, base)
	require.NoError(t, err)
	defer admin.Close(ctx)
	var exists bool
	require.NoError(t, admin.QueryRow(ctx,
		`SELECT EXISTS(SELECT 1 FROM pg_database WHERE datname = $1)`, name).Scan(&exists))
	if !exists {
		// CREATE DATABASE cannot be parameterized; the name is derived from the
		// operator's own scratch DSN plus a fixed suffix.
		if _, err := admin.Exec(ctx, fmt.Sprintf(`CREATE DATABASE %q`, name)); err != nil {
			// A racing sibling test process may have created it between the check and
			// here; that is success, not failure.
			require.NoError(t, admin.QueryRow(ctx,
				`SELECT EXISTS(SELECT 1 FROM pg_database WHERE datname = $1)`, name).Scan(&exists))
			require.True(t, exists, "creating the api scratch database failed: %v", err)
		}
	}
	du := *u
	du.Path = "/" + name
	return du.String()
}

// apiFixture is a seeded database plus a running server over it.
type apiFixture struct {
	ctx     context.Context
	dsn     string
	store   *store.Store
	admin   *pgx.Conn
	srv     *server
	http    *httptest.Server
	batchID int64
}

// fxFeeds is the fixture's committed-registry stand-in.
//
// It is built here rather than through `config.LoadFeeds` because
// `config.Load` requires the SOLVENT_RPC_* endpoints, and the acceptance target
// deliberately runs with those UNSET so that the suite's proven zero-RPC posture
// holds. Building the registry directly is the same choice `cmd/riskd`'s live
// fixture makes, for the same reason.
func fxFeeds() *config.Feeds {
	return &config.Feeds{Assets: []config.Feed{
		{
			Chain: "eth", ChainID: fxETHChain, Engine: risk.AaveEngine, Address: fxWeETHEth,
			Symbol: "weETH", Decimals: 18, Roles: []string{"collateral"},
			Oracle: config.FeedOracle{Kind: config.FeedKindPoll, Contract: fxOracle,
				Method: "getAssetPrice(address)", PriceDecimals: 8},
		},
		{
			Chain: "eth", ChainID: fxETHChain, Engine: risk.AaveEngine, Address: fxUSDCEth,
			Symbol: "USDC", Decimals: 6, Roles: []string{"debt"},
			Oracle: config.FeedOracle{Kind: config.FeedKindPoll, Contract: fxOracle,
				Method: "getAssetPrice(address)", PriceDecimals: 8},
		},
		{
			Chain: "op", ChainID: fxOPChain, Engine: risk.DMEngine, Address: fxWeETHOp,
			Symbol: "weETH", Decimals: 18, Roles: []string{"collateral"},
			Oracle: config.FeedOracle{Kind: config.FeedKindPoll, Contract: fxPriceProvider,
				Method: "price(address)", PriceDecimals: 6},
		},
		// Three stream entries, one per grade the record can assign: the ETH/USD leg
		// whose measured gap earns a QUALIFIER, USDC whose published budget is
		// REFUTED, and one proxy the record has not judged at all.
		{
			Chain: "eth", ChainID: fxETHChain, Engine: risk.AaveEngine, Address: fxWeETHEth,
			Symbol: "weETH", Decimals: 18,
			Oracle: config.FeedOracle{
				Kind: config.FeedKindChainlinkStream, Contract: fxAggVerified,
				PriceDecimals: 8, StartBlock: 20_000_000, Proxy: fxProxyQualified,
				Heartbeat: 3600 * time.Second, Grace: 1800 * time.Second,
			},
		},
		{
			Chain: "eth", ChainID: fxETHChain, Engine: risk.AaveEngine, Address: fxUSDCEth,
			Symbol: "USDC", Decimals: 6,
			Oracle: config.FeedOracle{
				Kind: config.FeedKindChainlinkStream, Contract: fxAggUnverified,
				PriceDecimals: 8, StartBlock: 20_000_000, Proxy: fxProxyRefuted,
				Heartbeat: 86400 * time.Second, Grace: 3600 * time.Second,
			},
		},
		// A third stream whose proxy the record has NOT judged, so the default
		// `published-not-verified` path is exercised alongside the two graded ones.
		// Without it, "the refuted grade is reported" could be satisfied by a table
		// that graded everything refuted.
		{
			Chain: "eth", ChainID: fxETHChain, Engine: risk.AaveEngine, Address: fxUSDCEth,
			Symbol: "UNJUDGED", Decimals: 6,
			Oracle: config.FeedOracle{
				Kind: config.FeedKindChainlinkStream, Contract: fxAggUnverified,
				PriceDecimals: 8, StartBlock: 20_000_000, Proxy: fxProxyUnjudged,
				Heartbeat: 86400 * time.Second, Grace: 3600 * time.Second,
			},
		},
	}}
}

var (
	fxPriceProvider = mustAddr("0x44dd2372FE7B97C4B4D6a7d4DeCf72466485BAcB")
	// fxProxyQualified is the ETH/USD proxy behind the weETH cap adapter: the B3
	// scan's 3,732s measured gap exceeds its published 3,600s heartbeat and survives
	// only inside the 1,800s grace — a QUALIFIER, not a pass.
	fxProxyQualified = mustAddr("0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419")
	fxAggVerified    = mustAddr("0x00c7A37B03690fb9f41b5C5AF8131735C7275446")
	// fxProxyRefuted is USDC's: a measured 248,460s interval FALSIFIES the 90,000s
	// tested budget.
	fxProxyRefuted = mustAddr("0x8fFfFfd4AfB6115b954Bd326cbe7B4BA576818f6")
	// fxProxyUnjudged is not in the record's grade table at all.
	fxProxyUnjudged = mustAddr("0x1234567890AbCdEf1234567890aBcDeF12345678")
	fxAggUnverified = mustAddr("0x789190466E21a8b78b8027866CBBDc151542A26C")
)

func newAPIFixture(t *testing.T) *apiFixture {
	t.Helper()
	ctx := context.Background()
	dsn := apiTestDSN(t)
	require.NoError(t, store.Migrate(ctx, dsn))

	s, err := store.Open(ctx, dsn)
	require.NoError(t, err)
	t.Cleanup(s.Close)

	admin, err := pgx.Connect(ctx, dsn)
	require.NoError(t, err)
	t.Cleanup(func() { _ = admin.Close(context.Background()) })

	_, err = admin.Exec(ctx, `TRUNCATE position_events, position_balances, derive_cursors, prices,
		price_poll_anchors, snapshots, snapshot_sweeps, sweep_generations, rate_indexes,
		reorg_epochs, raw_logs, ingest_cursors, param_history`)
	require.NoError(t, err)
	_, err = admin.Exec(ctx, `TRUNCATE risk_batches, risk_batch_watermarks, risk_positions,
		risk_position_legs, risk_price_inputs, risk_batch_aggregates, risk_scenarios, risk_waterfall
		RESTART IDENTITY CASCADE`)
	require.NoError(t, err)

	f := &apiFixture{ctx: ctx, dsn: dsn, store: s, admin: admin}
	f.seedSubstrate(t)
	f.batchID = f.seedBatch(t, "fixture-materialization-1")
	f.startServer(t)
	return f
}

// seedSubstrate lays down the live-read surfaces: the cursor vector the
// supersession legs are judged against, the sweep census, the price table, and
// the rate indexes.
func (f *apiFixture) seedSubstrate(t *testing.T) {
	t.Helper()
	// Cursors EXACTLY at the batch's stamps, and no reorg epochs at all: the happy
	// path must fire no leg, or every superseded-case assertion would be
	// indistinguishable from the default.
	for _, c := range []struct {
		engine  string
		chain   int64
		block   uint64
		covered uint64
		rev     int32
	}{
		{risk.AaveEngine, int64(fxETHChain), fxAaveBlock, 20_625_519, 3},
		{risk.AaveParamEngine, int64(fxETHChain), fxAaveParamBlock, 20_625_519, 3},
		{store.PollOwnedEnginePrefix + "1", int64(fxETHChain), uint64(fxAavePriceBlock), 0, 0},
		{risk.DMEngine, int64(fxOPChain), fxDMBlock, 118_000_000, 3},
		{store.PollOwnedEnginePrefix + "10", int64(fxOPChain), uint64(fxDMPriceBlock), 0, 0},
	} {
		var covered any
		if c.covered > 0 {
			covered = int64(c.covered)
		}
		_, err := f.admin.Exec(f.ctx,
			`INSERT INTO derive_cursors (engine, chain_id, last_block, acked_epoch, covered_from_block, decoder_revision)
			 VALUES ($1,$2,$3,0,$4,$5)`, c.engine, c.chain, int64(c.block), covered, c.rev)
		require.NoError(t, err)
	}

	// The sweep census: one of each of the three states of chain-truth R6.4.
	for _, sw := range []struct {
		acct    string
		attempt int64
		success int64
		status  string
	}{
		{"0x1111000000000000000000000000000000000011", int64(fxDMSweepBlock), int64(fxDMSweepBlock), "success"},
		{"0x2222000000000000000000000000000000000022", int64(fxDMSweepBlock), int64(fxDMSweepBlock - 500), "error"},
		{"0x3333000000000000000000000000000000000033", int64(fxDMSweepBlock), 0, "error"},
	} {
		_, err := f.admin.Exec(f.ctx,
			`INSERT INTO snapshot_sweeps (engine, account, last_attempt_block, last_success_block, status, updated_at)
			 VALUES ($1,$2,$3,$4,$5,$6)`,
			risk.DMEngine, mustAddr(sw.acct).Bytes(), sw.attempt, sw.success, sw.status, fxBase.Add(-20*time.Minute))
		require.NoError(t, err)
	}

	// Prices. Three rows for the Aave weETH key, deliberately:
	//
	//   * the value the BATCH used, at the batch's price block;
	//   * a QUARANTINED row (valid=false) below it, retained rather than deleted
	//     per D-012, so the quarantine must stay visible on /v1/meta;
	//   * a NEWER, WILDLY DIFFERENT poll above it.
	//
	// The last one is the whole point: /v1/meta shows the live price state, while
	// /v1/address must still disclose the batch's own value and the batch's own
	// age. If the address surface ever showed this number, the "persisted, never
	// re-derived" law would be broken and the test would say so.
	type priceRow struct {
		chain    int64
		asset    []byte
		source   string
		price    string
		decimals int32
		block    int64
		owner    string
		valid    bool
		reason   string
		anchor   int64
		asOf     time.Time
	}
	rows := []priceRow{
		{int64(fxETHChain), fxWeETHEth.Bytes(), fxAaveSource, fxAaveWeETHPrice, 8, fxAavePriceBlock,
			store.PollOwnedEnginePrefix + "1", true, "", fxAavePriceBlock, fxBase.Add(-time.Duration(fxAaveWeETHAge) * time.Second)},
		{int64(fxETHChain), fxWeETHEth.Bytes(), fxAaveSource, "1", 8, fxAavePriceBlock - 100,
			store.PollOwnedEnginePrefix + "1", false, store.InvalidReasonUnverifiableReorg, fxAavePriceBlock - 100, fxBase.Add(-2 * time.Hour)},
		{int64(fxETHChain), fxWeETHEth.Bytes(), fxAaveSource, fxLivePriceAfterBatch, 8, fxAavePriceBlock + 50,
			store.PollOwnedEnginePrefix + "1", true, "", fxAavePriceBlock + 50, fxBase.Add(-5 * time.Second)},
		{int64(fxETHChain), fxUSDCEth.Bytes(), fxAaveSource, fxAaveUSDCPrice, 8, fxAavePriceBlock,
			store.PollOwnedEnginePrefix + "1", true, "", fxAavePriceBlock, fxBase.Add(-time.Duration(fxAaveUSDCAge) * time.Second)},
		{int64(fxOPChain), fxWeETHOp.Bytes(), fxDMSource, fxDMWeETHPrice, 6, fxDMPriceBlock,
			store.PollOwnedEnginePrefix + "10", true, "", fxDMPriceBlock, fxBase.Add(-time.Duration(fxDMWeETHAge) * time.Second)},
	}
	for _, r := range rows {
		_, err := f.admin.Exec(f.ctx,
			`INSERT INTO prices (chain_id, asset, source, price, price_decimals, block_number,
			                     observed_at, owner_engine, valid, invalid_reason, anchor_block, source_as_of)
			 VALUES ($1,$2,$3,$4::numeric,$5,$6,$7,$8,$9,$10,$11,$12)`,
			r.chain, r.asset, r.source, r.price, r.decimals, r.block,
			fxBase, r.owner, r.valid, r.reason, r.anchor, r.asOf)
		require.NoError(t, err, "seeding price row %s/%x", r.source, r.asset)
	}

	// THE PARAM LEDGER — the independent witness every leg's liquidation threshold
	// and bonus is welded against.
	//
	// Aave params live in `param_history` under the PoolConfigurator's own engine
	// identity; the Debt Manager's ARE its own `position_events` (design spec §8,
	// zero new RPC). Both rows sit BELOW the position's params_block, because a
	// param is effective from the log that set it.
	_, err := f.admin.Exec(f.ctx,
		`INSERT INTO param_history (engine, chain_id, asset, ltv, liq_threshold, liq_bonus,
		                            emode_category, effective_block, effective_log_index, source_event, tx_hash)
		 VALUES ($1,$2,$3,$4::numeric,$5::numeric,$6::numeric,0,$7,0,$8,$9)`,
		risk.AaveParamEngine, int64(fxETHChain), fxWeETHEth.Bytes(),
		"8000", fxAaveLTBps, fxAaveBonusBps,
		int64(fxParamEffectiveBlock), "CollateralConfigurationChanged", hash32(0x51))
	require.NoError(t, err)

	_, err = f.admin.Exec(f.ctx,
		`INSERT INTO position_events (chain_id, engine, block_number, tx_hash, log_index, seq,
		                              event_type, account, asset, side, payload)
		 VALUES ($1,$2,$3,$4,0,0,'collateral_token_config_set',$5,$6,'',$7::jsonb)`,
		int64(fxOPChain), risk.DMEngine, int64(fxDMParamEffectiveBlock), hash32(0x52),
		fxWeETHOp.Bytes(), fxWeETHOp.Bytes(),
		`{"ltv":"70000000000000000000","liquidation_threshold":"`+fxDMLiqThreshold+`","liquidation_bonus":"`+fxDMLiqBonus+`"}`)
	require.NoError(t, err)

	// Rate indexes: two heights for one key, so the observatory surface has to pick
	// the newest and disclose ITS block rather than the cursor's.
	for _, ix := range []struct {
		block int64
		value string
	}{
		{int64(fxAaveBlock - 5000), "1000000000000000000000000000"},
		{int64(fxAaveBlock - 900), fxRateIndexValue},
	} {
		_, err := f.admin.Exec(f.ctx,
			`INSERT INTO rate_indexes (engine, asset, block_number, kind, value)
			 VALUES ($1,$2,$3,$4,$5::numeric)`,
			risk.AaveEngine, fxWeETHEth.Bytes(), ix.block, "liquidity_index", ix.value)
		require.NoError(t, err)
	}
}

const (
	// fxLivePriceAfterBatch is the poll that landed AFTER the batch — 2.4x the
	// batch's value, so no rounding coincidence can hide a serve-time re-read.
	fxLivePriceAfterBatch = "999900000000"
	fxRateIndexValue      = "1023456789012345678901234567"
	fxRateIndexBlock      = int64(fxAaveBlock - 900)
)

// hash32 is a deterministic 32-byte identifier for a fixture row.
func hash32(b byte) []byte {
	out := make([]byte, 32)
	for i := range out {
		out[i] = b
	}
	return out
}

// seedWithheldBatch writes a batch whose Aave engine is WITHHELD at the aggregate
// level with zero positions behind it, and returns its id.
//
// `proven` selects the control: false writes the withheld batch, true writes an
// identically-empty Aave engine carrying NO refusal code — a genuinely empty,
// genuinely proven book.
func (f *apiFixture) seedWithheldBatch(t *testing.T, key string, proven bool) int64 {
	t.Helper()
	aggs := fxWithheldAggregates()
	if proven {
		aggs = fxProvenEmptyAggregates()
	}
	id, err := f.store.WriteRiskBatch(f.ctx, fxWithheldBatchWrite(key, aggs))
	require.NoError(t, err)
	require.Positive(t, id)
	batch, found, err := f.store.NewestCompleteBatch(f.ctx)
	require.NoError(t, err)
	require.True(t, found)
	require.Equal(t, id, batch.ID)
	if proven {
		require.Empty(t, batch.RefusedEngines,
			"the control must be PROVEN: an empty refusal_code is a genuinely empty book")
	} else {
		require.Equal(t, []string{risk.AaveEngine}, batch.RefusedEngines,
			"the store must expose the engine-scoped refusal even with zero positions behind it")
	}
	return id
}

// seedBatch writes the fixture batch through store.WriteRiskBatch and returns its
// id.
func (f *apiFixture) seedBatch(t *testing.T, key string) int64 {
	t.Helper()
	id, err := f.store.WriteRiskBatch(f.ctx, fxBatchWrite(key))
	require.NoError(t, err)
	require.Positive(t, id)
	// The batch must clear the SERVING bar, not merely have been written.
	batch, found, err := f.store.NewestCompleteBatch(f.ctx)
	require.NoError(t, err)
	require.True(t, found, "the seeded batch must satisfy the completeness predicate, or every assertion below would be about an unservable batch")
	require.Equal(t, id, batch.ID)
	return id
}

// startServer wires the real handler chain over the seeded database.
func (f *apiFixture) startServer(t *testing.T) {
	t.Helper()
	s := fxServer(t)
	registry, err := riskfeed.NewRegistry(fxFeeds())
	require.NoError(t, err)
	s.registry = registry
	s.feeds = fxFeeds()
	s.store = f.store
	s.version = "test"
	require.NoError(t, s.requireSchema(f.ctx))
	// Generous limits: the suite must not rate-limit itself, and the 429 shape has
	// its own dedicated test against a one-token bucket.
	s.cfg.RateLimit, s.cfg.RateBurst = 10_000, 10_000
	s.cfg.SSEPoll = 150 * time.Millisecond
	s.cfg.SSEHeartbeat = 200 * time.Millisecond
	s.limiter = newIPLimiter(s.cfg.RateLimit, s.cfg.RateBurst, s.cfg.RateTTL)
	s.notifier = newNotifier(f.dsn, s.cfg.SSEPoll)

	nctx, cancel := context.WithCancel(f.ctx)
	go s.notifier.run(nctx)
	t.Cleanup(cancel)

	s.routes()
	f.srv = s
	f.http = httptest.NewServer(s.handler())
	t.Cleanup(f.http.Close)
}

// get performs a GET and returns the status and body.
func (f *apiFixture) get(t *testing.T, path string) (int, []byte) {
	t.Helper()
	resp, err := http.Get(f.http.URL + path)
	require.NoError(t, err)
	defer resp.Body.Close()
	body, err := io.ReadAll(resp.Body)
	require.NoError(t, err)
	return resp.StatusCode, body
}

// getJSON performs a GET, validates the body against the CONTRACT, and decodes
// it into a generic map.
//
// Contract validation happens on the way through, so no assertion in this suite
// can ever be made about a response the contract does not describe.
func (f *apiFixture) getJSON(t *testing.T, path, contractPath string) map[string]any {
	t.Helper()
	status, body := f.get(t, path)
	require.Equal(t, http.StatusOK, status, "body: %s", truncate(body))
	validateContract(t, contractPath, http.StatusOK, body)
	var out map[string]any
	require.NoError(t, json.Unmarshal(body, &out))
	return out
}

func truncate(b []byte) string {
	if len(b) > 2000 {
		return string(b[:2000]) + "…"
	}
	return string(b)
}

// mustAddr parses a fixture address through the SAME strict parser the handlers
// use, so a typo in a fixture constant is a panic here rather than a silently
// different account in an assertion.
func mustAddr(s string) common.Address {
	a, err := parseAddress(s)
	if err != nil {
		panic("fixture: " + s + ": " + err.Error())
	}
	return a
}

// ---------------------------------------------------------------------------
// The OpenAPI contract validator.
// ---------------------------------------------------------------------------

var (
	contractOnce sync.Once
	contractDoc  *openapi3.T
	contractErr  error
)

// loadContract parses and VALIDATES api/openapi.yaml once per test binary.
//
// `doc.Validate` is not decoration: a contract that is not itself a valid
// OpenAPI document cannot meaningfully validate anything, and a typo in a $ref
// would otherwise silently produce an empty schema that admits every response.
func loadContract(t *testing.T) *openapi3.T {
	t.Helper()
	contractOnce.Do(func() {
		loader := openapi3.NewLoader()
		loader.IsExternalRefsAllowed = false
		contractDoc, contractErr = loader.LoadFromFile(filepath.Join("..", "..", "api", "openapi.yaml"))
		if contractErr == nil {
			contractErr = contractDoc.Validate(context.Background())
		}
	})
	require.NoError(t, contractErr)
	require.NotNil(t, contractDoc)
	return contractDoc
}

// contractSchema resolves the JSON schema for one operation's response.
func contractSchema(t *testing.T, path string, status int) *openapi3.Schema {
	t.Helper()
	doc := loadContract(t)
	item := doc.Paths.Find(path)
	require.NotNil(t, item, "the contract declares no path %q", path)
	require.NotNil(t, item.Get, "the contract declares no GET on %q", path)
	respRef := item.Get.Responses.Status(status)
	require.NotNil(t, respRef, "the contract declares no %d response on %q", status, path)
	mt := respRef.Value.Content.Get("application/json")
	require.NotNil(t, mt, "the contract declares no application/json body for %d on %q", status, path)
	require.NotNil(t, mt.Schema, "the contract declares no schema for %d on %q", status, path)
	require.NotNil(t, mt.Schema.Value)
	return mt.Schema.Value
}

// validateContract asserts a body conforms to the contract.
func validateContract(t *testing.T, path string, status int, body []byte) {
	t.Helper()
	var decoded any
	require.NoError(t, json.Unmarshal(body, &decoded), "response body is not JSON: %s", truncate(body))
	err := contractSchema(t, path, status).VisitJSON(decoded, openapi3.MultiErrors())
	require.NoError(t, err, "response for %s violates api/openapi.yaml: %s", path, truncate(body))
}

// contractRejects reports whether a body FAILS contract validation. It exists for
// the negative controls: a contract test whose validator cannot reject anything
// is not a contract test.
func contractRejects(t *testing.T, path string, status int, decoded any) bool {
	t.Helper()
	return contractSchema(t, path, status).VisitJSON(decoded, openapi3.MultiErrors()) != nil
}

// validateComponent asserts a value conforms to a named component schema — used
// for the SSE payloads, which are not an application/json response body.
func validateComponent(t *testing.T, name string, body []byte) {
	t.Helper()
	doc := loadContract(t)
	ref, ok := doc.Components.Schemas[name]
	require.True(t, ok, "the contract declares no component schema %q", name)
	var decoded any
	require.NoError(t, json.Unmarshal(body, &decoded))
	require.NoError(t, ref.Value.VisitJSON(decoded, openapi3.MultiErrors()),
		"SSE payload violates the %s component schema: %s", name, truncate(body))
}
