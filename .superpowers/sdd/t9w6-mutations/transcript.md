# mutation transcript

- spec: `mutations.json`
- repo: `C:\Users\kasel\source\repos\etherfi\Solvent`
- **tested SHA: `71b8302e6d5740958a4287e4d1fc7b6160edac0c`**  (chore(sdd): task-9 wave-6 mutation spec, committed before the loop)
- started (UTC): 2026-07-26T12:27:41+00:00
- applier: `mutate.py`, exactly-one-occurrence assertion in `apply_edit`

## W6M1 — the height-equality gate is deleted: numbered reads accept a well-formed answer for ANY height

**Property under attack:** EXACT-HEIGHT EQUALITY ON EVERY NUMBERED READ (F1, round-5 [high]): a well-formed response for the wrong height — a proxy answering latest for numeric requests — is a protocol violation that fails the attempt and rotates; it can never date HeaderTime's freshness measurement or feed walker ancestry a hash for a block nobody asked about

```diff
--- internal/chain/chain.go:144
-	if want != nil && (*big.Int)(rh.Number).Uint64() != *want {
-		return fmt.Errorf("header %s response answers for height %d — a provider protocol violation; a numbered read serves exactly the block asked for or fails the attempt", what, (*big.Int)(rh.Number).Uint64())
-	}
+	// MUTANT W6M1: numbered reads accept a well-formed answer for ANY height
```
APPLIED at internal/chain/chain.go:144 (1 occurrence, asserted)

`go test ./internal/chain/ -count=1`

Killed by:
  - `TestAMismatchedResponseCannotInfluenceWalkerAncestryOrHeaderTime`
  - `TestAMismatchedResponseCannotInfluenceWalkerAncestryOrHeaderTime/honest_secondary:_every_consumed_value_is_the_asked_block's_own`
  - `TestAMismatchedResponseCannotInfluenceWalkerAncestryOrHeaderTime/no_honest_endpoint:_the_wrong_block's_hash_and_time_never_escape`
  - `TestAMismatchedResponseRotatesToTheHealthyNextEndpoint`
  - `TestNumberedReadsRequireTheResponseToAnswerTheHeightAsked`
  - `TestNumberedReadsRequireTheResponseToAnswerTheHeightAsked/HeaderHash`
  - `TestNumberedReadsRequireTheResponseToAnswerTheHeightAsked/HeaderHashFrom`
  - `TestNumberedReadsRequireTheResponseToAnswerTheHeightAsked/HeaderTime`
  - `TestRawJSONWellFormedWrongHeightResponseIsAViolationThatRotates`

**Result: KILLED**

## W6M2 — the hash presence check backfills: an absent hash silently becomes a zero value for the zero gate to judge

**Property under attack:** ABSENCE SURFACES AS ABSENCE (F2, hash): a response omitting the hash field is refused as 'omits required field(s) hash' — a decoder that backfills a plausible zero value misreports what the provider actually said, which is the F2 lie one level up (kill is at the violation's NAME; rotation is identical either way because the zero-hash gate dominates — disclosed in design notes)

```diff
--- internal/chain/chain.go:123
-	if rh.Hash == nil {
-		missing = append(missing, "hash")
-	}
+	if rh.Hash == nil {
+		rh.Hash = &common.Hash{} // MUTANT W6M2: absent hash silently becomes a zero value
+	}
```
APPLIED at internal/chain/chain.go:123 (1 occurrence, asserted)

`go test ./internal/chain/ -count=1`

Killed by:
  - `TestHeaderReadsRefuseAResponseMissingARequiredField`
  - `TestHeaderReadsRefuseAResponseMissingARequiredField/missing_hash`
  - `TestRawJSONMissingRequiredFieldsAreProtocolViolationsThatRotate`
  - `TestRawJSONMissingRequiredFieldsAreProtocolViolationsThatRotate/omitted_hash`

**Result: KILLED**

## W6M3 — the parentHash presence check backfills: an absent parentHash silently becomes a zero value and the read succeeds

**Property under attack:** PRESENCE-TRACKED parentHash (F2): a response omitting parentHash is a protocol violation that fails the attempt — under the mutant the read SUCCEEDS with a fabricated zero parent, handing reorg ancestry a lineage the provider never reported

```diff
--- internal/chain/chain.go:126
-	if rh.ParentHash == nil {
-		missing = append(missing, "parentHash")
-	}
+	if rh.ParentHash == nil {
+		rh.ParentHash = &common.Hash{} // MUTANT W6M3: absent parentHash silently becomes a zero value
+	}
```
APPLIED at internal/chain/chain.go:126 (1 occurrence, asserted)

`go test ./internal/chain/ -count=1`

Killed by:
  - `TestHeaderReadsRefuseAResponseMissingARequiredField`
  - `TestHeaderReadsRefuseAResponseMissingARequiredField/missing_parentHash`
  - `TestRawJSONMissingRequiredFieldsAreProtocolViolationsThatRotate`
  - `TestRawJSONMissingRequiredFieldsAreProtocolViolationsThatRotate/omitted_parentHash`

**Result: KILLED**

## W6M4 — the number presence check echoes: an absent number is backfilled with the height the caller asked for

**Property under attack:** PRESENCE-TRACKED number (F2) AND THE ECHO-CHAMBER GUARD ON F1: an absent number is a violation in its own right — a decoder that backfills it with the height asked makes the exact-height gate pass vacuously, 'verifying' the response against an answer the decoder itself invented

```diff
--- internal/chain/chain.go:129
-	if rh.Number == nil {
-		missing = append(missing, "number")
-	}
+	if rh.Number == nil && want != nil {
+		rh.Number = (*hexutil.Big)(new(big.Int).SetUint64(*want)) // MUTANT W6M4: absent number echoed back as the height asked
+	}
```
APPLIED at internal/chain/chain.go:129 (1 occurrence, asserted)

`go test ./internal/chain/ -count=1`

Killed by:
  - `TestHeaderReadsRefuseAResponseMissingARequiredField`
  - `TestHeaderReadsRefuseAResponseMissingARequiredField/missing_number`
  - `TestRawJSONMissingRequiredFieldsAreProtocolViolationsThatRotate`
  - `TestRawJSONMissingRequiredFieldsAreProtocolViolationsThatRotate/omitted_number`

**Result: KILLED**

## W6M5 — the timestamp presence check backfills: an absent timestamp decodes as the Unix epoch — the round-5 F2 defect restored

**Property under attack:** PRESENCE-TRACKED timestamp (F2, round-5 [medium], the incident shape): an omitted timestamp is a protocol violation that fails the attempt so failover reaches a healthy secondary — under the mutant HeaderTime reports the Unix epoch and HeadFrom an epoch-aged head from the malformed primary, the false-stale composition that froze failover

```diff
--- internal/chain/chain.go:132
-	if rh.Time == nil {
-		missing = append(missing, "timestamp")
-	}
+	if rh.Time == nil {
+		rh.Time = new(hexutil.Uint64) // MUTANT W6M5: absent timestamp decodes as the Unix epoch — the F2 defect restored
+	}
```
APPLIED at internal/chain/chain.go:132 (1 occurrence, asserted)

`go test ./internal/chain/ ./internal/prices/ -count=1`

Killed by:
  - `TestHeaderReadsRefuseAResponseMissingARequiredField`
  - `TestHeaderReadsRefuseAResponseMissingARequiredField/a_malformed_primary_rotates_to_a_healthy_secondary`
  - `TestHeaderReadsRefuseAResponseMissingARequiredField/missing_timestamp_is_not_a_Unix-epoch_head`
  - `TestHeaderReadsRefuseAResponseMissingARequiredField/missing_timestamp_on_the_head_read`
  - `TestRawJSONMissingRequiredFieldsAreProtocolViolationsThatRotate`
  - `TestRawJSONMissingRequiredFieldsAreProtocolViolationsThatRotate/omitted_timestamp`
  - `TestRawJSONMissingRequiredFieldsAreProtocolViolationsThatRotate/the_F2_incident_shape:_omitted_timestamp_cannot_become_an_epoch-aged_head`

**Result: KILLED**

## W6M6 — the null result is misclassified: an honest not-found surfaces as a provider protocol violation

**Property under attack:** NULL-VS-VIOLATION DISCRIMINATION, face one: a null result for a beyond-head block is a LEGITIMATE not-found that must surface as such — misclassifying it as a protocol violation would put honest lagging endpoints in the same bucket as malformed ones and page operators for ordinary beyond-head reads

```diff
--- internal/chain/chain.go:119
-	if rh == nil {
-		return fmt.Errorf("header %s not found", what)
-	}
+	if rh == nil {
+		return fmt.Errorf("header %s absent — treating the null result as a provider protocol violation", what) // MUTANT W6M6: an honest not-found misclassified as a violation
+	}
```
APPLIED at internal/chain/chain.go:119 (1 occurrence, asserted)

`go test ./internal/chain/ -count=1`

Killed by:
  - `TestHeaderReadsTreatAMissingBlockAsNotFound`
  - `TestRawJSONNullResultIsAnHonestNotFoundNotAViolation`

**Result: KILLED**

## W6M7 — the null result is fabricated into an empty header for the downstream gates to judge

**Property under attack:** NULL-VS-VIOLATION DISCRIMINATION, face two: a null result is never fabricated into a header — under the mutant the empty header trips the presence gates and the not-found surfaces as a field-omission protocol violation, erasing the one honest answer a lagging endpoint gave

```diff
--- internal/chain/chain.go:119
-	if rh == nil {
-		return fmt.Errorf("header %s not found", what)
-	}
+	if rh == nil {
+		rh = &ReportedHeader{} // MUTANT W6M7: the null result fabricated into an empty header for the gates to judge
+	}
```
APPLIED at internal/chain/chain.go:119 (1 occurrence, asserted)

`go test ./internal/chain/ -count=1`

Killed by:
  - `TestHeaderReadsTreatAMissingBlockAsNotFound`
  - `TestRawJSONNullResultIsAnHonestNotFoundNotAViolation`

**Result: KILLED**

## restore verification

`git status --porcelain` over the 1 mutated file(s) is EMPTY: every file is byte-identical to `71b8302`. Restores came from in-memory copies taken before each edit; `git checkout` is never used.

## summary

| # | result | property | killed by |
|---|---|---|---|
| W6M1 | **KILLED** | EXACT-HEIGHT EQUALITY ON EVERY NUMBERED READ (F1, round-5 [high]): a well-formed response for the wrong height — a proxy answering latest for numeric requests — is a protocol violation that fails the attempt and rotates; it can never date HeaderTime's freshness measurement or feed walker ancestry a hash for a block nobody asked about | `TestAMismatchedResponseCannotInfluenceWalkerAncestryOrHeaderTime`<br>`TestAMismatchedResponseCannotInfluenceWalkerAncestryOrHeaderTime/honest_secondary:_every_consumed_value_is_the_asked_block's_own`<br>`TestAMismatchedResponseCannotInfluenceWalkerAncestryOrHeaderTime/no_honest_endpoint:_the_wrong_block's_hash_and_time_never_escape`<br>`TestAMismatchedResponseRotatesToTheHealthyNextEndpoint`<br>`TestNumberedReadsRequireTheResponseToAnswerTheHeightAsked`<br>`TestNumberedReadsRequireTheResponseToAnswerTheHeightAsked/HeaderHash`<br>`TestNumberedReadsRequireTheResponseToAnswerTheHeightAsked/HeaderHashFrom`<br>`TestNumberedReadsRequireTheResponseToAnswerTheHeightAsked/HeaderTime`<br>`TestRawJSONWellFormedWrongHeightResponseIsAViolationThatRotates` |
| W6M2 | **KILLED** | ABSENCE SURFACES AS ABSENCE (F2, hash): a response omitting the hash field is refused as 'omits required field(s) hash' — a decoder that backfills a plausible zero value misreports what the provider actually said, which is the F2 lie one level up (kill is at the violation's NAME; rotation is identical either way because the zero-hash gate dominates — disclosed in design notes) | `TestHeaderReadsRefuseAResponseMissingARequiredField`<br>`TestHeaderReadsRefuseAResponseMissingARequiredField/missing_hash`<br>`TestRawJSONMissingRequiredFieldsAreProtocolViolationsThatRotate`<br>`TestRawJSONMissingRequiredFieldsAreProtocolViolationsThatRotate/omitted_hash` |
| W6M3 | **KILLED** | PRESENCE-TRACKED parentHash (F2): a response omitting parentHash is a protocol violation that fails the attempt — under the mutant the read SUCCEEDS with a fabricated zero parent, handing reorg ancestry a lineage the provider never reported | `TestHeaderReadsRefuseAResponseMissingARequiredField`<br>`TestHeaderReadsRefuseAResponseMissingARequiredField/missing_parentHash`<br>`TestRawJSONMissingRequiredFieldsAreProtocolViolationsThatRotate`<br>`TestRawJSONMissingRequiredFieldsAreProtocolViolationsThatRotate/omitted_parentHash` |
| W6M4 | **KILLED** | PRESENCE-TRACKED number (F2) AND THE ECHO-CHAMBER GUARD ON F1: an absent number is a violation in its own right — a decoder that backfills it with the height asked makes the exact-height gate pass vacuously, 'verifying' the response against an answer the decoder itself invented | `TestHeaderReadsRefuseAResponseMissingARequiredField`<br>`TestHeaderReadsRefuseAResponseMissingARequiredField/missing_number`<br>`TestRawJSONMissingRequiredFieldsAreProtocolViolationsThatRotate`<br>`TestRawJSONMissingRequiredFieldsAreProtocolViolationsThatRotate/omitted_number` |
| W6M5 | **KILLED** | PRESENCE-TRACKED timestamp (F2, round-5 [medium], the incident shape): an omitted timestamp is a protocol violation that fails the attempt so failover reaches a healthy secondary — under the mutant HeaderTime reports the Unix epoch and HeadFrom an epoch-aged head from the malformed primary, the false-stale composition that froze failover | `TestHeaderReadsRefuseAResponseMissingARequiredField`<br>`TestHeaderReadsRefuseAResponseMissingARequiredField/a_malformed_primary_rotates_to_a_healthy_secondary`<br>`TestHeaderReadsRefuseAResponseMissingARequiredField/missing_timestamp_is_not_a_Unix-epoch_head`<br>`TestHeaderReadsRefuseAResponseMissingARequiredField/missing_timestamp_on_the_head_read`<br>`TestRawJSONMissingRequiredFieldsAreProtocolViolationsThatRotate`<br>`TestRawJSONMissingRequiredFieldsAreProtocolViolationsThatRotate/omitted_timestamp`<br>`TestRawJSONMissingRequiredFieldsAreProtocolViolationsThatRotate/the_F2_incident_shape:_omitted_timestamp_cannot_become_an_epoch-aged_head` |
| W6M6 | **KILLED** | NULL-VS-VIOLATION DISCRIMINATION, face one: a null result for a beyond-head block is a LEGITIMATE not-found that must surface as such — misclassifying it as a protocol violation would put honest lagging endpoints in the same bucket as malformed ones and page operators for ordinary beyond-head reads | `TestHeaderReadsTreatAMissingBlockAsNotFound`<br>`TestRawJSONNullResultIsAnHonestNotFoundNotAViolation` |
| W6M7 | **KILLED** | NULL-VS-VIOLATION DISCRIMINATION, face two: a null result is never fabricated into a header — under the mutant the empty header trips the presence gates and the not-found surfaces as a field-omission protocol violation, erasing the one honest answer a lagging endpoint gave | `TestHeaderReadsTreatAMissingBlockAsNotFound`<br>`TestRawJSONNullResultIsAnHonestNotFoundNotAViolation` |

7 mutants, 7 killed, 0 survived.
