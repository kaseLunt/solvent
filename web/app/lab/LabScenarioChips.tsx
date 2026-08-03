import type { ScenarioDefinition } from "@solvent/client";
import { ProjectionBadge } from "@/components/ProjectionBadge";
import styles from "./lab.module.css";

/**
 * The chip's minimum. W-SD-A widened this from `RefinedScenario` so ONE chip
 * row serves both surfaces: the COMMITTED LISTING (`GET /v1/scenarios`, which
 * carries no `results` because it is configuration and not batch data) and an
 * address run's per-address scenarios (which do). `results` is therefore
 * optional, and its absence is not evidence of anything.
 */
export type ChipScenario = Pick<ScenarioDefinition, "id" | "version" | "label" | "shocks"> & {
  results?: readonly { projection: unknown }[];
};

/**
 * Whether a scenario's axis is a projection: the sealed `borrow_apy` axis (a
 * rate change never moves a spot mark), or any result already carrying a
 * projection body. Data-driven — no scenario id is consulted.
 */
export function isProjectionScenario(scenario: ChipScenario): boolean {
  return (
    scenario.shocks.some((shock) => shock.axis === "borrow_apy") ||
    (scenario.results ?? []).some((result) => result.projection !== null)
  );
}

export interface LabScenarioChipsProps {
  /** The committed set AS THE WIRE SERVED IT — never a hardcoded list. */
  scenarios: readonly ChipScenario[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

/**
 * The mockup's `.scenario-bar`, fed exclusively from the wire's committed
 * scenario set (the stress response carries id/version/label/description/
 * path_assumption/shocks per scenario). Chips render in wire order; projected
 * axes carry the PROJECTION badge.
 */
export function LabScenarioChips({ scenarios, selectedId, onSelect }: LabScenarioChipsProps) {
  return (
    <div className={styles.scenarioBar} role="tablist" aria-label="committed scenarios">
      {scenarios.map((scenario) => {
        const selected = scenario.id === selectedId;
        return (
          <button
            key={scenario.id}
            type="button"
            role="tab"
            aria-selected={selected}
            className={selected ? `${styles.chip} ${styles.chipOn}` : styles.chip}
            onClick={() => onSelect(scenario.id)}
            data-testid="lab-chip"
            data-scenario-id={scenario.id}
            title={`${scenario.id} ${scenario.version}`}
          >
            {scenario.label}
            {isProjectionScenario(scenario) && (
              <>
                {" "}
                <ProjectionBadge />
              </>
            )}
          </button>
        );
      })}
    </div>
  );
}
