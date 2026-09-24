"use client";

// The kit ToggleGroup, twice: a single-choice group (one engine per view, or all engines listed side by side — never
// summed) and a multi-choice group (a set of type filters). Each keeps its caller's own selection rule; both share one
// shape, one keyboard path and aria-pressed. A CLIENT component: the groups hold state.

import { useState } from "react";
import { ToggleGroup } from "@/components/kit";
import { engineList } from "@/lib/prose";

type EngineChoice = "all" | "debt_manager" | "aave_v3_etherfi";
type TypeChoice = "borrow" | "repay" | "liquidation" | "deficit_created";

const ENGINE_OPTIONS = [
  { value: "all", label: "All engines" },
  { value: "debt_manager", label: engineList(["debt_manager"]) },
  { value: "aave_v3_etherfi", label: engineList(["aave_v3_etherfi"]) },
] as const;

const TYPE_OPTIONS = [
  { value: "borrow", label: "Borrow", title: "borrow" },
  { value: "repay", label: "Repay", title: "repay" },
  { value: "liquidation", label: "Liquidation", title: "liquidation" },
  { value: "deficit_created", label: "Bad debt realized", title: "deficit_created" },
] as const;

export function ToggleGroupDemo() {
  const [engine, setEngine] = useState<EngineChoice>("all");
  const [types, setTypes] = useState<readonly TypeChoice[]>([]);
  return (
    <>
      <ToggleGroup
        label="Engine"
        testId="sg-tg-engine"
        optionTestId={(value) => `sg-tg-engine-${value}`}
        options={ENGINE_OPTIONS}
        isPressed={(value) => value === engine}
        onToggle={setEngine}
      />
      <ToggleGroup
        label="Type"
        testId="sg-tg-type"
        optionTestId={(value) => `sg-tg-type-${value}`}
        options={TYPE_OPTIONS}
        isPressed={(value) => types.includes(value)}
        onToggle={(value) => setTypes((now) => (now.includes(value) ? now.filter((type) => type !== value) : [...now, value]))}
      />
    </>
  );
}
