import type {
  ConversationItem,
  AgentEntry,
  EvalConfig,
  EvalResult,
  EvalRule,
  ServerEntry,
  ScenarioEntry,
  ScenarioRun,
  ToolCall
} from '@/types/eval';
import type {
  CoreEvalConfig,
  CoreResultsJson,
  CoreSourceEvalConfig,
  ScenarioRunTraceMessage,
  ScenarioRunTraceRecord,
  TraceMessageContentBlock,
  WorkspaceConfigRecord
} from './types';

function toId(base: string, index: number): string {
  return `${base}-${index + 1}`;
}

export function fromCoreConfigYaml(record: WorkspaceConfigRecord): EvalConfig {
  const configName =
    typeof record.config.name === 'string' && record.config.name.trim().length > 0
      ? record.config.name.trim()
      : undefined;
  const sourceServerEntries = Array.isArray(record.config.servers) ? record.config.servers : [];
  const sourceAgentEntries = Array.isArray(record.config.agents) ? record.config.agents : [];
  const serverIdByName = new Map<string, string>();
  const servers: EvalConfig['servers'] = [];
  const mixedServerEntries: ServerEntry[] = [];
  for (const entry of sourceServerEntries) {
    if ('ref' in entry) {
      const ref = String(entry.ref || '').trim();
      if (!ref) continue;
      serverIdByName.set(ref, ref);
      mixedServerEntries.push({ kind: 'referenced', ref });
      continue;
    }
    const inlineId = String(entry.id || entry.name || '').trim();
    if (!inlineId) continue;
    const id = inlineId;
    serverIdByName.set(inlineId, id);
    const authType: 'none' | 'bearer' | 'api-key' | 'oauth2' =
      entry.auth?.type === 'bearer'
        ? 'bearer'
        : entry.auth?.type === 'oauth_client_credentials'
        ? 'api-key'
        : entry.auth?.type === 'oauth_authorization_code'
        ? 'oauth2'
        : 'none';
    const mappedServer = {
      id,
      name: String(entry.name || inlineId),
      transport: 'streamable-http' as const,
      url: entry.url,
      authType,
      authValue: entry.auth?.type === 'bearer' ? entry.auth.env : undefined,
      oauthClientId:
        entry.auth?.type === 'oauth_authorization_code' ? entry.auth.client_id : undefined,
      oauthClientSecret:
        entry.auth?.type === 'oauth_authorization_code' ? entry.auth.client_secret : undefined,
      oauthRedirectUrl:
        entry.auth?.type === 'oauth_authorization_code' ? entry.auth.redirect_url : undefined,
      oauthScope:
        entry.auth?.type === 'oauth_authorization_code'
          ? entry.auth.scope
          : entry.auth?.type === 'oauth_client_credentials'
          ? entry.auth.scope
          : undefined,
      oauthTokenUrl:
        entry.auth?.type === 'oauth_client_credentials' ? entry.auth.token_url : undefined,
      oauthClientIdEnv:
        entry.auth?.type === 'oauth_client_credentials' ? entry.auth.client_id_env : undefined,
      oauthClientSecretEnv:
        entry.auth?.type === 'oauth_client_credentials' ? entry.auth.client_secret_env : undefined,
      oauthAudience:
        entry.auth?.type === 'oauth_client_credentials' ? entry.auth.audience : undefined
    };
    servers.push(mappedServer);
    mixedServerEntries.push({ kind: 'inline', server: mappedServer });
  }
  const agents: EvalConfig['agents'] = [];
  const mixedAgentEntries: AgentEntry[] = [];
  for (const entry of sourceAgentEntries) {
    if ('ref' in entry) {
      const ref = String(entry.ref || '').trim();
      if (!ref) continue;
      mixedAgentEntries.push({ kind: 'referenced', ref });
      continue;
    }
    const inlineId = String(entry.id || entry.name || '').trim();
    if (!inlineId) continue;
    const id = inlineId;
    const provider: 'openai' | 'anthropic' | 'azure' =
      entry.provider === 'azure_openai' ? 'azure' : entry.provider;
    const mappedAgent = {
      id,
      name: String(entry.name || inlineId),
      provider,
      model: entry.model,
      temperature: entry.temperature ?? 0,
      maxTokens: entry.max_tokens ?? 2048,
      systemPrompt: entry.system
    };
    agents.push(mappedAgent);
    mixedAgentEntries.push({ kind: 'inline', agent: mappedAgent });
  }
  const inlineScenarios: EvalConfig['scenarios'] = [];
  const scenarioEntries: ScenarioEntry[] = [];

  record.config.scenarios.forEach((scenario, index) => {
    if ('ref' in scenario) {
      const ref = String(scenario.ref || '').trim();
      if (!ref) return;
      scenarioEntries.push({ kind: 'referenced', ref });
      return;
    }
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
          value: `${assertion.path}${
            assertion.equals !== undefined ? ` == ${assertion.equals}` : ''
          }`
        });
      }
    }

    const mappedScenario = {
      id: scenario.id || toId('scn', index),
      name: scenario.name || scenario.id || `Scenario ${index + 1}`,
      serverIds: (() => {
        if ((scenario.servers ?? []).length > 0) {
          return (scenario.servers as string[])
            .map((name) => serverIdByName.get(name) ?? name)
            .filter(Boolean) as string[];
        }
        const mcpServers = (scenario as Record<string, unknown>).mcp_servers;
        if (Array.isArray(mcpServers)) {
          return mcpServers.flatMap((entry: Record<string, unknown>) => {
            if ('ref' in entry && entry.ref) return [String(entry.ref)];
            if ('id' in entry && entry.id) {
              const id = String(entry.id);
              // Register inline mcp_servers entry in the server pool so it survives round-trips
              if (!serverIdByName.has(id)) {
                serverIdByName.set(id, id);
                const auth = entry.auth as Record<string, unknown> | undefined;
                const authType: 'none' | 'bearer' | 'api-key' | 'oauth2' =
                  auth?.type === 'bearer'
                    ? 'bearer'
                    : auth?.type === 'oauth_client_credentials'
                    ? 'api-key'
                    : auth?.type === 'oauth_authorization_code'
                    ? 'oauth2'
                    : 'none';
                servers.push({
                  id,
                  name: String(entry.name || id),
                  transport: 'streamable-http' as const,
                  url: String(entry.url || ''),
                  authType,
                  authValue: auth?.type === 'bearer' ? String(auth.env || '') : undefined,
                  oauthClientId:
                    auth?.type === 'oauth_authorization_code'
                      ? String(auth.client_id || '')
                      : undefined,
                  oauthClientSecret:
                    auth?.type === 'oauth_authorization_code'
                      ? String(auth.client_secret || '')
                      : undefined,
                  oauthRedirectUrl:
                    auth?.type === 'oauth_authorization_code'
                      ? String(auth.redirect_url || '')
                      : undefined,
                  oauthScope:
                    auth?.type === 'oauth_authorization_code' ||
                    auth?.type === 'oauth_client_credentials'
                      ? String((auth.scope as string) || '') || undefined
                      : undefined,
                  oauthTokenUrl:
                    auth?.type === 'oauth_client_credentials'
                      ? String(auth.token_url || '')
                      : undefined,
                  oauthClientIdEnv:
                    auth?.type === 'oauth_client_credentials'
                      ? String(auth.client_id_env || '')
                      : undefined,
                  oauthClientSecretEnv:
                    auth?.type === 'oauth_client_credentials'
                      ? String(auth.client_secret_env || '')
                      : undefined,
                  oauthAudience:
                    auth?.type === 'oauth_client_credentials'
                      ? String(auth.audience || '') || undefined
                      : undefined
                });
                mixedServerEntries.push({ kind: 'inline', server: servers[servers.length - 1] });
              }
              return [id];
            }
            return [];
          });
        }
        return [];
      })(),
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
    inlineScenarios.push(mappedScenario);
    scenarioEntries.push({ kind: 'inline', scenario: mappedScenario });
  });

  return {
    id: record.id,
    name: configName || record.name,
    configName,
    description: record.path,
    loadError: record.error,
    loadWarnings: record.warnings,
    servers,
    serverEntries: mixedServerEntries,
    agents,
    agentEntries: mixedAgentEntries,
    scenarios: inlineScenarios,
    scenarioEntries,
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
      servers: Object.entries(libraries.servers).map(([name, server]) => ({
        id: name,
        name: server.name || name,
        transport: server.transport,
        url: server.url,
        auth: server.auth
      })),
      agents: Object.entries(libraries.agents).map(([name, agent]) => ({
        id: name,
        name: agent.name || name,
        provider: agent.provider,
        model: agent.model,
        temperature: agent.temperature,
        max_tokens: agent.max_tokens,
        system: agent.system
      })),
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

export function toCoreConfigYaml(config: EvalConfig): CoreSourceEvalConfig {
  const serverNameById = new Map<string, string>();

  const mapInlineServer = (server: EvalConfig['servers'][number]) => {
    const sourceId = server.id;
    const auth =
      server.authType === 'bearer'
        ? { type: 'bearer' as const, env: server.authValue || 'MCP_TOKEN' }
        : server.authType === 'api-key'
        ? {
            type: 'oauth_client_credentials' as const,
            token_url: server.oauthTokenUrl || '',
            client_id_env: server.oauthClientIdEnv || '',
            client_secret_env: server.oauthClientSecretEnv || '',
            ...(server.oauthScope ? { scope: server.oauthScope } : {}),
            ...(server.oauthAudience ? { audience: server.oauthAudience } : {})
          }
        : server.authType === 'oauth2'
        ? {
            type: 'oauth_authorization_code' as const,
            client_id: server.oauthClientId || '',
            client_secret: server.oauthClientSecret || undefined,
            redirect_url: server.oauthRedirectUrl || 'http://localhost:6274/oauth/',
            scope: server.oauthScope || undefined
          }
        : undefined;
    return {
      id: sourceId,
      ...(server.name && server.name !== sourceId ? { name: server.name } : {}),
      transport: 'http',
      url: server.url || 'http://localhost:3000/mcp',
      ...(auth !== undefined ? { auth } : {})
    } satisfies NonNullable<CoreSourceEvalConfig['servers']>[number];
  };
  const mixedServerEntries =
    config.serverEntries && config.serverEntries.length > 0
      ? config.serverEntries
      : [...config.servers.map((server) => ({ kind: 'inline' as const, server }))];
  const seenServerRefs = new Set<string>();
  const inlineServerById = new Map<string, ReturnType<typeof mapInlineServer>>();
  const servers = mixedServerEntries.flatMap((entry) => {
    if (entry.kind === 'referenced') {
      const ref = String(entry.ref || '').trim();
      if (!ref || seenServerRefs.has(ref)) return [];
      seenServerRefs.add(ref);
      serverNameById.set(ref, ref);
      return [{ ref }];
    }
    const mapped = mapInlineServer(entry.server);
    serverNameById.set(entry.server.id, mapped.id);
    inlineServerById.set(mapped.id, mapped);
    return [mapped];
  });

  const mapInlineAgent = (agent: EvalConfig['agents'][number]) => {
    const sourceId = agent.id;
    return {
      id: sourceId,
      ...(agent.name && agent.name !== sourceId ? { name: agent.name } : {}),
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
    } satisfies NonNullable<CoreSourceEvalConfig['agents']>[number];
  };

  const mixedAgentEntries =
    config.agentEntries && config.agentEntries.length > 0
      ? config.agentEntries
      : [...config.agents.map((agent) => ({ kind: 'inline' as const, agent }))];
  const seenAgentRefs = new Set<string>();
  const agents = mixedAgentEntries.flatMap((entry) => {
    if (entry.kind === 'referenced') {
      const ref = String(entry.ref || '').trim();
      if (!ref || seenAgentRefs.has(ref)) return [];
      seenAgentRefs.add(ref);
      return [{ ref }];
    }
    return [mapInlineAgent(entry.agent)];
  });

  const mapInlineScenario = (scenario: EvalConfig['scenarios'][number]) => {
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
      mcp_servers:
        scenario.serverIds.length > 0
          ? scenario.serverIds.map((id) => {
              const resolvedId = serverNameById.get(id) ?? id;
              const inline = inlineServerById.get(resolvedId);
              return inline ?? { ref: resolvedId };
            })
          : undefined,
      prompt: scenario.prompt,
      ...(scenario.snapshotEval
        ? {
            snapshot_eval: {
              enabled: scenario.snapshotEval.enabled,
              baseline_snapshot_id: scenario.snapshotEval.baselineSnapshotId,
              baseline_source_run_id: scenario.snapshotEval.baselineSourceRunId,
              last_updated_at: scenario.snapshotEval.lastUpdatedAt
            }
          }
        : {}),
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
  };

  const scenarios = (
    config.scenarioEntries && config.scenarioEntries.length > 0
      ? config.scenarioEntries.map((entry) => {
          if (entry.kind === 'referenced') return { ref: entry.ref };
          return mapInlineScenario(entry.scenario);
        })
      : [...config.scenarios.map((scenario) => mapInlineScenario(scenario))]
  ) as CoreSourceEvalConfig['scenarios'];

  return {
    name: config.configName?.trim() || undefined,
    servers,
    agents,
    scenarios,
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
  const servers = Object.fromEntries(
    (input.servers ?? []).map((server) => [
      server.id,
      {
        ...(server.name && server.name !== server.id ? { name: server.name } : {}),
        transport: 'http' as const,
        url: server.url || 'http://localhost:3000/mcp',
        auth:
          server.authType === 'bearer'
            ? { type: 'bearer' as const, env: server.authValue || 'MCP_TOKEN' }
            : server.authType === 'api-key'
            ? {
                type: 'oauth_client_credentials' as const,
                token_url: server.oauthTokenUrl || '',
                client_id_env: server.oauthClientIdEnv || '',
                client_secret_env: server.oauthClientSecretEnv || '',
                ...(server.oauthScope ? { scope: server.oauthScope } : {}),
                ...(server.oauthAudience ? { audience: server.oauthAudience } : {})
              }
            : server.authType === 'oauth2'
            ? {
                type: 'oauth_authorization_code' as const,
                client_id: server.oauthClientId || '',
                client_secret: server.oauthClientSecret || undefined,
                redirect_url: server.oauthRedirectUrl || 'http://localhost:6274/oauth/',
                scope: server.oauthScope || undefined
              }
            : undefined
      }
    ])
  ) as CoreEvalConfig['servers'];

  const agents = Object.fromEntries(
    input.agents.map((agent) => [
      agent.id,
      {
        ...(agent.name && agent.name !== agent.id ? { name: agent.name } : {}),
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
      }
    ])
  ) as CoreEvalConfig['agents'];

  return {
    servers,
    agents,
    scenarios: input.scenarios.map((scenario) => ({
      id: scenario.id,
      name: scenario.name || undefined,
      mcp_servers:
        scenario.serverIds.length > 0 ? scenario.serverIds.map((id) => ({ ref: id })) : undefined,
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
          required_tools: scenario.evalRules
            .filter((rule) => rule.type === 'required_tool')
            .map((rule) => rule.value),
          forbidden_tools: scenario.evalRules
            .filter((rule) => rule.type === 'forbidden_tool')
            .map((rule) => rule.value)
        },
        response_assertions: scenario.evalRules
          .filter(
            (rule) => rule.type === 'response_contains' || rule.type === 'response_not_contains'
          )
          .map((rule) => ({ type: 'regex' as const, pattern: rule.value }))
      },
      extract: scenario.extractRules.map((rule) => ({
        name: rule.name,
        from: 'final_text' as const,
        regex: rule.pattern
      }))
    }))
  };
}

function traceScenarioKey(scenarioId?: string, agent?: string): string | undefined {
  if (!scenarioId) return undefined;
  return `${scenarioId}::${agent ?? ''}`;
}

function isTextBlock(
  block: TraceMessageContentBlock
): block is Extract<TraceMessageContentBlock, { type: 'text' }> {
  return block.type === 'text';
}

function toToolCallsFromRecord(
  run: CoreResultsJson['scenarios'][number]['runs'][number],
  record?: ScenarioRunTraceRecord
): ToolCall[] {
  if (!record) {
    return run.tool_calls.map((name, idx) => ({
      name,
      arguments: {},
      duration: run.tool_durations_ms[idx] ?? 0,
      timestamp: new Date().toISOString()
    }));
  }

  const uses: Array<{ id: string; name: string; input: Record<string, unknown>; ts?: string }> = [];
  const resultByUseId = new Map<string, { durationMs?: number; tsEnd?: string }>();

  for (const message of record.messages) {
    for (const block of message.content) {
      if (block.type === 'tool_use') {
        uses.push({
          id: block.id,
          name: block.name,
          input: (block.input as Record<string, unknown>) ?? {},
          ts: message.ts
        });
      } else if (block.type === 'tool_result') {
        resultByUseId.set(block.tool_use_id, {
          durationMs: block.duration_ms,
          tsEnd: block.ts_end
        });
      }
    }
  }

  return uses.map((use, idx) => {
    const result = resultByUseId.get(use.id);
    return {
      name: use.name,
      arguments: use.input,
      duration: result?.durationMs ?? run.tool_durations_ms[idx] ?? 0,
      timestamp: result?.tsEnd ?? use.ts ?? new Date().toISOString()
    };
  });
}

function toConversationItemsFromRecord(
  record: ScenarioRunTraceRecord | undefined,
  fallbackUserPrompt?: string
): ConversationItem[] {
  const items: ConversationItem[] = [];
  if (!record) {
    if (fallbackUserPrompt) {
      items.push({
        id: 'user_prompt-0',
        kind: 'user_prompt',
        text: fallbackUserPrompt,
        timestamp: undefined
      });
    }
    return items;
  }

  let lastAssistantTextItemIndex: number | undefined;
  const allMessages = record.messages ?? [];
  for (let messageIndex = 0; messageIndex < allMessages.length; messageIndex += 1) {
    const message = allMessages[messageIndex];
    if (message.role === 'user') {
      const textBlocks = message.content.filter(isTextBlock);
      for (const block of textBlocks) {
        items.push({
          id: `user_prompt-${items.length}`,
          kind: 'user_prompt',
          text: block.text,
          timestamp: message.ts
        });
      }
      continue;
    }

    if (message.role === 'assistant') {
      const toolUses = message.content.filter(
        (block): block is Extract<TraceMessageContentBlock, { type: 'tool_use' }> =>
          block.type === 'tool_use'
      );
      for (const block of message.content) {
        if (block.type === 'text') {
          items.push({
            id: `assistant_thought-${items.length}`,
            kind: 'assistant_thought',
            text: block.text,
            timestamp: message.ts
          });
          lastAssistantTextItemIndex = items.length - 1;
        }
      }

      const nextMessage = allMessages[messageIndex + 1];
      const nextIsToolMessage = nextMessage?.role === 'tool';
      if (toolUses.length > 0 && nextIsToolMessage) {
        const resultByUseId = new Map<
          string,
          Extract<TraceMessageContentBlock, { type: 'tool_result' }>
        >();
        const unmatchedResults: Array<Extract<TraceMessageContentBlock, { type: 'tool_result' }>> =
          [];
        for (const block of nextMessage.content) {
          if (block.type !== 'tool_result') continue;
          if (block.tool_use_id) resultByUseId.set(block.tool_use_id, block);
          else unmatchedResults.push(block);
        }

        for (const use of toolUses) {
          items.push({
            id: `tool_call-${items.length}`,
            kind: 'tool_call',
            text: stringifySafe(use.input ?? {}),
            toolName: use.name,
            timestamp: message.ts
          });

          const result = resultByUseId.get(use.id);
          if (!result) continue;
          const text = result.content
            .filter(isTextBlock)
            .map((part) => part.text)
            .join('\n');
          items.push({
            id: `tool_result-${items.length}`,
            kind: 'tool_result',
            text,
            toolName: result.name,
            ok: !result.is_error,
            durationMs: result.duration_ms,
            timestamp: result.ts_end ?? nextMessage.ts
          });
          resultByUseId.delete(use.id);
        }

        for (const result of [...resultByUseId.values(), ...unmatchedResults]) {
          const text = result.content
            .filter(isTextBlock)
            .map((part) => part.text)
            .join('\n');
          items.push({
            id: `tool_result-${items.length}`,
            kind: 'tool_result',
            text,
            toolName: result.name,
            ok: !result.is_error,
            durationMs: result.duration_ms,
            timestamp: result.ts_end ?? nextMessage.ts
          });
        }

        messageIndex += 1; // consumed the paired tool message
      } else {
        for (const use of toolUses) {
          items.push({
            id: `tool_call-${items.length}`,
            kind: 'tool_call',
            text: stringifySafe(use.input ?? {}),
            toolName: use.name,
            timestamp: message.ts
          });
        }
      }
      continue;
    }

    if (message.role === 'tool') {
      for (const block of message.content) {
        if (block.type !== 'tool_result') continue;
        const text = block.content
          .filter(isTextBlock)
          .map((part) => part.text)
          .join('\n');
        items.push({
          id: `tool_result-${items.length}`,
          kind: 'tool_result',
          text,
          toolName: block.name,
          ok: !block.is_error,
          durationMs: block.duration_ms,
          timestamp: block.ts_end ?? message.ts
        });
      }
    }
  }

  if (typeof lastAssistantTextItemIndex === 'number' && items[lastAssistantTextItemIndex]) {
    items[lastAssistantTextItemIndex] = {
      ...items[lastAssistantTextItemIndex],
      kind: 'assistant_final'
    };
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

export function fromCoreResultsJson(
  results: CoreResultsJson,
  traceRecords: ScenarioRunTraceRecord[] = []
): EvalResult {
  const traceByScenario = new Map<string, ScenarioRunTraceRecord[]>();
  for (const record of traceRecords) {
    const key = traceScenarioKey(record.scenario_id, record.agent);
    if (!key) continue;
    const existing = traceByScenario.get(key) ?? [];
    existing.push(record);
    traceByScenario.set(key, existing);
  }
  const scenarios = results.scenarios.map((scenario) => {
    const runRecords = traceByScenario.get(`${scenario.scenario_id}::${scenario.agent}`) ?? [];
    const runRecordByIndex = new Map<number, ScenarioRunTraceRecord>();
    for (const record of runRecords) {
      runRecordByIndex.set(record.run_index, record);
    }
    const runs: ScenarioRun[] = scenario.runs.map((run, index) => {
      const record = runRecordByIndex.get(run.run_index) ?? runRecords[index];
      return {
        runIndex: run.run_index,
        passed: run.pass,
        toolCalls: toToolCallsFromRecord(run, record),
        finalAnswer: run.final_text,
        conversation: toConversationItemsFromRecord(record),
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
      scenarioName: scenario.scenario_name || scenario.scenario_id,
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
