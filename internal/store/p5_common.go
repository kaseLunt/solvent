package store

// P5 Task B1 shared plumbing for the read-only web query layer: the opaque
// cursor codec every paginated reader uses, the block-time enrichment that
// tolerates the block_headers table not existing yet, and the engine-name
// constants the display vocabulary welds against.
//
// EVERYTHING IN THE p5_* FILES IS READ-ONLY. These readers are consumed by
// cmd/api (Task B3) and never mutate state; the single-writer contract
// (D-004) is untouched.

import (
	"context"
	"encoding/base64"
	"fmt"
	"math/big"
	"strconv"
	"strings"
	"time"
)

// Engine names, as persisted in position_events.engine and risk tables.
//
// The AUTHORITATIVE definitions live in internal/derive (AaveEngineName,
// dmEngineName) — store cannot import derive (derive imports store), so the
// values are restated here and WELDED by test: the display-vocabulary weld in
// p5_events_vocab_test.go parses the derive sources and fails if either
// constant drifts from the deriver's own value.
const (
	EngineAave        = "aave_v3_etherfi"
	EngineDebtManager = "debt_manager"

	// paramEngineAave is the PoolConfigurator custody engine that writes
	// param_history (migration 00011). It is a different writer identity than
	// the position engine EngineAave; the param-timeline reader accepts the
	// public engine name and maps to this writer identity internally.
	paramEngineAave = "aave_param"
)

// ---------------------------------------------------------------------------
// Opaque cursors.
// ---------------------------------------------------------------------------
//
// A cursor is base64url("<tag>|f1|f2|...") — opaque to callers, versioned by
// its tag, and STRICT on decode: a cursor from a different reader, a
// different sort, a different batch or a tampered string is a typed refusal,
// never a silent page of garbage. The fields are pipe-joined; no field a
// cursor carries may contain '|' (all are integers, fixed enum strings, or
// hex).

func p5EncodeCursor(tag string, fields ...string) string {
	return base64.RawURLEncoding.EncodeToString([]byte(tag + "|" + strings.Join(fields, "|")))
}

// p5DecodeCursor decodes and verifies the tag, returning exactly want fields.
func p5DecodeCursor(cursor, tag string, want int) ([]string, error) {
	raw, err := base64.RawURLEncoding.DecodeString(cursor)
	if err != nil {
		return nil, fmt.Errorf("cursor is not valid base64url: %w", err)
	}
	parts := strings.Split(string(raw), "|")
	if parts[0] != tag {
		return nil, fmt.Errorf("cursor tag %q does not match this reader (want %q) — cursors are not interchangeable across endpoints", parts[0], tag)
	}
	if len(parts)-1 != want {
		return nil, fmt.Errorf("cursor carries %d fields, want %d", len(parts)-1, want)
	}
	return parts[1:], nil
}

func p5CursorUint(field, name string) (uint64, error) {
	v, err := strconv.ParseUint(field, 10, 64)
	if err != nil {
		return 0, fmt.Errorf("cursor field %s %q is not an unsigned integer", name, field)
	}
	return v, nil
}

// ---------------------------------------------------------------------------
// NUMERIC ::text → *big.Int, the house decode for exact values.
// ---------------------------------------------------------------------------

// p5BigFromText converts a nullable ::text-cast NUMERIC scan into *big.Int.
// nil stays nil (NULL is a fact, never zero); a non-integer is a loud error,
// exactly as RiskBatchPositions treats it.
func p5BigFromText(name string, text *string) (*big.Int, error) {
	if text == nil {
		return nil, nil
	}
	v, ok := new(big.Int).SetString(*text, 10)
	if !ok {
		return nil, fmt.Errorf("%s %q is not an integer", name, *text)
	}
	return v, nil
}

// ---------------------------------------------------------------------------
// block_headers enrichment (tolerant of the table not existing).
// ---------------------------------------------------------------------------
//
// The block_headers table is Task B2's surface (migration 00015, landed by
// the sibling wave in this same tree): block_time is the header's OWN
// timestamp in unix seconds, chain-asserted only. The enrichment here is a
// SEPARATE second query, guarded by a runtime to_regclass presence check,
// never a join inside the page query — the readers must serve a database
// whose daemon has not applied 00015 yet (the API role migrates nothing),
// and a missing table must degrade to "no times", not to a query error.
//
// A missing table or a missing row produce the same honest answer: no time.
// The caller renders the block number and NEVER fabricates a timestamp
// (spec §3.5: "real header time … never invented time"; migration 00012 is
// the precedent for refusing fabricated as-ofs).

type p5BlockKey struct {
	ChainID     uint64
	BlockNumber uint64
}

func (s *Store) p5BlockHeadersPresent(ctx context.Context) (bool, error) {
	var present bool
	if err := s.pool.QueryRow(ctx, `SELECT to_regclass('block_headers') IS NOT NULL`).Scan(&present); err != nil {
		return false, fmt.Errorf("check block_headers presence: %w", err)
	}
	return present, nil
}

// p5BlockTimes resolves chain-asserted header times for the given block keys.
// Keys with no stored header (or a NULL block_time) are simply absent from
// the result — absence is the honest degraded state, not an error.
func (s *Store) p5BlockTimes(ctx context.Context, keys map[p5BlockKey]struct{}) (map[p5BlockKey]time.Time, error) {
	out := map[p5BlockKey]time.Time{}
	if len(keys) == 0 {
		return out, nil
	}
	present, err := s.p5BlockHeadersPresent(ctx)
	if err != nil {
		return nil, err
	}
	if !present {
		return out, nil
	}
	chains := make([]int64, 0, len(keys))
	blocks := make([]int64, 0, len(keys))
	for k := range keys {
		chains = append(chains, int64(k.ChainID))
		blocks = append(blocks, int64(k.BlockNumber))
	}
	rows, err := s.pool.Query(ctx, `
		SELECT bh.chain_id, bh.block_number, bh.block_time
		FROM block_headers bh
		JOIN unnest($1::bigint[], $2::bigint[]) AS k(chain_id, block_number)
		  ON bh.chain_id = k.chain_id AND bh.block_number = k.block_number`, chains, blocks)
	if err != nil {
		return nil, fmt.Errorf("read block header times: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var chainID, blockNumber, blockTime int64
		if err := rows.Scan(&chainID, &blockNumber, &blockTime); err != nil {
			return nil, fmt.Errorf("scan block header time: %w", err)
		}
		// block_time is the header's unix-seconds timestamp (00015's
		// chain-asserted-only law); rendered as UTC wall time here, losing
		// nothing (headers have second precision).
		out[p5BlockKey{ChainID: uint64(chainID), BlockNumber: uint64(blockNumber)}] = time.Unix(blockTime, 0).UTC()
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate block header times: %w", err)
	}
	return out, nil
}
