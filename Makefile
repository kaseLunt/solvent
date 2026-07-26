# Load local dev env (created via `cp .env.example .env`) and export every
# make variable so db-up/test/run-indexer see it. Missing .env is fine — CI
# sets its own environment.
-include .env
export

.PHONY: db-up db-down test test-acceptance fmt vet run-indexer reconcile

# db-up brings up Postgres AND provisions the physical DB split (Task 9
# wave 10): db-init idempotently creates solvent_test, the destructive test
# suite's scratch database, alongside the live `solvent` database.
db-up:
	docker compose up -d db db-init && docker compose exec db sh -c 'until pg_isready -U solvent; do sleep 1; done'

db-down:
	docker compose down

# test is DEV MODE: DB-gated tests SKIP when TEST_DATABASE_URL is unset.
# Every destructive helper still runs the shared split guard first (round-10
# F1): TEST_DATABASE_URL must resolve to a physically different database
# than SOLVENT_DATABASE_URL (pg_control system_identifier + database OID +
# name — alias spellings cannot fool it), or the suite fails closed before
# any Migrate/TRUNCATE. Dev-mode results are NEVER acceptance evidence.
test:
	go test ./...

# test-acceptance is ACCEPTANCE MODE — the only mode whose suite-green output
# may back a W1 receipt (round-10 F1). SOLVENT_ACCEPTANCE=1 makes an unset
# TEST_DATABASE_URL FATAL in every destructive helper (never a skip), and the
# target counts `--- SKIP` lines across the whole verbose stream and fails on
# ANY skip: a skipped live-db suite can never produce suite-green evidence.
# Full posture also wants SOLVENT_LIVE_RPC_TESTS=1 and
# SOLVENT_RECON_DATABASE_URL (read-only, live) exported so nothing else skips.
# NOTE: the recipe clears SOLVENT_RPC_* / SOLVENT_RECON_RPC_* — the Makefile's
# global `-include .env` + `export` would otherwise inject them into the test
# processes, and the suite's proven zero-skip posture keeps them UNSET
# (TestLoadFailsWhenRPCEnvMissing asserts config.Load fails without them; no
# test dials through them — the gate-ON chain regression pins its own URL).
test-acceptance:
	@log="$${TMPDIR:-/tmp}/solvent-test-acceptance.log"; \
	env -u SOLVENT_RPC_OP -u SOLVENT_RPC_ETH -u SOLVENT_RECON_RPC_OP -u SOLVENT_RECON_RPC_ETH \
		SOLVENT_ACCEPTANCE=1 go test ./... -count=1 -v > "$$log" 2>&1; st=$$?; \
	skips=$$(grep -c -- '--- SKIP' "$$log" || true); \
	grep -E '^(ok|FAIL)' "$$log"; \
	echo "acceptance mode: exit=$$st skips=$$skips (log: $$log)"; \
	if [ "$$st" -ne 0 ]; then echo "FAIL: go test exit $$st"; exit "$$st"; fi; \
	if [ "$$skips" -gt 0 ]; then echo "FAIL: acceptance mode rejects skips (>0 skipped tests)"; grep -- '--- SKIP' "$$log"; exit 1; fi; \
	echo "acceptance suite green: zero skips"

fmt:
	gofmt -l .

vet:
	go vet ./...

run-indexer:
	go run ./cmd/indexer

# reconcile runs the W1 acceptance-evidence harness with .env exported (it
# needs SOLVENT_DATABASE_URL, SOLVENT_RPC_*, and — for the archive-capable
# ETH golden reads — SOLVENT_RECON_RPC_ETH). Strictly read-only against the
# live database; safe while the daemon runs. Extra flags:
# make reconcile RECONCILE_FLAGS="-preflight-only".
reconcile:
	go run ./cmd/reconcile $(RECONCILE_FLAGS)
