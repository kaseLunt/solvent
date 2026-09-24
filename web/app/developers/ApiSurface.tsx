import { KitTable, KpiTile, SectionHead, VerdictHeader, type KitColumn, type KitRow } from "@/components/kit";
import kit from "@/components/kit/kit.module.css";
import { solventBaseUrl } from "@/lib/api";
import { API_COPY, API_ERROR_COLUMNS, deriveApiView, errorSampleCopy } from "@/lib/api-view";
import { ERROR_RESPONSES, OPERATIONS } from "@/lib/proof-contract.gen";
import { ApiDrawer } from "./ApiDrawer";
import styles from "./api.module.css";
import { CodeBlock } from "./CodeBlock";
import { EndpointCard } from "./EndpointCard";

// The API surface: a static render of the COMMITTED contract in the Console
// register. Everything below is api/openapi.yaml's own text and examples —
// extracted by tests/fixtures/generate-proof.mjs, drift-gated by
// tests/unit/proof-contract-fidelity.spec.ts — so the docs cannot say what the
// contract does not. No fetch happens at build or request time; the only
// deployment-specific value is the API origin the samples target, stated once
// in the header's Base URL chip and carried copyably by the quickstart. The
// page is a server component; the drawer is its one client island.

const ERROR_COLUMNS: KitColumn[] = API_ERROR_COLUMNS.map((column) => ({ key: column.key, header: column.header }));

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
        kicker={
          <>
            {view.kickerParts.lead} <span className={kit.kickCase}>{view.kickerParts.version}</span>
          </>
        }
        emphasis={view.headline.emphasis}
        rest={view.headline.rest}
        tone={view.headline.tone}
        dek={view.headline.dek}
        chips={view.chips}
        actions={<ApiDrawer label={API_COPY.drawer} doctrine={view.doctrine} />}
      />

      <div className={`${kit.kpis} ${kit.kpis4}`}>
        <KpiTile testId="api-kpi-operations" label={view.tiles.operations.label} value={view.tiles.operations.value} sub={view.tiles.operations.sub} />
        <KpiTile testId="api-kpi-errors" label={view.tiles.errors.label} value={view.tiles.errors.value} sub={view.tiles.errors.sub} />
      </div>

      {/* The endpoint index: aligned rows, read down a verb column. Each row is an anchor and nothing else — it wears no
          button form, because one tab away that form is a pressable filter. DOM order is reading order, so Tab walks the
          index top to bottom, column by column. */}
      <nav className={styles.toc} aria-label={API_COPY.indexLabel} data-testid="api-toc">
        {view.index.map((row) => (
          <a key={row.id} href={`#${row.id}`} className={styles.tocRow}>
            <span className={styles.tocVerb}>{row.method}</span>{" "}
            <span className={styles.tocPath}>{row.path}</span>
          </a>
        ))}
      </nav>

      <SectionHead title={API_COPY.quickstartTitle} qualifier={API_COPY.quickstartQualifier} />
      <CodeBlock code={view.quickstart} label={API_COPY.quickstartCode} copyLabel={API_COPY.quickstartCopy} testId="api-quickstart" />

      <SectionHead
        title={API_COPY.endpointsTitle}
        qualifier={view.endpointsQualifier}
        link={{ href: "/proof", label: API_COPY.verificationLink }}
      />
      {OPERATIONS.map((op) => (
        <EndpointCard key={op.operationId} op={op} baseUrl={baseUrl} />
      ))}

      <SectionHead title={API_COPY.errorsTitle} />
      <div>
        <KitTable testId="api-errors" columns={ERROR_COLUMNS} rows={errorRows} />
        {/* Each row's body sample folds beneath the table, its provenance beside it; the copy is the verbatim JSON. */}
        <div className={styles.samples}>
          {ERROR_RESPONSES.map((error) => {
            const copy = errorSampleCopy(error);
            return (
              <details key={error.name} className={styles.sample} data-testid={`api-error-sample-${error.name}`}>
                <summary className={styles.sampleSummary}>
                  {copy.summary} <span className={styles.sampleSource}>{copy.source}</span>
                </summary>
                <CodeBlock code={JSON.stringify(error.body, null, 2)} label={API_COPY.jsonCode} copyLabel={copy.copy} />
              </details>
            );
          })}
        </div>
      </div>
    </div>
  );
}
