import type { ToolAnalysisReport } from '@/lib/data-sources/types';
import {
  CATALOG_SECTION_LABELS,
  CATALOG_STATUS_LABELS,
  toolAnalysisCallLabel
} from './tool-analysis-utils';

export function toolAnalysisReportToMarkdown(report: ToolAnalysisReport): string {
  const lines: string[] = [];
  const renderSchemaBlock = (title: string, schema: unknown) => {
    lines.push(`#### ${title}`);
    lines.push('```json');
    try {
      lines.push(JSON.stringify(schema, null, 2));
    } catch {
      lines.push('"[schema not serializable]"');
    }
    lines.push('```');
  };
  lines.push(`# MCP Tool Analysis Report`, '');
  lines.push(`- Created: ${report.createdAt}`);
  if (report.assistantAgentName) lines.push(`- Assistant Agent: ${report.assistantAgentName}`);
  if (report.assistantAgentModel) lines.push(`- Assistant Model: ${report.assistantAgentModel}`);
  if (report.mcpServerVersions && Object.keys(report.mcpServerVersions).length > 0) {
    const versionStr = Object.entries(report.mcpServerVersions)
      .map(([name, v]) => `${name}: ${v ?? 'unknown'}`)
      .join(', ');
    lines.push(`- MCP Server Versions: ${versionStr}`);
  }
  lines.push(
    `- Modes: ${[
      report.modes.catalogChecks ? 'catalog checks' : null,
      report.modes.metadataReview ? 'metadata review' : null,
      report.modes.deeperAnalysis ? 'deeper analysis' : null
    ]
      .filter(Boolean)
      .join(' + ')}`
  );
  lines.push('', `## Summary`);
  lines.push(`- Servers analyzed: ${report.summary.serversAnalyzed}`);
  if (report.summary.catalogChecks)
    lines.push(`- Catalog entries checked: ${report.summary.catalogChecks.itemsChecked}`);
  if (report.modes.metadataReview || report.modes.deeperAnalysis) {
    lines.push(`- Tools analyzed: ${report.summary.toolsAnalyzed}`);
    lines.push(`- Tools skipped: ${report.summary.toolsSkipped}`);
  }
  lines.push('');
  for (const server of report.servers) {
    lines.push(`## Server: ${server.serverName}`);
    if (server.warnings.length > 0) {
      lines.push(...server.warnings.map((w) => `- Warning: ${w}`), '');
    }
    if (server.catalogChecks) {
      lines.push('### Catalog checks');
      for (const check of server.catalogChecks) {
        lines.push(
          `- ${CATALOG_SECTION_LABELS[check.kind]} · ${CATALOG_STATUS_LABELS[check.status]} · ${check.itemsChecked} checked`
        );
        if (check.message) lines.push(`  - ${check.message}`);
        for (const finding of check.findings) {
          lines.push(
            `  - [${CATALOG_STATUS_LABELS[finding.status]}] ${finding.item} · ${finding.path} · ${finding.message}`
          );
        }
      }
      lines.push('');
    }
    for (const tool of server.tools) {
      lines.push(`### ${tool.publicToolName}`);
      if (tool.title) lines.push(`- Title: ${tool.title}`);
      lines.push(`- Safety: ${tool.safetyClassification} (${tool.classificationReason})`);
      if (tool.inputSchema !== undefined) renderSchemaBlock('Input schema', tool.inputSchema);
      if (tool.outputSchema !== undefined) renderSchemaBlock('Output schema', tool.outputSchema);
      if (tool.metadataReview?.issues.length) {
        lines.push(`#### Metadata issues`);
        for (const issue of tool.metadataReview.issues) {
          lines.push(`  - [${issue.severity}] ${issue.title}: ${issue.detail}`);
        }
      }
      if (tool.deeperAnalysis) {
        if (!tool.deeperAnalysis.attempted) {
          lines.push(
            `- Deeper analysis: skipped (${tool.deeperAnalysis.skippedReason ?? 'unknown'})`
          );
        } else {
          lines.push(`- Deeper analysis sample calls: ${tool.deeperAnalysis.sampleCalls.length}`);
          for (const sample of tool.deeperAnalysis.sampleCalls) {
            lines.push(
              `  - Call ${sample.callIndex}: ${toolAnalysisCallLabel(sample)}${
                sample.durationMs ? ` (${sample.durationMs}ms)` : ''
              }`
            );
            if (sample.error) lines.push(`    - Error: ${sample.error}`);
            for (const obs of sample.observations) lines.push(`    - ${obs}`);
          }
        }
      }
      if (tool.overallRecommendations.length > 0) {
        lines.push(`#### Recommendations`);
        for (const rec of tool.overallRecommendations) lines.push(`  - ${rec}`);
      }
      if (tool.metadataReview?.evalReadinessNotes.length) {
        lines.push(`#### Agent/Eval readiness notes`);
        for (const note of tool.metadataReview.evalReadinessNotes) lines.push(`  - ${note}`);
      }
      lines.push('');
    }
  }
  return `${lines.join('\n')}\n`;
}
