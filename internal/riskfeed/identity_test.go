package riskfeed

// Determinism is the whole property this file defends. If any of these fail, the
// duplicate-batch hole is open again — a process that cannot re-derive the key for
// a materialization it already wrote will write it twice.

import (
	"math/big"
	"testing"
	"time"

	"github.com/stretchr/testify/require"

	"github.com/kaselunt/solvent/internal/store"
)

func idPolicy() IdentityPolicy {
	return IdentityPolicy{
		BudgetSeconds: 180,
		StepBps:       2000,
		AaveEngine: EngineBinding{Engine: "aave_v3_etherfi", ChainID: 1,
			ParamEngine: "aave_param", PriceEngine: "prices:poll:1"},
		DMEngine: EngineBinding{Engine: "debt_manager", ChainID: 10,
			ParamEngine: "debt_manager", PriceEngine: "prices:poll:10"},
		RequiredEngines:     []string{"aave_v3_etherfi", "aave_param", "debt_manager"},
		SweptEngines:        []string{"debt_manager"},
		Producer:            "riskd",
		AlgorithmRevision:   AlgorithmRevision,
		RegistryFingerprint: "registry-fingerprint-fixture",
	}
}

var idTime = time.Date(2026, 7, 29, 12, 0, 0, 0, time.UTC)

func idCursors() []store.DeriveCursorState {
	return []store.DeriveCursorState{
		{Engine: "aave_v3_etherfi", ChainID: 1, LastBlock: 25_635_618, AckedEpoch: 4},
		{Engine: "aave_param", ChainID: 1, LastBlock: 25_635_618, AckedEpoch: 4},
		{Engine: "debt_manager", ChainID: 10, LastBlock: 154_796_552, AckedEpoch: 9},
	}
}

func idSweeps() []store.RiskSweepWatermark {
	return []store.RiskSweepWatermark{{
		Engine: "debt_manager", Rows: 2, Failed: 1,
		SuccessSum: big.NewInt(309_580_000), HasUpdatedAt: true, MaxUpdatedAt: idTime,
		Generation: 3, GenerationOpen: false,
	}}
}

func idInputs() store.RiskInputs {
	return store.RiskInputs{
		ReadAt: idTime,
		Balances: []store.RiskBalanceRow{
			{Engine: "debt_manager", Account: []byte{0xB1}, Asset: []byte{0xC1},
				Side: "collateral", Source: "snapshot", Amount: big.NewInt(1000), UpdatedBlock: 154_790_000},
			{Engine: "aave_v3_etherfi", Account: []byte{0xA1}, Asset: []byte{0xC2},
				Side: "debt", Source: "event", Amount: big.NewInt(500), UpdatedBlock: 25_635_618},
		},
		Indexes: []store.RiskRateIndexRow{
			{Engine: "aave_v3_etherfi", Asset: []byte{0xC2}, Kind: "variable_borrow_index",
				Value: big.NewInt(1), Block: 25_610_000},
		},
		Prices: []store.RiskPriceRow{
			{ChainID: 1, Asset: []byte{0xC2}, Source: "aaveoracle:0x1", Value: big.NewInt(100000000),
				Decimals: 8, BlockNumber: 25_635_600, HasSourceAsOf: true, SourceAsOf: idTime},
		},
		AaveParams: []store.ParamRow{
			{Engine: "aave_param", ChainID: 1, Asset: []byte{0xC2},
				LiqThreshold: big.NewInt(8100), EffectiveBlock: 100, EffectiveLogIndex: 1},
		},
	}
}

// idJudged is the fixture's OUTPUT-RELEVANT judged set: the prices Assemble would
// actually have consulted freshness for. It is derived from the fixture inputs at a
// given clock so the phase assertions below exercise the real classifier.
func idJudged(now time.Time) []JudgedPrice {
	budget := PriceBudget{Seconds: idPolicy().BudgetSeconds}
	var out []JudgedPrice
	for _, p := range idInputs().Prices {
		out = append(out, JudgedPrice{
			ChainID: p.ChainID, Asset: p.Asset, Source: p.Source,
			Phase: PriceFreshnessPhase(p, budget, now),
			AsOf:  p.SourceAsOf.UTC(), HasAsOf: p.HasSourceAsOf,
		})
	}
	return out
}

func computeID() MaterializationIdentity {
	return ComputeMaterializationIdentity(idCursors(), map[int64]int64{1: 4, 10: 9},
		idSweeps(), idInputs(), idJudged(idTime), idPolicy())
}

// TestIdentityIsDeterministicAcrossRepeatedComputation is the core property: the
// SAME materialization must always yield the SAME key. This is what lets a
// restart, a retry whose reconciliation failed, or a second instance ADOPT the
// committed batch instead of writing an unflagged duplicate over it.
func TestIdentityIsDeterministicAcrossRepeatedComputation(t *testing.T) {
	first := computeID()
	require.NotEmpty(t, first.Key)
	require.Len(t, first.Key, 64, "sha256 hex")
	for i := 0; i < 25; i++ {
		again := computeID()
		require.Equal(t, first.Key, again.Key, "iteration %d", i)
		require.Equal(t, first.Vector, again.Vector)
		require.Equal(t, first.SubstrateDigest, again.SubstrateDigest)
	}
}

// TestIdentityIsInputOrderIndependent: the store returns rows in a defined order
// today, but a key that depended on it would break the moment an index or a plan
// changed — and it would break SILENTLY, as a duplicate batch.
func TestIdentityIsInputOrderIndependent(t *testing.T) {
	base := computeID()

	cursors := idCursors()
	cursors[0], cursors[2] = cursors[2], cursors[0]
	in := idInputs()
	in.Balances[0], in.Balances[1] = in.Balances[1], in.Balances[0]

	shuffled := ComputeMaterializationIdentity(cursors, map[int64]int64{10: 9, 1: 4},
		idSweeps(), in, idJudged(idTime), idPolicy())
	require.Equal(t, base.Key, shuffled.Key,
		"reordering the same rows is the same materialization")
}

// TestIdentityChangesWithEveryWatermarkComponent — each is a different
// materialization and must not adopt the others' batch.
func TestIdentityChangesWithEveryWatermarkComponent(t *testing.T) {
	base := computeID()

	t.Run("last_block", func(t *testing.T) {
		c := idCursors()
		c[0].LastBlock++
		got := ComputeMaterializationIdentity(c, map[int64]int64{1: 4, 10: 9}, idSweeps(), idInputs(), idJudged(idTime), idPolicy())
		require.NotEqual(t, base.Key, got.Key)
	})
	t.Run("acked_epoch", func(t *testing.T) {
		c := idCursors()
		c[0].AckedEpoch++
		got := ComputeMaterializationIdentity(c, map[int64]int64{1: 4, 10: 9}, idSweeps(), idInputs(), idJudged(idTime), idPolicy())
		require.NotEqual(t, base.Key, got.Key)
	})
	t.Run("chain_id", func(t *testing.T) {
		c := idCursors()
		c[0].ChainID = 999
		got := ComputeMaterializationIdentity(c, map[int64]int64{1: 4, 10: 9}, idSweeps(), idInputs(), idJudged(idTime), idPolicy())
		require.NotEqual(t, base.Key, got.Key)
	})
	t.Run("max_epoch", func(t *testing.T) {
		got := ComputeMaterializationIdentity(idCursors(), map[int64]int64{1: 5, 10: 9}, idSweeps(), idInputs(), idJudged(idTime), idPolicy())
		require.NotEqual(t, base.Key, got.Key)
	})
}

// TestIdentityChangesWithSweepState: sweep movement is a new materialization even
// though no cursor moved — the whole point of the sweep leg.
func TestIdentityChangesWithSweepState(t *testing.T) {
	base := computeID()
	for name, mutate := range map[string]func(w *store.RiskSweepWatermark){
		"rows":       func(w *store.RiskSweepWatermark) { w.Rows++ },
		"failed":     func(w *store.RiskSweepWatermark) { w.Failed++ },
		"successSum": func(w *store.RiskSweepWatermark) { w.SuccessSum = big.NewInt(1) },
		"updatedAt":  func(w *store.RiskSweepWatermark) { w.MaxUpdatedAt = idTime.Add(time.Second) },
		"generation": func(w *store.RiskSweepWatermark) { w.Generation++ },
		"open":       func(w *store.RiskSweepWatermark) { w.GenerationOpen = true },
	} {
		t.Run(name, func(t *testing.T) {
			sw := idSweeps()
			mutate(&sw[0])
			got := ComputeMaterializationIdentity(idCursors(), map[int64]int64{1: 4, 10: 9}, sw, idInputs(), idJudged(idTime), idPolicy())
			require.NotEqual(t, base.Key, got.Key)
		})
	}
}

// TestIdentityChangesWithPolicy: a batch computed under a different price budget
// or step bound is not the same materialization, because the verdicts differ from
// byte-identical substrate.
func TestIdentityChangesWithPolicy(t *testing.T) {
	base := computeID()
	for name, mutate := range map[string]func(p *IdentityPolicy){
		"budget":   func(p *IdentityPolicy) { p.BudgetSeconds = 30 },
		"stepBps":  func(p *IdentityPolicy) { p.StepBps = 500 },
		"producer": func(p *IdentityPolicy) { p.Producer = "riskd-next" },
		"binding":  func(p *IdentityPolicy) { p.DMEngine.PriceEngine = "prices:poll:999" },
		"required": func(p *IdentityPolicy) { p.RequiredEngines = []string{"aave_v3_etherfi"} },
		"swept":    func(p *IdentityPolicy) { p.SweptEngines = nil },
	} {
		t.Run(name, func(t *testing.T) {
			pol := idPolicy()
			mutate(&pol)
			got := ComputeMaterializationIdentity(idCursors(), map[int64]int64{1: 4, 10: 9}, idSweeps(), idInputs(), idJudged(idTime), pol)
			require.NotEqual(t, base.Key, got.Key, "policy %s must change the identity", name)
		})
	}
}

// TestIdentityChangesWhenAPriceIsNeutralizedInPlace is why the substrate digest
// exists and is not redundant with the vector.
//
// D-012 lets a price row be marked invalid IN PLACE. No cursor moves, so the
// vector is byte-identical — but the usable price genuinely changed, and that is a
// NEW materialization that must get its own batch. Without the substrate digest it
// would adopt the earlier one and the corrected number would never be published.
func TestIdentityChangesWhenAPriceIsNeutralizedInPlace(t *testing.T) {
	base := computeID()

	in := idInputs()
	// The old row is gone from the usable set; a lower-block row is now newest.
	in.Prices[0].Value = big.NewInt(99000000)
	in.Prices[0].BlockNumber = 25_635_500

	got := ComputeMaterializationIdentity(idCursors(), map[int64]int64{1: 4, 10: 9}, idSweeps(), in, idJudged(idTime), idPolicy())
	require.NotEqual(t, base.Key, got.Key,
		"the same cursors over DIFFERENT prices is a different materialization")
}

func TestIdentityChangesWithSubstrateRows(t *testing.T) {
	base := computeID()
	for name, mutate := range map[string]func(in *store.RiskInputs){
		"balance amount":  func(in *store.RiskInputs) { in.Balances[0].Amount = big.NewInt(9999) },
		"balance block":   func(in *store.RiskInputs) { in.Balances[0].UpdatedBlock++ },
		"index value":     func(in *store.RiskInputs) { in.Indexes[0].Value = big.NewInt(7) },
		"param threshold": func(in *store.RiskInputs) { in.AaveParams[0].LiqThreshold = big.NewInt(7500) },
		"price as-of":     func(in *store.RiskInputs) { in.Prices[0].SourceAsOf = idTime.Add(time.Minute) },
		"conflict added": func(in *store.RiskInputs) {
			in.BalanceConflicts = []store.RiskBalanceConflict{{Engine: "debt_manager", Account: []byte{0xB9}}}
		},
		"sweep row added": func(in *store.RiskInputs) {
			in.Sweeps = []store.RiskSweepRow{{Engine: "debt_manager", Account: []byte{0xB1}, Status: "failed"}}
		},
	} {
		t.Run(name, func(t *testing.T) {
			in := idInputs()
			mutate(&in)
			got := ComputeMaterializationIdentity(idCursors(), map[int64]int64{1: 4, 10: 9}, idSweeps(), in, idJudged(idTime), idPolicy())
			require.NotEqual(t, base.Key, got.Key, "substrate change %q must change the identity", name)
		})
	}
}

// TestIdentityDistinguishesAbsentFromZero: an absent parameter and a zero one are
// different facts, and a digest that rendered both as "0" would let a batch
// computed with no liquidation bonus adopt one computed with a zero bonus.
func TestIdentityDistinguishesAbsentFromZero(t *testing.T) {
	absent := idInputs()
	absent.AaveParams[0].LiqBonus = nil
	zero := idInputs()
	zero.AaveParams[0].LiqBonus = big.NewInt(0)

	a := ComputeMaterializationIdentity(idCursors(), map[int64]int64{1: 4, 10: 9}, idSweeps(), absent, idJudged(idTime), idPolicy())
	z := ComputeMaterializationIdentity(idCursors(), map[int64]int64{1: 4, 10: 9}, idSweeps(), zero, idJudged(idTime), idPolicy())
	require.NotEqual(t, a.Key, z.Key, "nil is not zero")
}

// TestIdentityIgnoresTheStepBaseline is the SUBTLE requirement, and getting it
// wrong reopens the hole the identity was built to close.
//
// The previous batch's disclosed prices are not substrate — they are a function of
// what we last published. A fresh pass and its own post-restart recomputation see
// DIFFERENT baselines (the restart reads the committed post-move price), so if the
// baseline entered the identity the two would get different keys, the restart
// would not adopt, and it would write exactly the unflagged duplicate this is
// meant to prevent. ReadAt is excluded for the same reason: it is a clock, and a
// clock in the key makes every recomputation a new materialization.
func TestIdentityIgnoresTheStepBaselineAndTheClock(t *testing.T) {
	base := computeID()

	// +30s: still inside the FRESH phase (budget 180s).
	later := idInputs()
	later.ReadAt = idTime.Add(30 * time.Second)
	got := ComputeMaterializationIdentity(idCursors(), map[int64]int64{1: 4, 10: 9}, idSweeps(), later, idJudged(later.ReadAt), idPolicy())
	require.Equal(t, base.Key, got.Key,
		"the snapshot CLOCK must not enter the identity — otherwise every recomputation is a new materialization")

	// AND THE COLLISION MUST BE SAFE, not merely present. Equal keys are only
	// honest if the two reads would produce the SAME OUTPUT; asserting key equality
	// alone would pin exactly the unsafe collision this test used to permit. So the
	// verdicts are compared too.
	budget := PriceBudget{Seconds: idPolicy().BudgetSeconds}
	for _, row := range idInputs().Prices {
		require.Equal(t,
			PriceFreshnessPhase(row, budget, idTime),
			PriceFreshnessPhase(row, budget, later.ReadAt),
			"within one phase the verdict is identical, which is what makes the shared key safe")
	}
}

// TestIdentityChangesWhenAPriceCrossesAFreshnessThreshold is the OTHER half, and
// the finding it closes: a poller stops, database time crosses the budget or the
// ceiling, and the daemon restarts. The pass now computes a stale flag or a G1
// refusal — and it must NOT derive the pre-crossing key, because adopting that
// batch would leave its "fresh" disclosure standing and suppress the refusal.
func TestIdentityChangesWhenAPriceCrossesAFreshnessThreshold(t *testing.T) {
	budget := PriceBudget{Seconds: idPolicy().BudgetSeconds} // 180s, ceiling 360s

	at := func(offset time.Duration) MaterializationIdentity {
		in := idInputs()
		in.ReadAt = idTime.Add(offset)
		return ComputeMaterializationIdentity(idCursors(), map[int64]int64{1: 4, 10: 9},
			idSweeps(), in, idJudged(in.ReadAt), idPolicy())
	}

	fresh := at(30 * time.Second)
	stillFresh := at(180 * time.Second)
	stale := at(181 * time.Second)
	stillStale := at(360 * time.Second)
	overCeiling := at(361 * time.Second)

	require.Equal(t, fresh.Key, stillFresh.Key, "the whole fresh phase is one materialization")
	require.NotEqual(t, stillFresh.Key, stale.Key,
		"crossing the BUDGET changes the verdict, so it must change the materialization")
	require.Equal(t, stale.Key, stillStale.Key, "the whole stale phase is one materialization")
	require.NotEqual(t, stillStale.Key, overCeiling.Key,
		"crossing the CEILING turns a flag into a refusal, so it must change the materialization")

	// The phases really are what moved — the fixture is not passing by accident.
	row := idInputs().Prices[0]
	require.Equal(t, VerdictFresh, PriceFreshnessPhase(row, budget, idTime.Add(180*time.Second)))
	require.Equal(t, VerdictStale, PriceFreshnessPhase(row, budget, idTime.Add(181*time.Second)))
	require.Equal(t, VerdictOverCeiling, PriceFreshnessPhase(row, budget, idTime.Add(361*time.Second)))
}

// TestIdentityChangesWithTheAlgorithmRevision: an upgraded binary with changed math
// must NOT adopt the old code's batch.
func TestIdentityChangesWithTheAlgorithmRevision(t *testing.T) {
	base := computeID()
	pol := idPolicy()
	pol.AlgorithmRevision = AlgorithmRevision + 1
	got := ComputeMaterializationIdentity(idCursors(), map[int64]int64{1: 4, 10: 9}, idSweeps(), idInputs(), idJudged(idTime), pol)
	require.NotEqual(t, base.Key, got.Key,
		"a revision bump is a new set of laws and therefore a new materialization")
}

// TestIdentityChangesWithTheRegistryFingerprint: a configuration change that moves
// a NUMBER without moving any input row — corrected token decimals being the sharp
// case — must not adopt the mis-scaled prior result.
func TestIdentityChangesWithTheRegistryFingerprint(t *testing.T) {
	base := computeID()
	pol := idPolicy()
	pol.RegistryFingerprint = "a-corrected-registry"
	got := ComputeMaterializationIdentity(idCursors(), map[int64]int64{1: 4, 10: 9}, idSweeps(), idInputs(), idJudged(idTime), pol)
	require.NotEqual(t, base.Key, got.Key)
}

// TestIdentityVectorIsHumanReadable: the persisted vector is also the operational
// answer to "what was this batch computed from", so it must not be an opaque blob.
func TestIdentityVectorIsHumanReadable(t *testing.T) {
	id := computeID()
	require.Contains(t, id.Vector, "aave_v3_etherfi@1/25635618/ack4")
	require.Contains(t, id.Vector, "debt_manager=rows2/failed1/sum309580000")
	require.Contains(t, id.Vector, "budget=180;step=2000")
	require.Contains(t, id.Vector, "epochs:1=4;10=9;")
}
