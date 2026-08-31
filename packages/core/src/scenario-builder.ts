import type { SourceScenario } from './types.js';

export type ScenarioBuildInput = {
  id?: string;
  name?: string;
  agent?: string;
  servers: string[];
  prompt: string;
  required_tools?: string[];
  forbidden_tools?: string[];
  tool_sequence?: string[];
  response_regex_patterns?: string[];
  extract_rules?: Array<{ name: string; regex: string }>;
};

/** Build the canonical source scenario shape used by draft and persistence flows. */
export function buildScenarioEntry(input: ScenarioBuildInput): SourceScenario {
  const id = input.id?.trim() || slugify(input.name?.trim() || input.prompt.slice(0, 40));
  if (!id) throw new Error('Unable to derive scenario id. Provide id or name.');
  const required = unique(input.required_tools);
  const forbidden = unique(input.forbidden_tools);
  const sequence = unique(input.tool_sequence);
  const patterns = unique(input.response_regex_patterns);
  const evalRules = required.length || forbidden.length || sequences.length || patterns.length
    ? {
        ...(required.length || forbidden.length ? { tool_constraints: { ...(required.length ? { required_tools: required } : {}), ...(forbidden.length ? { forbidden_tools: forbidden } : {}) } } : {}),
        ...(sequence.length ? { tool_sequence: sequence } : {}),
        ...(patterns.length ? { response_assertions: patterns.map((pattern) => ({ type: 'regex' as const, pattern })) } : {})
      }
    : undefined;
  return {
    id,
    ...(input.name?.trim() ? { name: input.name.trim() } : {}),
    ...(input.agent?.trim() ? { agent: input.agent.trim() } : {}),
    mcp_servers: unique(input.servers).map((ref) => ({ ref })),
    prompt: input.prompt.trim(),
    ...(evalRules ? { eval: evalRules } : {}),
    ...(input.extract_rules?.length ? { extract: input.extract_rules.map((rule) => ({ name: rule.name, from: 'final_text' as const, regex: rule.regex })) } : {})
  } as SourceScenario;
}

function unique(values?: string[]): string[] { return [...new Set((values ?? []).map((value) => value.trim()).filter(Boolean))]; }
function slugify(input: string): string { return input.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80); }
