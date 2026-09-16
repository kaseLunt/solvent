// web/tests/unit/lookup-error.spec.ts
import { expect, test } from "@playwright/test";
import { describeLookupError } from "../../lib/lookup-error";

test("an Error is its message; a non-Error is stringified — an error is never turned into an answer", () => {
  expect(describeLookupError(new Error("the socket closed"))).toBe("the socket closed");
  expect(describeLookupError("offline")).toBe("offline");
  expect(describeLookupError(42)).toBe("42");
});
