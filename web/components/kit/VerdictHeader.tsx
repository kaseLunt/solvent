import type { ReactNode } from "react";
import { IdentityChips, type IdentityChip } from "./IdentityChips";
import styles from "./kit.module.css";

export interface VerdictHeaderProps {
  kicker: ReactNode;
  /** The money phrase that carries the verdict color. */
  emphasis: string;
  rest?: string;
  tone: "crit" | "warn" | "ok" | "refused";
  dek: string;
  chips: IdentityChip[];
  actions?: ReactNode;
  testId?: string;
}

const EM_CLASS = {
  crit: styles.emCrit,
  warn: styles.emWarn,
  ok: styles.emOk,
  refused: styles.emRefused,
} as const;

/** The page answer. Never renders without identity: an empty chip list renders the refusal chip. */
export function VerdictHeader({ kicker, emphasis, rest = "", tone, dek, chips, actions, testId }: VerdictHeaderProps) {
  const identity: IdentityChip[] =
    chips.length > 0 ? chips : [{ label: "Identity", value: "missing", tone: "refused" }];
  const sub = (suffix: string): string | undefined => (testId === undefined ? undefined : `${testId}-${suffix}`);
  return (
    <header data-testid={testId} data-variant={tone}>
      <p className={styles.kick}>{kicker}</p>
      <h1 className={styles.h1} data-testid={sub("headline")}>
        <b className={EM_CLASS[tone]}>{emphasis}</b>
        {rest === "" ? null : /^\s/.test(rest) ? rest : ` ${rest}`}
      </h1>
      <p className={styles.dek} data-testid={sub("dek")}>
        {dek}
      </p>
      <IdentityChips chips={identity} trailing={actions} testId={sub("identity")} />
    </header>
  );
}
