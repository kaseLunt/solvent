import Link from "next/link";
import { ChartCard } from "@/components/kit";
import { unmeasuredSentence, type StressPreview as Preview } from "@/lib/stress-preview";
import styles from "./book.module.css";

/** The committed ETH grid for the Cash engine, one line per shocked point; the full workspace is Scenarios. */
export function StressPreview({ preview }: { preview: Preview | null }) {
  const unmeasured = preview !== null && preview.kind === "view" ? unmeasuredSentence(preview.unmeasured) : null;
  return (
    <ChartCard
      title="Stress preview"
      finding="The committed ETH shock grid, run against this batch. Every figure below is a projection."
      link={{ href: "/lab", label: "Scenarios →" }}
      testId="book-stress-preview"
    >
      {preview === null ? (
        <p className={styles.note}>This batch carries no stress grid.</p>
      ) : preview.kind === "view" ? (
        <>
          <ul className={styles.lines}>
            {preview.lines.map((line) => (
              <li key={line.shock}>
                <Link href={`/lab?scenario=${preview.scenarioId}`}>{line.text}</Link>
              </li>
            ))}
          </ul>
          {unmeasured !== null && (
            <p className={styles.note} data-testid="book-stress-unmeasured">
              {unmeasured}
            </p>
          )}
        </>
      ) : preview.kind === "refused" ? (
        <p className={styles.note}>Preview withheld: {preview.reason}.</p>
      ) : (
        <p className={styles.note}>The Cash engine is not on this batch&apos;s stress grid.</p>
      )}
    </ChartCard>
  );
}
