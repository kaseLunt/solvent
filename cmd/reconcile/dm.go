// Debt Manager comparison semantics (brief §3.3, §3.5, §3.6; risk-quant
// amendment F1/F2/F6). Everything in this file that decides a verdict is a
// PURE function over already-fetched values, so the exact comparison and
// classification arithmetic is unit-tested and mutation-killable without a
// database or an endpoint.
package main

import (
	"fmt"
	"math/big"
	"sort"

	"github.com/ethereum/go-ethereum/common"

	"github.com/kaselunt/solvent/cmd/reconcile/snapshotdb"
	"github.com/kaselunt/solvent/internal/store"
)

// dmEngine aliases the snapshot package's constant so the two packages
// cannot drift on the engine name.
const dmEngine = snapshotdb.DMEngine

var wad = new(big.Int).Exp(big.NewInt(10), big.NewInt(18), nil) // 1e18

// hundredE18 is the contract's HUNDRED_PERCENT denominator (100e18) in the
// index accrual recurrence (DebtManagerStorageContract.sol:559-567).
var hundredE18 = new(big.Int).Mul(big.NewInt(100), wad)

func bigZero() *big.Int { return new(big.Int) }

// mulDivFloor is the §3.3 bridge: floor(n × index / 1e18) — EXACTLY
// DebtManagerStorageContract.sol:520-522 (_getActualBorrowAmount) on
// big.Int. Floor, never round, never ceil: the contract's own view rounds
// down, and a ceil here would manufacture 1-wei drift on every row.
//
// Injectivity sentence (recorded verbatim in the artifact): floor(n·I/1e18)
// is injective in n for I ≥ 1e18 (always true — the index starts at 1e18
// and accrues), so USD-level equality ⟺ normalized equality; using the
// contract's own index at P is not circular.
func mulDivFloor(n, index *big.Int) *big.Int {
	out := new(big.Int).Mul(n, index)
	return out.Quo(out, wad)
}

// dmVerdict values for one comparison leg.
const (
	verdictExact = "exact"
	verdictDrift = "drift"
)

// Drift classification labels (§3.5 + F2 + F6). EVERY class still fails
// (exit 1) — classification is diagnosis, never tolerance.
const (
	classResidueShaped     = "residue-shaped"
	classMissingGenesis    = "missing-genesis"
	classIndexClass        = "index-class"
	classInternalInconsist = "internal_inconsistency"
	classStableSnapSuspect = "stable-snap-suspect"
	classUnclassified      = "unclassified"
)

// dmTokenComparison is one (account, token) leg of a DM row.
type dmTokenComparison struct {
	TokenHex       string `json:"token"`
	DerivedNet     string `json:"derived_net_normalized"`
	Index          string `json:"index_at_pin"`
	BridgedUSD     string `json:"bridged_usd"` // floor(net × index / 1e18)
	ChainUSD       string `json:"chain_usd"`   // borrowingOf array amount (absent token ⇒ "0")
	Verdict        string `json:"verdict"`
	Classification string `json:"classification,omitempty"`
}

// dmRowResult is one sampled account's full §3.3 comparison.
type dmRowResult struct {
	AccountHex     string              `json:"account"`
	Stratum        string              `json:"stratum"`
	Forced         bool                `json:"forced,omitempty"`
	Source         string              `json:"source"`
	Live           bool                `json:"live"`
	Tokens         []dmTokenComparison `json:"tokens"`
	SetEqual       bool                `json:"token_set_equal"`
	SetOnlyDB      []string            `json:"tokens_only_in_db,omitempty"`
	SetOnlyChain   []string            `json:"tokens_only_on_chain,omitempty"`
	SumEqualsTotal bool                `json:"per_token_sum_equals_total"`
	ChainTotal     string              `json:"chain_total_usd"`
	Verdict        string              `json:"verdict"`
	Endpoints      []int               `json:"endpoints_consulted"`
	SecondOpinion  string              `json:"second_opinion,omitempty"`
}

// compareDMRow evaluates one account: token-set equality with pinned
// zero-trim semantics (§3.3 / L2-7 — the contract assembly-trims the
// returned array to NONZERO tokens; the DB side is zero-filtered too,
// because amount-0 rows persist for closed positions), per-token bridged
// equality, and Σ per-token == total.
//
// Set bridge justification (recorded): n > 0 ⟺ floor(n·I/1e18) > 0 for
// I ≥ 1e18, so the nonzero-token SETS must agree exactly, in both
// directions — a token only in the DB is phantom debt; a token only on
// chain is a derivation miss.
//
// derivedNet: per-token as-of net normalized sums (MAY include zero and
// negative entries — zero entries are filtered here, matching the trim).
// chainTokens: the borrowingOf(address) array. indexes: getCurrentIndex@P
// per token (must cover the union of nonzero DB tokens and chain tokens).
func compareDMRow(account string, derivedNet map[common.Address]*big.Int, chainTokens []tokenAmount, chainTotal *big.Int, indexes map[common.Address]*big.Int) dmRowResult {
	row := dmRowResult{AccountHex: account, SetEqual: true, SumEqualsTotal: true, Verdict: verdictExact}

	chainByToken := map[common.Address]*big.Int{}
	for _, t := range chainTokens {
		chainByToken[t.Token] = t.Amount
	}

	// Union of nonzero DB tokens and chain tokens, deterministic order.
	union := map[common.Address]bool{}
	for tok, n := range derivedNet {
		if n.Sign() != 0 {
			union[tok] = true
		}
	}
	for tok := range chainByToken {
		union[tok] = true
	}
	tokens := make([]common.Address, 0, len(union))
	for tok := range union {
		tokens = append(tokens, tok)
	}
	sort.Slice(tokens, func(i, j int) bool { return tokens[i].Hex() < tokens[j].Hex() })

	sum := new(big.Int)
	for _, tok := range tokens {
		n := derivedNet[tok]
		if n == nil {
			n = bigZero()
		}
		chainAmt, onChain := chainByToken[tok]
		if !onChain {
			chainAmt = bigZero()
		}
		inDB := n.Sign() != 0
		if inDB && !onChain {
			row.SetEqual = false
			row.SetOnlyDB = append(row.SetOnlyDB, tok.Hex())
		}
		if onChain && !inDB {
			row.SetEqual = false
			row.SetOnlyChain = append(row.SetOnlyChain, tok.Hex())
		}
		idx := indexes[tok]
		cmp := dmTokenComparison{
			TokenHex:   tok.Hex(),
			DerivedNet: n.String(),
			ChainUSD:   chainAmt.String(),
		}
		if idx == nil {
			// No index fetched for a token in the union — a harness gap,
			// surfaced as drift (never silently exact).
			cmp.Index = "(missing)"
			cmp.BridgedUSD = "(unavailable)"
			cmp.Verdict = verdictDrift
		} else {
			bridged := mulDivFloor(n, idx)
			cmp.Index = idx.String()
			cmp.BridgedUSD = bridged.String()
			if bridged.Cmp(chainAmt) == 0 {
				cmp.Verdict = verdictExact
			} else {
				cmp.Verdict = verdictDrift
			}
		}
		if onChain {
			sum.Add(sum, chainAmt)
		}
		row.Tokens = append(row.Tokens, cmp)
	}
	if chainTotal != nil {
		row.ChainTotal = chainTotal.String()
		if sum.Cmp(chainTotal) != 0 {
			row.SumEqualsTotal = false
		}
	}
	if !row.SetEqual || !row.SumEqualsTotal {
		row.Verdict = verdictDrift
	}
	for _, t := range row.Tokens {
		if t.Verdict != verdictExact {
			row.Verdict = verdictDrift
		}
	}
	return row
}

// residueShaped is the F2 EXACT hypothesis test, replacing the deleted
// two-sided ±1-wei allowance (risk-quant F2: the silent residue-zeroing
// mechanism — DebtManagerCore.sol:550-553 — is one-directional and
// surfaces as 1–2 USD-wei, so an epsilon is both too wide and wrong-plane).
// A discrepancy is residue-shaped iff:
//
//	(i)   the account is fully liquidated (liquidation history, net-zero on
//	      chain semantics — the caller passes the stratum fact),
//	(ii)  NO residue_zeroed event exists for this exact (account, token) —
//	      if one exists the deriver already modeled the zeroing and the
//	      drift is something else, and
//	(iii) floor((n_derived − 1) × I / 1e18) == chain amount BIT-EXACTLY —
//	      the hypothesis "the contract zeroed one normalized wei the deriver
//	      kept", tested through the same bridge.
//
// Direction is structurally derived-high-only (n_derived − 1, never +1);
// injectivity makes the test unambiguous; no tunable value exists. The
// classification is DIAGNOSIS — a residue-shaped row still fails (exit 1).
func residueShaped(fullyLiquidated, hasResidueEvent bool, nDerived, index, chainAmount *big.Int) bool {
	if !fullyLiquidated || hasResidueEvent {
		return false
	}
	if nDerived == nil || index == nil || chainAmount == nil || nDerived.Sign() <= 0 {
		return false
	}
	adjusted := new(big.Int).Sub(nDerived, big.NewInt(1))
	return mulDivFloor(adjusted, index).Cmp(chainAmount) == 0
}

// classifyDMMismatch labels one drifted (account, token) leg for diagnosis.
// Order is most-specific-first; EVERY label fails the run.
//
//   - residue-shaped: the F2 exact test above.
//   - missing-genesis: the DB never derived anything for the account+token
//     (net == 0, no events counted) while the chain carries debt — the shape
//     of a missed migration_genesis seeding.
//   - index-class: the DB's LATEST PERSISTED borrow_index (≤ P) reproduces
//     the chain amount where getCurrentIndex@P does not — an index-sourcing
//     or accrual problem, not balance drift (kept distinct so §3.6's verdict
//     class separation carries into per-row diagnosis).
//   - stable-snap-suspect (F6): the account has borrow events whose USD was
//     reconstructed under the stable 1e6 snap; an out-of-band borrow (snap
//     band broken at emit time) surfaces exactly as unexplained drift.
//     Detection limit, stated: this is a HYPOTHESIS label — the deriver's
//     stamp proves which conversion was used, not that the band held.
//   - unclassified: none of the above.
func classifyDMMismatch(fullyLiquidated, hasResidueEvent bool, nDerived, currentIndex, chainAmount, dbLatestIndex *big.Int, hadAnyDerivedEvents bool, stableSnapBorrows int64) string {
	if residueShaped(fullyLiquidated, hasResidueEvent, nDerived, currentIndex, chainAmount) {
		return classResidueShaped
	}
	if !hadAnyDerivedEvents && (nDerived == nil || nDerived.Sign() == 0) && chainAmount != nil && chainAmount.Sign() > 0 {
		return classMissingGenesis
	}
	if dbLatestIndex != nil && nDerived != nil && chainAmount != nil &&
		mulDivFloor(nDerived, dbLatestIndex).Cmp(chainAmount) == 0 {
		return classIndexClass
	}
	if stableSnapBorrows > 0 {
		return classStableSnapSuspect
	}
	return classUnclassified
}

// --- F1 aggregate completeness weld (BLOCKING amendment) -------------------

// dmWeldRow is one borrow token's census weld: Σ over ALL accounts of
// derived net normalized (≤ P) vs borrowTokenConfig(t)
// .totalNormalizedBorrowingAmount @ pinHash(P). NORMALIZED space — no
// bridge, no floor, ZERO bound: every contract mutation moves the total and
// the per-user map by the same integer (DebtManagerCore.sol:472-473, :599,
// :579-580, :551-552), so a phantom borrower makes derived-Σ < total by
// exactly their normalized debt.
type dmWeldRow struct {
	TokenHex       string `json:"token"`
	DerivedSum     string `json:"derived_sum_all_accounts"`
	ChainTotal     string `json:"chain_total_normalized"`
	SampleCoverage string `json:"sample_sum_for_coverage"` // diagnostic only
	Verdict        string `json:"verdict"`                 // exact | aggregate-mismatch | weld-unread
	Note           string `json:"note,omitempty"`
	ReadError      string `json:"read_error,omitempty"` // weld-unread rows: WHY the chain leg is unread
}

const verdictAggregateMismatch = "aggregate-mismatch"

// verdictWeldUnread (round-10 F3): a weld-universe token whose chain-side
// read did not succeed or did not decode. Read-presence is a FIRST-CLASS
// per-token fact, separate from numeric zero: an unread leg is a GATED
// failure row (exit 1), never a silently absent row and never a zero — so
// the F1 empty-state completeness requirement holds even under ABI skew or
// pinned-call reverts.
const verdictWeldUnread = "weld-unread"

// chainRead is the read-presence fact for one weld leg: OK=true carries the
// decoded total; OK=false carries WHY the read failed. The absence of an
// entry means the caller never even attempted the read — weldDMAggregate /
// weldAaveAggregate treat both identically as weld-unread.
type chainRead struct {
	Total *big.Int
	OK    bool
	Note  string
}

// dmWeldNote is the NAMED unpinned leg (risk-quant F1): the migration-era
// implementation's total seeding is not in the contract clone, so a nonzero
// weld delta is class aggregate-mismatch, exit 1, and an adjudication of the
// migration set-vs-add/total-lockstep semantics — never absorbed.
const dmWeldNote = "migration-era total seeding is the one unpinned leg: the replaced implementation that executed MigrationBorrowerPositionsSet is not in the verified clone, so lockstep between the seeded per-user map and totalNormalizedBorrowingAmount is asserted here, not proven from source; a nonzero delta is an adjudication finding, never absorbed"

// dmWeldInputs carries the weld's derived side. All is the ALL-ACCOUNTS
// census (store.AssetNetSums — no account filter exists in that query);
// SampleTotals is the sampled subset's per-token sum, recorded purely as a
// coverage diagnostic so a reviewer sees how much of each total the
// per-account gates touched.
type dmWeldInputs struct {
	All          []store.AssetNetSum
	SampleTotals map[string]*big.Int
}

// assetNetSumsFromSample aggregates the SAMPLED accounts' as-of sums per
// asset — the coverage diagnostic's numerator. It is NEVER the weld's
// derived side: substituting it there recreates exactly the census blindness
// F1 blocks (sampling universe = position_events = already-derived accounts),
// and TestComputeDMWeldInputsCoversAllAccounts kills that substitution.
func assetNetSumsFromSample(sums []store.AsOfSum) map[string]*big.Int {
	out := map[string]*big.Int{}
	for _, s := range sums {
		if s.Side != "debt" || len(s.Asset) == 0 {
			continue
		}
		key := fmt.Sprintf("%x", s.Asset)
		if out[key] == nil {
			out[key] = new(big.Int)
		}
		out[key].Add(out[key], s.Total)
	}
	return out
}

// weldDMAggregate compares the all-accounts derived sums with the chain
// reads per token over the AUTHORITATIVE universe (round-10 F3): the
// explicit union of the getBorrowTokens(@pin) ∪ derived-assets list the
// caller iterated (universe) with both fact sets' keys — so no token can
// vanish from the weld under any combination of missing derived rows,
// missing reads, or caller misassembly. A universe token whose chain read
// is absent or not OK becomes a GATED weld-unread row: read-presence is a
// first-class fact, never conflated with numeric zero.
func weldDMAggregate(inputs dmWeldInputs, universe []common.Address, reads map[common.Address]chainRead) []dmWeldRow {
	derived := map[common.Address]*big.Int{}
	for _, s := range inputs.All {
		derived[common.BytesToAddress(s.Asset)] = s.Total
	}
	union := map[common.Address]bool{}
	for _, tok := range universe {
		union[tok] = true
	}
	for tok := range derived {
		union[tok] = true
	}
	for tok := range reads {
		union[tok] = true
	}
	tokens := make([]common.Address, 0, len(union))
	for tok := range union {
		tokens = append(tokens, tok)
	}
	sort.Slice(tokens, func(i, j int) bool { return tokens[i].Hex() < tokens[j].Hex() })

	var rows []dmWeldRow
	for _, tok := range tokens {
		d := derived[tok]
		if d == nil {
			d = bigZero()
		}
		row := dmWeldRow{
			TokenHex:   tok.Hex(),
			DerivedSum: d.String(),
			Note:       dmWeldNote,
		}
		if cov := inputs.SampleTotals[fmt.Sprintf("%x", tok.Bytes())]; cov != nil {
			row.SampleCoverage = cov.String()
		} else {
			row.SampleCoverage = "0"
		}
		read, present := reads[tok]
		switch {
		case !present:
			row.ChainTotal = "(unread)"
			row.Verdict = verdictWeldUnread
			row.ReadError = "no borrowTokenConfig read was recorded for this universe token"
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

// buildDMWeldReads converts the borrowTokenConfig leg of the phase-2
// multicall into first-class read-presence facts (round-10 F3): EVERY weld
// universe token gets an entry; an unsuccessful (reverted) or undecodable
// (ABI-skew) result becomes an OK=false fact — never dropped, never zero.
func buildDMWeldReads(weldList []common.Address, results []multicallResult, offset int) map[common.Address]chainRead {
	reads := map[common.Address]chainRead{}
	for i, t := range weldList {
		res := results[offset+i]
		if !res.Success {
			reads[t] = chainRead{Note: "borrowTokenConfig unsuccessful (reverted) at the pin"}
			continue
		}
		cfg, err := unpackBorrowTokenConfig(res.ReturnData)
		if err != nil {
			reads[t] = chainRead{Note: "borrowTokenConfig undecodable at the pin (ABI skew): " + err.Error()}
			continue
		}
		reads[t] = chainRead{Total: cfg.TotalNormalizedBorrowingAmount, OK: true}
	}
	return reads
}

// --- §3.6 index-integrity check (separate verdict class) -------------------

// indexCheckRow is one borrow token's index-integrity verdict. The verdict
// class is SEPARATE (index_integrity) so its failure is never conflated
// with balance drift (judge graft 6).
type indexCheckRow struct {
	TokenHex   string `json:"token"`
	Verdict    string `json:"verdict"` // exact | mismatch | no-iiu-history | unrunnable-missing-apy
	IdxBase    string `json:"idx_base,omitempty"`
	BaseBlock  uint64 `json:"base_block,omitempty"`
	APY        string `json:"apy,omitempty"`
	APYSource  string `json:"apy_source,omitempty"`
	APYBlock   uint64 `json:"apy_block,omitempty"`
	DTSeconds  uint64 `json:"dt_seconds,omitempty"`
	Recomputed string `json:"idx_recomputed,omitempty"`
	Chain      string `json:"idx_chain,omitempty"`
	Gated      bool   `json:"gated"`
	Note       string `json:"note,omitempty"`
}

const (
	verdictIndexMismatch = "mismatch"
	verdictNoIIUHistory  = "no-iiu-history"
	verdictMissingAPY    = "unrunnable-missing-apy"
)

// recomputeIndex is the §3.6 recurrence: idx_rec = idx_b + floor(idx_b × apy
// × dt / 100e18) — one mulDiv with floor (default) rounding, exactly
// DebtManagerStorageContract.sol:559-567. dt = HeaderTime(P) − HeaderTime(b);
// lastUpdateTimestamp IS the header time of the IIU block (:546), so the
// header-time difference is exact.
func recomputeIndex(idxBase, apy *big.Int, dtSeconds uint64) *big.Int {
	accrual := new(big.Int).Mul(idxBase, apy)
	accrual.Mul(accrual, new(big.Int).SetUint64(dtSeconds))
	accrual.Quo(accrual, hundredE18)
	return accrual.Add(accrual, idxBase)
}

// evaluateIndexCheck decides one token's row. hasSampledDebt scopes the
// missing-APY escalation: config events ARE persisted, so a token carrying
// nonzero sampled debt with no APY observation is a derivation gap (gated
// fail); a token with no IIU history at all gets no-iiu-history — the check
// does not exist for it, and SAYS so (never a vacuous pass).
func evaluateIndexCheck(tokenHex string, idxBase *big.Int, baseBlock uint64, apy *store.APYObservation, dtSeconds uint64, chainIndex *big.Int, hasSampledDebt bool) indexCheckRow {
	row := indexCheckRow{TokenHex: tokenHex}
	if idxBase == nil {
		row.Verdict = verdictNoIIUHistory
		row.Gated = false
		row.Note = "no rate_indexes(kind='borrow_index') history for this token — the recurrence check does not exist for it (7 of 8 borrow tokens have no IIU rows; IIU fires only on mutating blocks)"
		return row
	}
	row.IdxBase = idxBase.String()
	row.BaseBlock = baseBlock
	if apy == nil {
		if hasSampledDebt {
			row.Verdict = verdictMissingAPY
			row.Gated = true
			row.Note = "token has nonzero sampled debt but no persisted APY observation ≤ P (borrow_apy_set / borrow_token_config_set payloads) — config events are persisted, so absence is a derivation gap"
			return row
		}
		row.Verdict = verdictNoIIUHistory
		row.Gated = false
		row.Note = "IIU history exists but no APY observation and no sampled debt — not runnable, not gated"
		return row
	}
	row.APY = apy.Value.String()
	row.APYSource = apy.Source
	row.APYBlock = apy.Block
	row.DTSeconds = dtSeconds
	rec := recomputeIndex(idxBase, apy.Value, dtSeconds)
	row.Recomputed = rec.String()
	row.Chain = chainIndex.String()
	row.Gated = true
	if rec.Cmp(chainIndex) == 0 {
		row.Verdict = verdictExact
	} else {
		row.Verdict = verdictIndexMismatch
	}
	return row
}
