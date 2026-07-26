// Aave comparison semantics (brief §3.4; risk-quant F1 Aave welds). Assets
// are keyed by UNDERLYING RESERVE ADDRESS everywhere, never symbol (the
// duplicate liquidRESERVE symbol/name gotcha is a standing house rule).
package main

import (
	"math/big"
	"sort"

	"github.com/ethereum/go-ethereum/common"

	"github.com/kaselunt/solvent/internal/store"
)

const aaveEngine = "aave_v3_etherfi"

// rayUnit is WadRayMath.RAY = 1e27.
var rayUnit = new(big.Int).Exp(big.NewInt(10), big.NewInt(27), nil)

var halfRay = new(big.Int).Rsh(rayUnit, 1) // RAY/2 (RAY is even)

// rayMulHalfUp is WadRayMath.rayMul: c = (a×b + RAY/2) / RAY — the SAME
// half-up rounding the deployed token math applies, replicated on the same
// inputs at the same pin so the §3.4(b) live-value identity is
// deterministic with a ZERO bound (the contract does the compounding; we do
// one multiplication).
func rayMulHalfUp(a, b *big.Int) *big.Int {
	out := new(big.Int).Mul(a, b)
	out.Add(out, halfRay)
	return out.Quo(out, rayUnit)
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
	// Live-value identity (§3.4(b), debt side only): rayMulHalfUp(derived,
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
	c := rayMulHalfUp(derivedScaled, normalizedDebt)
	if c.Cmp(chainBalance) == 0 {
		return c.String(), verdictExact
	}
	return c.String(), verdictDrift
}

// aaveWeldRow is one reserve's F1 census weld: Σ derived scaled (ALL
// accounts) vs scaledTotalSupply() @ pinHash(P_eth). Debt side GATED, zero
// bound (mint/burn move user scaled and total by the same rayDiv result;
// BalanceTransfer conserves; the DeficitCreated burn is included).
// Collateral (aToken) side ADVISORY on this first run per the amendment —
// the treasury-accrual account must be present in the derived Σ; the
// deriver folds Mint for any account, so exactness is expected — promoted
// to gated after one clean run.
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
// scaledTotalSupply read did not succeed becomes a weld-unread row (gated
// on the debt side, like every other weld row of that side) — never a
// silently absent row, never a fake zero.
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
		rows = append(rows, row)
	}
	return rows
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
