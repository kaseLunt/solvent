# Load local dev env (created via `cp .env.example .env`) and export every
# make variable so db-up/test/run-indexer see it. Missing .env is fine — CI
# sets its own environment.
-include .env
export

.PHONY: db-up db-down test fmt vet run-indexer reconcile

# db-up brings up Postgres AND provisions the physical DB split (Task 9
# wave 10): db-init idempotently creates solvent_test, the destructive test
# suite's scratch database, alongside the live `solvent` database.
db-up:
	docker compose up -d db db-init && docker compose exec db sh -c 'until pg_isready -U solvent; do sleep 1; done'

db-down:
	docker compose down

test:
	go test ./...

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
