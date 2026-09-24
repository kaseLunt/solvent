// One operation of the committed contract — server-rendered from the
// generated extract (lib/proof-contract.gen.ts) into the kit's card. Summary,
// description, params and response codes are the yaml's text VERBATIM; the
// response sample is the contract's own example, its provenance cited beside it.
// Prose is set as paragraphs at the reading measure, and a run of "* " items as
// a list: the yaml's hard wraps and markers are a property of the file, not of
// the sentence, and the words do not change. The contract's two inline markers
// — bold and code — render as formatting (lib/api-view `inlineParts`), and its
// bracketed version notes are set quieter; every word prints as it came.

import { Fragment } from "react";
import kit from "@/components/kit/kit.module.css";
import { API_COPY, API_SSE_NOTE, contractBlocks, curlFor, inlineParts, operationCopy, versionNoteParts } from "@/lib/api-view";
import type { ContractOperation } from "@/lib/proof-contract.gen";
import styles from "./api.module.css";
import { CodeBlock } from "./CodeBlock";

/** Plain contract text, its version notes set apart. */
function Words({ text }: { text: string }) {
  return (
    <>
      {versionNoteParts(text).map((part, index) =>
        part.kind === "ver" ? (
          <span key={index} className={styles.ver}>
            {part.text}
          </span>
        ) : (
          <Fragment key={index}>{part.text}</Fragment>
        ),
      )}
    </>
  );
}

/** A contract paragraph with its markers rendered: a bold part reads its own code spans; plain text prints as it came. */
function Prose({ text }: { text: string }) {
  return (
    <>
      {inlineParts(text).map((part, index) =>
        part.kind === "code" ? (
          <code key={index}>{part.text}</code>
        ) : part.kind === "strong" ? (
          <strong key={index}>
            <Prose text={part.text} />
          </strong>
        ) : (
          <Words key={index} text={part.text} />
        ),
      )}
    </>
  );
}

/** A contract description as blocks: paragraphs, and each run of list items as one list. */
function ContractProse({ text }: { text: string }) {
  return (
    <>
      {contractBlocks(text).map((block, index) =>
        block.kind === "p" ? (
          <p key={index}>
            <Prose text={block.text} />
          </p>
        ) : (
          <ul key={index}>
            {block.items.map((item, itemIndex) => (
              <li key={itemIndex}>
                <Prose text={item} />
              </li>
            ))}
          </ul>
        ),
      )}
    </>
  );
}

export function EndpointCard({ op, baseUrl }: { op: ContractOperation; baseUrl: string }) {
  const copy = operationCopy(op);
  return (
    <section className={`${kit.card} ${styles.endpoint}`} id={op.operationId} data-testid={`api-endpoint-${op.operationId}`}>
      <div className={styles.endpointHead}>
        <span className={styles.verb}>{op.method}</span>
        <span className={styles.path}>{op.path}</span>
        <span className={styles.summary}>{op.summary}</span>
      </div>

      {op.description.length > 0 && (
        <div className={styles.description} data-testid={`api-description-${op.operationId}`}>
          <ContractProse text={op.description} />
        </div>
      )}

      {op.parameters.length > 0 && (
        <div className={styles.params}>
          {op.parameters.map((param) => (
            <div key={`${param.in}·${param.name}`} className={styles.paramRow}>
              <span className={styles.paramName}>{param.name}</span>
              <span className={styles.paramMeta}>
                {param.in} · {param.required ? <span className={styles.paramRequired}>{API_COPY.required}</span> : API_COPY.optional}
              </span>
              {param.description.length > 0 && (
                <div className={styles.paramDescription} data-testid={`api-param-${op.operationId}-${param.name}`}>
                  <ContractProse text={param.description} />
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <CodeBlock code={curlFor(op, baseUrl)} label={API_COPY.curlCode} copyLabel={copy.curl} testId={`api-curl-${op.operationId}`} />

      {/* The response codes a caller must handle sit ABOVE the happy-path sample — the non-2xx vocabulary is the
          part that costs a caller correctness, and it may not trail the fold. A status is contract vocabulary, not
          a warning: every chip wears the same ink. */}
      <div className={styles.responses} data-testid={`api-responses-${op.operationId}`}>
        {op.responses.map((response) => (
          <span key={response.code} className={styles.responseChip} title={response.description}>
            {response.code}
            {response.ref !== null ? ` · ${response.ref}` : ""}
          </span>
        ))}
      </div>

      {op.sse ? (
        <p className={styles.sseNote}>{API_SSE_NOTE}</p>
      ) : (
        <details className={styles.sample}>
          <summary className={styles.sampleSummary}>
            {copy.sampleSummary}
            {copy.sampleSource !== null && (
              <>
                {" "}
                <span className={styles.sampleSource}>{copy.sampleSource}</span>
              </>
            )}
          </summary>
          <CodeBlock code={JSON.stringify(op.example, null, 2)} label={API_COPY.jsonCode} copyLabel={copy.sample} testId={`api-sample-${op.operationId}`} />
        </details>
      )}
    </section>
  );
}
