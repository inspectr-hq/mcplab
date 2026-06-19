import type {
  SavedToolAnalysisReportRecord,
  ToolAnalysisDiscoveredTool
} from '@/lib/data-sources/types';

export interface ToolInfoExport {
  serverName: string;
  tools: Array<{
    name: string;
    title?: string;
    description?: string;
    inputSchema?: unknown;
    outputSchema?: unknown;
  }>;
}

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

export function buildToolInfoExport(params: {
  serverName: string;
  tools: ToolAnalysisDiscoveredTool[];
  selectedToolNames?: string[];
}): ToolInfoExport {
  const selectedToolNames = params.selectedToolNames?.length
    ? new Set(params.selectedToolNames)
    : null;

  return {
    serverName: params.serverName,
    tools: params.tools
      .filter((tool) => !selectedToolNames || selectedToolNames.has(tool.name))
      .map((tool) => ({
        name: tool.name,
        title: tool.title,
        description: tool.description,
        inputSchema: tool.inputSchema,
        outputSchema: tool.outputSchema
      }))
  };
}

function sanitizeFilenamePart(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function buildToolInfoFilename(
  serverName: string,
  mcpServerVersion?: string | null
): string {
  const parts = ['tool-info', sanitizeFilenamePart(serverName)];
  const version = mcpServerVersion?.trim();
  if (version) parts.push(`v${sanitizeFilenamePart(version)}`);
  return `${parts.filter(Boolean).join('-')}.json`;
}
