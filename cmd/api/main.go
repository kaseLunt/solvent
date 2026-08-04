// Command api is Solvent's public read surface: REST + SSE over the risk
// batches `cmd/riskd` materializes.
//
// The package is split by topic:
//
//	main.go       — configuration, the composition root, routing, the schema gate
//	read.go       — the batch read layer + the reconstruction of internal/risk inputs
//	meta.go       — the watermark vector, three-leg supersession, /v1/meta
//	handlers.go   — /v1/book, /v1/address/{addr}, /v1/address/{addr}/stress, /v1/observatory
//	scenarios.go  — /v1/scenarios: the committed scenario listing (config, not batch data)
//	sse.go        — /v1/stream: snapshot-on-connect, batch ticks, degradation, heartbeat
//	middleware.go — rate limit, CORS, read-only enforcement, string sanitization
//
// # api makes ZERO RPC calls
//
// Every number it serves is a durable store fact (design spec §2, §10). There is
// no chain client in this binary and no import path that reaches one:
// `TestAPIMakesNoChainCalls` enforces the link graph, exactly as `cmd/riskd`'s
// twin does. The consequence that matters on the wire is that lag and staleness
// are ALWAYS computed DB-clock vs durable stamps — never against a per-request
// RPC head, and never against this process's wall clock.
//
// # It is READ-ONLY, and structurally so
//
// Every route is a GET. There is no INSERT, UPDATE or DELETE anywhere in this
// package, every read runs inside a `REPEATABLE READ, READ ONLY` transaction,
// and the mutating-method middleware refuses anything but GET/OPTIONS/HEAD
// before a handler is reached. `TestAPIIssuesNoWritingSQL` pins the first of
// those by scanning this package's own SQL.
//
// # It NEVER migrates
//
// Schema ownership belongs to the indexer's startup path and to `make db-up`.
// This binary GATES on equality with the schema its queries were written
// against and refuses to start otherwise — the same gate `cmd/riskd` and
// `cmd/reconcile` apply, for the same reason: a lower database is missing
// tables these queries read, and a higher one may have reshaped them.
package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"log/slog"
	"math/big"
	"net"
	"net/http"
	"os"
	"os/signal"
	"runtime/debug"
	"sort"
	"strconv"
	"strings"
	"sync/atomic"
	"syscall"
	"time"

	"github.com/kaselunt/solvent/internal/config"
	"github.com/kaselunt/solvent/internal/risk"
	"github.com/kaselunt/solvent/internal/riskfeed"
	"github.com/kaselunt/solvent/internal/store"
)

// notifyChannel is the doorbell `cmd/riskd` rings at every committed batch. The
// payload is the batch id and NOTHING ELSE is derivable from it: this listener
// treats it as a wake-up and re-reads the tables. NOTIFY is droppable on
// reconnect, which is why the SSE loop ALSO polls — the poll is the mechanism
// and the doorbell is the optimization (chain-truth R1).
const notifyChannel = "risk_batch"

// Policy defaults. Each is a quantity this repo owns rather than one the chain
// asserts, each is overridable by environment variable, and each is published
// on /v1/meta so a reader never has to guess which bound produced a verdict.
const (
	defaultAddr = ":8080"
	// defaultRateLimit / defaultRateBurst — the per-IP token bucket. Generous
	// enough that a browser rendering one dashboard never sees a 429, tight
	// enough that a single client cannot monopolize the database.
	defaultRateLimit = 20.0
	defaultRateBurst = 40
	// defaultRateTTL bounds the limiter map: a bucket untouched for this long is
	// evicted, so a scan of the address space cannot grow it without bound.
	defaultRateTTL = 10 * time.Minute
	// defaultSSEHeartbeat — comment frames, so an idle stream is distinguishable
	// from a dead one through any proxy that buffers.
	defaultSSEHeartbeat = 15 * time.Second
	// defaultSSEPoll is the NOTIFY fallback cadence.
	defaultSSEPoll = 5 * time.Second

	defaultObservatoryLimit = 50
	maxObservatoryLimit     = 500

	// P5 page bounds, matching api/openapi.yaml's declared parameter ranges.
	defaultPositionsLimit = 50
	maxPositionsLimit     = 1000
	defaultEventsLimit    = 50
	maxEventsLimit        = 200
	defaultHistoryLimit   = 100
	maxHistoryLimit       = 500
	// defaultParamsLimit is server-owned: /v1/params declares no limit
	// parameter, so the page size is a policy of this deployment.
	defaultParamsLimit = 50
	// maxObservatorySeriesPoints bounds one rollup read. The rollup is hourly,
	// so this covers ~2.3 years per request; a request that hits the cap gets a
	// NOTE saying so rather than a silent truncation.
	maxObservatorySeriesPoints = 20_000

	// defaultWaterfallScenario is the axis the book's waterfall walks. ETH is
	// the factor essentially the whole book is exposed to (weETH = rate × ETH by
	// construction), so it is the one grid whose monotonicity invariant is
	// meaningful for a headline surface.
	//
	// It names the DEEPEST committed ETH rung, because the frontier's own
	// disclosures are that scenario's out_of_model — see defaultWaterfallGrid.
	defaultWaterfallScenario = "eth_minus_60"
)

// Published cadence constants (design spec §10: "≥5-block confirmation trail +
// 60s price cadence + ~1h sweep cadence published as constants").
//
// They are CONSTANTS OF THE DEPLOYMENT, not measurements, and /v1/meta labels
// them as such. A reader comparing a row's age against them is comparing
// against policy, which is the only honest comparison available to a binary
// that makes no chain calls.
const (
	confirmationBlocks = 5
	pricePollSeconds   = 60
	// dmSweepIntervalSeconds + dmSweepPassSeconds is the ~1h worst case of
	// design spec §5.2: a 3600s sweep interval plus a ~33 minute pass. DM
	// collateral is sweep-dominated and every DM row says so.
	dmSweepIntervalSeconds = 3600
	dmSweepPassSeconds     = 1980
)

func main() {
	configPath := flag.String("config", "config/contracts.json", "path to contracts config")
	feedsPath := flag.String("feeds", "recon/feeds.json", "path to the oracle feed registry")
	flag.Parse()

	log := slog.New(slog.NewTextHandler(os.Stderr, nil))
	slog.SetDefault(log)

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	if err := run(ctx, *configPath, *feedsPath); err != nil {
		// The error is sanitized before it reaches a log line: a DSN in a startup
		// failure is the same leak as a DSN in a response body, and operators
		// paste logs into issues (round-22 M2 class).
		log.Error("api exited with error", "err", sanitize(err.Error()))
		os.Exit(1)
	}
}

// serverConfig is the resolved, validated configuration of one api process.
type serverConfig struct {
	Addr string

	RateLimit float64
	RateBurst int
	RateTTL   time.Duration

	SSEHeartbeat time.Duration
	SSEPoll      time.Duration

	ObservatoryLimit int

	// WaterfallScenario names the committed scenario whose single axis the book's
	// waterfall grid walks; WaterfallGrid is that walk, WAD-scaled and strictly
	// descending. The grid's FIRST point is deliberately 1.0 — the unshocked
	// book — because that point is the standing "current bad debt" line design
	// spec §6 requires on the surface.
	WaterfallScenario string
	WaterfallGrid     []*big.Int

	// Aave and DM carry the chain bindings meta needs to name a chain per engine
	// and to locate each engine's price-owning cursor. They are the SAME
	// bindings riskd builds, from the same committed config.
	Aave riskfeed.EngineBinding
	DM   riskfeed.EngineBinding

	// PriceBudgetSeconds and StepBps are riskd's policy, republished here so a
	// reader can see the bound a persisted verdict was made against. They are
	// NOT applied to anything by this binary — re-judging a persisted verdict at
	// serve time is exactly the re-derivation design spec §7 forbids.
	PriceBudgetSeconds int64
	StepBps            int64
}

// server is the composition root.
type server struct {
	store    *store.Store
	registry *riskfeed.Registry
	feeds    *config.Feeds

	scenarios []risk.Scenario
	byID      map[string]risk.Scenario
	// waterfallScenario is the resolved grid scenario, kept separately because a
	// missing one is a startup failure rather than a per-request 500.
	waterfallScenario risk.Scenario

	cfg serverConfig

	// evidence is the deploy-bound half of /v1/evidence: the committed feeds
	// file's hash, the committed reconcile receipt's summary and the committed
	// probe-record paths, all read ONCE at startup. Nothing in it is measured
	// at request time — that is the point.
	evidence evidenceStatics

	version       string
	schemaVersion int64

	notifier *notifier

	limiter *ipLimiter
	mux     *http.ServeMux

	// readFailure is a TEST-ONLY injected read error for the SSE read-health latch.
	// Nil in production; see server.refresh.
	readFailure *atomic.Pointer[error]

	// batchInterleave is a TEST-ONLY hook the batch permalink handler runs
	// between its identity/servability stage and its aggregate/vector reads —
	// the retention-prune interleave point of Codex round-5 finding 2. Nil in
	// production (unexported, no configuration path); see handleBatch and
	// p5_batches_prune_race_db_test.go. The same atomic shape as readFailure,
	// for the same reason: a test arms it while a server goroutine reads it.
	batchInterleave *atomic.Pointer[func()]

	// bookInterleave is the SAME seam for readBatchAccounts — fired between
	// the newest-complete-batch resolution and the child reads, which is the
	// retention-prune interleave point of wave H8 (the /v1/book–/v1/address
	// sibling of the permalink's finding). Nil in production (unexported, no
	// configuration path); see readBatchAccounts and
	// book_prune_race_db_test.go.
	bookInterleave *atomic.Pointer[func()]
}

// apiDSN resolves the service's database URL.
//
// SOLVENT_API_DATABASE_URL is preferred and is where a SELECT-only role belongs
// (migration 00013 provisions `solvent_riskd` for the materializer; a public
// read surface wants the same posture and the operator grants it the same way).
// It falls back to SOLVENT_DATABASE_URL so a local run works without
// provisioning a second credential — a convenience with a cost, and the cost is
// that the structural read-only posture is not in force, so it is logged.
func apiDSN() (dsn string, scoped bool, err error) {
	if v := os.Getenv("SOLVENT_API_DATABASE_URL"); v != "" {
		return v, true, nil
	}
	if v := os.Getenv("SOLVENT_DATABASE_URL"); v != "" {
		return v, false, nil
	}
	return "", false, errors.New("api: set SOLVENT_API_DATABASE_URL (preferred) or SOLVENT_DATABASE_URL")
}

// loadServerConfig resolves configuration from files and environment.
func loadServerConfig(configPath, feedsPath string) (*server, error) {
	cfg, err := config.Load(configPath)
	if err != nil {
		return nil, err
	}
	feeds, err := config.LoadFeeds(feedsPath, cfg.Chains)
	if err != nil {
		return nil, err
	}
	registry, err := riskfeed.NewRegistry(feeds)
	if err != nil {
		return nil, err
	}
	ethChain, ok := cfg.Chains["eth"]
	if !ok {
		return nil, errors.New("api: contracts config declares no `eth` chain")
	}
	opChain, ok := cfg.Chains["op"]
	if !ok {
		return nil, errors.New("api: contracts config declares no `op` chain")
	}

	scenarios, err := risk.LoadScenarios()
	if err != nil {
		return nil, fmt.Errorf("api: load committed scenario set: %w", err)
	}
	byID := make(map[string]risk.Scenario, len(scenarios))
	for _, sc := range scenarios {
		byID[sc.ID] = sc
	}

	sc := serverConfig{
		Addr:              defaultAddr,
		RateLimit:         defaultRateLimit,
		RateBurst:         defaultRateBurst,
		RateTTL:           defaultRateTTL,
		SSEHeartbeat:      defaultSSEHeartbeat,
		SSEPoll:           defaultSSEPoll,
		ObservatoryLimit:  defaultObservatoryLimit,
		WaterfallScenario: defaultWaterfallScenario,
		WaterfallGrid:     defaultWaterfallGrid(),
		Aave: riskfeed.EngineBinding{
			Engine:      risk.AaveEngine,
			ChainID:     ethChain.ChainID,
			ParamEngine: risk.AaveParamEngine,
			PriceEngine: store.PollOwnedEnginePrefix + strconv.FormatUint(ethChain.ChainID, 10),
		},
		DM: riskfeed.EngineBinding{
			Engine:      risk.DMEngine,
			ChainID:     opChain.ChainID,
			ParamEngine: risk.DMEngine,
			PriceEngine: store.PollOwnedEnginePrefix + strconv.FormatUint(opChain.ChainID, 10),
		},
		PriceBudgetSeconds: 180,
		StepBps:            2000,
	}

	if v := os.Getenv("SOLVENT_API_ADDR"); v != "" {
		sc.Addr = v
	}
	if v := os.Getenv("SOLVENT_API_RATE_LIMIT"); v != "" {
		f, err := strconv.ParseFloat(v, 64)
		if err != nil || f <= 0 {
			return nil, fmt.Errorf("SOLVENT_API_RATE_LIMIT %q: must be a positive number of requests per second", v)
		}
		sc.RateLimit = f
	}
	if v := os.Getenv("SOLVENT_API_RATE_BURST"); v != "" {
		n, err := strconv.Atoi(v)
		if err != nil || n <= 0 {
			return nil, fmt.Errorf("SOLVENT_API_RATE_BURST %q: must be a positive integer", v)
		}
		sc.RateBurst = n
	}
	if v := os.Getenv("SOLVENT_API_RATE_TTL"); v != "" {
		d, err := time.ParseDuration(v)
		if err != nil || d <= 0 {
			return nil, fmt.Errorf("SOLVENT_API_RATE_TTL %q: must be a positive Go duration", v)
		}
		sc.RateTTL = d
	}
	if v := os.Getenv("SOLVENT_API_SSE_HEARTBEAT"); v != "" {
		d, err := time.ParseDuration(v)
		if err != nil || d <= 0 {
			return nil, fmt.Errorf("SOLVENT_API_SSE_HEARTBEAT %q: must be a positive Go duration", v)
		}
		sc.SSEHeartbeat = d
	}
	if v := os.Getenv("SOLVENT_API_SSE_POLL"); v != "" {
		d, err := time.ParseDuration(v)
		if err != nil || d <= 0 {
			return nil, fmt.Errorf("SOLVENT_API_SSE_POLL %q: must be a positive Go duration", v)
		}
		sc.SSEPoll = d
	}
	if v := os.Getenv("SOLVENT_API_OBSERVATORY_LIMIT"); v != "" {
		n, err := strconv.Atoi(v)
		if err != nil || n <= 0 || n > maxObservatoryLimit {
			return nil, fmt.Errorf("SOLVENT_API_OBSERVATORY_LIMIT %q: must be an integer in 1..%d", v, maxObservatoryLimit)
		}
		sc.ObservatoryLimit = n
	}
	if v := os.Getenv("SOLVENT_API_WATERFALL_SCENARIO"); v != "" {
		sc.WaterfallScenario = v
	}
	if v := os.Getenv("SOLVENT_API_WATERFALL_GRID"); v != "" {
		grid, err := parseGrid(v)
		if err != nil {
			return nil, err
		}
		sc.WaterfallGrid = grid
	}
	if v := os.Getenv("SOLVENT_RISK_PRICE_BUDGET"); v != "" {
		d, err := time.ParseDuration(v)
		if err != nil || d < time.Second {
			return nil, fmt.Errorf("SOLVENT_RISK_PRICE_BUDGET %q: must be a Go duration of at least one second", v)
		}
		sc.PriceBudgetSeconds = int64(d / time.Second)
	}
	if v := os.Getenv("SOLVENT_RISK_STEP_BPS"); v != "" {
		n, err := strconv.ParseInt(v, 10, 64)
		if err != nil || n < 0 {
			return nil, fmt.Errorf("SOLVENT_RISK_STEP_BPS %q: must be a non-negative integer", v)
		}
		sc.StepBps = n
	}

	grid, ok := byID[sc.WaterfallScenario]
	if !ok {
		return nil, fmt.Errorf("api: waterfall scenario %q is not in the committed scenario set", sc.WaterfallScenario)
	}

	// The evidence statics are read from the deployed tree ONCE, here. An
	// unreadable feeds file is a startup failure (the registry above was built
	// from it, so its hash must be computable); an absent reconcile receipt or
	// probe record is NOT — absence is served as null with its reason.
	evidence, err := loadEvidenceStatics(".", feedsPath, reconcileArtifactPath())
	if err != nil {
		return nil, err
	}

	return &server{
		registry:          registry,
		feeds:             feeds,
		scenarios:         scenarios,
		byID:              byID,
		waterfallScenario: grid,
		cfg:               sc,
		evidence:          evidence,
		version:           buildVersion(),
	}, nil
}

// defaultWaterfallGrid is 1.0 → 0.4 in ten-percent steps, WAD-scaled.
//
// The first point is 1.0 ON PURPOSE. Every column at that point describes the
// book AS IT STANDS — including the bad-debt census, which design spec §6 wants
// standing on the surface rather than buried under a shock ("the HF 0.73 golden-
// vector dust position makes this a feature, not an embarrassment").
//
// THE LAW OF THE LAST POINT: the deepest grid point equals the deepest
// COMMITTED ETH rung (defaultWaterfallScenario = eth_minus_60, factor 40/100),
// never deeper. The frontier carries no out_of_model of its own — it borrows
// the named scenario's — so a grid point past that rung would be a public
// number whose disclosures describe a shallower shock than the one it priced.
// Extending the grid therefore means committing the matching rung FIRST.
func defaultWaterfallGrid() []*big.Int {
	wad := risk.WaterfallGridScale()
	var out []*big.Int
	for _, pct := range []int64{100, 90, 80, 70, 60, 50, 40} {
		g := new(big.Int).Mul(wad, big.NewInt(pct))
		out = append(out, g.Div(g, big.NewInt(100)))
	}
	return out
}

// parseGrid reads a comma-separated list of WAD-scaled integers.
func parseGrid(v string) ([]*big.Int, error) {
	var out []*big.Int
	for _, part := range strings.Split(v, ",") {
		part = strings.TrimSpace(part)
		if part == "" {
			continue
		}
		g, ok := new(big.Int).SetString(part, 10)
		if !ok || g.Sign() <= 0 {
			return nil, fmt.Errorf("SOLVENT_API_WATERFALL_GRID %q: %q is not a positive WAD-scaled integer", v, part)
		}
		out = append(out, g)
	}
	if len(out) == 0 {
		return nil, fmt.Errorf("SOLVENT_API_WATERFALL_GRID %q: empty grid", v)
	}
	for i := 1; i < len(out); i++ {
		if out[i].Cmp(out[i-1]) >= 0 {
			return nil, fmt.Errorf("SOLVENT_API_WATERFALL_GRID %q: grid must be STRICTLY DESCENDING (point %d is not below point %d)", v, i, i-1)
		}
	}
	return out, nil
}

// buildVersion reports the VCS revision this binary was built from, or "devel"
// when the build carried no VCS stamp. It is a disclosure, never a decision
// input.
func buildVersion() string {
	info, ok := debug.ReadBuildInfo()
	if !ok {
		return "devel"
	}
	rev, dirty := "", false
	for _, s := range info.Settings {
		switch s.Key {
		case "vcs.revision":
			rev = s.Value
		case "vcs.modified":
			dirty = s.Value == "true"
		}
	}
	if rev == "" {
		return "devel"
	}
	if len(rev) > 12 {
		rev = rev[:12]
	}
	if dirty {
		return rev + "-dirty"
	}
	return rev
}

func run(ctx context.Context, configPath, feedsPath string) error {
	s, err := loadServerConfig(configPath, feedsPath)
	if err != nil {
		return err
	}
	dsn, scoped, err := apiDSN()
	if err != nil {
		return err
	}
	if !scoped {
		slog.Warn("api is using SOLVENT_DATABASE_URL: a SELECT-only role is NOT in force. " +
			"Set SOLVENT_API_DATABASE_URL for the structural read-only posture (migration 00013).")
	}

	// api NEVER migrates.
	st, err := store.Open(ctx, dsn)
	if err != nil {
		return err
	}
	defer st.Close()
	s.store = st

	if err := s.requireSchema(ctx); err != nil {
		return err
	}

	s.notifier = newNotifier(dsn, s.cfg.SSEPoll)
	s.limiter = newIPLimiter(s.cfg.RateLimit, s.cfg.RateBurst, s.cfg.RateTTL)
	s.routes()

	go s.notifier.run(ctx)

	srv := &http.Server{
		Addr:    s.cfg.Addr,
		Handler: s.handler(),
		// A read-only public surface has no reason to hold a connection open for
		// long. The SSE route sets its own deadlines (see sse.go) — a global
		// WriteTimeout would sever every stream at the bound.
		ReadHeaderTimeout: 10 * time.Second,
		IdleTimeout:       120 * time.Second,
	}

	ln, err := net.Listen("tcp", s.cfg.Addr)
	if err != nil {
		return fmt.Errorf("api: listen on %s: %w", s.cfg.Addr, err)
	}

	slog.Info("api started",
		"addr", ln.Addr().String(),
		"schema_version", s.schemaVersion,
		"version", s.version,
		"rate_limit_rps", s.cfg.RateLimit,
		"rate_burst", s.cfg.RateBurst,
		"waterfall_scenario", s.cfg.WaterfallScenario,
		"scoped_role", scoped)

	errCh := make(chan error, 1)
	go func() {
		if err := srv.Serve(ln); err != nil && !errors.Is(err, http.ErrServerClosed) {
			errCh <- err
			return
		}
		errCh <- nil
	}()

	select {
	case err := <-errCh:
		return err
	case <-ctx.Done():
		slog.Info("api stopping")
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = srv.Shutdown(shutdownCtx)
		return nil
	}
}

// requireSchema refuses to serve from a database whose schema is not the one
// this binary's queries were written against.
//
// EQUALITY, NOT "AT LEAST" — the same gate, and the same argument, as riskd's:
// a lower database is missing tables these queries read; a HIGHER one may have
// reshaped them, and a public surface serving numbers through queries that no
// longer describe the schema is how a wrong number gets a plausible shape.
func (s *server) requireSchema(ctx context.Context) error {
	want, err := store.ExpectedSchemaVersion()
	if err != nil {
		return err
	}
	got, err := store.SchemaVersion(ctx, s.store.Querier())
	if err != nil {
		return err
	}
	if got != want {
		return fmt.Errorf("api: database schema version %d, this binary expects %d — migrate (or deploy the matching build) before serving", got, want)
	}
	s.schemaVersion = want
	return nil
}

// routes registers the v1 surface. Every pattern is a read: the one POST —
// /v1/scenarios/{id}/run-book — is computed on request over the whole book and
// WRITES NOTHING (it is POST because the evaluation is per-request compute,
// not because it mutates). There is no auth because there is nothing to
// authorize.
func (s *server) routes() {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /v1/book", s.handleBook)
	mux.HandleFunc("GET /v1/positions", s.handlePositions)
	mux.HandleFunc("GET /v1/address/{addr}", s.handleAddress)
	mux.HandleFunc("GET /v1/address/{addr}/stress", s.handleStress)
	mux.HandleFunc("GET /v1/address/{addr}/history", s.handleAddressHistory)
	mux.HandleFunc("GET /v1/observatory", s.handleObservatory)
	mux.HandleFunc("GET /v1/observatory/series", s.handleObservatorySeries)
	mux.HandleFunc("GET /v1/events", s.handleEvents)
	mux.HandleFunc("GET /v1/params", s.handleParams)
	mux.HandleFunc("GET /v1/prices/{asset}", s.handlePrices)
	mux.HandleFunc("GET /v1/scenarios", s.handleScenarios)
	mux.HandleFunc("POST /v1/scenarios/{id}/run-book", s.handleRunBook)
	mux.HandleFunc("GET /v1/batches/{id}", s.handleBatch)
	mux.HandleFunc("GET /v1/evidence", s.handleEvidence)
	mux.HandleFunc("GET /v1/stream", s.handleStream)
	mux.HandleFunc("GET /v1/meta", s.handleMeta)
	s.mux = mux
}

// handler wraps the router in the middleware chain, outermost first.
func (s *server) handler() http.Handler {
	var h http.Handler = s.mux
	h = notFoundJSON(h)
	h = s.rateLimit(h)
	h = readOnly(h)
	h = cors(h)
	h = recoverPanics(h)
	return h
}

// engineChain maps an engine name to the chain its cursor is bound to. It is
// derived from the committed contracts config, never guessed.
func (s *server) engineChain(engine string) (uint64, bool) {
	switch engine {
	case s.cfg.Aave.Engine, s.cfg.Aave.ParamEngine:
		return s.cfg.Aave.ChainID, true
	case s.cfg.DM.Engine:
		return s.cfg.DM.ChainID, true
	}
	if strings.HasPrefix(engine, store.PollOwnedEnginePrefix) {
		id, err := strconv.ParseUint(strings.TrimPrefix(engine, store.PollOwnedEnginePrefix), 10, 64)
		if err == nil {
			return id, true
		}
	}
	return 0, false
}

// consumedEngines is every engine whose stamp participates in supersession —
// position, param and price engines, deduplicated and sorted.
func (s *server) consumedEngines() []string {
	seen := map[string]bool{}
	var out []string
	for _, e := range []string{
		s.cfg.Aave.Engine, s.cfg.Aave.ParamEngine, s.cfg.Aave.PriceEngine,
		s.cfg.DM.Engine, s.cfg.DM.ParamEngine, s.cfg.DM.PriceEngine,
	} {
		if e == "" || seen[e] {
			continue
		}
		seen[e] = true
		out = append(out, e)
	}
	sort.Strings(out)
	return out
}

// sweptEngines are the engines whose collateral comes from the snapshot sweep —
// today the Debt Manager alone, exactly as riskd declares it. Aave collateral is
// event-derived and has no sweep, and an all-zero sweep row is NOT the same
// statement as "this engine has no sweep".
func (s *server) sweptEngines() []string { return []string{s.cfg.DM.Engine} }
