// One operation of the committed contract (W6) — server-rendered from the
// generated extract (lib/proof-contract.gen.ts). Summary, description, params
// and response codes are the yaml's text VERBATIM; the response sample is the
// contract's own example, its provenance cited beside it.

import type { ContractOperation } from "@/lib/proof-contract.gen";
import { CodeBlock } from "./CodeBlock";
import styles from "./developers.module.css";

/** The exact curl invocation for an operation, against this deployment's API origin. */
export function curlFor(op: ContractOperation, baseUrl: string): string {
  if (op.sse) return `curl -sN "${baseUrl}${op.samplePath}"`;
  if (op.method === "POST") return `curl -s -X POST "${baseUrl}${op.samplePath}"`;
  return `curl -s "${baseUrl}${op.samplePath}"`;
}

export function EndpointCard({ op, baseUrl }: { op: ContractOperation; baseUrl: string }) {
  return (
    <section className={styles.endpoint} id={op.operationId} data-testid={`endpoint-${op.operationId}`}>
      <div className={styles.endpointHead}>
        <span className={`${styles.method} ${op.method === "POST" ? styles.methodPost : ""}`}>
          {op.method}
        </span>
        <span className={styles.path}>{op.path}</span>
        <span className={styles.summary}>{op.summary}</span>
      </div>

      {op.description.length > 0 && <p className={styles.description}>{op.description}</p>}

      {op.parameters.length > 0 && (
        <div className={styles.params}>
          {op.parameters.map((param) => (
            <div key={`${param.in}·${param.name}`} className={styles.paramRow}>
              <span className={styles.paramName}>{param.name}</span>
              <span className={styles.paramMeta}>
                {param.in} ·{" "}
                {param.required ? <span className={styles.paramRequired}>required</span> : "optional"}
              </span>
              {param.description.length > 0 && (
                <span className={styles.paramDescription}>{param.description}</span>
              )}
            </div>
          ))}
        </div>
      )}

      <CodeBlock
        code={curlFor(op, baseUrl)}
        copyLabel={`copy curl for ${op.method} ${op.path}`}
        testId={`curl-${op.operationId}`}
      />

      {op.sse ? (
        <p className={styles.sseNote}>
          text/event-stream · no JSON sample exists (or is invented) for a stream. Event names:
          snapshot · batch · degradation · unavailable; heartbeats are SSE comment frames.
        </p>
      ) : (
        <details className={styles.sample}>
          <summary className={styles.sampleSummary}>
            200 response <span className={styles.sampleSource}>· {op.exampleSource}</span>
          </summary>
          <CodeBlock
            code={JSON.stringify(op.example, null, 2)}
            copyLabel={`copy 200 sample for ${op.method} ${op.path}`}
            testId={`sample-${op.operationId}`}
          />
        </details>
      )}

      <div className={styles.responses}>
        {op.responses.map((response) => (
          <span
            key={response.code}
            className={`${styles.responseChip} ${response.code.startsWith("2") ? "" : styles.responseChipErr}`}
            title={response.description}
          >
            {response.code}
            {response.ref !== null ? ` · ${response.ref}` : ""}
          </span>
        ))}
      </div>
    </section>
  );
}
