import type { ServerResponse } from 'node:http';
import {
  isLlmAgent,
  type EvalConfig,
  type LlmAgentConfig,
  type AssistantRuntimeMessage,
  type AssistantRuntimeDefinition,
  type AssistantRuntimeModelOutput,
  type AssistantRuntimeSession,
  type ScenarioAssistantSuggestionBundle,
  type ScenarioAssistantSuggestionRule,
  type ScenarioAssistantRuntimeContext,
  type ToolDef
} from '@inspectr/mcplab-core';
import { McpClientManager } from '@inspectr/mcplab-core';
import {
  parseJsonFromAssistantText,
  cleanupSessionsByTtl,
  makeAssistantToolPublicName,
  touchSession,
  truncateJson,
  withTimeout
} from './assistant-common.js';
import type { AssistantSseEvent } from './assistant-events.js';
import { endAssistantSseClients } from './assistant-events.js';
import { readLibraries } from './libraries-store.js';

export { truncateJson } from './assistant-common.js';

type ScenarioAssistantContextInput = ScenarioAssistantRuntimeContext;

type ScenarioAssistantEvalRuleSuggestion = ScenarioAssistantSuggestionRule;

interface ParsedAssistantToolCall {
  name: string;
  arguments?: unknown;
}

interface ParsedAssistantModelOutput {
  type: 'assistant_message' | 'tool_call_request';
  text: string;
  suggestions?: ScenarioAssistantSuggestionBundle;
  toolCall?: ParsedAssistantToolCall;
}

type AssistantChatMessage = AssistantRuntimeMessage;

export interface ScenarioAssistantSession {
  id: string;
  createdAt: number;
  lastTouchedAt: number;
  configPath?: string;
  selectedAssistantAgentName: string;
  context: ScenarioAssistantContextInput;
  agentConfig: LlmAgentConfig;
  toolsLoaded: number;
  toolServers: string[];
  initialMessages: AssistantChatMessage[];
  warnings: string[];
  events: AssistantSseEvent[];
  clients: Set<ServerResponse>;
  runtime?: AssistantRuntimeSession;
}

export interface PreparedScenarioAssistantSession extends ScenarioAssistantSession {
  mcp: McpClientManager;
  tools: ToolDef[];
  toolPublicMap: Map<string, { server: string; tool: string }>;
  systemPromptCache?: string;
}

const SCENARIO_ASSISTANT_SESSION_TTL_MS = 30 * 60 * 1000;

export function cleanupAssistantSessions(
  sessions: Map<string, ScenarioAssistantSession>,
  now = Date.now()
): void {
  cleanupSessionsByTtl(sessions, SCENARIO_ASSISTANT_SESSION_TTL_MS, now, (session) => {
    void Promise.resolve(session.runtime?.dispose()).catch(() => {});
    endAssistantSseClients(session);
  }, (session) => session.runtime?.isBusy?.() === true);
}

export function touchAssistantSession(session: ScenarioAssistantSession): void {
  touchSession(session);
}

export function assistantSessionView(session: ScenarioAssistantSession) {
  const runtimeSnapshot = session.runtime?.getSnapshot();
  return {
    id: session.id,
    createdAt: new Date(session.createdAt).toISOString(),
    updatedAt: new Date(session.lastTouchedAt).toISOString(),
    selectedAssistantAgentName: session.selectedAssistantAgentName,
    model: session.agentConfig.model,
    provider: session.agentConfig.provider,
    warnings: session.warnings,
    toolsLoaded: session.toolsLoaded,
    toolServers: session.toolServers,
    messages: runtimeSnapshot?.messages ?? session.initialMessages,
    pendingToolCalls: runtimeSnapshot?.pendingToolCalls ?? []
  };
}

function assistantSystemPrompt(session: PreparedScenarioAssistantSession): string {
  if (session.systemPromptCache) return session.systemPromptCache;
  const { scenario } = session.context;
  const toolLines = session.tools.map((tool) => {
    const mapping = session.toolPublicMap.get(tool.name);
    const schemaText = tool.inputSchema ? truncateJson(tool.inputSchema, 500) : '{}';
    return `- ${tool.name} (server=${mapping?.server ?? 'unknown'}, tool=${
      mapping?.tool ?? tool.name
    }) schema=${schemaText}`;
  });
  const prompt = [
    'You are a Scenario Authoring Assistant for MCP evaluation scenarios.',
    'Goal: help the user author deterministic scenario prompt, Checks (pass/fail), and Value Capture Rules.',
    'Use the available MCP tools and schemas to ground suggestions.',
    'If you need live MCP information, call a tool and wait for approval.',
    'Tool selection policy: prefer search_* tools first for retrieval; fall back to list_* tools when the query is unknown, broad, or full coverage is required.',
    'Use user-facing terminology in your text responses: "Checks" and "Value Capture Rules" (not "eval rules" / "extract rules").',
    'Respond ONLY as JSON with one of these envelopes:',
    `{"type":"assistant_message","text":"...","suggestions":{...optional...}}`,
    `{"type":"tool_call_request","text":"...","toolCall":{"name":"PUBLIC_TOOL_NAME","arguments":{}},"suggestions":{...optional...}}`,
    'For suggestions, use keys: prompt, evalRules, extractRules, notes.',
    'prompt: { replacement: string, rationale?: string }',
    'evalRules: { replacement: [{ type, tool?, value?, sequence?, path?, equals?, label?, prompt? }...], rationale?: string }',
    'extractRules: { replacement: [{ name, pattern }...], rationale?: string }',
    'If you propose any edits to the scenario (prompt, Checks, or Value Capture Rules), you MUST include the corresponding structured suggestions payload.',
    'Do not describe "suggested updates" in text only. Include suggestions so the UI can render Apply actions.',
    'Keep rule types limited to: required_tool, forbidden_tool, tool_sequence, tool_input_contains, tool_input_regex, tool_input_jsonpath, response_contains, response_not_contains, response_starts_with, response_ends_with, response_equals, response_regex, response_jsonpath, response_jsonpath_exists, response_jsonpath_not_exists, agent_check.',
    'Optional checks you may suggest when useful: tool_sequence for ordered tool-call sequences and agent_check for semantic, fuzzy, or intent-based validation.',
    'Use tool_sequence when the order of tool calls matters and you want to validate that a sequence appears in the run in order, even if other tools happen between the listed tools.',
    'For tool_sequence eval rules, set sequence to an array of raw MCP tool names in required order. Do not put the sequence in value.',
    'Use tool_input_contains to require text anywhere in one tool call input. Set tool to the raw MCP tool name and value to the text; this is case-insensitive.',
    'Use tool_input_regex to match a regular expression anywhere in one tool call input. Set tool to the raw MCP tool name and value to the regex.',
    'Use tool_input_jsonpath to inspect one tool call input. Set tool to the raw MCP tool name and path to a JSONPath expression; set equals to require a specific primitive value, or omit equals to require the path to exist.',
    'Use agent_check when the validation is semantic, fuzzy, or intent-based and deterministic checks would be brittle. agent_check requires label and prompt.',
    'Preference policy: prefer non-regex checks first (response_contains, response_not_contains, response_starts_with, response_ends_with, response_equals).',
    'Use response_regex only for genuinely variable/complex patterns (IDs, dates, currency, alternation, optional tokens, quantifiers, character classes).',
    'Never include both response_regex and an equivalent literal check for the same intent.',
    'Prefer concise, positive checks over brittle near-miss negatives. Avoid paired off-by-one guards like "not 8 tags" and "not 10 tags" when "contains 9 tags" captures intent.',
    'IMPORTANT: For required_tool and forbidden_tool eval rules, use the raw MCP tool name (the "tool=" value shown in the tool listing), NOT the prefixed public name. For example, use "value_based_search" not "trendminer__value_based_search".',
    'Ask clarifying questions if the scenario intent is unclear.',
    `Scenario context: ${JSON.stringify({
      id: scenario.id,
      name: scenario.name ?? '',
      prompt: scenario.prompt,
      serverNames: scenario.serverNames,
      evalRules: scenario.evalRules,
      extractRules: scenario.extractRules
    })}`,
    toolLines.length > 0
      ? `Available MCP tools:\n${toolLines.join('\n')}`
      : 'No MCP tools available.'
  ].join('\n');
  session.systemPromptCache = prompt;
  return prompt;
}

function formatAssistantMcpPreloadError(serverName: string, error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  const htmlErrorMatch =
    raw.match(/Error code\s+(\d{3})/i) ??
    raw.match(/<title>[^<]*\b(\d{3})\b[^<]*<\/title>/i) ??
    raw.match(/\b(502|503|504)\b/);
  const cloudflare = /cloudflare/i.test(raw);
  if (/<html/i.test(raw) || /<!doctype html/i.test(raw)) {
    const code = htmlErrorMatch?.[1];
    const provider = cloudflare ? ' (Cloudflare)' : '';
    return `Scenario Assistant MCP preload failed for server '${serverName}': Upstream MCP endpoint returned an HTML error page${
      code ? ` (${code})` : ''
    }${provider}. Check that the MCP server is reachable and healthy.`;
  }
  return `Scenario Assistant MCP preload failed for server '${serverName}': ${raw}`;
}

export async function preloadAssistantTools(
  session: PreparedScenarioAssistantSession,
  serversByName: Record<string, EvalConfig['servers'][string]>,
  selectedServerNames: string[],
  options?: { serverAuthHeaders?: Record<string, Record<string, string>> }
): Promise<void> {
  const usedNames = new Set<string>();
  for (const serverName of selectedServerNames) {
    const server = serversByName[serverName];
    if (!server) {
      session.warnings.push(`Scenario Assistant: server '${serverName}' not found in config.`);
      continue;
    }
    try {
      await session.mcp.connectAll({ [serverName]: server }, undefined, {
        serverAuthHeaders: options?.serverAuthHeaders
      });
      const tools = await session.mcp.listTools(serverName);
      for (const tool of tools) {
        const publicName = makeAssistantToolPublicName(serverName, tool.name, usedNames);
        session.toolPublicMap.set(publicName, { server: serverName, tool: tool.name });
        session.tools.push({
          ...tool,
          name: publicName,
          description: `${tool.description ?? ''}\n[server=${serverName} tool=${tool.name}]`.trim()
        });
      }
    } catch (error: unknown) {
      session.warnings.push(formatAssistantMcpPreloadError(serverName, error));
    }
  }
}

function normalizeEvalRuleToolNames(
  suggestions: ScenarioAssistantSuggestionBundle | undefined,
  toolPublicMap: Map<string, { server: string; tool: string }>
): void {
  if (!suggestions?.evalRules?.replacement) return;
  for (const rule of suggestions.evalRules.replacement) {
    if (
      (rule.type === 'required_tool' || rule.type === 'forbidden_tool') &&
      typeof rule.value === 'string' &&
      rule.value
    ) {
      const mapping = toolPublicMap.get(rule.value);
      if (mapping) {
        rule.value = mapping.tool;
      }
    }
    if (rule.type === 'tool_sequence' && Array.isArray(rule.sequence)) {
      rule.sequence = rule.sequence
        .map((toolName) => toolName.trim())
        .filter((toolName) => toolName.length > 0)
        .map((toolName) => {
          const mapping = toolPublicMap.get(toolName);
          return mapping ? mapping.tool : toolName;
        });
    }
    if (
      (rule.type === 'tool_input_contains' ||
        rule.type === 'tool_input_regex' ||
        rule.type === 'tool_input_jsonpath') &&
      rule.tool
    ) {
      rule.tool = rule.tool.trim();
      const mapping = toolPublicMap.get(rule.tool);
      if (mapping) {
        rule.tool = mapping.tool;
      }
    }
  }
}

function tryParseRegexAsLiteral(pattern: string): { literal: string; anchored: boolean } | null {
  const trimmed = pattern.trim();
  if (!trimmed) return null;
  const anchoredStart = trimmed.startsWith('^');
  const anchoredEnd = trimmed.endsWith('$');
  const body =
    anchoredStart || anchoredEnd
      ? trimmed.slice(anchoredStart ? 1 : 0, anchoredEnd ? -1 : undefined)
      : trimmed;

  const regexSpecial = new Set(['.', '^', '$', '*', '+', '?', '(', ')', '[', ']', '{', '}', '|']);
  const complexEscapes = new Set(['d', 'D', 's', 'S', 'w', 'W', 'b', 'B', 'p', 'P']);
  let literal = '';
  let escaped = false;

  for (const char of body) {
    if (escaped) {
      if (complexEscapes.has(char)) return null;
      literal += char;
      escaped = false;
      continue;
    }
    if (char === '\\') {
      escaped = true;
      continue;
    }
    if (regexSpecial.has(char)) {
      return null;
    }
    literal += char;
  }
  if (escaped) return null;
  return { literal, anchored: anchoredStart && anchoredEnd };
}

function evalRuleKey(rule: ScenarioAssistantEvalRuleSuggestion): string {
  return `${rule.type}::${rule.tool ?? ''}::${rule.value ?? ''}::${(rule.sequence ?? []).join(
    '|'
  )}::${rule.path ?? ''}::${rule.equals === undefined ? '' : String(rule.equals)}`;
}

function hasEquivalentLiteralRule(
  rules: ScenarioAssistantEvalRuleSuggestion[],
  literalValue: string
): boolean {
  return rules.some(
    (rule) =>
      (rule.type === 'response_contains' ||
        rule.type === 'response_not_contains' ||
        rule.type === 'response_starts_with' ||
        rule.type === 'response_ends_with' ||
        rule.type === 'response_equals') &&
      rule.value === literalValue
  );
}

function parseCountWithSuffix(value: string): { count: number; suffix: string } | null {
  const trimmed = value.trim();
  const match = trimmed.match(/^(\d+)(\s+.+)$/);
  if (!match) return null;
  return {
    count: Number.parseInt(match[1], 10),
    suffix: match[2]
  };
}

function collapseOffByOneCountGuards(
  rules: ScenarioAssistantEvalRuleSuggestion[]
): ScenarioAssistantEvalRuleSuggestion[] {
  const removeIndices = new Set<number>();
  const replaceContains = new Map<number, string>();

  for (let i = 0; i < rules.length; i += 1) {
    const rule = rules[i];
    if (rule.type !== 'response_contains' || typeof rule.value !== 'string' || !rule.value)
      continue;

    const explicitPositive = parseCountWithSuffix(rule.value);
    const numericOnly = !explicitPositive && rule.value.trim().match(/^\d+$/);
    if (!explicitPositive && !numericOnly) continue;

    const count = explicitPositive
      ? explicitPositive.count
      : Number.parseInt(rule.value.trim(), 10);
    const preferredSuffix = explicitPositive?.suffix;

    const offByOneCandidates = new Map<string, { lowerIdx?: number; upperIdx?: number }>();
    for (let j = 0; j < rules.length; j += 1) {
      const candidate = rules[j];
      if (
        candidate.type !== 'response_not_contains' ||
        typeof candidate.value !== 'string' ||
        !candidate.value
      )
        continue;
      const parsed = parseCountWithSuffix(candidate.value);
      if (!parsed) continue;
      if (preferredSuffix && parsed.suffix !== preferredSuffix) continue;
      if (parsed.count !== count - 1 && parsed.count !== count + 1) continue;

      const bucket = offByOneCandidates.get(parsed.suffix) ?? {};
      if (parsed.count === count - 1) bucket.lowerIdx = j;
      if (parsed.count === count + 1) bucket.upperIdx = j;
      offByOneCandidates.set(parsed.suffix, bucket);
    }

    const selected = [...offByOneCandidates.entries()].find(
      ([, pair]) => pair.lowerIdx !== undefined && pair.upperIdx !== undefined
    );
    if (!selected) continue;

    const [suffix, pair] = selected;
    removeIndices.add(pair.lowerIdx!);
    removeIndices.add(pair.upperIdx!);
    if (!explicitPositive) {
      replaceContains.set(i, `${count}${suffix}`);
    }
  }

  const result: ScenarioAssistantEvalRuleSuggestion[] = [];
  for (let i = 0; i < rules.length; i += 1) {
    if (removeIndices.has(i)) continue;
    const rule = rules[i];
    const replacement = replaceContains.get(i);
    if (replacement) {
      result.push({ ...rule, value: replacement });
      continue;
    }
    result.push(rule);
  }
  return result;
}

function normalizeIntentValue(value: string | undefined): string {
  return (value ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function positiveLiteralRank(type: string): number {
  switch (type) {
    case 'response_equals':
      return 4;
    case 'response_starts_with':
    case 'response_ends_with':
      return 3;
    case 'response_contains':
      return 2;
    default:
      return 1;
  }
}

function intentDeduplicateEvalRules(
  rules: ScenarioAssistantEvalRuleSuggestion[]
): ScenarioAssistantEvalRuleSuggestion[] {
  const result: ScenarioAssistantEvalRuleSuggestion[] = [];
  const positiveByIntent = new Map<string, number>();
  const containsIndices: number[] = [];

  for (const rule of rules) {
    if (
      (rule.type === 'response_contains' ||
        rule.type === 'response_starts_with' ||
        rule.type === 'response_ends_with' ||
        rule.type === 'response_equals') &&
      typeof rule.value === 'string' &&
      rule.value
    ) {
      const intent = normalizeIntentValue(rule.value);
      const existingIdx = positiveByIntent.get(intent);
      if (existingIdx !== undefined) {
        const existing = result[existingIdx];
        if (positiveLiteralRank(rule.type) > positiveLiteralRank(existing.type)) {
          result[existingIdx] = rule;
          if (existing.type === 'response_contains' && rule.type !== 'response_contains') {
            const containsIndex = containsIndices.indexOf(existingIdx);
            if (containsIndex >= 0) containsIndices.splice(containsIndex, 1);
          }
        }
        continue;
      }

      if (rule.type === 'response_contains') {
        const newIntent = intent;
        let droppedAsMoreSpecific = false;
        for (const idx of containsIndices) {
          const existing = result[idx];
          if (typeof existing?.value !== 'string' || !existing.value) continue;
          const existingIntent = normalizeIntentValue(existing.value);
          if (newIntent.includes(existingIntent)) {
            droppedAsMoreSpecific = true;
            break;
          }
          if (existingIntent.includes(newIntent)) {
            positiveByIntent.delete(existingIntent);
            result[idx] = rule;
            positiveByIntent.set(newIntent, idx);
            droppedAsMoreSpecific = true;
            break;
          }
        }
        if (droppedAsMoreSpecific) {
          continue;
        }
      }

      const idx = result.push(rule) - 1;
      positiveByIntent.set(intent, idx);
      if (rule.type === 'response_contains') containsIndices.push(idx);
      continue;
    }

    result.push(rule);
  }
  return result;
}

function lintContradictoryEvalRules(
  rules: ScenarioAssistantEvalRuleSuggestion[]
): ScenarioAssistantEvalRuleSuggestion[] {
  const requiredTools = new Set<string>();
  const positiveLiteralIntents = new Set<string>();
  const existingJsonPaths = new Set<string>();

  for (const rule of rules) {
    if (rule.type === 'required_tool' && typeof rule.value === 'string' && rule.value) {
      requiredTools.add(rule.value.trim());
    }
    if (
      (rule.type === 'response_contains' ||
        rule.type === 'response_starts_with' ||
        rule.type === 'response_ends_with' ||
        rule.type === 'response_equals') &&
      typeof rule.value === 'string' &&
      rule.value
    ) {
      positiveLiteralIntents.add(normalizeIntentValue(rule.value));
    }
    if (rule.type === 'response_jsonpath_exists' && rule.path) {
      existingJsonPaths.add(rule.path.trim());
    }
  }

  return rules.filter((rule) => {
    if (rule.type === 'forbidden_tool' && typeof rule.value === 'string' && rule.value) {
      return !requiredTools.has(rule.value.trim());
    }
    if (rule.type === 'response_not_contains' && typeof rule.value === 'string' && rule.value) {
      return !positiveLiteralIntents.has(normalizeIntentValue(rule.value));
    }
    if (rule.type === 'response_jsonpath_not_exists' && rule.path) {
      return !existingJsonPaths.has(rule.path.trim());
    }
    return true;
  });
}

export function normalizeScenarioAssistantEvalRules(
  replacement: ScenarioAssistantEvalRuleSuggestion[]
): ScenarioAssistantEvalRuleSuggestion[] {
  const normalized: ScenarioAssistantEvalRuleSuggestion[] = [];

  for (const rawRule of replacement) {
    const rule: ScenarioAssistantEvalRuleSuggestion = {
      ...rawRule,
      ...(typeof rawRule.value === 'string' ? { value: rawRule.value.trim() } : {}),
      ...(Array.isArray(rawRule.sequence)
        ? { sequence: rawRule.sequence.map((toolName) => toolName.trim()).filter(Boolean) }
        : {}),
      ...(typeof rawRule.path === 'string' ? { path: rawRule.path.trim() } : {})
    };

    if (rule.type === 'response_regex' && typeof rule.value === 'string' && rule.value) {
      const parsed = tryParseRegexAsLiteral(rule.value);
      if (parsed) {
        if (hasEquivalentLiteralRule(normalized, parsed.literal)) {
          continue;
        }
        normalized.push({
          type: parsed.anchored ? 'response_equals' : 'response_contains',
          value: parsed.literal
        });
        continue;
      }
    }
    normalized.push(rule);
  }

  const deduped: ScenarioAssistantEvalRuleSuggestion[] = [];
  const seen = new Set<string>();
  for (const rule of normalized) {
    const key = evalRuleKey(rule);
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(rule);
  }
  return lintContradictoryEvalRules(
    intentDeduplicateEvalRules(collapseOffByOneCountGuards(deduped))
  );
}

function normalizeEvalRuleSuggestions(
  suggestions: ScenarioAssistantSuggestionBundle | undefined
): void {
  if (!suggestions?.evalRules?.replacement) return;
  suggestions.evalRules.replacement = normalizeScenarioAssistantEvalRules(
    suggestions.evalRules.replacement
  );
}

function parseAssistantModelOutput(text: string): ParsedAssistantModelOutput {
  const parsed = parseJsonFromAssistantText(text);
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Assistant response must be a JSON object');
  }
  const parsedObj = parsed as Partial<ParsedAssistantModelOutput>;
  if (parsedObj.type !== 'assistant_message' && parsedObj.type !== 'tool_call_request') {
    const receivedType = typeof parsedObj.type === 'string' ? `"${parsedObj.type}"` : '(missing)';
    throw new Error(
      `Assistant response type ${receivedType} is unsupported; expected 'assistant_message' or 'tool_call_request'`
    );
  }
  if (typeof parsedObj.text !== 'string') {
    throw new Error('Assistant response missing text');
  }
  if (parsedObj.type === 'tool_call_request') {
    if (!parsedObj.toolCall || typeof parsedObj.toolCall !== 'object') {
      throw new Error('Assistant tool_call_request missing toolCall');
    }
    if (typeof parsedObj.toolCall.name !== 'string' || !parsedObj.toolCall.name.trim()) {
      throw new Error('Assistant toolCall.name must be a non-empty string');
    }
  }
  return parsedObj as ParsedAssistantModelOutput;
}

export function createScenarioAssistantRuntimeDefinition(
  session: PreparedScenarioAssistantSession
): AssistantRuntimeDefinition {
  return {
    assistant: 'scenario',
    outputMode: 'json',
    agent: session.agentConfig,
    context: session.context,
    initialMessages: session.initialMessages,
    dispose: () => session.mcp.disconnectAll(),
    getSystemPrompt: () => assistantSystemPrompt(session),
    tools: session.tools.map((tool) => {
      const mapping = session.toolPublicMap.get(tool.name)!;
      return {
        name: tool.name,
        server: mapping.server,
        tool: mapping.tool,
        description: tool.description,
        inputSchema: tool.inputSchema,
        execute: async (arguments_, signal) =>
          withTimeout(
            () => session.mcp.callTool(mapping.server, mapping.tool, arguments_, { signal }),
            30_000,
            'Tool call timed out after 30000ms',
            signal
          )
      };
    }),
    approvalPolicy: (name) =>
      session.tools.find((tool) => tool.name === name)?.annotations?.readOnlyHint === true
        ? 'automatic'
        : 'approval_required',
    decodeOutput: (value): AssistantRuntimeModelOutput => {
      const parsed = parseAssistantModelOutput(String(value));
      normalizeEvalRuleToolNames(parsed.suggestions, session.toolPublicMap);
      normalizeEvalRuleSuggestions(parsed.suggestions);
      if (parsed.type === 'assistant_message') {
        return { type: 'assistant_message', text: parsed.text, suggestions: parsed.suggestions };
      }
      const calls = 'toolCalls' in parsed && Array.isArray(parsed.toolCalls)
        ? parsed.toolCalls
        : parsed.toolCall ? [parsed.toolCall] : [];
      return {
        type: 'tool_call_request',
        text: parsed.text,
        toolCalls: calls.map((call) => ({ name: call.name, arguments: call.arguments })),
        suggestions: parsed.suggestions
      };
    }
  };
}

export function resolveAssistantAgentFromConfig(
  config: EvalConfig,
  selectedAssistantAgentName: string
): LlmAgentConfig {
  const agent = config.agents[selectedAssistantAgentName];
  if (!agent) {
    throw new Error(
      `Scenario Assistant agent '${selectedAssistantAgentName}' not found in resolved config agents.`
    );
  }
  if (!isLlmAgent(agent))
    throw new Error(
      `Browser Agent '${selectedAssistantAgentName}' cannot be used by Scenario Assistant.`
    );
  return agent;
}

export function resolveAssistantAgentFromLibraries(
  libraries: ReturnType<typeof readLibraries>,
  selectedAssistantAgentName: string
): LlmAgentConfig {
  const agent = libraries.agents[selectedAssistantAgentName];
  if (!agent) {
    throw new Error(
      `Scenario Assistant agent '${selectedAssistantAgentName}' not found in library agents. Configure the central Scenario Assistant Agent in Libraries > Scenarios.`
    );
  }
  if (!isLlmAgent(agent))
    throw new Error(
      `Browser Agent '${selectedAssistantAgentName}' cannot be used by Scenario Assistant.`
    );
  return agent;
}

export function pickDefaultAssistantAgentName(params: {
  requested?: string;
  settingsDefault?: string;
  agentNames: string[];
}): string {
  const requested = params.requested?.trim();
  if (requested) return requested;
  const settingsDefault = params.settingsDefault?.trim();
  if (settingsDefault) return settingsDefault;
  return params.agentNames[0] ?? '';
}
