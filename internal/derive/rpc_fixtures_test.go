//go:build rpcfixtures

package derive

// RPC-backed tooling for Task 5, excluded from normal builds by the
// `rpcfixtures` build tag. These are fixture-authoring/verification tools that
// hit live OP RPC, NOT tests-of-record:
//
//	go test -tags rpcfixtures -run TestStep0MigrationSweep ./internal/derive/ -v
//	go test -tags rpcfixtures -run TestGenGoldenFixtures  ./internal/derive/ -v
//
// TestStep0MigrationSweep is the task's MANDATORY step 0: sweep all
// MigrationBorrowerPositionsSet logs (blocks 149,985,513-149,986,254, OP),
// fetch each tx's calldata, decode via decode.DecodeMigrationCalldata, and
// assert selector coverage, per-log Count == len(seeds), and a seed grand
// total of 7,337 (recon/derivation-notes.md "Migration finding").
//
// TestGenGoldenFixtures fetches the three recon-validated borrowers' full
// event histories (+ same-block InterestIndexUpdated joins) and the golden
// liquidation vector's migrated history, verifies the normalized replay
// locally against recon's "Debt identity validation" table, and writes the
// committed testdata/dm_golden_*.json fixtures.

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"math/big"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"testing"
	"time"

	"github.com/ethereum/go-ethereum"
	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/core/types"
	"github.com/ethereum/go-ethereum/ethclient"
	"github.com/stretchr/testify/require"

	"github.com/kaselunt/solvent/internal/decode"
)

const (
	rpcPrimary  = "https://mainnet.optimism.io"
	rpcFallback = "https://optimism.drpc.org"

	dmAddrHex       = "0x0078C5a459132e279056B2371fE8A8eC973A9553"
	usdcOPHex       = "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85"
	migrationTopic0 = "0x3f1c4431cbe26a58837755d2461e40a6561ee3edd0e31ca91edb845637acda8b"

	borrowedTopic0 = "0x3fc499aeb0bb1cb58b6de8b02b3f86f4e7394e9690bef0110e32ced8a5631045"
	repaidTopic0   = "0x861660e9b7ead7183d53fe928b5638c7b57a7bcf16a89d7fdb04db65ce3ad6d5"
	liqTopic0      = "0xfd54f2a27ee93a2b60fa895931f0067b8eab4f20662e14ef1ef0720eb772ea9c"
	iiuTopic0      = "0xc6ecd996cf998cfeedb2b1379b047e8579d888439dacbc60641c6dfd07f1f802"

	migStartBlock uint64 = 149_985_513
	migEndBlock   uint64 = 149_986_254

	dmDeployBlock uint64 = 149_521_228
	pinBlock      uint64 = 154_021_227 // recon PIN for Repaid/Liquidated completeness

	liqVectorBlock uint64 = 151_731_530
)

var (
	liqVectorSafe = common.HexToAddress("0xac5f3ce95f602e31b672cc38cddf7a3ea9ae5fcc")
	goldenSafes   = []common.Address{
		common.HexToAddress("0x0303a641b9255a4240e879c76efc704dc1c6383d"),
		common.HexToAddress("0x0b7043c82c5ad152137ad7d503daa02f5e777f85"),
		common.HexToAddress("0x05e3a665efc843d77e3867ee6db41bc38d1ed33f"),
	}
)

func dialOP(t *testing.T) *ethclient.Client {
	t.Helper()
	// drpc first: its getLogs range cap (10,000 blocks, free plan) is
	// explicit and stable, while mainnet.optimism.io intermittently 503s
	// ("no backend is currently healthy") on historical ranges.
	for _, url := range []string{rpcFallback, rpcPrimary} {
		c, err := ethclient.DialContext(context.Background(), url)
		if err != nil {
			t.Logf("dial %s: %v", url, err)
			continue
		}
		return c
	}
	t.Fatal("no OP RPC reachable")
	return nil
}

// withRetry retries fn with a growing backoff -- public RPC endpoints
// throttle bursts (drpc free tier 429s aggressively), so later waits are
// generous.
func withRetry[T any](t *testing.T, what string, fn func() (T, error)) T {
	t.Helper()
	backoff := []time.Duration{0, 3 * time.Second, 8 * time.Second, 15 * time.Second, 30 * time.Second, 60 * time.Second}
	var lastErr error
	for attempt, wait := range backoff {
		time.Sleep(wait)
		v, err := fn()
		if err == nil {
			return v
		}
		lastErr = err
		t.Logf("%s attempt %d failed: %v", what, attempt+1, err)
	}
	t.Fatalf("%s: all attempts failed: %v", what, lastErr)
	var zero T
	return zero
}

func filterLogs(t *testing.T, c *ethclient.Client, from, to uint64, topics [][]common.Hash) []types.Log {
	t.Helper()
	time.Sleep(250 * time.Millisecond) // steady free-tier pacing on every call
	return withRetry(t, fmt.Sprintf("getLogs %d-%d", from, to), func() ([]types.Log, error) {
		ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
		defer cancel()
		return c.FilterLogs(ctx, ethereum.FilterQuery{
			FromBlock: new(big.Int).SetUint64(from),
			ToBlock:   new(big.Int).SetUint64(to),
			Addresses: []common.Address{common.HexToAddress(dmAddrHex)},
			Topics:    topics,
		})
	})
}

// TestStep0MigrationSweep -- MANDATORY STEP 0 (see file header).
func TestStep0MigrationSweep(t *testing.T) {
	c := dialOP(t)

	logs := filterLogs(t, c, migStartBlock, migEndBlock,
		[][]common.Hash{{common.HexToHash(migrationTopic0)}})
	t.Logf("migration logs found: %d", len(logs))

	total := big.NewInt(0)
	selectors := map[string]int{}
	txSeen := map[common.Hash]bool{}
	type row struct {
		i        int
		block    uint64
		tx       string
		selector string
		count    string
		seeds    int
		batchSum string
	}
	var rows []row

	for i, l := range logs {
		require.False(t, txSeen[l.TxHash], "tx %s carries more than one migration log -- seeds would double-count", l.TxHash)
		txSeen[l.TxHash] = true

		// Decode the log itself for its Count field.
		require.Len(t, l.Topics, 2, "migration log %d topics", i)
		count := new(big.Int).SetBytes(l.Data)

		tx := withRetry(t, "txByHash "+l.TxHash.Hex(), func() (*types.Transaction, error) {
			ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
			defer cancel()
			txn, _, err := c.TransactionByHash(ctx, l.TxHash)
			return txn, err
		})
		calldata := tx.Data()
		require.GreaterOrEqual(t, len(calldata), 4, "tx %s calldata", l.TxHash)
		sel := fmt.Sprintf("0x%x", calldata[:4])

		seeds, err := decode.DecodeMigrationCalldata(calldata)
		require.NoErrorf(t, err, "tx %s (selector %s): decode failed -- UNHANDLED SELECTOR OR MALFORMED CALLDATA", l.TxHash, sel)
		require.Equalf(t, count.String(), fmt.Sprintf("%d", len(seeds)),
			"tx %s: log Count %s != decoded seeds %d", l.TxHash, count, len(seeds))

		batchSum := big.NewInt(0)
		for _, s := range seeds {
			batchSum.Add(batchSum, s.NormalizedAmount)
			if s.Borrower == liqVectorSafe {
				t.Logf("liq-vector Safe %s seeded in tx %s (block %d) with normalized %s",
					liqVectorSafe, l.TxHash, l.BlockNumber, s.NormalizedAmount)
			}
		}
		selectors[sel]++
		total.Add(total, big.NewInt(int64(len(seeds))))
		rows = append(rows, row{i, l.BlockNumber, l.TxHash.Hex(), sel, count.String(), len(seeds), batchSum.String()})
	}

	// Emit the per-tx table (captured into the task report).
	t.Log("| # | block | tx | selector | log Count | seeds | Σ normalized (batch) |")
	t.Log("|---|-------|----|----------|-----------|-------|----------------------|")
	for _, r := range rows {
		t.Logf("| %d | %d | %s | %s | %s | %d | %s |", r.i, r.block, r.tx, r.selector, r.count, r.seeds, r.batchSum)
	}
	for sel, n := range selectors {
		t.Logf("selector %s: %d txs", sel, n)
	}
	t.Logf("TOTAL: %d logs, %s seeds", len(rows), total)

	require.Equal(t, 80, len(logs), "expected exactly 80 migration batches")
	require.Equal(t, "7337", total.String(), "expected 7,337 migrated borrower positions")
}

// ---------------------------------------------------------------------------
// Golden fixture generation.
// ---------------------------------------------------------------------------

type fixtureLog struct {
	BlockNumber uint64   `json:"blockNumber"`
	BlockHash   string   `json:"blockHash"`
	TxHash      string   `json:"txHash"`
	LogIndex    uint32   `json:"logIndex"`
	Address     string   `json:"address"`
	Topics      []string `json:"topics"`
	Data        string   `json:"data"`
}

type goldenFixture struct {
	Provenance string `json:"provenance"`
	ChainID    uint64 `json:"chainId"`
	Borrower   string `json:"borrower"`
	// MigrationCalldata maps migration txHash -> full raw tx input (hex) for
	// the fake DMChainReads in the golden test. Empty for post-migration
	// borrowers.
	MigrationCalldata map[string]string `json:"migrationCalldata,omitempty"`
	Logs              []fixtureLog      `json:"logs"`
}

func toFixtureLog(l types.Log) fixtureLog {
	topics := make([]string, len(l.Topics))
	for i, tp := range l.Topics {
		topics[i] = tp.Hex()
	}
	return fixtureLog{
		BlockNumber: l.BlockNumber,
		BlockHash:   l.BlockHash.Hex(),
		TxHash:      l.TxHash.Hex(),
		LogIndex:    uint32(l.Index),
		Address:     strings.ToLower(l.Address.Hex()),
		Topics:      topics,
		Data:        fmt.Sprintf("0x%x", l.Data),
	}
}

// logChunk is the getLogs range span accepted by the free public endpoints
// (drpc: "ranges over 10000 blocks are not supported on free plan").
const logChunk = 10_000

// ---------------------------------------------------------------------------
// Resilient chunk fetching for the multi-thousand-call golden-fixture scan:
// per-chunk DISK CACHE (a rerun resumes instead of restarting), rotation
// across both endpoints, and adaptive range-splitting when a provider
// refuses or times out on a span (drpc free plan 408s server-side on some
// 10k scans; mainnet.optimism.io accepts only small ranges).
// ---------------------------------------------------------------------------

type rpcPool struct {
	t        *testing.T
	clients  []*ethclient.Client
	names    []string
	cacheDir string
}

func newRPCPool(t *testing.T) *rpcPool {
	t.Helper()
	p := &rpcPool{t: t}
	for _, url := range []string{rpcFallback, rpcPrimary} { // drpc first (stable range cap)
		c, err := ethclient.DialContext(context.Background(), url)
		if err != nil {
			t.Logf("dial %s: %v", url, err)
			continue
		}
		p.clients = append(p.clients, c)
		p.names = append(p.names, url)
	}
	require.NotEmpty(t, p.clients, "no OP RPC reachable")
	p.cacheDir = os.Getenv("DM_FIXTURE_CACHE")
	if p.cacheDir == "" {
		p.cacheDir = filepath.Join(os.TempDir(), "solvent-dm-fixture-cache")
	}
	require.NoError(t, os.MkdirAll(p.cacheDir, 0o755))
	t.Logf("chunk cache: %s", p.cacheDir)
	return p
}

func (p *rpcPool) cachePath(from, to uint64, topics [][]common.Hash) string {
	h := sha256.New()
	for _, group := range topics {
		for _, tp := range group {
			h.Write(tp[:])
		}
		h.Write([]byte{0xff})
	}
	return filepath.Join(p.cacheDir, fmt.Sprintf("logs_%d_%d_%x.json", from, to, h.Sum(nil)[:8]))
}

// getLogs fetches [from,to] with cache + adaptive splitting. Cached chunks
// are trusted verbatim (they were only ever written after a fully successful
// fetch of the exact same query).
func (p *rpcPool) getLogs(from, to uint64, topics [][]common.Hash) []types.Log {
	p.t.Helper()
	path := p.cachePath(from, to, topics)
	if buf, err := os.ReadFile(path); err == nil {
		var cached []types.Log
		require.NoError(p.t, json.Unmarshal(buf, &cached), "corrupt chunk cache %s", path)
		return cached
	}
	logs, err := p.fetchAdaptive(from, to, topics)
	require.NoErrorf(p.t, err, "getLogs %d-%d failed on every endpoint at every split", from, to)
	buf, err := json.Marshal(logs)
	require.NoError(p.t, err)
	require.NoError(p.t, os.WriteFile(path, buf, 0o644))
	return logs
}

// fetchAdaptive tries the full span on every endpoint (with short backoff),
// then bisects: providers cap ranges differently and time out server-side on
// log-dense spans, and a smaller span always eventually succeeds.
func (p *rpcPool) fetchAdaptive(from, to uint64, topics [][]common.Hash) ([]types.Log, error) {
	var lastErr error
	for attempt := 0; attempt < 3; attempt++ {
		time.Sleep(time.Duration(attempt) * 3 * time.Second)
		for i, c := range p.clients {
			time.Sleep(200 * time.Millisecond) // pacing
			ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
			logs, err := c.FilterLogs(ctx, ethereum.FilterQuery{
				FromBlock: new(big.Int).SetUint64(from),
				ToBlock:   new(big.Int).SetUint64(to),
				Addresses: []common.Address{common.HexToAddress(dmAddrHex)},
				Topics:    topics,
			})
			cancel()
			if err == nil {
				return logs, nil
			}
			lastErr = err
			p.t.Logf("getLogs %d-%d attempt %d endpoint %s: %v", from, to, attempt+1, p.names[i], err)
		}
	}
	if to > from {
		mid := from + (to-from)/2
		left, err := p.fetchAdaptive(from, mid, topics)
		if err != nil {
			return nil, err
		}
		right, err := p.fetchAdaptive(mid+1, to, topics)
		if err != nil {
			return nil, err
		}
		return append(left, right...), nil
	}
	return nil, lastErr
}

func (p *rpcPool) txByHash(h common.Hash) *types.Transaction {
	p.t.Helper()
	return withRetry(p.t, "txByHash "+h.Hex(), func() (*types.Transaction, error) {
		var lastErr error
		for _, c := range p.clients {
			ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
			tx, _, err := c.TransactionByHash(ctx, h)
			cancel()
			if err == nil {
				return tx, nil
			}
			lastErr = err
		}
		return nil, lastErr
	})
}

// fetchUserHistories collects Borrowed/Repaid (topic1=user) and Liquidated
// (topic2=user) logs for a SET of Safes over [from, to] in one combined
// chunked scan (the user topic position accepts an OR-list), then splits the
// results per Safe. Also returns the same-block InterestIndexUpdated(USDC)
// log for every mutating block seen (exactly one per block -- invariant
// asserted here at fetch time).
func fetchUserHistories(t *testing.T, p *rpcPool, users []common.Address, from, to uint64) (map[common.Address][]types.Log, map[uint64]types.Log) {
	t.Helper()
	userTopics := make([]common.Hash, len(users))
	byTopic := map[common.Hash]common.Address{}
	for i, u := range users {
		userTopics[i] = common.BytesToHash(common.LeftPadBytes(u.Bytes(), 32))
		byTopic[userTopics[i]] = u
	}

	var all []types.Log
	nChunks := 0
	for start := from; start <= to; start += logChunk {
		end := start + logChunk - 1
		if end > to {
			end = to
		}
		// Borrowed + Repaid: user is topic1.
		all = append(all, p.getLogs(start, end, [][]common.Hash{
			{common.HexToHash(borrowedTopic0), common.HexToHash(repaidTopic0)},
			userTopics,
		})...)
		// Liquidated: user is topic2.
		all = append(all, p.getLogs(start, end, [][]common.Hash{
			{common.HexToHash(liqTopic0)},
			{},
			userTopics,
		})...)
		nChunks++
		if nChunks%50 == 0 {
			t.Logf("scanned through block %d (%d chunks), %d event logs so far", end, nChunks, len(all))
		}
	}

	perUser := map[common.Address][]types.Log{}
	blocks := map[uint64]bool{}
	for _, l := range all {
		userPos := 1
		if l.Topics[0] == common.HexToHash(liqTopic0) {
			userPos = 2
		}
		u, ok := byTopic[l.Topics[userPos]]
		require.True(t, ok, "log %s/%d: user topic not one of the requested Safes", l.TxHash, l.Index)
		perUser[u] = append(perUser[u], l)
		blocks[l.BlockNumber] = true
	}

	// Same-block IIU(USDC) join, one query per distinct mutating block.
	usdcTopic := common.BytesToHash(common.LeftPadBytes(common.HexToAddress(usdcOPHex).Bytes(), 32))
	iiuByBlock := map[uint64]types.Log{}
	for b := range blocks {
		iiu := p.getLogs(b, b, [][]common.Hash{
			{common.HexToHash(iiuTopic0)},
			{usdcTopic},
		})
		require.Lenf(t, iiu, 1, "block %d: expected exactly one InterestIndexUpdated(USDC) (invariant)", b)
		iiuByBlock[b] = iiu[0]
	}
	return perUser, iiuByBlock
}

// assembleHistory merges one Safe's event logs with the IIU logs of its
// mutating blocks, sorted by (block, logIndex).
func assembleHistory(userLogs []types.Log, iiuByBlock map[uint64]types.Log) []types.Log {
	blocks := map[uint64]bool{}
	all := append([]types.Log{}, userLogs...)
	for _, l := range userLogs {
		if !blocks[l.BlockNumber] {
			blocks[l.BlockNumber] = true
			all = append(all, iiuByBlock[l.BlockNumber])
		}
	}
	sort.Slice(all, func(i, j int) bool {
		if all[i].BlockNumber != all[j].BlockNumber {
			return all[i].BlockNumber < all[j].BlockNumber
		}
		return all[i].Index < all[j].Index
	})
	return all
}

// replayCheck runs the recon-validated normalized arithmetic over the fetched
// logs (independent of the deriver under construction) and returns the net
// normalized figure for `user`, so fixtures are verified against recon's
// table BEFORE being committed.
func replayCheck(t *testing.T, logs []types.Log, user common.Address, seedNormalized *big.Int) *big.Int {
	t.Helper()
	oneE18 := big.NewInt(1_000_000_000_000_000_000)
	net := new(big.Int)
	if seedNormalized != nil {
		net.Set(seedNormalized)
	}
	idxByBlock := map[uint64]*big.Int{}
	userTopic := common.BytesToHash(common.LeftPadBytes(user.Bytes(), 32))
	for _, l := range logs {
		switch l.Topics[0].Hex() {
		case iiuTopic0:
			idxByBlock[l.BlockNumber] = new(big.Int).SetBytes(l.Data[32:64]) // newIndex
		case borrowedTopic0:
			if l.Topics[1] != userTopic {
				continue
			}
			idx := idxByBlock[l.BlockNumber]
			require.NotNil(t, idx, "block %d: no IIU before borrow", l.BlockNumber)
			usd := new(big.Int).SetBytes(l.Data[:32])
			num := new(big.Int).Mul(usd, oneE18)
			q, r := new(big.Int).QuoRem(num, idx, new(big.Int))
			if r.Sign() != 0 {
				q.Add(q, big.NewInt(1))
			}
			net.Add(net, q)
		case repaidTopic0:
			if l.Topics[1] != userTopic {
				continue
			}
			idx := idxByBlock[l.BlockNumber]
			require.NotNil(t, idx, "block %d: no IIU before repay", l.BlockNumber)
			usd := new(big.Int).SetBytes(l.Data[:32])
			num := new(big.Int).Mul(usd, oneE18)
			net.Sub(net, new(big.Int).Quo(num, idx))
		case liqTopic0:
			if l.Topics[2] != userTopic {
				continue
			}
			idx := idxByBlock[l.BlockNumber]
			require.NotNil(t, idx, "block %d: no IIU before liquidation", l.BlockNumber)
			// Non-indexed layout: [offset(collateral[])][beforeDebtAmount]
			// [debtAmountLiquidated][...array tail] -- debtAmountLiquidated
			// is HEAD word 2, not the last word of the data.
			usd := new(big.Int).SetBytes(l.Data[64:96])
			num := new(big.Int).Mul(usd, oneE18)
			removed := new(big.Int).Quo(num, idx)
			net.Sub(net, removed)
			t.Logf("liq block %d idx %s: debtLiquidated %s removed-normalized %s net-after %s view-after %s",
				l.BlockNumber, idx, usd, removed, net,
				new(big.Int).Quo(new(big.Int).Mul(net, idx), oneE18))
		}
	}
	return net
}

func writeFixture(t *testing.T, name string, fx goldenFixture) {
	t.Helper()
	buf, err := json.MarshalIndent(fx, "", "  ")
	require.NoError(t, err)
	require.NoError(t, os.WriteFile(filepath.Join("testdata", name), append(buf, '\n'), 0o644))
	t.Logf("wrote testdata/%s (%d logs)", name, len(fx.Logs))
}

func TestGenGoldenFixtures(t *testing.T) {
	p := newRPCPool(t)
	fetchedAt := time.Now().UTC().Format("2006-01-02")

	// --- Three post-migration borrowers (recon "Debt identity validation").
	wantNet := []string{"963813", "3985789485", "7153773"}
	names := []string{"dm_golden_borrower_0303a641.json", "dm_golden_borrower_0b7043c8.json", "dm_golden_borrower_05e3a665.json"}
	perUser, iiuByBlock := fetchUserHistories(t, p, goldenSafes, dmDeployBlock, pinBlock)
	for i, safe := range goldenSafes {
		logs := assembleHistory(perUser[safe], iiuByBlock)
		net := replayCheck(t, logs, safe, nil)
		require.Equalf(t, wantNet[i], net.String(), "borrower %s: local replay does not match recon table -- DO NOT COMMIT", safe)
		fls := make([]fixtureLog, len(logs))
		for j, l := range logs {
			fls[j] = toFixtureLog(l)
		}
		writeFixture(t, names[i], goldenFixture{
			Provenance: fmt.Sprintf("REAL: complete Debt Manager event history for Safe %s (Borrowed/Repaid topic1, Liquidated topic2) over OP blocks %d-%d, plus the same-block InterestIndexUpdated(USDC) log for every mutating block (exactly one per block -- invariant re-confirmed at fetch). Fetched via eth_getLogs (%s), %s. Golden expectations come from recon/derivation-notes.md 'Debt identity validation': net normalized %s, borrowingOf @ PIN 154,021,227 with getCurrentIndex(USDC)=1042402553573226850. Local normalized replay verified against the recon table before commit.",
				strings.ToLower(safe.Hex()), dmDeployBlock, pinBlock, rpcPrimary, fetchedAt, wantNet[i]),
			ChainID:  10,
			Borrower: strings.ToLower(safe.Hex()),
			Logs:     fls,
		})
	}

	// --- Golden liquidation vector: migrated Safe 0xac5f3ce9...5fcc.
	// Its genesis is a migration batch; find it in the migration window.
	migLogs := p.getLogs(migStartBlock, migEndBlock,
		[][]common.Hash{{common.HexToHash(migrationTopic0)}})
	var migLog *types.Log
	var migCalldata []byte
	var seedAmount *big.Int
	for i := range migLogs {
		l := migLogs[i]
		tx := p.txByHash(l.TxHash)
		seeds, err := decode.DecodeMigrationCalldata(tx.Data())
		require.NoError(t, err)
		for _, s := range seeds {
			if s.Borrower == liqVectorSafe {
				migLog = &migLogs[i]
				migCalldata = tx.Data()
				seedAmount = s.NormalizedAmount
			}
		}
		if migLog != nil {
			break
		}
	}
	require.NotNil(t, migLog, "liq-vector Safe not found in any migration batch")
	t.Logf("liq-vector migration: tx %s block %d seed %s", migLog.TxHash, migLog.BlockNumber, seedAmount)

	// Post-migration history through the liquidation block.
	liqPerUser, liqIIU := fetchUserHistories(t, p, []common.Address{liqVectorSafe}, migLog.BlockNumber, liqVectorBlock)
	histLogs := assembleHistory(liqPerUser[liqVectorSafe], liqIIU)
	all := append([]types.Log{*migLog}, histLogs...)
	sort.Slice(all, func(i, j int) bool {
		if all[i].BlockNumber != all[j].BlockNumber {
			return all[i].BlockNumber < all[j].BlockNumber
		}
		return all[i].Index < all[j].Index
	})

	net := replayCheck(t, all, liqVectorSafe, seedAmount)
	liqIdx := big.NewInt(1_036_365_345_262_130_760)
	view := new(big.Int).Quo(new(big.Int).Mul(net, liqIdx), big.NewInt(1_000_000_000_000_000_000))
	t.Logf("liq vector: net normalized after block %d = %s, view = %s (recon: removed 15,289,230; view 15,845,260)",
		liqVectorBlock, net, view)
	require.Equal(t, "15845260", view.String(), "liq vector view mismatch -- DO NOT COMMIT")

	fls := make([]fixtureLog, len(all))
	for j, l := range all {
		fls[j] = toFixtureLog(l)
	}
	writeFixture(t, "dm_golden_liq_ac5f3ce9.json", goldenFixture{
		Provenance: fmt.Sprintf("REAL: migrated Safe %s (recon 'Migration finding': zero Borrowed events; debt genesis = MigrationBorrowerPositionsSet batch tx %s @ block %d, seed normalized %s from decoded calldata). History (Repaid topic1 / Liquidated topic2 + same-block InterestIndexUpdated(USDC) joins) fetched over OP blocks %d-%d via eth_getLogs (%s), %s. migrationCalldata carries the batch tx's full raw input for the golden test's fake DMChainReads. Golden expectations (recon 'Debt identity validation', liquidation spot check): the Liquidated at block %d with idx 1036365345262130760 removes normalized 15,289,230 and leaves floor(net*idx/1e18) = 15,845,260. Local normalized replay verified before commit.",
			strings.ToLower(liqVectorSafe.Hex()), migLog.TxHash, migLog.BlockNumber, seedAmount,
			migLog.BlockNumber, liqVectorBlock, rpcPrimary, fetchedAt, liqVectorBlock),
		ChainID:  10,
		Borrower: strings.ToLower(liqVectorSafe.Hex()),
		MigrationCalldata: map[string]string{
			migLog.TxHash.Hex(): fmt.Sprintf("0x%x", migCalldata),
		},
		Logs: fls,
	})
}
