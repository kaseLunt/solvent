package main

// Shared helpers for the P5 (Task B3) endpoints. Everything here is glue: the
// laws live with the handlers and the store readers.

import (
	"context"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/ethereum/go-ethereum/common"

	"github.com/kaselunt/solvent/internal/risk"
)

// writeJSONBody encodes v onto a writer whose status and headers are already
// committed (the 409 body, whose status writeJSON cannot express).
func writeJSONBody(w http.ResponseWriter, v any) {
	if err := json.NewEncoder(w).Encode(v); err != nil {
		slog.Error("api: encoding response failed after the header was written", "err", sanitize(err.Error()))
	}
}

// isCursorMessage reports whether a store error is about the CALLER's cursor
// (malformed, tampered, wrong reader, wrong mode) rather than about this
// service. The store's cursor codec deliberately names "cursor" in every such
// refusal; anything else is a server-side failure and stays a 500.
func isCursorMessage(err error) bool {
	return err != nil && strings.Contains(err.Error(), "cursor")
}

// dbNow reads the DATABASE clock — every `served_at` on this surface is the
// database's now, never this process's wall clock, so ages computed against
// durable stamps stay coherent with the rest of the API.
func (s *server) dbNow(ctx context.Context) (time.Time, error) {
	var now time.Time
	if err := s.store.Querier().QueryRow(ctx, `SELECT now()`).Scan(&now); err != nil {
		return time.Time{}, fmt.Errorf("read database clock: %w", err)
	}
	return now.UTC(), nil
}

// parseEngineParam validates an OPTIONAL engine query parameter against the
// public vocabulary. ok=false means the caller has already been answered.
func parseEngineParam(w http.ResponseWriter, raw string) (engine string, ok bool) {
	switch raw {
	case "", risk.AaveEngine, risk.DMEngine:
		return raw, true
	default:
		writeError(w, http.StatusBadRequest, codeBadRequest,
			"unknown engine "+fmt.Sprintf("%q", raw)+": the vocabulary is aave_v3_etherfi | debt_manager", nil)
		return "", false
	}
}

// hexAddrPtr renders optional address bytes as a 0x address, or nil. Empty is
// null on the wire — "no asset on this row" is a statement, not a zero
// address.
func hexAddrPtr(b []byte) *string {
	if len(b) == 0 {
		return nil
	}
	s := common.BytesToAddress(b).Hex()
	return &s
}

// hexBytes renders a 32-byte hash as 0x-hex.
func hexBytes(b []byte) string {
	return "0x" + hex.EncodeToString(b)
}

// engineValueDecimals is the engines' own USD scales, used ONLY where a
// response must state a scale and no persisted row is available to carry it
// (an empty observatory series, an engine series with no points). The values
// are the same constants every persisted aggregate carries.
var engineValueDecimals = map[string]int{
	risk.AaveEngine: 8,
	risk.DMEngine:   6,
}

func intPtr(v int) *int       { return &v }
func strPtr(v string) *string { return &v }
func int64Ptr(v int64) *int64 { return &v }
