import type { EvalConfig, EvalResult, EvalRule, ScenarioRun, ToolCall } from '@/types/eval';
import type {
  CoreEvalConfig,
  CoreResultsJson,
  TraceToolEvent,
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
    const authType =
      server.auth?.type === 'bearer'
        ? 'bearer'
        : server.auth?.type === 'oauth_client_credentials'
          ? 'api-key'
          : 'none';
    return {
      id,
      name,
      transport: 'streamable-http' as const,
      url: server.url,
      authType,
      authValue: server.auth?.type === 'bearer' ? server.auth.env : undefined
    };
  });

  const agents = agentEntries.map(([name, agent], index) => {
    const id = toId('agt', index);
    agentIdByName.set(name, id);
    const provider = agent.provider === 'azure_openai' ? 'azure' : agent.provider;
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
      name: scenario.id || `Scenario ${index + 1}`,
      agentId: agentIdByName.get(scenario.agent) ?? '',
      serverIds: scenario.servers
        .map((name) => serverIdByName.get(name))
        .filter(Boolean) as string[],
      prompt: scenario.prompt,
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
    servers,
    agents,
    scenarios,
    createdAt: record.mtime,
    updatedAt: record.mtime,
    sourcePath: record.path
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
      agent: agentNameById.get(scenario.agentId) || '',
      servers: scenario.serverIds.map((id) => serverNameById.get(id)).filter(Boolean) as string[],
      prompt: scenario.prompt,
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

  return { servers, agents, scenarios };
}

function toToolCalls(
  run: CoreResultsJson['scenarios'][number]['runs'][number],
  traceCalls: TraceToolEvent[]
): ToolCall[] {
  return run.tool_calls.map((name, idx) => {
    const trace = traceCalls[idx];
    return {
      name,
      arguments: (trace?.args as Record<string, unknown>) ?? {},
      duration: run.tool_durations_ms[idx] ?? trace?.duration_ms ?? 0,
      timestamp: trace?.ts_start ?? new Date().toISOString()
    };
  });
}

function groupTraceCalls(traceEvents: TraceToolEvent[]): Map<string, TraceToolEvent[]> {
  const grouped = new Map<string, TraceToolEvent[]>();
  for (const event of traceEvents) {
    const key = event.scenario_id ?? '';
    const current = grouped.get(key) ?? [];
    current.push(event);
    grouped.set(key, current);
  }
  return grouped;
}

export function fromCoreResultsJson(
  results: CoreResultsJson,
  traceEvents: TraceToolEvent[] = []
): EvalResult {
  const traceByScenario = groupTraceCalls(traceEvents);
  const scenarios = results.scenarios.map((scenario) => {
    const calls = traceByScenario.get(scenario.scenario_id) ?? [];
    let offset = 0;
    const runs: ScenarioRun[] = scenario.runs.map((run) => {
      const callSlice = calls.slice(offset, offset + run.tool_calls.length);
      offset += run.tool_calls.length;
      return {
        runIndex: run.run_index,
        passed: run.pass,
        toolCalls: toToolCalls(run, callSlice),
        finalAnswer: run.final_text,
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
    avgLatency: Math.round(results.summary.avg_tool_latency_ms ?? 0)
  };
}
