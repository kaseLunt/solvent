import Link from "next/link";
import { ChartCard, StatusPill } from "@/components/kit";
import { BOOK_CARDS, PROJECTION_BADGE, stressWithheldLine } from "@/lib/book-copy";
import { unmeasuredSentence, type StressPreview as Preview } from "@/lib/stress-preview";
import styles from "./book.module.css";

/**
 * The committed shock grid for the Cash engine, one line per shocked point, under the one PROJECTION badge; the full
 * workspace is Scenarios. A preview that is not there says why in the card's finding, and wears no badge: nothing on
 * it is projected.
 */
export function StressPreview({ preview }: { preview: Preview | null }) {
  const view = preview !== null && preview.kind === "view" ? preview : null;
  const unmeasured = view === null ? null : unmeasuredSentence(view.unmeasured);
  const finding =
    view !== null
      ? BOOK_CARDS.stress.finding
      : preview === null
        ? BOOK_CARDS.stress.none
        : preview.kind === "refused"
          ? stressWithheldLine(preview.reason)
          : BOOK_CARDS.stress.notOnGrid;
  return (
    <ChartCard
      title={BOOK_CARDS.stress.title}
      badge={view === null ? undefined : <StatusPill tone="projection">{PROJECTION_BADGE}</StatusPill>}
      finding={finding}
      link={{ href: view === null ? "/lab" : `/lab?scenario=${view.scenarioId}`, label: BOOK_CARDS.stress.link }}
      testId="book-stress-preview"
    >
      {view !== null && (
        <>
          <ul className={styles.lines}>
            {view.lines.map((line) => (
              <li key={line.shock}>
                <Link href={`/lab?scenario=${view.scenarioId}`}>{line.text}</Link>
              </li>
            ))}
          </ul>
          {unmeasured !== null && (
            <p className={styles.note} data-testid="book-stress-unmeasured">
              {unmeasured}
            </p>
          )}
        </>
      )}
    </ChartCard>
  );
}
