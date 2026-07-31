// The accept-r4 SAME-PIN REFUTATION (Wave H's evidence standard, adjudicated;
// HARDENED to the non-vacuous bars by Codex round 2 finding 3): the corrected
// gate laws, fed the UNCHANGED accept-r4 inputs at the SAME pin hashes, must
// classify every previously-failing row correctly —
//
//   - the 233 dm_boolean_weld getMaxBorrowAmount drifts -> at each account's
//     own sweep block S, the collateralOf VECTOR byte-identical to the
//     persisted document (the F1 custody proof) AND the scalar recompute
//     bit-exact against getMaxBorrowAmount@blockHash(S), with the pin delta
//     classified sample-gap(disclosed); ANY vector mismatch or scalar failure
//     FAILS this test loudly, naming the account, because it flips the
//     adjudicated verdict;
//   - the 24 aave_hf zero-debt census differences -> correctly classified
//     NON-members under the one-law census (flag-gated, value-projected), with
//     the per-account aToken.scaledBalanceOf@pinHash weld passing bit-exact.
//
// THE NON-VACUOUS BARS (Codex round 2, finding 3 — the previous version
// passed on a NONEMPTY SUBSET: missing history was accumulated, >=1 exact
// sufficed, and the Aave lane required nonempty rather than exactly 24; a run
// proving 1/233, or fed a truncated artifact, stayed green):
//
//	(a) ARTIFACT IDENTITY — the artifact's own comparison_sha256 must equal
//	    the accept-r4 record, and its pins must be exactly op 154938071 /
//	    0xaf91dd4b… and eth 25650676 / 0x8197fee7…;
//	(b) COMPLETE TARGET SETS — exactly 233 unique DM subjects and exactly 24
//	    unique census subjects extracted from the artifact, each accounted for
//	    in the final classification counts;
//	(c) COMPLETE INPUT RECOVERY — any missing history row is a FAILURE, never
//	    an accumulated log line;
//	(d) ZERO UNREAD — every weld answers; an unread read is a FAILURE;
//	(e) EVERY DM row lands in exactly the sample-gap-disclosed-with-vector-
//	    match state (vector byte-identical AND scalar bit-exact at S), or the
//	    test fails naming the account.
//
// A fresh-pin pass alone proves nothing (adjudicated), which is why this test
// re-reads the accept-r4 derived state (SELECT-only, strictly read-only DSN,
// filtered at the accept-r4 pins) and welds at the accept-r4 pin HASHES.
//
// WHERE THE ACCEPT-R4 VECTOR LIVES NOW, stated because the obvious read is
// wrong: ApplySweepBatch replaces position_balances snapshot legs wholesale
// (delete-then-insert), and the sweeper resumed after accept-r4 — at refutation
// time ALL 233 accounts had been re-swept above the pin, so the live
// position_balances rows are NOT the accept-r4 inputs. The inputs survive in
// the `snapshots` HISTORY table: ApplySweepBatch writes each account's
// collateral document there atomically with the balances, keyed
// (engine, account, block_number, side), and only reorg rewinds ever delete
// from it. The newest side='collateral' document at block_number <= P_op IS
// the vector accept-r4's Stage A read, and its block_number IS S(account).
// For each account the test FIRST proves that identity by reproducing the
// artifact's own actual_derived at the pin (same inputs -> the same number,
// bit-equal), and only then runs the own-clock weld.
//
// Opt-in: SOLVENT_ACCEPT_R4_REFUTE=1, SOLVENT_ACCEPT_R4_ARTIFACT=<path to the
// accept-r4 drift-report.json>, SOLVENT_RECON_RPC_OP / SOLVENT_RECON_RPC_ETH
// (or the SOLVENT_RPC_* fallbacks), and the repo config's database (read-only
// DSN derived exactly as reconcile derives it).
package main

import (
	"context"
	"encoding/json"
	"fmt"
	"math/big"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"testing"
	"time"

	"github.com/ethereum/go-ethereum/common"
	"github.com/jackc/pgx/v5"
	"github.com/stretchr/testify/require"

	"github.com/kaselunt/solvent/internal/config"
	"github.com/kaselunt/solvent/internal/risk"
	"github.com/kaselunt/solvent/internal/riskfeed"
	"github.com/kaselunt/solvent/internal/store"
)

// The accept-r4 pins and identity (progress-phase3.md, ACCEPTANCE RETRY 4).
const (
	acceptR4PinOP    = uint64(154938071)
	acceptR4HashOP   = "0xaf91dd4ba1975fc3b93e411586ce267892406ed8cb7152c5cefe1c368696c6bc"
	acceptR4PinETH   = uint64(25650676)
	acceptR4HashETH  = "0x8197fee7a752a5e22d20c3d05e57ec510779753ff949f29343f46860d969d147"
	acceptR4Artifact = "SOLVENT_ACCEPT_R4_ARTIFACT"
	// acceptR4ComparisonSHA is the run's own comparison_sha256, recorded in the
	// ledger at completion — the artifact-identity bar (Codex round 2, finding
	// 3): a refutation judged against a different or truncated artifact proves
	// nothing about accept-r4.
	acceptR4ComparisonSHA = "38a57b3eb111af13ff57b9d67d27c5c89f7ef3666deb2840058f6d960a88778d"
	// acceptR4DMSubjects / acceptR4CensusSubjects are the EXACT unique-subject
	// counts of the accept-r4 failure sets. The refutation requires equality,
	// never nonemptiness: 1/233 is not a refutation.
	acceptR4DMSubjects     = 233
	acceptR4CensusSubjects = 24
)

func requireRefute(t *testing.T) string {
	t.Helper()
	if os.Getenv("SOLVENT_ACCEPT_R4_REFUTE") == "" {
		t.Skip("SOLVENT_ACCEPT_R4_REFUTE unset: the same-pin refutation is opt-in (it reads the live DB SELECT-only and issues deep-archive RPC)")
	}
	p := os.Getenv(acceptR4Artifact)
	if p == "" {
		t.Fatalf("%s must point at the accept-r4 drift-report.json — the refutation is judged against the run's own artifact, never a re-derivation", acceptR4Artifact)
	}
	return p
}

type acceptR4DMTarget struct {
	account  string
	chainPin *big.Int
	oursPin  *big.Int
}

type acceptR4Targets struct {
	dm     []acceptR4DMTarget
	census []string
}

// parseAcceptR4Artifact enforces the ARTIFACT-IDENTITY and COMPLETENESS bars
// (Codex round 2, finding 3) before returning a single target: the wrong
// artifact, drifted pins, a truncated row set, duplicate subjects or an
// unparseable value each REFUSE the whole refutation with an error naming the
// defect. It returns an error rather than asserting so the bars themselves
// are unit-testable without the live environment (and mutation-killable: the
// m3 mutant deletes a bar and the truncation test must notice).
func parseAcceptR4Artifact(raw []byte) (acceptR4Targets, error) {
	return parseAcceptR4ArtifactAgainst(raw, acceptR4ComparisonSHA)
}

// parseAcceptR4ArtifactAgainst carries the bars with the expected digest
// parameterized so each completeness bar stays unit-testable on synthetic
// fixtures sealed with their OWN recomputed digest. The live path always
// pins wantSHA to the accept-r4 record.
func parseAcceptR4ArtifactAgainst(raw []byte, wantSHA string) (acceptR4Targets, error) {
	var doc struct {
		ComparisonSHA256 string `json:"comparison_sha256"`
		Pins             []struct {
			Block uint64 `json:"block"`
			Chain string `json:"chain"`
			Hash  string `json:"hash"`
		} `json:"pins"`
		P3 struct {
			Rows []struct {
				Gate     string `json:"gate"`
				Subject  string `json:"subject"`
				Leg      string `json:"leg"`
				Verdict  string `json:"verdict"`
				Expected string `json:"expected_chain"`
				Actual   string `json:"actual_derived"`
			} `json:"rows"`
		} `json:"p3_task6"`
	}
	if err := json.Unmarshal(raw, &doc); err != nil {
		return acceptR4Targets{}, fmt.Errorf("the artifact does not parse: %w", err)
	}
	// Bar (a1): bytes integrity — the digest is RECOMPUTED from the supplied
	// artifact under the canonical hash-scope/redaction law (comparisonHash,
	// artifact.go), never trusted from the artifact's own self-report. A
	// substitute document that copies the digest string while changing any
	// scoped row recomputes to a different hash and refuses here (Codex
	// round 3: the self-reported string was a vacuous identity bar).
	var report driftReport
	if err := json.Unmarshal(raw, &report); err != nil {
		return acceptR4Targets{}, fmt.Errorf("the artifact does not parse as a drift report: %w", err)
	}
	recomputed, err := comparisonHash(&report)
	if err != nil {
		return acceptR4Targets{}, fmt.Errorf("recomputing the comparison hash over the supplied artifact: %w", err)
	}
	if recomputed != doc.ComparisonSHA256 {
		return acceptR4Targets{}, fmt.Errorf("ARTIFACT IDENTITY failed: recomputed comparison hash %q != embedded %q — the artifact's rows are not the bytes its digest claims",
			recomputed, doc.ComparisonSHA256)
	}
	// Bar (a2): it is THE artifact — the (now proven-embedded) digest must be
	// the recorded accept-r4 comparison hash.
	if doc.ComparisonSHA256 != wantSHA {
		return acceptR4Targets{}, fmt.Errorf("ARTIFACT IDENTITY failed: comparison_sha256 %q is not the accept-r4 record %q — the refutation is judged against the run's own artifact, never a substitute",
			doc.ComparisonSHA256, wantSHA)
	}
	opOK, ethOK := false, false
	for _, p := range doc.Pins {
		switch p.Chain {
		case "op":
			if p.Block != acceptR4PinOP || !strings.EqualFold(p.Hash, acceptR4HashOP) {
				return acceptR4Targets{}, fmt.Errorf("ARTIFACT IDENTITY failed: op pin %d/%s is not the accept-r4 pin %d/%s", p.Block, p.Hash, acceptR4PinOP, acceptR4HashOP)
			}
			opOK = true
		case "eth":
			if p.Block != acceptR4PinETH || !strings.EqualFold(p.Hash, acceptR4HashETH) {
				return acceptR4Targets{}, fmt.Errorf("ARTIFACT IDENTITY failed: eth pin %d/%s is not the accept-r4 pin %d/%s", p.Block, p.Hash, acceptR4PinETH, acceptR4HashETH)
			}
			ethOK = true
		}
	}
	if !opOK || !ethOK {
		return acceptR4Targets{}, fmt.Errorf("ARTIFACT IDENTITY failed: the artifact does not carry both accept-r4 pins (op present=%v, eth present=%v)", opOK, ethOK)
	}
	// Bar (b): the complete unique target sets.
	var out acceptR4Targets
	seenDM := map[string]bool{}
	seenCensus := map[string]bool{}
	for _, r := range doc.P3.Rows {
		if r.Gate == gateDMBoolean && r.Leg == "getMaxBorrowAmount(user,false)" && r.Verdict == verdictDrift {
			key := hexLower(r.Subject)
			if seenDM[key] {
				return acceptR4Targets{}, fmt.Errorf("duplicate dm_boolean_weld drift subject %s — the artifact is not the accept-r4 row set", r.Subject)
			}
			seenDM[key] = true
			c, ok1 := new(big.Int).SetString(r.Expected, 10)
			o, ok2 := new(big.Int).SetString(r.Actual, 10)
			if !ok1 || !ok2 {
				return acceptR4Targets{}, fmt.Errorf("artifact row %s carries non-integer values (%q vs %q)", r.Subject, r.Expected, r.Actual)
			}
			if c.Cmp(o) == 0 {
				return acceptR4Targets{}, fmt.Errorf("artifact row %s claims verdict=drift with EQUAL pin values %s — not an accept-r4 drift row", r.Subject, c)
			}
			out.dm = append(out.dm, acceptR4DMTarget{account: r.Subject, chainPin: c, oursPin: o})
		}
		if r.Gate == gateAaveHF && strings.HasPrefix(r.Leg, "census(zero-debt)") && r.Verdict == verdictDrift {
			key := hexLower(r.Subject)
			if seenCensus[key] {
				return acceptR4Targets{}, fmt.Errorf("duplicate zero-debt census drift subject %s — the artifact is not the accept-r4 row set", r.Subject)
			}
			seenCensus[key] = true
			out.census = append(out.census, r.Subject)
		}
	}
	if len(out.dm) != acceptR4DMSubjects {
		return acceptR4Targets{}, fmt.Errorf("COMPLETENESS failed: %d unique dm_boolean_weld drift subjects, want exactly %d — a truncated artifact must not refute (Codex round 2, finding 3)", len(out.dm), acceptR4DMSubjects)
	}
	if len(out.census) != acceptR4CensusSubjects {
		return acceptR4Targets{}, fmt.Errorf("COMPLETENESS failed: %d unique zero-debt census drift subjects, want exactly %d — a truncated artifact must not refute (Codex round 2, finding 3)", len(out.census), acceptR4CensusSubjects)
	}
	return out, nil
}

func loadAcceptR4Targets(t *testing.T, path string) acceptR4Targets {
	t.Helper()
	raw, err := os.ReadFile(path)
	require.NoError(t, err)
	targets, err := parseAcceptR4Artifact(raw)
	require.NoError(t, err, "the artifact-identity and completeness bars are hard preconditions: a refutation over the wrong or truncated artifact proves nothing")
	return targets
}

func refuteDB(t *testing.T, ctx context.Context) *pgx.Conn {
	t.Helper()
	cfg, err := config.Load(filepath.Join("..", "..", canonicalConfigPath))
	require.NoError(t, err)
	roDSN, err := readOnlyDSN(cfg.DatabaseURL)
	require.NoError(t, err, "the derived side is read STRICTLY read-only, exactly as reconcile reads it")
	conn, err := pgx.Connect(ctx, roDSN)
	require.NoError(t, err)
	t.Cleanup(func() { _ = conn.Close(context.Background()) })
	return conn
}

// TestAcceptR4SamePinRefutationDMMaxBorrow is Part A: ALL 233, each landing in
// exactly the sample-gap-disclosed-with-vector-match state.
func TestAcceptR4SamePinRefutationDMMaxBorrow(t *testing.T) {
	artifact := requireRefute(t)
	targets := loadAcceptR4Targets(t, artifact)
	t.Logf("targets: %d dm maxBorrow drift rows (artifact identity + completeness bars passed)", len(targets.dm))

	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Minute)
	defer cancel()
	conn := refuteDB(t, ctx)
	r := liveReader(t, "op", "SOLVENT_RECON_RPC_OP", "SOLVENT_RPC_OP")
	hashOP := common.HexToHash(acceptR4HashOP)

	// --- the accept-r4 derived side, SELECT-only at the accept-r4 pin --------
	type acct struct {
		hexAddr  string
		addr     common.Address
		sweep    uint64
		legs     map[common.Address]*big.Int
		chainPin *big.Int
		oursPin  *big.Int
	}
	var reproducible []*acct
	var missingHistory []string
	resweptLive := 0
	for _, tg := range targets.dm {
		a := common.HexToAddress(tg.account)
		// The LIVE watermark, recorded so the log states how far the sweeper has
		// moved on (the live position_balances rows are NOT the accept-r4 inputs
		// once this exceeds the pin — the history table below is).
		var liveSweep int64
		require.NoError(t, conn.QueryRow(ctx, `SELECT last_success_block FROM snapshot_sweeps
			WHERE engine='debt_manager' AND account=$1`, a.Bytes()).Scan(&liveSweep))
		if uint64(liveSweep) > acceptR4PinOP {
			resweptLive++
		}
		// THE ACCEPT-R4 VECTOR: the newest collateral history document at or
		// below the pin. Its block IS S(account); its balances ARE the legs
		// accept-r4's Stage A read (ApplySweepBatch writes both atomically).
		var sweep int64
		var doc map[string]any
		err := conn.QueryRow(ctx, `SELECT block_number, balances FROM snapshots
			WHERE engine='debt_manager' AND side='collateral' AND account=$1
			  AND block_number <= $2
			ORDER BY block_number DESC LIMIT 1`, a.Bytes(), int64(acceptR4PinOP)).Scan(&sweep, &doc)
		if err != nil {
			missingHistory = append(missingHistory, tg.account)
			continue
		}
		st := &acct{hexAddr: hexLower(tg.account), addr: a, sweep: uint64(sweep),
			legs: map[common.Address]*big.Int{}, chainPin: tg.chainPin, oursPin: tg.oursPin}
		inner, ok := doc["balances"].(map[string]any)
		require.True(t, ok, "%s: history document at %d carries no balances map", tg.account, sweep)
		for assetHex, amt := range inner {
			s, ok := amt.(string)
			require.True(t, ok, "%s: balance %q is %T, not a string", tg.account, assetHex, amt)
			v, ok := new(big.Int).SetString(s, 10)
			require.True(t, ok)
			if v.Sign() > 0 { // the gate's leg filter is amount > 0
				st.legs[common.HexToAddress("0x"+assetHex)] = v
			}
		}
		reproducible = append(reproducible, st)
	}
	t.Logf("accept-r4 vectors recovered from snapshots HISTORY: %d/%d (live watermark re-swept above the pin: %d — the live legs are gone, the history rows are not; missing history: %d)",
		len(reproducible), len(targets.dm), resweptLive, len(missingHistory))
	// Bar (c): COMPLETE input recovery. A missing history row is a FAILURE —
	// the previous accumulate-and-continue posture let a run proving 1/233
	// stay green (Codex round 2, finding 3).
	require.Empty(t, missingHistory,
		"COMPLETE INPUT RECOVERY failed: %d account(s) have no collateral history document at or below the pin — the refutation cannot claim the 233 over a subset", len(missingHistory))
	require.Len(t, reproducible, acceptR4DMSubjects,
		"every one of the %d artifact subjects must be recovered", acceptR4DMSubjects)

	// The DM param ledger (event custody, append-only) at the pin; re-cut at S.
	params, err := store.DMParamsAsOf(ctx, conn, acceptR4PinOP)
	require.NoError(t, err)

	// Decimals + PIN-clock engine prices via the gate's own pinned reads.
	c := &p3Ctx{
		o: &options{}, opR: r, pinOP: acceptR4PinOP, hashOP: hashOP,
		dmProxy: liveDMProxy, frames: &frameSet{}, now: time.Now().UTC(),
	}
	universe, borrowTokens, _, err := readDMTokenUniverse(ctx, c)
	require.NoError(t, err)
	decimals, pinPrices, _, _, err := readDMTokenState(ctx, c, universe, borrowTokens)
	require.NoError(t, err)

	foldedPin, err := riskfeed.FoldParams(dmEngine, 10, params)
	require.NoError(t, err)
	recompute := func(legs map[common.Address]*big.Int, prices map[common.Address]*big.Int,
		folded []risk.ParamRow, block uint64) *big.Int {
		in := risk.DMInput{
			Account: common.Address{0x01}, DebtUSD: big.NewInt(1), Params: folded,
			Marks: risk.Watermarks{BalancesBlock: block, ParamsBlock: block, SweepBlock: block},
		}
		toks := make([]common.Address, 0, len(legs))
		for tok := range legs {
			toks = append(toks, tok)
		}
		toks = sortAddrSlice(toks)
		for _, tok := range toks {
			dec, okDec := decimals[tok]
			p := prices[tok]
			if !okDec || p == nil {
				return nil
			}
			in.Collateral = append(in.Collateral, risk.DMCollateral{Asset: tok, Amount: legs[tok], Decimals: dec})
			in.Prices = append(in.Prices, risk.PriceInput{
				ChainID: 10, Asset: tok, Source: "dm:convertCollateralTokenToUsd@refute", Block: block,
				Value: p, Decimals: 6, Provenance: risk.ProvenanceEngineExact, Fresh: true,
			})
		}
		h, err := risk.ComputeDMHealth(in)
		if err != nil {
			return nil
		}
		return h.MaxBorrowLT
	}

	// --- SAME-INPUT PROOF: the vector reproduces the artifact's own number ---
	sameInput := 0
	for _, st := range reproducible {
		got := recompute(st.legs, pinPrices, foldedPin, acceptR4PinOP)
		require.NotNil(t, got, "%s: the pin recompute must be computable over the persisted vector", st.addr.Hex())
		require.Zero(t, got.Cmp(st.oursPin),
			"%s: recompute@pin %s != the artifact's actual_derived %s — the DB rows are NOT the accept-r4 inputs and this account cannot refute",
			st.addr.Hex(), got, st.oursPin)
		sameInput++
	}
	t.Logf("same-input proof: %d/%d reproducible vectors reproduce the artifact's actual_derived bit-exactly at the pin", sameInput, len(reproducible))

	// --- OWN-CLOCK WELDS at each account's own sweep block S -----------------
	byS := map[uint64][]*acct{}
	for _, st := range reproducible {
		require.NotZero(t, st.sweep, "%s: an evaluable accept-r4 account must carry a sweep at or below the pin", st.addr.Hex())
		byS[st.sweep] = append(byS[st.sweep], st)
	}
	sweeps := make([]uint64, 0, len(byS))
	for s := range byS {
		sweeps = append(sweeps, s)
	}
	sort.Slice(sweeps, func(i, j int) bool { return sweeps[i] < sweeps[j] })
	t.Logf("distinct sweep blocks S: %d (S is deep-finalized; each group shares one hash resolution and one multicall)", len(sweeps))

	ownExact, ownDrift, ownUnread := 0, 0, 0
	vectorExact, vectorMismatch := 0, 0
	minAge, maxAge := uint64(0), uint64(0)
	for _, s := range sweeps {
		group := byS[s]
		hashS, _, err := r.headerHash(ctx, s)
		if err != nil {
			ownUnread += len(group)
			t.Errorf("UNREAD (bar d): headerHash(%d): %v (%d accounts)", s, err, len(group))
			continue
		}
		gtok := map[common.Address]bool{}
		for _, st := range group {
			for tok := range st.legs {
				gtok[tok] = true
			}
		}
		gtokens := sortedAddrs(gtok)
		// Call layout at S: [0, len(group)) getMaxBorrowAmount;
		// [len(group), len(group)+len(gtokens)) prices;
		// [len(group)+len(gtokens), ...) collateralOf — the F1 CUSTODY PROOF,
		// the exact read the sweeper persists, byte-compared below.
		var calls []multicallCall
		for _, st := range group {
			d, err := dmGetMaxBorrowAmountABI.Pack("getMaxBorrowAmount", st.addr, false)
			require.NoError(t, err)
			calls = append(calls, multicallCall{Target: c.dmProxy, CallData: d})
		}
		for _, tok := range gtokens {
			d, err := dmConvertCollateralToUsdABI.Pack("convertCollateralTokenToUsd", tok, pow10Big(decimals[tok]))
			require.NoError(t, err)
			calls = append(calls, multicallCall{Target: c.dmProxy, CallData: d})
		}
		for _, st := range group {
			d, err := dmCollateralOfABI.Pack("collateralOf", st.addr)
			require.NoError(t, err)
			calls = append(calls, multicallCall{Target: c.dmProxy, CallData: d})
		}
		res, _, err := r.multicall(ctx, fmt.Sprintf("refute:ownClock@%d", s), s, hashS, calls)
		if err != nil {
			ownUnread += len(group)
			t.Errorf("UNREAD (bar d): multicall@%d: %v (%d accounts)", s, err, len(group))
			continue
		}
		pricesS := map[common.Address]*big.Int{}
		for i, tok := range gtokens {
			rr := res[len(group)+i]
			if rr.Success {
				if v, err := unpackUint256Strict(dmConvertCollateralToUsdABI, "convertCollateralTokenToUsd", rr.ReturnData); err == nil {
					pricesS[tok] = v
				}
			}
		}
		var cut []store.ParamRow
		for _, pr := range params {
			if pr.EffectiveBlock <= s {
				cut = append(cut, pr)
			}
		}
		foldedS, err := riskfeed.FoldParams(dmEngine, 10, cut)
		require.NoError(t, err)
		vecBase := len(group) + len(gtokens)
		for i, st := range group {
			// The VECTOR first (bar e / the F1 custody proof): collateralOf at
			// blockHash(S) byte-compared against the recovered accept-r4
			// document, order-insensitive by token, zero tolerance.
			vr := res[vecBase+i]
			if !vr.Success {
				ownUnread++
				t.Errorf("UNREAD (bar d): %s collateralOf reverted at S=%d", st.addr.Hex(), s)
				continue
			}
			vec, _, err := unpackTokenAmountList(dmCollateralOfABI, "collateralOf", vr.ReturnData)
			if err != nil {
				ownUnread++
				t.Errorf("UNREAD (bar d): %s collateralOf at S=%d did not decode: %v", st.addr.Hex(), s, err)
				continue
			}
			match, diff := compareDMCollateralVector(vec, st.legs)
			if !match {
				vectorMismatch++
				t.Errorf("SNAPSHOT CUSTODY DRIFT (VECTOR, verdict FLIPS): %s S=%d — %s", st.addr.Hex(), s, diff)
				continue
			}
			vectorExact++
			// Then the scalar law check over the proven-identical vector.
			if !res[i].Success {
				ownUnread++
				t.Errorf("UNREAD (bar d): %s getMaxBorrowAmount reverted at S=%d", st.addr.Hex(), s)
				continue
			}
			chainS, err := unpackUint256Strict(dmGetMaxBorrowAmountABI, "getMaxBorrowAmount", res[i].ReturnData)
			if err != nil {
				ownUnread++
				t.Errorf("UNREAD (bar d): %s: %v", st.addr.Hex(), err)
				continue
			}
			oursS := recompute(st.legs, pricesS, foldedS, s)
			if oursS == nil {
				ownUnread++
				t.Errorf("UNREAD (bar d): %s own-clock recompute refused at S=%d", st.addr.Hex(), s)
				continue
			}
			if chainS.Cmp(oursS) == 0 {
				ownExact++
				age := acceptR4PinOP - s
				if minAge == 0 || age < minAge {
					minAge = age
				}
				if age > maxAge {
					maxAge = age
				}
			} else {
				ownDrift++
				t.Errorf("OWN-CLOCK LAW DIVERGENCE (verdict FLIPS): %s S=%d chain@S=%s ours@S=%s — the vector matches byte-for-byte, so the divergence is in the recompute law itself",
					st.addr.Hex(), s, chainS, oursS)
			}
		}
	}
	t.Logf("own-clock welds over the %d: vector byte-identical %d, vector mismatch %d; scalar bit-exact %d, law-divergence %d, unread %d; sweep age (blocks) min %d max %d",
		len(reproducible), vectorExact, vectorMismatch, ownExact, ownDrift, ownUnread, minAge, maxAge)
	// Bars (d) and (e): zero unread, zero drift, and EVERY subject in the
	// sample-gap-disclosed-with-vector-match state — equality with 233, never
	// nonemptiness (Codex round 2, finding 3).
	require.Zero(t, vectorMismatch,
		"ANY vector mismatch at S is real sweeper-custody drift and flips the accept-r4 classification")
	require.Zero(t, ownDrift,
		"ANY scalar failure over a matching vector is a recompute-law divergence and flips the accept-r4 classification")
	require.Zero(t, ownUnread,
		"ZERO UNREAD is a hard bar (Codex round 2, finding 3): an unanswered weld is not a refutation")
	require.Equal(t, acceptR4DMSubjects, vectorExact,
		"all %d accept-r4 vectors must byte-compare identical at their own S", acceptR4DMSubjects)
	require.Equal(t, acceptR4DMSubjects, ownExact,
		"all %d DM rows must land in exactly the sample-gap-disclosed-with-vector-match state", acceptR4DMSubjects)
}

// TestAcceptR4SamePinRefutationZeroDebtCensus is Part B: ALL 24, each
// accounted for — exactly 24 unique subjects (the loader's completeness bar),
// every read answered, every weld bit-exact.
func TestAcceptR4SamePinRefutationZeroDebtCensus(t *testing.T) {
	artifact := requireRefute(t)
	targets := loadAcceptR4Targets(t, artifact)
	t.Logf("targets: %d zero-debt census rows (artifact identity + completeness bars passed)", len(targets.census))

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Minute)
	defer cancel()
	conn := refuteDB(t, ctx)
	r := liveReader(t, "eth", "SOLVENT_RECON_RPC_ETH", "SOLVENT_RPC_ETH")
	hashETH := common.HexToHash(acceptR4HashETH)
	pool := liveAavePool

	// Reserve list + per-reserve pinned state (config, indexes, price, aToken).
	rlData, err := poolReservesListABI.Pack("getReservesList")
	require.NoError(t, err)
	rlRet, _, err := r.callAtHash(ctx, "refute:getReservesList", pool, rlData, hashETH)
	require.NoError(t, err)
	reserves, err := unpackAddressListStrict(poolReservesListABI, "getReservesList", rlRet)
	require.NoError(t, err)
	t.Logf("reserves at the accept-r4 pin: %d", len(reserves))

	type rState struct {
		income, varDebt, price *big.Int
		decimals               uint8
		aToken                 common.Address
	}
	states := map[common.Address]*rState{}
	var calls []multicallCall
	for _, res := range reserves {
		d, _ := poolNormalizedIncomeABI.Pack("getReserveNormalizedIncome", res)
		calls = append(calls, multicallCall{Target: pool, CallData: d})
		d, _ = poolNormalizedDebtABI.Pack("getReserveNormalizedVariableDebt", res)
		calls = append(calls, multicallCall{Target: pool, CallData: d})
		d, _ = aaveOracleGetAssetPriceABI.Pack("getAssetPrice", res)
		calls = append(calls, multicallCall{Target: liveAaveOracle, CallData: d})
		d, _ = poolGetConfigurationABI.Pack("getConfiguration", res)
		calls = append(calls, multicallCall{Target: pool, CallData: d})
		d, _ = poolGetReserveATokenABI.Pack("getReserveAToken", res)
		calls = append(calls, multicallCall{Target: pool, CallData: d})
	}
	res, _, err := r.multicall(ctx, "refute:reserveState", acceptR4PinETH, hashETH, calls)
	require.NoError(t, err)
	for i, rsv := range reserves {
		st := &rState{}
		base := i * 5
		st.income, err = unpackUint256Strict(poolNormalizedIncomeABI, "getReserveNormalizedIncome", res[base].ReturnData)
		require.NoError(t, err)
		st.varDebt, err = unpackUint256Strict(poolNormalizedDebtABI, "getReserveNormalizedVariableDebt", res[base+1].ReturnData)
		require.NoError(t, err)
		st.price, err = unpackUint256Strict(aaveOracleGetAssetPriceABI, "getAssetPrice", res[base+2].ReturnData)
		require.NoError(t, err)
		packed, err := unpackPackedUint256Struct(poolGetConfigurationABI, "getConfiguration", res[base+3].ReturnData)
		require.NoError(t, err)
		st.decimals = decodeAaveReserveConfig(packed).Decimals
		st.aToken, err = unpackAddressStrict(poolGetReserveATokenABI, "getReserveAToken", res[base+4].ReturnData)
		require.NoError(t, err)
		states[rsv] = st
	}

	// Params + the derived collateral-flag fold at the pin (both append-only —
	// reproducible regardless of how far the daemon has moved on).
	params, err := store.ParamsAsOfQ(ctx, conn, risk.AaveParamEngine, 1, acceptR4PinETH)
	require.NoError(t, err)
	folded, err := riskfeed.FoldParams(risk.AaveParamEngine, 1, params)
	require.NoError(t, err)
	flags, err := store.CollateralFlagsAsOf(ctx, conn, risk.AaveEngine, 1, acceptR4PinETH)
	require.NoError(t, err)
	flagMap := buildDerivedFlagMap(flags)
	t.Logf("collateral-flag ledger rows at the pin: %d", len(flags))

	// Chain reads per subject: getUserAccountData + scaledBalanceOf per reserve.
	var subjCalls []multicallCall
	for _, s := range targets.census {
		a := common.HexToAddress(s)
		d, _ := poolUserAccountDataABI.Pack("getUserAccountData", a)
		subjCalls = append(subjCalls, multicallCall{Target: pool, CallData: d})
		for _, rsv := range reserves {
			d, _ := aTokenScaledBalanceOfABI.Pack("scaledBalanceOf", a)
			subjCalls = append(subjCalls, multicallCall{Target: states[rsv].aToken, CallData: d})
		}
	}
	subjRes, _, err := r.multicall(ctx, "refute:censusSubjects", acceptR4PinETH, hashETH, subjCalls)
	require.NoError(t, err)
	per := 1 + len(reserves)

	nonMember, chainZero, weldExact := 0, 0, 0
	neverEnabled, explicitOff := 0, 0
	for si, s := range targets.census {
		a := common.HexToAddress(s)
		key := hexLower(s)

		// The DERIVED fold at the pin, from the append-only event ledger.
		derivedLegs := map[common.Address][2]*big.Int{}
		rows, err := conn.Query(ctx, `SELECT asset, side, COALESCE(SUM(delta),0)::text
			FROM position_events WHERE engine=$1 AND account=$2
			  AND block_number <= $3 AND delta IS NOT NULL GROUP BY asset, side`,
			risk.AaveEngine, a.Bytes(), int64(acceptR4PinETH))
		require.NoError(t, err)
		for rows.Next() {
			var asset []byte
			var side, sum string
			require.NoError(t, rows.Scan(&asset, &side, &sum))
			v, ok := new(big.Int).SetString(sum, 10)
			require.True(t, ok)
			cur := derivedLegs[common.BytesToAddress(asset)]
			if side == "debt" {
				cur[0] = v
			} else {
				cur[1] = v
			}
			derivedLegs[common.BytesToAddress(asset)] = cur
		}
		rows.Close()
		require.NoError(t, rows.Err())

		// The one-law membership: value projection over the DERIVED flag fold.
		in := risk.AaveInput{
			Account: a, Regime: risk.RegimeAtBlock(acceptR4PinETH), Params: folded,
			Marks: risk.Watermarks{BalancesBlock: acceptR4PinETH, ParamsBlock: acceptR4PinETH},
		}
		hasDebt := false
		hasRawColl := false
		for _, rsv := range reserves {
			st := states[rsv]
			legs := derivedLegs[rsv]
			sd, sc := orZeroBig(legs[0]), orZeroBig(legs[1])
			if sd.Sign() > 0 {
				hasDebt = true
			}
			if sc.Sign() > 0 {
				hasRawColl = true
			}
			in.Reserves = append(in.Reserves, risk.AaveReserve{
				Asset: rsv, Decimals: st.decimals, ScaledDebt: sd, ScaledCollateral: sc,
				DebtIndex: st.varDebt, CollateralIndex: st.income, IndexBlock: acceptR4PinETH,
				UsedAsCollateral: flagMap[key][rsv],
			})
			in.Prices = append(in.Prices, risk.PriceInput{
				ChainID: 1, Asset: rsv, Source: "aaveoracle@pin", Block: acceptR4PinETH,
				Value: st.price, Decimals: 8, Provenance: risk.ProvenanceAdapterOutput, Fresh: true,
			})
		}
		got, err := risk.ComputeAaveHealth(in)
		require.NoError(t, err, "%s: the value projection must compute", s)
		member := !hasDebt && got.TotalCollateralBase.Sign() > 0
		require.False(t, member,
			"%s: STILL a derived census member under the one law (flag-gated value %s) — the refutation fails for this account",
			s, got.TotalCollateralBase)
		nonMember++
		require.True(t, hasRawColl,
			"%s: the account must carry RAW derived collateral (it was a flag-blind member at accept-r4)", s)
		if len(flagMap[key]) == 0 {
			neverEnabled++
		} else {
			explicitOff++
		}

		// The chain side: totalCollateralBase == 0 (the artifact's only-derived
		// direction re-confirmed at the same pin hash).
		ad := subjRes[si*per]
		require.True(t, ad.Success, "%s: getUserAccountData must answer at the pin", s)
		chainData, err := unpackUserAccountData(ad.ReturnData)
		require.NoError(t, err)
		require.Zero(t, chainData.TotalCollateralBase.Sign(),
			"%s: the chain must still deny the collateral leg at the accept-r4 pin", s)
		chainZero++

		// The balance-census weld: bit-exact, zero tolerance, per reserve.
		for ri, rsv := range reserves {
			sb := subjRes[si*per+1+ri]
			require.True(t, sb.Success, "%s reserve %s: scaledBalanceOf must answer", s, rsv.Hex())
			chainScaled, err := unpackUint256Strict(aTokenScaledBalanceOfABI, "scaledBalanceOf", sb.ReturnData)
			require.NoError(t, err)
			want := orZeroBig(derivedLegs[rsv][1])
			require.Zero(t, chainScaled.Cmp(want),
				"%s reserve %s: scaledBalanceOf@pin %s != derived scaled %s — a BALANCE defect the flag gate would have masked",
				s, rsv.Hex(), chainScaled, want)
			weldExact++
		}
	}
	t.Logf("one-law non-members: %d/%d; chain zero-collateral confirmed: %d/%d; scaledBalanceOf welds bit-exact: %d/%d",
		nonMember, len(targets.census), chainZero, len(targets.census),
		weldExact, len(targets.census)*len(reserves))
	t.Logf("flag provenance: never-enabled (no fold row) %d, explicit flag row(s) in custody %d", neverEnabled, explicitOff)
	// Bars (b), (d), (e) for the Aave lane: EXACTLY 24, each accounted for —
	// equality, never nonemptiness (Codex round 2, finding 3). The per-read
	// requires above already make any unread or inexact weld a hard failure;
	// these equalities prove no subject was skipped on the way.
	require.Equal(t, acceptR4CensusSubjects, nonMember,
		"all %d census subjects must classify one-law NON-members", acceptR4CensusSubjects)
	require.Equal(t, acceptR4CensusSubjects, chainZero,
		"all %d census subjects must re-confirm chain zero collateral at the pin hash", acceptR4CensusSubjects)
	require.Equal(t, acceptR4CensusSubjects*len(reserves), weldExact,
		"the scaledBalanceOf weld must be bit-exact for every (subject, reserve) pair — %d x %d", acceptR4CensusSubjects, len(reserves))
}
