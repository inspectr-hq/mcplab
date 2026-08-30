import type {
  AgentContext,
  ConversationItem,
  AgentEntry,
  CheckCounts,
  EvalConfig,
  EvalResult,
  EvalRule,
  ServerEntry,
  ScenarioEntry,
  ScenarioRun,
  TokenUsage,
  ToolCall
} from '@/types/eval';
import type { CoreToolInputAssertion } from './types';
import {
  addTokenUsage,
  createTokenAccumulator,
  toTokenUsage,
  type TokenAccumulator
} from '@/lib/token-usage';
import { safeText } from '@/lib/utils';
import {
  attachmentTypeFromMediaType,
  inferAttachmentMediaType
} from '../../../../core/src/attachments';
import type { ScenarioAttachment, SourceScenarioAttachment } from '@inspectr/mcplab-core';
import type {
  CoreEvalConfig,
  CoreResultsJson,
  CoreScenarioRun,
  CoreSourceEvalConfig,
  ScenarioRunTraceRecord,
  TraceMessageContentBlock,
  WorkspaceConfigRecord,
  CoreLibraryBundle,
  LibraryBundle
} from './types';
import { tallyCheckCounts } from '@inspectr/mcplab-core';

function toId(base: string, index: number): string {
  return `${base}-${index + 1}`;
}

function normalizeText(value: unknown): string | undefined {
  return safeText(value) || undefined;
}

function withOptionalTemperature(temperature: number | undefined): { temperature?: number } {
  return temperature !== undefined ? { temperature } : {};
}

function normalizeScenarioAttachment(att: SourceScenarioAttachment): ScenarioAttachment {
  const mediaType = att.media_type ?? inferAttachmentMediaType(att) ?? 'application/octet-stream';
  return {
    type: attachmentTypeFromMediaType(mediaType),
    media_type: mediaType,
    data: att.data ?? '',
    ...(att.url ? { url: att.url } : {}),
    ...(att.name ? { name: att.name } : {})
  };
}

function toUiEvalRule(assertion: {
  type: string;
  pattern?: string;
  value?: string;
  path?: string;
  equals?: string | number | boolean;
}): EvalRule {
  switch (assertion.type) {
    case 'regex':
      return { type: 'response_regex', value: assertion.pattern };
    case 'contains':
      return { type: 'response_contains', value: assertion.value };
    case 'not_contains':
      return { type: 'response_not_contains', value: assertion.value };
    case 'starts_with':
      return { type: 'response_starts_with', value: assertion.value };
    case 'ends_with':
      return { type: 'response_ends_with', value: assertion.value };
    case 'equals':
      return { type: 'response_equals', value: assertion.value };
    case 'jsonpath':
      return { type: 'response_jsonpath', path: assertion.path, equals: assertion.equals };
    case 'jsonpath_exists':
      return { type: 'response_jsonpath_exists', path: assertion.path };
    case 'jsonpath_not_exists':
      return { type: 'response_jsonpath_not_exists', path: assertion.path };
    default:
      throw new Error(
        `Unsupported response assertion type in config: ${String(
          assertion?.type ?? '(missing type)'
        )}`
      );
  }
}

function toUiToolInputRule(assertion: {
  type: 'contains' | 'regex' | 'jsonpath';
  tool: string;
  path?: string;
  equals?: string | number | boolean;
  value?: string | number | boolean;
  pattern?: string;
}): EvalRule {
  return {
    type: `tool_input_${assertion.type}` as EvalRule['type'],
    tool: assertion.tool,
    ...(assertion.path ? { path: assertion.path } : {}),
    ...(assertion.equals !== undefined ? { equals: assertion.equals } : {}),
    ...(assertion.value !== undefined ? { value: assertion.value } : {}),
    ...(assertion.pattern !== undefined ? { value: assertion.pattern } : {})
  };
}

function toCoreResponseAssertion(
  rule: EvalRule
):
  | { type: 'regex'; pattern: string }
  | { type: 'contains'; value: string }
  | { type: 'not_contains'; value: string }
  | { type: 'starts_with'; value: string }
  | { type: 'ends_with'; value: string }
  | { type: 'equals'; value: string }
  | { type: 'jsonpath'; path: string; equals?: string | number | boolean }
  | { type: 'jsonpath_exists'; path: string }
  | { type: 'jsonpath_not_exists'; path: string }
  | null {
  if (
    rule.type === 'required_tool' ||
    rule.type === 'forbidden_tool' ||
    rule.type === 'tool_sequence' ||
    rule.type.startsWith('tool_input_') ||
    rule.type === 'agent_check'
  )
    return null;
  const value = rule.value === undefined ? undefined : String(rule.value);
  if (rule.type === 'response_contains') {
    return value ? { type: 'contains', value } : null;
  }
  if (rule.type === 'response_not_contains') {
    return value ? { type: 'not_contains', value } : null;
  }
  if (rule.type === 'response_starts_with') {
    return value ? { type: 'starts_with', value } : null;
  }
  if (rule.type === 'response_ends_with') {
    return value ? { type: 'ends_with', value } : null;
  }
  if (rule.type === 'response_equals') {
    return value ? { type: 'equals', value } : null;
  }
  if (rule.type === 'response_regex') {
    return value ? { type: 'regex', pattern: value } : null;
  }
  if (rule.type === 'response_jsonpath') {
    if (!rule.path?.trim()) return null;
    return rule.equals !== undefined
      ? { type: 'jsonpath', path: rule.path.trim(), equals: rule.equals }
      : { type: 'jsonpath', path: rule.path.trim() };
  }
  if (rule.type === 'response_jsonpath_exists') {
    return rule.path?.trim() ? { type: 'jsonpath_exists', path: rule.path.trim() } : null;
  }
  if (rule.type === 'response_jsonpath_not_exists') {
    return rule.path?.trim() ? { type: 'jsonpath_not_exists', path: rule.path.trim() } : null;
  }
  return null;
}

function buildCoreEvalBlock(
  evalRules: EvalRule[],
  agentContext?: AgentContext
):
  | {
      tool_constraints?: {
        required_tools?: string[];
        forbidden_tools?: string[];
      };
      tool_sequence?: string[];
      response_assertions?: Array<
        | { type: 'regex'; pattern: string }
        | { type: 'contains'; value: string }
        | { type: 'not_contains'; value: string }
        | { type: 'starts_with'; value: string }
        | { type: 'ends_with'; value: string }
        | { type: 'equals'; value: string }
        | { type: 'jsonpath'; path: string; equals?: string | number | boolean }
        | { type: 'jsonpath_exists'; path: string }
        | { type: 'jsonpath_not_exists'; path: string }
      >;
      tool_input_assertions?: Array<
        | { type: 'contains'; tool: string; value: string }
        | { type: 'regex'; tool: string; pattern: string }
        | { type: 'jsonpath'; tool: string; path: string; equals?: string | number | boolean }
      >;
      agent_assertions?: Array<{ label: string; prompt: string }>;
      agent_context?: AgentContext;
    }
  | undefined {
  const required_tools = evalRules
    .filter((rule) => rule.type === 'required_tool')
    .map((rule) => rule.value)
    .filter((value): value is string => typeof value === 'string' && value.length > 0);
  const forbidden_tools = evalRules
    .filter((rule) => rule.type === 'forbidden_tool')
    .map((rule) => rule.value)
    .filter((value): value is string => typeof value === 'string' && value.length > 0);
  const tool_sequence = evalRules
    .find((rule) => rule.type === 'tool_sequence')
    ?.sequence?.map((value) => value.trim())
    .filter((value): value is string => typeof value === 'string' && value.length > 0);
  const response_assertions = evalRules
    .map((rule) => toCoreResponseAssertion(rule))
    .filter((rule): rule is NonNullable<typeof rule> => Boolean(rule));
  const tool_input_assertions = evalRules
    .filter((rule) => rule.type.startsWith('tool_input_'))
    .flatMap((rule): CoreToolInputAssertion[] => {
      if (!rule.tool) return [];
      if (rule.type === 'tool_input_contains' && rule.value !== undefined)
        return [{ type: 'contains' as const, tool: rule.tool, value: String(rule.value) }];
      if (rule.type === 'tool_input_regex' && rule.value !== undefined)
        return [{ type: 'regex' as const, tool: rule.tool, pattern: String(rule.value) }];
      if (rule.type === 'tool_input_jsonpath' && rule.path)
        return [
          {
            type: 'jsonpath' as const,
            tool: rule.tool,
            path: rule.path,
            ...(rule.equals !== undefined ? { equals: rule.equals } : {})
          }
        ];
      return [];
    });
  const agent_assertions = evalRules
    .filter((rule) => rule.type === 'agent_check')
    .flatMap((rule) =>
      rule.label?.trim() && rule.prompt?.trim()
        ? [{ label: rule.label.trim(), prompt: rule.prompt.trim() }]
        : []
    );

  const tool_constraints =
    required_tools.length > 0 || forbidden_tools.length > 0
      ? {
          ...(required_tools.length > 0 ? { required_tools } : {}),
          ...(forbidden_tools.length > 0 ? { forbidden_tools } : {})
        }
      : undefined;

  const agent_context = {
    ...(agentContext?.include_prompt ? { include_prompt: true } : {}),
    ...(agentContext?.include_tool_sequence ? { include_tool_sequence: true } : {}),
    ...(agentContext?.include_tool_inputs ? { include_tool_inputs: true } : {})
  };
  const hasAgentContext = Object.keys(agent_context).length > 0;

  if (
    !tool_constraints &&
    !tool_sequence?.length &&
    tool_input_assertions.length === 0 &&
    response_assertions.length === 0 &&
    agent_assertions.length === 0 &&
    !hasAgentContext
  )
    return undefined;

  return {
    ...(tool_constraints ? { tool_constraints } : {}),
    ...(tool_sequence && tool_sequence.length > 0 ? { tool_sequence } : {}),
    ...(tool_input_assertions.length > 0 ? { tool_input_assertions } : {}),
    ...(response_assertions.length > 0 ? { response_assertions } : {}),
    ...(agent_assertions.length > 0 ? { agent_assertions } : {}),
    ...(hasAgentContext ? { agent_context } : {})
  };
}

function buildCoreExtractBlock(extractRules: EvalConfig['scenarios'][number]['extractRules']):
  | Array<{
      name: string;
      from: 'final_text';
      regex: string;
    }>
  | undefined {
  if (extractRules.length === 0) return undefined;
  return extractRules.map((rule) => ({
    name: rule.name,
    from: 'final_text' as const,
    regex: rule.pattern
  }));
}

function buildCoreScenarioEntry(
  scenario: EvalConfig['scenarios'][number],
  mcpServers:
    | Array<{ ref: string } | NonNullable<CoreSourceEvalConfig['servers']>[number]>
    | undefined
): NonNullable<CoreSourceEvalConfig['scenarios']>[number] {
  const evalBlock = buildCoreEvalBlock(scenario.evalRules, scenario.agentContext);
  const extract = buildCoreExtractBlock(scenario.extractRules);

  return {
    id: scenario.id,
    name: normalizeText(scenario.name),
    mcp_servers: mcpServers,
    prompt: scenario.prompt,
    attachments: scenario.attachments,
    eval: evalBlock,
    extract
  };
}

function toUiServerConfigFromMcpEntry(
  entry: Record<string, unknown>
): { id: string; server: EvalConfig['servers'][number] } | null {
  if (!('id' in entry) || !entry.id) return null;
  const id = String(entry.id);
  const auth = entry.auth as Record<string, unknown> | undefined;
  const server = {
    id,
    name: String(entry.name || id),
    transport: 'streamable-http' as const,
    url: String(entry.url || ''),
    authType: (auth?.type === 'bearer'
      ? 'bearer'
      : auth?.type === 'api_key'
      ? 'api-key'
      : auth?.type === 'oauth_client_credentials'
      ? 'api-key'
      : auth?.type === 'oauth_authorization_code'
      ? 'oauth2'
      : 'none') as 'none' | 'bearer' | 'api-key' | 'oauth2',
    authValue:
      auth?.type === 'bearer'
        ? String(auth.token || '') || (auth.env ? `\${${auth.env}}` : undefined)
        : auth?.type === 'api_key'
        ? String(auth.value || '')
        : undefined,
    apiKeyHeaderName: auth?.type === 'api_key' ? String(auth.header_name || '') : undefined,
    oauthClientId:
      auth?.type === 'oauth_authorization_code'
        ? String(auth.client_id || '') || undefined
        : undefined,
    oauthClientSecret:
      auth?.type === 'oauth_authorization_code'
        ? String(auth.client_secret || '') || undefined
        : undefined,
    oauthRedirectUrl:
      auth?.type === 'oauth_authorization_code'
        ? String(auth.redirect_url || '') || undefined
        : undefined,
    oauthScope:
      auth?.type === 'oauth_authorization_code' || auth?.type === 'oauth_client_credentials'
        ? String((auth.scope as string) || '') || undefined
        : undefined,
    oauthMode:
      auth?.type === 'oauth_authorization_code'
        ? (auth.mode as 'pre_registered' | 'dcr' | undefined)
        : undefined,
    oauthAuthorizationUrl:
      auth?.type === 'oauth_authorization_code'
        ? String(auth.authorization_url || '') || undefined
        : undefined,
    oauthTokenEndpoint:
      auth?.type === 'oauth_authorization_code'
        ? String(auth.token_url || '') || undefined
        : undefined,
    oauthTokenUrl:
      auth?.type === 'oauth_client_credentials' ? String(auth.token_url || '') : undefined,
    oauthClientIdEnv:
      auth?.type === 'oauth_client_credentials' ? String(auth.client_id_env || '') : undefined,
    oauthClientSecretEnv:
      auth?.type === 'oauth_client_credentials' ? String(auth.client_secret_env || '') : undefined,
    oauthAudience:
      auth?.type === 'oauth_client_credentials'
        ? String(auth.audience || '') || undefined
        : undefined
  };
  return { id, server };
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
        : entry.auth?.type === 'api_key'
        ? 'api-key'
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
      authValue:
        entry.auth?.type === 'bearer'
          ? entry.auth.token ?? (entry.auth.env ? `\${${entry.auth.env}}` : undefined)
          : entry.auth?.type === 'api_key'
          ? entry.auth.value
          : undefined,
      apiKeyHeaderName: entry.auth?.type === 'api_key' ? entry.auth.header_name : undefined,
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
      oauthMode: entry.auth?.type === 'oauth_authorization_code' ? entry.auth.mode : undefined,
      oauthAuthorizationUrl:
        entry.auth?.type === 'oauth_authorization_code' ? entry.auth.authorization_url : undefined,
      oauthTokenEndpoint:
        entry.auth?.type === 'oauth_authorization_code' ? entry.auth.token_url : undefined,
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
      ...withOptionalTemperature(entry.temperature),
      maxTokens: entry.max_tokens ?? 2048,
      maxTurns: entry.max_turns,
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
      const mcpServers = scenario.mcp_servers;
      const mappedMcpServers: ServerEntry[] | undefined = Array.isArray(mcpServers)
        ? mcpServers.flatMap((rawEntry): ServerEntry[] => {
            const entry = rawEntry as unknown as Record<string, unknown>;
            if ('ref' in entry && entry.ref)
              return [{ kind: 'referenced' as const, ref: String(entry.ref) }];
            const mapped = toUiServerConfigFromMcpEntry(entry);
            if (mapped) return [{ kind: 'inline' as const, server: mapped.server }];
            return [];
          })
        : undefined;
      scenarioEntries.push({
        kind: 'referenced',
        ref,
        ...(mappedMcpServers ? { mcpServers: mappedMcpServers } : {})
      });
      return;
    }
    const evalRules: EvalRule[] = [];
    for (const tool of scenario.eval?.tool_constraints?.required_tools ?? []) {
      evalRules.push({ type: 'required_tool', value: tool });
    }
    for (const tool of scenario.eval?.tool_constraints?.forbidden_tools ?? []) {
      evalRules.push({ type: 'forbidden_tool', value: tool });
    }
    if (scenario.eval?.tool_sequence?.length) {
      evalRules.push({ type: 'tool_sequence', sequence: [...scenario.eval.tool_sequence] });
    }
    for (const assertion of scenario.eval?.response_assertions ?? []) {
      evalRules.push(toUiEvalRule(assertion));
    }
    for (const assertion of scenario.eval?.tool_input_assertions ?? []) {
      evalRules.push(toUiToolInputRule(assertion));
    }
    for (const assertion of scenario.eval?.agent_assertions ?? []) {
      evalRules.push({
        type: 'agent_check',
        label: assertion.label,
        prompt: assertion.prompt
      });
    }

    const mappedAgentContext: AgentContext | undefined =
      scenario.eval?.agent_context &&
      (scenario.eval.agent_context.include_prompt ||
        scenario.eval.agent_context.include_tool_sequence ||
        scenario.eval.agent_context.include_tool_inputs)
        ? {
            include_prompt: scenario.eval.agent_context.include_prompt,
            include_tool_sequence: scenario.eval.agent_context.include_tool_sequence,
            include_tool_inputs: scenario.eval.agent_context.include_tool_inputs
          }
        : undefined;
    const mappedScenario: EvalConfig['scenarios'][number] = {
      id: scenario.id || toId('scn', index),
      name: normalizeText(scenario.name) || scenario.id || `Scenario ${index + 1}`,
      serverIds: (() => {
        if ((scenario.servers ?? []).length > 0) {
          return (scenario.servers as string[])
            .map((name) => serverIdByName.get(name) ?? name)
            .filter(Boolean) as string[];
        }
        const mcpServers = (scenario as unknown as Record<string, unknown>).mcp_servers;
        if (Array.isArray(mcpServers)) {
          return mcpServers.flatMap((entry: Record<string, unknown>) => {
            if ('ref' in entry && entry.ref) return [String(entry.ref)];
            const mapped = toUiServerConfigFromMcpEntry(entry);
            if (mapped) {
              const id = mapped.id;
              // Register inline mcp_servers entry in the server pool so it survives round-trips
              if (!serverIdByName.has(id)) {
                serverIdByName.set(id, id);
                servers.push(mapped.server);
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
      attachments: scenario.attachments?.map(normalizeScenarioAttachment),
      evalRules,
      extractRules: (scenario.extract ?? []).map((rule) => ({
        name: rule.name,
        pattern: rule.regex
      })),
      ...(mappedAgentContext ? { agentContext: mappedAgentContext } : {})
    };
    inlineScenarios.push(mappedScenario);
    scenarioEntries.push({ kind: 'inline', scenario: mappedScenario });
  });

  return {
    id: record.id,
    name: configName || record.name,
    configName,
    configHash: record.hash,
    description: record.path,
    ...(record.relativePath ? { relativePath: record.relativePath } : {}),
    ...(record.suitePath !== undefined ? { suitePath: record.suitePath } : {}),
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
    createdAt: record.mtime,
    updatedAt: record.mtime,
    sourcePath: record.path
  };
}

export function fromCoreLibraries(libraries: CoreLibraryBundle): LibraryBundle {
  const record: WorkspaceConfigRecord = {
    id: 'library',
    name: 'library',
    path: 'library',
    mtime: new Date(0).toISOString(),
    hash: '',
    config: {
      servers: Object.entries(libraries.servers).map(([name, server]) => ({
        id: name,
        name: normalizeText(server.name) || name,
        transport: server.transport,
        url: server.url,
        auth: server.auth
      })) as unknown as CoreSourceEvalConfig['servers'],
      agents: Object.entries(libraries.agents).map(([name, agent]) => ({
        id: name,
        name: normalizeText(agent.name) || name,
        provider: agent.provider,
        model: agent.model,
        temperature: agent.temperature,
        max_tokens: agent.max_tokens,
        max_turns: agent.max_turns,
        system: agent.system
      })) as unknown as CoreSourceEvalConfig['agents'],
      scenarios: libraries.scenarios.map((scenario, index) => ({
        ...scenario,
        name: normalizeText(scenario.name) || scenario.id || `Scenario ${index + 1}`
      })) as CoreSourceEvalConfig['scenarios']
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
    const trimmedAuthValue = server.authValue?.trim() ?? '';
    const trimmedApiKeyHeaderName = server.apiKeyHeaderName?.trim() ?? '';
    const auth =
      server.authType === 'bearer'
        ? (() => {
            if (!trimmedAuthValue) {
              throw new Error(`Server '${sourceId}' is missing bearer token value`);
            }
            return { type: 'bearer' as const, token: trimmedAuthValue };
          })()
        : server.authType === 'api-key' && !server.oauthTokenUrl
        ? {
            type: 'api_key' as const,
            ...(trimmedApiKeyHeaderName ? { header_name: trimmedApiKeyHeaderName } : {}),
            value: (() => {
              if (!trimmedAuthValue) {
                throw new Error(`Server '${sourceId}' is missing API key value`);
              }
              return trimmedAuthValue;
            })()
          }
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
            ...(server.oauthMode === 'dcr' ? { mode: 'dcr' as const } : {}),
            ...(server.oauthMode !== 'dcr' && server.oauthClientId
              ? { client_id: server.oauthClientId }
              : {}),
            ...(server.oauthClientSecret ? { client_secret: server.oauthClientSecret } : {}),
            ...(server.oauthRedirectUrl ? { redirect_url: server.oauthRedirectUrl } : {}),
            ...(server.oauthScope ? { scope: server.oauthScope } : {}),
            ...(server.oauthAuthorizationUrl
              ? { authorization_url: server.oauthAuthorizationUrl }
              : {}),
            ...(server.oauthTokenEndpoint ? { token_url: server.oauthTokenEndpoint } : {})
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
  const servers = mixedServerEntries.flatMap(
    (entry): NonNullable<CoreSourceEvalConfig['servers']> => {
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
    }
  );

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
      ...withOptionalTemperature(agent.temperature),
      max_tokens: agent.maxTokens,
      max_turns: agent.maxTurns,
      system: agent.systemPrompt
    } satisfies NonNullable<CoreSourceEvalConfig['agents']>[number];
  };

  const mixedAgentEntries =
    config.agentEntries && config.agentEntries.length > 0
      ? config.agentEntries
      : [...config.agents.map((agent) => ({ kind: 'inline' as const, agent }))];
  const seenAgentRefs = new Set<string>();
  const agents = mixedAgentEntries.flatMap((entry): NonNullable<CoreSourceEvalConfig['agents']> => {
    if (entry.kind === 'referenced') {
      const ref = String(entry.ref || '').trim();
      if (!ref || seenAgentRefs.has(ref)) return [];
      seenAgentRefs.add(ref);
      return [{ ref }];
    }
    return [mapInlineAgent(entry.agent)];
  });

  const mapInlineScenario = (scenario: EvalConfig['scenarios'][number]) => {
    const mcpServers =
      scenario.serverIds.length > 0
        ? scenario.serverIds.map((id) => {
            const resolvedId = serverNameById.get(id) ?? id;
            const inline = inlineServerById.get(resolvedId);
            return inline ?? { ref: resolvedId };
          })
        : undefined;

    return buildCoreScenarioEntry(scenario, mcpServers);
  };

  const scenarios = (
    config.scenarioEntries && config.scenarioEntries.length > 0
      ? config.scenarioEntries.map((entry) => {
          if (entry.kind === 'referenced') {
            return {
              ref: entry.ref,
              ...(Array.isArray(entry.mcpServers)
                ? {
                    mcp_servers: entry.mcpServers.map((serverEntry) => {
                      if (serverEntry.kind === 'referenced') {
                        return { ref: serverEntry.ref };
                      }
                      return mapInlineServer(serverEntry.server);
                    })
                  }
                : {})
            };
          }
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
        : undefined
  };
}

export function toCoreLibraries(
  input: Pick<EvalConfig, 'servers' | 'agents' | 'scenarios'>
): CoreLibraryBundle {
  const servers = Object.fromEntries(
    (input.servers ?? []).map((server) => [
      server.id,
      (() => {
        const trimmedAuthValue = server.authValue?.trim() ?? '';
        const trimmedApiKeyHeaderName = server.apiKeyHeaderName?.trim() ?? '';
        return {
          ...(server.name && server.name !== server.id ? { name: server.name } : {}),
          transport: 'http' as const,
          url: server.url || 'http://localhost:3000/mcp',
          auth:
            server.authType === 'bearer'
              ? (() => {
                  if (!trimmedAuthValue) {
                    throw new Error(`Server '${server.id}' is missing bearer token value`);
                  }
                  return { type: 'bearer' as const, token: trimmedAuthValue };
                })()
              : server.authType === 'api-key' && !server.oauthTokenUrl
              ? {
                  type: 'api_key' as const,
                  ...(trimmedApiKeyHeaderName ? { header_name: trimmedApiKeyHeaderName } : {}),
                  value: (() => {
                    if (!trimmedAuthValue) {
                      throw new Error(`Server '${server.id}' is missing API key value`);
                    }
                    return trimmedAuthValue;
                  })()
                }
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
                  ...(server.oauthMode === 'dcr' ? { mode: 'dcr' as const } : {}),
                  ...(server.oauthMode !== 'dcr' && server.oauthClientId
                    ? { client_id: server.oauthClientId }
                    : {}),
                  ...(server.oauthClientSecret ? { client_secret: server.oauthClientSecret } : {}),
                  ...(server.oauthRedirectUrl ? { redirect_url: server.oauthRedirectUrl } : {}),
                  ...(server.oauthScope ? { scope: server.oauthScope } : {}),
                  ...(server.oauthAuthorizationUrl
                    ? { authorization_url: server.oauthAuthorizationUrl }
                    : {}),
                  ...(server.oauthTokenEndpoint ? { token_url: server.oauthTokenEndpoint } : {})
                }
              : undefined
        };
      })()
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
        ...withOptionalTemperature(agent.temperature),
        max_tokens: agent.maxTokens,
        max_turns: agent.maxTurns,
        system: agent.systemPrompt
      }
    ])
  ) as CoreEvalConfig['agents'];

  return {
    servers,
    agents,
    scenarios: input.scenarios.map((scenario) =>
      buildCoreScenarioEntry(
        scenario,
        scenario.serverIds.length > 0 ? scenario.serverIds.map((id) => ({ ref: id })) : undefined
      )
    ) as CoreEvalConfig['scenarios']
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
      for (const block of message.content) {
        if (block.type === 'text') {
          items.push({
            id: `user_prompt-${items.length}`,
            kind: 'user_prompt',
            text: block.text,
            timestamp: message.ts
          });
        } else if (block.type === 'image') {
          items.push({
            id: `attachment-${items.length}`,
            kind: 'user_prompt',
            text: `[Attached image: ${block.name ?? 'image'}]`,
            timestamp: message.ts
          });
        } else if (block.type === 'document') {
          items.push({
            id: `attachment-${items.length}`,
            kind: 'user_prompt',
            text: `[Attached document: ${block.name ?? 'document'} (${block.media_type})]`,
            timestamp: message.ts
          });
        }
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
            timestamp: message.ts,
            estimatedTokens: use.estimated_tokens
              ? {
                  inputTokens: use.estimated_tokens.input,
                  outputTokens: use.estimated_tokens.output,
                  totalTokens: use.estimated_tokens.total
                }
              : undefined,
            estimatedTokenMethod: use.estimated_tokens?.method
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
            timestamp: result.ts_end ?? nextMessage.ts,
            estimatedTokens: result.estimated_tokens
              ? {
                  inputTokens: result.estimated_tokens.input,
                  outputTokens: result.estimated_tokens.output,
                  totalTokens: result.estimated_tokens.total
                }
              : undefined,
            estimatedTokenMethod: result.estimated_tokens?.method
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
            timestamp: result.ts_end ?? nextMessage.ts,
            estimatedTokens: result.estimated_tokens
              ? {
                  inputTokens: result.estimated_tokens.input,
                  outputTokens: result.estimated_tokens.output,
                  totalTokens: result.estimated_tokens.total
                }
              : undefined,
            estimatedTokenMethod: result.estimated_tokens?.method
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
            timestamp: message.ts,
            estimatedTokens: use.estimated_tokens
              ? {
                  inputTokens: use.estimated_tokens.input,
                  outputTokens: use.estimated_tokens.output,
                  totalTokens: use.estimated_tokens.total
                }
              : undefined,
            estimatedTokenMethod: use.estimated_tokens?.method
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
          timestamp: block.ts_end ?? message.ts,
          estimatedTokens: block.estimated_tokens
            ? {
                inputTokens: block.estimated_tokens.input,
                outputTokens: block.estimated_tokens.output,
                totalTokens: block.estimated_tokens.total
              }
            : undefined,
          estimatedTokenMethod: block.estimated_tokens?.method
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

function addTraceUsage(
  accumulator: TokenAccumulator,
  usage?: { input_tokens?: number; output_tokens?: number; total_tokens?: number }
): void {
  if (!usage) return;
  if (typeof usage.input_tokens === 'number') {
    accumulator.input += usage.input_tokens;
    accumulator.hasInput = true;
  }
  if (typeof usage.output_tokens === 'number') {
    accumulator.output += usage.output_tokens;
    accumulator.hasOutput = true;
  }
  if (typeof usage.total_tokens === 'number') {
    accumulator.total += usage.total_tokens;
    accumulator.hasTotal = true;
  }
}

function splitInteger(value: number | undefined, parts: number): Array<number | undefined> {
  if (typeof value !== 'number' || parts <= 0) return new Array(parts).fill(undefined);
  const base = Math.floor(value / parts);
  const remainder = value % parts;
  return Array.from({ length: parts }, (_, index) => base + (index < remainder ? 1 : 0));
}

function estimateRunTokenUsage(record?: ScenarioRunTraceRecord): {
  assistant: TokenUsage | null;
  tool: TokenUsage | null;
  perTool: Record<string, TokenUsage>;
} {
  const assistantAcc = createTokenAccumulator();
  const toolAcc = createTokenAccumulator();
  const perToolAcc = new Map<string, TokenAccumulator>();

  if (!record) {
    return { assistant: null, tool: null, perTool: {} };
  }

  for (const message of record.messages ?? []) {
    if (message.role !== 'assistant') continue;
    addTraceUsage(assistantAcc, message.usage);
    const toolUses = message.content.filter(
      (block): block is Extract<TraceMessageContentBlock, { type: 'tool_use' }> =>
        block.type === 'tool_use'
    );
    if (toolUses.length === 0) continue;

    const allHaveEstimatedTokens = toolUses.every((toolUse) => Boolean(toolUse.estimated_tokens));
    if (allHaveEstimatedTokens) {
      for (const toolUse of toolUses) {
        const estimated = toolUse.estimated_tokens!;
        toolAcc.input += estimated.input;
        toolAcc.hasInput = true;
        toolAcc.output += estimated.output;
        toolAcc.hasOutput = true;
        toolAcc.total += estimated.total;
        toolAcc.hasTotal = true;

        const entry = perToolAcc.get(toolUse.name) ?? createTokenAccumulator();
        entry.input += estimated.input;
        entry.hasInput = true;
        entry.output += estimated.output;
        entry.hasOutput = true;
        entry.total += estimated.total;
        entry.hasTotal = true;
        perToolAcc.set(toolUse.name, entry);
      }
      continue;
    }

    addTraceUsage(toolAcc, message.usage);

    const inputShares = splitInteger(message.usage?.input_tokens, toolUses.length);
    const outputShares = splitInteger(message.usage?.output_tokens, toolUses.length);
    const totalShares = splitInteger(message.usage?.total_tokens, toolUses.length);

    for (let index = 0; index < toolUses.length; index += 1) {
      const toolName = toolUses[index]!.name;
      const entry = perToolAcc.get(toolName) ?? createTokenAccumulator();
      const input = inputShares[index];
      const output = outputShares[index];
      const total = totalShares[index];
      if (typeof input === 'number') {
        entry.input += input;
        entry.hasInput = true;
      }
      if (typeof output === 'number') {
        entry.output += output;
        entry.hasOutput = true;
      }
      if (typeof total === 'number') {
        entry.total += total;
        entry.hasTotal = true;
      }
      perToolAcc.set(toolName, entry);
    }
  }

  const perTool: Record<string, TokenUsage> = {};
  for (const [toolName, usage] of Array.from(perToolAcc.entries()).sort((a, b) =>
    a[0].localeCompare(b[0])
  )) {
    const normalized = toTokenUsage(usage);
    if (normalized) perTool[toolName] = normalized;
  }

  return {
    assistant: toTokenUsage(assistantAcc),
    tool: toTokenUsage(toolAcc),
    perTool
  };
}

function deriveRunDurationMs(run: CoreScenarioRun, record?: ScenarioRunTraceRecord): number {
  if (record) {
    const startMs = Date.parse(record.ts_start);
    const endMs = Date.parse(record.ts_end);
    if (Number.isFinite(startMs) && Number.isFinite(endMs)) {
      return Math.max(0, endMs - startMs);
    }
  }
  return run.tool_durations_ms.reduce((sum, value) => sum + value, 0);
}

function countChecks(runs: ScenarioRun[]): CheckCounts {
  return tallyCheckCounts(runs.flatMap((run) => run.checkResults ?? []));
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
      const tokenUsage = estimateRunTokenUsage(record);
      return {
        runIndex: run.run_index,
        passed: run.pass,
        error: run.error,
        toolCalls: toToolCallsFromRecord(run, record),
        assistantTokenUsage: tokenUsage.assistant,
        toolTokenUsage: tokenUsage.tool,
        toolTokenUsageByTool: tokenUsage.perTool,
        finalAnswer: run.final_text,
        conversation: toConversationItemsFromRecord(record),
        duration: deriveRunDurationMs(run, record),
        extractedValues: Object.fromEntries(
          Object.entries(run.extracted).map(([k, v]) => [k, String(v ?? '')])
        ),
        failureReasons: run.failures,
        checkResults: run.check_results
      };
    });

    const scenarioAssistantUsageAcc = createTokenAccumulator();
    const scenarioToolUsageAcc = createTokenAccumulator();
    const scenarioPerToolUsageAcc = new Map<string, TokenAccumulator>();
    for (const run of runs) {
      addTokenUsage(scenarioAssistantUsageAcc, run.assistantTokenUsage);
      addTokenUsage(scenarioToolUsageAcc, run.toolTokenUsage);
      for (const [toolName, usage] of Object.entries(run.toolTokenUsageByTool ?? {})) {
        const entry = scenarioPerToolUsageAcc.get(toolName) ?? createTokenAccumulator();
        addTokenUsage(entry, usage);
        scenarioPerToolUsageAcc.set(toolName, entry);
      }
    }
    const scenarioPerToolUsage: Record<string, TokenUsage> = {};
    for (const [toolName, usage] of Array.from(scenarioPerToolUsageAcc.entries()).sort((a, b) =>
      a[0].localeCompare(b[0])
    )) {
      const normalized = toTokenUsage(usage);
      if (normalized) scenarioPerToolUsage[toolName] = normalized;
    }

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
      provider: scenario.provider,
      model: scenario.model,
      runs,
      passRate: scenario.pass_rate,
      avgToolCalls,
      avgDuration,
      checkCounts: countChecks(runs),
      assistantTokenUsage: toTokenUsage(scenarioAssistantUsageAcc),
      toolTokenUsage: toTokenUsage(scenarioToolUsageAcc),
      toolTokenUsageByTool: scenarioPerToolUsage
    };
  });

  const runAssistantUsageAcc = createTokenAccumulator();
  const runToolUsageAcc = createTokenAccumulator();
  for (const scenario of scenarios) {
    addTokenUsage(runAssistantUsageAcc, scenario.assistantTokenUsage);
    addTokenUsage(runToolUsageAcc, scenario.toolTokenUsage);
  }

  const checkCounts = scenarios.reduce(
    (counts, scenario) => {
      counts.passed += scenario.checkCounts?.passed ?? 0;
      counts.failed += scenario.checkCounts?.failed ?? 0;
      counts.not_evaluated += scenario.checkCounts?.not_evaluated ?? 0;
      counts.total += scenario.checkCounts?.total ?? 0;
      return counts;
    },
    { passed: 0, failed: 0, not_evaluated: 0, total: 0 }
  );

  return {
    id: results.metadata.run_id,
    configId: '',
    configHash: results.metadata.config_hash,
    configPath: results.metadata.config_path,
    configName: results.metadata.config_name,
    langsmithTraceUrls: results.metadata.langsmith_trace_urls,
    rerunAgents: results.metadata.rerun_agents,
    rerunScenarioIds: results.metadata.rerun_scenario_ids,
    rerunServerOverrideAll: results.metadata.rerun_server_override_all,
    rerunScenarioServerOverrides: results.metadata.rerun_scenario_server_overrides,
    timestamp: results.metadata.timestamp,
    runNote: results.metadata.run_note,
    mcpServerVersions: results.metadata.mcp_server_versions ?? {},
    scenarios,
    assistantTokenUsage: toTokenUsage(runAssistantUsageAcc),
    toolTokenUsage: toTokenUsage(runToolUsageAcc),
    overallPassRate: results.summary.pass_rate,
    totalScenarios: results.summary.total_scenarios,
    totalRuns: results.summary.total_runs,
    avgToolCalls: results.summary.avg_tool_calls_per_run,
    avgLatency: Math.round(results.summary.avg_tool_latency_ms ?? 0),
    checkCounts,
    totalToolDurationMs:
      typeof (results.metadata as { total_tool_duration_ms?: unknown }).total_tool_duration_ms ===
      'number'
        ? Math.max(
            0,
            (results.metadata as { total_tool_duration_ms?: number }).total_tool_duration_ms ?? 0
          )
        : 0
  };
}

export function fromCoreScenarioRunPreview(
  run: CoreScenarioRun,
  traceRecord?: ScenarioRunTraceRecord | null
): ScenarioRun {
  const tokenUsage = estimateRunTokenUsage(traceRecord ?? undefined);
  return {
    runIndex: run.run_index,
    passed: run.pass,
    error: run.error,
    toolCalls: toToolCallsFromRecord(run, traceRecord ?? undefined),
    assistantTokenUsage: tokenUsage.assistant,
    toolTokenUsage: tokenUsage.tool,
    toolTokenUsageByTool: tokenUsage.perTool,
    finalAnswer: run.final_text,
    conversation: toConversationItemsFromRecord(traceRecord ?? undefined),
    duration: deriveRunDurationMs(run, traceRecord ?? undefined),
    extractedValues: Object.fromEntries(
      Object.entries(run.extracted).map(([k, v]) => [k, String(v ?? '')])
    ),
    failureReasons: run.failures,
    checkResults: run.check_results
  };
}
