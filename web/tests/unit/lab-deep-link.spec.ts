// The deep-link law, pinned: `?scenario=` and `?scenarios=` together run
// NOTHING and say so; ids the listing does not publish are filtered BEFORE
// dispatch and NAMED with the asked/published counts; there is no
// `?scenarios=*`; more published ids than the cap dispatches nothing and
// truncates nothing. Moved verbatim with `lib/lab-deep-link.ts`.
import { expect, test } from "@playwright/test";
import { deepLinkDecision } from "../../lib/lab-deep-link";

const LISTED = ["eth_minus_30", "ethfi_minus_50", "dm_rate_horizon_plus_200bps"];

test.describe("the deep-link decision", () => {
  test("no params is none; only ?scenario= defers to the existing single path", () => {
    expect(deepLinkDecision(null, null, LISTED)).toEqual({ kind: "none" });
    expect(deepLinkDecision("eth_minus_30", null, LISTED)).toEqual({ kind: "single" });
  });

  test("both params together run NOTHING and no precedence is guessed", () => {
    const decision = deepLinkDecision("eth_minus_30", "ethfi_minus_50", LISTED);
    expect(decision.kind).toBe("conflict");
    if (decision.kind !== "conflict") return;
    expect(decision.notice).toContain("both ?scenario= and ?scenarios=");
    expect(decision.notice).toContain("NOTHING was run");
    expect(decision.notice).toContain("no precedence is guessed");
  });

  test("a clean member list dispatches every id, in the link's own order, with no notice", () => {
    const decision = deepLinkDecision(null, "ethfi_minus_50,eth_minus_30", LISTED);
    expect(decision).toEqual({
      kind: "set",
      askedIds: ["ethfi_minus_50", "eth_minus_30"],
      runIds: ["ethfi_minus_50", "eth_minus_30"],
      filteredIds: [],
      overCap: false,
      notice: null,
      dispatchNotice: null,
    });
  });

  test("ids the listing does not publish are filtered BEFORE dispatch and NAMED with the counts", () => {
    const decision = deepLinkDecision(
      null,
      "eth_minus_30,stable_depeg_0995_in_band,nope_id",
      LISTED,
    );
    expect(decision.kind).toBe("set");
    if (decision.kind !== "set") return;
    expect(decision.runIds).toEqual(["eth_minus_30"]);
    expect(decision.filteredIds).toEqual(["stable_depeg_0995_in_band", "nope_id"]);
    expect(decision.notice).toContain("You asked for 3 scenario(s)");
    expect(decision.notice).toContain("this deployment publishes 1 of them");
    expect(decision.notice).toContain("stable_depeg_0995_in_band and nope_id");
    expect(decision.notice).toContain("Only the 1 published one(s) were dispatched");
  });

  test("a link of only unknown ids dispatches nothing, and says so", () => {
    const decision = deepLinkDecision(null, "ghost_one,ghost_two", LISTED);
    expect(decision.kind).toBe("set");
    if (decision.kind !== "set") return;
    expect(decision.runIds).toEqual([]);
    expect(decision.notice).toContain("Nothing was dispatched");
  });

  test("there is no ?scenarios=*: the wildcard is filtered and refused in its own words", () => {
    const decision = deepLinkDecision(null, "*,eth_minus_30", LISTED);
    expect(decision.kind).toBe("set");
    if (decision.kind !== "set") return;
    expect(decision.runIds).toEqual(["eth_minus_30"]);
    expect(decision.filteredIds).toContain("*");
    expect(decision.notice).toContain("A * is never expanded");
    expect(decision.notice).toContain("no implicit all");
  });

  test("duplicates and blanks in the param collapse; a set is a set", () => {
    const decision = deepLinkDecision(
      null,
      "eth_minus_30,,eth_minus_30, ethfi_minus_50 ",
      LISTED,
    );
    expect(decision.kind).toBe("set");
    if (decision.kind !== "set") return;
    expect(decision.askedIds).toEqual(["eth_minus_30", "ethfi_minus_50"]);
    expect(decision.runIds).toEqual(["eth_minus_30", "ethfi_minus_50"]);
  });

  test("over the contract's cap: NOTHING dispatches and nothing is silently truncated", () => {
    const many = Array.from({ length: 25 }, (_, i) => `sc_${String(i)}`);
    const decision = deepLinkDecision(null, many.join(","), many);
    expect(decision.kind).toBe("set");
    if (decision.kind !== "set") return;
    expect(decision.overCap).toBe(true);
    expect(decision.notice).toContain("caps one set-run at 24");
    expect(decision.notice).toContain("nothing was silently truncated");
  });
});
