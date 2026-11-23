import type { ServerResponse } from 'node:http';
import type {
  AgentConfig,
  EvalConfig,
  McpCatalogList,
  McpErrorIndicator,
  McpServerCatalog,
  McpToolSafety,
  ToolAnalysisCallOutcome,
  ToolAnalysisFinding,
  ToolAnalysisModes,
  ToolAnalysisReport,
  ToolAnalysisSampleCall,
  ToolAnalysisServerReport,
  ToolAnalysisSuggestedSchemaChange,
  ToolAnalysisToolReport,
  ToolDef
} from '@inspectr/mcplab-core';
import {
  chatWithAgent,
  buildMcpHealthReport,
  inspectMcpError,
  makeMcpInputChecker,
  checkMcpCatalog,
  duplicateMcpIdentifiers,
  summarizeMcpCatalogChecks,
  classifyMcpToolCallFailure,
  classifyMcpToolSafety,
  throwIfAborted,
  withTimeoutSignal,
  estimateToolDefinitionTokens,
  getMcpResourceToolAccess,
  McpClientManager,
  MCP_LIST_RESOURCES_TOOL,
  parseMcpResourceToolCatalog,
  withMcpCatalogTokenEstimates
} from '@inspectr/mcplab-core';
import type { AppSettings } from './types.js';
import { addJobEvent } from './jobs.js';
import { readLibraries } from './libraries-store.js';
import { parseJsonFromAssistantText } from './one-shot-json.js';
import { truncateJson } from './assistant-common.js';
export { parseJsonFromAssistantText } from './one-shot-json.js';
import {
  OAuthAuthorizationRequiredError,
  type OAuthSessionManager
} from './oauth-session-manager.js';
import {
  pickDefaultAssistantAgentName,
  resolveAssistantAgentFromLibraries
} from './assistant-agent.js';

type JobEvent = {
  type: 'started' | 'log' | 'completed' | 'error';
  ts: string;
  payload: Record<string, unknown>;
};

export interface ToolAnalysisJob {
  id: string;
  status: 'running' | 'completed' | 'error' | 'stopped';
  events: JobEvent[];
  clients: Set<ServerResponse>;
  abortController: AbortController;
  result?: ToolAnalysisReport;
  savedReportId?: string;
  savedReportPath?: string;
}

interface ToolAnalysisToolContext {
  serverName: string;
  tool: ToolDef;
  safetyClassification: McpToolSafety['safetyClassification'];
  classificationReason: string;
}

type JsonObject = Record<string, unknown>;

interface MetadataReviewJson {
  strengths?: unknown;
  issues?: unknown;
  suggestedDescription?: unknown;
  suggestedSchemaChanges?: unknown;
  evalReadinessNotes?: unknown;
  overallRecommendations?: unknown;
}

interface SuggestedSchemaChangeJson {
  type?: unknown;
  summary?: unknown;
  before?: unknown;
  after?: unknown;
}

interface SamplePlanJson {
  sampleCalls?: Array<{ arguments?: unknown; rationale?: unknown }>;
}

interface ExecutionReviewJson {
  observations?: unknown;
  issues?: unknown;
  recommendations?: unknown;
}

interface ToolAnalysisMetadataPayload {
  serverName: string;
  toolName: string;
  title: string;
  description: string;
  inputSchema: unknown;
  outputSchema: unknown;
  projectGoal: string;
}

interface ToolAnalysisSamplePlanPayload {
  serverName: string;
  toolName: string;
  title: string;
  description: string;
  inputSchema: unknown;
  outputSchema: unknown;
  maxCalls: number;
}

interface ToolAnalysisExecutionReviewPayload {
  serverName: string;
  toolName: string;
  title: string;
  arguments: unknown;
  resultPreview: string;
  description: string;
  inputSchema: unknown;
  outputSchema: unknown;
}

const TOOL_ANALYSIS_JSON_RESPONSE_TOOL = {
  name: 'submit_tool_analysis_json',
  description:
    'Submit the final analysis response as JSON object. Use this instead of returning free-form text.',
  inputSchema: { type: 'object', additionalProperties: true }
} satisfies ToolDef;

function normalizeToolAnalysisFinding(
  raw: unknown,
  fallbackPrefix: string,
  idx: number
): ToolAnalysisFinding {
  const rawObj = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const severity =
    rawObj.severity === 'critical' ||
    rawObj.severity === 'high' ||
    rawObj.severity === 'medium' ||
    rawObj.severity === 'low' ||
    rawObj.severity === 'info'
      ? rawObj.severity
      : 'info';
  const scopeValues: ToolAnalysisFinding['scope'][] = [
    'tool_name',
    'description',
    'schema',
    'ergonomics',
    'safety',
    'eval_readiness',
    'execution'
  ];
  const scope = scopeValues.includes(rawObj.scope as ToolAnalysisFinding['scope'])
    ? (rawObj.scope as ToolAnalysisFinding['scope'])
    : 'eval_readiness';
  return {
    id:
      (typeof rawObj.id === 'string' && rawObj.id.trim()) ||
      `${fallbackPrefix}-${idx + 1}-${Math.random().toString(36).slice(2, 6)}`,
    scope,
    severity,
    title: String(rawObj.title ?? 'Observation'),
    detail: String(rawObj.detail ?? rawObj.suggestion ?? 'No details provided'),
    suggestion: rawObj.suggestion ? String(rawObj.suggestion) : undefined
  };
}

function clampStringArray(value: unknown, fallback: string[] = []): string[] {
  return Array.isArray(value) ? value.map((v) => String(v)).filter(Boolean) : fallback;
}

function parseJsonFromToolCalls(response: {
  tool_calls?: Array<{ name: string; arguments: unknown }>;
}): unknown {
  if (!Array.isArray(response.tool_calls) || response.tool_calls.length === 0) return undefined;
  const preferred =
    response.tool_calls.find((c) => c.name === TOOL_ANALYSIS_JSON_RESPONSE_TOOL.name) ??
    response.tool_calls[0];
  const args = preferred?.arguments;
  if (typeof args === 'string') return parseJsonFromAssistantText(args);
  return args;
}

async function chatJsonWithAgent(
  agent: AgentConfig,
  system: string,
  userPrompt: string,
  signal?: AbortSignal
): Promise<unknown> {
  const first = await chatWithAgent({
    agent,
    system,
    signal,
    tools: [TOOL_ANALYSIS_JSON_RESPONSE_TOOL],
    messages: [
      {
        role: 'user',
        content: `${userPrompt}\n\nReturn your answer by calling '${TOOL_ANALYSIS_JSON_RESPONSE_TOOL.name}' with the JSON object.`
      }
    ]
  });
  const firstToolJson = parseJsonFromToolCalls(first);
  if (firstToolJson && typeof firstToolJson === 'object') return firstToolJson;
  try {
    return parseJsonFromAssistantText(first.content ?? '');
  } catch {
    const retry = await chatWithAgent({
      agent,
      system,
      signal,
      tools: [TOOL_ANALYSIS_JSON_RESPONSE_TOOL],
      messages: [
        {
          role: 'user',
          content: `${userPrompt}\n\nReturn your answer by calling '${TOOL_ANALYSIS_JSON_RESPONSE_TOOL.name}' with the JSON object.`
        },
        { role: 'assistant', content: first.content ?? '' },
        {
          role: 'user',
          content:
            `Reply again by calling '${TOOL_ANALYSIS_JSON_RESPONSE_TOOL.name}' only. ` +
            'No prose, no markdown fences, no explanation text.'
        }
      ]
    });
    const retryToolJson = parseJsonFromToolCalls(retry);
    if (retryToolJson && typeof retryToolJson === 'object') return retryToolJson;
    return parseJsonFromAssistantText(retry.content ?? '');
  }
}

function toolAnalysisMetadataSystemPrompt(): string {
  return [
    'You are an MCP Tool Analysis Assistant.',
    'Review MCP tools for agent/workflow usability, determinism, safety signaling, and eval readiness.',
    'Return JSON only with keys:',
    'strengths: string[]',
    'issues: ToolAnalysisFinding[] (id, scope, severity, title, detail, suggestion?)',
    'suggestedDescription?: string',
    'suggestedSchemaChanges: [{type, summary, before?, after?}]',
    'evalReadinessNotes: string[]',
    'overallRecommendations: string[]',
    'Use severities: critical|high|medium|low|info.'
  ].join('\n');
}

function toolAnalysisSampleArgsSystemPrompt(sampleCallsPerTool: number): string {
  return [
    'You generate safe sample MCP tool call arguments for read-only analysis.',
    'Return JSON only: {"sampleCalls":[{"arguments":{...},"rationale":"..."}]}',
    `Limit to at most ${sampleCallsPerTool} sampleCalls.`,
    'Prefer minimal valid arguments based on the schema.',
    'Do not include destructive or side-effect toggles.'
  ].join('\n');
}

function toolAnalysisExecutionReviewSystemPrompt(): string {
  return [
    'You review MCP tool execution output for agent/workflow usability and eval readiness.',
    'Return JSON only with keys: observations (string[]), issues (ToolAnalysisFinding[]), recommendations (string[]).',
    'Focus on output shape consistency, error quality, schema-doc mismatches, and determinism risks.'
  ].join('\n');
}

export function buildToolAnalysisMetadataPayload(params: {
  serverName: string;
  toolName: string;
  title?: string;
  description?: string;
  inputSchema?: unknown;
  outputSchema?: unknown;
}): ToolAnalysisMetadataPayload {
  return {
    serverName: params.serverName,
    toolName: params.toolName,
    title: params.title ?? '',
    description: params.description ?? '',
    inputSchema: params.inputSchema ?? null,
    outputSchema: params.outputSchema ?? null,
    projectGoal: 'MCP agent/workflow evaluation friendliness'
  };
}

export function buildToolAnalysisSamplePlanPayload(params: {
  serverName: string;
  toolName: string;
  title?: string;
  description?: string;
  inputSchema?: unknown;
  outputSchema?: unknown;
  maxCalls: number;
}): ToolAnalysisSamplePlanPayload {
  return {
    serverName: params.serverName,
    toolName: params.toolName,
    title: params.title ?? '',
    description: params.description ?? '',
    inputSchema: params.inputSchema ?? null,
    outputSchema: params.outputSchema ?? null,
    maxCalls: params.maxCalls
  };
}

export function buildToolAnalysisExecutionReviewPayload(params: {
  serverName: string;
  toolName: string;
  title?: string;
  arguments: unknown;
  resultPreview: string;
  description?: string;
  inputSchema?: unknown;
  outputSchema?: unknown;
}): ToolAnalysisExecutionReviewPayload {
  return {
    serverName: params.serverName,
    toolName: params.toolName,
    title: params.title ?? '',
    arguments: params.arguments,
    resultPreview: params.resultPreview,
    description: params.description ?? '',
    inputSchema: params.inputSchema ?? null,
    outputSchema: params.outputSchema ?? null
  };
}

interface DiscoveredMcpServer {
  serverName: string;
  warnings: string[];
  tools: ToolAnalysisToolContext[];
  tokenEstimate: ReturnType<typeof estimateToolDefinitionTokens>;
  catalog?: McpServerCatalog;
  toolListing: McpCatalogList<ToolDef>;
  duplicateToolNames: Set<string>;
  connection?: { ok: boolean; durationMs: number; message?: string };
  listingMs?: number;
}

function classifyDiscoveredTool(server: DiscoveredMcpServer, tool: ToolDef): McpToolSafety {
  return classifyMcpToolSafety(tool, {
    duplicateName: server.duplicateToolNames.has(tool.name),
    complete: server.toolListing.status === 'ready'
  });
}

export async function discoverMcpToolsForServers(
  serversByName: EvalConfig['servers'],
  serverNames: string[],
  options?: {
    serverAuthHeaders?: Record<string, Record<string, string>>;
    tokenEstimateModel?: string;
    includeCatalog?: boolean;
    includeToolResources?: boolean;
    signal?: AbortSignal;
  }
): Promise<{
  mcp: McpClientManager;
  servers: DiscoveredMcpServer[];
}> {
  const mcp = new McpClientManager();
  const tokenEstimateModel = options?.tokenEstimateModel ?? 'unknown-model';
  const discovered: DiscoveredMcpServer[] = [];
  const signal = options?.signal;
  try {
    for (const serverName of serverNames) {
      throwIfAborted(signal);
      const server = serversByName[serverName];
      const entry: DiscoveredMcpServer = {
        serverName,
        warnings: [],
        tools: [],
        toolListing: { status: 'error', message: 'Server unavailable.' },
        duplicateToolNames: new Set(),
        tokenEstimate: estimateToolDefinitionTokens([], tokenEstimateModel)
      };
      discovered.push(entry);
      if (!Object.hasOwn(serversByName, serverName) || !server) {
        const message = `Server '${serverName}' not found.`;
        entry.toolListing = { status: 'error', message };
        entry.warnings.push(message);
        continue;
      }
      const connectionStarted = performance.now();
      try {
        await mcp.connectAll({ [serverName]: server }, signal, {
          serverAuthHeaders: options?.serverAuthHeaders
        });
        entry.connection = {
          ok: true,
          durationMs: Math.round(performance.now() - connectionStarted)
        };
      } catch (error: unknown) {
        throwIfAborted(signal);
        const message = `Failed to connect. ${inspectMcpError(error instanceof Error ? error.message : String(error)).error}`;
        entry.connection = {
          ok: false,
          durationMs: Math.round(performance.now() - connectionStarted),
          message
        };
        entry.toolListing = { status: 'error', message };
        entry.warnings.push(message);
        continue;
      }

      const serverCatalog = options?.includeCatalog
        ? await mcp.listCatalog(serverName, signal)
        : undefined;
      let tools: ToolDef[] = [];
      try {
        if (!options?.includeCatalog || mcp.getServerFeatures(serverName).tools) {
          const listingStarted = performance.now();
          try {
            entry.toolListing = await mcp.listToolsWithCoverage(serverName, signal);
          } finally {
            entry.listingMs = Math.round(performance.now() - listingStarted);
          }
        } else {
          entry.toolListing = { status: 'unsupported' };
        }
        tools = 'items' in entry.toolListing ? entry.toolListing.items : [];
        if (entry.toolListing.status === 'partial') {
          entry.toolListing.message = inspectMcpError(entry.toolListing.message).error;
          entry.warnings.push(`Incomplete tool listing. ${entry.toolListing.message}`);
        }
        entry.duplicateToolNames = duplicateMcpIdentifiers(tools.map((tool) => tool.name));
        const seen = new Set<string>();
        entry.tools = tools.flatMap((tool) => {
          if (seen.has(tool.name)) return [];
          seen.add(tool.name);
          const safety = classifyDiscoveredTool(entry, tool);
          return [
            {
              serverName,
              tool,
              safetyClassification: safety.safetyClassification,
              classificationReason: safety.classificationReason
            }
          ];
        });
        entry.tokenEstimate = estimateToolDefinitionTokens(
          entry.tools.map(({ tool }) => ({
            name: tool.name,
            title: tool.title,
            description: tool.description,
            inputSchema: tool.inputSchema,
            outputSchema: tool.outputSchema
          })),
          tokenEstimateModel
        );
      } catch (error: unknown) {
        throwIfAborted(signal);
        const { error: message } = inspectMcpError(
          error instanceof Error ? error.message : String(error)
        );
        entry.toolListing = { status: 'error', message };
        entry.warnings.push(`Failed to load tools: ${message}`);
      }
      if (!serverCatalog) continue;
      const { canList, readArgument } = getMcpResourceToolAccess(tools);
      if (canList) {
        serverCatalog.toolResources = { status: 'available' };
        if (options?.includeToolResources) {
          try {
            const result = await mcp.callTool(serverName, MCP_LIST_RESOURCES_TOOL, {});
            serverCatalog.toolResources = {
              status: 'ready',
              canRead: Boolean(readArgument),
              ...parseMcpResourceToolCatalog(result)
            };
          } catch (error) {
            throwIfAborted(signal);
            serverCatalog.toolResources = {
              status: 'error',
              message: error instanceof Error ? error.message : String(error)
            };
          }
        }
      }
      entry.catalog = withMcpCatalogTokenEstimates(serverCatalog, tokenEstimateModel);
    }
    return { mcp, servers: discovered };
  } catch (error) {
    await mcp.disconnectAll();
    throw error;
  }
}

async function sampleMcpTool(params: {
  mcp: McpClientManager;
  server: string;
  tool: string;
  args: unknown;
  timeoutMs: number;
  jobSignal: AbortSignal;
}): Promise<
  | { outcome: 'success'; durationMs: number; result: unknown }
  | {
      outcome: Exclude<ToolAnalysisCallOutcome, 'success'>;
      durationMs: number;
      error: string;
      resultPreview?: string;
      errorIndicators?: McpErrorIndicator[];
    }
> {
  const { mcp, server, tool, args, timeoutMs, jobSignal } = params;
  const deadline = withTimeoutSignal(jobSignal, timeoutMs);
  const started = Date.now();
  try {
    const result = await mcp.callTool(server, tool, args, { signal: deadline.signal });
    throwIfAborted(deadline.signal);
    const durationMs = Date.now() - started;
    if (result?.isError === true) {
      const text = Array.isArray(result.content)
        ? result.content.flatMap((block: { type?: string; text?: unknown }) =>
            block.type === 'text' && typeof block.text === 'string' ? [block.text] : []
          )
        : [];
      const observed = inspectMcpError(
        [...text, JSON.stringify(result.structuredContent ?? '')].join('\n')
      );
      const safeMessage = text.length ? inspectMcpError(text.join('\n')).error : undefined;
      return {
        outcome: 'tool_error',
        durationMs,
        error: observed.errorIndicators.length
          ? observed.error
          : safeMessage || 'The server returned isError: true.',
        ...(observed.errorIndicators.length ? {} : { resultPreview: truncateJson(result, 8000) }),
        errorIndicators: observed.errorIndicators
      };
    }
    return { outcome: 'success', durationMs, result };
  } catch (error) {
    throwIfAborted(jobSignal);
    const outcome = deadline.timeoutSignal.aborted ? 'timeout' : classifyMcpToolCallFailure(error);
    const durationMs = Date.now() - started;
    if (outcome === 'timeout') {
      return { outcome, durationMs, error: `${server}::${tool} timed out after ${timeoutMs}ms` };
    }
    const message = error instanceof Error ? error.message : String(error);
    const cause = error instanceof Error && error.cause instanceof Error ? error.cause.message : '';
    const observed = inspectMcpError([message, cause].join('\n'));
    return {
      outcome,
      durationMs,
      error: observed.errorIndicators.length ? observed.error : inspectMcpError(message).error,
      errorIndicators: observed.errorIndicators
    };
  } finally {
    deadline.dispose();
  }
}

export async function runToolAnalysisJob(params: {
  job: ToolAnalysisJob;
  settings: AppSettings;
  requestedAssistantAgentName?: string;
  serverNames: string[];
  oauthSessionManager: OAuthSessionManager;
  hostHeader?: string;
  selectedToolsByServer?: Record<string, string[]>;
  modes: ToolAnalysisModes;
  deeper: {
    autoRunPolicy: 'read_only_allowlist';
    sampleCallsPerTool: number;
    toolCallTimeoutMs: number;
  };
  maxParallelTools: number;
}): Promise<void> {
  const { job, settings, serverNames, selectedToolsByServer, modes, deeper, maxParallelTools } =
    params;
  const signal = job.abortController.signal;
  throwIfAborted(signal);
  const libraries = readLibraries(settings.librariesDir);
  let selectedAssistantAgentName: string | undefined;
  if (modes.metadataReview || modes.deeperAnalysis) {
    selectedAssistantAgentName = pickDefaultAssistantAgentName({
      requested: params.requestedAssistantAgentName,
      settingsDefault: settings.assistantAgentName,
      agentNames: Object.keys(libraries.agents)
    });
    if (!selectedAssistantAgentName) {
      throw new Error(
        'No assistant agent available. Configure one in Settings or add a library agent.'
      );
    }
  }
  const agentConfig = selectedAssistantAgentName
    ? resolveAssistantAgentFromLibraries(libraries, selectedAssistantAgentName)
    : undefined;
  if (agentConfig) {
    addJobEvent(job, {
      type: 'log',
      ts: new Date().toISOString(),
      payload: {
        message: `Using assistant agent ${selectedAssistantAgentName} (${agentConfig.provider}/${agentConfig.model})`
      }
    });
  }

  const oauthServers = serverNames.filter(
    (serverName) => libraries.servers[serverName]?.auth?.type === 'oauth_authorization_code'
  );
  let serverAuthHeaders: Record<string, Record<string, string>> | undefined;
  try {
    serverAuthHeaders =
      oauthServers.length > 0
        ? await params.oauthSessionManager.getAuthHeadersForServers(oauthServers, params.hostHeader)
        : undefined;
  } catch (error: unknown) {
    if (error instanceof OAuthAuthorizationRequiredError) {
      throw new Error(error.details[0]?.message || error.message);
    }
    throw error;
  }

  const { mcp, servers: discoveredServers } = await discoverMcpToolsForServers(
    libraries.servers,
    serverNames,
    {
      serverAuthHeaders,
      tokenEstimateModel: agentConfig?.model,
      includeCatalog: modes.catalogChecks,
      signal
    }
  );
  const mcpServerVersions = mcp.getServerVersions();
  const implementations = mcp.getServerImplementations();
  try {
    const serverReports: ToolAnalysisServerReport[] = [];
    const allFindings: ToolAnalysisFinding[] = [];
    const issueCounts = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
    let toolsSkipped = 0;

    for (const discovered of discoveredServers) {
      throwIfAborted(signal);
      const requestedToolNames = agentConfig
        ? selectedToolsByServer?.[discovered.serverName]
        : undefined;
      const requestedSet = requestedToolNames ? new Set(requestedToolNames) : null;
      let selectedTools: ToolAnalysisToolContext[] = [];
      if (agentConfig) {
        selectedTools = requestedSet
          ? discovered.tools.filter((t) => requestedSet.has(t.tool.name))
          : discovered.tools;
      }
      const checks = checkMcpCatalog(discovered.toolListing, discovered.catalog);
      const catalogChecks = modes.catalogChecks ? checks : undefined;
      const missingRequested = requestedSet
        ? requestedToolNames!.filter((name) => !discovered.tools.some((t) => t.tool.name === name))
        : [];
      if (catalogChecks) {
        const coverage = summarizeMcpCatalogChecks(catalogChecks);
        addJobEvent(job, {
          type: 'log',
          ts: new Date().toISOString(),
          payload: {
            message: `Checked ${coverage.itemsChecked} catalog entries on ${discovered.serverName}.`
          }
        });
      }
      addJobEvent(job, {
        type: 'log',
        ts: new Date().toISOString(),
        payload: {
          message: `Analyzing server ${discovered.serverName} (${selectedTools.length} selected of ${discovered.tools.length} discovered)`
        }
      });

      const toolReports: ToolAnalysisToolReport[] = new Array(selectedTools.length);
      const perToolFindings: ToolAnalysisFinding[][] = new Array(selectedTools.length);
      const perToolSkipped: boolean[] = new Array(selectedTools.length).fill(false);
      const analyzeToolAtIndex = async (toolIndex: number) => {
        if (!agentConfig) return;
        const toolCtx = selectedTools[toolIndex];
        throwIfAborted(signal);
        addJobEvent(job, {
          type: 'log',
          ts: new Date().toISOString(),
          payload: {
            kind: 'tool_progress',
            phase: 'started',
            serverName: discovered.serverName,
            toolName: toolCtx.tool.name,
            message: `Started ${discovered.serverName}::${toolCtx.tool.name}`
          }
        });
        const baseReport: ToolAnalysisToolReport = {
          serverName: discovered.serverName,
          toolName: toolCtx.tool.name,
          publicToolName: `${discovered.serverName}::${toolCtx.tool.name}`,
          title: toolCtx.tool.title,
          description: toolCtx.tool.description,
          inputSchema: toolCtx.tool.inputSchema,
          outputSchema: toolCtx.tool.outputSchema,
          safetyClassification: toolCtx.safetyClassification,
          classificationReason: toolCtx.classificationReason,
          overallRecommendations: []
        };

        if (modes.metadataReview) {
          addJobEvent(job, {
            type: 'log',
            ts: new Date().toISOString(),
            payload: { message: `Metadata review: ${discovered.serverName}::${toolCtx.tool.name}` }
          });
          try {
            const metaJson = (await chatJsonWithAgent(
              agentConfig,
              toolAnalysisMetadataSystemPrompt(),
              JSON.stringify(
                buildToolAnalysisMetadataPayload({
                  serverName: discovered.serverName,
                  toolName: toolCtx.tool.name,
                  title: toolCtx.tool.title,
                  description: toolCtx.tool.description,
                  inputSchema: toolCtx.tool.inputSchema,
                  outputSchema: toolCtx.tool.outputSchema
                })
              ),
              signal
            )) as MetadataReviewJson;
            const issues = Array.isArray(metaJson.issues)
              ? metaJson.issues.map((item: unknown, idx: number) =>
                  normalizeToolAnalysisFinding(
                    item,
                    `meta-${discovered.serverName}-${toolCtx.tool.name}`,
                    idx
                  )
                )
              : [];
            baseReport.metadataReview = {
              strengths: clampStringArray(metaJson.strengths),
              issues,
              suggestedDescription:
                typeof metaJson.suggestedDescription === 'string'
                  ? metaJson.suggestedDescription
                  : undefined,
              suggestedSchemaChanges: Array.isArray(metaJson.suggestedSchemaChanges)
                ? metaJson.suggestedSchemaChanges.map((c: unknown) => {
                    const change = (
                      c && typeof c === 'object' ? c : {}
                    ) as SuggestedSchemaChangeJson;
                    return {
                      type: (
                        [
                          'description',
                          'parameter',
                          'required',
                          'enum',
                          'constraints',
                          'examples',
                          'naming'
                        ] as const
                      ).includes(change.type as ToolAnalysisSuggestedSchemaChange['type'])
                        ? (change.type as ToolAnalysisSuggestedSchemaChange['type'])
                        : 'parameter',
                      summary: String(change.summary ?? 'Suggested change'),
                      before: change.before ? String(change.before) : undefined,
                      after: change.after ? String(change.after) : undefined
                    };
                  })
                : [],
              evalReadinessNotes: clampStringArray(metaJson.evalReadinessNotes)
            };
            baseReport.overallRecommendations.push(
              ...clampStringArray(metaJson.overallRecommendations)
            );
          } catch (error: unknown) {
            baseReport.metadataReview = {
              strengths: [],
              issues: [
                normalizeToolAnalysisFinding(
                  {
                    scope: 'schema',
                    severity: 'medium',
                    title: 'Metadata review failed',
                    detail: error instanceof Error ? error.message : String(error),
                    suggestion:
                      'Retry with a different assistant agent or simplify the tool schema.'
                  },
                  `meta-fail-${toolCtx.tool.name}`,
                  0
                )
              ],
              suggestedSchemaChanges: [],
              evalReadinessNotes: []
            };
          }
        }

        if (modes.deeperAnalysis) {
          const safety = classifyDiscoveredTool(discovered, toolCtx.tool);
          if (safety.safetyClassification !== 'read_only') {
            baseReport.deeperAnalysis = {
              attempted: false,
              skippedReason: `Skipped by safety policy (${deeper.autoRunPolicy}): ${safety.classificationReason}`,
              sampleCalls: [],
              overallObservations: []
            };
            perToolSkipped[toolIndex] = true;
          } else {
            addJobEvent(job, {
              type: 'log',
              ts: new Date().toISOString(),
              payload: {
                message: `Deeper analysis: ${discovered.serverName}::${toolCtx.tool.name}`
              }
            });
            const sampleCalls: ToolAnalysisSampleCall[] = [];
            let overallObservations: string[] = [];
            try {
              const samplePlan = (await chatJsonWithAgent(
                agentConfig,
                toolAnalysisSampleArgsSystemPrompt(deeper.sampleCallsPerTool),
                JSON.stringify(
                  buildToolAnalysisSamplePlanPayload({
                    serverName: discovered.serverName,
                    toolName: toolCtx.tool.name,
                    title: toolCtx.tool.title,
                    description: toolCtx.tool.description,
                    inputSchema: toolCtx.tool.inputSchema,
                    outputSchema: toolCtx.tool.outputSchema,
                    maxCalls: deeper.sampleCallsPerTool
                  })
                ),
                signal
              )) as SamplePlanJson;
              const suggestedSamples = Array.isArray(samplePlan.sampleCalls)
                ? samplePlan.sampleCalls.slice(0, deeper.sampleCallsPerTool)
                : [{ arguments: {} }];
              const checkInput = makeMcpInputChecker(toolCtx.tool.inputSchema);
              for (let idx = 0; idx < suggestedSamples.length; idx += 1) {
                const suggestedArgs = suggestedSamples[idx]?.arguments ?? {};
                const inputSchemaStatus = checkInput?.(suggestedArgs);
                const call = await sampleMcpTool({
                  mcp,
                  server: discovered.serverName,
                  tool: toolCtx.tool.name,
                  args: suggestedArgs,
                  timeoutMs: deeper.toolCallTimeoutMs,
                  jobSignal: signal
                });
                const { outcome, durationMs } = call;
                if (call.outcome !== 'success') {
                  sampleCalls.push({
                    ...call,
                    callIndex: idx + 1,
                    arguments: suggestedArgs,
                    inputSchemaStatus,
                    ok: false,
                    observations: [],
                    issues: [
                      normalizeToolAnalysisFinding(
                        {
                          scope: 'execution',
                          severity: 'medium',
                          title: 'Sample call failed',
                          detail: call.error
                        },
                        `exec-fail-${discovered.serverName}-${toolCtx.tool.name}`,
                        idx
                      )
                    ]
                  });
                  continue;
                }
                const { result } = call;
                const resultPreview = truncateJson(result, 8000);
                let execReview: ExecutionReviewJson = {};
                try {
                  execReview = (await chatJsonWithAgent(
                    agentConfig,
                    toolAnalysisExecutionReviewSystemPrompt(),
                    JSON.stringify(
                      buildToolAnalysisExecutionReviewPayload({
                        serverName: discovered.serverName,
                        toolName: toolCtx.tool.name,
                        title: toolCtx.tool.title,
                        arguments: suggestedArgs,
                        resultPreview: truncateJson(result, 4000),
                        description: toolCtx.tool.description,
                        inputSchema: toolCtx.tool.inputSchema,
                        outputSchema: toolCtx.tool.outputSchema
                      })
                    ),
                    signal
                  )) as ExecutionReviewJson;
                } catch (error: unknown) {
                  throwIfAborted(signal);
                  execReview = {
                    observations: [
                      `Execution review failed: ${
                        error instanceof Error ? error.message : String(error)
                      }`
                    ],
                    issues: [],
                    recommendations: []
                  };
                }
                const issues = Array.isArray(execReview.issues)
                  ? execReview.issues.map((it: unknown, j: number) =>
                      normalizeToolAnalysisFinding(
                        {
                          ...((it && typeof it === 'object'
                            ? (it as JsonObject)
                            : {}) as JsonObject),
                          scope:
                            it && typeof it === 'object' && 'scope' in it
                              ? (it as JsonObject).scope
                              : 'execution'
                        },
                        `exec-${discovered.serverName}-${toolCtx.tool.name}-${idx}`,
                        j
                      )
                    )
                  : [];
                sampleCalls.push({
                  callIndex: idx + 1,
                  arguments: suggestedArgs,
                  inputSchemaStatus,
                  ok: true,
                  outcome,
                  durationMs,
                  resultPreview,
                  observations: clampStringArray(execReview.observations),
                  issues
                });
                baseReport.overallRecommendations.push(
                  ...clampStringArray(execReview.recommendations)
                );
              }
              overallObservations = sampleCalls
                .flatMap((call: ToolAnalysisSampleCall) => call.observations)
                .slice(0, 20);
              baseReport.deeperAnalysis = {
                attempted: true,
                sampleCalls,
                overallObservations
              };
            } catch (error: unknown) {
              throwIfAborted(signal);
              baseReport.deeperAnalysis = {
                attempted: true,
                sampleCalls: [
                  {
                    callIndex: 1,
                    arguments: {},
                    ok: false,
                    error: error instanceof Error ? error.message : String(error),
                    observations: [],
                    issues: [
                      normalizeToolAnalysisFinding(
                        {
                          scope: 'execution',
                          severity: 'medium',
                          title: 'Deeper analysis failed',
                          detail: error instanceof Error ? error.message : String(error)
                        },
                        `deeper-fail-${toolCtx.tool.name}`,
                        0
                      )
                    ]
                  }
                ],
                overallObservations
              };
            }
          }
        }

        const toolFindings = [
          ...(baseReport.metadataReview?.issues ?? []),
          ...(baseReport.deeperAnalysis?.sampleCalls.flatMap((c) => c.issues) ?? [])
        ];
        toolReports[toolIndex] = baseReport;
        perToolFindings[toolIndex] = toolFindings;
        addJobEvent(job, {
          type: 'log',
          ts: new Date().toISOString(),
          payload: {
            kind: 'tool_progress',
            phase: 'finished',
            serverName: discovered.serverName,
            toolName: toolCtx.tool.name,
            findings: toolFindings.length,
            skipped: baseReport.deeperAnalysis?.attempted === false,
            message: `Finished ${discovered.serverName}::${toolCtx.tool.name}`
          }
        });
      };
      const concurrency = Math.max(1, Math.min(maxParallelTools, selectedTools.length || 1));
      let nextToolIndex = 0;
      await Promise.all(
        Array.from({ length: concurrency }, async () => {
          while (true) {
            throwIfAborted(signal);
            const current = nextToolIndex;
            nextToolIndex += 1;
            if (current >= selectedTools.length) return;
            await analyzeToolAtIndex(current);
          }
        })
      );
      for (const findings of perToolFindings) {
        for (const finding of findings ?? []) {
          allFindings.push(finding);
          issueCounts[finding.severity] += 1;
        }
      }
      toolsSkipped += perToolSkipped.filter(Boolean).length;

      const analyzedTokenEstimate = estimateToolDefinitionTokens(
        toolReports.map((tool) => ({
          name: tool.toolName,
          title: tool.title,
          description: tool.description,
          inputSchema: tool.inputSchema,
          outputSchema: tool.outputSchema
        })),
        agentConfig?.model ?? 'unknown-model'
      );

      const implementation = implementations[discovered.serverName];
      const health = buildMcpHealthReport({
        tools: discovered.toolListing,
        catalogChecks: checks,
        connection: discovered.connection,
        listingMs: discovered.listingMs,
        endpoint: libraries.servers[discovered.serverName]?.url,
        implementation: implementation
          ? { name: implementation.name, version: implementation.version }
          : undefined,
        protocolVersion: mcp.getServerProtocolVersion(discovered.serverName),
        toolReports,
        samplingEnabled: modes.deeperAnalysis
      });
      serverReports.push({
        health,
        serverName: discovered.serverName,
        toolCountDiscovered:
          'items' in discovered.toolListing ? discovered.toolListing.items.length : 0,
        toolCountAnalyzed: toolReports.length,
        toolCountSkipped: toolReports.filter(
          (tool) => tool.deeperAnalysis && tool.deeperAnalysis.attempted === false
        ).length,
        warnings: [
          ...discovered.warnings,
          ...missingRequested.map((name) => `Requested tool not found: ${name}`)
        ],
        tools: toolReports,
        tokenEstimate: analyzedTokenEstimate,
        ...(catalogChecks ? { catalogChecks } : {})
      });
    }

    throwIfAborted(signal);
    job.result = {
      schemaVersion: 1,
      createdAt: new Date().toISOString(),
      assistantAgentName: selectedAssistantAgentName,
      assistantAgentProvider: agentConfig?.provider,
      assistantAgentModel: agentConfig?.model,
      modes,
      settings: {
        autoRunPolicy: modes.deeperAnalysis ? deeper.autoRunPolicy : undefined,
        sampleCallsPerTool: modes.deeperAnalysis ? deeper.sampleCallsPerTool : undefined,
        toolCallTimeoutMs: modes.deeperAnalysis ? deeper.toolCallTimeoutMs : undefined,
        maxParallelTools
      },
      summary: {
        serversAnalyzed: serverReports.length,
        toolsAnalyzed: serverReports.reduce((sum, s) => sum + s.toolCountAnalyzed, 0),
        toolsSkipped,
        issueCounts,
        ...(modes.catalogChecks
          ? {
              catalogChecks: summarizeMcpCatalogChecks(
                serverReports.flatMap((server) => server.catalogChecks ?? [])
              )
            }
          : {})
      },
      servers: serverReports,
      findings: allFindings,
      mcpServerVersions: Object.keys(mcpServerVersions).length > 0 ? mcpServerVersions : undefined
    };
  } finally {
    await mcp.disconnectAll();
  }
}
