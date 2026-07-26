// Artifact tests (brief §9 / §10): canonical-JSON hash stability across
// endpoint/routing noise, seed echo (mutation target 12), aborted-run
// stamping, and the doctor.py-safety property (no .md is ever written).
package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
)

func sampleReport(seed string) *driftReport {
	rep := &driftReport{
		Schema:  driftReportSchema,
		Status:  "completed",
		Run:     map[string]any{"cmdline": "test"},
		Summary: map[string]any{"result": "pass"},
		Pins:    []pinInfo{{Chain: "op", Block: 154021227, Hash: "0xabc"}},
		DMRows: []dmRowResult{{
			AccountHex: "aa01", Verdict: verdictExact,
			Tokens:    []dmTokenComparison{{TokenHex: "0xT", DerivedNet: "963813", Index: "1042402553573226850", BridgedUSD: "1004681", ChainUSD: "1004681", Verdict: verdictExact}},
			Endpoints: []int{0},
		}},
	}
	stampSeed(rep.Run, seed)
	return rep
}

// TestComparisonHashIgnoresRoutingNoise: two runs with identical comparison
// data but different endpoint routing / second opinions hash IDENTICALLY —
// and a changed derived value changes the hash.
func TestComparisonHashIgnoresRoutingNoise(t *testing.T) {
	a := sampleReport("0xseed")
	b := sampleReport("0xseed")
	b.DMRows[0].Endpoints = []int{3}
	b.DMRows[0].SecondOpinion = "endpoint 1 answered 1004681"
	b.RPC = &rpcCallLog{Entries: []rpcLogEntry{{Op: "x", Endpoint: 2}}}
	b.Run["started_at"] = "2099-01-01T00:00:00Z"

	ha, err := comparisonHash(a)
	require.NoError(t, err)
	hb, err := comparisonHash(b)
	require.NoError(t, err)
	require.Equal(t, ha, hb, "endpoint indexes, second opinions, rpc log and run metadata are OUTSIDE the hash scope")

	c := sampleReport("0xseed")
	c.DMRows[0].Tokens[0].DerivedNet = "963814"
	hc, err := comparisonHash(c)
	require.NoError(t, err)
	require.NotEqual(t, ha, hc, "a changed comparison value MUST change the hash")

	// The sample section (which carries the seed) is in scope.
	d := sampleReport("0xseed")
	d.Sample = map[string]any{"seed": "other"}
	hd, err := comparisonHash(d)
	require.NoError(t, err)
	require.NotEqual(t, ha, hd)
}

func TestCanonicalJSONSortsKeysAndPreservesBigNumbers(t *testing.T) {
	blob, err := canonicalJSON(map[string]any{
		"zeta":  json.Number("58420665095130"),
		"alpha": 1,
		"nested": map[string]any{
			"b": "2", "a": "1",
		},
	})
	require.NoError(t, err)
	s := string(blob)
	require.Less(t, strings.Index(s, `"alpha"`), strings.Index(s, `"zeta"`))
	require.Less(t, strings.Index(s, `"a"`), strings.Index(s, `"b"`))
	require.Contains(t, s, "58420665095130", "big numbers round-trip as json.Number, never float64")

	again, err := canonicalJSON(map[string]any{
		"nested": map[string]any{"a": "1", "b": "2"},
		"alpha":  1,
		"zeta":   json.Number("58420665095130"),
	})
	require.NoError(t, err)
	require.Equal(t, blob, again, "insertion order never leaks into the bytes")
}

// TestArtifactEchoesResolvedSeed — mutation target 12: a run whose artifact
// does not carry the resolved seed is unreproducible.
func TestArtifactEchoesResolvedSeed(t *testing.T) {
	dir := t.TempDir()
	rep := sampleReport("0x77deadbeef")
	jsonPath, _, err := writeArtifacts(dir, rep)
	require.NoError(t, err)
	blob, err := os.ReadFile(jsonPath)
	require.NoError(t, err)
	var decoded map[string]any
	require.NoError(t, json.Unmarshal(blob, &decoded))
	run := decoded["run"].(map[string]any)
	require.Equal(t, "0x77deadbeef", run["seed_resolved"],
		"the RESOLVED seed must land in the artifact — argumentless runs are reproducible only through it")
}

// TestAbortedRunStampsBothFiles (brief §9): ABORTED is .txt line 1 and the
// JSON carries status aborted — a partial artifact cannot read as a pass.
func TestAbortedRunStampsBothFiles(t *testing.T) {
	dir := t.TempDir()
	rep := sampleReport("0xseed")
	rep.Status = "aborted: rewind during run"
	rep.Summary["result"] = "aborted"
	jsonPath, txtPath, err := writeArtifacts(dir, rep)
	require.NoError(t, err)

	txt, err := os.ReadFile(txtPath)
	require.NoError(t, err)
	require.True(t, strings.HasPrefix(string(txt), "ABORTED\n"), "ABORTED must be LINE 1 of the human summary")

	blob, err := os.ReadFile(jsonPath)
	require.NoError(t, err)
	var decoded map[string]any
	require.NoError(t, json.Unmarshal(blob, &decoded))
	require.Equal(t, "aborted: rewind during run", decoded["status"])
	require.Equal(t, "aborted", decoded["summary"].(map[string]any)["result"])
}

// TestArtifactsAreNeverMarkdown (L2-6): doctor.py recursively parses every
// .md under roadmap/evidence and requires typed front matter — the artifact
// files must be .json and .txt, nothing else.
func TestArtifactsAreNeverMarkdown(t *testing.T) {
	dir := t.TempDir()
	jsonPath, txtPath, err := writeArtifacts(dir, sampleReport("0xseed"))
	require.NoError(t, err)
	require.Equal(t, ".json", filepath.Ext(jsonPath))
	require.Equal(t, ".txt", filepath.Ext(txtPath))
	entries, err := os.ReadDir(dir)
	require.NoError(t, err)
	for _, e := range entries {
		require.NotEqual(t, ".md", filepath.Ext(e.Name()),
			"a nested evidence .md would turn the control plane red")
	}
}

// TestArtifactRedeployStable: same report → byte-identical JSON (the
// re-run-reproducibility claim is checked at the byte level).
func TestArtifactRedeployStable(t *testing.T) {
	dirA, dirB := t.TempDir(), t.TempDir()
	pa, _, err := writeArtifacts(dirA, sampleReport("0xseed"))
	require.NoError(t, err)
	pb, _, err := writeArtifacts(dirB, sampleReport("0xseed"))
	require.NoError(t, err)
	a, err := os.ReadFile(pa)
	require.NoError(t, err)
	b, err := os.ReadFile(pb)
	require.NoError(t, err)
	require.Equal(t, a, b)
}
