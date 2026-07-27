// Aave comparison semantics (brief §3.4; risk-quant F1 Aave welds). Assets
// are keyed by UNDERLYING RESERVE ADDRESS everywhere, never symbol (the
// duplicate liquidRESERVE symbol/name gotcha is a standing house rule).
package main

import (
	"math/big"
	"sort"

	"github.com/ethereum/go-ethereum/common"

	"github.com/kaselunt/solvent/cmd/reconcile/snapshotdb"
	"github.com/kaselunt/solvent/internal/store"
)

// aaveEngine aliases the snapshot package's constant so the two packages
// cannot drift on the engine name.
const aaveEngine = snapshotdb.AaveEngine

// rayUnit is WadRayMath.RAY = 1e27.
var rayUnit = new(big.Int).Exp(big.NewInt(10), big.NewInt(27), nil)

// rayMulCeil models the DEPLOYED variable-debt token's scaled→live
// projection as c = ceil(a×b / RAY). Evidence (empirical, two vectors at
// one pin — NOT a source-level or exhaustive proof): at ETH pin 25,627,125
// (2026-07-27 acceptance run), scaled 125415 × n
// 1094089501745475497022017896 (frac ≈ .235) → balanceOf 137216, and
// scaled 83 × n 1000520158840839583052050491 (frac ≈ .043) → balanceOf 84.
// Both sub-half fracs rounding UP decisively REFUTE WadRayMath half-up and
// floor for these inputs and are consistent with ceiling and the
// aave-v3-origin lineage (debt never understated); half-up yields
// 137215/83 and false-fails the §3.4(b) identity on exact derived state.
// Same QuoRem shape as internal/derive's rayMulCeil. Replicated on the
// same inputs at the same pin, the identity stays deterministic with a
// ZERO bound (the contract does the compounding; we do one
// multiplication).
func rayMulCeil(a, b *big.Int) *big.Int {
	out := new(big.Int).Mul(a, b)
	q, r := new(big.Int).QuoRem(out, rayUnit, new(big.Int))
	if r.Sign() != 0 {
		q.Add(q, big.NewInt(1))
	}
	return q
}

// aaveRowResult is one gated (or labeled-supplementary) Aave comparison.
type aaveRowResult struct {
	AccountHex string `json:"account"`
	ReserveHex string `json:"reserve"` // underlying reserve address
	Side       string `json:"side"`    // debt | collateral
	TokenHex   string `json:"token"`   // variableDebtToken / aToken actually read
	Derived    string `json:"derived_scaled"`
	Chain      string `json:"chain_scaled"`
	Verdict    string `json:"verdict"`
	Gated      bool   `json:"gated"`
	Supplement bool   `json:"supplementary,omitempty"` // top-N advisory rows
	// Live-value identity (§3.4(b), debt side only): rayMulCeil(derived,
	// normalizedDebt@P) vs balanceOf@P, gated at 0.
	LiveDerived string `json:"live_value_derived,omitempty"`
	LiveChain   string `json:"live_value_chain,omitempty"`
	LiveVerdict string `json:"live_value_verdict,omitempty"`
	Endpoints   []int  `json:"endpoints_consulted,omitempty"`
}

// compareScaled evaluates the §3.4(a) leg: derived scaled vs
// scaledBalanceOf, bit-exact, no ray replication.
func compareScaled(derived, chain *big.Int) string {
	if derived == nil {
		derived = bigZero()
	}
	if chain == nil {
		chain = bigZero()
	}
	if derived.Cmp(chain) == 0 {
		return verdictExact
	}
	return verdictDrift
}

// liveValueIdentity evaluates the §3.4(b) leg on already-fetched values.
func liveValueIdentity(derivedScaled, normalizedDebt, chainBalance *big.Int) (computed string, verdict string) {
	c := rayMulCeil(derivedScaled, normalizedDebt)
	if c.Cmp(chainBalance) == 0 {
		return c.String(), verdictExact
	}
	return c.String(), verdictDrift
}

// aaveWeldRow is one reserve's F1 census weld: Σ derived scaled (ALL
// accounts) vs scaledTotalSupply() @ pinHash(P_eth). Debt side GATED, zero
// bound (mint/burn move user scaled and total by the same rayDiv result;
// BalanceTransfer conserves; the DeficitCreated burn is included).
// Collateral (aToken) side: NUMERIC mismatches ADVISORY on this first run
// per the amendment — the treasury-accrual account must be present in the
// derived Σ; the deriver folds Mint for any account, so exactness is
// expected — promoted to gated after one clean run. Ability-to-check is a
// SEPARATE policy (round-11 F2): weld-unread rows gate on BOTH sides.
type aaveWeldRow struct {
	ReserveHex string `json:"reserve"`
	TokenHex   string `json:"token"` // the scaled token actually read
	Side       string `json:"side"`
	DerivedSum string `json:"derived_sum_all_accounts"`
	ChainTotal string `json:"chain_scaled_total_supply"`
	Verdict    string `json:"verdict"` // exact | aggregate-mismatch | weld-unread
	Gated      bool   `json:"gated"`
	ReadError  string `json:"read_error,omitempty"` // weld-unread rows: WHY the chain leg is unread
}

// weldAaveAggregate compares all-accounts derived scaled sums per reserve
// with the chain reads over the AUTHORITATIVE universe (round-10 F3): the
// Pool's own getReservesList(@pin) ∪ derived-assets (universe) unioned with
// both fact sets' keys. A universe reserve whose token resolution or
// scaledTotalSupply read did not succeed becomes a weld-unread row — never
// a silently absent row, never a fake zero — and weld-unread rows are
// ALWAYS GATED, on both sides, regardless of the numeric-mismatch policy
// the gated parameter carries (round-11 F2: "cannot verify" is never
// advisory).
func weldAaveAggregate(side string, gated bool, derived map[common.Address]*big.Int, reads map[common.Address]chainRead, tokenByReserve map[common.Address]common.Address, universe []common.Address) []aaveWeldRow {
	union := map[common.Address]bool{}
	for _, r := range universe {
		union[r] = true
	}
	for r := range derived {
		union[r] = true
	}
	for r := range reads {
		union[r] = true
	}
	reserves := make([]common.Address, 0, len(union))
	for r := range union {
		reserves = append(reserves, r)
	}
	sort.Slice(reserves, func(i, j int) bool { return reserves[i].Hex() < reserves[j].Hex() })

	var rows []aaveWeldRow
	for _, r := range reserves {
		d := derived[r]
		if d == nil {
			d = bigZero()
		}
		row := aaveWeldRow{
			ReserveHex: r.Hex(),
			TokenHex:   tokenByReserve[r].Hex(),
			Side:       side,
			DerivedSum: d.String(),
			Gated:      gated,
		}
		read, present := reads[r]
		switch {
		case !present:
			row.ChainTotal = "(unread)"
			row.Verdict = verdictWeldUnread
			row.ReadError = "no scaledTotalSupply read was recorded for this universe reserve"
		case !read.OK:
			row.ChainTotal = "(unread)"
			row.Verdict = verdictWeldUnread
			row.ReadError = read.Note
		case d.Cmp(read.Total) == 0:
			row.ChainTotal = read.Total.String()
			row.Verdict = verdictExact
		default:
			row.ChainTotal = read.Total.String()
			row.Verdict = verdictAggregateMismatch
		}
		// AXIOM (round-11 F2): "cannot verify" is NEVER advisory. The
		// gated parameter above carries the side's NUMERIC-mismatch policy
		// only (collateral aggregate-mismatch stays advisory on the first
		// run per the amendment); ability-to-check is a separate,
		// non-negotiable policy — a weld-unread row GATES on every side,
		// whichever weld produced it, because an unreadable leg proves
		// nothing about the universe it was supposed to verify.
		if row.Verdict == verdictWeldUnread {
			row.Gated = true
		}
		rows = append(rows, row)
	}
	return rows
}

// aaveWeldGatedFailures counts the Aave weld rows that gate the exit code.
// It is THE accounting the phase-2 site uses (never a test-only twin), so
// TestCollateralUnreadIsGatedEvenWhenNumericIsAdvisory exercises the exact
// path a live run takes from an unreadable collateral leg to exit 1.
func aaveWeldGatedFailures(rows []aaveWeldRow) int {
	n := 0
	for _, w := range rows {
		if w.Gated && w.Verdict != verdictExact {
			n++
		}
	}
	return n
}

// derivedScaledByReserve folds AssetNetSums (asset = underlying reserve)
// into an address-keyed map for the welds.
func derivedScaledByReserve(sums []store.AssetNetSum) map[common.Address]*big.Int {
	out := map[common.Address]*big.Int{}
	for _, s := range sums {
		out[common.BytesToAddress(s.Asset)] = s.Total
	}
	return out
}
