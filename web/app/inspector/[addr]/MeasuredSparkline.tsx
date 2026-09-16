"use client";

import { Sparkline, type SparklineProps } from "@/components/kit";
import { useMeasuredWidth } from "@/lib/useMeasuredWidth";
import styles from "../inspector.module.css";

type Props = Omit<SparklineProps, "width"> & {
  /** Never narrower / wider than these; `fallback` renders until the frame is measured. */
  min: number;
  max: number;
  fallback: number;
  className?: string;
  testId?: string;
};

/**
 * A sparkline sized to its frame (the mockup's `width="100%"`). The frame and
 * the measuring hook mount together, so a chart that appears after its data
 * arrives is measured on ITS mount — a frame rendered conditionally inside a
 * parent that mounted earlier would keep the fallback width forever.
 */
export function MeasuredSparkline({ min, max, fallback, className, testId, ...sparkline }: Props) {
  // `width` is state the hook sets from a ResizeObserver; no ref `.current` is read during render.
  const { ref, width } = useMeasuredWidth<HTMLDivElement>({ min, max, fallback });
  return (
    <div ref={ref} className={`${styles.frame} ${className ?? ""}`} data-testid={testId}>
      <Sparkline {...sparkline} width={width} />
    </div>
  );
}
