// The deep-link law, pinned: `?scenario=` and `?scenarios=` together dispatch
// NO book run and say exactly that; ids the listing does not publish are filtered BEFORE
// dispatch and NAMED with the asked/published counts; there is no
// `?scenarios=*`; more published ids than the cap dispatches nothing and
// truncates nothing.
import { expect, test } from "@playwright/test";
import { conflictNotice, deepLinkDecision, scenarioForBar, unlistedScenarioNotice } from "../../lib/lab-deep-link";

const LISTED = ["eth_minus_30", "ethfi_minus_50", "dm_rate_horizon_plus_200bps"];

test.describe("the deep-link decision", () => {
  test("no params is none; only ?scenario= defers to the existing single path", () => {
    expect(deepLinkDecision(null, null, LISTED)).toEqual({ kind: "none" });
    expect(deepLinkDecision("eth_minus_30", null, LISTED)).toEqual({ kind: "single" });
  });

  test("both params together dispatch NO book run, say exactly that, and no precedence is guessed", () => {
    const decision = deepLinkDecision("eth_minus_30", "ethfi_minus_50", LISTED);
    expect(decision.kind).toBe("conflict");
    if (decision.kind !== "conflict") return;
    expect(decision.notice).toContain("both ?scenario= and ?scenarios=");
    expect(decision.notice).toContain("no book run was dispatched for either");
    expect(decision.notice).not.toContain("NOTHING was run");
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

test.describe("the conflict notice claims only what the conflict gates", () => {
  test("the conflict gates the BOOK run and says exactly that — it never says nothing was run, because the address's own evaluation is not its to gate", () => {
    const decision = deepLinkDecision("eth_minus_30", "ethfi_minus_50", LISTED);
    if (decision.kind !== "conflict") throw new Error(decision.kind);
    expect(decision.notice).toBe(conflictNotice(false));
    expect(conflictNotice(false)).toBe(
      "This link names both ?scenario= and ?scenarios=. They are two mutually exclusive selections and no precedence is guessed between them: no book run was dispatched for either. Remove one of the two and open the link again.",
    );
    for (const shown of [false, true]) {
      expect(conflictNotice(shown)).not.toMatch(/nothing was run/i);
      expect(conflictNotice(shown)).toContain("no book run was dispatched for either");
    }
  });

  test("with an address on the page the notice says its evaluation is shown, and that neither selection gates it", () => {
    expect(conflictNotice(true)).toBe(
      `${conflictNotice(false)} The address's own evaluation is shown below: it applies every committed scenario to that one account, and neither selection gates it.`,
    );
  });
});

test.describe("the address bar is written only for a scenario somebody asked for", () => {
  const bar = (overrides: Partial<Parameters<typeof scenarioForBar>[0]>) =>
    scenarioForBar({ inboundScenario: null, readerSelected: false, subjectId: "eth_minus_30", barScenario: null, ...overrides });

  test("an opened link is left exactly as it arrived: a link naming an id the listing does not publish, or a scenario the address does not carry, is never rewritten to the subject shown — a rewritten ?scenario= link would RUN what it names on reload", () => {
    // `?scenario=ghost`: the page shows the first listed scenario, and the bar still says ghost.
    expect(bar({ inboundScenario: "ghost", barScenario: "ghost", subjectId: "eth_minus_30" })).toBeNull();
    // `?address=…&scenario=<not carried>`: the page shows the fallback, disclosed in words, and the bar is the link's.
    expect(bar({ inboundScenario: "weeth_market_depeg_oracles_held", barScenario: "weeth_market_depeg_oracles_held", subjectId: "eth_minus_30" })).toBeNull();
    // A link that names no scenario names none afterwards either, whatever the page shows by default.
    expect(bar({ inboundScenario: null, barScenario: null, subjectId: "eth_minus_30" })).toBeNull();
    // A link that names the subject shown needs no write.
    expect(bar({ inboundScenario: "eth_minus_30", barScenario: "eth_minus_30", subjectId: "eth_minus_30" })).toBeNull();
    // While no subject is determined — the listing or the stress rows still loading — nothing is written.
    expect(bar({ inboundScenario: "ghost", barScenario: "ghost", subjectId: null })).toBeNull();
    expect(bar({ readerSelected: true, barScenario: "ghost", subjectId: null })).toBeNull();
  });

  test("after the reader's own selection the bar follows the subject shown — the selection, or its disclosed fallback", () => {
    expect(bar({ readerSelected: true, inboundScenario: "ghost", barScenario: "ghost", subjectId: "ethfi_minus_50" })).toBe("ethfi_minus_50");
    // One-address mode: the row clicked is not carried, the subject is the fallback, and the bar names the subject.
    expect(bar({ readerSelected: true, barScenario: "weeth_market_depeg_oracles_held", subjectId: "eth_minus_30" })).toBe("eth_minus_30");
    expect(bar({ readerSelected: true, barScenario: null, subjectId: "ethfi_minus_50" })).toBe("ethfi_minus_50");
    // Already named: no write.
    expect(bar({ readerSelected: true, barScenario: "ethfi_minus_50", subjectId: "ethfi_minus_50" })).toBeNull();
  });

  test("a same-route navigation that dropped the query is put right only for a scenario that was asked for: the one the link itself named, never the listing's default", () => {
    // Opened on `?scenario=ethfi_minus_50`, then the shell's Scenarios link: the bar reads `/lab` over that same subject.
    expect(bar({ inboundScenario: "ethfi_minus_50", barScenario: null, subjectId: "ethfi_minus_50" })).toBe("ethfi_minus_50");
    // Opened on `?scenario=ghost`, then the same navigation: the subject is the listing's first, which nobody asked for.
    expect(bar({ inboundScenario: "ghost", barScenario: null, subjectId: "eth_minus_30" })).toBeNull();
  });
});

test.describe("a link that names a scenario this deployment does not publish says so", () => {
  test("the notice names the link's id, says nothing was run for it, and names what is shown instead; a published id, no id and an empty id say nothing", () => {
    expect(unlistedScenarioNotice("ghost", LISTED, "ETH -30 percent")).toBe(
      "This link names ?scenario=ghost, and this deployment publishes no scenario of that id. Nothing was run for it, and the link is left as it arrived. ETH -30 percent is shown instead.",
    );
    // With nothing shown in its place — an empty listing, rows still loading — the clause is left out, never invented.
    expect(unlistedScenarioNotice("ghost", [], null)).toBe(
      "This link names ?scenario=ghost, and this deployment publishes no scenario of that id. Nothing was run for it, and the link is left as it arrived.",
    );
    expect(unlistedScenarioNotice("eth_minus_30", LISTED, "ETH -30 percent")).toBeNull();
    expect(unlistedScenarioNotice(null, LISTED, "ETH -30 percent")).toBeNull();
    expect(unlistedScenarioNotice("  ", LISTED, "ETH -30 percent")).toBeNull();
  });
});
