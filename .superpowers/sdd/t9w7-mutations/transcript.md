# mutation transcript

- spec: `mutations.json`
- repo: `C:\Users\kasel\source\repos\etherfi\Solvent`
- **tested SHA: `1e5f2682562a041986097b3c3a19c1822e3971c8`**  (chore(sdd): task-9 wave-7 mutation spec, committed before the loop)
- started (UTC): 2026-07-26T13:07:23+00:00
- applier: `mutate.py`, exactly-one-occurrence assertion in `apply_edit`

## W7M1 — the number wrapper skips the canon gate: hexutil's leniency decodes "" as height zero — the round-6 finding restored for the number field

**Property under attack:** AN EMPTY QUANTITY CAN NEVER BECOME A VALUE (number): "number":"" is a bytes-level protocol violation that fails the attempt and rotates — under the mutant it decodes as height 0, passes the wave-6 presence gate as a NON-NIL number, and HeadFrom hands out a height-zero head from the malformed primary instead of reaching the healthy secondary

```diff
--- internal/chain/chain.go:147
-	if err := checkCanonicalQuantity("number", input); err != nil {
-		return err
-	}
+	// MUTANT W7M1: the number wrapper skips the canon gate — hexutil's leniency decodes "" as height zero
```
APPLIED at internal/chain/chain.go:147 (1 occurrence, asserted)

`go test ./internal/chain/ -count=1`

Killed by:
  - `TestRawJSONEmptyNumberFailsTheAttemptAndTheSecondaryLandsHeadFrom`
  - `TestRawJSONMalformedHexFailsTheAttemptAndRotates`
  - `TestRawJSONMalformedHexFailsTheAttemptAndRotates/number_0x_with_no_digits`
  - `TestRawJSONMalformedHexFailsTheAttemptAndRotates/number_bare_JSON_number`
  - `TestRawJSONMalformedHexFailsTheAttemptAndRotates/number_empty_string`
  - `TestRawJSONMalformedHexFailsTheAttemptAndRotates/number_leading_zero_digits`
  - `TestRawJSONMalformedHexFailsTheAttemptAndRotates/number_missing_0x_prefix`
  - `TestRawJSONMalformedHexFailsTheAttemptAndRotates/number_non-hex_garbage`
  - `TestRawJSONMalformedHexFailsTheAttemptAndRotates/number_uppercase_hex_digits`

**Result: KILLED**

## W7M2 — the timestamp wrapper skips the canon gate: hexutil's leniency decodes "" as the Unix epoch — the round-6 finding restored for the timestamp field

**Property under attack:** AN EMPTY QUANTITY CAN NEVER BECOME A VALUE (timestamp): "timestamp":"" is a bytes-level protocol violation that fails the attempt and rotates — under the mutant it decodes as the Unix epoch, passes presence as a NON-NIL time, and HeaderTime dates staleness off 1970 at the malformed primary instead of landing on the healthy secondary

```diff
--- internal/chain/chain.go:156
-	if err := checkCanonicalQuantity("timestamp", input); err != nil {
-		return err
-	}
+	// MUTANT W7M2: the timestamp wrapper skips the canon gate — hexutil's leniency decodes "" as the Unix epoch
```
APPLIED at internal/chain/chain.go:156 (1 occurrence, asserted)

`go test ./internal/chain/ -count=1`

Killed by:
  - `TestRawJSONEmptyTimestampFailsTheAttemptAndTheSecondaryLandsHeaderTime`
  - `TestRawJSONMalformedHexFailsTheAttemptAndRotates`
  - `TestRawJSONMalformedHexFailsTheAttemptAndRotates/timestamp_0x_with_no_digits`
  - `TestRawJSONMalformedHexFailsTheAttemptAndRotates/timestamp_bare_JSON_number`
  - `TestRawJSONMalformedHexFailsTheAttemptAndRotates/timestamp_empty_string`
  - `TestRawJSONMalformedHexFailsTheAttemptAndRotates/timestamp_leading_zero_digits`
  - `TestRawJSONMalformedHexFailsTheAttemptAndRotates/timestamp_missing_0x_prefix`
  - `TestRawJSONMalformedHexFailsTheAttemptAndRotates/timestamp_non-hex_garbage`
  - `TestRawJSONMalformedHexFailsTheAttemptAndRotates/timestamp_uppercase_hex_digits`

**Result: KILLED**

## W7M3 — the canon's empty-rejection arm is deleted: "" falls through to the 0x-prefix arm

**Property under attack:** THE EMPTY STRING IS REFUSED AS WHAT IT IS — a non-answer, not zero and not a malformed prefix: the violation's name carries the discrimination (kill is at the NAME; "" is still refused by the next arm so rotation is identical — disclosed in design notes)

```diff
--- internal/chain/chain.go:204
-	if len(s) == 0 {
-		return violation("empty — an empty quantity is a non-answer, not zero")
-	}
+	// MUTANT W7M3: the empty-rejection arm is deleted — "" falls through to the prefix arm
```
APPLIED at internal/chain/chain.go:204 (1 occurrence, asserted)

`go test ./internal/chain/ -count=1`

Killed by:
  - `TestRawJSONEmptyNumberFailsTheAttemptAndTheSecondaryLandsHeadFrom`
  - `TestRawJSONEmptyTimestampFailsTheAttemptAndTheSecondaryLandsHeaderTime`
  - `TestRawJSONMalformedHexFailsTheAttemptAndRotates`
  - `TestRawJSONMalformedHexFailsTheAttemptAndRotates/number_empty_string`
  - `TestRawJSONMalformedHexFailsTheAttemptAndRotates/timestamp_empty_string`

**Result: KILLED**

## W7M4 — the lowercase arm is relaxed: uppercase hex digits pass the canon and hexutil decodes them as values

**Property under attack:** THE CANON IS WHAT THE REFERENCE ENCODER EMITS — lowercase digits only: "0x5A" is a representation no honest geth-derived node ever serves, and it must be refused at the bytes even though hexutil would happily decode it (for the number field it would then pass the exact-height gate too, so the canon gate is the ONLY refusal line — a behavioral kill)

```diff
--- internal/chain/chain.go:218
-		if (c < '0' || c > '9') && (c < 'a' || c > 'f') {
+		if (c < '0' || c > '9') && (c < 'a' || c > 'f') && (c < 'A' || c > 'F') { // MUTANT W7M4: uppercase digits pass the canon
```
APPLIED at internal/chain/chain.go:218 (1 occurrence, asserted)

`go test ./internal/chain/ -count=1`

Killed by:
  - `TestRawJSONMalformedHexFailsTheAttemptAndRotates`
  - `TestRawJSONMalformedHexFailsTheAttemptAndRotates/number_uppercase_hex_digits`
  - `TestRawJSONMalformedHexFailsTheAttemptAndRotates/timestamp_uppercase_hex_digits`

**Result: KILLED**

## W7M5 — the leading-zero arm is deleted: non-compact quantities pass the canon and die one layer down in hexutil

**Property under attack:** THE GATE OWNS THE COMPACTNESS RULE — "0x05a" is refused BY THE CANON, not by whatever hexutil happens to reject: under the mutant the refusal devolves to hexutil's ErrLeadingZero (rotation identical, the canon marker gone from the violation's name — a message-level kill riding the marker assertion, disclosed in design notes)

```diff
--- internal/chain/chain.go:214
-	if len(digits) > 1 && digits[0] == '0' {
-		return violation("leading zero digits — the canon is the most compact representation")
-	}
+	// MUTANT W7M5: non-compact quantities pass the canon — hexutil's own leading-zero rule dominates behaviorally
```
APPLIED at internal/chain/chain.go:214 (1 occurrence, asserted)

`go test ./internal/chain/ -count=1`

Killed by:
  - `TestRawJSONMalformedHexFailsTheAttemptAndRotates`
  - `TestRawJSONMalformedHexFailsTheAttemptAndRotates/number_leading_zero_digits`
  - `TestRawJSONMalformedHexFailsTheAttemptAndRotates/timestamp_leading_zero_digits`

**Result: KILLED**

## W7M6 — the no-digits arm is deleted: "0x" passes the canon and dies one layer down in hexutil

**Property under attack:** THE GATE OWNS THE ZERO RULE — "0x" is refused BY THE CANON (zero is "0x0"), not by hexutil's ErrEmptyNumber: under the mutant the refusal devolves to the library whose leniency profile is the finding (rotation identical, the canon marker gone — a message-level kill, disclosed in design notes)

```diff
--- internal/chain/chain.go:211
-	if len(digits) == 0 {
-		return violation(`"0x" carries no digits — zero is "0x0"`)
-	}
+	// MUTANT W7M6: "0x" passes the canon with no digits — hexutil's empty-number rule dominates behaviorally
```
APPLIED at internal/chain/chain.go:211 (1 occurrence, asserted)

`go test ./internal/chain/ -count=1`

Killed by:
  - `TestRawJSONMalformedHexFailsTheAttemptAndRotates`
  - `TestRawJSONMalformedHexFailsTheAttemptAndRotates/number_0x_with_no_digits`
  - `TestRawJSONMalformedHexFailsTheAttemptAndRotates/timestamp_0x_with_no_digits`

**Result: KILLED**

## restore verification

`git status --porcelain` over the 1 mutated file(s) is EMPTY: every file is byte-identical to `1e5f268`. Restores came from in-memory copies taken before each edit; `git checkout` is never used.

## summary

| # | result | property | killed by |
|---|---|---|---|
| W7M1 | **KILLED** | AN EMPTY QUANTITY CAN NEVER BECOME A VALUE (number): "number":"" is a bytes-level protocol violation that fails the attempt and rotates — under the mutant it decodes as height 0, passes the wave-6 presence gate as a NON-NIL number, and HeadFrom hands out a height-zero head from the malformed primary instead of reaching the healthy secondary | `TestRawJSONEmptyNumberFailsTheAttemptAndTheSecondaryLandsHeadFrom`<br>`TestRawJSONMalformedHexFailsTheAttemptAndRotates`<br>`TestRawJSONMalformedHexFailsTheAttemptAndRotates/number_0x_with_no_digits`<br>`TestRawJSONMalformedHexFailsTheAttemptAndRotates/number_bare_JSON_number`<br>`TestRawJSONMalformedHexFailsTheAttemptAndRotates/number_empty_string`<br>`TestRawJSONMalformedHexFailsTheAttemptAndRotates/number_leading_zero_digits`<br>`TestRawJSONMalformedHexFailsTheAttemptAndRotates/number_missing_0x_prefix`<br>`TestRawJSONMalformedHexFailsTheAttemptAndRotates/number_non-hex_garbage`<br>`TestRawJSONMalformedHexFailsTheAttemptAndRotates/number_uppercase_hex_digits` |
| W7M2 | **KILLED** | AN EMPTY QUANTITY CAN NEVER BECOME A VALUE (timestamp): "timestamp":"" is a bytes-level protocol violation that fails the attempt and rotates — under the mutant it decodes as the Unix epoch, passes presence as a NON-NIL time, and HeaderTime dates staleness off 1970 at the malformed primary instead of landing on the healthy secondary | `TestRawJSONEmptyTimestampFailsTheAttemptAndTheSecondaryLandsHeaderTime`<br>`TestRawJSONMalformedHexFailsTheAttemptAndRotates`<br>`TestRawJSONMalformedHexFailsTheAttemptAndRotates/timestamp_0x_with_no_digits`<br>`TestRawJSONMalformedHexFailsTheAttemptAndRotates/timestamp_bare_JSON_number`<br>`TestRawJSONMalformedHexFailsTheAttemptAndRotates/timestamp_empty_string`<br>`TestRawJSONMalformedHexFailsTheAttemptAndRotates/timestamp_leading_zero_digits`<br>`TestRawJSONMalformedHexFailsTheAttemptAndRotates/timestamp_missing_0x_prefix`<br>`TestRawJSONMalformedHexFailsTheAttemptAndRotates/timestamp_non-hex_garbage`<br>`TestRawJSONMalformedHexFailsTheAttemptAndRotates/timestamp_uppercase_hex_digits` |
| W7M3 | **KILLED** | THE EMPTY STRING IS REFUSED AS WHAT IT IS — a non-answer, not zero and not a malformed prefix: the violation's name carries the discrimination (kill is at the NAME; "" is still refused by the next arm so rotation is identical — disclosed in design notes) | `TestRawJSONEmptyNumberFailsTheAttemptAndTheSecondaryLandsHeadFrom`<br>`TestRawJSONEmptyTimestampFailsTheAttemptAndTheSecondaryLandsHeaderTime`<br>`TestRawJSONMalformedHexFailsTheAttemptAndRotates`<br>`TestRawJSONMalformedHexFailsTheAttemptAndRotates/number_empty_string`<br>`TestRawJSONMalformedHexFailsTheAttemptAndRotates/timestamp_empty_string` |
| W7M4 | **KILLED** | THE CANON IS WHAT THE REFERENCE ENCODER EMITS — lowercase digits only: "0x5A" is a representation no honest geth-derived node ever serves, and it must be refused at the bytes even though hexutil would happily decode it (for the number field it would then pass the exact-height gate too, so the canon gate is the ONLY refusal line — a behavioral kill) | `TestRawJSONMalformedHexFailsTheAttemptAndRotates`<br>`TestRawJSONMalformedHexFailsTheAttemptAndRotates/number_uppercase_hex_digits`<br>`TestRawJSONMalformedHexFailsTheAttemptAndRotates/timestamp_uppercase_hex_digits` |
| W7M5 | **KILLED** | THE GATE OWNS THE COMPACTNESS RULE — "0x05a" is refused BY THE CANON, not by whatever hexutil happens to reject: under the mutant the refusal devolves to hexutil's ErrLeadingZero (rotation identical, the canon marker gone from the violation's name — a message-level kill riding the marker assertion, disclosed in design notes) | `TestRawJSONMalformedHexFailsTheAttemptAndRotates`<br>`TestRawJSONMalformedHexFailsTheAttemptAndRotates/number_leading_zero_digits`<br>`TestRawJSONMalformedHexFailsTheAttemptAndRotates/timestamp_leading_zero_digits` |
| W7M6 | **KILLED** | THE GATE OWNS THE ZERO RULE — "0x" is refused BY THE CANON (zero is "0x0"), not by hexutil's ErrEmptyNumber: under the mutant the refusal devolves to the library whose leniency profile is the finding (rotation identical, the canon marker gone — a message-level kill, disclosed in design notes) | `TestRawJSONMalformedHexFailsTheAttemptAndRotates`<br>`TestRawJSONMalformedHexFailsTheAttemptAndRotates/number_0x_with_no_digits`<br>`TestRawJSONMalformedHexFailsTheAttemptAndRotates/timestamp_0x_with_no_digits` |

6 mutants, 6 killed, 0 survived.
