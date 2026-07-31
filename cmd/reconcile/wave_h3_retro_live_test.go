// The Wave-H3 RETROACTIVE CLASSIFICATION — the empirical half of the
// boolean-leg ruling: the two accept-r5 liquidatable false positives,
// re-adjudicated under the adjudicated three-state law by running the NEW
// conjunct reads live at the accept-r5 pins (both deep-finalized,
// hash-anchored — the same experiment completed).
//
// ARTIFACT-BOUND SINCE WAVE H4a (Codex F3 — the previous version hardcoded
// the accounts and every expected value "verbatim from accept-r5", which a
// transcription from the wrong artifact, or two cherry-picked accounts, would
// have satisfied). The test now:
//
//   - LOADS the retained accept-r5 artifact (SOLVENT_ACCEPT_R5_ARTIFACT →
//     the aborted run's drift-report.json, preserved to scratch
//     accept-r5-aborted/ per the transport-retry doctrine);
//   - RECOMPUTES the comparison digest from the supplied bytes under the
//     canonical hash-scope/redaction law (comparisonHash, artifact.go — the
//     H2 recompute bar, parseAcceptR4ArtifactAgainst's law reused) and
//     requires recomputed == embedded == the RECORDED accept-r5 digest;
//   - verifies both run pins against the recorded accept-r5 pins;
//   - extracts EXACTLY the boolean-drift subject rows — exactly 2, unique;
//     duplicates, truncation and padding all refuse — plus each subject's
//     companion getMaxBorrowAmount (sample-gap) and borrowingOf (exact) legs;
//   - derives EVERY expected value from those digest-bound rows: the served
//     and chain booleans, the margin, S(account) and its own_clock_hash, the
//     chain and mixed maxBorrow values at P, and the welded debt at P.
//
// STATUS, stated honestly: the retained artifact's status is "aborted:
// recheck". Status sits OUTSIDE the artifact's hash scope
// (hash_scope.sections — comparisonHash binds pins/rows/summary, not status),
// so the parser does not gate on it: the digest is what makes the rows the
// accept-r5 rows, and an aborted run's rows are exactly the evidence under
// re-adjudication. The H2 parser has no status bar either, so nothing is
// being relaxed here.
//
// Per account, ALL of:
//
//	(i)   the sample-gap certificate re-proven: the persisted vector at
//	      S(account) recovered from the snapshots HISTORY table (ApplySweepBatch
//	      wrote it atomically with the balances; the sweeper has long re-swept
//	      the live rows), byte-compared against collateralOf@blockHash(S), and
//	      the scalar law recompute bit-exact at S;
//	(ii)  debt exact at pin: our fold@P bridged through getCurrentIndex@P welds
//	      borrowingOf(user).total@pinHash, and reproduces the artifact's number;
//	(iii) the S-CLOCK BOOLEAN CUSTODY WELD: ComputeDMHealth over ALL inputs at
//	      S (Stage-A-shaped debt fold at S bridged through getCurrentIndex@S,
//	      the persisted vector, params folded from the RAW config ledger cut at
//	      S — the Wave-H4a F4 law, never the collapsed pin view filtered —
//	      engine prices @S) welded bit-exact against liquidatable(user)@blockHash(S);
//	(iv)  the Law@P PIN-VECTOR SUBSTITUTION: collateralOf(user)@pinHash — the
//	      chain's own enumerated netted vector — with the scalar AND boolean
//	      recomputed over it (pinned prices/params/decimals, welded debt@P)
//	      welding getMaxBorrowAmount@P and liquidatable@P bit-exact, and the
//	      per-token LT-weighted delta reconciling to the flip;
//	(v)   the sweep age inside the run's own resolved freshness bound
//	      (3h4m34s, the daemon-cadence policy bound the run ledger records).
//
// The test then feeds the assembled facts to classifyDMBoolean — the SAME
// pure classifier the gate runs — and requires boundary-crossing-motion for
// BOTH accounts, in the artifact's own direction. Any conjunct failing fails
// this test loudly, naming the account and the conjunct: that outcome would
// mean the accept-r5 rows were REAL drift and the ruling's empirical premise
// is wrong.
//
// Opt-in: SOLVENT_H3_RETRO=1, SOLVENT_ACCEPT_R5_ARTIFACT, SOLVENT_RECON_RPC_OP
// (or SOLVENT_RPC_OP), and the repo config's database (STRICTLY read-only
// DSN, exactly as reconcile derives it). ~15 archive calls per account, all
// hash-anchored.
package main

import (
	"context"
	"encoding/json"
	"fmt"
	"math/big"
	"os"
	"sort"
	"strings"
	"testing"
	"time"

	"github.com/ethereum/go-ethereum/common"
	"github.com/jackc/pgx/v5"
	"github.com/stretchr/testify/require"

	"github.com/kaselunt/solvent/cmd/reconcile/snapshotdb"
	"github.com/kaselunt/solvent/internal/risk"
	"github.com/kaselunt/solvent/internal/riskfeed"
)

// The accept-r5 (aborted, retained, superseded) run's recorded identity: the
// pins and the comparison digest from the run ledger. Everything ELSE the
// test asserts is derived from the artifact those constants identify.
const (
	h3RetroPinOP   = uint64(154963224)
	h3RetroHashOP  = "0x5c6be10c38b31e7b2f70a0b7681d83e3cc5a7c80727027bac64e316658528aeb"
	h3RetroPinETH  = uint64(25654850)
	h3RetroHashETH = "0x38a216741d3753e7f80a4f318210d6ed85aa35ef9dc1540541b3659cda2a3812"
	// h3RetroComparisonSHA is the aborted run's own comparison_sha256 as the
	// ledger recorded it — the identity bar the recomputed digest must equal.
	h3RetroComparisonSHA = "4fb7b0ac6a88eb7e5f44b04082f59267031f95dc35a6ec3c7c6188d0d06eaae2"
	h3RetroArtifactEnv   = "SOLVENT_ACCEPT_R5_ARTIFACT"
	// h3RetroSubjectCount: the accept-r5 boolean-drift population is exactly
	// two accounts. The parser requires equality — never nonemptiness — so a
	// truncated or padded artifact refuses (the H2 completeness bar).
	h3RetroSubjectCount = 2
	// h3RetroBudgetSeconds is the run's resolved freshness bound, 3h4m34s
	// (2*(interval+last_pass), the daemon-cadence policy). It stays a
	// committed constant rather than an artifact-derived value BECAUSE the
	// artifact's freshness section sits OUTSIDE the hash scope — a value the
	// digest does not bind cannot honestly be called artifact-bound, and the
	// classifier's budget conjunct deserves an input with stated provenance
	// (the run ledger) over one with fabricated provenance.
	h3RetroBudgetSeconds = int64(3*3600 + 4*60 + 34)
)

// h3RetroSubject is one boolean-drift subject with every expected value
// DERIVED from the digest-bound artifact rows.
type h3RetroSubject struct {
	addr      string
	servedLiq bool   // the boolean row's actual_derived — the served mixed verdict
	chainLiq  bool   // the boolean row's expected_chain — liquidatable(user)@P
	margin    string // the boolean row's margin_usd6 evidence, USD-6
	sweep     uint64 // S(account): the maxBorrow row's sweep_block evidence
	sweepHex  string // own_clock_hash from the same evidence
	chainMax  string // maxBorrow expected_chain: getMaxBorrowAmount@P (chain)
	oursMax   string // maxBorrow actual_derived: our mixed recompute @P over the S vector
	debtPin   string // borrowingOf.total@P == our bridged fold (welded exact)
}

// parseAcceptR5RetroSubjects binds the retro test to the retained accept-r5
// artifact under the H2 bars: digest recomputed from the bytes (never
// self-reported), pins verified, the boolean-drift subject set complete and
// unique, every expected value read out of the digest-bound rows.
func parseAcceptR5RetroSubjects(raw []byte) ([]h3RetroSubject, error) {
	return parseAcceptR5RetroSubjectsAgainst(raw, h3RetroComparisonSHA)
}

// parseAcceptR5RetroSubjectsAgainst carries the bars with the expected digest
// parameterized so each bar stays unit-testable on synthetic fixtures sealed
// with their OWN recomputed digest (the sealDoc pattern). The live path
// always pins wantSHA to the accept-r5 record.
func parseAcceptR5RetroSubjectsAgainst(raw []byte, wantSHA string) ([]h3RetroSubject, error) {
	var doc struct {
		ComparisonSHA256 string `json:"comparison_sha256"`
		Pins             []struct {
			Block uint64 `json:"block"`
			Chain string `json:"chain"`
			Hash  string `json:"hash"`
		} `json:"pins"`
		P3 struct {
			Rows []struct {
				Gate     string            `json:"gate"`
				Subject  string            `json:"subject"`
				Leg      string            `json:"leg"`
				Verdict  string            `json:"verdict"`
				Expected string            `json:"expected_chain"`
				Actual   string            `json:"actual_derived"`
				Evidence map[string]string `json:"evidence"`
			} `json:"rows"`
		} `json:"p3_task6"`
	}
	if err := json.Unmarshal(raw, &doc); err != nil {
		return nil, fmt.Errorf("the artifact does not parse: %w", err)
	}
	// Bar (a1), the H2 recompute law: the digest is RECOMPUTED from the
	// supplied bytes under the canonical hash-scope/redaction law — never
	// trusted from the artifact's own self-report. A substitute document that
	// copies the digest string while changing any scoped row recomputes to a
	// different hash and refuses here.
	var report driftReport
	if err := json.Unmarshal(raw, &report); err != nil {
		return nil, fmt.Errorf("the artifact does not parse as a drift report: %w", err)
	}
	recomputed, err := comparisonHash(&report)
	if err != nil {
		return nil, fmt.Errorf("recomputing the comparison hash over the supplied artifact: %w", err)
	}
	if recomputed != doc.ComparisonSHA256 {
		return nil, fmt.Errorf("ARTIFACT IDENTITY failed: recomputed comparison hash %q != embedded %q — the artifact's rows are not the bytes its digest claims",
			recomputed, doc.ComparisonSHA256)
	}
	// Bar (a2): it is THE artifact — the (now proven-embedded) digest must be
	// the recorded accept-r5 comparison hash.
	if doc.ComparisonSHA256 != wantSHA {
		return nil, fmt.Errorf("ARTIFACT IDENTITY failed: comparison_sha256 %q is not the accept-r5 record %q — the retro classification is judged against the aborted run's own artifact, never a substitute",
			doc.ComparisonSHA256, wantSHA)
	}
	opOK, ethOK := false, false
	for _, p := range doc.Pins {
		switch p.Chain {
		case "op":
			if p.Block != h3RetroPinOP || !strings.EqualFold(p.Hash, h3RetroHashOP) {
				return nil, fmt.Errorf("ARTIFACT IDENTITY failed: op pin %d/%s is not the accept-r5 pin %d/%s", p.Block, p.Hash, h3RetroPinOP, h3RetroHashOP)
			}
			opOK = true
		case "eth":
			if p.Block != h3RetroPinETH || !strings.EqualFold(p.Hash, h3RetroHashETH) {
				return nil, fmt.Errorf("ARTIFACT IDENTITY failed: eth pin %d/%s is not the accept-r5 pin %d/%s", p.Block, p.Hash, h3RetroPinETH, h3RetroHashETH)
			}
			ethOK = true
		}
	}
	if !opOK || !ethOK {
		return nil, fmt.Errorf("ARTIFACT IDENTITY failed: the artifact does not carry both accept-r5 pins (op present=%v, eth present=%v)", opOK, ethOK)
	}

	// The boolean-drift subject set: exactly h3RetroSubjectCount unique rows.
	parseBool := func(s string) (bool, error) {
		switch s {
		case "true":
			return true, nil
		case "false":
			return false, nil
		}
		return false, fmt.Errorf("%q is not a boolean literal", s)
	}
	subjByKey := map[string]*h3RetroSubject{}
	var order []string
	for _, r := range doc.P3.Rows {
		if r.Gate != gateDMBoolean || r.Leg != "liquidatable(strict >)" || r.Verdict != verdictDrift {
			continue
		}
		key := hexLower(r.Subject)
		if _, dup := subjByKey[key]; dup {
			return nil, fmt.Errorf("duplicate boolean-drift subject %s — the artifact is not the accept-r5 row set", r.Subject)
		}
		served, errA := parseBool(r.Actual)
		chain, errE := parseBool(r.Expected)
		if errA != nil || errE != nil {
			return nil, fmt.Errorf("boolean-drift row %s carries non-boolean values (%q vs %q)", r.Subject, r.Expected, r.Actual)
		}
		if served == chain {
			return nil, fmt.Errorf("boolean-drift row %s claims verdict=drift with EQUAL booleans %v — not a flip, not an accept-r5 subject", r.Subject, served)
		}
		margin, ok := new(big.Int).SetString(r.Evidence["margin_usd6"], 10)
		if !ok || margin.Sign() <= 0 {
			return nil, fmt.Errorf("boolean-drift row %s carries no positive margin_usd6 evidence (%q)", r.Subject, r.Evidence["margin_usd6"])
		}
		subjByKey[key] = &h3RetroSubject{addr: r.Subject, servedLiq: served, chainLiq: chain, margin: margin.String()}
		order = append(order, key)
	}
	if len(order) != h3RetroSubjectCount {
		return nil, fmt.Errorf("COMPLETENESS failed: %d unique boolean-drift subject(s), want exactly %d — a truncated or padded artifact must not carry the retro classification", len(order), h3RetroSubjectCount)
	}

	// The companion legs, one each per subject: the sample-gap maxBorrow row
	// (S, own_clock_hash, chain@P, mixed@P) and the exact borrowingOf row
	// (welded debt@P).
	seenMax, seenDebt := map[string]bool{}, map[string]bool{}
	for _, r := range doc.P3.Rows {
		if r.Gate != gateDMBoolean {
			continue
		}
		key := hexLower(r.Subject)
		sub := subjByKey[key]
		if sub == nil {
			continue
		}
		switch r.Leg {
		case "getMaxBorrowAmount(user,false)":
			if seenMax[key] {
				return nil, fmt.Errorf("duplicate getMaxBorrowAmount row for subject %s", r.Subject)
			}
			seenMax[key] = true
			if r.Verdict != verdictSampleGap {
				return nil, fmt.Errorf("subject %s's maxBorrow leg is %q, not %s — the artifact itself does not carry the sample-gap certificate the motion premise needs", r.Subject, r.Verdict, verdictSampleGap)
			}
			cm, ok1 := new(big.Int).SetString(r.Expected, 10)
			om, ok2 := new(big.Int).SetString(r.Actual, 10)
			if !ok1 || !ok2 {
				return nil, fmt.Errorf("subject %s's maxBorrow row carries non-integer values (%q vs %q)", r.Subject, r.Expected, r.Actual)
			}
			if cm.Cmp(om) == 0 {
				return nil, fmt.Errorf("subject %s's maxBorrow row shows EQUAL pin values %s — no pin delta, no flip to explain", r.Subject, cm)
			}
			var sweep uint64
			if _, err := fmt.Sscanf(r.Evidence["sweep_block"], "%d", &sweep); err != nil || sweep == 0 {
				return nil, fmt.Errorf("subject %s's maxBorrow row carries no usable sweep_block evidence (%q)", r.Subject, r.Evidence["sweep_block"])
			}
			hash := r.Evidence["own_clock_hash"]
			if len(hash) != 66 || !strings.HasPrefix(hash, "0x") {
				return nil, fmt.Errorf("subject %s's maxBorrow row carries no usable own_clock_hash evidence (%q)", r.Subject, hash)
			}
			sub.chainMax, sub.oursMax = cm.String(), om.String()
			sub.sweep, sub.sweepHex = sweep, hash
		case "borrowingOf(user).total":
			if seenDebt[key] {
				return nil, fmt.Errorf("duplicate borrowingOf row for subject %s", r.Subject)
			}
			seenDebt[key] = true
			if r.Verdict != verdictExact || r.Expected != r.Actual {
				return nil, fmt.Errorf("subject %s's borrowingOf leg is not the exact weld the debt conjunct needs (verdict %q, %q vs %q)", r.Subject, r.Verdict, r.Expected, r.Actual)
			}
			if _, ok := new(big.Int).SetString(r.Expected, 10); !ok {
				return nil, fmt.Errorf("subject %s's borrowingOf row carries a non-integer value %q", r.Subject, r.Expected)
			}
			sub.debtPin = r.Expected
		}
	}
	sort.Strings(order)
	out := make([]h3RetroSubject, 0, len(order))
	for _, key := range order {
		sub := subjByKey[key]
		if !seenMax[key] || !seenDebt[key] {
			return nil, fmt.Errorf("subject %s is missing a companion leg (maxBorrow present=%v, borrowingOf present=%v) — every expected value must come from the artifact", sub.addr, seenMax[key], seenDebt[key])
		}
		out = append(out, *sub)
	}
	return out, nil
}

// h3RetroDMParamLedger reads the FULL raw DM config ledger prefix at the pin
// with the SAME SQL shape Stage A collects it (snapshotdb's
// collectDMParamLedger): the Wave-H4a F4 law — every S-clock fold comes from
// the raw ledger cut at S, never from filtering the collapsed pin view.
func h3RetroDMParamLedger(ctx context.Context, t *testing.T, conn *pgx.Conn, pin uint64) []snapshotdb.T6DMParamEvent {
	t.Helper()
	rows, err := conn.Query(ctx, `
		SELECT chain_id, encode(asset,'hex'), event_type, block_number, log_index, encode(tx_hash,'hex'),
		       payload->>'ltv', payload->>'liquidation_threshold', payload->>'liquidation_bonus'
		FROM position_events
		WHERE engine = 'debt_manager' AND block_number <= $1
		  AND event_type IN ('collateral_token_config_set', 'collateral_token_removed', 'collateral_token_added')
		ORDER BY block_number, log_index, seq`, int64(pin))
	require.NoError(t, err)
	defer rows.Close()
	var out []snapshotdb.T6DMParamEvent
	for rows.Next() {
		var e snapshotdb.T6DMParamEvent
		var chainID, block int64
		var logIndex int32
		var ltv, lt, bonus *string
		require.NoError(t, rows.Scan(&chainID, &e.AssetHex, &e.EventType, &block, &logIndex, &e.TxHashHex, &ltv, &lt, &bonus))
		e.ChainID, e.Block, e.LogIndex = uint64(chainID), uint64(block), uint32(logIndex)
		for _, f := range []struct {
			text *string
			dst  **big.Int
		}{{ltv, &e.LTV}, {lt, &e.LiqThreshold}, {bonus, &e.LiqBonus}} {
			if f.text == nil {
				continue
			}
			v, ok := new(big.Int).SetString(*f.text, 10)
			require.True(t, ok, "dm config payload value %q is not an integer", *f.text)
			*f.dst = v
		}
		out = append(out, e)
	}
	require.NoError(t, rows.Err())
	return out
}

func TestWaveH3RetroactiveBooleanClassification(t *testing.T) {
	if os.Getenv("SOLVENT_H3_RETRO") == "" {
		t.Skip("SOLVENT_H3_RETRO unset: the retroactive boolean classification is opt-in (live DB SELECT-only + deep-archive RPC at the accept-r5 pins)")
	}
	artifactPath := os.Getenv(h3RetroArtifactEnv)
	if artifactPath == "" {
		t.Fatalf("%s must point at the retained accept-r5 drift-report.json — the retro classification is judged against the aborted run's own artifact (Codex F3), never a transcription", h3RetroArtifactEnv)
	}
	raw, err := os.ReadFile(artifactPath)
	require.NoError(t, err)
	subjects, err := parseAcceptR5RetroSubjects(raw)
	require.NoError(t, err, "the artifact-identity and completeness bars are hard preconditions: a retro classification over the wrong, truncated or doctored artifact proves nothing")
	t.Logf("artifact bound: digest %s recomputed and matched; %d boolean-drift subject(s) extracted with companion legs", h3RetroComparisonSHA[:12], len(subjects))

	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Minute)
	defer cancel()
	conn := refuteDB(t, ctx)
	r := liveReader(t, "op", "SOLVENT_RECON_RPC_OP", "SOLVENT_RPC_OP")
	hashOP := common.HexToHash(h3RetroHashOP)

	c := &p3Ctx{
		o: &options{}, opR: r, pinOP: h3RetroPinOP, hashOP: hashOP,
		dmProxy: liveDMProxy, frames: &frameSet{}, now: time.Now().UTC(),
	}
	universe, borrowTokens, _, err := readDMTokenUniverse(ctx, c)
	require.NoError(t, err)
	decimals, pinPrices, pinIndexes, _, err := readDMTokenState(ctx, c, universe, borrowTokens)
	require.NoError(t, err)

	// The raw config ledger, once, then folded at P and re-cut at each S —
	// ONE custody chain, the gate's own H4a fold law.
	ledger := h3RetroDMParamLedger(ctx, t, conn, h3RetroPinOP)
	foldedPin, err := riskfeed.FoldParams(dmEngine, 10, dmParamsAtBlock(ledger, h3RetroPinOP))
	require.NoError(t, err)

	pinTime, _, err := r.headerTime(ctx, h3RetroPinOP)
	require.NoError(t, err)

	// A pin-price recompute over an arbitrary (token → amount) vector, the
	// gate's own shape.
	recompute := func(account common.Address, debt *big.Int, vec map[common.Address]*big.Int,
		prices map[common.Address]*big.Int, folded []risk.ParamRow, block uint64) (risk.DMHealth, error) {
		in := risk.DMInput{
			Account: account, DebtUSD: debt, Params: folded,
			Marks: risk.Watermarks{BalancesBlock: block, ParamsBlock: block, SweepBlock: block},
		}
		toks := make([]common.Address, 0, len(vec))
		for tok := range vec {
			toks = append(toks, tok)
		}
		toks = sortAddrSlice(toks)
		for _, tok := range toks {
			dec, okDec := decimals[tok]
			p := prices[tok]
			if !okDec || p == nil {
				return risk.DMHealth{}, fmt.Errorf("token %s has no price/decimals at the requested clock", tok.Hex())
			}
			in.Collateral = append(in.Collateral, risk.DMCollateral{Asset: tok, Amount: vec[tok], Decimals: dec})
			in.Prices = append(in.Prices, risk.PriceInput{
				ChainID: 10, Asset: tok, Source: "dm:convertCollateralTokenToUsd@h3retro", Block: block,
				Value: p, Decimals: 6, Provenance: risk.ProvenanceEngineExact, Fresh: true,
			})
		}
		return risk.ComputeDMHealth(in)
	}

	debtFold := func(account common.Address, upTo uint64) map[common.Address]*big.Int {
		rows, err := conn.Query(ctx, `
			SELECT encode(asset,'hex'), COALESCE(SUM(delta),0)::text
			FROM position_events
			WHERE engine = 'debt_manager' AND chain_id = 10 AND side = 'debt'
			  AND delta IS NOT NULL AND account = $1 AND block_number <= $2
			GROUP BY 1`, account.Bytes(), int64(upTo))
		require.NoError(t, err)
		defer rows.Close()
		out := map[common.Address]*big.Int{}
		for rows.Next() {
			var assetHex, sum string
			require.NoError(t, rows.Scan(&assetHex, &sum))
			v, ok := new(big.Int).SetString(sum, 10)
			require.True(t, ok)
			if v.Sign() != 0 {
				out[common.HexToAddress("0x"+assetHex)] = v
			}
		}
		require.NoError(t, rows.Err())
		return out
	}

	for _, sub := range subjects {
		sub := sub
		t.Run(sub.addr, func(t *testing.T) {
			addr := common.HexToAddress(sub.addr)
			wantChainMax, _ := new(big.Int).SetString(sub.chainMax, 10)
			wantOursMax, _ := new(big.Int).SetString(sub.oursMax, 10)
			wantDebt, _ := new(big.Int).SetString(sub.debtPin, 10)

			// --- the persisted vector at S, from the snapshots HISTORY table ---
			var histBlock int64
			var doc map[string]any
			require.NoError(t, conn.QueryRow(ctx, `
				SELECT block_number, balances FROM snapshots
				WHERE engine='debt_manager' AND side='collateral' AND account=$1
				  AND block_number <= $2
				ORDER BY block_number DESC LIMIT 1`, addr.Bytes(), int64(h3RetroPinOP)).Scan(&histBlock, &doc))
			require.Equal(t, sub.sweep, uint64(histBlock),
				"the newest history document at or below the pin must sit at the artifact's own S")
			inner, ok := doc["balances"].(map[string]any)
			require.True(t, ok)
			persisted := map[common.Address]*big.Int{}
			for assetHex, amt := range inner {
				s, ok := amt.(string)
				require.True(t, ok)
				v, ok := new(big.Int).SetString(s, 10)
				require.True(t, ok)
				if v.Sign() > 0 {
					persisted[common.HexToAddress("0x"+assetHex)] = v
				}
			}

			// --- pin-clock reads: liquidatable, maxBorrow, borrowingOf, collateralOf ---
			var pinCalls []multicallCall
			for _, m := range []struct {
				abiName string
			}{{"liquidatable"}, {"getMaxBorrowAmount"}, {"borrowingOf"}, {"collateralOf"}} {
				var d []byte
				var err error
				switch m.abiName {
				case "liquidatable":
					d, err = dmLiquidatableABI.Pack("liquidatable", addr)
				case "getMaxBorrowAmount":
					d, err = dmGetMaxBorrowAmountABI.Pack("getMaxBorrowAmount", addr, false)
				case "borrowingOf":
					d, err = dmBorrowingOfAllABI.Pack("borrowingOf", addr)
				case "collateralOf":
					d, err = dmCollateralOfABI.Pack("collateralOf", addr)
				}
				require.NoError(t, err)
				pinCalls = append(pinCalls, multicallCall{Target: c.dmProxy, CallData: d})
			}
			pres, _, err := r.multicall(ctx, "h3retro:pin:"+sub.addr, h3RetroPinOP, hashOP, pinCalls)
			require.NoError(t, err)
			for i := range pres {
				require.True(t, pres[i].Success, "pin read %d must answer", i)
			}
			chainLiqP, err := unpackBoolStrict(dmLiquidatableABI, "liquidatable", pres[0].ReturnData)
			require.NoError(t, err)
			chainMaxP, err := unpackUint256Strict(dmGetMaxBorrowAmountABI, "getMaxBorrowAmount", pres[1].ReturnData)
			require.NoError(t, err)
			_, chainDebtP, err := unpackTokenAmountList(dmBorrowingOfAllABI, "borrowingOf", pres[2].ReturnData)
			require.NoError(t, err)
			pinVecList, _, err := unpackTokenAmountList(dmCollateralOfABI, "collateralOf", pres[3].ReturnData)
			require.NoError(t, err)

			require.Equal(t, sub.chainLiq, chainLiqP,
				"liquidatable@P must reproduce the artifact's expected_chain (hash-anchored: the same experiment) — the flip premise, DERIVED from the digest-bound row")
			require.Zero(t, chainMaxP.Cmp(wantChainMax), "getMaxBorrowAmount@P must reproduce the artifact")
			require.Zero(t, chainDebtP.Cmp(wantDebt), "borrowingOf.total@P must reproduce the artifact")

			// --- conjunct (ii): debt exact at pin, re-derived from custody ---
			foldP := debtFold(addr, h3RetroPinOP)
			ourDebtP := new(big.Int)
			for tok, n := range foldP {
				idx := pinIndexes[tok]
				require.NotNil(t, idx, "pinned getCurrentIndex for %s", tok.Hex())
				ourDebtP.Add(ourDebtP, mulDivFloor(n, idx))
			}
			require.Zero(t, ourDebtP.Cmp(chainDebtP),
				"conjunct (ii): our fold@P bridged through getCurrentIndex@P must weld borrowingOf.total EXACT")

			// --- the served MIXED verdict reproduced (debt@P over vector@S) ---
			hMixed, err := recompute(addr, ourDebtP, persisted, pinPrices, foldedPin, h3RetroPinOP)
			require.NoError(t, err)
			require.Zero(t, hMixed.MaxBorrowLT.Cmp(wantOursMax), "the mixed recompute must reproduce the artifact's actual_derived")
			require.Equal(t, sub.servedLiq, hMixed.Liquidatable,
				"the served mixed verdict must reproduce the artifact's actual_derived boolean — the flip under adjudication, DERIVED from the digest-bound row")
			margin := new(big.Int).Abs(new(big.Int).Sub(hMixed.Borrowings, hMixed.MaxBorrowLT))
			require.Equal(t, sub.margin, margin.String(), "the artifact's margin reproduces")

			// --- S-clock reads: the (i)+(iii) conjuncts ---
			hashS, _, err := r.headerHash(ctx, sub.sweep)
			require.NoError(t, err)
			require.Equal(t, strings.ToLower(sub.sweepHex), strings.ToLower(hashS.Hex()),
				"S resolves to the artifact's own_clock_hash (deep-finalized)")
			sTime, _, err := r.headerTime(ctx, sub.sweep)
			require.NoError(t, err)
			ageSeconds := int64(pinTime) - int64(sTime)

			foldS := debtFold(addr, sub.sweep)
			var sCalls []multicallCall
			d, err := dmLiquidatableABI.Pack("liquidatable", addr)
			require.NoError(t, err)
			sCalls = append(sCalls, multicallCall{Target: c.dmProxy, CallData: d})
			d, err = dmGetMaxBorrowAmountABI.Pack("getMaxBorrowAmount", addr, false)
			require.NoError(t, err)
			sCalls = append(sCalls, multicallCall{Target: c.dmProxy, CallData: d})
			d, err = dmCollateralOfABI.Pack("collateralOf", addr)
			require.NoError(t, err)
			sCalls = append(sCalls, multicallCall{Target: c.dmProxy, CallData: d})
			var sTokens []common.Address
			for tok := range persisted {
				sTokens = append(sTokens, tok)
			}
			sTokens = sortAddrSlice(sTokens)
			for _, tok := range sTokens {
				d, err = dmConvertCollateralToUsdABI.Pack("convertCollateralTokenToUsd", tok, pow10Big(decimals[tok]))
				require.NoError(t, err)
				sCalls = append(sCalls, multicallCall{Target: c.dmProxy, CallData: d})
			}
			var sIdxTokens []common.Address
			for tok := range foldS {
				sIdxTokens = append(sIdxTokens, tok)
			}
			sIdxTokens = sortAddrSlice(sIdxTokens)
			for _, tok := range sIdxTokens {
				d, err = dmGetCurrentIndexABI.Pack("getCurrentIndex", tok)
				require.NoError(t, err)
				sCalls = append(sCalls, multicallCall{Target: c.dmProxy, CallData: d})
			}
			sres, _, err := r.multicall(ctx, "h3retro:S:"+sub.addr, sub.sweep, hashS, sCalls)
			require.NoError(t, err)
			for i := range sres {
				require.True(t, sres[i].Success, "S read %d must answer", i)
			}
			chainLiqS, err := unpackBoolStrict(dmLiquidatableABI, "liquidatable", sres[0].ReturnData)
			require.NoError(t, err)
			chainMaxS, err := unpackUint256Strict(dmGetMaxBorrowAmountABI, "getMaxBorrowAmount", sres[1].ReturnData)
			require.NoError(t, err)
			vecS, _, err := unpackTokenAmountList(dmCollateralOfABI, "collateralOf", sres[2].ReturnData)
			require.NoError(t, err)
			pricesS := map[common.Address]*big.Int{}
			for i, tok := range sTokens {
				v, err := unpackUint256Strict(dmConvertCollateralToUsdABI, "convertCollateralTokenToUsd", sres[3+i].ReturnData)
				require.NoError(t, err)
				pricesS[tok] = v
			}
			idxS := map[common.Address]*big.Int{}
			for i, tok := range sIdxTokens {
				v, err := unpackUint256Strict(dmGetCurrentIndexABI, "getCurrentIndex", sres[3+len(sTokens)+i].ReturnData)
				require.NoError(t, err)
				idxS[tok] = v
			}

			// Conjunct (i): the vector certificate + the scalar law at S. The
			// param fold at S comes from the RAW ledger cut at S (the H4a F4
			// law) — the collapsed pin view cannot reconstruct S across a
			// config change inside (S, P].
			match, diff := compareDMCollateralVector(vecS, persisted)
			require.True(t, match, "conjunct (i): collateralOf@S must be byte-identical to the persisted document — %s", diff)
			foldedS, err := riskfeed.FoldParams(dmEngine, 10, dmParamsAtBlock(ledger, sub.sweep))
			require.NoError(t, err)
			debtS := new(big.Int)
			for tok, n := range foldS {
				require.NotNil(t, idxS[tok], "getCurrentIndex@S for %s", tok.Hex())
				debtS.Add(debtS, mulDivFloor(n, idxS[tok]))
			}
			hS, err := recompute(addr, debtS, persisted, pricesS, foldedS, sub.sweep)
			require.NoError(t, err)
			require.Zero(t, hS.MaxBorrowLT.Cmp(chainMaxS),
				"conjunct (i): the scalar law recompute at S must weld getMaxBorrowAmount@S bit-exact")

			// The maxBorrow leg through the gate's OWN classifier: sample-gap.
			ownRes := &dmOwnClockResult{
				Block: sub.sweep, Hash: hashS,
				ChainMax: chainMaxS, OurMax: hS.MaxBorrowLT,
				VectorRead: true, VectorMatch: true, VectorLegs: len(persisted),
				BoolRead: true, ChainLiqS: chainLiqS,
				OursLiqComputed: true, OursLiqS: hS.Liquidatable, DebtUSDAtS: debtS,
				AgeKnown: true, AgeSeconds: ageSeconds,
			}
			maxVerdict, maxClass := classifyDMMaxBorrow(chainMaxP, hMixed.MaxBorrowLT, ownRes)
			require.Equal(t, verdictSampleGap, maxVerdict, "conjunct (i): the leg classifies sample-gap (class %s)", maxClass)

			// Conjunct (iii): the S-clock boolean custody weld.
			require.Equal(t, chainLiqS, hS.Liquidatable,
				"conjunct (iii): ComputeDMHealth over ALL inputs at S must weld liquidatable@S bit-exact — a failure here over the passing certificate is the ESCALATION arm")

			// Conjunct (iv): the pin-vector substitution.
			pinVec := map[common.Address]*big.Int{}
			for _, e := range pinVecList {
				if e.Amount != nil && e.Amount.Sign() > 0 {
					if prev, ok := pinVec[e.Token]; ok {
						pinVec[e.Token] = new(big.Int).Add(prev, e.Amount)
					} else {
						pinVec[e.Token] = new(big.Int).Set(e.Amount)
					}
				}
			}
			hP, err := recompute(addr, chainDebtP, pinVec, pinPrices, foldedPin, h3RetroPinOP)
			require.NoError(t, err)
			scalarWeld := hP.MaxBorrowLT.Cmp(chainMaxP) == 0
			boolWeld := hP.Liquidatable == chainLiqP
			require.True(t, scalarWeld, "conjunct (iv): the scalar over the chain's own pin vector must reproduce getMaxBorrowAmount@P (got %s want %s)", hP.MaxBorrowLT, chainMaxP)
			require.True(t, boolWeld, "conjunct (iv): the boolean over the chain's own pin vector must reproduce liquidatable@P")

			contribP := map[common.Address]*big.Int{}
			for _, cv := range hP.Collateral {
				contribP[cv.Asset] = cv.MaxBorrowContribution
			}
			contribS := map[common.Address]*big.Int{}
			for _, cv := range hMixed.Collateral {
				contribS[cv.Asset] = cv.MaxBorrowContribution
			}
			union := map[common.Address]bool{}
			for tok := range contribP {
				union[tok] = true
			}
			for tok := range contribS {
				union[tok] = true
			}
			sum := new(big.Int)
			var ledgerLines []string
			for _, tok := range sortedAddrs(union) {
				dlt := new(big.Int).Sub(orZeroBig(contribP[tok]), orZeroBig(contribS[tok]))
				sum.Add(sum, dlt)
				if dlt.Sign() != 0 {
					ledgerLines = append(ledgerLines, fmt.Sprintf("%s: Δ %s USD-6", tok.Hex(), dlt))
				}
			}
			sort.Strings(ledgerLines)
			reconciles := sum.Cmp(new(big.Int).Sub(chainMaxP, hMixed.MaxBorrowLT)) == 0
			require.True(t, reconciles, "conjunct (iv): Σ per-token deltas (%s) must equal chainMax@P − ourMax(mixed) (%s)",
				sum, new(big.Int).Sub(chainMaxP, hMixed.MaxBorrowLT))

			// Conjunct (v): the freshness budget.
			require.Positive(t, ageSeconds)
			require.LessOrEqual(t, ageSeconds, h3RetroBudgetSeconds,
				"conjunct (v): the sweep age must sit inside the run's resolved bound")

			// --- THE CLASSIFICATION, through the gate's own pure law ---
			fx := dmBooleanFacts{
				Ours: hMixed.Liquidatable, Chain: chainLiqP,
				MaxBorrowLegVerdict: maxVerdict,
				DebtExactAtPin:      true,
				Own:                 ownRes,
				PinVec: &dmPinVectorResult{
					Read: true, ScalarP: hP.MaxBorrowLT, BoolP: hP.Liquidatable,
					ScalarWeld: scalarWeld, BoolWeld: boolWeld,
					PerTokenDeltas: ledgerLines, DeltaSum: sum, Reconciles: reconciles,
				},
				BudgetSeconds: h3RetroBudgetSeconds,
			}
			verdict, class, gated, reasons := classifyDMBoolean(fx)
			require.Equal(t, verdictBoundaryMotion, verdict,
				"THE HEADLINE: the accept-r5 row must classify MOTION under the union law (reasons: %v)", reasons)
			require.False(t, gated)
			wantDirection := dmDirectionFalsePositive
			if sub.chainLiq && !sub.servedLiq {
				wantDirection = dmDirectionFalseNegative
			}
			require.Contains(t, class, wantDirection,
				"the direction tag is DERIVED from the artifact's own boolean pair, never assumed")

			t.Logf("%s: MOTION PROVEN — verdict triangle served(mixed)=%v chain@pin=%v chain@S=%v; margins: mixed %s, @P(chain) %s, @S %s USD-6; sweep age %d blocks / %ds (budget %ds); Σ motion %s over %d token(s): %v",
				sub.addr, hMixed.Liquidatable, chainLiqP, chainLiqS,
				margin, new(big.Int).Sub(chainDebtP, chainMaxP), new(big.Int).Sub(debtS, hS.MaxBorrowLT),
				h3RetroPinOP-sub.sweep, ageSeconds, h3RetroBudgetSeconds, sum, len(ledgerLines), ledgerLines)
		})
	}
}
