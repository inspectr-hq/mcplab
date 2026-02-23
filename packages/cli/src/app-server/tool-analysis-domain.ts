import type { ServerResponse } from 'node:http';
import type { AgentConfig, EvalConfig, ToolDef } from '@inspectr/mcplab-core';
import { chatWithAgent, McpClientManager } from '@inspectr/mcplab-core';
import type { AppSettings } from './types.js';
import { addJobEvent } from './jobs.js';
import { readLibraries } from './libraries-store.js';
import {
  pickDefaultAssistantAgentName,
  resolveAssistantAgentFromLibraries,
  truncateJson
} from './scenario-assistant-domain.js';

type JobEvent = {
  type: 'started' | 'log' | 'completed' | 'error';
  ts: string;
  payload: Record<string, unknown>;
};

export interface ToolAnalysisFinding {
  id: string;
  scope:
    | 'tool_name'
    | 'description'
    | 'schema'
    | 'ergonomics'
    | 'safety'
    | 'eval_readiness'
    | 'execution';
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info';
  title: string;
  detail: string;
  suggestion?: string;
}

interface ToolAnalysisSuggestedSchemaChange {
  type: 'description' | 'parameter' | 'required' | 'enum' | 'constraints' | 'examples' | 'naming';
  summary: string;
  before?: string;
  after?: string;
}

interface ToolAnalysisToolReport {
  serverName: string;
  toolName: string;
  publicToolName: string;
  description?: string;
  inputSchema?: unknown;
  safetyClassification: 'read_like' | 'unsafe_or_unknown';
  classificationReason: string;
  metadataReview?: {
    strengths: string[];
    issues: ToolAnalysisFinding[];
    suggestedDescription?: string;
    suggestedSchemaChanges: ToolAnalysisSuggestedSchemaChange[];
    evalReadinessNotes: string[];
  };
  deeperAnalysis?: {
    attempted: boolean;
    skippedReason?: string;
    sampleCalls: Array<{
      callIndex: number;
      arguments: unknown;
      ok: boolean;
      durationMs?: number;
      resultPreview?: string;
      error?: string;
      observations: string[];
      issues: ToolAnalysisFinding[];
    }>;
    overallObservations: string[];
  };
  overallRecommendations: string[];
}

type ToolAnalysisSampleCall = NonNullable<
  ToolAnalysisToolReport['deeperAnalysis']
>['sampleCalls'][number];

interface ToolAnalysisServerReport {
  serverName: string;
  toolCountDiscovered: number;
  toolCountAnalyzed: number;
  toolCountSkipped: number;
  warnings: string[];
  tools: ToolAnalysisToolReport[];
}

export interface ToolAnalysisReport {
  schemaVersion: 1;
  createdAt: string;
  assistantAgentName: string;
  assistantAgentModel: string;
  modes: {
    metadataReview: boolean;
    deeperAnalysis: boolean;
  };
  settings: {
    autoRunPolicy?: 'read_only_allowlist';
    sampleCallsPerTool?: number;
    toolCallTimeoutMs?: number;
  };
  summary: {
    serversAnalyzed: number;
    toolsAnalyzed: number;
    toolsSkipped: number;
    issueCounts: {
      critical: number;
      high: number;
      medium: number;
      low: number;
      info: number;
    };
  };
  servers: ToolAnalysisServerReport[];
  findings: ToolAnalysisFinding[];
}

interface ToolAnalysisDiscoveredTool {
  name: string;
  description?: string;
  inputSchema?: unknown;
  safetyClassification: 'read_like' | 'unsafe_or_unknown';
  classificationReason: string;
}

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
  safetyClassification: 'read_like' | 'unsafe_or_unknown';
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

const TOOL_ANALYSIS_READ_PREFIXES = [
  'get',
  'list',
  'search',
  'find',
  'describe',
  'read',
  'fetch',
  'lookup',
  'query',
  'inspect'
];

const TOOL_ANALYSIS_UNSAFE_PREFIXES = [
  'create',
  'update',
  'delete',
  'remove',
  'write',
  'set',
  'patch',
  'post',
  'put',
  'execute',
  'run',
  'trigger'
];

function classifyToolSafety(
  toolName: string,
  inputSchema?: unknown
): {
  safetyClassification: 'read_like' | 'unsafe_or_unknown';
  classificationReason: string;
} {
  const lower = toolName.toLowerCase();
  const read = TOOL_ANALYSIS_READ_PREFIXES.find((p) => lower.startsWith(p));
  const unsafe = TOOL_ANALYSIS_UNSAFE_PREFIXES.find((p) => lower.startsWith(p));
  if (unsafe) {
    return {
      safetyClassification: 'unsafe_or_unknown',
      classificationReason: `Name starts with potentially side-effectful prefix '${unsafe}'.`
    };
  }
  let schemaHint = '';
  try {
    const schemaText = JSON.stringify(inputSchema ?? '').toLowerCase();
    if (/(confirm|force|commit|delete|write|update)/.test(schemaText)) {
      schemaHint = ' Schema contains possibly mutating parameter names.';
    }
  } catch {
    // ignore schema stringify errors
  }
  if (read) {
    return {
      safetyClassification: 'read_like',
      classificationReason: `Name starts with read-like prefix '${read}'.${schemaHint}`.trim()
    };
  }
  return {
    safetyClassification: 'unsafe_or_unknown',
    classificationReason:
      `Tool name does not match read-only allowlist prefixes.${schemaHint}`.trim()
  };
}

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

function parseJsonFromAssistantText<T = unknown>(text: string): T {
  const cleaned = text.trim();
  try {
    return JSON.parse(cleaned) as T;
  } catch {
    const fenced =
      cleaned.match(/```json\s*([\s\S]+?)```/i) ?? cleaned.match(/```\s*([\s\S]+?)```/i);
    if (fenced) return JSON.parse(fenced[1]) as T;
    throw new Error('Assistant returned invalid JSON');
  }
}

async function chatJsonWithAgent(
  agent: AgentConfig,
  system: string,
  userPrompt: string
): Promise<unknown> {
  const first = await chatWithAgent({
    agent,
    system,
    messages: [{ role: 'user', content: userPrompt }]
  });
  try {
    return parseJsonFromAssistantText(first.content ?? '');
  } catch {
    const retry = await chatWithAgent({
      agent,
      system,
      messages: [
        { role: 'user', content: userPrompt },
        { role: 'assistant', content: first.content ?? '' },
        {
          role: 'user',
          content: 'Reply again with valid JSON only. No prose, no markdown fences.'
        }
      ]
    });
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

export async function discoverMcpToolsForServers(
  serversByName: EvalConfig['servers'],
  serverNames: string[]
): Promise<{
  mcp: McpClientManager;
  servers: Array<{
    serverName: string;
    warnings: string[];
    tools: ToolAnalysisToolContext[];
  }>;
}> {
  const mcp = new McpClientManager();
  const discovered: Array<{
    serverName: string;
    warnings: string[];
    tools: ToolAnalysisToolContext[];
  }> = [];
  for (const serverName of serverNames) {
    const server = serversByName[serverName];
    const entry = { serverName, warnings: [] as string[], tools: [] as ToolAnalysisToolContext[] };
    if (!server) {
      entry.warnings.push(`Server '${serverName}' not found.`);
      discovered.push(entry);
      continue;
    }
    try {
      await mcp.connectAll({ [serverName]: server });
      const tools = await mcp.listTools(serverName);
      entry.tools = tools.map((tool) => {
        const safety = classifyToolSafety(tool.name, tool.inputSchema);
        return {
          serverName,
          tool,
          safetyClassification: safety.safetyClassification,
          classificationReason: safety.classificationReason
        };
      });
    } catch (error: unknown) {
      entry.warnings.push(
        `Failed to load tools: ${error instanceof Error ? error.message : String(error)}`
      );
    }
    discovered.push(entry);
  }
  return { mcp, servers: discovered };
}

function timeoutPromise<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<T>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`${label} timed out after ${timeoutMs}ms`)),
      timeoutMs
    );
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  }) as Promise<T>;
}

function summarizeToolResultForReport(result: unknown, maxChars = 8000): string {
  return truncateJson(result, maxChars);
}

export async function runToolAnalysisJob(params: {
  job: ToolAnalysisJob;
  settings: AppSettings;
  requestedAssistantAgentName?: string;
  serverNames: string[];
  selectedToolsByServer?: Record<string, string[]>;
  modes: { metadataReview: boolean; deeperAnalysis: boolean };
  deeper: {
    autoRunPolicy: 'read_only_allowlist';
    sampleCallsPerTool: number;
    toolCallTimeoutMs: number;
  };
}): Promise<void> {
  const { job, settings, serverNames, selectedToolsByServer, modes, deeper } = params;
  const libraries = readLibraries(settings.librariesDir);
  const selectedAssistantAgentName = pickDefaultAssistantAgentName({
    requested: params.requestedAssistantAgentName,
    settingsDefault: settings.scenarioAssistantAgentName,
    agentNames: Object.keys(libraries.agents)
  });
  if (!selectedAssistantAgentName) {
    throw new Error(
      'No assistant agent available. Configure one in Settings or add a library agent.'
    );
  }
  const agentConfig = resolveAssistantAgentFromLibraries(libraries, selectedAssistantAgentName);
  addJobEvent(job, {
    type: 'log',
    ts: new Date().toISOString(),
    payload: {
      message: `Using assistant agent ${selectedAssistantAgentName} (${agentConfig.provider}/${agentConfig.model})`
    }
  });

  const { mcp, servers: discoveredServers } = await discoverMcpToolsForServers(
    libraries.servers,
    serverNames
  );
  try {
    const serverReports: ToolAnalysisServerReport[] = [];
    const allFindings: ToolAnalysisFinding[] = [];
    const issueCounts = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
    let toolsSkipped = 0;

    for (const discovered of discoveredServers) {
      if (job.abortController.signal.aborted) throw new Error('Tool analysis aborted by user');
      addJobEvent(job, {
        type: 'log',
        ts: new Date().toISOString(),
        payload: {
          message: `Analyzing server ${discovered.serverName} (${discovered.tools.length} tools)`
        }
      });
      const requestedToolNames = selectedToolsByServer?.[discovered.serverName];
      const requestedSet = requestedToolNames ? new Set(requestedToolNames) : null;
      const selectedTools = requestedSet
        ? discovered.tools.filter((t) => requestedSet.has(t.tool.name))
        : discovered.tools;
      const missingRequested = requestedSet
        ? requestedToolNames!.filter((name) => !discovered.tools.some((t) => t.tool.name === name))
        : [];

      const toolReports: ToolAnalysisToolReport[] = [];
      for (const toolCtx of selectedTools) {
        if (job.abortController.signal.aborted) throw new Error('Tool analysis aborted by user');
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
          description: toolCtx.tool.description,
          inputSchema: toolCtx.tool.inputSchema,
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
              JSON.stringify({
                serverName: discovered.serverName,
                toolName: toolCtx.tool.name,
                description: toolCtx.tool.description ?? '',
                inputSchema: toolCtx.tool.inputSchema ?? null,
                projectGoal: 'MCP agent/workflow evaluation friendliness'
              })
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
          const canAutoRun =
            deeper.autoRunPolicy !== 'read_only_allowlist' ||
            toolCtx.safetyClassification === 'read_like';
          if (!canAutoRun) {
            baseReport.deeperAnalysis = {
              attempted: false,
              skippedReason: `Skipped by safety policy (${deeper.autoRunPolicy}): ${toolCtx.classificationReason}`,
              sampleCalls: [],
              overallObservations: []
            };
            toolsSkipped += 1;
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
                JSON.stringify({
                  serverName: discovered.serverName,
                  toolName: toolCtx.tool.name,
                  description: toolCtx.tool.description ?? '',
                  inputSchema: toolCtx.tool.inputSchema ?? null,
                  maxCalls: deeper.sampleCallsPerTool
                })
              )) as SamplePlanJson;
              const suggestedSamples = Array.isArray(samplePlan.sampleCalls)
                ? samplePlan.sampleCalls.slice(0, deeper.sampleCallsPerTool)
                : [{ arguments: {} }];
              for (let idx = 0; idx < suggestedSamples.length; idx += 1) {
                const suggestedArgs = suggestedSamples[idx]?.arguments ?? {};
                const started = Date.now();
                try {
                  const result = await timeoutPromise(
                    mcp.callTool(discovered.serverName, toolCtx.tool.name, suggestedArgs),
                    deeper.toolCallTimeoutMs,
                    `${discovered.serverName}::${toolCtx.tool.name}`
                  );
                  const durationMs = Date.now() - started;
                  const resultPreview = summarizeToolResultForReport(result, 8000);
                  let execReview: ExecutionReviewJson = {};
                  try {
                    execReview = (await chatJsonWithAgent(
                      agentConfig,
                      toolAnalysisExecutionReviewSystemPrompt(),
                      JSON.stringify({
                        serverName: discovered.serverName,
                        toolName: toolCtx.tool.name,
                        arguments: suggestedArgs,
                        resultPreview: truncateJson(result, 4000),
                        description: toolCtx.tool.description ?? '',
                        inputSchema: toolCtx.tool.inputSchema ?? null
                      })
                    )) as ExecutionReviewJson;
                  } catch (error: unknown) {
                    execReview = {
                      observations: [
                        `Execution review failed: ${error instanceof Error ? error.message : String(error)}`
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
                    ok: true,
                    durationMs,
                    resultPreview,
                    observations: clampStringArray(execReview.observations),
                    issues
                  });
                  baseReport.overallRecommendations.push(
                    ...clampStringArray(execReview.recommendations)
                  );
                } catch (error: unknown) {
                  sampleCalls.push({
                    callIndex: idx + 1,
                    arguments: suggestedArgs,
                    ok: false,
                    durationMs: Date.now() - started,
                    error: error instanceof Error ? error.message : String(error),
                    observations: [],
                    issues: [
                      normalizeToolAnalysisFinding(
                        {
                          scope: 'execution',
                          severity: 'medium',
                          title: 'Sample call failed',
                          detail: error instanceof Error ? error.message : String(error)
                        },
                        `exec-fail-${discovered.serverName}-${toolCtx.tool.name}`,
                        idx
                      )
                    ]
                  });
                }
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
        for (const finding of toolFindings) {
          allFindings.push(finding);
          issueCounts[finding.severity] += 1;
        }
        toolReports.push(baseReport);
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
      }

      serverReports.push({
        serverName: discovered.serverName,
        toolCountDiscovered: discovered.tools.length,
        toolCountAnalyzed: toolReports.length,
        toolCountSkipped: toolReports.filter(
          (tool) => tool.deeperAnalysis && tool.deeperAnalysis.attempted === false
        ).length,
        warnings: [
          ...discovered.warnings,
          ...missingRequested.map((name) => `Requested tool not found: ${name}`)
        ],
        tools: toolReports
      });
    }

    job.result = {
      schemaVersion: 1,
      createdAt: new Date().toISOString(),
      assistantAgentName: selectedAssistantAgentName,
      assistantAgentModel: agentConfig.model,
      modes,
      settings: {
        autoRunPolicy: modes.deeperAnalysis ? deeper.autoRunPolicy : undefined,
        sampleCallsPerTool: modes.deeperAnalysis ? deeper.sampleCallsPerTool : undefined,
        toolCallTimeoutMs: modes.deeperAnalysis ? deeper.toolCallTimeoutMs : undefined
      },
      summary: {
        serversAnalyzed: serverReports.length,
        toolsAnalyzed: serverReports.reduce((sum, s) => sum + s.toolCountAnalyzed, 0),
        toolsSkipped,
        issueCounts
      },
      servers: serverReports,
      findings: allFindings
    };
  } finally {
    // McpClientManager currently has no explicit close lifecycle API.
  }
}
