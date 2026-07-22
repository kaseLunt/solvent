.PHONY: db-up db-down test fmt vet run-indexer

db-up:
	docker compose up -d db && docker compose exec db sh -c 'until pg_isready -U solvent; do sleep 1; done'

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
