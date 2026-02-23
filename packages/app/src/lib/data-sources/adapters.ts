import type {
  ConversationItem,
  EvalConfig,
  EvalResult,
  EvalRule,
  ScenarioRun,
  ToolCall
} from '@/types/eval';
import type {
  CoreEvalConfig,
  CoreResultsJson,
  TraceUiEvent,
  TraceUiToolCallEvent,
  WorkspaceConfigRecord
} from './types';

function toId(base: string, index: number): string {
  return `${base}-${index + 1}`;
}

export function fromCoreConfigYaml(record: WorkspaceConfigRecord): EvalConfig {
  const serverEntries = Object.entries(record.config.servers);
  const agentEntries = Object.entries(record.config.agents);
  const serverIdByName = new Map<string, string>();
  const agentIdByName = new Map<string, string>();

  const servers = serverEntries.map(([name, server], index) => {
    const id = toId('srv', index);
    serverIdByName.set(name, id);
    const authType: 'none' | 'bearer' | 'api-key' | 'oauth2' =
      server.auth?.type === 'bearer'
        ? 'bearer'
        : server.auth?.type === 'oauth_client_credentials'
          ? 'api-key'
          : server.auth?.type === 'oauth_authorization_code'
            ? 'oauth2'
            : 'none';
    return {
      id,
      name,
      transport: 'streamable-http' as const,
      url: server.url,
      authType,
      authValue: server.auth?.type === 'bearer' ? server.auth.env : undefined,
      oauthClientId:
        server.auth?.type === 'oauth_authorization_code' ? server.auth.client_id : undefined,
      oauthClientSecret:
        server.auth?.type === 'oauth_authorization_code' ? server.auth.client_secret : undefined,
      oauthRedirectUrl:
        server.auth?.type === 'oauth_authorization_code' ? server.auth.redirect_url : undefined,
      oauthScope: server.auth?.type === 'oauth_authorization_code' ? server.auth.scope : undefined
    };
  });

  const agents = agentEntries.map(([name, agent], index) => {
    const id = toId('agt', index);
    agentIdByName.set(name, id);
    const provider: 'openai' | 'anthropic' | 'azure' =
      agent.provider === 'azure_openai' ? 'azure' : agent.provider;
    return {
      id,
      name,
      provider,
      model: agent.model,
      temperature: agent.temperature ?? 0,
      maxTokens: agent.max_tokens ?? 2048,
      systemPrompt: agent.system
    };
  });

  const scenarios = record.config.scenarios.map((scenario, index) => {
    const evalRules: EvalRule[] = [];
    for (const tool of scenario.eval?.tool_constraints?.required_tools ?? []) {
      evalRules.push({ type: 'required_tool', value: tool });
    }
    for (const tool of scenario.eval?.tool_constraints?.forbidden_tools ?? []) {
      evalRules.push({ type: 'forbidden_tool', value: tool });
    }
    for (const assertion of scenario.eval?.response_assertions ?? []) {
      if (assertion.type === 'regex') {
        evalRules.push({ type: 'response_contains', value: assertion.pattern });
      } else {
        evalRules.push({
          type: 'response_contains',
          value: `${assertion.path}${assertion.equals !== undefined ? ` == ${assertion.equals}` : ''}`
        });
      }
    }

    return {
      id: scenario.id || toId('scn', index),
      name: scenario.name || scenario.id || `Scenario ${index + 1}`,
      serverIds: scenario.servers
        .map((name) => serverIdByName.get(name))
        .filter(Boolean) as string[],
      prompt: scenario.prompt,
      snapshotEval: scenario.snapshot_eval
        ? {
            enabled: scenario.snapshot_eval.enabled,
            baselineSnapshotId: scenario.snapshot_eval.baseline_snapshot_id,
            baselineSourceRunId: scenario.snapshot_eval.baseline_source_run_id,
            lastUpdatedAt: scenario.snapshot_eval.last_updated_at
          }
        : undefined,
      evalRules,
      extractRules: (scenario.extract ?? []).map((rule) => ({
        name: rule.name,
        pattern: rule.regex
      }))
    };
  });

  return {
    id: record.id,
    name: record.name,
    description: record.path,
    loadError: record.error,
    loadWarnings: record.warnings,
    servers,
    serverRefs: record.config.server_refs ?? [],
    agents,
    agentRefs: record.config.agent_refs ?? [],
    scenarios,
    scenarioRefs: record.config.scenario_refs ?? [],
    runDefaults:
      record.config.run_defaults?.selected_agents &&
      record.config.run_defaults.selected_agents.length > 0
        ? {
            selectedAgentNames: [...record.config.run_defaults.selected_agents]
          }
        : undefined,
    snapshotEval: record.config.snapshot_eval
      ? {
          enabled: record.config.snapshot_eval.enabled,
          mode: record.config.snapshot_eval.mode,
          baselineSnapshotId: record.config.snapshot_eval.baseline_snapshot_id,
          baselineSourceRunId: record.config.snapshot_eval.baseline_source_run_id,
          lastUpdatedAt: record.config.snapshot_eval.last_updated_at
        }
      : undefined,
    createdAt: record.mtime,
    updatedAt: record.mtime,
    sourcePath: record.path
  };
}

export function fromCoreLibraries(libraries: {
  servers: CoreEvalConfig['servers'];
  agents: CoreEvalConfig['agents'];
  scenarios: CoreEvalConfig['scenarios'];
}): Pick<EvalConfig, 'servers' | 'agents' | 'scenarios'> {
  const record: WorkspaceConfigRecord = {
    id: 'library',
    name: 'library',
    path: 'library',
    mtime: new Date(0).toISOString(),
    hash: '',
    config: {
      servers: libraries.servers,
      agents: libraries.agents,
      scenarios: libraries.scenarios
    }
  };
  const mapped = fromCoreConfigYaml(record);
  return {
    servers: mapped.servers,
    agents: mapped.agents,
    scenarios: mapped.scenarios
  };
}

export function toCoreConfigYaml(config: EvalConfig): CoreEvalConfig {
  const serverNameById = new Map<string, string>();
  const agentNameById = new Map<string, string>();

  const servers: CoreEvalConfig['servers'] = {};
  for (const server of config.servers) {
    const name = server.name || server.id;
    serverNameById.set(server.id, name);
    servers[name] = {
      transport: 'http',
      url: server.url || 'http://localhost:3000/mcp',
      auth:
        server.authType === 'bearer'
          ? { type: 'bearer', env: server.authValue || 'MCP_TOKEN' }
          : server.authType === 'oauth2'
            ? {
                type: 'oauth_authorization_code',
                client_id: server.oauthClientId || '',
                client_secret: server.oauthClientSecret || undefined,
                redirect_url: server.oauthRedirectUrl || 'http://localhost:6274/oauth/',
                scope: server.oauthScope || undefined
              }
            : undefined
    };
  }

  const agents: CoreEvalConfig['agents'] = {};
  for (const agent of config.agents) {
    const name = agent.name || agent.id;
    agentNameById.set(agent.id, name);
    agents[name] = {
      provider:
        agent.provider === 'azure'
          ? 'azure_openai'
          : agent.provider === 'anthropic'
            ? 'anthropic'
            : 'openai',
      model: agent.model,
      temperature: agent.temperature,
      max_tokens: agent.maxTokens,
      system: agent.systemPrompt
    };
  }

  const scenarios = config.scenarios.map((scenario) => {
    const required_tools = scenario.evalRules
      .filter((rule) => rule.type === 'required_tool')
      .map((rule) => rule.value);
    const forbidden_tools = scenario.evalRules
      .filter((rule) => rule.type === 'forbidden_tool')
      .map((rule) => rule.value);
    const response_assertions = scenario.evalRules
      .filter((rule) => rule.type === 'response_contains' || rule.type === 'response_not_contains')
      .map((rule) => ({ type: 'regex' as const, pattern: rule.value }));

    return {
      id: scenario.id,
      name: scenario.name || undefined,
      servers: scenario.serverIds.map((id) => serverNameById.get(id)).filter(Boolean) as string[],
      prompt: scenario.prompt,
      snapshot_eval: scenario.snapshotEval
        ? {
            enabled: scenario.snapshotEval.enabled,
            baseline_snapshot_id: scenario.snapshotEval.baselineSnapshotId,
            baseline_source_run_id: scenario.snapshotEval.baselineSourceRunId,
            last_updated_at: scenario.snapshotEval.lastUpdatedAt
          }
        : undefined,
      eval: {
        tool_constraints: {
          required_tools,
          forbidden_tools
        },
        response_assertions
      },
      extract: scenario.extractRules.map((rule) => ({
        name: rule.name,
        from: 'final_text' as const,
        regex: rule.pattern
      }))
    };
  });

  return {
    servers,
    server_refs: config.serverRefs ?? [],
    agents,
    agent_refs: config.agentRefs ?? [],
    scenarios,
    scenario_refs: config.scenarioRefs ?? [],
    run_defaults:
      config.runDefaults?.selectedAgentNames && config.runDefaults.selectedAgentNames.length > 0
        ? {
            selected_agents: [...config.runDefaults.selectedAgentNames]
          }
        : undefined,
    snapshot_eval: config.snapshotEval
      ? {
          enabled: config.snapshotEval.enabled,
          mode: config.snapshotEval.mode,
          baseline_snapshot_id: config.snapshotEval.baselineSnapshotId,
          baseline_source_run_id: config.snapshotEval.baselineSourceRunId,
          last_updated_at: config.snapshotEval.lastUpdatedAt
        }
      : undefined
  };
}

export function toCoreLibraries(input: Pick<EvalConfig, 'servers' | 'agents' | 'scenarios'>): {
  servers: CoreEvalConfig['servers'];
  agents: CoreEvalConfig['agents'];
  scenarios: CoreEvalConfig['scenarios'];
} {
  const core = toCoreConfigYaml({
    id: 'library',
    name: 'library',
    description: '',
    servers: input.servers,
    serverRefs: [],
    agents: input.agents,
    agentRefs: [],
    scenarios: input.scenarios,
    scenarioRefs: [],
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString()
  });
  return {
    servers: core.servers,
    agents: core.agents,
    scenarios: core.scenarios
  };
}

function toToolCalls(
  run: CoreResultsJson['scenarios'][number]['runs'][number],
  traceCalls: TraceUiToolCallEvent[]
): ToolCall[] {
  return run.tool_calls.map((name, idx) => {
    const trace = traceCalls[idx];
    return {
      name,
      arguments: (trace?.args as Record<string, unknown>) ?? {},
      duration: run.tool_durations_ms[idx] ?? 0,
      timestamp: trace?.ts_start ?? new Date().toISOString()
    };
  });
}

function groupScenarioRunEvents(traceEvents: TraceUiEvent[]): Map<string, TraceUiEvent[][]> {
  const grouped = new Map<string, TraceUiEvent[][]>();
  let activeScenarioId: string | undefined;
  let activeRunEvents: TraceUiEvent[] | undefined;

  for (const event of traceEvents) {
    if (event.type === 'scenario_started') {
      activeScenarioId = event.scenario_id;
      const runs = grouped.get(event.scenario_id) ?? [];
      activeRunEvents = [event];
      runs.push(activeRunEvents);
      grouped.set(event.scenario_id, runs);
      continue;
    }

    if (!activeScenarioId || !activeRunEvents) {
      continue;
    }

    activeRunEvents.push(event);
    if (event.type === 'scenario_finished' && event.scenario_id === activeScenarioId) {
      activeScenarioId = undefined;
      activeRunEvents = undefined;
    }
  }

  return grouped;
}

function toConversationItems(events: TraceUiEvent[]): ConversationItem[] {
  const items: ConversationItem[] = [];
  let sawPrompt = false;
  const finalAnswers = events
    .filter(
      (event): event is Extract<TraceUiEvent, { type: 'final_answer' }> =>
        event.type === 'final_answer'
    )
    .map((event) => normalizeText(event.text))
    .filter(Boolean);
  const finalAnswerSet = new Set(finalAnswers);

  for (const event of events) {
    if (event.type === 'llm_request') {
      if (sawPrompt) continue;
      sawPrompt = true;
      items.push({
        id: `user_prompt-${items.length}`,
        kind: 'user_prompt',
        text: event.messages_summary,
        timestamp: event.ts
      });
      continue;
    }
    if (event.type === 'llm_response') {
      // Some providers emit the same content in llm_response and final_answer.
      // Keep only the final message bubble in that case.
      if (isDuplicateAssistantResponse(event.raw_or_summary, finalAnswers, finalAnswerSet)) {
        continue;
      }
      items.push({
        id: `assistant_thought-${items.length}`,
        kind: 'assistant_thought',
        text: event.raw_or_summary,
        timestamp: event.ts
      });
      continue;
    }
    if (event.type === 'tool_call') {
      items.push({
        id: `tool_call-${items.length}`,
        kind: 'tool_call',
        text: stringifySafe(event.args ?? {}),
        toolName: event.tool,
        timestamp: event.ts_start
      });
      continue;
    }
    if (event.type === 'tool_result') {
      items.push({
        id: `tool_result-${items.length}`,
        kind: 'tool_result',
        text: event.result_summary,
        toolName: event.tool,
        ok: event.ok,
        durationMs: event.duration_ms,
        timestamp: event.ts_end
      });
      continue;
    }
    if (event.type === 'final_answer') {
      items.push({
        id: `assistant_final-${items.length}`,
        kind: 'assistant_final',
        text: event.text,
        timestamp: event.ts
      });
    }
  }

  return items;
}

function stringifySafe(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function normalizeText(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

function stripTrailingEllipsis(value: string): string {
  return value.replace(/(\.{3}|…)$/, '').trim();
}

function isDuplicateAssistantResponse(
  responseText: string,
  finalAnswers: string[],
  finalAnswerSet: Set<string>
): boolean {
  const normalized = normalizeText(responseText);
  if (!normalized || normalized.startsWith('tool_calls:')) {
    return false;
  }

  if (finalAnswerSet.has(normalized)) {
    return true;
  }

  const withoutEllipsis = stripTrailingEllipsis(normalized);
  if (withoutEllipsis.length < 24) {
    return false;
  }

  return finalAnswers.some((finalText) => finalText.includes(withoutEllipsis));
}

export function fromCoreResultsJson(
  results: CoreResultsJson,
  traceEvents: TraceUiEvent[] = []
): EvalResult {
  const traceByScenario = groupScenarioRunEvents(traceEvents);
  const scenarios = results.scenarios.map((scenario) => {
    const runEvents = traceByScenario.get(scenario.scenario_id) ?? [];
    const runs: ScenarioRun[] = scenario.runs.map((run, index) => {
      const events = runEvents[run.run_index] ?? runEvents[index] ?? [];
      const toolCallEvents = events.filter(
        (event): event is TraceUiToolCallEvent => event.type === 'tool_call'
      );
      return {
        runIndex: run.run_index,
        passed: run.pass,
        toolCalls: toToolCalls(run, toolCallEvents),
        finalAnswer: run.final_text,
        conversation: toConversationItems(events),
        duration: run.tool_durations_ms.reduce((sum, value) => sum + value, 0),
        extractedValues: Object.fromEntries(
          Object.entries(run.extracted).map(([k, v]) => [k, String(v ?? '')])
        ),
        failureReasons: run.failures
      };
    });

    const avgDuration =
      runs.length === 0
        ? 0
        : Math.round(runs.reduce((sum, run) => sum + run.duration, 0) / runs.length);
    const avgToolCalls =
      runs.length === 0
        ? 0
        : runs.reduce((sum, run) => sum + run.toolCalls.length, 0) / runs.length;

    return {
      scenarioId: scenario.scenario_id,
      scenarioName: scenario.scenario_id,
      agentId: scenario.agent,
      agentName: scenario.agent,
      runs,
      passRate: scenario.pass_rate,
      avgToolCalls,
      avgDuration
    };
  });

  return {
    id: results.metadata.run_id,
    configId: '',
    configHash: results.metadata.config_hash,
    timestamp: results.metadata.timestamp,
    scenarios,
    overallPassRate: results.summary.pass_rate,
    totalScenarios: results.summary.total_scenarios,
    totalRuns: results.summary.total_runs,
    avgToolCalls: results.summary.avg_tool_calls_per_run,
    avgLatency: Math.round(results.summary.avg_tool_latency_ms ?? 0),
    snapshotEval: results.metadata.snapshot_eval
      ? {
          applied: results.metadata.snapshot_eval.applied,
          mode: results.metadata.snapshot_eval.mode,
          baselineSnapshotId: results.metadata.snapshot_eval.baseline_snapshot_id,
          baselineSourceRunId: results.metadata.snapshot_eval.baseline_source_run_id,
          overallScore: results.metadata.snapshot_eval.overall_score,
          status: results.metadata.snapshot_eval.status,
          impactedScenarios: results.metadata.snapshot_eval.impacted_scenarios
        }
      : undefined
  };
}
