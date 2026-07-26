# mutation transcript

- spec: `mutations.json`
- repo: `C:\Users\kasel\source\repos\etherfi\Solvent`
- **tested SHA: `29ac4ae0e9a95d768ee6bcf72e7d93422c5d6668`**  (chore(sdd): task-9 wave-8 mutation spec extended â€” W8M13/W8M14 (tx answered-identity gate), committed before the definitive loop)
- started (UTC): 2026-07-26T14:00:21+00:00
- applier: `mutate.py`, exactly-one-occurrence assertion in `apply_edit`

## W8M1 — the eth_blockNumber path skips the canon gate: hexutil's leniency decodes "" (and null) as height zero — the round-7 F1 finding restored

**Property under attack:** AN EMPTY QUANTITY CAN NEVER BECOME A VALUE (eth_blockNumber): "" is a bytes-level protocol violation that fails the attempt and rotates — under the mutant it decodes as height 0, the attempt SUCCEEDS at the malformed primary, no rotation happens, and Walker.Step sees a head below confirmations and starves despite the healthy secondary

```diff
--- internal/chain/chain.go:394
-	if err := checkCanonicalQuantity("eth_blockNumber response result", raw); err != nil {
-		return 0, err
-	}
+	// MUTANT W8M1: the eth_blockNumber path skips the canon gate — hexutil's leniency decodes "" as height zero
```
APPLIED at internal/chain/chain.go:394 (1 occurrence, asserted)

`go test ./internal/chain/ -count=1`

Killed by:
  - `TestRawJSONBlockNumberMatrixFailsEveryNonCanonicalForm`
  - `TestRawJSONBlockNumberMatrixFailsEveryNonCanonicalForm/0x_with_no_digits`
  - `TestRawJSONBlockNumberMatrixFailsEveryNonCanonicalForm/a_null_result_is_a_non-answer,_not_height_zero`
  - `TestRawJSONBlockNumberMatrixFailsEveryNonCanonicalForm/bare_JSON_number`
  - `TestRawJSONBlockNumberMatrixFailsEveryNonCanonicalForm/empty_string`
  - `TestRawJSONBlockNumberMatrixFailsEveryNonCanonicalForm/leading_zero_digits`
  - `TestRawJSONBlockNumberMatrixFailsEveryNonCanonicalForm/missing_0x_prefix`
  - `TestRawJSONBlockNumberMatrixFailsEveryNonCanonicalForm/non-hex_garbage`
  - `TestRawJSONBlockNumberMatrixFailsEveryNonCanonicalForm/uppercase_hex_digits`
  - `TestRawJSONEmptyBlockNumberFailsTheAttemptAndTheSecondaryLandsHeight`

**Result: KILLED**

## W8M2 — the logIndex wrapper skips the canon gate: hexutil's leniency decodes "" as a present index zero — the round-7 F2 finding restored

**Property under attack:** AN EMPTY QUANTITY CAN NEVER BECOME A VALUE (log logIndex): "logIndex":"" is a bytes-level protocol violation that fails the attempt and rotates — under the mutant it decodes as a PRESENT zero, the attempt succeeds at the malformed primary, and index 0 is handed downstream as the raw-log identity/order to persist

```diff
--- internal/chain/chain.go:478
-	if err := checkCanonicalQuantity("log response logIndex", input); err != nil {
-		return err
-	}
+	// MUTANT W8M2: the logIndex wrapper skips the canon gate — hexutil's leniency decodes "" as index zero
```
APPLIED at internal/chain/chain.go:478 (1 occurrence, asserted)

`go test ./internal/chain/ -count=1`

Killed by:
  - `TestRawJSONEmptyLogIndexFailsTheAttemptAndTheSecondaryLandsTheWindow`
  - `TestRawJSONLogQuantityAndDataMatrixFailsEveryNonCanonicalForm`
  - `TestRawJSONLogQuantityAndDataMatrixFailsEveryNonCanonicalForm/logIndex_0x_with_no_digits`
  - `TestRawJSONLogQuantityAndDataMatrixFailsEveryNonCanonicalForm/logIndex_bare_JSON_number`
  - `TestRawJSONLogQuantityAndDataMatrixFailsEveryNonCanonicalForm/logIndex_empty_string`
  - `TestRawJSONLogQuantityAndDataMatrixFailsEveryNonCanonicalForm/logIndex_leading_zero_digits`
  - `TestRawJSONLogQuantityAndDataMatrixFailsEveryNonCanonicalForm/logIndex_missing_0x_prefix`
  - `TestRawJSONLogQuantityAndDataMatrixFailsEveryNonCanonicalForm/logIndex_non-hex_garbage`
  - `TestRawJSONLogQuantityAndDataMatrixFailsEveryNonCanonicalForm/logIndex_uppercase_hex_digits`

**Result: KILLED**

## W8M3 — the log blockNumber wrapper skips the canon gate

**Property under attack:** AN EMPTY QUANTITY CAN NEVER BECOME A VALUE (log blockNumber): "blockNumber":"" would decode as height 0 — outside any requested window, but the refusal must happen at the bytes in THIS package, not rely on the walker's window check one consumer up

```diff
--- internal/chain/chain.go:469
-	if err := checkCanonicalQuantity("log response blockNumber", input); err != nil {
-		return err
-	}
+	// MUTANT W8M3: the log blockNumber wrapper skips the canon gate
```
APPLIED at internal/chain/chain.go:469 (1 occurrence, asserted)

`go test ./internal/chain/ -count=1`

Killed by:
  - `TestRawJSONLogQuantityAndDataMatrixFailsEveryNonCanonicalForm`
  - `TestRawJSONLogQuantityAndDataMatrixFailsEveryNonCanonicalForm/blockNumber_0x_with_no_digits`
  - `TestRawJSONLogQuantityAndDataMatrixFailsEveryNonCanonicalForm/blockNumber_bare_JSON_number`
  - `TestRawJSONLogQuantityAndDataMatrixFailsEveryNonCanonicalForm/blockNumber_empty_string`
  - `TestRawJSONLogQuantityAndDataMatrixFailsEveryNonCanonicalForm/blockNumber_leading_zero_digits`
  - `TestRawJSONLogQuantityAndDataMatrixFailsEveryNonCanonicalForm/blockNumber_missing_0x_prefix`
  - `TestRawJSONLogQuantityAndDataMatrixFailsEveryNonCanonicalForm/blockNumber_non-hex_garbage`
  - `TestRawJSONLogQuantityAndDataMatrixFailsEveryNonCanonicalForm/blockNumber_uppercase_hex_digits`

**Result: KILLED**

## W8M4 — the log transactionIndex wrapper skips the canon gate

**Property under attack:** AN EMPTY QUANTITY CAN NEVER BECOME A VALUE (log transactionIndex): "transactionIndex":"" would decode as a present zero and flow into the walker's duplicate-conflict comparison — the gate refuses it per-field, isolated from its siblings

```diff
--- internal/chain/chain.go:487
-	if err := checkCanonicalQuantity("log response transactionIndex", input); err != nil {
-		return err
-	}
+	// MUTANT W8M4: the log transactionIndex wrapper skips the canon gate
```
APPLIED at internal/chain/chain.go:487 (1 occurrence, asserted)

`go test ./internal/chain/ -count=1`

Killed by:
  - `TestRawJSONLogQuantityAndDataMatrixFailsEveryNonCanonicalForm`
  - `TestRawJSONLogQuantityAndDataMatrixFailsEveryNonCanonicalForm/transactionIndex_0x_with_no_digits`
  - `TestRawJSONLogQuantityAndDataMatrixFailsEveryNonCanonicalForm/transactionIndex_bare_JSON_number`
  - `TestRawJSONLogQuantityAndDataMatrixFailsEveryNonCanonicalForm/transactionIndex_empty_string`
  - `TestRawJSONLogQuantityAndDataMatrixFailsEveryNonCanonicalForm/transactionIndex_leading_zero_digits`
  - `TestRawJSONLogQuantityAndDataMatrixFailsEveryNonCanonicalForm/transactionIndex_missing_0x_prefix`
  - `TestRawJSONLogQuantityAndDataMatrixFailsEveryNonCanonicalForm/transactionIndex_non-hex_garbage`
  - `TestRawJSONLogQuantityAndDataMatrixFailsEveryNonCanonicalForm/transactionIndex_uppercase_hex_digits`

**Result: KILLED**

## W8M5 — the log data wrapper skips the data canon: hexutil.Bytes lenient-accepts "" as an empty payload and uppercase as the bytes

**Property under attack:** AN EMPTY PAYLOAD CAN NEVER BECOME A VALUE (log data): "data":"" is a non-answer, not an empty event payload — under the mutant the read SUCCEEDS and the minted empty payload would persist as raw-log source of truth (behavioral for the empty and uppercase arms, the two forms hexutil accepts)

```diff
--- internal/chain/chain.go:496
-	if err := checkCanonicalData("log response data", input); err != nil {
-		return err
-	}
+	// MUTANT W8M5: the log data wrapper skips the data canon — hexutil's leniency decodes "" as an empty payload
```
APPLIED at internal/chain/chain.go:496 (1 occurrence, asserted)

`go test ./internal/chain/ -count=1`

Killed by:
  - `TestRawJSONLogQuantityAndDataMatrixFailsEveryNonCanonicalForm`
  - `TestRawJSONLogQuantityAndDataMatrixFailsEveryNonCanonicalForm/data_bare_JSON_number`
  - `TestRawJSONLogQuantityAndDataMatrixFailsEveryNonCanonicalForm/data_empty_string`
  - `TestRawJSONLogQuantityAndDataMatrixFailsEveryNonCanonicalForm/data_missing_0x_prefix`
  - `TestRawJSONLogQuantityAndDataMatrixFailsEveryNonCanonicalForm/data_non-hex_garbage`
  - `TestRawJSONLogQuantityAndDataMatrixFailsEveryNonCanonicalForm/data_odd_digit_count`
  - `TestRawJSONLogQuantityAndDataMatrixFailsEveryNonCanonicalForm/data_uppercase_hex_digits`

**Result: KILLED**

## W8M6 — the data canon's empty-rejection arm is deleted: "" falls through to the 0x-prefix arm

**Property under attack:** THE EMPTY PAYLOAD IS REFUSED AS WHAT IT IS — a non-answer, not a malformed prefix: the violation's name carries the discrimination (kill is at the NAME; "" is still refused by the next arm so rotation is identical — disclosed in design notes). Shared by both data-canon call sites, so the kill list spans log data AND tx input

```diff
--- internal/chain/chain.go:266
-	if len(s) == 0 {
-		return violation(`empty — an empty payload is a non-answer; the canonical empty payload is "0x"`)
-	}
+	// MUTANT W8M6: the data canon's empty-rejection arm is deleted — "" falls through to the prefix arm
```
APPLIED at internal/chain/chain.go:266 (1 occurrence, asserted)

`go test ./internal/chain/ -count=1`

Killed by:
  - `TestRawJSONEmptyTxInputFailsTheAttemptAndTheSecondaryLandsCalldata`
  - `TestRawJSONLogQuantityAndDataMatrixFailsEveryNonCanonicalForm`
  - `TestRawJSONLogQuantityAndDataMatrixFailsEveryNonCanonicalForm/data_empty_string`

**Result: KILLED**

## W8M7 — the null-window gate is deleted: a null eth_getLogs result decodes as an empty window and the attempt succeeds

**Property under attack:** A NULL RESULT CAN NEVER IMPERSONATE THE EMPTY WINDOW: the provider's honest "no logs in this range" is [] — under the mutant a null non-answer SUCCEEDS as zero logs at the malformed primary, no rotation happens, and the walker advances its cursor over a window nobody actually answered for

```diff
--- internal/chain/chain.go:580
-	if trimmed := bytes.TrimSpace(raw); len(trimmed) == 0 || bytes.Equal(trimmed, []byte("null")) {
-		return nil, fmt.Errorf("log response result is null — a provider protocol violation; an empty window is answered with [], so a null non-answer is refused before it can impersonate one")
-	}
+	// MUTANT W8M7: the null-window gate is deleted — null decodes as an empty window and the attempt succeeds
```
APPLIED at internal/chain/chain.go:580 (1 occurrence, asserted)

`go test ./internal/chain/ -count=1`

Killed by:
  - `TestRawJSONLogPresenceAndNullWindowAreProtocolViolations`
  - `TestRawJSONLogPresenceAndNullWindowAreProtocolViolations/a_null_result_cannot_impersonate_the_empty_window`

**Result: KILLED**

## W8M8 — logIndex presence devolves to zero: the absence is no longer named and the conversion defaults an absent index to 0 — the pinned decoder's own leniency restored

**Property under attack:** AN ABSENT logIndex CAN NEVER BECOME INDEX ZERO: an omitted logIndex in a mined log is a named protocol violation that fails the attempt — under the mutant it silently becomes index 0 (exactly what gen_log_json.go does today, audit-executed) and persists as the raw-log order

```diff
--- internal/chain/chain.go:541
-	if l.Index == nil {
-		missing = append(missing, "logIndex")
-	}
+	// MUTANT W8M8a: an absent logIndex is no longer named missing
```
APPLIED at internal/chain/chain.go:541 (1 occurrence, asserted)

```diff
--- internal/chain/chain.go:603
-			Index:       uint(*l.Index),
+			Index: func() uint { if l.Index == nil { return 0 }; return uint(*l.Index) }(), // MUTANT W8M8b: an absent logIndex devolves to zero
```
APPLIED at internal/chain/chain.go:603 (1 occurrence, asserted)

`go test ./internal/chain/ -count=1`

Killed by:
  - `TestRawJSONLogPresenceAndNullWindowAreProtocolViolations`
  - `TestRawJSONLogPresenceAndNullWindowAreProtocolViolations/omitted_logIndex`

**Result: KILLED**

## W8M9 — log blockNumber presence devolves to zero: the absence is no longer named and the conversion defaults an absent height to 0

**Property under attack:** AN ABSENT blockNumber CAN NEVER BECOME HEIGHT ZERO: an omitted blockNumber in a mined log is a named protocol violation that fails the attempt — under the mutant it silently becomes height 0, the pinned decoder's own leniency (audit-executed)

```diff
--- internal/chain/chain.go:529
-	if l.BlockNumber == nil {
-		missing = append(missing, "blockNumber")
-	}
+	// MUTANT W8M9a: an absent blockNumber is no longer named missing
```
APPLIED at internal/chain/chain.go:529 (1 occurrence, asserted)

```diff
--- internal/chain/chain.go:599
-			BlockNumber: uint64(*l.BlockNumber),
+			BlockNumber: func() uint64 { if l.BlockNumber == nil { return 0 }; return uint64(*l.BlockNumber) }(), // MUTANT W8M9b: an absent blockNumber devolves to zero
```
APPLIED at internal/chain/chain.go:599 (1 occurrence, asserted)

`go test ./internal/chain/ -count=1`

Killed by:
  - `TestRawJSONLogPresenceAndNullWindowAreProtocolViolations`
  - `TestRawJSONLogPresenceAndNullWindowAreProtocolViolations/omitted_blockNumber`

**Result: KILLED**

## W8M10 — the eth_chainId path skips the canon gate: hexutil's leniency decodes "" as chain id zero

**Property under attack:** AN EMPTY QUANTITY CAN NEVER BECOME A VALUE (eth_chainId): "" is refused at the bytes — under the mutant it decodes as chain id 0, and while the equality check still refuses it against want 10 (a name-level observable), VerifyChainID(ctx, 0) PASSES outright: the refusal was relying on a wrong-value comparison one layer up, which is the exact leniency dependence the canon forbids (behavioral via the want-zero arm)

```diff
--- internal/chain/chain.go:419
-	if err := checkCanonicalQuantity("eth_chainId response result", raw); err != nil {
-		return nil, err
-	}
+	// MUTANT W8M10: the eth_chainId path skips the canon gate — hexutil's leniency decodes "" as chain id zero
```
APPLIED at internal/chain/chain.go:419 (1 occurrence, asserted)

`go test ./internal/chain/ -count=1`

Killed by:
  - `TestRawJSONChainIDStrictQuantity`
  - `TestRawJSONChainIDStrictQuantity/0x_with_no_digits`
  - `TestRawJSONChainIDStrictQuantity/bare_JSON_number`
  - `TestRawJSONChainIDStrictQuantity/empty_chainId_is_a_canon_violation,_not_chain_id_zero`
  - `TestRawJSONChainIDStrictQuantity/empty_string`
  - `TestRawJSONChainIDStrictQuantity/leading_zero_digits`
  - `TestRawJSONChainIDStrictQuantity/missing_0x_prefix`
  - `TestRawJSONChainIDStrictQuantity/non-hex_garbage`
  - `TestRawJSONChainIDStrictQuantity/uppercase_hex_digits`

**Result: KILLED**

## W8M11 — the tx input wrapper skips the data canon: hexutil.Bytes lenient-accepts "" as empty calldata

**Property under attack:** AN EMPTY PAYLOAD CAN NEVER BECOME A VALUE (tx input): "input":"" is a non-answer, not a plain transfer's empty calldata — under the mutant TxCalldata SUCCEEDS with minted empty calldata from the malformed primary (behavioral: the migration-genesis path would derive zero borrower seeds from a response that answered nothing)

```diff
--- internal/chain/chain.go:660
-	if err := checkCanonicalData("transaction response input", input); err != nil {
-		return err
-	}
+	// MUTANT W8M11: the tx input wrapper skips the data canon — hexutil's leniency decodes "" as empty calldata
```
APPLIED at internal/chain/chain.go:660 (1 occurrence, asserted)

`go test ./internal/chain/ -count=1`

Killed by:
  - `TestRawJSONEmptyTxInputFailsTheAttemptAndTheSecondaryLandsCalldata`

**Result: KILLED**

## W8M12 — the tx input presence check is deleted: an omitted input devolves to the pinned decoder's own required-field refusal

**Property under attack:** THE GATE OWNS THE ABSENCE REFUSAL — an omitted input is named by THIS package's violation, not by whatever the lenient library's required-field list happens to refuse: under the mutant the refusal devolves to 'missing required field input in transaction' (rotation identical, the package's violation name gone — a message-level kill, disclosed in design notes)

```diff
--- internal/chain/chain.go:714
-	if probe.Input == nil {
-		return nil, false, fmt.Errorf("transaction response omits required field input — a provider protocol violation; an absent field must surface as absent, never decode as a plausible zero value")
-	}
+	// MUTANT W8M12: the tx input presence check is deleted — the library's required-field list dominates
```
APPLIED at internal/chain/chain.go:714 (1 occurrence, asserted)

`go test ./internal/chain/ -count=1`

Killed by:
  - `TestRawJSONEmptyTxInputFailsTheAttemptAndTheSecondaryLandsCalldata`
  - `TestRawJSONEmptyTxInputFailsTheAttemptAndTheSecondaryLandsCalldata/omitted_input_is_a_named_absence,_not_empty_calldata`

**Result: KILLED**

## W8M13 — the tx answered-identity gate is deleted: a well-formed response for the WRONG transaction succeeds

**Property under attack:** THE RESPONSE MUST ANSWER THE QUESTION ASKED (tx path): a hash-keyed read serves exactly the transaction asked for — under the mutant a proxy reporting another transaction's hash SUCCEEDS and TxCalldata hands the deriver the wrong transaction's calldata (behavioral: the wrong-tx read succeeds where the regression asserts violation-plus-rotation-plus-landing)

```diff
--- internal/chain/chain.go:720
-	if *probe.Hash != hash {
-		return nil, false, fmt.Errorf("transaction response answers for transaction %s — a provider protocol violation; a hash-keyed read serves exactly the transaction asked for or fails the attempt", *probe.Hash)
-	}
+	// MUTANT W8M13: the answered-identity gate is deleted — any well-formed transaction passes for any asked hash
```
APPLIED at internal/chain/chain.go:720 (1 occurrence, asserted)

`go test ./internal/chain/ -count=1`

Killed by:
  - `TestRawJSONWrongTransactionAnsweredIsAViolationThatRotates`

**Result: KILLED**

## W8M14 — the tx hash presence arm devolves to a skipped check: an absent hash is no longer named and the identity comparison is silently skipped

**Property under attack:** AN ABSENT REPORTED HASH CAN NEVER SKIP THE IDENTITY CHECK: an omitted hash field is a named protocol violation that fails the attempt — under the mutant the response passes unidentified and the read succeeds (behavioral)

```diff
--- internal/chain/chain.go:717
-	if probe.Hash == nil {
-		return nil, false, fmt.Errorf("transaction response omits required field hash — a provider protocol violation; an absent field must surface as absent, never decode as a plausible zero value")
-	}
+	// MUTANT W8M14a: an absent reported hash is no longer named missing
```
APPLIED at internal/chain/chain.go:717 (1 occurrence, asserted)

```diff
--- internal/chain/chain.go:718
-	if *probe.Hash != hash {
+	if probe.Hash != nil && *probe.Hash != hash { // MUTANT W8M14b: an absent hash skips the identity check
```
APPLIED at internal/chain/chain.go:718 (1 occurrence, asserted)

`go test ./internal/chain/ -count=1`

Killed by:
  - `TestRawJSONWrongTransactionAnsweredIsAViolationThatRotates`
  - `TestRawJSONWrongTransactionAnsweredIsAViolationThatRotates/omitted_hash_is_a_named_absence,_not_a_skipped_check`

**Result: KILLED**

## restore verification

`git status --porcelain` over the 1 mutated file(s) is EMPTY: every file is byte-identical to `29ac4ae`. Restores came from in-memory copies taken before each edit; `git checkout` is never used.

## summary

| # | result | property | killed by |
|---|---|---|---|
| W8M1 | **KILLED** | AN EMPTY QUANTITY CAN NEVER BECOME A VALUE (eth_blockNumber): "" is a bytes-level protocol violation that fails the attempt and rotates — under the mutant it decodes as height 0, the attempt SUCCEEDS at the malformed primary, no rotation happens, and Walker.Step sees a head below confirmations and starves despite the healthy secondary | `TestRawJSONBlockNumberMatrixFailsEveryNonCanonicalForm`<br>`TestRawJSONBlockNumberMatrixFailsEveryNonCanonicalForm/0x_with_no_digits`<br>`TestRawJSONBlockNumberMatrixFailsEveryNonCanonicalForm/a_null_result_is_a_non-answer,_not_height_zero`<br>`TestRawJSONBlockNumberMatrixFailsEveryNonCanonicalForm/bare_JSON_number`<br>`TestRawJSONBlockNumberMatrixFailsEveryNonCanonicalForm/empty_string`<br>`TestRawJSONBlockNumberMatrixFailsEveryNonCanonicalForm/leading_zero_digits`<br>`TestRawJSONBlockNumberMatrixFailsEveryNonCanonicalForm/missing_0x_prefix`<br>`TestRawJSONBlockNumberMatrixFailsEveryNonCanonicalForm/non-hex_garbage`<br>`TestRawJSONBlockNumberMatrixFailsEveryNonCanonicalForm/uppercase_hex_digits`<br>`TestRawJSONEmptyBlockNumberFailsTheAttemptAndTheSecondaryLandsHeight` |
| W8M2 | **KILLED** | AN EMPTY QUANTITY CAN NEVER BECOME A VALUE (log logIndex): "logIndex":"" is a bytes-level protocol violation that fails the attempt and rotates — under the mutant it decodes as a PRESENT zero, the attempt succeeds at the malformed primary, and index 0 is handed downstream as the raw-log identity/order to persist | `TestRawJSONEmptyLogIndexFailsTheAttemptAndTheSecondaryLandsTheWindow`<br>`TestRawJSONLogQuantityAndDataMatrixFailsEveryNonCanonicalForm`<br>`TestRawJSONLogQuantityAndDataMatrixFailsEveryNonCanonicalForm/logIndex_0x_with_no_digits`<br>`TestRawJSONLogQuantityAndDataMatrixFailsEveryNonCanonicalForm/logIndex_bare_JSON_number`<br>`TestRawJSONLogQuantityAndDataMatrixFailsEveryNonCanonicalForm/logIndex_empty_string`<br>`TestRawJSONLogQuantityAndDataMatrixFailsEveryNonCanonicalForm/logIndex_leading_zero_digits`<br>`TestRawJSONLogQuantityAndDataMatrixFailsEveryNonCanonicalForm/logIndex_missing_0x_prefix`<br>`TestRawJSONLogQuantityAndDataMatrixFailsEveryNonCanonicalForm/logIndex_non-hex_garbage`<br>`TestRawJSONLogQuantityAndDataMatrixFailsEveryNonCanonicalForm/logIndex_uppercase_hex_digits` |
| W8M3 | **KILLED** | AN EMPTY QUANTITY CAN NEVER BECOME A VALUE (log blockNumber): "blockNumber":"" would decode as height 0 — outside any requested window, but the refusal must happen at the bytes in THIS package, not rely on the walker's window check one consumer up | `TestRawJSONLogQuantityAndDataMatrixFailsEveryNonCanonicalForm`<br>`TestRawJSONLogQuantityAndDataMatrixFailsEveryNonCanonicalForm/blockNumber_0x_with_no_digits`<br>`TestRawJSONLogQuantityAndDataMatrixFailsEveryNonCanonicalForm/blockNumber_bare_JSON_number`<br>`TestRawJSONLogQuantityAndDataMatrixFailsEveryNonCanonicalForm/blockNumber_empty_string`<br>`TestRawJSONLogQuantityAndDataMatrixFailsEveryNonCanonicalForm/blockNumber_leading_zero_digits`<br>`TestRawJSONLogQuantityAndDataMatrixFailsEveryNonCanonicalForm/blockNumber_missing_0x_prefix`<br>`TestRawJSONLogQuantityAndDataMatrixFailsEveryNonCanonicalForm/blockNumber_non-hex_garbage`<br>`TestRawJSONLogQuantityAndDataMatrixFailsEveryNonCanonicalForm/blockNumber_uppercase_hex_digits` |
| W8M4 | **KILLED** | AN EMPTY QUANTITY CAN NEVER BECOME A VALUE (log transactionIndex): "transactionIndex":"" would decode as a present zero and flow into the walker's duplicate-conflict comparison — the gate refuses it per-field, isolated from its siblings | `TestRawJSONLogQuantityAndDataMatrixFailsEveryNonCanonicalForm`<br>`TestRawJSONLogQuantityAndDataMatrixFailsEveryNonCanonicalForm/transactionIndex_0x_with_no_digits`<br>`TestRawJSONLogQuantityAndDataMatrixFailsEveryNonCanonicalForm/transactionIndex_bare_JSON_number`<br>`TestRawJSONLogQuantityAndDataMatrixFailsEveryNonCanonicalForm/transactionIndex_empty_string`<br>`TestRawJSONLogQuantityAndDataMatrixFailsEveryNonCanonicalForm/transactionIndex_leading_zero_digits`<br>`TestRawJSONLogQuantityAndDataMatrixFailsEveryNonCanonicalForm/transactionIndex_missing_0x_prefix`<br>`TestRawJSONLogQuantityAndDataMatrixFailsEveryNonCanonicalForm/transactionIndex_non-hex_garbage`<br>`TestRawJSONLogQuantityAndDataMatrixFailsEveryNonCanonicalForm/transactionIndex_uppercase_hex_digits` |
| W8M5 | **KILLED** | AN EMPTY PAYLOAD CAN NEVER BECOME A VALUE (log data): "data":"" is a non-answer, not an empty event payload — under the mutant the read SUCCEEDS and the minted empty payload would persist as raw-log source of truth (behavioral for the empty and uppercase arms, the two forms hexutil accepts) | `TestRawJSONLogQuantityAndDataMatrixFailsEveryNonCanonicalForm`<br>`TestRawJSONLogQuantityAndDataMatrixFailsEveryNonCanonicalForm/data_bare_JSON_number`<br>`TestRawJSONLogQuantityAndDataMatrixFailsEveryNonCanonicalForm/data_empty_string`<br>`TestRawJSONLogQuantityAndDataMatrixFailsEveryNonCanonicalForm/data_missing_0x_prefix`<br>`TestRawJSONLogQuantityAndDataMatrixFailsEveryNonCanonicalForm/data_non-hex_garbage`<br>`TestRawJSONLogQuantityAndDataMatrixFailsEveryNonCanonicalForm/data_odd_digit_count`<br>`TestRawJSONLogQuantityAndDataMatrixFailsEveryNonCanonicalForm/data_uppercase_hex_digits` |
| W8M6 | **KILLED** | THE EMPTY PAYLOAD IS REFUSED AS WHAT IT IS — a non-answer, not a malformed prefix: the violation's name carries the discrimination (kill is at the NAME; "" is still refused by the next arm so rotation is identical — disclosed in design notes). Shared by both data-canon call sites, so the kill list spans log data AND tx input | `TestRawJSONEmptyTxInputFailsTheAttemptAndTheSecondaryLandsCalldata`<br>`TestRawJSONLogQuantityAndDataMatrixFailsEveryNonCanonicalForm`<br>`TestRawJSONLogQuantityAndDataMatrixFailsEveryNonCanonicalForm/data_empty_string` |
| W8M7 | **KILLED** | A NULL RESULT CAN NEVER IMPERSONATE THE EMPTY WINDOW: the provider's honest "no logs in this range" is [] — under the mutant a null non-answer SUCCEEDS as zero logs at the malformed primary, no rotation happens, and the walker advances its cursor over a window nobody actually answered for | `TestRawJSONLogPresenceAndNullWindowAreProtocolViolations`<br>`TestRawJSONLogPresenceAndNullWindowAreProtocolViolations/a_null_result_cannot_impersonate_the_empty_window` |
| W8M8 | **KILLED** | AN ABSENT logIndex CAN NEVER BECOME INDEX ZERO: an omitted logIndex in a mined log is a named protocol violation that fails the attempt — under the mutant it silently becomes index 0 (exactly what gen_log_json.go does today, audit-executed) and persists as the raw-log order | `TestRawJSONLogPresenceAndNullWindowAreProtocolViolations`<br>`TestRawJSONLogPresenceAndNullWindowAreProtocolViolations/omitted_logIndex` |
| W8M9 | **KILLED** | AN ABSENT blockNumber CAN NEVER BECOME HEIGHT ZERO: an omitted blockNumber in a mined log is a named protocol violation that fails the attempt — under the mutant it silently becomes height 0, the pinned decoder's own leniency (audit-executed) | `TestRawJSONLogPresenceAndNullWindowAreProtocolViolations`<br>`TestRawJSONLogPresenceAndNullWindowAreProtocolViolations/omitted_blockNumber` |
| W8M10 | **KILLED** | AN EMPTY QUANTITY CAN NEVER BECOME A VALUE (eth_chainId): "" is refused at the bytes — under the mutant it decodes as chain id 0, and while the equality check still refuses it against want 10 (a name-level observable), VerifyChainID(ctx, 0) PASSES outright: the refusal was relying on a wrong-value comparison one layer up, which is the exact leniency dependence the canon forbids (behavioral via the want-zero arm) | `TestRawJSONChainIDStrictQuantity`<br>`TestRawJSONChainIDStrictQuantity/0x_with_no_digits`<br>`TestRawJSONChainIDStrictQuantity/bare_JSON_number`<br>`TestRawJSONChainIDStrictQuantity/empty_chainId_is_a_canon_violation,_not_chain_id_zero`<br>`TestRawJSONChainIDStrictQuantity/empty_string`<br>`TestRawJSONChainIDStrictQuantity/leading_zero_digits`<br>`TestRawJSONChainIDStrictQuantity/missing_0x_prefix`<br>`TestRawJSONChainIDStrictQuantity/non-hex_garbage`<br>`TestRawJSONChainIDStrictQuantity/uppercase_hex_digits` |
| W8M11 | **KILLED** | AN EMPTY PAYLOAD CAN NEVER BECOME A VALUE (tx input): "input":"" is a non-answer, not a plain transfer's empty calldata — under the mutant TxCalldata SUCCEEDS with minted empty calldata from the malformed primary (behavioral: the migration-genesis path would derive zero borrower seeds from a response that answered nothing) | `TestRawJSONEmptyTxInputFailsTheAttemptAndTheSecondaryLandsCalldata` |
| W8M12 | **KILLED** | THE GATE OWNS THE ABSENCE REFUSAL — an omitted input is named by THIS package's violation, not by whatever the lenient library's required-field list happens to refuse: under the mutant the refusal devolves to 'missing required field input in transaction' (rotation identical, the package's violation name gone — a message-level kill, disclosed in design notes) | `TestRawJSONEmptyTxInputFailsTheAttemptAndTheSecondaryLandsCalldata`<br>`TestRawJSONEmptyTxInputFailsTheAttemptAndTheSecondaryLandsCalldata/omitted_input_is_a_named_absence,_not_empty_calldata` |
| W8M13 | **KILLED** | THE RESPONSE MUST ANSWER THE QUESTION ASKED (tx path): a hash-keyed read serves exactly the transaction asked for — under the mutant a proxy reporting another transaction's hash SUCCEEDS and TxCalldata hands the deriver the wrong transaction's calldata (behavioral: the wrong-tx read succeeds where the regression asserts violation-plus-rotation-plus-landing) | `TestRawJSONWrongTransactionAnsweredIsAViolationThatRotates` |
| W8M14 | **KILLED** | AN ABSENT REPORTED HASH CAN NEVER SKIP THE IDENTITY CHECK: an omitted hash field is a named protocol violation that fails the attempt — under the mutant the response passes unidentified and the read succeeds (behavioral) | `TestRawJSONWrongTransactionAnsweredIsAViolationThatRotates`<br>`TestRawJSONWrongTransactionAnsweredIsAViolationThatRotates/omitted_hash_is_a_named_absence,_not_a_skipped_check` |

14 mutants, 14 killed, 0 survived.
