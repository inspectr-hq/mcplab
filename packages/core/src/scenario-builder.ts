import type { EvalRules, SourceScenario } from './types.js';

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
  eval?: EvalRules;
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
  const evalRules = mergeEvalRules(input.eval, {
    required,
    forbidden,
    sequence,
    patterns
  });
  return {
    id,
    ...(input.name?.trim() ? { name: input.name.trim() } : {}),
    ...(input.agent?.trim() ? { agent: input.agent.trim() } : {}),
    mcp_servers: unique(input.servers).map((ref) => ({ ref })),
    prompt: input.prompt.trim(),
    ...(evalRules ? { eval: evalRules } : {}),
    ...(input.extract_rules?.length
      ? {
          extract: input.extract_rules.map((rule) => ({
            name: rule.name,
            from: 'final_text' as const,
            regex: rule.regex
          }))
        }
      : {})
  } as SourceScenario;
}

function mergeEvalRules(
  canonical: EvalRules | undefined,
  convenience: {
    required: string[];
    forbidden: string[];
    sequence: string[];
    patterns: string[];
  }
): EvalRules | undefined {
  const hasConvenience =
    convenience.required.length > 0 ||
    convenience.forbidden.length > 0 ||
    convenience.sequence.length > 0 ||
    convenience.patterns.length > 0;
  if (!canonical && !hasConvenience) return undefined;

  const canonicalConstraints = canonical?.tool_constraints;
  if (convenience.required.length && canonicalConstraints?.required_tools?.length) {
    throw new Error(
      'Provide required_tools either as a convenience field or in eval.tool_constraints, not both.'
    );
  }
  if (convenience.forbidden.length && canonicalConstraints?.forbidden_tools?.length) {
    throw new Error(
      'Provide forbidden_tools either as a convenience field or in eval.tool_constraints, not both.'
    );
  }
  if (convenience.sequence.length && canonical?.tool_sequence?.length) {
    throw new Error('Provide tool_sequence either as a convenience field or in eval, not both.');
  }
  if (convenience.patterns.length && canonical?.response_assertions?.length) {
    throw new Error(
      'Provide response_regex_patterns either as a convenience field or in eval.response_assertions, not both.'
    );
  }

  const toolConstraints =
    convenience.required.length || convenience.forbidden.length || canonicalConstraints
      ? {
          ...(canonicalConstraints ?? {}),
          ...(convenience.required.length ? { required_tools: convenience.required } : {}),
          ...(convenience.forbidden.length ? { forbidden_tools: convenience.forbidden } : {})
        }
      : undefined;
  const responseAssertions = convenience.patterns.length
    ? convenience.patterns.map((pattern) => ({ type: 'regex' as const, pattern }))
    : canonical?.response_assertions;
  const merged = {
    ...(canonical ?? {}),
    ...(toolConstraints ? { tool_constraints: toolConstraints } : {}),
    ...(convenience.sequence.length ? { tool_sequence: convenience.sequence } : {}),
    ...(responseAssertions ? { response_assertions: responseAssertions } : {})
  };
  return Object.keys(merged).length > 0 ? merged : undefined;
}

function unique(values?: string[]): string[] {
  return [...new Set((values ?? []).map((value) => value.trim()).filter(Boolean))];
}
function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}
