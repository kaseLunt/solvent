"use client";

// A copyable code block: the terminal treatment, framed, with a header bar that
// names what the block is on the left and carries the copy affordance on the
// right — never over the code. The copied text is the VERBATIM code: rendering
// may highlight, the clipboard never differs.

import { CopyChip } from "../proof/CopyChip";
import styles from "./api.module.css";

export interface CodeBlockProps {
  /** The verbatim code — rendered AND copied. */
  code: string;
  /** What the block is, on the header bar: "TypeScript", "curl", "JSON". */
  label: string;
  /** Accessible name for the copy control, e.g. "Copy curl for GET /v1/evidence". */
  copyLabel: string;
  testId?: string;
}

export function CodeBlock({ code, label, copyLabel, testId }: CodeBlockProps) {
  return (
    <div className={styles.code}>
      <div className={styles.codeHead}>
        <span>{label}</span>
        <CopyChip text={code} label={copyLabel} />
      </div>
      <pre className={styles.codeBody} data-testid={testId}>
        {code}
      </pre>
    </div>
  );
}
