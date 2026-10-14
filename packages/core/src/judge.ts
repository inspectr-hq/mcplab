import type {
  AgentAssertion,
  AgentAssertionJudgeResult,
  AgentJudgeContext,
  LlmAgentConfig,
  SemanticEvaluationParams
} from './types.js';
import { buildBatchJudgeResponseFormat, chatWithAgent } from './agent.js';

export function buildJudgeBatchPayload(
  finalText: string,
  assertions: AgentAssertion[],
  context?: AgentJudgeContext
) {
  return {
    final_answer: finalText,
    ...(context && Object.keys(context).length > 0 ? { context } : {}),
    checks: assertions.map((assertion, index) => ({
      id: `agent-check-${index + 1}`,
      label: assertion.label,
      prompt: assertion.prompt
    }))
  };
}

type JudgeBatchPayload = ReturnType<typeof buildJudgeBatchPayload>;

export function mapJudgeBatchResults(params: {
  judgeName: string;
  judgeAgent: LlmAgentConfig;
  batch: JudgeBatchPayload;
  raw: string;
}): AgentAssertionJudgeResult[] {
  let parsed: { results?: unknown };
  try {
    parsed = JSON.parse(extractJudgeJson(params.raw));
  } catch {
    throw new Error(`judge "${params.judgeName}" returned invalid JSON for batched agent checks`);
  }
  if (!Array.isArray(parsed.results)) {
    throw new Error(
      `judge "${params.judgeName}" returned invalid results array for batched agent checks`
    );
  }

  const resultsById = new Map<string, { id: string; pass: boolean; reason: string }>();
  for (const item of parsed.results) {
    if (!item || typeof item !== 'object') {
      throw new Error(
        `judge "${params.judgeName}" returned invalid result item for batched agent checks`
      );
    }
    const candidate = item as Record<string, unknown>;
    if (
      typeof candidate.id !== 'string' ||
      typeof candidate.pass !== 'boolean' ||
      typeof candidate.reason !== 'string'
    ) {
      throw new Error(
        `judge "${params.judgeName}" returned invalid result item for batched agent checks`
      );
    }
    if (!resultsById.has(candidate.id)) {
      resultsById.set(candidate.id, {
        id: candidate.id,
        pass: candidate.pass,
        reason: candidate.reason
      });
    }
  }

  return params.batch.checks.map((check) => {
    const matched = resultsById.get(check.id);
    if (!matched) {
      return {
        label: check.label,
        pass: false,
        reason: `Judge did not return a result for "${check.label}"`,
        metadata: buildJudgeCheckMetadata(params.judgeName, params.judgeAgent, check.id)
      };
    }

    const trimmedReason = matched.reason.trim();
    return {
      label: check.label,
      pass: matched.pass,
      reason:
        trimmedReason.length > 0
          ? trimmedReason
          : matched.pass
            ? `Agent check passed: ${check.label}`
            : `Agent check failed: ${check.label}`,
      metadata: buildJudgeCheckMetadata(params.judgeName, params.judgeAgent, check.id)
    };
  });
}

export async function judgeAgentAssertions(
  params: Omit<SemanticEvaluationParams, 'evaluationDecision'>
): Promise<AgentAssertionJudgeResult[]> {
  const batch = buildJudgeBatchPayload(params.finalText, params.assertions, params.context);
  const system = [
    'You evaluate whether a final answer satisfies a set of semantic checks.',
    'Evaluate each check independently against final_answer.',
    'Use final_answer as the primary answer being judged.',
    'If context.scenario_prompt is provided, use it to decide whether the final answer addresses the original request.',
    'If context.tool_sequence is provided, use it only to understand which tools were called.',
    'If context.tool_inputs is provided, use the tool names and arguments to reason about how the tools were used.',
    'Do not require context fields that are not provided.',
    'Return JSON only.',
    'Schema: {"results":[{"id":"abc","pass":true,"reason":"text"}]}.',
    'Keep each reason short and concrete.'
  ].join(' ');
  const response = await chatWithAgent({
    agent: params.judge.agent,
    system,
    tools: [],
    signal: params.signal,
    responseFormat: buildBatchJudgeResponseFormat(),
    messages: [
      {
        role: 'user',
        content: JSON.stringify(batch)
      }
    ]
  });
  return mapJudgeBatchResults({
    judgeName: params.judge.name,
    judgeAgent: params.judge.agent,
    batch,
    raw: String(response.content ?? '').trim()
  });
}

function buildJudgeCheckMetadata(judgeName: string, judgeAgent: LlmAgentConfig, checkId: string) {
  return {
    check_id: checkId,
    judge_agent: judgeName,
    judge_model: judgeAgent.model,
    judge_provider: judgeAgent.provider
  };
}

export function extractJudgeJson(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return trimmed;
  const fencedMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fencedMatch?.[1]) return fencedMatch[1].trim();
  const objectStart = trimmed.indexOf('{');
  if (objectStart >= 0) {
    const objectEnd = findMatchingJsonObjectEnd(trimmed, objectStart);
    if (objectEnd > objectStart) {
      return trimmed.slice(objectStart, objectEnd + 1).trim();
    }
  }
  return trimmed;
}

function findMatchingJsonObjectEnd(text: string, startIndex: number): number {
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = startIndex; index < text.length; index += 1) {
    const char = text[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === '\\') {
      escaped = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (char === '{') {
      depth += 1;
      continue;
    }
    if (char === '}') {
      depth -= 1;
      if (depth === 0) return index;
    }
  }

  return -1;
}
