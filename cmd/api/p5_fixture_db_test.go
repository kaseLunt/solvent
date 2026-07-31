package main

// The P5 (Task B3) live-database fixture: the Task-7 fixture plus the durable
// substrate the eight new endpoints read — position_events applied through
// store.ApplyDerived (the PRODUCTION writer, never hand-INSERTs), block-header
// custody through store.UpsertBlockHeader, the observatory rollup through
// store.WriteObservatoryPoints, and the deploy-bound evidence statics read
// from the REAL committed repo files.
//
// The liquidation rows are the REAL CAPTURED mainnet/OP rows from
// internal/store/testdata/p5_liquidation_rows.json (payloads exactly as the
// derivers wrote them from chain logs), so the API's liquidation-detail
// rendering parses the same bytes production will.

import (
	"encoding/hex"
	"encoding/json"
	"io"
	"math/big"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/getkin/kin-openapi/openapi3"
	"github.com/stretchr/testify/require"

	"github.com/kaselunt/solvent/internal/config"
	"github.com/kaselunt/solvent/internal/risk"
	"github.com/kaselunt/solvent/internal/store"
)

// ---------------------------------------------------------------------------
// Captured + filler events.
// ---------------------------------------------------------------------------

// The captured rows' identities (from the fixture file's provenance block).
// Hex renderings go through the SAME strict parser + EIP-55 checksum the
// handlers use, so an assertion can never disagree over case.
var (
	p5DMLiqBlock       = uint64(153_399_414)
	p5DMLiqAccountAddr = mustAddr("0xe4747ad00964096f74d554324add3d87aaaffce2")
	p5DMLiqAccount     = p5DMLiqAccountAddr.Hex()
	p5DMSeizedAddr     = mustAddr("0xf0bb20865277abd641a307ece5ee04e79073416c")
	p5DMSeized         = p5DMSeizedAddr.Hex()
	p5AaveLiqBlock     = uint64(24_466_431)

	// Filler identities.
	p5DMAcct        = mustAddr("0x00000000000000000000000000000000000000A7")
	p5AaveAcct      = mustAddr("0x00000000000000000000000000000000000000B8")
	p5FillerAsset   = mustAddr("0x00000000000000000000000000000000000000C9")
	p5DMBorrowBlk   = uint64(153_399_400)
	p5DMRepayBlk    = uint64(153_399_420)
	p5AaveBorrowBlk = uint64(24_466_400)
	p5AaveFlagBlk   = uint64(24_466_440)

	// The earlier Aave param row that covers the captured liquidation's block,
	// so /v1/events can serve a configured bonus from the ledger: liq_bonus
	// 10750 in Aave's own encoding = a 750bps premium.
	p5EarlyParamBlock = uint64(24_000_000)
	p5EarlyParamBonus = "10750"
)

// Header times, fxBase-relative and hand-picked so cross-engine chronology is
// discriminating: the OP liquidation is OLDEST by TIME while its block number
// (153M) dwarfs the mainnet blocks (24M) — height order and time order
// disagree, which is exactly what the two-mode ordering law is for.
var (
	p5TimeAaveFlag = fxBase.Add(-2 * time.Hour)
	p5TimeAaveLiq  = fxBase.Add(-3 * time.Hour)
	p5TimeDMLiq    = fxBase.Add(-4 * time.Hour)
	p5TimeParam    = fxBase.Add(-30 * 24 * time.Hour)
)

// fxP5Feeds is fxFeeds plus the assets the captured rows touch, so symbol and
// decimals lookups resolve for the liquidation extracts.
func fxP5Feeds() *config.Feeds {
	f := fxFeeds()
	f.Assets = append(f.Assets, config.Feed{
		Chain: "op", ChainID: fxOPChain, Engine: risk.DMEngine, Address: p5DMSeizedAddr,
		Symbol: "wstETH", Decimals: 18, Roles: []string{"collateral"},
		Oracle: config.FeedOracle{Kind: config.FeedKindPoll, Contract: fxPriceProvider,
			Method: "price(address)", PriceDecimals: 6},
	})
	return f
}

// loadP5CapturedEvents reads the captured liquidation rows — the SAME fixture
// internal/store's tests replay, so the two layers are welded to one set of
// real bytes.
func loadP5CapturedEvents(t *testing.T) []store.PositionEvent {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join("..", "..", "internal", "store", "testdata", "p5_liquidation_rows.json"))
	require.NoError(t, err)
	var doc struct {
		Events []struct {
			ChainID     uint64            `json:"chain_id"`
			Engine      string            `json:"engine"`
			BlockNumber uint64            `json:"block_number"`
			TxHash      string            `json:"tx_hash"`
			LogIndex    uint32            `json:"log_index"`
			Seq         uint16            `json:"seq"`
			EventType   string            `json:"event_type"`
			Account     string            `json:"account"`
			Asset       string            `json:"asset"`
			Side        string            `json:"side"`
			Delta       *string           `json:"delta"`
			Payload     map[string]string `json:"payload"`
		} `json:"events"`
	}
	require.NoError(t, json.Unmarshal(raw, &doc))
	require.NotEmpty(t, doc.Events)
	out := make([]store.PositionEvent, 0, len(doc.Events))
	for _, fe := range doc.Events {
		ev := store.PositionEvent{
			ChainID: fe.ChainID, Engine: fe.Engine, BlockNumber: fe.BlockNumber,
			TxHash: mustHexBytes(t, fe.TxHash), LogIndex: fe.LogIndex, Seq: fe.Seq,
			EventType: fe.EventType, Account: mustHexBytes(t, fe.Account),
			Asset: mustHexBytes(t, fe.Asset), Side: fe.Side, Payload: fe.Payload,
		}
		if fe.Delta != nil {
			v, ok := new(big.Int).SetString(*fe.Delta, 10)
			require.True(t, ok)
			ev.Delta = v
		}
		out = append(out, ev)
	}
	return out
}

func mustHexBytes(t *testing.T, s string) []byte {
	t.Helper()
	b, err := hex.DecodeString(s)
	require.NoError(t, err)
	return b
}

func p5Tx(b byte) []byte {
	h := make([]byte, 32)
	h[0], h[31] = 0x99, b
	return h
}

// seedP5Events applies the captured rows plus synthetic filler through
// store.ApplyDerived — the production position_events writer, with its
// idempotency, balance folding and cursor discipline.
func (f *apiFixture) seedP5Events(t *testing.T) {
	t.Helper()
	var dmEvents, aaveEvents []store.PositionEvent
	for _, ev := range loadP5CapturedEvents(t) {
		switch ev.Engine {
		case risk.DMEngine:
			dmEvents = append(dmEvents, ev)
		case risk.AaveEngine:
			aaveEvents = append(aaveEvents, ev)
		}
	}
	dmEvents = append(dmEvents,
		store.PositionEvent{ChainID: fxOPChain, Engine: risk.DMEngine, BlockNumber: p5DMBorrowBlk,
			TxHash: p5Tx(0x01), LogIndex: 5, EventType: "borrow", Account: p5DMAcct.Bytes(),
			Asset: p5FillerAsset.Bytes(), Side: "debt", Delta: big.NewInt(100),
			Payload: map[string]string{"usd": "100"}},
		store.PositionEvent{ChainID: fxOPChain, Engine: risk.DMEngine, BlockNumber: p5DMRepayBlk,
			TxHash: p5Tx(0x02), LogIndex: 7, EventType: "repay", Account: p5DMAcct.Bytes(),
			Asset: p5FillerAsset.Bytes(), Side: "debt", Delta: big.NewInt(-40),
			Payload: map[string]string{"usd": "40"}},
		// Bookkeeping — must NEVER surface on the feed.
		store.PositionEvent{ChainID: fxOPChain, Engine: risk.DMEngine, BlockNumber: p5DMRepayBlk + 1,
			TxHash: p5Tx(0x03), LogIndex: 2, EventType: "residue_zeroed", Account: p5DMAcct.Bytes(),
			Asset: p5FillerAsset.Bytes(), Side: "debt", Delta: big.NewInt(-1),
			Payload: map[string]string{"residue": "1"}},
		// Config — /v1/params territory, never a feed row.
		store.PositionEvent{ChainID: fxOPChain, Engine: risk.DMEngine, BlockNumber: p5DMRepayBlk + 5,
			TxHash: p5Tx(0x04), LogIndex: 9, EventType: "borrow_apy_set", Account: []byte{},
			Asset:   p5FillerAsset.Bytes(),
			Payload: map[string]string{"old_apy": "1", "new_apy": "2"}},
	)
	aaveEvents = append(aaveEvents,
		store.PositionEvent{ChainID: fxETHChain, Engine: risk.AaveEngine, BlockNumber: p5AaveBorrowBlk,
			TxHash: p5Tx(0x11), LogIndex: 3, EventType: "aave_borrow", Account: p5AaveAcct.Bytes(),
			Asset: fxUSDCEth.Bytes(), Side: "debt", Delta: big.NewInt(777),
			Payload: map[string]string{"amount": "777"}},
		// Bookkeeping — must NEVER surface on the feed.
		store.PositionEvent{ChainID: fxETHChain, Engine: risk.AaveEngine, BlockNumber: p5AaveBorrowBlk + 5,
			TxHash: p5Tx(0x12), LogIndex: 1, EventType: "aave_reserve_data_updated",
			Account: make([]byte, 20), Asset: fxUSDCEth.Bytes(),
			Payload: map[string]string{"variable_borrow_index": "1", "liquidity_index": "1"}},
		store.PositionEvent{ChainID: fxETHChain, Engine: risk.AaveEngine, BlockNumber: p5AaveFlagBlk,
			TxHash: p5Tx(0x13), LogIndex: 8, EventType: store.AaveCollateralEnabledEvent,
			Account: p5AaveAcct.Bytes(), Asset: fxUSDCEth.Bytes()},
	)
	require.NoError(t, f.store.ApplyDerived(f.ctx, risk.DMEngine, fxOPChain, dmEvents, p5DMRepayBlk+5))
	require.NoError(t, f.store.ApplyDerived(f.ctx, risk.AaveEngine, fxETHChain, aaveEvents, p5AaveFlagBlk))
}

// seedP5Headers custodies header times for SOME event blocks through the
// production writer, leaving the rest honestly absent — the null-block_time
// path must stay exercised.
func (f *apiFixture) seedP5Headers(t *testing.T) {
	t.Helper()
	for _, h := range []struct {
		chain uint64
		block uint64
		at    time.Time
	}{
		{fxETHChain, p5AaveFlagBlk, p5TimeAaveFlag},
		{fxETHChain, p5AaveLiqBlock, p5TimeAaveLiq},
		{fxOPChain, p5DMLiqBlock, p5TimeDMLiq},
		{fxETHChain, p5EarlyParamBlock, p5TimeParam},
	} {
		res, err := f.store.UpsertBlockHeader(f.ctx, store.BlockHeaderWrite{
			ChainID: h.chain, Block: h.block, Hash: hash32(byte(h.block % 251)), Time: h.at.Unix(),
		})
		require.NoError(t, err)
		require.True(t, res.Stored)
	}
}

// seedP5ParamHistory adds the EARLY Aave configurator row whose effective
// range covers the captured liquidation's block.
func (f *apiFixture) seedP5ParamHistory(t *testing.T) {
	t.Helper()
	_, err := f.admin.Exec(f.ctx,
		`INSERT INTO param_history (engine, chain_id, asset, ltv, liq_threshold, liq_bonus,
		                            emode_category, effective_block, effective_log_index, source_event, tx_hash)
		 VALUES ($1,$2,$3,$4::numeric,$5::numeric,$6::numeric,0,$7,3,$8,$9)`,
		risk.AaveParamEngine, int64(fxETHChain), fxWeETHEth.Bytes(),
		"7500", "7800", p5EarlyParamBonus,
		int64(p5EarlyParamBlock), "CollateralConfigurationChanged", hash32(0x53))
	require.NoError(t, err)
}

// p5EvidenceStatics loads the REAL committed evidence files (the test binary
// runs two directories below the repo root; the served paths stay
// repo-relative, exactly as they will in production).
func p5EvidenceStatics(t *testing.T) evidenceStatics {
	t.Helper()
	ev, err := loadEvidenceStatics(filepath.Join("..", ".."), "recon/feeds.json", defaultReconcileArtifact)
	require.NoError(t, err)
	return ev
}

// newP5Fixture is the full P5 fixture. Ordering matters: events go through
// ApplyDerived FIRST (its cursor rows land at the event heights), then the
// substrate pass stamps every cursor to the fixture's heights, then the batch.
func newP5Fixture(t *testing.T) *apiFixture {
	t.Helper()
	f := newBareAPIFixture(t)
	f.seedP5Events(t)
	f.seedSubstrate(t)
	f.seedP5ParamHistory(t)
	f.batchID = f.seedBatch(t, "fixture-materialization-1")
	f.seedP5Headers(t)
	f.startServerWithFeeds(t, fxP5Feeds())
	f.srv.evidence = p5EvidenceStatics(t)
	return f
}

// ---------------------------------------------------------------------------
// Method-aware contract validation (the run-book route is a POST, and the P5
// endpoints have contract-declared 4xx bodies worth validating too).
// ---------------------------------------------------------------------------

func contractSchemaMethod(t *testing.T, path, method string, status int) *openapi3.Schema {
	t.Helper()
	doc := loadContract(t)
	item := doc.Paths.Find(path)
	require.NotNil(t, item, "the contract declares no path %q", path)
	op := item.GetOperation(method)
	require.NotNil(t, op, "the contract declares no %s on %q", method, path)
	respRef := op.Responses.Status(status)
	require.NotNil(t, respRef, "the contract declares no %d response on %s %q", status, method, path)
	mt := respRef.Value.Content.Get("application/json")
	require.NotNil(t, mt, "the contract declares no application/json body for %d on %s %q", status, method, path)
	require.NotNil(t, mt.Schema)
	require.NotNil(t, mt.Schema.Value)
	return mt.Schema.Value
}

func validateContractMethod(t *testing.T, path, method string, status int, body []byte) {
	t.Helper()
	var decoded any
	require.NoError(t, json.Unmarshal(body, &decoded), "response body is not JSON: %s", truncate(body))
	err := contractSchemaMethod(t, path, method, status).VisitJSON(decoded, openapi3.MultiErrors())
	require.NoError(t, err, "%s %s response violates api/openapi.yaml: %s", method, path, truncate(body))
}

// post performs a POST (empty body — the run-book route takes none).
func (f *apiFixture) post(t *testing.T, path string) (int, []byte) {
	t.Helper()
	resp, err := http.Post(f.http.URL+path, "application/json", strings.NewReader(""))
	require.NoError(t, err)
	defer resp.Body.Close()
	body, err := io.ReadAll(resp.Body)
	require.NoError(t, err)
	return resp.StatusCode, body
}

// getStatusJSON performs a GET expecting a NON-200 status, validates the body
// against the contract's declared response for that status, and decodes it.
func (f *apiFixture) getStatusJSON(t *testing.T, path, contractPath string, status int) map[string]any {
	t.Helper()
	got, body := f.get(t, path)
	require.Equal(t, status, got, "body: %s", truncate(body))
	validateContractMethod(t, contractPath, http.MethodGet, status, body)
	var out map[string]any
	require.NoError(t, json.Unmarshal(body, &out))
	return out
}

// asMap navigates a decoded JSON object.
func asMap(t *testing.T, v any) map[string]any {
	t.Helper()
	m, ok := v.(map[string]any)
	require.True(t, ok, "expected a JSON object, got %T", v)
	return m
}

func asList(t *testing.T, v any) []any {
	t.Helper()
	l, ok := v.([]any)
	require.True(t, ok, "expected a JSON array, got %T", v)
	return l
}
