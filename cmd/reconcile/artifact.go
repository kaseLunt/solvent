// Artifact emission (brief §9). Two files, never a nested .md under
// roadmap/evidence (doctor.py parses every .md there recursively and
// requires typed front matter — L2-6):
//
//   - drift-report.json — schema solvent.reconcile.drift-report/v1,
//     canonical serialization (sorted keys, no float re-encoding of
//     integers), with a sha256 over the DETERMINISTIC comparison sections
//     embedded, so a re-run with the same pins/seed (or -accounts) is
//     byte-verifiable.
//   - drift-report.txt — the human summary rendered from the same struct;
//     "ABORTED" as line 1 when the run aborted, so a partial artifact
//     cannot be pasted into a receipt.
package main

import (
	"bytes"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"github.com/kaselunt/solvent/cmd/reconcile/snapshotdb"
)

const driftReportSchema = "solvent.reconcile.drift-report/v1"

// hashScope names EXACTLY which sections the embedded comparison hash
// covers, and which keys are redacted. Deterministic given (DB-at-P, seed,
// pins): run metadata, rpc routing, endpoint indexes, second opinions and
// wall-clock-relative freshness ages are EXCLUDED — they legitimately vary
// between two otherwise identical runs.
var hashScope = struct {
	Sections []string `json:"sections"`
	Redacted []string `json:"redacted_keys"`
}{
	Sections: []string{"pins", "counts", "sample", "dm_rows", "dm_weld", "dm_index_check", "aave_rows", "aave_weld", "golden", "invariants", "summary"},
	Redacted: []string{"endpoints_consulted", "second_opinion", "rpc_class", "endpoint", "attempts", "depth_note"},
}

// pinInfo is one chain's (or golden pin's) pin record.
type pinInfo struct {
	Chain      string `json:"chain"`
	Block      uint64 `json:"block"`
	Hash       string `json:"hash"`
	HeaderTime uint64 `json:"header_time,omitempty"`
	// Fork weld results (§3.1): before = Phase 1, after = Phase 3 re-run.
	WeldBefore string `json:"weld_before,omitempty"`
	WeldAfter  string `json:"weld_after,omitempty"`
}

// cursorInfo mirrors the cursors section.
type cursorInfo struct {
	Derive []map[string]any `json:"derive"`
	Ingest []map[string]any `json:"ingest"`
	// AckedEpochStart/End per engine — the §8 rewind detector's evidence.
	AckedEpochs        map[string]map[string]int64 `json:"acked_epochs"`
	MaxReorgEpochsInfo map[string]int64            `json:"max_reorg_epochs_informational"`
}

// The invariants section types (snapshotdb.InvariantsSection / ScanResult)
// live with the scans that fill them since round-13 F2 — the scans run
// inside the snapshot transaction. JSON tags are unchanged, so the artifact
// shape is byte-identical.

// driftReport is the whole artifact.
type driftReport struct {
	Schema  string         `json:"schema"`
	Status  string         `json:"status"` // completed | aborted: <reason>
	Run     map[string]any `json:"run"`
	Pins    []pinInfo      `json:"pins"`
	Cursors *cursorInfo    `json:"cursors,omitempty"`
	Counts  any            `json:"counts,omitempty"`
	Sample  any            `json:"sample,omitempty"`

	DMRows                  []dmRowResult   `json:"dm_rows,omitempty"`
	DMWeld                  []dmWeldRow     `json:"dm_weld,omitempty"`
	DMIndexCheck            []indexCheckRow `json:"dm_index_check,omitempty"`
	InternalInconsistencies any             `json:"internal_inconsistencies,omitempty"`

	AaveRows []aaveRowResult `json:"aave_rows,omitempty"`
	AaveWeld []aaveWeldRow   `json:"aave_weld,omitempty"`
	Golden   []goldenRow     `json:"golden,omitempty"`

	Freshness        *freshnessResult      `json:"freshness,omitempty"`
	SpotReads        []spotReadRow         `json:"collateral_spot_reads,omitempty"`
	CollateralReplay []collateralReplayRow `json:"collateral_replay,omitempty"`

	Invariants       *snapshotdb.InvariantsSection `json:"invariants,omitempty"`
	RPC              *rpcCallLog                   `json:"rpc,omitempty"`
	Summary          map[string]any                `json:"summary"`
	HashScope        any                           `json:"hash_scope"`
	ComparisonSHA256 string                        `json:"comparison_sha256,omitempty"`
}

// canonicalJSON renders v with sorted keys and json.Number round-tripping
// (never float64 — a 77-digit scaled balance must survive byte-identically).
func canonicalJSON(v any) ([]byte, error) {
	raw, err := json.Marshal(v)
	if err != nil {
		return nil, fmt.Errorf("marshal: %w", err)
	}
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.UseNumber()
	var tree any
	if err := dec.Decode(&tree); err != nil {
		return nil, fmt.Errorf("canonicalize decode: %w", err)
	}
	var buf bytes.Buffer
	if err := writeCanonical(&buf, tree); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

func writeCanonical(buf *bytes.Buffer, v any) error {
	switch t := v.(type) {
	case map[string]any:
		keys := make([]string, 0, len(t))
		for k := range t {
			keys = append(keys, k)
		}
		sort.Strings(keys)
		buf.WriteByte('{')
		for i, k := range keys {
			if i > 0 {
				buf.WriteByte(',')
			}
			kb, err := json.Marshal(k)
			if err != nil {
				return err
			}
			buf.Write(kb)
			buf.WriteByte(':')
			if err := writeCanonical(buf, t[k]); err != nil {
				return err
			}
		}
		buf.WriteByte('}')
	case []any:
		buf.WriteByte('[')
		for i, el := range t {
			if i > 0 {
				buf.WriteByte(',')
			}
			if err := writeCanonical(buf, el); err != nil {
				return err
			}
		}
		buf.WriteByte(']')
	case json.Number:
		buf.WriteString(t.String())
	default:
		b, err := json.Marshal(t)
		if err != nil {
			return err
		}
		buf.Write(b)
	}
	return nil
}

// redactVolatile deep-copies tree with hashScope.Redacted keys dropped.
func redactVolatile(v any) any {
	switch t := v.(type) {
	case map[string]any:
		out := map[string]any{}
		for k, val := range t {
			drop := false
			for _, r := range hashScope.Redacted {
				if k == r {
					drop = true
					break
				}
			}
			if !drop {
				out[k] = redactVolatile(val)
			}
		}
		return out
	case []any:
		out := make([]any, 0, len(t))
		for _, el := range t {
			out = append(out, redactVolatile(el))
		}
		return out
	default:
		return v
	}
}

// comparisonHash computes the embedded sha256 over the hashScope sections,
// redacted and canonicalized.
func comparisonHash(r *driftReport) (string, error) {
	sections := map[string]any{
		"pins":           r.Pins,
		"counts":         r.Counts,
		"sample":         r.Sample,
		"dm_rows":        r.DMRows,
		"dm_weld":        r.DMWeld,
		"dm_index_check": r.DMIndexCheck,
		"aave_rows":      r.AaveRows,
		"aave_weld":      r.AaveWeld,
		"golden":         r.Golden,
		"invariants":     r.Invariants,
		"summary":        r.Summary,
	}
	raw, err := json.Marshal(sections)
	if err != nil {
		return "", fmt.Errorf("marshal comparison sections: %w", err)
	}
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.UseNumber()
	var tree any
	if err := dec.Decode(&tree); err != nil {
		return "", fmt.Errorf("decode comparison sections: %w", err)
	}
	var buf bytes.Buffer
	if err := writeCanonical(&buf, redactVolatile(tree)); err != nil {
		return "", err
	}
	sum := sha256.Sum256(buf.Bytes())
	return fmt.Sprintf("%x", sum), nil
}

// writeArtifacts emits both files. Aborted runs still write both, with
// "ABORTED" as .txt line 1 and status:"aborted..." in the JSON — a partial
// artifact structurally cannot read as a pass.
func writeArtifacts(outDir string, r *driftReport) (jsonPath, txtPath string, err error) {
	if err := os.MkdirAll(outDir, 0o755); err != nil {
		return "", "", fmt.Errorf("create artifact dir: %w", err)
	}
	r.HashScope = hashScope
	h, err := comparisonHash(r)
	if err != nil {
		return "", "", err
	}
	r.ComparisonSHA256 = h

	blob, err := canonicalJSON(r)
	if err != nil {
		return "", "", err
	}
	jsonPath = filepath.Join(outDir, "drift-report.json")
	if err := os.WriteFile(jsonPath, append(blob, '\n'), 0o644); err != nil {
		return "", "", fmt.Errorf("write %s: %w", jsonPath, err)
	}
	txtPath = filepath.Join(outDir, "drift-report.txt")
	if err := os.WriteFile(txtPath, []byte(renderText(r)), 0o644); err != nil {
		return "", "", fmt.Errorf("write %s: %w", txtPath, err)
	}
	return jsonPath, txtPath, nil
}

// renderText renders the human summary from the same struct.
func renderText(r *driftReport) string {
	var b strings.Builder
	aborted := strings.HasPrefix(r.Status, "aborted")
	if aborted {
		b.WriteString("ABORTED\n")
	}
	fmt.Fprintf(&b, "solvent reconcile drift report (%s)\n", r.Schema)
	fmt.Fprintf(&b, "status: %s\n", r.Status)
	if res, ok := r.Summary["result"]; ok {
		fmt.Fprintf(&b, "result: %v\n", res)
	}
	fmt.Fprintf(&b, "comparison sha256: %s\n", r.ComparisonSHA256)
	b.WriteString("\npins:\n")
	for _, p := range r.Pins {
		fmt.Fprintf(&b, "  %-14s block %-12d hash %s weld[before=%s after=%s]\n", p.Chain, p.Block, p.Hash, p.WeldBefore, p.WeldAfter)
	}
	if len(r.DMRows) > 0 {
		exact := 0
		for _, row := range r.DMRows {
			if row.Verdict == verdictExact {
				exact++
			}
		}
		fmt.Fprintf(&b, "\ndm rows: %d/%d exact\n", exact, len(r.DMRows))
		for _, row := range r.DMRows {
			if row.Verdict != verdictExact {
				fmt.Fprintf(&b, "  DRIFT %s (stratum %s)\n", row.AccountHex, row.Stratum)
			}
		}
	}
	if len(r.DMWeld) > 0 {
		fmt.Fprintf(&b, "dm aggregate weld:\n")
		for _, w := range r.DMWeld {
			fmt.Fprintf(&b, "  %s %s derivedΣ=%s chain=%s (sample coverage %s)\n", w.TokenHex, w.Verdict, w.DerivedSum, w.ChainTotal, w.SampleCoverage)
		}
	}
	if len(r.DMIndexCheck) > 0 {
		fmt.Fprintf(&b, "dm index integrity (separate verdict class):\n")
		for _, c := range r.DMIndexCheck {
			fmt.Fprintf(&b, "  %s %s (gated=%v)\n", c.TokenHex, c.Verdict, c.Gated)
		}
	}
	if len(r.AaveRows) > 0 {
		exact := 0
		for _, row := range r.AaveRows {
			if row.Verdict == verdictExact {
				exact++
			}
		}
		fmt.Fprintf(&b, "aave rows: %d/%d exact\n", exact, len(r.AaveRows))
	}
	if len(r.AaveWeld) > 0 {
		fmt.Fprintf(&b, "aave aggregate weld:\n")
		for _, w := range r.AaveWeld {
			fmt.Fprintf(&b, "  %s %s %s derivedΣ=%s chain=%s gated=%v\n", w.Side, w.ReserveHex, w.Verdict, w.DerivedSum, w.ChainTotal, w.Gated)
		}
	}
	if len(r.Golden) > 0 {
		fmt.Fprintf(&b, "golden rows:\n")
		for _, g := range r.Golden {
			fmt.Fprintf(&b, "  row %s %s %s pin %d: %s\n", g.Row, g.Borrower, g.Side, g.Pin, g.Verdict)
		}
	}
	if r.Freshness != nil {
		fmt.Fprintf(&b, "freshness: %d sampled gate failures; fleet fresh %.3f (advisory threshold %.2f)\n",
			r.Freshness.GateFailures, r.Freshness.Fleet.FreshFraction, r.Freshness.Fleet.AdvisoryThreshold)
	}
	if r.Invariants != nil {
		fmt.Fprintf(&b, "invariants: scan1=%d scan2=%d scan3=%d scan4=%d scan5=%d advisory_aave=%d\n",
			r.Invariants.Scan1DistinctHash.Rows, r.Invariants.Scan2EventSums.Rows,
			r.Invariants.Scan3BorrowIndex.Rows, r.Invariants.Scan4EventLogOrphan.Rows,
			r.Invariants.Scan5IIUCoverage.Rows, r.Invariants.AdvisoryAaveIndex.Rows)
	}
	if r.RPC != nil {
		fmt.Fprintf(&b, "rpc: %d logged operations\n", len(r.RPC.Entries))
	}
	if !aborted {
		b.WriteString("\n(this .txt is a rendering of drift-report.json — the JSON is the artifact)\n")
	}
	return b.String()
}
