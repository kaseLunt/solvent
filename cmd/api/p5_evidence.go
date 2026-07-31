package main

// GET /v1/evidence — the deploy-bound evidence manifest.
//
// Every field is carried by the build, persisted by a batch, or read from a
// COMMITTED artifact — nothing is measured at request time, and absent
// evidence is stated with null and a reason, never approximated. The split of
// authority (B1's EvidenceInputs documents it):
//
//   - FROM THE DATABASE, per request: the newest SERVABLE batch's identity
//     (materialization key, substrate digest, counts) — the database is the
//     source of truth for which batch is servable NOW.
//   - FROM CODE AND COMMITTED FILES, at startup: the build's VCS stamp, the
//     registry fingerprint and algorithm revision, the scenario config
//     version, the feeds file's byte hash, the committed reconcile receipt's
//     summary and the committed probe-record paths. Re-deriving any of these
//     from the DB would invert authority.
//
// Committed artifacts name endpoints by ENVIRONMENT VARIABLE only; this
// surface serves no endpoint URL and no DSN (and every string passes the
// package sanitizer regardless).

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"time"

	"github.com/kaselunt/solvent/internal/risk"
	"github.com/kaselunt/solvent/internal/riskfeed"
)

// defaultReconcileArtifact is the committed drift-report receipt this
// deployment serves a summary of. Overridable by SOLVENT_API_RECONCILE_ARTIFACT
// (a repo-relative path — never a URL).
const defaultReconcileArtifact = "roadmap/evidence/artifacts/w1-reconcile/drift-report.json"

// probeRecordCandidates are the committed probe records this repo carries.
// Only files that exist in the deployed tree are served.
var probeRecordCandidates = []string{"recon/p3-probes.md"}

func reconcileArtifactPath() string {
	if v := os.Getenv("SOLVENT_API_RECONCILE_ARTIFACT"); v != "" {
		return v
	}
	return defaultReconcileArtifact
}

// evidenceStatics is everything /v1/evidence serves that is a fact of the
// DEPLOYED TREE rather than of the database, loaded once at startup.
type evidenceStatics struct {
	FeedsPath   string
	FeedsSHA256 string
	Reconcile   *wireReconcileSummary
	// ReconcileUnavailable names why Reconcile is nil ("" when it is not).
	ReconcileUnavailable string
	ProbeRecords         []wireProbeRecord
}

type wireReconcileWeld struct {
	Engine       string `json:"engine"`
	RowsCompared int    `json:"rows_compared"`
	RowsExact    int    `json:"rows_exact"`
}

type wireReconcileSummary struct {
	Schema           string              `json:"schema"`
	Result           string              `json:"result"`
	ExitCode         int                 `json:"exit_code"`
	FinishedAt       time.Time           `json:"finished_at"`
	GatedRows        int                 `json:"gated_rows"`
	GatedExact       int                 `json:"gated_exact"`
	GatedDrift       int                 `json:"gated_drift"`
	AdvisoryRows     int                 `json:"advisory_rows"`
	Welds            []wireReconcileWeld `json:"welds"`
	ComparisonSHA256 string              `json:"comparison_sha256"`
	ArtifactPath     string              `json:"artifact_path"`
	Note             string              `json:"note"`
}

type wireProbeRecord struct {
	Path string `json:"path"`
	Note string `json:"note"`
}

type wireFeedsRegistry struct {
	Path                string `json:"path"`
	RegistryFingerprint string `json:"registry_fingerprint"`
	FileSHA256          string `json:"file_sha256"`
	Note                string `json:"note"`
}

type wireSubstrateRef struct {
	BatchID            int64  `json:"batch_id"`
	MaterializationKey string `json:"materialization_key"`
	SubstrateDigest    string `json:"substrate_digest"`
	Note               string `json:"note"`
}

// wireProofSubject / wireLiveSubject are the manifest's TWO SUBJECTS
// (AMENDMENT 1): the pinned, exactly-reproducible acceptance evidence vs the
// currently-serving batch's watermarked identity. They are never one identity
// — a live batch must never read as reconciled-exact.
type wireProofSubject struct {
	// Status is the receipt's OWN strict conjunction, evaluated server-side:
	// accepted | rejected | unavailable. The same conjunction is re-derivable
	// from the served `reconcile` fields — a consumer finding the two in
	// contradiction must render the contradiction, never the badge.
	Status string `json:"status"`
	// Detail names the violated conjunct (rejected) or the absence reason
	// (unavailable); empty exactly on accepted.
	Detail string `json:"detail"`
	// Pin is the receipt's own comparison sha — non-nil whenever a receipt is
	// present, accepted or rejected.
	Pin *string `json:"pin"`
}

type wireLiveSubject struct {
	// Status: serving | no_batch. `no_batch` is a first-class state.
	Status string `json:"status"`
	// Reason mirrors substrate_unavailable_reason; empty exactly on serving.
	Reason string `json:"reason"`
}

// proofSubjectFrom evaluates the committed receipt's OWN strict conjunction —
// result "pass", exit 0, zero gated drift, every gated row exact, every
// per-engine weld whole. An internally inconsistent receipt (a "pass" with
// drift) is REJECTED with the violated conjunct named: this surface would
// rather call a contradictory receipt rejected than launder it into a proof.
func proofSubjectFrom(reconcile *wireReconcileSummary, unavailableReason string) wireProofSubject {
	if reconcile == nil {
		reason := unavailableReason
		if reason == "" {
			reason = "no committed reconcile receipt artifact is present in this deployment."
		}
		return wireProofSubject{Status: "unavailable", Detail: reason}
	}
	pin := strPtr(reconcile.ComparisonSHA256)
	rejected := func(detail string) wireProofSubject {
		return wireProofSubject{Status: "rejected", Detail: detail, Pin: pin}
	}
	if reconcile.Result != "pass" {
		return rejected(fmt.Sprintf("receipt verdict %q (exit %d)", reconcile.Result, reconcile.ExitCode))
	}
	if reconcile.ExitCode != 0 {
		return rejected(fmt.Sprintf("verdict \"pass\" with exit code %d — internally inconsistent receipt", reconcile.ExitCode))
	}
	if reconcile.GatedDrift != 0 || reconcile.GatedExact != reconcile.GatedRows {
		return rejected(fmt.Sprintf("gated %d/%d exact, drift %d", reconcile.GatedExact, reconcile.GatedRows, reconcile.GatedDrift))
	}
	for _, weld := range reconcile.Welds {
		if weld.RowsExact != weld.RowsCompared {
			return rejected(fmt.Sprintf("%s weld %d/%d exact", weld.Engine, weld.RowsExact, weld.RowsCompared))
		}
	}
	return wireProofSubject{Status: "accepted", Pin: pin}
}

type evidenceResponse struct {
	ServedAt time.Time   `json:"served_at"`
	Service  wireService `json:"service"`
	// Commit is the build's VCS revision, `-dirty` suffixed when the working
	// tree was modified; null when the build carries no stamp — never guessed.
	Commit                     *string               `json:"commit"`
	ProofSubject               wireProofSubject      `json:"proof_subject"`
	LiveSubject                wireLiveSubject       `json:"live_subject"`
	Substrate                  *wireSubstrateRef     `json:"substrate"`
	SubstrateUnavailableReason string                `json:"substrate_unavailable_reason,omitempty"`
	FeedsRegistry              wireFeedsRegistry     `json:"feeds_registry"`
	Reconcile                  *wireReconcileSummary `json:"reconcile"`
	ReconcileUnavailableReason string                `json:"reconcile_unavailable_reason,omitempty"`
	ProbeRecords               []wireProbeRecord     `json:"probe_records"`
	Notes                      []string              `json:"notes"`
}

func (s *server) handleEvidence(w http.ResponseWriter, r *http.Request) {
	inputs, err := s.store.EvidenceInputs(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, codeInternal, err.Error(), nil)
		return
	}
	now, err := s.dbNow(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, codeInternal, err.Error(), nil)
		return
	}

	out := evidenceResponse{
		ServedAt: now,
		Service: wireService{
			Name:                  "solvent-api",
			Version:               s.version,
			SchemaVersion:         s.schemaVersion,
			AlgorithmRevision:     riskfeed.AlgorithmRevision,
			ScenarioConfigVersion: s.scenarioConfigVersion(),
			RegistryFingerprint:   s.registry.Fingerprint(),
			SeizureModel:          risk.SeizureModelProRata,
		},
		FeedsRegistry: wireFeedsRegistry{
			Path:                s.evidence.FeedsPath,
			RegistryFingerprint: s.registry.Fingerprint(),
			FileSHA256:          s.evidence.FeedsSHA256,
			Note:                "`registry_fingerprint` is computed over the ASSEMBLED registry (the identity the batches are bound to); `file_sha256` is the committed file's bytes as deployed.",
		},
		Reconcile:    s.evidence.Reconcile,
		ProbeRecords: orEmptyProbes(s.evidence.ProbeRecords),
		Notes: []string{
			"this manifest is deploy-bound: every field is carried by the build, persisted by a batch, or read from a committed artifact. Nothing here is measured at request time.",
			"absent evidence is stated with null and a reason — never approximated. Committed artifacts name endpoints by environment variable only; this surface serves no endpoint URL and no DSN.",
			"THE TWO SUBJECTS are never one identity: `proof_subject` is the committed receipt's own strict conjunction AT ITS PIN; `live_subject` is the serving batch's watermarked identity. A live batch never reads as reconciled-exact, and the proof's exactness never transfers.",
		},
	}
	out.ProofSubject = proofSubjectFrom(s.evidence.Reconcile, s.evidence.ReconcileUnavailable)
	if s.version != "devel" {
		out.Commit = strPtr(s.version)
	}
	if inputs.HasBatch {
		out.LiveSubject = wireLiveSubject{Status: "serving"}
		out.Substrate = &wireSubstrateRef{
			BatchID:            inputs.BatchID,
			MaterializationKey: inputs.MaterializationKey,
			SubstrateDigest:    inputs.SubstrateDigest,
			Note:               "the digest is computed over the batch's INPUTS — the risk rows, consulted prices and consulted collateral flags — so two batches with identical substrate digests were computed from identical evidence. An empty digest means the batch predates substrate-digest custody: an honest gap, not a digest.",
		}
	} else {
		out.SubstrateUnavailableReason = "no complete risk batch is servable: either the materializer has not run, or every batch present fails the completeness predicate. The manifest describes the DEPLOYMENT either way."
		out.LiveSubject = wireLiveSubject{Status: "no_batch", Reason: out.SubstrateUnavailableReason}
	}
	if s.evidence.Reconcile == nil {
		reason := s.evidence.ReconcileUnavailable
		if reason == "" {
			reason = "no committed reconcile receipt artifact is present in this deployment."
		}
		out.ReconcileUnavailableReason = reason
	}
	writeJSON(w, out)
}

func orEmptyProbes(in []wireProbeRecord) []wireProbeRecord {
	if in == nil {
		return []wireProbeRecord{}
	}
	return in
}

// loadEvidenceStatics reads the deploy-bound evidence once. root prefixes
// every FILE READ (the test binary runs two directories below the repo root);
// the SERVED paths stay repo-relative, because that is the identity the
// committed artifacts have.
func loadEvidenceStatics(root, feedsPath, artifactPath string) (evidenceStatics, error) {
	out := evidenceStatics{FeedsPath: filepath.ToSlash(feedsPath)}

	feedsBytes, err := os.ReadFile(filepath.Join(root, feedsPath))
	if err != nil {
		// The registry was BUILT from this file; failing to hash it is a
		// deploy defect, not an absence to disclose.
		return evidenceStatics{}, fmt.Errorf("evidence: read feeds registry file: %w", err)
	}
	sum := sha256.Sum256(feedsBytes)
	out.FeedsSHA256 = hex.EncodeToString(sum[:])

	out.Reconcile, out.ReconcileUnavailable = loadReconcileSummary(root, artifactPath)

	for _, p := range probeRecordCandidates {
		if _, err := os.Stat(filepath.Join(root, p)); err != nil {
			continue
		}
		out.ProbeRecords = append(out.ProbeRecords, wireProbeRecord{
			Path: filepath.ToSlash(p),
			Note: "committed probe record; endpoints are named by environment variable only — publishable by construction.",
		})
	}
	return out, nil
}

// reconcileArtifact is the subset of the drift-report schema this surface
// serves. Unknown fields are ignored ON PURPOSE: the artifact is the
// authority on its own shape and this reader takes only what it needs.
type reconcileArtifact struct {
	Schema  string `json:"schema"`
	Summary struct {
		Result string `json:"result"`
		Totals struct {
			GatedRows    int `json:"gated_rows"`
			GatedExact   int `json:"gated_exact"`
			GatedDrift   int `json:"gated_drift"`
			AdvisoryRows int `json:"advisory_rows"`
		} `json:"totals"`
	} `json:"summary"`
	Run struct {
		FinishedAt time.Time `json:"finished_at"`
	} `json:"run"`
	ComparisonSHA256 string                `json:"comparison_sha256"`
	AaveRows         []reconcileRowVerdict `json:"aave_rows"`
	DMRows           []reconcileRowVerdict `json:"dm_rows"`
}

type reconcileRowVerdict struct {
	Verdict string `json:"verdict"`
}

// reconcileExitCodes is cmd/reconcile's own verdict→exit-code vocabulary
// (main.go's verdict function): the artifact records the verdict, and the
// closed mapping below is the SAME one the run's process exit used.
var reconcileExitCodes = map[string]int{
	"pass":                0,
	"fail":                1,
	"fail-with-tolerance": 1,
	"tainted":             1,
}

// loadReconcileSummary reads the committed receipt. An unreadable or
// unrecognizable artifact yields (nil, reason) — stated absence, never an
// approximated summary.
func loadReconcileSummary(root, artifactPath string) (*wireReconcileSummary, string) {
	raw, err := os.ReadFile(filepath.Join(root, artifactPath))
	if err != nil {
		return nil, "no committed reconcile receipt artifact at " + filepath.ToSlash(artifactPath) + " in this deployment."
	}
	var doc reconcileArtifact
	if err := json.Unmarshal(raw, &doc); err != nil {
		return nil, "the committed reconcile receipt at " + filepath.ToSlash(artifactPath) + " does not parse; refusing to approximate its summary."
	}
	exit, ok := reconcileExitCodes[doc.Summary.Result]
	if !ok {
		return nil, "the committed reconcile receipt's verdict " + fmt.Sprintf("%q", doc.Summary.Result) + " is outside the known vocabulary; refusing to approximate its summary."
	}
	countExact := func(rows []reconcileRowVerdict) int {
		n := 0
		for _, r := range rows {
			if r.Verdict == "exact" {
				n++
			}
		}
		return n
	}
	return &wireReconcileSummary{
		Schema:       doc.Schema,
		Result:       doc.Summary.Result,
		ExitCode:     exit,
		FinishedAt:   doc.Run.FinishedAt.UTC(),
		GatedRows:    doc.Summary.Totals.GatedRows,
		GatedExact:   doc.Summary.Totals.GatedExact,
		GatedDrift:   doc.Summary.Totals.GatedDrift,
		AdvisoryRows: doc.Summary.Totals.AdvisoryRows,
		Welds: []wireReconcileWeld{
			{Engine: risk.AaveEngine, RowsCompared: len(doc.AaveRows), RowsExact: countExact(doc.AaveRows)},
			{Engine: risk.DMEngine, RowsCompared: len(doc.DMRows), RowsExact: countExact(doc.DMRows)},
		},
		ComparisonSHA256: doc.ComparisonSHA256,
		ArtifactPath:     filepath.ToSlash(artifactPath),
		Note:             "read from the COMMITTED receipt artifact at deploy time; the reconcile itself ran against pinned blocks, not at request time. `exit_code` is the run's own verdict vocabulary mapped by the same closed table the process exit used.",
	}, ""
}
