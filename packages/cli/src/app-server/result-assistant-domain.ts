import type { ServerResponse } from 'node:http';
import type {
  LlmAgentConfig,
  AssistantRuntimeMessage,
  AssistantRuntimeDefinition,
  AssistantRuntimeEvent,
  AssistantRuntimeSession,
  AssistantRuntimeToolCall,
  ResultsJson,
  ToolDef
} from '@inspectr/mcplab-core';
import { McpClientManager } from '@inspectr/mcplab-core';
import {
  cleanupSessionsByTtl,
  makeAssistantToolPublicName,
  touchSession,
  truncateJson,
  withTimeout
} from './assistant-common.js';
import type { AssistantSseEvent } from './assistant-events.js';
import { endAssistantSseClients } from './assistant-events.js';
import { setupAssistantRuntimeSession } from './assistant-service.js';
import type { AssistantRuntimeFactory } from '@inspectr/mcplab-core';
import {
  isResultAssistantAllowedTool,
  isResultAssistantAutoApprovedTool
} from './result-assistant-tools.js';

type ResultAssistantPendingToolCall = AssistantRuntimeToolCall;
type ResultAssistantChatMessage = AssistantRuntimeMessage;

export interface ResultAssistantReferenceReport {
  path: string;
  relativePath: string;
  name: string;
  sizeBytes: number;
  mtime: string;
}

export interface ResultAssistantSession {
  id: string;
  scope: 'run' | 'all_runs';
  runId: string | null;
  createdAt: number;
  lastTouchedAt: number;
  selectedAssistantAgentName: string;
  model: string;
  provider: string;
  toolsLoaded: number;
  toolServers: string[];
  initialMessages: ResultAssistantChatMessage[];
  events: AssistantSseEvent[];
  clients: Set<ServerResponse>;
  runtime: AssistantRuntimeSession;
}

export type ResultAssistantSessionInitializer = Omit<ResultAssistantSession, 'runtime'>;

interface ResultAssistantResources {
  agentConfig: LlmAgentConfig;
  resultSummary: ResultsJson | null;
  referenceReportsForRun: ResultAssistantReferenceReport[];
  mcp: McpClientManager;
  tools: ToolDef[];
  toolPublicMap: Map<string, { server: string; tool: string }>;
  systemPromptCache?: string;
}

function createResultAssistantResources(
  agentConfig: LlmAgentConfig,
  resultSummary: ResultsJson | null,
  referenceReportsForRun: ResultAssistantReferenceReport[]
): ResultAssistantResources {
  return {
    agentConfig,
    mcp: new McpClientManager(),
    tools: [],
    toolPublicMap: new Map(),
    resultSummary,
    referenceReportsForRun
  };
}

const RESULT_ASSISTANT_SESSION_TTL_MS = 30 * 60 * 1000;
const RESULT_ASSISTANT_MCP_SERVER_NAME = 'mcplab';

// The hard TTL also aborts work in abandoned sessions; active operations refresh lastTouchedAt.
export function cleanupResultAssistantSessions(
  sessions: Map<string, ResultAssistantSession>,
  now = Date.now()
): void {
  cleanupSessionsByTtl(sessions, RESULT_ASSISTANT_SESSION_TTL_MS, now, (session) => {
    void Promise.resolve(session.runtime.dispose()).catch(() => {});
    endAssistantSseClients(session);
  });
}

export function touchResultAssistantSession(session: ResultAssistantSession): void {
  touchSession(session);
}

export function resultAssistantSessionView(session: ResultAssistantSession) {
  const runtimeSnapshot = session.runtime.getSnapshot();
  return {
    id: session.id,
    scope: session.scope,
    runId: session.runId,
    createdAt: new Date(session.createdAt).toISOString(),
    updatedAt: new Date(session.lastTouchedAt).toISOString(),
    selectedAssistantAgentName: session.selectedAssistantAgentName,
    model: session.model,
    provider: session.provider,
    toolsLoaded: session.toolsLoaded,
    toolServers: session.toolServers,
    messages: runtimeSnapshot.messages,
    pendingToolCalls: runtimeSnapshot.pendingToolCalls
  };
}

function createResultAssistantSetup(
  session: ResultAssistantSessionInitializer,
  agentConfig: LlmAgentConfig,
  resultSummary: ResultsJson | null,
  referenceReportsForRun: ResultAssistantResources['referenceReportsForRun'],
  refreshReports: () => ResultAssistantResources['referenceReportsForRun']
) {
  const state = createResultAssistantResources(agentConfig, resultSummary, referenceReportsForRun);
  let disposePromise: Promise<void> | undefined;
  const dispose = () => {
    disposePromise ??= Promise.resolve().then(() => state.mcp.disconnectAll());
    return disposePromise;
  };
  return {
    dispose,
    async preload(mcpServerUrl: string): Promise<void> {
      await state.mcp.connectAll({
        [RESULT_ASSISTANT_MCP_SERVER_NAME]: { transport: 'http', url: mcpServerUrl }
      });
      const discovered = await state.mcp.listTools(RESULT_ASSISTANT_MCP_SERVER_NAME);
      const usedNames = new Set<string>();
      for (const tool of discovered) {
        if (!isResultAssistantAllowedTool(tool.name)) continue;
        const publicName = makeAssistantToolPublicName(
          RESULT_ASSISTANT_MCP_SERVER_NAME,
          tool.name,
          usedNames
        );
        state.toolPublicMap.set(publicName, {
          server: RESULT_ASSISTANT_MCP_SERVER_NAME,
          tool: tool.name
        });
        state.tools.push({
          ...tool,
          name: publicName,
          description:
            `${tool.description ?? ''}\n[server=${RESULT_ASSISTANT_MCP_SERVER_NAME} tool=${tool.name}]`.trim()
        });
      }
      session.toolsLoaded = state.tools.length;
      session.toolServers = Array.from(
        new Set(state.tools.map((tool) => tool.name.split('__')[0]))
      );
    },
    createRuntimeDefinition(): AssistantRuntimeDefinition {
      return {
        assistant: 'result',
        agent: state.agentConfig,
        context: {
          scope: session.scope,
          runId: session.runId,
          resultSummary: state.resultSummary,
          referenceReportsForRun: state.referenceReportsForRun
        },
        initialMessages: session.initialMessages,
        dispose,
        getSystemPrompt: () => resultAssistantSystemPrompt(session, state),
        tools: state.tools.map((tool) => {
          const mapping = state.toolPublicMap.get(tool.name)!;
          return {
            name: tool.name,
            server: mapping.server,
            tool: mapping.tool,
            description: tool.description,
            inputSchema: tool.inputSchema,
            execute: async (arguments_, signal) => {
              const result = await withTimeout(
                () => state.mcp.callTool(mapping.server, mapping.tool, arguments_, { signal }),
                30_000,
                'Tool call timed out after 30000ms',
                signal
              );
              if (mapping.tool === 'mcplab_write_markdown_report' && session.scope === 'run') {
                state.referenceReportsForRun = refreshReports();
                state.systemPromptCache = undefined;
              }
              return result;
            }
          };
        }),
        approvalPolicy: (name) => {
          const rawName = state.toolPublicMap.get(name)?.tool;
          if (!rawName) return 'approval_required';
          return isResultAssistantAllowedTool(rawName) && isResultAssistantAutoApprovedTool(rawName)
            ? 'automatic'
            : 'approval_required';
        }
      };
    }
  };
}

export async function setupResultAssistantSession(params: {
  session: ResultAssistantSessionInitializer;
  agentConfig: LlmAgentConfig;
  resultSummary: ResultsJson | null;
  referenceReportsForRun: ResultAssistantResources['referenceReportsForRun'];
  mcpServerUrl: string;
  refreshReports: () => ResultAssistantResources['referenceReportsForRun'];
  assistantRuntimeFactory: AssistantRuntimeFactory;
  onEvent(event: AssistantRuntimeEvent, session: ResultAssistantSession): void;
  onActivity(session: ResultAssistantSession): void;
}): Promise<ResultAssistantSession> {
  const setup = createResultAssistantSetup(
    params.session,
    params.agentConfig,
    params.resultSummary,
    params.referenceReportsForRun,
    params.refreshReports
  );
  return setupAssistantRuntimeSession({
    session: params.session,
    factory: params.assistantRuntimeFactory,
    disposeSetup: setup.dispose,
    prepare: async (emitInitialEvent) => {
      try {
        await setup.preload(params.mcpServerUrl);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        params.session.initialMessages.push({
          id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          role: 'system',
          text: `Warning: could not preload MCPLab MCP tools: ${message}`,
          createdAt: new Date().toISOString()
        });
        emitInitialEvent({
          type: 'session_warning',
          ts: new Date().toISOString(),
          payload: { warning: message }
        });
      }
      return setup.createRuntimeDefinition();
    },
    onEvent: params.onEvent,
    onActivity: params.onActivity
  });
}

function resultAssistantSystemPrompt(
  session: ResultAssistantSessionInitializer,
  state: ResultAssistantResources
): string {
  if (state.systemPromptCache) return state.systemPromptCache;
  const scenarioLimit = 30;
  const totalScenarioCount = state.resultSummary?.scenarios.length ?? 0;
  const omittedScenarioCount = Math.max(0, totalScenarioCount - scenarioLimit);
  const scenarioSummaries =
    state.resultSummary?.scenarios.slice(0, scenarioLimit).map((sc) => ({
      scenario_id: sc.scenario_id,
      agent: sc.agent,
      pass_rate: sc.pass_rate,
      run_count: sc.runs.length,
      sample_failures: sc.runs.flatMap((r) => r.failures).slice(0, 5)
    })) ?? [];
  const toolLines = state.tools.map((tool) => {
    const mapping = state.toolPublicMap.get(tool.name);
    const schemaText = tool.inputSchema ? truncateJson(tool.inputSchema, 500) : '{}';
    return `- ${tool.name} (server=${mapping?.server ?? 'unknown'}, tool=${
      mapping?.tool ?? tool.name
    }) schema=${schemaText}`;
  });
  const prompt = [
    'You are the MCP Labs Result Assistant.',
    'Help the user understand MCP evaluation run results, failures, and tool behavior.',
    'Be concise and practical.',
    'You may call MCPLab MCP tools for grounded follow-up actions (e.g. write a markdown report) when useful, but only when it improves the answer.',
    'Tool selection policy: prefer search_* tools first for retrieval; fall back to list_* tools when the query is unknown, broad, or full coverage is required.',
    'Use up to three external tool calls per batch. Read-only batches can continue automatically. If any call in a batch requires approval, wait for a decision on every call in that batch, including read calls; each call is approved or denied separately.',
    'Respond in plain text. If you need to call a tool, use the available tools directly.',
    session.scope === 'all_runs'
      ? 'Scope: all historical runs. Use mcplab_results_search for broad retrieval, mcplab_results_context for focused excerpts, and mcplab_read_run_artifact only for raw fallback reads.'
      : omittedScenarioCount > 0
        ? `Important: Only the first ${scenarioLimit} of ${totalScenarioCount} scenarios are included in the prompt context. If the user asks about coverage/completeness, mention that ${omittedScenarioCount} scenario(s) are omitted and suggest using tools to inspect full results.`
        : 'All scenarios are included in the prompt context.',
    session.scope === 'all_runs'
      ? 'Run result context: none preloaded. You can inspect any run from history using available tools.'
      : `Run result context: ${JSON.stringify({
          run_id: state.resultSummary?.metadata.run_id,
          timestamp: state.resultSummary?.metadata.timestamp,
          run_note: state.resultSummary?.metadata.run_note ?? null,
          config_hash: state.resultSummary?.metadata.config_hash,
          summary: state.resultSummary?.summary,
          scenario_count_total: totalScenarioCount,
          scenario_count_included: scenarioSummaries.length,
          scenario_count_omitted: omittedScenarioCount,
          scenarios: scenarioSummaries,
          linked_custom_reports: state.referenceReportsForRun.slice(0, 20)
        })}`,
    session.scope === 'all_runs'
      ? 'For custom markdown reports across runs, use mcplab_search_markdown_reports (no query needed for full listing, or filter by run_id/name). Then read selected files with mcplab_read_markdown_report.'
      : 'For custom markdown reports linked to this run, use mcplab_search_markdown_reports with run_id set to the current run id. Then read selected files with mcplab_read_markdown_report.',
    toolLines.length > 0
      ? `Available MCPLab MCP tools:\n${toolLines.join('\n')}`
      : 'No MCPLab MCP tools available.'
  ].join('\n');
  state.systemPromptCache = prompt;
  return prompt;
}
