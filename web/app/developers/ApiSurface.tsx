import { KitTable, KpiTile, SectionHead, VerdictHeader, type KitColumn, type KitRow } from "@/components/kit";
import kit from "@/components/kit/kit.module.css";
import { solventBaseUrl } from "@/lib/api";
import { deriveApiView } from "@/lib/api-view";
import { CONTRACT_META, ERROR_RESPONSES, OPERATIONS } from "@/lib/proof-contract.gen";
import { ApiDrawer } from "./ApiDrawer";
import styles from "./api.module.css";
import { CodeBlock } from "./CodeBlock";
import { EndpointCard } from "./EndpointCard";

// The API surface: a static render of the COMMITTED contract in the Console
// register. Everything below is api/openapi.yaml's own text and examples —
// extracted by tests/fixtures/generate-proof.mjs, drift-gated by
// tests/unit/proof-contract-fidelity.spec.ts — so the docs cannot say what the
// contract does not. No fetch happens at build or request time; the only
// deployment-specific value is the API origin the samples target. The page is
// a server component; the drawer is its one client island.

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

const ERROR_COLUMNS: KitColumn[] = [
  { key: "status", header: "Status" },
  { key: "name", header: "Response" },
  { key: "description", header: "Description" },
];

export function ApiSurface() {
  const baseUrl = solventBaseUrl();
  const view = deriveApiView(baseUrl);
  const errorRows: KitRow[] = view.errors.map((row) => ({
    key: row.key,
    testId: `api-error-${row.key}`,
    cells: {
      status: <span className={kit.addr}>{row.cells.status}</span>,
      name: <span className={kit.addr}>{row.cells.name}</span>,
      description: <span className={styles.wrap}>{row.cells.description}</span>,
    },
  }));

  return (
    <div className={styles.page} data-testid="api-surface">
      <VerdictHeader
        testId="api-verdict"
        kicker={view.kicker}
        emphasis={view.headline.emphasis}
        rest={view.headline.rest}
        tone={view.headline.tone}
        dek={view.headline.dek}
        chips={view.chips}
        actions={<ApiDrawer doctrine={view.doctrine} />}
      />

      <div className={styles.tiles}>
        <KpiTile testId="api-kpi-operations" label="Operations" value={view.tiles.operations} />
        <KpiTile testId="api-kpi-errors" label="Error responses" value={view.tiles.errors} />
        <KpiTile testId="api-kpi-version" label="Contract version" value={view.tiles.version} sub={CONTRACT_META.sourcePath} />
      </div>

      <div className={styles.baseUrl} data-testid="api-base-url">
        <span className={styles.baseUrlLabel}>Base URL</span>
        <span className={styles.baseUrlValue} data-testid="api-base-url-value">
          {baseUrl}
        </span>
      </div>

      <nav className={styles.toc} aria-label="endpoints" data-testid="api-toc">
        {OPERATIONS.map((op) => (
          <a key={op.operationId} href={`#${op.operationId}`} className={`${kit.btn} ${kit.btnGhost} ${styles.tocChip}`}>
            {op.method} {op.path}
          </a>
        ))}
      </nav>

      <SectionHead title="TypeScript" qualifier="@solvent/client" />
      <CodeBlock code={quickstart(baseUrl)} copyLabel="copy TypeScript quickstart" testId="api-quickstart" />

      <SectionHead
        title="Endpoints"
        qualifier={`${String(OPERATIONS.length)} operations, ${CONTRACT_META.sourcePath} verbatim`}
        link={{ href: "/proof", label: "Verification →" }}
      />
      {OPERATIONS.map((op) => (
        <EndpointCard key={op.operationId} op={op} baseUrl={baseUrl} />
      ))}

      <SectionHead title="Error envelope" />
      <div>
        <KitTable testId="api-errors" columns={ERROR_COLUMNS} rows={errorRows} />
        {/* Each row's body sample folds beneath the table, its provenance beside it; the copy is the verbatim JSON. */}
        <div className={styles.samples}>
          {ERROR_RESPONSES.map((error) => (
            <details key={error.name} className={styles.sample} data-testid={`api-error-sample-${error.name}`}>
              <summary className={styles.sampleSummary}>
                {error.name} body <span className={styles.sampleSource}>· {error.source}</span>
              </summary>
              <CodeBlock code={JSON.stringify(error.body, null, 2)} copyLabel={`copy ${error.name} body`} />
            </details>
          ))}
        </div>
      </div>
    </div>
  );
}
