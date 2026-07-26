# mutation transcript

- spec: `mutations.json`
- repo: `C:\Users\kasel\source\repos\etherfi\Solvent`
- **tested SHA: `d555683e4242db8873d3802b2793a3656aac2eff`**  (docs(sdd): task-9 wave5 mutation spec (t9w5-mutations), committed before any loop runs)
- started (UTC): 2026-07-26T11:44:18+00:00
- applier: `mutate.py`, exactly-one-occurrence assertion in `apply_edit`

## W5M1 — the v1.13.0 revert: HeaderHash recomputes the hash locally (HeaderByNumber + h.Hash()) instead of returning the provider-reported value

**Property under attack:** EVERY HASH HANDED OUT IS THE PROVIDER-REPORTED eth_getBlockByNumber hash field: local recomputation is silently non-canonical for post-v1.13.0 header shapes (OP incident block 150,105,227: computed 0x70f6bea2… vs canonical 0x3d957321…, hashcheck.go) and must be visible as a WRONG VALUE to the OP-shaped regression — killed by exactly that test, via a scoped run

```diff
--- internal/chain/chain.go:37
-	ReportedHeaderByNumber(ctx context.Context, number *big.Int) (*ReportedHeader, error)
+	ReportedHeaderByNumber(ctx context.Context, number *big.Int) (*ReportedHeader, error)
+	HeaderByNumber(ctx context.Context, number *big.Int) (*types.Header, error) // MUTANT W5M1: the *types.Header recomputation surface returns
```
APPLIED at internal/chain/chain.go:37 (1 occurrence, asserted)

```diff
--- internal/chain/chain.go:365
-	_, err := f.do(ctx, "headerHash", func(ctx context.Context, c rpcClient) error {
-		rh, err := c.ReportedHeaderByNumber(ctx, new(big.Int).SetUint64(n))
-		if err != nil {
-			return err
-		}
-		if err := validateReportedHeader(rh, fmt.Sprintf("%d", n)); err != nil {
-			return err
-		}
-		out = rh.Hash
+	_, err := f.do(ctx, "headerHash", func(ctx context.Context, c rpcClient) error { // MUTANT W5M1: recomputation restored
+		h, err := c.HeaderByNumber(ctx, new(big.Int).SetUint64(n))
+		if err != nil {
+			return err
+		}
+		if h == nil {
+			return fmt.Errorf("header %d not found", n)
+		}
+		out = h.Hash()
```
APPLIED at internal/chain/chain.go:365 (1 occurrence, asserted)

`go test ./internal/chain/ -run TestHeaderHashIsTheProviderReportedHashNotARecomputation -count=1`

Killed by:
  - `TestHeaderHashIsTheProviderReportedHashNotARecomputation`

**Result: KILLED**

## W5M2 — the zero-hash protocol gate is deleted from validateReportedHeader

**Property under attack:** ZERO-HASH REFUSAL RETAINED AT THE SOURCE: a mined block whose reported hash is zero is a provider protocol violation and must never be handed out as a block identity (an anchor holding it would verify against nothing) — every header path refuses it and the walk rotates past the violator

```diff
--- internal/chain/chain.go:94
-	if rh.Hash == (common.Hash{}) {
-		return fmt.Errorf("header %s reports a zero hash — a provider protocol violation; refusing to hand out an unverifiable block identity", what)
-	}
+	// MUTANT W5M2: the zero-hash protocol gate is gone
```
APPLIED at internal/chain/chain.go:94 (1 occurrence, asserted)

`go test ./internal/chain/ -count=1`

Killed by:
  - `TestHeaderReadsRefuseAZeroReportedHash`
  - `TestHeaderReadsRefuseAZeroReportedHash/HeadFrom`
  - `TestHeaderReadsRefuseAZeroReportedHash/HeaderHash`
  - `TestHeaderReadsRefuseAZeroReportedHash/HeaderHashFrom`
  - `TestHeaderReadsRefuseAZeroReportedHash/HeaderTime`
  - `TestHeaderReadsRefuseAZeroReportedHash/rotates_past_the_violator`

**Result: KILLED**

## W5M3 — Head's hash plumbing slips: HeadFrom populates Head.Hash from the reported parentHash field

**Property under attack:** REPORTED-HASH PLUMBING THROUGH Head/HeadFrom: Head.Hash is the reported hash OF THE HEAD BLOCK ITSELF — this is where the poller's hashBefore is born and what the EIP-1898 pin presents back to the node, so a nonzero-but-wrong field here recreates the discard-forever composition with a value no NotZero check can catch

```diff
--- internal/chain/chain.go:483
-		out = Head{Number: (*big.Int)(rh.Number).Uint64(), Time: uint64(rh.Time), Hash: rh.Hash}
+		out = Head{Number: (*big.Int)(rh.Number).Uint64(), Time: uint64(rh.Time), Hash: rh.ParentHash} // MUTANT W5M3: the head's hash plumbing slips to a different reported field
```
APPLIED at internal/chain/chain.go:483 (1 occurrence, asserted)

`go test ./internal/chain/ ./internal/prices/ -count=1`

Killed by:
  - `TestHeadFromCarriesTheReportedHashOfAnOPShapedHead`

**Result: KILLED**

## W5M4 — the routable re-verification path hands out the reported parentHash instead of the reported hash

**Property under attack:** REPORTED-HASH PLUMBING THROUGH HeaderHashFrom: the poller's closing hashAfter re-read and every repair probe ride this path, and reorg detection compares reported-then against reported-now — a wrong reported field here breaks the comparison one-sidedly with a plausible nonzero value

```diff
--- internal/chain/chain.go:522
-	idx, err := f.doFrom(ctx, "headerHash", start, func(ctx context.Context, c rpcClient) error {
-		rh, err := c.ReportedHeaderByNumber(ctx, new(big.Int).SetUint64(n))
-		if err != nil {
-			return err
-		}
-		if err := validateReportedHeader(rh, fmt.Sprintf("%d", n)); err != nil {
-			return err
-		}
-		out = rh.Hash
+	idx, err := f.doFrom(ctx, "headerHash", start, func(ctx context.Context, c rpcClient) error {
+		rh, err := c.ReportedHeaderByNumber(ctx, new(big.Int).SetUint64(n))
+		if err != nil {
+			return err
+		}
+		if err := validateReportedHeader(rh, fmt.Sprintf("%d", n)); err != nil {
+			return err
+		}
+		out = rh.ParentHash // MUTANT W5M4: the routable re-verification path hands out a different reported field
```
APPLIED at internal/chain/chain.go:522 (1 occurrence, asserted)

`go test ./internal/chain/ -count=1`

Killed by:
  - `TestHeaderHashFromIsRoutableAndForkSensitive`
  - `TestHeaderHashFromServesTheReportedHashWithItsToken`

**Result: KILLED**

## W5M5 — the v1.13.0 revert at the head: HeadFrom recomputes the latest block's identity locally (HeaderByNumber + h.Hash())

**Property under attack:** THE HEAD'S IDENTITY IS REPORTED, NOT RECOMPUTED: HeadFrom is where the poller's hashBefore comes from, so this revert IS the OP production incident (the pin presents a hash no node ever issued and the round discards forever) — the OP-shaped head regression must see the wrong value directly

```diff
--- internal/chain/chain.go:37
-	ReportedHeaderByNumber(ctx context.Context, number *big.Int) (*ReportedHeader, error)
+	ReportedHeaderByNumber(ctx context.Context, number *big.Int) (*ReportedHeader, error)
+	HeaderByNumber(ctx context.Context, number *big.Int) (*types.Header, error) // MUTANT W5M5: the *types.Header recomputation surface returns
```
APPLIED at internal/chain/chain.go:37 (1 occurrence, asserted)

```diff
--- internal/chain/chain.go:477
-		rh, err := c.ReportedHeaderByNumber(ctx, nil)
-		if err != nil {
-			return err
-		}
-		if err := validateReportedHeader(rh, "latest"); err != nil {
-			return err
-		}
-		out = Head{Number: (*big.Int)(rh.Number).Uint64(), Time: uint64(rh.Time), Hash: rh.Hash}
+		h, err := c.HeaderByNumber(ctx, nil) // MUTANT W5M5: the head's identity is recomputed locally
+		if err != nil {
+			return err
+		}
+		if h == nil || h.Number == nil || !h.Number.IsUint64() {
+			return fmt.Errorf("latest header not usable")
+		}
+		out = Head{Number: h.Number.Uint64(), Time: h.Time, Hash: h.Hash()}
```
APPLIED at internal/chain/chain.go:477 (1 occurrence, asserted)

`go test ./internal/chain/ ./internal/prices/ -count=1`

Killed by:
  - `TestHeadFromCarriesTheReportedHashOfAnOPShapedHead`
  - `TestHeaderReadsRefuseAZeroReportedHash`
  - `TestHeaderReadsRefuseAZeroReportedHash/HeadFrom`

**Result: KILLED**

## W5M6 — the head path ignores the protocol gate: validateReportedHeader's verdict is computed and discarded in HeadFrom

**Property under attack:** THE ZERO-HASH REFUSAL GUARDS THE PATH THE ANCHOR RESTS ON: HeadFrom's hash becomes the poller's hashBefore and the durable anchor hash, so the gate must be load-bearing AT THIS CALL SITE, not only present in the shared helper — severing the consult must surface as a zero-hash Head escaping to a caller

```diff
--- internal/chain/chain.go:480
-		if err := validateReportedHeader(rh, "latest"); err != nil {
-			return err
-		}
+		if err := validateReportedHeader(rh, "latest"); false && err != nil { // MUTANT W5M6: the head path ignores the protocol gate
+			return err
+		}
```
APPLIED at internal/chain/chain.go:480 (1 occurrence, asserted)

`go test ./internal/chain/ -count=1`

Killed by:
  - `TestHeaderReadsRefuseAZeroReportedHash`
  - `TestHeaderReadsRefuseAZeroReportedHash/HeadFrom`

**Result: KILLED**

## restore verification

`git status --porcelain` over the 1 mutated file(s) is EMPTY: every file is byte-identical to `d555683`. Restores came from in-memory copies taken before each edit; `git checkout` is never used.

## summary

| # | result | property | killed by |
|---|---|---|---|
| W5M1 | **KILLED** | EVERY HASH HANDED OUT IS THE PROVIDER-REPORTED eth_getBlockByNumber hash field: local recomputation is silently non-canonical for post-v1.13.0 header shapes (OP incident block 150,105,227: computed 0x70f6bea2… vs canonical 0x3d957321…, hashcheck.go) and must be visible as a WRONG VALUE to the OP-shaped regression — killed by exactly that test, via a scoped run | `TestHeaderHashIsTheProviderReportedHashNotARecomputation` |
| W5M2 | **KILLED** | ZERO-HASH REFUSAL RETAINED AT THE SOURCE: a mined block whose reported hash is zero is a provider protocol violation and must never be handed out as a block identity (an anchor holding it would verify against nothing) — every header path refuses it and the walk rotates past the violator | `TestHeaderReadsRefuseAZeroReportedHash`<br>`TestHeaderReadsRefuseAZeroReportedHash/HeadFrom`<br>`TestHeaderReadsRefuseAZeroReportedHash/HeaderHash`<br>`TestHeaderReadsRefuseAZeroReportedHash/HeaderHashFrom`<br>`TestHeaderReadsRefuseAZeroReportedHash/HeaderTime`<br>`TestHeaderReadsRefuseAZeroReportedHash/rotates_past_the_violator` |
| W5M3 | **KILLED** | REPORTED-HASH PLUMBING THROUGH Head/HeadFrom: Head.Hash is the reported hash OF THE HEAD BLOCK ITSELF — this is where the poller's hashBefore is born and what the EIP-1898 pin presents back to the node, so a nonzero-but-wrong field here recreates the discard-forever composition with a value no NotZero check can catch | `TestHeadFromCarriesTheReportedHashOfAnOPShapedHead` |
| W5M4 | **KILLED** | REPORTED-HASH PLUMBING THROUGH HeaderHashFrom: the poller's closing hashAfter re-read and every repair probe ride this path, and reorg detection compares reported-then against reported-now — a wrong reported field here breaks the comparison one-sidedly with a plausible nonzero value | `TestHeaderHashFromIsRoutableAndForkSensitive`<br>`TestHeaderHashFromServesTheReportedHashWithItsToken` |
| W5M5 | **KILLED** | THE HEAD'S IDENTITY IS REPORTED, NOT RECOMPUTED: HeadFrom is where the poller's hashBefore comes from, so this revert IS the OP production incident (the pin presents a hash no node ever issued and the round discards forever) — the OP-shaped head regression must see the wrong value directly | `TestHeadFromCarriesTheReportedHashOfAnOPShapedHead`<br>`TestHeaderReadsRefuseAZeroReportedHash`<br>`TestHeaderReadsRefuseAZeroReportedHash/HeadFrom` |
| W5M6 | **KILLED** | THE ZERO-HASH REFUSAL GUARDS THE PATH THE ANCHOR RESTS ON: HeadFrom's hash becomes the poller's hashBefore and the durable anchor hash, so the gate must be load-bearing AT THIS CALL SITE, not only present in the shared helper — severing the consult must surface as a zero-hash Head escaping to a caller | `TestHeaderReadsRefuseAZeroReportedHash`<br>`TestHeaderReadsRefuseAZeroReportedHash/HeadFrom` |

6 mutants, 6 killed, 0 survived.
