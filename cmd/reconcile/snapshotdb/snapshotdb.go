// Package snapshotdb is Stage A of Phase 1 — the REPEATABLE READ READ ONLY
// snapshot (brief §0, round-10 F5) — moved into an IMPORT-RESTRICTED, DB-only
// package by round-13 F2.
//
// WHY A PACKAGE, NOT A WALK. Waves 11-13 tried to prove "no network call can
// run while the snapshot transaction is open" with progressively stronger
// inspections of cmd/reconcile itself: a reader-free signature (wave 11,
// retracted), a runtime gate plus an AST reachability walk over named calls
// (wave 13). Round 13 showed the walk is still a fake against indirection —
// a package-level function value, an aliased import (`web "net/http"`), or
// interface dispatch all evade name-matching, because an AST walk that
// resolves only direct named calls cannot see where a value came from. The
// structural fix makes the COMPILER the proof: snapshot collection lives
// here, and this package's import list contains no chain or network surface
// — no internal/chain, no ethclient, no go-ethereum/rpc, no net/http. Code
// that cannot name a dialer cannot dial, whatever indirection it routes
// through. The only capabilities reachable from this package are the ones
// its imports grant: pgx (the database — the POINT of Stage A), store (DB
// queries), config (plain data), go-ethereum/common (value types), and a
// handful of stdlib value/encoding packages.
//
// Round 14 tightened the boundary from a NAMESPACE claim to a CAPABILITY
// claim (finding 3): allowlisting `os` for one config-file read granted every
// os capability (os.StartProcess is a network client one exec away), so the
// config hash is now computed by the CALLER and passed in as a plain value —
// `os` is gone from the import list entirely, and the import list states the
// true capability set. Round 14 also ordered the cleanup (finding 2): the
// gate exits LAST, strictly after rollback and connection close, through ONE
// deferred function whose internal order is explicit — never through stacked
// LIFO defers that reopened the RPC surface while the transaction still held
// xmin.
//
// The proof obligations are split across four tests:
//
//   - TestSnapshotDBImportsAreDBOnly (this package): asserts the EXACT
//     import allowlist — an aliased import cannot hide because import PATHS,
//     not identifiers, are asserted; a smuggled function value cannot reach
//     a network without importing one.
//   - TestSnapshotDBAPISurfaceRejectsInjection (this package): asserts the
//     package exposes no injection surface — no package-level var except the
//     unexported gate, no function-typed or interface-typed parameter, field
//     or hook an outside caller could load a dialer into, and no in-package
//     type assertion or type switch that could excavate a callable from an
//     `any` field.
//   - TestSnapshotDBCapabilityBoundary (this package, go/types): resolves
//     UNDERLYING types, so a NAMED interface (round-14 F3's evasion shape)
//     is caught wherever it appears; and enforces call-site discipline over
//     the capabilities the remaining allowlist inherently grants — exactly
//     one pgx.Connect (to the caller's DSN), zero calls into internal/config
//     (types only).
//   - TestProductionGateActiveThroughSnapshotLifecycle (cmd/reconcile,
//     DB-backed): proves the RUNTIME gate below is entered and exited by
//     Collect's own wiring — from BeginTx through commit AND through the
//     rollback path, with the gate observed still closed AT the rollback,
//     close, and post-close checkpoints (round-14 F2), and the connection
//     provably closed after — not by a test toggling it.
//
// Collect performs EVERY DB read of the run in ONE connection and ONE RR RO
// transaction, then COMMITS AND CLOSES before returning plain data: a slow
// or retry-storming RPC endpoint can never hold the live database's xmin
// (vacuum-friendliness while the daemon writes).
package snapshotdb

import (
	"context"
	"encoding/hex"
	"fmt"
	"math/big"
	"sync/atomic"
	"time"

	"github.com/ethereum/go-ethereum/common"
	"github.com/jackc/pgx/v5"

	"github.com/kaselunt/solvent/internal/config"
	"github.com/kaselunt/solvent/internal/store"
)

// DMEngine / AaveEngine are the reconciled engine names. cmd/reconcile
// aliases its own constants to these so the two packages cannot drift.
const (
	DMEngine   = "debt_manager"
	AaveEngine = "aave_v3_etherfi"
)

// CleanupStage names one checkpoint of Collect's ORDERED cleanup (round-14
// F2). The lifecycle test holds each stage in turn and asserts the gate is
// STILL closed there — observing the ordering while it happens, not
// reconstructing it from post-return state.
type CleanupStage int

const (
	// StageBeforeRollback: cleanup entered, tx.Rollback not yet issued — the
	// server-side transaction (and its xmin) still exists.
	StageBeforeRollback CleanupStage = iota
	// StageBeforeClose: rollback returned, conn.Close not yet issued — the
	// connection is still open.
	StageBeforeClose
	// StageAfterClose: conn.Close returned, Gate exit not yet performed —
	// the gate must STILL be closed here; it exits last.
	StageAfterClose

	numCleanupStages
)

// cleanupTimeout bounds the graceful error-path cleanup. The cleanup runs on
// a context derived WithoutCancel from the caller's (a canceled run must
// still roll back and close gracefully rather than abandoning the backend),
// so it needs its own bound against a dead server. 30s is deliberately wide:
// while cleanup runs the gate is still CLOSED, so a slow cleanup errs in the
// fail-closed direction (RPC stays refused), never the open one.
const cleanupTimeout = 30 * time.Second

// Sentinel is the F5 RUNTIME seam (round-11 F3, re-homed by round-13 F2).
// Collect opens the gate for the lifetime of the repeatable-read transaction,
// and EVERY pinnedReader entry point in cmd/reconcile (headerHash,
// headerTime, callAtHash, secondOpinion — multicall funnels through
// callAtHash) refuses with a named seam violation while it is open.
// Package-level state BY DESIGN: the invariant is process-wide — one
// reconcile run per process, and no RPC may run ANYWHERE in it while the
// snapshot transaction is open, whatever call path smuggled the attempt in.
// The static half of the seam is this package's import allowlist (the
// compiler as the proof); this gate is the half that fails CLOSED even on a
// path outside this package that no static check anticipated.
//
// The holds/arrived pairs are the round-14 F2 lifecycle BARRIERS: the
// DB-backed test engages a hold, waits for cleanup to arrive at that stage,
// observes the gate (and the server's view of the transaction/connection)
// while cleanup is provably parked THERE, then releases. They are bools, not
// hooks: a barrier can only DELAY the fixed rollback→close→exit order — it
// cannot skip a step, reorder them, or carry a callable — and its worst
// effect is keeping the gate closed longer (the fail-closed direction). Cost
// when disengaged: one atomic load per stage per run.
type Sentinel struct {
	open    atomic.Bool
	holds   [numCleanupStages]atomic.Bool
	arrived [numCleanupStages]atomic.Bool
}

// Enter closes the process's RPC surface. Production code calls it in
// exactly one place: Collect, immediately after BeginTx succeeds.
func (s *Sentinel) Enter() { s.open.Store(true) }

// Exit reopens the RPC surface. Production code calls it in exactly one
// place: the tail of Collect's single ordered cleanup, strictly after
// rollback/commit and connection close (round-14 F2).
func (s *Sentinel) Exit() { s.open.Store(false) }

// Violation returns a named error when op is attempted while the snapshot
// transaction is open, nil otherwise.
func (s *Sentinel) Violation(op string) error {
	if s.open.Load() {
		return fmt.Errorf("F5 seam violation: %s attempted while the repeatable-read snapshot transaction is open — no network call may hold the snapshot's xmin (round-10 F5, round-11 F3)", op)
	}
	return nil
}

// HoldAt engages (or releases) the lifecycle barrier at stage st.
func (s *Sentinel) HoldAt(st CleanupStage, hold bool) { s.holds[st].Store(hold) }

// Arrived reports whether the ordered cleanup has reached stage st since the
// last ResetArrivals.
func (s *Sentinel) Arrived(st CleanupStage) bool { return s.arrived[st].Load() }

// ResetArrivals clears the arrival markers between lifecycle-test legs.
func (s *Sentinel) ResetArrivals() {
	for i := range s.arrived {
		s.arrived[i].Store(false)
	}
}

// checkpoint marks arrival at st and parks while its barrier is held. The
// order of checkpoints is fixed by the ONE cleanup function below; a barrier
// can only stretch the timeline, never bend it.
func (s *Sentinel) checkpoint(st CleanupStage) {
	s.arrived[st].Store(true)
	for s.holds[st].Load() {
		time.Sleep(time.Millisecond)
	}
}

// gate is the process-wide sentinel — the ONE package-level var this package
// may carry, and it is UNEXPORTED since round-14 F3: `var Gate` was
// assignable from any importer (`snapshotdb.Gate = &Sentinel{}` would hand
// the pinnedReader checks a decoy while Collect held the real one), which
// made the sentinel itself an injection surface. Outside packages reach it
// only through the Gate accessor; a function's identity cannot be
// reassigned.
var gate = &Sentinel{}

// Gate returns the process-wide sentinel. Accessor, not a var, so the
// binding between Collect's gate and the pinnedReader checks in
// cmd/reconcile is not assignable from outside the package (round-14 F3).
func Gate() *Sentinel { return gate }

// Params are the flag-derived facts Collect consumes — plain values only,
// carried in a struct so the API surface stays function- and interface-free.
type Params struct {
	// ConfigSHA is the sha256 of the config file, computed by the CALLER
	// (cmd/reconcile) and passed in as a plain value — round-14 F3 hoisted
	// the file read out of this package so `os` (and with it StartProcess,
	// Pipe, every non-read capability the package never needed) is not
	// linkable from the code that holds the open snapshot transaction. A
	// caller-side read failure leaves it empty rather than failing the run,
	// exactly as the in-package read did.
	ConfigSHA string
	// PinOP / PinETH are operator pin overrides (0 = derive cursor).
	// Overrides above the cursor are refused (W1's disproof clause).
	PinOP  uint64
	PinETH uint64
	// CollateralReplay > 0 prefetches the deep-replay history documents
	// (the replay targets are picked from the SAMPLE after commit).
	CollateralReplay int
}

// GoldenSpec is the golden-vector slice of Collect's read set: the dual pins
// and borrower addresses (brief §4). Plain values — the vector constants and
// their validation stay in cmd/reconcile.
type GoldenSpec struct {
	W1Pin      uint64
	FixturePin uint64
	Borrowers  []common.Address
}

// GoldenDBSide is Phase 1's snapshot-scoped read of everything golden needs
// from the database (no DB read may happen after the snapshot closes).
type GoldenDBSide struct {
	// AsOfW1 / AsOfFixture: accountHex → reserveHex → side → sum.
	AsOfW1        map[string]map[string]map[string]*big.Int
	AsOfFixture   map[string]map[string]map[string]*big.Int
	IntervalCount int64
}

// GoldenAsOfMap folds AsOfSums into the lookup shape (also used by the
// Phase-2 supplement comparisons in cmd/reconcile).
func GoldenAsOfMap(sums []store.AsOfSum) map[string]map[string]map[string]*big.Int {
	out := map[string]map[string]map[string]*big.Int{}
	for _, s := range sums {
		acct := fmt.Sprintf("%x", s.Account)
		res := fmt.Sprintf("%x", s.Asset)
		if out[acct] == nil {
			out[acct] = map[string]map[string]*big.Int{}
		}
		if out[acct][res] == nil {
			out[acct][res] = map[string]*big.Int{}
		}
		out[acct][res][s.Side] = s.Total
	}
	return out
}

// collectGoldenDBSide runs inside the Phase-1 snapshot.
func collectGoldenDBSide(ctx context.Context, q store.Querier, spec GoldenSpec) (GoldenDBSide, error) {
	accounts := make([][]byte, 0, len(spec.Borrowers))
	for _, b := range spec.Borrowers {
		accounts = append(accounts, b.Bytes())
	}
	w1, err := store.AsOfEventSums(ctx, q, AaveEngine, accounts, spec.W1Pin)
	if err != nil {
		return GoldenDBSide{}, fmt.Errorf("golden as-of at w1 pin: %w", err)
	}
	fx, err := store.AsOfEventSums(ctx, q, AaveEngine, accounts, spec.FixturePin)
	if err != nil {
		return GoldenDBSide{}, fmt.Errorf("golden as-of at fixture pin: %w", err)
	}
	n, err := store.AaveIntervalEventCount(ctx, q, AaveEngine, accounts, spec.W1Pin, spec.FixturePin)
	if err != nil {
		return GoldenDBSide{}, fmt.Errorf("golden interval count: %w", err)
	}
	return GoldenDBSide{AsOfW1: GoldenAsOfMap(w1), AsOfFixture: GoldenAsOfMap(fx), IntervalCount: n}, nil
}

// WeldData is one chain's fork-weld DB side, read in the snapshot and
// compared against live headers after commit AND again in Phase 3.
type WeldData struct {
	ChainID      int64
	Pin          uint64
	HighestBlock uint64
	HighestHash  []byte
	HighestFound bool
	// CursorHashesAtP: ingest cursors (of this chain's reconciled engine)
	// whose last_block == P — the L0-10 anchor when raw_logs sit far below
	// P for a quiet address set.
	CursorHashesAtP map[string][]byte
}

// IdxObs is one persisted borrow-index observation (§3.6 DB side).
type IdxObs struct {
	Value *big.Int
	Block uint64
}

// RewindBaseline is the Phase-1 snapshot of the §8 rewind detector's inputs.
type RewindBaseline struct {
	AckedEpoch map[string]int64
	LastBlock  map[string]uint64
	// MaxEpoch is consumed by the snapshot-time reorg-epoch gate (exit
	// finding H1); for the §8 movement detector it stays INFORMATIONAL
	// (prune-defeated — the detector's baseline is AckedEpoch).
	MaxEpoch map[int64]int64
}

func baselineFromCursors(cursors []store.DeriveCursorState, maxEpochs map[int64]int64) RewindBaseline {
	b := RewindBaseline{AckedEpoch: map[string]int64{}, LastBlock: map[string]uint64{}, MaxEpoch: maxEpochs}
	for _, c := range cursors {
		b.AckedEpoch[c.Engine] = c.AckedEpoch
		b.LastBlock[c.Engine] = c.LastBlock
	}
	return b
}

// ConnectedIdentity is the SERVER-REPORTED identity of the snapshot
// connection (round-14 F1): what the database says about itself, read over
// the SAME connection — inside the SAME repeatable-read transaction — that
// every DB fact of the run came from. It exists because a DSN is a CLAIM
// about where a connection will land, and pgx merges ambient PG* variables
// under partial DSNs (pgconn/config.go parseEnvSettings), so the artifact
// must record where the connection ACTUALLY landed, never what the URL
// spelled. The tuple is the wave-11 identity set (current_database,
// inet_server_addr, inet_server_port, server version) plus the wave-10/11
// PHYSICAL identity (pg_control system_identifier + database OID), which no
// transport respelling or proxy alias can fake.
type ConnectedIdentity struct {
	Database         string `json:"database"`
	ServerAddr       string `json:"server_addr"` // inet_server_addr(); "(unix socket)" when null
	ServerPort       int32  `json:"server_port"`
	ServerVersion    string `json:"server_version"`
	SystemIdentifier string `json:"system_identifier"` // pg_control_system()
	DatabaseOID      int64  `json:"database_oid"`
}

// readConnectedIdentity resolves the identity over q. Any failure is an
// error — a snapshot whose subject cannot be named by the SERVER cannot back
// a receipt (fail closed, same law as store.DatabaseIdentity).
func readConnectedIdentity(ctx context.Context, q store.Querier) (ConnectedIdentity, error) {
	var id ConnectedIdentity
	var addr *string
	var port *int32
	if err := q.QueryRow(ctx,
		`SELECT current_database(),
		        inet_server_addr()::text,
		        inet_server_port(),
		        current_setting('server_version'),
		        (SELECT system_identifier::text FROM pg_control_system()),
		        (SELECT oid::bigint FROM pg_database WHERE datname = current_database())`).
		Scan(&id.Database, &addr, &port, &id.ServerVersion, &id.SystemIdentifier, &id.DatabaseOID); err != nil {
		return ConnectedIdentity{}, fmt.Errorf("read connected server identity (failing CLOSED — a claim whose subject the server cannot confirm is not evidence): %w", err)
	}
	if addr != nil {
		id.ServerAddr = *addr
	} else {
		id.ServerAddr = "(unix socket)"
	}
	if port != nil {
		id.ServerPort = *port
	}
	if id.Database == "" || id.SystemIdentifier == "" || id.DatabaseOID == 0 {
		return ConnectedIdentity{}, fmt.Errorf("connected server identity incomplete (%+v) — failing CLOSED", id)
	}
	return id, nil
}

// invariantDetailCap bounds how many violation rows land verbatim in the
// artifact (the count is always exact; the detail is a diagnosis aid).
const invariantDetailCap = 100

// ScanResult is one invariant scan's artifact row.
type ScanResult struct {
	Rows   int  `json:"rows"`
	Gated  bool `json:"gated"`
	Detail any  `json:"detail,omitempty"`
}

// InvariantsSection embeds every scan's result (counts + rows).
type InvariantsSection struct {
	Scan1DistinctHash   ScanResult `json:"scan1_distinct_hash_per_height"`
	Scan2EventSums      ScanResult `json:"scan2_event_sums_vs_balances"`
	Scan3BorrowIndex    ScanResult `json:"scan3_borrow_index_monotonic"`
	Scan4EventLogOrphan ScanResult `json:"scan4_event_log_referential"`
	Scan5IIUCoverage    ScanResult `json:"scan5_same_block_iiu_coverage"`
	AdvisoryAaveIndex   ScanResult `json:"advisory_aave_index_monotonic"`
	// Sub-assertions (named): NULL-asset and side-less delta-bearing rows.
	NullAssetDeltaRows int64  `json:"null_asset_delta_rows"`
	SidelessDeltaRows  int64  `json:"sideless_delta_rows"`
	Note               string `json:"note"`
}

// Data is everything Stage A reads from the database — PLAIN VALUES ONLY.
// No connection, no transaction, no chain reader may live here: the type is
// the F5 seam's DATA half, enforced by reflection walk in
// TestSnapshotDataCarriesNoConnections (cmd/reconcile); the BEHAVIOR halves
// are this package's import allowlist and the Gate sentinel.
// Population-scoped fields (AllAsOfDM, InternalDMAll, Balances, Residue,
// StableSnap, HistoryDocs, SourceConflictsByAcct) cover the WHOLE candidate
// account set — population ∪ forced anchors ∪ includes ∪ accounts-file —
// because the sample is only known after the seed exists, and the seed
// needs RPC, which needs the snapshot closed.
type Data struct {
	Pins      map[string]uint64 // engine → P
	ChainFor  map[string]string // engine → chain name
	ConfigSHA string
	// Identity is what the SERVER said it was, over the snapshot's own
	// connection (round-14 F1) — the artifact's db identity is this, never
	// the DSN's parsed intent.
	Identity ConnectedIdentity

	Baseline      RewindBaseline
	DeriveCursors []store.DeriveCursorState
	IngestCursors []store.IngestCursorState

	Counts       *store.ReconRowCounts
	Population   []store.DMBorrowerRow
	StrataCounts map[string]int

	AllAsOfDM    []store.AsOfSum // candidate accounts @ P_op (filtered to the sample post-commit)
	DMAllNet     []store.AssetNetSum
	AaveDebtNet  []store.AssetNetSum
	AaveCollNet  []store.AssetNetSum
	AaveAsOfHead []store.AsOfSum // golden + top accounts @ P_eth

	InternalDMAll []store.InternalMismatch // candidate accounts (filtered to the sample post-commit)
	InternalAave  []store.InternalMismatch

	Golden  GoldenDBSide
	TopAave []store.TopDebtAccount

	FreshRows []store.AccountFreshness
	SweepGen  store.SweepGenerationState

	Balances              map[string][]store.BalanceRow // candidate accounts; consulted per SAMPLED account only
	SourceConflictsByAcct map[string]string
	HistoryDocs           map[string]store.CollateralHistoryAt

	DMIdxBase map[string]IdxObs
	DMAPY     map[string]*store.APYObservation

	Residue    map[string]map[string]bool // candidate accounts; consulted per SAMPLED account only
	StableSnap map[string]int64           // candidate accounts; consulted per SAMPLED account only

	WeldDB     map[string]WeldData
	Invariants *InvariantsSection
}

// Collect is Stage A (round-10 F5): connect, open the RR RO transaction,
// perform EVERY DB read of the run, COMMIT AND CLOSE — and return plain
// data. Since round-13 F2 the no-chain-surface discipline is structural:
// this package cannot name a dialer (import allowlist), cannot be handed one
// (injection-free API surface), and the Gate refuses any RPC entry point in
// cmd/reconcile at run time for the transaction's lifetime.
// extraAccounts are the pre-snapshot flag/file accounts (forced anchors,
// -include, -accounts) that must join the candidate read set because the
// sample itself is chosen only after commit.
func Collect(ctx context.Context, prm Params, cfg *config.Config, roDSN string, spec GoldenSpec, wantDM, wantAave bool, extraAccounts [][]byte) (*Data, error) {
	p := &Data{
		Pins:         map[string]uint64{},
		ChainFor:     map[string]string{},
		Balances:     map[string][]store.BalanceRow{},
		DMIdxBase:    map[string]IdxObs{},
		DMAPY:        map[string]*store.APYObservation{},
		WeldDB:       map[string]WeldData{},
		StrataCounts: map[string]int{},
	}
	for _, s := range cfg.Streams {
		if s.Engine == DMEngine || s.Engine == AaveEngine {
			p.ChainFor[s.Engine] = s.Chain
		}
	}
	p.ConfigSHA = prm.ConfigSHA

	conn, err := pgx.Connect(ctx, roDSN)
	if err != nil {
		return nil, fmt.Errorf("connect (snapshot): %w", err)
	}
	tx, err := conn.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
	if err != nil {
		// The gate was never entered; nothing ordered to unwind yet.
		conn.Close(ctx)
		return nil, fmt.Errorf("begin RR RO snapshot: %w", err)
	}
	// The RR transaction is OPEN: close the process's RPC surface until this
	// function returns (round-11 F3). Every pinnedReader entry point consults
	// the gate, so ANY network attempt while the snapshot is live — whatever
	// path smuggled it in — fails with a named seam violation instead of
	// holding the snapshot's xmin across a retry storm.
	//
	// ONE ordered cleanup (round-14 F2), never stacked defers: LIFO ordering
	// of `defer conn.Close` / `defer tx.Rollback` / `defer Gate.Exit` ran the
	// gate exit FIRST on every post-BeginTx error, reopening the RPC surface
	// while the transaction still held xmin. The order here is explicit and
	// inside a single function: rollback, then close, THEN gate exit — the
	// gate never outlives the transaction OR the connection, on either path.
	// Cleanup runs on a WithoutCancel context (bounded by cleanupTimeout): a
	// canceled run must still release the server gracefully, and while it
	// does, the gate stays closed (fail-closed in the only direction that
	// matters). The checkpoints are the round-14 F2 observation seam — see
	// Sentinel.
	gate.Enter()
	released := false
	defer func() {
		if released {
			// Success path: commit and close already ran, in order, below.
			gate.Exit()
			return
		}
		cctx, cancel := context.WithTimeout(context.WithoutCancel(ctx), cleanupTimeout)
		defer cancel()
		gate.checkpoint(StageBeforeRollback)
		_ = tx.Rollback(cctx)
		gate.checkpoint(StageBeforeClose)
		_ = conn.Close(cctx)
		gate.checkpoint(StageAfterClose)
		gate.Exit()
	}()

	// --- connected identity (round-14 F1): what the server SAYS it is, over
	// this very transaction — recorded fact, never the DSN's parsed intent.
	// (System functions only: Collect's first RELATION read stays the
	// derive_cursors read below, which the lifecycle test parks on.)
	p.Identity, err = readConnectedIdentity(ctx, tx)
	if err != nil {
		return nil, err
	}

	// --- pins (§3.1): P = derive cursor read INSIDE the snapshot ----------
	p.DeriveCursors, err = store.DeriveCursorStates(ctx, tx)
	if err != nil {
		return nil, err
	}
	cursorByEngine := map[string]store.DeriveCursorState{}
	for _, c := range p.DeriveCursors {
		cursorByEngine[c.Engine] = c
	}
	resolvePin := func(engine string, override uint64) (uint64, error) {
		c, ok := cursorByEngine[engine]
		if !ok {
			// Precondition class: cmd/reconcile surfaces this as exit 2 (no
			// artifact exists yet either way).
			return 0, fmt.Errorf("no derive cursor for %s", engine)
		}
		if override == 0 {
			return c.LastBlock, nil
		}
		if override > c.LastBlock {
			return 0, fmt.Errorf(
				"-pin override %d for %s is ABOVE the derive cursor %d — balances = Σ deltas holds only at or below the cursor, and W1's disproof clause is exactly what a beyond-cursor pin would satisfy vacuously (exit 2)",
				override, engine, c.LastBlock)
		}
		return override, nil
	}
	if wantDM {
		pin, err := resolvePin(DMEngine, prm.PinOP)
		if err != nil {
			return nil, err
		}
		p.Pins[DMEngine] = pin
	}
	if wantAave {
		pin, err := resolvePin(AaveEngine, prm.PinETH)
		if err != nil {
			return nil, err
		}
		p.Pins[AaveEngine] = pin
	}

	// --- population, as-of sums, aggregates, internal checks ---------------
	// Everything account-scoped reads the CANDIDATE set (population ∪
	// extraAccounts): the sample is chosen post-commit, so the snapshot must
	// cover every account the selection could name.
	if wantDM {
		pinOP := p.Pins[DMEngine]
		p.Population, err = store.SampleDMBorrowers(ctx, tx, pinOP)
		if err != nil {
			return nil, err
		}
		for _, r := range p.Population {
			p.StrataCounts[r.Stratum]++
		}
		accounts := make([][]byte, 0, len(p.Population)+len(extraAccounts))
		seen := map[string]bool{}
		for _, r := range p.Population {
			b, err := hex.DecodeString(r.AccountHex)
			if err != nil {
				return nil, fmt.Errorf("population account %q: %w", r.AccountHex, err)
			}
			accounts = append(accounts, b)
			seen[r.AccountHex] = true
		}
		for _, b := range extraAccounts {
			if h := hex.EncodeToString(b); !seen[h] {
				seen[h] = true
				accounts = append(accounts, b)
			}
		}
		p.AllAsOfDM, err = store.AsOfEventSums(ctx, tx, DMEngine, accounts, pinOP)
		if err != nil {
			return nil, err
		}
		p.DMAllNet, err = store.AssetNetSums(ctx, tx, DMEngine, "debt", pinOP)
		if err != nil {
			return nil, err
		}
		p.InternalDMAll, err = store.EventBalanceInternalCheck(ctx, tx, DMEngine, accounts, pinOP)
		if err != nil {
			return nil, err
		}
		p.Residue, err = store.ResidueZeroedAssets(ctx, tx, accounts, pinOP)
		if err != nil {
			return nil, err
		}
		p.StableSnap, err = store.StableSnapBorrowPresence(ctx, tx, accounts, pinOP)
		if err != nil {
			return nil, err
		}
		// Index-check DB side (§3.6): latest persisted borrow_index and the
		// payload-sourced APY per DB-known borrow token.
		for _, s := range p.DMAllNet {
			assetHex := hex.EncodeToString(s.Asset)
			idx, block, found, err := store.LatestRateIndexAt(ctx, tx, DMEngine, s.Asset, pinOP, "borrow_index")
			if err != nil {
				return nil, err
			}
			if found {
				p.DMIdxBase[assetHex] = IdxObs{Value: idx, Block: block}
			}
			apy, err := store.LatestAPYObservation(ctx, tx, s.Asset, pinOP)
			if err != nil {
				return nil, err
			}
			if apy != nil {
				p.DMAPY[assetHex] = apy
			}
		}
		// Freshness registry + per-account balances (source-exclusivity
		// probe runs on the SNAPSHOT state, brief §7) — one batched query
		// over the candidate set; conflicts keyed per account so Stage B
		// gates exactly the sampled ones.
		p.FreshRows, err = store.SnapshotFreshnessRows(ctx, tx, DMEngine)
		if err != nil {
			return nil, err
		}
		p.SweepGen, err = store.SweepGenerationRow(ctx, tx, DMEngine)
		if err != nil {
			return nil, err
		}
		p.Balances, p.SourceConflictsByAcct, err = store.ReconBalancesForAccounts(ctx, tx, DMEngine, accounts)
		if err != nil {
			return nil, err
		}
		// Deep-replay candidate documents: every success-swept account's
		// history doc at exactly last_success_block, prefetched because the
		// replay targets are picked from the SAMPLE after commit.
		if prm.CollateralReplay > 0 {
			p.HistoryDocs, err = store.CollateralHistoryDocsAtLastSuccess(ctx, tx, DMEngine)
			if err != nil {
				return nil, err
			}
		}
	}
	if wantAave {
		pinETH := p.Pins[AaveEngine]
		p.AaveDebtNet, err = store.AssetNetSums(ctx, tx, AaveEngine, "debt", pinETH)
		if err != nil {
			return nil, err
		}
		p.AaveCollNet, err = store.AssetNetSums(ctx, tx, AaveEngine, "collateral", pinETH)
		if err != nil {
			return nil, err
		}
		p.Golden, err = collectGoldenDBSide(ctx, tx, spec)
		if err != nil {
			return nil, err
		}
		p.TopAave, err = store.TopAaveDebtAccounts(ctx, tx, pinETH, 10)
		if err != nil {
			return nil, err
		}
		aaveAccounts := [][]byte{}
		seen := map[string]bool{}
		for _, b := range spec.Borrowers {
			addr := b.Bytes()
			aaveAccounts = append(aaveAccounts, addr)
			seen[hex.EncodeToString(addr)] = true
		}
		for _, t := range p.TopAave {
			if !seen[hex.EncodeToString(t.Account)] {
				seen[hex.EncodeToString(t.Account)] = true
				aaveAccounts = append(aaveAccounts, t.Account)
			}
		}
		p.AaveAsOfHead, err = store.AsOfEventSums(ctx, tx, AaveEngine, aaveAccounts, pinETH)
		if err != nil {
			return nil, err
		}
		p.InternalAave, err = store.EventBalanceInternalCheck(ctx, tx, AaveEngine, aaveAccounts, pinETH)
		if err != nil {
			return nil, err
		}
	}

	// --- counts + invariant scans (§6, all inside the snapshot) -----------
	p.Counts, err = store.CountReconRows(ctx, tx)
	if err != nil {
		return nil, err
	}
	p.Invariants, err = runInvariantScans(ctx, tx, p.Counts)
	if err != nil {
		return nil, err
	}

	// --- weld DB side + rewind baseline ------------------------------------
	p.IngestCursors, err = store.IngestCursorStates(ctx, tx)
	if err != nil {
		return nil, err
	}
	maxEpochs, err := store.MaxReorgEpochs(ctx, tx)
	if err != nil {
		return nil, err
	}
	p.Baseline = baselineFromCursors(p.DeriveCursors, maxEpochs)
	// Reorg-epoch gate (exit finding H1), INSIDE the snapshot: a raw rewind
	// deletes logs and records a chain-wide epoch atomically, and the derive
	// WRITER refuses to advance until the engine acks — but the derive cursor
	// itself is untouched in the window between the walker's rewind commit
	// and the runner's ack (a durable window when a crash lands between).
	// Pinning from that cursor would certify derived state the raw layer
	// already invalidated. Epochs are chain-scoped and acks engine-scoped
	// (migration 00002), so the gate is per PINNED engine: acked_epoch >=
	// MAX(reorg_epochs.epoch) on the engine's chain, both read in THIS
	// repeatable-read transaction. The refusal wraps
	// store.ErrUnackedReorgEpoch and the caller classifies it RETRYABLE
	// (exit 3, stale-evidence class) — never a silent pass, never a permanent
	// fail: the daemon's next Step acks and re-derives. The §8 end-of-run
	// movement check stays alongside: it covers the ack-and-prune cycle a
	// MAX-based read cannot see.
	for _, engine := range []string{DMEngine, AaveEngine} {
		if _, pinned := p.Pins[engine]; !pinned {
			continue
		}
		c := cursorByEngine[engine] // present: resolvePin succeeded above
		if maxE := maxEpochs[c.ChainID]; c.AckedEpoch < maxE {
			return nil, fmt.Errorf("engine %q: chain %d carries %w %d (engine acked %d) — the raw layer invalidated derived state this snapshot would certify; wait for the daemon's ack (RewindDerived) and retry",
				engine, c.ChainID, store.ErrUnackedReorgEpoch, maxE, c.AckedEpoch)
		}
	}
	engineOfChain := map[string]string{}
	for e, c := range p.ChainFor {
		engineOfChain[c] = e
	}
	for engine, pin := range p.Pins {
		chainName := p.ChainFor[engine]
		chainID := int64(cfg.Chains[chainName].ChainID)
		block, hash, found, err := store.ReconHighestLogAtOrBelow(ctx, tx, chainID, pin)
		if err != nil {
			return nil, err
		}
		w := WeldData{ChainID: chainID, Pin: pin, HighestBlock: block, HighestHash: hash, HighestFound: found, CursorHashesAtP: map[string][]byte{}}
		for _, ic := range p.IngestCursors {
			if ic.ChainID == chainID && ic.LastBlock == pin && streamBelongsToEngine(cfg, ic.Stream, engine) {
				w.CursorHashesAtP[ic.Stream] = ic.LastBlockHash
			}
		}
		p.WeldDB[chainName] = w
	}

	// COMMIT AND CLOSE (round-10 F5): the connection is gone before this
	// function returns, so nothing downstream — where the chain readers
	// live — can possibly hold the snapshot across RPC. The deferred ordered
	// cleanup sees released=true and performs ONLY the gate exit — strictly
	// after the close below, preserving the round-14 F2 order on the success
	// path too.
	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("commit snapshot (read-only): %w", err)
	}
	if err := conn.Close(ctx); err != nil {
		return nil, fmt.Errorf("close snapshot connection: %w", err)
	}
	released = true
	return p, nil
}

func streamBelongsToEngine(cfg *config.Config, streamName, engine string) bool {
	for _, s := range cfg.Streams {
		if s.Name == streamName {
			return s.Engine == engine
		}
	}
	return false
}

// runInvariantScans executes every scan through the SAME store functions the
// evidence tests call, embedding counts + capped detail.
func runInvariantScans(ctx context.Context, q store.Querier, counts *store.ReconRowCounts) (*InvariantsSection, error) {
	sec := &InvariantsSection{
		NullAssetDeltaRows: counts.NullAssetDeltaBearingRows,
		SidelessDeltaRows:  counts.SidelessDeltaBearingRows,
		Note:               "scan 2's ev predicate is deliberately WIDER than the fold predicate (delta IS NOT NULL only); the side-less and NULL-asset sub-assertions name any divergence taxonomy-violation (risk-quant F3). aave_liquidation_call rows may carry delta = 0 (non-nil) — harmless for sums; 'has a delta row' ≠ 'moved a balance'. The full-history IIU recurrence sweep is ADVISORY-DEFERRED: rate_indexes carries no header times, so the sweep needs per-block header reads (hundreds of RPC calls) — deferred with reason, report §deferred.",
	}
	s1, err := store.InvariantDistinctHashViolations(ctx, q)
	if err != nil {
		return nil, err
	}
	sec.Scan1DistinctHash = ScanResult{Rows: len(s1), Gated: true, Detail: capDetail(s1)}
	s2, err := store.InvariantEventSumMismatches(ctx, q)
	if err != nil {
		return nil, err
	}
	sec.Scan2EventSums = ScanResult{Rows: len(s2), Gated: true, Detail: capDetail(s2)}
	s3, err := store.InvariantBorrowIndexRegressions(ctx, q)
	if err != nil {
		return nil, err
	}
	sec.Scan3BorrowIndex = ScanResult{Rows: len(s3), Gated: true, Detail: capDetail(s3)}
	s4, err := store.InvariantEventLogOrphans(ctx, q)
	if err != nil {
		return nil, err
	}
	sec.Scan4EventLogOrphan = ScanResult{Rows: len(s4), Gated: true, Detail: capDetail(s4)}
	s5, err := store.InvariantIIUCoverageGaps(ctx, q)
	if err != nil {
		return nil, err
	}
	sec.Scan5IIUCoverage = ScanResult{Rows: len(s5), Gated: true, Detail: capDetail(s5)}
	adv, err := store.InvariantAaveIndexRegressions(ctx, q)
	if err != nil {
		return nil, err
	}
	sec.AdvisoryAaveIndex = ScanResult{Rows: len(adv), Gated: false, Detail: capDetail(adv)}
	// The sub-assertions are GATED zero-counts too.
	return sec, nil
}

func capDetail[T any](rows []T) any {
	if len(rows) == 0 {
		return nil
	}
	if len(rows) > invariantDetailCap {
		return rows[:invariantDetailCap]
	}
	return rows
}
