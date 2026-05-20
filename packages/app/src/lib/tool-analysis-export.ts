import type { SavedToolAnalysisReportRecord } from '@/lib/data-sources/types';

export interface ToolSchemaExport {
  reportId: string;
  createdAt: string;
  tools: Array<{
    server: string;
    name: string;
    title?: string;
    description?: string;
    inputSchema?: unknown;
    outputSchema?: unknown;
  }>;
}

export function buildToolSchemaExport(record: SavedToolAnalysisReportRecord): ToolSchemaExport {
  return {
    reportId: record.reportId,
    createdAt: record.createdAt,
    tools: record.report.servers.flatMap((server) =>
      server.tools.map((tool) => ({
        server: server.serverName,
        name: tool.publicToolName,
        title: tool.title,
        description: tool.description,
        inputSchema: tool.inputSchema,
        outputSchema: tool.outputSchema
      }))
    )
  };
}
