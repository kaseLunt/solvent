import type { Metadata } from "next";
import Link from "next/link";
import { solventBaseUrl } from "@/lib/api";
import { CONTRACT_META, ERROR_RESPONSES, OPERATIONS } from "@/lib/proof-contract.gen";
import { CodeBlock } from "./CodeBlock";
import { EndpointCard } from "./EndpointCard";
import styles from "./developers.module.css";

export const metadata: Metadata = { title: "Developers" };

// The Developers surface (W6, spec §3.6): a static render of the COMMITTED
// contract. Everything below is api/openapi.yaml's own text and examples —
// extracted by tests/fixtures/generate-proof.mjs, drift-gated by
// tests/unit/proof-contract-fidelity.spec.ts — so the docs cannot say what
// the contract does not. No fetch happens at build or request time; the only
// deployment-specific value is the API origin the curl samples target.

function quickstart(baseUrl: string): string {
  return `import { SolventClient } from "@solvent/client";

const client = new SolventClient({ baseUrl: "${baseUrl}" });

// Aggregates. Every money quantity is a DECIMAL STRING, exactly as the wire
// carried it — nothing here converts, rounds, or floats.
const book = await client.book();

// Three-valued lookup: the wire's found true/false/null arrives as a sealed
// outcome union — \`if (!result.found)\` does not compile, so a withheld
// answer can never read as "no position".
const result = await client.address("0xAAaA000000000000000000000000000000000001");
switch (result.outcome) {
  case "found":      /* result.response.positions */         break;
  case "not-found":  /* definitive: no position in batch */  break;
  case "unknowable": /* withheld engine — NOT "none" */      break;
}

// The deploy-bound evidence manifest (no client method yet — plain fetch).
const evidence = await fetch("${baseUrl}/v1/evidence").then((r) => r.json());`;
}

export default function DevelopersPage() {
  const baseUrl = solventBaseUrl();

  return (
    <>
      <div className={styles.head}>
        <p className="eyebrow">7 · Developers</p>
        <h1>Developers</h1>
        <p>
          {CONTRACT_META.title} v{CONTRACT_META.version} — read-only, zero-auth JSON over HTTPS.
          Every response below is the committed contract&apos;s own example (source cited per
          block); every money quantity is a decimal string; refusals are rows, not errors. Where a
          handler and the contract disagree, the disagreement is a failure — not a documentation
          lag.
        </p>
        <p className={styles.crossLink}>
          this deployment&apos;s evidence manifest, rendered → <Link href="/proof">Proof Center</Link>
        </p>
      </div>

      <div className={styles.baseUrl} data-testid="base-url">
        <span className={styles.baseUrlLabel}>base URL</span>
        <span className={styles.baseUrlValue}>{baseUrl}</span>
        <span className={styles.baseUrlNote}>
          the origin this deployment is built against (NEXT_PUBLIC_SOLVENT_API_URL)
        </span>
      </div>

      <nav className={styles.toc} aria-label="endpoints">
        {OPERATIONS.map((op) => (
          <a key={op.operationId} href={`#${op.operationId}`} className={styles.tocChip}>
            {op.method} {op.path}
          </a>
        ))}
      </nav>

      <h2 className={styles.sectionHead}>TypeScript — @solvent/client</h2>
      <CodeBlock
        code={quickstart(baseUrl)}
        copyLabel="copy TypeScript quickstart"
        testId="ts-quickstart"
      />

      <h2 className={styles.sectionHead}>
        Endpoints — {String(OPERATIONS.length)} operations, {CONTRACT_META.sourcePath} verbatim
      </h2>
      {OPERATIONS.map((op) => (
        <EndpointCard key={op.operationId} op={op} baseUrl={baseUrl} />
      ))}

      <h2 className={styles.sectionHead}>Error envelope</h2>
      {ERROR_RESPONSES.map((error) => (
        <section key={error.name} className={styles.errorCard} data-testid={`error-${error.name}`}>
          <div className={styles.errorHead}>
            <span className={styles.errorStatus}>{String(error.status)}</span>
            <span className={styles.errorName}>{error.name}</span>
            <span className={styles.errorDescription}>{error.description}</span>
          </div>
          <details className={styles.sample}>
            <summary className={styles.sampleSummary}>
              body <span className={styles.sampleSource}>· {error.source}</span>
            </summary>
            <CodeBlock
              code={JSON.stringify(error.body, null, 2)}
              copyLabel={`copy ${error.name} body`}
            />
          </details>
        </section>
      ))}

      <p className={styles.provenance}>
        Samples are extracted from the committed contract by
        tests/fixtures/generate-proof.mjs; tests/unit/proof-contract-fidelity.spec.ts re-extracts
        from api/openapi.yaml on every run and fails on any drift between this page&apos;s source
        module and the contract.
      </p>
    </>
  );
}
