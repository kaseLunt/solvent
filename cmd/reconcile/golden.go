// Aave golden vectors — DUAL-PIN (brief §4, resolving L0-2/L2-3). W1 pins
// borrower 1 at ETH 25,584,990; the committed Task 6 fixtures were captured
// at 25,593,800. Constants are NEVER ported across blocks:
//
//   - Row A — the literal W1 clause: DB as-of sums ≤ 25,584,990 vs LIVE
//     scaledBalanceOf reads pinned at HeaderHashFrom(25,584,990), both
//     borrowers, debt + collateral. Mandatory for result:pass; an archive
//     miss is exit 2 naming the endpoint — never skipped, never
//     fixture-substituted (mutation target 11 pins the live read).
//   - Row B — fixture weld at the fixtures' OWN pin: derived as-of ≤
//     25,593,800 == committed fixture constants == chain scaledBalanceOf @
//     25,593,800. Three-way: DB==chain proves the deriver; chain==constant
//     proves the endpoint isn't lying and provenance holds; DB==constant
//     localizes the broken leg.
//   - Row C — interval quiescence (gated documentation): COUNT of the
//     borrowers' position_events in (25,584,990 .. 25,593,800] — expected 0,
//     recorded so the reviewer sees WHY A and B agree.
package main

import (
	"context"
	_ "embed"
	"encoding/json"
	"fmt"
	"math/big"

	"github.com/ethereum/go-ethereum/common"

	"github.com/kaselunt/solvent/cmd/reconcile/snapshotdb"
)

//go:embed golden_vectors.json
var goldenVectorsJSON []byte

type goldenReserve struct {
	Symbol       string `json:"symbol"`
	Underlying   string `json:"underlying"`
	AtokenStream string `json:"atoken_stream"`
	Role         string `json:"role"`
}

type goldenBorrower struct {
	Address                 string `json:"address"`
	DebtReserve             string `json:"debt_reserve"`
	FixtureScaledDebt       string `json:"fixture_scaled_debt"`
	CollateralReserve       string `json:"collateral_reserve"`
	FixtureScaledCollateral string `json:"fixture_scaled_collateral"`
}

type goldenVectors struct {
	W1PinETH      uint64           `json:"w1_pin_eth"`
	FixturePinETH uint64           `json:"fixture_pin_eth"`
	Reserves      []goldenReserve  `json:"reserves"`
	Borrowers     []goldenBorrower `json:"borrowers"`
}

// loadGoldenVectors parses and validates the embedded vectors. The pins are
// asserted against the brief's constants: `-golden-pin-eth` and
// `-fixture-pin-eth` are FIXED values — overriding either taints
// acceptance:false at the flag layer, and a drifted embed fails here.
func loadGoldenVectors() (goldenVectors, error) {
	var v goldenVectors
	if err := json.Unmarshal(goldenVectorsJSON, &v); err != nil {
		return v, fmt.Errorf("parse golden_vectors.json: %w", err)
	}
	if v.W1PinETH != 25584990 {
		return v, fmt.Errorf("golden vectors w1_pin_eth = %d, want 25584990 (the literal W1 clause block)", v.W1PinETH)
	}
	if v.FixturePinETH != 25593800 {
		return v, fmt.Errorf("golden vectors fixture_pin_eth = %d, want 25593800 (aave_test.go fixture pin)", v.FixturePinETH)
	}
	if len(v.Borrowers) != 2 {
		return v, fmt.Errorf("golden vectors carry %d borrowers, want 2", len(v.Borrowers))
	}
	for _, b := range v.Borrowers {
		for _, a := range []string{b.Address, b.DebtReserve, b.CollateralReserve} {
			if !common.IsHexAddress(a) {
				return v, fmt.Errorf("golden vectors: %q is not an address", a)
			}
		}
		for _, n := range []string{b.FixtureScaledDebt, b.FixtureScaledCollateral} {
			if _, ok := new(big.Int).SetString(n, 10); !ok {
				return v, fmt.Errorf("golden vectors: fixture constant %q is not an integer", n)
			}
		}
	}
	return v, nil
}

// goldenRow is one gated golden comparison row for the artifact.
type goldenRow struct {
	Row        string `json:"row"` // "A" | "B" | "C"
	Borrower   string `json:"borrower,omitempty"`
	Side       string `json:"side,omitempty"`
	ReserveHex string `json:"reserve,omitempty"`
	Pin        uint64 `json:"pin"`
	PinHash    string `json:"pin_hash,omitempty"`
	TokenHex   string `json:"token,omitempty"`
	Derived    string `json:"derived_scaled,omitempty"`
	Chain      string `json:"chain_scaled,omitempty"`
	Fixture    string `json:"fixture_constant,omitempty"` // Row B only
	// Row B leg verdicts localize the broken leg (db_vs_chain,
	// chain_vs_fixture, db_vs_fixture).
	Legs      map[string]string `json:"legs,omitempty"`
	Count     *int64            `json:"interval_event_count,omitempty"` // Row C
	Verdict   string            `json:"verdict"`
	Endpoints []int             `json:"endpoints_consulted,omitempty"`
}

// The golden DB side (snapshotdb.GoldenDBSide, collected by
// snapshotdb.Collect) lives with the snapshot since round-13 F2 — it is read
// inside the RR transaction, and no DB read may happen after the snapshot
// closes.

// goldenLookup pulls one derived figure (missing ⇒ zero: an account with no
// events at the pin has derived state zero, and the chain must agree).
func goldenLookup(m map[string]map[string]map[string]*big.Int, accountHex, reserveHex, side string) *big.Int {
	if r, ok := m[accountHex]; ok {
		if s, ok := r[reserveHex]; ok {
			if v, ok := s[side]; ok {
				return v
			}
		}
	}
	return bigZero()
}

// runGoldenChainSide executes rows A and B against the LIVE chain through
// the pinned reader (Phase 2) and assembles row C from the Phase-1 count.
// poolAddr is the eth:aave-etherfi stream's Pool proxy; atokens maps
// underlying reserve hex → aToken address (from the eth:atoken-* streams).
//
// The Row-A chain leg is a LIVE pinned read at the W1 block by construction:
// the hash comes from HeaderHashFrom(w1Pin) on this run, and every scaled
// figure comes from CallAtHashFrom under that hash — there is no code path
// from the fixture constants into a Row A value (asserted by
// TestGoldenRowAIsALiveChainReadAtTheW1Pin).
func runGoldenChainSide(ctx context.Context, r *pinnedReader, vec goldenVectors, db snapshotdb.GoldenDBSide, poolAddr common.Address, atokens map[string]common.Address) ([]goldenRow, error) {
	var rows []goldenRow

	type pinSpec struct {
		row  string
		pin  uint64
		asOf map[string]map[string]map[string]*big.Int
	}
	specs := []pinSpec{
		{row: "A", pin: vec.W1PinETH, asOf: db.AsOfW1},
		{row: "B", pin: vec.FixturePinETH, asOf: db.AsOfFixture},
	}
	for _, spec := range specs {
		pinHash, _, err := r.headerHash(ctx, spec.pin)
		if err != nil {
			return rows, fmt.Errorf("golden row %s: header at %d: %w", spec.row, spec.pin, err)
		}
		for _, b := range vec.Borrowers {
			borrower := common.HexToAddress(b.Address)
			acctHex := fmt.Sprintf("%x", borrower.Bytes())

			type leg struct {
				side    string
				reserve common.Address
				fixture string
			}
			legs := []leg{
				{side: "debt", reserve: common.HexToAddress(b.DebtReserve), fixture: b.FixtureScaledDebt},
				{side: "collateral", reserve: common.HexToAddress(b.CollateralReserve), fixture: b.FixtureScaledCollateral},
			}
			for _, l := range legs {
				resHex := fmt.Sprintf("%x", l.reserve.Bytes())
				var token common.Address
				var endpoints []int
				if l.side == "debt" {
					// Debt token resolved AT THE PIN — never embedded.
					data, err := poolReserveDebtTokenABI.Pack("getReserveVariableDebtToken", l.reserve)
					if err != nil {
						return rows, fmt.Errorf("pack getReserveVariableDebtToken: %w", err)
					}
					ret, tok, err := r.callAtHash(ctx, fmt.Sprintf("golden%s:resolveDebtToken(%s)", spec.row, resHex), poolAddr, data, pinHash)
					if err != nil {
						return rows, fmt.Errorf("golden row %s: resolve debt token for %s at %d: %w", spec.row, resHex, spec.pin, err)
					}
					token, err = unpackAddress(poolReserveDebtTokenABI, "getReserveVariableDebtToken", ret)
					if err != nil {
						return rows, err
					}
					endpoints = append(endpoints, tok.Index)
				} else {
					at, ok := atokens[resHex]
					if !ok {
						return rows, fmt.Errorf("golden row %s: no aToken stream configured for reserve %s", spec.row, resHex)
					}
					token = at
				}
				data, err := aaveScaledBalanceOfABI.Pack("scaledBalanceOf", borrower)
				if err != nil {
					return rows, fmt.Errorf("pack scaledBalanceOf: %w", err)
				}
				ret, tok, err := r.callAtHash(ctx, fmt.Sprintf("golden%s:scaledBalanceOf(%s,%s)", spec.row, l.side, acctHex), token, data, pinHash)
				if err != nil {
					return rows, fmt.Errorf("golden row %s: scaledBalanceOf %s/%s at %d: %w", spec.row, acctHex, l.side, spec.pin, err)
				}
				chainScaled, err := unpackUint256(aaveScaledBalanceOfABI, "scaledBalanceOf", ret)
				if err != nil {
					return rows, err
				}
				endpoints = append(endpoints, tok.Index)

				derived := goldenLookup(spec.asOf, acctHex, resHex, l.side)
				row := goldenRow{
					Row:        spec.row,
					Borrower:   b.Address,
					Side:       l.side,
					ReserveHex: l.reserve.Hex(),
					Pin:        spec.pin,
					PinHash:    pinHash.Hex(),
					TokenHex:   token.Hex(),
					Derived:    derived.String(),
					Chain:      chainScaled.String(),
					Endpoints:  endpoints,
				}
				if spec.row == "A" {
					row.Verdict = compareScaled(derived, chainScaled)
				} else {
					fixture, _ := new(big.Int).SetString(l.fixture, 10)
					row.Fixture = fixture.String()
					row.Legs = map[string]string{
						"db_vs_chain":      compareScaled(derived, chainScaled),
						"chain_vs_fixture": compareScaled(chainScaled, fixture),
						"db_vs_fixture":    compareScaled(derived, fixture),
					}
					row.Verdict = verdictExact
					for _, v := range row.Legs {
						if v != verdictExact {
							row.Verdict = verdictDrift
						}
					}
				}
				rows = append(rows, row)
			}
		}
	}

	count := db.IntervalCount
	rowC := goldenRow{Row: "C", Pin: vec.FixturePinETH, Count: &count}
	if count == 0 {
		rowC.Verdict = verdictExact
	} else {
		rowC.Verdict = verdictDrift
	}
	rows = append(rows, rowC)
	return rows, nil
}
