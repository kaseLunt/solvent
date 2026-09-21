import type { ReactNode } from "react";
import { splitInstants } from "@/lib/instant-split";
import { headerIdentity } from "@/lib/kit";
import { IdentityChips, type IdentityChip } from "./IdentityChips";
import styles from "./kit.module.css";

export interface VerdictHeaderProps {
  kicker: ReactNode;
  /** The money phrase that carries the verdict color. */
  emphasis: string;
  rest?: string;
  /** `neutral` is a statement of record and wears ink; a tone's color is a verdict's, and `ok` means health only. */
  tone: "crit" | "warn" | "ok" | "neutral" | "refused";
  dek: string;
  chips: IdentityChip[];
  actions?: ReactNode;
  testId?: string;
}

const EM_CLASS = {
  crit: styles.emCrit,
  warn: styles.emWarn,
  ok: styles.emOk,
  neutral: styles.emNeutral,
  refused: styles.emRefused,
} as const;

/** The sentence as written, each UTC instant inside it kept whole on one line. The text is the lib's; only the break opportunity goes. */
function unbroken(text: string): ReactNode {
  const parts = splitInstants(text);
  if (!parts.some((part) => part.instant)) return text;
  let offset = 0;
  return parts.map((part) => {
    const key = offset;
    offset += part.text.length;
    return part.instant ? (
      <span key={key} className={styles.nobr}>
        {part.text}
      </span>
    ) : (
      part.text
    );
  });
}

/** The page answer. Never renders without identity: a chip list that names nothing renders the refusal chip — the law is lib/kit's `headerIdentity`, pinned there. */
export function VerdictHeader({ kicker, emphasis, rest = "", tone, dek, chips, actions, testId }: VerdictHeaderProps) {
  const identity = headerIdentity(chips);
  const sub = (suffix: string): string | undefined => (testId === undefined ? undefined : `${testId}-${suffix}`);
  return (
    <header data-testid={testId} data-variant={tone}>
      <p className={styles.kick}>{kicker}</p>
      <h1 className={styles.h1} data-testid={sub("headline")}>
        <b className={EM_CLASS[tone]}>{unbroken(emphasis)}</b>
        {rest === "" ? null : unbroken(/^\s/.test(rest) ? rest : ` ${rest}`)}
      </h1>
      <p className={styles.dek} data-testid={sub("dek")}>
        {dek}
      </p>
      <IdentityChips chips={identity} trailing={actions} testId={sub("identity")} />
    </header>
  );
}
