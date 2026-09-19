import { type BrowserProviderProfile, type LlmAgentConfig } from '@inspectr/mcplab-core';
import { validateBrowserProviderProfile } from '@inspectr/mcplab-core';
import type { LlmMessage } from '@inspectr/mcplab-core';
import { chatWithJsonRetry } from './assistant-common.js';

export interface BrowserProviderLearningTraceInput {
  observedGeneration?: unknown;
  selectorValidation?: unknown;
  events?: unknown;
}

export interface BrowserProviderProposal {
  profile: BrowserProviderProfile;
  rationale: string[];
  warnings: string[];
  validated: true;
}

export function sanitizeBrowserProviderProposalDiagnostics(value: unknown): {
  rationale: string[];
  warnings: string[];
} {
  const source = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  const strings = (candidate: unknown) =>
    Array.isArray(candidate)
      ? candidate
          .filter((item): item is string => typeof item === 'string')
          .map((item) => item.slice(0, 500))
          .slice(0, 8)
      : [];
  return { rationale: strings(source.rationale), warnings: strings(source.warnings) };
}

export function sanitizeBrowserProviderLearningTrace(
  value: BrowserProviderLearningTraceInput
): Record<string, unknown> {
  const events = Array.isArray(value.events)
    ? value.events.slice(-32).map((event) => {
        if (!event || typeof event !== 'object') return null;
        const source = event as Record<string, unknown>;
        return {
          phase: typeof source.phase === 'string' ? source.phase : undefined,
          at: typeof source.at === 'string' ? source.at : undefined,
          candidateCount:
            typeof source.candidateCount === 'number' ? source.candidateCount : undefined,
          changedCandidateCount:
            typeof source.changedCandidateCount === 'number'
              ? source.changedCandidateCount
              : undefined,
          visibleControlCount:
            typeof source.visibleControlCount === 'number' ? source.visibleControlCount : undefined,
          disabledControlCount:
            typeof source.disabledControlCount === 'number'
              ? source.disabledControlCount
              : undefined,
          selectedCandidate:
            source.selectedCandidate && typeof source.selectedCandidate === 'object'
              ? (() => {
                  const candidate = source.selectedCandidate as Record<string, unknown>;
                  return {
                    tagName: typeof candidate.tagName === 'string' ? candidate.tagName : undefined,
                    testId: typeof candidate.testId === 'string' ? candidate.testId : undefined,
                    textLength:
                      typeof candidate.textLength === 'number' ? candidate.textLength : undefined
                  };
                })()
              : undefined,
          textHash: typeof source.textHash === 'string' ? source.textHash : undefined,
          snapshot: Array.isArray(source.snapshot)
            ? source.snapshot.slice(-64).flatMap((node) => {
                if (!node || typeof node !== 'object') return [];
                const item = node as Record<string, unknown>;
                if (typeof item.selector !== 'string' || typeof item.tagName !== 'string')
                  return [];
                return [
                  {
                    selector: item.selector.slice(0, 500),
                    tagName: item.tagName.slice(0, 80),
                    ...(typeof item.role === 'string' ? { role: item.role.slice(0, 80) } : {}),
                    ...(typeof item.ariaLabel === 'string'
                      ? { ariaLabel: item.ariaLabel.slice(0, 200) }
                      : {}),
                    ...(typeof item.testId === 'string'
                      ? { testId: item.testId.slice(0, 200) }
                      : {}),
                    visible: item.visible === true,
                    disabled: item.disabled === true,
                    textLength: typeof item.textLength === 'number' ? item.textLength : 0
                  }
                ];
              })
            : undefined
        };
      })
    : [];
  return {
    observedGeneration: value.observedGeneration === true,
    selectorValidation: value.selectorValidation ?? null,
    events
  };
}

export function parseBrowserProviderProposal(text: string): BrowserProviderProposal {
  const parsed = JSON.parse(text) as Record<string, unknown>;
  const rawProfile = parsed.profile ?? parsed;
  const profile = validateBrowserProviderProfile(rawProfile);
  const rationale = Array.isArray(parsed.rationale)
    ? parsed.rationale.filter((value): value is string => typeof value === 'string').slice(0, 8)
    : [];
  const warnings = Array.isArray(parsed.warnings)
    ? parsed.warnings.filter((value): value is string => typeof value === 'string').slice(0, 8)
    : [];
  return { profile, rationale, warnings, validated: true };
}

export async function proposeBrowserProviderProfile(params: {
  agent: LlmAgentConfig;
  profile: BrowserProviderProfile;
  trace: BrowserProviderLearningTraceInput;
}): Promise<BrowserProviderProposal> {
  const messages: LlmMessage[] = [
    {
      role: 'user',
      content: [
        'Review this browser-provider learning trace and propose a corrected profile.',
        'Only change selectors or completion settings when supported by the observed lifecycle.',
        'Return one JSON object with profile, rationale (string array), and warnings (string array).',
        'Never add executable scripts, URLs outside the existing origin, or raw response content.',
        `Current profile:\n${JSON.stringify(params.profile)}`,
        `Observed trace:\n${JSON.stringify(sanitizeBrowserProviderLearningTrace(params.trace))}`
      ].join('\n\n')
    }
  ];
  const response = await chatWithJsonRetry({
    agent: params.agent,
    messages,
    tools: [],
    system:
      'You are a browser automation profile reviewer. Preserve the existing profile shape and identity. Selectors must be CSS selectors observed in the trace. A generation selector must represent an active generating state, and an idle selector must represent an enabled completion state.',
    parse: parseBrowserProviderProposal,
    toolCallFallbackText: () => 'Return the validated browser provider profile JSON.'
  });
  if ('type' in response) throw new Error('The provider proposal model returned a tool request.');
  return response;
}
