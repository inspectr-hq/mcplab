import type {
  McpCatalogCheck,
  McpHealthReport,
  ToolAnalysisModes,
  ToolAnalysisSampleCall
} from '@/lib/data-sources/types';

export function isWriteDeleteClassification(classificationReason: string): boolean {
  const lower = classificationReason.toLowerCase();
  return (
    lower.includes('side-effectful prefix') ||
    lower.includes('indicates side effects') ||
    lower.includes('destructive behavior') ||
    lower.includes('destructivehint') ||
    lower.includes('non-read-only behavior') ||
    lower.includes('readonlyhint: false') ||
    lower.includes('additive behavior')
  );
}

export function safeJsonStringify(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return '[schema not serializable]';
  }
}

const CALL_OUTCOME_LABELS = {
  success: 'Success',
  tool_error: 'Tool error',
  schema_error: 'Schema error',
  protocol_error: 'Protocol error',
  transport_error: 'Transport error',
  timeout: 'Timeout'
} satisfies Record<NonNullable<ToolAnalysisSampleCall['outcome']>, string>;

export function toolAnalysisCallLabel(sample: ToolAnalysisSampleCall): string {
  if (sample.outcome) return CALL_OUTCOME_LABELS[sample.outcome];
  return sample.ok ? 'ok' : 'error';
}

export const CATALOG_SECTION_LABELS = {
  tools: 'Tools',
  resources: 'Resources',
  resource_templates: 'Resource templates',
  prompts: 'Prompts',
  skills: 'Skills',
  tool_resources: 'Tool-backed resources and skills'
} satisfies Record<McpCatalogCheck['kind'], string>;

export const CATALOG_STATUS_LABELS = {
  pass: 'Passed',
  warning: 'Warning',
  fail: 'Failed',
  skipped: 'Skipped'
} satisfies Record<McpCatalogCheck['status'], string>;

export function mcpHealthCoverage(health: McpHealthReport): string {
  const listed = health.partialListing ? ' (partial listing)' : '';
  return `Tested ${health.checkedCount} of ${health.checks.length} checks · ran ${health.toolsRun} of ${health.toolCount} listed tools${listed}`;
}

export function mcpHealthTimings({ timings }: McpHealthReport): string[] {
  const phases = [
    ['Connect', timings.connectMs],
    ['List tools', timings.listMs],
    ['Average sample call', timings.averageCallMs]
  ] as const;
  return phases.flatMap(([label, ms]) => (ms === undefined ? [] : [`${label} took ${ms} ms`]));
}

export function mcpHealthPrivacy(modes: ToolAnalysisModes): string {
  if (modes.deeperAnalysis) {
    return 'Tool definitions and successful sample output may be shared with the configured assistant provider.';
  }
  if (modes.metadataReview)
    return 'Tool definitions may be shared with the configured assistant provider.';
  return 'This run used the MCP server and its configured authentication. No assistant provider was used.';
}
