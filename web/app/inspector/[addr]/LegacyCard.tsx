import type { RefinedPosition } from "@solvent/client";
import { KpiTile, LegacyFold, StatusPill } from "@/components/kit";
import kit from "@/components/kit/kit.module.css";
import { legacyWords } from "@/lib/inspector-view";
import { LEGACY_FOLD_TITLE } from "@/lib/prose";
import styles from "../inspector.module.css";

/** Only when the address holds a legacy Aave v3 position: its own fold, judged by its own health factor, never beside a Cash sum. */
export function LegacyCard({ position }: { position: RefinedPosition }) {
  const words = legacyWords(position);
  return (
    <LegacyFold title={LEGACY_FOLD_TITLE} summary={words.summary} testId="inspector-legacy">
      <div className={`${kit.kpis} ${kit.kpis4}`}>
        {words.tiles.map((tile) => (
          <KpiTile
            key={tile.key}
            testId={tile.key === "hf" || tile.key === "status" ? `inspector-legacy-${tile.key}` : undefined}
            label={tile.label}
            value={tile.value}
            sub={tile.sub}
            tone={tile.tone}
            state={tile.state}
            stateWord={tile.state === undefined ? undefined : tile.value}
          />
        ))}
      </div>
      {words.stale !== null && (
        <p className={styles.note}>
          <StatusPill tone={words.stale.tone}>{words.stale.word}</StatusPill> {words.stale.note}
        </p>
      )}
      <p className={styles.dim}>{words.footnote}</p>
    </LegacyFold>
  );
}
