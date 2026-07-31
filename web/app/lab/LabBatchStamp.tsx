import type { Batch } from "@solvent/client";
import { StampItem, Stampline } from "@/components/Stampline";
import { formatBlock } from "@/lib/format";

/**
 * The evidence pin every stress view stands on: batch identity, the
 * per-engine watermark VECTOR (never one fake global block), scenario config
 * version, and the supersession posture stated either way.
 */
export function LabBatchStamp({
  batch,
  scenarioConfigVersion,
}: {
  batch: Batch;
  scenarioConfigVersion: string;
}) {
  return (
    <Stampline>
      <StampItem label="batch" value={String(batch.id)} note={`computed ${batch.computed_at}`} />
      <StampItem label="status" value={batch.status} tone={batch.status === "complete" ? "ok" : "warn"} />
      <StampItem label="scenario_config" value={scenarioConfigVersion} />
      <StampItem
        label="supersession"
        value={batch.supersession.superseded ? "SUPERSEDED" : "not superseded"}
        tone={batch.supersession.superseded ? "warn" : "ok"}
      />
      {batch.watermarks.map((stamp) => (
        <StampItem
          key={`${stamp.engine}-${String(stamp.chain_id)}`}
          label={stamp.engine}
          value={`@${formatBlock(stamp.last_block)}`}
          tone="dim"
        />
      ))}
    </Stampline>
  );
}
