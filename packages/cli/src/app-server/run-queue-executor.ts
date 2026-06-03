import { writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import {
  applyRuntimeServerOverrides,
  hashConfig,
  loadConfig,
  renderSummaryMarkdown,
  runAll,
  type EvalConfig,
  type RunProgressEvent,
  type ScenarioRunTraceRecord
} from '@inspectr/mcplab-core';
import { renderReport } from '@inspectr/mcplab-reporting';
import type { RunsRouteDeps } from './runs-routes.js';
import {
  OAuthAuthorizationRequiredError,
  type OAuthSessionManager
} from './oauth-session-manager.js';
import { readLibraries as readLibrariesFromStore } from './libraries-store.js';
import type {
  ExecutionOutcome,
  RunJob,
  RunParams
} from './run-queue-state.js';

export function mergeLibraryEntriesIntoConfig(
  config: EvalConfig,
  libraryAgents: EvalConfig['agents'],
  libraryServers: EvalConfig['servers']
): EvalConfig {
  return {
    ...config,
    agents: { ...libraryAgents, ...config.agents },
    servers: { ...libraryServers, ...config.servers }
  };
}

export function applyLibraryEntries(
  loaded: { config: EvalConfig; hash: string },
  libraryAgents: EvalConfig['agents'],
  libraryServers: EvalConfig['servers']
): void {
  loaded.config = mergeLibraryEntriesIntoConfig(loaded.config, libraryAgents, libraryServers);
  loaded.hash = hashConfig(loaded.config);
}

export function filterScenarioOverridesToSelectedScenarios(
  selectedConfig: EvalConfig,
  scenarioServerOverrides?: Record<string, string[]>
): Record<string, string[]> | undefined {
  if (!scenarioServerOverrides) return undefined;
  const selectedIds = new Set(selectedConfig.scenarios.map((scenario) => scenario.id));
  const filtered = Object.fromEntries(
    Object.entries(scenarioServerOverrides).filter(([scenarioId]) => selectedIds.has(scenarioId))
  );
  return Object.keys(filtered).length > 0 ? filtered : undefined;
}

export type AdmissionResult =
  | { status: 'ready'; readyServers: string[] }
  | { status: 'blocked_auth'; blockedServers: string[] };

export function resolveOAuthServersForJob(job: RunJob, librariesDir: string): string[] {
  if (job.runParams.oauthServerNames !== undefined) return job.runParams.oauthServerNames;
  try {
    const loaded = loadConfig(job.runParams.configPath, { bundleRoot: librariesDir });
    const libraries = readLibrariesFromStore(librariesDir);
    applyLibraryEntries(loaded, libraries.agents, libraries.servers);
    const selected = job.runParams.scenarioIds?.length
      ? selectScenarioIdsFromParams(loaded.config, job.runParams)
      : job.runParams.scenarioId
      ? selectScenarioIdsFromParams(loaded.config, job.runParams)
      : loaded.config;
    const filteredScenarioOverrides = filterScenarioOverridesToSelectedScenarios(
      selected,
      job.runParams.scenarioServerOverrides
    );
    const withOverrides = applyRuntimeServerOverrides(selected, {
      serverOverrideAll: job.runParams.serverOverrideAll,
      scenarioServerOverrides: filteredScenarioOverrides
    });
    const effectiveServers = new Set(
      withOverrides.scenarios.flatMap((scenario) => scenario.servers)
    );
    const names = Array.from(effectiveServers).filter((name) => {
      const config = withOverrides.servers?.[name];
      return config?.auth?.type === 'oauth_authorization_code';
    });
    job.runParams.oauthServerNames = names;
    return names;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (
      message.includes('Unknown server refs') ||
      message.includes('Unknown scenarios in scenarioServerOverrides') ||
      message.includes('serverOverrideAll must include at least one server id')
    ) {
      throw error;
    }
    console.warn(`[mcplab] Failed to resolve OAuth servers for queued job '${job.id}': ${message}`);
    return [];
  }
}

function selectScenarioIdsFromParams(config: EvalConfig, runParams: RunParams): EvalConfig {
  const ids =
    runParams.scenarioIds && runParams.scenarioIds.length > 0
      ? runParams.scenarioIds
      : runParams.scenarioId
      ? [runParams.scenarioId]
      : undefined;
  if (!ids || ids.length === 0) return config;
  return {
    ...config,
    scenarios: config.scenarios.filter((scenario) => ids.includes(scenario.id))
  };
}

export async function admitQueuedJob(params: {
  job: RunJob;
  librariesDir: string;
  oauthSessionManager: OAuthSessionManager;
  hostHeader?: string;
}): Promise<AdmissionResult> {
  const oauthServers = resolveOAuthServersForJob(params.job, params.librariesDir);
  if (oauthServers.length === 0) {
    return { status: 'ready', readyServers: [] };
  }
  const ensureResult = await params.oauthSessionManager.ensureServersAuthorized(
    oauthServers,
    params.hostHeader
  );
  const blockedServers = ensureResult.servers
    .filter((server) => server.status === 'auth_required')
    .map((server) => server.serverName);
  if (blockedServers.length > 0) {
    return { status: 'blocked_auth', blockedServers };
  }
  const readyServers = ensureResult.servers
    .filter((server) => server.status === 'ready')
    .map((server) => `${server.serverName} (${server.debugState ?? 'unknown'})`);
  return { status: 'ready', readyServers };
}

export async function executeRunJob(params: {
  job: RunJob;
  settings: {
    evalsDir: string;
    runsDir: string;
    librariesDir: string;
    workspaceRoot: string;
  };
  oauthSessionManager: OAuthSessionManager;
  deps: RunsRouteDeps;
}): Promise<ExecutionOutcome> {
  const { job, settings, oauthSessionManager, deps } = params;
  const {
    addJobEvent,
    getScenarioRunTraceRecords,
    selectScenarioIds,
    expandConfigForAgents,
    resolveRunSelectedAgents,
    readLibraries,
    pkgVersion
  } = deps;
  const {
    configPath,
    runsPerScenario,
    scenarioId,
    scenarioIds,
    requestedAgents,
    runNote,
    serverOverrideAll,
    scenarioServerOverrides
  } = job.runParams;

  try {
    addJobEvent(job, {
      type: 'log',
      ts: new Date().toISOString(),
      payload: { message: `Loading MCP Evaluation config: ${configPath}` }
    });
    const loaded = loadConfig(configPath, { bundleRoot: settings.librariesDir });
    const { agents: libraryAgents, servers: libraryServers } = readLibraries(settings.librariesDir);
    applyLibraryEntries(loaded, libraryAgents, libraryServers);
    addJobEvent(job, {
      type: 'log',
      ts: new Date().toISOString(),
      payload: {
        message: `Loaded config (${loaded.config.scenarios.length} scenario(s), ${
          Object.keys(loaded.config.agents ?? {}).length
        } agent(s), ${Object.keys(loaded.config.servers ?? {}).length} server(s))`
      }
    });
    for (const warning of loaded.warnings ?? []) {
      addJobEvent(job, {
        type: 'log',
        ts: new Date().toISOString(),
        payload: { message: warning }
      });
    }
    addJobEvent(job, {
      type: 'log',
      ts: new Date().toISOString(),
      payload: {
        message:
          scenarioIds && scenarioIds.length > 0
            ? `Selecting requested scenarios: ${scenarioIds.join(', ')}`
            : scenarioId
            ? `Selecting requested scenario: ${scenarioId}`
            : 'Using all scenarios from config'
      }
    });
    const selectedBaseScenarios = selectScenarioIds(
      loaded.config,
      scenarioIds && scenarioIds.length > 0 ? scenarioIds : scenarioId ? [scenarioId] : undefined
    );
    addJobEvent(job, {
      type: 'log',
      ts: new Date().toISOString(),
      payload: {
        message: `Selected ${selectedBaseScenarios.scenarios.length} base scenario(s)`
      }
    });
    const filteredScenarioOverrides = filterScenarioOverridesToSelectedScenarios(
      selectedBaseScenarios,
      scenarioServerOverrides
    );
    const runtimeOverriddenConfig = applyRuntimeServerOverrides(selectedBaseScenarios, {
      serverOverrideAll,
      scenarioServerOverrides: filteredScenarioOverrides
    });
    const effectiveConfigHash = hashConfig(runtimeOverriddenConfig);
    addJobEvent(job, {
      type: 'log',
      ts: new Date().toISOString(),
      payload: {
        message: `Applied runtime server overrides: global=${
          serverOverrideAll?.length ?? 0
        } scenario-specific=${Object.keys(filteredScenarioOverrides ?? {}).length}`
      }
    });
    const effectiveScenarioServers = runtimeOverriddenConfig.scenarios
      .map((scenario) => `${scenario.id}=[${scenario.servers.join(', ')}]`)
      .join('; ');
    addJobEvent(job, {
      type: 'log',
      ts: new Date().toISOString(),
      payload: {
        message: `Effective MCP servers per scenario: ${effectiveScenarioServers || '(none)'}`
      }
    });
    const resolvedAgents = resolveRunSelectedAgents(runtimeOverriddenConfig, requestedAgents);
    const resolvedAgentList = Array.isArray(resolvedAgents) ? resolvedAgents : [];
    addJobEvent(job, {
      type: 'log',
      ts: new Date().toISOString(),
      payload: {
        message:
          requestedAgents && requestedAgents.length > 0
            ? `Using requested agents: ${resolvedAgentList.join(', ')}`
            : `Using resolved default agents: ${resolvedAgentList.join(', ')}`
      }
    });
    const expandedConfig = expandConfigForAgents(runtimeOverriddenConfig, resolvedAgents);
    addJobEvent(job, {
      type: 'log',
      ts: new Date().toISOString(),
      payload: {
        message: `Expanded to ${expandedConfig.scenarios.length} executable scenario run(s) across selected agents`
      }
    });
    const usedServerNames = new Set(expandedConfig.scenarios.flatMap((scenario) => scenario.servers));
    const oauthServers = Array.from(usedServerNames).filter(
      (serverName) => expandedConfig.servers[serverName]?.auth?.type === 'oauth_authorization_code'
    );
    const oauthServerSet = new Set(oauthServers);
    const mcpServerAuthHeaders =
      oauthServers.length > 0
        ? await oauthSessionManager.getAuthHeadersForServers(oauthServers, undefined)
        : undefined;
    if (oauthServers.length > 0) {
      addJobEvent(job, {
        type: 'log',
        ts: new Date().toISOString(),
        payload: {
          message: `OAuth runtime credentials resolved for server(s): ${oauthServers.join(', ')}`
        }
      });
    }
    addJobEvent(job, {
      type: 'log',
      ts: new Date().toISOString(),
      payload: {
        message: `Running evaluation (${runsPerScenario} run(s) per scenario) ...`
      }
    });
    if (runNote) {
      addJobEvent(job, {
        type: 'log',
        ts: new Date().toISOString(),
        payload: { message: `Run note: ${runNote}` }
      });
    }
    const { runDir, results } = await runAll(expandedConfig, {
      runsPerScenario,
      scenarioId,
      runNote,
      configHash: effectiveConfigHash,
      cliVersion: pkgVersion,
      runsDir: settings.runsDir,
      cwd: settings.workspaceRoot,
      mcpServerAuthHeaders,
      resolveMcpServerAuthHeaders:
        oauthServers.length > 0
          ? async (serverNames: string[], options?: { signal?: AbortSignal }) => {
              if (options?.signal?.aborted) return {};
              const namesToRefresh = serverNames.filter((name) => oauthServerSet.has(name));
              if (namesToRefresh.length === 0) return {};
              return oauthSessionManager.getAuthHeadersForServers(namesToRefresh);
            }
          : undefined,
      signal: job.abortController.signal,
      onProgress: async (event: RunProgressEvent) => {
        const message = formatRunProgressMessage(event);
        if (!message) return;
        addJobEvent(job, {
          type: 'log',
          ts: new Date().toISOString(),
          payload: { message }
        });
      }
    });
    const relativeConfigPathRaw = relative(settings.evalsDir, configPath);
    const relativeConfigPath = relativeConfigPathRaw.replace(/\\/g, '/').replace(/^\.\/+/, '');
    results.metadata.config_path = relativeConfigPath || configPath;
    if (loaded.config.name && loaded.config.name.trim().length > 0) {
      results.metadata.config_name = loaded.config.name.trim();
    }
    results.metadata.rerun_agents = [...resolvedAgentList];
    results.metadata.rerun_scenario_ids = selectedBaseScenarios.scenarios.map(
      (scenario) => scenario.id
    );
    if (serverOverrideAll && serverOverrideAll.length > 0) {
      results.metadata.rerun_server_override_all = [...serverOverrideAll];
    } else {
      delete results.metadata.rerun_server_override_all;
    }
    if (filteredScenarioOverrides && Object.keys(filteredScenarioOverrides).length > 0) {
      results.metadata.rerun_scenario_server_overrides = Object.fromEntries(
        Object.entries(filteredScenarioOverrides).map(([scenarioKey, serverIds]) => [
          scenarioKey,
          [...serverIds]
        ])
      );
    } else {
      delete results.metadata.rerun_scenario_server_overrides;
    }
    addJobEvent(job, {
      type: 'log',
      ts: new Date().toISOString(),
      payload: {
        message: `Evaluation execution finished (run id: ${results.metadata.run_id})`
      }
    });
    addJobEvent(job, {
      type: 'log',
      ts: new Date().toISOString(),
      payload: { message: `Writing results to ${runDir}` }
    });
    const traceRecords = getScenarioRunTraceRecords(
      results.metadata.run_id,
      settings.runsDir
    ) as ScenarioRunTraceRecord[];
    results.metadata.tool_tokens_total = estimateRunToolTokensTotal(traceRecords);
    writeFileSync(join(runDir, 'results.json'), `${JSON.stringify(results, null, 2)}\n`, 'utf8');
    writeFileSync(join(runDir, 'report.html'), renderReport(results), 'utf8');
    writeFileSync(join(runDir, 'summary.md'), renderSummaryMarkdown(results), 'utf8');
    addJobEvent(job, {
      type: 'log',
      ts: new Date().toISOString(),
      payload: {
        message: `Run finished: ${results.summary.total_runs} run(s), pass rate ${Math.round(
          results.summary.pass_rate * 100
        )}%`
      }
    });
    addJobEvent(job, {
      type: 'completed',
      ts: new Date().toISOString(),
      payload: {
        runId: results.metadata.run_id,
        runDir,
        summary: results.summary
      }
    });
    return { status: 'completed' };
  } catch (error: unknown) {
    if (error instanceof OAuthAuthorizationRequiredError) {
      const blockedServers = Array.from(
        new Set(
          error.details
            .map((detail) => detail.serverName)
            .filter((serverName): serverName is string => typeof serverName === 'string')
        )
      );
      let fallbackBlockedServers = blockedServers;
      if (fallbackBlockedServers.length === 0) {
        try {
          fallbackBlockedServers = resolveOAuthServersForJob(job, settings.librariesDir);
        } catch {
          fallbackBlockedServers = [];
        }
      }
      const aborted = job.abortController.signal.aborted || job.status === 'stopped';
      if (!aborted && fallbackBlockedServers.length > 0) {
        return { status: 'blocked_auth', blockedServers: fallbackBlockedServers };
      }
    }
    const normalizedError =
      error instanceof OAuthAuthorizationRequiredError
        ? new Error(error.details[0]?.message || error.message)
        : error;
    const aborted = job.abortController.signal.aborted || job.status === 'stopped';
    addJobEvent(job, {
      type: 'error',
      ts: new Date().toISOString(),
      payload: {
        message: aborted
          ? 'Run aborted by user'
          : normalizedError instanceof Error
          ? normalizedError.message
          : String(normalizedError)
      }
    });
    return { status: aborted ? 'stopped' : 'error' };
  }
}

function splitInteger(total: number | undefined, parts: number): number[] {
  if (!Number.isFinite(total) || !parts || parts <= 0) return Array(parts).fill(0);
  const safeTotal = Math.max(0, Math.round(total ?? 0));
  const base = Math.floor(safeTotal / parts);
  let remainder = safeTotal % parts;
  return Array.from({ length: parts }, () => {
    const value = base + (remainder > 0 ? 1 : 0);
    if (remainder > 0) remainder -= 1;
    return value;
  });
}

function estimateRunToolTokensTotal(records: ScenarioRunTraceRecord[]): number | null {
  let total = 0;
  let hasAny = false;
  for (const record of records) {
    const toolUsesById = new Map<string, string>();
    for (const message of record.messages ?? []) {
      const toolUses = message.content.filter(
        (block): block is Extract<(typeof message.content)[number], { type: 'tool_use' }> =>
          block.type === 'tool_use'
      );
      if (toolUses.length > 0) {
        for (const toolUse of toolUses) toolUsesById.set(toolUse.id, toolUse.name);
        const allEstimated = toolUses.every((toolUse) => Boolean(toolUse.estimated_tokens));
        if (allEstimated) {
          for (const toolUse of toolUses) total += toolUse.estimated_tokens?.total ?? 0;
          hasAny = true;
        } else if (toolUses.length === 1 && typeof message.usage?.total_tokens === 'number') {
          total += message.usage.total_tokens;
          hasAny = true;
        } else {
          const shares = splitInteger(message.usage?.total_tokens, toolUses.length);
          total += shares.reduce((sum, value) => sum + value, 0);
          if (typeof message.usage?.total_tokens === 'number') hasAny = true;
        }
      }

      const toolResults = message.content.filter(
        (block): block is Extract<(typeof message.content)[number], { type: 'tool_result' }> =>
          block.type === 'tool_result'
      );
      if (toolResults.length === 0) continue;
      const allEstimated = toolResults.every((result) => Boolean(result.estimated_tokens));
      if (allEstimated) {
        for (const result of toolResults) total += result.estimated_tokens?.total ?? 0;
        hasAny = true;
        continue;
      }
      if (toolResults.length === 1) {
        const [result] = toolResults;
        if (
          result &&
          toolUsesById.has(result.tool_use_id) &&
          typeof message.usage?.total_tokens === 'number'
        ) {
          total += message.usage.total_tokens;
          hasAny = true;
          continue;
        }
      }
      const knownResults = toolResults.filter((result) => toolUsesById.has(result.tool_use_id));
      if (knownResults.length === 0) continue;
      const shares = splitInteger(message.usage?.total_tokens, knownResults.length);
      total += shares.reduce((sum, value) => sum + value, 0);
      if (typeof message.usage?.total_tokens === 'number') hasAny = true;
    }
  }
  return hasAny ? total : null;
}

function formatRunProgressMessage(event: RunProgressEvent): string | null {
  switch (event.type) {
    case 'run_started':
      return `Run initialized (id: ${event.runId}, ${event.totalScenarioRuns} scenario run(s))`;
    case 'mcp_connect_started':
      return `Connecting to ${event.serverCount} MCP server(s): ${event.serverNames.join(
        ', '
      )} ...`;
    case 'mcp_connect_finished':
      return `Connected to ${event.serverCount} MCP server(s): ${event.serverNames.join(', ')}`;
    case 'scenario_run_started':
      return `Scenario ${event.scenarioRunIndex}/${event.totalScenarioRuns} started: ${
        event.scenarioId
      } [agent=${event.agentName}, run=${event.runIndex + 1}/${event.runsPerScenario}]`;
    case 'scenario_run_finished':
      return `Scenario ${event.scenarioRunIndex}/${event.totalScenarioRuns} finished: ${
        event.scenarioId
      } [agent=${event.agentName}] -> ${event.pass ? 'PASS' : 'FAIL'} (${
        event.toolCallCount
      } tool call(s))`;
    case 'agent_progress': {
      const p = event.event;
      switch (p.type) {
        case 'llm_request_started':
          return `LLM turn ${p.turn + 1} started for ${p.scenarioId} [${p.agentName}] (${
            p.provider
          }/${p.model})`;
        case 'llm_response_received':
          return `LLM turn ${p.turn + 1} response for ${p.scenarioId} [${p.agentName}] (text=${
            p.hasText ? 'yes' : 'no'
          }, tool_calls=${p.toolCallCount})`;
        case 'tool_call_started':
          return `Tool call started: ${p.server}.${p.tool} (turn ${p.turn + 1})`;
        case 'tool_call_finished':
          return `Tool call ${p.ok ? 'finished' : 'failed'}: ${p.server}.${p.tool} in ${
            p.durationMs
          }ms`;
        case 'final_answer':
          return `Final answer produced for ${p.scenarioId} [${p.agentName}] (text=${
            p.hasText ? 'yes' : 'no'
          })`;
        default:
          return null;
      }
    }
    case 'run_finished':
      return `Run finished (id: ${event.runId})`;
    default:
      return null;
  }
}
