import type { ServerResponse } from 'node:http';
import {
  isLlmAgent,
  type EvalConfig,
  type LlmAgentConfig,
  type AssistantRuntimeMessage,
  type AssistantRuntimeDefinition,
  type AssistantRuntimeSession,
  type ScenarioAssistantSuggestionBundle,
  type ScenarioAssistantSuggestionRule,
  type ScenarioAssistantRuntimeContext,
  type ToolDef
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
import { readLibraries } from './libraries-store.js';

export { truncateJson } from './assistant-common.js';

type ScenarioAssistantContextInput = ScenarioAssistantRuntimeContext;

type ScenarioAssistantEvalRuleSuggestion = ScenarioAssistantSuggestionRule;

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

// The hard TTL also aborts work in abandoned sessions; active operations refresh lastTouchedAt.
export function cleanupAssistantSessions(
  sessions: Map<string, ScenarioAssistantSession>,
  now = Date.now()
): void {
  cleanupSessionsByTtl(sessions, SCENARIO_ASSISTANT_SESSION_TTL_MS, now, (session) => {
    void Promise.resolve(session.runtime?.dispose()).catch(() => {});
    endAssistantSseClients(session);
  });
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
    'Use up to three external tool calls per batch. Read-only batches can continue automatically. If any call in a batch requires approval, wait for a decision on every call in that batch, including read calls; each call is approved or denied separately.',
    'Tool selection policy: prefer search_* tools first for retrieval; fall back to list_* tools when the query is unknown, broad, or full coverage is required.',
    'Use user-facing terminology in your text responses: "Checks" and "Value Capture Rules" (not "eval rules" / "extract rules").',
    'Respond naturally in ordinary prose. Use the local propose_scenario_changes tool whenever you propose scenario edits.',
    'The local proposal tool accepts these keys: prompt, evalRules, extractRules, notes.',
    'prompt: { replacement: string, rationale?: string }',
    'evalRules: { replacement: [{ type, tool?, value?, sequence?, path?, equals?, label?, prompt? }...], rationale?: string }',
    'extractRules: { replacement: [{ name, pattern }...], rationale?: string }',
    'Use the proposal tool with a complete replacement for every field you propose to change, plus a rationale.',
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

const PROPOSE_SCENARIO_CHANGES = 'propose_scenario_changes';
const ruleTypes = new Set<string>([
  'required_tool',
  'forbidden_tool',
  'tool_sequence',
  'tool_input_contains',
  'tool_input_regex',
  'tool_input_jsonpath',
  'response_contains',
  'response_not_contains',
  'response_starts_with',
  'response_ends_with',
  'response_equals',
  'response_regex',
  'response_jsonpath',
  'response_jsonpath_exists',
  'response_jsonpath_not_exists',
  'agent_check'
]);
const proposalSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    prompt: {
      type: 'object',
      additionalProperties: false,
      required: ['replacement'],
      properties: { replacement: { type: 'string' }, rationale: { type: 'string' } }
    },
    evalRules: {
      type: 'object',
      additionalProperties: false,
      required: ['replacement'],
      properties: {
        replacement: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['type'],
            properties: {
              type: { type: 'string', enum: [...ruleTypes] },
              tool: { type: 'string' },
              value: { anyOf: [{ type: 'string' }, { type: 'number' }, { type: 'boolean' }] },
              sequence: { type: 'array', items: { type: 'string' } },
              path: { type: 'string' },
              equals: { anyOf: [{ type: 'string' }, { type: 'number' }, { type: 'boolean' }] },
              label: { type: 'string' },
              prompt: { type: 'string' }
            }
          }
        },
        rationale: { type: 'string' }
      }
    },
    extractRules: {
      type: 'object',
      additionalProperties: false,
      required: ['replacement'],
      properties: {
        replacement: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['name', 'pattern'],
            properties: { name: { type: 'string' }, pattern: { type: 'string' } }
          }
        },
        rationale: { type: 'string' }
      }
    },
    notes: { type: 'array', items: { type: 'string' } }
  }
};
export function validateScenarioAssistantProposal(
  input: unknown,
  toolPublicMap: Map<string, { server: string; tool: string }>
): ScenarioAssistantSuggestionBundle {
  const invalid = (path: string, issue: string): never => {
    throw new Error(`Invalid scenario proposal at ${path}: ${issue}`);
  };
  if (!input || typeof input !== 'object' || Array.isArray(input))
    return invalid('proposal', 'expected an object');
  const value = input as Record<string, unknown>;
  const checkKeys = (object: Record<string, unknown>, allowed: string[], path: string) => {
    const unknown = Object.keys(object).find((key) => !allowed.includes(key));
    if (unknown !== undefined) invalid(`${path}.${unknown}`, 'unknown key');
  };
  checkKeys(value, ['prompt', 'evalRules', 'extractRules', 'notes'], 'proposal');
  const result: ScenarioAssistantSuggestionBundle = {};
  const validRationale = (obj: Record<string, unknown>) =>
    obj.rationale === undefined || typeof obj.rationale === 'string';
  if (value.prompt !== undefined) {
    if (!value.prompt || typeof value.prompt !== 'object' || Array.isArray(value.prompt))
      return invalid('prompt', 'expected an object');
    const p = value.prompt as Record<string, unknown>;
    checkKeys(p, ['replacement', 'rationale'], 'prompt');
    if (typeof p.replacement !== 'string')
      return invalid('prompt.replacement', 'expected a string');
    if (!validRationale(p)) return invalid('prompt.rationale', 'expected a string');
    result.prompt = {
      replacement: p.replacement,
      ...(p.rationale === undefined ? {} : { rationale: p.rationale as string })
    };
  }
  if (value.evalRules !== undefined) {
    if (!value.evalRules || typeof value.evalRules !== 'object' || Array.isArray(value.evalRules))
      return invalid('evalRules', 'expected an object');
    const e = value.evalRules as Record<string, unknown>;
    checkKeys(e, ['replacement', 'rationale'], 'evalRules');
    if (!Array.isArray(e.replacement)) return invalid('evalRules.replacement', 'expected an array');
    if (!validRationale(e)) return invalid('evalRules.rationale', 'expected a string');
    for (const [index, rule] of e.replacement.entries()) {
      const path = `evalRules.replacement[${index}]`;
      if (!rule || typeof rule !== 'object' || Array.isArray(rule))
        return invalid(path, 'expected an object');
      const r = rule as Record<string, unknown>;
      checkKeys(
        r,
        ['type', 'tool', 'value', 'sequence', 'path', 'equals', 'label', 'prompt'],
        path
      );
      if (typeof r.type !== 'string') return invalid(`${path}.type`, 'expected a rule type');
      if (!ruleTypes.has(r.type))
        return invalid(`${path}.type`, `unsupported rule type '${r.type}'`);
      for (const key of ['tool', 'path', 'label', 'prompt'])
        if (r[key] !== undefined && typeof r[key] !== 'string')
          return invalid(`${path}.${key}`, 'expected a string');
      if (r.value !== undefined && !['string', 'number', 'boolean'].includes(typeof r.value))
        return invalid(`${path}.value`, 'expected a string, number, or boolean');
      if (r.equals !== undefined && !['string', 'number', 'boolean'].includes(typeof r.equals))
        return invalid(`${path}.equals`, 'expected a string, number, or boolean');
      if (
        r.sequence !== undefined &&
        (!Array.isArray(r.sequence) || !r.sequence.every((x) => typeof x === 'string'))
      )
        return invalid(`${path}.sequence`, 'expected an array of strings');
      const type = r.type as string;
      if (
        type === 'required_tool' ||
        type === 'forbidden_tool' ||
        (type.startsWith('response_') && !type.includes('jsonpath'))
      ) {
        if (typeof r.value !== 'string')
          return invalid(`${path}.value`, 'required and must be a string');
      }
      if (type === 'tool_sequence' && (!Array.isArray(r.sequence) || r.sequence.length === 0))
        return invalid(`${path}.sequence`, 'required and must be a non-empty array');
      if (type.startsWith('tool_input_') && typeof r.tool !== 'string')
        return invalid(`${path}.tool`, 'required and must be a string');
      if (
        (type === 'tool_input_contains' || type === 'tool_input_regex') &&
        typeof r.value !== 'string'
      )
        return invalid(`${path}.value`, 'required and must be a string');
      if ((type === 'tool_input_regex' || type === 'response_regex') && typeof r.value !== 'string')
        return invalid(`${path}.value`, 'required and must be a string');
      if (
        type.endsWith('jsonpath') ||
        type.endsWith('jsonpath_exists') ||
        type.endsWith('jsonpath_not_exists')
      ) {
        if (typeof r.path !== 'string')
          return invalid(`${path}.path`, 'required and must be a string');
      }
      if (type === 'agent_check' && typeof r.label !== 'string')
        return invalid(`${path}.label`, 'required and must be a string');
      if (type === 'agent_check' && typeof r.prompt !== 'string')
        return invalid(`${path}.prompt`, 'required and must be a string');
    }
    const rules = structuredClone(e.replacement) as ScenarioAssistantEvalRuleSuggestion[];
    const bundle = { evalRules: { replacement: rules } };
    normalizeEvalRuleToolNames(bundle, toolPublicMap);
    bundle.evalRules.replacement = normalizeScenarioAssistantEvalRules(
      bundle.evalRules.replacement
    );
    result.evalRules = {
      ...bundle.evalRules,
      ...(e.rationale === undefined ? {} : { rationale: e.rationale as string })
    };
  }
  if (value.extractRules !== undefined) {
    if (
      !value.extractRules ||
      typeof value.extractRules !== 'object' ||
      Array.isArray(value.extractRules)
    )
      return invalid('extractRules', 'expected an object');
    const e = value.extractRules as Record<string, unknown>;
    checkKeys(e, ['replacement', 'rationale'], 'extractRules');
    if (!Array.isArray(e.replacement))
      return invalid('extractRules.replacement', 'expected an array');
    if (!validRationale(e)) return invalid('extractRules.rationale', 'expected a string');
    for (const [index, item] of e.replacement.entries()) {
      const path = `extractRules.replacement[${index}]`;
      if (!item || typeof item !== 'object' || Array.isArray(item))
        return invalid(path, 'expected an object');
      const rule = item as Record<string, unknown>;
      checkKeys(rule, ['name', 'pattern'], path);
      if (typeof rule.name !== 'string')
        return invalid(`${path}.name`, 'required and must be a string');
      if (typeof rule.pattern !== 'string')
        return invalid(`${path}.pattern`, 'required and must be a string');
    }
    result.extractRules = {
      replacement: structuredClone(e.replacement) as Array<{ name: string; pattern: string }>,
      ...(e.rationale === undefined ? {} : { rationale: e.rationale as string })
    };
  }
  if (value.notes !== undefined) {
    if (!Array.isArray(value.notes)) return invalid('notes', 'expected an array');
    for (const [index, note] of value.notes.entries())
      if (typeof note !== 'string') return invalid(`notes[${index}]`, 'expected a string');
    result.notes = [...value.notes] as string[];
  }
  if (!result.prompt && !result.evalRules && !result.extractRules)
    return invalid('proposal', 'must include at least one change');
  return result;
}

export function createScenarioAssistantRuntimeDefinition(
  session: PreparedScenarioAssistantSession
): AssistantRuntimeDefinition {
  return {
    assistant: 'scenario',
    agent: session.agentConfig,
    context: session.context,
    initialMessages: session.initialMessages,
    dispose: () => session.mcp.disconnectAll(),
    getSystemPrompt: () => assistantSystemPrompt(session),
    tools: [
      ...session.tools.map((tool) => {
        const mapping = session.toolPublicMap.get(tool.name)!;
        return {
          name: tool.name,
          server: mapping.server,
          tool: mapping.tool,
          description: tool.description,
          inputSchema: tool.inputSchema,
          execute: async (arguments_: unknown, signal?: AbortSignal) =>
            withTimeout(
              () => session.mcp.callTool(mapping.server, mapping.tool, arguments_, { signal }),
              30_000,
              'Tool call timed out after 30000ms',
              signal
            )
        };
      }),
      {
        name: PROPOSE_SCENARIO_CHANGES,
        server: 'local',
        tool: PROPOSE_SCENARIO_CHANGES,
        description: 'Submit structured scenario changes for the user to review and apply.',
        inputSchema: proposalSchema,
        execute: async (args: unknown, _signal?: AbortSignal) =>
          validateScenarioAssistantProposal(args, session.toolPublicMap),
        extractProposal: (result) => result as ScenarioAssistantSuggestionBundle
      }
    ],
    approvalPolicy: (name) =>
      name === PROPOSE_SCENARIO_CHANGES
        ? 'local'
        : session.tools.find((tool) => tool.name === name)?.annotations?.readOnlyHint === true
          ? 'automatic'
          : 'approval_required'
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
