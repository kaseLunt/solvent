package riskfeed

// The asset registry: which assets each engine can value, at what decimals,
// through which price witness.

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"sort"
	"strings"

	"github.com/ethereum/go-ethereum/common"

	"github.com/kaselunt/solvent/internal/config"
	"github.com/kaselunt/solvent/internal/risk"
	"github.com/kaselunt/solvent/internal/store"
)

// ErrRegistrySourceConflict refuses two poll entries declaring different
// valuation witnesses for one (engine, asset). Which oracle a number came from
// is the provenance string's entire job; two of them for one asset means the
// registry cannot say what the price IS.
var ErrRegistrySourceConflict = errors.New("riskfeed: two valuation sources declared for one engine/asset")

// AssetSpec is one asset an engine can value: its ERC20 decimals (needed for
// the per-reserve `balance × price / 10^dec` division) and the exact price
// witness to read.
type AssetSpec struct {
	Asset      common.Address
	Decimals   uint8
	Key        store.RiskPriceKey
	Provenance string
	Symbol     string
}

// Registry is the per-engine valuation vocabulary, built from the committed
// feed registry (recon/feeds.json).
//
// # Why only poll entries become valuation witnesses
//
// The Aave arm takes ONLY the `getAssetPrice(address)` poll entries, whose
// source string is `aaveoracle:<oracle>` and whose class is ADAPTER-OUTPUT: the
// price the pool itself charges against, with every price cap already applied.
// The `chainlink_stream` entries for the same assets reproduce the UNCAPPED
// feed and are deliberately excluded — they equal the adapter's output only
// while no cap binds, and caps bind exactly in the depeg and exploit scenarios a
// liquidation engine cares most about (design spec §7, Codex round 1 [H4]).
//
// The exclusion is structural, not advisory. An asset's uncapped row is never
// put in a RiskPriceKey, so `store.RiskInputSnapshot` never SELECTS it: it is
// not filtered downstream, it is not fetched. `internal/risk` would refuse it
// on provenance anyway; that refusal is the second wall, not the first.
type Registry struct {
	byEngine map[string]map[common.Address]AssetSpec
}

// NewRegistry builds the valuation vocabulary from the loaded feed registry.
func NewRegistry(feeds *config.Feeds) (*Registry, error) {
	if feeds == nil {
		return nil, errors.New("riskfeed: nil feed registry")
	}
	r := &Registry{byEngine: map[string]map[common.Address]AssetSpec{}}
	for _, f := range feeds.Assets {
		if f.Oracle.Kind != config.FeedKindPoll {
			continue // stream rows are observatory references, never valuation
		}
		var source string
		switch f.Engine {
		case risk.AaveEngine:
			source = aaveOracleSource(f.Oracle.Contract)
		case risk.DMEngine:
			source = sourcePriceProviderV2
		default:
			continue
		}
		class, err := ProvenanceClass(source)
		if err != nil {
			return nil, err
		}
		if !IsValuationClass(class) {
			return nil, fmt.Errorf("riskfeed: %s/%s resolves to class %q, which may not value a position",
				f.Engine, f.Symbol, class)
		}
		spec := AssetSpec{
			Asset:      f.Address,
			Decimals:   f.Decimals,
			Key:        store.RiskPriceKey{ChainID: f.ChainID, Asset: f.Address.Bytes(), Source: source},
			Provenance: class,
			Symbol:     f.Symbol,
		}
		m, ok := r.byEngine[f.Engine]
		if !ok {
			m = map[common.Address]AssetSpec{}
			r.byEngine[f.Engine] = m
		}
		if prev, dup := m[f.Address]; dup {
			if prev.Key.Source != spec.Key.Source || prev.Decimals != spec.Decimals {
				return nil, fmt.Errorf("%w: engine %s asset %s declares %q@%d and %q@%d",
					ErrRegistrySourceConflict, f.Engine, f.Address.Hex(),
					prev.Key.Source, prev.Decimals, spec.Key.Source, spec.Decimals)
			}
			continue
		}
		m[f.Address] = spec
	}
	return r, nil
}

// Spec returns the asset's valuation spec for engine.
func (r *Registry) Spec(engine string, asset common.Address) (AssetSpec, bool) {
	m, ok := r.byEngine[engine]
	if !ok {
		return AssetSpec{}, false
	}
	s, ok := m[asset]
	return s, ok
}

// PriceKeys returns every valuation witness the registry declares, ordered
// deterministically — the exact set `store.RiskInputSnapshot` fetches, and
// nothing else.
func (r *Registry) PriceKeys() []store.RiskPriceKey {
	var out []store.RiskPriceKey
	for _, m := range r.byEngine {
		for _, s := range m {
			out = append(out, s.Key)
		}
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].ChainID != out[j].ChainID {
			return out[i].ChainID < out[j].ChainID
		}
		if a, b := string(out[i].Asset), string(out[j].Asset); a != b {
			return a < b
		}
		return out[i].Source < out[j].Source
	})
	return out
}

// Fingerprint is the canonical identity of the loaded valuation configuration.
//
// It exists because the registry can change a NUMBER without changing any hashed
// input row. The sharp case is token decimals: `Assemble` divides by 10^decimals,
// so correcting a wrong `decimals` in the feed registry changes every value that
// asset contributes — while the `prices` rows, the balances and the cursors are all
// byte-identical. Without this in the materialization identity, a corrected
// configuration would derive the old key and ADOPT the incorrectly-scaled result,
// so the fix would never reach a served number.
//
// Every field that can move a value is included: engine, asset, decimals, the
// (chain, asset, source) price key, and the provenance class. Symbol is included
// too — it is a disclosure, and a batch whose labels changed is a different
// disclosure even at identical arithmetic.
func (r *Registry) Fingerprint() string {
	lines := make([]string, 0, 32)
	for engine, assets := range r.byEngine {
		for _, s := range assets {
			lines = append(lines, fmt.Sprintf("%s|%s|dec=%d|chain=%d|src=%s|prov=%s|sym=%s",
				engine, s.Asset.Hex(), s.Decimals, s.Key.ChainID, s.Key.Source, s.Provenance, s.Symbol))
		}
	}
	sort.Strings(lines)
	sum := sha256.Sum256([]byte(strings.Join(lines, "\n")))
	return hex.EncodeToString(sum[:])
}

// Engines lists the engines the registry can value for, sorted.
func (r *Registry) Engines() []string {
	out := make([]string, 0, len(r.byEngine))
	for e := range r.byEngine {
		out = append(out, e)
	}
	sort.Strings(out)
	return out
}
