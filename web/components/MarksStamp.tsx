import { formatBlock } from "@/lib/format";
import styles from "./primitives.module.css";

export interface Mark {
  /** The letter of the mockup grammar: B (balances), P (params), S (sweep). */
  letter: string;
  /**
   * The block this mark was proven at, or null when the mark is ABSENT
   * (e.g. a failed sweep). Absent renders `S ∅` — visibly, never dropped.
   */
  block: number | null;
}

/**
 * The mockup's marks grammar: `B·P·S @25,641,712`, `B·P @25,641,730 · S ∅`.
 *
 * Consecutive marks proven at the SAME block group into one `L·L @block`
 * clause; an absent mark renders as `L ∅`. There is deliberately no way to
 * render a mark without either a block or the absence glyph.
 */
export function MarksStamp({ marks }: { marks: readonly Mark[] }) {
  const clauses: string[] = [];
  let letters: string[] = [];
  let block: number | null = null;
  let open = false;

  const flush = () => {
    if (!open) return;
    clauses.push(
      block === null ? `${letters.join("·")} ∅` : `${letters.join("·")} @${formatBlock(block)}`,
    );
    letters = [];
    open = false;
  };

  for (const mark of marks) {
    if (open && mark.block === block) {
      letters.push(mark.letter);
      continue;
    }
    flush();
    letters = [mark.letter];
    block = mark.block;
    open = true;
  }
  flush();

  return (
    <span className={styles.marks}>
      {clauses.map((clause, index) => (
        <span key={clause + String(index)}>
          {index > 0 && " · "}
          {clause.endsWith("∅") ? (
            <>
              {clause.slice(0, -1)}
              <span className={styles.marksAbsent}>∅</span>
            </>
          ) : (
            clause
          )}
        </span>
      ))}
    </span>
  );
}
