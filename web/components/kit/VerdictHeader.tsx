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
  /**
   * A row of the one tone grammar (lib/kit.ts TONE_GRAMMAR). `neutral` is a statement of record and wears ink — an
   * answer, even an empty one ("No recorded chain action is a bad-debt realization."), is ink. A tone's colour is a
   * verdict's, and `ok` means health only. A headline that states there is no answer is ink-2, the whole line: `refused`
   * when the service or the engine refused, `absent` when there is simply no answer here (unavailable, not run, not
   * served) — one look, two words in the DOM, because a fetch failure is never a refusal.
   */
  tone: "crit" | "warn" | "ok" | "neutral" | "refused" | "absent";
  dek: string;
  chips: IdentityChip[];
  /** The page's actions: their own column on the right of the identity chips (under them on a phone). */
  actions?: ReactNode;
  testId?: string;
}

const EM_CLASS = {
  crit: styles.emCrit,
  warn: styles.emWarn,
  ok: styles.emOk,
  neutral: styles.emNeutral,
  refused: styles.emRefused,
  absent: styles.emRefused,
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
  const absent = tone === "refused" || tone === "absent";
  return (
    <header data-testid={testId} data-variant={tone}>
      <p className={styles.kick}>{kicker}</p>
      <h1 className={absent ? `${styles.h1} ${styles.h1Absent}` : styles.h1} data-testid={sub("headline")} data-register={absent ? "absent" : undefined}>
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
