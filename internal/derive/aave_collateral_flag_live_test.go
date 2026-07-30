package derive

// The collateral-flag MACHINERY PROOF, end to end on a scratch database:
//
//	real raw_logs bytes → real decode.Registry → real AaveEngine → real Runner
//	  → position_events → store.CollateralFlagsAsOf
//
// Nothing in this path is faked. That matters because the historical backfill on
// the live database is a REWIND-AND-REDERIVE — no out-of-band inserts, no healing
// UPDATE — so the only thing that has to work is exactly this pipeline. Proving it
// here on a scratch DB is what makes the owner-gated live window a re-run of a
// tested path rather than a first attempt.
//
// It also proves the property a private flag table would have forced us to
// re-implement and get wrong: the flags REWIND with every other derived row,
// because they ARE derived rows. (Epoch protection and divergent-replay refusal
// are inherited from the same window commit and are pinned by the runner and
// store suites, which this wave does not touch; nothing here re-tests them.)

import (
	"context"
	"database/sql"
	"os"
	"testing"

	"github.com/ethereum/go-ethereum/common"
	"github.com/stretchr/testify/require"

	"github.com/kaselunt/solvent/internal/decode"
	"github.com/kaselunt/solvent/internal/store"
)

const (
	cfLiveSchema  = "derive_collateral_flag_live"
	cfStream      = "eth:aave-etherfi"
	cfStartBlock  = 20_713_910
	cfThroughHead = 23_000_000
)

var (
	cfPool    = common.HexToAddress("0x0AA97c284e98396202b6A04024F5E2c65026F3c0")
	cfWeETH   = common.HexToAddress("0xCd5fE23C85820F7B72D0926FC9b05b43E359b7ee")
	cfUser1st = common.HexToAddress("0x464c71f6c2f760dda6093dcb91c24c39e5d6e18c")
	cfUser2nd = common.HexToAddress("0xe1f8afc92644bfe77080d7dcb0f936f578e00f53")
	cfUserOff = common.HexToAddress("0xc922a3951b269b9a1dff1186355bcf6dc74e3993")
	cfUserDus = common.HexToAddress("0x2c64a1d5d602e7fb6d21da6211dcecc6e17a0649")
)

// cfLiveStore is a freshly migrated, schema-isolated store, on its OWN schema so
// it cannot collide with the lifecycle suite's.
func cfLiveStore(t *testing.T) *store.Store {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("TEST_DATABASE_URL not set; run `make db-up` and export it")
	}
	ctx := context.Background()

	admin, err := sql.Open("pgx", dsn)
	require.NoError(t, err)
	_, err = admin.ExecContext(ctx, "DROP SCHEMA IF EXISTS "+cfLiveSchema+" CASCADE")
	require.NoError(t, err)
	_, err = admin.ExecContext(ctx, "CREATE SCHEMA "+cfLiveSchema)
	require.NoError(t, err)
	require.NoError(t, admin.Close())

	scoped := liveSchemaDSN(t, dsn, cfLiveSchema)
	require.NoError(t, store.Migrate(ctx, scoped))
	s, err := store.Open(ctx, scoped)
	require.NoError(t, err)
	t.Cleanup(s.Close)
	return s
}

func cfRunnerSpec() RunnerSpec {
	return RunnerSpec{
		Engine: AaveEngineName, Chain: "eth", ChainID: 1,
		Streams: []string{cfStream}, Addresses: [][]byte{cfPool.Bytes()},
		StartBlock: cfStartBlock,
		// A hand-built spec must declare its WALKED SURFACE, exactly as
		// BuildRunnerSpecs computes one: the coverage claim is not assertable without
		// it (store.DerivationCoverage.Asserts), which is the fail-closed default.
		CoverageBinding: store.CoverageBindingOf(1, []store.CoverageStream{
			{Address: cfPool.Bytes(), StartBlock: cfStartBlock},
		}),
		// One window wide enough to cover the whole fixture span, so the test
		// exercises the fold rather than the runner's windowing (which has its own
		// suite).
		Window: 3_000_000,
	}
}

// cfIngestFixture writes the committed real logs into raw_logs through the
// production writer, exactly as the walker would.
func cfIngestFixture(t *testing.T, s *store.Store, upTo uint64) {
	t.Helper()
	doc := aaveLoadDoc(t, "aave_collateral_flags.json")
	require.Len(t, doc.Logs, 4)

	var logs []store.RawLog
	var head []byte
	for _, fl := range doc.Logs {
		if fl.BlockNumber > upTo {
			continue
		}
		raw := fl.rawLog(doc.ChainID)
		logs = append(logs, raw)
		head = raw.BlockHash
	}
	require.NotEmpty(t, logs, "the fixture has no log at or below %d", upTo)
	require.NoError(t, s.SaveBatch(context.Background(), cfStream, 1, logs, upTo, head))
}

// cfDeriveToHead runs the REAL runner until it stops advancing.
func cfDeriveToHead(t *testing.T, s *store.Store) {
	t.Helper()
	ctx := context.Background()
	r, err := NewRunner(s, decode.NewRegistry(), NewAaveEngine(), cfRunnerSpec(), nil)
	require.NoError(t, err)
	for i := 0; i < 20; i++ {
		advanced, err := r.Step(ctx)
		require.NoError(t, err)
		if !advanced {
			return
		}
	}
	t.Fatal("the runner never stopped advancing")
}

func cfFold(t *testing.T, s *store.Store, block uint64) map[string]store.CollateralFlagRow {
	t.Helper()
	rows, err := store.CollateralFlagsAsOf(context.Background(), s.Querier(), AaveEngineName, 1, block)
	require.NoError(t, err)
	out := map[string]store.CollateralFlagRow{}
	for _, r := range rows {
		out[common.BytesToAddress(r.Reserve).Hex()+"/"+common.BytesToAddress(r.User).Hex()] = r
	}
	return out
}

func cfKey(user common.Address) string { return cfWeETH.Hex() + "/" + user.Hex() }

// cfCursor reads the Aave engine's derive cursor WITH its coverage provenance.
func cfCursor(t *testing.T, s *store.Store) store.DeriveCursorState {
	t.Helper()
	states, err := store.DeriveCursorStates(context.Background(), s.Querier())
	require.NoError(t, err)
	for _, c := range states {
		if c.Engine == AaveEngineName {
			return c
		}
	}
	return store.DeriveCursorState{}
}

// cfCoverageProven asks the SAME question riskfeed's gate asks, through the same
// shared predicate — so this test cannot drift from the gate it is standing in for.
func cfCoverageProven(t *testing.T, s *store.Store) bool {
	t.Helper()
	c := cfCursor(t, s)
	return c.CoverageClaim().Satisfies(store.CoverageRequirement{
		GenesisBlock:       cfStartBlock,
		MinDecoderRevision: decode.RevisionAaveCollateralFlags,
		Binding:            cfRunnerSpec().CoverageBinding,
	})
}

// TestAaveCollateralFlagsDeriveFromRealLogsEndToEnd is the machinery proof.
//
// MUTANT THIS KILLS: unregister either topic0 in internal/decode. The Registry's
// unknown-topic contract is a SILENT skip, so the runner would derive zero flag
// rows and report success — the fold would simply return nothing and every
// position would read as not-collateral. Only an end-to-end count catches that.
func TestAaveCollateralFlagsDeriveFromRealLogsEndToEnd(t *testing.T) {
	s := cfLiveStore(t)
	cfIngestFixture(t, s, cfThroughHead)
	cfDeriveToHead(t, s)

	// All four logs decoded and landed as position_events. Asserted as a COUNT so
	// a decoder that stops matching cannot shrink the evidence silently.
	var derived int
	require.NoError(t, s.Querier().QueryRow(context.Background(),
		`SELECT count(*) FROM position_events
		 WHERE engine = $1 AND event_type IN ($2, $3)`,
		AaveEngineName, store.AaveCollateralEnabledEvent, store.AaveCollateralDisabledEvent).Scan(&derived))
	require.Equal(t, 4, derived, "every committed flag log must have derived exactly one row")

	// The rows carry the deriver's key convention: account = USER, asset = RESERVE.
	// Getting that pair backwards would make the fold key on the wrong axis and
	// join against nothing.
	var account, asset []byte
	var side string
	require.NoError(t, s.Querier().QueryRow(context.Background(),
		`SELECT account, asset, side FROM position_events
		 WHERE engine = $1 AND event_type = $2 AND block_number = 20713917`,
		AaveEngineName, store.AaveCollateralEnabledEvent).Scan(&account, &asset, &side))
	require.Equal(t, cfUser1st.Bytes(), account, "account is the USER")
	require.Equal(t, cfWeETH.Bytes(), asset, "asset is the RESERVE")
	require.Equal(t, "", side, "a flag toggle is not a movement on either side of the book")

	// No balance was invented. These events are record-only: they change whether a
	// balance COUNTS, never its size, and a fold that moved one would be inventing
	// a movement the chain never made.
	var balances int
	require.NoError(t, s.Querier().QueryRow(context.Background(),
		`SELECT count(*) FROM position_balances WHERE engine = $1`, AaveEngineName).Scan(&balances))
	require.Zero(t, balances, "record-only means record-only")

	// THE FOLD. Four logs, four distinct users, so four pairs — one enable each for
	// the two genesis users, one disable each for the other two.
	fold := cfFold(t, s, cfThroughHead)
	require.Len(t, fold, 4)
	require.True(t, fold[cfKey(cfUser1st)].Enabled)
	require.True(t, fold[cfKey(cfUser2nd)].Enabled)
	require.False(t, fold[cfKey(cfUserOff)].Enabled)

	dust := fold[cfKey(cfUserDus)]
	require.False(t, dust.Enabled,
		"the one live opt-out on the book: weETH off since block 22,551,863")
	require.EqualValues(t, 22_551_863, dust.Block)
	require.EqualValues(t, 342, dust.LogIndex)

	// The AS-OF really is per witness, not one stamp for the batch.
	require.EqualValues(t, 20_713_917, fold[cfKey(cfUser1st)].Block)
	require.EqualValues(t, 20_713_977, fold[cfKey(cfUser2nd)].Block)
}

// TestAaveCollateralFlagsRewindAndRederiveIsTheBackfillPath rehearses the
// owner-gated live maintenance window on a scratch DB, in the exact order the
// operator will run it.
//
// The binding mechanism ruling is rewind-and-rederive, NOT an out-of-band insert:
// the wave-2b healing precedent filled a NULL column and never inserted rows, and
// inserting historical position_events beneath a live cursor would make derived
// state a fold of two passes. So the rehearsal is: derive with the topics
// unregistered (modelled by starting the cursor above the logs), then rewind to
// StartBlock-1 and re-derive from the cursor read back — zero RPC, one decoder,
// one path.
func TestAaveCollateralFlagsRewindAndRederiveIsTheBackfillPath(t *testing.T) {
	s := cfLiveStore(t)
	ctx := context.Background()
	cfIngestFixture(t, s, cfThroughHead)
	cfDeriveToHead(t, s)

	full := cfFold(t, s, cfThroughHead)
	require.Len(t, full, 4)

	// ---- The rewind leg: back to StartBlock-1, which is what the maintenance
	// window does. Every derived flag row above it goes with it.
	require.NoError(t, s.RewindDerived(ctx, AaveEngineName, 1, cfStartBlock-1))
	require.Empty(t, cfFold(t, s, cfThroughHead),
		"the flag ledger rewinds with every other derived row — no private table, no separate reorg story")

	cur, found, err := s.DeriveCursor(ctx, AaveEngineName)
	require.NoError(t, err)
	require.True(t, found)
	require.EqualValues(t, cfStartBlock-1, cur, "the cursor really moved back")

	// ---- The re-derive leg: a fresh runner re-steps from the cursor read back.
	cfDeriveToHead(t, s)
	rebuilt := cfFold(t, s, cfThroughHead)
	require.Equal(t, full, rebuilt,
		"re-derivation over the same custody reproduces the fold EXACTLY — that is what makes the live window safe")
}

// TestAaveCollateralFlagCoverageIsSetByTheWalkNotAnOperator is the round-1 [high]
// fix's other half, proven where the machinery lives.
//
// The custody marker must be EVIDENCE, not an attestation: there must be no way to
// set it except by actually walking the range it claims. So this test never writes
// a marker — it runs the real runner and watches the marker appear, then disappear
// on a deep rewind, then reappear on re-derivation. If the marker could be set any
// other way, riskfeed's gate would be a checkbox instead of a proof.
func TestAaveCollateralFlagCoverageIsSetByTheWalkNotAnOperator(t *testing.T) {
	s := cfLiveStore(t)
	ctx := context.Background()
	cfIngestFixture(t, s, cfThroughHead)

	// Before any walk there is no cursor at all, so nothing is proven.
	require.False(t, cfCoverageProven(t, s), "no walk, no claim")

	// ---- The walk sets it, as a side effect of completing. Note what is NOT
	// happening here: no test code stamps anything.
	cfDeriveToHead(t, s)
	require.True(t, cfCoverageProven(t, s),
		"a walk from the engine's StartBlock under the current registry IS the proof")

	c := cfCursor(t, s)
	require.NotNil(t, c.CoveredFromBlock)
	require.EqualValues(t, cfStartBlock, *c.CoveredFromBlock,
		"coverage records where the walk actually began — the spec's StartBlock, not a constant")
	require.EqualValues(t, decode.RegistryRevision, c.DecoderRevision,
		"and the registry revision the running binary actually has")

	// ---- The backfill's rewind clears it, ATOMICALLY with the rows it described.
	// This is the state an operator is in mid-window, and it must read as unproven:
	// the ledger is empty, and a surviving marker would license reading that
	// emptiness as chain truth — the exact bug, produced by the repair.
	require.NoError(t, s.RewindDerived(ctx, AaveEngineName, 1, cfStartBlock-1))
	require.False(t, cfCoverageProven(t, s),
		"mid-window the ledger is empty AND unproven — the two facts must never disagree")
	require.Empty(t, cfFold(t, s, cfThroughHead))

	// ---- And re-derivation restores it. Nothing in this test ever asserted
	// custody; the walk did.
	cfDeriveToHead(t, s)
	require.True(t, cfCoverageProven(t, s))
	require.Len(t, cfFold(t, s, cfThroughHead), 4,
		"proven coverage and a populated ledger arrive together, from one operation")
}

// TestAaveCollateralFlagCoverageIsNotEstablishedByAMidHistoryWalk: a walk that
// starts above the engine's genesis must NOT satisfy the gate, however far it
// reaches. This is the shape a naive "has the new binary run?" marker would have
// passed — and it is exactly the shape that misses the early enables.
func TestAaveCollateralFlagCoverageIsNotEstablishedByAMidHistoryWalk(t *testing.T) {
	s := cfLiveStore(t)
	ctx := context.Background()
	cfIngestFixture(t, s, cfThroughHead)

	// Pre-position the cursor ABOVE the first flag log, the way a live database
	// derived by an older binary sits: at head, with the flag history behind it.
	require.NoError(t, s.ApplyDerivedWindow(ctx, AaveEngineName, 1, nil, nil, 21_000_000,
		store.DerivationCoverage{}))
	require.False(t, cfCoverageProven(t, s))

	// Now the CURRENT binary walks forward from there. It decodes the flag events
	// it sees — but it never saw the genesis cluster.
	cfDeriveToHead(t, s)

	c := cfCursor(t, s)
	require.NotNil(t, c.CoveredFromBlock)
	require.Greater(t, *c.CoveredFromBlock, uint64(cfStartBlock),
		"the walk began above genesis and says so")
	require.False(t, cfCoverageProven(t, s),
		"a head cursor under the new registry is still NOT genesis coverage — the gate must refuse")

	// And the ledger really is incomplete, which is why: the genesis-cluster
	// enables are missing, so their users' absences are NOT chain truth.
	fold := cfFold(t, s, cfThroughHead)
	require.NotContains(t, fold, cfKey(cfUser1st),
		"the first-ever enable is below the walk and was never derived")
	require.Contains(t, fold, cfKey(cfUserDus),
		"while a later disable WAS — a partially-witnessed ledger, which is the dangerous state")
}

// TestAaveCollateralFlagsReplayIsIdempotent: re-running the runner over an
// already-derived range must change nothing. If it double-wrote, the fold's
// DISTINCT ON would still return one row per pair and the damage would be
// invisible there — so the row COUNT is what is asserted.
func TestAaveCollateralFlagsReplayIsIdempotent(t *testing.T) {
	s := cfLiveStore(t)
	ctx := context.Background()
	cfIngestFixture(t, s, cfThroughHead)
	cfDeriveToHead(t, s)

	countRows := func() int {
		var n int
		require.NoError(t, s.Querier().QueryRow(ctx,
			`SELECT count(*) FROM position_events
			 WHERE engine = $1 AND event_type IN ($2, $3)`,
			AaveEngineName, store.AaveCollateralEnabledEvent, store.AaveCollateralDisabledEvent).Scan(&n))
		return n
	}
	require.Equal(t, 4, countRows())

	before := cfFold(t, s, cfThroughHead)
	cfDeriveToHead(t, s) // the runner is at head; this must be a no-op
	require.Equal(t, 4, countRows(), "no duplicate rows")
	require.Equal(t, before, cfFold(t, s, cfThroughHead))
}

// TestAaveCollateralFlagsFoldTracksAnAdvancingCursor: the fold's as-of bound is
// the engine's own cursor, so a partially-derived history must report the flag
// state AT that point — not the final one, and not nothing.
func TestAaveCollateralFlagsFoldTracksAnAdvancingCursor(t *testing.T) {
	s := cfLiveStore(t)

	// Ingest and derive only through the FIRST disable, leaving the 22,551,863
	// opt-out beyond the frontier.
	cfIngestFixture(t, s, 20_721_368)
	cfDeriveToHead(t, s)

	partial := cfFold(t, s, 20_721_368)
	require.Len(t, partial, 3, "three pairs witnessed so far")
	require.True(t, partial[cfKey(cfUser1st)].Enabled)
	require.False(t, partial[cfKey(cfUserOff)].Enabled)
	_, seen := partial[cfKey(cfUserDus)]
	require.False(t, seen,
		"the dust account's disable is above the frontier: no row, which the assembler reads as never-enabled")

	// Reading ABOVE the derived frontier does not invent rows either — the bound is
	// a bound on the ledger, and the ledger simply does not have them yet.
	require.Len(t, cfFold(t, s, cfThroughHead), 3)
}
