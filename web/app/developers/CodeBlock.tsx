"use client";

// A copyable code block (W6): the mockup's .term treatment with the standard
// copy affordance in the corner. The copied text is the VERBATIM code —
// rendering may highlight, the clipboard never differs.

import { CopyChip } from "../proof/CopyChip";
import styles from "./developers.module.css";

export interface CodeBlockProps {
  /** The verbatim code — rendered AND copied. */
  code: string;
  /** Accessible name for the copy control, e.g. "copy curl for GET /v1/evidence". */
  copyLabel: string;
  testId?: string;
}

export function CodeBlock({ code, copyLabel, testId }: CodeBlockProps) {
  return (
    <div className={styles.codeWrap}>
      <pre className={styles.code} data-testid={testId}>
        {code}
      </pre>
      <span className={styles.codeCopy}>
        <CopyChip text={code} label={copyLabel} />
      </span>
    </div>
  );
}
