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

// idCoveredFrom is the Aave engine's genesis in these fixtures — the coverage the
// flag-custody precondition requires.
var idCoveredFrom = uint64(20_625_519)

func idCursors() []store.DeriveCursorState {
	return []store.DeriveCursorState{
		{Engine: "aave_v3_etherfi", ChainID: 1, LastBlock: 25_635_618, AckedEpoch: 4,
			CoveredFromBlock: &idCoveredFrom, DecoderRevision: 2},
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
		CollateralFlags: []store.CollateralFlagRow{
			{Engine: "aave_v3_etherfi", ChainID: 1, Reserve: []byte{0xC2}, User: []byte{0xA1},
				Enabled: true, Block: 25_600_000, LogIndex: 3},
		},
	}
}

// idFlags / idFlagsFrom mirror idJudged / idJudgedFrom for the collateral-flag
// input family: the CONSULTED projection of the fetched fold, so a test that
// mutates a flag row also moves the record of what the assembler read. Only
// PRESENT rows appear — an absent flag is the no-history law, not substrate.
func idFlags() []ConsultedCollateralFlag { return idFlagsFrom(idInputs()) }

func idFlagsFrom(in store.RiskInputs) []ConsultedCollateralFlag {
	var out []ConsultedCollateralFlag
	for _, f := range in.CollateralFlags {
		out = append(out, ConsultedCollateralFlag{
			Engine: f.Engine, ChainID: f.ChainID, Reserve: f.Reserve, User: f.User,
			Enabled: f.Enabled, Block: f.Block, LogIndex: f.LogIndex,
		})
	}
	return out
}

// idJudged is the fixture's OUTPUT-RELEVANT consulted set: every witness Assemble
// would have consulted, carrying the value fields the digest hashes and the phase the
// classifier assigns at the given clock. Both identity projections read it.
func idJudged(now time.Time) []ConsultedPrice {
	return idJudgedFrom(idInputs(), now)
}

// idJudgedFrom derives the consulted set from GIVEN inputs, so a test that mutates a
// price row also moves the record of what the assembler consulted. Passing a mutated
// `inputs` with an unmutated consulted set would be modelling a repair the assembler
// never saw, which is not a state the pipeline can be in.
func idJudgedFrom(in store.RiskInputs, now time.Time) []ConsultedPrice {
	budget := PriceBudget{Seconds: idPolicy().BudgetSeconds}
	var out []ConsultedPrice
	for _, p := range in.Prices {
		out = append(out, ConsultedPrice{
			ChainID: p.ChainID, Asset: p.Asset, Source: p.Source,
			Present: true, Value: p.Value, Decimals: p.Decimals, BlockNumber: p.BlockNumber,
			Phase:         PriceFreshnessPhase(p, budget, now),
			PhaseRelevant: true,
			AsOf:          p.SourceAsOf.UTC(), HasAsOf: p.HasSourceAsOf,
		})
	}
	return out
}

// TestIdentityPriceDigestIsScopedToTheConsultedSet is the round-5 finding.
//
// Only the phase section was restricted to the consulted set; the substrate digest
// still hashed every FETCHED row. An honest D-012 repair can neutralize or supersede
// an UNRELATED registered asset in place at an unchanged vector — so the row's value
// changes, no cursor moves, and the restart never consults that asset. The digest
// nonetheless minted a new key, and a clean recomputation was written over a
// large-step warning.
//
// MUTANT THIS KILLS: hash inputs.Prices in substrateDigest instead of the consulted
// set. The two identities below stop being equal.
func TestIdentityPriceDigestIsScopedToTheConsultedSet(t *testing.T) {
	base := computeID()

	// An UNRELATED fetched row changes in place: same key set consulted, different
	// unconsulted row. Nothing the batch depends on moved.
	withUnused := idInputs()
	withUnused.Prices = append(withUnused.Prices, store.RiskPriceRow{
		ChainID: 10, Asset: []byte{0xEE}, Source: "priceproviderv2",
		Value: big.NewInt(4242), Decimals: 6, BlockNumber: 999,
		HasSourceAsOf: true, SourceAsOf: idTime,
	})
	got := ComputeMaterializationIdentity(idCursors(), map[int64]int64{1: 4, 10: 9},
		idSweeps(), withUnused, idJudged(idTime), idFlags(), idPolicy())
	require.Equal(t, base.Key, got.Key,
		"an UNCONSULTED fetched row must not change the identity, however it mutates")

	// And the same row mutating again still changes nothing.
	withUnused.Prices[len(withUnused.Prices)-1].Value = big.NewInt(9999)
	again := ComputeMaterializationIdentity(idCursors(), map[int64]int64{1: 4, 10: 9},
		idSweeps(), withUnused, idJudged(idTime), idFlags(), idPolicy())
	require.Equal(t, base.Key, again.Key)
}

// TestIdentityPriceDigestMovesWithAConsultedRow is the counterweight: scoping must
// not make a CONSULTED witness stop mattering.
func TestIdentityPriceDigestMovesWithAConsultedRow(t *testing.T) {
	base := computeID()

	consulted := idJudged(idTime)
	consulted[0].Value = big.NewInt(1) // the in-place repair landed on a USED asset
	got := ComputeMaterializationIdentity(idCursors(), map[int64]int64{1: 4, 10: 9},
		idSweeps(), idInputs(), consulted, idFlags(), idPolicy())
	require.NotEqual(t, base.Key, got.Key,
		"a CONSULTED witness changing value IS a new materialization")

	// Block and as-of likewise.
	consulted = idJudged(idTime)
	consulted[0].BlockNumber++
	got = ComputeMaterializationIdentity(idCursors(), map[int64]int64{1: 4, 10: 9},
		idSweeps(), idInputs(), consulted, idFlags(), idPolicy())
	require.NotEqual(t, base.Key, got.Key)
}

// TestIdentityRecordsAConsultedAbsence: absence is output-relevant — it is what
// produces a G1 refusal — so a consulted witness with no usable row must be
// distinguishable from one that was never consulted, and from a present one.
func TestIdentityRecordsAConsultedAbsence(t *testing.T) {
	present := computeID()

	absent := idJudged(idTime)
	absent[0].Present = false
	absent[0].Value = nil
	absent[0].PhaseRelevant = false // no row, so no phase was consulted
	gotAbsent := ComputeMaterializationIdentity(idCursors(), map[int64]int64{1: 4, 10: 9},
		idSweeps(), idInputs(), absent, idFlags(), idPolicy())
	require.NotEqual(t, present.Key, gotAbsent.Key,
		"a consulted witness that was ABSENT is a different materialization from a present one")

	// Dropping it entirely (never consulted) is different again from consulting it
	// and finding nothing.
	notConsulted := idJudged(idTime)[1:]
	gotDropped := ComputeMaterializationIdentity(idCursors(), map[int64]int64{1: 4, 10: 9},
		idSweeps(), idInputs(), notConsulted, idFlags(), idPolicy())
	require.NotEqual(t, gotAbsent.Key, gotDropped.Key,
		"consulted-and-absent must not collide with never-consulted")
}

// TestIdentityG2ConsultationEntersTheDigestWithoutAPhase: a witness consulted on the
// way to a G2 refusal has no phase, but it WAS consulted, so it belongs in the digest.
func TestIdentityG2ConsultationEntersTheDigestWithoutAPhase(t *testing.T) {
	withPhase := computeID()

	g2 := idJudged(idTime)
	g2[0].PhaseRelevant = false // refused at G2 before freshness was consulted
	g2[0].Phase = ""
	got := ComputeMaterializationIdentity(idCursors(), map[int64]int64{1: 4, 10: 9},
		idSweeps(), idInputs(), g2, idFlags(), idPolicy())
	require.NotEqual(t, withPhase.Key, got.Key,
		"dropping the phase changes the identity...")
	require.Contains(t, got.Vector, "freshness:",
		"...and the phase section still exists for the witnesses that do have one")

	// The row's VALUE still binds even with no phase — that is the digest half.
	g2b := g2
	g2b[0].Value = big.NewInt(7777)
	got2 := ComputeMaterializationIdentity(idCursors(), map[int64]int64{1: 4, 10: 9},
		idSweeps(), idInputs(), g2b, idFlags(), idPolicy())
	require.NotEqual(t, got.Key, got2.Key,
		"a G2-consulted witness's value still enters the digest")
}

func computeID() MaterializationIdentity {
	return ComputeMaterializationIdentity(idCursors(), map[int64]int64{1: 4, 10: 9},
		idSweeps(), idInputs(), idJudged(idTime), idFlags(), idPolicy())
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
		idSweeps(), in, idJudged(idTime), idFlagsFrom(in), idPolicy())
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
		got := ComputeMaterializationIdentity(c, map[int64]int64{1: 4, 10: 9}, idSweeps(), idInputs(), idJudged(idTime), idFlags(), idPolicy())
		require.NotEqual(t, base.Key, got.Key)
	})
	t.Run("acked_epoch", func(t *testing.T) {
		c := idCursors()
		c[0].AckedEpoch++
		got := ComputeMaterializationIdentity(c, map[int64]int64{1: 4, 10: 9}, idSweeps(), idInputs(), idJudged(idTime), idFlags(), idPolicy())
		require.NotEqual(t, base.Key, got.Key)
	})
	t.Run("chain_id", func(t *testing.T) {
		c := idCursors()
		c[0].ChainID = 999
		got := ComputeMaterializationIdentity(c, map[int64]int64{1: 4, 10: 9}, idSweeps(), idInputs(), idJudged(idTime), idFlags(), idPolicy())
		require.NotEqual(t, base.Key, got.Key)
	})
	t.Run("max_epoch", func(t *testing.T) {
		got := ComputeMaterializationIdentity(idCursors(), map[int64]int64{1: 5, 10: 9}, idSweeps(), idInputs(), idJudged(idTime), idFlags(), idPolicy())
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
			got := ComputeMaterializationIdentity(idCursors(), map[int64]int64{1: 4, 10: 9}, sw, idInputs(), idJudged(idTime), idFlags(), idPolicy())
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
			got := ComputeMaterializationIdentity(idCursors(), map[int64]int64{1: 4, 10: 9}, idSweeps(), idInputs(), idJudged(idTime), idFlags(), pol)
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

	// The repaired row is a CONSULTED witness, so the consulted set is derived from
	// the mutated inputs — that is what the assembler would have seen.
	got := ComputeMaterializationIdentity(idCursors(), map[int64]int64{1: 4, 10: 9},
		idSweeps(), in, idJudgedFrom(in, idTime), idFlagsFrom(in), idPolicy())
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
			got := ComputeMaterializationIdentity(idCursors(), map[int64]int64{1: 4, 10: 9},
				idSweeps(), in, idJudgedFrom(in, idTime), idFlagsFrom(in), idPolicy())
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

	a := ComputeMaterializationIdentity(idCursors(), map[int64]int64{1: 4, 10: 9}, idSweeps(), absent, idJudged(idTime), idFlagsFrom(absent), idPolicy())
	z := ComputeMaterializationIdentity(idCursors(), map[int64]int64{1: 4, 10: 9}, idSweeps(), zero, idJudged(idTime), idFlagsFrom(zero), idPolicy())
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
	got := ComputeMaterializationIdentity(idCursors(), map[int64]int64{1: 4, 10: 9}, idSweeps(), later, idJudged(later.ReadAt), idFlagsFrom(later), idPolicy())
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
			idSweeps(), in, idJudged(in.ReadAt), idFlagsFrom(in), idPolicy())
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
	got := ComputeMaterializationIdentity(idCursors(), map[int64]int64{1: 4, 10: 9}, idSweeps(), idInputs(), idJudged(idTime), idFlags(), pol)
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
	got := ComputeMaterializationIdentity(idCursors(), map[int64]int64{1: 4, 10: 9}, idSweeps(), idInputs(), idJudged(idTime), idFlags(), pol)
	require.NotEqual(t, base.Key, got.Key)
}

// TestIdentityChangesWithDerivationCoverage is direction 5 of the round-1 fix: the
// coverage stamp decides REFUSE-vs-COMPUTE for the entire Aave book, so it is an
// input the output depends on and the standing law puts it in the identity.
//
// The hazard it closes is concrete and is the whole reason the stamp exists. A
// rewind-and-rederive re-establishes coverage while ending at the SAME cursor it
// started from: last_block, acked_epoch, epochs, sweeps and prices are all
// byte-identical across it. Without coverage in the identity, the post-replay pass
// — the one that finally computes the book instead of refusing it — would derive the
// pre-replay key and ADOPT the refused batch, so the repaired numbers would never
// be served.
//
// MUTANT THIS KILLS: drop cov/rev from the cursor line in the vector. Every subtest
// below collides with the base key.
func TestIdentityChangesWithDerivationCoverage(t *testing.T) {
	base := computeID()

	higher := uint64(20_625_520)
	for name, mutate := range map[string]func(c *store.DeriveCursorState){
		"coverage lost (pre-replay state)": func(c *store.DeriveCursorState) {
			c.CoveredFromBlock, c.DecoderRevision = nil, 0
		},
		"coverage start moves":            func(c *store.DeriveCursorState) { c.CoveredFromBlock = &higher },
		"decoder revision moves":          func(c *store.DeriveCursorState) { c.DecoderRevision++ },
		"revision cleared but block kept": func(c *store.DeriveCursorState) { c.DecoderRevision = 0 },
	} {
		t.Run(name, func(t *testing.T) {
			c := idCursors()
			mutate(&c[0])
			got := ComputeMaterializationIdentity(c, map[int64]int64{1: 4, 10: 9},
				idSweeps(), idInputs(), idJudged(idTime), idFlags(), idPolicy())
			require.NotEqual(t, base.Key, got.Key,
				"derivation-coverage change %q must change the identity", name)
		})
	}

	// AND THE NULL/ZERO STATE MUST BE DISTINGUISHABLE FROM A REAL ONE in the
	// vector too, not merely in the hash — an operator reading a refused book has
	// to be able to see why.
	c := idCursors()
	c[0].CoveredFromBlock, c[0].DecoderRevision = nil, 0
	unproven := ComputeMaterializationIdentity(c, map[int64]int64{1: 4, 10: 9},
		idSweeps(), idInputs(), idJudged(idTime), idFlags(), idPolicy())
	require.Contains(t, unproven.Vector, "/covnone/rev0;")
}

// TestIdentitySurvivesTheCoverageReplayChoreography is the operational twin of the
// flag-backfill test below, on the OTHER half of the fix: the replay that restores
// coverage must mint a new key even though every watermark it touches returns to
// where it began.
func TestIdentitySurvivesTheCoverageReplayChoreography(t *testing.T) {
	preCursors := idCursors()
	preCursors[0].CoveredFromBlock, preCursors[0].DecoderRevision = nil, 0

	pre := ComputeMaterializationIdentity(preCursors, map[int64]int64{1: 4, 10: 9},
		idSweeps(), func() store.RiskInputs { in := idInputs(); in.CollateralFlags = nil; return in }(),
		idJudged(idTime), nil, idPolicy())
	post := ComputeMaterializationIdentity(idCursors(), map[int64]int64{1: 4, 10: 9},
		idSweeps(), idInputs(), idJudged(idTime), idFlags(), idPolicy())

	require.NotEqual(t, pre.Key, post.Key,
		"the pass that computes the book must not adopt the batch that refused it")
	require.NotEqual(t, pre.Vector, post.Vector,
		"and the difference is VISIBLE in the vector, which is the operator's answer to 'why did this change'")
}

// ---------------------------------------------------------------------------
// The collateral-flag input family in the identity.
// ---------------------------------------------------------------------------

// TestIdentityChangesWithAConsultedCollateralFlag is the identity law applied to
// the new input family: the flag decides each leg's `used_as_collateral` and
// through it the position's collateral base, weighted LT sum and the engine
// aggregate, so a flag that changes IS a new materialization.
//
// MUTANT THIS KILLS: drop the `collateral_flags` section from substrateDigest.
// Every subtest below then collides with the base key.
func TestIdentityChangesWithAConsultedCollateralFlag(t *testing.T) {
	base := computeID()
	for name, mutate := range map[string]func(f *ConsultedCollateralFlag){
		"enabled flips":  func(f *ConsultedCollateralFlag) { f.Enabled = !f.Enabled },
		"witness block":  func(f *ConsultedCollateralFlag) { f.Block++ },
		"witness logidx": func(f *ConsultedCollateralFlag) { f.LogIndex++ },
		"reserve":        func(f *ConsultedCollateralFlag) { f.Reserve = []byte{0xCC} },
		"user":           func(f *ConsultedCollateralFlag) { f.User = []byte{0xAA} },
		"engine":         func(f *ConsultedCollateralFlag) { f.Engine = "other_engine" },
		"chain":          func(f *ConsultedCollateralFlag) { f.ChainID = 999 },
	} {
		t.Run(name, func(t *testing.T) {
			fl := idFlags()
			mutate(&fl[0])
			got := ComputeMaterializationIdentity(idCursors(), map[int64]int64{1: 4, 10: 9},
				idSweeps(), idInputs(), idJudged(idTime), fl, idPolicy())
			require.NotEqual(t, base.Key, got.Key,
				"collateral-flag change %q must change the identity", name)
		})
	}
}

// TestIdentityCollateralFlagDigestIsScopedToTheConsultedSet applies the price
// scoping law to the flags. `CollateralFlagsAsOf` returns every witnessed pair
// below the cursor — on the live book that is 94 pairs, most for accounts with no
// position today. Hashing the FETCHED fold would let one of those mint a new key
// for an output-identical batch, which is how a restart declines to adopt and
// writes a clean batch over a large-step warning.
//
// MUTANT THIS KILLS: hash inputs.CollateralFlags instead of the consulted slice.
func TestIdentityCollateralFlagDigestIsScopedToTheConsultedSet(t *testing.T) {
	base := computeID()

	withUnused := idInputs()
	withUnused.CollateralFlags = append(withUnused.CollateralFlags, store.CollateralFlagRow{
		Engine: "aave_v3_etherfi", ChainID: 1, Reserve: []byte{0xEE}, User: []byte{0xFF},
		Enabled: false, Block: 25_111_111, LogIndex: 9,
	})
	// The consulted set is deliberately NOT re-derived: this models a witnessed
	// pair the assembler never read, because that account holds nothing.
	got := ComputeMaterializationIdentity(idCursors(), map[int64]int64{1: 4, 10: 9},
		idSweeps(), withUnused, idJudged(idTime), idFlags(), idPolicy())
	require.Equal(t, base.Key, got.Key,
		"a witnessed pair NOBODY VALUED must not change the identity")

	// And it still must not, whichever way it mutates.
	withUnused.CollateralFlags[len(withUnused.CollateralFlags)-1].Enabled = true
	again := ComputeMaterializationIdentity(idCursors(), map[int64]int64{1: 4, 10: 9},
		idSweeps(), withUnused, idJudged(idTime), idFlags(), idPolicy())
	require.Equal(t, base.Key, again.Key)
}

// TestIdentityNoFlagHistoryAddsNoDigestEntry is the phantom-entry half.
//
// A leg with NO flag witness resolves to false by the no-history LAW — a constant
// of the algorithm, covered by AlgorithmRevision — so it must contribute NOTHING
// to the substrate digest. If absence were recorded the way an absent PRICE is,
// the digest would gain lines keyed on nothing but which accounts hold which
// assets, and the flag section would move whenever the book's shape moved even
// with the ledger untouched.
//
// The property is expressed the only way it honestly can be: the digest is a pure
// function of the consulted slice, so "no phantom entry" means an empty consulted
// slice is one fixed digest regardless of the book, while a single WITNESSED row
// is a different one. Assemble's own half of the proof — that a no-history book
// really does report an EMPTY ConsultedFlags — lives in
// TestAssembleAaveNoFlagHistoryMeansNotCollateral.
func TestIdentityNoFlagHistoryAddsNoDigestEntry(t *testing.T) {
	noHistory := idInputs()
	noHistory.CollateralFlags = nil

	empty := ComputeMaterializationIdentity(idCursors(), map[int64]int64{1: 4, 10: 9},
		idSweeps(), noHistory, idJudged(idTime), nil, idPolicy())

	// Growing the BOOK while the flag ledger stays empty must not touch the flag
	// section: no witness, no entry.
	biggerBook := noHistory
	biggerBook.Balances = append(append([]store.RiskBalanceRow(nil), noHistory.Balances...),
		store.RiskBalanceRow{Engine: "aave_v3_etherfi", Account: []byte{0xA7}, Asset: []byte{0xC2},
			Side: "collateral", Source: "event", Amount: big.NewInt(7), UpdatedBlock: 25_635_618})
	grown := ComputeMaterializationIdentity(idCursors(), map[int64]int64{1: 4, 10: 9},
		idSweeps(), biggerBook, idJudged(idTime), nil, idPolicy())
	require.NotEqual(t, empty.Key, grown.Key,
		"the new BALANCE row is substrate and must move the key (via the balances section)")

	// nil and an explicitly empty slice are the same statement: nothing was
	// witnessed. A digest that distinguished them would make the key depend on how
	// Assemble happened to initialize a slice.
	emptySlice := ComputeMaterializationIdentity(idCursors(), map[int64]int64{1: 4, 10: 9},
		idSweeps(), noHistory, idJudged(idTime), []ConsultedCollateralFlag{}, idPolicy())
	require.Equal(t, empty.Key, emptySlice.Key)

	// And a single WITNESSED row is a genuinely different materialization from no
	// history at all — the fact that makes the backfill safe.
	witnessed := ComputeMaterializationIdentity(idCursors(), map[int64]int64{1: 4, 10: 9},
		idSweeps(), idInputs(), idJudged(idTime), idFlags(), idPolicy())
	require.NotEqual(t, empty.Key, witnessed.Key,
		"witnessed-enabled must not collide with no-history-so-false: the backfill depends on it")
}

// TestIdentitySurvivesTheFlagBackfillChoreography is the operational case stated
// as a test, because it is the one where every OTHER section of the identity is
// byte-identical.
//
// The owner-gated maintenance window rewinds the Aave derive cursor, re-derives
// the range, and ends with the cursor back at the block it started from. Cursors,
// epochs, sweep state, params, balances and every price line are therefore
// unchanged across it — only the flag ledger is new. Without the collateral_flags
// digest section the post-backfill pass would derive the pre-backfill key, ADOPT
// that batch, and publish the assume-true collateral the backfill existed to
// correct.
func TestIdentitySurvivesTheFlagBackfillChoreography(t *testing.T) {
	before := idInputs()
	before.CollateralFlags = nil // pre-backfill: the logs are in raw_logs, undERIVED

	after := idInputs() // post-backfill: same cursor, same everything, flags present

	pre := ComputeMaterializationIdentity(idCursors(), map[int64]int64{1: 4, 10: 9},
		idSweeps(), before, idJudged(idTime), nil, idPolicy())
	post := ComputeMaterializationIdentity(idCursors(), map[int64]int64{1: 4, 10: 9},
		idSweeps(), after, idJudged(idTime), idFlags(), idPolicy())

	// The vector — cursors, epochs, sweep, policy, freshness — is IDENTICAL. That
	// is the whole hazard: nothing outside the digest can see this change.
	require.Equal(t, pre.Vector, post.Vector,
		"the backfill moves no watermark, which is exactly why the digest must carry it")
	require.NotEqual(t, pre.SubstrateDigest, post.SubstrateDigest)
	require.NotEqual(t, pre.Key, post.Key,
		"a re-derived flag ledger at an unchanged cursor is a NEW materialization")
}

// TestIdentityVectorIsHumanReadable: the persisted vector is also the operational
// answer to "what was this batch computed from", so it must not be an opaque blob.
func TestIdentityVectorIsHumanReadable(t *testing.T) {
	id := computeID()
	require.Contains(t, id.Vector, "aave_v3_etherfi@1/25635618/ack4/cov20625519/rev2",
		"the cursor line carries the DERIVATION-COVERAGE provenance: an operator reading a "+
			"refused Aave book needs to see cov/rev, not infer it")
	require.Contains(t, id.Vector, "debt_manager=rows2/failed1/sum309580000")
	require.Contains(t, id.Vector, "budget=180;step=2000")
	require.Contains(t, id.Vector, "epochs:1=4;10=9;")
}
